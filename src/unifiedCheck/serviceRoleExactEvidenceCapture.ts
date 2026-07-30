import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";
import {
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowArtifactV1
} from "./serviceRoleShadow";
import { traversalStateId, type TraversalStateV1 } from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;

export type ServiceRoleGasFreeDispositionV1 =
  | {
      parserVersion: "gasfree-settlement-disposition-v1";
      disposition: "not_gasfree";
      negativeEvidence: "controller_negative" | "selector_negative";
      settlementEvidenceSha256: null;
      movementEvidenceSha256: null;
    }
  | {
      parserVersion: "gasfree-settlement-disposition-v1";
      disposition: "gasfree_principal" | "gasfree_fee";
      settlementEvidenceSha256: string;
      movementEvidenceSha256: string;
    };

export type ServiceRolePoisoningDispositionV1 = {
  schemaVersion: "address-poisoning-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  complete: boolean;
  result: string;
  reason: string | null;
  comparison: {
    lowerBound: string | null;
    upperBound: string | null;
    pageArtifactHashes: readonly string[];
    canonicalEventIds: readonly string[];
    inventorySha256: string;
    orderAuthority: string;
  };
};

export type ServiceRoleProviderRiskDispositionV1 = {
  schemaVersion: "tronscan-risk-transaction-boolean-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  bindings: {
    runId: string;
    snapshotHash: string;
    addressHistoryManifestSha256: string;
    canonicalEventId: string;
    txHash: string;
  };
  evidence: { id: string; payloadSha256: string; riskTransaction: boolean };
  binding: string;
  result: boolean;
};

export type ServiceRoleExactEvidenceCaptureManifestV1 = {
  schemaVersion: "service-role-exact-evidence-capture-manifest-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  parserVersions: {
    gasFree: "gasfree-settlement-disposition-v1";
    poisoning: "address-poisoning-v1";
    providerRisk: "tronscan-risk-transaction-boolean-v1";
  };
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  profiledAddress: string;
  acceptedHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
  };
  traversal: {
    primaryStateId: string;
    equivalentStateIds: readonly string[];
    anchor: { timestamp: string; sourceEventIds: readonly string[] };
    sourceEventIds: readonly string[];
  };
  recentCanonicalEventIds: readonly string[];
  historicalCanonicalEventIds: readonly string[];
  provider: {
    chain: "tron";
    provider: "tronscan";
    endpoint: "transaction-info";
    schemaVersion: "schema1";
  };
  events: readonly {
    canonicalEventId: string;
    eventBodySha256: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: string;
    eventIndex: number;
    direction: "incoming" | "outgoing";
    fromAddress: string;
    toAddress: string;
    amountRaw: string;
  }[];
};

export type ServiceRoleExactEvidenceCaptureReceiptV1 = {
  schemaVersion: "service-role-exact-evidence-capture-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  manifestSha256: string;
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  sampledCanonicalEventIds: { recent: readonly string[]; historical: readonly string[] };
  entries: readonly {
    canonicalEventId: string;
    eventBodySha256: string;
    gasFree: ServiceRoleGasFreeDispositionV1;
    poisoningSha256: string | null;
    providerRiskSha256: string | null;
    role: "ordinary" | "poisoning_only" | "gasfree_fee" | "gasfree_principal" | "provider_risk";
  }[];
};

export type ServiceRoleExactEvidenceCaptureCoverageV1 = {
  schemaVersion: "service-role-exact-evidence-capture-coverage-v1";
  bindings: {
    runId: string;
    snapshotHash: string;
    manifestSha256: string;
    addressHistoryManifestSha256: string;
  };
  sampledEventCount: number;
  uniqueTransactionCount: number;
  validEvidenceCount: number;
  fullyResolvedCount: number;
  missingEvidenceSha256: readonly string[];
  unresolved: readonly {
    canonicalEventId: string;
    dimensions: readonly ("gasFree" | "poisoning" | "providerRisk")[];
    reasons: readonly string[];
  }[];
  receiptSha256: string | null;
};

type Input = {
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  states: readonly TraversalStateV1[];
  anchor: { timestamp: string; sourceEventIds: readonly string[] };
  acceptedHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
    events: readonly IndexedTronUsdtTransfer[];
  };
};

function fail(code: string): never {
  throw new TypeError(`service_role_exact_evidence_capture_${code}`);
}

function sortedUnique(values: readonly string[], code: string): string[] {
  if (values.some((value) => typeof value !== "string" || value.length === 0)) fail(code);
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) fail(code);
  return sorted;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return fingerprintCanonicalArtifact([...left].sort()) === fingerprintCanonicalArtifact([...right].sort());
}

function eventBody(event: IndexedTronUsdtTransfer): Record<string, unknown> {
  if (!(event.blockTimestamp instanceof Date) || !Number.isFinite(event.blockTimestamp.getTime())) fail("event_timestamp_invalid");
  return {
    transferId: event.transferId ?? null,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    blockTimestamp: event.blockTimestamp.toISOString(),
    eventIndex: event.eventIndex,
    provider: event.provider ?? null,
    providerRowOrdinalInTx: event.providerRowOrdinalInTx ?? null,
    fromAddress: event.fromAddress,
    toAddress: event.toAddress,
    amountRaw: event.amountRaw,
    method: event.method,
    eventType: event.eventType ?? null,
    callerAddress: event.callerAddress,
    contractRet: event.contractRet,
    finalResult: event.finalResult ?? null,
    reverted: event.reverted ?? null,
    riskTransaction: event.riskTransaction ?? null,
    confirmed: event.confirmed
  };
}

