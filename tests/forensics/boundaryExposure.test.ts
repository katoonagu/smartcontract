import { describe, expect, it } from "vitest";
import { buildBoundaryExposureProfile } from "../../src/forensics/boundaryExposure";
import type { ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const intermediate = "TInter111111111111111111111111111111";
const cex = "THTX11111111111111111111111111111111";

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

const htx: ServiceClassification = {
  category: "cex",
  identity: "HTX",
  confidence: "high",
  evidence: ["metadata_exchange_tag"],
  isBoundary: true
};

describe("buildBoundaryExposureProfile", () => {
  it("records direct outbound service boundary context", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [edge("direct", subject, cex, "100000000", "2026-05-25T10:00:00.000Z")],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.outgoingBoundaryVolumeRaw).toBe("100000000");
    expect(profile.directBoundaryTxCount).toBe(1);
    expect(profile.contextScore).toBe(15);
    expect(profile.topBoundaryEntities[0]).toMatchObject({ address: cex, category: "cex", identity: "HTX", direction: "outbound" });
    expect(profile.features.map((feature) => feature.code)).toContain("boundary_exposure_direct_service");
  });

  it("records two-hop outbound boundary context with amount preservation", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [
        edge("source", subject, intermediate, "100000000", "2026-05-25T10:00:00.000Z"),
        edge("boundary", intermediate, cex, "95000000", "2026-05-25T10:15:00.000Z")
      ],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.twoHopBoundaryTxCount).toBe(1);
    expect(profile.flows[0]).toMatchObject({
      direction: "outbound",
      depth: 2,
      boundaryAddress: cex,
      viaAddress: intermediate,
      amountPreservationRatio: 0.95
    });
    expect(profile.features.map((feature) => feature.code)).toContain("boundary_exposure_two_hop_service");
  });

  it("records direct inbound service boundary context", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [edge("inbound", cex, subject, "50000000", "2026-05-25T09:00:00.000Z")],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.incomingBoundaryVolumeRaw).toBe("50000000");
    expect(profile.incomingBoundaryVolumeRatio).toBe(1);
    expect(profile.flows[0]).toMatchObject({
      direction: "inbound",
      depth: 1,
      boundaryAddress: cex,
      viaAddress: null,
      subjectTxHash: "inbound-tx",
      boundaryTxHash: "inbound-tx",
      amountPreservationRatio: 1
    });
  });

  it("does not classify the subject itself as a two-hop boundary", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [
        edge("out", subject, intermediate, "100000000", "2026-05-25T10:00:00.000Z"),
        edge("back", intermediate, subject, "100000000", "2026-05-25T10:15:00.000Z")
      ],
      classifications: new Map([[subject, htx]])
    });

    expect(profile.flows).toEqual([]);
    expect(profile.contextScore).toBe(0);
  });

  it("does not treat boundary context as exact taint proof", () => {
    const profile = buildBoundaryExposureProfile({
      subjectAddress: subject,
      edges: [edge("direct", subject, cex, "1000000000", "2026-05-25T10:00:00.000Z")],
      classifications: new Map([[cex, htx]])
    });

    expect(profile.contextScore).toBeLessThanOrEqual(15);
    expect(profile.features.map((feature) => feature.code)).toContain("boundary_exposure_continuity_stop");
  });
});
