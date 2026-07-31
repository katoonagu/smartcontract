import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import { parseAnalysisManifestV1 } from "./contracts";
import {
  parseServiceRoleEventEvidenceBundleV1,
  parseServiceRoleShadowEventRoleMapV1,
  type ServiceRoleEventEvidenceBundleV1
} from "./serviceRoleMapMaterialization";
import {
  parseServiceRoleShadowEventRoleMapV2,
  serviceRoleShadowCompoundBindingKeyV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2
} from "./serviceRoleShadow";
import {
  insertUnifiedArtifact,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";

const HASH = /^[0-9a-f]{64}$/u;
const POLICY_VERSION = "service-role-shadow-100-plus-100-v1" as const;

export type ServiceRoleShadowInputSetV1 = {
  schemaVersion: "service-role-shadow-input-set-v1";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string;
  snapshotHash: string;
  roleMapV2Sha256s: readonly string[];
  productionEffect: false;
};

export type ServiceRoleShadowInputFenceV1 = {
  schemaVersion: "service-role-shadow-input-fence-v1";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string;
  snapshotHash: string;
  runtimeCommit: string;
  outcome:
    | {
        kind: "ready";
        inputSetSha256: string;
        roleMapV2Sha256s: readonly string[];
      }
    | {
        kind: "unavailable";
        reason: "preload_timeout" | "malformed" | "conflict";
        observedRoleMapV2Sha256s: readonly string[] | null;
      };
  productionEffect: false;
};

export type ServiceRoleShadowMapLookupV1 =
  | { kind: "missing" }
  | {
      kind: "found";
      wrapperSha256: string;
      wrapper: ServiceRoleShadowEventRoleMapV2;
      sourceMapSha256: string;
      sourceMap: ServiceRoleShadowEventRoleMapV1;
    }
  | { kind: "conflict"; wrapperSha256s: readonly string[] };

type BoundArtifact<T> = {
  readonly artifact: T;
  readonly canonicalJson: string;
  readonly sha256: string;
};

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_record");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("invalid_record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >;
  const expected = new Set(expectedKeys);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    throw new TypeError("invalid_record");
  }
  return Object.fromEntries(expectedKeys.map((key) => {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("invalid_record");
    }
    return [key, descriptor.value];
  }));
}

function exactDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("invalid_array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >;
  const length = value.length;
  const expectedKeys = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length"
  ];
  const expected = new Set(expectedKeys);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = descriptors.length;
  if (
    !Number.isSafeInteger(length) ||
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expected.has(key)) ||
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.value !== length ||
    lengthDescriptor.enumerable
  ) {
    throw new TypeError("invalid_array");
  }
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("invalid_array");
    }
    return descriptor.value;
  });
}

function ownedSortedStrings(value: unknown, hashesOnly: boolean): readonly string[] {
  const strings = exactDenseArray(value).map((item) => {
    if (typeof item !== "string" || item.length === 0 ||
      (hashesOnly && !HASH.test(item))) {
      throw new TypeError("invalid_strings");
    }
    return item;
  });
  for (let index = 1; index < strings.length; index += 1) {
    if (strings[index - 1]! >= strings[index]!) {
      throw new TypeError("invalid_strings");
    }
  }
  return Object.freeze([...strings]);
}

function validRootText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function parseInputSetUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputSetV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "roleMapV2Sha256s",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-input-set-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    typeof root.snapshotHash !== "string" ||
    !HASH.test(root.snapshotHash) ||
    root.productionEffect !== false
  ) {
    throw new TypeError("invalid_root");
  }
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-input-set-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash,
    roleMapV2Sha256s: ownedSortedStrings(root.roleMapV2Sha256s, true),
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowInputSetV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputSetV1 {
  try {
    return parseInputSetUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_input_set_v1_invalid");
  }
}

function parseFenceUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputFenceV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "runtimeCommit",
    "outcome",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-input-fence-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    typeof root.snapshotHash !== "string" ||
    !HASH.test(root.snapshotHash) ||
    !validRootText(root.runtimeCommit) ||
    root.productionEffect !== false
  ) {
    throw new TypeError("invalid_root");
  }
  let rawOutcome: Record<string, unknown>;
  try {
    rawOutcome = exactRecord(root.outcome, [
      "kind", "inputSetSha256", "roleMapV2Sha256s"
    ]);
  } catch {
    rawOutcome = exactRecord(root.outcome, [
      "kind", "reason", "observedRoleMapV2Sha256s"
    ]);
  }
  let outcome: ServiceRoleShadowInputFenceV1["outcome"];
  if (rawOutcome.kind === "ready") {
    if (typeof rawOutcome.inputSetSha256 !== "string" ||
      !HASH.test(rawOutcome.inputSetSha256)) {
      throw new TypeError("invalid_ready");
    }
    outcome = Object.freeze({
      kind: "ready" as const,
      inputSetSha256: rawOutcome.inputSetSha256,
      roleMapV2Sha256s: ownedSortedStrings(rawOutcome.roleMapV2Sha256s, true)
    });
  } else {
    if (rawOutcome.kind !== "unavailable" ||
      !["preload_timeout", "malformed", "conflict"].includes(
        String(rawOutcome.reason)
      )) {
      throw new TypeError("invalid_unavailable");
    }
    const observed = rawOutcome.observedRoleMapV2Sha256s === null
      ? null
      : ownedSortedStrings(rawOutcome.observedRoleMapV2Sha256s, false);
    if (rawOutcome.reason === "preload_timeout" && observed !== null) {
      throw new TypeError("invalid_timeout");
    }
    if (rawOutcome.reason !== "preload_timeout" && observed === null) {
      throw new TypeError("invalid_observed");
    }
    outcome = Object.freeze({
      kind: "unavailable" as const,
      reason: rawOutcome.reason as "preload_timeout" | "malformed" | "conflict",
      observedRoleMapV2Sha256s: observed
    });
  }
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-input-fence-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash,
    runtimeCommit: root.runtimeCommit,
    outcome,
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowInputFenceV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputFenceV1 {
  try {
    return parseFenceUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_input_fence_v1_invalid");
  }
}

function boundArtifact<T>(artifact: T): BoundArtifact<T> {
  const canonicalJson = canonicalizeArtifactJson(artifact);
  return Object.freeze({
    artifact,
    canonicalJson,
    sha256: fingerprintCanonicalArtifact(artifact)
  });
}

