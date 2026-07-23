import {
  canonicalizeEvidenceFacts,
  type CanonicalFactInput,
  type CanonicalFactV1
} from "../unifiedCheck/canonicalFacts";
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

export type ScoringFactV4 = CanonicalFactV1;

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

type GeneratedRule = typeof SCORING_POLICY_V4.rules[number];

type SemanticRule = {
  readonly ruleId: GeneratedRule["ruleId"];
  readonly factTypes: readonly string[];
  readonly roles: readonly string[];
  readonly lane: CanonicalFactV1["lane"];
  readonly strengths: readonly CanonicalFactV1["strength"][];
  readonly directness: CanonicalFactV1["directness"];
  readonly timings: readonly CanonicalFactV1["timing"][];
};

const GENERATED_RULES = new Map<string, GeneratedRule>(
  SCORING_POLICY_V4.rules.map((rule) => [rule.ruleId, rule])
);

const SEMANTIC_RULES: readonly SemanticRule[] = [
  {
    ruleId: "direct_blacklist_at_event",
    factTypes: ["blacklisted_at_transfer", "direct_blacklist_relation"],
    roles: ["receiver", "recipient", "drainer"],
    lane: "hard",
    strengths: ["exact"],
    directness: "direct",
    timings: ["at_event"]
  },
  {
    ruleId: "victim_confirmed_debit",
    factTypes: ["confirmed_victim_debit"],
    roles: ["victim"],
    lane: "hard",
    strengths: ["exact"],
    directness: "direct",
    timings: ["at_event"]
  },
  {
    ruleId: "dangerous_approval_no_debit",
    factTypes: ["dangerous_unlimited_approval"],
    roles: ["approval_owner"],
    lane: "pattern",
    strengths: ["exact", "corroborated"],
    directness: "direct",
    timings: ["at_event", "current"]
  },
  {
    ruleId: "correlated_dense_transit",
    factTypes: ["unknown_with_correlated_pattern", "dense_fan_in_fan_out"],
    roles: ["subject", "fan_in_fan_out_subject"],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "high_volume_transit",
    factTypes: ["high_volume_transit", "high_volume_inbound_outbound"],
    roles: [
      "subject",
      "high_volume_transit_wallet",
      "high_volume_recipient",
      "high_volume_sender"
    ],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "collector_transit",
    factTypes: ["collector_transit_pattern", "collector_pattern"],
    roles: [
      "subject",
      "sender",
      "receiver",
      "collector_sender",
      "collector_recipient"
    ],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "route_transit",
    factTypes: ["route_transit_pattern"],
    roles: ["subject", "sender", "receiver", "route_sender", "route_recipient"],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "selected_amount_transit",
    factTypes: ["selected_amount_forwarded"],
    roles: [
      "subject",
      "sender",
      "receiver",
      "selected_amount_sender",
      "selected_amount_recipient"
    ],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "fan_out",
    factTypes: ["fan_out_pattern"],
    roles: ["subject", "fan_out_funder_recipient", "fan_out_sender"],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "rapid_forwarding",
    factTypes: ["rapid_forwarding"],
    roles: ["subject", "sender", "transit_sender"],
    lane: "pattern",
    strengths: ["corroborated"],
    directness: "direct",
    timings: ["current", "at_event"]
  },
  {
    ruleId: "operational_wallet",
    factTypes: ["old_active_operational_wallet"],
    roles: ["operational_wallet", "subject"],
    lane: "neutral",
    strengths: ["exact"],
    directness: "direct",
    timings: ["current", "at_event"]
  }
];

function fail(code: string): never {
  throw new Error(code);
}

function generatedRule(ruleId: string): GeneratedRule {
  return GENERATED_RULES.get(ruleId) ??
    fail(`scoring_v4_policy_rule_missing:${ruleId}`);
}

function sameFact(left: ScoringFactV4, right: ScoringFactV4): boolean {
  return fingerprintCanonicalArtifact(left) ===
    fingerprintCanonicalArtifact(right);
}

