import { describe, expect, it } from "vitest";
import type {
  CrossChainCorridorReport,
  CrossChainId,
  CrossChainKnownId,
  CrossChainTerminalBoundary,
  RiskLayerScore,
  SourceExposureKind,
  WhereIsMoneyHardBadEvidence
} from "../../src/types";

describe("cross-chain types", () => {
  it("includes BSC and candidate-only continuation terminals", () => {
    const knownChain: CrossChainKnownId = "bsc";
    const terminal: CrossChainTerminalBoundary = "candidate_only";
    expect([knownChain, terminal]).toEqual(["bsc", "candidate_only"]);
  });

  it("preserves known chain ids while allowing provider-specific ids", () => {
    const knownChain: CrossChainKnownId = "ethereum";
    const customChain: CrossChainId = "base-mainnet";
    const knownAsOpenChain: CrossChainId = knownChain;

    expect([knownAsOpenChain, customChain]).toEqual(["ethereum", "base-mainnet"]);
  });

  it("allows no-name, mixer, and sanctioned source exposure kinds", () => {
    const kinds: SourceExposureKind[] = ["no_name_token_liquidity", "mixer", "sanctioned_service"];
    expect(kinds).toHaveLength(3);
  });

  it("allows exact sanctioned hard evidence", () => {
    const evidence: WhereIsMoneyHardBadEvidence = {
      kind: "sanctioned_service",
      score: 98,
      message: "Exact sanctioned service evidence found in cross-chain corridor.",
      evidenceIds: ["cross_chain:local:ethereum:0xsanctioned:service_boundary"]
    };
    expect(evidence.kind).toBe("sanctioned_service");
  });

  it("allows cross-chain report payload refs and risk layers", () => {
    const layer: RiskLayerScore = {
      evidenceClass: "source_policy",
      kind: "cross_chain_no_name_token_liquidity",
      sourceExposureKind: "no_name_token_liquidity",
      score: 82,
      rawScore: 82,
      adjustedScore: 82,
      proofLevel: "exchange_policy_decline",
      canBeDampened: false,
      reasons: ["No-name token liquidity was found in the selected corridor."],
      warnings: ["This is source-policy evidence, not direct scam proof."],
      evidenceIds: ["cross_chain:local:ethereum:gary:unknown_token_liquidity"]
    };
    const report: CrossChainCorridorReport = {
      enabled: true,
      triggered: true,
      skippedReason: null,
      paths: [],
      providerCalls: 1,
      partial: false,
      coverageNotes: [],
      payloadRefs: [{
        id: "range:tx:0x7284",
        provider: "range",
        endpoint: "transfers/by-tx",
        fetchedAt: "2026-06-01T00:00:00.000Z"
      }]
    };
    expect(layer.sourceExposureKind).toBe("no_name_token_liquidity");
    expect(report.payloadRefs[0]?.provider).toBe("range");
  });
});
