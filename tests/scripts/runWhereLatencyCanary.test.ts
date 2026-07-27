import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  buildWhereLatencyCanaryIsolationReceipt,
  captureWhereLatencyDeepResidual,
  createWhereLatencyCanaryBridgeInvoker,
  loadVerifiedWhereLatencyRuntimeBridge,
  prepareWhereLatencyCanary,
  resolveWhereLatencyCanaryAdapterIdentity,
  runWhereLatencyCanary,
  withWhereLatencyCanaryDeadline,
  type WhereLatencyCanaryRuntime,
  type WhereLatencyDeepResidualRuntime
} from "../../scripts/runWhereLatencyCanary";

const LONG = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const FRESH = "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const GIT_COMMIT = "1".repeat(40);
const GIT_TREE = "2".repeat(40);
const VM_EXEC_ARGV = ["--experimental-vm-modules", "--import", "tsx"];
const execFileAsync = promisify(execFile);
const BRIDGE_KEYS = generateKeyPairSync("ed25519");
const BRIDGE_PUBLIC_DER = BRIDGE_KEYS.publicKey.export({ format: "der", type: "spki" });
const BRIDGE_PUBLIC_SHA256 = createHash("sha256").update(BRIDGE_PUBLIC_DER).digest("hex");
const deploymentIdentity = () => ({
  schema: "where-latency-canary-deployment-identity-v1" as const,
  deploymentReceiptFileSha256: "3".repeat(64),
  immutableArtifactDigest: `sha256:${"4".repeat(64)}`,
  gitCommit: GIT_COMMIT,
  gitTree: GIT_TREE,
  moduleGraphSha256: "5".repeat(64),
  adapterEntrySha256: HEX_B,
  bundleFormat: "single_file_esm_bundle_v1" as const,
  nodeRuntime: {
    implementation: "node" as const,
    version: process.version,
    execArgv: [...process.execArgv]
  },
  allowedNodeBuiltins: [],
  bridgeProtocolVersion: "where-latency-canary-bridge-v1" as const,
  bridgePublicKeySpkiSha256: BRIDGE_PUBLIC_SHA256
});
const DATABASE_FINGERPRINT = fingerprintCanonicalArtifact({
  schema: "where-latency-canary-database-v1",
  protocol: "postgres:",
  hostname: "canary-db.internal",
  port: "5432",
  database: "tron_guard_canary"
});

const cleanScheduler = () => ({
  apiKeyConfigured: true,
  queued: 0,
  inFlight: 0,
  maxInFlight: 20,
  maxInFlightPerGroup: 2,
  apiKeyCount: 4,
  apiKeyGroupCount: 2,
  dispatchedRequests: 10,
  completedRequests: 10,
  failedRequests: 0,
  rateLimitedRequests: 0
});

const cleanLanes = () => ({
  allForensic: { runnableQueuedCount: 0, dbRunningCount: 0 },
  where: { runnableQueuedCount: 0, dbRunningCount: 0 },
  deep: { runnableQueuedCount: 0, dbRunningCount: 0 }
});

const config = () => ({
  databaseUrl: "postgres://canary:secret@canary-db.internal:5432/tron_guard_canary",
  dedicatedDeployment: true,
  runtimeInstanceLabel: "where-canary-01",
  enabledRuntimeCycles: ["where", "address_index", "delivery_reconciliation"] as const,
  workerConcurrency: 2,
  deepWorkerConcurrency: 1,
  wherePollIntervalMs: 2_000,
  terminalTimeoutMs: 10_000,
  drainTimeoutMs: 10_000,
  runtimeConfigIdentity: HEX_A,
  runtimeBridgeUrl: "http://127.0.0.1:43123",
  runtimeBridgeTimeoutMs: 10_000,
  adapterIdentity: {
    schema: "where-latency-canary-adapter-v1" as const,
    moduleRealPath: "C:/deployment/whereCanaryAdapter.mjs",
    moduleContentSha256: HEX_B
  },
  deploymentIdentity: deploymentIdentity()
});

const attestation = () => ({
  schema: "where-latency-canary-runtime-attestation-v1" as const,
  runtimeInstanceLabel: "where-canary-01",
  runtimeConfigIdentity: HEX_A,
  databaseFingerprint: DATABASE_FINGERPRINT,
  enabledRuntimeCycles: ["address_index", "delivery_reconciliation", "where"],
  whereWorkerConcurrency: 2,
  deepWorkerConcurrency: 1,
  wherePumpBindingIdentity: HEX_A,
  schedulerBindingIdentity: HEX_B,
  forensicRepositoryBindingIdentity: HEX_C,
  deliveryRepositoryBindingIdentity: "d".repeat(64),
  addressIndexBindingIdentity: "e".repeat(64),
  deepWorkerBindingIdentity: "f".repeat(64),
  schedulerCapacityFingerprint: fingerprintCanonicalArtifact({
    schema: "tronscan-scheduler-capacity-v1",
    apiKeyConfigured: true,
    apiKeyCount: 4,
    apiKeyGroupCount: 2,
    maxInFlight: 20,
    maxInFlightPerGroup: 2
  }),
  schedulerOwnershipBindingIdentity: "1".repeat(64),
  deploymentIdentity: deploymentIdentity()
});

const zeroOwnership = () => ({
  preExistingAddressIndexWork: 0,
  preExistingCanaryExternalWork: 0,
  canaryOwned: {
    queued: 0, inFlight: 0, dispatched: 0,
    completed: 0, failed: 0, rateLimited: 0
  },
  foreign: {
    queued: 0, inFlight: 0, dispatched: 0,
    completed: 0, failed: 0, rateLimited: 0
  }
});

function runtime(overrides: Partial<WhereLatencyCanaryRuntime> = {}): WhereLatencyCanaryRuntime {
  let schedulerCalls = 0;
  const jobs = new Map<string, { createdAtMs: number; startedAtMs: number; status: string }>();
  const value: WhereLatencyCanaryRuntime = {
    runtimeAttestation: vi.fn(async () => attestation()),
    schedulerIsolationDiagnostics: vi.fn(async () => zeroOwnership()),
    schedulerDiagnostics: vi.fn(async () => {
      schedulerCalls += 1;
      const requestDelta = Math.max(0, schedulerCalls - 2);
      return {
        ...cleanScheduler(),
        dispatchedRequests: 10 + requestDelta,
        completedRequests: 10 + requestDelta
      };
    }),
    laneDiagnostics: vi.fn(async () => cleanLanes()),
    enqueueWhereJob: vi.fn(async (input) => {
      const id = input.subjectAddress === LONG ? "long-job" : "fresh-job";
      const createdAtMs = input.subjectAddress === LONG ? 1_000 : 2_000;
      jobs.set(id, { createdAtMs, startedAtMs: createdAtMs + 100, status: "queued" });
      return { id, createdAtMs };
    }),
    waitForHandlerStart: vi.fn(async (jobId) => {
      const job = jobs.get(jobId)!;
      job.status = "running";
      return { jobId, startedAtMs: job.startedAtMs, activeWhereHandlers: jobId === "long-job" ? 1 : 2 };
    }),
    jobRuntimeState: vi.fn(async (jobId) => ({
      jobId,
      status: "running" as const,
      handlerActive: true
    })),
    waitForTerminal: vi.fn(async (jobId) => ({
      jobId,
      status: "completed" as const,
      completedAtMs: jobs.get(jobId)!.startedAtMs + 1_000
    })),
    deliveryDiagnostics: vi.fn(async () => ({ intentCount: 0, claimCount: 0 })),
    maxActiveWhereHandlers: vi.fn(() => 2),
    stopClaimsAndDrain: vi.fn(async () => undefined),
    ...overrides
  };
  return value;
}

