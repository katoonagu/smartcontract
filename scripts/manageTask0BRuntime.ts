import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  countTask0BRuntimeCandidates,
  createTask0BDirectDependencies,
  createTask0BRuntimeManagerStartEvidence,
  inspectProtectedPathChain,
  inspectRealDirectory,
  observeWindowsRuntimeProcess,
  readExternalConfig,
  readProtectedRegularFile,
  sameCanonicalPath,
  validateTask0BPreflightConfig,
  validateTask0BPreviousRuntimeIdentity
} from "./captureTask0BPreflight";
import {
  TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256,
  validateTask0BReleaseFreezeEvidence
} from "../src/release/remediationReleaseManifest";
import {
  canonicalReleaseJsonV2,
  releaseFreezeIdentitySha256V2,
  releaseSha256V2,
  validateProductionOperationClaimV2,
  validateProductionOperationLeaseV2,
  validateProductionOrchestrationStepIntentV2,
  validateReleaseFreezeIdentityV2,
  validateRemediationReleaseManifestV2,
  type ProductionOperationClaimV2,
  type ProductionOperationLeaseV2,
  type ProductionOrchestrationStepIntentV2,
  type RemediationReleaseManifestV2
} from "../src/release/remediationReleaseManifestV2";
import { PRODUCTION_OPERATION_LEASE_FILE_V2 } from "../src/release/productionOperationStore";
import { ProductionOperationStoreV2 } from "../src/release/productionOperationStore";
import { observedProcessStartFingerprintSha256V2 } from "../src/release/releaseManifestStoreV2";
import type {
  Task0BReleaseFreezeEvidenceV1
} from "../src/release/remediationReleaseManifest";

const execFileAsync = promisify(execFile);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const START_EVIDENCE = /^runtime-start-evidence-(?:[a-z0-9][a-z0-9-]{15,63}|[a-z0-9][a-z0-9-]{15,63}-runtime_manager_(?:start_candidate|rollback_previous)-[0-9a-f]{64})\.json$/u;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const MANAGER_PATH = fileURLToPath(import.meta.url);

export type RuntimeCommandId =
  | "runtime_manager_start_candidate"
  | "runtime_manager_stop_candidate"
  | "runtime_manager_stop_previous"
  | "runtime_manager_rollback_previous";
type RuntimeActionPhase =
  | "post_migration_rollout"
  | "rollback_candidate_stop"
  | "rollback_previous_start";
type ForcePolicy = "graceful_only" | "graceful_then_force";

const RUNTIME_ACTION_PHASES: Readonly<Record<RuntimeCommandId, RuntimeActionPhase>> = Object.freeze({
  runtime_manager_stop_previous: "post_migration_rollout",
  runtime_manager_start_candidate: "post_migration_rollout",
  runtime_manager_stop_candidate: "rollback_candidate_stop",
  runtime_manager_rollback_previous: "rollback_previous_start"
});

export type Task0BProductionRuntimeAuthorityV1 = {
  version: "repo-issued-runtime-effect-authority-v2";
  scope: "production_go";
  source: "protected_production_orchestrator";
  operationKind: "rollout" | "rollback";
  operationId: string;
  operationClaimSha256: string;
  authorityConsumptionSha256: string;
  sequence: number;
  stepId: "stop_previous" | "start_candidate" | "stop_candidate" | "start_previous" | "restart_previous";
  inputSha256: string;
  intendedExternalEffectSha256: string;
  intentRelativePath: string;
  intentSha256: string;
  operationLeaseSha256: string;
  operationLeaseEpoch: number;
  orchestratorPid: number;
  orchestratorProcessStartFingerprintSha256: string;
  operationDeadlineAt: string;
  releaseFreezeIdentitySha256: string;
  sourceManifestSha256: string;
  generationId: string;
  commandId: RuntimeCommandId;
  actionPhase: RuntimeActionPhase;
  commandTemplateSha256: string;
  issuedAt: string;
  expiresAt: string;
  candidateSha: string;
  targetRuntimeSha: string;
  targetRuntimeLabel: string;
  targetWorktreePath: string;
  targetWorktreeFingerprintSha256: string;
  adminUrl: string;
  adminUrlFingerprintSha256: string;
  databaseRole: "production";
  databaseIdentityFingerprintSha256: string;
  telegramTransport: "production";
  telegramBotIdentitySha256: string;
  task0bEvidenceSha256: string;
  releaseManifestPath: "release-manifest.json";
  releaseManifestSha256: string;
  releaseManifestOverall: "not_ready";
  releaseManifestTransitionId: "g13_migration_passed" | "production_failed";
  explicitGo: true;
  forcePolicy: ForcePolicy;
  startEvidencePath: string | null;
  startEvidenceSha256: string | null;
};

type RuntimeIdentity = {
  processId: number;
  processStartedAt: string;
  runtimeProcessCount: number;
};

type PreparedStartRuntime = {
  worktree: string;
  physicalEntrypoint: string;
};

type PreparedStopRuntime = {
  evidence: Record<string, unknown>;
  processId: number;
  observation: Awaited<ReturnType<typeof observeWindowsRuntimeProcess>>;
  managerExecutableSha256: string;
};

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
}

function parseIso(value: unknown, code: string): Date {
  if (typeof value !== "string") throw new Error(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(code);
  return parsed;
}

function parseAdminUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("task0b_runtime_authority_admin_invalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("task0b_runtime_authority_admin_invalid"); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port
      || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("task0b_runtime_authority_admin_invalid");
  }
  return parsed;
}