export function buildServiceRoleShadowInputSetV1(input: {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly roleMapV2Sha256s: readonly string[];
}): BoundArtifact<ServiceRoleShadowInputSetV1> {
  const roleMapV2Sha256s = [...input.roleMapV2Sha256s].sort();
  const candidate = {
    schemaVersion: "service-role-shadow-input-set-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    roleMapV2Sha256s,
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowInputSetV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

export function buildServiceRoleShadowInputFenceV1(input: {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly runtimeCommit: string;
  readonly outcome: ServiceRoleShadowInputFenceV1["outcome"];
}): BoundArtifact<ServiceRoleShadowInputFenceV1> {
  const candidate = {
    schemaVersion: "service-role-shadow-input-fence-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    runtimeCommit: input.runtimeCommit,
    outcome: input.outcome.kind === "ready"
      ? {
          kind: "ready" as const,
          inputSetSha256: input.outcome.inputSetSha256,
          roleMapV2Sha256s: [...input.outcome.roleMapV2Sha256s].sort()
        }
      : {
          kind: "unavailable" as const,
          reason: input.outcome.reason,
          observedRoleMapV2Sha256s:
            input.outcome.observedRoleMapV2Sha256s === null
              ? null
              : [...input.outcome.observedRoleMapV2Sha256s].sort()
        },
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowInputFenceV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

type StoredArtifactRow = {
  readonly sha256: string;
  readonly createdByRunId: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly artifact: unknown;
};

type ValidatedRoleMap = {
  readonly wrapperSha256: string;
  readonly wrapper: ServiceRoleShadowEventRoleMapV2;
  readonly sourceMapSha256: string;
  readonly sourceMap: ServiceRoleShadowEventRoleMapV1;
};

type RuntimeState = {
  readonly fence: BoundArtifact<ServiceRoleShadowInputFenceV1>;
  readonly mapsByCompoundBindingKey: ReadonlyMap<string, readonly ValidatedRoleMap[]>;
};

type ExistingFenceResolution =
  | { readonly kind: "none" }
  | { readonly kind: "reuse"; readonly state: RuntimeState }
  | {
      readonly kind: "unavailable";
      readonly reason: "malformed" | "conflict";
      readonly observedRoleMapV2Sha256s: readonly string[];
    };

function storedArtifactRow(value: Record<string, unknown>): StoredArtifactRow {
  if (
    typeof value.sha256 !== "string" ||
    typeof value.created_by_run_id !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.schema_version !== "string" ||
    !("artifact_json" in value)
  ) {
    throw new TypeError("service_role_shadow_stored_artifact_invalid");
  }
  return {
    sha256: value.sha256,
    createdByRunId: value.created_by_run_id,
    kind: value.kind,
    schemaVersion: value.schema_version,
    artifact: value.artifact_json
  };
}

function emptyMapIndex(): ReadonlyMap<string, readonly ValidatedRoleMap[]> {
  return new Map<string, readonly ValidatedRoleMap[]>();
}

function indexMaps(
  maps: readonly ValidatedRoleMap[]
): ReadonlyMap<string, readonly ValidatedRoleMap[]> {
  const mutable = new Map<string, ValidatedRoleMap[]>();
  for (const map of maps) {
    const key = serviceRoleShadowCompoundBindingKeyV1(map.wrapper);
    const values = mutable.get(key) ?? [];
    values.push(map);
    mutable.set(key, values);
  }
  return new Map([...mutable].map(([key, values]) => [
    key,
    Object.freeze([...values].sort((left, right) =>
      left.wrapperSha256.localeCompare(right.wrapperSha256)))
  ]));
}

function validateRuntimeInput(input: {
  readonly runId: string;
  readonly snapshotHash: string;
}): void {
  if (!validRootText(input.runId)) {
    throw new TypeError("service_role_shadow_runtime_run_id_invalid");
  }
  if (!HASH.test(input.snapshotHash)) {
    throw new TypeError("service_role_shadow_runtime_snapshot_invalid");
  }
}

function timeoutError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "55P03" || code === "57014";
}

async function setPreloadDeadlines(client: UnifiedQueryable): Promise<void> {
  await client.query("SET LOCAL lock_timeout = '1000ms'");
  await client.query("SET LOCAL statement_timeout = '1000ms'");
}

async function takeRunAdvisoryLock(
  client: UnifiedQueryable,
  runId: string
): Promise<void> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [`service-role-shadow-input-fence-v1:${runId}`]
  );
}

async function validateRunSnapshot(
  client: UnifiedQueryable,
  input: { readonly runId: string; readonly snapshotHash: string },
  lockRun: boolean
): Promise<void> {
  const result = await client.query(
    `select run.id,
            run.subject_address,
            run.analysis_manifest_sha256,
            artifact.sha256 as artifact_sha256,
            artifact.kind as artifact_kind,
            artifact.schema_version as artifact_schema_version,
            artifact.artifact_json
       from unified_check_runs run
       join unified_check_artifacts artifact
         on artifact.sha256 = run.analysis_manifest_sha256
        and artifact.created_by_run_id = run.id
        and artifact.kind = 'analysis_manifest'
        and artifact.schema_version = '1'
      where run.id = $1${lockRun ? "\n      for update of run" : ""}`,
    [input.runId]
  );
  const row = result.rows[0];
  if (!row || result.rows.length !== 1 ||
    row.id !== input.runId ||
    typeof row.subject_address !== "string" ||
    typeof row.analysis_manifest_sha256 !== "string" ||
    !HASH.test(row.analysis_manifest_sha256) ||
    row.artifact_sha256 !== row.analysis_manifest_sha256 ||
    row.artifact_kind !== "analysis_manifest" ||
    row.artifact_schema_version !== "1" ||
    fingerprintCanonicalArtifact(row.artifact_json) !== row.analysis_manifest_sha256) {
    throw new TypeError("service_role_shadow_runtime_run_binding_invalid");
  }
  const manifestCandidate = row.artifact_json;
  const manifestSnapshot = manifestCandidate !== null &&
      typeof manifestCandidate === "object" &&
      !Array.isArray(manifestCandidate)
    ? (manifestCandidate as Record<string, unknown>).snapshotHash
    : null;
  if (manifestSnapshot !== input.snapshotHash) {
    throw new TypeError("service_role_shadow_runtime_snapshot_mismatch");
  }
  parseAnalysisManifestV1(manifestCandidate, {
    runId: input.runId,
    subjectAddress: row.subject_address,
    snapshotHash: input.snapshotHash
  });
}

async function loadArtifactsByHashes(
  client: UnifiedQueryable,
  runId: string,
  sha256s: readonly string[]
): Promise<StoredArtifactRow[]> {
  if (sha256s.length === 0) return [];
  const rows = (await client.query(
    `select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where sha256 = any($1::text[])
        and created_by_run_id = $2
      order by sha256`,
    [sha256s, runId]
  )).rows.map(storedArtifactRow);
  return rows;
}

function validateSourceClosure(input: {
  readonly wrapperSha256: string;
  readonly wrapper: ServiceRoleShadowEventRoleMapV2;
  readonly sourceMapSha256: string;
  readonly sourceMap: ServiceRoleShadowEventRoleMapV1;
  readonly evidenceBundleSha256: string;
  readonly evidenceBundle: ServiceRoleEventEvidenceBundleV1;
}): ValidatedRoleMap {
  const { wrapper, sourceMap, evidenceBundle } = input;
  if (
    sourceMap.runId !== wrapper.runId ||
    sourceMap.snapshotHash !== wrapper.snapshotHash ||
    sourceMap.addressHistoryManifestSha256 !== wrapper.addressHistoryManifestSha256 ||
    evidenceBundle.runId !== wrapper.runId ||
    evidenceBundle.snapshotHash !== wrapper.snapshotHash ||
    evidenceBundle.addressHistoryManifestSha256 !== wrapper.addressHistoryManifestSha256
  ) {
    throw new TypeError("service_role_shadow_source_binding_invalid");
  }
  const sampledIds = [
    ...wrapper.binding.sampledCanonicalEventIds.recent,
    ...wrapper.binding.sampledCanonicalEventIds.historical
  ];
  const sampled = new Set(sampledIds);
  const mapEntries = new Map<string, ServiceRoleShadowEventRoleMapV1["entries"][number]>();
  for (const entry of sourceMap.entries) {
    if (entry.evidenceSha256 !== input.evidenceBundleSha256 ||
      mapEntries.has(entry.canonicalEventId)) {
      throw new TypeError("service_role_shadow_source_map_invalid");
    }
    mapEntries.set(entry.canonicalEventId, entry);
  }
  const bundleEntries = new Map<string, ServiceRoleEventEvidenceBundleV1["entries"][number]>();
  for (const entry of evidenceBundle.entries) {
    if (bundleEntries.has(entry.canonicalEventId)) {
      throw new TypeError("service_role_shadow_evidence_bundle_invalid");
    }
    bundleEntries.set(entry.canonicalEventId, entry);
  }
  if (
    sampled.size !== 200 ||
    mapEntries.size !== 200 ||
    bundleEntries.size !== 200 ||
    sampledIds.some((canonicalEventId) => {
      const mapEntry = mapEntries.get(canonicalEventId);
      const bundleEntry = bundleEntries.get(canonicalEventId);
      return !mapEntry || !bundleEntry || mapEntry.role !== bundleEntry.role;
    }) ||
    [...mapEntries].some(([canonicalEventId]) => !sampled.has(canonicalEventId)) ||
    [...bundleEntries].some(([canonicalEventId]) => !sampled.has(canonicalEventId))
  ) {
    throw new TypeError("service_role_shadow_source_closure_invalid");
  }
  return Object.freeze({
    wrapperSha256: input.wrapperSha256,
    wrapper,
    sourceMapSha256: input.sourceMapSha256,
    sourceMap
  });
}

async function validateWrapperRows(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly expectedWrapperSha256s: readonly string[];
    readonly wrapperRows: readonly StoredArtifactRow[];
  }
): Promise<ValidatedRoleMap[]> {
  if (
    input.wrapperRows.length !== input.expectedWrapperSha256s.length ||
    new Set(input.expectedWrapperSha256s).size !== input.expectedWrapperSha256s.length
  ) {
    throw new TypeError("service_role_shadow_wrapper_set_invalid");
  }
  const expected = new Set(input.expectedWrapperSha256s);
  const wrappers = input.wrapperRows.map((row) => {
    if (
      !expected.has(row.sha256) ||
      row.createdByRunId !== input.runId ||
      row.kind !== "service_role_event_role_map" ||
      row.schemaVersion !== "2" ||
      fingerprintCanonicalArtifact(row.artifact) !== row.sha256
    ) {
      throw new TypeError("service_role_shadow_wrapper_invalid");
    }
    const wrapper = parseServiceRoleShadowEventRoleMapV2({
      artifact: row.artifact,
      expectedSha256: row.sha256
    });
    if (wrapper.runId !== input.runId || wrapper.snapshotHash !== input.snapshotHash) {
      throw new TypeError("service_role_shadow_wrapper_binding_invalid");
    }
    return { row, wrapper };
  });
  const sourceHashes = [...new Set(wrappers.flatMap(({ wrapper }) => [
    wrapper.sourceEventRoleMapV1Sha256,
    wrapper.evidenceBundleSha256
  ]))].sort();
  const sourceRows = await loadArtifactsByHashes(client, input.runId, sourceHashes);
  const sources = new Map(sourceRows.map((row) => [row.sha256, row]));
  if (sources.size !== sourceHashes.length) {
    throw new TypeError("service_role_shadow_source_missing");
  }
  return wrappers.map(({ row, wrapper }) => {
    const sourceRow = sources.get(wrapper.sourceEventRoleMapV1Sha256);
    const bundleRow = sources.get(wrapper.evidenceBundleSha256);
    if (!sourceRow || !bundleRow ||
      sourceRow.kind !== "service_role_event_role_map" ||
      sourceRow.schemaVersion !== "1" ||
      bundleRow.kind !== "service_role_event_evidence_bundle" ||
      bundleRow.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(sourceRow.artifact) !== sourceRow.sha256 ||
      fingerprintCanonicalArtifact(bundleRow.artifact) !== bundleRow.sha256) {
      throw new TypeError("service_role_shadow_source_invalid");
    }
    return validateSourceClosure({
      wrapperSha256: row.sha256,
      wrapper,
      sourceMapSha256: sourceRow.sha256,
      sourceMap: parseServiceRoleShadowEventRoleMapV1(sourceRow.artifact),
      evidenceBundleSha256: bundleRow.sha256,
      evidenceBundle: parseServiceRoleEventEvidenceBundleV1(bundleRow.artifact)
    });
  });
}