function deepRuntime(
  overrides: Partial<WhereLatencyDeepResidualRuntime> = {}
): WhereLatencyDeepResidualRuntime {
  return {
    ...runtime(),
    runtimeAttestation: vi.fn(async () => ({
      ...attestation(),
      enabledRuntimeCycles: ["address_index", "deep", "delivery_reconciliation"]
    })),
    enqueueDeepJob: vi.fn(async () => ({ id: "deep-job", createdAtMs: 1_000 })),
    waitForDeepHandlerStart: vi.fn(async (jobId) => ({
      jobId,
      startedAtMs: 1_500,
      activeDeepHandlers: 1
    })),
    waitForTerminal: vi.fn(async (jobId) => ({
      jobId,
      status: "partial" as const,
      completedAtMs: 4_000
    })),
    deepJobDiagnostics: vi.fn(async () => ({ providerErrorCount: 2 })),
    memoryDiagnostics: vi.fn()
      .mockResolvedValueOnce({ rssBytes: 100, heapUsedBytes: 50 })
      .mockResolvedValueOnce({ rssBytes: 120, heapUsedBytes: 60 })
      .mockResolvedValueOnce({ rssBytes: 110, heapUsedBytes: 55 }),
    stopDeepClaimsAndDrain: vi.fn(async () => undefined),
    ...overrides
  };
}

async function receiptFile(
  directory: string,
  runtimeValue: WhereLatencyCanaryRuntime,
  configValue = config()
) {
  const path = join(directory, "isolation.json");
  await prepareWhereLatencyCanary({
    out: path,
    config: configValue,
    runtime: runtimeValue,
    now: () => 100
  });
  return path;
}

async function deploymentFixture(
  directory: string,
  adapterSource = [
    "import { invoke as bridgeInvoke } from 'canary:bridge';",
    "export function createWhereLatencyCanaryRuntime(){",
    "void bridgeInvoke; return { marker: 'verified-bundle', runtimeAttestation:async()=>({}),",
    "schedulerIsolationDiagnostics:async()=>({}),schedulerDiagnostics:async()=>({}),",
    "laneDiagnostics:async()=>({}),enqueueWhereJob:async()=>({}),",
    "waitForHandlerStart:async()=>({}),waitForTerminal:async()=>({}),",
    "deliveryDiagnostics:async()=>({}),jobRuntimeState:async()=>({}),",
    "maxActiveWhereHandlers:()=>0,stopClaimsAndDrain:async()=>{}}}",
    ""
  ].join("\n"),
  options: { execArgv?: string[]; allowedNodeBuiltins?: string[] } = {}
) {
  const root = join(directory, "deployment");
  await mkdir(root);
  const adapterPath = join(root, "adapter.mjs");
  await writeFile(adapterPath, adapterSource, "utf8");
  const hashFile = async (path: string) => createHash("sha256")
    .update(await readFile(path)).digest("hex");
  const moduleGraph = [{ path: "adapter.mjs", sha256: await hashFile(adapterPath) }];
  const payload = {
    schema: "where-latency-canary-deployment-v1",
    version: 1,
    deploymentRoot: await realpath(root),
    immutableArtifactDigest: `sha256:${"4".repeat(64)}`,
    gitCommit: GIT_COMMIT,
    gitTree: GIT_TREE,
    bundleFormat: "single_file_esm_bundle_v1",
    nodeRuntime: {
      implementation: "node",
      version: process.version,
      execArgv: [...(options.execArgv ?? process.execArgv)]
    },
    allowedNodeBuiltins: [...(options.allowedNodeBuiltins ?? [])],
    bridgeProtocolVersion: "where-latency-canary-bridge-v1",
    bridgePublicKeySpkiDerBase64: Buffer.from(BRIDGE_PUBLIC_DER).toString("base64"),
    bridgePublicKeySpkiSha256: BRIDGE_PUBLIC_SHA256,
    moduleGraph,
    moduleGraphSha256: fingerprintCanonicalArtifact(moduleGraph),
    adapterEntryPath: "adapter.mjs",
    adapterEntrySha256: moduleGraph[0]!.sha256,
    runtimeConfigIdentity: HEX_A
  } as const;
  const receipt = { ...payload, sha256: fingerprintCanonicalArtifact(payload) };
  const receiptPath = join(directory, "deployment-receipt.json");
  const receiptBytes = `${canonicalizeArtifactJson(receipt)}\n`;
  await writeFile(receiptPath, receiptBytes, "utf8");
  const { adapterIdentity: _adapter, deploymentIdentity: _deployment, ...unboundConfig } = config();
  return {
    root,
    adapterPath,
    adapterSource,
    receiptPath,
    receipt,
    unboundConfig,
    expectedDeploymentReceiptFileSha256: createHash("sha256").update(receiptBytes).digest("hex"),
    expectedImmutableArtifactDigest: payload.immutableArtifactDigest
  };
}

