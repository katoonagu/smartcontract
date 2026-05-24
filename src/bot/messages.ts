import { formatApprovalAllowance } from "../approvals/amounts";
import {
  bold,
  bulletList,
  code,
  escapeHtml,
  formatRiskIcon,
  section,
  telegramHtmlMessage,
  type TelegramHtmlMessage
} from "../alerts/telegramHtml";
import type { CustomerAlertMode, CustomerAlertRecipient, ObservedApprovalDrainEvent, WalletApproval } from "../storage/repositories";
import type { WalletAlertMode, WatchedWallet } from "../types";
import type { WalletDashboard } from "../wallet/dashboard";
import { formatMicroUsdt, formatSunAsTrx } from "../wallet/dashboard";
import { shortAddress } from "./keyboards";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function msg(lines: Array<string | null | undefined>): TelegramHtmlMessage {
  return telegramHtmlMessage(lines);
}

function kv(label: string, value: string): string {
  return `${bold(label)}: ${value}`;
}

function riskBadge(level: WalletDashboard["safety"]["level"], score: number, suffix?: string): string {
  const details = suffix ? `${level}, ${suffix}` : level;
  return `${formatRiskIcon(level)} ${code(`${score}/100`)} (${escapeHtml(details)})`;
}

function formatInteger(value: number | string | null): string {
  if (value === null) return "unknown";
  const text = String(value);
  if (!/^\d+$/.test(text)) return "unknown";
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatDecimal(value: string, minFractionDigits = 2, maxFractionDigits = 2): string {
  const [rawWhole, rawFraction = ""] = value.split(".");
  const whole = (rawWhole.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  let fraction = rawFraction.padEnd(minFractionDigits, "0").slice(0, maxFractionDigits);

  if (maxFractionDigits > minFractionDigits) {
    fraction = fraction.replace(/0+$/, "");
    if (fraction.length < minFractionDigits) fraction = fraction.padEnd(minFractionDigits, "0");
  }

  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function formatRelativeTime(date: Date | null, now = new Date()): string {
  if (!date) return "never";
  const diff = Math.max(0, now.getTime() - date.getTime());
  if (diff < MS_PER_MINUTE) return "just now";
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)} min ago`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)} h ago`;
  return `${Math.floor(diff / MS_PER_DAY)} d ago`;
}

function formatWalletAge(walletCreatedAt: Date | null, now = new Date()): string {
  if (!walletCreatedAt) return "unknown";
  const days = Math.max(0, Math.floor((now.getTime() - walletCreatedAt.getTime()) / MS_PER_DAY));
  return days === 1 ? "1 day" : `${days} days`;
}

function formatLastResult(dashboard: WalletDashboard): string {
  if (!dashboard.pollState) return "not checked yet";
  if (dashboard.pollState.lastPollError) return "poll error";
  if (dashboard.pollState.lastPollNewCount > 0) {
    return `${dashboard.pollState.lastPollNewCount} new transfer${dashboard.pollState.lastPollNewCount === 1 ? "" : "s"}`;
  }
  if (dashboard.pollState.lastSuccessfulPollAt) return "no new transfers";
  return "not checked yet";
}

function formatFeeUsd(dashboard: WalletDashboard): string | null {
  if (!dashboard.snapshot.trxUsdPrice) return null;
  const feeTrx = Number(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun));
  const trxUsd = Number(dashboard.snapshot.trxUsdPrice);
  if (!Number.isFinite(feeTrx) || !Number.isFinite(trxUsd)) return null;
  return formatDecimal((feeTrx * trxUsd).toFixed(2), 2, 2);
}

function shouldShowEnergyHint(dashboard: WalletDashboard): boolean {
  const feeTrx = Number(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun));
  return Number.isFinite(feeTrx) && feeTrx >= 50;
}

function formatRiskReasons(dashboard: WalletDashboard): string {
  return bulletList(
    dashboard.safety.reasons.map((reason) => reason.message),
    "No active risk reasons from connected modules."
  );
}

