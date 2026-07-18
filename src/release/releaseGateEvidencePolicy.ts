import { createHash } from "node:crypto";
import { validateTask0BReleaseFreezeEvidence } from "./remediationReleaseManifest";
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

export type Task0BProductionGateBindingV2 = Readonly<{
  task0bReleaseFreezeSha256: string;
  productionDatabaseIdentityFingerprintSha256: string;
}>;

export function deriveTask0BProductionGateBindingV2(
  bytes: Buffer,
  candidateSha: string,
  productionDatabaseIdentityFingerprintSha256: string
): Task0BProductionGateBindingV2 {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("task0b_release_freeze_json_invalid"); }
  const task0b = validateTask0BReleaseFreezeEvidence(parsed, candidateSha);
  if (!bytes.equals(canonicalBytesV2(task0b))) {
    throw new Error("task0b_release_freeze_noncanonical");
  }
  if (task0b.productionDatabase.approvedIdentityFingerprintSha256
      !== productionDatabaseIdentityFingerprintSha256) {
    throw new Error("task0b_production_database_identity_mismatch");
  }
  return {
    task0bReleaseFreezeSha256: createHash("sha256").update(bytes).digest("hex"),
    productionDatabaseIdentityFingerprintSha256
  };
}

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
  ], ["operational_attestation", "production_backup_authority", "production_backup_consumption", "production_backup_dump_progress",
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
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;

function evidenceRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactEvidenceKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(code);
  }
}

function evidenceSha(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(code);
  return value;
}

function evidenceCandidate(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA40.test(value)) throw new Error(code);
  return value;
}

function evidenceIso(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(code);
  return value;
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(code);
  return Number(value);
}

function canonicalEvidenceSha(value: unknown): string {
  return createHash("sha256").update(canonicalBytesV2(value)).digest("hex");
}

function validateProductionBackupConsumption(value: unknown): Record<string, unknown> {
  const input = evidenceRecord(value, "production_backup_consumption_invalid");
  exactEvidenceKeys(input, ["version", "generationId", "authoritySha256", "candidateSha",
    "databaseIdentityFingerprintSha256", "artifactRootFingerprintSha256", "claimedAt", "expiresAt"],
  "production_backup_consumption_invalid");
  if (input.version !== "production-backup-authority-consumption-v1"
      || typeof input.generationId !== "string" || !GENERATION.test(input.generationId)) {
    throw new Error("production_backup_consumption_invalid");
  }
  evidenceSha(input.authoritySha256, "production_backup_consumption_invalid");
  evidenceCandidate(input.candidateSha, "production_backup_consumption_invalid");
  evidenceSha(input.databaseIdentityFingerprintSha256, "production_backup_consumption_invalid");
  evidenceSha(input.artifactRootFingerprintSha256, "production_backup_consumption_invalid");
  const claimedAt = evidenceIso(input.claimedAt, "production_backup_consumption_invalid");
  const expiresAt = evidenceIso(input.expiresAt, "production_backup_consumption_invalid");
  if (Date.parse(claimedAt) >= Date.parse(expiresAt)) throw new Error("production_backup_consumption_invalid");
  return input;
}

function validateProductionBackupAuthority(value: unknown): Record<string, unknown> {
  const code = "production_backup_authority_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "scope", "source", "generationId", "commandId",
    "commandTemplateSha256", "issuedAt", "expiresAt", "candidateSha", "databaseRole",
    "databaseIdentityFingerprintSha256", "task0bEvidencePath", "task0bEvidenceSha256",
    "releaseManifestPath", "releaseManifestSha256", "releaseManifestOverall",
    "artifactRootFingerprintSha256", "explicitGo"], code);
  if (input.version !== "production-backup-authority-v1" || input.scope !== "production_backup"
      || input.source !== "operator_protected_one_shot_production_go"
      || typeof input.generationId !== "string" || !GENERATION.test(input.generationId)
      || input.commandId !== "production_backup" || input.databaseRole !== "production"
      || input.task0bEvidencePath !== "task0b-release-freeze.json"
      || input.releaseManifestPath !== "release-manifest.json"
      || input.releaseManifestOverall !== "ready_for_release" || input.explicitGo !== true) {
    throw new Error(code);
  }
  evidenceCandidate(input.candidateSha, code);
  for (const key of ["commandTemplateSha256", "databaseIdentityFingerprintSha256", "task0bEvidenceSha256",
    "releaseManifestSha256", "artifactRootFingerprintSha256"]) evidenceSha(input[key], code);
  const issuedAt = evidenceIso(input.issuedAt, code);
  const expiresAt = evidenceIso(input.expiresAt, code);
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)
      || Date.parse(expiresAt) - Date.parse(issuedAt) > 10 * 60_000) throw new Error(code);
  return input;
}

