import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { runWhereIsMoneyCheck, type RunWhereIsMoneyCheckInput, type WhereIsMoneyDeps } from "../check/whereIsMoneyCheck";
import type { AppConfig } from "../config";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  transactionProviderEvidenceId,
  type TransactionEnrichmentDecisionEvidenceV1,
  type TransactionProviderEvidenceIdentityV1,
  type TronTransactionProviderEvidenceV1
} from "../storage/transactionEvidenceRepository";
import type { ForensicRouteEdge, IndexedTronUsdtTransfer, WhereIsMoneyReport } from "../types";
import { canonicalizeArtifactJson, fingerprintCanonicalArtifact } from "./canonicalJson";
import { indexedTransferToRouteEdge } from "./localTronUsdtIndex";
import { createSelectiveTransactionEnricher } from "./selectiveTransactionEnrichment";
import { parseRawTransactionPreflightV1 } from "../tron/rawTransactionPreflight";

export type StableWhereFactsV1 = Omit<WhereIsMoneyReport, "transactionInfoEnrichment">;
export const LEGACY_WHERE_REPLAY_BASELINE_COMMIT = "4861f22e697652c688489ef4be6ab9698cd6ef9f";
// The shared production/capture builder was extracted after the legacy baseline; pin that exact approved source.
const LEGACY_WHERE_EXECUTION_ADAPTER_SOURCE_SHA256 = "8061ad07af5147af4a8d0b1bd7aa23914fde9b44eefa3d77b936263fd536001e";
export const LEGACY_WHERE_BEHAVIOR_SOURCE_FILES = [
  "src/check/whereIsMoneyCheck.ts",
  "src/forensics/balanceFormingSlice.ts",
  "src/forensics/balanceFormingTransfers.ts",
  "src/forensics/crossChainCorridor.ts",
  "src/forensics/crossChainStage2Triggers.ts",
  "src/forensics/deepForensicJob.ts",
  "src/forensics/moneyOriginOperationalAssessment.ts",
  "src/forensics/moneyOriginPolicy.ts",
  "src/forensics/moneyOriginTrace.ts",
  "src/forensics/provenanceScoring.ts",
  "src/forensics/sourceBundleExposure.ts",
  "src/risk/scoringSignalMatrix.ts",
  "src/runtime/deepForensicRuntimeOptions.ts"
] as const;
export const LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH = "b5ad8d43fbcfd693f8d998100f22070c0ef4dbbeeb228e5eeb0e722b3831fde2";

type SerializedReplayError = {
  name: string;
  message: string;
};

type ReplayDependency = {
  sequence: number;
  method: string;
  args: unknown[];
  requestSha256: string;
  payloadSha256: string;
  origin?: "legacy_observed" | "supplemental_stage_b_fixture";
} & (
  | { response: unknown; error?: never }
  | { response?: never; error: SerializedReplayError }
);

type UnhashedReplayDependency = {
  method: string;
  args: unknown[];
  origin?: ReplayDependency["origin"];
  response?: unknown;
  error?: SerializedReplayError;
};

type CapturedDependencyInvocation = UnhashedReplayDependency & {
  sequence: number;
  requestSha256: string;
  payloadSha256?: string;
  state: "pending" | "settled";
};

export type WhereLatencyReplayV1 = {
  schema: "where-latency-replay-v1";
  version: 1;
  baselineGitCommit: string;
  recorderGitCommit: string;
  behaviorSourceFiles: string[];
  sourceTreeHash: string;
  recorderTreeClean: true;
  resolvedConfigHash: string;
  resolvedConfig: Record<string, unknown>;
  resolvedOptions: Record<string, unknown>;
  frozenClockIso: string;
  job: Record<string, unknown>;
  routeCriticalTxHashes: string[];
  frozenKnownHardTxHashes: string[];
  expectedOrdinaryOfficialUsdtTxHashes: string[];
  routeCriticalAddresses: string[];
  dependencies: ReplayDependency[];
  indexedMovements: Array<{ txHashes: string[]; rows: Array<Record<string, unknown>> }>;
  assertionQueries: Array<{ chain: string; addresses: string[]; txHashes: string[]; rows: Array<Record<string, unknown>> }>;
  rawTransactions: Array<{ txHash: string; response: unknown; payloadSha256: string }>;
  baselineRequestCounts: Record<string, number>;
  expectedStableFacts: StableWhereFactsV1;
};

const EXPLICIT_STABLE_FIELDS = [
  "coverage",
  "coverageV2",
  "decisionReasons",
  "fastWalletRisk",
  "sourceProvenanceMateriality",
  "crossChainCorridor",
  "riskCaseFile"
] as const;

type ReplayProviderCounts = { raw: number; full: number };

export type WhereLatencyReplayRunV1 = {
  report: WhereIsMoneyReport;
  evidenceIds: string[];
  providerCalls: ReplayProviderCounts;
  rawCallHashes: string[];
  fullCallHashes: string[];
};

export type WhereLatencyReplayAnalysisV1 = {
  schema: "where-latency-replay-analysis-v1";
  expectedStableFacts: StableWhereFactsV1;
  expectedOrdinaryOfficialUsdtTxHashes: string[];
  tapeCompleteness: {
    status: "complete" | "incomplete";
    missingRawTxHashes: string[];
    missingFullTxHashes: string[];
    missingRawEvidenceIds: string[];
    missingFullEvidenceIds: string[];
  };
  stableFactsEqual: boolean;
  explicitStableFactsEqual: Record<(typeof EXPLICIT_STABLE_FIELDS)[number], boolean>;
  requestCounts: {
    baseline: ReplayProviderCounts;
    firstRun: ReplayProviderCounts;
    secondRun: ReplayProviderCounts;
  };
  maxFullCallsPerIdentity: number;
  firstRun: WhereLatencyReplayRunV1;
  secondRun: WhereLatencyReplayRunV1;
};

export type BuildWhereLatencyReplayV1Input = Omit<
  WhereLatencyReplayV1,
  "dependencies" | "rawTransactions" | "baselineRequestCounts" | "resolvedConfigHash"
> & {
  dependencies: Array<UnhashedReplayDependency | CapturedDependencyInvocation>;
  rawTransactions: Array<Omit<WhereLatencyReplayV1["rawTransactions"][number], "payloadSha256">>;
};

export type DependencyInvocationRecorder = <T>(
  method: string,
  args: unknown[],
  operation: () => Promise<T>
) => Promise<T>;

export type DependencyInvocationTapeRecorder = {
  record<T>(
    method: string,
    args: unknown[],
    operation: () => Promise<T>,
    origin?: ReplayDependency["origin"]
  ): Promise<T>;
  readonly invocations: CapturedDependencyInvocation[];
  baselineRequestCounts(): Record<string, number>;
};

function serializedError(error: unknown): SerializedReplayError {
  return error instanceof Error
    ? { name: error.name || "Error", message: error.message }
    : { name: "Error", message: String(error) };
}

export function createDependencyInvocationTapeRecorder(): DependencyInvocationTapeRecorder {
  const invocations: CapturedDependencyInvocation[] = [];
  return {
    async record<T>(
      method: string,
      args: unknown[],
      operation: () => Promise<T>,
      origin: ReplayDependency["origin"] = "legacy_observed"
    ): Promise<T> {
      const recordedArgs = sanitizeReplayValue(args) as unknown[];
      const slot: CapturedDependencyInvocation = {
        sequence: invocations.length,
        method,
        args: recordedArgs,
        requestSha256: requestKey(method, recordedArgs),
        origin,
        state: "pending"
      };
      invocations.push(slot);
      try {
        const response = await operation();
        const recordedResponse = sanitizeReplayValue(response);
        Object.assign(slot, { state: "settled", response: recordedResponse, payloadSha256: sha256(recordedResponse) });
        return response;
      } catch (error) {
        const recordedError = serializedError(error);
        Object.assign(slot, { state: "settled", error: recordedError, payloadSha256: sha256(recordedError) });
        throw error;
      }
    },
    invocations,
    baselineRequestCounts() {
      const counts: Record<string, number> = {};
      for (const invocation of invocations) {
        if (invocation.origin !== "legacy_observed") continue;
        counts[invocation.method] = (counts[invocation.method] ?? 0) + 1;
      }
      return counts;
    }
  };
}