async function loadValidatedMapsByHashes(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly wrapperSha256s: readonly string[];
  }
): Promise<ValidatedRoleMap[]> {
  const wrapperRows = await loadArtifactsByHashes(
    client,
    input.runId,
    input.wrapperSha256s
  );
  return validateWrapperRows(client, {
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    expectedWrapperSha256s: input.wrapperSha256s,
    wrapperRows
  });
}

async function loadInputSet(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly inputSetSha256: string;
    readonly roleMapV2Sha256s: readonly string[];
  }
): Promise<ServiceRoleShadowInputSetV1> {
  const rows = await loadArtifactsByHashes(client, input.runId, [input.inputSetSha256]);
  const row = rows[0];
  if (!row || rows.length !== 1 ||
    row.kind !== "service_role_shadow_input_set" ||
    row.schemaVersion !== "1" ||
    fingerprintCanonicalArtifact(row.artifact) !== row.sha256) {
    throw new TypeError("service_role_shadow_input_set_stored_invalid");
  }
  const inputSet = parseServiceRoleShadowInputSetV1({
    artifact: row.artifact,
    expectedSha256: row.sha256
  });
  if (
    inputSet.runId !== input.runId ||
    inputSet.snapshotHash !== input.snapshotHash ||
    canonicalizeArtifactJson(inputSet.roleMapV2Sha256s) !==
      canonicalizeArtifactJson(input.roleMapV2Sha256s)
  ) {
    throw new TypeError("service_role_shadow_input_set_binding_invalid");
  }
  return inputSet;
}

