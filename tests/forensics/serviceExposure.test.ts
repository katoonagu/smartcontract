import { describe, expect, it } from "vitest";
import { buildServiceExposureProfile } from "../../src/forensics/serviceExposure";
import type { ForensicRouteEdge } from "../../src/types";

const source = "TSource111111111111111111111111111111";
const bridge = "TBridge111111111111111111111111111111";
const hop = "THop1111111111111111111111111111111";
const pool = "TPool111111111111111111111111111111";
const cex = "TCex1111111111111111111111111111111";
const allbridgeLp = "TPhaah11111111111111111111111111111";

function edge(overrides: Partial<ForensicRouteEdge> = {}): ForensicRouteEdge {
  return {
    id: overrides.id ?? "edge-1",
    fromAddress: overrides.fromAddress ?? source,
    toAddress: overrides.toAddress ?? bridge,
    txHash: overrides.txHash ?? "tx-1",
    amountRaw: overrides.amountRaw ?? "100000000",
    timestamp: overrides.timestamp ?? new Date("2026-05-05T10:00:00.000Z"),
    method: overrides.method ?? "transfer",
    edgeType: overrides.edgeType ?? "normal_transfer",
    economicRole: overrides.economicRole,
    economicProtocol: overrides.economicProtocol
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

  it("keeps dust unknown-contract exposure as evidence without positive scoring", () => {
    const unknown = "TUnknown1111111111111111111111111111";
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "large-out", txHash: "large-out", toAddress: hop, amountRaw: "1329857820000" }),
        edge({ id: "dust-unknown", txHash: "dust-unknown", toAddress: unknown, amountRaw: "20000000" })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [unknown, { category: "unknown_contract", identity: "CreatedByContract", confidence: "medium", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.totalOutgoingRaw).toBe("1329877820000");
    expect(profile.topServiceCounterparties).toEqual([
      {
        address: unknown,
        category: "unknown_contract",
        identity: "CreatedByContract",
        volumeRaw: "20000000",
        txCount: 1
      }
    ]);
    expect(profile.exposureScore).toBe(0);
    expect(profile.features.map((item) => item.code)).not.toEqual(expect.arrayContaining([
      "service_exposure_fast_exit",
      "service_exposure_unknown_contract"
    ]));
  });

  it("keeps gross outgoing totals but removes exact GasFree fees from service exposure", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({
          id: "gasfree-principal",
          txHash: "gasfree-principal",
          toAddress: hop,
          amountRaw: "97000000",
          economicRole: "principal",
          economicProtocol: "tron_gasfree"
        }),
        edge({
          id: "gasfree-fee",
          txHash: "gasfree-fee",
          toAddress: bridge,
          amountRaw: "3000000",
          economicRole: "service_fee",
          economicProtocol: "tron_gasfree"
        })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [bridge, { category: "service", identity: "TronLink GasFree provider", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile).toMatchObject({
      totalOutgoingRaw: "100000000",
      totalOutgoingCount: 2,
      directServiceVolumeRatio: 0,
      combinedServiceVolumeRatio: 0,
      exposureScore: 0
    });
    expect(profile.topServiceCounterparties).toEqual([]);
    expect(profile.categoryBreakdown).toEqual([]);
  });

  it("scores meaningful unknown-contract exposure above absolute and relative thresholds", () => {
    const unknown = "TUnknown1111111111111111111111111111";
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "normal-out", txHash: "normal-out", toAddress: hop, amountRaw: "9900000000" }),
        edge({ id: "meaningful-unknown", txHash: "meaningful-unknown", toAddress: unknown, amountRaw: "100000000" })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [unknown, { category: "unknown_contract", identity: null, confidence: "medium", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.combinedServiceVolumeRatio).toBe(0.01);
    expect(profile.exposureScore).toBeGreaterThan(0);
    expect(profile.features.map((item) => item.code)).toEqual(expect.arrayContaining([
      "service_exposure_fast_exit",
      "service_exposure_unknown_contract"
    ]));
  });

  it("merges same-intermediate chunks before matching aggregate service exits", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "chunk-1", txHash: "chunk-1", toAddress: hop, amountRaw: "103950333333", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({ id: "chunk-2", txHash: "chunk-2", toAddress: hop, amountRaw: "103950333333", timestamp: new Date("2026-05-05T11:30:00.000Z") }),
        edge({ id: "chunk-3", txHash: "chunk-3", toAddress: hop, amountRaw: "103950333334", timestamp: new Date("2026-05-05T13:00:00.000Z") }),
        edge({
          id: "lp-exit-1",
          txHash: "lp-exit-1",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "155925500000",
          timestamp: new Date("2026-05-05T13:20:00.000Z")
        }),
        edge({
          id: "lp-exit-2",
          txHash: "lp-exit-2",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "155925500000",
          timestamp: new Date("2026-05-05T13:40:00.000Z")
        })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [allbridgeLp, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.totalOutgoingRaw).toBe("311851000000");
    expect(profile.indirectServiceVolumeRatio).toBe(0);
    expect(profile.mergedServiceVolumeRatio).toBe(1);
    expect(profile.mergedServiceGroupCount).toBe(1);
    expect(profile.combinedServiceVolumeRatio).toBe(1);
    expect(profile.bestAmountPreservationRatio).toBe(1);
    expect(profile.topMergedServiceFlows).toEqual([
      {
        intermediateAddress: hop,
        serviceAddress: allbridgeLp,
        category: "bridge_pool",
        identity: "Allbridge LP",
        incomingRaw: "311851000000",
        outgoingServiceRaw: "311851000000",
        sourceTxCount: 3,
        serviceTxCount: 2,
        amountPreservationRatio: 1,
        firstSourceTransferAt: "2026-05-05T10:00:00.000Z",
        lastServiceTransferAt: "2026-05-05T13:40:00.000Z"
      }
    ]);
    expect(profile.features.map((item) => item.code)).toEqual(expect.arrayContaining([
      "service_exposure_merged_high_volume",
      "service_exposure_merged_bridge_preserved_amount",
      "service_exposure_merged_fast_exit",
      "service_exposure_merge_pattern"
    ]));
  });

  it("allows interleaved split service exits when cumulative exits do not exceed grouped inflows", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "chunk-1", txHash: "chunk-1", toAddress: hop, amountRaw: "100000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({
          id: "exit-1",
          txHash: "exit-1",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "90000000",
          timestamp: new Date("2026-05-05T10:20:00.000Z")
        }),
        edge({ id: "chunk-2", txHash: "chunk-2", toAddress: hop, amountRaw: "100000000", timestamp: new Date("2026-05-05T11:00:00.000Z") }),
        edge({
          id: "exit-2",
          txHash: "exit-2",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "100000000",
          timestamp: new Date("2026-05-05T11:10:00.000Z")
        })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [allbridgeLp, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.mergedServiceVolumeRatio).toBe(1);
    expect(profile.topMergedServiceFlows[0]).toMatchObject({
      incomingRaw: "200000000",
      outgoingServiceRaw: "190000000",
      serviceTxCount: 2,
      amountPreservationRatio: 0.95
    });
  });

  it("rejects interleaved split exits when cumulative service exits exceed grouped inflows", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "chunk-1", txHash: "chunk-1", toAddress: hop, amountRaw: "50000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({
          id: "premature-exit",
          txHash: "premature-exit",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "99000000",
          timestamp: new Date("2026-05-05T10:30:00.000Z")
        }),
        edge({ id: "chunk-2", txHash: "chunk-2", toAddress: hop, amountRaw: "50000000", timestamp: new Date("2026-05-05T11:00:00.000Z") }),
        edge({
          id: "tiny-later-exit",
          txHash: "tiny-later-exit",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "1000000",
          timestamp: new Date("2026-05-05T11:05:00.000Z")
        })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [allbridgeLp, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.mergedServiceVolumeRatio).toBe(0);
    expect(profile.mergedServiceGroupCount).toBe(0);
    expect(profile.topMergedServiceFlows).toEqual([]);
  });

  it("does not double count merged source edges already covered by direct service exposure", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "direct", txHash: "direct", toAddress: bridge, amountRaw: "100000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({ id: "chunk-1", txHash: "chunk-1", toAddress: hop, amountRaw: "50000000", timestamp: new Date("2026-05-05T10:10:00.000Z") }),
        edge({ id: "chunk-2", txHash: "chunk-2", toAddress: hop, amountRaw: "50000000", timestamp: new Date("2026-05-05T10:20:00.000Z") }),
        edge({
          id: "lp-exit",
          txHash: "lp-exit",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "100000000",
          timestamp: new Date("2026-05-05T10:40:00.000Z")
        })
      ],
      classifications: new Map([
        [bridge, { category: "bridge", identity: "Allbridge Bridge", confidence: "high", evidence: [], isBoundary: true }],
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [allbridgeLp, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.directServiceVolumeRatio).toBe(0.5);
    expect(profile.mergedServiceVolumeRatio).toBe(0.5);
    expect(profile.combinedServiceVolumeRatio).toBe(1);
    expect(profile.combinedServiceTxRatio).toBe(1);
  });

  it("rejects merged exits before the first source transfer, outside lookahead, or below preservation", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "before-1", txHash: "before-1", toAddress: "TBeforeHop111111111111111111111111", amountRaw: "50000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({ id: "before-2", txHash: "before-2", toAddress: "TBeforeHop111111111111111111111111", amountRaw: "50000000", timestamp: new Date("2026-05-05T10:30:00.000Z") }),
        edge({
          id: "before-exit",
          txHash: "before-exit",
          fromAddress: "TBeforeHop111111111111111111111111",
          toAddress: allbridgeLp,
          amountRaw: "100000000",
          timestamp: new Date("2026-05-05T09:59:00.000Z")
        }),
        edge({ id: "late-1", txHash: "late-1", toAddress: "TLateHop11111111111111111111111111", amountRaw: "50000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({ id: "late-2", txHash: "late-2", toAddress: "TLateHop11111111111111111111111111", amountRaw: "50000000", timestamp: new Date("2026-05-05T10:30:00.000Z") }),
        edge({
          id: "late-exit",
          txHash: "late-exit",
          fromAddress: "TLateHop11111111111111111111111111",
          toAddress: allbridgeLp,
          amountRaw: "100000000",
          timestamp: new Date("2026-05-06T10:31:00.000Z")
        }),
        edge({ id: "low-1", txHash: "low-1", toAddress: "TLowHop111111111111111111111111111", amountRaw: "50000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({ id: "low-2", txHash: "low-2", toAddress: "TLowHop111111111111111111111111111", amountRaw: "50000000", timestamp: new Date("2026-05-05T10:30:00.000Z") }),
        edge({
          id: "low-exit",
          txHash: "low-exit",
          fromAddress: "TLowHop111111111111111111111111111",
          toAddress: allbridgeLp,
          amountRaw: "30000000",
          timestamp: new Date("2026-05-05T11:00:00.000Z")
        })
      ],
      classifications: new Map([
        ["TBeforeHop111111111111111111111111", { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        ["TLateHop11111111111111111111111111", { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        ["TLowHop111111111111111111111111111", { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [allbridgeLp, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.mergedServiceVolumeRatio).toBe(0);
    expect(profile.mergedServiceGroupCount).toBe(0);
    expect(profile.topMergedServiceFlows).toEqual([]);
    expect(profile.combinedServiceVolumeRatio).toBe(0);
  });

  it("rejects merged exits that happen before the last source chunk arrives", () => {
    const profile = buildServiceExposureProfile({
      subjectAddress: source,
      edges: [
        edge({ id: "chunk-1", txHash: "chunk-1", toAddress: hop, amountRaw: "50000000", timestamp: new Date("2026-05-05T10:00:00.000Z") }),
        edge({ id: "chunk-2", txHash: "chunk-2", toAddress: hop, amountRaw: "50000000", timestamp: new Date("2026-05-05T11:00:00.000Z") }),
        edge({
          id: "premature-exit",
          txHash: "premature-exit",
          fromAddress: hop,
          toAddress: allbridgeLp,
          amountRaw: "100000000",
          timestamp: new Date("2026-05-05T10:30:00.000Z")
        })
      ],
      classifications: new Map([
        [hop, { category: "none", identity: null, confidence: "low", evidence: [], isBoundary: false }],
        [allbridgeLp, { category: "bridge_pool", identity: "Allbridge LP", confidence: "high", evidence: [], isBoundary: true }]
      ])
    });

    expect(profile.mergedServiceVolumeRatio).toBe(0);
    expect(profile.mergedServiceGroupCount).toBe(0);
    expect(profile.fastestServiceExitMs).toBeNull();
  });

});
