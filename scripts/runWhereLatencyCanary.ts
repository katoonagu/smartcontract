import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

type AllowedCycle = typeof ALLOWED_CYCLES[number];

export type WhereLatencyCanaryAdapterIdentity = {
  schema: "where-latency-canary-adapter-v1";
  moduleRealPath: string;
  moduleContentSha256: string;
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
};

export type WhereLatencyCanaryConfig = {
  databaseUrl: string;
  dedicatedDeployment: boolean;
  runtimeInstanceLabel: string;
  enabledRuntimeCycles: readonly string[];
  workerConcurrency: number;
  deepWorkerConcurrency: number;
  wherePollIntervalMs: number;
  runtimeConfigIdentity: string;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
};

export type WhereLatencyCanaryUnboundConfig = Omit<
  WhereLatencyCanaryConfig,
  "adapterIdentity"
>;

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

export type WhereLatencyCanaryRuntime = {
  runtimeAttestation(): Promise<WhereLatencyCanaryRuntimeAttestation>;
  schedulerDiagnostics(): Promise<WhereLatencySchedulerDiagnostics>;
  laneDiagnostics(): Promise<WhereLatencyLaneDiagnostics>;
  enqueueWhereJob(input: {
    subjectAddress: string;
    priority: number;
    chatId: null;
    requestedBy: string;
    progressMarker: string;
  }): Promise<{ id: string; createdAtMs: number }>;
  waitForHandlerStart(jobId: string): Promise<{
    jobId: string;
    startedAtMs: number;
    activeWhereHandlers: number;
  }>;
  jobRuntimeState(jobId: string): Promise<{
    jobId: string;
    status: "queued" | "running" | "completed" | "partial" | "failed";
    handlerActive: boolean;
  }>;
  waitForTerminal(jobId: string): Promise<{
    jobId: string;
    status: "completed" | "partial" | "failed";
    completedAtMs: number;
  }>;
  deliveryDiagnostics(jobIds: readonly string[]): Promise<{
    intentCount: number;
    claimCount: number;
  }>;
  maxActiveWhereHandlers(): number;
  stopClaimsAndDrain(jobIds: readonly string[]): Promise<void>;
};

export type WhereLatencyDeepResidualRuntime = WhereLatencyCanaryRuntime & {
  enqueueDeepJob(input: {
    subjectAddress: string;
    priority: number;
    chatId: null;
    requestedBy: string;
    progressMarker: string;
  }): Promise<{ id: string; createdAtMs: number }>;
  waitForDeepHandlerStart(jobId: string): Promise<{
    jobId: string;
    startedAtMs: number;
    activeDeepHandlers: number;
  }>;
  deepJobDiagnostics(jobId: string): Promise<{ providerErrorCount: number }>;
  memoryDiagnostics(): Promise<{ rssBytes: number; heapUsedBytes: number }>;
  stopDeepClaimsAndDrain(jobIds: readonly string[]): Promise<void>;
};

