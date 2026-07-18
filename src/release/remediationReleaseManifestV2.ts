import { createHash } from "node:crypto";

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
  "full_regression", "schema_clean", "schema_production_clone",
  "schema_runtime_sanitized", "runtime_rehearsal", "terminal_legacy_population",
  "rollback_rehearsal", "manual_telegram_acceptance", "operational_attestation",
  "production_backup_consumption", "production_backup_dump_progress",
  "production_backup_list_progress", "production_backup_dump",
  "production_backup_restore_list", "production_backup_evidence",
  "production_migration_authority", "production_migration_consumption",
  "production_migration_sequence", "production_operation_claim",
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
  rollback_rolled_back: {
    commandId: "production_rollback",
    redactedTemplate: "release:production:rollback <previous-runtime-sha> <runtime-label>"
  }
} as const);

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

function parseVerifiedTransitionEvidence(value: unknown): VerifiedManifestTransitionEvidenceV2 {
  const verified = record(value, "verified_transition_evidence");
  exactKeys(verified, ["refs", "actualRollbackOutcome"], "verified_transition_evidence");
  if (!Array.isArray(verified.refs)) throw new Error("verified_transition_refs_invalid");
  const refs = verified.refs.map((ref) => {
    const kind = record(ref, "transition_evidence_ref").kind;
    if (kind === "production_failure_evidence") return validateProductionFailureTransitionEvidenceRefV2(ref);
    if (kind === "actual_rollback_evidence") return validateActualRollbackTransitionEvidenceRefV2(ref);
    throw new Error("transition_evidence_kind_invalid");
  });
  const actualRollbackOutcome = verified.actualRollbackOutcome === null
    ? null : validateProductionRollbackOutcomeV2(verified.actualRollbackOutcome);
  return { refs, actualRollbackOutcome };
}

function requireOperationalAttestation(
  transition: VerifiedManifestTransitionV2,
  current: RemediationReleaseManifestV2,
  sourceManifestSha256: string
): void {
  const productionAction = [
    "g12_backup_passed", "g13_migration_passed", "g14_rollout_passed",
    "g15_canary_released", "rollback_rolled_back"
  ].includes(transition.transitionId);
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
  const transitionEvidence = parseVerifiedTransitionEvidence(verifiedTransitionEvidenceValue);
  const sourceManifestSha256 = releaseManifestSha256V2(current);
  requireOperationalAttestation(transition, current, sourceManifestSha256);

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

export function validateManifestGateEvidenceV2(): never {
  throw new Error("gate_evidence_policy_not_implemented");
}

export async function verifyRemediationReleaseArtifactsV2(): Promise<never> {
  throw new Error("gate_evidence_policy_not_implemented");
}

export function assertProductionMutatorAuthorityV2(): never {
  throw new Error("production_mutator_authority_unverified");
}
