# Unified Wallet Check Durable Ordered Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add migration 034, durable canonical planning/admission, atomic ordered-result acceptance, and bounded ordered commit while keeping barrier admission as the safe default.

**Architecture:** `unified_check_tasks` remains the execution authority. A new PostgreSQL planner table stores capacity-independent sequence, durable admission/reservations, and merge-state only; the traversal coordinator plans all newly mandatory identities, workers accept manifests atomically, and the existing traversal checkpoint advances with a bounded ready-prefix in one transaction.

**Tech Stack:** TypeScript 5.7, Node.js, PostgreSQL, `pg`, Vitest, canonical JSON/SHA-256 artifacts, existing Unified task/worker runtime.

**Design:** `docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md`

**Starting point:** commit `3155f628`; current production admission remains barrier until Plan 2.

---

## File map

- Create `migrations/034_unified_check_adaptive_planner.sql`: additive planner,
  admission, indexes, constraints, and `fairness_owner_id`.
- Create `src/unifiedCheck/planner.ts`: canonical planner types, stable ordering,
  bounded prefix selection, and byte-limit validation.
- Create `src/unifiedCheck/plannerRepository.ts`: run-row-locked planning,
  durable admission, ready-prefix reads, and atomic prefix commit.
- Modify `src/unifiedCheck/repository.ts`: atomic artifact/attempt/task/planner
  acceptance, idempotent lost-response replay, and planner-aware claim guards.
- Modify `src/unifiedCheck/worker.ts` and
  `src/unifiedCheck/productionWorker.ts`: carry a final accepted artifact and
  ordered checkpoint metadata through the existing worker cycle.
- Modify `src/unifiedCheck/productionAddressHistory.ts`: return the final
  manifest to acceptance instead of persisting it separately.
- Modify `src/unifiedCheck/productionTraversalCoordinator.ts`: plan the full
  newly mandatory backlog, consume only a bounded ready-prefix, and return
  ordered commit metadata.
- Modify `src/unifiedCheck/productionRuntime.ts`: wire planner repository calls
  into the existing traversal handler.
- Modify `src/unifiedCheck/requestService.ts`: persist stable opaque owner
  identity for new user runs.
- Modify schema/runtime/release verification files to make migration 034
  fail-closed without editing migration 033.
- Add focused tests under `tests/storage`, `tests/unified-check`, and
  `tests/runtime`.
- Update knowledge pages 03, 04, 09, 10, and 12 after behavior is implemented.

### Task 1: Add and verify migration 034

**Files:**
- Create: `migrations/034_unified_check_adaptive_planner.sql`
- Create: `tests/storage/migration034.postgres.test.ts`
- Modify: `src/storage/schemaMigrations.ts`
- Modify: `tests/storage/schemaMigrations.test.ts`
- Modify: `tests/storage/migration033.postgres.test.ts`

- [ ] **Step 1: Write the RED schema test**

Create `tests/storage/migration034.postgres.test.ts`. Apply migrations 001–033
with the existing helper, then apply 034 and assert:

```typescript
expect(REQUIRED_SCHEMA_VERSION).toBe(34);
expect(REQUIRED_SCHEMA_FILENAME)
  .toBe("034_unified_check_adaptive_planner.sql");

const columns = await client.query(`
  select column_name
    from information_schema.columns
   where table_schema = current_schema()
     and table_name = 'unified_check_planner_entries'
   order by ordinal_position
`);
expect(columns.rows.map((row) => row.column_name)).toEqual([
  "run_id",
  "canonical_sequence",
  "task_id",
  "planner_state",
  "result_bytes",
  "admitted_at",
  "reserved_bytes",
  "planned_at",
  "ready_at",
  "committed_at"
]);

await expect(client.query(`
  insert into unified_check_planner_entries (
    run_id, canonical_sequence, task_id, planner_state
  ) values ('run-a', 0, 'task-from-another-run', 'planned')
`)).rejects.toThrow();
```

Also assert migration 033 bytes and checksum remain unchanged.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npm test -- tests/storage/migration034.postgres.test.ts
```

Expected: FAIL because migration 034 and schema constants do not exist.

- [ ] **Step 3: Add the complete additive migration**

Create `migrations/034_unified_check_adaptive_planner.sql`:

```sql
alter table unified_check_runs
  add column fairness_owner_id text;

