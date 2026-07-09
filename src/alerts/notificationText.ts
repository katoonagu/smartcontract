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
    case "partial_budget_exhausted":
      return locale === "ru"
        ? "Проверка уперлась в локальный бюджет загрузки истории; финальный вывод требует догрузки данных."
        : "The local history-fetch budget was exhausted; a final conclusion requires more coverage.";
    case "insufficient_coverage":
      return locale === "ru"
        ? "Покрытия истории недостаточно для финального вывода."
        : "History coverage is insufficient for a final conclusion.";
    case "budget_limited":
      return locale === "ru"
        ? "Технический статус: проверка ограничена бюджетом загрузки истории."
        : "Technical status: the check is limited by the history-fetch budget.";
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

function approvalDrainText(message: string, locale: BotLocale): string | null {
  const normalized = message.trim().toLowerCase();
  const hopMatch = normalized.match(/exact approval-drain provenance reaches checked wallet via (\d+) hop\(s\)/);
  if (hopMatch) {
    const hopCount = Number(hopMatch[1]);
    if (locale === "ru") {
      return hopCount === 0
        ? "Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, а проверяемый адрес стал первым получателем средств."
        : `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, а проверяемый адрес связан с получателем через ${hopCount} hop.`;
    }
    return hopCount === 0
      ? "Exact approval-drain evidence was found: after approve, USDT was moved with transferFrom and the checked address was the first receiver."
      : `Exact approval-drain evidence was found: after approve, USDT was moved with transferFrom and the checked address is linked within ${hopCount} hop(s).`;
  }

  if (
    normalized.includes("saved exact approval-drain evidence exists for this address") ||
    normalized.includes("exact upstream approval-drain provenance linked to this address") ||
    normalized.includes("exact approval-drain proximity label") ||
    normalized.includes("exact approval-drain provenance was found")
  ) {
    return locale === "ru"
      ? "По адресу есть сохранённое exact approval-drain доказательство: ранее система находила цепочку approve → transferFrom → получатель средств."
      : "Saved exact approval-drain evidence exists for this address: a previous check found an approve -> transferFrom -> receiver path.";
  }

  return null;
}

function incomingDepositCoverageText(message: string, locale: BotLocale): string | null {
  const blockedMandatory = message.match(/final incoming-deposit scoring is blocked until mandatory hop history is covered:\s*([a-z0-9_/-]+)/i);
  if (blockedMandatory) {
    const reason = rawActionOrReasonText(blockedMandatory[1], locale) ?? blockedMandatory[1];
    return locale === "ru"
      ? `Финальный вывод по депозиту пока заблокирован: нужно покрыть обязательную историю одного из hop-адресов. ${reason}`
      : `Final deposit scoring is blocked until mandatory hop history is covered. ${reason}`;
  }

  const blockedWhere = message.match(/final incoming-deposit scoring is blocked because where-is-money scoring is invalid:\s*([a-z0-9_/-]+)/i);
  if (blockedWhere) {
    const reason = rawActionOrReasonText(blockedWhere[1], locale) ?? blockedWhere[1];
    return locale === "ru"
      ? `Финальный вывод по депозиту пока заблокирован: режим “Откуда деньги” не дал валидную финальную оценку. ${reason}`
      : `Final deposit scoring is blocked because Where Is Money did not produce a valid final score. ${reason}`;
  }

  const technicalStatus = message.match(/^technical status:\s*([a-z0-9_/-]+)\.?$/i);
  if (technicalStatus) {
    return rawActionOrReasonText(technicalStatus[1], locale) ?? null;
  }

  return null;
}

function sourceShareNounText(noun: string, locale: BotLocale): string {
  const normalized = noun.trim().toLowerCase();
  if (locale === "en") return noun;
  if (normalized.includes("checked-deposit")) return "проверенного источника депозита";
  if (normalized.includes("selected")) return "выбранного источника";
  return "проверенного источника";
}

