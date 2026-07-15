import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  remediationParent,
  remediationWaits,
  type RemediationRuntimeParent,
  type RemediationRuntimeWaitRow
} from "../fixtures/runtime/remediationRuntimeCases";

const PLAN3_DATABASE_URL = "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3";
const required = process.env.REQUIRE_PLAN3_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
if (required && connectionString !== PLAN3_DATABASE_URL) {
  throw new Error(`Plan 3 PostgreSQL acceptance requires TEST_DATABASE_URL=${PLAN3_DATABASE_URL}`);
}
const postgresDescribe = required ? describe : describe.skip;
const databaseUrl = connectionString ?? PLAN3_DATABASE_URL;
const NOW = new Date("2026-07-15T12:00:00.000Z");

type Reconciliation = {
  parentJobId: string;
  readyCount: number;
  terminalCount: number;
  cancelledCount: number;
  waitingCount: number;
  outcome: "resume_ready" | "resume_terminal" | "unchanged" | "contradictory";
  diagnosticCode: string | null;
};

type Plan3WaitRepository = {
  reconcileWaitingForensicCheckJobs: (
    db: pg.Pool,
    input: { now: Date; limit: number }
  ) => Promise<Reconciliation[]>;
  claimNextForensicCheckJob: (
    db: pg.Pool,
    input: { kinds: Array<"where_is_money_check" | "incoming_deposit_check"> }
  ) => Promise<{ id: string; status: string; progressJson: Record<string, unknown> } | null>;
};

async function loadPlan3WaitRepository(): Promise<Plan3WaitRepository> {
  const modulePath: string = "../../src/storage/repositories";
  const repository = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  if (typeof repository.reconcileWaitingForensicCheckJobs !== "function") {
    throw new Error("Plan 3 feature missing: reconcileWaitingForensicCheckJobs");
  }
  return repository as unknown as Plan3WaitRepository;
}

async function installWaitSchema(db: pg.Pool): Promise<void> {
  await db.query(`
    create table forensic_check_jobs (
      id text primary key,
      kind text not null check (kind in ('where_is_money_check', 'incoming_deposit_check')),
      subject_address text not null,
      status text not null check (status in ('queued', 'running', 'partial', 'completed', 'failed', 'cancelled')),
      window_start timestamptz not null,
      window_end timestamptz not null,
      priority integer not null default 100,
      chat_id text,
      message_id text,
      requested_by text,
      progress_json jsonb not null default '{}'::jsonb,
      result_json jsonb not null default '{}'::jsonb,
      raw_evidence_ids jsonb not null default '[]'::jsonb,
      observation_ids jsonb not null default '[]'::jsonb,
      last_error text,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index forensic_check_jobs_claim_idx
      on forensic_check_jobs(status, priority desc, created_at asc) where status = 'queued';
    create table forensic_job_waits (
      id text primary key,
      job_id text not null,
      wait_type text not null check (wait_type = 'targeted_usdt_history'),
      address text not null,
      coverage_mode text not null check (coverage_mode = 'targeted'),
      target_timestamp_ms bigint not null,
      target_timestamp timestamptz not null,
      required_for text not null check (required_for in ('where_hop', 'incoming_hop')),
      status text not null check (status in ('waiting', 'ready', 'terminal', 'cancelled')),
      status_reason text,
      last_error text,
      attempt_count integer not null default 0,
      request_kind text not null check (request_kind in ('broad_targeted', 'candidate_window')),
      window_start_timestamp_ms bigint not null,
      window_start_timestamp timestamptz,
      window_end_timestamp_ms bigint not null,
      window_end_timestamp timestamptz,
      related_hop_tx_hash text,
      candidate_tx_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (job_id, wait_type, address, coverage_mode, target_timestamp_ms,
        request_kind, window_start_timestamp_ms, candidate_tx_hash)
    );
    create index forensic_job_waits_job_idx on forensic_job_waits(job_id, status);
  `);
}

