import "dotenv/config";
import { execFile } from "node:child_process";
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
  type KeyObject
} from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as vm from "node:vm";
import { TronWeb } from "tronweb";
import { loadConfig } from "../src/config";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson";

export const WHERE_LATENCY_CANARY_LONG_ADDRESS =
  "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
export const WHERE_LATENCY_CANARY_FRESH_ADDRESS =
  "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";

const ALLOWED_CYCLES = [
  "address_index",
  "delivery_reconciliation",
  "where"
] as const;
const DEEP_RESIDUAL_ALLOWED_CYCLES = [
  "address_index",
  "deep",
  "delivery_reconciliation"
] as const;
const ISOLATION_SCHEMA = "where-latency-canary-isolation-v1";
const RUN_SCHEMA = "where-latency-canary-run-v1";
const SAFE_CANARY_NODE_BUILTINS = [
  "node:buffer", "node:timers", "node:timers/promises", "node:url"
] as const;
const SAFE_CANARY_NODE_BUILTIN_SET = new Set<string>(SAFE_CANARY_NODE_BUILTINS);

type AllowedCycle = typeof ALLOWED_CYCLES[number];

export type WhereLatencyCanaryAdapterIdentity = {
  schema: "where-latency-canary-adapter-v1";
  moduleRealPath: string;
  moduleContentSha256: string;
};

export type WhereLatencyCanaryDeploymentIdentity = {
  schema: "where-latency-canary-deployment-identity-v1";
  deploymentReceiptFileSha256: string;
  immutableArtifactDigest: string;
  gitCommit: string;
  gitTree: string;
  moduleGraphSha256: string;
  adapterEntrySha256: string;
  bundleFormat: "single_file_esm_bundle_v1";
  nodeRuntime: { implementation: "node"; version: string; execArgv: string[] };
  allowedNodeBuiltins: string[];
  bridgeProtocolVersion: "where-latency-canary-bridge-v1";
  bridgePublicKeySpkiSha256: string;
};

export type WhereLatencyCanaryRuntimeAttestation = {
  schema: "where-latency-canary-runtime-attestation-v1";
  runtimeInstanceLabel: string;
  runtimeConfigIdentity: string;
  databaseFingerprint: string;
  enabledRuntimeCycles: readonly string[];
  whereWorkerConcurrency: number;
  deepWorkerConcurrency: number;
  wherePumpBindingIdentity: string;
  schedulerBindingIdentity: string;
  forensicRepositoryBindingIdentity: string;
  deliveryRepositoryBindingIdentity: string;
  addressIndexBindingIdentity: string;
  deepWorkerBindingIdentity: string;
  schedulerCapacityFingerprint: string;
  schedulerOwnershipBindingIdentity: string;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
};

export type WhereLatencyCanaryConfig = {
  databaseUrl: string;
  dedicatedDeployment: boolean;
  runtimeInstanceLabel: string;
  enabledRuntimeCycles: readonly string[];
  workerConcurrency: number;
  deepWorkerConcurrency: number;
  wherePollIntervalMs: number;
  terminalTimeoutMs: number;
  drainTimeoutMs: number;
  runtimeConfigIdentity: string;
  runtimeBridgeUrl: string;
  runtimeBridgeTimeoutMs: number;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
};

export type WhereLatencyCanaryUnboundConfig = Omit<
  WhereLatencyCanaryConfig,
  "adapterIdentity" | "deploymentIdentity"
>;

export type WhereLatencyCanaryRuntimeFactoryConfig =
  WhereLatencyCanaryUnboundConfig & {
    deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
  };

export type WhereLatencySchedulerDiagnostics = {
  apiKeyConfigured: boolean;
  queued: number;
  inFlight: number;
  maxInFlight: number;
  maxInFlightPerGroup: number;
  apiKeyCount: number;
  apiKeyGroupCount: number;
  dispatchedRequests: number;
  completedRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
};

export type WhereLatencyLaneDiagnostics = {
  allForensic: { runnableQueuedCount: number; dbRunningCount: number };
  where: { runnableQueuedCount: number; dbRunningCount: number };
  deep: { runnableQueuedCount: number; dbRunningCount: number };
};

type SchedulerOwnershipCounters = {
  queued: number;
  inFlight: number;
  dispatched: number;
  completed: number;
  failed: number;
  rateLimited: number;
};

export type WhereLatencySchedulerOwnershipDiagnostics = {
  preExistingAddressIndexWork: number;
  preExistingCanaryExternalWork: number;
  canaryOwned: SchedulerOwnershipCounters;
  foreign: SchedulerOwnershipCounters;
};

export type WhereLatencyCanaryRuntime = {
  runtimeAttestation(): Promise<WhereLatencyCanaryRuntimeAttestation>;
  schedulerIsolationDiagnostics(
    requestedBy: string | null
  ): Promise<WhereLatencySchedulerOwnershipDiagnostics>;
  schedulerDiagnostics(): Promise<WhereLatencySchedulerDiagnostics>;
  laneDiagnostics(): Promise<WhereLatencyLaneDiagnostics>;
  enqueueWhereJob(input: {
    subjectAddress: string;
    priority: number;
    chatId: null;
    requestedBy: string;
    progressMarker: string;
  }): Promise<{ id: string; createdAtMs: number }>;
  waitForHandlerStart(jobId: string, signal: AbortSignal): Promise<{
    jobId: string;
    startedAtMs: number;
    activeWhereHandlers: number;
  }>;
  jobRuntimeState(jobId: string): Promise<{
    jobId: string;
    status: "queued" | "running" | "completed" | "partial" | "failed";
    handlerActive: boolean;
  }>;
  waitForTerminal(jobId: string, signal: AbortSignal): Promise<{
    jobId: string;
    status: "completed" | "partial" | "failed";
    completedAtMs: number;
  }>;
  deliveryDiagnostics(jobIds: readonly string[]): Promise<{
    intentCount: number;
    claimCount: number;
  }>;
  maxActiveWhereHandlers(): number;
  stopClaimsAndDrain(jobIds: readonly string[], signal: AbortSignal): Promise<void>;
};

export type WhereLatencyDeepResidualRuntime = WhereLatencyCanaryRuntime & {
  enqueueDeepJob(input: {
    subjectAddress: string;
    priority: number;
    chatId: null;
    requestedBy: string;
    progressMarker: string;
  }): Promise<{ id: string; createdAtMs: number }>;
  waitForDeepHandlerStart(jobId: string, signal: AbortSignal): Promise<{
    jobId: string;
    startedAtMs: number;
    activeDeepHandlers: number;
  }>;
  deepJobDiagnostics(jobId: string): Promise<{ providerErrorCount: number }>;
  memoryDiagnostics(): Promise<{ rssBytes: number; heapUsedBytes: number }>;
  stopDeepClaimsAndDrain(jobIds: readonly string[], signal: AbortSignal): Promise<void>;
};

export type WhereLatencyDeepResidualReceipt = {
  schema: "where-latency-deep-residual-v1";
  version: 1;
  result: "measured";
  createdAt: string;
  measurementId: string;
  requestedBy: string;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
  runtimeAttestation: WhereLatencyCanaryRuntimeAttestation;
  configSha256: string;
  subjectAddress: string;
  job: {
    id: string;
    createdAtMs: number;
    startedAtMs: number;
    terminal: TerminalResult;
  };
  queueAgeMs: number;
  providerErrors: {
    jobReported: number;
    schedulerFailedRequestDelta: number;
    schedulerRateLimitedRequestDelta: number;
  };
  memory: {
    before: { rssBytes: number; heapUsedBytes: number };
    atStart: { rssBytes: number; heapUsedBytes: number };
    afterDrain: { rssBytes: number; heapUsedBytes: number };
  };
  delivery: {
    beforeDrain: { intentCount: number; claimCount: number };
    afterDrain: { intentCount: number; claimCount: number };
  };
  lanes: { start: WhereLatencyLaneDiagnostics; end: WhereLatencyLaneDiagnostics };
  scheduler: {
    start: WhereLatencySchedulerDiagnostics;
    end: WhereLatencySchedulerDiagnostics;
  };
  schedulerIsolation: {
    start: WhereLatencySchedulerOwnershipDiagnostics;
    end: WhereLatencySchedulerOwnershipDiagnostics;
  };
  drained: true;
  sha256: string;
};

type IsolationReceiptPayload = {
  schema: typeof ISOLATION_SCHEMA;
  version: 1;
  preparedAt: string;
  databaseFingerprint: string;
  runtimeInstanceLabel: string;
  enabledRuntimeCycles: AllowedCycle[];
  workerConcurrency: 2;
  deepWorkerConcurrency: 1;
  wherePollIntervalMs: number;
  terminalTimeoutMs: number;
  drainTimeoutMs: number;
  schedulerBaseline: WhereLatencySchedulerDiagnostics;
  schedulerIsolationBaseline: WhereLatencySchedulerOwnershipDiagnostics;
  schedulerCapacityFingerprint: string;
  configSha256: string;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
  runtimeAttestation: WhereLatencyCanaryRuntimeAttestation;
};

export type WhereLatencyCanaryIsolationReceipt = IsolationReceiptPayload & {
  sha256: string;
};

type TerminalResult = Awaited<ReturnType<WhereLatencyCanaryRuntime["waitForTerminal"]>>;

export type WhereLatencyCanaryRunReceipt = {
  schema: typeof RUN_SCHEMA;
  version: 1;
  result: "pass" | "non_gating_not_isolated";
  diagnosticCode: "no_stage_b_start_guarantee" | null;
  createdAt: string;
  canaryId: string;
  requestedBy: string;
  isolationReceiptSha256: string;
  isolationReceiptFileSha256: string;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
  runtimeAttestation: WhereLatencyCanaryRuntimeAttestation;
  addresses: { long: string; fresh: string };
  jobs: {
    long: { id: string; createdAtMs: number; startedAtMs: number; terminal: TerminalResult | null };
    fresh: { id: string; createdAtMs: number; startedAtMs: number; terminal: TerminalResult } | null;
  };
  startGate: { elapsedMs: number | null; maximumMs: number; passed: boolean };
  slotGate: { maximumActiveHandlers: number; configuredHandlers: 2; passed: boolean };
  deliveryGate: {
    beforeDrain: { intentCount: number; claimCount: number };
    endAfterDrain: { intentCount: number; claimCount: number };
    intentCount: number;
    claimCount: number;
    passed: boolean;
  };
  laneGate: {
    start: WhereLatencyLaneDiagnostics;
    end: WhereLatencyLaneDiagnostics;
    passed: boolean;
  };
  schedulerGate: {
    start: WhereLatencySchedulerDiagnostics;
    end: WhereLatencySchedulerDiagnostics;
    dispatchedRequestDelta: number;
    completedRequestDelta: number;
    failedRequestDelta: number;
    rateLimitedRequestDelta: number;
    capacityFingerprintAtStart: string;
    capacityFingerprintAtEnd: string;
    passed: boolean;
  };
  schedulerIsolationGate: {
    start: WhereLatencySchedulerOwnershipDiagnostics;
    end: WhereLatencySchedulerOwnershipDiagnostics;
    passed: boolean;
  };
  terminalAndDrainGate: { bothTerminal: boolean; drained: boolean; passed: boolean };
  deepConcurrency: 1;
  residualDeepLatencyMeasuredSeparately: true;
  sha256: string;
};

function safeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function canonicalCycles(input: readonly string[]): AllowedCycle[] {
  const cycles = [...new Set(input)].sort();
  if (
    cycles.length !== ALLOWED_CYCLES.length ||
    cycles.some((cycle, index) => cycle !== ALLOWED_CYCLES[index])
  ) {
    throw new Error("where_latency_canary_cycle_allowlist_invalid");
  }
  return cycles as AllowedCycle[];
}

