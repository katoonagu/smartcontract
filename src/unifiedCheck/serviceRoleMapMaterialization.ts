import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import {
  classifyGasFreeSettlementDispositionV1,
  gasFreeMovementForEdge
} from "../forensics/gasFreeSettlement";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import {
  transactionProviderEvidenceId,
  transactionProviderFinalityWitnessSha256,
  type TronTransactionProviderEvidenceV1
} from "../storage/transactionEvidenceRepository";
import type { IndexedTronUsdtTransfer } from "../types";
import {
  deriveServiceRoleShadowAcceptedHistoryBindingV1,
  maybeBuildServiceRoleShadowArtifactV1,
  parseServiceRoleShadowEventRoleMapV2,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2,
  type ServiceRoleShadowEventRoleV1,
  type ServiceRoleShadowMode
} from "./serviceRoleShadow";
import type { TraversalStateV1 } from "./traversal";
import type {
  ServiceRolePoisoningDispositionV1,
  ServiceRoleProviderRiskDispositionV1
} from "./serviceRoleExactEvidenceCapture";

export type {
  ServiceRolePoisoningDispositionV1,
  ServiceRoleProviderRiskDispositionV1
} from "./serviceRoleExactEvidenceCapture";

const HASH = /^[0-9a-f]{64}$/u;
const ROLES: readonly ServiceRoleShadowEventRoleV1[] = [
  "ordinary", "poisoning_only", "gasfree_fee", "gasfree_principal", "provider_risk"
];

type BoundArtifact<T> = { sha256: string; artifact: T };
type LocalEvidence = {
  canonicalEventId: string;
  transactionInfo: { id: string; evidence: TronTransactionProviderEvidenceV1 } | null;
  poisoning: BoundArtifact<ServiceRolePoisoningDispositionV1> | null;
  providerRisk: BoundArtifact<ServiceRoleProviderRiskDispositionV1> | null;
};
type ShadowInput = {
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
};

type MissingDimension = "gasfree" | "poisoning_only" | "provider_risk";
export type ServiceRoleMaterializationCoverageV1 = {
  schemaVersion: "service-role-materialization-coverage-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  traversalStateIds: readonly string[];
  sampledEventCount: number;
  fullyAuthorizedEventCount: number;
  roleCounts: Record<ServiceRoleShadowEventRoleV1, number>;
  missing: readonly { canonicalEventId: string; dimensions: readonly MissingDimension[] }[];
  conflicts: readonly { canonicalEventId: string; roles: readonly ServiceRoleShadowEventRoleV1[] }[];
};

export type ServiceRoleEventEvidenceBundleV1 = {
  schemaVersion: "service-role-event-evidence-bundle-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  entries: readonly {
    canonicalEventId: string;
    transactionInfoEvidenceId: string;
    transactionInfoPayloadSha256: string;
    transactionInfoFinalityWitnessSha256: string;
    poisoningDispositionSha256: string;
    providerRiskDispositionSha256: string;
    role: ServiceRoleShadowEventRoleV1;
  }[];
};

function canonicalTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function sortedStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") &&
    fingerprintCanonicalArtifact([...value].sort()) === fingerprintCanonicalArtifact(value);
}

function validPoisoningDisposition(artifact: ServiceRolePoisoningDispositionV1): boolean {
  const comparison = artifact.comparison;
  return artifact.schemaVersion === "service-role-poisoning-disposition-v1" &&
    artifact.policyVersion === "address-poisoning-v1" && artifact.coverage === "complete" &&
    ["not_poisoning", "poisoning_only"].includes(artifact.disposition) &&
    ["not_incoming_to_profiled_address", "complete_no_match", "prior_relationship", "candidate"].includes(artifact.reason) &&
    canonicalTimestamp(comparison.windowStart) && canonicalTimestamp(comparison.windowEnd) &&
    sortedStrings(comparison.pageArtifactHashes) && comparison.pageArtifactHashes.every((hash) => HASH.test(hash)) &&
    sortedStrings(comparison.canonicalComparisonEventIds) && HASH.test(comparison.comparisonInventorySha256) &&
    comparison.comparisonInventorySha256 === fingerprintCanonicalArtifact(comparison.canonicalComparisonEventIds) &&
    ["not_applicable", "strictly_earlier_timestamp"].includes(comparison.orderAuthority);
}