async function insertParent(
  db: pg.Pool,
  parent: RemediationRuntimeParent,
  status = "queued"
): Promise<void> {
  await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, requested_by, progress_json, result_json
     ) values ($1, $2, $3, $4, $5, $6, 100, $7, $8, $9::jsonb, $10::jsonb)`,
    [
      parent.id,
      parent.kind,
      parent.subjectAddress,
      status,
      new Date("2026-07-01T00:00:00.000Z"),
      NOW,
      parent.chatId,
      `synthetic-requester-${parent.id}`,
      JSON.stringify(parent.progressJson),
      JSON.stringify({ fixtureId: parent.id })
    ]
  );
}

async function insertWaits(db: pg.Pool, waits: RemediationRuntimeWaitRow[]): Promise<void> {
  for (const wait of waits) {
    await db.query(
      `insert into forensic_job_waits (
         id, job_id, wait_type, address, coverage_mode,
         target_timestamp_ms, target_timestamp, required_for, status, status_reason,
         request_kind, window_start_timestamp_ms, window_start_timestamp,
         window_end_timestamp_ms, window_end_timestamp, related_hop_tx_hash, candidate_tx_hash
       ) values (
         $1, $2, 'targeted_usdt_history', $3, 'targeted',
         $4, $5, $6, $7, $8, 'candidate_window', $9, $10, $4, $5, $11, $12
       )`,
      [
        wait.id,
        wait.jobId,
        wait.address,
        wait.targetTimestamp.getTime(),
        wait.targetTimestamp,
        wait.requiredFor,
        wait.status,
        wait.statusReason,
        wait.windowStartTimestamp.getTime(),
        wait.windowStartTimestamp,
        wait.relatedHopTxHash,
        wait.candidateTxHash
      ]
    );
  }
}

async function withDisposableScenario(
  label: string,
  run: (db: pg.Pool) => Promise<void>
): Promise<void> {
  const schema = `plan3_wait_${label}_${randomUUID().replaceAll("-", "")}`;
  const applicationName = `${schema}_client`.slice(0, 63);
  const admin = new pg.Pool({
    connectionString: databaseUrl,
    application_name: `${schema}_admin`.slice(0, 63)
  });
  let db: pg.Pool | null = null;
  let primaryFailed = false;
  let primaryError: unknown;
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 acceptance database ${String(database.rows[0]?.name)}`);
    }
    await admin.query(`create schema "${schema}"`);
    db = new pg.Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema}`
    });
    await installWaitSchema(db);
    await run(db);
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (db) {
    try {
      await db.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await admin.query(`drop schema if exists "${schema}" cascade`);
    const cleanup = await admin.query("select to_regnamespace($1) as schema_name", [schema]);
    if (cleanup.rows[0]?.schema_name !== null) {
      throw new Error(`Plan 3 wait schema cleanup failed: ${schema}`);
    }
    const locks = await admin.query(
      `select count(*)::integer as count
       from pg_locks lock_row
       join pg_stat_activity activity on activity.pid = lock_row.pid
       where lock_row.locktype = 'advisory' and activity.application_name = $1`,
      [applicationName]
    );
    if (locks.rows[0]?.count !== 0) {
      throw new Error(`Plan 3 wait advisory-lock cleanup failed: ${schema}`);
    }
    console.log(`[PLAN3_PG_CLEANUP] ${schema}=dropped`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryFailed && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], `Plan 3 wait scenario and cleanup failed: ${schema}`);
  }
  if (primaryFailed) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Plan 3 wait cleanup failed: ${schema}`);
  }
}

async function parentRow(db: pg.Pool, id: string): Promise<Record<string, any>> {
  const result = await db.query(
    "select id, status, progress_json, result_json, last_error, completed_at from forensic_check_jobs where id = $1",
    [id]
  );
  return result.rows[0];
}

