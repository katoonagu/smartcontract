import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  buildAddressHistoryManifest,
  type AddressHistoryManifestIdentityV1
} from "../../src/unifiedCheck/addressHistory";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime";
import {
  markUnifiedPlannerResultReady,
  selectBoundedReadyPrefix,
  type UnifiedPlannerDiscoveryIdentity,
  type UnifiedPlannerPrefixEntry
} from "../../src/unifiedCheck/planner";
import {
  claimUnifiedTask,
  completeUnifiedTaskAttempt,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck
} from "../../src/unifiedCheck/requestService";
import { buildFrozenLabelDataset } from "../../src/unifiedCheck/frozenLabels";
import { buildFrozenLabelRecord } from "../../src/unifiedCheck/labelCatalog";
import type { UnifiedTraversalPolicyVersion } from "../../src/unifiedCheck/contracts";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const FIRST_SOURCE = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const SECOND_SOURCE = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const PROVIDER_CONFIGURATION_SHA256 = "e".repeat(64);
const MANIFEST_RESERVED_BYTES = 1_048_576;
type PlannerTransitionRow =
  UnifiedPlannerDiscoveryIdentity &
  UnifiedPlannerPrefixEntry & {
    readonly acceptedAttemptId: string | null;
  };

function transactionHost(
  client: pg.PoolClient
): UnifiedTransactionalQueryable {
  const query = (sql: string, values?: readonly unknown[]) =>
    client.query(sql, values as unknown[]);
  return {
    query,
    async transaction<T>(
      work: (tx: UnifiedQueryable) => Promise<T>
    ): Promise<T> {
      await client.query("begin");
      try {
        const result = await work({ query });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  };
}

function failBeforeBarrierAdmission(
  db: UnifiedTransactionalQueryable
): UnifiedTransactionalQueryable {
  return {
    query: db.query,
    transaction: (work) => db.transaction((client) => work({
      query: async (sql, values) => {
        if (
          sql.includes(
            "select entry.canonical_sequence, entry.planner_state"
          ) &&
          sql.includes("planner_state <> 'committed'")
        ) {
          throw new Error("unified_worker_lease_lost");
        }
        return client.query(sql, values);
      }
    }))
  };
}

type Scenario = {
  readonly client: pg.PoolClient;
  readonly host: () => UnifiedTransactionalQueryable;
  readonly runtime: (
    options?: {
      db?: UnifiedTransactionalQueryable;
      leaseMs?: number;
    }
  ) => ReturnType<typeof createUnifiedProductionRuntime>;
  readonly preparePlannedState: (
    runtime: ReturnType<typeof createUnifiedProductionRuntime>
  ) => Promise<void>;
};

async function withScenario<T>(
  sources: readonly string[],
  work: (scenario: Scenario) => Promise<T>,
  options: {
    traversalPolicyVersion?: UnifiedTraversalPolicyVersion;
    custodialAddress?: string;
    upstreamCustodialAddress?: string;
  } = {}
): Promise<T> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = `planner_restart_${randomUUID().replaceAll("-", "")}`;
  let runtimeNumber = 0;
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
      await readFile(
        "migrations/035_unified_check_run_rollout_policy.sql",
        "utf8"
      )
    );
    await client.query(
      await readFile("migrations/036_remove_rollout_authority.sql", "utf8")
    );
    const snapshot = {
      version: "confirmed-wallet-snapshot-v1" as const,
      schemaVersion: 1 as const,
      chain: "tron" as const,
      subjectAddress: SUBJECT,
      confirmedBlockNumber: "100",
      confirmedBlockHash: "a".repeat(64),
      timestamp: "2026-07-23T13:00:00.000Z",
      balances: {
        usdtRaw: null,
        trxSun: null,
        source: "fixture",
        consistency: "unavailable" as const
      }
    };
    const legacyLabelDataset = {
      version: "unified-label-dataset-v1",
      rows: []
    } as const;
    const frozenLabelDataset = buildFrozenLabelDataset({
      frozenAt: snapshot.timestamp,
      snapshotHash: fingerprintCanonicalArtifact(snapshot),
      labels: options.custodialAddress === undefined
        ? []
        : [buildFrozenLabelRecord({
            address: options.custodialAddress,
            classifierHint: null,
            exactRegistryBinding: null,
            verifiedProviderBinding: {
              catalogEntryId: "cex:bybit",
              authority: "tronscan_verified_metadata",
              sourcePayloadSha256: "7".repeat(64),
              validFrom: "2025-01-01T00:00:00.000Z",
              validTo: null
            }
          })],
      legacyRows: []
    });
    const labelDataset = options.traversalPolicyVersion ===
        "snapshot-closure-v2"
      ? frozenLabelDataset.dataset
      : legacyLabelDataset;
    const labelDatasetSha256 = options.traversalPolicyVersion ===
        "snapshot-closure-v2"
      ? frozenLabelDataset.sha256
      : fingerprintCanonicalArtifact(legacyLabelDataset);
    await client.query(
      `insert into unified_label_datasets (sha256, dataset_json)
       values ($1,$2::jsonb)`,
      [labelDatasetSha256, JSON.stringify(labelDataset)]
    );
    const host = () => transactionHost(client);
    const intake = await intakeUnifiedCheck({
      store: createPostgresUnifiedRequestStore(host()),
      snapshotSource: {
        latestConfirmedBlock: async () => ({
          number: snapshot.confirmedBlockNumber,
          hash: snapshot.confirmedBlockHash,
          timestamp: snapshot.timestamp
        }),
        snapshotBalances: async () => ({
          usdtRaw: null,
          trxSun: null,
          source: "fixture",
          consistency: "unavailable"
        })
      },
      request: {
        id: "request-restart",
        requestCorrelationId: "correlation-restart",
        subjectAddress: SUBJECT,
        chatId: "isolated",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "synthetic_test",
        sideEffectPolicy: "isolated"
      },
      candidateRunId: "run-restart",
      initialTasks: (["direct_history", "traversal"] as const).map((kind) => ({
        id: `task-${kind}`,
        kind,
        priorityLane: "interactive" as const,
        logicalKey: "main"
      })),
      versions: {
        labelDatasetSha256,
        scoringPolicyVersion: "scoring-signal-matrix-v4",
        attributionPolicyVersion: "selected-attribution-policy-v1",
        traversalPolicyVersion:
          options.traversalPolicyVersion ?? "snapshot-closure-v1",
        runtimeCommit: "candidate",
        schemaVersion: 36
      },
      now: () => new Date("2026-07-23T13:00:00.000Z")
    });
    expect(intake.kind).toBe("attached");

    const rawTransfers = sources.map((source, index) => ({
      transaction_id: String(index + 2).repeat(64),
      from_address: source,
      to_address: SUBJECT,
      quant: String((index + 1) * 10_000_000),
      contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      confirmed: true,
      contractRet: "SUCCESS",
      block_ts: Date.parse(
        `2026-07-23T12:0${index}:00.000Z`
      ),
      block: 90 - index
    } as RawTronscanTrc20Transfer));
    const upstreamTransfers = options.upstreamCustodialAddress === undefined
      ? []
      : [{
        transaction_id: "8".repeat(64),
        from_address: options.upstreamCustodialAddress,
        to_address: FIRST_SOURCE,
        quant: "10000000",
        contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: Date.parse("2026-07-23T11:00:00.000Z"),
        block: 80
      } as RawTronscanTrc20Transfer];

    const runtime = (
      options: {
        db?: UnifiedTransactionalQueryable;
        leaseMs?: number;
      } = {}
    ) => {
      const processId = ++runtimeNumber;
      let id = 0;
      return createUnifiedProductionRuntime({
        db: options.db ?? host(),
        runtimeCommit: "candidate",
        providerConfigurationSha256: PROVIDER_CONFIGURATION_SHA256,
        addressHistoryPagesPerChunk: 1,
        leaseMs: options.leaseMs,
        now: () => new Date("2026-07-23T13:01:00.000Z"),
        createId: () => `restart-${processId}-id-${++id}`,
        async loadProviderPage({ address }) {
          const transfers = address === SUBJECT
            ? rawTransfers
            : address === FIRST_SOURCE
            ? upstreamTransfers
            : [];
          const content = transfers.length > 0 || address === SUBJECT
            ? {
                kind: "page" as const,
                cursor: null,
                nextCursor: null,
                transfers,
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
        },
        loadFrozenLabelDataset: async ({ labelDatasetSha256 }) => (
          await client.query(
            "select dataset_json from unified_label_datasets where sha256 = $1",
            [labelDatasetSha256]
          )
        ).rows[0]?.dataset_json,
        loadCounterpartyLabels: async () => new Map(),
        loadHardEvidence: async () => ({})
      });
    };
    const preparePlannedState = async (
      active: ReturnType<typeof createUnifiedProductionRuntime>
    ) => {
      await expect(active.runProviderCycle()).resolves.toMatchObject({
        outcome: "completed",
        taskId: "task-direct_history"
      });
      await expect(active.runAnalysisCycle()).resolves.toMatchObject({
        outcome: "checkpointed",
        taskId: "task-traversal"
      });
      expect(Number((await client.query(
        `select count(*)::int as count
           from unified_check_planner_entries
          where run_id = 'run-restart'`
      )).rows[0]?.count)).toBe(sources.length);
    };
    return await work({ client, host, runtime, preparePlannedState });
  } finally {
    await client.query(`drop schema if exists "${schema}" cascade`);
    client.release();
    await pool.end();
  }
}

