import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildWhereLatencyCanaryIsolationReceipt,
  captureWhereLatencyDeepResidual,
  prepareWhereLatencyCanary,
  resolveWhereLatencyCanaryAdapterIdentity,
  runWhereLatencyCanary,
  type WhereLatencyCanaryRuntime,
  type WhereLatencyDeepResidualRuntime
} from "../../scripts/runWhereLatencyCanary";

const LONG = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const FRESH = "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
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
  runtimeConfigIdentity: HEX_A,
  adapterIdentity: {
    schema: "where-latency-canary-adapter-v1" as const,
    moduleRealPath: "C:/deployment/whereCanaryAdapter.mjs",
    moduleContentSha256: HEX_B
  }
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
  })
});

function runtime(overrides: Partial<WhereLatencyCanaryRuntime> = {}): WhereLatencyCanaryRuntime {
  let schedulerCalls = 0;
  const jobs = new Map<string, { createdAtMs: number; startedAtMs: number; status: string }>();
  const value: WhereLatencyCanaryRuntime = {
    runtimeAttestation: vi.fn(async () => attestation()),
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

async function receiptFile(directory: string, runtimeValue: WhereLatencyCanaryRuntime) {
  const path = join(directory, "isolation.json");
  await prepareWhereLatencyCanary({ out: path, config: config(), runtime: runtimeValue, now: () => 100 });
  return path;
}

describe("Where latency canary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds a canonical non-secret isolation receipt bound to exact capacity and config", async () => {
    const receipt = buildWhereLatencyCanaryIsolationReceipt({
      config: config(),
      scheduler: cleanScheduler(),
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
    })).rejects.toThrow("where_latency_canary_isolation_receipt_invalid");
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
      startGate: { elapsedMs: 100, passed: true },
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
      deepConcurrency: 1
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
});
