import { InlineKeyboard } from "grammy";

const TRONSCAN_BASE_URL = "https://tronscan.org/#";

export function tronscanAddressUrl(address: string): string {
  return `${TRONSCAN_BASE_URL}/address/${encodeURIComponent(address)}`;
}

export function tronscanApprovalsUrl(address: string): string {
  return `${tronscanAddressUrl(address)}/approvals`;
}

export function tronscanTransactionUrl(txHash: string): string {
  return `${TRONSCAN_BASE_URL}/transaction/${encodeURIComponent(txHash)}`;
}

export function userIncomingAlertKeyboard(input: { sender: string; txHash: string }): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔍 Check sender", `check:addr:${input.sender}`)
    .row()
    .url("🔗 Open tx", tronscanTransactionUrl(input.txHash))
    .url("👤 Open sender", tronscanAddressUrl(input.sender));
}

export function userIncomingDepositRiskKeyboard(input: { jobId: string; sender: string; txHash: string }): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔍 Check deposit", `check:deposit:${input.jobId}`)
    .row()
    .url("🔗 Open tx", tronscanTransactionUrl(input.txHash))
    .url("👤 Open sender", tronscanAddressUrl(input.sender));
}