function validateProductionBackupProgress(value: unknown, kind: "dump" | "list"): Record<string, unknown> {
  const code = `production_backup_${kind}_progress_invalid`;
  const input = evidenceRecord(value, code);
  const common = ["version", "generationId", "authoritySha256", "claimSha256", "candidateSha",
    "databaseIdentityFingerprintSha256", "artifactRootFingerprintSha256", "expiresAt", "operationId", "recordedAt"];
  exactEvidenceKeys(input, kind === "dump"
    ? [...common, "backupFilename", "backupBytes", "backupSha256", "backupPathFingerprintSha256"]
    : [...common, "dumpProgressSha256", "restoreListFilename", "restoreListBytes", "restoreListSha256",
      "restoreListEntryCount"], code);
  if (input.version !== `production-backup-${kind}-progress-v1`
      || typeof input.generationId !== "string" || !GENERATION.test(input.generationId)
      || typeof input.operationId !== "string" || input.operationId.length === 0) throw new Error(code);
  for (const key of ["authoritySha256", "claimSha256", "databaseIdentityFingerprintSha256",
    "artifactRootFingerprintSha256"]) evidenceSha(input[key], code);
  evidenceCandidate(input.candidateSha, code);
  evidenceIso(input.expiresAt, code);
  evidenceIso(input.recordedAt, code);
  if (kind === "dump") {
    if (input.backupFilename !== "production-backup.dump") throw new Error(code);
    positiveInteger(input.backupBytes, code);
    evidenceSha(input.backupSha256, code);
    evidenceSha(input.backupPathFingerprintSha256, code);
  } else {
    if (input.restoreListFilename !== "production-backup-restore-list.txt") throw new Error(code);
    positiveInteger(input.restoreListBytes, code);
    positiveInteger(input.restoreListEntryCount, code);
    evidenceSha(input.dumpProgressSha256, code);
    evidenceSha(input.restoreListSha256, code);
  }
  return input;
}

function validateProductionBackupEvidence(value: unknown): Record<string, unknown> {
  const code = "production_backup_evidence_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "candidateSha", "gateId", "commandId", "redactedTemplateSha256",
    "databaseIdentityFingerprintSha256", "backupFilename", "backupBytes", "backupSha256",
    "backupPathFingerprintSha256", "restoreListFilename", "restoreListBytes", "restoreListSha256",
    "restoreListEntryCount", "state"], code);
  if (input.version !== "production-backup-evidence-v1" || input.gateId !== "G12_PRODUCTION_BACKUP"
      || input.commandId !== "production_backup" || input.backupFilename !== "production-backup.dump"
      || input.restoreListFilename !== "production-backup-restore-list.txt" || input.state !== "passed") {
    throw new Error(code);
  }
  evidenceCandidate(input.candidateSha, code);
  for (const key of ["redactedTemplateSha256", "databaseIdentityFingerprintSha256", "backupSha256",
    "backupPathFingerprintSha256", "restoreListSha256"]) evidenceSha(input[key], code);
  positiveInteger(input.backupBytes, code);
  positiveInteger(input.restoreListBytes, code);
  positiveInteger(input.restoreListEntryCount, code);
  return input;
}

