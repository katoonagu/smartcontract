import { describe, expect, it } from "vitest";
import {
  buildSecondLayerRelationshipProfiles,
  markSecondLayerQueued,
  type IndexedSecondLayerEdge
} from "../../src/forensics/deepSecondLayerRelationship";
import type {
  DeepSecondLayerIndexSummary,
  DirectCounterpartyInteractionProfile,
  ServiceClassification
} from "../../src/types";

const subject = "TSubject111111111111111111111111111";
const walletA = "TWalletA111111111111111111111111111";
const walletB = "TWalletB111111111111111111111111111";
const walletC = "TWalletC111111111111111111111111111";
const gasFree = "TGasFreeHop111111111111111111111111";

function ordinary(address: string, volumeRaw = "1000", txCount = 1): DirectCounterpartyInteractionProfile {
  return {
    subjectAddress: subject,
    direction: "outbound",
    counterpartyAddress: address,
    volumeRaw,
    volumeRatio: 1,
    txCount,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    txHashes: [`tx-${address}`],
    serviceCategory: null,
    identity: null,
    snapshot: {
      address,
      riskScore: 0,
      riskLevel: "LOW",
      source: "none",
      evidenceClass: "counterparty_behavior_context",
      reasons: [],
      partialNotes: []
    },
    interactionWeight: 1,
    scoreContribution: 0,
    evidenceClass: "counterparty_behavior_context",
    skippedReason: null
  };
}

function classification(category: ServiceClassification["category"], isBoundary: boolean): ServiceClassification {
  return { category, identity: category === "none" ? null : "Service", confidence: "high", evidence: [], isBoundary };
}

function completeIndex(address: string, uniqueCounterpartyCount = 2): DeepSecondLayerIndexSummary {
  return {
    address,
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    status: "complete",
    statusReason: "complete_provider_windowed",
    uniqueCounterpartyCount
  };
}

function build(overrides: Partial<Parameters<typeof buildSecondLayerRelationshipProfiles>[0]> = {}) {
  const directCounterpartyProfiles = overrides.directCounterpartyProfiles ?? [ordinary(walletA)];
  return buildSecondLayerRelationshipProfiles({
    subjectAddress: subject,
    directBoundaryAddresses: [],
    directCounterpartyProfiles,
    classifications: new Map(),
    generatedAt: "2026-07-03T00:00:00.000Z",
    getIndexState: (address) => completeIndex(address),
    listIndexedEdges: () => [],
    ...overrides
  });
}

