import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedReconciliation
} from "../../src/unifiedCheck/reconciliation";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Unified reconciliation", () => {
  it("coalesces wake signals and reruns once when a wake arrives during a cycle", async () => {
    const releases: Array<() => void> = [];
    const runCycle = vi.fn(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return {
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      };
    });
    const onWait = vi.fn();
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 30_000,
      runCycle,
      onWait
    });

    reconciliation.wake();
    reconciliation.wake();
    await flush();
    expect(runCycle).toHaveBeenCalledOnce();
    reconciliation.wake();
    reconciliation.wake();
    releases.shift()?.();
    await flush();
    expect(runCycle).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await reconciliation.waitForIdle();
    expect(onWait).toHaveBeenCalledWith({
      scope: "pool",
      code: "reconciliation_wait"
    });
  });

  it("lets a coalesced event wake dominate a timer tick without reporting recovery", async () => {
    const releases: Array<() => void> = [];
    const onAdaptiveEvent = vi.fn();
    const onResult = vi.fn();
    const runCycle = vi.fn(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return {
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      };
    });
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 30_000,
      runCycle,
      onResult,
      onAdaptiveEvent
    });

    reconciliation.wake();
    await flush();
    reconciliation.wake();
    const timerTick = reconciliation.tick();
    releases.shift()?.();
    await flush();
    releases.shift()?.();
    await timerTick;

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(onResult).not.toHaveBeenCalled();
    expect(onAdaptiveEvent).not.toHaveBeenCalled();
  });

  it("keeps an empty tick mutation-free and ignores observability failures", async () => {
    const runCycle = vi.fn(async () => ({
      actionableWorkFound: false,
      admitted: 0,
      wokenSlots: 0
    }));
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 30_000,
      runCycle,
      onResult() {
        throw new Error("exporter down");
      }
    });

    await expect(reconciliation.tick()).resolves.toEqual({
      actionableWorkFound: false,
      admitted: 0,
      wokenSlots: 0
    });
    expect(runCycle).toHaveBeenCalledOnce();
  });

  it("keeps recovered durable work successful when its event sink throws", async () => {
    const onAdaptiveEvent = vi.fn(() => {
      throw new Error("logger unavailable");
    });
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 60_000,
      runCycle: async () => ({
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      }),
      onAdaptiveEvent,
      now: () => new Date("2026-07-25T00:00:00.000Z")
    });

    await expect(reconciliation.tick()).resolves.toEqual({
      actionableWorkFound: true,
      admitted: 1,
      wokenSlots: 1
    });
    expect(onAdaptiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "reconciliation_recovered_work"
    }));
    expect(onAdaptiveEvent).toHaveBeenCalledOnce();
  });

  it("does not call a normal event wake a reconciliation recovery", async () => {
    const onAdaptiveEvent = vi.fn();
    const onResult = vi.fn();
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 60_000,
      runCycle: async () => ({
        actionableWorkFound: true,
        admitted: 1,
        wokenSlots: 1
      }),
      onResult,
      onAdaptiveEvent
    });

    reconciliation.wake();
    await reconciliation.waitForIdle();

    expect(onAdaptiveEvent).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
