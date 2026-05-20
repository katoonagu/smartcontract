import type { RiskReport } from "../types";

function formatReasons(report: RiskReport): string {
  if (report.reasons.length === 0) return "- no obvious risk signals found";
  return report.reasons.map((reason) => `- ${reason.message}`).join("\n");
}

export function formatUserIncomingAlert(input: {
  amount: string;
  sender: string;
  txHash: string;
  report: RiskReport;
}): string {
  return [
    `Incoming USDT: ${input.amount}`,
    `From: ${input.sender}`,
    `Risk: ${input.report.level} - ${input.report.score}/100`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Tx: ${input.txHash}`
  ].join("\n");
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
    ? `@${input.telegramUsername} - tg_id: ${input.telegramUserId}`
    : `tg_id: ${input.telegramUserId}`;

  return [
    `${input.report.level} incoming event`,
    `User: ${user}`,
    `Watched wallet: ${input.watchedWallet}`,
    `Sender: ${input.sender}`,
    `Amount: ${input.amount} USDT`,
    `Score: ${input.report.score}/100`,
    "",
    "Reasons:",
    formatReasons(input.report),
    "",
    `Tx: ${input.txHash}`
  ].join("\n");
}