export function validateTask0BProductionRuntimeAuthority(
  value: unknown,
  evaluatedAt = new Date().toISOString()
): Task0BProductionRuntimeAuthorityV1 {
  const authority = record(value, "task0b_runtime_authority_invalid");
  exactKeys(authority, [
    "version", "scope", "source", "operationKind", "operationId", "operationClaimSha256",
    "authorityConsumptionSha256", "sequence", "stepId", "inputSha256", "intendedExternalEffectSha256",
    "intentRelativePath", "intentSha256", "operationLeaseSha256", "operationLeaseEpoch",
    "orchestratorPid", "orchestratorProcessStartFingerprintSha256",
    "operationDeadlineAt", "releaseFreezeIdentitySha256", "sourceManifestSha256",
    "generationId", "commandId", "actionPhase", "commandTemplateSha256", "issuedAt", "expiresAt", "candidateSha",
    "targetRuntimeSha", "targetRuntimeLabel", "targetWorktreePath", "targetWorktreeFingerprintSha256", "adminUrl",
    "adminUrlFingerprintSha256", "databaseRole", "databaseIdentityFingerprintSha256", "telegramTransport", "telegramBotIdentitySha256",
    "task0bEvidenceSha256", "releaseManifestPath", "releaseManifestSha256", "releaseManifestOverall",
    "releaseManifestTransitionId", "explicitGo",
    "forcePolicy", "startEvidencePath", "startEvidenceSha256"
  ], "task0b_runtime_authority_shape_invalid");
  const now = parseIso(evaluatedAt, "task0b_runtime_authority_time_invalid");
  const issuedAt = parseIso(authority.issuedAt, "task0b_runtime_authority_time_invalid");
  const expiresAt = parseIso(authority.expiresAt, "task0b_runtime_authority_time_invalid");
  const operationDeadlineAt = parseIso(authority.operationDeadlineAt, "task0b_runtime_authority_time_invalid");
  const commandId = authority.commandId as RuntimeCommandId;
  const isStart = commandId === "runtime_manager_start_candidate" || commandId === "runtime_manager_rollback_previous";
  const startPath = authority.startEvidencePath;
  const startHash = authority.startEvidenceSha256;
  const adminUrl = parseAdminUrl(authority.adminUrl);
  const operationKind = authority.operationKind as "rollout" | "rollback";
  const stepId = authority.stepId as Task0BProductionRuntimeAuthorityV1["stepId"];
  const expectedOperationKind = commandId === "runtime_manager_stop_previous"
      || commandId === "runtime_manager_start_candidate" ? "rollout" : "rollback";
  const expectedStepIds: Readonly<Record<RuntimeCommandId, readonly string[]>> = {
    runtime_manager_stop_previous: ["stop_previous"],
    runtime_manager_start_candidate: ["start_candidate"],
    runtime_manager_stop_candidate: ["stop_candidate"],
    runtime_manager_rollback_previous: ["start_previous", "restart_previous"]
  };
  const expectedTransition = operationKind === "rollout" ? "g13_migration_passed" : "production_failed";
  if (authority.version !== "repo-issued-runtime-effect-authority-v2" || authority.scope !== "production_go"
      || authority.source !== "protected_production_orchestrator"
      || operationKind !== expectedOperationKind
      || typeof authority.operationId !== "string"
      || !new RegExp(`^production-${operationKind}-[0-9a-f]{64}$`, "u").test(authority.operationId)
      || !SHA256.test(String(authority.operationClaimSha256))
      || !SHA256.test(String(authority.authorityConsumptionSha256))
      || !Number.isSafeInteger(authority.sequence) || Number(authority.sequence) < 1
      || !expectedStepIds[commandId]?.includes(stepId)
      || !SHA256.test(String(authority.inputSha256))
      || !SHA256.test(String(authority.intendedExternalEffectSha256))
      || typeof authority.intentRelativePath !== "string"
      || authority.intentRelativePath !== `production-operation-step-intents/${authority.operationId}/${authority.sequence}-${stepId}-1-v2.json`
      || !SHA256.test(String(authority.intentSha256))
      || !SHA256.test(String(authority.operationLeaseSha256))
      || !Number.isSafeInteger(authority.operationLeaseEpoch) || Number(authority.operationLeaseEpoch) < 1
      || !Number.isSafeInteger(authority.orchestratorPid) || Number(authority.orchestratorPid) < 1
      || !SHA256.test(String(authority.orchestratorProcessStartFingerprintSha256))
      || operationDeadlineAt <= expiresAt
      || !SHA256.test(String(authority.releaseFreezeIdentitySha256))
      || !SHA256.test(String(authority.sourceManifestSha256))
      || typeof authority.generationId !== "string" || !GENERATION.test(authority.generationId)
      || !new Set<RuntimeCommandId>([
        "runtime_manager_start_candidate", "runtime_manager_stop_candidate", "runtime_manager_stop_previous",
        "runtime_manager_rollback_previous"
      ]).has(commandId)
      || authority.actionPhase !== RUNTIME_ACTION_PHASES[commandId]
      || authority.commandTemplateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256[commandId]
      || issuedAt > now || expiresAt <= now || expiresAt.getTime() - issuedAt.getTime() > 10 * 60_000
      || !SHA40.test(String(authority.candidateSha)) || !SHA40.test(String(authority.targetRuntimeSha))
      || ((commandId === "runtime_manager_start_candidate" || commandId === "runtime_manager_stop_candidate")
        && authority.targetRuntimeSha !== authority.candidateSha)
      || ((commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_rollback_previous")
        && authority.targetRuntimeSha === authority.candidateSha)
      || typeof authority.targetRuntimeLabel !== "string"
      || !authority.targetRuntimeLabel.includes(String(authority.targetRuntimeSha).slice(0, 8))
      || typeof authority.targetWorktreePath !== "string" || !isAbsolute(authority.targetWorktreePath)
      || !SHA256.test(String(authority.targetWorktreeFingerprintSha256))
      || hash(adminUrl.toString()) !== authority.adminUrlFingerprintSha256
      || authority.databaseRole !== "production" || !SHA256.test(String(authority.databaseIdentityFingerprintSha256))
      || authority.telegramTransport !== "production" || !SHA256.test(String(authority.telegramBotIdentitySha256))
      || !SHA256.test(String(authority.task0bEvidenceSha256))
      || authority.releaseManifestPath !== "release-manifest.json" || !SHA256.test(String(authority.releaseManifestSha256))
      || authority.releaseManifestOverall !== "not_ready"
      || authority.releaseManifestTransitionId !== expectedTransition
      || authority.explicitGo !== true
      || !new Set<ForcePolicy>(["graceful_only", "graceful_then_force"]).has(authority.forcePolicy as ForcePolicy)
      || (isStart && (startPath !== null || startHash !== null))
      || (!isStart && (typeof startPath !== "string" || !START_EVIDENCE.test(startPath)
        || !SHA256.test(String(startHash))))) {
    throw new Error("task0b_runtime_authority_unverified");
  }
  return authority as Task0BProductionRuntimeAuthorityV1;
}

export function validateRepoIssuedRuntimeAuthorityProtectionV2(
  authority: Task0BProductionRuntimeAuthorityV1,
  input: Readonly<{
    freezeValue: unknown;
    leaseValue: unknown;
    leaseSha256: string;
    claimValue: unknown;
    claimSha256: string;
    intentValue: unknown;
    intentSha256: string;
    takeoverChainSha256: string;
    lineageLeaseTips: readonly Readonly<{ sha256: string; epoch: number }>[];
    managerParentIdentity: Readonly<{ pid: number; processStartFingerprintSha256: string }>;
    evaluatedAt: string;
  }>
): Readonly<{
  freeze: ReturnType<typeof validateReleaseFreezeIdentityV2>;
  lease: ProductionOperationLeaseV2;
  claim: ProductionOperationClaimV2;
  intent: ProductionOrchestrationStepIntentV2;
}> {
  const freeze = validateReleaseFreezeIdentityV2(input.freezeValue);
  const lease = validateProductionOperationLeaseV2(input.leaseValue);
  const claim = validateProductionOperationClaimV2(input.claimValue);
  const intent = validateProductionOrchestrationStepIntentV2(input.intentValue);
  const now = parseIso(input.evaluatedAt, "repo_runtime_authority_time_invalid").getTime();
  const bound = authority.operationKind === lease.operationKind
    && authority.operationId === lease.operationId
    && authority.operationClaimSha256 === input.claimSha256
    && authority.authorityConsumptionSha256 === claim.authorityConsumptionSha256
    && input.lineageLeaseTips.some((tip) => tip.sha256 === authority.operationLeaseSha256
      && tip.epoch === authority.operationLeaseEpoch)
    && authority.orchestratorPid === lease.ownerPid
    && authority.orchestratorProcessStartFingerprintSha256 === lease.ownerProcessStartFingerprintSha256
    && input.managerParentIdentity.pid === lease.ownerPid
    && input.managerParentIdentity.processStartFingerprintSha256 === lease.ownerProcessStartFingerprintSha256
    && authority.operationDeadlineAt === lease.operationDeadlineAt
    && authority.releaseFreezeIdentitySha256 === releaseFreezeIdentitySha256V2(freeze)
    && authority.sourceManifestSha256 === lease.sourceManifestSha256
    && authority.generationId === lease.releaseGenerationId
    && authority.candidateSha === lease.candidateSha
    && authority.operationId === claim.operationId
    && authority.operationKind === claim.operationKind
    && authority.operationDeadlineAt === claim.operationDeadlineAt
    && authority.operationClaimSha256 === releaseSha256V2(
      Buffer.from(`${canonicalReleaseJsonV2(claim)}\n`, "utf8"))
    && authority.intentRelativePath === intent.relativePath
    && authority.intentSha256 === input.intentSha256
    && authority.intentSha256 === releaseSha256V2(
      Buffer.from(`${canonicalReleaseJsonV2(intent)}\n`, "utf8"))
    && authority.operationId === intent.operationId
    && authority.operationClaimSha256 === intent.operationClaimSha256
    && authority.authorityConsumptionSha256 === intent.authorityConsumptionSha256
    && authority.sequence === intent.sequence
    && authority.stepId === intent.stepId
    && authority.inputSha256 === intent.inputSha256
    && authority.intendedExternalEffectSha256 === intent.intendedExternalEffectSha256
    && authority.operationLeaseSha256 === intent.currentOperationLeaseSha256
    && authority.operationLeaseEpoch === intent.currentOperationLeaseEpoch
    && freeze.releaseGenerationId === authority.generationId
    && freeze.candidateSha === authority.candidateSha
    && freeze.artifactRootFingerprintSha256 === lease.artifactRootFingerprintSha256
    && claim.capability === "effect_capable"
    && SHA256.test(input.takeoverChainSha256);
  if (!bound || input.leaseSha256 !== releaseSha256V2(Buffer.from(`${canonicalReleaseJsonV2(lease)}\n`, "utf8"))
      || input.claimSha256 !== authority.operationClaimSha256
      || input.intentSha256 !== authority.intentSha256
      || now >= Date.parse(lease.expiresAt) || now >= Date.parse(lease.operationDeadlineAt)
      || now >= Date.parse(String(authority.expiresAt))) {
    throw new Error("repo_runtime_authority_protection_binding_invalid");
  }
  return { freeze, lease, claim, intent };
}

export function validateTask0BSanitizedRehearsalAuthority(value: unknown): {
  task0bVerified: true;
  databaseRole: "runtime_sanitized";
  databaseName: "tron_watch_plan5_runtime_sanitized";
  telegramTransport: "recording_disabled";
  executorPath: "scripts/rehearseRemediationRuntime.ts";
} {
  const authority = record(value, "task0b_sanitized_rehearsal_authority_invalid");
  exactKeys(authority, ["task0bVerified", "databaseRole", "databaseName", "telegramTransport", "executorPath"],
    "task0b_sanitized_rehearsal_authority_invalid");
  if (authority.task0bVerified !== true || authority.databaseRole !== "runtime_sanitized"
      || authority.databaseName !== "tron_watch_plan5_runtime_sanitized"
      || authority.telegramTransport !== "recording_disabled"
      || authority.executorPath !== "scripts/rehearseRemediationRuntime.ts") {
    throw new Error("task0b_sanitized_rehearsal_transport_unverified");
  }
  return authority as ReturnType<typeof validateTask0BSanitizedRehearsalAuthority>;
}

export function runtimeGenerationEvidencePath(
  kind: "start" | "stop",
  generationId: string,
  commandId: RuntimeCommandId,
  authoritySha256: string
): string {
  if (!GENERATION.test(generationId)) throw new Error("task0b_runtime_generation_invalid");
  const kindMatches = kind === "start"
    ? commandId === "runtime_manager_start_candidate" || commandId === "runtime_manager_rollback_previous"
    : commandId === "runtime_manager_stop_candidate" || commandId === "runtime_manager_stop_previous";
  if (!kindMatches || !SHA256.test(authoritySha256)) throw new Error("task0b_runtime_effect_identity_invalid");
  return `runtime-${kind}-evidence-${generationId}-${commandId}-${authoritySha256}.json`;
}

export function runtimeAuthorityFilename(
  generationId: string,
  commandId: RuntimeCommandId,
  authoritySha256?: string
): string {
  if (!GENERATION.test(generationId) || !RUNTIME_ACTION_PHASES[commandId]) {
    throw new Error("task0b_runtime_authority_filename_invalid");
  }
  if (authoritySha256 !== undefined && !SHA256.test(authoritySha256)) {
    throw new Error("task0b_runtime_authority_filename_invalid");
  }
  return `runtime-authority-${generationId}-${commandId}${authoritySha256 ? `-${authoritySha256}` : ""}.json`;
}

export type RuntimeManagerAuthorityConsumptionV1 = Readonly<{
  version: "runtime-manager-authority-consumption-v1";
  generationId: string;
  authoritySha256: string;
  commandId: RuntimeCommandId;
  consumedAt: string;
}>;

type RuntimeManagerEffectBinding = Readonly<{
  generationId: string;
  commandId: RuntimeCommandId;
  authoritySha256: string;
  targetRuntimeSha: string;
  targetRuntimeLabel: string;
}>;

type RuntimeManagerStartEvidenceV1 = Readonly<{
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
}>;

export type RuntimeManagerStartEffectEvidenceV2 = Readonly<{
  version: "runtime-manager-start-effect-evidence-v2";
  generationId: string;
  commandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous";
  authoritySha256: string;
  targetRuntimeSha: string;
  targetRuntimeLabel: string;
  runtimeEvidence: RuntimeManagerStartEvidenceV1;
}>;

export type RuntimeManagerStopEffectEvidenceV2 = Readonly<{
  version: "runtime-manager-stop-effect-evidence-v2";
  generationId: string;
  commandId: "runtime_manager_stop_candidate" | "runtime_manager_stop_previous";
  authoritySha256: string;
  targetRuntimeSha: string;
  targetRuntimeLabel: string;
  startEvidencePath: string;
  startEvidenceSha256: string;
  stoppedProcessId: number;
  stoppedProcessStartedAt: string;
  stoppedAt: string;
  forcePolicy: ForcePolicy;
  runtimeCandidatesAfter: 0;
  verified: true;
}>;

export function canonicalRuntimeManagerArtifactBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");
}

