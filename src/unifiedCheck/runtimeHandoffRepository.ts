import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "./repository";
import {
  LONG_RUNNING_NOTIFICATION_DELAY_MS,
  RUNTIME_HANDOFF_DRAIN_MS,
  RUNTIME_HEARTBEAT_STALE_MS,
  UNIFIED_LIFECYCLE_COPY_VERSION,
  classifyRuntimeOwnership,
  type RuntimeOwnershipClassification
} from "./runtimeHandoffPolicy";

export type UnifiedRuntimeState =
  | "ACTIVE"
  | "DRAIN_REQUESTED"
  | "DRAINING"
  | "STOPPED";

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

const RUNTIME_REGISTRY_LOCK_ID = "20260728037";
const SHA = /^[0-9a-f]{40}$/u;
const STATES = new Set<UnifiedRuntimeState>([
  "ACTIVE",
  "DRAIN_REQUESTED",
  "DRAINING",
  "STOPPED"
]);

function validDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError("unified_runtime_clock_invalid");
  }
}

function validateIdentity(input: {
  instanceId: string;
  runtimeCommit: string;
  instanceLabel: string;
}): void {
  if (
    input.instanceId.trim().length === 0 ||
    input.instanceLabel.trim().length === 0 ||
    input.instanceLabel !== input.instanceLabel.trim() ||
    !SHA.test(input.runtimeCommit)
  ) {
    throw new TypeError("unified_runtime_identity_invalid");
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("unified_runtime_row_invalid");
  }
  return parsed.toISOString();
}

function runtimeRow(row: Record<string, unknown>): UnifiedRuntimeInstanceV1 {
  const state = String(row.state) as UnifiedRuntimeState;
  if (!STATES.has(state)) throw new Error("unified_runtime_row_invalid");
  return {
    instanceId: String(row.instance_id),
    runtimeCommit: String(row.runtime_commit),
    instanceLabel: String(row.instance_label),
    state,
    startedAt: iso(row.started_at)!,
    heartbeatAt: iso(row.heartbeat_at)!,
    drainRequestedAt: iso(row.drain_requested_at),
    drainDeadlineAt: iso(row.drain_deadline_at),
    telegramPollingReleasedAt: iso(row.telegram_polling_released_at),
    stoppedAt: iso(row.stopped_at),
    failureReason: row.failure_reason === null || row.failure_reason === undefined
      ? null
      : String(row.failure_reason)
  };
}

async function lockRegistry(db: UnifiedQueryable): Promise<void> {
  await db.query("select pg_advisory_xact_lock($1::bigint)", [
    RUNTIME_REGISTRY_LOCK_ID
  ]);
}

export async function loadRuntimeInstance(
  db: UnifiedQueryable,
  instanceId: string
): Promise<UnifiedRuntimeInstanceV1 | null> {
  if (instanceId.trim().length === 0) {
    throw new TypeError("unified_runtime_identity_invalid");
  }
  const row = (await db.query(
    "select * from unified_runtime_instances where instance_id=$1",
    [instanceId]
  )).rows[0];
  return row ? runtimeRow(row) : null;
}

export async function loadActiveRuntimeOwner(
  db: UnifiedQueryable
): Promise<UnifiedRuntimeInstanceV1 | null> {
  const row = (await db.query(
    `select * from unified_runtime_instances
      where state='ACTIVE' and telegram_polling_released_at is null
      order by started_at desc
      limit 1`
  )).rows[0];
  return row ? runtimeRow(row) : null;
}