function formatRiskModules(dashboard: WalletDashboard): string {
  return bulletList(dashboard.safety.modules.map((module) => `${module.label}: ${module.status.replace("_", " ")}`));
}

function formatWalletSafetyStatus(dashboard: WalletDashboard): string {
  if (dashboard.approvalSummary.highRiskDrainObservationCount > 0) {
    return `🔴 warning (${dashboard.approvalSummary.highRiskDrainObservationCount} post-approval outflow${dashboard.approvalSummary.highRiskDrainObservationCount === 1 ? "" : "s"})`;
  }
  if (dashboard.approvalSummary.highRiskApprovalCount > 0) {
    return `🟠 warning (${dashboard.approvalSummary.highRiskApprovalCount} risky approval${dashboard.approvalSummary.highRiskApprovalCount === 1 ? "" : "s"})`;
  }
  if (dashboard.approvalSummary.unlimitedApprovalCount > 0) {
    return `🟡 review (${dashboard.approvalSummary.unlimitedApprovalCount} unlimited approval${dashboard.approvalSummary.unlimitedApprovalCount === 1 ? "" : "s"})`;
  }
  return "🟢 OK";
}

function formatApprovalAge(date: Date | null): string {
  return formatRelativeTime(date, new Date());
}

function formatRiskyApprovalRows(approvals: WalletApproval[]): string {
  if (approvals.length === 0) return "\u2022 none";
  return approvals
    .slice(0, 5)
    .map((approval) => {
      const allowance = formatApprovalAllowance({
        amountRaw: approval.currentAllowanceRaw,
        isUnlimited: approval.isUnlimited
      });
      const allowanceText = approval.isUnlimited ? allowance : `finite ${allowance}`;
      const identity = approval.metadataName ?? approval.metadataTag ?? "unknown";
      const type = approval.metadataIsContract === true
        ? "contract"
        : approval.metadataIsContract === false
          ? "wallet"
          : approval.spenderType;
      const intel = approval.metadataIsContract === true
        ? `\n  ${kv("Intel", `${escapeHtml(approval.contractServiceTag ?? "no service tag")}, ${escapeHtml(approval.contractVerified === true ? "verified" : "not verified")}, ${escapeHtml(approval.contractActivityLevel ?? "unknown")}`)}`
        : "";
      const sessionLinked = approval.riskReasons.some((reason) => reason.code === "approval_temporally_linked_to_known_swap");
      const sessionText = sessionLinked ? `\n  ${kv("Session", "linked to swap/bridge route")}` : "";
      const contextText = formatApprovalContextStatus(approval);
      return [
        `\u2022 ${bold("USDT")} ${escapeHtml(identity)} · ${formatRiskIcon(approval.riskLevel)} ${bold(`${approval.riskLevel} ${approval.riskScore}/100`)}`,
        `  ${kv("Spender", code(approval.spenderAddress))}`,
        `  ${kv("Type", escapeHtml(type))}`,
        `  ${kv("Allowance", code(allowanceText))}`,
        `  ${kv("Last", escapeHtml(formatApprovalAge(approval.lastApprovalAt)))}${intel}${sessionText}${contextText ? `\n  ${contextText}` : ""}`
      ].join("\n");
    })
    .join("\n");
}

function formatApprovalContextStatus(approval: WalletApproval): string | null {
  const status = approval.approvalContextStatus ?? null;
  if (!status || status === "not_needed") return null;
  const result = approval.approvalContextResult && approval.approvalContextResult !== "unknown"
    ? ` / ${approval.approvalContextResult.replace(/_/g, " ")}`
    : "";
  const label = status === "pending"
    ? "⏳ pending"
    : status === "finalizing"
      ? "⏳ finalizing"
      : status === "resolved"
        ? "✅ resolved"
        : "⌛ expired";
  return kv("Context", escapeHtml(`${label}${result}`));
}

