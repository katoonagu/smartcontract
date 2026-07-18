import {
  validateOperationalAttestationV2,
  validateProductionCanaryEvidenceV2,
  validateProductionFailureEvidenceV2,
  validateProductionRecoveryInputV2,
  validateProductionRollbackEvidenceV2 as validateTypedRollbackEvidenceV2,
  validateProductionRolloutEvidenceV2,
  validateSchema032ProductionExecutionReceiptV2
} from "./remediationReleaseManifestV2";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_RELATIVE = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._/-]+$/u;
const SCENARIOS = new Set([
  "g12_binding", "g13_binding", "g13_fail_first_migration", "g13_fail_first_verification",
  "g13_fail_second_migration", "g13_fail_final_verification", "production_failure_code",
  "g13_failure_path", "g14_evidence", "g14_runtime_order", "g14_pre_effect_failure",
  "g15_evidence", "rollback_pre_stop", "rollback_post_stop_pre_start",
  "rollback_post_candidate_start", "rollback_transition_evidence", "preclaim_lineage_swap",
  "production_rollback"
]);

type EvidenceBundleV2 = {
  version: "production-release-evidence-bundle-v2";
  scenario: string;
  candidateSha: string;
  releaseGenerationId: string;
  freezeIdentitySha256: string;
  sourceManifestSha256: string;
  authority: unknown;
  operation: Record<string, unknown>;
  receipts: unknown[];
  captures: unknown[];
  attemptedExternalEffect: boolean;
  evaluatedAt: string;
  [key: string]: unknown;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value as Record<string, unknown>;
}

function rejectSecrets(value: unknown, path = "root"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:password|secret|api_?key|private_?key|database_?url|authorization|chat_?id|actor_?id)/iu.test(key)) {
      throw new Error(`production_evidence_secret_key:${path}.${key}`);
    }
    rejectSecrets(item, `${path}.${key}`);
  }
}

function validateOptionalTypedArtifacts(bundle: Record<string, unknown>): void {
  if (bundle.schemaExecutionReceipt !== undefined) {
    validateSchema032ProductionExecutionReceiptV2(bundle.schemaExecutionReceipt);
  }
  if (bundle.rolloutEvidence !== undefined) validateProductionRolloutEvidenceV2(bundle.rolloutEvidence);
  if (bundle.canaryEvidence !== undefined) validateProductionCanaryEvidenceV2(bundle.canaryEvidence);
  if (bundle.failureEvidence !== undefined) validateProductionFailureEvidenceV2(bundle.failureEvidence);
  if (bundle.rollbackEvidence !== undefined) validateTypedRollbackEvidenceV2(bundle.rollbackEvidence);
  if (bundle.recoveryInput !== undefined) validateProductionRecoveryInputV2(bundle.recoveryInput);
}

export function validateProductionReleaseEvidenceBundleV2(
  value: unknown,
  expected: { expectedCandidateSha?: string; expectedSourceManifestSha256?: string } = {}
): EvidenceBundleV2 {
  rejectSecrets(value);
  const bundle = object(value, "production_release_evidence_bundle");
  if (bundle.version !== "production-release-evidence-bundle-v2"
      || typeof bundle.scenario !== "string" || !SCENARIOS.has(bundle.scenario)
      || typeof bundle.candidateSha !== "string" || !SHA40.test(bundle.candidateSha)
      || typeof bundle.releaseGenerationId !== "string" || bundle.releaseGenerationId.length === 0
      || typeof bundle.freezeIdentitySha256 !== "string" || !SHA256.test(bundle.freezeIdentitySha256)
      || typeof bundle.sourceManifestSha256 !== "string" || !SHA256.test(bundle.sourceManifestSha256)
      || !Array.isArray(bundle.receipts) || !Array.isArray(bundle.captures)
      || typeof bundle.attemptedExternalEffect !== "boolean"
      || typeof bundle.evaluatedAt !== "string" || !Number.isFinite(Date.parse(bundle.evaluatedAt))) {
    throw new Error("production_release_evidence_bundle_invalid");
  }
  if (expected.expectedCandidateSha !== undefined && bundle.candidateSha !== expected.expectedCandidateSha) {
    throw new Error("production_release_candidate_binding_invalid");
  }
  if (expected.expectedSourceManifestSha256 !== undefined
      && bundle.sourceManifestSha256 !== expected.expectedSourceManifestSha256) {
    throw new Error("production_release_source_binding_invalid");
  }
  validateOperationalAttestationV2(bundle.authority);
  const operation = object(bundle.operation, "production_release_operation");
  if (typeof operation.operationId !== "string" || operation.operationId.length === 0
      || !["rollout", "canary", "rollback", "recovery"].includes(String(operation.kind))
      || !["effect_capable", "recovery_only", "cleanup_only"].includes(String(operation.capability))
      || !Number.isSafeInteger(operation.leaseEpoch) || Number(operation.leaseEpoch) < 1
      || typeof operation.operationDeadlineAt !== "string"
      || Date.parse(String(bundle.evaluatedAt)) >= Date.parse(operation.operationDeadlineAt)) {
    throw new Error("production_release_operation_invalid");
  }
  if (bundle.artifacts !== undefined) {
    if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length === 0) throw new Error("production_artifacts_invalid");
    const paths = new Set<string>();
    for (const valueArtifact of bundle.artifacts) {
      const artifact = object(valueArtifact, "production_artifact");
      if (typeof artifact.relativePath !== "string" || !SAFE_RELATIVE.test(artifact.relativePath)
          || paths.has(artifact.relativePath) || typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)
          || typeof artifact.bytesSha256 !== "string" || artifact.bytesSha256 !== artifact.sha256) {
        throw new Error("production_artifact_binding_invalid");
      }
      paths.add(artifact.relativePath);
    }
  }
  if (bundle.policy !== undefined) {
    const policy = object(bundle.policy, "production_failure_policy");
    if (policy.failureCode !== null && policy.failureCode !== "allowlisted_failure") {
      throw new Error("production_failure_code_not_allowlisted");
    }
  }
  if (bundle.preclaimLineage !== undefined) {
    const lineage = object(bundle.preclaimLineage, "production_preclaim_lineage");
    const exact = ["version", "operationId", "relativePath", "preclaimValidationSha256",
      "previousLineageSha256", "originalLeaseSha256", "originalLeaseEpoch",
      "originalLeaseOwnerProcessIdentitySha256", "committedTakeoverReceiptSuffixSha256s",
      "currentTipLeaseSha256", "currentTipLeaseEpoch", "currentTipLeaseOwnerProcessIdentitySha256",
      "lineageStartedAt", "resolvedAt"];
    if (Object.keys(lineage).length !== exact.length || exact.some((key) => !(key in lineage))) {
      throw new Error("production_preclaim_lineage_incomplete");
    }
  }
  validateOptionalTypedArtifacts(bundle);
  return bundle as EvidenceBundleV2;
}

export function validateProductionRollbackEvidenceV2(value: unknown): EvidenceBundleV2 {
  const input = object(value, "production_rollback_bundle");
  if (input.source === "g10_rollback_rehearsal") throw new Error("rollback_rehearsal_not_production_evidence");
  return validateProductionReleaseEvidenceBundleV2(input);
}
