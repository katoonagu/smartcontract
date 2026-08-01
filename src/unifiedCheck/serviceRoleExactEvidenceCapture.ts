import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import {
  classifyGasFreeSettlementDispositionV1,
  gasFreeMovementForEdge
} from "../forensics/gasFreeSettlement";
import {
  ADDRESS_POISONING_POLICY_VERSION,
  detectAddressPoisoning,
  type AddressPoisoningTransfer
} from "../monitor/addressPoisoning";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import {
  transactionProviderEvidenceId,
  transactionProviderFinalityWitnessSha256,
  type TronTransactionProviderEvidenceV1
} from "../storage/transactionEvidenceRepository";
import type { IndexedTronUsdtTransfer } from "../types";
import { TronWeb } from "tronweb";
import {
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowArtifactV1
} from "./serviceRoleShadow";
import { traversalStateId, type TraversalStateV1 } from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;

export type ServiceRoleGasFreeDispositionV1 =
  | {
      disposition: "not_gasfree";
      reason: "controller_not_registered" | "selector_not_registered";
      settlementSha256: null;
      movementSha256: null;
    }
  | {
      disposition: "gasfree_principal" | "gasfree_fee";
      reason: "exact_settlement_movement";
      settlementSha256: string;
      movementSha256: string;
    };

export type ServiceRolePoisoningDispositionV1 = {
  schemaVersion: "service-role-poisoning-disposition-v1";
  policyVersion: "address-poisoning-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  coverage: "complete";
  disposition: "not_poisoning" | "poisoning_only";
  reason: "candidate" | "complete_no_match" | "prior_relationship" | "not_incoming_to_profiled_address";
  comparison: {
    windowStart: string;
    windowEnd: string;
    pageArtifactHashes: readonly string[];
    canonicalComparisonEventIds: readonly string[];
    comparisonInventorySha256: string;
    orderAuthority: "strictly_earlier_timestamp" | "not_applicable";
  };
};

export type ServiceRoleProviderRiskDispositionV1 = {
  schemaVersion: "service-role-provider-risk-disposition-v1";
  policyVersion: "tronscan-risk-transaction-boolean-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  transactionInfoEvidenceId: string;
  transactionInfoPayloadSha256: string;
  riskTransaction: boolean;
  binding: "transaction_level_negative" | "sole_official_usdt_movement";
  disposition: "not_provider_risk" | "provider_risk";
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
  addressHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
  };
  traversal: {
    primaryStateId: string;
    equivalentStateIds: readonly string[];
    anchor: string;
    sourceEventIds: readonly string[];
  };
  sample: {
    recentCanonicalEventIds: readonly string[];
    historicalCanonicalEventIds: readonly string[];
  };
  provider: {
    chain: "tron";
    provider: "tronscan";
    endpoint: "transaction-info";
    providerSchemaVersion: 1;
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
  captureManifestSha256: string;
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  sampledCanonicalEventIds: readonly string[];
  entries: readonly {
    canonicalEventId: string;
    eventBodySha256: string;
    transactionInfoEvidenceId: string;
    transactionInfoPayloadSha256: string;
    transactionInfoFinalityWitnessSha256: string;
    gasFree: ServiceRoleGasFreeDispositionV1;
    poisoningDispositionSha256: string;
    providerRiskDispositionSha256: string;
    role: "ordinary" | "poisoning_only" | "gasfree_fee" | "gasfree_principal" | "provider_risk";
  }[];
};

export type ServiceRoleExactEvidenceCaptureCoverageV1 = {
  schemaVersion: "service-role-exact-evidence-capture-coverage-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  captureManifestSha256: string;
  sampledEventCount: number;
  uniqueTransactionCount: number;
  validTransactionEvidenceCount: number;
  fullyResolvedEventCount: number;
  missingTransactionHashes: readonly string[];
  unresolved: readonly {
    canonicalEventId: string;
    dimensions: readonly ("gasfree" | "poisoning_only" | "provider_risk")[];
    reasons: readonly string[];
  }[];
  completedReceiptSha256: string | null;
};

