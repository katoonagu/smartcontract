import { describe, expect, it } from "vitest";
import {
  scoreMatrixCandidates,
  type MatrixCandidate,
  type MatrixCandidateContext,
  type MatrixEvidenceAuthority
} from "../../src/risk/scoringSignalMatrix";

const matrixContext: MatrixCandidateContext = {
  decisionScope: "wallet_unified",
  subjectAddress: "TMatrixSubject111111111111111111111",
  subjectTxHash: null,
  requiredCoverage: "wallet_provenance"
};

const matrixDraft = (
  authority: MatrixEvidenceAuthority,
  overrides: Partial<MatrixCandidate> = {}
): MatrixCandidate => ({
  row: "behavior_only_prior",
  actionUnit: "wallet",
  score: 45,
  evidenceIds: ["evidence:1"],
  evidenceEpisodeIds: ["episode:1"],
  atomicSignals: ["context"],
  modifiers: [],
  caps: [],
  dampeners: [],
  caveats: [],
  subject: {
    decisionScope: matrixContext.decisionScope,
    address: matrixContext.subjectAddress,
    txHash: matrixContext.subjectTxHash
  },
  authority,
  ...overrides
});

describe("scoreMatrixCandidates", () => {
  it("preserves authoritative hard proof and emits null calibration products", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({ kind: "clean", coverageDependency: "wallet_provenance" }, {
        row: "clean_or_operational",
        score: 5,
        evidenceEpisodeIds: ["episode:clean"]
      }),
      matrixDraft({ kind: "exact_hard", proofSource: "stablecoin_restriction" }, {
        row: "hard_proof",
        score: 95,
        modifiers: ["hard_anchor"],
        evidenceEpisodeIds: ["episode:hard"]
      })
    ], matrixContext);

    expect(result).toMatchObject({
      policyVersion: "scoring-signal-matrix-v1",
      policyScore: 95,
      matrixDecision: "DECLINE",
      winningRow: "hard_proof",
      actionUnit: "wallet",
      queuePriorityScore: null,
      calibratedRiskProbability: null
    });
    expect(result.riskVector.hard_proof?.[0]).toMatchObject({
      evidenceClass: "exact_hard",
      proofLevel: "exact",
      decisionEligibility: "can_decline",
      coverageDependency: "none",
      subject: {
        decisionScope: "wallet_unified",
        address: matrixContext.subjectAddress,
        txHash: null
      }
    });
  });

  it("does not let coverage evidence create badness", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({ kind: "coverage", coverageDependency: "wallet_provenance" }, {
        row: "coverage_uncertainty",
        score: 65,
        atomicSignals: ["insufficient_coverage"],
        evidenceIds: ["coverage:limited"],
        evidenceEpisodeIds: ["coverage:limited"]
      })
    ], matrixContext);

    expect(result.policyScore).toBeNull();
    expect(result.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.winningRow).toBe("coverage_uncertainty");
    expect(result.winningCandidate.evidenceClass).toBe("coverage");
    expect(result.uncertaintyState.coverage).toBe("insufficient");
  });

  it("caps behavior-only context below decline threshold", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({ kind: "context" }, {
        row: "behavior_only_prior",
        score: 82,
        atomicSignals: ["address_behavior_high_volume_transit"]
      })
    ], matrixContext);

    expect(result.policyScore).toBe(59);
    expect(result.matrixDecision).toBe("REVIEW");
    expect(result.riskVector.behavior_only_prior?.[0].caps).toContain("context_cap_59");
  });

  it("caps typology-only pattern below 60 without an anchor", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({
        kind: "pattern",
        decisionEligibility: "can_decline",
        coverageDependency: "wallet_provenance"
      }, {
        row: "typology_subgraph_pattern",
        score: 72,
        atomicSignals: ["split_merge_service_exit"]
      })
    ], matrixContext);

    expect(result.policyScore).toBe(59);
    expect(result.matrixDecision).toBe("REVIEW");
    expect(result.riskVector.typology_subgraph_pattern?.[0].caps).toContain("typology_without_anchor_cap_59");
  });

  it("allows anchored typology above 60 while preserving review-only authority", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({
        kind: "pattern",
        decisionEligibility: "review_only",
        coverageDependency: "wallet_provenance"
      }, {
        row: "typology_subgraph_pattern",
        score: 72,
        atomicSignals: ["fast_cashout_to_legitimate_service"],
        modifiers: ["service_anchor"]
      })
    ], matrixContext);

    expect(result.policyScore).toBe(72);
    expect(result.matrixDecision).toBe("REVIEW");
  });

  it("deduplicates multiple contextual candidates from one evidence episode", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({ kind: "context" }, {
        row: "behavior_only_prior",
        score: 58,
        evidenceIds: ["tx:a", "tx:a:behavior"],
        evidenceEpisodeIds: ["episode:a"],
        atomicSignals: ["address_behavior_fast_post_deposit_exit"]
      }),
      matrixDraft({ kind: "context" }, {
        row: "counterparty_context",
        score: 45,
        evidenceIds: ["tx:a:counterparty"],
        evidenceEpisodeIds: ["episode:a"],
        atomicSignals: ["counterparty_behavior_context"]
      })
    ], matrixContext);

    expect(result.policyScore).toBe(58);
    expect(result.riskVector.behavior_only_prior).toHaveLength(1);
    expect(result.riskVector.counterparty_context ?? []).toHaveLength(0);
  });

  it("treats clean operational evidence as acceptable when no stronger candidate exists", () => {
    const result = scoreMatrixCandidates([
      matrixDraft({ kind: "clean", coverageDependency: "wallet_provenance" }, {
        row: "clean_or_operational",
        score: 7,
        atomicSignals: ["clean_cex_source"],
        evidenceIds: ["source:clean"],
        evidenceEpisodeIds: ["source:clean"]
      })
    ], matrixContext);

    expect(result.policyScore).toBe(7);
    expect(result.matrixDecision).toBe("ACCEPTABLE");
  });

  it("does not promote a contextual candidate merely because it uses the hard_proof row", () => {
    const scored = scoreMatrixCandidates([
      matrixDraft({ kind: "context" }, { row: "hard_proof", score: 100 })
    ], matrixContext);

    expect(scored.riskVector.hard_proof?.[0]).toMatchObject({
      evidenceClass: "context",
      proofLevel: "context",
      decisionEligibility: "review_only",
      score: 59
    });
    expect(scored.matrixDecision).toBe("REVIEW");
  });

  it("keeps exact hard proof when a higher pattern candidate shares its episode", () => {
    const scored = scoreMatrixCandidates([
      matrixDraft({ kind: "exact_hard", proofSource: "stablecoin_restriction" }, {
        row: "hard_proof",
        score: 95
      }),
      matrixDraft({
        kind: "pattern",
        decisionEligibility: "can_decline",
        coverageDependency: "wallet_provenance"
      }, { row: "service_linked_pattern", score: 100 })
    ], matrixContext);

    expect(scored.riskVector.hard_proof).toEqual([
      expect.objectContaining({ evidenceClass: "exact_hard", score: 95 })
    ]);
  });

  it("rejects a candidate linked to another subject", () => {
    expect(() => scoreMatrixCandidates([
      matrixDraft({ kind: "context" }, {
        subject: { ...matrixDraft({ kind: "context" }).subject, address: "TOtherMatrixSubject" }
      })
    ], matrixContext)).toThrow("matrix candidate subject does not match scoring context");
  });

  it("rejects exact authority outside the hard_proof row", () => {
    expect(() => scoreMatrixCandidates([
      matrixDraft({ kind: "exact_hard", proofSource: "fast_exact_code" }, {
        row: "behavior_only_prior"
      })
    ], matrixContext)).toThrow("exact hard authority requires the hard_proof matrix row");
  });
});
