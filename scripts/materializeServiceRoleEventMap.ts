import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../src/forensics/tronAddressAllTimeIndex.js";
import {
  getTransactionProviderEvidence,
  type TronTransactionProviderEvidenceV1
} from "../src/storage/transactionEvidenceRepository.js";
import type { IndexedTronUsdtTransfer } from "../src/types.js";
import {
  addressHistoryManifestKey,
  type AddressHistoryManifestV1
} from "../src/unifiedCheck/addressHistory.js";
import type { UnifiedAddressHistoryPageArtifactV1 } from "../src/unifiedCheck/productionAddressHistory.js";
import { parseAnalysisManifestV1 } from "../src/unifiedCheck/contracts.js";
import {
  buildServiceRoleExactEvidenceCaptureManifestV1,
  validateServiceRoleExactEvidenceCaptureReceiptV1,
  type ServiceRoleExactEvidenceCaptureManifestV1,
  type ServiceRoleExactEvidenceCaptureReceiptV1
} from "../src/unifiedCheck/serviceRoleExactEvidenceCapture.js";
import { insertUnifiedArtifact, type UnifiedQueryable } from "../src/unifiedCheck/repository.js";
import {
  materializeServiceRoleEventMapV1,
  type ServiceRoleMaterializationCoverageV1,
  type ServiceRolePoisoningDispositionV1,
  type ServiceRoleProviderRiskDispositionV1
} from "../src/unifiedCheck/serviceRoleMapMaterialization.js";
import {
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowEventRoleMapV1
} from "../src/unifiedCheck/serviceRoleShadow.js";
import { traversalStateId, type TraversalStateV1 } from "../src/unifiedCheck/traversal.js";
import {
  replayTraversalDeltas,
  type TraversalCompactionArtifactV2,
  type TraversalDeltaArtifactV1
} from "../src/unifiedCheck/traversalDelta.js";

const HASH = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RAW = /^(0|[1-9][0-9]*)$/u;
const MAX_BACKFILL_BYTES = 1024 * 1024;
const MAX_HISTORY_PAGES = 10_000;
const MAX_HISTORY_EVENTS = 1_000_000;
const MAX_TRAVERSAL_DELTAS = 20_000;

type QueryResult = { rows: any[]; rowCount?: number | null };
export type ServiceRoleMaterializationQueryable = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
};
export type ServiceRoleMaterializationDatabase = ServiceRoleMaterializationQueryable & {
  transaction<T>(
    mode: "read_only" | "read_write",
    work: (tx: ServiceRoleMaterializationQueryable) => Promise<T>
  ): Promise<T>;
};

export type ServiceRoleLocalEvidenceBackfillV1 = {
  schemaVersion: "service-role-local-evidence-backfill-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  sampledCanonicalEventIds: readonly string[];
  entries: readonly {
    canonicalEventId: string;
    transactionInfoEvidenceId: string;
    transactionInfoPayloadSha256: string;
    transactionInfoFinalityWitnessSha256: string;
    poisoningEvidenceSha256: string;
    providerRiskEvidenceSha256: string;
  }[];
};

export type ServiceRoleMaterializationCommand = {
  mode: "audit" | "materialize";
  runId: string;
  manifestSha256: string;
  anchor: string;
  backfill: ServiceRoleLocalEvidenceBackfillV1 | null;
};

export type ServiceRoleMaterializationRunResult = {
  classification: "complete" | "incomplete";
  coverage: ServiceRoleMaterializationCoverageV1;
  evidenceBundleSha256: string | null;
  eventRoleMapSha256: string | null;
};

type Materialization = ReturnType<typeof materializeServiceRoleEventMapV1>;

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  if (canonicalizeArtifactJson(Object.keys(value).sort()) !== canonicalizeArtifactJson([...expected].sort())) fail(code);
}

function exactTimestamp(value: string, code: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value || milliseconds % 1_000 !== 0) {
    fail(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(code);
  return value;
}

function uuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail(code);
  return value;
}

function parseJsonWithoutDuplicateKeys(source: string): unknown {
  let offset = 0;
  const whitespace = () => {
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
  };
  const stringValue = (): string => {
    if (source[offset] !== "\"") fail("service_role_materialization_backfill_json_invalid");
    const start = offset++;
    let escaped = false;
    while (offset < source.length) {
      const character = source[offset++]!;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") {
        try { return JSON.parse(source.slice(start, offset)) as string; }
        catch { fail("service_role_materialization_backfill_json_invalid"); }
      }
    }
    fail("service_role_materialization_backfill_json_invalid");
  };
  const value = (): void => {
    whitespace();
    if (source[offset] === "{") {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (source[offset] === "}") { offset += 1; return; }
      for (;;) {
        whitespace();
        const key = stringValue();
        if (keys.has(key)) fail("service_role_materialization_backfill_duplicate_key");
        keys.add(key);
        whitespace();
        if (source[offset++] !== ":") fail("service_role_materialization_backfill_json_invalid");
        value();
        whitespace();
        const separator = source[offset++];
        if (separator === "}") return;
        if (separator !== ",") fail("service_role_materialization_backfill_json_invalid");
      }
    }
    if (source[offset] === "[") {
      offset += 1;
      whitespace();
      if (source[offset] === "]") { offset += 1; return; }
      for (;;) {
        value();
        whitespace();
        const separator = source[offset++];
        if (separator === "]") return;
        if (separator !== ",") fail("service_role_materialization_backfill_json_invalid");
      }
    }
    if (source[offset] === "\"") { stringValue(); return; }
    const match = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/u.exec(source.slice(offset));
    if (!match) fail("service_role_materialization_backfill_json_invalid");
    offset += match[0].length;
  };
  value();
  whitespace();
  if (offset !== source.length) fail("service_role_materialization_backfill_json_invalid");
  try { return JSON.parse(source) as unknown; }
  catch { return fail("service_role_materialization_backfill_json_invalid"); }
}