function validProviderRiskDisposition(artifact: ServiceRoleProviderRiskDispositionV1): boolean {
  return artifact.schemaVersion === "service-role-provider-risk-disposition-v1" &&
    artifact.policyVersion === "tronscan-risk-transaction-boolean-v1" &&
    typeof artifact.transactionInfoEvidenceId === "string" && artifact.transactionInfoEvidenceId.length > 0 &&
    HASH.test(artifact.transactionInfoPayloadSha256) && typeof artifact.riskTransaction === "boolean" &&
    ["transaction_level_negative", "sole_official_usdt_movement"].includes(artifact.binding) &&
    ["not_provider_risk", "provider_risk"].includes(artifact.disposition);
}

function validBoundDisposition<T extends ServiceRolePoisoningDispositionV1 | ServiceRoleProviderRiskDispositionV1>(
  value: BoundArtifact<T> | null,
  binding: { runId: string; snapshotHash: string; manifestSha256: string; canonicalEventId: string },
  kind: "poisoning" | "provider_risk"
): value is BoundArtifact<T> {
  if (!value || !HASH.test(value.sha256) || fingerprintCanonicalArtifact(value.artifact) !== value.sha256) return false;
  const artifact = value.artifact;
  if (
    artifact.runId !== binding.runId || artifact.snapshotHash !== binding.snapshotHash ||
    artifact.addressHistoryManifestSha256 !== binding.manifestSha256 ||
    artifact.canonicalEventId !== binding.canonicalEventId
  ) return false;
  return kind === "poisoning"
    ? validPoisoningDisposition(artifact as ServiceRolePoisoningDispositionV1)
    : validProviderRiskDisposition(artifact as ServiceRoleProviderRiskDispositionV1);
}

function validTransactionEvidence(
  value: LocalEvidence["transactionInfo"],
  event: IndexedTronUsdtTransfer
): value is NonNullable<LocalEvidence["transactionInfo"]> {
  if (!value) return false;
  const evidence = value.evidence;
  try {
    return evidence.txHash === event.txHash.toLowerCase() &&
      evidence.endpoint === "transaction-info" && evidence.provider === "tronscan" &&
      evidence.finality.status === "confirmed_success" &&
      value.id === transactionProviderEvidenceId(evidence) &&
      HASH.test(evidence.payloadSha256) && evidence.payloadSha256 === fingerprintCanonicalArtifact(evidence.payload) &&
      HASH.test(evidence.finality.witnessSha256) &&
      evidence.finality.witnessSha256 === transactionProviderFinalityWitnessSha256({
        identity: evidence,
        status: evidence.finality.status,
        payload: evidence.payload,
        movement: evidence.finality.movement
      });
  } catch {
    return false;
  }
}

