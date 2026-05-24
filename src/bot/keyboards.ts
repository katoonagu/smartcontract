import { InlineKeyboard } from "grammy";
import type { WalletAlertMode, WatchedWallet } from "../types";
import type { CustomerAlertMode, CustomerAlertRecipient } from "../storage/repositories";

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
  | { kind: "check_tx" }
  | { kind: "settings" }
  | { kind: "settings_alerts" }
  | { kind: "settings_add_admin"; alertMode: CustomerAlertMode | null }
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
  if (data === "check:tx") return { kind: "check_tx" };
  if (data === "settings") return { kind: "settings" };
  if (data === "settings:alerts") return { kind: "settings_alerts" };
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

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📁 Wallets", "wl:list")
    .text("➕ Add", "wl:add")
    .row()
    .text("🔎 Address", "check:addr")
    .text("🧾 Tx", "check:tx")
    .row()
    .text("🛡 Risk intel", "risk:intel")
    .text("👤 Profile", "profile")
    .row()
    .text("⚙️ Settings", "settings")
    .text("❔ Help", "help");
}

export function walletsKeyboard(wallets: WatchedWallet[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const wallet of wallets) {
    keyboard.text(shortAddress(wallet.address), `wl:view:${wallet.id}`).row();
  }
  keyboard.text("➕ Add", "wl:add").text("⬅️ Menu", "home");
  return keyboard;
}

export function walletDashboardKeyboard(walletId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛡 Safety", `wl:safety:${walletId}`)
    .text("📊 Analytics", `wl:analytics:${walletId}`)
    .row()
    .text("🔄 Refresh", `wl:refresh:${walletId}`)
    .text("🔔 Alert mode", `wl:alerts:${walletId}`)
    .row()
    .text("🔎 Address", "check:addr")
    .text("🧾 Tx", "check:tx")
    .row()
    .text("📁 Wallets", "wl:list")
    .text("⚙️ Settings", "settings")
    .row()
    .text("🗑 Remove", `wl:remove:${walletId}`);
}

export function walletAlertModeKeyboard(wallet: WatchedWallet): InlineKeyboard {
  return new InlineKeyboard()
    .text("Realtime", `wl:mode:${wallet.id}:realtime`)
    .text("Risk only", `wl:mode:${wallet.id}:risk_only`)
    .row()
    .text("Digest 10m", `wl:mode:${wallet.id}:digest:10`)
    .text("Paused", `wl:mode:${wallet.id}:paused`)
    .row()
    .text("⬅️ Back", `wl:view:${wallet.id}`);
}

export function walletRemoveKeyboard(walletId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Remove wallet", `wl:remove_yes:${walletId}`)
    .text("↩️ Back", `wl:view:${walletId}`);
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🚫 Cancel", "cancel");
}

export function profileKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📁 Wallets", "wl:list")
    .text("⚙️ Settings", "settings")
    .row()
    .text("🔔 Alert admins", "settings:alerts")
    .text("❔ Help", "help")
    .row()
    .text("⬅️ Menu", "home");
}

export function backToWalletKeyboard(walletId: string): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ Wallet", `wl:view:${walletId}`).text("📁 Wallets", "wl:list");
}

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("👥 Alert admins", "settings:alerts")
    .row()
    .text("➕ Suspicious admin", "settings:add_admin:suspicious")
    .row()
    .text("➕ All alerts admin", "settings:add_admin:all")
    .text("➖ Remove admin", "settings:remove_admin")
    .row()
    .text("⬅️ Menu", "home");
}

export function alertAdminsKeyboard(recipients: CustomerAlertRecipient[] = []): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("➕ Suspicious admin", "settings:add_admin:suspicious")
    .row()
    .text("➕ All alerts admin", "settings:add_admin:all")
    .text("➖ Remove admin", "settings:remove_admin")
    .row();

  for (const recipient of recipients) {
    keyboard.text(`➖ ${recipient.recipientTelegramUserId}`, `settings:remove_admin:${recipient.recipientTelegramUserId}`).row();
  }

  return keyboard
    .text("⚙️ Settings", "settings")
    .text("⬅️ Menu", "home");
}
