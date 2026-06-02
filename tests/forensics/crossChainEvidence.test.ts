import { describe, expect, it } from "vitest";
import {
  crossChainEvidenceId,
  payloadRefId,
  scoreCrossChainTerminalBoundary,
  sourcePolicyEvidenceFromCrossChainLayer
} from "../../src/forensics/crossChainEvidence";

describe("crossChainEvidence", () => {
  it("scores candidate-only continuation as data quality only", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "candidate_only",
      selectedShare: 1,
      evidenceIds: ["cross_chain:local:ethereum:candidate:candidate_only"]
    });

    expect(layer.evidenceClass).toBe("data_quality");
    expect(layer.proofLevel).toBe("insufficient_coverage");
    expect(layer.score).toBe(20);
    expect(layer.sourceExposureKind).toBeUndefined();
    expect(layer.warnings.join(" ")).toContain("candidate");
  });

  it("builds stable cross-chain evidence ids", () => {
    expect(crossChainEvidenceId("range", "ethereum", "0xabc", "bridge_source")).toBe(
      "cross_chain:range:ethereum:0xabc:bridge_source"
    );
  });

  it("builds stable provider payload reference ids", () => {
    expect(payloadRefId("range", "transfers/by-tx", "ethereum:0xabc")).toBe(
      "range:transfers/by-tx:ethereum:0xabc"
    );
  });

  it("scores no-name token liquidity as non-dampenable source-policy risk", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "no_name_token_liquidity",
      selectedShare: 1,
      evidenceIds: ["evidence:no-name"]
    });

    expect(layer).toMatchObject({
      evidenceClass: "source_policy",
      kind: "cross_chain_no_name_token_liquidity",
      sourceExposureKind: "no_name_token_liquidity",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false,
      evidenceIds: ["evidence:no-name"]
    });
    expect(layer.score).toBeGreaterThanOrEqual(75);
    expect(layer.warnings.join(" ")).toContain("not direct scam/theft proof");

    expect(sourcePolicyEvidenceFromCrossChainLayer(layer, {
      aggregateShare: 1,
      effectiveShare: 0.9,
      pathCount: 2
    })).toMatchObject({
      kind: "no_name_token_liquidity",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false,
      score: layer.score
    });
  });

  it("scores sanctioned services as hard proof with exact taint proof", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "sanctioned_service",
      selectedShare: 0.4,
      evidenceIds: ["evidence:sanctioned"]
    });

    expect(layer).toMatchObject({
      evidenceClass: "hard_proof",
      sourceExposureKind: "sanctioned_service",
      proofLevel: "exact_scam_or_taint_proof",
      canBeDampened: false
    });
    expect(layer.score).toBeGreaterThanOrEqual(95);
  });

  it("converts tornado or mixer boundaries to non-dampenable mixer source-policy evidence", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "tornado_or_mixer",
      selectedShare: 0.25,
      evidenceIds: ["evidence:mixer"]
    });

    expect(layer).toMatchObject({
      evidenceClass: "source_policy",
      sourceExposureKind: "mixer",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    });
    expect(layer.warnings.join(" ")).toContain("source-policy unless exact sanctioned evidence exists");

    expect(sourcePolicyEvidenceFromCrossChainLayer(layer, {
      aggregateShare: 0.25,
      effectiveShare: 0.2,
      pathCount: 1
    })).toMatchObject({
      kind: "mixer",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    });
  });

  it("maps bridge, DEX/router, and unknown contract terminals to dampenable source-policy evidence", () => {
    expect(scoreCrossChainTerminalBoundary({
      terminalBoundary: "bridge_boundary",
      selectedShare: 1,
      evidenceIds: ["evidence:bridge"]
    })).toMatchObject({
      evidenceClass: "source_policy",
      kind: "cross_chain_bridge_boundary",
      sourceExposureKind: "cross_chain_boundary",
      canBeDampened: true
    });

    expect(scoreCrossChainTerminalBoundary({
      terminalBoundary: "dex_router_boundary",
      selectedShare: 1,
      evidenceIds: ["evidence:dex"]
    })).toMatchObject({
      evidenceClass: "source_policy",
      kind: "cross_chain_dex_router_boundary",
      sourceExposureKind: "bridge_router_dex",
      canBeDampened: true
    });

    expect(scoreCrossChainTerminalBoundary({
      terminalBoundary: "unknown_contract",
      selectedShare: 1,
      evidenceIds: ["evidence:unknown"]
    })).toMatchObject({
      evidenceClass: "source_policy",
      kind: "cross_chain_unknown_contract",
      sourceExposureKind: "unknown_contract",
      proofLevel: "exchange_policy_context",
      canBeDampened: true
    });
  });

  it("clamps selected share while preserving exact sanctioned-service hard proof", () => {
    const oversized = scoreCrossChainTerminalBoundary({
      terminalBoundary: "tornado_or_mixer",
      selectedShare: 1.5,
      evidenceIds: ["evidence:oversized"]
    });
    expect(oversized.score).toBeLessThanOrEqual(100);

    const negativeNoName = scoreCrossChainTerminalBoundary({
      terminalBoundary: "no_name_token_liquidity",
      selectedShare: -0.5,
      evidenceIds: ["evidence:negative"]
    });
    expect(negativeNoName).toMatchObject({
      evidenceClass: "source_policy",
      sourceExposureKind: "no_name_token_liquidity",
      score: 0,
      rawScore: 0,
      adjustedScore: 0
    });

    for (const selectedShare of [0, -1, Number.NaN]) {
      const sanctioned = scoreCrossChainTerminalBoundary({
        terminalBoundary: "sanctioned_service",
        selectedShare,
        evidenceIds: ["evidence:sanctioned-zero"]
      });

      expect(sanctioned).toMatchObject({
        evidenceClass: "hard_proof",
        sourceExposureKind: "sanctioned_service",
        proofLevel: "exact_scam_or_taint_proof"
      });
      expect(sanctioned.score).toBeGreaterThanOrEqual(95);
    }
  });

  it("returns isolated reason and warning arrays for each scored layer", () => {
    const first = scoreCrossChainTerminalBoundary({
      terminalBoundary: "no_name_token_liquidity",
      selectedShare: 1,
      evidenceIds: ["evidence:first"]
    });
    first.reasons.push("mutated reason");
    first.warnings.push("mutated warning");

    const second = scoreCrossChainTerminalBoundary({
      terminalBoundary: "no_name_token_liquidity",
      selectedShare: 1,
      evidenceIds: ["evidence:second"]
    });

    expect(second.reasons).not.toContain("mutated reason");
    expect(second.warnings).not.toContain("mutated warning");
  });

  it("scores data exhaustion as dampenable data-quality insufficient coverage", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "data_exhausted",
      selectedShare: 0.7,
      evidenceIds: ["payload:limit"]
    });

    expect(layer).toMatchObject({
      evidenceClass: "data_quality",
      kind: "cross_chain_data_exhausted",
      proofLevel: "insufficient_coverage",
      canBeDampened: true
    });
    expect(layer.sourceExposureKind).toBeUndefined();
    expect(layer.score).toBe(45);
    expect(sourcePolicyEvidenceFromCrossChainLayer(layer, {
      aggregateShare: 0.7,
      effectiveShare: 0.7,
      pathCount: 1
    })).toBeNull();
  });

  it("scores none as zero and does not convert to source-policy evidence", () => {
    const layer = scoreCrossChainTerminalBoundary({
      terminalBoundary: "none",
      selectedShare: 1,
      evidenceIds: ["evidence:none"]
    });

    expect(layer).toMatchObject({
      evidenceClass: "data_quality",
      kind: "cross_chain_none",
      score: 0,
      rawScore: 0,
      adjustedScore: 0
    });
    expect(layer.sourceExposureKind).toBeUndefined();
    expect(sourcePolicyEvidenceFromCrossChainLayer(layer, {
      aggregateShare: 1,
      effectiveShare: 1,
      pathCount: 1
    })).toBeNull();
  });
});