/** Wrap the dependency graph without changing its surface or call arguments. */
export function recordWhereIsMoneyDependencies(
  dependencies: WhereIsMoneyDeps,
  record: DependencyInvocationRecorder
): WhereIsMoneyDeps {
  const wrap = (value: unknown, path: string[], owner: object): unknown => {
    if (typeof value === "function") {
      return (...args: unknown[]) => record(path.join("."), args, () =>
        Promise.resolve(Reflect.apply(value, owner, args))
      );
    }
    if (Array.isArray(value)) {
      return value.map((child, index) => wrap(child, [...path, String(index)], value));
    }
    if (!value || typeof value !== "object") return value;
    return new Proxy(value, {
      get(target, property) {
        const child = Reflect.get(target, property, target);
        return typeof property === "string"
          ? wrap(child, [...path, property], target)
          : child;
      }
    });
  };

  return wrap(dependencies, [], dependencies) as WhereIsMoneyDeps;
}

type WhereReplayConfigSource = Pick<AppConfig,
  | "tronscanBaseUrl"
  | "tronFullNodeBaseUrl"
  | "tronscanApiKeys"
  | "tronscanApiKeyGroups"
  | "tronFullNodeApiKey"
  | "tronscanPageLimit"
  | "tronscanMaxInFlight"
  | "tronscanGroupMaxInFlight"
  | "tronscanTimeoutMs"
  | "tronscanRetryAttempts"
  | "tronscanRetryBaseDelayMs"
  | "tronscanRequestMinIntervalMs"
  | "tronscanGlobalRequestMinIntervalMs"
  | "tronscanTransferRequestMinIntervalMs"
  | "tronscanApprovalRequestMinIntervalMs"
  | "tronscanContractRequestMinIntervalMs"
  | "tronscanFullNodeRequestMinIntervalMs"
  | "tronscanAccountGroupRequestMinIntervalMs"
  | "tronGridRequestMinIntervalMs"
  | "tronscanRateLimitCooldownMs"
  | "crossChainStage2Enabled"
  | "crossChainStage2MaxProviderCalls"
  | "crossChainStage2CacheTtlMs"
  | "rangeApiKey"
  | "rangeBaseUrl"
  | "rangeTimeoutMs"
  | "rangeMaxCallsPerCheck"
  | "evmExplorerApiKey"
  | "evmExplorerBaseUrl"
  | "evmExplorerTimeoutMs"
  | "evmExplorerMaxCallsPerCheck"
  | "directHardEvidenceLiveLimit"
  | "directHardEvidenceConcurrency"
  | "tronAddressIndexSecondLayerMaxActiveWalletsPerJob"
  | "adminSecondLayerMaxActiveWallets"
>;

const WHERE_REPLAY_CONFIG_KEYS = [
  "adminSecondLayerMaxActiveWallets",
  "crossChainStage2CacheTtlMs",
  "crossChainStage2Enabled",
  "crossChainStage2MaxProviderCalls",
  "directHardEvidenceConcurrency",
  "directHardEvidenceLiveLimit",
  "evmExplorerBaseUrl",
  "evmExplorerMaxCallsPerCheck",
  "evmExplorerProviderConfigured",
  "evmExplorerTimeoutMs",
  "rangeBaseUrl",
  "rangeMaxCallsPerCheck",
  "rangeProviderConfigured",
  "rangeTimeoutMs",
  "tronAddressIndexSecondLayerMaxActiveWalletsPerJob",
  "tronFullNodeApiKeyConfigured",
  "tronFullNodeBaseUrl",
  "tronGridRequestMinIntervalMs",
  "tronscanAccountGroupRequestMinIntervalMs",
  "tronscanApiKeyConfigured",
  "tronscanApiKeyCount",
  "tronscanApiKeyGroupIds",
  "tronscanApiKeyGroupSizes",
  "tronscanApprovalRequestMinIntervalMs",
  "tronscanBaseUrl",
  "tronscanContractRequestMinIntervalMs",
  "tronscanFullNodeRequestMinIntervalMs",
  "tronscanGlobalRequestMinIntervalMs",
  "tronscanGroupMaxInFlight",
  "tronscanMaxInFlight",
  "tronscanPageLimit",
  "tronscanRateLimitCooldownMs",
  "tronscanRequestMinIntervalMs",
  "tronscanRetryAttempts",
  "tronscanRetryBaseDelayMs",
  "tronscanTimeoutMs",
  "tronscanTransferRequestMinIntervalMs"
] as const;

export function projectWhereReplayConfig(config: WhereReplayConfigSource): Record<string, unknown> {
  return {
    adminSecondLayerMaxActiveWallets: config.adminSecondLayerMaxActiveWallets ?? null,
    crossChainStage2CacheTtlMs: config.crossChainStage2CacheTtlMs,
    crossChainStage2Enabled: config.crossChainStage2Enabled,
    crossChainStage2MaxProviderCalls: config.crossChainStage2MaxProviderCalls,
    directHardEvidenceConcurrency: config.directHardEvidenceConcurrency ?? null,
    directHardEvidenceLiveLimit: config.directHardEvidenceLiveLimit ?? null,
    evmExplorerBaseUrl: config.evmExplorerBaseUrl.href,
    evmExplorerMaxCallsPerCheck: config.evmExplorerMaxCallsPerCheck,
    evmExplorerProviderConfigured: Boolean(config.evmExplorerApiKey),
    evmExplorerTimeoutMs: config.evmExplorerTimeoutMs,
    rangeBaseUrl: config.rangeBaseUrl.href,
    rangeMaxCallsPerCheck: config.rangeMaxCallsPerCheck,
    rangeProviderConfigured: Boolean(config.rangeApiKey),
    rangeTimeoutMs: config.rangeTimeoutMs,
    tronAddressIndexSecondLayerMaxActiveWalletsPerJob: config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob ?? null,
    tronFullNodeApiKeyConfigured: Boolean(config.tronFullNodeApiKey),
    tronFullNodeBaseUrl: config.tronFullNodeBaseUrl.href,
    tronGridRequestMinIntervalMs: config.tronGridRequestMinIntervalMs,
    tronscanAccountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs,
    tronscanApiKeyConfigured: config.tronscanApiKeys.length > 0,
    tronscanApiKeyCount: config.tronscanApiKeys.length,
    tronscanApiKeyGroupIds: config.tronscanApiKeyGroups.map((group) => group.groupId),
    tronscanApiKeyGroupSizes: config.tronscanApiKeyGroups.map((group) => group.apiKeys.length),
    tronscanApprovalRequestMinIntervalMs: config.tronscanApprovalRequestMinIntervalMs,
    tronscanBaseUrl: config.tronscanBaseUrl.href,
    tronscanContractRequestMinIntervalMs: config.tronscanContractRequestMinIntervalMs,
    tronscanFullNodeRequestMinIntervalMs: config.tronscanFullNodeRequestMinIntervalMs,
    tronscanGlobalRequestMinIntervalMs: config.tronscanGlobalRequestMinIntervalMs,
    tronscanGroupMaxInFlight: config.tronscanGroupMaxInFlight ?? null,
    tronscanMaxInFlight: config.tronscanMaxInFlight ?? null,
    tronscanPageLimit: config.tronscanPageLimit,
    tronscanRateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
    tronscanRequestMinIntervalMs: config.tronscanRequestMinIntervalMs,
    tronscanRetryAttempts: config.tronscanRetryAttempts,
    tronscanRetryBaseDelayMs: config.tronscanRetryBaseDelayMs,
    tronscanTimeoutMs: config.tronscanTimeoutMs,
    tronscanTransferRequestMinIntervalMs: config.tronscanTransferRequestMinIntervalMs
  };
}

