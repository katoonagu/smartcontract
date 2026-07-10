import { describe, expect, it } from "vitest";
import { buildInboundProvenanceProfile } from "../../src/forensics/inboundProvenance";
import type { AddressLabel, ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const transit = "TTransit111111111111111111111111111111";
const risky = "TRisky1111111111111111111111111111111";
const cex = "TCex11111111111111111111111111111111";

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

function label(address: string, riskLabel: AddressLabel["label"]): AddressLabel {
  return {
    address,
    label: riskLabel,
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
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

describe("inbound provenance", () => {
  it("scores direct incoming funds from a critical labeled source", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "risky-direct", from: risky, to: subject, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "stolen_funds")]]])
    });

    expect(profile.score).toBe(40);
    expect(profile.paths[0]).toMatchObject({ depth: 1, sourceAddress: risky, label: "stolen_funds" });
    expect(profile.features.map((feature) => feature.code)).toContain("inbound_provenance_direct_labeled_source");
  });

  it("scores direct incoming funds from a confirmed darknet exchange seed at maximum graph impact", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "dark-direct", from: risky, to: subject, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "darknet_exchange" as any)]]]),
      classifications: new Map([[risky, classification("cex")]])
    });

    expect(profile.score).toBe(50);
    expect(profile.paths[0]).toMatchObject({ depth: 1, sourceAddress: risky, label: "darknet_exchange" });
    expect(profile.features.map((feature) => feature.code)).toContain("inbound_provenance_darknet_exchange_direct");
  });

  it("scores two-hop provenance when amount and time are preserved", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "risky-to-transit", from: risky, to: transit, amountRaw: "100000000000", at: "2026-05-20T09:55:00.000Z" }),
        edge({ id: "transit-to-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "phishing")]]])
    });

    expect(profile.score).toBeGreaterThanOrEqual(30);
    expect(profile.paths[0]).toMatchObject({
      depth: 2,
      sourceAddress: risky,
      viaAddresses: [transit],
      amountPreservationRatio: 0.95
    });
    expect(profile.features.map((feature) => feature.code)).toEqual(
      expect.arrayContaining([
        "inbound_provenance_two_hop_labeled_source",
        "inbound_provenance_amount_preserved"
      ])
    );
  });

  it("scores two-hop provenance from a confirmed darknet exchange seed above generic provenance", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "dark-to-transit", from: risky, to: transit, amountRaw: "100000000000", at: "2026-05-20T09:55:00.000Z" }),
        edge({ id: "transit-to-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "darknet_exchange" as any)]]])
    });

    expect(profile.score).toBe(45);
    expect(profile.paths[0]).toMatchObject({
      depth: 2,
      sourceAddress: risky,
      label: "darknet_exchange",
      viaAddresses: [transit],
      amountPreservationRatio: 0.95
    });
    expect(profile.features.map((feature) => feature.code)).toEqual(
      expect.arrayContaining([
        "inbound_provenance_darknet_exchange_two_hop",
        "inbound_provenance_darknet_exchange_amount_preserved"
      ])
    );
  });

  it("rejects two-hop provenance when upstream transfer happens after downstream transfer", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "transit-to-subject", from: transit, to: subject, amountRaw: "95000000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "risky-to-transit-late", from: risky, to: transit, amountRaw: "100000000000", at: "2026-05-20T10:01:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "phishing")]]])
    });

    expect(profile.score).toBe(0);
    expect(profile.paths).toEqual([]);
  });

  it("rejects two-hop provenance below the preservation threshold", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "risky-to-transit", from: risky, to: transit, amountRaw: "100000000000", at: "2026-05-20T09:55:00.000Z" }),
        edge({ id: "transit-to-subject-low", from: transit, to: subject, amountRaw: "50000000000", at: "2026-05-20T10:00:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "phishing")]]])
    });

    expect(profile.score).toBe(0);
    expect(profile.features.map((feature) => feature.code)).not.toContain("inbound_provenance_two_hop_labeled_source");
  });

  it("stops at service boundaries without treating exchange context as proof", () => {
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [
        edge({ id: "cex-to-subject", from: cex, to: subject, amountRaw: "100000000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "risky-to-cex", from: risky, to: cex, amountRaw: "100000000000", at: "2026-05-20T09:00:00.000Z" })
      ],
      labelsByAddress: new Map([[risky, [label(risky, "scam")]]]),
      classifications: new Map([[cex, classification("cex")]])
    });

    expect(profile.score).toBe(0);
    expect(profile.boundaryNotes[0]).toContain("service/CEX/bridge boundary");
    expect(profile.features.map((feature) => feature.code)).toContain("inbound_provenance_service_boundary");
  });

  it("excludes exact GasFree fees from provenance while retaining principal and gross volume", () => {
    const principalSource = "TPrincipalSource11111111111111111111";
    const fee = {
      ...edge({ id: "gasfree-fee", from: risky, to: subject, amountRaw: "3000000", at: "2026-05-20T09:59:00.000Z" }),
      economicRole: "service_fee" as const,
      economicProtocol: "tron_gasfree" as const
    };
    const principal = {
      ...edge({ id: "gasfree-principal", from: principalSource, to: subject, amountRaw: "97000000", at: "2026-05-20T10:00:00.000Z" }),
      economicRole: "principal" as const,
      economicProtocol: "tron_gasfree" as const
    };
    const profile = buildInboundProvenanceProfile({
      subjectAddress: subject,
      edges: [fee, principal],
      labelsByAddress: new Map([
        [risky, [label(risky, "phishing")]],
        [principalSource, [label(principalSource, "phishing")]]
      ])
    });

    expect(profile.incomingVolumeRaw).toBe("100000000");
    expect(profile.matchedInboundVolumeRaw).toBe("97000000");
    expect(profile.paths.every((path) => !path.txHashes.includes("gasfree-fee"))).toBe(true);
    expect(profile.paths.some((path) => path.txHashes.includes("gasfree-principal"))).toBe(true);
  });
});
