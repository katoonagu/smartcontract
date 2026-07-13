import { TronWeb } from "tronweb";
import type {
  NarrativeFactV2,
  ScoreAnchorDiagnostic,
  ScoreAnchorV2,
  ScoringEvidenceV2
} from "../types";
import type { FinalDisposition } from "./finalDisposition";
import type { ClassifiedMatrixCandidate, MatrixScoringResult } from "./scoringSignalMatrix";

const POLICY_VERSION = "scoring-signal-matrix-v3" as const;
const INTERNAL_POLICY_VERSION = "scoring-signal-matrix-v2" as const;
const BINDING_ERROR = "score_anchor_fact_binding_failed" as const;

type PolicyRule = Pick<
  ScoreAnchorV2,
  "matrixRow" | "evidenceClass" | "proofLevel" | "authority" | "coverageDependency"
> & {
  decisions: ReadonlyArray<ScoreAnchorV2["decision"]>;
  atomicSignal?: string;
  score?: number;
};

const policyRules: readonly PolicyRule[] = [
  ...["subject_restriction", "hard_proof"].map((matrixRow): PolicyRule => ({
    matrixRow,
    evidenceClass: "exact_hard",
    proofLevel: "exact",
    authority: "on_chain",
    coverageDependency: "none",
    decisions: ["DECLINE"]
  })),
  {
    matrixRow: "direct_counterparty_policy",
    evidenceClass: "policy",
    proofLevel: "strong",
    authority: "registry",
    coverageDependency: "none",
    decisions: ["DECLINE"]
  },
  ...["source_policy", "incoming_deposit_source_policy"].map((matrixRow): PolicyRule => ({
    matrixRow,
    evidenceClass: "policy",
    proofLevel: "strong",
    authority: "registry",
    coverageDependency: "required",
    decisions: ["ACCEPTABLE", "REVIEW", "DECLINE"]
  })),
  ...[
    "service_linked_pattern",
    "route_linked_approval_pattern",
    "asset_continuation",
    "typology_subgraph_pattern"
  ].flatMap((matrixRow): PolicyRule[] => (["none", "required"] as const).map((coverageDependency) => ({
    matrixRow,
    evidenceClass: "pattern",
    proofLevel: "strong",
    authority: "deterministic_pattern",
    coverageDependency,
    decisions: ["ACCEPTABLE", "REVIEW", "DECLINE"]
  }))),
  {
    matrixRow: "contract_suspicion",
    evidenceClass: "pattern",
    proofLevel: "strong",
    authority: "deterministic_pattern",
    coverageDependency: "none",
    decisions: ["DECLINE"]
  },
  {
    matrixRow: "behavior_only_prior",
    evidenceClass: "pattern",
    proofLevel: "strong",
    authority: "deterministic_pattern",
    coverageDependency: "required",
    decisions: ["REVIEW"],
    atomicSignal: "collector_plus_independent_signal",
    score: 55
  },
  ...["contract_suspicion", "counterparty_context", "behavior_only_prior"].map((matrixRow): PolicyRule => ({
    matrixRow,
    evidenceClass: "context",
    proofLevel: "context",
    authority: "behavior",
    coverageDependency: "required",
    decisions: ["ACCEPTABLE", "REVIEW"]
  })),
  {
    matrixRow: "incoming_deposit_source_policy",
    evidenceClass: "context",
    proofLevel: "context",
    authority: "behavior",
    coverageDependency: "required",
    decisions: ["REVIEW"]
  },
  {
    matrixRow: "clean_or_operational",
    evidenceClass: "clean",
    proofLevel: "context",
    authority: "behavior",
    coverageDependency: "required",
    decisions: ["ACCEPTABLE"]
  }
];

export type ScoreAnchorBuildInput = {
  mode: ScoreAnchorV2["mode"];
  subjectAddress: string;
  disposition: FinalDisposition;
  matrix: MatrixScoringResult;
  facts: NarrativeFactV2[];
};

