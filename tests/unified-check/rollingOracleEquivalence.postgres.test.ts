import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pg from "pg";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact,
  fingerprintCanonicalJson
} from "../../src/forensics/canonicalJson";
import {
  commitMinimalUnifiedCheck,
  commitUnifiedPresentedCompletion
} from "../../src/unifiedCheck/durableCompletion";
import {
  createPostgresUnifiedDeliveryRepository,
  runUnifiedDeliveryCycle
} from "../../src/unifiedCheck/delivery";
import {
  buildMinimalUnifiedCheckCandidate,
  buildUnifiedPresentedCompletionCandidate,
  type MinimalBranchResult
} from "../../src/unifiedCheck/orchestrator";
import {
  loadUnifiedBoundedReadyPrefix,
  planUnifiedOrderedTasks,
  refillOrderedAdmissions
} from "../../src/unifiedCheck/plannerRepository";
import {
  canonicalJsonFilePayload,
  compareUnifiedReplayOracleFacts,
  parseUnifiedProviderReplayV1,
  sealUnifiedRollingOracleReceiptV1,
  type UnifiedProviderReplayV1,
  type UnifiedRollingOracleFactsV1
} from "../../src/unifiedCheck/providerReplay";
import {
  buildUnifiedWalletReport
} from "../../src/unifiedCheck/report";
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
import {
  buildUnifiedBranchInput,
  type AnalysisRunRecord
} from "../../src/unifiedCheck/requestService";
import {
  buildFrozenLabelDataset
} from "../../src/unifiedCheck/frozenLabels";
import { buildFrozenLabelRecord } from "../../src/unifiedCheck/labelCatalog";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck
} from "../../src/unifiedCheck/requestService";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV";
const CAPACITIES = [1, 4, 8, 16, 32, 100] as const;
const BASE_SEED = 24_072_026;
const RUN_ID = "rolling-oracle-run";
const RESERVATION_BYTES = 4_096;
const POLICY_FIXTURES = [{
  policy: "snapshot-closure-v1" as const,
  path: "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
  receiptOutputEnv: "UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V1"
}, {
  policy: "snapshot-closure-v2" as const,
  path: "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay-v2.json",
  receiptOutputEnv: "UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V2"
}] as const;

type OracleFacts = {
  readonly traversalArtifactVersion: string;
  readonly canonicalFacts: unknown;
  readonly finalFrontier: readonly unknown[];
  readonly terminalEvidenceSha256s: readonly string[];
  readonly terminalEvidenceSchemaVersions: readonly string[];
  readonly terminalEvidenceArtifacts: readonly unknown[];
  readonly analysisManifestSha256: string;
  readonly closureCertificate: {
    readonly analysisManifestHash: string;
    readonly [key: string]: unknown;
  };
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  readonly evidenceBundleSha256: string;
  readonly traversalClosureSha256: string;
  readonly scoringBundleSha256: string;
  readonly reportSha256: string;
  readonly presentationSha256s: readonly string[];
  readonly eligibleDeliveryIntentCount: number;
  readonly externalTelegramSends: number;
  readonly providerResponseArtifactSha256s: readonly string[];
  readonly committedSequenceCount: number;
  readonly duplicateCommitCount: number;
  readonly duplicateSequenceCount: number;
};

type OracleClaimedTask = {
  readonly id: string;
  readonly attempt: number;
  readonly checkpoint: unknown;
};

function oracleClaimedTask(
  value: Record<string, unknown>
): OracleClaimedTask {
  if (
    typeof value.id !== "string" ||
    !Number.isSafeInteger(value.attempt) ||
    Number(value.attempt) < 1
  ) {
    throw new Error("rolling_oracle_claim_invalid");
  }
  return {
    id: value.id,
    attempt: Number(value.attempt),
    checkpoint: value.checkpoint_json
  };
}

function hostFor(
  client: pg.PoolClient
): UnifiedTransactionalQueryable {
  const queryable: UnifiedQueryable = {
    query: (sql, values) => client.query(sql, values as unknown[])
  };
  return {
    ...queryable,
    async transaction<T>(work: (tx: UnifiedQueryable) => Promise<T>) {
      await client.query("begin");
      try {
        const result = await work(queryable);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  };
}

async function withSchema<T>(
  work: (input: {
    readonly client: pg.PoolClient;
    host: UnifiedTransactionalQueryable;
  }) => Promise<T>
): Promise<T> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = `rolling_oracle_${randomUUID().replaceAll("-", "")}`;
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
    return await work({ client, host: hostFor(client) });
  } finally {
    await client.query("reset search_path").catch(() => undefined);
    await client.query(`drop schema if exists "${schema}" cascade`)
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}

function deterministicOrder<T>(
  values: readonly T[],
  seed: number
): T[] {
  let state = seed >>> 0;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const other = next() % (index + 1);
    [output[index], output[other]] = [output[other]!, output[index]!];
  }
  return output;
}