function formatContractIntelligenceRows(approvals: WalletApproval[]): string {
  const contractApprovals = approvals.filter((approval) => approval.metadataIsContract === true).slice(0, 3);
  if (contractApprovals.length === 0) return "\u2022 none";
  return contractApprovals
    .map((approval) => {
      const methods = approval.contractTopMethods.slice(0, 2).map((method) => method.method).join(", ");
      const summary = [
        approval.contractServiceTag ?? "no service tag",
        approval.contractVerified === true ? "verified" : "not verified",
        approval.contractActivityLevel ?? "unknown"
      ].join(", ");
      return `\u2022 ${code(approval.spenderAddress)}\n  ${escapeHtml(summary)}${methods ? `\n  ${kv("Methods", code(methods))}` : ""}`;
    })
    .join("\n");
}

function formatApprovalDrainRows(observations: ObservedApprovalDrainEvent[]): string {
  if (observations.length === 0) return "\u2022 none";
  return observations
    .slice(0, 5)
    .map((observation) => {
      const amount = formatApprovalAllowance({ amountRaw: observation.amountRaw, isUnlimited: false });
      return [
        `\u2022 ${bold(`${observation.riskLevel} ${observation.riskScore}/100`)}`,
        `  ${kv("Spender", code(observation.spenderAddress))}`,
        `  ${kv("Receiver", code(observation.receiverAddress))}`,
        `  ${kv("Amount", code(amount))}`,
        `  ${kv("Seen", escapeHtml(formatApprovalAge(observation.transferAt)))}`
      ].join("\n");
    })
    .join("\n");
}

function dataStatus(dashboard: WalletDashboard): string | null {
  if (dashboard.source === "cache" || dashboard.source === "fresh") return null;
  if (dashboard.source === "stale") return "Dashboard data: stale";
  return "Dashboard data: unavailable";
}

function formatAlertMode(mode: CustomerAlertMode): string {
  return mode === "all" ? "all incoming alerts" : "MEDIUM/HIGH/CRITICAL alerts only";
}

export function formatWalletAlertMode(mode: WalletAlertMode, digestIntervalMinutes = 10): string {
  switch (mode) {
    case "realtime":
      return "realtime";
    case "risk_only":
      return "risk only";
    case "digest":
      return `digest ${digestIntervalMinutes}m`;
    case "paused":
      return "paused";
  }
}

export function homeMessage(walletCount: number): TelegramHtmlMessage {
  return msg([
    bold("\u{1F6E1} TRON Guard"),
    [
      "Мониторинг TRON / USDT wallets",
      kv("Watched wallets", code(String(walletCount))),
      kv("Risk checks", "limited beta"),
      kv("Approvals", "USDT Approval Guard"),
      kv("Alerts", "incoming USDT + risk reasons")
    ].join("\n"),
    "\u{1F512} Read-only: bot never signs transactions and never asks for seed/private key.",
    "Выберите действие ниже."
  ]);
}

export function helpMessage(): TelegramHtmlMessage {
  return msg([
    bold("\u{1F6E1} TRON Guard help"),
    section("Что делает бот", [
      bulletList([
        "monitor TRON wallets 24/7",
        "send incoming USDT alerts",
        "show wallet analytics and Safety",
        "track USDT approvals",
        "calculate limited beta risk score"
      ])
    ]),
    section("Risk modules", [
      bulletList([
        "Active: incoming monitor, internal labels",
        "Limited beta: wallet activity, USDT Approval Guard",
        "Planned: Hop1/Hop2 graph, behavioral patterns, bridge tracing, case forensics",
        "Not connected: AML providers"
      ])
    ]),
    "\u{1F512} No wallet control. No private keys.",
    `${bold("Commands")}: ${code("/add_wallet")}, ${code("/wallets")}, ${code("/check")}, ${code("/settings")}, ${code("/profile")}, ${code("/my_id")}.`
  ]);
}

