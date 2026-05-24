import { Bot, type Context, type InlineKeyboard } from "grammy";
import type { AppConfig } from "../config";
import { checkAddress, checkTransactionHash } from "../check/manualCheck";
import type { Db } from "../storage/db";
import { formatSafetyRecheckSummary, parseSafetyRecheckTarget, runSafetyRecheck } from "../approvals/safetyRecheck";
import {
  addCustomerAlertRecipient,
  addWatchedWallet,
  clearTelegramUserPendingAction,
  getTelegramUserSession,
  getWalletApprovalSummary,
  getWalletDashboardSnapshot,
  getWalletPollState,
  listCustomerAlertRecipients,
  listAddressLabels,
  listWatchedWallets,
  removeCustomerAlertRecipient,
  removeWatchedWallet,
  saveAddressLabel,
  saveRiskEvaluationEvidence,
  setTelegramUserPendingAction,
  updateWatchedWalletAlertMode,
  upsertTelegramUser,
  upsertWalletDashboardSnapshot
} from "../storage/repositories";
import type { CustomerAlertMode } from "../storage/repositories";
import type { RiskLabel, RiskReport, WalletAlertMode, WatchedWallet } from "../types";
import { classifyInput } from "../tron/address";
import type { TronApprovalClient, TronClient, TronDashboardClient } from "../tron/tronClient";
import { getWalletDashboard } from "../wallet/dashboard";
import {
  bold,
  bulletList,
  code,
  escapeHtml,
  formatRiskIcon,
  telegramHtmlMessage,
  type TelegramHtmlMessage
} from "../alerts/telegramHtml";
import {
  addWalletPrompt,
  addAlertAdminPrompt,
  alertAdminAddedMessage,
  alertAdminNotFoundMessage,
  alertAdminRemovedMessage,
  alertAdminsMessage,
  analyticsMessage,
  checkAddressPrompt,
  checkTxPrompt,
  dashboardMessage,
  helpMessage,
  homeMessage,
  myIdMessage,
  profileMessage,
  removeAlertAdminPrompt,
  removeConfirmMessage,
  riskIntelOverviewMessage,
  safetyMessage,
  securityMessage,
  settingsMessage,
  walletAlertModeMessage,
  walletAlertModeUpdatedMessage,
  walletsMessage
} from "./messages";
import {
  alertAdminsKeyboard,
  backToWalletKeyboard,
  cancelKeyboard,
  mainMenuKeyboard,
  parseCallbackData,
  profileKeyboard,
  settingsKeyboard,
  walletAlertModeKeyboard,
  walletDashboardKeyboard,
  walletRemoveKeyboard,
  walletsKeyboard
} from "./keyboards";
import { shouldHandlePendingText } from "./pendingActions";

const ALLOWED_LABELS: readonly RiskLabel[] = [
  "scam",
  "stolen_funds",
  "phishing",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract"
];

const allowedLabelSet = new Set<RiskLabel>(ALLOWED_LABELS);
const allowedWalletAlertModes = new Set<WalletAlertMode>(["realtime", "risk_only", "digest", "paused"]);
const telegramIdPattern = /^\d{1,20}$/;

type BotMessage = string | TelegramHtmlMessage;
type BotSendOptions = {
  reply_markup?: InlineKeyboard;
  parse_mode?: "HTML";
};

function telegramId(ctx: { from?: { id: number } }): string {
  if (!ctx.from?.id) throw new Error("Telegram user id is missing");
  return String(ctx.from.id);
}

function isServiceAdmin(config: AppConfig, id: string): boolean {
  return config.serviceAdminTelegramIds.has(id);
}

function messageText(message: BotMessage): string {
  return typeof message === "string" ? message : message.text;
}

function messageOptions(message: BotMessage, keyboard?: InlineKeyboard): BotSendOptions | undefined {
  const options: BotSendOptions = {};
  if (keyboard) options.reply_markup = keyboard;
  if (typeof message !== "string") options.parse_mode = message.parseMode;
  return Object.keys(options).length > 0 ? options : undefined;
}

