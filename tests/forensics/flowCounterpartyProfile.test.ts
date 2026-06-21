import { describe, expect, it } from "vitest";
import {
  boundaryProfilesToOperationalEdges,
  buildFastCounterpartyTopsProfile,
  buildOperationalFlowProfile
} from "../../src/forensics/flowCounterpartyProfile";
import type { BoundaryExposureProfile, ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const htx = "THTX11111111111111111111111111111111";
const bridge = "TBridge111111111111111111111111111111";
const dex = "TDex11111111111111111111111111111111";
const normal = "TNormal11111111111111111111111111111";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    fromAddress,
    toAddress,
    txHash: `${id}-tx`,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function service(category: ServiceClassification["category"], identity: string): ServiceClassification {
  return { category, identity, confidence: "high", evidence: [`tag:${identity}`], isBoundary: category !== "none" };
}

describe("buildOperationalFlowProfile", () => {
  it("summarizes top 30-day counterparties and terminal liquidity shares", () => {
    const profile = buildOperationalFlowProfile({
      subjectAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T23:59:59.999Z"),
      edges: [
        edge("in-1", normal, subject, "100000000000", "2026-05-10T10:00:00.000Z"),
        edge("out-htx", subject, htx, "40000000000", "2026-05-10T10:05:00.000Z"),
        edge("out-bridge", subject, bridge, "35000000000", "2026-05-10T10:10:00.000Z"),
        edge("out-dex", subject, dex, "15000000000", "2026-05-10T10:15:00.000Z"),
        edge("out-normal", subject, normal, "10000000000", "2026-05-10T10:20:00.000Z")
      ],
      classifications: new Map([
        [htx, service("cex", "HTX")],
        [bridge, service("bridge", "Allbridge")],
        [dex, service("dex", "SunSwap")],
        [normal, service("none", "normal wallet")]
      ])
    });

    expect(profile.incomingVolumeRaw).toBe("100000000000");
    expect(profile.outgoingVolumeRaw).toBe("100000000000");
    expect(profile.inflowToOutflowRatio).toBe(1);
    expect(profile.htxHuobiOutgoingRatio).toBe(0.4);
    expect(profile.terminalLiquidityOutgoingRatio).toBe(0.9);
    expect(profile.bridgeDexRouterOutgoingRatio).toBe(0.5);
    expect(profile.topOutgoingCounterparties[0]).toMatchObject({ address: htx, identity: "HTX", isHtxHuobi: true, volumeRatio: 0.4 });
    expect(profile.features.map((feature) => feature.code)).toEqual(expect.arrayContaining([
      "operational_flow_high_terminal_liquidity_outgoing",
      "operational_flow_htx_huobi_outgoing",
      "operational_flow_bridge_dex_router_outgoing"
    ]));
    expect(profile.operationalScore).toBeGreaterThanOrEqual(60);
    expect(profile.historicalTransitScore).toBeGreaterThanOrEqual(80);
    expect(profile.historicalTransitBreakdown).toMatchObject({
      eligible: true,
      passThrough: 1,
      serviceShare: 0.5,
      score: profile.historicalTransitScore
    });
  });

  it("can score multi-hop boundary flows as terminal liquidity context", () => {
    const boundaryProfile: BoundaryExposureProfile = {
      subjectAddress: subject,
      incomingBoundaryVolumeRaw: "0",
      outgoingBoundaryVolumeRaw: "95000000000",
      incomingBoundaryVolumeRatio: 0,
      outgoingBoundaryVolumeRatio: 0.95,
      directBoundaryTxCount: 0,
      twoHopBoundaryTxCount: 1,
      topBoundaryEntities: [],
      categoryBreakdown: [],
      flows: [{
        direction: "outbound",
        depth: 2,
        boundaryAddress: htx,
        boundaryCategory: "cex",
        boundaryIdentity: "HTX",
        viaAddress: normal,
        viaAddresses: [normal],
        subjectTxHash: "tx-subject-normal",
        boundaryTxHash: "tx-normal-htx",
        amountRaw: "95000000000",
        boundaryAmountRaw: "95000000000",
        amountPreservationRatio: 0.95,
        firstTransferAt: "2026-05-10T10:00:00.000Z",
        lastTransferAt: "2026-05-10T10:10:00.000Z"
      }],
      contextScore: 45,
      features: []
    };

    const profile = buildOperationalFlowProfile({
      subjectAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T23:59:59.999Z"),
      edges: [
        edge("in-1", normal, subject, "100000000000", "2026-05-10T09:55:00.000Z"),
        ...boundaryProfilesToOperationalEdges({ subjectAddress: subject, profiles: [boundaryProfile] })
      ],
      classifications: new Map([
        [htx, service("cex", "HTX")],
        [normal, service("none", "normal wallet")]
      ])
    });

    expect(profile.outgoingVolumeRaw).toBe("95000000000");
    expect(profile.terminalLiquidityOutgoingRatio).toBe(1);
    expect(profile.htxHuobiOutgoingRatio).toBeGreaterThan(0);
    expect(profile.features.map((feature) => feature.code)).toContain("operational_flow_htx_huobi_outgoing");
  });
});

describe("buildFastCounterpartyTopsProfile", () => {
  it("summarizes direct incoming, outgoing, and service counterparties for fast checks", () => {
    const profile = buildFastCounterpartyTopsProfile({
      subjectAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T23:59:59.999Z"),
      edges: [
        edge("old-in", normal, subject, "999000000000", "2026-04-30T23:59:59.999Z"),
        edge("in-2", normal, subject, "70000000", "2026-05-10T10:01:00.000Z"),
        edge("in-1", normal, subject, "30000000", "2026-05-10T10:00:00.000Z"),
        edge("out-1", subject, bridge, "60000000", "2026-05-10T10:02:00.000Z"),
        edge("out-2", subject, dex, "25000000", "2026-05-10T10:03:00.000Z"),
        edge("out-3", subject, dex, "15000000", "2026-05-10T10:04:00.000Z"),
        edge("out-4", subject, dex, "5000000", "2026-05-10T10:05:00.000Z"),
        edge("out-5", subject, dex, "4000000", "2026-05-10T10:06:00.000Z"),
        edge("out-6", subject, dex, "3000000", "2026-05-10T10:07:00.000Z"),
        edge("out-7", subject, dex, "2000000", "2026-05-10T10:08:00.000Z"),
        edge("out-normal", subject, normal, "10000000", "2026-05-10T10:09:00.000Z")
      ],
      classifications: new Map([
        [bridge, service("bridge", "Allbridge")],
        [dex, service("dex", "SunSwap")],
        [normal, service("none", "normal wallet")]
      ]),
      deepPriorityAddresses: new Set([dex])
    });

    expect(profile).toMatchObject({
      subjectAddress: subject,
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-05-31T23:59:59.999Z",
      incomingVolumeRaw: "100000000",
      outgoingVolumeRaw: "124000000",
      incomingTxCount: 2,
      outgoingTxCount: 8
    });
    expect(profile.topIncomingCounterparties).toEqual([
      expect.objectContaining({
        address: normal,
        direction: "incoming",
        volumeRaw: "100000000",
        txCount: 2,
        volumeRatio: 1,
        firstSeen: "2026-05-10T10:00:00.000Z",
        lastSeen: "2026-05-10T10:01:00.000Z",
        sampleTxHashes: ["in-1-tx", "in-2-tx"],
        selectedAsDeepPriorityHint: false
      })
    ]);
    expect(profile.topOutgoingCounterparties.map((row) => row.address)).toEqual([bridge, dex, normal]);
    expect(profile.topServiceCounterparties).toEqual([
      expect.objectContaining({
        address: bridge,
        direction: "service",
        category: "bridge",
        identity: "Allbridge",
        volumeRaw: "60000000",
        sampleTxHashes: ["out-1-tx"],
        selectedAsDeepPriorityHint: false
      }),
      expect.objectContaining({
        address: dex,
        direction: "service",
        category: "dex",
        identity: "SunSwap",
        volumeRaw: "54000000",
        txCount: 6,
        sampleTxHashes: ["out-2-tx", "out-3-tx", "out-4-tx", "out-5-tx", "out-6-tx"],
        selectedAsDeepPriorityHint: true
      })
    ]);
    expect(profile.categoryBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "outgoing", category: "bridge", volumeRaw: "60000000" }),
      expect.objectContaining({ direction: "outgoing", category: "dex", volumeRaw: "54000000" })
    ]));
  });

  it("keeps service tops and category breakdown independent from the outgoing top-10 slice", () => {
    const nonServiceEdges = Array.from({ length: 10 }, (_, index) =>
      edge(
        `out-normal-${index}`,
        subject,
        `TNormalTop${index}11111111111111111111111`,
        String(100_000_000 - index),
        `2026-05-10T10:${String(index).padStart(2, "0")}:00.000Z`
      )
    );

    const profile = buildFastCounterpartyTopsProfile({
      subjectAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T23:59:59.999Z"),
      edges: [
        ...nonServiceEdges,
        edge("out-small-bridge", subject, bridge, "1", "2026-05-10T10:30:00.000Z")
      ],
      classifications: new Map([
        [bridge, service("bridge", "Allbridge")]
      ])
    });

    expect(profile.topOutgoingCounterparties.map((row) => row.address)).not.toContain(bridge);
    expect(profile.topServiceCounterparties).toEqual([
      expect.objectContaining({ address: bridge, direction: "service", category: "bridge", volumeRaw: "1" })
    ]);
    expect(profile.categoryBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "outgoing", category: "bridge", volumeRaw: "1" })
    ]));
  });
});