update unified_check_runs
   set fairness_owner_id = id
 where fairness_owner_id is null;

alter table unified_check_runs
  alter column fairness_owner_id set not null,
  add constraint unified_check_runs_fairness_owner_check
    check (length(btrim(fairness_owner_id)) > 0);

alter table unified_check_tasks
  add constraint unified_check_tasks_run_id_id_key unique (run_id, id);

create table unified_check_planner_entries (
  run_id text not null references unified_check_runs(id),
  canonical_sequence bigint not null,
  task_id text not null,
  planner_state text not null,
  result_bytes bigint,
  admitted_at timestamptz,
  reserved_bytes bigint,
  planned_at timestamptz not null default statement_timestamp(),
  ready_at timestamptz,
  committed_at timestamptz,
  primary key (run_id, canonical_sequence),
  unique (run_id, task_id),
  foreign key (run_id, task_id)
    references unified_check_tasks(run_id, id),
  check (canonical_sequence >= 0),
  check (result_bytes is null or result_bytes >= 0),
  check (reserved_bytes is null or reserved_bytes >= 0),
  check (planner_state in ('planned', 'ready', 'committed')),
  check (
    (
      planner_state = 'planned'
      and result_bytes is null
      and ready_at is null
      and committed_at is null
      and (
        (admitted_at is null and reserved_bytes is null)
        or
        (admitted_at is not null and reserved_bytes is not null)
      )
    )
    or
    (
      planner_state = 'ready'
      and admitted_at is not null
      and reserved_bytes is null
      and result_bytes is not null
      and ready_at is not null
      and committed_at is null
    )
    or
    (
      planner_state = 'committed'
      and admitted_at is not null
      and reserved_bytes is null
      and result_bytes is not null
      and ready_at is not null
      and committed_at is not null
    )
  ),
  check (admitted_at is null or admitted_at >= planned_at),
  check (ready_at is null or ready_at >= admitted_at),
  check (committed_at is null or committed_at >= ready_at)
);

create index unified_check_planner_head_idx
  on unified_check_planner_entries(run_id, canonical_sequence)
  where planner_state <> 'committed';

create index unified_check_planner_ready_prefix_idx
  on unified_check_planner_entries(run_id, canonical_sequence)
  where planner_state = 'ready';

create index unified_check_planner_admitted_task_idx
  on unified_check_planner_entries(run_id, task_id)
  where planner_state = 'planned' and admitted_at is not null;

create index unified_check_planner_buffer_idx
  on unified_check_planner_entries(run_id, planner_state)
  include (result_bytes, reserved_bytes, ready_at, admitted_at);
```

- [ ] **Step 4: Version schema verification through 034**

In `src/storage/schemaMigrations.ts`, keep the 033 constants and add:

```typescript
export const SCHEMA_033_VERSION = 33;
export const SCHEMA_033_FILENAME = "033_unified_wallet_check.sql";
export const REQUIRED_SCHEMA_VERSION = 34;
export const REQUIRED_SCHEMA_FILENAME =
  "034_unified_check_adaptive_planner.sql";

