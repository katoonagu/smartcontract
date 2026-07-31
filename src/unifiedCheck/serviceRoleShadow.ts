import {
  classifyServiceBehavior100Plus100V2,
  computeServiceWindowVectorV2,
  type CompleteServiceWindowVectorV2,
  type IncompleteServiceWindowVectorV2,
  type ServiceBehaviorResultV2,
  type ServiceBehaviorRowV2
} from "../forensics/serviceBehaviorResearch";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";
import type { TraversalStateV1 } from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export type ServiceRoleShadowEventRoleV1 =
  | "ordinary" | "poisoning_only" | "gasfree_fee"
  | "gasfree_principal" | "provider_risk";

export type ServiceRoleShadowEventRoleMapV1 = {
  schemaVersion: "service-role-shadow-event-role-map-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  entries: readonly {
    canonicalEventId: string;
    role: ServiceRoleShadowEventRoleV1;
    authority: "existing_hash_bound_economic_role_v1";
    evidenceSha256: string;
  }[];
};

export type ServiceRoleShadowAnchorBindingV1 = {
  canonicalEventId: string;
  blockNumber: number;
  timestamp: string;
  eventIndex: number;
  orderAuthority: "unique_block";
};

export type ServiceRoleShadowAcceptedHistoryBindingV1 = {
  profiledAddress: string;
  direction: TraversalStateV1["direction"];
  anchorBinding: ServiceRoleShadowAnchorBindingV1;
  sampledCanonicalEventIds: {
    recent: readonly string[];
    historical: readonly string[];
  };
  sampledEventIdsSha256: string;
};

export type ServiceRoleShadowEventRoleMapV2 = {
  schemaVersion: "service-role-shadow-event-role-map-v2";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  sourceEventRoleMapV1Sha256: string;
  evidenceBundleSha256: string;
  binding: ServiceRoleShadowAcceptedHistoryBindingV1;
  exactCoverage: { recent: 100; historical: 100; total: 200 };
  productionEffect: false;
};

export type ServiceRoleShadowInsufficientReasonV1 =
  | "checked_subject_excluded" | "anchor_unproven"
  | "recent_window_incomplete" | "historical_window_incomplete"
  | "order_unproven" | "role_map_missing"
  | "role_authority_missing" | "role_authority_conflict"
  | "source_binding_invalid";

export type JsonSafeServiceWindowVectorV2 =
  | (Omit<CompleteServiceWindowVectorV2, "dominantExactAmountRaw"> & {
      dominantExactAmountRaw: string | null;
    })
  | IncompleteServiceWindowVectorV2;

export type JsonSafeServiceBehaviorResultV2 =
  Omit<ServiceBehaviorResultV2, "recentVector" | "historicalVector"> & {
    recentVector: JsonSafeServiceWindowVectorV2;
    historicalVector: JsonSafeServiceWindowVectorV2;
  };

export type ServiceRoleShadowMode =
  | "disabled"
  | "service-role-shadow-100-plus-100-v1";

export type ServiceRoleShadowArtifactV1 = {
  schemaVersion: "service-role-shadow-profile-v1";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  profiledAddress: string;
  traversalStateId: string;
  anchor: { timestamp: string; sourceEventIds: readonly string[] };
  source: {
    evidenceClass: "accepted_history_reconstruction";
    manifestKey: string;
    manifestSha256: string;
    acceptedPageArtifactHashes: readonly string[];
    eventRoleMapSha256: string | null;
    physicalPageRequestHashes: readonly [];
    boundaryPageAuthority: false;
  };
  sampledCanonicalEventIds: {
    recent: readonly string[];
    historical: readonly string[];
  };
  result: {
    status: ServiceBehaviorResultV2["status"] | "not_run";
    insufficientReason: ServiceRoleShadowInsufficientReasonV1 | null;
    classifier: JsonSafeServiceBehaviorResultV2 | null;
  };
  productionEffect: false;
};

type Input = {
  mode: ServiceRoleShadowMode;
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  state: TraversalStateV1;
  acceptedHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
    events: readonly IndexedTronUsdtTransfer[];
  };
  eventRoleMap: {
    sha256: string;
    artifact: ServiceRoleShadowEventRoleMapV1;
  } | null;
};

function timestampSeconds(value: Date): number | null {
  const milliseconds = value.getTime();
  return Number.isFinite(milliseconds) && milliseconds % 1_000 === 0
    ? milliseconds / 1_000
    : null;
}

function safeAnchor(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value &&
    milliseconds % 1_000 === 0 ? milliseconds / 1_000 : null;
}

