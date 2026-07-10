export type MatrixDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "INSUFFICIENT_EVIDENCE";

export type MatrixEvidenceRow =
  | "hard_proof"
  | "source_policy"
  | "incoming_deposit_source_policy"
  | "service_linked_pattern"
  | "route_linked_approval_pattern"
  | "asset_continuation"
  | "typology_subgraph_pattern"
  | "contract_suspicion"
  | "counterparty_context"
  | "behavior_only_prior"
  | "coverage_uncertainty"
  | "clean_or_operational";

export type MatrixActionUnit =
  | "wallet"
  | "incoming_deposit"
  | "source_path"
  | "transaction"
  | "actor_cluster"
  | "subgraph_typology";

export type MatrixDecisionEligibility =
  | "can_decline"
  | "review_only"
  | "insufficient_only"
  | "acceptable_only";

export type MatrixDecisionScope = "fast" | "deep" | "wallet_unified" | "incoming_unified" | "contract_transfer";
export type MatrixEvidenceClass = "exact_hard" | "policy" | "pattern" | "context" | "coverage" | "clean";
export type MatrixProofLevel = "exact" | "policy" | "corroborated_pattern" | "context" | "coverage" | "clean";
export type MatrixCoverageDependency = "none" | "wallet_provenance" | "deposit_provenance";
export type MatrixExactProofSource =
  | "fast_exact_code"
  | "stablecoin_restriction"
  | "approval_drain_exact"
  | "exact_labeled_path"
  | "where_exact_hard"
  | "incoming_exact_hard";

export type MatrixEvidenceAuthority =
  | { kind: "exact_hard"; proofSource: MatrixExactProofSource }
  | { kind: "policy"; decisionEligibility: "can_decline" | "review_only"; coverageDependency: MatrixCoverageDependency }
  | { kind: "pattern"; decisionEligibility: "can_decline" | "review_only"; coverageDependency: MatrixCoverageDependency }
  | { kind: "context" }
  | { kind: "coverage"; coverageDependency: MatrixCoverageDependency }
  | { kind: "clean"; coverageDependency: MatrixCoverageDependency };

export type MatrixCandidateContext = {
  decisionScope: MatrixDecisionScope;
  subjectAddress: string;
  subjectTxHash: string | null;
  requiredCoverage: MatrixCoverageDependency;
};

export type MatrixCandidateSubject = {
  decisionScope: MatrixDecisionScope;
  address: string;
  txHash: string | null;
};

export type MatrixCandidate = {
  row: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  score: number;
  evidenceIds: string[];
  evidenceEpisodeIds: string[];
  atomicSignals: string[];
  modifiers: string[];
  caps: string[];
  dampeners: string[];
  caveats: string[];
  subject: MatrixCandidateSubject;
  authority: MatrixEvidenceAuthority;
};

export type ClassifiedMatrixCandidate = Omit<MatrixCandidate, "authority"> & {
  authority: MatrixEvidenceAuthority;
  evidenceClass: MatrixEvidenceClass;
  proofLevel: MatrixProofLevel;
  decisionEligibility: MatrixDecisionEligibility;
  coverageDependency: MatrixCoverageDependency;
};

export type MatrixUncertaintyState = {
  coverage: "sufficient" | "partial" | "insufficient";
  continuity: "strong" | "medium" | "weak" | "unknown";
  provider: "complete" | "partial" | "unknown";
  staleData: boolean;
  caveats: string[];
};

export type MatrixRiskVector = Partial<Record<MatrixEvidenceRow, ClassifiedMatrixCandidate[]>>;

export type MatrixScoringResult = {
  policyVersion: "scoring-signal-matrix-v1";
  policyScore: number | null;
  matrixDecision: MatrixDecision;
  winningRow: MatrixEvidenceRow;
  winningCandidate: ClassifiedMatrixCandidate;
  actionUnit: MatrixActionUnit;
  riskVector: MatrixRiskVector;
  uncertaintyState: MatrixUncertaintyState;
  queuePriorityScore: null;
  calibratedRiskProbability: null;
};