function assertWhereReplayConfigProjection(value: unknown): asserts value is Record<string, unknown> {
  const config = asObject(value, "where_latency_replay_config_invalid");
  const keys = Object.keys(config).sort();
  if (keys.length !== WHERE_REPLAY_CONFIG_KEYS.length || keys.some((key, index) => key !== WHERE_REPLAY_CONFIG_KEYS[index])) {
    fail("where_latency_replay_config_invalid");
  }
  for (const key of ["tronscanBaseUrl", "tronFullNodeBaseUrl", "rangeBaseUrl", "evmExplorerBaseUrl"] as const) {
    if (typeof config[key] !== "string") fail("where_latency_replay_config_invalid");
    try {
      new URL(config[key]);
    } catch {
      fail("where_latency_replay_config_invalid");
    }
  }
  for (const key of ["tronscanApiKeyConfigured", "tronFullNodeApiKeyConfigured", "rangeProviderConfigured", "evmExplorerProviderConfigured", "crossChainStage2Enabled"] as const) {
    if (typeof config[key] !== "boolean") fail("where_latency_replay_config_invalid");
  }
  if (!Array.isArray(config.tronscanApiKeyGroupIds) || config.tronscanApiKeyGroupIds.some((id) => typeof id !== "string" || id.length === 0)
    || !Array.isArray(config.tronscanApiKeyGroupSizes) || config.tronscanApiKeyGroupSizes.some((count) => !Number.isSafeInteger(count) || Number(count) < 0)) {
    fail("where_latency_replay_config_invalid");
  }
  for (const [key, field] of Object.entries(config)) {
    if (["tronscanBaseUrl", "tronFullNodeBaseUrl", "rangeBaseUrl", "evmExplorerBaseUrl", "tronscanApiKeyGroupIds", "tronscanApiKeyGroupSizes"].includes(key)
      || typeof field === "boolean" || field === null) continue;
    if (typeof field !== "number" || !Number.isFinite(field) || field < 0) fail("where_latency_replay_config_invalid");
  }
}

export type LegacyWhereSourceRevision = {
  recorderGitCommit: string;
  behaviorSourceFiles: string[];
  sourceTreeHash: string;
  approvedSourceTreeHash: string;
  recorderTreeClean?: true;
};

export function assertLegacyWhereSourceRevision(revision: LegacyWhereSourceRevision): void {
  if (!COMMIT.test(revision.recorderGitCommit)) fail("where_latency_replay_recorder_revision_invalid");
  if (canonicalizeArtifactJson(revision.behaviorSourceFiles) !== canonicalizeArtifactJson([...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES])) {
    fail("where_latency_replay_behavior_source_set_mismatch");
  }
  if (!SHA256.test(revision.sourceTreeHash) || !SHA256.test(revision.approvedSourceTreeHash)
    || revision.approvedSourceTreeHash !== LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH
    || revision.sourceTreeHash !== revision.approvedSourceTreeHash) {
    fail("where_latency_replay_behavior_source_mismatch");
  }
  if (revision.recorderTreeClean !== undefined && revision.recorderTreeClean !== true) {
    fail("where_latency_replay_source_tree_dirty");
  }
}

const execFile = promisify(execFileCallback);

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch {
    fail("where_latency_replay_source_revision_unavailable");
  }
}

function normalizeApprovedClockSeam(path: string, source: string): string {
  if (path !== "src/check/whereIsMoneyCheck.ts") return source;
  // ponytail: the only approved baseline delta is the injected clock seam; any other source edit changes the hash.
  return source
    .replace("  now?: () => number;\n", "")
    .replace("  const nowMs = input.now ?? Date.now;\n", "")
    .replaceAll("nowMs()", "Date.now()");
}

function sourceContentHashes(sources: string[]): string[] {
  return LEGACY_WHERE_BEHAVIOR_SOURCE_FILES.map((path, index) =>
    sha256(normalizeApprovedClockSeam(path, sources[index] ?? ""))
  );
}

function sourceTreeHash(contentHashes: string[]): string {
  return sha256(LEGACY_WHERE_BEHAVIOR_SOURCE_FILES.map((path, index) => ({
    path,
    contentSha256: contentHashes[index]
  })));
}

export async function readLegacyWhereSourceRevision(cwd: string): Promise<LegacyWhereSourceRevision & { recorderTreeClean: true }> {
  const status = await gitOutput(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length > 0) fail("where_latency_replay_source_tree_dirty");
  const recorderGitCommit = await gitOutput(cwd, ["rev-parse", "HEAD"]);
  const currentSources = await Promise.all(LEGACY_WHERE_BEHAVIOR_SOURCE_FILES.map((path) =>
    gitOutput(cwd, ["show", `HEAD:${path}`])
  ));
  const approvedSources = await Promise.all(LEGACY_WHERE_BEHAVIOR_SOURCE_FILES.map((path) =>
    gitOutput(cwd, ["show", `${LEGACY_WHERE_REPLAY_BASELINE_COMMIT}:${path}`])
  ));
  const currentContentHashes = sourceContentHashes(currentSources);
  const approvedContentHashes = sourceContentHashes(approvedSources);
  approvedContentHashes[LEGACY_WHERE_BEHAVIOR_SOURCE_FILES.indexOf("src/forensics/deepForensicJob.ts")] =
    LEGACY_WHERE_EXECUTION_ADAPTER_SOURCE_SHA256;
  const revision = {
    recorderGitCommit,
    behaviorSourceFiles: [...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES],
    sourceTreeHash: sourceTreeHash(currentContentHashes),
    approvedSourceTreeHash: sourceTreeHash(approvedContentHashes),
    recorderTreeClean: true as const
  };
  assertLegacyWhereSourceRevision(revision);
  return revision;
}

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const FORBIDDEN_FIELD = /(?:api[_-]?key|authorization|database[_-]?url|chat[_-]?id|telegram(?:[_-]?id)?|cookie|headers?)/i;

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeArtifactJson(normalizeReplayValue(value))).digest("hex");
}

function requestKey(method: string, args: unknown[]): string {
  return sha256({ method, args: normalizeReplayValue(args) });
}

function canonicalStringSet(values: unknown): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) fail("where_latency_replay_request_missing");
  return [...new Set(values as string[])].sort();
}

function reviveReplayValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => reviveReplayValue(entry));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(?:timestamp|At|windowStart|windowEnd)$/i.test(key) && Number.isFinite(Date.parse(value))) {
      return new Date(value);
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, reviveReplayValue(child, childKey)]));
}

function normalizeReplayValue(value: unknown): unknown {
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeReplayValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined && typeof child !== "function" && typeof child !== "symbol")
    .map(([key, child]) => [key, normalizeReplayValue(child)]));
}

function sanitizeReplayValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeReplayValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !FORBIDDEN_FIELD.test(key) && child !== undefined)
    .map(([key, child]) => [key, sanitizeReplayValue(child)]));
}

function fail(code: string): never {
  throw new Error(code);
}

function assertNoForbiddenFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) fail("where_latency_replay_forbidden_field");
    assertNoForbiddenFields(child);
  }
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function assertEnvelope(envelope: WhereLatencyReplayV1): void {
  const { resolvedConfig, ...envelopeWithoutValidatedConfig } = envelope;
  assertNoForbiddenFields(envelopeWithoutValidatedConfig);
  if (envelope.schema !== "where-latency-replay-v1" || envelope.version !== 1) {
    fail("where_latency_replay_version_unsupported");
  }
  if (!COMMIT.test(envelope.baselineGitCommit) || envelope.baselineGitCommit !== LEGACY_WHERE_REPLAY_BASELINE_COMMIT || !SHA256.test(envelope.resolvedConfigHash)
    || sha256({ config: resolvedConfig, options: envelope.resolvedOptions }) !== envelope.resolvedConfigHash) {
    fail("where_latency_replay_baseline_binding_missing");
  }
  assertWhereReplayConfigProjection(resolvedConfig);
  if (envelope.recorderTreeClean !== true) fail("where_latency_replay_source_tree_dirty");
  assertLegacyWhereSourceRevision({
    recorderGitCommit: envelope.recorderGitCommit,
    behaviorSourceFiles: envelope.behaviorSourceFiles,
    sourceTreeHash: envelope.sourceTreeHash,
    approvedSourceTreeHash: LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
    recorderTreeClean: envelope.recorderTreeClean
  });
  if (!Number.isFinite(Date.parse(envelope.frozenClockIso))) fail("where_latency_replay_clock_invalid");
  const job = asObject(envelope.job, "where_latency_replay_job_invalid");
  if (typeof job.sourceAddress !== "string" || !Number.isFinite(Date.parse(String(job.windowStart)))
    || !Number.isFinite(Date.parse(String(job.windowEnd))) || Date.parse(String(job.windowStart)) >= Date.parse(String(job.windowEnd))
    || !job.options || typeof job.options !== "object" || Array.isArray(job.options)) {
    fail("where_latency_replay_job_invalid");
  }
  if (canonicalizeArtifactJson(job.options) !== canonicalizeArtifactJson(envelope.resolvedOptions)
    || job.sourceAddress !== envelope.resolvedOptions.sourceAddress
    || job.windowStart !== envelope.resolvedOptions.windowStart
    || job.windowEnd !== envelope.resolvedOptions.windowEnd) {
    fail("where_latency_replay_options_binding_mismatch");
  }
  for (const [index, dependency] of envelope.dependencies.entries()) {
    if (!dependency || typeof dependency.method !== "string" || !Array.isArray(dependency.args)) {
      fail("where_latency_replay_request_invalid");
    }
    if (dependency.sequence !== index || !SHA256.test(dependency.requestSha256)
      || dependency.requestSha256 !== requestKey(dependency.method, dependency.args)) {
      fail("where_latency_replay_invocation_sequence_invalid");
    }
    if ("state" in dependency) fail("where_latency_replay_invocation_pending");
    const hasResponse = Object.prototype.hasOwnProperty.call(dependency, "response");
    const hasError = Object.prototype.hasOwnProperty.call(dependency, "error");
    if (hasResponse === hasError) fail("where_latency_replay_outcome_missing");
    if (dependency.origin !== undefined && dependency.origin !== "legacy_observed" && dependency.origin !== "supplemental_stage_b_fixture") {
      fail("where_latency_replay_request_origin_invalid");
    }
    const outcome = hasResponse ? dependency.response : dependency.error;
    if (hasError && (typeof dependency.error?.name !== "string" || typeof dependency.error.message !== "string")) {
      fail("where_latency_replay_error_invalid");
    }
    if (!SHA256.test(dependency.payloadSha256) || dependency.payloadSha256 !== sha256(outcome)) {
      fail("where_latency_replay_payload_sha256_mismatch");
    }
  }
  const countedLegacy = new Map<string, number>();
  for (const dependency of envelope.dependencies) {
    if (dependency.origin === "legacy_observed") {
      countedLegacy.set(dependency.method, (countedLegacy.get(dependency.method) ?? 0) + 1);
    }
  }
  for (const [method, count] of Object.entries(envelope.baselineRequestCounts)) {
    if (!Number.isSafeInteger(count) || count < 0 || countedLegacy.get(method) !== count) {
      fail("where_latency_replay_baseline_request_count_mismatch");
    }
  }
  if ([...countedLegacy.keys()].some((method) => !(method in envelope.baselineRequestCounts))) {
    fail("where_latency_replay_baseline_request_count_mismatch");
  }
  const movementKeys = new Set<string>();
  for (const movement of envelope.indexedMovements) {
    const key = requestKey("indexedMovements", movement.txHashes);
    if (movementKeys.has(key)) fail("where_latency_replay_indexed_movement_duplicate");
    movementKeys.add(key);
    for (const row of movement.rows) {
      const required = [
        "transferId", "txHash", "blockNumber", "blockTimestamp", "eventIndex", "provider", "providerRowOrdinalInTx",
        "fromAddress", "toAddress", "amountRaw", "method", "eventType", "callerAddress", "contractRet", "finalResult",
        "reverted", "riskTransaction", "confirmed"
      ];
      if (required.some((field) => !(field in row))) fail("where_latency_replay_indexed_movement_incomplete");
      if (!movement.txHashes.includes(String(row.txHash))) fail("where_latency_replay_indexed_movement_binding_mismatch");
    }
    if (movement.txHashes.some((txHash) => !movement.rows.some((row) => row.txHash === txHash))) {
      fail("where_latency_replay_indexed_movement_missing");
    }
  }
  const movementHashes = new Set(envelope.indexedMovements.flatMap((entry) => entry.txHashes));
  if (movementHashes.size === 0 || envelope.indexedMovements.some((entry) => entry.rows.length === 0)) {
    fail("where_latency_replay_indexed_movement_missing");
  }
  if (!Array.isArray(envelope.routeCriticalTxHashes) || envelope.routeCriticalTxHashes.length === 0) {
    fail("where_latency_replay_route_critical_hash_missing");
  }
  const expectedRouteHashes = new Set(collectRouteCriticalTransactionHashes(envelope.expectedStableFacts as WhereIsMoneyReport, {
    legacyObservedTransactionHashes: envelope.dependencies
      .filter((entry) => entry.method === "getTransaction" && entry.origin === "legacy_observed" && typeof entry.args[0] === "string")
      .map((entry) => entry.args[0] as string)
  }));
  const routeHashes = new Set(envelope.routeCriticalTxHashes);
  if (routeHashes.size !== envelope.routeCriticalTxHashes.length
    || routeHashes.size !== expectedRouteHashes.size
    || [...routeHashes].some((hash) => !expectedRouteHashes.has(hash))) {
    fail("where_latency_replay_route_critical_hash_missing");
  }
  if (!Array.isArray(envelope.expectedOrdinaryOfficialUsdtTxHashes)) {
    fail("where_latency_replay_expected_ordinary_manifest_invalid");
  }
  if (!Array.isArray(envelope.frozenKnownHardTxHashes)) {
    fail("where_latency_replay_known_hard_manifest_invalid");
  }
  const frozenKnownHardHashes = canonicalStringSet(envelope.frozenKnownHardTxHashes.map((hash) => hash.toLowerCase()));
  if (frozenKnownHardHashes.length !== envelope.frozenKnownHardTxHashes.length
    || frozenKnownHardHashes.some((hash, index) => hash !== envelope.frozenKnownHardTxHashes[index])
    || frozenKnownHardHashes.some((hash) => !routeHashes.has(hash))) {
    fail("where_latency_replay_known_hard_manifest_invalid");
  }
  if (collectFrozenKnownHardTxHashes(envelope.expectedStableFacts as WhereIsMoneyReport).join("\u0000")
    !== frozenKnownHardHashes.join("\u0000")) {
    fail("where_latency_replay_known_hard_manifest_invalid");
  }
  const expectedOrdinaryHashes = canonicalStringSet(envelope.expectedOrdinaryOfficialUsdtTxHashes.map((hash) => hash.toLowerCase()));
  if (expectedOrdinaryHashes.length !== envelope.expectedOrdinaryOfficialUsdtTxHashes.length
    || expectedOrdinaryHashes.some((hash, index) => hash !== envelope.expectedOrdinaryOfficialUsdtTxHashes[index])
    || expectedOrdinaryHashes.some((hash) => !routeHashes.has(hash))) {
    fail("where_latency_replay_expected_ordinary_manifest_invalid");
  }
  const rawHashes = new Set<string>();
  for (const raw of envelope.rawTransactions) {
    const txHash = raw.txHash.toLowerCase();
    if (rawHashes.has(txHash) || !routeHashes.has(txHash) || raw.payloadSha256 !== sha256(raw.response)) {
      fail("where_latency_replay_raw_transaction_invalid");
    }
    rawHashes.add(txHash);
    const response = asObject(raw.response, "where_latency_replay_raw_transaction_invalid");
    if (typeof response.txID !== "string" || response.txID.toLowerCase() !== txHash) {
      fail("where_latency_replay_raw_transaction_binding_mismatch");
    }
  }
  for (const full of envelope.dependencies.filter((entry) => entry.method === "getTransaction")) {
    const txHash = typeof full.args[0] === "string" ? full.args[0].toLowerCase() : "";
    if (!routeHashes.has(txHash) || full.args.length !== 1) fail("where_latency_replay_transaction_info_identity_mismatch");
    if ("response" in full) {
      const response = asObject(full.response, "where_latency_replay_transaction_info_identity_missing");
      const identity = response.txID ?? response.hash ?? response.id;
      if (typeof identity !== "string" || identity.toLowerCase() !== txHash) {
        fail("where_latency_replay_transaction_info_identity_mismatch");
      }
    }
  }
  for (const txHash of routeHashes) {
    if (!movementHashes.has(txHash)) fail("where_latency_replay_indexed_movement_missing");
  }
  const routeAddresses = canonicalStringSet(envelope.routeCriticalAddresses);
  if (routeAddresses.length === 0) fail("where_latency_replay_route_critical_address_missing");
  const expectedAddresses = collectRouteCriticalAddresses(envelope.expectedStableFacts as WhereIsMoneyReport);
  if (routeAddresses.join("\u0000") !== expectedAddresses.join("\u0000")) {
    fail("where_latency_replay_route_critical_address_missing");
  }
  if (envelope.assertionQueries.length !== 1) fail("where_latency_replay_assertion_query_missing");
  const assertionKeys = new Set<string>();
  for (const query of envelope.assertionQueries) {
    if (query.chain !== "tron" || !Array.isArray(query.addresses) || !Array.isArray(query.txHashes) || !Array.isArray(query.rows)) {
      fail("where_latency_replay_assertion_query_missing");
    }
    const key = requestKey("assertionQuery", [query.chain, query.addresses, query.txHashes]);
    if (assertionKeys.has(key)) fail("where_latency_replay_assertion_query_duplicate");
    assertionKeys.add(key);
  }
  for (const txHash of movementHashes) {
    if (!envelope.assertionQueries.some((query) => query.txHashes.includes(txHash))) {
      fail("where_latency_replay_assertion_query_missing");
    }
  }
  const assertion = envelope.assertionQueries[0]!;
  if (canonicalStringSet(assertion.addresses).join("\u0000") !== routeAddresses.join("\u0000")
    || canonicalStringSet(assertion.txHashes).join("\u0000") !== canonicalStringSet(envelope.routeCriticalTxHashes).join("\u0000")) {
    fail("where_latency_replay_assertion_query_missing");
  }
  const availableRawHashes = new Set(envelope.rawTransactions.map((entry) => entry.txHash.toLowerCase()));
  const derivedOrdinaryHashes = collectExpectedOrdinaryOfficialUsdtTxHashes({
    routeCriticalTxHashes: envelope.routeCriticalTxHashes,
    rawTransactions: envelope.rawTransactions,
    indexedMovementRows: envelope.indexedMovements.flatMap((entry) => entry.rows),
    assertionRows: envelope.assertionQueries.flatMap((query) => query.rows),
    knownHardTxHashes: envelope.frozenKnownHardTxHashes
  });
  const expectedForAvailableRaw = expectedOrdinaryHashes.filter((hash) => availableRawHashes.has(hash));
  if (derivedOrdinaryHashes.join("\u0000") !== expectedForAvailableRaw.join("\u0000")) {
    fail("where_latency_replay_expected_ordinary_manifest_invalid");
  }
}