export interface Schema034Verification {
  verified: true;
  version: typeof REQUIRED_SCHEMA_VERSION;
  filename: typeof REQUIRED_SCHEMA_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
  schema032ChecksumSha256: string;
  schema033ChecksumSha256: string;
}
```

Add `verifySchema034Structure()` that checks the exact columns, constraints,
foreign keys, and index names above. Extend tracked migration verification so
034 requires the verified 033 checksum. Do not rename or modify migration 033.

- [ ] **Step 5: Run schema tests and typecheck**

Run:

```powershell
npm test -- tests/storage/migration033.postgres.test.ts tests/storage/migration034.postgres.test.ts tests/storage/schemaMigrations.test.ts
npm run typecheck
```

Expected: all focused tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```powershell
git add migrations/034_unified_check_adaptive_planner.sql src/storage/schemaMigrations.ts tests/storage/migration033.postgres.test.ts tests/storage/migration034.postgres.test.ts tests/storage/schemaMigrations.test.ts
git commit -m "feat(storage): add unified ordered planner schema"
```

### Task 2: Lock canonical planner ordering and bounded prefix rules

**Files:**
- Create: `src/unifiedCheck/planner.ts`
- Create: `tests/unified-check/planner.test.ts`

- [ ] **Step 1: Write RED pure planner tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  canonicalOrderedTasks,
  selectBoundedReadyPrefix
} from "../../src/unifiedCheck/planner";

describe("Unified canonical planner", () => {
  it("orders by kind and logical identity, never random task id", () => {
    const tasks = canonicalOrderedTasks([
      { taskId: "random-z", kind: "address_history", logicalKey: "b" },
      { taskId: "random-a", kind: "address_history", logicalKey: "a" }
    ]);
    expect(tasks.map((task) => task.logicalKey)).toEqual(["a", "b"]);
  });

  it("takes only one continuous ready prefix within both bounds", () => {
    expect(selectBoundedReadyPrefix([
      { canonicalSequence: 7, plannerState: "ready", resultBytes: 4 },
      { canonicalSequence: 8, plannerState: "ready", resultBytes: 5 },
      { canonicalSequence: 9, plannerState: "planned", resultBytes: null },
      { canonicalSequence: 10, plannerState: "ready", resultBytes: 1 }
    ], { maxEntries: 8, maxBytes: 8 })).toEqual([
      expect.objectContaining({ canonicalSequence: 7 })
    ]);
  });
});
```

- [ ] **Step 2: Confirm RED**

```powershell
npm test -- tests/unified-check/planner.test.ts
```

Expected: FAIL because `planner.ts` does not exist.

- [ ] **Step 3: Implement the complete pure contract**

```typescript
export type UnifiedPlannerState = "planned" | "ready" | "committed";

export type UnifiedOrderedTaskIdentity = {
  readonly taskId: string;
  readonly kind: string;
  readonly logicalKey: string;
};

export type UnifiedPlannerPrefixEntry = {
  readonly canonicalSequence: number;
  readonly plannerState: UnifiedPlannerState;
  readonly resultBytes: number | null;
};

function requiredText(value: string, code: string): string {
  if (value.trim().length === 0) throw new TypeError(code);
  return value;
}

export function canonicalOrderedTasks(
  tasks: readonly UnifiedOrderedTaskIdentity[]
): UnifiedOrderedTaskIdentity[] {
  const byIdentity = new Map<string, UnifiedOrderedTaskIdentity>();
  for (const task of tasks) {
    const kind = requiredText(task.kind, "unified_planner_kind_invalid");
    const logicalKey = requiredText(
      task.logicalKey,
      "unified_planner_logical_key_invalid"
    );
    const identity = `${kind}\u0000${logicalKey}`;
    const existing = byIdentity.get(identity);
    if (existing && existing.taskId !== task.taskId) {
      throw new Error("unified_planner_task_identity_conflict");
    }
    byIdentity.set(identity, { ...task, kind, logicalKey });
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.logicalKey.localeCompare(right.logicalKey)
  );
}

export function selectBoundedReadyPrefix<T extends UnifiedPlannerPrefixEntry>(
  entries: readonly T[],
  limits: { maxEntries: number; maxBytes: number }
): T[] {
  if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1) {
    throw new TypeError("unified_planner_commit_entries_invalid");
  }
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
    throw new TypeError("unified_planner_commit_bytes_invalid");
  }
  if (entries.length === 0) {
    return [];
  }

  const selected: T[] = [];
  let expected = entries[0]!.canonicalSequence;
  let bytes = 0;
  for (const entry of entries) {
    if (
      entry.plannerState !== "ready" ||
      entry.canonicalSequence !== expected ||
      entry.resultBytes === null
    ) break;
    if (
      selected.length >= limits.maxEntries ||
      bytes + entry.resultBytes > limits.maxBytes
    ) break;
    selected.push(entry);
    bytes += entry.resultBytes;
    expected += 1;
  }
  return selected;
}
```

- [ ] **Step 4: Run GREEN**

```powershell
npm test -- tests/unified-check/planner.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/planner.ts tests/unified-check/planner.test.ts
git commit -m "feat(unified-check): define canonical planner rules"
```

### Task 3: Persist stable owner identity and capacity-independent plans