async function sendMessage(
  ctx: { reply(text: string, options?: BotSendOptions): Promise<unknown> },
  message: BotMessage,
  keyboard?: InlineKeyboard
): Promise<void> {
  await ctx.reply(messageText(message), messageOptions(message, keyboard));
}

function combineMessages(messages: TelegramHtmlMessage[]): TelegramHtmlMessage {
  return {
    text: messages.map((message) => message.text).join("\n\n"),
    parseMode: "HTML"
  };
}

function formatManualReport(subjectAddress: string, report: RiskReport): TelegramHtmlMessage {
  return telegramHtmlMessage([
    bold("\u{1F50E} Address check"),
    `${bold("Subject")}: ${code(subjectAddress)}`,
    `${bold("Risk")}: ${formatRiskIcon(report.level)} ${code(`${report.score}/100`)} (${escapeHtml(report.level)}, beta)`,
    bold("Reasons"),
    bulletList(report.reasons.map((reason) => reason.message), "no obvious risk signals found")
  ]);
}

function commandText(value: string | undefined): string {
  return (value ?? "").trim();
}

function parseAlertMode(value: string | undefined): CustomerAlertMode | null {
  if (!value) return "suspicious_only";
  if (value === "suspicious") return "suspicious_only";
  if (value === "all" || value === "suspicious_only") return value;
  return null;
}

function parseAlertAdminInput(
  text: string,
  ownerTelegramUserId: string,
  defaultMode: CustomerAlertMode = "suspicious_only"
): { recipientTelegramUserId: string; alertMode: CustomerAlertMode } | { error: string } {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const recipientTelegramUserId = parts[0] ?? "";
  const alertMode = parseAlertMode(parts[1]) ?? (parts[1] ? null : defaultMode);

  if (parts.length === 0 || parts.length > 2 || !telegramIdPattern.test(recipientTelegramUserId) || !alertMode) {
    return { error: "Send a numeric Telegram ID, optionally followed by all or suspicious_only." };
  }

  if (recipientTelegramUserId === ownerTelegramUserId) {
    return { error: "You already receive owner alerts. Add a different Telegram ID." };
  }

  return { recipientTelegramUserId, alertMode };
}

function parseAlertAdminRemoveInput(text: string, ownerTelegramUserId: string): { recipientTelegramUserId: string } | { error: string } {
  const recipientTelegramUserId = text.trim();
  if (!telegramIdPattern.test(recipientTelegramUserId)) {
    return { error: "Send a numeric Telegram ID." };
  }

  if (recipientTelegramUserId === ownerTelegramUserId) {
    return { error: "The wallet owner cannot be removed from owner alerts." };
  }

  return { recipientTelegramUserId };
}

function parseWalletModeInput(
  text: string
):
  | { address: string; alertMode: WalletAlertMode; digestIntervalMinutes: number }
  | { error: string } {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const input = classifyInput(parts[0] ?? "");
  const alertMode = parts[1] as WalletAlertMode | undefined;

  if (parts.length < 2 || parts.length > 3 || input.kind !== "tron_address" || !alertMode || !allowedWalletAlertModes.has(alertMode)) {
    return { error: "Usage: /wallet_mode <TRON-address> <realtime|risk_only|digest|paused> [minutes]" };
  }

  if (alertMode !== "digest" && parts[2]) {
    return { error: "Digest interval can only be set for digest mode." };
  }

  const digestIntervalMinutes = alertMode === "digest" ? Number(parts[2] ?? "10") : 10;
  if (!Number.isSafeInteger(digestIntervalMinutes) || digestIntervalMinutes < 5 || digestIntervalMinutes > 60) {
    return { error: "Digest interval must be between 5 and 60 minutes." };
  }

  return { address: input.value, alertMode, digestIntervalMinutes };
}