export async function registerActiveRuntime(
  db: UnifiedTransactionalQueryable,
  input: {
    instanceId: string;
    runtimeCommit: string;
    instanceLabel: string;
    now: Date;
  }
): Promise<UnifiedRuntimeInstanceV1 & { ownsTelegramIntake: true }> {
  validateIdentity(input);
  validDate(input.now);
  return db.transaction(async (client) => {
    await lockRegistry(client);
    const existingInstance = (await client.query(
      "select * from unified_runtime_instances where instance_id=$1 for update",
      [input.instanceId]
    )).rows[0];
    if (existingInstance) {
      const existing = runtimeRow(existingInstance);
      if (
        existing.runtimeCommit === input.runtimeCommit &&
        existing.instanceLabel === input.instanceLabel &&
        existing.state === "ACTIVE"
      ) {
        return { ...existing, ownsTelegramIntake: true as const };
      }
      throw new Error("unified_runtime_instance_conflict");
    }

    const ownerRow = (await client.query(
      `select * from unified_runtime_instances
        where state in ('ACTIVE','DRAIN_REQUESTED')
          and telegram_polling_released_at is null
        for update`
    )).rows[0];
    if (ownerRow) {
      const owner = runtimeRow(ownerRow);
      if (
        input.now.getTime() - Date.parse(owner.heartbeatAt) <=
          RUNTIME_HEARTBEAT_STALE_MS
      ) {
        throw new Error("unified_runtime_intake_owned");
      }
      await client.query(
        `update unified_runtime_instances
            set state='STOPPED', stopped_at=$2, failure_reason='heartbeat_timeout',
                updated_at=$2
          where instance_id=$1`,
        [owner.instanceId, input.now]
      );
    }

    const inserted = (await client.query(
      `insert into unified_runtime_instances (
        instance_id,runtime_commit,instance_label,state,started_at,heartbeat_at,
        created_at,updated_at
      ) values ($1,$2,$3,'ACTIVE',$4,$4,$4,$4)
      returning *`,
      [input.instanceId, input.runtimeCommit, input.instanceLabel, input.now]
    )).rows[0];
    if (!inserted) throw new Error("unified_runtime_register_failed");
    return { ...runtimeRow(inserted), ownsTelegramIntake: true as const };
  });
}

export async function heartbeatRuntime(
  db: UnifiedQueryable,
  input: { instanceId: string; now: Date }
): Promise<UnifiedRuntimeInstanceV1> {
  validDate(input.now);
  if (input.instanceId.trim().length === 0) {
    throw new TypeError("unified_runtime_identity_invalid");
  }
  const row = (await db.query(
    `update unified_runtime_instances
        set heartbeat_at=$2, updated_at=$2
      where instance_id=$1 and state <> 'STOPPED'
      returning *`,
    [input.instanceId, input.now]
  )).rows[0];
  if (!row) throw new Error("unified_runtime_not_live");
  return runtimeRow(row);
}

export async function requestRuntimeDrain(
  db: UnifiedTransactionalQueryable,
  input: { instanceId: string; now: Date; drainMs: number }
): Promise<UnifiedRuntimeInstanceV1> {
  validDate(input.now);
  if (
    input.instanceId.trim().length === 0 ||
    !Number.isSafeInteger(input.drainMs) ||
    input.drainMs < 1 ||
    input.drainMs > RUNTIME_HANDOFF_DRAIN_MS
  ) throw new TypeError("unified_runtime_drain_input_invalid");
  return db.transaction(async (client) => {
    await lockRegistry(client);
    const selected = (await client.query(
      "select * from unified_runtime_instances where instance_id=$1 for update",
      [input.instanceId]
    )).rows[0];
    if (!selected) throw new Error("unified_runtime_not_found");
    const runtime = runtimeRow(selected);
    if (runtime.state === "DRAIN_REQUESTED" || runtime.state === "DRAINING") {
      return runtime;
    }
    if (runtime.state !== "ACTIVE") {
      throw new Error("unified_runtime_drain_state_invalid");
    }
    const deadline = new Date(input.now.getTime() + input.drainMs);
    const updated = (await client.query(
      `update unified_runtime_instances
          set state='DRAIN_REQUESTED', drain_requested_at=$2,
              drain_deadline_at=$3, heartbeat_at=$2, updated_at=$2
        where instance_id=$1 and state='ACTIVE'
        returning *`,
      [input.instanceId, input.now, deadline]
    )).rows[0];
    if (!updated) throw new Error("unified_runtime_drain_conflict");
    return runtimeRow(updated);
  });
}