export function buildWhereLatencyReplayV1(input: BuildWhereLatencyReplayV1Input): {
  envelope: WhereLatencyReplayV1;
  canonicalJson: string;
} {
  const resolvedConfig = normalizeReplayValue(input.resolvedConfig) as Record<string, unknown>;
  const resolvedOptions = sanitizeReplayValue(input.resolvedOptions) as Record<string, unknown>;
  const dependencies = input.dependencies.map((entry, sequence) => {
    const captured = "state" in entry;
    if (captured && entry.state === "pending") fail("where_latency_replay_invocation_pending");
    const {
      state: _state,
      sequence: _capturedSequence,
      requestSha256: _capturedRequestSha256,
      payloadSha256: capturedPayloadSha256,
      ...invocation
    } = entry as CapturedDependencyInvocation;
    const args = sanitizeReplayValue(invocation.args) as unknown[];
    const requestSha256 = requestKey(invocation.method, args);
    if (captured && (entry.sequence !== sequence || entry.requestSha256 !== requestSha256)) {
      fail("where_latency_replay_invocation_sequence_invalid");
    }
    if (Object.prototype.hasOwnProperty.call(invocation, "response")) {
      const response = sanitizeReplayValue(invocation.response);
      if (captured && capturedPayloadSha256 !== sha256(response)) fail("where_latency_replay_payload_sha256_mismatch");
      return { ...invocation, sequence, args, requestSha256, response, payloadSha256: sha256(response) };
    }
    const error = sanitizeReplayValue(invocation.error) as SerializedReplayError;
    if (captured && capturedPayloadSha256 !== sha256(error)) fail("where_latency_replay_payload_sha256_mismatch");
    return { ...invocation, sequence, args, requestSha256, error, payloadSha256: sha256(error) };
  });
  const baselineRequestCounts: Record<string, number> = {};
  for (const dependency of dependencies) {
    if (dependency.origin !== "legacy_observed") continue;
    baselineRequestCounts[dependency.method] = (baselineRequestCounts[dependency.method] ?? 0) + 1;
  }
  const envelope = {
    ...input,
    resolvedConfig,
    resolvedOptions,
    resolvedConfigHash: sha256({ config: resolvedConfig, options: resolvedOptions }),
    job: normalizeReplayValue(input.job) as Record<string, unknown>,
    dependencies,
    baselineRequestCounts,
    rawTransactions: input.rawTransactions.map((entry) => ({
      ...entry,
      response: sanitizeReplayValue(entry.response),
      payloadSha256: sha256(sanitizeReplayValue(entry.response))
    }))
  } as WhereLatencyReplayV1;
  assertEnvelope(envelope);
  return { envelope, canonicalJson: canonicalizeArtifactJson(envelope) };
}

export function parseWhereLatencyReplayV1(bytes: string): WhereLatencyReplayV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("where_latency_replay_json_invalid");
  }
  const envelope = asObject(parsed, "where_latency_replay_envelope_invalid") as unknown as WhereLatencyReplayV1;
  if (canonicalizeArtifactJson(envelope) !== bytes) fail("where_latency_replay_json_not_canonical");
  assertEnvelope(envelope);
  return envelope;
}

export function projectStableWhereFacts(report: WhereIsMoneyReport): StableWhereFactsV1 {
  const facts = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  delete facts.transactionInfoEnrichment;
  return facts as StableWhereFactsV1;
}

export function assertExpectedStableWhereFacts(replay: WhereLatencyReplayV1, report: WhereIsMoneyReport): void {
  for (const field of EXPLICIT_STABLE_FIELDS) {
    if (!sameStableValue(report[field], replay.expectedStableFacts[field])) {
      fail(`where_latency_replay_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_mismatch`);
    }
  }
  if (canonicalizeArtifactJson(projectStableWhereFacts(report)) !== canonicalizeArtifactJson(replay.expectedStableFacts)) {
    fail("where_latency_replay_stable_fact_mismatch");
  }
}

export async function runWhereLatencyReplay(replay: WhereLatencyReplayV1): Promise<WhereIsMoneyReport> {
  const analysis = await analyzeWhereLatencyReplay(replay);
  assertWhereLatencyReplayAcceptance(analysis);
  return analysis.firstRun.report;
}

/** Conservative fixture prefetch: only transaction identities already present in the legacy report. */
export function collectRouteCriticalTransactionHashes(report: Pick<WhereIsMoneyReport,
  "balanceFormingTransfers" | "originPaths" | "approvalDrainProvenanceProfiles" | "contractDrivenTransferProfiles">,
input: {
  unresolvedEconomicRoleInputs?: Array<{ txHash?: string | null }>;
  legacyObservedTransactionHashes?: string[];
} = {}): string[] {
  const hashes = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "txHash" || key === "targetTxHash" || key === "drainTxHash" || key === "approvalTxHash") && typeof child === "string" && child.length > 0) hashes.add(child);
      else if ((key === "txHashes" || key === "pathTxHashes") && Array.isArray(child)) child.forEach((hash) => {
        if (typeof hash === "string" && hash.length > 0) hashes.add(hash);
      });
      else visit(child);
    }
  };
  visit(report);
  for (const item of input.unresolvedEconomicRoleInputs ?? []) {
    if (item.txHash) hashes.add(item.txHash);
  }
  for (const hash of input.legacyObservedTransactionHashes ?? []) {
    if (hash.length > 0) hashes.add(hash);
  }
  return [...hashes];
}

