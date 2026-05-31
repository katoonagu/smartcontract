import type { BotLocale, UserExchangeDecision } from "../types";

export type RiskObjectKind = "deposit" | "address" | "tx" | "approval" | "contract" | "where_is_money" | "deep";

const riskObjectLabels: Record<RiskObjectKind, Record<BotLocale, string>> = {
  deposit: {
    ru: "Риск депозита",
    en: "Deposit risk"
  },
  address: {
    ru: "Риск адреса",
    en: "Address risk"
  },
  tx: {
    ru: "Риск tx",
    en: "Tx risk"
  },
  approval: {
    ru: "Риск approval",
    en: "Approval risk"
  },
  contract: {
    ru: "Риск контракта",
    en: "Contract risk"
  },
  where_is_money: {
    ru: "Риск",
    en: "Risk"
  },
  deep: {
    ru: "Риск адреса",
    en: "Address risk"
  }
};

function cleanSourceText(locale: BotLocale): string {
  return locale === "ru"
    ? "Чистый источник денег доказан не полностью, поэтому риск не нулевой."
    : "The clean source of funds is not fully proven, so the risk is not zero.";
}

function manualReviewText(locale: BotLocale): string {
  return locale === "ru"
    ? "Найден дополнительный контекст, но точное плохое доказательство не подтверждено."
    : "Additional context was found, but no exact bad evidence was proven.";
}

function noCriticalRiskText(locale: BotLocale): string {
  return locale === "ru"
    ? "Критичных риск-сигналов не найдено."
    : "No critical risk signals were found.";
}

function isCleanSourceNotProven(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized === "clean_source_not_fully_proven"
    || (normalized.includes("clean source") && normalized.includes("not") && normalized.includes("proven"));
}

function normalizedPercent(value: string): string {
  return value.replace(",", ".");
}

export function decisionLabel(locale: BotLocale): string {
  return locale === "ru" ? "Решение" : "Decision";
}

export function statusLabel(locale: BotLocale): string {
  return locale === "ru" ? "Статус" : "Status";
}

export function whyLabel(locale: BotLocale): string {
  return locale === "ru" ? "Почему" : "Why";
}

export function checksLabel(locale: BotLocale): string {
  return locale === "ru" ? "Проверки" : "Checks";
}

export function riskObjectLabel(kind: RiskObjectKind, locale: BotLocale): string {
  return riskObjectLabels[kind][locale];
}

export function checkedOriginLabel(coverageRatio: number, locale: BotLocale): string {
  const finiteRatio = Number.isFinite(coverageRatio) ? coverageRatio : 0;
  const percent = Math.round(Math.max(0, Math.min(1, finiteRatio)) * 100);
  return locale === "ru"
    ? `Проверено происхождение: ${percent}% суммы`
    : `Checked origin: ${percent}% of amount`;
}

export function senderRoleText(role: string | null | undefined, locale: BotLocale): string {
  if (!role) return locale === "ru" ? "неизвестно" : "unknown";

  const normalized = role.toLowerCase();
  if (normalized.includes("operational") || normalized.includes("liquidity") || normalized.includes("collector")) {
    return locale === "ru" ? "рабочий ликвидный кошелёк" : "operational liquidity wallet";
  }

  if (normalized.includes("clean_cex")) {
    return locale === "ru" ? "кошелёк с CEX-источником" : "CEX-funded wallet";
  }

  if (normalized.includes("fresh") || normalized.includes("one_shot")) {
    return locale === "ru" ? "новый одноразовый кошелёк" : "fresh one-time wallet";
  }

  return role;
}

export function displayDecision(value: UserExchangeDecision): UserExchangeDecision {
  return value;
}

export function displayDecisionFromRiskScore(score: number): UserExchangeDecision {
  return score >= 60 ? "DECLINE" : "ACCEPTABLE";
}

export function normalizeNotificationReason(message: string, locale: BotLocale): string {
  const normalized = message.trim().toLowerCase();

  if (isCleanSourceNotProven(message.trim())) {
    return cleanSourceText(locale);
  }

  const htxPercent = message.match(/(\d+(?:[.,]\d+)?)\s*%.*\b(?:htx|huobi)\b/i);
  if (htxPercent) {
    const percent = normalizedPercent(htxPercent[1]);
    return locale === "ru"
      ? `${percent}% проверенной суммы пришло от HTX.`
      : `${percent}% of checked funds came from HTX.`;
  }

  if (normalized === "manual review required") {
    return manualReviewText(locale);
  }

  if (normalized.includes("no obvious risk signals") || normalized.includes("no critical risk")) {
    return noCriticalRiskText(locale);
  }

  return message;
}
