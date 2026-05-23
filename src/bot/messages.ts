import type { WalletDashboard } from "../wallet/dashboard";
import { formatMicroUsdt, formatSunAsTrx } from "../wallet/dashboard";
import { formatApprovalAllowance } from "../approvals/amounts";
import type { CustomerAlertMode, CustomerAlertRecipient, WalletApproval } from "../storage/repositories";
import type { WalletAlertMode, WatchedWallet } from "../types";
import { shortAddress } from "./keyboards";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

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
    if (fraction.length < minFractionDigits) {
      fraction = fraction.padEnd(minFractionDigits, "0");
    }
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

function formatReasons(dashboard: WalletDashboard): string {
  if (dashboard.safety.reasons.length === 0) return "- no obvious risk signals found";
  return dashboard.safety.reasons.map((reason) => `- ${reason.message}`).join("\n");
}

function formatRiskIntelligenceReasons(dashboard: WalletDashboard): string {
  if (dashboard.safety.reasons.length === 0) return "- No active risk reasons from connected modules.";
  return dashboard.safety.reasons.map((reason) => `- ${reason.message}`).join("\n");
}

function formatRiskModules(dashboard: WalletDashboard): string {
  return dashboard.safety.modules.map((module) => `- ${module.label}: ${module.status.replace("_", " ")}`).join("\n");
}

function formatWalletSafetyStatus(dashboard: WalletDashboard): string {
  if (dashboard.approvalSummary.highRiskApprovalCount > 0) {
    return `warning (${dashboard.approvalSummary.highRiskApprovalCount} risky approval${dashboard.approvalSummary.highRiskApprovalCount === 1 ? "" : "s"})`;
  }
  if (dashboard.approvalSummary.unlimitedApprovalCount > 0) {
    return `review (${dashboard.approvalSummary.unlimitedApprovalCount} unlimited approval${dashboard.approvalSummary.unlimitedApprovalCount === 1 ? "" : "s"})`;
  }
  return "OK";
}

function formatApprovalAge(date: Date | null): string {
  return formatRelativeTime(date, new Date());
}

function formatRiskyApprovalRows(approvals: WalletApproval[]): string {
  if (approvals.length === 0) return "- none";
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
      return `- USDT ${identity} / ${shortAddress(approval.spenderAddress)} ${approval.riskLevel} ${approval.riskScore}/100, ${type}, ${allowanceText}, last ${formatApprovalAge(approval.lastApprovalAt)}`;
    })
    .join("\n");
}