async function loadFenceRows(
  client: UnifiedQueryable,
  runId: string
): Promise<StoredArtifactRow[]> {
  return (await client.query(
    `select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'service_role_shadow_input_fence'
        and schema_version = '1'
      order by sha256`,
    [runId]
  )).rows.map(storedArtifactRow);
}

function observedFromFences(
  fences: readonly ServiceRoleShadowInputFenceV1[]
): readonly string[] {
  return Object.freeze([...new Set(fences.flatMap((fence) =>
    fence.outcome.kind === "ready"
      ? [...fence.outcome.roleMapV2Sha256s]
      : [...(fence.outcome.observedRoleMapV2Sha256s ?? [])]
  ))].sort());
}

async function resolveExistingFence(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<ExistingFenceResolution> {
  const rows = await loadFenceRows(client, input.runId);
  if (rows.length === 0) return { kind: "none" };
  const valid: Array<{
    readonly row: StoredArtifactRow;
    readonly fence: ServiceRoleShadowInputFenceV1;
  }> = [];
  for (const row of rows) {
    try {
      if (
        row.createdByRunId !== input.runId ||
        row.kind !== "service_role_shadow_input_fence" ||
        row.schemaVersion !== "1" ||
        fingerprintCanonicalArtifact(row.artifact) !== row.sha256
      ) continue;
      const fence = parseServiceRoleShadowInputFenceV1({
        artifact: row.artifact,
        expectedSha256: row.sha256
      });
      if (fence.runId !== input.runId || fence.snapshotHash !== input.snapshotHash) {
        continue;
      }
      valid.push({ row, fence });
    } catch {
      continue;
    }
  }
  const observedRoleMapV2Sha256s = observedFromFences(valid.map(({ fence }) => fence));
  if (rows.length !== 1 || valid.length !== 1 ||
    valid[0]!.fence.runtimeCommit !== input.runtimeCommit) {
    return {
      kind: "unavailable",
      reason: "conflict",
      observedRoleMapV2Sha256s
    };
  }
  const existing = valid[0]!;
  if (existing.fence.outcome.kind === "unavailable") {
    return {
      kind: "reuse",
      state: {
        fence: boundArtifact(existing.fence),
        mapsByCompoundBindingKey: emptyMapIndex()
      }
    };
  }
  try {
    await loadInputSet(client, {
      runId: input.runId,
      snapshotHash: input.snapshotHash,
      inputSetSha256: existing.fence.outcome.inputSetSha256,
      roleMapV2Sha256s: existing.fence.outcome.roleMapV2Sha256s
    });
    const maps = await loadValidatedMapsByHashes(client, {
      runId: input.runId,
      snapshotHash: input.snapshotHash,
      wrapperSha256s: existing.fence.outcome.roleMapV2Sha256s
    });
    return {
      kind: "reuse",
      state: {
        fence: boundArtifact(existing.fence),
        mapsByCompoundBindingKey: indexMaps(maps)
      }
    };
  } catch {
    return {
      kind: "unavailable",
      reason: "malformed",
      observedRoleMapV2Sha256s
    };
  }
}

async function persistFence(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
    readonly outcome: ServiceRoleShadowInputFenceV1["outcome"];
    readonly maps?: readonly ValidatedRoleMap[];
  }
): Promise<RuntimeState> {
  const fence = buildServiceRoleShadowInputFenceV1(input);
  await insertUnifiedArtifact(client, {
    sha256: fence.sha256,
    createdByRunId: input.runId,
    kind: "service_role_shadow_input_fence",
    schemaVersion: "1",
    artifact: fence.artifact
  });
  return {
    fence,
    mapsByCompoundBindingKey: indexMaps(input.maps ?? [])
  };
}

