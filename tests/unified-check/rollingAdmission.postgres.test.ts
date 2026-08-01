import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  planUnifiedOrderedTasks,
  refillOrderedAdmissions
} from "../../src/unifiedCheck/plannerRepository";
import {
  claimUnifiedTask,
  completeUnifiedTaskAttempt,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
// Keep the deterministic controller clock above the database clock; production
// admission still caps it with statement_timestamp().
const NOW = new Date("2099-01-01T00:00:00.000Z");

postgresDescribe("Unified rolling admission PostgreSQL concurrency", () => {
  it("serializes refill, isolates run buffers and preserves claim/acceptance invariants", async () => {
    const pool = new pg.Pool({ connectionString, max: 6 });
    const admin = await pool.connect();
    const schema = `unifiedrolling_${randomUUID().replaceAll("-", "")}`;
    const directDb: UnifiedQueryable = {
      query: (sql, values) => admin.query(sql, values as unknown[])
    };
    const host = (): UnifiedTransactionalQueryable => ({
      query: (sql, values) => pool.query(sql, values as unknown[]),
      async transaction<T>(
        work: (client: UnifiedQueryable) => Promise<T>
      ): Promise<T> {
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
    const refill = (
      runId: string,
      overrides: Partial<Parameters<typeof refillOrderedAdmissions>[1]> = {}
    ) => refillOrderedAdmissions(host(), {
      runId,
      policy: "rolling",
      lookaheadTarget: 3,
      readyBufferMaxEntries: 10,
      readyBufferMaxBytes: 10_000,
      reservedBufferMaxBytes: 200,
      reservationBytesPerTask: 100,
      now: NOW,
      ...overrides
    });
    const plan = (runId: string, count: number) =>
      planUnifiedOrderedTasks(host(), {
        runId,
        tasks: Array.from({ length: count }, (_, sequence) => ({
          taskId: `${runId}-ordered-${sequence}`,
          kind: "provider_ordered",
          logicalKey: `ordered-${sequence}`,
          priorityLane: "interactive" as const,
          checkpoint: { version: "rolling-admission-test-v1", sequence }
        }))
      });
    try {
      await admin.query(`create schema "${schema}"`);
      await admin.query(`set search_path to "${schema}"`);
      await admin.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await admin.query(
        await readFile(
          "migrations/034_unified_check_adaptive_planner.sql",
          "utf8"
        )
      );
      for (const runId of [
        "run-1",
        "run-2",
        "run-3",
        "run-4",
        "run-5",
        "run-6"
      ]) {
        const analysisKeySha256 = fingerprintCanonicalArtifact({
          kind: "rolling-test-analysis-key",
          runId
        });
        const manifestSha256 = fingerprintCanonicalArtifact({
          kind: "rolling-test-manifest",
          runId
        });
        await admin.query(
          `insert into unified_check_runs (
             id, analysis_key_sha256, subject_address, status, run_purpose,
             side_effect_policy, analysis_manifest_sha256, fairness_owner_id
           ) values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$1)`,
          [runId, analysisKeySha256, `TSubject-${runId}`, manifestSha256]
        );
        await admin.query(
          `insert into unified_check_artifacts (
             sha256, created_by_run_id, kind, schema_version, artifact_json
           ) values ($1,$2,'analysis_manifest','1',$3::jsonb)`,
          [
            manifestSha256,
            runId,
            JSON.stringify({ runtimeCommit: "candidate" })
          ]
        );
      }

      await plan("run-1", 4);
      const concurrent = await Promise.all([
        refill("run-1"),
        refill("run-1")
      ]);
      expect(new Set(
        concurrent.flatMap((result) => result.admittedTaskIds)
      ).size).toBe(2);
      await expect(admin.query(
        `select count(*)::int as admitted,
                coalesce(sum(reserved_bytes), 0)::bigint as reserved
           from unified_check_planner_entries
          where run_id = 'run-1' and admitted_at is not null`
      )).resolves.toMatchObject({
        rows: [{ admitted: 2, reserved: "200" }]
      });

      const admittedRows = (await admin.query(
        `select entry.task_id
           from unified_check_planner_entries entry
          where entry.run_id = 'run-1' and entry.admitted_at is not null
          order by entry.canonical_sequence`
      )).rows;
      const leasedTaskId = String(admittedRows.at(-1)?.task_id);
      await admin.query(
        `update unified_check_tasks
            set status = 'LEASED', lease_owner = 'worker',
                lease_token = 'lease-tail',
                lease_expires_at = statement_timestamp() + interval '1 minute'
          where id = $1`,
        [leasedTaskId]
      );
      await refill("run-1", { lookaheadTarget: 0 });
      await expect(admin.query(
        `select entry.task_id, entry.admitted_at is not null as admitted,
                task.status
           from unified_check_planner_entries entry
           join unified_check_tasks task
             on task.run_id = entry.run_id and task.id = entry.task_id
          where entry.run_id = 'run-1'
            and entry.canonical_sequence < 2
          order by entry.canonical_sequence`
      )).resolves.toMatchObject({
        rows: expect.arrayContaining([
          { task_id: leasedTaskId, admitted: true, status: "LEASED" },
          expect.objectContaining({ admitted: false })
        ])
      });
      await admin.query(
        `update unified_check_tasks
            set lease_expires_at = statement_timestamp() - interval '1 second'
          where id = $1`,
        [leasedTaskId]
      );
      await refill("run-1", { lookaheadTarget: 0 });
      await expect(admin.query(
        `select admitted_at is not null as admitted
           from unified_check_planner_entries
          where run_id = 'run-1' and task_id = $1`,
        [leasedTaskId]
      )).resolves.toMatchObject({ rows: [{ admitted: false }] });

      await plan("run-2", 1);
      await expect(claimUnifiedTask(directDb, {
        workerId: "provider-before-admission",
        leaseToken: "lease-before-admission",
        leaseMs: 30_000,
        kinds: ["provider_ordered"],
        runtimeCommit: "candidate"
      })).resolves.toBeNull();
      await refill("run-2", { lookaheadTarget: 1 });
      const orderedClaim = await claimUnifiedTask(directDb, {
        workerId: "provider-after-admission",
        leaseToken: "lease-after-admission",
        leaseMs: 30_000,
        kinds: ["provider_ordered"],
        runtimeCommit: "candidate"
      });
      expect(orderedClaim?.id).toBe("run-2-ordered-0");

      await plan("run-6", 2);
      await refill("run-6", { lookaheadTarget: 1 });
      await admin.query(
        `update unified_check_tasks
            set status = 'WAITING_RETRY',
                ready_at = statement_timestamp() + interval '1 hour'
          where id = 'run-6-ordered-0'`
      );
      await expect(refill("run-6", {
        lookaheadTarget: 1
      })).resolves.toMatchObject({
        admittedTaskIds: ["run-6-ordered-1"],
        deAdmittedTaskIds: ["run-6-ordered-0"]
      });
      await refill("run-6", { lookaheadTarget: 0 });

      await plan("run-3", 4);
      for (const sequence of [1, 2]) {
        const taskId = `run-3-ordered-${sequence}`;
        const artifact = { version: "ready-buffer-v1", sequence };
        const artifactSha256 = fingerprintCanonicalArtifact(artifact);
        const attemptId = `run-3-attempt-${sequence}`;
        await admin.query(
          `insert into unified_check_artifacts (
             sha256, created_by_run_id, kind, schema_version, artifact_json
           ) values ($1,'run-3','provider_manifest','1',$2::jsonb)`,
          [artifactSha256, JSON.stringify(artifact)]
        );
        await admin.query(
          `insert into unified_check_attempts (
             id, task_id, attempt, artifact_sha256, completed_at
           ) values ($1,$2,1,$3,statement_timestamp())`,
          [attemptId, taskId, artifactSha256]
        );
        await admin.query(
          `update unified_check_tasks
              set status = 'COMPLETED', attempt = 1,
                  accepted_attempt_id = $2
            where id = $1`,
          [taskId, attemptId]
        );
        await admin.query(
          `update unified_check_planner_entries
              set planner_state = 'ready',
                  admitted_at = statement_timestamp(),
                  reserved_bytes = null,
                  result_bytes = $2,
                  ready_at = statement_timestamp()
            where run_id = 'run-3' and task_id = $1`,
          [
            taskId,
            Buffer.byteLength(canonicalizeArtifactJson(artifact), "utf8")
          ]
        );
      }
      const headThroughFullBuffer = await refill("run-3", {
        lookaheadTarget: 2,
        readyBufferMaxEntries: 1,
        readyBufferMaxBytes: 1
      });
      expect(headThroughFullBuffer).toMatchObject({
        admittedTaskIds: ["run-3-ordered-0"],
        blocker: "merge_buffer_full"
      });
      await refill("run-3", { lookaheadTarget: 0 });

      await plan("run-4", 1);
      await expect(refill("run-4", {
        lookaheadTarget: 1
      })).resolves.toMatchObject({
        admittedTaskIds: ["run-4-ordered-0"]
      });
      const acceptedClaim = await claimUnifiedTask(directDb, {
        workerId: "provider-acceptance",
        leaseToken: "lease-acceptance",
        leaseMs: 30_000,
        kinds: ["provider_ordered"],
        runtimeCommit: "candidate"
      });
      expect(acceptedClaim?.id).toBe("run-4-ordered-0");
      const acceptedValue = { version: "provider-manifest-v1", rows: [1, 2] };
      const acceptedSha256 = fingerprintCanonicalArtifact(acceptedValue);
      const acceptedBytes = Buffer.byteLength(
        canonicalizeArtifactJson(acceptedValue),
        "utf8"
      );
      await expect(completeUnifiedTaskAttempt(host(), {
        taskId: "run-4-ordered-0",
        leaseToken: "lease-acceptance",
        attempt: 1,
        attemptId: "run-4-attempt-1",
        artifactSha256: acceptedSha256,
        acceptedArtifact: {
          kind: "provider_manifest",
          schemaVersion: "1",
          value: acceptedValue
        },
        manifestMaxBytes: acceptedBytes - 1
      })).rejects.toThrow("unified_ordered_manifest_hard_limit");
      await expect(admin.query(
        `select planner_state, reserved_bytes, result_bytes
           from unified_check_planner_entries
          where run_id = 'run-4' and task_id = 'run-4-ordered-0'`
      )).resolves.toMatchObject({
        rows: [{
          planner_state: "planned",
          reserved_bytes: "100",
          result_bytes: null
        }]
      });
      await completeUnifiedTaskAttempt(host(), {
        taskId: "run-4-ordered-0",
        leaseToken: "lease-acceptance",
        attempt: 1,
        attemptId: "run-4-attempt-1",
        artifactSha256: acceptedSha256,
        acceptedArtifact: {
          kind: "provider_manifest",
          schemaVersion: "1",
          value: acceptedValue
        },
        manifestMaxBytes: acceptedBytes
      });
      await expect(admin.query(
        `select planner_state, reserved_bytes, result_bytes
           from unified_check_planner_entries
          where run_id = 'run-4' and task_id = 'run-4-ordered-0'`
      )).resolves.toMatchObject({
        rows: [{
          planner_state: "ready",
          reserved_bytes: null,
          result_bytes: String(acceptedBytes)
        }]
      });

      await admin.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key
         ) values (
           'run-5-independent','run-5','provider_independent','QUEUED',
           'interactive','independent'
         )`
      );
      await expect(claimUnifiedTask(directDb, {
        workerId: "provider-independent",
        leaseToken: "lease-independent",
        leaseMs: 30_000,
        kinds: ["provider_independent"],
        runtimeCommit: "candidate"
      })).resolves.toMatchObject({ id: "run-5-independent" });
    } finally {
      await admin.query(`drop schema if exists "${schema}" cascade`);
      admin.release();
      await pool.end();
    }
  });
});
