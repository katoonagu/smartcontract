import { createHash } from "node:crypto";
import { canonicalBytesV2 } from "./releaseRootWriterStore";
import {
  validateOperationalAttestationV2,
  validatePreparedProductionOperationLeaseRemovalV2,
  validateProductionCanaryEvidenceV2,
  validateProductionOperationClaimV2,
  validateProductionOperationLeaseRemovalReceiptV2,
  validateProductionOperationSettlementV2,
  validateProductionOperationTerminalCleanupV2,
  validateProductionOrchestrationReceiptV2,
  validateProductionRolloutEvidenceV2,
  validateSchema032ProductionExecutionReceiptV2
} from "./remediationReleaseManifestV2";
import type {
  ExecutedReleaseGateV2,
  GateEvidenceKindV2,
  GateEvidenceRefV2,
  ProductionGateIdV2,
  ReleaseGateIdV2
} from "./remediationReleaseManifestV2";

export type GateEvidencePolicyV2 = Readonly<{
  gateId: ReleaseGateIdV2;
  primaryPaths: readonly string[];
  allowedKinds: readonly GateEvidenceKindV2[];
  requiredKinds: readonly GateEvidenceKindV2[];
  production: boolean;
}>;

const policy = (
  gateId: ReleaseGateIdV2,
  primaryPaths: readonly string[],
  allowedKinds: readonly GateEvidenceKindV2[],
  production = false,
  requiredKinds: readonly GateEvidenceKindV2[] = allowedKinds
): GateEvidencePolicyV2 => Object.freeze({ gateId, primaryPaths, allowedKinds, requiredKinds, production });

export const PRE_RELEASE_GATE_EVIDENCE_POLICY_V2 = Object.freeze({
  G00_BASE: policy("G00_BASE", ["task0-baseline.json", "trusted-os-principal-policy-v2.json",
    "artifact-root-trust-boundary-evidence-v1.json", "release-freeze-materialization-receipt-v2.json",
    "release-freeze-identity-v2.json"], ["task0_baseline", "trusted_os_principal_policy",
    "release_freeze_materialization"]),
  G01_TRACE: policy("G01_TRACE", ["acceptance-trace.json", "task8b-red-evidence-v1.json"],
    ["acceptance_trace", "task8b_red"]),
  G02_DATA: policy("G02_DATA", ["suite-plan1.vitest.json", "suite-plan1.evidence.json"],
    ["suite_report", "suite_evidence"]),
  G03_SCORING: policy("G03_SCORING", ["suite-plan2.vitest.json", "suite-plan2.evidence.json"],
    ["suite_report", "suite_evidence"]),
  G04_RUNTIME: policy("G04_RUNTIME", ["suite-plan3.vitest.json", "suite-plan3.evidence.json"],
    ["suite_report", "suite_evidence"]),
  G05_TELEGRAM: policy("G05_TELEGRAM", ["manual-telegram-acceptance.json"],
    ["manual_telegram_acceptance", "suite_report", "suite_evidence"], false,
    ["manual_telegram_acceptance"]),
  G06_FULL: policy("G06_FULL", ["full-regression-evidence.json"], ["full_regression", "suite_report"]),
  G07_SCHEMA_OFFLINE: policy("G07_SCHEMA_OFFLINE", [
    "schema-clean/schema032-release-evidence.json",
    "schema-production-clone/schema032-release-evidence.json"
  ], ["schema_clean", "schema_production_clone"]),
  G08_VERSION_SANITIZED: policy("G08_VERSION_SANITIZED", ["runtime-rehearsal.json"],
    ["schema_runtime_sanitized", "runtime_rehearsal"], false, ["runtime_rehearsal"]),
  G09_LEGACY_TERMINAL: policy("G09_LEGACY_TERMINAL", ["terminal-legacy-population.json"],
    ["terminal_legacy_population"]),
  G10_ROLLBACK_REHEARSAL: policy("G10_ROLLBACK_REHEARSAL", ["rollback-rehearsal.json"],
    ["rollback_rehearsal"]),
  G11_POISONING_REGRESSION: policy("G11_POISONING_REGRESSION",
    ["suite-address-poisoning-regression.vitest.json", "suite-address-poisoning-regression.evidence.json"],
    ["suite_report", "suite_evidence"])
} satisfies Record<Exclude<ReleaseGateIdV2, ProductionGateIdV2>, GateEvidencePolicyV2>);