async function replyOrEdit(ctx: Context, message: BotMessage, keyboard?: InlineKeyboard): Promise<void> {
  const text = messageText(message);
  const options = messageOptions(message, keyboard);
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalizedMessage = message.toLowerCase();
      if (normalizedMessage.includes("message is not modified")) {
        return;
      }
      if (
        !normalizedMessage.includes("message to edit not found") &&
        !normalizedMessage.includes("message can't be edited") &&
        !normalizedMessage.includes("message cannot be edited")
      ) {
        throw error;
      }
      await ctx.reply(text, options);
      return;
    }
  }
  await ctx.reply(text, options);
}

async function ensureTelegramUser(ctx: Context, db: Db): Promise<string> {
  const id = telegramId(ctx);
  await upsertTelegramUser(db, {
    telegramUserId: id,
    username: ctx.from?.username ?? null
  });
  return id;
}

async function answerCallbackQuerySafely(ctx: Context): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("query is too old")) return;
    throw error;
  }
}

async function replyWithCheck(
  input: string,
  ctx: { reply(text: string, options?: BotSendOptions): Promise<unknown> },
  tronClient: TronClient,
  db: Db
): Promise<void> {
  const classified = classifyInput(input);

  if (classified.kind === "tron_address") {
    const result = await checkAddress(classified.value, {
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
    });
    await sendMessage(ctx, formatManualReport(result.subjectAddress, result.report));
    return;
  }

  if (classified.kind === "tron_tx") {
    try {
      const result = await checkTransactionHash(classified.value, {
        tronClient,
        getLabelsForAddress: (address) => listAddressLabels(db, address),
        recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation)
      });
      await sendMessage(ctx, formatManualReport(result.subjectAddress, result.report));
    } catch (error) {
      console.error("Manual transaction check failed", error);
      await ctx.reply("Could not extract an official TRC20 USDT sender from this transaction.");
    }
    return;
  }

  await ctx.reply("Usage: /check <TRON-address-or-tx-hash>");
}

async function getOwnedWallet(db: Db, telegramUserId: string, walletId: string): Promise<WatchedWallet | null> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  return wallets.find((wallet) => wallet.id === walletId) ?? null;
}

async function buildWalletDashboard(
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  wallet: WatchedWallet,
  forceRefresh = false
) {
  return getWalletDashboard(
    {
      tronClient,
      config,
      getSnapshot: (watchedWalletId) => getWalletDashboardSnapshot(db, watchedWalletId),
      upsertSnapshot: (snapshot) => upsertWalletDashboardSnapshot(db, snapshot),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getPollState: (watchedWalletId) => getWalletPollState(db, watchedWalletId),
      getApprovalSummary: (watchedWalletId) => getWalletApprovalSummary(db, watchedWalletId)
    },
    { wallet, forceRefresh }
  );
}

async function showWalletDashboard(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  wallet: WatchedWallet,
  forceRefresh = false
): Promise<void> {
  const dashboard = await buildWalletDashboard(config, db, tronClient, wallet, forceRefresh);
  await replyOrEdit(ctx, dashboardMessage(dashboard), walletDashboardKeyboard(wallet.id));
}

async function showWalletList(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(ctx, walletsMessage(wallets.length), walletsKeyboard(wallets));
}

async function showSettings(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const recipients = await listCustomerAlertRecipients(db, telegramUserId);
  await replyOrEdit(ctx, settingsMessage(recipients), settingsKeyboard());
}

async function showProfile(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const wallets = await listWatchedWallets(db, telegramUserId);
  await replyOrEdit(
    ctx,
    profileMessage({
      telegramUserId,
      username: ctx.from?.username ?? null,
      walletCount: wallets.length
    }),
    profileKeyboard()
  );
}

async function showAlertAdmins(ctx: Context, db: Db, telegramUserId: string): Promise<void> {
  const recipients = await listCustomerAlertRecipients(db, telegramUserId);
  await replyOrEdit(ctx, alertAdminsMessage(recipients), alertAdminsKeyboard(recipients));
}

async function customerAlertRecipientExists(db: Db, ownerTelegramUserId: string, recipientTelegramUserId: string): Promise<boolean> {
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  return recipients.some((recipient) => recipient.recipientTelegramUserId === recipientTelegramUserId);
}