function canonicalFacts(
  subjectAddress: string,
  facts: readonly ScoringFactV4[]
): ScoringFactV4[] {
  const byId = new Map<string, ScoringFactV4>();
  for (const fact of facts) {
    if (
      fact.version !== "canonical-fact-v1" ||
      fact.id.length === 0 ||
      fact.subject !== subjectAddress
    ) {
      fail("scoring_v4_invalid_canonical_fact");
    }
    const prior = byId.get(fact.id);
    if (prior !== undefined && !sameFact(prior, fact)) {
      fail("scoring_v4_fact_id_conflict");
    }
    byId.set(fact.id, fact);
  }
  return [...byId.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
}

function neutralFact(
  subjectAddress: string,
  code: NeutralCandidateCode
): ScoringFactV4 {
  const input: CanonicalFactInput = {
    profile: "state",
    chain: "tron",
    factType: code,
    subject: subjectAddress,
    counterpartyOrObject: null,
    subjectRole: "subject",
    effectiveAt: null,
    snapshotBlock: "scoring-v4",
    lane: "neutral",
    strength: "exact",
    sourceBranch: "fast",
    directness: "direct",
    timing: "current",
    payload: null
  };
  return canonicalizeEvidenceFacts({ facts: [input] }).inventory.facts[0]!;
}

function matches(rule: SemanticRule, fact: ScoringFactV4): boolean {
  return rule.factTypes.includes(fact.factType) &&
    rule.roles.includes(fact.subjectRole) &&
    rule.lane === fact.lane &&
    rule.strengths.includes(fact.strength) &&
    rule.directness === fact.directness &&
    rule.timings.includes(fact.timing);
}

function authorityFor(rule: SemanticRule | null): Pick<
  MatrixScoringResultV4,
  "evidenceClass" | "proofLevel" | "authority"
> {
  if (rule?.lane === "hard") {
    return {
      evidenceClass: "exact_hard",
      proofLevel: "exact",
      authority: "on_chain"
    };
  }
  if (rule?.lane === "pattern") {
    return {
      evidenceClass: "pattern",
      proofLevel: "corroborated",
      authority: "deterministic_pattern"
    };
  }
  if (rule?.lane === "context") {
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
}): MatrixScoringResultV4 {
  if (input.subjectAddress.length === 0) fail("scoring_v4_subject_missing");
  let facts = canonicalFacts(input.subjectAddress, input.facts);
  const candidates = SEMANTIC_RULES.flatMap((semantic) =>
    facts
      .filter((fact) => matches(semantic, fact))
      .map((fact) => ({
        semantic,
        fact,
        generated: generatedRule(semantic.ruleId)
      }))
  ).sort((left, right) =>
    right.generated.exactScore - left.generated.exactScore ||
    (left.generated.ruleId < right.generated.ruleId ? -1 :
      left.generated.ruleId > right.generated.ruleId ? 1 : 0) ||
    (left.fact.id < right.fact.id ? -1 : left.fact.id > right.fact.id ? 1 : 0)
  );
  const selected = candidates[0] ?? null;
  let neutralCandidate: NeutralCandidateCode | null = null;
  let selectedRule: GeneratedRule;
  let primaryFactIds: string[];
  if (selected === null || selected.generated.exactScore <= 5) {
    neutralCandidate = input.neutralCandidate ??
      (facts.some((fact) => fact.factType === "unknown_source")
        ? "unknown_without_risk_pattern"
        : selected?.semantic.ruleId === "operational_wallet"
          ? "clean_confirmed_context"
          : "neutral_no_observed_risk");
    const candidate = neutralFact(input.subjectAddress, neutralCandidate);
    facts = canonicalFacts(input.subjectAddress, [...facts, candidate]);
    selectedRule = selected?.generated ?? generatedRule(neutralCandidate);
    primaryFactIds = selected === null ? [candidate.id] : [selected.fact.id];
  } else {
    selectedRule = selected.generated;
    primaryFactIds = [selected.fact.id];
  }
  const canonicalFactIds = facts.map((fact) => fact.id);
  primaryFactIds = [...new Set(primaryFactIds)].sort();
  const preferredFactId = primaryFactIds[0] ??
    fail("scoring_v4_primary_fact_missing");
  return {
    policyVersion: "scoring-signal-matrix-v4",
    lockedGoldenManifestSha256: LOCKED_GOLDEN_MANIFEST_SHA256,
    score: selectedRule.exactScore,
    decision: selectedRule.expectedDecision,
    matrixRow: selectedRule.ruleId,
    ...authorityFor(selected?.semantic ?? null),
    facts,
    canonicalFactIds,
    primaryFactIds,
    preferredFactId,
    neutralCandidate
  };
}
