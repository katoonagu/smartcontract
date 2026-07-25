import { describe, expect, it, vi } from "vitest";
import {
  classifyUnifiedRuntimeResources,
  createUnifiedCheckpointLatencySampler,
  createUnifiedDbLatencySampler,
  createUnifiedRepairServiceTracker,
  runUnifiedAdaptiveControllerCycle
} from "../../src/unifiedCheck/adaptiveRuntime";

const normalResources = {
  rssBytes: 100,
  heapUsedBytes: 50,
  availableMemoryBytes: 10_000,
  dbWaitingCount: 0,
  dbLatencyMs: 5,
  checkpointLatencyMs: 5
};

const thresholds = {
  pressureAvailableMemoryBytes: 1_000,
  criticalAvailableMemoryBytes: 100,
  pressureRssBytes: 5_000,
  criticalRssBytes: 10_000,
  pressureDbWaitingCount: 4,
  criticalDbWaitingCount: 10,
  pressureDbLatencyMs: 250,
  criticalDbLatencyMs: 1_000,
  pressureCheckpointLatencyMs: 500,
  criticalCheckpointLatencyMs: 2_000
};

function demand(
  runId: string,
  ownerId: string,
  eligibleReadyWork: number
) {
  return {
    runId,
    ownerId,
    lane: "interactive" as const,
    eligibleReadyWork,
    ownerLastServedAtMs: 0,
    lastServedAtMs: 0,
    mergeBufferFull: false,
    providerAvailable: true,
    resourceGuarded: false,
    canonicalHeadEligible: true
  };
}

