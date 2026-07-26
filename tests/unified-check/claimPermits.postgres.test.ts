import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  countUnifiedActionableProviderWork,
  loadUnifiedProviderRunDemand,
  runUnifiedAdaptiveControllerCycle
} from "../../src/unifiedCheck/adaptiveRuntime";
import {
  planUnifiedOrderedTasks,
  refillOrderedAdmissions
} from "../../src/unifiedCheck/plannerRepository";
import {
  claimUnifiedTask,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import type {
  UnifiedProviderClaimPermit
} from "../../src/unifiedCheck/worker";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const NOW = new Date("2099-01-01T00:00:00.000Z");

postgresDescribe("Unified provider claim permits", () => {
  it("claims exact allocated run/lane and orders head, ordered tail, then independent work", async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const admin = await pool.connect();
    const schema = `unifiedpermits_${randomUUID().replaceAll("-", "")}`;
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
        await readFile(
          "migrations/035_unified_check_run_rollout_policy.sql",
          "utf8"
        )
      );
      await admin.query(
        await readFile("migrations/036_remove_rollout_authority.sql", "utf8")
      );
      for (const [runId, ownerId] of [
        ["run-interactive", "owner-a"]
      ]) {
        const manifest = { runtimeCommit: "candidate", runId };
        const manifestHash = fingerprintCanonicalArtifact(manifest);
        await admin.query(
          `insert into unified_check_runs (
             id, analysis_key_sha256, subject_address, status, run_purpose,
             side_effect_policy, analysis_manifest_sha256, fairness_owner_id,
             rollout_stage, rollout_bucket, admission_policy,
             provider_capacity_ceiling
           ) values (
             $1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$5,
             'rolling_default',0,'rolling',2
           )`,
          [
            runId,
            fingerprintCanonicalArtifact({ analysis: runId }),
            `T-${runId}`,
            manifestHash,
            ownerId
          ]
        );
        await admin.query(
          `insert into unified_check_artifacts (
             sha256, created_by_run_id, kind, schema_version, artifact_json
           ) values ($1,$2,'analysis_manifest','1',$3::jsonb)`,
          [manifestHash, runId, JSON.stringify(manifest)]
        );
      }
      const directArtifact = fingerprintCanonicalArtifact({ direct: true });
      await admin.query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values (
           $1,'run-interactive','direct_history','1',
           '{"direct":true}'::jsonb
         )`,
        [directArtifact]
      );
      await admin.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key,
           attempt
         ) values (
           'direct-complete','run-interactive','direct_history','QUEUED',
           'interactive','main',1
         )`
      );
      await admin.query(
        `insert into unified_check_attempts (
           id, task_id, attempt, artifact_sha256, completed_at
         ) values (
           'attempt-direct','direct-complete',1,$1,statement_timestamp()
         )`,
        [directArtifact]
      );
      await admin.query(
        `update unified_check_tasks
            set status = 'COMPLETED',
                accepted_attempt_id = 'attempt-direct'
          where id = 'direct-complete'`
      );
      await planUnifiedOrderedTasks(host, {
        runId: "run-interactive",
        tasks: [0, 1].map((sequence) => ({
          taskId: `ordered-${sequence}`,
          kind: "address_history",
          logicalKey: `history-${sequence}`,
          priorityLane: "interactive" as const,
          checkpoint: { sequence }
        }))
      });
      await refillOrderedAdmissions(host, {
        runId: "run-interactive",
        policy: "rolling",
        lookaheadTarget: 2,
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 10_000,
        reservedBufferMaxBytes: 200,
        reservationBytesPerTask: 100,
        now: NOW
      });
      await admin.query(
        `insert into unified_check_tasks (
           id, run_id, kind, status, priority_lane, logical_key
         ) values
           ('independent','run-interactive','deep_direct','QUEUED',
            'interactive','independent'),
           ('repair-direct','run-interactive','direct_history','QUEUED',
            'repair','repair-main')`
      );

      let permits: readonly UnifiedProviderClaimPermit[] = [];
      const demand = await loadUnifiedProviderRunDemand(admin, {
        now: NOW,
        providerAvailable: true,
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 10_000,
        runtimeCommit: "candidate"
      });
      await runUnifiedAdaptiveControllerCycle({
        nowMs: NOW.getTime(),
        rampState: { target: 2, lastIncreaseAtMs: NOW.getTime() },
        providerGroups: [{
          groupId: "group",
          state: "healthy",
          concurrencyLimit: 2,
          inFlight: 0,
          cooldownUntil: null
        }],
        resources: {
          rssBytes: 1,
          heapUsedBytes: 1,
          availableMemoryBytes: 10_000,
          dbWaitingCount: 0,
          dbLatencyMs: 1,
          checkpointLatencyMs: 1
        },
        thresholds: {
          pressureAvailableMemoryBytes: 100,
          criticalAvailableMemoryBytes: 10,
          pressureRssBytes: 1_000,
          criticalRssBytes: 2_000,
          pressureDbWaitingCount: 2,
          criticalDbWaitingCount: 4,
          pressureDbLatencyMs: 100,
          criticalDbLatencyMs: 200,
          pressureCheckpointLatencyMs: 100,
          criticalCheckpointLatencyMs: 200
        },
        config: {
          configuredProviderConcurrencyLimit: 2,
          providerWorkerLimit: 2,
          providerIncreaseStep: 1,
          providerIncreaseIntervalMs: 1,
          analysisConcurrencyLimit: 1,
          finalizationConcurrencyLimit: 1,
          admissionPolicy: "rolling",
          lookaheadFactor: 1,
          perRunLookaheadMaximum: 2,
          readyBufferMaxEntries: 10,
          readyBufferMaxBytes: 10_000,
          reservedBufferMaxBytes: 1_000,
          reservationBytesPerTask: 100,
          repairShare: 0.5,
          repairMaxSlots: 1,
          repairMaxWaitChunks: 1,
          chunksSinceLastRepair: 1
        },
        demand,
        refill: async () => ({
          admittedTaskIds: [],
          deAdmittedTaskIds: [],
          blocker: null
        }),
        countActionableProviderWork: (scopes) =>
          countUnifiedActionableProviderWork(admin, {
            now: NOW,
            scopes,
            runtimeCommit: "candidate"
        }),
        assignProviderPermits(value) {
          permits = value.map((assignment) => assignment.permit);
          return { accepted: value, rejected: [] };
        },
        setPoolTarget() {},
        wakePool() {}
      });
      expect(permits).toHaveLength(2);
      expect(permits.map((permit) => [
        permit.runId,
        permit.lane
      ])).toEqual(expect.arrayContaining([
        ["run-interactive", "repair"],
        ["run-interactive", "interactive"]
      ]));
      expect(permits.find((permit) =>
        permit.lane === "interactive"
      )?.canonicalHeadPreferred).toBe(true);
      expect(permits.find((permit) =>
        permit.lane === "repair"
      )?.canonicalHeadPreferred).toBe(false);

      const claim = async (permit: UnifiedProviderClaimPermit) =>
        claimUnifiedTask(admin, {
          workerId: "provider",
          leaseToken: randomUUID(),
          leaseMs: 30_000,
          kinds: ["direct_history", "address_history", "deep_direct"],
          runtimeCommit: "candidate",
          runId: permit.runId,
          priorityLane: permit.lane,
          fairnessOwnerId: permit.ownerId
        });
      const repairPermit = permits.find((permit) =>
        permit.lane === "repair"
      )!;
      const repairClaim = await claim(repairPermit);
      expect(repairClaim?.id).toBe("repair-direct");
      const interactivePermit = permits.find((permit) =>
        permit.lane === "interactive"
      )!;
      const expectedOrder = ["ordered-0", "ordered-1", "independent"];
      for (const expected of expectedOrder) {
        const row = await claim(interactivePermit);
        expect(row?.id).toBe(expected);
        await admin.query(
          `update unified_check_tasks
              set status = 'CANCELLED', lease_owner = null,
                  lease_token = null, lease_expires_at = null
            where id = $1`,
          [expected]
        );
      }
      await expect(claimUnifiedTask(admin, {
        workerId: "provider",
        leaseToken: randomUUID(),
        leaseMs: 30_000,
        kinds: ["direct_history"],
        runtimeCommit: "candidate",
        runId: "run-interactive",
        priorityLane: "repair",
        fairnessOwnerId: "wrong-owner"
      })).resolves.toBeNull();
    } finally {
      await admin.query(`drop schema if exists "${schema}" cascade`);
      admin.release();
      await pool.end();
    }
  });
});
