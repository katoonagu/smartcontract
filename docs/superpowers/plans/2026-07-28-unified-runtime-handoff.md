# Unified Runtime Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Unified wallet checks survive a local deployment through a two-generation drain, and turn unrecoverable old-runtime checks into an explicit technical outcome with durable Telegram notification.

**Architecture:** Schema 037 adds a single-owner runtime registry and a separate lifecycle-notification outbox. A small runtime coordinator releases Telegram polling and legacy work while the old process continues only its commit-pinned Unified runs for at most two hours; a transactional reconciler cancels truly orphaned work without producing a score. The existing `check:addr:<address>` callback is reused for the Retry button.

**Tech Stack:** TypeScript 5.7, Node.js, PostgreSQL, grammY, Vitest, existing Unified repositories and startup schedules.

---

## Scope and file map

The implementation stays inside the existing Unified/runtime boundaries and does not change scoring, traversal, attribution, or service-wallet classification.

**Create:**

- `migrations/037_unified_runtime_handoff.sql` — registry, request terminal-shape migration, lifecycle outbox, indexes and constraints.
- `tests/storage/migration037.postgres.test.ts` — real PostgreSQL migration/lineage acceptance.
- `src/unifiedCheck/runtimeHandoffPolicy.ts` — clocks, classification and RU/EN lifecycle copy; no I/O.
- `tests/unified-check/runtimeHandoffPolicy.test.ts` — exact boundary and copy tests.
- `src/unifiedCheck/runtimeHandoffRepository.ts` — registry transitions, orphan transaction, progress enqueue and Admin projection.
- `tests/storage/unifiedRuntimeHandoff.postgres.test.ts` — transaction, idempotency and concurrency tests.
- `src/unifiedCheck/lifecycleNotification.ts` — notification claim validation and Telegram delivery state machine.
- `tests/unified-check/lifecycleNotification.test.ts` — delivery and stale-progress tests.
- `src/runtime/runtimeHandoffCoordinator.ts` — process-local drain orchestration behind injected callbacks.
- `tests/runtime/runtimeHandoffCoordinator.test.ts` — polling-release ordering, completion and deadline tests.
- `scripts/restartBot.ts` — one Windows-safe deployment command using direct process APIs.
- `tests/scripts/restartBot.test.ts` — spawn contract and first-rollout guard tests.

**Modify:**

- `src/storage/schemaMigrations.ts`, `scripts/migrate.ts`, `scripts/verifyCurrentSchema.ts` — make schema 037 the verified runtime gate.
- `src/runtime/runtimeVersion.ts`, `tests/runtime/runtimeVersion036.test.ts` — pin runtime identity to the schema-037 receipt; rename the test to `runtimeVersion037.test.ts`.
- `src/unifiedCheck/delivery.ts` — export only the existing `UnifiedTelegramSendResult` contract for reuse; analytical delivery behavior remains unchanged.
- `src/runtime/startupSchedule.ts`, `tests/runtime/startupSchedule.test.ts` — add one lifecycle worker label.
- `src/index.ts` — register/heartbeat, reconcile, send lifecycle messages, and enter drain without stopping commit-pinned Unified work.
- `src/admin/adminRuntime.ts`, `src/admin/adminServer.ts`, `src/admin/adminConsole.ts`, `tests/admin/adminServer.test.ts` — expose runtime/drain/notification state on the existing Unified Checks page.
- `package.json` — add `bot:restart`.
- `docs/knowledge/03-job-lifecycle.md`, `docs/knowledge/08-admin-and-bot-ux.md`, `docs/knowledge/09-current-decisions.md`, `docs/knowledge/10-open-problems.md` — record shipped behavior and close the silent-orphan symptom.

## Fixed production policy

```ts
export const RUNTIME_HANDOFF_DRAIN_MS = 2 * 60 * 60 * 1_000;
export const RUNTIME_HEARTBEAT_INTERVAL_MS = 10_000;
export const RUNTIME_HEARTBEAT_STALE_MS = 60_000;
export const LONG_RUNNING_NOTIFICATION_DELAY_MS = 5 * 60 * 1_000;
```

The two-hour value is used only after a deployment requests drain. Ordinary checks do not acquire a two-hour timeout. Tests inject shorter clocks into the coordinator; production code does not add an environment override that could silently extend the policy.

### Task 1: Add and verify schema 037

**Files:**

- Create: `migrations/037_unified_runtime_handoff.sql`
- Create: `tests/storage/migration037.postgres.test.ts`
- Modify: `src/storage/schemaMigrations.ts`
- Modify: `tests/storage/schemaMigrations.test.ts`
- Modify: `scripts/migrate.ts`
- Modify: `scripts/verifyCurrentSchema.ts`
- Modify: `src/runtime/runtimeVersion.ts`
- Rename: `tests/runtime/runtimeVersion036.test.ts` → `tests/runtime/runtimeVersion037.test.ts`

- [ ] **Step 1: Write failing schema metadata and runtime-version tests**

Add schema-037 expectations to `tests/storage/schemaMigrations.test.ts` and make the renamed runtime test use this exact fixture:

```ts
const migration037 = {
  verified: true as const,
  version: 37 as const,
  filename: "037_unified_runtime_handoff.sql" as const,
  checksumSha256: "b".repeat(64),
  shortChecksum: "b".repeat(12),
  schema032ChecksumSha256: "c".repeat(64),
  schema033ChecksumSha256: "d".repeat(64),
  schema034ChecksumSha256: "e".repeat(64),
  schema035ChecksumSha256: "f".repeat(64),
  schema036ChecksumSha256: "1".repeat(64)
};

expect(SCHEMA_037_VERSION).toBe(37);
expect(SCHEMA_037_FILENAME).toBe("037_unified_runtime_handoff.sql");
expect(REQUIRED_SCHEMA_VERSION).toBe(37);
expect(REQUIRED_SCHEMA_FILENAME).toBe(SCHEMA_037_FILENAME);
```

Also assert that schema 036 and a schema-037 object missing `schema036ChecksumSha256` are rejected by `validateRuntimeVersion`.

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```powershell
npm.cmd test -- tests/storage/schemaMigrations.test.ts tests/runtime/runtimeVersion037.test.ts
```

