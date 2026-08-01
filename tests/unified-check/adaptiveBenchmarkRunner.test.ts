import { describe, expect, it, vi } from "vitest";
import {
  runUnifiedAdaptiveBenchmarkEvents,
  type UnifiedAdaptiveBenchmarkEventPlan
} from "../../src/unifiedCheck/adaptiveBenchmarkRunner";
import {
  runUnifiedAdaptiveControllerCycle
} from "../../src/unifiedCheck/adaptiveRuntime";

function plan(
  overrides: Partial<UnifiedAdaptiveBenchmarkEventPlan> = {}
): UnifiedAdaptiveBenchmarkEventPlan {
  return {
    capacity: 1,
    seed: 24_072_026,
    runs: [{
      runId: "run-a",
      ownerId: "owner-a",
      lane: "interactive",
      activeAtRound: 0,
      requests: [
        { id: "a-1", requestIdentity: "request-1" },
        { id: "a-2", requestIdentity: "request-2" }
      ]
    }],
    cooldownAtRound: null,
    restartAtRound: null,
    slowCanonicalHead: false,
    commitEveryRounds: 1,
    ...overrides
  };
}

describe("Unified adaptive benchmark deterministic event runner", () => {
  it("derives controller, replay, cooldown, restart, reconciliation and buffer metrics from executed transitions", async () => {
    const executeReplay = vi.fn(async (requestIdentity: string) => ({
      responseBytes: requestIdentity === "request-1" ? 120 : 80
    }));
    const result = await runUnifiedAdaptiveBenchmarkEvents({
      plan: plan({
        cooldownAtRound: 1,
        restartAtRound: 2,
        slowCanonicalHead: true,
        commitEveryRounds: 2
      }),
      executeReplay
    });

    expect(executeReplay).toHaveBeenCalledTimes(2);
    expect(result.capacity.actualSlots).toBeLessThanOrEqual(1);
    expect(result.capacity.targetSlots).toBeLessThanOrEqual(1);
    expect(result.provider.requests).toBe(3);
    expect(result.provider.errors).toBe(1);
    expect(result.provider.rateLimited429).toBe(1);
    expect(result.buffer.readyBytes).toBeGreaterThan(0);
    expect(result.buffer.reservedBytes).toBeGreaterThan(0);
    expect(result.restartRecovery).toMatchObject({
      restartCount: 1,
      reconciliationRecoveries: 1,
      duplicateCommits: 0,
      duplicateSequences: 0
    });
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "controller_cycle",
        "provider_429",
        "checkpoint",
        "restart",
        "reconciliation",
        "buffer_ready",
        "buffer_commit"
      ])
    );
  });

  it("does not infer metrics from an arbitrary scenario label", async () => {
    const executeReplay = async () => ({ responseBytes: 64 });
    const first = await runUnifiedAdaptiveBenchmarkEvents({
      plan: plan(),
      executeReplay
    });
    const renamed = await runUnifiedAdaptiveBenchmarkEvents({
      plan: plan(),
      executeReplay
    });

    expect(renamed).toEqual(first);
    expect(first.provider.errors).toBe(0);
    expect(first.restartRecovery.restartCount).toBe(0);
    expect(first.restartRecovery.reconciliationRecoveries).toBe(0);
  });

  it("rejects a mocked controller that over-assigns provider permits", async () => {
    await expect(runUnifiedAdaptiveBenchmarkEvents({
      plan: plan(),
      executeReplay: async () => ({ responseBytes: 64 }),
      runControllerCycle: async (cycleInput) => {
        const decision =
          await runUnifiedAdaptiveControllerCycle(cycleInput);
        if (!cycleInput.assignProviderPermits) {
          throw new Error("test_assign_provider_permits_missing");
        }
        cycleInput.assignProviderPermits([
          ...decision.claimAssignments,
          ...decision.claimAssignments.slice(0, 1)
        ]);
        return decision;
      }
    })).rejects.toThrow(
      "unified_benchmark_event_capacity_invariant"
    );
  });
});