**Files:**
- Create: `src/unifiedCheck/plannerRepository.ts`
- Create: `tests/unified-check/plannerRepository.postgres.test.ts`
- Modify: `src/unifiedCheck/requestService.ts`
- Modify: `tests/unified-check/requestService.test.ts`
- Modify: `tests/unified-check/requestService.postgres.test.ts`

- [ ] **Step 1: Write RED PostgreSQL planning tests**

Apply migrations 033 and 034. Create a run and call the planned repository API
twice with the same `(kind, logicalKey)` values but different random task IDs.
Assert:

```typescript
expect(first.map((entry) => entry.canonicalSequence)).toEqual([0, 1, 2]);
expect(second.map((entry) => entry.canonicalSequence)).toEqual([0, 1, 2]);
expect(await client.query(
  "select count(*)::int as count from unified_check_planner_entries"
)).toMatchObject({ rows: [{ count: 3 }] });
expect(await client.query(
  "select count(*)::int as count from unified_check_tasks"
)).toMatchObject({ rows: [{ count: 3 }] });
```

Run two concurrent planning calls and assert the run-row `FOR UPDATE` produces
one append-only sequence without duplicate identities.

- [ ] **Step 2: Confirm RED**

```powershell
npm test -- tests/unified-check/plannerRepository.postgres.test.ts
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the planner repository API**

Export these exact operations from `plannerRepository.ts`:

```typescript
export type UnifiedOrderedTaskPlanInput = {
  readonly taskId: string;
  readonly kind: string;
  readonly logicalKey: string;
  readonly priorityLane: "interactive" | "repair" | "background";
  readonly checkpoint: unknown;
};

export async function planUnifiedOrderedTasks(
  db: UnifiedTransactionalQueryable,
  input: {
    runId: string;
    tasks: readonly UnifiedOrderedTaskPlanInput[];
  }
): Promise<Array<{
  taskId: string;
  canonicalSequence: number;
}>>;
```

Inside one transaction:

1. `select id from unified_check_runs where id = $1 for update`.
2. Canonically sort by `kind + logicalKey`.
3. Insert each `unified_check_tasks` row with the existing unique identity.
4. Re-read the actual task ID after conflict.
5. Reuse an existing planner row by `(run_id, task_id)`.
6. Allocate new sequences from `coalesce(max(canonical_sequence), -1) + 1`.
7. Insert planner rows as `planned`, non-admitted.

Do not sort by random `taskId`, completion time, or capacity.

Also export:

```typescript
export async function admitBarrierHead(
  db: UnifiedTransactionalQueryable,
  input: { runId: string; reservedBytes: number }
): Promise<boolean>;

export async function deAdmitUnleasedPlannerTail(
  db: UnifiedTransactionalQueryable,
  input: { runId: string; keepThroughSequence: number }
): Promise<number>;
```

Both operations lock the run row. `admitBarrierHead()` admits only the first
uncommitted `planned` entry. De-admission joins tasks and changes only rows
whose task is not `LEASED`.

- [ ] **Step 4: Store opaque owner at run creation**

Add:

```typescript
export function unifiedFairnessOwnerId(input: {
  runPurpose: UnifiedRunPurpose;
  chatId: string;
  runId: string;
}): string {
  if (input.runPurpose !== "user_check") return input.runId;
  return fingerprintCanonicalArtifact({
    version: "unified-fairness-owner-v1",
    channel: "telegram",
    owner: input.chatId
  });
}
```

Add `fairnessOwnerId` to `AnalysisRunRecord` and `candidateRun`. Insert it into
`unified_check_runs.fairness_owner_id`; reused runs retain their original
owner. Never expose raw `chatId` as a scheduler/Admin identifier.

- [ ] **Step 5: Run focused tests**

```powershell
npm test -- tests/unified-check/plannerRepository.postgres.test.ts tests/unified-check/requestService.test.ts tests/unified-check/requestService.postgres.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/unifiedCheck/plannerRepository.ts src/unifiedCheck/requestService.ts tests/unified-check/plannerRepository.postgres.test.ts tests/unified-check/requestService.test.ts tests/unified-check/requestService.postgres.test.ts
git commit -m "feat(unified-check): persist canonical plans and owner identity"
```

### Task 4: Make ordered acceptance atomic and idempotent

**Files:**
- Modify: `src/forensics/canonicalJson.ts`
- Modify: `src/unifiedCheck/worker.ts`
- Modify: `src/unifiedCheck/productionWorker.ts`
- Modify: `src/unifiedCheck/productionAddressHistory.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Create: `tests/unified-check/orderedAcceptance.postgres.test.ts`
- Modify: `tests/unified-check/productionAddressHistory.test.ts`
- Modify: `tests/unified-check/worker.test.ts`

