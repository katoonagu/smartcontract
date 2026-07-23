import type {
  AttributionPolicy,
  GoldenDecision
} from "./contracts";
import { canonicalJson, canonicalSha256 } from "./canonicalJson";
import {
  assertReviewsReadyForUnblind,
  type LockedReviewV2,
  type ReviewFindingV2
} from "./reviewWorkspace";

export type AdjudicationDisagreementV2 = {
  id: string;
  field: string;
  reviewerHashes: [string, string];
  reviewerValues: [unknown, unknown];
  resolution: unknown | null;
};

export type ResolvedAdjudicationFactV2 = {
  canonicalFactId: string;
  lane: "hard" | "pattern" | "context" | "neutral";
  role: string;
  directness: "direct" | "indirect" | "not_applicable";
  timing: "at_event" | "later" | "not_applicable";
};

export type AdjudicationResolutionV2 = {
  resolvedFacts: ResolvedAdjudicationFactV2[];
  selectedAttributionPolicy: AttributionPolicy | null;
  expectedDecision: GoldenDecision | null;
  exactScore: number | null;
  scoreProperties: string[];
  dossierAggregates: Record<string, string>;
  telegramExpectation: Array<{
    locale: "ru" | "en";
    exactHtml: string;
  }>;
  adjudicatorId: string | null;
  adjudicatedAt: string | null;
};

export type AdjudicationDraftV2 = {
  version: "golden-adjudication-draft-v2";
  caseId: string;
  neutralBundleSha256: string;
  reviewerHashes: [string, string];
  reviewedCanonicalFactIds: string[];
  disagreements: AdjudicationDisagreementV2[];
  resolution: AdjudicationResolutionV2;
};

export type FinalAdjudicationV2 = {
  version: "golden-adjudication-v2";
  caseId: string;
  neutralBundleSha256: string;
  reviewerHashes: [string, string];
  resolvedFacts: ResolvedAdjudicationFactV2[];
  selectedAttributionPolicy: AttributionPolicy;
  expectedDecision: GoldenDecision;
  exactScore: number;
  scoreProperties: string[];
  dossierAggregates: Record<string, string>;
  telegramExpectation: Array<{
    locale: "ru" | "en";
    exactHtml: string;
  }>;
  adjudicatorId: string;
  adjudicatedAt: string;
};

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(lexical);
}

function findingMap(review: LockedReviewV2): Map<string, ReviewFindingV2> {
  const result = new Map<string, ReviewFindingV2>();
  for (const finding of review.findings) {
    if (result.has(finding.canonicalFactId)) {
      throw new TypeError(
        `golden_review_duplicate_fact:${finding.canonicalFactId}`
      );
    }
    result.set(finding.canonicalFactId, finding);
  }
  return result;
}

function addDisagreement(
  disagreements: AdjudicationDisagreementV2[],
  reviewerHashes: [string, string],
  field: string,
  left: unknown,
  right: unknown
): void {
  if (equal(left, right)) {
    return;
  }
  disagreements.push({
    id: canonicalSha256({ field, reviewerHashes }),
    field,
    reviewerHashes,
    reviewerValues: [left, right],
    resolution: null
  });
}

