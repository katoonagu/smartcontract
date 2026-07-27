import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DeepSecondLayerRelationshipProfile } from "../../src/types";
import { CANONICAL_DEEP_SECOND_LAYER_PROFILE } from "../fixtures/runtime/remediationRuntimeCases";

const PLAN3_DATABASE_URL = process.env.PLAN3_TEST_DATABASE_URL
  ?? "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3";
const OFFICIAL_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const NOW = new Date("2026-07-15T12:00:00.000Z");
const required = process.env.REQUIRE_PLAN3_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;

const plan3Url = new URL(PLAN3_DATABASE_URL);
if (required && (connectionString !== PLAN3_DATABASE_URL
    || plan3Url.hostname !== "127.0.0.1"
    || plan3Url.pathname !== "/tron_watch_plan3"
    || plan3Url.port === "55999")) {
  throw new Error("Plan 3 PostgreSQL acceptance database binding is invalid");
}

const postgresDescribe = required ? describe : describe.skip;
const databaseUrl = connectionString ?? PLAN3_DATABASE_URL;
const filePrefix = `plan3_delivery_${process.pid}_`;
const repositoryModulePath = "../../src/storage/repositories";

type JobKind = "where_is_money_check" | "address_deep_check" | "incoming_deposit_check";
type TerminalStatus = "partial" | "completed" | "failed";
type JsonObject = Record<string, unknown>;

type DeepSecondLayerContextV1 = {
  version: "deep-second-layer-context-v1";
  baseResultFingerprint: string;
  refreshedAt: string;
  profile: DeepSecondLayerRelationshipProfile;
};

type TelegramPayload = {
  version: "telegram-message-payload-v1";
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
  replyMarkup: Record<string, unknown> | null;
};

type DeliveryEffect = {
  kind: "incoming_user_alert";
  watchedWalletId: string;
  incomingTxHash: string;
} | null;

type DeliveryEnvelope = {
  version: "forensic-telegram-delivery-v1";
  payload: TelegramPayload;
  effect: DeliveryEffect;
  state: {
    status: "pending" | "sent" | "retryable" | "failed";
    attemptCount: number;
    lastAttemptAt: string | null;
    sentAt: string | null;
    lastError: string | null;
    messageFingerprint: string;
  };
  claim: null | {
    token: string;
    attempt: number;
    claimedAt: string;
    leaseExpiresAt: string;
  };
};

type DeliveryClaim = {
  jobId: string;
  kind: JobKind;
  payload: TelegramPayload;
  effect: DeliveryEffect;
  messageFingerprint: string;
  claim: NonNullable<DeliveryEnvelope["claim"]>;
};

type WaitReconciliation = {
  parentJobId: string;
  readyCount: number;
  terminalCount: number;
  cancelledCount: number;
  waitingCount: number;
  outcome: "resume_ready" | "resume_terminal" | "unchanged" | "contradictory";
  diagnosticCode: string | null;
};

type CompletionInput = {
  id: string;
  claimStartedAt: Date;
  status: TerminalStatus;
  progressJson: JsonObject;
  resultJson: JsonObject;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

type Plan3Repository = {
  reconcileWaitingForensicCheckJobs: (
    db: pg.Pool,
    input: { now: Date; limit: number }
  ) => Promise<WaitReconciliation[]>;
  claimNextForensicCheckJob: (
    db: pg.Pool,
    input: { kinds: JobKind[] }
  ) => Promise<{ id: string; status: string } | null>;
  completeForensicCheckJob: (db: pg.Pool, input: CompletionInput) => Promise<boolean>;
  claimNextForensicTelegramDelivery: (
    db: pg.Pool,
    input: { now: Date }
  ) => Promise<DeliveryClaim | null>;
  settleForensicTelegramDelivery: (
    db: pg.Pool,
    input: {
      jobId: string;
      messageFingerprint: string;
      attempt: number;
      claimToken: string;
      settledAt: Date;
      outcome: "sent" | "retryable" | "failed";
      errorCode?: string | null;
    }
  ) => Promise<boolean>;
  claimUserAlertsForRetry: (
    db: pg.Pool,
    input: { limit: number; staleSendingBefore: Date }
  ) => Promise<Array<{ txHash: string; watchedWalletId: string }>>;
  saveCompletedDeepSecondLayerContext: (
    db: pg.Pool,
    input: { id: string; context: DeepSecondLayerContextV1 }
  ) => Promise<boolean>;
  recoverStaleForensicCheckJobs: (
    db: pg.Pool,
    input: { staleRunningBefore: Date; maxRetries: number; limit: number; recoveredAt: Date }
  ) => Promise<{ requeued: unknown[]; failed: Array<{ id: string; progressJson: JsonObject }> }>;
  listDueRecoveredForensicDeliveryIntents: (
    db: pg.Pool,
    input: { now: Date; limit: number }
  ) => Promise<Array<{ jobId: string; intent: JsonObject }>>;
  attachRecoveredForensicTelegramDelivery: (
    db: pg.Pool,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      delivery: DeliveryEnvelope;
    }
  ) => Promise<boolean>;
  settleRecoveredForensicDeliveryIntentPreparation: (
    db: pg.Pool,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      attemptedAt: Date;
      errorCode: string;
    }
  ) => Promise<boolean>;
  listDueApprovalAllowanceRefreshTargets: (
    db: pg.Pool,
    input: { now: Date; limit: number }
  ) => Promise<Array<{
    watchedWalletId: string;
    ownerAddress: string;
    tokenContract: string;
    spenderAddress: string;
  }>>;
  tryAcquireApprovalAllowanceRefreshLock: (
    db: pg.Pool,
    input: {
      watchedWalletId: string;
      tokenContract: string;
      spenderAddress: string;
      now: Date;
    }
  ) => Promise<null | { release: () => Promise<void> }>;
};

function safeIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  return `"${value}"`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadFingerprint(payload: TelegramPayload): string {
  return createHash("sha256").update(canonicalJson({
    chatId: payload.chatId,
    text: payload.text,
    parseMode: payload.parseMode,
    replyMarkup: payload.replyMarkup
  })).digest("hex");
}

function payload(jobId: string, kind: JobKind): TelegramPayload {
  return {
    version: "telegram-message-payload-v1",
    chatId: `sanitized-chat-${jobId}`,
    text: `<b>${kind}</b> sanitized result ${jobId}`,
    parseMode: "HTML",
    replyMarkup: { inline_keyboard: [[{ text: "Open", callback_data: `job:${jobId}` }]] }
  };
}

function pendingDelivery(jobId: string, kind: JobKind, effect: DeliveryEffect = null): DeliveryEnvelope {
  const message = payload(jobId, kind);
  return {
    version: "forensic-telegram-delivery-v1",
    payload: message,
    effect,
    state: {
      status: "pending",
      attemptCount: 0,
      lastAttemptAt: null,
      sentAt: null,
      lastError: null,
      messageFingerprint: payloadFingerprint(message)
    },
    claim: null
  };
}

function resultFixture(id: string): JsonObject {
  return {
    version: "forensic-result-v3",
    status: "completed",
    score: 61,
    decision: "REVIEW",
    scoreAnchor: { version: "score-anchor-v2", id: `anchor-${id}`, finalScore: 61 },
    coverage: {
      version: "forensic-coverage-v2",
      scope: "transaction_seed",
      availableTransferCount: 1,
      selectedTransferCount: 1,
      tracedTransferCount: 1
    },
    evidence: [{ id: `evidence-${id}`, kind: "exact_transfer", txHash: `sanitized-tx-${id}` }]
  };
}

function completionInput(
  id: string,
  kind: JobKind,
  resultJson = resultFixture(id),
  effect: DeliveryEffect = null
): CompletionInput {
  return {
    id,
    claimStartedAt: NOW,
    status: "completed",
    progressJson: { jobPhase: "completed", telegramDelivery: pendingDelivery(id, kind, effect) },
    resultJson,
    rawEvidenceIds: [`raw-${id}`],
    observationIds: [`observation-${id}`],
    lastError: null
  };
}