function validateBaseConfig(config: WhereLatencyCanaryUnboundConfig): void {
  if (!config.dedicatedDeployment) {
    throw new Error("where_latency_canary_dedicated_deployment_required");
  }
  if (!config.runtimeInstanceLabel.trim()) {
    throw new Error("where_latency_canary_runtime_instance_label_required");
  }
  if (config.workerConcurrency !== 2) {
    throw new Error("where_latency_canary_concurrency_two_required");
  }
  if (config.deepWorkerConcurrency !== 1) {
    throw new Error("where_latency_canary_deep_concurrency_must_remain_one");
  }
  if (!Number.isSafeInteger(config.wherePollIntervalMs) || config.wherePollIntervalMs < 1) {
    throw new Error("where_latency_canary_poll_interval_invalid");
  }
  if (!Number.isSafeInteger(config.terminalTimeoutMs) || config.terminalTimeoutMs < 1) {
    throw new Error("where_latency_canary_terminal_timeout_invalid");
  }
  if (!Number.isSafeInteger(config.drainTimeoutMs) || config.drainTimeoutMs < 1) {
    throw new Error("where_latency_canary_drain_timeout_invalid");
  }
  if (!Number.isSafeInteger(config.runtimeBridgeTimeoutMs) || config.runtimeBridgeTimeoutMs < 1) {
    throw new Error("where_latency_canary_runtime_bridge_timeout_invalid");
  }
  assertSha256(config.runtimeConfigIdentity, "where_latency_canary_runtime_config_identity_invalid");
  let bridgeUrl: URL;
  try {
    bridgeUrl = new URL(config.runtimeBridgeUrl);
  } catch {
    throw new Error("where_latency_canary_runtime_bridge_url_invalid");
  }
  if (
    !(["http:", "https:"] as const).includes(bridgeUrl.protocol as "http:" | "https:") ||
    !(bridgeUrl.hostname === "127.0.0.1" || bridgeUrl.hostname === "[::1]") ||
    bridgeUrl.username !== "" || bridgeUrl.password !== "" || bridgeUrl.hash !== ""
  ) throw new Error("where_latency_canary_runtime_bridge_url_invalid");
}

function validateUnboundConfig(config: WhereLatencyCanaryUnboundConfig): AllowedCycle[] {
  validateBaseConfig(config);
  return canonicalCycles(config.enabledRuntimeCycles);
}

function canonicalDeepResidualCycles(input: readonly string[]): string[] {
  const cycles = [...new Set(input)].sort();
  if (
    cycles.length !== DEEP_RESIDUAL_ALLOWED_CYCLES.length ||
    cycles.some((cycle, index) => cycle !== DEEP_RESIDUAL_ALLOWED_CYCLES[index])
  ) throw new Error("where_latency_deep_residual_cycle_allowlist_invalid");
  return cycles;
}

function validateDeepResidualConfig(config: WhereLatencyCanaryConfig): string[] {
  validateBaseConfig(config);
  assertAdapterIdentity(config.adapterIdentity);
  assertDeploymentIdentity(config.deploymentIdentity);
  return canonicalDeepResidualCycles(config.enabledRuntimeCycles);
}

function validateDeepResidualUnboundConfig(
  config: WhereLatencyCanaryUnboundConfig
): string[] {
  validateBaseConfig(config);
  return canonicalDeepResidualCycles(config.enabledRuntimeCycles);
}

function validateConfig(config: WhereLatencyCanaryConfig): AllowedCycle[] {
  const cycles = validateUnboundConfig(config);
  assertAdapterIdentity(config.adapterIdentity);
  assertDeploymentIdentity(config.deploymentIdentity);
  return cycles;
}

function assertSha256(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(code);
}

function assertAdapterIdentity(value: WhereLatencyCanaryAdapterIdentity): void {
  if (
    value?.schema !== "where-latency-canary-adapter-v1" ||
    typeof value.moduleRealPath !== "string" || !value.moduleRealPath.trim()
  ) throw new Error("where_latency_canary_adapter_identity_invalid");
  assertSha256(value.moduleContentSha256, "where_latency_canary_adapter_identity_invalid");
}

function canonicalAllowedNodeBuiltins(input: readonly string[], code: string): string[] {
  if (!Array.isArray(input) || input.some((value) => !SAFE_CANARY_NODE_BUILTIN_SET.has(value))) {
    throw new Error(code);
  }
  const canonical = [...new Set(input)].sort();
  if (canonicalizeArtifactJson(canonical) !== canonicalizeArtifactJson(input)) {
    throw new Error(code);
  }
  return canonical;
}

function assertDeploymentIdentity(value: WhereLatencyCanaryDeploymentIdentity): void {
  if (
    value?.schema !== "where-latency-canary-deployment-identity-v1" ||
    value.bundleFormat !== "single_file_esm_bundle_v1" ||
    value.nodeRuntime?.implementation !== "node" ||
    value.nodeRuntime.version !== process.version ||
    canonicalizeArtifactJson(value.nodeRuntime.execArgv) !==
      canonicalizeArtifactJson(process.execArgv) ||
    !Array.isArray(value.allowedNodeBuiltins) ||
    value.bridgeProtocolVersion !== "where-latency-canary-bridge-v1" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.immutableArtifactDigest) ||
    !/^[a-f0-9]{40}$/.test(value.gitCommit) ||
    !/^[a-f0-9]{40}$/.test(value.gitTree)
  ) throw new Error("where_latency_canary_deployment_identity_invalid");
  for (const identity of [
    value.deploymentReceiptFileSha256,
    value.moduleGraphSha256,
    value.adapterEntrySha256,
    value.bridgePublicKeySpkiSha256
  ]) assertSha256(identity, "where_latency_canary_deployment_identity_invalid");
  canonicalAllowedNodeBuiltins(
    value.allowedNodeBuiltins,
    "where_latency_canary_deployment_identity_invalid"
  );
}

function databaseFingerprint(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("where_latency_canary_database_url_invalid");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("where_latency_canary_database_url_invalid");
  }
  return fingerprintCanonicalArtifact({
    schema: "where-latency-canary-database-v1",
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, "")
  });
}

function assertSchedulerShape(input: WhereLatencySchedulerDiagnostics): void {
  if (typeof input.apiKeyConfigured !== "boolean") {
    throw new Error("where_latency_canary_scheduler_apiKeyConfigured_invalid");
  }
  for (const key of [
    "queued", "inFlight", "maxInFlight", "maxInFlightPerGroup",
    "apiKeyCount", "apiKeyGroupCount", "dispatchedRequests",
    "completedRequests", "failedRequests", "rateLimitedRequests"
  ] as const) {
    safeInteger(input[key], `where_latency_canary_scheduler_${key}_invalid`);
  }
}

function schedulerCapacityFingerprint(input: WhereLatencySchedulerDiagnostics): string {
  assertSchedulerShape(input);
  return fingerprintCanonicalArtifact({
    schema: "tronscan-scheduler-capacity-v1",
    apiKeyConfigured: input.apiKeyConfigured,
    apiKeyCount: input.apiKeyCount,
    apiKeyGroupCount: input.apiKeyGroupCount,
    maxInFlight: input.maxInFlight,
    maxInFlightPerGroup: input.maxInFlightPerGroup
  });
}

function assertOwnershipShape(value: WhereLatencySchedulerOwnershipDiagnostics): void {
  safeInteger(value.preExistingAddressIndexWork, "where_latency_canary_scheduler_ownership_invalid");
  safeInteger(value.preExistingCanaryExternalWork, "where_latency_canary_scheduler_ownership_invalid");
  for (const scope of [value.canaryOwned, value.foreign]) {
    for (const counter of Object.values(scope)) {
      safeInteger(counter, "where_latency_canary_scheduler_ownership_invalid");
    }
  }
}

function assertOwnershipCleanStart(value: WhereLatencySchedulerOwnershipDiagnostics): void {
  assertOwnershipShape(value);
  if (
    value.preExistingAddressIndexWork !== 0 ||
    value.preExistingCanaryExternalWork !== 0 ||
    Object.values(value.canaryOwned).some((counter) => counter !== 0) ||
    Object.values(value.foreign).some((counter) => counter !== 0)
  ) throw new Error("where_latency_canary_scheduler_isolation_not_clean");
}

function assertOwnershipWindowClean(
  start: WhereLatencySchedulerOwnershipDiagnostics,
  end: WhereLatencySchedulerOwnershipDiagnostics
): void {
  assertOwnershipCleanStart(start);
  assertOwnershipShape(end);
  const foreignChanged = (Object.keys(end.foreign) as Array<keyof SchedulerOwnershipCounters>)
    .some((key) => end.foreign[key] !== start.foreign[key]);
  if (
    end.preExistingAddressIndexWork !== 0 ||
    end.preExistingCanaryExternalWork !== 0 ||
    foreignChanged || Object.values(end.foreign).some((counter) => counter !== 0) ||
    end.canaryOwned.queued !== 0 || end.canaryOwned.inFlight !== 0 ||
    end.canaryOwned.failed !== 0 || end.canaryOwned.rateLimited !== 0 ||
    end.canaryOwned.completed !== end.canaryOwned.dispatched
  ) throw new Error("where_latency_canary_scheduler_isolation_contaminated");
  for (const key of ["dispatched", "completed", "failed", "rateLimited"] as const) {
    if (end.canaryOwned[key] < start.canaryOwned[key]) {
      throw new Error("where_latency_canary_scheduler_ownership_regressed");
    }
  }
}

function assertOwnershipMatchesSchedulerWindow(
  ownership: WhereLatencySchedulerOwnershipDiagnostics,
  scheduler: {
    dispatched: number;
    completed: number;
    failed: number;
    rateLimited: number;
  }
): void {
  if (
    ownership.canaryOwned.dispatched !== scheduler.dispatched ||
    ownership.canaryOwned.completed !== scheduler.completed ||
    ownership.canaryOwned.failed !== scheduler.failed ||
    ownership.canaryOwned.rateLimited !== scheduler.rateLimited
  ) throw new Error("where_latency_canary_scheduler_ownership_counter_mismatch");
}

function configProjection(
  config: WhereLatencyCanaryConfig,
  cycles: readonly string[],
  capacityFingerprint: string
) {
  return {
    schema: "where-latency-canary-config-v1",
    databaseFingerprint: databaseFingerprint(config.databaseUrl),
    runtimeInstanceLabel: config.runtimeInstanceLabel.trim(),
    runtimeConfigIdentity: config.runtimeConfigIdentity,
    runtimeBridgeUrl: config.runtimeBridgeUrl,
    runtimeBridgeTimeoutMs: config.runtimeBridgeTimeoutMs,
    adapterIdentity: { ...config.adapterIdentity },
    deploymentIdentity: { ...config.deploymentIdentity },
    enabledRuntimeCycles: [...cycles],
    workerConcurrency: 2,
    deepWorkerConcurrency: 1,
    wherePollIntervalMs: config.wherePollIntervalMs,
    terminalTimeoutMs: config.terminalTimeoutMs,
    drainTimeoutMs: config.drainTimeoutMs,
    schedulerCapacityFingerprint: capacityFingerprint
  };
}

function canonicalRuntimeAttestation(
  config: WhereLatencyCanaryConfig,
  scheduler: WhereLatencySchedulerDiagnostics,
  value: WhereLatencyCanaryRuntimeAttestation
): WhereLatencyCanaryRuntimeAttestation {
  const capacityFingerprint = schedulerCapacityFingerprint(scheduler);
  const cycles = assertRuntimeAttestationShape(value);
  if (
    value.runtimeInstanceLabel !== config.runtimeInstanceLabel.trim() ||
    value.runtimeConfigIdentity !== config.runtimeConfigIdentity ||
    value.databaseFingerprint !== databaseFingerprint(config.databaseUrl) ||
    canonicalizeArtifactJson(cycles) !== canonicalizeArtifactJson(canonicalCycles(config.enabledRuntimeCycles)) ||
    value.schedulerCapacityFingerprint !== capacityFingerprint ||
    canonicalizeArtifactJson(value.deploymentIdentity) !==
      canonicalizeArtifactJson(config.deploymentIdentity)
  ) {
    throw new Error("where_latency_canary_runtime_attestation_mismatch");
  }
  return projectRuntimeAttestation(value, cycles);
}