export async function markRuntimePollingReleased(
  db: UnifiedTransactionalQueryable,
  input: { instanceId: string; now: Date }
): Promise<UnifiedRuntimeInstanceV1> {
  validDate(input.now);
  return db.transaction(async (client) => {
    await lockRegistry(client);
    const selected = (await client.query(
      "select * from unified_runtime_instances where instance_id=$1 for update",
      [input.instanceId]
    )).rows[0];
    if (!selected) throw new Error("unified_runtime_not_found");
    const runtime = runtimeRow(selected);
    if (runtime.state === "DRAINING") return runtime;
    if (runtime.state !== "DRAIN_REQUESTED") {
      throw new Error("unified_runtime_release_state_invalid");
    }
    const updated = (await client.query(
      `update unified_runtime_instances
          set state='DRAINING', telegram_polling_released_at=$2,
              heartbeat_at=$2, updated_at=$2
        where instance_id=$1 and state='DRAIN_REQUESTED'
        returning *`,
      [input.instanceId, input.now]
    )).rows[0];
    if (!updated) throw new Error("unified_runtime_release_conflict");
    return runtimeRow(updated);
  });
}

export async function markRuntimeStopped(
  db: UnifiedTransactionalQueryable,
  input: {
    instanceId: string;
    now: Date;
    failureReason: "heartbeat_timeout" | "graceful_exit" | "shutdown_failure" | null;
  }
): Promise<UnifiedRuntimeInstanceV1> {
  validDate(input.now);
  return db.transaction(async (client) => {
    await lockRegistry(client);
    const selected = (await client.query(
      "select * from unified_runtime_instances where instance_id=$1 for update",
      [input.instanceId]
    )).rows[0];
    if (!selected) throw new Error("unified_runtime_not_found");
    const runtime = runtimeRow(selected);
    if (runtime.state === "STOPPED") return runtime;
    const updated = (await client.query(
      `update unified_runtime_instances
          set state='STOPPED', stopped_at=$2, failure_reason=$3,
              heartbeat_at=$2, updated_at=$2
        where instance_id=$1 and state <> 'STOPPED'
        returning *`,
      [input.instanceId, input.now, input.failureReason]
    )).rows[0];
    if (!updated) throw new Error("unified_runtime_stop_conflict");
    return runtimeRow(updated);
  });
}

export async function hasLiveEquivalentReplacement(
  db: UnifiedQueryable,
  input: {
    drainingInstanceId: string;
    runtimeCommit: string;
    now: Date;
    heartbeatStaleMs: number;
  }
): Promise<boolean> {
  validDate(input.now);
  if (
    input.drainingInstanceId.trim().length === 0 ||
    !SHA.test(input.runtimeCommit) ||
    !Number.isSafeInteger(input.heartbeatStaleMs) ||
    input.heartbeatStaleMs < 1
  ) throw new TypeError("unified_runtime_replacement_input_invalid");
  const threshold = new Date(input.now.getTime() - input.heartbeatStaleMs);
  const result = await db.query(
    `select 1 from unified_runtime_instances
      where instance_id <> $1 and runtime_commit=$2 and state='ACTIVE'
        and telegram_polling_released_at is null and heartbeat_at >= $3
      limit 1`,
    [input.drainingInstanceId, input.runtimeCommit, threshold]
  );
  return result.rows.length > 0;
}

