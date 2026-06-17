import { describe, expect, it } from "vitest";
import { runTemporalBeamSearch } from "../../src/forensics/temporalBeamSearch";
import type { AddressLabel, ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const hop1 = "THop11111111111111111111111111111111";
const hop2 = "THop22222222222222222222222222222222";
const hop3 = "THop33333333333333333333333333333333";
const seed = "TSeed1111111111111111111111111111111";
const cex = "TCex11111111111111111111111111111111";

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

function label(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange" as any,
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function service(category: ServiceClassification["category"]): ServiceClassification {
  return {
    category,
    identity: category,
    confidence: "high",
    evidence: [`tag:${category}`],
    isBoundary: category !== "none"
  };
}

describe("temporal beam search", () => {
  it("finds a preserved 4-hop inbound path from a critical label", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-hop1-subject", hop1, subject, "97000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop2-hop1", hop2, hop1, "98000000000", "2026-05-20T09:55:00.000Z")]],
      [hop2, [edge("tx-hop3-hop2", hop3, hop2, "99000000000", "2026-05-20T09:50:00.000Z")]],
      [hop3, [edge("tx-seed-hop3", seed, hop3, "100000000000", "2026-05-20T09:45:00.000Z")]]
    ]);

    const profile = await runTemporalBeamSearch({
      subjectAddress: subject,
      direction: "inbound",
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address) => address === seed ? [label(address)] : []
    });

    expect(profile.score).toBe(35);
    expect(profile.paths[0]).toMatchObject({
      depth: 4,
      label: "darknet_exchange",
      evidenceStrength: "exact_labeled_path",
      candidateScore: 35,
      pathAddresses: [subject, hop1, hop2, hop3, seed]
    });
    expect(profile.features.map((feature) => feature.code)).toContain("extended_3_4_hop_labeled_provenance");
  });

  it("rejects invalid temporal order", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-hop-subject", hop1, subject, "95000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-seed-hop-late", seed, hop1, "100000000000", "2026-05-20T10:01:00.000Z")]]
    ]);

    const profile = await runTemporalBeamSearch({
      subjectAddress: subject,
      direction: "inbound",
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      maxDepth: 2,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address) => address === seed ? [label(address)] : []
    });

    expect(profile.score).toBe(0);
    expect(profile.paths.some((path) => path.label === "darknet_exchange")).toBe(false);
  });

  it("stops at service boundaries without continuing proof", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-cex-subject", cex, subject, "100000000000", "2026-05-20T10:00:00.000Z")]],
      [cex, [edge("tx-seed-cex", seed, cex, "100000000000", "2026-05-20T09:00:00.000Z")]]
    ]);

    const profile = await runTemporalBeamSearch({
      subjectAddress: subject,
      direction: "inbound",
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      maxDepth: 3,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address) => address === seed ? [label(address)] : [],
      getClassificationForAddress: async (address) => address === cex ? service("cex") : null
    });

    expect(profile.score).toBe(0);
    expect(profile.paths[0]).toMatchObject({
      depth: 1,
      boundaryCategory: "cex",
      evidenceStrength: "service_boundary_context"
    });
    expect(profile.coverage.stoppedReasons[0]).toContain("service boundary");
  });

  it("caps 3-hop exact labeled path risk impact at 45", async () => {
    const dirty = "TDirty333333333333333333333333333333";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-subject-hop1", subject, hop1, "100000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop1-hop2", hop1, hop2, "99000000000", "2026-05-20T10:05:00.000Z")]],
      [hop2, [edge("tx-hop2-dirty", hop2, dirty, "98000000000", "2026-05-20T10:10:00.000Z")]]
    ]);

    const profile = await runTemporalBeamSearch({
      subjectAddress: subject,
      direction: "outbound",
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address) => address === dirty ? [label(address)] : [],
      getClassificationForAddress: async () => null
    });

    const exact = profile.paths.find((path) => path.depth === 3 && path.evidenceStrength === "exact_labeled_path");
    expect(exact?.candidateScore).toBeLessThanOrEqual(45);
    expect(profile.score).toBeLessThanOrEqual(45);
  });

  it("caps 4-hop exact labeled path risk impact at 35", async () => {
    const dirty = "TDirty444444444444444444444444444444";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-subject-hop1", subject, hop1, "100000000000", "2026-05-20T10:00:00.000Z")]],
      [hop1, [edge("tx-hop1-hop2", hop1, hop2, "99000000000", "2026-05-20T10:05:00.000Z")]],
      [hop2, [edge("tx-hop2-hop3", hop2, hop3, "98000000000", "2026-05-20T10:10:00.000Z")]],
      [hop3, [edge("tx-hop3-dirty", hop3, dirty, "97000000000", "2026-05-20T10:15:00.000Z")]]
    ]);

    const profile = await runTemporalBeamSearch({
      subjectAddress: subject,
      direction: "outbound",
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address) => address === dirty ? [label(address)] : [],
      getClassificationForAddress: async () => null
    });

    const exact = profile.paths.find((path) => path.depth === 4 && path.evidenceStrength === "exact_labeled_path");
    expect(exact?.candidateScore).toBeLessThanOrEqual(35);
    expect(profile.score).toBeLessThanOrEqual(35);
  });

  it("keeps service-boundary context at or below 15", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-subject-cex", subject, cex, "100000000000", "2026-05-20T10:00:00.000Z")]]
    ]);

    const profile = await runTemporalBeamSearch({
      subjectAddress: subject,
      direction: "outbound",
      windowStart: new Date("2026-05-20T00:00:00.000Z"),
      windowEnd: new Date("2026-05-21T00:00:00.000Z"),
      maxDepth: 4,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === cex ? service("cex") : null
    });

    const boundary = profile.paths.find((path) => path.evidenceStrength === "service_boundary_context");
    expect(boundary?.candidateScore).toBeLessThanOrEqual(15);
    expect(profile.score).toBe(0);
  });
});
