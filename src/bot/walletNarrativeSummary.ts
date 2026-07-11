export type WalletNarrativeLocale = "ru" | "en";

export type WalletNarrativeDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "NO_FINAL_DECISION";

export type NarrativeFactKind =
  | "usdt_blacklist"
  | "direct_counterparty_blacklist"
  | "approval_drain"
  | "direct_counterparty_sanction"
  | "direct_counterparty_exact_label"
  | "sanctioned_source"
  | "verify20_template"
  | "bridge_route"
  | "unknown_contract"
  | "risky_counterparty"
  | "cex_source"
  | "collector"
  | "gasfree_fee";

export type NarrativeFact = {
  id: string;
  kind: NarrativeFactKind;
  factTextRu: string;
  factTextEn: string;
};

export type CoverageExplanation = {
  textRu: string;
  textEn: string;
  isRiskEvidence: false;
};

export type WalletNarrativeCase = {
  locale: WalletNarrativeLocale;
  decision: WalletNarrativeDecision;
  score: number | null;
  facts: NarrativeFact[];
  coverageExplanation: CoverageExplanation | null;
};

const MAX_PART_LENGTH = 280;
const MAX_BODY_LENGTH = 500;
const FORBIDDEN_COPY = /Почему|Что это может значить|Что важно учесть|drain episode|anchor coverage/i;
const KNOWN_INTERNAL_CODES = new Set([
  "approval_drain_exact",
  "approval_drain_proximity",
  "clean_cex_source",
  "drainer_like",
  "edd_sof",
  "forensic_approval_drain_provenance",
  "hard_safety_limit_exceeded",
  "htx_huobi_source",
  "incoming_history_not_fetched",
  "insufficient_coverage",
  "internal_scam_label",
  "llm_contract_suspicion",
  "local_budget_limited",
  "local_index_read_failed",
  "manual_review_required",
  "partial_budget_exhausted",
  "provider_cap_unresolved",
  "provider_error",
  "provider_inconsistent",
  "rate_limited_after_retries",
  "service_boundary",
  "unknown_contract_boundary",
  "unknown_suspicious",
  "usdt_blacklist",
  "whitebit_source"
]);

const factRank: Record<NarrativeFactKind, number> = {
  usdt_blacklist: 0,
  direct_counterparty_blacklist: 1,
  approval_drain: 2,
  direct_counterparty_sanction: 3,
  direct_counterparty_exact_label: 3,
  sanctioned_source: 3,
  verify20_template: 4,
  bridge_route: 5,
  unknown_contract: 5,
  risky_counterparty: 6,
  cex_source: 7,
  collector: 8,
  gasfree_fee: 9
};

const narrativeFactKinds = new Set<string>(Object.keys(factRank));
const narrativeDecisions = new Set<string>([
  "ACCEPTABLE",
  "REVIEW",
  "DECLINE",
  "NO_FINAL_DECISION"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsKnownInternalCode(value: string): boolean {
  return (value.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])
    .some((token) => KNOWN_INTERNAL_CODES.has(token.toLowerCase()));
}

function normalizeCopy(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > MAX_PART_LENGTH) {
    throw new RangeError(`Wallet narrative parts must not exceed ${MAX_PART_LENGTH} characters.`);
  }
  if (FORBIDDEN_COPY.test(normalized) || containsKnownInternalCode(normalized)) {
    throw new Error("Forbidden normal narrative copy must be translated before formatting.");
  }
  return normalized;
}

function localizedFactText(fact: NarrativeFact, locale: WalletNarrativeLocale): string {
  return locale === "en" ? fact.factTextEn : fact.factTextRu;
}

function localizedCoverageText(
  coverage: CoverageExplanation,
  locale: WalletNarrativeLocale
): string {
  return locale === "en" ? coverage.textEn : coverage.textRu;
}

function sentenceKeys(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter(Boolean);
}