function eventFingerprint(event: IndexedTronUsdtTransfer): string {
  return fingerprintCanonicalArtifact({ ...event, blockTimestamp: event.blockTimestamp.toISOString() });
}

function isRole(value: string): value is ServiceRoleShadowEventRoleV1 {
  return value === "ordinary" || value === "poisoning_only" || value === "gasfree_fee" ||
    value === "gasfree_principal" || value === "provider_risk";
}

function safeResult(result: ServiceBehaviorResultV2): JsonSafeServiceBehaviorResultV2 {
  const vector = (value: ServiceBehaviorResultV2["recentVector"]): JsonSafeServiceWindowVectorV2 =>
    value.kind === "incomplete" ? value : {
      ...value,
      dominantExactAmountRaw: value.dominantExactAmountRaw?.toString() ?? null
    };
  return { ...result, recentVector: vector(result.recentVector), historicalVector: vector(result.historicalVector) };
}

function stableStateId(state: TraversalStateV1): string {
  return fingerprintCanonicalArtifact([
    "service-role-shadow-state-v1",
    state.address,
    state.direction,
    state.anchorTimestamp,
    state.fundingEpisodeId,
    state.allocatedAmountRaw,
    [...new Set(state.sourceEventIds)].sort()
  ]);
}

function validSource(input: Input): boolean {
  return HASH.test(input.snapshotHash) && HASH.test(input.acceptedHistory.manifestSha256) &&
    input.acceptedHistory.manifestKey.length > 0 &&
    input.acceptedHistory.pageArtifactHashes.length > 0 &&
    input.acceptedHistory.pageArtifactHashes.every((hash) => HASH.test(hash)) &&
    new Set(input.acceptedHistory.pageArtifactHashes).size === input.acceptedHistory.pageArtifactHashes.length;
}

type SelectedAcceptedHistoryEvent = {
  id: string;
  event: IndexedTronUsdtTransfer;
  timestamp: number;
};

type AcceptedHistorySelectionFailure = {
  ok: false;
  reason: Extract<ServiceRoleShadowInsufficientReasonV1,
    "anchor_unproven" | "recent_window_incomplete" |
    "historical_window_incomplete" | "order_unproven" | "source_binding_invalid">;
  bindingReason: "anchor_unproven" | "recent_window_incomplete" |
    "historical_window_incomplete" | "order_unproven" | "collision";
  recent: readonly SelectedAcceptedHistoryEvent[];
  historical: readonly SelectedAcceptedHistoryEvent[];
};

type AcceptedHistorySelection = {
  ok: true;
  anchor: SelectedAcceptedHistoryEvent;
  recent: readonly SelectedAcceptedHistoryEvent[];
  historical: readonly SelectedAcceptedHistoryEvent[];
  sampled: readonly SelectedAcceptedHistoryEvent[];
  duplicateCanonicalEventIds: ReadonlySet<string>;
} | AcceptedHistorySelectionFailure;