- [ ] **Step 1: Write RED atomicity and lost-response tests**

Test one ordered address-history task with an admitted planner row:

```typescript
const first = await completeUnifiedTaskAttempt(db, INPUT);
const retryAfterLeaseReleased = await completeUnifiedTaskAttempt(db, INPUT);
expect(retryAfterLeaseReleased.accepted_attempt_id)
  .toBe(first.accepted_attempt_id);

const planner = await db.query(`
  select planner_state, result_bytes, reserved_bytes
    from unified_check_planner_entries
   where run_id = $1 and task_id = $2
`, [RUN_ID, TASK_ID]);
expect(planner.rows[0]).toEqual({
  planner_state: "ready",
  result_bytes: EXPECTED_UTF8_BYTES,
  reserved_bytes: null
});
```

Inject a failure between attempt insert and planner update and assert artifact,
attempt, task acceptance, and planner transition all roll back. Retry with a
different hash must throw `unified_task_acceptance_conflict`.

- [ ] **Step 2: Confirm RED**

```powershell
npm test -- tests/unified-check/orderedAcceptance.postgres.test.ts
```

Expected: current completion throws `unified_task_lease_lost` on the second
call and cannot update planner.

- [ ] **Step 3: Carry the accepted artifact through the worker**

Add to `worker.ts`:

```typescript
export type UnifiedAcceptedArtifact = {
  readonly kind: string;
  readonly schemaVersion: string;
  readonly value: unknown;
};

export type UnifiedCompletedChunkOutcome = {
  readonly kind: "completed";
  readonly attemptId?: string;
  readonly artifactSha256: string;
  readonly acceptedArtifact?: UnifiedAcceptedArtifact;
};
```

Use `UnifiedCompletedChunkOutcome` in `UnifiedChunkOutcome`. Pass
`acceptedArtifact` through `UnifiedTaskCycleRepository.complete()`.

In `productionAddressHistory.ts`, keep page/chunk/exhaustion persistence as-is,
remove the separate final manifest insert, and return:

```typescript
return {
  kind: "completed",
  artifactSha256,
  acceptedArtifact: {
    kind: "address_history_manifest",
    schemaVersion: "1",
    value: artifact
  }
};
```

- [ ] **Step 4: Implement the single acceptance transaction**

Import `canonicalizeArtifactJson` in `repository.ts`. Change
`completeUnifiedTaskAttempt()` to:

1. Lock the task by ID regardless of current status.
2. If already completed, join the accepted attempt and return success only
   when `(task_id, attempt, artifact hash)` matches.
3. Otherwise require the current lease token and attempt.
4. Canonicalize the supplied final artifact, verify its hash, and enforce
   `manifestMaxBytes`.
5. Insert the artifact, attempt, accepted task state, and planner `ready`
   transition in the same transaction.

The byte calculation must be:

```typescript
const canonical = canonicalizeArtifactJson(input.acceptedArtifact.value);
const resultBytes = Buffer.byteLength(canonical, "utf8");
if (resultBytes > input.manifestMaxBytes) {
  throw new Error("unified_ordered_manifest_hard_limit");
}
```

Planner update:

```sql
update unified_check_planner_entries
   set planner_state = 'ready',
       result_bytes = $3,
       reserved_bytes = null,
       ready_at = statement_timestamp()
 where run_id = $1
   and task_id = $2
   and planner_state = 'planned'
returning *
```

Zero rows are valid only for an independent task with no planner entry.

- [ ] **Step 5: Run focused tests**

```powershell
npm test -- tests/unified-check/orderedAcceptance.postgres.test.ts tests/unified-check/productionAddressHistory.test.ts tests/unified-check/worker.test.ts
npm run typecheck
```