async function runVmChild(
  directory: string,
  runnerSource: string,
  environment: Record<string, string>,
  experimental = true
) {
  const runnerPath = join(directory, `vm-runner-${randomUUID()}.mjs`);
  await writeFile(runnerPath, runnerSource, "utf8");
  const args = experimental
    ? [...VM_EXEC_ARGV, runnerPath]
    : ["--import", "tsx", runnerPath];
  const result = await execFileAsync(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CANARY_SCRIPT_URL: pathToFileURL(
        resolve("scripts/runWhereLatencyCanary.ts")
      ).href,
      ...environment
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(result.stdout.trim()) as unknown;
}

describe("Where latency canary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds a canonical non-secret isolation receipt bound to exact capacity and config", async () => {
    const receipt = buildWhereLatencyCanaryIsolationReceipt({
      config: config(),
      scheduler: cleanScheduler(),
      schedulerIsolation: zeroOwnership(),
      runtimeAttestation: attestation(),
      preparedAt: "2026-07-27T00:00:00.000Z"
    });

    expect(receipt).toMatchObject({
      schema: "where-latency-canary-isolation-v1",
      version: 1,
      runtimeInstanceLabel: "where-canary-01",
      enabledRuntimeCycles: ["address_index", "delivery_reconciliation", "where"],
      workerConcurrency: 2,
      deepWorkerConcurrency: 1,
      schedulerBaseline: { queued: 0, inFlight: 0 },
      adapterIdentity: config().adapterIdentity,
      runtimeAttestation: expect.objectContaining({
        schema: "where-latency-canary-runtime-attestation-v1",
        whereWorkerConcurrency: 2,
        deepWorkerConcurrency: 1
      })
    });
    expect(receipt.databaseFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain("secret");
    expect(receipt.schedulerCapacityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.configSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects runtime attestation that differs from the expected canonical deployment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    await expect(prepareWhereLatencyCanary({
      out: join(directory, "isolation.json"),
      config: config(),
      runtime: runtime({
        runtimeAttestation: vi.fn(async () => ({
          ...attestation(),
          runtimeInstanceLabel: "foreign-runtime"
        }))
      })
    })).rejects.toThrow("where_latency_canary_runtime_attestation_mismatch");
  });

  it("canonicalizes the adapter real path and hashes its exact module bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-adapter-"));
    const path = join(directory, "adapter.mjs");
    const bytes = "export const adapter = true;\n";
    await writeFile(path, bytes, "utf8");
    const identity = await resolveWhereLatencyCanaryAdapterIdentity(
      join(directory, ".", "adapter.mjs")
    );
    expect(identity).toEqual({
      schema: "where-latency-canary-adapter-v1",
      moduleRealPath: path,
      moduleContentSha256: createHash("sha256").update(bytes).digest("hex")
    });
  });

  it.each([
    ["dedicated deployment", { dedicatedDeployment: false }, "where_latency_canary_dedicated_deployment_required"],
    ["runtime label", { runtimeInstanceLabel: "" }, "where_latency_canary_runtime_instance_label_required"],
    ["concurrency two", { workerConcurrency: 1 }, "where_latency_canary_concurrency_two_required"],
    ["Deep singleton", { deepWorkerConcurrency: 2 }, "where_latency_canary_deep_concurrency_must_remain_one"],
    ["loopback runtime bridge", { runtimeBridgeUrl: "https://example.com" }, "where_latency_canary_runtime_bridge_url_invalid"],
    ["runtime bridge timeout", { runtimeBridgeTimeoutMs: 0 }, "where_latency_canary_runtime_bridge_timeout_invalid"],
    ["exact cycle allowlist", { enabledRuntimeCycles: ["where", "address_index", "deep"] }, "where_latency_canary_cycle_allowlist_invalid"]
  ])("rejects preparation without %s", async (_label, changed, code) => {
    await expect(prepareWhereLatencyCanary({
      out: join(await mkdtemp(join(tmpdir(), "where-canary-")), "isolation.json"),
      config: { ...config(), ...changed } as ReturnType<typeof config>,
      runtime: runtime()
    })).rejects.toThrow(code);
  });

  it("rejects preparation unless DB lanes and scheduler are clean", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    await expect(prepareWhereLatencyCanary({
      out: join(directory, "queue.json"),
      config: config(),
      runtime: runtime({ laneDiagnostics: vi.fn(async () => ({
        allForensic: { runnableQueuedCount: 1, dbRunningCount: 0 },
        where: { runnableQueuedCount: 1, dbRunningCount: 0 },
        deep: { runnableQueuedCount: 0, dbRunningCount: 0 }
      })) })
    })).rejects.toThrow("where_latency_canary_database_not_clean");
    await expect(prepareWhereLatencyCanary({
      out: join(directory, "scheduler.json"),
      config: config(),
      runtime: runtime({ schedulerDiagnostics: vi.fn(async () => ({ ...cleanScheduler(), queued: 1 })) })
    })).rejects.toThrow("where_latency_canary_scheduler_not_clean");
  });

  it("rejects work by any forensic lane and scheduler use between prepare and run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    const foreignLaneRuntime = runtime({
      laneDiagnostics: vi.fn(async () => ({
        allForensic: { runnableQueuedCount: 1, dbRunningCount: 0 },
        where: { runnableQueuedCount: 0, dbRunningCount: 0 },
        deep: { runnableQueuedCount: 0, dbRunningCount: 0 }
      }))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "foreign-lane.json"),
      config: config(),
      runtime: foreignLaneRuntime
    })).rejects.toThrow("where_latency_canary_database_not_clean");

    const usedSchedulerRuntime = runtime({
      schedulerDiagnostics: vi.fn(async () => ({ ...cleanScheduler(), dispatchedRequests: 11 }))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "used-scheduler.json"),
      config: config(),
      runtime: usedSchedulerRuntime
    })).rejects.toThrow("where_latency_canary_scheduler_baseline_mismatch");
    expect(usedSchedulerRuntime.enqueueWhereJob).not.toHaveBeenCalled();
  });

  it("never overwrites an isolation or run receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const output = join(directory, "existing.json");
    await writeFile(output, "owned", "utf8");
    await expect(prepareWhereLatencyCanary({ out: output, config: config(), runtime: runtime() }))
      .rejects.toThrow("where_latency_canary_output_exists");
  });

  it("requires confirm and valid TRON source addresses before runtime mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const runtimeValue = runtime();
    const isolationReceipt = await receiptFile(directory, runtimeValue);
    await expect(runWhereLatencyCanary({
      confirm: false,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runtimeValue,
      longAddress: LONG,
      freshAddress: FRESH
    })).rejects.toThrow("where_latency_canary_confirm_required");
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "invalid.json"),
      config: config(),
      runtime: runtimeValue,
      longAddress: "not-tron",
      freshAddress: FRESH
    })).rejects.toThrow("where_latency_canary_source_address_invalid");
    expect(runtimeValue.enqueueWhereJob).not.toHaveBeenCalled();
  });

  it("rejects tampered or config-mismatched isolation receipts before enqueue", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const preparedRuntime = runtime();
    const isolationReceipt = await receiptFile(directory, preparedRuntime);
    const parsed = JSON.parse(await readFile(isolationReceipt, "utf8"));
    parsed.workerConcurrency = 1;
    await writeFile(isolationReceipt, JSON.stringify(parsed), "utf8");
    const runRuntime = runtime();
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runRuntime,
      longAddress: LONG,
      freshAddress: FRESH
    })).rejects.toThrow("where_latency_canary_isolation_receipt_not_canonical");
    expect(runRuntime.enqueueWhereJob).not.toHaveBeenCalled();
  });

  it("runs long-first with null chat, records the start gate before terminal waits, drains, and writes a passing receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const preparedRuntime = runtime();
    const isolationReceipt = await receiptFile(directory, preparedRuntime);
    const events: string[] = [];
    const runRuntime = runtime({
      waitForHandlerStart: vi.fn(async (jobId) => {
        events.push(`start:${jobId}`);
        return jobId === "long-job"
          ? { jobId, startedAtMs: 1_100, activeWhereHandlers: 1 }
          : { jobId, startedAtMs: 2_100, activeWhereHandlers: 2 };
      }),
      waitForTerminal: vi.fn(async (jobId) => {
        events.push(`terminal:${jobId}`);
        return { jobId, status: "completed" as const, completedAtMs: 3_000 };
      }),
      stopClaimsAndDrain: vi.fn(async () => { events.push("drain"); })
    });
    const output = join(directory, "run.json");
    const result = await runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: output,
      config: config(),
      runtime: runRuntime,
      longAddress: LONG,
      freshAddress: FRESH,
      canaryId: "canary-unique",
      now: () => 4_000
    });

    expect(runRuntime.enqueueWhereJob).toHaveBeenNthCalledWith(1, expect.objectContaining({
      subjectAddress: LONG, priority: 1_000, chatId: null,
      requestedBy: "where-latency-canary:canary-unique",
      progressMarker: "where-latency-canary-progress:canary-unique:long"
    }));
    expect(runRuntime.enqueueWhereJob).toHaveBeenNthCalledWith(2, expect.objectContaining({
      subjectAddress: FRESH, priority: 900, chatId: null,
      progressMarker: "where-latency-canary-progress:canary-unique:fresh"
    }));
    expect(events.indexOf("start:fresh-job")).toBeLessThan(events.indexOf("terminal:long-job"));
    expect(events.at(-1)).toBe("drain");
    expect(result).toMatchObject({
      schema: "where-latency-canary-run-v1",
      result: "pass",
      startGate: { elapsedMs: 100, maximumMs: 4_000, passed: true },
      slotGate: { maximumActiveHandlers: 2, passed: true },
      deliveryGate: { intentCount: 0, claimCount: 0, passed: true },
      schedulerGate: {
        completedRequestDelta: 0,
        failedRequestDelta: 0,
        rateLimitedRequestDelta: 0,
        passed: true
      },
      laneGate: {
        start: cleanLanes(),
        end: cleanLanes(),
        passed: true
      },
      terminalAndDrainGate: { drained: true, passed: true },
      deepConcurrency: 1,
      isolationReceiptFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      schedulerIsolationGate: { passed: true }
    });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(result);
  });

  it.each([
    ["slow start", { freshStartedAtMs: 7_001 }, "where_latency_canary_start_gate_failed"],
    ["too many handlers", { maxActive: 3 }, "where_latency_canary_slot_gate_failed"],
    ["delivery intent", { intentCount: 1 }, "where_latency_canary_delivery_gate_failed"],
    ["rate limit", { rateLimitedDelta: 1 }, "where_latency_canary_scheduler_counter_gate_failed"],
    ["failed request", { failedDelta: 1 }, "where_latency_canary_scheduler_counter_gate_failed"],
    ["capacity drift", { maxInFlight: 21 }, "where_latency_canary_scheduler_capacity_changed"]
  ])("fails closed on %s", async (_label, change, code) => {
    const gate = change as Partial<{
      freshStartedAtMs: number;
      maxActive: number;
      intentCount: number;
      rateLimitedDelta: number;
      failedDelta: number;
      maxInFlight: number;
    }>;
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    let calls = 0;
    const runRuntime = runtime({
      waitForHandlerStart: vi.fn(async (jobId) => jobId === "long-job"
        ? { jobId, startedAtMs: 1_100, activeWhereHandlers: 1 }
        : { jobId, startedAtMs: gate.freshStartedAtMs ?? 2_100, activeWhereHandlers: 2 }),
      maxActiveWhereHandlers: vi.fn(() => gate.maxActive ?? 2),
      deliveryDiagnostics: vi.fn(async () => ({ intentCount: gate.intentCount ?? 0, claimCount: 0 })),
      schedulerDiagnostics: vi.fn(async () => {
        calls += 1;
        const end = calls > 1;
        return {
          ...cleanScheduler(),
          maxInFlight: end ? gate.maxInFlight ?? 20 : 20,
          rateLimitedRequests: end ? gate.rateLimitedDelta ?? 0 : 0,
          failedRequests: end ? gate.failedDelta ?? 0 : 0
        };
      })
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runRuntime,
      longAddress: LONG,
      freshAddress: FRESH,
      canaryId: "fail-case"
    })).rejects.toThrow(code);
    expect(runRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);
  });

  it("records two-slots-occupied as non-gating and never evicts work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    const runRuntime = runtime({
      waitForHandlerStart: vi.fn(async (jobId) => ({
        jobId,
        startedAtMs: 1_100,
        activeWhereHandlers: 2
      }))
    });
    const result = await runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runRuntime,
      longAddress: LONG,
      freshAddress: FRESH,
      canaryId: "occupied"
    });
    expect(result).toMatchObject({
      result: "non_gating_not_isolated",
      diagnosticCode: "no_stage_b_start_guarantee"
    });
    expect(runRuntime.enqueueWhereJob).toHaveBeenCalledTimes(1);
    expect(runRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);
  });

  it("requires the canary-owned database lanes to be drained before a pass receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    let laneCalls = 0;
    const runRuntime = runtime({
      laneDiagnostics: vi.fn(async () => {
        laneCalls += 1;
        return laneCalls === 1 ? cleanLanes() : {
          allForensic: { runnableQueuedCount: 0, dbRunningCount: 1 },
          where: { runnableQueuedCount: 0, dbRunningCount: 1 },
          deep: { runnableQueuedCount: 0, dbRunningCount: 0 }
        };
      })
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runRuntime
    })).rejects.toThrow("where_latency_canary_database_not_drained");
    expect(runRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the runtime bridge does not prove one occupied long-job slot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    const runRuntime = runtime({
      waitForHandlerStart: vi.fn(async (jobId) => ({
        jobId,
        startedAtMs: 1_100,
        activeWhereHandlers: 0
      }))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runRuntime
    })).rejects.toThrow("where_latency_canary_long_slot_not_observed");
    expect(runRuntime.enqueueWhereJob).toHaveBeenCalledTimes(1);
    expect(runRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched terminal job identity from the runtime bridge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    const runRuntime = runtime({
      waitForTerminal: vi.fn(async (jobId) => ({
        jobId: `${jobId}-other`,
        status: "completed" as const,
        completedAtMs: 3_000
      }))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "run.json"),
      config: config(),
      runtime: runRuntime
    })).rejects.toThrow("where_latency_canary_runtime_job_identity_mismatch");
    expect(runRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);
  });

  it("requires job-specific proof that long is still active when fresh starts in exactly two slots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    const endedLongRuntime = runtime({
      jobRuntimeState: vi.fn(async (jobId) => ({
        jobId,
        status: jobId === "long-job" ? "completed" as const : "running" as const,
        handlerActive: jobId !== "long-job"
      }))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "ended-long.json"),
      config: config(),
      runtime: endedLongRuntime
    })).rejects.toThrow("where_latency_canary_one_slot_scenario_not_observed");

    const oneActiveRuntime = runtime({
      waitForHandlerStart: vi.fn(async (jobId) => ({
        jobId,
        startedAtMs: jobId === "long-job" ? 1_100 : 2_100,
        activeWhereHandlers: 1
      }))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "one-active.json"),
      config: config(),
      runtime: oneActiveRuntime
    })).rejects.toThrow("where_latency_canary_one_slot_scenario_not_observed");
  });

  it("resamples delivery after drain and rejects a late intent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    let deliveryCalls = 0;
    const runRuntime = runtime({
      deliveryDiagnostics: vi.fn(async () => {
        deliveryCalls += 1;
        return deliveryCalls === 1
          ? { intentCount: 0, claimCount: 0 }
          : { intentCount: 1, claimCount: 0 };
      })
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "late-delivery.json"),
      config: config(),
      runtime: runRuntime
    })).rejects.toThrow("where_latency_canary_delivery_gate_failed");
    expect(runRuntime.deliveryDiagnostics).toHaveBeenCalledTimes(2);
  });

  it("requires drained completed-request delta to equal dispatched delta", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    let schedulerCalls = 0;
    const runRuntime = runtime({
      schedulerDiagnostics: vi.fn(async () => {
        schedulerCalls += 1;
        return schedulerCalls === 1
          ? cleanScheduler()
          : { ...cleanScheduler(), dispatchedRequests: 11, completedRequests: 10 };
      })
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "counter-mismatch.json"),
      config: config(),
      runtime: runRuntime
    })).rejects.toThrow("where_latency_canary_scheduler_completion_mismatch");
  });

  it("captures residual Deep queue, provider, memory, delivery, terminal, and drain evidence separately", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const output = join(directory, "deep.json");
    const runtimeValue = deepRuntime();
    const result = await captureWhereLatencyDeepResidual({
      confirm: true,
      out: output,
      config: {
        ...config(),
        enabledRuntimeCycles: ["deep", "address_index", "delivery_reconciliation"]
      },
      runtime: runtimeValue,
      measurementId: "deep-measurement",
      now: () => 5_000
    });

    expect(runtimeValue.enqueueDeepJob).toHaveBeenCalledWith(expect.objectContaining({
      subjectAddress: FRESH,
      chatId: null,
      requestedBy: "where-latency-deep-residual:deep-measurement"
    }));
    expect(runtimeValue.deliveryDiagnostics).toHaveBeenCalledTimes(2);
    expect(runtimeValue.stopDeepClaimsAndDrain).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      schema: "where-latency-deep-residual-v1",
      result: "measured",
      queueAgeMs: 500,
      providerErrors: {
        jobReported: 2,
        schedulerFailedRequestDelta: 0,
        schedulerRateLimitedRequestDelta: 0
      },
      memory: {
        before: { rssBytes: 100, heapUsedBytes: 50 },
        atStart: { rssBytes: 120, heapUsedBytes: 60 },
        afterDrain: { rssBytes: 110, heapUsedBytes: 55 }
      },
      delivery: {
        beforeDrain: { intentCount: 0, claimCount: 0 },
        afterDrain: { intentCount: 0, claimCount: 0 }
      },
      drained: true
    });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(result);
  });

  it("fails Deep residual capture before enqueue without confirmation and on late delivery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const runtimeValue = deepRuntime();
    const deepConfig = {
      ...config(),
      enabledRuntimeCycles: ["deep", "address_index", "delivery_reconciliation"]
    };
    await expect(captureWhereLatencyDeepResidual({
      confirm: false,
      out: join(directory, "unconfirmed.json"),
      config: deepConfig,
      runtime: runtimeValue
    })).rejects.toThrow("where_latency_deep_residual_confirm_required");
    expect(runtimeValue.enqueueDeepJob).not.toHaveBeenCalled();

    let deliveryCalls = 0;
    const lateDelivery = deepRuntime({
      deliveryDiagnostics: vi.fn(async () => ({
        intentCount: ++deliveryCalls === 1 ? 0 : 1,
        claimCount: 0
      }))
    });
    await expect(captureWhereLatencyDeepResidual({
      confirm: true,
      out: join(directory, "late-delivery.json"),
      config: deepConfig,
      runtime: lateDelivery
    })).rejects.toThrow("where_latency_deep_residual_delivery_not_zero");
    expect(lateDelivery.stopDeepClaimsAndDrain).toHaveBeenCalledTimes(1);
  });

  it("bounds handler start, terminal wait, and drain with harness-owned abort signals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    let startSignal: AbortSignal | null = null;
    const startConfig = { ...config(), wherePollIntervalMs: 1 };
    const startIsolationReceipt = await receiptFile(directory, runtime(), startConfig);
    const startTimeoutRuntime = runtime({
      waitForHandlerStart: vi.fn(async (_jobId, signal) => {
        startSignal = signal;
        return await new Promise<never>(() => undefined);
      })
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt: startIsolationReceipt,
      out: join(directory, "start-timeout.json"),
      config: startConfig,
      runtime: startTimeoutRuntime
    })).rejects.toThrow("where_latency_canary_long_start_timeout");
    expect((startSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(startTimeoutRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);

    const terminalConfig = { ...config(), terminalTimeoutMs: 2 };
    const terminalIsolationReceipt = join(directory, "terminal-isolation.json");
    await prepareWhereLatencyCanary({
      out: terminalIsolationReceipt,
      config: terminalConfig,
      runtime: runtime(),
      now: () => 100
    });
    const terminalTimeoutRuntime = runtime({
      waitForTerminal: vi.fn(async () => await new Promise<never>(() => undefined))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt: terminalIsolationReceipt,
      out: join(directory, "terminal-timeout.json"),
      config: terminalConfig,
      runtime: terminalTimeoutRuntime
    })).rejects.toThrow("where_latency_canary_terminal_timeout");
    expect(terminalTimeoutRuntime.stopClaimsAndDrain).toHaveBeenCalledTimes(1);

    const drainConfig = { ...config(), drainTimeoutMs: 2 };
    const drainIsolationReceipt = join(directory, "drain-isolation.json");
    await prepareWhereLatencyCanary({
      out: drainIsolationReceipt,
      config: drainConfig,
      runtime: runtime(),
      now: () => 100
    });
    const drainTimeoutRuntime = runtime({
      stopClaimsAndDrain: vi.fn(async () => await new Promise<never>(() => undefined))
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt: drainIsolationReceipt,
      out: join(directory, "drain-timeout.json"),
      config: drainConfig,
      runtime: drainTimeoutRuntime
    })).rejects.toThrow("where_latency_canary_drain_timeout");
  });

  it("rejects scheduler ownership contamination and pre-existing external/index work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    await expect(prepareWhereLatencyCanary({
      out: join(directory, "prepare.json"),
      config: config(),
      runtime: runtime({
        schedulerIsolationDiagnostics: vi.fn(async () => ({
          ...zeroOwnership(),
          preExistingAddressIndexWork: 1
        }))
      })
    })).rejects.toThrow("where_latency_canary_scheduler_isolation_not_clean");

    const isolationReceipt = await receiptFile(directory, runtime());
    let calls = 0;
    const contaminated = runtime({
      schedulerIsolationDiagnostics: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? zeroOwnership() : {
          ...zeroOwnership(),
          foreign: { ...zeroOwnership().foreign, dispatched: 1 }
        };
      })
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "contaminated.json"),
      config: config(),
      runtime: contaminated
    })).rejects.toThrow("where_latency_canary_scheduler_isolation_contaminated");

    let ownershipCalls = 0;
    const mismatchedOwnership = runtime({
      schedulerIsolationDiagnostics: vi.fn(async () => {
        ownershipCalls += 1;
        return ownershipCalls === 1 ? zeroOwnership() : {
          ...zeroOwnership(),
          canaryOwned: {
            ...zeroOwnership().canaryOwned,
            dispatched: 1,
            completed: 1
          }
        };
      })
    });
    const mismatchReceipt = join(directory, "ownership-isolation.json");
    await prepareWhereLatencyCanary({
      out: mismatchReceipt,
      config: config(),
      runtime: runtime(),
      now: () => 100
    });
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt: mismatchReceipt,
      out: join(directory, "ownership-mismatch.json"),
      config: config(),
      runtime: mismatchedOwnership
    })).rejects.toThrow("where_latency_canary_scheduler_ownership_counter_mismatch");
  });

  it("rejects duplicate-key/noncanonical isolation bytes before runtime mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    const isolationReceipt = await receiptFile(directory, runtime());
    const canonical = await readFile(isolationReceipt, "utf8");
    await writeFile(
      isolationReceipt,
      canonical.replace(/^\{/, '{"version":1,'),
      "utf8"
    );
    const runRuntime = runtime();
    await expect(runWhereLatencyCanary({
      confirm: true,
      isolationReceipt,
      out: join(directory, "duplicate.json"),
      config: config(),
      runtime: runRuntime
    })).rejects.toThrow("where_latency_canary_isolation_receipt_not_canonical");
    expect(runRuntime.enqueueWhereJob).not.toHaveBeenCalled();
  });

  it("bounds residual Deep terminal wait and attempts a bounded drain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-"));
    let terminalSignal: AbortSignal | null = null;
    const runtimeValue = deepRuntime({
      waitForTerminal: vi.fn(async (_jobId, signal) => {
        terminalSignal = signal;
        return await new Promise<never>(() => undefined);
      })
    });
    await expect(captureWhereLatencyDeepResidual({
      confirm: true,
      out: join(directory, "deep-timeout.json"),
      config: {
        ...config(),
        enabledRuntimeCycles: ["deep", "address_index", "delivery_reconciliation"],
        terminalTimeoutMs: 2
      },
      runtime: runtimeValue
    })).rejects.toThrow("where_latency_deep_residual_terminal_timeout");
    expect((terminalSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(runtimeValue.stopDeepClaimsAndDrain).toHaveBeenCalledTimes(1);

    const drainRuntime = deepRuntime({
      stopDeepClaimsAndDrain: vi.fn(async () => await new Promise<never>(() => undefined))
    });
    await expect(captureWhereLatencyDeepResidual({
      confirm: true,
      out: join(directory, "deep-drain-timeout.json"),
      config: {
        ...config(),
        enabledRuntimeCycles: ["deep", "address_index", "delivery_reconciliation"],
        drainTimeoutMs: 2
      },
      runtime: drainRuntime
    })).rejects.toThrow("where_latency_deep_residual_drain_timeout");
  });

  it("keeps correctness deadlines referenced and reaches the named timeout", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      const handle = originalSetTimeout(callback, delay, ...args);
      deadlineHandle = handle;
      return handle;
    }) as typeof setTimeout);
    await expect(withWhereLatencyCanaryDeadline(
      2,
      "where_latency_canary_test_deadline",
      async () => await new Promise<never>(() => undefined)
    )).rejects.toThrow("where_latency_canary_test_deadline");
    expect((deadlineHandle as NodeJS.Timeout | null)?.hasRef()).toBe(true);
  });

  it("authenticates bridge envelopes and rejects impostor, tamper, replay, and binding mismatches", async () => {
    const nonce = "a".repeat(64);
    const signedTransport = (
      privateKey = BRIDGE_KEYS.privateKey,
      mutate: (value: Record<string, unknown>) => void = () => undefined
    ) => async (body: string) => {
      const request = JSON.parse(body) as Record<string, unknown>;
      const response = { ok: true, seq: request.seq };
      const signed: Record<string, unknown> = {
        schema: "where-latency-canary-bridge-response-v1",
        protocolVersion: "where-latency-canary-bridge-v1",
        sessionNonce: request.sessionNonce,
        seq: request.seq,
        method: request.method,
        requestSha256: request.requestSha256,
        responseSha256: fingerprintCanonicalArtifact(response),
        response
      };
      mutate(signed);
      const envelope = {
        ...signed,
        signature: sign(
          null,
          Buffer.from(canonicalizeArtifactJson(signed)),
          privateKey
        ).toString("base64")
      };
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from(canonicalizeArtifactJson(envelope)) as Uint8Array
      };
    };
    const invoke = (transport: ReturnType<typeof signedTransport>) =>
      createWhereLatencyCanaryBridgeInvoker({
        url: "http://127.0.0.1:43123",
        timeoutMs: 100,
        publicKey: BRIDGE_KEYS.publicKey,
        sessionNonce: nonce,
        transport
      });

    await expect(invoke(signedTransport()).invoke(
      "schedulerDiagnostics",
      JSON.stringify({ sample: true })
    )).resolves.toEqual({ ok: true, seq: 1 });

    const impostor = generateKeyPairSync("ed25519");
    await expect(invoke(signedTransport(impostor.privateKey)).invoke(
      "schedulerDiagnostics", "{}"
    )).rejects.toThrow("where_latency_canary_bridge_signature_invalid");
    await expect(invoke(signedTransport(BRIDGE_KEYS.privateKey, (value) => {
      value.responseSha256 = "0".repeat(64);
    })).invoke("schedulerDiagnostics", "{}"))
      .rejects.toThrow("where_latency_canary_bridge_response_hash_mismatch");
    for (const [field, value] of [
      ["seq", 2],
      ["method", "laneDiagnostics"],
      ["requestSha256", "0".repeat(64)]
    ] as const) {
      await expect(invoke(signedTransport(BRIDGE_KEYS.privateKey, (signed) => {
        signed[field] = value;
      })).invoke("schedulerDiagnostics", "{}"))
        .rejects.toThrow("where_latency_canary_bridge_response_binding_mismatch");
    }

    let replayBody: Uint8Array | null = null;
    const base = signedTransport();
    const replayTransport = async (body: string) => {
      if (replayBody === null) replayBody = (await base(body)).body;
      return { status: 200, contentType: "application/json", body: replayBody };
    };
    const replayInvoker = invoke(replayTransport);
    await replayInvoker.invoke("schedulerDiagnostics", "{}");
    await expect(replayInvoker.invoke("schedulerDiagnostics", "{}"))
      .rejects.toThrow("where_latency_canary_bridge_response_binding_mismatch");
    await expect(invoke(async () => ({
      status: 200,
      contentType: "application/json",
      body: Buffer.from("not-json")
    })).invoke("schedulerDiagnostics", "{}"))
      .rejects.toThrow("where_latency_canary_bridge_response_not_json");
    await expect(invoke(async () => ({
      status: 200,
      contentType: "application/json",
      body: Buffer.alloc(1024 * 1024 + 1)
    })).invoke("schedulerDiagnostics", "{}"))
      .rejects.toThrow("where_latency_canary_bridge_response_too_large");
    await expect(invoke(signedTransport()).invoke("unknownMethod", "{}"))
      .rejects.toThrow("where_latency_canary_bridge_method_forbidden");
    await expect(createWhereLatencyCanaryBridgeInvoker({
      url: "http://127.0.0.1:43123",
      timeoutMs: 2,
      publicKey: BRIDGE_KEYS.publicKey,
      sessionNonce: nonce,
      transport: async () => await new Promise<never>(() => undefined)
    }).invoke("schedulerDiagnostics", "{}"))
      .rejects.toThrow("where_latency_canary_bridge_timeout");
  });

  it("executes verified bundle bytes even if the adapter path changes after read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-deployment-"));
    const fixture = await deploymentFixture(directory, undefined, {
      execArgv: VM_EXEC_ARGV
    });
    const payload = {
      config: fixture.unboundConfig,
      modulePath: fixture.adapterPath,
      deploymentReceiptPath: fixture.receiptPath,
      expectedDeploymentReceiptFileSha256: fixture.expectedDeploymentReceiptFileSha256,
      expectedImmutableArtifactDigest: fixture.expectedImmutableArtifactDigest,
      gitCommit: GIT_COMMIT,
      gitTree: GIT_TREE
    };
    const result = await runVmChild(directory, `
      import { writeFile } from "node:fs/promises";
      const api = await import(process.env.CANARY_SCRIPT_URL);
      const input = JSON.parse(Buffer.from(process.env.PROBE_INPUT, "base64").toString("utf8"));
      const loaded = await api.loadVerifiedWhereLatencyRuntimeBridge({
        ...input,
        inspectCheckout: async () => {
          await writeFile(input.modulePath, "throw new Error('swapped path executed');\\n", "utf8");
          return { commit: input.gitCommit, tree: input.gitTree, status: "" };
        }
      });
      process.stdout.write(JSON.stringify({
        marker: loaded.runtime.marker,
        active: loaded.runtime.maxActiveWhereHandlers(),
        lanes: await loaded.runtime.laneDiagnostics(),
        nodeRuntime: loaded.deploymentIdentity.nodeRuntime,
        allowedNodeBuiltins: loaded.deploymentIdentity.allowedNodeBuiltins
      }));
    `, {
      PROBE_INPUT: Buffer.from(JSON.stringify(payload)).toString("base64")
    });
    expect(result).toEqual({
      marker: "verified-bundle",
      active: 0,
      lanes: {},
      nodeRuntime: {
        implementation: "node",
        version: process.version,
        execArgv: VM_EXEC_ARGV
      },
      allowedNodeBuiltins: []
    });
  });

  it("enforces VM linker, dynamic-import, code-generation, and global boundaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-vm-"));
    const cases = [
      {
        name: "safe-builtin",
        allowed: ["node:buffer"],
        source: "import { Buffer as B } from 'node:buffer'; export function createWhereLatencyCanaryRuntime(){ return { marker: B.from('safe').toString() }; }"
      },
      {
        name: "callback-this",
        allowed: ["node:timers"],
        source: `
          import { setTimeout as schedule } from "node:timers";
          export async function createWhereLatencyCanaryRuntime() {
            const marker = await new Promise((resolve) => schedule(function (value) {
              resolve(value + ":" + (this.constructor === undefined && Object.getPrototypeOf(this) === null));
            }, 0, "callback-ok"));
            return { marker };
          }
        `
      },
      {
        name: "promise-error-roundtrip",
        allowed: ["node:timers/promises"],
        source: `
          import { setTimeout as delay } from "node:timers/promises";
          export async function createWhereLatencyCanaryRuntime() {
            const controller = new AbortController();
            const pending = delay(1000, "late", { signal: controller.signal });
            controller.abort();
            let hostErrorBlocked = false;
            try { await pending; } catch (error) {
              hostErrorBlocked = error.constructor === undefined && Object.getPrototypeOf(error) === null;
            }
            const returned = await delay(0, "value").then((value) => ({ value }));
            const thrown = await delay(0).then(() => {
              throw new Error("vm-callback-throw");
            }).catch((error) => error.message);
            return { marker: hostErrorBlocked + ":" + returned.value + ":" + thrown };
          }
        `
      },
      { name: "http-forbidden", allowed: [], source: "import 'node:http'; export function createWhereLatencyCanaryRuntime(){ return {}; }" },
      { name: "https-forbidden", allowed: [], source: "import 'node:https'; export function createWhereLatencyCanaryRuntime(){ return {}; }" },
      { name: "create-require", allowed: [], source: "import { createRequire } from 'node:module'; export function createWhereLatencyCanaryRuntime(){ return createRequire(import.meta.url); }" },
      { name: "relative", allowed: [], source: "import './dependency.mjs'; export function createWhereLatencyCanaryRuntime(){}" },
      { name: "bare", allowed: [], source: "import 'some-package'; export function createWhereLatencyCanaryRuntime(){}" },
      { name: "data", allowed: [], source: "import 'data:text/javascript,export default 1'; export function createWhereLatencyCanaryRuntime(){}" },
      { name: "dynamic", allowed: [], source: "export async function createWhereLatencyCanaryRuntime(){ return import('node:buffer'); }" },
      { name: "process", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return process.getBuiltinModule('fs'); }" },
      { name: "eval", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return eval('({})'); }" },
      { name: "function", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return Function('return process')(); }" },
      { name: "global-escape", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return globalThis.constructor.constructor('return process')(); }" },
      { name: "global-host", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return global.process; }" },
      { name: "buffer-host-escape", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return Buffer.constructor('return process')(); }" },
      { name: "reflective-host-escape", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ const descriptor = Object.getOwnPropertyDescriptor(Buffer, 'prototype'); return { marker: descriptor.value === null && Object.getPrototypeOf(Buffer) === null }; }" },
      { name: "url-host-escape", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return URL.constructor('return process')(); }" },
      { name: "abort-host-escape", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return AbortController.constructor('return process')(); }" },
      { name: "timer-host-escape", allowed: [], source: "export function createWhereLatencyCanaryRuntime(){ return setTimeout.constructor('return process')(); }" },
      { name: "unused-declaration", allowed: ["node:buffer"], source: "export function createWhereLatencyCanaryRuntime(){ return {}; }" }
    ];
    const result = await runVmChild(directory, `
      const api = await import(process.env.CANARY_SCRIPT_URL);
      const cases = JSON.parse(Buffer.from(process.env.PROBE_CASES, "base64").toString("utf8"));
      const results = [];
      for (const item of cases) {
        try {
          const runtime = await api.createWhereLatencyRuntimeFromVerifiedBundle({
            bytes: Buffer.from(item.source),
            identifier: "where-latency-canary:test:" + item.name,
            allowedNodeBuiltins: item.allowed,
            factoryConfig: {}
          });
          results.push({ name: item.name, ok: true, marker: runtime.marker ?? null });
        } catch (error) {
          results.push({ name: item.name, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      process.stdout.write(JSON.stringify(results));
    `, {
      PROBE_CASES: Buffer.from(JSON.stringify(cases)).toString("base64")
    }) as Array<{ name: string; ok: boolean; marker?: string; error?: string }>;
    expect(result.find(({ name }) => name === "safe-builtin"))
      .toMatchObject({ ok: true, marker: "safe" });
    expect(result.find(({ name }) => name === "callback-this"))
      .toMatchObject({ ok: true, marker: "callback-ok:true" });
    expect(result.find(({ name }) => name === "promise-error-roundtrip"))
      .toMatchObject({ ok: true, marker: "true:value:vm-callback-throw" });
    expect(result.find(({ name }) => name === "reflective-host-escape"))
      .toMatchObject({ ok: true, marker: true });
    const expectedErrors: Record<string, RegExp> = {
      "http-forbidden": /where_latency_canary_bundle_builtin_forbidden/,
      "https-forbidden": /where_latency_canary_bundle_builtin_forbidden/,
      "create-require": /where_latency_canary_bundle_builtin_forbidden/,
      relative: /where_latency_canary_bundle_import_forbidden/,
      bare: /where_latency_canary_bundle_import_forbidden/,
      data: /where_latency_canary_bundle_import_forbidden/,
      dynamic: /where_latency_canary_dynamic_import_forbidden/,
      process: /process is not defined/,
      eval: /Code generation from strings disallowed/,
      function: /Code generation from strings disallowed/,
      "global-escape": /Code generation from strings disallowed/,
      "global-host": /global is not defined/,
      "buffer-host-escape": /Buffer\.constructor is not a function/,
      "url-host-escape": /URL\.constructor is not a function/,
      "abort-host-escape": /AbortController\.constructor is not a function/,
      "timer-host-escape": /(setTimeout\.constructor is not a function|Code generation from strings disallowed)/,
      "unused-declaration": /where_latency_canary_bundle_builtin_binding_mismatch/
    };
    for (const [name, error] of Object.entries(expectedErrors)) {
      const entry = result.find((candidate) => candidate.name === name);
      expect(entry, name).toMatchObject({ ok: false });
      expect(entry?.error, name).toMatch(error);
    }
  });

  it("keeps runtime methods, host promises, and AbortSignal behind the bidirectional membrane", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-vm-"));
    const source = `
      export function createWhereLatencyCanaryRuntime() {
        const runtime = {
          async inspect(signal, fulfilled, rejected) {
            let rejection;
            try { await rejected; } catch (error) {
              rejection = {
                message: error.message,
                blocked: error.constructor === undefined && Object.getPrototypeOf(error) === null
              };
            }
            return {
              thisOk: this === runtime,
              signalBlocked: signal.constructor === undefined && Object.getPrototypeOf(signal) === null,
              reasonBlocked: signal.reason.constructor === undefined && Object.getPrototypeOf(signal.reason) === null,
              promiseBlocked: fulfilled.constructor === undefined && Object.getPrototypeOf(fulfilled) === null,
              aborted: signal.aborted,
              fulfilled: await fulfilled,
              rejection
            };
          },
          add(left, right) { return left + right; }
        };
        return runtime;
      }
    `;
    const result = await runVmChild(directory, `
      const api = await import(process.env.CANARY_SCRIPT_URL);
      const runtime = await api.createWhereLatencyRuntimeFromVerifiedBundle({
        bytes: Buffer.from(process.env.PROBE_SOURCE, "base64"),
        identifier: "where-latency-canary:test:runtime-result-boundary",
        allowedNodeBuiltins: [],
        factoryConfig: {}
      });
      const controller = new AbortController();
      controller.abort(new Error("host-abort"));
      const inspected = await runtime.inspect(
        controller.signal,
        Promise.resolve("host-value"),
        Promise.reject(new Error("host-reject"))
      );
      process.stdout.write(JSON.stringify({
        thisOk: inspected.thisOk,
        signalBlocked: inspected.signalBlocked,
        reasonBlocked: inspected.reasonBlocked,
        promiseBlocked: inspected.promiseBlocked,
        aborted: inspected.aborted,
        fulfilled: inspected.fulfilled,
        rejectionMessage: inspected.rejection.message,
        rejectionBlocked: inspected.rejection.blocked,
        sum: runtime.add(2, 3)
      }));
    `, {
      PROBE_SOURCE: Buffer.from(source).toString("base64")
    });
    expect(result).toEqual({
      thisOk: true,
      signalBlocked: true,
      reasonBlocked: true,
      promiseBlocked: true,
      aborted: true,
      fulfilled: "host-value",
      rejectionMessage: "host-reject",
      rejectionBlocked: true,
      sum: 5
    });
  });

  it("fails closed when vm.SourceTextModule is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-canary-vm-"));
    const result = await runVmChild(directory, `
      const api = await import(process.env.CANARY_SCRIPT_URL);
      try {
        await api.createWhereLatencyRuntimeFromVerifiedBundle({
          bytes: Buffer.from("export function createWhereLatencyCanaryRuntime(){ return {}; }"),
          identifier: "where-latency-canary:test:unavailable",
          allowedNodeBuiltins: [],
          factoryConfig: {}
        });
        process.stdout.write(JSON.stringify({ ok: true }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
      }
    `, {}, false);
    expect(result).toEqual({
      ok: false,
      error: "where_latency_canary_vm_modules_unavailable"
    });
  });

  it("rejects wrong bundle format, multi-file graph, and dirty checkout before runtime import", async () => {
    const graphDirectory = await mkdtemp(join(tmpdir(), "where-canary-deployment-"));
    const graphFixture = await deploymentFixture(graphDirectory);
    const graphReceipt = {
      ...graphFixture.receipt,
      bundleFormat: "transitive_modules_v1"
    };
    const graphPayload = { ...graphReceipt };
    delete (graphPayload as Partial<typeof graphReceipt>).sha256;
    const rewritten = {
      ...graphReceipt,
      sha256: fingerprintCanonicalArtifact(graphPayload)
    };
    const graphBytes = `${canonicalizeArtifactJson(rewritten)}\n`;
    await writeFile(graphFixture.receiptPath, graphBytes, "utf8");
    await expect(loadVerifiedWhereLatencyRuntimeBridge({
      config: graphFixture.unboundConfig,
      modulePath: graphFixture.adapterPath,
      deploymentReceiptPath: graphFixture.receiptPath,
      expectedDeploymentReceiptFileSha256: createHash("sha256").update(graphBytes).digest("hex"),
      expectedImmutableArtifactDigest: graphFixture.expectedImmutableArtifactDigest,
      inspectCheckout: vi.fn(async () => ({ commit: GIT_COMMIT, tree: GIT_TREE, status: "" }))
    })).rejects.toThrow("where_latency_canary_bundle_format_invalid");

    const multiDirectory = await mkdtemp(join(tmpdir(), "where-canary-deployment-"));
    const multiFixture = await deploymentFixture(multiDirectory);
    const multiGraph = [
      ...multiFixture.receipt.moduleGraph,
      { path: "dependency.mjs", sha256: "8".repeat(64) }
    ];
    const multiReceipt = {
      ...multiFixture.receipt,
      moduleGraph: multiGraph,
      moduleGraphSha256: fingerprintCanonicalArtifact(multiGraph)
    };
    const multiPayload = { ...multiReceipt };
    delete (multiPayload as Partial<typeof multiReceipt>).sha256;
    const multiRewritten = {
      ...multiReceipt,
      sha256: fingerprintCanonicalArtifact(multiPayload)
    };
    const multiBytes = `${canonicalizeArtifactJson(multiRewritten)}\n`;
    await writeFile(multiFixture.receiptPath, multiBytes, "utf8");
    await expect(loadVerifiedWhereLatencyRuntimeBridge({
      config: multiFixture.unboundConfig,
      modulePath: multiFixture.adapterPath,
      deploymentReceiptPath: multiFixture.receiptPath,
      expectedDeploymentReceiptFileSha256: createHash("sha256").update(multiBytes).digest("hex"),
      expectedImmutableArtifactDigest: multiFixture.expectedImmutableArtifactDigest,
      inspectCheckout: vi.fn(async () => ({ commit: GIT_COMMIT, tree: GIT_TREE, status: "" }))
    })).rejects.toThrow("where_latency_canary_bundle_graph_must_be_single_file");

    const dirtyDirectory = await mkdtemp(join(tmpdir(), "where-canary-deployment-"));
    const dirtyFixture = await deploymentFixture(dirtyDirectory);
    await expect(loadVerifiedWhereLatencyRuntimeBridge({
      config: dirtyFixture.unboundConfig,
      modulePath: dirtyFixture.adapterPath,
      deploymentReceiptPath: dirtyFixture.receiptPath,
      expectedDeploymentReceiptFileSha256: dirtyFixture.expectedDeploymentReceiptFileSha256,
      expectedImmutableArtifactDigest: dirtyFixture.expectedImmutableArtifactDigest,
      inspectCheckout: vi.fn(async () => ({
        commit: GIT_COMMIT,
        tree: GIT_TREE,
        status: " M adapter.mjs"
      }))
    })).rejects.toThrow("where_latency_canary_deployment_checkout_not_immutable");
  });
});