async function scanAndPublish(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  const rawRows = (await client.query(
    `select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'service_role_event_role_map'
        and schema_version = '2'
      order by sha256`,
    [input.runId]
  )).rows;
  const observedRoleMapV2Sha256s = [...new Set(rawRows.flatMap((row) =>
    typeof row.sha256 === "string" ? [row.sha256] : []
  ))].sort();
  let maps: ValidatedRoleMap[];
  try {
    const wrapperRows = rawRows.map(storedArtifactRow);
    maps = await validateWrapperRows(client, {
      runId: input.runId,
      snapshotHash: input.snapshotHash,
      expectedWrapperSha256s: observedRoleMapV2Sha256s,
      wrapperRows
    });
  } catch (error) {
    if (timeoutError(error)) throw error;
    return persistFence(client, {
      ...input,
      outcome: {
        kind: "unavailable",
        reason: "malformed",
        observedRoleMapV2Sha256s
      }
    });
  }
  const inputSet = buildServiceRoleShadowInputSetV1({
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    roleMapV2Sha256s: observedRoleMapV2Sha256s
  });
  await insertUnifiedArtifact(client, {
    sha256: inputSet.sha256,
    createdByRunId: input.runId,
    kind: "service_role_shadow_input_set",
    schemaVersion: "1",
    artifact: inputSet.artifact
  });
  return persistFence(client, {
    ...input,
    outcome: {
      kind: "ready",
      inputSetSha256: inputSet.sha256,
      roleMapV2Sha256s: inputSet.artifact.roleMapV2Sha256s
    },
    maps
  });
}

