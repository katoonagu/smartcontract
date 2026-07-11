import { describe, expect, it } from "vitest";
import { buildScoringAuditRow, cohortCounts } from "../../src/risk/scoringAudit";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../../src/risk/scoringSignalMatrix";
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

  it("does not infer matrix v2 from a legacy winning row without a persisted marker", () => {
    const row = buildScoringAuditRow(job({
      kind: "incoming_deposit_check",
      resultJson: {
        decision: "ACCEPTABLE",
        depositRiskScore: 0,
        coverage: {
          partial: true,
          fetchedAddressCount: 1,
          notes: ["provider limit"]
        },
        unifiedRiskSummary: {
          finalScore: 0,
          finalLevel: "LOW",
          finalDecision: "ACCEPTABLE",
          matrixDecision: "INSUFFICIENT_EVIDENCE",
          winningRow: "coverage_uncertainty",
          policyScore: null,
          calibratedRiskProbability: null,
          activeAnchor: null
        }
      }
    }));

    expect(row.auditDecision).toBe("INSUFFICIENT_COVERAGE");
    expect(row.cohorts).toContain("low_score_incomplete_coverage");
    expect(row.policyVersion).toBe("incoming-deposit-risk-v1");
  });

  it("attributes matrix v2 only from an exact persisted scoring marker", () => {
    const row = buildScoringAuditRow(job({
      kind: "incoming_deposit_check",
      resultJson: {
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        decision: "DECLINE",
        depositRiskScore: 90,
        unifiedRiskSummary: {
          finalScore: 90,
          finalDecision: "DECLINE",
          matrixDecision: "DECLINE",
          winningRow: "direct_counterparty_policy"
        }
      }
    }));

    expect(row.policyVersion).toBe(SCORING_SIGNAL_MATRIX_POLICY_VERSION);
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

  it("uses the where-is-money user decision as the production decision", () => {
    const row = buildScoringAuditRow(job({
      kind: "where_is_money_check",
      resultJson: {
        whereIsMoneyReport: {
          decision: "DECLINE",
          userDecision: "ACCEPTABLE",
          riskScore: 45,
          coverage: { partial: false, fetchedAddressCount: 3 }
        }
      }
    }));

    expect(row.productionDecision).toBe("ACCEPTABLE");
  });

  it("detects top-level incoming hard evidence", () => {
    const row = buildScoringAuditRow(job({
      kind: "incoming_deposit_check",
      resultJson: {
        decision: "DECLINE",
        depositRiskScore: 91,
        hardBadEvidence: [{ kind: "stablecoin_blacklist" }]
      }
    }));

    expect(row.hardEvidenceObserved).toBe(true);
    expect(row.evidenceClass).toBe("hard");
    expect(row.cohorts).toContain("hard_evidence_cases");
  });

  it("attaches source attribution summaries to where-is-money audit rows", () => {
    const row = buildScoringAuditRow(job({
      kind: "where_is_money_check",
      resultJson: {
        whereIsMoneyReport: {
          decision: "REVIEW",
          riskScore: 55,
          originPaths: [{
            rootSourceAddress: "TBinance111111111111111111111111111",
            rootSourceType: "cex",
            exposureSourceLabel: "Binance",
            sourceExposureKind: "allowlisted_cex",
            exposureSourceKey: "cex:binance",
            balanceShare: 0.68,
            effectiveExposureShare: 0.68,
            amountPreservationRatio: 0.95,
            pathAddresses: ["TBinance111111111111111111111111111", "TSubject111111111111111111111111111111"],
            steps: [{}, {}],
            stoppedReason: "clean_cex_reached",
            reasons: ["amount continuity"]
          }]
        }
      }
    }));

    expect(row.sourceAttribution).toMatchObject({
      topSourceShare: 0.68,
      pathStrength: "medium",
      topSourceCandidate: expect.objectContaining({
        label: "Binance",
        address: "TBinance111111111111111111111111111"
      })
    });
  });

  it("attaches source attribution summaries to incoming-deposit audit rows", () => {
    const row = buildScoringAuditRow(job({
      kind: "incoming_deposit_check",
      resultJson: {
        decision: "ACCEPTABLE",
        depositRiskScore: 22,
        originPaths: [{
          sourcePolicy: "clean",
          stoppedReason: "clean_cex_reached",
          pathAddresses: ["TClean111111111111111111111111111111", "TSubject111111111111111111111111111111"],
          steps: [{}, {}],
          amountCoverageRatio: 0.85,
          amountContinuity: "strong",
          reasons: ["incoming origin"]
        }]
      }
    }));

    expect(row.sourceAttribution).toMatchObject({
      topSourceShare: 0.85,
      pathStrength: "strong",
      topSourceCandidate: expect.objectContaining({
        label: "clean",
        address: "TClean111111111111111111111111111111"
      })
    });
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
