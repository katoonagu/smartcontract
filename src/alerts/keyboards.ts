import { InlineKeyboard } from "grammy";

const TRONSCAN_BASE_URL = "https://tronscan.org/#";

export function tronscanAddressUrl(address: string): string {
  return `${TRONSCAN_BASE_URL}/address/${encodeURIComponent(address)}`;
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
