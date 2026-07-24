# Unified Wallet Check P0 Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove provider/queue/checkpoint amplification from Unified traversal while preserving frozen facts, score, hashes, forensic semantics, and single-message delivery.

**Architecture:** Split snapshot-bounded address-history acquisition from episode attribution. A traversal coordinator creates deduplicated `address_history` tasks, consumes immutable history manifests, and persists only delta-chain heads plus a bounded working set. A fair four-slot event-driven pool executes provider tasks; Fast/direct hard evidence starts after direct history without gaining finalization or delivery authority.

**Tech Stack:** TypeScript 5.7, Node.js, PostgreSQL, Vitest, existing TronScan scheduler, canonical JSON/SHA-256 artifacts.

**Design:** `docs/superpowers/specs/2026-07-24-unified-wallet-check-traversal-performance-design.md`

---

## File map

- Create `src/unifiedCheck/addressHistory.ts`: manifest identity, checkpoint,
  canonical manifest construction and validation.
- Create `src/unifiedCheck/traversalDelta.ts`: V2 coordinator checkpoint,
  append-only delta artifacts, replay and V1 upgrade.
- Create `src/unifiedCheck/providerPool.ts`: event-driven bounded worker pool.
- Create `src/unifiedCheck/performanceMetrics.ts`: P0 diagnostic counters and
  measurement envelope that never enters analysis hashes.
- Modify `src/unifiedCheck/productionTraversal.ts`: coordinator-only
  attribution over completed address-history manifests.
- Modify `src/unifiedCheck/productionRuntime.ts`: address-history handler,
  runtime pool entry points and parallel branch loading.
- Modify `src/unifiedCheck/repository.ts`: dynamic child task creation,
  prerequisites, inter-run fair claim, compact timing fields and progress
  reads.
- Modify `src/unifiedCheck/productionBranches.ts`: allow Fast/direct evidence
  after direct history while Where/Deep continue to require traversal.
- Modify `src/runtime/startupSchedule.ts` and `src/index.ts`: replace duplicate
  interval pacing with one event-driven provider pool plus safety wake-up.
- Modify `src/config.ts`: provider slot and logical chunk operational config.
- Test in focused `tests/unified-check/*` and `tests/runtime/*` files.
- Update `docs/knowledge/03-job-lifecycle.md`,
  `04-data-sources-tronscan-indexing.md`, `09-current-decisions.md` and
  `10-open-problems.md` after behavior is implemented.

### Task 1: Lock deterministic P0 baseline identity and diagnostic schema

**Files:**
- Create: `src/unifiedCheck/performanceMetrics.ts`
- Create: `tests/unified-check/performanceMetrics.test.ts`
- Create: `tests/fixtures/unified-check/performanceBenchmark.ts`

- [ ] **Step 1: Write the failing benchmark identity and counter tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  buildUnifiedPerformanceBenchmarkManifest,
  createUnifiedPerformanceCounters,
  patchUnifiedPerformanceCounters
} from "../../src/unifiedCheck/performanceMetrics";
import { PERFORMANCE_CASE } from "../fixtures/unified-check/performanceBenchmark";

