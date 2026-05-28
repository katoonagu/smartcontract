import { describe, expect, it } from "vitest";
import { decideRiskPolicy } from "../../src/risk/riskPolicyEngine";

describe("risk policy engine", () => {
  it("hard-declines exact approval-drain evidence", () => {
    const decision = decideRiskPolicy({
      taintScore: 0,
      approvalDrainScore: 92,
      moneyOriginScore: 0,
      serviceBoundaryScore: 0,
      contractRiskScore: 0,
      operationalPatternScore: 0,
      fastWalletScore: 0,
      coverageRiskScore: 0,
      llmAssistedScore: 0,
      dampenerScore: 0,
      signals: ["approval_drain_exact"]
    });

    expect(decision).toMatchObject({
      internalDecision: "DECLINE",
      userDecision: "DECLINE",
      proofLevel: "exact_approval_drain_provenance",
      riskScore: 92
    });
  });

  it("treats WhiteBIT as policy decline with share-based medium score", () => {
    const decision = decideRiskPolicy({
      taintScore: 0,
      approvalDrainScore: 0,
      moneyOriginScore: 45,
      serviceBoundaryScore: 0,
      contractRiskScore: 0,
      operationalPatternScore: 0,
      fastWalletScore: 0,
      coverageRiskScore: 0,
      llmAssistedScore: 0,
      dampenerScore: 0,
      signals: ["whitebit_source"]
    });

    expect(decision).toMatchObject({
      userDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: 45
    });
  });

  it("accepts only deterministic clean source", () => {
    const decision = decideRiskPolicy({
      taintScore: 0,
      approvalDrainScore: 0,
      moneyOriginScore: 5,
      serviceBoundaryScore: 0,
      contractRiskScore: 0,
      operationalPatternScore: 0,
      fastWalletScore: 0,
      coverageRiskScore: 0,
      llmAssistedScore: 0,
      dampenerScore: 20,
      signals: ["clean_cex_source"]
    });

    expect(decision).toMatchObject({
      internalDecision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      proofLevel: "clean_source_proven"
    });
  });
});
