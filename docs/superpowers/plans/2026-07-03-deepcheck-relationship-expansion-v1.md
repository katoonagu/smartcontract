# DeepCheck Relationship Expansion v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build honest DeepCheck second-layer relationship expansion where every direct wallet has an expanded, grouped, queued, not-indexed, or stopped status.

**Architecture:** Add a focused second-layer builder that emits fact-only result JSON, wire it into DeepCheck jobs, and add a refresh helper that patches completed DeepCheck results after queued address indexes complete. Admin projects the new block into visible second-hop edges, group nodes, statuses, legend entries, and counters without changing scoring or Where/Incoming behavior.

**Tech Stack:** TypeScript, Vitest, existing PostgreSQL repository helpers, existing Admin SVG graph UI, local TRON USDT indexed transfer reader.

---

## File Structure

- Create `src/forensics/deepSecondLayerRelationship.ts` for v1 types, deterministic path/group/status building, stable IDs, counters, and queue request derivation.
- Create `tests/forensics/deepSecondLayerRelationship.test.ts` for helper-level behavior.
- Modify `src/types.ts` to export serializable second-layer result types and add the optional report field.
- Modify `src/check/deepForensicCheck.ts` to fix the all-time direct-boundary read cap and call the helper after direct profiles are available.
- Modify `src/forensics/deepForensicJob.ts` to queue missing second-layer wallets and persist the block in `result_json`.
- Modify `src/storage/repositories.ts` and storage tests to add a narrow completed DeepCheck JSON patch function and a pending-job query.
- Create `src/forensics/deepSecondLayerRefresh.ts` and tests for idempotent completed-job refresh.
- Modify `src/index.ts` to inject the new repository/dependency functions and run a bounded background refresh sweep after forensic job cycles.
- Modify `src/admin/forensicsGraph.ts` and `tests/admin/forensicsGraph.test.ts` to project second-layer paths, groups, statuses, and summary counters.
- Modify `src/admin/adminConsole.ts` and `tests/admin/adminConsole.test.ts` to make second-hop/cross-wallet lines readable, show legend/status details, and expose a manual refresh action.
- Modify docs after behavior changes: `docs/superpowers/specs/2026-07-03-deepcheck-relationship-expansion-v1-design.md` if implementation changes the approved design, and `docs/knowledge/06-deepcheck.md` only if that file exists in the active branch.

## Task 1: Restore Full Direct Boundary Materialization

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Write the failing direct-boundary regression test**

Append this test after `uses the full all-time direct boundary instead of top incoming-sender cap`:

```ts
  it("does not truncate all-time direct boundary by stale fetched transfer count", async () => {
    const sourceAddress = "TSubjectAllTimeStaleCount111111111";
    const transfers = Array.from({ length: 5 }, (_, index) =>
      indexed({
        id: `tx-stale-count-${index}`,
        from: `TStaleSender${String(index).padStart(2, "0")}1111111111111111`,
        to: sourceAddress,
        amountRaw: String((index + 1) * 1_000_000),
        at: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        eventIndex: index
      })
    );
    const reads: Array<{ offset?: number; limit: number }> = [];

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        if (address !== sourceAddress) return [];
        reads.push({ offset: options.offset, limit: options.limit });
        const offset = options.offset ?? 0;
        return transfers.slice(offset, offset + options.limit);
      },
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      maxPagesPerAddress: 3,
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(sourceAddress, 2, 5),
      allTimeMode: "strict"
    });

    expect(report.coverage.allTime?.subjectUniqueDirectWallets).toBe(5);
    expect(report.directCounterpartyInteractionProfiles ?? []).toHaveLength(5);
    expect(reads[0]).toEqual({ offset: 0, limit: 1000 });
  });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm test -- tests/check/deepForensicCheck.test.ts -t "does not truncate all-time direct boundary"
```

Expected: FAIL because `subjectUniqueDirectWallets` is `2` or because the read limit follows the stale fetched transfer count.

- [ ] **Step 3: Remove the stale count cap from all-time direct reads**

In `src/check/deepForensicCheck.ts`, replace `fetchAllIndexedEdgesForAddress` with:

```ts
async function fetchAllIndexedEdgesForAddress(
  deps: DeepAddressForensicDeps,
  address: string,
  maxTimestamp: Date,
  pageSize = DEFAULT_DIRECT_BOUNDARY_PAGE_SIZE
): Promise<ForensicRouteEdge[]> {
  if (!deps.listIndexedUsdtTransfersForAddress) return [];
  const edges: ForensicRouteEdge[] = [];
  const boundedPageSize = Math.max(1, Math.min(Math.trunc(pageSize), DEFAULT_DIRECT_BOUNDARY_PAGE_SIZE));
  for (let offset = 0; offset < DIRECT_BOUNDARY_MAX_MATERIALIZED_TRANSFERS; offset += boundedPageSize) {
    const limit = Math.min(boundedPageSize, DIRECT_BOUNDARY_MAX_MATERIALIZED_TRANSFERS - offset);
    const rows = await deps.listIndexedUsdtTransfersForAddress(address, {
      minTimestamp: new Date(0),
      maxTimestamp,
      limit,
      offset,
      orderBy: "newest"
    });
    edges.push(...rows.map(indexedTransferToRouteEdge));
    if (rows.length < limit) break;
  }
  return dedupeEdges(edges);
}
```

Update the call site from:

```ts
    ? await fetchAllIndexedEdgesForAddress(
      deps,
      input.sourceAddress,
      input.windowEnd,
      input.allTimeSubjectIndexState?.fetchedTransferCount ?? 0
    )
```

to:

```ts
    ? await fetchAllIndexedEdgesForAddress(
      deps,
      input.sourceAddress,
      input.windowEnd
    )
```

- [ ] **Step 4: Replace the old bounded-by-count test expectation**

Rename the existing test `bounds full all-time direct boundary reads by the indexed transfer count` to:

```ts
  it("stops full all-time direct boundary reads after the first short page", async () => {
```

Change its final read expectation to:

```ts
    expect(reads.filter((read) => read.offset !== undefined)).toEqual([{ offset: 0, limit: 1000 }]);
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/check/deepForensicCheck.test.ts -t "all-time direct boundary"
```

Expected: PASS for the all-time direct boundary tests.

- [ ] **Step 6: Commit**

```powershell
git add src/check/deepForensicCheck.ts tests/check/deepForensicCheck.test.ts
git commit -m "fix(deepcheck): materialize full indexed direct boundary"
```

## Task 2: Add Second-Layer Types And Builder

**Files:**
- Modify: `src/types.ts`
- Create: `src/forensics/deepSecondLayerRelationship.ts`
- Create: `tests/forensics/deepSecondLayerRelationship.test.ts`

- [ ] **Step 1: Add serializable types to `src/types.ts`**

Add these exports near `DeepCheckAllTimeCoverage`:

```ts
export type DeepSecondLayerWalletStatus =
  | "expanded"
  | "grouped"
  | "stopped_service_boundary"
  | "stopped_high_degree"
  | "no_meaningful_second_hop"
  | "not_indexed"
  | "queued";

export type DeepSecondLayerGroupKind =
  | "low_signal_neighbors"
  | "service_endpoints"
  | "small_transfers"
  | "high_degree_suppressed";

export type DeepSecondLayerIndexSummary = {
  status: TronAddressUsdtIndexStatus | "not_found";
  coverageMode: TronAddressUsdtCoverageMode | null;
  statusReason: TronAddressUsdtCoverageStatusReason | null;
  fetchedTransferCount: number;
  uniqueCounterpartyCount: number;
};

export type DeepSecondLayerDirectWalletStatusRecord = {
  id: string;
  address: string;
  status: DeepSecondLayerWalletStatus;
  reason: string | null;
  limitationCode: string | null;
  serviceCategory: ServiceCategory | null;
  identity: string | null;
  isBoundary: boolean;
  directTxCount: number;
  directVolumeRaw: string;
  index: DeepSecondLayerIndexSummary;
  queued: boolean;
};

export type DeepSecondLayerRelationshipPath = {
  id: string;
  pathAddresses: [string, string, string];
  anchorAddress: string;
  neighborAddress: string;
  direction: CounterpartyRiskDirection | "mixed";
  txHashes: string[];
  amountRaw: string;
  txCount: number;
  firstTransferAt: string | null;
  lastTransferAt: string | null;
  selectionReason: string;
  source: "deepcheck_relationship_second_hop";
  depth: 2;
};

export type DeepSecondLayerRelationshipGroup = {
  id: string;
  anchorAddress: string;
  kind: DeepSecondLayerGroupKind;
  label: string;
  memberCount: number;
  totalAmountRaw: string;
  txCount: number;
  members: Array<{
    address: string;
    amountRaw: string;
    txCount: number;
    txHashes: string[];
  }>;
};

export type DeepSecondLayerRelationshipCounters = {
  directWalletsTotal: number;
  directWalletsConsidered: number;
  eligible: number;
  expanded: number;
  grouped: number;
  stopped: number;
  noMeaningfulSecondHop: number;
  notIndexed: number;
  queued: number;
  complete: number;
  maxSavedDepth: number;
};

export type DeepSecondLayerRelationshipLimits = {
  maxDirectWalletsConsidered: number;
  maxExpandedDirectWallets: number;
  maxSecondHopNeighborsPerDirectWallet: number;
  maxTotalSecondHopEdges: number;
  highDegreeSuppressionThreshold: number;
};

export type DeepSecondLayerQueueRequest = {
  address: string;
  coverageMode: TronAddressUsdtCoverageMode;
  queuedReason: "deep_second_layer";
};

export type DeepSecondLayerRelationshipProfile = {
  version: 1;
  source: "deepcheck_relationship_expansion_v1";
  generatedAt: string;
  subjectAddress: string;
  directWalletStatuses: DeepSecondLayerDirectWalletStatusRecord[];
  paths: DeepSecondLayerRelationshipPath[];
  groups: DeepSecondLayerRelationshipGroup[];
  counters: DeepSecondLayerRelationshipCounters;
  limits: DeepSecondLayerRelationshipLimits;
  queueRequests: DeepSecondLayerQueueRequest[];
};
```

