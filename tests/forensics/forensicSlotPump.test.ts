import { describe, expect, it, vi } from "vitest";
import { createForensicSlotPump } from "../../src/forensics/forensicSlotPump";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("createForensicSlotPump", () => {
  it("concurrency one preserves head-of-line blocking and keeps no pending queue", async () => {
    const first = deferred();
    const started: number[] = [];
    const jobs = [1, 2];
    const claimOne = vi.fn(async () => jobs.shift() ?? null);
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne,
      runClaimed: async (job) => {
        started.push(job);
        if (job === 1) await first.promise;
      },
      onHandlerError: vi.fn()
    });

    await pump.poll();
    expect(started).toEqual([1]);
    expect(claimOne).toHaveBeenCalledTimes(1);
    first.resolve();
    await flush();
    expect(started).toEqual([1, 2]);
    await pump.stopAndDrain();
  });

  it("concurrency two starts independent jobs and never exceeds capacity", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const jobs = [0, 1, 2];
    let active = 0;
    let maximum = 0;
    const pump = createForensicSlotPump({
      concurrency: 2,
      beforePoll: async () => {},
      claimOne: async () => jobs.shift() ?? null,
      runClaimed: async (job) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await gates[job].promise;
        active -= 1;
      },
      onHandlerError: vi.fn()
    });

    await pump.poll();
    expect(active).toBe(2);
    expect(pump.diagnostics()).toEqual({ activeSlots: 2, configuredSlots: 2, stopping: false });
    gates[0].resolve();
    await flush();
    expect(active).toBe(2);
    expect(maximum).toBe(2);
    gates[1].resolve();
    gates[2].resolve();
    await pump.stopAndDrain();
  });

  it("claims exactly one job for each free slot", async () => {
    const gate = deferred();
    const claimOne = vi.fn(async () => ({ id: claimOne.mock.calls.length }));
    const pump = createForensicSlotPump({
      concurrency: 2,
      beforePoll: async () => {},
      claimOne,
      runClaimed: async () => gate.promise,
      onHandlerError: vi.fn()
    });
    await pump.poll();
    await pump.poll();
    expect(claimOne).toHaveBeenCalledTimes(2);
    gate.resolve();
    await pump.stopAndDrain();
  });

  it("an empty claim waits for another timer poll instead of spinning", async () => {
    const claimOne = vi.fn(async () => null);
    const pump = createForensicSlotPump({
      concurrency: 2,
      beforePoll: async () => {},
      claimOne,
      runClaimed: async () => {},
      onHandlerError: vi.fn()
    });
    await pump.poll();
    await flush();
    expect(claimOne).toHaveBeenCalledTimes(1);
    await pump.poll();
    expect(claimOne).toHaveBeenCalledTimes(2);
  });

  it("isolates a rejected handler and immediately refills its slot", async () => {
    const error = new Error("boom");
    const jobs = [1, 2];
    const started: number[] = [];
    const onHandlerError = vi.fn();
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne: async () => jobs.shift() ?? null,
      runClaimed: async (job) => {
        started.push(job);
        if (job === 1) throw error;
      },
      onHandlerError
    });
    await pump.poll();
    await flush();
    expect(onHandlerError).toHaveBeenCalledWith(error);
    expect(started).toEqual([1, 2]);
    await pump.stopAndDrain();
  });

  it("coalesces timer and handler refills without over-claiming", async () => {
    const first = deferred();
    const second = deferred();
    const jobs = [1, 2];
    const claimOne = vi.fn(async () => jobs.shift() ?? null);
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne,
      runClaimed: async (job) => job === 1 ? first.promise : second.promise,
      onHandlerError: vi.fn()
    });
    await pump.poll();
    first.resolve();
    await Promise.all([pump.poll(), flush()]);
    expect(claimOne).toHaveBeenCalledTimes(2);
    expect(pump.diagnostics().activeSlots).toBe(1);
    second.resolve();
    await pump.stopAndDrain();
  });

  it("runs beforePoll once per timer poll but not for immediate refills", async () => {
    const first = deferred();
    const jobs = [1, 2];
    const beforePoll = vi.fn(async () => {});
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll,
      claimOne: async () => jobs.shift() ?? null,
      runClaimed: async (job) => {
        if (job === 1) await first.promise;
      },
      onHandlerError: vi.fn()
    });
    await pump.poll();
    first.resolve();
    await flush();
    expect(beforePoll).toHaveBeenCalledTimes(1);
    await pump.poll();
    expect(beforePoll).toHaveBeenCalledTimes(2);
    await pump.stopAndDrain();
  });

  it("does not block independent Deep and Incoming lanes", async () => {
    const where = deferred();
    const entered: string[] = [];
    const jobs = ["where"];
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne: async () => jobs.shift() ?? null,
      runClaimed: async () => {
        entered.push("where");
        await where.promise;
      },
      onHandlerError: vi.fn()
    });
    await pump.poll();
    await Promise.all([
      Promise.resolve().then(() => entered.push("deep")),
      Promise.resolve().then(() => entered.push("incoming"))
    ]);
    expect(entered).toEqual(["where", "deep", "incoming"]);
    where.resolve();
    await pump.stopAndDrain();
  });

  it("stopAndDrain blocks new claims and waits for pump and active handlers", async () => {
    const claim = deferred<number | null>();
    const handler = deferred();
    const claimOne = vi.fn(() => claim.promise);
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne,
      runClaimed: async () => handler.promise,
      onHandlerError: vi.fn()
    });
    const polling = pump.poll();
    await flush();
    expect(claimOne).toHaveBeenCalledTimes(1);
    const draining = pump.stopAndDrain();
    claim.resolve(1);
    await polling;
    let drained = false;
    void draining.then(() => { drained = true; });
    await flush();
    expect(drained).toBe(false);
    expect(claimOne).toHaveBeenCalledTimes(1);
    expect(pump.diagnostics().stopping).toBe(true);
    handler.resolve();
    await draining;
    await pump.poll();
    expect(claimOne).toHaveBeenCalledTimes(1);
  });

  it("validates capacity", () => {
    expect(() => createForensicSlotPump({
      concurrency: 0,
      beforePoll: async () => {},
      claimOne: async () => null,
      runClaimed: async () => {},
      onHandlerError: vi.fn()
    })).toThrow("forensic_slot_pump_concurrency_must_be_positive_integer");
  });
});
