# Unified Wallet Check Adaptive Capacity and Fairness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed four-slot provider path with durable rolling admission, provider/demand-aware capacity, hierarchical work-conserving fairness, and an elastic repair reserve.

**Architecture:** Pure functions calculate provider supply, ready demand, per-run lookahead, and owner→run allocations. PostgreSQL remains authoritative for admission and reservations, while a resizable provider pool applies the calculated target without interrupting leased chunks. Provider pacing, endpoint limits, cooldown, and HTTP 429 handling remain inside the existing TronScan scheduler.

**Tech Stack:** TypeScript 5.7, Node.js, PostgreSQL, `pg`, Vitest, existing Unified planner/task runtime and TronScan scheduler.

**Prerequisite:** Complete `docs/superpowers/plans/2026-07-24-unified-wallet-check-durable-ordered-planner.md`.

**Design:** `docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md`

**Rollout boundary:** This plan implements rolling mode, but leaves the production default on `barrier`; Plan 3 changes the default only after replay and live gates pass.

---

## File map

- Create `src/unifiedCheck/providerCapacityController.ts`: capacity, ramp,
  resource-state, and lookahead calculations.
- Create `src/unifiedCheck/fairProviderAllocator.ts`: owner→run max-min allocation,
  canonical-head preference, and repair reserve.
- Modify `src/unifiedCheck/plannerRepository.ts`: transactional rolling admission,
  reservation release, per-run buffer guards, and tail de-admission.
- Modify `src/unifiedCheck/providerPool.ts`: dynamically target active provider
  slots instead of constructing a fixed promise array.
- Modify `src/unifiedCheck/productionRuntime.ts`: calculate demand, allocate slots,
  refill admissions, and reconcile durable work.
- Modify `src/tron/tronscanScheduler.ts`: expose independent-group health and
  circuit state without merging RPS pacing into concurrency control.
- Modify `src/config.ts` and `src/index.ts`: parse controller/resource/chunk
  settings and remove the hard-coded
  `Math.min(4, Math.max(1, config.tronscanApiKeys.length))` pool size.
- Modify `src/unifiedCheck/worker.ts`,
  `src/unifiedCheck/productionWorker.ts`, and provider handlers: enforce bounded
  checkpoint chunks without aborting an in-flight HTTP request.
- Add deterministic scheduler, capacity, pool, admission, restart, and logical
  scale tests under `tests/unified-check`.
- Update knowledge pages 03, 04, 09, 10, and 12 after behavior is implemented.

### Task 1: Implement the pure provider-capacity contract

**Files:**
- Create: `src/unifiedCheck/providerCapacityController.ts`
- Create: `tests/unified-check/providerCapacityController.test.ts`
- Modify: `src/config.ts`
- Modify: `tests/config/config.test.ts`

- [ ] **Step 1: Write RED tests for supply, demand, pressure, and ramp**

Cover these exact cases:

```typescript
expect(calculateProviderCapacityLimit({
  healthyIndependentGroupConcurrency: 16,
  configuredProviderConcurrencyLimit: 32,
  providerWorkerLimit: 24,
  dbAndMemoryGuardLimit: 12,
})).toBe(12);

expect(calculateTargetActiveProviderSlots({
  providerCapacityLimit: 12,
  eligibleReadyProviderWork: 5,
})).toBe(5);

expect(calculateRunLookaheadTarget({
  providerCapacity: 4,
  fairProviderShare: 1.1,
  configuredLookaheadFactor: 2,
  configuredPerRunMaximum: 20,
})).toBe(3);

expect(calculateRunLookaheadTarget({
  providerCapacity: 0,
  fairProviderShare: 10,
  configuredLookaheadFactor: 2,
  configuredPerRunMaximum: 20,
})).toBe(0);
```

Also assert:

- `normal` preserves the configured guard limit;
- `pressure` lowers new provider claims and may pause analysis/finalization;
- `critical` sets new provider, analysis, and finalization claims to zero;
- capacity increases by at most `increaseStep` after `increaseIntervalMs`;
- capacity decrease is immediate;
- request rate never appears as an input to a concurrency formula.

Run:

```powershell
npm test -- tests/unified-check/providerCapacityController.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the minimum pure types and formulas**

Create:

```typescript
export type ProviderGroupState = "healthy" | "cooldown" | "circuit_open";
export type RuntimeResourceState = "normal" | "pressure" | "critical";

