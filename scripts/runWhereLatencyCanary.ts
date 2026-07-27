import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, lstat } from "node:fs/promises";
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
const ISOLATION_SCHEMA = "where-latency-canary-isolation-v1";
const RUN_SCHEMA = "where-latency-canary-run-v1";

type AllowedCycle = typeof ALLOWED_CYCLES[number];

export type WhereLatencyCanaryConfig = {
  databaseUrl: string;
  dedicatedDeployment: boolean;
  runtimeInstanceLabel: string;
  enabledRuntimeCycles: readonly string[];
  workerConcurrency: number;
  deepWorkerConcurrency: number;
  wherePollIntervalMs: number;
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

export type WhereLatencyCanaryRuntime = {
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
  addresses: { long: string; fresh: string };
  jobs: {
    long: { id: string; createdAtMs: number; startedAtMs: number; terminal: TerminalResult | null };
    fresh: { id: string; createdAtMs: number; startedAtMs: number; terminal: TerminalResult } | null;
  };
  startGate: { elapsedMs: number | null; maximumMs: number; passed: boolean };
  slotGate: { maximumActiveHandlers: number; configuredHandlers: 2; passed: boolean };
  deliveryGate: { intentCount: number; claimCount: number; passed: boolean };
  schedulerGate: {
    start: WhereLatencySchedulerDiagnostics;
    end: WhereLatencySchedulerDiagnostics;
    dispatchedRequestDelta: number;
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

function validateConfig(config: WhereLatencyCanaryConfig): AllowedCycle[] {
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
  return canonicalCycles(config.enabledRuntimeCycles);
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
  cycles: readonly AllowedCycle[],
  capacityFingerprint: string
) {
  return {
    schema: "where-latency-canary-config-v1",
    databaseFingerprint: databaseFingerprint(config.databaseUrl),
    runtimeInstanceLabel: config.runtimeInstanceLabel.trim(),
    enabledRuntimeCycles: [...cycles],
    workerConcurrency: 2,
    deepWorkerConcurrency: 1,
    wherePollIntervalMs: config.wherePollIntervalMs,
    schedulerCapacityFingerprint: capacityFingerprint
  };
}

function withHash<T extends Record<string, unknown>>(payload: T): T & { sha256: string } {
  return { ...payload, sha256: fingerprintCanonicalArtifact(payload) };
}

export function buildWhereLatencyCanaryIsolationReceipt(input: {
  config: WhereLatencyCanaryConfig;
  scheduler: WhereLatencySchedulerDiagnostics;
  preparedAt: string;
}): WhereLatencyCanaryIsolationReceipt {
  const cycles = validateConfig(input.config);
  assertSchedulerShape(input.scheduler);
  if (input.scheduler.queued !== 0 || input.scheduler.inFlight !== 0) {
    throw new Error("where_latency_canary_scheduler_not_clean");
  }
  const capacityFingerprint = schedulerCapacityFingerprint(input.scheduler);
  const projection = configProjection(input.config, cycles, capacityFingerprint);
  return withHash({
    schema: ISOLATION_SCHEMA,
    version: 1,
    preparedAt: input.preparedAt,
    databaseFingerprint: projection.databaseFingerprint,
    runtimeInstanceLabel: projection.runtimeInstanceLabel,
    enabledRuntimeCycles: projection.enabledRuntimeCycles,
    workerConcurrency: 2,
    deepWorkerConcurrency: 1,
    wherePollIntervalMs: projection.wherePollIntervalMs,
    schedulerBaseline: { ...input.scheduler },
    schedulerCapacityFingerprint: capacityFingerprint,
    configSha256: fingerprintCanonicalArtifact(projection)
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
  const receipt = buildWhereLatencyCanaryIsolationReceipt({
    config: input.config,
    scheduler,
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
    if (
      typeof receipt.databaseFingerprint !== "string" ||
      typeof receipt.runtimeInstanceLabel !== "string" ||
      typeof receipt.schedulerCapacityFingerprint !== "string" ||
      typeof receipt.configSha256 !== "string" ||
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
  assertCleanLanes(await input.runtime.laneDiagnostics());

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
      await input.runtime.stopClaimsAndDrain(ownedJobIds);
      drained = true;
      const delivery = await input.runtime.deliveryDiagnostics(ownedJobIds);
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
          ...delivery,
          passed: delivery.intentCount === 0 && delivery.claimCount === 0
        },
        schedulerGate: {
          start: startScheduler,
          end: endScheduler,
          dispatchedRequestDelta: delta(endScheduler.dispatchedRequests, startScheduler.dispatchedRequests,
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
    const delivery = await input.runtime.deliveryDiagnostics(ownedJobIds);
    const maximumActiveHandlers = Math.max(
      longStart.activeWhereHandlers,
      freshStart.activeWhereHandlers,
      input.runtime.maxActiveWhereHandlers()
    );
    await input.runtime.stopClaimsAndDrain(ownedJobIds);
    drained = true;
    assertCleanLanes(
      await input.runtime.laneDiagnostics(),
      "where_latency_canary_database_not_drained"
    );
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

    if (!startPassed) throw new Error("where_latency_canary_start_gate_failed");
    if (maximumActiveHandlers > 2) throw new Error("where_latency_canary_slot_gate_failed");
    if (delivery.intentCount !== 0 || delivery.claimCount !== 0) {
      throw new Error("where_latency_canary_delivery_gate_failed");
    }
    if (capacityAtEnd !== receipt.schedulerCapacityFingerprint) {
      throw new Error("where_latency_canary_scheduler_capacity_changed");
    }
    if (failedRequestDelta !== 0 || rateLimitedRequestDelta !== 0) {
      throw new Error("where_latency_canary_scheduler_counter_gate_failed");
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
      addresses: { long: longAddress, fresh: freshAddress },
      jobs: {
        long: { ...long, startedAtMs: longStart.startedAtMs, terminal: longTerminal },
        fresh: { ...fresh, startedAtMs: freshStart.startedAtMs, terminal: freshTerminal }
      },
      startGate: { elapsedMs: startElapsedMs, maximumMs: maximumStartMs, passed: true },
      slotGate: { maximumActiveHandlers, configuredHandlers: 2, passed: true },
      deliveryGate: { ...delivery, passed: true },
      schedulerGate: {
        start: startScheduler,
        end: endScheduler,
        dispatchedRequestDelta,
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

function canaryConfigFromEnvironment(): WhereLatencyCanaryConfig {
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
    wherePollIntervalMs: app.forensicWherePollIntervalMs
  };
}

async function loadRuntimeBridge(
  config: WhereLatencyCanaryConfig
): Promise<WhereLatencyCanaryRuntime> {
  const modulePath = process.env.WHERE_LATENCY_CANARY_RUNTIME_ADAPTER?.trim();
  if (!modulePath) throw new Error("where_latency_canary_runtime_adapter_required");
  const imported = await import(pathToFileURL(resolve(modulePath)).href) as {
    createWhereLatencyCanaryRuntime?: (
      input: WhereLatencyCanaryConfig
    ) => WhereLatencyCanaryRuntime | Promise<WhereLatencyCanaryRuntime>;
  };
  if (typeof imported.createWhereLatencyCanaryRuntime !== "function") {
    throw new Error("where_latency_canary_runtime_adapter_invalid");
  }
  const runtime = await imported.createWhereLatencyCanaryRuntime(config);
  for (const method of [
    "schedulerDiagnostics", "laneDiagnostics", "enqueueWhereJob",
    "waitForHandlerStart", "waitForTerminal", "deliveryDiagnostics",
    "maxActiveWhereHandlers", "stopClaimsAndDrain"
  ] as const) {
    if (typeof runtime?.[method] !== "function") {
      throw new Error("where_latency_canary_runtime_adapter_invalid");
    }
  }
  return runtime;
}

export async function runWhereLatencyCanaryCli(args: readonly string[]): Promise<void> {
  const command = args[0];
  if (command !== "prepare" && command !== "run") {
    throw new Error("Usage: forensic:where-latency:canary -- <prepare|run> [options]");
  }
  if (command === "prepare") {
    const out = argument(args, "--out");
    if (!out) throw new Error("where_latency_canary_prepare_output_required");
    const config = canaryConfigFromEnvironment();
    validateConfig(config);
    const runtime = await loadRuntimeBridge(config);
    const receipt = await prepareWhereLatencyCanary({ out, config, runtime });
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
  const config = canaryConfigFromEnvironment();
  validateConfig(config);
  const isolation = parseIsolationReceipt(JSON.parse(
    await readFile(resolve(isolationReceipt), "utf8")
  ));
  assertStaticConfigMatchesReceipt(config, isolation);
  const canaryId = randomUUID();
  const out = resolve("outputs", "where-latency-canary", `run-${canaryId}.json`);
  await ensureOutputAbsent(out);
  const runtime = await loadRuntimeBridge(config);
  const receipt = await runWhereLatencyCanary({
    confirm: true,
    isolationReceipt,
    out,
    config,
    runtime,
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
