import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  createPostgresUnifiedLifecycleNotificationRepository
} from "../../src/unifiedCheck/lifecycleNotification";
import {
  cancelStaleLongRunningNotifications,
  enqueueDueLongRunningNotifications,
  hasLiveEquivalentReplacement,
  heartbeatRuntime,
  markRuntimePollingReleased,
  markRuntimeStopped,
  registerActiveRuntime,
  reconcileOrphanedUnifiedRuns,
  requestRuntimeDrain,
  terminalizeExpiredRuntimeRuns
} from "../../src/unifiedCheck/runtimeHandoffRepository";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

function queryable(client: pg.PoolClient): UnifiedTransactionalQueryable {
  const query: UnifiedQueryable["query"] = (sql, values) =>
    client.query(sql, values as unknown[]);
  return {
    query,
    async transaction<T>(work: (db: UnifiedQueryable) => Promise<T>): Promise<T> {
      await client.query("begin");
      try {
        const result = await work({ query });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  };
}

async function createSchema(client: pg.PoolClient, schema: string): Promise<void> {
  await client.query(`create schema "${schema}"`);
  await client.query(`set search_path to "${schema}"`);
  for (const file of [
    "033_unified_wallet_check.sql",
    "034_unified_check_adaptive_planner.sql",
    "035_unified_check_run_rollout_policy.sql",
    "036_remove_rollout_authority.sql",
    "037_unified_runtime_handoff.sql"
  ]) {
    await client.query(await readFile(`migrations/${file}`, "utf8"));
  }
}

async function seedRun(client: pg.PoolClient, input: {
  runId: string;
  runtimeCommit: string;
  acceptedAt?: Date;
}): Promise<void> {
  const manifestSha = input.runId === "run-old" ? "a".repeat(64) : "b".repeat(64);
  const acceptedAt = input.acceptedAt ?? new Date("2026-07-28T10:00:00.000Z");
  await client.query(`insert into unified_check_runs (
    id,analysis_key_sha256,subject_address,status,run_purpose,
    side_effect_policy,analysis_manifest_sha256,fairness_owner_id,
    rollout_stage,rollout_bucket,admission_policy,provider_capacity_ceiling,
    created_at,updated_at
  ) values ($1,$2,'TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52','RUNNING','user_check',
    'authoritative',$3,$1,'global_barrier',null,'barrier',1,$4,$4)`, [
    input.runId,
    input.runId === "run-old" ? "c".repeat(64) : "d".repeat(64),
    manifestSha,
    acceptedAt
  ]);
  await client.query(`insert into unified_check_artifacts (
    sha256,created_by_run_id,kind,schema_version,artifact_json,created_at
  ) values ($1,$2,'analysis_manifest','1',$3::jsonb,$4)`, [
    manifestSha,
    input.runId,
    JSON.stringify({ runtimeCommit: input.runtimeCommit }),
    acceptedAt
  ]);
  for (const suffix of ["a", "b"]) {
    await client.query(`insert into unified_check_requests (
      id,request_correlation_id,run_id,subject_address,chat_id,locale,
      run_purpose,side_effect_policy,status,accepted_at,created_at
    ) values ($1,$2,$3,'TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52',$4,'ru',
      'user_check','authoritative','ATTACHED',$5,$5)`, [
      `${input.runId}-request-${suffix}`,
      `${input.runId}-correlation-${suffix}`,
      input.runId,
      suffix === "a" ? "100" : "200",
      acceptedAt
    ]);
  }
  await client.query(`insert into unified_check_tasks (
    id,run_id,kind,status,priority_lane,logical_key,lease_owner,lease_token,
    lease_expires_at,heartbeat_at,created_at,updated_at
  ) values
    ($1,$4,'direct_history','COMPLETED','interactive','completed',null,null,null,null,$5,$5),
    ($2,$4,'address_history','LEASED','interactive','leased','worker-old','lease-old',$6,$5,$5,$5),
    ($3,$4,'deep_direct','QUEUED','interactive','queued',null,null,null,null,$5,$5)`, [
    `${input.runId}-task-completed`,
    `${input.runId}-task-leased`,
    `${input.runId}-task-queued`,
    input.runId,
    acceptedAt,
    new Date(acceptedAt.getTime() + 60_000)
  ]);
  await client.query(`insert into unified_check_planner_entries (
    run_id,canonical_sequence,task_id,planner_state,admitted_at,reserved_bytes,
    planned_at
  ) values ($1,0,$2,'planned',$3,1024,$3)`, [
    input.runId,
    `${input.runId}-task-leased`,
    acceptedAt
  ]);
  await client.query(`insert into unified_check_planner_entries (
    run_id,canonical_sequence,task_id,planner_state,result_bytes,admitted_at,
    planned_at,ready_at,committed_at
  ) values ($1,1,$2,'committed',128,$3,$3,$3,$3)`, [
    input.runId,
    `${input.runId}-task-completed`,
    acceptedAt
  ]);
}

postgresDescribe("Unified runtime handoff repository", () => {
  it("owns intake once and performs an idempotent two-hour drain", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const client = await pool.connect();
    const schema = `handoff_registry_${randomUUID().replaceAll("-", "")}`;
    try {
      await createSchema(client, schema);
      const db = queryable(client);
      const now = new Date("2026-07-28T10:00:00.000Z");
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
        instanceId: "runtime-a",
        now,
        drainMs: 7_200_000
      });
      expect(requested.state).toBe("DRAIN_REQUESTED");
      expect(requested.drainDeadlineAt).toBe("2026-07-28T12:00:00.000Z");
      await expect(requestRuntimeDrain(db, {
        instanceId: "runtime-a",
        now: new Date("2026-07-28T10:10:00.000Z"),
        drainMs: 1_000
      })).resolves.toMatchObject({
        drainDeadlineAt: "2026-07-28T12:00:00.000Z"
      });

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

      await expect(heartbeatRuntime(db, {
        instanceId: "runtime-a",
        now: new Date("2026-07-28T10:00:04.000Z")
      })).resolves.toMatchObject({ state: "DRAINING" });
      await expect(markRuntimeStopped(db, {
        instanceId: "runtime-a",
        now: new Date("2026-07-28T10:00:05.000Z"),
        failureReason: null
      })).resolves.toMatchObject({ state: "STOPPED" });
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it("serializes concurrent intake registration and detects an equivalent replacement", async () => {
    const adminPool = new pg.Pool({ connectionString, max: 4 });
    const admin = await adminPool.connect();
    const schema = `handoff_concurrent_${randomUUID().replaceAll("-", "")}`;
    try {
      await createSchema(admin, schema);
      const left = await adminPool.connect();
      const right = await adminPool.connect();
      try {
        await left.query(`set search_path to "${schema}"`);
        await right.query(`set search_path to "${schema}"`);
        const now = new Date("2026-07-28T10:00:00.000Z");
        const results = await Promise.allSettled([
          registerActiveRuntime(queryable(left), {
            instanceId: "runtime-a",
            runtimeCommit: "a".repeat(40),
            instanceLabel: "left-aaaaaaaa",
            now
          }),
          registerActiveRuntime(queryable(right), {
            instanceId: "runtime-b",
            runtimeCommit: "a".repeat(40),
            instanceLabel: "right-aaaaaaaa",
            now
          })
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

        const active = await admin.query(
          "select instance_id from unified_runtime_instances where state='ACTIVE'"
        );
        const activeId = String(active.rows[0].instance_id);
        const drainingId = activeId === "runtime-a" ? "runtime-b" : "runtime-a";
        await admin.query(`insert into unified_runtime_instances (
          instance_id,runtime_commit,instance_label,state,started_at,heartbeat_at,
          drain_requested_at,drain_deadline_at,telegram_polling_released_at
        ) values ($1,$2,$3,'DRAINING',$4,$4,$4,$5,$4)
        on conflict (instance_id) do update set
          state='DRAINING', drain_requested_at=$4, drain_deadline_at=$5,
          telegram_polling_released_at=$4, stopped_at=null, failure_reason=null`, [
          drainingId,
          "a".repeat(40),
          `draining-aaaaaaaa`,
          now,
          new Date("2026-07-28T12:00:00.000Z")
        ]);
        await expect(hasLiveEquivalentReplacement(queryable(admin), {
          drainingInstanceId: drainingId,
          runtimeCommit: "a".repeat(40),
          now: new Date("2026-07-28T10:00:10.000Z"),
          heartbeatStaleMs: 60_000
        })).resolves.toBe(true);
      } finally {
        left.release();
        right.release();
      }
    } finally {
      await admin.query("reset search_path").catch(() => undefined);
      await admin.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      admin.release();
      await adminPool.end();
    }
  });

  it("enqueues progress once and atomically terminalizes an orphan without a score", async () => {
    const pool = new pg.Pool({ connectionString, max: 3 });
    const client = await pool.connect();
    const schema = `handoff_orphan_${randomUUID().replaceAll("-", "")}`;
    try {
      await createSchema(client, schema);
      const db = queryable(client);
      await seedRun(client, { runId: "run-old", runtimeCommit: "a".repeat(40) });

      await expect(enqueueDueLongRunningNotifications(db, {
        now: new Date("2026-07-28T10:05:00.000Z"),
        limit: 100
      })).resolves.toBe(2);
      await expect(enqueueDueLongRunningNotifications(db, {
        now: new Date("2026-07-28T10:06:00.000Z"),
        limit: 100
      })).resolves.toBe(0);

      await expect(reconcileOrphanedUnifiedRuns(db, {
        now: new Date("2026-07-28T10:06:00.000Z"),
        heartbeatStaleMs: 60_000,
        currentRuntimeCommit: "b".repeat(40),
        limit: 100
      })).resolves.toEqual({ terminalized: 1, notificationsCreated: 2 });
      await expect(reconcileOrphanedUnifiedRuns(db, {
        now: new Date("2026-07-28T10:07:00.000Z"),
        heartbeatStaleMs: 60_000,
        currentRuntimeCommit: "b".repeat(40),
        limit: 100
      })).resolves.toEqual({ terminalized: 0, notificationsCreated: 0 });

      const run = (await client.query(
        "select * from unified_check_runs where id='run-old'"
      )).rows[0];
      expect(run).toMatchObject({
        status: "FAILED_TECHNICAL",
        status_reason: "runtime_handoff_unavailable",
        final_score: null,
        final_decision: null,
        report_sha256: null
      });
      const tasks = (await client.query(
        "select id,status,lease_owner,lease_token,lease_expires_at from unified_check_tasks where run_id='run-old' order by id"
      )).rows;
      expect(tasks.find((row) => row.id.endsWith("completed"))?.status).toBe("COMPLETED");
      for (const task of tasks.filter((row) => !row.id.endsWith("completed"))) {
        expect(task).toMatchObject({
          status: "CANCELLED",
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null
        });
      }
      const planner = (await client.query(
        "select canonical_sequence,planner_state,admitted_at,reserved_bytes,committed_at from unified_check_planner_entries where run_id='run-old' order by canonical_sequence"
      )).rows;
      expect(planner[0]).toMatchObject({
        planner_state: "planned",
        admitted_at: null,
        reserved_bytes: null,
        committed_at: null
      });
      expect(planner[1].planner_state).toBe("committed");
      expect(planner[1].committed_at).not.toBeNull();
      const requests = (await client.query(
        "select status,status_reason,run_id from unified_check_requests where run_id='run-old'"
      )).rows;
      expect(requests).toHaveLength(2);
      expect(requests.every((row) =>
        row.status === "FAILED_TECHNICAL" &&
        row.status_reason === "runtime_handoff_unavailable" &&
        row.run_id === "run-old"
      )).toBe(true);
      const notifications = (await client.query(
        "select kind,status from unified_check_notifications order by request_id,kind"
      )).rows;
      expect(notifications.filter((row) => row.kind === "LONG_RUNNING"))
        .toEqual([{ kind: "LONG_RUNNING", status: "CANCELLED" }, { kind: "LONG_RUNNING", status: "CANCELLED" }]);
      expect(notifications.filter((row) => row.kind === "FAILED_TECHNICAL_RUNTIME_HANDOFF"))
        .toHaveLength(2);
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it("protects current and live-draining runs, then uses the exact drain deadline", async () => {
    const pool = new pg.Pool({ connectionString, max: 3 });
    const client = await pool.connect();
    const schema = `handoff_deadline_${randomUUID().replaceAll("-", "")}`;
    try {
      await createSchema(client, schema);
      const db = queryable(client);
      const oldCommit = "a".repeat(40);
      const currentCommit = "b".repeat(40);
      await seedRun(client, { runId: "run-old", runtimeCommit: oldCommit });
      await seedRun(client, { runId: "run-current", runtimeCommit: currentCommit });
      await client.query(`insert into unified_runtime_instances (
        instance_id,runtime_commit,instance_label,state,started_at,heartbeat_at,
        drain_requested_at,drain_deadline_at,telegram_polling_released_at
      ) values ('runtime-old',$1,'old-aaaaaaaa','DRAINING',$2,$3,$2,$4,$2)`, [
        oldCommit,
        new Date("2026-07-28T10:00:00.000Z"),
        new Date("2026-07-28T11:59:30.000Z"),
        new Date("2026-07-28T12:00:00.000Z")
      ]);
      await expect(reconcileOrphanedUnifiedRuns(db, {
        now: new Date("2026-07-28T11:59:59.999Z"),
        heartbeatStaleMs: 60_000,
        currentRuntimeCommit: currentCommit,
        limit: 100
      })).resolves.toEqual({ terminalized: 0, notificationsCreated: 0 });

      await expect(terminalizeExpiredRuntimeRuns(db, {
        now: new Date("2026-07-28T12:00:00.000Z"),
        drainingInstanceId: "runtime-old",
        runtimeCommit: oldCommit,
        heartbeatStaleMs: 60_000,
        limit: 100
      })).resolves.toEqual({ terminalized: 1, notificationsCreated: 2 });
      const statuses = (await client.query(
        "select id,status,status_reason from unified_check_runs order by id"
      )).rows;
      expect(statuses).toEqual([
        { id: "run-current", status: "RUNNING", status_reason: null },
        { id: "run-old", status: "FAILED_TECHNICAL", status_reason: "runtime_handoff_deadline_exceeded" }
      ]);

      await expect(cancelStaleLongRunningNotifications(db, {
        now: new Date("2026-07-28T12:00:01.000Z"),
        limit: 100
      })).resolves.toBe(0);
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it("leases and settles lifecycle notifications without duplicate claim", async () => {
    const pool = new pg.Pool({ connectionString, max: 3 });
    const client = await pool.connect();
    const schema = `handoff_outbox_${randomUUID().replaceAll("-", "")}`;
    try {
      await createSchema(client, schema);
      const db = queryable(client);
      await seedRun(client, { runId: "run-old", runtimeCommit: "a".repeat(40) });
      await client.query(`insert into unified_check_notifications (
        id,request_id,kind,locale,copy_version,status,ready_at,created_at,updated_at
      ) values (
        'notice-1','run-old-request-a','LONG_RUNNING','ru',
        'unified-lifecycle-copy-v1','PENDING',$1,$1,$1
      )`, [new Date("2026-07-28T10:05:00.000Z")]);
      const outbox = createPostgresUnifiedLifecycleNotificationRepository(db);
      const claimed = await outbox.claimNext({
        leaseToken: "lease-1",
        leaseMs: 30_000,
        now: new Date("2026-07-28T10:06:00.000Z")
      });
      expect(claimed).toMatchObject({
        notificationId: "notice-1",
        leaseToken: "lease-1",
        kind: "LONG_RUNNING"
      });
      await expect(outbox.claimNext({
        leaseToken: "lease-2",
        leaseMs: 30_000,
        now: new Date("2026-07-28T10:06:00.000Z")
      })).resolves.toBeNull();
      await expect(outbox.isStillSendable({
        notificationId: "notice-1",
        leaseToken: "lease-1"
      })).resolves.toBe(true);
      await expect(outbox.settle({
        notificationId: "notice-1",
        leaseToken: "lease-1",
        status: "RETRYABLE",
        errorCode: "telegram_rate_limited",
        retryAt: "2026-07-28T10:07:00.000Z",
        telegramMessageId: null
      })).resolves.toBe(true);
      await expect(outbox.claimNext({
        leaseToken: "lease-3",
        leaseMs: 30_000,
        now: new Date("2026-07-28T10:06:59.999Z")
      })).resolves.toBeNull();
      await expect(outbox.claimNext({
        leaseToken: "lease-4",
        leaseMs: 30_000,
        now: new Date("2026-07-28T10:07:00.000Z")
      })).resolves.toMatchObject({ leaseToken: "lease-4", attempt: 2 });
      await expect(outbox.markExpiredLeasesUnknown({
        now: new Date("2026-07-28T10:07:30.000Z")
      })).resolves.toBe(1);
      expect((await client.query(
        "select status from unified_check_notifications where id='notice-1'"
      )).rows[0].status).toBe("DELIVERY_UNKNOWN");
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
