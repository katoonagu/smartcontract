import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../src/forensics/tronAddressAllTimeIndex.js";
import {
  addressHistoryManifestKey,
  type AddressHistoryManifestV1
} from "../src/unifiedCheck/addressHistory.js";
import type { UnifiedAddressHistoryPageArtifactV1 } from "../src/unifiedCheck/productionAddressHistory.js";
import {
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowInsufficientReasonV1
} from "../src/unifiedCheck/serviceRoleShadow.js";
import { traversalStateId, type TraversalStateV1 } from "../src/unifiedCheck/traversal.js";
import {
  type TraversalCheckpointV2,
  type TraversalCompactionArtifactV2,
  type TraversalDeltaArtifactV1
} from "../src/unifiedCheck/traversalDelta.js";
import type { IndexedTronUsdtTransfer } from "../src/types.js";

const HASH = /^[0-9a-f]{64}$/u;

type QueryResult = { rows: Array<Record<string, unknown>> };
export type ServiceRoleShadowAuditQueryable = {
  query(sql: string, values?: readonly unknown[]): Promise<QueryResult>;
};

export type ServiceRoleShadowPrerequisiteReceiptV1 = {
  schemaVersion: "service-role-shadow-prerequisites-v1";
  acceptedHistories: number;
  reconstructedHistories: number;
  historiesWithRoleMap: number;
  fullyRoleBoundHistories: number;
  sampledEvents: number;
  roleBoundSampledEvents: number;
  failures: readonly {
    manifestSha256: string;
    reason: ServiceRoleShadowInsufficientReasonV1;
  }[];
};

type AcceptedHistory = {
  runId: string;
  subjectAddress: string;
  snapshotHash: string;
  analysisManifestSha256: string;
  manifestSha256: string;
  manifest: AddressHistoryManifestV1;
};