Expected: FAIL because `SCHEMA_037_*` and `Schema037Verification` do not exist and runtime version still requires schema 036.

- [ ] **Step 3: Write the migration and PostgreSQL acceptance test**

Create `migrations/037_unified_runtime_handoff.sql` with these complete table shapes:

```sql
create table unified_runtime_instances (
  instance_id text primary key,
  runtime_commit text not null,
  instance_label text not null,
  state text not null,
  started_at timestamptz not null,
  heartbeat_at timestamptz not null,
  drain_requested_at timestamptz,
  drain_deadline_at timestamptz,
  telegram_polling_released_at timestamptz,
  stopped_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unified_runtime_instances_commit_check
    check (runtime_commit ~ '^[0-9a-f]{40}$'),
  constraint unified_runtime_instances_state_check
    check (state in ('ACTIVE','DRAIN_REQUESTED','DRAINING','STOPPED')),
  constraint unified_runtime_instances_state_shape_check check (
    (state = 'ACTIVE' and drain_requested_at is null and drain_deadline_at is null
      and telegram_polling_released_at is null and stopped_at is null)
    or (state = 'DRAIN_REQUESTED' and drain_requested_at is not null
      and drain_deadline_at is not null and telegram_polling_released_at is null
      and stopped_at is null)
    or (state = 'DRAINING' and drain_requested_at is not null
      and drain_deadline_at is not null and telegram_polling_released_at is not null
      and stopped_at is null)
    or (state = 'STOPPED' and stopped_at is not null)
  ),
  constraint unified_runtime_instances_deadline_order_check check (
    drain_deadline_at is null or drain_requested_at is null
      or drain_deadline_at > drain_requested_at
  )
);

create unique index unified_runtime_instances_one_intake_owner_idx
  on unified_runtime_instances ((true))
  where state in ('ACTIVE','DRAIN_REQUESTED')
    and telegram_polling_released_at is null;

create index unified_runtime_instances_compatible_drainer_idx
  on unified_runtime_instances(runtime_commit, heartbeat_at, drain_deadline_at)
  where state = 'DRAINING';

create table unified_check_notifications (
  id text primary key,
  request_id text not null references unified_check_requests(id),
  kind text not null,
  locale text not null,
  copy_version text not null,
  status text not null,
  ready_at timestamptz not null,
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  telegram_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, kind),
  constraint unified_check_notifications_kind_check check (
    kind in ('LONG_RUNNING','FAILED_TECHNICAL_RUNTIME_HANDOFF')
  ),
  constraint unified_check_notifications_locale_check check (locale in ('ru','en')),
  constraint unified_check_notifications_copy_check check (
    copy_version = 'unified-lifecycle-copy-v1'
  ),
  constraint unified_check_notifications_status_check check (
    status in ('PENDING','LEASED','RETRYABLE','SENT_CONFIRMED',
      'DELIVERY_UNKNOWN','CANCELLED')
  ),
  constraint unified_check_notifications_lease_shape_check check (
    (status = 'LEASED' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'LEASED' and lease_token is null and lease_expires_at is null)
  )
);

create index unified_check_notifications_claim_idx
  on unified_check_notifications(status, coalesce(next_attempt_at, ready_at), created_at)
  where status in ('PENDING','RETRYABLE');

do $$
declare request_shape_constraint text;
begin
  select c.conname into request_shape_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'unified_check_requests'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%status = ''ATTACHED''%run_id IS NOT NULL%'
   limit 1;
  if request_shape_constraint is null then
    raise exception 'unified_check_requests_run_shape_constraint_missing';
  end if;
  execute format('alter table unified_check_requests drop constraint %I', request_shape_constraint);
end $$;

alter table unified_check_requests
  add constraint unified_check_requests_run_shape_check check (
    (status = 'ATTACHED' and run_id is not null)
    or status = 'FAILED_TECHNICAL'
    or (status not in ('ATTACHED','FAILED_TECHNICAL') and run_id is null)
  );
```

In `tests/storage/migration037.postgres.test.ts`, apply 032 through 037 in a temporary schema and prove:

```ts
await client.query(`insert into unified_check_requests (
  id, request_correlation_id, run_id, subject_address, chat_id, locale,
  run_purpose, side_effect_policy, status, accepted_at
) values ('request-1','correlation-1','run-1','TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52',
  '1','ru','user_check','authoritative','ATTACHED',now())`);
await expect(client.query(
  `update unified_check_requests
      set status='FAILED_TECHNICAL', status_reason='runtime_handoff_unavailable'
    where id='request-1'`
)).resolves.toMatchObject({ rowCount: 1 });
await expect(client.query(
  `insert into unified_runtime_instances (
    instance_id,runtime_commit,instance_label,state,started_at,heartbeat_at
  ) values ('runtime-2',$1,'second','ACTIVE',now(),now())`,
  ["b".repeat(40)]
)).rejects.toThrow();
```

- [ ] **Step 4: Run the PostgreSQL acceptance test and verify it fails before verifier wiring**

Run:

```powershell
npm.cmd test -- tests/storage/migration037.postgres.test.ts
```

Expected: FAIL because schema-037 constants and tracked-lineage handling are absent. If `TEST_DATABASE_URL` is not set, the test is SKIPPED; use the configured development PostgreSQL URL before accepting this task.

- [ ] **Step 5: Extend the schema verifier and migration scripts minimally**

In `src/storage/schemaMigrations.ts` add `SCHEMA_037_VERSION`, `SCHEMA_037_FILENAME`, `Schema037Verification`, `requiredSchema036Checksum`, `verifySchema037Structure`, and `verifyRequiredSchema037`. Add `allowSchema037Projection` to `SchemaOptions` and thread it through the 033→036 structural checks so predecessor verification tolerates only the named schema-037 additions. Make `verifyRequiredSchema036` honor `allowNewerReceipt: true` when called from 037 verification. The schema-037 structural verifier must query the exact named tables, columns, constraints and indexes above, call `verifyRequiredSchema036` with the verified 036 checksum and projection flags, and fail with `schema_037_catalog_mismatch` for any mismatch. Extend both existing and new-migration branches of `applyVerifiedTrackedMigration` so version 37 verifies the 032→037 checksum chain; before applying 037, verify 036 rather than stopping at 035.

