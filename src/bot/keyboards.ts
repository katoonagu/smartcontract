import { InlineKeyboard } from "grammy";
import type { WalletAlertMode, WatchedWallet } from "../types";
import type { CustomerAlertMode, CustomerAlertRecipient } from "../storage/repositories";
import { tronscanAddressUrl, tronscanApprovalsUrl } from "../alerts/keyboards";
import { DEFAULT_BOT_LOCALE, t, type BotLocale } from "./i18n";

export type BotCallback =
  | { kind: "home" }
  | { kind: "help" }
  | { kind: "profile" }
  | { kind: "risk_overview" }
  | { kind: "wallets_list" }
  | { kind: "wallet_add" }
  | { kind: "wallet_view"; walletId: string }
  | { kind: "wallet_refresh"; walletId: string }
  | { kind: "wallet_analytics"; walletId: string }
  | { kind: "wallet_risk"; walletId: string }
  | { kind: "wallet_safety"; walletId: string }
  | { kind: "wallet_alert_mode"; walletId: string }
  | { kind: "wallet_alert_mode_set"; walletId: string; alertMode: WalletAlertMode; digestIntervalMinutes: number }
  | { kind: "wallet_remove"; walletId: string }
  | { kind: "wallet_remove_confirm"; walletId: string }
  | { kind: "check_address" }
  | { kind: "check_address_value"; address: string }
  | { kind: "check_cross_chain_prompt" }
  | { kind: "check_cross_chain_deep"; address: string }
  | { kind: "check_deposit_job"; jobId: string }
  | { kind: "check_tx" }
  | { kind: "theft_start" }
  | { kind: "theft_confirm"; reportId: string }
  | { kind: "theft_change_tx"; reportId: string }
  | { kind: "theft_comment"; reportId: string }
  | { kind: "theft_cancel"; reportId: string }
  | { kind: "theft_deposit_sent"; reportId: string }
  | { kind: "theft_guide"; reportId: string }
  | { kind: "theft_admin"; reportId: string }
  | { kind: "settings" }
  | { kind: "settings_alerts" }
  | { kind: "settings_add_admin"; alertMode: CustomerAlertMode | null }
  | { kind: "settings_language"; locale: BotLocale }
  | { kind: "settings_remove_admin" }
  | { kind: "settings_remove_admin_value"; recipientTelegramUserId: string }
  | { kind: "cancel" };