export function riskIntelOverviewMessage(): TelegramHtmlMessage {
  return msg([
    bold("\u{1F6E1} Risk intelligence"),
    section("Active", [
      bulletList(["Internal labels: active", "Incoming monitor: active"])
    ]),
    section("Limited beta", [
      bulletList(["Wallet activity: limited", "USDT approvals: limited"])
    ]),
    section("Planned", [
      bulletList([
        "Hop1/Hop2 graph: planned",
        "Behavioral patterns: planned",
        "Bridge tracing: planned",
        "Case forensics: planned"
      ])
    ]),
    section("Not connected", [
      bulletList(["AML providers: not connected"])
    ]),
    "Risk score is limited beta. Planned modules do not affect score yet."
  ]);
}

export function walletsMessage(walletCount: number): TelegramHtmlMessage {
  if (walletCount === 0) {
    return msg([
      bold("\u{1F4C1} My wallets"),
      "No watched wallets yet.",
      "Add a TRON wallet to enable monitoring."
    ]);
  }
  return msg([bold("\u{1F4C1} My wallets"), kv("Watched wallets", code(String(walletCount)))]);
}

export function dashboardMessage(dashboard: WalletDashboard, now = new Date()): TelegramHtmlMessage {
  const statusLine = dataStatus(dashboard);
  const feeUsd = formatFeeUsd(dashboard);
  const feeText = `${formatDecimal(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun), 2, 2)} TRX${
    feeUsd ? ` (~$${feeUsd})` : ""
  }`;
  return msg([
    bold("\u{1F4CD} Wallet dashboard"),
    [
      kv("Wallet", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
      kv("Monitoring", "active"),
      kv("Last check", escapeHtml(formatRelativeTime(dashboard.pollState?.lastSuccessfulPollAt ?? null, now))),
      kv("Last result", escapeHtml(formatLastResult(dashboard))),
      kv("Alerts", escapeHtml(formatWalletAlertMode(dashboard.wallet.alertMode, dashboard.wallet.digestIntervalMinutes)))
    ].join("\n"),
    [
      kv("Risk", riskBadge(dashboard.safety.level, dashboard.safety.score, "beta")),
      kv("Wallet safety", escapeHtml(formatWalletSafetyStatus(dashboard))),
      kv("USDT", code(formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2))),
      kv("TRX", code(formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)))
    ].join("\n"),
    section("30d flow", [
      bulletList([
        `In: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
        `Out: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
        `Gas/fees: ${feeText}`
      ])
    ]),
    kv("Wallet age", escapeHtml(formatWalletAge(dashboard.snapshot.walletCreatedAt, now))),
    dashboard.snapshot.analyticsPartial ? "Analytics: partial" : null,
    statusLine ? escapeHtml(statusLine) : null
  ]);
}

