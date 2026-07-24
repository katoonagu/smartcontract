import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck
} from "../../src/unifiedCheck/requestService";
import {
  checkpointUnifiedTask,
  claimUnifiedTask,
  type
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const SOURCE = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";

postgresDescribe("Unified production runtime restart acceptance", () => {
  it("resumes direct history, runs all branches and creates exactly one delivery", async () => {
    const pool = new pg.Pool({ connectionString, max: 2 });
    const client = await pool.connect();
    const schema = `unifiedruntime_${randomUUID().replaceAll("-", "")}`;
    const query = (sql: string, values?: readonly unknown[]) =>
      client.query(sql, values as unknown[]);
    const db: UnifiedTransactionalQueryable = {
      query,
      async transaction<T>(
        work: (tx: { query: typeof query }) => Promise<T>
      ): Promise<T> {
        await client.query("begin");
        try {
          const result = await work({ query });
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      }
    };
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      const labelDataset = {
        version: "unified-label-dataset-v1",
        rows: []
      } as const;
      const labelDatasetSha256 =
        fingerprintCanonicalArtifact(labelDataset);
      await query(
        `insert into unified_label_datasets (sha256, dataset_json)
         values ($1,$2::jsonb)`,
        [labelDatasetSha256, JSON.stringify(labelDataset)]
      );
      const requestStore = createPostgresUnifiedRequestStore(db);
      const intake = await intakeUnifiedCheck({
        store: requestStore,
        snapshotSource: {
          latestConfirmedBlock: async () => ({
            number: "100",
            hash: "a".repeat(64),
            timestamp: "2026-07-23T13:00:00.000Z"
          }),
          snapshotBalances: async () => ({
            usdtRaw: null,
            trxSun: null,
            source: "fixture",
            consistency: "unavailable"
          })
        },
        request: {
          id: "request-1",
          requestCorrelationId: "correlation-1",
          subjectAddress: SUBJECT,
          chatId: "42",
          messageThreadId: "",
          locale: "ru",
          runPurpose: "user_check",
          sideEffectPolicy: "authoritative"
        },
        candidateRunId: "run-1",
        initialTasks: (
          ["direct_history", "traversal", "fast", "where", "deep"] as const
        ).map((kind) => ({
          id: `task-${kind}`,
          kind,
          priorityLane: "interactive",
          logicalKey: "main"
        })),
        versions: {
          labelDatasetSha256,
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          runtimeCommit: "candidate",
          schemaVersion: 33
        },
        now: () => new Date("2026-07-23T13:00:00.000Z")
      });
      expect(intake.kind).toBe("attached");
      const raw = {
        transaction_id: "b".repeat(64),
        from_address: SOURCE,
        to_address: SUBJECT,
        quant: "10000000",
        contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: Date.parse("2026-07-23T12:00:00.000Z"),
        block: 90
      } as RawTronscanTrc20Transfer;
      const loadProviderPage = vi.fn(async ({
        address,
        cursor
      }: { address?: string; cursor: string | null }) => {
        const content = address === SUBJECT && cursor === null
          ? {
              kind: "page" as const,
              cursor: null,
              nextCursor: "1",
              transfers: [raw],
              reachedAccountCreation: false,
              provider: "tronscan" as const
            }
          : address === SUBJECT
            ? {
                kind: "page" as const,
                cursor: "1",
                nextCursor: null,
                transfers: [],
                reachedAccountCreation: true,
                provider: "tronscan" as const
              }
            : {
                kind: "page" as const,
                cursor: null,
                nextCursor: null,
                transfers: [],
                reachedAccountCreation: true,
                provider: "tronscan" as const
              };
        return {
          ...content,
          pageHash: fingerprintCanonicalArtifact(content)
        };
      });
      const runtimeInput = {
        db,
        runtimeCommit: "candidate",
        providerConfigurationSha256: "e".repeat(64),
        now: () => new Date("2026-07-23T13:01:00.000Z"),
        createId: (() => {
          let index = 0;
          return () => `runtime-id-${++index}`;
        })(),
        loadProviderPage,
        loadCounterpartyLabels: async () => new Map(),
        loadHardEvidence: async () => ({})
      };
      const firstProcess = createUnifiedProductionRuntime(runtimeInput);
      await expect(firstProcess.runAnalysisCycle()).resolves.toMatchObject({
        outcome: "idle"
      });
      expect(
        Number((await query(
          `select count(*)::int as count
             from unified_check_tasks
            where kind in ('fast','where','deep') and status = 'QUEUED'`
        )).rows[0]?.count)
      ).toBe(3);
      await expect(firstProcess.runProviderCycle()).resolves.toMatchObject({
        outcome: "checkpointed"
      });
      const checkpointed = (
        await query(
          "select status, checkpoint_json from unified_check_tasks where id = 'task-direct_history'"
        )
      ).rows[0];
      expect(checkpointed?.status).toBe("QUEUED");
      expect(checkpointed?.checkpoint_json).toMatchObject({
        version: "unified-direct-history-checkpoint-v1"
      });

      const restartedProcess = createUnifiedProductionRuntime(runtimeInput);
      await expect(restartedProcess.runProviderCycle()).resolves.toMatchObject({
        outcome: "completed"
      });
      await expect(restartedProcess.runProviderCycle()).resolves.toMatchObject({
        outcome: "completed"
      });
      for (let index = 0; index < 3; index += 1) {
        await expect(restartedProcess.runAnalysisCycle()).resolves.toMatchObject({
          outcome: "completed"
        });
      }
      const canaryOnlyProcess = createUnifiedProductionRuntime({
        ...runtimeInput,
        runPurpose: "release_canary"
      });
      await expect(canaryOnlyProcess.runFinalizationCycle())
        .resolves.toMatchObject({
          finalized: false,
          reconciled: false
        });
      expect((
        await query(
          "select status from unified_check_runs where id = 'run-1'"
        )
      ).rows[0]?.status).toBe("RUNNING");
      expect(Number((
        await query(
          "select count(*)::int as count from unified_check_deliveries"
        )
      ).rows[0]?.count)).toBe(0);
      await expect(
        restartedProcess.runFinalizationCycle()
      ).resolves.toMatchObject({
        finalized: true,
        runId: "run-1"
      });

      expect(loadProviderPage.mock.calls.map(([value]) => [
        value.address,
        value.cursor
      ])).toEqual([
        [SUBJECT, null],
        [SUBJECT, "1"],
        [SOURCE, null]
      ]);
      const run = (
        await query("select * from unified_check_runs where id = 'run-1'")
      ).rows[0];
      expect(run).toMatchObject({
        status: "COMPLETED",
        final_score: 0,
        final_decision: "ACCEPTABLE"
      });
      expect(
        Number((
          await query("select count(*)::int as count from unified_check_deliveries")
        ).rows[0]?.count)
      ).toBe(1);

      const reused = await intakeUnifiedCheck({
        store: requestStore,
        snapshotSource: {
          latestConfirmedBlock: async () => ({
            number: "100",
            hash: "a".repeat(64),
            timestamp: "2026-07-23T13:00:00.000Z"
          }),
          snapshotBalances: async () => ({
            usdtRaw: null,
            trxSun: null,
            source: "fixture",
            consistency: "unavailable"
          })
        },
        request: {
          id: "request-2",
          requestCorrelationId: "correlation-2",
          subjectAddress: SUBJECT,
          chatId: "84",
          messageThreadId: "",
          locale: "en",
          runPurpose: "user_check",
          sideEffectPolicy: "authoritative"
        },
        candidateRunId: "run-2",
        initialTasks: (
          ["direct_history", "traversal", "fast", "where", "deep"] as const
        ).map((kind) => ({
          id: `task-2-${kind}`,
          kind,
          priorityLane: "interactive",
          logicalKey: "main"
        })),
        versions: {
          labelDatasetSha256,
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          runtimeCommit: "candidate",
          schemaVersion: 33
        },
        now: () => new Date("2026-07-23T13:02:00.000Z")
      });
      expect(reused).toMatchObject({
        kind: "attached",
        reused: true,
        run: { id: "run-1", status: "COMPLETED" }
      });
      await expect(
        restartedProcess.runFinalizationCycle()
      ).resolves.toMatchObject({
        finalized: false,
        reconciled: true,
        requestId: "request-2"
      });
      expect(
        Number((
          await query("select count(*)::int as count from unified_check_deliveries")
        ).rows[0]?.count)
      ).toBe(2);

      const canary = await intakeUnifiedCheck({
        store: requestStore,
        snapshotSource: {
          latestConfirmedBlock: async () => ({
            number: "101",
            hash: "c".repeat(64),
            timestamp: "2026-07-23T13:03:00.000Z"
          }),
          snapshotBalances: async () => ({
            usdtRaw: null,
            trxSun: null,
            source: "fixture",
            consistency: "unavailable"
          })
        },
        request: {
          id: "request-canary",
          requestCorrelationId: "correlation-canary",
          subjectAddress: SUBJECT,
          chatId: "canary",
          messageThreadId: "",
          locale: "ru",
          runPurpose: "release_canary",
          sideEffectPolicy: "isolated"
        },
        candidateRunId: "run-canary",
        initialTasks: (
          ["direct_history", "traversal", "fast", "where", "deep"] as const
        ).map((kind) => ({
          id: `task-canary-${kind}`,
          kind,
          priorityLane: "background",
          logicalKey: "main"
        })),
        versions: {
          labelDatasetSha256,
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          runtimeCommit: "candidate",
          schemaVersion: 33
        },
        now: () => new Date("2026-07-23T13:03:00.000Z")
      });
      expect(canary).toMatchObject({
        kind: "attached",
        reused: false,
        run: {
          id: "run-canary",
          runPurpose: "release_canary",
          sideEffectPolicy: "isolated"
        }
      });
      const canaryBatchIdentity = {
        version: "test-canary-batch-identity",
        providerConfiguration: {
          sha256: runtimeInput.providerConfigurationSha256,
          artifact: {}
        }
      };
      const canaryBatchIdentitySha256 =
        fingerprintCanonicalArtifact(canaryBatchIdentity);
      await query(
        `insert into unified_check_artifacts (
           sha256, created_by_run_id, kind, schema_version, artifact_json
         ) values ($1,'run-canary','canary_batch_identity','1',$2::jsonb)`,
        [
          canaryBatchIdentitySha256,
          JSON.stringify(canaryBatchIdentity)
        ]
      );
      await query(
        `update unified_check_requests
            set chat_id = $2
          where id = $1`,
        ["request-canary", `canary:${canaryBatchIdentitySha256}`]
      );
      const mismatchedCanaryRuntime = createUnifiedProductionRuntime({
        ...runtimeInput,
        providerConfigurationSha256: "f".repeat(64),
        runPurpose: "release_canary"
      });
      await expect(mismatchedCanaryRuntime.runProviderCycle())
        .resolves.toMatchObject({ outcome: "idle" });
      const oldCandidateRuntime = createUnifiedProductionRuntime({
        ...runtimeInput,
        runtimeCommit: "previous-candidate",
        runPurpose: "release_canary"
      });
      await expect(oldCandidateRuntime.runProviderCycle())
        .resolves.toMatchObject({ outcome: "idle" });
      const canaryRuntime = createUnifiedProductionRuntime({
        ...runtimeInput,
        runPurpose: "release_canary"
      });
      for (let index = 0; index < 3; index += 1) {
        await expect(canaryRuntime.runProviderCycle()).resolves.toMatchObject({
          claimed: true
        });
      }
      for (let index = 0; index < 3; index += 1) {
        await expect(canaryRuntime.runAnalysisCycle()).resolves.toMatchObject({
          outcome: "completed"
        });
      }
      await expect(canaryRuntime.runFinalizationCycle())
        .resolves.toMatchObject({
          finalized: true,
          runId: "run-canary",
          reconciled: false
        });
      expect((
        await query(
          "select status, final_score, final_decision from unified_check_runs where id = 'run-canary'"
        )
      ).rows[0]).toMatchObject({
        status: "COMPLETED",
        final_score: 0,
        final_decision: "ACCEPTABLE"
      });
      expect(Number((
        await query("select count(*)::int as count from unified_check_deliveries")
      ).rows[0]?.count)).toBe(2);
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });

  it("rotates checkpointed provider tasks across ready runs", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const schema = `unifiedfair_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      for (const [index, suffix] of ["a", "b", "c"].entries()) {
        const runId = `run-${suffix}`;
        const manifestSha256 = suffix.repeat(64);
        await client.query(
          `insert into unified_check_runs (
             id, analysis_key_sha256, subject_address, status, run_purpose,
             side_effect_policy, analysis_manifest_sha256, created_at, updated_at
           ) values (
             $1,$2,$3,'RUNNING','user_check','authoritative',$4,
             $5::timestamptz,$5::timestamptz
           )`,
          [
            runId,
            `${index + 1}`.repeat(64),
            `TSubject${suffix.repeat(26)}`,
            manifestSha256,
            `2026-07-23T12:0${index}:00.000Z`
          ]
        );
        await client.query(
          `insert into unified_check_artifacts (
             sha256, created_by_run_id, kind, schema_version, artifact_json
           ) values ($1,$2,'analysis_manifest','1','{}'::jsonb)`,
          [manifestSha256, runId]
        );
        await client.query(
          `insert into unified_check_tasks (
             id, run_id, kind, status, priority_lane, ready_at,
             created_at, updated_at
           ) values (
             $1,$2,'direct_history','QUEUED','interactive',
             '2026-07-23T12:00:00.000Z',$3::timestamptz,$3::timestamptz
           )`,
          [`task-${suffix}`, runId, `2026-07-23T12:0${index}:00.000Z`]
        );
      }

      const first = await claimUnifiedTask(client, {
        workerId: "provider-1",
        leaseToken: "lease-1",
        leaseMs: 30_000,
        kinds: ["direct_history"]
      });
      expect(first?.id).toBe("task-a");
      await expect(checkpointUnifiedTask(client, {
        taskId: "task-a",
        leaseToken: "lease-1",
        attempt: Number(first?.attempt),
        checkpoint: { cursor: "50" }
      })).resolves.toBeTruthy();

      const second = await claimUnifiedTask(client, {
        workerId: "provider-2",
        leaseToken: "lease-2",
        leaseMs: 30_000,
        kinds: ["direct_history"]
      });
      expect(second?.id).toBe("task-b");
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