export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function parseCallbackData(data: string): BotCallback | null {
  if (data === "home") return { kind: "home" };
  if (data === "help") return { kind: "help" };
  if (data === "profile") return { kind: "profile" };
  if (data === "risk:intel") return { kind: "risk_overview" };
  if (data === "wl:list") return { kind: "wallets_list" };
  if (data === "wl:add") return { kind: "wallet_add" };
  if (data === "check:addr") return { kind: "check_address" };
  if (data === "check:xchain") return { kind: "check_cross_chain_prompt" };
  if (data === "check:tx") return { kind: "check_tx" };
  if (data === "theft:start") return { kind: "theft_start" };
  if (data === "settings") return { kind: "settings" };
  if (data === "settings:alerts") return { kind: "settings_alerts" };
  if (data === "settings:language:ru") return { kind: "settings_language", locale: "ru" };
  if (data === "settings:language:en") return { kind: "settings_language", locale: "en" };
  if (data === "settings:add_admin") return { kind: "settings_add_admin", alertMode: null };
  if (data === "settings:add_admin:all") return { kind: "settings_add_admin", alertMode: "all" };
  if (data === "settings:add_admin:suspicious" || data === "settings:add_admin:suspicious_only") {
    return { kind: "settings_add_admin", alertMode: "suspicious_only" };
  }
  if (data === "settings:remove_admin") return { kind: "settings_remove_admin" };
  if (data === "cancel") return { kind: "cancel" };

  const alertAdminRemoveMatch = /^settings:remove_admin:(\d{1,20})$/.exec(data);
  if (alertAdminRemoveMatch) {
    return { kind: "settings_remove_admin_value", recipientTelegramUserId: alertAdminRemoveMatch[1] };
  }

  const addressCheckMatch = /^check:addr:(T[a-zA-Z0-9]{33})$/.exec(data);
  if (addressCheckMatch) return { kind: "check_address_value", address: addressCheckMatch[1] };

  const crossChainDeepCheckMatch = /^check:xchain:(T[a-zA-Z0-9]{33})$/.exec(data);
  if (crossChainDeepCheckMatch) return { kind: "check_cross_chain_deep", address: crossChainDeepCheckMatch[1] };

  const depositCheckMatch = /^check:deposit:([0-9a-fA-F-]{36})$/.exec(data);
  if (depositCheckMatch) return { kind: "check_deposit_job", jobId: depositCheckMatch[1] };

  const theftMatch = /^theft:(confirm|change_tx|comment|cancel|deposit_sent|guide|admin):([^:]+)$/.exec(data);
  if (theftMatch) {
    switch (theftMatch[1]) {
      case "confirm":
        return { kind: "theft_confirm", reportId: theftMatch[2] };
      case "change_tx":
        return { kind: "theft_change_tx", reportId: theftMatch[2] };
      case "comment":
        return { kind: "theft_comment", reportId: theftMatch[2] };
      case "cancel":
        return { kind: "theft_cancel", reportId: theftMatch[2] };
      case "deposit_sent":
        return { kind: "theft_deposit_sent", reportId: theftMatch[2] };
      case "guide":
        return { kind: "theft_guide", reportId: theftMatch[2] };
      case "admin":
        return { kind: "theft_admin", reportId: theftMatch[2] };
      default:
        return null;
    }
  }

  const alertModeSetMatch = /^wl:mode:([^:]+):(realtime|risk_only|digest|paused)(?::(\d{1,2}))?$/.exec(data);
  if (alertModeSetMatch) {
    const alertMode = alertModeSetMatch[2] as WalletAlertMode;
    const digestIntervalMinutes = Number(alertModeSetMatch[3] ?? "10");
    if (!Number.isSafeInteger(digestIntervalMinutes) || digestIntervalMinutes < 5 || digestIntervalMinutes > 60) {
      return null;
    }
    return { kind: "wallet_alert_mode_set", walletId: alertModeSetMatch[1], alertMode, digestIntervalMinutes };
  }

  const alertModeMatch = /^wl:alerts:(.+)$/.exec(data);
  if (alertModeMatch) {
    return { kind: "wallet_alert_mode", walletId: alertModeMatch[1] };
  }

  const match = /^(wl:view|wl:refresh|wl:analytics|wl:risk|wl:security|wl:safety|wl:remove|wl:remove_yes):(.+)$/.exec(data);
  if (!match) return null;

  const walletId = match[2];
  switch (match[1]) {
    case "wl:view":
      return { kind: "wallet_view", walletId };
    case "wl:refresh":
      return { kind: "wallet_refresh", walletId };
    case "wl:analytics":
      return { kind: "wallet_analytics", walletId };
    case "wl:risk":
    case "wl:security":
      return { kind: "wallet_risk", walletId };
    case "wl:safety":
      return { kind: "wallet_safety", walletId };
    case "wl:remove":
      return { kind: "wallet_remove", walletId };
    case "wl:remove_yes":
      return { kind: "wallet_remove_confirm", walletId };
    default:
      return null;
  }
}

export function mainMenuKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.wallets"), "wl:list")
    .text(t(locale, "button.add"), "wl:add")
    .row()
    .text(t(locale, "button.address"), "check:addr")
    .text(t(locale, "button.tx"), "check:tx")
    .row()
    .text(t(locale, "button.reportTheft"), "theft:start")
    .row()
    .text(t(locale, "button.riskIntel"), "risk:intel")
    .text(t(locale, "button.profile"), "profile")
    .row()
    .text(t(locale, "button.settings"), "settings")
    .text(t(locale, "button.help"), "help");
}

export function walletsKeyboard(wallets: WatchedWallet[], locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const wallet of wallets) {
    keyboard.text(shortAddress(wallet.address), `wl:view:${wallet.id}`).row();
  }
  keyboard.text(t(locale, "button.add"), "wl:add").text(t(locale, "button.menu"), "home");
  return keyboard;
}

export function walletDashboardKeyboard(walletId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.safety"), `wl:safety:${walletId}`)
    .text(t(locale, "button.analytics"), `wl:analytics:${walletId}`)
    .row()
    .text(t(locale, "button.refresh"), `wl:refresh:${walletId}`)
    .text(t(locale, "button.alertMode"), `wl:alerts:${walletId}`)
    .row()
    .text(t(locale, "button.address"), "check:addr")
    .text(t(locale, "button.tx"), "check:tx")
    .row()
    .text(t(locale, "button.wallets"), "wl:list")
    .text(t(locale, "button.settings"), "settings")
    .row()
    .text(t(locale, "button.remove"), `wl:remove:${walletId}`);
}