Use this return shape:

```ts
return {
  verified: true,
  version: SCHEMA_037_VERSION,
  filename: SCHEMA_037_FILENAME,
  checksumSha256: expectedChecksum,
  shortChecksum: expectedChecksum.slice(0, 12),
  schema032ChecksumSha256,
  schema033ChecksumSha256,
  schema034ChecksumSha256,
  schema035ChecksumSha256,
  schema036ChecksumSha256
};
```

Update `scripts/migrate.ts` to retain the 036 checksum and pass it to version 37. Update `scripts/verifyCurrentSchema.ts`, `src/runtime/runtimeVersion.ts`, and the renamed runtime test to require `Schema037Verification` and the extra predecessor checksum.

- [ ] **Step 6: Run schema, runtime and type checks**

Run:

```powershell
npm.cmd test -- tests/storage/schemaMigrations.test.ts tests/storage/migration037.postgres.test.ts tests/runtime/runtimeVersion037.test.ts
npm.cmd run typecheck
```

Expected: focused tests PASS (with the PostgreSQL test running, not skipped) and TypeScript exits 0.

- [ ] **Step 7: Commit schema 037**

```powershell
git add migrations/037_unified_runtime_handoff.sql src/storage/schemaMigrations.ts scripts/migrate.ts scripts/verifyCurrentSchema.ts src/runtime/runtimeVersion.ts tests/storage/schemaMigrations.test.ts tests/storage/migration037.postgres.test.ts tests/runtime/runtimeVersion036.test.ts tests/runtime/runtimeVersion037.test.ts
git commit -m "feat(storage): add unified runtime handoff schema"
```

### Task 2: Add pure handoff policy and lifecycle copy

**Files:**

- Create: `src/unifiedCheck/runtimeHandoffPolicy.ts`
- Create: `tests/unified-check/runtimeHandoffPolicy.test.ts`

- [ ] **Step 1: Write failing boundary and copy tests**

Cover a fresh compatible drainer, stale heartbeat, exact deadline, missing runtime, and both locales:

```ts
expect(classifyRuntimeOwnership({
  now: new Date("2026-07-28T10:00:00.000Z"),
  heartbeatStaleMs: 60_000,
  compatibleRuntime: {
    state: "DRAINING",
    heartbeatAt: "2026-07-28T09:59:30.000Z",
    drainDeadlineAt: "2026-07-28T12:00:00.000Z"
  }
})).toBe("recoverable");

expect(classifyRuntimeOwnership({
  now: new Date("2026-07-28T12:00:00.000Z"),
  heartbeatStaleMs: 60_000,
  compatibleRuntime: {
    state: "DRAINING",
    heartbeatAt: "2026-07-28T11:59:59.000Z",
    drainDeadlineAt: "2026-07-28T12:00:00.000Z"
  }
})).toBe("runtime_handoff_deadline_exceeded");

for (const locale of ["ru", "en"] as const) {
  const progress = renderUnifiedLifecycleMessage({
    kind: "LONG_RUNNING", locale,
    address: "TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52"
  });
  expect(progress.text).not.toMatch(/\d+%|ETA|score|риск:\s*\d/iu);
  expect(progress.callbackData).toBeNull();

  const failed = renderUnifiedLifecycleMessage({
    kind: "FAILED_TECHNICAL_RUNTIME_HANDOFF", locale,
    address: "TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52"
  });
  expect(failed.callbackData).toBe("check:addr:TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52");
  expect(failed.text).toMatch(locale === "ru" ? /вывод о риске не сформирован/u : /no risk conclusion/iu);
}
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `npm.cmd test -- tests/unified-check/runtimeHandoffPolicy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the pure module**

Export these exact public contracts:

```ts
export const RUNTIME_HANDOFF_DRAIN_MS = 7_200_000;
export const RUNTIME_HEARTBEAT_INTERVAL_MS = 10_000;
export const RUNTIME_HEARTBEAT_STALE_MS = 60_000;
export const LONG_RUNNING_NOTIFICATION_DELAY_MS = 300_000;
export const UNIFIED_LIFECYCLE_COPY_VERSION = "unified-lifecycle-copy-v1" as const;

export type RuntimeOwnershipClassification =
  | "recoverable"
  | "runtime_handoff_unavailable"
  | "runtime_handoff_deadline_exceeded";

export type UnifiedLifecycleNotificationKind =
  | "LONG_RUNNING"
  | "FAILED_TECHNICAL_RUNTIME_HANDOFF";

export function classifyRuntimeOwnership(input: {
  now: Date;
  heartbeatStaleMs: number;
  compatibleRuntime: null | {
    state: "DRAINING";
    heartbeatAt: string;
    drainDeadlineAt: string;
  };
}): RuntimeOwnershipClassification;

export function renderUnifiedLifecycleMessage(input: {
  kind: UnifiedLifecycleNotificationKind;
  locale: "ru" | "en";
  address: string;
}): {
  text: string;
  parseMode: "HTML";
  buttonText: string | null;
  callbackData: string | null;
};
```

Classification uses `now >= drainDeadline` for deadline expiry and `now - heartbeat > heartbeatStaleMs` for staleness. Validate dates, positive limits and the TRON address before returning. Use short user copy: progress says the wallet has a large history and the result will arrive in this chat; failure says an update interrupted the check, no risk conclusion was produced, and Retry starts the same address again.

- [ ] **Step 4: Run the policy test and typecheck**

Run:

```powershell
npm.cmd test -- tests/unified-check/runtimeHandoffPolicy.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit the pure policy**

```powershell
git add src/unifiedCheck/runtimeHandoffPolicy.ts tests/unified-check/runtimeHandoffPolicy.test.ts
git commit -m "feat(unified): define runtime handoff policy and copy"
```

### Task 3: Implement registry ownership and drain transitions

**Files:**

- Create: `src/unifiedCheck/runtimeHandoffRepository.ts`
- Create: `tests/storage/unifiedRuntimeHandoff.postgres.test.ts`

- [ ] **Step 1: Write failing PostgreSQL registry tests**

Build the test schema through migration 037, then exercise these exported calls with fixed dates:

```ts
await expect(registerActiveRuntime(db, {
  instanceId: "runtime-a",
  runtimeCommit: "a".repeat(40),
  instanceLabel: "local-aaaaaaaa",
  now
})).resolves.toMatchObject({ state: "ACTIVE", ownsTelegramIntake: true });

