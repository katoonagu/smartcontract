import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson.js";
import { projectUnifiedRunDag } from "../../src/admin/forensicsGraph.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser.js";
import {
  createServiceRoleShadowRecoveryDb
} from "../../src/storage/db.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory.js";
import {
  createUnifiedPoolTransactionHost,
  listUnifiedWatchdogRuns,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository.js";
import {
  createUnifiedProductionRuntime
} from "../../src/unifiedCheck/productionRuntime.js";
import { buildFrozenLabelDataset } from "../../src/unifiedCheck/frozenLabels.js";
import {
  createPostgresUnifiedDeliveryRepository,
  runUnifiedDeliveryCycle
} from "../../src/unifiedCheck/delivery.js";
import {
  createPostgresUnifiedRequestStore,
  intakeUnifiedCheck
} from "../../src/unifiedCheck/requestService.js";
import { inspectUnifiedRuns } from "../../src/unifiedCheck/watchdog.js";
import {
  buildServiceRoleShadowInputFenceV1,
  buildServiceRoleShadowPrecommitReceiptV1,
  createServiceRoleShadowRuntimeV1,
  parseServiceRoleShadowRunSummaryV1
} from "../../src/unifiedCheck/serviceRoleShadowRuntime.js";
import {
  deriveServiceRoleShadowAcceptedHistoryBindingV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2
} from "../../src/unifiedCheck/serviceRoleShadow.js";
import type {
  ServiceRoleEventEvidenceBundleV1
} from "../../src/unifiedCheck/serviceRoleMapMaterialization.js";
import type { TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";

const connectionString = process.env.TEST_DATABASE_URL;
const releaseGate = process.env.UNIFIED_RELEASE_GATE_MODE === "1";
const postgresDescribe = connectionString && releaseGate ? describe : describe.skip;
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const RUNTIME_COMMIT = "task-4-postgres-runtime";
const LOCK_STATE_BARRIER_DEADLINE_MS = 10_000;
const FROZEN_CLOCK_ISO = "2026-07-31T12:00:00.000Z";
const SHADOW_ARTIFACT_KINDS = [
  "service_role_shadow_input_set",
  "service_role_shadow_input_fence",
  "service_role_shadow_profile",
  "service_role_shadow_precommit_receipt",
  "service_role_shadow_runtime_receipt",
  "service_role_shadow_run_summary"
] as const;

type Harness = {
  admin: pg.Client;
  poolA: pg.Pool;
  poolB: pg.Pool;
  schema: string;
};

function analysisManifest(runId: string, snapshotHash: string) {
  return {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId,
    requestHash: fingerprintCanonicalArtifact(["request", runId]),
    snapshotHash,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: "100",
    confirmedBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    confirmedBlockTimestamp: "2026-07-30T00:00:00.000Z",
    labelDatasetSha256: fingerprintCanonicalArtifact(["labels", runId]),
    scoringPolicyVersion: "test-score-v1",
    attributionPolicyVersion: "test-attribution-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "source-runtime",
    databaseSchemaVersion: 37,
    paginationCutoffBlockNumber: "100",
    paginationCutoffBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    branchArtifactHashes: {
      fast: fingerprintCanonicalArtifact(["fast", runId]),
      deep: fingerprintCanonicalArtifact(["deep", runId]),
      where: fingerprintCanonicalArtifact(["where", runId])
    }
  };
}

async function createHarness(): Promise<Harness> {
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  const schema = `shadow_runtime_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema "${schema}"`);
  await admin.query(`set search_path to "${schema}", pg_catalog`);
  for (const functionName of [
    "now",
    "statement_timestamp",
    "transaction_timestamp",
    "clock_timestamp"
  ]) {
    await admin.query(
      `create function "${schema}".${functionName}()
       returns timestamptz language sql immutable
       as 'select timestamptz ''${FROZEN_CLOCK_ISO}'''`
    );
  }
  for (const migration of [
    "003_risk_observation_foundation.sql",
    "033_unified_wallet_check.sql",
    "034_unified_check_adaptive_planner.sql",
    "035_unified_check_run_rollout_policy.sql",
    "036_remove_rollout_authority.sql",
    "037_unified_runtime_handoff.sql"
  ]) {
    await admin.query(await readFile(`migrations/${migration}`, "utf8"));
  }
  const poolConfig = {
    connectionString,
    max: 1,
    options: `-c search_path=${schema},pg_catalog`
  };
  return {
    admin,
    poolA: new pg.Pool(poolConfig),
    poolB: new pg.Pool(poolConfig),
    schema
  };
}

async function dispose(harness: Harness): Promise<void> {
  await Promise.all([harness.poolA.end(), harness.poolB.end()]);
  await harness.admin.query("reset search_path");
  await harness.admin.query(`drop schema "${harness.schema}" cascade`);
  await harness.admin.end();
}

async function seedRun(harness: Harness): Promise<{
  runId: string;
  snapshotHash: string;
}> {
  const runId = randomUUID();
  const snapshotHash = fingerprintCanonicalArtifact(["snapshot", runId]);
  const manifest = analysisManifest(runId, snapshotHash);
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  await harness.admin.query(
    `insert into unified_check_runs (
       id,analysis_key_sha256,subject_address,status,run_purpose,
       side_effect_policy,analysis_manifest_sha256,fairness_owner_id
     ) values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$1)`,
    [runId, fingerprintCanonicalArtifact(["analysis-key", runId]), SUBJECT, manifestSha256]
  );
  await harness.admin.query(
    `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
     values ($1,$2,'analysis_manifest','1',$3::jsonb)`,
    [manifestSha256, runId, JSON.stringify(manifest)]
  );
  return { runId, snapshotHash };
}

function runtime(pool: pg.Pool) {
  return createServiceRoleShadowRuntimeV1({
    db: createUnifiedPoolTransactionHost(pool),
    runtimeCommit: RUNTIME_COMMIT
  });
}

async function backendPid(pool: pg.Pool): Promise<number> {
  return Number((await pool.query("select pg_backend_pid()::int pid")).rows[0].pid);
}

async function expectNoRuntimeAdvisoryLocks(
  harness: Harness,
  pids: readonly number[]
): Promise<void> {
  const count = Number((await harness.admin.query(
    `select count(*)::int count
       from pg_locks
      where locktype = 'advisory'
        and pid = any($1::int[])`,
    [pids]
  )).rows[0].count);
  expect(count).toBe(0);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function settleBeforeTestDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForRuntimeLockWait(input: {
  harness: Harness;
  pid: number;
  queryFragment: string;
  lockKind: "advisory" | "run_row" | "relation";
  afterQueryStartedAt?: string;
}): Promise<{
  observedAt: number;
  queryStartedAt: string;
  transactionStartedAt: string;
}> {
  const deadline = performance.now() + LOCK_STATE_BARRIER_DEADLINE_MS;
  while (performance.now() < deadline) {
    const row = (await input.harness.admin.query(
      `select activity.state,
              activity.wait_event_type,
              activity.query,
              activity.query_start::text as query_started_at,
              activity.xact_start::text as transaction_started_at,
              coalesce(bool_or(
                not held.granted and (
                  ($2 = 'advisory' and held.locktype = 'advisory') or
                  ($2 = 'run_row' and held.locktype in ('transactionid','tuple')) or
                  ($2 = 'relation' and held.locktype = 'relation')
                )
              ),false) as waiting_on_expected_lock
         from pg_stat_activity activity
         left join pg_locks held on held.pid = activity.pid
        where activity.pid = $1
        group by activity.pid, activity.state,
                 activity.wait_event_type, activity.query,
                 activity.query_start, activity.xact_start`,
      [input.pid, input.lockKind]
    )).rows[0];
    if (
      row?.state === "active" &&
      row.wait_event_type === "Lock" &&
      row.waiting_on_expected_lock === true &&
      typeof row.query_started_at === "string" &&
      typeof row.transaction_started_at === "string" &&
      row.query_started_at !== input.afterQueryStartedAt &&
      String(row.query).toLowerCase().includes(input.queryFragment.toLowerCase())
    ) {
      return {
        observedAt: performance.now(),
        queryStartedAt: row.query_started_at,
        transactionStartedAt: row.transaction_started_at
      };
    }
    await delay(10);
  }
  throw new Error(`service_role_shadow_runtime_${input.lockKind}_wait_not_observed`);
}

async function insertMalformedWrapper(
  harness: Harness,
  runId: string,
  suffix: string
): Promise<string> {
  const artifact = {
    schemaVersion: "service-role-shadow-event-role-map-v2",
    malformed: suffix
  };
  const sha256 = fingerprintCanonicalArtifact(artifact);
  await harness.admin.query(
    `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
     values ($1,$2,'service_role_event_role_map','2',$3::jsonb)`,
    [sha256, runId, JSON.stringify(artifact)]
  );
  return sha256;
}

async function insertCorruptWrapperKey(
  harness: Harness,
  runId: string
): Promise<string> {
  const sha256 = `corrupt-wrapper-key:${runId}`;
  await harness.admin.query(
    `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
     values ($1,$2,'service_role_event_role_map','2',$3::jsonb)`,
    [sha256, runId, JSON.stringify({ malformed: "non-hash-key" })]
  );
  return sha256;
}

function acceptedHistoryFixture(input: {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly manifestSha256?: string;
}) {
  const address = "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH";
  const anchorMs = Date.parse("2026-07-01T00:00:00.000Z");
  const makeEvent = (
    index: number,
    timestampMs: number
  ): IndexedTronUsdtTransfer => ({
    txHash: (index + 1).toString(16).padStart(64, "0"),
    blockNumber: 10_000 - index,
    blockTimestamp: new Date(timestampMs),
    eventIndex: 0,
    fromAddress: address,
    toAddress: SUBJECT,
    amountRaw: String(1_000_000 + index),
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  });
  const recent = Array.from({ length: 100 }, (_, index) =>
    makeEvent(index, anchorMs - index * 60_000));
  const historical = Array.from({ length: 100 }, (_, index) =>
    makeEvent(index + 100, anchorMs - 8 * 24 * 60 * 60_000 - index * 60_000));
  const events = [...recent, ...historical];
  const anchorId = canonicalTronUsdtEventKey(recent[0]!);
  const states: TraversalStateV1[] = Array.from({ length: 7 }, (_, index) => ({
    address,
    direction: "backward",
    anchorTimestamp: "2026-07-01T00:00:00.000Z",
    fundingEpisodeId: `episode-${index}`,
    allocatedAmountRaw: String(index + 1),
    sourceEventIds: [anchorId]
  }));
  const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
    state: states[0]!,
    acceptedHistoryEvents: events
  });
  const ids = [
    ...binding.sampledCanonicalEventIds.recent,
    ...binding.sampledCanonicalEventIds.historical
  ];
  const manifestSha256 = input.manifestSha256 ?? "d".repeat(64);
  const bundle: ServiceRoleEventEvidenceBundleV1 = {
    schemaVersion: "service-role-event-evidence-bundle-v1",
    policyVersion: "existing-hash-bound-economic-role-v1",
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    addressHistoryManifestSha256: manifestSha256,
    entries: ids.map((canonicalEventId, index) => ({
      canonicalEventId,
      transactionInfoEvidenceId: `accepted-evidence-${index}`,
      transactionInfoPayloadSha256: fingerprintCanonicalArtifact(["payload", index]),
      transactionInfoFinalityWitnessSha256: fingerprintCanonicalArtifact(["finality", index]),
      poisoningDispositionSha256: fingerprintCanonicalArtifact(["poisoning", index]),
      providerRiskDispositionSha256: fingerprintCanonicalArtifact(["risk", index]),
      role: "ordinary"
    }))
  };
  const bundleSha256 = fingerprintCanonicalArtifact(bundle);
  const sourceMap: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    addressHistoryManifestSha256: manifestSha256,
    entries: ids.map((canonicalEventId) => ({
      canonicalEventId,
      role: "ordinary",
      authority: "existing_hash_bound_economic_role_v1",
      evidenceSha256: bundleSha256
    }))
  };
  const sourceMapSha256 = fingerprintCanonicalArtifact(sourceMap);
  const wrapper: ServiceRoleShadowEventRoleMapV2 = {
    schemaVersion: "service-role-shadow-event-role-map-v2",
    policyVersion: "service-role-shadow-100-plus-100-v1",
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    addressHistoryManifestSha256: manifestSha256,
    sourceEventRoleMapV1Sha256: sourceMapSha256,
    evidenceBundleSha256: bundleSha256,
    binding,
    exactCoverage: { recent: 100, historical: 100, total: 200 },
    productionEffect: false
  };
  return {
    events,
    states,
    manifestSha256,
    artifacts: [{
      sha256: bundleSha256,
      kind: "service_role_event_evidence_bundle",
      schemaVersion: "1",
      artifact: bundle
    }, {
      sha256: sourceMapSha256,
      kind: "service_role_event_role_map",
      schemaVersion: "1",
      artifact: sourceMap
    }, {
      sha256: fingerprintCanonicalArtifact(wrapper),
      kind: "service_role_event_role_map",
      schemaVersion: "2",
      artifact: wrapper
    }]
  };
}

