import type { BotLocale, RiskLevel, WalletAlertMode } from "../types";
import type { CustomerAlertMode } from "../storage/repositories";

export type { BotLocale } from "../types";

export const DEFAULT_BOT_LOCALE: BotLocale = "ru";

export function isBotLocale(value: unknown): value is BotLocale {
  return value === "ru" || value === "en";
}

export function normalizeBotLocale(value: unknown): BotLocale {
  return isBotLocale(value) ? value : DEFAULT_BOT_LOCALE;
}

const dictionary = {
  ru: {
    "button.language.ru": "🇷🇺 Русский",
    "button.language.en": "🇬🇧 English",
    "button.wallets": "📁 Кошельки",
    "button.add": "➕ Добавить",
    "button.address": "🔎 Адрес",
    "button.tx": "🧾 Tx",
    "button.reportTheft": "🛡 Сообщить о краже",
    "button.riskIntel": "🛡 Риск",
    "button.profile": "👤 Профиль",
    "button.settings": "⚙️ Настройки",
    "button.help": "❔ Помощь",
    "button.safety": "🛡 Безопасность",
    "button.analytics": "📊 Аналитика",
    "button.refresh": "🔄 Обновить",
    "button.alertMode": "🔔 Алерты",
    "button.remove": "🗑 Удалить",
    "button.menu": "⬅️ Меню",
    "button.back": "↩️ Назад",
    "button.wallet": "⬅️ Кошелек",
    "button.cancel": "🚫 Отмена",
    "button.alertAdmins": "👥 Админы алертов",
    "button.suspiciousAdmin": "➕ Админ рисковых",
    "button.allAlertsAdmin": "➕ Админ всех алертов",
    "button.removeAdmin": "➖ Удалить админа",
    "button.removeWallet": "🗑 Удалить кошелек",
    "button.realtime": "Сразу",
    "button.riskOnly": "Только риск",
    "button.digest10m": "Сводка 10м",
    "button.paused": "Пауза",
    "common.none": "нет",
    "common.unknown": "неизвестно",
    "common.never": "никогда",
    "common.justNow": "только что",
    "common.notCheckedYet": "еще не проверяли",
    "common.pollError": "ошибка проверки",
    "common.noNewTransfers": "новых переводов нет",
    "common.active": "активен",
    "common.full": "полные",
    "common.partial": "частичные"
  },
  en: {
    "button.language.ru": "🇷🇺 Русский",
    "button.language.en": "🇬🇧 English",
    "button.wallets": "📁 Wallets",
    "button.add": "➕ Add",
    "button.address": "🔎 Address",
    "button.tx": "🧾 Tx",
    "button.reportTheft": "Report theft",
    "button.riskIntel": "🛡 Risk intel",
    "button.profile": "👤 Profile",
    "button.settings": "⚙️ Settings",
    "button.help": "❔ Help",
    "button.safety": "🛡 Safety",
    "button.analytics": "📊 Analytics",
    "button.refresh": "🔄 Refresh",
    "button.alertMode": "🔔 Alert mode",
    "button.remove": "🗑 Remove",
    "button.menu": "⬅️ Menu",
    "button.back": "↩️ Back",
    "button.wallet": "⬅️ Wallet",
    "button.cancel": "🚫 Cancel",
    "button.alertAdmins": "👥 Alert admins",
    "button.suspiciousAdmin": "➕ Suspicious admin",
    "button.allAlertsAdmin": "➕ All alerts admin",
    "button.removeAdmin": "➖ Remove admin",
    "button.removeWallet": "🗑 Remove wallet",
    "button.realtime": "Realtime",
    "button.riskOnly": "Risk only",
    "button.digest10m": "Digest 10m",
    "button.paused": "Paused",
    "common.none": "none",
    "common.unknown": "unknown",
    "common.never": "never",
    "common.justNow": "just now",
    "common.notCheckedYet": "not checked yet",
    "common.pollError": "poll error",
    "common.noNewTransfers": "no new transfers",
    "common.active": "active",
    "common.full": "full",
    "common.partial": "partial"
  }
} as const;

export type I18nKey = keyof typeof dictionary.ru;

export function t(locale: BotLocale, key: I18nKey): string {
  return dictionary[locale][key];
}

export function languageName(locale: BotLocale): string {
  return locale === "ru" ? "Русский" : "English";
}

export function riskLevelText(locale: BotLocale, level: RiskLevel): string {
  if (locale === "en") return level;
  switch (level) {
    case "LOW":
      return "низкий";
    case "MEDIUM":
      return "средний";
    case "HIGH":
      return "высокий";
    case "CRITICAL":
      return "критический";
  }
}

export function walletAlertModeText(locale: BotLocale, mode: WalletAlertMode, digestIntervalMinutes = 10): string {
  if (locale === "en") {
    switch (mode) {
      case "realtime":
        return "realtime";
      case "risk_only":
        return "risk only";
      case "digest":
        return `digest ${digestIntervalMinutes}m`;
      case "paused":
        return "paused";
    }
  }

  switch (mode) {
    case "realtime":
      return "сразу";
    case "risk_only":
      return "только средний/высокий/критический риск";
    case "digest":
      return `сводка ${digestIntervalMinutes} мин`;
    case "paused":
      return "пауза";
  }
}

export function customerAlertModeText(locale: BotLocale, mode: CustomerAlertMode): string {
  if (locale === "en") {
    return mode === "all" ? "all incoming alerts" : "MEDIUM/HIGH/CRITICAL alerts only";
  }
  return mode === "all" ? "все входящие алерты" : "только MEDIUM/HIGH/CRITICAL";
}