export interface ProviderCapacitySupply {
  healthyIndependentGroupConcurrency: number;
  configuredProviderConcurrencyLimit: number;
  providerWorkerLimit: number;
  dbAndMemoryGuardLimit: number;
}

export function calculateProviderCapacityLimit(
  supply: ProviderCapacitySupply,
): number {
  return Math.max(0, Math.min(
    supply.healthyIndependentGroupConcurrency,
    supply.configuredProviderConcurrencyLimit,
    supply.providerWorkerLimit,
    supply.dbAndMemoryGuardLimit,
  ));
}

export function calculateTargetActiveProviderSlots(input: {
  providerCapacityLimit: number;
  eligibleReadyProviderWork: number;
}): number {
  return Math.max(0, Math.min(
    input.providerCapacityLimit,
    input.eligibleReadyProviderWork,
  ));
}

export function calculateRunLookaheadTarget(input: {
  providerCapacity: number;
  fairProviderShare: number;
  configuredLookaheadFactor: number;
  configuredPerRunMaximum: number;
}): number {
  if (input.providerCapacity === 0) return 0;
  return Math.min(
    input.configuredPerRunMaximum,
    Math.max(1, Math.ceil(
      input.fairProviderShare * input.configuredLookaheadFactor,
    )),
  );
}
```

Add a stateful `applyProviderCapacityRamp` pure reducer whose state contains only
the prior target and last increase time. A lower limit takes effect immediately;
an increase advances by the configured step only after the configured interval.

- [ ] **Step 3: Add validated configuration**

Add explicit config fields with positive-integer/range validation:

```typescript
unifiedProviderConcurrencyLimit
unifiedProviderIncreaseStep
unifiedProviderIncreaseIntervalMs
unifiedProviderWorkerLimit
unifiedAnalysisConcurrencyLimit
unifiedFinalizationConcurrencyLimit
unifiedLookaheadFactor
unifiedPerRunLookaheadMaximum
unifiedReadyBufferMaxEntries
unifiedReadyBufferMaxBytes
unifiedReservedBufferMaxBytes
unifiedManifestHardLimitBytes
unifiedChunkMaxPages
unifiedChunkMaxWallMs
unifiedChunkMaxResponseBytes
unifiedChunkMaxCheckpointBytes
unifiedRepairShare
unifiedRepairMaxSlots
unifiedRepairMaxWaitChunks
unifiedReconciliationIntervalMs
unifiedAdmissionPolicy
```

Allow only `"barrier"` or `"rolling"` for `unifiedAdmissionPolicy`; default it
to `"barrier"` in this plan.

- [ ] **Step 4: Run GREEN and typecheck**

```powershell
npm test -- tests/unified-check/providerCapacityController.test.ts tests/config/config.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/providerCapacityController.ts tests/unified-check/providerCapacityController.test.ts src/config.ts tests/config/config.test.ts
git commit -m "feat(unified): calculate adaptive provider capacity"
```

### Task 2: Implement hierarchical max-min fairness and repair reserve

**Files:**
- Create: `src/unifiedCheck/fairProviderAllocator.ts`
- Create: `tests/unified-check/fairProviderAllocator.test.ts`
- Modify: `src/tron/tronscanScheduler.ts`
- Modify: `tests/unified-check/fairScheduler.test.ts`

- [ ] **Step 1: Replace dead scheduler expectations with RED allocation cases**

Test a pure allocator with stable IDs and no timers:

```typescript
expect(slotCounts(allocateProviderSlots({
  capacity: 16,
  runs: [readyRun("a", "owner-a", 16)],
  repair: noRepair(),
}))).toEqual({ a: 16 });