async function insertArtifact(input: {
  readonly harness: Harness;
  readonly runId: string;
  readonly sha256: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly artifact: unknown;
}): Promise<void> {
  await input.harness.admin.query(
    `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
     values ($1,$2,$3,$4,$5::jsonb)`,
    [
      input.sha256,
      input.runId,
      input.kind,
      input.schemaVersion,
      JSON.stringify(input.artifact)
    ]
  );
}

async function preparedCheckpointReconciliation(harness: Harness) {
  const seeded = await seedRun(harness);
  const accepted = acceptedHistoryFixture(seeded);
  for (const artifact of accepted.artifacts) {
    await insertArtifact({ harness, runId: seeded.runId, ...artifact });
  }
  const shadow = runtime(harness.poolA);
  const candidate = {
    version: "unified-traversal-delta-v1",
    runId: seeded.runId,
    previousDeltaHash: null
  };
  const candidateSha256 = fingerprintCanonicalArtifact(candidate);
  const committed = {
    version: "unified-traversal-delta-v1",
    runId: seeded.runId,
    previousDeltaHash: candidateSha256
  };
  const committedSha256 = fingerprintCanonicalArtifact(committed);
  await shadow.observeAcceptedAddressHistoryGroup({
    taskId: "task-traversal",
    attempt: 2,
    runId: seeded.runId,
    snapshotHash: seeded.snapshotHash,
    subjectAddress: SUBJECT,
    manifestKey: "accepted-history-key",
    manifestSha256: accepted.manifestSha256,
    acceptedPageArtifactHashes: ["e".repeat(64)],
    events: accepted.events,
    states: accepted.states,
    candidateCheckpoint: { deltaHeadSha256: candidateSha256 } as never,
    candidateDeltaSha256: candidateSha256,
    signal: new AbortController().signal
  });
  await insertArtifact({
    harness,
    runId: seeded.runId,
    sha256: candidateSha256,
    kind: "traversal_delta",
    schemaVersion: "1",
    artifact: candidate
  });
  await insertArtifact({
    harness,
    runId: seeded.runId,
    sha256: committedSha256,
    kind: "traversal_delta",
    schemaVersion: "1",
    artifact: committed
  });
  const checkpoint = {
    version: "unified-production-traversal-checkpoint-v2",
    deltaHeadSha256: committedSha256
  };
  return {
    shadow,
    seeded,
    lifecycle: {
      task: {
        id: "task-traversal",
        runId: seeded.runId,
        kind: "traversal",
        attempt: 2,
        checkpoint: {},
        cancellationRequestedAt: null
      },
      result: { kind: "checkpoint" as const, checkpoint },
      checkpointCommit: {
        checkpointed: true,
        providerWorkAvailable: false,
        committedTaskStatus: "QUEUED" as const,
        committedCheckpoint: checkpoint,
        orderedCommit: {
          applied: true,
          runId: seeded.runId,
          committedEntries: [{
            canonicalSequence: 1,
            taskId: "history-matched",
            acceptedAttemptId: "attempt-matched",
            artifactSha256: accepted.manifestSha256
          }]
        }
      },
      signal: new AbortController().signal
    }
  };
}

async function seedTerminalShadowInventory(input: {
  readonly harness: Harness;
  readonly reconcileBeforeCompletion: boolean;
  readonly unavailableReason?: "preload_timeout" | "malformed" | "conflict";
  readonly observeGroup?: boolean;
  readonly extraVisitedStates?: readonly TraversalStateV1[];
}) {
  const seeded = await seedRun(input.harness);
  const traversalTaskId = `task-traversal-${seeded.runId}`;
  const historyTaskId = `task-history-${seeded.runId}`;
  const preliminary = acceptedHistoryFixture(seeded);
  const address = preliminary.states[0]!.address;
  const manifestKey = addressHistoryManifestKey({
    chain: "tron",
    snapshotHash: seeded.snapshotHash,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    address,
    providerRequestVersion: "tronscan-related-trc20-v1"
  });
  const page = {
    version: "unified-address-history-page-v1" as const,
    schemaVersion: 1 as const,
    runId: seeded.runId,
    manifestKey,
    providerPageHash: fingerprintCanonicalArtifact(["provider-page", seeded.runId]),
    rawRowCount: preliminary.events.length,
    events: preliminary.events.map((event) => ({
      ...event,
      blockTimestamp: event.blockTimestamp.toISOString()
    }))
  };
  const pageSha256 = fingerprintCanonicalArtifact(page);
  const eventIds = preliminary.events.map((event) =>
    canonicalTronUsdtEventKey(event)
  );
  const manifest = buildAddressHistoryManifest({
    chain: "tron",
    snapshotHash: seeded.snapshotHash,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    address,
    providerRequestVersion: "tronscan-related-trc20-v1",
    pageArtifactHashes: [pageSha256],
    canonicalEventIds: eventIds,
    rawRowCount: preliminary.events.length,
    duplicateCount: 0,
    exhaustion: {
      kind: "provider_exhausted",
      evidenceSha256: fingerprintCanonicalArtifact(["exhaustion", seeded.runId])
    }
  });
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  const accepted = acceptedHistoryFixture({ ...seeded, manifestSha256 });
  for (const artifact of [
    { sha256: pageSha256, kind: "address_history_page", schemaVersion: "1", artifact: page },
    { sha256: manifestSha256, kind: "address_history_manifest", schemaVersion: "1", artifact: manifest },
    ...accepted.artifacts
  ]) {
    await insertArtifact({
      harness: input.harness,
      runId: seeded.runId,
      ...artifact
    });
  }

  if (input.unavailableReason !== undefined) {
    const unavailable = buildServiceRoleShadowInputFenceV1({
      runId: seeded.runId,
      snapshotHash: seeded.snapshotHash,
      runtimeCommit: RUNTIME_COMMIT,
      outcome: {
        kind: "unavailable",
        reason: input.unavailableReason,
        observedRoleMapV2Sha256s:
          input.unavailableReason === "preload_timeout" ? null : []
      }
    });
    await insertArtifact({
      harness: input.harness,
      runId: seeded.runId,
      sha256: unavailable.sha256,
      kind: "service_role_shadow_input_fence",
      schemaVersion: "1",
      artifact: unavailable.artifact
    });
  }

  const shadow = runtime(input.harness.poolA);
  if (input.observeGroup === false) {
    await shadow.loadInputFence(seeded);
  }
  const candidate = {
    version: "unified-traversal-delta-v1",
    runId: seeded.runId,
    previousDeltaHash: null
  };
  const candidateSha256 = fingerprintCanonicalArtifact(candidate);
  const committed = {
    version: "unified-traversal-delta-v1",
    runId: seeded.runId,
    previousDeltaHash: candidateSha256
  };
  const committedSha256 = fingerprintCanonicalArtifact(committed);
  const checkpoint = {
    version: "unified-production-traversal-checkpoint-v2",
    deltaHeadSha256: committedSha256
  };
  if (input.observeGroup !== false) {
    await shadow.observeAcceptedAddressHistoryGroup({
      taskId: traversalTaskId,
      attempt: 2,
      runId: seeded.runId,
      snapshotHash: seeded.snapshotHash,
      subjectAddress: SUBJECT,
      manifestKey,
      manifestSha256,
      acceptedPageArtifactHashes: [pageSha256],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: candidateSha256 } as never,
      candidateDeltaSha256: candidateSha256,
      signal: new AbortController().signal
    });
  }
  for (const artifact of [
    { sha256: candidateSha256, artifact: candidate },
    { sha256: committedSha256, artifact: committed }
  ]) {
    await insertArtifact({
      harness: input.harness,
      runId: seeded.runId,
      kind: "traversal_delta",
      schemaVersion: "1",
      ...artifact
    });
  }

  await input.harness.admin.query(
    `insert into unified_check_tasks
       (id,run_id,kind,status,priority_lane,attempt,logical_key,checkpoint_json)
     values
       ($2,$1,'traversal','QUEUED','interactive',2,'main',$4::jsonb),
       ($3,$1,'address_history','COMPLETED','interactive',1,$5,'{}'::jsonb)`,
    [seeded.runId, traversalTaskId, historyTaskId, JSON.stringify(checkpoint), manifestKey]
  );
  const historyAttemptId = `history-attempt-${seeded.runId}`;
  await input.harness.admin.query(
    `insert into unified_check_attempts
       (id,task_id,attempt,artifact_sha256,completed_at)
     values ($1,$3,1,$2,now())`,
    [historyAttemptId, manifestSha256, historyTaskId]
  );
  await input.harness.admin.query(
    "update unified_check_tasks set accepted_attempt_id=$1 where id=$2",
    [historyAttemptId, historyTaskId]
  );
  await input.harness.admin.query(
    `insert into unified_check_planner_entries
       (run_id,canonical_sequence,task_id,planner_state,result_bytes,
        admitted_at,reserved_bytes,planned_at,ready_at,committed_at)
     values ($1,1,$2,'committed',1,
             now(),null,now(),now(),now())`,
    [seeded.runId, historyTaskId]
  );
  const lifecycle = {
    task: {
      id: traversalTaskId,
      runId: seeded.runId,
      kind: "traversal",
      attempt: 2,
      checkpoint: {},
      cancellationRequestedAt: null
    },
    result: { kind: "checkpoint" as const, checkpoint },
    checkpointCommit: {
      checkpointed: true,
      providerWorkAvailable: false,
      committedTaskStatus: "QUEUED" as const,
      committedCheckpoint: checkpoint,
      orderedCommit: {
        applied: true,
        runId: seeded.runId,
        committedEntries: [{
          canonicalSequence: 1,
          taskId: historyTaskId,
          acceptedAttemptId: historyAttemptId,
          artifactSha256: manifestSha256
        }]
      }
    },
    signal: new AbortController().signal
  };
  if (input.reconcileBeforeCompletion) {
    await shadow.reconcileCheckpoint(lifecycle);
  }

  const manifestSha = String((await input.harness.admin.query(
    "select analysis_manifest_sha256 from unified_check_runs where id=$1",
    [seeded.runId]
  )).rows[0].analysis_manifest_sha256);
  const traversal = {
    version: "unified-traversal-artifact-v1",
    schemaVersion: 1,
    runId: seeded.runId,
    analysisManifestHash: manifestSha,
    snapshotHash: seeded.snapshotHash,
    visitedStates: [...accepted.states, ...(input.extraVisitedStates ?? [])],
    frontier: [],
    terminalStates: [],
    supersededStateIds: [],
    eligibleEventIds: [],
    eligibleEventCount: 0,
    directionCount: 1,
    fundingEpisodeCount: 7,
    expandedStateCount: 7,
    allocatedInputRaw: "28",
    terminalRaw: "0",
    residualRaw: "28",
    backwardCoverage: {
      selectedAmountRaw: "28",
      tracedAmountRaw: "0",
      identifiedAmountRaw: "0",
      unknownBoundaryRaw: "0",
      residualAmountRaw: "28",
      knownCoverageBps: 0
    },
    forwardCoverage: {
      selectedAmountRaw: "0",
      tracedAmountRaw: "0",
      identifiedAmountRaw: "0",
      unknownBoundaryRaw: "0",
      residualAmountRaw: "0",
      knownCoverageBps: 0
    },
    closed: true
  };
  const traversalSha256 = fingerprintCanonicalArtifact(traversal);
  await insertArtifact({
    harness: input.harness,
    runId: seeded.runId,
    sha256: traversalSha256,
    kind: "traversal_result",
    schemaVersion: "1",
    artifact: traversal
  });
  const traversalAttemptId = `traversal-attempt-${seeded.runId}`;
  await input.harness.admin.query(
    `insert into unified_check_attempts
       (id,task_id,attempt,artifact_sha256,completed_at)
     values ($1,$3,2,$2,now())`,
    [traversalAttemptId, traversalSha256, traversalTaskId]
  );
  await input.harness.admin.query(
    `update unified_check_tasks
        set status='COMPLETED',accepted_attempt_id=$1
      where id=$2`,
    [traversalAttemptId, traversalTaskId]
  );
  return {
    seeded,
    shadow,
    lifecycle,
    traversalAttemptId,
    traversalSha256,
    manifestSha256,
    pageSha256
  };
}