export function openAdjudication(
  reviews: LockedReviewV2[]
): AdjudicationDraftV2 {
  const ready = assertReviewsReadyForUnblind(reviews);
  for (const review of ready) {
    if (review.artifact.sha256 !== review.reviewSha256) {
      throw new TypeError("golden_locked_review_hash_mismatch");
    }
  }
  const [left, right] = [...ready].sort((a, b) =>
    lexical(a.reviewSha256, b.reviewSha256)
  ) as [LockedReviewV2, LockedReviewV2];
  const reviewerHashes: [string, string] = [
    left.reviewSha256,
    right.reviewSha256
  ];
  const disagreements: AdjudicationDisagreementV2[] = [];

  addDisagreement(
    disagreements,
    reviewerHashes,
    "decision",
    left.decision,
    right.decision
  );

  const leftFacts = findingMap(left);
  const rightFacts = findingMap(right);
  const factIds = sortedStrings(
    [...new Set([...leftFacts.keys(), ...rightFacts.keys()])]
  );
  for (const factId of factIds) {
    const leftFact = leftFacts.get(factId);
    const rightFact = rightFacts.get(factId);
    if (!leftFact || !rightFact) {
      addDisagreement(
        disagreements,
        reviewerHashes,
        `findings.${factId}.presence`,
        leftFact !== undefined,
        rightFact !== undefined
      );
      continue;
    }
    for (const field of [
      "lane",
      "subjectRole",
      "counterpartyRole",
      "directness",
      "timing"
    ] as const) {
      addDisagreement(
        disagreements,
        reviewerHashes,
        `findings.${factId}.${field}`,
        leftFact[field],
        rightFact[field]
      );
    }
    addDisagreement(
      disagreements,
      reviewerHashes,
      `findings.${factId}.evidenceRefs`,
      sortedStrings(leftFact.evidenceRefs),
      sortedStrings(rightFact.evidenceRefs)
    );
  }

  addDisagreement(
    disagreements,
    reviewerHashes,
    "terminalBoundaries",
    sortedStrings(left.terminalBoundaries),
    sortedStrings(right.terminalBoundaries)
  );
  addDisagreement(
    disagreements,
    reviewerHashes,
    "preferredAttributionPolicy",
    left.preferredAttributionPolicy,
    right.preferredAttributionPolicy
  );
  addDisagreement(
    disagreements,
    reviewerHashes,
    "attributionResults",
    left.attributionResults,
    right.attributionResults
  );

  const aggregateKeys = sortedStrings([
    ...new Set([
      ...Object.keys(left.dossierAggregates),
      ...Object.keys(right.dossierAggregates)
    ])
  ]);
  for (const key of aggregateKeys) {
    addDisagreement(
      disagreements,
      reviewerHashes,
      `dossierAggregates.${key}`,
      left.dossierAggregates[key] ?? null,
      right.dossierAggregates[key] ?? null
    );
  }
  addDisagreement(
    disagreements,
    reviewerHashes,
    "scoreProperties",
    sortedStrings(left.scoreProperties),
    sortedStrings(right.scoreProperties)
  );

  return {
    version: "golden-adjudication-draft-v2",
    caseId: left.caseId,
    neutralBundleSha256: left.neutralBundleSha256,
    reviewerHashes,
    reviewedCanonicalFactIds: factIds,
    disagreements,
    resolution: {
      resolvedFacts: [],
      selectedAttributionPolicy: null,
      expectedDecision: null,
      exactScore: null,
      scoreProperties: [],
      dossierAggregates: {},
      telegramExpectation: [],
      adjudicatorId: null,
      adjudicatedAt: null
    }
  };
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(error);
  }
  return value;
}

function timestamp(value: unknown): string {
  const result = requiredString(
    value,
    "golden_invalid_adjudication_timestamp"
  );
  const parsed = Date.parse(result);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== result
  ) {
    throw new TypeError("golden_invalid_adjudication_timestamp");
  }
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  error: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(error);
  }
  return value as T;
}

function uniqueStrings(value: unknown, error: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(error);
  }
  const result = value.map((item) => requiredString(item, error));
  if (new Set(result).size !== result.length) {
    throw new TypeError(error);
  }
  return sortedStrings(result);
}

function resolvedFacts(
  value: unknown,
  reviewedFactIds: Set<string>
): ResolvedAdjudicationFactV2[] {
  if (!Array.isArray(value)) {
    throw new TypeError("golden_invalid_resolved_facts");
  }
  const seen = new Set<string>();
  return value
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new TypeError("golden_invalid_resolved_facts");
      }
      const source = item as Record<string, unknown>;
      const canonicalFactId = requiredString(
        source.canonicalFactId,
        "golden_invalid_resolved_facts"
      );
      if (seen.has(canonicalFactId)) {
        throw new TypeError("golden_fact_multiple_scoring_lanes");
      }
      if (!reviewedFactIds.has(canonicalFactId)) {
        throw new TypeError(
          `golden_unreviewed_fact:${canonicalFactId}`
        );
      }
      seen.add(canonicalFactId);
      return {
        canonicalFactId,
        lane: oneOf(
          source.lane,
          ["hard", "pattern", "context", "neutral"] as const,
          "golden_invalid_resolved_facts"
        ),
        role: requiredString(
          source.role,
          "golden_invalid_resolved_facts"
        ),
        directness: oneOf(
          source.directness,
          ["direct", "indirect", "not_applicable"] as const,
          "golden_invalid_resolved_facts"
        ),
        timing: oneOf(
          source.timing,
          ["at_event", "later", "not_applicable"] as const,
          "golden_invalid_resolved_facts"
        )
      };
    })
    .sort((left, right) =>
      lexical(left.canonicalFactId, right.canonicalFactId)
    );
}

function dossierAggregates(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("golden_invalid_dossier_aggregates");
  }
  const result: Record<string, string> = {};
  for (const key of Object.keys(value).sort(lexical)) {
    result[requiredString(key, "golden_invalid_dossier_aggregates")] =
      requiredString(
        (value as Record<string, unknown>)[key],
        "golden_invalid_dossier_aggregates"
      );
  }
  return result;
}

