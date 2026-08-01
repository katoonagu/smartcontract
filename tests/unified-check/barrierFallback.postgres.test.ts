import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  createPostgresUnifiedAdmissionRuntimeControl
} from "../../src/unifiedCheck/admissionRuntimeControl";
import {
  loadUnifiedBoundedReadyPrefix,
  planUnifiedOrderedTasks,
  refillOrderedAdmissions
} from "../../src/unifiedCheck/plannerRepository";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import {
  checkpointUnifiedTask,
  claimUnifiedTask,
  completeUnifiedTaskAttempt
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const NOW = new Date("2099-01-01T00:00:00.000Z");
const OLD_HEAD = "e".repeat(64);

function frozenProviderArtifact(sequence: number) {
  return {
    version: "provider-manifest-v1",
    logicalKey: `key-${sequence}`,
    rows: [`canonical-${sequence}`]
  };
}

function nextCanonicalHead(
  previousDeltaHeadSha256: string,
  artifactSha256: string
): string {
  return fingerprintCanonicalArtifact({
    version: "frozen-canonical-delta-v1",
    previousDeltaHeadSha256,
    artifactSha256
  });
}

postgresDescribe("Unified hot barrier fallback", () => {
  it("lets a leased chunk checkpoint, de-admits its tail, then accepts and commits the canonical head", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const admin = await pool.connect();
    const schema = `unifiedfallback_${randomUUID().replaceAll("-", "")}`;
    const host: UnifiedTransactionalQueryable = {
      query: (sql, values) => pool.query(sql, values as unknown[]),
      async transaction<T>(
        work: (client: UnifiedQueryable) => Promise<T>
      ): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(`set local search_path to "${schema}"`);
          const result = await work({
            query: (sql, values) =>
              client.query(sql, values as unknown[])
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
      await admin.query(
        `insert into unified_check_runs (
           id, analysis_key_sha256, subject_address, status, run_purpose,
           side_effect_policy, analysis_manifest_sha256, fairness_owner_id
         ) values (
           'run-1',$1,'TSubject','RUNNING','synthetic_test',
           'isolated',$2,'owner-1'
         )`,
        ["a".repeat(64), "b".repeat(64)]
      );
      await admin.query(
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
          taskId: `task-${sequence}`,
          kind: "provider_ordered",
          logicalKey: `key-${sequence}`,
          priorityLane: "interactive" as const,
          checkpoint: { sequence }
        }))
      });
      const control = createPostgresUnifiedAdmissionRuntimeControl({
        db: host,
        initialPolicy: "rolling",
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 10_000,
        reservedBufferMaxBytes: 300,
        reservationBytesPerTask: 100,
        now: () => NOW,
        wake() {}
      });
      const refill = () => control.runControllerCycle((policy) =>
        refillOrderedAdmissions(host, {
          runId: "run-1",
          policy,
          lookaheadTarget: 3,
          readyBufferMaxEntries: 10,
          readyBufferMaxBytes: 10_000,
          reservedBufferMaxBytes: 300,
          reservationBytesPerTask: 100,
          now: NOW
        })
      );
      await refill();
      await admin.query(
        `update unified_check_tasks
            set status = 'LEASED', lease_owner = 'worker',
                lease_token = 'leased-tail',
                lease_expires_at = statement_timestamp() + interval '1 minute'
          where id = 'task-2'`
      );

      await expect(control.switchToBarrier()).resolves.toMatchObject({
        changed: true,
        runIds: ["run-1"],
        deAdmittedTaskIds: ["task-1"]
      });
      expect((await admin.query(
        `select entry.task_id, entry.admitted_at is not null as admitted,
                task.status
           from unified_check_planner_entries entry
           join unified_check_tasks task
             on task.run_id = entry.run_id and task.id = entry.task_id
          where entry.run_id = 'run-1'
          order by entry.canonical_sequence`
      )).rows).toEqual([
        { task_id: "task-0", admitted: true, status: "QUEUED" },
        { task_id: "task-1", admitted: false, status: "QUEUED" },
        { task_id: "task-2", admitted: true, status: "LEASED" }
      ]);

      await admin.query(
        `update unified_check_tasks
            set attempt = 0
          where id = 'task-2'`
      );
      await expect(checkpointUnifiedTask(admin, {
        taskId: "task-2",
        leaseToken: "leased-tail",
        attempt: 0,
        checkpoint: {
          version: "bounded-provider-chunk-v1",
          workUnits: 1
        }
      })).resolves.toMatchObject({
        status: "QUEUED"
      });
      await refill();
      expect((await admin.query(
        `select task_id
           from unified_check_planner_entries
          where run_id = 'run-1' and admitted_at is not null
          order by canonical_sequence`
      )).rows).toEqual([{ task_id: "task-0" }]);

      const claimedHead = await claimUnifiedTask(admin, {
        workerId: "provider-barrier",
        leaseToken: "head-lease",
        leaseMs: 30_000,
        kinds: ["provider_ordered"],
        runId: "run-1",
        priorityLane: "interactive",
        fairnessOwnerId: "owner-1"
      });
      expect(claimedHead?.id).toBe("task-0");
      const acceptedArtifact = frozenProviderArtifact(0);
      const artifactSha256 = fingerprintCanonicalArtifact(acceptedArtifact);
      const nextHead = nextCanonicalHead(OLD_HEAD, artifactSha256);
      const resultBytes = Buffer.byteLength(
        canonicalizeArtifactJson(acceptedArtifact),
        "utf8"
      );
      await completeUnifiedTaskAttempt(host, {
        taskId: "task-0",
        leaseToken: "head-lease",
        attempt: Number(claimedHead?.attempt),
        attemptId: "attempt-task-0",
        artifactSha256,
        acceptedArtifact: {
          kind: "provider_manifest",
          schemaVersion: "1",
          value: acceptedArtifact
        },
        manifestMaxBytes: 10_000
      });
      const prefix = await loadUnifiedBoundedReadyPrefix(admin, {
        runId: "run-1",
        maxEntries: 2,
        maxBytes: 10_000,
        expectedTaskKind: "provider_ordered",
        expectedArtifactKind: "provider_manifest",
        expectedArtifactSchemaVersion: "1"
      });
      expect(prefix).toHaveLength(1);
      await admin.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key, attempt,
           lease_owner, lease_token, lease_expires_at, heartbeat_at,
           checkpoint_json
         ) values (
           'traversal-1','run-1','traversal','LEASED','interactive','main',1,
           'analysis-barrier','traversal-lease',
           statement_timestamp() + interval '1 minute',
           statement_timestamp(),$1::jsonb
         )`,
        [JSON.stringify({
          version: "unified-production-traversal-checkpoint-v2",
          deltaHeadSha256: OLD_HEAD
        })]
      );
      await checkpointUnifiedTask(host, {
        taskId: "traversal-1",
        leaseToken: "traversal-lease",
        attempt: 1,
        checkpoint: {
            version: "unified-production-traversal-checkpoint-v2",
            deltaHeadSha256: nextHead
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
      expect((await admin.query(
        `select canonical_sequence, task_id, planner_state,
                admitted_at is not null as admitted, reserved_bytes
           from unified_check_planner_entries
          where run_id = 'run-1'
          order by canonical_sequence`
      )).rows).toEqual([
        {
          canonical_sequence: "0",
          task_id: "task-0",
          planner_state: "committed",
          admitted: true,
          reserved_bytes: null
        },
        {
          canonical_sequence: "1",
          task_id: "task-1",
          planner_state: "planned",
          admitted: true,
          reserved_bytes: "100"
        },
        {
          canonical_sequence: "2",
          task_id: "task-2",
          planner_state: "planned",
          admitted: false,
          reserved_bytes: null
        }
      ]);
      expect((await admin.query(
        `select attempt.artifact_sha256, artifact.artifact_json
           from unified_check_attempts attempt
           join unified_check_artifacts artifact
             on artifact.sha256 = attempt.artifact_sha256
          where attempt.id = 'attempt-task-0'`
      )).rows[0]).toMatchObject({
        artifact_sha256: artifactSha256,
        artifact_json: acceptedArtifact
      });
      expect(resultBytes).toBe(prefix[0]?.resultBytes);
      expect((await admin.query(
        `select checkpoint_json from unified_check_tasks
          where id = 'traversal-1'`
      )).rows[0]?.checkpoint_json).toMatchObject({
        deltaHeadSha256: nextHead
      });

      const commitFrozenEntry = async (input: {
        runId: string;
        ownerId: string;
        taskId: string;
        traversalTaskId: string;
        sequence: number;
        currentHead: string;
      }): Promise<string> => {
        const providerLease = `provider-${input.runId}-${input.sequence}`;
        const claim = await claimUnifiedTask(admin, {
          workerId: "provider-barrier",
          leaseToken: providerLease,
          leaseMs: 30_000,
          kinds: ["provider_ordered"],
          runId: input.runId,
          priorityLane: "interactive",
          fairnessOwnerId: input.ownerId
        });
        expect(claim?.id).toBe(input.taskId);
        const artifact = frozenProviderArtifact(input.sequence);
        const sha256 = fingerprintCanonicalArtifact(artifact);
        await completeUnifiedTaskAttempt(host, {
          taskId: input.taskId,
          leaseToken: providerLease,
          attempt: Number(claim?.attempt),
          attemptId: `attempt-${input.runId}-${input.sequence}`,
          artifactSha256: sha256,
          acceptedArtifact: {
            kind: "provider_manifest",
            schemaVersion: "1",
            value: artifact
          },
          manifestMaxBytes: 10_000
        });
        const ready = await loadUnifiedBoundedReadyPrefix(admin, {
          runId: input.runId,
          maxEntries: 1,
          maxBytes: 10_000,
          expectedTaskKind: "provider_ordered",
          expectedArtifactKind: "provider_manifest",
          expectedArtifactSchemaVersion: "1"
        });
        expect(ready.map((entry) => entry.taskId)).toEqual([input.taskId]);
        const traversalLease =
          `traversal-${input.runId}-${input.sequence}`;
        const leased = await admin.query(
          `update unified_check_tasks
              set status = 'LEASED', attempt = attempt + 1,
                  lease_owner = 'analysis-barrier',
                  lease_token = $2,
                  lease_expires_at =
                    statement_timestamp() + interval '1 minute',
                  heartbeat_at = statement_timestamp()
            where id = $1 and status = 'QUEUED'
            returning attempt`,
          [input.traversalTaskId, traversalLease]
        );
        expect(leased.rows).toHaveLength(1);
        const next = nextCanonicalHead(input.currentHead, sha256);
        await checkpointUnifiedTask(host, {
          taskId: input.traversalTaskId,
          leaseToken: traversalLease,
          attempt: Number(leased.rows[0]?.attempt),
          checkpoint: {
            version: "unified-production-traversal-checkpoint-v2",
            deltaHeadSha256: next
          },
          barrierReservedBytes: 100,
          orderedCommit: {
            runId: input.runId,
            expectedDeltaHeadSha256: input.currentHead,
            entries: ready.map((entry) => ({
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
        return next;
      };

      let fallbackHead = nextHead;
      for (const sequence of [1, 2]) {
        fallbackHead = await commitFrozenEntry({
          runId: "run-1",
          ownerId: "owner-1",
          taskId: `task-${sequence}`,
          traversalTaskId: "traversal-1",
          sequence,
          currentHead: fallbackHead
        });
      }

      const twinManifest = { frozenTwin: true };
      const twinManifestSha256 =
        fingerprintCanonicalArtifact(twinManifest);
      await admin.query(
        `insert into unified_check_runs (
           id, analysis_key_sha256, subject_address, status, run_purpose,
           side_effect_policy, analysis_manifest_sha256, fairness_owner_id
         ) values (
           'barrier-twin',$1,'TTwin','RUNNING','synthetic_test',
           'isolated',$2,'owner-twin'
         )`,
        [
          fingerprintCanonicalArtifact({ analysis: "barrier-twin" }),
          twinManifestSha256
        ]
      );
      await admin.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values (
           $1,'barrier-twin','analysis_manifest','1',$2::jsonb
         )`,
        [twinManifestSha256, JSON.stringify(twinManifest)]
      );
      await planUnifiedOrderedTasks(host, {
        runId: "barrier-twin",
        tasks: [0, 1, 2].map((sequence) => ({
          taskId: `twin-task-${sequence}`,
          kind: "provider_ordered",
          logicalKey: `key-${sequence}`,
          priorityLane: "interactive" as const,
          checkpoint: { sequence }
        }))
      });
      await control.runControllerCycle((policy) =>
        refillOrderedAdmissions(host, {
          runId: "barrier-twin",
          policy,
          lookaheadTarget: 3,
          readyBufferMaxEntries: 10,
          readyBufferMaxBytes: 10_000,
          reservedBufferMaxBytes: 300,
          reservationBytesPerTask: 100,
          now: NOW
        })
      );
      await admin.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key,
           checkpoint_json
         ) values (
           'traversal-twin','barrier-twin','traversal','QUEUED',
           'interactive','main',$1::jsonb
         )`,
        [JSON.stringify({
          version: "unified-production-traversal-checkpoint-v2",
          deltaHeadSha256: OLD_HEAD
        })]
      );
      let twinHead = OLD_HEAD;
      for (const sequence of [0, 1, 2]) {
        twinHead = await commitFrozenEntry({
          runId: "barrier-twin",
          ownerId: "owner-twin",
          taskId: `twin-task-${sequence}`,
          traversalTaskId: "traversal-twin",
          sequence,
          currentHead: twinHead
        });
      }
      expect(fallbackHead).toBe(twinHead);
      const committedHashes = async (runId: string) => (
        await admin.query(
          `select attempt.artifact_sha256
             from unified_check_planner_entries entry
             join unified_check_tasks task
               on task.run_id = entry.run_id and task.id = entry.task_id
             join unified_check_attempts attempt
               on attempt.id = task.accepted_attempt_id
            where entry.run_id = $1
              and entry.planner_state = 'committed'
            order by entry.canonical_sequence`,
          [runId]
        )
      ).rows.map((row) => String(row.artifact_sha256));
      await expect(committedHashes("run-1")).resolves.toEqual(
        await committedHashes("barrier-twin")
      );
      const checkpointHeads = await admin.query(
        `select id, checkpoint_json->>'deltaHeadSha256' as delta_head
           from unified_check_tasks
          where id in ('traversal-1','traversal-twin')
          order by id`
      );
      expect(checkpointHeads.rows.map((row) => row.delta_head))
        .toEqual([fallbackHead, fallbackHead]);

      await admin.query(
        `insert into unified_check_runs (
           id, analysis_key_sha256, subject_address, status, run_purpose,
           side_effect_policy, analysis_manifest_sha256, fairness_owner_id
         ) values (
           'legacy-run',$1,'TLegacy','RUNNING',
           'synthetic_test','isolated',$2,'legacy-owner'
         )`,
        ["c".repeat(64), "d".repeat(64)]
      );
      await admin.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values (
           $1,'legacy-run','analysis_manifest','1','{}'::jsonb
         )`,
        ["d".repeat(64)]
      );
      await expect(refillOrderedAdmissions(host, {
        runId: "legacy-run",
        policy: "barrier",
        lookaheadTarget: 1,
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 10_000,
        reservedBufferMaxBytes: 100,
        reservationBytesPerTask: 100,
        now: NOW
      })).resolves.toEqual({
        admittedTaskIds: [],
        deAdmittedTaskIds: [],
        blocker: "no_ready_work"
      });
    } finally {
      await admin.query(`drop schema if exists "${schema}" cascade`);
      admin.release();
      await pool.end();
    }
  });
});