function parseBackfill(value: unknown): ServiceRoleLocalEvidenceBackfillV1 {
  const body = record(value, "service_role_materialization_backfill_invalid");
  exactKeys(body, [
    "schemaVersion", "runId", "snapshotHash", "addressHistoryManifestSha256",
    "sampledCanonicalEventIds", "entries"
  ], "service_role_materialization_backfill_invalid");
  if (body.schemaVersion !== "service-role-local-evidence-backfill-v1") fail("service_role_materialization_backfill_invalid");
  uuid(body.runId, "service_role_materialization_backfill_invalid");
  hash(body.snapshotHash, "service_role_materialization_backfill_invalid");
  hash(body.addressHistoryManifestSha256, "service_role_materialization_backfill_invalid");
  if (!Array.isArray(body.sampledCanonicalEventIds) || body.sampledCanonicalEventIds.length !== 200 ||
    body.sampledCanonicalEventIds.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(body.sampledCanonicalEventIds).size !== body.sampledCanonicalEventIds.length ||
    !Array.isArray(body.entries) || body.entries.length > 200) {
    fail("service_role_materialization_backfill_invalid");
  }
  const entries = body.entries.map((entry) => {
    const item = record(entry, "service_role_materialization_backfill_invalid");
    exactKeys(item, [
      "canonicalEventId", "transactionInfoEvidenceId", "transactionInfoPayloadSha256",
      "transactionInfoFinalityWitnessSha256", "poisoningEvidenceSha256", "providerRiskEvidenceSha256"
    ], "service_role_materialization_backfill_invalid");
    if (typeof item.canonicalEventId !== "string" || item.canonicalEventId.length === 0 ||
      typeof item.transactionInfoEvidenceId !== "string" || item.transactionInfoEvidenceId.length === 0) {
      fail("service_role_materialization_backfill_invalid");
    }
    hash(item.transactionInfoPayloadSha256, "service_role_materialization_backfill_invalid");
    hash(item.transactionInfoFinalityWitnessSha256, "service_role_materialization_backfill_invalid");
    hash(item.poisoningEvidenceSha256, "service_role_materialization_backfill_invalid");
    hash(item.providerRiskEvidenceSha256, "service_role_materialization_backfill_invalid");
    return item as ServiceRoleLocalEvidenceBackfillV1["entries"][number];
  });
  if (new Set(entries.map((entry) => entry.canonicalEventId)).size !== entries.length) {
    fail("service_role_materialization_backfill_invalid");
  }
  return {
    schemaVersion: "service-role-local-evidence-backfill-v1",
    runId: body.runId as string,
    snapshotHash: body.snapshotHash as string,
    addressHistoryManifestSha256: body.addressHistoryManifestSha256 as string,
    sampledCanonicalEventIds: body.sampledCanonicalEventIds as string[],
    entries
  };
}