await expect(registerActiveRuntime(db, {
  instanceId: "runtime-b",
  runtimeCommit: "b".repeat(40),
  instanceLabel: "local-bbbbbbbb",
  now
})).rejects.toThrow("unified_runtime_intake_owned");

const requested = await requestRuntimeDrain(db, {
  instanceId: "runtime-a", now, drainMs: 7_200_000
});
expect(requested.drainDeadlineAt).toBe("2026-07-28T12:00:00.000Z");

await markRuntimePollingReleased(db, {
  instanceId: "runtime-a",
  now: new Date("2026-07-28T10:00:02.000Z")
});
await expect(registerActiveRuntime(db, {
  instanceId: "runtime-b",
  runtimeCommit: "b".repeat(40),
  instanceLabel: "local-bbbbbbbb",
  now: new Date("2026-07-28T10:00:03.000Z")
})).resolves.toMatchObject({ ownsTelegramIntake: true });
```

Also test `heartbeatRuntime`, idempotent repeated drain requests preserving the original deadline, `markRuntimeStopped`, two concurrent registrations yielding exactly one active owner, and detection of a fresh replacement that runs the same Git commit under a different instance ID.

- [ ] **Step 2: Run the registry tests and verify the red state**

Run: `npm.cmd test -- tests/storage/unifiedRuntimeHandoff.postgres.test.ts`

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement transactional registry functions**

Export:

```ts
export type UnifiedRuntimeState =
  | "ACTIVE" | "DRAIN_REQUESTED" | "DRAINING" | "STOPPED";

export type UnifiedRuntimeInstanceV1 = Readonly<{
  instanceId: string;
  runtimeCommit: string;
  instanceLabel: string;
  state: UnifiedRuntimeState;
  startedAt: string;
  heartbeatAt: string;
  drainRequestedAt: string | null;
  drainDeadlineAt: string | null;
  telegramPollingReleasedAt: string | null;
  stoppedAt: string | null;
  failureReason: string | null;
}>;

export async function registerActiveRuntime(
  db: UnifiedTransactionalQueryable,
  input: { instanceId: string; runtimeCommit: string; instanceLabel: string; now: Date }
): Promise<UnifiedRuntimeInstanceV1 & { ownsTelegramIntake: true }>;

export async function heartbeatRuntime(
  db: UnifiedQueryable,
  input: { instanceId: string; now: Date }
): Promise<UnifiedRuntimeInstanceV1>;

export async function requestRuntimeDrain(
  db: UnifiedTransactionalQueryable,
  input: { instanceId: string; now: Date; drainMs: number }
): Promise<UnifiedRuntimeInstanceV1>;

export async function markRuntimePollingReleased(
  db: UnifiedTransactionalQueryable,
  input: { instanceId: string; now: Date }
): Promise<UnifiedRuntimeInstanceV1>;

export async function markRuntimeStopped(
  db: UnifiedTransactionalQueryable,
  input: { instanceId: string; now: Date; failureReason: string | null }
): Promise<UnifiedRuntimeInstanceV1>;

export async function hasLiveEquivalentReplacement(
  db: UnifiedQueryable,
  input: {
    drainingInstanceId: string;
    runtimeCommit: string;
    now: Date;
    heartbeatStaleMs: number;
  }
): Promise<boolean>;
```

Use `pg_advisory_xact_lock(20260728037)` for registration/drain ownership transitions. Do not infer ownership from processes. On registration, a stale `ACTIVE`/`DRAIN_REQUESTED` owner may be marked `STOPPED` with `failure_reason='heartbeat_timeout'` only when its heartbeat is older than `RUNTIME_HEARTBEAT_STALE_MS`; a fresh owner returns `unified_runtime_intake_owned`. Repeated drain requests return the original durable deadline. Validate `drainMs` as an integer from 1 through `RUNTIME_HANDOFF_DRAIN_MS`; production callers always pass the constant and shorter values exist only in tests.

- [ ] **Step 4: Run registry and type checks**

Run:

```powershell
npm.cmd test -- tests/storage/unifiedRuntimeHandoff.postgres.test.ts
npm.cmd run typecheck
```

Expected: registry cases PASS and TypeScript exits 0.

- [ ] **Step 5: Commit registry support**

```powershell
git add src/unifiedCheck/runtimeHandoffRepository.ts tests/storage/unifiedRuntimeHandoff.postgres.test.ts
git commit -m "feat(unified): add runtime ownership registry"
```

### Task 4: Add progress enqueue and atomic orphan terminalization

**Files:**

- Modify: `src/unifiedCheck/runtimeHandoffRepository.ts`
- Modify: `tests/storage/unifiedRuntimeHandoff.postgres.test.ts`

- [ ] **Step 1: Write failing progress and orphan transaction tests**

Seed one authoritative run whose analysis manifest artifact has `runtimeCommit: "a".repeat(40)`, with one completed task, one leased task, one admitted planned entry, one committed planner entry and two attached requests. Assert:

```ts
expect(await enqueueDueLongRunningNotifications(db, {
  now: new Date("2026-07-28T10:05:00.000Z"), limit: 100
})).toBe(2);
expect(await enqueueDueLongRunningNotifications(db, {
  now: new Date("2026-07-28T10:06:00.000Z"), limit: 100
})).toBe(0);

