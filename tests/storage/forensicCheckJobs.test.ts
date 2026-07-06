import { describe, expect, it } from "vitest";
import {
  claimNextForensicCheckJob,
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
  saveAddressFastCheckJob,
  upsertForensicJobWait,
  updateCompletedDeepCheckResultPatch
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";

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
  expect(sql).not.toContain("jobHeartbeatAt')::timestamptz");
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
        started_at: requeued ? null : row.started_at,
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
        if (sql.includes("for update skip locked")) {
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
    expect(queries[0].sql.toLowerCase()).toContain("for update skip locked");
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
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      requiredFor: "where_hop",
      statusReason: "partial_provider_cap",
      lastError: null
    });

    expect(queries[0].sql).toContain(
      "on conflict (job_id, wait_type, address, coverage_mode, target_timestamp_ms, request_kind, window_start_timestamp_ms, candidate_tx_hash) do update set"
    );
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

  it("marks generic waiting jobs ready after targeted index completion", async () => {
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
    expect(queries[0].sql).toContain("returning job_id");
    expect(queries[0].sql).toContain("wait.target_timestamp_ms <= $2");
    expect(queries[0].sql).toContain("wait.request_kind = 'broad_targeted'");
    expect(queries[0].sql).toContain("update forensic_check_jobs job");
    expect(queries[0].sql).toContain("job.progress_json->>'jobPhase' = 'waiting_for_targeted_index'");
    expect(queries[0].sql).toContain("'targetedIndex'");
    expect(queries[0].params[0]).toBe("THop111111111111111111111111111111111");
    expect(queries[0].params[1]).toBe(new Date("2026-06-30T11:52:00.000Z").getTime());
    expect(queries[0].params[2]).toBe("reading_local_index");
    expect(queries[0].params[4]).toBe("ready");
  });

  it("stores separate candidate-window waits for the same job address and target", async () => {
    const { db, queries } = createMockDb();
    const end = new Date("2026-07-04T12:00:00.000Z");

    await upsertForensicJobWait(db, {
      jobId: "where-job-window-waits",
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

  it("only resumes candidate-window jobs after sibling windows are no longer waiting", async () => {
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

    expect(queries[0].sql).toContain("ready_jobs as");
    expect(queries[0].sql).toContain("$24::text <> 'candidate_window'");
    expect(queries[0].sql).toContain("not exists");
    expect(queries[0].sql).toContain("blocker.request_kind = 'candidate_window'");
    expect(queries[0].sql).toContain("blocker.status = 'waiting'");
    expect(queries[0].sql).toContain("job.id in (select job_id from ready_jobs)");
  });

  it("wakes candidate-window jobs when the exact wait is already ready", async () => {
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

    expect(queries[0].sql).toContain("candidate_matching_waits as");
    expect(queries[0].sql).toContain("wait.status in ('ready', 'terminal')");
    expect(queries[0].sql).toContain("wakeup_waits as");
    expect(queries[0].sql).toContain("select job_id from affected_waits");
    expect(queries[0].sql).toContain("select job_id from candidate_matching_waits");
  });

  it("does not count the current candidate window as a sibling blocker", async () => {
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

    expect(queries[0].sql).toContain("and not (");
    expect(queries[0].sql).toContain("blocker.address = $1");
    expect(queries[0].sql).toContain("blocker.target_timestamp_ms = $2");
    expect(queries[0].sql).toContain("blocker.window_start_timestamp_ms = $25");
    expect(queries[0].sql).toContain("coalesce(blocker.candidate_tx_hash, '') = $26");
  });

  it("resumes terminal candidate-window jobs to local read for broad fallback decision", async () => {
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

    expect(queries[0].params[2]).toBe("reading_local_index");
    expect(queries[0].params[4]).toBe("terminal");
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
  });

  it("stores completed result evidence and observation ids", async () => {
    const { db, queries } = createMockDb();
    await completeForensicCheckJob(db, {
      id: "job-1",
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
      null
    ]);
  });

  it("patches completed deep check result and progress without completing the job again", async () => {
    const { db, queries } = createMockDb([{ rows: [], rowCount: 1 }]);
    const resultJson = { secondLayerRelationshipProfiles: { counters: { queued: 0, notIndexed: 0 } } };
    const progressJson = { secondLayerRefreshStatus: "completed" };

    const updated = await updateCompletedDeepCheckResultPatch(db, {
      id: "job-1",
      resultJson,
      progressJson
    });

    expect(updated).toBe(true);
    expect(queries[0].sql).toContain("update forensic_check_jobs");
    expect(queries[0].sql).toContain("kind = 'address_deep_check'");
    expect(queries[0].sql).toContain("status = 'completed'");
    expect(queries[0].sql).toContain("progress_json = progress_json || $3");
    expect(queries[0].sql).not.toContain("completed_at = now()");
    expect(queries[0].sql).not.toContain("raw_evidence_ids");
    expect(queries[0].sql).not.toContain("observation_ids");
    expect(queries[0].sql).not.toContain("last_error");
    expect(queries[0].params).toEqual(["job-1", resultJson, progressJson]);
  });

  it("returns false when completed deep check patch finds no row", async () => {
    const { db } = createMockDb([{ rows: [], rowCount: 0 }]);

    const updated = await updateCompletedDeepCheckResultPatch(db, {
      id: "job-1",
      resultJson: {},
      progressJson: {}
    });

    expect(updated).toBe(false);
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
    expect(queries[0].sql).toContain("result_json #>> '{secondLayerRelationshipProfiles,counters,queued}'");
    expect(queries[0].sql).toContain("result_json #>> '{secondLayerRelationshipProfiles,counters,notIndexed}'");
    expect(queries[0].sql).toContain("case when (result_json #>> '{secondLayerRelationshipProfiles,counters,queued}') ~ '^[0-9]{1,9}$'");
    expect(queries[0].sql).toContain("case when (result_json #>> '{secondLayerRelationshipProfiles,counters,notIndexed}') ~ '^[0-9]{1,9}$'");
    expect(queries[0].sql).toContain("order by updated_at asc");
    expect(queries[0].params).toEqual([10]);
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
      startedAt: null,
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
