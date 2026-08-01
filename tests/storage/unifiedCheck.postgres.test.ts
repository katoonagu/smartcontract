import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  fingerprintCanonicalArtifact,
  fingerprintCanonicalJson
} from "../../src/forensics/canonicalJson";
import {
  claimUnifiedTask,
  checkpointUnifiedTask,
  completeUnifiedTaskAttempt,
  createOrGetCheckRequest,
  createOrReuseUnifiedRun,
  createUnifiedDelivery,
  createUnifiedTasks,
  insertUnifiedArtifact,
  recordUnifiedTaskProviderDuration
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("Unified Check repository", () => {
  it("is idempotent, immutable and leases one task once", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const client = await pool.connect();
    const schema = `unifiedrepo_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      const scoped = {
        query: (sql: string, values?: readonly unknown[]) =>
          client.query(sql, values as unknown[])
      };
      const artifact = { stable: true };
      const runInput = {
        id: "run-a",
        analysisKeySha256: "a".repeat(64),
        subjectAddress: "TSubject",
        runPurpose: "synthetic_test" as const,
        sideEffectPolicy: "isolated" as const,
        analysisManifestSha256: fingerprintCanonicalJson(artifact)
      };
      const first = await createOrReuseUnifiedRun(scoped, runInput);
      const reused = await createOrReuseUnifiedRun(scoped, {
        ...runInput,
        id: "run-b"
      });
      expect(reused.id).toBe(first.id);
      const runId = String(first.id);

      const request = await createOrGetCheckRequest(scoped, {
        id: "request-a",
        requestCorrelationId: "correlation-a",
        subjectAddress: "TSubject",
        chatId: "chat",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "synthetic_test",
        sideEffectPolicy: "isolated"
      });
      const requestAgain = await createOrGetCheckRequest(scoped, {
        id: "request-b",
        requestCorrelationId: "correlation-a",
        subjectAddress: "TSubject",
        chatId: "chat",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "synthetic_test",
        sideEffectPolicy: "isolated"
      });
      expect(requestAgain.id).toBe(request.id);
      await expect(createOrGetCheckRequest(scoped, {
        id: "request-c",
        requestCorrelationId: "correlation-a",
        subjectAddress: "TDifferent",
        chatId: "chat",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "synthetic_test",
        sideEffectPolicy: "isolated"
      })).rejects.toThrow("unified_request_correlation_conflict");

      await insertUnifiedArtifact(scoped, {
        sha256: fingerprintCanonicalJson(artifact),
        createdByRunId: runId,
        kind: "analysis_manifest",
        schemaVersion: "1",
        artifact
      });
      const shadow = {
        schemaVersion: "service-role-shadow-profile-v1",
        policyVersion: "service-role-shadow-100-plus-100-v1",
        runId,
        snapshotHash: "b".repeat(64),
        subjectAddress: "TSubject",
        profiledAddress: "TProfiled",
        traversalStateId: "c".repeat(64),
        anchor: {
          timestamp: "2026-07-30T00:00:00.000Z",
          sourceEventIds: ["event-1"]
        },
        source: {
          evidenceClass: "accepted_history_reconstruction",
          manifestKey: "manifest-1",
          manifestSha256: "d".repeat(64),
          acceptedPageArtifactHashes: ["e".repeat(64)],
          eventRoleMapSha256: null,
          physicalPageRequestHashes: [],
          boundaryPageAuthority: false
        },
        sampledCanonicalEventIds: { recent: [], historical: [] },
        result: {
          status: "insufficient_data",
          insufficientReason: "role_map_missing",
          classifier: null
        },
        productionEffect: false
      } as const;
      const shadowSha256 = fingerprintCanonicalArtifact(shadow);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await insertUnifiedArtifact(scoped, {
          sha256: shadowSha256,
          createdByRunId: runId,
          kind: "service_role_shadow_profile",
          schemaVersion: "1",
          artifact: shadow
        });
      }
      const storedShadow = await client.query(
        `select sha256, created_by_run_id, kind, schema_version, artifact_json
           from unified_check_artifacts
          where sha256 = $1`,
        [shadowSha256]
      );
      expect(storedShadow.rows).toEqual([{
        sha256: shadowSha256,
        created_by_run_id: runId,
        kind: "service_role_shadow_profile",
        schema_version: "1",
        artifact_json: shadow
      }]);
      await expect(client.query(
        "update unified_check_artifacts set kind = 'mutated' where sha256 = $1",
        [shadowSha256]
      )).rejects.toThrow("unified_immutable_artifact_mutation");
      await expect(client.query(
        "delete from unified_check_artifacts where sha256 = $1",
        [shadowSha256]
      )).rejects.toThrow("unified_immutable_artifact_mutation");
      await createUnifiedTasks(scoped, {
        runId,
        tasks: [
          {
            id: "task-a",
            kind: "direct_history",
            priorityLane: "interactive",
            logicalKey: "main"
          }
        ]
      });
      await client.query(
        await readFile(
          "migrations/034_unified_check_adaptive_planner.sql",
          "utf8"
        )
      );
      const workerA = await pool.connect();
      const workerB = await pool.connect();
      await workerA.query(`set search_path to "${schema}"`);
      await workerB.query(`set search_path to "${schema}"`);
      await workerA.query("begin");
      try {
        const left = await claimUnifiedTask({
          query: (sql: string, values?: readonly unknown[]) =>
            workerA.query(sql, values as unknown[])
        }, {
          workerId: "worker-a",
          leaseToken: "lease-a",
          leaseMs: 60_000
        });
        const right = await claimUnifiedTask({
          query: (sql: string, values?: readonly unknown[]) =>
            workerB.query(sql, values as unknown[])
        }, {
          workerId: "worker-b",
          leaseToken: "lease-b",
          leaseMs: 60_000
        });
        expect(left).not.toBeNull();
        expect(right).toBeNull();
        await workerA.query("commit");
      } catch (error) {
        await workerA.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        workerA.release();
        workerB.release();
      }
      await recordUnifiedTaskProviderDuration(scoped, {
        taskId: "task-a",
        leaseToken: "lease-a",
        attempt: 1,
        durationMs: 12,
        providerSource: "network"
      });
      const checkpointed = await checkpointUnifiedTask(scoped, {
        taskId: "task-a",
        leaseToken: "lease-a",
        attempt: 1,
        checkpoint: { cursor: "page-2" }
      });
      expect(checkpointed?.status).toBe("QUEUED");
      const reclaimed = await claimUnifiedTask(scoped, {
        workerId: "worker-c",
        leaseToken: "lease-c",
        leaseMs: 60_000,
        kinds: ["direct_history"]
      });
      expect(reclaimed).toMatchObject({
        id: "task-a",
        run_id: runId,
        attempt: 2
      });
      await scoped.query(
        `update unified_check_tasks
            set lease_expires_at = statement_timestamp() - interval '1 second',
                checkpoint_json =
                  (checkpoint_json - 'recentAttempts') || jsonb_build_object(
                  'attemptTimings',
                  $1::jsonb
                )
          where id = 'task-a'`
        ,
        [JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
          attempt: index + 1,
          outcome: "LEGACY"
        })))]
      );
      const crashReclaimed = await claimUnifiedTask(scoped, {
        workerId: "worker-d",
        leaseToken: "lease-d",
        leaseMs: 60_000,
        kinds: ["direct_history"]
      });
      expect(crashReclaimed).toMatchObject({
        id: "task-a",
        run_id: runId,
        attempt: 3,
        lease_owner: "worker-d"
      });
      const transactionHost = {
        query: scoped.query,
        async transaction<T>(work: (tx: typeof scoped) => Promise<T>) {
          await client.query("begin");
          try {
            const result = await work(scoped);
            await client.query("commit");
            return result;
          } catch (error) {
            await client.query("rollback");
            throw error;
          }
        }
      };
      await completeUnifiedTaskAttempt(transactionHost, {
        taskId: "task-a",
        leaseToken: "lease-d",
        attempt: 3,
        attemptId: "attempt-a",
        artifactSha256: fingerprintCanonicalJson(artifact)
      });
      expect(Number((await client.query(
        `select count(*)::int as count
           from unified_check_attempts
          where artifact_sha256 = $1`,
        [shadowSha256]
      )).rows[0]!.count)).toBe(0);
      const completedTask = (
        await client.query(
          `select status, accepted_attempt_id, checkpoint_json
             from unified_check_tasks where id = 'task-a'`
        )
      ).rows[0];
      expect(completedTask).toMatchObject({
        status: "COMPLETED",
        accepted_attempt_id: "attempt-a"
      });
      expect(completedTask?.checkpoint_json).not.toHaveProperty(
        "attemptTimings"
      );
      expect(completedTask?.checkpoint_json.recentAttempts).toHaveLength(8);
      expect(completedTask?.checkpoint_json.timingSummary).toMatchObject({
        attemptCount: 3,
        queueDurationMs: expect.any(Number),
        providerDurationMs: expect.any(Number)
      });
      expect(completedTask?.checkpoint_json.performanceCounters).toMatchObject({
        providerCalls: 1,
        networkFetches: 1,
        providerCacheHits: 0,
        taskClaims: 3,
        checkpoints: 1
      });
      expect(
        Buffer.byteLength(JSON.stringify(completedTask?.checkpoint_json))
      ).toBeLessThan(32_768);

      const delivery = await createUnifiedDelivery(scoped, {
        id: "delivery-a",
        requestId: String(request.id),
        presentationSha256: "d".repeat(64)
      });
      const deliveryAgain = await createUnifiedDelivery(scoped, {
        id: "delivery-b",
        requestId: String(request.id),
        presentationSha256: "d".repeat(64)
      });
      expect(deliveryAgain.id).toBe(delivery.id);
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
