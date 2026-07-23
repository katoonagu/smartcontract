import { createHash } from "node:crypto";
import {
  deriveTask0BProductionGateBindingV2,
  validateGateEvidenceBytesV2,
  type GateEvidenceBindingContextV2,
  type GateEvidencePayloadV2
} from "./releaseGateEvidencePolicy";

export const RELEASE_GATE_IDS_V2 = [
  "G00_BASE", "G01_TRACE", "G02_DATA", "G03_SCORING", "G04_RUNTIME",
  "G05_TELEGRAM", "G06_FULL", "G07_SCHEMA_OFFLINE", "G08_VERSION_SANITIZED",
  "G09_LEGACY_TERMINAL", "G10_ROLLBACK_REHEARSAL", "G11_POISONING_REGRESSION",
  "G12_PRODUCTION_BACKUP", "G13_PRODUCTION_MIGRATION", "G14_PRODUCTION_ROLLOUT",
  "G15_PRODUCTION_CANARY"
] as const;

export const PRE_RELEASE_GATE_IDS_V2 = RELEASE_GATE_IDS_V2.slice(0, 12) as readonly ReleaseGateIdV2[];
export const PRODUCTION_GATE_IDS_V2 = RELEASE_GATE_IDS_V2.slice(12) as readonly ProductionGateIdV2[];

export const MANIFEST_TRANSITIONS_V2 = [
  "pre_manual", "readiness", "g12_backup_passed", "g13_migration_passed",
  "g14_rollout_passed", "g15_canary_released", "production_failed",
  "rollback_rolled_back"
] as const;

export const RELEASE_COMMAND_IDS_V2 = [
  "base_audit", "acceptance_trace", "plan1_focused", "plan2_focused",
  "plan3_focused", "plan4_focused", "full_regression",
  "schema_production_clone_rehearsal", "runtime_sanitized_rehearsal",
  "manual_telegram_acceptance", "legacy_terminal_population", "rollback_rehearsal",
  "artifact_root_preflight", "release_freeze_materialize",
  "operational_authority_issue", "operational_authority_terminalize",
  "manifest_lease_takeover", "production_operation_lease_takeover",
  "production_operation_cleanup_only_takeover", "production_recovery",
  "address_poisoning_regression", "production_backup", "production_migration",
  "production_rollout", "production_canary", "production_rollback"
] as const;

export const GATE_EVIDENCE_KINDS_V2 = [
  "task0_baseline", "trusted_os_principal_policy", "release_freeze_materialization",
  "acceptance_trace", "task8b_red", "suite_report", "suite_evidence",
  "full_regression", "plan_a_gate_receipt", "unified_release_gate_receipt",
  "schema_clean", "schema_production_clone",
  "schema_runtime_sanitized", "runtime_rehearsal", "terminal_legacy_population",
  "rollback_rehearsal", "manual_telegram_acceptance", "operational_attestation",
  "production_backup_authority", "production_backup_consumption", "production_backup_dump_progress",
  "production_backup_list_progress", "production_backup_dump",
  "production_backup_restore_list", "production_backup_evidence",
  "production_migration_authority", "production_migration_consumption", "production_migration_attempt",
  "production_migration_prepared_settlement", "production_migration_sequence", "production_operation_claim",
  "production_operation_settlement", "production_operation_lease_removal_prepared",
  "production_operation_lease_removal", "production_operation_cleanup",
  "production_rollout_manager", "production_rollout_queries",
  "production_rollout_orchestration", "production_rollout_evidence",
  "production_canary_queries", "production_canary_logs",
  "production_canary_orchestration", "production_canary_evidence"
] as const;

export const OPERATIONAL_ATTESTATION_POLICY_V2 = Object.freeze({
  g12_backup_passed: {
    commandId: "production_backup",
    redactedTemplate: "release:production:backup <database-fingerprint> <protected-artifact-root>"
  },
  g13_migration_passed: {
    commandId: "production_migration",
    redactedTemplate: "release:production:migrate schema-032 <database-fingerprint>"
  },
  g14_rollout_passed: {
    commandId: "production_rollout",
    redactedTemplate: "release:production:rollout <candidate-sha> <runtime-label>"
  },
  g15_canary_released: {
    commandId: "production_canary",
    redactedTemplate: "release:production:canary <candidate-sha> <runtime-label>"
  },
  production_failed: {
    commandId: "production_recovery",
    redactedTemplate: "release:production:recovery <abandoned-operation> <protected-artifact-root>"
  },
  rollback_rolled_back: {
    commandId: "production_rollback",
    redactedTemplate: "release:production:rollback <previous-runtime-sha> <runtime-label>"
  }
} as const);

export const MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2 = createHash("sha256")
  .update("release:manifest:takeover <expected-old-lease-sha256> <protected-artifact-root>", "utf8")
  .digest("hex");

export function rootWriterOwnerProcessIdentitySha256V2(
  ownerPid: number,
  ownerProcessStartFingerprintSha256: string
): string {
  if (!Number.isSafeInteger(ownerPid) || ownerPid < 1
      || !/^[0-9a-f]{64}$/u.test(ownerProcessStartFingerprintSha256)) {
    throw new Error("root_writer_owner_process_identity_invalid");
  }
  return createHash("sha256").update(canonicalReleaseJsonV2({
    ownerPid,
    ownerProcessStartFingerprintSha256
  }), "utf8").digest("hex");
}

export function operationalAttestationTemplateSha256V2(
  transitionId: keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2
): string {
  return createHash("sha256")
    .update(OPERATIONAL_ATTESTATION_POLICY_V2[transitionId].redactedTemplate, "utf8")
    .digest("hex");
}

export const REQUIRED_REQUIREMENT_IDS_V2 = Array.from(
  { length: 38 }, (_, index) => `REQ-${String(index + 1).padStart(2, "0")}`
) as readonly string[];
export const REQUIRED_ACCEPTANCE_IDS_V2 = Array.from(
  { length: 41 }, (_, index) => `AC-${String(index + 1).padStart(2, "0")}`
) as readonly string[];

export type ReleaseGateIdV2 = typeof RELEASE_GATE_IDS_V2[number];
export type ProductionGateIdV2 = Extract<ReleaseGateIdV2,
  "G12_PRODUCTION_BACKUP" | "G13_PRODUCTION_MIGRATION" |
  "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY">;
export type ManifestTransitionIdV2 = typeof MANIFEST_TRANSITIONS_V2[number];
export type ReleaseCommandIdV2 = typeof RELEASE_COMMAND_IDS_V2[number];
export type GateEvidenceKindV2 = typeof GATE_EVIDENCE_KINDS_V2[number];

export type ReleaseFreezeIdentityV2 = {
  version: "release-freeze-identity-v2";
  releaseGenerationId: string;
  candidateSha: string;
  planBaseSha: string;
  artifactRootFingerprintSha256: string;
  artifactRootTrustBoundaryEvidenceSha256: string;
  productionDatabaseIdentityFingerprintSha256: string;
  postgresToolIdentitySha256: string;
  previousRuntimeDiscoverySha256: string;
  rollbackWorktreeIdentitySha256: string;
  createdAt: string;
};

export type OperationalAttestationV2 = {
  version: "operational-attestation-v2";
  action: ManifestTransitionIdV2;
  generationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  commandId: ReleaseCommandIdV2;
  redactedTemplateSha256: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  issuedAt: string;
  expiresAt: string;
};

export type ReleaseFreezeMaterializationReceiptV2 = {
  version: "release-freeze-materialization-receipt-v2";
  commandId: "release_freeze_materialize";
  redactedTemplateSha256: string;
  task0BPreflightEvidenceSha256: string;
  protectedRootFingerprintSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  bootstrapLeaseSha256: string;
  bootstrapLeaseEpoch: number;
  canonicalFreezeIdentity: ReleaseFreezeIdentityV2;
  canonicalFreezeIdentityUtf8Base64: string;
  canonicalFreezeIdentitySha256: string;
  materializedAt: string;
};

export type PreparedReleaseFreezeMaterializationV2 = {
  version: "prepared-release-freeze-materialization-v2";
  commandId: "release_freeze_materialize";
  redactedTemplateSha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  bootstrapLeaseSha256: string;
  bootstrapLeaseEpoch: number;
  canonicalFreezeIdentity: ReleaseFreezeIdentityV2;
  canonicalFreezeIdentityUtf8Base64: string;
  canonicalFreezeIdentitySha256: string;
  canonicalFreezeIdentityRelativePath: "release-freeze-identity-v2.json";
  canonicalMaterializationReceipt: ReleaseFreezeMaterializationReceiptV2;
  canonicalMaterializationReceiptUtf8Base64: string;
  canonicalMaterializationReceiptSha256: string;
  canonicalMaterializationReceiptRelativePath: "release-freeze-materialization-receipt-v2.json";
  preparedAt: string;
};

export type OperationalAttestationIssuerReceiptV2 = {
  version: "operational-attestation-issuer-receipt-v2";
  commandId: "operational_authority_issue";
  redactedTemplateSha256: string;
  action: ManifestTransitionIdV2;
  generationId: string;
  sequence: number;
  previousIssuerReceiptSha256: string | null;
  attestationRelativePath: string;
  attestationSha256: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  issuedAt: string;
};

export type CommittedOperationalAttestationIssuanceV2 = {
  version: "committed-operational-attestation-issuance-v2";
  commandId: "operational_authority_issue";
  redactedTemplateSha256: string;
  action: ManifestTransitionIdV2;
  generationId: string;
  issuanceIntentSha256: string;
  attestationSha256: string;
  issuerReceiptSha256: string;
  committedAt: string;
};

export type PreparedOperationalAttestationIssuanceV2 = {
  version: "prepared-operational-attestation-issuance-v2";
  commandId: "operational_authority_issue";
  redactedTemplateSha256: string;
  action: ManifestTransitionIdV2;
  generationId: string;
  sequence: number;
  previousIssuerReceiptSha256: string | null;
  canonicalAttestation: OperationalAttestationV2;
  canonicalAttestationUtf8Base64: string;
  canonicalAttestationSha256: string;
  canonicalAttestationRelativePath: string;
  canonicalIssuerReceipt: OperationalAttestationIssuerReceiptV2;
  canonicalIssuerReceiptUtf8Base64: string;
  canonicalIssuerReceiptSha256: string;
  canonicalIssuerReceiptRelativePath: string;
  canonicalCommittedIssuance: CommittedOperationalAttestationIssuanceV2;
  canonicalCommittedIssuanceUtf8Base64: string;
  canonicalCommittedIssuanceSha256: string;
  canonicalCommittedIssuanceRelativePath: string;
  previousAttestationSha256: string | null;
  priorTerminalLineageSha256: string | null;
  preparedAt: string;
};

export type AuthorityTerminalReceiptV2 = {
  version: "authority-terminal-receipt-v2";
  commandId: "operational_authority_terminalize";
  redactedTemplateSha256: string;
  action: ManifestTransitionIdV2;
  generationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  attestationSha256: string;
  issuerReceiptSha256: string;
  previousIssuerReceiptSha256: string | null;
  reason: "expired_unclaimed";
  preclaimAbsent: true;
  claimAbsent: true;
  consumptionAbsent: true;
  actionLeaseAbsent: true;
  g13BoundSessionAbsent: true;
  g13AdvisoryLockAbsent: true;
  operationAbsent: true;
  externalEffectCount: 0;
  terminalizedAt: string;
};

export type PreparedAuthorityTerminalV2 = {
  version: "prepared-authority-terminal-v2";
  commandId: "operational_authority_terminalize";
  redactedTemplateSha256: string;
  canonicalTerminalReceipt: AuthorityTerminalReceiptV2;
  canonicalTerminalReceiptUtf8Base64: string;
  canonicalTerminalReceiptSha256: string;
  canonicalTerminalReceiptRelativePath: string;
  preparedAt: string;
};

export type GateEvidenceRefV2 = {
  kind: GateEvidenceKindV2;
  relativePath: string;
  sha256: string;
  schemaVersion: string;
  candidateSha: string;
};

export type ProductionFailureTransitionEvidenceRefV2 = {
  kind: "production_failure_evidence";
  relativePath: "production-failure-evidence-v2.json";
  sha256: string;
  schemaVersion: "production-failure-evidence-v2";
  candidateSha: string;
  sourceManifestSha256: string;
};

export type ActualRollbackTransitionEvidenceRefV2 = {
  kind: "actual_rollback_evidence";
  relativePath: "production-rollback-evidence-v2.json";
  sha256: string;
  schemaVersion: "production-rollback-evidence-v2";
  candidateSha: string;
  sourceManifestSha256: string;
};

export type ManifestTransitionEvidenceRefV2 =
  | ProductionFailureTransitionEvidenceRefV2
  | ActualRollbackTransitionEvidenceRefV2;

export type ProductionRollbackOutcomeV2 =
  | {
      kind: "previous_runtime_retained";
      failedGateId: "G13_PRODUCTION_MIGRATION" | "G14_PRODUCTION_ROLLOUT";
      previousRuntimeHealthEvidenceSha256: string;
      noPreviousStopEvidenceSha256: string;
      noCandidateStartEvidenceSha256: string;
    }
  | {
      kind: "previous_runtime_restarted_without_candidate";
      failedGateId: "G14_PRODUCTION_ROLLOUT";
      previousStopEvidenceSha256: string;
      noCandidateStartEvidenceSha256: string;
      previousStartEvidenceSha256: string;
    }
  | {
      kind: "candidate_replaced_with_previous";
      failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
      candidateStartEvidenceSha256: string;
      candidateStopEvidenceSha256: string;
      previousStartEvidenceSha256: string;
    };

export type ProductionOperationKindV2 = "rollout" | "canary" | "rollback" | "recovery";
export type ProductionOperationCapabilityV2 = "effect_capable" | "recovery_only" | "cleanup_only";
export type ProductionOperationCommandIdV2 =
  | "production_rollout" | "production_canary" | "production_rollback" | "production_recovery";

export type ProductionAuthorityPreclaimValidationV2 = {
  version: "production-authority-preclaim-validation-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  commandId: ProductionOperationCommandIdV2;
  redactedTemplateSha256: string;
  originalLeaseSha256: string;
  originalLeaseEpoch: number;
  originalLeaseOwnerProcessIdentitySha256: string;
  checkedAt: string;
  expiresAt: string;
  operationDeadlineAt: string;
  minimumRequiredValidityMs: number;
  status: "fresh_compatible_unconsumed";
};

export type ProductionPreclaimLeaseLineageV2 = {
  version: "production-preclaim-lease-lineage-v2";
  operationId: string;
  relativePath: string;
  preclaimValidationSha256: string;
  previousLineageSha256: string | null;
  originalLeaseSha256: string;
  originalLeaseEpoch: number;
  originalLeaseOwnerProcessIdentitySha256: string;
  committedTakeoverReceiptSuffixSha256s: [] | [string];
  currentTipLeaseSha256: string;
  currentTipLeaseEpoch: number;
  currentTipLeaseOwnerProcessIdentitySha256: string;
  lineageStartedAt: string;
  resolvedAt: string;
};

export type OperationalAttestationConsumptionV2 = {
  version: "operational-attestation-consumption-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  preclaimValidationSha256: string;
  preclaimLeaseLineageRelativePath: string;
  preclaimLeaseLineageSha256: string;
  preclaimLeaseLineageCurrentTipSha256: string;
  commandId: ProductionOperationCommandIdV2;
  redactedTemplateSha256: string;
  leaseSha256AtConsumption: string;
  leaseEpochAtConsumption: number;
  consumedAt: string;
  expiresAt: string;
  operationDeadlineAt: string;
};

export type ProductionOperationClaimV2 = {
  version: "production-operation-claim-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  authorityConsumption: OperationalAttestationConsumptionV2;
  authorityConsumptionSha256: string;
  preclaimLeaseLineageRelativePath: string;
  preclaimLeaseLineageSha256: string;
  preclaimLeaseLineageCurrentTipSha256: string;
  capability: "effect_capable" | "recovery_only";
  leaseEpochAtConsumption: number;
  operationDeadlineAt: string;
  claimedAt: string;
  claimantPid: number;
  claimantProcessStartFingerprintSha256: string;
};

export type ProductionOperationLeaseV2 = {
  version: "production-operation-lease-v2";
  scope: "artifact_root_production_operation";
  relativePath: "production-operation-root.lease.json";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  operationalAttestationSha256: string;
  recoveryFromAbandonedOperationSha256: string | null;
  capability: ProductionOperationCapabilityV2;
  leaseEpoch: number;
  ownerPid: number;
  ownerProcessStartFingerprintSha256: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  operationDeadlineAt: string;
};

export type PreparedProductionOperationLeaseTakeoverV2 = {
  version: "prepared-production-operation-lease-takeover-v2";
  commandId: "production_operation_lease_takeover";
  redactedTemplateSha256: string;
  capability: "effect_capable" | "recovery_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: ProductionOperationLeaseV2 & { capability: "effect_capable" | "recovery_only" };
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  preparedAt: string;
};

export type CommittedProductionOperationLeaseTakeoverV2 = {
  version: "committed-production-operation-lease-takeover-v2";
  commandId: "production_operation_lease_takeover";
  redactedTemplateSha256: string;
  capability: "effect_capable" | "recovery_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  committedAt: string;
};

export type PreparedCleanupOnlyProductionOperationTakeoverV2 = {
  version: "prepared-cleanup-only-production-operation-takeover-v2";
  commandId: "production_operation_cleanup_only_takeover";
  redactedTemplateSha256: string;
  capability: "cleanup_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  terminalReason: "authority_expired_before_claim" | "authority_expired_after_claim" | "operation_deadline_reached";
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: ProductionOperationLeaseV2 & { capability: "cleanup_only" };
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  preparedAt: string;
};

export type CleanupOnlyProductionOperationTakeoverV2 = {
  version: "cleanup-only-production-operation-takeover-v2";
  commandId: "production_operation_cleanup_only_takeover";
  redactedTemplateSha256: string;
  capability: "cleanup_only";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  artifactRootFingerprintSha256: string;
  authorityConsumptionSha256: string | null;
  terminalReason: "authority_expired_before_claim" | "authority_expired_after_claim" | "operation_deadline_reached";
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  operationDeadlineAt: string;
  committedAt: string;
};

type ProductionOperationSettlementCommonV2 = {
  version: "production-operation-settlement-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  claimSha256: string;
  authorityConsumptionSha256: string;
  finalLeaseSha256: string;
  finalLeaseEpoch: number;
  operationDeadlineAt: string;
  terminalEvidenceSha256: string;
  authorityRevalidatedAt: string;
  deadlineRevalidatedAt: string;
  settledAt: string;
};

export type ProductionOperationSettlementV2 = ProductionOperationSettlementCommonV2 & (
  | { capability: "effect_capable"; result: "passed"; orchestrationReceiptSha256: string; attemptedExternalEffect: boolean }
  | { capability: "effect_capable"; result: "failed"; orchestrationReceiptSha256: string | null; attemptedExternalEffect: boolean }
  | { capability: "recovery_only"; result: "failed"; orchestrationReceiptSha256: string; recoveryAttemptedExternalEffect: false; priorAttemptedExternalEffect: boolean }
);

export type ProductionOperationLeaseRemovalReceiptV2 = {
  version: "production-operation-lease-removal-receipt-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalStateKind: "settlement" | "terminal_abandoned";
  terminalStateSha256: string;
  capability: ProductionOperationCapabilityV2;
  removedLeaseSha256: string;
  removedLeaseEpoch: number;
  removedAt: string;
};

export type PreparedProductionOperationLeaseRemovalV2 = {
  version: "prepared-production-operation-lease-removal-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalStateKind: "settlement" | "terminal_abandoned";
  terminalStateSha256: string;
  capability: ProductionOperationCapabilityV2;
  exactCurrentLeaseSha256: string;
  exactCurrentLeaseEpoch: number;
  canonicalRemovalReceipt: ProductionOperationLeaseRemovalReceiptV2;
  canonicalRemovalReceiptUtf8Base64: string;
  canonicalRemovalReceiptSha256: string;
  preparedAt: string;
};

export type ProductionOperationTerminalCleanupV2 = {
  version: "production-operation-terminal-cleanup-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  terminalStateSha256: string;
  capability: ProductionOperationCapabilityV2;
  preparedRemovalSha256: string;
  leaseRemovalReceiptSha256: string;
  removedLeaseSha256: string;
  cleanedAt: string;
};

export type ProductionOperationTerminalAbandonedV2 = {
  version: "production-operation-terminal-abandoned-v2";
  operationKind: ProductionOperationKindV2;
  operationId: string;
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  claimSha256: string | null;
  authorityConsumptionSha256: string | null;
  capability: ProductionOperationCapabilityV2;
  cleanupOnlyTakeoverSha256: string | null;
  finalLeaseSha256: string;
  finalLeaseEpoch: number;
  completedStepReceiptSetSha256: string;
  attemptedExternalEffect: boolean;
  reason: "authority_expired_before_claim" | "authority_expired_after_claim" | "operation_deadline_reached" | "ownership_protocol_failure";
  abandonedAt: string;
};

export type Schema032ReleaseEvidenceV1 = {
  candidateSha: string;
  databaseRole: "clean" | "production_clone" | "runtime_sanitized" | "production";
  databaseFingerprintSha256: string;
  migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql";
  candidateBytesChecksumSha256: string;
  receiptChecksumSha256: string;
  shortChecksum: string;
  postconditionsSha256: string;
  schema033: {
    version: 33;
    migrationFilename: "033_unified_wallet_check.sql";
    checksumSha256: string;
    catalogSha256: string;
    verificationReceiptSha256: string;
  };
  firstApply: "applied" | "already_verified";
  secondApply: "already_verified";
};

export type Schema032Stage = "first_migration" | "first_verification" | "second_migration" | "final_verification";
export type Schema032CompletedStageV2<S extends Schema032Stage = Schema032Stage> = { step: S; receiptSha256: string };
export type Schema032ProductionExecutionReceiptCommonV2 = {
  version: "schema-032-production-execution-receipt-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256?: string;
  authorityConsumptionSha256: string;
  sourceManifestSha256: string;
  g12TransitionReceiptSha256: string;
  productionBackupEvidenceSha256: string;
  executionAttemptRelativePath: string;
  executionAttemptSha256: string;
  advisoryLockKey: 320032500;
  databaseSessionIdentitySha256: string;
  lockAcquiredAt: string;
  lockReleasedAt: string;
  preparedSettlementRelativePath: string;
  preparedSettlementSha256: string;
  migrationBytesChecksumSha256: string;
  migration033BytesChecksumSha256: string;
};
export type Schema032ProductionExecutionSuccessV2 = Schema032ProductionExecutionReceiptCommonV2 & {
  result: "applied_and_verified";
  completedStages: [
    Schema032CompletedStageV2<"first_migration">,
    Schema032CompletedStageV2<"first_verification">,
    Schema032CompletedStageV2<"second_migration">,
    Schema032CompletedStageV2<"final_verification">
  ];
  receiptChecksumSha256: string;
  postconditionsSha256: string;
  schema033: Schema032ReleaseEvidenceV1["schema033"];
};
export type Schema032StageFailureArtifactPath<S extends Schema032Stage> =
  S extends "first_migration" ? "schema032-failures/first-migration-failure-v2.json"
    : S extends "first_verification" ? "schema032-failures/first-verification-failure-v2.json"
      : S extends "second_migration" ? "schema032-failures/second-migration-failure-v2.json"
        : "schema032-failures/final-verification-failure-v2.json";
export type Schema032StageFailureArtifactV2<S extends Schema032Stage = Schema032Stage> = {
  kind: "schema032_stage_failure";
  failedStep: S;
  relativePath: Schema032StageFailureArtifactPath<S>;
  evidenceSha256: string;
};
export type Schema032ProductionExecutionFailureV2 = Schema032ProductionExecutionReceiptCommonV2 & (
  | { result: "failed_after_attempt"; failedStep: "first_migration"; completedStages: [];
      failureArtifact: Schema032StageFailureArtifactV2<"first_migration"> }
  | { result: "failed_after_attempt"; failedStep: "first_verification";
      completedStages: [Schema032CompletedStageV2<"first_migration">];
      failureArtifact: Schema032StageFailureArtifactV2<"first_verification"> }
  | { result: "failed_after_attempt"; failedStep: "second_migration";
      completedStages: [Schema032CompletedStageV2<"first_migration">, Schema032CompletedStageV2<"first_verification">];
      failureArtifact: Schema032StageFailureArtifactV2<"second_migration"> }
  | { result: "failed_after_attempt"; failedStep: "final_verification";
      completedStages: [Schema032CompletedStageV2<"first_migration">, Schema032CompletedStageV2<"first_verification">,
        Schema032CompletedStageV2<"second_migration">];
      failureArtifact: Schema032StageFailureArtifactV2<"final_verification"> }
);
export type Schema032ProductionExecutionReceiptV2 =
  | Schema032ProductionExecutionSuccessV2 | Schema032ProductionExecutionFailureV2;

export type PreparedSchema032ProductionSettlementV2 = {
  version: "prepared-schema-032-production-settlement-v2";
  preparedAt: string;
  executionReceiptCore: Record<string, unknown>;
};

export type Schema032ProductionExecutionAttemptV2 = {
  version: "schema-032-production-execution-attempt-v2";
  generationId: string;
  candidateSha: string;
  authorityConsumptionSha256: string;
  attemptOrdinal: number;
  previousAttemptSha256: string | null;
  advisoryLockKey: 320032500;
  databaseSessionIdentitySha256: string;
  lockAcquiredAt: string;
};

export type ProductionRolloutStepIdV2 =
  | "verify_g13" | "verify_schema" | "verify_previous_runtime_identity" | "verify_singleton_precondition"
  | "stop_previous" | "prove_previous_stopped" | "start_candidate" | "prove_candidate_started"
  | "immediate_runtime_checks";
export type ProductionCanaryStepIdV2 = "verify_g14" | "observe_cycle_1" | "observe_cycle_2" | "bounded_runtime_checks";
export type ProductionRollbackStepIdV2 =
  | "verify_failure" | "prove_previous_healthy" | "prove_no_previous_stop" | "prove_no_candidate_start"
  | "prove_no_candidate_running" | "restart_previous" | "stop_candidate" | "start_previous"
  | "rollback_runtime_checks";
