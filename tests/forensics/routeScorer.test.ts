import { describe, expect, it } from "vitest";
import { scoreRouteCandidate } from "../../src/forensics/routeScorer";
import type { ForensicRouteEdge } from "../../src/types";

const source = "TSource111111111111111111111111111111";
const hop = "THop1111111111111111111111111111111";
const target = "TTarget111111111111111111111111111111";

function edge(overrides: Partial<ForensicRouteEdge> = {}): ForensicRouteEdge {
  return {
    id: overrides.id ?? "edge-1",
    fromAddress: overrides.fromAddress ?? source,
    toAddress: overrides.toAddress ?? hop,
    txHash: overrides.txHash ?? "tx-1",
    amountRaw: overrides.amountRaw ?? "320000000000",
    timestamp: overrides.timestamp ?? new Date("2026-05-05T10:00:00.000Z"),
    method: overrides.method ?? "transfer",
    edgeType: overrides.edgeType ?? "normal_transfer"
  };
}

describe("route scorer", () => {
  it("scores an exact fast amount-preserving route as high confidence", () => {
    const result = scoreRouteCandidate({
      sourceAddress: source,
      targetAddress: target,
      targetAmountRaw: "320000000000",
      edges: [
        edge(),
        edge({
          id: "edge-2",
          fromAddress: hop,
          toAddress: target,
          txHash: "tx-2",
          amountRaw: "307200000000",
          timestamp: new Date("2026-05-05T10:14:00.000Z")
        })
      ],
      addressMetadata: new Map()
    });

    expect(result.pathAddresses).toEqual([source, hop, target]);
    expect(result.confidence).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(result.features.map((feature) => feature.code)).toContain("amount_preservation");
    expect(result.features.map((feature) => feature.code)).toContain("time_proximity");
    expect(result.reasons.every((reason) => !reason.message.toLowerCase().includes("fraud proven"))).toBe(true);
  });

  it("adds strong evidence for spender-called transferFrom routes", () => {
    const result = scoreRouteCandidate({
      sourceAddress: source,
      targetAddress: target,
      targetAmountRaw: "320000000000",
      edges: [
        edge({
          method: "transferFrom",
          edgeType: "transfer_from"
        }),
        edge({
          id: "edge-2",
          fromAddress: hop,
          toAddress: target,
          txHash: "tx-2",
          timestamp: new Date("2026-05-05T10:05:00.000Z")
        })
      ],
      addressMetadata: new Map()
    });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.features).toContainEqual(expect.objectContaining({ code: "transfer_from_from_source", scoreImpact: 40 }));
  });

  it("dampens paths that route through a known service hub", () => {
    const result = scoreRouteCandidate({
      sourceAddress: source,
      targetAddress: target,
      targetAmountRaw: "320000000000",
      edges: [
        edge(),
        edge({
          id: "edge-2",
          fromAddress: hop,
          toAddress: target,
          txHash: "tx-2",
          amountRaw: "318000000000",
          timestamp: new Date("2026-05-05T10:05:00.000Z")
        })
      ],
      addressMetadata: new Map([
        [
          hop,
          {
            address: hop,
            name: "Bridgers",
            tag: "Bridgers:Cross-chain Bridge",
            isContract: true,
            verified: true
          }
        ]
      ])
    });

    expect(result.features).toContainEqual(expect.objectContaining({ code: "service_hub_dampener", scoreImpact: -20 }));
    expect(result.confidence).toBe("low");
    expect(result.score).toBeLessThan(60);
  });
});
