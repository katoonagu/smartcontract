import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck
} from "../../src/unifiedCheck/requestService";
import { buildFrozenLabelDataset } from "../../src/unifiedCheck/frozenLabels";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("Unified Check durable intake", () => {
  it("persists ACCEPTED before snapshot and atomically reuses the exact run", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const schema = `unifiedintake_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(await readFile("migrations/033_unified_wallet_check.sql", "utf8"));
      const clientQueryable: UnifiedQueryable = {
        query: (sql: string, values?: readonly unknown[]) =>
          client.query(sql, values as unknown[])
      };
      const db: UnifiedTransactionalQueryable = {
        ...clientQueryable,
        async transaction<T>(work: (tx: UnifiedQueryable) => Promise<T>): Promise<T> {
          await client.query("begin");
          try {
            const result = await work(clientQueryable);
            await client.query("commit");
            return result;
          } catch (error) {
            await client.query("rollback").catch(() => undefined);
            throw error;
          }
        }
      };
      const store = createPostgresUnifiedRequestStore(db);
      const base = {
        store,
        snapshotSource: {
          latestConfirmedBlock: async () => ({
            number: "84713573",
            hash: "a".repeat(64),
            timestamp: "2026-07-23T12:53:54.000Z"
          }),
          snapshotBalances: async () => {
            const accepted = await client.query(
              "select status from unified_check_requests order by created_at desc limit 1"
            );
            expect(accepted.rows[0]?.status).toBe("ACCEPTED");
            return {
              usdtRaw: "0",
              trxSun: "0",
              source: "fake-confirmed-node",
              consistency: "exact" as const
            };
          }
        },
        versions: {
          labelDatasetSha256: "b".repeat(64),
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          runtimeCommit: "candidate",
          schemaVersion: 33
        },
        freezeLabelDataset: async ({
          snapshotHash,
          frozenAt
        }: {
          snapshotHash: string;
          frozenAt: string;
        }) => buildFrozenLabelDataset({
          snapshotHash,
          frozenAt,
          labels: [],
          legacyRows: []
        }),
        now: () => new Date("2026-07-23T13:00:00.000Z")
      };
      const first = await intakeUnifiedCheck({
        ...base,
        request: {
          id: "request-1",
          requestCorrelationId: "action-1",
          subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
          chatId: "1",
          messageThreadId: "",
          locale: "ru",
          runPurpose: "user_check",
          sideEffectPolicy: "authoritative"
        },
        candidateRunId: "run-1"
      });
      const second = await intakeUnifiedCheck({
        ...base,
        request: {
          id: "request-2",
          requestCorrelationId: "action-2",
          subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
          chatId: "1",
          messageThreadId: "",
          locale: "ru",
          runPurpose: "user_check",
          sideEffectPolicy: "authoritative"
        },
        candidateRunId: "run-2"
      });
      expect(first.kind).toBe("attached");
      expect(second.kind).toBe("attached");
      if (first.kind !== "attached" || second.kind !== "attached") return;
      expect(second.run.id).toBe(first.run.id);
      expect(second.reused).toBe(true);
      expect((await client.query("select count(*)::int as count from unified_check_requests")).rows[0]?.count)
        .toBe(2);
      expect((await client.query("select count(*)::int as count from unified_check_runs")).rows[0]?.count)
        .toBe(1);
      expect(first.run.analysisManifest).toMatchObject({
        labelCatalogVersion: "unified-label-catalog-v1",
        boundaryPredicateVersion: "unified-boundary-predicates-v1"
      });
      expect((await client.query(
        "select count(*)::int as count from unified_label_datasets where sha256 = $1",
        [first.run.analysisManifest.labelDatasetSha256]
      )).rows[0]?.count).toBe(1);
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