Expected: PASS; hard-limit and mismatched-hash cases fail closed.

- [ ] **Step 6: Commit**

```powershell
git add src/forensics/canonicalJson.ts src/unifiedCheck/worker.ts src/unifiedCheck/productionWorker.ts src/unifiedCheck/productionAddressHistory.ts src/unifiedCheck/repository.ts tests/unified-check/orderedAcceptance.postgres.test.ts tests/unified-check/productionAddressHistory.test.ts tests/unified-check/worker.test.ts
git commit -m "feat(unified-check): accept ordered manifests atomically"
```

### Task 5: Replace the traversal barrier with planner actionability

**Files:**
- Modify: `src/unifiedCheck/plannerRepository.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/unifiedCheck/productionTraversalCoordinator.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `src/unifiedCheck/worker.ts`
- Modify: `src/unifiedCheck/productionWorker.ts`
- Modify: `tests/unified-check/addressHistoryTasks.test.ts`
- Modify: `tests/unified-check/productionTraversalCoordinator.test.ts`
- Create: `tests/unified-check/orderedCommit.postgres.test.ts`

- [ ] **Step 1: Write RED claim-actionability tests**

Replace the old assertion for
`history_task.status <> 'COMPLETED'`. Assert traversal is claimable only when:

```text
no planner rows exist for initial planning
or the first uncommitted planner row is ready
or all planner rows are committed for refill/closure
```

Assert an ordered provider task is claimable only with:

```sql
planner.planner_state = 'planned'
and planner.admitted_at is not null
```

Independent tasks without planner rows remain claimable.

Provider eligibility is evaluated at claim/scheduling time: an ordered task has
no preassigned provider group and is eligible only when at least one healthy
group is capable of executing it. Migration 034 must not add a provider-group
ownership column.

- [ ] **Step 2: Confirm RED**

```powershell
npm test -- tests/unified-check/addressHistoryTasks.test.ts tests/unified-check/orderedCommit.postgres.test.ts
```

Expected: FAIL because claim SQL still enforces the old address-history
barrier.

- [ ] **Step 3: Add ordered commit metadata to checkpoint outcomes**

Add:

```typescript
export type UnifiedOrderedCommitExpectation = {
  readonly runId: string;
  readonly expectedDeltaHeadSha256: string | null;
  readonly entries: readonly {
    canonicalSequence: number;
    taskId: string;
    acceptedAttemptId: string;
    resultBytes: number;
  }[];
};
```

Allow checkpoint outcomes and repository checkpoint input to carry
`orderedCommit?: UnifiedOrderedCommitExpectation`.

Make `checkpointUnifiedTask()` transactional. When `orderedCommit` exists,
lock the traversal task and selected planner rows, verify current checkpoint
head plus accepted attempt identities, update checkpoint, and mark the exact
bounded prefix `committed` in the same transaction.

- [ ] **Step 4: Plan all newly mandatory histories before waiting**

In `productionTraversalCoordinator.ts`, extract the current address expansion
block into one function with this contract:

```typescript
type AppliedAddressHistory = {
  readonly checkpoint: TraversalCheckpointV2;
  readonly state: CoordinatorState;
  readonly persistedDeltaSha256: string;
};

