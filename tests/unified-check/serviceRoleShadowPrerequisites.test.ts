import { describe, expect, it } from "vitest";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import { buildAddressHistoryManifest } from "../../src/unifiedCheck/addressHistory.js";
import type { ServiceRoleShadowEventRoleMapV1 } from "../../src/unifiedCheck/serviceRoleShadow.js";
import type { TraversalCompactionArtifactV2 } from "../../src/unifiedCheck/traversalDelta.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import {
  runServiceRoleShadowPrerequisiteAuditReadOnly,
  serviceRoleShadowPrerequisiteExitCode
} from "../../scripts/auditServiceRoleShadowPrerequisites.js";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const PROFILED = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const TOKEN = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SNAPSHOT = "a".repeat(64);

function event(index: number, timestamp: number): IndexedTronUsdtTransfer {
  return {
    txHash: index.toString(16).padStart(64, "0"),
    blockNumber: 10_000 - index,
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
    confirmed: true
  };
}

function fixture(roleCount: number | null) {
  const recentStart = Date.parse("2026-07-30T00:00:00.000Z") / 1_000;
  const recent = Array.from({ length: 100 }, (_, index) =>
    event(index + 1, recentStart - index)
  );
  const historical = Array.from({ length: 100 }, (_, index) =>
    event(index + 101, recentStart - 8 * 24 * 60 * 60 - index)
  );
  const events = [...recent, ...historical];
  const state = {
    address: PROFILED,
    direction: "backward" as const,
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: canonicalTronUsdtEventKey(recent[0]!),
    allocatedAmountRaw: "1000000",
    sourceEventIds: [canonicalTronUsdtEventKey(recent[0]!)]
  };
  const page = {
    version: "unified-address-history-page-v1",
    schemaVersion: 1,
    runId: "run-1",
    manifestKey: "pending",
    providerPageHash: "b".repeat(64),
    rawRowCount: events.length,
    events: events.map((item) => ({
      ...item,
      blockTimestamp: item.blockTimestamp.toISOString()
    }))
  };
  const canonicalIds = events.map((item) => canonicalTronUsdtEventKey(item)).sort();
  const preliminaryManifest = buildAddressHistoryManifest({
    chain: "tron",
    snapshotHash: SNAPSHOT,
    tokenContract: TOKEN,
    address: PROFILED,
    providerRequestVersion: "unified-address-history-v1",
    pageArtifactHashes: ["c".repeat(64)],
    canonicalEventIds: canonicalIds,
    rawRowCount: events.length,
    duplicateCount: 0,
    exhaustion: {
      kind: "account_creation_reached",
      evidenceSha256: "d".repeat(64)
    }
  });
  const boundPage = { ...page, manifestKey: preliminaryManifest.key };
  const pageSha256 = fingerprintCanonicalArtifact(boundPage);
  const manifest = {
    ...preliminaryManifest,
    pageArtifactHashes: [pageSha256]
  };
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  const analysisManifest = {
    version: "analysis-manifest-v1",
    runId: "run-1",
    subjectAddress: SUBJECT,
    snapshotHash: SNAPSHOT
  };
  const analysisManifestSha256 = fingerprintCanonicalArtifact(analysisManifest);
  const compaction: TraversalCompactionArtifactV2 = {
    version: "unified-traversal-compaction-v2",
    analysisManifestHash: analysisManifestSha256,
    snapshotHash: SNAPSHOT,
    sourceCheckpointSha256: "e".repeat(64),
    frontier: [state],
    visited: [],
    terminals: [],
    supersededStateIds: [],
    expandedStateIds: [],
    eligibleEventIds: [],
    expandedStateKeys: [],
    selectedBackwardRaw: "1000000",
    selectedForwardRaw: "0"
  };
  const compactionSha256 = fingerprintCanonicalArtifact(compaction);
  const roleMap: ServiceRoleShadowEventRoleMapV1 | null = roleCount === null
    ? null
    : {
        schemaVersion: "service-role-shadow-event-role-map-v1",
        runId: "run-1",
        snapshotHash: SNAPSHOT,
        addressHistoryManifestSha256: manifestSha256,
        entries: events.slice(0, roleCount).map((item) => ({
          canonicalEventId: canonicalTronUsdtEventKey(item),
          role: "ordinary",
          authority: "existing_hash_bound_economic_role_v1",
          evidenceSha256: "f".repeat(64)
        }))
      };
  const roleMapSha256 = roleMap === null
    ? null
    : fingerprintCanonicalArtifact(roleMap);
  const rows = {
    accepted: [{
      task_id: "task-history-1",
      logical_key: manifest.key,
      attempt_task_id: "task-history-1",
      attempt_artifact_sha256: manifestSha256,
      run_id: "run-1",
      subject_address: SUBJECT,
      snapshot_hash: SNAPSHOT,
      analysis_manifest_sha256: analysisManifestSha256,
      analysis_manifest_json: analysisManifest,
      manifest_sha256: manifestSha256,
      manifest_created_by_run_id: "run-1",
      manifest_kind: "address_history_manifest",
      manifest_schema_version: "1",
      manifest_json: manifest
    }],
    traversal: [{
      run_id: "run-1",
      checkpoint_json: {
        version: "unified-production-traversal-checkpoint-v2",
        analysisManifestHash: analysisManifestSha256,
        snapshotHash: SNAPSHOT,
        deltaHeadSha256: null,
        compactionSha256,
        counters: { expanded: 0, terminal: 0, superseded: 0 },
        recentDiagnostics: []
      }
    }],
    traversalArtifacts: [{
      sha256: compactionSha256,
      created_by_run_id: "run-1",
      kind: "traversal_compaction_v2",
      schema_version: "1",
      artifact_json: compaction
    }],
    deltaLinks: [] as Array<Record<string, unknown>>,
    deltaArtifacts: [] as Array<Record<string, unknown>>,
    roleMaps: roleMap === null ? [] : [{
      sha256: roleMapSha256,
      created_by_run_id: "run-1",
      kind: "service_role_event_role_map",
      schema_version: "1",
      artifact_json: roleMap
    }],
    pages: [{
      sha256: pageSha256,
      created_by_run_id: "run-1",
      kind: "address_history_page",
      schema_version: "1",
      artifact_json: boundPage
    }]
  };
  const calls: string[] = [];
  let acceptedHistoryReads = 0;
  const db = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("service_role_shadow:accepted_histories")) {
        acceptedHistoryReads += 1;
        return { rows: acceptedHistoryReads === 1 ? rows.accepted : [] };
      }
      if (sql.includes("service_role_shadow:traversal_task")) {
        return { rows: rows.traversal };
      }
      if (sql.includes("service_role_shadow:traversal_compaction")) {
        return { rows: rows.traversalArtifacts.filter((row) =>
          row.kind === "traversal_compaction_v2"
        ) };
      }
      if (sql.includes("service_role_shadow:traversal_delta_discovery_page")) {
        return { rows: rows.deltaLinks };
      }
      if (sql.includes("service_role_shadow:traversal_delta_replay_page")) {
        return { rows: rows.deltaArtifacts };
      }
      if (sql.includes("service_role_shadow:role_maps")) {
        return { rows: rows.roleMaps };
      }
      if (sql.includes("service_role_shadow:pages")) {
        return { rows: rows.pages };
      }
      return { rows: [] };
    }
  };
  return { calls, db, manifestSha256, rows };
}