function sourceExposureText(message: string, locale: BotLocale): string | null {
  const normalized = message.trim().toLowerCase();
  const sourceMatch = message.match(/^(HTX\/Huobi|Clean CEX|Bridge\/router\/DEX|Unknown contract|Risky label) accounts for (\d+(?:[.,]\d+)?)% of (checked-deposit source share|selected source share)\.?$/i);
  if (sourceMatch) {
    const [, source, share, noun] = sourceMatch;
    if (locale === "en") return `${source} accounts for ${normalizedPercent(share)}% of ${noun}.`;
    const sourceText = source.toLowerCase() === "clean cex"
      ? "чистый CEX"
      : source.toLowerCase() === "bridge/router/dex"
        ? "bridge/router/DEX"
        : source.toLowerCase() === "unknown contract"
          ? "неизвестный смарт-контракт"
          : source.toLowerCase() === "risky label"
            ? "адрес с риск-лейблом"
            : source;
    return `${normalizedPercent(share)}% ${sourceShareNounText(noun, locale)} относится к ${sourceText}.`;
  }

  const observedUnknown = message.match(/^observed unknown source paths account for (\d+(?:[.,]\d+)?)% of checked-deposit source share\.?$/i);
  if (observedUnknown) {
    return locale === "ru"
      ? `${normalizedPercent(observedUnknown[1])}% проверенного источника депозита осталось в неизвестных ветках происхождения.`
      : `${normalizedPercent(observedUnknown[1])}% of checked-deposit source share remains in observed unknown source paths.`;
  }

  const whitebit = message.match(/^WhiteBIT source-policy context accounts for (\d+(?:[.,]\d+)?)% of checked-deposit source share and is kept in unknown\.?$/i);
  if (whitebit) {
    return locale === "ru"
      ? `${normalizedPercent(whitebit[1])}% проверенного источника депозита связано с WhiteBIT policy-контекстом; эта доля оставлена как неизвестная.`
      : `WhiteBIT source-policy context accounts for ${normalizedPercent(whitebit[1])}% of checked-deposit source share and is kept in unknown.`;
  }

  const uncovered = message.match(/^uncovered (checked-deposit source share|selected source share) is assigned to unknown\.?$/i);
  if (uncovered) {
    return locale === "ru"
      ? `Непокрытая часть ${sourceShareNounText(uncovered[1], locale)} отнесена к неизвестному источнику.`
      : `Uncovered ${uncovered[1]} is assigned to unknown.`;
  }

  const bundleLimited = normalized === "source bundle coverage-limited: graph budget stopped before every material boundary was resolved.";
  if (bundleLimited) {
    return locale === "ru"
      ? "Покрытие источников ограничено: граф остановился до того, как все существенные границы происхождения были разрешены."
      : "Source bundle coverage is limited: the graph budget stopped before every material boundary was resolved.";
  }

  return null;
}

function senderHistoryText(message: string, locale: BotLocale): string | null {
  const htx = message.match(/^Historical HTX\/Huobi sender inflow is (\d+(?:[.,]\d+)?)% of incoming wallet volume; background context only, not fresh deposit proof\.?$/i);
  if (htx) {
    return locale === "ru"
      ? `Исторические входящие от HTX/Huobi составляют ${normalizedPercent(htx[1])}% входящего объёма отправителя. Это фоновый контекст, не доказательство источника именно этого депозита.`
      : `Historical HTX/Huobi sender inflow is ${normalizedPercent(htx[1])}% of incoming wallet volume; background context only, not fresh deposit proof.`;
  }

  const cleanCex = message.match(/^Historical clean CEX sender inflow is (\d+(?:[.,]\d+)?)% of incoming wallet volume\.?$/i);
  if (cleanCex) {
    return locale === "ru"
      ? `Исторические входящие от чистых CEX составляют ${normalizedPercent(cleanCex[1])}% входящего объёма отправителя.`
      : `Historical clean CEX sender inflow is ${normalizedPercent(cleanCex[1])}% of incoming wallet volume.`;
  }

  const bridge = message.match(/^Sender history touches bridge\/router\/DEX volume at (\d+(?:[.,]\d+)?)% of total sender-related volume\.?$/i);
  if (bridge) {
    return locale === "ru"
      ? `В истории отправителя есть bridge/router/DEX объём: ${normalizedPercent(bridge[1])}% всего связанного объёма.`
      : `Sender history touches bridge/router/DEX volume at ${normalizedPercent(bridge[1])}% of total sender-related volume.`;
  }

  const unknownContract = message.match(/^Sender history touches unknown-contract volume at (\d+(?:[.,]\d+)?)% of total sender-related volume\.?$/i);
  if (unknownContract) {
    return locale === "ru"
      ? `В истории отправителя есть объём через неизвестные смарт-контракты: ${normalizedPercent(unknownContract[1])}% всего связанного объёма.`
      : `Sender history touches unknown-contract volume at ${normalizedPercent(unknownContract[1])}% of total sender-related volume.`;
  }

  const unknownCounterparty = message.match(/^Sender history includes unknown counterparty volume at (\d+(?:[.,]\d+)?)% of total sender-related volume\.?$/i);
  if (unknownCounterparty) {
    return locale === "ru"
      ? `В истории отправителя ${normalizedPercent(unknownCounterparty[1])}% связанного объёма приходится на неизвестных контрагентов.`
      : `Sender history includes unknown counterparty volume at ${normalizedPercent(unknownCounterparty[1])}% of total sender-related volume.`;
  }

  const whitebit = message.match(/^WhiteBIT wallet exposure is treated as background source-policy context at (\d+(?:[.,]\d+)?)% of total sender-related volume\.?$/i);
  if (whitebit) {
    return locale === "ru"
      ? `WhiteBIT exposure в истории отправителя составляет ${normalizedPercent(whitebit[1])}% связанного объёма; это фоновый source-policy контекст.`
      : `WhiteBIT wallet exposure is treated as background source-policy context at ${normalizedPercent(whitebit[1])}% of total sender-related volume.`;
  }

  if (message.trim().toLowerCase() === "sender has both incoming and outgoing volume inside the exposure window.") {
    return locale === "ru"
      ? "У отправителя были и входящие, и исходящие переводы внутри окна анализа: это похоже на рабочий/ликвидный транзитный кошелёк."
      : "Sender has both incoming and outgoing volume inside the exposure window.";
  }

  return null;
}

