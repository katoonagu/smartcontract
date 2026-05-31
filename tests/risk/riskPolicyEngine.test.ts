import { describe, expect, it } from "vitest";
import { decideRiskPolicy, riskPolicySignal } from "../../src/risk/riskPolicyEngine";
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
      signals: [riskPolicySignal("approval_drain_exact", ["approval:tx-1"])]
    }));

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: 92
    });
  });

  it("treats WhiteBIT as source-policy context with share-based medium score", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 45,
      signals: [riskPolicySignal("whitebit_source", ["money_path:tx-1"])]
    }));

    expect(decision).toMatchObject({
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_context",
      riskScore: 45
    });
    expect(decision.reasons[0].message).toContain("source-policy context");
    expect(decision.reasons[0].message).toContain("not scam or drain proof");
  });

  it("treats low-score HTX/Huobi exposure as source-policy context", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 45,
      signals: [riskPolicySignal("htx_huobi_source", ["money_path:htx-1"])]
    }));

    expect(decision).toMatchObject({
      internalDecision: "REVIEW",
      userDecision: "ACCEPTABLE",
      proofLevel: "exchange_policy_context",
      riskScore: 45
    });
    expect(decision.reasons[0].message).toContain("source-policy risk");
    expect(decision.reasons[0].message).toContain("not scam or drain proof");
  });

  it("declines high-score HTX/Huobi exposure as source-policy risk", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 65,
      signals: [riskPolicySignal("htx_huobi_source", ["money_path:htx-2"])]
    }));

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: 65
    });
    expect(decision.reasons[0].message).toContain("source-policy risk");
    expect(decision.reasons[0].message).toContain("not scam or drain proof");
  });

  it("keeps low-score WhiteBIT exposure as source-policy context", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 38,
      signals: [riskPolicySignal("whitebit_source", ["money_path:whitebit-1"])]
    }));

    expect(decision).toMatchObject({
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_context",
      riskScore: 38
    });
    expect(decision.reasons[0].message).toContain("source-policy context");
    expect(decision.reasons[0].message).toContain("not scam or drain proof");
  });

  it("accepts only deterministic clean source", () => {
    const decision = decideRiskPolicy(scoreComponents({
      moneyOriginScore: 5,
      dampenerScore: 20,
      signals: [riskPolicySignal("clean_cex_source", ["money_path:clean-1"])]
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
      signals: [riskPolicySignal("exact_taint", ["label:scam-1"])]
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
      signals: [riskPolicySignal("whitebit_source", ["money_path:tx-1"])]
    }));

    expect(decision.reasons[0].evidenceIds).toContain("money_path:tx-1");
  });

  it("rejects helper-created signals without evidence", () => {
    expect(() => riskPolicySignal("whitebit_source", [])).toThrow("Evidence ids are required");
  });

  it("rejects helper-created signals with blank evidence IDs", () => {
    expect(() => riskPolicySignal("whitebit_source", ["  "])).toThrow("Evidence ids are required");
  });

  it("rejects selected malformed direct signals without evidence", () => {
    expect(() => decideRiskPolicy(scoreComponents({
      moneyOriginScore: 45,
      signals: [{ code: "whitebit_source", evidenceIds: [] }]
    }))).toThrow("Evidence ids are required");
  });

  it("rejects selected malformed direct signals with blank evidence IDs", () => {
    expect(() => decideRiskPolicy(scoreComponents({
      moneyOriginScore: 45,
      signals: [{ code: "whitebit_source", evidenceIds: [""] }]
    }))).toThrow("Evidence ids are required");
  });

  it("keeps hard approval-drain decline above conflicting clean source", () => {
    const decision = decideRiskPolicy(scoreComponents({
      approvalDrainScore: 92,
      moneyOriginScore: 5,
      signals: [
        riskPolicySignal("clean_cex_source", ["money_path:clean-1"]),
        riskPolicySignal("approval_drain_exact", ["approval:tx-1"])
      ]
    }));

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: 92
    });
  });
});