function selectAcceptedHistoryWindowV1(input: {
  state: TraversalStateV1;
  acceptedHistoryEvents: readonly IndexedTronUsdtTransfer[];
}): AcceptedHistorySelection {
  const failure = (
    reason: AcceptedHistorySelectionFailure["reason"],
    bindingReason: AcceptedHistorySelectionFailure["bindingReason"],
    recent: readonly SelectedAcceptedHistoryEvent[] = [],
    historical: readonly SelectedAcceptedHistoryEvent[] = []
  ): AcceptedHistorySelection => ({ ok: false, reason, bindingReason, recent, historical });
  const anchorSeconds = safeAnchor(input.state.anchorTimestamp);
  if (anchorSeconds === null) return failure("anchor_unproven", "anchor_unproven");

  const canonical = new Map<string, IndexedTronUsdtTransfer>();
  const duplicateCanonicalEventIds = new Set<string>();
  for (const event of input.acceptedHistoryEvents) {
    if (!(event.blockTimestamp instanceof Date) || timestampSeconds(event.blockTimestamp) === null ||
      !Number.isSafeInteger(event.blockNumber) || event.blockNumber < 0 ||
      !Number.isSafeInteger(event.eventIndex) || event.eventIndex < 0 ||
      event.confirmed !== true || event.reverted === true || event.contractRet === "REVERT" ||
      event.finalResult === "FAILED" ||
      (event.fromAddress !== input.state.address && event.toAddress !== input.state.address)) {
      continue;
    }
    const id = canonicalTronUsdtEventKey(event);
    const prior = canonical.get(id);
    if (prior) {
      if (eventFingerprint(prior) !== eventFingerprint(event)) {
        return failure("source_binding_invalid", "collision");
      }
      duplicateCanonicalEventIds.add(id);
    }
    canonical.set(id, event);
  }
  const ordered = [...canonical.entries()]
    .map(([id, event]) => ({ id, event, timestamp: timestampSeconds(event.blockTimestamp)! }))
    .sort((left, right) => right.event.blockNumber - left.event.blockNumber ||
      right.timestamp - left.timestamp || right.id.localeCompare(left.id));
  const anchored = ordered.filter(({ id, timestamp }) =>
    input.state.sourceEventIds.includes(id) && timestamp === anchorSeconds
  );
  if (anchored.length !== 1) return failure("anchor_unproven", "anchor_unproven");
  const recent = ordered.filter(({ timestamp }) => timestamp <= anchorSeconds).slice(0, 100);
  if (recent.length !== 100) {
    return failure("recent_window_incomplete", "recent_window_incomplete", recent);
  }
  const recentBaselineStart = recent.at(-1)!.timestamp;
  const historicalCutoff = Math.min(
    anchorSeconds - SEVEN_DAYS_SECONDS,
    recentBaselineStart - SEVEN_DAYS_SECONDS
  );
  const historical = ordered.filter(({ timestamp }) => timestamp < historicalCutoff).slice(0, 100);
  if (historical.length !== 100) {
    return failure("historical_window_incomplete", "historical_window_incomplete", recent, historical);
  }
  const sampled = [...recent, ...historical];
  if (new Set(sampled.map(({ event }) => event.blockNumber)).size !== sampled.length) {
    return failure("order_unproven", "order_unproven", recent, historical);
  }
  return { ok: true, anchor: anchored[0]!, recent, historical, sampled, duplicateCanonicalEventIds };
}

export function deriveServiceRoleShadowAcceptedHistoryBindingV1(input: {
  state: TraversalStateV1;
  acceptedHistoryEvents: readonly IndexedTronUsdtTransfer[];
}): ServiceRoleShadowAcceptedHistoryBindingV1 {
  const selection = selectAcceptedHistoryWindowV1(input);
  if (!selection.ok) {
    throw new TypeError(`service_role_shadow_binding_${selection.bindingReason}`);
  }
  const sampledIds = new Set(selection.sampled.map(({ id }) => id));
  if ([...selection.duplicateCanonicalEventIds].some((id) => sampledIds.has(id))) {
    throw new TypeError("service_role_shadow_binding_duplicate");
  }
  const recent = selection.recent.map(({ id }) => id).sort();
  const historical = selection.historical.map(({ id }) => id).sort();
  if (new Set(recent).size !== recent.length || new Set(historical).size !== historical.length) {
    throw new TypeError("service_role_shadow_binding_duplicate");
  }
  const recentIds = new Set(recent);
  if (historical.some((id) => recentIds.has(id))) {
    throw new TypeError("service_role_shadow_binding_collision");
  }
  const sampledCanonicalEventIds = { recent, historical };
  return {
    profiledAddress: input.state.address,
    direction: input.state.direction,
    anchorBinding: {
      canonicalEventId: selection.anchor.id,
      blockNumber: selection.anchor.event.blockNumber,
      timestamp: selection.anchor.event.blockTimestamp.toISOString(),
      eventIndex: selection.anchor.event.eventIndex,
      orderAuthority: "unique_block"
    },
    sampledCanonicalEventIds,
    sampledEventIdsSha256: fingerprintCanonicalArtifact(sampledCanonicalEventIds)
  };
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_record");
  }
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if ((prototype !== Object.prototype && prototype !== null) ||
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) {
    throw new TypeError("invalid_record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (expectedKeys.some((key) => {
    const descriptor = descriptors[key];
    return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
  })) {
    throw new TypeError("invalid_record");
  }
  return value as Record<string, unknown>;
}

function exactSortedEventIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 100) {
    throw new TypeError("invalid_event_ids");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length))) {
    throw new TypeError("invalid_event_ids");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ids: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
      typeof descriptor.value !== "string" || descriptor.value.length === 0) {
      throw new TypeError("invalid_event_ids");
    }
    const id = descriptor.value;
    if (index > 0 && ids[index - 1]! >= id) throw new TypeError("invalid_event_ids");
    ids.push(id);
  }
  return ids;
}