const result = await reconcileOrphanedUnifiedRuns(db, {
  now: new Date("2026-07-28T10:06:00.000Z"),
  heartbeatStaleMs: 60_000,
  currentRuntimeCommit: "b".repeat(40),
  limit: 100
});
expect(result).toEqual({ terminalized: 1, notificationsCreated: 2 });
```

Query back and prove:

- run is `FAILED_TECHNICAL` with `runtime_handoff_unavailable`, and score/decision/report remain null;
- leased/queued/retry tasks are `CANCELLED`, lease fields are null, completed task and immutable attempts/artifacts are unchanged;
- admitted `planned` entry has `admitted_at` and `reserved_bytes` cleared, committed entry is byte-for-byte unchanged;
- attached requests are `FAILED_TECHNICAL` and retain `run_id`;
- unsent progress rows are `CANCELLED`;
- exactly one `FAILED_TECHNICAL_RUNTIME_HANDOFF` row exists per request after repeated and concurrent reconciliation.

Add a second test where a fresh compatible `DRAINING` instance prevents terminalization, a third proving the active caller never selects its own commit, and a fourth calling `terminalizeExpiredRuntimeRuns` at `now === drain_deadline_at` to produce `runtime_handoff_deadline_exceeded` only for that draining commit. Add a race test that locks/finalizes the run first and proves reconciliation does not downgrade `COMPLETED`.

- [ ] **Step 2: Run the focused PostgreSQL test and verify failure**

Run: `npm.cmd test -- tests/storage/unifiedRuntimeHandoff.postgres.test.ts`

Expected: FAIL because enqueue/reconcile exports are absent.

- [ ] **Step 3: Implement durable enqueue and reconciliation**

Export:

```ts
export async function enqueueDueLongRunningNotifications(
  db: UnifiedQueryable,
  input: { now: Date; limit: number }
): Promise<number>;

export async function cancelStaleLongRunningNotifications(
  db: UnifiedQueryable,
  input: { now: Date; limit: number }
): Promise<number>;

export async function reconcileOrphanedUnifiedRuns(
  db: UnifiedTransactionalQueryable,
  input: {
    now: Date;
    heartbeatStaleMs: number;
    currentRuntimeCommit: string;
    limit: number;
  }
): Promise<{ terminalized: number; notificationsCreated: number }>;

export async function terminalizeExpiredRuntimeRuns(
  db: UnifiedTransactionalQueryable,
  input: {
    now: Date;
    drainingInstanceId: string;
    runtimeCommit: string;
    heartbeatStaleMs: number;
    limit: number;
  }
): Promise<{ terminalized: number; notificationsCreated: number }>;

export async function countNonTerminalRunsForRuntime(
  db: UnifiedQueryable,
  input: { runtimeCommit: string }
): Promise<number>;
```

`enqueueDueLongRunningNotifications` inserts `request_id || ':LONG_RUNNING'`, copy version V1, and `ready_at = accepted_at + interval '5 minutes'` only for attached authoritative requests whose run is still non-terminal. Use `on conflict (request_id, kind) do nothing`.

`cancelStaleLongRunningNotifications` changes unsent `LONG_RUNNING` rows to `CANCELLED` when their run is already `COMPLETED` or `FAILED_TECHNICAL`. Call it every lifecycle cycle so normal analytical completion cancels progress independently of Telegram delivery timing.

`reconcileOrphanedUnifiedRuns` is called only by the `ACTIVE` intake owner. Select at most `limit` candidate IDs whose manifest commit differs from `currentRuntimeCommit`, then process each in one transaction. Inside that transaction lock the candidate run with `FOR UPDATE SKIP LOCKED`, then lock its manifest artifact, requests, tasks, planner rows and existing notifications; recheck compatible `DRAINING` runtime liveness; update only non-terminal mutable rows; and insert notification ID `request_id || ':FAILED_TECHNICAL_RUNTIME_HANDOFF'`. A run pinned to the caller's current commit is never a candidate. The final completion predicate is checked after the row lock so a committed completed report wins the race.

`terminalizeExpiredRuntimeRuns` first rechecks that the registry has the named `DRAINING` instance with `drain_deadline_at <= now`. If another fresh `ACTIVE` instance runs the same commit, return without terminalizing because identical code can safely resume those commit-pinned tasks. Otherwise select only manifests pinned to the draining runtime's commit and apply the same transaction with reason `runtime_handoff_deadline_exceeded`; never examine a different commit's runs.

- [ ] **Step 4: Run repository tests and typecheck**

Run:

```powershell
npm.cmd test -- tests/storage/unifiedRuntimeHandoff.postgres.test.ts
npm.cmd run typecheck
```

Expected: all transaction/idempotency/race cases PASS and TypeScript exits 0.

- [ ] **Step 5: Commit orphan reconciliation**

```powershell
git add src/unifiedCheck/runtimeHandoffRepository.ts tests/storage/unifiedRuntimeHandoff.postgres.test.ts
git commit -m "feat(unified): terminalize orphaned runtime checks"
```

### Task 5: Deliver lifecycle notifications safely

**Files:**

- Create: `src/unifiedCheck/lifecycleNotification.ts`
- Create: `tests/unified-check/lifecycleNotification.test.ts`
- Modify: `src/unifiedCheck/delivery.ts`
- Modify: `src/unifiedCheck/runtimeHandoffRepository.ts`
- Modify: `tests/storage/unifiedRuntimeHandoff.postgres.test.ts`

- [ ] **Step 1: Write failing worker tests**

Model claims in memory and assert one case for each Telegram outcome:

```ts
await expect(runUnifiedLifecycleNotificationCycle({
  repository,
  now: () => now,
  leaseToken: () => "lease-1",
  leaseMs: 30_000,
  limit: 10,
  sendTelegram: async (message) => {
    expect(message.payload.replyMarkup?.inline_keyboard[0][0]).toEqual({
      text: "Повторить",
      callback_data: "check:addr:TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52"
    });
    return { kind: "confirmed", telegramMessageId: "501" };
  }
})).resolves.toMatchObject({ claimed: 1, settled: 1 });
expect(repository.settlements[0].status).toBe("SENT_CONFIRMED");
```

Add cases for retryable rejection, permanent rejection becoming `CANCELLED`, ambiguous transport becoming `DELIVERY_UNKNOWN`, expired leases becoming `DELIVERY_UNKNOWN`, and a claimed `LONG_RUNNING` row whose run completed before send becoming `CANCELLED` without calling Telegram. Assert that the technical message has no analytical score or verdict.

- [ ] **Step 2: Run the worker test and verify the red state**

Run: `npm.cmd test -- tests/unified-check/lifecycleNotification.test.ts`

Expected: FAIL because the lifecycle worker does not exist.

- [ ] **Step 3: Implement the notification worker and repository adapter**

Move no analytical logic. Reuse the exported `UnifiedTelegramSendResult` type from `delivery.ts` and export:

```ts
export type UnifiedLifecycleNotificationClaimV1 = Readonly<{
  notificationId: string;
  leaseToken: string;
  attempt: number;
  kind: UnifiedLifecycleNotificationKind;
  request: {
    id: string;
    chatId: string;
    messageThreadId: string;
    locale: "ru" | "en";
    subjectAddress: string;
    runStatus: string;
  };
}>;