function validateScore(decision: WalletNarrativeDecision, score: number | null): void {
  if (decision === "NO_FINAL_DECISION") {
    if (score !== null) throw new Error("NO_FINAL_DECISION must not have a score.");
    return;
  }
  if (score === null) throw new Error(`${decision} requires a score.`);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError("Wallet narrative score must be an integer between 0 and 100.");
  }
}

function validateWalletNarrativeCase(input: unknown): asserts input is WalletNarrativeCase {
  if (!isRecord(input)) throw new Error("Wallet narrative case must be an object.");
  if (input.locale !== "ru" && input.locale !== "en") {
    throw new Error('Wallet narrative locale must be "ru" or "en".');
  }
  if (typeof input.decision !== "string" || !narrativeDecisions.has(input.decision)) {
    throw new Error("Wallet narrative decision is invalid.");
  }
  validateScore(input.decision as WalletNarrativeDecision, input.score as number | null);
  if (!Array.isArray(input.facts)) throw new Error("Wallet narrative facts must be an array.");
  input.facts.forEach((fact, index) => {
    if (!isRecord(fact)) throw new Error(`Wallet narrative fact at index ${index} must be an object.`);
    if (typeof fact.id !== "string") throw new Error("Wallet narrative fact id must be a string.");
    if (typeof fact.kind !== "string" || !narrativeFactKinds.has(fact.kind)) {
      throw new Error("Wallet narrative fact kind is invalid.");
    }
    if (typeof fact.factTextRu !== "string" || typeof fact.factTextEn !== "string") {
      throw new Error("Wallet narrative fact texts must be strings.");
    }
  });
  if (input.coverageExplanation === null) return;
  if (!isRecord(input.coverageExplanation)) {
    throw new Error("Wallet narrative coverage must be an object or null.");
  }
  if (
    typeof input.coverageExplanation.textRu !== "string" ||
    typeof input.coverageExplanation.textEn !== "string"
  ) {
    throw new Error("Wallet narrative coverage texts must be strings.");
  }
  if (input.coverageExplanation.isRiskEvidence !== false) {
    throw new Error("Wallet narrative coverage must be a limitation, not risk evidence.");
  }
}

export function buildWalletNarrativeCase(input: WalletNarrativeCase): WalletNarrativeCase {
  validateWalletNarrativeCase(input);

  const facts = input.facts.flatMap((fact) => {
    const normalized: NarrativeFact = {
      ...fact,
      id: fact.id.trim(),
      factTextRu: normalizeCopy(fact.factTextRu),
      factTextEn: normalizeCopy(fact.factTextEn)
    };
    return normalized.id && localizedFactText(normalized, input.locale) ? [normalized] : [];
  });

  const coverage = input.coverageExplanation;
  const coverageExplanation = coverage
    ? {
        textRu: normalizeCopy(coverage.textRu),
        textEn: normalizeCopy(coverage.textEn),
        isRiskEvidence: false as const
      }
    : null;

  return {
    locale: input.locale,
    decision: input.decision,
    score: input.score,
    facts,
    coverageExplanation: coverageExplanation && localizedCoverageText(coverageExplanation, input.locale)
      ? coverageExplanation
      : null
  };
}

export function selectNarrativeFacts(caseData: WalletNarrativeCase): NarrativeFact[] {
  const selected: NarrativeFact[] = [];
  const usedSentences = new Set<string>();
  const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const compareFacts = (left: NarrativeFact, right: NarrativeFact) =>
    factRank[left.kind] - factRank[right.kind] ||
    compareText(left.id, right.id) ||
    compareText(left.kind, right.kind) ||
    compareText(left.factTextRu, right.factTextRu) ||
    compareText(left.factTextEn, right.factTextEn);
  const canonicalById = new Map<string, NarrativeFact>();
  for (const fact of [...caseData.facts].sort(compareFacts)) {
    if (!canonicalById.has(fact.id)) canonicalById.set(fact.id, fact);
  }
  const facts = [...canonicalById.values()].sort(compareFacts);

  for (const fact of facts) {
    const sentences = sentenceKeys(localizedFactText(fact, caseData.locale));
    if (sentences.length === 0 || sentences.some((sentence) => usedSentences.has(sentence))) continue;
    selected.push(fact);
    sentences.forEach((sentence) => usedSentences.add(sentence));
    if (selected.length === 2) break;
  }

  return selected;
}