expect(slotCounts(allocateProviderSlots({
  capacity: 16,
  runs: [
    readyRun("a", "owner-a", 16),
    readyRun("b", "owner-b", 16),
    readyRun("c", "owner-c", 16),
  ],
  repair: noRepair(),
}))).toEqual({ a: 6, b: 5, c: 5 });
```

Add cases for:

- two runs capped at one slot and a third receiving the remaining 14;
- 15 runs and 16 slots, with the surplus going to least-recently-served;
- two runs of one owner versus one run of another owner;
- no reservation for a run without eligible work or with a full merge buffer;
- canonical head winning within its run only when ordinarily eligible;
- canonical-head priority not bypassing owner fairness;
- more runs than slots rotating by `lastServedAt`;
- deterministic tie breaking by owner ID then run ID.

Run:

```powershell
npm test -- tests/unified-check/fairProviderAllocator.test.ts
```

Expected: FAIL because the allocator does not exist.

- [ ] **Step 2: Implement work-conserving owner→run rounds**

Use two explicit round-robin layers:

1. allocate one slot per eligible owner in least-recently-served order;
2. within each owner, allocate one slot per eligible run in the same order;
3. repeat rounds while capacity and per-run demand remain;
4. never reserve a share for blocked demand.

The return value must include allocations and one stable decision reason per
unserved run:

```typescript
export type AllocationReason =
  | "allocated"
  | "fairness_wait"
  | "no_ready_work"
  | "merge_buffer_full"
  | "provider_unavailable"
  | "resource_guard";

export interface ProviderSlotAllocation {
  runId: string;
  ownerId: string;
  slots: number;
  canonicalHeadPreferred: boolean;
  reason: AllocationReason;
}
```

Do not assign a provider group to an ordered task. `provider_unavailable` means
there is no healthy independent group currently capable of executing it.

- [ ] **Step 3: Add elastic, borrowable repair capacity**

Implement:

```typescript
export function calculateRepairMinimum(input: {
  effectiveCapacity: number;
  readyRepairWork: number;
  repairShare: number;
  repairMaxSlots: number;
}): number {
  if (input.readyRepairWork === 0 || input.effectiveCapacity === 0) return 0;
  return Math.min(
    input.readyRepairWork,
    input.repairMaxSlots,
    Math.max(1, Math.ceil(input.effectiveCapacity * input.repairShare)),
  );
}
```

Tests must prove:

- interactive work borrows the full reserve when repair has no ready work;
- repair reclaims only on a later allocation/chunk boundary;
- capacity 1 alternates according to `repairMaxWaitChunks`;
- interactive and repair each use their own owner→run fairness;
- background never consumes slots while eligible interactive or required repair
  demand remains.

- [ ] **Step 4: Remove the unused legacy fairness implementation**

Delete `createUnifiedFairTronscanScheduler` if production still has no caller.
Keep provider-group pacing/cooldown in `createTronscanScheduler`; connect the new
allocator at the Unified runtime layer instead of wrapping provider requests.

Run:

```powershell
npm test -- tests/unified-check/fairProviderAllocator.test.ts tests/unified-check/fairScheduler.test.ts tests/tron/tronscanScheduler.test.ts
npm run typecheck
```

Expected: PASS; repository search has no call to the removed legacy scheduler.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/fairProviderAllocator.ts tests/unified-check/fairProviderAllocator.test.ts src/tron/tronscanScheduler.ts tests/unified-check/fairScheduler.test.ts
git commit -m "feat(unified): allocate provider slots fairly"
```

### Task 3: Make the provider pool resizable and chunks bounded

**Files:**
- Modify: `src/unifiedCheck/providerPool.ts`
- Modify: `tests/unified-check/providerPool.test.ts`
- Modify: `src/unifiedCheck/worker.ts`
- Modify: `src/unifiedCheck/productionWorker.ts`
- Modify: `src/unifiedCheck/productionAddressHistory.ts`
- Modify: `src/unifiedCheck/productionDirectHistory.ts`
- Modify: `tests/unified-check/worker.test.ts`
- Modify: `tests/unified-check/productionAddressHistory.test.ts`

- [ ] **Step 1: Write RED pool-resize tests**

Assert:

- target 0 starts no cycle;
- target changes 1 → 4 → 2 without recreating the pool;
- lowering a target does not cancel two already-running cycles;
- completed cycles above the new target are not replaced;
- raising a target wakes only the missing number of loops;
- `snapshot()` exposes configured limit, target, active, and idle counts;
- `drain()` terminates after all active cycles finish.

Run:

```powershell
npm test -- tests/unified-check/providerPool.test.ts
```

Expected: FAIL on the new API.

- [ ] **Step 2: Replace fixed slots with `setTargetSlots`**

Expose:

```typescript
export interface UnifiedProviderPool {
  setTargetSlots(target: number): void;
  wake(): void;
  drain(): Promise<void>;
  snapshot(): {
    configuredLimit: number;
    targetSlots: number;
    activeSlots: number;
    idleSlots: number;
  };
}
```

Maintain at most `configuredLimit` loops. A decrease changes replacement
behavior only; it never aborts a promise already inside `runCycle`.

- [ ] **Step 3: Write RED bounded-chunk tests**

For an address history with more work remaining, verify that the chunk
checkpoints after the first reached limit among:

- pages/work units;
- wall time, measured after the current provider operation;
- cumulative response bytes;
- checkpoint bytes.

Assert the provider request already in progress completes and the task is
requeued with a durable checkpoint.

- [ ] **Step 4: Implement one shared chunk-budget predicate**

Carry a `UnifiedProviderChunkBudget` into provider handlers:

```typescript
export interface UnifiedProviderChunkBudget {
  maxWorkUnits: number;
  maxWallMs: number;
  maxResponseBytes: number;
  maxCheckpointBytes: number;
}
```

Check the budget after each atomic provider operation and before starting the
next. Do not add request cancellation. Use the existing checkpoint path.

- [ ] **Step 5: Run focused checks**

```powershell
npm test -- tests/unified-check/providerPool.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionAddressHistory.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 6: Commit**

```powershell
git add src/unifiedCheck/providerPool.ts tests/unified-check/providerPool.test.ts src/unifiedCheck/worker.ts src/unifiedCheck/productionWorker.ts src/unifiedCheck/productionAddressHistory.ts src/unifiedCheck/productionDirectHistory.ts tests/unified-check/worker.test.ts tests/unified-check/productionAddressHistory.test.ts
git commit -m "feat(unified): resize provider pool at chunk boundaries"
```

### Task 4: Implement durable rolling admission and isolated backpressure

**Files:**
- Modify: `src/unifiedCheck/plannerRepository.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Create: `tests/unified-check/rollingAdmission.postgres.test.ts`
- Modify: `tests/unified-check/plannerRepository.postgres.test.ts`
- Modify: `tests/unified-check/addressHistoryTasks.test.ts`

- [ ] **Step 1: Write RED PostgreSQL admission tests**

Use two repository instances against one database. Prove:

- each refill locks `unified_check_runs` with `FOR UPDATE`;
- both instances cannot admit/reserve the same tail capacity;
- `admitted_at` and `reserved_bytes` change atomically;
- ordered claim requires `admitted_at IS NOT NULL`;
- independent tasks without planner rows remain claimable;
- the canonical head may be admitted when run capacity is nonzero even when
  later ready entries have filled the soft buffer;
- limits apply per run, so one full buffer does not block another run;
- only non-leased tail entries may be de-admitted;
- acceptance clears `reserved_bytes` and stores actual `result_bytes`;
- hard-limit rejection does not transition the entry to `ready`.

Run:

```powershell
npm test -- tests/unified-check/rollingAdmission.postgres.test.ts
```

Expected: FAIL because rolling refill methods are absent.

- [ ] **Step 2: Add one transactional refill operation**

Add a repository method with an explicit policy:

```typescript
refillOrderedAdmissions(input: {
  runId: string;
  policy: "barrier" | "rolling";
  lookaheadTarget: number;
  readyBufferMaxEntries: number;
  readyBufferMaxBytes: number;
  reservedBufferMaxBytes: number;
  reservationBytesPerTask: number;
  now: Date;
}): Promise<{
  admittedTaskIds: string[];
  deAdmittedTaskIds: string[];
  blocker:
    | null
    | "merge_buffer_full"
    | "reservation_full"
    | "no_provider_capacity"
    | "no_ready_work";
}>;
```

Inside one transaction:

1. lock the run row;
2. read ready count/bytes and admitted reservation;
3. always select canonical head first when capacity is nonzero and it is not
   already committed/leased/admitted;
4. admit capacity-independent sequence order up to the policy target;
5. reserve bytes with each admission;
6. de-admit only unleased tail rows above a lowered target.

`barrier` uses target 1. `rolling` uses the calculated lookahead target. Neither
policy changes canonical planning or commit.

- [ ] **Step 3: Make claim SQL planner-aware**

Replace the old global address-history barrier predicate. For a task with a
planner row, require:

```sql
p.admitted_at IS NOT NULL
AND p.planner_state = 'planned'
```