async function insertDuplicateAcceptedHistory(
  harness: Harness,
  prepared: Awaited<ReturnType<typeof seedTerminalShadowInventory>>
): Promise<void> {
  const original = (await harness.admin.query(
    `select manifest.artifact_json as manifest_json,
            page.artifact_json as page_json
       from unified_check_artifacts manifest
       join unified_check_artifacts page
         on page.sha256 = manifest.artifact_json->'pageArtifactHashes'->>0
      where manifest.sha256=$1`,
    [prepared.manifestSha256]
  )).rows[0];
  const sourceManifest = original.manifest_json;
  const sourcePage = original.page_json;
  const manifestKey = addressHistoryManifestKey({
    chain: "tron",
    snapshotHash: prepared.seeded.snapshotHash,
    tokenContract: sourceManifest.tokenContract,
    address: sourceManifest.address,
    providerRequestVersion: "tronscan-related-trc20-duplicate-test-v1"
  });
  const page = {
    ...sourcePage,
    manifestKey,
    providerPageHash: fingerprintCanonicalArtifact([
      "duplicate-provider-page",
      prepared.seeded.runId
    ])
  };
  const pageSha256 = fingerprintCanonicalArtifact(page);
  const events = page.events.map((event: { blockTimestamp: string }) => ({
    ...event,
    blockTimestamp: new Date(event.blockTimestamp)
  })) as IndexedTronUsdtTransfer[];
  const manifest = buildAddressHistoryManifest({
    chain: "tron",
    snapshotHash: prepared.seeded.snapshotHash,
    tokenContract: sourceManifest.tokenContract,
    address: sourceManifest.address,
    providerRequestVersion: "tronscan-related-trc20-duplicate-test-v1",
    pageArtifactHashes: [pageSha256],
    canonicalEventIds: events.map((event) => canonicalTronUsdtEventKey(event)),
    rawRowCount: sourceManifest.rawRowCount,
    duplicateCount: sourceManifest.duplicateCount,
    exhaustion: sourceManifest.exhaustion
  });
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  for (const artifact of [
    { sha256: pageSha256, kind: "address_history_page", artifact: page },
    { sha256: manifestSha256, kind: "address_history_manifest", artifact: manifest }
  ]) {
    await insertArtifact({
      harness,
      runId: prepared.seeded.runId,
      schemaVersion: "1",
      ...artifact
    });
  }
  const taskId = `task-history-duplicate-${prepared.seeded.runId}`;
  const attemptId = `history-attempt-duplicate-${prepared.seeded.runId}`;
  await harness.admin.query(
    `insert into unified_check_tasks
       (id,run_id,kind,status,priority_lane,attempt,logical_key,checkpoint_json)
     values ($1,$2,'address_history','COMPLETED','interactive',1,$3,'{}'::jsonb)`,
    [taskId, prepared.seeded.runId, manifestKey]
  );
  await harness.admin.query(
    `insert into unified_check_attempts
       (id,task_id,attempt,artifact_sha256,completed_at)
     values ($1,$2,1,$3,now())`,
    [attemptId, taskId, manifestSha256]
  );
  await harness.admin.query(
    "update unified_check_tasks set accepted_attempt_id=$1 where id=$2",
    [attemptId, taskId]
  );
  await harness.admin.query(
    `insert into unified_check_planner_entries
       (run_id,canonical_sequence,task_id,planner_state,result_bytes,
        admitted_at,reserved_bytes,planned_at,ready_at,committed_at)
     values ($1,2,$2,'committed',1,now(),null,now(),now(),now())`,
    [prepared.seeded.runId, taskId]
  );
}

type NoninterferenceVariant = "normal" | "preload_lock" | "post_commit_hang";

type NoninterferenceTapeResult = {
  readonly projectionBytes: string;
  readonly providerCalls: readonly {
    readonly address: string;
    readonly cursor: string | null;
  }[];
  readonly cacheDecisions: readonly {
    readonly address: string;
    readonly cursor: string | null;
    readonly source: "network" | "cache" | "inflight";
  }[];
  readonly shadowCounts: Readonly<Record<string, number>>;
  readonly shadowHashes: readonly string[];
  readonly shadowArtifacts: readonly {
    readonly kind: string;
    readonly artifact: unknown;
  }[];
  readonly acceptedCheckpointElapsedMs: number;
  readonly blockerHeldAtSettlement: boolean;
};

function deterministicIds() {
  let sequence = 0;
  return () => `stage-c1-runtime-id-${String(++sequence).padStart(4, "0")}`;
}

function acceptedHistoryRawRows(
  events: readonly IndexedTronUsdtTransfer[]
) {
  return events.map((event) => ({
    transaction_id: event.txHash,
    from_address: event.fromAddress,
    to_address: event.toAddress,
    quant: event.amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: event.blockTimestamp.getTime(),
    block: event.blockNumber,
    event_index: event.eventIndex
  }));
}

function traversalCheckpointFor(
  states: readonly TraversalStateV1[]
) {
  return {
    version: "unified-production-traversal-checkpoint-v1",
    frontier: states,
    visitedStates: [],
    expandedStateIds: [],
    terminals: [],
    supersededStateIds: [],
    active: null,
    eligibleEventIds: [],
    expandedStateKeys: [],
    selectedBackwardRaw: states.reduce(
      (sum, state) => sum + BigInt(state.allocatedAmountRaw),
      0n
    ).toString(),
    selectedForwardRaw: "0"
  };
}

function postCommitHangingHost(pool: pg.Pool): {
  readonly db: UnifiedTransactionalQueryable;
  arm(): void;
  isHeld(): boolean;
  release(): void;
} {
  const base = createUnifiedPoolTransactionHost(pool);
  let armed = false;
  let triggered = false;
  let blocker: pg.PoolClient | null = null;
  return {
    db: {
      query: base.query,
      async transaction<T>(
        work: Parameters<UnifiedTransactionalQueryable["transaction"]>[0]
      ): Promise<T> {
        const result = await base.transaction(work) as T;
        const orderedCommit = result !== null && typeof result === "object"
          ? (result as { orderedCommit?: { applied?: unknown } }).orderedCommit
          : undefined;
        if (armed && !triggered && orderedCommit?.applied === true) {
          triggered = true;
          blocker = await pool.connect();
        }
        return result;
      }
    } as UnifiedTransactionalQueryable,
    arm() {
      armed = true;
    },
    isHeld: () => blocker !== null,
    release() {
      blocker?.release();
      blocker = null;
    }
  };
}

async function projectionRows(
  harness: Harness,
  sql: string,
  values: readonly unknown[] = []
): Promise<readonly unknown[]> {
  return (await harness.admin.query(sql, values as unknown[])).rows.map(
    (row) => row.value
  );
}

