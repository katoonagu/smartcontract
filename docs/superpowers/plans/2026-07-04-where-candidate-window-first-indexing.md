# Where Candidate Window First Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build candidate-window-first indexing for ordinary `where_is_money_check`, so Where proves concrete hop funding with narrow durable windows before falling back to broad `genesis -> targetTimestamp` targeted indexing.

**Architecture:** Extend the existing `tron_address_usdt_index_states` and `forensic_job_waits` model with a narrow `candidate_window` request identity. Keep the existing address index worker and provider path, but pass request-kind-specific window bounds into `indexTronAddressUsdtHistory`. Add a small Where coordinator branch that queues candidate windows, waits/resumes the parent job, re-runs funding-first evaluation, and only then queues broad fallback when material unresolved amount remains.

**Tech Stack:** TypeScript, PostgreSQL migrations, existing forensic job queue, existing TronScan/TronGrid provider path, Vitest.

---

## Scope Guard

This plan implements Where v1 only.

Do not change:

- DeepCheck relationship expansion;
- Incoming behavior, except keeping shared types extensible;
- scoring math;
- service/CEX/DEX/bridge/contract/high-degree boundary policy;
- broad targeted fallback budgets.

Keep `TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB` and DeepCheck second-layer settings untouched.

## Current Code Facts

- `migrations/026_tron_address_all_time_index.sql` creates `tron_address_usdt_index_states` with primary key `(address, token_contract, coverage_mode, target_timestamp_ms)`.
- `migrations/027_forensic_job_waits.sql` creates `forensic_job_waits` with unique key `(job_id, wait_type, address, coverage_mode, target_timestamp_ms)`.
- `src/storage/repositories.ts` maps and queries index state only by `targetTimestamp`.
- `src/storage/repositories.ts:getCoveringTronAddressUsdtIndexState` treats any targeted state with `target_timestamp_ms >= requested` as covering/competing broad targeted history.
- `src/forensics/tronAddressAllTimeIndex.ts:indexTronAddressUsdtHistory` always calls `ensureWindow` with `startMs = GENESIS_WINDOW_START_MS`.
- `src/forensics/addressIndexWorker.ts` forwards only `targetTimestamp` into `ensureAddressUsdtHistory`.
- `src/forensics/targetedHistoryCoordinator.ts:ensureTargetedHistoryOrWait` is the current broad targeted wait coordinator.
- `src/forensics/moneyOriginTrace.ts` already has inline `repairProbableSourceProvenance`, which repairs a probable funding source by checking `coverageWindow.startTimestamp -> target.timestamp`.
- `src/forensics/fundingFirstSourceProvenance.ts` owns exact/probable/unresolved proof classification. Do not duplicate its scoring/proof math.
- `src/admin/adminServer.ts:withTargetedHistoryProgress` hydrates waiting Where jobs only when `jobPhase === "waiting_for_targeted_index"`.
- `src/admin/adminConsole.ts:targetedIndexLines` renders current targeted progress as broad targeted waiting.

## File Structure

Create:

- `migrations/028_candidate_window_indexing.sql` - durable schema changes for request identity and waiter identity.
- `src/forensics/candidateWindowTargeting.ts` - pure helper for selecting top candidate windows from existing `MoneyOriginFundingSourceProvenance` facts.
- `tests/forensics/candidateWindowTargeting.test.ts` - deterministic helper tests.

Modify:

- `src/types.ts` - add request-kind/window fields to index state, wait progress, and narrow queue input types.
- `src/storage/repositories.ts` - map/query/upsert/queue/claim/fail index states and waits using candidate-window identity.
- `tests/storage/repositories.test.ts` - repository identity and broad/candidate isolation tests.
- `tests/storage/forensicCheckJobs.test.ts` - waiter identity and wakeup tests.
- `src/forensics/tronAddressAllTimeIndex.ts` - choose `windowStartTimestamp` for candidate windows.
- `tests/forensics/tronAddressAllTimeIndex.test.ts` - provider start/end bound tests.
- `src/forensics/addressIndexWorker.ts` - pass candidate-window fields through worker/requeue/failure/wakeup.
- `tests/forensics/addressIndexWorker.test.ts` - worker pass-through and retry cap tests.
- `src/forensics/targetedHistoryCoordinator.ts` - keep broad coordinator broad-only and add progress shape helpers for candidate windows.
- `tests/forensics/targetedHistoryCoordinator.test.ts` - broad lookup must ignore candidate windows.
- `src/forensics/moneyOriginTrace.ts` - surface enough candidate-window wait metadata from probable source provenance without changing proof math.
- `tests/forensics/moneyOriginTrace.test.ts` - probable provenance exposes candidate windows and exact repair still works.
- `src/check/whereIsMoneyCheck.ts` - pass candidate-window hooks into trace if needed by the selected integration point.
- `tests/check/whereIsMoneyCheck.test.ts` - Where-level behavior around candidate windows before broad fallback.
- `src/index.ts` - wire repository functions and v1 limits.
- `src/admin/adminServer.ts` - hydrate candidate-window progress for waiting Where jobs.
- `tests/admin/adminServer.test.ts` - API includes candidate-window progress.
- `src/admin/adminConsole.ts` - render candidate-window phase and broad fallback state.
- `tests/admin/adminConsole.test.ts` - UI copy/helpers cover the new phase.
- `docs/knowledge/04-data-sources-tronscan-indexing.md` - record lower-bound candidate-window indexing.
- `docs/knowledge/05-where-is-money-and-incoming.md` - record Where candidate-window-first behavior.
- `docs/knowledge/08-admin-and-bot-ux.md` - record Admin progress wording.
- `docs/knowledge/09-current-decisions.md` - record the current decision.

---

### Task 0: Create Execution Branch

**Files:**
- No code files.

- [ ] **Step 1: Create a dedicated worktree from current master**

Run from `C:\Users\User\OneDrive\Desktop\smartcontract`:

```powershell
git status --short --branch
git worktree add .worktrees/where-candidate-window-first-indexing -b codex/where-candidate-window-first-indexing master
```

Expected: worktree is created on branch `codex/where-candidate-window-first-indexing`. If `git status` shows staged files before creating the worktree, stop and ask.

- [ ] **Step 2: Verify branch and baseline**

Run:

```powershell
git -C .worktrees/where-candidate-window-first-indexing status --short --branch
git -C .worktrees/where-candidate-window-first-indexing log --oneline --decorate -3
```

Expected: branch is `codex/where-candidate-window-first-indexing`; no tracked dirty files.

---

### Task 1: Add Candidate-Window Schema Identity

**Files:**
- Create: `migrations/028_candidate_window_indexing.sql`
- Modify: `src/types.ts`
- Modify: `src/storage/repositories.ts`
- Test: `tests/storage/repositories.test.ts`
- Test: `tests/storage/forensicCheckJobs.test.ts`

- [ ] **Step 1: Write failing repository tests for index-state identity**

Add tests near the existing `queueTronAddressUsdtIndexState` and `getCoveringTronAddressUsdtIndexState` tests in `tests/storage/repositories.test.ts`:

```ts
it("stores multiple candidate-window targeted states for one address and end timestamp", async () => {
  const db = createTestDb();
  const address = "TCandidateWindow1111111111111111111111111";
  const end = new Date("2026-07-04T12:00:00.000Z");
  const firstStart = new Date("2026-07-04T11:55:00.000Z");
  const secondStart = new Date("2026-07-04T11:58:00.000Z");

  await queueTronAddressUsdtIndexState(db.db, {
    address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    windowStartTimestamp: firstStart,
    windowEndTimestamp: end,
    targetTimestamp: end,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1",
    queuedReason: "where_candidate_window",
    requestedByJobId: "where-job-1"
  });

  await queueTronAddressUsdtIndexState(db.db, {
    address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    windowStartTimestamp: secondStart,
    windowEndTimestamp: end,
    targetTimestamp: end,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-2",
    queuedReason: "where_candidate_window",
    requestedByJobId: "where-job-1"
  });

  const first = await getTronAddressUsdtIndexState(db.db, {
    address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    windowStartTimestamp: firstStart,
    windowEndTimestamp: end,
    candidateTxHash: "candidate-tx-1"
  });
  const second = await getTronAddressUsdtIndexState(db.db, {
    address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    windowStartTimestamp: secondStart,
    windowEndTimestamp: end,
    candidateTxHash: "candidate-tx-2"
  });

  expect(first?.candidateTxHash).toBe("candidate-tx-1");
  expect(second?.candidateTxHash).toBe("candidate-tx-2");
  expect(first?.windowStartTimestamp?.toISOString()).toBe(firstStart.toISOString());
  expect(second?.windowStartTimestamp?.toISOString()).toBe(secondStart.toISOString());
});

it("does not use candidate-window state as broad targeted coverage", async () => {
  const db = createTestDb();
  const address = "TCandidateWindow2222222222222222222222222";
  const end = new Date("2026-07-04T12:00:00.000Z");

  await upsertTronAddressUsdtIndexState(db.db, {
    address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    windowStartTimestamp: new Date("2026-07-04T11:55:00.000Z"),
    windowEndTimestamp: end,
    targetTimestamp: end,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1",
    status: "complete",
    statusReason: "complete_provider_windowed",
    queuedReason: "where_candidate_window"
  });

  const covering = await getCoveringTronAddressUsdtIndexState(db.db, {
    address,
    coverageMode: "targeted",
    targetTimestamp: new Date("2026-07-04T11:59:00.000Z")
  });

  expect(covering).toBeNull();
});
```

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```powershell
npm test -- tests/storage/repositories.test.ts
```

