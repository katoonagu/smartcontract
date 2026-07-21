import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256,
  TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256,
  TASK0B_READ_ONLY_OPERATION_IDS,
  TASK0B_REVALIDATION_READ_ONLY_OPERATION_IDS,
  assertNoSecretLikeArtifactValues,
  validateTask0BReleaseFreezeEvidence,
  validateTask0BReleaseRevalidationEvidence,
  type Task0BReleaseFreezeEvidenceV1,
  type Task0BReleaseRevalidationEvidenceV1
} from "../src/release/remediationReleaseManifest";
import { validateControlledRuntimeOperationalConfig } from "./rehearseRemediationRuntime";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  verifyRequiredSchema032
} from "../src/storage/schemaMigrations";
import {
  validateRuntimeTopologySnapshotV2,
  type RuntimeTopologySnapshotV2
} from "../src/release/runtimeEffectReconciliationV2";
import { canonicalReleaseJsonV2 } from "../src/release/remediationReleaseManifestV2";
import { readCurrentVerifiedReleaseFreezeV2 } from "../src/release/releaseManifestStoreV2";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const APPROVED_SCHEMA_032_CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
const CONFIG_FILENAME = "task0b-preflight-config.json";
const EVIDENCE_FILENAME = "task0b-release-freeze.json";
const REVALIDATION_DIRECTORY = "task0b-revalidations";
const MAX_CONFIG_BYTES = 64 * 1024;
export const TASK0B_RUNTIME_ENTRYPOINT_PROCESS_PATTERN_V2 = "src[\\\\/]index\\.ts";
const LEGACY_031_WALLET_APPROVAL_COLUMNS = [
  "watched_wallet_id", "token_contract", "spender_address", "amount_raw", "is_unlimited", "current_allowance_raw",
  "spender_type", "status", "last_approval_tx_hash", "last_approval_at", "risk_level", "risk_score", "risk_reasons",
  "last_alerted_tx_hash", "updated_at"
] as const;
const LEGACY_031_POISONING_COLUMNS = [
  "poisoning_check_status", "poisoning_attempts", "poisoning_next_retry_at", "poisoning_logical_offset",
  "poisoning_page_count", "poisoning_fetched_count", "poisoning_oldest_fetched_at", "poisoning_lookup_coverage",
  "poisoning_accumulated_lookup_json", "poisoning_last_error", "poisoning_updated_at", "poisoning_checked_at"
] as const;
const SCHEMA_032_ALLOWANCE_COLUMNS = [
  "allowance_confirmed_raw", "allowance_check_status", "allowance_checked_at", "allowance_fresh_until",
  "allowance_last_attempt_at", "allowance_failure_code"
] as const;
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

type SanitizedBinding = Pick<Task0BReleaseFreezeEvidenceV1,
  | "databaseRole" | "databaseName" | "databaseFingerprintSha256"
  | "operationalConfigPath" | "operationalConfigSha256"
  | "candidateStartCommandId" | "candidateStartTemplateSha256"
  | "candidateStopCommandId" | "candidateStopTemplateSha256"
  | "previousStartCommandId" | "previousStartTemplateSha256"
  | "previousStopCommandId" | "previousStopTemplateSha256">;

export type Task0BPreflightConfigV1 = {
  version: "task0b-preflight-config-v1";
  source: "operator_approved_external_preflight_config";
  issuedAt: string;
  expiresAt: string;
  candidateSha: string;
  previousRuntimeSha: string;
  previousRuntimeLabel: string;
  previousRuntimeIdentity: {
    evidencePath: string;
    evidenceSha256: string;
  };
  databaseConnectionEnvName: "TASK0B_PRODUCTION_DATABASE_URL";
  productionDatabaseExpected: {
    databaseName: "tron_watch";
    endpointHost: "127.0.0.1";
    endpointPort: number;
    connectedServerPort: number;
    systemIdentifier: string;
    databaseOid: string;
    serverVersionNum: string;
    identityFingerprintSha256: string;
  };
  rollbackWorktreePath: string;
  artifactRoot: string;
  candidatePort: { host: "127.0.0.1"; port: number };
  postgresToolProvider: { kind: "docker_pinned_image"; immutableImageId: string; networkMode: "none"; pullAllowed: false };
  runtimeManager: Task0BReleaseFreezeEvidenceV1["runtimeManager"];
  sanitizedRehearsal: SanitizedBinding;
};

export type Task0BReadOnlyCaptureDependencies = {
  now(): Date;
  readOperatorConfigBinding(): Promise<Task0BReleaseFreezeEvidenceV1["operatorConfig"]>;
  readCandidateState(): Promise<{
    sha: string;
    clean: boolean;
    worktreePathFingerprintSha256: string;
    source: "git_direct_read";
  }>;
  readPreviousRuntime(): Promise<{
    sha: string;
    label: string;
    source: "runtime_manager_attestation_and_process_direct_read";
    verified: boolean;
    identity: Task0BReleaseFreezeEvidenceV1["previousRuntimeIdentity"];
  }>;
  readSanitizedRehearsalBinding(): Promise<SanitizedBinding>;
  readRuntimeManager(): Promise<Task0BReleaseFreezeEvidenceV1["runtimeManager"]>;
  readProductionDatabase(): Promise<Task0BReleaseFreezeEvidenceV1["productionDatabase"]>;
  readRollbackWorktree(): Promise<Task0BReleaseFreezeEvidenceV1["rollbackWorktree"]>;
  readPostgresTools(): Promise<Task0BReleaseFreezeEvidenceV1["postgresTools"]>;
  inspectArtifactRoot(): Promise<Task0BReleaseFreezeEvidenceV1["artifactRoot"]>;
  probeCandidatePort(): Promise<Task0BReleaseFreezeEvidenceV1["candidatePort"]>;
};