Add this field to `DeepAddressForensicReport` in `src/check/deepForensicCheck.ts` after `extendedProvenanceProfiles?: ExtendedProvenanceProfile[];`:

```ts
  secondLayerRelationshipProfiles?: DeepSecondLayerRelationshipProfile | null;
```

Update the type import list in `src/check/deepForensicCheck.ts` to include `DeepSecondLayerRelationshipProfile`.

- [ ] **Step 2: Create the failing helper tests**

Create `tests/forensics/deepSecondLayerRelationship.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSecondLayerRelationshipProfiles } from "../../src/forensics/deepSecondLayerRelationship";
import type {
  DirectCounterpartyInteractionProfile,
  ForensicRouteEdge,
  ServiceClassification,
  TronAddressUsdtIndexState
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const walletA = "TWalletA111111111111111111111111111111";
const walletB = "TWalletB111111111111111111111111111111";
const walletC = "TWalletC111111111111111111111111111111";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw = "1000000", at = "2026-06-01T00:00:00.000Z"): ForensicRouteEdge {
  return {
    id,
    fromAddress,
    toAddress,
    txHash: id,
    amountRaw,
    timestamp: new Date(at),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function profile(address: string, txCount = 1, volumeRaw = "1000000"): DirectCounterpartyInteractionProfile {
  return {
    subjectAddress: subject,
    direction: "outbound",
    counterpartyAddress: address,
    volumeRaw,
    volumeRatio: 1,
    txCount,
    firstSeen: "2026-06-01T00:00:00.000Z",
    lastSeen: "2026-06-01T00:00:00.000Z",
    txHashes: ["tx-subject-a"],
    serviceCategory: null,
    identity: null,
    snapshot: {
      address,
      riskScore: 0,
      riskLevel: "LOW",
      source: "none",
      evidenceClass: "no_exact_label_or_cached_taint",
      reasons: [],
      partialNotes: []
    },
    interactionWeight: 1,
    scoreContribution: 0,
    evidenceClass: "no_exact_label_or_cached_taint",
    skippedReason: "no_exact_label_or_cached_taint"
  };
}

function completeState(address: string, uniqueCounterpartyCount = 1): TronAddressUsdtIndexState {
  return {
    address,
    tokenContract: "TRON_USDT",
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    targetTimestamp: null,
    status: "complete",
    statusReason: "complete_provider_windowed",
    provider: "tronscan",
    totalReported: null,
    fetchedTransferCount: uniqueCounterpartyCount,
    uniqueCounterpartyCount,
    newestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
    oldestTransferAt: new Date("2026-06-01T00:00:00.000Z"),
    coveredUntilTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    fetchedPageCount: 1,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 0,
    nextRunAt: new Date("2026-06-01T00:00:00.000Z"),
    attemptCount: 0,
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
    completedAt: new Date("2026-06-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z")
  };
}

const limits = {
  maxDirectWalletsConsidered: 10,
  maxExpandedDirectWallets: 10,
  maxSecondHopNeighborsPerDirectWallet: 2,
  maxTotalSecondHopEdges: 10,
  highDegreeSuppressionThreshold: 50
};

describe("buildSecondLayerRelationshipProfiles", () => {
  it("renders indexed ordinary direct wallet as subject to A to B", async () => {
    const result = await buildSecondLayerRelationshipProfiles({
      subjectAddress: subject,
      directBoundaryAddresses: [walletA],
      directCounterpartyProfiles: [profile(walletA)],
      classifications: new Map(),
      generatedAt: new Date("2026-07-03T00:00:00.000Z"),
      limits,
      getIndexState: async () => completeState(walletA),
      listIndexedEdges: async () => [edge("tx-a-b", walletA, walletB)]
    });

    expect(result.paths).toEqual([expect.objectContaining({
      pathAddresses: [subject, walletA, walletB],
      source: "deepcheck_relationship_second_hop",
      depth: 2,
      txHashes: ["tx-a-b"]
    })]);
    expect(result.directWalletStatuses[0]).toMatchObject({ address: walletA, status: "expanded" });
    expect(result.counters).toMatchObject({ expanded: 1, complete: 1, maxSavedDepth: 2 });
  });

  it("stops service boundaries and high-degree wallets without expansion", async () => {
    const service: ServiceClassification = {
      category: "cex",
      identity: "Binance",
      confidence: "high",
      evidence: ["metadata:binance"],
      isBoundary: true
    };
    const highDegree = "THighDegree111111111111111111111111";
    const result = await buildSecondLayerRelationshipProfiles({
      subjectAddress: subject,
      directBoundaryAddresses: [walletA, highDegree],
      directCounterpartyProfiles: [profile(walletA), profile(highDegree)],
      classifications: new Map([[walletA, service]]),
      generatedAt: new Date("2026-07-03T00:00:00.000Z"),
      limits: { ...limits, highDegreeSuppressionThreshold: 2 },
      getIndexState: async (address) => completeState(address, address === highDegree ? 3 : 1),
      listIndexedEdges: async () => []
    });

    expect(result.directWalletStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: walletA, status: "stopped_service_boundary", reason: "service_boundary" }),
      expect.objectContaining({ address: highDegree, status: "stopped_high_degree", reason: "high_degree" })
    ]));
    expect(result.paths).toHaveLength(0);
    expect(result.counters.stopped).toBe(2);
  });

  it("queues missing ordinary wallet indexes", async () => {
    const result = await buildSecondLayerRelationshipProfiles({
      subjectAddress: subject,
      directBoundaryAddresses: [walletA],
      directCounterpartyProfiles: [profile(walletA)],
      classifications: new Map(),
      generatedAt: new Date("2026-07-03T00:00:00.000Z"),
      limits,
      getIndexState: async () => null,
      listIndexedEdges: async () => []
    });

    expect(result.directWalletStatuses[0]).toMatchObject({
      address: walletA,
      status: "not_indexed",
      limitationCode: "deep_second_layer_not_indexed"
    });
    expect(result.queueRequests).toEqual([{ address: walletA, coverageMode: "all_time", queuedReason: "deep_second_layer" }]);
    expect(result.counters.notIndexed).toBe(1);
  });

  it("groups low-signal second-hop tail while preserving top neighbors", async () => {
    const result = await buildSecondLayerRelationshipProfiles({
      subjectAddress: subject,
      directBoundaryAddresses: [walletA],
      directCounterpartyProfiles: [profile(walletA)],
      classifications: new Map(),
      generatedAt: new Date("2026-07-03T00:00:00.000Z"),
      limits: { ...limits, maxSecondHopNeighborsPerDirectWallet: 1 },
      getIndexState: async () => completeState(walletA, 3),
      listIndexedEdges: async () => [
        edge("tx-a-b", walletA, walletB, "9000000"),
        edge("tx-a-c", walletA, walletC, "1000000")
      ]
    });

    expect(result.paths.map((path) => path.neighborAddress)).toEqual([walletB]);
    expect(result.groups).toEqual([expect.objectContaining({
      anchorAddress: walletA,
      kind: "low_signal_neighbors",
      memberCount: 1,
      members: [expect.objectContaining({ address: walletC, txHashes: ["tx-a-c"] })]
    })]);
    expect(result.directWalletStatuses[0]).toMatchObject({ status: "grouped" });
    expect(result.counters.grouped).toBe(1);
  });
});
```

- [ ] **Step 3: Run the helper tests and verify failure**

Run:

```powershell
npm test -- tests/forensics/deepSecondLayerRelationship.test.ts
```

Expected: FAIL because `src/forensics/deepSecondLayerRelationship.ts` does not exist.

- [ ] **Step 4: Implement the builder**

Create `src/forensics/deepSecondLayerRelationship.ts` with these exported functions and helpers:

