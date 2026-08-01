import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import {
  createUnifiedPoolTransactionHost
} from "../../src/unifiedCheck/repository.js";
import {
  buildServiceRoleShadowInputFenceV1,
  createServiceRoleShadowRuntimeV1
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
  await admin.query(`set search_path to "${schema}"`);
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
    options: `-c search_path=${schema}`
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
  const manifestSha256 = "d".repeat(64);
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
    previousDeltaHash: null
  };
  const candidateSha256 = fingerprintCanonicalArtifact(candidate);
  const committed = {
    version: "unified-traversal-delta-v1",
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

postgresDescribe("service role shadow runtime PostgreSQL fence", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await dispose(harness);
  }, 60_000);

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
});
