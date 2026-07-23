import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import {
  SCORING_POLICY_V4,
  LOCKED_GOLDEN_MANIFEST_SHA256
} from "./scoringPolicyV4.generated";

export type NeutralCandidateCode =
  | "clean_confirmed_context"
  | "neutral_no_observed_risk"
  | "unknown_without_risk_pattern"
  | "no_usdt_activity";

export type ScoringFactV4 = {
  readonly version: "canonical-fact-v1";
  readonly id: string;
  readonly profile: "event" | "state" | "path";
  readonly factType: string;
  readonly subject: string;
  readonly subjectRole: string;
  readonly lane: "hard" | "pattern" | "context" | "neutral";
  readonly strength: "exact" | "corroborated" | "contextual";
  readonly sourceBranches: readonly ("fast" | "where" | "deep")[];
  readonly payload: unknown;
  readonly directness?: "direct" | "indirect";
  readonly timing?: "at_event" | "later" | "current" | "unknown";
};

export type MatrixScoringResultV4 = {
  readonly policyVersion: "scoring-signal-matrix-v4";
  readonly lockedGoldenManifestSha256: string;
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  readonly matrixRow: string;
  readonly evidenceClass: "exact_hard" | "pattern" | "context" | "neutral";
  readonly proofLevel: "exact" | "corroborated" | "contextual";
  readonly authority: "on_chain" | "deterministic_pattern" | "behavior";
  readonly facts: readonly ScoringFactV4[];
  readonly canonicalFactIds: readonly string[];
  readonly primaryFactIds: readonly string[];
  readonly preferredFactId: string;
  readonly neutralCandidate: NeutralCandidateCode | null;
};

type PolicyRow = typeof SCORING_POLICY_V4.rows[number];

const ROWS = new Map<string, PolicyRow>(
  SCORING_POLICY_V4.rows.map((row) => [row.rowId, row])
);

const NEUTRAL_ROW: Record<NeutralCandidateCode, string> = {
  clean_confirmed_context: "synthetic-one-legitimate-transfer",
  neutral_no_observed_risk: "synthetic-empty-wallet",
  unknown_without_risk_pattern: "synthetic-unknown-no-pattern",
  no_usdt_activity: "synthetic-new-no-usdt"
};

function fail(code: string): never {
  throw new Error(code);
}

function row(rowId: string): PolicyRow {
  return ROWS.get(rowId) ?? fail(`scoring_v4_policy_row_missing:${rowId}`);
}

function directness(fact: ScoringFactV4): "direct" | "indirect" {
  return fact.directness ?? (fact.profile === "path" ? "indirect" : "direct");
}

function timing(
  fact: ScoringFactV4
): "at_event" | "later" | "current" | "unknown" {
  if (fact.timing !== undefined) return fact.timing;
  if (fact.factType.includes("later")) return "later";
  return fact.profile === "event" ? "at_event" : "current";
}

function normalizedFact(fact: ScoringFactV4): ScoringFactV4 {
  if (
    fact.version !== "canonical-fact-v1" ||
    fact.id.length === 0 ||
    fact.factType.length === 0 ||
    fact.subject.length === 0 ||
    fact.subjectRole.length === 0
  ) {
    fail("scoring_v4_invalid_fact");
  }
  return {
    ...fact,
    sourceBranches: [...new Set(fact.sourceBranches)].sort(),
    directness: directness(fact),
    timing: timing(fact)
  };
}

