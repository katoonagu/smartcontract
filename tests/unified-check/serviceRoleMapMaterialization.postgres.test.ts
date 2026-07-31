import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import pg from "pg";

const backfillFileRace = vi.hoisted(() => ({
  target: null as string | null,
  replacement: null as string | null
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    lstat: async (path: unknown, options?: unknown) => {
      const status = await (actual.lstat as (...args: unknown[]) => Promise<unknown>)(path, options);
      if (typeof path === "string" && path === backfillFileRace.target && backfillFileRace.replacement !== null) {
        const replacementPath = `${path}.replacement`;
        await actual.writeFile(replacementPath, backfillFileRace.replacement, "utf8");
        await actual.rename(replacementPath, path);
        backfillFileRace.target = null;
        backfillFileRace.replacement = null;
      }
      return status;
    }
  };
});

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
  buildServiceRoleExactEvidenceCaptureManifestV1,
  evaluateServiceRoleExactEvidenceCaptureV1,
  type ServiceRoleExactEvidenceCaptureReceiptV1
} from "../../src/unifiedCheck/serviceRoleExactEvidenceCapture.js";
import {
  type ServiceRolePoisoningDispositionV1,
  type ServiceRoleProviderRiskDispositionV1
} from "../../src/unifiedCheck/serviceRoleMapMaterialization.js";
import { parseServiceRoleShadowEventRoleMapV2 } from "../../src/unifiedCheck/serviceRoleShadow.js";
import { traversalStateId, type TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";
import {
  runServiceRoleMapMaterialization,
  loadServiceRoleMaterializationSource,
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
    riskTransaction: false,
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

async function seedFixture(input: Harness, evidenceCount: number, options: {
  analysisExtra?: Readonly<Record<string, unknown>>;
  exhaustionExtra?: Readonly<Record<string, unknown>>;
  reachedAccountCreation?: boolean;
  exhaustionKind?: "provider_exhausted" | "account_creation_reached";
  mutateExactStates?: (states: TraversalStateV1[]) => TraversalStateV1[];
} = {}) {
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
  const baseExactStates = Array.from({ length: 7 }, (_, index): TraversalStateV1 => ({
    ...state,
    fundingEpisodeId: `episode-${index}-${runId}`
  }));
  const exactStates = options.mutateExactStates?.(baseExactStates) ?? baseExactStates;
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
    reachedAccountCreation: options.reachedAccountCreation ?? true,
    ...options.exhaustionExtra
  };
  const exhaustionSha256 = fingerprintCanonicalArtifact(exhaustionArtifact);
  const manifest = buildAddressHistoryManifest({
    ...identity,
    pageArtifactHashes: [pageSha256],
    canonicalEventIds: events.map((item) => canonicalTronUsdtEventKey(item)),
    rawRowCount: 200,
    duplicateCount: 0,
    exhaustion: { kind: options.exhaustionKind ?? "account_creation_reached", evidenceSha256: exhaustionSha256 }
  });
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  const analysisManifest = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId,
    requestHash: fingerprintCanonicalArtifact(["request", runId]),
    snapshotHash,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: "20000",
    confirmedBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    confirmedBlockTimestamp: "2026-07-30T00:00:00.000Z",
    labelDatasetSha256: fingerprintCanonicalArtifact(["labels", runId]),
    scoringPolicyVersion: "test-scoring-v1",
    attributionPolicyVersion: "test-attribution-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "test-runtime-commit",
    databaseSchemaVersion: 37,
    paginationCutoffBlockNumber: "20000",
    paginationCutoffBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    branchArtifactHashes: {
      fast: fingerprintCanonicalArtifact(["fast", runId]),
      deep: fingerprintCanonicalArtifact(["deep", runId]),
      where: fingerprintCanonicalArtifact(["where", runId])
    },
    ...options.analysisExtra
  };
  const analysisManifestSha256 = fingerprintCanonicalArtifact(analysisManifest);
  const staleState: TraversalStateV1 = { ...state, fundingEpisodeId: "stale-episode" };
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
    addedFrontier: exactStates,
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
      disposition: "not_poisoning",
      reason: "complete_no_match",
      comparison: {
        windowStart: "2024-01-01T00:00:00.000Z",
        windowEnd: "2024-01-01T00:00:00.000Z",
        pageArtifactHashes: [],
        canonicalComparisonEventIds: [],
        comparisonInventorySha256: fingerprintCanonicalArtifact([]),
        orderAuthority: "strictly_earlier_timestamp"
      }
    };
    const providerRiskArtifact: ServiceRoleProviderRiskDispositionV1 = {
      schemaVersion: "service-role-provider-risk-disposition-v1",
      runId,
      snapshotHash,
      addressHistoryManifestSha256: manifestSha256,
      canonicalEventId,
      transactionInfoEvidenceId: "tron-transaction-provider-evidence-v1:test",
      transactionInfoPayloadSha256: "a".repeat(64),
      riskTransaction: false,
      binding: "transaction_level_negative",
      disposition: "not_provider_risk",
      policyVersion: "tronscan-risk-transaction-boolean-v1"
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
    backfill,
    events
  };
}

