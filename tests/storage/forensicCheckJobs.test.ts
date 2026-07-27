import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  claimNextForensicCheckJob,
  claimUserAlertsForRetry,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob,
  getLatestForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddressAnyStatus,
  getLatestWhereIsMoneyCheckJobForAddress,
  getCoveringTronAddressUsdtIndexState,
  getForensicJobTargetedHistoryProgress,
  markWaitingForensicJobsReadyAfterTargetedIndex,
  listAdminForensicCheckJobs,
  listCompletedDeepCheckJobsWithPendingSecondLayer,
  markStrictProvenanceJobReadyAfterIndex,
  patchStrictBenchmarkProgress,
  patchWaitingForensicJobsTargetedIndexProgress,
  recoverStaleForensicCheckJobs,
  releaseForensicCheckJobToWaiting,
  queueClaimedTronAddressUsdtIndexState,
  recordClaimedObservedTransactionRisk,
  runClaimedForensicJobTransaction,
  saveClaimedRiskEvaluationEvidence,
  upsertClaimedAddressLabelAssertion,
  updateForensicCheckJobProgress,
  upsertIndexedTronUsdtTransfersWithClient,
  saveCompletedDeepSecondLayerContext,
  saveAddressFastCheckJob,
  upsertForensicJobWait
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import { buildForensicRuntimeContractProjection } from "../../src/forensics/forensicJobProgress";
import {
  createPendingForensicTelegramDelivery,
  fingerprintCanonicalJson
} from "../../src/forensics/telegramDelivery";
import {
  CANONICAL_DEEP_SECOND_LAYER_PROFILE,
  CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE
} from "../fixtures/runtime/remediationRuntimeCases";
import type {
  ForensicTelegramDeliveryV1,
  RecoveredForensicDeliveryIntentPreparationErrorCode,
  RecoveredForensicDeliveryIntentV1,
  TelegramDeliveryErrorCode,
  WaitReconciliationResultV1
} from "../../src/types";

type WaitReconciler = (
  db: Db,
  input: { now: Date; limit: number }
) => Promise<WaitReconciliationResultV1[]>;

type DeliveryClaim = {
  jobId: string;
  kind: "where_is_money_check" | "address_deep_check" | "incoming_deposit_check";
  payload: ForensicTelegramDeliveryV1["payload"];
  effect: ForensicTelegramDeliveryV1["effect"];
  messageFingerprint: string;
  claim: NonNullable<ForensicTelegramDeliveryV1["claim"]>;
};

type DeliveryRepository = {
  claimNextForensicTelegramDelivery: (
    db: Db,
    input: { now: Date }
  ) => Promise<DeliveryClaim | null>;
  settleForensicTelegramDelivery: (
    db: Db,
    input: {
      jobId: string;
      messageFingerprint: string;
      attempt: number;
      claimToken: string;
      settledAt: Date;
      outcome: "sent" | "retryable" | "failed";
      errorCode?: TelegramDeliveryErrorCode | null;
    }
  ) => Promise<boolean>;
  listDueRecoveredForensicDeliveryIntents: (
    db: Db,
    input: { now: Date; limit: number }
  ) => Promise<Array<{ jobId: string; intent: RecoveredForensicDeliveryIntentV1 }>>;
  attachRecoveredForensicTelegramDelivery: (
    db: Db,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      delivery: ForensicTelegramDeliveryV1;
    }
  ) => Promise<boolean>;
  settleRecoveredForensicDeliveryIntentPreparation: (
    db: Db,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      attemptedAt: Date;
      errorCode: Exclude<
        RecoveredForensicDeliveryIntentPreparationErrorCode,
        "stale_intent_preparation_attempts_exhausted"
      >;
    }
  ) => Promise<boolean>;
};

async function loadWaitReconciler(): Promise<WaitReconciler> {
  const repositories = await import("../../src/storage/repositories") as Record<string, unknown>;
  if (typeof repositories.reconcileWaitingForensicCheckJobs !== "function") {
    throw new Error("Plan 3 feature missing: reconcileWaitingForensicCheckJobs");
  }
  return repositories.reconcileWaitingForensicCheckJobs as WaitReconciler;
}

async function loadDeliveryRepository(): Promise<DeliveryRepository> {
  const repositories = await import("../../src/storage/repositories") as Record<string, unknown>;
  const required = [
    "claimNextForensicTelegramDelivery",
    "settleForensicTelegramDelivery",
    "listDueRecoveredForensicDeliveryIntents",
    "attachRecoveredForensicTelegramDelivery",
    "settleRecoveredForensicDeliveryIntentPreparation"
  ] as const;
  for (const name of required) {
    if (typeof repositories[name] !== "function") {
      throw new Error(`Plan 3 feature missing: ${name}`);
    }
  }
  return repositories as unknown as DeliveryRepository;
}

function forensicJobRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subject_address: "TSubject111111111111111111111111111111",
    status: "running",
    window_start: new Date("2026-04-24T00:00:00.000Z"),
    window_end: new Date("2026-05-24T00:00:00.000Z"),
    priority: 100,
    chat_id: "42",
    message_id: "10",
    requested_by: "42",
    progress_json: {},
    result_json: {},
    raw_evidence_ids: [],
    observation_ids: [],
    last_error: null,
    created_at: new Date("2026-05-24T00:00:00.000Z"),
    updated_at: new Date("2026-05-24T00:00:00.000Z"),
    started_at: null,
    completed_at: null,
    ...overrides
  };
}

function readProgress(row: Record<string, unknown>): Record<string, unknown> {
  const value = row.progress_json;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function retryCount(progress: Record<string, unknown>): number {
  const value = progress.retryCount;
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return /^[0-9]+$/.test(text) && text.length <= 9 ? Number(text) : 0;
}

function jobPhase(progress: Record<string, unknown>): string | null {
  return typeof progress.jobPhase === "string" && progress.jobPhase.length > 0 ? progress.jobPhase : null;
}

function hasIsoHeartbeat(progress: Record<string, unknown>): boolean {
  return typeof progress.jobHeartbeatAt === "string" &&
    /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/.test(progress.jobHeartbeatAt);
}

function dateField(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function assertRecoverySql(sql: string): void {
  expect(sql).toContain("for update of job skip locked");
  expect(sql).toContain("job.kind in ('where_is_money_check', 'address_deep_check')");
  expect(sql).toContain("job.kind = 'incoming_deposit_check'");
  expect(sql).toContain("runtime.job_phase in ('incoming_deposit_trace', 'risk_recording')");
  expect(sql).toContain("runtime.retry_count < 1");
  expect(sql).toContain("runtime.has_iso_heartbeat");
  expect(sql).toContain("coalesce(job.started_at, job.created_at) < $1");
  expect(sql).toContain("~ '^[0-9]+$'");
  expect(sql).toContain("'jobHeartbeatAt', $5::text");
  expect(sql).toContain("'lastRecoveredAt', $5::text");
  expect(sql).toContain("completed_at = case when decisions.next_status = 'failed' then $5::timestamptz else null end");
  expect(sql).toContain("updated_at = $5::timestamptz");
  expect(sql).toContain("started_at = job.started_at");
  expect(sql).not.toContain("started_at = case when decisions.next_status = 'queued' then null");
  expect(sql).not.toContain("jobHeartbeatAt')::timestamptz");
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

function simulateRecoveredRows(rows: Record<string, unknown>[], params: unknown[]): Record<string, unknown>[] {
  const staleRunningBefore = params[0] as Date;
  const staleRunningBeforeIso = params[1] as string;
  const maxRetries = params[2] as number;
  const limit = params[3] as number;
  const recoveredAtIso = params[4] as string;
  const recoveredAt = new Date(recoveredAtIso);
  const preDeliveryPhases = new Set(["incoming_deposit_trace", "risk_recording"]);
  const deliverySensitivePhases = new Set(["notification_delivery", "completing"]);

  return rows
    .filter((row) => {
      if (row.status !== "running") return false;
      const progress = readProgress(row);
      if (hasIsoHeartbeat(progress)) {
        return (progress.jobHeartbeatAt as string) < staleRunningBeforeIso;
      }
      const fallback = dateField(row.started_at) ?? dateField(row.created_at);
      return fallback ? fallback < staleRunningBefore : false;
    })
    .slice(0, limit)
    .map((row) => {
      const progress = readProgress(row);
      const count = retryCount(progress);
      const phase = jobPhase(progress);
      const kind = row.kind;
      const routeRetryAllowed =
        (kind === "where_is_money_check" || kind === "address_deep_check") &&
        count < maxRetries;
      const incomingRetryAllowed =
        kind === "incoming_deposit_check" &&
        phase !== null &&
        preDeliveryPhases.has(phase) &&
        count < 1;
      const requeued = routeRetryAllowed || incomingRetryAllowed;
      const incomingDeliverySensitive =
        kind === "incoming_deposit_check" &&
        (phase === null || deliverySensitivePhases.has(phase) || !preDeliveryPhases.has(phase));
      const recoveryReason = requeued
        ? "stale_running_requeued"
        : kind === "incoming_deposit_check" && incomingDeliverySensitive
          ? "stale_running_delivery_sensitive_phase"
          : kind === "incoming_deposit_check"
            ? "stale_running_incoming_retry_exhausted"
            : "stale_running_retry_exhausted";

      return {
        ...row,
        status: requeued ? "queued" : "failed",
        progress_json: {
          ...progress,
          jobPhase: requeued ? "queued_after_stale_recovery" : "failed_after_stale_recovery",
          jobHeartbeatAt: recoveredAtIso,
          retryCount: requeued ? count + 1 : count,
          lastRecoveredAt: recoveredAtIso,
          staleRecoveryReason: recoveryReason
        },
        last_error: requeued ? null : recoveryReason,
        started_at: row.started_at,
        completed_at: requeued ? null : recoveredAt,
        updated_at: recoveredAt
      };
    });
}

function createRecoveryDb(
  rows: Record<string, unknown>[]
): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        assertRecoverySql(sql);
        const recoveredRows = simulateRecoveredRows(rows, params);
        return { rows: recoveredRows, rowCount: recoveredRows.length };
      }
    } as unknown as Db,
    queries
  };
}

function createMockDb(
  overrides: { rows: Record<string, unknown>[]; rowCount?: number }[] = []
): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  const queuedOverrides = [...overrides];
  return {
    db: {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        const override = queuedOverrides.shift();
        if (override) {
          return {
            rows: override.rows,
            rowCount: override.rowCount ?? override.rows.length
          };
        }
        if (sql.includes("insert into forensic_check_jobs")) {
          return {
            rows: [
              {
                id: params[0],
                kind: params[1],
                subject_address: params[2],
                status: "queued",
                window_start: params[3],
                window_end: params[4],
                priority: params[5],
                chat_id: params[6],
                message_id: params[7],
                requested_by: params[8],
                progress_json: params[9] ?? {},
                result_json: {},
                raw_evidence_ids: [],
                observation_ids: [],
                last_error: null,
                created_at: new Date("2026-05-24T00:00:00.000Z"),
                updated_at: new Date("2026-05-24T00:00:00.000Z"),
                started_at: null,
                completed_at: null
              }
            ],
            rowCount: 1
          };
        }
        if (sql.includes("for update of job skip locked")) {
          return {
            rows: [
              {
                id: "job-1",
                kind: "address_deep_check",
                subject_address: "TSubject111111111111111111111111111111",
                status: "running",
                window_start: new Date("2026-04-24T00:00:00.000Z"),
                window_end: new Date("2026-05-24T00:00:00.000Z"),
                priority: 100,
                chat_id: "42",
                message_id: "10",
                requested_by: "42",
                progress_json: {},
                result_json: {},
                raw_evidence_ids: [],
                observation_ids: [],
                last_error: null,
                created_at: new Date("2026-05-24T00:00:00.000Z"),
                updated_at: new Date("2026-05-24T00:00:00.000Z"),
                started_at: new Date("2026-05-24T00:00:00.000Z"),
                completed_at: null
              }
            ],
            rowCount: 1
          };
        }
        if (sql.includes("from forensic_check_jobs where id = $1")) {
          return {
            rows: [
              {
                id: params[0],
                kind: "address_deep_check",
                subject_address: "TSubject111111111111111111111111111111",
                status: "completed",
                window_start: new Date("2026-04-24T00:00:00.000Z"),
                window_end: new Date("2026-05-24T00:00:00.000Z"),
                priority: 100,
                chat_id: "42",
                message_id: "10",
                requested_by: "42",
                progress_json: { scannedPages: 2 },
                result_json: { score: 40 },
                raw_evidence_ids: ["raw-1"],
                observation_ids: ["obs-1"],
                last_error: null,
                created_at: new Date("2026-05-24T00:00:00.000Z"),
                updated_at: new Date("2026-05-24T00:00:00.000Z"),
                started_at: new Date("2026-05-24T00:00:00.000Z"),
                completed_at: new Date("2026-05-24T00:01:00.000Z")
              }
            ],
            rowCount: 1
          };
        }
        if (sql.includes("kind = 'address_deep_check'") && sql.includes("status in ('completed', 'partial')")) {
          return {
            rows: [
              {
                id: "deep-job-latest",
                kind: "address_deep_check",
                subject_address: params[0],
                status: "completed",
                window_start: new Date("2026-04-24T00:00:00.000Z"),
                window_end: new Date("2026-05-24T00:00:00.000Z"),
                priority: 100,
                chat_id: "42",
                message_id: "10",
                requested_by: "42",
                progress_json: {},
                result_json: { subjectAddress: params[0], coverage: {}, coverageDebug: {}, missingChecks: [] },
                raw_evidence_ids: [],
                observation_ids: [],
                last_error: null,
                created_at: new Date("2026-05-25T00:00:00.000Z"),
                updated_at: new Date("2026-05-25T00:00:00.000Z"),
                started_at: new Date("2026-05-25T00:00:00.000Z"),
                completed_at: new Date("2026-05-25T00:01:00.000Z")
              }
            ],
            rowCount: 1
          };
        }
        if (sql.includes("kind = 'where_is_money_check'")) {
          return {
            rows: [
              {
                id: "where-job-latest",
                kind: "where_is_money_check",
                subject_address: params[0],
                status: "completed",
                window_start: new Date("2026-04-24T00:00:00.000Z"),
                window_end: new Date("2026-05-24T00:00:00.000Z"),
                priority: 100,
                chat_id: "42",
                message_id: "10",
                requested_by: "42",
                progress_json: {},
                result_json: { subjectAddress: params[0], riskScore: 25, assessment: {}, coverage: {} },
                raw_evidence_ids: [],
                observation_ids: [],
                last_error: null,
                created_at: new Date("2026-05-25T00:00:00.000Z"),
                updated_at: new Date("2026-05-25T00:00:00.000Z"),
                started_at: new Date("2026-05-25T00:00:00.000Z"),
                completed_at: new Date("2026-05-25T00:01:00.000Z")
              }
            ],
            rowCount: 1
          };
        }
        if (sql.includes("where subject_address = $1")) {
          return {
            rows: [
              {
                id: "job-latest",
                kind: "address_deep_check",
                subject_address: params[0],
                status: "partial",
                window_start: new Date("2026-04-24T00:00:00.000Z"),
                window_end: new Date("2026-05-24T00:00:00.000Z"),
                priority: 100,
                chat_id: "42",
                message_id: "10",
                requested_by: "42",
                progress_json: {},
                result_json: { coverageDebug: { rows: [] } },
                raw_evidence_ids: [],
                observation_ids: [],
                last_error: null,
                created_at: new Date("2026-05-25T00:00:00.000Z"),
                updated_at: new Date("2026-05-25T00:00:00.000Z"),
                started_at: new Date("2026-05-25T00:00:00.000Z"),
                completed_at: new Date("2026-05-25T00:01:00.000Z")
              }
            ],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 1 };
      }
    } as unknown as Db,
    queries
  };
}

function createDeepContextSaveDb(
  row: Record<string, unknown>,
  updateRowCount = 1
): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("select subject_address")) return { rows: [row], rowCount: 1 };
      if (sql.includes("update forensic_check_jobs")) return { rows: [], rowCount: updateRowCount };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return {
    db: { connect: async () => client } as unknown as Db,
    queries
  };
}

