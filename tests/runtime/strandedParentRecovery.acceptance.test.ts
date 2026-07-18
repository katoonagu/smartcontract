import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  STRANDED_PARENT_RUNTIME_CASES,
  type StrandedParentRuntimeCase
} from "../fixtures/runtime/remediationRuntimeCases";

const PLAN3_DATABASE_URL = process.env.PLAN3_TEST_DATABASE_URL
  ?? "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3";
const required = process.env.REQUIRE_PLAN3_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
const plan3Url = new URL(PLAN3_DATABASE_URL);
if (required && (connectionString !== PLAN3_DATABASE_URL
    || plan3Url.hostname !== "127.0.0.1"
    || plan3Url.pathname !== "/tron_watch_plan3"
    || plan3Url.port === "55999")) {
  throw new Error(`Plan 3 PostgreSQL acceptance requires TEST_DATABASE_URL=${PLAN3_DATABASE_URL}`);
}
const postgresDescribe = required ? describe : describe.skip;
const databaseUrl = connectionString ?? PLAN3_DATABASE_URL;
const NOW = new Date("2026-07-15T12:00:00.000Z");

type ScenarioContext = {
  fixture: StrandedParentRuntimeCase;
  schema: string;
  applicationName: string;
  db: pg.Pool;
  admin: pg.Pool;
};

type RuntimeJob = {
  id: string;
  kind: string;
  chatId: string | null;
  progressJson: Record<string, unknown>;
};

type TelegramPayload = {
  version: "telegram-message-payload-v1";
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
  replyMarkup: Record<string, unknown> | null;
};

type ForensicRuntimeOrchestration = {
  runVerifiedStartup(): Promise<void>;
  runForensicCycle(): Promise<void>;
  runDeliveryCycle(): Promise<void>;
};

type CreateForensicRuntimeOrchestration = (input: {
  db: pg.Pool;
  now: () => Date;
  reconciliationLimit: number;
  forensicClaimLimit: number;
  deliveryLimit: number;
  buildClaimedJobCompletion: (job: RuntimeJob) => {
    status: "completed";
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: null;
    telegramPayload: TelegramPayload;
    telegramEffect: null;
  };
  sendTelegram: (payload: TelegramPayload, signal: AbortSignal) => Promise<void>;
}) => ForensicRuntimeOrchestration;

async function installRuntimeSchema(db: pg.Pool): Promise<void> {
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

async function insertFixture(db: pg.Pool, fixture: StrandedParentRuntimeCase): Promise<void> {
  await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, requested_by, progress_json
     ) values ($1, $2, $3, 'queued', $4, $5, 100, $6, $7, $8::jsonb)`,
    [
      fixture.parent.id,
      fixture.parent.kind,
      fixture.parent.subjectAddress,
      new Date("2026-07-01T00:00:00.000Z"),
      NOW,
      fixture.parent.chatId,
      `synthetic-requester-${fixture.id}`,
      JSON.stringify(fixture.parent.progressJson)
    ]
  );

  for (const wait of fixture.waits) {
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

async function createScenario(fixture: StrandedParentRuntimeCase): Promise<ScenarioContext> {
  const schema = `plan3_stranded_${fixture.id.replaceAll("-", "_")}_${randomUUID().replaceAll("-", "")}`;
  const applicationName = `${schema}_client`.slice(0, 63);
  const admin = new pg.Pool({
    connectionString: databaseUrl,
    application_name: `${schema}_admin`.slice(0, 63)
  });
  let db: pg.Pool | null = null;
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
    await installRuntimeSchema(db);
    await insertFixture(db, fixture);
    const durable = await db.query(
      `select count(*)::integer as total,
        count(*) filter (where status = 'ready')::integer as ready
       from forensic_job_waits where job_id = $1`,
      [fixture.parent.id]
    );
    expect(durable.rows[0]).toEqual({ total: fixture.waits.length, ready: fixture.waits.length });
    return { fixture, schema, applicationName, db, admin };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (db) {
      try {
        await db.end();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await admin.query(`drop schema if exists "${schema}" cascade`);
      const cleanup = await admin.query("select to_regnamespace($1) as schema_name", [schema]);
      if (cleanup.rows[0]?.schema_name !== null) {
        throw new Error(`Plan 3 stranded schema cleanup failed: ${schema}`);
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await admin.end();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], `Plan 3 stranded setup and cleanup failed: ${schema}`);
    }
    throw error;
  }
}

async function cleanupScenario(context: ScenarioContext): Promise<void> {
  const cleanupErrors: unknown[] = [];
  try {
    await context.db.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await context.admin.query(`drop schema if exists "${context.schema}" cascade`);
    const cleanup = await context.admin.query("select to_regnamespace($1) as schema_name", [context.schema]);
    if (cleanup.rows[0]?.schema_name !== null) {
      throw new Error(`Plan 3 stranded schema cleanup failed: ${context.schema}`);
    }
    const locks = await context.admin.query(
      `select count(*)::integer as count
       from pg_locks lock_row
       join pg_stat_activity activity on activity.pid = lock_row.pid
       where lock_row.locktype = 'advisory' and activity.application_name = $1`,
      [context.applicationName]
    );
    if (locks.rows[0]?.count !== 0) {
      throw new Error(`Plan 3 stranded advisory-lock cleanup failed: ${context.schema}`);
    }
    console.log(`[PLAN3_PG_CLEANUP] ${context.schema}=dropped`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await context.admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Plan 3 stranded cleanup failed: ${context.schema}`);
  }
}