export type Task0BRevalidationDependencies = Omit<Task0BReadOnlyCaptureDependencies, "readOperatorConfigBinding">;

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_invalid`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_shape_invalid`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}_invalid`);
  return value;
}

function sha(value: unknown, pattern: RegExp, label: string): string {
  const result = string(value, label);
  if (!pattern.test(result)) throw new Error(`${label}_invalid`);
  return result;
}

function assertAllowedRuntimeManager(value: unknown): Task0BReleaseFreezeEvidenceV1["runtimeManager"] {
  const manager = record(value, "task0b_config_runtime_manager");
  exactKeys(manager, [
    "source", "executorPath", "executorSha256", "producerId", "candidateAdminUrl", "candidateAdminUrlFingerprintSha256",
    "startCandidateCommandId", "startCandidateTemplateSha256", "stopCandidateCommandId", "stopCandidateTemplateSha256", "stopPreviousCommandId",
    "stopPreviousTemplateSha256", "rollbackPreviousCommandId", "rollbackPreviousTemplateSha256", "verified"
  ], "task0b_config_runtime_manager");
  if (manager.source !== "repo_owned_runtime_manager_registry_verified" || manager.verified !== true
      || manager.executorPath !== "scripts/manageTask0BRuntime.ts"
      || !SHA256.test(String(manager.executorSha256))
      || manager.producerId !== "task0b_repo_runtime_manager_v1"
      || typeof manager.candidateAdminUrl !== "string"
      || !SHA256.test(String(manager.candidateAdminUrlFingerprintSha256))
      || hash(manager.candidateAdminUrl) !== manager.candidateAdminUrlFingerprintSha256
      || manager.startCandidateCommandId !== "runtime_manager_start_candidate"
      || manager.startCandidateTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_start_candidate
      || manager.stopCandidateCommandId !== "runtime_manager_stop_candidate"
      || manager.stopCandidateTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_stop_candidate
      || manager.stopPreviousCommandId !== "runtime_manager_stop_previous"
      || manager.stopPreviousTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_stop_previous
      || manager.rollbackPreviousCommandId !== "runtime_manager_rollback_previous"
      || manager.rollbackPreviousTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_rollback_previous) {
    throw new Error("task0b_config_runtime_manager_unverified");
  }
  let candidateAdminUrl: URL;
  try { candidateAdminUrl = new URL(manager.candidateAdminUrl as string); }
  catch { throw new Error("task0b_config_runtime_manager_unverified"); }
  if (candidateAdminUrl.protocol !== "http:" || candidateAdminUrl.hostname !== "127.0.0.1" || !candidateAdminUrl.port
      || candidateAdminUrl.pathname !== "/" || candidateAdminUrl.search || candidateAdminUrl.hash
      || candidateAdminUrl.username || candidateAdminUrl.password) throw new Error("task0b_config_runtime_manager_unverified");
  return manager as Task0BReleaseFreezeEvidenceV1["runtimeManager"];
}

function assertSanitizedBinding(value: unknown): SanitizedBinding {
  const binding = record(value, "task0b_config_sanitized_rehearsal");
  exactKeys(binding, [
    "databaseRole", "databaseName", "databaseFingerprintSha256", "operationalConfigPath", "operationalConfigSha256",
    "candidateStartCommandId", "candidateStartTemplateSha256", "candidateStopCommandId", "candidateStopTemplateSha256",
    "previousStartCommandId", "previousStartTemplateSha256", "previousStopCommandId", "previousStopTemplateSha256"
  ], "task0b_config_sanitized_rehearsal");
  if (binding.databaseRole !== "runtime_sanitized" || binding.databaseName !== "tron_watch_plan5_runtime_sanitized"
      || !SHA256.test(String(binding.databaseFingerprintSha256)) || binding.operationalConfigPath !== "runtime-operational-config.json"
      || !SHA256.test(String(binding.operationalConfigSha256))
      || binding.candidateStartCommandId !== "runtime_sanitized_rehearsal"
      || binding.candidateStartTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal
      || binding.candidateStopCommandId !== "runtime_sanitized_stop"
      || binding.candidateStopTemplateSha256 !== REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop
      || binding.previousStartCommandId !== "rollback_rehearsal"
      || binding.previousStartTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal
      || binding.previousStopCommandId !== "rollback_stop"
      || binding.previousStopTemplateSha256 !== REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop) {
    throw new Error("task0b_config_sanitized_rehearsal_unverified");
  }
  return binding as SanitizedBinding;
}

function assertPostgresToolProvider(value: unknown): Task0BPreflightConfigV1["postgresToolProvider"] {
  const provider = record(value, "task0b_config_postgres_tool_provider");
  if (provider.kind === "docker_pinned_image") {
    exactKeys(provider, ["kind", "immutableImageId", "networkMode", "pullAllowed"], "task0b_config_postgres_tool_provider");
    if (!/^sha256:[0-9a-f]{64}$/.test(String(provider.immutableImageId))
        || provider.networkMode !== "none" || provider.pullAllowed !== false) {
      throw new Error("task0b_config_postgres_tool_provider_unverified");
    }
    return provider as Task0BPreflightConfigV1["postgresToolProvider"];
  }
  throw new Error("task0b_config_postgres_tool_provider_unverified");
}

type ExpectedProductionDatabase = Task0BPreflightConfigV1["productionDatabaseExpected"];

export function buildTask0BProductionDatabaseIdentityFingerprint(
  value: Omit<ExpectedProductionDatabase, "identityFingerprintSha256">
): string {
  return hash(JSON.stringify([
    value.databaseName,
    value.endpointHost,
    value.endpointPort,
    value.connectedServerPort,
    value.systemIdentifier,
    value.databaseOid,
    value.serverVersionNum
  ]));
}

function assertExpectedProductionDatabase(value: unknown): ExpectedProductionDatabase {
  const expected = record(value, "task0b_config_production_database_expected");
  exactKeys(expected, [
    "databaseName", "endpointHost", "endpointPort", "connectedServerPort", "systemIdentifier", "databaseOid",
    "serverVersionNum", "identityFingerprintSha256"
  ], "task0b_config_production_database_expected");
  if (expected.databaseName !== "tron_watch" || expected.endpointHost !== "127.0.0.1"
      || !Number.isSafeInteger(expected.endpointPort) || (expected.endpointPort as number) < 1
      || (expected.endpointPort as number) > 65_535
      || !Number.isSafeInteger(expected.connectedServerPort) || (expected.connectedServerPort as number) < 1
      || (expected.connectedServerPort as number) > 65_535
      || !/^\d+$/.test(String(expected.systemIdentifier)) || !/^\d+$/.test(String(expected.databaseOid))
      || !/^\d{5,6}$/.test(String(expected.serverVersionNum))) {
    throw new Error("task0b_config_production_database_expected_unverified");
  }
  const normalized = expected as unknown as ExpectedProductionDatabase;
  if (!SHA256.test(String(expected.identityFingerprintSha256))
      || buildTask0BProductionDatabaseIdentityFingerprint(normalized) !== expected.identityFingerprintSha256) {
    throw new Error("task0b_config_production_database_expected_unverified");
  }
  return normalized;
}

function assertPreviousRuntimeIdentityConfig(
  value: unknown
): Task0BPreflightConfigV1["previousRuntimeIdentity"] {
  const identity = record(value, "task0b_config_previous_runtime_identity");
  exactKeys(identity, ["evidencePath", "evidenceSha256"], "task0b_config_previous_runtime_identity");
  if (typeof identity.evidencePath !== "string"
      || !/^runtime-start-evidence-[a-z0-9][a-z0-9-]{15,63}\.json$/u.test(identity.evidencePath)
      || !SHA256.test(String(identity.evidenceSha256))) {
    throw new Error("task0b_config_previous_runtime_identity_unverified");
  }
  return identity as Task0BPreflightConfigV1["previousRuntimeIdentity"];
}

export function validateTask0BPreflightConfig(value: unknown, evaluatedAt = new Date().toISOString()): Task0BPreflightConfigV1 {
  assertNoSecretLikeArtifactValues(value);
  const config = record(value, "task0b_preflight_config");
  exactKeys(config, [
    "version", "source", "issuedAt", "expiresAt", "candidateSha", "previousRuntimeSha", "previousRuntimeLabel", "databaseConnectionEnvName",
    "previousRuntimeIdentity", "productionDatabaseExpected", "rollbackWorktreePath", "artifactRoot", "candidatePort", "postgresToolProvider", "runtimeManager",
    "sanitizedRehearsal"
  ], "task0b_preflight_config");
  const candidateSha = sha(config.candidateSha, SHA40, "task0b_config_candidate_sha");
  const previousRuntimeSha = sha(config.previousRuntimeSha, SHA40, "task0b_config_previous_sha");
  const previousRuntimeLabel = string(config.previousRuntimeLabel, "task0b_config_previous_label");
  const issuedAt = new Date(string(config.issuedAt, "task0b_config_issued_at"));
  const expiresAt = new Date(string(config.expiresAt, "task0b_config_expires_at"));
  const evaluated = new Date(evaluatedAt);
  const candidatePort = record(config.candidatePort, "task0b_config_candidate_port");
  exactKeys(candidatePort, ["host", "port"], "task0b_config_candidate_port");
  if (!Number.isFinite(issuedAt.getTime()) || issuedAt.toISOString() !== config.issuedAt
      || !Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== config.expiresAt
      || !Number.isFinite(evaluated.getTime()) || evaluated.toISOString() !== evaluatedAt
      || evaluated < issuedAt || evaluated > expiresAt || expiresAt.getTime() - issuedAt.getTime() > 15 * 60_000
      || config.version !== "task0b-preflight-config-v1" || config.source !== "operator_approved_external_preflight_config"
      || candidateSha === previousRuntimeSha || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(previousRuntimeLabel)
      || !previousRuntimeLabel.includes(previousRuntimeSha.slice(0, 8))
      || config.databaseConnectionEnvName !== "TASK0B_PRODUCTION_DATABASE_URL"
      || !isAbsolute(string(config.rollbackWorktreePath, "task0b_config_rollback_worktree"))
      || !isAbsolute(string(config.artifactRoot, "task0b_config_artifact_root"))
      || candidatePort.host !== "127.0.0.1" || !Number.isSafeInteger(candidatePort.port)
      || (candidatePort.port as number) < 1 || (candidatePort.port as number) > 65_535) {
    throw new Error("task0b_preflight_config_unverified");
  }
  const runtimeManager = assertAllowedRuntimeManager(config.runtimeManager);
  if (Number(new URL(runtimeManager.candidateAdminUrl).port) !== candidatePort.port) {
    throw new Error("task0b_config_candidate_admin_port_mismatch");
  }
  assertPreviousRuntimeIdentityConfig(config.previousRuntimeIdentity);
  assertExpectedProductionDatabase(config.productionDatabaseExpected);
  assertPostgresToolProvider(config.postgresToolProvider);
  assertSanitizedBinding(config.sanitizedRehearsal);
  return config as Task0BPreflightConfigV1;
}

export async function captureTask0BReleaseFreezeEvidence(
  dependencies: Task0BReadOnlyCaptureDependencies
): Promise<Task0BReleaseFreezeEvidenceV1> {
  const operationIds: string[] = [];
  const observedAt = dependencies.now().toISOString();
  operationIds.push("operator_config_read");
  const operatorConfig = await dependencies.readOperatorConfigBinding();
  const configExpiresAtMs = Date.parse(operatorConfig.configExpiresAt);
  if (!Number.isFinite(configExpiresAtMs) || configExpiresAtMs < Date.parse(observedAt)) {
    throw new Error("task0b_operator_config_stale");
  }
  operationIds.push("candidate_state_read_before");
  const candidateBefore = await dependencies.readCandidateState();
  if (!SHA40.test(candidateBefore.sha) || candidateBefore.clean !== true
      || !SHA256.test(candidateBefore.worktreePathFingerprintSha256) || candidateBefore.source !== "git_direct_read") {
    throw new Error("task0b_candidate_worktree_unverified");
  }
  const candidateSha = candidateBefore.sha;
  operationIds.push("previous_runtime_read_before");
  const previous = await dependencies.readPreviousRuntime();
  if (previous.source !== "runtime_manager_attestation_and_process_direct_read" || previous.verified !== true
      || !previous.identity || previous.identity.runtimeSha !== previous.sha || previous.identity.runtimeLabel !== previous.label) {
    throw new Error("task0b_previous_runtime_source_unverified");
  }
  operationIds.push("sanitized_runtime_binding_read");
  const sanitized = assertSanitizedBinding(await dependencies.readSanitizedRehearsalBinding());
  operationIds.push("runtime_manager_registry_read");
  const runtimeManager = await dependencies.readRuntimeManager();
  operationIds.push("production_database_read_only");
  const productionDatabase = await dependencies.readProductionDatabase();
  operationIds.push("rollback_worktree_read");
  const rollbackWorktree = await dependencies.readRollbackWorktree();
  operationIds.push("postgres_tools_read_only");
  const postgresTools = await dependencies.readPostgresTools();
  operationIds.push("artifact_root_probe");
  const artifactRoot = await dependencies.inspectArtifactRoot();
  operationIds.push("candidate_port_probe");
  const candidatePort = await dependencies.probeCandidatePort();
  operationIds.push("candidate_state_read_after");
  const candidateAfter = await dependencies.readCandidateState();
  if (candidateAfter.sha !== candidateSha || candidateAfter.clean !== true
      || candidateAfter.worktreePathFingerprintSha256 !== candidateBefore.worktreePathFingerprintSha256
      || candidateAfter.source !== "git_direct_read") {
    throw new Error("task0b_candidate_worktree_changed");
  }
  operationIds.push("previous_runtime_read_after");
  const previousAfter = await dependencies.readPreviousRuntime();
  if (previousAfter.source !== "runtime_manager_attestation_and_process_direct_read" || previousAfter.verified !== true
      || hash(JSON.stringify(previousAfter)) !== hash(JSON.stringify(previous))) {
    throw new Error("task0b_previous_runtime_changed");
  }
  if (previous.identity.workingDirectoryFingerprintSha256 !== rollbackWorktree.worktreePathFingerprintSha256
      || previous.identity.managerExecutableSha256 !== runtimeManager.executorSha256) {
    throw new Error("task0b_previous_runtime_binding_mismatch");
  }
  if (operationIds.length !== TASK0B_READ_ONLY_OPERATION_IDS.length
      || operationIds.some((operationId, index) => operationId !== TASK0B_READ_ONLY_OPERATION_IDS[index])) {
    throw new Error("task0b_read_only_operation_ledger_incomplete");
  }
  const forbiddenEffects = {
    runtimeStopCount: operationIds.filter((id) => id === "runtime_stop").length,
    runtimeStartCount: operationIds.filter((id) => id === "runtime_start").length,
    databaseMigrationCount: operationIds.filter((id) => id === "database_migration").length,
    telegramSendCount: operationIds.filter((id) => id === "telegram_send").length
  };
  if (Object.values(forbiddenEffects).some((count) => count !== 0)) throw new Error("task0b_forbidden_effect_observed");
  const observedEffects: Task0BReleaseFreezeEvidenceV1["observedEffects"] = {
    runtimeStopCount: forbiddenEffects.runtimeStopCount as 0,
    runtimeStartCount: forbiddenEffects.runtimeStartCount as 0,
    databaseMigrationCount: forbiddenEffects.databaseMigrationCount as 0,
    telegramSendCount: forbiddenEffects.telegramSendCount as 0,
    readOnlyOperationCount: operationIds.length,
    operationIds,
    operationSequenceSha256: hash(JSON.stringify(operationIds)),
    source: "instrumented_read_only_operation_ledger"
  };
  if (dependencies.now().getTime() > configExpiresAtMs) throw new Error("task0b_operator_config_stale");
  const expiresAt = new Date(Math.min(Date.parse(observedAt) + 15 * 60_000, configExpiresAtMs)).toISOString();
  const evidence: Task0BReleaseFreezeEvidenceV1 = {
    version: "task0b-release-freeze-evidence-v1",
    candidateSha,
    observedAt,
    freezeCutoff: observedAt,
    expiresAt,
    source: "task0b_direct_operational_preflight",
    operatorConfig,
    candidateWorktree: {
      headBeforeSha: candidateBefore.sha,
      headAfterSha: candidateAfter.sha,
      worktreePathFingerprintSha256: candidateBefore.worktreePathFingerprintSha256,
      cleanBefore: true,
      cleanAfter: true,
      source: "git_direct_read_before_and_after",
      verified: true
    },
    previousRuntimeSha: previous.sha,
    previousRuntimeLabel: previous.label,
    previousRuntimeSource: previous.source,
    previousRuntimeVerified: previous.verified as true,
    previousRuntimeIdentity: previous.identity,
    ...sanitized,
    runtimeManager,
    productionDatabase,
    rollbackWorktree,
    postgresTools,
    artifactRoot,
    candidatePort,
    observedEffects
  };
  validateTask0BReleaseFreezeEvidence(evidence, candidateSha, observedAt);
  return evidence;
}

export async function captureTask0BReleaseRevalidationEvidence(
  frozenValue: unknown,
  freezeValue: unknown,
  dependencies: Task0BRevalidationDependencies
): Promise<Task0BReleaseRevalidationEvidenceV1> {
  const frozen = validateTask0BReleaseFreezeEvidence(frozenValue);
  const operationIds: string[] = [];
  const observedAt = dependencies.now().toISOString();
  operationIds.push("candidate_state_read_before");
  const candidateBefore = await dependencies.readCandidateState();
  if (candidateBefore.sha !== frozen.candidateSha || candidateBefore.clean !== true
      || candidateBefore.worktreePathFingerprintSha256 !== frozen.candidateWorktree.worktreePathFingerprintSha256
      || candidateBefore.source !== "git_direct_read") {
    throw new Error("task0b_revalidation_candidate_worktree_unverified");
  }
  operationIds.push("previous_runtime_read_before");
  const previous = await dependencies.readPreviousRuntime();
  if (previous.sha !== frozen.previousRuntimeSha || previous.label !== frozen.previousRuntimeLabel
      || previous.source !== "runtime_manager_attestation_and_process_direct_read" || previous.verified !== true
      || canonicalReleaseJsonV2(previous.identity) !== canonicalReleaseJsonV2(frozen.previousRuntimeIdentity)) {
    throw new Error("task0b_revalidation_previous_runtime_unverified");
  }
  operationIds.push("sanitized_runtime_binding_read");
  const sanitized = assertSanitizedBinding(await dependencies.readSanitizedRehearsalBinding());
  operationIds.push("runtime_manager_registry_read");
  const runtimeManager = await dependencies.readRuntimeManager();
  operationIds.push("production_database_read_only");
  const productionDatabase = await dependencies.readProductionDatabase();
  operationIds.push("rollback_worktree_read");
  const rollbackWorktree = await dependencies.readRollbackWorktree();
  operationIds.push("postgres_tools_read_only");
  const postgresTools = await dependencies.readPostgresTools();
  operationIds.push("artifact_root_probe");
  const artifactRoot = await dependencies.inspectArtifactRoot();
  operationIds.push("candidate_port_probe");
  const candidatePort = await dependencies.probeCandidatePort();
  operationIds.push("candidate_state_read_after");
  const candidateAfter = await dependencies.readCandidateState();
  if (canonicalReleaseJsonV2(candidateAfter) !== canonicalReleaseJsonV2(candidateBefore)) {
    throw new Error("task0b_revalidation_candidate_worktree_changed");
  }
  operationIds.push("previous_runtime_read_after");
  const previousAfter = await dependencies.readPreviousRuntime();
  if (canonicalReleaseJsonV2(previousAfter) !== canonicalReleaseJsonV2(previous)) {
    throw new Error("task0b_revalidation_previous_runtime_changed");
  }
  if (operationIds.length !== TASK0B_REVALIDATION_READ_ONLY_OPERATION_IDS.length
      || operationIds.some((operationId, index) => operationId !== TASK0B_REVALIDATION_READ_ONLY_OPERATION_IDS[index])) {
    throw new Error("task0b_revalidation_operation_ledger_incomplete");
  }
  const observedEffects = {
    runtimeStopCount: 0 as const,
    runtimeStartCount: 0 as const,
    databaseMigrationCount: 0 as const,
    telegramSendCount: 0 as const,
    readOnlyOperationCount: operationIds.length,
    operationIds,
    operationSequenceSha256: hash(JSON.stringify(operationIds)),
    source: "instrumented_read_only_operation_ledger" as const
  };
  const evidence = {
    version: "task0b-release-revalidation-v1" as const,
    candidateSha: frozen.candidateSha,
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 15 * 60_000).toISOString(),
    source: "task0b_direct_post_freeze_revalidation" as const,
    task0BPreflightEvidenceSha256: hash(Buffer.from(`${canonicalReleaseJsonV2(frozen)}\n`, "utf8")),
    releaseGenerationId: String((freezeValue as Record<string, unknown>)?.releaseGenerationId ?? ""),
    releaseFreezeIdentitySha256: hash(Buffer.from(`${canonicalReleaseJsonV2(freezeValue)}\n`, "utf8")),
    current: {
      previousRuntimeSha: previous.sha,
      previousRuntimeLabel: previous.label,
      candidateWorktree: {
        headBeforeSha: candidateBefore.sha,
        headAfterSha: candidateAfter.sha,
        worktreePathFingerprintSha256: candidateBefore.worktreePathFingerprintSha256,
        cleanBefore: true as const,
        cleanAfter: true as const,
        source: "git_direct_read_before_and_after" as const,
        verified: true as const
      },
      previousRuntimeSource: previous.source,
      previousRuntimeVerified: true as const,
      previousRuntimeIdentity: previous.identity,
      ...sanitized,
      runtimeManager,
      productionDatabase,
      rollbackWorktree,
      postgresTools,
      artifactRoot,
      candidatePort,
      observedEffects
    }
  };
  if (dependencies.now().getTime() > Date.parse(evidence.expiresAt)) {
    throw new Error("task0b_revalidation_capture_stale");
  }
  return validateTask0BReleaseRevalidationEvidence(
    evidence,
    frozen,
    freezeValue,
    evidence.observedAt
  );
}

function run(
  executable: string,
  args: readonly string[],
  cwd?: string,
  extraEnv?: NodeJS.ProcessEnv,
  timeoutMs = 10_000
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(executable, [...args], {
      cwd,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs
    }, (error, stdout) => {
      if (error) reject(new Error("task0b_direct_probe_failed"));
      else resolvePromise(stdout.trim());
    });
  });
}

export type Task0BBoundedProbeOptions = Readonly<{
  hardDeadlineAt: string;
  configuredTimeoutMs: number;
  nowMs?: () => number;
}>;

export function task0BBoundedProbeTimeoutMs(options: Task0BBoundedProbeOptions): number {
  const deadlineMs = Date.parse(options.hardDeadlineAt);
  if (!Number.isFinite(deadlineMs) || !Number.isSafeInteger(options.configuredTimeoutMs)
      || options.configuredTimeoutMs < 1) throw new Error("task0b_probe_budget_invalid");
  const remainingMs = deadlineMs - (options.nowMs ?? Date.now)();
  if (remainingMs <= 0) throw new Error("task0b_probe_bound_reached");
  return Math.min(options.configuredTimeoutMs, remainingMs);
}

function task0BProbeTimeout(options: Task0BBoundedProbeOptions | undefined, fallbackMs = 10_000): number {
  return options === undefined ? fallbackMs : task0BBoundedProbeTimeoutMs(options);
}

type ProtectedPathAccess = {
  ownerIdentityFingerprintSha256: string;
  accessControlFingerprintSha256: string;
  accessControlSource: "windows_acl_direct_read" | "posix_mode_direct_read";
};

function canonicalPathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function sameCanonicalPath(left: string, right: string): boolean {
  return canonicalPathKey(left) === canonicalPathKey(right);
}

async function inspectProtectedPathAccess(path: string, strict = true): Promise<ProtectedPathAccess> {
  if (process.platform === "win32") {
    const raw = await run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$acl = Get-Acl -LiteralPath $env:TASK0B_ACL_PATH; $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; try { $owner = $acl.Owner.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $owner = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value }; $allowed = @($current, 'S-1-5-18', 'S-1-5-32-544'); $unsafe = 0; $rules = @($acl.Access | ForEach-Object { $sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; $rights = $_.FileSystemRights.ToString(); $strictWrites = $rights -match 'Write|Modify|FullControl|CreateFiles|CreateDirectories|AppendData|Delete|ChangePermissions|TakeOwnership'; $ancestorTakeover = $rights -match 'Modify|FullControl|Delete|ChangePermissions|TakeOwnership'; $unsafeRule = $_.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid -and (($env:TASK0B_ACL_STRICT -eq '1' -and $strictWrites) -or ($env:TASK0B_ACL_STRICT -ne '1' -and $ancestorTakeover)); if ($unsafeRule) { $unsafe++ }; \"$sid|$($_.AccessControlType)|$rights|$($_.IsInherited)\" } | Sort-Object); [pscustomobject]@{ currentSid = $current; ownerSid = $owner; unsafeWriteRuleCount = $unsafe; canonicalRules = ($rules -join ';') } | ConvertTo-Json -Compress"
    ], undefined, { TASK0B_ACL_PATH: path, TASK0B_ACL_STRICT: strict ? "1" : "0" });
    const observation = JSON.parse(raw) as Record<string, unknown>;
    if (typeof observation.currentSid !== "string" || (strict && observation.ownerSid !== observation.currentSid)
        || observation.unsafeWriteRuleCount !== 0 || typeof observation.canonicalRules !== "string") {
      throw new Error("task0b_path_access_unverified");
    }
    return {
      ownerIdentityFingerprintSha256: hash(observation.currentSid),
      accessControlFingerprintSha256: hash(observation.canonicalRules),
      accessControlSource: "windows_acl_direct_read"
    };
  }
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  const takeoverWritable = (metadata.mode & 0o022) !== 0 && (metadata.mode & 0o1000) === 0;
  if (currentUid === undefined || (strict && metadata.uid !== currentUid)
      || (strict ? (metadata.mode & 0o022) !== 0 : takeoverWritable)) {
    throw new Error("task0b_path_access_unverified");
  }
  return {
    ownerIdentityFingerprintSha256: hash(String(currentUid)),
    accessControlFingerprintSha256: hash(`${metadata.uid}:${metadata.gid}:${metadata.mode & 0o777}`),
    accessControlSource: "posix_mode_direct_read"
  };
}

export async function inspectProtectedPathChain(path: string): Promise<ProtectedPathAccess> {
  if (process.platform === "win32") {
    const raw = await run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed = @($current, 'S-1-5-18', 'S-1-5-32-544'); $path = [IO.Path]::GetFullPath($env:TASK0B_ACL_PATH); $index = 0; $unsafe = 0; $canonical = @(); $rootOwner = ''; while ($true) { $acl = Get-Acl -LiteralPath $path; try { $owner = $acl.Owner.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $owner = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value }; if ($index -eq 0) { $rootOwner = $owner }; $rules = @($acl.Access | ForEach-Object { $sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; $rights = $_.FileSystemRights.ToString(); $strictWrites = $rights -match 'Write|Modify|FullControl|CreateFiles|CreateDirectories|AppendData|Delete|ChangePermissions|TakeOwnership'; $ancestorTakeover = $rights -match 'Modify|FullControl|Delete|ChangePermissions|TakeOwnership'; $unsafeRule = $_.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid -and (($index -eq 0 -and $strictWrites) -or ($index -gt 0 -and $ancestorTakeover)); if ($unsafeRule) { $unsafe++ }; \"$sid|$($_.AccessControlType)|$rights|$($_.IsInherited)\" } | Sort-Object); $canonical += \"$path::$($rules -join ';')\"; $parent = [IO.Directory]::GetParent($path); if ($null -eq $parent) { break }; $path = $parent.FullName; $index++ }; [pscustomobject]@{ currentSid = $current; rootOwnerSid = $rootOwner; unsafeWriteRuleCount = $unsafe; canonicalChain = ($canonical -join '||') } | ConvertTo-Json -Compress"
    ], undefined, { TASK0B_ACL_PATH: path });
    const observation = JSON.parse(raw) as Record<string, unknown>;
    if (typeof observation.currentSid !== "string" || observation.rootOwnerSid !== observation.currentSid
        || observation.unsafeWriteRuleCount !== 0 || typeof observation.canonicalChain !== "string") {
      throw new Error("task0b_path_access_unverified");
    }
    return {
      ownerIdentityFingerprintSha256: hash(observation.currentSid),
      accessControlFingerprintSha256: hash(observation.canonicalChain),
      accessControlSource: "windows_acl_direct_read"
    };
  }
  const rootAccess = await inspectProtectedPathAccess(path, true);
  const ancestorFingerprints: string[] = [];
  let current = dirname(path);
  while (true) {
    const access = await inspectProtectedPathAccess(current, false);
    ancestorFingerprints.push(hash(`${canonicalPathKey(current)}:${access.accessControlFingerprintSha256}`));
    const parent = dirname(current);
    if (sameCanonicalPath(parent, current)) break;
    current = parent;
  }
  return {
    ownerIdentityFingerprintSha256: rootAccess.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: hash(JSON.stringify([
      rootAccess.accessControlFingerprintSha256,
      ...ancestorFingerprints
    ])),
    accessControlSource: rootAccess.accessControlSource
  };
}

function pathInside(parent: string, child: string): boolean {
  const delta = relative(parent, child);
  return delta === "" || (!delta.startsWith("..") && !isAbsolute(delta));
}

export async function inspectRealDirectory(path: string, mustBeOutsideRepository: boolean): Promise<string> {
  const requested = resolve(path);
  const metadata = await lstat(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("task0b_directory_invalid");
  const physical = resolve(await realpath(requested));
  if (!sameCanonicalPath(physical, requested)) throw new Error("task0b_directory_symlink_rejected");
  if (mustBeOutsideRepository && pathInside(repositoryRoot, physical)) throw new Error("task0b_artifact_root_inside_repository");
  if (mustBeOutsideRepository) await inspectProtectedPathChain(physical);
  return physical;
}

async function readProtectedRegularFileSnapshot(root: string, filename: string, maxBytes: number): Promise<{
  bytes: Buffer;
  fileIdentitySha256: string;
}> {
  if (!filename || filename.includes("/") || filename.includes("\\")) throw new Error("task0b_artifact_filename_invalid");
  const path = join(root, filename);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes
      || metadata.dev === undefined || metadata.ino === undefined) {
    throw new Error("task0b_artifact_file_invalid");
  }
  await inspectProtectedPathAccess(path, true);
  const physical = resolve(await realpath(path));
  if (!sameCanonicalPath(physical, path)) throw new Error("task0b_artifact_symlink_rejected");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== metadata.size || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw new Error("task0b_artifact_changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || bytes.length !== after.size) {
      throw new Error("task0b_artifact_changed");
    }
    return {
      bytes,
      fileIdentitySha256: hash(`${opened.dev}:${opened.ino}:${opened.size}:${opened.mtimeMs}:${opened.ctimeMs}`)
    };
  } finally {
    await handle.close();
  }
}

export async function readProtectedRegularFile(root: string, filename: string, maxBytes: number): Promise<Buffer> {
  return (await readProtectedRegularFileSnapshot(root, filename, maxBytes)).bytes;
}

export async function readExternalConfig(artifactRoot: string): Promise<{
  config: Task0BPreflightConfigV1;
  binding: Task0BReleaseFreezeEvidenceV1["operatorConfig"];
}> {
  const root = await inspectRealDirectory(artifactRoot, true);
  const snapshot = await readProtectedRegularFileSnapshot(root, CONFIG_FILENAME, MAX_CONFIG_BYTES);
  const config = validateTask0BPreflightConfig(JSON.parse(snapshot.bytes.toString("utf8")));
  return {
    config,
    binding: {
      filename: "task0b-preflight-config.json",
      contentSha256: hash(snapshot.bytes),
      fileIdentitySha256: snapshot.fileIdentitySha256,
      configExpiresAt: config.expiresAt,
      source: "protected_file_handle_direct_read",
      verified: true
    }
  };
}

async function readFrozenExternalConfig(
  artifactRoot: string,
  frozen: Task0BReleaseFreezeEvidenceV1
): Promise<Task0BPreflightConfigV1> {
  const root = await inspectRealDirectory(artifactRoot, true);
  const snapshot = await readProtectedRegularFileSnapshot(root, CONFIG_FILENAME, MAX_CONFIG_BYTES);
  const config = validateTask0BPreflightConfig(
    JSON.parse(snapshot.bytes.toString("utf8")),
    frozen.observedAt
  );
  if (hash(snapshot.bytes) !== frozen.operatorConfig.contentSha256
      || snapshot.fileIdentitySha256 !== frozen.operatorConfig.fileIdentitySha256
      || config.expiresAt !== frozen.operatorConfig.configExpiresAt) {
    throw new Error("task0b_revalidation_operator_config_binding_changed");
  }
  return config;
}

async function observeRollbackWorktree(config: Task0BPreflightConfigV1): Promise<Task0BReleaseFreezeEvidenceV1["rollbackWorktree"]> {
  const worktree = await inspectRealDirectory(config.rollbackWorktreePath, false);
  const [headSha, topLevel, worktreeCommonDir, repositoryCommonDir] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], worktree),
    run("git", ["rev-parse", "--show-toplevel"], worktree),
    run("git", ["rev-parse", "--git-common-dir"], worktree),
    run("git", ["rev-parse", "--git-common-dir"], repositoryRoot)
  ]);
  const status = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], worktree);
  const physicalTopLevel = resolve(await realpath(resolve(topLevel)));
  const physicalWorktreeCommon = resolve(await realpath(resolve(worktree, worktreeCommonDir)));
  const physicalRepositoryCommon = resolve(await realpath(resolve(repositoryRoot, repositoryCommonDir)));
  await run("git", ["merge-base", "--is-ancestor", config.previousRuntimeSha, config.candidateSha], worktree);
  if (!sameCanonicalPath(physicalTopLevel, worktree)
      || !sameCanonicalPath(physicalWorktreeCommon, physicalRepositoryCommon)
      || headSha !== config.previousRuntimeSha || status !== "") throw new Error("task0b_rollback_worktree_unverified");
  return {
    previousRuntimeSha: config.previousRuntimeSha,
    headSha,
    worktreePathFingerprintSha256: hash(canonicalPathKey(worktree)),
    clean: true,
    source: "git_direct_read",
    verified: true
  };
}

async function observeCandidateState(): Promise<{
  sha: string;
  clean: boolean;
  worktreePathFingerprintSha256: string;
  source: "git_direct_read";
}> {
  const [shaValue, status, topLevel] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], repositoryRoot),
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"], repositoryRoot),
    run("git", ["rev-parse", "--show-toplevel"], repositoryRoot)
  ]);
  const physicalTopLevel = resolve(await realpath(resolve(topLevel)));
  if (!SHA40.test(shaValue) || !sameCanonicalPath(physicalTopLevel, repositoryRoot)) {
    throw new Error("task0b_candidate_worktree_unverified");
  }
  return {
    sha: shaValue,
    clean: status === "",
    worktreePathFingerprintSha256: hash(canonicalPathKey(physicalTopLevel)),
    source: "git_direct_read"
  };
}

type Task0BRuntimeManagerStartEvidenceV1 = {
  version: "runtime-manager-start-evidence-v1";
  generationId: string;
  runtimeSha: string;
  runtimeLabel: string;
  processId: number;
  processStartedAt: string;
  commandLineSha256: string;
  executablePathSha256: string;
  workingDirectoryFingerprintSha256: string;
  entrypointPathFingerprintSha256: string;
  managerExecutableSha256: string;
  attestedAt: string;
  producerId: "task0b_repo_runtime_manager_v1";
  commandId: "runtime_manager_previous_identity";
  templateSha256: string;
  exitCode: 0;
};

type Task0BDirectRuntimeProcessObservation = {
  processId: number;
  processStartedAt: string;
  commandLineSha256: string;
  executablePathSha256: string;
  runtimeSha: string;
  runtimeLabel: string;
  workingDirectoryFingerprintSha256: string;
  entrypointPathFingerprintSha256: string;
  runtimeProcessCount: number;
};

function runtimeObservationSha256(value: Task0BDirectRuntimeProcessObservation): string {
  return hash(JSON.stringify([
    value.processId,
    value.processStartedAt,
    value.commandLineSha256,
    value.executablePathSha256,
    value.runtimeSha,
    value.runtimeLabel,
    value.workingDirectoryFingerprintSha256,
    value.entrypointPathFingerprintSha256,
    value.runtimeProcessCount
  ]));
}

export function parseTask0BManagedRuntimeCommand(commandLine: string): {
  runtimeSha: string;
  runtimeLabel: string;
  entrypointPath: string;
} {
  const shaMatches = [...commandLine.matchAll(/--task0b-runtime-sha=([0-9a-f]{40})(?=\s|$)/gu)];
  const labelMatches = [...commandLine.matchAll(/--task0b-runtime-label=([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?=\s|$)/gu)];
  const producerMatches = [...commandLine.matchAll(/--task0b-manager-producer=task0b_repo_runtime_manager_v1(?=\s|$)/gu)];
  const quotedEntrypoints = [...commandLine.matchAll(/"([^"]+[\\/]src[\\/]index\.ts)"/giu)];
  const plainEntrypoints = quotedEntrypoints.length === 0
    ? [...commandLine.matchAll(/\s([A-Za-z]:\\\S+[\\/]src[\\/]index\.ts)(?=\s|$)/giu)]
    : [];
  const entrypoints = quotedEntrypoints.length > 0 ? quotedEntrypoints : plainEntrypoints;
  const runtimeSha = shaMatches[0]?.[1];
  const runtimeLabel = labelMatches[0]?.[1];
  const entrypointPath = entrypoints[0]?.[1];
  if (shaMatches.length !== 1 || labelMatches.length !== 1 || producerMatches.length !== 1 || entrypoints.length !== 1
      || !runtimeSha || !runtimeLabel || !entrypointPath || !isAbsolute(entrypointPath)
      || !runtimeLabel.includes(runtimeSha.slice(0, 8))) {
    throw new Error("task0b_previous_runtime_command_binding_unverified");
  }
  return { runtimeSha, runtimeLabel, entrypointPath };
}

export function createTask0BRuntimeManagerStartEvidence(input: {
  observation: Task0BDirectRuntimeProcessObservation;
  generationId: string;
  runtimeSha: string;
  runtimeLabel: string;
  managerExecutableSha256: string;
  attestedAt: string;
}): Task0BRuntimeManagerStartEvidenceV1 {
  const attestedAt = new Date(input.attestedAt);
  const startedAt = new Date(input.observation.processStartedAt);
  if (!/^[a-z0-9][a-z0-9-]{15,63}$/u.test(input.generationId)
      || !SHA40.test(input.runtimeSha) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.runtimeLabel)
      || !input.runtimeLabel.includes(input.runtimeSha.slice(0, 8))
      || input.observation.runtimeSha !== input.runtimeSha || input.observation.runtimeLabel !== input.runtimeLabel
      || !Number.isSafeInteger(input.observation.processId) || input.observation.processId < 1
      || input.observation.runtimeProcessCount !== 1 || !SHA256.test(input.managerExecutableSha256)
      || !Number.isFinite(attestedAt.getTime()) || attestedAt.toISOString() !== input.attestedAt
      || !Number.isFinite(startedAt.getTime()) || attestedAt < startedAt
      || attestedAt.getTime() - startedAt.getTime() > 2 * 60_000) {
    throw new Error("task0b_runtime_manager_start_attestation_unverified");
  }
  for (const value of [
    input.observation.commandLineSha256,
    input.observation.executablePathSha256,
    input.observation.workingDirectoryFingerprintSha256,
    input.observation.entrypointPathFingerprintSha256
  ]) if (!SHA256.test(value)) throw new Error("task0b_runtime_manager_start_attestation_unverified");
  return {
    version: "runtime-manager-start-evidence-v1",
    generationId: input.generationId,
    runtimeSha: input.runtimeSha,
    runtimeLabel: input.runtimeLabel,
    processId: input.observation.processId,
    processStartedAt: input.observation.processStartedAt,
    commandLineSha256: input.observation.commandLineSha256,
    executablePathSha256: input.observation.executablePathSha256,
    workingDirectoryFingerprintSha256: input.observation.workingDirectoryFingerprintSha256,
    entrypointPathFingerprintSha256: input.observation.entrypointPathFingerprintSha256,
    managerExecutableSha256: input.managerExecutableSha256,
    attestedAt: input.attestedAt,
    producerId: "task0b_repo_runtime_manager_v1",
    commandId: "runtime_manager_previous_identity",
    templateSha256: TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_previous_identity,
    exitCode: 0
  };
}

export function validateTask0BPreviousRuntimeIdentity(
  value: unknown,
  processObservation: Task0BDirectRuntimeProcessObservation,
  expected: { sha: string; label: string; managerExecutableSha256: string },
  startEvidenceSha256: string
): Task0BReleaseFreezeEvidenceV1["previousRuntimeIdentity"] {
  assertNoSecretLikeArtifactValues(value);
  const evidence = record(value, "task0b_previous_runtime_start_evidence");
  exactKeys(evidence, [
    "version", "generationId", "runtimeSha", "runtimeLabel", "processId", "processStartedAt", "commandLineSha256",
    "executablePathSha256", "workingDirectoryFingerprintSha256", "entrypointPathFingerprintSha256",
    "managerExecutableSha256", "attestedAt", "producerId", "commandId", "templateSha256", "exitCode"
  ], "task0b_previous_runtime_start_evidence");
  const startedAt = new Date(string(evidence.processStartedAt, "task0b_previous_runtime_started_at"));
  const attestedAt = new Date(string(evidence.attestedAt, "task0b_previous_runtime_attested_at"));
  if (!Number.isFinite(startedAt.getTime()) || startedAt.toISOString() !== evidence.processStartedAt
      || !Number.isFinite(attestedAt.getTime()) || attestedAt.toISOString() !== evidence.attestedAt
      || attestedAt < startedAt || attestedAt.getTime() - startedAt.getTime() > 2 * 60_000
      || evidence.version !== "runtime-manager-start-evidence-v1"
      || typeof evidence.generationId !== "string"
      || !/^[a-z0-9][a-z0-9-]{15,63}$/u.test(evidence.generationId)
      || evidence.runtimeSha !== expected.sha || evidence.runtimeLabel !== expected.label
      || evidence.runtimeSha !== processObservation.runtimeSha || evidence.runtimeLabel !== processObservation.runtimeLabel
      || !expected.label.includes(expected.sha.slice(0, 8))
      || !Number.isSafeInteger(evidence.processId) || (evidence.processId as number) < 1
      || evidence.processId !== processObservation.processId
      || evidence.processStartedAt !== processObservation.processStartedAt
      || evidence.commandLineSha256 !== processObservation.commandLineSha256
      || evidence.executablePathSha256 !== processObservation.executablePathSha256
      || evidence.workingDirectoryFingerprintSha256 !== processObservation.workingDirectoryFingerprintSha256
      || evidence.entrypointPathFingerprintSha256 !== processObservation.entrypointPathFingerprintSha256
      || evidence.managerExecutableSha256 !== expected.managerExecutableSha256
      || evidence.producerId !== "task0b_repo_runtime_manager_v1"
      || processObservation.runtimeProcessCount !== 1
      || evidence.commandId !== "runtime_manager_previous_identity"
      || evidence.templateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_previous_identity
      || evidence.exitCode !== 0 || !SHA256.test(startEvidenceSha256)) {
    throw new Error("task0b_previous_runtime_identity_unverified");
  }
  for (const field of [
    evidence.commandLineSha256,
    evidence.executablePathSha256,
    evidence.workingDirectoryFingerprintSha256,
    evidence.entrypointPathFingerprintSha256,
    evidence.managerExecutableSha256
  ]) if (!SHA256.test(String(field))) throw new Error("task0b_previous_runtime_identity_unverified");
  return {
    generationId: evidence.generationId as string,
    runtimeSha: evidence.runtimeSha as string,
    runtimeLabel: evidence.runtimeLabel as string,
    processId: evidence.processId as number,
    processStartedAt: evidence.processStartedAt as string,
    commandLineSha256: evidence.commandLineSha256 as string,
    executablePathSha256: evidence.executablePathSha256 as string,
    workingDirectoryFingerprintSha256: evidence.workingDirectoryFingerprintSha256 as string,
    entrypointPathFingerprintSha256: evidence.entrypointPathFingerprintSha256 as string,
    managerExecutableSha256: evidence.managerExecutableSha256 as string,
    attestedAt: evidence.attestedAt as string,
    producerId: "task0b_repo_runtime_manager_v1",
    liveRecheckSha256: runtimeObservationSha256(processObservation),
    startEvidenceSha256,
    commandId: "runtime_manager_previous_identity",
    templateSha256: TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_previous_identity,
    exitCode: 0,
    source: "repo_runtime_manager_start_evidence_and_process_direct_read",
    verified: true
  };
}

export async function observeWindowsRuntimeProcess(
  processId: number,
  bounded?: Task0BBoundedProbeOptions
): Promise<Task0BDirectRuntimeProcessObservation> {
  if (process.platform !== "win32") throw new Error("task0b_runtime_process_probe_unsupported");
  const processJson = await run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$items = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '--task0b-manager-producer=task0b_repo_runtime_manager_v1' } | ForEach-Object { [pscustomobject]@{ processId = [int]$_.ProcessId; processStartedAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = [string]$_.CommandLine; executablePath = [string]$_.ExecutablePath } }); ConvertTo-Json -Compress -InputObject $items"
  ], undefined, undefined, task0BProbeTimeout(bounded));
  const processes = JSON.parse(processJson) as Array<Record<string, unknown>>;
  if (!Array.isArray(processes)) throw new Error("task0b_previous_runtime_process_unverified");
  const observed = processes.find((item) => item.processId === processId);
  if (!observed || typeof observed.commandLine !== "string" || typeof observed.executablePath !== "string"
      || typeof observed.processStartedAt !== "string") throw new Error("task0b_previous_runtime_process_unverified");
  const startedAt = new Date(observed.processStartedAt);
  if (!Number.isFinite(startedAt.getTime())) throw new Error("task0b_previous_runtime_process_unverified");
  const { runtimeSha, runtimeLabel, entrypointPath: entrypointText } = parseTask0BManagedRuntimeCommand(observed.commandLine);
  const entrypoint = resolve(entrypointText);
  const physicalEntrypoint = resolve(await realpath(entrypoint));
  if (!sameCanonicalPath(entrypoint, physicalEntrypoint)) throw new Error("task0b_previous_runtime_entrypoint_unverified");
  const worktree = dirname(dirname(physicalEntrypoint));
  const [gitTopLevel, gitHead, gitStatus] = await Promise.all([
    run("git", ["rev-parse", "--show-toplevel"], worktree, undefined, task0BProbeTimeout(bounded)),
    run("git", ["rev-parse", "HEAD"], worktree, undefined, task0BProbeTimeout(bounded)),
    run("git", ["status", "--porcelain"], worktree, undefined, task0BProbeTimeout(bounded))
  ]);
  const physicalTopLevel = resolve(await realpath(gitTopLevel));
  if (!sameCanonicalPath(physicalTopLevel, worktree) || gitHead !== runtimeSha || gitStatus !== "") {
    throw new Error("task0b_previous_runtime_worktree_unverified");
  }
  return {
    processId,
    processStartedAt: startedAt.toISOString(),
    commandLineSha256: hash(observed.commandLine),
    executablePathSha256: hash(observed.executablePath.toLowerCase()),
    runtimeSha,
    runtimeLabel,
    workingDirectoryFingerprintSha256: hash(canonicalPathKey(physicalTopLevel)),
    entrypointPathFingerprintSha256: hash(canonicalPathKey(physicalEntrypoint)),
    runtimeProcessCount: processes.length
  };
}

/** One OS process enumeration, followed only by identity checks for that immutable snapshot. */
export async function observeTask0BRuntimeTopologySnapshotV2(
  bounded: Task0BBoundedProbeOptions
): Promise<RuntimeTopologySnapshotV2> {
  if (process.platform !== "win32") throw new Error("task0b_runtime_process_probe_unsupported");
  const processJson = await run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$items = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '${TASK0B_RUNTIME_ENTRYPOINT_PROCESS_PATTERN_V2}' } | ForEach-Object { [pscustomobject]@{ processId = [int]$_.ProcessId; processStartedAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = [string]$_.CommandLine; executablePath = [string]$_.ExecutablePath } }); ConvertTo-Json -Compress -InputObject $items`
  ], undefined, undefined, task0BProbeTimeout(bounded));
  const observedAt = new Date((bounded.nowMs ?? Date.now)()).toISOString();
  let processes: unknown;
  try { processes = JSON.parse(processJson); }
  catch (error) { throw new Error("task0b_runtime_topology_json_invalid", { cause: error }); }
  if (!Array.isArray(processes)) throw new Error("task0b_runtime_topology_invalid");
  const candidates = await Promise.all(processes.map(async (raw) => {
    const item = record(raw, "task0b_runtime_topology_candidate");
    if (!Number.isSafeInteger(item.processId) || Number(item.processId) < 1
        || typeof item.processStartedAt !== "string" || typeof item.commandLine !== "string"
        || typeof item.executablePath !== "string") throw new Error("task0b_runtime_topology_candidate_invalid");
    const startedAt = new Date(item.processStartedAt);
    if (!Number.isFinite(startedAt.getTime())) throw new Error("task0b_runtime_topology_candidate_invalid");
    const parsed = parseTask0BManagedRuntimeCommand(item.commandLine);
    const entrypoint = resolve(parsed.entrypointPath);
    const physicalEntrypoint = resolve(await realpath(entrypoint));
    if (!sameCanonicalPath(entrypoint, physicalEntrypoint)) throw new Error("task0b_runtime_topology_entrypoint_invalid");
    const worktree = dirname(dirname(physicalEntrypoint));
    const [gitTopLevel, gitHead, gitStatus] = await Promise.all([
      run("git", ["rev-parse", "--show-toplevel"], worktree, undefined, task0BProbeTimeout(bounded)),
      run("git", ["rev-parse", "HEAD"], worktree, undefined, task0BProbeTimeout(bounded)),
      run("git", ["status", "--porcelain"], worktree, undefined, task0BProbeTimeout(bounded))
    ]);
    const physicalTopLevel = resolve(await realpath(gitTopLevel));
    if (!sameCanonicalPath(physicalTopLevel, worktree) || gitHead !== parsed.runtimeSha || gitStatus !== "") {
      throw new Error("task0b_runtime_topology_worktree_invalid");
    }
    return {
      processId: Number(item.processId),
      processStartedAt: startedAt.toISOString(),
      runtimeSha: parsed.runtimeSha,
      runtimeLabel: parsed.runtimeLabel,
      commandLineSha256: hash(item.commandLine),
      executablePathSha256: hash(item.executablePath.toLowerCase()),
      worktreePathFingerprintSha256: hash(canonicalPathKey(physicalTopLevel)),
      entrypointPathFingerprintSha256: hash(canonicalPathKey(physicalEntrypoint))
    };
  }));
  task0BProbeTimeout(bounded);
  candidates.sort((left, right) => left.processId - right.processId);
  return validateRuntimeTopologySnapshotV2({ version: "runtime-topology-snapshot-v2", observedAt, candidates });
}