function appendDuplicateEvent(
  rows: ReturnType<typeof fixture>["rows"],
  mutation: Partial<(typeof rows.pages)[number]["artifact_json"]["events"][number]> = {}
): string {
  const page = rows.pages[0]!.artifact_json;
  page.events.push({ ...page.events[0]!, ...mutation });
  page.rawRowCount += 1;
  const pageSha256 = fingerprintCanonicalArtifact(page);
  rows.pages[0]!.sha256 = pageSha256;
  const manifest = rows.accepted[0]!.manifest_json;
  manifest.pageArtifactHashes = [pageSha256];
  manifest.rawRowCount += 1;
  manifest.duplicateCount += 1;
  const manifestSha256 = fingerprintCanonicalArtifact(manifest);
  rows.accepted[0]!.attempt_artifact_sha256 = manifestSha256;
  rows.accepted[0]!.manifest_sha256 = manifestSha256;
  return manifestSha256;
}

describe("service role shadow prerequisite audit", () => {
  it("reconstructs real accepted-history windows and reports valid zero role coverage", async () => {
    const { calls, db, manifestSha256 } = fixture(null);
    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly(db);

    expect(calls.some((sql) => sql.includes("service_role_shadow:pages"))).toBe(true);
    expect(receipt).toEqual({
      schemaVersion: "service-role-shadow-prerequisites-v1",
      acceptedHistories: 1,
      reconstructedHistories: 1,
      historiesWithRoleMap: 0,
      fullyRoleBoundHistories: 0,
      sampledEvents: 200,
      roleBoundSampledEvents: 0,
      failures: [{ manifestSha256, reason: "role_map_missing" }]
    });
    expect(serviceRoleShadowPrerequisiteExitCode(receipt)).toBe(2);
    expect(calls[0]).toMatch(/^begin transaction read only$/iu);
    expect(calls.at(-1)).toMatch(/^rollback$/iu);
  });

  it("counts every accepted history after the first successful reconstruction", async () => {
    const { calls, db, manifestSha256, rows } = fixture(null);
    rows.accepted.push({
      ...rows.accepted[0]!,
      task_id: "task-history-2",
      attempt_task_id: "task-history-2"
    });

    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly(db);

    expect(receipt).toMatchObject({
      acceptedHistories: 2,
      reconstructedHistories: 2,
      historiesWithRoleMap: 0,
      fullyRoleBoundHistories: 0,
      sampledEvents: 400,
      roleBoundSampledEvents: 0,
      failures: [
        { manifestSha256, reason: "role_map_missing" },
        { manifestSha256, reason: "role_map_missing" }
      ]
    });
    expect(calls.filter((sql) =>
      sql.includes("service_role_shadow:accepted_histories")
    )).toHaveLength(2);
    expect(calls.filter((sql) =>
      sql.includes("service_role_shadow:accepted_histories")
    ).every((sql) =>
      sql.includes("(task.run_id, manifest.sha256, task.id) > ($1, $2, $3)") &&
      sql.includes("limit $4")
    )).toBe(true);
    expect(calls.some((sql) =>
      sql.includes("service_role_shadow:traversal_artifacts")
    )).toBe(false);
  });

  it("walks and replays traversal deltas through bounded pages", async () => {
    const { calls, db, rows } = fixture(null);
    const delta = {
      version: "unified-traversal-delta-v1",
      previousDeltaHash: null,
      addedFrontier: [],
      removedFrontierStateIds: [],
      addedVisited: [],
      addedTerminals: [],
      addedSupersededStateIds: [],
      addedExpandedStateIds: [],
      addedEligibleEventIds: [],
      addedExpandedStateKeys: [],
      counterDeltas: { expanded: 0, terminal: 0, superseded: 0 }
    };
    const deltaSha256 = fingerprintCanonicalArtifact(delta);
    (rows.traversal[0]!.checkpoint_json as { deltaHeadSha256: string | null })
      .deltaHeadSha256 = deltaSha256;
    rows.deltaLinks.push({ sha256: deltaSha256, previous_delta_hash: null });
    rows.deltaArtifacts.push({
      sha256: deltaSha256,
      created_by_run_id: "run-1",
      kind: "traversal_delta",
      schema_version: "1",
      artifact_json: delta
    });

    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly(db);

    expect(receipt).toMatchObject({
      acceptedHistories: 1,
      reconstructedHistories: 1,
      sampledEvents: 200
    });
    expect(calls.some((sql) =>
      sql.includes("service_role_shadow:traversal_delta_discovery_page") &&
      sql.includes("chain.depth < $3")
    )).toBe(true);
    expect(calls.some((sql) =>
      sql.includes("service_role_shadow:traversal_delta_replay_page") &&
      sql.includes("chain.depth < $3")
    )).toBe(true);
  });

  it("exits zero only after one accepted history is fully role-bound", async () => {
    const { calls, db } = fixture(200);
    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly(db);

    expect(receipt).toMatchObject({
      acceptedHistories: 1,
      reconstructedHistories: 1,
      historiesWithRoleMap: 1,
      fullyRoleBoundHistories: 1,
      sampledEvents: 200,
      roleBoundSampledEvents: 200,
      failures: []
    });
    expect(serviceRoleShadowPrerequisiteExitCode(receipt)).toBe(0);
    const acceptedSql = calls.find((sql) =>
      sql.includes("service_role_shadow:accepted_histories")
    );
    expect(acceptedSql).toContain("attempt.task_id = task.id");
    expect(acceptedSql).toContain("manifest.created_by_run_id = task.run_id");
    expect(acceptedSql).toContain("manifest.artifact_json->>'key' = task.logical_key");
  });

  it.each([
    ["swapped attempt", { attempt_task_id: "task-other" }],
    ["swapped logical key", { logical_key: "manifest-other" }],
    ["swapped creator run", { manifest_created_by_run_id: "run-other" }]
  ])("rejects a %s before it can contribute an exit-zero history", async (_name, mutation) => {
    const { db, rows } = fixture(200);
    Object.assign(rows.accepted[0]!, mutation);

    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly(db);

    expect(receipt).toMatchObject({
      acceptedHistories: 0,
      reconstructedHistories: 0,
      fullyRoleBoundHistories: 0
    });
    expect(serviceRoleShadowPrerequisiteExitCode(receipt)).toBe(2);
  });

  it("never defaults a missing role to ordinary", async () => {
    const { db, manifestSha256 } = fixture(199);
    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly(db);

    expect(receipt).toMatchObject({
      reconstructedHistories: 1,
      historiesWithRoleMap: 1,
      fullyRoleBoundHistories: 0,
      sampledEvents: 200,
      roleBoundSampledEvents: 199,
      failures: [{ manifestSha256, reason: "role_authority_missing" }]
    });
    expect(serviceRoleShadowPrerequisiteExitCode(receipt)).toBe(2);
  });

  it("rejects a page whose persisted bytes no longer match its hash", async () => {
    const { db, manifestSha256, rows } = fixture(null);
    rows.pages[0]!.artifact_json = {
      ...rows.pages[0]!.artifact_json,
      rawRowCount: 199
    };

    await expect(runServiceRoleShadowPrerequisiteAuditReadOnly(db)).resolves
      .toMatchObject({
        reconstructedHistories: 0,
        fullyRoleBoundHistories: 0,
        failures: [{ manifestSha256, reason: "source_binding_invalid" }]
      });
  });

  it("accepts identical duplicate event bytes without double-counting the event", async () => {
    const { db, rows } = fixture(null);
    const manifestSha256 = appendDuplicateEvent(rows);

    await expect(runServiceRoleShadowPrerequisiteAuditReadOnly(db)).resolves
      .toMatchObject({
        acceptedHistories: 1,
        reconstructedHistories: 1,
        sampledEvents: 200,
        failures: [{ manifestSha256, reason: "role_map_missing" }]
      });
  });

  it("rejects conflicting bytes for the same canonical event id", async () => {
    const { db, rows } = fixture(null);
    const manifestSha256 = appendDuplicateEvent(rows, { amountRaw: "2000000" });

    await expect(runServiceRoleShadowPrerequisiteAuditReadOnly(db)).resolves
      .toMatchObject({
        acceptedHistories: 1,
        reconstructedHistories: 0,
        sampledEvents: 0,
        failures: [{ manifestSha256, reason: "source_binding_invalid" }]
      });
  });
});