export async function readServiceRoleLocalEvidenceBackfill(path: string): Promise<ServiceRoleLocalEvidenceBackfillV1> {
  const absolute = resolve(path);
  const pathStatus = await lstat(absolute, { bigint: true })
    .catch(() => fail("service_role_materialization_backfill_file_invalid"));
  if (!pathStatus.isFile() || pathStatus.isSymbolicLink() || pathStatus.size > BigInt(MAX_BACKFILL_BYTES)) {
    fail("service_role_materialization_backfill_file_invalid");
  }
  const handle = await open(absolute, "r")
    .catch(() => fail("service_role_materialization_backfill_file_invalid"));
  try {
    const openedStatus = await handle.stat({ bigint: true });
    if (!openedStatus.isFile() || openedStatus.dev !== pathStatus.dev || openedStatus.ino !== pathStatus.ino ||
      openedStatus.size > BigInt(MAX_BACKFILL_BYTES)) {
      fail("service_role_materialization_backfill_file_invalid");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_BACKFILL_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_BACKFILL_BYTES) fail("service_role_materialization_backfill_file_invalid");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const currentStatus = await lstat(absolute, { bigint: true });
    if (!currentStatus.isFile() || currentStatus.isSymbolicLink() ||
      currentStatus.dev !== openedStatus.dev || currentStatus.ino !== openedStatus.ino) {
      fail("service_role_materialization_backfill_file_invalid");
    }
    return parseBackfill(parseJsonWithoutDuplicateKeys(Buffer.concat(chunks, total).toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("service_role_materialization_backfill_")) throw error;
    return fail("service_role_materialization_backfill_file_invalid");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function parseServiceRoleMaterializationArgs(argv: readonly string[]): {
  mode: "audit" | "materialize";
  runId: string;
  manifestSha256: string;
  anchor: string;
  evidenceBackfillPath: string | null;
} {
  const mode = argv[0];
  if (mode !== "audit" && mode !== "materialize") fail("service_role_materialization_args_invalid");
  const values = new Map<string, string>();
  let confirmed = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--confirm") {
      if (confirmed) fail("service_role_materialization_args_invalid");
      confirmed = true;
      continue;
    }
    if (!["--run", "--manifest", "--anchor", "--evidence-backfill"].includes(argument) || values.has(argument)) {
      fail("service_role_materialization_args_invalid");
    }
    const next = argv[++index];
    if (next === undefined || next.startsWith("--")) fail("service_role_materialization_args_invalid");
    values.set(argument, next);
  }
  if ((mode === "materialize") !== confirmed || values.size < 3 || values.size > 4) {
    fail("service_role_materialization_args_invalid");
  }
  return {
    mode,
    runId: uuid(values.get("--run"), "service_role_materialization_args_invalid"),
    manifestSha256: hash(values.get("--manifest"), "service_role_materialization_args_invalid"),
    anchor: exactTimestamp(values.get("--anchor") ?? "", "service_role_materialization_args_invalid"),
    evidenceBackfillPath: values.get("--evidence-backfill") ?? null
  };
}

function reviveEvent(value: unknown): IndexedTronUsdtTransfer {
  const row = record(value, "service_role_materialization_page_invalid");
  if (typeof row.blockTimestamp !== "string") fail("service_role_materialization_page_invalid");
  const blockTimestamp = new Date(row.blockTimestamp);
  if (Number.isNaN(blockTimestamp.getTime()) || blockTimestamp.toISOString() !== row.blockTimestamp) {
    fail("service_role_materialization_page_invalid");
  }
  return { ...row, blockTimestamp } as IndexedTronUsdtTransfer;
}

function validState(value: unknown): value is TraversalStateV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<TraversalStateV1>;
  return typeof state.address === "string" && state.address.length > 0 &&
    (state.direction === "backward" || state.direction === "forward") &&
    typeof state.anchorTimestamp === "string" &&
    Number.isFinite(Date.parse(state.anchorTimestamp)) && new Date(Date.parse(state.anchorTimestamp)).toISOString() === state.anchorTimestamp &&
    typeof state.fundingEpisodeId === "string" && state.fundingEpisodeId.length > 0 &&
    typeof state.allocatedAmountRaw === "string" && RAW.test(state.allocatedAmountRaw) &&
    Array.isArray(state.sourceEventIds) && state.sourceEventIds.length > 0 &&
    state.sourceEventIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(state.sourceEventIds).size === state.sourceEventIds.length;
}

async function artifactRows(db: ServiceRoleMaterializationQueryable, hashes: readonly string[]): Promise<Map<string, any>> {
  if (hashes.length === 0) return new Map();
  const result = await db.query(
    `select sha256,created_by_run_id,kind,schema_version,artifact_json
       from unified_check_artifacts where sha256=any($1::text[])`,
    [hashes]
  );
  return new Map(result.rows.map((row) => [String(row.sha256), row]));
}

function validateArtifactRow(row: any, input: {
  sha256: string;
  runId: string;
  kind: string;
  schemaVersion?: string;
}): unknown {
  if (!row || String(row.sha256) !== input.sha256 || String(row.created_by_run_id) !== input.runId ||
    String(row.kind) !== input.kind || (input.schemaVersion !== undefined && String(row.schema_version) !== input.schemaVersion) ||
    fingerprintCanonicalArtifact(row.artifact_json) !== input.sha256) {
    fail("service_role_materialization_artifact_invalid");
  }
  return row.artifact_json;
}