export async function countTask0BRuntimeCandidates(bounded?: Task0BBoundedProbeOptions): Promise<number> {
  if (process.platform !== "win32") throw new Error("task0b_runtime_process_probe_unsupported");
  const output = await run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$items = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'src[\\\\/]index\\.ts' }); [string]$items.Count"
  ], undefined, undefined, task0BProbeTimeout(bounded));
  const count = Number(output);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("task0b_runtime_process_count_unverified");
  return count;
}

async function observeCurrentRuntime(config: Task0BPreflightConfigV1): Promise<{
  sha: string;
  label: string;
  source: "runtime_manager_attestation_and_process_direct_read";
  verified: true;
  identity: Task0BReleaseFreezeEvidenceV1["previousRuntimeIdentity"];
}> {
  const root = await inspectRealDirectory(config.artifactRoot, true);
  const binding = assertPreviousRuntimeIdentityConfig(config.previousRuntimeIdentity);
  const manager = assertAllowedRuntimeManager(config.runtimeManager);
  const evidenceBytes = await readProtectedRegularFile(root, binding.evidencePath, MAX_CONFIG_BYTES);
  if (hash(evidenceBytes) !== binding.evidenceSha256) throw new Error("task0b_previous_runtime_evidence_hash_mismatch");
  const rawEvidence = JSON.parse(evidenceBytes.toString("utf8")) as Record<string, unknown>;
  const processId = rawEvidence.processId;
  if (!Number.isSafeInteger(processId) || (processId as number) < 1) throw new Error("task0b_previous_runtime_process_unverified");
  const processObservation = await observeWindowsRuntimeProcess(processId as number);
  return {
    sha: config.previousRuntimeSha,
    label: config.previousRuntimeLabel,
    source: "runtime_manager_attestation_and_process_direct_read",
    verified: true,
    identity: validateTask0BPreviousRuntimeIdentity(
      rawEvidence,
      processObservation,
      {
        sha: config.previousRuntimeSha,
        label: config.previousRuntimeLabel,
        managerExecutableSha256: manager.executorSha256
      },
      binding.evidenceSha256
    )
  };
}