describe("deep second-layer relationship builder", () => {
  it("emits a second-hop path for an indexed ordinary direct wallet", async () => {
    const profile = await build({
      listIndexedEdges: (): IndexedSecondLayerEdge[] => [
        {
          txHash: "tx-a-b",
          fromAddress: walletA,
          toAddress: walletB,
          amountRaw: "123",
          timestamp: "2026-01-02T00:00:00.000Z",
          assetSymbol: "USDT"
        }
      ]
    });

    expect(profile).toMatchObject({
      version: 1,
      source: "deepcheck_relationship_expansion_v1",
      generatedAt: "2026-07-03T00:00:00.000Z"
    });
    expect(profile.paths).toHaveLength(1);
    expect(profile.paths[0]).toMatchObject({
      pathAddresses: [subject, walletA, walletB],
      source: "deepcheck_relationship_second_hop",
      depth: 2,
      txHashes: ["tx-a-b"]
    });
    expect(profile.paths[0]?.evidence[0]?.txHash).toBe("tx-a-b");
    expect(profile.directWalletStatuses[0]?.status).toBe("expanded");
    expect(profile.counters).toMatchObject({ expanded: 1, complete: 1, maxSavedDepth: 2 });
  });

  it("does not expand accidentally with negative or non-finite limits", async () => {
    const profile = await build({
      limits: {
        maxSecondHopNeighborsPerDirectWallet: -1,
        maxTotalSecondHopEdges: Number.NaN
      },
      listIndexedEdges: () => [
        { txHash: "tx-a-b", fromAddress: walletA, toAddress: walletB, amountRaw: "200" },
        { txHash: "tx-a-c", fromAddress: walletA, toAddress: walletC, amountRaw: "100" }
      ]
    });

    expect(profile.limits).toMatchObject({
      maxSecondHopNeighborsPerDirectWallet: 0,
      maxTotalSecondHopEdges: 0
    });
    expect(profile.paths).toHaveLength(0);
    expect(profile.counters.expanded).toBe(0);
    expect(profile.directWalletStatuses[0]).toMatchObject({
      status: "grouped",
      savedPathCount: 0,
      groupedNeighborCount: 2
    });
  });

  it("orders per-neighbor evidence deterministically", async () => {
    const edges: IndexedSecondLayerEdge[] = [
      {
        txHash: "tx-later",
        fromAddress: walletA,
        toAddress: walletB,
        amountRaw: "200",
        timestamp: "2026-01-03T00:00:00.000Z"
      },
      {
        txHash: "tx-earlier",
        fromAddress: walletB,
        toAddress: walletA,
        amountRaw: "100",
        timestamp: "2026-01-02T00:00:00.000Z"
      }
    ];

    const forward = await build({ listIndexedEdges: () => edges });
    const reversed = await build({ listIndexedEdges: () => [...edges].reverse() });

    expect(forward.paths[0]?.id).toBe(reversed.paths[0]?.id);
    expect(forward.paths[0]?.txHashes).toEqual(["tx-earlier", "tx-later"]);
    expect(reversed.paths[0]?.txHashes).toEqual(forward.paths[0]?.txHashes);
    expect(reversed.paths[0]?.evidence.map((item) => item.txHash)).toEqual(forward.paths[0]?.evidence.map((item) => item.txHash));
  });

  it("stops service boundary and high-degree wallets without expansion", async () => {
    const serviceWallet = "TService111111111111111111111111111";
    const highDegreeWallet = "THighDegree111111111111111111111111";
    const profile = await build({
      directCounterpartyProfiles: [ordinary(serviceWallet, "2000"), ordinary(highDegreeWallet, "1000")],
      classifications: new Map([[serviceWallet, classification("cex", true)]]),
      getIndexState: (address) => completeIndex(address, address === highDegreeWallet ? 500 : 2),
      listIndexedEdges: () => [{ txHash: "tx-unused", fromAddress: highDegreeWallet, toAddress: walletB }]
    });

    expect(profile.paths).toHaveLength(0);
    expect(profile.directWalletStatuses.map((status) => status.status)).toEqual([
      "stopped_service_boundary",
      "stopped_high_degree"
    ]);
    expect(profile.directWalletStatuses.map((status) => status.stopReason)).toEqual(["service_boundary", "high_degree"]);
    expect(profile.counters.stopped).toBe(2);
  });

  it("does not stop a non-boundary contract account as a service boundary", async () => {
    const secondLayer = await build({
      directCounterpartyProfiles: [ordinary(gasFree)],
      classifications: new Map([[gasFree, classification("service", false)]]),
      listIndexedEdges: () => [{ txHash: "tx-gasfree-b", fromAddress: gasFree, toAddress: walletB, amountRaw: "100" }]
    });

    expect(secondLayer.directWalletStatuses.find((item) => item.address === gasFree)?.status).not.toBe("stopped_service_boundary");
    expect(secondLayer.paths[0]?.pathAddresses).toEqual([subject, gasFree, walletB]);
  });

  it("emits a queue request when an ordinary wallet index is missing", async () => {
    const profile = await build({ getIndexState: () => null });

    expect(profile.directWalletStatuses[0]).toMatchObject({
      address: walletA,
      status: "not_indexed",
      stopReason: "index_not_complete",
      limitationCode: "deep_second_layer_not_indexed"
    });
    expect(profile.queueRequests).toEqual([
      { address: walletA, coverageMode: "all_time", queuedReason: "deep_second_layer" }
    ]);
    expect(profile.counters.notIndexed).toBe(1);
  });

  it("groups low-signal second-hop tails", async () => {
    const profile = await build({
      limits: { maxSecondHopNeighborsPerDirectWallet: 1 },
      listIndexedEdges: () => [
        { txHash: "tx-a-b", fromAddress: walletA, toAddress: walletB, amountRaw: "200" },
        { txHash: "tx-a-c", fromAddress: walletA, toAddress: walletC, amountRaw: "100" }
      ]
    });

    expect(profile.paths).toHaveLength(1);
    expect(profile.paths[0]?.secondHopAddress).toBe(walletB);
    expect(profile.groups).toHaveLength(1);
    expect(profile.groups[0]).toMatchObject({
      kind: "low_signal_neighbors",
      members: [walletC],
      memberCount: 1
    });
    expect(profile.directWalletStatuses[0]?.status).toBe("grouped");
    expect(profile.counters.grouped).toBe(1);
  });

  it("omits complete indexed wallets beyond expansion budget without queueing them", async () => {
    const walletD = "TWalletD111111111111111111111111111";
    const profile = await build({
      directCounterpartyProfiles: [ordinary(walletA, "2000"), ordinary(walletD, "1000")],
      limits: { maxExpandedDirectWallets: 1 },
      listIndexedEdges: (address) => [
        {
          txHash: `tx-${address}-b`,
          fromAddress: address,
          toAddress: walletB,
          amountRaw: "100"
        }
      ]
    });

    expect(profile.directWalletStatuses).toHaveLength(1);
    expect(profile.directWalletStatuses[0]).toMatchObject({ address: walletA, status: "expanded" });
    expect(profile.directWalletStatuses.some((status) => status.address === walletD && status.status === "not_indexed")).toBe(false);
    expect(profile.queueRequests.some((request) => request.address === walletD)).toBe(false);
    expect(profile.counters.notIndexed).toBe(0);
    expect(profile.counters.expanded).toBe(1);
    expect(profile.paths[0]?.directWalletAddress).toBe(walletA);
  });

  it("sets max saved depth from actual saved paths instead of budget", async () => {
    const profile = await build({
      limits: { maxTotalSecondHopEdges: 25 },
      listIndexedEdges: () => []
    });

    expect(profile.counters.maxSavedDepth).toBe(0);
    expect(profile.directWalletStatuses[0]?.status).toBe("no_meaningful_second_hop");
  });

  it("keeps stop reason and limitation fields on status records", async () => {
    const profile = await build({ getIndexState: () => null });

    expect(profile.directWalletStatuses[0]?.stopReason).toBe("index_not_complete");
    expect(profile.directWalletStatuses[0]?.limitationCode).toBe("deep_second_layer_not_indexed");
  });

  it("marks queued statuses idempotently and adjusts counters once", async () => {
    const profile = await build({ getIndexState: () => null });
    const queuedOnce = markSecondLayerQueued(profile, [walletA.toLowerCase()]);
    const queuedTwice = markSecondLayerQueued(queuedOnce, [walletA]);

    expect(queuedOnce.directWalletStatuses[0]).toMatchObject({
      status: "queued",
      stopReason: "queued_for_indexing",
      limitationCode: "deep_second_layer_queued",
      queued: true
    });
    expect(queuedOnce.counters).toMatchObject({ notIndexed: 0, queued: 1 });
    expect(queuedTwice.counters).toMatchObject({ notIndexed: 0, queued: 1 });
    expect(queuedTwice.directWalletStatuses[0]).toEqual(queuedOnce.directWalletStatuses[0]);
  });
});