export function collectFrozenKnownHardTxHashes(report: Pick<WhereIsMoneyReport, "originPaths">): string[] {
  const hashes = new Set<string>();
  for (const path of report.originPaths ?? []) {
    for (const item of path.sourceProvenance ?? []) {
      if (item.proofClass !== "unresolved" || typeof item.targetTxHash !== "string") continue;
      const normalized = item.targetTxHash.toLowerCase();
      if (SHA256.test(normalized)) hashes.add(normalized);
    }
  }
  return [...hashes].sort();
}

export function collectRouteCriticalAddresses(report: Pick<WhereIsMoneyReport,
  "subjectAddress" | "balanceFormingTransfers" | "originPaths" | "approvalDrainProvenanceProfiles" | "contractDrivenReceiverProfile" | "contractDrivenTransferProfiles">,
input: { unresolvedAddresses?: string[] } = {}): string[] {
  const addresses = new Set<string>([report.subjectAddress]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && /(?:^|[A-Z_])address$/i.test(key) && child.length > 0) addresses.add(child);
      else if (key === "pathAddresses" && Array.isArray(child)) child.forEach((address) => {
        if (typeof address === "string" && address.length > 0) addresses.add(address);
      });
      else visit(child);
    }
  };
  visit(report);
  for (const address of input.unresolvedAddresses ?? []) if (address.length > 0) addresses.add(address);
  return [...addresses].sort();
}

export type WhereReplayDeps = WhereIsMoneyDeps & {
  getRawTransaction(txHash: string): Promise<unknown>;
  listIndexedTronUsdtTransfersByHashes(txHashes: string[]): Promise<Array<Record<string, unknown>>>;
  listActiveAddressLabelAssertionsForRoute(input: { chain: string; addresses: string[]; txHashes: string[] }): Promise<Array<Record<string, unknown>>>;
  assertAllLegacyInvocationsConsumed(): void;
};

export function assertWhereReplayConsumed(deps: WhereReplayDeps): void {
  deps.assertAllLegacyInvocationsConsumed();
}

function createWhereReplayDepsInternal(
  replay: WhereLatencyReplayV1,
  options: { ignoreLegacyMethods?: ReadonlySet<string> } = {}
): WhereReplayDeps {
  assertEnvelope(replay);
  const legacyInvocations = replay.dependencies.filter((entry) =>
    entry.origin === "legacy_observed" && !options.ignoreLegacyMethods?.has(entry.method)
  );
  const supplementalInvocations = replay.dependencies.filter((entry) => entry.origin === "supplemental_stage_b_fixture");
  const consumedSupplemental = new Set<number>();
  let legacyCursor = 0;
  const hasMethod = (method: string): boolean => replay.dependencies.some((entry) => entry.method === method);
  const hasNestedMethod = (prefix: string): boolean => replay.dependencies.some((entry) => entry.method.startsWith(`${prefix}.`));
  const outcome = (entry: ReplayDependency): unknown => {
    if ("error" in entry) {
      if (!entry.error) fail("where_latency_replay_error_invalid");
      const error = new Error(entry.error.message);
      error.name = entry.error.name;
      throw error;
    }
    return reviveReplayValue(structuredClone(entry.response));
  };
  const replayCall = (method: string) => async (...args: unknown[]) => {
    const key = requestKey(method, args);
    const expected = legacyInvocations[legacyCursor];
    if (expected) {
      if (requestKey(expected.method, expected.args) !== key) fail("where_latency_replay_invocation_order_mismatch");
      legacyCursor += 1;
      return outcome(expected);
    }
    const supplementalIndex = supplementalInvocations.findIndex((entry, index) =>
      !consumedSupplemental.has(index) && requestKey(entry.method, entry.args) === key
    );
    if (supplementalIndex >= 0) {
      consumedSupplemental.add(supplementalIndex);
      return outcome(supplementalInvocations[supplementalIndex]!);
    }
    fail("where_latency_replay_invocation_excess");
  };
  const nested = (prefix: string): object => new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      const method = `${prefix}.${property}`;
      if (hasMethod(method)) return replayCall(method);
      return hasNestedMethod(method) ? nested(method) : undefined;
    }
  });
  const continuationProviders = (): NonNullable<WhereIsMoneyDeps["crossChainContinuationProviders"]> => {
    const indexes = [...new Set(replay.dependencies.flatMap((entry) => {
      const match = /^crossChainContinuationProviders\.(\d+)\./.exec(entry.method);
      return match ? [Number(match[1])] : [];
    }))].sort((left, right) => left - right);
    return indexes.map((index) => {
      const prefix = `crossChainContinuationProviders.${index}`;
      const observed = replay.dependencies.find((entry) => entry.method.startsWith(`${prefix}.`));
      const input = observed?.args[0];
      const inputRecord = input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {};
      const address = inputRecord.address && typeof inputRecord.address === "object" && !Array.isArray(inputRecord.address)
        ? inputRecord.address as Record<string, unknown>
        : {};
      const seed = inputRecord.seed && typeof inputRecord.seed === "object" && !Array.isArray(inputRecord.seed)
        ? inputRecord.seed as Record<string, unknown>
        : {};
      const chain = typeof address.chain === "string"
        ? address.chain
        : typeof seed.chain === "string"
          ? seed.chain
          : fail("where_latency_replay_request_invalid");
      const providerMethods = nested(prefix);
      return new Proxy({ chain }, {
        get(target, property) {
          if (property === "chain") return target.chain;
          return Reflect.get(providerMethods, property);
        }
      }) as NonNullable<WhereIsMoneyDeps["crossChainContinuationProviders"]>[number];
    });
  };
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (property === "assertAllLegacyInvocationsConsumed") return () => {
        if (legacyCursor !== legacyInvocations.length) fail("where_latency_replay_invocation_unconsumed");
      };
      if (property === "getRawTransaction") return async (txHash: string) => {
        const entry = replay.rawTransactions.find((item) => item.txHash.toLowerCase() === txHash.toLowerCase());
        if (!entry) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(entry.response));
      };
      if (property === "listIndexedTronUsdtTransfersByHashes") return async (txHashes: string[]) => {
        const expected = canonicalStringSet(txHashes);
        const movement = replay.indexedMovements.find((item) => canonicalStringSet(item.txHashes).join("\u0000") === expected.join("\u0000"));
        if (!movement) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(movement.rows));
      };
      if (property === "listActiveAddressLabelAssertionsForRoute") return async (input: { chain: string; addresses: string[]; txHashes: string[] }) => {
        const addresses = canonicalStringSet(input.addresses);
        const hashes = canonicalStringSet(input.txHashes);
        const query = replay.assertionQueries.find((item) => item.chain === input.chain
          && canonicalStringSet(item.addresses).join("\u0000") === addresses.join("\u0000")
          && canonicalStringSet(item.txHashes).join("\u0000") === hashes.join("\u0000"));
        if (!query) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(query.rows));
      };
      if (property === "crossChainContinuationProviders" && hasNestedMethod(property)) return continuationProviders();
      if (hasMethod(property)) return replayCall(property);
      if (hasNestedMethod(property)) return nested(property);
      return undefined;
    }
  }) as WhereReplayDeps;
}

export function createWhereReplayDeps(replay: WhereLatencyReplayV1): WhereReplayDeps {
  return createWhereReplayDepsInternal(replay);
}

function replayString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") fail("where_latency_replay_indexed_movement_incomplete");
  return value;
}

function replayNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") fail("where_latency_replay_indexed_movement_incomplete");
  return value as string | null;
}

function replayInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value)) fail("where_latency_replay_indexed_movement_incomplete");
  return value as number;
}