async function observeRuntimeManagerRegistry(
  config: Task0BPreflightConfigV1
): Promise<Task0BReleaseFreezeEvidenceV1["runtimeManager"]> {
  const manager = assertAllowedRuntimeManager(config.runtimeManager);
  const executor = resolve(repositoryRoot, manager.executorPath);
  const physicalExecutor = resolve(await realpath(executor));
  if (!sameCanonicalPath(executor, physicalExecutor)
      || !sameCanonicalPath(dirname(physicalExecutor), resolve(repositoryRoot, "scripts"))) {
    throw new Error("task0b_runtime_manager_executor_unverified");
  }
  const metadata = await lstat(executor);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("task0b_runtime_manager_executor_unverified");
  const handle = await open(executor, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new Error("task0b_runtime_manager_executor_changed");
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error("task0b_runtime_manager_executor_changed");
    }
  } finally {
    await handle.close();
  }
  if (hash(bytes) !== manager.executorSha256) throw new Error("task0b_runtime_manager_executor_hash_mismatch");
  return manager;
}

export async function observeTask0BProductionDatabase(
  config: Task0BPreflightConfigV1,
  bounded?: Task0BBoundedProbeOptions
): Promise<Task0BReleaseFreezeEvidenceV1["productionDatabase"]> {
  const expected = assertExpectedProductionDatabase(config.productionDatabaseExpected);
  const databaseUrl = process.env[config.databaseConnectionEnvName];
  if (!databaseUrl) throw new Error("task0b_production_database_binding_missing");
  const parsed = new URL(databaseUrl);
  const endpointPort = Number(parsed.port || 5432);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("task0b_production_database_binding_invalid");
  }
  if (parsed.search !== "" || parsed.hash !== ""
      || parsed.hostname !== expected.endpointHost || endpointPort !== expected.endpointPort
      || decodeURIComponent(parsed.pathname.slice(1)) !== expected.databaseName
      || !Number.isSafeInteger(endpointPort) || endpointPort < 1 || endpointPort > 65_535) {
    throw new Error("task0b_production_database_binding_invalid");
  }
  const initialTimeoutMs = task0BProbeTimeout(bounded);
  const client = new Client({
    host: expected.endpointHost,
    port: endpointPort,
    database: databaseName,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    application_name: "task0b_read_only_preflight",
    connectionTimeoutMillis: Math.min(5_000, initialTimeoutMs),
    statement_timeout: initialTimeoutMs,
    query_timeout: initialTimeoutMs
  });
  await client.connect();
  try {
    const boundedQuery = async (text: string, values?: unknown[]) => {
      const timeoutMs = task0BProbeTimeout(bounded);
      await client.query({ text: `set statement_timeout to ${timeoutMs}`, query_timeout: timeoutMs } as any);
      return client.query({ text, values, query_timeout: task0BProbeTimeout(bounded) } as any);
    };
    await boundedQuery("begin read only");
    const identity = await boundedQuery(`select current_database() as database_name,
      coalesce(inet_server_addr()::text, 'local') as server_address,
      inet_server_port() as server_port,
      current_setting('server_version') as server_version,
      current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid`);
    const control = await boundedQuery("select system_identifier::text as system_identifier from pg_control_system()");
    const receiptTable = await boundedQuery("select to_regclass('public.schema_migration_receipts')::text as receipt_table");
    const row = identity.rows[0];
    const systemIdentifier = String(control.rows[0]?.system_identifier ?? "");
    const databaseOid = String(row?.database_oid ?? "");
    const serverVersionNum = String(row?.server_version_num ?? "");
    const observedApprovedIdentity = buildTask0BProductionDatabaseIdentityFingerprint({
      databaseName: "tron_watch",
      endpointHost: expected.endpointHost,
      endpointPort,
      connectedServerPort: Number(row?.server_port),
      systemIdentifier,
      databaseOid,
      serverVersionNum
    });
    if (!row || row.database_name !== expected.databaseName || !Number.isSafeInteger(row.server_port)
        || typeof row.server_address !== "string" || !row.server_address) {
      throw new Error("task0b_production_database_identity_unverified");
    }
    if (row.server_port !== expected.connectedServerPort || systemIdentifier !== expected.systemIdentifier
        || databaseOid !== expected.databaseOid || serverVersionNum !== expected.serverVersionNum
        || observedApprovedIdentity !== expected.identityFingerprintSha256) {
      throw new Error("task0b_production_database_approved_identity_mismatch");
    }
    let schemaState: "legacy_031" | "schema_032_verified" = "legacy_031";
    let schema032ReceiptPrestate: Task0BReleaseFreezeEvidenceV1["productionDatabase"]["schema032ReceiptPrestate"] = {
      state: "absent",
      version: 32,
      filename: REQUIRED_SCHEMA_FILENAME,
      checksumSha256: null
    };
    let schemaReceiptSet: Task0BReleaseFreezeEvidenceV1["productionDatabase"]["schemaReceiptSet"] = {
      count: 0,
      maxVersion: null,
      aggregateSha256: hash("[]"),
      source: "postgresql_direct_read_only"
    };
    if (receiptTable.rows[0]?.receipt_table) {
      const receipts = await boundedQuery(
        "select version, filename, checksum_sha256 from public.schema_migration_receipts order by version"
      );
      const canonicalReceipts = receipts.rows.map((receipt: Record<string, unknown>) => ({
        version: Number(receipt.version),
        filename: String(receipt.filename),
        checksumSha256: String(receipt.checksum_sha256)
      }));
      if (canonicalReceipts.length !== 1 || canonicalReceipts[0]?.version !== REQUIRED_SCHEMA_VERSION
          || canonicalReceipts[0]?.filename !== REQUIRED_SCHEMA_FILENAME
          || canonicalReceipts[0]?.checksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) {
        throw new Error("task0b_schema_032_receipt_prestate_unverified");
      }
      await verifyRequiredSchema032({ query: boundedQuery }, APPROVED_SCHEMA_032_CHECKSUM);
      schemaState = "schema_032_verified";
      schema032ReceiptPrestate = {
        state: "verified",
        version: 32,
        filename: REQUIRED_SCHEMA_FILENAME,
        checksumSha256: APPROVED_SCHEMA_032_CHECKSUM
      };
      schemaReceiptSet = {
        count: 1,
        maxVersion: 32,
        aggregateSha256: hash(JSON.stringify(canonicalReceipts)),
        source: "postgresql_direct_read_only"
      };
    } else {
      const columns = await boundedQuery(`select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'wallet_approvals' and column_name = any($1::text[]))
            or (table_name = 'observed_transactions' and column_name = any($2::text[])))`, [
        [...LEGACY_031_WALLET_APPROVAL_COLUMNS, ...SCHEMA_032_ALLOWANCE_COLUMNS],
        LEGACY_031_POISONING_COLUMNS
      ]);
      const found = new Set(columns.rows.map((column: Record<string, unknown>) =>
        `${String(column.table_name)}.${String(column.column_name)}`));
      const missingLegacy = [
        ...LEGACY_031_WALLET_APPROVAL_COLUMNS.map((column) => `wallet_approvals.${column}`),
        ...LEGACY_031_POISONING_COLUMNS.map((column) => `observed_transactions.${column}`)
      ].filter((column) => !found.has(column));
      const unexpected032 = SCHEMA_032_ALLOWANCE_COLUMNS
        .map((column) => `wallet_approvals.${column}`)
        .filter((column) => found.has(column));
      if (missingLegacy.length > 0 || unexpected032.length > 0) {
        throw new Error("task0b_legacy_031_schema_state_unverified");
      }
    }
    const endpoint = `${parsed.hostname.toLowerCase()}:${endpointPort}/${String(row.database_name)}`;
    const connectedServer = `${row.server_address}:${row.server_port}`;
    const cluster = `${systemIdentifier}:${serverVersionNum}`;
    if (!systemIdentifier) throw new Error("task0b_production_cluster_unverified");
    return {
      name: "tron_watch",
      endpointHostClass: "loopback",
      endpointPort,
      endpointFingerprintSha256: hash(endpoint),
      connectedServerPort: row.server_port,
      connectedServerAddressFingerprintSha256: hash(connectedServer),
      clusterFingerprintSha256: hash(cluster),
      databaseOidFingerprintSha256: hash(databaseOid),
      approvedIdentityFingerprintSha256: observedApprovedIdentity,
      identityMatchedApprovedConfig: true,
      serverVersion: String(row.server_version),
      serverVersionNum,
      schemaState,
      schema032ReceiptPrestate,
      schemaReceiptSet,
      source: "protected_config_bound_postgresql_direct_read_only",
      verified: true
    };
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

type ToolName = "pg_dump" | "pg_restore";
type ToolEvidence<Name extends ToolName> = Name extends "pg_dump"
  ? Task0BReleaseFreezeEvidenceV1["postgresTools"]["pgDump"]
  : Task0BReleaseFreezeEvidenceV1["postgresTools"]["pgRestore"];

function toolAttestation<Name extends ToolName>(
  name: Name,
  executableIdentitySha256: string,
  version: string
): ToolEvidence<Name> {
  const commandId = name === "pg_dump" ? "postgres_tool_pg_dump_attest" : "postgres_tool_pg_restore_attest";
  return {
    executableIdentitySha256,
    version,
    versionProbeExitCode: 0,
    commandId,
    templateSha256: TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256[commandId]
  } as ToolEvidence<Name>;
}

async function observeDockerTools(
  provider: Extract<Task0BPreflightConfigV1["postgresToolProvider"], { kind: "docker_pinned_image" }>
): Promise<Task0BReleaseFreezeEvidenceV1["postgresTools"]> {
  const imageId = provider.immutableImageId;
  const inspectedId = await run("docker", ["image", "inspect", imageId, "--format", "{{.Id}}"]);
  if (inspectedId !== imageId) throw new Error("task0b_docker_image_identity_mismatch");
  const observe = async <Name extends ToolName>(name: Name): Promise<ToolEvidence<Name>> => {
    const binaryPath = `/usr/local/bin/${name}`;
    const digestOutput = await run("docker", [
      "run", "--rm", "--network", "none", "--pull", "never", "--entrypoint", "sha256sum", imageId, binaryPath
    ]);
    const executableIdentitySha256 = digestOutput.split(/\s+/u)[0] ?? "";
    if (!SHA256.test(executableIdentitySha256)) throw new Error(`task0b_${name}_identity_invalid`);
    const version = await run("docker", [
      "run", "--rm", "--network", "none", "--pull", "never", "--entrypoint", name, imageId, "--version"
    ]);
    if (!new RegExp(`^${name} \\(PostgreSQL\\) \\d+(?:\\.\\d+)+$`).test(version)) {
      throw new Error(`task0b_${name}_version_invalid`);
    }
    return toolAttestation(name, executableIdentitySha256, version);
  };
  return {
    source: "pinned_docker_image_direct_probe",
    verified: true,
    provider: {
      kind: "docker_pinned_image",
      immutableImageId: imageId,
      immutableImageIdSha256: hash(imageId),
      networkMode: "none",
      pullAllowed: false,
      source: "external_allowlisted_config_verified"
    },
    pgDump: await observe("pg_dump"),
    pgRestore: await observe("pg_restore")
  };
}

async function observePostgresTools(config: Task0BPreflightConfigV1): Promise<Task0BReleaseFreezeEvidenceV1["postgresTools"]> {
  const provider = assertPostgresToolProvider(config.postgresToolProvider);
  return observeDockerTools(provider);
}

async function observeArtifactRoot(config: Task0BPreflightConfigV1): Promise<Task0BReleaseFreezeEvidenceV1["artifactRoot"]> {
  const root = await inspectRealDirectory(config.artifactRoot, true);
  const access = await inspectProtectedPathChain(root);
  const probe = join(root, `.task0b-exclusive-${process.pid}-${randomBytes(8).toString("hex")}`);
  const probeBytes = randomBytes(32);
  const handle = await open(probe, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    await handle.writeFile(probeBytes);
    await handle.sync();
  } finally {
    await handle.close();
    await unlink(probe);
  }
  return {
    rootFingerprintSha256: hash(canonicalPathKey(root)),
    outsideRepository: true,
    noSymlink: true,
    ...access,
    restrictiveAccessVerified: true,
    exclusiveWriteVerified: true,
    exclusiveWriteFingerprintSha256: hash(probeBytes),
    source: "filesystem_direct_probe",
    verified: true
  };
}

async function observeCandidatePort(
  config: Task0BPreflightConfigV1,
  candidateAdminUrl: string | undefined
): Promise<Task0BReleaseFreezeEvidenceV1["candidatePort"]> {
  const { host, port } = config.candidatePort;
  if (!candidateAdminUrl) throw new Error("task0b_candidate_admin_binding_missing");
  const adminUrl = new URL(candidateAdminUrl);
  if (adminUrl.protocol !== "http:" || adminUrl.hostname !== host || Number(adminUrl.port) !== port
      || adminUrl.pathname !== "/" || adminUrl.search || adminUrl.hash || adminUrl.username || adminUrl.password) {
    throw new Error("task0b_candidate_admin_port_mismatch");
  }
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
  return {
    host,
    port,
    available: true,
    adminUrlFingerprintSha256: hash(adminUrl.toString()),
    bindingSource: "protected_runtime_operational_config",
    source: "loopback_bind_probe",
    verified: true
  };
}

export function createTask0BDirectDependencies(
  config: Task0BPreflightConfigV1,
  operatorConfigBinding?: Task0BReleaseFreezeEvidenceV1["operatorConfig"]
): Task0BReadOnlyCaptureDependencies {
  let candidateAdminUrl: string | undefined;
  return {
    now: () => new Date(),
    readOperatorConfigBinding: async () => {
      if (!operatorConfigBinding) throw new Error("task0b_operator_config_binding_missing");
      return operatorConfigBinding;
    },
    readCandidateState: () => observeCandidateState(),
    readPreviousRuntime: () => observeCurrentRuntime(config),
    readSanitizedRehearsalBinding: async () => {
      const binding = assertSanitizedBinding(config.sanitizedRehearsal);
      const root = await inspectRealDirectory(config.artifactRoot, true);
      const operationalConfig = await readProtectedRegularFile(root, binding.operationalConfigPath, MAX_CONFIG_BYTES);
      if (hash(operationalConfig) !== binding.operationalConfigSha256) throw new Error("task0b_operational_config_hash_mismatch");
      const controlled = validateControlledRuntimeOperationalConfig(operationalConfig, binding);
      if (!sameCanonicalPath(controlled.candidateWorktree, repositoryRoot)
          || !sameCanonicalPath(controlled.previousWorktree, config.rollbackWorktreePath)) {
        throw new Error("task0b_operational_config_worktree_mismatch");
      }
      candidateAdminUrl = controlled.candidateAdminUrl;
      return binding;
    },
    readRuntimeManager: () => observeRuntimeManagerRegistry(config),
    readProductionDatabase: () => observeTask0BProductionDatabase(config),
    readRollbackWorktree: () => observeRollbackWorktree(config),
    readPostgresTools: () => observePostgresTools(config),
    inspectArtifactRoot: () => observeArtifactRoot(config),
    probeCandidatePort: () => observeCandidatePort(config, candidateAdminUrl)
  };
}

export async function writeTask0BReleaseFreezeEvidenceExclusive(
  root: string,
  evidence: Task0BReleaseFreezeEvidenceV1
): Promise<void> {
  validateTask0BReleaseFreezeEvidence(evidence, evidence.candidateSha, evidence.observedAt);
  const artifactRoot = await inspectRealDirectory(root, true);
  const path = join(artifactRoot, EVIDENCE_FILENAME);
  const temporaryPath = join(artifactRoot, `.task0b-evidence-${process.pid}-${randomBytes(8).toString("hex")}`);
  const bytes = Buffer.from(`${canonicalReleaseJsonV2(evidence)}\n`, "utf8");
  const handle = await open(
    temporaryPath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath);
  }
}

