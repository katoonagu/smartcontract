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

export function formatUserIncomingAlert(input: {
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): string {
  return capTelegramMessage([
    `Incoming USDT: ${sanitizePlainText(input.amount)}`,
    `From: ${sanitizePlainText(input.sender)}`,
    `Risk: ${input.report.level} - ${input.report.score}/100`,
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