const rowPriority: MatrixEvidenceRow[] = [
  "hard_proof",
  "source_policy",
  "incoming_deposit_source_policy",
  "route_linked_approval_pattern",
  "asset_continuation",
  "service_linked_pattern",
  "typology_subgraph_pattern",
  "contract_suspicion",
  "counterparty_context",
  "behavior_only_prior",
  "clean_or_operational",
  "coverage_uncertainty"
];

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function classifyCandidate(candidate: MatrixCandidate): ClassifiedMatrixCandidate {
  const metadata = candidate.authority.kind === "exact_hard"
    ? {
        evidenceClass: "exact_hard" as const,
        proofLevel: "exact" as const,
        decisionEligibility: "can_decline" as const,
        coverageDependency: "none" as const
      }
    : candidate.authority.kind === "policy"
      ? {
          evidenceClass: "policy" as const,
          proofLevel: "policy" as const,
          decisionEligibility: candidate.authority.decisionEligibility,
          coverageDependency: candidate.authority.coverageDependency
        }
      : candidate.authority.kind === "pattern"
        ? {
            evidenceClass: "pattern" as const,
            proofLevel: "corroborated_pattern" as const,
            decisionEligibility: candidate.authority.decisionEligibility,
            coverageDependency: candidate.authority.coverageDependency
          }
        : candidate.authority.kind === "coverage"
          ? {
              evidenceClass: "coverage" as const,
              proofLevel: "coverage" as const,
              decisionEligibility: "insufficient_only" as const,
              coverageDependency: candidate.authority.coverageDependency
            }
          : candidate.authority.kind === "clean"
            ? {
                evidenceClass: "clean" as const,
                proofLevel: "clean" as const,
                decisionEligibility: "acceptable_only" as const,
                coverageDependency: candidate.authority.coverageDependency
              }
            : {
                evidenceClass: "context" as const,
                proofLevel: "context" as const,
                decisionEligibility: "review_only" as const,
                coverageDependency: "none" as const
              };
  if (candidate.authority.kind === "exact_hard" && candidate.row !== "hard_proof") {
    throw new Error("exact hard authority requires the hard_proof matrix row");
  }
  return { ...candidate, ...metadata };
}

function sameMatrixSubject(candidate: ClassifiedMatrixCandidate, context: MatrixCandidateContext): boolean {
  return candidate.subject.decisionScope === context.decisionScope &&
    candidate.subject.address.toLowerCase() === context.subjectAddress.toLowerCase() &&
    candidate.subject.txHash === context.subjectTxHash;
}

function hasAnchor(candidate: ClassifiedMatrixCandidate): boolean {
  return candidate.modifiers.includes("hard_anchor") ||
    candidate.modifiers.includes("source_policy_anchor") ||
    candidate.modifiers.includes("service_anchor");
}

function withCap(
  candidate: ClassifiedMatrixCandidate,
  score: number,
  cap: string
): ClassifiedMatrixCandidate {
  return {
    ...candidate,
    score,
    caps: candidate.caps.includes(cap) ? candidate.caps : [...candidate.caps, cap]
  };
}

function applyRowCaps(candidate: ClassifiedMatrixCandidate): ClassifiedMatrixCandidate {
  const score = clampScore(candidate.score);
  if (candidate.evidenceClass === "coverage") {
    return withCap(candidate, 0, "coverage_uncertainty_no_badness");
  }
  if (candidate.evidenceClass === "context" && score >= 60) {
    const capped = withCap(candidate, 59, "context_cap_59");
    if (candidate.row === "behavior_only_prior") return withCap(capped, 59, "behavior_only_cap_59");
    if (candidate.row === "contract_suspicion") return withCap(capped, 59, "contract_suspicion_cap_59");
    return capped;
  }
  if (candidate.row === "behavior_only_prior" && score >= 60) {
    return withCap(candidate, 59, "behavior_only_cap_59");
  }
  if (candidate.row === "contract_suspicion" && score >= 60) {
    return withCap(candidate, 59, "contract_suspicion_cap_59");
  }
  if (candidate.row === "typology_subgraph_pattern" && !hasAnchor(candidate) && score >= 60) {
    return withCap(candidate, 59, "typology_without_anchor_cap_59");
  }
  return { ...candidate, score };
}

function episodeKey(candidate: ClassifiedMatrixCandidate): string {
  if (candidate.evidenceEpisodeIds.length > 0) return [...candidate.evidenceEpisodeIds].sort().join("|");
  return [...candidate.evidenceIds].sort().join("|");
}

