import { describe, expect, it } from "vitest";
import { buildServiceExposureProfile } from "../../src/forensics/serviceExposure";
import type { ForensicRouteEdge } from "../../src/types";

const source = "TSource111111111111111111111111111111";
const bridge = "TBridge111111111111111111111111111111";
const hop = "THop1111111111111111111111111111111";
const pool = "TPool111111111111111111111111111111";
const cex = "TCex1111111111111111111111111111111";

function edge(overrides: Partial<ForensicRouteEdge> = {}): ForensicRouteEdge {
  return {
    id: overrides.id ?? "edge-1",
    fromAddress: overrides.fromAddress ?? source,
    toAddress: overrides.toAddress ?? bridge,
    txHash: overrides.txHash ?? "tx-1",
    amountRaw: overrides.amountRaw ?? "100000000",
    timestamp: overrides.timestamp ?? new Date("2026-05-05T10:00:00.000Z"),
    method: overrides.method ?? "transfer",
    edgeType: overrides.edgeType ?? "normal_transfer"
  };
}

describe("service exposure profile", () => {
  it("scores direct and one-hop outgoing service exposure without double counting source exits", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "direct-bridge", txHash: "direct-bridge", toAddress: bridge, amountRaw: "300000000" }),
        edge({ id: "to-hop", txHash: "to-hop", toAddress: hop, amountRaw: "100000000" }),
        edge({
          id: "hop-pool",
          txHash: "hop-pool",
          fromAddress: hop,
          toAddress: pool,
          amountRaw: "95000000",
          timestamp: new Date("2026-05-05T10:30:00.000Z")
        })
      ],
      classifications: new Map([
        [bridge, { category: "bridge", identity: "Allbridge Bridge", confidence: "high", evidence: [], isBoundary: true }],
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [pool, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.totalOutgoingRaw).toBe("400000000");
    expect(profile.totalOutgoingCount).toBe(2);
    expect(profile.directServiceVolumeRatio).toBe(0.75);
    expect(profile.indirectServiceVolumeRatio).toBe(0.25);
    expect(profile.combinedServiceVolumeRatio).toBe(1);
    expect(profile.dominantCategory).toBe("bridge");
    expect(profile.bestAmountPreservationRatio).toBe(0.95);
    expect(profile.exposureScore).toBeGreaterThanOrEqual(60);
  });

  it("does not count one-hop exposure when time ordering or amount preservation fails", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "to-hop-valid", txHash: "to-hop-valid", toAddress: hop, amountRaw: "100000000" }),
        edge({
          id: "hop-pool-before",
          txHash: "hop-pool-before",
          fromAddress: hop,
          toAddress: pool,
          amountRaw: "95000000",
          timestamp: new Date("2026-05-05T09:59:00.000Z")
        }),
        edge({ id: "to-cex-low", txHash: "to-cex-low", toAddress: "THop2222222222222222222222222222222", amountRaw: "100000000" }),
        edge({
          id: "low-cex",
          txHash: "low-cex",
          fromAddress: "THop2222222222222222222222222222222",
          toAddress: cex,
          amountRaw: "69000000",
          timestamp: new Date("2026-05-05T10:10:00.000Z")
        })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        ["THop2222222222222222222222222222222", { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [pool, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }],
        [cex, { category: "cex", identity: "Exchange", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.indirectServiceVolumeRatio).toBe(0);
    expect(profile.combinedServiceVolumeRatio).toBe(0);
    expect(profile.dominantCategory).toBeNull();
  });
});