function replayIndexedMovement(row: Record<string, unknown>): ForensicRouteEdge {
  const blockTimestamp = new Date(replayString(row, "blockTimestamp"));
  const method = replayString(row, "method");
  const provider = row.provider;
  if (!Number.isFinite(blockTimestamp.getTime()) || (method !== "transfer" && method !== "transferFrom")
    || (provider !== null && provider !== "tronscan" && provider !== "trongrid_fallback" && provider !== "mixed")
    || typeof row.confirmed !== "boolean" || typeof row.reverted !== "boolean") {
    fail("where_latency_replay_indexed_movement_incomplete");
  }
  const transferId = replayNullableString(row, "transferId");
  const providerRowOrdinalInTx = row.providerRowOrdinalInTx;
  if (providerRowOrdinalInTx !== null && !Number.isSafeInteger(providerRowOrdinalInTx)) {
    fail("where_latency_replay_indexed_movement_incomplete");
  }
  const transfer: IndexedTronUsdtTransfer = {
    ...(transferId === null ? {} : { transferId }),
    txHash: replayString(row, "txHash").toLowerCase(),
    blockNumber: replayInteger(row, "blockNumber"),
    blockTimestamp,
    eventIndex: replayInteger(row, "eventIndex"),
    ...(provider === null ? {} : { provider }),
    providerRowOrdinalInTx: providerRowOrdinalInTx as number | null,
    fromAddress: replayString(row, "fromAddress"),
    toAddress: replayString(row, "toAddress"),
    amountRaw: replayString(row, "amountRaw"),
    method,
    eventType: replayNullableString(row, "eventType"),
    callerAddress: replayNullableString(row, "callerAddress"),
    contractRet: replayNullableString(row, "contractRet"),
    finalResult: replayNullableString(row, "finalResult"),
    reverted: row.reverted,
    riskTransaction: row.riskTransaction === true,
    confirmed: row.confirmed
  };
  return indexedTransferToRouteEdge(transfer);
}

export function collectExpectedOrdinaryOfficialUsdtTxHashes(input: {
  routeCriticalTxHashes: readonly string[];
  rawTransactions: readonly { txHash: string; response: unknown }[];
  indexedMovementRows: readonly Record<string, unknown>[];
  assertionRows?: readonly Record<string, unknown>[];
  knownHardTxHashes?: readonly string[];
}): string[] {
  const knownHard = new Set((input.knownHardTxHashes ?? []).map((hash) => hash.toLowerCase()));
  const rawByHash = new Map(input.rawTransactions.map((entry) => [entry.txHash.toLowerCase(), entry.response]));
  const movements = input.indexedMovementRows.map(replayIndexedMovement);
  const assertions = (input.assertionRows ?? []).map(replayAssertion);
  const ordinary: string[] = [];
  for (const txHash of canonicalStringSet(input.routeCriticalTxHashes.map((hash) => hash.toLowerCase()))) {
    if (knownHard.has(txHash)) continue;
    const raw = rawByHash.get(txHash);
    if (raw === undefined) continue;
    const parsed = parseRawTransactionPreflightV1(raw);
    const matching = movements.filter((edge) => edge.txHash.toLowerCase() === txHash);
    if (parsed.status !== "parsed" || !parsed.successful
      || parsed.contractAddress !== TRON_USDT_CONTRACT_ADDRESS || parsed.selector !== "a9059cbb"
      || matching.length !== 1) continue;
    const edge = matching[0]!;
    if (edge.method !== "transfer" || edge.edgeType !== "normal_transfer"
      || edge.contractAddress !== TRON_USDT_CONTRACT_ADDRESS || edge.confirmed !== true || edge.reverted !== false
      || edge.contractRet?.toUpperCase() !== "SUCCESS" || edge.finalResult?.toUpperCase() !== "SUCCESS"
      || edge.callerAddress !== parsed.callerAddress || edge.fromAddress !== parsed.callerAddress
      || edge.toAddress !== parsed.recipientAddress || edge.amountRaw !== parsed.amountRaw) continue;
    const candidateAddresses = new Set([
      edge.fromAddress,
      edge.toAddress,
      ...(edge.callerAddress ? [edge.callerAddress] : []),
      ...(edge.contractAddress ? [edge.contractAddress] : [])
    ]);
    if (assertions.some((assertion) => assertionMatches(assertion, candidateAddresses, new Set([txHash])))) continue;
    ordinary.push(txHash);
  }
  return ordinary;
}

function replayAssertion(row: Record<string, unknown>) {
  if (typeof row.chain !== "string" || typeof row.address !== "string" || typeof row.status !== "string"
    || !row.evidenceJson || typeof row.evidenceJson !== "object" || Array.isArray(row.evidenceJson)) {
    fail("where_latency_replay_assertion_row_invalid");
  }
  return {
    chain: row.chain,
    address: row.address,
    status: row.status,
    evidenceJson: structuredClone(row.evidenceJson)
  };
}

function assertionMatches(row: ReturnType<typeof replayAssertion>, addresses: Set<string>, txHashes: Set<string>): boolean {
  if (addresses.has(row.address)) return true;
  const evidence = row.evidenceJson as Record<string, unknown>;
  for (const key of ["approvalTxHash", "drainTxHash"] as const) {
    if (typeof evidence[key] === "string" && txHashes.has(evidence[key].toLowerCase())) return true;
  }
  return Array.isArray(evidence.pathTxHashes)
    && evidence.pathTxHashes.some((hash) => typeof hash === "string" && txHashes.has(hash.toLowerCase()));
}

function normalizedDecisionEvidence(evidence: TransactionEnrichmentDecisionEvidenceV1): TransactionEnrichmentDecisionEvidenceV1 {
  return {
    ...evidence,
    txHash: evidence.txHash.toLowerCase(),
    triggerCodes: [...new Set(evidence.triggerCodes)].sort(),
    providerEvidenceIds: [...new Set(evidence.providerEvidenceIds)].sort()
  };
}

function replayDecisionEvidenceId(evidence: TransactionEnrichmentDecisionEvidenceV1): string {
  return `transaction-enrichment-decision-evidence-v1:${fingerprintCanonicalArtifact(normalizedDecisionEvidence(evidence))}`;
}

function replayOutcome(entry: ReplayDependency): unknown {
  if ("error" in entry) {
    if (!entry.error) fail("where_latency_replay_error_invalid");
    const error = new Error(entry.error.message);
    error.name = entry.error.name;
    throw error;
  }
  return reviveReplayValue(structuredClone(entry.response));
}

function sameStableValue(left: unknown, right: unknown): boolean {
  const comparable = (value: unknown): Record<string, unknown> => value === undefined
    ? { present: false }
    : { present: true, value };
  return canonicalizeArtifactJson(comparable(left)) === canonicalizeArtifactJson(comparable(right));
}