async function applyAcceptedAddressHistory(input: {
  context: LoadedTraversalContext;
  checkpoint: TraversalCheckpointV2;
  state: CoordinatorState;
  manifest: AddressHistoryManifestV1;
  persistArtifact: Parameters<
    typeof createUnifiedTraversalCoordinatorHandler
  >[0]["persistArtifact"];
}): Promise<AppliedAddressHistory>;
```

Keep the existing attribution, conservation, terminal proof, and delta logic
inside this function unchanged.

Before returning for missing work:

1. Enumerate every distinct snapshot/address manifest identity currently
   mandatory in canonical frontier order.
2. Remove identities already represented by a task/planner row.
3. Call `planUnifiedOrderedTasks()` once for the full new set.
4. Call `admitBarrierHead()` because Plan 1 remains barrier admission.

Then load the bounded ready-prefix, apply it in sequence, and return one
checkpoint outcome carrying the ordered commit expectation.

- [ ] **Step 5: Wire planner callbacks into production runtime**

Replace `ensureAddressHistories` with explicit callbacks:

```typescript
planAddressHistories: (args) => planUnifiedOrderedTasks(input.db, args),
admitBarrierHead: (args) => admitBarrierHead(input.db, args),
loadReadyPrefix: (args) => loadUnifiedReadyPrefix(input.db, args)
```

Use configuration defaults:

```typescript
const manifestMaxBytes = input.manifestMaxBytes ?? 1_048_576;
const commitMaxEntries = input.commitMaxEntries ?? 32;
const commitMaxBytes = input.commitMaxBytes ?? 8_388_608;
```

Validate `commitMaxBytes >= manifestMaxBytes`.

- [ ] **Step 6: Run focused tests**

```powershell
npm test -- tests/unified-check/addressHistoryTasks.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
npm run typecheck
```

Expected: multiple mandatory histories are planned together; only barrier head
is admitted; checkpoint and committed prefix are atomic.

- [ ] **Step 7: Commit**

```powershell
git add src/unifiedCheck/plannerRepository.ts src/unifiedCheck/repository.ts src/unifiedCheck/productionTraversalCoordinator.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/worker.ts src/unifiedCheck/productionWorker.ts tests/unified-check/addressHistoryTasks.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
git commit -m "feat(unified-check): commit traversal through durable planner"
```

### Task 6: Prove restart, ordering, and barrier-oracle equivalence

**Files:**
- Create: `tests/unified-check/plannerReplay.property.test.ts`
- Create: `tests/unified-check/plannerRestart.postgres.test.ts`
- Modify: `tests/unified-check/verticalSlice.postgres.test.ts`
- Modify: `tests/unified-check/productionRuntime.postgres.test.ts`

- [ ] **Step 1: Add a reproducible seeded property harness**

Use this local generator; do not add a dependency:

```typescript
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const random = seeded(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [result[index], result[selected]] =
      [result[selected]!, result[index]!];
  }
  return result;
}
```

For seeds 1–100 and logical capacities 1, 4, 8, 16, 32, and 100, complete the
same manifests in shuffled order. On failure include
`seed=24072026 capacity=16` in the assertion message, using the actual seed and
capacity for each generated case.

- [ ] **Step 2: Compare exact oracle outputs**

For each case run sequential barrier and shuffled completion replay over the
same frozen inputs. Assert exact equality of:

```typescript
expect(rolling).toMatchObject({
  canonicalFacts: oracle.canonicalFacts,
  frontier: oracle.frontier,
  closureSha256: oracle.closureSha256,
  score: oracle.score,
  decision: oracle.decision,
  evidenceBundleSha256: oracle.evidenceBundleSha256,
  scoringBundleSha256: oracle.scoringBundleSha256,
  reportSha256: oracle.reportSha256,
  deliveryIntentCount: oracle.deliveryIntentCount
});
```

- [ ] **Step 3: Add kill/restart PostgreSQL cases**

Cover process loss:

- after planning and before admission;
- after admission and before claim;
- after manifest acceptance and before coordinator wake;
- after prefix commit and before refill;
- after DB commit and before worker receives acceptance response.

After restart, run the reconciliation entry point once and assert no new
sequence, duplicate attempt acceptance, duplicate canonical fact, or duplicate
delivery intent.

- [ ] **Step 4: Run the milestone**

```powershell
npm test -- tests/unified-check/plannerReplay.property.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/verticalSlice.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
npm run typecheck
```

Expected: PASS for all printed capacities and seeds.

- [ ] **Step 5: Commit**

```powershell
git add tests/unified-check/plannerReplay.property.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/verticalSlice.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
git commit -m "test(unified-check): prove ordered planner restart equivalence"
```

### Task 7: Bind schema 034 into startup and release gates

**Files:**
- Modify: `src/runtime/startupSchemaGate.ts`
- Modify: `src/runtime/runtimeVersion.ts`
- Create: `scripts/verifyCurrentSchema.ts`
- Modify: `scripts/runUnifiedWalletCanary.ts`
- Modify: `tests/runtime/startupSchemaGate.test.ts`
- Create: `tests/runtime/runtimeVersion036.test.ts`
- Create: `tests/storage/migration036.unit.test.ts`
- Create: `tests/storage/migration036.postgres.test.ts`

- [ ] **Step 1: Make release tests RED for schema 034**

Update expected release shape to:

```typescript
versions: {
  schemaVersion: 34
},
schema034: {
  filename: "034_unified_check_adaptive_planner.sql",
  checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
  catalogSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
  cleanVerificationReceiptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
  cloneVerificationReceiptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
}
```

Retain schema 033 checksum as predecessor evidence; do not rename its historical
fields inside already-versioned artifacts without creating a new artifact
version.

- [ ] **Step 2: Confirm RED**

```powershell
npm test -- tests/runtime/startupSchemaGate.test.ts tests/runtime/runtimeVersion036.test.ts tests/storage/migration036.unit.test.ts
```

Expected: FAIL on required schema version/filename and missing 034 receipt.

- [ ] **Step 3: Update fail-closed runtime contracts**

`runStartupSchemaGate()` must accept only `Schema034Verification`.
`RuntimeVersionV1.migration` must validate:

```typescript
{
  verified: true,
  version: 34,
  filename: "034_unified_check_adaptive_planner.sql",
  checksumSha256: string,
  shortChecksum: string,
  schema032ChecksumSha256: string,
  schema033ChecksumSha256: string
}
```

Set new analysis manifests to `databaseSchemaVersion: 34`. Update frozen test
fixtures mechanically; do not change scoring, traversal, or presentation
policies.

- [ ] **Step 4: Bind exact migration bytes and catalog**

Compute the migration checksum:

```powershell
(Get-FileHash -Algorithm SHA256 'migrations/034_unified_check_adaptive_planner.sql').Hash.ToLowerInvariant()
```

Expected: exactly 64 lowercase hex characters. Bind that exact stdout in the
approved schema constants. Generate the catalog hash with the existing schema
verification path, bind it, then rerun with one mutated constraint to confirm
fail-closed rejection.

Update `UNIFIED_RELEASE_COMMANDS.migration_startup_rehearsal` to run:

```text
npx vitest run tests/storage/migration034.postgres.test.ts tests/runtime/startupSchemaGate.test.ts tests/unified-check/productionRuntime.postgres.test.ts --maxWorkers=1
```

- [ ] **Step 5: Run focused release gates**

```powershell
npm test -- tests/storage/migration034.postgres.test.ts tests/storage/migration036.postgres.test.ts tests/runtime/startupSchemaGate.test.ts tests/runtime/runtimeVersion036.test.ts
npm run typecheck
```

Expected: PASS; unknown migration 035 still fails closed.

- [ ] **Step 6: Update knowledge truth**

Update:

- `docs/knowledge/03-job-lifecycle.md`;
- `docs/knowledge/04-data-sources-tronscan-indexing.md`;
- `docs/knowledge/09-current-decisions.md`;
- `docs/knowledge/10-open-problems.md`;
- `docs/knowledge/12-runbooks.md`.

State that schema 034 and barrier-compatible ordered planner are implemented,
but adaptive rolling capacity remains pending Plan 2.

- [ ] **Step 7: Commit**

```powershell
git add src/runtime/startupSchemaGate.ts src/runtime/runtimeVersion.ts scripts/verifyCurrentSchema.ts scripts/runUnifiedWalletCanary.ts tests/runtime/startupSchemaGate.test.ts tests/runtime/runtimeVersion036.test.ts tests/storage/migration036.unit.test.ts tests/storage/migration036.postgres.test.ts docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md
git commit -m "chore(schema): require current unified schema"
```

## Plan 1 completion gate

Run:

```powershell
npm test -- tests/storage/migration034.postgres.test.ts tests/unified-check/planner.test.ts tests/unified-check/plannerRepository.postgres.test.ts tests/unified-check/orderedAcceptance.postgres.test.ts tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/plannerReplay.property.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/runtime/startupSchemaGate.test.ts tests/runtime/runtimeVersion034.test.ts
npm run typecheck
git status --short
```

Expected:

- all focused tests PASS;
- typecheck exits 0;
- only intentionally untracked local evidence remains;
- production admission is still barrier mode;
- schema 033 bytes are unchanged.