describe("Unified P0 performance identity", () => {
  it("keeps deterministic semantic identity separate from measurements", () => {
    const left = buildUnifiedPerformanceBenchmarkManifest(PERFORMANCE_CASE);
    const right = buildUnifiedPerformanceBenchmarkManifest({
      ...PERFORMANCE_CASE,
      runtimeCommit: "b".repeat(40)
    });
    expect(left.semanticIdentitySha256).toBe(right.semanticIdentitySha256);
    expect(left.executionIdentitySha256).not.toBe(right.executionIdentitySha256);
    expect(left.runId).toBe("perf:tpcp:v1");
    expect(left.frozenClockIso).toBe("2026-07-24T00:00:00.000Z");
  });

  it("accumulates counters without exposing key material", () => {
    const counters = patchUnifiedPerformanceCounters(
      createUnifiedPerformanceCounters(),
      { providerCalls: 2, networkFetches: 1, maxInFlight: 2 }
    );
    expect(counters).toMatchObject({
      providerCalls: 2,
      networkFetches: 1,
      maxInFlight: 2
    });
    expect(JSON.stringify(counters)).not.toContain("apiKey");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npm test -- tests/unified-check/performanceMetrics.test.ts
```

Expected: FAIL because `performanceMetrics.ts` does not exist.

- [ ] **Step 3: Implement deterministic identity and additive counters**

```typescript
export type UnifiedPerformanceCountersV1 = {
  providerCalls: number;
  networkFetches: number;
  providerCacheHits: number;
  addressManifestReuses: number;
  addressHistoryReplaysAvoided: number;
  taskClaims: number;
  checkpoints: number;
  logicalChunks: number;
  dbWrites: number;
  checkpointBytes: number;
  maxCheckpointBytes: number;
  currentInFlight: number;
  maxInFlight: number;
};

export function createUnifiedPerformanceCounters(): UnifiedPerformanceCountersV1 {
  return {
    providerCalls: 0,
    networkFetches: 0,
    providerCacheHits: 0,
    addressManifestReuses: 0,
    addressHistoryReplaysAvoided: 0,
    taskClaims: 0,
    checkpoints: 0,
    logicalChunks: 0,
    dbWrites: 0,
    checkpointBytes: 0,
    maxCheckpointBytes: 0,
    currentInFlight: 0,
    maxInFlight: 0
  };
}

export function patchUnifiedPerformanceCounters(
  current: UnifiedPerformanceCountersV1,
  patch: Partial<UnifiedPerformanceCountersV1>
): UnifiedPerformanceCountersV1 {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      throw new TypeError("unified_performance_counter_invalid");
    }
    const typed = key as keyof UnifiedPerformanceCountersV1;
    next[typed] = typed === "maxInFlight" || typed === "maxCheckpointBytes"
      ? Math.max(next[typed], value)
      : next[typed] + value;
  }
  return next;
}
```

Implement `buildUnifiedPerformanceBenchmarkManifest()` with canonical hashes:
semantic identity includes frozen run/case ID, clock, snapshot, provider bundle,
label dataset, policies, locale and deterministic ID seed; execution identity
also includes runtime commit, checkpoint version, chunk size and slot count.
Durations stay in a separate measurement envelope.

- [ ] **Step 4: Run GREEN and typecheck**

```powershell
npm test -- tests/unified-check/performanceMetrics.test.ts
npm run typecheck
```

Expected: targeted tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/performanceMetrics.ts tests/unified-check/performanceMetrics.test.ts tests/fixtures/unified-check/performanceBenchmark.ts
git commit -m "test(unified-check): lock deterministic performance identity"
```

### Task 2: Materialize one immutable address history per snapshot/address

**Files:**
- Create: `src/unifiedCheck/addressHistory.ts`
- Create: `tests/unified-check/addressHistory.test.ts`
- Modify: `src/unifiedCheck/productionDirectHistory.ts`

- [ ] **Step 1: Write RED tests for identity, completion and episode-independent reuse**

```typescript
it("uses one manifest key for different funding episodes", () => {
  const first = addressHistoryManifestKey({
    chain: "tron",
    snapshotHash: SHA_A,
    tokenContract: USDT,
    address: ADDRESS.toUpperCase(),
    providerRequestVersion: "tronscan-related-trc20-v1"
  });
  const second = addressHistoryManifestKey({
    chain: "tron",
    snapshotHash: SHA_A,
    tokenContract: USDT,
    address: ADDRESS.toLowerCase(),
    providerRequestVersion: "tronscan-related-trc20-v1"
  });
  expect(first).toBe(second);
});

it("rejects a manifest without a validated exhaustion proof", () => {
  expect(() => buildAddressHistoryManifest({
    ...BASE_INPUT,
    exhaustion: null
  })).toThrow("unified_address_history_exhaustion_missing");
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/addressHistory.test.ts
```

Expected: FAIL because the module and API are absent.

- [ ] **Step 3: Implement the manifest contract**

```typescript
export type AddressHistoryManifestV1 = {
  readonly version: "unified-address-history-manifest-v1";
  readonly schemaVersion: 1;
  readonly key: string;
  readonly address: string;
  readonly snapshotHash: string;
  readonly tokenContract: string;
  readonly providerRequestVersion: string;
  readonly pageArtifactHashes: readonly string[];
  readonly eventInventorySha256: string;
  readonly rawRowCount: number;
  readonly canonicalEventCount: number;
  readonly duplicateCount: number;
  readonly exhaustion: {
    readonly kind: "provider_exhausted" | "account_creation_reached";
    readonly evidenceSha256: string;
  };
};
```

Normalize TRON addresses before hashing. Sort/deduplicate page hashes and
canonical events by existing event identity. Persist
`address_history_page` and `address_history_manifest` artifacts through the
existing content-addressed repository; do not add a new dependency.

- [ ] **Step 4: Verify GREEN and existing direct-history behavior**

```powershell
npm test -- tests/unified-check/addressHistory.test.ts tests/unified-check/productionDirectHistory.test.ts tests/unified-check/directHistory.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/addressHistory.ts src/unifiedCheck/productionDirectHistory.ts tests/unified-check/addressHistory.test.ts
git commit -m "feat(unified-check): add snapshot address history manifests"
```

### Task 3: Replace copied traversal collections with a V2 delta chain

**Files:**
- Create: `src/unifiedCheck/traversalDelta.ts`
- Create: `tests/unified-check/traversalDelta.test.ts`
- Modify: `src/unifiedCheck/productionTraversal.ts`

- [ ] **Step 1: Write RED tests for delta replay and bounded checkpoint size**

```typescript
it("replays deltas to the same coordinator state", () => {
  const initial = initialTraversalCheckpointV2(BINDINGS);
  const one = appendTraversalDelta(initial, {
    addedFrontier: [STATE_A],
    removedFrontierStateIds: [],
    addedVisited: [],
    addedTerminals: [],
    addedSupersededStateIds: [],
    counterDeltas: { expanded: 0, terminal: 0 }
  });
  const two = appendTraversalDelta(one.checkpoint, {
    addedFrontier: [STATE_B],
    removedFrontierStateIds: [traversalStateId(STATE_A)],
    addedVisited: [STATE_A],
    addedTerminals: [],
    addedSupersededStateIds: [],
    counterDeltas: { expanded: 1, terminal: 0 }
  });
  expect(replayTraversalDeltas([one.artifact, two.artifact]).frontier)
    .toEqual([STATE_B]);
});

it("does not grow checkpoint JSON with delta count", () => {
  const checkpoint = applyOneThousandDeltas();
  expect(Buffer.byteLength(JSON.stringify(checkpoint))).toBeLessThan(16_384);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/traversalDelta.test.ts
```

- [ ] **Step 3: Implement V2 checkpoint, deltas and occasional compaction**

```typescript
export type TraversalCheckpointV2 = {
  readonly version: "unified-production-traversal-checkpoint-v2";
  readonly analysisManifestHash: string;
  readonly snapshotHash: string;
  readonly deltaHeadSha256: string | null;
  readonly compactionSha256: string | null;
  readonly pendingAddressHistoryKeys: readonly string[];
  readonly completedAddressHistoryKeys: readonly string[];
  readonly counters: {
    readonly expanded: number;
    readonly terminal: number;
    readonly superseded: number;
  };
  readonly recentDiagnostics: readonly TraversalDiagnosticSample[];
};

export type TraversalDeltaArtifactV1 = {
  readonly version: "unified-traversal-delta-v1";
  readonly previousDeltaHash: string | null;
  readonly addedFrontier: readonly TraversalStateV1[];
  readonly removedFrontierStateIds: readonly string[];
  readonly addedVisited: readonly TraversalStateV1[];
  readonly addedTerminals: readonly UnifiedTraversalTerminalV1[];
  readonly addedSupersededStateIds: readonly string[];
  readonly counterDeltas: {
    readonly expanded: number;
    readonly terminal: number;
    readonly superseded: number;
  };
};
```

Persist every delta before causal checkpoint update. Create a compaction only
after a fixed delta count, bind it to the prior head, and replay from compaction
plus subsequent deltas. Never write a full collection into every checkpoint.

- [ ] **Step 4: Add and test the deterministic V1→V2 upgrader**

The upgrader accepts a validated V1 checkpoint, writes exactly one
`traversal_compaction_v2` and one `traversal_checkpoint_upgrade` artifact, then
returns V2. Calling it again with V2 returns the same checkpoint and writes
nothing.

```powershell
npm test -- tests/unified-check/traversalDelta.test.ts tests/unified-check/productionTraversal.test.ts
```

Expected: PASS including V1 restart and idempotent upgrade cases.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/traversalDelta.ts src/unifiedCheck/productionTraversal.ts tests/unified-check/traversalDelta.test.ts tests/unified-check/productionTraversal.test.ts
git commit -m "refactor(unified-check): persist traversal delta checkpoints"
```

### Task 4: Create deduplicated address-history child tasks

**Files:**
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/unifiedCheck/productionWorker.ts`
- Create: `tests/unified-check/addressHistoryTasks.postgres.test.ts`

- [ ] **Step 1: Write RED PostgreSQL tests**

```typescript
it("creates one mutable task row for one run and manifest key", async () => {
  await Promise.all([
    ensureAddressHistoryTasks(db, TASK_INPUT),
    ensureAddressHistoryTasks(db, TASK_INPUT)
  ]);
  const count = await scalar(db, `
    select count(*)::int
      from unified_check_tasks
     where run_id = $1 and kind = 'address_history' and logical_key = $2
  `, [TASK_INPUT.runId, TASK_INPUT.histories[0]!.manifestKey]);
  expect(count).toBe(1);
});

it("keeps attempts immutable across lease loss", async () => {
  const first = await claimAddressHistory(db, RUN_ID);
  await expireLease(db, first.id);
  const second = await claimAddressHistory(db, RUN_ID);
  expect(second.attempt).toBe(first.attempt + 1);
  expect(await listAttempts(db, first.id)).toEqual([
    expect.objectContaining({ attempt: first.attempt })
  ]);
});

it("does not attribute before required histories complete", async () => {
  await ensureAddressHistoryTasks(db, TASK_INPUT);
  expect(await claimTraversalAttribution(db, RUN_ID)).toBeNull();
  await completeAllAddressHistories(db, RUN_ID);
  expect(await claimTraversalAttribution(db, RUN_ID)).not.toBeNull();
});
```

Assert the exact uniqueness:

```sql
select count(*)
from unified_check_tasks
where run_id = $1
  and kind = 'address_history'
  and logical_key = $2
```

must equal `1`.

- [ ] **Step 2: Verify RED against the PostgreSQL fixture**

```powershell
npm test -- tests/unified-check/addressHistoryTasks.postgres.test.ts
```

- [ ] **Step 3: Add repository APIs without a schema migration**

Reuse the existing unique key `(run_id, kind, logical_key)`:

```typescript
export async function ensureAddressHistoryTasks(
  db: UnifiedQueryable,
  input: {
    runId: string;
    priorityLane: "interactive" | "repair" | "background";
    histories: readonly { taskId: string; manifestKey: string }[];
  }
) {
  return createUnifiedTasks(db, {
    runId: input.runId,
    tasks: input.histories.map((history) => ({
      id: history.taskId,
      kind: "address_history",
      priorityLane: input.priorityLane,
      logicalKey: history.manifestKey
    }))
  });
}
```

Add `loadCompletedAddressHistoryManifests(runId, keys)` and claim prerequisites:
`address_history` requires completed direct history; traversal coordinator may
run to enqueue work, then yields until required manifests complete.

- [ ] **Step 4: Verify GREEN plus causal fencing**

```powershell
npm test -- tests/unified-check/addressHistoryTasks.postgres.test.ts tests/unified-check/productionWorker.test.ts tests/storage/unifiedCheck.postgres.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/repository.ts src/unifiedCheck/productionWorker.ts tests/unified-check/addressHistoryTasks.postgres.test.ts
git commit -m "feat(unified-check): schedule deduplicated address histories"
```

### Task 5: Make attribution address-centric without changing output

**Files:**
- Modify: `src/unifiedCheck/productionTraversal.ts`
- Modify: `src/unifiedCheck/traversal.ts`
- Modify: `tests/unified-check/productionTraversal.test.ts`
- Modify: `tests/unified-check/traversal.test.ts`

- [ ] **Step 1: Write RED equivalence tests**

Build a fixture where two funding episodes share one address history. Compare
the legacy episode-by-episode result with the new coordinator:

```typescript
expect(canonicalize(newResult.terminals)).toEqual(canonicalize(legacy.terminals));
expect(newResult.coverage).toEqual(legacy.coverage);
expect(newResult.eligibleEventIds).toEqual(legacy.eligibleEventIds);
expect(metrics.addressHistoryReplaysAvoided).toBe(1);
expect(loadHistory).toHaveBeenCalledTimes(1);
```

Add reordered episode completion and restart cases.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/productionTraversal.test.ts tests/unified-check/traversal.test.ts
```

- [ ] **Step 3: Implement grouped attribution**

Add a pure function:

```typescript
export function attributeAddressHistory(input: {
  states: readonly TraversalStateV1[];
  events: readonly TraversalEventV1[];
  expandedStateIds: ReadonlySet<string>;
  attributionPolicy: "proportional";
  terminalReason(state: TraversalStateV1):
    { reason: TraversalTerminalReason; evidenceHash: string } | null;
  accountCreationExhausted(address: string): boolean;
}): ReturnType<typeof expandTraversalChunk> {
  return expandTraversalChunk({
    frontier: mergeTraversalStates(input.states),
    events: input.events,
    expandedStateIds: input.expandedStateIds,
    maxStatesThisChunk: input.states.length,
    terminalReason: input.terminalReason,
    accountCreationExhausted: input.accountCreationExhausted
  });
}
```

The production coordinator groups by normalized `address + direction`, loads
one manifest, passes each original episode state unchanged, persists one delta,
and never merges different funding episode IDs.

- [ ] **Step 4: Verify GREEN and artifact equivalence**

```powershell
npm test -- tests/unified-check/productionTraversal.test.ts tests/unified-check/traversal.test.ts tests/unified-check/canonicalArtifacts.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/productionTraversal.ts src/unifiedCheck/traversal.ts tests/unified-check/productionTraversal.test.ts tests/unified-check/traversal.test.ts
git commit -m "refactor(unified-check): reuse histories across funding episodes"
```

### Task 6: Increase logical chunks while preserving physical pagination

**Files:**
- Modify: `src/config.ts`
- Modify: `src/unifiedCheck/addressHistory.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `tests/config/config.test.ts`
- Modify: `tests/unified-check/addressHistory.test.ts`

- [ ] **Step 1: Write RED tests for 200–500-event leases**

Test that four 50-row subrequests produce one 200-event logical chunk, with a
heartbeat/cancellation cooperation point between every subrequest. Test
provider wait after the second page: checkpoint includes only validated pages
and resumes at the third.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/addressHistory.test.ts tests/config/config.test.ts
```

- [ ] **Step 3: Implement operational chunk config**

```typescript
unifiedAddressHistoryChunkEvents: integerEnv(
  "UNIFIED_ADDRESS_HISTORY_CHUNK_EVENTS",
  process.env.UNIFIED_ADDRESS_HISTORY_CHUNK_EVENTS ?? "250",
  { min: 50, max: 500 }
)
```

Loop physical requests until canonical event count reaches the configured
logical size, provider exhaustion/wait occurs, cancellation is requested, or
the lease heartbeat says to yield. Keep existing TronScan request limit.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/unified-check/addressHistory.test.ts tests/unified-check/directHistory.test.ts tests/tron/tronClient.test.ts tests/config/config.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/config.ts src/unifiedCheck/addressHistory.ts src/unifiedCheck/productionRuntime.ts tests/config/config.test.ts tests/unified-check/addressHistory.test.ts
git commit -m "perf(unified-check): checkpoint address history by logical chunk"
```

### Task 7: Add inter-user fair claiming

**Files:**
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `tests/unified-check/productionRuntime.postgres.test.ts`

- [ ] **Step 1: Write the RED concurrency fixture**

Create one dense interactive run with eight ready `address_history` tasks, then
two later small interactive runs with one task each. Claim eight times without
completion. Expected first round:

```text
dense, small-a, small-b
```

before dense receives an additional slot, subject to available work. Assert
repair/background never precedes ready interactive work.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/productionRuntime.postgres.test.ts
```

- [ ] **Step 3: Implement run-aware round-robin claim ordering**

Use a SQL window over ready tasks and the count/latest claim timestamp of
currently leased tasks per run. Keep priority lane first, then prefer an
interactive run with zero active provider leases, then least recently served
run, then existing task age ordering. Lock only the selected task with
`FOR UPDATE SKIP LOCKED`.

Do not add an in-memory fairness registry; PostgreSQL is the shared authority
across processes.

- [ ] **Step 4: Verify GREEN and existing fairness**

```powershell
npm test -- tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/fairScheduler.test.ts tests/unified-check/watchdog.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/repository.ts tests/unified-check/productionRuntime.postgres.test.ts
git commit -m "fix(unified-check): preserve fairness across wallet runs"
```

### Task 8: Run an event-driven four-slot provider pool

**Files:**
- Create: `src/unifiedCheck/providerPool.ts`
- Create: `tests/unified-check/providerPool.test.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `src/runtime/startupSchedule.ts`
- Modify: `src/index.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Write RED pool tests**

Use controlled promises to prove:

- four claims execute concurrently;
- a completed/checkpointed task triggers an immediate next claim;
- idle returns to one safety wake timer instead of busy spinning;
- one provider wait does not pause other slots;
- `stop()` prevents new claims and awaits active calls;
- max in-flight instrumentation reaches four and contains no API keys.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/providerPool.test.ts tests/runtime/startupSchedule.test.ts
```

- [ ] **Step 3: Implement the minimal pool**

```typescript
export function createUnifiedProviderPool(input: {
  slots: number;
  runCycle(slotId: number): Promise<{ claimed: boolean }>;
  onError(error: unknown, slotId: number): void;
  onInFlight?(current: number): void;
}) {
  let stopped = false;
  let running: Promise<void>[] = [];
  const drain = async (slotId: number) => {
    while (!stopped) {
      const result = await input.runCycle(slotId);
      if (!result.claimed) return;
    }
  };
  return {
    wake() {
      if (stopped || running.length !== 0) return;
      running = Array.from({ length: input.slots }, (_, slotId) =>
        drain(slotId).catch((error) => input.onError(error, slotId))
      );
      void Promise.allSettled(running).then(() => { running = []; });
    },
    async stop() {
      stopped = true;
      await Promise.allSettled(running);
    }
  };
}
```

Production implementation must permit a new wake while some slots are idle and
others remain active; use per-slot active flags rather than the simplified
single `running` array above. Default slots equal configured independent key
groups, capped at four for the current rollout.

- [ ] **Step 4: Wire one provider work label as safety wake**

Remove duplicate provider calls from `unified_provider_io` and
`unified_indexing`; both labels must not start independent pools. Keep one
event-driven pool instance and make schedule ticks call `wake()`. Trigger
`wake()` after request/task enqueue and provider ready-at notification.

- [ ] **Step 5: Verify GREEN**

```powershell
npm test -- tests/unified-check/providerPool.test.ts tests/runtime/startupSchedule.test.ts tests/unified-check/productionRuntime.postgres.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/unifiedCheck/providerPool.ts src/unifiedCheck/productionRuntime.ts src/runtime/startupSchedule.ts src/index.ts src/config.ts tests/unified-check/providerPool.test.ts tests/runtime/startupSchedule.test.ts
git commit -m "perf(unified-check): run a fair event-driven provider pool"
```

### Task 9: Start Fast/direct hard evidence beside traversal

**Files:**
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `src/unifiedCheck/productionBranches.ts`
- Modify: `tests/unified-check/productionBranches.test.ts`
- Modify: `tests/unified-check/verticalSlice.postgres.test.ts`

- [ ] **Step 1: Write RED lifecycle tests**

Assert:

- `fast` is claimable after direct history and before traversal completion;
- direct hard evidence artifact is persisted while traversal is running;
- `where` and traversal-dependent Deep aggregation still wait for traversal;
- no score, final report, presentation or delivery exists before all required
  children complete;
- final output equals the serial baseline.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/productionBranches.test.ts tests/unified-check/verticalSlice.postgres.test.ts
```

- [ ] **Step 3: Split direct and traversal-dependent branch inputs**

Change claim prerequisites:

```sql
task.kind = 'fast' → completed direct_history
task.kind in ('where','deep') → completed traversal
```

If Deep direct hard evidence currently executes inside the final Deep task,
create a `deep_direct` evidence-only task after direct history. Deep consumes
its accepted artifact plus traversal; finalizer still accepts only the
authoritative `fast`, `where`, `deep` branch outputs.

- [ ] **Step 4: Verify GREEN and single delivery**

```powershell
npm test -- tests/unified-check/productionBranches.test.ts tests/unified-check/verticalSlice.postgres.test.ts tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/repository.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/productionBranches.ts tests/unified-check/productionBranches.test.ts tests/unified-check/verticalSlice.postgres.test.ts
git commit -m "perf(unified-check): parallelize direct evidence and traversal"
```

### Task 10: Bound checkpoint timing data and emit P0 metrics

**Files:**
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `src/unifiedCheck/performanceMetrics.ts`
- Modify: `tests/storage/unifiedCheck.postgres.test.ts`
- Modify: `tests/unified-check/performanceMetrics.test.ts`

- [ ] **Step 1: Write RED tests**

After 2,000 claim/checkpoint cycles assert:

```typescript
expect(checkpoint.attemptTimings).toBeUndefined();
expect(checkpoint.timingSummary.attemptCount).toBe(2000);
expect(checkpoint.recentAttempts).toHaveLength(8);
expect(Buffer.byteLength(JSON.stringify(checkpoint))).toBeLessThan(32_768);
```

Verify counters survive restart and diagnostics failures do not fail analysis.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/performanceMetrics.test.ts
```

- [ ] **Step 3: Replace SQL array append with bounded summary**

Persist:

```json
{
  "timingSummary": {
    "attemptCount": 12,
    "queueDurationMs": 1500,
    "providerDurationMs": 700
  },
  "recentAttempts": [
    { "attempt": 12, "durationMs": 30, "outcome": "CHECKPOINTED" }
  ]
}
```

Build the bounded array in the existing causal SQL update:

```sql
'recentAttempts',
(
  coalesce(checkpoint_json->'recentAttempts', '[]'::jsonb) ||
  jsonb_build_array($attempt_sample::jsonb)
) #- '{0}'
```

Use a `case` expression so `#- '{0}'` is applied only when the appended array
has more than eight elements. Do not retain old unbounded `attemptTimings`
after V1→V2 upgrade.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/performanceMetrics.test.ts tests/unified-check/productionRuntime.postgres.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/repository.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/performanceMetrics.ts tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/performanceMetrics.test.ts
git commit -m "perf(unified-check): bound checkpoint diagnostics"
```

### Task 11: Run the P0 equivalence milestone

**Files:**
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Create: `docs/audit/2026-07-system-audit/unified-performance/p0-summary.json`

- [ ] **Step 1: Run only the P0 targeted set**

```powershell
npm run typecheck
npm test -- tests/unified-check/addressHistory.test.ts tests/unified-check/traversalDelta.test.ts tests/unified-check/providerPool.test.ts tests/unified-check/productionTraversal.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/verticalSlice.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 2: Run deterministic frozen before/after comparison**

Use the same benchmark manifest for:

```text
TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV
TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr
TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd
synthetic-dense-wallet
synthetic-500-pages
synthetic-restart
synthetic-duplicates
synthetic-reorder
```

Do not stop a case by elapsed time. P0 fails if canonical inventory, closure,
score, report or presentation hashes differ. Record measured time, requests,
in-flight, replay avoided, checkpoint bytes, DB writes and table/TOAST growth.

- [ ] **Step 3: Update knowledge truth**

Document implemented V2 checkpoints, address-history reuse, provider pool,
parallel direct evidence and the measured P0 result. Remove only open problems
that are actually fixed; retain any measured remaining bottleneck.

- [ ] **Step 4: Verify the audit artifact is deterministic**

Run the comparator twice against the same frozen input and assert identical
semantic hashes and counter values except wall-clock measurement envelope.

- [ ] **Step 5: Commit the P0 milestone**

```powershell
git add src tests docs/knowledge docs/audit/2026-07-system-audit/unified-performance/p0-summary.json
git commit -m "feat(unified-check): complete p0 traversal performance remediation"
```

## P0 stop conditions

Stop and report a concrete blocker instead of widening scope if:

- a frozen P0 semantic hash changes;
- address-history reuse loses amount/source lineage;
- V1 checkpoint cannot be upgraded without discarding progress;
- fairness requires a new external coordination service;
- provider bundles for TPCP/TFWG/TXc cannot be reconstructed deterministically.

Do not respond by adding a user timeout, partial score, coverage threshold or
new terminal boundary. Those are prohibited by the design.