async function addAlertAdminAndShow(
  ctx: Context,
  db: Db,
  ownerTelegramUserId: string,
  text: string,
  defaultMode: CustomerAlertMode = "suspicious_only",
  options: { requireExisting?: boolean } = {}
): Promise<void> {
  const input = parseAlertAdminInput(text, ownerTelegramUserId, defaultMode);
  if ("error" in input) {
    await setTelegramUserPendingAction(db, { telegramUserId: ownerTelegramUserId, pendingAction: "add_alert_admin" });
    await ctx.reply(input.error, { reply_markup: cancelKeyboard() });
    return;
  }

  if (options.requireExisting && !(await customerAlertRecipientExists(db, ownerTelegramUserId, input.recipientTelegramUserId))) {
    await clearTelegramUserPendingAction(db, ownerTelegramUserId);
    await sendMessage(
      ctx,
      alertAdminNotFoundMessage(input.recipientTelegramUserId),
      alertAdminsKeyboard(await listCustomerAlertRecipients(db, ownerTelegramUserId))
    );
    return;
  }

  await addCustomerAlertRecipient(db, {
    ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId,
    alertMode: input.alertMode
  });
  await clearTelegramUserPendingAction(db, ownerTelegramUserId);
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  await sendMessage(
    ctx,
    combineMessages([
      alertAdminAddedMessage({ telegramUserId: input.recipientTelegramUserId, mode: input.alertMode }),
      alertAdminsMessage(recipients)
    ]),
    alertAdminsKeyboard(recipients)
  );
}

async function removeAlertAdminAndShow(
  ctx: Context,
  db: Db,
  ownerTelegramUserId: string,
  text: string
): Promise<void> {
  const input = parseAlertAdminRemoveInput(text, ownerTelegramUserId);
  if ("error" in input) {
    await setTelegramUserPendingAction(db, { telegramUserId: ownerTelegramUserId, pendingAction: "remove_alert_admin" });
    await ctx.reply(input.error, { reply_markup: cancelKeyboard() });
    return;
  }

  const removed = await removeCustomerAlertRecipient(db, {
    ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId
  });
  await clearTelegramUserPendingAction(db, ownerTelegramUserId);
  const recipients = await listCustomerAlertRecipients(db, ownerTelegramUserId);
  await sendMessage(
    ctx,
    combineMessages([
      removed ? alertAdminRemovedMessage(input.recipientTelegramUserId) : alertAdminNotFoundMessage(input.recipientTelegramUserId),
      alertAdminsMessage(recipients)
    ]),
    alertAdminsKeyboard(recipients)
  );
}

async function addWalletAndShowDashboard(
  ctx: Context,
  config: AppConfig,
  db: Db,
  tronClient: TronDashboardClient,
  telegramUserId: string,
  address: string
): Promise<void> {
  const wallet = await addWatchedWallet(db, { telegramUserId, address });
  await clearTelegramUserPendingAction(db, telegramUserId);
  await showWalletDashboard(ctx, config, db, tronClient, wallet);
}