export type UnifiedLifecycleNotificationRepository = {
  markExpiredLeasesUnknown(input: { now: Date }): Promise<number>;
  claimNext(input: { leaseToken: string; leaseMs: number; now: Date }):
    Promise<UnifiedLifecycleNotificationClaimV1 | null>;
  isStillSendable(input: { notificationId: string; leaseToken: string }):
    Promise<boolean>;
  settle(input: {
    notificationId: string;
    leaseToken: string;
    status: "RETRYABLE" | "SENT_CONFIRMED" | "DELIVERY_UNKNOWN" | "CANCELLED";
    errorCode: string | null;
    retryAt: string | null;
    telegramMessageId: string | null;
  }): Promise<boolean>;
};
```

The PostgreSQL claim uses `FOR UPDATE SKIP LOCKED`, increments attempts and sets a lease. `isStillSendable` must recheck the lease and, for `LONG_RUNNING`, that its run is non-terminal; for technical failure it must recheck request status/reason. Render only after the claim is validated. `DELIVERY_UNKNOWN` is never automatically reclaimed.

- [ ] **Step 4: Add PostgreSQL adapter acceptance**

Extend `tests/storage/unifiedRuntimeHandoff.postgres.test.ts` to claim/settle a progress row and a technical row, prove a concurrent second claimant receives null, and prove expiry becomes `DELIVERY_UNKNOWN`.

Run:

```powershell
npm.cmd test -- tests/unified-check/lifecycleNotification.test.ts tests/storage/unifiedRuntimeHandoff.postgres.test.ts
npm.cmd run typecheck
```

Expected: unit and PostgreSQL tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit lifecycle delivery**

```powershell
git add src/unifiedCheck/delivery.ts src/unifiedCheck/lifecycleNotification.ts src/unifiedCheck/runtimeHandoffRepository.ts tests/unified-check/lifecycleNotification.test.ts tests/storage/unifiedRuntimeHandoff.postgres.test.ts
git commit -m "feat(unified): deliver durable lifecycle notifications"
```

### Task 6: Orchestrate drain and wire the production runtime

**Files:**

- Create: `src/runtime/runtimeHandoffCoordinator.ts`
- Create: `tests/runtime/runtimeHandoffCoordinator.test.ts`
- Modify: `src/runtime/startupSchedule.ts`
- Modify: `tests/runtime/startupSchedule.test.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/unifiedCheck/delivery.ts`
- Modify: `tests/unified-check/delivery.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing coordinator ordering tests**

Use fake timers and injected callbacks. Prove a drain directive performs this order once:

```ts
expect(events).toEqual([
  "stop-telegram-polling",
  "stop-legacy-schedules",
  "mark-polling-released"
]);
expect(stopUnifiedRuntime).not.toHaveBeenCalled();
```

Then prove:

- `ACTIVE` only heartbeats and keeps intake;
- `DRAIN_REQUESTED` releases polling before recording `DRAINING`;
- `DRAINING` exits after `countNonTerminalRunsForRuntime` returns zero;
- `DRAINING` exits without cancelling work when a fresh `ACTIVE` replacement has the same commit, because the replacement can claim the identical commit-pinned tasks;
- at the exact deadline it terminalizes only its own commit-pinned runs with deadline reason, marks `STOPPED`, and requests graceful exit;
- repeated ticks never call `bot.stop()` twice;
- a callback failure leaves the registry state retryable and does not claim ownership for another process early.

- [ ] **Step 2: Run the coordinator test and verify the red state**

Run: `npm.cmd test -- tests/runtime/runtimeHandoffCoordinator.test.ts`

Expected: FAIL because the coordinator module does not exist.

- [ ] **Step 3: Implement the injected coordinator**

Export:

```ts
export function createRuntimeHandoffCoordinator(input: {
  now(): Date;
  heartbeat(): Promise<UnifiedRuntimeInstanceV1>;
  stopTelegramPolling(): Promise<void>;
  stopLegacySchedules(): void;
  markPollingReleased(now: Date): Promise<UnifiedRuntimeInstanceV1>;
  countCompatibleRuns(): Promise<number>;
  hasEquivalentActiveReplacement(): Promise<boolean>;
  terminalizeExpiredCompatibleRuns(now: Date): Promise<void>;
  markStopped(now: Date, failureReason: string | null): Promise<void>;
  requestGracefulExit(): void;
  onEvent(event: string, fields?: Record<string, unknown>): void;
}): { tick(): Promise<void>; isDraining(): boolean };
```

Keep a process-local `pollingReleased` boolean only to make effects idempotent; durable registry state remains authoritative after a restart.

- [ ] **Step 4: Add the lifecycle schedule label and wire `src/index.ts`**

Add `unified_lifecycle` to `UNIFIED_RESOURCE_WORK_LABELS`. Its non-overlapping cycle must:

1. heartbeat and process drain directives;
2. when this instance is `ACTIVE`, enqueue due five-minute progress notifications;
3. when this instance is `ACTIVE`, cancel stale unsent progress notifications;
4. when this instance is `ACTIVE`, reconcile only runs pinned to other commits;
5. run the lifecycle notification worker under outbox leases.

At startup, after schema/runtime verification and before `bot.start`, call `registerActiveRuntime` with a fresh UUID and the exact runtime SHA/label. If registration reports a fresh owner, startup must fail without starting Telegram polling.

Split schedule stopping in `src/index.ts` so drain calls only:

```ts
startupWorkSchedule?.stop();
startupWorkSchedule = null;
```

It must not call `unifiedRuntimeGate.stop()`, stop the Unified schedule, drain the provider pool, close the database, or exit while compatible runs remain. Use `bot.isRunning()` before `bot.stop()` so shutdown remains idempotent. Keep Unified task claiming pinned to `runtimeVersion.gitCommitSha` unchanged.