async function authoritativeProjection(input: {
  readonly harness: Harness;
  readonly runId: string;
  readonly providerCalls: NoninterferenceTapeResult["providerCalls"];
  readonly cacheDecisions: NoninterferenceTapeResult["cacheDecisions"];
}): Promise<string> {
  const requests = await projectionRows(
    input.harness,
    `select to_jsonb(request) value
       from unified_check_requests request
      where request.run_id=$1
      order by request.id`,
    [input.runId]
  );
  const runs = await projectionRows(
    input.harness,
    `select to_jsonb(run) value
       from unified_check_runs run
      where run.id=$1
      order by run.id`,
    [input.runId]
  );
  const tasks = await projectionRows(
    input.harness,
    `select to_jsonb(task) value
       from unified_check_tasks task
      where task.run_id=$1
      order by task.kind,task.logical_key,task.id`,
    [input.runId]
  );
  const planner = await projectionRows(
    input.harness,
    `select to_jsonb(entry) value
       from unified_check_planner_entries entry
      where entry.run_id=$1
      order by entry.canonical_sequence`,
    [input.runId]
  );
  const attempts = await projectionRows(
    input.harness,
    `select to_jsonb(attempt_row) value
       from unified_check_attempts attempt_row
       join unified_check_tasks task on task.id=attempt_row.task_id
      where task.run_id=$1
      order by attempt_row.task_id,attempt_row.attempt,attempt_row.id`,
    [input.runId]
  );
  const artifacts = await projectionRows(
    input.harness,
    `select to_jsonb(artifact) value
       from unified_check_artifacts artifact
      where artifact.created_by_run_id=$1
        and artifact.kind <> all($2::text[])
      order by artifact.kind,artifact.schema_version,artifact.sha256`,
    [input.runId, SHADOW_ARTIFACT_KINDS]
  );
  const deliveries = await projectionRows(
    input.harness,
    `select to_jsonb(delivery) value
       from unified_check_deliveries delivery
       join unified_check_requests request on request.id=delivery.request_id
      where request.run_id=$1
      order by delivery.id`,
    [input.runId]
  );
  const providerPages = await projectionRows(
    input.harness,
    `select to_jsonb(page) value
       from unified_provider_pages page
      order by page.request_identity_sha256`
  );
  const labelDatasets = await projectionRows(
    input.harness,
    `select to_jsonb(dataset) value
       from unified_label_datasets dataset
      order by dataset.sha256`
  );
  const generationFence = await projectionRows(
    input.harness,
    `select to_jsonb(fence) value
       from unified_check_generation_fence fence
      order by fence.generation_id`
  );
  const deliveryOwnership = await projectionRows(
    input.harness,
    `select to_jsonb(ownership) value
       from unified_wallet_delivery_ownership ownership
      order by ownership.subject_address,ownership.chat_id`
  );
  const runtimeInstances = await projectionRows(
    input.harness,
    `select to_jsonb(runtime) value
       from unified_runtime_instances runtime
      order by runtime.instance_id`
  );
  const notifications = await projectionRows(
    input.harness,
    `select to_jsonb(notification) value
       from unified_check_notifications notification
       join unified_check_requests request on request.id=notification.request_id
      where request.run_id=$1
      order by notification.id`,
    [input.runId]
  );
  const [watchdogRun] = await listUnifiedWatchdogRuns(
    input.harness.admin,
    { runIds: [input.runId] }
  );
  if (!watchdogRun) throw new Error("service_role_shadow_watchdog_run_missing");
  const [adminRun] = inspectUnifiedRuns([watchdogRun], {
    now: new Date(FROZEN_CLOCK_ISO),
    staleHeartbeatMs: 120_000
  });
  if (!adminRun) throw new Error("service_role_shadow_admin_run_missing");
  const projection = JSON.parse(JSON.stringify({
    provider: {
      callCount: input.providerCalls.length,
      calls: input.providerCalls,
      cacheDecisions: input.cacheDecisions
    },
    requests,
    runs,
    tasks,
    checkpoints: tasks.map((task) => ({
      id: (task as { id: string }).id,
      checkpointJson: (task as { checkpoint_json: unknown }).checkpoint_json
    })),
    planner,
    attempts,
    artifacts,
    reports: artifacts.filter((artifact) =>
      (artifact as { kind: string }).kind === "unified_wallet_report"
    ),
    presentations: artifacts.filter((artifact) =>
      [
        "presentation_manifest",
        "presentation_artifact",
        "presentation_completeness_receipt",
        "presentation_envelope",
        "delivery_intent"
      ].includes((artifact as { kind: string }).kind)
    ),
    deliveries,
    providerPages,
    labelDatasets,
    generationFence,
    deliveryOwnership,
    runtimeInstances,
    notifications,
    adminDag: projectUnifiedRunDag(adminRun)
  }));
  return canonicalizeArtifactJson(projection);
}