export type WhereLatencyDeepResidualReceipt = {
  schema: "where-latency-deep-residual-v1";
  version: 1;
  result: "measured";
  createdAt: string;
  measurementId: string;
  requestedBy: string;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
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
  schedulerBaseline: WhereLatencySchedulerDiagnostics;
  schedulerCapacityFingerprint: string;
  configSha256: string;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
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
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
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
  assertSha256(config.runtimeConfigIdentity, "where_latency_canary_runtime_config_identity_invalid");
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
    adapterIdentity: { ...config.adapterIdentity },
    enabledRuntimeCycles: [...cycles],
    workerConcurrency: 2,
    deepWorkerConcurrency: 1,
    wherePollIntervalMs: config.wherePollIntervalMs,
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
    value.schedulerCapacityFingerprint !== capacityFingerprint
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
    schedulerCapacityFingerprint: value.schedulerCapacityFingerprint
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
    deepWorkerBindingIdentity: value.deepWorkerBindingIdentity
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
    value.deepWorkerBindingIdentity
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
  runtimeAttestation: WhereLatencyCanaryRuntimeAttestation;
  preparedAt: string;
}): WhereLatencyCanaryIsolationReceipt {
  const cycles = validateConfig(input.config);
  assertSchedulerShape(input.scheduler);
  if (input.scheduler.queued !== 0 || input.scheduler.inFlight !== 0) {
    throw new Error("where_latency_canary_scheduler_not_clean");
  }
  const capacityFingerprint = schedulerCapacityFingerprint(input.scheduler);
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
    schedulerBaseline: { ...input.scheduler },
    schedulerCapacityFingerprint: capacityFingerprint,
    configSha256: fingerprintCanonicalArtifact(projection),
    adapterIdentity: { ...input.config.adapterIdentity },
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
  const runtimeAttestation = await input.runtime.runtimeAttestation();
  const receipt = buildWhereLatencyCanaryIsolationReceipt({
    config: input.config,
    scheduler,
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
    assertAdapterIdentity(receipt.adapterIdentity);
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
      !Number.isSafeInteger(receipt.wherePollIntervalMs)
    ) throw new Error("invalid");
    return receipt;
  } catch {
    throw new Error("where_latency_canary_isolation_receipt_invalid");
  }
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
  const receipt = parseIsolationReceipt(JSON.parse(await readFile(resolve(input.isolationReceipt), "utf8")));
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

  const canaryId = input.canaryId ?? randomUUID();
  const requestedBy = `where-latency-canary:${canaryId}`;
  const ownedJobIds: string[] = [];
  let drained = false;
  try {
    const long = await input.runtime.enqueueWhereJob({
      subjectAddress: longAddress,
      priority: 1_000,
      chatId: null,
      requestedBy,
      progressMarker: `where-latency-canary-progress:${canaryId}:long`
    });
    ownedJobIds.push(long.id);
    const longStart = await input.runtime.waitForHandlerStart(long.id);
    assertHandlerStart(long.id, longStart);

    if (longStart.activeWhereHandlers > 2) {
      throw new Error("where_latency_canary_slot_gate_failed");
    }
    if (longStart.activeWhereHandlers < 1) {
      throw new Error("where_latency_canary_long_slot_not_observed");
    }

    if (longStart.activeWhereHandlers === 2) {
      const longTerminal = await input.runtime.waitForTerminal(long.id);
      assertTerminal(long.id, longTerminal);
      const deliveryBeforeDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
      await input.runtime.stopClaimsAndDrain(ownedJobIds);
      drained = true;
      const endLanes = await input.runtime.laneDiagnostics();
      const deliveryAfterDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
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
        adapterIdentity: receipt.adapterIdentity,
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
    const freshStart = await input.runtime.waitForHandlerStart(fresh.id);
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
    const maximumStartMs = Math.min(5_000, input.config.wherePollIntervalMs * 2);
    const startElapsedMs = freshStart.startedAtMs - fresh.createdAtMs;
    const startPassed = startElapsedMs >= 0 && startElapsedMs <= maximumStartMs;

    // The start gate is fixed before either terminal wait can obscure queue age.
    const [longTerminal, freshTerminal] = await Promise.all([
      input.runtime.waitForTerminal(long.id),
      input.runtime.waitForTerminal(fresh.id)
    ]);
    assertTerminal(long.id, longTerminal);
    assertTerminal(fresh.id, freshTerminal);
    const deliveryBeforeDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    const maximumActiveHandlers = Math.max(
      longStart.activeWhereHandlers,
      freshStart.activeWhereHandlers,
      input.runtime.maxActiveWhereHandlers()
    );
    await input.runtime.stopClaimsAndDrain(ownedJobIds);
    drained = true;
    const endLanes = await input.runtime.laneDiagnostics();
    assertCleanLanes(
      endLanes,
      "where_latency_canary_database_not_drained"
    );
    const deliveryAfterDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
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
      adapterIdentity: receipt.adapterIdentity,
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
      terminalAndDrainGate: { bothTerminal: true, drained: true, passed: true },
      deepConcurrency: 1,
      residualDeepLatencyMeasuredSeparately: true
    });
    await writeCanonicalExclusive(input.out, result);
    return result;
  } finally {
    if (ownedJobIds.length > 0 && !drained) {
      await input.runtime.stopClaimsAndDrain(ownedJobIds);
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
  const memoryBefore = validateMemorySnapshot(await input.runtime.memoryDiagnostics());
  const measurementId = input.measurementId ?? randomUUID();
  const requestedBy = `where-latency-deep-residual:${measurementId}`;
  const ownedJobIds: string[] = [];
  let drained = false;
  try {
    const job = await input.runtime.enqueueDeepJob({
      subjectAddress,
      priority: 900,
      chatId: null,
      requestedBy,
      progressMarker: `where-latency-deep-residual-progress:${measurementId}`
    });
    ownedJobIds.push(job.id);
    const started = await input.runtime.waitForDeepHandlerStart(job.id);
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
    const terminal = await input.runtime.waitForTerminal(job.id);
    assertTerminal(job.id, terminal);
    const jobDiagnostics = await input.runtime.deepJobDiagnostics(job.id);
    safeInteger(
      jobDiagnostics.providerErrorCount,
      "where_latency_deep_residual_provider_error_count_invalid"
    );
    const deliveryBeforeDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    await input.runtime.stopDeepClaimsAndDrain(ownedJobIds);
    drained = true;
    const endLanes = await input.runtime.laneDiagnostics();
    assertCleanLanes(endLanes, "where_latency_deep_residual_database_not_drained");
    const deliveryAfterDrain = await input.runtime.deliveryDiagnostics(ownedJobIds);
    if (
      deliveryBeforeDrain.intentCount !== 0 || deliveryBeforeDrain.claimCount !== 0 ||
      deliveryAfterDrain.intentCount !== 0 || deliveryAfterDrain.claimCount !== 0
    ) throw new Error("where_latency_deep_residual_delivery_not_zero");
    const memoryAfterDrain = validateMemorySnapshot(await input.runtime.memoryDiagnostics());
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
      drained: true as const
    });
    await writeCanonicalExclusive(input.out, result);
    return result;
  } finally {
    if (ownedJobIds.length > 0 && !drained) {
      await input.runtime.stopDeepClaimsAndDrain(ownedJobIds);
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
    runtimeConfigIdentity:
      process.env.WHERE_LATENCY_CANARY_RUNTIME_CONFIG_SHA256?.trim() ?? ""
  };
}