async function seedCompletedCapture(
  input: Harness,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  mutateReceipt: (receipt: ServiceRoleExactEvidenceCaptureReceiptV1) => ServiceRoleExactEvidenceCaptureReceiptV1 =
    (receipt) => receipt,
  receiptStoredSha256?: string,
  captureStates: (states: TraversalStateV1[]) => TraversalStateV1[] = (states) => states
): Promise<ServiceRoleLocalEvidenceBackfillV1> {
  const source = await loadServiceRoleMaterializationSource(input.db, {
    runId: fixture.runId,
    manifestSha256: fixture.manifestSha256,
    anchor: fixture.anchor
  }, false);
  const manifest = buildServiceRoleExactEvidenceCaptureManifestV1({
    runId: source.runId,
    snapshotHash: source.snapshotHash,
    subjectAddress: source.subjectAddress,
    states: captureStates(source.states),
    anchor: fixture.anchor,
    acceptedHistory: source.acceptedHistory
  });
  const evaluation = evaluateServiceRoleExactEvidenceCaptureV1({
    manifest,
    acceptedEvents: source.acceptedHistory.events,
    transactionEvidence: new Map(fixture.events.map((item) => [item.txHash, providerEvidence(item)]))
  });
  if (!evaluation.receipt) throw new Error("test_capture_not_complete");
  for (const item of [
    { ...manifest, kind: "service_role_exact_evidence_capture_manifest" },
    ...evaluation.poisoning.map((entry) => ({ ...entry, kind: "service_role_poisoning_disposition" })),
    ...evaluation.providerRisk.map((entry) => ({ ...entry, kind: "service_role_provider_risk_disposition" }))
  ]) {
    await input.client.query(
      `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json)
       values ($1,$2,$3,'1',$4::jsonb)
       on conflict (sha256) do nothing`,
      [item.sha256, fixture.runId, item.kind, JSON.stringify(item.artifact)]
    );
  }
  const receipt = mutateReceipt(evaluation.receipt.artifact);
  await input.client.query(
    `insert into unified_check_artifacts
     (sha256,created_by_run_id,kind,schema_version,artifact_json)
     values ($1,$2,'service_role_exact_evidence_capture','1',$3::jsonb)`,
    [receiptStoredSha256 ?? fingerprintCanonicalArtifact(receipt), fixture.runId, JSON.stringify(receipt)]
  );
  return {
    schemaVersion: "service-role-local-evidence-backfill-v1",
    runId: fixture.runId,
    snapshotHash: fixture.snapshotHash,
    addressHistoryManifestSha256: fixture.manifestSha256,
    sampledCanonicalEventIds: [...receipt.sampledCanonicalEventIds],
    entries: receipt.entries.map((entry) => ({
      canonicalEventId: entry.canonicalEventId,
      transactionInfoEvidenceId: entry.transactionInfoEvidenceId,
      transactionInfoPayloadSha256: entry.transactionInfoPayloadSha256,
      transactionInfoFinalityWitnessSha256: entry.transactionInfoFinalityWitnessSha256,
      poisoningEvidenceSha256: entry.poisoningDispositionSha256,
      providerRiskEvidenceSha256: entry.providerRiskDispositionSha256
    }))
  };
}

