import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import { TRON_USDT_CONTRACT_ADDRESS as USDT } from "../../src/parser/transactionParser.js";
import {
  buildTransactionProviderEvidenceV1,
  saveTransactionProviderEvidence,
  type TronTransactionProviderEvidenceV1
} from "../../src/storage/transactionEvidenceRepository.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import { buildAddressHistoryManifest } from "../../src/unifiedCheck/addressHistory.js";
import {
  buildServiceRoleExactEvidenceCaptureManifestV1,
  evaluateServiceRoleExactEvidenceCaptureV1
} from "../../src/unifiedCheck/serviceRoleExactEvidenceCapture.js";
import type { TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";
import {
  loadServiceRoleMaterializationSource,
  type ServiceRoleMaterializationQueryable
} from "../../scripts/materializeServiceRoleEventMap.js";
import {
  parseServiceRoleExactEvidenceCaptureArgs,
  runServiceRoleExactEvidenceCapture,
  type ServiceRoleExactEvidenceCaptureDatabase
} from "../../scripts/captureServiceRoleExactEvidence.js";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const PROFILED = "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH";
const OTHER_CONTROLLER = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";

function transactionHash(index: number): string {
  return (index + 1).toString(16).padStart(64, "0");
}

function event(index: number, timestampSeconds: number): IndexedTronUsdtTransfer {
  return {
    txHash: transactionHash(index),
    blockNumber: 50_000 - index,
    blockTimestamp: new Date(timestampSeconds * 1_000),
    eventIndex: 0,
    fromAddress: SUBJECT,
    toAddress: PROFILED,
    amountRaw: "1000000",
    method: "transfer",
    eventType: "Transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    reverted: false,
    riskTransaction: false,
    confirmed: true
  };
}

function response(txHash: string): Record<string, unknown> {
  return {
    hash: txHash,
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    riskTransaction: false,
    contractData: {
      contract_address: OTHER_CONTROLLER,
      data: `a9059cbb${"0".repeat(128)}`
    }
  };
}

function evidence(txHash: string): TronTransactionProviderEvidenceV1 {
  return buildTransactionProviderEvidenceV1({
    identity: {
      version: "tron-transaction-provider-evidence-v1",
      chain: "tron",
      txHash,
      provider: "tronscan",
      endpoint: "transaction-info",
      providerSchemaVersion: 1
    },
    payload: response(txHash),
    fetchedAt: "2026-07-30T00:00:00.000Z",
    movement: null
  });
}

type Harness = {
  client: pg.PoolClient;
  pool: pg.Pool;
  schema: string;
  db: ServiceRoleExactEvidenceCaptureDatabase;
  transactionModes: Array<"read_only" | "read_write">;
};

async function harness(): Promise<Harness> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = `rolecapture_${randomUUID().replaceAll("-", "")}`;
  await client.query(`create schema "${schema}"`);
  await client.query(`set search_path to "${schema}"`);
  for (const migration of [
    "003_risk_observation_foundation.sql",
    "033_unified_wallet_check.sql",
    "034_unified_check_adaptive_planner.sql",
    "035_unified_check_run_rollout_policy.sql",
    "036_remove_rollout_authority.sql",
    "037_unified_runtime_handoff.sql"
  ]) await client.query(await readFile(`migrations/${migration}`, "utf8"));
  const query = (sql: string, values?: readonly unknown[]) => client.query(sql, values as unknown[] | undefined);
  const transactionModes: Array<"read_only" | "read_write"> = [];
  const db: ServiceRoleExactEvidenceCaptureDatabase = {
    query,
    async transaction<T>(mode: "read_only" | "read_write", work: (tx: ServiceRoleMaterializationQueryable) => Promise<T>) {
      transactionModes.push(mode);
      await client.query(mode === "read_only"
        ? "begin isolation level repeatable read read only"
        : "begin isolation level serializable read write");
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
  return { client, pool, schema, db, transactionModes };
}

async function dispose(test: Harness): Promise<void> {
  await test.client.query("reset search_path");
  await test.client.query(`drop schema "${test.schema}" cascade`);
  test.client.release();
  await test.pool.end();
}

async function seedFixture(test: Harness, duplicateTransaction = false) {
  const runId = randomUUID();
  const snapshotHash = fingerprintCanonicalArtifact(["snapshot", runId]);
  const recentStart = 1_720_000_000;
  const recent = Array.from({ length: 100 }, (_, index) => event(index, recentStart - index));
  if (duplicateTransaction) recent[1] = { ...recent[1]!, txHash: recent[0]!.txHash, eventIndex: 1 };
  const historical = Array.from({ length: 100 }, (_, index) => event(index + 100, recentStart - 8 * 86_400 - index));
  const events = [...recent, ...historical];
  const states: TraversalStateV1[] = Array.from({ length: 7 }, (_, index) => ({
    address: PROFILED,
    direction: "backward",
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: `episode-${index}-${runId}`,
    allocatedAmountRaw: "1",
    sourceEventIds: [`source-${index}`, canonicalTronUsdtEventKey(recent[0]!)]
  }));
  const identity = {
    chain: "tron" as const,
    snapshotHash,
    tokenContract: USDT,
    address: PROFILED,
    providerRequestVersion: "tronscan-related-trc20-v1"
  };
  const provisional = buildAddressHistoryManifest({
    ...identity,
    pageArtifactHashes: ["a".repeat(64)],
    canonicalEventIds: events.map((item) => canonicalTronUsdtEventKey(item)),
    rawRowCount: 200,
    duplicateCount: 0,
    exhaustion: { kind: "account_creation_reached", evidenceSha256: "b".repeat(64) }
  });
  const page = {
    version: "unified-address-history-page-v1",
    schemaVersion: 1,
    runId,
    manifestKey: provisional.key,
    providerPageHash: fingerprintCanonicalArtifact(["provider-page", runId]),
    rawRowCount: 200,
    events: events.map((item) => ({ ...item, blockTimestamp: item.blockTimestamp.toISOString() }))
  };
  const pageSha256 = fingerprintCanonicalArtifact(page);
  const exhaustion = {
    version: "unified-address-history-exhaustion-v1",
    manifestKey: provisional.key,
    snapshotHash,
    address: PROFILED,
    pageArtifactHashes: [pageSha256],
    reachedAccountCreation: true
  };
  const exhaustionSha256 = fingerprintCanonicalArtifact(exhaustion);
  const manifest = buildAddressHistoryManifest({
    ...identity,
    pageArtifactHashes: [pageSha256],
    canonicalEventIds: events.map((item) => canonicalTronUsdtEventKey(item)),
    rawRowCount: 200,
    duplicateCount: 0,
    exhaustion: { kind: "account_creation_reached", evidenceSha256: exhaustionSha256 }
  });
  // The key does not include page hashes/exhaustion, so the provisional page binding is final.
  expect(manifest.key).toBe(provisional.key);
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  const analysis = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId,
    requestHash: fingerprintCanonicalArtifact(["request", runId]),
    snapshotHash,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: "50000",
    confirmedBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    confirmedBlockTimestamp: "2026-07-30T00:00:00.000Z",
    labelDatasetSha256: fingerprintCanonicalArtifact(["labels", runId]),
    scoringPolicyVersion: "test-scoring-v1",
    attributionPolicyVersion: "test-attribution-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "test-runtime-commit",
    databaseSchemaVersion: 37,
    paginationCutoffBlockNumber: "50000",
    paginationCutoffBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    branchArtifactHashes: {
      fast: fingerprintCanonicalArtifact(["fast", runId]),
      deep: fingerprintCanonicalArtifact(["deep", runId]),
      where: fingerprintCanonicalArtifact(["where", runId])
    }
  };
  const analysisSha256 = fingerprintCanonicalArtifact(analysis);
  const compaction = {
    version: "unified-traversal-compaction-v2",
    analysisManifestHash: analysisSha256,
    snapshotHash,
    sourceCheckpointSha256: fingerprintCanonicalArtifact(["checkpoint", runId]),
    frontier: states,
    visited: [],
    terminals: [],
    supersededStateIds: [],
    expandedStateIds: [],
    eligibleEventIds: [],
    expandedStateKeys: [],
    selectedBackwardRaw: "1",
    selectedForwardRaw: "0"
  };
  const compactionSha256 = fingerprintCanonicalArtifact(compaction);
  await test.client.query(
    `insert into unified_check_runs
     (id,analysis_key_sha256,subject_address,status,run_purpose,side_effect_policy,analysis_manifest_sha256,fairness_owner_id)
     values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$1)`,
    [runId, fingerprintCanonicalArtifact(["analysis-key", runId]), SUBJECT, analysisSha256]
  );
  for (const [sha256, kind, artifact] of [
    [analysisSha256, "analysis_manifest", analysis],
    [pageSha256, "address_history_page", page],
    [exhaustionSha256, "address_history_exhaustion", exhaustion],
    [manifestSha256, "address_history_manifest", manifest],
    [compactionSha256, "traversal_compaction_v2", compaction]
  ] as const) await test.client.query(
    `insert into unified_check_artifacts (sha256,created_by_run_id,kind,schema_version,artifact_json)
     values ($1,$2,$3,'1',$4::jsonb)`,
    [sha256, runId, kind, JSON.stringify(artifact)]
  );
  const taskId = randomUUID();
  const attemptId = randomUUID();
  await test.client.query(
    `insert into unified_check_tasks (id,run_id,kind,status,priority_lane,logical_key,checkpoint_json)
     values ($1,$2,'address_history','COMPLETED','background',$3,'{}'::jsonb)`,
    [taskId, runId, manifest.key]
  );
  await test.client.query(
    `insert into unified_check_attempts (id,task_id,attempt,artifact_sha256,completed_at)
     values ($1,$2,1,$3,now())`,
    [attemptId, taskId, manifestSha256]
  );
  await test.client.query("update unified_check_tasks set accepted_attempt_id=$1 where id=$2", [attemptId, taskId]);
  await test.client.query(
    `insert into unified_check_tasks (id,run_id,kind,status,priority_lane,logical_key,checkpoint_json)
     values ($1,$2,'traversal','CANCELLED','background','main',$3::jsonb)`,
    [randomUUID(), runId, JSON.stringify({
      version: "unified-production-traversal-checkpoint-v2",
      analysisManifestHash: analysisSha256,
      snapshotHash,
      deltaHeadSha256: null,
      compactionSha256,
      counters: { expanded: 0, terminal: 0, superseded: 0 },
      recentDiagnostics: []
    })]
  );
  return { runId, snapshotHash, manifestSha256, anchor: states[0]!.anchorTimestamp, events, states };
}

function command(fixture: Awaited<ReturnType<typeof seedFixture>>, mode: "audit" | "capture") {
  return { mode, runId: fixture.runId, manifestSha256: fixture.manifestSha256, anchor: fixture.anchor } as const;
}

describe("service role exact evidence capture CLI boundary", () => {
  it("accepts only strict audit and confirmed capture commands", () => {
    const runId = randomUUID();
    const manifest = "a".repeat(64);
    const anchor = "2026-06-04T09:20:33.000Z";
    expect(parseServiceRoleExactEvidenceCaptureArgs(["audit", "--run", runId, "--manifest", manifest, "--anchor", anchor]))
      .toEqual({ mode: "audit", runId, manifestSha256: manifest, anchor });
    expect(parseServiceRoleExactEvidenceCaptureArgs(["capture", "--confirm", "--run", runId, "--manifest", manifest, "--anchor", anchor]))
      .toEqual({ mode: "capture", runId, manifestSha256: manifest, anchor });
    for (const argv of [
      ["audit", "--confirm", "--run", runId, "--manifest", manifest, "--anchor", anchor],
      ["capture", "--run", runId, "--manifest", manifest, "--anchor", anchor],
      ["audit", "--manifest", manifest, "--run", runId, "--anchor", anchor],
      ["audit", "--run", runId, "--anchor", anchor, "--manifest", manifest],
      ["capture", "--run", runId, "--manifest", manifest, "--anchor", anchor, "--confirm"],
      ["capture", "--confirm", "--manifest", manifest, "--run", runId, "--anchor", anchor],
      ["capture", "--confirm", "--run", runId, "--anchor", anchor, "--manifest", manifest],
      ["audit", "--run", runId, "--run", runId, "--manifest", manifest, "--anchor", anchor],
      ["audit", "--run", runId, "--manifest", manifest, "--anchor", anchor, "--endpoint", "x"],
      ["audit", "--run", runId, "--manifest", manifest, "--anchor", anchor, "--history", "x"],
      ["audit", "--run", runId, "--manifest", manifest, "--anchor", anchor, "--address", PROFILED],
      ["audit", "--run", runId, "--manifest", manifest, "--anchor", anchor, "--role", "ordinary"],
      ["audit", "--run", "bad", "--manifest", manifest, "--anchor", anchor],
      ["audit", "--run", runId, "--manifest", "A".repeat(64), "--anchor", anchor],
      ["audit", "--run", runId, "--manifest", manifest, "--anchor", "2026-06-04"]
    ]) expect(() => parseServiceRoleExactEvidenceCaptureArgs(argv)).toThrow("service_role_exact_evidence_capture_args_invalid");
  });
});

postgresDescribe("service role exact evidence capture (PostgreSQL)", () => {
  it("audits read-only, persists the manifest before calls, saves valid evidence immediately, and resumes missing unique hashes", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, true);
      let auditCalls = 0;
      const audit = await runServiceRoleExactEvidenceCapture(test.db, command(fixture, "audit"), {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        getTransaction: async () => { auditCalls += 1; return {}; }
      });
      expect(audit.classification).toBe("incomplete");
      expect(auditCalls).toBe(0);
      expect(test.transactionModes).toEqual(["read_only"]);
      expect((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count).toBe(0);
      expect((await test.client.query("select count(*)::int count from unified_check_artifacts where kind like 'service_role_%'")).rows[0].count).toBe(0);

      const calls: string[] = [];
      const rawCountsBeforeCalls: number[] = [];
      let manifestObservedBeforeEveryCall = true;
      const incomplete = await runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        getTransaction: async (txHash) => {
          manifestObservedBeforeEveryCall &&= (await test.client.query("select count(*)::int count from unified_check_artifacts where kind='service_role_exact_evidence_capture_manifest'")).rows[0].count === 1;
          rawCountsBeforeCalls.push((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count);
          calls.push(txHash);
          if (calls.length <= 2) return response(txHash);
          throw Object.assign(new Error("provider unavailable"), { code: "PROVIDER_UNAVAILABLE" });
        }
      });
      expect(incomplete.classification).toBe("incomplete");
      expect(incomplete.providerLogicalRequests).toBe(199);
      expect(manifestObservedBeforeEveryCall).toBe(true);
      expect(rawCountsBeforeCalls.slice(0, 4)).toEqual([0, 1, 2, 2]);
      expect(calls).toEqual([...new Set(calls)].sort());
      expect((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count).toBe(2);
      expect((await test.client.query("select count(*)::int count from unified_check_artifacts where kind in ('service_role_poisoning_disposition','service_role_provider_risk_disposition','service_role_exact_evidence_capture')")).rows[0].count).toBe(0);

      const resumedCalls: string[] = [];
      const complete = await runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
        now: () => new Date("2026-07-31T00:00:00.000Z"),
        getTransaction: async (txHash) => { resumedCalls.push(txHash); return response(txHash); }
      });
      expect(complete.classification).toBe("complete");
      expect(complete.providerLogicalRequests).toBe(197);
      expect(resumedCalls).toEqual(calls.slice(2));
      expect(complete.coverage.uniqueTransactionCount).toBe(199);
      expect(complete.coverage.validTransactionEvidenceCount).toBe(199);
    } finally {
      await dispose(test);
    }
  }, 40_000);

  it("treats unsupported schema, wrong hash, and contradictory finality as fatal without saving invalid raw evidence", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test);
      for (const invalid of [
        (txHash: string) => ({ ...response(txHash), riskTransaction: undefined }),
        (txHash: string) => ({ ...response(txHash), hash: "f".repeat(64) }),
        (txHash: string) => ({ ...response(txHash), receipt: { result: "REVERT" } })
      ]) {
        await expect(runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
          now: () => new Date("2026-07-30T00:00:00.000Z"),
          getTransaction: async (txHash) => invalid(txHash)
        })).rejects.toThrow();
        expect((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count).toBe(0);
      }
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("continues only recognized transient provider failures and preserves valid raw evidence on fatal errors", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test);
      for (const unavailable of [
        Object.assign(new Error("provider unavailable"), { code: "PROVIDER_UNAVAILABLE" }),
        Object.assign(new Error("timeout"), { status: 408 }),
        Object.assign(new Error("rate limited"), { status: 429 }),
        Object.assign(new Error("upstream failed"), { status: 503 }),
        new DOMException("aborted", "AbortError"),
        new TypeError("fetch failed")
      ]) {
        const incomplete = await runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
          now: () => new Date("2026-07-30T00:00:00.000Z"),
          getTransaction: async () => { throw unavailable; }
        });
        expect(incomplete.classification).toBe("incomplete");
        expect((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count).toBe(0);
      }

      let calls = 0;
      await expect(runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        getTransaction: async (txHash) => {
          calls += 1;
          if (calls === 1) return response(txHash);
          throw new Error("programmer or configuration failure");
        }
      })).rejects.toThrow("programmer or configuration failure");
      expect((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count).toBe(1);

      await expect(runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        getTransaction: async () => { throw Object.assign(new Error("not found"), { status: 404 }); }
      })).rejects.toThrow("not found");
      expect((await test.client.query("select count(*)::int count from raw_evidence")).rows[0].count).toBe(1);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("atomically inserts 200+200+receipt, rolls artifact-400 conflicts back, and repeats idempotently", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test);
      for (const item of fixture.events) await saveTransactionProviderEvidence(test.db as any, evidence(item.txHash));
      const source = await loadServiceRoleMaterializationSource(test.db, command(fixture, "audit"), false);
      const manifest = buildServiceRoleExactEvidenceCaptureManifestV1({
        runId: source.runId,
        snapshotHash: source.snapshotHash,
        subjectAddress: source.subjectAddress,
        states: source.states,
        anchor: fixture.anchor,
        acceptedHistory: source.acceptedHistory
      });
      const transactionEvidence = new Map(fixture.events.map((item) => [item.txHash, evidence(item.txHash)]));
      const expected = evaluateServiceRoleExactEvidenceCaptureV1({ manifest, acceptedEvents: fixture.events, transactionEvidence });
      expect(expected.receipt).not.toBeNull();
      const artifact400 = expected.providerRisk.at(-1)!;
      await test.client.query(
        `insert into unified_check_artifacts (sha256,created_by_run_id,kind,schema_version,artifact_json)
         values ($1,$2,'conflicting_kind','1',$3::jsonb)`,
        [artifact400.sha256, fixture.runId, JSON.stringify(artifact400.artifact)]
      );
      await expect(runServiceRoleExactEvidenceCapture(test.db, command(fixture, "capture"), {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        getTransaction: async () => { throw new Error("must not call"); }
      })).rejects.toThrow("unified_artifact_conflict");
      expect((await test.client.query("select count(*)::int count from unified_check_artifacts where kind in ('service_role_poisoning_disposition','service_role_provider_risk_disposition','service_role_exact_evidence_capture')")).rows[0].count).toBe(0);

      const idempotentFixture = await seedFixture(test);
      for (const item of idempotentFixture.events) await saveTransactionProviderEvidence(test.db as any, evidence(item.txHash));
      const first = await runServiceRoleExactEvidenceCapture(test.db, command(idempotentFixture, "capture"), {
        now: () => new Date("2026-07-30T00:00:00.000Z"),
        getTransaction: async () => { throw new Error("must not call"); }
      });
      const before = (await test.client.query(
        `select sha256,kind,created_at from unified_check_artifacts
         where kind in ('service_role_exact_evidence_capture_manifest','service_role_poisoning_disposition','service_role_provider_risk_disposition','service_role_exact_evidence_capture')
           and created_by_run_id=$1
         order by kind,sha256`
        , [idempotentFixture.runId])).rows;
      expect(first.classification).toBe("complete");
      expect(first.providerLogicalRequests).toBe(0);
      expect(before.filter((row) => row.kind === "service_role_poisoning_disposition")).toHaveLength(200);
      expect(before.filter((row) => row.kind === "service_role_provider_risk_disposition")).toHaveLength(200);
      expect(before.filter((row) => row.kind === "service_role_exact_evidence_capture")).toHaveLength(1);
      const receiptHash = before.find((row) => row.kind === "service_role_exact_evidence_capture")!.sha256;
      expect((await test.client.query("select count(*)::int count from unified_check_attempts where artifact_sha256=any($1::text[])", [[...before.map((row) => row.sha256)]])).rows[0].count).toBe(0);
      const second = await runServiceRoleExactEvidenceCapture(test.db, command(idempotentFixture, "capture"), {
        now: () => new Date("2026-08-01T00:00:00.000Z"),
        getTransaction: async () => { throw new Error("must not call"); }
      });
      const after = (await test.client.query(
        `select sha256,kind,created_at from unified_check_artifacts
         where kind in ('service_role_exact_evidence_capture_manifest','service_role_poisoning_disposition','service_role_provider_risk_disposition','service_role_exact_evidence_capture')
           and created_by_run_id=$1
         order by kind,sha256`
        , [idempotentFixture.runId])).rows;
      expect(second.completedReceiptSha256).toBe(receiptHash);
      expect(after).toEqual(before);
    } finally {
      await dispose(test);
    }
  }, 40_000);
});