async function runAuthoritativeNoninterferenceTape(input: {
  readonly policy: "disabled" | "service-role-shadow-100-plus-100-v1";
  readonly variant: NoninterferenceVariant;
}): Promise<NoninterferenceTapeResult> {
  const performanceNow = vi.spyOn(performance, "now").mockReturnValue(1_000);
  const harness = await createHarness();
  const runId = "stage-c1-noninterference-run";
  const requestId = "stage-c1-noninterference-request";
  let frozenLabels: ReturnType<typeof buildFrozenLabelDataset> | null = null;
  const providerCalls: Array<{
    address: string;
    cursor: string | null;
  }> = [];
  const cacheDecisions: Array<{
    address: string;
    cursor: string | null;
    source: "network" | "cache" | "inflight";
  }> = [];
  const hangingHost = postCommitHangingHost(harness.poolA);
  const db = hangingHost.db;
  let preloadHolder: pg.Client | null = null;
  let preloadHolderPid: number | null = null;
  let preloadHeld = false;
  let inFlightAcceptedCycle: Promise<unknown> | null = null;
  try {
    const intake = await intakeUnifiedCheck({
      store: createPostgresUnifiedRequestStore(db),
      snapshotSource: {
        latestConfirmedBlock: async () => ({
          number: "20000",
          hash: "a".repeat(64),
          timestamp: FROZEN_CLOCK_ISO
        }),
        snapshotBalances: async () => ({
          usdtRaw: null,
          trxSun: null,
          source: "fixture",
          consistency: "unavailable"
        })
      },
      request: {
        id: requestId,
        requestCorrelationId: "stage-c1-noninterference-correlation",
        subjectAddress: SUBJECT,
        chatId: "stage-c1-chat",
        messageThreadId: "",
        locale: "ru",
        runPurpose: "user_check",
        sideEffectPolicy: "authoritative"
      },
      candidateRunId: runId,
      freezeLabelDataset: async ({ snapshotHash, frozenAt }) => {
        frozenLabels = buildFrozenLabelDataset({
          frozenAt,
          snapshotHash,
          labels: [],
          legacyRows: []
        });
        return frozenLabels;
      },
      initialTasks: [
        ["task-01-direct", "direct_history"],
        ["task-02-traversal", "traversal"],
        ["task-90-fast", "fast"],
        ["task-91-where", "where"],
        ["task-92-deep", "deep"],
        ["task-93-deep-direct", "deep_direct"]
      ].map(([id, kind]) => ({
        id: id!,
        kind: kind!,
        priorityLane: "interactive" as const,
        logicalKey: "main"
      })),
      versions: {
        labelDatasetSha256: "f".repeat(64),
        scoringPolicyVersion: "scoring-signal-matrix-v4",
        attributionPolicyVersion: "selected-attribution-policy-v1",
        traversalPolicyVersion: "snapshot-closure-v1",
        runtimeCommit: RUNTIME_COMMIT,
        schemaVersion: 37
      },
      now: () => new Date(FROZEN_CLOCK_ISO)
    });
    expect(intake).toMatchObject({
      kind: "attached",
      reused: false,
      run: { id: runId }
    });
    const manifestRow = (await harness.admin.query(
      `select artifact.artifact_json
         from unified_check_runs run
         join unified_check_artifacts artifact
           on artifact.sha256=run.analysis_manifest_sha256
        where run.id=$1`,
      [runId]
    )).rows[0];
    const snapshotHash = String(manifestRow.artifact_json.snapshotHash);
    const accepted = acceptedHistoryFixture({ runId, snapshotHash });
    await harness.admin.query(
      `update unified_check_tasks
          set checkpoint_json=$2::jsonb
        where id='task-02-traversal' and run_id=$1`,
      [runId, JSON.stringify(traversalCheckpointFor(accepted.states))]
    );

    const ids = deterministicIds();
    const runtime = createUnifiedProductionRuntime({
      db,
      ...(input.policy === "disabled" ? {} : {
        serviceRoleShadowRecoveryDb:
          createUnifiedPoolTransactionHost(harness.poolB)
      }),
      runtimeCommit: RUNTIME_COMMIT,
      providerConfigurationSha256: "e".repeat(64),
      serviceRoleShadowPolicy: input.policy,
      addressHistoryPagesPerChunk: 4,
      now: () => new Date(FROZEN_CLOCK_ISO),
      createId: ids,
      async loadProviderPage({ address, cursor, onDiagnostic }) {
        providerCalls.push({ address: address ?? SUBJECT, cursor });
        const diagnostic = { source: "network" as const };
        onDiagnostic?.(diagnostic);
        cacheDecisions.push({
          address: address ?? SUBJECT,
          cursor,
          source: diagnostic.source
        });
        if (address === accepted.states[0]!.address) {
          const content = {
            kind: "page" as const,
            cursor,
            nextCursor: null,
            transfers: acceptedHistoryRawRows(accepted.events),
            reachedAccountCreation: true,
            provider: "tronscan" as const
          };
          return { ...content, pageHash: fingerprintCanonicalArtifact(content) };
        }
        const content = {
          kind: "page" as const,
          cursor,
          nextCursor: null,
          transfers: [],
          reachedAccountCreation: true,
          provider: "tronscan" as const
        };
        return { ...content, pageHash: fingerprintCanonicalArtifact(content) };
      },
      loadFrozenLabelDataset: async () => {
        if (frozenLabels === null) {
          throw new Error("service_role_shadow_frozen_labels_missing");
        }
        return frozenLabels.dataset;
      },
      loadCounterpartyLabels: async () => new Map(),
      loadHardEvidence: async () => ({})
    });
    if (runtime.reconcileCommittedServiceRoleShadowRunsV1) {
      await runtime.reconcileCommittedServiceRoleShadowRunsV1(
        new AbortController().signal
      );
    }

    await expect(runtime.runProviderCycle()).resolves.toMatchObject({
      outcome: "completed",
      taskId: "task-01-direct"
    });
    await expect(runtime.runAnalysisCycle()).resolves.toMatchObject({
      outcome: "checkpointed",
      taskId: "task-02-traversal"
    });
    let historyTask = (await harness.admin.query(
      `select task.id,task.logical_key
         from unified_check_tasks task
        where task.run_id=$1 and task.kind='address_history'`,
      [runId]
    )).rows[0];
    expect(historyTask).toBeTruthy();
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await runtime.runProviderCycle();
      historyTask = (await harness.admin.query(
        `select task.id,task.logical_key,task.status,attempt.artifact_sha256
           from unified_check_tasks task
           left join unified_check_attempts attempt
             on attempt.id=task.accepted_attempt_id
          where task.run_id=$1 and task.kind='address_history'`,
        [runId]
      )).rows[0];
      if (historyTask?.status === "COMPLETED") break;
    }
    expect(historyTask).toMatchObject({ status: "COMPLETED" });
    const acceptedManifestSha256 = String(historyTask.artifact_sha256);
    const exactInputs = acceptedHistoryFixture({
      runId,
      snapshotHash,
      manifestSha256: acceptedManifestSha256
    });
    for (const artifact of exactInputs.artifacts) {
      await insertArtifact({ harness, runId, ...artifact });
    }

    await expect(runtime.runAnalysisCycle()).resolves.toMatchObject({
      outcome: "completed",
      taskId: "task-90-fast"
    });

    if (input.variant === "preload_lock" && input.policy !== "disabled") {
      preloadHolder = new pg.Client({
        connectionString,
        options: `-c search_path=${harness.schema},pg_catalog`
      });
      await preloadHolder.connect();
      preloadHolderPid = Number((await preloadHolder.query(
        "select pg_backend_pid()::int pid"
      )).rows[0].pid);
      await preloadHolder.query(
        "select pg_advisory_lock(hashtextextended($1::text,0))",
        [`service-role-shadow-input-fence-v1:${runId}`]
      );
      preloadHeld = true;
    }
    if (input.variant === "post_commit_hang" && input.policy !== "disabled") {
      hangingHost.arm();
    }
    let acceptedCheckpointElapsedMs: number;
    let blockerHeldAtSettlement = false;
    try {
      const checkpointStartedAt = Date.now();
      const acceptedCycle = runtime.runAnalysisCycle();
      inFlightAcceptedCycle = acceptedCycle;
      const result = await settleBeforeTestDeadline(
        acceptedCycle,
        2_200,
        `service_role_shadow_${input.variant}_deadline_missing`
      );
      acceptedCheckpointElapsedMs = Date.now() - checkpointStartedAt;
      expect(result).toMatchObject({
        taskId: "task-02-traversal",
        outcome: "checkpointed"
      });
      if (input.variant === "preload_lock" && input.policy !== "disabled") {
        blockerHeldAtSettlement = preloadHeld && preloadHolderPid !== null &&
          (await harness.admin.query(
            `select exists(
               select 1 from pg_locks
                where pid=$1 and locktype='advisory' and granted
             ) held`,
            [preloadHolderPid]
          )).rows[0].held === true;
      } else if (
        input.variant === "post_commit_hang" && input.policy !== "disabled"
      ) {
        blockerHeldAtSettlement = hangingHost.isHeld() &&
          harness.poolA.idleCount === 0 && harness.poolA.waitingCount >= 1;
      }
      if (input.variant !== "normal" && input.policy !== "disabled") {
        expect(blockerHeldAtSettlement).toBe(true);
      }
    } finally {
      if (preloadHeld && preloadHolder) {
        await preloadHolder.query(
          "select pg_advisory_unlock(hashtextextended($1::text,0))",
          [`service-role-shadow-input-fence-v1:${runId}`]
        ).catch(() => undefined);
        preloadHeld = false;
      }
      hangingHost.release();
    }
    inFlightAcceptedCycle = null;
    await harness.poolA.query("select 1");

    for (let cycle = 0; cycle < 40; cycle += 1) {
      const outstanding = Number((await harness.admin.query(
        `select count(*)::int count
           from unified_check_tasks
          where run_id=$1 and status <> 'COMPLETED'`,
        [runId]
      )).rows[0].count);
      if (outstanding === 0) break;
      await runtime.runAnalysisCycle();
      await runtime.runProviderCycle();
    }
    expect(Number((await harness.admin.query(
      `select count(*)::int count
         from unified_check_tasks
        where run_id=$1 and status <> 'COMPLETED'`,
      [runId]
    )).rows[0].count)).toBe(0);
    await expect(runtime.runFinalizationCycle()).resolves.toMatchObject({
      finalized: true,
      runId
    });
    await expect(runUnifiedDeliveryCycle({
      repository: createPostgresUnifiedDeliveryRepository(harness.poolA, {
        runtimeCommit: RUNTIME_COMMIT
      }),
      now: () => new Date(FROZEN_CLOCK_ISO),
      leaseToken: () => "stage-c1-delivery-lease",
      leaseMs: 60_000,
      limit: 1,
      sendTelegram: async () => ({
        kind: "confirmed" as const,
        telegramMessageId: "stage-c1-message"
      })
    })).resolves.toMatchObject({ claimed: 1, settled: 1 });

    const shadowRows = (await harness.admin.query(
      `select sha256,kind,artifact_json
         from unified_check_artifacts
        where created_by_run_id=$1 and kind=any($2::text[])
        order by kind,sha256`,
      [runId, SHADOW_ARTIFACT_KINDS]
    )).rows;
    const shadowCounts = Object.fromEntries(SHADOW_ARTIFACT_KINDS.map(
      (kind) => [kind, shadowRows.filter((row) => row.kind === kind).length]
    ));
    const projectionBytes = await authoritativeProjection({
      harness,
      runId,
      providerCalls,
      cacheDecisions
    });
    const shadowHashes = shadowRows.map((row) => String(row.sha256));
    const attemptedShadowReferences = Number((await harness.admin.query(
      `select count(*)::int count
         from unified_check_attempts attempt
         join unified_check_tasks task on task.id=attempt.task_id
         join unified_check_artifacts artifact on artifact.sha256=attempt.artifact_sha256
        where task.run_id=$1 and artifact.kind=any($2::text[])`,
      [runId, SHADOW_ARTIFACT_KINDS]
    )).rows[0].count);
    expect(attemptedShadowReferences).toBe(0);
    for (const hash of shadowHashes) expect(projectionBytes).not.toContain(hash);
    return {
      projectionBytes,
      providerCalls,
      cacheDecisions,
      shadowCounts,
      shadowHashes,
      shadowArtifacts: shadowRows.map((row) => ({
        kind: String(row.kind),
        artifact: row.artifact_json
      })),
      acceptedCheckpointElapsedMs,
      blockerHeldAtSettlement
    };
  } finally {
    hangingHost.release();
    if (preloadHolder) {
      await preloadHolder.query("select pg_advisory_unlock_all()")
        .catch(() => undefined);
      preloadHeld = false;
      await preloadHolder.end().catch(() => undefined);
    }
    if (inFlightAcceptedCycle !== null) {
      await settleBeforeTestDeadline(
        inFlightAcceptedCycle.catch(() => undefined),
        5_000,
        "service_role_shadow_deadline_cleanup_timeout"
      ).catch(() => undefined);
    }
    performanceNow.mockRestore();
    await dispose(harness);
  }
}