async function loadPlan3Repository(...requiredFunctions: Array<keyof Plan3Repository>): Promise<Plan3Repository> {
  const modulePath: string = repositoryModulePath;
  const repository = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  for (const name of requiredFunctions) {
    if (typeof repository[name] !== "function") throw new Error(`Plan 3 feature missing: ${name}`);
  }
  return repository as unknown as Plan3Repository;
}

async function installScenarioSchema(db: pg.Pool): Promise<void> {
  await db.query(`
    create table forensic_check_jobs (
      id text primary key,
      kind text not null check (kind in ('address_fast_check', 'address_deep_check', 'where_is_money_check', 'incoming_deposit_check')),
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
      window_start_timestamp_ms bigint not null default 0,
      window_start_timestamp timestamptz,
      window_end_timestamp_ms bigint not null default 0,
      window_end_timestamp timestamptz,
      related_hop_tx_hash text,
      candidate_tx_hash text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (job_id, wait_type, address, coverage_mode, target_timestamp_ms,
        request_kind, window_start_timestamp_ms, candidate_tx_hash)
    );
    create index forensic_job_waits_job_idx on forensic_job_waits(job_id, status);

    create table telegram_users (
      telegram_user_id text primary key,
      username text,
      locale text not null default 'ru',
      created_at timestamptz not null default now()
    );
    create table watched_wallets (
      id text primary key,
      telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
      address text not null,
      alert_mode text not null default 'realtime'
        check (alert_mode in ('realtime', 'risk_only', 'digest', 'paused')),
      digest_interval_minutes integer not null default 10,
      created_at timestamptz not null default now(),
      unique (telegram_user_id, address)
    );
    create table observed_transactions (
      tx_hash text not null,
      watched_wallet_id text not null references watched_wallets(id) on delete cascade,
      sender text not null,
      receiver text not null,
      token text not null check (token = 'USDT'),
      amount text not null,
      timestamp timestamptz not null,
      user_alert_status text not null default 'pending'
        check (user_alert_status in ('pending', 'sending', 'analyzing', 'sent', 'failed', 'skipped')),
      user_alert_attempts integer not null default 0,
      user_alert_last_error text,
      user_alert_updated_at timestamptz,
      created_at timestamptz not null default now(),
      primary key (tx_hash, watched_wallet_id)
    );

    create table wallet_approvals (
      watched_wallet_id text not null references watched_wallets(id) on delete cascade,
      token_contract text not null,
      spender_address text not null,
      amount_raw text not null default '0',
      is_unlimited boolean not null default false,
      current_allowance_raw text not null default '0',
      spender_type text not null default 'unknown',
      status text not null default 'unknown',
      last_approval_tx_hash text,
      last_approval_at timestamptz,
      risk_level text not null default 'LOW',
      risk_score integer not null default 0,
      risk_reasons jsonb not null default '[]'::jsonb,
      last_alerted_tx_hash text,
      allowance_confirmed_raw text,
      allowance_check_status text not null default 'stale'
        check (allowance_check_status in ('confirmed_active', 'confirmed_zero', 'failed', 'stale')),
      allowance_checked_at timestamptz,
      allowance_fresh_until timestamptz,
      allowance_last_attempt_at timestamptz,
      allowance_failure_code text,
      updated_at timestamptz not null default now(),
      primary key (watched_wallet_id, token_contract, spender_address)
    );
    create index idx_wallet_approvals_allowance_refresh
      on wallet_approvals(allowance_check_status, allowance_fresh_until);
  `);
}

async function withScenario(label: string, run: (db: pg.Pool) => Promise<void>): Promise<void> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const schema = `${filePrefix}${label}_${suffix}`.slice(0, 63);
  const applicationName = `${schema}_client`.slice(0, 63);
  const admin = new pg.Pool({ connectionString: databaseUrl, application_name: `${schema}_admin`.slice(0, 63) });
  let db: pg.Pool | null = null;
  let primaryFailed = false;
  let primaryError: unknown;
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 acceptance database ${String(database.rows[0]?.name)}`);
    }
    await admin.query(`create schema ${safeIdentifier(schema)}`);
    db = new pg.Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema},pg_catalog`
    });
    const path = await db.query("select current_schema() as name, current_database() as database");
    expect(path.rows[0]).toEqual({ name: schema, database: "tron_watch_plan3" });
    await installScenarioSchema(db);
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
    await admin.query(`drop schema if exists ${safeIdentifier(schema)} cascade`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
      const namespace = await admin.query("select to_regnamespace($1) as name", [schema]);
      if (namespace.rows[0]?.name !== null) throw new Error(`Plan 3 schema cleanup failed: ${schema}`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    const triggers = await admin.query(
      `select count(*)::integer as count
       from pg_trigger trigger_row
       join pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where not trigger_row.tgisinternal and namespace.nspname = $1`,
      [schema]
    );
    if (triggers.rows[0]?.count !== 0) throw new Error(`Plan 3 trigger cleanup failed: ${schema}`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
      const locks = await admin.query(
        `select count(*)::integer as count
         from pg_locks locks
         join pg_stat_activity activity on activity.pid = locks.pid
         where locks.locktype = 'advisory' and activity.application_name = $1`,
        [applicationName]
      );
      if (locks.rows[0]?.count !== 0) throw new Error(`Plan 3 advisory-lock cleanup failed: ${schema}`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryFailed && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], `Plan 3 PostgreSQL scenario and cleanup failed: ${schema}`);
  }
  if (primaryFailed) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Plan 3 PostgreSQL cleanup failed: ${schema}`);
  }
}

async function insertJob(
  db: pg.Pool,
  input: {
    id: string;
    kind?: JobKind;
    status?: "queued" | "running" | "partial" | "completed" | "failed" | "cancelled";
    progressJson?: JsonObject;
    resultJson?: JsonObject;
    subjectAddress?: string;
    chatId?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    createdAt?: Date;
  }
): Promise<void> {
  await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end, priority,
       chat_id, requested_by, progress_json, result_json, raw_evidence_ids,
       observation_ids, started_at, completed_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, 100, $7, $8, $9::jsonb, $10::jsonb,
       $11::jsonb, $12::jsonb, $13, $14, $15, $15)`,
    [
      input.id,
      input.kind ?? "where_is_money_check",
      input.subjectAddress ?? `sanitized-subject-${input.id}`,
      input.status ?? "queued",
      new Date("2026-07-01T00:00:00.000Z"),
      NOW,
      input.chatId === undefined ? `sanitized-chat-${input.id}` : input.chatId,
      `sanitized-requester-${input.id}`,
      JSON.stringify(input.progressJson ?? {}),
      JSON.stringify(input.resultJson ?? {}),
      JSON.stringify([]),
      JSON.stringify([]),
      input.startedAt ?? null,
      input.completedAt ?? null,
      input.createdAt ?? new Date("2026-07-15T11:00:00.000Z")
    ]
  );
}

async function insertWaits(
  db: pg.Pool,
  jobId: string,
  statuses: Array<"waiting" | "ready" | "terminal" | "cancelled">
): Promise<void> {
  for (const [index, status] of statuses.entries()) {
    const target = new Date(NOW.getTime() - (index + 1) * 60_000);
    await db.query(
      `insert into forensic_job_waits (
         id, job_id, wait_type, address, coverage_mode, target_timestamp_ms,
         target_timestamp, required_for, status, status_reason, request_kind,
         window_start_timestamp_ms, window_end_timestamp_ms, candidate_tx_hash
       ) values ($1, $2, 'targeted_usdt_history', $3, 'targeted', $4, $5,
         'where_hop', $6, $7, 'broad_targeted', 0, 0, '')`,
      [
        `${jobId}-wait-${index}`,
        jobId,
        `sanitized-hop-${jobId}-${index}`,
        target.getTime(),
        target,
        status,
        status === "terminal" ? "partial_provider_cap" : null
      ]
    );
  }
}