export function validateCanonicalTask0BProductionRuntimeAuthorityBytesV2(
  bytes: Buffer,
  evaluatedAt: string
): Task0BProductionRuntimeAuthorityV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("task0b_runtime_authority_json_invalid"); }
  const authority = validateTask0BProductionRuntimeAuthority(parsed, evaluatedAt);
  if (!bytes.equals(canonicalRuntimeManagerArtifactBytes(authority))) {
    throw new Error("task0b_runtime_authority_noncanonical");
  }
  return authority;
}

export function validateRuntimeManagerAuthorityConsumptionV1(
  value: unknown,
  expected: Readonly<{
    generationId: string;
    commandId: RuntimeCommandId;
    authoritySha256: string;
    issuedAt: string;
    expiresAt: string;
  }>
): RuntimeManagerAuthorityConsumptionV1 {
  const consumption = record(value, "task0b_runtime_authority_consumption_invalid");
  exactKeys(consumption, ["version", "generationId", "authoritySha256", "commandId", "consumedAt"],
    "task0b_runtime_authority_consumption_shape_invalid");
  const consumedAt = parseIso(consumption.consumedAt, "task0b_runtime_authority_consumption_time_invalid");
  const issuedAt = parseIso(expected.issuedAt, "task0b_runtime_authority_consumption_time_invalid");
  const expiresAt = parseIso(expected.expiresAt, "task0b_runtime_authority_consumption_time_invalid");
  if (consumption.version !== "runtime-manager-authority-consumption-v1"
      || consumption.generationId !== expected.generationId
      || consumption.commandId !== expected.commandId
      || consumption.authoritySha256 !== expected.authoritySha256
      || !GENERATION.test(expected.generationId) || !SHA256.test(expected.authoritySha256)
      || consumedAt < issuedAt || consumedAt >= expiresAt) {
    throw new Error("task0b_runtime_authority_consumption_binding_invalid");
  }
  return {
    version: "runtime-manager-authority-consumption-v1",
    generationId: expected.generationId,
    authoritySha256: expected.authoritySha256,
    commandId: expected.commandId,
    consumedAt: consumedAt.toISOString()
  };
}

function validateRuntimeManagerStartEvidenceV1(
  value: unknown,
  expected: Readonly<{ generationId: string; runtimeSha: string; runtimeLabel: string }>
): RuntimeManagerStartEvidenceV1 {
  const evidence = record(value, "task0b_runtime_start_evidence_invalid");
  exactKeys(evidence, [
    "version", "generationId", "runtimeSha", "runtimeLabel", "processId", "processStartedAt",
    "commandLineSha256", "executablePathSha256", "workingDirectoryFingerprintSha256",
    "entrypointPathFingerprintSha256", "managerExecutableSha256", "attestedAt", "producerId", "commandId",
    "templateSha256", "exitCode"
  ], "task0b_runtime_start_evidence_shape_invalid");
  const processStartedAt = parseIso(evidence.processStartedAt, "task0b_runtime_start_evidence_time_invalid");
  const attestedAt = parseIso(evidence.attestedAt, "task0b_runtime_start_evidence_time_invalid");
  if (evidence.version !== "runtime-manager-start-evidence-v1"
      || evidence.generationId !== expected.generationId || evidence.runtimeSha !== expected.runtimeSha
      || evidence.runtimeLabel !== expected.runtimeLabel || !GENERATION.test(expected.generationId)
      || !SHA40.test(expected.runtimeSha) || typeof expected.runtimeLabel !== "string"
      || !expected.runtimeLabel.includes(expected.runtimeSha.slice(0, 8))
      || !Number.isSafeInteger(evidence.processId) || Number(evidence.processId) < 1
      || attestedAt < processStartedAt || attestedAt.getTime() - processStartedAt.getTime() > 2 * 60_000
      || evidence.producerId !== "task0b_repo_runtime_manager_v1"
      || evidence.commandId !== "runtime_manager_previous_identity"
      || evidence.templateSha256 !== TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256.runtime_manager_previous_identity
      || evidence.exitCode !== 0) throw new Error("task0b_runtime_start_evidence_binding_invalid");
  for (const field of ["commandLineSha256", "executablePathSha256", "workingDirectoryFingerprintSha256",
    "entrypointPathFingerprintSha256", "managerExecutableSha256"] as const) {
    if (!SHA256.test(String(evidence[field]))) throw new Error("task0b_runtime_start_evidence_binding_invalid");
  }
  return evidence as RuntimeManagerStartEvidenceV1;
}