function betterCandidate(
  left: ClassifiedMatrixCandidate,
  right: ClassifiedMatrixCandidate
): ClassifiedMatrixCandidate {
  if (left.evidenceClass === "exact_hard" && right.evidenceClass !== "exact_hard") return left;
  if (right.evidenceClass === "exact_hard" && left.evidenceClass !== "exact_hard") return right;
  if (left.score !== right.score) return left.score > right.score ? left : right;
  return rowPriority.indexOf(left.row) <= rowPriority.indexOf(right.row) ? left : right;
}

function dedupeByEpisode(candidates: ClassifiedMatrixCandidate[]): ClassifiedMatrixCandidate[] {
  const byEpisode = new Map<string, ClassifiedMatrixCandidate>();
  for (const candidate of candidates) {
    const key = episodeKey(candidate);
    const existing = byEpisode.get(key);
    byEpisode.set(key, existing ? betterCandidate(existing, candidate) : candidate);
  }
  return [...byEpisode.values()];
}

function buildRiskVector(candidates: ClassifiedMatrixCandidate[]): MatrixRiskVector {
  const vector: MatrixRiskVector = {};
  for (const candidate of candidates) {
    vector[candidate.row] = [...(vector[candidate.row] ?? []), candidate];
  }
  return vector;
}

function candidateDecision(candidate: ClassifiedMatrixCandidate): MatrixDecision {
  if (candidate.decisionEligibility === "insufficient_only") return "INSUFFICIENT_EVIDENCE";
  if (candidate.decisionEligibility === "acceptable_only") return "ACCEPTABLE";
  if (candidate.score >= 60 && candidate.decisionEligibility === "can_decline") return "DECLINE";
  if (candidate.score >= 30) return "REVIEW";
  return "ACCEPTABLE";
}

function winningCandidate(
  candidates: ClassifiedMatrixCandidate[],
  context: MatrixCandidateContext
): ClassifiedMatrixCandidate {
  const sorted = [...candidates].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) return scoreDelta;
    return rowPriority.indexOf(left.row) - rowPriority.indexOf(right.row);
  });
  return sorted[0] ?? classifyCandidate({
    row: "coverage_uncertainty",
    actionUnit: context.decisionScope === "incoming_unified" ? "incoming_deposit" : "wallet",
    score: 0,
    evidenceIds: [],
    evidenceEpisodeIds: [],
    atomicSignals: [],
    modifiers: [],
    caps: ["no_candidates"],
    dampeners: [],
    caveats: ["No matrix candidates were produced."],
    subject: {
      decisionScope: context.decisionScope,
      address: context.subjectAddress,
      txHash: context.subjectTxHash
    },
    authority: { kind: "coverage", coverageDependency: context.requiredCoverage }
  });
}

function uncertaintyState(candidates: ClassifiedMatrixCandidate[]): MatrixUncertaintyState {
  const coverageCandidate = candidates.find((candidate) => candidate.evidenceClass === "coverage");
  return {
    coverage: coverageCandidate ? "insufficient" : "sufficient",
    continuity: "unknown",
    provider: coverageCandidate ? "partial" : "complete",
    staleData: false,
    caveats: candidates.flatMap((candidate) => candidate.caveats)
  };
}

export function scoreMatrixCandidates(
  input: MatrixCandidate[],
  context: MatrixCandidateContext
): MatrixScoringResult {
  const classified = input.map(classifyCandidate);
  if (classified.some((candidate) => !sameMatrixSubject(candidate, context))) {
    throw new Error("matrix candidate subject does not match scoring context");
  }
  const capped = classified.map(applyRowCaps);
  const deduped = dedupeByEpisode(capped);
  const riskVector = buildRiskVector(deduped);
  const winner = winningCandidate(deduped, context);
  const matrixDecision = candidateDecision(winner);
  const policyScore = winner.evidenceClass === "coverage" ? null : winner.score;

  return {
    policyVersion: "scoring-signal-matrix-v1",
    policyScore,
    matrixDecision,
    winningRow: winner.row,
    winningCandidate: winner,
    actionUnit: winner.actionUnit,
    riskVector,
    uncertaintyState: uncertaintyState(deduped),
    queuePriorityScore: null,
    calibratedRiskProbability: null
  };
}