export type ProductionRecoveryStepIdV2 =
  | "verify_abandoned_cleanup" | "verify_completed_prefix" | "verify_uncertain_step_intent"
  | "validate_failure_derivation_inputs";
export type ProductionExternalEffectStepIdV2 =
  | "stop_previous" | "start_candidate" | "restart_previous" | "stop_candidate" | "start_previous";

export type ProductionOrchestrationStepIntentV2 = {
  version: "production-orchestration-step-intent-v2";
  capability: "effect_capable";
  orchestration: "rollout" | "canary" | "rollback";
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  sequence: number;
  stepId: ProductionExternalEffectStepIdV2;
  attempt: 1;
  relativePath: string;
  currentOperationLeaseSha256: string;
  currentOperationLeaseEpoch: number;
  commandId: "production_rollout" | "production_canary" | "production_rollback";
  redactedTemplateSha256: string;
  inputSha256: string;
  intendedExternalEffectSha256: string;
  preparedAt: string;
};

export type ProductionOrchestrationStepReceiptCommonV2 = {
  version: "production-orchestration-step-receipt-v2";
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  operationLeaseSha256: string;
  operationLeaseEpoch: number;
  operationDeadlineAt: string;
  inputSha256: string;
  outputSha256: string;
  observedStateSha256: string;
  sequence: number;
  startedAt: string;
  finishedAt: string;
  recoveredAfterCrash: boolean;
  verifiedChecks: readonly string[] | null;
  result: "completed";
};
export type EffectCapableProductionOrchestrationStepReceiptV2 = ProductionOrchestrationStepReceiptCommonV2 & {
  capability: "effect_capable";
  commandId: "production_rollout" | "production_canary" | "production_rollback";
  redactedTemplateSha256: string;
} & (
  | { executionKind: "local_validation"; stepIntentRelativePath: null; stepIntentSha256: null }
  | { executionKind: "external_effect"; stepIntentRelativePath: string; stepIntentSha256: string }
) & (
  | { orchestration: "rollout"; stepId: ProductionRolloutStepIdV2 }
  | { orchestration: "canary"; stepId: ProductionCanaryStepIdV2 }
  | { orchestration: "rollback"; stepId: ProductionRollbackStepIdV2 }
);
export type RecoveryOnlyProductionOrchestrationStepReceiptV2 = ProductionOrchestrationStepReceiptCommonV2 & {
  capability: "recovery_only";
  orchestration: "recovery";
  stepId: ProductionRecoveryStepIdV2;
  executionKind: "local_validation";
  commandId: "production_recovery";
  redactedTemplateSha256: string;
  stepIntentRelativePath: null;
  stepIntentSha256: null;
  recoveredAfterCrash: false;
};
export type ProductionOrchestrationStepReceiptV2 =
  | EffectCapableProductionOrchestrationStepReceiptV2 | RecoveryOnlyProductionOrchestrationStepReceiptV2;

export type ProductionOrchestrationReceiptCommonV2 = {
  version: "production-orchestration-receipt-v2";
  candidateSha: string;
  releaseGenerationId: string;
  sourceManifestSha256: string;
  operationId: string;
  operationClaimSha256: string;
  finalOperationLeaseSha256: string;
  finalOperationLeaseEpoch: number;
  operationDeadlineAt: string;
  operationLeaseTakeoverChainSha256: string;
  operationalAttestationConsumptionSha256: string;
  redactedTemplateSha256: string;
  result: "completed";
};
export type CompletedStepReceiptRefV2<T extends ProductionOrchestrationStepReceiptV2> = {
  relativePath: string;
  sha256: string;
  receipt: T;
};
export type EffectCapableProductionOrchestrationReceiptV2 = ProductionOrchestrationReceiptCommonV2 & {
  orchestration: "rollout" | "canary" | "rollback";
  capability: "effect_capable";
  commandId: "production_rollout" | "production_canary" | "production_rollback";
  recoveryInputSha256: null;
  completedStepReceipts: Array<CompletedStepReceiptRefV2<EffectCapableProductionOrchestrationStepReceiptV2>>;
};
export type RecoveryOnlyProductionOrchestrationReceiptV2 = ProductionOrchestrationReceiptCommonV2 & {
  orchestration: "recovery";
  capability: "recovery_only";
  commandId: "production_recovery";
  recoveryInputSha256: string;
  recoveryAttemptedExternalEffect: false;
  priorAttemptedExternalEffect: boolean;
  priorCompletedStepReceiptPrefixSha256: string;
  priorUncertainStepMarkerSha256: string | null;
  completedStepReceipts: Array<CompletedStepReceiptRefV2<RecoveryOnlyProductionOrchestrationStepReceiptV2>>;
};
export type ProductionOrchestrationReceiptV2 =
  | EffectCapableProductionOrchestrationReceiptV2 | RecoveryOnlyProductionOrchestrationReceiptV2;

export type ProductionRolloutEvidenceV2 = {
  version: "production-rollout-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  operationalAttestationConsumptionSha256: string;
  sourceManifestSha256: string;
  previousStopEvidenceSha256: string;
  candidateStartEvidenceSha256: string;
  managerCapturesSha256: string;
  queryCapturesSha256: string;
  orchestrationReceiptSha256: string;
  checks: Record<"schema" | "version" | "admin" | "singleton" | "workers" | "logs" | "delivery" | "legacy", true>;
  result: "passed";
};
export type ProductionCanaryEvidenceV2 = {
  version: "production-canary-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  operationalAttestationConsumptionSha256: string;
  sourceManifestSha256: string;
  observationStartedAt: string;
  observationFinishedAt: string;
  completedPollingCycles: number;
  queryCapturesSha256: string;
  logCapturesSha256: string;
  orchestrationReceiptSha256: string;
  checks: Record<"schema" | "version" | "admin" | "singleton" | "reconciliation" | "delivery" | "navigation" | "allowance" | "legacy" | "secrets" | "queues" | "honest_limits", true>;
  result: "passed";
};

export type UncertainProductionStepMarkerV2 = {
  sequence: number;
  stepId: ProductionExternalEffectStepIdV2;
  attempt: 1;
  stepIntentRelativePath: string;
  stepIntentSha256: string;
  externalEffectMayHaveStarted: true;
  observedOutcome: "unknown";
};
export type ProductionRecoveryInputV2 = {
  version: "production-recovery-input-v2";
  priorOperationKind: "rollout" | "canary";
  priorOperationId: string;
  priorTerminalAbandonedSha256: string;
  priorTerminalCleanupSha256: string;
  completedStepReceiptPrefix: Array<{ sequence: number; stepId: string; receiptSha256: string }>;
  completedStepReceiptPrefixSha256: string;
  uncertainStepMarker: UncertainProductionStepMarkerV2 | null;
  uncertainStepMarkerSha256: string | null;
  recoveryOperationalAttestationSha256: string;
  recoveryProductionLeaseSha256: string;
  recoveryAuthorityPreclaimSha256: string;
  recoveryOperationClaimSha256: string;
  recoveryAuthorityConsumptionSha256: string;
  verifiedAt: string;
};

export type ProductionFailureEvidenceCommonV2 = {
  version: "production-failure-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  failedExecutionEvidenceSha256: string;
  observedAt: string;
};
export type ProductionFailureEvidenceV2 = ProductionFailureEvidenceCommonV2 & (
  | { failedGateId: "G13_PRODUCTION_MIGRATION"; evidenceKind: "schema032_execution_receipt"; attemptedExternalEffect: true; failureCode: "first_migration_failed" | "first_verification_failed" | "second_migration_failed" | "final_verification_failed" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT"; evidenceKind: "runtime_rollout_preflight"; attemptedExternalEffect: false; orchestrationProgressSha256: string; preEffectValidationReceiptsSha256: string; failureCode: "g13_reverification_failed" | "schema_verification_failed" | "previous_runtime_identity_mismatch" | "singleton_precondition_failed" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT"; evidenceKind: "runtime_manager_capture"; attemptedExternalEffect: true; orchestrationProgressSha256: string; failureCode: "previous_runtime_stop_failed" | "candidate_start_failed" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT"; evidenceKind: "runtime_rollout_checks"; attemptedExternalEffect: true; orchestrationProgressSha256: string; failureCode: "schema_verification_failed" | "runtime_version_mismatch" | "admin_unhealthy" | "singleton_violation" | "worker_start_failed" | "delivery_invariant_failed" | "legacy_population_changed" | "secret_detected" }
  | { failedGateId: "G15_PRODUCTION_CANARY"; evidenceKind: "runtime_canary_checks"; attemptedExternalEffect: true; orchestrationProgressSha256: string; failureCode: "schema_verification_failed" | "canary_timeout" | "polling_cycles_incomplete" | "runtime_version_mismatch" | "admin_unhealthy" | "singleton_violation" | "reconciliation_failed" | "delivery_invariant_failed" | "navigation_invariant_failed" | "allowance_invariant_failed" | "legacy_population_changed" | "queue_growth_detected" | "honest_limit_misreported" | "secret_detected" }
  | { failedGateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY"; evidenceKind: "abandoned_operation_recovery"; priorAttemptedExternalEffect: boolean; recoveryAttemptedExternalEffect: false; recoveryInputSha256: string; recoveryOrchestrationReceiptSha256: string; priorTerminalAbandonedSha256: string; priorTerminalCleanupSha256: string; completedStepReceiptPrefixSha256: string; uncertainStepMarkerSha256: string | null; recoveryOperationalAttestationSha256: string; recoveryProductionLeaseSha256: string; recoveryAuthorityPreclaimSha256: string; recoveryOperationClaimSha256: string; recoveryAuthorityConsumptionSha256: string; failureCode: "authority_expired_before_claim" | "authority_expired_after_claim" | "operation_deadline_reached" }
);

export type ProductionRollbackEvidenceV2 = {
  version: "production-rollback-evidence-v2";
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  artifactRootFingerprintSha256: string;
  sourceManifestSha256: string;
  failureEvidenceSha256: string;
  operationalAttestationSha256: string;
  operationalAttestationConsumptionSha256: string;
  commandId: "production_rollback";
  redactedTemplateSha256: string;
  previousRuntimeIdentitySha256: string;
  orchestrationReceiptSha256: string;
  outcome: ProductionRollbackOutcomeV2;
  queryCapturesSha256: string;
  checks: Record<"schema032_retained" | "previous_version" | "admin" | "singleton" | "allowance" | "legacy" | "sent" | "no_duplicate_send", true>;
};

export type PendingReleaseGateV2 = {
  id: ReleaseGateIdV2;
  candidateSha: string;
  state: "pending";
};

export type ExecutedReleaseGateV2 = {
  id: ReleaseGateIdV2;
  candidateSha: string;
  state: "passed" | "failed";
  commandId: ReleaseCommandIdV2;
  redactedTemplateSha256: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  outputSha256: string;
  evidence: GateEvidenceRefV2[];
};

export type BlockedReleaseGateV2 = {
  id: ProductionGateIdV2;
  candidateSha: string;
  state: "blocked";
  blockedByGateId: ProductionGateIdV2;
  productionFailureEvidence: ProductionFailureTransitionEvidenceRefV2;
};

export type ReleaseGateV2 = PendingReleaseGateV2 | ExecutedReleaseGateV2 | BlockedReleaseGateV2;

type RemediationReleaseManifestBaseV2 = {
  version: "remediation-release-manifest-v2";
  candidateSha: string;
  planBaseSha: string;
  revision: number;
  previousManifestSha256: string | null;
  updatedAt: string;
  artifactRootFingerprintSha256: string;
  releaseFreezeIdentitySha256: string;
  latestCommittedReceiptSha256: string;
  requiredRequirementIds: string[];
  requiredAcceptanceIds: string[];
  gates: ReleaseGateV2[];
};

export type RemediationReleaseManifestV2 = RemediationReleaseManifestBaseV2 & (
  | {
      transitionId: Exclude<ManifestTransitionIdV2, "production_failed" | "rollback_rolled_back">;
      overall: "not_ready" | "ready_for_release" | "released";
      transitionEvidence: [];
      actualRollback: null;
    }
  | {
      transitionId: "production_failed";
      overall: "not_ready";
      transitionEvidence: [ProductionFailureTransitionEvidenceRefV2];
      actualRollback: null;
    }
  | {
      transitionId: "rollback_rolled_back";
      overall: "rolled_back";
      transitionEvidence: [
        ProductionFailureTransitionEvidenceRefV2,
        ActualRollbackTransitionEvidenceRefV2
      ];
      actualRollback: {
        evidence: ActualRollbackTransitionEvidenceRefV2;
        outcome: ProductionRollbackOutcomeV2;
      };
    }
);

export type BootstrapRootWriterLeaseV2 = {
  version: "bootstrap-root-writer-lease-v2";
  scope: "artifact_root";
  relativePath: "manifest-transition-root.lease.json";
  writerOperationKind: "release_freeze_materialization";
  writerOperationKeySha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  releaseGenerationId: null;
  releaseFreezeIdentitySha256: null;
  leaseEpoch: number;
  ownerPid: number;
  ownerProcessStartFingerprintSha256: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type ReleaseRootWriterOperationKindV2 =
  | "manifest_transition"
  | "operational_authority_issue"
  | "operational_authority_terminalize";

export type FrozenRootWriterLeaseV2 = {
  version: "frozen-root-writer-lease-v2";
  scope: "artifact_root";
  relativePath: "manifest-transition-root.lease.json";
  writerOperationKind: ReleaseRootWriterOperationKindV2;
  writerOperationKeySha256: string;
  transitionKeySha256: string | null;
  protectedRootFingerprintSha256: string;
  candidateSha: string;
  releaseGenerationId: string;
  releaseFreezeIdentitySha256: string;
  leaseEpoch: number;
  ownerPid: number;
  ownerProcessStartFingerprintSha256: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type ReleaseRootWriterLeaseV2 = BootstrapRootWriterLeaseV2 | FrozenRootWriterLeaseV2;

export type PreparedFrozenRootWriterLeaseTakeoverV2 = {
  version: "prepared-frozen-root-writer-lease-takeover-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  candidateSha: string;
  releaseGenerationId: string;
  releaseFreezeIdentitySha256: string;
  artifactRootFingerprintSha256: string;
  writerOperationKind: ReleaseRootWriterOperationKindV2;
  writerOperationKeySha256: string;
  transitionKeySha256: string | null;
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: FrozenRootWriterLeaseV2;
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  preparedAt: string;
};

export type PreparedBootstrapRootWriterLeaseTakeoverV2 = {
  version: "prepared-bootstrap-root-writer-lease-takeover-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  preparedFreezeMaterializationSha256: string | null;
  oldLeaseSha256: string;
  oldLeaseEpoch: number;
  oldOwnerProcessIdentitySha256: string;
  canonicalNewLease: BootstrapRootWriterLeaseV2;
  canonicalNewLeaseUtf8Base64: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  preparedAt: string;
};

export type FrozenRootWriterLeaseTakeoverReceiptV2 = {
  version: "frozen-root-writer-lease-takeover-receipt-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  candidateSha: string;
  releaseGenerationId: string;
  releaseFreezeIdentitySha256: string;
  artifactRootFingerprintSha256: string;
  writerOperationKind: ReleaseRootWriterOperationKindV2;
  writerOperationKeySha256: string;
  transitionKeySha256: string | null;
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  committedAt: string;
};

export type BootstrapRootWriterLeaseTakeoverReceiptV2 = {
  version: "bootstrap-root-writer-lease-takeover-receipt-v2";
  commandId: "manifest_lease_takeover";
  redactedTemplateSha256: string;
  protectedRootFingerprintSha256: string;
  task0BPreflightEvidenceSha256: string;
  candidateSha: string;
  runtimeIdentitySha256: string;
  preparedFreezeMaterializationSha256: string | null;
  preparedTakeoverSha256: string;
  oldLeaseSha256: string;
  tombstoneRelativePath: string;
  newLeaseSha256: string;
  newLeaseEpoch: number;
  committedAt: string;
};

export type ReleaseRootTerminalAbandonedV2 = {
  version: "release-root-terminal-abandoned-v2";
  releaseGenerationId: string;
  candidateSha: string;
  releaseFreezeIdentitySha256: string;
  failedTransitionId: ManifestTransitionIdV2;
  transitionKeySha256: string;
  terminalReason:
    | "incompatible_durable_state"
    | "security_identity_failure"
    | "terminal_lifecycle_protocol_failure";
  lastTrustedManifestSha256: string | null;
  observedAt: string;
};

export type ManifestTransitionClaimV2 = {
  version: "manifest-transition-claim-v2";
  transitionId: ManifestTransitionIdV2;
  transitionKeySha256: string;
  generationId: string;
  sourceManifestSha256: string | null;
  claimedAt: string;
  expiresAt: string;
  claimantPid: number;
  claimantProcessStartFingerprintSha256: string;
};

export type CommittedManifestTransitionReceiptV2 = {
  version: "committed-manifest-transition-receipt-v2";
  transitionId: ManifestTransitionIdV2;
  transitionKeySha256: string;
  candidateSha: string;
  artifactRootFingerprintSha256: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string | null;
  previousReceiptSha256: string | null;
  targetManifestProjectionSha256: string;
  sourceRevision: number | null;
  targetRevision: number;
  gateOutputSha256s: string[];
  transitionEvidence: ManifestTransitionEvidenceRefV2[];
  committedAt: string;
};

export type PreparedManifestTransitionV2 = {
  version: "prepared-manifest-transition-v2";
  transitionId: ManifestTransitionIdV2;
  transitionKeySha256: string;
  generationId: string;
  sourceManifestSha256: string | null;
  previousReceiptSha256: string | null;
  targetRevision: number;
  gateOutputSha256s: string[];
  targetSnapshotRelativePath: string;
  targetSnapshotSha256: string;
  canonicalCommittedReceipt: CommittedManifestTransitionReceiptV2;
  canonicalCommittedReceiptUtf8Base64: string;
  committedReceiptSha256: string;
  preparedAt: string;
};

export type VerifiedManifestTransitionV2 = {
  transitionId: Exclude<ManifestTransitionIdV2, "pre_manual">;
  evaluatedAt: string;
  latestCommittedReceiptSha256: string;
  operationalAttestation: OperationalAttestationV2 | null;
};

export type VerifiedManifestTransitionEvidenceV2 = {
  refs: ManifestTransitionEvidenceRefV2[];
  actualRollbackOutcome: ProductionRollbackOutcomeV2 | null;
  productionFailureEvidence?: ProductionFailureEvidenceV2;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_RELATIVE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._/-]+$/;
const SECRET_KEY = /(?:^|_)(?:secret|password|passwd|token|api_?key|private_?key|authorization|credential|database_?url|dsn|chat_?id|actor_?id)(?:$|_)/i;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}|\b(?:bot|bearer)\s*[: ]\s*[A-Za-z0-9._-]{12,})/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}_keys_invalid`);
  }
}

function sha(value: unknown, regex: RegExp, label: string): string {
  if (typeof value !== "string" || !regex.test(value)) throw new Error(`${label}_invalid`);
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label}_invalid`);
  return Number(value);
}

function exactStringArray(value: unknown, expected: readonly string[], label: string): string[] {
  if (!Array.isArray(value) || value.length !== expected.length
      || value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label}_invalid`);
  }
  return [...value] as string[];
}

function assertNoSecrets(value: unknown, path = "root", seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) throw new Error(`secret_value_rejected:${path}`);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`cyclic_value_rejected:${path}`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`secret_key_rejected:${path}.${key}`);
    assertNoSecrets(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label}_invalid`);
  return value as T[number];
}

export function canonicalReleaseJsonV2(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReleaseJsonV2).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalReleaseJsonV2(object[key])}`).join(",")}}`;
}