export async function captureTask0BPreflightFromArtifactRoot(artifactRootInput: string): Promise<{
  artifactRoot: string;
  evidence: Task0BReleaseFreezeEvidenceV1;
}> {
  const artifactRoot = await inspectRealDirectory(artifactRootInput, true);
  const externalConfig = await readExternalConfig(artifactRoot);
  const { config } = externalConfig;
  if (!sameCanonicalPath(config.artifactRoot, artifactRoot)) {
    throw new Error("task0b_config_artifact_root_mismatch");
  }
  const evidence = await captureTask0BReleaseFreezeEvidence(
    createTask0BDirectDependencies(config, externalConfig.binding)
  );
  if (evidence.candidateSha !== config.candidateSha) throw new Error("task0b_candidate_sha_mismatch");
  return { artifactRoot, evidence };
}

async function readFrozenTask0BPair(artifactRoot: string): Promise<{
  frozen: Task0BReleaseFreezeEvidenceV1;
  frozenBytes: Buffer;
  freeze: ReturnType<typeof readCurrentVerifiedReleaseFreezeV2>;
}> {
  const frozenBytes = await readProtectedRegularFile(artifactRoot, EVIDENCE_FILENAME, MAX_CONFIG_BYTES);
  const frozen = validateTask0BReleaseFreezeEvidence(JSON.parse(frozenBytes.toString("utf8")));
  if (!frozenBytes.equals(Buffer.from(`${canonicalReleaseJsonV2(frozen)}\n`, "utf8"))) {
    throw new Error("task0b_revalidation_preflight_noncanonical");
  }
  const freeze = readCurrentVerifiedReleaseFreezeV2(artifactRoot);
  return { frozen, frozenBytes, freeze };
}