async function expectNoDuplicateAuthority(
  client: pg.PoolClient,
  input: { addressAttempts: number }
): Promise<void> {
  expect((await client.query(
    `select count(*)::int as total,
            count(distinct id)::int as distinct_count
       from unified_check_tasks`
  )).rows[0]).toMatchObject({
    total: input.addressAttempts + 2,
    distinct_count: input.addressAttempts + 2
  });
  expect((await client.query(
    `select count(*)::int as total,
            count(distinct (run_id, canonical_sequence))::int
              as distinct_sequence,
            count(distinct task_id)::int as distinct_task
       from unified_check_planner_entries`
  )).rows[0]).toMatchObject({
    total: input.addressAttempts,
    distinct_sequence: input.addressAttempts,
    distinct_task: input.addressAttempts
  });
  expect((await client.query(
    `select count(*)::int as total,
            count(distinct (task_id, attempt))::int as distinct_attempt
       from unified_check_attempts
      where task_id in (
        select id from unified_check_tasks where kind = 'address_history'
      )`
  )).rows[0]).toMatchObject({
    total: input.addressAttempts,
    distinct_attempt: input.addressAttempts
  });
  expect((await client.query(
    `select count(*)::int as total,
            count(distinct sha256)::int as distinct_artifact
       from unified_check_artifacts
      where kind = 'address_history_manifest'`
  )).rows[0]).toMatchObject({
    total: input.addressAttempts,
    distinct_artifact: input.addressAttempts
  });
  expect(Number((await client.query(
    `select count(*)::int as count
       from unified_check_artifacts
      where kind in (
        'canonical_facts',
        'evidence_bundle',
        'report_fact_inventory'
      )`
  )).rows[0]?.count)).toBe(0);
  expect(Number((await client.query(
    "select count(*)::int as count from unified_check_deliveries"
  )).rows[0]?.count)).toBe(0);
}