async function jobRow(db: pg.Pool, id: string): Promise<Record<string, unknown>> {
  const result = await db.query(
    `select id, kind, status, progress_json, result_json, raw_evidence_ids,
       observation_ids, last_error, completed_at from forensic_check_jobs where id = $1`,
    [id]
  );
  if (!result.rows[0]) throw new Error(`Missing seeded forensic job ${id}`);
  return result.rows[0];
}

async function insertWallet(db: pg.Pool, id: string, alertMode = "realtime"): Promise<void> {
  await db.query(
    "insert into telegram_users (telegram_user_id, username) values ($1, $2)",
    [`sanitized-user-${id}`, `user_${id}`]
  );
  await db.query(
    `insert into watched_wallets (id, telegram_user_id, address, alert_mode)
     values ($1, $2, $3, $4)`,
    [id, `sanitized-user-${id}`, `sanitized-owner-${id}`, alertMode]
  );
}

async function insertObservedAlert(
  db: pg.Pool,
  input: { watchedWalletId: string; txHash: string; status?: string }
): Promise<void> {
  await db.query(
    `insert into observed_transactions (
       tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp,
       user_alert_status, user_alert_updated_at
     ) values ($1, $2, $3, $4, 'USDT', '1000000', $5, $6, $5)`,
    [
      input.txHash,
      input.watchedWalletId,
      `sanitized-sender-${input.txHash}`,
      `sanitized-receiver-${input.txHash}`,
      new Date("2026-07-15T11:00:00.000Z"),
      input.status ?? "sending"
    ]
  );
}

async function deliveryFromRow(db: pg.Pool, id: string): Promise<DeliveryEnvelope | null> {
  const row = await jobRow(db, id);
  return (row.progress_json as JsonObject).telegramDelivery as DeliveryEnvelope | null ?? null;
}

async function auditFileOwnedPostgresArtifacts(): Promise<void> {
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const errors: unknown[] = [];
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 cleanup audit database ${String(database.rows[0]?.name)}`);
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    const schemas = await admin.query(
      "select schema_name from information_schema.schemata where schema_name like $1 order by schema_name",
      [`${filePrefix}%`]
    );
    if (schemas.rows.length > 0) throw new Error(`Plan 3 schema cleanup audit failed: ${schemas.rows.length}`);
  } catch (error) {
    errors.push(error);
  }
  try {
    const triggers = await admin.query(
      `select count(*)::integer as count
       from pg_trigger trigger_row
       join pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where not trigger_row.tgisinternal and namespace.nspname like $1`,
      [`${filePrefix}%`]
    );
    if (triggers.rows[0]?.count !== 0) throw new Error(`Plan 3 trigger cleanup audit failed: ${triggers.rows[0]?.count}`);
  } catch (error) {
    errors.push(error);
  }
  try {
    const locks = await admin.query(
      `select count(*)::integer as count
       from pg_locks lock_row
       join pg_stat_activity activity on activity.pid = lock_row.pid
       where lock_row.locktype = 'advisory' and activity.application_name like $1`,
      [`${filePrefix}%`]
    );
    if (locks.rows[0]?.count !== 0) throw new Error(`Plan 3 advisory-lock cleanup audit failed: ${locks.rows[0]?.count}`);
  } catch (error) {
    errors.push(error);
  }
  try {
    await admin.end();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "Plan 3 PostgreSQL cleanup audit failed");
}

function settleInput(
  claim: DeliveryClaim,
  settledAt: Date,
  outcome: "sent" | "retryable" | "failed",
  errorCode?: string
) {
  return {
    jobId: claim.jobId,
    messageFingerprint: claim.messageFingerprint,
    attempt: claim.claim.attempt,
    claimToken: claim.claim.token,
    settledAt,
    outcome,
    errorCode: errorCode ?? null
  };
}

async function insertAllowance(
  db: pg.Pool,
  input: {
    walletId: string;
    token?: string;
    spender?: string;
    state?: "confirmed_active" | "confirmed_zero" | "failed" | "stale";
    checkedAt?: Date | null;
    freshUntil?: Date | null;
    lastAttemptAt?: Date | null;
  }
): Promise<void> {
  const state = input.state ?? "stale";
  const confirmedRaw = state === "confirmed_active" ? "1000000" : state === "confirmed_zero" ? "0" : null;
  await db.query(
    `insert into wallet_approvals (
       watched_wallet_id, token_contract, spender_address, amount_raw,
       current_allowance_raw, is_unlimited, status, allowance_confirmed_raw,
       allowance_check_status, allowance_checked_at, allowance_fresh_until,
       allowance_last_attempt_at, allowance_failure_code
     ) values ($1, $2, $3, '0', $4, false, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.walletId,
      input.token ?? OFFICIAL_USDT,
      input.spender ?? `sanitized-spender-${input.walletId}`,
      state === "confirmed_active" ? "1000000" : "0",
      state === "confirmed_active" ? "active" : state === "confirmed_zero" ? "revoked" : "unknown",
      confirmedRaw,
      state,
      input.checkedAt ?? null,
      input.freshUntil ?? null,
      input.lastAttemptAt ?? null,
      state === "failed" ? "provider_unavailable" : null
    ]
  );
}