export function releaseSha256V2(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalReleaseFreezeIdentityUtf8V2(value: unknown): Buffer {
  const freeze = validateReleaseFreezeIdentityV2(value);
  return Buffer.from(`${canonicalReleaseJsonV2(freeze)}\n`, "utf8");
}

export function releaseFreezeIdentitySha256V2(value: unknown): string {
  return releaseSha256V2(canonicalReleaseFreezeIdentityUtf8V2(value));
}

export function releaseManifestSha256V2(value: RemediationReleaseManifestV2): string {
  return releaseSha256V2(Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8"));
}

export function validateReleaseFreezeIdentityV2(value: unknown): ReleaseFreezeIdentityV2 {
  assertNoSecrets(value);
  const input = record(value, "release_freeze_identity");
  exactKeys(input, [
    "version", "releaseGenerationId", "candidateSha", "planBaseSha",
    "artifactRootFingerprintSha256", "artifactRootTrustBoundaryEvidenceSha256",
    "productionDatabaseIdentityFingerprintSha256", "postgresToolIdentitySha256",
    "previousRuntimeDiscoverySha256", "rollbackWorktreeIdentitySha256", "createdAt"
  ], "release_freeze_identity");
  if (input.version !== "release-freeze-identity-v2"
      || typeof input.releaseGenerationId !== "string" || input.releaseGenerationId.length === 0) {
    throw new Error("release_freeze_identity_invalid");
  }
  sha(input.candidateSha, SHA40, "candidate_sha");
  sha(input.planBaseSha, SHA40, "plan_base_sha");
  for (const key of [
    "artifactRootFingerprintSha256", "artifactRootTrustBoundaryEvidenceSha256",
    "productionDatabaseIdentityFingerprintSha256", "postgresToolIdentitySha256",
    "previousRuntimeDiscoverySha256", "rollbackWorktreeIdentitySha256"
  ]) sha(input[key], SHA256, key);
  iso(input.createdAt, "created_at");
  return input as ReleaseFreezeIdentityV2;
}

export function validateOperationalAttestationV2(
  value: unknown,
  freeze?: ReleaseFreezeIdentityV2
): OperationalAttestationV2 {
  assertNoSecrets(value);
  const input = record(value, "operational_attestation");
  exactKeys(input, [
    "version", "action", "generationId", "candidateSha", "releaseFreezeIdentitySha256",
    "sourceManifestSha256", "artifactRootFingerprintSha256", "commandId",
    "redactedTemplateSha256", "previousAttestationSha256", "priorTerminalLineageSha256",
    "issuedAt", "expiresAt"
  ], "operational_attestation");
  if (input.version !== "operational-attestation-v2"
      || typeof input.generationId !== "string" || input.generationId.length === 0) {
    throw new Error("operational_attestation_invalid");
  }
  oneOf(input.action, MANIFEST_TRANSITIONS_V2, "operational_attestation_action");
  oneOf(input.commandId, RELEASE_COMMAND_IDS_V2, "operational_attestation_command");
  sha(input.candidateSha, SHA40, "candidate_sha");
  for (const key of [
    "releaseFreezeIdentitySha256", "sourceManifestSha256",
    "artifactRootFingerprintSha256", "redactedTemplateSha256"
  ]) sha(input[key], SHA256, key);
  for (const key of ["previousAttestationSha256", "priorTerminalLineageSha256"]) {
    if (input[key] !== null) sha(input[key], SHA256, key);
  }
  const issued = iso(input.issuedAt, "issued_at");
  const expires = iso(input.expiresAt, "expires_at");
  if (Date.parse(expires) <= Date.parse(issued)) throw new Error("operational_attestation_expiry_invalid");
  if (freeze && (input.generationId !== freeze.releaseGenerationId
      || input.candidateSha !== freeze.candidateSha
      || input.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || input.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze))) {
    throw new Error("operational_attestation_freeze_binding_invalid");
  }
  return input as OperationalAttestationV2;
}

function canonicalEmbeddedBytesV2(
  value: unknown,
  base64: unknown,
  expectedSha256: unknown,
  label: string
): Buffer {
  if (typeof base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)) {
    throw new Error(`${label}_bytes_invalid`);
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64
      || !bytes.equals(Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8"))
      || releaseSha256V2(bytes) !== sha(expectedSha256, SHA256, `${label}_sha`)) {
    throw new Error(`${label}_bytes_invalid`);
  }
  return bytes;
}

export function validateReleaseFreezeMaterializationReceiptV2(
  value: unknown
): ReleaseFreezeMaterializationReceiptV2 {
  assertNoSecrets(value);
  const receipt = record(value, "release_freeze_materialization_receipt");
  exactKeys(receipt, [
    "version", "commandId", "redactedTemplateSha256", "task0BPreflightEvidenceSha256",
    "protectedRootFingerprintSha256", "candidateSha", "runtimeIdentitySha256",
    "bootstrapLeaseSha256", "bootstrapLeaseEpoch", "canonicalFreezeIdentity",
    "canonicalFreezeIdentityUtf8Base64", "canonicalFreezeIdentitySha256", "materializedAt"
  ], "release_freeze_materialization_receipt");
  if (receipt.version !== "release-freeze-materialization-receipt-v2"
      || receipt.commandId !== "release_freeze_materialize") {
    throw new Error("release_freeze_materialization_receipt_invalid");
  }
  const freeze = validateReleaseFreezeIdentityV2(receipt.canonicalFreezeIdentity);
  for (const key of [
    "redactedTemplateSha256", "task0BPreflightEvidenceSha256", "protectedRootFingerprintSha256",
    "runtimeIdentitySha256", "bootstrapLeaseSha256", "canonicalFreezeIdentitySha256"
  ]) sha(receipt[key], SHA256, key);
  positiveInteger(receipt.bootstrapLeaseEpoch, "bootstrap_lease_epoch");
  canonicalEmbeddedBytesV2(freeze, receipt.canonicalFreezeIdentityUtf8Base64,
    receipt.canonicalFreezeIdentitySha256, "freeze_identity");
  if (receipt.candidateSha !== freeze.candidateSha
      || receipt.protectedRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256) {
    throw new Error("release_freeze_materialization_binding_invalid");
  }
  iso(receipt.materializedAt, "materialized_at");
  return { ...receipt, canonicalFreezeIdentity: freeze } as ReleaseFreezeMaterializationReceiptV2;
}

export function validatePreparedReleaseFreezeMaterializationV2(
  value: unknown
): PreparedReleaseFreezeMaterializationV2 {
  assertNoSecrets(value);
  const prepared = record(value, "prepared_release_freeze_materialization");
  exactKeys(prepared, [
    "version", "commandId", "redactedTemplateSha256", "protectedRootFingerprintSha256",
    "task0BPreflightEvidenceSha256", "candidateSha", "runtimeIdentitySha256",
    "bootstrapLeaseSha256", "bootstrapLeaseEpoch", "canonicalFreezeIdentity",
    "canonicalFreezeIdentityUtf8Base64", "canonicalFreezeIdentitySha256",
    "canonicalFreezeIdentityRelativePath", "canonicalMaterializationReceipt",
    "canonicalMaterializationReceiptUtf8Base64", "canonicalMaterializationReceiptSha256",
    "canonicalMaterializationReceiptRelativePath", "preparedAt"
  ], "prepared_release_freeze_materialization");
  if (prepared.version !== "prepared-release-freeze-materialization-v2"
      || prepared.commandId !== "release_freeze_materialize"
      || prepared.canonicalFreezeIdentityRelativePath !== "release-freeze-identity-v2.json"
      || prepared.canonicalMaterializationReceiptRelativePath
        !== "release-freeze-materialization-receipt-v2.json") {
    throw new Error("prepared_release_freeze_materialization_invalid");
  }
  const freeze = validateReleaseFreezeIdentityV2(prepared.canonicalFreezeIdentity);
  const receipt = validateReleaseFreezeMaterializationReceiptV2(prepared.canonicalMaterializationReceipt);
  canonicalEmbeddedBytesV2(freeze, prepared.canonicalFreezeIdentityUtf8Base64,
    prepared.canonicalFreezeIdentitySha256, "prepared_freeze_identity");
  canonicalEmbeddedBytesV2(receipt, prepared.canonicalMaterializationReceiptUtf8Base64,
    prepared.canonicalMaterializationReceiptSha256, "prepared_freeze_receipt");
  if (prepared.redactedTemplateSha256 !== receipt.redactedTemplateSha256
      || prepared.protectedRootFingerprintSha256 !== receipt.protectedRootFingerprintSha256
      || prepared.task0BPreflightEvidenceSha256 !== receipt.task0BPreflightEvidenceSha256
      || prepared.candidateSha !== receipt.candidateSha
      || prepared.runtimeIdentitySha256 !== receipt.runtimeIdentitySha256
      || prepared.bootstrapLeaseSha256 !== receipt.bootstrapLeaseSha256
      || prepared.bootstrapLeaseEpoch !== receipt.bootstrapLeaseEpoch
      || prepared.canonicalFreezeIdentitySha256 !== receipt.canonicalFreezeIdentitySha256
      || prepared.preparedAt !== receipt.materializedAt) {
    throw new Error("prepared_release_freeze_materialization_binding_invalid");
  }
  return { ...prepared, canonicalFreezeIdentity: freeze,
    canonicalMaterializationReceipt: receipt } as PreparedReleaseFreezeMaterializationV2;
}

export function validateOperationalAttestationIssuerReceiptV2(
  value: unknown
): OperationalAttestationIssuerReceiptV2 {
  assertNoSecrets(value);
  const receipt = record(value, "operational_attestation_issuer_receipt");
  exactKeys(receipt, [
    "version", "commandId", "redactedTemplateSha256", "action", "generationId", "sequence",
    "previousIssuerReceiptSha256", "attestationRelativePath", "attestationSha256",
    "previousAttestationSha256", "priorTerminalLineageSha256", "issuedAt"
  ], "operational_attestation_issuer_receipt");
  const action = oneOf(receipt.action, MANIFEST_TRANSITIONS_V2, "issuer_receipt_action");
  if (receipt.version !== "operational-attestation-issuer-receipt-v2"
      || receipt.commandId !== "operational_authority_issue"
      || typeof receipt.generationId !== "string" || !receipt.generationId) {
    throw new Error("operational_attestation_issuer_receipt_invalid");
  }
  positiveInteger(receipt.sequence, "issuer_receipt_sequence");
  for (const key of ["redactedTemplateSha256", "attestationSha256"]) sha(receipt[key], SHA256, key);
  for (const key of ["previousIssuerReceiptSha256", "previousAttestationSha256", "priorTerminalLineageSha256"]) {
    if (receipt[key] !== null) sha(receipt[key], SHA256, key);
  }
  const expectedPath = `operational-attestations/${action}/${receipt.generationId}/${receipt.attestationSha256}.json`;
  if (receipt.attestationRelativePath !== expectedPath) throw new Error("issuer_receipt_attestation_path_invalid");
  iso(receipt.issuedAt, "issuer_receipt_issued_at");
  return receipt as OperationalAttestationIssuerReceiptV2;
}

export function validateCommittedOperationalAttestationIssuanceV2(
  value: unknown
): CommittedOperationalAttestationIssuanceV2 {
  assertNoSecrets(value);
  const committed = record(value, "committed_operational_attestation_issuance");
  exactKeys(committed, [
    "version", "commandId", "redactedTemplateSha256", "action", "generationId",
    "issuanceIntentSha256", "attestationSha256", "issuerReceiptSha256", "committedAt"
  ], "committed_operational_attestation_issuance");
  if (committed.version !== "committed-operational-attestation-issuance-v2"
      || committed.commandId !== "operational_authority_issue"
      || typeof committed.generationId !== "string" || !committed.generationId) {
    throw new Error("committed_operational_attestation_issuance_invalid");
  }
  oneOf(committed.action, MANIFEST_TRANSITIONS_V2, "committed_authority_action");
  for (const key of [
    "redactedTemplateSha256", "issuanceIntentSha256", "attestationSha256", "issuerReceiptSha256"
  ]) sha(committed[key], SHA256, key);
  iso(committed.committedAt, "committed_authority_time");
  return committed as CommittedOperationalAttestationIssuanceV2;
}

export function validatePreparedOperationalAttestationIssuanceV2(
  value: unknown
): PreparedOperationalAttestationIssuanceV2 {
  assertNoSecrets(value);
  const prepared = record(value, "prepared_operational_attestation_issuance");
  exactKeys(prepared, [
    "version", "commandId", "redactedTemplateSha256", "action", "generationId", "sequence",
    "previousIssuerReceiptSha256", "canonicalAttestation", "canonicalAttestationUtf8Base64",
    "canonicalAttestationSha256", "canonicalAttestationRelativePath", "canonicalIssuerReceipt",
    "canonicalIssuerReceiptUtf8Base64", "canonicalIssuerReceiptSha256",
    "canonicalIssuerReceiptRelativePath", "canonicalCommittedIssuance",
    "canonicalCommittedIssuanceUtf8Base64", "canonicalCommittedIssuanceSha256",
    "canonicalCommittedIssuanceRelativePath", "previousAttestationSha256",
    "priorTerminalLineageSha256", "preparedAt"
  ], "prepared_operational_attestation_issuance");
  if (prepared.version !== "prepared-operational-attestation-issuance-v2"
      || prepared.commandId !== "operational_authority_issue") {
    throw new Error("prepared_operational_attestation_issuance_invalid");
  }
  const authority = validateOperationalAttestationV2(prepared.canonicalAttestation);
  const receipt = validateOperationalAttestationIssuerReceiptV2(prepared.canonicalIssuerReceipt);
  const committed = validateCommittedOperationalAttestationIssuanceV2(prepared.canonicalCommittedIssuance);
  canonicalEmbeddedBytesV2(authority, prepared.canonicalAttestationUtf8Base64,
    prepared.canonicalAttestationSha256, "prepared_attestation");
  canonicalEmbeddedBytesV2(receipt, prepared.canonicalIssuerReceiptUtf8Base64,
    prepared.canonicalIssuerReceiptSha256, "prepared_issuer_receipt");
  canonicalEmbeddedBytesV2(committed, prepared.canonicalCommittedIssuanceUtf8Base64,
    prepared.canonicalCommittedIssuanceSha256, "prepared_committed_issuance");
  const expectedPreparedPath = `operational-attestation-issuance-prepared/${authority.action}/${authority.generationId}/${prepared.canonicalIssuerReceiptSha256}.json`;
  const expectedReceiptPath = `operational-attestation-issuer-receipts/${authority.action}/${authority.generationId}/${prepared.canonicalIssuerReceiptSha256}.json`;
  const expectedCommittedPath = `operational-attestation-issuance-committed/${authority.action}/${authority.generationId}/${prepared.canonicalIssuerReceiptSha256}.json`;
  const expectedAttestationPath = `operational-attestations/${authority.action}/${authority.generationId}/${prepared.canonicalAttestationSha256}.json`;
  if (prepared.action !== authority.action || prepared.generationId !== authority.generationId
      || prepared.sequence !== receipt.sequence
      || prepared.previousIssuerReceiptSha256 !== receipt.previousIssuerReceiptSha256
      || prepared.previousAttestationSha256 !== authority.previousAttestationSha256
      || prepared.priorTerminalLineageSha256 !== authority.priorTerminalLineageSha256
      || prepared.canonicalAttestationRelativePath !== expectedAttestationPath
      || prepared.canonicalIssuerReceiptRelativePath !== expectedReceiptPath
      || prepared.canonicalCommittedIssuanceRelativePath !== expectedCommittedPath
      || receipt.attestationRelativePath !== expectedAttestationPath
      || committed.attestationSha256 !== prepared.canonicalAttestationSha256
      || committed.issuerReceiptSha256 !== prepared.canonicalIssuerReceiptSha256
      || committed.issuanceIntentSha256 !== releaseSha256V2(canonicalReleaseJsonV2([
        authority.action, authority.generationId, prepared.canonicalAttestationSha256,
        prepared.canonicalIssuerReceiptSha256
      ]))
      || prepared.preparedAt !== authority.issuedAt || receipt.issuedAt !== authority.issuedAt
      || committed.committedAt !== authority.issuedAt
      || !expectedPreparedPath.endsWith(`/${prepared.canonicalIssuerReceiptSha256}.json`)) {
    throw new Error("prepared_operational_attestation_binding_invalid");
  }
  return { ...prepared, canonicalAttestation: authority, canonicalIssuerReceipt: receipt,
    canonicalCommittedIssuance: committed } as PreparedOperationalAttestationIssuanceV2;
}

export function validateAuthorityTerminalReceiptV2(value: unknown): AuthorityTerminalReceiptV2 {
  assertNoSecrets(value);
  const receipt = record(value, "authority_terminal_receipt");
  exactKeys(receipt, [
    "version", "commandId", "redactedTemplateSha256", "action", "generationId", "candidateSha",
    "releaseFreezeIdentitySha256", "sourceManifestSha256", "artifactRootFingerprintSha256",
    "attestationSha256", "issuerReceiptSha256", "previousIssuerReceiptSha256", "reason",
    "preclaimAbsent", "claimAbsent", "consumptionAbsent", "actionLeaseAbsent",
    "g13BoundSessionAbsent", "g13AdvisoryLockAbsent", "operationAbsent",
    "externalEffectCount", "terminalizedAt"
  ], "authority_terminal_receipt");
  if (receipt.version !== "authority-terminal-receipt-v2"
      || receipt.commandId !== "operational_authority_terminalize"
      || receipt.reason !== "expired_unclaimed" || receipt.externalEffectCount !== 0
      || ["preclaimAbsent", "claimAbsent", "consumptionAbsent", "actionLeaseAbsent",
        "g13BoundSessionAbsent", "g13AdvisoryLockAbsent", "operationAbsent"]
        .some((key) => receipt[key] !== true)) {
    throw new Error("authority_terminal_receipt_invalid");
  }
  oneOf(receipt.action, MANIFEST_TRANSITIONS_V2, "terminal_receipt_action");
  if (typeof receipt.generationId !== "string" || !receipt.generationId) throw new Error("authority_terminal_receipt_invalid");
  sha(receipt.candidateSha, SHA40, "terminal_candidate_sha");
  for (const key of [
    "redactedTemplateSha256", "releaseFreezeIdentitySha256", "sourceManifestSha256",
    "artifactRootFingerprintSha256", "attestationSha256", "issuerReceiptSha256"
  ]) sha(receipt[key], SHA256, key);
  if (receipt.previousIssuerReceiptSha256 !== null) sha(receipt.previousIssuerReceiptSha256, SHA256, "previous_issuer_receipt_sha");
  iso(receipt.terminalizedAt, "terminalized_at");
  return receipt as AuthorityTerminalReceiptV2;
}

export function validatePreparedAuthorityTerminalV2(value: unknown): PreparedAuthorityTerminalV2 {
  assertNoSecrets(value);
  const prepared = record(value, "prepared_authority_terminal");
  exactKeys(prepared, [
    "version", "commandId", "redactedTemplateSha256", "canonicalTerminalReceipt",
    "canonicalTerminalReceiptUtf8Base64", "canonicalTerminalReceiptSha256",
    "canonicalTerminalReceiptRelativePath", "preparedAt"
  ], "prepared_authority_terminal");
  if (prepared.version !== "prepared-authority-terminal-v2"
      || prepared.commandId !== "operational_authority_terminalize") {
    throw new Error("prepared_authority_terminal_invalid");
  }
  const receipt = validateAuthorityTerminalReceiptV2(prepared.canonicalTerminalReceipt);
  canonicalEmbeddedBytesV2(receipt, prepared.canonicalTerminalReceiptUtf8Base64,
    prepared.canonicalTerminalReceiptSha256, "prepared_terminal_receipt");
  const expectedPath = `authority-terminal-receipts/${receipt.action}/${receipt.generationId}/${prepared.canonicalTerminalReceiptSha256}.json`;
  if (prepared.redactedTemplateSha256 !== receipt.redactedTemplateSha256
      || prepared.canonicalTerminalReceiptRelativePath !== expectedPath
      || prepared.preparedAt !== receipt.terminalizedAt) {
    throw new Error("prepared_authority_terminal_binding_invalid");
  }
  return { ...prepared, canonicalTerminalReceipt: receipt } as PreparedAuthorityTerminalV2;
}

function validateGateEvidenceRefV2(value: unknown, candidateSha: string): GateEvidenceRefV2 {
  const ref = record(value, "gate_evidence_ref");
  exactKeys(ref, ["kind", "relativePath", "sha256", "schemaVersion", "candidateSha"], "gate_evidence_ref");
  oneOf(ref.kind, GATE_EVIDENCE_KINDS_V2, "gate_evidence_kind");
  if (typeof ref.relativePath !== "string" || !SAFE_RELATIVE_PATH.test(ref.relativePath)
      || typeof ref.schemaVersion !== "string" || ref.schemaVersion.length === 0
      || ref.candidateSha !== candidateSha) throw new Error("gate_evidence_ref_invalid");
  sha(ref.sha256, SHA256, "gate_evidence_sha");
  return ref as GateEvidenceRefV2;
}

export function validateProductionFailureTransitionEvidenceRefV2(
  value: unknown,
  candidateSha?: string
): ProductionFailureTransitionEvidenceRefV2 {
  const ref = record(value, "production_failure_evidence_ref");
  exactKeys(ref, [
    "kind", "relativePath", "sha256", "schemaVersion", "candidateSha", "sourceManifestSha256"
  ], "production_failure_evidence_ref");
  if (ref.kind !== "production_failure_evidence"
      || ref.relativePath !== "production-failure-evidence-v2.json"
      || ref.schemaVersion !== "production-failure-evidence-v2"
      || (candidateSha !== undefined && ref.candidateSha !== candidateSha)) {
    throw new Error("production_failure_evidence_ref_invalid");
  }
  sha(ref.candidateSha, SHA40, "production_failure_candidate_sha");
  sha(ref.sha256, SHA256, "production_failure_evidence_sha");
  sha(ref.sourceManifestSha256, SHA256, "production_failure_source_sha");
  return ref as ProductionFailureTransitionEvidenceRefV2;
}

export function validateActualRollbackTransitionEvidenceRefV2(
  value: unknown,
  candidateSha?: string
): ActualRollbackTransitionEvidenceRefV2 {
  const ref = record(value, "actual_rollback_evidence_ref");
  exactKeys(ref, [
    "kind", "relativePath", "sha256", "schemaVersion", "candidateSha", "sourceManifestSha256"
  ], "actual_rollback_evidence_ref");
  if (ref.kind !== "actual_rollback_evidence"
      || ref.relativePath !== "production-rollback-evidence-v2.json"
      || ref.schemaVersion !== "production-rollback-evidence-v2"
      || (candidateSha !== undefined && ref.candidateSha !== candidateSha)) {
    throw new Error("actual_rollback_evidence_ref_invalid");
  }
  sha(ref.candidateSha, SHA40, "actual_rollback_candidate_sha");
  sha(ref.sha256, SHA256, "actual_rollback_evidence_sha");
  sha(ref.sourceManifestSha256, SHA256, "actual_rollback_source_sha");
  return ref as ActualRollbackTransitionEvidenceRefV2;
}

export function validateProductionRollbackOutcomeV2(value: unknown): ProductionRollbackOutcomeV2 {
  const outcome = record(value, "production_rollback_outcome");
  if (outcome.kind === "previous_runtime_retained") {
    exactKeys(outcome, [
      "kind", "failedGateId", "previousRuntimeHealthEvidenceSha256",
      "noPreviousStopEvidenceSha256", "noCandidateStartEvidenceSha256"
    ], "production_rollback_outcome");
    if (outcome.failedGateId !== "G13_PRODUCTION_MIGRATION"
        && outcome.failedGateId !== "G14_PRODUCTION_ROLLOUT") throw new Error("rollback_failed_gate_invalid");
    for (const key of [
      "previousRuntimeHealthEvidenceSha256", "noPreviousStopEvidenceSha256",
      "noCandidateStartEvidenceSha256"
    ]) sha(outcome[key], SHA256, key);
  } else if (outcome.kind === "previous_runtime_restarted_without_candidate") {
    exactKeys(outcome, [
      "kind", "failedGateId", "previousStopEvidenceSha256",
      "noCandidateStartEvidenceSha256", "previousStartEvidenceSha256"
    ], "production_rollback_outcome");
    if (outcome.failedGateId !== "G14_PRODUCTION_ROLLOUT") throw new Error("rollback_failed_gate_invalid");
    for (const key of [
      "previousStopEvidenceSha256", "noCandidateStartEvidenceSha256", "previousStartEvidenceSha256"
    ]) sha(outcome[key], SHA256, key);
  } else if (outcome.kind === "candidate_replaced_with_previous") {
    exactKeys(outcome, [
      "kind", "failedGateId", "candidateStartEvidenceSha256",
      "candidateStopEvidenceSha256", "previousStartEvidenceSha256"
    ], "production_rollback_outcome");
    if (outcome.failedGateId !== "G14_PRODUCTION_ROLLOUT"
        && outcome.failedGateId !== "G15_PRODUCTION_CANARY") throw new Error("rollback_failed_gate_invalid");
    for (const key of [
      "candidateStartEvidenceSha256", "candidateStopEvidenceSha256", "previousStartEvidenceSha256"
    ]) sha(outcome[key], SHA256, key);
  } else throw new Error("production_rollback_outcome_invalid");
  return outcome as ProductionRollbackOutcomeV2;
}

export function validateReleaseGateV2(value: unknown): ReleaseGateV2 {
  assertNoSecrets(value);
  const gate = record(value, "release_gate");
  const id = oneOf(gate.id, RELEASE_GATE_IDS_V2, "release_gate_id");
  const candidateSha = sha(gate.candidateSha, SHA40, "release_gate_candidate_sha");
  if (gate.state === "pending") {
    exactKeys(gate, ["id", "candidateSha", "state"], "pending_release_gate");
    return gate as PendingReleaseGateV2;
  }
  if (gate.state === "blocked") {
    exactKeys(gate, [
      "id", "candidateSha", "state", "blockedByGateId", "productionFailureEvidence"
    ], "blocked_release_gate");
    if (!PRODUCTION_GATE_IDS_V2.includes(id as ProductionGateIdV2)
        || !PRODUCTION_GATE_IDS_V2.includes(gate.blockedByGateId as ProductionGateIdV2)) {
      throw new Error("blocked_release_gate_id_invalid");
    }
    validateProductionFailureTransitionEvidenceRefV2(gate.productionFailureEvidence, candidateSha);
    return gate as BlockedReleaseGateV2;
  }
  if (gate.state !== "passed" && gate.state !== "failed") throw new Error("release_gate_state_invalid");
  exactKeys(gate, [
    "id", "candidateSha", "state", "commandId", "redactedTemplateSha256",
    "startedAt", "finishedAt", "exitCode", "outputSha256", "evidence"
  ], "executed_release_gate");
  oneOf(gate.commandId, RELEASE_COMMAND_IDS_V2, "release_gate_command");
  if (!Number.isSafeInteger(gate.exitCode)
      || (gate.state === "passed" ? gate.exitCode !== 0 : gate.exitCode === 0)
      || !Array.isArray(gate.evidence) || gate.evidence.length === 0) {
    throw new Error("executed_release_gate_invalid");
  }
  sha(gate.redactedTemplateSha256, SHA256, "redacted_template_sha");
  sha(gate.outputSha256, SHA256, "output_sha");
  if (Date.parse(iso(gate.finishedAt, "finished_at")) < Date.parse(iso(gate.startedAt, "started_at"))) {
    throw new Error("release_gate_time_invalid");
  }
  gate.evidence.map((ref) => validateGateEvidenceRefV2(ref, candidateSha));
  return gate as ExecutedReleaseGateV2;
}

function validateManifestTransitionEvidence(
  manifest: Record<string, unknown>,
  candidateSha: string,
  previousManifestSha256: string | null
): Pick<RemediationReleaseManifestV2, "transitionEvidence" | "actualRollback"> {
  if (!Array.isArray(manifest.transitionEvidence)) throw new Error("transition_evidence_invalid");
  if (manifest.transitionId === "production_failed") {
    if (manifest.transitionEvidence.length !== 1 || manifest.actualRollback !== null) {
      throw new Error("production_failure_transition_invalid");
    }
    const failure = validateProductionFailureTransitionEvidenceRefV2(manifest.transitionEvidence[0], candidateSha);
    if (failure.sourceManifestSha256 !== previousManifestSha256) throw new Error("production_failure_source_invalid");
    return { transitionEvidence: [failure], actualRollback: null };
  }
  if (manifest.transitionId === "rollback_rolled_back") {
    if (manifest.transitionEvidence.length !== 2) throw new Error("rollback_transition_evidence_invalid");
    const failure = validateProductionFailureTransitionEvidenceRefV2(manifest.transitionEvidence[0], candidateSha);
    const rollback = validateActualRollbackTransitionEvidenceRefV2(manifest.transitionEvidence[1], candidateSha);
    if (rollback.sourceManifestSha256 !== previousManifestSha256) throw new Error("actual_rollback_source_invalid");
    const actual = record(manifest.actualRollback, "actual_rollback");
    exactKeys(actual, ["evidence", "outcome"], "actual_rollback");
    const actualEvidence = validateActualRollbackTransitionEvidenceRefV2(actual.evidence, candidateSha);
    if (canonicalReleaseJsonV2(actualEvidence) !== canonicalReleaseJsonV2(rollback)) {
      throw new Error("actual_rollback_evidence_mismatch");
    }
    const outcome = validateProductionRollbackOutcomeV2(actual.outcome);
    return { transitionEvidence: [failure, rollback], actualRollback: { evidence: rollback, outcome } };
  }
  if (manifest.transitionEvidence.length !== 0 || manifest.actualRollback !== null) {
    throw new Error("non_failure_transition_evidence_invalid");
  }
  return { transitionEvidence: [], actualRollback: null };
}

const NORMAL_GATE_PREFIX: Record<Exclude<ManifestTransitionIdV2, "production_failed" | "rollback_rolled_back">, number> = {
  pre_manual: 11,
  readiness: 12,
  g12_backup_passed: 13,
  g13_migration_passed: 14,
  g14_rollout_passed: 15,
  g15_canary_released: 16
};

function validateNormalGateState(transitionId: keyof typeof NORMAL_GATE_PREFIX, gates: ReleaseGateV2[]): void {
  if (transitionId === "pre_manual") {
    for (const [index, gate] of gates.entries()) {
      const shouldPass = index <= 4 || (index >= 6 && index <= 11);
      if (gate.state !== (shouldPass ? "passed" : "pending")) throw new Error("pre_manual_gate_state_invalid");
    }
    return;
  }
  const prefix = NORMAL_GATE_PREFIX[transitionId];
  gates.forEach((gate, index) => {
    if (gate.state !== (index < prefix ? "passed" : "pending")) throw new Error("release_manifest_gate_state_invalid");
  });
}

function validateFailureGateState(
  gates: ReleaseGateV2[], failureRef: ProductionFailureTransitionEvidenceRefV2
): ProductionGateIdV2 {
  const failedIndex = gates.findIndex((gate) => gate.state === "failed");
  if (failedIndex < 12 || failedIndex > 15) throw new Error("production_failed_gate_missing");
  if (gates.filter((gate) => gate.state === "failed").length !== 1) throw new Error("production_failed_gate_count_invalid");
  const failedGateId = RELEASE_GATE_IDS_V2[failedIndex] as ProductionGateIdV2;
  gates.forEach((gate, index) => {
    if (index < failedIndex && gate.state !== "passed") throw new Error("production_failed_prefix_invalid");
    if (index > failedIndex) {
      if (gate.state !== "blocked" || gate.blockedByGateId !== failedGateId
          || canonicalReleaseJsonV2(gate.productionFailureEvidence) !== canonicalReleaseJsonV2(failureRef)) {
        throw new Error("production_failed_blocked_suffix_invalid");
      }
    }
  });
  return failedGateId;
}

export function validateRemediationReleaseManifestV2(value: unknown): RemediationReleaseManifestV2 {
  assertNoSecrets(value);
  const manifest = record(value, "release_manifest_v2");
  exactKeys(manifest, [
    "version", "candidateSha", "planBaseSha", "revision", "previousManifestSha256",
    "updatedAt", "artifactRootFingerprintSha256", "releaseFreezeIdentitySha256",
    "latestCommittedReceiptSha256", "requiredRequirementIds", "requiredAcceptanceIds",
    "gates", "transitionId", "overall", "transitionEvidence", "actualRollback"
  ], "release_manifest_v2");
  if (manifest.version !== "remediation-release-manifest-v2") throw new Error("release_manifest_version_invalid");
  const candidateSha = sha(manifest.candidateSha, SHA40, "candidate_sha");
  sha(manifest.planBaseSha, SHA40, "plan_base_sha");
  const revision = positiveInteger(manifest.revision, "revision");
  const previousManifestSha256 = manifest.previousManifestSha256 === null
    ? null : sha(manifest.previousManifestSha256, SHA256, "previous_manifest_sha");
  if ((revision === 1) !== (previousManifestSha256 === null)) throw new Error("previous_manifest_revision_invalid");
  sha(manifest.latestCommittedReceiptSha256, SHA256, "latest_committed_receipt_sha");
  iso(manifest.updatedAt, "updated_at");
  sha(manifest.artifactRootFingerprintSha256, SHA256, "artifact_root_fingerprint_sha");
  sha(manifest.releaseFreezeIdentitySha256, SHA256, "release_freeze_identity_sha");
  exactStringArray(manifest.requiredRequirementIds, REQUIRED_REQUIREMENT_IDS_V2, "required_requirement_ids");
  exactStringArray(manifest.requiredAcceptanceIds, REQUIRED_ACCEPTANCE_IDS_V2, "required_acceptance_ids");
  const transitionId = oneOf(manifest.transitionId, MANIFEST_TRANSITIONS_V2, "manifest_transition_id");
  if (!Array.isArray(manifest.gates) || manifest.gates.length !== RELEASE_GATE_IDS_V2.length) {
    throw new Error("release_manifest_gate_set_invalid");
  }
  const gates = manifest.gates.map(validateReleaseGateV2);
  if (gates.some((gate, index) => gate.id !== RELEASE_GATE_IDS_V2[index]
      || gate.candidateSha !== candidateSha)) throw new Error("release_manifest_gate_set_invalid");
  const transition = validateManifestTransitionEvidence(manifest, candidateSha, previousManifestSha256);
  if (transitionId === "production_failed" || transitionId === "rollback_rolled_back") {
    const failureRef = transition.transitionEvidence[0];
    if (failureRef === undefined || failureRef.kind !== "production_failure_evidence") {
      throw new Error("production_failure_transition_ref_invalid");
    }
    const failedGateId = validateFailureGateState(gates, failureRef);
    if (transitionId === "rollback_rolled_back") {
      if (manifest.overall !== "rolled_back") throw new Error("rollback_overall_invalid");
      if (transition.actualRollback!.outcome.failedGateId !== failedGateId) throw new Error("rollback_failed_gate_mismatch");
    } else if (manifest.overall !== "not_ready") throw new Error("production_failure_overall_invalid");
  } else {
    validateNormalGateState(transitionId, gates);
    const expectedOverall = transitionId === "readiness" ? "ready_for_release"
      : transitionId === "g15_canary_released" ? "released" : "not_ready";
    if (manifest.overall !== expectedOverall) throw new Error("release_manifest_overall_invalid");
  }
  return { ...manifest, gates, ...transition } as RemediationReleaseManifestV2;
}

export function validateReleaseRootWriterLeaseV2(value: unknown): ReleaseRootWriterLeaseV2 {
  assertNoSecrets(value);
  const lease = record(value, "release_root_writer_lease");
  const isBootstrap = lease.version === "bootstrap-root-writer-lease-v2";
  const commonKeys = [
    "version", "scope", "relativePath", "writerOperationKind", "writerOperationKeySha256",
    "protectedRootFingerprintSha256", "candidateSha", "releaseGenerationId",
    "releaseFreezeIdentitySha256", "leaseEpoch", "ownerPid",
    "ownerProcessStartFingerprintSha256", "acquiredAt", "heartbeatAt", "expiresAt"
  ];
  if (lease.version === "bootstrap-root-writer-lease-v2") {
    exactKeys(lease, [...commonKeys, "task0BPreflightEvidenceSha256", "runtimeIdentitySha256"], "bootstrap_root_writer_lease");
    if (lease.scope !== "artifact_root" || lease.relativePath !== "manifest-transition-root.lease.json"
        || lease.writerOperationKind !== "release_freeze_materialization"
        || lease.releaseGenerationId !== null || lease.releaseFreezeIdentitySha256 !== null) {
      throw new Error("bootstrap_root_writer_lease_invalid");
    }
    for (const key of [
      "writerOperationKeySha256", "protectedRootFingerprintSha256", "task0BPreflightEvidenceSha256",
      "runtimeIdentitySha256", "ownerProcessStartFingerprintSha256"
    ]) sha(lease[key], SHA256, key);
  } else if (lease.version === "frozen-root-writer-lease-v2") {
    exactKeys(lease, [...commonKeys, "transitionKeySha256"], "frozen_root_writer_lease");
    if (lease.scope !== "artifact_root" || lease.relativePath !== "manifest-transition-root.lease.json"
        || !["manifest_transition", "operational_authority_issue", "operational_authority_terminalize"].includes(String(lease.writerOperationKind))
        || typeof lease.releaseGenerationId !== "string" || lease.releaseGenerationId.length === 0) {
      throw new Error("frozen_root_writer_lease_invalid");
    }
    for (const key of [
      "writerOperationKeySha256", "protectedRootFingerprintSha256", "releaseFreezeIdentitySha256",
      "ownerProcessStartFingerprintSha256"
    ]) sha(lease[key], SHA256, key);
    if (lease.transitionKeySha256 !== null) sha(lease.transitionKeySha256, SHA256, "transition_key_sha");
    if ((lease.writerOperationKind === "manifest_transition") !== (lease.transitionKeySha256 !== null)) {
      throw new Error("frozen_root_writer_transition_key_invalid");
    }
  } else throw new Error("release_root_writer_lease_version_invalid");
  sha(lease.candidateSha, SHA40, "lease_candidate_sha");
  positiveInteger(lease.leaseEpoch, "lease_epoch");
  positiveInteger(lease.ownerPid, "owner_pid");
  const acquiredAt = iso(lease.acquiredAt, "lease_acquired_at");
  const heartbeatAt = iso(lease.heartbeatAt, "lease_heartbeat_at");
  const expiresAt = iso(lease.expiresAt, "lease_expires_at");
  if (Date.parse(heartbeatAt) < Date.parse(acquiredAt) || Date.parse(expiresAt) <= Date.parse(heartbeatAt)) {
    throw new Error("release_root_writer_lease_time_invalid");
  }
  if (isBootstrap && Date.parse(expiresAt) - Date.parse(heartbeatAt) > 60_000) {
    throw new Error("bootstrap_root_writer_lease_rolling_ttl_invalid");
  }
  if (isBootstrap && Date.parse(expiresAt) - Date.parse(acquiredAt) > 300_000) {
    throw new Error("bootstrap_root_writer_lease_absolute_ttl_invalid");
  }
  return lease as ReleaseRootWriterLeaseV2;
}

function validateTakeoverLeaseTimesV2(
  lease: ReleaseRootWriterLeaseV2,
  preparedAtValue: unknown,
  label: string
): string {
  const preparedAt = iso(preparedAtValue, `${label}_prepared_at`);
  if (lease.acquiredAt !== preparedAt || lease.heartbeatAt !== preparedAt
      || Date.parse(lease.expiresAt) - Date.parse(preparedAt) !== 60_000) {
    throw new Error(`${label}_lease_time_binding_invalid`);
  }
  return preparedAt;
}

function validateManifestLeaseTakeoverPolicyV2(value: Record<string, unknown>, label: string): void {
  if (value.commandId !== "manifest_lease_takeover"
      || value.redactedTemplateSha256 !== MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2) {
    throw new Error(`${label}_command_or_template_invalid`);
  }
}

export function validatePreparedFrozenRootWriterLeaseTakeoverV2(
  value: unknown
): PreparedFrozenRootWriterLeaseTakeoverV2 {
  assertNoSecrets(value);
  const prepared = record(value, "prepared_frozen_root_writer_lease_takeover");
  exactKeys(prepared, [
    "version", "commandId", "redactedTemplateSha256", "candidateSha",
    "releaseGenerationId", "releaseFreezeIdentitySha256", "artifactRootFingerprintSha256",
    "writerOperationKind", "writerOperationKeySha256", "transitionKeySha256",
    "oldLeaseSha256", "oldLeaseEpoch", "oldOwnerProcessIdentitySha256",
    "canonicalNewLease",
    "canonicalNewLeaseUtf8Base64", "newLeaseSha256", "newLeaseEpoch", "preparedAt"
  ], "prepared_frozen_root_writer_lease_takeover");
  if (prepared.version !== "prepared-frozen-root-writer-lease-takeover-v2"
      || typeof prepared.releaseGenerationId !== "string" || !prepared.releaseGenerationId) {
    throw new Error("prepared_frozen_root_writer_lease_takeover_invalid");
  }
  validateManifestLeaseTakeoverPolicyV2(prepared, "prepared_frozen_root_writer_lease_takeover");
  oneOf(prepared.writerOperationKind, [
    "manifest_transition", "operational_authority_issue", "operational_authority_terminalize"
  ] as const, "prepared_frozen_takeover_operation_kind");
  for (const key of [
    "oldLeaseSha256", "oldOwnerProcessIdentitySha256", "writerOperationKeySha256",
    "artifactRootFingerprintSha256", "releaseFreezeIdentitySha256", "newLeaseSha256"
  ]) sha(prepared[key], SHA256, key);
  if (prepared.transitionKeySha256 !== null) sha(prepared.transitionKeySha256, SHA256, "transition_key_sha");
  sha(prepared.candidateSha, SHA40, "prepared_frozen_takeover_candidate_sha");
  positiveInteger(prepared.oldLeaseEpoch, "prepared_frozen_takeover_old_epoch");
  positiveInteger(prepared.newLeaseEpoch, "prepared_frozen_takeover_new_epoch");
  const lease = validateReleaseRootWriterLeaseV2(prepared.canonicalNewLease);
  if (lease.version !== "frozen-root-writer-lease-v2") {
    throw new Error("prepared_frozen_takeover_new_lease_invalid");
  }
  canonicalEmbeddedBytesV2(lease, prepared.canonicalNewLeaseUtf8Base64,
    prepared.newLeaseSha256, "prepared_frozen_takeover_new_lease");
  validateTakeoverLeaseTimesV2(lease, prepared.preparedAt, "prepared_frozen_takeover");
  if (prepared.newLeaseEpoch !== Number(prepared.oldLeaseEpoch) + 1
      || lease.leaseEpoch !== prepared.newLeaseEpoch
      || lease.writerOperationKind !== prepared.writerOperationKind
      || lease.writerOperationKeySha256 !== prepared.writerOperationKeySha256
      || lease.transitionKeySha256 !== prepared.transitionKeySha256
      || lease.protectedRootFingerprintSha256 !== prepared.artifactRootFingerprintSha256
      || lease.candidateSha !== prepared.candidateSha
      || lease.releaseGenerationId !== prepared.releaseGenerationId
      || lease.releaseFreezeIdentitySha256 !== prepared.releaseFreezeIdentitySha256
      || (prepared.writerOperationKind === "manifest_transition")
        !== (prepared.transitionKeySha256 !== null)) {
    throw new Error("prepared_frozen_root_writer_lease_takeover_binding_invalid");
  }
  return { ...prepared, canonicalNewLease: lease } as PreparedFrozenRootWriterLeaseTakeoverV2;
}

export function validatePreparedBootstrapRootWriterLeaseTakeoverV2(
  value: unknown
): PreparedBootstrapRootWriterLeaseTakeoverV2 {
  assertNoSecrets(value);
  const prepared = record(value, "prepared_bootstrap_root_writer_lease_takeover");
  exactKeys(prepared, [
    "version", "commandId", "redactedTemplateSha256", "protectedRootFingerprintSha256",
    "task0BPreflightEvidenceSha256", "candidateSha", "runtimeIdentitySha256",
    "preparedFreezeMaterializationSha256", "oldLeaseSha256", "oldLeaseEpoch",
    "oldOwnerProcessIdentitySha256", "canonicalNewLease",
    "canonicalNewLeaseUtf8Base64", "newLeaseSha256", "newLeaseEpoch", "preparedAt"
  ], "prepared_bootstrap_root_writer_lease_takeover");
  if (prepared.version !== "prepared-bootstrap-root-writer-lease-takeover-v2") {
    throw new Error("prepared_bootstrap_root_writer_lease_takeover_invalid");
  }
  validateManifestLeaseTakeoverPolicyV2(prepared, "prepared_bootstrap_root_writer_lease_takeover");
  for (const key of [
    "oldLeaseSha256", "oldOwnerProcessIdentitySha256",
    "protectedRootFingerprintSha256", "task0BPreflightEvidenceSha256",
    "runtimeIdentitySha256", "newLeaseSha256"
  ]) sha(prepared[key], SHA256, key);
  if (prepared.preparedFreezeMaterializationSha256 !== null) {
    sha(prepared.preparedFreezeMaterializationSha256, SHA256, "prepared_freeze_materialization_sha");
  }
  sha(prepared.candidateSha, SHA40, "prepared_bootstrap_takeover_candidate_sha");
  positiveInteger(prepared.oldLeaseEpoch, "prepared_bootstrap_takeover_old_epoch");
  positiveInteger(prepared.newLeaseEpoch, "prepared_bootstrap_takeover_new_epoch");
  const lease = validateReleaseRootWriterLeaseV2(prepared.canonicalNewLease);
  if (lease.version !== "bootstrap-root-writer-lease-v2") {
    throw new Error("prepared_bootstrap_takeover_new_lease_invalid");
  }
  canonicalEmbeddedBytesV2(lease, prepared.canonicalNewLeaseUtf8Base64,
    prepared.newLeaseSha256, "prepared_bootstrap_takeover_new_lease");
  validateTakeoverLeaseTimesV2(lease, prepared.preparedAt, "prepared_bootstrap_takeover");
  if (prepared.newLeaseEpoch !== Number(prepared.oldLeaseEpoch) + 1
      || lease.leaseEpoch !== prepared.newLeaseEpoch
      || lease.protectedRootFingerprintSha256 !== prepared.protectedRootFingerprintSha256
      || lease.task0BPreflightEvidenceSha256 !== prepared.task0BPreflightEvidenceSha256
      || lease.candidateSha !== prepared.candidateSha
      || lease.runtimeIdentitySha256 !== prepared.runtimeIdentitySha256) {
    throw new Error("prepared_bootstrap_root_writer_lease_takeover_binding_invalid");
  }
  return { ...prepared, canonicalNewLease: lease } as PreparedBootstrapRootWriterLeaseTakeoverV2;
}

export function validateFrozenRootWriterLeaseTakeoverReceiptV2(
  value: unknown,
  preparedInput?: PreparedFrozenRootWriterLeaseTakeoverV2
): FrozenRootWriterLeaseTakeoverReceiptV2 {
  assertNoSecrets(value);
  const receipt = record(value, "frozen_root_writer_lease_takeover_receipt");
  exactKeys(receipt, [
    "version", "commandId", "redactedTemplateSha256", "candidateSha",
    "releaseGenerationId", "releaseFreezeIdentitySha256", "artifactRootFingerprintSha256",
    "writerOperationKind", "writerOperationKeySha256", "transitionKeySha256",
    "preparedTakeoverSha256", "oldLeaseSha256", "tombstoneRelativePath",
    "newLeaseSha256", "newLeaseEpoch", "committedAt"
  ], "frozen_root_writer_lease_takeover_receipt");
  if (receipt.version !== "frozen-root-writer-lease-takeover-receipt-v2"
      || typeof receipt.releaseGenerationId !== "string" || !receipt.releaseGenerationId) {
    throw new Error("frozen_root_writer_lease_takeover_receipt_invalid");
  }
  validateManifestLeaseTakeoverPolicyV2(receipt, "frozen_root_writer_lease_takeover_receipt");
  oneOf(receipt.writerOperationKind, [
    "manifest_transition", "operational_authority_issue", "operational_authority_terminalize"
  ] as const, "frozen_takeover_receipt_operation_kind");
  for (const key of [
    "oldLeaseSha256", "writerOperationKeySha256", "artifactRootFingerprintSha256",
    "releaseFreezeIdentitySha256", "preparedTakeoverSha256", "newLeaseSha256"
  ]) sha(receipt[key], SHA256, key);
  if (receipt.transitionKeySha256 !== null) sha(receipt.transitionKeySha256, SHA256, "transition_key_sha");
  sha(receipt.candidateSha, SHA40, "frozen_takeover_receipt_candidate_sha");
  positiveInteger(receipt.newLeaseEpoch, "frozen_takeover_receipt_new_epoch");
  const expectedTombstone = `manifest-transition-root.lease-tombstone-${receipt.oldLeaseSha256}.json`;
  if (receipt.tombstoneRelativePath !== expectedTombstone
      || (receipt.writerOperationKind === "manifest_transition")
        !== (receipt.transitionKeySha256 !== null)) {
    throw new Error("frozen_root_writer_lease_takeover_receipt_binding_invalid");
  }
  iso(receipt.committedAt, "frozen_takeover_receipt_committed_at");
  if (preparedInput) {
    const prepared = validatePreparedFrozenRootWriterLeaseTakeoverV2(preparedInput);
    const expected = [
      "commandId", "redactedTemplateSha256", "candidateSha", "releaseGenerationId",
      "releaseFreezeIdentitySha256", "artifactRootFingerprintSha256", "writerOperationKind",
      "writerOperationKeySha256", "transitionKeySha256", "oldLeaseSha256",
      "newLeaseSha256", "newLeaseEpoch"
    ] as const;
    if (expected.some((key) => receipt[key] !== prepared[key])
        || receipt.committedAt !== prepared.preparedAt
        || receipt.preparedTakeoverSha256 !== releaseSha256V2(
          Buffer.from(`${canonicalReleaseJsonV2(prepared)}\n`, "utf8"))) {
      throw new Error("frozen_root_writer_lease_takeover_receipt_prepared_binding_invalid");
    }
  }
  return receipt as FrozenRootWriterLeaseTakeoverReceiptV2;
}

export function validateBootstrapRootWriterLeaseTakeoverReceiptV2(
  value: unknown,
  preparedInput?: PreparedBootstrapRootWriterLeaseTakeoverV2
): BootstrapRootWriterLeaseTakeoverReceiptV2 {
  assertNoSecrets(value);
  const receipt = record(value, "bootstrap_root_writer_lease_takeover_receipt");
  exactKeys(receipt, [
    "version", "commandId", "redactedTemplateSha256", "protectedRootFingerprintSha256",
    "task0BPreflightEvidenceSha256", "candidateSha", "runtimeIdentitySha256",
    "preparedFreezeMaterializationSha256", "preparedTakeoverSha256",
    "oldLeaseSha256", "tombstoneRelativePath", "newLeaseSha256", "newLeaseEpoch", "committedAt"
  ], "bootstrap_root_writer_lease_takeover_receipt");
  if (receipt.version !== "bootstrap-root-writer-lease-takeover-receipt-v2") {
    throw new Error("bootstrap_root_writer_lease_takeover_receipt_invalid");
  }
  validateManifestLeaseTakeoverPolicyV2(receipt, "bootstrap_root_writer_lease_takeover_receipt");
  for (const key of [
    "oldLeaseSha256",
    "protectedRootFingerprintSha256", "task0BPreflightEvidenceSha256",
    "runtimeIdentitySha256", "preparedTakeoverSha256", "newLeaseSha256"
  ]) sha(receipt[key], SHA256, key);
  if (receipt.preparedFreezeMaterializationSha256 !== null) {
    sha(receipt.preparedFreezeMaterializationSha256, SHA256, "receipt_prepared_freeze_materialization_sha");
  }
  sha(receipt.candidateSha, SHA40, "bootstrap_takeover_receipt_candidate_sha");
  positiveInteger(receipt.newLeaseEpoch, "bootstrap_takeover_receipt_new_epoch");
  const expectedTombstone = `manifest-transition-root.lease-tombstone-${receipt.oldLeaseSha256}.json`;
  if (receipt.tombstoneRelativePath !== expectedTombstone) {
    throw new Error("bootstrap_root_writer_lease_takeover_receipt_binding_invalid");
  }
  iso(receipt.committedAt, "bootstrap_takeover_receipt_committed_at");
  if (preparedInput) {
    const prepared = validatePreparedBootstrapRootWriterLeaseTakeoverV2(preparedInput);
    const expected = [
      "commandId", "redactedTemplateSha256", "protectedRootFingerprintSha256",
      "task0BPreflightEvidenceSha256", "candidateSha", "runtimeIdentitySha256",
      "preparedFreezeMaterializationSha256", "oldLeaseSha256", "newLeaseSha256", "newLeaseEpoch"
    ] as const;
    if (expected.some((key) => receipt[key] !== prepared[key])
        || receipt.committedAt !== prepared.preparedAt
        || receipt.preparedTakeoverSha256 !== releaseSha256V2(
          Buffer.from(`${canonicalReleaseJsonV2(prepared)}\n`, "utf8"))) {
      throw new Error("bootstrap_root_writer_lease_takeover_receipt_prepared_binding_invalid");
    }
  }
  return receipt as BootstrapRootWriterLeaseTakeoverReceiptV2;
}

export function validateManifestTransitionClaimV2(value: unknown): ManifestTransitionClaimV2 {
  assertNoSecrets(value);
  const claim = record(value, "manifest_transition_claim");
  exactKeys(claim, [
    "version", "transitionId", "transitionKeySha256", "generationId",
    "sourceManifestSha256", "claimedAt", "expiresAt", "claimantPid",
    "claimantProcessStartFingerprintSha256"
  ], "manifest_transition_claim");
  if (claim.version !== "manifest-transition-claim-v2"
      || typeof claim.generationId !== "string" || claim.generationId.length === 0) {
    throw new Error("manifest_transition_claim_invalid");
  }
  const transitionId = oneOf(claim.transitionId, MANIFEST_TRANSITIONS_V2, "manifest_transition_claim_transition");
  sha(claim.transitionKeySha256, SHA256, "manifest_transition_key_sha");
  if (transitionId === "pre_manual") {
    if (claim.sourceManifestSha256 !== null) throw new Error("manifest_transition_claim_source_invalid");
  } else {
    sha(claim.sourceManifestSha256, SHA256, "manifest_transition_claim_source_sha");
  }
  positiveInteger(claim.claimantPid, "manifest_transition_claimant_pid");
  sha(claim.claimantProcessStartFingerprintSha256, SHA256, "manifest_transition_claimant_start_sha");
  const claimedAt = Date.parse(iso(claim.claimedAt, "manifest_transition_claimed_at"));
  const expiresAt = Date.parse(iso(claim.expiresAt, "manifest_transition_claim_expires_at"));
  if (expiresAt <= claimedAt || expiresAt - claimedAt > 120_000) {
    throw new Error("manifest_transition_claim_ttl_invalid");
  }
  return claim as ManifestTransitionClaimV2;
}

function validateReceiptEvidenceRefsV2(
  value: unknown,
  transitionId: ManifestTransitionIdV2,
  candidateSha: string
): ManifestTransitionEvidenceRefV2[] {
  if (!Array.isArray(value)) throw new Error("committed_receipt_transition_evidence_invalid");
  const refs = value.map((item) => {
    const kind = record(item, "committed_receipt_transition_evidence").kind;
    if (kind === "production_failure_evidence") {
      return validateProductionFailureTransitionEvidenceRefV2(item, candidateSha);
    }
    if (kind === "actual_rollback_evidence") {
      return validateActualRollbackTransitionEvidenceRefV2(item, candidateSha);
    }
    throw new Error("committed_receipt_transition_evidence_invalid");
  });
  const kinds = refs.map((ref) => ref.kind);
  const expected = transitionId === "production_failed"
    ? ["production_failure_evidence"]
    : transitionId === "rollback_rolled_back"
      ? ["production_failure_evidence", "actual_rollback_evidence"]
      : [];
  if (canonicalReleaseJsonV2(kinds) !== canonicalReleaseJsonV2(expected)) {
    throw new Error("committed_receipt_transition_evidence_invalid");
  }
  return refs;
}

export function validateCommittedManifestTransitionReceiptV2(
  value: unknown
): CommittedManifestTransitionReceiptV2 {
  assertNoSecrets(value);
  const receipt = record(value, "committed_manifest_transition_receipt");
  exactKeys(receipt, [
    "version", "transitionId", "transitionKeySha256", "candidateSha",
    "artifactRootFingerprintSha256", "releaseFreezeIdentitySha256",
    "sourceManifestSha256", "previousReceiptSha256",
    "targetManifestProjectionSha256", "sourceRevision", "targetRevision",
    "gateOutputSha256s", "transitionEvidence", "committedAt"
  ], "committed_manifest_transition_receipt");
  if (receipt.version !== "committed-manifest-transition-receipt-v2") {
    throw new Error("committed_manifest_transition_receipt_invalid");
  }
  const transitionId = oneOf(receipt.transitionId, MANIFEST_TRANSITIONS_V2, "committed_receipt_transition");
  const candidateSha = sha(receipt.candidateSha, SHA40, "committed_receipt_candidate_sha");
  for (const key of [
    "transitionKeySha256", "artifactRootFingerprintSha256",
    "releaseFreezeIdentitySha256", "targetManifestProjectionSha256"
  ]) sha(receipt[key], SHA256, key);
  const targetRevision = positiveInteger(receipt.targetRevision, "committed_receipt_target_revision");
  if (transitionId === "pre_manual") {
    if (receipt.sourceManifestSha256 !== null || receipt.previousReceiptSha256 !== null
        || receipt.sourceRevision !== null || targetRevision !== 1) {
      throw new Error("committed_receipt_initial_lineage_invalid");
    }
  } else {
    sha(receipt.sourceManifestSha256, SHA256, "committed_receipt_source_manifest_sha");
    sha(receipt.previousReceiptSha256, SHA256, "committed_receipt_previous_receipt_sha");
    const sourceRevision = positiveInteger(receipt.sourceRevision, "committed_receipt_source_revision");
    if (targetRevision !== sourceRevision + 1) throw new Error("committed_receipt_revision_invalid");
  }
  if (!Array.isArray(receipt.gateOutputSha256s)
      || new Set(receipt.gateOutputSha256s).size !== receipt.gateOutputSha256s.length) {
    throw new Error("committed_receipt_gate_outputs_invalid");
  }
  receipt.gateOutputSha256s.forEach((item) => sha(item, SHA256, "committed_receipt_gate_output_sha"));
  const transitionEvidence = validateReceiptEvidenceRefsV2(
    receipt.transitionEvidence,
    transitionId,
    candidateSha
  );
  iso(receipt.committedAt, "committed_receipt_committed_at");
  return { ...receipt, transitionEvidence } as CommittedManifestTransitionReceiptV2;
}

function canonicalCommittedReceiptUtf8V2(receipt: CommittedManifestTransitionReceiptV2): Buffer {
  return Buffer.from(`${canonicalReleaseJsonV2(receipt)}\n`, "utf8");
}

export function validatePreparedManifestTransitionV2(value: unknown): PreparedManifestTransitionV2 {
  assertNoSecrets(value);
  const prepared = record(value, "prepared_manifest_transition");
  exactKeys(prepared, [
    "version", "transitionId", "transitionKeySha256", "generationId",
    "sourceManifestSha256", "previousReceiptSha256", "targetRevision",
    "gateOutputSha256s", "targetSnapshotRelativePath", "targetSnapshotSha256",
    "canonicalCommittedReceipt", "canonicalCommittedReceiptUtf8Base64",
    "committedReceiptSha256", "preparedAt"
  ], "prepared_manifest_transition");
  if (prepared.version !== "prepared-manifest-transition-v2"
      || typeof prepared.generationId !== "string" || prepared.generationId.length === 0
      || typeof prepared.targetSnapshotRelativePath !== "string"
      || !SAFE_RELATIVE_PATH.test(prepared.targetSnapshotRelativePath)) {
    throw new Error("prepared_manifest_transition_invalid");
  }
  const transitionId = oneOf(prepared.transitionId, MANIFEST_TRANSITIONS_V2, "prepared_manifest_transition_id");
  sha(prepared.transitionKeySha256, SHA256, "prepared_transition_key_sha");
  sha(prepared.targetSnapshotSha256, SHA256, "prepared_target_snapshot_sha");
  const targetRevision = positiveInteger(prepared.targetRevision, "prepared_target_revision");
  const receipt = validateCommittedManifestTransitionReceiptV2(prepared.canonicalCommittedReceipt);
  if (typeof prepared.canonicalCommittedReceiptUtf8Base64 !== "string"
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        prepared.canonicalCommittedReceiptUtf8Base64
      )) {
    throw new Error("prepared_manifest_receipt_bytes_invalid");
  }
  const receiptBytes = Buffer.from(prepared.canonicalCommittedReceiptUtf8Base64, "base64");
  if (!receiptBytes.equals(canonicalCommittedReceiptUtf8V2(receipt))
      || receiptBytes.toString("base64") !== prepared.canonicalCommittedReceiptUtf8Base64) {
    throw new Error("prepared_manifest_receipt_bytes_invalid");
  }
  sha(prepared.committedReceiptSha256, SHA256, "prepared_committed_receipt_sha");
  if (releaseSha256V2(receiptBytes) !== prepared.committedReceiptSha256) {
    throw new Error("prepared_manifest_receipt_hash_invalid");
  }
  if (!Array.isArray(prepared.gateOutputSha256s)
      || canonicalReleaseJsonV2(prepared.gateOutputSha256s)
        !== canonicalReleaseJsonV2(receipt.gateOutputSha256s)
      || prepared.transitionId !== receipt.transitionId
      || prepared.transitionKeySha256 !== receipt.transitionKeySha256
      || prepared.sourceManifestSha256 !== receipt.sourceManifestSha256
      || prepared.previousReceiptSha256 !== receipt.previousReceiptSha256
      || targetRevision !== receipt.targetRevision
      || prepared.preparedAt !== receipt.committedAt) {
    throw new Error("prepared_manifest_receipt_binding_invalid");
  }
  iso(prepared.preparedAt, "prepared_at");
  return { ...prepared, canonicalCommittedReceipt: receipt } as PreparedManifestTransitionV2;
}

