import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  loadUnifiedProviderRunDemand
} from "../../src/unifiedCheck/adaptiveRuntime";
import {
  loadUnifiedBoundedReadyPrefix,
  planUnifiedOrderedTasks,
  refillOrderedAdmissions
} from "../../src/unifiedCheck/plannerRepository";
import {
  createUnifiedReconciliation
} from "../../src/unifiedCheck/reconciliation";
import {
  checkpointUnifiedTask,
  claimUnifiedTask,
  completeUnifiedTaskAttempt,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const OLD_HEAD = "c".repeat(64);
const NEXT_HEAD = "d".repeat(64);

function transactionHost(
  pool: pg.Pool,
  schema: string
): UnifiedTransactionalQueryable {
  return {
    query: (sql, values) => pool.query(sql, values as unknown[]),
    async transaction<T>(work: (client: UnifiedQueryable) => Promise<T>) {
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
  };
}

postgresDescribe("Unified reconciliation PostgreSQL recovery", () => {
  it("discovers durable work after restart and leaves an empty tick unchanged", async () => {
    const pool = new pg.Pool({ connectionString, max: 2 });
    const db = await pool.connect();
    const schema = `unifiedreconcile_${randomUUID().replaceAll("-", "")}`;
    try {
      await db.query(`create schema "${schema}"`);
      await db.query(`set search_path to "${schema}"`);
      await db.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await db.query(
        await readFile(
          "migrations/034_unified_check_adaptive_planner.sql",
          "utf8"
        )
      );
      await db.query(
        `insert into unified_check_runs (
           id, analysis_key_sha256, subject_address, status, run_purpose,
           side_effect_policy, analysis_manifest_sha256, fairness_owner_id
         ) values (
           'run-1',$1,'TSubject','RUNNING','synthetic_test',
           'isolated',$2,'owner-1'
         )`,
        ["a".repeat(64), "b".repeat(64)]
      );
      await db.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values (
           $1,'run-1','analysis_manifest','1','{}'::jsonb
         )`,
        ["b".repeat(64)]
      );
      await db.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key
         ) values (
           'direct-1','run-1','direct_history','QUEUED',
           'interactive','main'
         )`
      );
      const updatedAt = String((await db.query(
        "select updated_at from unified_check_tasks where id = 'direct-1'"
      )).rows[0]?.updated_at);
      const runCycle = async () => {
        const demand = await loadUnifiedProviderRunDemand({
          query: (sql, values) => db.query(sql, values as unknown[])
        }, {
          now: new Date("2099-01-01T00:00:00.000Z"),
          providerAvailable: true,
          readyBufferMaxEntries: 10,
          readyBufferMaxBytes: 10_000
        });
        return {
          actionableWorkFound: demand.length > 0,
          admitted: 0,
          wokenSlots: demand.reduce(
            (sum, item) => sum + item.eligibleReadyWork,
            0
          )
        };
      };

      const restarted = createUnifiedReconciliation({
        intervalMs: 30_000,
        runCycle,
        onResult() {
          throw new Error("metrics unavailable");
        }
      });
      await expect(restarted.tick()).resolves.toEqual({
        actionableWorkFound: true,
        admitted: 0,
        wokenSlots: 1
      });
      expect(String((await db.query(
        "select updated_at from unified_check_tasks where id = 'direct-1'"
      )).rows[0]?.updated_at)).toBe(updatedAt);

      await db.query(
        "update unified_check_tasks set status = 'CANCELLED' where id = 'direct-1'"
      );
      const emptyUpdatedAt = String((await db.query(
        "select updated_at from unified_check_tasks where id = 'direct-1'"
      )).rows[0]?.updated_at);
      await expect(restarted.tick()).resolves.toEqual({
        actionableWorkFound: false,
        admitted: 0,
        wokenSlots: 0
      });
      expect(String((await db.query(
        "select updated_at from unified_check_tasks where id = 'direct-1'"
      )).rows[0]?.updated_at)).toBe(emptyUpdatedAt);
      await restarted.stop();
    } finally {
      await db.query(`drop schema if exists "${schema}" cascade`);
      db.release();
      await pool.end();
    }
  });

  it("commits an accepted ordered head after restart and refills the durable tail", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const db = await pool.connect();
    const schema = `unifiedreconcilecommit_${randomUUID().replaceAll("-", "")}`;
    const host = transactionHost(pool, schema);
    try {
      await db.query(`create schema "${schema}"`);
      await db.query(`set search_path to "${schema}"`);
      await db.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await db.query(
        await readFile(
          "migrations/034_unified_check_adaptive_planner.sql",
          "utf8"
        )
      );
      await db.query(
        `insert into unified_check_runs (
           id, analysis_key_sha256, subject_address, status, run_purpose,
           side_effect_policy, analysis_manifest_sha256, fairness_owner_id
         ) values (
           'run-1',$1,'TSubject','RUNNING','synthetic_test',
           'isolated',$2,'owner-1'
         )`,
        ["a".repeat(64), "b".repeat(64)]
      );
      await db.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values (
           $1,'run-1','analysis_manifest','1','{}'::jsonb
         )`,
        ["b".repeat(64)]
      );
      await planUnifiedOrderedTasks(host, {
        runId: "run-1",
        tasks: [0, 1, 2].map((sequence) => ({
          taskId: `ordered-${sequence}`,
          kind: "provider_ordered",
          logicalKey: `key-${sequence}`,
          priorityLane: "interactive" as const,
          checkpoint: { sequence }
        }))
      });
      await refillOrderedAdmissions(host, {
        runId: "run-1",
        policy: "barrier",
        lookaheadTarget: 1,
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 10_000,
        reservedBufferMaxBytes: 300,
        reservationBytesPerTask: 100,
        now: new Date("2099-01-01T00:00:00.000Z")
      });
      const provider = await claimUnifiedTask(db, {
        workerId: "provider-before-restart",
        leaseToken: "provider-lease",
        leaseMs: 30_000,
        kinds: ["provider_ordered"],
        runId: "run-1",
        priorityLane: "interactive",
        fairnessOwnerId: "owner-1"
      });
      expect(provider?.id).toBe("ordered-0");
      const acceptedArtifact = {
        version: "provider-manifest-v1",
        logicalKey: "key-0",
        rows: [1, 2, 3]
      };
      const acceptedSha256 = fingerprintCanonicalArtifact(acceptedArtifact);
      const resultBytes = Buffer.byteLength(
        canonicalizeArtifactJson(acceptedArtifact),
        "utf8"
      );
      await completeUnifiedTaskAttempt(host, {
        taskId: "ordered-0",
        leaseToken: "provider-lease",
        attempt: Number(provider?.attempt),
        attemptId: "accepted-ordered-0",
        artifactSha256: acceptedSha256,
        acceptedArtifact: {
          kind: "provider_manifest",
          schemaVersion: "1",
          value: acceptedArtifact
        },
        manifestMaxBytes: 10_000
      });
      await db.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key, attempt,
           lease_owner, lease_token, lease_expires_at, heartbeat_at,
           checkpoint_json
         ) values (
           'traversal-1','run-1','traversal','LEASED','interactive','main',1,
           'analysis-after-restart','traversal-lease',
           statement_timestamp() + interval '1 minute',
           statement_timestamp(),$1::jsonb
         )`,
        [JSON.stringify({
          version: "unified-production-traversal-checkpoint-v2",
          deltaHeadSha256: OLD_HEAD
        })]
      );

      let restarted: ReturnType<typeof createUnifiedReconciliation>;
      const runCycle = async () => {
        const prefix = await loadUnifiedBoundedReadyPrefix(db, {
          runId: "run-1",
          maxEntries: 2,
          maxBytes: 10_000,
          expectedTaskKind: "provider_ordered",
          expectedArtifactKind: "provider_manifest",
          expectedArtifactSchemaVersion: "1"
        });
        if (prefix.length > 0) {
          const committed = await checkpointUnifiedTask(host, {
            taskId: "traversal-1",
            leaseToken: "traversal-lease",
            attempt: 1,
            checkpoint: {
              version: "unified-production-traversal-checkpoint-v2",
              deltaHeadSha256: NEXT_HEAD
            },
            barrierReservedBytes: 100,
            orderedCommit: {
              runId: "run-1",
              expectedDeltaHeadSha256: OLD_HEAD,
              entries: prefix.map((entry) => ({
                canonicalSequence: entry.canonicalSequence,
                taskId: entry.taskId,
                logicalKey: entry.logicalKey,
                acceptedAttemptId: entry.acceptedAttemptId,
                resultBytes: entry.resultBytes,
                taskKind: entry.taskKind,
                artifactKind: entry.artifactKind,
                artifactSchemaVersion: entry.artifactSchemaVersion
              })),
              discoveredTasks: []
            }
          });
          restarted.wake();
          return {
            actionableWorkFound: true,
            admitted: committed?.next_head_newly_admitted === true ? 1 : 0,
            wokenSlots: 0
          };
        }
        const refill = await refillOrderedAdmissions(host, {
          runId: "run-1",
          policy: "rolling",
          lookaheadTarget: 2,
          readyBufferMaxEntries: 10,
          readyBufferMaxBytes: 10_000,
          reservedBufferMaxBytes: 300,
          reservationBytesPerTask: 100,
          now: new Date("2099-01-01T00:00:00.000Z")
        });
        return {
          actionableWorkFound: refill.admittedTaskIds.length > 0,
          admitted: refill.admittedTaskIds.length,
          wokenSlots: refill.admittedTaskIds.length
        };
      };
      restarted = createUnifiedReconciliation({
        intervalMs: 30_000,
        runCycle,
        onResult() {
          throw new Error("metrics unavailable");
        }
      });

      await restarted.tick();
      expect((await db.query(
        `select canonical_sequence, task_id, planner_state,
                admitted_at is not null as admitted, reserved_bytes
           from unified_check_planner_entries
          where run_id = 'run-1'
          order by canonical_sequence`
      )).rows).toEqual([
        {
          canonical_sequence: "0",
          task_id: "ordered-0",
          planner_state: "committed",
          admitted: true,
          reserved_bytes: null
        },
        {
          canonical_sequence: "1",
          task_id: "ordered-1",
          planner_state: "planned",
          admitted: true,
          reserved_bytes: "100"
        },
        {
          canonical_sequence: "2",
          task_id: "ordered-2",
          planner_state: "planned",
          admitted: true,
          reserved_bytes: "100"
        }
      ]);
      const traversal = (await db.query(
        `select status, checkpoint_json
           from unified_check_tasks
          where id = 'traversal-1'`
      )).rows[0];
      expect(traversal?.status).toBe("QUEUED");
      expect(traversal?.checkpoint_json).toMatchObject({
        deltaHeadSha256: NEXT_HEAD
      });
      expect((await db.query(
        `select artifact_sha256
           from unified_check_attempts
          where id = 'accepted-ordered-0'`
      )).rows[0]?.artifact_sha256).toBe(acceptedSha256);

      const beforeEmptyTick = (await db.query(
        `select updated_at from unified_check_tasks where id = 'ordered-1'`
      )).rows[0]?.updated_at;
      await restarted.tick();
      expect((await db.query(
        `select updated_at from unified_check_tasks where id = 'ordered-1'`
      )).rows[0]?.updated_at).toEqual(beforeEmptyTick);
      await restarted.stop();
      expect(resultBytes).toBeGreaterThan(0);
    } finally {
      await db.query(`drop schema if exists "${schema}" cascade`);
      db.release();
      await pool.end();
    }
  });
});