Build lifecycle Telegram payload as:

```ts
{
  text: rendered.text,
  parse_mode: rendered.parseMode,
  ...(rendered.callbackData === null ? {} : {
    reply_markup: {
      inline_keyboard: [[{
        text: rendered.buttonText!,
        callback_data: rendered.callbackData
      }]]
    }
  })
}
```

The callback is already parsed as `check_address_value`; do not add a second Retry handler.

Bind analytical delivery claims to the owning runtime commit as well: change `createPostgresUnifiedDeliveryRepository` to require `{ runtimeCommit }`, thread that value into `claimUnifiedDelivery`, and join the request/run/analysis-manifest artifact so a delivery is claimable only when `artifact_json->>'runtimeCommit'` equals the worker commit. Add a regression case to `tests/unified-check/delivery.test.ts` proving an old and new worker cannot claim each other's deliveries. This does not rewrite the immutable presentation or delivery intent.

Emit stable structured events `runtime_drain_requested`, `runtime_polling_released`, `runtime_drain_completed`, `runtime_drain_deadline_reached`, `unified_orphan_terminalized`, and `unified_lifecycle_notification_outcome`. Do not put chat IDs, addresses, Telegram tokens or provider keys in metric labels or structured aggregate fields.

- [ ] **Step 5: Run runtime, bot and delivery regression tests**

Run:

```powershell
npm.cmd test -- tests/runtime/runtimeHandoffCoordinator.test.ts tests/runtime/startupSchedule.test.ts tests/bot/createBot.test.ts tests/unified-check/delivery.test.ts tests/unified-check/lifecycleNotification.test.ts
npm.cmd run typecheck
```

Expected: all selected tests PASS; existing check intake and analytical delivery tests remain green.

- [ ] **Step 6: Commit runtime wiring**

```powershell
git add src/runtime/runtimeHandoffCoordinator.ts src/runtime/startupSchedule.ts src/unifiedCheck/repository.ts src/unifiedCheck/delivery.ts src/index.ts tests/runtime/runtimeHandoffCoordinator.test.ts tests/runtime/startupSchedule.test.ts tests/unified-check/delivery.test.ts
git commit -m "feat(runtime): drain old unified generation safely"
```

### Task 7: Add the Windows-safe restart command

**Files:**

- Create: `scripts/restartBot.ts`
- Create: `tests/scripts/restartBot.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing command-contract tests**

Inject database, clock, process spawning, log files and delay. Assert:

```ts
expect(spawnProcess).toHaveBeenCalledWith(
  process.execPath,
  ["--import", "tsx", "src/index.ts"],
  expect.objectContaining({
    cwd: repositoryRoot,
    detached: true,
    windowsHide: true,
    shell: false
  })
);
expect(spawnProcess.mock.calls[0][2].env.RUNTIME_GIT_SHA).toBe("b".repeat(40));
expect(spawnProcess.mock.calls[0][2].env.RUNTIME_INSTANCE_LABEL).toContain("bbbbbbbb");
```

Prove the command requests drain, waits for `telegram_polling_released_at`, opens timestamped stdout/stderr logs, starts one replacement, calls `unref`, then waits for the new instance to become the active intake owner and for `bot_started` to appear in its log. If no registry owner exists, assert it throws `legacy_runtime_requires_verified_manual_stop` without scanning or killing processes.

- [ ] **Step 2: Run the script test and verify the red state**

Run: `npm.cmd test -- tests/scripts/restartBot.test.ts`

Expected: FAIL because `restartBot.ts` does not exist.

- [ ] **Step 3: Implement the command with direct Node APIs**

Export a testable `restartBot(deps)` and guard the executable entry point with `pathToFileURL(process.argv[1]).href === import.meta.url`. Use `execFile("git", ["rev-parse", "HEAD"])`, `open` from `node:fs/promises`, and `spawn` from `node:child_process`; never use a shell-built command. Pass the existing environment through unchanged except the exact `RUNTIME_GIT_SHA` and generated matching instance label. Set `windowsHide: true`, `detached: true`, `shell: false`, and use the opened log descriptors for stdout/stderr.

The command prints the old instance ID, durable two-hour deadline, new instance ID and log paths. It never updates Unified run rows directly.

Add:

```json
"bot:restart": "node --import tsx scripts/restartBot.ts"
```

- [ ] **Step 4: Run script and type checks**

Run:

```powershell
npm.cmd test -- tests/scripts/restartBot.test.ts
npm.cmd run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit the deployment command**

```powershell
git add scripts/restartBot.ts tests/scripts/restartBot.test.ts package.json
git commit -m "feat(runtime): add safe local restart command"
```

### Task 8: Show runtime handoff state in Admin

**Files:**

- Modify: `src/unifiedCheck/runtimeHandoffRepository.ts`
- Modify: `src/admin/adminRuntime.ts`
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/adminConsole.ts`
- Modify: `src/index.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing Admin endpoint and page tests**

Add a dependency returning:

```ts
{
  instances: [{
    instanceId: "runtime-a",
    runtimeCommit: "a".repeat(40),
    instanceLabel: "local-aaaaaaaa",
    state: "DRAINING",
    heartbeatAgeMs: 2_000,
    drainDeadlineAt: "2026-07-28T12:00:00.000Z",
    compatibleNonTerminalRuns: 1
  }],
  notifications: {
    PENDING: 1,
    LEASED: 0,
    RETRYABLE: 0,
    SENT_CONFIRMED: 4,
    DELIVERY_UNKNOWN: 0,
    CANCELLED: 2
  }
}
```

Assert authenticated `GET /admin/api/unified-checks/runtime-handoff` returns it, unauthenticated access returns 401, and `/admin/unified-checks` contains `data-runtime-handoff-summary`.

- [ ] **Step 2: Run the Admin test and verify the red state**

Run: `npm.cmd test -- tests/admin/adminServer.test.ts`

Expected: FAIL because the dependency, endpoint and view are absent.

- [ ] **Step 3: Add the read-only projection, endpoint and compact view**

Export `loadUnifiedRuntimeHandoffAdminSnapshot(db, now)` from the handoff repository. It aggregates registry rows, compatible non-terminal run counts by manifest commit, and notification status counts without exposing chat IDs or addresses.

