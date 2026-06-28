import { describe, expect, it } from "vitest";
import {
  buildDirectCounterpartyInteractionProfiles,
  selectCounterpartiesForFastSnapshot
} from "../../src/forensics/counterpartyInteraction";
import type {
  CounterpartyRiskSnapshot,
  ForensicRouteEdge,
  ServiceClassification
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const highRisk = "THighRisk111111111111111111111111111";
const lowerShare = "TLowerShare11111111111111111111111111";
const service = "TService11111111111111111111111111111";
const partial = "TPartial11111111111111111111111111111";
const normal = "TNormal111111111111111111111111111111";

function edge(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at?: string;
}): ForensicRouteEdge {
  return {
    id: input.id,
    txHash: input.id,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.at ?? "2026-05-20T10:00:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function snapshot(address: string, overrides: Partial<CounterpartyRiskSnapshot> = {}): CounterpartyRiskSnapshot {
  return {
    address,
    riskScore: 80,
    riskLevel: "HIGH",
    source: "fast_address_check",
    evidenceClass: "counterparty_behavior_context",
    reasons: ["counterparty has high fast forensic risk"],
    partialNotes: [],
    ...overrides
  };
}

function classification(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`name:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

describe("direct counterparty interaction profiles", () => {
  it("allows HIGH context when a high-risk fast snapshot dominates direct volume", () => {
    const profiles = buildDirectCounterpartyInteractionProfiles({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-high-1", from: highRisk, to: subject, amountRaw: "700000000000" }),
        edge({ id: "tx-high-2", from: highRisk, to: subject, amountRaw: "100000000000", at: "2026-05-20T10:02:00.000Z" }),
        edge({ id: "tx-normal", from: normal, to: subject, amountRaw: "200000000000" })
      ],
      snapshotsByAddress: new Map([[highRisk, snapshot(highRisk)]]),
      classifications: new Map()
    });

    const highRiskProfile = profiles.find((profile) => profile.counterpartyAddress === highRisk);
    expect(highRiskProfile).toMatchObject({
      counterpartyAddress: highRisk,
      direction: "inbound",
      volumeRatio: 0.8,
      evidenceClass: "counterparty_behavior_context",
      scoreContribution: 65,
      skippedReason: null,
      snapshot: expect.objectContaining({
        riskScore: 80,
        riskLevel: "HIGH",
        source: "fast_address_check"
      })
    });
  });

  it("stores direct counterparty transfer details for graph expansion", () => {
    const profiles = buildDirectCounterpartyInteractionProfiles({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-high-1", from: highRisk, to: subject, amountRaw: "900000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "tx-high-2", from: highRisk, to: subject, amountRaw: "1100000000", at: "2026-05-20T10:02:00.000Z" })
      ],
      snapshotsByAddress: new Map([[highRisk, snapshot(highRisk)]]),
      classifications: new Map()
    });

    expect(profiles[0]?.transfers).toEqual([
      {
        txHash: "tx-high-1",
        fromAddress: highRisk,
        toAddress: subject,
        amountRaw: "900000000",
        timestamp: "2026-05-20T10:00:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer"
      },
      {
        txHash: "tx-high-2",
        fromAddress: highRisk,
        toAddress: subject,
        amountRaw: "1100000000",
        timestamp: "2026-05-20T10:02:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer"
      }
    ]);
  });

  it("keeps lower-share behavior-risk counterparties below HIGH", () => {
    const profiles = buildDirectCounterpartyInteractionProfiles({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-low-share", from: lowerShare, to: subject, amountRaw: "200000000000" }),
        edge({ id: "tx-normal", from: normal, to: subject, amountRaw: "800000000000" })
      ],
      snapshotsByAddress: new Map([[lowerShare, snapshot(lowerShare)]]),
      classifications: new Map()
    });

    const profile = profiles.find((item) => item.counterpartyAddress === lowerShare);
    expect(profile?.scoreContribution).toBeLessThan(60);
    expect(profile?.evidenceClass).toBe("counterparty_behavior_context");
  });

  it("keeps service-boundary-only context unscored", () => {
    const profiles = buildDirectCounterpartyInteractionProfiles({
      subjectAddress: subject,
      edges: [
        edge({ id: "tx-service", from: subject, to: service, amountRaw: "1000000000000" })
      ],
      snapshotsByAddress: new Map([[service, snapshot(service, {
        riskScore: 25,
        riskLevel: "LOW",
        source: "service_boundary",
        evidenceClass: "service_boundary_context"
      })]]),
      classifications: new Map([[service, classification("router", "MetaRouter")]])
    });

    expect(profiles[0]).toMatchObject({
      counterpartyAddress: service,
      serviceCategory: "router",
      evidenceClass: "service_boundary_context",
      scoreContribution: 0,
      skippedReason: "service_boundary_context"
    });
  });

  it("keeps provider-partial snapshots at zero score", () => {
    const profiles = buildDirectCounterpartyInteractionProfiles({
      subjectAddress: subject,
      edges: [edge({ id: "tx-partial", from: partial, to: subject, amountRaw: "1000000000000" })],
      snapshotsByAddress: new Map([[partial, snapshot(partial, {
        riskScore: 0,
        riskLevel: "LOW",
        source: "fast_address_check",
        evidenceClass: "provider_partial",
        partialNotes: ["provider timed out"]
      })]]),
      classifications: new Map()
    });

    expect(profiles[0]).toMatchObject({
      counterpartyAddress: partial,
      scoreContribution: 0,
      evidenceClass: "provider_partial",
      skippedReason: "provider_partial"
    });
  });

  it("uses precise no-taint wording for normal counterparties", () => {
    const profiles = buildDirectCounterpartyInteractionProfiles({
      subjectAddress: subject,
      edges: [edge({ id: "tx-normal", from: normal, to: subject, amountRaw: "1000000000000" })],
      snapshotsByAddress: new Map(),
      classifications: new Map()
    });

    expect(profiles[0]).toMatchObject({
      counterpartyAddress: normal,
      scoreContribution: 0,
      evidenceClass: "no_exact_label_or_cached_taint",
      skippedReason: "no_exact_label_or_cached_taint"
    });
  });
});

describe("counterparty fast snapshot selection", () => {
  it("selects all sparse-wallet direct counterparties up to cap", () => {
    const selected = selectCounterpartiesForFastSnapshot({
      profiles: Array.from({ length: 5 }, (_, index) => ({
        counterpartyAddress: `TWallet${index}`,
        volumeRaw: `${1000 - index}`,
        volumeRatio: 0.2,
        txCount: 1,
        snapshot: null
      })),
      sparseWallet: true,
      maxSparse: 30,
      maxActive: 3
    });

    expect(selected).toEqual(["TWallet0", "TWallet1", "TWallet2", "TWallet3", "TWallet4"]);
  });

  it("selects dominant active-wallet counterparties without expanding everything", () => {
    const selected = selectCounterpartiesForFastSnapshot({
      profiles: [
        { counterpartyAddress: "TTop", volumeRaw: "800000000000", volumeRatio: 0.8, txCount: 2, snapshot: null },
        { counterpartyAddress: "TManyTx", volumeRaw: "100000000000", volumeRatio: 0.1, txCount: 20, snapshot: null },
        { counterpartyAddress: "TTiny", volumeRaw: "1000000", volumeRatio: 0.001, txCount: 1, snapshot: null },
        { counterpartyAddress: "TRiskyCached", volumeRaw: "1000000000", volumeRatio: 0.001, txCount: 1, snapshot: snapshot("TRiskyCached") }
      ],
      sparseWallet: false,
      maxSparse: 30,
      maxActive: 3
    });

    expect(selected).toEqual(["TTop", "TManyTx", "TRiskyCached"]);
  });

  it("prioritizes hinted counterparties within the active cap", () => {
    const selected = selectCounterpartiesForFastSnapshot({
      profiles: [
        { counterpartyAddress: "TTop", volumeRaw: "800000000000", volumeRatio: 0.8, txCount: 2, snapshot: null },
        { counterpartyAddress: "THinted", volumeRaw: "1000000", volumeRatio: 0.001, txCount: 1, snapshot: null },
        { counterpartyAddress: "TManyTx", volumeRaw: "100000000000", volumeRatio: 0.1, txCount: 20, snapshot: null }
      ],
      sparseWallet: false,
      maxSparse: 30,
      maxActive: 2,
      priorityAddresses: ["THinted"]
    });

    expect(selected).toEqual(["THinted", "TTop"]);
  });

  it("ignores hinted counterparties absent from current profiles", () => {
    const selected = selectCounterpartiesForFastSnapshot({
      profiles: [
        { counterpartyAddress: "TTop", volumeRaw: "800000000000", volumeRatio: 0.8, txCount: 2, snapshot: null },
        { counterpartyAddress: "TManyTx", volumeRaw: "100000000000", volumeRatio: 0.1, txCount: 20, snapshot: null }
      ],
      sparseWallet: false,
      maxSparse: 30,
      maxActive: 1,
      priorityAddresses: ["TMissing"]
    });

    expect(selected).toEqual(["TTop"]);
  });
});