export function validateRuntimeManagerStartEffectEvidenceV2(
  value: unknown,
  expected: RuntimeManagerEffectBinding & Readonly<{
    commandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous";
  }>
): RuntimeManagerStartEffectEvidenceV2 {
  const evidence = record(value, "task0b_runtime_start_effect_evidence_invalid");
  exactKeys(evidence, ["version", "generationId", "commandId", "authoritySha256", "targetRuntimeSha",
    "targetRuntimeLabel", "runtimeEvidence"], "task0b_runtime_start_effect_evidence_shape_invalid");
  if (evidence.version !== "runtime-manager-start-effect-evidence-v2"
      || evidence.generationId !== expected.generationId || evidence.commandId !== expected.commandId
      || evidence.authoritySha256 !== expected.authoritySha256
      || evidence.targetRuntimeSha !== expected.targetRuntimeSha
      || evidence.targetRuntimeLabel !== expected.targetRuntimeLabel
      || !new Set(["runtime_manager_start_candidate", "runtime_manager_rollback_previous"]).has(expected.commandId)
      || !SHA256.test(expected.authoritySha256)) {
    throw new Error("task0b_runtime_start_effect_evidence_binding_invalid");
  }
  const runtimeEvidence = validateRuntimeManagerStartEvidenceV1(evidence.runtimeEvidence, {
    generationId: expected.generationId,
    runtimeSha: expected.targetRuntimeSha,
    runtimeLabel: expected.targetRuntimeLabel
  });
  return {
    version: "runtime-manager-start-effect-evidence-v2",
    generationId: expected.generationId,
    commandId: expected.commandId,
    authoritySha256: expected.authoritySha256,
    targetRuntimeSha: expected.targetRuntimeSha,
    targetRuntimeLabel: expected.targetRuntimeLabel,
    runtimeEvidence
  };
}

export function validateRuntimeManagerStopEffectEvidenceV2(
  value: unknown,
  expected: RuntimeManagerEffectBinding & Readonly<{
    commandId: "runtime_manager_stop_candidate" | "runtime_manager_stop_previous";
  }>
): RuntimeManagerStopEffectEvidenceV2 {
  const evidence = record(value, "task0b_runtime_stop_effect_evidence_invalid");
  exactKeys(evidence, ["version", "generationId", "commandId", "authoritySha256", "targetRuntimeSha",
    "targetRuntimeLabel", "startEvidencePath", "startEvidenceSha256", "stoppedProcessId",
    "stoppedProcessStartedAt", "stoppedAt", "forcePolicy", "runtimeCandidatesAfter", "verified"],
  "task0b_runtime_stop_effect_evidence_shape_invalid");
  const startedAt = parseIso(evidence.stoppedProcessStartedAt, "task0b_runtime_stop_effect_evidence_time_invalid");
  const stoppedAt = parseIso(evidence.stoppedAt, "task0b_runtime_stop_effect_evidence_time_invalid");
  if (evidence.version !== "runtime-manager-stop-effect-evidence-v2"
      || evidence.generationId !== expected.generationId || evidence.commandId !== expected.commandId
      || evidence.authoritySha256 !== expected.authoritySha256
      || evidence.targetRuntimeSha !== expected.targetRuntimeSha
      || evidence.targetRuntimeLabel !== expected.targetRuntimeLabel
      || !new Set(["runtime_manager_stop_candidate", "runtime_manager_stop_previous"]).has(expected.commandId)
      || !SHA256.test(expected.authoritySha256) || !SHA40.test(expected.targetRuntimeSha)
      || typeof evidence.startEvidencePath !== "string" || !START_EVIDENCE.test(evidence.startEvidencePath)
      || !SHA256.test(String(evidence.startEvidenceSha256))
      || !Number.isSafeInteger(evidence.stoppedProcessId) || Number(evidence.stoppedProcessId) < 1
      || stoppedAt < startedAt || !new Set(["graceful_only", "graceful_then_force"]).has(String(evidence.forcePolicy))
      || evidence.runtimeCandidatesAfter !== 0 || evidence.verified !== true) {
    throw new Error("task0b_runtime_stop_effect_evidence_binding_invalid");
  }
  return evidence as RuntimeManagerStopEffectEvidenceV2;
}

export function runtimeGenerationConsumptionPath(
  generationId: string,
  commandId: RuntimeCommandId,
  authoritySha256: string
): string {
  if (!GENERATION.test(generationId)) throw new Error("task0b_runtime_generation_invalid");
  if (!RUNTIME_ACTION_PHASES[commandId] || !SHA256.test(authoritySha256)) {
    throw new Error("task0b_runtime_effect_identity_invalid");
  }
  return `runtime-authority-consumed-${generationId}-${commandId}-${authoritySha256}.json`;
}

export function runtimeGenerationDiagnosticPaths(
  generationId: string,
  commandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous",
  authoritySha256: string
): Readonly<{
  stdout: string;
  stderr: string;
  binding: string;
}> {
  if (!GENERATION.test(generationId)) throw new Error("task0b_runtime_generation_invalid");
  if (!new Set(["runtime_manager_start_candidate", "runtime_manager_rollback_previous"]).has(commandId)
      || !SHA256.test(authoritySha256)) throw new Error("task0b_runtime_diagnostic_identity_invalid");
  const suffix = `${generationId}-${commandId}-${authoritySha256}`;
  return {
    stdout: `runtime-stdout-${suffix}.jsonl`,
    stderr: `runtime-stderr-${suffix}.jsonl`,
    binding: `runtime-log-binding-${suffix}.json`
  };
}

const OPTIONAL_PRODUCTION_ENV = [
  "SERVICE_ADMIN_TG_IDS", "TRONSCAN_API_KEY", "TRONSCAN_API_KEY_GROUPS", "TRONSCAN_BASE_URL",
  "TRONSCAN_PAGE_LIMIT", "TRONSCAN_MAX_IN_FLIGHT", "TRONSCAN_GROUP_MAX_IN_FLIGHT", "TRONSCAN_MAX_PAGES_PER_WALLET",
  "TRONSCAN_TIMEOUT_MS", "TRONSCAN_RETRY_ATTEMPTS", "TRONSCAN_RETRY_BASE_DELAY_MS", "TRONSCAN_BACKFILL_LOOKBACK_MS",
  "TRONSCAN_REQUEST_MIN_INTERVAL_MS", "TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS", "TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS",
  "TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS", "TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS",
  "TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS", "TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS",
  "TRONGRID_REQUEST_MIN_INTERVAL_MS", "TRONSCAN_RATE_LIMIT_COOLDOWN_MS", "TRONSCAN_DASHBOARD_CACHE_TTL_MS",
  "TRONSCAN_DASHBOARD_MAX_PAGES", "TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS",
  "TRON_FULLNODE_BASE_URL", "TRON_FULLNODE_API_KEY", "RANGE_API_KEY", "RANGE_BASE_URL", "RANGE_TIMEOUT_MS",
  "RANGE_MAX_CALLS_PER_CHECK", "EVM_EXPLORER_API_KEY",
  "ETHERSCAN_API_KEY", "EVM_EXPLORER_BASE_URL", "ALCHEMY_API_KEY", "THEFT_REPORT_DEPOSIT_ADDRESS",
  "EVM_EXPLORER_TIMEOUT_MS", "EVM_EXPLORER_MAX_CALLS_PER_CHECK", "ALCHEMY_TIMEOUT_MS",
  "THEFT_REPORT_GUIDE_URL", "THEFT_REPORT_ADMIN_CONTACT", "ADMIN_DASHBOARD_TOKEN", "BOT_BETA_RISK_DIAGNOSTICS",
  "CROSS_CHAIN_STAGE2_ENABLED", "CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS", "CROSS_CHAIN_STAGE2_CACHE_TTL_MS",
  "FORENSIC_WHERE_POLL_INTERVAL_MS", "FORENSIC_WHERE_JOBS_PER_POLL", "FORENSIC_INCOMING_POLL_INTERVAL_MS",
  "FORENSIC_INCOMING_JOBS_PER_POLL", "FORENSIC_DEEP_POLL_INTERVAL_MS", "FORENSIC_JOB_STALE_AFTER_MS",
  "FORENSIC_JOB_MAX_RETRIES", "TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB",
  "ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS", "TRON_ADDRESS_INDEX_CLAIM_LIMIT", "TRON_ADDRESS_INDEX_LOCK_MS",
  "TRON_ADDRESS_INDEX_POLL_INTERVAL_MS", "TRON_ADDRESS_INDEX_PAGE_BATCH_SIZE", "DIRECT_HARD_EVIDENCE_LIVE_LIMIT",
  "DIRECT_HARD_EVIDENCE_CONCURRENCY", "POLL_INTERVAL_MS", "POLL_START_DELAY_MS",
  "INCOMING_DEPOSIT_REALTIME_MAX_AGE_MS", "ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT",
  "FORENSIC_WHERE_START_DELAY_MS", "FORENSIC_INCOMING_START_DELAY_MS", "FORENSIC_DEEP_START_DELAY_MS"
] as const;
const SAFE_BASE_ENV = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP"] as const;

