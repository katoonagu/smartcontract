import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
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
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleV1,
  type ServiceRoleShadowMode
} from "./serviceRoleShadow";
import type { TraversalStateV1 } from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;
const ROLES: readonly ServiceRoleShadowEventRoleV1[] = [
  "ordinary", "poisoning_only", "gasfree_fee", "gasfree_principal", "provider_risk"
];

export type ServiceRolePoisoningDispositionV1 = {
  schemaVersion: "service-role-poisoning-disposition-v1";
  policyVersion: "address-poisoning-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  coverage: "complete";
  disposition: "not_poisoning" | "poisoning_only";
};

export type ServiceRoleProviderRiskDispositionV1 = {
  schemaVersion: "service-role-provider-risk-disposition-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  disposition: "not_provider_risk" | "provider_risk";
};

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
    ? artifact.schemaVersion === "service-role-poisoning-disposition-v1" &&
      "policyVersion" in artifact && artifact.policyVersion === "address-poisoning-v1" &&
      "coverage" in artifact && artifact.coverage === "complete" &&
      ["not_poisoning", "poisoning_only"].includes(artifact.disposition)
    : artifact.schemaVersion === "service-role-provider-risk-disposition-v1" &&
      ["not_provider_risk", "provider_risk"].includes(artifact.disposition);
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