type Input = {
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  states: readonly TraversalStateV1[];
  anchor: string;
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
    input.acceptedHistory.manifestKey.length === 0 || input.runId.length === 0 || input.states.length !== 7 ||
    !exactAddress(input.subjectAddress)) fail("binding_invalid");
  const pages = sortedUnique(input.acceptedHistory.pageArtifactHashes, "page_hashes_invalid");
  if (pages.length === 0 || !pages.every((hash) => HASH.test(hash))) fail("page_hashes_invalid");
  if (input.anchor.length === 0) fail("anchor_invalid");

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
  if (!exactAddress(profiledAddress) || profiledAddress === input.subjectAddress) fail("binding_invalid");
  if (input.states.some((state) => state.address !== profiledAddress ||
    state.anchorTimestamp !== input.anchor)) {
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
    addressHistory: { manifestKey: input.acceptedHistory.manifestKey, manifestSha256: input.acceptedHistory.manifestSha256, pageArtifactHashes: pages },
    traversal: {
      primaryStateId,
      equivalentStateIds,
      anchor: input.anchor,
      sourceEventIds: sortedUnique(primary.sourceEventIds, "source_event_ids_invalid")
    },
    sample: { recentCanonicalEventIds: recent, historicalCanonicalEventIds: historical },
    provider: { chain: "tron", provider: "tronscan", endpoint: "transaction-info", providerSchemaVersion: 1 },
    events: capturedEvents
  };
  return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
}

type Bound<T> = { sha256: string; artifact: T };
type PoisoningBound = Bound<ServiceRolePoisoningDispositionV1>;
type ProviderRiskBound = Bound<ServiceRoleProviderRiskDispositionV1>;
type ReceiptBound = Bound<ServiceRoleExactEvidenceCaptureReceiptV1>;

type Evaluation = {
  coverage: ServiceRoleExactEvidenceCaptureCoverageV1;
  poisoning: readonly PoisoningBound[];
  providerRisk: readonly ProviderRiskBound[];
  receipt: ReceiptBound | null;
};

type ManifestEvent = ServiceRoleExactEvidenceCaptureManifestV1["events"][number];
type Dimension = "gasfree" | "poisoning_only" | "provider_risk";
type Role = ServiceRoleExactEvidenceCaptureReceiptV1["entries"][number]["role"];

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const raw = value.trim();
    const hex = /^41[0-9a-f]{40}$/iu.test(raw) ? raw
      : /^0x[0-9a-f]{40}$/iu.test(raw) ? `41${raw.slice(2)}`
        : TronWeb.address.toHex(raw);
    if (!/^41[0-9a-f]{40}$/iu.test(hex)) return null;
    const address = TronWeb.address.fromHex(hex);
    return typeof address === "string" ? address : null;
  } catch {
    return null;
  }
}

function sameAddress(left: unknown, right: unknown): boolean {
  const normalizedLeft = exactAddress(left);
  const normalizedRight = exactAddress(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

function exactDecimal(value: unknown): string | null {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? value : null;
}

function selectedRows(payload: Record<string, unknown>): unknown[] | null {
  for (const key of [
    "trc20TransferInfo", "trc20TransferInfoList", "tokenTransferInfo",
    "tokenTransferInfoList", "transfersAllList", "transfers"
  ]) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) return null;
    if (value.length > 0) return value;
  }
  return [];
}

function tokenKind(row: Record<string, unknown>): "official" | "other" | null {
  const aliases: unknown[] = [];
  for (const key of ["contract_address", "contractAddress", "tokenId", "token_id"]) {
    if (Object.prototype.hasOwnProperty.call(row, key)) aliases.push(row[key]);
  }
  for (const key of ["tokenInfo", "token_info"]) {
    const nested = row[key];
    if (nested === undefined || nested === null) continue;
    const token = object(nested);
    if (!token) return null;
    for (const alias of ["tokenId", "token_id"]) {
      if (Object.prototype.hasOwnProperty.call(token, alias)) aliases.push(token[alias]);
    }
  }
  if (aliases.length === 0) return null;
  const normalized = aliases.map(exactAddress);
  if (normalized.some((value) => value === null)) return null;
  if (normalized.some((value) => value !== normalized[0])) return null;
  return sameAddress(normalized[0], TRON_USDT_CONTRACT_ADDRESS) ? "official" : "other";
}

