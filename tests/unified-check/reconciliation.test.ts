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
    const reconciliation = createUnifiedReconciliation({
      intervalMs: 30_000,
      runCycle
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
});
