import { Bot } from "grammy";
import type { AppConfig } from "../config";
import { checkAddress, checkTransactionHash } from "../check/manualCheck";
import type { Db } from "../storage/db";
import {
  addWatchedWallet,
  listAddressLabels,
  listWatchedWallets,
  removeWatchedWallet,
  saveAddressLabel,
  upsertTelegramUser
} from "../storage/repositories";
import type { RiskLabel, RiskReport } from "../types";
import { classifyInput } from "../tron/address";
import type { TronClient } from "../tron/tronClient";

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

function telegramId(ctx: { from?: { id: number } }): string {
  if (!ctx.from?.id) throw new Error("Telegram user id is missing");
  return String(ctx.from.id);
}

function isServiceAdmin(config: AppConfig, id: string): boolean {
  return config.serviceAdminTelegramIds.has(id);
}

function formatManualReport(report: RiskReport): string {
  const reasons = report.reasons.length
    ? report.reasons.map((reason) => `- ${reason.message}`).join("\n")
    : "- no obvious risk signals found";

  return [`Risk: ${report.level} - ${report.score}/100`, "", "Reasons:", reasons].join("\n");
}

function commandText(value: string | undefined): string {
  return (value ?? "").trim();
}

async function replyWithCheck(
  input: string,
  ctx: { reply(text: string): Promise<unknown> },
  tronClient: TronClient,
  db: Db
): Promise<void> {
  const classified = classifyInput(input);

  if (classified.kind === "tron_address") {
    const result = await checkAddress(classified.value, {
      getLabelsForAddress: (address) => listAddressLabels(db, address)
    });
    await ctx.reply([`Subject: ${result.subjectAddress}`, formatManualReport(result.report)].join("\n"));
    return;
  }

  if (classified.kind === "tron_tx") {
    try {
      const result = await checkTransactionHash(classified.value, {
        tronClient,
        getLabelsForAddress: (address) => listAddressLabels(db, address)
      });
      await ctx.reply([`Subject: ${result.subjectAddress}`, formatManualReport(result.report)].join("\n"));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Could not check transaction.");
    }
    return;
  }

  await ctx.reply("Usage: /check <TRON-address-or-tx-hash>");
}

export function createBot(config: AppConfig, db: Db, tronClient: TronClient): Bot {
  const bot = new Bot(config.botToken);

  bot.command("start", async (ctx) => {
    const id = telegramId(ctx);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });
    await ctx.reply("Send a TRON address to enable 24/7 USDT monitoring, or use /check <address-or-tx>.");
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Commands:",
        "/add_wallet <TRON-address>",
        "/wallets",
        "/remove_wallet <TRON-address>",
        "/check <TRON-address-or-tx-hash>",
        "/settings"
      ].join("\n")
    );
  });

  bot.command("settings", async (ctx) => {
    await ctx.reply("Default alerts are enabled for every watched wallet. Extra alert recipients are not enabled in this MVP.");
  });

  bot.command("add_wallet", async (ctx) => {
    const id = telegramId(ctx);
    const input = classifyInput(commandText(ctx.match));
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });

    if (input.kind !== "tron_address") {
      await ctx.reply("Usage: /add_wallet <TRON-address>");
      return;
    }

    await addWatchedWallet(db, { telegramUserId: id, address: input.value });
    await ctx.reply(`Monitoring enabled for ${input.value}.`);
  });

  bot.command("wallets", async (ctx) => {
    const wallets = await listWatchedWallets(db, telegramId(ctx));
    if (wallets.length === 0) {
      await ctx.reply("No watched wallets yet. Send a TRON address to add one.");
      return;
    }
    await ctx.reply(wallets.map((wallet) => `- ${wallet.address}`).join("\n"));
  });

  bot.command("remove_wallet", async (ctx) => {
    const id = telegramId(ctx);
    const input = classifyInput(commandText(ctx.match));
    if (input.kind !== "tron_address") {
      await ctx.reply("Usage: /remove_wallet <TRON-address>");
      return;
    }

    const removed = await removeWatchedWallet(db, { telegramUserId: id, address: input.value });
    await ctx.reply(removed ? `Removed wallet: ${input.value}` : `Wallet not found: ${input.value}`);
  });

  bot.command("check", async (ctx) => {
    await replyWithCheck(commandText(ctx.match), ctx, tronClient, db);
  });

  bot.command("labels", async (ctx) => {
    const id = telegramId(ctx);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    await ctx.reply(ALLOWED_LABELS.map((label) => `- ${label}`).join("\n"));
  });

  bot.command("admin_users", async (ctx) => {
    const id = telegramId(ctx);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }
    const adminIds = [...config.serviceAdminTelegramIds].sort();
    await ctx.reply(adminIds.length ? adminIds.map((adminId) => `- ${adminId}`).join("\n") : "No service admins configured.");
  });

  bot.command("mark", async (ctx) => {
    const id = telegramId(ctx);
    if (!isServiceAdmin(config, id)) {
      await ctx.reply("This command is restricted to service admins.");
      return;
    }

    const [rawAddress, rawLabel] = commandText(ctx.match).split(/\s+/);
    const input = classifyInput(rawAddress ?? "");
    const label = rawLabel as RiskLabel;
    if (input.kind !== "tron_address" || !allowedLabelSet.has(label)) {
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

  bot.on("message:text", async (ctx) => {
    const id = telegramId(ctx);
    const input = classifyInput(ctx.message.text);
    await upsertTelegramUser(db, {
      telegramUserId: id,
      username: ctx.from?.username ?? null
    });

    if (input.kind === "tron_address") {
      await addWatchedWallet(db, { telegramUserId: id, address: input.value });
      await ctx.reply(`Monitoring enabled for ${input.value}.`);
      return;
    }

    if (input.kind === "tron_tx") {
      await replyWithCheck(input.value, ctx, tronClient, db);
      return;
    }

    await ctx.reply("Send a TRON address to monitor it, or use /check <TRON-address-or-tx-hash>.");
  });

  return bot;
}
