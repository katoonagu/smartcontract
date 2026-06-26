import { describe, expect, it } from "vitest";
import { buildScoringAuditRow, cohortCounts } from "../../src/risk/scoringAudit";
import type { ForensicCheckJob } from "../../src/storage/repositories";

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-01T01:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: "123",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:01.000Z"),
    updatedAt: new Date("2026-06-01T00:10:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:02.000Z"),
    completedAt: new Date("2026-06-01T00:10:00.000Z"),
    ...overrides
  };
}

describe("scoring audit rows", () => {
  it("flags high contextual scores under partial coverage", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        decision: "DECLINE",
        riskScore: 72,
        missingChecks: ["provider timeout"],
        coverage: {
          partial: true,
          fetchedAddressCount: 5,
          notes: ["provider timeout"]
        },
        assessment: {
          hardBadEvidence: []
        },
        reasons: ["counterparty context"]
      }
    }));

    expect(row.finalScore).toBe(72);
    expect(row.coverageStatus).toBe("partial");
    expect(row.evidenceClass).toBe("contextual");
    expect(row.cohorts).toEqual(expect.arrayContaining([
      "high_score_partial_coverage",
      "decline_without_hard_evidence"
    ]));
  });

  it("does not call acceptable limited coverage sufficient", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        decision: "ACCEPTABLE",
        riskScore: 20,
        coverage: {
          partial: true,
          fetchedAddressCount: 1,
          notes: ["service boundary reached"]
        }
      }
    }));

    expect(row.productionDecision).toBe("ACCEPTABLE");
    expect(row.auditDecision).toBe("INSUFFICIENT_COVERAGE");
    expect(row.cohorts).toEqual(expect.arrayContaining([
      "low_score_incomplete_coverage",
      "acceptable_limited_coverage"
    ]));
  });

  it("flags hard evidence cases", () => {
    const row = buildScoringAuditRow(job({
      resultJson: {
        decision: "DECLINE",
        riskScore: 90,
        proofLevel: "exact_scam_or_taint_proof",
        assessment: {
          hardBadEvidence: [{ kind: "fast_critical" }]
        }
      }
    }));

    expect(row.hardEvidenceObserved).toBe(true);
    expect(row.evidenceClass).toBe("hard");
    expect(row.cohorts).toContain("hard_evidence_cases");
  });

  it("extracts nested persisted where-is-money reports", () => {
    const row = buildScoringAuditRow(job({
      kind: "where_is_money_check",
      resultJson: {
        whereIsMoneyReport: {
          decision: "DECLINE",
          riskScore: 88,
          proofLevel: "exact_scam_or_taint_proof",
          coverage: {
            partial: true,
            fetchedAddressCount: 4,
            notes: ["cross-chain boundary reached"]
          },
          assessment: {
            hardBadEvidence: [{ kind: "sanctioned_service" }],
            reasons: ["amount path to hard evidence"]
          }
        }
      }
    }));

    expect(row.finalScore).toBe(88);
    expect(row.productionDecision).toBe("DECLINE");
    expect(row.coverageStatus).toBe("partial");
    expect(row.hardEvidenceObserved).toBe(true);
    expect(row.evidenceClass).toBe("hard");
    expect(row.missingChecks).toContain("cross-chain boundary reached");
    expect(row.cohorts).toEqual(expect.arrayContaining([
      "high_score_partial_coverage",
      "hard_evidence_cases"
    ]));
  });

  it("flags conflicting layer decisions", () => {
    const row = buildScoringAuditRow(job({
      kind: "incoming_deposit_check",
      resultJson: {
        decision: "ACCEPTABLE",
        depositRiskScore: 20,
        unifiedRiskSummary: {
          finalScore: 72,
          finalLevel: "HIGH",
          finalDecision: "DECLINE",
          policyFloor: 70,
          dampener: 0,
          activeAnchor: {
            code: "source_policy_floor",
            score: 70
          }
        }
      }
    }));

    expect(row.productionDecision).toBe("ACCEPTABLE");
    expect(row.finalScore).toBe(72);
    expect(row.activeAnchorCode).toBe("source_policy_floor");
    expect(row.cohorts).toContain("conflicting_layers");
  });

  it("counts cohorts", () => {
    const rows = [
      buildScoringAuditRow(job({
        id: "job-high",
        resultJson: {
          decision: "DECLINE",
          riskScore: 72,
          coverage: { partial: true, fetchedAddressCount: 3 },
          assessment: { hardBadEvidence: [] },
          reasons: ["service context"]
        }
      })),
      buildScoringAuditRow(job({
        id: "job-hard",
        resultJson: {
          decision: "DECLINE",
          riskScore: 95,
          proofLevel: "exact_scam_or_taint_proof",
          assessment: { hardBadEvidence: [{ kind: "provider_label" }] }
        }
      }))
    ];

    expect(cohortCounts(rows)).toMatchObject({
      high_score_partial_coverage: 1,
      decline_without_hard_evidence: 1,
      hard_evidence_cases: 1
    });
  });
});