function oracleFrozenLabelDataset(
  replay: UnifiedProviderReplayV1,
  snapshotHash: string
) {
  const frozen = buildFrozenLabelDataset({
    frozenAt: replay.frozenAt,
    snapshotHash,
    labels: [buildFrozenLabelRecord({
      address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
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
    legacyRows: [{
      address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      label: "fixture-service-boundary",
      category: "fixture-service-boundary",
      provider: "frozen-replay",
      observedAt: replay.frozenAt
    }]
  });
  if (
    replay.deterministic.traversalPolicyVersion ===
      "snapshot-closure-v2" &&
    frozen.sha256 !== replay.deterministic.labelDatasetSha256
  ) {
    throw new Error("rolling_oracle_frozen_label_dataset_mismatch");
  }
  return frozen;
}

function runRecord(replay?: UnifiedProviderReplayV1): AnalysisRunRecord {
  const snapshot = {
    version: "confirmed-wallet-snapshot-v1",
    schemaVersion: 1,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: "90000000",
    confirmedBlockHash: "9".repeat(64),
    timestamp: "2026-07-24T11:59:00.000Z",
    balances: {
      usdtRaw: "0",
      trxSun: "0",
      source: "fixture",
      consistency: "exact"
    }
  } as const;
  const snapshotHash = fingerprintCanonicalJson(snapshot);
  const replayPolicy = replay?.deterministic.traversalPolicyVersion ??
    "snapshot-closure-v1";
  if (
    replayPolicy !== "snapshot-closure-v1" &&
    replayPolicy !== "snapshot-closure-v2"
  ) {
    throw new Error("rolling_oracle_traversal_policy_invalid");
  }
  const traversalPolicyVersion:
    "snapshot-closure-v1" | "snapshot-closure-v2" =
      replayPolicy;
  const branchVersions = {
    labelDatasetSha256: replay?.deterministic.labelDatasetSha256 ??
      "c".repeat(64),
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion,
    runtimeCommit: "candidate",
    schemaVersion: 34
  };
  const branchArtifactHashes = Object.fromEntries(
    (["fast", "deep", "where"] as const).map((branchId) => [
      branchId,
      fingerprintCanonicalJson(
        buildUnifiedBranchInput(branchId, snapshotHash, branchVersions)
      )
    ])
  ) as Record<"fast" | "deep" | "where", string>;
  const analysisManifest = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId: RUN_ID,
    requestHash: "d".repeat(64),
    snapshotHash,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: snapshot.confirmedBlockNumber,
    confirmedBlockHash: snapshot.confirmedBlockHash,
    confirmedBlockTimestamp: snapshot.timestamp,
    labelDatasetSha256: branchVersions.labelDatasetSha256,
    scoringPolicyVersion: branchVersions.scoringPolicyVersion,
    attributionPolicyVersion: branchVersions.attributionPolicyVersion,
    traversalPolicyVersion,
    ...(traversalPolicyVersion === "snapshot-closure-v2" ? {
      labelCatalogVersion: "unified-label-catalog-v1" as const,
      boundaryPredicateVersion: "unified-boundary-predicates-v1" as const
    } : {}),
    runtimeCommit: branchVersions.runtimeCommit,
    databaseSchemaVersion: 34,
    paginationCutoffBlockNumber: snapshot.confirmedBlockNumber,
    paginationCutoffBlockHash: snapshot.confirmedBlockHash,
    branchArtifactHashes
  } as const;
  return {
    id: RUN_ID,
    fairnessOwnerId: "rolling-oracle-owner",
    analysisKeySha256: "a".repeat(64),
    subjectAddress: SUBJECT,
    runPurpose: "synthetic_test",
    sideEffectPolicy: "isolated",
    status: "RUNNING",
    snapshotHash,
    snapshot,
    analysisManifestSha256: fingerprintCanonicalJson(analysisManifest),
    analysisManifest,
    rolloutPolicy: {
      stage: "global_barrier",
      bucket: 0,
      admissionPolicy: "barrier",
      providerCapacityCeiling: 1
    }
  };
}

async function seedRuntime(
  client: pg.PoolClient,
  host: UnifiedTransactionalQueryable,
  replay: UnifiedProviderReplayV1
): Promise<AnalysisRunRecord> {
  const run = runRecord(replay);
  if (
    replay.deterministic.traversalPolicyVersion === "snapshot-closure-v2"
  ) {
    const frozen = oracleFrozenLabelDataset(replay, run.snapshotHash);
    await client.query(
      `insert into unified_label_datasets (sha256, dataset_json)
       values ($1,$2::jsonb)`,
      [frozen.sha256, JSON.stringify(frozen.dataset)]
    );
  }
  await client.query(
    `insert into unified_check_runs (
       id, analysis_key_sha256, subject_address, status, run_purpose,
       side_effect_policy, analysis_manifest_sha256, fairness_owner_id
     ) values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$5)`,
    [
      run.id,
      run.analysisKeySha256,
      run.subjectAddress,
      run.analysisManifestSha256,
      run.fairnessOwnerId
    ]
  );
  await client.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values
       ($1,$2,'confirmed_snapshot','1',$3::jsonb),
       ($4,$2,'analysis_manifest','1',$5::jsonb)`,
    [
      run.snapshotHash,
      run.id,
      JSON.stringify(run.snapshot),
      run.analysisManifestSha256,
      JSON.stringify(run.analysisManifest)
    ]
  );
  const directArtifact = {
    version: "rolling-oracle-direct-prerequisite-v1",
    runId: run.id,
    replaySha256: replay.expectedReplaySha256
  };
  const directSha256 = fingerprintCanonicalArtifact(directArtifact);
  await client.query(
    `insert into unified_check_artifacts (
       sha256, created_by_run_id, kind, schema_version, artifact_json
     ) values ($1,$2,'direct_history','1',$3::jsonb)`,
    [directSha256, run.id, JSON.stringify(directArtifact)]
  );
  await client.query(
    `insert into unified_check_tasks (
       id, run_id, kind, status, priority_lane, logical_key, attempt,
       accepted_attempt_id
     ) values (
       'oracle-direct',$1,'direct_history','COMPLETED','interactive','main',
       1,null
     )`,
    [run.id]
  );
  await client.query(
    `insert into unified_check_attempts (
       id, task_id, attempt, artifact_sha256, completed_at
     ) values (
       'oracle-direct-attempt','oracle-direct',1,$1,
       '2026-07-24T12:00:00.000Z'
     )`,
    [directSha256]
  );
  await client.query(
    `update unified_check_tasks
        set accepted_attempt_id = 'oracle-direct-attempt'
      where id = 'oracle-direct'`
  );
  await client.query(
    `insert into unified_check_tasks (
       id, run_id, kind, status, priority_lane, logical_key, checkpoint_json
     ) values (
       'oracle-traversal',$1,'traversal','QUEUED','interactive','main',
       $2::jsonb
     )`,
    [
      run.id,
      JSON.stringify({
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: null
      })
    ]
  );
  await planUnifiedOrderedTasks(host, {
    runId: run.id,
    tasks: replay.requests.map((request, index) => ({
      taskId: `oracle-provider-${index}`,
      kind: "oracle_provider",
      logicalKey: request.canonicalRequestSha256,
      priorityLane: request.endpoint.includes("blacklist")
        ? "repair" as const
        : "interactive" as const,
      checkpoint: {
        version: "rolling-oracle-provider-checkpoint-v1",
        endpoint: request.endpoint,
        responseArtifactSha256: request.responseArtifactSha256
      }
    }))
  });
  await client.query(
    `update unified_check_tasks
        set ready_at = '2026-07-24T11:59:59.000Z'
      where run_id = $1`,
    [run.id]
  );
  return run;
}

function commitEntries(
  entries: Awaited<ReturnType<typeof loadUnifiedBoundedReadyPrefix>>
) {
  return entries.map((entry) => ({
    canonicalSequence: entry.canonicalSequence,
    taskId: entry.taskId,
    logicalKey: entry.logicalKey,
    acceptedAttemptId: entry.acceptedAttemptId,
    resultBytes: entry.resultBytes,
    taskKind: entry.taskKind,
    artifactKind: entry.artifactKind,
    artifactSchemaVersion: entry.artifactSchemaVersion
  }));
}

async function completePlannerReplay(input: {
  readonly client: pg.PoolClient;
  host: UnifiedTransactionalQueryable;
  readonly replay: UnifiedProviderReplayV1;
  readonly policy: "barrier" | "rolling";
  readonly capacity: number;
  readonly seed: number;
}): Promise<{
  readonly committedArtifacts: readonly unknown[];
  readonly committedHashes: readonly string[];
  readonly restartRecoveries: number;
  readonly cooldownRecoveries: number;
}> {
  const responseByHash = new Map(input.replay.responses.map((response) => [
    response.responseArtifactSha256,
    response.artifact
  ]));
  const requestByTask = new Map(input.replay.requests.map((request, index) => [
    `oracle-provider-${index}`,
    request
  ]));
  let host = input.host;
  let completed = 0;
  let commits = 0;
  let restartRecoveries = 0;
  let cooldownRecoveries = 0;
  let cooldownInjected = false;
  let guard = 0;
  const runProductionReconciliationCycle = async () => {
    const refill = await refillOrderedAdmissions(host, {
      runId: RUN_ID,
      policy: input.policy,
      lookaheadTarget: input.capacity,
      readyBufferMaxEntries: 256,
      readyBufferMaxBytes: 64 * 1024 * 1024,
      reservedBufferMaxBytes: 64 * 1024 * 1024,
      reservationBytesPerTask: RESERVATION_BYTES,
      now: new Date("2026-07-24T12:00:00.000Z")
    });
    if (
      input.policy === "rolling" &&
      input.capacity === 4 &&
      !cooldownInjected
    ) {
      const cooled = await input.client.query(
        `update unified_check_tasks task
            set status = 'WAITING_RETRY',
                ready_at = '2999-01-01T00:00:00.000Z',
                last_error = 'provider_cooldown'
           from unified_check_planner_entries entry
          where entry.run_id = task.run_id and entry.task_id = task.id
            and entry.run_id = $1 and entry.canonical_sequence = 0
            and entry.admitted_at is not null and task.status = 'QUEUED'
          returning task.id`,
        [RUN_ID]
      );
      cooldownInjected = cooled.rows.length === 1;
    }

    const claimed: OracleClaimedTask[] = [];
    for (let slot = 0; slot < input.capacity; slot += 1) {
      const task = await claimUnifiedTask(input.client, {
        workerId: `oracle-provider-slot-${slot}`,
        leaseToken: `provider-lease-${guard}-${slot}`,
        leaseMs: 60_000,
        kinds: ["oracle_provider"],
        runId: RUN_ID
      });
      if (!task) break;
      claimed.push(oracleClaimedTask(task));
    }
    const completionOrder = deterministicOrder(
      claimed,
      input.seed + guard
    ).sort((left, right) => {
      if (input.capacity === 1) return 0;
      // A claimed canonical head is deliberately slow; tails can finish first.
      if (left.id === "oracle-provider-0") return 1;
      if (right.id === "oracle-provider-0") return -1;
      return 0;
    });
    for (const task of completionOrder) {
      const request = requestByTask.get(task.id);
      if (!request) throw new Error("rolling_oracle_task_binding_missing");
      const artifact = responseByHash.get(request.responseArtifactSha256);
      if (artifact === undefined) {
        throw new Error("rolling_oracle_response_missing");
      }
      const acceptance = {
        taskId: task.id,
        leaseToken: `provider-lease-${guard}-${claimed.indexOf(task)}`,
        attempt: task.attempt,
        attemptId: `accepted-${task.id}`,
        artifactSha256: request.responseArtifactSha256,
        acceptedArtifact: {
          kind: "provider_replay_response",
          schemaVersion: "1",
          value: artifact
        }
      };
      await completeUnifiedTaskAttempt(host, acceptance);
      if (completed === 0) {
        await completeUnifiedTaskAttempt(host, acceptance);
      }
      completed += 1;
    }
    if (cooldownInjected && cooldownRecoveries === 0) {
      await input.client.query(
        `update unified_check_tasks
            set ready_at = '2026-07-24T11:59:59.000Z'
          where id = 'oracle-provider-0'
            and status = 'WAITING_RETRY'`
      );
      cooldownRecoveries = 1;
    }

    const rawTraversal = await claimUnifiedTask(input.client, {
      workerId: "oracle-analysis",
      leaseToken: `traversal-lease-${guard}`,
      leaseMs: 60_000,
      kinds: ["traversal"],
      runId: RUN_ID
    });
    if (rawTraversal) {
      const traversal = oracleClaimedTask(rawTraversal);
      const ready = await loadUnifiedBoundedReadyPrefix(input.client, {
        runId: RUN_ID,
        maxEntries: 3,
        maxBytes: 8 * 1024 * 1024,
        expectedTaskKind: "oracle_provider",
        expectedArtifactKind: "provider_replay_response",
        expectedArtifactSchemaVersion: "1"
      });
      if (ready.length === 0) {
        throw new Error("rolling_oracle_traversal_claim_without_ready_head");
      }
      const previousHead =
        traversal.checkpoint &&
        typeof traversal.checkpoint === "object" &&
        !Array.isArray(traversal.checkpoint)
          ? (
              traversal.checkpoint as Record<string, unknown>
            ).deltaHeadSha256 as string | null
          : null;
      const nextHead = fingerprintCanonicalArtifact({
        version: "rolling-oracle-commit-head-v1",
        previousHead,
        acceptedArtifactSha256s: ready.map((entry) =>
          entry.artifactSha256
        )
      });
      await checkpointUnifiedTask(host, {
        taskId: traversal.id,
        leaseToken: `traversal-lease-${guard}`,
        attempt: traversal.attempt,
        checkpoint: {
          version: "unified-production-traversal-checkpoint-v2",
          deltaHeadSha256: nextHead
        },
        barrierReservedBytes: RESERVATION_BYTES,
        orderedCommit: {
          runId: RUN_ID,
          expectedDeltaHeadSha256: previousHead,
          entries: commitEntries(ready),
          discoveredTasks: []
        }
      });
      commits += ready.length;
      if (restartRecoveries === 0) {
        // Commit succeeded; the process is reconstructed before the lost
        // refill wake is reconciled from durable planner state.
        host = hostFor(input.client);
        restartRecoveries = 1;
      }
    }
    return {
      actionableWorkFound: commits < input.replay.requests.length,
      admitted: refill.admittedTaskIds.length,
      wokenSlots: claimed.length
    };
  };
  const reconciliation = createUnifiedReconciliation({
    intervalMs: 30_000,
    runCycle: runProductionReconciliationCycle,
    now: () => new Date("2026-07-24T12:00:00.000Z")
  });
  try {
    while (commits < input.replay.requests.length) {
      guard += 1;
      if (guard > 100) {
        throw new Error("rolling_oracle_progress_stalled");
      }
      await reconciliation.tick();
    }
  } finally {
    await reconciliation.stop();
  }
  const rawTraversal = await claimUnifiedTask(input.client, {
    workerId: "oracle-analysis-final",
    leaseToken: "traversal-final-lease",
    leaseMs: 60_000,
    kinds: ["traversal"],
    runId: RUN_ID
  });
  if (!rawTraversal) throw new Error("rolling_oracle_traversal_final_missing");
  const traversal = oracleClaimedTask(rawTraversal);
  const traversalArtifact = {
    version: "rolling-oracle-traversal-final-v1",
    schemaVersion: 1,
    runId: RUN_ID,
    replaySha256: input.replay.expectedReplaySha256,
    committedCount: commits,
    closed: true
  };
  const traversalSha256 =
    fingerprintCanonicalArtifact(traversalArtifact);
  const finalAcceptance = {
    taskId: traversal.id,
    leaseToken: "traversal-final-lease",
    attempt: traversal.attempt,
    attemptId: "oracle-traversal-attempt",
    artifactSha256: traversalSha256,
    acceptedArtifact: {
      kind: "traversal",
      schemaVersion: "1",
      value: traversalArtifact
    }
  };
  await completeUnifiedTaskAttempt(host, finalAcceptance);
  await completeUnifiedTaskAttempt(host, finalAcceptance);

  const committed = (
    await input.client.query(
      `select entry.canonical_sequence, attempt.artifact_sha256,
              artifact.artifact_json
         from unified_check_planner_entries entry
         join unified_check_tasks task
           on task.run_id = entry.run_id and task.id = entry.task_id
         join unified_check_attempts attempt
           on attempt.id = task.accepted_attempt_id
         join unified_check_artifacts artifact
           on artifact.sha256 = attempt.artifact_sha256
        where entry.run_id = $1 and entry.planner_state = 'committed'
        order by entry.canonical_sequence`,
      [RUN_ID]
    )
  ).rows;
  if (committed.length !== input.replay.requests.length) {
    throw new Error("rolling_oracle_commit_count_invalid");
  }
  return {
    committedArtifacts: committed.map((row) => row.artifact_json),
    committedHashes: committed.map((row) => String(row.artifact_sha256)),
    restartRecoveries,
    cooldownRecoveries
  };
}

function branches(
  run: AnalysisRunRecord,
  committedArtifacts: readonly unknown[]
): MinimalBranchResult[] {
  const partitions = [
    ["fast", committedArtifacts.slice(0, 2)],
    ["deep", committedArtifacts.slice(2, 5)],
    ["where", committedArtifacts.slice(5)]
  ] as const;
  return partitions.map(([branchId, responses], index) => ({
    branchId,
    attemptId: `oracle-branch-attempt-${branchId}`,
    inputHash: run.analysisManifest.branchArtifactHashes[branchId]!,
    status: "COMPLETED",
    output: {
      version: `rolling-oracle-${branchId}-output-v1`,
      responses
    },
    createdAt: `2026-07-24T12:00:0${index}.000Z`
  }));
}

function walletMetrics(
  run: AnalysisRunRecord,
  neutralFactId: string
) {
  return {
    version: "unified-wallet-metrics-v1" as const,
    asOfBlock: run.analysisManifest.confirmedBlockNumber,
    observedAt: run.analysisManifest.confirmedBlockTimestamp,
    consistency: "snapshot_exact" as const,
    profile: {
      createdAt: null,
      firstUsdtActivityAt: null,
      lastUsdtActivityAt: null,
      incomingUsdtTransferCount: 0,
      outgoingUsdtTransferCount: 0,
      snapshotUsdtBalanceRaw: "0",
      snapshotTrxBalanceSun: "0",
      liveBalanceObservation: null
    },
    scoreDrivers: [{
      code: "neutral_no_observed_risk",
      factIds: [neutralFactId],
      collapsedFactCount: 1
    }],
    currentBalanceAttribution: {
      scope: "current_balance_attribution" as const,
      denominatorRaw: "0",
      rows: []
    },
    outgoingMovement: {
      scope: "all_direct_outgoing_to_snapshot" as const,
      denominatorRaw: "0",
      rows: []
    },
    serviceLinks: [],
    contractsAndApprovals: [],
    behaviorAndConnections: [],
    coverage: [],
    principalInboundEvents: [],
    negativeFacts: []
  };
}

async function finalizeOracleFacts(input: {
  readonly client: pg.PoolClient;
  readonly host: UnifiedTransactionalQueryable;
  readonly run: AnalysisRunRecord;
  readonly committedArtifacts: readonly unknown[];
  readonly committedHashes: readonly string[];
}): Promise<OracleFacts> {
  const completed = buildMinimalUnifiedCheckCandidate({
    run: input.run,
    branches: branches(input.run, input.committedArtifacts)
  });
  await commitMinimalUnifiedCheck({
    db: input.host,
    run: input.run,
    branches: branches(input.run, input.committedArtifacts),
    candidate: completed
  });
  await input.client.query(
    `update unified_check_runs
        set status = 'FINALIZING', run_purpose = 'user_check',
            side_effect_policy = 'authoritative'
      where id = $1`,
    [input.run.id]
  );
  await input.client.query(
    `insert into unified_check_requests (
       id, request_correlation_id, run_id, subject_address, chat_id,
       message_thread_id, locale, run_purpose, side_effect_policy, status,
       accepted_at
     ) values (
       'oracle-request','oracle-correlation',$1,$2,'oracle-chat','',
       'ru','user_check','authoritative','ATTACHED',
       '2026-07-24T12:05:00.000Z'
     )`,
    [input.run.id, input.run.subjectAddress]
  );
  const neutralFactId = completed.evidence.canonicalFactIds[0]!;
  const dossier = buildUnifiedWalletReport({
    manifest: completed.manifest,
    evidence: completed.evidence,
    closure: completed.closure,
    scoring: completed.scoring,
    selectedAttributionPolicy: "proportional",
    walletMetrics: walletMetrics(input.run, neutralFactId)
  });
  const presented = buildUnifiedPresentedCompletionCandidate({
    report: dossier,
    recipients: [{
      requestId: "oracle-request",
      deliveryId: "oracle-delivery",
      locale: "ru"
    }]
  });
  await commitUnifiedPresentedCompletion({
    db: input.host,
    runId: input.run.id,
    candidate: presented
  });
  await expect(commitUnifiedPresentedCompletion({
    db: input.host,
    runId: input.run.id,
    candidate: presented
  })).rejects.toThrow("unified_presented_run_not_finalizing");
  const deliveryCount = Number((
    await input.client.query(
      `select count(*)::int as count
         from unified_check_deliveries delivery
         join unified_check_requests request on request.id = delivery.request_id
        where request.run_id = $1`,
      [input.run.id]
    )
  ).rows[0]?.count);
  const isolatedFakeTransport = {
    simulatedSendCount: 0,
    externalTelegramSends: 0,
    async sendTelegram() {
      this.simulatedSendCount += 1;
      return {
        kind: "confirmed" as const,
        telegramMessageId: "isolated-fake-message"
      };
    }
  };
  const deliveryCycle = await runUnifiedDeliveryCycle({
    repository: createPostgresUnifiedDeliveryRepository(input.client),
    now: () => new Date("2026-07-24T12:06:00.000Z"),
    leaseToken: () => "oracle-isolated-delivery-lease",
    leaseMs: 60_000,
    limit: 1,
    sendTelegram: () => isolatedFakeTransport.sendTelegram()
  });
  expect(deliveryCycle).toMatchObject({ claimed: 1, settled: 1 });
  expect(isolatedFakeTransport.simulatedSendCount).toBe(1);
  const plannerCounts = (
    await input.client.query(
      `select count(*)::int as count,
              count(distinct canonical_sequence)::int as distinct_count,
              count(distinct task_id)::int as distinct_tasks
         from unified_check_planner_entries
        where run_id = $1 and planner_state = 'committed'`,
      [input.run.id]
    )
  ).rows[0]!;
  const terminalEvidenceSha256s = (await input.client.query(
    `select sha256
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'traversal_terminal_evidence'
      order by sha256`,
    [input.run.id]
  )).rows.map((row) => String(row.sha256));
  const traversalArtifactVersion = String((await input.client.query(
    `select artifact.artifact_json->>'version' as version
       from unified_check_tasks task
       join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
       join unified_check_artifacts artifact
         on artifact.sha256 = attempt.artifact_sha256
      where task.run_id = $1 and task.kind = 'traversal'`,
    [input.run.id]
  )).rows[0]?.version);
  const terminalEvidenceSchemaVersions = (await input.client.query(
    `select distinct schema_version
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'traversal_terminal_evidence'
      order by schema_version`,
    [input.run.id]
  )).rows.map((row) => String(row.schema_version));
  const terminalEvidenceArtifacts = (await input.client.query(
    `select artifact_json
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'traversal_terminal_evidence'
      order by sha256`,
    [input.run.id]
  )).rows.map((row) => row.artifact_json);
  return {
    traversalArtifactVersion: traversalArtifactVersion as
      OracleFacts["traversalArtifactVersion"],
    canonicalFacts: completed.artifacts.get(
      completed.evidence.canonicalFactsHash
    ),
    finalFrontier: completed.frontier,
    terminalEvidenceSha256s,
    terminalEvidenceSchemaVersions,
    terminalEvidenceArtifacts,
    analysisManifestSha256: input.run.analysisManifestSha256,
    closureCertificate: completed.closure,
    score: completed.scoring.score,
    decision: completed.scoring.decision,
    evidenceBundleSha256: completed.hashes.evidence,
    traversalClosureSha256: completed.hashes.closure,
    scoringBundleSha256: completed.hashes.scoring,
    reportSha256: presented.reportHash,
    presentationSha256s: presented.deliveries.map((delivery) =>
      delivery.presentation.presentationHash
    ).sort(),
    eligibleDeliveryIntentCount: deliveryCount,
    externalTelegramSends:
      isolatedFakeTransport.externalTelegramSends,
    providerResponseArtifactSha256s: input.committedHashes,
    committedSequenceCount: Number(plannerCounts.count),
    duplicateCommitCount:
      Number(plannerCounts.count) - Number(plannerCounts.distinct_tasks),
    duplicateSequenceCount:
      Number(plannerCounts.count) - Number(plannerCounts.distinct_count)
  };
}

async function runGenericPlannerScenario(input: {
  readonly replay: UnifiedProviderReplayV1;
  readonly policy: "barrier" | "rolling";
  readonly capacity: number;
  readonly seed: number;
}): Promise<OracleFacts> {
  return withSchema(async ({ client, host }) => {
    const run = await seedRuntime(client, host, input.replay);
    const replayed = await completePlannerReplay({
      client,
      host,
      replay: input.replay,
      policy: input.policy,
      capacity: input.capacity,
      seed: input.seed
    });
    expect(replayed.restartRecoveries).toBe(1);
    if (input.policy === "rolling" && input.capacity === 4) {
      expect(replayed.cooldownRecoveries).toBe(1);
    }
    return finalizeOracleFacts({
      client,
      host,
      run,
      committedArtifacts: replayed.committedArtifacts,
      committedHashes: replayed.committedHashes
    });
  });
}

function replayHistoryId(address: string): "tpcp" | "tfwg" | "txc" {
  if (address === SUBJECT) return "tpcp";
  if (address === "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr") return "tfwg";
  if (address === "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd") return "txc";
  throw new Error(`rolling_oracle_unexpected_history_address:${address}`);
}

function productionProviderPage(
  replay: UnifiedProviderReplayV1,
  address: string,
  cursor: string | null
) {
  // ponytail: project the frozen scheduler snapshot to the smallest valid
  // production report graph; replace this adapter when canonical real provider
  // pages are captured. The separate scheduler receipt still binds every page.
  const historyId = replayHistoryId(address);
  if (historyId === "txc") {
    const content = {
      kind: "page" as const,
      cursor: null,
      nextCursor: null,
      transfers: [] as readonly RawTronscanTrc20Transfer[],
      reachedAccountCreation: true,
      provider: "tronscan" as const
    };
    return {
      ...content,
      pageHash: fingerprintCanonicalArtifact(content)
    };
  }
  const response = replay.responses.map((item) => item.artifact).find(
    (artifact) => {
      if (
        artifact === null ||
        typeof artifact !== "object" ||
        Array.isArray(artifact)
      ) return false;
      const row = artifact as Record<string, unknown>;
      return row.historyId === historyId && row.cursor === cursor;
    }
  ) as {
    readonly cursor: string | null;
    readonly nextCursor: string | null;
    readonly transfers: readonly {
      readonly block: string;
      readonly from_address: string;
      readonly quant: string;
      readonly to_address: string;
      readonly transaction_id: string;
    }[];
  } | undefined;
  if (!response) {
    throw new Error(
      `rolling_oracle_provider_page_missing:${historyId}:${cursor ?? "root"}`
    );
  }
  const transfers = response.transfers.map((transfer) => ({
    transaction_id: fingerprintCanonicalArtifact({
      replaySha256: replay.expectedReplaySha256,
      transactionId: transfer.transaction_id
    }),
    from_address: transfer.from_address,
    to_address: transfer.to_address,
    quant: transfer.quant,
    contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: Date.parse(replay.frozenClockIso) -
      Math.max(1, 90_000_000 - Number(transfer.block)) * 1_000,
    block: Number(transfer.block)
  } as RawTronscanTrc20Transfer));
  const nextCursor = historyId === "tpcp" ? null : response.nextCursor;
  const content = {
    kind: "page" as const,
    cursor: response.cursor,
    nextCursor,
    transfers,
    reachedAccountCreation: nextCursor === null,
    provider: "tronscan" as const
  };
  return {
    ...content,
    pageHash: fingerprintCanonicalArtifact(content)
  };
}

async function productionOracleFacts(input: {
  readonly client: pg.PoolClient;
  readonly replay: UnifiedProviderReplayV1;
  readonly policy: "barrier" | "rolling";
  readonly capacity: number;
}): Promise<OracleFacts> {
  const db = hostFor(input.client);
  const policyVersion = input.replay.deterministic.traversalPolicyVersion;
  if (
    policyVersion !== "snapshot-closure-v1" &&
    policyVersion !== "snapshot-closure-v2"
  ) {
    throw new Error("rolling_oracle_traversal_policy_invalid");
  }
  const snapshot = runRecord(input.replay).snapshot;
  const frozen = oracleFrozenLabelDataset(
    input.replay,
    fingerprintCanonicalArtifact(snapshot)
  );
  const legacyDataset = {
    version: "unified-label-dataset-v1",
    rows: []
  } as const;
  const labelDatasetSha256 = policyVersion === "snapshot-closure-v2"
    ? frozen.sha256
    : fingerprintCanonicalArtifact(legacyDataset);
  const labelDataset = policyVersion === "snapshot-closure-v2"
    ? frozen.dataset
    : legacyDataset;
  await input.client.query(
    `insert into unified_label_datasets (sha256, dataset_json)
     values ($1,$2::jsonb)`,
    [labelDatasetSha256, JSON.stringify(labelDataset)]
  );
  const intake = await intakeUnifiedCheck({
    store: createPostgresUnifiedRequestStore(db),
    snapshotSource: {
      latestConfirmedBlock: async () => ({
        number: snapshot.confirmedBlockNumber,
        hash: snapshot.confirmedBlockHash,
        timestamp: snapshot.timestamp
      }),
      snapshotBalances: async () => snapshot.balances
    },
    request: {
      id: "oracle-request",
      requestCorrelationId: "oracle-correlation",
      subjectAddress: SUBJECT,
      chatId: "oracle-chat",
      messageThreadId: "",
      locale: "ru",
      runPurpose: "user_check",
      sideEffectPolicy: "authoritative"
    },
    candidateRunId: RUN_ID,
    initialTasks: ([
      "direct_history",
      "deep_direct",
      "traversal",
      "fast",
      "where",
      "deep"
    ] as const).map((kind) => ({
      id: `oracle-${kind}`,
      kind,
      priorityLane: "interactive" as const,
      logicalKey: "main"
    })),
    versions: {
      labelDatasetSha256,
      scoringPolicyVersion: "scoring-signal-matrix-v4",
      attributionPolicyVersion: "selected-attribution-policy-v1",
      traversalPolicyVersion: policyVersion,
      runtimeCommit: "candidate",
      schemaVersion: 36
    },
    rolloutPolicy: input.policy === "rolling"
      ? {
          stage: "isolated_rolling",
          boundedUserCheckBasisPoints: 0,
          providerCapacityCeiling: input.capacity
        }
      : {
          stage: "global_barrier",
          boundedUserCheckBasisPoints: 0,
          providerCapacityCeiling: 1
        },
    now: () => new Date(input.replay.frozenClockIso)
  });
  if (intake.kind !== "attached") {
    throw new Error("rolling_oracle_intake_not_attached");
  }
  let runtimeNumber = 0;
  const makeRuntime = () => {
    const process = ++runtimeNumber;
    let id = 0;
    return createUnifiedProductionRuntime({
      db,
      runtimeCommit: "candidate",
      providerConfigurationSha256: "e".repeat(64),
      addressHistoryPagesPerChunk: 1,
      commitMaxEntries: 1,
      now: () => new Date(input.replay.frozenClockIso),
      createId: () => `oracle-p${process}-id-${++id}`,
      loadProviderPage: async ({ run, address, cursor }) =>
        productionProviderPage(
          input.replay,
          address ?? run.subjectAddress,
          cursor
        ),
      loadCounterpartyLabels: async ({ addresses }) => {
        const labels = new Map<string, readonly string[]>();
        const response = input.replay.responses.map((item) => item.artifact)
          .find((artifact) =>
            artifact !== null &&
            typeof artifact === "object" &&
            !Array.isArray(artifact) &&
            (artifact as Record<string, unknown>).branch === "labels"
          ) as { readonly labels?: readonly {
            readonly address: string;
            readonly labels: readonly string[];
          }[] } | undefined;
        for (const row of response?.labels ?? []) {
          if (addresses.includes(row.address)) labels.set(row.address, row.labels);
        }
        return labels;
      },
      loadFrozenLabelDataset: async ({ labelDatasetSha256 }) => {
        const row = (await input.client.query(
          `select dataset_json from unified_label_datasets where sha256 = $1`,
          [labelDatasetSha256]
        )).rows[0];
        if (!row) throw new Error("rolling_oracle_frozen_dataset_missing");
        return row.dataset_json;
      },
      loadHardEvidence: async () => ({})
    });
  };
  let runtime = makeRuntime();
  let restarted = false;
  let completed = false;
  for (let guard = 0; guard < 128; guard += 1) {
    await runtime.runAnalysisCycle();
    await runtime.runProviderCycle(0);
    if (!restarted) {
      const durableProgress = Number((await input.client.query(
        `select count(*)::int as count
           from unified_check_attempts attempt
           join unified_check_tasks task on task.id = attempt.task_id
          where task.run_id = $1`,
        [RUN_ID]
      )).rows[0]?.count);
      if (durableProgress > 0) {
        runtime = makeRuntime();
        restarted = true;
      }
    }
    const outstanding = Number((await input.client.query(
      `select count(*)::int as count
         from unified_check_tasks
        where run_id = $1 and status <> 'COMPLETED'`,
      [RUN_ID]
    )).rows[0]?.count);
    if (outstanding === 0) {
      const finalization = await runtime.runFinalizationCycle();
      if (finalization.finalized) {
        completed = true;
        break;
      }
    }
  }
  if (!completed || !restarted) {
    throw new Error("rolling_oracle_production_progress_stalled");
  }
  const transport = {
    simulated: 0,
    external: 0,
    async sendTelegram() {
      this.simulated += 1;
      return {
        kind: "confirmed" as const,
        telegramMessageId: "oracle-fake-message"
      };
    }
  };
  const delivery = await runUnifiedDeliveryCycle({
    repository: createPostgresUnifiedDeliveryRepository(input.client),
    now: () => new Date(input.replay.frozenClockIso),
    leaseToken: () => "oracle-delivery-lease",
    leaseMs: 60_000,
    limit: 1,
    sendTelegram: () => transport.sendTelegram()
  });
  expect(delivery).toMatchObject({ claimed: 1, settled: 1 });
  const beforeRestart = (await input.client.query(
    `select status, final_score, final_decision,
            analysis_manifest_sha256,
            evidence_bundle_sha256, traversal_closure_sha256,
            scoring_bundle_sha256, report_sha256
       from unified_check_runs where id = $1`,
    [RUN_ID]
  )).rows[0]!;
  const completedRestart = makeRuntime();
  await expect(completedRestart.runProviderCycle())
    .resolves.toMatchObject({ outcome: "idle" });
  await expect(completedRestart.runAnalysisCycle())
    .resolves.toMatchObject({ outcome: "idle" });
  await expect(completedRestart.runFinalizationCycle())
    .resolves.toMatchObject({ finalized: false });
  const secondDelivery = await runUnifiedDeliveryCycle({
    repository: createPostgresUnifiedDeliveryRepository(input.client),
    now: () => new Date(input.replay.frozenClockIso),
    leaseToken: () => "oracle-delivery-lease-2",
    leaseMs: 60_000,
    limit: 1,
    sendTelegram: () => transport.sendTelegram()
  });
  expect(secondDelivery).toMatchObject({ claimed: 0, settled: 0 });
  expect((await input.client.query(
    `select status, final_score, final_decision,
            analysis_manifest_sha256,
            evidence_bundle_sha256, traversal_closure_sha256,
            scoring_bundle_sha256, report_sha256
       from unified_check_runs where id = $1`,
    [RUN_ID]
  )).rows[0]).toEqual(beforeRestart);

  const traversalArtifact = (await input.client.query(
    `select artifact.artifact_json
       from unified_check_tasks task
       join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
       join unified_check_artifacts artifact
         on artifact.sha256 = attempt.artifact_sha256
      where task.run_id = $1 and task.kind = 'traversal'`,
    [RUN_ID]
  )).rows[0]?.artifact_json as {
    readonly version: string;
    readonly frontier: readonly unknown[];
  };
  const artifactByKind = async (kind: string) => (
    await input.client.query(
      `select sha256, artifact_json
         from unified_check_artifacts
        where created_by_run_id = $1 and kind = $2
        order by sha256`,
      [RUN_ID, kind]
    )
  ).rows;
  const factsRows = await artifactByKind("canonical_facts");
  const closureRows = await artifactByKind("traversal_closure");
  const terminalRows = await artifactByKind(
    "traversal_terminal_evidence"
  );
  const providerRows = await input.client.query(
    `select sha256
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind in ('direct_history_page','address_history_page')
      order by sha256`,
    [RUN_ID]
  );
  if (
    factsRows.length !== 1 ||
    closureRows.length !== 1 ||
    !traversalArtifact
  ) {
    throw new Error("rolling_oracle_production_artifacts_missing");
  }
  const plannerCounts = (await input.client.query(
    `select count(*)::int as count,
            count(distinct canonical_sequence)::int as distinct_count,
            count(distinct task_id)::int as distinct_tasks
       from unified_check_planner_entries
      where run_id = $1 and planner_state = 'committed'`,
    [RUN_ID]
  )).rows[0]!;
  const presentationSha256s = (await input.client.query(
    `select presentation_sha256
       from unified_check_deliveries delivery
       join unified_check_requests request on request.id = delivery.request_id
      where request.run_id = $1
      order by presentation_sha256`,
    [RUN_ID]
  )).rows.map((row) => String(row.presentation_sha256));
  return {
    traversalArtifactVersion: traversalArtifact.version,
    canonicalFacts: factsRows[0]!.artifact_json,
    finalFrontier: traversalArtifact.frontier,
    terminalEvidenceSha256s: terminalRows.map((row) => String(row.sha256)),
    terminalEvidenceSchemaVersions: [...new Set(
      terminalRows.map((row) => String(
        (row.artifact_json as { schemaVersion?: unknown }).schemaVersion ?? 1
      ))
    )].sort(),
    terminalEvidenceArtifacts:
      terminalRows.map((row) => row.artifact_json),
    analysisManifestSha256: String(
      beforeRestart.analysis_manifest_sha256
    ),
    closureCertificate: closureRows[0]!.artifact_json,
    score: Number(beforeRestart.final_score),
    decision: String(beforeRestart.final_decision) as OracleFacts["decision"],
    evidenceBundleSha256: String(beforeRestart.evidence_bundle_sha256),
    traversalClosureSha256:
      String(beforeRestart.traversal_closure_sha256),
    scoringBundleSha256: String(beforeRestart.scoring_bundle_sha256),
    reportSha256: String(beforeRestart.report_sha256),
    presentationSha256s,
    eligibleDeliveryIntentCount: presentationSha256s.length,
    externalTelegramSends: transport.external,
    providerResponseArtifactSha256s:
      providerRows.rows.map((row) => String(row.sha256)),
    committedSequenceCount: Number(plannerCounts.count),
    duplicateCommitCount:
      Number(plannerCounts.count) - Number(plannerCounts.distinct_tasks),
    duplicateSequenceCount:
      Number(plannerCounts.count) - Number(plannerCounts.distinct_count)
  };
}

async function runScenario(input: {
  readonly replay: UnifiedProviderReplayV1;
  readonly policy: "barrier" | "rolling";
  readonly capacity: number;
  readonly seed: number;
}): Promise<OracleFacts> {
  void input.seed;
  return withSchema(({ client }) => productionOracleFacts({
    client,
    replay: input.replay,
    policy: input.policy,
    capacity: input.capacity
  }));
}

function mismatchMessage(input: {
  readonly replaySha256: string;
  readonly seed: number;
  readonly capacity: number;
  readonly firstDifferingCanonicalPath: string | null;
}): string {
  return [
    "rolling_oracle_mismatch",
    `replay=${input.replaySha256}`,
    `seed=${input.seed}`,
    `capacity=${input.capacity}`,
    `path=${input.firstDifferingCanonicalPath ?? "<none>"}`
  ].join(" ");
}

function receiptFacts(facts: OracleFacts): UnifiedRollingOracleFactsV1 {
  const {
    presentationSha256s: _presentationSha256s,
    terminalEvidenceSha256s: _terminalEvidenceSha256s,
    terminalEvidenceSchemaVersions: _terminalEvidenceSchemaVersions,
    terminalEvidenceArtifacts: _terminalEvidenceArtifacts,
    analysisManifestSha256: _analysisManifestSha256,
    traversalArtifactVersion: _traversalArtifactVersion,
    ...receipt
  } = facts;
  return JSON.parse(
    canonicalizeArtifactJson(receipt)
  ) as UnifiedRollingOracleFactsV1;
}

describe("Unified rolling oracle comparison harness", () => {
  it("binds separate v1 and v2 fixtures to the same frozen provider snapshot and a real v2 label dataset", async () => {
    const [v1Bytes, v2Bytes] = await Promise.all([
      readFile(
        "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
        "utf8"
      ),
      readFile(
        "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay-v2.json",
        "utf8"
      )
    ]);
    const parse = (bytes: string) => parseUnifiedProviderReplayV1(
      canonicalJsonFilePayload(bytes)
    );
    const v1 = parse(v1Bytes);
    const v2 = parse(v2Bytes);
    const snapshotHash = fingerprintCanonicalJson(runRecord().snapshot);
    const frozen = oracleFrozenLabelDataset(v2, snapshotHash);
    expect(v1.deterministic.traversalPolicyVersion)
      .toBe("snapshot-closure-v1");
    expect(v2.deterministic.traversalPolicyVersion)
      .toBe("snapshot-closure-v2");
    expect(v2.deterministic.labelDatasetSha256).toBe(frozen.sha256);
    expect(v2.expectedReplaySha256).not.toBe(v1.expectedReplaySha256);
    expect({
      frozenAt: v2.frozenAt,
      frozenClockIso: v2.frozenClockIso,
      sourceSnapshotSha256: v2.sourceSnapshotSha256,
      requests: v2.requests,
      responses: v2.responses
    }).toEqual({
      frozenAt: v1.frozenAt,
      frozenClockIso: v1.frozenClockIso,
      sourceSnapshotSha256: v1.sourceSnapshotSha256,
      requests: v1.requests,
      responses: v1.responses
    });
  });

  it("uses the durable PostgreSQL checkpoint head and ignores a stale alias", () => {
    const durableHead = "c".repeat(64);
    const claimed = oracleClaimedTask({
      id: "oracle-traversal",
      attempt: 2,
      checkpoint_json: {
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: durableHead
      },
      checkpoint: {
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: "d".repeat(64)
      }
    });

    expect(claimed.checkpoint).toEqual({
      version: "unified-production-traversal-checkpoint-v2",
      deltaHeadSha256: durableHead
    });
  });

  it("detects a mutated canonical fact and prints replay, seed, capacity, and path", () => {
    const baseline = {
      canonicalFacts: [{ id: "fact-1", payload: { amountRaw: "10" } }],
      reportSha256: "a".repeat(64)
    };
    const comparison = compareUnifiedReplayOracleFacts(baseline, {
      ...baseline,
      canonicalFacts: [{
        id: "fact-1",
        payload: { amountRaw: "11" }
      }]
    });
    expect(comparison.equivalent).toBe(false);
    expect(mismatchMessage({
      replaySha256: "b".repeat(64),
      seed: BASE_SEED,
      capacity: 4,
      firstDifferingCanonicalPath:
        comparison.firstDifferingCanonicalPath
    })).toContain(
      `replay=${"b".repeat(64)} seed=${BASE_SEED} capacity=4 ` +
      "path=$.canonicalFacts[0].payload.amountRaw"
    );
  });
});

postgresDescribe("Unified barrier versus rolling exact PostgreSQL oracle", () => {
  it.each(POLICY_FIXTURES)(
    "keeps $policy production traversal exact through capacities, restart, and delivery idempotency",
    async ({ policy, path, receiptOutputEnv }) => {
    const fixtureBytes = await readFile(
      path,
      "utf8"
    );
    const replay = parseUnifiedProviderReplayV1(
      canonicalJsonFilePayload(fixtureBytes)
    );
    const barrier = await runScenario({
      replay,
      policy: "barrier",
      capacity: 1,
      seed: BASE_SEED
    });
    expect(
      (barrier.canonicalFacts as { facts?: readonly unknown[] }).facts?.length
    ).toBeGreaterThan(0);
    expect(barrier.providerResponseArtifactSha256s.length)
      .toBe(policy === "snapshot-closure-v2" ? 3 : 4);
    expect(barrier.eligibleDeliveryIntentCount).toBe(1);
    expect(barrier.externalTelegramSends).toBe(0);
    expect(barrier.duplicateCommitCount).toBe(0);
    expect(barrier.duplicateSequenceCount).toBe(0);
    expect(barrier.presentationSha256s).toHaveLength(1);
    expect(barrier.traversalArtifactVersion)
      .toBe("unified-traversal-artifact-v1");
    if (policy === "snapshot-closure-v2") {
      expect(barrier.terminalEvidenceSha256s.length).toBeGreaterThan(0);
      expect(barrier.terminalEvidenceSchemaVersions).toEqual(["2"]);
      expect(barrier.finalFrontier).toEqual([]);
    }
    expect(barrier.closureCertificate.analysisManifestHash)
      .toBe(barrier.analysisManifestSha256);

    const receiptRollingFacts: Array<{
      readonly capacity: number;
      readonly seed: number;
      readonly facts: UnifiedRollingOracleFactsV1;
    }> = [];
    for (const capacity of CAPACITIES) {
      const seed = BASE_SEED + capacity;
      const rolling = await runScenario({
        replay,
        policy: "rolling",
        capacity,
        seed
      });
      const comparison = compareUnifiedReplayOracleFacts(barrier, rolling);
      if (!comparison.equivalent) {
        throw new Error(mismatchMessage({
          replaySha256: replay.expectedReplaySha256,
          seed,
          capacity,
          firstDifferingCanonicalPath:
            comparison.firstDifferingCanonicalPath
        }));
      }
      expect(rolling.eligibleDeliveryIntentCount).toBe(1);
      expect(rolling.externalTelegramSends).toBe(0);
      expect(rolling.duplicateCommitCount).toBe(0);
      expect(rolling.duplicateSequenceCount).toBe(0);
    }

    // The immutable scheduler receipt remains a separate compatibility
    // artifact. Production equivalence above crosses the real coordinator,
    // boundary, finalizer, restart, and delivery paths.
    const receiptBarrier = await runGenericPlannerScenario({
      replay,
      policy: "barrier",
      capacity: 1,
      seed: BASE_SEED
    });
    for (const capacity of CAPACITIES) {
      const seed = BASE_SEED + capacity;
      const receiptRolling = await runGenericPlannerScenario({
        replay,
        policy: "rolling",
        capacity,
        seed
      });
      receiptRollingFacts.push({
        capacity,
        seed,
        facts: receiptFacts(receiptRolling)
      });
    }

    const receipt = sealUnifiedRollingOracleReceiptV1({
      generatedAt: replay.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1",
      schemaVersion: 34,
      replaySha256: replay.expectedReplaySha256,
      seed: BASE_SEED,
      barrierFacts: receiptFacts(receiptBarrier),
      rollingFacts: receiptRollingFacts
    });
    const receiptOutput = process.env[receiptOutputEnv] ?? (
      policy === "snapshot-closure-v1"
        ? process.env.UNIFIED_ROLLING_ORACLE_RECEIPT_V1_OUTPUT ??
          process.env.UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT
        : process.env.UNIFIED_ROLLING_ORACLE_RECEIPT_V2_OUTPUT
    );
    if (receiptOutput) {
      const output = resolve(receiptOutput);
      if (
        extname(output).toLowerCase() !== ".json" ||
        output.replaceAll("\\", "/").split("/").includes(".codex-live")
      ) {
        throw new Error("rolling_oracle_receipt_output_forbidden");
      }
      const content = `${receipt.canonicalJson}\n`;
      try {
        await writeFile(output, content, {
          encoding: "utf8",
          flag: "wx"
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await readFile(output, "utf8") !== content) {
          throw new Error("rolling_oracle_receipt_output_mismatch");
        }
      }
    }
  });
});