postgresDescribe("service role map materialization (PostgreSQL)", () => {
  it("rejects traversal states that would bind different wrapper directions", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 0, {
        mutateExactStates: (states) => states.map((state, index) => index === 0
          ? { ...state, direction: "forward" }
          : state)
      });
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: null
      })).rejects.toThrow("service_role_materialization_traversal_state_conflict");
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("rejects malformed analysis authority and incomplete exhaustion before sampling", async () => {
    for (const [options, error] of [
      [{ analysisExtra: { unexpected: true } }, "service_role_materialization_accepted_history_invalid"],
      [{ reachedAccountCreation: false }, "service_role_materialization_inventory_invalid"],
      [{ exhaustionExtra: { unexpected: true } }, "service_role_materialization_inventory_invalid"],
      [{ exhaustionKind: "provider_exhausted" }, "service_role_materialization_inventory_invalid"]
    ] as const) {
      const test = await harness();
      try {
        const fixture = await seedFixture(test, 0, options);
        await expect(runServiceRoleMapMaterialization(test.db, {
          mode: "audit",
          runId: fixture.runId,
          manifestSha256: fixture.manifestSha256,
          anchor: fixture.anchor,
          backfill: fixture.backfill
        })).rejects.toThrow(error);
      } finally {
        await dispose(test);
      }
    }
  }, 30_000);

  it("keeps 200 valid raw and disposition rows incomplete without a completed capture receipt", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      for (const mode of ["audit", "materialize"] as const) {
        const result = await runServiceRoleMapMaterialization(test.db, {
          mode,
          runId: fixture.runId,
          manifestSha256: fixture.manifestSha256,
          anchor: fixture.anchor,
          backfill: fixture.backfill
        });
        expect(result.classification).toBe("incomplete");
        expect(result.eventRoleMapSha256).toBeNull();
        expect(result.eventRoleMapV2Sha256).toBeNull();
        expect(result.evidenceBundleSha256).toBeNull();
      }
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')`
      )).rows[0].count).toBe(0);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("audits a missing receipt read-only, then atomically materializes an idempotent unreferenced V1 pair and V2 wrapper", async () => {
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
      expect(first.eventRoleMapV2Sha256).toBeNull();
      expect(second.coverage).toEqual(first.coverage);
      expect(test.transactionModes).toEqual(["read_only", "read_only"]);
      expect(first.coverage).toMatchObject({
        sampledEventCount: 200,
        fullyAuthorizedEventCount: 0
      });
      expect(first.coverage.traversalStateIds).toHaveLength(7);
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')`
      )).rows[0].count).toBe(0);

      const completed = await seedFixtureEvidenceEntry(test, fixture, 199);
      const receiptBackfill = await seedCompletedCapture(test, { ...fixture, backfill: completed });
      const completeCommand = { ...command, backfill: receiptBackfill };
      const materialized = await runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        ...completeCommand
      });
      expect(materialized.classification).toBe("complete");
      expect(materialized.coverage.fullyAuthorizedEventCount).toBe(200);
      expect(materialized.eventRoleMapV2Sha256).toMatch(/^[0-9a-f]{64}$/u);
      const beforeRetry = (await test.client.query(
        `select sha256,created_by_run_id,kind,schema_version,artifact_json,created_at
         from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')
         order by kind,schema_version`
      )).rows;
      expect(beforeRetry).toHaveLength(3);
      expect(beforeRetry.every((row) => row.created_by_run_id === fixture.runId)).toBe(true);
      expect(beforeRetry.map((row) => [row.kind, row.schema_version])).toEqual([
        ["service_role_event_evidence_bundle", "1"],
        ["service_role_event_role_map", "1"],
        ["service_role_event_role_map", "2"]
      ]);
      const wrapperRow = beforeRetry.find((row) => row.kind === "service_role_event_role_map" && row.schema_version === "2");
      expect(wrapperRow.sha256).toBe(materialized.eventRoleMapV2Sha256);
      expect(wrapperRow.artifact_json).toMatchObject({
        sourceEventRoleMapV1Sha256: materialized.eventRoleMapSha256,
        evidenceBundleSha256: materialized.evidenceBundleSha256,
        exactCoverage: { recent: 100, historical: 100, total: 200 },
        productionEffect: false
      });
      expect(parseServiceRoleShadowEventRoleMapV2({
        artifact: wrapperRow.artifact_json,
        expectedSha256: wrapperRow.sha256
      })).toEqual(wrapperRow.artifact_json);
      expect((await test.client.query(
        `select count(*)::int count from unified_check_attempts
         where artifact_sha256=any($1::text[])`,
        [beforeRetry.map((row) => row.sha256)]
      )).rows[0].count).toBe(0);
      const retry = await runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        ...completeCommand
      });
      expect(retry).toEqual(materialized);
      const afterRetry = (await test.client.query(
        `select sha256,created_by_run_id,kind,schema_version,artifact_json,created_at
         from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')
         order by kind,schema_version`
      )).rows;
      expect(afterRetry).toEqual(beforeRetry);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("accepts one hash-valid source-bound receipt without a legacy backfill", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      await seedCompletedCapture(test, fixture);
      const result = await runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: null
      });
      expect(result.classification).toBe("complete");
      expect(result.eventRoleMapV2Sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.coverage).toMatchObject({ sampledEventCount: 200, fullyAuthorizedEventCount: 200 });
      expect(test.transactionModes).toEqual(["read_only"]);
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')`
      )).rows[0].count).toBe(0);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("rejects two completed receipt candidates for one run, history, and sample", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      await seedCompletedCapture(test, fixture);
      await seedCompletedCapture(test, fixture, (receipt) => ({
        ...receipt,
        entries: receipt.entries.map((entry, index) => index === 0
          ? { ...entry, role: "provider_risk" }
          : entry)
      }));
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: null
      })).rejects.toThrow("service_role_materialization_capture_conflict");
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("rejects bad receipt, event-body, raw, and disposition hashes", async () => {
    const mutations: Array<{
      name: string;
      mutate: (receipt: ServiceRoleExactEvidenceCaptureReceiptV1) => ServiceRoleExactEvidenceCaptureReceiptV1;
      storedSha256?: string;
    }> = [
      { name: "artifact hash", mutate: (receipt) => receipt, storedSha256: "f".repeat(64) },
      { name: "event body", mutate: (receipt) => ({ ...receipt, entries: receipt.entries.map((entry, index) => index === 0 ? { ...entry, eventBodySha256: "f".repeat(64) } : entry) }) },
      { name: "raw payload", mutate: (receipt) => ({ ...receipt, entries: receipt.entries.map((entry, index) => index === 0 ? { ...entry, transactionInfoPayloadSha256: "f".repeat(64) } : entry) }) },
      { name: "poisoning disposition", mutate: (receipt) => ({ ...receipt, entries: receipt.entries.map((entry, index) => index === 0 ? { ...entry, poisoningDispositionSha256: "f".repeat(64) } : entry) }) },
      { name: "provider disposition", mutate: (receipt) => ({ ...receipt, entries: receipt.entries.map((entry, index) => index === 0 ? { ...entry, providerRiskDispositionSha256: "f".repeat(64) } : entry) }) }
    ];
    for (const mutation of mutations) {
      const test = await harness();
      try {
        const fixture = await seedFixture(test, 200);
        await seedCompletedCapture(test, fixture, mutation.mutate, mutation.storedSha256);
        await expect(runServiceRoleMapMaterialization(test.db, {
          mode: "audit",
          runId: fixture.runId,
          manifestSha256: fixture.manifestSha256,
          anchor: fixture.anchor,
          backfill: null
        }), mutation.name).rejects.toThrow("service_role_materialization_capture_conflict");
      } finally {
        await dispose(test);
      }
    }
  }, 120_000);

  it("rejects a receipt bound to the wrong ordered sample", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      await seedCompletedCapture(test, fixture, (receipt) => ({
        ...receipt,
        sampledCanonicalEventIds: [...receipt.sampledCanonicalEventIds].reverse()
      }));
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: null
      })).rejects.toThrow("service_role_materialization_capture_conflict");
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')`
      )).rows[0].count).toBe(0);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("ignores a valid receipt owned by a different capture-manifest identity", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      await seedCompletedCapture(test, fixture, (receipt) => receipt, undefined, (states) =>
        states.map((state, index) => ({ ...state, fundingEpisodeId: `other-episode-${index}` })));
      const result = await runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: null
      });
      expect(result.classification).toBe("incomplete");
      expect(result.eventRoleMapSha256).toBeNull();
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')`
      )).rows[0].count).toBe(0);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("requires legacy backfill references to equal the receipt and never lets them bypass it", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      const backfill = await seedCompletedCapture(test, fixture);
      const mismatched = {
        ...backfill,
        entries: backfill.entries.map((entry, index) => index === 0
          ? { ...entry, poisoningEvidenceSha256: backfill.entries[1]!.poisoningEvidenceSha256 }
          : entry)
      };
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: mismatched
      })).rejects.toThrow("service_role_materialization_backfill_binding_invalid");
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("reparses GasFree from raw evidence and rejects a different inline receipt disposition", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      await seedCompletedCapture(test, fixture, (receipt) => ({
        ...receipt,
        entries: receipt.entries.map((entry, index) => index === 0
          ? { ...entry, gasFree: { disposition: "not_gasfree", reason: "selector_not_registered", settlementSha256: null, movementSha256: null } }
          : entry)
      }));
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill: null
      })).rejects.toThrow("service_role_materialization_capture_conflict");
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

      const atomic = await seedFixture(test, 200);
      const atomicBackfill = await seedCompletedCapture(test, atomic);
      const audit = await runServiceRoleMapMaterialization(test.db, {
        mode: "audit",
        runId: atomic.runId,
        manifestSha256: atomic.manifestSha256,
        anchor: atomic.anchor,
        backfill: atomicBackfill
      });
      expect(audit.eventRoleMapSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(audit.eventRoleMapV2Sha256).toMatch(/^[0-9a-f]{64}$/u);
      await test.client.query(
        `insert into unified_check_artifacts
         (sha256,created_by_run_id,kind,schema_version,artifact_json)
         values ($1,$2,'conflicting_kind','1','{}'::jsonb)`,
        [audit.eventRoleMapV2Sha256, atomic.runId]
      );
      await expect(runServiceRoleMapMaterialization(test.db, {
        mode: "materialize",
        runId: atomic.runId,
        manifestSha256: atomic.manifestSha256,
        anchor: atomic.anchor,
        backfill: atomicBackfill
      })).rejects.toThrow("unified_artifact_conflict");
      expect((await test.client.query(
        `select count(*)::int count from unified_check_artifacts
         where created_by_run_id=$1
           and kind in ('service_role_event_evidence_bundle','service_role_event_role_map')`,
        [atomic.runId]
      )).rows[0].count).toBe(0);
    } finally {
      await dispose(test);
    }
  }, 30_000);

  it("rejects a hash-tampered stored V2 wrapper", async () => {
    const test = await harness();
    try {
      const fixture = await seedFixture(test, 200);
      const backfill = await seedCompletedCapture(test, fixture);
      const command = {
        runId: fixture.runId,
        manifestSha256: fixture.manifestSha256,
        anchor: fixture.anchor,
        backfill
      };
      const expected = await runServiceRoleMapMaterialization(test.db, { mode: "audit", ...command });
      await test.client.query(
        `insert into unified_check_artifacts
         (sha256,created_by_run_id,kind,schema_version,artifact_json)
         values ($1,$2,'service_role_event_role_map','2',$3::jsonb)`,
        [expected.eventRoleMapV2Sha256, fixture.runId, JSON.stringify({
          runId: fixture.runId,
          addressHistoryManifestSha256: fixture.manifestSha256,
          evidenceBundleSha256: "f".repeat(64)
        })]
      );

      await expect(runServiceRoleMapMaterialization(test.db, { mode: "audit", ...command }))
        .rejects.toThrow("service_role_materialization_artifact_invalid");
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
      backfillFileRace.target = validPath;
      backfillFileRace.replacement = `${JSON.stringify(valid)}${" ".repeat(1024 * 1024)}`;
      await expect(readServiceRoleLocalEvidenceBackfill(validPath))
        .rejects.toThrow("service_role_materialization_backfill_file_invalid");
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
    disposition: "not_poisoning",
    reason: "complete_no_match",
    comparison: {
      windowStart: "2024-01-01T00:00:00.000Z",
      windowEnd: "2024-01-01T00:00:00.000Z",
      pageArtifactHashes: [],
      canonicalComparisonEventIds: [],
      comparisonInventorySha256: fingerprintCanonicalArtifact([]),
      orderAuthority: "strictly_earlier_timestamp"
    }
  };
  const providerRiskArtifact: ServiceRoleProviderRiskDispositionV1 = {
    schemaVersion: "service-role-provider-risk-disposition-v1",
    runId: fixture.runId,
    snapshotHash: fixture.snapshotHash,
    addressHistoryManifestSha256: fixture.manifestSha256,
    canonicalEventId,
    transactionInfoEvidenceId: "tron-transaction-provider-evidence-v1:test",
    transactionInfoPayloadSha256: "a".repeat(64),
    riskTransaction: false,
    binding: "transaction_level_negative",
    disposition: "not_provider_risk",
    policyVersion: "tronscan-risk-transaction-boolean-v1"
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