```ts
import { createHash } from "node:crypto";
import type {
  CounterpartyRiskDirection,
  DeepSecondLayerDirectWalletStatusRecord,
  DeepSecondLayerGroupKind,
  DeepSecondLayerIndexSummary,
  DeepSecondLayerRelationshipGroup,
  DeepSecondLayerRelationshipLimits,
  DeepSecondLayerRelationshipPath,
  DeepSecondLayerRelationshipProfile,
  DirectCounterpartyInteractionProfile,
  ForensicRouteEdge,
  ServiceClassification,
  TronAddressUsdtIndexState
} from "../types";

export type BuildSecondLayerRelationshipProfilesInput = {
  subjectAddress: string;
  directBoundaryAddresses: string[];
  directCounterpartyProfiles: DirectCounterpartyInteractionProfile[];
  classifications: Map<string, ServiceClassification | null>;
  generatedAt?: Date;
  limits?: Partial<DeepSecondLayerRelationshipLimits>;
  getIndexState(address: string): Promise<TronAddressUsdtIndexState | null>;
  listIndexedEdges(address: string): Promise<ForensicRouteEdge[]>;
};

const DEFAULT_LIMITS: DeepSecondLayerRelationshipLimits = {
  maxDirectWalletsConsidered: 100,
  maxExpandedDirectWallets: 25,
  maxSecondHopNeighborsPerDirectWallet: 6,
  maxTotalSecondHopEdges: 150,
  highDegreeSuppressionThreshold: 500
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}

function amount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function sumRaw(values: string[]): string {
  return values.reduce((sum, value) => sum + (/^\d+$/.test(value) ? BigInt(value) : 0n), 0n).toString();
}

function indexSummary(state: TronAddressUsdtIndexState | null): DeepSecondLayerIndexSummary {
  return {
    status: state?.status ?? "not_found",
    coverageMode: state?.coverageMode ?? null,
    statusReason: state?.statusReason ?? null,
    fetchedTransferCount: state?.fetchedTransferCount ?? 0,
    uniqueCounterpartyCount: state?.uniqueCounterpartyCount ?? 0
  };
}

function directProfileByAddress(profiles: DirectCounterpartyInteractionProfile[]): Map<string, DirectCounterpartyInteractionProfile> {
  return new Map(profiles.map((profile) => [profile.counterpartyAddress, profile]));
}

function edgeOtherAddress(anchor: string, edge: ForensicRouteEdge): string | null {
  if (edge.fromAddress === anchor) return edge.toAddress;
  if (edge.toAddress === anchor) return edge.fromAddress;
  return null;
}

function edgeDirection(anchor: string, edge: ForensicRouteEdge): CounterpartyRiskDirection {
  return edge.fromAddress === anchor ? "outbound" : "inbound";
}

function neighborRows(anchor: string, subjectAddress: string, edges: ForensicRouteEdge[]): Array<{
  address: string;
  amountRaw: string;
  txCount: number;
  txHashes: string[];
  firstTransferAt: string | null;
  lastTransferAt: string | null;
  direction: CounterpartyRiskDirection | "mixed";
}> {
  const grouped = new Map<string, { edges: ForensicRouteEdge[]; directions: Set<CounterpartyRiskDirection> }>();
  for (const edge of edges) {
    const other = edgeOtherAddress(anchor, edge);
    if (!other || other === subjectAddress || other === anchor) continue;
    const current = grouped.get(other) ?? { edges: [], directions: new Set<CounterpartyRiskDirection>() };
    current.edges.push(edge);
    current.directions.add(edgeDirection(anchor, edge));
    grouped.set(other, current);
  }
  return [...grouped.entries()].map(([address, value]) => {
    const sorted = [...value.edges].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    return {
      address,
      amountRaw: value.edges.reduce((sum, edge) => sum + amount(edge), 0n).toString(),
      txCount: value.edges.length,
      txHashes: sorted.map((edge) => edge.txHash),
      firstTransferAt: sorted[0]?.timestamp.toISOString() ?? null,
      lastTransferAt: sorted.at(-1)?.timestamp.toISOString() ?? null,
      direction: value.directions.size === 1 ? [...value.directions][0] : "mixed"
    };
  }).sort((left, right) => {
    const amountDelta = BigInt(right.amountRaw) - BigInt(left.amountRaw);
    if (amountDelta !== 0n) return amountDelta > 0n ? 1 : -1;
    if (left.txCount !== right.txCount) return right.txCount - left.txCount;
    return left.address.localeCompare(right.address);
  });
}

function emptyCounters(): DeepSecondLayerRelationshipProfile["counters"] {
  return {
    directWalletsTotal: 0,
    directWalletsConsidered: 0,
    eligible: 0,
    expanded: 0,
    grouped: 0,
    stopped: 0,
    noMeaningfulSecondHop: 0,
    notIndexed: 0,
    queued: 0,
    complete: 0,
    maxSavedDepth: 0
  };
}

export async function buildSecondLayerRelationshipProfiles(
  input: BuildSecondLayerRelationshipProfilesInput
): Promise<DeepSecondLayerRelationshipProfile> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const profilesByAddress = directProfileByAddress(input.directCounterpartyProfiles);
  const directWallets = [...new Set(input.directBoundaryAddresses)]
    .filter((address) => address !== input.subjectAddress)
    .sort((left, right) => {
      const leftProfile = profilesByAddress.get(left);
      const rightProfile = profilesByAddress.get(right);
      const amountDelta = BigInt(rightProfile?.volumeRaw ?? "0") - BigInt(leftProfile?.volumeRaw ?? "0");
      if (amountDelta !== 0n) return amountDelta > 0n ? 1 : -1;
      return left.localeCompare(right);
    });
  const considered = directWallets.slice(0, limits.maxDirectWalletsConsidered);
  const statuses: DeepSecondLayerDirectWalletStatusRecord[] = [];
  const paths: DeepSecondLayerRelationshipPath[] = [];
  const groups: DeepSecondLayerRelationshipGroup[] = [];
  const queueRequests: DeepSecondLayerRelationshipProfile["queueRequests"] = [];
  const counters = emptyCounters();
  counters.directWalletsTotal = directWallets.length;
  counters.directWalletsConsidered = considered.length;
  let expandedDirectWallets = 0;

  for (const address of considered) {
    const profile = profilesByAddress.get(address);
    const classification = input.classifications.get(address) ?? null;
    const state = await input.getIndexState(address);
    const index = indexSummary(state);
    const baseStatus = {
      id: `deep2:status:${stableId([input.subjectAddress, address])}`,
      address,
      reason: null,
      limitationCode: null,
      serviceCategory: classification?.category && classification.category !== "none" ? classification.category : null,
      identity: classification?.identity ?? null,
      isBoundary: classification?.isBoundary === true,
      directTxCount: profile?.txCount ?? 0,
      directVolumeRaw: profile?.volumeRaw ?? "0",
      index,
      queued: false
    };

    if (classification?.isBoundary) {
      statuses.push({ ...baseStatus, status: "stopped_service_boundary", reason: "service_boundary", limitationCode: "deep_second_layer_service_boundary" });
      counters.stopped += 1;
      continue;
    }
    if (index.uniqueCounterpartyCount >= limits.highDegreeSuppressionThreshold) {
      statuses.push({ ...baseStatus, status: "stopped_high_degree", reason: "high_degree", limitationCode: "deep_second_layer_high_degree" });
      counters.stopped += 1;
      continue;
    }
    if (state?.status !== "complete" || state.statusReason !== "complete_provider_windowed") {
      statuses.push({ ...baseStatus, status: "not_indexed", reason: "index_not_complete", limitationCode: "deep_second_layer_not_indexed" });
      queueRequests.push({ address, coverageMode: "all_time", queuedReason: "deep_second_layer" });
      counters.notIndexed += 1;
      continue;
    }
    counters.eligible += 1;
    if (expandedDirectWallets >= limits.maxExpandedDirectWallets || paths.length >= limits.maxTotalSecondHopEdges) {
      statuses.push({ ...baseStatus, status: "stopped_high_degree", reason: "expansion_budget_exhausted", limitationCode: "deep_second_layer_expansion_budget" });
      counters.stopped += 1;
      continue;
    }
    const rows = neighborRows(address, input.subjectAddress, await input.listIndexedEdges(address));
    if (rows.length === 0) {
      statuses.push({ ...baseStatus, status: "no_meaningful_second_hop", reason: "no_meaningful_second_hop", limitationCode: "deep_second_layer_no_meaningful_neighbor" });
      counters.noMeaningfulSecondHop += 1;
      continue;
    }
    const remainingEdgeBudget = Math.max(0, limits.maxTotalSecondHopEdges - paths.length);
    const selected = rows.slice(0, Math.min(limits.maxSecondHopNeighborsPerDirectWallet, remainingEdgeBudget));
    const tail = rows.slice(selected.length);
    for (const neighbor of selected) {
      paths.push({
        id: `deep2:path:${stableId([input.subjectAddress, address, neighbor.address, neighbor.txHashes])}`,
        pathAddresses: [input.subjectAddress, address, neighbor.address],
        anchorAddress: address,
        neighborAddress: neighbor.address,
        direction: neighbor.direction,
        txHashes: neighbor.txHashes,
        amountRaw: neighbor.amountRaw,
        txCount: neighbor.txCount,
        firstTransferAt: neighbor.firstTransferAt,
        lastTransferAt: neighbor.lastTransferAt,
        selectionReason: "top_amount_or_activity",
        source: "deepcheck_relationship_second_hop",
        depth: 2
      });
    }
    if (tail.length > 0) {
      groups.push({
        id: `deep2:group:${stableId([input.subjectAddress, address, "low_signal_neighbors", tail.map((item) => item.address)])}`,
        anchorAddress: address,
        kind: "low_signal_neighbors",
        label: `${tail.length} low-signal neighbors`,
        memberCount: tail.length,
        totalAmountRaw: sumRaw(tail.map((item) => item.amountRaw)),
        txCount: tail.reduce((sum, item) => sum + item.txCount, 0),
        members: tail.map((item) => ({
          address: item.address,
          amountRaw: item.amountRaw,
          txCount: item.txCount,
          txHashes: item.txHashes
        }))
      });
    }
    statuses.push({ ...baseStatus, status: tail.length > 0 ? "grouped" : "expanded" });
    counters.expanded += selected.length > 0 ? 1 : 0;
    if (tail.length > 0) counters.grouped += 1;
    counters.complete += 1;
    counters.maxSavedDepth = selected.length > 0 ? 2 : counters.maxSavedDepth;
    expandedDirectWallets += 1;
  }

  return {
    version: 1,
    source: "deepcheck_relationship_expansion_v1",
    generatedAt,
    subjectAddress: input.subjectAddress,
    directWalletStatuses: statuses,
    paths,
    groups,
    counters,
    limits,
    queueRequests
  };
}

export function markSecondLayerQueued(
  profile: DeepSecondLayerRelationshipProfile,
  queuedAddresses: Set<string>
): DeepSecondLayerRelationshipProfile {
  const directWalletStatuses = profile.directWalletStatuses.map((status) =>
    queuedAddresses.has(status.address) && status.status === "not_indexed"
      ? { ...status, status: "queued" as const, queued: true, reason: "queued_for_indexing", limitationCode: "deep_second_layer_queued" }
      : status
  );
  return {
    ...profile,
    directWalletStatuses,
    counters: {
      ...profile.counters,
      notIndexed: directWalletStatuses.filter((status) => status.status === "not_indexed").length,
      queued: directWalletStatuses.filter((status) => status.status === "queued").length
    }
  };
}
```