async function revalidationDirectory(artifactRoot: string, create: boolean): Promise<string> {
  const path = join(artifactRoot, REVALIDATION_DIRECTORY);
  if (create) {
    try {
      await mkdir(path, { recursive: false, mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return inspectRealDirectory(path, true);
}

export async function writeTask0BReleaseRevalidationEvidenceExclusive(
  artifactRoot: string,
  frozen: Task0BReleaseFreezeEvidenceV1,
  freeze: unknown,
  evidence: Task0BReleaseRevalidationEvidenceV1
): Promise<{ relativePath: string; sha256: string }> {
  validateTask0BReleaseRevalidationEvidence(evidence, frozen, freeze, evidence.observedAt);
  const directory = await revalidationDirectory(artifactRoot, true);
  const bytes = Buffer.from(`${canonicalReleaseJsonV2(evidence)}\n`, "utf8");
  const evidenceSha256 = hash(bytes);
  const filename = `${evidenceSha256}.json`;
  const output = join(directory, filename);
  const temporary = join(directory, `.task0b-revalidation-${process.pid}-${randomBytes(8).toString("hex")}`);
  const handle = await open(
    temporary,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, output);
  } finally {
    await unlink(temporary);
  }
  return { relativePath: `${REVALIDATION_DIRECTORY}/${filename}`, sha256: evidenceSha256 };
}

export async function captureTask0BRevalidationFromArtifactRoot(artifactRootInput: string): Promise<{
  artifactRoot: string;
  evidence: Task0BReleaseRevalidationEvidenceV1;
  relativePath: string;
  sha256: string;
}> {
  const artifactRoot = await inspectRealDirectory(artifactRootInput, true);
  const { frozen, freeze } = await readFrozenTask0BPair(artifactRoot);
  const config = await readFrozenExternalConfig(artifactRoot, frozen);
  if (!sameCanonicalPath(config.artifactRoot, artifactRoot)) {
    throw new Error("task0b_revalidation_artifact_root_mismatch");
  }
  const { readOperatorConfigBinding: _unused, ...dependencies } = createTask0BDirectDependencies(config);
  const evidence = await captureTask0BReleaseRevalidationEvidence(frozen, freeze, dependencies);
  const written = await writeTask0BReleaseRevalidationEvidenceExclusive(
    artifactRoot,
    frozen,
    freeze,
    evidence
  );
  return { artifactRoot, evidence, ...written };
}

export async function readCurrentTask0BReleaseRevalidation(
  artifactRootInput: string,
  evaluatedAt = new Date().toISOString()
): Promise<{
  frozen: Task0BReleaseFreezeEvidenceV1;
  frozenBytes: Buffer;
  freeze: ReturnType<typeof readCurrentVerifiedReleaseFreezeV2>;
  evidence: Task0BReleaseRevalidationEvidenceV1;
  evidenceBytes: Buffer;
  relativePath: string;
}> {
  const artifactRoot = await inspectRealDirectory(artifactRootInput, true);
  const { frozen, frozenBytes, freeze } = await readFrozenTask0BPair(artifactRoot);
  const directory = await revalidationDirectory(artifactRoot, false);
  const filenames = (await readdir(directory)).sort();
  if (filenames.length === 0) throw new Error("task0b_revalidation_missing");
  const valid: Array<{
    evidence: Task0BReleaseRevalidationEvidenceV1;
    evidenceBytes: Buffer;
    relativePath: string;
  }> = [];
  for (const filename of filenames) {
    if (!/^[0-9a-f]{64}\.json$/u.test(filename)) throw new Error("task0b_revalidation_filename_invalid");
    const evidenceBytes = await readProtectedRegularFile(directory, filename, MAX_CONFIG_BYTES);
    if (hash(evidenceBytes) !== filename.slice(0, 64)) throw new Error("task0b_revalidation_content_address_invalid");
    const parsed = JSON.parse(evidenceBytes.toString("utf8")) as unknown;
    const observedAt = String((parsed as Record<string, unknown>)?.observedAt ?? "");
    const evidence = validateTask0BReleaseRevalidationEvidence(parsed, frozen, freeze, observedAt);
    if (!evidenceBytes.equals(Buffer.from(`${canonicalReleaseJsonV2(evidence)}\n`, "utf8"))) {
      throw new Error("task0b_revalidation_noncanonical");
    }
    if (Date.parse(evaluatedAt) >= Date.parse(evidence.observedAt)
        && Date.parse(evaluatedAt) <= Date.parse(evidence.expiresAt)) {
      valid.push({
        evidence,
        evidenceBytes,
        relativePath: `${REVALIDATION_DIRECTORY}/${filename}`
      });
    }
  }
  valid.sort((left, right) => right.evidence.observedAt.localeCompare(left.evidence.observedAt));
  if (valid.length === 0) throw new Error("task0b_revalidation_stale");
  if (valid.length > 1 && valid[0]!.evidence.observedAt === valid[1]!.evidence.observedAt) {
    throw new Error("task0b_revalidation_ambiguous_tip");
  }
  return { frozen, frozenBytes, freeze, ...valid[0]! };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--revalidate") {
    if (!args[1] || args.length !== 2) throw new Error("task0b_revalidation_artifact_root_required");
    const result = await captureTask0BRevalidationFromArtifactRoot(args[1]);
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      candidateSha: result.evidence.candidateSha,
      relativePath: result.relativePath,
      evidenceSha256: result.sha256
    })}\n`);
    return;
  }
  const [artifactRootInput] = args;
  if (!artifactRootInput || args.length !== 1) throw new Error("task0b_artifact_root_required");
  const { artifactRoot, evidence } = await captureTask0BPreflightFromArtifactRoot(artifactRootInput);
  await writeTask0BReleaseFreezeEvidenceExclusive(artifactRoot, evidence);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    candidateSha: evidence.candidateSha,
    evidenceSha256: hash(Buffer.from(`${canonicalReleaseJsonV2(evidence)}\n`, "utf8"))
  })}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && sameCanonicalPath(invokedPath, fileURLToPath(import.meta.url))) {
  main().catch(() => {
    process.stderr.write("task0b_preflight_invalid\n");
    process.exitCode = 1;
  });
}