Expected: FAIL because `requestKind`, `windowStartTimestamp`, `windowEndTimestamp`, and `candidateTxHash` are not accepted/mapped yet.

- [ ] **Step 3: Add migration**

Create `migrations/028_candidate_window_indexing.sql`:

```sql
alter table tron_address_usdt_index_states
  add column if not exists request_kind text not null default 'broad_targeted',
  add column if not exists window_start_timestamp_ms bigint not null default 0,
  add column if not exists window_start_timestamp timestamptz,
  add column if not exists window_end_timestamp_ms bigint not null default 0,
  add column if not exists window_end_timestamp timestamptz,
  add column if not exists related_hop_tx_hash text,
  add column if not exists candidate_tx_hash text;

update tron_address_usdt_index_states
set request_kind = 'broad_targeted',
  window_start_timestamp_ms = case when coverage_mode = 'targeted' then 0 else 0 end,
  window_start_timestamp = null,
  window_end_timestamp_ms = target_timestamp_ms,
  window_end_timestamp = target_timestamp
where request_kind = 'broad_targeted'
  and window_end_timestamp_ms = 0;

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_request_kind_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_request_kind_check
  check (request_kind in ('broad_targeted', 'candidate_window'));

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_window_check;
alter table tron_address_usdt_index_states
  add constraint tron_address_usdt_index_states_window_check
  check (
    request_kind = 'broad_targeted'
    or (
      coverage_mode = 'targeted'
      and window_start_timestamp_ms > 0
      and window_end_timestamp_ms > 0
      and window_start_timestamp is not null
      and window_end_timestamp is not null
      and window_start_timestamp_ms <= window_end_timestamp_ms
      and window_end_timestamp_ms = target_timestamp_ms
      and candidate_tx_hash is not null
      and length(candidate_tx_hash) > 0
    )
  );

alter table tron_address_usdt_index_states drop constraint if exists tron_address_usdt_index_states_pkey;

alter table tron_address_usdt_index_states
  add primary key (
    address,
    token_contract,
    coverage_mode,
    target_timestamp_ms,
    request_kind,
    window_start_timestamp_ms,
    candidate_tx_hash
  );

drop index if exists tron_address_usdt_index_states_queue_idx;
create index if not exists tron_address_usdt_index_states_queue_idx
  on tron_address_usdt_index_states(coverage_mode, request_kind, status, priority desc, next_run_at, created_at);

drop index if exists tron_address_usdt_index_states_lock_idx;
create index if not exists tron_address_usdt_index_states_lock_idx
  on tron_address_usdt_index_states(coverage_mode, request_kind, status, locked_until, heartbeat_at);

alter table forensic_job_waits
  add column if not exists request_kind text not null default 'broad_targeted',
  add column if not exists window_start_timestamp_ms bigint not null default 0,
  add column if not exists window_start_timestamp timestamptz,
  add column if not exists window_end_timestamp_ms bigint not null default 0,
  add column if not exists window_end_timestamp timestamptz,
  add column if not exists related_hop_tx_hash text,
  add column if not exists candidate_tx_hash text;

update forensic_job_waits
set request_kind = 'broad_targeted',
  window_end_timestamp_ms = target_timestamp_ms,
  window_end_timestamp = target_timestamp
where request_kind = 'broad_targeted'
  and window_end_timestamp_ms = 0;

alter table forensic_job_waits drop constraint if exists forensic_job_waits_request_kind_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_request_kind_check
  check (request_kind in ('broad_targeted', 'candidate_window'));

alter table forensic_job_waits drop constraint if exists forensic_job_waits_window_check;
alter table forensic_job_waits
  add constraint forensic_job_waits_window_check
  check (
    request_kind = 'broad_targeted'
    or (
      window_start_timestamp_ms > 0
      and window_end_timestamp_ms > 0
      and window_start_timestamp is not null
      and window_end_timestamp is not null
      and window_start_timestamp_ms <= window_end_timestamp_ms
      and window_end_timestamp_ms = target_timestamp_ms
      and candidate_tx_hash is not null
      and length(candidate_tx_hash) > 0
    )
  );

alter table forensic_job_waits drop constraint if exists forensic_job_waits_job_id_wait_type_address_coverage_mode_target_timestamp_ms_key;

alter table forensic_job_waits
  add constraint forensic_job_waits_identity_unique unique (
    job_id,
    wait_type,
    address,
    coverage_mode,
    target_timestamp_ms,
    request_kind,
    window_start_timestamp_ms,
    candidate_tx_hash
  );

drop index if exists forensic_job_waits_target_idx;
create index if not exists forensic_job_waits_target_idx
  on forensic_job_waits(wait_type, address, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, status);
```

If PostgreSQL rejects a constraint name because the original unique constraint has a generated name in a local database, inspect `\d forensic_job_waits` and adjust only the `drop constraint if exists` line to the actual name.

- [ ] **Step 4: Add TypeScript request-kind types**

In `src/types.ts`, add:

```ts
export type TronAddressUsdtIndexRequestKind = "broad_targeted" | "candidate_window";
```

Extend `TronAddressUsdtIndexState`:

```ts
  requestKind: TronAddressUsdtIndexRequestKind;
  windowStartTimestamp: Date | null;
  windowEndTimestamp: Date | null;
  relatedHopTxHash: string | null;
  candidateTxHash: string | null;
```

- [ ] **Step 5: Update repository mapping and identity helpers**

In `src/storage/repositories.ts`, add helper functions near `targetTimestampMsForCoverage`:

```ts
function requestKindForIndex(input: { requestKind?: TronAddressUsdtIndexRequestKind | null }): TronAddressUsdtIndexRequestKind {
  return input.requestKind ?? "broad_targeted";
}

function windowStartTimestampMsForIndex(input: {
  requestKind?: TronAddressUsdtIndexRequestKind | null;
  windowStartTimestamp?: Date | null;
}): number {
  return requestKindForIndex(input) === "candidate_window" && input.windowStartTimestamp
    ? input.windowStartTimestamp.getTime()
    : 0;
}

function candidateTxHashForIndex(input: {
  requestKind?: TronAddressUsdtIndexRequestKind | null;
  candidateTxHash?: string | null;
}): string {
  return requestKindForIndex(input) === "candidate_window" ? input.candidateTxHash ?? "" : "";
}
```

Extend `mapTronAddressUsdtIndexStateRow`:

```ts
    requestKind: row.request_kind ?? "broad_targeted",
    windowStartTimestamp: row.window_start_timestamp ?? null,
    windowEndTimestamp: row.window_end_timestamp ?? null,
    relatedHopTxHash: row.related_hop_tx_hash ?? null,
    candidateTxHash: row.candidate_tx_hash ?? null,
```

Extend `tronAddressIndexStateReturningSql` to include:

```sql
request_kind, window_start_timestamp_ms, window_start_timestamp,
window_end_timestamp_ms, window_end_timestamp, related_hop_tx_hash, candidate_tx_hash
```

- [ ] **Step 6: Update repository queries**

Change `getTronAddressUsdtIndexState` input to accept:

```ts
requestKind?: TronAddressUsdtIndexRequestKind | null;
windowStartTimestamp?: Date | null;
windowEndTimestamp?: Date | null;
candidateTxHash?: string | null;
```

For broad default, query `request_kind = 'broad_targeted'`.