function contractVerdictReasonText(message: string, locale: BotLocale): string | null {
  const normalized = message.trim().toLowerCase();
  if (normalized === "unknown contract funded sender shortly before deposit.") {
    return locale === "ru"
      ? "Отправитель получил средства от неизвестного смарт-контракта незадолго до депозита."
      : message;
  }
  if (normalized === "sender was funded shortly before this deposit by unknown smart contract.") {
    return locale === "ru"
      ? "Отправитель был пополнен неизвестным смарт-контрактом незадолго до этого депозита."
      : message;
  }
  if (normalized.includes("exact approval-drain profile with transferfrom root evidence")) {
    return locale === "ru"
      ? "Найден точный approval-drain профиль: после approve контракт списал USDT через transferFrom у исходного владельца."
      : "Exact approval-drain profile was found: after approve, the contract moved USDT with transferFrom from the original owner.";
  }
  if (normalized === "clean contract intent could not be verified automatically.") {
    return locale === "ru"
      ? "Назначение контракта не удалось автоматически подтвердить как чистое."
      : message;
  }
  if (/matched deterministic service metadata\.?$/i.test(message.trim())) {
    return locale === "ru"
      ? "Контракт совпал с локальными признаками известного сервиса."
      : message;
  }
  if (/service contract matched deterministic allowlist\.?$/i.test(message.trim())) {
    return locale === "ru"
      ? "Контракт сервиса совпал с локальным allowlist."
      : message;
  }
  if (normalized.includes("verify20")) {
    return locale === "ru"
      ? "В контрактном маршруте есть Verify20/wrapper-вызовы: это сильный drainer-campaign контекст, но не точное доказательство кражи без approve/transferFrom/provenance цепочки."
      : message;
  }
  return null;
}

export function normalizeNotificationReason(message: string, locale: BotLocale): string {
  const normalized = message.trim().toLowerCase();

  const rawText = rawActionOrReasonText(message, locale);
  if (rawText) return rawText;

  const incomingCoverage = incomingDepositCoverageText(message, locale);
  if (incomingCoverage) return incomingCoverage;

  const sourceExposure = sourceExposureText(message, locale);
  if (sourceExposure) return sourceExposure;

  const senderHistory = senderHistoryText(message, locale);
  if (senderHistory) return senderHistory;

  const contractReason = contractVerdictReasonText(message, locale);
  if (contractReason) return contractReason;

  if (isCleanSourceNotProven(message.trim())) {
    return cleanSourceText(locale);
  }

  const sanctionedText = sanctionedServiceText(message, locale);
  if (sanctionedText) return sanctionedText;

  const approvalText = approvalDrainText(message, locale);
  if (approvalText) return approvalText;

  if (normalized.includes("clean cex origin is not fully proven")) {
    return locale === "ru"
      ? "Чистый CEX-источник не доказан полностью. Кошелёк похож на операционный или ликвидный, жёстких плохих доказательств нет."
      : "Clean CEX origin is not fully proven. The wallet looks operational or liquidity-like, and no hard bad evidence was found.";
  }

  if (normalized.includes("material unknown source boundary")) {
    return locale === "ru"
      ? "Граф остановился на существенной неизвестной границе источника."
      : "The graph stopped at a material unknown source boundary.";
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

  if (normalized.includes("manual review required")) {
    return replaceManualReviewRequired(message, locale);
  }

  if (normalized.includes("no obvious risk signals") || normalized.includes("no critical risk")) {
    return noCriticalRiskText(locale);
  }

  return message;
}