export function buildTask0BProductionRuntimeEnvironment(
  source: NodeJS.ProcessEnv,
  authorityInput: unknown,
  noDotenvPath: string
): NodeJS.ProcessEnv {
  const authority = validateTask0BProductionRuntimeAuthority(authorityInput);
  const databaseUrl = source.TASK0B_PRODUCTION_DATABASE_URL;
  assertTask0BProductionTelegramBinding(authority, source.BOT_TOKEN);
  if (!databaseUrl || !isAbsolute(noDotenvPath)) throw new Error("task0b_runtime_production_environment_missing");
  let database: URL;
  try { database = new URL(databaseUrl); } catch { throw new Error("task0b_runtime_production_database_invalid"); }
  if (database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1"
      || decodeURIComponent(database.pathname.slice(1)) !== "tron_watch" || database.search || database.hash) {
    throw new Error("task0b_runtime_production_database_invalid");
  }
  const admin = parseAdminUrl(authority.adminUrl);
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...SAFE_BASE_ENV, ...OPTIONAL_PRODUCTION_ENV]) if (source[key] !== undefined) env[key] = source[key];
  Object.assign(env, {
    BOT_TOKEN: source.BOT_TOKEN,
    DATABASE_URL: databaseUrl,
    RUNTIME_GIT_SHA: authority.targetRuntimeSha,
    RUNTIME_INSTANCE_LABEL: authority.targetRuntimeLabel,
    ADMIN_DASHBOARD_ENABLED: "true",
    ADMIN_DASHBOARD_HOST: admin.hostname,
    ADMIN_DASHBOARD_PORT: admin.port,
    LLM_CONTRACT_ANALYSIS_ENABLED: "false",
    DOTENV_CONFIG_PATH: noDotenvPath
  });
  return env;
}

export function assertTask0BProductionTelegramBinding(
  authority: Task0BProductionRuntimeAuthorityV1,
  botToken: string | undefined
): void {
  if (!botToken || hash(botToken) !== authority.telegramBotIdentitySha256) {
    throw new Error("task0b_runtime_production_telegram_identity_unverified");
  }
}

export function validateTask0BReleaseManifestBinding(
  authority: Task0BProductionRuntimeAuthorityV1,
  manifestBytes: Buffer
): RemediationReleaseManifestV2 {
  if (hash(manifestBytes) !== authority.releaseManifestSha256) {
    throw new Error("task0b_runtime_release_manifest_hash_binding_invalid");
  }
  let value: unknown;
  try { value = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw new Error("task0b_runtime_release_manifest_json_invalid"); }
  const manifest = validateRemediationReleaseManifestV2(value);
  if (!manifestBytes.equals(Buffer.from(`${canonicalReleaseJsonV2(manifest)}\n`, "utf8"))) {
    throw new Error("task0b_runtime_release_manifest_noncanonical");
  }
  if (manifest.candidateSha !== authority.candidateSha
      || manifest.overall !== authority.releaseManifestOverall
      || manifest.transitionId !== authority.releaseManifestTransitionId
      || authority.releaseManifestSha256 !== authority.sourceManifestSha256) {
    throw new Error("task0b_runtime_release_manifest_authority_binding_invalid");
  }
  return manifest;
}

function assertTask0BActionPhase(
  authority: Task0BProductionRuntimeAuthorityV1,
  manifest: RemediationReleaseManifestV2
): void {
  if (manifest.overall !== "not_ready"
      || authority.releaseManifestOverall !== manifest.overall
      || authority.actionPhase !== RUNTIME_ACTION_PHASES[authority.commandId]) {
    throw new Error("task0b_runtime_action_phase_unverified");
  }
  switch (authority.commandId) {
    case "runtime_manager_stop_previous":
    case "runtime_manager_start_candidate":
      if (manifest.transitionId !== "g13_migration_passed") {
        throw new Error("task0b_runtime_post_migration_rollout_phase_unverified");
      }
      return;
    case "runtime_manager_stop_candidate":
    case "runtime_manager_rollback_previous":
      if (manifest.transitionId !== "production_failed"
          || !manifest.gates.some((gate) => (gate.id === "G14_PRODUCTION_ROLLOUT"
            || gate.id === "G15_PRODUCTION_CANARY") && gate.state === "failed")) {
        throw new Error("task0b_runtime_rollback_previous_start_phase_unverified");
      }
      return;
  }
}

export function assertTask0BProductionGoBindings(
  authority: Task0BProductionRuntimeAuthorityV1,
  task0b: {
    candidateSha: string;
    previousRuntimeSha: string;
    previousRuntimeLabel: string;
    candidateWorktree: { worktreePathFingerprintSha256: string };
    previousRuntimeIdentity: { workingDirectoryFingerprintSha256: string };
    rollbackWorktree: { worktreePathFingerprintSha256: string };
    productionDatabase: { approvedIdentityFingerprintSha256: string };
    runtimeManager: { executorPath: string; executorSha256: string; candidateAdminUrl: string };
  },
  manifestValue: unknown,
  observedDatabase: { approvedIdentityFingerprintSha256: string },
  managerExecutableSha256: string
): void {
  const manifest = validateRemediationReleaseManifestV2(manifestValue);
  assertTask0BActionPhase(authority, manifest);
  const candidateAction = authority.commandId === "runtime_manager_start_candidate"
    || authority.commandId === "runtime_manager_stop_candidate";
  const expectedWorktreeFingerprint = candidateAction
    ? task0b.candidateWorktree.worktreePathFingerprintSha256
    : task0b.rollbackWorktree.worktreePathFingerprintSha256;
  if (task0b.candidateSha !== authority.candidateSha || manifest.candidateSha !== authority.candidateSha
      || manifest.releaseFreezeIdentitySha256 !== authority.releaseFreezeIdentitySha256
      || authority.sourceManifestSha256 !== authority.releaseManifestSha256
      || (candidateAction
        ? authority.targetRuntimeSha !== task0b.candidateSha
        : authority.targetRuntimeSha !== task0b.previousRuntimeSha
          || authority.targetRuntimeLabel !== task0b.previousRuntimeLabel)
      || authority.targetWorktreeFingerprintSha256 !== expectedWorktreeFingerprint
      || task0b.productionDatabase.approvedIdentityFingerprintSha256 !== authority.databaseIdentityFingerprintSha256
      || observedDatabase.approvedIdentityFingerprintSha256 !== authority.databaseIdentityFingerprintSha256
      || task0b.runtimeManager.executorPath !== "scripts/manageTask0BRuntime.ts"
      || task0b.runtimeManager.executorSha256 !== managerExecutableSha256
      || (authority.commandId === "runtime_manager_start_candidate"
        && authority.adminUrl !== task0b.runtimeManager.candidateAdminUrl)) {
    throw new Error("task0b_runtime_production_go_binding_unverified");
  }
}

export function validateTask0BProductionGoEvidence(
  authorityValue: unknown,
  task0bValue: unknown,
  operatorConfigBindingValue: unknown,
  evaluatedAt: string
): {
  authority: Task0BProductionRuntimeAuthorityV1;
  task0b: ReturnType<typeof validateTask0BReleaseFreezeEvidence>;
} {
  const authority = validateTask0BProductionRuntimeAuthority(authorityValue, evaluatedAt);
  const task0b = validateTask0BReleaseFreezeEvidence(task0bValue, authority.candidateSha, evaluatedAt);
  const binding = record(operatorConfigBindingValue, "task0b_runtime_operator_config_binding_invalid");
  const expected = task0b.operatorConfig;
  exactKeys(binding, ["filename", "contentSha256", "fileIdentitySha256", "configExpiresAt", "source", "verified"],
    "task0b_runtime_operator_config_binding_invalid");
  if (binding.filename !== expected.filename || binding.contentSha256 !== expected.contentSha256
      || binding.fileIdentitySha256 !== expected.fileIdentitySha256 || binding.configExpiresAt !== expected.configExpiresAt
      || binding.source !== expected.source || binding.verified !== expected.verified) {
    throw new Error("task0b_runtime_operator_config_binding_changed");
  }
  return { authority, task0b };
}

export async function completeTask0BManagedRuntimeStart(input: {
  generationId: string;
  commandId: "runtime_manager_start_candidate" | "runtime_manager_rollback_previous";
  authoritySha256: string;
  processId: number;
  evidence: unknown;
  writeEvidence(path: string, evidence: unknown): Promise<void>;
  terminateAndVerify(processId: number): Promise<void>;
  faultHooks?: Readonly<{
    afterObservedBeforeEvidence?(): void | Promise<void>;
    afterEvidenceBeforeReturn?(): void | Promise<void>;
  }>;
}): Promise<{ processId: number; evidencePath: string }> {
  const evidencePath = runtimeGenerationEvidencePath("start", input.generationId, input.commandId,
    input.authoritySha256);
  let evidenceWritten = false;
  try {
    await input.faultHooks?.afterObservedBeforeEvidence?.();
    await input.writeEvidence(evidencePath, input.evidence);
    evidenceWritten = true;
    await input.faultHooks?.afterEvidenceBeforeReturn?.();
  } catch (error) {
    if (!evidenceWritten) await input.terminateAndVerify(input.processId);
    throw error;
  }
  return { processId: input.processId, evidencePath };
}