type FreshAssemblyInput = ScoreAnchorBuildInput & {
  evidence: ScoringEvidenceV2[];
  activeAnchors: ScoreAnchorV2[];
};

function fail(): never {
  throw new Error(BINDING_ERROR);
}

function uniqueNonEmpty(values: unknown): values is string[] {
  return Array.isArray(values) && values.length > 0 &&
    values.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(values).size === values.length;
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function registeredRule(anchor: ScoreAnchorV2, atomicSignal: string): PolicyRule | null {
  if (anchor.policyVersion !== POLICY_VERSION) return null;
  return policyRules.find((rule) =>
    rule.matrixRow === anchor.matrixRow &&
    rule.evidenceClass === anchor.evidenceClass &&
    rule.proofLevel === anchor.proofLevel &&
    rule.authority === anchor.authority &&
    rule.coverageDependency === anchor.coverageDependency &&
    (rule.atomicSignal === undefined || rule.atomicSignal === atomicSignal) &&
    (rule.score === undefined || rule.score === anchor.score) &&
    rule.decisions.includes(anchor.decision)
  ) ?? null;
}

function canonicalRule(candidate: ClassifiedMatrixCandidate, decision: ScoreAnchorV2["decision"]): PolicyRule | null {
  const canonical = candidate.authority.kind === "exact_hard"
    ? { evidenceClass: "exact_hard", proofLevel: "exact", authority: "on_chain", coverageDependency: "none" }
    : candidate.authority.kind === "policy"
      ? {
          evidenceClass: "policy",
          proofLevel: "strong",
          authority: "registry",
          coverageDependency: candidate.authority.coverageDependency === "none" ? "none" : "required"
        }
      : candidate.authority.kind === "pattern"
        ? {
            evidenceClass: "pattern",
            proofLevel: "strong",
            authority: "deterministic_pattern",
            coverageDependency: candidate.authority.coverageDependency === "none" ? "none" : "required"
          }
        : candidate.authority.kind === "clean"
          ? { evidenceClass: "clean", proofLevel: "context", authority: "behavior", coverageDependency: "required" }
          : candidate.authority.kind === "context"
            ? {
                evidenceClass: "context",
                proofLevel: "context",
                authority: "behavior",
                // v2 incoming context may say "none"; v3 always normalizes context to required coverage.
                coverageDependency: "required"
              }
            : null;
  if (!canonical) return null;
  return policyRules.find((rule) =>
    rule.matrixRow === candidate.row &&
    rule.evidenceClass === canonical.evidenceClass &&
    rule.proofLevel === canonical.proofLevel &&
    rule.authority === canonical.authority &&
    rule.coverageDependency === canonical.coverageDependency &&
    (rule.atomicSignal === undefined || rule.atomicSignal === firstAtomicSignal(candidate)) &&
    (rule.score === undefined || rule.score === candidate.score) &&
    rule.decisions.includes(decision)
  ) ?? null;
}

function canonicalContributingRule(candidate: ClassifiedMatrixCandidate): PolicyRule | null {
  for (const decision of ["ACCEPTABLE", "REVIEW", "DECLINE"] as const) {
    const rule = canonicalRule(candidate, decision);
    if (rule) return rule;
  }
  return null;
}

function scoreDecision(value: FinalDisposition["decision"]): ScoreAnchorV2["decision"] | null {
  return value === "NO_FINAL_DECISION" ? null : value;
}

function firstAtomicSignal(candidate: ClassifiedMatrixCandidate): string | null {
  const signal = candidate.atomicSignals[0];
  return typeof signal === "string" && signal.length > 0 ? signal : null;
}

function stablePart(value: string): string {
  return encodeURIComponent(value);
}

function stableId(prefix: string, values: string[]): string {
  return `${prefix}:${values.map(stablePart).join(":")}`;
}

export function validateScoreAnchorV2(input: {
  anchor: ScoreAnchorV2;
  checkedSubjectAddress: string;
  checkedMode: ScoreAnchorV2["mode"];
  evidence: ScoringEvidenceV2[];
  facts: NarrativeFactV2[];
}): ScoreAnchorV2 {
  const { anchor } = input;
  if (!anchor || Array.isArray(anchor) || typeof anchor !== "object") fail();
  if (anchor.version !== "score-anchor-v2") fail();
  if (!Number.isFinite(anchor.score) || !Number.isInteger(anchor.score) || anchor.score < 0 || anchor.score > 100) fail();
  if (!TronWeb.isAddress(anchor.subjectAddress) || anchor.subjectAddress !== input.checkedSubjectAddress) fail();
  if (anchor.mode !== input.checkedMode) fail();
  if (!uniqueNonEmpty(anchor.evidenceIds) || !uniqueNonEmpty(anchor.primaryEvidenceIds)) fail();
  if (!anchor.primaryEvidenceIds.every((id) => anchor.evidenceIds.includes(id))) fail();

  for (const id of anchor.evidenceIds) {
    const matches = input.evidence.filter((item) => item.id === id);
    if (matches.length !== 1) fail();
    const evidence = matches[0];
    if (evidence.subjectAddress !== anchor.subjectAddress || !uniqueNonEmpty(evidence.sourceEvidenceIds)) fail();
    if (anchor.primaryEvidenceIds.includes(id)) {
      if (
        evidence.matrixRow !== anchor.matrixRow ||
        evidence.evidenceClass !== anchor.evidenceClass ||
        evidence.authority !== anchor.authority
      ) fail();
    } else if (!policyRules.some((candidate) =>
      candidate.matrixRow === evidence.matrixRow &&
      candidate.evidenceClass === evidence.evidenceClass &&
      candidate.authority === evidence.authority
    )) fail();
  }

  if (!anchor.preferredFactId) fail();
  const preferredMatches = input.facts.filter((fact) => fact.id === anchor.preferredFactId);
  if (preferredMatches.length !== 1) fail();
  const fact = preferredMatches[0];
  if (!registeredRule(anchor, fact.kind)) fail();
  if (
    fact.subjectAddress !== anchor.subjectAddress ||
    fact.mode !== anchor.mode ||
    fact.section !== "score_reason" ||
    fact.isScoreDriver !== true ||
    !uniqueNonEmpty(fact.evidenceIds) ||
    !sameSet(fact.evidenceIds, anchor.primaryEvidenceIds)
  ) fail();
  const referencesActiveAnchor = input.facts.filter((item) =>
    item.isScoreDriver === true &&
    item.subjectAddress === anchor.subjectAddress &&
    item.mode === anchor.mode &&
    uniqueNonEmpty(item.evidenceIds) &&
    sameSet(item.evidenceIds, anchor.primaryEvidenceIds)
  );
  if (referencesActiveAnchor.length !== 1) fail();
  return anchor;
}

export function buildScoreAnchorV2(input: ScoreAnchorBuildInput): {
  anchor: ScoreAnchorV2 | null;
  diagnostic: ScoreAnchorDiagnostic;
} {
  const sourcePolicyVersion = (input.matrix as { policyVersion?: unknown }).policyVersion;
  if (sourcePolicyVersion === undefined) {
    return { anchor: null, diagnostic: null };
  }
  if (sourcePolicyVersion !== INTERNAL_POLICY_VERSION && sourcePolicyVersion !== POLICY_VERSION) {
    return { anchor: null, diagnostic: BINDING_ERROR };
  }
  if (input.disposition.finalScore === null || !input.disposition.scoreValid) {
    return { anchor: null, diagnostic: null };
  }
  const decision = scoreDecision(input.disposition.decision);
  const candidate = input.disposition.decisiveCandidate;
  if (!decision || !candidate) return { anchor: null, diagnostic: BINDING_ERROR };
  const rule = canonicalRule(candidate, decision);
  const atomicSignal = firstAtomicSignal(candidate);
  if (!rule || !atomicSignal) return { anchor: null, diagnostic: BINDING_ERROR };
  const expectedFactTextKey = ["score", candidate.row, atomicSignal].join(".");
  const exactFacts = input.facts.filter((fact) =>
    fact.subjectAddress === input.subjectAddress &&
    fact.mode === input.mode &&
    fact.section === "score_reason" &&
    fact.isScoreDriver === true &&
    fact.factTextKey === expectedFactTextKey
  );
  if (exactFacts.length !== 1 || !uniqueNonEmpty(exactFacts[0].evidenceIds)) {
    return { anchor: null, diagnostic: BINDING_ERROR };
  }
  const fact = exactFacts[0];
  return {
    anchor: {
      version: "score-anchor-v2",
      policyVersion: POLICY_VERSION,
      subjectAddress: input.subjectAddress,
      mode: input.mode,
      score: input.disposition.finalScore,
      decision,
      matrixRow: rule.matrixRow,
      evidenceClass: rule.evidenceClass,
      proofLevel: rule.proofLevel,
      authority: rule.authority,
      evidenceIds: [...fact.evidenceIds],
      primaryEvidenceIds: [...fact.evidenceIds],
      preferredFactId: fact.id,
      coverageDependency: rule.coverageDependency
    },
    diagnostic: null
  };
}

export function materializeFreshScoreBindingV2(input: Omit<ScoreAnchorBuildInput, "facts">): {
  anchor: ScoreAnchorV2 | null;
  diagnostic: ScoreAnchorDiagnostic;
  evidence: ScoringEvidenceV2[];
  facts: NarrativeFactV2[];
} {
  if (input.disposition.finalScore === null || !input.disposition.scoreValid) {
    return { anchor: null, diagnostic: null, evidence: [], facts: [] };
  }
  const decision = scoreDecision(input.disposition.decision);
  const candidate = input.disposition.decisiveCandidate;
  if (!decision || !candidate) return { anchor: null, diagnostic: BINDING_ERROR, evidence: [], facts: [] };
  const rule = canonicalRule(candidate, decision);
  const atomicSignal = firstAtomicSignal(candidate);
  const sourceEvidenceIds = [...new Set(candidate.evidenceIds)].sort();
  if (!rule || !atomicSignal || !uniqueNonEmpty(sourceEvidenceIds)) {
    return { anchor: null, diagnostic: BINDING_ERROR, evidence: [], facts: [] };
  }
  const evidenceId = stableId("score-evidence-v2", [
    POLICY_VERSION,
    input.mode,
    input.subjectAddress,
    candidate.row,
    rule.evidenceClass,
    rule.authority,
    ...sourceEvidenceIds
  ]);
  const primaryEvidence: ScoringEvidenceV2 = {
    id: evidenceId,
    subjectAddress: input.subjectAddress,
    matrixRow: candidate.row,
    evidenceClass: rule.evidenceClass,
    authority: rule.authority,
    sourceEvidenceIds
  };
  const factId = stableId("narrative-fact-v2", [
    POLICY_VERSION,
    input.mode,
    input.subjectAddress,
    candidate.row,
    evidenceId
  ]);
  const fact: NarrativeFactV2 = {
    id: factId,
    subjectAddress: input.subjectAddress,
    mode: input.mode,
    kind: atomicSignal,
    role: null,
    section: "score_reason",
    evidenceIds: [evidenceId],
    isScoreDriver: true,
    direction: null,
    amountRaw: null,
    share: null,
    txCount: null,
    addresses: [],
    txHashes: [],
    factTextKey: ["score", candidate.row, atomicSignal].join("."),
    meaningTextKey: null
  };
  const built = buildScoreAnchorV2({ ...input, facts: [fact] });
  if (!built.anchor) return { ...built, evidence: [], facts: [] };

  const seenEvidenceIds = new Set([primaryEvidence.id]);
  const contributingEvidence: ScoringEvidenceV2[] = [];
  for (const item of Object.values(input.matrix.riskVector).flatMap((candidates) => candidates ?? [])) {
    if (item === candidate) continue;
      const contributingRule = canonicalContributingRule(item);
      const ids = [...new Set(item.evidenceIds)].sort();
      if (!contributingRule || !uniqueNonEmpty(ids)) continue;
      const id = stableId("score-evidence-v2", [
        POLICY_VERSION,
        input.mode,
        input.subjectAddress,
        item.row,
        contributingRule.evidenceClass,
        contributingRule.authority,
        ...ids
      ]);
      if (seenEvidenceIds.has(id)) {
        return { anchor: null, diagnostic: BINDING_ERROR, evidence: [], facts: [] };
      }
      seenEvidenceIds.add(id);
      contributingEvidence.push({
        id,
        subjectAddress: input.subjectAddress,
        matrixRow: item.row,
        evidenceClass: contributingRule.evidenceClass,
        authority: contributingRule.authority,
        sourceEvidenceIds: ids
      });
  }
  const evidence = [
    primaryEvidence,
    ...contributingEvidence.sort((left, right) => left.id.localeCompare(right.id))
  ];
  return {
    anchor: { ...built.anchor, evidenceIds: evidence.map((item) => item.id) },
    diagnostic: null,
    evidence,
    facts: [fact]
  };
}

function failedAssembly(input: FreshAssemblyInput) {
  return {
    ...input.disposition,
    decision: "NO_FINAL_DECISION" as const,
    finalScore: null,
    scoreValid: false,
    decisionBasis: "technical_stop" as const,
    hardProofEvidenceIds: [],
    decisiveCandidate: null,
    scoreAnchorV2: null,
    narrativeFactsV2: [] as NarrativeFactV2[],
    scoringEvidenceV2: [] as ScoringEvidenceV2[],
    scoreAnchorDiagnostic: BINDING_ERROR
  };
}

export function assembleFreshScoreResultV2(input: FreshAssemblyInput) {
  if (input.disposition.finalScore === null) {
    if (
      input.activeAnchors.length !== 0 ||
      input.disposition.scoreValid ||
      input.disposition.decision !== "NO_FINAL_DECISION"
    ) return failedAssembly(input);
    return {
      ...input.disposition,
      scoreAnchorV2: null,
      narrativeFactsV2: input.facts,
      scoringEvidenceV2: input.evidence,
      scoreAnchorDiagnostic: null
    };
  }
  if (input.activeAnchors.length !== 1) return failedAssembly(input);
  const anchor = input.activeAnchors[0];
  if (
    anchor.score !== input.disposition.finalScore ||
    anchor.decision !== input.disposition.decision ||
    anchor.subjectAddress !== input.subjectAddress ||
    anchor.mode !== input.mode
  ) return failedAssembly(input);
  try {
    validateScoreAnchorV2({
      anchor,
      checkedSubjectAddress: input.subjectAddress,
      checkedMode: input.mode,
      evidence: input.evidence,
      facts: input.facts
    });
  } catch {
    return failedAssembly(input);
  }
  return {
    ...input.disposition,
    scoreAnchorV2: anchor,
    narrativeFactsV2: input.facts,
    scoringEvidenceV2: input.evidence,
    scoreAnchorDiagnostic: null
  };
}

export function canonicalScorePublicationV2(input: ReturnType<typeof assembleFreshScoreResultV2>) {
  return {
    finalScore: input.finalScore,
    finalDecision: input.decision,
    observedContextScore: input.observedContextScore,
    scoreValid: input.scoreValid,
    decisionBasis: input.decisionBasis,
    coverage: input.coverage,
    scoreAnchorV2: input.scoreAnchorV2,
    narrativeFactsV2: input.narrativeFactsV2,
    scoringEvidenceV2: input.scoringEvidenceV2,
    scoreAnchorDiagnostic: input.scoreAnchorDiagnostic
  };
}
