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
  const anchor = safeAnchor(input.state.anchorTimestamp);
  if (anchor === null) return insufficient("anchor_unproven");

  const canonical = new Map<string, IndexedTronUsdtTransfer>();
  for (const event of input.acceptedHistory.events) {
    if (!(event.blockTimestamp instanceof Date) || timestampSeconds(event.blockTimestamp) === null ||
      !Number.isSafeInteger(event.blockNumber) || event.blockNumber < 0 ||
      event.confirmed !== true || event.reverted === true || event.contractRet === "REVERT" ||
      event.finalResult === "FAILED" ||
      (event.fromAddress !== input.state.address && event.toAddress !== input.state.address)) {
      continue;
    }
    const id = canonicalTronUsdtEventKey(event);
    const prior = canonical.get(id);
    if (prior && eventFingerprint(prior) !== eventFingerprint(event)) return insufficient("source_binding_invalid");
    canonical.set(id, event);
  }
  const ordered = [...canonical.entries()]
    .map(([id, event]) => ({ id, event, timestamp: timestampSeconds(event.blockTimestamp)! }))
    .sort((left, right) => right.event.blockNumber - left.event.blockNumber ||
      right.timestamp - left.timestamp || right.id.localeCompare(left.id));
  const anchored = ordered.filter(({ id, timestamp }) =>
    input.state.sourceEventIds.includes(id) && timestamp === anchor
  );
  if (anchored.length !== 1) return insufficient("anchor_unproven");
  const recent = ordered.filter(({ timestamp }) => timestamp <= anchor).slice(0, 100);
  if (recent.length !== 100) return insufficient("recent_window_incomplete", recent.map(({ id }) => id));
  const recentBaselineStart = recent.at(-1)!.timestamp;
  const historicalCutoff = Math.min(anchor - SEVEN_DAYS_SECONDS, recentBaselineStart - SEVEN_DAYS_SECONDS);
  const historical = ordered.filter(({ timestamp }) => timestamp < historicalCutoff).slice(0, 100);
  if (historical.length !== 100) return insufficient(
    "historical_window_incomplete", recent.map(({ id }) => id), historical.map(({ id }) => id)
  );
  const sampled = [...recent, ...historical];
  if (new Set(sampled.map(({ event }) => event.blockNumber)).size !== sampled.length) {
    return insufficient("order_unproven", recent.map(({ id }) => id), historical.map(({ id }) => id));
  }
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