function projectRuntimeAttestation(
  value: WhereLatencyCanaryRuntimeAttestation,
  enabledRuntimeCycles: readonly string[]
): WhereLatencyCanaryRuntimeAttestation {
  return {
    schema: "where-latency-canary-runtime-attestation-v1",
    runtimeInstanceLabel: value.runtimeInstanceLabel,
    runtimeConfigIdentity: value.runtimeConfigIdentity,
    databaseFingerprint: value.databaseFingerprint,
    enabledRuntimeCycles: [...enabledRuntimeCycles],
    whereWorkerConcurrency: value.whereWorkerConcurrency,
    deepWorkerConcurrency: value.deepWorkerConcurrency,
    wherePumpBindingIdentity: value.wherePumpBindingIdentity,
    schedulerBindingIdentity: value.schedulerBindingIdentity,
    forensicRepositoryBindingIdentity: value.forensicRepositoryBindingIdentity,
    deliveryRepositoryBindingIdentity: value.deliveryRepositoryBindingIdentity,
    addressIndexBindingIdentity: value.addressIndexBindingIdentity,
    deepWorkerBindingIdentity: value.deepWorkerBindingIdentity,
    schedulerCapacityFingerprint: value.schedulerCapacityFingerprint,
    schedulerOwnershipBindingIdentity: value.schedulerOwnershipBindingIdentity,
    deploymentIdentity: { ...value.deploymentIdentity }
  };
}

function assertRuntimeAttestationShape(
  value: WhereLatencyCanaryRuntimeAttestation
): AllowedCycle[] {
  const cycles = canonicalCycles(value.enabledRuntimeCycles);
  const bindings = {
    wherePumpBindingIdentity: value.wherePumpBindingIdentity,
    schedulerBindingIdentity: value.schedulerBindingIdentity,
    forensicRepositoryBindingIdentity: value.forensicRepositoryBindingIdentity,
    deliveryRepositoryBindingIdentity: value.deliveryRepositoryBindingIdentity,
    addressIndexBindingIdentity: value.addressIndexBindingIdentity,
    deepWorkerBindingIdentity: value.deepWorkerBindingIdentity,
    schedulerOwnershipBindingIdentity: value.schedulerOwnershipBindingIdentity
  };
  for (const [field, identity] of Object.entries(bindings)) {
    assertSha256(identity, `where_latency_canary_runtime_${field}_invalid`);
  }
  if (new Set(Object.values(bindings)).size !== Object.keys(bindings).length) {
    throw new Error("where_latency_canary_runtime_binding_identity_collision");
  }
  if (
    value.schema !== "where-latency-canary-runtime-attestation-v1" ||
    typeof value.runtimeInstanceLabel !== "string" || !value.runtimeInstanceLabel ||
    value.whereWorkerConcurrency !== 2 || value.deepWorkerConcurrency !== 1
  ) {
    throw new Error("where_latency_canary_runtime_attestation_mismatch");
  }
  assertSha256(value.runtimeConfigIdentity, "where_latency_canary_runtime_attestation_mismatch");
  assertSha256(value.databaseFingerprint, "where_latency_canary_runtime_attestation_mismatch");
  assertSha256(value.schedulerCapacityFingerprint, "where_latency_canary_runtime_attestation_mismatch");
  assertDeploymentIdentity(value.deploymentIdentity);
  return cycles;
}

function canonicalDeepResidualAttestation(
  config: WhereLatencyCanaryConfig,
  scheduler: WhereLatencySchedulerDiagnostics,
  value: WhereLatencyCanaryRuntimeAttestation
): WhereLatencyCanaryRuntimeAttestation {
  const cycles = canonicalDeepResidualCycles(value.enabledRuntimeCycles);
  const bindingIdentities = [
    value.wherePumpBindingIdentity,
    value.schedulerBindingIdentity,
    value.forensicRepositoryBindingIdentity,
    value.deliveryRepositoryBindingIdentity,
    value.addressIndexBindingIdentity,
    value.deepWorkerBindingIdentity,
    value.schedulerOwnershipBindingIdentity
  ];
  for (const identity of bindingIdentities) {
    assertSha256(identity, "where_latency_deep_residual_runtime_binding_invalid");
  }
  if (new Set(bindingIdentities).size !== bindingIdentities.length) {
    throw new Error("where_latency_deep_residual_runtime_binding_identity_collision");
  }
  if (
    value.schema !== "where-latency-canary-runtime-attestation-v1" ||
    value.runtimeInstanceLabel !== config.runtimeInstanceLabel.trim() ||
    value.runtimeConfigIdentity !== config.runtimeConfigIdentity ||
    value.databaseFingerprint !== databaseFingerprint(config.databaseUrl) ||
    value.whereWorkerConcurrency !== 2 || value.deepWorkerConcurrency !== 1 ||
    value.schedulerCapacityFingerprint !== schedulerCapacityFingerprint(scheduler) ||
    canonicalizeArtifactJson(value.deploymentIdentity) !==
      canonicalizeArtifactJson(config.deploymentIdentity) ||
    canonicalizeArtifactJson(cycles) !==
      canonicalizeArtifactJson(canonicalDeepResidualCycles(config.enabledRuntimeCycles))
  ) throw new Error("where_latency_deep_residual_runtime_attestation_mismatch");
  return projectRuntimeAttestation(value, cycles);
}

function withHash<T extends Record<string, unknown>>(payload: T): T & { sha256: string } {
  return { ...payload, sha256: fingerprintCanonicalArtifact(payload) };
}

export function buildWhereLatencyCanaryIsolationReceipt(input: {
  config: WhereLatencyCanaryConfig;
  scheduler: WhereLatencySchedulerDiagnostics;
  schedulerIsolation: WhereLatencySchedulerOwnershipDiagnostics;
  runtimeAttestation: WhereLatencyCanaryRuntimeAttestation;
  preparedAt: string;
}): WhereLatencyCanaryIsolationReceipt {
  const cycles = validateConfig(input.config);
  assertSchedulerShape(input.scheduler);
  if (input.scheduler.queued !== 0 || input.scheduler.inFlight !== 0) {
    throw new Error("where_latency_canary_scheduler_not_clean");
  }
  const capacityFingerprint = schedulerCapacityFingerprint(input.scheduler);
  assertOwnershipCleanStart(input.schedulerIsolation);
  const runtimeAttestation = canonicalRuntimeAttestation(
    input.config,
    input.scheduler,
    input.runtimeAttestation
  );
  const projection = configProjection(input.config, cycles, capacityFingerprint);
  return withHash({
    schema: ISOLATION_SCHEMA,
    version: 1,
    preparedAt: input.preparedAt,
    databaseFingerprint: projection.databaseFingerprint,
    runtimeInstanceLabel: projection.runtimeInstanceLabel,
    enabledRuntimeCycles: [...cycles],
    workerConcurrency: 2,
    deepWorkerConcurrency: 1,
    wherePollIntervalMs: projection.wherePollIntervalMs,
    terminalTimeoutMs: input.config.terminalTimeoutMs,
    drainTimeoutMs: input.config.drainTimeoutMs,
    schedulerBaseline: { ...input.scheduler },
    schedulerIsolationBaseline: input.schedulerIsolation,
    schedulerCapacityFingerprint: capacityFingerprint,
    configSha256: fingerprintCanonicalArtifact(projection),
    adapterIdentity: { ...input.config.adapterIdentity },
    deploymentIdentity: { ...input.config.deploymentIdentity },
    runtimeAttestation
  });
}

function assertCleanLanes(
  lanes: WhereLatencyLaneDiagnostics,
  code = "where_latency_canary_database_not_clean"
): void {
  const counts = [
    lanes.allForensic?.runnableQueuedCount,
    lanes.allForensic?.dbRunningCount,
    lanes.where?.runnableQueuedCount,
    lanes.where?.dbRunningCount,
    lanes.deep?.runnableQueuedCount,
    lanes.deep?.dbRunningCount
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || (value as number) !== 0)) {
    throw new Error(code);
  }
}

