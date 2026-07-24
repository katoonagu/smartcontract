import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { loadUnifiedProgressProjection } from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("Unified bounded Admin progress query", () => {
  it("projects current task, counter and storage state without delta replay", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const schema = `unifiedprogress_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await client.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256, created_at
        ) values (
          'run-progress',$1,$2,'RUNNING','admin_diagnostic','isolated',$3,
          '2026-07-24T00:00:00.000Z'
        )`,
        [
          "a".repeat(64),
          "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
          "b".repeat(64)
        ]
      );
      const tasks = [
        ["direct", "direct_history", "COMPLETED", {}],
        ["address-a", "address_history", "LEASED", {
          performanceCounters: {
            providerCalls: 50,
            networkFetches: 30,
            providerCacheHits: 10
          }
        }],
        ["address-b", "address_history", "QUEUED", {
          performanceCounters: {
            providerCalls: 40,
            networkFetches: 20,
            providerCacheHits: 5
          }
        }],
        ["address-c", "address_history", "WAITING_RETRY", {
          performanceCounters: {
            providerCalls: 30,
            networkFetches: 10,
            providerCacheHits: 5
          }
        }],
        ["address-d", "address_history", "COMPLETED", {}],
        ["traversal", "traversal", "QUEUED", {
          version: "unified-production-traversal-checkpoint-v2",
          operational: {
            frontierCount: 20,
            frontierPeak: 35,
            uniqueAddresses: 48,
            fundingEpisodes: 90
          }
        }]
      ] as const;
      for (const [id, kind, status, checkpoint] of tasks) {
        await client.query(
          `insert into unified_check_tasks (
            id, run_id, kind, status, priority_lane, logical_key,
            checkpoint_json, lease_owner, lease_token, lease_expires_at
          ) values (
            $1,'run-progress',$2,$3,'interactive',$1,$4::jsonb,
            case when $3 = 'LEASED' then 'worker-1' end,
            case when $3 = 'LEASED' then 'lease-1' end,
            case when $3 = 'LEASED'
              then '2026-07-24T00:02:00.000Z'::timestamptz end
          )`,
          [id, kind, status, JSON.stringify(checkpoint)]
        );
      }
      for (const suffix of ["c", "d"]) {
        await client.query(
          `insert into unified_check_artifacts (
            sha256, created_by_run_id, kind, schema_version, artifact_json
          ) values ($1,'run-progress','traversal_delta','1',$2::jsonb)`,
          [
            suffix.repeat(64),
            JSON.stringify({ version: "unified-traversal-delta-v1", suffix })
          ]
        );
      }

      let queryCount = 0;
      const progress = await loadUnifiedProgressProjection({
        query: async (sql, values) => {
          queryCount += 1;
          return client.query(sql, values as unknown[]);
        }
      }, {
        runId: "run-progress",
        now: new Date("2026-07-24T00:01:00.000Z"),
        configuredSlots: 4,
        keyGroups: [{
          id: "primary",
          requests: 120,
          inFlight: 1,
          status: "active"
        }, {
          id: "backup",
          requests: 0,
          inFlight: 0,
          status: "cooldown"
        }]
      });

      expect(queryCount).toBe(1);
      expect(progress).toMatchObject({
        lifecycle: "RUNNING",
        phase: "traversal_fetch",
        provider: {
          configuredSlots: 4,
          activeSlots: 1,
          coolingDownSlots: 1,
          requestsPerSecond: 2,
          keyGroups: [
            { id: "backup", requests: 0, inFlight: 0, status: "cooldown" },
            { id: "primary", requests: 120, inFlight: 1, status: "active" }
          ]
        },
        remaining: {
          discoveredExact: 3,
          totalKnown: false
        },
        reuse: {
          networkFetches: 60,
          providerCacheHits: 20,
          manifestReuses: 42,
          replayAvoided: 42
        },
        traversal: {
          frontier: 20,
          frontierPeak: 35,
          uniqueAddresses: 48,
          fundingEpisodes: 90
        }
      });
      expect(progress.storage.checkpointBytes).toBeGreaterThan(0);
      expect(progress.storage.deltaArtifactBytes).toBeGreaterThan(0);
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