export function createBot(config: AppConfig, db: Db, tronClient: TronDashboardClient & Partial<TronApprovalClient>): Bot {
  const bot = new Bot(config.botToken);

  bot.catch((error) => {
    console.error("Telegram bot update failed", error.error);
  });

  bot.command("start", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const wallets = await listWatchedWallets(db, id);
    await sendMessage(ctx, homeMessage(wallets.length), mainMenuKeyboard());
  });

  bot.command("help", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, helpMessage(), mainMenuKeyboard());
  });

  bot.command("settings", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showSettings(ctx, db, id);
  });

  bot.command("profile", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showProfile(ctx, db, id);
  });

  bot.command("my_id", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await sendMessage(ctx, myIdMessage({ telegramUserId: id, username: ctx.from?.username ?? null }), mainMenuKeyboard());
  });

  bot.command("alert_admins", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showAlertAdmins(ctx, db, id);
  });

  bot.command("alert_recipients", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showAlertAdmins(ctx, db, id);
  });

  bot.command("add_alert_admin", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_alert_admin" });
      await sendMessage(ctx, addAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("alert_add", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_alert_admin" });
      await sendMessage(ctx, addAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("remove_alert_admin", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await sendMessage(ctx, removeAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await removeAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("alert_remove", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    if (!input) {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await sendMessage(ctx, removeAlertAdminPrompt(), cancelKeyboard());
      return;
    }
    await removeAlertAdminAndShow(ctx, db, id, input);
  });

  bot.command("alert_mode", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = commandText(ctx.match);
    const parts = input.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length !== 2) {
      await clearTelegramUserPendingAction(db, id);
      await ctx.reply("Usage: /alert_mode <telegram-id> <suspicious|suspicious_only|all>", { reply_markup: alertAdminsKeyboard(await listCustomerAlertRecipients(db, id)) });
      return;
    }
    await addAlertAdminAndShow(ctx, db, id, input, "suspicious_only", { requireExisting: true });
  });

  bot.command("wallet_mode", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const input = parseWalletModeInput(commandText(ctx.match));
    if ("error" in input) {
      await ctx.reply(input.error);
      return;
    }

    const wallets = await listWatchedWallets(db, id);
    const wallet = wallets.find((item) => item.address === input.address);
    if (!wallet) {
      await ctx.reply(`Wallet not found: ${input.address}`, { reply_markup: mainMenuKeyboard() });
      return;
    }

    await updateWatchedWalletAlertMode(db, {
      telegramUserId: id,
      address: input.address,
      alertMode: input.alertMode,
      digestIntervalMinutes: input.digestIntervalMinutes
    });
    const updatedWallet = {
      ...wallet,
      alertMode: input.alertMode,
      digestIntervalMinutes: input.digestIntervalMinutes
    };
    await sendMessage(ctx, walletAlertModeUpdatedMessage(updatedWallet), walletAlertModeKeyboard(updatedWallet));
  });

  bot.command("add_wallet", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const input = classifyInput(commandText(ctx.match));

    if (input.kind !== "tron_address") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_wallet" });
      await sendMessage(ctx, addWalletPrompt(), cancelKeyboard());
      return;
    }

    await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value);
  });

  bot.command("wallets", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await showWalletList(ctx, db, id);
  });

  bot.command("remove_wallet", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    const input = classifyInput(commandText(ctx.match));
    if (input.kind !== "tron_address") {
      await ctx.reply("Usage: /remove_wallet <TRON-address>");
      return;
    }

    const removed = await removeWatchedWallet(db, { telegramUserId: id, address: input.value });
    await ctx.reply(removed ? `Removed wallet: ${input.value}` : `Wallet not found: ${input.value}`, {
      reply_markup: mainMenuKeyboard()
    });
  });

  bot.command("check", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    await replyWithCheck(commandText(ctx.match), ctx, tronClient, db);
  });

  bot.command("labels", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    await ctx.reply(ALLOWED_LABELS.map((label) => `- ${label}`).join("\n"));
  });

  bot.command("admin_users", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    const adminIds = [...config.serviceAdminTelegramIds].sort();
    await ctx.reply(adminIds.length ? adminIds.map((adminId) => `- ${adminId}`).join("\n") : "No service admins configured.");
  });

  bot.command("mark", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const args = commandText(ctx.match).split(/\s+/).filter((part) => part.length > 0);
    const [rawAddress, rawLabel] = args;
    const input = classifyInput(rawAddress ?? "");
    const label = rawLabel as RiskLabel;
    if (args.length !== 2 || input.kind !== "tron_address" || !allowedLabelSet.has(label)) {
      await ctx.reply("Usage: /mark <TRON-address> <label>");
      return;
    }

    await saveAddressLabel(db, {
      address: input.value,
      label,
      source: "service_admin",
      createdByTelegramId: id
    });
    await ctx.reply(`Marked ${input.value} as ${label}.`);
  });

  bot.command("recheck_safety", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    await clearTelegramUserPendingAction(db, id);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const args = commandText(ctx.match).split(/\s+/).filter((part) => part.length > 0);
    const walletInput = classifyInput(args[0] ?? "");
    if (args.length < 1 || args.length > 2 || walletInput.kind !== "tron_address") {
      await ctx.reply("Usage: /recheck_safety <wallet_address> [spender_or_approval_tx]");
      return;
    }

    const summary = await runSafetyRecheck({
      db,
      tronClient: tronClient as TronApprovalClient,
      walletAddress: walletInput.value,
      target: parseSafetyRecheckTarget(args[1]),
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet
    });
    await ctx.reply(formatSafetyRecheckSummary(summary));
  });

  bot.on("callback_query:data", async (ctx) => {
    const id = telegramId(ctx);
    await answerCallbackQuerySafely(ctx);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });

    const callback = parseCallbackData(ctx.callbackQuery.data);
    if (!callback) {
      await replyOrEdit(ctx, "Unknown action.", mainMenuKeyboard());
      return;
    }

    if (callback.kind === "home") {
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length), mainMenuKeyboard());
      return;
    }

    if (callback.kind === "help") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, helpMessage(), mainMenuKeyboard());
      return;
    }

    if (callback.kind === "profile") {
      await clearTelegramUserPendingAction(db, id);
      await showProfile(ctx, db, id);
      return;
    }

    if (callback.kind === "risk_overview") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, riskIntelOverviewMessage(), mainMenuKeyboard());
      return;
    }

    if (callback.kind === "wallets_list") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletList(ctx, db, id);
      return;
    }

    if (callback.kind === "wallet_add") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "add_wallet" });
      await replyOrEdit(ctx, addWalletPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "check_address") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_address" });
      await replyOrEdit(ctx, checkAddressPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "check_tx") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "check_tx" });
      await replyOrEdit(ctx, checkTxPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "check_address_value") {
      await clearTelegramUserPendingAction(db, id);
      await replyWithCheck(callback.address, ctx, tronClient, db);
      return;
    }

    if (callback.kind === "settings") {
      await clearTelegramUserPendingAction(db, id);
      await showSettings(ctx, db, id);
      return;
    }

    if (callback.kind === "settings_alerts") {
      await clearTelegramUserPendingAction(db, id);
      await showAlertAdmins(ctx, db, id);
      return;
    }

    if (callback.kind === "settings_add_admin") {
      const pendingAction =
        callback.alertMode === "all"
          ? "add_alert_admin_all"
          : callback.alertMode === "suspicious_only"
            ? "add_alert_admin_suspicious_only"
            : "add_alert_admin";
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction });
      await replyOrEdit(ctx, addAlertAdminPrompt(callback.alertMode ?? "suspicious_only"), cancelKeyboard());
      return;
    }

    if (callback.kind === "settings_remove_admin") {
      await setTelegramUserPendingAction(db, { telegramUserId: id, pendingAction: "remove_alert_admin" });
      await replyOrEdit(ctx, removeAlertAdminPrompt(), cancelKeyboard());
      return;
    }

    if (callback.kind === "settings_remove_admin_value") {
      await removeAlertAdminAndShow(ctx, db, id, callback.recipientTelegramUserId);
      return;
    }

    if (callback.kind === "cancel") {
      await clearTelegramUserPendingAction(db, id);
      const wallets = await listWatchedWallets(db, id);
      await replyOrEdit(ctx, homeMessage(wallets.length), mainMenuKeyboard());
      return;
    }

    const wallet = await getOwnedWallet(db, id, callback.walletId);
    if (!wallet) {
      await replyOrEdit(ctx, "Wallet not found.", mainMenuKeyboard());
      return;
    }

    if (callback.kind === "wallet_view") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletDashboard(ctx, config, db, tronClient, wallet);
      return;
    }

    if (callback.kind === "wallet_refresh") {
      await clearTelegramUserPendingAction(db, id);
      await showWalletDashboard(ctx, config, db, tronClient, wallet, true);
      return;
    }

    if (callback.kind === "wallet_analytics") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, analyticsMessage(dashboard), backToWalletKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_risk") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, securityMessage(dashboard), backToWalletKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_safety") {
      await clearTelegramUserPendingAction(db, id);
      const dashboard = await buildWalletDashboard(config, db, tronClient, wallet);
      await replyOrEdit(ctx, safetyMessage(dashboard), backToWalletKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_alert_mode") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, walletAlertModeMessage(wallet), walletAlertModeKeyboard(wallet));
      return;
    }

    if (callback.kind === "wallet_alert_mode_set") {
      await clearTelegramUserPendingAction(db, id);
      const digestIntervalMinutes =
        callback.alertMode === "digest" ? callback.digestIntervalMinutes : wallet.digestIntervalMinutes;
      await updateWatchedWalletAlertMode(db, {
        telegramUserId: id,
        address: wallet.address,
        alertMode: callback.alertMode,
        digestIntervalMinutes
      });
      await showWalletDashboard(ctx, config, db, tronClient, {
        ...wallet,
        alertMode: callback.alertMode,
        digestIntervalMinutes
      });
      return;
    }

    if (callback.kind === "wallet_remove") {
      await clearTelegramUserPendingAction(db, id);
      await replyOrEdit(ctx, removeConfirmMessage(wallet.address), walletRemoveKeyboard(wallet.id));
      return;
    }

    if (callback.kind === "wallet_remove_confirm") {
      await clearTelegramUserPendingAction(db, id);
      await removeWatchedWallet(db, { telegramUserId: id, address: wallet.address });
      await showWalletList(ctx, db, id);
    }
  });

  bot.on("message:text", async (ctx) => {
    const id = await ensureTelegramUser(ctx, db);
    const text = ctx.message.text.trim();
    const session = await getTelegramUserSession(db, id);

    if (shouldHandlePendingText(session, text)) {
      const input = classifyInput(text);

      if (session.pendingAction === "add_wallet") {
        if (input.kind !== "tron_address") {
          await ctx.reply("Send a valid TRON wallet address.", { reply_markup: cancelKeyboard() });
          return;
        }
        await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value);
        return;
      }

      if (session.pendingAction === "check_address") {
        if (input.kind !== "tron_address") {
          await ctx.reply("Send a valid TRON address.", { reply_markup: cancelKeyboard() });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await replyWithCheck(input.value, ctx, tronClient, db);
        return;
      }

      if (session.pendingAction === "check_tx") {
        if (input.kind !== "tron_tx") {
          await ctx.reply("Send a valid TRON transaction hash.", { reply_markup: cancelKeyboard() });
          return;
        }
        await clearTelegramUserPendingAction(db, id);
        await replyWithCheck(input.value, ctx, tronClient, db);
        return;
      }

      if (session.pendingAction === "add_alert_admin") {
        await addAlertAdminAndShow(ctx, db, id, text);
        return;
      }

      if (session.pendingAction === "add_alert_admin_all") {
        await addAlertAdminAndShow(ctx, db, id, text, "all");
        return;
      }

      if (session.pendingAction === "add_alert_admin_suspicious_only") {
        await addAlertAdminAndShow(ctx, db, id, text, "suspicious_only");
        return;
      }

      if (session.pendingAction === "remove_alert_admin") {
        await removeAlertAdminAndShow(ctx, db, id, text);
        return;
      }
    }

    const input = classifyInput(text);
    if (input.kind === "tron_address") {
      await addWalletAndShowDashboard(ctx, config, db, tronClient, id, input.value);
      return;
    }

    if (input.kind === "tron_tx") {
      await replyWithCheck(input.value, ctx, tronClient, db);
      return;
    }

    await ctx.reply("Send a TRON address to monitor it, or use /check <TRON-address-or-tx-hash>.", {
      reply_markup: mainMenuKeyboard()
    });
  });

  return bot;
}
