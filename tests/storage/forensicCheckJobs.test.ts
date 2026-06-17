import { describe, expect, it } from "vitest";
import {
  claimNextForensicCheckJob,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob,
  getLatestForensicCheckJobForAddress
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";

function createMockDb(): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
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
});
