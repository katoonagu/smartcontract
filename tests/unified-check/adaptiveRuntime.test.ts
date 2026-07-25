import { describe, expect, it, vi } from "vitest";
import {
  attributeUnifiedPacedDemand,
  classifyUnifiedRuntimeResources,
  countUnifiedActualLaneSlots,
  createUnifiedCheckpointLatencySampler,
  createUnifiedDbLatencySampler,
  createUnifiedRepairServiceTracker,
  hasHealthyCapableProviderGroup,
  loadUnifiedAdaptiveStorageSnapshot,
  runUnifiedAdaptiveControllerCycle
} from "../../src/unifiedCheck/adaptiveRuntime";
import {
  createUnifiedAdminRunDecisionStore
} from "../../src/unifiedCheck/adminRunSnapshot";

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
  it("requires a healthy positive-capacity group without pinning ordered work to a group", () => {
    expect(hasHealthyCapableProviderGroup([{
      groupId: "healthy-but-incapable",
      state: "healthy",
      concurrencyLimit: 0,
      inFlight: 0,
      cooldownUntil: null
    }, {
      groupId: "capable-but-cooling",
      state: "cooldown",
      concurrencyLimit: 4,
      inFlight: 0,
      cooldownUntil: 2_000
    }])).toBe(false);
    expect(hasHealthyCapableProviderGroup([{
      groupId: "capable",
      state: "healthy",
      concurrencyLimit: 1,
      inFlight: 0,
      cooldownUntil: null
    }])).toBe(true);
    expect(Object.keys(demand("run", "owner", 1))).not.toContain(
      "providerGroupId"
    );
  });

  it("attributes pacing without reducing healthy provider eligibility", async () => {
    const attributed = attributeUnifiedPacedDemand([
      demand("run-paced", "owner-paced", 1),
      demand("run-independent", "owner-independent", 1)
    ], (runId) => runId === "run-paced");
    expect(attributed[0]).toMatchObject({
      providerAvailable: true,
      providerPaced: true
    });

    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 2, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "group-a",
        state: "healthy",
        concurrencyLimit: 1,
        inFlight: 0,
        cooldownUntil: null
      }, {
        groupId: "group-b",
        state: "healthy",
        concurrencyLimit: 1,
        inFlight: 0,
        cooldownUntil: null
      }],
      resources: normalResources,
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 2,
        providerWorkerLimit: 2,
        providerIncreaseStep: 2,
        providerIncreaseIntervalMs: 1,
        analysisConcurrencyLimit: 1,
        finalizationConcurrencyLimit: 1,
        admissionPolicy: "rolling",
        lookaheadFactor: 1,
        perRunLookaheadMaximum: 2,
        readyBufferMaxEntries: 2,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.1,
        repairMaxSlots: 1,
        repairMaxWaitChunks: 2,
        chunksSinceLastRepair: 0
      },
      demand: attributed,
      refill: async ({ runId }) => ({
        admittedTaskIds: [`${runId}-task`],
        deAdmittedTaskIds: [],
        blocker: null
      }),
      countActionableProviderWork: async (scopes) =>
        scopes.map((scope) => ({ ...scope, count: 1 })),
      providerSlots: [{
        slotId: 0,
        epoch: 0,
        active: false,
        activePermit: null
      }, {
        slotId: 1,
        epoch: 0,
        active: false,
        activePermit: null
      }],
      setPoolTarget: vi.fn(),
      wakePool: vi.fn()
    });

    expect(result.claimAssignments.map((item) => item.permit.runId).sort())
      .toEqual(["run-independent", "run-paced"]);
    expect(result.limitingReason).toBeNull();
    expect(result.runDecisions.find((item) =>
      item.runId === "run-paced"
    )?.blocker).toBeNull();
  });

  it("counts a newly assigned repair slot once from the post-assignment boundary", () => {
    expect(countUnifiedActualLaneSlots({
      lane: "repair",
      slotSnapshots: [{
        slotId: 0,
        epoch: 1,
        active: true,
        activePermit: {
          runId: "repair-run",
          ownerId: "repair-owner",
          lane: "repair",
          canonicalHeadPreferred: false
        }
      }]
    })).toBe(1);
  });
  it("loads one bounded global planner snapshot for production publication", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{
      durable_backlog: "7",
      admitted: "3",
      leased: "2",
      ready: "4",
      committed: "11",
      ready_bytes: "500",
      reserved_bytes: "700",
      canonical_head_age_ms: "12000"
    }] }));

    await expect(loadUnifiedAdaptiveStorageSnapshot(
      { query },
      {
        now: new Date("2026-07-25T00:01:00.000Z"),
        runtimeCommit: "candidate",
        providerConfigurationSha256: "f".repeat(64)
      }
    )).resolves.toEqual({
      planner: {
        durableBacklog: 7,
        admitted: 3,
        leased: 2,
        ready: 4,
        committed: 11
      },
      buffer: {
        readyCount: 4,
        readyBytes: 500,
        reservedBytes: 700
      },
      canonicalHeadAgeMs: 12_000
    });
    expect(query).toHaveBeenCalledOnce();
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(
      /entry\.planner_state = 'planned'\s+and entry\.admitted_at is null/u
    );
    expect(sql).toMatch(
      /entry\.planner_state = 'planned'\s+and entry\.admitted_at is not null/u
    );
    expect(sql).toMatch(/run\.status = 'RUNNING'/u);
    expect(sql).toMatch(/task\.cancellation_requested_at is null/u);
    expect(sql).toMatch(/manifest\.artifact_json->>'runtimeCommit'/u);
    expect(query.mock.calls[0]?.[1]).toEqual([
      new Date("2026-07-25T00:01:00.000Z"),
      "candidate",
      "f".repeat(64)
    ]);
  });

  it("uses the actual refill blocker when theoretical allocation cannot assign a permit", async () => {
    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 1, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "group-a",
        state: "healthy",
        concurrencyLimit: 1,
        inFlight: 0,
        cooldownUntil: null
      }],
      resources: normalResources,
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 1,
        providerWorkerLimit: 1,
        providerIncreaseStep: 1,
        providerIncreaseIntervalMs: 1,
        analysisConcurrencyLimit: 1,
        finalizationConcurrencyLimit: 1,
        admissionPolicy: "rolling",
        lookaheadFactor: 1,
        perRunLookaheadMaximum: 2,
        readyBufferMaxEntries: 2,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.1,
        repairMaxSlots: 1,
        repairMaxWaitChunks: 2,
        chunksSinceLastRepair: 0
      },
      demand: [demand("run-head", "owner-head", 1)],
      refill: async () => ({
        admittedTaskIds: [],
        deAdmittedTaskIds: [],
        blocker: "canonical_head_wait"
      }),
      countActionableProviderWork: async () => [{
        runId: "run-head",
        lane: "interactive",
        count: 0
      }],
      setPoolTarget: vi.fn(),
      wakePool: vi.fn()
    });

    expect(result.allocations[0]?.slots).toBe(1);
    expect(result.claimAssignments).toHaveLength(0);
    expect(result.runDecisions[0]?.blocker).toEqual({
      scope: "run",
      code: "canonical_head_wait"
    });
  });

  it("retains an active-only run until its slot reaches the boundary", async () => {
    const decisionStore = createUnifiedAdminRunDecisionStore();
    const activePermit = {
      runId: "run-active",
      ownerId: "opaque-owner",
      lane: "interactive" as const,
      canonicalHeadPreferred: false
    };
    const common = {
      nowMs: 2_000,
      rampState: { target: 1, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "group-a",
        state: "healthy" as const,
        concurrencyLimit: 1,
        inFlight: 1,
        cooldownUntil: null
      }],
      resources: normalResources,
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 1,
        providerWorkerLimit: 1,
        providerIncreaseStep: 1,
        providerIncreaseIntervalMs: 1,
        analysisConcurrencyLimit: 1,
        finalizationConcurrencyLimit: 1,
        admissionPolicy: "rolling" as const,
        lookaheadFactor: 1,
        perRunLookaheadMaximum: 2,
        readyBufferMaxEntries: 2,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.1,
        repairMaxSlots: 1,
        repairMaxWaitChunks: 2,
        chunksSinceLastRepair: 0
      },
      demand: [],
      refill: vi.fn(async () => ({
        admittedTaskIds: [],
        deAdmittedTaskIds: [],
        blocker: null
      })),
      setPoolTarget: vi.fn(),
      wakePool: vi.fn(),
      onDecision: (decision: {
        runDecisions: Parameters<typeof decisionStore.replace>[0];
      }) => decisionStore.replace(decision.runDecisions)
    };

    const active = await runUnifiedAdaptiveControllerCycle({
      ...common,
      providerSlots: [{
        slotId: 0,
        epoch: 1,
        active: true,
        activePermit
      }]
    });
    expect(active.runDecisions).toEqual([{
      runId: "run-active",
      ownerId: "opaque-owner",
      lane: "interactive",
      fairShare: 0,
      activeSlots: 1,
      lastServedAt: null,
      lookaheadTarget: 0,
      blocker: null
    }]);
    expect(common.refill).not.toHaveBeenCalled();
    expect(decisionStore.get("run-active")).toMatchObject({
      ownerId: "opaque-owner",
      activeSlots: 1,
      fairShare: 0
    });

    const afterBoundary = await runUnifiedAdaptiveControllerCycle({
      ...common,
      providerSlots: [{
        slotId: 0,
        epoch: 2,
        active: false,
        activePermit: null
      }]
    });
    expect(afterBoundary.runDecisions).toEqual([]);
    expect(decisionStore.get("run-active")).toBeNull();
  });

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

  it("counts one repair violation per waiting episode only after the boundary", () => {
    const onWaitViolation = vi.fn();
    const tracker = createUnifiedRepairServiceTracker({
      repairMaxWaitChunks: 2,
      onWaitViolation
    });
    tracker.updateRepairReady(true);
    tracker.recordWake();
    tracker.recordAllocation("repair");
    tracker.recordAllocation("interactive");
    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 0,
      waitViolations: 0
    });

    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 2,
      waitViolations: 0
    });
    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 4,
      waitViolations: 1
    });
    expect(onWaitViolation).toHaveBeenCalledOnce();
    expect(onWaitViolation).toHaveBeenCalledWith(expect.objectContaining({
      type: "repair_wait_violated"
    }));

    tracker.recordClaim("repair");
    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 3,
      waitViolations: 2
    });
    expect(onWaitViolation).toHaveBeenCalledTimes(2);

    tracker.updateRepairReady(false);
    tracker.recordClaim("interactive");
    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 0,
      waitViolations: 2
    });
    tracker.updateRepairReady(true);
    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 3,
      waitViolations: 3
    });
  });

  it("does not report a violation when repair is claimed at the wait boundary", () => {
    const onWaitViolation = vi.fn();
    const tracker = createUnifiedRepairServiceTracker({
      repairMaxWaitChunks: 2,
      onWaitViolation
    });
    tracker.updateRepairReady(true);
    tracker.recordClaim("interactive");
    tracker.recordClaim("interactive");
    tracker.recordClaim("repair");

    expect(tracker.snapshot()).toMatchObject({
      chunksSinceLastRepair: 0,
      waitViolations: 0
    });
    expect(onWaitViolation).not.toHaveBeenCalled();
  });

  it("keeps a repair claim successful when the anomaly event sink throws", () => {
    const tracker = createUnifiedRepairServiceTracker({
      repairMaxWaitChunks: 0,
      onWaitViolation() {
        throw new Error("event sink unavailable");
      }
    });
    tracker.updateRepairReady(true);

    expect(() => tracker.recordClaim("interactive")).not.toThrow();
    expect(tracker.snapshot().waitViolations).toBe(1);
  });

  it("samples actual DB operation latency separately from controller wall time", () => {
    const sampler = createUnifiedDbLatencySampler();
    sampler.record(5);
    sampler.record(20);
    expect(sampler.sampleAndReset()).toBe(20);
    expect(sampler.sampleAndReset()).toBe(0);
  });

  it("returns the decision-time limiting reason and ignores a throwing observer", async () => {
    const setPoolTarget = vi.fn();
    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 1, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "a",
        state: "healthy",
        concurrencyLimit: 1,
        inFlight: 0,
        cooldownUntil: null
      }],
      resources: normalResources,
      thresholds,
      config: {
        configuredProviderConcurrencyLimit: 1,
        providerWorkerLimit: 1,
        providerIncreaseStep: 1,
        providerIncreaseIntervalMs: 1,
        analysisConcurrencyLimit: 1,
        finalizationConcurrencyLimit: 1,
        admissionPolicy: "rolling",
        lookaheadFactor: 1,
        perRunLookaheadMaximum: 2,
        readyBufferMaxEntries: 2,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.1,
        repairMaxSlots: 1,
        repairMaxWaitChunks: 2,
        chunksSinceLastRepair: 0
      },
      demand: [demand("run-idle", "owner-idle", 0)],
      refill: async () => ({
        admittedTaskIds: [],
        deAdmittedTaskIds: [],
        blocker: null
      }),
      setPoolTarget,
      wakePool: vi.fn(),
      onDecision() {
        throw new Error("metrics exporter unavailable");
      }
    });

    expect(result.limitingReason).toEqual({
      scope: "pool",
      code: "no_eligible_work"
    });
    expect(result.actualActiveProviderSlots).toBe(0);
    expect(result.runDecisions).toEqual([expect.objectContaining({
      runId: "run-idle",
      fairShare: 0,
      blocker: {
        scope: "run",
        code: "no_eligible_work"
      }
    })]);
    expect(setPoolTarget).toHaveBeenCalledWith(0);
  });
});