export function validateManifestCommittedReceiptBindingV2(
  manifestValue: unknown,
  receiptValue: unknown,
  sourceManifestValue?: unknown
): {
  manifest: RemediationReleaseManifestV2;
  receipt: CommittedManifestTransitionReceiptV2;
} {
  const manifest = validateRemediationReleaseManifestV2(manifestValue);
  const receipt = validateCommittedManifestTransitionReceiptV2(receiptValue);
  const receiptSha256 = releaseSha256V2(canonicalCommittedReceiptUtf8V2(receipt));
  if (manifest.latestCommittedReceiptSha256 !== receiptSha256) {
    throw new Error("manifest_receipt_hash_invalid");
  }
  const { latestCommittedReceiptSha256: _omitted, ...projection } = manifest;
  if (receipt.targetManifestProjectionSha256
      !== releaseSha256V2(canonicalReleaseJsonV2(projection))) {
    throw new Error("manifest_receipt_projection_invalid");
  }
  if (receipt.transitionId !== manifest.transitionId
      || receipt.candidateSha !== manifest.candidateSha
      || receipt.artifactRootFingerprintSha256 !== manifest.artifactRootFingerprintSha256
      || receipt.releaseFreezeIdentitySha256 !== manifest.releaseFreezeIdentitySha256
      || receipt.targetRevision !== manifest.revision
      || receipt.committedAt !== manifest.updatedAt
      || canonicalReleaseJsonV2(receipt.transitionEvidence)
        !== canonicalReleaseJsonV2(manifest.transitionEvidence)) {
    throw new Error("manifest_receipt_target_binding_invalid");
  }
  let source: RemediationReleaseManifestV2 | undefined;
  if (manifest.revision === 1) {
    if (sourceManifestValue !== undefined || receipt.sourceManifestSha256 !== null
        || receipt.previousReceiptSha256 !== null || receipt.sourceRevision !== null) {
      throw new Error("manifest_receipt_initial_binding_invalid");
    }
  } else {
    if (sourceManifestValue === undefined) throw new Error("manifest_receipt_source_required");
    source = validateRemediationReleaseManifestV2(sourceManifestValue);
    const sourceSha256 = releaseManifestSha256V2(source);
    if (manifest.previousManifestSha256 !== sourceSha256
        || receipt.sourceManifestSha256 !== sourceSha256
        || receipt.previousReceiptSha256 !== source.latestCommittedReceiptSha256
        || receipt.sourceRevision !== source.revision
        || manifest.revision !== source.revision + 1
        || source.candidateSha !== manifest.candidateSha
        || source.planBaseSha !== manifest.planBaseSha
        || source.artifactRootFingerprintSha256 !== manifest.artifactRootFingerprintSha256
        || source.releaseFreezeIdentitySha256 !== manifest.releaseFreezeIdentitySha256) {
      throw new Error("manifest_receipt_source_binding_invalid");
    }
  }
  const expectedGateOutputSha256s = manifest.gates
    .filter((gate, index) => gate.state === "passed" || gate.state === "failed"
      ? source === undefined
        || canonicalReleaseJsonV2(gate) !== canonicalReleaseJsonV2(source.gates[index])
      : false)
    .map((gate) => releaseSha256V2(`${canonicalReleaseJsonV2(gate)}\n`));
  if (canonicalReleaseJsonV2(receipt.gateOutputSha256s)
      !== canonicalReleaseJsonV2(expectedGateOutputSha256s)) {
    throw new Error("manifest_receipt_gate_output_binding_invalid");
  }
  return { manifest, receipt };
}

