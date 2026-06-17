import { describe, expect, it } from "vitest";
import { runMultiHopBoundaryExposureSearch } from "../../src/forensics/multiHopBoundaryExposure";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const hop1 = "THop11111111111111111111111111111111";
const hop2 = "THop22222222222222222222222222222222";
const htx = "THTX11111111111111111111111111111111";
const bridge = "TBridge111111111111111111111111111111";

function edge(id: string, from: string, to: string, amountRaw: string, at: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress: from,
    toAddress: to,
    amountRaw,
    timestamp: new Date(at),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function service(category: ServiceClassification["category"], identity: string): ServiceClassification {
  return { category, identity, confidence: "high", evidence: [`tag:${identity}`], isBoundary: category !== "none" };
}

describe("runMultiHopBoundaryExposureSearch", () => {
  it("finds outbound HTX boundary within 3 hops and scores it as operational context", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-subject-hop1", subject, hop1, "100000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop1-hop2", hop1, hop2, "99000000000", "2026-05-20T10:05:00.000Z")]],
      [hop2, [edge("tx-hop2-htx", hop2, htx, "98000000000", "2026-05-20T10:10:00.000Z")]]
    ]);

    const profile = await runMultiHopBoundaryExposureSearch({
      subjectAddress: subject,
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      direction: "outbound",
      maxDepth: 4,
      beamWidth: 8,
      maxAddressFetches: 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getClassificationForAddress: async (address) => address === htx ? service("cex", "HTX") : null
    });

    expect(profile.flows[0]).toMatchObject({
      direction: "outbound",
      depth: 3,
      boundaryAddress: htx,
      boundaryCategory: "cex",
      boundaryIdentity: "HTX",
      viaAddresses: [hop1, hop2],
      amountPreservationRatio: 0.98
    });
    expect(profile.outgoingBoundaryVolumeRatio).toBe(1);
    expect(profile.contextScore).toBeGreaterThanOrEqual(25);
    expect(profile.features.map((feature) => feature.code)).toEqual(expect.arrayContaining([
      "boundary_exposure_multi_hop_service",
      "boundary_exposure_htx_huobi_terminal",
      "boundary_exposure_preserved_amount"
    ]));
  });

  it("finds inbound bridge boundary within 4 hops without crossing the boundary", async () => {
    const hop3 = "THop33333333333333333333333333333333";
    const beforeBridge = "TBeforeBridge111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-hop1-subject", hop1, subject, "97000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop2-hop1", hop2, hop1, "98000000000", "2026-05-20T09:55:00.000Z")]],
      [hop2, [edge("tx-hop3-hop2", hop3, hop2, "99000000000", "2026-05-20T09:50:00.000Z")]],
      [hop3, [edge("tx-bridge-hop3", bridge, hop3, "100000000000", "2026-05-20T09:45:00.000Z")]],
      [bridge, [edge("tx-before-bridge", beforeBridge, bridge, "100000000000", "2026-05-20T09:40:00.000Z")]]
    ]);

    const profile = await runMultiHopBoundaryExposureSearch({
      subjectAddress: subject,
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      direction: "inbound",
      maxDepth: 4,
      beamWidth: 8,
      maxAddressFetches: 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getClassificationForAddress: async (address) => address === bridge ? service("bridge", "Allbridge") : null
    });

    expect(profile.flows[0]).toMatchObject({
      direction: "inbound",
      depth: 4,
      boundaryAddress: bridge,
      boundaryCategory: "bridge",
      viaAddresses: [hop1, hop2, hop3]
    });
    expect(profile.coverage?.stoppedReasons.join(" ")).toContain("service boundary");
    expect(profile.flows.some((flow) => flow.boundaryTxHash === "tx-before-bridge")).toBe(false);
  });

  it("rejects multi-hop boundary paths below the preservation threshold", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-subject-hop1", subject, hop1, "100000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop1-htx-dust", hop1, htx, "10000000", "2026-05-20T10:05:00.000Z")]]
    ]);

    const profile = await runMultiHopBoundaryExposureSearch({
      subjectAddress: subject,
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      direction: "outbound",
      maxDepth: 4,
      beamWidth: 8,
      maxAddressFetches: 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getClassificationForAddress: async (address) => address === htx ? service("cex", "HTX") : null
    });

    expect(profile.flows).toHaveLength(0);
    expect(profile.contextScore).toBe(0);
  });
});