function validateProductionMigrationAuthority(value: unknown): Record<string, unknown> {
  const code = "schema_032_sequence_production_authority_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "scope", "source", "generationId", "commandId",
    "commandTemplateSha256", "issuedAt", "expiresAt", "candidateSha", "databaseRole",
    "databaseIdentityFingerprintSha256", "task0bEvidenceSha256", "releaseManifestPath",
    "releaseManifestSha256", "releaseManifestOverall", "backupEvidencePath", "backupEvidenceSha256",
    "explicitGo"], code);
  if (input.version !== "schema-032-production-authority-v1"
      || input.scope !== "schema_032_production_migration"
      || input.source !== "operator_protected_one_shot_production_go"
      || typeof input.generationId !== "string" || !GENERATION.test(input.generationId)
      || input.commandId !== "production_migration" || input.databaseRole !== "production"
      || input.releaseManifestPath !== "release-manifest.json" || input.releaseManifestOverall !== "not_ready"
      || input.backupEvidencePath !== "production-backup-evidence.json" || input.explicitGo !== true) {
    throw new Error(code);
  }
  evidenceCandidate(input.candidateSha, code);
  for (const key of ["commandTemplateSha256", "databaseIdentityFingerprintSha256", "task0bEvidenceSha256",
    "releaseManifestSha256", "backupEvidenceSha256"]) evidenceSha(input[key], code);
  const issuedAt = evidenceIso(input.issuedAt, code);
  const expiresAt = evidenceIso(input.expiresAt, code);
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)
      || Date.parse(expiresAt) - Date.parse(issuedAt) > 10 * 60_000) throw new Error(code);
  return input;
}

function validateProductionMigrationConsumption(value: unknown): Record<string, unknown> {
  const code = "schema_032_sequence_production_consumption_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "generationId", "authoritySha256", "candidateSha",
    "databaseIdentityFingerprintSha256", "claimedAt", "resumeExpiresAt"], code);
  if (input.version !== "schema-032-production-authority-consumption-v1"
      || typeof input.generationId !== "string" || !GENERATION.test(input.generationId)) throw new Error(code);
  evidenceSha(input.authoritySha256, code);
  evidenceCandidate(input.candidateSha, code);
  evidenceSha(input.databaseIdentityFingerprintSha256, code);
  const claimedAt = evidenceIso(input.claimedAt, code);
  const expiresAt = evidenceIso(input.resumeExpiresAt, code);
  if (Date.parse(claimedAt) >= Date.parse(expiresAt)) throw new Error(code);
  return input;
}

type NestedCapture = Readonly<{
  stepId: string;
  sequence: number;
  executionKind: "local_validation" | "external_effect";
  outputSha256: string;
  observedStateSha256: string;
}>;

function validateQueryCaptures(value: unknown): { operationId: string; captures: NestedCapture[] } {
  const code = "production_query_captures_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "operationId", "captures"], code);
  if (input.version !== "production-orchestration-captures-v2"
      || typeof input.operationId !== "string" || input.operationId.length === 0
      || !Array.isArray(input.captures) || input.captures.length === 0) throw new Error(code);
  const captures = input.captures.map((item, index) => {
    const capture = evidenceRecord(item, code);
    exactEvidenceKeys(capture, ["stepId", "sequence", "executionKind", "outputSha256", "observedStateSha256"], code);
    if (typeof capture.stepId !== "string" || capture.stepId.length === 0 || capture.sequence !== index + 1
        || (capture.executionKind !== "local_validation" && capture.executionKind !== "external_effect")) {
      throw new Error(code);
    }
    evidenceSha(capture.outputSha256, code);
    evidenceSha(capture.observedStateSha256, code);
    return capture as NestedCapture;
  });
  return { operationId: input.operationId, captures };
}

function validateManagerCaptures(value: unknown): { operationId: string; captures: NestedCapture[] } {
  const code = "production_manager_captures_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "operationId", "captures"], code);
  if (input.version !== "production-manager-captures-v2" || typeof input.operationId !== "string"
      || input.operationId.length === 0 || !Array.isArray(input.captures)) throw new Error(code);
  const captures = input.captures.map((item) => {
    const capture = evidenceRecord(item, code);
    exactEvidenceKeys(capture, ["stepId", "sequence", "executionKind", "outputSha256", "observedStateSha256"], code);
    if (typeof capture.stepId !== "string" || !Number.isSafeInteger(capture.sequence)
        || capture.executionKind !== "external_effect") throw new Error(code);
    evidenceSha(capture.outputSha256, code);
    evidenceSha(capture.observedStateSha256, code);
    return capture as NestedCapture;
  });
  return { operationId: input.operationId, captures };
}

