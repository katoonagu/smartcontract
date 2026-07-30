import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pg from "pg";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import { TRON_USDT_CONTRACT_ADDRESS as USDT } from "../../src/parser/transactionParser.js";
import {
  saveTransactionProviderEvidence,
  transactionProviderEvidenceId,
  transactionProviderFinalityWitnessSha256,
  type TronTransactionProviderEvidenceV1
} from "../../src/storage/transactionEvidenceRepository.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import { buildAddressHistoryManifest } from "../../src/unifiedCheck/addressHistory.js";
import {
  type ServiceRolePoisoningDispositionV1,
  type ServiceRoleProviderRiskDispositionV1
} from "../../src/unifiedCheck/serviceRoleMapMaterialization.js";
import { traversalStateId, type TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";
import {
  runServiceRoleMapMaterialization,
  parseServiceRoleMaterializationArgs,
  readServiceRoleLocalEvidenceBackfill,
  type ServiceRoleLocalEvidenceBackfillV1,
  type ServiceRoleMaterializationDatabase
} from "../../scripts/materializeServiceRoleEventMap.js";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const PROFILED = "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH";
const OTHER_CONTROLLER = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";

function txHash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function event(index: number, timestamp: number): IndexedTronUsdtTransfer {
  return {
    txHash: txHash(index + 1),
    blockNumber: 20_000 - index,
    blockTimestamp: new Date(timestamp * 1_000),
    eventIndex: 0,
    fromAddress: `TSender-${index}`,
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

function providerEvidence(item: IndexedTronUsdtTransfer): TronTransactionProviderEvidenceV1 {
  const identity = {
    version: "tron-transaction-provider-evidence-v1" as const,
    chain: "tron" as const,
    txHash: item.txHash,
    provider: "tronscan" as const,
    endpoint: "transaction-info" as const,
    providerSchemaVersion: 1 as const
  };
  const payload = {
    hash: item.txHash,
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: {
      contract_address: OTHER_CONTROLLER,
      data: `a9059cbb${"0".repeat(128)}`
    }
  };
  const status = "confirmed_success" as const;
  return {
    ...identity,
    fetchedAt: "2026-07-30T00:00:00.000Z",
    finality: {
      status,
      witnessKind: "tronscan_transaction_info",
      witnessSha256: transactionProviderFinalityWitnessSha256({
        identity,
        status,
        payload,
        movement: null
      }),
      movement: null
    },
    payloadSha256: fingerprintCanonicalArtifact(payload),
    payload
  };
}

type Harness = {
  client: pg.PoolClient;
  db: ServiceRoleMaterializationDatabase;
  schema: string;
  pool: pg.Pool;
  transactionModes: Array<"read_only" | "read_write">;
};

async function harness(): Promise<Harness> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = `rolemap_${randomUUID().replaceAll("-", "")}`;
  await client.query(`create schema "${schema}"`);
  await client.query(`set search_path to "${schema}"`);
  for (const migration of [
    "003_risk_observation_foundation.sql",
    "033_unified_wallet_check.sql",
    "034_unified_check_adaptive_planner.sql",
    "035_unified_check_run_rollout_policy.sql",
    "036_remove_rollout_authority.sql",
    "037_unified_runtime_handoff.sql"
  ]) {
    await client.query(await readFile(`migrations/${migration}`, "utf8"));
  }
  const query = (sql: string, values?: readonly unknown[]) =>
    client.query(sql, values as unknown[] | undefined);
  const transactionModes: Array<"read_only" | "read_write"> = [];
  const db: ServiceRoleMaterializationDatabase = {
    query,
    async transaction<T>(
      mode: "read_only" | "read_write",
      work: (tx: import("../../scripts/materializeServiceRoleEventMap.js").ServiceRoleMaterializationQueryable) => Promise<T>
    ): Promise<T> {
      transactionModes.push(mode);
      await client.query(mode === "read_only"
        ? "begin isolation level repeatable read read only"
        : "begin isolation level serializable read write");
      try {
        const value = await work({ query });
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  };
  return { client, db, schema, pool, transactionModes };
}

async function dispose(input: Harness): Promise<void> {
  await input.client.query("reset search_path");
  await input.client.query(`drop schema "${input.schema}" cascade`);
  input.client.release();
  await input.pool.end();
}

async function seedFixture(input: Harness, evidenceCount: number) {
  const runId = randomUUID();
  const snapshotHash = fingerprintCanonicalArtifact(["snapshot", runId]);
  const recentStart = 1_720_000_000;
  const recent = Array.from({ length: 100 }, (_, index) => event(index, recentStart - index));
  const historical = Array.from({ length: 100 }, (_, index) =>
    event(index + 100, recentStart - 8 * 24 * 60 * 60 - index));
  const events = [...recent, ...historical];
  const serializedEvents = events.map((item) => ({
    ...item,
    blockTimestamp: item.blockTimestamp.toISOString()
  }));
  const state: TraversalStateV1 = {
    address: PROFILED,
    direction: "backward",
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: `episode-${runId}`,
    allocatedAmountRaw: "1",
    sourceEventIds: [canonicalTronUsdtEventKey(recent[0]!)]
  };
  const identity = {
    chain: "tron" as const,
    snapshotHash,
    tokenContract: USDT,
    address: PROFILED,
    providerRequestVersion: "tronscan-related-trc20-v1"
  };
  const pageArtifact = {
    version: "unified-address-history-page-v1" as const,
    schemaVersion: 1 as const,
    runId,
    manifestKey: buildAddressHistoryManifest({
      ...identity,
      pageArtifactHashes: ["a".repeat(64)],
      canonicalEventIds: events.map((item) => canonicalTronUsdtEventKey(item)),
      rawRowCount: 200,
      duplicateCount: 0,
      exhaustion: { kind: "account_creation_reached", evidenceSha256: "b".repeat(64) }
    }).key,
    providerPageHash: fingerprintCanonicalArtifact(["provider-page", runId]),
    rawRowCount: 200,
    events: serializedEvents
  };
  const pageSha256 = fingerprintCanonicalArtifact(pageArtifact);
  const exhaustionArtifact = {
    version: "unified-address-history-exhaustion-v1" as const,
    manifestKey: pageArtifact.manifestKey,
    snapshotHash,
    address: PROFILED,
    pageArtifactHashes: [pageSha256],
    reachedAccountCreation: true as const
  };
  const exhaustionSha256 = fingerprintCanonicalArtifact(exhaustionArtifact);
  const manifest = buildAddressHistoryManifest({
    ...identity,
    pageArtifactHashes: [pageSha256],
    canonicalEventIds: events.map((item) => canonicalTronUsdtEventKey(item)),
    rawRowCount: 200,
    duplicateCount: 0,
    exhaustion: { kind: "account_creation_reached", evidenceSha256: exhaustionSha256 }
  });
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  const analysisManifest = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId,
    snapshotHash,
    subjectAddress: SUBJECT
  };
  const analysisManifestSha256 = fingerprintCanonicalArtifact(analysisManifest);
  const staleState: TraversalStateV1 = { ...state, fundingEpisodeId: "stale-episode" };
  const parallelState: TraversalStateV1 = { ...state, fundingEpisodeId: "parallel-episode" };
  const compaction = {
    version: "unified-traversal-compaction-v2" as const,
    analysisManifestHash: analysisManifestSha256,
    snapshotHash,
    sourceCheckpointSha256: fingerprintCanonicalArtifact(["source-checkpoint", runId]),
    frontier: [staleState],
    visited: [] as TraversalStateV1[],
    terminals: [],
    supersededStateIds: [],
    expandedStateIds: [],
    eligibleEventIds: [],
    expandedStateKeys: [],
    selectedBackwardRaw: "1",
    selectedForwardRaw: "0"
  };
  const compactionSha256 = fingerprintCanonicalArtifact(compaction);
  const delta = {
    version: "unified-traversal-delta-v1" as const,
    previousDeltaHash: null,
    addedFrontier: [state, parallelState],
    removedFrontierStateIds: [traversalStateId(staleState)],
    addedVisited: [],
    addedTerminals: [],
    addedSupersededStateIds: [traversalStateId(staleState)],
    addedExpandedStateIds: [],
    addedEligibleEventIds: [],
    addedExpandedStateKeys: [],
    counterDeltas: { expanded: 0, terminal: 0, superseded: 1 }
  };
  const deltaSha256 = fingerprintCanonicalArtifact(delta);

  await input.client.query(
    `insert into unified_check_runs (
       id,analysis_key_sha256,subject_address,status,run_purpose,
       side_effect_policy,analysis_manifest_sha256,fairness_owner_id
     ) values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$1)`,
    [runId, fingerprintCanonicalArtifact(["analysis-key", runId]), SUBJECT, analysisManifestSha256]
  );
  const artifacts = [
    [analysisManifestSha256, "analysis_manifest", "1", analysisManifest],
    [pageSha256, "address_history_page", "1", pageArtifact],
    [exhaustionSha256, "address_history_exhaustion", "1", exhaustionArtifact],
    [manifestSha256, "address_history_manifest", "1", manifest],
    [compactionSha256, "traversal_compaction_v2", "1", compaction],
    [deltaSha256, "traversal_delta", "1", delta]
  ] as const;
  for (const [sha256, kind, schemaVersion, artifact] of artifacts) {
    await input.client.query(
      `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
       values ($1,$2,$3,$4,$5::jsonb)`,
      [sha256, runId, kind, schemaVersion, JSON.stringify(artifact)]
    );
  }
  const historyTaskId = randomUUID();
  const attemptId = randomUUID();
  await input.client.query(
    `insert into unified_check_tasks
     (id,run_id,kind,status,priority_lane,logical_key,checkpoint_json)
     values ($1,$2,'address_history','COMPLETED','background',$3,'{}'::jsonb)`,
    [historyTaskId, runId, manifest.key]
  );
  await input.client.query(
    `insert into unified_check_attempts (id,task_id,attempt,artifact_sha256,completed_at)
     values ($1,$2,1,$3,now())`,
    [attemptId, historyTaskId, manifestSha256]
  );
  await input.client.query(
    "update unified_check_tasks set accepted_attempt_id=$1 where id=$2",
    [attemptId, historyTaskId]
  );
  await input.client.query(
    `insert into unified_check_tasks
     (id,run_id,kind,status,priority_lane,logical_key,checkpoint_json)
     values ($1,$2,'traversal','CANCELLED','background','main',$3::jsonb)`,
    [randomUUID(), runId, JSON.stringify({
      version: "unified-production-traversal-checkpoint-v2",
      analysisManifestHash: analysisManifestSha256,
      snapshotHash,
      deltaHeadSha256: deltaSha256,
      compactionSha256,
      counters: { expanded: 0, terminal: 0, superseded: 1 },
      recentDiagnostics: []
    })]
  );

  const entries: Array<ServiceRoleLocalEvidenceBackfillV1["entries"][number]> = [];
  for (const item of events.slice(0, evidenceCount)) {
    const canonicalEventId = canonicalTronUsdtEventKey(item);
    const transactionInfo = providerEvidence(item);
    await saveTransactionProviderEvidence(input.db as unknown as pg.Pool, transactionInfo);
    const poisoningArtifact: ServiceRolePoisoningDispositionV1 = {
      schemaVersion: "service-role-poisoning-disposition-v1",
      policyVersion: "address-poisoning-v1",
      runId,
      snapshotHash,
      addressHistoryManifestSha256: manifestSha256,
      canonicalEventId,
      coverage: "complete",
      disposition: "not_poisoning"
    };
    const providerRiskArtifact: ServiceRoleProviderRiskDispositionV1 = {
      schemaVersion: "service-role-provider-risk-disposition-v1",
      runId,
      snapshotHash,
      addressHistoryManifestSha256: manifestSha256,
      canonicalEventId,
      disposition: "not_provider_risk"
    };
    const poisoningEvidenceSha256 = fingerprintCanonicalArtifact(poisoningArtifact);
    const providerRiskEvidenceSha256 = fingerprintCanonicalArtifact(providerRiskArtifact);
    for (const [sha256, kind, artifact] of [
      [poisoningEvidenceSha256, "service_role_poisoning_disposition", poisoningArtifact],
      [providerRiskEvidenceSha256, "service_role_provider_risk_disposition", providerRiskArtifact]
    ] as const) {
      await input.client.query(
        `insert into unified_check_artifacts
         (sha256,created_by_run_id,kind,schema_version,artifact_json)
         values ($1,$2,$3,'1',$4::jsonb)`,
        [sha256, runId, kind, JSON.stringify(artifact)]
      );
    }
    entries.push({
      canonicalEventId,
      transactionInfoEvidenceId: transactionProviderEvidenceId(transactionInfo),
      transactionInfoPayloadSha256: transactionInfo.payloadSha256,
      transactionInfoFinalityWitnessSha256: transactionInfo.finality.witnessSha256,
      poisoningEvidenceSha256,
      providerRiskEvidenceSha256
    });
  }
  const backfill: ServiceRoleLocalEvidenceBackfillV1 = {
    schemaVersion: "service-role-local-evidence-backfill-v1",
    runId,
    snapshotHash,
    addressHistoryManifestSha256: manifestSha256,
    sampledCanonicalEventIds: events.map((item) => canonicalTronUsdtEventKey(item)).sort(),
    entries
  };
  return {
    runId,
    snapshotHash,
    manifestSha256,
    anchor: state.anchorTimestamp,
    backfill
  };
}

postgresDescribe("service role map materialization (PostgreSQL)", () => {
  it("audits 199/200 read-only, then atomically materializes an idempotent unreferenced 200/200 pair", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 199);
      const command = {
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: fixture.backfill
      };
      const first = await runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        ...command
      });
      const second = await runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        ...command
      });
      expect(first.classification).toBe("incomplete");
      expect(second.coverage).toEqual(first.coverage);
      expect(test.transactionModes).toEqual(["read_only", "read_only"]);
      expect(first.coverage).toMatchObject({
        sampledEventCount: 200,
        fullyAuthorizedEventCount: 199
      });
      expect(first.coverage.traversalStateIds).toHaveLength(2);
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')`
      )).rows[0].count).toBe(0);

      const completed = await seedFixtureEvidenceEntry(test, fixture, 199);
      const completeCommand = { ...command, backfill: completed };
      const materialized = await runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        ...completeCommand
      });
      expect(materialized.classification).toBe("complete");
      expect(materialized.coverage.fullyAuthorizedEventCount).toBe(200);
      const beforeRetry = (await test.client.query(
        `select sha256,created_by_run_id,kind,schema_version,artifact_json,created_at
         from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')
         order by kind`
      )).rows;
      expect(beforeRetry).toHaveLength(2);
      expect(beforeRetry.every((row) => row.created_by_run_id === fixture.runId)).toBe(true);
      expect((await test.client.query(
        `select count(*)::int count from unified_check_attempts
         where artifact_sha256=any($1::text[])`,
        [beforeRetry.map((row) => row.sha256)]
      )).rows[0].count).toBe(0);
      await runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        ...completeCommand
      });
      const afterRetry = (await test.client.query(
        `select sha256,created_by_run_id,kind,schema_version,artifact_json,created_at
         from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')
         order by kind`
      )).rows;
      expect(afterRetry).toEqual(beforeRetry);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("rejects conflicting maps and binding/hash mismatches without leaving a bundle", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      const conflictingMaps = [0, 1].map((index) => ({
        schemaVersion: "service-role-shadow-event-role-map-v1",
        runId: fixture.runId,
        snapshotHash: fixture.snapshotHash,
        addressHistoryManifestSha256: fixture.manifestSha256,
        entries: index === 0 ? [] : [{ canonicalEventId: `conflict-${index}` }]
      }));
      for (const conflictingMap of conflictingMaps) {
        await test.client.query(
          `insert into unified_check_artifacts
           (sha256,created_by_run_id,kind,schema_version,artifact_json)
           values ($1,$2,'service_role_event_role_map','1',$3::jsonb)`,
          [fingerprintCanonicalArtifact(conflictingMap), fixture.runId, JSON.stringify(conflictingMap)]
        );
      }
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: fixture.backfill
      })).rejects.toThrow("service_role_materialization_existing_map_conflict");
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind='service_role_event_evidence_bundle'`
      )).rows[0].count).toBe(0);

      const mismatched = {
        ...fixture.backfill,
        entries: fixture.backfill.entries.map((entry, index) => index === 0
          ? { ...entry, transactionInfoPayloadSha256: "f".repeat(64) }
          : entry)
      };
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: mismatched
      })).rejects.toThrow("service_role_materialization_backfill_binding_invalid");

      const atomic = await seedFixture(test, 200);
      const audit = await runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: atomic.runId,
        manifestSha256: atomic.manifestSha256,
        anchor: atomic.anchor,
        backfill: atomic.backfill
      });
      expect(audit.eventRoleMapSha256).toMatch(/^[0-9a-f]{64}$/u);
      await test.client.query(
        `insert into unified_check_artifacts
         (sha256,created_by_run_id,kind,schema_version,artifact_json)
         values ($1,$2,'conflicting_kind','1','{}'::jsonb)`,
        [audit.eventRoleMapSha256, atomic.runId]
      );
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        runId: atomic.runId,
        manifestSha256: atomic.manifestSha256,
        anchor: atomic.anchor,
        backfill: atomic.backfill
      })).rejects.toThrow("unified_artifact_conflict");
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where created_by_run_id=$1 and kind='service_role_event_evidence_bundle'`,
        [atomic.runId]
      )).rows[0].count).toBe(0);
    } finally {
      await dispose(test);
    }
  }, 30_000);
});