export function walletAlertModeKeyboard(wallet: WatchedWallet, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.realtime"), `wl:mode:${wallet.id}:realtime`)
    .text(t(locale, "button.riskOnly"), `wl:mode:${wallet.id}:risk_only`)
    .row()
    .text(t(locale, "button.digest10m"), `wl:mode:${wallet.id}:digest:10`)
    .text(t(locale, "button.paused"), `wl:mode:${wallet.id}:paused`)
    .row()
    .text(t(locale, "button.back"), `wl:view:${wallet.id}`);
}

export function walletRemoveKeyboard(walletId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.removeWallet"), `wl:remove_yes:${walletId}`)
    .text(t(locale, "button.back"), `wl:view:${walletId}`);
}

export function cancelKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard().text(t(locale, "button.cancel"), "cancel");
}

export function addressCheckPromptKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text("Deep cross-chain", "check:xchain")
    .row()
    .text(t(locale, "button.cancel"), "cancel");
}

export function addressCheckResultKeyboard(address: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text("Deep cross-chain", `check:xchain:${address}`)
    .row()
    .text(t(locale, "button.menu"), "home");
}

export function theftReportCardKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.confirm"), `theft:confirm:${reportId}`)
    .row()
    .text(t(locale, "button.changeTx"), `theft:change_tx:${reportId}`)
    .text(t(locale, "button.addComment"), `theft:comment:${reportId}`)
    .row()
    .text(t(locale, "button.cancel"), `theft:cancel:${reportId}`);
}

export function theftReportDepositKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.sent"), `theft:deposit_sent:${reportId}`)
    .text(t(locale, "button.cancel"), `theft:cancel:${reportId}`);
}

export function theftReportNextStepsKeyboard(reportId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.guide"), `theft:guide:${reportId}`)
    .text(t(locale, "button.contactAdmin"), `theft:admin:${reportId}`)
    .row()
    .text(t(locale, "button.menu"), "home");
}

export function profileKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.wallets"), "wl:list")
    .text(t(locale, "button.settings"), "settings")
    .row()
    .text(t(locale, "button.alertAdmins"), "settings:alerts")
    .text(t(locale, "button.help"), "help")
    .row()
    .text(t(locale, "button.menu"), "home");
}

export function backToWalletKeyboard(walletId: string, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard().text(t(locale, "button.wallet"), `wl:view:${walletId}`).text(t(locale, "button.wallets"), "wl:list");
}

export function walletSafetyKeyboard(wallet: Pick<WatchedWallet, "id" | "address">, locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .url(locale === "en" ? "Open approvals" : "Открыть approvals", tronscanApprovalsUrl(wallet.address))
    .url(locale === "en" ? "Open wallet" : "Открыть кошелёк", tronscanAddressUrl(wallet.address))
    .row()
    .text(t(locale, "button.wallet"), `wl:view:${wallet.id}`)
    .text(t(locale, "button.wallets"), "wl:list");
}

export function settingsKeyboard(locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "button.language.ru"), "settings:language:ru")
    .text(t(locale, "button.language.en"), "settings:language:en")
    .row()
    .text(t(locale, "button.alertAdmins"), "settings:alerts")
    .row()
    .text(t(locale, "button.suspiciousAdmin"), "settings:add_admin:suspicious")
    .row()
    .text(t(locale, "button.allAlertsAdmin"), "settings:add_admin:all")
    .text(t(locale, "button.removeAdmin"), "settings:remove_admin")
    .row()
    .text(t(locale, "button.menu"), "home");
}

export function alertAdminsKeyboard(recipients: CustomerAlertRecipient[] = [], locale: BotLocale = DEFAULT_BOT_LOCALE): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(t(locale, "button.suspiciousAdmin"), "settings:add_admin:suspicious")
    .row()
    .text(t(locale, "button.allAlertsAdmin"), "settings:add_admin:all")
    .text(t(locale, "button.removeAdmin"), "settings:remove_admin")
    .row();

  for (const recipient of recipients) {
    keyboard.text(`➖ ${recipient.recipientTelegramUserId}`, `settings:remove_admin:${recipient.recipientTelegramUserId}`).row();
  }

  return keyboard
    .text(t(locale, "button.settings"), "settings")
    .text(t(locale, "button.menu"), "home");
}
