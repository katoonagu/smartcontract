import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildUnifiedCanaryProviderConfiguration,
  buildUnifiedCanarySelection,
  prepareUnifiedCanaryBatch
} from "../../src/unifiedCheck/canary";
import {
  auditUnifiedCanaryIsolation,
  claimUnifiedTask,
  checkpointUnifiedTask,
  completeUnifiedTaskAttempt,
  createUnifiedCanaryBatch,
  createUnifiedPoolTransactionHost,
  insertUnifiedArtifact,
  listUnifiedWatchdogRuns,
  loadUnifiedCanaryBatchByIdentity,
  loadUnifiedCanarySelectionRows,
  persistUnifiedCanaryBlocker,
  recordUnifiedTaskAttemptAndWait,
  recordUnifiedTaskProviderDuration,
  requestCanaryCancellation
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const ADDRESSES = [
  "TYXN5ZiJLuzUyAY2dxdzdNjbwnUkSGB1it",
  "TV6bBsrCXz2sDSBMZhvc7vHqDwjc65ALZX",
  "TSv32fr41xwv3dh99PmtdxkhWguMEEuoVh",
  "TRddZMs7MJmbpQFuBpFxK4BDt5tA4LLPDu",
  "TEognYE7Sy6jiKxkDt2EbFgkUYUfsp9U2j",
  "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
  "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
  "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV"
] as const;
const PROVIDER_CONFIGURATION =
  buildUnifiedCanaryProviderConfiguration({
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com"),
    tronFullNodeBaseUrl: new URL("https://api.trongrid.io"),
    timeoutMs: 10_000,
    retryAttempts: 3,
    retryBaseDelayMs: 500,
    rateLimitCooldownMs: 1_000,
    maxInFlight: 20,
    maxInFlightPerGroup: 2,
    requestMinIntervalMs: 100,
    globalRequestMinIntervalMs: 50,
    transferRequestMinIntervalMs: 100,
    approvalRequestMinIntervalMs: 100,
    contractRequestMinIntervalMs: 100,
    fullNodeRequestMinIntervalMs: 100,
    tronGridRequestMinIntervalMs: 100,
    accountGroupRequestMinIntervalMs: 100,
    tronscanKeyCount: 4,
    fullNodeKeyConfigured: true,
    groups: [{ groupId: "default", keyCount: 4 }]
  });

postgresDescribe("Unified canary PostgreSQL contracts", () => {
  it("atomically creates eight isolated runs and rejects a result after cancellation", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const schema = `unifiedcanary_${randomUUID().replaceAll("-", "")}`;
    try {
      await pool.query(`create schema "${schema}"`);
      await pool.query(`set search_path to "${schema}"`);
      await pool.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await pool.query(
        await readFile(
          "migrations/034_unified_check_adaptive_planner.sql",
          "utf8"
        )
      );
      await pool.query(
        `create table telegram_users (
          telegram_user_id text primary key
        );
        create table forensic_check_jobs (
          id text primary key,
          kind text not null,
          subject_address text not null,
          chat_id text,
          requested_by text,
          progress_json jsonb not null default '{}'::jsonb,
          created_at timestamptz not null
        )`
      );
      await pool.query(
        "insert into telegram_users (telegram_user_id) values ('user-1')"
      );
      await pool.query(
        `insert into forensic_check_jobs (
          id, kind, subject_address, chat_id, requested_by,
          progress_json, created_at
        ) values (
          'legacy-user-check','address_fast_check',$1,'chat','user-1',
          '{"locale":"en"}'::jsonb,'2026-07-23T04:00:00.000Z'
        )`,
        [ADDRESSES[7]]
      );
      for (const [index, address] of ADDRESSES.slice(0, 7).entries()) {
        await pool.query(
          `insert into unified_check_requests (
            id, request_correlation_id, subject_address, chat_id,
            message_thread_id, locale, run_purpose, side_effect_policy,
            status, accepted_at, created_at
          ) values (
            $1,$2,$3,'source','','ru','user_check','authoritative',
            'ACCEPTED',$4,$4
          )`,
          [
            `source-${index}`,
            `source-correlation-${index}`,
            address,
            `2026-07-23T${String(11 - index).padStart(2, "0")}:00:00.000Z`
          ]
        );
      }
      await pool.query(
        `insert into unified_check_requests (
          id, request_correlation_id, subject_address, chat_id,
          message_thread_id, locale, run_purpose, side_effect_policy,
          status, accepted_at
        ) values (
          'old-canary','old-canary-correlation',$1,'source','','ru',
          'release_canary','isolated','ACCEPTED','2026-07-23T11:59:00.000Z'
        )`,
        [ADDRESSES[0]]
      );
      const transactionHost = createUnifiedPoolTransactionHost(pool);
      const selection = buildUnifiedCanarySelection({
        rows: await loadUnifiedCanarySelectionRows(pool, {
          cutoffAt: "2026-07-23T12:00:00.000Z"
        }),
        cutoffAt: "2026-07-23T12:00:00.000Z",
        candidateCommit: "a".repeat(40),
        activeGeneration: {
          generationId: "generation-test",
          activatedAt: "2026-07-23T10:00:00.000Z",
          runtimeCommit: "a".repeat(40)
        },
        databaseSchema: {
          version: 33,
          checksumSha256: "b".repeat(64),
          schema032ChecksumSha256: "c".repeat(64)
        }
      });
      let id = 0;
      const batch = await prepareUnifiedCanaryBatch({
        selectionManifest: selection,
        snapshotSource: {
          latestConfirmedBlock: async () => ({
            number: "100",
            hash: "a".repeat(64),
            timestamp: "2026-07-23T12:00:00.000Z"
          }),
          snapshotBalances: async () => ({
            usdtRaw: null,
            trxSun: null,
            source: "fixture",
            consistency: "unavailable"
          })
        },
        versions: {
          labelDatasetSha256: "b".repeat(64),
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          runtimeCommit: "a".repeat(40),
          schemaVersion: 33
        },
        providerConfiguration: PROVIDER_CONFIGURATION,
        repository: {
          createBatch: (input) =>
            createUnifiedCanaryBatch(transactionHost, input)
        },
        createId: () => `canary-${++id}`,
        now: () => new Date("2026-07-23T12:01:00.000Z")
      });
      expect(batch.runs).toHaveLength(8);
      expect(Number((await pool.query(
        `select count(*)::int as count from unified_check_runs
          where run_purpose = 'release_canary'
            and side_effect_policy = 'isolated'`
      )).rows[0]?.count)).toBe(8);
      expect(Number((await pool.query(
        `select count(*)::int as count from unified_check_tasks
          where priority_lane = 'background'`
      )).rows[0]?.count)).toBe(48);
      expect(Number((await pool.query(
        "select count(*)::int as count from unified_check_deliveries"
      )).rows[0]?.count)).toBe(0);
      const selectionArtifact = (await pool.query(
        `select artifact_json from unified_check_artifacts
          where sha256 = $1 and kind = 'canary_selection_manifest'`,
        [batch.selectionManifestSha256]
      )).rows[0];
      expect(selectionArtifact).toBeTruthy();
      expect(fingerprintCanonicalArtifact(selectionArtifact!.artifact_json))
        .toBe(batch.selectionManifestSha256);
      const resumed = await loadUnifiedCanaryBatchByIdentity(pool, {
        batchIdentitySha256: batch.batchIdentitySha256
      });
      expect(resumed.runs.map((run) => run.id).sort())
        .toEqual(batch.runs.map((run) => run.id).sort());
      expect(resumed.selectionManifestSha256)
        .toBe(batch.selectionManifestSha256);
      await expect(persistUnifiedCanaryBlocker(transactionHost, {
        runId: batch.runs[0]!.id,
        sha256: "d".repeat(64),
        artifact: {
          version: "canary-execution-blocked-v1",
          schemaVersion: 1,
          runId: batch.runs[0]!.id,
          subjectAddress: selection.selected[0]!.subjectAddress,
          deadlineAt: "2099-01-01T00:00:00.000Z",
          observedAt: "2026-07-23T12:02:00.000Z",
          phase: "direct_history",
          heartbeatAt: null,
          providerState: "ready",
          queueAgeMs: 0,
          logs: []
        }
      })).rejects.toThrow("unified_canary_deadline_not_reached");
      let duplicateId = 0;
      await expect(prepareUnifiedCanaryBatch({
        selectionManifest: {
          ...selection,
          cutoffAt: "2026-07-23T12:00:01.000Z"
        },
        snapshotSource: {
          latestConfirmedBlock: async () => ({
            number: "100",
            hash: "a".repeat(64),
            timestamp: "2026-07-23T12:00:00.000Z"
          }),
          snapshotBalances: async () => ({
            usdtRaw: null,
            trxSun: null,
            source: "fixture",
            consistency: "unavailable"
          })
        },
        versions: {
          labelDatasetSha256: "b".repeat(64),
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          runtimeCommit: "a".repeat(40),
          schemaVersion: 33
        },
        providerConfiguration: PROVIDER_CONFIGURATION,
        repository: {
          createBatch: (input) =>
            createUnifiedCanaryBatch(transactionHost, input)
        },
        createId: () => `duplicate-${++duplicateId}`,
        now: () => new Date("2026-07-23T12:02:00.000Z")
      })).rejects.toThrow(
        `unified_canary_duplicate_batch_resume:${batch.batchIdentitySha256}`
      );

      await expect(claimUnifiedTask(pool, {
        workerId: "wrong-provider-worker",
        leaseToken: "wrong-provider-lease",
        leaseMs: 60_000,
        kinds: ["direct_history"],
        runPurpose: "release_canary",
        providerConfigurationSha256: "0".repeat(64)
      })).resolves.toBeNull();
      const claimed = await claimUnifiedTask(pool, {
        workerId: "canary-worker",
        leaseToken: "canary-lease",
        leaseMs: 60_000,
        kinds: ["direct_history"],
        runPurpose: "release_canary",
        providerConfigurationSha256: PROVIDER_CONFIGURATION.sha256
      });
      expect(batch.runs.map((run) => run.id)).toContain(claimed?.run_id);
      await pool.query("select pg_sleep(0.2)");
      await expect(recordUnifiedTaskProviderDuration(pool, {
        taskId: String(claimed!.id),
        leaseToken: "canary-lease",
        attempt: Number(claimed!.attempt),
        durationMs: 10
      })).resolves.toBeTruthy();
      await expect(checkpointUnifiedTask(pool, {
        taskId: String(claimed!.id),
        leaseToken: "canary-lease",
        attempt: Number(claimed!.attempt),
        checkpoint: { providerState: "ready", page: 1 }
      })).resolves.toBeTruthy();
      await pool.query(
        `update unified_check_tasks
            set ready_at = statement_timestamp() + interval '1 hour'
          where kind = 'direct_history' and id <> $1`,
        [claimed!.id]
      );
      await pool.query("select pg_sleep(0.02)");
      const secondClaim = await claimUnifiedTask(pool, {
        workerId: "canary-worker",
        leaseToken: "canary-lease-2",
        leaseMs: 60_000,
        kinds: ["direct_history"],
        runPurpose: "release_canary",
        providerConfigurationSha256: PROVIDER_CONFIGURATION.sha256
      });
      expect(secondClaim?.id).toBe(claimed!.id);
      const waitArtifact = {
        version: "provider-wait-test-v1",
        taskId: String(claimed!.id)
      };
      const waitArtifactSha256 =
        fingerprintCanonicalArtifact(waitArtifact);
      await insertUnifiedArtifact(pool, {
        sha256: waitArtifactSha256,
        createdByRunId: String(claimed!.run_id),
        kind: "provider_wait_test",
        schemaVersion: "1",
        artifact: waitArtifact
      });
      const providerReadyAt = new Date(String((
        await pool.query(
          "select statement_timestamp() + interval '50 milliseconds' as value"
        )
      ).rows[0]!.value)).toISOString();
      await expect(recordUnifiedTaskAttemptAndWait(transactionHost, {
        taskId: String(claimed!.id),
        leaseToken: "canary-lease-2",
        attempt: Number(secondClaim!.attempt),
        attemptId: "provider-wait-attempt",
        artifactSha256: waitArtifactSha256,
        readyAt: providerReadyAt,
        checkpoint: { providerState: "waiting", page: 2 },
        lastError: "provider_429"
      })).resolves.toBeTruthy();
      await pool.query("select pg_sleep(0.1)");
      const thirdClaim = await claimUnifiedTask(pool, {
        workerId: "canary-worker",
        leaseToken: "canary-lease-3",
        leaseMs: 60_000,
        kinds: ["direct_history"],
        runPurpose: "release_canary",
        providerConfigurationSha256: PROVIDER_CONFIGURATION.sha256
      });
      expect(thirdClaim?.id).toBe(claimed!.id);
      await pool.query("select pg_sleep(0.02)");
      await expect(recordUnifiedTaskProviderDuration(pool, {
        taskId: String(claimed!.id),
        leaseToken: "canary-lease-3",
        attempt: Number(thirdClaim!.attempt),
        durationMs: 10
      })).resolves.toBeTruthy();
      await requestCanaryCancellation(pool, {
        runId: String(claimed!.run_id)
      });
      await expect(completeUnifiedTaskAttempt(transactionHost, {
        taskId: String(claimed!.id),
        leaseToken: "canary-lease-3",
        attempt: Number(thirdClaim!.attempt),
        attemptId: "late-attempt",
        artifactSha256: "f".repeat(64)
      })).resolves.toBeNull();
      expect((await pool.query(
        "select status, accepted_attempt_id from unified_check_tasks where id = $1",
        [claimed!.id]
      )).rows[0]).toMatchObject({
        status: "CANCELLED",
        accepted_attempt_id: null
      });
      const projection = (
        await listUnifiedWatchdogRuns(pool, {
          runIds: [String(claimed!.run_id)]
        })
      )[0]!;
      const timedTask = projection.tasks.find((task) =>
        task.id === claimed!.id
      )!;
      expect(timedTask.attemptDurations.map((attempt) => attempt.outcome))
        .toEqual(["CHECKPOINTED", "WAITING_RETRY", "CANCELLED"]);
      expect(timedTask.durationsMs.queue).toBeGreaterThan(0);
      expect(timedTask.durationsMs.provider).toBeGreaterThanOrEqual(20);
      expect(timedTask.durationsMs.compute).toBeGreaterThanOrEqual(0);
      expect(timedTask.attemptDurations.reduce(
        (sum, attempt) => sum + attempt.durationMs,
        0
      )).toBeGreaterThan(0);
      const isolation = await auditUnifiedCanaryIsolation(pool, {
        runIds: batch.runs.map((run) => run.id)
      });
      expect(isolation).toMatchObject({
        version: "unified-canary-isolation-audit-v1",
        writerPolicyVersion: "unified-write-policy-v1",
        auditedRunCount: 8,
        auditedRequestCount: 8,
        policyViolationCount: 0,
        authoritativeNamespaceWriteCount: 0,
        deliveryIntentWriteCount: 0,
        deliveryOwnershipWriteCount: 0,
        authoritativePresentationArtifactCount: 0
      });
      expect(isolation.namespacedArtifactCount).toBeGreaterThan(0);
    } finally {
      await pool.query(`drop schema if exists "${schema}" cascade`);
      await pool.end();
    }
  });
});