async function loadTraversalStates(db: ServiceRoleMaterializationQueryable, input: {
  runId: string;
  analysisManifestSha256: string;
  snapshotHash: string;
  lock: boolean;
}): Promise<TraversalStateV1[]> {
  const tasks = await db.query(
    `select id,checkpoint_json from unified_check_tasks
      where run_id=$1 and kind='traversal'${input.lock ? " for share" : ""}`,
    [input.runId]
  );
  if (tasks.rows.length !== 1) fail("service_role_materialization_traversal_invalid");
  const checkpoint = record(tasks.rows[0].checkpoint_json, "service_role_materialization_traversal_invalid");
  if (checkpoint.version !== "unified-production-traversal-checkpoint-v2" ||
    checkpoint.analysisManifestHash !== input.analysisManifestSha256 || checkpoint.snapshotHash !== input.snapshotHash ||
    typeof checkpoint.compactionSha256 !== "string" || !HASH.test(checkpoint.compactionSha256) ||
    !(checkpoint.deltaHeadSha256 === null || typeof checkpoint.deltaHeadSha256 === "string" && HASH.test(checkpoint.deltaHeadSha256))) {
    fail("service_role_materialization_traversal_invalid");
  }
  const compactionRows = await artifactRows(db, [checkpoint.compactionSha256]);
  const compaction = validateArtifactRow(compactionRows.get(checkpoint.compactionSha256), {
    sha256: checkpoint.compactionSha256,
    runId: input.runId,
    kind: "traversal_compaction_v2",
    schemaVersion: "1"
  }) as TraversalCompactionArtifactV2;
  if (compaction.version !== "unified-traversal-compaction-v2" ||
    compaction.analysisManifestHash !== input.analysisManifestSha256 || compaction.snapshotHash !== input.snapshotHash ||
    !Array.isArray(compaction.frontier) || !Array.isArray(compaction.visited)) {
    fail("service_role_materialization_traversal_invalid");
  }
  const deltaRows = await db.query(
    `select sha256,created_by_run_id,kind,schema_version,artifact_json
       from unified_check_artifacts where created_by_run_id=$1 and kind='traversal_delta'`,
    [input.runId]
  );
  const byHash = new Map(deltaRows.rows.map((row) => [String(row.sha256), row]));
  const reversed: TraversalDeltaArtifactV1[] = [];
  const seen = new Set<string>();
  let current = checkpoint.deltaHeadSha256 as string | null;
  while (current !== null) {
    if (seen.has(current) || reversed.length >= MAX_TRAVERSAL_DELTAS) fail("service_role_materialization_traversal_invalid");
    seen.add(current);
    const artifact = validateArtifactRow(byHash.get(current), {
      sha256: current,
      runId: input.runId,
      kind: "traversal_delta",
      schemaVersion: "1"
    }) as TraversalDeltaArtifactV1;
    if (artifact.version !== "unified-traversal-delta-v1" || !Array.isArray(artifact.addedFrontier) || !Array.isArray(artifact.addedVisited)) {
      fail("service_role_materialization_traversal_invalid");
    }
    reversed.push(artifact);
    current = artifact.previousDeltaHash;
  }
  const deltas = reversed.reverse();
  const persistedStates = [
    ...compaction.frontier, ...compaction.visited,
    ...deltas.flatMap((delta) => [...delta.addedFrontier, ...delta.addedVisited])
  ];
  if (persistedStates.some((state) => !validState(state))) fail("service_role_materialization_traversal_invalid");
  let replayed: ReturnType<typeof replayTraversalDeltas>;
  try {
    replayed = replayTraversalDeltas(deltas, {
      frontier: compaction.frontier,
      visited: compaction.visited,
      terminals: compaction.terminals,
      supersededStateIds: compaction.supersededStateIds,
      expandedStateIds: compaction.expandedStateIds,
      eligibleEventIds: compaction.eligibleEventIds,
      expandedStateKeys: compaction.expandedStateKeys
    });
  } catch { fail("service_role_materialization_traversal_invalid"); }
  const states = [...replayed.frontier, ...replayed.visited];
  return [...new Map(states.map((state) => [traversalStateId(state), state])).values()];
}