export function materializeServiceRoleEventMapV1(input: {
  shadowInput: ShadowInput;
  localEvidence: readonly LocalEvidence[];
}): {
  coverage: ServiceRoleMaterializationCoverageV1;
  bundle: BoundArtifact<ServiceRoleEventEvidenceBundleV1> | null;
  map: BoundArtifact<ServiceRoleShadowEventRoleMapV1> | null;
} {
  const shadow = maybeBuildServiceRoleShadowArtifactV1({ ...input.shadowInput, eventRoleMap: null });
  if (
    !shadow || shadow.artifact.result.insufficientReason !== "role_map_missing" ||
    shadow.artifact.sampledCanonicalEventIds.recent.length !== 100 ||
    shadow.artifact.sampledCanonicalEventIds.historical.length !== 100
  ) throw new TypeError("service_role_materialization_source_invalid");

  // ponytail: v1 deliberately authorizes one fixed 100+100 sample; version the
  // artifact before widening the window or combining anchors.
  const sampledIds = [
    ...shadow.artifact.sampledCanonicalEventIds.recent,
    ...shadow.artifact.sampledCanonicalEventIds.historical
  ];
  if (new Set(sampledIds).size !== 200) throw new TypeError("service_role_materialization_source_invalid");
  const events = new Map(input.shadowInput.acceptedHistory.events.map((event) => [canonicalTronUsdtEventKey(event), event]));
  const evidenceById = new Map<string, LocalEvidence[]>();
  for (const evidence of input.localEvidence) {
    const values = evidenceById.get(evidence.canonicalEventId) ?? [];
    values.push(evidence);
    evidenceById.set(evidence.canonicalEventId, values);
  }

  const missing: Array<{ canonicalEventId: string; dimensions: MissingDimension[] }> = [];
  const conflicts: Array<{ canonicalEventId: string; roles: ServiceRoleShadowEventRoleV1[] }> = [];
  const resolved: Array<{
    canonicalEventId: string;
    transactionInfoEvidenceId: string;
    transactionInfoPayloadSha256: string;
    transactionInfoFinalityWitnessSha256: string;
    poisoningDispositionSha256: string;
    providerRiskDispositionSha256: string;
    role: ServiceRoleShadowEventRoleV1;
  }> = [];

  for (const canonicalEventId of [...sampledIds].sort()) {
    const event = events.get(canonicalEventId);
    const candidates = evidenceById.get(canonicalEventId) ?? [];
    if (!event || candidates.length !== 1) {
      if (candidates.length > 1) conflicts.push({ canonicalEventId, roles: [] });
      else missing.push({ canonicalEventId, dimensions: ["gasfree", "poisoning_only", "provider_risk"] });
      continue;
    }
    const evidence = candidates[0]!;
    const binding = {
      runId: input.shadowInput.runId,
      snapshotHash: input.shadowInput.snapshotHash,
      manifestSha256: input.shadowInput.acceptedHistory.manifestSha256,
      canonicalEventId
    };
    const dimensions: MissingDimension[] = [];
    const transactionInfo = evidence.transactionInfo;
    const poisoningDisposition = evidence.poisoning;
    const providerRiskDisposition = evidence.providerRisk;
    const transactionValid = validTransactionEvidence(transactionInfo, event);
    const poisoningValid = validBoundDisposition(poisoningDisposition, binding, "poisoning");
    const riskValid = validBoundDisposition(providerRiskDisposition, binding, "provider_risk");
    if (!transactionValid) dimensions.push("gasfree");
    if (!poisoningValid) dimensions.push("poisoning_only");
    if (!riskValid) dimensions.push("provider_risk");

    const roles: ServiceRoleShadowEventRoleV1[] = [];
    let gasFreeNegative = false;
    if (transactionValid) {
      const disposition = classifyGasFreeSettlementDispositionV1(transactionInfo.evidence.payload);
      if (disposition.kind === "not_gasfree_v1") gasFreeNegative = true;
      else if (disposition.kind === "exact_settlement") {
        const movement = gasFreeMovementForEdge(disposition.settlement, event);
        if (movement) roles.push(movement.role === "principal" ? "gasfree_principal" : "gasfree_fee");
        else dimensions.push("gasfree");
      } else dimensions.push("gasfree");
    }
    if (poisoningValid && poisoningDisposition.artifact.disposition === "poisoning_only") roles.push("poisoning_only");
    if (riskValid && providerRiskDisposition.artifact.disposition === "provider_risk") roles.push("provider_risk");
    if (
      dimensions.length === 0 && roles.length === 0 && gasFreeNegative && poisoningValid && riskValid &&
      poisoningDisposition.artifact.disposition === "not_poisoning" &&
      providerRiskDisposition.artifact.disposition === "not_provider_risk"
    ) roles.push("ordinary");

    const uniqueRoles = [...new Set(roles)].sort() as ServiceRoleShadowEventRoleV1[];
    if (uniqueRoles.length > 1) conflicts.push({ canonicalEventId, roles: uniqueRoles });
    else if (dimensions.length > 0 || uniqueRoles.length !== 1 || !transactionValid || !poisoningValid || !riskValid) {
      missing.push({ canonicalEventId, dimensions: [...new Set(dimensions)] });
    } else {
      resolved.push({
        canonicalEventId,
        transactionInfoEvidenceId: transactionInfo.id,
        transactionInfoPayloadSha256: transactionInfo.evidence.payloadSha256,
        transactionInfoFinalityWitnessSha256: transactionInfo.evidence.finality.witnessSha256,
        poisoningDispositionSha256: poisoningDisposition.sha256,
        providerRiskDispositionSha256: providerRiskDisposition.sha256,
        role: uniqueRoles[0]!
      });
    }
  }

  const roleCounts = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<ServiceRoleShadowEventRoleV1, number>;
  for (const entry of resolved) roleCounts[entry.role]++;
  const coverage: ServiceRoleMaterializationCoverageV1 = {
    schemaVersion: "service-role-materialization-coverage-v1",
    runId: input.shadowInput.runId,
    snapshotHash: input.shadowInput.snapshotHash,
    addressHistoryManifestSha256: input.shadowInput.acceptedHistory.manifestSha256,
    traversalStateIds: [shadow.artifact.traversalStateId].sort(),
    sampledEventCount: sampledIds.length,
    fullyAuthorizedEventCount: resolved.length,
    roleCounts,
    missing,
    conflicts
  };
  if (resolved.length !== 200 || missing.length > 0 || conflicts.length > 0) {
    return { coverage, bundle: null, map: null };
  }
  const bundleArtifact: ServiceRoleEventEvidenceBundleV1 = {
    schemaVersion: "service-role-event-evidence-bundle-v1",
    policyVersion: "existing-hash-bound-economic-role-v1",
    runId: input.shadowInput.runId,
    snapshotHash: input.shadowInput.snapshotHash,
    addressHistoryManifestSha256: input.shadowInput.acceptedHistory.manifestSha256,
    entries: resolved
  };
  const bundle = { sha256: fingerprintCanonicalArtifact(bundleArtifact), artifact: bundleArtifact };
  const mapArtifact: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId: input.shadowInput.runId,
    snapshotHash: input.shadowInput.snapshotHash,
    addressHistoryManifestSha256: input.shadowInput.acceptedHistory.manifestSha256,
    entries: resolved.map(({ canonicalEventId, role }) => ({
      canonicalEventId,
      role,
      authority: "existing_hash_bound_economic_role_v1",
      evidenceSha256: bundle.sha256
    }))
  };
  return {
    coverage,
    bundle,
    map: { sha256: fingerprintCanonicalArtifact(mapArtifact), artifact: mapArtifact }
  };
}