async function loadRuntimeBridge(
  config: WhereLatencyCanaryUnboundConfig
): Promise<{
  runtime: WhereLatencyCanaryRuntime;
  adapterIdentity: WhereLatencyCanaryAdapterIdentity;
}> {
  const modulePath = process.env.WHERE_LATENCY_CANARY_RUNTIME_ADAPTER?.trim();
  if (!modulePath) throw new Error("where_latency_canary_runtime_adapter_required");
  const adapterIdentity = await resolveWhereLatencyCanaryAdapterIdentity(modulePath);
  const moduleRealPath = adapterIdentity.moduleRealPath;
  const moduleContentSha256 = adapterIdentity.moduleContentSha256;
  const imported = await import(
    `${pathToFileURL(moduleRealPath).href}?sha256=${moduleContentSha256}`
  ) as {
    createWhereLatencyCanaryRuntime?: (
      input: WhereLatencyCanaryUnboundConfig
    ) => WhereLatencyCanaryRuntime | Promise<WhereLatencyCanaryRuntime>;
  };
  const afterIdentity = await resolveWhereLatencyCanaryAdapterIdentity(moduleRealPath);
  if (afterIdentity.moduleContentSha256 !== moduleContentSha256) {
    throw new Error("where_latency_canary_runtime_adapter_changed_during_load");
  }
  if (typeof imported.createWhereLatencyCanaryRuntime !== "function") {
    throw new Error("where_latency_canary_runtime_adapter_invalid");
  }
  const runtime = await imported.createWhereLatencyCanaryRuntime(config);
  for (const method of [
    "runtimeAttestation", "schedulerDiagnostics", "laneDiagnostics", "enqueueWhereJob",
    "waitForHandlerStart", "waitForTerminal", "deliveryDiagnostics",
    "jobRuntimeState", "maxActiveWhereHandlers", "stopClaimsAndDrain"
  ] as const) {
    if (typeof runtime?.[method] !== "function") {
      throw new Error("where_latency_canary_runtime_adapter_invalid");
    }
  }
  return { runtime, adapterIdentity };
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
    input: WhereLatencyCanaryUnboundConfig
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
      adapterIdentity: loaded.adapterIdentity
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
      adapterIdentity: loaded.adapterIdentity
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
  const isolation = parseIsolationReceipt(JSON.parse(
    await readFile(resolve(isolationReceipt), "utf8")
  ));
  assertStaticConfigMatchesReceipt(
    { ...unboundConfig, adapterIdentity: isolation.adapterIdentity },
    isolation
  );
  const canaryId = randomUUID();
  const out = resolve("outputs", "where-latency-canary", `run-${canaryId}.json`);
  await ensureOutputAbsent(out);
  const loaded = await loadRuntimeBridge(unboundConfig);
  const config: WhereLatencyCanaryConfig = {
    ...unboundConfig,
    adapterIdentity: loaded.adapterIdentity
  };
  assertStaticConfigMatchesReceipt(config, isolation);
  const receipt = await runWhereLatencyCanary({
    confirm: true,
    isolationReceipt,
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