function dataStatus(dashboard: WalletDashboard): string | null {
  if (dashboard.source === "cache") return null;
  if (dashboard.source === "fresh") return null;
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

export function homeMessage(walletCount: number): string {
  return [
    "🛡 TRON Guard",
    "",
    "Мониторинг TRON / USDT",
    `📁 Watched wallets: ${walletCount}`,
    "⚠️ Risk checks: limited beta",
    "🔔 Alerts: incoming USDT + risk reasons",
    "",
    "Выберите действие ниже."
  ].join("\n");
}

export function helpMessage(): string {
  return [
    "🛡 TRON Guard",
    "",
    "Что умеет бот:",
    "• мониторит TRON wallets",
    "• присылает incoming USDT alerts",
    "• показывает wallet analytics",
    "• считает limited beta risk score",
    "",
    "Risk score is limited beta: USDT approvals are limited; AML, graph, bridge tracing, and case forensics are planned modules.",
    "",
    "No wallet control. No private keys.",
    "",
    "Commands: /add_wallet, /wallets, /check, /settings, /profile, /my_id."
  ].join("\n");
}

export function riskIntelOverviewMessage(): string {
  return [
    "⚠️ Risk intelligence",
    "",
    "Active modules:",
    "• Internal labels: active",
    "• Wallet activity: limited",
    "• Incoming monitor: active",
    "",
    "Planned / not connected:",
    "• AML providers: not connected",
    "• Hop1/Hop2 graph: planned",
    "• Behavioral patterns: planned",
    "• Approvals/security: limited",
    "• Bridge tracing: planned",
    "• Case forensics: planned",
    "",
    "Risk score is limited beta. Planned modules do not affect score yet."
  ].join("\n");
}

export function walletsMessage(walletCount: number): string {
  if (walletCount === 0) {
    return "No watched wallets yet. Add a TRON wallet to enable monitoring.";
  }
  return `My wallets: ${walletCount}`;
}

export function dashboardMessage(dashboard: WalletDashboard, now = new Date()): string {
  const statusLine = dataStatus(dashboard);
  const feeUsd = formatFeeUsd(dashboard);
  const feeText = `${formatDecimal(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun), 2, 2)} TRX${
    feeUsd ? ` (~$${feeUsd})` : ""
  }`;
  const lines = [
    `📍 Wallet: ${shortAddress(dashboard.wallet.address)}`,
    "🟢 Monitoring: active",
    `🕒 Last check: ${formatRelativeTime(dashboard.pollState?.lastSuccessfulPollAt ?? null, now)}`,
    `📡 Last result: ${formatLastResult(dashboard)}`,
    `🔔 Alerts: ${formatWalletAlertMode(dashboard.wallet.alertMode, dashboard.wallet.digestIntervalMinutes)}`,
    "",
    `⚠️ Risk: ${dashboard.safety.score}/100 (${dashboard.safety.level}, beta)`,
    `🛡 Wallet safety: ${formatWalletSafetyStatus(dashboard)}`,
    `💵 USDT: ${formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2)}`,
    `🔋 TRX: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)}`,
    "",
    `📅 Wallet age: ${formatWalletAge(dashboard.snapshot.walletCreatedAt, now)}`,
    "📊 30d flow:",
    `• In: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
    `• Out: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
    `⛽ Gas/fees 30d: ${feeText}`
  ];

  if (dashboard.snapshot.analyticsPartial) {
    lines.push("Analytics: partial");
  }
  if (statusLine) {
    lines.push(statusLine);
  }

  return lines.join("\n");
}

export function analyticsMessage(dashboard: WalletDashboard, now = new Date()): string {
  const feeUsd = formatFeeUsd(dashboard);
  const lines = [
    `Analytics for ${shortAddress(dashboard.wallet.address)}`,
    "",
    `USDT balance: ${formatDecimal(formatMicroUsdt(dashboard.snapshot.usdtBalanceMicro), 2, 2)}`,
    `TRX balance: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.trxBalanceSun), 2, 2)}`,
    `Wallet age: ${formatWalletAge(dashboard.snapshot.walletCreatedAt, now)}`,
    "",
    "30d flow:",
    `In: ${formatDecimal(dashboard.snapshot.thirtyDayInUsdt, 2, 2)} USDT`,
    `Out: ${formatDecimal(dashboard.snapshot.thirtyDayOutUsdt, 2, 2)} USDT`,
    `Transfers: ${formatInteger(dashboard.snapshot.thirtyDayTransferCount)}`,
    `Gas/fees: ${formatDecimal(formatSunAsTrx(dashboard.snapshot.thirtyDayFeeSun), 2, 2)} TRX${
      feeUsd ? ` (~$${feeUsd})` : ""
    }`,
    "",
    "Tx counts:",
    `Total: ${formatInteger(dashboard.snapshot.totalTxCount)}`,
    `Incoming: ${formatInteger(dashboard.snapshot.incomingTxCount)}`,
    `Outgoing: ${formatInteger(dashboard.snapshot.outgoingTxCount)}`,
    "",
    `Updated: ${formatRelativeTime(dashboard.snapshot.refreshedAt, now)}`,
    `Data quality: ${dashboard.snapshot.analyticsPartial ? "partial" : "full"}`
  ];

  if (shouldShowEnergyHint(dashboard)) {
    lines.push("", "Energy hint: high 30d fees; TRON energy/bandwidth savings may be worth checking.");
  }

  return lines.join("\n");
}

export function securityMessage(dashboard: WalletDashboard): string {
  return [
    `⚠️ Risk intelligence: ${shortAddress(dashboard.wallet.address)}`,
    "",
    `Current score: ${dashboard.safety.score}/100 (${dashboard.safety.level})`,
    "Confidence: limited beta",
    "",
    "Reasons:",
    formatRiskIntelligenceReasons(dashboard),
    "",
    "Modules:",
    formatRiskModules(dashboard),
    "",
    "Score includes connected limited-beta modules only. AML providers, graph proximity, bridge tracing, and case forensics are not connected yet."
  ].join("\n");
}

export function safetyMessage(dashboard: WalletDashboard): string {
  return [
    `🛡 Wallet safety: ${shortAddress(dashboard.wallet.address)}`,
    "",
    `Status: ${formatWalletSafetyStatus(dashboard)}`,
    `USDT approvals: ${dashboard.approvalSummary.usdtApprovalCount}`,
    `Unlimited approvals: ${dashboard.approvalSummary.unlimitedApprovalCount}`,
    `Risky approvals: ${dashboard.approvalSummary.highRiskApprovalCount}`,
    "",
    "Top risky spenders:",
    formatRiskyApprovalRows(dashboard.approvalSummary.topRiskyApprovals),
    "",
    "Revoke guide:",
    "1. Open TronScan approvals.",
    "2. Connect TronLink with the watched wallet.",
    "3. Find USDT approval for the spender.",
    "4. Cancel approval if unexpected.",
    "",
    "Bot is read-only. It never signs transactions and never asks for seed/private key."
  ].join("\n");
}

export function walletAlertModeMessage(wallet: WatchedWallet): string {
  return [
    "🔔 Alert mode",
    "",
    `Wallet: ${shortAddress(wallet.address)}`,
    `Current: ${formatWalletAlertMode(wallet.alertMode, wallet.digestIntervalMinutes)}`,
    "",
    "Realtime: every incoming USDT tx.",
    "Risk only: only MEDIUM/HIGH/CRITICAL.",
    "Digest: risky tx immediately, LOW tx grouped every 10 minutes.",
    "Paused: save evidence without owner alerts."
  ].join("\n");
}

export function walletAlertModeUpdatedMessage(wallet: WatchedWallet): string {
  return `Alert mode updated: ${shortAddress(wallet.address)} -> ${formatWalletAlertMode(wallet.alertMode, wallet.digestIntervalMinutes)}.`;
}

export function addWalletPrompt(): string {
  return "Send a TRON wallet address to add monitoring.";
}

export function checkAddressPrompt(): string {
  return "Send a TRON address to check risk score and reasons.";
}

export function checkTxPrompt(): string {
  return "Send a TRON transaction hash to check the sender.";
}

export function settingsMessage(recipients: CustomerAlertRecipient[] = []): string {
  return [
    "⚙️ Settings",
    "",
    "🔔 Owner alerts: all incoming",
    "🛡 Service admins: HIGH / CRITICAL",
    `👥 Alert admins: ${recipients.length}`,
    "🌐 Language: RU / EN mixed",
    "",
    "Бот read-only: не просит seed/private key и не подписывает транзакции."
  ].join("\n");
}

export function removeConfirmMessage(address: string): string {
  return `Remove monitoring for ${shortAddress(address)}?`;
}

export function myIdMessage(input: { telegramUserId: string; username: string | null }): string {
  return [
    "Your Telegram identity",
    "",
    `Telegram ID: ${input.telegramUserId}`,
    `Username: ${input.username ? `@${input.username}` : "not set"}`,
    "",
    "Share this ID with the wallet owner if they need to add you as a customer alert admin."
  ].join("\n");
}

export function profileMessage(input: { telegramUserId: string; username: string | null; walletCount: number }): string {
  return [
    "👤 Profile",
    "",
    `User: ${input.username ? `@${input.username}` : "no username"}`,
    `Telegram ID: ${input.telegramUserId}`,
    `📁 Watched wallets: ${input.walletCount}`,
    "🇷🇺🇺🇸 Language: RU / EN",
    "",
    "Для подключения alert admin используйте /my_id."
  ].join("\n");
}

export function alertAdminsMessage(recipients: CustomerAlertRecipient[]): string {
  if (recipients.length === 0) {
    return [
      "👥 Alert admins",
      "",
      "No customer alert admins configured.",
      "",
      "Owner получает все входящие. Extra admins получают best-effort alerts."
    ].join("\n");
  }

  return [
    "👥 Alert admins",
    "",
    ...recipients.map((recipient) => `- ${recipient.recipientTelegramUserId} - ${formatAlertMode(recipient.alertMode)}`),
    "",
    "Owner получает все входящие. Extra admins получают best-effort alerts."
  ].join("\n");
}

export function addAlertAdminPrompt(defaultMode: CustomerAlertMode = "suspicious_only"): string {
  return [
    "Send a Telegram ID to add as a customer alert admin.",
    "",
    "Optional format: <telegram_id> <mode>",
    "Modes: suspicious, suspicious_only, or all",
    `Default: ${defaultMode === "all" ? "all" : "suspicious_only"}`
  ].join("\n");
}

export function removeAlertAdminPrompt(): string {
  return "Send a Telegram ID to remove from customer alert admins.";
}

export function alertAdminAddedMessage(input: { telegramUserId: string; mode: CustomerAlertMode }): string {
  return `Alert admin saved: ${input.telegramUserId} - ${formatAlertMode(input.mode)}.`;
}

export function alertAdminRemovedMessage(telegramUserId: string): string {
  return `Removed alert admin: ${telegramUserId}.`;
}

export function alertAdminNotFoundMessage(telegramUserId: string): string {
  return `Customer alert admin not found: ${telegramUserId}.`;
}