export async function completeTask0BManagedRuntimeStop<T>(input: {
  processId: number;
  evidencePath: string;
  performStop(): Promise<void>;
  buildEvidence(): T;
  writeEvidence(path: string, evidence: T): Promise<void>;
  faultHooks?: Readonly<{
    afterStopBeforeEvidence?(): void | Promise<void>;
    afterEvidenceBeforeReturn?(): void | Promise<void>;
  }>;
}): Promise<{ status: "stopped"; processId: number; evidencePath: string }> {
  await input.performStop();
  await input.faultHooks?.afterStopBeforeEvidence?.();
  await input.writeEvidence(input.evidencePath, input.buildEvidence());
  await input.faultHooks?.afterEvidenceBeforeReturn?.();
  return { status: "stopped", processId: input.processId, evidencePath: input.evidencePath };
}

export async function executeTask0BAuthorizedStart<T>(dependencies: {
  countRuntimeCandidates(): Promise<number>;
  consumeAuthority(): Promise<void>;
  startRuntime(): Promise<T>;
}): Promise<T> {
  if (await dependencies.countRuntimeCandidates() !== 0) {
    throw new Error("task0b_runtime_manager_overlap_detected");
  }
  await dependencies.consumeAuthority();
  return dependencies.startRuntime();
}

export async function executeTask0BAuthorizedAction<TPrepared, TResult>(dependencies: {
  prepare(): Promise<TPrepared>;
  revalidateBeforeConsumption(): void | Promise<void>;
  consumeAuthority(): Promise<void>;
  recheckLive(prepared: TPrepared): Promise<void>;
  revalidateImmediatelyBeforeMutation(): void | Promise<void>;
  mutateRuntime(prepared: TPrepared): Promise<TResult>;
}): Promise<TResult> {
  const prepared = await dependencies.prepare();
  await dependencies.revalidateBeforeConsumption();
  await dependencies.consumeAuthority();
  await dependencies.recheckLive(prepared);
  await dependencies.revalidateImmediatelyBeforeMutation();
  return dependencies.mutateRuntime(prepared);
}

export async function stopTask0BManagedRuntime(
  expected: RuntimeIdentity,
  forcePolicy: ForcePolicy,
  dependencies: {
    observeExact(): Promise<RuntimeIdentity | null>;
    countRuntimeCandidates(): Promise<number>;
    signal(processId: number, signal: "SIGTERM" | "SIGKILL"): void;
    wait(ms: number): Promise<void>;
  },
  timing: { timeoutMs: number; pollMs: number } = { timeoutMs: 30_000, pollMs: 250 }
): Promise<void> {
  const before = await dependencies.observeExact();
  if (!before || before.processId !== expected.processId || before.processStartedAt !== expected.processStartedAt
      || before.runtimeProcessCount !== 1) throw new Error("task0b_runtime_stop_identity_unverified");
  dependencies.signal(expected.processId, "SIGTERM");
  const waitForExit = async (): Promise<boolean> => {
    const deadline = Date.now() + timing.timeoutMs;
    do {
      await dependencies.wait(timing.pollMs);
      if (await dependencies.observeExact() === null) return true;
    } while (Date.now() < deadline);
    return false;
  };
  let exited = await waitForExit();
  if (!exited && forcePolicy === "graceful_then_force") {
    dependencies.signal(expected.processId, "SIGKILL");
    exited = await waitForExit();
  }
  if (!exited) throw new Error("task0b_runtime_graceful_stop_timeout");
  if (await dependencies.countRuntimeCandidates() !== 0) throw new Error("task0b_runtime_stop_overlap_detected");
}

async function writeProtectedExclusive(artifactRoot: string, filename: string, value: unknown): Promise<Buffer> {
  const path = join(artifactRoot, filename);
  const bytes = canonicalRuntimeManagerArtifactBytes(value);
  const handle = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return bytes;
}

async function readProtectedRelativeRegularFile(
  artifactRoot: string,
  relativePath: string,
  maxBytes: number
): Promise<Buffer> {
  if (!/^[A-Za-z0-9._/-]+$/u.test(relativePath) || relativePath.startsWith("/")
      || relativePath.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error("task0b_artifact_relative_path_invalid");
  }
  const requested = resolve(artifactRoot, ...relativePath.split("/"));
  const rootPrefix = `${resolve(artifactRoot)}${process.platform === "win32" ? "\\" : "/"}`;
  if (!(process.platform === "win32" ? requested.toLowerCase().startsWith(rootPrefix.toLowerCase())
    : requested.startsWith(rootPrefix))) throw new Error("task0b_artifact_relative_path_invalid");
  await inspectProtectedPathChain(requested);
  const physical = resolve(await realpath(requested));
  if (!sameCanonicalPath(physical, requested)) throw new Error("task0b_artifact_symlink_rejected");
  const bytes = await readFile(physical);
  if (bytes.length > maxBytes) throw new Error("task0b_artifact_file_invalid");
  return bytes;
}

async function run(command: string, args: readonly string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(command, [...args], { cwd, windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function attestWorktree(authority: Task0BProductionRuntimeAuthorityV1): Promise<string> {
  const worktree = await inspectRealDirectory(authority.targetWorktreePath, false);
  const [head, status, topLevel] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], worktree),
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"], worktree),
    run("git", ["rev-parse", "--show-toplevel"], worktree)
  ]);
  const physical = resolve(await realpath(topLevel));
  if (head !== authority.targetRuntimeSha || status !== "" || !sameCanonicalPath(physical, worktree)
      || hash(process.platform === "win32" ? physical.toLowerCase() : physical) !== authority.targetWorktreeFingerprintSha256) {
    throw new Error("task0b_runtime_manager_worktree_unverified");
  }
  return physical;
}