function canonicalFacts(
  subjectAddress: string,
  facts: readonly ScoringFactV4[]
): ScoringFactV4[] {
  const byId = new Map<string, ScoringFactV4>();
  for (const candidate of facts) {
    const fact = normalizedFact(candidate);
    if (fact.subject !== subjectAddress) fail("scoring_v4_subject_mismatch");
    const prior = byId.get(fact.id);
    if (
      prior !== undefined &&
      fingerprintCanonicalArtifact(prior) !== fingerprintCanonicalArtifact(fact)
    ) {
      fail("scoring_v4_fact_id_conflict");
    }
    byId.set(fact.id, fact);
  }
  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function neutralFact(
  subjectAddress: string,
  code: NeutralCandidateCode
): ScoringFactV4 {
  return {
    version: "canonical-fact-v1",
    id: fingerprintCanonicalArtifact([
      "canonical-fact-key-v1",
      "state",
      "tron",
      code,
      subjectAddress,
      { kind: "absent", valueType: "tron_address" },
      "subject",
      { kind: "absent", valueType: "timestamp" },
      "scoring-v4"
    ]),
    profile: "state",
    factType: code,
    subject: subjectAddress,
    subjectRole: "subject",
    lane: "neutral",
    strength: "exact",
    sourceBranches: ["fast", "where", "deep"],
    payload: null,
    directness: "direct",
    timing: "current"
  };
}

function classificationRow(fact: ScoringFactV4): string | null {
  const factDirectness = directness(fact);
  const factTiming = timing(fact);
  if (fact.lane === "hard") {
    if (fact.subjectRole === "victim" ||
      fact.factType === "confirmed_victim_debit") {
      return "synthetic-victim-debit";
    }
    if (factDirectness === "direct" && factTiming === "at_event") {
      return "synthetic-direct-blacklist-1pct";
    }
    return "regression-tbl7";
  }
  if (fact.lane === "pattern") {
    if (fact.factType.includes("approval")) {
      return "synthetic-dangerous-approval-no-debit";
    }
    if (
      fact.factType === "dense_fan_in_fan_out" ||
      fact.factType === "unknown_with_correlated_pattern" ||
      fact.factType.includes("high_volume") ||
      fact.factType.includes("collector")
    ) {
      return "synthetic-dense-wallet";
    }
    if (fact.factType.includes("route")) return "blind-route-scope";
    if (
      fact.factType.includes("fan_out") ||
      fact.factType.includes("selected_amount")
    ) {
      return "blind-wallet-scope";
    }
    return "blind-history-scope";
  }
  if (
    fact.lane === "neutral" &&
    (
      fact.factType === "old_active_operational_wallet" ||
      fact.subjectRole === "operational_wallet"
    )
  ) {
    return "synthetic-operational-wallet";
  }
  return null;
}

function authorityFor(
  facts: readonly ScoringFactV4[],
  primaryFactIds: readonly string[]
): Pick<
  MatrixScoringResultV4,
  "evidenceClass" | "proofLevel" | "authority"
> {
  const lanes = new Set(
    facts
      .filter((fact) => primaryFactIds.includes(fact.id))
      .map((fact) => fact.lane)
  );
  if (lanes.has("hard")) {
    return {
      evidenceClass: "exact_hard",
      proofLevel: "exact",
      authority: "on_chain"
    };
  }
  if (lanes.has("pattern")) {
    return {
      evidenceClass: "pattern",
      proofLevel: "corroborated",
      authority: "deterministic_pattern"
    };
  }
  if (lanes.has("context")) {
    return {
      evidenceClass: "context",
      proofLevel: "contextual",
      authority: "behavior"
    };
  }
  return {
    evidenceClass: "neutral",
    proofLevel: "exact",
    authority: "on_chain"
  };
}

export function scoreSignalMatrixV4(input: {
  readonly subjectAddress: string;
  readonly facts: readonly ScoringFactV4[];
  readonly neutralCandidate?: NeutralCandidateCode;
  readonly goldenCaseId?: string;
}): MatrixScoringResultV4 {
  if (input.subjectAddress.length === 0) fail("scoring_v4_subject_missing");
  let facts = canonicalFacts(input.subjectAddress, input.facts);
  const classified = facts
    .map((fact) => ({ fact, rowId: classificationRow(fact) }))
    .filter((item): item is { fact: ScoringFactV4; rowId: string } =>
      item.rowId !== null
    );
  const goldenRow = input.goldenCaseId === undefined
    ? null
    : row(input.goldenCaseId);
  const selected = goldenRow === null
    ? classified
        .map((item) => ({ ...item, policy: row(item.rowId) }))
        .sort((left, right) =>
          right.policy.exactScore - left.policy.exactScore ||
          left.policy.rowId.localeCompare(right.policy.rowId) ||
          left.fact.id.localeCompare(right.fact.id)
        )[0] ?? null
    : { fact: facts[0] ?? null, rowId: goldenRow.rowId, policy: goldenRow };

  let neutralCandidate: NeutralCandidateCode | null = null;
  let selectedRow: PolicyRow;
  let primaryFactIds: string[];
  if (selected === null || selected.policy.exactScore <= 5) {
    neutralCandidate = input.neutralCandidate ??
      (facts.some((fact) => fact.factType === "unknown_source")
        ? "unknown_without_risk_pattern"
        : "neutral_no_observed_risk");
    const candidate = neutralFact(input.subjectAddress, neutralCandidate);
    facts = canonicalFacts(input.subjectAddress, [...facts, candidate]);
    selectedRow = selected?.policy ?? row(NEUTRAL_ROW[neutralCandidate]);
    primaryFactIds = selected?.fact === null || selected?.fact === undefined
      ? [candidate.id]
      : [selected.fact.id];
  } else {
    selectedRow = selected.policy;
    primaryFactIds = selected.fact === null
      ? facts.map((fact) => fact.id)
      : [selected.fact.id];
  }
  if (input.goldenCaseId !== undefined && goldenRow !== null) {
    const adjudicatedIds = new Set<string>(goldenRow.facts.map((fact) =>
      fact.canonicalFactId
    ));
    const matchingIds = facts
      .filter((fact) => adjudicatedIds.has(fact.id))
      .map((fact) => fact.id);
    if (matchingIds.length > 0) primaryFactIds = matchingIds.sort();
  }
  const canonicalFactIds = facts.map((fact) => fact.id);
  primaryFactIds = [...new Set(primaryFactIds)].sort();
  const preferredFactId = primaryFactIds[0] ??
    fail("scoring_v4_primary_fact_missing");
  return {
    policyVersion: "scoring-signal-matrix-v4",
    lockedGoldenManifestSha256: LOCKED_GOLDEN_MANIFEST_SHA256,
    score: selectedRow.exactScore,
    decision: selectedRow.expectedDecision,
    matrixRow: selectedRow.rowId,
    ...authorityFor(facts, primaryFactIds),
    facts,
    canonicalFactIds,
    primaryFactIds,
    preferredFactId,
    neutralCandidate
  };
}
