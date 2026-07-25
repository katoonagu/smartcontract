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

describe("Unified resizable provider pool", () => {
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
});