function expectedNextNormalTransition(current: ManifestTransitionIdV2, target: ManifestTransitionIdV2): boolean {
  return ({
    pre_manual: "readiness",
    readiness: "g12_backup_passed",
    g12_backup_passed: "g13_migration_passed",
    g13_migration_passed: "g14_rollout_passed",
    g14_rollout_passed: "g15_canary_released"
  } as Partial<Record<ManifestTransitionIdV2, ManifestTransitionIdV2>>)[current] === target;
}

function expectedFailureGate(current: ManifestTransitionIdV2): ProductionGateIdV2 | null {
  return ({
    readiness: "G12_PRODUCTION_BACKUP",
    g12_backup_passed: "G13_PRODUCTION_MIGRATION",
    g13_migration_passed: "G14_PRODUCTION_ROLLOUT",
    g14_rollout_passed: "G15_PRODUCTION_CANARY"
  } as Partial<Record<ManifestTransitionIdV2, ProductionGateIdV2>>)[current] ?? null;
}

function parseVerifiedTransition(value: unknown): VerifiedManifestTransitionV2 {
  const transition = record(value, "verified_manifest_transition");
  exactKeys(transition, [
    "transitionId", "evaluatedAt", "latestCommittedReceiptSha256", "operationalAttestation"
  ], "verified_manifest_transition");
  const transitionId = oneOf(transition.transitionId, MANIFEST_TRANSITIONS_V2, "manifest_transition_id");
  if (transitionId === "pre_manual") throw new Error("pre_manual_requires_initial_creation");
  iso(transition.evaluatedAt, "evaluated_at");
  sha(transition.latestCommittedReceiptSha256, SHA256, "latest_committed_receipt_sha");
  if (transition.operationalAttestation !== null) validateOperationalAttestationV2(transition.operationalAttestation);
  return transition as VerifiedManifestTransitionV2;
}

export function validateVerifiedManifestTransitionEvidenceV2(
  value: unknown
): VerifiedManifestTransitionEvidenceV2 {
  const verified = record(value, "verified_transition_evidence");
  const hasProductionFailureEvidence = Object.prototype.hasOwnProperty.call(
    verified, "productionFailureEvidence"
  );
  exactKeys(verified, hasProductionFailureEvidence
    ? ["refs", "actualRollbackOutcome", "productionFailureEvidence"]
    : ["refs", "actualRollbackOutcome"], "verified_transition_evidence");
  if (!Array.isArray(verified.refs)) throw new Error("verified_transition_refs_invalid");
  const refs = verified.refs.map((ref) => {
    const kind = record(ref, "transition_evidence_ref").kind;
    if (kind === "production_failure_evidence") return validateProductionFailureTransitionEvidenceRefV2(ref);
    if (kind === "actual_rollback_evidence") return validateActualRollbackTransitionEvidenceRefV2(ref);
    throw new Error("transition_evidence_kind_invalid");
  });
  const actualRollbackOutcome = verified.actualRollbackOutcome === null
    ? null : validateProductionRollbackOutcomeV2(verified.actualRollbackOutcome);
  return hasProductionFailureEvidence
    ? { refs, actualRollbackOutcome,
      productionFailureEvidence: validateProductionFailureEvidenceV2(
        verified.productionFailureEvidence) }
    : { refs, actualRollbackOutcome };
}

function requireOperationalAttestation(
  transition: VerifiedManifestTransitionV2,
  current: RemediationReleaseManifestV2,
  sourceManifestSha256: string,
  transitionEvidence: VerifiedManifestTransitionEvidenceV2
): void {
  const recoveryEvidence = transitionEvidence.productionFailureEvidence;
  const isRecoveryFailure = transition.transitionId === "production_failed"
    && recoveryEvidence?.evidenceKind === "abandoned_operation_recovery";
  if (recoveryEvidence !== undefined && !isRecoveryFailure) {
    throw new Error("production_recovery_evidence_branch_invalid");
  }
  const productionAction = [
    "g12_backup_passed", "g13_migration_passed", "g14_rollout_passed",
    "g15_canary_released", "rollback_rolled_back"
  ].includes(transition.transitionId) || isRecoveryFailure;
  if (!productionAction) {
    if (transition.operationalAttestation !== null) throw new Error("unexpected_operational_attestation");
    return;
  }
  if (transition.operationalAttestation === null) throw new Error("operational_attestation_required");
  const attestation = validateOperationalAttestationV2(transition.operationalAttestation);
  if (attestation.action !== transition.transitionId || attestation.candidateSha !== current.candidateSha
      || attestation.releaseFreezeIdentitySha256 !== current.releaseFreezeIdentitySha256
      || attestation.sourceManifestSha256 !== sourceManifestSha256
      || attestation.artifactRootFingerprintSha256 !== current.artifactRootFingerprintSha256
      || Date.parse(attestation.issuedAt) > Date.parse(transition.evaluatedAt)
      || Date.parse(transition.evaluatedAt) >= Date.parse(attestation.expiresAt)) {
    throw new Error("operational_attestation_transition_binding_invalid");
  }
  if (isRecoveryFailure && recoveryEvidence !== undefined
      && (recoveryEvidence.candidateSha !== current.candidateSha
        || recoveryEvidence.releaseFreezeIdentitySha256 !== current.releaseFreezeIdentitySha256
        || recoveryEvidence.sourceManifestSha256 !== sourceManifestSha256
        || recoveryEvidence.recoveryOperationalAttestationSha256
          !== releaseSha256V2(`${canonicalReleaseJsonV2(attestation)}\n`))) {
    throw new Error("production_recovery_authority_evidence_binding_invalid");
  }
  const policy = OPERATIONAL_ATTESTATION_POLICY_V2[
    transition.transitionId as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2
  ];
  if (attestation.commandId !== policy.commandId
      || attestation.redactedTemplateSha256
        !== operationalAttestationTemplateSha256V2(transition.transitionId as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2)) {
    throw new Error("operational_attestation_command_invalid");
  }
}

function parseVerifiedGateOutputs(value: unknown, candidateSha: string): ExecutedReleaseGateV2[] {
  if (!Array.isArray(value)) throw new Error("verified_gate_outputs_required");
  const gates = value.map(validateReleaseGateV2);
  if (gates.some((gate) => gate.state === "pending" || gate.state === "blocked"
      || gate.candidateSha !== candidateSha)) throw new Error("verified_gate_output_invalid");
  if (new Set(gates.map((gate) => gate.id)).size !== gates.length) throw new Error("verified_gate_output_duplicate");
  return gates as ExecutedReleaseGateV2[];
}

export function createInitialRemediationReleaseManifestV2(input: {
  freezeIdentity: unknown;
  sourceManifest?: unknown;
  evaluatedAt: string;
  latestCommittedReceiptSha256: unknown;
  verifiedGateOutputs?: unknown;
}): RemediationReleaseManifestV2 {
  if (input.sourceManifest !== undefined) throw new Error("initial_manifest_requires_absent_source");
  const freeze = validateReleaseFreezeIdentityV2(input.freezeIdentity);
  const evaluatedAt = iso(input.evaluatedAt, "evaluated_at");
  const latestCommittedReceiptSha256 = sha(
    input.latestCommittedReceiptSha256,
    SHA256,
    "latest_committed_receipt_sha"
  );
  const outputs = parseVerifiedGateOutputs(input.verifiedGateOutputs, freeze.candidateSha);
  const expectedPassed = RELEASE_GATE_IDS_V2.filter((_, index) => index <= 4 || (index >= 6 && index <= 11));
  if (outputs.length !== expectedPassed.length
      || outputs.some((gate, index) => gate.id !== expectedPassed[index] || gate.state !== "passed")) {
    throw new Error("initial_verified_gate_outputs_invalid");
  }
  const outputMap = new Map(outputs.map((gate) => [gate.id, gate]));
  return validateRemediationReleaseManifestV2({
    version: "remediation-release-manifest-v2",
    candidateSha: freeze.candidateSha,
    planBaseSha: freeze.planBaseSha,
    revision: 1,
    previousManifestSha256: null,
    updatedAt: evaluatedAt,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    latestCommittedReceiptSha256,
    requiredRequirementIds: [...REQUIRED_REQUIREMENT_IDS_V2],
    requiredAcceptanceIds: [...REQUIRED_ACCEPTANCE_IDS_V2],
    gates: RELEASE_GATE_IDS_V2.map((id) => outputMap.get(id) ?? ({ id, candidateSha: freeze.candidateSha, state: "pending" })),
    transitionId: "pre_manual",
    overall: "not_ready",
    transitionEvidence: [],
    actualRollback: null
  });
}

export function reduceManifestTransition(
  currentValue: unknown,
  transitionValue: unknown,
  verifiedGateOutputsValue: unknown,
  verifiedTransitionEvidenceValue: unknown
): RemediationReleaseManifestV2 {
  const current = validateRemediationReleaseManifestV2(currentValue);
  const transition = parseVerifiedTransition(transitionValue);
  const gateOutputs = parseVerifiedGateOutputs(verifiedGateOutputsValue, current.candidateSha);
  const transitionEvidence = validateVerifiedManifestTransitionEvidenceV2(
    verifiedTransitionEvidenceValue
  );
  const sourceManifestSha256 = releaseManifestSha256V2(current);
  requireOperationalAttestation(transition, current, sourceManifestSha256, transitionEvidence);

  let gates = [...current.gates];
  let overall: RemediationReleaseManifestV2["overall"] = "not_ready";
  let refs: ManifestTransitionEvidenceRefV2[] = [];
  let actualRollback: RemediationReleaseManifestV2["actualRollback"] = null;

  if (expectedNextNormalTransition(current.transitionId, transition.transitionId)) {
    if (transitionEvidence.refs.length !== 0 || transitionEvidence.actualRollbackOutcome !== null
        || gateOutputs.length !== 1 || gateOutputs[0].state !== "passed") {
      throw new Error("normal_transition_verified_inputs_invalid");
    }
    const expectedGate = ({
      readiness: "G05_TELEGRAM",
      g12_backup_passed: "G12_PRODUCTION_BACKUP",
      g13_migration_passed: "G13_PRODUCTION_MIGRATION",
      g14_rollout_passed: "G14_PRODUCTION_ROLLOUT",
      g15_canary_released: "G15_PRODUCTION_CANARY"
    } as Partial<Record<ManifestTransitionIdV2, ReleaseGateIdV2>>)[transition.transitionId];
    if (gateOutputs[0].id !== expectedGate) throw new Error("normal_transition_gate_invalid");
    gates = gates.map((gate) => gate.id === expectedGate ? gateOutputs[0] : gate);
    overall = transition.transitionId === "readiness" ? "ready_for_release"
      : transition.transitionId === "g15_canary_released" ? "released" : "not_ready";
  } else if (transition.transitionId === "production_failed") {
    const failedGateId = expectedFailureGate(current.transitionId);
    if (failedGateId === null || gateOutputs.length !== 1 || gateOutputs[0].id !== failedGateId
        || gateOutputs[0].state !== "failed" || transitionEvidence.refs.length !== 1
        || transitionEvidence.refs[0].kind !== "production_failure_evidence"
        || transitionEvidence.actualRollbackOutcome !== null) {
      throw new Error("production_failure_verified_inputs_invalid");
    }
    const failure = validateProductionFailureTransitionEvidenceRefV2(transitionEvidence.refs[0], current.candidateSha);
    if (failure.sourceManifestSha256 !== sourceManifestSha256) throw new Error("production_failure_source_invalid");
    if (transitionEvidence.productionFailureEvidence !== undefined) {
      const recovery = transitionEvidence.productionFailureEvidence;
      if (recovery.evidenceKind !== "abandoned_operation_recovery"
          || recovery.failedGateId !== failedGateId
          || recovery.candidateSha !== current.candidateSha
          || recovery.releaseFreezeIdentitySha256 !== current.releaseFreezeIdentitySha256
          || recovery.sourceManifestSha256 !== sourceManifestSha256
          || failure.sha256 !== releaseSha256V2(`${canonicalReleaseJsonV2(recovery)}\n`)) {
        throw new Error("production_recovery_failure_evidence_binding_invalid");
      }
    }
    const failedIndex = RELEASE_GATE_IDS_V2.indexOf(failedGateId);
    gates = gates.map((gate, index) => {
      if (index === failedIndex) return gateOutputs[0];
      if (index > failedIndex) return {
        id: gate.id as ProductionGateIdV2,
        candidateSha: current.candidateSha,
        state: "blocked" as const,
        blockedByGateId: failedGateId,
        productionFailureEvidence: failure
      };
      return gate;
    });
    refs = [failure];
  } else if (transition.transitionId === "rollback_rolled_back" && current.transitionId === "production_failed") {
    if (gateOutputs.length !== 0 || transitionEvidence.refs.length !== 2
        || transitionEvidence.refs[0].kind !== "production_failure_evidence"
        || transitionEvidence.refs[1].kind !== "actual_rollback_evidence"
        || transitionEvidence.actualRollbackOutcome === null) {
      throw new Error("rollback_verified_inputs_invalid");
    }
    const failure = validateProductionFailureTransitionEvidenceRefV2(transitionEvidence.refs[0], current.candidateSha);
    const rollback = validateActualRollbackTransitionEvidenceRefV2(transitionEvidence.refs[1], current.candidateSha);
    if (canonicalReleaseJsonV2(failure) !== canonicalReleaseJsonV2(current.transitionEvidence[0])
        || rollback.sourceManifestSha256 !== sourceManifestSha256) throw new Error("rollback_lineage_invalid");
    const failedGateId = current.gates.find((gate) => gate.state === "failed")!.id as ProductionGateIdV2;
    if (transitionEvidence.actualRollbackOutcome.failedGateId !== failedGateId) throw new Error("rollback_failed_gate_mismatch");
    refs = [failure, rollback];
    actualRollback = { evidence: rollback, outcome: transitionEvidence.actualRollbackOutcome };
    overall = "rolled_back";
  } else throw new Error("manifest_transition_order_invalid");

  return validateRemediationReleaseManifestV2({
    ...current,
    revision: current.revision + 1,
    previousManifestSha256: sourceManifestSha256,
    updatedAt: transition.evaluatedAt,
    latestCommittedReceiptSha256: transition.latestCommittedReceiptSha256,
    gates,
    transitionId: transition.transitionId,
    overall,
    transitionEvidence: refs,
    actualRollback
  });
}

// Frozen API alias retained while the store migrates to the verified four-input reducer.
export function reduceRemediationReleaseManifestV2(
  currentValue: unknown,
  transitionValue: unknown,
  verifiedGateOutputsValue?: unknown,
  verifiedTransitionEvidenceValue?: unknown
): RemediationReleaseManifestV2 {
  return reduceManifestTransition(
    currentValue,
    transitionValue,
    verifiedGateOutputsValue,
    verifiedTransitionEvidenceValue
  );
}

export function validateManifestGateEvidenceV2(
  manifestValue: unknown,
  bytesByRelativePath: ReadonlyMap<string, GateEvidencePayloadV2>,
  expected: GateEvidenceBindingContextV2 = {}
): RemediationReleaseManifestV2 {
  const manifest = validateRemediationReleaseManifestV2(manifestValue);
  for (const gate of manifest.gates) {
    if (gate.state === "passed" || gate.state === "failed") {
      const sourceManifestSha256 = (gate.id === "G12_PRODUCTION_BACKUP"
          || gate.id === "G13_PRODUCTION_MIGRATION" || gate.id === "G14_PRODUCTION_ROLLOUT"
          || gate.id === "G15_PRODUCTION_CANARY")
        ? expected.sourceManifestSha256ByGate?.[gate.id] ?? expected.sourceManifestSha256
        : expected.sourceManifestSha256;
      validateGateEvidenceBytesV2(gate, bytesByRelativePath, { ...expected, sourceManifestSha256 });
    }
  }
  return manifest;
}

export function deriveProductionGateSourceManifestBindingsV2(
  head: RemediationReleaseManifestV2,
  artifacts: ReadonlyMap<string, GateEvidencePayloadV2>
): Readonly<Partial<Record<ProductionGateIdV2, string>>> {
  const result: Partial<Record<ProductionGateIdV2, string>> = {};
  let target = head;
  while (target.revision > 1) {
    if (typeof target.previousManifestSha256 !== "string") {
      throw new Error("release_manifest_source_lineage_invalid");
    }
    const sourcePath = `manifest-snapshots/release-manifest-r${target.revision - 1}-${target.previousManifestSha256}.json`;
    const sourceBytes = artifacts.get(sourcePath);
    if (!Buffer.isBuffer(sourceBytes) || releaseSha256V2(sourceBytes) !== target.previousManifestSha256) {
      throw new Error("release_manifest_source_snapshot_missing");
    }
    let sourceValue: unknown;
    try { sourceValue = JSON.parse(sourceBytes.toString("utf8")); }
    catch { throw new Error("release_manifest_source_snapshot_json_invalid"); }
    const source = validateRemediationReleaseManifestV2(sourceValue);
    if (!sourceBytes.equals(Buffer.from(`${canonicalReleaseJsonV2(source)}\n`, "utf8"))
        || source.revision !== target.revision - 1
        || source.candidateSha !== target.candidateSha
        || source.artifactRootFingerprintSha256 !== target.artifactRootFingerprintSha256
        || source.releaseFreezeIdentitySha256 !== target.releaseFreezeIdentitySha256) {
      throw new Error("release_manifest_source_snapshot_binding_invalid");
    }
    for (const gateId of PRODUCTION_GATE_IDS_V2) {
      const before = source.gates.find((gate) => gate.id === gateId)!;
      const after = target.gates.find((gate) => gate.id === gateId)!;
      const becameExecuted = (after.state === "passed" || after.state === "failed")
        && before.state !== after.state;
      if (!becameExecuted) continue;
      if (before.state === "passed" || before.state === "failed" || result[gateId] !== undefined) {
        throw new Error("release_manifest_production_gate_lineage_invalid");
      }
      result[gateId] = target.previousManifestSha256;
    }
    target = source;
  }
  for (const gateId of PRODUCTION_GATE_IDS_V2) {
    const gate = head.gates.find((item) => item.id === gateId)!;
    if ((gate.state === "passed" || gate.state === "failed") && result[gateId] === undefined) {
      throw new Error(`release_manifest_production_gate_source_missing:${gateId}`);
    }
  }
  return result;
}