For candidate windows, query by:

```sql
and request_kind = $4
and window_start_timestamp_ms = $5
and coalesce(candidate_tx_hash, '') = $6
```

Change `getCoveringTronAddressUsdtIndexState` to include:

```sql
and request_kind = 'broad_targeted'
```

This is the safety line that prevents narrow windows from pretending to cover full targeted history.

- [ ] **Step 7: Update queue/upsert/claim/fail conflict identity**

Update `UpsertTronAddressUsdtIndexStateInput` and `queueTronAddressUsdtIndexState` input with the same request-kind/window fields.

In both `insert` statements, insert the new columns:

```sql
request_kind, window_start_timestamp_ms, window_start_timestamp,
window_end_timestamp_ms, window_end_timestamp, related_hop_tx_hash, candidate_tx_hash
```

Use this conflict target:

```sql
on conflict (
  address,
  token_contract,
  coverage_mode,
  target_timestamp_ms,
  request_kind,
  window_start_timestamp_ms,
  candidate_tx_hash
) do update set
```

Update `claimQueuedTronAddressUsdtIndexStates` CTE and update join to include:

```sql
and state.request_kind = candidates.request_kind
and state.window_start_timestamp_ms = candidates.window_start_timestamp_ms
and coalesce(state.candidate_tx_hash, '') = coalesce(candidates.candidate_tx_hash, '')
```

Update `failTronAddressUsdtIndexState` input and `where` clause with the same request identity.

- [ ] **Step 8: Add failing wait identity tests**

In `tests/storage/forensicCheckJobs.test.ts`, add:

```ts
it("stores separate candidate-window waits for the same job address and target", async () => {
  const db = createTestDb();
  const jobId = "where-job-window-waits";
  const address = "TWaitWindow111111111111111111111111111";
  const end = new Date("2026-07-04T12:00:00.000Z");

  await upsertForensicJobWait(db.db, {
    jobId,
    address,
    targetTimestamp: end,
    requiredFor: "where_hop",
    requestKind: "candidate_window",
    windowStartTimestamp: new Date("2026-07-04T11:55:00.000Z"),
    windowEndTimestamp: end,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1"
  });
  await upsertForensicJobWait(db.db, {
    jobId,
    address,
    targetTimestamp: end,
    requiredFor: "where_hop",
    requestKind: "candidate_window",
    windowStartTimestamp: new Date("2026-07-04T11:58:00.000Z"),
    windowEndTimestamp: end,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-2"
  });

  const waits = await db.db.query("select candidate_tx_hash from forensic_job_waits where job_id = $1 order by candidate_tx_hash", [jobId]);
  expect(waits.rows.map((row) => row.candidate_tx_hash)).toEqual(["candidate-tx-1", "candidate-tx-2"]);
});
```

- [ ] **Step 9: Update wait repository functions**

Extend `ForensicJobWaitInput` in `src/storage/repositories.ts` with:

```ts
requestKind?: TronAddressUsdtIndexRequestKind | null;
windowStartTimestamp?: Date | null;
windowEndTimestamp?: Date | null;
relatedHopTxHash?: string | null;
candidateTxHash?: string | null;
```

Update `upsertForensicJobWait`, `markWaitingForensicJobsReadyAfterTargetedIndex`, and `patchWaitingForensicJobsTargetedIndexProgress` so broad behavior remains unchanged and candidate-window calls match by exact window identity.

For broad wakeups, keep the existing `wait.target_timestamp_ms <= $2` semantics but add:

```sql
and wait.request_kind = 'broad_targeted'
```

Do not add the candidate-window wakeup function in this task. Task 6 adds the full `markWaitingForensicJobsReadyAfterCandidateWindowIndex` implementation after worker pass-through exists.

- [ ] **Step 10: Run storage tests**

Run:

```powershell
npm test -- tests/storage/repositories.test.ts tests/storage/forensicCheckJobs.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

Run:

```powershell
git add migrations/028_candidate_window_indexing.sql src/types.ts src/storage/repositories.ts tests/storage/repositories.test.ts tests/storage/forensicCheckJobs.test.ts
git diff --cached --check
git commit -m "feat(where): add candidate window index identity"
```

Expected: commit succeeds.

---

### Task 2: Make The Indexer Use Lower Bounds

**Files:**
- Modify: `src/forensics/tronAddressAllTimeIndex.ts`
- Modify: `src/forensics/addressIndexWorker.ts`
- Modify: `src/index.ts`
- Test: `tests/forensics/tronAddressAllTimeIndex.test.ts`
- Test: `tests/forensics/addressIndexWorker.test.ts`

- [ ] **Step 1: Write failing indexer lower-bound test**

Add this helper and test to `tests/forensics/tronAddressAllTimeIndex.test.ts`:

```ts
function candidateWindowBaseIndexState(address: string): TronAddressUsdtIndexState {
  const now = new Date("2026-07-04T12:00:00.000Z");
  return {
    address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    requestKind: "candidate_window",
    status: "running",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    targetTimestamp: now,
    windowStartTimestamp: null,
    windowEndTimestamp: now,
    relatedHopTxHash: null,
    candidateTxHash: null,
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 0,
    nextRunAt: now,
    attemptCount: 0,
    maxAttempts: 3,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "where_candidate_window",
    requestedByJobId: null,
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: 200,
    budgetSeconds: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

it("uses candidate-window lower and upper timestamps for targeted provider reads", async () => {
  const address = "TIndexerWindow111111111111111111111111";
  const windowStart = new Date("2026-07-04T11:55:00.000Z");
  const windowEnd = new Date("2026-07-04T12:00:00.000Z");
  const windows: Array<{ startTimestamp: number; endTimestamp: number }> = [];

  await indexTronAddressUsdtHistory({
    address,
    coverageMode: "targeted",
    requestKind: "candidate_window",
    windowStartTimestamp: windowStart,
    windowEndTimestamp: windowEnd,
    targetTimestamp: windowEnd,
    candidateTxHash: "candidate-tx-1",
    relatedHopTxHash: "hop-tx-1",
    pageLimit: 200,
    maxPagesPerRun: 50,
    listTransferPage: async (_address, options) => {
      windows.push({ startTimestamp: options.startTimestamp, endTimestamp: options.endTimestamp });
      return {
        transfers: [],
        total: 0,
        rangeTotal: 0,
        provider: "tronscan",
        rawResponseHash: "empty",
        canonicalTransferHash: "empty"
      };
    },
    upsertTransfers: async () => undefined,
    upsertState: async (state) => ({
      ...candidateWindowBaseIndexState(address),
      ...state,
      requestKind: "candidate_window",
      windowStartTimestamp: windowStart,
      windowEndTimestamp: windowEnd,
      candidateTxHash: "candidate-tx-1",
      relatedHopTxHash: "hop-tx-1"
    } as TronAddressUsdtIndexState),
    upsertPage: async () => undefined,
    upsertCoverageInterval: async () => undefined
  });

  expect(windows[0]).toEqual({
    startTimestamp: windowStart.getTime(),
    endTimestamp: windowEnd.getTime()
  });
});
```

- [ ] **Step 2: Run indexer test to verify failure**

Run:

```powershell
npm test -- tests/forensics/tronAddressAllTimeIndex.test.ts
```

Expected: FAIL because the provider receives `GENESIS_WINDOW_START_MS` as `startTimestamp`.

- [ ] **Step 3: Extend indexer dependency type and root window selection**

In `src/forensics/tronAddressAllTimeIndex.ts`, extend `IndexTronAddressUsdtHistoryDeps`:

```ts
  requestKind?: TronAddressUsdtIndexRequestKind | null;
  windowStartTimestamp?: Date | null;
  windowEndTimestamp?: Date | null;
  relatedHopTxHash?: string | null;
  candidateTxHash?: string | null;
```

Add helper near `type TimeWindow`:

```ts
function rootWindowForIndexRequest(input: {
  coverageMode: TronAddressUsdtCoverageMode;
  requestKind?: TronAddressUsdtIndexRequestKind | null;
  targetTimestamp: Date | null;
  windowStartTimestamp?: Date | null;
  windowEndTimestamp?: Date | null;
  now: Date;
}): TimeWindow {
  if (input.coverageMode === "targeted" && input.requestKind === "candidate_window") {
    if (!input.windowStartTimestamp || !input.windowEndTimestamp) {
      throw new Error("candidate_window targeted index requires window start and end timestamps");
    }
    return {
      startMs: input.windowStartTimestamp.getTime(),
      endMs: input.windowEndTimestamp.getTime(),
      depth: 0
    };
  }
  return {
    startMs: GENESIS_WINDOW_START_MS,
    endMs: input.targetTimestamp?.getTime() ?? input.now.getTime(),
    depth: 0
  };
}
```

Replace:

```ts
const endMs = targetTimestamp?.getTime() ?? now.getTime();
```

and:

```ts
const result = await ensureWindow(deps, { startMs: GENESIS_WINDOW_START_MS, endMs, depth: 0 }, budget, targetTimestamp);
```

with:

```ts
const rootWindow = rootWindowForIndexRequest({
  coverageMode: deps.coverageMode,
  requestKind: deps.requestKind ?? deps.initialState?.requestKind ?? "broad_targeted",
  targetTimestamp,
  windowStartTimestamp: deps.windowStartTimestamp ?? deps.initialState?.windowStartTimestamp ?? null,
  windowEndTimestamp: deps.windowEndTimestamp ?? deps.initialState?.windowEndTimestamp ?? null,
  now
});
const result = await ensureWindow(deps, rootWindow, budget, targetTimestamp);
```

Pass new fields into every `upsertState` call:

```ts
    requestKind: deps.requestKind ?? deps.initialState?.requestKind ?? "broad_targeted",
    windowStartTimestamp: deps.windowStartTimestamp ?? deps.initialState?.windowStartTimestamp ?? null,
    windowEndTimestamp: deps.windowEndTimestamp ?? deps.initialState?.windowEndTimestamp ?? null,
    relatedHopTxHash: deps.relatedHopTxHash ?? deps.initialState?.relatedHopTxHash ?? null,
    candidateTxHash: deps.candidateTxHash ?? deps.initialState?.candidateTxHash ?? null,
```

- [ ] **Step 4: Write failing worker pass-through test**

Add this helper and test to `tests/forensics/addressIndexWorker.test.ts`:

```ts
function candidateWindowWorkerState(address: string): TronAddressUsdtIndexState {
  const targetTimestamp = new Date("2026-07-04T12:00:00.000Z");
  return {
    address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    requestKind: "candidate_window",
    status: "queued",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    targetTimestamp,
    windowStartTimestamp: new Date("2026-07-04T11:55:00.000Z"),
    windowEndTimestamp: targetTimestamp,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1",
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 240,
    nextRunAt: targetTimestamp,
    attemptCount: 0,
    maxAttempts: 3,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "where_candidate_window",
    requestedByJobId: "where-job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: 200,
    budgetSeconds: null,
    completedAt: null,
    createdAt: targetTimestamp,
    updatedAt: targetTimestamp
  };
}

it("passes candidate-window identity and caps page budget to the indexer", async () => {
  const state = candidateWindowWorkerState("TWorkerWindow111111111111111111111111");
  const calls: unknown[] = [];

  await runAddressIndexWorkerOnce({
    claimQueuedTronAddressUsdtIndexStates: async () => [state],
    ensureAddressUsdtHistory: async (input) => {
      calls.push(input);
      return { ...state, status: "complete", statusReason: "complete_provider_windowed" };
    },
    failTronAddressUsdtIndexState: async () => undefined,
    markWaitingForensicJobsReadyAfterTargetedIndex: async () => 0,
    patchWaitingForensicJobsTargetedIndexProgress: async () => 0
  }, {
    claimLimit: 1,
    lockMs: 60_000,
    workerId: "worker-test",
    targetedRetry: { basePages: 200, maxPagesPerHop: 12_000, maxAttempts: 8, retryDelayMs: 30_000 }
  });

  expect(calls[0]).toMatchObject({
    requestKind: "candidate_window",
    windowStartTimestamp: state.windowStartTimestamp,
    windowEndTimestamp: state.windowEndTimestamp,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1",
    maxPagesPerRun: 200
  });
});
```

- [ ] **Step 5: Pass through worker fields**

In `src/forensics/addressIndexWorker.ts`, extend `ensureAddressUsdtHistory`, `queueAddressUsdtHistory`, and `failTronAddressUsdtIndexState` inputs with:

```ts
requestKind?: TronAddressUsdtIndexRequestKind | null;
windowStartTimestamp?: Date | null;
windowEndTimestamp?: Date | null;
relatedHopTxHash?: string | null;
candidateTxHash?: string | null;
```

When calling `ensureAddressUsdtHistory`, pass:

```ts
        requestKind: state.requestKind,
        windowStartTimestamp: state.windowStartTimestamp,
        windowEndTimestamp: state.windowEndTimestamp,
        relatedHopTxHash: state.relatedHopTxHash,
        candidateTxHash: state.candidateTxHash,
```

When requeueing, pass the same fields. When failing, pass the same fields so only the exact candidate-window state is failed.

- [ ] **Step 6: Wire `src/index.ts`**

In both `queueAddressUsdtHistory` adapters and `ensureAddressUsdtHistory`, forward request-kind/window fields to repository/indexer calls:

```ts
requestKind: input.requestKind ?? "broad_targeted",
windowStartTimestamp: input.windowStartTimestamp ?? null,
windowEndTimestamp: input.windowEndTimestamp ?? null,
relatedHopTxHash: input.relatedHopTxHash ?? null,
candidateTxHash: input.candidateTxHash ?? null,
```

For `where_candidate_window`, set:

```ts
priority: 240
budgetPages: 200
maxAttempts: 3
```

Keep `where_is_money_hop` broad fallback priority/budget unchanged.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/tronAddressAllTimeIndex.test.ts tests/forensics/addressIndexWorker.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```powershell
git add src/forensics/tronAddressAllTimeIndex.ts src/forensics/addressIndexWorker.ts src/index.ts tests/forensics/tronAddressAllTimeIndex.test.ts tests/forensics/addressIndexWorker.test.ts
git diff --cached --check
git commit -m "feat(where): index candidate windows by timestamp range"
```

Expected: commit succeeds.

---

### Task 3: Add Candidate-Window Selection Helper

**Files:**
- Create: `src/forensics/candidateWindowTargeting.ts`
- Create: `tests/forensics/candidateWindowTargeting.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing pure helper tests**

Create `tests/forensics/candidateWindowTargeting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectCandidateWindowsForSourceProvenance } from "../../src/forensics/candidateWindowTargeting";
import type { MoneyOriginFundingSourceProvenance } from "../../src/types";

function provenance(overrides: Partial<MoneyOriginFundingSourceProvenance> = {}): MoneyOriginFundingSourceProvenance {
  return {
    mode: "source_provenance",
    targetTxHash: "hop-tx-1",
    targetFromAddress: "THop111111111111111111111111111111",
    targetToAddress: "TNext11111111111111111111111111111",
    targetTimestamp: "2026-07-04T12:00:00.000Z",
    targetAmountRaw: "100000000",
    proofClass: "probable",
    coveredAmountRaw: "96000000",
    coverageRatio: 0.96,
    amountContinuity: "strong",
    stopReason: "incoming_history_not_fetched",
    fundingBundle: {
      hopTxHash: "hop-tx-1",
      hopAddress: "THop111111111111111111111111111111",
      expectedAmountRaw: "100000000",
      coveredAmountRaw: "96000000",
      coverageRatio: 0.96,
      members: [
        {
          txHash: "candidate-new-large",
          fromAddress: "TFunder111111111111111111111111111",
          toAddress: "THop111111111111111111111111111111",
          originalAmountRaw: "70000000",
          usedAmountRaw: "70000000",
          spentBeforeHopRaw: "0",
          timestamp: "2026-07-04T11:59:00.000Z",
          coverageShare: 0.7
        },
        {
          txHash: "candidate-old-small",
          fromAddress: "TFunder222222222222222222222222222",
          toAddress: "THop111111111111111111111111111111",
          originalAmountRaw: "26000000",
          usedAmountRaw: "26000000",
          spentBeforeHopRaw: "0",
          timestamp: "2026-07-04T11:00:00.000Z",
          coverageShare: 0.26
        }
      ]
    },
    coverageWindow: {
      startTimestamp: "2026-07-04T11:00:00.000Z",
      endTimestamp: "2026-07-04T12:00:00.000Z",
      complete: false,
      capped: true,
      providerInconsistent: false
    },
    reasons: ["funding_bundle_amount_covered", "coverage_window_not_exact"],
    ...overrides
  };
}

describe("selectCandidateWindowsForSourceProvenance", () => {
  it("selects probable funding bundle members as ordered candidate windows", () => {
    const selected = selectCandidateWindowsForSourceProvenance({
      sourceProvenance: provenance(),
      maxWindowsPerHop: 5
    });

    expect(selected.map((item) => item.candidateTxHash)).toEqual([
      "candidate-new-large",
      "candidate-old-small"
    ]);
    expect(selected[0]).toMatchObject({
      address: "THop111111111111111111111111111111",
      targetTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      windowStartTimestamp: new Date("2026-07-04T11:59:00.000Z"),
      windowEndTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-new-large"
    });
  });

  it("returns no windows for exact or service-boundary provenance", () => {
    expect(selectCandidateWindowsForSourceProvenance({
      sourceProvenance: provenance({ proofClass: "exact", stopReason: null }),
      maxWindowsPerHop: 5
    })).toEqual([]);
    expect(selectCandidateWindowsForSourceProvenance({
      sourceProvenance: provenance({ proofClass: "service_boundary", stopReason: "service_boundary" }),
      maxWindowsPerHop: 5
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run helper test to verify failure**

Run:

```powershell
npm test -- tests/forensics/candidateWindowTargeting.test.ts
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Add helper types**

In `src/types.ts`, add:

```ts
export type WhereCandidateWindowRequest = {
  address: string;
  targetTimestamp: Date;
  windowStartTimestamp: Date;
  windowEndTimestamp: Date;
  relatedHopTxHash: string;
  candidateTxHash: string;
  requestedAmountRaw: string;
  candidateAmountRaw: string;
  coverageShare: number;
};
```

- [ ] **Step 4: Implement deterministic helper**

Create `src/forensics/candidateWindowTargeting.ts`:

```ts
import type { MoneyOriginFundingSourceProvenance, WhereCandidateWindowRequest } from "../types";

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function amountBigint(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

export function selectCandidateWindowsForSourceProvenance(input: {
  sourceProvenance: MoneyOriginFundingSourceProvenance;
  maxWindowsPerHop: number;
}): WhereCandidateWindowRequest[] {
  const provenance = input.sourceProvenance;
  if (provenance.proofClass !== "probable") return [];
  const targetTimestamp = validDate(provenance.targetTimestamp);
  if (!targetTimestamp || !provenance.fundingBundle) return [];

  return provenance.fundingBundle.members
    .map((member): WhereCandidateWindowRequest | null => {
      const windowStartTimestamp = validDate(member.timestamp);
      if (!windowStartTimestamp) return null;
      if (windowStartTimestamp.getTime() > targetTimestamp.getTime()) return null;
      return {
        address: provenance.targetFromAddress,
        targetTimestamp,
        windowStartTimestamp,
        windowEndTimestamp: targetTimestamp,
        relatedHopTxHash: provenance.targetTxHash,
        candidateTxHash: member.txHash,
        requestedAmountRaw: provenance.targetAmountRaw,
        candidateAmountRaw: member.usedAmountRaw,
        coverageShare: member.coverageShare
      };
    })
    .filter((item): item is WhereCandidateWindowRequest => item !== null)
    .sort((left, right) => {
      const rightAmount = amountBigint(right.candidateAmountRaw);
      const leftAmount = amountBigint(left.candidateAmountRaw);
      if (rightAmount !== leftAmount) return rightAmount > leftAmount ? 1 : -1;
      return right.windowStartTimestamp.getTime() - left.windowStartTimestamp.getTime();
    })
    .slice(0, Math.max(0, Math.floor(input.maxWindowsPerHop)));
}
```

- [ ] **Step 5: Run helper tests**

Run:

```powershell
npm test -- tests/forensics/candidateWindowTargeting.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add src/types.ts src/forensics/candidateWindowTargeting.ts tests/forensics/candidateWindowTargeting.test.ts
git diff --cached --check
git commit -m "feat(where): select funding candidate windows"
```

Expected: commit succeeds.

---

### Task 4: Add Candidate-Window Wait Coordinator

**Files:**
- Modify: `src/forensics/targetedHistoryCoordinator.ts`
- Test: `tests/forensics/targetedHistoryCoordinator.test.ts`

- [ ] **Step 1: Write failing coordinator test**

Add this helper and test to `tests/forensics/targetedHistoryCoordinator.test.ts`:

```ts
function coordinatorCandidateWindowState(input: {
  address: string;
  targetTimestamp: Date;
  windowStartTimestamp: Date;
  windowEndTimestamp: Date;
  candidateTxHash: string;
  relatedHopTxHash: string;
  status?: TronAddressUsdtIndexState["status"];
}): TronAddressUsdtIndexState {
  return {
    address: input.address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    coverageMode: "targeted",
    coverageKind: "provider_windowed",
    requestKind: "candidate_window",
    status: input.status ?? "queued",
    statusReason: null,
    provider: null,
    totalReported: null,
    fetchedTransferCount: 0,
    uniqueCounterpartyCount: 0,
    newestTransferAt: null,
    oldestTransferAt: null,
    coveredUntilTimestamp: null,
    targetTimestamp: input.targetTimestamp,
    windowStartTimestamp: input.windowStartTimestamp,
    windowEndTimestamp: input.windowEndTimestamp,
    relatedHopTxHash: input.relatedHopTxHash,
    candidateTxHash: input.candidateTxHash,
    fetchedPageCount: 0,
    plannedPageCount: null,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 240,
    nextRunAt: input.targetTimestamp,
    attemptCount: 0,
    maxAttempts: 3,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: null,
    queuedReason: "where_candidate_window",
    requestedByJobId: "where-job-1",
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: 200,
    budgetSeconds: null,
    completedAt: null,
    createdAt: input.targetTimestamp,
    updatedAt: input.targetTimestamp
  };
}

it("queues candidate-window waits without broad covering lookup", async () => {
  const queued: unknown[] = [];
  const waits: unknown[] = [];
  await expect(ensureCandidateWindowsOrWait({
    jobId: "where-job-1",
    requests: [{
      address: "THop111111111111111111111111111111",
      targetTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      windowStartTimestamp: new Date("2026-07-04T11:59:00.000Z"),
      windowEndTimestamp: new Date("2026-07-04T12:00:00.000Z"),
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1",
      requestedAmountRaw: "100000000",
      candidateAmountRaw: "70000000",
      coverageShare: 0.7
    }],
    progressJson: {},
    persistProgress: async (patch) => patch,
    deps: {
      getAddressUsdtIndexState: async () => null,
      getCoveringAddressUsdtIndexState: async () => {
        throw new Error("candidate windows must not use broad covering lookup");
      },
      queueAddressUsdtHistory: async (input) => {
        queued.push(input);
        return coordinatorCandidateWindowState({
          address: input.address,
          targetTimestamp: input.targetTimestamp!,
          windowStartTimestamp: input.windowStartTimestamp!,
          windowEndTimestamp: input.windowEndTimestamp!,
          candidateTxHash: input.candidateTxHash!,
          relatedHopTxHash: input.relatedHopTxHash!,
          status: "queued"
        });
      },
      releaseForensicCheckJobToWaiting: async () => true,
      upsertForensicJobWait: async (input) => {
        waits.push(input);
      }
    }
  })).rejects.toThrow("targeted_history_waiting_for_index");

  expect(queued[0]).toMatchObject({
    requestKind: "candidate_window",
    queuedReason: "where_candidate_window",
    candidateTxHash: "candidate-tx-1"
  });
  expect(waits[0]).toMatchObject({
    requestKind: "candidate_window",
    candidateTxHash: "candidate-tx-1"
  });
});
```

- [ ] **Step 2: Run coordinator test to verify failure**

Run:

```powershell
npm test -- tests/forensics/targetedHistoryCoordinator.test.ts
```

Expected: FAIL because `ensureCandidateWindowsOrWait` is not exported.

- [ ] **Step 3: Add candidate-window coordinator**

In `src/forensics/targetedHistoryCoordinator.ts`, add:

```ts
export type CandidateWindowWaitInput = {
  jobId: string;
  requests: WhereCandidateWindowRequest[];
  progressJson: Record<string, unknown>;
  deps: TargetedHistoryWaiterDeps;
  persistProgress(patch: ForensicJobProgressPatch): Promise<Record<string, unknown> | void>;
};

export function candidateWindowWaitingProgressPatch(input: {
  requests: readonly WhereCandidateWindowRequest[];
  states: readonly TronAddressUsdtIndexState[];
}): ForensicJobProgressPatch {
  const complete = input.states.filter((state) => state.status === "complete").length;
  const terminal = input.states.filter((state) => state.status === "partial" || state.status === "failed_terminal").length;
  return {
    jobPhase: "checking_candidate_windows",
    targetedIndex: {
      phase: "checking_candidate_windows",
      scoreValid: false,
      candidateWindows: {
        total: input.requests.length,
        queued: input.states.filter((state) => state.status === "queued").length,
        running: input.states.filter((state) => state.status === "running").length,
        complete,
        terminal,
        pending: Math.max(0, input.requests.length - complete - terminal)
      },
      broadFallback: "not_queued",
      windows: input.requests.map((request) => ({
        address: request.address,
        targetTimestamp: request.targetTimestamp.toISOString(),
        windowStartTimestamp: request.windowStartTimestamp.toISOString(),
        windowEndTimestamp: request.windowEndTimestamp.toISOString(),
        relatedHopTxHash: request.relatedHopTxHash,
        candidateTxHash: request.candidateTxHash,
        coverageShare: request.coverageShare
      }))
    }
  };
}

export async function ensureCandidateWindowsOrWait(input: CandidateWindowWaitInput): Promise<true> {
  if (input.requests.length === 0) return true;
  const states: TronAddressUsdtIndexState[] = [];
  for (const request of input.requests) {
    const existing = await input.deps.getAddressUsdtIndexState({
      address: request.address,
      coverageMode: "targeted",
      requestKind: "candidate_window",
      targetTimestamp: request.targetTimestamp,
      windowStartTimestamp: request.windowStartTimestamp,
      windowEndTimestamp: request.windowEndTimestamp,
      candidateTxHash: request.candidateTxHash
    });
    const state = existing && isTargetedHistoryFinished(existing)
      ? existing
      : await input.deps.queueAddressUsdtHistory({
          address: request.address,
          coverageMode: "targeted",
          requestKind: "candidate_window",
          targetTimestamp: request.targetTimestamp,
          windowStartTimestamp: request.windowStartTimestamp,
          windowEndTimestamp: request.windowEndTimestamp,
          relatedHopTxHash: request.relatedHopTxHash,
          candidateTxHash: request.candidateTxHash,
          requestedByJobId: input.jobId,
          queuedReason: "where_candidate_window",
          budgetPages: 200,
          maxAttempts: 3
        });
    states.push(state);
    if (!isTargetedHistoryFinished(state)) {
      await input.deps.upsertForensicJobWait?.({
        jobId: input.jobId,
        address: request.address,
        targetTimestamp: request.targetTimestamp,
        requestKind: "candidate_window",
        windowStartTimestamp: request.windowStartTimestamp,
        windowEndTimestamp: request.windowEndTimestamp,
        relatedHopTxHash: request.relatedHopTxHash,
        candidateTxHash: request.candidateTxHash,
        requiredFor: "where_hop",
        statusReason: state.statusReason,
        lastError: state.lastError
      });
    }
  }
  if (states.every(isTargetedHistoryCovered)) return true;
  const persisted = await input.persistProgress(candidateWindowWaitingProgressPatch({
    requests: input.requests,
    states
  }));
  const released = await input.deps.releaseForensicCheckJobToWaiting({
    id: input.jobId,
    progressJson: persisted ?? input.progressJson,
    lastError: null
  });
  if (!released) throw new Error("candidate_window_wait_release_failed");
  throw new TargetedHistoryWaitingForIndex();
}
```

Make `isTargetedHistoryFinished` usable in this function by moving it above or keeping it in the same module.

- [ ] **Step 4: Run coordinator tests**

Run:

```powershell
npm test -- tests/forensics/targetedHistoryCoordinator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add src/forensics/targetedHistoryCoordinator.ts tests/forensics/targetedHistoryCoordinator.test.ts
git diff --cached --check
git commit -m "feat(where): wait on candidate windows"
```

Expected: commit succeeds.

---

### Task 5: Integrate Candidate Windows Into Where Before Broad Fallback

**Files:**
- Modify: `src/forensics/moneyOriginTrace.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Modify: `src/index.ts`
- Test: `tests/forensics/moneyOriginTrace.test.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write failing Where behavior test**

Add a focused test in `tests/check/whereIsMoneyCheck.test.ts` near existing targeted wait/provenance tests:

```ts
it("requests candidate windows before broad targeted fallback for probable funding provenance", async () => {
  const hop = edge("hop-tx-1", "THop111111111111111111111111111111", "TSubject1111111111111111111111111", "100000000", "2026-07-04T12:00:00.000Z");
  const funding = edge("candidate-tx-1", "TFunder111111111111111111111111111", "THop111111111111111111111111111111", "100000000", "2026-07-04T11:59:00.000Z");
  const byAddress = new Map<string, ForensicRouteEdge[]>([
    ["TSubject1111111111111111111111111", [hop]],
    ["THop111111111111111111111111111111", [funding, hop]]
  ]);
  const candidateWindows: unknown[] = [];
  const broadTargets: unknown[] = [];

  await expect(runWhereIsMoneyCheck({
    subjectAddress: "TSubject1111111111111111111111111",
    windowStart: new Date("2026-07-04T00:00:00.000Z"),
    windowEnd: new Date("2026-07-04T12:01:00.000Z"),
    requestedAmountRaw: "100000000",
    deps: {
      getTrc20Balance: async () => "0",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: 2,
        oldestFetchedTransferAt: "2026-07-04T11:59:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: false,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        throw new Error("targeted_history_waiting_for_index");
      },
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }
  })).rejects.toThrow("targeted_history_waiting_for_index");

  expect(candidateWindows).toHaveLength(1);
  expect(candidateWindows[0]).toMatchObject({
    address: "THop111111111111111111111111111111",
    candidateTxHash: "candidate-tx-1",
    relatedHopTxHash: "hop-tx-1"
  });
  expect(broadTargets).toEqual([]);
});
```

Adjust the harness to match the existing `runWhereIsMoneyCheck` test helper style; keep the assertion that candidate windows are requested and broad fallback is not requested first.

- [ ] **Step 2: Run Where test to verify failure**

Run:

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because no `requestCandidateWindows` hook exists.

- [ ] **Step 3: Add hooks to Where deps**

In `src/check/whereIsMoneyCheck.ts`, extend `WhereIsMoneyDeps`:

```ts
  requestCandidateWindows?(requests: WhereCandidateWindowRequest[]): Promise<true>;
  ensureBroadTargetedHistory?(input: {
    address: string;
    targetTimestamp: Date;
    queuedReason: "where_is_money_hop";
  }): Promise<true>;
```

Use the existing broad targeted hook if it has a different local name. The invariant is that candidate-window hook runs before broad wait for probable funding provenance.

- [ ] **Step 4: Add trace hook input**

In `src/forensics/moneyOriginTrace.ts`, extend `TraceMoneyOriginPathInput` with:

```ts
  requestCandidateWindows?(requests: WhereCandidateWindowRequest[]): Promise<true>;
```

After `effectiveSourceProvenance` is computed and before the incomplete path is pushed for `incoming_history_not_fetched`, add:

```ts
const candidateWindowRequests = selectCandidateWindowsForSourceProvenance({
  sourceProvenance: effectiveSourceProvenance,
  maxWindowsPerHop: 5
});
if (candidateWindowRequests.length > 0 && input.requestCandidateWindows) {
  await input.requestCandidateWindows(candidateWindowRequests);
}
```

Import `selectCandidateWindowsForSourceProvenance`.

- [ ] **Step 5: Pass hook from Where to trace**

In `src/check/whereIsMoneyCheck.ts`, pass:

```ts
requestCandidateWindows: deps.requestCandidateWindows,
```

into `traceMoneyOriginPath`.

- [ ] **Step 6: Wire runtime hook in `src/index.ts`**

In the Where job deps object, add:

```ts
requestCandidateWindows: (requests) => ensureCandidateWindowsOrWait({
  jobId: job.id,
  requests: requests.slice(0, 20),
  progressJson: job.progressJson,
  deps: {
    getAddressUsdtIndexState: (input) => getTronAddressUsdtIndexState(db, input),
    getCoveringAddressUsdtIndexState: (input) => getCoveringTronAddressUsdtIndexState(db, input),
    queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
      address: input.address,
      coverageMode: input.coverageMode,
      requestKind: input.requestKind ?? "candidate_window",
      targetTimestamp: input.targetTimestamp ?? null,
      windowStartTimestamp: input.windowStartTimestamp ?? null,
      windowEndTimestamp: input.windowEndTimestamp ?? null,
      relatedHopTxHash: input.relatedHopTxHash ?? null,
      candidateTxHash: input.candidateTxHash ?? null,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null,
      priority: 240,
      nextRunAt: new Date(),
      budgetPages: input.budgetPages ?? 200,
      maxAttempts: input.maxAttempts ?? 3
    }),
    releaseForensicCheckJobToWaiting: (input) => releaseForensicCheckJobToWaiting(db, input),
    upsertForensicJobWait: (input) => upsertForensicJobWait(db, input),
    markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input)
  },
  persistProgress: (patch) => updateForensicCheckJobProgress(db, { id: job.id, patch })
})
```

Use the current local job variable name in `src/index.ts`.

- [ ] **Step 7: Boundary behavior**

Before calling `requestCandidateWindows`, skip candidate windows if the current hop address is already classified as service/boundary in the trace state. Use existing service classification checks already present in `moneyOriginTrace.ts`; do not add a new classifier.

The code branch should result in the existing incomplete/boundary path, not a new broad targeted wait.

- [ ] **Step 8: Run focused Where tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

Run:

```powershell
git add src/forensics/moneyOriginTrace.ts src/check/whereIsMoneyCheck.ts src/index.ts tests/forensics/moneyOriginTrace.test.ts tests/check/whereIsMoneyCheck.test.ts
git diff --cached --check
git commit -m "feat(where): try candidate windows before broad fallback"
```

Expected: commit succeeds.

---

### Task 6: Resume Parent Jobs After Candidate Windows Finish

**Files:**
- Modify: `src/storage/repositories.ts`
- Modify: `src/forensics/addressIndexWorker.ts`
- Modify: `src/index.ts`
- Test: `tests/storage/forensicCheckJobs.test.ts`
- Test: `tests/forensics/addressIndexWorker.test.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing wakeup test**

In `tests/storage/forensicCheckJobs.test.ts`, add:

```ts
it("marks a Where job ready only after all candidate-window waits are terminal", async () => {
  const db = createTestDb();
  const job = await createOrReuseForensicCheckJob(db.db, {
    kind: "where_is_money_check",
    subjectAddress: "TSubject1111111111111111111111111",
    windowStart: new Date("2026-07-04T00:00:00.000Z"),
    windowEnd: new Date("2026-07-04T12:00:00.000Z"),
    priority: 100,
    chatId: null,
    requestedBy: "test",
    progressJson: { jobPhase: "checking_candidate_windows" }
  });
  const targetTimestamp = new Date("2026-07-04T12:00:00.000Z");
  const firstStart = new Date("2026-07-04T11:55:00.000Z");
  const secondStart = new Date("2026-07-04T11:58:00.000Z");

  await upsertForensicJobWait(db.db, {
    jobId: job.id,
    address: "THop111111111111111111111111111111",
    targetTimestamp,
    requiredFor: "where_hop",
    requestKind: "candidate_window",
    windowStartTimestamp: firstStart,
    windowEndTimestamp: targetTimestamp,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-1"
  });
  await upsertForensicJobWait(db.db, {
    jobId: job.id,
    address: "THop111111111111111111111111111111",
    targetTimestamp,
    requiredFor: "where_hop",
    requestKind: "candidate_window",
    windowStartTimestamp: secondStart,
    windowEndTimestamp: targetTimestamp,
    relatedHopTxHash: "hop-tx-1",
    candidateTxHash: "candidate-tx-2"
  });

  const firstWake = await markWaitingForensicJobsReadyAfterCandidateWindowIndex(db.db, {
    address: "THop111111111111111111111111111111",
    targetTimestamp,
    windowStartTimestamp: firstStart,
    candidateTxHash: "candidate-tx-1",
    indexStatus: "complete",
    statusReason: "complete_provider_windowed",
    lastError: null
  });
  expect(firstWake).toBe(0);

  const secondWake = await markWaitingForensicJobsReadyAfterCandidateWindowIndex(db.db, {
    address: "THop111111111111111111111111111111",
    targetTimestamp,
    windowStartTimestamp: secondStart,
    candidateTxHash: "candidate-tx-2",
    indexStatus: "complete",
    statusReason: "complete_provider_windowed",
    lastError: null
  });
  expect(secondWake).toBe(1);

  const ready = await getForensicCheckJob(db.db, job.id);
  expect(ready?.progressJson.jobPhase).toBe("reading_local_index");
});
```

- [ ] **Step 2: Run wakeup test to verify failure**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: FAIL until the candidate-window wakeup function is implemented/exported.

- [ ] **Step 3: Implement candidate-window wakeup**

Implement `markWaitingForensicJobsReadyAfterCandidateWindowIndex` in `src/storage/repositories.ts`:

```ts
export async function markWaitingForensicJobsReadyAfterCandidateWindowIndex(
  db: Db,
  input: {
    address: string;
    targetTimestamp: Date | null;
    windowStartTimestamp: Date | null;
    candidateTxHash: string | null;
    indexStatus: TronAddressUsdtIndexStatus;
    statusReason: TronAddressUsdtCoverageStatusReason | null;
    lastError: string | null;
    state?: TronAddressUsdtIndexState | null;
  }
): Promise<number> {
  if (!input.targetTimestamp || !input.windowStartTimestamp || !input.candidateTxHash) return 0;
  if (input.indexStatus === "queued" || input.indexStatus === "running" || input.indexStatus === "failed_retryable") return 0;
  const waitStatus: ForensicJobWaitStatus = input.indexStatus === "complete" ? "ready" : "terminal";
  const phase = input.indexStatus === "complete" ? "reading_local_index" : "provider_limited";
  const result = await db.query(
    `with affected_waits as (
       update forensic_job_waits wait
       set status = $5,
         status_reason = $6,
         last_error = $7,
         updated_at = now()
       where wait.wait_type = 'targeted_usdt_history'
         and wait.request_kind = 'candidate_window'
         and wait.address = $1
         and wait.coverage_mode = 'targeted'
         and wait.target_timestamp_ms = $2
         and wait.window_start_timestamp_ms = $3
         and wait.candidate_tx_hash = $4
         and wait.status = 'waiting'
       returning job_id
     ),
     ready_jobs as (
       select distinct job_id
       from affected_waits affected
       where not exists (
         select 1
         from forensic_job_waits wait
         where wait.job_id = affected.job_id
           and wait.request_kind = 'candidate_window'
           and wait.status = 'waiting'
       )
     )
     update forensic_check_jobs job
     set progress_json = progress_json
       || jsonb_build_object(
         'jobPhase', $8::text,
         'jobHeartbeatAt', $9::text,
         'targetedIndex', coalesce(progress_json->'targetedIndex', '{}'::jsonb)
           || jsonb_build_object(
             'phase', $8::text,
             'candidateWindowsComplete', true,
             'lastIndexedAddress', $1::text,
             'lastIndexedTargetTimestamp', $10::text,
             'lastCandidateWindowStartTimestamp', $11::text,
             'lastCandidateTxHash', $4::text,
             'lastIndexStatus', $12::text,
             'statusReason', $6::text,
             'lastError', $7::text,
             'broadFallback', case when $12::text = 'complete' then 'not_needed_yet' else 'pending_decision' end
           )
       ),
       last_error = $7,
       updated_at = now()
     where job.id in (select job_id from ready_jobs)
       and job.status = 'queued'
       and job.progress_json->>'jobPhase' = 'checking_candidate_windows'`,
    [
      input.address,
      input.targetTimestamp.getTime(),
      input.windowStartTimestamp.getTime(),
      input.candidateTxHash,
      waitStatus,
      input.statusReason,
      input.lastError,
      phase,
      new Date().toISOString(),
      input.targetTimestamp.toISOString(),
      input.windowStartTimestamp.toISOString(),
      input.indexStatus
    ]
  );
  return result.rowCount ?? 0;
}
```

- [ ] **Step 4: Wire worker wakeup**

In `src/forensics/addressIndexWorker.ts`, add dependency:

```ts
    markWaitingForensicJobsReadyAfterCandidateWindowIndex?(input: {
      address: string;
      targetTimestamp: Date | null;
      windowStartTimestamp: Date | null;
      candidateTxHash: string | null;
      indexStatus: TronAddressUsdtIndexStatus;
      statusReason: TronAddressUsdtCoverageStatusReason | null;
      lastError: string | null;
      state?: TronAddressUsdtIndexState | null;
    }): Promise<number | boolean>;
```

After `ensureAddressUsdtHistory`, branch:

```ts
if (state.coverageMode === "targeted" && state.requestKind === "candidate_window") {
  await deps.markWaitingForensicJobsReadyAfterCandidateWindowIndex?.({
    address: completed.address,
    targetTimestamp: completed.targetTimestamp,
    windowStartTimestamp: completed.windowStartTimestamp,
    candidateTxHash: completed.candidateTxHash,
    indexStatus: completed.status,
    statusReason: completed.statusReason,
    lastError: completed.lastError,
    state: completed
  });
} else if (state.coverageMode === "targeted") {
  await deps.markWaitingForensicJobsReadyAfterTargetedIndex?.({
    address: completed.address,
    targetTimestamp: completed.targetTimestamp,
    indexStatus: completed.status,
    statusReason: completed.statusReason,
    lastError: completed.lastError,
    state: completed
  });
}
```

Apply the same branch in the `catch` path.

- [ ] **Step 5: Wire `src/index.ts`**

Import and pass:

```ts
markWaitingForensicJobsReadyAfterCandidateWindowIndex
```

into `runAddressIndexWorkerOnce`.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/storage/forensicCheckJobs.test.ts tests/forensics/addressIndexWorker.test.ts tests/admin/adminServer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```powershell
git add src/storage/repositories.ts src/forensics/addressIndexWorker.ts src/index.ts tests/storage/forensicCheckJobs.test.ts tests/forensics/addressIndexWorker.test.ts tests/admin/adminServer.test.ts
git diff --cached --check
git commit -m "feat(where): resume jobs after candidate windows"
```

Expected: commit succeeds.

---

### Task 7: Add Admin Progress For Candidate Windows

**Files:**
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminServer.test.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing Admin server test**

Add to `tests/admin/adminServer.test.ts`:

```ts
it("hydrates candidate-window progress for waiting Where graph", async () => {
  const deps = adminDeps({
    jobs: [{
      ...jobSummary("job-1"),
      kind: "where_is_money_check",
      status: "queued",
      progressJson: {
        jobPhase: "checking_candidate_windows",
        targetedIndex: {
          phase: "checking_candidate_windows",
          candidateWindows: { total: 2, queued: 1, running: 1, complete: 0, terminal: 0, pending: 2 },
          broadFallback: "not_queued"
        }
      }
    }],
    getTargetedHistoryProgressForJob: async () => ({
      candidateWindows: {
        total: 2,
        states: [
          { address: "THop", status: "running", requestKind: "candidate_window", candidateTxHash: "candidate-tx-1" }
        ]
      }
    })
  });
  const server = await startAdminServer(deps);
  const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
    headers: { authorization: "Bearer test-token" }
  });
  const body = await response.json();

  expect(body.summary.layerSummary.targetedIndex.phase).toBe("checking_candidate_windows");
  expect(body.summary.layerSummary.targetedHistory.candidateWindows.total).toBe(2);
});
```

Use existing `adminDeps`/`jobSummary` helper names from the file.

- [ ] **Step 2: Run Admin server test to verify failure**

Run:

```powershell
npm test -- tests/admin/adminServer.test.ts
```

Expected: FAIL because hydration currently only checks `waiting_for_targeted_index`.

- [ ] **Step 3: Hydrate candidate-window progress**

In `src/admin/adminServer.ts`, update `withTargetedHistoryProgress`:

```ts
const phase = stringProgressField(job, "jobPhase");
if (phase !== "waiting_for_targeted_index" && phase !== "checking_candidate_windows") return job;
```

No new endpoint is needed.

- [ ] **Step 4: Write failing Admin console test**

Add to `tests/admin/adminConsole.test.ts` near `targetedIndexLines` tests:

```ts
it("describes candidate-window indexing separately from broad fallback", () => {
  const api = adminTargetedIndexHelpers();
  const html = api.targetedIndexLines({
    layerSummary: {
      targetedIndex: {
        phase: "checking_candidate_windows",
        candidateWindows: { total: 5, queued: 2, running: 1, complete: 2, terminal: 0, pending: 3 },
        broadFallback: "not_queued"
      }
    }
  });

  expect(html).toContain("Checking candidate windows: 2/5 complete");
  expect(html).toContain("Broad fallback: not queued");
});
```

- [ ] **Step 5: Update Admin copy**

In `src/admin/adminConsole.ts:targetedIndexLines`, add before the broad waiting line:

```js
if (targeted?.phase === "checking_candidate_windows") {
  const windows = targeted.candidateWindows || {};
  lines.push("Checking candidate windows: " + (windows.complete || 0) + "/" + (windows.total || 0) + " complete");
  if (windows.queued !== null && windows.queued !== undefined) lines.push("Candidate windows queued: " + windows.queued);
  if (windows.running !== null && windows.running !== undefined) lines.push("Candidate windows running: " + windows.running);
  if (windows.terminal !== null && windows.terminal !== undefined) lines.push("Candidate windows terminal: " + windows.terminal);
  if (targeted.broadFallback) lines.push("Broad fallback: " + String(targeted.broadFallback).replace(/_/g, " "));
}
```

Keep the existing `waiting_for_targeted_index` line for broad fallback.

- [ ] **Step 6: Run Admin tests**

Run:

```powershell
npm test -- tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

