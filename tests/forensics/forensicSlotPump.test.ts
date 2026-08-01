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
    expect(pump.diagnostics()).toEqual({
      activeSlots: 2,
      configuredSlots: 2,
      occupiedSlotsAtPoll: 0,
      stopping: false
    });
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

  it("serializes a handler-finally refill behind timer reconciliation", async () => {
    const first = deferred();
    const reconciliation = deferred();
    const jobs = [1, 2];
    const claimOne = vi.fn(async () => jobs.shift() ?? null);
    let polls = 0;
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {
        polls += 1;
        if (polls === 2) await reconciliation.promise;
      },
      claimOne,
      runClaimed: async (job) => {
        if (job === 1) await first.promise;
      },
      onHandlerError: vi.fn()
    });
    await pump.poll();
    const timerPoll = pump.poll();
    await flush();
    first.resolve();
    await flush();
    expect(claimOne).toHaveBeenCalledTimes(1);
    reconciliation.resolve();
    await timerPoll;
    await flush();
    expect(claimOne).toHaveBeenCalledTimes(3);
    expect(polls).toBe(2);
    await pump.stopAndDrain();
  });

  it("reports a failed fire-and-forget refill without an unhandled rejection", async () => {
    const first = deferred();
    const failure = new Error("claim failed");
    let claims = 0;
    const onHandlerError = vi.fn();
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne: async () => {
        claims += 1;
        if (claims === 1) return 1;
        throw failure;
      },
      runClaimed: async () => first.promise,
      onHandlerError
    });
    await pump.poll();
    first.resolve();
    await flush();
    expect(onHandlerError).toHaveBeenCalledWith(failure);
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

  it("retains the occupied-slot count from the last timer poll for fairness diagnostics", async () => {
    const first = deferred();
    const second = deferred();
    const jobs = [1];
    const pump = createForensicSlotPump({
      concurrency: 2,
      beforePoll: async () => {},
      claimOne: async () => jobs.shift() ?? null,
      runClaimed: async (job) => job === 1 ? first.promise : second.promise,
      onHandlerError: vi.fn()
    });

    await pump.poll();
    expect(pump.diagnostics().occupiedSlotsAtPoll).toBe(0);
    jobs.push(2);
    await pump.poll();
    expect(pump.diagnostics().occupiedSlotsAtPoll).toBe(1);
    await pump.poll();
    expect(pump.diagnostics().occupiedSlotsAtPoll).toBe(2);

    first.resolve();
    second.resolve();
    await pump.stopAndDrain();
  });

  it("leaves the filtered single-handler Deep and Incoming lanes independent", async () => {
    const where = deferred();
    const laneGates = { deep: deferred(), incoming: deferred() };
    const entered: string[] = [];
    const filters: string[][] = [];
    const active = { deep: 0, incoming: 0 };
    const maximum = { deep: 0, incoming: 0 };
    const jobsByKind = new Map([
      ["where_is_money_check", ["where"]],
      ["address_deep_check", ["deep"]],
      ["incoming_deposit_check", ["incoming"]]
    ]);
    const claimFiltered = async (kinds: string[]) => {
      filters.push(kinds);
      return jobsByKind.get(kinds[0])?.shift() ?? null;
    };
    const pump = createForensicSlotPump({
      concurrency: 1,
      beforePoll: async () => {},
      claimOne: () => claimFiltered(["where_is_money_check"]),
      runClaimed: async () => {
        entered.push("where");
        await where.promise;
      },
      onHandlerError: vi.fn()
    });
    await pump.poll();

    const runFakeLegacyCycle = async (lane: "deep" | "incoming", kind: string) => {
      const claimed = await claimFiltered([kind]);
      if (!claimed) return false;
      active[lane] += 1;
      maximum[lane] = Math.max(maximum[lane], active[lane]);
      entered.push(lane);
      await laneGates[lane].promise;
      active[lane] -= 1;
      return true;
    };
    const deepCycle = runFakeLegacyCycle("deep", "address_deep_check");
    const incomingCycle = runFakeLegacyCycle("incoming", "incoming_deposit_check");
    await flush();
    expect(entered).toEqual(["where", "deep", "incoming"]);
    expect(filters).toEqual([
      ["where_is_money_check"],
      ["address_deep_check"],
      ["incoming_deposit_check"]
    ]);
    expect(maximum).toEqual({ deep: 1, incoming: 1 });

    laneGates.deep.resolve();
    laneGates.incoming.resolve();
    await Promise.all([
      deepCycle,
      incomingCycle
    ]);
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
