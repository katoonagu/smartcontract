import type { DecisionCoverage, FinalDecisionBasis, UserExchangeDecision } from "../types";
import type {
  ClassifiedMatrixCandidate,
  MatrixDecisionScope,
  MatrixScoringResult
} from "./scoringSignalMatrix";

export type DecisionSubject = {
  decisionScope: MatrixDecisionScope;
  address: string;
  txHash: string | null;
};

export type FinalDisposition = {
  decision: UserExchangeDecision;
  finalScore: number | null;
  observedContextScore: number;
  scoreValid: boolean;
  decisionBasis: FinalDecisionBasis;
  coverage: DecisionCoverage;
  hardProofEvidenceIds: string[];
  decisiveCandidate: ClassifiedMatrixCandidate | null;
};

function sameSubject(candidate: ClassifiedMatrixCandidate, subject: DecisionSubject): boolean {
  return candidate.subject.decisionScope === subject.decisionScope &&
    candidate.subject.address.toLowerCase() === subject.address.toLowerCase() &&
    candidate.subject.txHash === subject.txHash;
}

function exactHardCandidate(
  matrix: MatrixScoringResult,
  subject: DecisionSubject
): ClassifiedMatrixCandidate | null {
  return [
    ...(matrix.riskVector.subject_restriction ?? []),
    ...(matrix.riskVector.hard_proof ?? [])
  ]
    .filter((candidate) =>
      candidate.evidenceClass === "exact_hard" &&
      candidate.proofLevel === "exact" &&
      candidate.decisionEligibility === "can_decline" &&
      candidate.coverageDependency === "none" &&
      sameSubject(candidate, subject)
    )
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function independentDirectPolicyCandidate(
  matrix: MatrixScoringResult,
  subject: DecisionSubject
): ClassifiedMatrixCandidate | null {
  return (matrix.riskVector.direct_counterparty_policy ?? [])
    .filter((candidate) =>
      candidate.row === "direct_counterparty_policy" &&
      candidate.authority.kind === "policy" &&
      candidate.authority.decisionEligibility === "can_decline" &&
      candidate.authority.coverageDependency === "none" &&
      candidate.evidenceClass === "policy" &&
      candidate.proofLevel === "policy" &&
      candidate.decisionEligibility === "can_decline" &&
      candidate.coverageDependency === "none" &&
      candidate.score >= 60 &&
      sameSubject(candidate, subject)
    )
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

export function resolveFinalDisposition(input: {
  subject: DecisionSubject;
  matrixScore: MatrixScoringResult;
  coverage: DecisionCoverage;
  observedContextScore: number;
}): FinalDisposition {
  const observedContextScore = Number.isFinite(input.observedContextScore)
    ? Math.max(0, Math.min(100, Math.round(input.observedContextScore)))
    : 0;
  const hard = exactHardCandidate(input.matrixScore, input.subject);
  if (hard) {
    return {
      decision: "DECLINE",
      finalScore: hard.score,
      observedContextScore,
      scoreValid: true,
      decisionBasis: "exact_hard_proof",
      coverage: input.coverage,
      hardProofEvidenceIds: hard.evidenceIds,
      decisiveCandidate: hard
    };
  }

  const independentPolicy = independentDirectPolicyCandidate(input.matrixScore, input.subject);
  if (independentPolicy) {
    return {
      decision: "DECLINE",
      finalScore: independentPolicy.score,
      observedContextScore,
      scoreValid: true,
      decisionBasis: "independent_policy",
      coverage: input.coverage,
      hardProofEvidenceIds: [],
      decisiveCandidate: independentPolicy
    };
  }

  const matrixDecision = input.matrixScore.matrixDecision;
  if (
    !sameSubject(input.matrixScore.winningCandidate, input.subject) ||
    input.coverage.required === "invalid" ||
    matrixDecision === "INSUFFICIENT_EVIDENCE" ||
    input.matrixScore.policyScore === null
  ) {
    return {
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      observedContextScore,
      scoreValid: false,
      decisionBasis: "technical_stop",
      coverage: input.coverage,
      hardProofEvidenceIds: [],
      decisiveCandidate: null
    };
  }

  return {
    decision: matrixDecision,
    finalScore: input.matrixScore.policyScore,
    observedContextScore,
    scoreValid: true,
    decisionBasis: "matrix",
    coverage: input.coverage,
    hardProofEvidenceIds: [],
    decisiveCandidate: input.matrixScore.winningCandidate
  };
}