postgresDescribe("Plan 3 durable wait reconciliation acceptance", () => {
  it("[AC-14] reconciles and claims an all-ready parent exactly once", async () => {
    await withDisposableScenario("all_ready", async (db) => {
      const parent = remediationParent("all-ready");
      await insertParent(db, parent);
      await insertWaits(db, remediationWaits(parent, ["ready", "ready", "ready"]));
      const repository = await loadPlan3WaitRepository();

      const reconciliations = (await Promise.all([
        repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 }),
        repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })
      ])).flat();
      expect(reconciliations).toEqual([{
        parentJobId: parent.id,
        readyCount: 3,
        terminalCount: 0,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_ready",
        diagnosticCode: null
      }]);

      const claims = await Promise.all([
        repository.claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] }),
        repository.claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] })
      ]);
      expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
      expect(claims.find((claim) => claim !== null)).toMatchObject({ id: parent.id, status: "running" });
      expect((await parentRow(db, parent.id)).progress_json).toMatchObject({
        jobPhase: "reading_local_index",
        waitReconciliation: { outcome: "resume_ready", readyCount: 3 }
      });
      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([]);
    });
  });

  it("[AC-15] resumes mixed ready-terminal waits through technical path", async () => {
    await withDisposableScenario("mixed_terminal", async (db) => {
      const parent = remediationParent("mixed-terminal", "incoming_deposit_check");
      await insertParent(db, parent);
      await insertWaits(db, remediationWaits(parent, ["ready", "terminal", "ready"]));
      const repository = await loadPlan3WaitRepository();

      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: parent.id,
        readyCount: 2,
        terminalCount: 1,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_terminal",
        diagnosticCode: null
      }]);
      expect(await parentRow(db, parent.id)).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "provider_limited",
          waitReconciliation: { outcome: "resume_terminal", terminalCount: 1 }
        }
      });
      await expect(repository.claimNextForensicCheckJob(db, { kinds: ["incoming_deposit_check"] }))
        .resolves.toMatchObject({ id: parent.id, status: "running" });
    });
  });

  it("[REQ-35][WAIT-GUARD] leaves a parent waiting while any sibling wait is waiting", async () => {
    await withDisposableScenario("waiting_sibling", async (db) => {
      const parent = remediationParent("waiting-sibling");
      await insertParent(db, parent);
      await insertWaits(db, remediationWaits(parent, ["ready", "waiting", "terminal"]));
      const repository = await loadPlan3WaitRepository();

      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: parent.id,
        readyCount: 1,
        terminalCount: 1,
        cancelledCount: 0,
        waitingCount: 1,
        outcome: "unchanged",
        diagnosticCode: null
      }]);
      expect(await parentRow(db, parent.id)).toMatchObject({
        status: "queued",
        progress_json: { jobPhase: "waiting_for_targeted_index" }
      });
      await expect(repository.claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] })).resolves.toBeNull();
    });
  });

  it("[REQ-35][WAIT-GUARD] never rewrites a running or final parent", async () => {
    const repository = await loadPlan3WaitRepository();
    for (const status of ["running", "partial", "completed", "failed", "cancelled"]) {
      await withDisposableScenario(`parent_${status}`, async (db) => {
        const parent = remediationParent(`parent-${status}`);
        await insertParent(db, parent, status);
        await insertWaits(db, remediationWaits(parent, ["ready", "ready"]));
        const before = await parentRow(db, parent.id);

        await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([]);
        expect(await parentRow(db, parent.id)).toEqual(before);
      });
    }
  });

  it("[REQ-38][WAIT-DIAGNOSTIC] leaves a missing wait set waiting with a diagnostic", async () => {
    await withDisposableScenario("missing_waits", async (db) => {
      const parent = remediationParent("missing-waits");
      await insertParent(db, parent);
      const repository = await loadPlan3WaitRepository();

      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: parent.id,
        readyCount: 0,
        terminalCount: 0,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "contradictory",
        diagnosticCode: "missing_wait_rows"
      }]);
      expect(await parentRow(db, parent.id)).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "waiting_for_targeted_index",
          waitReconciliation: { outcome: "contradictory", diagnosticCode: "missing_wait_rows" }
        }
      });
      await expect(repository.claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] })).resolves.toBeNull();
    });
  });

  it("[REQ-38][WAIT-DIAGNOSTIC] leaves any cancelled wait set waiting with a diagnostic", async () => {
    await withDisposableScenario("cancelled_wait", async (db) => {
      const parent = remediationParent("cancelled-wait");
      await insertParent(db, parent);
      await insertWaits(db, remediationWaits(parent, ["ready", "cancelled", "ready"]));
      const repository = await loadPlan3WaitRepository();

      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: parent.id,
        readyCount: 2,
        terminalCount: 0,
        cancelledCount: 1,
        waitingCount: 0,
        outcome: "contradictory",
        diagnosticCode: "cancelled_wait_present"
      }]);
      expect(await parentRow(db, parent.id)).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "waiting_for_targeted_index",
          waitReconciliation: { outcome: "contradictory", diagnosticCode: "cancelled_wait_present" }
        }
      });
      await expect(repository.claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] })).resolves.toBeNull();
    });
  });
});

afterAll(async () => {
  if (!required) return;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  let auditFailed = false;
  let auditError: unknown;
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 wait cleanup audit database ${String(database.rows[0]?.name)}`);
    }
    const schemas = await admin.query(
      "select schema_name from information_schema.schemata where schema_name like 'plan3_wait_%'"
    );
    const triggers = await admin.query(
      `select count(*)::integer as count
       from pg_trigger trigger_row
       join pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where not trigger_row.tgisinternal and namespace.nspname like 'plan3_wait_%'`
    );
    const locks = await admin.query(
      `select count(*)::integer as count
       from pg_locks lock_row
       join pg_stat_activity activity on activity.pid = lock_row.pid
       where lock_row.locktype = 'advisory' and activity.application_name like 'plan3_wait_%'`
    );
    if (schemas.rows.length > 0 || triggers.rows[0]?.count !== 0 || locks.rows[0]?.count !== 0) {
      throw new Error(
        `Plan 3 wait cleanup audit failed: schemas=${schemas.rows.length}, `
        + `triggers=${triggers.rows[0]?.count}, locks=${locks.rows[0]?.count}`
      );
    }
  } catch (error) {
    auditFailed = true;
    auditError = error;
  }
  let closeError: unknown;
  try {
    await admin.end();
  } catch (error) {
    closeError = error;
  }
  if (auditFailed && closeError !== undefined) {
    throw new AggregateError([auditError, closeError], "Plan 3 wait audit and pool cleanup failed");
  }
  if (auditFailed) throw auditError;
  if (closeError !== undefined) throw closeError;
});