export const PRODUCTION_GATE_EVIDENCE_POLICY_V2 = Object.freeze({
  G12_PRODUCTION_BACKUP: policy("G12_PRODUCTION_BACKUP", [
    "production-backup-evidence.json", "production-backup.dump", "production-backup-restore-list.txt"
  ], ["operational_attestation", "production_backup_consumption", "production_backup_dump_progress",
    "production_backup_list_progress", "production_backup_dump", "production_backup_restore_list",
    "production_backup_evidence"], true),
  G13_PRODUCTION_MIGRATION: policy("G13_PRODUCTION_MIGRATION", [
    "schema032-production-execution-receipt-v2.json"
  ], ["operational_attestation", "production_migration_authority", "production_migration_consumption",
    "production_migration_sequence"], true),
  G14_PRODUCTION_ROLLOUT: policy("G14_PRODUCTION_ROLLOUT", ["production-rollout-evidence-v2.json"],
    ["operational_attestation", "production_operation_claim", "production_operation_settlement",
      "production_operation_lease_removal_prepared", "production_operation_lease_removal",
      "production_operation_cleanup", "production_rollout_manager", "production_rollout_queries",
      "production_rollout_orchestration", "production_rollout_evidence"], true),
  G15_PRODUCTION_CANARY: policy("G15_PRODUCTION_CANARY", ["production-canary-evidence-v2.json"],
    ["operational_attestation", "production_operation_claim", "production_operation_settlement",
      "production_operation_lease_removal_prepared", "production_operation_lease_removal",
      "production_operation_cleanup", "production_canary_queries", "production_canary_logs",
      "production_canary_orchestration", "production_canary_evidence"], true)
} satisfies Record<ProductionGateIdV2, GateEvidencePolicyV2>);

export const RELEASE_GATE_EVIDENCE_POLICY_V2 = Object.freeze({
  ...PRE_RELEASE_GATE_EVIDENCE_POLICY_V2,
  ...PRODUCTION_GATE_EVIDENCE_POLICY_V2
} satisfies Record<ReleaseGateIdV2, GateEvidencePolicyV2>);

const SAFE_RELATIVE = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._/-]+$/u;

function parseCanonicalEvidenceJson(bytes: Buffer, ref: GateEvidenceRefV2): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`gate_evidence_json_invalid:${ref.relativePath}`); }
  if (typeof value !== "object" || value === null || Array.isArray(value)
      || !canonicalBytesV2(value).equals(bytes)) {
    throw new Error(`gate_evidence_canonical_json_invalid:${ref.relativePath}`);
  }
  const object = value as Record<string, unknown>;
  if (object.candidateSha !== undefined && object.candidateSha !== ref.candidateSha) {
    throw new Error("gate_evidence_candidate_payload_mismatch");
  }
  if (typeof object.version === "string" && object.version !== ref.schemaVersion) {
    throw new Error("gate_evidence_schema_version_mismatch");
  }
  return object;
}

export type GateEvidenceBindingContextV2 = Readonly<{
  releaseGenerationId?: string;
  artifactRootFingerprintSha256?: string;
  releaseFreezeIdentitySha256?: string;
  sourceManifestSha256?: string;
}>;

function validateEvidenceBindings(
  value: Record<string, unknown>,
  ref: GateEvidenceRefV2,
  expected: GateEvidenceBindingContextV2
): void {
  const bindings: Array<[keyof GateEvidenceBindingContextV2, string | undefined]> = [
    ["releaseGenerationId", expected.releaseGenerationId],
    ["artifactRootFingerprintSha256", expected.artifactRootFingerprintSha256],
    ["releaseFreezeIdentitySha256", expected.releaseFreezeIdentitySha256],
    ["sourceManifestSha256", expected.sourceManifestSha256]
  ];
  for (const [key, wanted] of bindings) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || (wanted !== undefined && value[key] !== wanted))) {
      throw new Error(`gate_evidence_${key}_binding_invalid`);
    }
  }
  if (value.candidateSha !== undefined && value.candidateSha !== ref.candidateSha) {
    throw new Error("gate_evidence_candidate_payload_mismatch");
  }
}