export async function countNonTerminalRunsForRuntime(
  db: UnifiedQueryable,
  input: { runtimeCommit: string }
): Promise<number> {
  if (!SHA.test(input.runtimeCommit)) {
    throw new TypeError("unified_runtime_commit_invalid");
  }
  const row = (await db.query(
    `select count(*)::int as count
       from unified_check_runs run
       join unified_check_artifacts manifest
         on manifest.sha256=run.analysis_manifest_sha256
        and manifest.kind='analysis_manifest'
      where run.status not in ('COMPLETED','FAILED_TECHNICAL')
        and manifest.artifact_json->>'runtimeCommit'=$1`,
    [input.runtimeCommit]
  )).rows[0];
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("unified_runtime_count_invalid");
  }
  return count;
}

function validateCycleInput(input: { now: Date; limit: number }): void {
  validDate(input.now);
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    throw new TypeError("unified_runtime_cycle_input_invalid");
  }
}

export async function enqueueDueLongRunningNotifications(
  db: UnifiedQueryable,
  input: { now: Date; limit: number }
): Promise<number> {
  validateCycleInput(input);
  const result = await db.query(
    `with due as (
       select request.id
         from unified_check_requests request
         join unified_check_runs run on run.id=request.run_id
        where request.status='ATTACHED'
          and request.side_effect_policy='authoritative'
          and run.status not in ('COMPLETED','FAILED_TECHNICAL')
          and request.accepted_at + ($2::bigint * interval '1 millisecond') <= $1
        order by request.accepted_at, request.id
        limit $3
     )
     insert into unified_check_notifications (
       id,request_id,kind,locale,copy_version,status,ready_at,created_at,updated_at
     )
     select request.id || ':LONG_RUNNING', request.id, 'LONG_RUNNING',
            request.locale, $4, 'PENDING',
            request.accepted_at + ($2::bigint * interval '1 millisecond'),
            $1, $1
       from due
       join unified_check_requests request on request.id=due.id
     on conflict (request_id,kind) do nothing`,
    [
      input.now,
      LONG_RUNNING_NOTIFICATION_DELAY_MS,
      input.limit,
      UNIFIED_LIFECYCLE_COPY_VERSION
    ]
  );
  return Number(result.rowCount ?? 0);
}

export async function cancelStaleLongRunningNotifications(
  db: UnifiedQueryable,
  input: { now: Date; limit: number }
): Promise<number> {
  validateCycleInput(input);
  const result = await db.query(
    `with stale as (
       select notification.id
         from unified_check_notifications notification
         join unified_check_requests request on request.id=notification.request_id
         join unified_check_runs run on run.id=request.run_id
        where notification.kind='LONG_RUNNING'
          and notification.status in ('PENDING','RETRYABLE')
          and run.status in ('COMPLETED','FAILED_TECHNICAL')
        order by notification.created_at, notification.id
        limit $2
     )
     update unified_check_notifications notification
        set status='CANCELLED', next_attempt_at=null,
            last_error='unified_lifecycle_no_longer_applicable', updated_at=$1
       from stale
      where notification.id=stale.id`,
    [input.now, input.limit]
  );
  return Number(result.rowCount ?? 0);
}

type TerminalizeResult = {
  terminalized: number;
  notificationsCreated: number;
};

