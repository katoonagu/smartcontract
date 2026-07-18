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
  REMEDIATION_PRE_RELEASE_GATE_IDS,
  TASK0B_OPERATIONAL_COMMAND_TEMPLATE_SHA256,
  validateRemediationReleaseManifest,
  validateTask0BReleaseFreezeEvidence
} from "../src/release/remediationReleaseManifest";
import type {
  ReleaseGateId,
  RemediationReleaseManifestV1
} from "../src/release/remediationReleaseManifest";

const execFileAsync = promisify(execFile);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const START_EVIDENCE = /^runtime-start-evidence-(?:[a-z0-9][a-z0-9-]{15,63}|[a-z0-9][a-z0-9-]{15,63}-runtime_manager_(?:start_candidate|rollback_previous)-[0-9a-f]{64})\.json$/u;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const MANAGER_PATH = fileURLToPath(import.meta.url);

type RuntimeCommandId =
  | "runtime_manager_start_candidate"
  | "runtime_manager_stop_candidate"
  | "runtime_manager_stop_previous"
  | "runtime_manager_rollback_previous";
type RuntimeActionPhase =
  | "pre_migration_shutdown"
  | "post_migration_rollout"
  | "rollback_candidate_stop"
  | "rollback_previous_start";
type ForcePolicy = "graceful_only" | "graceful_then_force";

const RUNTIME_ACTION_PHASES: Readonly<Record<RuntimeCommandId, RuntimeActionPhase>> = Object.freeze({
  runtime_manager_stop_previous: "pre_migration_shutdown",
  runtime_manager_start_candidate: "post_migration_rollout",
  runtime_manager_stop_candidate: "rollback_candidate_stop",
  runtime_manager_rollback_previous: "rollback_previous_start"
});

export type Task0BProductionRuntimeAuthorityV1 = {
  version: "task0b-runtime-authority-v1";
  scope: "production_go";
  source: "operator_protected_one_shot_production_go";
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
    "version", "scope", "source", "generationId", "commandId", "actionPhase", "commandTemplateSha256", "issuedAt", "expiresAt", "candidateSha",
    "targetRuntimeSha", "targetRuntimeLabel", "targetWorktreePath", "targetWorktreeFingerprintSha256", "adminUrl",
    "adminUrlFingerprintSha256", "databaseRole", "databaseIdentityFingerprintSha256", "telegramTransport", "telegramBotIdentitySha256",
    "task0bEvidenceSha256", "releaseManifestPath", "releaseManifestSha256", "releaseManifestOverall", "explicitGo",
    "forcePolicy", "startEvidencePath", "startEvidenceSha256"
  ], "task0b_runtime_authority_shape_invalid");
  const now = parseIso(evaluatedAt, "task0b_runtime_authority_time_invalid");
  const issuedAt = parseIso(authority.issuedAt, "task0b_runtime_authority_time_invalid");
  const expiresAt = parseIso(authority.expiresAt, "task0b_runtime_authority_time_invalid");
  const commandId = authority.commandId as RuntimeCommandId;
  const isStart = commandId === "runtime_manager_start_candidate" || commandId === "runtime_manager_rollback_previous";
  const startPath = authority.startEvidencePath;
  const startHash = authority.startEvidenceSha256;
  const adminUrl = parseAdminUrl(authority.adminUrl);
  if (authority.version !== "task0b-runtime-authority-v1" || authority.scope !== "production_go"
      || authority.source !== "operator_protected_one_shot_production_go"
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
      || authority.explicitGo !== true
      || !new Set<ForcePolicy>(["graceful_only", "graceful_then_force"]).has(authority.forcePolicy as ForcePolicy)
      || (isStart && (startPath !== null || startHash !== null))
      || (!isStart && (typeof startPath !== "string" || !START_EVIDENCE.test(startPath)
        || !SHA256.test(String(startHash))))) {
    throw new Error("task0b_runtime_authority_unverified");
  }
  return authority as Task0BProductionRuntimeAuthorityV1;
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
): RemediationReleaseManifestV1 {
  if (hash(manifestBytes) !== authority.releaseManifestSha256) {
    throw new Error("task0b_runtime_release_manifest_hash_binding_invalid");
  }
  let value: unknown;
  try { value = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw new Error("task0b_runtime_release_manifest_json_invalid"); }
  const manifest = validateRemediationReleaseManifest(value);
  if (manifest.candidateSha !== authority.candidateSha
      || manifest.overall !== authority.releaseManifestOverall) {
    throw new Error("task0b_runtime_release_manifest_authority_binding_invalid");
  }
  return manifest;
}