postgresDescribe("service role shadow runtime PostgreSQL fence", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await dispose(harness);
  }, 60_000);

  it("keeps the complete production authority byte-identical when shadow observation is enabled", async () => {
    const disabled = await runAuthoritativeNoninterferenceTape({
      policy: "disabled",
      variant: "normal"
    });
    const enabled = await runAuthoritativeNoninterferenceTape({
      policy: "service-role-shadow-100-plus-100-v1",
      variant: "normal"
    });
    expect(enabled.projectionBytes).toBe(disabled.projectionBytes);
    expect(enabled.providerCalls).toEqual(disabled.providerCalls);
    expect(enabled.providerCalls).toHaveLength(2);
    expect(enabled.cacheDecisions).toEqual(disabled.cacheDecisions);
    expect(enabled.cacheDecisions).toHaveLength(2);
    expect(enabled.cacheDecisions.map(({ source }) => source)).toEqual([
      "network",
      "network"
    ]);
    expect(disabled.shadowHashes).toEqual([]);
    expect(enabled.shadowCounts).toEqual({
      service_role_shadow_input_set: 1,
      service_role_shadow_input_fence: 1,
      service_role_shadow_profile: 7,
      service_role_shadow_precommit_receipt: 1,
      service_role_shadow_runtime_receipt: 1,
      service_role_shadow_run_summary: 1
    });
    expect(enabled.shadowArtifacts.find(({ kind }) =>
      kind === "service_role_shadow_input_fence"
    )?.artifact).toMatchObject({ outcome: { kind: "ready" } });
    expect(enabled.shadowArtifacts.find(({ kind }) =>
      kind === "service_role_shadow_input_set"
    )?.artifact).toMatchObject({
      roleMapV2Sha256s: [expect.any(String)]
    });
    const precommit = enabled.shadowArtifacts.find(({ kind }) =>
      kind === "service_role_shadow_precommit_receipt"
    )?.artifact as { profiles?: readonly unknown[] } | undefined;
    expect(precommit).toMatchObject({
      commitStatus: "unconfirmed",
      profiles: expect.any(Array)
    });
    expect(precommit?.profiles).toHaveLength(7);
    expect(enabled.shadowArtifacts.find(({ kind }) =>
      kind === "service_role_shadow_runtime_receipt"
    )?.artifact).toMatchObject({ commitStatus: "reconciled" });
    const summaryArtifact = enabled.shadowArtifacts.find(({ kind }) =>
      kind === "service_role_shadow_run_summary"
    )?.artifact;
    expect(summaryArtifact).toMatchObject({
      complete: true,
      counts: {
        eligibleGroup: 1,
        eligibleProfile: 7,
        reconciledGroup: 1,
        reconciledProfile: 7,
        unreconciledGroup: 0
      }
    });

    for (const variant of ["preload_lock", "post_commit_hang"] as const) {
      const disabledDeadline = await runAuthoritativeNoninterferenceTape({
        policy: "disabled",
        variant
      });
      const enabledDeadline = await runAuthoritativeNoninterferenceTape({
        policy: "service-role-shadow-100-plus-100-v1",
        variant
      });
      expect(enabledDeadline.projectionBytes).toBe(
        disabledDeadline.projectionBytes
      );
      expect(enabledDeadline.providerCalls).toEqual(
        disabledDeadline.providerCalls
      );
      expect(enabledDeadline.cacheDecisions).toEqual(
        disabledDeadline.cacheDecisions
      );
      expect(enabledDeadline.blockerHeldAtSettlement).toBe(true);
      expect(enabledDeadline.acceptedCheckpointElapsedMs)
        .toBeGreaterThanOrEqual(900);
      expect(enabledDeadline.acceptedCheckpointElapsedMs).toBeLessThan(2_500);
    }
  }, 120_000);

  it("uses schema 037 and converges two real connections on one empty ready fence", async () => {
    expect((await harness.admin.query(
      "select to_regclass('unified_runtime_instances')::text name"
    )).rows[0].name).toBe("unified_runtime_instances");
    const seeded = await seedRun(harness);
    const pidA = await backendPid(harness.poolA);
    const pidB = await backendPid(harness.poolB);
    expect(pidA).not.toBe(pidB);
    const [first, second] = await Promise.all([
      runtime(harness.poolA).loadInputFence(seeded),
      runtime(harness.poolB).loadInputFence(seeded)
    ]);
    expect(second).toEqual(first);
    expect(first.artifact.outcome).toMatchObject({
      kind: "ready",
      roleMapV2Sha256s: []
    });
    const counts = (await harness.admin.query(
      `select kind,count(*)::int count
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind in ('service_role_shadow_input_set','service_role_shadow_input_fence')
        group by kind order by kind`,
      [seeded.runId]
    )).rows;
    expect(counts).toEqual([
      { kind: "service_role_shadow_input_fence", count: 1 },
      { kind: "service_role_shadow_input_set", count: 1 }
    ]);
    await expectNoRuntimeAdvisoryLocks(harness, [pidA, pidB]);
  }, 30_000);

  it("publishes and reuses one conflict when an existing ready closure is missing", async () => {
    const seeded = await seedRun(harness);
    const ready = buildServiceRoleShadowInputFenceV1({
      ...seeded,
      runtimeCommit: RUNTIME_COMMIT,
      outcome: {
        kind: "ready",
        inputSetSha256: "f".repeat(64),
        roleMapV2Sha256s: []
      }
    });
    await harness.admin.query(
      `insert into unified_check_artifacts
         (sha256,created_by_run_id,kind,schema_version,artifact_json)
       values ($1,$2,'service_role_shadow_input_fence','1',$3::jsonb)`,
      [ready.sha256, seeded.runId, JSON.stringify(ready.artifact)]
    );

    const firstConflict = await runtime(harness.poolA).loadInputFence(seeded);
    expect(firstConflict.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "conflict",
      observedRoleMapV2Sha256s: []
    });
    const countAfterFirstConflict = Number((await harness.admin.query(
      `select count(*)::int count
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_input_fence'`,
      [seeded.runId]
    )).rows[0].count);
    expect(countAfterFirstConflict).toBe(2);

    const secondConflict = await runtime(harness.poolB).loadInputFence(seeded);
    expect(secondConflict).toEqual(firstConflict);
    expect(Number((await harness.admin.query(
      `select count(*)::int count
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_input_fence'`,
      [seeded.runId]
    )).rows[0].count)).toBe(countAfterFirstConflict);
  }, 30_000);

  it("keeps a ready fence unchanged after a later wrapper insertion and restart", async () => {
    const seeded = await seedRun(harness);
    const first = await runtime(harness.poolA).loadInputFence(seeded);
    await insertMalformedWrapper(harness, seeded.runId, "later-ready");
    const restarted = await runtime(harness.poolB).loadInputFence(seeded);
    expect(restarted).toEqual(first);
    expect(restarted.artifact.outcome).toMatchObject({
      kind: "ready",
      roleMapV2Sha256s: []
    });
  }, 30_000);

  it("publishes durable malformed for a non-hash wrapper key without weakening fence hashes", async () => {
    const seeded = await seedRun(harness);
    const validMalformedSha256 = await insertMalformedWrapper(
      harness,
      seeded.runId,
      "valid-hash-neighbor"
    );
    const corruptKey = await insertCorruptWrapperKey(harness, seeded.runId);
    const first = await runtime(harness.poolA).loadInputFence(seeded);
    expect(first.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "malformed",
      observedRoleMapV2Sha256s: [validMalformedSha256]
    });
    expect((await harness.admin.query(
      `select kind,count(*)::int count
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind in ('service_role_shadow_input_set','service_role_shadow_input_fence')
        group by kind order by kind`,
      [seeded.runId]
    )).rows).toEqual([
      { kind: "service_role_shadow_input_fence", count: 1 }
    ]);
    expect(Number((await harness.admin.query(
      "select count(*)::int count from unified_check_artifacts where sha256=$1",
      [corruptKey]
    )).rows[0].count)).toBe(1);
    expect(await runtime(harness.poolB).loadInputFence(seeded)).toEqual(first);
  }, 30_000);

  it("rolls back a held run-row timeout, publishes unavailable, releases C1 lock, and permits an authoritative write", async () => {
    const seeded = await seedRun(harness);
    const runtimePid = await backendPid(harness.poolA);
    const holder = new pg.Client({
      connectionString,
      options: `-c search_path=${harness.schema}`
    });
    await holder.connect();
    await holder.query("begin");
    await holder.query("select id from unified_check_runs where id=$1 for update", [seeded.runId]);
    const fencePromise = runtime(harness.poolA).loadInputFence(seeded);
    try {
      const normalWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "for update of run",
        lockKind: "run_row"
      });
      const publicationWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "insert into unified_check_artifacts",
        lockKind: "run_row",
        afterQueryStartedAt: normalWait.queryStartedAt
      });
      await holder.query("rollback");
      const fence = await fencePromise;
      expect(publicationWait.observedAt).toBeGreaterThan(normalWait.observedAt);
      expect(publicationWait.queryStartedAt).not.toBe(normalWait.queryStartedAt);
      expect(publicationWait.transactionStartedAt)
        .not.toBe(normalWait.transactionStartedAt);
      expect(fence.artifact.outcome).toEqual({
        kind: "unavailable",
        reason: "preload_timeout",
        observedRoleMapV2Sha256s: null
      });
      expect(Number((await harness.admin.query(
        `select count(*)::int count from unified_check_artifacts
          where created_by_run_id=$1 and kind='service_role_shadow_input_set'`,
        [seeded.runId]
      )).rows[0].count)).toBe(0);
      await expectNoRuntimeAdvisoryLocks(harness, [runtimePid]);

      const authoritative = { kind: "authoritative-write-after-shadow-timeout", runId: seeded.runId };
      const authoritativeSha256 = fingerprintCanonicalArtifact(authoritative);
      await harness.admin.query(
        `insert into unified_check_artifacts
           (sha256,created_by_run_id,kind,schema_version,artifact_json)
         values ($1,$2,'test_authoritative_write','1',$3::jsonb)`,
        [authoritativeSha256, seeded.runId, JSON.stringify(authoritative)]
      );
      expect(Number((await harness.admin.query(
        "select count(*)::int count from unified_check_artifacts where sha256=$1",
        [authoritativeSha256]
      )).rows[0].count)).toBe(1);

      await insertMalformedWrapper(harness, seeded.runId, "later-unavailable");
      expect(await runtime(harness.poolB).loadInputFence(seeded)).toEqual(fence);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await fencePromise.catch(() => undefined);
      await holder.end();
    }
  }, 30_000);

  it("bounds an advisory-lock preload to 1000ms plus jitter and leaves no C1 lock", async () => {
    const seeded = await seedRun(harness);
    const runtimePid = await backendPid(harness.poolA);
    const holder = new pg.Client({
      connectionString,
      options: `-c search_path=${harness.schema}`
    });
    await holder.connect();
    await holder.query(
      "select pg_advisory_lock(hashtextextended($1::text,0))",
      [`service-role-shadow-input-fence-v1:${seeded.runId}`]
    );
    const startedAt = performance.now();
    const fencePromise = runtime(harness.poolA).loadInputFence(seeded);
    try {
      const wait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "pg_advisory_xact_lock",
        lockKind: "advisory"
      });
      const publicationWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "pg_advisory_xact_lock",
        lockKind: "advisory",
        afterQueryStartedAt: wait.queryStartedAt
      });
      await delay(75);
      await holder.query(
        "select pg_advisory_unlock(hashtextextended($1::text,0))",
        [`service-role-shadow-input-fence-v1:${seeded.runId}`]
      );
      const holderReleasedAt = performance.now();
      const fence = await fencePromise;
      const elapsedMs = performance.now() - startedAt;
      expect(holderReleasedAt - wait.observedAt).toBeGreaterThanOrEqual(1_000);
      expect(publicationWait.queryStartedAt).not.toBe(wait.queryStartedAt);
      expect(elapsedMs).toBeGreaterThanOrEqual(1_000);
      expect(elapsedMs).toBeLessThan(2_500);
      expect(fence.artifact.outcome).toEqual({
        kind: "unavailable",
        reason: "preload_timeout",
        observedRoleMapV2Sha256s: null
      });
      await expectNoRuntimeAdvisoryLocks(harness, [runtimePid]);
    } finally {
      await holder.query("select pg_advisory_unlock_all()").catch(() => undefined);
      await fencePromise.catch(() => undefined);
      await holder.end();
    }
  }, 30_000);

  it("retries a timed-out publication transaction and converges on a durable fallback fence", async () => {
    const seeded = await seedRun(harness);
    const runtimePid = await backendPid(harness.poolA);
    const holder = new pg.Client({
      connectionString,
      options: `-c search_path=${harness.schema}`
    });
    await holder.connect();
    await holder.query(
      "select pg_advisory_lock(hashtextextended($1::text,0))",
      [`service-role-shadow-input-fence-v1:${seeded.runId}`]
    );
    const startedAt = performance.now();
    const fencePromise = runtime(harness.poolA).loadInputFence(seeded);
    try {
      const normalWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "pg_advisory_xact_lock",
        lockKind: "advisory"
      });
      const firstPublicationWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "pg_advisory_xact_lock",
        lockKind: "advisory",
        afterQueryStartedAt: normalWait.queryStartedAt
      });
      const fallbackWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "pg_advisory_xact_lock",
        lockKind: "advisory",
        afterQueryStartedAt: firstPublicationWait.queryStartedAt
      });
      await delay(75);
      await holder.query(
        "select pg_advisory_unlock(hashtextextended($1::text,0))",
        [`service-role-shadow-input-fence-v1:${seeded.runId}`]
      );
      const holderReleasedAt = performance.now();
      const fence = await fencePromise;
      const elapsedMs = performance.now() - startedAt;
      expect(firstPublicationWait.queryStartedAt).not.toBe(normalWait.queryStartedAt);
      expect(fallbackWait.queryStartedAt).not.toBe(firstPublicationWait.queryStartedAt);
      expect(holderReleasedAt - firstPublicationWait.observedAt)
        .toBeGreaterThanOrEqual(1_000);
      expect(elapsedMs).toBeGreaterThanOrEqual(1_800);
      expect(elapsedMs).toBeLessThan(3_500);
      expect(fence.artifact.outcome).toEqual({
        kind: "unavailable",
        reason: "preload_timeout",
        observedRoleMapV2Sha256s: null
      });
      expect((await harness.admin.query(
        `select kind,count(*)::int count
           from unified_check_artifacts
          where created_by_run_id=$1
            and kind in ('service_role_shadow_input_set','service_role_shadow_input_fence')
          group by kind order by kind`,
        [seeded.runId]
      )).rows).toEqual([
        { kind: "service_role_shadow_input_fence", count: 1 }
      ]);
      await expectNoRuntimeAdvisoryLocks(harness, [runtimePid]);
      expect(await runtime(harness.poolB).loadInputFence(seeded)).toEqual(fence);
    } finally {
      await holder.query("select pg_advisory_unlock_all()").catch(() => undefined);
      await fencePromise.catch(() => undefined);
      await holder.end();
    }
  }, 30_000);

  it("bounds a blocked reconciliation transaction below the worker deadline and releases the pool connection", async () => {
    const prepared = await preparedCheckpointReconciliation(harness);
    const runtimePid = await backendPid(harness.poolA);
    const holder = new pg.Client({
      connectionString,
      options: `-c search_path=${harness.schema}`
    });
    await holder.connect();
    await holder.query("begin");
    await holder.query(
      "lock table unified_check_artifacts in access exclusive mode"
    );
    const startedAt = performance.now();
    const reconciliation = prepared.shadow.reconcileCheckpoint(
      prepared.lifecycle
    );
    try {
      await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "from unified_check_artifacts",
        lockKind: "relation"
      });
      await expect(reconciliation).rejects.toSatisfy((error: unknown) => {
        const code = (error as { code?: unknown }).code;
        return code === "55P03" || code === "57014";
      });
      expect(performance.now() - startedAt).toBeLessThan(1_000);

      expect((await harness.admin.query(
        `select state,xact_start is null as transaction_released
           from pg_stat_activity where pid=$1`,
        [runtimePid]
      )).rows[0]).toMatchObject({
        state: "idle",
        transaction_released: true
      });
      expect((await harness.poolA.query("select 1::int value")).rows)
        .toEqual([{ value: 1 }]);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await reconciliation.catch(() => undefined);
      await holder.end();
    }

    await prepared.shadow.reconcileCheckpoint(prepared.lifecycle);
    expect(Number((await harness.admin.query(
      `select count(*)::int count
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_runtime_receipt'`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(0);
  }, 30_000);

  it("replays final accepted inventory into one restart-stable seven-profile summary", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: true
    });
    const first = await prepared.shadow.summarizeRun({
      runId: prepared.seeded.runId,
      signal: new AbortController().signal
    });
    expect(first).not.toBeNull();
    expect(first!.artifact).toMatchObject({
      acceptedTraversal: {
        taskId: expect.any(String),
        acceptedAttemptId: prepared.traversalAttemptId,
        artifactSha256: prepared.traversalSha256
      },
      groupReceiptSha256s: [expect.stringMatching(/^[0-9a-f]{64}$/u)],
      counts: {
        missing: 0,
        conflict: 0,
        malformed: 0,
        eligibleGroup: 1,
        eligibleProfile: 7,
        reconciledGroup: 1,
        reconciledProfile: 7,
        unreconciledGroup: 0,
        profileOrphan: 0,
        precommitOrphan: 0
      },
      complete: true,
      productionEffect: false
    });
    expect(parseServiceRoleShadowRunSummaryV1({
      artifact: first!.artifact,
      expectedSha256: first!.sha256
    })).toEqual(first!.artifact);

    const restarted = runtime(harness.poolB);
    const second = await restarted.summarizeRun({
      runId: prepared.seeded.runId,
      signal: new AbortController().signal
    });
    expect(second).toEqual(first);
    expect(Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_run_summary'`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(1);
  }, 30_000);

  it("recovers a durable crash-window precommit once and then publishes the summary", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false
    });
    expect(Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_runtime_receipt'`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(0);

    const restarted = runtime(harness.poolB);
    await restarted.reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    const rows = (await harness.admin.query(
      `select kind,sha256,artifact_json from unified_check_artifacts
        where created_by_run_id=$1
          and kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          ) order by kind,sha256`,
      [prepared.seeded.runId]
    )).rows;
    expect(rows.map((row) => row.kind)).toEqual([
      "service_role_shadow_run_summary",
      "service_role_shadow_runtime_receipt"
    ]);
    expect(rows[0].artifact_json).toMatchObject({ complete: true });

    await restarted.reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    expect(Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1
          and kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          )`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(2);
  }, 30_000);

  it("supersedes an incomplete summary after startup recovery closes its group", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false
    });
    const incomplete = await prepared.shadow.summarizeRun({
      runId: prepared.seeded.runId,
      signal: new AbortController().signal
    });
    expect(incomplete?.artifact).toMatchObject({
      counts: {
        reconciledGroup: 0,
        unreconciledGroup: 1
      },
      complete: false
    });

    const restarted = runtime(harness.poolB);
    await restarted.reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    const summaries = (await harness.admin.query(
      `select sha256,artifact_json
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_run_summary'
        order by sha256`,
      [prepared.seeded.runId]
    )).rows;
    expect(summaries).toHaveLength(2);
    expect(summaries.map((row) => row.artifact_json.complete).sort()).toEqual([
      false,
      true
    ]);
    expect(new Set(summaries.map((row) => row.sha256)).size).toBe(2);

    await restarted.reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    expect(Number((await harness.admin.query(
      `select count(*)::int count
         from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_run_summary'`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(2);
  }, 30_000);

  it("maps every unavailable fence reason onto the one final compound group", async () => {
    for (const [reason, count] of [
      ["preload_timeout", "missing"],
      ["conflict", "conflict"],
      ["malformed", "malformed"]
    ] as const) {
      const prepared = await seedTerminalShadowInventory({
        harness,
        reconcileBeforeCompletion: false,
        unavailableReason: reason
      });
      const summary = await prepared.shadow.summarizeRun({
        runId: prepared.seeded.runId,
        signal: new AbortController().signal
      });
      expect(summary?.artifact.counts).toMatchObject({
        [count]: 1,
        eligibleGroup: 0,
        eligibleProfile: 0,
        reconciledGroup: 0,
        reconciledProfile: 0,
        unreconciledGroup: 0,
        profileOrphan: 0,
        precommitOrphan: 0
      });
      expect(summary?.artifact.complete).toBe(false);
    }
  }, 30_000);

  it("counts visited groups with zero or duplicate accepted manifests", async () => {
    const missingAddress = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8";
    const missing = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: true,
      extraVisitedStates: [{
        address: missingAddress,
        direction: "backward",
        anchorTimestamp: "2026-07-01T00:00:00.000Z",
        fundingEpisodeId: "missing-manifest",
        allocatedAmountRaw: "1",
        sourceEventIds: ["missing-event"]
      }]
    });
    const missingSummary = await missing.shadow.summarizeRun({
      runId: missing.seeded.runId,
      signal: new AbortController().signal
    });
    expect(missingSummary?.artifact.counts).toMatchObject({
      missing: 1,
      conflict: 0,
      malformed: 0,
      eligibleGroup: 1,
      reconciledGroup: 1
    });
    expect(missingSummary?.artifact.complete).toBe(false);

    const duplicate = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: true
    });
    await insertDuplicateAcceptedHistory(harness, duplicate);
    const duplicateSummary = await duplicate.shadow.summarizeRun({
      runId: duplicate.seeded.runId,
      signal: new AbortController().signal
    });
    expect(duplicateSummary?.artifact.counts).toMatchObject({
      missing: 0,
      conflict: 1,
      malformed: 0,
      eligibleGroup: 0,
      reconciledGroup: 0
    });
    expect(duplicateSummary?.artifact.complete).toBe(false);
  }, 30_000);

  it("keeps post-input process loss only in unreconciledGroup", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false
    });
    const summary = await prepared.shadow.summarizeRun({
      runId: prepared.seeded.runId,
      signal: new AbortController().signal
    });
    expect(summary?.artifact.counts).toEqual({
      missing: 0,
      conflict: 0,
      malformed: 0,
      eligibleGroup: 1,
      eligibleProfile: 7,
      reconciledGroup: 0,
      reconciledProfile: 0,
      unreconciledGroup: 1,
      profileOrphan: 0,
      precommitOrphan: 0
    });
    expect(summary?.artifact.complete).toBe(false);
  }, 30_000);

  it("counts valid profile and precommit artifacts outside final inventory as orphans", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: true
    });
    const precommitRow = (await harness.admin.query(
      `select artifact_json from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_precommit_receipt'`,
      [prepared.seeded.runId]
    )).rows[0];
    const source = precommitRow.artifact_json;
    const sourceProfile = (await harness.admin.query(
      `select artifact_json from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_profile'
        order by sha256 limit 1`,
      [prepared.seeded.runId]
    )).rows[0].artifact_json;
    const orphanProfile = {
      ...sourceProfile,
      traversalStateId: "f".repeat(64)
    };
    const orphanProfileSha256 = fingerprintCanonicalArtifact(orphanProfile);
    await insertArtifact({
      harness,
      runId: prepared.seeded.runId,
      sha256: orphanProfileSha256,
      kind: "service_role_shadow_profile",
      schemaVersion: "1",
      artifact: orphanProfile
    });
    const extraNestedProfile = {
      ...sourceProfile,
      anchor: { ...sourceProfile.anchor, unexpected: true }
    };
    const missingNestedProfile = structuredClone(sourceProfile);
    delete missingNestedProfile.result.classifier.recentPredicates.C;
    for (const invalidProfile of [extraNestedProfile, missingNestedProfile]) {
      await insertArtifact({
        harness,
        runId: prepared.seeded.runId,
        sha256: fingerprintCanonicalArtifact(invalidProfile),
        kind: "service_role_shadow_profile",
        schemaVersion: "1",
        artifact: invalidProfile
      });
    }
    const orphanPrecommit = buildServiceRoleShadowPrecommitReceiptV1({
      runId: source.runId,
      snapshotHash: source.snapshotHash,
      inputFenceSha256: source.inputFenceSha256,
      inputSetSha256: source.inputSetSha256,
      manifestKey: source.manifestKey,
      manifestSha256: source.manifestSha256,
      acceptedPageArtifactHashes: source.acceptedPageArtifactHashes,
      candidateCheckpointSha256: source.candidateCheckpointSha256,
      candidateDeltaSha256: source.candidateDeltaSha256,
      compoundBindingKey: "f".repeat(64),
      profiles: source.profiles
    });
    await insertArtifact({
      harness,
      runId: prepared.seeded.runId,
      sha256: orphanPrecommit.sha256,
      kind: "service_role_shadow_precommit_receipt",
      schemaVersion: "1",
      artifact: orphanPrecommit.artifact
    });
    const summary = await prepared.shadow.summarizeRun({
      runId: prepared.seeded.runId,
      signal: new AbortController().signal
    });
    expect(summary?.artifact.counts).toMatchObject({
      eligibleGroup: 1,
      reconciledGroup: 1,
      profileOrphan: 1,
      precommitOrphan: 1
    });
    expect(summary?.artifact.complete).toBe(false);
  }, 30_000);

  it("makes duplicate valid matching precommits unreconciled and counts the extra as orphan", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: true
    });
    const source = (await harness.admin.query(
      `select artifact_json from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_precommit_receipt'`,
      [prepared.seeded.runId]
    )).rows[0].artifact_json;
    const duplicate = buildServiceRoleShadowPrecommitReceiptV1({
      runId: source.runId,
      snapshotHash: source.snapshotHash,
      inputFenceSha256: source.inputFenceSha256,
      inputSetSha256: source.inputSetSha256,
      manifestKey: source.manifestKey,
      manifestSha256: source.manifestSha256,
      acceptedPageArtifactHashes: source.acceptedPageArtifactHashes,
      candidateCheckpointSha256: "f".repeat(64),
      candidateDeltaSha256: source.candidateDeltaSha256,
      compoundBindingKey: source.compoundBindingKey,
      profiles: source.profiles
    });
    await insertArtifact({
      harness,
      runId: prepared.seeded.runId,
      sha256: duplicate.sha256,
      kind: "service_role_shadow_precommit_receipt",
      schemaVersion: "1",
      artifact: duplicate.artifact
    });

    const summary = await prepared.shadow.summarizeRun({
      runId: prepared.seeded.runId,
      signal: new AbortController().signal
    });
    expect(summary?.artifact.counts).toMatchObject({
      malformed: 0,
      eligibleGroup: 1,
      reconciledGroup: 0,
      reconciledProfile: 0,
      unreconciledGroup: 1,
      precommitOrphan: 1
    });
    expect(summary?.artifact.complete).toBe(false);
  }, 30_000);

  it("does not let corrupt precommit/runtime bodies suppress valid recovery", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false
    });
    const precommitSha256 = String((await harness.admin.query(
      `select sha256 from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_precommit_receipt'`,
      [prepared.seeded.runId]
    )).rows[0].sha256);
    for (const [kind, artifact] of [
      ["service_role_shadow_precommit_receipt", {
        malformed: "precommit"
      }],
      ["service_role_shadow_runtime_receipt", {
        precommitSha256,
        malformed: "runtime"
      }],
      ["service_role_shadow_profile", {
        malformed: "profile"
      }],
      ["service_role_shadow_run_summary", {
        runId: prepared.seeded.runId,
        runtimeCommit: RUNTIME_COMMIT,
        complete: true,
        malformed: "summary"
      }]
    ] as const) {
      await insertArtifact({
        harness,
        runId: prepared.seeded.runId,
        sha256: fingerprintCanonicalArtifact(artifact),
        kind,
        schemaVersion: "1",
        artifact
      });
    }
    await runtime(harness.poolB).reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    expect(Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_runtime_receipt'`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(2);
    const summary = (await harness.admin.query(
      `select artifact_json from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_run_summary'
          and artifact_json ? 'counts'`,
      [prepared.seeded.runId]
    )).rows[0].artifact_json;
    expect(summary.counts).toMatchObject({
      malformed: 0,
      reconciledGroup: 1,
      unreconciledGroup: 0,
      profileOrphan: 0
    });
    expect(summary.complete).toBe(true);
  }, 30_000);

  it("never recovers cancelled work or fabricates a missing precommit", async () => {
    const cancelled = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false
    });
    await harness.admin.query(
      `update unified_check_tasks
          set status='CANCELLED',cancellation_requested_at=now()
        where id=$1`,
      [cancelled.lifecycle.task.id]
    );
    const missing = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false,
      observeGroup: false
    });

    await runtime(harness.poolB).reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    const rows = (await harness.admin.query(
      `select created_by_run_id,kind,artifact_json
         from unified_check_artifacts
        where created_by_run_id=any($1::text[])
          and kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          ) order by created_by_run_id,kind`,
      [[cancelled.seeded.runId, missing.seeded.runId]]
    )).rows;
    expect(rows).toEqual([{
      created_by_run_id: missing.seeded.runId,
      kind: "service_role_shadow_run_summary",
      artifact_json: expect.objectContaining({
        complete: false,
        counts: expect.objectContaining({
          malformed: 0,
          eligibleGroup: 1,
          reconciledGroup: 0,
          unreconciledGroup: 1,
          precommitOrphan: 0
        })
      })
    }]);
  }, 30_000);

  it("publishes an incomplete terminal summary after completion crashes without a precommit", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false,
      observeGroup: false
    });
    await runtime(harness.poolB).reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    });
    expect(Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1
          and kind in (
            'service_role_shadow_precommit_receipt',
            'service_role_shadow_runtime_receipt'
          )`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(0);
    const summary = (await harness.admin.query(
      `select artifact_json from unified_check_artifacts
        where created_by_run_id=$1
          and kind='service_role_shadow_run_summary'`,
      [prepared.seeded.runId]
    )).rows[0].artifact_json;
    expect(summary).toMatchObject({
      counts: {
        missing: 0,
        conflict: 0,
        malformed: 0,
        eligibleGroup: 1,
        eligibleProfile: 7,
        reconciledGroup: 0,
        reconciledProfile: 0,
        unreconciledGroup: 1,
        profileOrphan: 0,
        precommitOrphan: 0
      },
      complete: false
    });
  }, 30_000);

  it("bounds cumulative startup work and drains its real PostgreSQL transaction", async () => {
    const prepared: Array<Awaited<
      ReturnType<typeof seedTerminalShadowInventory>
    >> = [];
    for (let index = 0; index < 3; index += 1) {
      prepared.push(await seedTerminalShadowInventory({
        harness,
        reconcileBeforeCompletion: false
      }));
    }
    const runtimePid = await backendPid(harness.poolB);
    const base = createUnifiedPoolTransactionHost(harness.poolB);
    const delayedDb: UnifiedTransactionalQueryable = {
      query: base.query,
      transaction: (work) =>
        base.transaction((client) => work({
          async query(sql, values) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return client.query(sql, values);
          }
        }))
    };
    const delayedRuntime = createServiceRoleShadowRuntimeV1({
      db: delayedDb,
      runtimeCommit: RUNTIME_COMMIT
    });
    const startedAt = performance.now();
    await delayedRuntime.reconcileCommittedServiceRoleShadowRunsV1({
      signal: new AbortController().signal
    }).catch(() => undefined);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect((await harness.admin.query(
      `select state,xact_start is null as transaction_released
         from pg_stat_activity where pid=$1`,
      [runtimePid]
    )).rows[0]).toMatchObject({
      state: "idle",
      transaction_released: true
    });
    await expectNoRuntimeAdvisoryLocks(harness, [runtimePid]);
    expect((await harness.poolB.query("select 1::int value")).rows)
      .toEqual([{ value: 1 }]);
    const countArtifacts = async () => Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=any($1::text[])
          and kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          )`,
      [prepared.map(({ seeded }) => seeded.runId)]
    )).rows[0].count);
    const atReturn = await countArtifacts();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await countArtifacts()).toBe(atReturn);
  }, 30_000);

  it("rolls a hanging startup sweep back inside its one-second boundary", async () => {
    const prepared = await seedTerminalShadowInventory({
      harness,
      reconcileBeforeCompletion: false
    });
    const holder = new pg.Client({
      connectionString,
      options: `-c search_path=${harness.schema}`
    });
    await holder.connect();
    await holder.query("begin");
    await holder.query(
      "lock table unified_check_artifacts in access exclusive mode"
    );
    const startedAt = performance.now();
    const recovery = runtime(harness.poolB)
      .reconcileCommittedServiceRoleShadowRunsV1({
        signal: new AbortController().signal
      });
    try {
      await expect(recovery).rejects.toSatisfy((error: unknown) =>
        ["55P03", "57014"].includes(String((error as { code?: unknown }).code))
      );
      expect(performance.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await recovery.catch(() => undefined);
      await holder.end();
    }
    expect(Number((await harness.admin.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1
          and kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          )`,
      [prepared.seeded.runId]
    )).rows[0].count)).toBe(0);
  }, 30_000);

  it("times out saturated isolated startup acquisition without a late waiter", async () => {
    const isolated = await createHarness();
    const recoveryPool = createServiceRoleShadowRecoveryDb(connectionString!);
    const holder = await recoveryPool.connect();
    await holder.query(`set search_path to "${isolated.schema}"`);
    const holderPid = Number((await holder.query(
      "select pg_backend_pid()::int pid, 'saturated-holder-marker'::text marker"
    )).rows[0].pid);
    let holderReleased = false;
    try {
      const productionRuntime = createUnifiedProductionRuntime({
        db: createUnifiedPoolTransactionHost(isolated.poolA),
        serviceRoleShadowRecoveryDb:
          createUnifiedPoolTransactionHost(recoveryPool),
        runtimeCommit: RUNTIME_COMMIT,
        providerConfigurationSha256: "a".repeat(64),
        serviceRoleShadowPolicy: "service-role-shadow-100-plus-100-v1",
        loadProviderPage: async () => {
          throw new Error("unused");
        },
        loadCounterpartyLabels: async () => new Map(),
        loadFrozenLabelDataset: async () => {
          throw new Error("unused");
        },
        loadHardEvidence: async () => ({})
      });
      const startedAt = performance.now();
      const recovery = productionRuntime
        .reconcileCommittedServiceRoleShadowRunsV1!(
          new AbortController().signal
        );
      await expect(recovery).rejects.toSatisfy((error: unknown) =>
        error instanceof Error && error.message.includes("timeout")
      );
      expect(performance.now() - startedAt).toBeLessThan(1_000);
      expect(recoveryPool.waitingCount).toBe(0);
      expect((await isolated.poolA.query("select 1::int value")).rows)
        .toEqual([{ value: 1 }]);

      const artifactCountAtReturn = Number((await isolated.admin.query(
        `select count(*)::int count from unified_check_artifacts
          where kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          )`
      )).rows[0].count);
      holder.release();
      holderReleased = true;
      await delay(300);
      expect(recoveryPool.waitingCount).toBe(0);
      expect(Number((await isolated.admin.query(
        `select count(*)::int count from unified_check_artifacts
          where kind in (
            'service_role_shadow_runtime_receipt',
            'service_role_shadow_run_summary'
          )`
      )).rows[0].count)).toBe(artifactCountAtReturn);
      expect((await isolated.admin.query(
        `select state,xact_start is null as transaction_released,query
           from pg_stat_activity where pid=$1`,
        [holderPid]
      )).rows[0]).toMatchObject({
        state: "idle",
        transaction_released: true,
        query: expect.stringContaining("saturated-holder-marker")
      });
      expect((await recoveryPool.query("select 1::int value")).rows)
        .toEqual([{ value: 1 }]);
    } finally {
      if (!holderReleased) holder.release();
      await recoveryPool.end();
      await dispose(isolated);
    }
  }, 30_000);
});
