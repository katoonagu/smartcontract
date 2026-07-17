import { InlineKeyboard } from "grammy";
import type { BotLocale } from "../bot/i18n";
import { tronscanAddressUrl, tronscanApprovalsUrl, tronscanTransactionUrl } from "./keyboards";

export function approvalAlertKeyboard(input: { txHash: string; spender: string; wallet: string; locale?: BotLocale }): InlineKeyboard {
  const locale = input.locale ?? "en";
  return new InlineKeyboard()
    .url(locale === "en" ? "Open USDT permissions" : "Открыть разрешения USDT", tronscanApprovalsUrl(input.wallet))
    .row()
    .url(locale === "en" ? "Permission transaction" : "Транзакция разрешения", tronscanTransactionUrl(input.txHash))
    .row()
    .url(locale === "en" ? "Open contract" : "Открыть контракт", tronscanAddressUrl(input.spender))
    .url(locale === "en" ? "Open wallet" : "Открыть кошелёк", tronscanAddressUrl(input.wallet));
}
