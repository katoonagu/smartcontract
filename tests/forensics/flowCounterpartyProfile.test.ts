import { describe, expect, it } from "vitest";
import { boundaryProfilesToOperationalEdges, buildOperationalFlowProfile } from "../../src/forensics/flowCounterpartyProfile";
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