Eligibility also requires ordinary ready time/lease rules and at least one
healthy provider group capable of executing the task. The task has no stored or
preselected provider-group ownership.

- [ ] **Step 4: Run focused PostgreSQL checks**

```powershell
npm test -- tests/unified-check/rollingAdmission.postgres.test.ts tests/unified-check/plannerRepository.postgres.test.ts tests/unified-check/addressHistoryTasks.test.ts
npm run typecheck
```

Expected: PASS; concurrent refill never exceeds either reservation limit.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/plannerRepository.ts src/unifiedCheck/repository.ts tests/unified-check/rollingAdmission.postgres.test.ts tests/unified-check/plannerRepository.postgres.test.ts tests/unified-check/addressHistoryTasks.test.ts
git commit -m "feat(unified): admit ordered work with durable bounds"
```

### Task 5: Wire health, resource guards, capacity, and fairness

**Files:**
- Modify: `src/tron/tronscanScheduler.ts`
- Modify: `tests/tron/tronscanScheduler.test.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `src/unifiedCheck/productionWorker.ts`
- Modify: `src/index.ts`
- Create: `tests/unified-check/adaptiveRuntime.test.ts`
- Modify: `tests/unified-check/productionRuntime.postgres.test.ts`

- [ ] **Step 1: Write RED provider-group health tests**

Expose independent group snapshots:

```typescript
interface ProviderGroupCapacitySnapshot {
  groupId: string;
  state: "healthy" | "cooldown" | "circuit_open";
  concurrencyLimit: number;
  inFlight: number;
  cooldownUntil: number | null;
}
```

Test that:

- a 429 moves only its group to cooldown;
- repeated configured provider failures open that group's circuit;
- a successful half-open probe restores healthy state;
- aggregate healthy concurrency counts independent groups, not raw key count;
- pacing/RPS limits still apply inside request acquisition.

- [ ] **Step 2: Write RED runtime allocation tests**

Use fake memory/DB/provider snapshots and assert:

- demand and supply are calculated separately;
- pool target is `min(capacityLimit, eligibleReadyProviderWork)`;
- pressure lowers new claims immediately;
- critical pauses new provider/analysis/finalization claims;
- analysis and finalization use only configured ceilings and pressure lowering,
  not throughput feedback;
- one ready run uses all safe capacity;
- multiple owners receive hierarchical fair shares;
- the allocated share becomes each run's rolling lookahead input;
- an ineligible canonical head receives no special claim;
- cooldown transfers work to any other capable healthy group.

- [ ] **Step 3: Implement best-effort resource snapshot inputs**

Inject resource readings into production runtime:

- `process.memoryUsage().rss` and heap;
- container/cgroup available memory when exposed by the existing runtime
  environment, otherwise host available memory;
- DB pool waiting count and measured DB/checkpoint latency;
- configured pressure and critical thresholds.

WSL/vmmem is not a production input. Keep collection failures non-fatal and
fall back to the last safe lower capacity.

- [ ] **Step 4: Compose one controller cycle**

The cycle order is:

1. snapshot group health and resource state;
2. read eligible demand grouped by lane, owner, and run;
3. calculate supply limit;
4. apply immediate decrease or stepped increase;
5. calculate repair minimum and fair allocations;
6. refill/de-admit each run transactionally;
7. set provider pool target to actionable admitted demand;
8. wake only after committed DB changes.

Do not add a PID controller, provider-group assignment column, or feedback tuning
for analysis/finalization.

- [ ] **Step 5: Replace fixed pool construction in `src/index.ts`**

Remove:

```typescript
slots: Math.min(4, Math.max(1, config.tronscanApiKeys.length))
```

Construct the pool with its validated configured upper bound, start at target
zero, and let the controller set the active target. Preserve the current four
configured groups as the live maximum until more independent groups are added.

- [ ] **Step 6: Run focused integration checks**

```powershell
npm test -- tests/tron/tronscanScheduler.test.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/productionRuntime.postgres.test.ts
npm run typecheck
```

Expected: PASS; no fixed four-slot expression remains in production.

- [ ] **Step 7: Commit**

```powershell
git add src/tron/tronscanScheduler.ts tests/tron/tronscanScheduler.test.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/productionWorker.ts src/index.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/productionRuntime.postgres.test.ts
git commit -m "feat(unified): wire adaptive provider controller"
```

