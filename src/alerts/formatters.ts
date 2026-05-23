import type { RiskReport } from "../types";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
const SAFE_MESSAGE_LIMIT = 3900;
const MAX_REASON_COUNT = 8;
const MAX_FIELD_LENGTH = 240;

function sanitizePlainText(value: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= MAX_FIELD_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_FIELD_LENGTH - 3)}...`;
}

function formatReasons(report: RiskReport): string {
  if (report.reasons.length === 0) return "- no obvious risk signals found";

  const visibleReasons = report.reasons.slice(0, MAX_REASON_COUNT);
  const formatted = visibleReasons.map((reason) => `- ${sanitizePlainText(reason.message)}`);
  const hiddenCount = report.reasons.length - visibleReasons.length;
  if (hiddenCount > 0) {
    formatted.push(`- ...and ${hiddenCount} more`);
  }
  return formatted.join("\n");
}

function capTelegramMessage(text: string): string {
  if (text.length <= SAFE_MESSAGE_LIMIT) return text;
  return `${text.slice(0, SAFE_MESSAGE_LIMIT - 24)}\n...[message truncated]`;
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

export function formatUserIncomingAlert(input: {
  amount: string;
  watchedWallet: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): string {
  return capTelegramMessage([
    `Incoming USDT: ${sanitizePlainText(input.amount)}`,
    `Watched wallet: ${sanitizePlainText(input.watchedWallet)}`,
    `From: ${sanitizePlainText(input.sender)}`,
    `Risk score: ${input.report.score}/100 (${input.report.level})`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Tx: ${sanitizePlainText(input.txHash)}`
  ].join("\n"));
}

export function formatAdminSuspiciousAlert(input: {
  telegramUserId: string;
  telegramUsername: string | null;
  watchedWallet: string;
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): string {
  const user = input.telegramUsername
    ? `@${sanitizePlainText(input.telegramUsername)} - tg_id: ${sanitizePlainText(input.telegramUserId)}`
    : `tg_id: ${sanitizePlainText(input.telegramUserId)}`;

  return capTelegramMessage([
    `${input.report.level} incoming event`,
    `User: ${user}`,
    `Watched wallet: ${sanitizePlainText(input.watchedWallet)}`,
    `Sender: ${sanitizePlainText(input.sender)}`,
    `Amount: ${sanitizePlainText(input.amount)} USDT`,
    `Score: ${input.report.score}/100`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Tx: ${sanitizePlainText(input.txHash)}`
  ].join("\n"));
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
}): string {
  const allowance = input.allowanceAmount && input.allowanceAmount !== input.allowanceType
    ? `${input.allowanceType} ${input.allowanceAmount}`
    : input.allowanceType;
  const timing = [
    input.approvalAt ? `On-chain time: ${formatDateTime(input.approvalAt)}` : null,
    input.signedAt ? `Signed time: ${formatDateTime(input.signedAt)}` : null,
    input.expirationAt ? `Expiration: ${formatDateTime(input.expirationAt)}` : null
  ].filter((line): line is string => line !== null);
  return capTelegramMessage([
    "Approval Guard",
    `Watched wallet: ${sanitizePlainText(input.watchedWallet)}`,
    `Token: ${sanitizePlainText(input.token)}`,
    `Spender: ${sanitizePlainText(input.spender)}`,
    `Identity: ${sanitizePlainText(input.spenderIdentity ?? "unknown")}`,
    `Spender type: ${sanitizePlainText(formatSpenderType(input.spenderType))}`,
    `Allowance: ${sanitizePlainText(allowance)}`,
    ...timing,
    `Risk score: ${input.report.score}/100 (${input.report.level})`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Approval tx: ${sanitizePlainText(input.approvalTxHash)}`,
    "",
    "Meaning: active USDT allowance was found on-chain. This is not proof of theft.",
    "Read-only alert. The bot never signs transactions and never asks for seed/private key.",
    "To revoke: open TronScan approvals, connect TronLink with this exact wallet, find USDT approval for this spender, and cancel it."
  ].join("\n"));
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
}): string {
  const user = input.telegramUsername
    ? `@${sanitizePlainText(input.telegramUsername)} - tg_id: ${sanitizePlainText(input.telegramUserId)}`
    : `tg_id: ${sanitizePlainText(input.telegramUserId)}`;

  return capTelegramMessage([
    `${input.report.level} approval event`,
    `User: ${user}`,
    `Watched wallet: ${sanitizePlainText(input.watchedWallet)}`,
    `Spender: ${sanitizePlainText(input.spender)}`,
    `Identity: ${sanitizePlainText(input.spenderIdentity ?? "unknown")}`,
    `Spender type: ${sanitizePlainText(formatSpenderType(input.spenderType))}`,
    `Score: ${input.report.score}/100`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Approval tx: ${sanitizePlainText(input.approvalTxHash)}`
  ].join("\n"));
}