function validateLogCaptures(value: unknown): { operationId: string; captureSha256s: string[] } {
  const code = "production_canary_log_captures_invalid";
  const input = evidenceRecord(value, code);
  exactEvidenceKeys(input, ["version", "operationId", "captureSha256s"], code);
  if (input.version !== "production-canary-log-captures-v2" || typeof input.operationId !== "string"
      || input.operationId.length === 0 || !Array.isArray(input.captureSha256s)) throw new Error(code);
  const captureSha256s = input.captureSha256s.map((valueSha) => evidenceSha(valueSha, code));
  return { operationId: input.operationId, captureSha256s };
}

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
  task0bReleaseFreezeSha256?: string;
  productionDatabaseIdentityFingerprintSha256?: string;
  sourceManifestSha256ByGate?: Readonly<Partial<Record<ProductionGateIdV2, string>>>;
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
  if (value.generationId !== undefined
      && (typeof value.generationId !== "string"
        || (expected.releaseGenerationId !== undefined && value.generationId !== expected.releaseGenerationId))) {
    throw new Error("gate_evidence_generationId_binding_invalid");
  }
  if (value.freezeIdentitySha256 !== undefined
      && (typeof value.freezeIdentitySha256 !== "string"
        || (expected.releaseFreezeIdentitySha256 !== undefined
          && value.freezeIdentitySha256 !== expected.releaseFreezeIdentitySha256))) {
    throw new Error("gate_evidence_freezeIdentitySha256_binding_invalid");
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
    production_backup_authority: `production-backup-authority-${generation}.json`,
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

export function validateProductionNestedGateEvidenceV2(input: Readonly<{
  gateId: "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY";
  evidence: unknown;
  managerCaptures?: unknown;
  queryCaptures: unknown;
  logCaptures?: unknown;
  orchestrationReceipt: unknown;
}>): void {
  const queries = validateQueryCaptures(input.queryCaptures);
  const orchestration = validateProductionOrchestrationReceiptV2(input.orchestrationReceipt);
  const evidence = input.gateId === "G14_PRODUCTION_ROLLOUT"
    ? validateProductionRolloutEvidenceV2(input.evidence)
    : validateProductionCanaryEvidenceV2(input.evidence);
  const expectedOrchestration = input.gateId === "G14_PRODUCTION_ROLLOUT" ? "rollout" : "canary";
  if (orchestration.orchestration !== expectedOrchestration
      || orchestration.operationId !== queries.operationId
      || orchestration.candidateSha !== evidence.candidateSha
      || orchestration.sourceManifestSha256 !== evidence.sourceManifestSha256
      || orchestration.operationalAttestationConsumptionSha256
        !== evidence.operationalAttestationConsumptionSha256
      || evidence.queryCapturesSha256 !== canonicalEvidenceSha(input.queryCaptures)
      || evidence.orchestrationReceiptSha256 !== canonicalEvidenceSha(input.orchestrationReceipt)) {
    throw new Error("production_nested_orchestration_binding_invalid");
  }
  const receiptCaptures = orchestration.completedStepReceipts.map(({ receipt }) => ({
    stepId: receipt.stepId,
    sequence: receipt.sequence,
    executionKind: receipt.executionKind,
    outputSha256: receipt.outputSha256,
    observedStateSha256: receipt.observedStateSha256
  }));
  if (!canonicalBytesV2(receiptCaptures).equals(canonicalBytesV2(queries.captures))) {
    throw new Error("production_query_capture_receipt_binding_invalid");
  }
  if (input.gateId === "G14_PRODUCTION_ROLLOUT") {
    if (input.managerCaptures === undefined || input.logCaptures !== undefined) {
      throw new Error("production_rollout_nested_artifacts_invalid");
    }
    const manager = validateManagerCaptures(input.managerCaptures);
    const rollout = evidence as ReturnType<typeof validateProductionRolloutEvidenceV2>;
    const external = queries.captures.filter((capture) => capture.executionKind === "external_effect");
    if (manager.operationId !== queries.operationId
        || !canonicalBytesV2(manager.captures).equals(canonicalBytesV2(external))
        || rollout.managerCapturesSha256 !== canonicalEvidenceSha(input.managerCaptures)) {
      throw new Error("production_manager_capture_hash_binding_invalid");
    }
    if (rollout.previousStopEvidenceSha256
          !== queries.captures.find((capture) => capture.stepId === "stop_previous")?.outputSha256
        || rollout.candidateStartEvidenceSha256
          !== queries.captures.find((capture) => capture.stepId === "start_candidate")?.outputSha256) {
      throw new Error("production_manager_effect_binding_invalid");
    }
    return;
  }
  if (input.logCaptures === undefined || input.managerCaptures !== undefined) {
    throw new Error("production_canary_nested_artifacts_invalid");
  }
  const logs = validateLogCaptures(input.logCaptures);
  const canary = evidence as ReturnType<typeof validateProductionCanaryEvidenceV2>;
  if (logs.operationId !== queries.operationId
      || !canonicalBytesV2(logs.captureSha256s)
        .equals(canonicalBytesV2(queries.captures.map((capture) => capture.outputSha256)))
      || canary.logCapturesSha256 !== canonicalEvidenceSha(input.logCaptures)) {
    throw new Error("production_canary_log_capture_binding_invalid");
  }
}

function validateTypedEvidence(ref: GateEvidenceRefV2, bytes: Buffer): Record<string, unknown> | null {
  if (ref.kind === "production_backup_dump" || ref.kind === "production_backup_restore_list") {
    if (bytes.length === 0) throw new Error("gate_evidence_empty");
    return null;
  }
  const value = parseCanonicalEvidenceJson(bytes, ref);
  if (ref.kind === "operational_attestation") validateOperationalAttestationV2(value);
  else if (ref.kind === "production_backup_authority") validateProductionBackupAuthority(value);
  else if (ref.kind === "production_backup_consumption") validateProductionBackupConsumption(value);
  else if (ref.kind === "production_backup_dump_progress") validateProductionBackupProgress(value, "dump");
  else if (ref.kind === "production_backup_list_progress") validateProductionBackupProgress(value, "list");
  else if (ref.kind === "production_backup_evidence") validateProductionBackupEvidence(value);
  else if (ref.kind === "production_migration_authority") validateProductionMigrationAuthority(value);
  else if (ref.kind === "production_migration_consumption") validateProductionMigrationConsumption(value);
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
  else if (ref.kind === "production_rollout_manager") validateManagerCaptures(value);
  else if (ref.kind === "production_rollout_queries" || ref.kind === "production_canary_queries") {
    validateQueryCaptures(value);
  } else if (ref.kind === "production_canary_logs") validateLogCaptures(value);
  return value;
}

type ParsedGateArtifact = Readonly<{
  ref: GateEvidenceRefV2;
  bytes: Buffer;
  value: Record<string, unknown> | null;
}>;

function requireArtifact(
  artifacts: ReadonlyMap<GateEvidenceKindV2, ParsedGateArtifact>,
  kind: GateEvidenceKindV2
): ParsedGateArtifact {
  const artifact = artifacts.get(kind);
  if (!artifact) throw new Error(`gate_evidence_kind_missing:${kind}`);
  return artifact;
}

function requireJsonArtifact(
  artifacts: ReadonlyMap<GateEvidenceKindV2, ParsedGateArtifact>,
  kind: GateEvidenceKindV2
): ParsedGateArtifact & { value: Record<string, unknown> } {
  const artifact = requireArtifact(artifacts, kind);
  if (artifact.value === null) throw new Error(`gate_evidence_json_required:${kind}`);
  return artifact as ParsedGateArtifact & { value: Record<string, unknown> };
}

type RequiredProductionGateContext = Readonly<{
  releaseGenerationId: string;
  artifactRootFingerprintSha256: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  task0bReleaseFreezeSha256: string;
  productionDatabaseIdentityFingerprintSha256: string;
}>;

function requireProductionBindingContext(expected: GateEvidenceBindingContextV2): RequiredProductionGateContext {
  if (typeof expected.releaseGenerationId !== "string" || !GENERATION.test(expected.releaseGenerationId)
      || typeof expected.artifactRootFingerprintSha256 !== "string"
      || !SHA256.test(expected.artifactRootFingerprintSha256)
      || typeof expected.releaseFreezeIdentitySha256 !== "string"
      || !SHA256.test(expected.releaseFreezeIdentitySha256)
      || typeof expected.sourceManifestSha256 !== "string" || !SHA256.test(expected.sourceManifestSha256)
      || typeof expected.task0bReleaseFreezeSha256 !== "string" || !SHA256.test(expected.task0bReleaseFreezeSha256)
      || typeof expected.productionDatabaseIdentityFingerprintSha256 !== "string"
      || !SHA256.test(expected.productionDatabaseIdentityFingerprintSha256)) {
    throw new Error("production_gate_binding_context_incomplete");
  }
  return expected as RequiredProductionGateContext;
}

function validateOperationalGateAttestation(
  gate: ExecutedReleaseGateV2,
  artifact: ParsedGateArtifact & { value: Record<string, unknown> },
  expected: RequiredProductionGateContext
): void {
  const wantedAction = {
    G12_PRODUCTION_BACKUP: "g12_backup_passed",
    G13_PRODUCTION_MIGRATION: "g13_migration_passed",
    G14_PRODUCTION_ROLLOUT: "g14_rollout_passed",
    G15_PRODUCTION_CANARY: "g15_canary_released"
  } as const;
  const value = artifact.value;
  if (value.action !== wantedAction[gate.id as ProductionGateIdV2]
      || value.candidateSha !== gate.candidateSha
      || value.generationId !== expected.releaseGenerationId
      || value.artifactRootFingerprintSha256 !== expected.artifactRootFingerprintSha256
      || value.releaseFreezeIdentitySha256 !== expected.releaseFreezeIdentitySha256
      || value.sourceManifestSha256 !== expected.sourceManifestSha256
      || value.commandId !== gate.commandId || value.redactedTemplateSha256 !== gate.redactedTemplateSha256) {
    throw new Error("production_gate_attestation_binding_invalid");
  }
}

function validateG12Bindings(
  gate: ExecutedReleaseGateV2,
  artifacts: ReadonlyMap<GateEvidenceKindV2, ParsedGateArtifact>,
  expected: RequiredProductionGateContext
): void {
  const attestation = requireJsonArtifact(artifacts, "operational_attestation");
  const authority = requireJsonArtifact(artifacts, "production_backup_authority");
  const consumption = requireJsonArtifact(artifacts, "production_backup_consumption");
  const dumpProgress = requireJsonArtifact(artifacts, "production_backup_dump_progress");
  const listProgress = requireJsonArtifact(artifacts, "production_backup_list_progress");
  const dump = requireArtifact(artifacts, "production_backup_dump");
  const restoreList = requireArtifact(artifacts, "production_backup_restore_list");
  const evidence = requireJsonArtifact(artifacts, "production_backup_evidence");
  validateOperationalGateAttestation(gate, attestation, expected);
  const common = ["generationId", "candidateSha", "databaseIdentityFingerprintSha256",
    "artifactRootFingerprintSha256", "expiresAt"] as const;
  if (authority.value.generationId !== expected.releaseGenerationId
      || authority.value.candidateSha !== gate.candidateSha
      || authority.value.releaseManifestSha256 !== expected.sourceManifestSha256
      || authority.value.artifactRootFingerprintSha256 !== expected.artifactRootFingerprintSha256
      || authority.value.task0bEvidenceSha256 !== expected.task0bReleaseFreezeSha256
      || authority.value.databaseIdentityFingerprintSha256
        !== expected.productionDatabaseIdentityFingerprintSha256
      || authority.value.commandTemplateSha256 !== attestation.value.redactedTemplateSha256
      || consumption.value.authoritySha256 !== authority.ref.sha256
      || consumption.value.generationId !== expected.releaseGenerationId
      || consumption.value.candidateSha !== gate.candidateSha
      || consumption.value.artifactRootFingerprintSha256 !== expected.artifactRootFingerprintSha256
      || common.some((key) => dumpProgress.value[key] !== consumption.value[key])
      || common.some((key) => listProgress.value[key] !== consumption.value[key])
      || dumpProgress.value.authoritySha256 !== consumption.value.authoritySha256
      || listProgress.value.authoritySha256 !== consumption.value.authoritySha256
      || dumpProgress.value.claimSha256 !== consumption.ref.sha256
      || listProgress.value.claimSha256 !== consumption.ref.sha256
      || listProgress.value.operationId !== dumpProgress.value.operationId
      || listProgress.value.dumpProgressSha256 !== dumpProgress.ref.sha256
      || dumpProgress.value.backupBytes !== dump.bytes.length
      || dumpProgress.value.backupSha256 !== dump.ref.sha256
      || listProgress.value.restoreListBytes !== restoreList.bytes.length
      || listProgress.value.restoreListSha256 !== restoreList.ref.sha256
      || evidence.value.candidateSha !== gate.candidateSha
      || evidence.value.redactedTemplateSha256 !== attestation.value.redactedTemplateSha256
      || evidence.value.databaseIdentityFingerprintSha256 !== consumption.value.databaseIdentityFingerprintSha256
      || evidence.value.backupBytes !== dump.bytes.length || evidence.value.backupSha256 !== dump.ref.sha256
      || evidence.value.backupPathFingerprintSha256 !== dumpProgress.value.backupPathFingerprintSha256
      || evidence.value.restoreListBytes !== restoreList.bytes.length
      || evidence.value.restoreListSha256 !== restoreList.ref.sha256
      || evidence.value.restoreListEntryCount !== listProgress.value.restoreListEntryCount) {
    throw new Error("production_backup_artifact_binding_invalid");
  }
}

function validateG13Bindings(
  gate: ExecutedReleaseGateV2,
  artifacts: ReadonlyMap<GateEvidenceKindV2, ParsedGateArtifact>,
  expected: RequiredProductionGateContext
): void {
  const attestation = requireJsonArtifact(artifacts, "operational_attestation");
  const authority = requireJsonArtifact(artifacts, "production_migration_authority");
  const consumption = requireJsonArtifact(artifacts, "production_migration_consumption");
  const receipt = requireJsonArtifact(artifacts, "production_migration_sequence");
  validateOperationalGateAttestation(gate, attestation, expected);
  if (authority.value.generationId !== expected.releaseGenerationId
      || authority.value.candidateSha !== gate.candidateSha
      || authority.value.commandTemplateSha256 !== attestation.value.redactedTemplateSha256
      || authority.value.releaseManifestSha256 !== expected.sourceManifestSha256
      || authority.value.task0bEvidenceSha256 !== expected.task0bReleaseFreezeSha256
      || authority.value.databaseIdentityFingerprintSha256
        !== expected.productionDatabaseIdentityFingerprintSha256
      || consumption.value.generationId !== authority.value.generationId
      || consumption.value.authoritySha256 !== authority.ref.sha256
      || consumption.value.candidateSha !== authority.value.candidateSha
      || consumption.value.databaseIdentityFingerprintSha256 !== authority.value.databaseIdentityFingerprintSha256
      || consumption.value.resumeExpiresAt !== authority.value.expiresAt
      || receipt.value.candidateSha !== gate.candidateSha
      || receipt.value.releaseFreezeIdentitySha256 !== expected.releaseFreezeIdentitySha256
      || receipt.value.operationalAttestationSha256 !== authority.ref.sha256
      || receipt.value.authorityConsumptionSha256 !== consumption.ref.sha256
      || receipt.value.sourceManifestSha256 !== expected.sourceManifestSha256
      || receipt.value.productionBackupEvidenceSha256 !== authority.value.backupEvidenceSha256) {
    throw new Error("production_migration_artifact_binding_invalid");
  }
}

function validateG14G15Bindings(
  gate: ExecutedReleaseGateV2,
  artifacts: ReadonlyMap<GateEvidenceKindV2, ParsedGateArtifact>,
  expected: RequiredProductionGateContext
): void {
  const attestation = requireJsonArtifact(artifacts, "operational_attestation");
  const claim = requireJsonArtifact(artifacts, "production_operation_claim");
  const settlement = requireJsonArtifact(artifacts, "production_operation_settlement");
  const preparedRemoval = requireJsonArtifact(artifacts, "production_operation_lease_removal_prepared");
  const removal = requireJsonArtifact(artifacts, "production_operation_lease_removal");
  const cleanup = requireJsonArtifact(artifacts, "production_operation_cleanup");
  validateOperationalGateAttestation(gate, attestation, expected);
  const rollout = gate.id === "G14_PRODUCTION_ROLLOUT";
  const orchestration = requireJsonArtifact(artifacts,
    rollout ? "production_rollout_orchestration" : "production_canary_orchestration");
  const evidence = requireJsonArtifact(artifacts,
    rollout ? "production_rollout_evidence" : "production_canary_evidence");
  const operationKind = rollout ? "rollout" : "canary";
  if (claim.value.operationKind !== operationKind || settlement.value.operationKind !== operationKind
      || claim.value.candidateSha !== gate.candidateSha || settlement.value.candidateSha !== gate.candidateSha
      || claim.value.releaseGenerationId !== expected.releaseGenerationId
      || settlement.value.releaseGenerationId !== expected.releaseGenerationId
      || claim.value.sourceManifestSha256 !== expected.sourceManifestSha256
      || settlement.value.sourceManifestSha256 !== expected.sourceManifestSha256
      || claim.value.artifactRootFingerprintSha256 !== expected.artifactRootFingerprintSha256
      || claim.value.operationalAttestationSha256 !== attestation.ref.sha256
      || settlement.value.claimSha256 !== claim.ref.sha256
      || settlement.value.authorityConsumptionSha256 !== claim.value.authorityConsumptionSha256
      || settlement.value.orchestrationReceiptSha256 !== orchestration.ref.sha256
      || settlement.value.terminalEvidenceSha256 !== evidence.ref.sha256
      || preparedRemoval.value.terminalStateSha256 !== settlement.ref.sha256
      || preparedRemoval.value.canonicalRemovalReceiptSha256 !== removal.ref.sha256
      || removal.value.terminalStateSha256 !== settlement.ref.sha256
      || cleanup.value.terminalStateSha256 !== settlement.ref.sha256
      || cleanup.value.preparedRemovalSha256 !== preparedRemoval.ref.sha256
      || cleanup.value.leaseRemovalReceiptSha256 !== removal.ref.sha256
      || orchestration.value.operationClaimSha256 !== claim.ref.sha256
      || orchestration.value.operationalAttestationConsumptionSha256 !== claim.value.authorityConsumptionSha256
      || orchestration.value.sourceManifestSha256 !== expected.sourceManifestSha256
      || orchestration.value.releaseGenerationId !== expected.releaseGenerationId
      || evidence.value.releaseFreezeIdentitySha256 !== expected.releaseFreezeIdentitySha256) {
    throw new Error("production_operation_artifact_binding_invalid");
  }
  validateProductionNestedGateEvidenceV2({
    gateId: gate.id as "G14_PRODUCTION_ROLLOUT" | "G15_PRODUCTION_CANARY",
    evidence: evidence.value,
    managerCaptures: rollout ? requireJsonArtifact(artifacts, "production_rollout_manager").value : undefined,
    queryCaptures: requireJsonArtifact(artifacts,
      rollout ? "production_rollout_queries" : "production_canary_queries").value,
    logCaptures: rollout ? undefined : requireJsonArtifact(artifacts, "production_canary_logs").value,
    orchestrationReceipt: orchestration.value
  });
}

function validateProductionGateBindings(
  gate: ExecutedReleaseGateV2,
  artifacts: ReadonlyMap<GateEvidenceKindV2, ParsedGateArtifact>,
  expectedValue: GateEvidenceBindingContextV2
): void {
  const expected = requireProductionBindingContext(expectedValue);
  if (gate.id === "G12_PRODUCTION_BACKUP") validateG12Bindings(gate, artifacts, expected);
  else if (gate.id === "G13_PRODUCTION_MIGRATION") validateG13Bindings(gate, artifacts, expected);
  else if (gate.id === "G14_PRODUCTION_ROLLOUT" || gate.id === "G15_PRODUCTION_CANARY") {
    validateG14G15Bindings(gate, artifacts, expected);
  }
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
  const artifacts = new Map<GateEvidenceKindV2, ParsedGateArtifact>();
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
    const value = validateTypedEvidence(ref, bytes);
    artifacts.set(ref.kind, { ref, bytes, value });
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
  if (gatePolicy.production) validateProductionGateBindings(gate, artifacts, expected);
  return gate.evidence;
}