function scoredHeader(caseData: WalletNarrativeCase): string {
  const score = caseData.score as number;
  const band = score >= 85
    ? { icon: "🔴", ru: "критический риск", en: "critical risk" }
    : score >= 60
      ? { icon: "🟠", ru: "высокий риск", en: "high risk" }
      : score >= 30
        ? { icon: "🟡", ru: "средний риск", en: "medium risk" }
        : { icon: "🟢", ru: "низкий риск", en: "low risk" };
  const action = caseData.locale === "en"
    ? {
        ACCEPTABLE: "You can proceed.",
        REVIEW: "Pause the operation and review it manually.",
        DECLINE: "Do not proceed."
      }[caseData.decision as Exclude<WalletNarrativeDecision, "NO_FINAL_DECISION">]
    : {
        ACCEPTABLE: "Можно принять.",
        REVIEW: "Поставьте операцию на паузу и проверьте вручную.",
        DECLINE: "Операцию не проводить."
      }[caseData.decision as Exclude<WalletNarrativeDecision, "NO_FINAL_DECISION">];
  return `${band.icon} ${score}/100 — ${caseData.locale === "en" ? band.en : band.ru}. ${action}`;
}

function header(caseData: WalletNarrativeCase): string {
  if (caseData.decision !== "NO_FINAL_DECISION") return scoredHeader(caseData);
  return caseData.locale === "en"
    ? "⚪ No final result. Pause the operation until the check is repeated."
    : "⚪ Итог не рассчитан. Поставьте операцию на паузу до повторной проверки.";
}

function fitsBody(parts: string[]): boolean {
  return parts.length === 0 || `\n\n${parts.join("\n\n")}`.length <= MAX_BODY_LENGTH;
}

export function formatWalletNarrativeSummary(input: WalletNarrativeCase): string {
  const caseData = buildWalletNarrativeCase(input);
  const selected = selectNarrativeFacts(caseData);
  const factParts = selected.map((fact, index) => [
    caseData.locale === "en"
      ? index === 0 ? "Finding" : "Conclusion"
      : index === 0 ? "Что нашли" : "Вывод",
    localizedFactText(fact, caseData.locale)
  ].join("\n"));

  let coveragePart: string | null = null;
  const coverageSentences = new Set<string>();
  const coverage = caseData.coverageExplanation;
  if (coverage) {
    const coverageText = localizedCoverageText(coverage, caseData.locale);
    const usedSentences = new Set(selected.slice(0, 1).flatMap((fact) =>
      sentenceKeys(localizedFactText(fact, caseData.locale))
    ));
    if (!sentenceKeys(coverageText).some((sentence) => usedSentences.has(sentence))) {
      sentenceKeys(coverageText).forEach((sentence) => coverageSentences.add(sentence));
      coveragePart = [
        caseData.locale === "en" ? "Coverage limits" : "Границы проверки",
        coverageText
      ].join("\n");
    }
  }

  const parts = factParts.slice(0, 1);
  if (coveragePart && fitsBody([...parts, coveragePart])) {
    parts.push(coveragePart);
  } else {
    coveragePart = null;
    coverageSentences.clear();
  }
  const conclusionPart = factParts[1];
  const conclusionIndex = parts.length > 0 ? 1 : 0;
  const conclusionDuplicatesCoverage = selected[1] && sentenceKeys(localizedFactText(selected[1], caseData.locale))
    .some((sentence) => coverageSentences.has(sentence));
  const withConclusion = [...parts.slice(0, conclusionIndex), conclusionPart, ...parts.slice(conclusionIndex)];
  if (conclusionPart && !conclusionDuplicatesCoverage && fitsBody(withConclusion)) {
    parts.splice(conclusionIndex, 0, conclusionPart);
  }

  return [header(caseData), ...parts].join("\n\n");
}