function firstText(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

type OfficialMovement = { fromAddress: string; toAddress: string; amountRaw: string };

function officialUsdtMovements(payload: unknown): OfficialMovement[] | null {
  const transaction = object(payload);
  if (!transaction) return null;
  const rows = selectedRows(transaction);
  if (rows === null) return null;
  const result: OfficialMovement[] = [];
  for (const candidate of rows) {
    const row = object(candidate);
    if (!row) return null;
    const kind = tokenKind(row);
    if (kind === null) return null;
    if (kind === "other") continue;
    const fromAddress = exactAddress(firstText(row, ["from_address", "fromAddress", "from"]));
    const toAddress = exactAddress(firstText(row, ["to_address", "toAddress", "to"]));
    const amountRaw = exactDecimal(firstText(row, ["amount_str", "amountStr", "quant", "amount", "value", "rawAmount"]));
    if (!fromAddress || !toAddress || amountRaw === null) return null;
    result.push({ fromAddress, toAddress, amountRaw });
  }
  return result;
}

function validEvidence(
  evidence: TronTransactionProviderEvidenceV1 | undefined,
  event: ManifestEvent
): { evidence: TronTransactionProviderEvidenceV1; riskTransaction: boolean; movements: OfficialMovement[] | null } | null {
  if (!evidence) return null;
  try {
    const payload = object(evidence.payload);
    if (!payload || typeof payload.hash !== "string" || payload.hash.toLowerCase() !== event.txHash ||
      typeof payload.riskTransaction !== "boolean" || evidence.txHash !== event.txHash ||
      evidence.version !== "tron-transaction-provider-evidence-v1" || evidence.chain !== "tron" ||
      evidence.provider !== "tronscan" || evidence.endpoint !== "transaction-info" ||
      evidence.providerSchemaVersion !== 1 || evidence.finality.status !== "confirmed_success" ||
      evidence.finality.witnessKind !== "tronscan_transaction_info" || evidence.finality.movement !== null ||
      evidence.payloadSha256 !== fingerprintCanonicalArtifact(evidence.payload) ||
      transactionProviderEvidenceId(evidence) !== transactionProviderEvidenceId({
        version: evidence.version, chain: evidence.chain, txHash: evidence.txHash,
        provider: evidence.provider, endpoint: evidence.endpoint, providerSchemaVersion: evidence.providerSchemaVersion
      }) ||
      evidence.finality.witnessSha256 !== transactionProviderFinalityWitnessSha256({
        identity: evidence, status: evidence.finality.status, payload: evidence.payload, movement: null
      })) return null;
    const movements = officialUsdtMovements(evidence.payload);
    return { evidence, riskTransaction: payload.riskTransaction, movements };
  } catch {
    return null;
  }
}

function bound<T>(artifact: T): Bound<T> {
  return { sha256: fingerprintCanonicalArtifact(artifact), artifact };
}

function eventTransfer(event: Pick<ManifestEvent, "txHash" | "fromAddress" | "toAddress" | "amountRaw" | "blockTimestamp">): AddressPoisoningTransfer | null {
  const occurredAt = new Date(event.blockTimestamp);
  if (!Number.isFinite(occurredAt.getTime()) || !exactAddress(event.fromAddress) || !exactAddress(event.toAddress) ||
    exactDecimal(event.amountRaw) === null) return null;
  return {
    txHash: event.txHash,
    sender: event.fromAddress,
    receiver: event.toAddress,
    amountRaw: event.amountRaw,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenDecimals: 6,
    occurredAt
  };
}

function poisoningDisposition(
  manifest: ServiceRoleExactEvidenceCaptureManifestV1,
  event: ManifestEvent,
  acceptedEvents: readonly IndexedTronUsdtTransfer[]
): PoisoningBound | null {
  const timestamp = new Date(event.blockTimestamp);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const base = {
    schemaVersion: "service-role-poisoning-disposition-v1" as const,
    policyVersion: ADDRESS_POISONING_POLICY_VERSION as typeof ADDRESS_POISONING_POLICY_VERSION,
    runId: manifest.runId,
    snapshotHash: manifest.snapshotHash,
    addressHistoryManifestSha256: manifest.addressHistory.manifestSha256,
    canonicalEventId: event.canonicalEventId
  };
  const pages = [...manifest.addressHistory.pageArtifactHashes].sort();
  if (event.direction === "outgoing") return bound({
    ...base, coverage: "complete" as const, disposition: "not_poisoning" as const,
    reason: "not_incoming_to_profiled_address",
    comparison: {
      windowStart: event.blockTimestamp, windowEnd: event.blockTimestamp, pageArtifactHashes: pages,
      canonicalComparisonEventIds: [], comparisonInventorySha256: fingerprintCanonicalArtifact([]), orderAuthority: "not_applicable" as const
    }
  });
  if (acceptedEvents.some((other) => canonicalTronUsdtEventKey(other) !== event.canonicalEventId &&
    other.blockTimestamp instanceof Date && other.blockTimestamp.toISOString() === event.blockTimestamp)) return null;
  const lower = new Date(timestamp.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const compared = acceptedEvents.filter((other) => other.blockTimestamp instanceof Date &&
    Number.isFinite(other.blockTimestamp.getTime()) && other.blockTimestamp.toISOString() >= lower &&
    other.blockTimestamp.toISOString() < event.blockTimestamp)
    .map((item) => ({ canonicalEventId: canonicalTronUsdtEventKey(item), event: item }))
    .sort((left, right) => left.canonicalEventId.localeCompare(right.canonicalEventId));
  const incoming = eventTransfer(event);
  const checkedTransfers = compared.map((item) => eventTransfer({
    txHash: item.event.txHash, fromAddress: item.event.fromAddress, toAddress: item.event.toAddress,
    amountRaw: item.event.amountRaw, blockTimestamp: item.event.blockTimestamp.toISOString()
  }));
  if (!incoming || checkedTransfers.some((value) => value === null)) return null;
  const ids = compared.map((item) => item.canonicalEventId);
  const comparison = {
    windowStart: lower, windowEnd: event.blockTimestamp, pageArtifactHashes: pages,
    canonicalComparisonEventIds: ids, comparisonInventorySha256: fingerprintCanonicalArtifact(ids), orderAuthority: "strictly_earlier_timestamp" as const
  };
  const result = detectAddressPoisoning({ incoming, checkedTransfers: checkedTransfers as AddressPoisoningTransfer[], coverage: "complete", suppression: null });
  if (result.kind === "candidate") return bound({ ...base, coverage: "complete" as const, disposition: "poisoning_only" as const, reason: "candidate", comparison });
  if (result.kind === "clear" && (result.reason === "complete_no_match" || result.reason === "prior_relationship")) {
    return bound({ ...base, coverage: "complete" as const, disposition: "not_poisoning" as const, reason: result.reason, comparison });
  }
  return null;
}

function providerRiskDisposition(
  manifest: ServiceRoleExactEvidenceCaptureManifestV1,
  event: ManifestEvent,
  evidence: ReturnType<typeof validEvidence>
): ProviderRiskBound | null {
  if (!evidence) return null;
  let disposition: "not_provider_risk" | "provider_risk";
  if (!evidence.riskTransaction) disposition = "not_provider_risk";
  else if (evidence.movements !== null && evidence.movements.length === 1 &&
    sameAddress(evidence.movements[0]!.fromAddress, event.fromAddress) &&
    sameAddress(evidence.movements[0]!.toAddress, event.toAddress) &&
    evidence.movements[0]!.amountRaw === event.amountRaw) disposition = "provider_risk";
  else return null;
  return bound({
    schemaVersion: "service-role-provider-risk-disposition-v1",
    policyVersion: "tronscan-risk-transaction-boolean-v1",
    runId: manifest.runId, snapshotHash: manifest.snapshotHash,
    addressHistoryManifestSha256: manifest.addressHistory.manifestSha256,
    canonicalEventId: event.canonicalEventId,
    transactionInfoEvidenceId: transactionProviderEvidenceId(evidence.evidence),
    transactionInfoPayloadSha256: evidence.evidence.payloadSha256,
    riskTransaction: evidence.riskTransaction,
    binding: disposition === "not_provider_risk" ? "transaction_level_negative" : "sole_official_usdt_movement",
    disposition
  });
}

function exactManifestEvents(
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>, acceptedEvents: readonly IndexedTronUsdtTransfer[]
): ServiceRoleExactEvidenceCaptureManifestV1["events"] {
  if (!HASH.test(manifest.sha256) || manifest.sha256 !== fingerprintCanonicalArtifact(manifest.artifact)) fail("manifest_invalid");
  const artifact = manifest.artifact;
  if (
    artifact.schemaVersion !== "service-role-exact-evidence-capture-manifest-v1" ||
    artifact.policyVersion !== "existing-hash-bound-economic-role-v1" ||
    artifact.parserVersions.gasFree !== "gasfree-settlement-disposition-v1" ||
    artifact.parserVersions.poisoning !== "address-poisoning-v1" ||
    artifact.parserVersions.providerRisk !== "tronscan-risk-transaction-boolean-v1" ||
    artifact.provider.chain !== "tron" || artifact.provider.provider !== "tronscan" ||
    artifact.provider.endpoint !== "transaction-info" || artifact.provider.providerSchemaVersion !== 1 ||
    typeof artifact.runId !== "string" || artifact.runId.length === 0 ||
    !HASH.test(artifact.snapshotHash) || !exactAddress(artifact.subjectAddress) || !exactAddress(artifact.profiledAddress) ||
    artifact.subjectAddress === artifact.profiledAddress ||
    typeof artifact.addressHistory.manifestKey !== "string" || artifact.addressHistory.manifestKey.length === 0 ||
    !HASH.test(artifact.addressHistory.manifestSha256)
  ) fail("manifest_bindings_invalid");
  const pages = sortedUnique(artifact.addressHistory.pageArtifactHashes, "manifest_pages_invalid");
  if (pages.length === 0 || !pages.every((page) => HASH.test(page)) || fingerprintCanonicalArtifact(pages) !== fingerprintCanonicalArtifact(artifact.addressHistory.pageArtifactHashes)) {
    fail("manifest_pages_invalid");
  }
  const equivalent = sortedUnique(artifact.traversal.equivalentStateIds, "manifest_traversal_invalid");
  const source = sortedUnique(artifact.traversal.sourceEventIds, "manifest_traversal_invalid");
  if (
    equivalent.length !== 7 || equivalent.some((value) => !HASH.test(value)) ||
    artifact.traversal.primaryStateId !== equivalent[0] || !HASH.test(artifact.traversal.primaryStateId) ||
    fingerprintCanonicalArtifact(equivalent) !== fingerprintCanonicalArtifact(artifact.traversal.equivalentStateIds) ||
    fingerprintCanonicalArtifact(source) !== fingerprintCanonicalArtifact(artifact.traversal.sourceEventIds) ||
    artifact.traversal.anchor !== new Date(artifact.traversal.anchor).toISOString()
  ) fail("manifest_traversal_invalid");
  const sampled = [...artifact.sample.recentCanonicalEventIds, ...artifact.sample.historicalCanonicalEventIds];
  if (new Set(sampled).size !== sampled.length || artifact.events.length !== sampled.length ||
    new Set(artifact.events.map((event) => event.canonicalEventId)).size !== artifact.events.length ||
    fingerprintCanonicalArtifact(sampled) !== fingerprintCanonicalArtifact(artifact.events.map((event) => event.canonicalEventId))) fail("manifest_events_invalid");
  const anchorEvent = artifact.events.find((event) => event.canonicalEventId === artifact.sample.recentCanonicalEventIds[0]);
  if (!anchorEvent || artifact.traversal.anchor !== anchorEvent.blockTimestamp || !source.includes(anchorEvent.canonicalEventId)) {
    fail("manifest_traversal_invalid");
  }
  const events = new Map<string, IndexedTronUsdtTransfer>();
  for (const event of acceptedEvents) {
    const id = canonicalTronUsdtEventKey(event);
    if (events.has(id)) fail("accepted_events_invalid");
    events.set(id, event);
  }
  if (sampled.length === 200) {
    if (artifact.sample.recentCanonicalEventIds.length !== 100 || artifact.sample.historicalCanonicalEventIds.length !== 100) fail("manifest_events_invalid");
    const canonicalOrder = (values: readonly ServiceRoleExactEvidenceCaptureManifestV1["events"][number][]) => [...values]
      .sort((left, right) => right.blockNumber - left.blockNumber ||
        Date.parse(right.blockTimestamp) - Date.parse(left.blockTimestamp) || right.canonicalEventId.localeCompare(left.canonicalEventId))
      .map((event) => event.canonicalEventId);
    if (
      fingerprintCanonicalArtifact(canonicalOrder(artifact.events.slice(0, 100))) !== fingerprintCanonicalArtifact(artifact.sample.recentCanonicalEventIds) ||
      fingerprintCanonicalArtifact(canonicalOrder(artifact.events.slice(100))) !== fingerprintCanonicalArtifact(artifact.sample.historicalCanonicalEventIds)
    ) {
      fail("manifest_events_invalid");
    }
  }
  for (const event of artifact.events) {
    const accepted = events.get(event.canonicalEventId);
    if (!accepted || fingerprintCanonicalArtifact(eventBody(accepted)) !== event.eventBodySha256 ||
      accepted.txHash.toLowerCase() !== event.txHash || accepted.blockTimestamp.toISOString() !== event.blockTimestamp ||
      accepted.blockNumber !== event.blockNumber || accepted.eventIndex !== event.eventIndex ||
      accepted.fromAddress !== event.fromAddress || accepted.toAddress !== event.toAddress || accepted.amountRaw !== event.amountRaw) {
      fail("manifest_event_binding_invalid");
    }
    const incoming = event.toAddress === artifact.profiledAddress && event.fromAddress !== artifact.profiledAddress;
    const outgoing = event.fromAddress === artifact.profiledAddress && event.toAddress !== artifact.profiledAddress;
    if ((!incoming && !outgoing) || event.direction !== (incoming ? "incoming" : "outgoing")) fail("manifest_event_direction_invalid");
  }
  return [...artifact.events].sort((left, right) => left.canonicalEventId.localeCompare(right.canonicalEventId));
}

export function evaluateServiceRoleExactEvidenceCaptureV1(input: {
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>;
  acceptedEvents: readonly IndexedTronUsdtTransfer[];
  transactionEvidence: ReadonlyMap<string, TronTransactionProviderEvidenceV1>;
}): Evaluation {
  const events = exactManifestEvents(input.manifest, input.acceptedEvents);
  const manifest = input.manifest.artifact;
  if (events.length !== 200) {
    return {
      coverage: {
        schemaVersion: "service-role-exact-evidence-capture-coverage-v1",
        runId: manifest.runId, snapshotHash: manifest.snapshotHash, captureManifestSha256: input.manifest.sha256, addressHistoryManifestSha256: manifest.addressHistory.manifestSha256,
        sampledEventCount: events.length,
        uniqueTransactionCount: new Set(events.map((event) => event.txHash)).size,
        validTransactionEvidenceCount: 0,
        fullyResolvedEventCount: 0,
        missingTransactionHashes: [],
        unresolved: events.map((event) => ({
          canonicalEventId: event.canonicalEventId,
          dimensions: ["gasfree", "poisoning_only", "provider_risk"] as const,
          reasons: ["sample_count_not_200"]
        })),
        completedReceiptSha256: null
      },
      poisoning: [], providerRisk: [], receipt: null
    };
  }
  const unresolved: Array<ServiceRoleExactEvidenceCaptureCoverageV1["unresolved"][number]> = [];
  const poisoning: PoisoningBound[] = [];
  const providerRisk: ProviderRiskBound[] = [];
  const gasFree = new Map<string, ServiceRoleGasFreeDispositionV1>();
  const transactionInfo = new Map<string, { id: string; payloadSha256: string; witnessSha256: string }>();
  const roles = new Map<string, Role>();
  const validEvidenceIds = new Set<string>();
  const missingTransactionHashes = new Set<string>();

  for (const event of events) {
    const valid = validEvidence(input.transactionEvidence.get(event.txHash), event);
    const dimensions: Dimension[] = [];
    const reasons: string[] = [];
    if (!valid) {
      dimensions.push("gasfree", "provider_risk");
      reasons.push("transaction_evidence_invalid");
      missingTransactionHashes.add(event.txHash);
    } else {
      validEvidenceIds.add(transactionProviderEvidenceId(valid.evidence));
      transactionInfo.set(event.canonicalEventId, {
        id: transactionProviderEvidenceId(valid.evidence),
        payloadSha256: valid.evidence.payloadSha256,
        witnessSha256: valid.evidence.finality.witnessSha256
      });
      const classified = classifyGasFreeSettlementDispositionV1(valid.evidence.payload);
      if (classified.kind === "not_gasfree_v1") {
        gasFree.set(event.canonicalEventId, {
          disposition: "not_gasfree", reason: classified.reason,
          settlementSha256: null, movementSha256: null
        });
      } else if (classified.kind === "exact_settlement") {
        const movement = gasFreeMovementForEdge(classified.settlement, event);
        if (!movement) { dimensions.push("gasfree"); reasons.push("gasfree_movement_unresolved"); }
        else gasFree.set(event.canonicalEventId, {
          disposition: movement.role === "principal" ? "gasfree_principal" : "gasfree_fee",
          reason: "exact_settlement_movement",
          settlementSha256: fingerprintCanonicalArtifact(classified.settlement),
          movementSha256: fingerprintCanonicalArtifact(movement)
        });
      } else { dimensions.push("gasfree"); reasons.push("gasfree_unresolved"); }
      const risk = providerRiskDisposition(manifest, event, valid);
      if (risk) providerRisk.push(risk);
      else { dimensions.push("provider_risk"); reasons.push("provider_risk_unresolved"); }
    }
    const poison = poisoningDisposition(manifest, event, input.acceptedEvents);
    if (poison) poisoning.push(poison);
    else { dimensions.push("poisoning_only"); reasons.push("poisoning_unresolved"); }
    if (dimensions.length === 0) {
      const positives: Exclude<Role, "ordinary">[] = [];
      const gas = gasFree.get(event.canonicalEventId)!;
      const risk = providerRisk[providerRisk.length - 1]!;
      const poisonResult = poisoning[poisoning.length - 1]!;
      if (gas.disposition !== "not_gasfree") positives.push(gas.disposition);
      if (risk.artifact.disposition === "provider_risk") positives.push("provider_risk");
      if (poisonResult.artifact.disposition === "poisoning_only") positives.push("poisoning_only");
      if (positives.length === 0) roles.set(event.canonicalEventId, "ordinary");
      else if (positives.length === 1) roles.set(event.canonicalEventId, positives[0]!);
      else { dimensions.push(...positives.map((role) => role === "poisoning_only" ? "poisoning_only" : role === "provider_risk" ? "provider_risk" : "gasfree")); reasons.push("role_conflict"); }
    }
    if (dimensions.length) unresolved.push({ canonicalEventId: event.canonicalEventId, dimensions: [...new Set(dimensions)], reasons: [...new Set(reasons)].sort() });
  }
  const coverageBase: Omit<ServiceRoleExactEvidenceCaptureCoverageV1, "completedReceiptSha256"> = {
    schemaVersion: "service-role-exact-evidence-capture-coverage-v1",
    runId: manifest.runId, snapshotHash: manifest.snapshotHash, captureManifestSha256: input.manifest.sha256, addressHistoryManifestSha256: manifest.addressHistory.manifestSha256,
    sampledEventCount: events.length, uniqueTransactionCount: new Set(events.map((event) => event.txHash)).size,
    validTransactionEvidenceCount: validEvidenceIds.size, fullyResolvedEventCount: roles.size,
    missingTransactionHashes: [...missingTransactionHashes].sort(), unresolved
  };
  if (events.length !== 200 || unresolved.length || roles.size !== 200) {
    return { coverage: { ...coverageBase, completedReceiptSha256: null }, poisoning: [], providerRisk: [], receipt: null };
  }
  const poisoningById = new Map(poisoning.map((item) => [item.artifact.canonicalEventId, item]));
  const riskById = new Map(providerRisk.map((item) => [item.artifact.canonicalEventId, item]));
  const receiptArtifact: ServiceRoleExactEvidenceCaptureReceiptV1 = {
    schemaVersion: "service-role-exact-evidence-capture-v1", policyVersion: "existing-hash-bound-economic-role-v1",
    captureManifestSha256: input.manifest.sha256, runId: manifest.runId, snapshotHash: manifest.snapshotHash,
    addressHistoryManifestSha256: manifest.addressHistory.manifestSha256,
    sampledCanonicalEventIds: [...manifest.sample.recentCanonicalEventIds, ...manifest.sample.historicalCanonicalEventIds],
    entries: events.map((event) => ({
      canonicalEventId: event.canonicalEventId, eventBodySha256: event.eventBodySha256,
      transactionInfoEvidenceId: transactionInfo.get(event.canonicalEventId)!.id,
      transactionInfoPayloadSha256: transactionInfo.get(event.canonicalEventId)!.payloadSha256,
      transactionInfoFinalityWitnessSha256: transactionInfo.get(event.canonicalEventId)!.witnessSha256,
      gasFree: gasFree.get(event.canonicalEventId)!, poisoningDispositionSha256: poisoningById.get(event.canonicalEventId)!.sha256,
      providerRiskDispositionSha256: riskById.get(event.canonicalEventId)!.sha256, role: roles.get(event.canonicalEventId)!
    }))
  };
  const receipt = bound(receiptArtifact);
  return { coverage: { ...coverageBase, completedReceiptSha256: receipt.sha256 }, poisoning, providerRisk, receipt };
}

export function validateServiceRoleExactEvidenceCaptureReceiptV1(input: {
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>;
  receipt: ReceiptBound;
  acceptedEvents: readonly IndexedTronUsdtTransfer[];
  transactionEvidence: ReadonlyMap<string, TronTransactionProviderEvidenceV1>;
  poisoning: ReadonlyMap<string, PoisoningBound>;
  providerRisk: ReadonlyMap<string, ProviderRiskBound>;
}): ReadonlyMap<string, ServiceRoleExactEvidenceCaptureReceiptV1["entries"][number]> {
  const manifestEvents = exactManifestEvents(input.manifest, input.acceptedEvents);
  const expectedTransactions = new Set(manifestEvents.map((event) => event.txHash));
  if (input.transactionEvidence.size !== expectedTransactions.size ||
    [...input.transactionEvidence].some(([txHash, evidence]) => !expectedTransactions.has(txHash) || evidence.txHash !== txHash)) {
    fail("receipt_transaction_evidence_invalid");
  }
  const expected = evaluateServiceRoleExactEvidenceCaptureV1(input);
  let actualReceiptSha256: string;
  try {
    actualReceiptSha256 = fingerprintCanonicalArtifact(input.receipt.artifact);
  } catch {
    fail("receipt_invalid");
  }
  if (!expected.receipt || input.receipt.sha256 !== actualReceiptSha256 ||
    input.receipt.sha256 !== expected.receipt.sha256 || actualReceiptSha256 !== fingerprintCanonicalArtifact(expected.receipt.artifact)) {
    fail("receipt_invalid");
  }
  const entries = new Map<string, ServiceRoleExactEvidenceCaptureReceiptV1["entries"][number]>();
  if (input.receipt.artifact.entries.length !== 200) fail("receipt_entries_invalid");
  for (const entry of input.receipt.artifact.entries) {
    if (entries.has(entry.canonicalEventId)) fail("receipt_entries_invalid");
    const poison = input.poisoning.get(entry.canonicalEventId);
    const risk = input.providerRisk.get(entry.canonicalEventId);
    const evidence = input.transactionEvidence.get(manifestEvents.find((event) => event.canonicalEventId === entry.canonicalEventId)?.txHash ?? "");
    if (!poison || !risk || poison.sha256 !== entry.poisoningDispositionSha256 || risk.sha256 !== entry.providerRiskDispositionSha256 ||
      poison.sha256 !== fingerprintCanonicalArtifact(poison.artifact) || risk.sha256 !== fingerprintCanonicalArtifact(risk.artifact) ||
      !evidence || entry.transactionInfoEvidenceId !== transactionProviderEvidenceId(evidence) ||
      entry.transactionInfoPayloadSha256 !== evidence.payloadSha256 || entry.transactionInfoFinalityWitnessSha256 !== evidence.finality.witnessSha256) fail("receipt_entries_invalid");
    entries.set(entry.canonicalEventId, entry);
  }
  if (input.poisoning.size !== 200 || input.providerRisk.size !== 200 || entries.size !== 200) fail("receipt_entries_invalid");
  return entries;
}