async function terminalizeLockedRun(
  client: UnifiedQueryable,
  input: {
    runId: string;
    now: Date;
    reason: Exclude<RuntimeOwnershipClassification, "recoverable">;
  }
): Promise<TerminalizeResult> {
  await client.query(
    "select id from unified_check_requests where run_id=$1 for update",
    [input.runId]
  );
  await client.query(
    "select id from unified_check_tasks where run_id=$1 for update",
    [input.runId]
  );
  await client.query(
    "select task_id from unified_check_planner_entries where run_id=$1 for update",
    [input.runId]
  );
  await client.query(
    `select notification.id
       from unified_check_notifications notification
       join unified_check_requests request on request.id=notification.request_id
      where request.run_id=$1
      for update`,
    [input.runId]
  );

  const runUpdate = await client.query(
    `update unified_check_runs
        set status='FAILED_TECHNICAL', status_reason=$2,
            completed_at=$3, updated_at=$3
      where id=$1 and status not in ('COMPLETED','FAILED_TECHNICAL')`,
    [input.runId, input.reason, input.now]
  );
  if (Number(runUpdate.rowCount ?? 0) !== 1) {
    return { terminalized: 0, notificationsCreated: 0 };
  }
  await client.query(
    `update unified_check_tasks
        set status='CANCELLED', cancellation_requested_at=coalesce(cancellation_requested_at,$2),
            lease_owner=null, lease_token=null, lease_expires_at=null,
            heartbeat_at=null, last_error=$3, updated_at=$2
      where run_id=$1
        and status not in ('COMPLETED','FAILED_TECHNICAL','CANCELLED')`,
    [input.runId, input.now, input.reason]
  );
  await client.query(
    `update unified_check_planner_entries
        set admitted_at=null, reserved_bytes=null
      where run_id=$1 and planner_state='planned'
        and admitted_at is not null`,
    [input.runId]
  );
  await client.query(
    `update unified_check_requests
        set status='FAILED_TECHNICAL', status_reason=$2
      where run_id=$1 and status='ATTACHED'`,
    [input.runId, input.reason]
  );
  await client.query(
    `update unified_check_notifications notification
        set status='CANCELLED', next_attempt_at=null,
            last_error='unified_lifecycle_superseded_by_terminal', updated_at=$2
       from unified_check_requests request
      where notification.request_id=request.id and request.run_id=$1
        and notification.kind='LONG_RUNNING'
        and notification.status in ('PENDING','RETRYABLE')`,
    [input.runId, input.now]
  );
  const notifications = await client.query(
    `insert into unified_check_notifications (
       id,request_id,kind,locale,copy_version,status,ready_at,created_at,updated_at
     )
     select request.id || ':FAILED_TECHNICAL_RUNTIME_HANDOFF', request.id,
            'FAILED_TECHNICAL_RUNTIME_HANDOFF', request.locale, $3,
            'PENDING', $2, $2, $2
       from unified_check_requests request
      where request.run_id=$1 and request.status='FAILED_TECHNICAL'
     on conflict (request_id,kind) do nothing`,
    [input.runId, input.now, UNIFIED_LIFECYCLE_COPY_VERSION]
  );
  return {
    terminalized: 1,
    notificationsCreated: Number(notifications.rowCount ?? 0)
  };
}

export async function reconcileOrphanedUnifiedRuns(
  db: UnifiedTransactionalQueryable,
  input: {
    now: Date;
    heartbeatStaleMs: number;
    currentRuntimeCommit: string;
    limit: number;
  }
): Promise<TerminalizeResult> {
  validateCycleInput(input);
  if (
    !SHA.test(input.currentRuntimeCommit) ||
    !Number.isSafeInteger(input.heartbeatStaleMs) ||
    input.heartbeatStaleMs < 1
  ) throw new TypeError("unified_runtime_reconcile_input_invalid");
  const candidates = (await db.query(
    `select run.id
       from unified_check_runs run
       join unified_check_artifacts manifest
         on manifest.sha256=run.analysis_manifest_sha256
        and manifest.kind='analysis_manifest'
      where run.status not in ('COMPLETED','FAILED_TECHNICAL')
        and manifest.artifact_json->>'runtimeCommit' <> $1
      order by run.created_at, run.id
      limit $2`,
    [input.currentRuntimeCommit, input.limit]
  )).rows.map((row) => String(row.id));

  const total = { terminalized: 0, notificationsCreated: 0 };
  for (const runId of candidates) {
    const result = await db.transaction(async (client) => {
      const selected = (await client.query(
        `select run.id, manifest.artifact_json->>'runtimeCommit' as runtime_commit
           from unified_check_runs run
           join unified_check_artifacts manifest
             on manifest.sha256=run.analysis_manifest_sha256
            and manifest.kind='analysis_manifest'
          where run.id=$1
            and run.status not in ('COMPLETED','FAILED_TECHNICAL')
          for update of run skip locked`,
        [runId]
      )).rows[0];
      if (!selected) return { terminalized: 0, notificationsCreated: 0 };
      const runtimeCommit = String(selected.runtime_commit);
      if (runtimeCommit === input.currentRuntimeCommit) {
        return { terminalized: 0, notificationsCreated: 0 };
      }
      const compatibleRows = (await client.query(
        `select state,heartbeat_at,drain_deadline_at
           from unified_runtime_instances
          where runtime_commit=$1 and state='DRAINING'
          order by drain_deadline_at desc`,
        [runtimeCommit]
      )).rows;
      const classifications = compatibleRows.map((row) =>
        classifyRuntimeOwnership({
          now: input.now,
          heartbeatStaleMs: input.heartbeatStaleMs,
          compatibleRuntime: {
            state: "DRAINING",
            heartbeatAt: iso(row.heartbeat_at)!,
            drainDeadlineAt: iso(row.drain_deadline_at)!
          }
        })
      );
      if (classifications.includes("recoverable")) {
        return { terminalized: 0, notificationsCreated: 0 };
      }
      const reason = classifications.includes("runtime_handoff_deadline_exceeded")
        ? "runtime_handoff_deadline_exceeded"
        : "runtime_handoff_unavailable";
      return terminalizeLockedRun(client, { runId, now: input.now, reason });
    });
    total.terminalized += result.terminalized;
    total.notificationsCreated += result.notificationsCreated;
  }
  return total;
}