export function verifyRemediationReleaseArtifactsSyncV2(
  artifacts: ReadonlyMap<string, GateEvidencePayloadV2>
): RemediationReleaseManifestV2 {
  const manifestBytes = artifacts.get("release-manifest.json");
  if (!Buffer.isBuffer(manifestBytes)) throw new Error("release_manifest_v2_missing");
  let value: unknown;
  try { value = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw new Error("release_manifest_v2_json_invalid"); }
  const freezeBytes = artifacts.get("release-freeze-identity-v2.json");
  if (!Buffer.isBuffer(freezeBytes)) throw new Error("release_freeze_identity_v2_missing");
  let freezeValue: unknown;
  try { freezeValue = JSON.parse(freezeBytes.toString("utf8")); }
  catch { throw new Error("release_freeze_identity_v2_json_invalid"); }
  const freeze = validateReleaseFreezeIdentityV2(freezeValue);
  if (!freezeBytes.equals(canonicalReleaseFreezeIdentityUtf8V2(freeze))) {
    throw new Error("release_freeze_identity_v2_noncanonical");
  }
  const parsedManifest = validateRemediationReleaseManifestV2(value);
  const task0bBytes = artifacts.get("task0b-release-freeze.json");
  if (!Buffer.isBuffer(task0bBytes)) throw new Error("task0b_release_freeze_missing");
  const task0bBinding = deriveTask0BProductionGateBindingV2(
    task0bBytes,
    freeze.candidateSha,
    freeze.productionDatabaseIdentityFingerprintSha256
  );
  const sourceManifestSha256ByGate = deriveProductionGateSourceManifestBindingsV2(parsedManifest, artifacts);
  const manifest = validateManifestGateEvidenceV2(value, artifacts, {
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    artifactRootTrustBoundaryEvidenceSha256: freeze.artifactRootTrustBoundaryEvidenceSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    sourceManifestSha256ByGate,
    requireStandaloneAuthorityBinding: true,
    ...task0bBinding
  });
  if (manifest.candidateSha !== freeze.candidateSha
      || manifest.artifactRootFingerprintSha256 !== freeze.artifactRootFingerprintSha256
      || manifest.releaseFreezeIdentitySha256 !== releaseFreezeIdentitySha256V2(freeze)) {
    throw new Error("release_manifest_freeze_binding_invalid");
  }
  let failure: ProductionFailureEvidenceV2 | null = null;
  for (const ref of manifest.transitionEvidence) {
    const bytes = artifacts.get(ref.relativePath);
    if (!Buffer.isBuffer(bytes) || releaseSha256V2(bytes) !== ref.sha256) {
      throw new Error("release_transition_evidence_bytes_invalid");
    }
    let evidence: unknown;
    try { evidence = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("release_transition_evidence_json_invalid"); }
    if (!bytes.equals(Buffer.from(`${canonicalReleaseJsonV2(evidence)}\n`, "utf8"))) {
      throw new Error("release_transition_evidence_noncanonical");
    }
    if (ref.kind === "production_failure_evidence") {
      failure = validateProductionFailureEvidenceV2(evidence);
      if (failure.candidateSha !== manifest.candidateSha) {
        throw new Error("release_transition_failure_candidate_mismatch");
      }
    } else {
      const rollback = validateProductionRollbackEvidenceV2(evidence);
      if (rollback.candidateSha !== manifest.candidateSha || failure === null
          || rollback.failureEvidenceSha256 !== manifest.transitionEvidence[0]?.sha256
          || manifest.actualRollback === null
          || canonicalReleaseJsonV2(rollback.outcome) !== canonicalReleaseJsonV2(manifest.actualRollback.outcome)) {
        throw new Error("release_transition_rollback_binding_invalid");
      }
    }
  }
  return manifest;
}

export async function verifyRemediationReleaseArtifactsV2(
  artifacts: ReadonlyMap<string, GateEvidencePayloadV2>
): Promise<RemediationReleaseManifestV2> {
  return verifyRemediationReleaseArtifactsSyncV2(artifacts);
}

export function assertProductionMutatorAuthorityV2(): never {
  throw new Error("production_mutator_authority_unverified");
}

const PRODUCTION_OPERATION_KINDS_V2 = ["rollout", "canary", "rollback", "recovery"] as const;
const PRODUCTION_CAPABILITIES_V2 = ["effect_capable", "recovery_only", "cleanup_only"] as const;
const PRODUCTION_OPERATION_COMMANDS_V2 = [
  "production_rollout", "production_canary", "production_rollback", "production_recovery"
] as const;
const SCHEMA032_CHECKSUM_V2 = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
const SCHEMA033_CHECKSUM_V2 = "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7";
const SCHEMA033_CATALOG_SHA256_V2 = "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4";
const SCHEMA032_STAGES_V2 = [
  "first_migration", "first_verification", "second_migration", "final_verification"
] as const;

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label}_invalid`);
  return value;
}

function nullableSha(value: unknown, label: string): string | null {
  return value === null ? null : sha(value, SHA256, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}_invalid`);
  return value;
}

function operationCommand(kind: unknown, commandId: unknown, label: string): void {
  const expected: Record<ProductionOperationKindV2, ProductionOperationCommandIdV2> = {
    rollout: "production_rollout", canary: "production_canary",
    rollback: "production_rollback", recovery: "production_recovery"
  };
  if (expected[oneOf(kind, PRODUCTION_OPERATION_KINDS_V2, `${label}_kind`)] !== commandId) {
    throw new Error(`${label}_command_binding_invalid`);
  }
}