async function initializeNormally(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  return db.transaction(async (client) => {
    await setPreloadDeadlines(client);
    await takeRunAdvisoryLock(client, input.runId);
    await validateRunSnapshot(client, input, true);
    const existing = await resolveExistingFence(client, input);
    if (existing.kind === "reuse") return existing.state;
    if (existing.kind === "unavailable") {
      return persistFence(client, {
        ...input,
        outcome: {
          kind: "unavailable",
          reason: existing.reason,
          observedRoleMapV2Sha256s: existing.observedRoleMapV2Sha256s
        }
      });
    }
    return scanAndPublish(client, input);
  });
}

async function publishTimeout(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  return db.transaction(async (client) => {
    await setPreloadDeadlines(client);
    await takeRunAdvisoryLock(client, input.runId);
    await validateRunSnapshot(client, input, false);
    const existing = await resolveExistingFence(client, input);
    if (existing.kind === "reuse") return existing.state;
    if (existing.kind === "unavailable") {
      return persistFence(client, {
        ...input,
        outcome: {
          kind: "unavailable",
          reason: existing.reason,
          observedRoleMapV2Sha256s: existing.observedRoleMapV2Sha256s
        }
      });
    }
    return persistFence(client, {
      ...input,
      outcome: {
        kind: "unavailable",
        reason: "preload_timeout",
        observedRoleMapV2Sha256s: null
      }
    });
  });
}

async function initializeState(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  try {
    return await initializeNormally(db, input);
  } catch (error) {
    if (!timeoutError(error)) throw error;
    return publishTimeout(db, input);
  }
}

export function createServiceRoleShadowRuntimeV1(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly runtimeCommit: string;
}): {
  loadInputFence(run: {
    readonly runId: string;
    readonly snapshotHash: string;
  }): Promise<{
    readonly sha256: string;
    readonly artifact: ServiceRoleShadowInputFenceV1;
  }>;
  lookupMap(lookup: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly compoundBindingKey: string;
  }): Promise<ServiceRoleShadowMapLookupV1>;
} {
  if (!validRootText(input.runtimeCommit)) {
    throw new TypeError("service_role_shadow_runtime_commit_invalid");
  }
  const cache = new Map<string, {
    readonly snapshotHash: string;
    readonly statePromise: Promise<RuntimeState>;
    readonly fencePromise: Promise<{
      readonly sha256: string;
      readonly artifact: ServiceRoleShadowInputFenceV1;
    }>;
  }>();

  const cacheEntry = (run: {
    readonly runId: string;
    readonly snapshotHash: string;
  }) => {
    validateRuntimeInput(run);
    const existing = cache.get(run.runId);
    if (existing) {
      if (existing.snapshotHash !== run.snapshotHash) {
        throw new TypeError("service_role_shadow_runtime_snapshot_mismatch");
      }
      return existing;
    }
    const statePromise = initializeState(input.db, {
      ...run,
      runtimeCommit: input.runtimeCommit
    });
    const fencePromise = statePromise.then(({ fence }) => ({
      sha256: fence.sha256,
      artifact: fence.artifact
    }));
    void fencePromise.catch(() => undefined);
    const created = { snapshotHash: run.snapshotHash, statePromise, fencePromise };
    cache.set(run.runId, created);
    return created;
  };

  return {
    loadInputFence(run) {
      try {
        return cacheEntry(run).fencePromise;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    async lookupMap(lookup) {
      if (!HASH.test(lookup.compoundBindingKey)) {
        throw new TypeError("service_role_shadow_compound_binding_key_invalid");
      }
      const state = await cacheEntry(lookup).statePromise;
      const maps = state.mapsByCompoundBindingKey.get(lookup.compoundBindingKey) ?? [];
      if (maps.length === 0) return { kind: "missing" };
      if (maps.length > 1) {
        return Object.freeze({
          kind: "conflict" as const,
          wrapperSha256s: Object.freeze(maps.map(({ wrapperSha256 }) => wrapperSha256))
        });
      }
      const map = maps[0]!;
      return Object.freeze({
        kind: "found" as const,
        wrapperSha256: map.wrapperSha256,
        wrapper: map.wrapper,
        sourceMapSha256: map.sourceMapSha256,
        sourceMap: map.sourceMap
      });
    }
  };
}