function deliveryPayload(fixture: StrandedParentRuntimeCase): TelegramPayload {
  return {
    version: "telegram-message-payload-v1",
    chatId: fixture.parent.chatId,
    text: `synthetic forensic result ${fixture.id}`,
    parseMode: "HTML",
    replyMarkup: null
  };
}

function payloadFingerprint(payload: TelegramPayload): string {
  return createHash("sha256").update(JSON.stringify({
    chatId: payload.chatId,
    parseMode: payload.parseMode,
    replyMarkup: payload.replyMarkup,
    text: payload.text
  })).digest("hex");
}

postgresDescribe("Plan 3 stranded parent startup recovery", () => {
  it("[AC-14][STRANDED-PARENT] recovers TDEA 163 TDEA repeat 104 and TYD 216 through one completed delivery each", async () => {
    const serializedFixture = JSON.stringify(STRANDED_PARENT_RUNTIME_CASES);
    expect(serializedFixture).not.toMatch(/\bT[1-9A-HJ-NP-Za-km-z]{33}\b/);
    expect(serializedFixture).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(STRANDED_PARENT_RUNTIME_CASES.map((fixture) => fixture.waits.length)).toEqual([163, 104, 216]);

    const contexts: ScenarioContext[] = [];
    let primaryFailed = false;
    let primaryError: unknown;
    try {
      for (const fixture of STRANDED_PARENT_RUNTIME_CASES) contexts.push(await createScenario(fixture));

      // Future Plan 3 modules are deliberately loaded only after every durable wait row exists.
      const modulePath: string = "../../src/runtime/forensicRuntimeOrchestration";
      const runtimeModule = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
      if (typeof runtimeModule.createForensicRuntimeOrchestration !== "function") {
        throw new Error("Plan 3 feature missing: createForensicRuntimeOrchestration");
      }
      const createForensicRuntimeOrchestration =
        runtimeModule.createForensicRuntimeOrchestration as CreateForensicRuntimeOrchestration;

      for (const context of contexts) {
        const { db, fixture } = context;
        const claims: string[] = [];
        const pendingFingerprints: string[] = [];
        const sends: string[] = [];
        const payload = deliveryPayload(fixture);
        const fingerprint = payloadFingerprint(payload);
        const runtime = createForensicRuntimeOrchestration({
          db,
          now: () => NOW,
          reconciliationLimit: 10,
          forensicClaimLimit: 1,
          deliveryLimit: 10,
          buildClaimedJobCompletion: (job) => {
            claims.push(job.id);
            return {
              status: "completed",
              progressJson: { ...job.progressJson, fixtureId: fixture.id },
              resultJson: { fixtureId: fixture.id, status: "synthetic-completed" },
              rawEvidenceIds: [],
              observationIds: [],
              lastError: null,
              telegramPayload: payload,
              telegramEffect: null
            };
          },
          sendTelegram: async (claimedPayload, signal) => {
            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal.aborted).toBe(false);
            expect(claimedPayload).toEqual(payload);
            sends.push(fingerprint);
          }
        });

        await runtime.runVerifiedStartup();
        await runtime.runForensicCycle();
        const pending = await db.query(
          "select status, result_json, progress_json from forensic_check_jobs where id = $1",
          [fixture.parent.id]
        );
        expect(pending.rows[0]).toMatchObject({
          status: "completed",
          result_json: { fixtureId: fixture.id, status: "synthetic-completed" },
          progress_json: {
            telegramDelivery: {
              version: "forensic-telegram-delivery-v1",
              state: { status: "pending", attemptCount: 0, messageFingerprint: fingerprint },
              claim: null
            }
          }
        });
        pendingFingerprints.push(pending.rows[0].progress_json.telegramDelivery.state.messageFingerprint);
        await runtime.runDeliveryCycle();

        // A repeated startup/restart must cross neither the forensic claim nor the sent fence again.
        await runtime.runVerifiedStartup();
        await runtime.runForensicCycle();
        await runtime.runDeliveryCycle();

        const completed = await db.query(
          "select status, result_json, progress_json from forensic_check_jobs where id = $1",
          [fixture.parent.id]
        );
        expect(completed.rows[0]).toMatchObject({
          status: "completed",
          result_json: { fixtureId: fixture.id, status: "synthetic-completed" },
          progress_json: {
            telegramDelivery: {
              state: { status: "sent", attemptCount: 1, messageFingerprint: fingerprint },
              claim: null
            }
          }
        });
        expect(claims).toEqual([fixture.parent.id]);
        expect(pendingFingerprints).toEqual([fingerprint]);
        expect(sends).toEqual([fingerprint]);
      }
    } catch (error) {
      primaryFailed = true;
      primaryError = error;
    }

    const cleanupErrors: unknown[] = [];
    for (const context of contexts.reverse()) {
      try {
        await cleanupScenario(context);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (primaryFailed && cleanupErrors.length > 0) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        "Plan 3 stranded parent acceptance and cleanup failed"
      );
    }
    if (primaryFailed) throw primaryError;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Plan 3 stranded parent cleanup failed");
    }
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
      throw new Error(`Refusing Plan 3 stranded cleanup audit database ${String(database.rows[0]?.name)}`);
    }
    const schemas = await admin.query(
      "select schema_name from information_schema.schemata where schema_name like 'plan3_stranded_%'"
    );
    const triggers = await admin.query(
      `select count(*)::integer as count
       from pg_trigger trigger_row
       join pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where not trigger_row.tgisinternal and namespace.nspname like 'plan3_stranded_%'`
    );
    const locks = await admin.query(
      `select count(*)::integer as count
       from pg_locks lock_row
       join pg_stat_activity activity on activity.pid = lock_row.pid
       where lock_row.locktype = 'advisory' and activity.application_name like 'plan3_stranded_%'`
    );
    if (schemas.rows.length > 0 || triggers.rows[0]?.count !== 0 || locks.rows[0]?.count !== 0) {
      throw new Error(
        `Plan 3 stranded cleanup audit failed: schemas=${schemas.rows.length}, `
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
    throw new AggregateError([auditError, closeError], "Plan 3 stranded audit and pool cleanup failed");
  }
  if (auditFailed) throw auditError;
  if (closeError !== undefined) throw closeError;
});