export async function loadServiceRoleMaterializationSource(
  db: ServiceRoleMaterializationQueryable,
  command: Pick<ServiceRoleMaterializationCommand, "runId" | "manifestSha256" | "anchor">,
  lock: boolean
) {
  const accepted = await db.query(
    `select r.subject_address,r.analysis_manifest_sha256,
            analysis.kind analysis_kind,analysis.schema_version analysis_schema_version,
            analysis.artifact_json analysis_json,
            task.id task_id,task.status task_status,task.logical_key,task.accepted_attempt_id,
            attempt.artifact_sha256,
            manifest.created_by_run_id manifest_creator,manifest.kind manifest_kind,
            manifest.schema_version manifest_schema_version,manifest.artifact_json manifest_json
       from unified_check_runs r
       join unified_check_artifacts analysis on analysis.sha256=r.analysis_manifest_sha256
       join unified_check_artifacts manifest on manifest.sha256=$2
       join unified_check_attempts attempt on attempt.artifact_sha256=manifest.sha256
       join unified_check_tasks task on task.id=attempt.task_id and task.accepted_attempt_id=attempt.id
      where r.id=$1 and task.run_id=r.id and task.kind='address_history'
      ${lock ? "for share of r,task,attempt" : ""}`,
    [command.runId, command.manifestSha256]
  );
  if (accepted.rows.length !== 1) fail("service_role_materialization_accepted_history_invalid");
  const row = accepted.rows[0];
  if (row.task_status !== "COMPLETED" || row.artifact_sha256 !== command.manifestSha256 ||
    row.manifest_creator !== command.runId || row.manifest_kind !== "address_history_manifest" || row.manifest_schema_version !== "1" ||
    fingerprintCanonicalArtifact(row.manifest_json) !== command.manifestSha256 ||
    row.analysis_kind !== "analysis_manifest" || row.analysis_schema_version !== "1" ||
    fingerprintCanonicalArtifact(row.analysis_json) !== row.analysis_manifest_sha256) {
    fail("service_role_materialization_accepted_history_invalid");
  }
  const manifest = row.manifest_json as AddressHistoryManifestV1;
  let analysis: ReturnType<typeof parseAnalysisManifestV1>;
  try {
    analysis = parseAnalysisManifestV1(row.analysis_json, {
      runId: command.runId,
      subjectAddress: String(row.subject_address),
      snapshotHash: manifest.snapshotHash
    });
  } catch {
    fail("service_role_materialization_accepted_history_invalid");
  }
  if (analysis.snapshotHash !== manifest.snapshotHash || manifest.version !== "unified-address-history-manifest-v1" ||
    manifest.schemaVersion !== 1 || manifest.key !== row.logical_key || manifest.key !== addressHistoryManifestKey(manifest) ||
    !Array.isArray(manifest.pageArtifactHashes) || manifest.pageArtifactHashes.length === 0 ||
    manifest.pageArtifactHashes.length > MAX_HISTORY_PAGES || new Set(manifest.pageArtifactHashes).size !== manifest.pageArtifactHashes.length ||
    manifest.pageArtifactHashes.some((value) => !HASH.test(value)) || !HASH.test(manifest.eventInventorySha256)) {
    fail("service_role_materialization_accepted_history_invalid");
  }
  const pagesByHash = await artifactRows(db, manifest.pageArtifactHashes);
  if (pagesByHash.size !== manifest.pageArtifactHashes.length) fail("service_role_materialization_page_invalid");
  const events = new Map<string, IndexedTronUsdtTransfer>();
  let rawRowCount = 0;
  let observedEventCount = 0;
  for (const pageSha256 of manifest.pageArtifactHashes) {
    const page = validateArtifactRow(pagesByHash.get(pageSha256), {
      sha256: pageSha256,
      runId: command.runId,
      kind: "address_history_page",
      schemaVersion: "1"
    }) as UnifiedAddressHistoryPageArtifactV1;
    if (page.version !== "unified-address-history-page-v1" || page.schemaVersion !== 1 || page.runId !== command.runId ||
      page.manifestKey !== manifest.key || !HASH.test(page.providerPageHash) ||
      !Number.isSafeInteger(page.rawRowCount) || page.rawRowCount < 0 || !Array.isArray(page.events)) {
      fail("service_role_materialization_page_invalid");
    }
    rawRowCount += page.rawRowCount;
    for (const serialized of page.events) {
      observedEventCount += 1;
      if (observedEventCount > MAX_HISTORY_EVENTS) fail("service_role_materialization_page_invalid");
      const item = reviveEvent(serialized);
      const id = canonicalTronUsdtEventKey(item);
      const prior = events.get(id);
      if (prior && fingerprintCanonicalArtifact({ ...prior, blockTimestamp: prior.blockTimestamp.toISOString() }) !== fingerprintCanonicalArtifact(serialized)) {
        fail("service_role_materialization_page_invalid");
      }
      events.set(id, item);
    }
  }
  const canonicalIds = [...events.keys()].sort();
  const duplicateCount = Math.max(observedEventCount - canonicalIds.length, rawRowCount - canonicalIds.length);
  if (rawRowCount !== manifest.rawRowCount || canonicalIds.length !== manifest.canonicalEventCount ||
    duplicateCount !== manifest.duplicateCount || fingerprintCanonicalArtifact(canonicalIds) !== manifest.eventInventorySha256) {
    fail("service_role_materialization_inventory_invalid");
  }
  const exhaustionRows = await artifactRows(db, [manifest.exhaustion.evidenceSha256]);
  const exhaustion = record(validateArtifactRow(exhaustionRows.get(manifest.exhaustion.evidenceSha256), {
    sha256: manifest.exhaustion.evidenceSha256,
    runId: command.runId,
    kind: "address_history_exhaustion",
    schemaVersion: "1"
  }), "service_role_materialization_inventory_invalid");
  exactKeys(exhaustion, [
    "version", "manifestKey", "snapshotHash", "address", "pageArtifactHashes", "reachedAccountCreation"
  ], "service_role_materialization_inventory_invalid");
  if (manifest.exhaustion.kind !== "account_creation_reached" ||
    exhaustion.version !== "unified-address-history-exhaustion-v1" || exhaustion.manifestKey !== manifest.key ||
    exhaustion.snapshotHash !== manifest.snapshotHash || exhaustion.address !== manifest.address ||
    exhaustion.reachedAccountCreation !== true ||
    canonicalizeArtifactJson(exhaustion.pageArtifactHashes) !== canonicalizeArtifactJson(manifest.pageArtifactHashes)) {
    fail("service_role_materialization_inventory_invalid");
  }

  const states = await loadTraversalStates(db, {
    runId: command.runId,
    analysisManifestSha256: row.analysis_manifest_sha256,
    snapshotHash: manifest.snapshotHash,
    lock
  });
  const acceptedHistory = {
    manifestKey: manifest.key,
    manifestSha256: command.manifestSha256,
    pageArtifactHashes: manifest.pageArtifactHashes,
    events: [...events.values()]
  };
  const exactStates = states.filter((state) => state.address === manifest.address && state.anchorTimestamp === command.anchor)
    .filter((state) => {
      const shadow = maybeBuildServiceRoleShadowArtifactV1({
        mode: "service-role-shadow-100-plus-100-v1",
        runId: command.runId,
        snapshotHash: manifest.snapshotHash,
        subjectAddress: row.subject_address,
        state,
        acceptedHistory,
        eventRoleMap: null
      });
      return shadow?.artifact.result.insufficientReason === "role_map_missing" &&
        shadow.artifact.sampledCanonicalEventIds.recent.length === 100 &&
        shadow.artifact.sampledCanonicalEventIds.historical.length === 100;
    });
  if (exactStates.length === 0) fail("service_role_materialization_traversal_state_conflict");
  return {
    runId: command.runId,
    snapshotHash: manifest.snapshotHash,
    subjectAddress: String(row.subject_address),
    manifest,
    acceptedHistory,
    states: exactStates
  };
}

export type ServiceRoleMaterializationSource = Awaited<
  ReturnType<typeof loadServiceRoleMaterializationSource>
>;