Run:

```powershell
git add src/admin/adminServer.ts src/admin/adminConsole.ts tests/admin/adminServer.test.ts tests/admin/adminConsole.test.ts
git diff --cached --check
git commit -m "feat(admin): show where candidate-window progress"
```

Expected: commit succeeds.

---

### Task 8: Documentation And Full Verification

**Files:**
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`

- [ ] **Step 1: Update data coverage docs**

In `docs/knowledge/04-data-sources-tronscan-indexing.md`, add:

```md
## Candidate Window Targeted Indexing

Where can queue a targeted `candidate_window` request with both lower and
upper timestamps. Broad targeted indexing still reads `genesis ->
targetTimestamp`; candidate windows read `windowStartTimestamp ->
windowEndTimestamp`.

Candidate-window coverage is narrow proof only. It must not satisfy broad
targeted coverage lookups.
```

- [ ] **Step 2: Update Where docs**

In `docs/knowledge/05-where-is-money-and-incoming.md`, add:

```md
## Where Candidate-Window-First Indexing

For a probable funding source on a concrete hop, Where first queues narrow
candidate windows for strong incoming funding candidates. After those windows
complete, the parent Where job resumes and re-runs funding-first provenance.
Broad targeted fallback is queued only if exact candidate windows do not cover
the material amount and the hop address is not a service/high-degree boundary.