export async function terminalizeExpiredRuntimeRuns(
  db: UnifiedTransactionalQueryable,
  input: {
    now: Date;
    drainingInstanceId: string;
    runtimeCommit: string;
    heartbeatStaleMs: number;
    limit: number;
  }
): Promise<TerminalizeResult> {
  validateCycleInput(input);
  if (
    input.drainingInstanceId.trim().length === 0 ||
    !SHA.test(input.runtimeCommit) ||
    !Number.isSafeInteger(input.heartbeatStaleMs) ||
    input.heartbeatStaleMs < 1
  ) throw new TypeError("unified_runtime_deadline_input_invalid");
  const drainer = (await db.query(
    `select drain_deadline_at from unified_runtime_instances
      where instance_id=$1 and runtime_commit=$2 and state='DRAINING'`,
    [input.drainingInstanceId, input.runtimeCommit]
  )).rows[0];
  if (!drainer || Date.parse(iso(drainer.drain_deadline_at)!) > input.now.getTime()) {
    return { terminalized: 0, notificationsCreated: 0 };
  }
  if (await hasLiveEquivalentReplacement(db, input)) {
    return { terminalized: 0, notificationsCreated: 0 };
  }
  const candidates = (await db.query(
    `select run.id
       from unified_check_runs run
       join unified_check_artifacts manifest
         on manifest.sha256=run.analysis_manifest_sha256
        and manifest.kind='analysis_manifest'
      where run.status not in ('COMPLETED','FAILED_TECHNICAL')
        and manifest.artifact_json->>'runtimeCommit'=$1
      order by run.created_at,run.id
      limit $2`,
    [input.runtimeCommit, input.limit]
  )).rows.map((row) => String(row.id));
  const total = { terminalized: 0, notificationsCreated: 0 };
  for (const runId of candidates) {
    const result = await db.transaction(async (client) => {
      const locked = (await client.query(
        `select id from unified_check_runs
          where id=$1 and status not in ('COMPLETED','FAILED_TECHNICAL')
          for update skip locked`,
        [runId]
      )).rows[0];
      if (!locked) return { terminalized: 0, notificationsCreated: 0 };
      return terminalizeLockedRun(client, {
        runId,
        now: input.now,
        reason: "runtime_handoff_deadline_exceeded"
      });
    });
    total.terminalized += result.terminalized;
    total.notificationsCreated += result.notificationsCreated;
  }
  return total;
}
