import type { ScoringAuditDecision, ScoringAuditRow } from "./scoringAudit";

export type ShadowScoringComparison = {
  currentScore: number | null;
  currentDecision: ScoringAuditDecision;
  candidateScore: number | null;
  candidateDecision: ScoringAuditDecision;
  delta: number | null;
  deltaReasons: string[];
  candidatePolicyVersion: "scoring-calibration-shadow-v1";
};

const candidatePolicyVersion = "scoring-calibration-shadow-v1" as const;
const incompleteCoverage = new Set<ScoringAuditRow["coverageStatus"]>(["limited", "insufficient", "partial"]);

export function compareShadowScoring(row: ScoringAuditRow): ShadowScoringComparison {
  const currentScore = row.finalScore;
  let candidateScore = currentScore;
  let candidateDecision = row.auditDecision;
  const deltaReasons: string[] = [];

  if (row.hardEvidenceObserved) {
    candidateDecision = "DECLINE";
    candidateScore = Math.max(currentScore ?? 0, 85);
    deltaReasons.push("Hard evidence keeps the candidate decision at decline with an 85 score floor.");
  } else if (currentScore !== null && currentScore < 30 && incompleteCoverage.has(row.coverageStatus)) {
    candidateDecision = "INSUFFICIENT_COVERAGE";
    deltaReasons.push("Low score has limited coverage; candidate policy avoids calling it acceptable.");
  } else if (
    currentScore !== null
    && currentScore >= 60
    && row.evidenceClass === "contextual"
    && row.coverageStatus !== "complete"
  ) {
    candidateDecision = "REVIEW";
    candidateScore = Math.min(currentScore, 59);
    deltaReasons.push("High contextual risk without complete coverage is capped below decline threshold for review.");
  }

  return {
    currentScore,
    currentDecision: row.productionDecision,
    candidateScore,
    candidateDecision,
    delta: currentScore === null || candidateScore === null ? null : candidateScore - currentScore,
    deltaReasons,
    candidatePolicyVersion
  };
}