function canonicalObjectSha(value: unknown): string {
  return releaseSha256V2(Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8"));
}

function productionIdentityFields(input: Record<string, unknown>, label: string): void {
  oneOf(input.operationKind, PRODUCTION_OPERATION_KINDS_V2, `${label}_kind`);
  nonEmpty(input.operationId, `${label}_operation_id`);
  sha(input.candidateSha, SHA40, `${label}_candidate_sha`);
  nonEmpty(input.releaseGenerationId, `${label}_generation`);
  sha(input.sourceManifestSha256, SHA256, `${label}_source_manifest`);
  sha(input.artifactRootFingerprintSha256, SHA256, `${label}_root_fingerprint`);
}

export function validateProductionAuthorityPreclaimValidationV2(
  value: unknown
): ProductionAuthorityPreclaimValidationV2 {
  assertNoSecrets(value);
  const input = record(value, "production_authority_preclaim_validation");
  exactKeys(input, [
    "version", "operationKind", "operationId", "candidateSha", "releaseGenerationId",
    "sourceManifestSha256", "artifactRootFingerprintSha256", "operationalAttestationSha256",
    "operationalAttestationIssuerReceiptSha256", "recoveryFromAbandonedOperationSha256",
    "commandId", "redactedTemplateSha256", "originalLeaseSha256", "originalLeaseEpoch",
    "originalLeaseOwnerProcessIdentitySha256", "checkedAt", "expiresAt", "operationDeadlineAt",
    "minimumRequiredValidityMs", "status"
  ], "production_authority_preclaim_validation");
  if (input.version !== "production-authority-preclaim-validation-v2"
      || input.status !== "fresh_compatible_unconsumed") throw new Error("production_authority_preclaim_validation_literal_invalid");
  productionIdentityFields(input, "production_authority_preclaim_validation");
  for (const key of ["operationalAttestationSha256", "operationalAttestationIssuerReceiptSha256",
    "redactedTemplateSha256", "originalLeaseSha256", "originalLeaseOwnerProcessIdentitySha256"]) {
    sha(input[key], SHA256, key);
  }
  nullableSha(input.recoveryFromAbandonedOperationSha256, "recovery_from_abandoned");
  oneOf(input.commandId, PRODUCTION_OPERATION_COMMANDS_V2, "preclaim_command");
  operationCommand(input.operationKind, input.commandId, "preclaim");
  positiveInteger(input.originalLeaseEpoch, "original_lease_epoch");
  positiveInteger(input.minimumRequiredValidityMs, "minimum_required_validity_ms");
  const checked = iso(input.checkedAt, "preclaim_checked_at");
  const expires = iso(input.expiresAt, "preclaim_expires_at");
  const deadline = iso(input.operationDeadlineAt, "preclaim_deadline_at");
  if (Date.parse(expires) <= Date.parse(checked)
      || Date.parse(deadline) <= Date.parse(checked)
      || Date.parse(expires) - Date.parse(checked) < Number(input.minimumRequiredValidityMs)
      || Date.parse(deadline) - Date.parse(checked) < Number(input.minimumRequiredValidityMs)
      || ((input.operationKind === "recovery") !== (input.recoveryFromAbandonedOperationSha256 !== null))) {
    throw new Error("production_authority_preclaim_validation_time_invalid");
  }
  return input as ProductionAuthorityPreclaimValidationV2;
}

export function validateProductionPreclaimLeaseLineageV2(value: unknown): ProductionPreclaimLeaseLineageV2 {
  assertNoSecrets(value);
  const input = record(value, "production_preclaim_lease_lineage");
  exactKeys(input, [
    "version", "operationId", "relativePath", "preclaimValidationSha256", "previousLineageSha256",
    "originalLeaseSha256", "originalLeaseEpoch", "originalLeaseOwnerProcessIdentitySha256",
    "committedTakeoverReceiptSuffixSha256s", "currentTipLeaseSha256", "currentTipLeaseEpoch",
    "currentTipLeaseOwnerProcessIdentitySha256", "lineageStartedAt", "resolvedAt"
  ], "production_preclaim_lease_lineage");
  if (input.version !== "production-preclaim-lease-lineage-v2") throw new Error("production_preclaim_lease_lineage_version_invalid");
  const operationId = nonEmpty(input.operationId, "lineage_operation_id");
  for (const key of ["preclaimValidationSha256", "originalLeaseSha256", "originalLeaseOwnerProcessIdentitySha256",
    "currentTipLeaseSha256", "currentTipLeaseOwnerProcessIdentitySha256"]) sha(input[key], SHA256, key);
  nullableSha(input.previousLineageSha256, "previous_lineage_sha");
  const originalEpoch = positiveInteger(input.originalLeaseEpoch, "original_lease_epoch");
  const currentEpoch = positiveInteger(input.currentTipLeaseEpoch, "current_tip_lease_epoch");
  if (!Array.isArray(input.committedTakeoverReceiptSuffixSha256s)
      || input.committedTakeoverReceiptSuffixSha256s.length > 1) throw new Error("lineage_suffix_invalid");
  input.committedTakeoverReceiptSuffixSha256s.forEach((item) => sha(item, SHA256, "lineage_suffix_sha"));
  const expectedPath = `production-preclaim-lease-lineages/${operationId}/${String(input.currentTipLeaseSha256)}.json`;
  if (input.relativePath !== expectedPath || !SAFE_RELATIVE_PATH.test(expectedPath)) throw new Error("lineage_path_binding_invalid");
  if (currentEpoch !== originalEpoch + input.committedTakeoverReceiptSuffixSha256s.length
      || (input.committedTakeoverReceiptSuffixSha256s.length === 0
        && (input.previousLineageSha256 !== null || input.currentTipLeaseSha256 !== input.originalLeaseSha256
          || input.currentTipLeaseOwnerProcessIdentitySha256 !== input.originalLeaseOwnerProcessIdentitySha256))) {
    throw new Error("lineage_binding_invalid");
  }
  const started = iso(input.lineageStartedAt, "lineage_started_at");
  const resolved = iso(input.resolvedAt, "lineage_resolved_at");
  if (Date.parse(resolved) < Date.parse(started)) throw new Error("lineage_time_invalid");
  return input as ProductionPreclaimLeaseLineageV2;
}

export function validateOperationalAttestationConsumptionV2(value: unknown): OperationalAttestationConsumptionV2 {
  assertNoSecrets(value);
  const input = record(value, "operational_attestation_consumption");
  exactKeys(input, [
    "version", "operationKind", "operationId", "candidateSha", "releaseGenerationId",
    "sourceManifestSha256", "artifactRootFingerprintSha256", "operationalAttestationSha256",
    "operationalAttestationIssuerReceiptSha256", "recoveryFromAbandonedOperationSha256",
    "preclaimValidationSha256", "preclaimLeaseLineageRelativePath", "preclaimLeaseLineageSha256",
    "preclaimLeaseLineageCurrentTipSha256", "commandId", "redactedTemplateSha256",
    "leaseSha256AtConsumption", "leaseEpochAtConsumption", "consumedAt", "expiresAt", "operationDeadlineAt"
  ], "operational_attestation_consumption");
  if (input.version !== "operational-attestation-consumption-v2") throw new Error("operational_attestation_consumption_version_invalid");
  productionIdentityFields(input, "operational_attestation_consumption");
  for (const key of ["operationalAttestationSha256", "operationalAttestationIssuerReceiptSha256",
    "preclaimValidationSha256", "preclaimLeaseLineageSha256", "preclaimLeaseLineageCurrentTipSha256",
    "redactedTemplateSha256", "leaseSha256AtConsumption"]) sha(input[key], SHA256, key);
  nullableSha(input.recoveryFromAbandonedOperationSha256, "recovery_from_abandoned");
  oneOf(input.commandId, PRODUCTION_OPERATION_COMMANDS_V2, "consumption_command");
  operationCommand(input.operationKind, input.commandId, "consumption");
  positiveInteger(input.leaseEpochAtConsumption, "lease_epoch_at_consumption");
  const expectedPath = `production-preclaim-lease-lineages/${String(input.operationId)}/${String(input.preclaimLeaseLineageCurrentTipSha256)}.json`;
  if (input.preclaimLeaseLineageRelativePath !== expectedPath
      || input.leaseSha256AtConsumption !== input.preclaimLeaseLineageCurrentTipSha256) {
    throw new Error("consumption_lineage_path_binding_invalid");
  }
  const consumed = iso(input.consumedAt, "consumed_at");
  const expires = iso(input.expiresAt, "consumption_expires_at");
  const deadline = iso(input.operationDeadlineAt, "consumption_deadline_at");
  if (Date.parse(consumed) >= Date.parse(expires) || Date.parse(consumed) >= Date.parse(deadline)) {
    throw new Error("consumption_time_invalid");
  }
  if ((input.operationKind === "recovery") !== (input.recoveryFromAbandonedOperationSha256 !== null)) {
    throw new Error("consumption_recovery_binding_invalid");
  }
  return input as OperationalAttestationConsumptionV2;
}

export function validateProductionOperationClaimV2(value: unknown): ProductionOperationClaimV2 {
  assertNoSecrets(value);
  const input = record(value, "production_operation_claim");
  exactKeys(input, [
    "version", "operationKind", "operationId", "candidateSha", "releaseGenerationId",
    "sourceManifestSha256", "artifactRootFingerprintSha256", "operationalAttestationSha256",
    "operationalAttestationIssuerReceiptSha256", "recoveryFromAbandonedOperationSha256",
    "authorityConsumption", "authorityConsumptionSha256", "preclaimLeaseLineageRelativePath",
    "preclaimLeaseLineageSha256", "preclaimLeaseLineageCurrentTipSha256", "capability",
    "leaseEpochAtConsumption", "operationDeadlineAt", "claimedAt", "claimantPid",
    "claimantProcessStartFingerprintSha256"
  ], "production_operation_claim");
  if (input.version !== "production-operation-claim-v2") throw new Error("production_operation_claim_version_invalid");
  productionIdentityFields(input, "production_operation_claim");
  const consumption = validateOperationalAttestationConsumptionV2(input.authorityConsumption);
  const consumptionSha = sha(input.authorityConsumptionSha256, SHA256, "authority_consumption_sha");
  if (canonicalObjectSha(consumption) !== consumptionSha) throw new Error("claim_consumption_hash_binding_invalid");
  const boundKeys = ["operationKind", "operationId", "candidateSha", "releaseGenerationId", "sourceManifestSha256",
    "artifactRootFingerprintSha256", "operationalAttestationSha256", "operationalAttestationIssuerReceiptSha256",
    "recoveryFromAbandonedOperationSha256", "preclaimLeaseLineageRelativePath", "preclaimLeaseLineageSha256",
    "preclaimLeaseLineageCurrentTipSha256", "leaseEpochAtConsumption", "operationDeadlineAt"] as const;
  if (boundKeys.some((key) => input[key] !== consumption[key])) throw new Error("claim_consumption_binding_invalid");
  const capability = oneOf(input.capability, ["effect_capable", "recovery_only"] as const, "claim_capability");
  if ((input.operationKind === "recovery") !== (capability === "recovery_only")) throw new Error("claim_capability_binding_invalid");
  iso(input.claimedAt, "claim_claimed_at");
  if (Date.parse(String(input.claimedAt)) < Date.parse(consumption.consumedAt)
      || Date.parse(String(input.claimedAt)) >= Date.parse(consumption.expiresAt)
      || Date.parse(String(input.claimedAt)) >= Date.parse(consumption.operationDeadlineAt)) {
    throw new Error("claim_time_binding_invalid");
  }
  positiveInteger(input.claimantPid, "claimant_pid");
  sha(input.claimantProcessStartFingerprintSha256, SHA256, "claimant_process_start");
  return input as ProductionOperationClaimV2;
}

export function validateProductionOperationLeaseV2(value: unknown): ProductionOperationLeaseV2 {
  assertNoSecrets(value);
  const input = record(value, "production_operation_lease");
  exactKeys(input, [
    "version", "scope", "relativePath", "operationKind", "operationId", "candidateSha",
    "releaseGenerationId", "sourceManifestSha256", "artifactRootFingerprintSha256",
    "operationalAttestationSha256", "recoveryFromAbandonedOperationSha256", "capability",
    "leaseEpoch", "ownerPid", "ownerProcessStartFingerprintSha256", "acquiredAt", "heartbeatAt",
    "expiresAt", "operationDeadlineAt"
  ], "production_operation_lease");
  if (input.version !== "production-operation-lease-v2" || input.scope !== "artifact_root_production_operation"
      || input.relativePath !== "production-operation-root.lease.json") throw new Error("production_operation_lease_literal_invalid");
  productionIdentityFields(input, "production_operation_lease");
  sha(input.operationalAttestationSha256, SHA256, "lease_attestation");
  nullableSha(input.recoveryFromAbandonedOperationSha256, "lease_recovery_from");
  const capability = oneOf(input.capability, PRODUCTION_CAPABILITIES_V2, "lease_capability");
  if ((capability === "recovery_only" && input.operationKind !== "recovery")
      || (capability === "effect_capable" && input.operationKind === "recovery")
      || ((input.operationKind === "recovery") !== (input.recoveryFromAbandonedOperationSha256 !== null))) {
    throw new Error("lease_capability_binding_invalid");
  }
  positiveInteger(input.leaseEpoch, "lease_epoch");
  positiveInteger(input.ownerPid, "lease_owner_pid");
  sha(input.ownerProcessStartFingerprintSha256, SHA256, "lease_owner_process");
  const acquired = iso(input.acquiredAt, "lease_acquired_at");
  const heartbeat = iso(input.heartbeatAt, "lease_heartbeat_at");
  const expires = iso(input.expiresAt, "lease_expires_at");
  iso(input.operationDeadlineAt, "lease_deadline_at");
  if (Date.parse(heartbeat) < Date.parse(acquired) || Date.parse(expires) <= Date.parse(heartbeat)) {
    throw new Error("production_operation_lease_time_invalid");
  }
  return input as ProductionOperationLeaseV2;
}

function validateTakeoverCommon(input: Record<string, unknown>, expectedCapability: ProductionOperationCapabilityV2): ProductionOperationLeaseV2 {
  productionIdentityFields(input, "production_operation_takeover");
  if (input.capability !== expectedCapability) throw new Error("takeover_capability_invalid");
  sha(input.redactedTemplateSha256, SHA256, "takeover_template");
  nullableSha(input.authorityConsumptionSha256, "takeover_consumption");
  sha(input.oldLeaseSha256, SHA256, "takeover_old_lease");
  const oldEpoch = positiveInteger(input.oldLeaseEpoch, "takeover_old_epoch");
  sha(input.oldOwnerProcessIdentitySha256, SHA256, "takeover_old_owner");
  const lease = validateProductionOperationLeaseV2(input.canonicalNewLease);
  canonicalEmbeddedBytesV2(lease, input.canonicalNewLeaseUtf8Base64, input.newLeaseSha256, "takeover_new_lease");
  const newEpoch = positiveInteger(input.newLeaseEpoch, "takeover_new_epoch");
  if (newEpoch !== oldEpoch + 1 || lease.leaseEpoch !== newEpoch || lease.capability !== expectedCapability
      || lease.operationKind !== input.operationKind || lease.operationId !== input.operationId
      || lease.candidateSha !== input.candidateSha || lease.releaseGenerationId !== input.releaseGenerationId
      || lease.sourceManifestSha256 !== input.sourceManifestSha256
      || lease.artifactRootFingerprintSha256 !== input.artifactRootFingerprintSha256
      || lease.operationDeadlineAt !== input.operationDeadlineAt) throw new Error("takeover_lease_binding_invalid");
  iso(input.operationDeadlineAt, "takeover_deadline");
  iso(input.preparedAt, "takeover_prepared_at");
  return lease;
}

export function validatePreparedProductionOperationLeaseTakeoverV2(
  value: unknown
): PreparedProductionOperationLeaseTakeoverV2 {
  assertNoSecrets(value);
  const input = record(value, "prepared_production_operation_lease_takeover");
  exactKeys(input, [
    "version", "commandId", "redactedTemplateSha256", "capability", "operationKind", "operationId",
    "candidateSha", "releaseGenerationId", "sourceManifestSha256", "artifactRootFingerprintSha256",
    "authorityConsumptionSha256", "oldLeaseSha256", "oldLeaseEpoch", "oldOwnerProcessIdentitySha256",
    "canonicalNewLease", "canonicalNewLeaseUtf8Base64", "newLeaseSha256", "newLeaseEpoch",
    "operationDeadlineAt", "preparedAt"
  ], "prepared_production_operation_lease_takeover");
  if (input.version !== "prepared-production-operation-lease-takeover-v2"
      || input.commandId !== "production_operation_lease_takeover") throw new Error("prepared_takeover_literal_invalid");
  oneOf(input.capability, ["effect_capable", "recovery_only"] as const, "prepared_takeover_capability");
  validateTakeoverCommon(input, input.capability as "effect_capable" | "recovery_only");
  return input as PreparedProductionOperationLeaseTakeoverV2;
}

export function validateCommittedProductionOperationLeaseTakeoverV2(
  value: unknown,
  preparedValue?: unknown
): CommittedProductionOperationLeaseTakeoverV2 {
  assertNoSecrets(value);
  const input = record(value, "committed_production_operation_lease_takeover");
  exactKeys(input, [
    "version", "commandId", "redactedTemplateSha256", "capability", "operationKind", "operationId",
    "candidateSha", "releaseGenerationId", "sourceManifestSha256", "artifactRootFingerprintSha256",
    "authorityConsumptionSha256", "preparedTakeoverSha256", "oldLeaseSha256", "tombstoneRelativePath",
    "newLeaseSha256", "newLeaseEpoch", "operationDeadlineAt", "committedAt"
  ], "committed_production_operation_lease_takeover");
  if (input.version !== "committed-production-operation-lease-takeover-v2"
      || input.commandId !== "production_operation_lease_takeover") throw new Error("committed_takeover_literal_invalid");
  productionIdentityFields(input, "committed_takeover");
  oneOf(input.capability, ["effect_capable", "recovery_only"] as const, "committed_takeover_capability");
  for (const key of ["redactedTemplateSha256", "preparedTakeoverSha256", "oldLeaseSha256", "newLeaseSha256"]) sha(input[key], SHA256, key);
  nullableSha(input.authorityConsumptionSha256, "committed_takeover_consumption");
  positiveInteger(input.newLeaseEpoch, "committed_takeover_epoch");
  if (input.tombstoneRelativePath !== `production-operation-root.lease-tombstone-${String(input.oldLeaseSha256)}.json`) {
    throw new Error("committed_takeover_tombstone_binding_invalid");
  }
  iso(input.operationDeadlineAt, "committed_takeover_deadline");
  iso(input.committedAt, "committed_takeover_at");
  if (preparedValue !== undefined) {
    const prepared = validatePreparedProductionOperationLeaseTakeoverV2(preparedValue);
    if (canonicalObjectSha(prepared) !== input.preparedTakeoverSha256) throw new Error("committed_takeover_prepared_hash_binding_invalid");
    const pairs: Array<[unknown, unknown]> = [
      [input.operationKind, prepared.operationKind], [input.operationId, prepared.operationId],
      [input.candidateSha, prepared.candidateSha], [input.releaseGenerationId, prepared.releaseGenerationId],
      [input.sourceManifestSha256, prepared.sourceManifestSha256], [input.artifactRootFingerprintSha256, prepared.artifactRootFingerprintSha256],
      [input.authorityConsumptionSha256, prepared.authorityConsumptionSha256], [input.capability, prepared.capability],
      [input.oldLeaseSha256, prepared.oldLeaseSha256], [input.newLeaseSha256, prepared.newLeaseSha256],
      [input.newLeaseEpoch, prepared.newLeaseEpoch], [input.operationDeadlineAt, prepared.operationDeadlineAt]
    ];
    if (pairs.some(([actual, expected]) => actual !== expected)) throw new Error("committed_takeover_binding_invalid");
  }
  return input as CommittedProductionOperationLeaseTakeoverV2;
}

export function validatePreparedCleanupOnlyProductionOperationTakeoverV2(
  value: unknown
): PreparedCleanupOnlyProductionOperationTakeoverV2 {
  assertNoSecrets(value);
  const input = record(value, "prepared_cleanup_only_production_operation_takeover");
  exactKeys(input, [
    "version", "commandId", "redactedTemplateSha256", "capability", "operationKind", "operationId",
    "candidateSha", "releaseGenerationId", "sourceManifestSha256", "artifactRootFingerprintSha256",
    "authorityConsumptionSha256", "terminalReason", "oldLeaseSha256", "oldLeaseEpoch",
    "oldOwnerProcessIdentitySha256", "canonicalNewLease", "canonicalNewLeaseUtf8Base64", "newLeaseSha256",
    "newLeaseEpoch", "operationDeadlineAt", "preparedAt"
  ], "prepared_cleanup_only_production_operation_takeover");
  if (input.version !== "prepared-cleanup-only-production-operation-takeover-v2"
      || input.commandId !== "production_operation_cleanup_only_takeover" || input.capability !== "cleanup_only") {
    throw new Error("prepared_cleanup_only_takeover_literal_invalid");
  }
  oneOf(input.terminalReason, ["authority_expired_before_claim", "authority_expired_after_claim", "operation_deadline_reached"] as const, "cleanup_takeover_reason");
  validateTakeoverCommon(input, "cleanup_only");
  return input as PreparedCleanupOnlyProductionOperationTakeoverV2;
}

export function validateCleanupOnlyProductionOperationTakeoverV2(
  value: unknown,
  preparedValue?: unknown
): CleanupOnlyProductionOperationTakeoverV2 {
  assertNoSecrets(value);
  const input = record(value, "cleanup_only_production_operation_takeover");
  exactKeys(input, [
    "version", "commandId", "redactedTemplateSha256", "capability", "operationKind", "operationId",
    "candidateSha", "releaseGenerationId", "sourceManifestSha256", "artifactRootFingerprintSha256",
    "authorityConsumptionSha256", "terminalReason", "preparedTakeoverSha256", "oldLeaseSha256",
    "tombstoneRelativePath", "newLeaseSha256", "newLeaseEpoch", "operationDeadlineAt", "committedAt"
  ], "cleanup_only_production_operation_takeover");
  if (input.version !== "cleanup-only-production-operation-takeover-v2"
      || input.commandId !== "production_operation_cleanup_only_takeover" || input.capability !== "cleanup_only") {
    throw new Error("cleanup_only_takeover_literal_invalid");
  }
  productionIdentityFields(input, "cleanup_only_takeover");
  oneOf(input.terminalReason, ["authority_expired_before_claim", "authority_expired_after_claim", "operation_deadline_reached"] as const, "cleanup_takeover_reason");
  for (const key of ["redactedTemplateSha256", "preparedTakeoverSha256", "oldLeaseSha256", "newLeaseSha256"]) sha(input[key], SHA256, key);
  nullableSha(input.authorityConsumptionSha256, "cleanup_takeover_consumption");
  positiveInteger(input.newLeaseEpoch, "cleanup_takeover_epoch");
  if (input.tombstoneRelativePath !== `production-operation-root.lease-tombstone-${String(input.oldLeaseSha256)}.json`) {
    throw new Error("cleanup_takeover_tombstone_binding_invalid");
  }
  iso(input.operationDeadlineAt, "cleanup_takeover_deadline");
  iso(input.committedAt, "cleanup_takeover_committed_at");
  if (preparedValue !== undefined) {
    const prepared = validatePreparedCleanupOnlyProductionOperationTakeoverV2(preparedValue);
    if (canonicalObjectSha(prepared) !== input.preparedTakeoverSha256
        || input.operationId !== prepared.operationId || input.newLeaseSha256 !== prepared.newLeaseSha256
        || input.newLeaseEpoch !== prepared.newLeaseEpoch || input.terminalReason !== prepared.terminalReason) {
      throw new Error("cleanup_takeover_prepared_binding_invalid");
    }
  }
  return input as CleanupOnlyProductionOperationTakeoverV2;
}

export function validateProductionOperationSettlementV2(value: unknown): ProductionOperationSettlementV2 {
  assertNoSecrets(value);
  const input = record(value, "production_operation_settlement");
  const common = ["version", "operationKind", "operationId", "candidateSha", "releaseGenerationId",
    "sourceManifestSha256", "claimSha256", "authorityConsumptionSha256", "finalLeaseSha256",
    "finalLeaseEpoch", "operationDeadlineAt", "terminalEvidenceSha256", "authorityRevalidatedAt",
    "deadlineRevalidatedAt", "settledAt", "capability", "result", "orchestrationReceiptSha256"];
  const recovery = input.capability === "recovery_only";
  exactKeys(input, recovery ? [...common, "recoveryAttemptedExternalEffect", "priorAttemptedExternalEffect"]
    : [...common, "attemptedExternalEffect"], "production_operation_settlement");
  if (input.version !== "production-operation-settlement-v2") throw new Error("production_settlement_version_invalid");
  oneOf(input.operationKind, PRODUCTION_OPERATION_KINDS_V2, "settlement_kind");
  nonEmpty(input.operationId, "settlement_operation_id");
  sha(input.candidateSha, SHA40, "settlement_candidate");
  nonEmpty(input.releaseGenerationId, "settlement_generation");
  for (const key of ["sourceManifestSha256", "claimSha256", "authorityConsumptionSha256", "finalLeaseSha256",
    "terminalEvidenceSha256"]) sha(input[key], SHA256, key);
  positiveInteger(input.finalLeaseEpoch, "settlement_lease_epoch");
  const deadline = iso(input.operationDeadlineAt, "settlement_deadline");
  const settledAt = iso(input.settledAt, "settlement_at");
  iso(input.authorityRevalidatedAt, "authority_revalidated_at");
  iso(input.deadlineRevalidatedAt, "deadline_revalidated_at");
  if (Date.parse(settledAt) >= Date.parse(deadline)) throw new Error("settlement_deadline_binding_invalid");
  if (recovery) {
    if (input.operationKind !== "recovery" || input.result !== "failed" || input.recoveryAttemptedExternalEffect !== false) {
      throw new Error("recovery_settlement_literal_invalid");
    }
    sha(input.orchestrationReceiptSha256, SHA256, "recovery_orchestration_receipt");
    booleanValue(input.priorAttemptedExternalEffect, "prior_attempted_external_effect");
  } else {
    if (input.capability !== "effect_capable" || (input.result !== "passed" && input.result !== "failed")) {
      throw new Error("effect_settlement_literal_invalid");
    }
    if (input.orchestrationReceiptSha256 !== null) sha(input.orchestrationReceiptSha256, SHA256, "orchestration_receipt");
    if (input.result === "passed" && input.orchestrationReceiptSha256 === null) throw new Error("settlement_receipt_required");
    booleanValue(input.attemptedExternalEffect, "attempted_external_effect");
  }
  return input as ProductionOperationSettlementV2;
}

export function validateProductionOperationLeaseRemovalReceiptV2(
  value: unknown
): ProductionOperationLeaseRemovalReceiptV2 {
  assertNoSecrets(value);
  const input = record(value, "production_operation_lease_removal_receipt");
  exactKeys(input, ["version", "operationKind", "operationId", "terminalStateKind", "terminalStateSha256",
    "capability", "removedLeaseSha256", "removedLeaseEpoch", "removedAt"], "production_operation_lease_removal_receipt");
  if (input.version !== "production-operation-lease-removal-receipt-v2") throw new Error("lease_removal_receipt_version_invalid");
  oneOf(input.operationKind, PRODUCTION_OPERATION_KINDS_V2, "lease_removal_kind");
  nonEmpty(input.operationId, "lease_removal_operation_id");
  oneOf(input.terminalStateKind, ["settlement", "terminal_abandoned"] as const, "lease_removal_terminal_kind");
  sha(input.terminalStateSha256, SHA256, "lease_removal_terminal_sha");
  oneOf(input.capability, PRODUCTION_CAPABILITIES_V2, "lease_removal_capability");
  sha(input.removedLeaseSha256, SHA256, "removed_lease_sha");
  positiveInteger(input.removedLeaseEpoch, "removed_lease_epoch");
  iso(input.removedAt, "lease_removed_at");
  return input as ProductionOperationLeaseRemovalReceiptV2;
}

export function validatePreparedProductionOperationLeaseRemovalV2(
  value: unknown
): PreparedProductionOperationLeaseRemovalV2 {
  assertNoSecrets(value);
  const input = record(value, "prepared_production_operation_lease_removal");
  exactKeys(input, ["version", "operationKind", "operationId", "terminalStateKind", "terminalStateSha256",
    "capability", "exactCurrentLeaseSha256", "exactCurrentLeaseEpoch", "canonicalRemovalReceipt",
    "canonicalRemovalReceiptUtf8Base64", "canonicalRemovalReceiptSha256", "preparedAt"],
  "prepared_production_operation_lease_removal");
  if (input.version !== "prepared-production-operation-lease-removal-v2") throw new Error("prepared_lease_removal_version_invalid");
  oneOf(input.operationKind, PRODUCTION_OPERATION_KINDS_V2, "prepared_removal_kind");
  nonEmpty(input.operationId, "prepared_removal_operation_id");
  oneOf(input.terminalStateKind, ["settlement", "terminal_abandoned"] as const, "prepared_removal_terminal_kind");
  sha(input.terminalStateSha256, SHA256, "prepared_removal_terminal_sha");
  oneOf(input.capability, PRODUCTION_CAPABILITIES_V2, "prepared_removal_capability");
  sha(input.exactCurrentLeaseSha256, SHA256, "prepared_removal_lease_sha");
  positiveInteger(input.exactCurrentLeaseEpoch, "prepared_removal_lease_epoch");
  const receipt = validateProductionOperationLeaseRemovalReceiptV2(input.canonicalRemovalReceipt);
  canonicalEmbeddedBytesV2(receipt, input.canonicalRemovalReceiptUtf8Base64,
    input.canonicalRemovalReceiptSha256, "prepared_removal_receipt");
  if (input.operationKind !== receipt.operationKind || input.operationId !== receipt.operationId
      || input.terminalStateKind !== receipt.terminalStateKind || input.terminalStateSha256 !== receipt.terminalStateSha256
      || input.capability !== receipt.capability || input.exactCurrentLeaseSha256 !== receipt.removedLeaseSha256
      || input.exactCurrentLeaseEpoch !== receipt.removedLeaseEpoch || input.preparedAt !== receipt.removedAt) {
    throw new Error("prepared_removal_binding_invalid");
  }
  iso(input.preparedAt, "prepared_removal_at");
  return input as PreparedProductionOperationLeaseRemovalV2;
}

export function validateProductionOperationTerminalCleanupV2(value: unknown): ProductionOperationTerminalCleanupV2 {
  assertNoSecrets(value);
  const input = record(value, "production_operation_terminal_cleanup");
  exactKeys(input, ["version", "operationKind", "operationId", "terminalStateSha256", "capability",
    "preparedRemovalSha256", "leaseRemovalReceiptSha256", "removedLeaseSha256", "cleanedAt"],
  "production_operation_terminal_cleanup");
  if (input.version !== "production-operation-terminal-cleanup-v2") throw new Error("terminal_cleanup_version_invalid");
  oneOf(input.operationKind, PRODUCTION_OPERATION_KINDS_V2, "terminal_cleanup_kind");
  nonEmpty(input.operationId, "terminal_cleanup_operation_id");
  oneOf(input.capability, PRODUCTION_CAPABILITIES_V2, "terminal_cleanup_capability");
  for (const key of ["terminalStateSha256", "preparedRemovalSha256", "leaseRemovalReceiptSha256", "removedLeaseSha256"]) sha(input[key], SHA256, key);
  iso(input.cleanedAt, "terminal_cleanup_at");
  return input as ProductionOperationTerminalCleanupV2;
}

export function validateProductionOperationTerminalAbandonedV2(value: unknown): ProductionOperationTerminalAbandonedV2 {
  assertNoSecrets(value);
  const input = record(value, "production_operation_terminal_abandoned");
  exactKeys(input, ["version", "operationKind", "operationId", "candidateSha", "releaseGenerationId",
    "sourceManifestSha256", "claimSha256", "authorityConsumptionSha256", "capability",
    "cleanupOnlyTakeoverSha256", "finalLeaseSha256", "finalLeaseEpoch", "completedStepReceiptSetSha256",
    "attemptedExternalEffect", "reason", "abandonedAt"], "production_operation_terminal_abandoned");
  if (input.version !== "production-operation-terminal-abandoned-v2") throw new Error("terminal_abandoned_version_invalid");
  oneOf(input.operationKind, PRODUCTION_OPERATION_KINDS_V2, "terminal_abandoned_kind");
  nonEmpty(input.operationId, "terminal_abandoned_operation_id");
  sha(input.candidateSha, SHA40, "terminal_abandoned_candidate");
  nonEmpty(input.releaseGenerationId, "terminal_abandoned_generation");
  sha(input.sourceManifestSha256, SHA256, "terminal_abandoned_source");
  nullableSha(input.claimSha256, "terminal_abandoned_claim");
  nullableSha(input.authorityConsumptionSha256, "terminal_abandoned_consumption");
  oneOf(input.capability, PRODUCTION_CAPABILITIES_V2, "terminal_abandoned_capability");
  nullableSha(input.cleanupOnlyTakeoverSha256, "terminal_abandoned_cleanup_takeover");
  sha(input.finalLeaseSha256, SHA256, "terminal_abandoned_lease");
  positiveInteger(input.finalLeaseEpoch, "terminal_abandoned_epoch");
  sha(input.completedStepReceiptSetSha256, SHA256, "terminal_abandoned_step_set");
  booleanValue(input.attemptedExternalEffect, "terminal_abandoned_attempted_effect");
  oneOf(input.reason, ["authority_expired_before_claim", "authority_expired_after_claim", "operation_deadline_reached", "ownership_protocol_failure"] as const, "terminal_abandoned_reason");
  iso(input.abandonedAt, "terminal_abandoned_at");
  return input as ProductionOperationTerminalAbandonedV2;
}

export function validateSchema032ReleaseEvidenceV1(value: unknown): Schema032ReleaseEvidenceV1 {
  assertNoSecrets(value);
  const input = record(value, "schema032_release_evidence");
  exactKeys(input, ["candidateSha", "databaseRole", "databaseFingerprintSha256", "migrationFilename",
    "candidateBytesChecksumSha256", "receiptChecksumSha256", "shortChecksum", "postconditionsSha256",
    "schema033", "firstApply", "secondApply"], "schema032_release_evidence");
  sha(input.candidateSha, SHA40, "schema032_candidate");
  oneOf(input.databaseRole, ["clean", "production_clone", "runtime_sanitized", "production"] as const, "schema032_database_role");
  sha(input.databaseFingerprintSha256, SHA256, "schema032_database_fingerprint");
  if (input.migrationFilename !== "032_telegram_runtime_forensics_data_contracts.sql"
      || input.candidateBytesChecksumSha256 !== SCHEMA032_CHECKSUM_V2
      || input.receiptChecksumSha256 !== SCHEMA032_CHECKSUM_V2
      || input.shortChecksum !== SCHEMA032_CHECKSUM_V2.slice(0, 12)) throw new Error("schema032_checksum_binding_invalid");
  sha(input.postconditionsSha256, SHA256, "schema032_postconditions");
  const schema033 = record(input.schema033, "schema033_release_evidence");
  exactKeys(schema033, [
    "version", "migrationFilename", "checksumSha256", "catalogSha256", "verificationReceiptSha256"
  ], "schema033_release_evidence");
  if (schema033.version !== 33 || schema033.migrationFilename !== "033_unified_wallet_check.sql"
      || schema033.checksumSha256 !== SCHEMA033_CHECKSUM_V2
      || schema033.catalogSha256 !== SCHEMA033_CATALOG_SHA256_V2) {
    throw new Error("schema033_release_evidence_invalid");
  }
  sha(schema033.verificationReceiptSha256, SHA256, "schema033_verification_receipt");
  oneOf(input.firstApply, ["applied", "already_verified"] as const, "schema032_first_apply");
  if (input.secondApply !== "already_verified") throw new Error("schema032_second_apply_invalid");
  return input as Schema032ReleaseEvidenceV1;
}

const SCHEMA032_FAILURE_PATHS_V2: Record<Schema032Stage, string> = {
  first_migration: "schema032-failures/first-migration-failure-v2.json",
  first_verification: "schema032-failures/first-verification-failure-v2.json",
  second_migration: "schema032-failures/second-migration-failure-v2.json",
  final_verification: "schema032-failures/final-verification-failure-v2.json"
};

function validateSchemaStages(value: unknown, expected: readonly Schema032Stage[], label: string): Schema032CompletedStageV2[] {
  if (!Array.isArray(value) || value.length !== expected.length) throw new Error(`${label}_stage_order_invalid`);
  return value.map((item, index) => {
    const stage = record(item, `${label}_stage`);
    exactKeys(stage, ["step", "receiptSha256"], `${label}_stage`);
    if (stage.step !== expected[index]) throw new Error(`${label}_stage_order_invalid`);
    sha(stage.receiptSha256, SHA256, `${label}_stage_receipt`);
    return stage as Schema032CompletedStageV2;
  });
}

function validateSchema032ProductionExecutionReceiptFieldsV2(
  value: unknown,
  requirePreparedSettlement: boolean
): Record<string, unknown> {
  assertNoSecrets(value);
  const input = record(value, "schema032_production_execution_receipt");
  const common = ["version", "candidateSha", "releaseFreezeIdentitySha256", "operationalAttestationSha256",
    ...(Object.hasOwn(input, "operationalAttestationIssuerReceiptSha256")
      ? ["operationalAttestationIssuerReceiptSha256"] : []),
    "authorityConsumptionSha256", "sourceManifestSha256", "g12TransitionReceiptSha256",
    "productionBackupEvidenceSha256", "executionAttemptRelativePath", "executionAttemptSha256",
    "advisoryLockKey", "databaseSessionIdentitySha256",
    "lockAcquiredAt", "lockReleasedAt",
    ...(requirePreparedSettlement ? ["preparedSettlementRelativePath", "preparedSettlementSha256"] : []),
    "migrationBytesChecksumSha256", "migration033BytesChecksumSha256", "result", "completedStages"];
  exactKeys(input, input.result === "applied_and_verified"
    ? [...common, "receiptChecksumSha256", "postconditionsSha256", "schema033"]
    : [...common, "failedStep", "failureArtifact"], "schema032_production_execution_receipt");
  if (input.version !== "schema-032-production-execution-receipt-v2" || input.advisoryLockKey !== 320032500
      || input.migrationBytesChecksumSha256 !== SCHEMA032_CHECKSUM_V2
      || input.migration033BytesChecksumSha256 !== SCHEMA033_CHECKSUM_V2) {
    throw new Error("schema032_production_receipt_literal_invalid");
  }
  sha(input.candidateSha, SHA40, "schema032_production_candidate");
  for (const key of ["releaseFreezeIdentitySha256", "operationalAttestationSha256", "authorityConsumptionSha256",
    ...(Object.hasOwn(input, "operationalAttestationIssuerReceiptSha256")
      ? ["operationalAttestationIssuerReceiptSha256"] : []),
    "sourceManifestSha256", "g12TransitionReceiptSha256", "productionBackupEvidenceSha256",
    "executionAttemptSha256",
    "databaseSessionIdentitySha256",
    ...(requirePreparedSettlement ? ["preparedSettlementSha256"] : [])]) sha(input[key], SHA256, key);
  if (requirePreparedSettlement && (typeof input.preparedSettlementRelativePath !== "string"
      || !/^schema032-production-settlement-prepared-[0-9a-f]{64}\.json$/u.test(input.preparedSettlementRelativePath)
      || input.preparedSettlementRelativePath
        !== `schema032-production-settlement-prepared-${String(input.preparedSettlementSha256)}.json`)) {
    throw new Error("schema032_prepared_settlement_ref_invalid");
  }
  if (typeof input.executionAttemptRelativePath !== "string"
      || !/^schema032-production-attempt-[a-z0-9][a-z0-9-]{15,63}-[0-9a-f]{64}\.json$/u
        .test(input.executionAttemptRelativePath)
      || !input.executionAttemptRelativePath.endsWith(`-${String(input.executionAttemptSha256)}.json`)) {
    throw new Error("schema032_execution_attempt_ref_invalid");
  }
  const acquired = iso(input.lockAcquiredAt, "schema032_lock_acquired");
  const released = iso(input.lockReleasedAt, "schema032_lock_released");
  if (Date.parse(released) < Date.parse(acquired)) throw new Error("schema032_lock_order_invalid");
  if (input.result === "applied_and_verified") {
    validateSchemaStages(input.completedStages, SCHEMA032_STAGES_V2, "schema032_success");
    if (input.receiptChecksumSha256 !== SCHEMA032_CHECKSUM_V2) throw new Error("schema032_receipt_checksum_invalid");
    sha(input.postconditionsSha256, SHA256, "schema032_postconditions");
    const schema033 = record(input.schema033, "schema033_production_receipt_invalid");
    exactKeys(schema033, [
      "version", "migrationFilename", "checksumSha256", "catalogSha256", "verificationReceiptSha256"
    ], "schema033_production_receipt_invalid");
    if (schema033.version !== 33 || schema033.migrationFilename !== "033_unified_wallet_check.sql"
        || schema033.checksumSha256 !== SCHEMA033_CHECKSUM_V2
        || schema033.catalogSha256 !== SCHEMA033_CATALOG_SHA256_V2) {
      throw new Error("schema033_production_receipt_invalid");
    }
    sha(schema033.verificationReceiptSha256, SHA256, "schema033_production_receipt_invalid");
  } else if (input.result === "failed_after_attempt") {
    const failedStep = oneOf(input.failedStep, SCHEMA032_STAGES_V2, "schema032_failed_step");
    validateSchemaStages(input.completedStages, SCHEMA032_STAGES_V2.slice(0, SCHEMA032_STAGES_V2.indexOf(failedStep)), "schema032_failure");
    const artifact = record(input.failureArtifact, "schema032_failure_artifact");
    exactKeys(artifact, ["kind", "failedStep", "relativePath", "evidenceSha256"], "schema032_failure_artifact");
    if (artifact.kind !== "schema032_stage_failure" || artifact.failedStep !== failedStep
        || artifact.relativePath !== SCHEMA032_FAILURE_PATHS_V2[failedStep]) throw new Error("schema032_failure_artifact_binding_invalid");
    sha(artifact.evidenceSha256, SHA256, "schema032_failure_evidence");
  } else throw new Error("schema032_production_result_invalid");
  return input;
}

export function validatePreparedSchema032ProductionSettlementV2(
  value: unknown
): PreparedSchema032ProductionSettlementV2 {
  assertNoSecrets(value);
  const prepared = record(value, "schema032_prepared_settlement");
  exactKeys(prepared, ["version", "preparedAt", "executionReceiptCore"], "schema032_prepared_settlement");
  if (prepared.version !== "prepared-schema-032-production-settlement-v2") {
    throw new Error("schema032_prepared_settlement_literal_invalid");
  }
  const preparedAt = iso(prepared.preparedAt, "schema032_prepared_at");
  const core = record(prepared.executionReceiptCore, "schema032_prepared_settlement_core");
  validateSchema032ProductionExecutionReceiptFieldsV2({ ...core, lockReleasedAt: preparedAt }, false);
  if (Date.parse(preparedAt) < Date.parse(String(core.lockAcquiredAt))) {
    throw new Error("schema032_prepared_settlement_order_invalid");
  }
  return prepared as PreparedSchema032ProductionSettlementV2;
}

export function validateSchema032ProductionExecutionAttemptV2(
  value: unknown
): Schema032ProductionExecutionAttemptV2 {
  assertNoSecrets(value);
  const attempt = record(value, "schema032_production_execution_attempt");
  exactKeys(attempt, ["version", "generationId", "candidateSha", "authorityConsumptionSha256",
    "attemptOrdinal", "previousAttemptSha256", "advisoryLockKey", "databaseSessionIdentitySha256",
    "lockAcquiredAt"], "schema032_production_execution_attempt");
  if (attempt.version !== "schema-032-production-execution-attempt-v2"
      || typeof attempt.generationId !== "string"
      || !/^[a-z0-9][a-z0-9-]{15,63}$/u.test(attempt.generationId)
      || !Number.isSafeInteger(attempt.attemptOrdinal) || Number(attempt.attemptOrdinal) < 1
      || attempt.advisoryLockKey !== 320032500) {
    throw new Error("schema032_production_execution_attempt_literal_invalid");
  }
  sha(attempt.candidateSha, SHA40, "schema032_attempt_candidate");
  sha(attempt.authorityConsumptionSha256, SHA256, "schema032_attempt_consumption");
  sha(attempt.databaseSessionIdentitySha256, SHA256, "schema032_attempt_session");
  if (attempt.previousAttemptSha256 !== null) {
    sha(attempt.previousAttemptSha256, SHA256, "schema032_attempt_previous");
  }
  iso(attempt.lockAcquiredAt, "schema032_attempt_lock_acquired");
  return attempt as Schema032ProductionExecutionAttemptV2;
}

export function validateSchema032ProductionExecutionReceiptV2(
  value: unknown
): Schema032ProductionExecutionReceiptV2 {
  return validateSchema032ProductionExecutionReceiptFieldsV2(value, true) as Schema032ProductionExecutionReceiptV2;
}

const ROLLOUT_STEPS_V2 = ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
  "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
  "prove_candidate_started", "immediate_runtime_checks"] as const;
const CANARY_STEPS_V2 = ["verify_g14", "observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks"] as const;
const ROLLBACK_STEPS_V2 = ["verify_failure", "prove_previous_healthy", "prove_no_previous_stop",
  "prove_no_candidate_start", "prove_no_candidate_running", "restart_previous", "stop_candidate",
  "start_previous", "rollback_runtime_checks"] as const;
const RECOVERY_STEPS_V2 = ["verify_abandoned_cleanup", "verify_completed_prefix", "verify_uncertain_step_intent",
  "validate_failure_derivation_inputs"] as const;
const EXTERNAL_EFFECT_STEPS_V2 = ["stop_previous", "start_candidate", "restart_previous", "stop_candidate", "start_previous"] as const;

function orchestrationCommand(orchestration: unknown, commandId: unknown, label: string): void {
  const expected = { rollout: "production_rollout", canary: "production_canary",
    rollback: "production_rollback", recovery: "production_recovery" } as const;
  const key = oneOf(orchestration, ["rollout", "canary", "rollback", "recovery"] as const, `${label}_orchestration`);
  if (expected[key] !== commandId) throw new Error(`${label}_command_binding_invalid`);
}