function telegramExpectations(
  value: unknown
): FinalAdjudicationV2["telegramExpectation"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("golden_invalid_telegram_expectation");
  }
  const locales = new Set<string>();
  const result = value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError("golden_invalid_telegram_expectation");
    }
    const source = item as Record<string, unknown>;
    const locale = oneOf(
      source.locale,
      ["ru", "en"] as const,
      "golden_invalid_telegram_expectation"
    );
    if (locales.has(locale)) {
      throw new TypeError("golden_invalid_telegram_expectation");
    }
    locales.add(locale);
    return {
      locale,
      exactHtml: requiredString(
        source.exactHtml,
        "golden_invalid_telegram_expectation"
      )
    };
  });
  return result.sort((left, right) => lexical(left.locale, right.locale));
}

function assertDisagreementResolutions(
  draft: AdjudicationDraftV2,
  facts: ResolvedAdjudicationFactV2[],
  selectedAttributionPolicy: AttributionPolicy,
  expectedDecision: GoldenDecision,
  scoreProperties: string[],
  aggregates: Record<string, string>
): void {
  const factsById = new Map(facts.map((fact) => [fact.canonicalFactId, fact]));
  for (const disagreement of draft.disagreements) {
    if (disagreement.resolution === null || disagreement.resolution === undefined) {
      throw new TypeError("golden_adjudication_unresolved");
    }
    if (
      disagreement.field === "decision" &&
      disagreement.resolution !== expectedDecision
    ) {
      throw new TypeError("golden_adjudication_resolution_mismatch");
    }
    if (
      disagreement.field === "preferredAttributionPolicy" &&
      disagreement.resolution !== selectedAttributionPolicy
    ) {
      throw new TypeError("golden_adjudication_resolution_mismatch");
    }
    if (disagreement.field === "scoreProperties") {
      if (!equal(sortedStrings(disagreement.resolution as string[]), scoreProperties)) {
        throw new TypeError("golden_adjudication_resolution_mismatch");
      }
    }
    if (disagreement.field.startsWith("dossierAggregates.")) {
      const key = disagreement.field.slice("dossierAggregates.".length);
      if (disagreement.resolution !== (aggregates[key] ?? null)) {
        throw new TypeError("golden_adjudication_resolution_mismatch");
      }
    }
    const findingMatch = /^findings\.(.+)\.(lane|subjectRole|directness|timing)$/u.exec(
      disagreement.field
    );
    if (findingMatch) {
      const fact = factsById.get(findingMatch[1]!);
      const finalField =
        findingMatch[2] === "subjectRole" ? "role" : findingMatch[2]!;
      if (
        fact === undefined ||
        disagreement.resolution !==
          fact[finalField as "lane" | "role" | "directness" | "timing"]
      ) {
        throw new TypeError("golden_adjudication_resolution_mismatch");
      }
    }
  }
}

export function finalizeAdjudication(
  draft: AdjudicationDraftV2
): FinalAdjudicationV2 {
  if (draft.version !== "golden-adjudication-draft-v2") {
    throw new TypeError("golden_invalid_adjudication_draft");
  }
  if (
    draft.disagreements.some(
      (item) => item.resolution === null || item.resolution === undefined
    )
  ) {
    throw new TypeError("golden_adjudication_unresolved");
  }
  const resolution = draft.resolution;
  const facts = resolvedFacts(
    resolution.resolvedFacts,
    new Set(draft.reviewedCanonicalFactIds)
  );
  const selectedAttributionPolicy = oneOf(
    resolution.selectedAttributionPolicy,
    ["fifo", "lifo", "proportional"] as const,
    "golden_invalid_attribution_policy"
  );
  const expectedDecision = oneOf(
    resolution.expectedDecision,
    ["ACCEPTABLE", "REVIEW", "DECLINE"] as const,
    "golden_invalid_expected_decision"
  );
  if (
    typeof resolution.exactScore !== "number" ||
    !Number.isInteger(resolution.exactScore) ||
    resolution.exactScore < 0 ||
    resolution.exactScore > 100
  ) {
    throw new TypeError("golden_invalid_exact_score");
  }
  const scoreProperties = uniqueStrings(
    resolution.scoreProperties,
    "golden_invalid_score_properties"
  );
  const aggregates = dossierAggregates(resolution.dossierAggregates);
  const telegramExpectation = telegramExpectations(
    resolution.telegramExpectation
  );
  const adjudicatorId = requiredString(
    resolution.adjudicatorId,
    "golden_invalid_adjudicator"
  );
  const adjudicatedAt = timestamp(resolution.adjudicatedAt);

  assertDisagreementResolutions(
    draft,
    facts,
    selectedAttributionPolicy,
    expectedDecision,
    scoreProperties,
    aggregates
  );

  return {
    version: "golden-adjudication-v2",
    caseId: draft.caseId,
    neutralBundleSha256: draft.neutralBundleSha256,
    reviewerHashes: draft.reviewerHashes,
    resolvedFacts: facts,
    selectedAttributionPolicy,
    expectedDecision,
    exactScore: resolution.exactScore,
    scoreProperties,
    dossierAggregates: aggregates,
    telegramExpectation,
    adjudicatorId,
    adjudicatedAt
  };
}
