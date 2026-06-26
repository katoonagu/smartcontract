import { describe, expect, it } from "vitest";
import { compareShadowScoring } from "../../src/risk/shadowScoring";
import type { ScoringAuditRow } from "../../src/risk/scoringAudit";

function row(overrides: Partial<ScoringAuditRow> = {}): ScoringAuditRow {
  return {
    jobId: "job-1",
    kind: "address_deep_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    finalScore: 20,
    riskLevel: "LOW",
    productionDecision: "ACCEPTABLE",
    auditDecision: "ACCEPTABLE",
    coverageStatus: "complete",
    confidenceScore: 100,
    evidenceClass: "weak",
    hardEvidenceObserved: false,
    activeAnchorCode: null,
    activeAnchorScore: null,
    dampener: null,
    policyVersion: "wallet-risk-v1",
    missingChecks: [],
    cohorts: [],
    limitations: [],
    sourceAttribution: null,
    ...overrides
  };
}

describe("shadow scoring comparison", () => {
  it.each(["limited", "insufficient", "partial"] as const)(
    "moves low acceptable %s coverage to insufficient coverage",
    (coverageStatus) => {
      const comparison = compareShadowScoring(row({
        finalScore: 20,
        productionDecision: "ACCEPTABLE",
        auditDecision: "ACCEPTABLE",
        coverageStatus
      }));

      expect(comparison).toMatchObject({
        currentScore: 20,
        currentDecision: "ACCEPTABLE",
        candidateScore: 20,
        candidateDecision: "INSUFFICIENT_COVERAGE",
        delta: 0,
        candidatePolicyVersion: "scoring-calibration-shadow-v1"
      });
      expect(comparison.deltaReasons).toContain(
        "Low score has limited coverage; candidate policy avoids calling it acceptable."
      );
    }
  );

  it("uses the production decision as the current decision", () => {
    const comparison = compareShadowScoring(row({
      finalScore: 20,
      productionDecision: "ACCEPTABLE",
      auditDecision: "INSUFFICIENT_COVERAGE",
      coverageStatus: "insufficient"
    }));

    expect(comparison.currentDecision).toBe("ACCEPTABLE");
    expect(comparison.candidateDecision).toBe("INSUFFICIENT_COVERAGE");
  });

  it("keeps hard evidence declined and preserves scores above the floor", () => {
    const comparison = compareShadowScoring(row({
      finalScore: 95,
      auditDecision: "DECLINE",
      evidenceClass: "hard",
      hardEvidenceObserved: true
    }));

    expect(comparison.candidateDecision).toBe("DECLINE");
    expect(comparison.candidateScore).toBe(95);
    expect(comparison.candidateScore).toBeGreaterThanOrEqual(85);
    expect(comparison.delta).toBe(0);
  });

  it("moves high contextual risk with partial coverage to review and lowers the score", () => {
    const comparison = compareShadowScoring(row({
      finalScore: 72,
      productionDecision: "DECLINE",
      auditDecision: "DECLINE",
      coverageStatus: "partial",
      evidenceClass: "contextual",
      hardEvidenceObserved: false
    }));

    expect(comparison.currentScore).toBe(72);
    expect(comparison.currentDecision).toBe("DECLINE");
    expect(comparison.candidateDecision).toBe("REVIEW");
    expect(comparison.candidateScore).toBe(59);
    expect(comparison.candidateScore).toBeLessThan(comparison.currentScore ?? 0);
    expect(comparison.delta).toBe(-13);
  });
});
