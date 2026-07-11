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
const RAW_REASON_CODE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
const FORBIDDEN_COPY = /Почему|Что это может значить|Что важно учесть|drain episode|anchor coverage/i;

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

function normalizeCopy(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > MAX_PART_LENGTH) {
    throw new RangeError(`Wallet narrative parts must not exceed ${MAX_PART_LENGTH} characters.`);
  }
  if (FORBIDDEN_COPY.test(normalized) || RAW_REASON_CODE.test(normalized)) {
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
    .map((sentence) => sentence.trim().toLocaleLowerCase())
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

export function buildWalletNarrativeCase(input: WalletNarrativeCase): WalletNarrativeCase {
  validateScore(input.decision, input.score);

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
  const facts = [...caseData.facts].sort((left, right) =>
    factRank[left.kind] - factRank[right.kind] || left.id.localeCompare(right.id)
  );

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

export function formatWalletNarrativeSummary(input: WalletNarrativeCase): string {
  const caseData = buildWalletNarrativeCase(input);
  const selected = selectNarrativeFacts(caseData);
  const parts = selected.map((fact, index) => [
    caseData.locale === "en"
      ? index === 0 ? "Finding" : "Context"
      : index === 0 ? "Что нашли" : "Контекст",
    localizedFactText(fact, caseData.locale)
  ].join("\n"));

  const coverage = caseData.coverageExplanation;
  if (coverage) {
    const coverageText = localizedCoverageText(coverage, caseData.locale);
    const usedSentences = new Set(selected.flatMap((fact) =>
      sentenceKeys(localizedFactText(fact, caseData.locale))
    ));
    if (!sentenceKeys(coverageText).some((sentence) => usedSentences.has(sentence))) {
      parts.push([
        caseData.locale === "en" ? "Coverage limits" : "Границы проверки",
        coverageText
      ].join("\n"));
    }
  }

  return [header(caseData), ...parts].join("\n\n");
}