async function ensureOutputAbsent(path: string): Promise<void> {
  try {
    await lstat(resolve(path));
    throw new Error("where_latency_canary_output_exists");
  } catch (error) {
    if (error instanceof Error && error.message === "where_latency_canary_output_exists") throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function writeCanonicalExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  let file;
  try {
    file = await open(resolve(path), "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("where_latency_canary_output_exists");
    }
    throw error;
  }
  try {
    await file.writeFile(`${canonicalizeArtifactJson(value)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function prepareWhereLatencyCanary(input: {
  out: string;
  config: WhereLatencyCanaryConfig;
  runtime: WhereLatencyCanaryRuntime;
  now?: () => number;
}): Promise<WhereLatencyCanaryIsolationReceipt> {
  validateConfig(input.config);
  await ensureOutputAbsent(input.out);
  const lanes = await input.runtime.laneDiagnostics();
  assertCleanLanes(lanes);
  const scheduler = await input.runtime.schedulerDiagnostics();
  const schedulerIsolation = await input.runtime.schedulerIsolationDiagnostics(null);
  const runtimeAttestation = await input.runtime.runtimeAttestation();
  const receipt = buildWhereLatencyCanaryIsolationReceipt({
    config: input.config,
    scheduler,
    schedulerIsolation,
    runtimeAttestation,
    preparedAt: new Date((input.now ?? Date.now)()).toISOString()
  });
  await writeCanonicalExclusive(input.out, receipt);
  return receipt;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseIsolationReceipt(value: unknown): WhereLatencyCanaryIsolationReceipt {
  if (!record(value)) throw new Error("where_latency_canary_isolation_receipt_invalid");
  const { sha256, ...payload } = value;
  if (
    payload.schema !== ISOLATION_SCHEMA || payload.version !== 1 ||
    typeof sha256 !== "string" || sha256 !== fingerprintCanonicalArtifact(payload)
  ) {
    throw new Error("where_latency_canary_isolation_receipt_invalid");
  }
  try {
    const receipt = value as unknown as WhereLatencyCanaryIsolationReceipt;
    canonicalCycles(receipt.enabledRuntimeCycles);
    assertSchedulerShape(receipt.schedulerBaseline);
    assertOwnershipCleanStart(receipt.schedulerIsolationBaseline);
    assertAdapterIdentity(receipt.adapterIdentity);
    assertDeploymentIdentity(receipt.deploymentIdentity);
    assertRuntimeAttestationShape(receipt.runtimeAttestation);
    if (
      typeof receipt.databaseFingerprint !== "string" ||
      typeof receipt.runtimeInstanceLabel !== "string" ||
      typeof receipt.schedulerCapacityFingerprint !== "string" ||
      typeof receipt.configSha256 !== "string" ||
      receipt.runtimeAttestation.runtimeInstanceLabel !== receipt.runtimeInstanceLabel ||
      receipt.runtimeAttestation.databaseFingerprint !== receipt.databaseFingerprint ||
      receipt.runtimeAttestation.schedulerCapacityFingerprint !== receipt.schedulerCapacityFingerprint ||
      canonicalizeArtifactJson(receipt.runtimeAttestation.enabledRuntimeCycles) !==
        canonicalizeArtifactJson(receipt.enabledRuntimeCycles) ||
      receipt.workerConcurrency !== 2 || receipt.deepWorkerConcurrency !== 1 ||
      !Number.isSafeInteger(receipt.wherePollIntervalMs) ||
      !Number.isSafeInteger(receipt.terminalTimeoutMs) || receipt.terminalTimeoutMs < 1 ||
      !Number.isSafeInteger(receipt.drainTimeoutMs) || receipt.drainTimeoutMs < 1
    ) throw new Error("invalid");
    return receipt;
  } catch {
    throw new Error("where_latency_canary_isolation_receipt_invalid");
  }
}

export type WhereLatencyCanaryIsolationDocument = {
  receipt: WhereLatencyCanaryIsolationReceipt;
  fileSha256: string;
};

export async function readWhereLatencyCanaryIsolationDocument(
  path: string
): Promise<WhereLatencyCanaryIsolationDocument> {
  const bytes = await readFile(resolve(path));
  const text = bytes.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("where_latency_canary_isolation_receipt_invalid");
  }
  if (text !== `${canonicalizeArtifactJson(parsed)}\n`) {
    throw new Error("where_latency_canary_isolation_receipt_not_canonical");
  }
  return {
    receipt: parseIsolationReceipt(parsed),
    fileSha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function assertValidTronAddress(address: string): void {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) || !TronWeb.isAddress(address)) {
    throw new Error("where_latency_canary_source_address_invalid");
  }
}

function assertConfigMatchesReceipt(
  config: WhereLatencyCanaryConfig,
  scheduler: WhereLatencySchedulerDiagnostics,
  receipt: WhereLatencyCanaryIsolationReceipt
): void {
  const cycles = validateConfig(config);
  const capacityFingerprint = schedulerCapacityFingerprint(scheduler);
  if (capacityFingerprint !== receipt.schedulerCapacityFingerprint) {
    throw new Error("where_latency_canary_scheduler_capacity_changed");
  }
  const projection = configProjection(config, cycles, capacityFingerprint);
  if (
    projection.databaseFingerprint !== receipt.databaseFingerprint ||
    fingerprintCanonicalArtifact(projection) !== receipt.configSha256
  ) {
    throw new Error("where_latency_canary_isolation_config_mismatch");
  }
}

function assertStaticConfigMatchesReceipt(
  config: WhereLatencyCanaryConfig,
  receipt: WhereLatencyCanaryIsolationReceipt
): void {
  const cycles = validateConfig(config);
  const projection = configProjection(
    config,
    cycles,
    receipt.schedulerCapacityFingerprint
  );
  if (
    projection.databaseFingerprint !== receipt.databaseFingerprint ||
    fingerprintCanonicalArtifact(projection) !== receipt.configSha256
  ) {
    throw new Error("where_latency_canary_isolation_config_mismatch");
  }
}

function delta(end: number, start: number, code: string): number {
  const result = end - start;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(code);
  return result;
}

export async function withWhereLatencyCanaryDeadline<T>(
  timeoutMs: number,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(code));
      reject(new Error(code));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

const withDeadline = withWhereLatencyCanaryDeadline;

function runPayload(input: Omit<WhereLatencyCanaryRunReceipt, "sha256">): WhereLatencyCanaryRunReceipt {
  return withHash(input);
}

function assertHandlerStart(
  expectedJobId: string,
  value: Awaited<ReturnType<WhereLatencyCanaryRuntime["waitForHandlerStart"]>>
): void {
  if (value.jobId !== expectedJobId) {
    throw new Error("where_latency_canary_runtime_job_identity_mismatch");
  }
  safeInteger(value.startedAtMs, "where_latency_canary_runtime_start_time_invalid");
  safeInteger(value.activeWhereHandlers, "where_latency_canary_runtime_active_slots_invalid");
}

function assertTerminal(
  expectedJobId: string,
  value: TerminalResult
): void {
  if (value.jobId !== expectedJobId) {
    throw new Error("where_latency_canary_runtime_job_identity_mismatch");
  }
  safeInteger(value.completedAtMs, "where_latency_canary_runtime_terminal_time_invalid");
  if (!(["completed", "partial", "failed"] as const).includes(value.status)) {
    throw new Error("where_latency_canary_runtime_terminal_status_invalid");
  }
}

function assertActiveRuntimeJob(
  expectedJobId: string,
  value: Awaited<ReturnType<WhereLatencyCanaryRuntime["jobRuntimeState"]>>
): void {
  if (value.jobId !== expectedJobId) {
    throw new Error("where_latency_canary_runtime_job_identity_mismatch");
  }
  if (value.status !== "running" || value.handlerActive !== true) {
    throw new Error("where_latency_canary_one_slot_scenario_not_observed");
  }
}

export async function runWhereLatencyCanary(input: {
  confirm: boolean;
  isolationReceipt: string;
  isolationDocument?: WhereLatencyCanaryIsolationDocument;
  out: string;
  config: WhereLatencyCanaryConfig;
  runtime: WhereLatencyCanaryRuntime;
  longAddress?: string;
  freshAddress?: string;
  canaryId?: string;
  now?: () => number;
}): Promise<WhereLatencyCanaryRunReceipt> {
  if (!input.confirm) throw new Error("where_latency_canary_confirm_required");
  const longAddress = input.longAddress ?? WHERE_LATENCY_CANARY_LONG_ADDRESS;
  const freshAddress = input.freshAddress ?? WHERE_LATENCY_CANARY_FRESH_ADDRESS;
  assertValidTronAddress(longAddress);
  assertValidTronAddress(freshAddress);
  await ensureOutputAbsent(input.out);
  const isolationDocument = input.isolationDocument ??
    await readWhereLatencyCanaryIsolationDocument(input.isolationReceipt);
  const receipt = isolationDocument.receipt;
  const canaryId = input.canaryId ?? randomUUID();
  const requestedBy = `where-latency-canary:${canaryId}`;
  const startScheduler = await input.runtime.schedulerDiagnostics();
  assertConfigMatchesReceipt(input.config, startScheduler, receipt);
  if (startScheduler.queued !== 0 || startScheduler.inFlight !== 0) {
    throw new Error("where_latency_canary_scheduler_not_clean");
  }
  if (canonicalizeArtifactJson(startScheduler) !== canonicalizeArtifactJson(receipt.schedulerBaseline)) {
    throw new Error("where_latency_canary_scheduler_baseline_mismatch");
  }
  const runtimeAttestation = canonicalRuntimeAttestation(
    input.config,
    startScheduler,
    await input.runtime.runtimeAttestation()
  );
  if (canonicalizeArtifactJson(runtimeAttestation) !== canonicalizeArtifactJson(receipt.runtimeAttestation)) {
    throw new Error("where_latency_canary_runtime_attestation_mismatch");
  }
  if (canonicalizeArtifactJson(input.config.adapterIdentity) !== canonicalizeArtifactJson(receipt.adapterIdentity)) {
    throw new Error("where_latency_canary_adapter_identity_mismatch");
  }
  const startLanes = await input.runtime.laneDiagnostics();
  assertCleanLanes(startLanes);
  const startSchedulerIsolation = await input.runtime.schedulerIsolationDiagnostics(requestedBy);
  assertOwnershipCleanStart(startSchedulerIsolation);
  if (
    canonicalizeArtifactJson(startSchedulerIsolation) !==
    canonicalizeArtifactJson(receipt.schedulerIsolationBaseline)
  ) throw new Error("where_latency_canary_scheduler_isolation_baseline_mismatch");
  const startDeadlineMs = Math.min(5_000, input.config.wherePollIntervalMs * 2);
  const ownedJobIds: string[] = [];
  let drained = false;
  const drain = () => withDeadline(
    input.config.drainTimeoutMs,
    "where_latency_canary_drain_timeout",
    (signal) => input.runtime.stopClaimsAndDrain(ownedJobIds, signal)
  );
  try {
    const long = await input.runtime.enqueueWhereJob({
      subjectAddress: longAddress,
      priority: 1_000,
      chatId: null,
      requestedBy,
      progressMarker: `where-latency-canary-progress:${canaryId}:long`
    });
    ownedJobIds.push(long.id);
    const longStart = await withDeadline(
      startDeadlineMs,
      "where_latency_canary_long_start_timeout",
      (signal) => input.runtime.waitForHandlerStart(long.id, signal)
    );
    assertHandlerStart(long.id, longStart);

    if (longStart.activeWhereHandlers > 2) {
      throw new Error("where_latency_canary_slot_gate_failed");
    }
    if (longStart.activeWhereHandlers < 1) {
      throw new Error("where_latency_canary_long_slot_not_observed");
    }

    if (longStart.activeWhereHandlers === 2) {
      const longTerminal = await withDeadline(
        input.config.terminalTimeoutMs,
        "where_latency_canary_terminal_timeout",
        (signal) => input.runtime.waitForTerminal(long.id, signal)
      );
      assertTerminal(long.id, longTerminal);
      const deliveryBeforeDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
      await drain();
      drained = true;
      const endLanes = await input.runtime.laneDiagnostics();
      const deliveryAfterDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
      const endSchedulerIsolation = await input.runtime.schedulerIsolationDiagnostics(requestedBy);
      assertOwnershipShape(endSchedulerIsolation);
      const endScheduler = await input.runtime.schedulerDiagnostics();
      const capacityEnd = schedulerCapacityFingerprint(endScheduler);
      const result = runPayload({
        schema: RUN_SCHEMA,
        version: 1,
        result: "non_gating_not_isolated",
        diagnosticCode: "no_stage_b_start_guarantee",
        createdAt: new Date((input.now ?? Date.now)()).toISOString(),
        canaryId,
        requestedBy,
        isolationReceiptSha256: receipt.sha256,
        isolationReceiptFileSha256: isolationDocument.fileSha256,
        adapterIdentity: receipt.adapterIdentity,
        deploymentIdentity: receipt.deploymentIdentity,
        runtimeAttestation,
        addresses: { long: longAddress, fresh: freshAddress },
        jobs: {
          long: { ...long, startedAtMs: longStart.startedAtMs, terminal: longTerminal },
          fresh: null
        },
        startGate: {
          elapsedMs: null,
          maximumMs: Math.min(5_000, input.config.wherePollIntervalMs * 2),
          passed: false
        },
        slotGate: {
          maximumActiveHandlers: Math.max(longStart.activeWhereHandlers, input.runtime.maxActiveWhereHandlers()),
          configuredHandlers: 2,
          passed: false
        },
        deliveryGate: {
          beforeDrain: deliveryBeforeDrain,
          endAfterDrain: deliveryAfterDrain,
          ...deliveryAfterDrain,
          passed: false
        },
        laneGate: { start: startLanes, end: endLanes, passed: false },
        schedulerGate: {
          start: startScheduler,
          end: endScheduler,
          dispatchedRequestDelta: delta(endScheduler.dispatchedRequests, startScheduler.dispatchedRequests,
            "where_latency_canary_scheduler_counter_regressed"),
          completedRequestDelta: delta(endScheduler.completedRequests, startScheduler.completedRequests,
            "where_latency_canary_scheduler_counter_regressed"),
          failedRequestDelta: delta(endScheduler.failedRequests, startScheduler.failedRequests,
            "where_latency_canary_scheduler_counter_regressed"),
          rateLimitedRequestDelta: delta(endScheduler.rateLimitedRequests, startScheduler.rateLimitedRequests,
            "where_latency_canary_scheduler_counter_regressed"),
          capacityFingerprintAtStart: receipt.schedulerCapacityFingerprint,
          capacityFingerprintAtEnd: capacityEnd,
          passed: false
        },
        schedulerIsolationGate: {
          start: startSchedulerIsolation,
          end: endSchedulerIsolation,
          passed: false
        },
        terminalAndDrainGate: { bothTerminal: true, drained: true, passed: true },
        deepConcurrency: 1,
        residualDeepLatencyMeasuredSeparately: true
      });
      await writeCanonicalExclusive(input.out, result);
      return result;
    }

    const fresh = await input.runtime.enqueueWhereJob({
      subjectAddress: freshAddress,
      priority: 900,
      chatId: null,
      requestedBy,
      progressMarker: `where-latency-canary-progress:${canaryId}:fresh`
    });
    ownedJobIds.push(fresh.id);
    const freshStart = await withDeadline(
      startDeadlineMs,
      "where_latency_canary_fresh_start_timeout",
      (signal) => input.runtime.waitForHandlerStart(fresh.id, signal)
    );
    assertHandlerStart(fresh.id, freshStart);
    if (freshStart.activeWhereHandlers !== 2) {
      throw new Error("where_latency_canary_one_slot_scenario_not_observed");
    }
    const [longAtFreshStart, freshAtFreshStart] = await Promise.all([
      input.runtime.jobRuntimeState(long.id),
      input.runtime.jobRuntimeState(fresh.id)
    ]);
    assertActiveRuntimeJob(long.id, longAtFreshStart);
    assertActiveRuntimeJob(fresh.id, freshAtFreshStart);
    const maximumStartMs = startDeadlineMs;
    const startElapsedMs = freshStart.startedAtMs - fresh.createdAtMs;
    const startPassed = startElapsedMs >= 0 && startElapsedMs <= maximumStartMs;

    // The start gate is fixed before either terminal wait can obscure queue age.
    const [longTerminal, freshTerminal] = await Promise.all([
      withDeadline(
        input.config.terminalTimeoutMs,
        "where_latency_canary_terminal_timeout",
        (signal) => input.runtime.waitForTerminal(long.id, signal)
      ),
      withDeadline(
        input.config.terminalTimeoutMs,
        "where_latency_canary_terminal_timeout",
        (signal) => input.runtime.waitForTerminal(fresh.id, signal)
      )
    ]);
    assertTerminal(long.id, longTerminal);
    assertTerminal(fresh.id, freshTerminal);
    const deliveryBeforeDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    const maximumActiveHandlers = Math.max(
      longStart.activeWhereHandlers,
      freshStart.activeWhereHandlers,
      input.runtime.maxActiveWhereHandlers()
    );
    await drain();
    drained = true;
    const endLanes = await input.runtime.laneDiagnostics();
    assertCleanLanes(
      endLanes,
      "where_latency_canary_database_not_drained"
    );
    const deliveryAfterDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    const endSchedulerIsolation = await input.runtime.schedulerIsolationDiagnostics(requestedBy);
    assertOwnershipWindowClean(startSchedulerIsolation, endSchedulerIsolation);
    const endScheduler = await input.runtime.schedulerDiagnostics();
    const capacityAtEnd = schedulerCapacityFingerprint(endScheduler);
    const failedRequestDelta = delta(
      endScheduler.failedRequests,
      startScheduler.failedRequests,
      "where_latency_canary_scheduler_counter_regressed"
    );
    const rateLimitedRequestDelta = delta(
      endScheduler.rateLimitedRequests,
      startScheduler.rateLimitedRequests,
      "where_latency_canary_scheduler_counter_regressed"
    );
    const dispatchedRequestDelta = delta(
      endScheduler.dispatchedRequests,
      startScheduler.dispatchedRequests,
      "where_latency_canary_scheduler_counter_regressed"
    );
    const completedRequestDelta = delta(
      endScheduler.completedRequests,
      startScheduler.completedRequests,
      "where_latency_canary_scheduler_counter_regressed"
    );

    if (!startPassed) throw new Error("where_latency_canary_start_gate_failed");
    if (maximumActiveHandlers > 2) throw new Error("where_latency_canary_slot_gate_failed");
    if (
      deliveryBeforeDrain.intentCount !== 0 || deliveryBeforeDrain.claimCount !== 0 ||
      deliveryAfterDrain.intentCount !== 0 || deliveryAfterDrain.claimCount !== 0
    ) {
      throw new Error("where_latency_canary_delivery_gate_failed");
    }
    if (capacityAtEnd !== receipt.schedulerCapacityFingerprint) {
      throw new Error("where_latency_canary_scheduler_capacity_changed");
    }
    if (failedRequestDelta !== 0 || rateLimitedRequestDelta !== 0) {
      throw new Error("where_latency_canary_scheduler_counter_gate_failed");
    }
    if (completedRequestDelta !== dispatchedRequestDelta) {
      throw new Error("where_latency_canary_scheduler_completion_mismatch");
    }
    assertOwnershipMatchesSchedulerWindow(endSchedulerIsolation, {
      dispatched: dispatchedRequestDelta,
      completed: completedRequestDelta,
      failed: failedRequestDelta,
      rateLimited: rateLimitedRequestDelta
    });
    if (endScheduler.queued !== 0 || endScheduler.inFlight !== 0) {
      throw new Error("where_latency_canary_scheduler_not_drained");
    }

    const result = runPayload({
      schema: RUN_SCHEMA,
      version: 1,
      result: "pass",
      diagnosticCode: null,
      createdAt: new Date((input.now ?? Date.now)()).toISOString(),
      canaryId,
      requestedBy,
      isolationReceiptSha256: receipt.sha256,
      isolationReceiptFileSha256: isolationDocument.fileSha256,
      adapterIdentity: receipt.adapterIdentity,
      deploymentIdentity: receipt.deploymentIdentity,
      runtimeAttestation,
      addresses: { long: longAddress, fresh: freshAddress },
      jobs: {
        long: { ...long, startedAtMs: longStart.startedAtMs, terminal: longTerminal },
        fresh: { ...fresh, startedAtMs: freshStart.startedAtMs, terminal: freshTerminal }
      },
      startGate: { elapsedMs: startElapsedMs, maximumMs: maximumStartMs, passed: true },
      slotGate: { maximumActiveHandlers, configuredHandlers: 2, passed: true },
      deliveryGate: {
        beforeDrain: deliveryBeforeDrain,
        endAfterDrain: deliveryAfterDrain,
        ...deliveryAfterDrain,
        passed: true
      },
      laneGate: { start: startLanes, end: endLanes, passed: true },
      schedulerGate: {
        start: startScheduler,
        end: endScheduler,
        dispatchedRequestDelta,
        completedRequestDelta,
        failedRequestDelta,
        rateLimitedRequestDelta,
        capacityFingerprintAtStart: receipt.schedulerCapacityFingerprint,
        capacityFingerprintAtEnd: capacityAtEnd,
        passed: true
      },
      schedulerIsolationGate: {
        start: startSchedulerIsolation,
        end: endSchedulerIsolation,
        passed: true
      },
      terminalAndDrainGate: { bothTerminal: true, drained: true, passed: true },
      deepConcurrency: 1,
      residualDeepLatencyMeasuredSeparately: true
    });
    await writeCanonicalExclusive(input.out, result);
    return result;
  } finally {
    if (ownedJobIds.length > 0 && !drained) {
      await drain();
    }
  }
}

function validateMemorySnapshot(
  value: { rssBytes: number; heapUsedBytes: number }
): { rssBytes: number; heapUsedBytes: number } {
  safeInteger(value.rssBytes, "where_latency_deep_residual_memory_invalid");
  safeInteger(value.heapUsedBytes, "where_latency_deep_residual_memory_invalid");
  if (value.heapUsedBytes > value.rssBytes) {
    throw new Error("where_latency_deep_residual_memory_invalid");
  }
  return { ...value };
}

export async function captureWhereLatencyDeepResidual(input: {
  confirm: boolean;
  out: string;
  config: WhereLatencyCanaryConfig;
  runtime: WhereLatencyDeepResidualRuntime;
  subjectAddress?: string;
  measurementId?: string;
  now?: () => number;
}): Promise<WhereLatencyDeepResidualReceipt> {
  if (!input.confirm) throw new Error("where_latency_deep_residual_confirm_required");
  const subjectAddress = input.subjectAddress ?? WHERE_LATENCY_CANARY_FRESH_ADDRESS;
  assertValidTronAddress(subjectAddress);
  const cycles = validateDeepResidualConfig(input.config);
  const measurementId = input.measurementId ?? randomUUID();
  const requestedBy = `where-latency-deep-residual:${measurementId}`;
  await ensureOutputAbsent(input.out);
  const startLanes = await input.runtime.laneDiagnostics();
  assertCleanLanes(startLanes, "where_latency_deep_residual_database_not_clean");
  const startScheduler = await input.runtime.schedulerDiagnostics();
  if (startScheduler.queued !== 0 || startScheduler.inFlight !== 0) {
    throw new Error("where_latency_deep_residual_scheduler_not_clean");
  }
  const runtimeAttestation = canonicalDeepResidualAttestation(
    input.config,
    startScheduler,
    await input.runtime.runtimeAttestation()
  );
  const startSchedulerIsolation = await input.runtime.schedulerIsolationDiagnostics(requestedBy);
  assertOwnershipCleanStart(startSchedulerIsolation);
  const memoryBefore = validateMemorySnapshot(await input.runtime.memoryDiagnostics());
  const ownedJobIds: string[] = [];
  let drained = false;
  const drain = () => withDeadline(
    input.config.drainTimeoutMs,
    "where_latency_deep_residual_drain_timeout",
    (signal) => input.runtime.stopDeepClaimsAndDrain(ownedJobIds, signal)
  );
  try {
    const job = await input.runtime.enqueueDeepJob({
      subjectAddress,
      priority: 900,
      chatId: null,
      requestedBy,
      progressMarker: `where-latency-deep-residual-progress:${measurementId}`
    });
    ownedJobIds.push(job.id);
    const started = await withDeadline(
      Math.min(5_000, input.config.wherePollIntervalMs * 2),
      "where_latency_deep_residual_start_timeout",
      (signal) => input.runtime.waitForDeepHandlerStart(job.id, signal)
    );
    if (started.jobId !== job.id) {
      throw new Error("where_latency_canary_runtime_job_identity_mismatch");
    }
    safeInteger(started.startedAtMs, "where_latency_deep_residual_start_time_invalid");
    if (started.activeDeepHandlers !== 1) {
      throw new Error("where_latency_deep_residual_singleton_not_observed");
    }
    const queueAgeMs = started.startedAtMs - job.createdAtMs;
    if (!Number.isSafeInteger(queueAgeMs) || queueAgeMs < 0) {
      throw new Error("where_latency_deep_residual_queue_age_invalid");
    }
    const memoryAtStart = validateMemorySnapshot(await input.runtime.memoryDiagnostics());
    const terminal = await withDeadline(
      input.config.terminalTimeoutMs,
      "where_latency_deep_residual_terminal_timeout",
      (signal) => input.runtime.waitForTerminal(job.id, signal)
    );
    assertTerminal(job.id, terminal);
    const jobDiagnostics = await input.runtime.deepJobDiagnostics(job.id);
    safeInteger(
      jobDiagnostics.providerErrorCount,
      "where_latency_deep_residual_provider_error_count_invalid"
    );
    const deliveryBeforeDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    await drain();
    drained = true;
    const endLanes = await input.runtime.laneDiagnostics();
    assertCleanLanes(endLanes, "where_latency_deep_residual_database_not_drained");
    const deliveryAfterDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    if (
      deliveryBeforeDrain.intentCount !== 0 || deliveryBeforeDrain.claimCount !== 0 ||
      deliveryAfterDrain.intentCount !== 0 || deliveryAfterDrain.claimCount !== 0
    ) throw new Error("where_latency_deep_residual_delivery_not_zero");
    const memoryAfterDrain = validateMemorySnapshot(await input.runtime.memoryDiagnostics());
    const endSchedulerIsolation = await input.runtime.schedulerIsolationDiagnostics(requestedBy);
    assertOwnershipWindowClean(startSchedulerIsolation, endSchedulerIsolation);
    const endScheduler = await input.runtime.schedulerDiagnostics();
    if (schedulerCapacityFingerprint(endScheduler) !== schedulerCapacityFingerprint(startScheduler)) {
      throw new Error("where_latency_deep_residual_scheduler_capacity_changed");
    }
    if (endScheduler.queued !== 0 || endScheduler.inFlight !== 0) {
      throw new Error("where_latency_deep_residual_scheduler_not_drained");
    }
    const failedDelta = delta(
      endScheduler.failedRequests,
      startScheduler.failedRequests,
      "where_latency_deep_residual_scheduler_counter_regressed"
    );
    const rateLimitedDelta = delta(
      endScheduler.rateLimitedRequests,
      startScheduler.rateLimitedRequests,
      "where_latency_deep_residual_scheduler_counter_regressed"
    );
    delta(
      endScheduler.completedRequests,
      startScheduler.completedRequests,
      "where_latency_deep_residual_scheduler_counter_regressed"
    );
    delta(
      endScheduler.dispatchedRequests,
      startScheduler.dispatchedRequests,
      "where_latency_deep_residual_scheduler_counter_regressed"
    );
    assertOwnershipMatchesSchedulerWindow(endSchedulerIsolation, {
      dispatched: endScheduler.dispatchedRequests - startScheduler.dispatchedRequests,
      completed: endScheduler.completedRequests - startScheduler.completedRequests,
      failed: failedDelta,
      rateLimited: rateLimitedDelta
    });
    const configSha256 = fingerprintCanonicalArtifact(
      configProjection(
        input.config,
        cycles,
        schedulerCapacityFingerprint(startScheduler)
      )
    );
    const result = withHash({
      schema: "where-latency-deep-residual-v1" as const,
      version: 1 as const,
      result: "measured" as const,
      createdAt: new Date((input.now ?? Date.now)()).toISOString(),
      measurementId,
      requestedBy,
      adapterIdentity: input.config.adapterIdentity,
      deploymentIdentity: input.config.deploymentIdentity,
      runtimeAttestation,
      configSha256,
      subjectAddress,
      job: { ...job, startedAtMs: started.startedAtMs, terminal },
      queueAgeMs,
      providerErrors: {
        jobReported: jobDiagnostics.providerErrorCount,
        schedulerFailedRequestDelta: failedDelta,
        schedulerRateLimitedRequestDelta: rateLimitedDelta
      },
      memory: {
        before: memoryBefore,
        atStart: memoryAtStart,
        afterDrain: memoryAfterDrain
      },
      delivery: {
        beforeDrain: deliveryBeforeDrain,
        afterDrain: deliveryAfterDrain
      },
      lanes: { start: startLanes, end: endLanes },
      scheduler: { start: startScheduler, end: endScheduler },
      schedulerIsolation: {
        start: startSchedulerIsolation,
        end: endSchedulerIsolation
      },
      drained: true as const
    });
    await writeCanonicalExclusive(input.out, result);
    return result;
  } finally {
    if (ownedJobIds.length > 0 && !drained) {
      await drain();
    }
  }
}

function argument(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

function flag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function booleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function canaryConfigFromEnvironment(): WhereLatencyCanaryUnboundConfig {
  const app = loadConfig();
  return {
    databaseUrl: app.databaseUrl,
    dedicatedDeployment: booleanEnv("WHERE_LATENCY_CANARY_DEDICATED"),
    runtimeInstanceLabel: app.runtimeInstanceLabel ?? "",
    enabledRuntimeCycles: (process.env.WHERE_LATENCY_CANARY_ENABLED_CYCLES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    workerConcurrency: app.forensicWhereWorkerConcurrency,
    deepWorkerConcurrency: 1,
    wherePollIntervalMs: app.forensicWherePollIntervalMs,
    terminalTimeoutMs: positiveIntegerEnv(
      "WHERE_LATENCY_CANARY_TERMINAL_TIMEOUT_MS",
      7_200_000
    ),
    drainTimeoutMs: positiveIntegerEnv(
      "WHERE_LATENCY_CANARY_DRAIN_TIMEOUT_MS",
      60_000
    ),
    runtimeConfigIdentity:
      process.env.WHERE_LATENCY_CANARY_RUNTIME_CONFIG_SHA256?.trim() ?? "",
    runtimeBridgeUrl:
      process.env.WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_URL?.trim() ?? "",
    runtimeBridgeTimeoutMs: positiveIntegerEnv(
      "WHERE_LATENCY_CANARY_RUNTIME_BRIDGE_TIMEOUT_MS",
      10_000
    )
  };
}

type DeploymentModuleGraphEntry = { path: string; sha256: string };
type DeploymentReceiptPayload = {
  schema: "where-latency-canary-deployment-v1";
  version: 1;
  deploymentRoot: string;
  immutableArtifactDigest: string;
  gitCommit: string;
  gitTree: string;
  bundleFormat: "single_file_esm_bundle_v1";
  nodeRuntime: { implementation: "node"; version: string; execArgv: string[] };
  allowedNodeBuiltins: string[];
  bridgeProtocolVersion: "where-latency-canary-bridge-v1";
  bridgePublicKeySpkiDerBase64: string;
  bridgePublicKeySpkiSha256: string;
  moduleGraph: DeploymentModuleGraphEntry[];
  moduleGraphSha256: string;
  adapterEntryPath: string;
  adapterEntrySha256: string;
  runtimeConfigIdentity: string;
};
type DeploymentReceipt = DeploymentReceiptPayload & { sha256: string };

const execFileAsync = promisify(execFile);

async function inspectGitCheckout(deploymentRoot: string): Promise<{
  commit: string;
  tree: string;
  status: string;
}> {
  const git = async (...args: string[]) => (await execFileAsync(
    "git",
    ["-C", deploymentRoot, ...args],
    { encoding: "utf8", windowsHide: true }
  )).stdout.trim();
  return {
    commit: await git("rev-parse", "HEAD"),
    tree: await git("rev-parse", "HEAD^{tree}"),
    status: await git("status", "--porcelain", "--untracked-files=all")
  };
}

function parseDeploymentReceipt(value: unknown): DeploymentReceipt {
  if (!record(value)) throw new Error("where_latency_canary_deployment_receipt_invalid");
  const { sha256, ...payload } = value;
  if (
    payload.schema !== "where-latency-canary-deployment-v1" ||
    payload.version !== 1 ||
    sha256 !== fingerprintCanonicalArtifact(payload)
  ) throw new Error("where_latency_canary_deployment_receipt_invalid");
  const receipt = value as unknown as DeploymentReceipt;
  if (
    typeof receipt.deploymentRoot !== "string" || !receipt.deploymentRoot ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.immutableArtifactDigest) ||
    !/^[a-f0-9]{40}$/.test(receipt.gitCommit) ||
    !/^[a-f0-9]{40}$/.test(receipt.gitTree) ||
    typeof receipt.bundleFormat !== "string" ||
    receipt.nodeRuntime?.implementation !== "node" ||
    typeof receipt.nodeRuntime.version !== "string" || !receipt.nodeRuntime.version ||
    !Array.isArray(receipt.nodeRuntime.execArgv) ||
    receipt.nodeRuntime.execArgv.some((value) => typeof value !== "string") ||
    !Array.isArray(receipt.allowedNodeBuiltins) ||
    receipt.bridgeProtocolVersion !== "where-latency-canary-bridge-v1" ||
    typeof receipt.bridgePublicKeySpkiDerBase64 !== "string" ||
    !Array.isArray(receipt.moduleGraph) || receipt.moduleGraph.length < 1 ||
    typeof receipt.adapterEntryPath !== "string"
  ) throw new Error("where_latency_canary_deployment_receipt_invalid");
  for (const hash of [
    receipt.moduleGraphSha256,
    receipt.adapterEntrySha256,
    receipt.runtimeConfigIdentity,
    receipt.bridgePublicKeySpkiSha256
  ]) assertSha256(hash, "where_latency_canary_deployment_receipt_invalid");
  return receipt;
}

function verifiedBridgePublicKey(receipt: DeploymentReceipt): KeyObject {
  const bytes = Buffer.from(receipt.bridgePublicKeySpkiDerBase64, "base64");
  if (bytes.toString("base64") !== receipt.bridgePublicKeySpkiDerBase64) {
    throw new Error("where_latency_canary_bridge_public_key_invalid");
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch {
    throw new Error("where_latency_canary_bridge_public_key_invalid");
  }
  const canonical = key.export({ format: "der", type: "spki" });
  if (
    key.asymmetricKeyType !== "ed25519" || !Buffer.from(canonical).equals(bytes) ||
    createHash("sha256").update(bytes).digest("hex") !== receipt.bridgePublicKeySpkiSha256
  ) throw new Error("where_latency_canary_bridge_public_key_invalid");
  return key;
}

function assertSafeGraphPath(path: string): void {
  if (
    !path || isAbsolute(path) || path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error("where_latency_canary_deployment_graph_path_invalid");
}

function assertContained(root: string, child: string): void {
  const pathFromRoot = relative(root, child);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("where_latency_canary_deployment_graph_escape");
  }
}

const BRIDGE_METHODS = new Set([
  "runtimeAttestation", "schedulerIsolationDiagnostics", "schedulerDiagnostics",
  "laneDiagnostics", "enqueueWhereJob", "waitForHandlerStart", "jobRuntimeState",
  "waitForTerminal", "deliveryDiagnostics", "maxActiveWhereHandlers",
  "stopClaimsAndDrain", "enqueueDeepJob", "waitForDeepHandlerStart",
  "deepJobDiagnostics", "memoryDiagnostics", "stopDeepClaimsAndDrain"
]);
const BRIDGE_MAX_REQUEST_BYTES = 256 * 1024;
const BRIDGE_MAX_RESPONSE_BYTES = 1024 * 1024;

type BridgeTransport = (
  body: string,
  signal: AbortSignal
) => Promise<{ status: number; contentType: string; body: Uint8Array }>;

async function loopbackBridgeTransport(
  url: string,
  body: string,
  signal: AbortSignal
): Promise<{ status: number; contentType: string; body: Uint8Array }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("where_latency_canary_bridge_empty_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > BRIDGE_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("where_latency_canary_bridge_response_too_large");
    }
    chunks.push(chunk.value);
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size)
  };
}

export function createWhereLatencyCanaryBridgeInvoker(input: {
  url: string;
  timeoutMs: number;
  publicKey: KeyObject;
  transport?: BridgeTransport;
  sessionNonce?: string;
}): {
  sessionNonce: string;
  invoke(method: string, requestJson: string, signal?: AbortSignal): Promise<unknown>;
} {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new Error("where_latency_canary_bridge_timeout_invalid");
  }
  if (input.publicKey.type !== "public" || input.publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("where_latency_canary_bridge_public_key_invalid");
  }
  const sessionNonce = input.sessionNonce ?? randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(sessionNonce)) {
    throw new Error("where_latency_canary_bridge_session_invalid");
  }
  let nextSequence = 1;
  const completed = new Set<number>();
  return {
    sessionNonce,
    async invoke(method, requestJson, callerSignal) {
      if (!BRIDGE_METHODS.has(method)) {
        throw new Error("where_latency_canary_bridge_method_forbidden");
      }
      if (typeof requestJson !== "string") {
        throw new Error("where_latency_canary_bridge_request_not_json");
      }
      if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) {
        throw new Error("where_latency_canary_bridge_signal_invalid");
      }
      if (Buffer.byteLength(requestJson, "utf8") > BRIDGE_MAX_REQUEST_BYTES) {
        throw new Error("where_latency_canary_bridge_request_too_large");
      }
      let request: unknown;
      try {
        request = JSON.parse(requestJson);
      } catch {
        throw new Error("where_latency_canary_bridge_request_not_json");
      }
      const seq = nextSequence++;
      const requestSha256 = fingerprintCanonicalArtifact(request);
      const requestEnvelope = {
        schema: "where-latency-canary-bridge-request-v1",
        protocolVersion: "where-latency-canary-bridge-v1",
        sessionNonce,
        seq,
        method,
        requestSha256,
        request
      };
      const controller = new AbortController();
      const abort = () => controller.abort(callerSignal?.reason);
      callerSignal?.addEventListener("abort", abort, { once: true });
      if (callerSignal?.aborted) abort();
      let rejectDeadline: ((error: Error) => void) | null = null;
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
      });
      const timer = setTimeout(() => {
        const error = new Error("where_latency_canary_bridge_timeout");
        controller.abort(error);
        rejectDeadline?.(error);
      }, input.timeoutMs);
      let transported: Awaited<ReturnType<BridgeTransport>>;
      try {
        transported = await Promise.race([
          (input.transport ?? ((body, signal) =>
            loopbackBridgeTransport(input.url, body, signal)))(
            canonicalizeArtifactJson(requestEnvelope),
            controller.signal
          ),
          deadline
        ]);
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abort);
      }
      if (
        transported.status !== 200 ||
        !transported.contentType.toLowerCase().startsWith("application/json")
      ) throw new Error("where_latency_canary_bridge_http_invalid");
      if (transported.body.byteLength > BRIDGE_MAX_RESPONSE_BYTES) {
        throw new Error("where_latency_canary_bridge_response_too_large");
      }
      const responseText = Buffer.from(transported.body).toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new Error("where_latency_canary_bridge_response_not_json");
      }
      if (responseText !== canonicalizeArtifactJson(parsed) || !record(parsed)) {
        throw new Error("where_latency_canary_bridge_response_not_canonical");
      }
      const { signature, ...signed } = parsed;
      if (
        signed.schema !== "where-latency-canary-bridge-response-v1" ||
        signed.protocolVersion !== "where-latency-canary-bridge-v1" ||
        signed.sessionNonce !== sessionNonce || signed.seq !== seq ||
        signed.method !== method || signed.requestSha256 !== requestSha256 ||
        completed.has(seq)
      ) throw new Error("where_latency_canary_bridge_response_binding_mismatch");
      if (
        typeof signed.responseSha256 !== "string" ||
        signed.responseSha256 !== fingerprintCanonicalArtifact(signed.response)
      ) throw new Error("where_latency_canary_bridge_response_hash_mismatch");
      if (typeof signature !== "string") {
        throw new Error("where_latency_canary_bridge_signature_invalid");
      }
      const signatureBytes = Buffer.from(signature, "base64");
      if (
        signatureBytes.toString("base64") !== signature ||
        !verifySignature(
          null,
          Buffer.from(canonicalizeArtifactJson(signed)),
          input.publicKey,
          signatureBytes
        )
      ) throw new Error("where_latency_canary_bridge_signature_invalid");
      completed.add(seq);
      return structuredClone(signed.response);
    }
  };
}

function createVmCapabilityMembrane(): {
  wrap: (value: unknown) => unknown;
  toHost: (value: unknown) => unknown;
} {
  const hostToVm = new WeakMap<object, object>();
  const vmFacadeToHost = new WeakMap<object, object>();
  const vmToHost = new WeakMap<object, object>();
  const hostFacadeToVm = new WeakMap<object, object>();
  const isObject = (value: unknown): value is object =>
    (typeof value === "object" && value !== null) || typeof value === "function";
  const hidden = new Set<PropertyKey>([
    "constructor", "prototype", "__proto__", "caller", "callee", "arguments"
  ]);

  const createFacade = (
    source: object,
    convertIn: (value: unknown) => unknown,
    convertOut: (value: unknown) => unknown,
    sourceToFacade: WeakMap<object, object>,
    facadeToSource: WeakMap<object, object>
  ): object => {
    const handler: ProxyHandler<object> = {
      get(_target, property) {
        if (hidden.has(property)) {
          return property === "caller" || property === "arguments" || property === "prototype"
            ? null
            : undefined;
        }
        try {
          return convertOut(Reflect.get(source, property, source));
        } catch (error) {
          throw convertOut(error);
        }
      },
      set(_target, property, next) {
        if (hidden.has(property)) return false;
        try {
          return Reflect.set(source, property, convertIn(next), source);
        } catch (error) {
          throw convertOut(error);
        }
      },
      defineProperty() {
        return false;
      },
      deleteProperty() {
        return false;
      },
      getPrototypeOf() {
        return null;
      },
      setPrototypeOf() {
        return false;
      },
      preventExtensions() {
        return false;
      }
    };
    let facade: object;
    if (typeof source === "function") {
      const callable = function membraneCallable(this: unknown, ...args: unknown[]) {
        try {
          return convertOut(Reflect.apply(
            source,
            convertIn(this),
            args.map(convertIn)
          ));
        } catch (error) {
          throw convertOut(error);
        }
      };
      Object.setPrototypeOf(callable, null);
      Object.defineProperty(callable, "prototype", {
        value: null,
        writable: false
      });
      handler.construct = (_target, args, newTarget) => {
        try {
          return convertOut(Reflect.construct(
            source,
            args.map(convertIn),
            convertIn(newTarget) as Function
          )) as object;
        } catch (error) {
          throw convertOut(error);
        }
      };
      facade = new Proxy(callable, handler as ProxyHandler<typeof callable>);
    } else {
      facade = new Proxy(Object.create(null) as object, handler);
    }
    sourceToFacade.set(source, facade);
    facadeToSource.set(facade, source);
    return facade;
  };

  const toVm = (value: unknown): unknown => {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      return value;
    }
    const source = value as object;
    const originalVmValue = hostFacadeToVm.get(source);
    if (originalVmValue) return originalVmValue;
    const existing = hostToVm.get(source);
    if (existing) return existing;
    return createFacade(source, toHost, toVm, hostToVm, vmFacadeToHost);
  };

  const toHost = (value: unknown): unknown => {
    if (!isObject(value)) return value;
    const actualHostValue = vmFacadeToHost.get(value);
    if (actualHostValue) return actualHostValue;
    const existing = vmToHost.get(value);
    if (existing) return existing;
    return createFacade(value, toVm, toHost, vmToHost, hostFacadeToVm);
  };

  return { wrap: toVm, toHost };
}

export async function createWhereLatencyRuntimeFromVerifiedBundle(input: {
  bytes: Buffer;
  identifier: string;
  allowedNodeBuiltins: readonly string[];
  factoryConfig: WhereLatencyCanaryRuntimeFactoryConfig;
  bridgeInvoke?: (method: string, requestJson: string, signal?: AbortSignal) => Promise<unknown>;
  requireBridge?: boolean;
}): Promise<WhereLatencyCanaryRuntime> {
  if (
    typeof vm.SourceTextModule !== "function" ||
    typeof vm.SyntheticModule !== "function"
  ) throw new Error("where_latency_canary_vm_modules_unavailable");
  const declaredBuiltins = canonicalAllowedNodeBuiltins(
    input.allowedNodeBuiltins,
    "where_latency_canary_allowed_builtins_invalid"
  );
  const membrane = createVmCapabilityMembrane();
  const sandbox = Object.assign(Object.create(null) as Record<string, unknown>, {
    Buffer: membrane.wrap(Buffer),
    URL: membrane.wrap(URL),
    URLSearchParams: membrane.wrap(URLSearchParams),
    AbortController: membrane.wrap(AbortController),
    AbortSignal: membrane.wrap(AbortSignal),
    TextEncoder: membrane.wrap(TextEncoder),
    TextDecoder: membrane.wrap(TextDecoder),
    setTimeout: membrane.wrap(setTimeout),
    clearTimeout: membrane.wrap(clearTimeout),
    setInterval: membrane.wrap(setInterval),
    clearInterval: membrane.wrap(clearInterval),
    queueMicrotask: membrane.wrap(queueMicrotask)
  });
  const context = vm.createContext(sandbox, {
    name: "where-latency-canary-adapter",
    codeGeneration: { strings: false, wasm: false }
  });
  sandbox.__whereCanaryConfigJson = canonicalizeArtifactJson(input.factoryConfig);
  const factoryConfig = vm.runInContext(
    "JSON.parse(__whereCanaryConfigJson)",
    context,
    { timeout: 1_000 }
  ) as WhereLatencyCanaryRuntimeFactoryConfig;
  delete sandbox.__whereCanaryConfigJson;
  const linkedBuiltins = new Set<string>();
  let bridgeLinked = false;
  const module = new vm.SourceTextModule(input.bytes.toString("utf8"), {
    context,
    identifier: input.identifier,
    initializeImportMeta(meta) {
      meta.url = input.identifier;
      Object.freeze(meta);
    },
    importModuleDynamically: async () => {
      throw new Error("where_latency_canary_dynamic_import_forbidden");
    }
  });
  await module.link(async (specifier) => {
    if (specifier === "canary:bridge") {
      if (!input.bridgeInvoke || bridgeLinked) {
        throw new Error("where_latency_canary_bridge_import_invalid");
      }
      bridgeLinked = true;
      return new vm.SyntheticModule(["invoke"], function setBridgeExport() {
        this.setExport("invoke", membrane.wrap(input.bridgeInvoke));
      }, { context, identifier: "where-latency-canary:bridge" });
    }
    if (!specifier.startsWith("node:")) {
      throw new Error("where_latency_canary_bundle_import_forbidden");
    }
    if (!SAFE_CANARY_NODE_BUILTIN_SET.has(specifier)) {
      throw new Error("where_latency_canary_bundle_builtin_forbidden");
    }
    if (!declaredBuiltins.includes(specifier)) {
      throw new Error("where_latency_canary_bundle_builtin_not_declared");
    }
    linkedBuiltins.add(specifier);
    const namespace = await import(specifier);
    const exportNames = Object.getOwnPropertyNames(namespace);
    return new vm.SyntheticModule(exportNames, function setBuiltinExports() {
      for (const name of exportNames) this.setExport(name, membrane.wrap(namespace[name]));
    }, { context, identifier: `where-latency-canary-builtin:${specifier}` });
  });
  if (
    canonicalizeArtifactJson([...linkedBuiltins].sort()) !==
    canonicalizeArtifactJson(declaredBuiltins)
  ) throw new Error("where_latency_canary_bundle_builtin_binding_mismatch");
  if (input.requireBridge && !bridgeLinked) {
    throw new Error("where_latency_canary_bridge_import_required");
  }
  await module.evaluate({ timeout: 5_000 });
  const factory = (module.namespace as Record<string, unknown>)
    .createWhereLatencyCanaryRuntime;
  if (typeof factory !== "function") {
    throw new Error("where_latency_canary_runtime_adapter_invalid");
  }
  return membrane.toHost(await factory(factoryConfig)) as WhereLatencyCanaryRuntime;
}

export async function loadVerifiedWhereLatencyRuntimeBridge(input: {
  config: WhereLatencyCanaryUnboundConfig;
  modulePath: string;
  deploymentReceiptPath: string;
  expectedDeploymentReceiptFileSha256: string;
  expectedImmutableArtifactDigest: string;
  inspectCheckout?: (deploymentRoot: string) => Promise<{
    commit: string;
    tree: string;
    status: string;
  }>;
}): Promise<{
  runtime: WhereLatencyCanaryRuntime;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
}> {
  assertSha256(
    input.expectedDeploymentReceiptFileSha256,
    "where_latency_canary_deployment_receipt_file_sha256_invalid"
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(input.expectedImmutableArtifactDigest)) {
    throw new Error("where_latency_canary_immutable_artifact_digest_invalid");
  }
  const receiptBytes = await readFile(resolve(input.deploymentReceiptPath));
  const receiptFileSha256 = createHash("sha256").update(receiptBytes).digest("hex");
  if (receiptFileSha256 !== input.expectedDeploymentReceiptFileSha256) {
    throw new Error("where_latency_canary_deployment_receipt_file_sha256_mismatch");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("where_latency_canary_deployment_receipt_invalid");
  }
  if (receiptBytes.toString("utf8") !== `${canonicalizeArtifactJson(parsed)}\n`) {
    throw new Error("where_latency_canary_deployment_receipt_not_canonical");
  }
  const receipt = parseDeploymentReceipt(parsed);
  if (receipt.immutableArtifactDigest !== input.expectedImmutableArtifactDigest) {
    throw new Error("where_latency_canary_immutable_artifact_digest_mismatch");
  }
  if (receipt.runtimeConfigIdentity !== input.config.runtimeConfigIdentity) {
    throw new Error("where_latency_canary_deployment_runtime_config_mismatch");
  }
  const deploymentRoot = await realpath(resolve(receipt.deploymentRoot));
  if (deploymentRoot !== receipt.deploymentRoot) {
    throw new Error("where_latency_canary_deployment_root_not_canonical");
  }
  if (receipt.bundleFormat !== "single_file_esm_bundle_v1") {
    throw new Error("where_latency_canary_bundle_format_invalid");
  }
  const allowedNodeBuiltins = canonicalAllowedNodeBuiltins(
    receipt.allowedNodeBuiltins,
    "where_latency_canary_allowed_builtins_invalid"
  );
  const bridgePublicKey = verifiedBridgePublicKey(receipt);
  if (receipt.moduleGraph.length !== 1) {
    throw new Error("where_latency_canary_bundle_graph_must_be_single_file");
  }
  const adapterEntry = receipt.moduleGraph[0];
  if (!record(adapterEntry) || typeof adapterEntry.path !== "string") {
    throw new Error("where_latency_canary_deployment_graph_invalid");
  }
  assertSafeGraphPath(adapterEntry.path);
  assertSha256(adapterEntry.sha256, "where_latency_canary_deployment_graph_invalid");
  if (fingerprintCanonicalArtifact(receipt.moduleGraph) !== receipt.moduleGraphSha256) {
    throw new Error("where_latency_canary_deployment_graph_sha256_mismatch");
  }
  assertSafeGraphPath(receipt.adapterEntryPath);
  if (
    adapterEntry.path !== receipt.adapterEntryPath ||
    adapterEntry.sha256 !== receipt.adapterEntrySha256
  ) {
    throw new Error("where_latency_canary_deployment_adapter_not_bound");
  }
  const adapterRealPath = await realpath(
    resolve(deploymentRoot, ...adapterEntry.path.split("/"))
  );
  assertContained(deploymentRoot, adapterRealPath);
  if (await realpath(resolve(input.modulePath)) !== adapterRealPath) {
    throw new Error("where_latency_canary_deployment_adapter_path_mismatch");
  }
  if (!(await stat(adapterRealPath)).isFile()) {
    throw new Error("where_latency_canary_deployment_graph_invalid");
  }
  const adapterBytes = await readFile(adapterRealPath);
  const actualAdapterSha256 = createHash("sha256").update(adapterBytes).digest("hex");
  if (actualAdapterSha256 !== adapterEntry.sha256) {
    throw new Error("where_latency_canary_deployment_graph_file_changed");
  }
  const checkout = await (input.inspectCheckout ?? inspectGitCheckout)(deploymentRoot);
  if (
    checkout.commit !== receipt.gitCommit || checkout.tree !== receipt.gitTree ||
    checkout.status !== ""
  ) throw new Error("where_latency_canary_deployment_checkout_not_immutable");
  if (
    receipt.nodeRuntime.implementation !== "node" ||
    receipt.nodeRuntime.version !== process.version ||
    canonicalizeArtifactJson(receipt.nodeRuntime.execArgv) !==
      canonicalizeArtifactJson(process.execArgv) ||
    !process.execArgv.includes("--experimental-vm-modules")
  ) {
    throw new Error("where_latency_canary_node_runtime_identity_mismatch");
  }

  const deploymentIdentity: WhereLatencyCanaryDeploymentIdentity = {
    schema: "where-latency-canary-deployment-identity-v1",
    deploymentReceiptFileSha256: receiptFileSha256,
    immutableArtifactDigest: receipt.immutableArtifactDigest,
    gitCommit: receipt.gitCommit,
    gitTree: receipt.gitTree,
    moduleGraphSha256: receipt.moduleGraphSha256,
    adapterEntrySha256: receipt.adapterEntrySha256,
    bundleFormat: receipt.bundleFormat,
    nodeRuntime: {
      ...receipt.nodeRuntime,
      execArgv: [...receipt.nodeRuntime.execArgv]
    },
    allowedNodeBuiltins,
    bridgeProtocolVersion: receipt.bridgeProtocolVersion,
    bridgePublicKeySpkiSha256: receipt.bridgePublicKeySpkiSha256
  };
  const adapterIdentity: WhereLatencyCanaryAdapterIdentity = {
    schema: "where-latency-canary-adapter-v1",
    moduleRealPath: adapterRealPath,
    moduleContentSha256: receipt.adapterEntrySha256
  };
  const runtime = await createWhereLatencyRuntimeFromVerifiedBundle({
    bytes: adapterBytes,
    identifier: `where-latency-canary:adapter:${receipt.adapterEntrySha256}`,
    allowedNodeBuiltins,
    factoryConfig: { ...input.config, deploymentIdentity },
    bridgeInvoke: createWhereLatencyCanaryBridgeInvoker({
      url: input.config.runtimeBridgeUrl,
      timeoutMs: input.config.runtimeBridgeTimeoutMs,
      publicKey: bridgePublicKey
    }).invoke,
    requireBridge: true
  });
  for (const method of [
    "runtimeAttestation", "schedulerIsolationDiagnostics", "schedulerDiagnostics",
    "laneDiagnostics", "enqueueWhereJob", "waitForHandlerStart", "waitForTerminal",
    "deliveryDiagnostics", "jobRuntimeState", "maxActiveWhereHandlers", "stopClaimsAndDrain"
  ] as const) {
    if (typeof runtime?.[method] !== "function") {
      throw new Error("where_latency_canary_runtime_adapter_invalid");
    }
  }
  return { runtime, adapterIdentity, deploymentIdentity };
}

async function loadRuntimeBridge(
  config: WhereLatencyCanaryUnboundConfig
): Promise<{
  runtime: WhereLatencyCanaryRuntime;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
  deploymentIdentity: WhereLatencyCanaryDeploymentIdentity;
}> {
  const modulePath = process.env.WHERE_LATENCY_CANARY_RUNTIME_ADAPTER?.trim();
  if (!modulePath) throw new Error("where_latency_canary_runtime_adapter_required");
  const deploymentReceiptPath = process.env.WHERE_LATENCY_CANARY_DEPLOYMENT_RECEIPT?.trim();
  const deploymentReceiptFileSha256 =
    process.env.WHERE_LATENCY_CANARY_DEPLOYMENT_RECEIPT_SHA256?.trim();
  const immutableArtifactDigest =
    process.env.WHERE_LATENCY_CANARY_IMMUTABLE_ARTIFACT_DIGEST?.trim();
  if (!deploymentReceiptPath) throw new Error("where_latency_canary_deployment_receipt_required");
  if (!deploymentReceiptFileSha256) {
    throw new Error("where_latency_canary_deployment_receipt_sha256_required");
  }
  if (!immutableArtifactDigest) {
    throw new Error("where_latency_canary_immutable_artifact_digest_required");
  }
  return loadVerifiedWhereLatencyRuntimeBridge({
    config,
    modulePath,
    deploymentReceiptPath,
    expectedDeploymentReceiptFileSha256: deploymentReceiptFileSha256,
    expectedImmutableArtifactDigest: immutableArtifactDigest
  });
}

export async function resolveWhereLatencyCanaryAdapterIdentity(
  modulePath: string
): Promise<WhereLatencyCanaryAdapterIdentity> {
  const moduleRealPath = await realpath(resolve(modulePath));
  const moduleStat = await stat(moduleRealPath);
  if (!moduleStat.isFile()) throw new Error("where_latency_canary_runtime_adapter_invalid");
  return {
    schema: "where-latency-canary-adapter-v1",
    moduleRealPath,
    moduleContentSha256: createHash("sha256")
      .update(await readFile(moduleRealPath))
      .digest("hex")
  };
}

export function defineWhereLatencyCanaryRuntimeAdapter(
  factory: (
    input: WhereLatencyCanaryRuntimeFactoryConfig
  ) => WhereLatencyCanaryRuntime | Promise<WhereLatencyCanaryRuntime>
): typeof factory {
  return factory;
}

function assertDeepResidualRuntime(
  runtime: WhereLatencyCanaryRuntime
): asserts runtime is WhereLatencyDeepResidualRuntime {
  const candidate = runtime as Partial<WhereLatencyDeepResidualRuntime>;
  for (const method of [
    "enqueueDeepJob",
    "waitForDeepHandlerStart",
    "deepJobDiagnostics",
    "memoryDiagnostics",
    "stopDeepClaimsAndDrain"
  ] as const) {
    if (typeof candidate[method] !== "function") {
      throw new Error("where_latency_deep_residual_runtime_adapter_invalid");
    }
  }
}

export async function runWhereLatencyCanaryCli(args: readonly string[]): Promise<void> {
  const command = args[0];
  if (command !== "prepare" && command !== "run" && command !== "deep-residual") {
    throw new Error("Usage: forensic:where-latency:canary -- <prepare|run|deep-residual> [options]");
  }
  if (command === "prepare") {
    const out = argument(args, "--out");
    if (!out) throw new Error("where_latency_canary_prepare_output_required");
    const unboundConfig = canaryConfigFromEnvironment();
    validateUnboundConfig(unboundConfig);
    const loaded = await loadRuntimeBridge(unboundConfig);
    const config: WhereLatencyCanaryConfig = {
      ...unboundConfig,
      adapterIdentity: loaded.adapterIdentity,
      deploymentIdentity: loaded.deploymentIdentity
    };
    const receipt = await prepareWhereLatencyCanary({
      out,
      config,
      runtime: loaded.runtime
    });
    process.stdout.write(`${canonicalizeArtifactJson(receipt)}\n`);
    return;
  }
  if (command === "deep-residual") {
    if (!flag(args, "--confirm")) {
      throw new Error("where_latency_deep_residual_confirm_required");
    }
    const out = argument(args, "--out");
    if (!out) throw new Error("where_latency_deep_residual_output_required");
    const subjectAddress = argument(args, "--address") ??
      WHERE_LATENCY_CANARY_FRESH_ADDRESS;
    assertValidTronAddress(subjectAddress);
    await ensureOutputAbsent(out);
    const unboundConfig = canaryConfigFromEnvironment();
    validateDeepResidualUnboundConfig(unboundConfig);
    const loaded = await loadRuntimeBridge(unboundConfig);
    assertDeepResidualRuntime(loaded.runtime);
    const config: WhereLatencyCanaryConfig = {
      ...unboundConfig,
      adapterIdentity: loaded.adapterIdentity,
      deploymentIdentity: loaded.deploymentIdentity
    };
    const receipt = await captureWhereLatencyDeepResidual({
      confirm: true,
      out,
      config,
      runtime: loaded.runtime,
      subjectAddress
    });
    process.stdout.write(`${canonicalizeArtifactJson(receipt)}\n`);
    return;
  }
  if (!flag(args, "--confirm")) throw new Error("where_latency_canary_confirm_required");
  const isolationReceipt = argument(args, "--isolation-receipt");
  if (!isolationReceipt) throw new Error("where_latency_canary_isolation_receipt_required");
  const longAddress = argument(args, "--long-address") ?? WHERE_LATENCY_CANARY_LONG_ADDRESS;
  const freshAddress = argument(args, "--fresh-address") ?? WHERE_LATENCY_CANARY_FRESH_ADDRESS;
  assertValidTronAddress(longAddress);
  assertValidTronAddress(freshAddress);
  const unboundConfig = canaryConfigFromEnvironment();
  validateUnboundConfig(unboundConfig);
  const isolationDocument = await readWhereLatencyCanaryIsolationDocument(
    isolationReceipt
  );
  const isolation = isolationDocument.receipt;
  assertStaticConfigMatchesReceipt(
    {
      ...unboundConfig,
      adapterIdentity: isolation.adapterIdentity,
      deploymentIdentity: isolation.deploymentIdentity
    },
    isolation
  );
  const canaryId = randomUUID();
  const out = resolve("outputs", "where-latency-canary", `run-${canaryId}.json`);
  await ensureOutputAbsent(out);
  const loaded = await loadRuntimeBridge(unboundConfig);
  const config: WhereLatencyCanaryConfig = {
    ...unboundConfig,
    adapterIdentity: loaded.adapterIdentity,
    deploymentIdentity: loaded.deploymentIdentity
  };
  assertStaticConfigMatchesReceipt(config, isolation);
  const receipt = await runWhereLatencyCanary({
    confirm: true,
    isolationReceipt,
    isolationDocument,
    out,
    config,
    runtime: loaded.runtime,
    longAddress,
    freshAddress,
    canaryId
  });
  process.stdout.write(`${canonicalizeArtifactJson(receipt)}\n`);
}

const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  await runWhereLatencyCanaryCli(process.argv.slice(2));
}