describe("adaptive Unified runtime", () => {
  it("classifies resource pressure independently from provider health", () => {
    expect(classifyUnifiedRuntimeResources(normalResources, thresholds))
      .toBe("normal");
    expect(classifyUnifiedRuntimeResources({
      ...normalResources,
      dbWaitingCount: 4
    }, thresholds)).toBe("pressure");
    expect(classifyUnifiedRuntimeResources({
      ...normalResources,
      availableMemoryBytes: 100
    }, thresholds)).toBe("critical");
  });

  it("consumes one critical checkpoint sample and then recovers", () => {
    const sampler = createUnifiedCheckpointLatencySampler();
    sampler.record(thresholds.criticalCheckpointLatencyMs);

    expect(classifyUnifiedRuntimeResources({
      ...normalResources,
      checkpointLatencyMs: sampler.sampleAndReset()
    }, thresholds)).toBe("critical");
    expect(classifyUnifiedRuntimeResources({
      ...normalResources,
      checkpointLatencyMs: sampler.sampleAndReset()
    }, thresholds)).toBe("normal");
  });

  it("separates supply from demand and feeds fair shares into rolling admission", async () => {
    const refill = vi.fn(async (input: {
      runId: string;
      policy: "barrier" | "rolling";
      lookaheadTarget: number;
    }) => ({
      admittedTaskIds: [`${input.runId}-admitted`],
      deAdmittedTaskIds: [],
      blocker: null
    }));
    const setPoolTarget = vi.fn();
    const wakePool = vi.fn();
    const assignProviderPermits = vi.fn();
    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 0, lastIncreaseAtMs: 0 },
      providerGroups: [
        {
          groupId: "a",
          state: "healthy",
          concurrencyLimit: 2,
          inFlight: 0,
          cooldownUntil: null
        },
        {
          groupId: "b",
          state: "cooldown",
          concurrencyLimit: 2,
          inFlight: 0,
          cooldownUntil: 3_000
        },
        {
          groupId: "c",
          state: "healthy",
          concurrencyLimit: 2,
          inFlight: 0,
          cooldownUntil: null
        }
      ],
      resources: normalResources,
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 100,
        providerWorkerLimit: 100,
        providerIncreaseStep: 4,
        providerIncreaseIntervalMs: 1_000,
        analysisConcurrencyLimit: 2,
        finalizationConcurrencyLimit: 2,
        admissionPolicy: "rolling",
        lookaheadFactor: 2,
        perRunLookaheadMaximum: 100,
        readyBufferMaxEntries: 100,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.1,
        repairMaxSlots: 4,
        repairMaxWaitChunks: 8,
        chunksSinceLastRepair: 0
      },
      demand: [demand("run-a", "owner-a", 10), demand("run-b", "owner-b", 10)],
      refill,
      countActionableProviderWork: async () => [
        { runId: "run-a", lane: "interactive", count: 1 },
        { runId: "run-b", lane: "interactive", count: 2 }
      ],
      assignProviderPermits,
      setPoolTarget,
      wakePool
    });

    expect(result.providerCapacityLimit).toBe(4);
    expect(result.eligibleReadyProviderWork).toBe(20);
    expect(result.targetActiveProviderSlots).toBe(4);
    expect(result.actionableProviderSlots).toBe(3);
    expect(result.claimPermits).toEqual([
      {
        lane: "interactive",
        ownerId: "owner-a",
        runId: "run-a",
        canonicalHeadPreferred: true
      },
      {
        lane: "interactive",
        ownerId: "owner-b",
        runId: "run-b",
        canonicalHeadPreferred: true
      },
      {
        lane: "interactive",
        ownerId: "owner-b",
        runId: "run-b",
        canonicalHeadPreferred: true
      }
    ]);
    expect(result.allocations.map((item) => item.slots)).toEqual([2, 2]);
    expect(refill.mock.calls.map(([input]) => ({
      runId: input.runId,
      policy: input.policy,
      lookaheadTarget: input.lookaheadTarget
    }))).toEqual([
      { runId: "run-a", policy: "rolling", lookaheadTarget: 4 },
      { runId: "run-b", policy: "rolling", lookaheadTarget: 4 }
    ]);
    expect(setPoolTarget).toHaveBeenCalledWith(3);
    expect(assignProviderPermits).toHaveBeenCalledWith(
      result.claimAssignments
    );
    expect(wakePool).toHaveBeenCalledOnce();
  });

  it("keeps mixed lane identity and refills a shared run once from its aggregate share", async () => {
    const refill = vi.fn(async () => ({
      admittedTaskIds: [],
      deAdmittedTaskIds: [],
      blocker: null
    }));
    const assignProviderPermits = vi.fn();
    const mixedDemand = [
      {
        ...demand("run-mixed", "owner-mixed", 2),
        lane: "repair" as const,
        canonicalHeadEligible: false
      },
      {
        ...demand("run-mixed", "owner-mixed", 4),
        lane: "interactive" as const,
        canonicalHeadEligible: true
      }
    ];

    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 4, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "a",
        state: "healthy",
        concurrencyLimit: 4,
        inFlight: 0,
        cooldownUntil: null
      }],
      resources: normalResources,
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 4,
        providerWorkerLimit: 4,
        providerIncreaseStep: 4,
        providerIncreaseIntervalMs: 1,
        analysisConcurrencyLimit: 1,
        finalizationConcurrencyLimit: 1,
        admissionPolicy: "rolling",
        lookaheadFactor: 2,
        perRunLookaheadMaximum: 100,
        readyBufferMaxEntries: 100,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.25,
        repairMaxSlots: 2,
        repairMaxWaitChunks: 4,
        chunksSinceLastRepair: 0
      },
      demand: mixedDemand,
      refill,
      countActionableProviderWork: async (scopes) =>
        scopes.map((scope) => ({
          ...scope,
          count: scope.lane === "repair" ? 2 : 4
        })),
      assignProviderPermits,
      setPoolTarget: vi.fn(),
      wakePool: vi.fn()
    });

    expect(result.allocations.map((allocation) => ({
      runId: allocation.runId,
      ownerId: allocation.ownerId,
      lane: allocation.lane,
      slots: allocation.slots,
      canonicalHeadPreferred: allocation.canonicalHeadPreferred
    }))).toEqual([
      {
        runId: "run-mixed",
        ownerId: "owner-mixed",
        lane: "repair",
        slots: 1,
        canonicalHeadPreferred: false
      },
      {
        runId: "run-mixed",
        ownerId: "owner-mixed",
        lane: "interactive",
        slots: 3,
        canonicalHeadPreferred: true
      }
    ]);
    expect(result.claimPermits.filter((permit) =>
      permit.lane === "repair"
    )).toHaveLength(1);
    expect(result.claimPermits.filter((permit) =>
      permit.lane === "interactive" &&
      permit.canonicalHeadPreferred
    )).toHaveLength(3);
    expect(refill).toHaveBeenCalledOnce();
    expect(refill).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-mixed",
      lookaheadTarget: 8
    }));
  });

  it("immediately pauses all new resource-class claims at critical pressure", async () => {
    const refill = vi.fn(async () => ({
      admittedTaskIds: [],
      deAdmittedTaskIds: ["tail"],
      blocker: "no_provider_capacity" as const
    }));
    const setPoolTarget = vi.fn();
    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 4, lastIncreaseAtMs: 1_000 },
      providerGroups: [{
        groupId: "a",
        state: "healthy",
        concurrencyLimit: 4,
        inFlight: 0,
        cooldownUntil: null
      }],
      resources: { ...normalResources, availableMemoryBytes: 99 },
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 100,
        providerWorkerLimit: 100,
        providerIncreaseStep: 1,
        providerIncreaseIntervalMs: 1_000,
        analysisConcurrencyLimit: 2,
        finalizationConcurrencyLimit: 2,
        admissionPolicy: "rolling",
        lookaheadFactor: 2,
        perRunLookaheadMaximum: 100,
        readyBufferMaxEntries: 100,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.1,
        repairMaxSlots: 4,
        repairMaxWaitChunks: 8,
        chunksSinceLastRepair: 0
      },
      demand: [demand("run-a", "owner-a", 10)],
      refill,
      setPoolTarget,
      wakePool: vi.fn()
    });

    expect(result.runtimeState).toBe("critical");
    expect(result.targetActiveProviderSlots).toBe(0);
    expect(result.analysisConcurrencyLimit).toBe(0);
    expect(result.finalizationConcurrencyLimit).toBe(0);
    expect(refill).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-a",
      lookaheadTarget: 0
    }));
    expect(setPoolTarget).toHaveBeenCalledWith(0);
  });

  it("counts repair wait only from actual claimed chunks, not wakes or allocations", () => {
    const tracker = createUnifiedRepairServiceTracker();
    tracker.updateRepairReady(true);
    tracker.recordWake();
    tracker.recordAllocation("repair");
    tracker.recordAllocation("interactive");
    expect(tracker.snapshot().chunksSinceLastRepair).toBe(0);

    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    expect(tracker.snapshot().chunksSinceLastRepair).toBe(2);
    tracker.recordClaim("repair");
    expect(tracker.snapshot().chunksSinceLastRepair).toBe(0);

    tracker.updateRepairReady(false);
    tracker.recordClaim("interactive");
    expect(tracker.snapshot().chunksSinceLastRepair).toBe(0);
  });

  it("samples actual DB operation latency separately from controller wall time", () => {
    const sampler = createUnifiedDbLatencySampler();
    sampler.record(5);
    sampler.record(20);
    expect(sampler.sampleAndReset()).toBe(20);
    expect(sampler.sampleAndReset()).toBe(0);
  });
});
