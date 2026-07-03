import { describe, expect, it, vi } from "vitest";
import { refreshDeepCheckSecondLayerFromIndex } from "../../src/forensics/deepSecondLayerRefresh";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import type {
  DeepSecondLayerRelationshipGroup,
  DeepSecondLayerRelationshipPath,
  DeepSecondLayerRelationshipProfile,
  DirectCounterpartyInteractionProfile,
  ForensicRouteEdge,
  ServiceClassification,
  TronAddressUsdtIndexState
} from "../../src/types";

const subject = "TSubject111111111111111111111111111";
const walletA = "TWalletA111111111111111111111111111";
const walletB = "TWalletB111111111111111111111111111";
const walletC = "TWalletC111111111111111111111111111";

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: subject,
    status: "completed",
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2026-01-02T00:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: "test",
    progressJson: {},
    resultJson: {
      directCounterpartyInteractionProfiles: [directProfile(walletA)],
      secondLayerRelationshipProfiles: profile()
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: new Date("2026-01-01T00:00:01.000Z"),
    completedAt: new Date("2026-01-01T00:00:02.000Z"),
    ...overrides
  };
}

function directProfile(address: string, volumeRaw = "1000"): DirectCounterpartyInteractionProfile {
  return {
    subjectAddress: subject,
    direction: "outbound",
    counterpartyAddress: address,
    volumeRaw,
    volumeRatio: 1,
    txCount: 1,
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

function profile(overrides: Partial<DeepSecondLayerRelationshipProfile> = {}): DeepSecondLayerRelationshipProfile {
  const directWalletStatuses = overrides.directWalletStatuses ?? [
    {
      address: walletA,
      status: "queued",
      stopReason: "queued_for_indexing",
      limitationCode: "deep_second_layer_queued",
      queued: true,
      serviceCategory: null,
      identity: null,
      index: null,
      savedPathCount: 0,
      groupedNeighborCount: 0
    }
  ];
  return {
    subjectAddress: subject,
    generatedAt: "2026-01-01T00:00:00.000Z",
    limits: {
      maxDirectWalletsConsidered: 100,
      maxExpandedDirectWallets: 25,
      maxSecondHopNeighborsPerDirectWallet: 1,
      maxTotalSecondHopEdges: 150,
      highDegreeSuppressionThreshold: 500
    },
    directWalletStatuses,
    paths: [],
    groups: [],
    queueRequests: [],
    counters: {
      directWalletsConsidered: directWalletStatuses.length,
      expanded: 0,
      grouped: 0,
      stopped: 0,
      notIndexed: directWalletStatuses.filter((status) => status.status === "not_indexed").length,
      queued: directWalletStatuses.filter((status) => status.status === "queued").length,
      complete: 0,
      paths: 0,
      groups: 0,
      maxSavedDepth: 0
    },
    ...overrides
  };
}

function completeState(address: string): TronAddressUsdtIndexState {
  return {
    address,
    tokenContract: "TRON-USDT",
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    targetTimestamp: null,
    status: "complete",
    statusReason: "complete_provider_windowed",
    provider: "tronscan",
    totalReported: 1,
    fetchedTransferCount: 1,
    uniqueCounterpartyCount: 1,
    newestTransferAt: new Date("2026-01-02T00:00:00.000Z"),
    oldestTransferAt: new Date("2026-01-02T00:00:00.000Z"),
    coveredUntilTimestamp: null,
    fetchedPageCount: 1,
    plannedPageCount: 1,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 0,
    nextRunAt: new Date("2026-01-02T00:00:00.000Z"),
    attemptCount: 1,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: null,
    requestedByJobId: null,
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z")
  };
}

function edge(fromAddress = walletA, toAddress = walletB, txHash = "tx-a-b"): ForensicRouteEdge {
  return {
    id: txHash,
    fromAddress,
    toAddress,
    txHash,
    amountRaw: "123",
    timestamp: new Date("2026-01-02T00:00:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function stalePath(): DeepSecondLayerRelationshipPath {
  return {
    id: "stale-path",
    source: "deepcheck_relationship_second_hop",
    depth: 2,
    subjectAddress: subject,
    directWalletAddress: walletA,
    secondHopAddress: walletC,
    pathAddresses: [subject, walletA, walletC],
    txHashes: ["tx-stale"],
    txCount: 1,
    amountRaw: "1",
    firstSeen: null,
    lastSeen: null,
    tokenContract: null,
    assetSymbol: null,
    evidence: [],
    selectionReason: "top_amount_or_activity"
  };
}

function staleGroup(): DeepSecondLayerRelationshipGroup {
  return {
    id: "stale-group",
    kind: "low_signal_neighbors",
    label: "stale",
    subjectAddress: subject,
    directWalletAddress: walletA,
    memberCount: 1,
    members: [walletC],
    txCount: 1,
    amountRaw: "1",
    firstSeen: null,
    lastSeen: null
  };
}

function deps(sourceJob: ForensicCheckJob, overrides: {
  getIndexState?: (address: string) => Promise<TronAddressUsdtIndexState | null>;
  listIndexedEdges?: (address: string) => Promise<ForensicRouteEdge[]>;
  patchCompletedJob?: (input: { id: string; resultJson: Record<string, unknown>; progressJson: Record<string, unknown> }) => Promise<boolean>;
} = {}) {
  return {
    jobId: sourceJob.id,
    getJob: vi.fn(async () => sourceJob),
    patchCompletedJob: vi.fn(overrides.patchCompletedJob ?? (async () => true)),
    getClassificationForAddress: vi.fn(async (): Promise<ServiceClassification | null> => null),
    getIndexState: vi.fn(overrides.getIndexState ?? (async (address) => completeState(address))),
    listIndexedEdges: vi.fn(overrides.listIndexedEdges ?? (async () => [edge()]))
  };
}

describe("deep second-layer refresh", () => {
  it("patches completed DeepCheck job when queued wallet index is complete and adds path subject -> A -> B", async () => {
    const runtime = deps(job());

    const result = await refreshDeepCheckSecondLayerFromIndex(runtime);

    expect(result).toEqual({ status: "refreshed", expanded: 1, queued: 0, notIndexed: 0 });
    expect(runtime.patchCompletedJob).toHaveBeenCalledTimes(1);
    const patch = runtime.patchCompletedJob.mock.calls[0]?.[0];
    const nextProfile = patch?.resultJson.secondLayerRelationshipProfiles as DeepSecondLayerRelationshipProfile;
    expect(nextProfile.paths[0]?.pathAddresses).toEqual([subject, walletA, walletB]);
    expect(nextProfile.directWalletStatuses[0]).toMatchObject({ address: walletA, status: "expanded", savedPathCount: 1 });
    expect(patch?.progressJson).toMatchObject({ secondLayerQueued: 0, secondLayerComplete: 1 });
    expect(patch?.progressJson.secondLayerRefreshedAt).toEqual(expect.any(String));
  });

  it("does not patch non-completed jobs", async () => {
    const runtime = deps(job({ status: "running" }));

    const result = await refreshDeepCheckSecondLayerFromIndex(runtime);

    expect(result).toEqual({ status: "skipped", reason: "job_not_completed_deepcheck" });
    expect(runtime.patchCompletedJob).not.toHaveBeenCalled();
  });

  it("skips when no pending queued/not_indexed statuses", async () => {
    const runtime = deps(job({
      resultJson: {
        secondLayerRelationshipProfiles: profile({
          directWalletStatuses: [{
            address: walletA,
            status: "expanded",
            stopReason: null,
            limitationCode: null,
            queued: false,
            serviceCategory: null,
            identity: null,
            index: completeState(walletA),
            savedPathCount: 1,
            groupedNeighborCount: 0
          }]
        })
      }
    }));

    const result = await refreshDeepCheckSecondLayerFromIndex(runtime);

    expect(result).toEqual({ status: "skipped", reason: "no_pending_second_layer_wallets" });
    expect(runtime.patchCompletedJob).not.toHaveBeenCalled();
  });

  it("replaces stale pending paths and groups instead of duplicating them", async () => {
    const existing = profile({ paths: [stalePath()], groups: [staleGroup()] });
    const runtime = deps(job({ resultJson: { directCounterpartyInteractionProfiles: [directProfile(walletA)], secondLayerRelationshipProfiles: existing } }));

    await refreshDeepCheckSecondLayerFromIndex(runtime);

    const patch = runtime.patchCompletedJob.mock.calls[0]?.[0];
    const nextProfile = patch?.resultJson.secondLayerRelationshipProfiles as DeepSecondLayerRelationshipProfile;
    expect(nextProfile.paths).toHaveLength(1);
    expect(nextProfile.paths[0]?.secondHopAddress).toBe(walletB);
    expect(nextProfile.groups).toHaveLength(0);
    expect(nextProfile.counters.paths).toBe(1);
    expect(nextProfile.counters.groups).toBe(0);
  });

  it("keeps pending wallet factual when refreshed index is still not indexed", async () => {
    const runtime = deps(job(), { getIndexState: async () => null, listIndexedEdges: async () => [] });

    const result = await refreshDeepCheckSecondLayerFromIndex(runtime);

    expect(result).toEqual({ status: "refreshed", expanded: 0, queued: 0, notIndexed: 1 });
    const patch = runtime.patchCompletedJob.mock.calls[0]?.[0];
    const nextProfile = patch?.resultJson.secondLayerRelationshipProfiles as DeepSecondLayerRelationshipProfile;
    expect(nextProfile.directWalletStatuses[0]).toMatchObject({
      address: walletA,
      status: "not_indexed",
      stopReason: "index_not_complete",
      queued: false
    });
    expect(nextProfile.counters).toMatchObject({ notIndexed: 1, queued: 0, complete: 0 });
    expect(patch?.progressJson).toMatchObject({ secondLayerQueued: 1, secondLayerComplete: 0 });
  });

  it("ignores malformed nested entries and refreshes valid pending wallet", async () => {
    const malformedPath = { id: "bad-path", directWalletAddress: 123 };
    const malformedGroup = { id: "bad-group", directWalletAddress: null };
    const malformedStatus = { address: 123, status: "queued" };
    const existing = profile({
      directWalletStatuses: [
        malformedStatus as unknown as DeepSecondLayerRelationshipProfile["directWalletStatuses"][number],
        {
          address: walletC,
          status: "expanded",
          stopReason: null,
          limitationCode: null,
          queued: false,
          serviceCategory: null,
          identity: null,
          index: completeState(walletC),
          savedPathCount: 1,
          groupedNeighborCount: 0
        },
        {
          address: walletA,
          status: "queued",
          stopReason: "queued_for_indexing",
          limitationCode: "deep_second_layer_queued",
          queued: true,
          serviceCategory: null,
          identity: null,
          index: null,
          savedPathCount: 0,
          groupedNeighborCount: 0
        }
      ],
      paths: [
        malformedPath as unknown as DeepSecondLayerRelationshipPath,
        { ...stalePath(), directWalletAddress: walletC }
      ],
      groups: [
        malformedGroup as unknown as DeepSecondLayerRelationshipGroup,
        { ...staleGroup(), directWalletAddress: walletC }
      ]
    });
    const runtime = deps(job({
      resultJson: {
        directCounterpartyInteractionProfiles: [
          { counterpartyAddress: 42 },
          directProfile(walletA)
        ],
        secondLayerRelationshipProfiles: existing
      }
    }));

    const result = await refreshDeepCheckSecondLayerFromIndex(runtime);

    expect(result).toEqual({ status: "refreshed", expanded: 2, queued: 0, notIndexed: 0 });
    const patch = runtime.patchCompletedJob.mock.calls[0]?.[0];
    const nextProfile = patch?.resultJson.secondLayerRelationshipProfiles as DeepSecondLayerRelationshipProfile;
    expect(nextProfile.directWalletStatuses.map((status) => status.address)).toEqual([walletC, walletA]);
    expect(nextProfile.paths.map((path) => path.directWalletAddress)).toEqual([walletC, walletA]);
    expect(nextProfile.groups.map((group) => group.directWalletAddress)).toEqual([walletC]);
  });

  it("returns skipped when completed job patch is not applied", async () => {
    const runtime = deps(job(), { patchCompletedJob: async () => false });

    const result = await refreshDeepCheckSecondLayerFromIndex(runtime);

    expect(result).toEqual({ status: "skipped", reason: "patch_not_applied" });
    expect(runtime.patchCompletedJob).toHaveBeenCalledTimes(1);
  });
});
