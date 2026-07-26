import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedAdaptiveEvent,
  createUnifiedAdaptiveObservability,
  createUnifiedAdaptiveSnapshotPublisher,
  createUnifiedPacingTracker,
  createUnifiedDecisionReason,
  classifyUnifiedProviderRequestOutcome,
  emitBestEffort,
  runUnifiedAdaptiveSnapshotPublication
} from "../../src/unifiedCheck/adaptiveObservability";

const aggregateInput = {
  nowMs: 60_000,
  provider: {
    capacityLimit: 8,
    readyDemand: 12,
    targetActiveSlots: 8,
    actualActiveSlots: 6,
    healthyGroups: 4,
    cooldownGroups: 1,
    circuitOpenGroups: 2
  },
  runtime: {
    state: "pressure" as const,
    limitingReason: {
      scope: "pool" as const,
      code: "db_pressure" as const
    }
  },
  memory: {
    rssBytes: 1_000,
    heapUsedBytes: 500,
    availableMemoryBytes: 10_000
  },
  database: {
    poolWaiting: 2,
    latencyMs: 20
  },
  checkpointLatencyMs: 30,
  planner: {
    durableBacklog: 7,
    admitted: 5,
    leased: 3,
    ready: 2,
    committed: 11
  },
  buffer: {
    readyCount: 2,
    readyBytes: 200,
    reservedBytes: 300
  },
  canonicalHeadAgeMs: 4_000,
  repair: {
    minimumSlots: 1,
    actualSlots: 1,
    waitViolations: 0
  }
};

