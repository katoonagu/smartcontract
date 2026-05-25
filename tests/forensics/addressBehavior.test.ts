import { describe, expect, it } from "vitest";
import { buildAddressBehaviorProfile } from "../../src/forensics/addressBehavior";
import type { ForensicRouteEdge, ServiceClassification, ServiceExposureProfile } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const sourceA = "TSourceA11111111111111111111111111111";
const service = "TService11111111111111111111111111111";

function edge(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
}): ForensicRouteEdge {
  return {
    id: input.id,
    txHash: input.id,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.at),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function exposure(overrides: Partial<ServiceExposureProfile> = {}): ServiceExposureProfile {
  return {
    subjectAddress: subject,
    totalOutgoingRaw: "950000000000",
    totalOutgoingCount: 2,
    directServiceVolumeRatio: 1,
    directServiceTxRatio: 1,
    indirectServiceVolumeRatio: 0,
    indirectServiceTxRatio: 0,
    mergedServiceVolumeRatio: 0,
    mergedServiceGroupCount: 0,
    combinedServiceVolumeRatio: 1,
    combinedServiceTxRatio: 1,
    dominantCategory: "bridge",
    categoryBreakdown: [],
    topServiceCounterparties: [],
    topMergedServiceFlows: [],
    fastestServiceExitMs: 15 * 60 * 1000,
    bestAmountPreservationRatio: 1,
    exposureScore: 75,
    features: [],
    ...overrides
  };
}

function classification(category: ServiceClassification["category"]): ServiceClassification {
  return {
    category,
    identity: category,
    confidence: "high",
    evidence: [`tag:${category}`],
    isBoundary: category !== "none"
  };
}

describe("address behavior profile", () => {
  it("scores large deposit then rapid preserved service drain", () => {
    const profile = buildAddressBehaviorProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "in-large", from: sourceA, to: subject, amountRaw: "1000000000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "out-service-1", from: subject, to: service, amountRaw: "600000000000", at: "2026-05-20T10:12:00.000Z" }),
        edge({ id: "out-service-2", from: subject, to: service, amountRaw: "350000000000", at: "2026-05-20T10:20:00.000Z" })
      ],
      serviceExposureProfile: exposure()
    });

    expect(profile.incomingVolumeRaw).toBe("1000000000000");
    expect(profile.outgoingVolumeRaw).toBe("950000000000");
    expect(profile.inflowToOutflowRatio).toBeCloseTo(0.95);
    expect(profile.drainToServiceRatio).toBeCloseTo(0.95);
    expect(profile.timeToFirstOutgoingMs).toBe(12 * 60 * 1000);
    expect(profile.timeToFirstServiceExitMs).toBe(27 * 60 * 1000);
    expect(profile.depositThenDrainScore).toBeGreaterThan(0);
    expect(profile.features.map((feature) => feature.code)).toEqual(
      expect.arrayContaining([
        "address_behavior_deposit_then_drain",
        "address_behavior_large_inflow_preserved_outflow",
        "address_behavior_fast_post_deposit_exit",
        "address_behavior_drain_to_service_infrastructure"
      ])
    );
  });

  it("does not score deposit drain when outgoing transfer predates the incoming transfer", () => {
    const profile = buildAddressBehaviorProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "out-before", from: subject, to: service, amountRaw: "950000000000", at: "2026-05-20T09:00:00.000Z" }),
        edge({ id: "in-after", from: sourceA, to: subject, amountRaw: "1000000000000", at: "2026-05-20T10:00:00.000Z" })
      ],
      serviceExposureProfile: exposure()
    });

    expect(profile.timeToFirstOutgoingMs).toBeNull();
    expect(profile.depositThenDrainScore).toBe(0);
    expect(profile.features.map((feature) => feature.code)).not.toContain("address_behavior_deposit_then_drain");
  });

  it("scores transit-like fan-in/fan-out without claiming service exposure", () => {
    const profile = buildAddressBehaviorProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "in-1", from: "TA", to: subject, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "in-2", from: "TB", to: subject, amountRaw: "90000000000", at: "2026-05-20T10:05:00.000Z" }),
        edge({ id: "in-3", from: "TC", to: subject, amountRaw: "80000000000", at: "2026-05-20T10:10:00.000Z" }),
        edge({ id: "in-4", from: "TD", to: subject, amountRaw: "70000000000", at: "2026-05-20T10:15:00.000Z" }),
        edge({ id: "in-5", from: "TE", to: subject, amountRaw: "60000000000", at: "2026-05-20T10:20:00.000Z" }),
        edge({ id: "out-1", from: subject, to: "TX", amountRaw: "180000000000", at: "2026-05-20T10:30:00.000Z" }),
        edge({ id: "out-2", from: subject, to: "TY", amountRaw: "90000000000", at: "2026-05-20T10:35:00.000Z" }),
        edge({ id: "out-3", from: subject, to: "TZ", amountRaw: "80000000000", at: "2026-05-20T10:40:00.000Z" }),
        edge({ id: "out-4", from: subject, to: "TU", amountRaw: "30000000000", at: "2026-05-20T10:45:00.000Z" }),
        edge({ id: "out-5", from: subject, to: "TV", amountRaw: "20000000000", at: "2026-05-20T10:50:00.000Z" })
      ]
    });

    expect(profile.transitScore).toBeGreaterThan(0);
    expect(profile.drainToServiceRatio).toBe(0);
    expect(profile.features.map((feature) => feature.code)).toEqual(
      expect.arrayContaining([
        "address_behavior_high_volume_transit",
        "address_behavior_fan_in_fan_out",
        "address_behavior_large_outgoing_concentration",
        "address_behavior_collector_like_wallet"
      ])
    );
  });

  it("reports top outgoing counterparty concentration across repeated exits", () => {
    const profile = buildAddressBehaviorProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "in-1", from: "TA", to: subject, amountRaw: "301500000000", at: "2026-05-08T12:35:51.000Z" }),
        edge({ id: "in-2", from: "TB", to: subject, amountRaw: "371522200000", at: "2026-05-08T12:40:00.000Z" }),
        edge({ id: "out-top-1", from: subject, to: "TWxTop", amountRaw: "500000000000", at: "2026-05-08T13:00:00.000Z" }),
        edge({ id: "out-top-2", from: subject, to: "TWxTop", amountRaw: "300600000000", at: "2026-05-08T13:54:57.000Z" }),
        edge({ id: "out-other-1", from: subject, to: "TOther1", amountRaw: "200000000000", at: "2026-05-08T14:00:00.000Z" }),
        edge({ id: "out-other-2", from: subject, to: "TOther2", amountRaw: "329277820000", at: "2026-05-08T14:05:00.000Z" })
      ]
    });

    expect(profile.topOutgoingCounterpartyAddress).toBe("TWxTop");
    expect(profile.topOutgoingCounterpartyRaw).toBe("800600000000");
    expect(profile.topOutgoingCounterpartyTxCount).toBe(2);
    expect(profile.topOutgoingCounterpartyRatio).toBeCloseTo(0.602, 3);
    expect(profile.features.map((feature) => feature.code)).toContain("address_behavior_top_counterparty_concentration");
  });

  it("dampens behavior for known service-like subject addresses", () => {
    const profile = buildAddressBehaviorProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "in-large", from: sourceA, to: subject, amountRaw: "1000000000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "out-service", from: subject, to: service, amountRaw: "950000000000", at: "2026-05-20T10:12:00.000Z" })
      ],
      serviceExposureProfile: exposure(),
      subjectClassification: classification("cex")
    });

    expect(profile.depositThenDrainScore).toBeGreaterThan(0);
    expect(profile.dampenerScore).toBeGreaterThan(0);
    expect(profile.features.map((feature) => feature.code)).toContain("known_service_or_treasury_dampener");
  });
});