describe("service role map materializer CLI boundary", () => {
  it("accepts only the two strict command shapes and rejects duplicate-key or role-bearing local JSON", async () => {
    const runId = randomUUID();
    const manifest = "a".repeat(64);
    const anchor = "2026-06-04T09:20:33.000Z";
    expect(parseServiceRoleMaterializationArgs([
      "audit", "--run", runId, "--manifest", manifest, "--anchor", anchor
    ])).toMatchObject({ mode: "audit", evidenceBackfillPath: null });
    expect(parseServiceRoleMaterializationArgs([
      "materialize", "--confirm", "--run", runId, "--manifest", manifest, "--anchor", anchor
    ])).toMatchObject({ mode: "materialize" });
    for (const argv of [
      ["audit", "--confirm", "--run", runId, "--manifest", manifest, "--anchor", anchor],
      ["materialize", "--run", runId, "--manifest", manifest, "--anchor", anchor],
      ["audit", "--run", runId, "--run", runId, "--manifest", manifest, "--anchor", anchor],
      ["audit", "--run", runId, "--manifest", manifest, "--anchor", anchor, "--role", "ordinary"]
    ]) expect(() => parseServiceRoleMaterializationArgs(argv)).toThrow("service_role_materialization_args_invalid");

    const directory = await mkdtemp(join(tmpdir(), "role-map-backfill-"));
    try {
      const sampledCanonicalEventIds = Array.from({ length: 200 }, (_, index) => `event-${index}`);
      const valid = {
        schemaVersion: "service-role-local-evidence-backfill-v1",
        runId,
        snapshotHash: "b".repeat(64),
        addressHistoryManifestSha256: manifest,
        sampledCanonicalEventIds,
        entries: []
      };
      const validPath = join(directory, "valid.json");
      await writeFile(validPath, JSON.stringify(valid), "utf8");
      expect(await readServiceRoleLocalEvidenceBackfill(validPath)).toEqual(valid);
      const duplicatePath = join(directory, "duplicate.json");
      await writeFile(duplicatePath, `{"schemaVersion":"a","schemaVersion":"b"}`, "utf8");
      await expect(readServiceRoleLocalEvidenceBackfill(duplicatePath))
        .rejects.toThrow("service_role_materialization_backfill_duplicate_key");
      const rolePath = join(directory, "role.json");
      await writeFile(rolePath, JSON.stringify({ ...valid, role: "ordinary" }), "utf8");
      await expect(readServiceRoleLocalEvidenceBackfill(rolePath))
        .rejects.toThrow("service_role_materialization_backfill_invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function seedFixtureEvidenceEntry(
  input: Harness,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  index: number
): Promise<ServiceRoleLocalEvidenceBackfillV1> {
  const recentStart = 1_720_000_000;
  const item = index < 100
    ? event(index, recentStart - index)
    : event(index, recentStart - 8 * 24 * 60 * 60 - (index - 100));
  const canonicalEventId = canonicalTronUsdtEventKey(item);
  const transactionInfo = providerEvidence(item);
  await saveTransactionProviderEvidence(input.db as unknown as pg.Pool, transactionInfo);
  const poisoningArtifact: ServiceRolePoisoningDispositionV1 = {
    schemaVersion: "service-role-poisoning-disposition-v1",
    policyVersion: "address-poisoning-v1",
    runId: fixture.runId,
    snapshotHash: fixture.snapshotHash,
    addressHistoryManifestSha256: fixture.manifestSha256,
    canonicalEventId,
    coverage: "complete",
    disposition: "not_poisoning"
  };
  const providerRiskArtifact: ServiceRoleProviderRiskDispositionV1 = {
    schemaVersion: "service-role-provider-risk-disposition-v1",
    runId: fixture.runId,
    snapshotHash: fixture.snapshotHash,
    addressHistoryManifestSha256: fixture.manifestSha256,
    canonicalEventId,
    disposition: "not_provider_risk"
  };
  const poisoningEvidenceSha256 = fingerprintCanonicalArtifact(poisoningArtifact);
  const providerRiskEvidenceSha256 = fingerprintCanonicalArtifact(providerRiskArtifact);
  for (const [sha256, kind, artifact] of [
    [poisoningEvidenceSha256, "service_role_poisoning_disposition", poisoningArtifact],
    [providerRiskEvidenceSha256, "service_role_provider_risk_disposition", providerRiskArtifact]
  ] as const) {
    await input.client.query(
      `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
       values ($1,$2,$3,'1',$4::jsonb)`,
      [sha256, fixture.runId, kind, JSON.stringify(artifact)]
    );
  }
  return {
    ...fixture.backfill,
    entries: [...fixture.backfill.entries, {
      canonicalEventId,
      transactionInfoEvidenceId: transactionProviderEvidenceId(transactionInfo),
      transactionInfoPayloadSha256: transactionInfo.payloadSha256,
      transactionInfoFinalityWitnessSha256: transactionInfo.finality.witnessSha256,
      poisoningEvidenceSha256,
      providerRiskEvidenceSha256
    }]
  };
}