### Task 6: Add event wake, reconciliation, fallback, and scale simulation

**Files:**
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Create: `src/unifiedCheck/reconciliation.ts`
- Create: `tests/unified-check/reconciliation.postgres.test.ts`
- Create: `tests/unified-check/providerScaleSimulation.test.ts`
- Create: `tests/unified-check/barrierFallback.postgres.test.ts`
- Modify: `tests/unified-check/productionRuntime.postgres.test.ts`

- [ ] **Step 1: Write RED wake and reconciliation tests**

Prove:

- task creation, acceptance, commit, cooldown expiry, and lease release wake the
  controller fast path;
- multiple wake signals coalesce without losing durable work;
- a slow periodic reconciliation tick discovers work after a lost signal;
- restart with admitted work needs no reconstruction from in-memory state;
- a tick with no actionable work performs no task mutation;
- observability failure cannot fail reconciliation or commit.

- [ ] **Step 2: Implement a coalescing wake and rare tick**

Use the existing runtime timer mechanism. Add a single in-process `wakePending`
flag and the configured reconciliation interval. Do not add LISTEN/NOTIFY or
frequent polling.

Reconciliation reads durable tasks/planner state, invokes the same controller
cycle, and returns:

```typescript
{ actionableWorkFound: boolean; admitted: number; wokenSlots: number }
```

- [ ] **Step 3: Write RED barrier fallback tests**

Starting in rolling mode with admitted and leased tail entries:

1. switch policy to barrier;
2. stop new rolling admissions;
3. de-admit unleased tail;
4. allow leased chunks to checkpoint;
5. continue with head-only admission;
6. prove identical committed artifact/checkpoint hashes.

Also prove that pre-034 active runs are not reconstructed: they finish on the
old generation or must be drained before rolling activation.

- [ ] **Step 4: Add deterministic logical-capacity simulations**

For capacities `1, 4, 8, 16, 32, 100`, run seeded scenarios with sufficient
eligible work:

- one, three, and fifteen simultaneous runs;
- slow canonical head;
- one or more groups entering cooldown;
- repair arrival during interactive load;
- one run filling its merge buffer;
- restart between commit and refill.

Each failure message must print the seed and logical capacity. Assert bounded
admission/reservations, progress for eligible owners, correct repair wait, no
duplicate claim, and no sequence change with capacity.

- [ ] **Step 5: Run the Plan 2 suite**

```powershell
npm test -- tests/unified-check/providerCapacityController.test.ts tests/unified-check/fairProviderAllocator.test.ts tests/unified-check/providerPool.test.ts tests/unified-check/rollingAdmission.postgres.test.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/reconciliation.postgres.test.ts tests/unified-check/barrierFallback.postgres.test.ts tests/unified-check/providerScaleSimulation.test.ts
npm run typecheck
```

Expected: PASS for every logical capacity; production config still defaults to
barrier.

- [ ] **Step 6: Update knowledge docs**

Update:

- `docs/knowledge/03-job-lifecycle.md`;
- `docs/knowledge/04-data-sources-tronscan-indexing.md`;
- `docs/knowledge/09-current-decisions.md`;
- `docs/knowledge/10-open-problems.md`;
- `docs/knowledge/12-runbooks.md`.

Record implemented rolling semantics, owner fairness, repair reserve, resource
guards, rare reconciliation, current live limit of four groups, and the pending
Plan 3 rollout gate.

- [ ] **Step 7: Commit**

```powershell
git add src/unifiedCheck/productionRuntime.ts src/unifiedCheck/reconciliation.ts tests/unified-check/reconciliation.postgres.test.ts tests/unified-check/providerScaleSimulation.test.ts tests/unified-check/barrierFallback.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md
git commit -m "test(unified): prove rolling capacity and fallback"
```

## Plan 2 completion gate

Run:

```powershell
npm test -- tests/unified-check
npm run typecheck
git diff --check HEAD~6
git status --short
```

Expected:

- all Unified tests PASS;
- typecheck exits 0;
- logical capacity 100 remains bounded and deterministic;
- pool capacity follows healthy independent groups and resource guards;
- provider RPS remains governed separately by TronScan pacing;
- production admission default remains `barrier` pending Plan 3.