postgresDescribe("Unified planner restart resume", () => {
  it("rolls planning back when loss occurs before admission and replans once after restart", async () => {
    await withScenario([FIRST_SOURCE], async ({
      client,
      host,
      runtime
    }) => {
      const firstProcess = runtime();
      await expect(firstProcess.runProviderCycle()).resolves.toMatchObject({
        outcome: "completed",
        taskId: "task-direct_history"
      });
      const interruptedProcess = runtime({
        db: failBeforeBarrierAdmission(host()),
        leaseMs: 0
      });
      await expect(interruptedProcess.runAnalysisCycle())
        .resolves.toMatchObject({
          outcome: "failed",
          taskId: "task-traversal"
        });
      expect(Number((await client.query(
        `select count(*)::int as count
           from unified_check_planner_entries
          where run_id = 'run-restart'`
      )).rows[0]?.count)).toBe(0);
      expect((await client.query(
        `select status, accepted_attempt_id, checkpoint_json
           from unified_check_tasks
          where id = 'task-traversal'`
      )).rows[0]).toMatchObject({
        status: "LEASED",
        accepted_attempt_id: null,
        checkpoint_json: {}
      });

      const restartedProcess = runtime();
      await expect(restartedProcess.runAnalysisCycle())
        .resolves.toMatchObject({
          outcome: "checkpointed",
          taskId: "task-traversal"
        });
      expect((await client.query(
        `select canonical_sequence, planner_state,
                admitted_at is not null as admitted
           from unified_check_planner_entries
          order by canonical_sequence`
      )).rows).toEqual([{
        canonical_sequence: "0",
        planner_state: "planned",
        admitted: true
      }]);
      await expect(restartedProcess.runProviderCycle())
        .resolves.toMatchObject({ outcome: "completed" });
      await expectNoDuplicateAuthority(client, { addressAttempts: 1 });
    });
  });

  it("reuses admission after restart before claim", async () => {
    await withScenario([FIRST_SOURCE], async ({
      client,
      runtime,
      preparePlannedState
    }) => {
      await preparePlannedState(runtime());
      const planned = (await client.query(
        `select canonical_sequence, task_id,
                admitted_at is not null as admitted
           from unified_check_planner_entries`
      )).rows;
      expect(planned).toMatchObject([{
        canonical_sequence: "0",
        admitted: true
      }]);

      await expect(runtime().runProviderCycle())
        .resolves.toMatchObject({ outcome: "completed" });
      expect((await client.query(
        `select canonical_sequence, task_id,
                admitted_at is not null as admitted
           from unified_check_planner_entries`
      )).rows.map(({ canonical_sequence, task_id, admitted }) => ({
        canonical_sequence,
        task_id,
        admitted
      }))).toEqual(planned);
      await expectNoDuplicateAuthority(client, { addressAttempts: 1 });
    });
  });

  it("matches pure acceptance and checkpoint transitions in PostgreSQL", async () => {
    await withScenario([FIRST_SOURCE], async ({
      client,
      runtime,
      preparePlannedState
    }) => {
      const loadPlanner = async (): Promise<
        PlannerTransitionRow[]
      > => (await client.query(
        `select entry.canonical_sequence, entry.planner_state,
                entry.result_bytes, task.id as task_id,
                task.kind, task.logical_key, task.accepted_attempt_id
           from unified_check_planner_entries entry
           join unified_check_tasks task on task.id = entry.task_id
          order by entry.canonical_sequence`
      )).rows.map((row) => ({
        canonicalSequence: Number(row.canonical_sequence),
        taskId: String(row.task_id),
        kind: String(row.kind),
        logicalKey: String(row.logical_key),
        parentCanonicalSequence: -1,
        plannerState: row.planner_state,
        acceptedAttemptId: row.accepted_attempt_id === null
          ? null
          : String(row.accepted_attempt_id),
        resultBytes: row.result_bytes === null
          ? null
          : Number(row.result_bytes)
      }));
      const firstProcess = runtime();
      await preparePlannedState(firstProcess);
      const planned = await loadPlanner();
      await expect(firstProcess.runProviderCycle())
        .resolves.toMatchObject({ outcome: "completed" });
      const loadAccepted = async () => (await client.query(
        `select task.id, task.accepted_attempt_id,
                attempt.artifact_sha256, artifact.artifact_json
           from unified_check_tasks task
           join unified_check_attempts attempt
             on attempt.id = task.accepted_attempt_id
           join unified_check_artifacts artifact
             on artifact.sha256 = attempt.artifact_sha256
          where task.kind = 'address_history'`
      )).rows[0];
      const accepted = await loadAccepted();
      const expectedResultBytes = Buffer.byteLength(
        canonicalizeArtifactJson(accepted.artifact_json),
        "utf8"
      );
      expect(fingerprintCanonicalArtifact(accepted.artifact_json))
        .toBe(String(accepted.artifact_sha256));
      const ready = await loadPlanner();
      const expectedReady = planned.map((entry) =>
        entry.taskId === String(accepted.id)
          ? {
            ...markUnifiedPlannerResultReady(
              entry,
              expectedResultBytes
            ),
            acceptedAttemptId: String(accepted.accepted_attempt_id)
          }
          : entry
      );
      expect(ready).toEqual(expectedReady);

      await expect(runtime().runAnalysisCycle())
        .resolves.toMatchObject({ outcome: "checkpointed" });
      const committed = selectBoundedReadyPrefix(expectedReady, {
        maxEntries: 1,
        maxBytes: expectedResultBytes
      });
      const committedIds = new Set(committed.map((entry) => entry.taskId));
      expect(await loadPlanner()).toEqual(
        expectedReady.map((entry) =>
          committedIds.has(entry.taskId)
            ? { ...entry, plannerState: "committed" }
            : entry
        )
      );
      expect(await loadAccepted()).toEqual(accepted);
      await expectNoDuplicateAuthority(client, { addressAttempts: 1 });
    });
  });

  it("leaves the next head admitted in the prefix-commit transaction before restart refill", async () => {
    await withScenario(
      [FIRST_SOURCE, SECOND_SOURCE],
      async ({ client, runtime, preparePlannedState }) => {
        const firstProcess = runtime();
        await preparePlannedState(firstProcess);
        await expect(firstProcess.runProviderCycle())
          .resolves.toMatchObject({ outcome: "completed" });
        await expect(firstProcess.runAnalysisCycle())
          .resolves.toMatchObject({ outcome: "checkpointed" });
        const afterCommit = (await client.query(
          `select canonical_sequence, task_id, planner_state,
                  admitted_at is not null as admitted
             from unified_check_planner_entries
            order by canonical_sequence`
        )).rows;
        expect(afterCommit).toMatchObject([
          {
            canonical_sequence: "0",
            planner_state: "committed",
            admitted: true
          },
          {
            canonical_sequence: "1",
            planner_state: "planned",
            admitted: true
          }
        ]);

        await expect(runtime().runProviderCycle())
          .resolves.toMatchObject({ outcome: "completed" });
        expect((await client.query(
          `select canonical_sequence, task_id
             from unified_check_planner_entries
            order by canonical_sequence`
        )).rows).toEqual(afterCommit.map((row) => ({
          canonical_sequence: row.canonical_sequence,
          task_id: row.task_id
        })));
        await expectNoDuplicateAuthority(client, { addressAttempts: 2 });
      }
    );
  });

  it("resumes after a V2 boundary checkpoint without reopening history", async () => {
    await withScenario(
      [SECOND_SOURCE],
      async ({ client, runtime }) => {
        const firstProcess = runtime();
        await expect(firstProcess.runProviderCycle()).resolves.toMatchObject({
          outcome: "completed",
          taskId: "task-direct_history"
        });
        await expect(firstProcess.runAnalysisCycle()).resolves.toMatchObject({
          outcome: "checkpointed",
          taskId: "task-traversal"
        });

        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_planner_entries
            where run_id = 'run-restart'`
        )).rows[0]?.count)).toBe(0);
        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_tasks
            where run_id = 'run-restart'
              and kind = 'address_history'`
        )).rows[0]?.count)).toBe(0);
        expect((await client.query(
          `select kind, schema_version
             from unified_check_artifacts
            where created_by_run_id = 'run-restart'
              and kind in ('traversal_terminal_evidence', 'traversal_delta')
            order by kind`
        )).rows).toEqual([
          { kind: "traversal_delta", schema_version: "1" },
          { kind: "traversal_terminal_evidence", schema_version: "2" }
        ]);

        const restartedProcess = runtime();
        await expect(restartedProcess.runAnalysisCycle())
          .resolves.toMatchObject({
            outcome: "completed",
            taskId: "task-traversal"
          });
        await expect(restartedProcess.runAnalysisCycle())
          .resolves.toMatchObject({ outcome: "idle" });

        expect((await client.query(
          `select kind, count(*)::int as count
             from unified_check_artifacts
            where created_by_run_id = 'run-restart'
              and kind in ('traversal_terminal_evidence', 'traversal_delta')
            group by kind
            order by kind`
        )).rows).toEqual([
          { kind: "traversal_delta", count: 1 },
          { kind: "traversal_terminal_evidence", count: 1 }
        ]);
        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_planner_entries
            where run_id = 'run-restart'`
        )).rows[0]?.count)).toBe(0);
        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_tasks
            where run_id = 'run-restart'
              and kind = 'address_history'`
        )).rows[0]?.count)).toBe(0);
      },
      {
        traversalPolicyVersion: "snapshot-closure-v2",
        custodialAddress: SECOND_SOURCE
      }
    );
  });

  it("partitions a generated V2 boundary before discovery and resumes once", async () => {
    await withScenario(
      [FIRST_SOURCE],
      async ({ client, runtime, preparePlannedState }) => {
        const firstProcess = runtime();
        await preparePlannedState(firstProcess);
        await expect(firstProcess.runProviderCycle())
          .resolves.toMatchObject({ outcome: "completed" });
        await expect(firstProcess.runAnalysisCycle())
          .resolves.toMatchObject({
            outcome: "checkpointed",
            taskId: "task-traversal"
          });

        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_planner_entries
            where run_id = 'run-restart'`
        )).rows[0]?.count)).toBe(1);
        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_tasks
            where run_id = 'run-restart' and kind = 'address_history'`
        )).rows[0]?.count)).toBe(1);
        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_artifacts
            where created_by_run_id = 'run-restart'
              and kind = 'traversal_terminal_evidence'`
        )).rows[0]?.count)).toBe(1);

        const restartedProcess = runtime();
        await expect(restartedProcess.runAnalysisCycle())
          .resolves.toMatchObject({
            outcome: "completed",
            taskId: "task-traversal"
          });
        await expect(restartedProcess.runAnalysisCycle())
          .resolves.toMatchObject({ outcome: "idle" });
        expect(Number((await client.query(
          `select count(*)::int as count
             from unified_check_artifacts
            where created_by_run_id = 'run-restart'
              and kind = 'traversal_terminal_evidence'`
        )).rows[0]?.count)).toBe(1);
        await expectNoDuplicateAuthority(client, { addressAttempts: 1 });
      },
      {
        traversalPolicyVersion: "snapshot-closure-v2",
        custodialAddress: SECOND_SOURCE,
        upstreamCustodialAddress: SECOND_SOURCE
      }
    );
  });

  it("rejects a malformed persisted analysis manifest before handler writes", async () => {
    await withScenario([FIRST_SOURCE], async ({ client, runtime }) => {
      const current = (await client.query(
        `select run.analysis_manifest_sha256, artifact.artifact_json
           from unified_check_runs run
           join unified_check_artifacts artifact
             on artifact.sha256 = run.analysis_manifest_sha256
          where run.id = 'run-restart'`
      )).rows[0]!;
      const malformed = {
        ...current.artifact_json,
        unexpectedPersistedField: true
      };
      const malformedSha256 = fingerprintCanonicalArtifact(malformed);
      await client.query(
        `insert into unified_check_artifacts (
          sha256, created_by_run_id, kind, schema_version, artifact_json
        ) values ($1,'run-restart','analysis_manifest','1',$2::jsonb)`,
        [malformedSha256, JSON.stringify(malformed)]
      );
      await client.query(
        `update unified_check_runs
            set analysis_manifest_sha256 = $1
          where id = 'run-restart'`,
        [malformedSha256]
      );

      await expect(runtime().runProviderCycle()).resolves.toMatchObject({
        outcome: "failed",
        taskId: "task-direct_history"
      });
      expect(Number((await client.query(
        `select count(*)::int as count
           from unified_check_artifacts
          where created_by_run_id = 'run-restart'
            and kind not in ('confirmed_snapshot', 'analysis_manifest')`
      )).rows[0]?.count)).toBe(0);
      expect(Number((await client.query(
        `select count(*)::int as count
           from unified_check_planner_entries
          where run_id = 'run-restart'`
      )).rows[0]?.count)).toBe(0);
      expect(Number((await client.query(
        `select count(*)::int as count
           from unified_check_tasks
          where run_id = 'run-restart' and kind = 'address_history'`
      )).rows[0]?.count)).toBe(0);
    });
  });

  it("returns the accepted attempt for a stable retry after the DB commit response is lost", async () => {
    await withScenario([FIRST_SOURCE], async ({
      client,
      host,
      runtime,
      preparePlannedState
    }) => {
      await preparePlannedState(runtime());
      const claimed = await claimUnifiedTask(client, {
        workerId: "provider-before-loss",
        leaseToken: "lease-before-loss",
        leaseMs: 30_000,
        kinds: ["address_history"]
      });
      expect(claimed).not.toBeNull();
      const identity = (
        claimed?.checkpoint_json as {
          identity: AddressHistoryManifestIdentityV1;
        }
      ).identity;
      const acceptedManifest = buildAddressHistoryManifest({
        ...identity,
        pageArtifactHashes: [],
        canonicalEventIds: [],
        rawRowCount: 0,
        duplicateCount: 0,
        exhaustion: {
          kind: "account_creation_reached",
          evidenceSha256: "f".repeat(64)
        }
      });
      const artifactSha256 =
        fingerprintCanonicalArtifact(acceptedManifest);
      const completion = {
        taskId: String(claimed?.id),
        leaseToken: "lease-before-loss",
        attempt: Number(claimed?.attempt),
        attemptId: "attempt-before-loss",
        artifactSha256,
        acceptedArtifact: {
          kind: "address_history_manifest",
          schemaVersion: "1",
          value: acceptedManifest
        },
        manifestMaxBytes: MANIFEST_RESERVED_BYTES
      } as const;
      await completeUnifiedTaskAttempt(host(), completion);

      const restartedRepository = host();
      const retried = await completeUnifiedTaskAttempt(
        restartedRepository,
        {
          ...completion,
          leaseToken: "lease-response-lost",
          attemptId: "attempt-after-restart",
          acceptedArtifact: undefined
        }
      );
      expect(retried).toMatchObject({
        id: claimed?.id,
        accepted_attempt_id: "attempt-before-loss",
        status: "COMPLETED"
      });
      await expect(runtime().runAnalysisCycle())
        .resolves.toMatchObject({ outcome: "checkpointed" });
      await expectNoDuplicateAuthority(client, { addressAttempts: 1 });
    });
  });
});