export async function analyzeWhereLatencyReplay(replay: WhereLatencyReplayV1): Promise<WhereLatencyReplayAnalysisV1> {
  assertEnvelope(replay);
  const fixed = new Date(replay.frozenClockIso).getTime();
  if (!Number.isFinite(fixed)) fail("where_latency_replay_clock_invalid");
  const providerEvidence = new Map<string, TronTransactionProviderEvidenceV1>();
  const decisionEvidence = new Map<string, TransactionEnrichmentDecisionEvidenceV1>();
  const movements = replay.indexedMovements.flatMap((entry) => entry.rows.map(replayIndexedMovement));
  const allowedHashes = new Set(replay.routeCriticalTxHashes.map((hash) => hash.toLowerCase()));
  const allowedAddresses = new Set([
    ...replay.routeCriticalAddresses,
    ...movements.flatMap((edge) => [edge.fromAddress, edge.toAddress, edge.callerAddress, edge.contractAddress]
      .filter((address): address is string => typeof address === "string"))
  ]);
  const assertionRows = replay.assertionQueries.flatMap((query) => query.rows.map(replayAssertion));
  const fullTape = new Map<string, ReplayDependency>();
  for (const entry of replay.dependencies.filter((candidate) => candidate.method === "getTransaction")) {
    const hash = typeof entry.args[0] === "string" ? entry.args[0].toLowerCase() : "";
    const existing = fullTape.get(hash);
    if (existing && canonicalizeArtifactJson("response" in existing ? existing.response : existing.error)
      !== canonicalizeArtifactJson("response" in entry ? entry.response : entry.error)) {
      fail("where_latency_replay_transaction_info_tape_conflict");
    }
    fullTape.set(hash, existing ?? entry);
  }
  const rawTape = new Map(replay.rawTransactions.map((entry) => [entry.txHash.toLowerCase(), entry.response]));
  const fullResponseHashes = new Set(replay.dependencies.flatMap((entry) =>
    entry.method === "getTransaction" && "response" in entry && typeof entry.args[0] === "string"
      ? [entry.args[0].toLowerCase()]
      : []
  ));
  const missingRawTxHashes = [...allowedHashes].filter((hash) => !rawTape.has(hash)).sort();
  const missingFullTxHashes = [...allowedHashes].filter((hash) => !fullResponseHashes.has(hash)).sort();
  const tapeCompleteness: WhereLatencyReplayAnalysisV1["tapeCompleteness"] = {
    status: missingRawTxHashes.length === 0 && missingFullTxHashes.length === 0 ? "complete" : "incomplete",
    missingRawTxHashes,
    missingFullTxHashes,
    missingRawEvidenceIds: missingRawTxHashes.map((txHash) => transactionProviderEvidenceId({
      version: "tron-transaction-provider-evidence-v1",
      chain: "tron",
      txHash,
      provider: "tron_fullnode",
      endpoint: "gettransactionbyid",
      providerSchemaVersion: 1
    })),
    missingFullEvidenceIds: missingFullTxHashes.map((txHash) => transactionProviderEvidenceId({
      version: "tron-transaction-provider-evidence-v1",
      chain: "tron",
      txHash,
      provider: "tronscan",
      endpoint: "transaction-info",
      providerSchemaVersion: 1
    }))
  };

  const execute = async (): Promise<WhereLatencyReplayRunV1> => {
    const baseDeps = createWhereReplayDepsInternal(replay, { ignoreLegacyMethods: new Set(["getTransaction"]) });
    const rawCallHashes: string[] = [];
    const fullCallHashes: string[] = [];
    const selectiveTransactionEnricher = createSelectiveTransactionEnricher({
      async getSavedEvidence(identity: TransactionProviderEvidenceIdentityV1) {
        return providerEvidence.get(transactionProviderEvidenceId(identity)) ?? null;
      },
      async saveProviderEvidence(evidence) {
        const id = transactionProviderEvidenceId(evidence);
        const existing = providerEvidence.get(id);
        if (existing && canonicalizeArtifactJson(existing) !== canonicalizeArtifactJson(evidence)) {
          fail("where_latency_replay_provider_evidence_conflict");
        }
        providerEvidence.set(id, existing ?? evidence);
        return { id };
      },
      async saveDecisionEvidence(evidence) {
        const normalized = normalizedDecisionEvidence(evidence);
        const id = replayDecisionEvidenceId(normalized);
        const existing = decisionEvidence.get(id);
        if (existing && canonicalizeArtifactJson(existing) !== canonicalizeArtifactJson(normalized)) {
          fail("where_latency_replay_decision_evidence_conflict");
        }
        decisionEvidence.set(id, existing ?? normalized);
        return { id };
      },
      async getRawTransaction(txHash) {
        const normalized = txHash.toLowerCase();
        rawCallHashes.push(normalized);
        if (!rawTape.has(normalized)) fail("where_latency_replay_raw_tape_missing");
        return reviveReplayValue(structuredClone(rawTape.get(normalized)));
      },
      async getFullTransactionInfo(txHash) {
        const normalized = txHash.toLowerCase();
        fullCallHashes.push(normalized);
        if (!rawTape.has(normalized)) fail("where_latency_replay_raw_tape_missing");
        const entry = fullTape.get(normalized);
        if (!entry) fail("where_latency_replay_full_tape_missing");
        return replayOutcome(entry);
      },
      now: () => new Date(fixed)
    });
    const deps = new Proxy(baseDeps, {
      get(target, property, receiver) {
        if (property === "selectiveTransactionEnricher") return selectiveTransactionEnricher;
        if (property === "listIndexedMovementsByHashes") return async (txHashes: string[]) => {
          const normalized = new Set(txHashes.map((hash) => hash.toLowerCase()));
          if ([...normalized].some((hash) => !allowedHashes.has(hash))) fail("where_latency_replay_request_missing");
          return movements.filter((edge) => normalized.has(edge.txHash.toLowerCase())).map((edge) => structuredClone(edge));
        };
        if (property === "listActiveRouteAssertions") return async (input: { addresses: string[]; txHashes: string[] }) => {
          const addresses = new Set(input.addresses);
          const hashes = new Set(input.txHashes.map((hash) => hash.toLowerCase()));
          if ([...hashes].some((hash) => !allowedHashes.has(hash))
            || [...addresses].some((address) => !allowedAddresses.has(address))) {
            fail("where_latency_replay_request_missing");
          }
          return assertionRows.filter((row) => assertionMatches(row, addresses, hashes)).map((row) => structuredClone(row));
        };
        return Reflect.get(target, property, receiver);
      }
    }) as WhereReplayDeps;
    const options = reviveReplayValue(replay.job.options) as RunWhereIsMoneyCheckInput;
    const report = await runWhereIsMoneyCheck(deps, { ...options, now: () => fixed });
    assertWhereReplayConsumed(baseDeps);
    return {
      report,
      evidenceIds: [...new Set(report.transactionInfoEnrichment?.evidenceIds ?? [])],
      providerCalls: { raw: rawCallHashes.length, full: fullCallHashes.length },
      rawCallHashes,
      fullCallHashes
    };
  };

  const firstRun = await execute();
  const secondRun = await execute();
  const projected = projectStableWhereFacts(firstRun.report);
  const fullCallCounts = new Map<string, number>();
  for (const hash of firstRun.fullCallHashes) fullCallCounts.set(hash, (fullCallCounts.get(hash) ?? 0) + 1);
  return {
    schema: "where-latency-replay-analysis-v1",
    expectedStableFacts: replay.expectedStableFacts,
    expectedOrdinaryOfficialUsdtTxHashes: replay.expectedOrdinaryOfficialUsdtTxHashes,
    tapeCompleteness,
    stableFactsEqual: sameStableValue(projected, replay.expectedStableFacts),
    explicitStableFactsEqual: Object.fromEntries(EXPLICIT_STABLE_FIELDS.map((field) => [
      field,
      sameStableValue(firstRun.report[field], replay.expectedStableFacts[field])
    ])) as WhereLatencyReplayAnalysisV1["explicitStableFactsEqual"],
    requestCounts: {
      baseline: { raw: 0, full: replay.baselineRequestCounts.getTransaction ?? 0 },
      firstRun: firstRun.providerCalls,
      secondRun: secondRun.providerCalls
    },
    maxFullCallsPerIdentity: Math.max(0, ...fullCallCounts.values()),
    firstRun,
    secondRun
  };
}

export function assertWhereLatencyReplayAcceptance(analysis: WhereLatencyReplayAnalysisV1): void {
  if (analysis.tapeCompleteness.status !== "complete") fail("where_latency_replay_tape_incomplete");
  const plainHashes = new Set(analysis.expectedOrdinaryOfficialUsdtTxHashes);
  if (analysis.firstRun.fullCallHashes.some((hash) => plainHashes.has(hash))) {
    fail("where_latency_replay_plain_transfer_full_request");
  }
  if (analysis.maxFullCallsPerIdentity > 1) fail("where_latency_replay_duplicate_full_request");
  if (!analysis.stableFactsEqual) fail("where_latency_replay_stable_fact_mismatch");
  for (const [field, equal] of Object.entries(analysis.explicitStableFactsEqual)) {
    if (!equal) fail(`where_latency_replay_${field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_mismatch`);
  }
  if (analysis.requestCounts.firstRun.full >= analysis.requestCounts.baseline.full) {
    fail("where_latency_replay_full_request_reduction_missing");
  }
  const baselineTotal = analysis.requestCounts.baseline.raw + analysis.requestCounts.baseline.full;
  const firstTotal = analysis.requestCounts.firstRun.raw + analysis.requestCounts.firstRun.full;
  if (firstTotal >= baselineTotal) fail("where_latency_replay_provider_request_reduction_missing");
  if (analysis.requestCounts.secondRun.raw !== 0 || analysis.requestCounts.secondRun.full !== 0) {
    fail("where_latency_replay_second_job_provider_request");
  }
  if (!sameStableValue(analysis.firstRun.evidenceIds, analysis.secondRun.evidenceIds)) {
    fail("where_latency_replay_evidence_identity_mismatch");
  }
  if (!sameStableValue(projectStableWhereFacts(analysis.firstRun.report), projectStableWhereFacts(analysis.secondRun.report))) {
    fail("where_latency_replay_second_job_fact_mismatch");
  }
}
