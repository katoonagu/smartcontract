import type { IncomingDepositRiskReport, RiskReport } from "../types";
import { userIncomingDepositRiskKeyboard } from "./keyboards";
import {
  TELEGRAM_MESSAGE_LIMIT,
  bold,
  bulletList,
  code,
  escapeHtml,
  formatRiskIcon,
  formatRiskLine,
  section,
  telegramHtmlMessage,
  type TelegramAlertMessage
} from "./telegramHtml";

export { TELEGRAM_MESSAGE_LIMIT };
const MAX_REASON_COUNT = 8;

type IncomingDepositRiskAlertMessage = TelegramAlertMessage & {
  replyMarkup: ReturnType<typeof userIncomingDepositRiskKeyboard>;
};

function reasonMessages(report: RiskReport): string[] {
  const visibleReasons = report.reasons.slice(0, MAX_REASON_COUNT);
  const formatted = visibleReasons.map((reason) => reason.message);
  const hiddenCount = report.reasons.length - visibleReasons.length;
  if (hiddenCount > 0) {
    formatted.push(`...and ${hiddenCount} more`);
  }
  return formatted;
}

function formatReasons(report: RiskReport): string {
  return bulletList(reasonMessages(report));
}

function formatSpenderType(value: string): string {
  switch (value) {
    case "eoa":
      return "wallet (EOA, not smart contract)";
    case "contract":
      return "smart contract";
    default:
      return "unknown";
  }
}

function formatDateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().replace(".000Z", "Z");
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "unknown";
  return `${Math.round(value * 100)}%`;
}

function formatIncomingDepositReasons(report: IncomingDepositRiskReport): string {
  return bulletList(report.reasons.slice(0, MAX_REASON_COUNT));
}

function formatFastSenderRisk(report: IncomingDepositRiskReport): string {
  if (!report.fastSenderRisk) return code("unknown");
  return `${code(`${report.fastSenderRisk.score}/100`)} (${code(report.fastSenderRisk.level)})`;
}