type ArtifactRow = {
  sha256: string;
  runId: string;
  kind: string;
  schemaVersion: string;
  artifact: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function artifactRow(value: Record<string, unknown>): ArtifactRow | null {
  const sha256 = value.sha256;
  const runId = value.created_by_run_id;
  const kind = value.kind;
  const schemaVersion = value.schema_version;
  if (
    typeof sha256 !== "string" || !HASH.test(sha256) ||
    typeof runId !== "string" || runId.length === 0 ||
    typeof kind !== "string" || typeof schemaVersion !== "string"
  ) return null;
  return {
    sha256,
    runId,
    kind,
    schemaVersion,
    artifact: value.artifact_json
  };
}

function state(value: unknown): TraversalStateV1 | null {
  const source = record(value);
  if (
    !source || typeof source.address !== "string" ||
    (source.direction !== "backward" && source.direction !== "forward") ||
    typeof source.anchorTimestamp !== "string" ||
    !Number.isFinite(Date.parse(source.anchorTimestamp)) ||
    new Date(source.anchorTimestamp).toISOString() !== source.anchorTimestamp ||
    typeof source.fundingEpisodeId !== "string" ||
    typeof source.allocatedAmountRaw !== "string" ||
    !/^(0|[1-9][0-9]*)$/u.test(source.allocatedAmountRaw) ||
    !Array.isArray(source.sourceEventIds) || source.sourceEventIds.length === 0 ||
    !source.sourceEventIds.every((id) => typeof id === "string" && id.length > 0)
  ) return null;
  return {
    address: source.address,
    direction: source.direction,
    anchorTimestamp: source.anchorTimestamp,
    fundingEpisodeId: source.fundingEpisodeId,
    allocatedAmountRaw: source.allocatedAmountRaw,
    sourceEventIds: source.sourceEventIds as string[]
  };
}

function indexedEvent(value: unknown): IndexedTronUsdtTransfer | null {
  const source = record(value);
  if (
    !source || typeof source.txHash !== "string" || source.txHash.length === 0 ||
    !Number.isSafeInteger(source.blockNumber) || Number(source.blockNumber) < 0 ||
    typeof source.blockTimestamp !== "string" ||
    !Number.isFinite(Date.parse(source.blockTimestamp)) ||
    new Date(source.blockTimestamp).toISOString() !== source.blockTimestamp ||
    !Number.isSafeInteger(source.eventIndex) || Number(source.eventIndex) < 0 ||
    typeof source.fromAddress !== "string" || typeof source.toAddress !== "string" ||
    typeof source.amountRaw !== "string" || !/^(0|[1-9][0-9]*)$/u.test(source.amountRaw) ||
    (source.method !== "transfer" && source.method !== "transferFrom") ||
    !(source.callerAddress === null || typeof source.callerAddress === "string") ||
    !(source.contractRet === null || typeof source.contractRet === "string") ||
    typeof source.confirmed !== "boolean"
  ) return null;
  return {
    ...(source as Omit<IndexedTronUsdtTransfer, "blockTimestamp">),
    blockTimestamp: new Date(source.blockTimestamp)
  };
}

function acceptedHistory(row: Record<string, unknown>): AcceptedHistory | null {
  const taskId = row.task_id;
  const logicalKey = row.logical_key;
  const attemptTaskId = row.attempt_task_id;
  const attemptArtifactSha256 = row.attempt_artifact_sha256;
  const runId = row.run_id;
  const subjectAddress = row.subject_address;
  const snapshotHash = row.snapshot_hash;
  const analysisManifestSha256 = row.analysis_manifest_sha256;
  const analysisManifest = record(row.analysis_manifest_json);
  const manifestSha256 = row.manifest_sha256;
  const manifest = record(row.manifest_json);
  if (
    typeof taskId !== "string" || taskId.length === 0 ||
    typeof logicalKey !== "string" || logicalKey.length === 0 ||
    attemptTaskId !== taskId ||
    typeof runId !== "string" || runId.length === 0 ||
    typeof subjectAddress !== "string" || subjectAddress.length === 0 ||
    typeof snapshotHash !== "string" || !HASH.test(snapshotHash) ||
    typeof analysisManifestSha256 !== "string" || !HASH.test(analysisManifestSha256) ||
    !analysisManifest || fingerprintCanonicalArtifact(analysisManifest) !== analysisManifestSha256 ||
    analysisManifest.version !== "analysis-manifest-v1" ||
    analysisManifest.runId !== runId || analysisManifest.subjectAddress !== subjectAddress ||
    analysisManifest.snapshotHash !== snapshotHash ||
    typeof manifestSha256 !== "string" || !HASH.test(manifestSha256) ||
    attemptArtifactSha256 !== manifestSha256 ||
    row.manifest_created_by_run_id !== runId ||
    row.manifest_kind !== "address_history_manifest" || row.manifest_schema_version !== "1" ||
    !manifest || fingerprintCanonicalArtifact(manifest) !== manifestSha256 ||
    manifest.version !== "unified-address-history-manifest-v1" || manifest.schemaVersion !== 1 ||
    manifest.snapshotHash !== snapshotHash || manifest.key !== logicalKey ||
    !Array.isArray(manifest.pageArtifactHashes)
  ) return null;
  try {
    if (manifest.key !== addressHistoryManifestKey({
      chain: manifest.chain as "tron",
      snapshotHash: String(manifest.snapshotHash),
      tokenContract: String(manifest.tokenContract),
      address: String(manifest.address),
      providerRequestVersion: String(manifest.providerRequestVersion)
    })) return null;
  } catch {
    return null;
  }
  return {
    runId,
    subjectAddress,
    snapshotHash,
    analysisManifestSha256,
    manifestSha256,
    manifest: manifest as AddressHistoryManifestV1
  };
}

async function loadRunStates(input: {
  db: ServiceRoleShadowAuditQueryable;
  runId: string;
  analysisManifestSha256: string;
  snapshotHash: string;
}): Promise<ReadonlyMap<string, readonly TraversalStateV1[]>> {
  const traversalTasks = (await input.db.query(
    `/* service_role_shadow:traversal_task */
     select checkpoint_json
       from unified_check_tasks
      where run_id = $1 and kind = 'traversal'
      order by logical_key
      limit 2`,
    [input.runId]
  )).rows;
  if (traversalTasks.length !== 1) return new Map();
  const checkpoint = record(traversalTasks[0]!.checkpoint_json) as
    TraversalCheckpointV2 | null;
  if (
    !checkpoint || checkpoint.version !== "unified-production-traversal-checkpoint-v2" ||
    checkpoint.analysisManifestHash !== input.analysisManifestSha256 ||
    checkpoint.snapshotHash !== input.snapshotHash ||
    typeof checkpoint.compactionSha256 !== "string" || !HASH.test(checkpoint.compactionSha256) ||
    !(checkpoint.deltaHeadSha256 === null ||
      (typeof checkpoint.deltaHeadSha256 === "string" && HASH.test(checkpoint.deltaHeadSha256)))
  ) return new Map();
  const compactionRows = (await input.db.query(
    `/* service_role_shadow:traversal_compaction */
     select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where sha256 = $1
        and created_by_run_id = $2
        and kind = 'traversal_compaction_v2'
        and schema_version = '1'
      limit 2`,
    [checkpoint.compactionSha256, input.runId]
  )).rows.map(artifactRow).filter((row): row is ArtifactRow => row !== null);
  if (compactionRows.length !== 1) return new Map();
  const compactionRow = compactionRows[0]!;
  const compaction = record(compactionRow?.artifact) as TraversalCompactionArtifactV2 | null;
  if (
    !compactionRow || compactionRow.runId !== input.runId ||
    compactionRow.kind !== "traversal_compaction_v2" || compactionRow.schemaVersion !== "1" ||
    fingerprintCanonicalArtifact(compactionRow.artifact) !== compactionRow.sha256 ||
    !compaction || compaction.version !== "unified-traversal-compaction-v2" ||
    compaction.analysisManifestHash !== input.analysisManifestSha256 ||
    compaction.snapshotHash !== input.snapshotHash
  ) return new Map();
  const baseStates = [...compaction.frontier, ...compaction.visited].map(state);
  if (baseStates.some((item) => item === null)) return new Map();
  try {
    const frontier = new Map((compaction.frontier as TraversalStateV1[])
      .map((item) => [traversalStateId(item), item]));
    const visited = new Map((compaction.visited as TraversalStateV1[])
      .map((item) => [traversalStateId(item), item]));
    const pageSize = 256;
    const deltaPages: Array<{ startSha256: string; count: number }> = [];
    const boundaryHashes = new Set<string>();
    let cursor = checkpoint.deltaHeadSha256;
    while (cursor !== null) {
      if (boundaryHashes.has(cursor)) return new Map();
      boundaryHashes.add(cursor);
      const links = (await input.db.query(
        `/* service_role_shadow:traversal_delta_discovery_page */
         with recursive chain as (
           select 1 as depth, artifact.sha256, artifact.created_by_run_id,
                  artifact.kind, artifact.schema_version,
                  artifact.artifact_json->>'previousDeltaHash' as previous_delta_hash,
                  array[artifact.sha256]::text[] as path
             from unified_check_artifacts artifact
            where artifact.sha256 = $1
              and artifact.created_by_run_id = $2
              and artifact.kind = 'traversal_delta'
              and artifact.schema_version = '1'
           union all
           select chain.depth + 1, previous.sha256,
                  previous.created_by_run_id, previous.kind,
                  previous.schema_version,
                  previous.artifact_json->>'previousDeltaHash',
                  chain.path || previous.sha256
             from chain
             join unified_check_artifacts previous
               on previous.sha256 = chain.previous_delta_hash
              and previous.created_by_run_id = $2
              and previous.kind = 'traversal_delta'
              and previous.schema_version = '1'
            where chain.depth < $3
              and not previous.sha256 = any(chain.path)
         )
         select sha256, previous_delta_hash
           from chain
          order by depth`,
        [cursor, input.runId, pageSize]
      )).rows;
      if (links.length === 0 || links.length > pageSize) return new Map();
      const startSha256 = cursor;
      let expectedSha256: string | null = cursor;
      for (const link of links) {
        if (link.sha256 !== expectedSha256) return new Map();
        const previous = link.previous_delta_hash;
        if (!(previous === null || (typeof previous === "string" && HASH.test(previous)))) {
          return new Map();
        }
        expectedSha256 = previous;
      }
      cursor = expectedSha256;
      if (links.length < pageSize && cursor !== null) return new Map();
      deltaPages.push({ startSha256, count: links.length });
    }

    let previousDeltaHash: string | null = null;
    for (const page of deltaPages.reverse()) {
      const rows: ArtifactRow[] = (await input.db.query(
        `/* service_role_shadow:traversal_delta_replay_page */
         with recursive chain as (
           select 1 as depth, artifact.sha256, artifact.created_by_run_id,
                  artifact.kind, artifact.schema_version,
                  artifact.artifact_json,
                  array[artifact.sha256]::text[] as path
             from unified_check_artifacts artifact
            where artifact.sha256 = $1
              and artifact.created_by_run_id = $2
              and artifact.kind = 'traversal_delta'
              and artifact.schema_version = '1'
           union all
           select chain.depth + 1, previous.sha256,
                  previous.created_by_run_id, previous.kind,
                  previous.schema_version, previous.artifact_json,
                  chain.path || previous.sha256
             from chain
             join unified_check_artifacts previous
               on previous.sha256 =
                 chain.artifact_json->>'previousDeltaHash'
              and previous.created_by_run_id = $2
              and previous.kind = 'traversal_delta'
              and previous.schema_version = '1'
            where chain.depth < $3
              and not previous.sha256 = any(chain.path)
         )
         select sha256, created_by_run_id, kind, schema_version, artifact_json
           from chain
          order by depth desc`,
        [page.startSha256, input.runId, pageSize]
      )).rows.map(artifactRow).filter((row): row is ArtifactRow => row !== null);
      if (rows.length !== page.count) return new Map();
      for (const row of rows) {
        const delta = record(row.artifact) as TraversalDeltaArtifactV1 | null;
        if (
          row.runId !== input.runId || row.kind !== "traversal_delta" ||
          row.schemaVersion !== "1" ||
          fingerprintCanonicalArtifact(row.artifact) !== row.sha256 ||
          !delta || delta.version !== "unified-traversal-delta-v1" ||
          delta.previousDeltaHash !== previousDeltaHash ||
          !Array.isArray(delta.addedFrontier) ||
          !Array.isArray(delta.removedFrontierStateIds) ||
          !delta.removedFrontierStateIds.every((id) => typeof id === "string") ||
          !Array.isArray(delta.addedVisited)
        ) return new Map();
        const addedFrontier = delta.addedFrontier.map(state);
        const addedVisited = delta.addedVisited.map(state);
        if (
          addedFrontier.some((item) => item === null) ||
          addedVisited.some((item) => item === null)
        ) return new Map();
        for (const stateId of delta.removedFrontierStateIds) frontier.delete(stateId);
        for (const item of addedFrontier as TraversalStateV1[]) {
          frontier.set(traversalStateId(item), item);
        }
        for (const item of addedVisited as TraversalStateV1[]) {
          visited.set(traversalStateId(item), item);
        }
        previousDeltaHash = row.sha256;
      }
    }
    if (previousDeltaHash !== checkpoint.deltaHeadSha256) return new Map();
    const byAddress = new Map<string, TraversalStateV1[]>();
    const candidates = new Map([...frontier, ...visited]);
    for (const item of candidates.values()) {
      const states = byAddress.get(item.address) ?? [];
      states.push(item);
      byAddress.set(item.address, states);
    }
    return byAddress;
  } catch {
    return new Map();
  }
}

function eventsFromPages(input: {
  history: AcceptedHistory;
  pageRows: readonly ArtifactRow[];
}): IndexedTronUsdtTransfer[] | null {
  const byHash = new Map(input.pageRows.map((row) => [row.sha256, row]));
  const events = new Map<string, { raw: unknown; event: IndexedTronUsdtTransfer }>();
  let rawRowCount = 0;
  for (const pageHash of input.history.manifest.pageArtifactHashes) {
    const row = byHash.get(pageHash);
    const page = record(row?.artifact) as UnifiedAddressHistoryPageArtifactV1 | null;
    if (
      !row || row.runId !== input.history.runId || row.kind !== "address_history_page" ||
      row.schemaVersion !== "1" || fingerprintCanonicalArtifact(row.artifact) !== pageHash ||
      !page || page.version !== "unified-address-history-page-v1" || page.schemaVersion !== 1 ||
      page.runId !== input.history.runId || page.manifestKey !== input.history.manifest.key ||
      !HASH.test(String(page.providerPageHash)) || !Number.isSafeInteger(page.rawRowCount) ||
      page.rawRowCount < 0 || !Array.isArray(page.events)
    ) return null;
    rawRowCount += page.rawRowCount;
    for (const value of page.events) {
      const parsed = indexedEvent(value);
      if (!parsed) return null;
      const id = canonicalTronUsdtEventKey(parsed);
      const prior = events.get(id);
      if (prior && fingerprintCanonicalArtifact(prior.raw) !==
        fingerprintCanonicalArtifact(value)) return null;
      if (!prior) events.set(id, { raw: value, event: parsed });
    }
  }
  const canonicalIds = [...events.keys()].sort();
  if (
    rawRowCount !== input.history.manifest.rawRowCount ||
    canonicalIds.length !== input.history.manifest.canonicalEventCount ||
    rawRowCount - canonicalIds.length !== input.history.manifest.duplicateCount ||
    fingerprintCanonicalArtifact(canonicalIds) !== input.history.manifest.eventInventorySha256
  ) return null;
  return canonicalIds.map((id) => events.get(id)!.event);
}

function boundRoleIds(input: {
  history: AcceptedHistory;
  row: ArtifactRow | null;
}): ReadonlySet<string> {
  const map = record(input.row?.artifact) as ServiceRoleShadowEventRoleMapV1 | null;
  if (
    !input.row || input.row.runId !== input.history.runId ||
    input.row.kind !== "service_role_event_role_map" || input.row.schemaVersion !== "1" ||
    fingerprintCanonicalArtifact(input.row.artifact) !== input.row.sha256 ||
    !map || map.schemaVersion !== "service-role-shadow-event-role-map-v1" ||
    map.runId !== input.history.runId || map.snapshotHash !== input.history.snapshotHash ||
    map.addressHistoryManifestSha256 !== input.history.manifestSha256 ||
    !Array.isArray(map.entries)
  ) return new Set();
  const ids = new Set<string>();
  for (const entry of map.entries) {
    if (
      !entry || typeof entry.canonicalEventId !== "string" || ids.has(entry.canonicalEventId) ||
      !["ordinary", "poisoning_only", "gasfree_fee", "gasfree_principal", "provider_risk"]
        .includes(entry.role) ||
      entry.authority !== "existing_hash_bound_economic_role_v1" ||
      !HASH.test(entry.evidenceSha256)
    ) return new Set();
    ids.add(entry.canonicalEventId);
  }
  return ids;
}

export async function auditServiceRoleShadowPrerequisitesV1(
  db: ServiceRoleShadowAuditQueryable
): Promise<ServiceRoleShadowPrerequisiteReceiptV1> {
  let reconstructedHistories = 0;
  let acceptedHistories = 0;
  let historiesWithRoleMap = 0;
  let fullyRoleBoundHistories = 0;
  let sampledEvents = 0;
  let roleBoundSampledEvents = 0;
  const failures: Array<{
    manifestSha256: string;
    reason: ServiceRoleShadowInsufficientReasonV1;
  }> = [];
  const acceptedPageSize = 64;
  const artifactBatchSize = 512;
  let cursorRunId = "";
  let cursorManifestSha256 = "";
  let cursorTaskId = "";
  let cachedStateKey: string | null = null;
  let cachedStates: ReadonlyMap<string, readonly TraversalStateV1[]> = new Map();
  while (true) {
    const acceptedRows = (await db.query(
      `/* service_role_shadow:accepted_histories */
       select task.id as task_id, task.logical_key,
              attempt.task_id as attempt_task_id,
              attempt.artifact_sha256 as attempt_artifact_sha256,
              task.run_id, run.subject_address,
              analysis.artifact_json->>'snapshotHash' as snapshot_hash,
              run.analysis_manifest_sha256,
              analysis.artifact_json as analysis_manifest_json,
              manifest.sha256 as manifest_sha256,
              manifest.created_by_run_id as manifest_created_by_run_id,
              manifest.kind as manifest_kind,
              manifest.schema_version as manifest_schema_version,
              manifest.artifact_json as manifest_json
         from unified_check_tasks task
         join unified_check_attempts attempt
           on attempt.id = task.accepted_attempt_id
          and attempt.task_id = task.id
         join unified_check_artifacts manifest
           on manifest.sha256 = attempt.artifact_sha256
          and manifest.created_by_run_id = task.run_id
          and manifest.kind = 'address_history_manifest'
          and manifest.schema_version = '1'
          and manifest.artifact_json->>'version' =
            'unified-address-history-manifest-v1'
          and manifest.artifact_json->>'schemaVersion' = '1'
          and manifest.artifact_json->>'key' = task.logical_key
         join unified_check_runs run on run.id = task.run_id
         join unified_check_artifacts analysis
           on analysis.sha256 = run.analysis_manifest_sha256
          and analysis.created_by_run_id = run.id
          and analysis.kind = 'analysis_manifest'
          and analysis.schema_version = '1'
          and analysis.artifact_json->>'version' = 'analysis-manifest-v1'
        where task.kind = 'address_history'
          and task.status = 'COMPLETED'
          and task.accepted_attempt_id is not null
          and (task.run_id, manifest.sha256, task.id) > ($1, $2, $3)
        order by task.run_id, manifest.sha256, task.id
        limit $4`,
      [cursorRunId, cursorManifestSha256, cursorTaskId, acceptedPageSize]
    )).rows;
    if (acceptedRows.length === 0) break;

    const work: Array<{
      history: AcceptedHistory;
      candidates: readonly TraversalStateV1[];
    }> = [];
    for (const raw of acceptedRows) {
      const history = acceptedHistory(raw);
      const fallbackHash = typeof raw.manifest_sha256 === "string" && HASH.test(raw.manifest_sha256)
        ? raw.manifest_sha256
        : fingerprintCanonicalArtifact(raw);
      if (!history) {
        failures.push({ manifestSha256: fallbackHash, reason: "source_binding_invalid" });
        continue;
      }
      acceptedHistories += 1;
      const stateKey = `${history.runId}\u0000${history.analysisManifestSha256}\u0000${history.snapshotHash}`;
      if (stateKey !== cachedStateKey) {
        cachedStates = await loadRunStates({
          db,
          runId: history.runId,
          analysisManifestSha256: history.analysisManifestSha256,
          snapshotHash: history.snapshotHash
        });
        cachedStateKey = stateKey;
      }
      const candidates = cachedStates.get(history.manifest.address) ?? [];
      if (candidates.length === 0) {
        failures.push({ manifestSha256: history.manifestSha256, reason: "anchor_unproven" });
        continue;
      }
      work.push({ history, candidates });
    }

    const pageBindings = work.flatMap(({ history }) =>
      history.manifest.pageArtifactHashes.map((sha256) => ({
        runId: history.runId,
        sha256
      }))
    );
    const pagesByHash = new Map<string, ArtifactRow>();
    for (let offset = 0; offset < pageBindings.length; offset += artifactBatchSize) {
      const bindings = pageBindings.slice(offset, offset + artifactBatchSize);
      const rows = (await db.query(
        `/* service_role_shadow:pages */
         with bindings as (
           select distinct run_id, sha256
             from jsonb_to_recordset($1::jsonb)
               as binding(run_id text, sha256 text)
         )
         select artifact.sha256, artifact.created_by_run_id, artifact.kind,
                artifact.schema_version, artifact.artifact_json
           from bindings
           join unified_check_artifacts artifact
             on artifact.sha256 = bindings.sha256
            and artifact.created_by_run_id = bindings.run_id
            and artifact.kind = 'address_history_page'
            and artifact.schema_version = '1'
          order by artifact.sha256`,
        [JSON.stringify(bindings.map((binding) => ({
          run_id: binding.runId,
          sha256: binding.sha256
        })))]
      )).rows.map(artifactRow).filter((row): row is ArtifactRow => row !== null);
      for (const row of rows) pagesByHash.set(row.sha256, row);
    }
    const roleBindings = [...new Map(work.map(({ history }) => [
      `${history.runId}\u0000${history.manifestSha256}`,
      { run_id: history.runId, manifest_sha256: history.manifestSha256 }
    ])).values()];
    const roleMapRows = roleBindings.length === 0 ? [] : (await db.query(
      `/* service_role_shadow:role_maps */
       with bindings as (
         select run_id, manifest_sha256
           from jsonb_to_recordset($1::jsonb)
             as binding(run_id text, manifest_sha256 text)
       ), ranked as (
         select artifact.sha256, artifact.created_by_run_id, artifact.kind,
                artifact.schema_version, artifact.artifact_json,
                row_number() over (
                  partition by bindings.run_id, bindings.manifest_sha256
                  order by artifact.sha256
                ) as ordinal
           from bindings
           join unified_check_artifacts artifact
             on artifact.created_by_run_id = bindings.run_id
            and artifact.kind = 'service_role_event_role_map'
            and artifact.schema_version = '1'
            and artifact.artifact_json->>'addressHistoryManifestSha256' =
              bindings.manifest_sha256
       )
       select sha256, created_by_run_id, kind, schema_version, artifact_json
         from ranked
        where ordinal <= 2
        order by created_by_run_id,
                 artifact_json->>'addressHistoryManifestSha256', sha256`,
      [JSON.stringify(roleBindings)]
    )).rows.map(artifactRow).filter((row): row is ArtifactRow => row !== null);
    const roleMapsByHistory = new Map<string, ArtifactRow[]>();
    for (const row of roleMapRows) {
      const manifestSha256 = record(row.artifact)?.addressHistoryManifestSha256;
      if (typeof manifestSha256 !== "string") continue;
      const key = `${row.runId}\u0000${manifestSha256}`;
      const rows = roleMapsByHistory.get(key) ?? [];
      rows.push(row);
      roleMapsByHistory.set(key, rows);
    }

    for (const { history, candidates } of work) {
      const pageRows = history.manifest.pageArtifactHashes.flatMap((sha256) => {
        const row = pagesByHash.get(sha256);
        return row ? [row] : [];
      });
      const events = eventsFromPages({ history, pageRows });
      if (!events) {
        failures.push({ manifestSha256: history.manifestSha256, reason: "source_binding_invalid" });
        continue;
      }
      const mapRows = roleMapsByHistory.get(
        `${history.runId}\u0000${history.manifestSha256}`
      ) ?? [];
      if (mapRows.length > 0) historiesWithRoleMap += 1;
      const roleMap = mapRows.length === 1 ? {
        sha256: mapRows[0]!.sha256,
        artifact: mapRows[0]!.artifact as ServiceRoleShadowEventRoleMapV1
      } : null;
      const attempts = candidates.map((candidate) =>
        maybeBuildServiceRoleShadowArtifactV1({
          mode: "service-role-shadow-100-plus-100-v1",
          runId: history.runId,
          snapshotHash: history.snapshotHash,
          subjectAddress: history.subjectAddress,
          state: candidate,
          acceptedHistory: {
            manifestKey: history.manifest.key,
            manifestSha256: history.manifestSha256,
            pageArtifactHashes: history.manifest.pageArtifactHashes,
            events
          },
          eventRoleMap: roleMap
        })!
      ).sort((left, right) => {
        const leftCount = left.artifact.sampledCanonicalEventIds.recent.length +
          left.artifact.sampledCanonicalEventIds.historical.length;
        const rightCount = right.artifact.sampledCanonicalEventIds.recent.length +
          right.artifact.sampledCanonicalEventIds.historical.length;
        return Number(right.artifact.result.classifier !== null) - Number(left.artifact.result.classifier !== null) ||
          rightCount - leftCount || left.sha256.localeCompare(right.sha256);
      });
      const selected = attempts[0]!;
      const sampledIds = [
        ...selected.artifact.sampledCanonicalEventIds.recent,
        ...selected.artifact.sampledCanonicalEventIds.historical
      ];
      sampledEvents += sampledIds.length;
      const roleIds = mapRows.length === 1
        ? boundRoleIds({ history, row: mapRows[0]! })
        : new Set<string>();
      roleBoundSampledEvents += sampledIds.filter((id) => roleIds.has(id)).length;
      const exactWindows = selected.artifact.sampledCanonicalEventIds.recent.length === 100 &&
        selected.artifact.sampledCanonicalEventIds.historical.length === 100;
      if (exactWindows) reconstructedHistories += 1;
      if (selected.artifact.result.classifier !== null && mapRows.length === 1) {
        fullyRoleBoundHistories += 1;
        continue;
      }
      failures.push({
        manifestSha256: history.manifestSha256,
        reason: mapRows.length > 1
          ? "role_authority_conflict"
          : selected.artifact.result.insufficientReason ?? "source_binding_invalid"
      });
    }
    const last = acceptedRows.at(-1)!;
    if (
      typeof last.run_id !== "string" || typeof last.manifest_sha256 !== "string" ||
      typeof last.task_id !== "string"
    ) break;
    cursorRunId = last.run_id;
    cursorManifestSha256 = last.manifest_sha256;
    cursorTaskId = last.task_id;
  }
  failures.sort((left, right) =>
    left.manifestSha256.localeCompare(right.manifestSha256) ||
    left.reason.localeCompare(right.reason)
  );
  return {
    schemaVersion: "service-role-shadow-prerequisites-v1",
    acceptedHistories,
    reconstructedHistories,
    historiesWithRoleMap,
    fullyRoleBoundHistories,
    sampledEvents,
    roleBoundSampledEvents,
    failures
  };
}

export async function runServiceRoleShadowPrerequisiteAuditReadOnly(
  db: ServiceRoleShadowAuditQueryable
): Promise<ServiceRoleShadowPrerequisiteReceiptV1> {
  await db.query("begin transaction read only");
  try {
    return await auditServiceRoleShadowPrerequisitesV1(db);
  } finally {
    await db.query("rollback");
  }
}

export function serviceRoleShadowPrerequisiteExitCode(
  receipt: ServiceRoleShadowPrerequisiteReceiptV1
): 0 | 2 {
  return receipt.reconstructedHistories > 0 &&
    receipt.fullyRoleBoundHistories > 0 ? 0 : 2;
}

async function main(): Promise<0 | 2> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("service_role_shadow_test_database_url_missing");
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const receipt = await runServiceRoleShadowPrerequisiteAuditReadOnly({
      query: (sql, values) => client.query(sql, values as unknown[])
    });
    process.stdout.write(`${canonicalizeArtifactJson(receipt)}\n`);
    return serviceRoleShadowPrerequisiteExitCode(receipt);
  } finally {
    client.release();
    await pool.end();
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.stderr.write("service_role_shadow_prerequisite_audit_failed\n");
    process.exitCode = 1;
  });
}