async function loadAndVerifyAuthority(artifactRoot: string, filename: string): Promise<{
  authority: Task0BProductionRuntimeAuthorityV1;
  authorityBytes: Buffer;
  task0bBytes: Buffer;
  revalidateBeforeConsumption(): Promise<void>;
}> {
  const evaluatedAt = new Date().toISOString();
  const authorityBytes = await readProtectedRegularFile(artifactRoot, filename, MAX_ARTIFACT_BYTES);
  const canonicalAuthority = validateCanonicalTask0BProductionRuntimeAuthorityBytesV2(authorityBytes, evaluatedAt);
  const task0bBytes = await readProtectedRegularFile(artifactRoot, "task0b-release-freeze.json", MAX_ARTIFACT_BYTES);
  const external = await readExternalConfig(artifactRoot);
  const { authority, task0b } = validateTask0BProductionGoEvidence(
    canonicalAuthority,
    JSON.parse(task0bBytes.toString("utf8")),
    external.binding,
    evaluatedAt
  );
  const authoritySha256 = hash(authorityBytes);
  if (filename !== runtimeAuthorityFilename(authority.generationId, authority.commandId)
      && filename !== runtimeAuthorityFilename(authority.generationId, authority.commandId, authoritySha256)) {
    throw new Error("task0b_runtime_authority_filename_invalid");
  }
  const loadProtectedOperation = async () => {
    const freezeBytes = await readProtectedRegularFile(artifactRoot, "release-freeze-identity-v2.json", MAX_ARTIFACT_BYTES);
    const leaseBytes = await readProtectedRegularFile(artifactRoot, PRODUCTION_OPERATION_LEASE_FILE_V2, MAX_ARTIFACT_BYTES);
    const leaseValue = validateProductionOperationLeaseV2(JSON.parse(leaseBytes.toString("utf8")));
    const claimFilename = `production-operation-claim-${leaseValue.operationalAttestationSha256}.json`;
    const claimBytes = await readProtectedRegularFile(artifactRoot, claimFilename, MAX_ARTIFACT_BYTES);
    const intentBytes = await readProtectedRelativeRegularFile(artifactRoot, authority.intentRelativePath, MAX_ARTIFACT_BYTES);
    for (const [bytes, value, label] of [
      [freezeBytes, validateReleaseFreezeIdentityV2(JSON.parse(freezeBytes.toString("utf8"))), "freeze"],
      [leaseBytes, leaseValue, "lease"],
      [claimBytes, validateProductionOperationClaimV2(JSON.parse(claimBytes.toString("utf8"))), "claim"],
      [intentBytes, validateProductionOrchestrationStepIntentV2(JSON.parse(intentBytes.toString("utf8"))), "intent"]
    ] as const) {
      if (!bytes.equals(Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8"))) {
        throw new Error(`repo_runtime_authority_${label}_noncanonical`);
      }
    }
    const lineage = new ProductionOperationStoreV2(artifactRoot)
      .verifyImmutableAuthorityLineage(authority.operationId, new Date().toISOString());
    if (lineage.leaseSha256 !== releaseSha256V2(leaseBytes)
        || lineage.claimSha256 !== releaseSha256V2(claimBytes)) {
      throw new Error("repo_runtime_authority_takeover_lineage_binding_invalid");
    }
    const parentFingerprint = observedProcessStartFingerprintSha256V2(process.ppid);
    if (parentFingerprint === null) throw new Error("repo_runtime_authority_parent_unverified");
    return validateRepoIssuedRuntimeAuthorityProtectionV2(authority, {
      freezeValue: JSON.parse(freezeBytes.toString("utf8")),
      leaseValue,
      leaseSha256: releaseSha256V2(leaseBytes),
      claimValue: JSON.parse(claimBytes.toString("utf8")),
      claimSha256: releaseSha256V2(claimBytes),
      intentValue: JSON.parse(intentBytes.toString("utf8")),
      intentSha256: releaseSha256V2(intentBytes),
      takeoverChainSha256: lineage.takeoverChainSha256,
      lineageLeaseTips: lineage.lineageLeaseTips,
      managerParentIdentity: { pid: process.ppid, processStartFingerprintSha256: parentFingerprint },
      evaluatedAt: new Date().toISOString()
    });
  };
  await loadProtectedOperation();
  if (hash(task0bBytes) !== authority.task0bEvidenceSha256) throw new Error("task0b_runtime_task0b_binding_invalid");
  const managerExecutableSha256 = hash(await readFile(MANAGER_PATH));
  const manifestBytes = await readProtectedRegularFile(artifactRoot, authority.releaseManifestPath, MAX_ARTIFACT_BYTES);
  const manifest = validateTask0BReleaseManifestBinding(authority, manifestBytes);
  const config = validateTask0BPreflightConfig(external.config, evaluatedAt);
  const database = await createTask0BDirectDependencies(config, external.binding).readProductionDatabase();
  assertTask0BProductionGoBindings(authority, task0b, manifest, database, managerExecutableSha256);
  return {
    authority,
    authorityBytes,
    task0bBytes,
    async revalidateBeforeConsumption() {
      const freshNow = new Date().toISOString();
      validateTask0BProductionGoEvidence(
        JSON.parse(authorityBytes.toString("utf8")),
        JSON.parse(task0bBytes.toString("utf8")),
        external.binding,
        freshNow
      );
      validateTask0BPreflightConfig(external.config, freshNow);
      await loadProtectedOperation();
    }
  };
}

async function observeManagedOrNull(processId: number): Promise<Awaited<ReturnType<typeof observeWindowsRuntimeProcess>> | null> {
  if (await countTask0BRuntimeCandidates() === 0) return null;
  return observeWindowsRuntimeProcess(processId);
}

async function terminateExactAndVerify(
  identity: RuntimeIdentity,
  forcePolicy: ForcePolicy
): Promise<void> {
  await stopTask0BManagedRuntime(identity, forcePolicy, {
    observeExact: () => observeManagedOrNull(identity.processId),
    countRuntimeCandidates: countTask0BRuntimeCandidates,
    signal: (processId, signal) => process.kill(processId, signal),
    wait: (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
  });
}

async function terminateSpawnedChildAndVerify(processId: number): Promise<void> {
  const exists = (): boolean => {
    try { process.kill(processId, 0); return true; } catch { return false; }
  };
  if (!exists()) return;
  process.kill(processId, "SIGTERM");
  for (let attempt = 0; attempt < 40 && exists(); attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (exists()) process.kill(processId, "SIGKILL");
  for (let attempt = 0; attempt < 40 && exists(); attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (exists()) throw new Error("task0b_runtime_manager_failed_child_survived");
}

async function prepareStartRuntime(authority: Task0BProductionRuntimeAuthorityV1): Promise<PreparedStartRuntime> {
  if (await countTask0BRuntimeCandidates() !== 0) throw new Error("task0b_runtime_manager_overlap_detected");
  const worktree = await attestWorktree(authority);
  const entrypoint = resolve(worktree, "src", "index.ts");
  const physicalEntrypoint = resolve(await realpath(entrypoint));
  if (!sameCanonicalPath(entrypoint, physicalEntrypoint)) throw new Error("task0b_runtime_manager_entrypoint_unverified");
  return { worktree, physicalEntrypoint };
}

async function recheckStartRuntime(): Promise<void> {
  if (await countTask0BRuntimeCandidates() !== 0) throw new Error("task0b_runtime_manager_overlap_detected");
}

async function startRuntime(
  artifactRoot: string,
  authority: Task0BProductionRuntimeAuthorityV1,
  prepared: PreparedStartRuntime,
  authoritySha256: string
): Promise<unknown> {
  if (authority.commandId !== "runtime_manager_start_candidate"
      && authority.commandId !== "runtime_manager_rollback_previous") {
    throw new Error("task0b_runtime_diagnostic_identity_invalid");
  }
  const diagnosticPaths = runtimeGenerationDiagnosticPaths(authority.generationId, authority.commandId, authoritySha256);
  const openFlags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const stdoutHandle = await open(join(artifactRoot, diagnosticPaths.stdout), openFlags, 0o600);
  let stderrHandle: Awaited<ReturnType<typeof open>> | undefined;
  let child: ReturnType<typeof spawn>;
  try {
    stderrHandle = await open(join(artifactRoot, diagnosticPaths.stderr), openFlags, 0o600);
    await Promise.all([stdoutHandle.sync(), stderrHandle.sync()]);
    await writeProtectedExclusive(artifactRoot, diagnosticPaths.binding, {
      version: "runtime-manager-log-binding-v1",
      generationId: authority.generationId,
      commandId: authority.commandId,
      authoritySha256,
      targetRuntimeSha: authority.targetRuntimeSha,
      stdoutPath: diagnosticPaths.stdout,
      stderrPath: diagnosticPaths.stderr,
      createdAt: new Date().toISOString()
    });
    child = spawn(process.execPath, [
      "--import", "tsx", prepared.physicalEntrypoint,
      "--task0b-manager-producer=task0b_repo_runtime_manager_v1",
      `--task0b-runtime-sha=${authority.targetRuntimeSha}`,
      `--task0b-runtime-label=${authority.targetRuntimeLabel}`
    ], {
      cwd: prepared.worktree,
      env: buildTask0BProductionRuntimeEnvironment(process.env, authority, join(artifactRoot, "plan5-no-dotenv")),
      detached: true,
      stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
      windowsHide: true,
      shell: false
    });
  } finally {
    await stdoutHandle.close();
    if (stderrHandle) await stderrHandle.close();
  }
  if (!child.pid) throw new Error("task0b_runtime_manager_start_failed");
  let observation: Awaited<ReturnType<typeof observeWindowsRuntimeProcess>> | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { observation = await observeWindowsRuntimeProcess(child.pid); break; }
    catch { await new Promise((resolveWait) => setTimeout(resolveWait, 250)); }
  }
  if (!observation || await countTask0BRuntimeCandidates() !== 1) {
    if (observation) await terminateExactAndVerify(observation, "graceful_then_force");
    else await terminateSpawnedChildAndVerify(child.pid);
    throw new Error("task0b_runtime_manager_start_unobserved");
  }
  const runtimeEvidence = createTask0BRuntimeManagerStartEvidence({
    generationId: authority.generationId,
    observation,
    runtimeSha: authority.targetRuntimeSha,
    runtimeLabel: authority.targetRuntimeLabel,
    managerExecutableSha256: hash(await readFile(MANAGER_PATH)),
    attestedAt: new Date().toISOString()
  });
  const evidence = validateRuntimeManagerStartEffectEvidenceV2({
    version: "runtime-manager-start-effect-evidence-v2",
    generationId: authority.generationId,
    commandId: authority.commandId,
    authoritySha256,
    targetRuntimeSha: authority.targetRuntimeSha,
    targetRuntimeLabel: authority.targetRuntimeLabel,
    runtimeEvidence
  }, {
    generationId: authority.generationId,
    commandId: authority.commandId,
    authoritySha256,
    targetRuntimeSha: authority.targetRuntimeSha,
    targetRuntimeLabel: authority.targetRuntimeLabel
  });
  const completed = await completeTask0BManagedRuntimeStart({
    generationId: authority.generationId,
    commandId: authority.commandId,
    authoritySha256,
    processId: child.pid,
    evidence,
    writeEvidence: (filename, value) => writeProtectedExclusive(artifactRoot, filename, value).then(() => undefined),
    terminateAndVerify: () => terminateExactAndVerify(observation!, "graceful_then_force")
  });
  child.unref();
  return { status: "started", diagnosticPaths, ...completed };
}

async function prepareStopRuntime(
  artifactRoot: string,
  authority: Task0BProductionRuntimeAuthorityV1
): Promise<PreparedStopRuntime> {
  if (!authority.startEvidencePath || !authority.startEvidenceSha256) throw new Error("task0b_runtime_stop_evidence_missing");
  const evidenceBytes = await readProtectedRegularFile(artifactRoot, authority.startEvidencePath, MAX_ARTIFACT_BYTES);
  if (hash(evidenceBytes) !== authority.startEvidenceSha256) throw new Error("task0b_runtime_stop_evidence_hash_mismatch");
  let evidence: Record<string, unknown>;
  try { evidence = record(JSON.parse(evidenceBytes.toString("utf8")), "task0b_runtime_stop_evidence_invalid"); }
  catch { throw new Error("task0b_runtime_stop_evidence_invalid"); }
  if (evidence.version === "runtime-manager-start-effect-evidence-v2") {
    const commandId = evidence.commandId;
    const authoritySha256 = evidence.authoritySha256;
    const targetRuntimeSha = evidence.targetRuntimeSha;
    const targetRuntimeLabel = evidence.targetRuntimeLabel;
    if ((commandId !== "runtime_manager_start_candidate" && commandId !== "runtime_manager_rollback_previous")
        || typeof authoritySha256 !== "string" || typeof targetRuntimeSha !== "string"
        || typeof targetRuntimeLabel !== "string") throw new Error("task0b_runtime_stop_evidence_invalid");
    const managed = validateRuntimeManagerStartEffectEvidenceV2(evidence, {
      generationId: String(evidence.generationId), commandId, authoritySha256, targetRuntimeSha, targetRuntimeLabel
    });
    if (authority.startEvidencePath !== runtimeGenerationEvidencePath("start", managed.generationId,
      managed.commandId, managed.authoritySha256)) throw new Error("task0b_runtime_stop_evidence_binding_invalid");
    evidence = managed.runtimeEvidence as unknown as Record<string, unknown>;
  }
  const processId = Number(evidence.processId);
  if (!Number.isSafeInteger(processId) || processId < 1 || await countTask0BRuntimeCandidates() !== 1) {
    throw new Error("task0b_runtime_stop_identity_invalid");
  }
  const observation = await observeWindowsRuntimeProcess(processId);
  const managerExecutableSha256 = hash(await readFile(MANAGER_PATH));
  validateTask0BPreviousRuntimeIdentity(evidence, observation, {
    sha: authority.targetRuntimeSha,
    label: authority.targetRuntimeLabel,
    managerExecutableSha256
  }, authority.startEvidenceSha256);
  return { evidence, processId, observation, managerExecutableSha256 };
}

async function recheckStopRuntime(
  authority: Task0BProductionRuntimeAuthorityV1,
  prepared: PreparedStopRuntime
): Promise<void> {
  if (await countTask0BRuntimeCandidates() !== 1) throw new Error("task0b_runtime_stop_identity_changed");
  const observation = await observeWindowsRuntimeProcess(prepared.processId);
  validateTask0BPreviousRuntimeIdentity(prepared.evidence, observation, {
    sha: authority.targetRuntimeSha,
    label: authority.targetRuntimeLabel,
    managerExecutableSha256: prepared.managerExecutableSha256
  }, authority.startEvidenceSha256!);
}

async function stopRuntime(
  artifactRoot: string,
  authority: Task0BProductionRuntimeAuthorityV1,
  prepared: PreparedStopRuntime,
  authoritySha256: string
): Promise<unknown> {
  if (authority.commandId !== "runtime_manager_stop_candidate"
      && authority.commandId !== "runtime_manager_stop_previous") {
    throw new Error("task0b_runtime_effect_identity_invalid");
  }
  const commandId = authority.commandId;
  const filename = runtimeGenerationEvidencePath("stop", authority.generationId, commandId, authoritySha256);
  return completeTask0BManagedRuntimeStop({
    processId: prepared.processId,
    evidencePath: filename,
    performStop: () => terminateExactAndVerify(prepared.observation, authority.forcePolicy),
    buildEvidence: () => validateRuntimeManagerStopEffectEvidenceV2({
      version: "runtime-manager-stop-effect-evidence-v2",
      generationId: authority.generationId,
      commandId,
      authoritySha256,
      targetRuntimeSha: authority.targetRuntimeSha,
      targetRuntimeLabel: authority.targetRuntimeLabel,
      startEvidencePath: authority.startEvidencePath,
      startEvidenceSha256: authority.startEvidenceSha256,
      stoppedProcessId: prepared.processId,
      stoppedProcessStartedAt: prepared.observation.processStartedAt,
      stoppedAt: new Date().toISOString(),
      forcePolicy: authority.forcePolicy,
      runtimeCandidatesAfter: 0,
      verified: true
    }, {
      generationId: authority.generationId,
      commandId,
      authoritySha256,
      targetRuntimeSha: authority.targetRuntimeSha,
      targetRuntimeLabel: authority.targetRuntimeLabel
    }),
    writeEvidence: (path, value) => writeProtectedExclusive(artifactRoot, path, value).then(() => undefined)
  });
}

async function main(): Promise<void> {
  const [action, artifactRootInput, authorityFilename] = process.argv.slice(2);
  if (!new Set(["start", "stop"]).has(String(action)) || !artifactRootInput || !authorityFilename
      || process.argv.length !== 5) throw new Error("task0b_runtime_manager_arguments_invalid");
  const artifactRoot = await inspectRealDirectory(artifactRootInput, true);
  await inspectProtectedPathChain(artifactRoot);
  const {
    authority,
    authorityBytes,
    revalidateBeforeConsumption
  } = await loadAndVerifyAuthority(artifactRoot, authorityFilename);
  const commandMatches = action === "start"
    ? new Set<RuntimeCommandId>(["runtime_manager_start_candidate", "runtime_manager_rollback_previous"]).has(authority.commandId)
    : new Set<RuntimeCommandId>(["runtime_manager_stop_candidate", "runtime_manager_stop_previous"]).has(authority.commandId);
  if (!commandMatches) throw new Error("task0b_runtime_manager_command_mismatch");
  const expectedTemplate = TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256[authority.commandId];
  if (!SHA256.test(expectedTemplate)) throw new Error("task0b_runtime_manager_template_unverified");
  const consumeAuthority = () => {
    const authoritySha256 = hash(authorityBytes);
    const consumption = validateRuntimeManagerAuthorityConsumptionV1({
      version: "runtime-manager-authority-consumption-v1",
      generationId: authority.generationId,
      authoritySha256,
      commandId: authority.commandId,
      consumedAt: new Date().toISOString()
    }, {
      generationId: authority.generationId,
      commandId: authority.commandId,
      authoritySha256,
      issuedAt: authority.issuedAt,
      expiresAt: authority.expiresAt
    });
    return writeProtectedExclusive(artifactRoot,
      runtimeGenerationConsumptionPath(authority.generationId, authority.commandId, authoritySha256),
      consumption).then(() => undefined);
  };
  const result = action === "start"
    ? await executeTask0BAuthorizedAction({
      async prepare() {
        assertTask0BProductionTelegramBinding(authority, process.env.BOT_TOKEN);
        return prepareStartRuntime(authority);
      },
      revalidateBeforeConsumption,
      consumeAuthority,
      recheckLive: recheckStartRuntime,
      revalidateImmediatelyBeforeMutation: revalidateBeforeConsumption,
      mutateRuntime: (prepared) => startRuntime(artifactRoot, authority, prepared, hash(authorityBytes))
    })
    : await executeTask0BAuthorizedAction({
      async prepare() {
        assertTask0BProductionTelegramBinding(authority, process.env.BOT_TOKEN);
        return prepareStopRuntime(artifactRoot, authority);
      },
      revalidateBeforeConsumption,
      consumeAuthority,
      recheckLive: (prepared) => recheckStopRuntime(authority, prepared),
      revalidateImmediatelyBeforeMutation: revalidateBeforeConsumption,
      mutateRuntime: (prepared) => stopRuntime(artifactRoot, authority, prepared, hash(authorityBytes))
    });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && sameCanonicalPath(invokedPath, MANAGER_PATH)) {
  main().catch(() => {
    process.stderr.write("task0b_runtime_manager_blocked\n");
    process.exitCode = 1;
  });
}