function formatContractAddress(address: string | null): string {
  if (!address) return "unknown";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatIncomingDepositContractVerdicts(report: IncomingDepositRiskReport): string | null {
  if (report.contractVerdicts.length === 0) return null;
  return bulletList(report.contractVerdicts.slice(0, 3).map((verdict) => {
    const reason = verdict.reasons[0] ? ` - ${verdict.reasons[0]}` : "";
    return `${verdict.verdict} ${verdict.contractRiskScore}/100 for ${formatContractAddress(verdict.contractAddress)}${reason}`;
  }));
}

export function formatIncomingDepositRiskAlert(input: {
  jobId: string;
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  report: IncomingDepositRiskReport;
}): IncomingDepositRiskAlertMessage {
  const message = telegramHtmlMessage([
    bold("Incoming USDT"),
    `${bold("Decision")}: ${code(input.report.decision)}`,
    `${bold("Deposit risk")}: ${code(`${input.report.depositRiskScore}/100`)} (${code(input.report.riskBand)})`,
    [
      `${bold("Amount")}: ${code(`${input.amount} USDT`)}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Sender")}: ${code(input.sender)}`
    ].join("\n"),
    section("Reasons", [formatIncomingDepositReasons(input.report)]),
    section("AI contract verdict", [formatIncomingDepositContractVerdicts(input.report)]),
    section("Checks", [
      `${bold("Fast sender risk")}: ${formatFastSenderRisk(input.report)}`,
      `${bold("Origin coverage")}: ${code(formatPercent(input.report.originCoverage))}`,
      `${bold("Data quality")}: ${code(input.report.dataQuality)}`,
      `${bold("Sender role")}: ${code(input.report.senderRole ?? "unknown")}`
    ]),
    `${bold("Tx")}: ${code(input.txHash)}`
  ]);

  return {
    ...message,
    replyMarkup: userIncomingDepositRiskKeyboard({
      jobId: input.jobId,
      sender: input.sender,
      txHash: input.txHash
    })
  };
}

export function formatUserIncomingAlert(input: {
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  return telegramHtmlMessage([
    bold("Incoming USDT"),
    formatRiskLine(input.report),
    [
      `${bold("Amount")}: ${code(`${input.amount} USDT`)}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("From")}: ${code(input.sender)}`
    ].join("\n"),
    section("Reasons", [formatReasons(input.report)]),
    `${bold("Tx")}: ${code(input.txHash)}`
  ]);
}

export function formatAdminSuspiciousAlert(input: {
  telegramUserId: string;
  telegramUsername: string | null;
  watchedWallet: string;
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  const user = input.telegramUsername
    ? `@${escapeHtml(input.telegramUsername)} - tg_id: ${code(input.telegramUserId)}`
    : `tg_id: ${code(input.telegramUserId)}`;

  return telegramHtmlMessage([
    `${bold(`${input.report.level} incoming event`)} \u00B7 ${code(`${input.report.score}/100`)}`,
    [
      `${bold("User")}: ${user}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Sender")}: ${code(input.sender)}`,
      `${bold("Amount")}: ${code(`${input.amount} USDT`)}`
    ].join("\n"),
    section("Reasons", [formatReasons(input.report)]),
    `${bold("Tx")}: ${code(input.txHash)}`
  ]);
}

export function formatUserApprovalAlert(input: {
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
  approvalAt?: Date | null;
  signedAt?: Date | null;
  expirationAt?: Date | null;
  approvalTxHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  const serviceLinked = input.report.reasons.some((reason) => reason.code === "approval_temporally_linked_to_known_swap");
  const meaning = serviceLinked
    ? "This approval appears connected to a swap/bridge route, but the spender is unverified or untagged. Review/revoke if unexpected or no longer needed."
    : "Active USDT allowance was found on-chain. This is not proof of theft.";
  const allowance = input.allowanceAmount && input.allowanceAmount !== input.allowanceType
    ? `${input.allowanceType} ${input.allowanceAmount}`
    : input.allowanceType;
  const timing = [
    input.approvalAt ? `${bold("On-chain")}: ${code(formatDateTime(input.approvalAt) ?? "")}` : null,
    input.signedAt ? `${bold("Signed")}: ${code(formatDateTime(input.signedAt) ?? "")}` : null,
    input.expirationAt ? `${bold("Expires")}: ${code(formatDateTime(input.expirationAt) ?? "")}` : null
  ].filter((line): line is string => line !== null);
  return telegramHtmlMessage([
    bold("\u{1F6E1} Approval Guard"),
    formatRiskLine(input.report),
    "Active USDT approval was found on your watched wallet.",
    [
      `${bold("Wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Token")}: ${code(input.token)}`,
      `${bold("Spender")}: ${code(input.spender)}`,
      `${bold("Identity")}: ${code(input.spenderIdentity ?? "unknown")}`,
      `${bold("Type")}: ${escapeHtml(formatSpenderType(input.spenderType))}`,
      `${bold("Allowance")}: ${code(allowance)}`
    ].join("\n"),
    section("Meaning", [escapeHtml(meaning)]),
    section("Why the bot warns", [formatReasons(input.report)]),
    timing.length > 0 ? section("Time", timing) : null,
    section("What to do", [
      "1. Open TronScan approvals.",
      "2. Connect TronLink with this exact wallet.",
      "3. Find USDT approval for this spender.",
      "4. Cancel approval if unexpected or no longer needed."
    ].map(escapeHtml)),
    `${bold("Approval tx")}: ${code(input.approvalTxHash)}`,
    "\u{1F512} Read-only: bot never signs transactions, never asks for seed/private key, and never controls funds."
  ]);
}

export function formatUserApprovalPendingAlert(input: {
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
  approvalAt?: Date | null;
  contextDeadlineAt: Date;
  approvalTxHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  const allowance = input.allowanceAmount && input.allowanceAmount !== input.allowanceType
    ? `${input.allowanceType} ${input.allowanceAmount}`
    : input.allowanceType;
  return telegramHtmlMessage([
    bold("\u{1F6E1} Approval Guard"),
    `\u23F3 ${formatRiskIcon(input.report.level)} ${bold("Risk")}: ${code(`${input.report.score}/100`)} (${escapeHtml(`${input.report.level} review, pending context`)})`,
    "Unlimited or large USDT approval to an unverified helper-like contract.",
    "Waiting up to 10 min for related swap/bridge route context.",
    "This is not proof of theft yet.",
    [
      `${bold("Wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Token")}: ${code(input.token)}`,
      `${bold("Spender")}: ${code(input.spender)}`,
      `${bold("Identity")}: ${code(input.spenderIdentity ?? "unknown")}`,
      `${bold("Type")}: ${escapeHtml(formatSpenderType(input.spenderType))}`,
      `${bold("Allowance")}: ${code(allowance)}`
    ].join("\n"),
    input.approvalAt ? `${bold("On-chain")}: ${code(formatDateTime(input.approvalAt) ?? "")}` : null,
    `${bold("Context deadline")}: ${code(formatDateTime(input.contextDeadlineAt) ?? "")}`,
    section("Why the bot warns", [formatReasons(input.report)]),
    `${bold("Approval tx")}: ${code(input.approvalTxHash)}`,
    "\u{1F512} Read-only: bot never signs transactions, never asks for seed/private key, and never controls funds."
  ]);
}

export function formatUserApprovalContextResultAlert(input: {
  watchedWallet: string;
  token: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  allowanceType: string;
  allowanceAmount?: string;
  approvalAt?: Date | null;
  approvalTxHash: string;
  initialReport: RiskReport;
  finalReport: RiskReport;
  result: "linked_swap_route" | "no_route_found" | "collector_drain";
  linkedRouteTxHash?: string | null;
  routeServiceTags?: string[];
}): TelegramAlertMessage {
  const allowance = input.allowanceAmount && input.allowanceAmount !== input.allowanceType
    ? `${input.allowanceType} ${input.allowanceAmount}`
    : input.allowanceType;
  const resultText = input.result === "linked_swap_route"
    ? `linked to ${input.routeServiceTags && input.routeServiceTags.length > 0 ? input.routeServiceTags.join(" / ") : "swap/bridge route"}`
    : input.result === "collector_drain"
      ? "possible collector drain"
      : "no related swap/bridge route found within 10 min";
  const meaning = input.result === "linked_swap_route"
    ? "This approval appears connected to a swap/bridge route. Spender is still unverified/untagged. Review/revoke if unexpected or no longer needed."
    : input.result === "collector_drain"
      ? "A spender-called transferFrom moved USDT from the watched wallet to a non-service receiver. Review immediately."
      : "No related swap/bridge route was found in the context window. Review this approval and revoke if unexpected.";
  return telegramHtmlMessage([
    bold("\u{1F6E1} Approval Guard result"),
    `${formatRiskIcon(input.finalReport.level)} ${bold("Risk")}: ${code(`${input.finalReport.score}/100`)} (${escapeHtml(input.finalReport.level)})`,
    `${bold("Initial status was")}: \u23F3 ${formatRiskIcon(input.initialReport.level)} ${escapeHtml(`${input.initialReport.level} review, pending context`)}`,
    `${bold("Result")}: ${escapeHtml(resultText)}`,
    section("Meaning", [escapeHtml(meaning)]),
    [
      `${bold("Wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Token")}: ${code(input.token)}`,
      `${bold("Spender")}: ${code(input.spender)}`,
      `${bold("Identity")}: ${code(input.spenderIdentity ?? "unknown")}`,
      `${bold("Type")}: ${escapeHtml(formatSpenderType(input.spenderType))}`,
      `${bold("Allowance")}: ${code(allowance)}`
    ].join("\n"),
    input.approvalAt ? `${bold("On-chain")}: ${code(formatDateTime(input.approvalAt) ?? "")}` : null,
    input.linkedRouteTxHash ? `${bold("Linked route tx")}: ${code(input.linkedRouteTxHash)}` : null,
    section("Final reasons", [formatReasons(input.finalReport)]),
    `${bold("Approval tx")}: ${code(input.approvalTxHash)}`,
    "\u{1F512} Read-only: bot never signs transactions, never asks for seed/private key, and never controls funds."
  ]);
}

export function formatDigestAlert(input: {
  walletAddress: string;
  intervalMinutes: number;
  transactionCount: number;
  totalUsdt: string;
  uniqueSenderCount: number;
  riskyTransactionCount: number;
  riskySenderCount: number;
  topRisky?: { level: RiskReport["level"]; score: number; sender: string } | null;
}): TelegramAlertMessage {
  return telegramHtmlMessage([
    bold("USDT digest"),
    [
      `${bold("Wallet")}: ${code(input.walletAddress)}`,
      `${bold("Window")}: ${code(`${input.intervalMinutes} min`)}`,
      `${bold("Incoming")}: ${code(`${input.transactionCount} tx`)}`,
      `${bold("Total")}: ${code(`${input.totalUsdt} USDT`)}`,
      `${bold("Senders")}: ${code(String(input.uniqueSenderCount))}`,
      `${bold("Risky")}: ${code(`${input.riskyTransactionCount} tx / ${input.riskySenderCount} sender${input.riskySenderCount === 1 ? "" : "s"}`)}`
    ].join("\n"),
    input.topRisky
      ? section("Top risky", [
          `${input.topRisky.level} ${input.topRisky.score}/100 from ${code(input.topRisky.sender)}`,
          "High-risk tx were alerted immediately"
        ])
      : null
  ]);
}

export function formatAdminApprovalAlert(input: {
  telegramUserId: string;
  telegramUsername: string | null;
  watchedWallet: string;
  spender: string;
  spenderType: string;
  spenderIdentity?: string | null;
  approvalTxHash: string;
  report: RiskReport;
}): TelegramAlertMessage {
  const user = input.telegramUsername
    ? `@${escapeHtml(input.telegramUsername)} - tg_id: ${code(input.telegramUserId)}`
    : `tg_id: ${code(input.telegramUserId)}`;

  return telegramHtmlMessage([
    `${bold(`${input.report.level} approval event`)} \u00B7 ${code(`${input.report.score}/100`)}`,
    [
      `${bold("User")}: ${user}`,
      `${bold("Watched wallet")}: ${code(input.watchedWallet)}`,
      `${bold("Spender")}: ${code(input.spender)}`,
      `${bold("Identity")}: ${code(input.spenderIdentity ?? "unknown")}`,
      `${bold("Spender type")}: ${escapeHtml(formatSpenderType(input.spenderType))}`
    ].join("\n"),
    section("Reasons", [formatReasons(input.report)]),
    `${bold("Approval tx")}: ${code(input.approvalTxHash)}`
  ]);
}