function shadow(input: Input, state: TraversalStateV1): ServiceRoleShadowArtifactV1 {
  const result = maybeBuildServiceRoleShadowArtifactV1({
    mode: "service-role-shadow-100-plus-100-v1",
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    subjectAddress: input.subjectAddress,
    state,
    acceptedHistory: input.acceptedHistory,
    eventRoleMap: null
  });
  if (!result || result.artifact.result.insufficientReason !== "role_map_missing") fail("shadow_prerequisite_invalid");
  return result.artifact;
}

export function buildServiceRoleExactEvidenceCaptureManifestV1(input: Input): {
  sha256: string;
  artifact: ServiceRoleExactEvidenceCaptureManifestV1;
} {
  if (!HASH.test(input.snapshotHash) || !HASH.test(input.acceptedHistory.manifestSha256) ||
    input.acceptedHistory.manifestKey.length === 0 || input.states.length === 0) fail("binding_invalid");
  const pages = sortedUnique(input.acceptedHistory.pageArtifactHashes, "page_hashes_invalid");
  if (pages.length === 0 || !pages.every((hash) => HASH.test(hash))) fail("page_hashes_invalid");
  const anchorSourceEventIds = sortedUnique(input.anchor.sourceEventIds, "anchor_invalid");
  if (input.anchor.timestamp.length === 0) fail("anchor_invalid");

  const eventsById = new Map<string, { event: IndexedTronUsdtTransfer; bodySha256: string }>();
  for (const event of input.acceptedHistory.events) {
    const id = canonicalTronUsdtEventKey(event);
    const bodySha256 = fingerprintCanonicalArtifact(eventBody(event));
    const prior = eventsById.get(id);
    if (prior) fail(prior.bodySha256 === bodySha256 ? "canonical_event_duplicate" : "canonical_event_tampered");
    eventsById.set(id, { event, bodySha256 });
  }

  const stateIds = input.states.map(traversalStateId);
  if (new Set(stateIds).size !== stateIds.length) fail("state_duplicate");
  const profiledAddress = input.states[0]!.address;
  if (input.states.some((state) => state.address !== profiledAddress ||
    state.anchorTimestamp !== input.anchor.timestamp || !sameValues(state.sourceEventIds, anchorSourceEventIds))) {
    fail("state_anchor_or_profile_invalid");
  }
  const shadows = input.states.map((state) => shadow(input, state));
  const recentHash = fingerprintCanonicalArtifact(shadows[0]!.sampledCanonicalEventIds.recent);
  const historicalHash = fingerprintCanonicalArtifact(shadows[0]!.sampledCanonicalEventIds.historical);
  if (shadows.some((item) => item.sampledCanonicalEventIds.recent.length !== 100 ||
    item.sampledCanonicalEventIds.historical.length !== 100 ||
    fingerprintCanonicalArtifact(item.sampledCanonicalEventIds.recent) !== recentHash ||
    fingerprintCanonicalArtifact(item.sampledCanonicalEventIds.historical) !== historicalHash)) fail("sample_mismatch");
  const recent = [...shadows[0]!.sampledCanonicalEventIds.recent];
  const historical = [...shadows[0]!.sampledCanonicalEventIds.historical];
  const sampled = [...recent, ...historical];
  if (new Set(sampled).size !== 200) fail("sample_duplicate");

  const capturedEvents = sampled.map((canonicalEventId) => {
    const captured = eventsById.get(canonicalEventId);
    if (!captured) fail("sample_event_missing");
    const { event, bodySha256 } = captured;
    const incoming = event.toAddress === profiledAddress && event.fromAddress !== profiledAddress;
    const outgoing = event.fromAddress === profiledAddress && event.toAddress !== profiledAddress;
    if (!incoming && !outgoing) fail("event_direction_invalid");
    return {
      canonicalEventId,
      eventBodySha256: bodySha256,
      txHash: event.txHash.toLowerCase(),
      blockNumber: event.blockNumber,
      blockTimestamp: event.blockTimestamp.toISOString(),
      eventIndex: event.eventIndex,
      direction: incoming ? "incoming" as const : "outgoing" as const,
      fromAddress: event.fromAddress,
      toAddress: event.toAddress,
      amountRaw: event.amountRaw
    };
  });
  const equivalentStateIds = [...stateIds].sort();
  const primaryStateId = equivalentStateIds[0]!;
  const primary = input.states[stateIds.indexOf(primaryStateId)]!;
  const artifact: ServiceRoleExactEvidenceCaptureManifestV1 = {
    schemaVersion: "service-role-exact-evidence-capture-manifest-v1",
    policyVersion: "existing-hash-bound-economic-role-v1",
    parserVersions: {
      gasFree: "gasfree-settlement-disposition-v1",
      poisoning: "address-poisoning-v1",
      providerRisk: "tronscan-risk-transaction-boolean-v1"
    },
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    subjectAddress: input.subjectAddress,
    profiledAddress,
    acceptedHistory: { manifestKey: input.acceptedHistory.manifestKey, manifestSha256: input.acceptedHistory.manifestSha256, pageArtifactHashes: pages },
    traversal: {
      primaryStateId,
      equivalentStateIds,
      anchor: { timestamp: input.anchor.timestamp, sourceEventIds: anchorSourceEventIds },
      sourceEventIds: sortedUnique(primary.sourceEventIds, "source_event_ids_invalid")
    },
    recentCanonicalEventIds: recent,
    historicalCanonicalEventIds: historical,
    provider: { chain: "tron", provider: "tronscan", endpoint: "transaction-info", schemaVersion: "schema1" },
    events: capturedEvents
  };
  return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
}