async function buildMaterialization(db: ServiceRoleMaterializationQueryable, command: ServiceRoleMaterializationCommand, lock: boolean): Promise<Materialization> {
  const source = await loadServiceRoleMaterializationSource(db, command, lock);
  const shadowInputs = source.states.map((state) => ({
    mode: "service-role-shadow-100-plus-100-v1" as const,
    runId: source.runId,
    snapshotHash: source.snapshotHash,
    subjectAddress: source.subjectAddress,
    state,
    acceptedHistory: source.acceptedHistory
  }));
  const shadows = shadowInputs.map((shadowInput) =>
    maybeBuildServiceRoleShadowArtifactV1({ ...shadowInput, eventRoleMap: null }));
  if (shadows.some((shadow) => !shadow || shadow.artifact.result.insufficientReason !== "role_map_missing")) {
    fail("service_role_materialization_source_invalid");
  }
  const shadow = shadows[0]!;
  const sampledIds = [...shadow.artifact.sampledCanonicalEventIds.recent, ...shadow.artifact.sampledCanonicalEventIds.historical];
  const sampleIdentity = fingerprintCanonicalArtifact(shadow.artifact.sampledCanonicalEventIds);
  if (shadows.some((item) => fingerprintCanonicalArtifact(item!.artifact.sampledCanonicalEventIds) !== sampleIdentity)) {
    fail("service_role_materialization_traversal_state_conflict");
  }
  const events = new Map(source.acceptedHistory.events.map((item) => [canonicalTronUsdtEventKey(item), item]));

  let captureManifest: { sha256: string; artifact: ServiceRoleExactEvidenceCaptureManifestV1 };
  try {
    captureManifest = buildServiceRoleExactEvidenceCaptureManifestV1({
      runId: source.runId,
      snapshotHash: source.snapshotHash,
      subjectAddress: source.subjectAddress,
      states: source.states,
      anchor: command.anchor,
      acceptedHistory: source.acceptedHistory
    });
  } catch {
    fail("service_role_materialization_capture_conflict");
  }

  const receiptRows = await db.query(
    `select sha256,created_by_run_id,kind,schema_version,artifact_json
       from unified_check_artifacts
      where created_by_run_id=$1
        and kind='service_role_exact_evidence_capture'
        and artifact_json->>'addressHistoryManifestSha256'=$2
        and artifact_json->>'captureManifestSha256'=$3
      order by sha256`,
    [source.runId, command.manifestSha256, captureManifest.sha256]
  );
  if (receiptRows.rows.length === 0) return materializeAcrossStates(shadowInputs, []);
  if (receiptRows.rows.length !== 1) fail("service_role_materialization_capture_conflict");

  let receipt: { sha256: string; artifact: ServiceRoleExactEvidenceCaptureReceiptV1 };
  try {
    const row = receiptRows.rows[0];
    receipt = {
      sha256: String(row.sha256),
      artifact: validateArtifactRow(row, {
        sha256: String(row.sha256),
        runId: source.runId,
        kind: "service_role_exact_evidence_capture",
        schemaVersion: "1"
      }) as ServiceRoleExactEvidenceCaptureReceiptV1
    };
    if (receipt.artifact.captureManifestSha256 !== captureManifest.sha256 ||
      receipt.artifact.runId !== source.runId || receipt.artifact.snapshotHash !== source.snapshotHash ||
      receipt.artifact.addressHistoryManifestSha256 !== command.manifestSha256 ||
      canonicalizeArtifactJson(receipt.artifact.sampledCanonicalEventIds) !== canonicalizeArtifactJson(sampledIds)) {
      fail("service_role_materialization_capture_conflict");
    }
    const manifestRows = await artifactRows(db, [receipt.artifact.captureManifestSha256]);
    const storedManifest = validateArtifactRow(manifestRows.get(receipt.artifact.captureManifestSha256), {
      sha256: receipt.artifact.captureManifestSha256,
      runId: source.runId,
      kind: "service_role_exact_evidence_capture_manifest",
      schemaVersion: "1"
    });
    if (canonicalizeArtifactJson(storedManifest) !== canonicalizeArtifactJson(captureManifest.artifact)) {
      fail("service_role_materialization_capture_conflict");
    }
  } catch {
    fail("service_role_materialization_capture_conflict");
  }

  if (!Array.isArray(receipt.artifact.entries) || receipt.artifact.entries.length !== sampledIds.length) {
    fail("service_role_materialization_capture_conflict");
  }
  const receiptEntries = new Map(receipt.artifact.entries.map((entry) => [entry.canonicalEventId, entry]));
  if (receiptEntries.size !== sampledIds.length || sampledIds.some((id) => !receiptEntries.has(id))) {
    fail("service_role_materialization_capture_conflict");
  }
  const dispositionHashes = receipt.artifact.entries.flatMap((entry) => [
    entry.poisoningDispositionSha256,
    entry.providerRiskDispositionSha256
  ]);
  if (dispositionHashes.some((value) => typeof value !== "string" || !HASH.test(value))) {
    fail("service_role_materialization_capture_conflict");
  }
  const dispositionRows = await artifactRows(db, dispositionHashes);
  const poisoning = new Map<string, { sha256: string; artifact: ServiceRolePoisoningDispositionV1 }>();
  const providerRisk = new Map<string, { sha256: string; artifact: ServiceRoleProviderRiskDispositionV1 }>();
  try {
    for (const entry of receipt.artifact.entries) {
      poisoning.set(entry.canonicalEventId, {
        sha256: entry.poisoningDispositionSha256,
        artifact: validateArtifactRow(dispositionRows.get(entry.poisoningDispositionSha256), {
          sha256: entry.poisoningDispositionSha256,
          runId: source.runId,
          kind: "service_role_poisoning_disposition",
          schemaVersion: "1"
        }) as ServiceRolePoisoningDispositionV1
      });
      providerRisk.set(entry.canonicalEventId, {
        sha256: entry.providerRiskDispositionSha256,
        artifact: validateArtifactRow(dispositionRows.get(entry.providerRiskDispositionSha256), {
          sha256: entry.providerRiskDispositionSha256,
          runId: source.runId,
          kind: "service_role_provider_risk_disposition",
          schemaVersion: "1"
        }) as ServiceRoleProviderRiskDispositionV1
      });
    }
  } catch {
    fail("service_role_materialization_capture_conflict");
  }

  const transactionEvidence = new Map<string, TronTransactionProviderEvidenceV1>();
  for (const event of captureManifest.artifact.events) {
    const evidence = await getTransactionProviderEvidence(db as any, {
      version: "tron-transaction-provider-evidence-v1",
      chain: "tron",
      txHash: event.txHash,
      provider: "tronscan",
      endpoint: "transaction-info",
      providerSchemaVersion: 1
    });
    if (evidence) transactionEvidence.set(event.txHash, evidence as TronTransactionProviderEvidenceV1);
  }
  try {
    validateServiceRoleExactEvidenceCaptureReceiptV1({
      manifest: captureManifest,
      receipt,
      acceptedEvents: source.acceptedHistory.events,
      transactionEvidence,
      poisoning,
      providerRisk
    });
  } catch {
    fail("service_role_materialization_capture_conflict");
  }

  if (command.backfill !== null) {
    const backfill = parseBackfill(command.backfill);
    const expectedBackfill: ServiceRoleLocalEvidenceBackfillV1 = {
      schemaVersion: "service-role-local-evidence-backfill-v1",
      runId: receipt.artifact.runId,
      snapshotHash: receipt.artifact.snapshotHash,
      addressHistoryManifestSha256: receipt.artifact.addressHistoryManifestSha256,
      sampledCanonicalEventIds: receipt.artifact.sampledCanonicalEventIds,
      entries: receipt.artifact.entries.map((entry) => ({
        canonicalEventId: entry.canonicalEventId,
        transactionInfoEvidenceId: entry.transactionInfoEvidenceId,
        transactionInfoPayloadSha256: entry.transactionInfoPayloadSha256,
        transactionInfoFinalityWitnessSha256: entry.transactionInfoFinalityWitnessSha256,
        poisoningEvidenceSha256: entry.poisoningDispositionSha256,
        providerRiskEvidenceSha256: entry.providerRiskDispositionSha256
      }))
    };
    if (canonicalizeArtifactJson(backfill) !== canonicalizeArtifactJson(expectedBackfill)) {
      fail("service_role_materialization_backfill_binding_invalid");
    }
  }

  const localEvidence: Array<Parameters<typeof materializeServiceRoleEventMapV1>[0]["localEvidence"][number]> = [];
  for (const canonicalEventId of sampledIds) {
    const item = events.get(canonicalEventId);
    if (!item) fail("service_role_materialization_capture_conflict");
    const entry = receiptEntries.get(canonicalEventId)!;
    const evidence = transactionEvidence.get(item.txHash.toLowerCase()) ?? null;
    localEvidence.push({
      canonicalEventId,
      transactionInfo: evidence ? { id: entry.transactionInfoEvidenceId, evidence } : null,
      poisoning: poisoning.get(canonicalEventId) ?? null,
      providerRisk: providerRisk.get(canonicalEventId) ?? null
    });
  }
  return materializeAcrossStates(shadowInputs, localEvidence);
}