export function analyticsMessage(dashboard: WalletDashboard, now = new Date()): TelegramHtmlMessage {
  const feeUsd = formatFeeUsd(dashboard);
  return msg([
    bold("\u{1F4CA} Wallet analytics"),
    kv("Wallet", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
    section("Balances", [
      bulletList([
        `USDT: ${formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2)}`,
        `TRX: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)}`,
        `Wallet age: ${formatWalletAge(dashboard.snapshot.walletCreatedAt, now)}`
      ])
    ]),
    section("30d flow", [
      bulletList([
        `In: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
        `Out: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
        `Transfers: ${formatInteger(dashboard.snapshot.thirtyDayTransferCount)}`,
        `Gas/fees: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun), 2, 2)} TRX${feeUsd ? ` (~$${feeUsd})` : ""}`
      ])
    ]),
    section("Tx counts", [
      bulletList([
        `Total: ${formatInteger(dashboard.snapshot.totalTxCount)}`,
        `Incoming: ${formatInteger(dashboard.snapshot.incomingTxCount)}`,
        `Outgoing: ${formatInteger(dashboard.snapshot.outgoingTxCount)}`
      ])
    ]),
    [
      kv("Updated", escapeHtml(formatRelativeTime(dashboard.snapshot.refreshedAt, now))),
      kv("Data quality", escapeHtml(dashboard.snapshot.analyticsPartial ? "partial" : "full"))
    ].join("\n"),
    shouldShowEnergyHint(dashboard) ? "Energy hint: high 30d fees; TRON energy/bandwidth savings may be worth checking." : null
  ]);
}

export function securityMessage(dashboard: WalletDashboard): TelegramHtmlMessage {
  return msg([
    bold("\u{1F6E1} Risk intelligence"),
    kv("Wallet", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
    [
      kv("Current score", riskBadge(dashboard.safety.level, dashboard.safety.score, "beta")),
      kv("Confidence", "limited beta")
    ].join("\n"),
    section("Reasons", [formatRiskReasons(dashboard)]),
    section("Modules", [formatRiskModules(dashboard)]),
    "Score includes connected limited-beta modules only. AML, graph proximity, bridge tracing, and case forensics are not connected yet."
  ]);
}

export function safetyMessage(dashboard: WalletDashboard): TelegramHtmlMessage {
  return msg([
    bold("\u{1F6E1} Wallet safety"),
    kv("Wallet", `${escapeHtml(shortAddress(dashboard.wallet.address))} ${code(dashboard.wallet.address)}`),
    [
      kv("Status", escapeHtml(formatWalletSafetyStatus(dashboard))),
      kv("USDT approvals", code(String(dashboard.approvalSummary.usdtApprovalCount))),
      kv("Unlimited approvals", code(String(dashboard.approvalSummary.unlimitedApprovalCount))),
      kv("Risky approvals", code(String(dashboard.approvalSummary.highRiskApprovalCount))),
      kv("Post-approval outflows", code(String(dashboard.approvalSummary.drainObservationCount)))
    ].join("\n"),
    section("Top approvals", [formatRiskyApprovalRows(dashboard.approvalSummary.topRiskyApprovals)]),
    section("Contract intelligence", [formatContractIntelligenceRows(dashboard.approvalSummary.topRiskyApprovals)]),
    section("Shadow observations", [formatApprovalDrainRows(dashboard.approvalSummary.topDrainObservations)]),
    section("Revoke guide", [
      "1. Open TronScan approvals.",
      "2. Connect TronLink with the watched wallet.",
      "3. Find USDT approval for the spender.",
      "4. Cancel approval if unexpected."
    ]),
    "\u{1F512} Bot is read-only. It never signs transactions and never asks for seed/private key."
  ]);
}

export function walletAlertModeMessage(wallet: WatchedWallet): TelegramHtmlMessage {
  return msg([
    bold("\u{1F514} Alert mode"),
    kv("Wallet", `${escapeHtml(shortAddress(wallet.address))} ${code(wallet.address)}`),
    kv("Current", escapeHtml(formatWalletAlertMode(wallet.alertMode, wallet.digestIntervalMinutes))),
    section("Modes", [
      bulletList([
        "Realtime: every incoming USDT tx.",
        "Risk only: only MEDIUM/HIGH/CRITICAL.",
        "Digest: risky tx immediately, LOW tx grouped every 10 minutes.",
        "Paused: save evidence without owner alerts."
      ])
    ])
  ]);
}

export function walletAlertModeUpdatedMessage(wallet: WatchedWallet): TelegramHtmlMessage {
  return msg([
    bold("\u{1F514} Alert mode updated"),
    `${escapeHtml(shortAddress(wallet.address))} ${code(wallet.address)} -> ${escapeHtml(formatWalletAlertMode(wallet.alertMode, wallet.digestIntervalMinutes))}`
  ]);
}

export function addWalletPrompt(): TelegramHtmlMessage {
  return msg([
    bold("\u2795 Add wallet"),
    "Отправьте TRON wallet address для 24/7 monitoring.",
    `${bold("Format")}: ${code("T...")}`
  ]);
}

export function checkAddressPrompt(): TelegramHtmlMessage {
  return msg([
    bold("\u{1F50E} Check address"),
    "Отправьте TRON address для risk score + reasons.",
    "Адрес не будет добавлен в monitoring."
  ]);
}

export function checkTxPrompt(): TelegramHtmlMessage {
  return msg([
    bold("\u{1F9FE} Check tx"),
    "Отправьте TRON transaction hash.",
    "Бот проверит sender и покажет limited beta risk."
  ]);
}

export function settingsMessage(recipients: CustomerAlertRecipient[] = []): TelegramHtmlMessage {
  return msg([
    bold("\u2699\uFE0F Settings"),
    [
      kv("Owner alerts", "per wallet alert mode"),
      kv("Service admins", "HIGH / CRITICAL safety events"),
      kv("Alert admins", code(String(recipients.length))),
      kv("Language", "RU / EN mixed")
    ].join("\n"),
    "\u{1F512} Read-only: bot never signs transactions, never asks for seed/private key."
  ]);
}

export function removeConfirmMessage(address: string): TelegramHtmlMessage {
  return msg([
    bold("\u{1F5D1} Remove wallet"),
    `Остановить monitoring для ${code(address)}?`,
    "Saved observations останутся в базе."
  ]);
}

export function myIdMessage(input: { telegramUserId: string; username: string | null }): TelegramHtmlMessage {
  return msg([
    bold("\u{1F194} Your Telegram identity"),
    [
      kv("Telegram ID", code(input.telegramUserId)),
      kv("Username", input.username ? `@${escapeHtml(input.username)}` : "not set")
    ].join("\n"),
    "Этот ID можно добавить как customer alert admin."
  ]);
}

export function profileMessage(input: { telegramUserId: string; username: string | null; walletCount: number }): TelegramHtmlMessage {
  return msg([
    bold("\u{1F464} Profile"),
    [
      kv("User", input.username ? `@${escapeHtml(input.username)}` : "no username"),
      kv("Telegram ID", code(input.telegramUserId)),
      kv("Watched wallets", code(String(input.walletCount))),
      kv("Language", "RU / EN")
    ].join("\n"),
    `Для подключения alert admin используйте ${code("/my_id")}.`
  ]);
}

export function alertAdminsMessage(recipients: CustomerAlertRecipient[]): TelegramHtmlMessage {
  if (recipients.length === 0) {
    return msg([
      bold("\u{1F465} Alert admins"),
      "No customer alert admins configured.",
      "Owner получает alerts по wallet mode. Extra admins получают best-effort copies."
    ]);
  }

  return msg([
    bold("\u{1F465} Alert admins"),
    bulletList(recipients.map((recipient) => `${recipient.recipientTelegramUserId} - ${formatAlertMode(recipient.alertMode)}`)),
    "Owner получает alerts по wallet mode. Extra admins получают best-effort copies."
  ]);
}

export function addAlertAdminPrompt(defaultMode: CustomerAlertMode = "suspicious_only"): TelegramHtmlMessage {
  return msg([
    bold("\u2795 Add alert admin"),
    "Отправьте Telegram ID для customer alert admin.",
    [
      kv("Format", code("<telegram_id> <mode>")),
      kv("Modes", `${code("suspicious")}, ${code("suspicious_only")}, ${code("all")}`),
      kv("Default", code(defaultMode === "all" ? "all" : "suspicious_only"))
    ].join("\n")
  ]);
}

export function removeAlertAdminPrompt(): TelegramHtmlMessage {
  return msg([bold("\u2796 Remove alert admin"), "Отправьте Telegram ID, который нужно удалить."]);
}

export function alertAdminAddedMessage(input: { telegramUserId: string; mode: CustomerAlertMode }): TelegramHtmlMessage {
  return msg([bold("Alert admin saved"), `${code(input.telegramUserId)} - ${escapeHtml(formatAlertMode(input.mode))}`]);
}

export function alertAdminRemovedMessage(telegramUserId: string): TelegramHtmlMessage {
  return msg([bold("Alert admin removed"), code(telegramUserId)]);
}

export function alertAdminNotFoundMessage(telegramUserId: string): TelegramHtmlMessage {
  return msg([bold("Customer alert admin not found"), code(telegramUserId)]);
}
