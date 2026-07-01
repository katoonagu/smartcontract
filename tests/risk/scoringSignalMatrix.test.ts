import { describe, expect, it } from "vitest";
import {
  scoreMatrixCandidates,
  type MatrixActionUnit,
  type MatrixCandidate,
  type MatrixEvidenceRow
} from "../../src/risk/scoringSignalMatrix";

function candidate(overrides: Partial<MatrixCandidate> = {}): MatrixCandidate {
  return {
    row: "behavior_only_prior",
    actionUnit: "wallet",
    score: 50,
    decisionEligibility: "review_only",
    evidenceIds: ["evidence:1"],
    evidenceEpisodeIds: ["episode:1"],
    atomicSignals: ["address_behavior_fast_post_deposit_exit"],
    modifiers: [],
    caps: [],
    dampeners: [],
    caveats: [],
    ...overrides
  };
}

function scored(row: MatrixEvidenceRow, score: number, actionUnit: MatrixActionUnit = "wallet"): MatrixCandidate {
  return candidate({
    row,
    actionUnit,
    score,
    decisionEligibility: score >= 60 ? "can_decline" : "review_only",
    evidenceIds: [`${row}:evidence`],
    evidenceEpisodeIds: [`${row}:episode`],
    atomicSignals: [row]
  });
}

describe("scoreMatrixCandidates", () => {
  it("hard proof wins and emits null calibration products", () => {
    const result = scoreMatrixCandidates([
      scored("clean_or_operational", 5),
      scored("hard_proof", 95)
    ]);

    expect(result).toMatchObject({
      policyVersion: "scoring-signal-matrix-v1",
      policyScore: 95,
      matrixDecision: "DECLINE",
      winningRow: "hard_proof",
      actionUnit: "wallet",
      queuePriorityScore: null,
      calibratedRiskProbability: null
    });
  });

  it("does not let coverage uncertainty create badness", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "coverage_uncertainty",
        score: 65,
        decisionEligibility: "insufficient_only",
        atomicSignals: ["insufficient_coverage"],
        evidenceIds: ["coverage:limited"],
        evidenceEpisodeIds: ["coverage:limited"]
      })
    ]);

    expect(result.policyScore).toBeNull();
    expect(result.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.winningRow).toBe("coverage_uncertainty");
    expect(result.uncertaintyState.coverage).toBe("insufficient");
  });

  it("caps behavior-only evidence below decline threshold", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "behavior_only_prior",
        score: 82,
        decisionEligibility: "can_decline",
        atomicSignals: ["address_behavior_high_volume_transit"]
      })
    ]);

    expect(result.policyScore).toBe(59);
    expect(result.matrixDecision).toBe("REVIEW");
    expect(result.riskVector.behavior_only_prior?.[0].caps).toContain("behavior_only_cap_59");
  });

  it("caps typology-only evidence below 60 without an anchor", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "typology_subgraph_pattern",
        score: 72,
        decisionEligibility: "can_decline",
        atomicSignals: ["split_merge_service_exit"]
      })
    ]);

    expect(result.policyScore).toBe(59);
    expect(result.matrixDecision).toBe("REVIEW");
    expect(result.riskVector.typology_subgraph_pattern?.[0].caps).toContain("typology_without_anchor_cap_59");
  });

  it("allows anchored typology to remain above 60 but keeps review eligibility when not auto-declinable", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "typology_subgraph_pattern",
        score: 72,
        decisionEligibility: "review_only",
        atomicSignals: ["fast_cashout_to_legitimate_service"],
        modifiers: ["service_anchor"]
      })
    ]);

    expect(result.policyScore).toBe(72);
    expect(result.matrixDecision).toBe("REVIEW");
  });

  it("deduplicates multiple candidates from the same evidence episode", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "behavior_only_prior",
        score: 58,
        evidenceIds: ["tx:a", "tx:a:behavior"],
        evidenceEpisodeIds: ["episode:a"],
        atomicSignals: ["address_behavior_fast_post_deposit_exit"]
      }),
      candidate({
        row: "counterparty_context",
        score: 45,
        evidenceIds: ["tx:a:counterparty"],
        evidenceEpisodeIds: ["episode:a"],
        atomicSignals: ["counterparty_behavior_context"]
      })
    ]);

    expect(result.policyScore).toBe(58);
    expect(result.riskVector.behavior_only_prior).toHaveLength(1);
    expect(result.riskVector.counterparty_context ?? []).toHaveLength(0);
  });

  it("treats clean operational evidence as acceptable when no stronger row exists", () => {
    const result = scoreMatrixCandidates([
      candidate({
        row: "clean_or_operational",
        score: 7,
        decisionEligibility: "acceptable_only",
        atomicSignals: ["clean_cex_source"],
        evidenceIds: ["source:clean"],
        evidenceEpisodeIds: ["source:clean"]
      })
    ]);

    expect(result.policyScore).toBe(7);
    expect(result.matrixDecision).toBe("ACCEPTABLE");
  });
});