describe("forensic check job repositories", () => {
  it("creates or reuses an active persisted deep address job", async () => {
    const { db, queries } = createMockDb();
    const job = await createOrReuseForensicCheckJob(db, {
      subjectAddress: "TSubject111111111111111111111111111111",
      windowStart: new Date("2026-04-24T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      chatId: "42",
      messageId: "10",
      requestedBy: "42",
      priority: 100
    });

    expect(job.status).toBe("queued");
    expect(queries[0].sql).toContain("insert into forensic_check_jobs");
    expect(queries[0].sql).toContain("on conflict");
  });

  it("creates or reuses an active where-is-money job", async () => {
    const { db, queries } = createMockDb();
    const job = await createOrReuseForensicCheckJob(db, {
      kind: "where_is_money_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      windowStart: new Date("2026-04-24T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      chatId: "42",
      requestedBy: "42",
      priority: 120
    });

    expect(job.kind).toBe("where_is_money_check");
    expect(job.priority).toBe(120);
    expect(queries[0].params[1]).toBe("where_is_money_check");
  });

  it("accepts incoming_deposit_check forensic jobs", async () => {
    const { db, queries } = createMockDb();
    const job = await createOrReuseForensicCheckJob(db, {
      kind: "incoming_deposit_check",
      subjectAddress: "TSender11111111111111111111111111111",
      windowStart: new Date("2026-05-29T00:00:00.000Z"),
      windowEnd: new Date("2026-05-29T00:10:00.000Z"),
      requestedBy: "42",
      progressJson: {
        depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
        amountRaw: "384064001319",
        timestamp: "2026-05-29T14:01:00.000Z"
      }
    });

    expect(job.kind).toBe("incoming_deposit_check");
    expect(job.progressJson.depositTxHash).toBe("48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b");
    expect(queries[0].sql).toContain("coalesce(progress_json->>'depositTxHash', '')");
  });

  it("rejects queued address_fast_check jobs without querying storage", async () => {
    const { db, queries } = createMockDb();

    await expect(createOrReuseForensicCheckJob(db, {
      kind: "address_fast_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-01T00:00:00.000Z")
    } as unknown as Parameters<typeof createOrReuseForensicCheckJob>[1])).rejects.toThrow("address_fast_check jobs must be saved with saveAddressFastCheckJob");

    expect(queries).toEqual([]);
  });

  it("saves terminal address_fast_check jobs without queueing them", async () => {
    const { db, queries } = createMockDb([
      {
        rows: [
          forensicJobRow({
            id: "fast-job-1",
            kind: "address_fast_check",
            subject_address: "TSubject111111111111111111111111111111",
            status: "partial",
            chat_id: "42",
            message_id: null,
            requested_by: "42",
            progress_json: { checkedTransfers: 12 },
            result_json: { riskScore: 45 },
            raw_evidence_ids: ["raw-1"],
            observation_ids: ["obs-1"],
            last_error: "partial history",
            started_at: new Date("2026-06-01T00:00:00.000Z"),
            completed_at: new Date("2026-06-01T00:00:00.000Z")
          })
        ]
      }
    ]);

    const job = await saveAddressFastCheckJob(db, {
      id: "fast-job-1",
      subjectAddress: "TSubject111111111111111111111111111111",
      status: "partial",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-01T00:00:00.000Z"),
      chatId: "42",
      requestedBy: "42",
      progressJson: { checkedTransfers: 12 },
      resultJson: { riskScore: 45 },
      rawEvidenceIds: ["raw-1"],
      observationIds: ["obs-1"],
      lastError: "partial history"
    });

    expect(job).toMatchObject({
      id: "fast-job-1",
      kind: "address_fast_check",
      status: "partial",
      messageId: null,
      progressJson: { checkedTransfers: 12 },
      resultJson: { riskScore: 45 },
      rawEvidenceIds: ["raw-1"],
      observationIds: ["obs-1"],
      lastError: "partial history"
    });
    expect(queries[0].sql).toContain("insert into forensic_check_jobs");
    expect(queries[0].sql).toContain("kind, subject_address, status");
    expect(queries[0].sql).toContain("started_at, completed_at");
    expect(queries[0].sql).not.toContain("'queued'");
    expect(queries[0].sql).not.toContain("on conflict");
    expect(queries[0].params).toEqual([
      "fast-job-1",
      "TSubject111111111111111111111111111111",
      "partial",
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-06-01T00:00:00.000Z"),
      100,
      "42",
      "42",
      { checkedTransfers: 12 },
      { riskScore: 45 },
      JSON.stringify(["raw-1"]),
      JSON.stringify(["obs-1"]),
      "partial history"
    ]);
  });

  it("claims the next queued job with skip locked semantics", async () => {
    const { db, queries } = createMockDb();
    const job = await claimNextForensicCheckJob(db);

    expect(job?.status).toBe("running");
    expect(job?.progressJson).toEqual({});
    expect(queries[0].sql.toLowerCase()).toContain("for update of job skip locked");
    expect(queries[0].sql).toContain("kind <> 'address_fast_check'");
    expect(queries[0].sql).toContain("job.progress_json->>'jobPhase' is distinct from 'waiting_for_targeted_index'");
    expect(queries[0].sql).not.toContain("and not (");
  });

  it("claims queued jobs by forensic job kind when requested", async () => {
    const { db, queries } = createMockDb();
    await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });

    expect(queries[0].sql).toContain("kind = any($1::text[])");
    expect(queries[0].params).toEqual([["where_is_money_check"]]);
  });

  it("releases strict provenance jobs to queued waiting state", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const progressJson = {
      strictProvenanceBenchmark: true,
      jobPhase: "waiting_for_targeted_index"
    };
    const lastError = "targeted index pending";
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as unknown as Db;

    const released = await releaseForensicCheckJobToWaiting(db, {
      id: "job-1",
      claimStartedAt: new Date("2026-06-01T00:00:00.000Z"),
      progressJson,
      lastError
    });

    expect(released).toBe(true);
    expect(queries[0].sql).toContain("set status = 'queued'");
    expect(queries[0].sql).toContain("progress_json = $2");
    expect(queries[0].sql).toContain("last_error = $3");
    expect(queries[0].sql).toContain("where id = $1");
    expect(queries[0].sql).toContain("status = 'running'");
    expect(queries[0].sql).toContain("status = 'queued'");
    expect(queries[0].sql).toContain("progress_json->>'jobPhase' = 'waiting_for_targeted_index'");
    expect(queries[0].params[0]).toBe("job-1");
    expect(queries[0].params[1]).toEqual(progressJson);
    expect(queries[0].params[2]).toBe(lastError);
  });

  it("does not claim jobs waiting for targeted index", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [] };
      }
    } as unknown as Db;

    await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });

    expect(queries[0].sql).toContain("waiting_for_targeted_index");
    expect(queries[0].sql).toContain("job.progress_json->>'jobPhase' is distinct from 'waiting_for_targeted_index'");
    expect(queries[0].sql).not.toContain("and not (");
  });

  it("upserts targeted job waits using the current expanded wait identity", async () => {
    const { db, queries } = createMockDb([{ rows: [], rowCount: 1 }]);

    await upsertForensicJobWait(db, {
      jobId: "job-1",
      claimStartedAt: new Date("2026-06-01T00:00:00.000Z"),
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      requiredFor: "where_hop",
      statusReason: "partial_provider_cap",
      lastError: null
    });

    expect(compactSql(queries[0].sql)).toContain(
      "on conflict (job_id, wait_type, address, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, candidate_tx_hash) do update set"
    );
    expect(queries[0].sql).toContain("with locked_parent as materialized");
    expect(queries[0].sql).toContain("job.status = 'running'");
    expect(queries[0].sql).toContain("job.status = 'queued'");
    expect(queries[0].sql).toContain("job.progress_json->>'jobPhase' = 'waiting_for_targeted_index'");
    expect(queries[0].sql).toContain("for update of job");
    expect(queries[0].params[0]).toBe("job-1");
    expect(queries[0].params[2]).toBe(new Date("2026-06-30T11:52:00.000Z").getTime());
    expect(queries[0].params[4]).toBe("where_hop");
  });

  it("marks a waiting strict job ready after targeted index completion", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as unknown as Db;

    const updated = await markStrictProvenanceJobReadyAfterIndex(db, {
      id: "job-1",
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    });

    expect(updated).toBe(true);
    expect(queries[0].sql).toContain("reading_local_index");
    expect(queries[0].sql).toContain("last_error = $8");
    expect(queries[0].sql).toContain("where id = $1");
    expect(queries[0].sql).toContain("progress_json->'strictProvenance'->'waitingFor'");
    expect(queries[0].sql).toContain("->>'address' = $4");
    expect(queries[0].sql).toContain("->>'targetTimestamp'");
    expect(queries[0].sql).toContain("is not distinct from $5::text");
    expect(queries[0].params[3]).toBe("THop111111111111111111111111111111111");
    expect(queries[0].params[4]).toBe("2026-06-30T11:52:00.000Z");
    expect(queries[0].params[7]).toBeNull();
  });

  it("marks durable waits ready without changing the parent job", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 2, rows: [] };
      }
    } as unknown as Db;

    const updated = await markWaitingForensicJobsReadyAfterTargetedIndex(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    });

    expect(updated).toBe(2);
    expect(queries[0].sql).toContain("update forensic_job_waits");
    expect(queries[0].sql).toContain("wait.target_timestamp_ms <= $2");
    expect(queries[0].sql).toContain("wait.request_kind = 'broad_targeted'");
    expect(queries[0].sql).not.toContain("forensic_check_jobs");
    expect(queries[0].sql).not.toContain("jobPhase");
    expect(queries[0].sql).not.toContain("targetedIndex");
    expect(queries[0].params[0]).toBe("THop111111111111111111111111111111111");
    expect(queries[0].params[1]).toBe(new Date("2026-06-30T11:52:00.000Z").getTime());
    expect(queries[0].params).toContain("ready");
  });

  it("reconciles a bounded locked batch with an exact Task 2 progress snapshot", async () => {
    const snapshot: WaitReconciliationResultV1 = {
      parentJobId: "where-job-reconcile-1",
      readyCount: 2,
      terminalCount: 0,
      cancelledCount: 0,
      waitingCount: 0,
      outcome: "resume_ready",
      diagnosticCode: null
    };
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let released = false;
    const client = {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        if (sql === "begin" || sql === "commit") return { rows: [], rowCount: 0 };
        if (sql.includes("select job.id")) {
          return { rows: [{ id: snapshot.parentJobId }], rowCount: 1 };
        }
        return {
          rows: [{
            progress_json: {
              preservedLegacyField: { keep: true },
              waitReconciliation: snapshot
            }
          }],
          rowCount: 1
        };
      },
      release() {
        released = true;
      }
    };
    const db = {
      async connect() {
        return client;
      },
      async query() {
        throw new Error("reconciliation must use a locked transaction client");
      }
    } as unknown as Db;
    const reconcile = await loadWaitReconciler();
    const now = new Date("2026-07-15T12:00:00.000Z");

    await expect(reconcile(db, { now, limit: 10 })).resolves.toEqual([snapshot]);

    expect(queries.map((query) => query.sql)).toEqual(expect.arrayContaining(["begin", "commit"]));
    const selectionSql = compactSql(queries[1].sql);
    expect(selectionSql).toContain("order by job.updated_at asc");
    expect(selectionSql).toContain("limit $1");
    expect(selectionSql).toContain("for update of job skip locked");
    expect(queries[1].params).toEqual([10]);
    const reconciliationSql = compactSql(queries[2].sql);
    expect(reconciliationSql).toContain("left join forensic_job_waits wait on wait.job_id = parent.id");
    expect(reconciliationSql).toContain("count(wait.id) filter (where wait.status = 'ready')");
    expect(reconciliationSql).toContain("count(wait.id) filter (where wait.status = 'terminal')");
    expect(reconciliationSql).toContain("count(wait.id) filter (where wait.status = 'cancelled')");
    expect(reconciliationSql).toContain("count(wait.id) filter (where wait.status = 'waiting')");
    expect(reconciliationSql).toContain("job.status = 'queued'");
    expect(reconciliationSql).toContain("job.progress_json->>'jobPhase' = 'waiting_for_targeted_index'");
    expect(reconciliationSql).toContain("'waitReconciliation', jsonb_build_object(");
    expect(reconciliationSql).toContain("updated_at = $1::timestamptz");
    expect(queries[2].params).toEqual([now, [snapshot.parentJobId]]);
    expect(released).toBe(true);
    expect(buildForensicRuntimeContractProjection({ waitReconciliation: snapshot }).waitReconciliation)
      .toEqual(snapshot);
  });

  it("rejects unbounded reconciliation limits before querying PostgreSQL", async () => {
    const { db, queries } = createMockDb();
    const reconcile = await loadWaitReconciler();
    const now = new Date("2026-07-15T12:00:00.000Z");

    await expect(reconcile(db, { now, limit: 0 })).rejects.toThrow(/limit/i);
    await expect(reconcile(db, { now, limit: 101 })).rejects.toThrow(/limit/i);
    expect(queries).toEqual([]);
  });

  it("stores separate candidate-window waits for the same job address and target", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");

    await upsertForensicJobWait(db, {
      jobId: "where-job-window-waits",
      claimStartedAt: PLAN3_RECONCILIATION_NOW,
      address: "TWaitWindow111111111111111111111111111",
      targetTimestamp: end,
      requiredFor: "where_hop",
      requestKind: "candidate_window",
      windowStartTimestamp: new Date("2026-07-04T11:55:00.000Z"),
      windowEndTimestamp: end,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-1"
    });
    await upsertForensicJobWait(db, {
      jobId: "where-job-window-waits",
      claimStartedAt: PLAN3_RECONCILIATION_NOW,
      address: "TWaitWindow111111111111111111111111111",
      targetTimestamp: end,
      requiredFor: "where_hop",
      requestKind: "candidate_window",
      windowStartTimestamp: new Date("2026-07-04T11:58:00.000Z"),
      windowEndTimestamp: end,
      relatedHopTxHash: "hop-tx-1",
      candidateTxHash: "candidate-tx-2"
    });

    expect(queries[0].sql).toContain("request_kind");
    expect(queries[0].sql).toContain("window_start_timestamp_ms");
    expect(queries[0].sql).toContain("candidate_tx_hash");
    expect(queries[0].sql).toContain("request_kind, window_start_timestamp_ms, candidate_tx_hash");
    expect(queries[0].params).toContain("candidate_window");
    expect(queries[0].params).toContain("candidate-tx-1");
    expect(queries[1].params).toContain("candidate-tx-2");
  });

  it("uses stable broad wait candidate identity fields", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");

    await upsertForensicJobWait(db, {
      jobId: "where-job-broad-wait",
      claimStartedAt: PLAN3_RECONCILIATION_NOW,
      address: "TWaitBroad1111111111111111111111111111",
      targetTimestamp: end,
      requiredFor: "where_hop"
    });

    expect(queries[0].params).toContain("broad_targeted");
    expect(queries[0].params).toContain("");
  });

  it("limits waiting targeted progress patches to broad targeted waits", async () => {
    const { db, queries } = createMockDb();

    await patchWaitingForensicJobsTargetedIndexProgress(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      indexStatus: "running",
      statusReason: null,
      lastError: null
    });

    expect(queries[0].sql).toContain("wait.request_kind = 'broad_targeted'");
  });

  it("matches candidate-window waits exactly when marking jobs ready", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");

    await markWaitingForensicJobsReadyAfterTargetedIndex(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: end,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null,
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      candidateTxHash: "candidate-tx-1"
    } as Parameters<typeof markWaitingForensicJobsReadyAfterTargetedIndex>[1]);

    expect(queries[0].sql).toContain("wait.request_kind = $");
    expect(queries[0].sql).toContain("wait.target_timestamp_ms = $");
    expect(queries[0].sql).toContain("wait.window_start_timestamp_ms = $");
    expect(queries[0].sql).toContain("coalesce(wait.candidate_tx_hash, '') = $");
  });

  it("leaves candidate-window parent reconciliation to the reconciler", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");

    await markWaitingForensicJobsReadyAfterTargetedIndex(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: end,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null,
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      candidateTxHash: "candidate-tx-1"
    } as Parameters<typeof markWaitingForensicJobsReadyAfterTargetedIndex>[1]);

    expect(queries[0].sql).not.toContain("forensic_check_jobs");
    expect(queries[0].sql).not.toContain("ready_jobs as");
  });

  it("only transitions candidate-window wait rows that are still waiting", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");

    await markWaitingForensicJobsReadyAfterTargetedIndex(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: end,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null,
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      candidateTxHash: "candidate-tx-1"
    } as Parameters<typeof markWaitingForensicJobsReadyAfterTargetedIndex>[1]);

    expect(queries[0].sql).toContain("wait.status = 'waiting'");
    expect(queries[0].sql).not.toContain("wait.status in ('ready', 'terminal')");
  });

  it("does not inspect sibling waits while recording candidate-window completion", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");

    await markWaitingForensicJobsReadyAfterTargetedIndex(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: end,
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null,
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      candidateTxHash: "candidate-tx-1"
    } as Parameters<typeof markWaitingForensicJobsReadyAfterTargetedIndex>[1]);

    expect(queries[0].sql).not.toContain("blocker.");
    expect(queries[0].sql).not.toContain("not exists");
  });

  it("marks terminal candidate-window waits for separate reconciliation", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");

    await markWaitingForensicJobsReadyAfterTargetedIndex(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: end,
      indexStatus: "failed_terminal",
      statusReason: "partial_provider_cap",
      lastError: "provider cap",
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      candidateTxHash: "candidate-tx-1"
    } as Parameters<typeof markWaitingForensicJobsReadyAfterTargetedIndex>[1]);

    expect(queries[0].params).toContain("terminal");
    expect(queries[0].sql).not.toContain("reading_local_index");
  });

  it("matches candidate-window waits exactly when patching waiting progress", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");
    const start = new Date("2026-07-04T11:55:00.000Z");

    await patchWaitingForensicJobsTargetedIndexProgress(db, {
      address: "THop111111111111111111111111111111111",
      targetTimestamp: end,
      indexStatus: "running",
      statusReason: null,
      lastError: null,
      requestKind: "candidate_window",
      windowStartTimestamp: start,
      candidateTxHash: "candidate-tx-1"
    } as Parameters<typeof patchWaitingForensicJobsTargetedIndexProgress>[1]);

    expect(queries[0].sql).toContain("wait.request_kind = $");
    expect(queries[0].sql).toContain("wait.target_timestamp_ms = $");
    expect(queries[0].sql).toContain("wait.window_start_timestamp_ms = $");
    expect(queries[0].sql).toContain("coalesce(wait.candidate_tx_hash, '') = $");
  });

  it("prefers finished covering targeted states over exact stale non-covered states in progress query", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;

    await getForensicJobTargetedHistoryProgress(db, "job-1");

    expect(queries[0].sql).toContain("state.target_timestamp_ms >= wait.target_timestamp_ms");
    expect(queries[0].sql).toContain("when state.status = 'complete' then 0");
    expect(queries[0].sql).toContain("when state.status = 'failed_terminal' then 1");
    expect(queries[0].sql).toContain("state.status = 'partial' and state.status_reason in");
    expect(queries[0].sql).toContain("state.status_reason = 'partial_provider_cap'");
    expect(queries[0].sql).toContain("state.attempt_count >= greatest(coalesce(state.max_attempts, 0), 8)");
    expect(queries[0].sql).toContain("order by");
    expect(queries[0].sql).toContain("state.target_timestamp_ms asc");
    expect(queries[0].sql).toContain("wait.request_kind = 'broad_targeted'");
  });

  it("uses exact request identity for candidate-window progress lookups", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;

    await getForensicJobTargetedHistoryProgress(db, "job-1");

    expect(queries[0].sql).toContain("wait.request_kind = 'candidate_window'");
    expect(queries[0].sql).toContain("state.request_kind = wait.request_kind");
    expect(queries[0].sql).toContain("state.target_timestamp_ms = wait.target_timestamp_ms");
    expect(queries[0].sql).toContain("state.window_start_timestamp_ms = wait.window_start_timestamp_ms");
    expect(queries[0].sql).toContain("coalesce(state.candidate_tx_hash, '') = coalesce(wait.candidate_tx_hash, '')");
  });

  it("prefers terminal covering states over in-flight states in covering lookup", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;

    await getCoveringTronAddressUsdtIndexState(db, {
      address: "THop111111111111111111111111111111111",
      coverageMode: "targeted",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z")
    });

    expect(queries[0].sql).toContain("target_timestamp_ms >= $2");
    expect(queries[0].sql).toContain("when status = 'complete' then 0");
    expect(queries[0].sql).toContain("when status = 'failed_terminal' then 1");
    expect(queries[0].sql).toContain("status_reason = 'partial_provider_cap'");
    expect(queries[0].sql).toContain("attempt_count >= greatest(coalesce(max_attempts, 0), 8)");
    expect(queries[0].sql).toContain("when status in ('queued', 'running', 'failed_retryable') then 3");
    expect(queries[0].params[0]).toBe("THop111111111111111111111111111111111");
    expect(queries[0].params[1]).toBe(new Date("2026-06-30T11:52:00.000Z").getTime());
  });

  it("requires waiting target match when marking strict job ready", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 0, rows: [] };
      }
    } as unknown as Db;

    const updated = await markStrictProvenanceJobReadyAfterIndex(db, {
      id: "job-1",
      address: "THop222222222222222222222222222222222",
      targetTimestamp: new Date("2026-06-30T12:15:00.000Z"),
      indexStatus: "complete",
      statusReason: "complete_provider_windowed",
      lastError: null
    });

    expect(updated).toBe(false);
    expect(queries[0].sql).toContain("progress_json->'strictProvenance'->'waitingFor'->>'address' = $4");
    expect(queries[0].sql).toContain(
      "(progress_json->'strictProvenance'->'waitingFor'->>'targetTimestamp') is not distinct from $5::text"
    );
    expect(queries[0].params[3]).toBe("THop222222222222222222222222222222222");
    expect(queries[0].params[4]).toBe("2026-06-30T12:15:00.000Z");
  });

  it.each(["running", "queued", "failed_retryable"] as const)(
    "does not mark a waiting strict job ready for non-terminal %s index status",
    async (indexStatus) => {
      const queries: Array<{ sql: string; params: unknown[] }> = [];
      const db = {
        query: async (sql: string, params: unknown[]) => {
          queries.push({ sql, params });
          return { rowCount: 1, rows: [] };
        }
      } as unknown as Db;

      const updated = await markStrictProvenanceJobReadyAfterIndex(db, {
        id: "job-1",
        address: "THop111111111111111111111111111111111",
        targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
        indexStatus,
        statusReason: null,
        lastError: null
      });

      expect(updated).toBe(false);
      expect(queries).toEqual([]);
    }
  );

  it("marks a waiting strict job provider limited after terminal partial targeted index", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as unknown as Db;

    const updated = await markStrictProvenanceJobReadyAfterIndex(db, {
      id: "job-1",
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      indexStatus: "partial",
      statusReason: "partial_provider_cap",
      lastError: "provider cap reached"
    });

    expect(updated).toBe(true);
    expect(queries[0].sql).toContain("provider_limited");
    expect(queries[0].params[1]).toBe("provider_limited");
    expect(queries[0].params[7]).toBe("provider cap reached");
  });

  it("marks a waiting strict job provider limited after terminal failed targeted index", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as unknown as Db;

    const updated = await markStrictProvenanceJobReadyAfterIndex(db, {
      id: "job-1",
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      indexStatus: "failed_terminal",
      statusReason: "failed_terminal",
      lastError: "provider terminal failure"
    });

    expect(updated).toBe(true);
    expect(queries[0].sql).toContain("provider_limited");
    expect(queries[0].params[1]).toBe("provider_limited");
    expect(queries[0].params[7]).toBe("provider terminal failure");
  });

  it("patches strict benchmark progress metrics for queued or running jobs", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as unknown as Db;

    const updated = await patchStrictBenchmarkProgress(db, {
      id: "job-1",
      claimStartedAt: new Date("2026-06-01T00:00:00.000Z"),
      patchJson: {
        strictBenchmarkMetrics: {
          stages: { apiMs: 125 }
        }
      }
    });

    expect(updated).toBe(true);
    expect(queries[0].sql).toContain("jsonb_set");
    expect(queries[0].sql).toContain("{strictBenchmarkMetrics,total}");
    expect(queries[0].sql).toContain("{strictBenchmarkMetrics,stages}");
    expect(queries[0].sql).toContain("status in ('queued', 'running')");
    expect(queries[0].sql).toContain("started_at = $3");
    expect(queries[0].params[2]).toEqual(new Date("2026-06-01T00:00:00.000Z"));
  });

  it("stores completed result evidence and observation ids", async () => {
    const { db, queries } = createMockDb();
    await completeForensicCheckJob(db, {
      id: "job-1",
      claimStartedAt: new Date("2026-06-01T00:00:00.000Z"),
      status: "completed",
      progressJson: { scannedPages: 2 },
      resultJson: { score: 40 },
      rawEvidenceIds: ["raw-1"],
      observationIds: ["obs-1"],
      lastError: null
    });

    expect(queries[0].sql).toContain("update forensic_check_jobs");
    expect(queries[0].params).toEqual([
      "job-1",
      "completed",
      { scannedPages: 2 },
      { score: 40 },
      JSON.stringify(["raw-1"]),
      JSON.stringify(["obs-1"]),
      null,
      new Date("2026-06-01T00:00:00.000Z")
    ]);
  });

  it("lists completed deep check jobs with pending second-layer relationship profiles", async () => {
    const { db, queries } = createMockDb([
      {
        rows: [
          forensicJobRow({
            id: "job-pending-second-layer",
            status: "completed",
            result_json: {
              secondLayerRelationshipProfiles: {
                counters: { queued: 1, notIndexed: 0 }
              }
            }
          })
        ]
      }
    ]);

    const jobs = await listCompletedDeepCheckJobsWithPendingSecondLayer(db, { limit: 10 });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("job-pending-second-layer");
    expect(jobs[0]?.status).toBe("completed");
    expect(queries[0].sql).toContain("kind = 'address_deep_check'");
    expect(queries[0].sql).toContain("status = 'completed'");
    expect(queries[0].sql).toContain("progress_json #>> '{deepSecondLayerContext,profile,counters,queued}'");
    expect(queries[0].sql).toContain("progress_json #>> '{deepSecondLayerContext,profile,counters,notIndexed}'");
    expect(queries[0].sql).toContain("result_json #>> '{secondLayerRelationshipProfiles,counters,queued}'");
    expect(queries[0].sql).toContain("result_json #>> '{secondLayerRelationshipProfiles,counters,notIndexed}'");
    expect(queries[0].sql).toContain("case when (result_json #>> '{secondLayerRelationshipProfiles,counters,queued}') ~ '^[0-9]{1,9}$'");
    expect(queries[0].sql).toContain("case when (result_json #>> '{secondLayerRelationshipProfiles,counters,notIndexed}') ~ '^[0-9]{1,9}$'");
    expect(queries[0].sql).toContain("order by updated_at asc");
    expect(queries[0].params).toEqual([]);
  });

  it("rejects a first Deep second-layer context whose subject differs from the persisted job", async () => {
    const baseResult = { version: "deep-result-v1" };
    const { db, queries } = createDeepContextSaveDb({
      subject_address: "TJobSubject111111111111111111111111111",
      progress_json: {},
      result_json: baseResult
    });

    const saved = await saveCompletedDeepSecondLayerContext(db, {
      id: "job-subject-mismatch",
      context: {
        version: "deep-second-layer-context-v1",
        baseResultFingerprint: fingerprintCanonicalJson(baseResult),
        refreshedAt: CANONICAL_DEEP_SECOND_LAYER_PROFILE.generatedAt,
        profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
      }
    });

    expect(saved).toBe(false);
    expect(queries.some(({ sql }) => sql.includes("update forensic_check_jobs"))).toBe(false);
  });

  it("rejects Deep context when immutable result subject differs from the persisted job", async () => {
    const baseResult = {
      version: "deep-result-v1",
      subjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    };
    const { db, queries } = createDeepContextSaveDb({
      subject_address: "TJobSubject111111111111111111111111111",
      progress_json: {},
      result_json: baseResult
    });

    const saved = await saveCompletedDeepSecondLayerContext(db, {
      id: "job-result-subject-mismatch",
      context: {
        version: "deep-second-layer-context-v1",
        baseResultFingerprint: fingerprintCanonicalJson(baseResult),
        refreshedAt: CANONICAL_DEEP_SECOND_LAYER_PROFILE.generatedAt,
        profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
      }
    });

    expect(saved).toBe(false);
    expect(queries.some(({ sql }) => sql.includes("update forensic_check_jobs"))).toBe(false);
  });

  it("accepts Deep context only when job, immutable result, and profile share the exact subject", async () => {
    const subjectAddress = CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress;
    const baseResult = { version: "deep-result-v1", subjectAddress };
    const { db } = createDeepContextSaveDb({
      subject_address: subjectAddress,
      progress_json: {},
      result_json: baseResult
    });

    await expect(saveCompletedDeepSecondLayerContext(db, {
      id: "job-exact-subject",
      context: {
        version: "deep-second-layer-context-v1",
        baseResultFingerprint: fingerprintCanonicalJson(baseResult),
        refreshedAt: CANONICAL_DEEP_SECOND_LAYER_PROFILE.generatedAt,
        profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
      }
    })).resolves.toBe(true);
  });

  it("ignores pending Deep context whose subject differs from the persisted job", async () => {
    const baseResult = { version: "deep-result-v1" };
    const pendingProfile = structuredClone(CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE);
    pendingProfile.queueRequests = [{
      address: pendingProfile.directWalletStatuses[0]!.address,
      coverageMode: "all_time",
      queuedReason: "deep_second_layer"
    }];
    const invalidContext = {
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: fingerprintCanonicalJson(baseResult),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile: pendingProfile
    };
    expect(buildForensicRuntimeContractProjection({ deepSecondLayerContext: invalidContext }, {
      jobKind: "address_deep_check",
      expectedSubjectAddress: pendingProfile.subjectAddress,
      baseResult
    }).deepSecondLayerContext).not.toBeNull();
    const { db } = createMockDb([{
      rows: [forensicJobRow({
        id: "job-invalid-pending-context",
        status: "completed",
        subject_address: "TJobSubject111111111111111111111111111",
        progress_json: { deepSecondLayerContext: invalidContext },
        result_json: baseResult
      })]
    }]);

    await expect(listCompletedDeepCheckJobsWithPendingSecondLayer(db, { limit: 10 })).resolves.toEqual([]);
  });

  it("stores an initial fast risk snapshot in job progress json", async () => {
    const { db, queries } = createMockDb();
    const job = await createOrReuseForensicCheckJob(db, {
      subjectAddress: "TSubject111111111111111111111111111111",
      windowStart: new Date("2026-04-24T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      chatId: "42",
      requestedBy: "42",
      progressJson: {
        fastRiskSnapshot: {
          score: 80,
          level: "HIGH"
        }
      }
    });

    expect(job.progressJson).toEqual({
      fastRiskSnapshot: {
        score: 80,
        level: "HIGH"
      }
    });
    expect(queries[0].params[9]).toEqual({
      fastRiskSnapshot: {
        score: 80,
        level: "HIGH"
      }
    });
  });

  it("reads job status for /check_status", async () => {
    const { db } = createMockDb();
    const job = await getForensicCheckJob(db, "job-1");

    expect(job).toMatchObject({
      id: "job-1",
      status: "completed",
      rawEvidenceIds: ["raw-1"],
      observationIds: ["obs-1"]
    });
  });

  it("reads the latest deep job for an address", async () => {
    const { db, queries } = createMockDb();
    const job = await getLatestForensicCheckJobForAddress(db, "TSubject111111111111111111111111111111");

    expect(job).toMatchObject({
      id: "job-latest",
      status: "partial",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
    expect(queries[0].sql).toContain("where subject_address = $1");
    expect(queries[0].sql).toContain("order by created_at desc");
  });

  it("lists recent forensic jobs for the admin console", async () => {
    const { db, queries } = createMockDb([
      {
        rows: [
          {
            id: "job-1",
            kind: "where_is_money_check",
            subject_address: "TSubject111111111111111111111111111111",
            status: "completed",
            window_start: new Date("2026-06-01T00:00:00.000Z"),
            window_end: new Date("2026-06-01T01:00:00.000Z"),
            priority: 100,
            chat_id: null,
            message_id: null,
            requested_by: "123",
            progress_json: {},
            result_json: { riskScore: 35, decision: "ACCEPTABLE" },
            raw_evidence_ids: [],
            observation_ids: [],
            last_error: null,
            created_at: new Date("2026-06-01T00:00:00.000Z"),
            updated_at: new Date("2026-06-01T01:00:00.000Z"),
            started_at: new Date("2026-06-01T00:00:01.000Z"),
            completed_at: new Date("2026-06-01T01:00:00.000Z")
          }
        ]
      }
    ]);

    const jobs = await listAdminForensicCheckJobs(db, { limit: 20, offset: 0, status: "completed" });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("job-1");
    expect(queries[0]?.sql).toContain("from forensic_check_jobs");
    expect(queries[0]?.sql).toContain("status = $1");
  });

  it("searches forensic check jobs across ids, addresses, watched wallets, senders, and deposit transactions", async () => {
    const { db, queries } = createMockDb([
      {
        rows: [
          forensicJobRow({
            id: "0fb0a855-63bb-45fa-80ff-ceb53f8a18fd",
            kind: "incoming_deposit_check",
            subject_address: "TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3",
            progress_json: {
              sender: "TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3",
              watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
              depositTxHash: "b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c"
            }
          })
        ]
      }
    ]);

    const jobs = await listAdminForensicCheckJobs(db, { query: "b4603c390", limit: 20, offset: 0 });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("0fb0a855-63bb-45fa-80ff-ceb53f8a18fd");
    expect(queries[0]?.sql).toContain("id ilike $1");
    expect(queries[0]?.sql).toContain("subject_address ilike $1");
    expect(queries[0]?.sql).toContain("progress_json->>'sender'");
    expect(queries[0]?.sql).toContain("progress_json->>'watchedWallet'");
    expect(queries[0]?.sql).toContain("progress_json->>'depositTxHash'");
    expect(queries[0]?.params).toEqual(["%b4603c390%", 20, 0]);
  });

  it("accepts address_fast_check in admin list filters", async () => {
    const { db, queries } = createMockDb([
      {
        rows: [
          forensicJobRow({
            id: "fast-job-1",
            kind: "address_fast_check",
            status: "completed"
          })
        ]
      }
    ]);

    const jobs = await listAdminForensicCheckJobs(db, { kind: "address_fast_check", limit: 20, offset: 0 });

    expect(jobs[0]?.kind).toBe("address_fast_check");
    expect(queries[0]?.sql).toContain("kind = $1");
    expect(queries[0]?.params).toEqual(["address_fast_check", 20, 0]);
  });

  it("reads the latest completed or partial where-is-money job for an address", async () => {
    const { db, queries } = createMockDb();
    const job = await getLatestWhereIsMoneyCheckJobForAddress(db, {
      subjectAddress: "TSubject111111111111111111111111111111",
      chatId: "42",
      requestedBy: "42",
      windowStart: new Date("2026-04-24T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(job).toMatchObject({
      id: "where-job-latest",
      kind: "where_is_money_check",
      status: "completed",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
    expect(queries[0].sql).toContain("kind = 'where_is_money_check'");
    expect(queries[0].sql).toContain("status in ('completed', 'partial')");
    expect(queries[0].sql).toContain("chat_id is not distinct from $2");
    expect(queries[0].sql).toContain("requested_by is not distinct from $3");
    expect(queries[0].sql).toContain("window_start is not distinct from $4");
    expect(queries[0].sql).toContain("window_end is not distinct from $5");
    expect(queries[0].sql).toContain("order by completed_at desc nulls last, created_at desc");
    expect(queries[0].params).toEqual([
      "TSubject111111111111111111111111111111",
      "42",
      "42",
      new Date("2026-04-24T00:00:00.000Z"),
      new Date("2026-05-24T00:00:00.000Z")
    ]);
  });

  it("reads the latest completed or partial deep job for the same address and request context", async () => {
    const { db, queries } = createMockDb();
    const job = await getLatestDeepForensicCheckJobForAddress(db, {
      subjectAddress: "TSubject111111111111111111111111111111",
      chatId: "42",
      requestedBy: "42",
      windowStart: new Date("2026-04-24T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(job).toMatchObject({
      id: "deep-job-latest",
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
    expect(queries[0].sql).toContain("kind = 'address_deep_check'");
    expect(queries[0].sql).toContain("status in ('completed', 'partial')");
    expect(queries[0].sql).toContain("chat_id is not distinct from $2");
    expect(queries[0].sql).toContain("requested_by is not distinct from $3");
    expect(queries[0].sql).toContain("window_start is not distinct from $4");
    expect(queries[0].sql).toContain("window_end is not distinct from $5");
    expect(queries[0].sql).toContain("order by completed_at desc nulls last, created_at desc");
    expect(queries[0].params).toEqual([
      "TSubject111111111111111111111111111111",
      "42",
      "42",
      new Date("2026-04-24T00:00:00.000Z"),
      new Date("2026-05-24T00:00:00.000Z")
    ]);
  });

  it("reads the latest deep job for the same address and request context in any active result status", async () => {
    const { db, queries } = createMockDb([
      {
        rows: [
          forensicJobRow({
            id: "deep-job-running",
            kind: "address_deep_check",
            status: "running",
            subject_address: "TSubject111111111111111111111111111111",
            chat_id: "42",
            requested_by: "42",
            window_start: new Date("2026-04-24T00:00:00.000Z"),
            window_end: new Date("2026-05-24T00:00:00.000Z"),
            created_at: new Date("2026-05-24T00:01:00.000Z")
          })
        ]
      }
    ]);

    const job = await getLatestDeepForensicCheckJobForAddressAnyStatus(db, {
      subjectAddress: "TSubject111111111111111111111111111111",
      chatId: "42",
      requestedBy: "42",
      windowStart: new Date("2026-04-24T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(job).toMatchObject({
      id: "deep-job-running",
      kind: "address_deep_check",
      status: "running",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
    expect(queries[0].sql).toContain("kind = 'address_deep_check'");
    expect(queries[0].sql).toContain("status in ('queued', 'running', 'completed', 'partial')");
    expect(queries[0].sql).toContain("chat_id is not distinct from $2");
    expect(queries[0].sql).toContain("requested_by is not distinct from $3");
    expect(queries[0].sql).toContain("window_start is not distinct from $4");
    expect(queries[0].sql).toContain("window_end is not distinct from $5");
    expect(queries[0].sql).toContain("case when status in ('queued', 'running') then 0 else 1 end");
    expect(queries[0].sql).toContain("case when status in ('queued', 'running') then created_at end desc nulls last");
    expect(queries[0].sql).toContain("completed_at desc nulls last");
    expect(queries[0].sql).toContain("created_at desc");
    expect(queries[0].params).toEqual([
      "TSubject111111111111111111111111111111",
      "42",
      "42",
      new Date("2026-04-24T00:00:00.000Z"),
      new Date("2026-05-24T00:00:00.000Z")
    ]);
  });

  it("groups stale route jobs below the retry limit as requeued with incremented retry metadata", async () => {
    const { db, queries } = createRecoveryDb([
      forensicJobRow({
        id: "where-job-1",
        kind: "where_is_money_check",
        started_at: new Date("2026-06-03T00:00:00.000Z"),
        progress_json: {
          jobPhase: "money_origin_trace",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z",
          retryCount: 1
        }
      }),
      forensicJobRow({
        id: "deep-job-1",
        kind: "address_deep_check",
        started_at: new Date("2026-06-03T00:05:00.000Z"),
        progress_json: {
          jobPhase: "address_deep_trace",
          jobHeartbeatAt: "2026-06-03T00:20:00.000Z"
        }
      })
    ]);

    const result = await recoverStaleForensicCheckJobs(db, {
      staleRunningBefore: new Date("2026-06-03T00:30:00.000Z"),
      maxRetries: 3,
      limit: 25,
      recoveredAt: new Date("2026-06-03T01:00:00.000Z")
    });

    expect(result.failed).toEqual([]);
    expect(result.requeued.map((job) => job.id)).toEqual(["where-job-1", "deep-job-1"]);
    expect(result.requeued[0]).toMatchObject({
      status: "queued",
      startedAt: new Date("2026-06-03T00:00:00.000Z"),
      progressJson: {
        jobPhase: "queued_after_stale_recovery",
        retryCount: 2,
        lastRecoveredAt: "2026-06-03T01:00:00.000Z",
        staleRecoveryReason: "stale_running_requeued"
      }
    });
    expect(result.requeued[1]?.progressJson.retryCount).toBe(1);
    expect(queries[0].params).toEqual([
      new Date("2026-06-03T00:30:00.000Z"),
      "2026-06-03T00:30:00.000Z",
      3,
      25,
      "2026-06-03T01:00:00.000Z"
    ]);
  });

  it("requeues incoming deposit jobs once in pre-delivery phases", async () => {
    const { db } = createRecoveryDb([
      forensicJobRow({
        id: "incoming-trace-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobPhase: "incoming_deposit_trace",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z"
        }
      }),
      forensicJobRow({
        id: "incoming-risk-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobPhase: "risk_recording",
          jobHeartbeatAt: "2026-06-03T00:20:00.000Z",
          retryCount: "0"
        }
      })
    ]);

    const result = await recoverStaleForensicCheckJobs(db, {
      staleRunningBefore: new Date("2026-06-03T00:30:00.000Z"),
      maxRetries: 3,
      recoveredAt: new Date("2026-06-03T01:00:00.000Z")
    });

    expect(result.failed).toEqual([]);
    expect(result.requeued.map((job) => job.id)).toEqual(["incoming-trace-job-1", "incoming-risk-job-1"]);
    for (const job of result.requeued) {
      expect(job).toMatchObject({
        kind: "incoming_deposit_check",
        status: "queued",
        progressJson: {
          jobPhase: "queued_after_stale_recovery",
          retryCount: 1,
          staleRecoveryReason: "stale_running_requeued"
        }
      });
    }
  });

  it("fails stale incoming deposit jobs in delivery-sensitive, null, or unknown phases", async () => {
    const { db } = createRecoveryDb([
      forensicJobRow({
        id: "incoming-notification-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobPhase: "notification_delivery",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z"
        }
      }),
      forensicJobRow({
        id: "incoming-completing-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobPhase: "completing",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z"
        }
      }),
      forensicJobRow({
        id: "incoming-null-phase-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z"
        }
      }),
      forensicJobRow({
        id: "incoming-unknown-phase-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobPhase: "unexpected_phase",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z"
        }
      })
    ]);

    const result = await recoverStaleForensicCheckJobs(db, {
      staleRunningBefore: new Date("2026-06-03T00:30:00.000Z"),
      maxRetries: 3,
      recoveredAt: new Date("2026-06-03T01:00:00.000Z")
    });

    expect(result.requeued).toEqual([]);
    expect(result.failed.map((job) => job.id)).toEqual([
      "incoming-notification-job-1",
      "incoming-completing-job-1",
      "incoming-null-phase-job-1",
      "incoming-unknown-phase-job-1"
    ]);
    for (const job of result.failed) {
      expect(job).toMatchObject({
        status: "failed",
        completedAt: new Date("2026-06-03T01:00:00.000Z"),
        progressJson: {
          jobPhase: "failed_after_stale_recovery",
          staleRecoveryReason: "stale_running_delivery_sensitive_phase"
        },
        lastError: "stale_running_delivery_sensitive_phase"
      });
    }
  });

  it("fails retry-exhausted route and incoming pre-delivery jobs", async () => {
    const { db } = createRecoveryDb([
      forensicJobRow({
        id: "where-exhausted-job-1",
        kind: "where_is_money_check",
        progress_json: {
          jobPhase: "money_origin_trace",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z",
          retryCount: 3
        }
      }),
      forensicJobRow({
        id: "incoming-exhausted-job-1",
        kind: "incoming_deposit_check",
        progress_json: {
          jobPhase: "risk_recording",
          jobHeartbeatAt: "2026-06-03T00:10:00.000Z",
          retryCount: 1
        }
      })
    ]);

    const result = await recoverStaleForensicCheckJobs(db, {
      staleRunningBefore: new Date("2026-06-03T00:30:00.000Z"),
      maxRetries: 3,
      recoveredAt: new Date("2026-06-03T01:00:00.000Z")
    });

    expect(result.requeued).toEqual([]);
    expect(result.failed.map((job) => job.id)).toEqual(["where-exhausted-job-1", "incoming-exhausted-job-1"]);
    expect(result.failed[0]).toMatchObject({
      status: "failed",
      progressJson: {
        retryCount: 3,
        jobPhase: "failed_after_stale_recovery",
        staleRecoveryReason: "stale_running_retry_exhausted"
      },
      lastError: "stale_running_retry_exhausted"
    });
    expect(result.failed[1]).toMatchObject({
      status: "failed",
      progressJson: {
        retryCount: 1,
        jobPhase: "failed_after_stale_recovery",
        staleRecoveryReason: "stale_running_incoming_retry_exhausted"
      },
      lastError: "stale_running_incoming_retry_exhausted"
    });
  });

  it("falls back to started or created timestamps for malformed heartbeat text without unsafe casts", async () => {
    const { db, queries } = createRecoveryDb([
      forensicJobRow({
        id: "malformed-old-started-job-1",
        kind: "address_deep_check",
        started_at: new Date("2026-06-03T00:00:00.000Z"),
        progress_json: {
          jobHeartbeatAt: "not-a-date",
          jobPhase: "address_deep_trace"
        }
      }),
      forensicJobRow({
        id: "malformed-old-created-job-1",
        kind: "where_is_money_check",
        started_at: null,
        created_at: new Date("2026-06-03T00:00:00.000Z"),
        progress_json: {
          jobHeartbeatAt: "2026-99-99T00:00:00.000Z",
          jobPhase: "money_origin_trace"
        }
      }),
      forensicJobRow({
        id: "malformed-fresh-job-1",
        kind: "address_deep_check",
        started_at: new Date("2026-06-03T00:45:00.000Z"),
        created_at: new Date("2026-06-03T00:40:00.000Z"),
        progress_json: {
          jobHeartbeatAt: "not-a-date",
          jobPhase: "address_deep_trace"
        }
      })
    ]);

    const result = await recoverStaleForensicCheckJobs(db, {
      staleRunningBefore: new Date("2026-06-03T00:30:00.000Z"),
      maxRetries: 3,
      recoveredAt: new Date("2026-06-03T01:00:00.000Z")
    });

    expect(result.failed).toEqual([]);
    expect(result.requeued.map((job) => job.id)).toEqual(["malformed-old-started-job-1", "malformed-old-created-job-1"]);
    expect(queries[0].sql).toContain("runtime.has_iso_heartbeat");
    expect(queries[0].sql).toContain("~ '^[0-9]{4}-");
    expect(queries[0].sql).not.toContain("jobHeartbeatAt')::timestamptz");
  });
});

const PLAN3_REPOSITORY_DATABASE_URL = process.env.PLAN3_TEST_DATABASE_URL
  ?? "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3";
const requirePlan3Postgres = process.env.REQUIRE_PLAN3_POSTGRES === "1";
const plan3RepositoryDatabaseUrl = process.env.TEST_DATABASE_URL ?? PLAN3_REPOSITORY_DATABASE_URL;
const plan3RepositoryUrl = new URL(PLAN3_REPOSITORY_DATABASE_URL);
if (requirePlan3Postgres && (plan3RepositoryDatabaseUrl !== PLAN3_REPOSITORY_DATABASE_URL
    || plan3RepositoryUrl.hostname !== "127.0.0.1"
    || plan3RepositoryUrl.pathname !== "/tron_watch_plan3"
    || plan3RepositoryUrl.port === "55999")) {
  throw new Error("Plan 3 repository test database binding is invalid");
}
const plan3PostgresDescribe = requirePlan3Postgres ? describe : describe.skip;
const PLAN3_RECONCILIATION_NOW = new Date("2026-07-15T12:00:00.000Z");

async function installRepositoryWaitSchema(db: pg.Pool): Promise<void> {
  await db.query(`
    create table forensic_check_jobs (
      id text primary key,
      kind text not null check (kind in ('address_deep_check', 'where_is_money_check', 'incoming_deposit_check')),
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
      id text primary key default md5(random()::text || clock_timestamp()::text),
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
  `);
}

async function insertRepositoryWaitParent(
  db: pg.Pool,
  input: {
    id: string;
    status?: "queued" | "running" | "partial" | "completed" | "failed" | "cancelled";
    kind?: "where_is_money_check" | "incoming_deposit_check";
  }
): Promise<void> {
  await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end,
       progress_json, result_json, started_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $10)`,
    [
      input.id,
      input.kind ?? "where_is_money_check",
      `TSubject-${input.id}`,
      input.status ?? "queued",
      new Date("2026-07-01T00:00:00.000Z"),
      PLAN3_RECONCILIATION_NOW,
      JSON.stringify({
        jobPhase: "waiting_for_targeted_index",
        preservedLegacyField: { keep: true }
      }),
      JSON.stringify({ fixtureId: input.id }),
      PLAN3_RECONCILIATION_NOW,
      new Date(`2026-07-15T11:${String(10 + input.id.length).padStart(2, "0")}:00.000Z`)
    ]
  );
}

async function insertRepositoryWaitStatuses(
  db: pg.Pool,
  jobId: string,
  statuses: Array<"waiting" | "ready" | "terminal" | "cancelled">,
  requiredFor: "where_hop" | "incoming_hop" = "where_hop"
): Promise<void> {
  for (const [index, status] of statuses.entries()) {
    const targetTimestamp = new Date(PLAN3_RECONCILIATION_NOW.getTime() - index * 1_000);
    await db.query(
      `insert into forensic_job_waits (
         id, job_id, wait_type, address, coverage_mode,
         target_timestamp_ms, target_timestamp, required_for, status,
         request_kind, window_start_timestamp_ms, window_end_timestamp_ms,
         window_end_timestamp, candidate_tx_hash
       ) values (
         $1, $2, 'targeted_usdt_history', $3, 'targeted',
         $4, $5, $6, $7, 'broad_targeted', 0, $4, $5, ''
       )`,
      [
        `${jobId}-wait-${index}`,
        jobId,
        `THop-${jobId}-${index}`,
        targetTimestamp.getTime(),
        targetTimestamp,
        requiredFor,
        status
      ]
    );
  }
}

async function repositoryWaitParentRow(db: pg.Pool, id: string): Promise<Record<string, unknown>> {
  const result = await db.query(
    `select id, status, progress_json, result_json, last_error, started_at, completed_at, updated_at
     from forensic_check_jobs where id = $1`,
    [id]
  );
  return result.rows[0];
}

function repositoryPendingDelivery(
  jobId: string,
  kind: "where_is_money_check" | "address_deep_check" | "incoming_deposit_check",
  effect: ForensicTelegramDeliveryV1["effect"] = null
): ForensicTelegramDeliveryV1 {
  return createPendingForensicTelegramDelivery({
    jobId,
    kind,
    payload: {
      version: "telegram-message-payload-v1",
      chatId: `chat-${jobId}`,
      text: `<b>${kind}</b> ${jobId}`,
      parseMode: "HTML",
      replyMarkup: { inline_keyboard: [[{ text: "Open", callback_data: `job:${jobId}` }]] }
    },
    effect
  });
}

const REPOSITORY_RECOVERED_INTENT = {
  version: "recovered-forensic-delivery-intent-v1",
  kind: "stale_failure",
  createdAt: PLAN3_RECONCILIATION_NOW.toISOString(),
  reasonCode: "stale_running_retry_exhausted",
  preparationStatus: "pending",
  preparationAttemptCount: 0,
  lastPreparationAttemptAt: null,
  nextPreparationAttemptAt: null,
  lastPreparationError: null
} as const satisfies RecoveredForensicDeliveryIntentV1;

function repositoryRecoveredAttachment(
  jobId: string,
  kind: "where_is_money_check" | "address_deep_check" | "incoming_deposit_check",
  effect: ForensicTelegramDeliveryV1["effect"] = null
) {
  return {
    jobId,
    intentCreatedAt: REPOSITORY_RECOVERED_INTENT.createdAt,
    expectedPreparationAttemptCount: 0,
    delivery: repositoryPendingDelivery(jobId, kind, effect)
  };
}

async function insertRepositoryDeliveryJob(
  db: pg.Pool,
  input: {
    id: string;
    kind?: "where_is_money_check" | "address_deep_check" | "incoming_deposit_check";
    status?: "queued" | "running" | "partial" | "completed" | "failed" | "cancelled";
    progressJson?: Record<string, unknown>;
    resultJson?: Record<string, unknown>;
    chatId?: string | null;
  }
): Promise<void> {
  const status = input.status ?? "running";
  await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end, chat_id,
       progress_json, result_json, raw_evidence_ids, observation_ids,
       started_at, completed_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
       $10::jsonb, $11::jsonb, $12, $13, $14, $14)`,
    [
      input.id,
      input.kind ?? "where_is_money_check",
      `subject-${input.id}`,
      status,
      new Date("2026-07-01T00:00:00.000Z"),
      PLAN3_RECONCILIATION_NOW,
      input.chatId === undefined ? `chat-${input.id}` : input.chatId,
      JSON.stringify(input.progressJson ?? {}),
      JSON.stringify(input.resultJson ?? {}),
      JSON.stringify([]),
      JSON.stringify([]),
      status === "running" ? PLAN3_RECONCILIATION_NOW : null,
      ["partial", "completed", "failed"].includes(status) ? PLAN3_RECONCILIATION_NOW : null,
      new Date("2026-07-15T11:00:00.000Z")
    ]
  );
}

function repositoryCompletionInput(
  id: string,
  kind: "where_is_money_check" | "address_deep_check" | "incoming_deposit_check" = "where_is_money_check",
  effect: ForensicTelegramDeliveryV1["effect"] = null
) {
  return {
    id,
    claimStartedAt: PLAN3_RECONCILIATION_NOW,
    status: "completed" as const,
    progressJson: {
      jobPhase: "completed",
      preserved: { parsed: true },
      telegramDelivery: repositoryPendingDelivery(id, kind, effect)
    },
    resultJson: {
      version: "forensic-result-v3",
      score: 61,
      coverage: { selected: 1, traced: 1 },
      evidence: [{ id: `evidence-${id}` }]
    },
    rawEvidenceIds: [`raw-${id}`],
    observationIds: [`observation-${id}`],
    lastError: null
  };
}

function repositorySettlement(
  claim: DeliveryClaim,
  settledAt: Date,
  outcome: "sent" | "retryable" | "failed",
  errorCode: TelegramDeliveryErrorCode | null = null
) {
  return {
    jobId: claim.jobId,
    messageFingerprint: claim.messageFingerprint,
    attempt: claim.claim.attempt,
    claimToken: claim.claim.token,
    settledAt,
    outcome,
    errorCode
  };
}

async function repositoryDeliveryRow(db: pg.Pool, id: string): Promise<Record<string, unknown>> {
  const result = await db.query(
    `select status, progress_json, result_json, raw_evidence_ids, observation_ids
     from forensic_check_jobs where id = $1`,
    [id]
  );
  return result.rows[0];
}

async function insertRepositoryObservedAlert(
  db: pg.Pool,
  input: { walletId: string; txHash: string; status?: "sending" | "analyzing" | "failed" }
): Promise<void> {
  await db.query(
    "insert into telegram_users (telegram_user_id, username) values ($1, $2)",
    [`user-${input.walletId}`, `user_${input.walletId}`]
  );
  await db.query(
    `insert into watched_wallets (id, telegram_user_id, address)
     values ($1, $2, $3)`,
    [input.walletId, `user-${input.walletId}`, `wallet-${input.walletId}`]
  );
  await db.query(
    `insert into observed_transactions (
       tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp,
       user_alert_status, user_alert_updated_at
     ) values ($1, $2, $3, $4, 'USDT', '1000000', $5, $6, $5)`,
    [
      input.txHash,
      input.walletId,
      `sender-${input.txHash}`,
      `receiver-${input.txHash}`,
      PLAN3_RECONCILIATION_NOW,
      input.status ?? "sending"
    ]
  );
}

async function waitForBlockedWaitUpsert(db: pg.Pool): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await db.query(
      `select count(*)::integer as count
       from pg_stat_activity
       where pid <> pg_backend_pid()
         and datname = current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query ilike '%forensic_job_waits%'`
    );
    if ((result.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for blocked forensic wait upsert");
}

async function waitForBlockedClaimRecovery(db: pg.Pool): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await db.query(
      `select count(*)::integer as count
       from pg_stat_activity
       where pid <> pg_backend_pid()
         and datname = current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query ilike '%with stale_jobs as%'`
    );
    if ((result.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for blocked forensic claim recovery");
}

async function withRepositoryWaitSchema(
  label: string,
  run: (db: pg.Pool) => Promise<void>
): Promise<void> {
  const schema = `plan3_repo_wait_${label}_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({
    connectionString: plan3RepositoryDatabaseUrl,
    application_name: `${schema}_admin`.slice(0, 63)
  });
  let db: pg.Pool | null = null;
  let primaryError: unknown;
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 repository database ${String(database.rows[0]?.name)}`);
    }
    await admin.query(`create schema "${schema}"`);
    db = new pg.Pool({
      connectionString: plan3RepositoryDatabaseUrl,
      application_name: `${schema}_client`.slice(0, 63),
      options: `-c search_path=${schema}`
    });
    await installRepositoryWaitSchema(db);
    await run(db);
  } catch (error) {
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
      throw new Error(`Plan 3 repository schema cleanup failed: ${schema}`);
    }
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `Plan 3 repository scenario and cleanup failed: ${schema}`
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Plan 3 repository cleanup failed: ${schema}`);
  }
}

plan3PostgresDescribe("forensic wait reconciliation PostgreSQL races", () => {
  it("reconciles all-ready waits once and permits exactly one subsequent claim", async () => {
    await withRepositoryWaitSchema("all_ready", async (db) => {
      const id = "where-all-ready";
      await insertRepositoryWaitParent(db, { id });
      await insertRepositoryWaitStatuses(db, id, ["ready", "ready", "ready"]);
      const reconcile = await loadWaitReconciler();

      const reconciliations = (await Promise.all([
        reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 }),
        reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 })
      ])).flat();
      expect(reconciliations).toEqual([{
        parentJobId: id,
        readyCount: 3,
        terminalCount: 0,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_ready",
        diagnosticCode: null
      }]);
      await expect(reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 }))
        .resolves.toEqual([]);

      const row = await repositoryWaitParentRow(db, id);
      expect(row).toMatchObject({
        status: "queued",
        result_json: { fixtureId: id },
        progress_json: {
          jobPhase: "reading_local_index",
          preservedLegacyField: { keep: true },
          waitReconciliation: {
            parentJobId: id,
            readyCount: 3,
            terminalCount: 0,
            cancelledCount: 0,
            waitingCount: 0,
            outcome: "resume_ready",
            diagnosticCode: null
          }
        }
      });
      expect(buildForensicRuntimeContractProjection(row.progress_json).waitReconciliation)
        .toEqual(reconciliations[0]);

      const claims = await Promise.all([
        claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] }),
        claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] })
      ]);
      expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
      expect(claims.find((claim) => claim !== null)).toMatchObject({ id, status: "running" });
    });
  });

  it.each(["insert", "reset"] as const)(
    "serializes reconciliation with concurrent child %s",
    async (mode) => {
      await withRepositoryWaitSchema(`child_${mode}`, async (db) => {
        const id = `where-child-${mode}`;
        await insertRepositoryWaitParent(db, { id });
        await insertRepositoryWaitStatuses(
          db,
          id,
          mode === "reset" ? ["ready", "ready"] : ["ready"]
        );
        const targetTimestamp = new Date(PLAN3_RECONCILIATION_NOW.getTime() - 1_000);
        const gateKey = 8_301_003;
        await db.query(`
          create function hold_forensic_wait_upsert() returns trigger
          language plpgsql as $$
          begin
            perform pg_advisory_xact_lock(${gateKey});
            return new;
          end
          $$;
          create trigger hold_forensic_wait_upsert_trigger
          after insert or update on forensic_job_waits
          for each row execute function hold_forensic_wait_upsert();
        `);
        const gate = await db.connect();
        await gate.query("select pg_advisory_lock($1)", [gateKey]);
        let upsertError: unknown;
        const upsertPromise = upsertForensicJobWait(db, {
          jobId: id,
          claimStartedAt: PLAN3_RECONCILIATION_NOW,
          address: `THop-${id}-1`,
          targetTimestamp,
          requiredFor: "where_hop"
        }).catch((error) => {
          upsertError = error;
        });

        try {
          await waitForBlockedWaitUpsert(db);
          const reconcile = await loadWaitReconciler();
          await expect(reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 }))
            .resolves.toEqual([]);
        } finally {
          await gate.query("select pg_advisory_unlock($1)", [gateKey]);
          gate.release();
          await upsertPromise;
        }
        expect(upsertError).toBeUndefined();

        const reconcile = await loadWaitReconciler();
        const afterChild = await reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 });
        expect(afterChild).toEqual([expect.objectContaining({
          parentJobId: id,
          outcome: "unchanged",
          waitingCount: 1
        })]);
        expect(await repositoryWaitParentRow(db, id)).toMatchObject({
          status: "queued",
          progress_json: { jobPhase: "waiting_for_targeted_index" }
        });
      });
    }
  );

  it("rejects child registration after the parent leaves its waiting phase", async () => {
    await withRepositoryWaitSchema("late_child", async (db) => {
      const id = "where-late-child";
      await insertRepositoryWaitParent(db, { id });
      await insertRepositoryWaitStatuses(db, id, ["ready"]);
      const reconcile = await loadWaitReconciler();
      await expect(reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 }))
        .resolves.toEqual([expect.objectContaining({ parentJobId: id, outcome: "resume_ready" })]);

      await expect(upsertForensicJobWait(db, {
        jobId: id,
        claimStartedAt: PLAN3_RECONCILIATION_NOW,
        address: `THop-${id}-late`,
        targetTimestamp: new Date(PLAN3_RECONCILIATION_NOW.getTime() - 1_000),
        requiredFor: "where_hop"
      })).resolves.toBe(false);
      const waits = await db.query(
        `select status, count(*)::integer as count
         from forensic_job_waits where job_id = $1 group by status order by status`,
        [id]
      );
      expect(waits.rows).toEqual([{ status: "ready", count: 1 }]);
    });
  });

  it("allows first wait registration while running and never reopens final parents", async () => {
    await withRepositoryWaitSchema("wait_parent_fence", async (db) => {
      const runningId = "where-running-registration";
      await insertRepositoryWaitParent(db, { id: runningId, status: "running" });
      await expect(upsertForensicJobWait(db, {
        jobId: runningId,
        claimStartedAt: PLAN3_RECONCILIATION_NOW,
        address: `THop-${runningId}`,
        targetTimestamp: new Date(PLAN3_RECONCILIATION_NOW.getTime() - 1_000),
        requiredFor: "where_hop"
      })).resolves.toBe(true);
      const runningWaits = await db.query(
        "select status from forensic_job_waits where job_id = $1",
        [runningId]
      );
      expect(runningWaits.rows).toEqual([{ status: "waiting" }]);

      for (const status of ["partial", "completed", "failed", "cancelled"] as const) {
        const id = `where-final-registration-${status}`;
        await insertRepositoryWaitParent(db, { id, status });
        await expect(upsertForensicJobWait(db, {
          jobId: id,
          claimStartedAt: PLAN3_RECONCILIATION_NOW,
          address: `THop-${id}`,
          targetTimestamp: new Date(PLAN3_RECONCILIATION_NOW.getTime() - 1_000),
          requiredFor: "where_hop"
        })).resolves.toBe(false);
      }
      const finalWaits = await db.query(
        "select count(*)::integer as count from forensic_job_waits where job_id like 'where-final-registration-%'"
      );
      expect(finalWaits.rows[0]?.count).toBe(0);
    });
  });

  it("rotates unchanged parents so an actionable parent beyond the limit is reached", async () => {
    await withRepositoryWaitSchema("bounded_fairness", async (db) => {
      const blockerIds = ["where-a-blocker", "where-b-blocker"];
      const actionableId = "where-z-actionable";
      for (const [index, id] of [...blockerIds, actionableId].entries()) {
        await insertRepositoryWaitParent(db, { id });
        await insertRepositoryWaitStatuses(db, id, [index < blockerIds.length ? "waiting" : "ready"]);
        const createdAt = new Date(`2026-07-15T10:0${index}:00.000Z`);
        await db.query(
          "update forensic_check_jobs set created_at = $2, updated_at = $2 where id = $1",
          [id, createdAt]
        );
      }
      const reconcile = await loadWaitReconciler();

      const first = await reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 2 });
      expect(first).toHaveLength(2);
      expect(first.every((item) => item.outcome === "unchanged")).toBe(true);

      const second = await reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 2 });
      expect(second).toContainEqual(expect.objectContaining({
        parentJobId: actionableId,
        outcome: "resume_ready"
      }));
      expect(await repositoryWaitParentRow(db, actionableId)).toMatchObject({
        progress_json: { jobPhase: "reading_local_index" }
      });
    });
  });

  it("reconciles mixed ready-terminal waits through provider-limited phase", async () => {
    await withRepositoryWaitSchema("mixed_terminal", async (db) => {
      const id = "incoming-mixed-terminal";
      await insertRepositoryWaitParent(db, { id, kind: "incoming_deposit_check" });
      await insertRepositoryWaitStatuses(db, id, ["ready", "terminal", "ready"], "incoming_hop");
      const reconcile = await loadWaitReconciler();

      await expect(reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: id,
        readyCount: 2,
        terminalCount: 1,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_terminal",
        diagnosticCode: null
      }]);
      expect(await repositoryWaitParentRow(db, id)).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "provider_limited",
          waitReconciliation: { outcome: "resume_terminal", terminalCount: 1 }
        }
      });
    });
  });

  it("keeps a parent waiting when any child wait is waiting", async () => {
    await withRepositoryWaitSchema("still_waiting", async (db) => {
      const id = "where-still-waiting";
      await insertRepositoryWaitParent(db, { id });
      await insertRepositoryWaitStatuses(db, id, ["ready", "terminal", "waiting"]);
      const reconcile = await loadWaitReconciler();

      await expect(reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 })).resolves.toEqual([{
        parentJobId: id,
        readyCount: 1,
        terminalCount: 1,
        cancelledCount: 0,
        waitingCount: 1,
        outcome: "unchanged",
        diagnosticCode: null
      }]);
      expect(await repositoryWaitParentRow(db, id)).toMatchObject({
        status: "queued",
        progress_json: {
          jobPhase: "waiting_for_targeted_index",
          waitReconciliation: { outcome: "unchanged", waitingCount: 1 }
        }
      });
      await expect(claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] }))
        .resolves.toBeNull();
    });
  });

  it("diagnoses cancelled and missing wait sets without resuming either parent", async () => {
    await withRepositoryWaitSchema("contradictory", async (db) => {
      const cancelledId = "where-cancelled-wait";
      const missingId = "where-missing-waits";
      await insertRepositoryWaitParent(db, { id: cancelledId });
      await insertRepositoryWaitStatuses(db, cancelledId, ["ready", "cancelled", "ready"]);
      await insertRepositoryWaitParent(db, { id: missingId });
      const reconcile = await loadWaitReconciler();

      const reconciliations = await reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 });
      expect(reconciliations).toHaveLength(2);
      expect(reconciliations).toEqual(expect.arrayContaining([
        {
          parentJobId: cancelledId,
          readyCount: 2,
          terminalCount: 0,
          cancelledCount: 1,
          waitingCount: 0,
          outcome: "contradictory",
          diagnosticCode: "cancelled_wait_present"
        },
        {
          parentJobId: missingId,
          readyCount: 0,
          terminalCount: 0,
          cancelledCount: 0,
          waitingCount: 0,
          outcome: "contradictory",
          diagnosticCode: "missing_wait_rows"
        }
      ]));
      for (const id of [cancelledId, missingId]) {
        expect(await repositoryWaitParentRow(db, id)).toMatchObject({
          status: "queued",
          progress_json: { jobPhase: "waiting_for_targeted_index" }
        });
      }
      await expect(claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] }))
        .resolves.toBeNull();
    });
  });

  it("does not rewrite running or final parent rows", async () => {
    await withRepositoryWaitSchema("parent_guards", async (db) => {
      const statuses = ["running", "partial", "completed", "failed", "cancelled"] as const;
      const before = new Map<string, Record<string, unknown>>();
      for (const status of statuses) {
        const id = `where-parent-${status}`;
        await insertRepositoryWaitParent(db, { id, status });
        await insertRepositoryWaitStatuses(db, id, ["ready", "ready"]);
        before.set(id, await repositoryWaitParentRow(db, id));
      }
      const reconcile = await loadWaitReconciler();

      await expect(reconcile(db, { now: PLAN3_RECONCILIATION_NOW, limit: 10 }))
        .resolves.toEqual([]);
      for (const status of statuses) {
        const id = `where-parent-${status}`;
        expect(await repositoryWaitParentRow(db, id)).toEqual(before.get(id));
      }
    });
  });
});

plan3PostgresDescribe("forensic Telegram delivery PostgreSQL repository", () => {
  it("fences every stale worker mutation to the exact claim generation", async () => {
    await withRepositoryWaitSchema("claim_generation_race", async (db) => {
      const id = "claim-generation-race";
      await insertRepositoryDeliveryJob(db, { id, status: "queued" });
      await db.query(
        `update forensic_check_jobs
         set progress_json = progress_json || '{"strictProvenanceBenchmark":true}'::jsonb
         where id = $1`,
        [id]
      );
      const workerA = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      expect(workerA?.startedAt).not.toBeNull();
      const tokenA = workerA!.startedAt!;

      await expect(recoverStaleForensicCheckJobs(db, {
        staleRunningBefore: tokenA,
        recoveredAt: new Date(tokenA.getTime() + 1),
        maxRetries: 3,
        limit: 10
      })).resolves.toEqual({ requeued: [], failed: [] });

      await db.query(
        `update forensic_check_jobs
         set progress_json = progress_json || jsonb_build_object('jobHeartbeatAt', $2::text)
         where id = $1`,
        [id, new Date(tokenA.getTime() - 60_000).toISOString()]
      );
      const recovered = await recoverStaleForensicCheckJobs(db, {
        staleRunningBefore: new Date(tokenA.getTime() - 30_000),
        recoveredAt: new Date(tokenA.getTime() + 2),
        maxRetries: 3,
        limit: 10
      });
      expect(recovered.requeued).toHaveLength(1);
      expect(recovered.requeued[0].startedAt?.toISOString()).toBe(tokenA.toISOString());

      const workerB = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      const tokenB = workerB!.startedAt!;
      expect(tokenB.toISOString()).not.toBe(tokenA.toISOString());

      await expect(updateForensicCheckJobProgress(db, {
        id, claimStartedAt: tokenA, progressJson: { worker: "A" }
      })).resolves.toBe(false);
      await expect(upsertForensicJobWait(db, {
        jobId: id,
        claimStartedAt: tokenA,
        address: "THop111111111111111111111111111111111",
        targetTimestamp: tokenA,
        requiredFor: "where_hop"
      })).resolves.toBe(false);
      await expect(releaseForensicCheckJobToWaiting(db, {
        id, claimStartedAt: tokenA, progressJson: { jobPhase: "waiting_for_targeted_index" }
      })).resolves.toBe(false);
      await expect(completeForensicCheckJob(db, {
        ...repositoryCompletionInput(id),
        claimStartedAt: tokenA
      })).resolves.toBe(false);
      await expect(completeForensicCheckJob(db, {
        ...repositoryCompletionInput(id),
        claimStartedAt: tokenA,
        status: "failed",
        lastError: "worker_a_failure"
      })).resolves.toBe(false);
      await expect(queueClaimedTronAddressUsdtIndexState(db, {
        jobId: id,
        claimStartedAt: tokenA,
        address: "THop111111111111111111111111111111111",
        coverageMode: "targeted",
        targetTimestamp: tokenA,
        queuedReason: "where_is_money_hop",
        requestedByJobId: id
      })).resolves.toBe(false);
      await expect(saveClaimedRiskEvaluationEvidence(db, {
        jobId: id,
        claimStartedAt: tokenA,
        rawEvidence: [],
        observations: []
      })).resolves.toBe(false);
      await expect(upsertClaimedAddressLabelAssertion(db, {
        jobId: id,
        claimStartedAt: tokenA,
        id: "stale-derived-label",
        chain: "tron",
        address: "THop111111111111111111111111111111111",
        label: "needs_review",
        category: "needs_review",
        confidence: "medium",
        severity: "medium",
        status: "active",
        sourceName: "forensic_route_search"
      })).resolves.toBe(false);
      await expect(recordClaimedObservedTransactionRisk(db, {
        jobId: id,
        claimStartedAt: tokenA,
        txHash: "stale-risk-tx",
        watchedWalletId: "stale-wallet",
        report: {
          subjectAddress: "THop111111111111111111111111111111111",
          level: "LOW",
          score: 0,
          reasons: []
        }
      })).resolves.toBe(false);
      await expect(patchStrictBenchmarkProgress(db, {
        id,
        claimStartedAt: tokenA,
        patchJson: { strictBenchmarkMetrics: { stages: { apiMs: 1 } } }
      })).resolves.toBe(false);
      await expect(patchStrictBenchmarkProgress(db, {
        id,
        claimStartedAt: tokenB,
        patchJson: { strictBenchmarkMetrics: { stages: { apiMs: 2 } } }
      })).resolves.toBe(true);

      await expect(completeForensicCheckJob(db, {
        ...repositoryCompletionInput(id),
        claimStartedAt: tokenB
      })).resolves.toBe(true);
      await expect(completeForensicCheckJob(db, {
        ...repositoryCompletionInput(id),
        claimStartedAt: tokenB
      })).resolves.toBe(false);
      const deliveries = await db.query(
        `select count(*)::integer as count from forensic_check_jobs
         where id = $1 and status = 'completed'
           and progress_json #>> '{telegramDelivery,state,status}' = 'pending'`,
        [id]
      );
      expect(deliveries.rows[0]?.count).toBe(1);
    });
  });

  it("holds recovery behind a live FOR SHARE claim guard and rejects worker A after worker B reclaims", async () => {
    await withRepositoryWaitSchema("claim_for_share_race", async (db) => {
      const id = "claim-for-share-race";
      await db.query("create table claim_side_effects (worker text primary key)");
      await insertRepositoryDeliveryJob(db, { id, status: "queued" });
      const workerA = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      const tokenA = workerA!.startedAt!;
      await db.query(
        `update forensic_check_jobs
         set progress_json = progress_json || jsonb_build_object('jobHeartbeatAt', $2::text)
         where id = $1`,
        [id, new Date(tokenA.getTime() - 60_000).toISOString()]
      );

      let enterGuard!: () => void;
      const guardEntered = new Promise<void>((resolve) => { enterGuard = resolve; });
      let releaseGuard!: () => void;
      const guardRelease = new Promise<void>((resolve) => { releaseGuard = resolve; });
      const guardedWrite = runClaimedForensicJobTransaction(db, {
        jobId: id,
        claimStartedAt: tokenA
      }, async (client) => {
        enterGuard();
        await guardRelease;
        await client.query("insert into claim_side_effects (worker) values ('A')");
        return "written";
      });
      await guardEntered;

      let recoverySettled = false;
      const recovery = recoverStaleForensicCheckJobs(db, {
        staleRunningBefore: new Date(tokenA.getTime() - 30_000),
        recoveredAt: new Date(tokenA.getTime() + 1),
        maxRetries: 3,
        limit: 10
      }).finally(() => { recoverySettled = true; });
      try {
        await waitForBlockedClaimRecovery(db);
        expect(recoverySettled).toBe(false);
      } finally {
        releaseGuard();
      }

      await expect(guardedWrite).resolves.toEqual({ claimed: true, value: "written" });
      await expect(recovery).resolves.toMatchObject({ requeued: [expect.objectContaining({ id })] });
      await expect(db.query("select worker from claim_side_effects order by worker"))
        .resolves.toMatchObject({ rows: [{ worker: "A" }] });

      const workerB = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      expect(workerB!.startedAt!.toISOString()).not.toBe(tokenA.toISOString());
      await expect(runClaimedForensicJobTransaction(db, {
        jobId: id,
        claimStartedAt: tokenA
      }, async (client) => {
        await client.query("insert into claim_side_effects (worker) values ('stale-A')");
      })).resolves.toEqual({ claimed: false });
      await expect(db.query("select worker from claim_side_effects order by worker"))
        .resolves.toMatchObject({ rows: [{ worker: "A" }] });
    });
  });

  it("writes non-empty claimed transfers on the outer claim transaction and rolls them back with it", async () => {
    await withRepositoryWaitSchema("claimed_transfer_transaction", async (db) => {
      await db.query(`create table tron_usdt_transfers (
        transfer_id text primary key,
        provider text not null,
        tx_hash text not null,
        block_number bigint not null,
        block_timestamp timestamptz not null,
        event_index integer not null,
        provider_row_ordinal_in_tx integer,
        from_address text not null,
        to_address text not null,
        amount_raw text not null,
        method text not null,
        event_type text,
        caller_address text,
        contract_ret text,
        final_result text,
        reverted boolean not null,
        risk_transaction boolean not null,
        confirmed boolean not null,
        updated_at timestamptz not null default now()
      )`);
      const id = "claimed-transfer-job";
      await insertRepositoryDeliveryJob(db, { id, status: "queued" });
      const workerA = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      const tokenA = workerA!.startedAt!;
      const transfer = (txHash: string) => ({
        txHash,
        blockNumber: 101,
        blockTimestamp: new Date("2026-07-26T00:00:00.000Z"),
        eventIndex: 0,
        fromAddress: "TFrom",
        toAddress: "TTo",
        amountRaw: "1000000",
        method: "transfer" as const,
        callerAddress: null,
        contractRet: "SUCCESS",
        confirmed: true
      });

      await expect(runClaimedForensicJobTransaction(db, {
        jobId: id,
        claimStartedAt: tokenA
      }, async (client) => {
        await upsertIndexedTronUsdtTransfersWithClient(client, [transfer("tx-current-A")]);
        await client.query(
          "update forensic_check_jobs set progress_json = progress_json || '{\"inlineIndex\":\"written\"}'::jsonb where id = $1",
          [id]
        );
      })).resolves.toEqual({ claimed: true, value: undefined });
      await expect(db.query("select tx_hash from tron_usdt_transfers order by tx_hash"))
        .resolves.toMatchObject({ rows: [{ tx_hash: "tx-current-A" }] });

      await db.query(
        `update forensic_check_jobs
         set progress_json = progress_json || jsonb_build_object('jobHeartbeatAt', $2::text)
         where id = $1`,
        [id, new Date(tokenA.getTime() - 60_000).toISOString()]
      );
      await recoverStaleForensicCheckJobs(db, {
        staleRunningBefore: new Date(tokenA.getTime() - 30_000),
        recoveredAt: new Date(tokenA.getTime() + 1),
        maxRetries: 3,
        limit: 10
      });
      const workerB = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      const tokenB = workerB!.startedAt!;

      await expect(runClaimedForensicJobTransaction(db, {
        jobId: id,
        claimStartedAt: tokenA
      }, (client) => upsertIndexedTronUsdtTransfersWithClient(client, [transfer("tx-stale-A")])))
        .resolves.toEqual({ claimed: false });

      await expect(runClaimedForensicJobTransaction(db, {
        jobId: id,
        claimStartedAt: tokenB
      }, async (client) => {
        await upsertIndexedTronUsdtTransfersWithClient(client, [transfer("tx-rollback-B")]);
        await client.query(
          "update forensic_check_jobs set progress_json = progress_json || '{\"inlineIndex\":\"rollback\"}'::jsonb where id = $1",
          [id]
        );
        throw new Error("injected_after_transfer_upsert");
      })).rejects.toThrow("injected_after_transfer_upsert");

      const persisted = await db.query(
        "select tx_hash from tron_usdt_transfers order by tx_hash"
      );
      expect(persisted.rows).toEqual([{ tx_hash: "tx-current-A" }]);
      const progress = await db.query("select progress_json from forensic_check_jobs where id = $1", [id]);
      expect(progress.rows[0]?.progress_json.inlineIndex).toBe("written");
    });
  });

  it("claims deterministic ties and normalizes a prior microsecond token for JavaScript CAS", async () => {
    await withRepositoryWaitSchema("claim_order_and_clock", async (db) => {
      for (const id of ["tie-b", "tie-a"]) {
        await insertRepositoryDeliveryJob(db, { id, status: "queued" });
      }
      await db.query(
        `update forensic_check_jobs set priority = 777, created_at = $1 where id in ('tie-a', 'tie-b')`,
        [PLAN3_RECONCILIATION_NOW]
      );
      await expect(claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] }))
        .resolves.toMatchObject({ id: "tie-a" });

      await insertRepositoryDeliveryJob(db, { id: "microsecond-token", status: "queued" });
      await db.query(
        `update forensic_check_jobs
         set priority = 999,
           started_at = clock_timestamp() + interval '1 day' + interval '0.456 milliseconds'
         where id = 'microsecond-token'`
      );
      const expected = await db.query(
        `select date_trunc('milliseconds', started_at) + interval '1 millisecond' as token
         from forensic_check_jobs where id = 'microsecond-token'`
      );
      const claimed = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
      expect(claimed?.startedAt?.toISOString()).toBe((expected.rows[0].token as Date).toISOString());
      await expect(updateForensicCheckJobProgress(db, {
        id: claimed!.id,
        claimStartedAt: claimed!.startedAt!,
        progressJson: { roundTrip: true }
      })).resolves.toBe(true);
    });
  });

  it("fences completion and claims one bounded lease through attempt-four exhaustion", async () => {
    await withRepositoryWaitSchema("delivery_claim", async (db) => {
      const repository = await loadDeliveryRepository();
      await insertRepositoryDeliveryJob(db, { id: "lost-cas", status: "queued" });
      const lostBefore = await repositoryDeliveryRow(db, "lost-cas");
      await expect(completeForensicCheckJob(db, repositoryCompletionInput("lost-cas")))
        .resolves.toBe(false);
      expect(await repositoryDeliveryRow(db, "lost-cas")).toEqual(lostBefore);
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      })).resolves.toBeNull();

      await insertRepositoryDeliveryJob(db, { id: "invalid-envelope" });
      const invalid = repositoryCompletionInput("invalid-envelope");
      const invalidDelivery = invalid.progressJson.telegramDelivery;
      invalidDelivery.state.messageFingerprint = "0".repeat(64);
      await expect(completeForensicCheckJob(db, invalid)).rejects.toThrow(/delivery/i);
      expect(await repositoryDeliveryRow(db, "invalid-envelope")).toMatchObject({ status: "running" });

      await insertRepositoryDeliveryJob(db, { id: "no-chat", chatId: null });
      await expect(completeForensicCheckJob(db, {
        ...repositoryCompletionInput("no-chat"),
        progressJson: { jobPhase: "completed" }
      })).resolves.toBe(true);

      const id = "lease-owner";
      await insertRepositoryDeliveryJob(db, { id });
      const completion = repositoryCompletionInput(id);
      await expect(completeForensicCheckJob(db, completion)).resolves.toBe(true);
      const baseline = await repositoryDeliveryRow(db, id);
      const concurrent = await Promise.all([
        repository.claimNextForensicTelegramDelivery(db, { now: PLAN3_RECONCILIATION_NOW }),
        repository.claimNextForensicTelegramDelivery(db, { now: PLAN3_RECONCILIATION_NOW })
      ]);
      const first = concurrent.filter((claim): claim is DeliveryClaim => claim !== null);
      expect(first).toHaveLength(1);
      expect(first[0].claim).toMatchObject({
        attempt: 1,
        claimedAt: PLAN3_RECONCILIATION_NOW.toISOString(),
        leaseExpiresAt: "2026-07-15T12:00:40.000Z"
      });
      expect(first[0].claim.token).toMatch(/^[A-Za-z0-9_-]{22,}$/);
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: new Date("2026-07-15T12:00:39.999Z")
      })).resolves.toBeNull();

      for (let attempt = 2; attempt <= 4; attempt += 1) {
        await expect(repository.claimNextForensicTelegramDelivery(db, {
          now: new Date(PLAN3_RECONCILIATION_NOW.getTime() + (attempt - 1) * 40_000)
        })).resolves.toMatchObject({ jobId: id, claim: { attempt } });
      }
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: new Date(PLAN3_RECONCILIATION_NOW.getTime() + 160_000)
      })).resolves.toBeNull();
      const exhausted = await repositoryDeliveryRow(db, id);
      expect((exhausted.progress_json as Record<string, unknown>).telegramDelivery).toMatchObject({
        state: {
          status: "failed",
          attemptCount: 4,
          lastError: "telegram_attempts_exhausted"
        },
        claim: null
      });
      expect(exhausted).toMatchObject({
        status: "completed",
        result_json: baseline.result_json,
        raw_evidence_ids: baseline.raw_evidence_ids,
        observation_ids: baseline.observation_ids
      });
    });
  });

  it("rejects an Incoming effect owned by another job without mutating either record", async () => {
    await withRepositoryWaitSchema("completion_effect_binding", async (db) => {
      const repository = await loadDeliveryRepository();
      await insertRepositoryObservedAlert(db, { walletId: "wallet-b", txHash: "tx-b" });
      await insertRepositoryDeliveryJob(db, {
        id: "job-a",
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: "wallet-a", depositTxHash: "tx-a" }
      });

      await expect(completeForensicCheckJob(
        db,
        repositoryCompletionInput("job-a", "incoming_deposit_check", {
          kind: "incoming_user_alert",
          watchedWalletId: "wallet-b",
          incomingTxHash: "tx-b"
        })
      )).resolves.toBe(false);

      expect(await repositoryDeliveryRow(db, "job-a")).toMatchObject({
        status: "running",
        progress_json: { watchedWalletId: "wallet-a", depositTxHash: "tx-a" }
      });
      expect((await repositoryDeliveryRow(db, "job-a")).progress_json).not.toHaveProperty(
        "telegramDelivery"
      );
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      })).resolves.toBeNull();
      await expect(db.query(
        `select user_alert_status, user_alert_last_error from observed_transactions
         where watched_wallet_id = $1 and tx_hash = $2`,
        ["wallet-b", "tx-b"]
      )).resolves.toMatchObject({
        rows: [{ user_alert_status: "sending", user_alert_last_error: null }]
      });
    });
  });

  it("rejects a delivery addressed to a chat other than the job owner", async () => {
    await withRepositoryWaitSchema("completion_chat_binding", async (db) => {
      await insertRepositoryDeliveryJob(db, { id: "wrong-chat", chatId: "owned-chat" });

      await expect(completeForensicCheckJob(
        db,
        repositoryCompletionInput("wrong-chat")
      )).resolves.toBe(false);

      expect(await repositoryDeliveryRow(db, "wrong-chat")).toMatchObject({
        status: "running",
        progress_json: {}
      });
    });
  });

  it("rejects a delivery payload when the owning job has no chat", async () => {
    await withRepositoryWaitSchema("completion_null_chat_binding", async (db) => {
      await insertRepositoryDeliveryJob(db, { id: "null-chat", chatId: null });

      await expect(completeForensicCheckJob(
        db,
        repositoryCompletionInput("null-chat")
      )).resolves.toBe(false);

      expect(await repositoryDeliveryRow(db, "null-chat")).toMatchObject({
        status: "running",
        progress_json: {}
      });
    });
  });

  it("accepts an Incoming delivery whose chat and effect match its persisted owner", async () => {
    await withRepositoryWaitSchema("completion_owner_binding", async (db) => {
      await insertRepositoryDeliveryJob(db, {
        id: "bound-owner",
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: "bound-wallet", depositTxHash: "bound-tx" }
      });

      await expect(completeForensicCheckJob(
        db,
        repositoryCompletionInput("bound-owner", "incoming_deposit_check", {
          kind: "incoming_user_alert",
          watchedWalletId: "bound-wallet",
          incomingTxHash: "bound-tx"
        })
      )).resolves.toBe(true);

      expect(await repositoryDeliveryRow(db, "bound-owner")).toMatchObject({
        status: "completed",
        progress_json: {
          telegramDelivery: {
            payload: { chatId: "chat-bound-owner" },
            effect: {
              kind: "incoming_user_alert",
              watchedWalletId: "bound-wallet",
              incomingTxHash: "bound-tx"
            }
          }
        }
      });
    });
  });

  it("fences superseded and sent settlements while preserving parsed result JSON", async () => {
    await withRepositoryWaitSchema("delivery_settle", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "settlement-owner";
      await insertRepositoryDeliveryJob(db, { id });
      await completeForensicCheckJob(db, repositoryCompletionInput(id));
      const baseline = await repositoryDeliveryRow(db, id);
      const first = (await repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      }))!;
      const reclaimedAt = new Date(PLAN3_RECONCILIATION_NOW.getTime() + 40_000);
      const second = (await repository.claimNextForensicTelegramDelivery(db, { now: reclaimedAt }))!;

      await expect(repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(first, reclaimedAt, "sent")
      )).resolves.toBe(false);
      await expect(repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(second, reclaimedAt, "sent")
      )).resolves.toBe(true);
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: new Date("2026-07-16T12:00:00.000Z")
      })).resolves.toBeNull();

      const settled = await repositoryDeliveryRow(db, id);
      expect((settled.progress_json as Record<string, unknown>).telegramDelivery).toMatchObject({
        state: {
          status: "sent",
          attemptCount: 2,
          sentAt: reclaimedAt.toISOString(),
          messageFingerprint: second.messageFingerprint
        },
        claim: null
      });
      expect(settled).toMatchObject({
        status: baseline.status,
        result_json: baseline.result_json,
        raw_evidence_ids: baseline.raw_evidence_ids,
        observation_ids: baseline.observation_ids
      });
    });
  });

  it("atomically settles Incoming effects and removes the rollback trigger in finally", async () => {
    await withRepositoryWaitSchema("incoming_effect", async (db) => {
      const repository = await loadDeliveryRepository();
      const walletId = "effect-wallet";
      const txHash = "effect-tx";
      const id = "effect-job";
      await insertRepositoryObservedAlert(db, { walletId, txHash });
      await insertRepositoryDeliveryJob(db, {
        id,
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: walletId, depositTxHash: txHash }
      });
      await completeForensicCheckJob(db, repositoryCompletionInput(id, "incoming_deposit_check", {
        kind: "incoming_user_alert",
        watchedWalletId: walletId,
        incomingTxHash: txHash
      }));
      const claim = (await repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      }))!;
      const before = await repositoryDeliveryRow(db, id);
      const trigger = "fail_incoming_effect_update";
      const triggerFunction = "raise_incoming_effect_update";
      await db.query(`
        create function ${triggerFunction}() returns trigger language plpgsql as $$
        begin
          raise exception 'synthetic_incoming_effect_failure';
        end;
        $$;
        create trigger ${trigger}
          before update on observed_transactions
          for each row execute function ${triggerFunction}();
      `);
      try {
        await expect(repository.settleForensicTelegramDelivery(
          db,
          repositorySettlement(claim, PLAN3_RECONCILIATION_NOW, "sent")
        )).rejects.toThrow(/synthetic_incoming_effect_failure/);
        expect(await repositoryDeliveryRow(db, id)).toEqual(before);
        await expect(db.query(
          "select user_alert_status from observed_transactions where watched_wallet_id = $1 and tx_hash = $2",
          [walletId, txHash]
        )).resolves.toMatchObject({ rows: [{ user_alert_status: "sending" }] });
      } finally {
        await db.query(`drop trigger if exists ${trigger} on observed_transactions`);
        await db.query(`drop function if exists ${triggerFunction}()`);
      }
      await expect(db.query(
        "select count(*)::integer as count from pg_trigger where tgname = $1 and not tgisinternal",
        [trigger]
      )).resolves.toMatchObject({ rows: [{ count: 0 }] });

      await expect(repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(claim, PLAN3_RECONCILIATION_NOW, "sent")
      )).resolves.toBe(true);
      await expect(db.query(
        "select user_alert_status from observed_transactions where watched_wallet_id = $1 and tx_hash = $2",
        [walletId, txHash]
      )).resolves.toMatchObject({ rows: [{ user_alert_status: "sent" }] });

      const retryWallet = "retry-wallet";
      const retryTx = "retry-tx";
      const retryId = "retry-effect-job";
      await insertRepositoryObservedAlert(db, { walletId: retryWallet, txHash: retryTx, status: "analyzing" });
      await insertRepositoryDeliveryJob(db, {
        id: retryId,
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: retryWallet, depositTxHash: retryTx }
      });
      await completeForensicCheckJob(db, repositoryCompletionInput(retryId, "incoming_deposit_check", {
        kind: "incoming_user_alert",
        watchedWalletId: retryWallet,
        incomingTxHash: retryTx
      }));
      const retryClaim = (await repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      }))!;
      await expect(repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(retryClaim, PLAN3_RECONCILIATION_NOW, "retryable", "telegram_network_error")
      )).resolves.toBe(true);
      await expect(db.query(
        "select user_alert_status from observed_transactions where watched_wallet_id = $1 and tx_hash = $2",
        [retryWallet, retryTx]
      )).resolves.toMatchObject({ rows: [{ user_alert_status: "analyzing" }] });
      const retryFinalAt = new Date(PLAN3_RECONCILIATION_NOW.getTime() + 30_000);
      const retryFinalClaim = (await repository.claimNextForensicTelegramDelivery(db, {
        now: retryFinalAt
      }))!;
      await repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(retryFinalClaim, retryFinalAt, "sent")
      );

      const failedWallet = "failed-wallet";
      const failedTx = "failed-tx";
      const failedId = "failed-effect-job";
      await insertRepositoryObservedAlert(db, { walletId: failedWallet, txHash: failedTx, status: "analyzing" });
      await insertRepositoryDeliveryJob(db, {
        id: failedId,
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: failedWallet, depositTxHash: failedTx }
      });
      await completeForensicCheckJob(db, repositoryCompletionInput(failedId, "incoming_deposit_check", {
        kind: "incoming_user_alert",
        watchedWalletId: failedWallet,
        incomingTxHash: failedTx
      }));
      const failedClaim = (await repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      }))!;
      await expect(repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(failedClaim, PLAN3_RECONCILIATION_NOW, "failed", "telegram_chat_forbidden")
      )).resolves.toBe(true);
      await expect(db.query(
        `select user_alert_status, user_alert_last_error from observed_transactions
         where watched_wallet_id = $1 and tx_hash = $2`,
        [failedWallet, failedTx]
      )).resolves.toMatchObject({
        rows: [{ user_alert_status: "failed", user_alert_last_error: "telegram_chat_forbidden" }]
      });
    });
  });

  it("rolls back a missing Incoming effect and atomically exhausts attempt four", async () => {
    await withRepositoryWaitSchema("incoming_effect_missing", async (db) => {
      const repository = await loadDeliveryRepository();
      const missingId = "missing-effect-job";
      await insertRepositoryDeliveryJob(db, {
        id: missingId,
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: "missing-wallet", depositTxHash: "missing-tx" }
      });
      await completeForensicCheckJob(db, repositoryCompletionInput(missingId, "incoming_deposit_check", {
        kind: "incoming_user_alert",
        watchedWalletId: "missing-wallet",
        incomingTxHash: "missing-tx"
      }));
      const claim = (await repository.claimNextForensicTelegramDelivery(db, {
        now: PLAN3_RECONCILIATION_NOW
      }))!;
      const before = await repositoryDeliveryRow(db, missingId);
      await expect(repository.settleForensicTelegramDelivery(
        db,
        repositorySettlement(claim, PLAN3_RECONCILIATION_NOW, "sent")
      )).rejects.toThrow("forensic_telegram_delivery_effect_cas_failed");
      expect(await repositoryDeliveryRow(db, missingId)).toEqual(before);
    });

    await withRepositoryWaitSchema("incoming_effect_exhaustion", async (db) => {
      const repository = await loadDeliveryRepository();
      const walletId = "exhausted-wallet";
      const txHash = "exhausted-tx";
      const id = "exhausted-effect-job";
      await insertRepositoryObservedAlert(db, { walletId, txHash });
      await insertRepositoryDeliveryJob(db, {
        id,
        kind: "incoming_deposit_check",
        progressJson: { watchedWalletId: walletId, depositTxHash: txHash }
      });
      await completeForensicCheckJob(db, repositoryCompletionInput(id, "incoming_deposit_check", {
        kind: "incoming_user_alert",
        watchedWalletId: walletId,
        incomingTxHash: txHash
      }));
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expect(repository.claimNextForensicTelegramDelivery(db, {
          now: new Date(PLAN3_RECONCILIATION_NOW.getTime() + (attempt - 1) * 40_000)
        })).resolves.toMatchObject({ jobId: id, claim: { attempt } });
      }
      await expect(repository.claimNextForensicTelegramDelivery(db, {
        now: new Date(PLAN3_RECONCILIATION_NOW.getTime() + 160_000)
      })).resolves.toBeNull();
      expect((await repositoryDeliveryRow(db, id)).progress_json).toMatchObject({
        telegramDelivery: {
          state: { status: "failed", lastError: "telegram_attempts_exhausted", attemptCount: 4 },
          claim: null
        }
      });
      await expect(db.query(
        `select user_alert_status, user_alert_last_error from observed_transactions
         where watched_wallet_id = $1 and tx_hash = $2`,
        [walletId, txHash]
      )).resolves.toMatchObject({
        rows: [{ user_alert_status: "failed", user_alert_last_error: "telegram_attempts_exhausted" }]
      });
    });
  });

  it("keeps terminal versioned Incoming effects out of legacy alert retry", async () => {
    await withRepositoryWaitSchema("legacy_alert_fence", async (db) => {
      for (const owned of [true, false]) {
        const walletId = owned ? "owned-wallet" : "legacy-wallet";
        const txHash = owned ? "owned-tx" : "legacy-tx";
        await insertRepositoryObservedAlert(db, { walletId, txHash, status: "failed" });
        if (owned) {
          const id = "owned-terminal-job";
          await insertRepositoryDeliveryJob(db, {
            id,
            kind: "incoming_deposit_check",
            status: "completed",
            progressJson: {
              watchedWalletId: walletId,
              depositTxHash: txHash,
              telegramDelivery: repositoryPendingDelivery(id, "incoming_deposit_check", {
                kind: "incoming_user_alert",
                watchedWalletId: walletId,
                incomingTxHash: txHash
              })
            }
          });
        }
      }

      await expect(claimUserAlertsForRetry(db, {
        limit: 10,
        staleSendingBefore: new Date("2026-07-15T11:00:00.000Z")
      })).resolves.toEqual([
        expect.objectContaining({ watchedWalletId: "legacy-wallet", txHash: "legacy-tx" })
      ]);
    });
  });

  it("does not let an unbound terminal effect suppress an unrelated legacy alert", async () => {
    await withRepositoryWaitSchema("legacy_alert_false_positive", async (db) => {
      await insertRepositoryObservedAlert(db, {
        walletId: "unrelated-wallet",
        txHash: "unrelated-tx",
        status: "failed"
      });
      await insertRepositoryDeliveryJob(db, {
        id: "malformed-terminal-job",
        kind: "incoming_deposit_check",
        status: "completed",
        progressJson: {
          watchedWalletId: "owner-wallet",
          depositTxHash: "owner-tx",
          telegramDelivery: repositoryPendingDelivery(
            "malformed-terminal-job",
            "incoming_deposit_check",
            {
              kind: "incoming_user_alert",
              watchedWalletId: "unrelated-wallet",
              incomingTxHash: "unrelated-tx"
            }
          )
        }
      });

      await expect(claimUserAlertsForRetry(db, {
        limit: 10,
        staleSendingBefore: new Date("2026-07-15T11:00:00.000Z")
      })).resolves.toEqual([
        expect.objectContaining({ watchedWalletId: "unrelated-wallet", txHash: "unrelated-tx" })
      ]);
    });
  });

  it("does not let a wrong-chat terminal delivery suppress its legitimate legacy alert", async () => {
    await withRepositoryWaitSchema("legacy_alert_wrong_chat", async (db) => {
      const walletId = "wrong-chat-wallet";
      const txHash = "wrong-chat-tx";
      const id = "wrong-chat-terminal-job";
      await insertRepositoryObservedAlert(db, { walletId, txHash, status: "failed" });
      await insertRepositoryDeliveryJob(db, {
        id,
        kind: "incoming_deposit_check",
        status: "completed",
        chatId: "persisted-owner-chat",
        progressJson: {
          watchedWalletId: walletId,
          depositTxHash: txHash,
          telegramDelivery: repositoryPendingDelivery(id, "incoming_deposit_check", {
            kind: "incoming_user_alert",
            watchedWalletId: walletId,
            incomingTxHash: txHash
          })
        }
      });

      await expect(claimUserAlertsForRetry(db, {
        limit: 10,
        staleSendingBefore: new Date("2026-07-15T11:00:00.000Z")
      })).resolves.toEqual([
        expect.objectContaining({ watchedWalletId: walletId, txHash })
      ]);
    });
  });

  it("rejects recovered delivery addressed to a chat other than the failed job owner", async () => {
    await withRepositoryWaitSchema("recovered_wrong_chat", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-wrong-chat";
      await insertRepositoryDeliveryJob(db, {
        id,
        status: "failed",
        chatId: "owned-chat",
        progressJson: { telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(
        db,
        repositoryRecoveredAttachment(id, "where_is_money_check")
      )).resolves.toBe(false);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toEqual({
        telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT
      });
    });
  });

  it("rejects recovered delivery payload when the failed job owner has no chat", async () => {
    await withRepositoryWaitSchema("recovered_null_chat", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-null-chat";
      await insertRepositoryDeliveryJob(db, {
        id,
        status: "failed",
        chatId: null,
        progressJson: { telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(
        db,
        repositoryRecoveredAttachment(id, "where_is_money_check")
      )).resolves.toBe(false);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toEqual({
        telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT
      });
    });
  });

  it("rejects recovered Incoming effect owned by a different failed job", async () => {
    await withRepositoryWaitSchema("recovered_cross_effect", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-cross-effect";
      await insertRepositoryDeliveryJob(db, {
        id,
        kind: "incoming_deposit_check",
        status: "failed",
        progressJson: {
          watchedWalletId: "owner-wallet",
          depositTxHash: "owner-tx",
          telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT
        }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(
        db,
        repositoryRecoveredAttachment(id, "incoming_deposit_check", {
          kind: "incoming_user_alert",
          watchedWalletId: "different-wallet",
          incomingTxHash: "different-tx"
        })
      )).resolves.toBe(false);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toEqual({
        watchedWalletId: "owner-wallet",
        depositTxHash: "owner-tx",
        telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT
      });
    });
  });

  it("attaches recovered Incoming delivery only when chat and effect match its failed owner", async () => {
    await withRepositoryWaitSchema("recovered_owner_binding", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-bound-owner";
      await insertRepositoryDeliveryJob(db, {
        id,
        kind: "incoming_deposit_check",
        status: "failed",
        progressJson: {
          watchedWalletId: "bound-wallet",
          depositTxHash: "bound-tx",
          telegramDeliveryIntent: REPOSITORY_RECOVERED_INTENT
        }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(
        db,
        repositoryRecoveredAttachment(id, "incoming_deposit_check", {
          kind: "incoming_user_alert",
          watchedWalletId: "bound-wallet",
          incomingTxHash: "bound-tx"
        })
      )).resolves.toBe(true);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toMatchObject({
        watchedWalletId: "bound-wallet",
        depositTxHash: "bound-tx",
        telegramDelivery: {
          payload: { chatId: "chat-recovered-bound-owner" },
          effect: {
            kind: "incoming_user_alert",
            watchedWalletId: "bound-wallet",
            incomingTxHash: "bound-tx"
          }
        }
      });
      expect((await repositoryDeliveryRow(db, id)).progress_json)
        .not.toHaveProperty("telegramDeliveryIntent");
    });
  });

  it("rejects recovered intent with a non-canonical createdAt timestamp", async () => {
    await withRepositoryWaitSchema("recovered_noncanonical_time", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-noncanonical-time";
      const intent = {
        ...REPOSITORY_RECOVERED_INTENT,
        createdAt: "2026-07-15T12:00:00Z"
      };
      await insertRepositoryDeliveryJob(db, {
        id,
        status: "failed",
        progressJson: { telegramDeliveryIntent: intent }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(db, {
        jobId: id,
        intentCreatedAt: intent.createdAt,
        expectedPreparationAttemptCount: 0,
        delivery: repositoryPendingDelivery(id, "where_is_money_check")
      })).resolves.toBe(false);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toEqual({
        telegramDeliveryIntent: intent
      });
    });
  });

  it("rejects recovered retry intent with an arbitrary backoff", async () => {
    await withRepositoryWaitSchema("recovered_wrong_backoff", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-wrong-backoff";
      const intent = {
        ...REPOSITORY_RECOVERED_INTENT,
        preparationStatus: "retryable",
        preparationAttemptCount: 1,
        lastPreparationAttemptAt: "2026-07-15T12:00:01.000Z",
        nextPreparationAttemptAt: "2026-07-15T12:00:46.000Z",
        lastPreparationError: "stale_intent_context_unavailable"
      };
      await insertRepositoryDeliveryJob(db, {
        id,
        status: "failed",
        progressJson: { telegramDeliveryIntent: intent }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(db, {
        jobId: id,
        intentCreatedAt: intent.createdAt,
        expectedPreparationAttemptCount: 1,
        delivery: repositoryPendingDelivery(id, "where_is_money_check")
      })).resolves.toBe(false);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toEqual({
        telegramDeliveryIntent: intent
      });
    });
  });

  it("rejects recovered retry intent whose attempt predates its creation", async () => {
    await withRepositoryWaitSchema("recovered_wrong_time_order", async (db) => {
      const repository = await loadDeliveryRepository();
      const id = "recovered-wrong-time-order";
      const intent = {
        ...REPOSITORY_RECOVERED_INTENT,
        preparationStatus: "retryable",
        preparationAttemptCount: 1,
        lastPreparationAttemptAt: "2026-07-15T11:59:59.000Z",
        nextPreparationAttemptAt: "2026-07-15T12:00:29.000Z",
        lastPreparationError: "stale_intent_context_unavailable"
      };
      await insertRepositoryDeliveryJob(db, {
        id,
        status: "failed",
        progressJson: { telegramDeliveryIntent: intent }
      });

      await expect(repository.attachRecoveredForensicTelegramDelivery(db, {
        jobId: id,
        intentCreatedAt: intent.createdAt,
        expectedPreparationAttemptCount: 1,
        delivery: repositoryPendingDelivery(id, "where_is_money_check")
      })).resolves.toBe(false);
      expect((await repositoryDeliveryRow(db, id)).progress_json).toEqual({
        telegramDeliveryIntent: intent
      });
    });
  });

  it("persists only explicit stale intents and bounds preparation at four attempts", async () => {
    await withRepositoryWaitSchema("stale_intent", async (db) => {
      const repository = await loadDeliveryRepository();
      for (const [id, chatId] of [["stale-with-chat", "chat-stale-with-chat"], ["stale-no-chat", null]] as const) {
        await insertRepositoryDeliveryJob(db, {
          id,
          chatId,
          progressJson: {
            jobPhase: "notification_delivery",
            jobHeartbeatAt: "2026-07-15T10:00:00.000Z",
            retryCount: 4
          }
        });
      }
      await recoverStaleForensicCheckJobs(db, {
        staleRunningBefore: new Date("2026-07-15T11:00:00.000Z"),
        maxRetries: 0,
        recoveredAt: PLAN3_RECONCILIATION_NOW
      });
      const withChat = await repositoryDeliveryRow(db, "stale-with-chat");
      const intent = (withChat.progress_json as Record<string, unknown>)
        .telegramDeliveryIntent as RecoveredForensicDeliveryIntentV1;
      expect(intent).toEqual({
        version: "recovered-forensic-delivery-intent-v1",
        kind: "stale_failure",
        createdAt: PLAN3_RECONCILIATION_NOW.toISOString(),
        reasonCode: "stale_running_retry_exhausted",
        preparationStatus: "pending",
        preparationAttemptCount: 0,
        lastPreparationAttemptAt: null,
        nextPreparationAttemptAt: null,
        lastPreparationError: null
      });
      expect((await repositoryDeliveryRow(db, "stale-no-chat")).progress_json)
        .not.toHaveProperty("telegramDeliveryIntent");
      await expect(repository.listDueRecoveredForensicDeliveryIntents(db, {
        now: PLAN3_RECONCILIATION_NOW,
        limit: 50
      })).resolves.toEqual([{ jobId: "stale-with-chat", intent }]);

      const prepared = repositoryPendingDelivery("stale-with-chat", "where_is_money_check");
      const attachment = {
        jobId: "stale-with-chat",
        intentCreatedAt: intent.createdAt,
        expectedPreparationAttemptCount: 0,
        delivery: prepared
      };
      await expect(repository.attachRecoveredForensicTelegramDelivery(db, attachment)).resolves.toBe(true);
      await expect(repository.attachRecoveredForensicTelegramDelivery(db, attachment)).resolves.toBe(false);

      const failedId = "stale-preparation-failure";
      await insertRepositoryDeliveryJob(db, {
        id: failedId,
        status: "failed",
        progressJson: { telegramDeliveryIntent: intent },
        resultJson: { preserved: true }
      });
      const delays = [30_000, 120_000, 600_000];
      let attemptedAt = PLAN3_RECONCILIATION_NOW;
      for (let expected = 0; expected < 4; expected += 1) {
        await expect(repository.settleRecoveredForensicDeliveryIntentPreparation(db, {
          jobId: failedId,
          intentCreatedAt: intent.createdAt,
          expectedPreparationAttemptCount: expected,
          attemptedAt,
          errorCode: "stale_intent_context_unavailable"
        })).resolves.toBe(true);
        if (expected === 0) {
          await expect(repository.settleRecoveredForensicDeliveryIntentPreparation(db, {
            jobId: failedId,
            intentCreatedAt: intent.createdAt,
            expectedPreparationAttemptCount: 0,
            attemptedAt: new Date(attemptedAt.getTime() + 1),
            errorCode: "stale_intent_payload_build_failed"
          })).resolves.toBe(false);
        }
        const row = await repositoryDeliveryRow(db, failedId);
        const current = (row.progress_json as Record<string, unknown>)
          .telegramDeliveryIntent as RecoveredForensicDeliveryIntentV1;
        expect(current.preparationAttemptCount).toBe(expected + 1);
        if (expected < 3) {
          attemptedAt = new Date(attemptedAt.getTime() + delays[expected]);
          expect(current).toMatchObject({
            preparationStatus: "retryable",
            nextPreparationAttemptAt: attemptedAt.toISOString(),
            lastPreparationError: "stale_intent_context_unavailable"
          });
        } else {
          expect(current).toMatchObject({
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
      })).resolves.toMatchObject({ jobId: "stale-with-chat" });
      expect((await repositoryDeliveryRow(db, failedId)).progress_json)
        .not.toHaveProperty("telegramDelivery");
    });
  });
});

afterAll(async () => {
  if (!requirePlan3Postgres) return;
  const admin = new pg.Pool({ connectionString: plan3RepositoryDatabaseUrl });
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 repository cleanup database ${String(database.rows[0]?.name)}`);
    }
    const schemas = await admin.query(
      "select schema_name from information_schema.schemata where schema_name like 'plan3_repo_wait_%'"
    );
    if (schemas.rows.length > 0) {
      throw new Error(`Plan 3 repository cleanup audit failed: schemas=${schemas.rows.length}`);
    }
  } finally {
    await admin.end();
  }
});
