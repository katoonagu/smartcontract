import { describe, expect, it } from "vitest";
import { decideRiskPolicy } from "../../src/risk/riskPolicyEngine";
import type { ScoreComponents } from "../../src/risk/riskPolicyEngine";

function scoreComponents(overrides: Partial<ScoreComponents>): ScoreComponents {
  return {
    taintScore: 0,
    approvalDrainScore: 0,
    moneyOriginScore: 0,
    serviceBoundaryScore: 0,
    contractRiskScore: 0,
    operationalPatternScore: 0,
    fastWalletScore: 0,
    coverageRiskScore: 0,
    llmAssistedScore: 0,
    dampenerScore: 0,
    signals: [],
    ...overrides
  };
}

describe("risk policy engine", () => {
  it("hard-declines exact approval-drain evidence", () => {
    const decision = decideRiskPolicy(scoreComponents({
      approvalDrainScore: 92,
      signals: ["approval_drain_exact"]
    }));

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: 92
    });
  });

  it("treats WhiteBIT as policy decline with share-based medium score", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 45,
      signals: ["whitebit_source"]
    }));

    expect(decision).toMatchObject({
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: 45
    });
  });

  it("accepts only deterministic clean source", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 5,
      dampenerScore: 20,
      signals: ["clean_cex_source"]
    }));

    expect(decision).toMatchObject({
      internalDecision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      proofLevel: "clean_source_proven"
    });
  });

  it("caps exact taint risk score at 100", () => {
    const decision = decideRiskPolicy(scoreComponents({
      taintScore: 500,
      signals: ["exact_taint"]
    }));

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_scam_or_taint_proof",
      riskScore: 100
    });
  });

  it("returns a finite fallback score when component scores are NaN", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: Number.NaN,
      serviceBoundaryScore: Number.NaN,
      contractRiskScore: Number.NaN,
      operationalPatternScore: Number.NaN,
      fastWalletScore: Number.NaN,
      coverageRiskScore: Number.NaN,
      llmAssistedScore: Number.NaN,
      dampenerScore: Number.NaN
    }));

    expect(Number.isFinite(decision.riskScore)).toBe(true);
    expect(decision.riskScore).not.toBeNaN();
    expect(decision).toMatchObject({
      internalDecision: "REVIEW",
      userDecision: "DECLINE",
      proofLevel: "insufficient_coverage"
    });
  });

  it("includes evidence IDs from object signals in the matched reason", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 45,
      signals: [{ code: "whitebit_source", evidenceIds: ["money_path:tx-1"] }]
    }));

    expect(decision.reasons[0].evidenceIds).toContain("money_path:tx-1");
  });

  it("keeps hard approval-drain decline above conflicting clean source", () => {
    const decision = decideRiskPolicy(scoreComponents({
      approvalDrainScore: 92,
      moneyOriginScore: 5,
      signals: ["clean_cex_source", "approval_drain_exact"]
    }));

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: 92
    });
  });
});
