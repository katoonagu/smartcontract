import { describe, expect, it } from "vitest";
import {
  claimNextForensicCheckJob,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob,
  getLatestForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddress,
  getLatestWhereIsMoneyCheckJobForAddress,
  listAdminForensicCheckJobs,
  recoverStaleForensicCheckJobs
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

  it("claims the next queued job with skip locked semantics", async () => {
    const { db, queries } = createMockDb();
    const job = await claimNextForensicCheckJob(db);

    expect(job?.status).toBe("running");
    expect(queries[0].sql.toLowerCase()).toContain("for update skip locked");
  });

  it("claims queued jobs by forensic job kind when requested", async () => {
    const { db, queries } = createMockDb();
    await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });

    expect(queries[0].sql).toContain("kind = any($1::text[])");
    expect(queries[0].params).toEqual([["where_is_money_check"]]);
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
