import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  loadUnifiedAdminRunSnapshot,
  loadUnifiedProgressProjection
} from "../../src/unifiedCheck/repository";
import {
  loadUnifiedAdaptiveStorageSnapshot
} from "../../src/unifiedCheck/adaptiveRuntime";

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

  it("loads mixed-lane planner, head age and buffer state with one run-bounded query", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const schema = `unifiedsnapshot_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await client.query(
        await readFile(
          "migrations/034_unified_check_adaptive_planner.sql",
          "utf8"
        )
      );
      await client.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256, fairness_owner_id,
          created_at
        ) values (
          'run-snapshot',$1,$2,'RUNNING','admin_diagnostic','isolated',$3,
          'opaque-owner','2026-07-25T00:00:00.000Z'
        )`,
        [
          "a".repeat(64),
          "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
          "b".repeat(64)
        ]
      );
      const tasks = [
        ["committed", "interactive", "COMPLETED", 1],
        ["head", "repair", "COMPLETED", 2],
        ["leased", "interactive", "LEASED", 3],
        ["backlog", "background", "QUEUED", 0]
      ] as const;
      for (const [id, lane, status, logicalChunks] of tasks) {
        await client.query(
          `insert into unified_check_tasks (
            id, run_id, kind, status, priority_lane, logical_key,
            checkpoint_json, lease_owner, lease_token, lease_expires_at
          ) values (
            $1,'run-snapshot','address_history',$2,$3,$1,$4::jsonb,
            case when $2 = 'LEASED' then 'worker-1' end,
            case when $2 = 'LEASED' then 'lease-1' end,
            case when $2 = 'LEASED'
              then '2026-07-25T00:02:00.000Z'::timestamptz end
          )`,
          [
            id,
            status,
            lane,
            JSON.stringify({ performanceCounters: { logicalChunks } })
          ]
        );
      }
      await client.query(
        `insert into unified_check_planner_entries (
          run_id, canonical_sequence, task_id, planner_state,
          result_bytes, admitted_at, reserved_bytes, planned_at,
          ready_at, committed_at
        ) values
          (
            'run-snapshot',0,'committed','committed',100,
            '2026-07-25T00:00:01.000Z',null,
            '2026-07-25T00:00:00.000Z',
            '2026-07-25T00:00:10.000Z',
            '2026-07-25T00:00:20.000Z'
          ),
          (
            'run-snapshot',1,'head','ready',200,
            '2026-07-25T00:00:20.000Z',null,
            '2026-07-25T00:00:10.000Z',
            '2026-07-25T00:00:30.000Z',null
          ),
          (
            'run-snapshot',2,'leased','planned',null,
            '2026-07-25T00:00:40.000Z',300,
            '2026-07-25T00:00:20.000Z',null,null
          ),
          (
            'run-snapshot',3,'backlog','planned',null,
            null,null,'2026-07-25T00:00:30.000Z',null,null
          )`
      );
      await client.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256, fairness_owner_id
        )
        select 'terminal-' || n,
               lpad(to_hex(n), 64, '0'),
               'TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy',
               'FAILED_TECHNICAL','synthetic_test','isolated',
               lpad(to_hex(n + 10000), 64, '0'),
               'terminal-owner-' || n
          from generate_series(1, 1000) n`
      );
      await client.query(
        `insert into unified_check_tasks (
          id, run_id, kind, status, priority_lane, logical_key
        )
        select 'terminal-task-' || n, 'terminal-' || n,
               'address_history','QUEUED','background','terminal-' || n
          from generate_series(1, 1000) n`
      );
      await client.query(
        `insert into unified_check_planner_entries (
          run_id, canonical_sequence, task_id, planner_state, planned_at
        )
        select 'terminal-' || n, 0, 'terminal-task-' || n, 'planned',
               '2026-07-01T00:00:00.000Z'
          from generate_series(1, 1000) n`
      );

      let queryCount = 0;
      const snapshot = await loadUnifiedAdminRunSnapshot({
        query: async (sql, values) => {
          queryCount += 1;
          return client.query(sql, values as unknown[]);
        }
      }, {
        runId: "run-snapshot",
        now: new Date("2026-07-25T00:01:00.000Z"),
        decision: null
      });

      expect(queryCount).toBe(1);
      expect(snapshot).toEqual({
        ownerId: "opaque-owner",
        lane: "repair",
        fairShare: 0,
        activeSlots: 0,
        lastServedAt: null,
        lookaheadTarget: 0,
        planner: {
          durableBacklog: 1,
          admitted: 1,
          leased: 1,
          ready: 1,
          committed: 1
        },
        canonicalHead: {
          taskId: "head",
          state: "COMPLETED",
          ageMs: 30_000
        },
        buffer: {
          readyCount: 1,
          readyBytes: 200,
          reservedBytes: 300
        },
        lastCommitAt: "2026-07-25T00:00:20.000Z",
        blocker: null,
        elapsedMs: 60_000,
        completedChunks: 6,
        throughputPerMinute: 6
      });

      const aggregate = await loadUnifiedAdaptiveStorageSnapshot({
        query: async (sql, values) =>
          client.query(sql, values as unknown[])
      }, new Date("2026-07-25T00:01:00.000Z"));
      expect(aggregate).toEqual({
        planner: {
          durableBacklog: 1,
          admitted: 1,
          leased: 1,
          ready: 1,
          committed: 1
        },
        buffer: {
          readyCount: 1,
          readyBytes: 200,
          reservedBytes: 300
        },
        canonicalHeadAgeMs: 50_000
      });
      await client.query("set enable_seqscan = off");
      const plan = await client.query(
        `explain (format text)
         with active_runs as materialized (
           select run.id
             from unified_check_runs run
            where run.status = 'RUNNING'
         )
         select entry.run_id
           from active_runs run
           join unified_check_planner_entries entry on entry.run_id = run.id
          where true`
      );
      const planText = plan.rows
        .map((row) => String(row["QUERY PLAN"]))
        .join("\n");
      expect(planText).toContain(
        "unified_check_runs_reusable_analysis_idx"
      );
      expect(planText).toMatch(
        /unified_check_planner_entries_(buffer_aggregate_idx|pkey)/u
      );
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
