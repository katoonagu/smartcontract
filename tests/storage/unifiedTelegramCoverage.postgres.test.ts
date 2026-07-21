import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ForensicCoverageV2 } from "../../src/types";
import { adaptForensicJobForTelegram } from "../../src/telegram/forensicPresentationAdapters";
import { renderTelegramForensicResult } from "../../src/telegram/forensicResultRenderer";
import {
  claimNextForensicCheckJob,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob
} from "../../src/storage/repositories";
import {
  COVERAGE_24_10_14,
  PERSISTED_COVERAGE_WHERE_REPORT,
  TGYT
} from "../fixtures/telegram/remediationTelegramUxCases";

const PLAN4_DATABASE_URL = process.env.PLAN4_TEST_DATABASE_URL
  ?? "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan4";
const required = process.env.REQUIRE_PLAN4_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;

const plan4Url = new URL(PLAN4_DATABASE_URL);
if (required && (connectionString !== PLAN4_DATABASE_URL
    || plan4Url.hostname !== "127.0.0.1"
    || plan4Url.pathname !== "/tron_watch_plan4"
    || plan4Url.port === "55999")) {
  throw new Error("Plan 4 PostgreSQL acceptance database binding is invalid");
}

const postgresDescribe = connectionString === PLAN4_DATABASE_URL ? describe : describe.skip;
const schema = `plan4_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

function safeIdentifier(value: string): string {
  if (!/^plan4_[a-z0-9_]{1,56}$/.test(value)) throw new Error(`Unsafe Plan 4 schema identifier: ${value}`);
  return `"${value}"`;
}

postgresDescribe("unified Telegram CoverageV2 PostgreSQL acceptance", () => {
  let admin: pg.Pool | null = null;
  let db: pg.Pool | null = null;

  beforeAll(async () => {
    admin = new pg.Pool({
      connectionString,
      application_name: `${schema}_admin`.slice(0, 63)
    });
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan4") {
      throw new Error(`Refusing Plan 4 acceptance database ${String(database.rows[0]?.name)}`);
    }

    await admin.query(`create schema ${safeIdentifier(schema)}`);
    db = new pg.Pool({
      connectionString,
      application_name: `${schema}_client`.slice(0, 63),
      options: `-c search_path=${schema},pg_catalog`
    });
    const path = await db.query("select current_schema() as schema_name, current_database() as database_name");
    expect(path.rows[0]).toEqual({ schema_name: schema, database_name: "tron_watch_plan4" });

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
      create unique index forensic_check_jobs_active_unique_idx
        on forensic_check_jobs(
          kind,
          subject_address,
          window_start,
          window_end,
          coalesce(requested_by, ''),
          coalesce(progress_json->>'depositTxHash', '')
        )
        where status in ('queued', 'running');
      create index forensic_check_jobs_claim_idx
        on forensic_check_jobs(status, priority desc, created_at asc)
        where status = 'queued';
    `);
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    if (db) {
      try {
        await db.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (admin) {
      try {
        await admin.query(`drop schema if exists ${safeIdentifier(schema)} cascade`);
        const remaining = await admin.query("select to_regnamespace($1) as schema_name", [schema]);
        if (remaining.rows[0]?.schema_name !== null) throw new Error(`Plan 4 schema cleanup failed: ${schema}`);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await admin.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `Plan 4 cleanup failed: ${schema}`);
  });

  it("[AC-13] persists and renders available selected and excluded counts", async () => {
    if (!db) throw new Error("Plan 4 PostgreSQL client was not initialized");
    const windowStart = new Date("2026-07-15T00:00:00.000Z");
    const windowEnd = new Date("2026-07-16T00:00:00.000Z");
    const queued = await createOrReuseForensicCheckJob(db, {
      kind: "where_is_money_check",
      subjectAddress: TGYT,
      windowStart,
      windowEnd,
      requestedBy: "plan4-sanitized-acceptance",
      progressJson: { fixtureId: "COVERAGE_24_10_14" }
    });
    const claimed = await claimNextForensicCheckJob(db, { kinds: ["where_is_money_check"] });
    expect(claimed?.id).toBe(queued.id);

    await expect(completeForensicCheckJob(db, {
      id: queued.id,
      status: "completed",
      progressJson: { jobPhase: "completed", fixtureId: "COVERAGE_24_10_14" },
      resultJson: {
        scoringPolicyVersion: "scoring-signal-matrix-v3",
        subjectAddress: TGYT,
        scoreValid: true,
        scoreBlockedReason: null,
        technicalStatus: "completed",
        whereIsMoneyReport: PERSISTED_COVERAGE_WHERE_REPORT
      },
      rawEvidenceIds: ["coverage:gasfree-fees"],
      observationIds: ["coverage:24-10-14"],
      lastError: null
    })).resolves.toBe(true);

    const reloaded = await getForensicCheckJob(db, queued.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.status).toBe("completed");
    const persistedCoverage = (reloaded?.resultJson.whereIsMoneyReport as { coverageV2?: ForensicCoverageV2 }).coverageV2;
    expect(persistedCoverage).toMatchObject({
      availableInboundTxCount: 24,
      selectedInboundTxCount: 10,
      excludedInboundTxCount: 14,
      exclusions: [{ reason: "exact_gasfree_service_fee", txCount: 14 }]
    });
    expect(persistedCoverage).toEqual(COVERAGE_24_10_14);

    const html = renderTelegramForensicResult(adaptForensicJobForTelegram(reloaded!, {
      locale: "ru",
      resultKind: "wallet_final"
    }));
    expect(html).toContain("Доступно 24 входящих перевода");
    expect(html).toContain("К выбранной сумме относятся 10");
    expect(html).toContain("Ещё 14 проверены, но исключены");
    expect(html).toMatch(/GasFree-комисси/i);
  });
});
