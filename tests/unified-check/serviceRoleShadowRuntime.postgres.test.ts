import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import {
  createUnifiedPoolTransactionHost
} from "../../src/unifiedCheck/repository.js";
import {
  createServiceRoleShadowRuntimeV1
} from "../../src/unifiedCheck/serviceRoleShadowRuntime.js";

const connectionString = process.env.TEST_DATABASE_URL;
const releaseGate = process.env.UNIFIED_RELEASE_GATE_MODE === "1";
const postgresDescribe = connectionString && releaseGate ? describe : describe.skip;
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const RUNTIME_COMMIT = "task-4-postgres-runtime";

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
  lockKind: "advisory" | "run_row";
  afterQueryStartedAt?: string;
  deadlineMs?: number;
}): Promise<{ observedAt: number; queryStartedAt: string }> {
  const deadline = performance.now() + (input.deadlineMs ?? 750);
  while (performance.now() < deadline) {
    const row = (await input.harness.admin.query(
      `select activity.state,
              activity.wait_event_type,
              activity.query,
              activity.query_start::text as query_started_at,
              coalesce(bool_or(
                not held.granted and (
                  ($2 = 'advisory' and held.locktype = 'advisory') or
                  ($2 = 'run_row' and held.locktype in ('transactionid','tuple'))
                )
              ),false) as waiting_on_expected_lock
         from pg_stat_activity activity
         left join pg_locks held on held.pid = activity.pid
        where activity.pid = $1
        group by activity.pid, activity.state,
                 activity.wait_event_type, activity.query, activity.query_start`,
      [input.pid, input.lockKind]
    )).rows[0];
    if (
      row?.state === "active" &&
      row.wait_event_type === "Lock" &&
      row.waiting_on_expected_lock === true &&
      typeof row.query_started_at === "string" &&
      row.query_started_at !== input.afterQueryStartedAt &&
      String(row.query).toLowerCase().includes(input.queryFragment.toLowerCase())
    ) {
      return {
        observedAt: performance.now(),
        queryStartedAt: row.query_started_at
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
    const startedAt = performance.now();
    const fencePromise = runtime(harness.poolA).loadInputFence(seeded);
    try {
      const wait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "for update of run",
        lockKind: "run_row"
      });
      await delay(1_200);
      await holder.query("rollback");
      const holderReleasedAt = performance.now();
      const fence = await fencePromise;
      const elapsedMs = performance.now() - startedAt;
      expect(holderReleasedAt - wait.observedAt).toBeGreaterThanOrEqual(1_000);
      expect(elapsedMs).toBeGreaterThanOrEqual(1_000);
      expect(elapsedMs).toBeLessThan(2_500);
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
        afterQueryStartedAt: wait.queryStartedAt,
        deadlineMs: 1_500
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
        afterQueryStartedAt: normalWait.queryStartedAt,
        deadlineMs: 1_500
      });
      const fallbackWait = await waitForRuntimeLockWait({
        harness,
        pid: runtimePid,
        queryFragment: "pg_advisory_xact_lock",
        lockKind: "advisory",
        afterQueryStartedAt: firstPublicationWait.queryStartedAt,
        deadlineMs: 1_500
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
});
