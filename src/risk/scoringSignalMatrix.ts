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

export type MatrixCandidate = {
  row: MatrixEvidenceRow;
  actionUnit: MatrixActionUnit;
  score: number;
  decisionEligibility: MatrixDecisionEligibility;
  evidenceIds: string[];
  evidenceEpisodeIds: string[];
  atomicSignals: string[];
  modifiers: string[];
  caps: string[];
  dampeners: string[];
  caveats: string[];
};

export type MatrixUncertaintyState = {
  coverage: "sufficient" | "partial" | "insufficient";
  continuity: "strong" | "medium" | "weak" | "unknown";
  provider: "complete" | "partial" | "unknown";
  staleData: boolean;
  caveats: string[];
};

export type MatrixRiskVector = Partial<Record<MatrixEvidenceRow, MatrixCandidate[]>>;

export type MatrixScoringResult = {
  policyVersion: "scoring-signal-matrix-v1";
  policyScore: number | null;
  matrixDecision: MatrixDecision;
  winningRow: MatrixEvidenceRow;
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

function hasAnchor(candidate: MatrixCandidate): boolean {
  return candidate.modifiers.includes("hard_anchor") ||
    candidate.modifiers.includes("source_policy_anchor") ||
    candidate.modifiers.includes("service_anchor");
}

function withCap(candidate: MatrixCandidate, score: number, cap: string): MatrixCandidate {
  return {
    ...candidate,
    score,
    caps: candidate.caps.includes(cap) ? candidate.caps : [...candidate.caps, cap]
  };
}

function applyRowCaps(candidate: MatrixCandidate): MatrixCandidate {
  const score = clampScore(candidate.score);
  if (candidate.row === "coverage_uncertainty") {
    return withCap(candidate, 0, "coverage_uncertainty_no_badness");
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

function episodeKey(candidate: MatrixCandidate): string {
  if (candidate.evidenceEpisodeIds.length > 0) return [...candidate.evidenceEpisodeIds].sort().join("|");
  return [...candidate.evidenceIds].sort().join("|");
}

function betterCandidate(left: MatrixCandidate, right: MatrixCandidate): MatrixCandidate {
  if (left.score !== right.score) return left.score > right.score ? left : right;
  return rowPriority.indexOf(left.row) <= rowPriority.indexOf(right.row) ? left : right;
}

function dedupeByEpisode(candidates: MatrixCandidate[]): MatrixCandidate[] {
  const byEpisode = new Map<string, MatrixCandidate>();
  for (const candidate of candidates) {
    const key = episodeKey(candidate);
    const existing = byEpisode.get(key);
    byEpisode.set(key, existing ? betterCandidate(existing, candidate) : candidate);
  }
  return [...byEpisode.values()];
}

function buildRiskVector(candidates: MatrixCandidate[]): MatrixRiskVector {
  const vector: MatrixRiskVector = {};
  for (const candidate of candidates) {
    vector[candidate.row] = [...(vector[candidate.row] ?? []), candidate];
  }
  return vector;
}

function candidateDecision(candidate: MatrixCandidate): MatrixDecision {
  if (candidate.decisionEligibility === "insufficient_only") return "INSUFFICIENT_EVIDENCE";
  if (candidate.decisionEligibility === "acceptable_only") return "ACCEPTABLE";
  if (candidate.score >= 60 && candidate.decisionEligibility === "can_decline") return "DECLINE";
  if (candidate.score >= 30) return "REVIEW";
  return "ACCEPTABLE";
}

function winningCandidate(candidates: MatrixCandidate[]): MatrixCandidate {
  const sorted = [...candidates].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) return scoreDelta;
    return rowPriority.indexOf(left.row) - rowPriority.indexOf(right.row);
  });
  return sorted[0] ?? {
    row: "coverage_uncertainty",
    actionUnit: "wallet",
    score: 0,
    decisionEligibility: "insufficient_only",
    evidenceIds: [],
    evidenceEpisodeIds: [],
    atomicSignals: [],
    modifiers: [],
    caps: ["no_candidates"],
    dampeners: [],
    caveats: ["No matrix candidates were produced."]
  };
}

function uncertaintyState(candidates: MatrixCandidate[]): MatrixUncertaintyState {
  const coverageCandidate = candidates.find((candidate) => candidate.row === "coverage_uncertainty");
  return {
    coverage: coverageCandidate ? "insufficient" : "sufficient",
    continuity: "unknown",
    provider: coverageCandidate ? "partial" : "complete",
    staleData: false,
    caveats: candidates.flatMap((candidate) => candidate.caveats)
  };
}

export function scoreMatrixCandidates(input: MatrixCandidate[]): MatrixScoringResult {
  const capped = input.map(applyRowCaps);
  const deduped = dedupeByEpisode(capped);
  const riskVector = buildRiskVector(deduped);
  const winner = winningCandidate(deduped);
  const matrixDecision = candidateDecision(winner);
  const policyScore = winner.row === "coverage_uncertainty" ? null : winner.score;

  return {
    policyVersion: "scoring-signal-matrix-v1",
    policyScore,
    matrixDecision,
    winningRow: winner.row,
    actionUnit: winner.actionUnit,
    riskVector,
    uncertaintyState: uncertaintyState(deduped),
    queuePriorityScore: null,
    calibratedRiskProbability: null
  };
}