describe("Unified adaptive observability", () => {
  it("keeps production snapshot SQL, export and warning failures nonfatal", async () => {
    const warn = vi.fn(() => {
      throw new Error("logger unavailable");
    });

    await expect(runUnifiedAdaptiveSnapshotPublication({
      load: async () => {
        throw new Error("database unavailable");
      },
      build: (storage) => storage,
      publish: vi.fn(),
      warn
    })).resolves.toBeUndefined();
    await expect(runUnifiedAdaptiveSnapshotPublication({
      load: async () => ({ planner: {} }),
      build: (storage) => storage,
      publish() {
        throw new Error("exporter unavailable");
      },
      warn
    })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("tracks pacing by exact request, run, slot and epoch", () => {
    const tracker = createUnifiedPacingTracker(4);
    const observer = (
      requestId: number,
      runId: string,
      slotId: number,
      epoch: number
    ) => ({
      requestId,
      scope: "unified" as const,
      runId,
      slotId,
      epoch
    });

    const first = observer(1, "same-run", 0, 1);
    const second = observer(2, "same-run", 1, 1);
    tracker.paced(first);
    tracker.paced(second);
    tracker.settled(first);
    expect(tracker.isSlotPaced(second)).toBe(true);
    expect(tracker.isSlotPaced({ ...first, epoch: 3 })).toBe(false);
    tracker.settled(second);
    expect(tracker.isSlotPaced(second)).toBe(false);

    const coalescedA = observer(20, "coalesced", 0, 1);
    const coalescedB = observer(20, "coalesced", 1, 1);
    tracker.paced(coalescedA);
    tracker.paced(coalescedB);
    tracker.settled(coalescedA);
    expect(tracker.isSlotPaced(coalescedA)).toBe(false);
    expect(tracker.isSlotPaced(coalescedB)).toBe(true);
    tracker.settled(coalescedB);

    const evicted = observer(3, "evicted-run", 0, 1);
    tracker.paced(evicted);
    tracker.paced(observer(4, "kept-run", 0, 1));
    tracker.paced(observer(5, "kept-run", 1, 1));
    tracker.paced(observer(6, "kept-run", 2, 1));
    tracker.paced(observer(7, "new-run", 3, 1));
    expect(tracker.isSlotPaced(evicted)).toBe(false);
  });
  it("projects the complete low-cardinality aggregate without operational identities", () => {
    const observability = createUnifiedAdaptiveObservability();
    observability.recordProviderRequest({
      atMs: 59_000,
      outcome: "success"
    });
    observability.recordProviderRequest({
      atMs: 59_500,
      outcome: "error"
    });
    observability.recordProviderRequest({
      atMs: 60_000,
      outcome: "rate_limited_429"
    });
    observability.recordReconciliation({ actionableWorkFound: true });

    const snapshot = observability.snapshot(aggregateInput);

    expect(snapshot).toEqual({
      version: "unified-adaptive-aggregate-v1",
      provider: {
        ...aggregateInput.provider,
        rolling60sRequests: 3,
        rolling60sRps: 0.05,
        requestsTotal: 3,
        errorsTotal: 2,
        rateLimited429Total: 1
      },
      runtime: aggregateInput.runtime,
      memory: aggregateInput.memory,
      database: aggregateInput.database,
      checkpointLatencyMs: 30,
      planner: aggregateInput.planner,
      buffer: aggregateInput.buffer,
      canonicalHeadAgeMs: 4_000,
      repair: aggregateInput.repair,
      reconciliation: {
        actionableTicks: 1
      }
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /runId|ownerId|address|taskId|providerKey|apiKey/iu
    );
  });

  it("keeps rolling request accounting bounded to exactly sixty second buckets", () => {
    const observability = createUnifiedAdaptiveObservability();
    for (let second = 0; second < 10_000; second += 1) {
      observability.recordProviderRequest({
        atMs: second * 1_000,
        outcome: "success"
      });
    }

    const snapshot = observability.snapshot({
      ...aggregateInput,
      nowMs: 9_999_000
    });

    expect(snapshot.provider.rolling60sRequests).toBe(60);
    expect(snapshot.provider.rolling60sRps).toBe(1);
    expect(snapshot.provider.requestsTotal).toBe(10_000);
  });

  it("validates stable decision scopes and the exact event allowlist", () => {
    expect(createUnifiedDecisionReason("run", "fairness_wait")).toEqual({
      scope: "run",
      code: "fairness_wait"
    });
    expect(() =>
      createUnifiedDecisionReason("pool", "fairness_wait")
    ).toThrow("unified_reason_scope_invalid");
    expect(() =>
      createUnifiedDecisionReason("pool", "background_preempted")
    ).toThrow("unified_reason_scope_invalid");
    expect(["pool", "run", "task"].map((scope) =>
      createUnifiedDecisionReason(
        scope as "pool" | "run" | "task",
        "checkpoint_or_commit"
      )
    )).toEqual([
      { scope: "pool", code: "checkpoint_or_commit" },
      { scope: "run", code: "checkpoint_or_commit" },
      { scope: "task", code: "checkpoint_or_commit" }
    ]);

    expect(createUnifiedAdaptiveEvent({
      type: "resource_state_changed",
      occurredAt: "2026-07-25T00:00:00.000Z",
      reason: createUnifiedDecisionReason("pool", "memory_pressure")
    })).toMatchObject({ type: "resource_state_changed" });
    expect(() => createUnifiedAdaptiveEvent({
      type: "scheduler_cycle_completed" as never,
      occurredAt: "2026-07-25T00:00:00.000Z"
    })).toThrow("unified_adaptive_event_type_invalid");
  });

  it("swallows synchronous event sink failures", () => {
    const sink = vi.fn(() => {
      throw new Error("exporter unavailable");
    });
    expect(() => emitBestEffort(sink, createUnifiedAdaptiveEvent({
      type: "reconciliation_recovered_work",
      occurredAt: "2026-07-25T00:00:00.000Z"
    }))).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();
  });

  it("publishes the latest aggregate even when the exporter fails", () => {
    const exporter = vi.fn(() => {
      throw new Error("exporter unavailable");
    });
    const publisher = createUnifiedAdaptiveSnapshotPublisher(exporter);
    const snapshot = createUnifiedAdaptiveObservability().snapshot(
      aggregateInput
    );

    expect(() => publisher.publish(snapshot)).not.toThrow();
    expect(publisher.current()).toBe(snapshot);
    expect(exporter).toHaveBeenCalledOnce();
  });

  it("classifies real provider outcomes without exposing request identity", () => {
    expect(classifyUnifiedProviderRequestOutcome(null)).toBe("success");
    expect(classifyUnifiedProviderRequestOutcome({
      status: 429
    })).toBe("rate_limited_429");
    expect(classifyUnifiedProviderRequestOutcome(
      new Error("provider request failed")
    )).toBe("error");
  });
});
