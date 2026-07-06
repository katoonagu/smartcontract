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

function normalizedCodeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rawActionOrReasonText(message: string, locale: BotLocale): string | null {
  const code = normalizedCodeText(message);
  switch (code) {
    case "edd_sof":
    case "edd_source_of_funds":
    case "enhanced_due_diligence_source_of_funds":
      return locale === "ru"
        ? "Нужна расширенная проверка источника средств (EDD/SOF): запросить подтверждение происхождения денег перед решением."
        : "Enhanced due diligence is required: request source-of-funds evidence before deciding.";
    case "manual_review":
    case "manual_review_required":
      return manualReviewText(locale);
    case "do_not_accept":
    case "block":
    case "decline":
      return locale === "ru"
        ? "Не принимать без дополнительного решения: найден высокий policy-риск."
        : "Do not accept without an additional decision: high policy risk was found.";
    case "hold":
    case "freeze_or_hold":
    case "hold_or_freeze_if_applicable":
      return locale === "ru"
        ? "Нужна пауза/hold: не двигать средства до проверки источника и policy-риска."
        : "Hold is required: do not move funds until source and policy risk are reviewed.";
    case "provider_cap_unresolved":
      return locale === "ru"
        ? "Проверка уперлась в лимит данных провайдера; финальный риск нельзя считать полностью доказанным."
        : "Provider data limit was reached; the final risk cannot be treated as fully proven.";
    case "incoming_history_not_fetched":
    case "history_not_fully_fetched":
      return locale === "ru"
        ? "Не загружена нужная входящая история по одному из адресов; это техническое ограничение покрытия, не доказательство риска."
        : "Required incoming history was not fetched for one address; this is a coverage limit, not risk proof.";
    case "service_boundary":
    case "service_boundary_reached":
    case "unlabeled_service_boundary":
      return locale === "ru"
        ? "Маршрут дошёл до сервисной границы. Через биржу/сервис нельзя надёжно продолжать on-chain трассировку."
        : "The path reached a service boundary. On-chain tracing cannot reliably continue through an exchange/service.";
  }
  return null;
}

function replaceManualReviewRequired(message: string, locale: BotLocale): string {
  if (locale === "ru") return manualReviewText(locale);
  return message
    .replace(/\s*;\s*manual review required\.?/gi, "; additional context needs review without treating this as proven bad evidence.")
    .replace(/\bmanual review required\.?/gi, "additional context needs review without treating this as proven bad evidence");
}

function isCleanSourceNotProven(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized === "clean_source_not_fully_proven"
    || /\bclean source\b.*\bnot\s+(?:been\s+)?(?:fully\s+|completely\s+)?proven\b/.test(normalized)
    || /\bclean source\b.*\bunproven\b/.test(normalized);
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

  if (normalized.includes("partial_cex_context")) {
    return locale === "ru" ? "есть частичный маршрут к CEX" : "partial CEX route context";
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
  if (!Number.isFinite(score)) return "DECLINE";
  if (score >= 60) return "DECLINE";
  if (score >= 45) return "REVIEW";
  return "ACCEPTABLE";
}

function sanctionedServiceText(message: string, locale: BotLocale): string | null {
  const russianMatch = message.match(/Найдена связь с санкционной биржей\/криптосервисом\s+(.+?):\s+доля\s+(.+?)\s+проверяемого происхождения;\s+орган:\s+([A-Z]+);\s+дата включения:\s+(\d{4}-\d{2}-\d{2})/i);
  if (russianMatch) {
    const [, service, share, authority, date] = russianMatch;
    return locale === "ru"
      ? `Найдена связь с санкционной биржей/криптосервисом ${service}: доля ${share}, ${authority}, дата включения ${date}. Это санкционный policy-риск; это не доказательство scam/drain.`
      : `The source path reaches sanctioned crypto service ${service}: ${share}, ${authority}, designated on ${date}. This is sanctions policy risk, not scam/drain proof.`;
  }

  const match = message.match(/reaches sanctioned crypto service\s+(.+?)\s+\([^)]*\);\s+designated by\s+([A-Z]+)\s+on\s+(\d{4}-\d{2}-\d{2})/i);
  if (!match) return null;
  const [, service, authority, date] = match;
  return locale === "ru"
    ? `Маршрут происхождения дошёл до санкционного криптосервиса ${service}: ${authority}, дата включения ${date}. Это санкционный policy-риск; это не доказательство scam/drain.`
    : `The source path reaches sanctioned crypto service ${service}: ${authority}, designated on ${date}. This is sanctions policy risk, not scam/drain proof.`;
}

export function normalizeNotificationReason(message: string, locale: BotLocale): string {
  const normalized = message.trim().toLowerCase();

  const rawText = rawActionOrReasonText(message, locale);
  if (rawText) return rawText;

  if (isCleanSourceNotProven(message.trim())) {
    return cleanSourceText(locale);
  }

  const sanctionedText = sanctionedServiceText(message, locale);
  if (sanctionedText) return sanctionedText;

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

  if (normalized.includes("manual review required")) {
    return replaceManualReviewRequired(message, locale);
  }

  if (normalized.includes("no obvious risk signals") || normalized.includes("no critical risk")) {
    return noCriticalRiskText(locale);
  }

  return message;
}