Incoming is not yet switched to this flow.
```

- [ ] **Step 3: Update Admin docs**

In `docs/knowledge/08-admin-and-bot-ux.md`, add:

```md
## Where Candidate Window Progress

Admin distinguishes `checking_candidate_windows` from broad
`waiting_for_targeted_index`. The UI shows candidate-window counts and whether
broad fallback is not queued, queued, or running.
```

- [ ] **Step 4: Update decisions**

In `docs/knowledge/09-current-decisions.md`, add:

```md
## 2026-07-04 - Where candidate-window-first indexing

Where now tries durable candidate windows before broad targeted fallback.
Candidate-window index states carry a request kind and lower time bound, and
must not be treated as broad address-history coverage.
```

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm test
npm run typecheck
git diff --check
```

Expected:

```text
npm test: pass
npm run typecheck: pass
git diff --check: no output
```

- [ ] **Step 6: Commit docs**

Run:

```powershell
git add docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md
git diff --cached --check
git commit -m "docs(where): document candidate window indexing"
```

Expected: commit succeeds.

- [ ] **Step 7: Push branch**

Run:

```powershell
git status --short --branch
git push origin codex/where-candidate-window-first-indexing
```

Expected: branch pushes without force.

---

## Final Acceptance

The implementation is complete only when:

- candidate-window index states can coexist for the same address/end timestamp;
- candidate-window states are never returned as broad targeted coverage;
- worker provider calls for candidate windows use `windowStartTimestamp -> windowEndTimestamp`;
- Where queues candidate windows before broad fallback for probable funding provenance;
- Where broad fallback still runs when exact candidate windows do not cover material amount;
- service/high-degree boundaries do not queue deeper candidate windows;
- parent Where jobs resume after all candidate windows are terminal;
- Admin shows `checking_candidate_windows` and broad fallback state separately;
- `npm test`, `npm run typecheck`, and `git diff --check` pass.
