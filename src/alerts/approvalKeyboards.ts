import { InlineKeyboard } from "grammy";
import { tronscanAddressUrl, tronscanApprovalsUrl, tronscanTransactionUrl } from "./keyboards";

export function approvalAlertKeyboard(input: { txHash: string; spender: string; wallet: string }): InlineKeyboard {
  return new InlineKeyboard()
    .url("🛡 Review / Revoke approval", tronscanApprovalsUrl(input.wallet))
    .row()
    .url("Open approval tx", tronscanTransactionUrl(input.txHash))
    .row()
    .url("Open spender", tronscanAddressUrl(input.spender))
    .url("Open wallet", tronscanAddressUrl(input.wallet));
}