export function materializeServiceRoleEventMapV2(input: {
  shadowInput: Parameters<typeof maybeBuildServiceRoleShadowArtifactV1>[0];
  sourceMap: BoundArtifact<ServiceRoleShadowEventRoleMapV1>;
  evidenceBundle: BoundArtifact<ServiceRoleEventEvidenceBundleV1>;
}): {
  artifact: ServiceRoleShadowEventRoleMapV2;
  canonicalJson: string;
  sha256: string;
} {
  try {
    const { shadowInput, sourceMap, evidenceBundle } = input;
    const map = sourceMap.artifact;
    const bundle = evidenceBundle.artifact;
    const manifestSha256 = shadowInput.acceptedHistory.manifestSha256;
    if (shadowInput.mode !== "service-role-shadow-100-plus-100-v1" ||
      !HASH.test(sourceMap.sha256) || fingerprintCanonicalArtifact(map) !== sourceMap.sha256 ||
      !HASH.test(evidenceBundle.sha256) || fingerprintCanonicalArtifact(bundle) !== evidenceBundle.sha256 ||
      map.schemaVersion !== "service-role-shadow-event-role-map-v1" ||
      bundle.schemaVersion !== "service-role-event-evidence-bundle-v1" ||
      bundle.policyVersion !== "existing-hash-bound-economic-role-v1" ||
      typeof shadowInput.runId !== "string" || shadowInput.runId.length === 0 ||
      !HASH.test(shadowInput.snapshotHash) || !HASH.test(manifestSha256) ||
      map.runId !== shadowInput.runId || bundle.runId !== shadowInput.runId ||
      map.snapshotHash !== shadowInput.snapshotHash || bundle.snapshotHash !== shadowInput.snapshotHash ||
      map.addressHistoryManifestSha256 !== manifestSha256 ||
      bundle.addressHistoryManifestSha256 !== manifestSha256 ||
      !Array.isArray(map.entries) || !Array.isArray(bundle.entries) ||
      map.entries.length !== 200 || bundle.entries.length !== 200) {
      throw new TypeError("invalid_root");
    }

    const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
      state: shadowInput.state,
      acceptedHistoryEvents: shadowInput.acceptedHistory.events
    });
    const sampledIds = [
      ...binding.sampledCanonicalEventIds.recent,
      ...binding.sampledCanonicalEventIds.historical
    ];
    const sampledIdSet = new Set(sampledIds);
    const mapById = new Map<string, ServiceRoleShadowEventRoleV1>();
    for (const entry of map.entries) {
      if (typeof entry.canonicalEventId !== "string" || entry.canonicalEventId.length === 0 ||
        !ROLES.includes(entry.role) || entry.authority !== "existing_hash_bound_economic_role_v1" ||
        entry.evidenceSha256 !== evidenceBundle.sha256 || mapById.has(entry.canonicalEventId)) {
        throw new TypeError("invalid_map");
      }
      mapById.set(entry.canonicalEventId, entry.role);
    }
    const bundleById = new Map<string, ServiceRoleShadowEventRoleV1>();
    for (const entry of bundle.entries) {
      if (typeof entry.canonicalEventId !== "string" || entry.canonicalEventId.length === 0 ||
        typeof entry.transactionInfoEvidenceId !== "string" || entry.transactionInfoEvidenceId.length === 0 ||
        !HASH.test(entry.transactionInfoPayloadSha256) ||
        !HASH.test(entry.transactionInfoFinalityWitnessSha256) ||
        !HASH.test(entry.poisoningDispositionSha256) || !HASH.test(entry.providerRiskDispositionSha256) ||
        !ROLES.includes(entry.role) || bundleById.has(entry.canonicalEventId)) {
        throw new TypeError("invalid_bundle");
      }
      bundleById.set(entry.canonicalEventId, entry.role);
    }
    if (sampledIdSet.size !== 200 || sampledIds.some((id) =>
      !mapById.has(id) || !bundleById.has(id) || mapById.get(id) !== bundleById.get(id)) ||
      [...mapById.keys()].some((id) => !bundleById.has(id) || !sampledIdSet.has(id)) ||
      [...bundleById.keys()].some((id) => !mapById.has(id) || !sampledIdSet.has(id))) {
      throw new TypeError("invalid_coverage");
    }

    const candidate: ServiceRoleShadowEventRoleMapV2 = {
      schemaVersion: "service-role-shadow-event-role-map-v2",
      policyVersion: "service-role-shadow-100-plus-100-v1",
      runId: shadowInput.runId,
      snapshotHash: shadowInput.snapshotHash,
      addressHistoryManifestSha256: manifestSha256,
      sourceEventRoleMapV1Sha256: sourceMap.sha256,
      evidenceBundleSha256: evidenceBundle.sha256,
      binding,
      exactCoverage: { recent: 100, historical: 100, total: 200 },
      productionEffect: false
    };
    const canonicalJson = canonicalizeArtifactJson(candidate);
    const sha256 = fingerprintCanonicalArtifact(candidate);
    const artifact = parseServiceRoleShadowEventRoleMapV2({ artifact: candidate, expectedSha256: sha256 });
    if (canonicalizeArtifactJson(artifact) !== canonicalJson || canonicalJson.includes("\n")) {
      throw new TypeError("invalid_canonical_json");
    }
    return { artifact, canonicalJson, sha256 };
  } catch {
    throw new TypeError("service_role_event_role_map_v2_materialization_invalid");
  }
}
