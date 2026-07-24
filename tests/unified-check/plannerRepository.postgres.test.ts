import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  admitBarrierHead,
  deAdmitUnleasedPlannerTail,
  planUnifiedOrderedTasks,
  type UnifiedOrderedTaskPlanInput
} from "../../src/unifiedCheck/plannerRepository";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

function task(
  taskId: string,
  kind: string,
  logicalKey: string
): UnifiedOrderedTaskPlanInput {
  return {
    taskId,
    kind,
    logicalKey,
    priorityLane: "interactive",
    checkpoint: { version: "planner-test-v1", logicalKey }
  };
}

postgresDescribe("Unified ordered planner repository", () => {
  it("persists one canonical append-only plan across retries and concurrent discovery", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const admin = await pool.connect();
    const schema = `unifiedplanner_${randomUUID().replaceAll("-", "")}`;
    const transactionHost = (): UnifiedTransactionalQueryable => ({
      query: (sql, values) => pool.query(sql, values as unknown[]),
      async transaction<T>(work: (tx: UnifiedQueryable) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(`set local search_path to "${schema}"`);
          const result = await work({
            query: (sql, values) => client.query(sql, values as unknown[])
          });
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
    });
    try {
      await admin.query(`create schema "${schema}"`);
      await admin.query(`set search_path to "${schema}"`);
      await admin.query(await readFile("migrations/033_unified_wallet_check.sql", "utf8"));
      await admin.query(await readFile("migrations/034_unified_check_adaptive_planner.sql", "utf8"));
      await admin.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256, fairness_owner_id
        ) values ('run-1','analysis-1','TSubject','RUNNING','synthetic_test',
          'isolated','manifest-1','run-1')`
      );

      const first = await planUnifiedOrderedTasks(transactionHost(), {
        runId: "run-1",
        tasks: [
          task("proposed-z", "where", "2"),
          task("proposed-x", "deep", "1"),
          task("proposed-y", "fast", "1")
        ]
      });
      expect(first).toEqual([
        { taskId: "proposed-x", canonicalSequence: 0 },
        { taskId: "proposed-y", canonicalSequence: 1 },
        { taskId: "proposed-z", canonicalSequence: 2 }
      ]);

      const repeated = await planUnifiedOrderedTasks(transactionHost(), {
        runId: "run-1",
        tasks: [
          task("retry-where", "where", "2"),
          task("retry-fast", "fast", "1"),
          task("retry-deep", "deep", "1")
        ]
      });
      expect(repeated).toEqual(first);
      await expect(admin.query(
        "select count(*)::int as tasks from unified_check_tasks"
      )).resolves.toMatchObject({ rows: [{ tasks: 3 }] });
      await expect(admin.query(
        "select count(*)::int as planner from unified_check_planner_entries"
      )).resolves.toMatchObject({ rows: [{ planner: 3 }] });

      const [left, right] = await Promise.all([
        planUnifiedOrderedTasks(transactionHost(), {
          runId: "run-1",
          tasks: [
            task("concurrent-a", "address_history", "A"),
            task("concurrent-b", "address_history", "B")
          ]
        }),
        planUnifiedOrderedTasks(transactionHost(), {
          runId: "run-1",
          tasks: [
            task("other-b", "address_history", "B"),
            task("concurrent-c", "address_history", "C")
          ]
        })
      ]);
      expect(left[1]?.canonicalSequence).toBe(right[0]?.canonicalSequence);
      const discovered = await admin.query(
        `select canonical_sequence, task_id
           from unified_check_planner_entries
          where run_id = 'run-1'
          order by canonical_sequence`
      );
      expect(discovered.rows.map((row) => Number(row.canonical_sequence)))
        .toEqual([0, 1, 2, 3, 4, 5]);
      expect(new Set(discovered.rows.map((row) => row.task_id)).size).toBe(6);
      await expect(admin.query(
        `select planner_state, admitted_at, reserved_bytes, checkpoint_json
           from unified_check_planner_entries planner
           join unified_check_tasks task
             on task.run_id = planner.run_id and task.id = planner.task_id
          where planner.run_id = 'run-1'
          order by canonical_sequence`
      )).resolves.toMatchObject({
        rows: Array.from({ length: 6 }, () => ({
          planner_state: "planned",
          admitted_at: null,
          reserved_bytes: null,
          checkpoint_json: expect.any(Object)
        }))
      });

      await expect(admitBarrierHead(transactionHost(), {
        runId: "run-1",
        reservedBytes: 100
      })).resolves.toBe(true);
      await expect(admitBarrierHead(transactionHost(), {
        runId: "run-1",
        reservedBytes: 200
      })).resolves.toBe(false);
      await admin.query(
        `update unified_check_planner_entries
            set admitted_at = statement_timestamp(), reserved_bytes = 50
          where run_id = 'run-1' and canonical_sequence in (1, 2)`
      );
      const leasedTaskId = discovered.rows[2]?.task_id;
      await admin.query(
        `update unified_check_tasks
            set status = 'LEASED', lease_owner = 'worker', lease_token = 'lease',
                lease_expires_at = statement_timestamp() + interval '1 minute'
          where run_id = 'run-1' and id = $1`,
        [leasedTaskId]
      );
      await expect(deAdmitUnleasedPlannerTail(transactionHost(), {
        runId: "run-1",
        keepThroughSequence: 0
      })).resolves.toBe(1);
      await expect(admin.query(
        `select canonical_sequence, admitted_at is not null as admitted
           from unified_check_planner_entries
          where run_id = 'run-1' and canonical_sequence <= 2
          order by canonical_sequence`
      )).resolves.toMatchObject({
        rows: [
          { canonical_sequence: "0", admitted: true },
          { canonical_sequence: "1", admitted: false },
          { canonical_sequence: "2", admitted: true }
        ]
      });

      await expect(planUnifiedOrderedTasks(transactionHost(), {
        runId: "missing-run",
        tasks: [task("orphan", "address_history", "orphan")]
      })).rejects.toThrow("unified_planner_run_missing");
      expect((await admin.query(
        "select count(*)::int as count from unified_check_tasks where id = 'orphan'"
      )).rows[0]?.count).toBe(0);

      await admin.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256, fairness_owner_id
        ) values ('run-2','analysis-2','TOther','RUNNING','synthetic_test',
          'isolated','manifest-2','run-2')`
      );
      await admin.query(
        `insert into unified_check_tasks (
          id, run_id, kind, status, priority_lane, logical_key
        ) values ('cross-run-id','run-2','existing','QUEUED','background','main')`
      );
      await expect(planUnifiedOrderedTasks(transactionHost(), {
        runId: "run-1",
        tasks: [
          task("rolled-back-first", "aaa", "main"),
          task("cross-run-id", "zzz", "main")
        ]
      })).rejects.toThrow();
      expect((await admin.query(
        `select count(*)::int as count
           from unified_check_tasks
          where run_id = 'run-1' and kind in ('aaa','zzz')`
      )).rows[0]?.count).toBe(0);
    } finally {
      await admin.query(`drop schema if exists "${schema}" cascade`);
      admin.release();
      await pool.end();
    }
  });
});
