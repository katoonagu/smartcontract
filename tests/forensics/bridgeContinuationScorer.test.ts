import { describe, expect, it } from "vitest";
import {
  classifyContinuationEdge,
  groupSplitJoinEdges,
  terminalAllowedForContinuationClass
} from "../../src/forensics/bridgeContinuationScorer";
import type { CrossChainContinuationEdge, CrossChainContinuationSeed } from "../../src/forensics/crossChainContinuationTypes";

const seed: CrossChainContinuationSeed = {
  id: "seed:eth:bridge",
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  txHash: "0xseed",
  amountRaw: "100000000000",
  assetSymbol: "USDT",
  timestamp: "2026-05-05T02:41:59.000Z",
  labels: ["LayerZero"],
  evidenceRefs: []
};

function edge(overrides: Partial<CrossChainContinuationEdge>): CrossChainContinuationEdge {
  return {
    id: "edge",
    edgeType: "token_transfer",
    source: { chain: "ethereum", chainId: 1, address: "0xaaa0000000000000000000000000000000000000" },
    destination: { chain: "ethereum", chainId: 1, address: "0xbbb0000000000000000000000000000000000000" },
    txHash: "0xedge",
    amountRaw: "99000000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-05T03:00:00.000Z",
    protocol: null,
    evidenceRefs: [],
    labels: [],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: [],
    ...overrides
  };
}

describe("bridge continuation scorer", () => {
  it("classifies provider and protocol evidence as protocol correlated", () => {
    const result = classifyContinuationEdge(seed, edge({
      protocol: "LayerZero/Stargate",
      evidenceRefs: [{
        id: "cross_chain:range:ethereum:0xseed:bridge_source",
        provider: "range",
        payloadId: "range:tx:0xseed",
        confidence: "provider_correlated"
      }]
    }));

    expect(result.continuationEvidenceClass).toBe("protocol_correlated");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("classifies close amount and time as strong amount-time", () => {
    const result = classifyContinuationEdge(seed, edge({ amountRaw: "97000000000" }));
    expect(result.continuationEvidenceClass).toBe("strong_amount_time");
    expect(result.reasons.join(" ")).toContain("amount");
  });

  it("keeps amount-only evidence weak", () => {
    const result = classifyContinuationEdge(seed, edge({
      timestamp: "2026-06-01T03:00:00.000Z",
      amountRaw: "99000000000"
    }));
    expect(result.continuationEvidenceClass).toBe("weak_candidate");
  });

  it("groups split/join edges when summed amount is preserved", () => {
    const group = groupSplitJoinEdges(seed, [
      edge({ id: "a", txHash: "0xa", amountRaw: "60000000000" }),
      edge({ id: "b", txHash: "0xb", amountRaw: "39000000000" })
    ]);

    expect(group?.continuationEvidenceClass).toBe("split_join");
    expect(group?.amountRaw).toBe("99000000000");
  });

  it("does not allow weak candidates to create proof terminals", () => {
    expect(terminalAllowedForContinuationClass("tornado_or_mixer", "weak_candidate")).toBe(false);
    expect(terminalAllowedForContinuationClass("no_name_token_liquidity", "weak_candidate")).toBe(false);
    expect(terminalAllowedForContinuationClass("candidate_only", "weak_candidate")).toBe(true);
  });
});