function materializeAcrossStates(
  shadowInputs: readonly Parameters<typeof materializeServiceRoleEventMapV1>[0]["shadowInput"][],
  localEvidence: Parameters<typeof materializeServiceRoleEventMapV1>[0]["localEvidence"]
): Materialization {
  const materializations = shadowInputs.map((shadowInput) => materializeServiceRoleEventMapV1({ shadowInput, localEvidence }));
  const first = materializations[0]!;
  const coverageIdentity = fingerprintCanonicalArtifact({ ...first.coverage, traversalStateIds: [] });
  if (materializations.some((item) =>
    fingerprintCanonicalArtifact({ ...item.coverage, traversalStateIds: [] }) !== coverageIdentity ||
    item.bundle?.sha256 !== first.bundle?.sha256 || item.map?.sha256 !== first.map?.sha256)) {
    fail("service_role_materialization_traversal_state_conflict");
  }
  return {
    ...first,
    coverage: {
      ...first.coverage,
      traversalStateIds: [...new Set(materializations.flatMap((item) => item.coverage.traversalStateIds))].sort()
    }
  };
}

async function assertExistingArtifacts(db: ServiceRoleMaterializationQueryable, command: ServiceRoleMaterializationCommand, result: Materialization): Promise<void> {
  const rows = await db.query(
    `select sha256,created_by_run_id,kind,schema_version,artifact_json
       from unified_check_artifacts
      where kind in ('service_role_event_role_map','service_role_event_evidence_bundle')
        and artifact_json->>'runId'=$1
        and artifact_json->>'addressHistoryManifestSha256'=$2
      order by kind,sha256`,
    [command.runId, command.manifestSha256]
  );
  const maps = rows.rows.filter((row) => row.kind === "service_role_event_role_map");
  const bundles = rows.rows.filter((row) => row.kind === "service_role_event_evidence_bundle");
  if (maps.length > 1 || maps.some((row) => result.map === null || row.sha256 !== result.map.sha256) ||
    bundles.length > 1 || bundles.some((row) => result.bundle === null || row.sha256 !== result.bundle.sha256)) {
    fail("service_role_materialization_existing_map_conflict");
  }
  for (const row of rows.rows) {
    const expectedKind = row.kind === "service_role_event_role_map" ? "service_role_event_role_map" : "service_role_event_evidence_bundle";
    validateArtifactRow(row, { sha256: String(row.sha256), runId: command.runId, kind: expectedKind, schemaVersion: "1" });
  }
  if (rows.rows.length > 0) {
    const referenced = await db.query(
      "select count(*)::int count from unified_check_attempts where artifact_sha256=any($1::text[])",
      [rows.rows.map((row) => row.sha256)]
    );
    if (Number(referenced.rows[0]?.count) !== 0) fail("service_role_materialization_artifact_referenced");
  }
}

