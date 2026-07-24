import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedProviderPool
} from "../../src/unifiedCheck/providerPool";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Unified event-driven provider pool", () => {
  it("uses four slots and immediately drains newly available work", async () => {
    const firstRound = Array.from({ length: 4 }, () =>
      deferred<{ claimed: boolean }>()
    );
    const calls: number[] = [];
    const perSlotCalls = new Map<number, number>();
    const inFlight: number[] = [];
    const pool = createUnifiedProviderPool({
      slots: 4,
      async runCycle(slotId) {
        calls.push(slotId);
        const call = perSlotCalls.get(slotId) ?? 0;
        perSlotCalls.set(slotId, call + 1);
        if (call === 0) return firstRound[slotId]!.promise;
        return { claimed: false };
      },
      onError: vi.fn(),
      onInFlight: (current) => inFlight.push(current)
    });

    pool.wake();
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(new Set(calls)).toEqual(new Set([0, 1, 2, 3]));
    firstRound.forEach((pending) => pending.resolve({ claimed: true }));
    await pool.waitForIdle();

    expect(calls).toHaveLength(8);
    expect(Math.max(...inFlight)).toBe(4);
    expect(pool.snapshot()).toMatchObject({
      slots: 4,
      activeSlots: 0,
      stopped: false
    });
  });

  it("does not let a waiting slot pause the other slots", async () => {
    const waiting = deferred<{ claimed: boolean }>();
    const calls: number[] = [];
    const pool = createUnifiedProviderPool({
      slots: 2,
      async runCycle(slotId) {
        calls.push(slotId);
        if (slotId === 0 && calls.filter((item) => item === 0).length === 1) {
          return waiting.promise;
        }
        return { claimed: false };
      },
      onError: vi.fn()
    });

    pool.wake();
    await vi.waitFor(() => expect(calls).toContain(1));
    await vi.waitFor(() => expect(pool.snapshot().activeSlots).toBe(1));
    waiting.resolve({ claimed: false });
    await pool.waitForIdle();
  });

  it("stops without starting another claim", async () => {
    const pending = deferred<{ claimed: boolean }>();
    const runCycle = vi.fn(async () => pending.promise);
    const pool = createUnifiedProviderPool({
      slots: 1,
      runCycle,
      onError: vi.fn()
    });
    pool.wake();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    const stopping = pool.stop();
    pending.resolve({ claimed: true });
    await stopping;
    pool.wake();
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(pool.snapshot().stopped).toBe(true);
  });
});