function assertTask0BActionPhase(
  authority: Task0BProductionRuntimeAuthorityV1,
  manifest: RemediationReleaseManifestV1
): void {
  const gates = new Map(manifest.gates.map((gate) => [gate.id, gate]));
  const state = (id: ReleaseGateId) => gates.get(id)!.state;
  const passed = (id: ReleaseGateId) => state(id) === "passed";
  const preReleasePassed = REMEDIATION_PRE_RELEASE_GATE_IDS.every((id) => passed(id));
  if (!preReleasePassed || manifest.overall !== "not_ready"
      || authority.releaseManifestOverall !== manifest.overall
      || authority.actionPhase !== RUNTIME_ACTION_PHASES[authority.commandId]) {
    throw new Error("task0b_runtime_action_phase_unverified");
  }

  const g12 = state("G12_PRODUCTION_BACKUP");
  const g13 = state("G13_PRODUCTION_MIGRATION");
  const g14 = state("G14_PRODUCTION_ROLLOUT");
  const g15 = state("G15_PRODUCTION_CANARY");
  switch (authority.commandId) {
    case "runtime_manager_stop_previous":
      if (g12 !== "passed" || [g13, g14, g15].some((gate) => gate !== "pending")) {
        throw new Error("task0b_runtime_pre_migration_shutdown_phase_unverified");
      }
      return;
    case "runtime_manager_start_candidate":
      if (!passed("G12_PRODUCTION_BACKUP") || !passed("G13_PRODUCTION_MIGRATION")
          || g14 !== "pending" || g15 !== "pending") {
        throw new Error("task0b_runtime_post_migration_rollout_phase_unverified");
      }
      return;
    case "runtime_manager_stop_candidate": {
      const pair = `${g14}:${g15}`;
      const attemptedRolloutPair = new Set([
        "pending:pending", "passed:pending", "passed:failed", "passed:blocked",
        "failed:pending", "failed:blocked", "blocked:pending", "blocked:blocked"
      ]).has(pair);
      const rollbackContext = [g14, g15].some((gate) => gate === "failed" || gate === "blocked")
        || ([g14, g15].some((gate) => gate === "pending")
          && authority.startEvidencePath !== null && authority.startEvidenceSha256 !== null);
      if (!passed("G12_PRODUCTION_BACKUP") || !passed("G13_PRODUCTION_MIGRATION")
          || !attemptedRolloutPair || pair === "passed:passed" || !rollbackContext) {
        throw new Error("task0b_runtime_rollback_candidate_stop_phase_unverified");
      }
      return;
    }
    case "runtime_manager_rollback_previous":
      if (!passed("G12_PRODUCTION_BACKUP")
          || ![g13, g14, g15].some((gate) => gate === "failed" || gate === "blocked")) {
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
  const manifest = validateRemediationReleaseManifest(manifestValue);
  assertTask0BActionPhase(authority, manifest);
  const candidateAction = authority.commandId === "runtime_manager_start_candidate"
    || authority.commandId === "runtime_manager_stop_candidate";
  const expectedWorktreeFingerprint = candidateAction
    ? task0b.candidateWorktree.worktreePathFingerprintSha256
    : task0b.rollbackWorktree.worktreePathFingerprintSha256;
  if (task0b.candidateSha !== authority.candidateSha || manifest.candidateSha !== authority.candidateSha
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
}): Promise<{ processId: number; evidencePath: string }> {
  const evidencePath = runtimeGenerationEvidencePath("start", input.generationId, input.commandId,
    input.authoritySha256);
  try {
    await input.writeEvidence(evidencePath, input.evidence);
  } catch (error) {
    await input.terminateAndVerify(input.processId);
    throw error;
  }
  return { processId: input.processId, evidencePath };
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
  mutateRuntime(prepared: TPrepared): Promise<TResult>;
}): Promise<TResult> {
  const prepared = await dependencies.prepare();
  await dependencies.revalidateBeforeConsumption();
  await dependencies.consumeAuthority();
  await dependencies.recheckLive(prepared);
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
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const handle = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
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
  revalidateBeforeConsumption(): void;
}> {
  const evaluatedAt = new Date().toISOString();
  const authorityBytes = await readProtectedRegularFile(artifactRoot, filename, MAX_ARTIFACT_BYTES);
  const task0bBytes = await readProtectedRegularFile(artifactRoot, "task0b-release-freeze.json", MAX_ARTIFACT_BYTES);
  const external = await readExternalConfig(artifactRoot);
  const { authority, task0b } = validateTask0BProductionGoEvidence(
    JSON.parse(authorityBytes.toString("utf8")),
    JSON.parse(task0bBytes.toString("utf8")),
    external.binding,
    evaluatedAt
  );
  if (filename !== `runtime-authority-${authority.generationId}.json`) throw new Error("task0b_runtime_authority_filename_invalid");
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
    revalidateBeforeConsumption() {
      const freshNow = new Date().toISOString();
      validateTask0BProductionGoEvidence(
        JSON.parse(authorityBytes.toString("utf8")),
        JSON.parse(task0bBytes.toString("utf8")),
        external.binding,
        freshNow
      );
      validateTask0BPreflightConfig(external.config, freshNow);
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
  const evidence = createTask0BRuntimeManagerStartEvidence({
    generationId: authority.generationId,
    observation,
    runtimeSha: authority.targetRuntimeSha,
    runtimeLabel: authority.targetRuntimeLabel,
    managerExecutableSha256: hash(await readFile(MANAGER_PATH)),
    attestedAt: new Date().toISOString()
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
  await terminateExactAndVerify(prepared.observation, authority.forcePolicy);
  const stopEvidence = {
    version: "runtime-manager-stop-evidence-v1",
    generationId: authority.generationId,
    stoppedProcessId: prepared.processId,
    stoppedProcessStartedAt: prepared.observation.processStartedAt,
    stoppedAt: new Date().toISOString(),
    forcePolicy: authority.forcePolicy,
    runtimeCandidatesAfter: 0,
    verified: true
  };
  if (authority.commandId !== "runtime_manager_stop_candidate"
      && authority.commandId !== "runtime_manager_stop_previous") {
    throw new Error("task0b_runtime_effect_identity_invalid");
  }
  const filename = runtimeGenerationEvidencePath("stop", authority.generationId, authority.commandId, authoritySha256);
  await writeProtectedExclusive(artifactRoot, filename, stopEvidence);
  return { status: "stopped", processId: prepared.processId, evidencePath: filename };
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
  const consumeAuthority = () => writeProtectedExclusive(
    artifactRoot,
    runtimeGenerationConsumptionPath(authority.generationId, authority.commandId, hash(authorityBytes)),
    {
      version: "runtime-manager-authority-consumption-v1",
      generationId: authority.generationId,
      authoritySha256: hash(authorityBytes),
      commandId: authority.commandId,
      consumedAt: new Date().toISOString()
    }
  ).then(() => undefined);
  const result = action === "start"
    ? await executeTask0BAuthorizedAction({
      async prepare() {
        assertTask0BProductionTelegramBinding(authority, process.env.BOT_TOKEN);
        return prepareStartRuntime(authority);
      },
      revalidateBeforeConsumption,
      consumeAuthority,
      recheckLive: recheckStartRuntime,
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
