import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pg from "pg";
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

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV";
const CAPACITIES = [1, 4, 8, 16, 32, 100] as const;
const BASE_SEED = 24_072_026;
const RUN_ID = "rolling-oracle-run";
const RESERVATION_BYTES = 4_096;

type OracleFacts = {
  readonly canonicalFacts: unknown;
  readonly finalFrontier: readonly unknown[];
  readonly closureCertificate: unknown;
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  readonly evidenceBundleSha256: string;
  readonly traversalClosureSha256: string;
  readonly scoringBundleSha256: string;
  readonly reportSha256: string;
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

function runRecord(): AnalysisRunRecord {
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
  const branchVersions = {
    labelDatasetSha256: "c".repeat(64),
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
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
    traversalPolicyVersion: "snapshot-closure-v1",
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
    analysisManifest
  };
}

async function seedRuntime(
  client: pg.PoolClient,
  host: UnifiedTransactionalQueryable,
  replay: UnifiedProviderReplayV1
): Promise<AnalysisRunRecord> {
  const run = runRecord();
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
  return {
    canonicalFacts: completed.artifacts.get(
      completed.evidence.canonicalFactsHash
    ),
    finalFrontier: completed.frontier,
    closureCertificate: completed.closure,
    score: completed.scoring.score,
    decision: completed.scoring.decision,
    evidenceBundleSha256: completed.hashes.evidence,
    traversalClosureSha256: completed.hashes.closure,
    scoringBundleSha256: completed.hashes.scoring,
    reportSha256: presented.reportHash,
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

async function runScenario(input: {
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

describe("Unified rolling oracle comparison harness", () => {
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
  it("keeps exact canonical outputs through capacities, retry, restart, lost wake, slow head, cooldown, and delivery idempotency", async () => {
    const fixtureBytes = await readFile(
      "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
      "utf8"
    );
    const replay = parseUnifiedProviderReplayV1(
      fixtureBytes.endsWith("\n")
        ? fixtureBytes.slice(0, -1)
        : fixtureBytes
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
      .toBe(replay.requests.length);
    expect(barrier.eligibleDeliveryIntentCount).toBe(1);
    expect(barrier.externalTelegramSends).toBe(0);
    expect(barrier.duplicateCommitCount).toBe(0);
    expect(barrier.duplicateSequenceCount).toBe(0);

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
      receiptRollingFacts.push({
        capacity,
        seed,
        facts: JSON.parse(
          canonicalizeArtifactJson(rolling)
        ) as UnifiedRollingOracleFactsV1
      });
    }

    const receipt = sealUnifiedRollingOracleReceiptV1({
      generatedAt: replay.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1",
      schemaVersion: 34,
      replaySha256: replay.expectedReplaySha256,
      seed: BASE_SEED,
      barrierFacts: JSON.parse(
        canonicalizeArtifactJson(barrier)
      ) as UnifiedRollingOracleFactsV1,
      rollingFacts: receiptRollingFacts
    });
    const receiptOutput =
      process.env.UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT;
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