postgresDescribe("Plan 3 runtime delivery PostgreSQL acceptance", () => {
  it("[AC-14][POSTGRES] reconciles and claims an all-ready parent exactly once", async () => {
    await withScenario("all_ready", async (db) => {
      await insertJob(db, {
        id: "all-ready",
        progressJson: { jobPhase: "waiting_for_targeted_index", marker: "preserve" }
      });
      await insertWaits(db, "all-ready", ["ready", "ready", "ready"]);
      const repository = await loadPlan3Repository("reconcileWaitingForensicCheckJobs");

      const transitions = (await Promise.all([
        repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 }),
        repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })
      ])).flat();
      expect(transitions).toEqual([{
        parentJobId: "all-ready",
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
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)).toMatchObject({ id: "all-ready", status: "running" });
      expect(await jobRow(db, "all-ready")).toMatchObject({
        status: "running",
        progress_json: {
          jobPhase: "reading_local_index",
          marker: "preserve",
          waitReconciliation: { outcome: "resume_ready", readyCount: 3 }
        }
      });
      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([]);
    });
  });

  it("[AC-15][POSTGRES] sends ready plus terminal waits through provider_limited", async () => {
    await withScenario("mixed_terminal", async (db) => {
      await insertJob(db, {
        id: "mixed-terminal",
        kind: "incoming_deposit_check",
        progressJson: { jobPhase: "waiting_for_targeted_index" }
      });
      await insertWaits(db, "mixed-terminal", ["ready", "terminal", "ready"]);
      const repository = await loadPlan3Repository("reconcileWaitingForensicCheckJobs");

      await expect(repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: "mixed-terminal",
        readyCount: 2,
        terminalCount: 1,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_terminal",
        diagnosticCode: null
      }]);
      expect(await jobRow(db, "mixed-terminal")).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "provider_limited",
          waitReconciliation: { outcome: "resume_terminal", readyCount: 2, terminalCount: 1 }
        }
      });
      await expect(repository.claimNextForensicCheckJob(db, { kinds: ["incoming_deposit_check"] }))
        .resolves.toMatchObject({ id: "mixed-terminal", status: "running" });
    });
  });

  it("[REQ-35][REQ-38][POSTGRES] enforces waiting cancelled missing running and final parent guards", async () => {
    await withScenario("wait_guards", async (db) => {
      await insertJob(db, { id: "has-waiting", progressJson: { jobPhase: "waiting_for_targeted_index" } });
      await insertWaits(db, "has-waiting", ["ready", "waiting", "terminal"]);
      await insertJob(db, { id: "has-cancelled", progressJson: { jobPhase: "waiting_for_targeted_index" } });
      await insertWaits(db, "has-cancelled", ["ready", "cancelled"]);
      await insertJob(db, { id: "missing-waits", progressJson: { jobPhase: "waiting_for_targeted_index" } });

      for (const status of ["running", "partial", "completed", "failed", "cancelled"] as const) {
        const id = `parent-${status}`;
        await insertJob(db, { id, status, progressJson: { jobPhase: "waiting_for_targeted_index", sentinel: status } });
        await insertWaits(db, id, ["ready", "ready"]);
      }
      const repository = await loadPlan3Repository("reconcileWaitingForensicCheckJobs");
      const before = Object.fromEntries(await Promise.all(
        ["parent-running", "parent-partial", "parent-completed", "parent-failed", "parent-cancelled"]
          .map(async (id) => [id, await jobRow(db, id)] as const)
      ));

      const outcomes = await repository.reconcileWaitingForensicCheckJobs(db, { now: NOW, limit: 20 });
      expect(outcomes).toEqual(expect.arrayContaining([
        {
          parentJobId: "has-waiting",
          readyCount: 1,
          terminalCount: 1,
          cancelledCount: 0,
          waitingCount: 1,
          outcome: "unchanged",
          diagnosticCode: null
        },
        {
          parentJobId: "has-cancelled",
          readyCount: 1,
          terminalCount: 0,
          cancelledCount: 1,
          waitingCount: 0,
          outcome: "contradictory",
          diagnosticCode: "cancelled_wait_present"
        },
        {
          parentJobId: "missing-waits",
          readyCount: 0,
          terminalCount: 0,
          cancelledCount: 0,
          waitingCount: 0,
          outcome: "contradictory",
          diagnosticCode: "missing_wait_rows"
        }
      ]));
      expect(outcomes).toHaveLength(3);
      expect(await jobRow(db, "has-waiting")).toMatchObject({
        status: "queued",
        progress_json: { jobPhase: "waiting_for_targeted_index" }
      });
      expect(await jobRow(db, "has-cancelled")).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "waiting_for_targeted_index",
          waitReconciliation: { diagnosticCode: "cancelled_wait_present" }
        }
      });
      expect(await jobRow(db, "missing-waits")).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "waiting_for_targeted_index",
          waitReconciliation: { diagnosticCode: "missing_wait_rows" }
        }
      });
      for (const [id, row] of Object.entries(before)) expect(await jobRow(db, id)).toEqual(row);
      await expect(repository.claimNextForensicCheckJob(db, {
        kinds: ["where_is_money_check", "incoming_deposit_check"]
      })).resolves.toBeNull();
    });
  });

  it("[REQ-36][DELIVERY-CAS][POSTGRES] rejects completion and delivery from a non-running parent", async () => {
    await withScenario("false_completion", async (db) => {
      await insertJob(db, {
        id: "false-completion",
        status: "queued",
        progressJson: { jobPhase: "queued", sentinel: "unchanged" },
        resultJson: { existing: true }
      });
      const repository = await loadPlan3Repository("claimNextForensicTelegramDelivery");
      const before = await jobRow(db, "false-completion");

      await expect(repository.completeForensicCheckJob(
        db,
        completionInput("false-completion", "where_is_money_check")
      )).resolves.toBe(false);
      expect(await jobRow(db, "false-completion")).toEqual(before);
      await expect(repository.claimNextForensicTelegramDelivery(db, { now: NOW })).resolves.toBeNull();
    });
  });

  it("[REQ-36][DELIVERY-CAS][POSTGRES] atomically stores immutable result and pending delivery", async () => {
    await withScenario("atomic_completion", async (db) => {
      await insertJob(db, { id: "atomic-completion", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository("claimNextForensicTelegramDelivery");
      const result = resultFixture("atomic-completion");
      const input = completionInput("atomic-completion", "where_is_money_check", result);

      await expect(repository.completeForensicCheckJob(db, input)).resolves.toBe(true);
      const row = await jobRow(db, "atomic-completion");
      expect(row).toMatchObject({
        status: "completed",
        result_json: result,
        raw_evidence_ids: ["raw-atomic-completion"],
        observation_ids: ["observation-atomic-completion"]
      });
      expect((row.progress_json as JsonObject).telegramDelivery).toEqual(input.progressJson.telegramDelivery);
      expect(row.completed_at).not.toBeNull();
      await expect(repository.completeForensicCheckJob(db, {
        ...input,
        resultJson: resultFixture("must-not-overwrite")
      })).resolves.toBe(false);
      expect((await jobRow(db, "atomic-completion")).result_json).toEqual(result);
    });
  });

  it("[REQ-36][DELIVERY-CLAIM][POSTGRES] gives concurrent claimers one attempt and one token", async () => {
    await withScenario("concurrent_claim", async (db) => {
      await insertJob(db, { id: "concurrent-claim", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository("claimNextForensicTelegramDelivery");
      await repository.completeForensicCheckJob(db, completionInput("concurrent-claim", "where_is_money_check"));

      const claims = await Promise.all([
        repository.claimNextForensicTelegramDelivery(db, { now: NOW }),
        repository.claimNextForensicTelegramDelivery(db, { now: NOW })
      ]);
      const winners = claims.filter((claim): claim is DeliveryClaim => claim !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({
        jobId: "concurrent-claim",
        claim: {
          attempt: 1,
          claimedAt: NOW.toISOString(),
          leaseExpiresAt: "2026-07-15T12:00:40.000Z"
        }
      });
      expect(winners[0].claim.token.length).toBeGreaterThan(0);
      const saved = await deliveryFromRow(db, "concurrent-claim");
      expect(saved).toMatchObject({
        state: { status: "retryable", attemptCount: 1, lastAttemptAt: NOW.toISOString(), lastError: null },
        claim: { token: winners[0].claim.token, attempt: 1 }
      });
    });
  });

  it("[REQ-36][DELIVERY-CLAIM] creates claim tokens from 16 cryptographic random bytes", async () => {
    await withScenario("crypto_claim", async (db) => {
      const sizes: number[] = [];
      vi.resetModules();
      vi.doMock("node:crypto", async () => {
        const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
        return {
          ...actual,
          randomBytes: (size: number) => {
            sizes.push(size);
            return actual.randomBytes(size);
          }
        };
      });
      try {
        const repositoryModule = await import("../../src/storage/repositories") as Record<string, unknown>;
        if (typeof repositoryModule.claimNextForensicTelegramDelivery !== "function") {
          throw new Error("Plan 3 feature missing: claimNextForensicTelegramDelivery");
        }
        const repository = repositoryModule as unknown as Plan3Repository;
        for (const id of ["crypto-claim-one", "crypto-claim-two"]) {
          await insertJob(db, { id, status: "running", startedAt: NOW });
          await repository.completeForensicCheckJob(db, completionInput(id, "where_is_money_check"));
        }
        const first = await repository.claimNextForensicTelegramDelivery(db, { now: NOW });
        const second = await repository.claimNextForensicTelegramDelivery(db, { now: NOW });
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(sizes).toEqual([16, 16]);
        const tokens = [first!.claim.token, second!.claim.token];
        expect(tokens.every((token) => token.length > 0)).toBe(true);
        expect(new Set(tokens).size).toBe(2);
      } finally {
        vi.doUnmock("node:crypto");
        vi.resetModules();
      }
    });
  });

  it("[REQ-36][DELIVERY-LEASE][POSTGRES] blocks a second claim throughout the active 40 second lease", async () => {
    await withScenario("active_lease", async (db) => {
      await insertJob(db, { id: "active-lease", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository("claimNextForensicTelegramDelivery");
      await repository.completeForensicCheckJob(db, completionInput("active-lease", "where_is_money_check"));

      const first = await repository.claimNextForensicTelegramDelivery(db, { now: NOW });
      expect(first).toMatchObject({ claim: { attempt: 1, leaseExpiresAt: "2026-07-15T12:00:40.000Z" } });
      await expect(repository.claimNextForensicTelegramDelivery(
        db,
        { now: new Date("2026-07-15T12:00:39.999Z") }
      )).resolves.toBeNull();
      expect((await deliveryFromRow(db, "active-lease"))?.state.attemptCount).toBe(1);
    });
  });

  it("[REQ-36][DELIVERY-LEASE][POSTGRES] reclaims crashed attempts one through three only after expiry", async () => {
    await withScenario("crash_reclaim", async (db) => {
      await insertJob(db, { id: "crash-reclaim", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository("claimNextForensicTelegramDelivery");
      await repository.completeForensicCheckJob(db, completionInput("crash-reclaim", "where_is_money_check"));
      const tokens: string[] = [];

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claimAt = new Date(NOW.getTime() + (attempt - 1) * 40_000);
        const claim = await repository.claimNextForensicTelegramDelivery(db, { now: claimAt });
        expect(claim).toMatchObject({ jobId: "crash-reclaim", claim: { attempt } });
        tokens.push(claim!.claim.token);
        await expect(repository.claimNextForensicTelegramDelivery(db, {
          now: new Date(claimAt.getTime() + 39_999)
        })).resolves.toBeNull();
      }
      expect(new Set(tokens).size).toBe(3);
      const fourth = await repository.claimNextForensicTelegramDelivery(
        db,
        { now: new Date(NOW.getTime() + 120_000) }
      );
      expect(fourth).toMatchObject({ claim: { attempt: 4 } });
    });
  });

  it("[REQ-36][DELIVERY-LEASE][POSTGRES] terminalizes expired attempt four without payload or attempt five", async () => {
    await withScenario("attempt_four", async (db) => {
      await insertJob(db, { id: "attempt-four", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository("claimNextForensicTelegramDelivery");
      await repository.completeForensicCheckJob(db, completionInput("attempt-four", "where_is_money_check"));
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expect(repository.claimNextForensicTelegramDelivery(db, {
          now: new Date(NOW.getTime() + (attempt - 1) * 40_000)
        })).resolves.toMatchObject({ claim: { attempt } });
      }

      await expect(repository.claimNextForensicTelegramDelivery(
        db,
        { now: new Date(NOW.getTime() + 160_000) }
      )).resolves.toBeNull();
      expect(await deliveryFromRow(db, "attempt-four")).toMatchObject({
        state: {
          status: "failed",
          attemptCount: 4,
          sentAt: null,
          lastError: "telegram_attempts_exhausted"
        },
        claim: null
      });
      await expect(repository.claimNextForensicTelegramDelivery(
        db,
        { now: new Date(NOW.getTime() + 24 * 60 * 60_000) }
      )).resolves.toBeNull();
    });
  });

  it("[REQ-36][DELIVERY-LEASE][POSTGRES] ignores settlement from a superseded token", async () => {
    await withScenario("superseded_token", async (db) => {
      await insertJob(db, { id: "superseded-token", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository(
        "claimNextForensicTelegramDelivery",
        "settleForensicTelegramDelivery"
      );
      await repository.completeForensicCheckJob(db, completionInput("superseded-token", "where_is_money_check"));
      const first = (await repository.claimNextForensicTelegramDelivery(db, { now: NOW }))!;
      const secondAt = new Date(NOW.getTime() + 40_000);
      const second = (await repository.claimNextForensicTelegramDelivery(db, { now: secondAt }))!;

      await expect(repository.settleForensicTelegramDelivery(
        db,
        settleInput(first, new Date(secondAt.getTime() + 1), "sent")
      )).resolves.toBe(false);
      expect(await deliveryFromRow(db, "superseded-token")).toMatchObject({
        state: { status: "retryable", attemptCount: 2, sentAt: null },
        claim: { token: second.claim.token, attempt: 2 }
      });
    });
  });

  it("[AC-16][REQ-36][POSTGRES] enforces retry backoff 30 120 600 and the sent fingerprint fence", async () => {
    await withScenario("backoff_sent", async (db) => {
      await insertJob(db, { id: "backoff-sent", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository(
        "claimNextForensicTelegramDelivery",
        "settleForensicTelegramDelivery"
      );
      await repository.completeForensicCheckJob(db, completionInput("backoff-sent", "where_is_money_check"));
      const backoffs = [30_000, 120_000, 600_000];
      let claimAt = NOW;
      let claim: DeliveryClaim | null = null;

      for (const [index, delay] of backoffs.entries()) {
        claim = await repository.claimNextForensicTelegramDelivery(db, { now: claimAt });
        expect(claim).toMatchObject({ claim: { attempt: index + 1 } });
        await expect(repository.settleForensicTelegramDelivery(
          db,
          settleInput(claim!, claimAt, "retryable", "telegram_network_error")
        )).resolves.toBe(true);
        await expect(repository.claimNextForensicTelegramDelivery(db, {
          now: new Date(claimAt.getTime() + delay - 1)
        })).resolves.toBeNull();
        claimAt = new Date(claimAt.getTime() + delay);
      }

      claim = await repository.claimNextForensicTelegramDelivery(db, { now: claimAt });
      expect(claim).toMatchObject({ claim: { attempt: 4 } });
      const fingerprint = claim!.messageFingerprint;
      await expect(repository.settleForensicTelegramDelivery(
        db,
        settleInput(claim!, claimAt, "sent")
      )).resolves.toBe(true);
      expect(await deliveryFromRow(db, "backoff-sent")).toMatchObject({
        state: {
          status: "sent",
          attemptCount: 4,
          sentAt: claimAt.toISOString(),
          lastError: null,
          messageFingerprint: fingerprint
        },
        claim: null
      });
      await expect(repository.claimNextForensicTelegramDelivery(
        db,
        { now: new Date(claimAt.getTime() + 24 * 60 * 60_000) }
      )).resolves.toBeNull();
      expect((await deliveryFromRow(db, "backoff-sent"))?.state.messageFingerprint).toBe(fingerprint);
    });
  });

  it("[REQ-36][DELIVERY-EFFECT][POSTGRES] atomically settles Incoming success and permanent failure", async () => {
    await withScenario("incoming_effect", async (db) => {
      const repository = await loadPlan3Repository(
        "claimNextForensicTelegramDelivery",
        "settleForensicTelegramDelivery"
      );
      for (const variant of ["success", "permanent"] as const) {
        const walletId = `incoming-wallet-${variant}`;
        const txHash = `incoming-tx-${variant}`;
        const jobId = `incoming-job-${variant}`;
        await insertWallet(db, walletId);
        await insertObservedAlert(db, { watchedWalletId: walletId, txHash, status: "sending" });
        await insertJob(db, {
          id: jobId,
          kind: "incoming_deposit_check",
          status: "running",
          startedAt: NOW,
          progressJson: { watchedWalletId: walletId, depositTxHash: txHash }
        });
        const effect: DeliveryEffect = { kind: "incoming_user_alert", watchedWalletId: walletId, incomingTxHash: txHash };
        await repository.completeForensicCheckJob(
          db,
          completionInput(jobId, "incoming_deposit_check", resultFixture(jobId), effect)
        );
      }

      const successClaim = (await repository.claimNextForensicTelegramDelivery(db, { now: NOW }))!;
      expect(successClaim.jobId).toBe("incoming-job-success");
      await expect(repository.settleForensicTelegramDelivery(
        db,
        settleInput(successClaim, NOW, "sent")
      )).resolves.toBe(true);
      expect(await deliveryFromRow(db, "incoming-job-success")).toMatchObject({
        state: { status: "sent", sentAt: NOW.toISOString(), lastError: null },
        claim: null
      });
      await expect(db.query(
        "select user_alert_status from observed_transactions where watched_wallet_id = $1 and tx_hash = $2",
        ["incoming-wallet-success", "incoming-tx-success"]
      )).resolves.toMatchObject({ rows: [{ user_alert_status: "sent" }] });

      const failedClaim = (await repository.claimNextForensicTelegramDelivery(db, { now: NOW }))!;
      expect(failedClaim.jobId).toBe("incoming-job-permanent");
      await expect(repository.settleForensicTelegramDelivery(
        db,
        settleInput(failedClaim, NOW, "failed", "telegram_chat_forbidden")
      )).resolves.toBe(true);
      expect(await deliveryFromRow(db, "incoming-job-permanent")).toMatchObject({
        state: { status: "failed", sentAt: null, lastError: "telegram_chat_forbidden" },
        claim: null
      });
      await expect(db.query(
        `select user_alert_status, user_alert_last_error
         from observed_transactions where watched_wallet_id = $1 and tx_hash = $2`,
        ["incoming-wallet-permanent", "incoming-tx-permanent"]
      )).resolves.toMatchObject({
        rows: [{ user_alert_status: "failed", user_alert_last_error: "telegram_chat_forbidden" }]
      });
    });
  });

  it("[REQ-36][DELIVERY-EFFECT][POSTGRES] rolls back both Incoming writes when the alert update trigger fails", async () => {
    await withScenario("incoming_rollback", async (db) => {
      const walletId = "rollback-wallet";
      const txHash = "rollback-tx";
      const jobId = "rollback-job";
      await insertWallet(db, walletId);
      await insertObservedAlert(db, { watchedWalletId: walletId, txHash, status: "sending" });
      await insertJob(db, {
        id: jobId,
        kind: "incoming_deposit_check",
        status: "running",
        startedAt: NOW,
        progressJson: { watchedWalletId: walletId, depositTxHash: txHash }
      });
      const repository = await loadPlan3Repository(
        "claimNextForensicTelegramDelivery",
        "settleForensicTelegramDelivery"
      );
      await repository.completeForensicCheckJob(db, completionInput(
        jobId,
        "incoming_deposit_check",
        resultFixture(jobId),
        { kind: "incoming_user_alert", watchedWalletId: walletId, incomingTxHash: txHash }
      ));
      const claim = (await repository.claimNextForensicTelegramDelivery(db, { now: NOW }))!;
      const beforeDelivery = await deliveryFromRow(db, jobId);
      const trigger = "plan3_fail_incoming_update";
      const triggerFunction = "plan3_raise_incoming_update";

      await db.query(`
        create function ${safeIdentifier(triggerFunction)}() returns trigger language plpgsql as $$
        begin
          raise exception 'synthetic_plan3_incoming_update_failure';
        end;
        $$;
        create trigger ${safeIdentifier(trigger)}
          before update on observed_transactions
          for each row execute function ${safeIdentifier(triggerFunction)}();
      `);
      try {
        await expect(repository.settleForensicTelegramDelivery(
          db,
          settleInput(claim, NOW, "sent")
        )).rejects.toThrow(/synthetic_plan3_incoming_update_failure/);
        expect(await deliveryFromRow(db, jobId)).toEqual(beforeDelivery);
        await expect(db.query(
          `select user_alert_status, user_alert_last_error
           from observed_transactions where watched_wallet_id = $1 and tx_hash = $2`,
          [walletId, txHash]
        )).resolves.toMatchObject({
          rows: [{ user_alert_status: "sending", user_alert_last_error: null }]
        });
      } finally {
        await db.query(`drop trigger if exists ${safeIdentifier(trigger)} on observed_transactions`);
        await db.query(`drop function if exists ${safeIdentifier(triggerFunction)}()`);
      }
      const triggerRows = await db.query(
        `select count(*)::integer as count from pg_trigger where tgname = $1 and not tgisinternal`,
        [trigger]
      );
      expect(triggerRows.rows[0]?.count).toBe(0);
    });
  });

  it("[REQ-36][DELIVERY-EFFECT] does not re-claim an Incoming alert owned by a versioned delivery", async () => {
    await withScenario("legacy_exclusion", async (db) => {
      const repository = await loadPlan3Repository("claimUserAlertsForRetry");
      const ownedDeliveries = [
        { id: "pending", status: "pending", activeClaim: false, settledRetry: false },
        { id: "retryable-active", status: "retryable", activeClaim: true, settledRetry: false },
        { id: "retryable-settled", status: "retryable", activeClaim: false, settledRetry: true },
        { id: "sent", status: "sent", activeClaim: false, settledRetry: false },
        { id: "failed", status: "failed", activeClaim: false, settledRetry: false }
      ] as const;
      for (const owned of ownedDeliveries) {
        const walletId = `owned-${owned.id}`;
        const txHash = `owned-tx-${owned.id}`;
        const jobId = `owned-job-${owned.id}`;
        await insertWallet(db, walletId);
        await insertObservedAlert(db, { watchedWalletId: walletId, txHash, status: "failed" });
        const envelope = pendingDelivery(jobId, "incoming_deposit_check", {
          kind: "incoming_user_alert",
          watchedWalletId: walletId,
          incomingTxHash: txHash
        });
        envelope.state.status = owned.status;
        envelope.state.attemptCount = owned.status === "pending" ? 0 : 1;
        envelope.state.lastAttemptAt = owned.status === "pending" ? null : NOW.toISOString();
        envelope.state.sentAt = owned.status === "sent" ? NOW.toISOString() : null;
        envelope.state.lastError = owned.settledRetry
          ? "telegram_network_error"
          : owned.status === "failed" ? "telegram_chat_forbidden" : null;
        if (owned.activeClaim) {
          envelope.claim = {
            token: "opaque-active-legacy-claim",
            attempt: 1,
            claimedAt: NOW.toISOString(),
            leaseExpiresAt: new Date(NOW.getTime() + 40_000).toISOString()
          };
        }
        await insertJob(db, {
          id: jobId,
          kind: "incoming_deposit_check",
          status: "completed",
          progressJson: {
            jobPhase: "completed",
            watchedWalletId: walletId,
            depositTxHash: txHash,
            telegramDelivery: envelope
          },
          resultJson: resultFixture(jobId),
          completedAt: NOW
        });
      }
      await insertWallet(db, "unrelated-wallet");
      await insertObservedAlert(db, {
        watchedWalletId: "unrelated-wallet",
        txHash: "unrelated-failed-tx",
        status: "failed"
      });

      const claimed = await repository.claimUserAlertsForRetry(db, {
        limit: 10,
        staleSendingBefore: new Date("2026-07-15T11:30:00.000Z")
      });
      expect(claimed).toEqual([
        expect.objectContaining({ txHash: "unrelated-failed-tx", watchedWalletId: "unrelated-wallet" })
      ]);
      const states = await db.query(
        "select tx_hash, user_alert_status from observed_transactions order by tx_hash"
      );
      expect(states.rows).toEqual(expect.arrayContaining([
        { tx_hash: "owned-tx-pending", user_alert_status: "failed" },
        { tx_hash: "owned-tx-retryable-active", user_alert_status: "failed" },
        { tx_hash: "owned-tx-retryable-settled", user_alert_status: "failed" },
        { tx_hash: "owned-tx-sent", user_alert_status: "failed" },
        { tx_hash: "owned-tx-failed", user_alert_status: "failed" },
        { tx_hash: "unrelated-failed-tx", user_alert_status: "sending" }
      ]));
    });
  });

  it("[REQ-03][REQ-36][DELIVERY-IMMUTABLE][POSTGRES] preserves result status score coverage and evidence across delivery state changes", async () => {
    await withScenario("delivery_immutable", async (db) => {
      const jobId = "delivery-immutable";
      const originalResult = resultFixture(jobId);
      await insertJob(db, { id: jobId, kind: "incoming_deposit_check", status: "running", startedAt: NOW });
      const repository = await loadPlan3Repository(
        "claimNextForensicTelegramDelivery",
        "settleForensicTelegramDelivery"
      );
      await repository.completeForensicCheckJob(
        db,
        completionInput(jobId, "incoming_deposit_check", originalResult)
      );
      const baseline = await jobRow(db, jobId);
      const first = (await repository.claimNextForensicTelegramDelivery(db, { now: NOW }))!;
      await repository.settleForensicTelegramDelivery(
        db,
        settleInput(first, NOW, "retryable", "telegram_server_error")
      );
      const secondAt = new Date(NOW.getTime() + 30_000);
      const second = (await repository.claimNextForensicTelegramDelivery(db, { now: secondAt }))!;
      await repository.settleForensicTelegramDelivery(db, settleInput(second, secondAt, "sent"));
      const after = await jobRow(db, jobId);

      expect(after.status).toBe("completed");
      expect(after.result_json).toEqual(baseline.result_json);
      expect((after.result_json as JsonObject).score).toBe(61);
      expect((after.result_json as JsonObject).coverage).toEqual((baseline.result_json as JsonObject).coverage);
      expect((after.result_json as JsonObject).evidence).toEqual((baseline.result_json as JsonObject).evidence);
      expect(after.raw_evidence_ids).toEqual(baseline.raw_evidence_ids);
      expect(after.observation_ids).toEqual(baseline.observation_ids);
    });
  });

  it("[REQ-03][REQ-36][RESULT-IMMUTABLE][POSTGRES] saves Deep second-layer context only in versioned progress", async () => {
    await withScenario("deep_context", async (db) => {
      const jobId = "deep-context";
      const baseResult = resultFixture(jobId);
      await insertJob(db, {
        id: jobId,
        kind: "address_deep_check",
        status: "running",
        subjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress,
        startedAt: NOW
      });
      const repository = await loadPlan3Repository(
        "claimNextForensicTelegramDelivery",
        "saveCompletedDeepSecondLayerContext"
      );
      await repository.completeForensicCheckJob(db, completionInput(jobId, "address_deep_check", baseResult));
      const before = await jobRow(db, jobId);
      const beforeProgress = structuredClone(before.progress_json as JsonObject);
      const delivery = (beforeProgress.telegramDelivery as DeliveryEnvelope);
      const baseResultFingerprint = createHash("sha256").update(canonicalJson(baseResult)).digest("hex");
      const context: DeepSecondLayerContextV1 = {
        version: "deep-second-layer-context-v1",
        baseResultFingerprint,
        refreshedAt: "2026-07-15T12:05:00.000Z",
        profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
      };

      await expect(repository.saveCompletedDeepSecondLayerContext(db, { id: jobId, context })).resolves.toBe(true);
      const after = await jobRow(db, jobId);
      const afterProgress = structuredClone(after.progress_json as JsonObject);
      expect(after.result_json).toEqual(before.result_json);
      expect((afterProgress.telegramDelivery as DeliveryEnvelope).state.messageFingerprint)
        .toBe(delivery.state.messageFingerprint);
      expect(afterProgress.deepSecondLayerContext).toEqual(context);
      delete beforeProgress.deepSecondLayerContext;
      delete afterProgress.deepSecondLayerContext;
      expect(afterProgress).toEqual(beforeProgress);
      expect(after.status).toBe("completed");
    });
  });

  it("[REQ-36][DELIVERY-RECOVERY][POSTGRES] stores exact stale intent and prepares it idempotently without backfill or direct send", async () => {
    await withScenario("stale_intent", async (db) => {
      const staleId = "stale-recovery";
      const historicalId = "historical-final";
      await insertJob(db, {
        id: staleId,
        status: "running",
        progressJson: {
          jobPhase: "notification_delivery",
          jobHeartbeatAt: "2026-07-15T10:00:00.000Z",
          retryCount: 4,
          preserved: "stale-context"
        },
        startedAt: new Date("2026-07-15T10:00:00.000Z")
      });
      await insertJob(db, {
        id: historicalId,
        status: "failed",
        progressJson: { jobPhase: "failed_after_stale_recovery", historical: true },
        resultJson: resultFixture(historicalId),
        completedAt: new Date("2026-07-14T12:00:00.000Z")
      });
      const repository = await loadPlan3Repository(
        "listDueRecoveredForensicDeliveryIntents",
        "attachRecoveredForensicTelegramDelivery"
      );

      const recovered = await repository.recoverStaleForensicCheckJobs(db, {
        staleRunningBefore: new Date("2026-07-15T11:00:00.000Z"),
        maxRetries: 0,
        limit: 10,
        recoveredAt: NOW
      });
      expect(recovered.requeued).toEqual([]);
      expect(recovered.failed).toHaveLength(1);
      const failed = await jobRow(db, staleId);
      const intent = (failed.progress_json as JsonObject).telegramDeliveryIntent as JsonObject;
      expect(failed).toMatchObject({ status: "failed", result_json: {} });
      expect(intent).toEqual({
        version: "recovered-forensic-delivery-intent-v1",
        kind: "stale_failure",
        createdAt: NOW.toISOString(),
        reasonCode: "stale_running_retry_exhausted",
        preparationStatus: "pending",
        preparationAttemptCount: 0,
        lastPreparationAttemptAt: null,
        nextPreparationAttemptAt: null,
        lastPreparationError: null
      });
      expect((failed.progress_json as JsonObject).telegramDelivery).toBeUndefined();

      const due = await repository.listDueRecoveredForensicDeliveryIntents(db, { now: NOW, limit: 10 });
      expect(due).toEqual([{ jobId: staleId, intent }]);
      const delivery = pendingDelivery(staleId, "where_is_money_check");
      const prepare = {
        jobId: staleId,
        intentCreatedAt: NOW.toISOString(),
        expectedPreparationAttemptCount: 0,
        delivery
      };
      await expect(repository.attachRecoveredForensicTelegramDelivery(db, prepare)).resolves.toBe(true);
      await expect(repository.attachRecoveredForensicTelegramDelivery(db, prepare)).resolves.toBe(false);
      const prepared = await jobRow(db, staleId);
      expect((prepared.progress_json as JsonObject)).not.toHaveProperty("telegramDeliveryIntent");
      expect((prepared.progress_json as JsonObject).telegramDelivery).toEqual(delivery);
      expect(await deliveryFromRow(db, staleId)).toEqual(delivery);
      await expect(repository.listDueRecoveredForensicDeliveryIntents(db, { now: NOW, limit: 10 }))
        .resolves.toEqual([]);

      await expect(repository.attachRecoveredForensicTelegramDelivery(db, {
        jobId: historicalId,
        intentCreatedAt: "2026-07-14T12:00:00.000Z",
        expectedPreparationAttemptCount: 0,
        delivery: pendingDelivery(historicalId, "where_is_money_check")
      })).resolves.toBe(false);
      expect((await jobRow(db, historicalId)).progress_json).toEqual({
        jobPhase: "failed_after_stale_recovery",
        historical: true
      });
    });
  });

  it("[REQ-36][DELIVERY-RECOVERY][POSTGRES] bounds stale preparation backoff terminal state and stale settlement", async () => {
    await withScenario("stale_backoff", async (db) => {
      const jobId = "stale-backoff";
      const intentCreatedAt = NOW.toISOString();
      await insertJob(db, {
        id: jobId,
        status: "failed",
        progressJson: {
          jobPhase: "failed_after_stale_recovery",
          telegramDeliveryIntent: {
            version: "recovered-forensic-delivery-intent-v1",
            kind: "stale_failure",
            createdAt: intentCreatedAt,
            reasonCode: "stale_running_retry_exhausted",
            preparationStatus: "pending",
            preparationAttemptCount: 0,
            lastPreparationAttemptAt: null,
            nextPreparationAttemptAt: null,
            lastPreparationError: null
          }
        },
        completedAt: NOW
      });
      const repository = await loadPlan3Repository(
        "listDueRecoveredForensicDeliveryIntents",
        "settleRecoveredForensicDeliveryIntentPreparation",
        "claimNextForensicTelegramDelivery"
      );
      const delays = [30_000, 120_000, 600_000];
      let attemptAt = NOW;

      for (let expectedCount = 0; expectedCount < 4; expectedCount += 1) {
        const due = await repository.listDueRecoveredForensicDeliveryIntents(db, { now: attemptAt, limit: 10 });
        expect(due).toHaveLength(1);
        const errorCode = expectedCount % 2 === 0
          ? "stale_intent_context_unavailable"
          : "stale_intent_payload_build_failed";
        await expect(repository.settleRecoveredForensicDeliveryIntentPreparation(db, {
          jobId,
          intentCreatedAt,
          expectedPreparationAttemptCount: expectedCount,
          attemptedAt: attemptAt,
          errorCode
        })).resolves.toBe(true);

        const intent = ((await jobRow(db, jobId)).progress_json as JsonObject).telegramDeliveryIntent as JsonObject;
        expect(intent.preparationAttemptCount).toBe(expectedCount + 1);
        expect(intent.lastPreparationAttemptAt).toBe(attemptAt.toISOString());
        if (expectedCount < 3) {
          const next = new Date(attemptAt.getTime() + delays[expectedCount]);
          expect(intent).toMatchObject({
            preparationStatus: "retryable",
            nextPreparationAttemptAt: next.toISOString(),
            lastPreparationError: errorCode
          });
          await expect(repository.listDueRecoveredForensicDeliveryIntents(db, {
            now: new Date(next.getTime() - 1),
            limit: 10
          })).resolves.toEqual([]);
          if (expectedCount === 0) {
            await expect(repository.settleRecoveredForensicDeliveryIntentPreparation(db, {
              jobId,
              intentCreatedAt,
              expectedPreparationAttemptCount: 0,
              attemptedAt: new Date(attemptAt.getTime() + 1),
              errorCode: "stale_intent_unknown_retryable"
            })).resolves.toBe(false);
            const unchanged = ((await jobRow(db, jobId)).progress_json as JsonObject).telegramDeliveryIntent as JsonObject;
            expect(unchanged.preparationAttemptCount).toBe(1);
          }
          attemptAt = next;
        } else {
          expect(intent).toMatchObject({
            preparationStatus: "failed",
            nextPreparationAttemptAt: null,
            lastPreparationError: "stale_intent_preparation_attempts_exhausted"
          });
        }
      }

      await expect(repository.listDueRecoveredForensicDeliveryIntents(db, {
        now: new Date("2026-07-16T12:00:00.000Z"),
        limit: 10
      })).resolves.toEqual([]);
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: new Date("2026-07-16T12:00:00.000Z")
      })).resolves.toBeNull();
      expect((await jobRow(db, jobId)).progress_json).not.toHaveProperty("telegramDelivery");
    });
  });

  it("[REQ-19][RUNTIME-REFRESH][POSTGRES] selects only five official active stale or expired targets past the 15 minute floor", async () => {
    await withScenario("allowance_due", async (db) => {
      const eligibleIds = Array.from({ length: 6 }, (_, index) => `due-${index + 1}`);
      for (const [index, walletId] of eligibleIds.entries()) {
        await insertWallet(db, walletId, index % 2 === 0 ? "realtime" : "digest");
        if (index < 2) {
          await insertAllowance(db, { walletId, state: "stale" });
        } else if (index < 4) {
          await insertAllowance(db, {
            walletId,
            state: "failed",
            lastAttemptAt: new Date(NOW.getTime() - (20 + index) * 60_000)
          });
        } else {
          const checkedAt = new Date(NOW.getTime() - (40 + index) * 60_000);
          await insertAllowance(db, {
            walletId,
            state: "confirmed_active",
            checkedAt,
            freshUntil: new Date(checkedAt.getTime() + 15 * 60_000),
            lastAttemptAt: checkedAt
          });
        }
      }

      await insertWallet(db, "wrong-token");
      await insertAllowance(db, { walletId: "wrong-token", token: "sanitized-non-usdt", state: "stale" });
      await insertWallet(db, "paused-wallet", "paused");
      await insertAllowance(db, { walletId: "paused-wallet", state: "stale" });
      await insertWallet(db, "fresh-wallet");
      const freshChecked = new Date(NOW.getTime() - 5 * 60_000);
      await insertAllowance(db, {
        walletId: "fresh-wallet",
        state: "confirmed_active",
        checkedAt: freshChecked,
        freshUntil: new Date(freshChecked.getTime() + 15 * 60_000),
        lastAttemptAt: freshChecked
      });
      await insertWallet(db, "recent-failure");
      await insertAllowance(db, {
        walletId: "recent-failure",
        state: "failed",
        lastAttemptAt: new Date(NOW.getTime() - 14 * 60_000)
      });
      const repository = await loadPlan3Repository("listDueApprovalAllowanceRefreshTargets");

      const targets = await repository.listDueApprovalAllowanceRefreshTargets(db, { now: NOW, limit: 99 });
      expect(targets).toHaveLength(5);
      expect(new Set(targets.map((target) => target.watchedWalletId)).size).toBe(5);
      expect(targets.every((target) => eligibleIds.includes(target.watchedWalletId))).toBe(true);
      expect(targets.every((target) => target.tokenContract === OFFICIAL_USDT)).toBe(true);
      expect(targets.every((target) => target.ownerAddress === `sanitized-owner-${target.watchedWalletId}`)).toBe(true);
      expect(targets.map((target) => target.watchedWalletId)).not.toEqual(expect.arrayContaining([
        "wrong-token",
        "paused-wallet",
        "fresh-wallet",
        "recent-failure"
      ]));
    });
  });

  it("[REQ-19][RUNTIME-REFRESH][POSTGRES] serializes one allowance target with a session advisory lock", async () => {
    await withScenario("allowance_lock", async (db) => {
      const walletId = "locked-wallet";
      const spenderAddress = "sanitized-locked-spender";
      await insertWallet(db, walletId);
      await insertAllowance(db, { walletId, spender: spenderAddress, state: "stale" });
      const repository = await loadPlan3Repository("tryAcquireApprovalAllowanceRefreshLock");
      const input = {
        watchedWalletId: walletId,
        tokenContract: OFFICIAL_USDT,
        spenderAddress,
        now: NOW
      };
      let first: Awaited<ReturnType<Plan3Repository["tryAcquireApprovalAllowanceRefreshLock"]>> = null;
      let third: Awaited<ReturnType<Plan3Repository["tryAcquireApprovalAllowanceRefreshLock"]>> = null;
      try {
        first = await repository.tryAcquireApprovalAllowanceRefreshLock(db, input);
        expect(first).not.toBeNull();
        await expect(repository.tryAcquireApprovalAllowanceRefreshLock(db, input)).resolves.toBeNull();
        await first!.release();
        first = null;
        third = await repository.tryAcquireApprovalAllowanceRefreshLock(db, input);
        expect(third).not.toBeNull();
      } finally {
        const releases = [first, third]
          .filter((lock): lock is NonNullable<typeof lock> => lock !== null)
          .map((lock) => Promise.resolve().then(() => lock.release()));
        const settled = await Promise.allSettled(releases);
        const releaseErrors = settled
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (releaseErrors.length > 0) {
          throw new AggregateError(releaseErrors, "Plan 3 PostgreSQL advisory-lock release failed");
        }
      }
      const locks = await db.query(
        "select count(*)::integer as count from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()"
      );
      expect(locks.rows[0]?.count).toBe(0);
    });
  });

  it("[PLAN3][POSTGRES][CLEANUP] leaves no file-owned schema trigger or advisory lock", async () => {
    await auditFileOwnedPostgresArtifacts();
  });
});

afterAll(async () => {
  if (!required) return;
  await auditFileOwnedPostgresArtifacts();
});