function resultOf(value: Materialization): ServiceRoleMaterializationRunResult {
  return {
    classification: value.bundle !== null && value.map !== null ? "complete" : "incomplete",
    coverage: value.coverage,
    evidenceBundleSha256: value.bundle?.sha256 ?? null,
    eventRoleMapSha256: value.map?.sha256 ?? null
  };
}

export async function runServiceRoleMapMaterialization(
  db: ServiceRoleMaterializationDatabase,
  command: ServiceRoleMaterializationCommand
): Promise<ServiceRoleMaterializationRunResult> {
  uuid(command.runId, "service_role_materialization_args_invalid");
  hash(command.manifestSha256, "service_role_materialization_args_invalid");
  exactTimestamp(command.anchor, "service_role_materialization_args_invalid");
  if (command.mode === "audit") {
    return db.transaction("read_only", async (tx) => {
      const materialization = await buildMaterialization(tx, command, false);
      await assertExistingArtifacts(tx, command, materialization);
      return resultOf(materialization);
    });
  }
  const initial = await buildMaterialization(db, command, false);
  await assertExistingArtifacts(db, command, initial);
  if (initial.bundle === null || initial.map === null) return resultOf(initial);
  return db.transaction("read_write", async (tx) => {
    const current = await buildMaterialization(tx, command, true);
    if (fingerprintCanonicalArtifact(current.coverage) !== fingerprintCanonicalArtifact(initial.coverage) ||
      current.bundle?.sha256 !== initial.bundle?.sha256 || current.map?.sha256 !== initial.map?.sha256 ||
      current.bundle === null || current.map === null) {
      fail("service_role_materialization_recheck_conflict");
    }
    await assertExistingArtifacts(tx, command, current);
    const bundleRow = await insertUnifiedArtifact(tx as UnifiedQueryable, {
      sha256: current.bundle.sha256,
      createdByRunId: command.runId,
      kind: "service_role_event_evidence_bundle",
      schemaVersion: "1",
      artifact: current.bundle.artifact
    });
    if (String(bundleRow.created_by_run_id) !== command.runId) fail("service_role_materialization_artifact_creator_conflict");
    const mapRow = await insertUnifiedArtifact(tx as UnifiedQueryable, {
      sha256: current.map.sha256,
      createdByRunId: command.runId,
      kind: "service_role_event_role_map",
      schemaVersion: "1",
      artifact: current.map.artifact as ServiceRoleShadowEventRoleMapV1
    });
    if (String(mapRow.created_by_run_id) !== command.runId) fail("service_role_materialization_artifact_creator_conflict");
    const referenced = await tx.query(
      "select count(*)::int count from unified_check_attempts where artifact_sha256=any($1::text[])",
      [[current.bundle.sha256, current.map.sha256]]
    );
    if (Number(referenced.rows[0]?.count) !== 0) fail("service_role_materialization_artifact_referenced");
    return resultOf(current);
  });
}

function pgDatabase(pool: pg.Pool): ServiceRoleMaterializationDatabase {
  return {
    query: (sql, values) => pool.query(sql, values as unknown[] | undefined),
    async transaction<T>(
      mode: "read_only" | "read_write",
      work: (tx: ServiceRoleMaterializationQueryable) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      const query = (sql: string, values?: readonly unknown[]) => client.query(sql, values as unknown[] | undefined);
      try {
        await client.query(mode === "read_only"
          ? "begin isolation level repeatable read read only"
          : "begin isolation level serializable read write");
        const value = await work({ query });
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function main(): Promise<void> {
  const parsed = parseServiceRoleMaterializationArgs(process.argv.slice(2));
  const backfill = parsed.evidenceBackfillPath === null
    ? null
    : await readServiceRoleLocalEvidenceBackfill(parsed.evidenceBackfillPath);
  if (!process.env.DATABASE_URL?.trim()) fail("service_role_materialization_database_url_missing");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const result = await runServiceRoleMapMaterialization(pgDatabase(pool), {
      mode: parsed.mode,
      runId: parsed.runId,
      manifestSha256: parsed.manifestSha256,
      anchor: parsed.anchor,
      backfill
    });
    process.stdout.write(`${canonicalizeArtifactJson(result.coverage)}\n`);
    process.exitCode = result.classification === "complete" ? 0 : 2;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "service_role_materialization_failed"}\n`);
    process.exitCode = 1;
  });
}
