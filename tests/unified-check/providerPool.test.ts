import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedProviderPool
} from "../../src/unifiedCheck/providerPool";
import {
  createTronscanScheduler
} from "../../src/tron/tronscanScheduler";
import {
  runUnifiedAdaptiveControllerCycle
} from "../../src/unifiedCheck/adaptiveRuntime";
import {
  createUnifiedPacingTracker
} from "../../src/unifiedCheck/adaptiveObservability";
import type {
  UnifiedProviderClaimPermit
} from "../../src/unifiedCheck/worker";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Unified resizable provider pool", () => {
  const permit: UnifiedProviderClaimPermit = {
    lane: "interactive",
    ownerId: "owner",
    runId: "run",
    canonicalHeadPreferred: true
  };

  it("classifies mixed current and stale permit assignments", () => {
    const pool = createUnifiedProviderPool({
      configuredLimit: 2,
      requiresPermit: true,
      runCycle: async () => ({ claimed: false }),
      onError: vi.fn()
    });

    expect(pool.assignPermits([{
      slotId: 0,
      expectedEpoch: 0,
      permit
    }, {
      slotId: 1,
      expectedEpoch: 1,
      permit
    }])).toEqual({
      accepted: [{ slotId: 0, expectedEpoch: 0, permit }],
      rejected: [{
        assignment: { slotId: 1, expectedEpoch: 1, permit },
        reason: "stale_epoch"
      }]
    });
  });

  it("classifies draining, active, and pending assignment guards", async () => {
    const activeCycle = deferred<{ claimed: boolean }>();
    const activePool = createUnifiedProviderPool({
      configuredLimit: 1,
      requiresPermit: true,
      runCycle: async () => activeCycle.promise,
      onError: vi.fn()
    });
    const assignment = { slotId: 0, expectedEpoch: 0, permit };
    expect(activePool.assignPermits([assignment]).accepted).toEqual([
      assignment
    ]);
    activePool.setTargetSlots(1);
    activePool.wake();
    await vi.waitFor(() => expect(activePool.slotSnapshots()[0]?.active)
      .toBe(true));
    expect(activePool.assignPermits([{
      ...assignment,
      expectedEpoch: 1
    }])).toEqual({
      accepted: [],
      rejected: [{
        assignment: { ...assignment, expectedEpoch: 1 },
        reason: "slot_active"
      }]
    });
    activeCycle.resolve({ claimed: false });
    await activePool.waitForIdle();

    const pendingPool = createUnifiedProviderPool({
      configuredLimit: 1,
      requiresPermit: true,
      runCycle: async () => ({ claimed: false }),
      onError: vi.fn()
    });
    pendingPool.assignPermits([assignment]);
    expect(pendingPool.assignPermits([assignment])).toEqual({
      accepted: [],
      rejected: [{ assignment, reason: "pending_assignment" }]
    });

    const drainingPool = createUnifiedProviderPool({
      configuredLimit: 1,
      requiresPermit: true,
      runCycle: async () => ({ claimed: false }),
      onError: vi.fn()
    });
    await drainingPool.drain();
    expect(drainingPool.assignPermits([assignment])).toEqual({
      accepted: [],
      rejected: [{ assignment, reason: "draining" }]
    });
  });

  it("starts at target zero and resizes 0 -> 1 -> 4 -> 2 in place", async () => {
    const pending = Array.from({ length: 4 }, () =>
      deferred<{ claimed: boolean }>()
    );
    const runCycle = vi.fn((slotId: number) => pending[slotId]!.promise);
    const pool = createUnifiedProviderPool({
      configuredLimit: 4,
      runCycle,
      onError: vi.fn()
    });

    pool.wake();
    await Promise.resolve();
    expect(runCycle).not.toHaveBeenCalled();
    expect(pool.snapshot()).toEqual({
      configuredLimit: 4,
      targetSlots: 0,
      activeSlots: 0,
      idleSlots: 0
    });

    pool.setTargetSlots(1);
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    pool.setTargetSlots(4);
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(4));
    pool.setTargetSlots(2);

    expect(pool.snapshot()).toMatchObject({
      configuredLimit: 4,
      targetSlots: 2,
      activeSlots: 4,
      idleSlots: 0
    });
    pending.forEach((cycle) => cycle.resolve({ claimed: false }));
    await pool.waitForIdle();
    expect(pool.snapshot()).toEqual({
      configuredLimit: 4,
      targetSlots: 2,
      activeSlots: 0,
      idleSlots: 2
    });
  });

  it("does not cancel cycles already active when the target decreases", async () => {
    const pending = Array.from({ length: 4 }, () =>
      deferred<{ claimed: boolean }>()
    );
    const completed: number[] = [];
    const pool = createUnifiedProviderPool({
      configuredLimit: 4,
      async runCycle(slotId) {
        const result = await pending[slotId]!.promise;
        completed.push(slotId);
        return result;
      },
      onError: vi.fn()
    });

    pool.setTargetSlots(4);
    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(4));
    pool.setTargetSlots(2);
    await Promise.resolve();
    expect(completed).toEqual([]);
    expect(pool.snapshot().activeSlots).toBe(4);

    pending[2]!.resolve({ claimed: false });
    pending[3]!.resolve({ claimed: false });
    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(2));
    expect(completed.sort()).toEqual([2, 3]);

    pending[0]!.resolve({ claimed: false });
    pending[1]!.resolve({ claimed: false });
    await pool.waitForIdle();
  });

  it("does not replace completed claimed cycles above a lowered target", async () => {
    const pending = Array.from({ length: 4 }, () =>
      deferred<{ claimed: boolean }>()
    );
    const perSlotCalls = new Map<number, number>();
    const pool = createUnifiedProviderPool({
      configuredLimit: 4,
      async runCycle(slotId) {
        perSlotCalls.set(slotId, (perSlotCalls.get(slotId) ?? 0) + 1);
        if ((perSlotCalls.get(slotId) ?? 0) === 1) {
          return pending[slotId]!.promise;
        }
        return { claimed: false };
      },
      onError: vi.fn()
    });

    pool.setTargetSlots(4);
    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(4));
    pool.setTargetSlots(2);
    pending[2]!.resolve({ claimed: true });
    pending[3]!.resolve({ claimed: true });
    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(2));

    expect(perSlotCalls.get(2)).toBe(1);
    expect(perSlotCalls.get(3)).toBe(1);
    pending[0]!.resolve({ claimed: false });
    pending[1]!.resolve({ claimed: false });
    await pool.waitForIdle();
  });

  it("starts no new low-id claim while old high-id cycles exceed the lowered target", async () => {
    const pending = Array.from({ length: 4 }, () =>
      deferred<{ claimed: boolean }>()
    );
    const perSlotCalls = new Map<number, number>();
    const pool = createUnifiedProviderPool({
      configuredLimit: 4,
      async runCycle(slotId) {
        perSlotCalls.set(slotId, (perSlotCalls.get(slotId) ?? 0) + 1);
        if ((perSlotCalls.get(slotId) ?? 0) === 1) {
          return pending[slotId]!.promise;
        }
        return { claimed: false };
      },
      onError: vi.fn()
    });

    pool.setTargetSlots(4);
    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(4));
    pool.setTargetSlots(2);
    pending[0]!.resolve({ claimed: true });

    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(3));
    expect(perSlotCalls.get(0)).toBe(1);
    expect(perSlotCalls.get(1)).toBe(1);
    expect(perSlotCalls.get(2)).toBe(1);
    expect(perSlotCalls.get(3)).toBe(1);

    pending[1]!.resolve({ claimed: false });
    pending[2]!.resolve({ claimed: false });
    pending[3]!.resolve({ claimed: false });
    await pool.waitForIdle();
  });

  it("raising a target starts only the missing number of loops", async () => {
    const pending = Array.from({ length: 4 }, () =>
      deferred<{ claimed: boolean }>()
    );
    const runCycle = vi.fn((slotId: number) => pending[slotId]!.promise);
    const pool = createUnifiedProviderPool({
      configuredLimit: 4,
      runCycle,
      onError: vi.fn()
    });

    pool.setTargetSlots(1);
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    pool.setTargetSlots(4);
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(4));
    expect(runCycle.mock.calls.map(([slotId]) => slotId).sort())
      .toEqual([0, 1, 2, 3]);

    pending.forEach((cycle) => cycle.resolve({ claimed: false }));
    await pool.waitForIdle();
  });

  it("latches and coalesces wakes while a target slot is active", async () => {
    const firstIdle = deferred<{ claimed: boolean }>();
    let admitted = false;
    let claims = 0;
    const runCycle = vi.fn(async () => {
      if (runCycle.mock.calls.length === 1) return firstIdle.promise;
      if (admitted) {
        admitted = false;
        claims += 1;
        return { claimed: true };
      }
      return { claimed: false };
    });
    const pool = createUnifiedProviderPool({
      configuredLimit: 1,
      runCycle,
      onError: vi.fn()
    });

    pool.setTargetSlots(1);
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    admitted = true;
    pool.wake();
    pool.wake();
    pool.wake();
    const idle = pool.waitForIdle();
    let idleObserved = false;
    void idle.then(() => {
      idleObserved = true;
    });
    await Promise.resolve();
    expect(idleObserved).toBe(false);

    firstIdle.resolve({ claimed: false });
    await idle;

    expect(claims).toBe(1);
    expect(runCycle).toHaveBeenCalledTimes(3);
    expect(pool.snapshot().activeSlots).toBe(0);
  });

  it("drains only after active cycles finish and starts no replacement", async () => {
    const pending = deferred<{ claimed: boolean }>();
    const runCycle = vi.fn(async () => pending.promise);
    const pool = createUnifiedProviderPool({
      configuredLimit: 1,
      runCycle,
      onError: vi.fn()
    });
    pool.setTargetSlots(1);
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));

    const draining = pool.drain();
    let drained = false;
    void draining.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    pending.resolve({ claimed: true });
    await draining;
    pool.wake();
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(pool.snapshot()).toEqual({
      configuredLimit: 1,
      targetSlots: 0,
      activeSlots: 0,
      idleSlots: 0
    });
  });

  it("can yield after exactly one claimed bounded chunk in production mode", async () => {
    const runCycle = vi.fn(async () => ({ claimed: true }));
    const pool = createUnifiedProviderPool({
      configuredLimit: 1,
      runCycle,
      yieldAfterClaim: true,
      onError: vi.fn()
    });

    pool.setTargetSlots(1);
    await pool.waitForIdle();

    expect(runCycle).toHaveBeenCalledOnce();
    expect(pool.snapshot()).toMatchObject({
      targetSlots: 1,
      activeSlots: 0
    });
  });

  it("rejects stale permits during a chunk and reallocates the idle boundary slot from repair to interactive", async () => {
    const repairChunk = deferred<{ claimed: boolean }>();
    const firstInteractiveChunk = deferred<{ claimed: boolean }>();
    const secondInteractiveChunk = deferred<{ claimed: boolean }>();
    const cycles: Array<{
      slotId: number;
      permit: UnifiedProviderClaimPermit;
    }> = [];
    const boundaries: number[] = [];
    const pool = createUnifiedProviderPool({
      configuredLimit: 2,
      requiresPermit: true,
      yieldAfterClaim: true,
      runCycle(slotId, assignment) {
        if (!assignment) throw new Error("missing_assignment");
        cycles.push({ slotId, permit: assignment.permit });
        if (assignment.permit.lane === "repair") {
          return repairChunk.promise;
        }
        return cycles.filter((cycle) =>
          cycle.permit.lane === "interactive"
        ).length === 1
          ? firstInteractiveChunk.promise
          : secondInteractiveChunk.promise;
      },
      onSlotBoundary(snapshot) {
        boundaries.push(snapshot.slotId);
      },
      onError: vi.fn()
    });
    const initial = pool.slotSnapshots();
    pool.assignPermits([
      {
        slotId: 0,
        expectedEpoch: initial[0]!.epoch,
        permit: {
          lane: "repair",
          ownerId: "owner",
          runId: "run",
          canonicalHeadPreferred: false
        }
      },
      {
        slotId: 1,
        expectedEpoch: initial[1]!.epoch,
        permit: {
          lane: "interactive",
          ownerId: "owner",
          runId: "run",
          canonicalHeadPreferred: true
        }
      }
    ]);
    pool.setTargetSlots(2);
    await vi.waitFor(() => expect(cycles).toHaveLength(2));

    const controllerCycle = () => runUnifiedAdaptiveControllerCycle({
      nowMs: 2_000,
      rampState: { target: 2, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "a",
        state: "healthy" as const,
        concurrencyLimit: 2,
        inFlight: 0,
        cooldownUntil: null
      }],
      providerSlots: pool.slotSnapshots(),
      resources: {
        rssBytes: 100,
        heapUsedBytes: 50,
        availableMemoryBytes: 10_000,
        dbWaitingCount: 0,
        dbLatencyMs: 1,
        checkpointLatencyMs: 1
      },
      thresholds: {
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
      },
      config: {
        configuredProviderConcurrencyLimit: 2,
        providerWorkerLimit: 2,
        providerIncreaseStep: 2,
        providerIncreaseIntervalMs: 1,
        analysisConcurrencyLimit: 1,
        finalizationConcurrencyLimit: 1,
        admissionPolicy: "rolling" as const,
        lookaheadFactor: 1,
        perRunLookaheadMaximum: 2,
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.5,
        repairMaxSlots: 1,
        repairMaxWaitChunks: 2,
        chunksSinceLastRepair: 0
      },
      demand: [
        {
          runId: "run",
          ownerId: "owner",
          lane: "repair" as const,
          eligibleReadyWork: 2,
          ownerLastServedAtMs: 0,
          lastServedAtMs: 0,
          mergeBufferFull: false,
          providerAvailable: true,
          resourceGuarded: false,
          canonicalHeadEligible: false
        },
        {
          runId: "run",
          ownerId: "owner",
          lane: "interactive" as const,
          eligibleReadyWork: 2,
          ownerLastServedAtMs: 0,
          lastServedAtMs: 0,
          mergeBufferFull: false,
          providerAvailable: true,
          resourceGuarded: false,
          canonicalHeadEligible: true
        }
      ],
      refill: async () => ({
        admittedTaskIds: [],
        deAdmittedTaskIds: [],
        blocker: null
      }),
      countActionableProviderWork: async (scopes) =>
        scopes.map((scope) => ({ ...scope, count: 2 })),
      assignProviderPermits: (assignments) =>
        pool.assignPermits(assignments),
      setPoolTarget: (target) => pool.setTargetSlots(target),
      wakePool: () => pool.wake()
    });

    const duringChunk = await controllerCycle();
    pool.wake();
    expect(duringChunk.claimPermits).toEqual([]);
    expect(cycles).toHaveLength(2);

    firstInteractiveChunk.resolve({ claimed: true });
    await vi.waitFor(() =>
      expect(pool.slotSnapshots()[1]).toMatchObject({
        active: false,
        epoch: 2
      })
    );
    expect(cycles).toHaveLength(2);
    const afterBoundary = await controllerCycle();
    await vi.waitFor(() => expect(cycles).toHaveLength(3));
    expect(afterBoundary.claimPermits).toEqual([
      expect.objectContaining({
        lane: "interactive",
        canonicalHeadPreferred: true
      })
    ]);
    expect(cycles.filter((cycle) =>
      cycle.permit.lane === "repair"
    )).toHaveLength(1);
    expect(cycles[2]).toMatchObject({
      slotId: 1,
      permit: { lane: "interactive" }
    });

    repairChunk.resolve({ claimed: true });
    secondInteractiveChunk.resolve({ claimed: true });
    await pool.waitForIdle();
    expect(boundaries.sort()).toEqual([0, 1, 1]);
  });

  it("blocks only when every active slot identity is paced and ignores a reused epoch", async () => {
    let now = 1_000;
    const pacingGate = deferred<void>();
    const secondSlotGate = deferred<void>();
    const reusedSlotGate = deferred<{ claimed: boolean }>();
    const tracker = createUnifiedPacingTracker();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 100,
      rateLimitCooldownMs: 0,
      now: () => now,
      delay: async (ms) => {
        await pacingGate.promise;
        now += ms;
      },
      onPacingObservation: (observer) => tracker.paced(observer),
      onObserverSettled: (observer) => tracker.settled(observer)
    });
    await scheduler.schedule({
      requestName: "primer",
      path: "/primer"
    }, async () => "primer");

    const pool = createUnifiedProviderPool({
      configuredLimit: 2,
      requiresPermit: true,
      yieldAfterClaim: true,
      async runCycle(_slotId, assignment, slotIdentity) {
        if (!assignment) throw new Error("missing_assignment");
        if (slotIdentity.epoch === 3) return reusedSlotGate.promise;
        if (slotIdentity.slotId === 1) await secondSlotGate.promise;
        return scheduler.schedule({
          requestName: "transfer",
          path: `/transfer/${slotIdentity.slotId}`,
          observationScope: "unified",
          observationRunId: assignment.permit.runId,
          observationSlotId: slotIdentity.slotId,
          observationSlotEpoch: slotIdentity.epoch
        }, async () => ({ claimed: true }));
      },
      onError: vi.fn()
    });
    const permit: UnifiedProviderClaimPermit = {
      lane: "interactive",
      ownerId: "owner",
      runId: "run",
      canonicalHeadPreferred: true
    };
    const decision = () => runUnifiedAdaptiveControllerCycle({
      nowMs: now,
      rampState: { target: 2, lastIncreaseAtMs: 0 },
      providerGroups: [{
        groupId: "a",
        state: "healthy",
        concurrencyLimit: 2,
        inFlight: 0,
        cooldownUntil: null
      }],
      providerSlots: pool.slotSnapshots(),
      isProviderSlotPaced: (slot) => tracker.isSlotPaced(slot),
      resources: {
        rssBytes: 100,
        heapUsedBytes: 50,
        availableMemoryBytes: 10_000,
        dbWaitingCount: 0,
        dbLatencyMs: 1,
        checkpointLatencyMs: 1
      },
      thresholds: {
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
      },
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
        readyBufferMaxEntries: 10,
        readyBufferMaxBytes: 1_000,
        reservedBufferMaxBytes: 1_000,
        reservationBytesPerTask: 10,
        repairShare: 0.5,
        repairMaxSlots: 1,
        repairMaxWaitChunks: 2,
        chunksSinceLastRepair: 0
      },
      demand: [{
        runId: "run",
        ownerId: "owner",
        lane: "interactive",
        eligibleReadyWork: 2,
        ownerLastServedAtMs: 0,
        lastServedAtMs: 0,
        mergeBufferFull: false,
        providerAvailable: true,
        resourceGuarded: false,
        canonicalHeadEligible: true
      }],
      refill: async () => ({
        admittedTaskIds: [],
        deAdmittedTaskIds: [],
        blocker: null
      }),
      countActionableProviderWork: async () => [],
      setPoolTarget: vi.fn(),
      wakePool: vi.fn()
    });
    const blocker = async () =>
      (await decision()).runDecisions[0]?.blocker ?? null;

    const initial = pool.slotSnapshots();
    pool.assignPermits([{
      slotId: 0,
      expectedEpoch: initial[0]!.epoch,
      permit
    }]);
    pool.setTargetSlots(1);
    pool.wake();
    await vi.waitFor(() =>
      expect(tracker.isSlotPaced({
        runId: "run",
        slotId: 0,
        epoch: 1
      })).toBe(true)
    );
    await expect(blocker()).resolves.toEqual({
      scope: "run",
      code: "provider_rate_paced"
    });

    pool.assignPermits([{
      slotId: 1,
      expectedEpoch: initial[1]!.epoch,
      permit
    }]);
    pool.setTargetSlots(2);
    pool.wake();
    await vi.waitFor(() =>
      expect(pool.slotSnapshots()[1]).toMatchObject({
        active: true,
        epoch: 1
      })
    );
    await expect(blocker()).resolves.toBeNull();

    secondSlotGate.resolve();
    await vi.waitFor(() =>
      expect(tracker.isSlotPaced({
        runId: "run",
        slotId: 1,
        epoch: 1
      })).toBe(true)
    );
    await expect(blocker()).resolves.toEqual({
      scope: "run",
      code: "provider_rate_paced"
    });

    pacingGate.resolve();
    await pool.waitForIdle();
    expect(tracker.isSlotPaced({
      runId: "run",
      slotId: 0,
      epoch: 1
    })).toBe(false);
    tracker.paced({
      requestId: 999,
      scope: "unified",
      runId: "run",
      slotId: 0,
      epoch: 1
    });
    const afterBoundary = pool.slotSnapshots();
    pool.assignPermits([{
      slotId: 0,
      expectedEpoch: afterBoundary[0]!.epoch,
      permit
    }]);
    pool.setTargetSlots(1);
    pool.wake();
    await vi.waitFor(() =>
      expect(pool.slotSnapshots()[0]).toMatchObject({
        active: true,
        epoch: 3
      })
    );
    await expect(blocker()).resolves.toBeNull();

    reusedSlotGate.resolve({ claimed: true });
    await pool.waitForIdle();
  });
});