- [ ] **Step 5: Run helper tests**

Run:

```powershell
npm test -- tests/forensics/deepSecondLayerRelationship.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/types.ts src/forensics/deepSecondLayerRelationship.ts tests/forensics/deepSecondLayerRelationship.test.ts src/check/deepForensicCheck.ts
git commit -m "feat(deepcheck): add relationship second-layer builder"
```

## Task 3: Wire Builder Into DeepCheck Report

**Files:**
- Modify: `src/check/deepForensicCheck.ts`
- Modify: `tests/check/deepForensicCheck.test.ts`

- [ ] **Step 1: Add failing DeepCheck report test**

Append this test near the all-time DeepCheck tests:

```ts
  it("saves second-layer relationship statuses and indexed paths", async () => {
    const walletA = "TSecondLayerA111111111111111111111";
    const walletB = "TSecondLayerB111111111111111111111";
    const transfers = [
      indexed({ id: "tx-subject-a", from: subject, to: walletA, amountRaw: "7000000", at: "2026-06-01T00:00:00.000Z" })
    ];
    const indexedByAddress = new Map([
      [subject, transfers],
      [walletA, [indexed({ id: "tx-a-b", from: walletA, to: walletB, amountRaw: "6000000", at: "2026-06-01T00:05:00.000Z" })]]
    ]);

    const report = await runDeepAddressForensicCheck({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      listIndexedUsdtTransfersForAddress: async (address, options) => {
        const rows = indexedByAddress.get(address) ?? [];
        const offset = options.offset ?? 0;
        return rows.slice(offset, offset + options.limit);
      },
      getAddressUsdtIndexState: async (address) => address === walletA ? completeIndexState(walletA, 1, 1) : null,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address)
    }, {
      sourceAddress: subject,
      windowStart: new Date(0),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      maxInboundSenders: 1,
      extendedSearchMode: "disabled",
      allTimeSubjectIndexState: completeIndexState(subject, 1, 1),
      allTimeMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(report.secondLayerRelationshipProfiles).toMatchObject({
      version: 1,
      subjectAddress: subject,
      directWalletStatuses: [expect.objectContaining({ address: walletA, status: "expanded" })],
      paths: [expect.objectContaining({ pathAddresses: [subject, walletA, walletB], txHashes: ["tx-a-b"] })],
      counters: expect.objectContaining({ expanded: 1, complete: 1, maxSavedDepth: 2 })
    });
    expect(report.coverage.allTime).toMatchObject({
      secondLayerActiveBudget: 25,
      secondLayerComplete: 1
    });
  });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm test -- tests/check/deepForensicCheck.test.ts -t "saves second-layer relationship"
```

Expected: FAIL because `getAddressUsdtIndexState` and `secondLayerRelationshipProfiles` are not wired.

- [ ] **Step 3: Add deps/input wiring**

In `src/check/deepForensicCheck.ts`, import:

```ts
import { buildSecondLayerRelationshipProfiles } from "../forensics/deepSecondLayerRelationship";
```

Add to `DeepAddressForensicDeps`:

```ts
  getAddressUsdtIndexState?(address: string): Promise<TronAddressUsdtIndexState | null>;
```

Add `secondLayerRelationshipProfiles?: DeepSecondLayerRelationshipProfile | null;` to `DeepAddressForensicReport`.

- [ ] **Step 4: Build the second-layer block after `extendedProvenanceProfiles`**

After the extended provenance block and before `secondLayerBudget`, add:

```ts
  const secondLayerBudget = input.secondLayerMaxActiveWalletsPerJob ?? 0;
  const secondLayerRelationshipProfiles = secondLayerBudget > 0 && deps.listIndexedUsdtTransfersForAddress && deps.getAddressUsdtIndexState
    ? await buildSecondLayerRelationshipProfiles({
      subjectAddress: input.sourceAddress,
      directBoundaryAddresses,
      directCounterpartyProfiles: directCounterpartyInteractionProfiles,
      classifications,
      limits: {
        maxDirectWalletsConsidered: directBoundaryAddresses.length,
        maxExpandedDirectWallets: secondLayerBudget,
        maxSecondHopNeighborsPerDirectWallet: 6,
        maxTotalSecondHopEdges: secondLayerBudget * 6,
        highDegreeSuppressionThreshold: 500
      },
      getIndexState: (address) => deps.getAddressUsdtIndexState?.(address) ?? Promise.resolve(null),
      listIndexedEdges: async (address) => fetchIndexedRouteEdges(deps, input, address, 500, "amount_desc")
    })
    : null;
```

Remove the existing later duplicate:

```ts
  const secondLayerBudget = input.secondLayerMaxActiveWalletsPerJob ?? 0;
```

- [ ] **Step 5: Update coverage counters and report return**

In `allTimeCoverage`, replace the fixed second-layer zeros with:

```ts
      directWalletsQueuedForIndexing: secondLayerRelationshipProfiles?.queueRequests.length ?? 0,
      secondLayerActiveBudget: secondLayerBudget,
      secondLayerQueued: secondLayerRelationshipProfiles?.counters.queued ?? 0,
      secondLayerComplete: secondLayerRelationshipProfiles?.counters.complete ?? 0,
```

In `coverage`, add:

```ts
    secondLayerRelationshipPaths: secondLayerRelationshipProfiles?.paths.length ?? 0,
    secondLayerRelationshipGroups: secondLayerRelationshipProfiles?.groups.length ?? 0,
```

In the returned report object, add:

```ts
    secondLayerRelationshipProfiles,
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/check/deepForensicCheck.test.ts -t "second-layer relationship|all-time direct boundary"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/check/deepForensicCheck.ts tests/check/deepForensicCheck.test.ts
git commit -m "feat(deepcheck): save indexed relationship second layer"
```

## Task 4: Queue Missing Direct Wallets In Job Runner

**Files:**
- Modify: `src/forensics/deepForensicJob.ts`
- Modify: `src/index.ts`
- Modify: `tests/forensics/deepForensicJob.test.ts`

- [ ] **Step 1: Add failing job-runner queue test**

Append this test near existing all-time DeepCheck job tests:

```ts
  it("queues missing second-layer direct wallets with the deep job id", async () => {
    const sourceJob = job();
    const walletA = "TQueuedSecondLayerA111111111111111";
    const queueAddressUsdtHistory = vi.fn(async (input: {
      address: string;
      coverageMode: "all_time" | "targeted";
      requestedByJobId?: string | null;
      queuedReason: string;
    }) => completeIndexState(input.address, 0, 0));
    const completeForensicCheckJob = vi.fn(async () => true);

    await runSingleDeepForensicJobCycle({
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      claimNextForensicCheckJob: async () => sourceJob,
      completeForensicCheckJob,
      updateForensicCheckJobProgress: vi.fn(async () => true),
      recordRiskEvaluation: vi.fn(async () => undefined),
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      getUsdtRestrictionStatus: async (address) => usdtRestriction(address),
      listIndexedUsdtTransfersForAddress: async (address) => address === sourceJob.subjectAddress
        ? [indexed({ id: "tx-subject-a", from: sourceJob.subjectAddress, to: walletA, amountRaw: "1000000", at: "2026-06-01T00:00:00.000Z" })]
        : [],
      getAddressUsdtIndexState: async () => null,
      queueAddressUsdtHistory
    }, {
      allTimeDeepCheckMode: "strict",
      secondLayerMaxActiveWalletsPerJob: 25
    });

    expect(queueAddressUsdtHistory).toHaveBeenCalledWith(expect.objectContaining({
      address: walletA,
      coverageMode: "all_time",
      requestedByJobId: sourceJob.id,
      queuedReason: "deep_second_layer"
    }));
    expect(completeForensicCheckJob.mock.calls[0][0].resultJson.secondLayerRelationshipProfiles.directWalletStatuses[0]).toMatchObject({
      address: walletA,
      status: "queued",
      queued: true
    });
  });
```

Use existing helper names in `tests/forensics/deepForensicJob.test.ts`; if `completeIndexState`, `indexed`, or `usdtRestriction` already exist with different names, reuse the existing local helpers and keep the assertion unchanged.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm test -- tests/forensics/deepForensicJob.test.ts -t "queues missing second-layer"
```

Expected: FAIL because the runner does not queue `report.secondLayerRelationshipProfiles.queueRequests`.

- [ ] **Step 3: Wire deps and queue requests**

In `src/forensics/deepForensicJob.ts`, import:

```ts
import { markSecondLayerQueued } from "./deepSecondLayerRelationship";
```

After `const report = await runDeepAddressForensicCheck(...)`, add:

```ts
    let secondLayerRelationshipProfiles = report.secondLayerRelationshipProfiles ?? null;
    if (secondLayerRelationshipProfiles && deps.queueAddressUsdtHistory) {
      const queuedAddresses = new Set<string>();
      for (const request of secondLayerRelationshipProfiles.queueRequests) {
        await deps.queueAddressUsdtHistory({
          address: request.address,
          coverageMode: request.coverageMode,
          requestedByJobId: job.id,
          queuedReason: request.queuedReason
        });
        queuedAddresses.add(request.address);
      }
      secondLayerRelationshipProfiles = markSecondLayerQueued(secondLayerRelationshipProfiles, queuedAddresses);
      report.secondLayerRelationshipProfiles = secondLayerRelationshipProfiles;
      if (report.coverage.allTime) {
        report.coverage.allTime.directWalletsQueuedForIndexing = queuedAddresses.size;
        report.coverage.allTime.secondLayerQueued = secondLayerRelationshipProfiles.counters.queued;
        report.coverage.allTime.secondLayerComplete = secondLayerRelationshipProfiles.counters.complete;
      }
    }
```

In `resultJson`, add:

```ts
        secondLayerRelationshipProfiles: secondLayerRelationshipProfiles,
```

- [ ] **Step 4: Inject index state lookup in `src/index.ts`**

In the `runSingleDeepForensicJobCycle` deps object, add:

```ts
      getAddressUsdtIndexState: (address) => getTronAddressUsdtIndexState(db, {
        address,
        coverageMode: "all_time",
        targetTimestamp: null
      }),
```

Keep the existing `queueAddressUsdtHistory` priority rule and add `deep_second_layer` priority:

```ts
        priority: input.queuedReason === "deep_subject" ? 100 : input.queuedReason === "deep_second_layer" ? 50 : 10,
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/deepForensicJob.test.ts -t "queues missing second-layer"
npm test -- tests/check/deepForensicCheck.test.ts -t "second-layer relationship"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/deepForensicJob.ts src/index.ts tests/forensics/deepForensicJob.test.ts
git commit -m "feat(deepcheck): queue relationship second-layer indexes"
```

## Task 5: Add Completed DeepCheck Patch Repository Functions

**Files:**
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`

- [ ] **Step 1: Add failing repository tests**

Append to `tests/storage/forensicCheckJobs.test.ts`:

```ts
  it("patches completed deep-check result json without completing the job again", async () => {
    const { db, queries } = createMockDb();
    await updateCompletedDeepCheckResultPatch(db, {
      id: "job-1",
      resultJson: { subjectAddress: "TSubject111111111111111111111111111111", secondLayerRelationshipProfiles: { version: 1 } },
      progressJson: { secondLayerQueued: 0, secondLayerComplete: 1 }
    });

    expect(queries[0].sql).toContain("update forensic_check_jobs");
    expect(queries[0].sql).toContain("status = 'completed'");
    expect(queries[0].sql).toContain("kind = 'address_deep_check'");
    expect(queries[0].sql).not.toContain("completed_at = now()");
    expect(queries[0].params).toEqual([
      "job-1",
      { subjectAddress: "TSubject111111111111111111111111111111", secondLayerRelationshipProfiles: { version: 1 } },
      { secondLayerQueued: 0, secondLayerComplete: 1 }
    ]);
  });

  it("lists completed deep-check jobs with pending second-layer refresh", async () => {
    const { db, queries } = createMockDb();
    await listCompletedDeepCheckJobsWithPendingSecondLayer(db, { limit: 10 });

    expect(queries[0].sql).toContain("kind = 'address_deep_check'");
    expect(queries[0].sql).toContain("status = 'completed'");
    expect(queries[0].sql).toContain("secondLayerRelationshipProfiles");
    expect(queries[0].params).toEqual([10]);
  });
```

Add imports:

```ts
  listCompletedDeepCheckJobsWithPendingSecondLayer,
  updateCompletedDeepCheckResultPatch,
```

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts -t "second-layer"
```

Expected: FAIL because the functions are not exported.

- [ ] **Step 3: Implement repository functions**

Add to `src/storage/repositories.ts` after `completeForensicCheckJob`:

```ts
export async function updateCompletedDeepCheckResultPatch(
  db: Db,
  input: {
    id: string;
    resultJson: Record<string, unknown>;
    progressJson: Record<string, unknown>;
  }
): Promise<boolean> {
  const result = await db.query(
    `update forensic_check_jobs
     set result_json = $2,
       progress_json = progress_json || $3,
       updated_at = now()
     where id = $1
       and kind = 'address_deep_check'
       and status = 'completed'`,
    [input.id, input.resultJson, input.progressJson]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCompletedDeepCheckJobsWithPendingSecondLayer(
  db: Db,
  input: { limit: number }
): Promise<ForensicCheckJob[]> {
  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     where kind = 'address_deep_check'
       and status = 'completed'
       and (
         coalesce((result_json #>> '{secondLayerRelationshipProfiles,counters,queued}')::int, 0) > 0
         or coalesce((result_json #>> '{secondLayerRelationshipProfiles,counters,notIndexed}')::int, 0) > 0
       )
     order by updated_at asc
     limit $1`,
    [input.limit]
  );
  return result.rows.map(mapForensicCheckJobRow);
}
```

- [ ] **Step 4: Run repository tests**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts -t "second-layer"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/storage/repositories.ts tests/storage/forensicCheckJobs.test.ts
git commit -m "feat(deepcheck): patch completed second-layer results"
```

## Task 6: Add Idempotent Second-Layer Refresh

**Files:**
- Create: `src/forensics/deepSecondLayerRefresh.ts`
- Create: `tests/forensics/deepSecondLayerRefresh.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing refresh tests**

Create `tests/forensics/deepSecondLayerRefresh.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { refreshDeepCheckSecondLayerFromIndex } from "../../src/forensics/deepSecondLayerRefresh";
import type { ForensicCheckJob } from "../../src/storage/repositories";

const subject = "TSubject111111111111111111111111111111";
const walletA = "TWalletA111111111111111111111111111111";
const walletB = "TWalletB111111111111111111111111111111";

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: subject,
    status: "completed",
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2026-07-03T00:00:00.000Z"),
    priority: 0,
    chatId: null,
    messageId: null,
    requestedBy: null,
    progressJson: {},
    resultJson: {
      subjectAddress: subject,
      directCounterpartyInteractionProfiles: [{
        subjectAddress: subject,
        direction: "outbound",
        counterpartyAddress: walletA,
        volumeRaw: "1000000",
        txCount: 1
      }],
      secondLayerRelationshipProfiles: {
        version: 1,
        source: "deepcheck_relationship_expansion_v1",
        generatedAt: "2026-07-03T00:00:00.000Z",
        subjectAddress: subject,
        directWalletStatuses: [{ address: walletA, status: "queued", queued: true }],
        paths: [],
        groups: [],
        counters: { queued: 1, notIndexed: 0, complete: 0 },
        limits: {
          maxDirectWalletsConsidered: 10,
          maxExpandedDirectWallets: 10,
          maxSecondHopNeighborsPerDirectWallet: 2,
          maxTotalSecondHopEdges: 10,
          highDegreeSuppressionThreshold: 50
        },
        queueRequests: []
      }
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    startedAt: new Date("2026-07-03T00:00:00.000Z"),
    completedAt: new Date("2026-07-03T00:00:00.000Z"),
    ...overrides
  };
}

describe("refreshDeepCheckSecondLayerFromIndex", () => {
  it("patches completed deep-check job when queued wallet index is complete", async () => {
    const patch = vi.fn(async () => true);
    const result = await refreshDeepCheckSecondLayerFromIndex({
      jobId: "job-1",
      getJob: async () => job(),
      patchCompletedJob: patch,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getIndexState: async () => ({
        status: "complete",
        statusReason: "complete_provider_windowed",
        coverageMode: "all_time",
        fetchedTransferCount: 1,
        uniqueCounterpartyCount: 1
      } as never),
      listIndexedEdges: async () => [{
        id: "tx-a-b",
        fromAddress: walletA,
        toAddress: walletB,
        txHash: "tx-a-b",
        amountRaw: "1000000",
        timestamp: new Date("2026-06-01T00:00:00.000Z"),
        method: "transfer",
        edgeType: "normal_transfer"
      }]
    });

    expect(result).toMatchObject({ status: "refreshed", expanded: 1 });
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({
      id: "job-1",
      resultJson: expect.objectContaining({
        secondLayerRelationshipProfiles: expect.objectContaining({
          paths: [expect.objectContaining({ pathAddresses: [subject, walletA, walletB] })]
        })
      })
    }));
  });

  it("does not patch non-completed jobs", async () => {
    const patch = vi.fn(async () => true);
    const result = await refreshDeepCheckSecondLayerFromIndex({
      jobId: "job-1",
      getJob: async () => job({ status: "running" }),
      patchCompletedJob: patch,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getIndexState: async () => null,
      listIndexedEdges: async () => []
    });

    expect(result).toEqual({ status: "skipped", reason: "job_not_completed_deepcheck" });
    expect(patch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run refresh tests and verify failure**

Run:

```powershell
npm test -- tests/forensics/deepSecondLayerRefresh.test.ts
```

Expected: FAIL because the refresh module does not exist.

- [ ] **Step 3: Implement refresh helper**

Create `src/forensics/deepSecondLayerRefresh.ts`:

```ts
import { buildSecondLayerRelationshipProfiles } from "./deepSecondLayerRelationship";
import type { ForensicCheckJob } from "../storage/repositories";
import type {
  AddressLabel,
  DirectCounterpartyInteractionProfile,
  ForensicRouteEdge,
  ServiceClassification,
  TronAddressUsdtIndexState
} from "../types";

type RefreshDeps = {
  jobId: string;
  getJob(id: string): Promise<ForensicCheckJob | null>;
  patchCompletedJob(input: { id: string; resultJson: Record<string, unknown>; progressJson: Record<string, unknown> }): Promise<boolean>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getIndexState(address: string): Promise<TronAddressUsdtIndexState | null>;
  listIndexedEdges(address: string): Promise<ForensicRouteEdge[]>;
};

type RefreshResult =
  | { status: "refreshed"; expanded: number; queued: number; notIndexed: number }
  | { status: "skipped"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function directProfiles(resultJson: Record<string, unknown>): DirectCounterpartyInteractionProfile[] {
  const value = resultJson.directCounterpartyInteractionProfiles;
  return Array.isArray(value) ? value.filter(isRecord) as DirectCounterpartyInteractionProfile[] : [];
}

export async function refreshDeepCheckSecondLayerFromIndex(deps: RefreshDeps): Promise<RefreshResult> {
  const job = await deps.getJob(deps.jobId);
  if (!job || job.kind !== "address_deep_check" || job.status !== "completed") {
    return { status: "skipped", reason: "job_not_completed_deepcheck" };
  }
  if (!isRecord(job.resultJson)) return { status: "skipped", reason: "missing_result_json" };
  const current = isRecord(job.resultJson.secondLayerRelationshipProfiles)
    ? job.resultJson.secondLayerRelationshipProfiles
    : null;
  if (!current) return { status: "skipped", reason: "missing_second_layer_profile" };
  const statuses = Array.isArray(current.directWalletStatuses) ? current.directWalletStatuses.filter(isRecord) : [];
  const pendingAddresses = statuses
    .filter((status) => status.status === "queued" || status.status === "not_indexed")
    .map((status) => typeof status.address === "string" ? status.address : null)
    .filter((address): address is string => Boolean(address));
  if (pendingAddresses.length === 0) return { status: "skipped", reason: "no_pending_second_layer_wallets" };

  const classifications = new Map<string, ServiceClassification | null>();
  for (const address of pendingAddresses) {
    classifications.set(address, await deps.getClassificationForAddress(address));
  }
  const limits = isRecord(current.limits) ? current.limits as never : undefined;
  const rebuilt = await buildSecondLayerRelationshipProfiles({
    subjectAddress: job.subjectAddress,
    directBoundaryAddresses: pendingAddresses,
    directCounterpartyProfiles: directProfiles(job.resultJson),
    classifications,
    limits,
    getIndexState: deps.getIndexState,
    listIndexedEdges: deps.listIndexedEdges
  });
  const retainedStatuses = statuses.filter((status) =>
    typeof status.address === "string" && !pendingAddresses.includes(status.address)
  );
  const retainedPaths = Array.isArray(current.paths) ? current.paths : [];
  const retainedGroups = Array.isArray(current.groups) ? current.groups : [];
  const nextProfile = {
    ...current,
    generatedAt: rebuilt.generatedAt,
    directWalletStatuses: [...retainedStatuses, ...rebuilt.directWalletStatuses],
    paths: [...retainedPaths, ...rebuilt.paths],
    groups: [...retainedGroups, ...rebuilt.groups],
    counters: {
      ...rebuilt.counters,
      directWalletsTotal: retainedStatuses.length + rebuilt.counters.directWalletsTotal,
      directWalletsConsidered: retainedStatuses.length + rebuilt.counters.directWalletsConsidered
    },
    queueRequests: rebuilt.queueRequests
  };
  const resultJson = { ...job.resultJson, secondLayerRelationshipProfiles: nextProfile };
  await deps.patchCompletedJob({
    id: job.id,
    resultJson,
    progressJson: {
      secondLayerQueued: nextProfile.counters.queued,
      secondLayerComplete: nextProfile.counters.complete,
      secondLayerRefreshedAt: rebuilt.generatedAt
    }
  });
  return {
    status: "refreshed",
    expanded: rebuilt.counters.expanded,
    queued: rebuilt.counters.queued,
    notIndexed: rebuilt.counters.notIndexed
  };
}
```

- [ ] **Step 4: Run refresh tests**

Run:

```powershell
npm test -- tests/forensics/deepSecondLayerRefresh.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add bounded background sweep in `src/index.ts`**

Import repository functions and helper:

```ts
  getForensicCheckJob,
  listCompletedDeepCheckJobsWithPendingSecondLayer,
  updateCompletedDeepCheckResultPatch,
```

```ts
import { refreshDeepCheckSecondLayerFromIndex } from "./forensics/deepSecondLayerRefresh";
```

Add helper near `runForensicJobsOnce`:

```ts
async function refreshDeepCheckSecondLayerOnce(limit = 5): Promise<number> {
  const jobs = await listCompletedDeepCheckJobsWithPendingSecondLayer(db, { limit });
  let refreshed = 0;
  for (const job of jobs) {
    const result = await refreshDeepCheckSecondLayerFromIndex({
      jobId: job.id,
      getJob: (id) => getForensicCheckJob(db, id),
      patchCompletedJob: (input) => updateCompletedDeepCheckResultPatch(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getClassificationForAddress: async (address) => {
        const metadata = await getCachedOrLiveAddressMetadata(address);
        const contractProfile = metadata?.isContract === true
          ? await getCachedOrLiveContractIntelligenceProfile(address).catch(() => null)
          : null;
        return classifyServiceAddress({ address, metadata, contractProfile });
      },
      getIndexState: (address) => getTronAddressUsdtIndexState(db, {
        address,
        coverageMode: "all_time",
        targetTimestamp: null
      }),
      listIndexedEdges: async (address) => {
        const rows = await listIndexedTronUsdtTransfersForAddress(db, {
          address,
          minTimestamp: new Date(0),
          maxTimestamp: new Date(),
          limit: 500,
          orderBy: "amount_desc",
          direction: "both"
        });
        return rows.map(indexedTransferToRouteEdge);
      }
    });
    if (result.status === "refreshed") refreshed += 1;
  }
  return refreshed;
}
```

At the end of `runForensicJobsOnce`, after `runForensicJobBatch`, call the sweep:

```ts
  const processed = await runForensicJobBatch({ ... });
  await refreshDeepCheckSecondLayerOnce().catch((error) => {
    logger.warn("deep_second_layer_refresh_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
  return processed;
```

If `runForensicJobsOnce` currently returns directly, convert it to the `processed` local variable shape without changing queue claim logic.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/deepSecondLayerRefresh.ts tests/forensics/deepSecondLayerRefresh.test.ts src/index.ts
git commit -m "feat(deepcheck): refresh queued relationship second layer"
```

## Task 7: Project Second-Layer Relationships In Admin Graph

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing Admin projection test**

Append near the existing `projects saved deep-check extended paths` test:

```ts
  it("projects DeepCheck relationship second-layer paths, groups, and statuses", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 },
        secondLayerRelationshipProfiles: {
          version: 1,
          source: "deepcheck_relationship_expansion_v1",
          generatedAt: "2026-07-03T00:00:00.000Z",
          subjectAddress: subject,
          directWalletStatuses: [
            { id: "status-a", address: walletA, status: "grouped", reason: null, limitationCode: null, queued: false, directTxCount: 1, directVolumeRaw: "1000000", index: { status: "complete" } },
            { id: "status-q", address: "TQueued111111111111111111111111111", status: "queued", reason: "queued_for_indexing", limitationCode: "deep_second_layer_queued", queued: true, directTxCount: 1, directVolumeRaw: "1", index: { status: "queued" } }
          ],
          paths: [{
            id: "path-a-b",
            pathAddresses: [subject, walletA, walletB],
            anchorAddress: walletA,
            neighborAddress: walletB,
            direction: "outbound",
            txHashes: ["tx-a-b"],
            amountRaw: "1000000",
            txCount: 1,
            firstTransferAt: "2026-06-01T00:00:00.000Z",
            lastTransferAt: "2026-06-01T00:00:00.000Z",
            selectionReason: "top_amount_or_activity",
            source: "deepcheck_relationship_second_hop",
            depth: 2
          }],
          groups: [{
            id: "group-a-tail",
            anchorAddress: walletA,
            kind: "low_signal_neighbors",
            label: "1 low-signal neighbors",
            memberCount: 1,
            totalAmountRaw: "100",
            txCount: 1,
            members: [{ address: "TTail111111111111111111111111111111", amountRaw: "100", txCount: 1, txHashes: ["tx-tail"] }]
          }],
          counters: { directWalletsTotal: 2, directWalletsConsidered: 2, eligible: 1, expanded: 1, grouped: 1, stopped: 0, noMeaningfulSecondHop: 0, notIndexed: 0, queued: 1, complete: 1, maxSavedDepth: 2 },
          limits: {}
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${walletA}`,
        toNodeId: `addr:${walletB}`,
        metadata: expect.objectContaining({
          source: "deepcheck_relationship_second_hop",
          relationship: "second_hop_edge",
          pathId: "path-a-b"
        })
      })
    ]));
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "group:deep_second_layer:group-a-tail",
        kind: "group",
        displayKind: "collapsed_group",
        metadata: expect.objectContaining({ groupReason: "deep_second_layer_low_signal_neighbors" })
      }),
      expect.objectContaining({
        address: "TQueued111111111111111111111111111",
        metadata: expect.objectContaining({ secondLayerStatus: "queued" })
      })
    ]));
    expect(result.graph.summary.layerSummary?.deepCheckCoverage).toMatchObject({
      secondLayerRelationshipPaths: 1,
      secondLayerRelationshipGroups: 1,
      secondLayerQueued: 1,
      secondLayerComplete: 1,
      maxSavedDepth: 2
    });
  });
```

- [ ] **Step 2: Run projection test and verify failure**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts -t "relationship second-layer"
```

Expected: FAIL because Admin ignores `secondLayerRelationshipProfiles`.

- [ ] **Step 3: Add projection block**

In `projectAddressDeepJob`, read the block:

```ts
  const secondLayerProfile = isRecord(result["secondLayerRelationshipProfiles"]) ? result["secondLayerRelationshipProfiles"] : null;
```

After extended profile projection, add loops that:

```ts
  if (secondLayerProfile) {
    recordArrayField(secondLayerProfile, "directWalletStatuses").forEach((status) => {
      const address = stringField(status, "address");
      if (!address) return;
      upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
        source: "deepcheck_relationship_second_layer",
        secondLayerStatus: stringField(status, "status"),
        secondLayerReason: stringField(status, "reason"),
        limitationCode: stringField(status, "limitationCode"),
        queued: booleanField(status, "queued"),
        index: isRecord(status["index"]) ? status["index"] : null
      });
    });

    recordArrayField(secondLayerProfile, "paths").forEach((path, pathIndex) => {
      const addresses = deepCheckPathAddresses(path, subjectAddress);
      if (addresses.length < 3) return;
      const pathId = stringField(path, "id") ?? `path:deep_second_layer:${pathIndex}`;
      const nodeIds = addresses.map((address) => upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
        source: "deepcheck_relationship_second_layer",
        hopDepth: address === subjectAddress ? 0 : addresses.indexOf(address),
        secondLayerPathId: pathId
      }));
      const txHashes = stringArrayField(path, "txHashes");
      const edgeIds: string[] = [];
      for (let edgeIndex = 0; edgeIndex < nodeIds.length - 1; edgeIndex += 1) {
        const edgeId = `edge:deep_second_layer:${pathId}:${edgeIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId: nodeIds[edgeIndex],
          toNodeId: nodeIds[edgeIndex + 1],
          type: "inferred_provenance",
          amountRaw: stringField(path, "amountRaw"),
          amountShare: null,
          txHash: txHashes[edgeIndex] ?? null,
          timestamp: edgeIndex === 0 ? stringField(path, "firstTransferAt") : stringField(path, "lastTransferAt"),
          weight: null,
          verdict: "review",
          evidenceIds: [],
          metadata: {
            source: "deepcheck_relationship_second_hop",
            evidenceType: "deepcheck_relationship_second_hop",
            relationship: edgeIndex === 0 ? "direct_subject_edge" : "second_hop_edge",
            pathId,
            edgeIndex,
            depth: numberField(path, "depth") ?? 2,
            txCount: numberField(path, "txCount"),
            selectionReason: stringField(path, "selectionReason")
          }
        });
        edgeIds.push(edgeId);
      }
      paths.push({
        id: pathId,
        nodeIds,
        edgeIds,
        verdict: "REVIEW",
        riskContribution: 0,
        amountRaw: stringField(path, "amountRaw"),
        amountShare: null,
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: []
      });
    });

    recordArrayField(secondLayerProfile, "groups").forEach((group) => {
      const groupId = stringField(group, "id");
      const anchor = stringField(group, "anchorAddress");
      if (!groupId || !anchor) return;
      const anchorNodeId = upsertNode(anchor, "wallet", { source: "deepcheck_relationship_second_layer" });
      const graphGroupId = `group:deep_second_layer:${groupId}`;
      nodesById.set(graphGroupId, {
        id: graphGroupId,
        address: null,
        kind: "group",
        label: stringField(group, "label") ?? `${numberField(group, "memberCount") ?? 0} second-hop neighbors`,
        riskLevel: null,
        confidence: null,
        weight: null,
        displayKind: "collapsed_group",
        metadata: {
          source: "deepcheck_relationship_second_layer",
          groupReason: `deep_second_layer_${stringField(group, "kind") ?? "group"}`,
          realGroupKind: "deep_second_layer_group",
          collapsedCount: numberField(group, "memberCount"),
          members: recordArrayField(group, "members")
        }
      });
      edges.push({
        id: `edge:deep_second_layer_group:${groupId}`,
        fromNodeId: anchorNodeId,
        toNodeId: graphGroupId,
        type: "inferred_provenance",
        amountRaw: stringField(group, "totalAmountRaw"),
        amountShare: null,
        txHash: null,
        timestamp: null,
        weight: null,
        verdict: "review",
        evidenceIds: [],
        metadata: {
          source: "deepcheck_relationship_second_hop",
          evidenceType: "deepcheck_second_layer_group",
          relationship: "grouped_tail",
          groupId,
          groupKind: stringField(group, "kind"),
          aggregateTransferCount: numberField(group, "txCount")
        }
      });
    });
  }
```

Use existing local fields on `AdminForensicsNode`; if TypeScript rejects `displayKind`, check current group-node construction and use the same property shape.

- [ ] **Step 4: Add summary counters**

When building `deepProjectionFacts`, add:

```ts
    secondLayerRelationshipPaths: secondLayerProfile ? recordArrayField(secondLayerProfile, "paths").length : 0,
    secondLayerRelationshipGroups: secondLayerProfile ? recordArrayField(secondLayerProfile, "groups").length : 0,
    secondLayerQueued: firstNumber(
      secondLayerProfile && isRecord(secondLayerProfile["counters"]) ? numberField(secondLayerProfile["counters"], "queued") : null,
      allTimeCoverage ? numberField(allTimeCoverage, "secondLayerQueued") : null
    ),
    secondLayerComplete: firstNumber(
      secondLayerProfile && isRecord(secondLayerProfile["counters"]) ? numberField(secondLayerProfile["counters"], "complete") : null,
      allTimeCoverage ? numberField(allTimeCoverage, "secondLayerComplete") : null
    )
```

Update `deepCheckCoverageSummary` to expose `secondLayerRelationshipPaths` and `secondLayerRelationshipGroups`.

- [ ] **Step 5: Run projection tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts -t "relationship second-layer|saved deep-check extended paths"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat(admin): project DeepCheck relationship second layer"
```

## Task 8: Admin UI Styling, Legend, Status, And Manual Refresh

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `src/admin/adminServer.ts`
- Modify: `src/index.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add failing Admin Console tests**

In `tests/admin/adminConsole.test.ts`, add:

```ts
  it("styles DeepCheck relationship second-hop edges distinctly", () => {
    const html = adminConsoleHtml();
    expect(html).toContain(".edge.edge-deep-second-hop");
    expect(html).toContain(".edge.edge-deep-queued");
    expect(html).toContain('item("secondhop", "Second-hop edge")');
    expect(html).toContain('item("queued", "Queued / not indexed")');
  });
```

- [ ] **Step 2: Run the UI test and verify failure**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "relationship second-hop"
```

Expected: FAIL because classes and legend entries do not exist.

- [ ] **Step 3: Add CSS and edge class mapping**

In `src/admin/adminConsole.ts`, add CSS near existing DeepCheck edge styles:

```css
    .edge.edge-deep-second-hop { stroke: #7ee7d6; stroke-dasharray: 4 6; opacity: .92; }
    .edge.edge-deep-second-hop.selected { stroke: #b9fff4; opacity: 1; filter: drop-shadow(0 0 12px rgba(126, 231, 214, .38)); }
    .edge.edge-deep-queued { stroke: #f0c76a; stroke-dasharray: 2 8; opacity: .82; }
```

In `edgeExtraClass`, add before the `deepcheck_extended_path` branch:

```js
        if (evidenceType === "deepcheck_relationship_second_hop") {
          classes.push(edge?.metadata?.relationship === "direct_subject_edge" ? "edge-deep-extended-path" : "edge-deep-second-hop");
        } else if (evidenceType === "deepcheck_second_layer_group") {
          classes.push("edge-deep-grouped-transfer");
        }
```

- [ ] **Step 4: Update legend and status text**

In `graphLegendHtml`, update the `deep_branch_map` legend:

```js
        item("direct", "Direct subject edge") +
        item("secondhop", "Second-hop edge") +
        item("extended", "Extended path edge") +
        item("cross", "Cross-wallet edge") +
        item("group", "Grouped tail") +
        item("queued", "Queued / not indexed") +
        item("boundary", "Service / stopped edge") +
        item("contract", "Contract context") +
```

Add swatches:

```css
    .legend-swatch.secondhop { border-color: #7ee7d6; border-top-style: dashed; }
    .legend-swatch.queued { border-color: #f0c76a; border-top-style: dotted; }
```

In `walletDetailBlock` or selected node metadata rendering, add a metric when present:

```js
        (node?.metadata?.secondLayerStatus ? metric("Second layer", node.metadata.secondLayerStatus, "wide") : "") +
```

- [ ] **Step 5: Add manual refresh endpoint**

In `src/admin/adminServer.ts`, add to `AdminServerDeps`:

```ts
  refreshDeepCheckSecondLayer?: (jobId: string) => Promise<{ status: string; reason?: string; expanded?: number; queued?: number; notIndexed?: number }>;
```

Add route before the `/admin/forensics` GET handler:

```ts
  if (request.method === "POST" && url.pathname === "/admin/forensics/refresh-second-layer") {
    const jobId = url.searchParams.get("jobId");
    if (!jobId || !deps.refreshDeepCheckSecondLayer) {
      writeJson(response, 400, { ok: false, error: "missing_job_id_or_refresh_handler" });
      return;
    }
    const result = await deps.refreshDeepCheckSecondLayer(jobId);
    writeJson(response, 200, { ok: true, result });
    return;
  }
```

In `src/index.ts`, inject:

```ts
  refreshDeepCheckSecondLayer: async (jobId) => refreshDeepCheckSecondLayerFromIndex({
    jobId,
    getJob: (id) => getForensicCheckJob(db, id),
    patchCompletedJob: (input) => updateCompletedDeepCheckResultPatch(db, input),
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getClassificationForAddress: async (address) => {
      const metadata = await getCachedOrLiveAddressMetadata(address);
      const contractProfile = metadata?.isContract === true
        ? await getCachedOrLiveContractIntelligenceProfile(address).catch(() => null)
        : null;
      return classifyServiceAddress({ address, metadata, contractProfile });
    },
    getIndexState: (address) => getTronAddressUsdtIndexState(db, { address, coverageMode: "all_time", targetTimestamp: null }),
    listIndexedEdges: async (address) => {
      const rows = await listIndexedTronUsdtTransfersForAddress(db, {
        address,
        minTimestamp: new Date(0),
        maxTimestamp: new Date(),
        limit: 500,
        orderBy: "amount_desc",
        direction: "both"
      });
      return rows.map(indexedTransferToRouteEdge);
    }
  }),
```

- [ ] **Step 6: Add button to Admin UI**

Add a graph action button:

```html
<button id="refreshSecondLayer" title="Refresh DeepCheck second layer from completed local indexes">Refresh second layer</button>
```

Add handler:

```js
    async function refreshSecondLayer() {
      const jobId = state.graph?.job?.id;
      if (!jobId || state.graph?.job?.kind !== "address_deep_check") {
        setStatus("Select a completed DeepCheck job first.");
        return;
      }
      const response = await fetch("/admin/forensics/refresh-second-layer?jobId=" + encodeURIComponent(jobId), { method: "POST" });
      const body = await response.json();
      if (!body.ok) {
        setStatus("Second layer refresh failed.");
        return;
      }
      setStatus("Second layer refresh: " + body.result.status);
      await loadJob(jobId);
    }
```

Wire:

```js
    el("refreshSecondLayer").addEventListener("click", refreshSecondLayer);
```

- [ ] **Step 7: Run Admin tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "relationship second-hop|graph legend"
npm test -- tests/admin/adminServer.test.ts -t "refresh-second-layer"
```

Expected: PASS. If the adminServer test is new, assert route status `200` with a mocked `refreshDeepCheckSecondLayer`.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts src/admin/adminServer.ts src/index.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "feat(admin): show DeepCheck relationship second layer"
```

## Task 9: Documentation And Final Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-03-deepcheck-relationship-expansion-v1-design.md`
- Modify if present: `docs/knowledge/06-deepcheck.md`

- [ ] **Step 1: Update docs with implemented names**

In the spec, replace tentative names with actual exported names if they differ from this plan. If `docs/knowledge/06-deepcheck.md` exists in the active branch, add a short "Relationship expansion v1" section:

```md
## Relationship Expansion v1

DeepCheck stores `secondLayerRelationshipProfiles` for the factual relationship
second layer around the checked wallet. Each direct wallet has a status:
expanded, grouped, stopped_service_boundary, stopped_high_degree,
no_meaningful_second_hop, not_indexed, or queued.

Queued second-layer wallets use the local TRON USDT address index with
`queuedReason=deep_second_layer`. Refresh updates the completed DeepCheck
result JSON without changing the job lifecycle.
```

- [ ] **Step 2: Run focused test groups**

Run:

```powershell
npm test -- tests/forensics/deepSecondLayerRelationship.test.ts tests/forensics/deepSecondLayerRefresh.test.ts tests/check/deepForensicCheck.test.ts tests/forensics/deepForensicJob.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/storage/forensicCheckJobs.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm test
npm run typecheck
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Inspect git status**

Run:

```powershell
git status --short --branch
```

Expected: only intended files modified; unrelated `tmp/` may remain untracked and must not be staged.

- [ ] **Step 5: Commit docs/final adjustments**

```powershell
git add docs/superpowers/specs/2026-07-03-deepcheck-relationship-expansion-v1-design.md docs/knowledge/06-deepcheck.md
git commit -m "docs: document DeepCheck relationship expansion"
```

If `docs/knowledge/06-deepcheck.md` does not exist on the active branch, stage only the spec update:

```powershell
git add docs/superpowers/specs/2026-07-03-deepcheck-relationship-expansion-v1-design.md
git commit -m "docs: document DeepCheck relationship expansion"
```

## Final Safety Notes

- Do not stop, restart, or modify the live Where/Incoming/TronScan worker while implementing this plan.
- Do not use `git reset --hard` or revert unrelated dirty files.
- Do not stage `tmp/`.
- Keep every implementation commit scoped to the task that produced it.
- The final branch should include tests, typecheck, and `git diff --check` output in the handoff.