Thread `getUnifiedRuntimeHandoffSnapshot` through `AdminRuntimeDeps` and `AdminServerDeps`, add the authenticated endpoint, and render a compact summary above the existing Unified run list. Show instance label, short commit, state, heartbeat age, deadline, compatible run count and notification counts. Do not add mutation buttons.

- [ ] **Step 4: Run Admin and type checks**

Run:

```powershell
npm.cmd test -- tests/admin/adminServer.test.ts
npm.cmd run typecheck
```

Expected: Admin tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Admin visibility**

```powershell
git add src/unifiedCheck/runtimeHandoffRepository.ts src/admin/adminRuntime.ts src/admin/adminServer.ts src/admin/adminConsole.ts src/index.ts tests/admin/adminServer.test.ts
git commit -m "feat(admin): expose unified runtime handoff state"
```

### Task 9: Update product truth and run the full verification gate

**Files:**

- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Update the knowledge documents**

Record these exact decisions:

- an authoritative run remains commit-pinned and is never resumed by different code;
- deployment drain lasts at most two hours and does not limit ordinary checks;
- old runtime releases Telegram polling and legacy claims before new intake starts;
- five-minute status and technical failure are lifecycle messages, not evidence or score;
- `FAILED_TECHNICAL` requests retain `run_id` for audit;
- Retry reuses `check:addr:<address>`;
- the silent orphan symptom is closed, while dense 500-address traversal performance remains a separate open problem.

- [ ] **Step 2: Run formatting and static checks**

Run:

```powershell
git diff --check
npm.cmd run typecheck
```

Expected: no whitespace errors and TypeScript exits 0.

- [ ] **Step 3: Run focused suites**

Run:

```powershell
npm.cmd test -- tests/storage/schemaMigrations.test.ts tests/storage/migration037.postgres.test.ts tests/storage/unifiedRuntimeHandoff.postgres.test.ts tests/unified-check/runtimeHandoffPolicy.test.ts tests/unified-check/lifecycleNotification.test.ts tests/runtime/runtimeVersion037.test.ts tests/runtime/runtimeHandoffCoordinator.test.ts tests/runtime/startupSchedule.test.ts tests/scripts/restartBot.test.ts tests/admin/adminServer.test.ts tests/bot/createBot.test.ts tests/unified-check/delivery.test.ts
```

Expected: every named file PASS and both PostgreSQL suites run rather than skip.

- [ ] **Step 4: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: exit 0 with no new failures. Existing intentionally skipped suites may remain skipped only if they were also skipped at the baseline.

- [ ] **Step 5: Commit documentation**

```powershell
git add docs/knowledge/03-job-lifecycle.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md
git commit -m "docs(runtime): document unified deployment handoff"
```

### Task 10: Deploy and prove the original failure is recovered

**Files:**

- No source edits expected; capture commands and evidence in the task handoff.

- [ ] **Step 1: Inspect the exact production state before mutation**

Run read-only queries for current schema receipt, runtime process command line, active bot log, and run `78d82410-bbdc-43ac-87a1-a8ca8dabc7cd`. Record that it is still non-terminal, its pinned manifest commit, request ID `b1434291-8d17-4cd1-a634-5aa25dc003e5`, and delivery/notification counts.

- [ ] **Step 2: Apply schema 037 and verify it**

Run:

```powershell
npm.cmd run db:migrate
npm.cmd run schema:verify
```

Expected: migration 037 is applied and `Schema 37 verified` is printed.

- [ ] **Step 3: Perform the first pre-registry rollout safely**

Because the currently running binary predates schema 037, identify its exact PID and command line with read-only PowerShell, stop only that verified bot process tree, then start the new runtime hidden with exact `RUNTIME_GIT_SHA` and a SHA-matching `RUNTIME_INSTANCE_LABEL`. Do not scan or terminate unrelated Node processes. Save stdout/stderr to timestamped files.

For later deployments, use only:

```powershell
npm.cmd run bot:restart
```

- [ ] **Step 4: Verify runtime ownership and bot responsiveness**

Expected production evidence:

- schema 037 receipt checksum is verified;
- one runtime row owns `ACTIVE` Telegram intake;
- its commit equals deployed `git rev-parse HEAD`;
- log contains `bot_started` and lifecycle worker cycles;
- a new harmless test address receives the immediate accepted message and later a final result or explicit lifecycle state.

- [ ] **Step 5: Verify the historical orphan through the production path**

Poll the database and Telegram delivery state. Expected:

- run `78d82410-bbdc-43ac-87a1-a8ca8dabc7cd` becomes `FAILED_TECHNICAL` with `runtime_handoff_unavailable`;
- request `b1434291-8d17-4cd1-a634-5aa25dc003e5` retains its `run_id` and becomes `FAILED_TECHNICAL`;
- there is exactly one `FAILED_TECHNICAL_RUNTIME_HANDOFF` outbox row;
- it reaches `SENT_CONFIRMED` or, if Telegram acknowledgement is ambiguous, `DELIVERY_UNKNOWN`;
- no analytical report, score or risk decision is created for the incomplete run;
- the user sees the technical explanation and a Retry button for `TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52`.

- [ ] **Step 6: Exercise a controlled two-generation drain**

Start a controlled in-flight Unified check, invoke `npm.cmd run bot:restart`, and verify the old row transitions `ACTIVE → DRAIN_REQUESTED → DRAINING`, polling release precedes the new `ACTIVE` owner, the old process continues only its commit-pinned run/delivery, and exits after that run is terminal. In a test-only clock/integration fixture, exercise the exact deadline and verify technical terminalization instead of an analytical result.

## Completion checklist

- [ ] Current-commit code never claims old-commit task artifacts.
- [ ] Exactly one live instance owns Telegram polling.
- [ ] Old runtime drains only compatible Unified work and never accepts new checks.
- [ ] The two-hour deadline applies only to requested deployment drain.
- [ ] Long-running and technical messages are durable, idempotent and score-free.
- [ ] Retry preserves the original address through the existing bot callback.
- [ ] The original orphan is terminalized and the user is notified.
- [ ] PostgreSQL acceptance, typecheck and full Vitest suite pass.
- [ ] Knowledge docs match shipped code.