function validateProductionEvidencePath(
  ref: GateEvidenceRefV2,
  expected: GateEvidenceBindingContextV2
): void {
  const generation = expected.releaseGenerationId;
  const fixed: Partial<Record<GateEvidenceKindV2, string>> = {
    production_backup_dump: "production-backup.dump",
    production_backup_restore_list: "production-backup-restore-list.txt",
    production_backup_evidence: "production-backup-evidence.json",
    production_migration_sequence: "schema032-production-execution-receipt-v2.json",
    production_rollout_manager: "production-rollout-manager-captures-v2.json",
    production_rollout_queries: "production-rollout-query-captures-v2.json",
    production_rollout_orchestration: "production-rollout-orchestration-receipt-v2.json",
    production_rollout_evidence: "production-rollout-evidence-v2.json",
    production_canary_queries: "production-canary-query-captures-v2.json",
    production_canary_logs: "production-canary-log-captures-v2.json",
    production_canary_orchestration: "production-canary-orchestration-receipt-v2.json",
    production_canary_evidence: "production-canary-evidence-v2.json"
  };
  const derived: Partial<Record<GateEvidenceKindV2, string | undefined>> = generation === undefined ? {} : {
    production_backup_consumption: `production-backup-authority-consumed-${generation}.json`,
    production_backup_dump_progress: `production-backup-dump-progress-${generation}.json`,
    production_backup_list_progress: `production-backup-list-progress-${generation}.json`,
    production_migration_authority: `schema032-production-authority-${generation}.json`,
    production_migration_consumption: `schema032-production-authority-consumed-${generation}.json`
  };
  const wanted = fixed[ref.kind] ?? derived[ref.kind];
  if (wanted !== undefined && ref.relativePath !== wanted) {
    throw new Error(`gate_evidence_path_binding_invalid:${ref.kind}`);
  }
}

function validateTypedEvidence(ref: GateEvidenceRefV2, bytes: Buffer): void {
  if (ref.kind === "production_backup_dump" || ref.kind === "production_backup_restore_list") {
    if (bytes.length === 0) throw new Error("gate_evidence_empty");
    return;
  }
  const value = parseCanonicalEvidenceJson(bytes, ref);
  if (ref.kind === "operational_attestation") validateOperationalAttestationV2(value);
  else if (ref.kind === "production_migration_sequence") validateSchema032ProductionExecutionReceiptV2(value);
  else if (ref.kind === "production_operation_claim") validateProductionOperationClaimV2(value);
  else if (ref.kind === "production_operation_settlement") validateProductionOperationSettlementV2(value);
  else if (ref.kind === "production_operation_lease_removal_prepared") {
    validatePreparedProductionOperationLeaseRemovalV2(value);
  } else if (ref.kind === "production_operation_lease_removal") {
    validateProductionOperationLeaseRemovalReceiptV2(value);
  } else if (ref.kind === "production_operation_cleanup") validateProductionOperationTerminalCleanupV2(value);
  else if (ref.kind === "production_rollout_orchestration" || ref.kind === "production_canary_orchestration") {
    validateProductionOrchestrationReceiptV2(value);
  } else if (ref.kind === "production_rollout_evidence") validateProductionRolloutEvidenceV2(value);
  else if (ref.kind === "production_canary_evidence") validateProductionCanaryEvidenceV2(value);
}

export function validateGateEvidenceBytesV2(
  gate: ExecutedReleaseGateV2,
  bytesByRelativePath: ReadonlyMap<string, Buffer>,
  expected: GateEvidenceBindingContextV2 = {}
): readonly GateEvidenceRefV2[] {
  const gatePolicy = RELEASE_GATE_EVIDENCE_POLICY_V2[gate.id];
  if (gate.candidateSha.length !== 40 || gate.evidence.length === 0) throw new Error("gate_evidence_missing");
  const seen = new Set<string>();
  const seenKinds = new Set<GateEvidenceKindV2>();
  for (const ref of gate.evidence) {
    if (!SAFE_RELATIVE.test(ref.relativePath) || seen.has(ref.relativePath)) {
      throw new Error("gate_evidence_path_invalid");
    }
    seen.add(ref.relativePath);
    if (gatePolicy.production && seenKinds.has(ref.kind)) {
      throw new Error(`gate_evidence_duplicate_kind:${ref.kind}`);
    }
    seenKinds.add(ref.kind);
    if (ref.candidateSha !== gate.candidateSha || !gatePolicy.allowedKinds.includes(ref.kind)) {
      throw new Error("gate_evidence_policy_binding_invalid");
    }
    const bytes = bytesByRelativePath.get(ref.relativePath);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) {
      throw new Error("gate_evidence_bytes_invalid");
    }
    validateTypedEvidence(ref, bytes);
    if (gatePolicy.production) validateProductionEvidencePath(ref, expected);
    if (ref.kind !== "production_backup_dump" && ref.kind !== "production_backup_restore_list") {
      validateEvidenceBindings(parseCanonicalEvidenceJson(bytes, ref), ref, expected);
    }
  }
  for (const required of gatePolicy.primaryPaths) {
    if (!seen.has(required)) throw new Error(`gate_evidence_primary_missing:${required}`);
  }
  for (const kind of gatePolicy.requiredKinds) {
    if (!seenKinds.has(kind)) throw new Error(`gate_evidence_kind_missing:${kind}`);
  }
  return gate.evidence;
}