function validateOrchestrationStep(orchestration: unknown, stepId: unknown, label: string): void {
  if (orchestration === "rollout") oneOf(stepId, ROLLOUT_STEPS_V2, label);
  else if (orchestration === "canary") oneOf(stepId, CANARY_STEPS_V2, label);
  else if (orchestration === "rollback") oneOf(stepId, ROLLBACK_STEPS_V2, label);
  else if (orchestration === "recovery") oneOf(stepId, RECOVERY_STEPS_V2, label);
  else throw new Error(`${label}_orchestration_invalid`);
}

export function validateProductionOrchestrationStepIntentV2(
  value: unknown
): ProductionOrchestrationStepIntentV2 {
  assertNoSecrets(value);
  const input = record(value, "production_orchestration_step_intent");
  exactKeys(input, ["version", "capability", "orchestration", "operationId", "operationClaimSha256",
    "authorityConsumptionSha256", "sequence", "stepId", "attempt", "relativePath",
    "currentOperationLeaseSha256", "currentOperationLeaseEpoch", "commandId", "redactedTemplateSha256",
    "inputSha256", "intendedExternalEffectSha256", "preparedAt"], "production_orchestration_step_intent");
  if (input.version !== "production-orchestration-step-intent-v2" || input.capability !== "effect_capable"
      || input.attempt !== 1) throw new Error("production_step_intent_literal_invalid");
  const orchestration = oneOf(input.orchestration, ["rollout", "canary", "rollback"] as const, "step_intent_orchestration");
  const operationId = nonEmpty(input.operationId, "step_intent_operation_id");
  for (const key of ["operationClaimSha256", "authorityConsumptionSha256", "currentOperationLeaseSha256",
    "redactedTemplateSha256", "inputSha256", "intendedExternalEffectSha256"]) sha(input[key], SHA256, key);
  const sequence = positiveInteger(input.sequence, "step_intent_sequence");
  const stepId = oneOf(input.stepId, EXTERNAL_EFFECT_STEPS_V2, "step_intent_step");
  validateOrchestrationStep(orchestration, stepId, "step_intent_step");
  positiveInteger(input.currentOperationLeaseEpoch, "step_intent_lease_epoch");
  orchestrationCommand(orchestration, input.commandId, "step_intent");
  const expectedPath = `production-operation-step-intents/${operationId}/${sequence}-${stepId}-1-v2.json`;
  if (input.relativePath !== expectedPath || !SAFE_RELATIVE_PATH.test(expectedPath)) throw new Error("step_intent_path_binding_invalid");
  iso(input.preparedAt, "step_intent_prepared_at");
  return input as ProductionOrchestrationStepIntentV2;
}

export function validateProductionOrchestrationStepReceiptV2(
  value: unknown
): ProductionOrchestrationStepReceiptV2 {
  assertNoSecrets(value);
  const input = record(value, "production_orchestration_step_receipt");
  exactKeys(input, ["version", "operationId", "operationClaimSha256", "authorityConsumptionSha256",
    "operationLeaseSha256", "operationLeaseEpoch", "operationDeadlineAt", "inputSha256", "outputSha256",
    "observedStateSha256", "sequence", "startedAt", "finishedAt", "recoveredAfterCrash", "verifiedChecks", "result",
    "capability", "commandId", "redactedTemplateSha256", "executionKind", "stepIntentRelativePath",
    "stepIntentSha256", "orchestration", "stepId"], "production_orchestration_step_receipt");
  if (input.version !== "production-orchestration-step-receipt-v2" || input.result !== "completed") {
    throw new Error("production_step_receipt_literal_invalid");
  }
  nonEmpty(input.operationId, "step_receipt_operation_id");
  for (const key of ["operationClaimSha256", "authorityConsumptionSha256", "operationLeaseSha256", "inputSha256",
    "outputSha256", "observedStateSha256", "redactedTemplateSha256"]) sha(input[key], SHA256, key);
  positiveInteger(input.operationLeaseEpoch, "step_receipt_lease_epoch");
  positiveInteger(input.sequence, "step_receipt_sequence");
  iso(input.operationDeadlineAt, "step_receipt_deadline");
  const started = iso(input.startedAt, "step_receipt_started");
  const finished = iso(input.finishedAt, "step_receipt_finished");
  if (Date.parse(finished) < Date.parse(started)
      || Date.parse(finished) >= Date.parse(String(input.operationDeadlineAt))) throw new Error("step_receipt_time_invalid");
  if (input.verifiedChecks !== null) {
    if (!Array.isArray(input.verifiedChecks) || input.verifiedChecks.length === 0
        || input.verifiedChecks.some((check) => typeof check !== "string" || !/^[a-z][a-z0-9_]*$/u.test(check))
        || new Set(input.verifiedChecks).size !== input.verifiedChecks.length) {
      throw new Error("step_receipt_verified_checks_invalid");
    }
  }
  const capability = oneOf(input.capability, ["effect_capable", "recovery_only"] as const, "step_receipt_capability");
  validateOrchestrationStep(input.orchestration, input.stepId, "step_receipt_step");
  orchestrationCommand(input.orchestration, input.commandId, "step_receipt");
  if (capability === "recovery_only") {
    if (input.orchestration !== "recovery" || input.commandId !== "production_recovery"
        || input.executionKind !== "local_validation" || input.stepIntentRelativePath !== null
        || input.stepIntentSha256 !== null || input.recoveredAfterCrash !== false) {
      throw new Error("recovery_step_receipt_binding_invalid");
    }
  } else {
    if (input.orchestration === "recovery") throw new Error("effect_step_receipt_binding_invalid");
    booleanValue(input.recoveredAfterCrash, "step_receipt_recovered_after_crash");
    if (input.executionKind === "external_effect") {
      oneOf(input.stepId, EXTERNAL_EFFECT_STEPS_V2, "external_effect_step");
      const expectedIntentPath = `production-operation-step-intents/${String(input.operationId)}/${String(input.sequence)}-${String(input.stepId)}-1-v2.json`;
      if (input.stepIntentRelativePath !== expectedIntentPath
          || !SAFE_RELATIVE_PATH.test(expectedIntentPath)) {
        throw new Error("step_receipt_intent_path_invalid");
      }
      sha(input.stepIntentSha256, SHA256, "step_receipt_intent_sha");
    } else if (input.executionKind === "local_validation") {
      if (input.stepIntentRelativePath !== null || input.stepIntentSha256 !== null
          || (EXTERNAL_EFFECT_STEPS_V2 as readonly string[]).includes(String(input.stepId))) {
        throw new Error("step_receipt_local_binding_invalid");
      }
    } else throw new Error("step_receipt_execution_kind_invalid");
  }
  return input as ProductionOrchestrationStepReceiptV2;
}

export function validateProductionOrchestrationReceiptV2(value: unknown): ProductionOrchestrationReceiptV2 {
  assertNoSecrets(value);
  const input = record(value, "production_orchestration_receipt");
  const common = ["version", "candidateSha", "releaseGenerationId", "sourceManifestSha256", "operationId",
    "operationClaimSha256", "finalOperationLeaseSha256", "finalOperationLeaseEpoch", "operationDeadlineAt",
    "operationLeaseTakeoverChainSha256", "operationalAttestationConsumptionSha256", "redactedTemplateSha256",
    "result", "orchestration", "capability", "commandId", "recoveryInputSha256", "completedStepReceipts"];
  exactKeys(input, input.capability === "recovery_only"
    ? [...common, "recoveryAttemptedExternalEffect", "priorAttemptedExternalEffect",
      "priorCompletedStepReceiptPrefixSha256", "priorUncertainStepMarkerSha256"] : common,
  "production_orchestration_receipt");
  if (input.version !== "production-orchestration-receipt-v2" || input.result !== "completed") {
    throw new Error("production_orchestration_receipt_literal_invalid");
  }
  sha(input.candidateSha, SHA40, "orchestration_candidate");
  nonEmpty(input.releaseGenerationId, "orchestration_generation");
  nonEmpty(input.operationId, "orchestration_operation_id");
  for (const key of ["sourceManifestSha256", "operationClaimSha256", "finalOperationLeaseSha256",
    "operationLeaseTakeoverChainSha256", "operationalAttestationConsumptionSha256", "redactedTemplateSha256"]) sha(input[key], SHA256, key);
  positiveInteger(input.finalOperationLeaseEpoch, "orchestration_lease_epoch");
  iso(input.operationDeadlineAt, "orchestration_deadline");
  const capability = oneOf(input.capability, ["effect_capable", "recovery_only"] as const, "orchestration_capability");
  orchestrationCommand(input.orchestration, input.commandId, "orchestration_receipt");
  if (capability === "recovery_only") {
    if (input.orchestration !== "recovery" || input.recoveryAttemptedExternalEffect !== false) throw new Error("recovery_receipt_binding_invalid");
    sha(input.recoveryInputSha256, SHA256, "recovery_input_sha");
    booleanValue(input.priorAttemptedExternalEffect, "prior_attempted_external_effect");
    sha(input.priorCompletedStepReceiptPrefixSha256, SHA256, "prior_step_prefix_sha");
    nullableSha(input.priorUncertainStepMarkerSha256, "prior_uncertain_step_marker");
  } else if (input.orchestration === "recovery" || input.recoveryInputSha256 !== null) {
    throw new Error("effect_orchestration_receipt_binding_invalid");
  }
  if (!Array.isArray(input.completedStepReceipts)) throw new Error("completed_step_receipts_invalid");
  let previousSequence = 0;
  const completedStepIds: string[] = [];
  input.completedStepReceipts.forEach((entryValue, index) => {
    const entry = record(entryValue, "completed_step_receipt_ref");
    exactKeys(entry, ["relativePath", "sha256", "receipt"], "completed_step_receipt_ref");
    if (typeof entry.relativePath !== "string" || !SAFE_RELATIVE_PATH.test(entry.relativePath)) throw new Error("completed_step_receipt_path_invalid");
    const receipt = validateProductionOrchestrationStepReceiptV2(entry.receipt);
    if (entry.sha256 !== canonicalObjectSha(receipt)) throw new Error("completed_step_receipt_hash_binding_invalid");
    if (receipt.sequence !== index + 1 || receipt.sequence <= previousSequence
        || receipt.operationId !== input.operationId
        || receipt.operationClaimSha256 !== input.operationClaimSha256
        || receipt.authorityConsumptionSha256 !== input.operationalAttestationConsumptionSha256
        || receipt.operationDeadlineAt !== input.operationDeadlineAt
        || receipt.orchestration !== input.orchestration || receipt.capability !== capability) {
      throw new Error("completed_step_receipt_binding_invalid");
    }
    previousSequence = receipt.sequence;
    completedStepIds.push(String(receipt.stepId));
  });
  const rollbackSequences = [
    ["verify_failure", "prove_previous_healthy", "prove_no_previous_stop", "prove_no_candidate_start"],
    ["verify_failure", "restart_previous", "prove_no_candidate_start", "rollback_runtime_checks"],
    ["verify_failure", "stop_candidate", "start_previous", "rollback_runtime_checks"],
    ["verify_failure", "start_previous", "rollback_runtime_checks"],
    ["verify_failure", "prove_previous_healthy", "prove_no_candidate_running", "rollback_runtime_checks"]
  ] as const;
  const allowedCompleteSequences: readonly (readonly string[])[] = input.orchestration === "rollout"
    ? [ROLLOUT_STEPS_V2] : input.orchestration === "canary"
      ? [CANARY_STEPS_V2] : input.orchestration === "recovery"
        ? [RECOVERY_STEPS_V2] : rollbackSequences;
  if (!allowedCompleteSequences.some((steps) => canonicalReleaseJsonV2(steps)
      === canonicalReleaseJsonV2(completedStepIds))) {
    throw new Error("completed_step_receipts_sequence_incomplete");
  }
  return input as ProductionOrchestrationReceiptV2;
}

function validateTrueChecks(value: unknown, keys: readonly string[], label: string): void {
  const checks = record(value, label);
  exactKeys(checks, keys, label);
  if (keys.some((key) => checks[key] !== true)) throw new Error(`${label}_invalid`);
}

export function validateProductionRolloutEvidenceV2(value: unknown): ProductionRolloutEvidenceV2 {
  assertNoSecrets(value);
  const input = record(value, "production_rollout_evidence");
  exactKeys(input, ["version", "candidateSha", "releaseFreezeIdentitySha256",
    "operationalAttestationConsumptionSha256", "sourceManifestSha256", "previousStopEvidenceSha256",
    "candidateStartEvidenceSha256", "managerCapturesSha256", "queryCapturesSha256",
    "orchestrationReceiptSha256", "checks", "result"], "production_rollout_evidence");
  if (input.version !== "production-rollout-evidence-v2" || input.result !== "passed") throw new Error("rollout_evidence_literal_invalid");
  sha(input.candidateSha, SHA40, "rollout_candidate");
  for (const key of ["releaseFreezeIdentitySha256", "operationalAttestationConsumptionSha256", "sourceManifestSha256",
    "previousStopEvidenceSha256", "candidateStartEvidenceSha256", "managerCapturesSha256",
    "queryCapturesSha256", "orchestrationReceiptSha256"]) sha(input[key], SHA256, key);
  validateTrueChecks(input.checks, ["schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"], "rollout_checks");
  return input as ProductionRolloutEvidenceV2;
}

export function validateProductionCanaryEvidenceV2(value: unknown): ProductionCanaryEvidenceV2 {
  assertNoSecrets(value);
  const input = record(value, "production_canary_evidence");
  exactKeys(input, ["version", "candidateSha", "releaseFreezeIdentitySha256",
    "operationalAttestationConsumptionSha256", "sourceManifestSha256", "observationStartedAt",
    "observationFinishedAt", "completedPollingCycles", "queryCapturesSha256", "logCapturesSha256",
    "orchestrationReceiptSha256", "checks", "result"], "production_canary_evidence");
  if (input.version !== "production-canary-evidence-v2" || input.result !== "passed") throw new Error("canary_evidence_literal_invalid");
  sha(input.candidateSha, SHA40, "canary_candidate");
  for (const key of ["releaseFreezeIdentitySha256", "operationalAttestationConsumptionSha256", "sourceManifestSha256",
    "queryCapturesSha256", "logCapturesSha256", "orchestrationReceiptSha256"]) sha(input[key], SHA256, key);
  const started = iso(input.observationStartedAt, "canary_observation_started");
  const finished = iso(input.observationFinishedAt, "canary_observation_finished");
  const durationMs = Date.parse(finished) - Date.parse(started);
  if (durationMs < 15 * 60_000 || durationMs > 30 * 60_000) {
    throw new Error("canary_observation_time_invalid");
  }
  if (positiveInteger(input.completedPollingCycles, "canary_polling_cycles") < 2) {
    throw new Error("canary_polling_cycles_invalid");
  }
  validateTrueChecks(input.checks, ["schema", "version", "admin", "singleton", "reconciliation", "delivery",
    "navigation", "allowance", "legacy", "secrets", "queues", "honest_limits"], "canary_checks");
  return input as ProductionCanaryEvidenceV2;
}

export function validateUncertainProductionStepMarkerV2(value: unknown): UncertainProductionStepMarkerV2 {
  assertNoSecrets(value);
  const input = record(value, "uncertain_production_step_marker");
  exactKeys(input, ["sequence", "stepId", "attempt", "stepIntentRelativePath", "stepIntentSha256",
    "externalEffectMayHaveStarted", "observedOutcome"], "uncertain_production_step_marker");
  positiveInteger(input.sequence, "uncertain_step_sequence");
  oneOf(input.stepId, EXTERNAL_EFFECT_STEPS_V2, "uncertain_step_id");
  if (input.attempt !== 1 || input.externalEffectMayHaveStarted !== true || input.observedOutcome !== "unknown"
      || typeof input.stepIntentRelativePath !== "string" || !SAFE_RELATIVE_PATH.test(input.stepIntentRelativePath)) {
    throw new Error("uncertain_step_marker_literal_invalid");
  }
  sha(input.stepIntentSha256, SHA256, "uncertain_step_intent_sha");
  return input as UncertainProductionStepMarkerV2;
}

export function validateProductionRecoveryInputV2(value: unknown): ProductionRecoveryInputV2 {
  assertNoSecrets(value);
  const input = record(value, "production_recovery_input");
  exactKeys(input, ["version", "priorOperationKind", "priorOperationId", "priorTerminalAbandonedSha256",
    "priorTerminalCleanupSha256", "completedStepReceiptPrefix", "completedStepReceiptPrefixSha256",
    "uncertainStepMarker", "uncertainStepMarkerSha256", "recoveryOperationalAttestationSha256",
    "recoveryProductionLeaseSha256", "recoveryAuthorityPreclaimSha256", "recoveryOperationClaimSha256",
    "recoveryAuthorityConsumptionSha256", "verifiedAt"], "production_recovery_input");
  if (input.version !== "production-recovery-input-v2") throw new Error("production_recovery_input_version_invalid");
  oneOf(input.priorOperationKind, ["rollout", "canary"] as const, "recovery_prior_kind");
  nonEmpty(input.priorOperationId, "recovery_prior_operation_id");
  for (const key of ["priorTerminalAbandonedSha256", "priorTerminalCleanupSha256", "completedStepReceiptPrefixSha256",
    "recoveryOperationalAttestationSha256", "recoveryProductionLeaseSha256", "recoveryAuthorityPreclaimSha256",
    "recoveryOperationClaimSha256", "recoveryAuthorityConsumptionSha256"]) sha(input[key], SHA256, key);
  if (!Array.isArray(input.completedStepReceiptPrefix)) throw new Error("recovery_step_prefix_invalid");
  const priorSteps = input.priorOperationKind === "rollout" ? ROLLOUT_STEPS_V2 : CANARY_STEPS_V2;
  if (input.completedStepReceiptPrefix.length > priorSteps.length) {
    throw new Error("recovery_step_prefix_invalid");
  }
  let previous = 0;
  input.completedStepReceiptPrefix.forEach((valueItem, index) => {
    const item = record(valueItem, "recovery_step_prefix_item");
    exactKeys(item, ["sequence", "stepId", "receiptSha256"], "recovery_step_prefix_item");
    const sequence = positiveInteger(item.sequence, "recovery_prefix_sequence");
    if (sequence !== index + 1 || sequence <= previous || item.stepId !== priorSteps[index]) {
      throw new Error("recovery_step_prefix_order_invalid");
    }
    previous = sequence;
    nonEmpty(item.stepId, "recovery_prefix_step_id");
    sha(item.receiptSha256, SHA256, "recovery_prefix_receipt_sha");
  });
  if (input.completedStepReceiptPrefixSha256 !== canonicalObjectSha(input.completedStepReceiptPrefix)) {
    throw new Error("recovery_step_prefix_hash_binding_invalid");
  }
  if (input.uncertainStepMarker === null) {
    if (input.uncertainStepMarkerSha256 !== null) throw new Error("recovery_uncertain_marker_binding_invalid");
  } else {
    const marker = validateUncertainProductionStepMarkerV2(input.uncertainStepMarker);
    if (input.uncertainStepMarkerSha256 !== canonicalObjectSha(marker)
        || marker.sequence !== previous + 1
        || marker.stepId !== priorSteps[previous]
        || marker.stepIntentRelativePath
          !== `production-operation-step-intents/${String(input.priorOperationId)}/${marker.sequence}-${marker.stepId}-1-v2.json`) {
      throw new Error("recovery_uncertain_marker_binding_invalid");
    }
  }
  iso(input.verifiedAt, "recovery_input_verified_at");
  return input as ProductionRecoveryInputV2;
}

export function validateProductionFailureEvidenceV2(value: unknown): ProductionFailureEvidenceV2 {
  assertNoSecrets(value);
  const input = record(value, "production_failure_evidence");
  const common = ["version", "candidateSha", "releaseFreezeIdentitySha256", "sourceManifestSha256",
    "failedExecutionEvidenceSha256", "observedAt", "failedGateId", "evidenceKind", "attemptedExternalEffect", "failureCode"];
  let extra: string[] = [];
  let codes: readonly string[];
  if (input.failedGateId === "G13_PRODUCTION_MIGRATION" && input.evidenceKind === "schema032_execution_receipt") {
    codes = ["first_migration_failed", "first_verification_failed", "second_migration_failed", "final_verification_failed"];
    if (input.attemptedExternalEffect !== true) throw new Error("failure_external_effect_binding_invalid");
  } else if (input.failedGateId === "G14_PRODUCTION_ROLLOUT" && input.evidenceKind === "runtime_rollout_preflight") {
    extra = ["orchestrationProgressSha256", "preEffectValidationReceiptsSha256"];
    codes = ["g13_reverification_failed", "schema_verification_failed", "previous_runtime_identity_mismatch", "singleton_precondition_failed"];
    if (input.attemptedExternalEffect !== false) throw new Error("failure_external_effect_binding_invalid");
  } else if (input.failedGateId === "G14_PRODUCTION_ROLLOUT" && input.evidenceKind === "runtime_manager_capture") {
    extra = ["orchestrationProgressSha256"];
    codes = ["previous_runtime_stop_failed", "candidate_start_failed"];
    if (input.attemptedExternalEffect !== true) throw new Error("failure_external_effect_binding_invalid");
  } else if (input.failedGateId === "G14_PRODUCTION_ROLLOUT" && input.evidenceKind === "runtime_rollout_checks") {
    extra = ["orchestrationProgressSha256"];
    codes = ["schema_verification_failed", "runtime_version_mismatch", "admin_unhealthy", "singleton_violation",
      "worker_start_failed", "delivery_invariant_failed", "legacy_population_changed", "secret_detected"];
    if (input.attemptedExternalEffect !== true) throw new Error("failure_external_effect_binding_invalid");
  } else if (input.failedGateId === "G15_PRODUCTION_CANARY" && input.evidenceKind === "runtime_canary_checks") {
    extra = ["orchestrationProgressSha256"];
    codes = ["schema_verification_failed", "canary_timeout", "polling_cycles_incomplete", "runtime_version_mismatch",
      "admin_unhealthy", "singleton_violation", "reconciliation_failed", "delivery_invariant_failed",
      "navigation_invariant_failed", "allowance_invariant_failed", "legacy_population_changed", "queue_growth_detected",
      "honest_limit_misreported", "secret_detected"];
    if (input.attemptedExternalEffect !== true) throw new Error("failure_external_effect_binding_invalid");
  } else if ((input.failedGateId === "G14_PRODUCTION_ROLLOUT" || input.failedGateId === "G15_PRODUCTION_CANARY")
      && input.evidenceKind === "abandoned_operation_recovery") {
    const recoveryKeys = ["priorAttemptedExternalEffect", "recoveryAttemptedExternalEffect", "recoveryInputSha256",
      "recoveryOrchestrationReceiptSha256", "priorTerminalAbandonedSha256", "priorTerminalCleanupSha256",
      "completedStepReceiptPrefixSha256", "uncertainStepMarkerSha256", "recoveryOperationalAttestationSha256",
      "recoveryProductionLeaseSha256", "recoveryAuthorityPreclaimSha256", "recoveryOperationClaimSha256",
      "recoveryAuthorityConsumptionSha256"];
    exactKeys(input, [...common.filter((key) => key !== "attemptedExternalEffect"), ...recoveryKeys], "production_failure_evidence");
    codes = ["authority_expired_before_claim", "authority_expired_after_claim", "operation_deadline_reached"];
    booleanValue(input.priorAttemptedExternalEffect, "failure_prior_effect");
    if (input.recoveryAttemptedExternalEffect !== false) throw new Error("failure_recovery_effect_invalid");
    recoveryKeys.slice(2).forEach((key) => {
      if (key === "uncertainStepMarkerSha256") nullableSha(input[key], key);
      else sha(input[key], SHA256, key);
    });
  } else throw new Error("production_failure_branch_invalid");
  if (input.evidenceKind !== "abandoned_operation_recovery") {
    exactKeys(input, [...common, ...extra], "production_failure_evidence");
    extra.forEach((key) => sha(input[key], SHA256, key));
  }
  if (input.version !== "production-failure-evidence-v2") throw new Error("production_failure_version_invalid");
  sha(input.candidateSha, SHA40, "failure_candidate");
  for (const key of ["releaseFreezeIdentitySha256", "sourceManifestSha256", "failedExecutionEvidenceSha256"]) sha(input[key], SHA256, key);
  iso(input.observedAt, "failure_observed_at");
  oneOf(input.failureCode, codes, "production_failure_code");
  return input as ProductionFailureEvidenceV2;
}

export function validateProductionRollbackEvidenceV2(value: unknown): ProductionRollbackEvidenceV2 {
  assertNoSecrets(value);
  const input = record(value, "production_rollback_evidence");
  exactKeys(input, ["version", "candidateSha", "releaseFreezeIdentitySha256", "artifactRootFingerprintSha256",
    "sourceManifestSha256", "failureEvidenceSha256", "operationalAttestationSha256",
    "operationalAttestationConsumptionSha256", "commandId", "redactedTemplateSha256",
    "previousRuntimeIdentitySha256", "orchestrationReceiptSha256", "outcome", "queryCapturesSha256", "checks"],
  "production_rollback_evidence");
  if (input.version !== "production-rollback-evidence-v2" || input.commandId !== "production_rollback") {
    throw new Error("production_rollback_evidence_literal_invalid");
  }
  sha(input.candidateSha, SHA40, "rollback_candidate");
  for (const key of ["releaseFreezeIdentitySha256", "artifactRootFingerprintSha256", "sourceManifestSha256",
    "failureEvidenceSha256", "operationalAttestationSha256", "operationalAttestationConsumptionSha256",
    "redactedTemplateSha256", "previousRuntimeIdentitySha256", "orchestrationReceiptSha256", "queryCapturesSha256"]) {
    sha(input[key], SHA256, key);
  }
  validateProductionRollbackOutcomeV2(input.outcome);
  validateTrueChecks(input.checks, ["schema032_retained", "previous_version", "admin", "singleton", "allowance",
    "legacy", "sent", "no_duplicate_send"], "rollback_checks");
  return input as ProductionRollbackEvidenceV2;
}