function parseServiceRoleShadowEventRoleMapV2Unchecked(input: {
  artifact: unknown;
  expectedSha256: string;
}): ServiceRoleShadowEventRoleMapV2 {
  if (typeof input.expectedSha256 !== "string" || !HASH.test(input.expectedSha256)) {
    throw new TypeError("invalid_hash");
  }
  const artifact = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "addressHistoryManifestSha256",
    "sourceEventRoleMapV1Sha256",
    "evidenceBundleSha256",
    "binding",
    "exactCoverage",
    "productionEffect"
  ]);
  if (artifact.schemaVersion !== "service-role-shadow-event-role-map-v2" ||
    artifact.policyVersion !== "service-role-shadow-100-plus-100-v1" ||
    typeof artifact.runId !== "string" || artifact.runId.length === 0 ||
    artifact.productionEffect !== false) {
    throw new TypeError("invalid_root");
  }
  for (const hash of [
    artifact.snapshotHash,
    artifact.addressHistoryManifestSha256,
    artifact.sourceEventRoleMapV1Sha256,
    artifact.evidenceBundleSha256
  ]) {
    if (typeof hash !== "string" || !HASH.test(hash)) throw new TypeError("invalid_hash");
  }

  const binding = exactRecord(artifact.binding, [
    "profiledAddress",
    "direction",
    "anchorBinding",
    "sampledCanonicalEventIds",
    "sampledEventIdsSha256"
  ]);
  if (typeof binding.profiledAddress !== "string" || binding.profiledAddress.length === 0 ||
    (binding.direction !== "backward" && binding.direction !== "forward") ||
    typeof binding.sampledEventIdsSha256 !== "string" || !HASH.test(binding.sampledEventIdsSha256)) {
    throw new TypeError("invalid_binding");
  }
  const anchor = exactRecord(binding.anchorBinding, [
    "canonicalEventId", "blockNumber", "timestamp", "eventIndex", "orderAuthority"
  ]);
  if (typeof anchor.canonicalEventId !== "string" || anchor.canonicalEventId.length === 0 ||
    !Number.isSafeInteger(anchor.blockNumber) || (anchor.blockNumber as number) < 0 ||
    typeof anchor.timestamp !== "string" || safeAnchor(anchor.timestamp) === null ||
    !Number.isSafeInteger(anchor.eventIndex) || (anchor.eventIndex as number) < 0 ||
    anchor.orderAuthority !== "unique_block") {
    throw new TypeError("invalid_anchor");
  }
  const sampled = exactRecord(binding.sampledCanonicalEventIds, ["recent", "historical"]);
  const recent = exactSortedEventIds(sampled.recent);
  const historical = exactSortedEventIds(sampled.historical);
  const recentIds = new Set(recent);
  if (historical.some((id) => recentIds.has(id)) ||
    fingerprintCanonicalArtifact({ recent, historical }) !== binding.sampledEventIdsSha256) {
    throw new TypeError("invalid_samples");
  }
  const coverage = exactRecord(artifact.exactCoverage, ["recent", "historical", "total"]);
  if (coverage.recent !== 100 || coverage.historical !== 100 || coverage.total !== 200) {
    throw new TypeError("invalid_coverage");
  }
  if (fingerprintCanonicalArtifact(input.artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return input.artifact as ServiceRoleShadowEventRoleMapV2;
}

export function parseServiceRoleShadowEventRoleMapV2(input: {
  artifact: unknown;
  expectedSha256: string;
}): ServiceRoleShadowEventRoleMapV2 {
  try {
    return parseServiceRoleShadowEventRoleMapV2Unchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_event_role_map_v2_invalid");
  }
}

export function serviceRoleShadowCompoundBindingKeyV1(input: Pick<
  ServiceRoleShadowEventRoleMapV2,
  "runId" | "snapshotHash" | "addressHistoryManifestSha256" | "binding"
>): string {
  return fingerprintCanonicalArtifact({
    schemaVersion: "service-role-shadow-compound-binding-key-v1",
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    addressHistoryManifestSha256: input.addressHistoryManifestSha256,
    binding: input.binding
  });
}

export function maybeBuildServiceRoleShadowArtifactV1(input: Input): {
  sha256: string;
  artifact: ServiceRoleShadowArtifactV1;
} | null {
  if (input.mode === "disabled") return null;

  const mapSha256 = input.eventRoleMap && HASH.test(input.eventRoleMap.sha256)
    ? input.eventRoleMap.sha256
    : null;
  const base = (recent: readonly string[], historical: readonly string[]) => ({
    schemaVersion: "service-role-shadow-profile-v1" as const,
    policyVersion: "service-role-shadow-100-plus-100-v1" as const,
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    subjectAddress: input.subjectAddress,
    profiledAddress: input.state.address,
    traversalStateId: stableStateId(input.state),
    anchor: { timestamp: input.state.anchorTimestamp, sourceEventIds: [...input.state.sourceEventIds].sort() },
    source: {
      evidenceClass: "accepted_history_reconstruction" as const,
      manifestKey: input.acceptedHistory.manifestKey,
      manifestSha256: input.acceptedHistory.manifestSha256,
      acceptedPageArtifactHashes: [...input.acceptedHistory.pageArtifactHashes],
      eventRoleMapSha256: mapSha256,
      physicalPageRequestHashes: [] as const,
      boundaryPageAuthority: false as const
    },
    sampledCanonicalEventIds: { recent, historical },
    productionEffect: false as const
  });
  const insufficient = (reason: ServiceRoleShadowInsufficientReasonV1, recent: readonly string[] = [], historical: readonly string[] = []) => {
    const artifact: ServiceRoleShadowArtifactV1 = {
      ...base(recent, historical),
      result: { status: "insufficient_data", insufficientReason: reason, classifier: null }
    };
    return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
  };

  if (input.state.address === input.subjectAddress) return insufficient("checked_subject_excluded");
  if (!validSource(input)) return insufficient("source_binding_invalid");
  const selection = selectAcceptedHistoryWindowV1({
    state: input.state,
    acceptedHistoryEvents: input.acceptedHistory.events
  });
  if (!selection.ok) {
    return insufficient(
      selection.reason,
      selection.recent.map(({ id }) => id),
      selection.historical.map(({ id }) => id)
    );
  }
  const { recent, historical, sampled } = selection;
  if (input.eventRoleMap === null) return insufficient(
    "role_map_missing", recent.map(({ id }) => id), historical.map(({ id }) => id)
  );
  const map = input.eventRoleMap.artifact;
  if (fingerprintCanonicalArtifact(map) !== input.eventRoleMap.sha256 ||
    map.schemaVersion !== "service-role-shadow-event-role-map-v1" ||
    map.runId !== input.runId || map.snapshotHash !== input.snapshotHash ||
    map.addressHistoryManifestSha256 !== input.acceptedHistory.manifestSha256) {
    return insufficient("source_binding_invalid", recent.map(({ id }) => id), historical.map(({ id }) => id));
  }
  const roles = new Map<string, ServiceRoleShadowEventRoleV1>();
  for (const entry of map.entries) {
    if (!isRole(entry.role) || entry.authority !== "existing_hash_bound_economic_role_v1" ||
      !HASH.test(entry.evidenceSha256) || entry.canonicalEventId.length === 0) {
      return insufficient("role_authority_conflict", recent.map(({ id }) => id), historical.map(({ id }) => id));
    }
    if (roles.has(entry.canonicalEventId)) return insufficient(
      "role_authority_conflict", recent.map(({ id }) => id), historical.map(({ id }) => id)
    );
    roles.set(entry.canonicalEventId, entry.role);
  }
  if (sampled.some(({ id }) => !roles.has(id))) return insufficient(
    "role_authority_missing", recent.map(({ id }) => id), historical.map(({ id }) => id)
  );
  const rows = (window: ReadonlyArray<(typeof sampled)[number]>): ServiceBehaviorRowV2[] => window.map(({ id, event, timestamp }) => {
    let amountRaw: bigint;
    try { amountRaw = BigInt(event.amountRaw); } catch { throw new TypeError("service_role_shadow_amount_invalid"); }
    return {
      canonicalEventId: id,
      blockNumber: event.blockNumber,
      transactionIndex: null,
      eventIndex: event.eventIndex,
      occurredAtSeconds: timestamp,
      direction: event.toAddress === input.state.address ? "incoming" : "outgoing",
      counterpartyAddress: event.toAddress === input.state.address ? event.fromAddress : event.toAddress,
      amountRaw,
      valid: true,
      featureRole: roles.get(id)!,
      // ponytail: v1 proves accepted-history order only for one sampled event per
      // block; upgrade after accepted artifacts carry authoritative in-block order.
      orderAuthority: "unique_block"
    };
  });
  let classifier: ServiceBehaviorResultV2;
  try {
    classifier = classifyServiceBehavior100Plus100V2({
      recent: computeServiceWindowVectorV2(rows(recent)),
      historical: computeServiceWindowVectorV2(rows(historical)),
      exactRoleConflict: false
    });
  } catch {
    return insufficient("source_binding_invalid", recent.map(({ id }) => id), historical.map(({ id }) => id));
  }
  const artifact: ServiceRoleShadowArtifactV1 = {
    ...base(recent.map(({ id }) => id), historical.map(({ id }) => id)),
    result: { status: classifier.status, insufficientReason: null, classifier: safeResult(classifier) }
  };
  return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
}
