import { describe, expect, it } from "vitest";
import {
  createUnifiedFairTronscanScheduler,
  type TronscanScheduleContext
} from "../../src/tron/tronscanScheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const baseOptions = {
  requestMinIntervalMs: 0,
  rateLimitCooldownMs: 100,
  apiKeys: ["a", "b", "c", "d"],
  now: () => 1_000,
  delay: async () => undefined
};

describe("Unified fair TronScan scheduler", () => {
  it("round-robins active runs and caps one run at half the slots while another waits", async () => {
    const scheduler = createUnifiedFairTronscanScheduler(baseOptions);
    const gates = Array.from({ length: 8 }, () => deferred<void>());
    const starts: string[] = [];
    const scheduled = gates.map((gate, index) =>
      scheduler.schedule({
        runId: index < 4 ? "run-a" : "run-b",
        lane: "interactive",
        readyAtMs: 1_000,
        requestName: `task-${index}`,
        path: `/task-${index}`
      }, async () => {
        starts.push(index < 4 ? "run-a" : "run-b");
        await gate.promise;
      })
    );
    await flush();
    expect(starts).toEqual(["run-a", "run-b", "run-a", "run-b"]);
    expect(scheduler.diagnostics().inFlightByRun).toEqual({ "run-a": 2, "run-b": 2 });
    gates.forEach((gate) => gate.resolve());
    await Promise.all(scheduled);
  });

  it("lets an isolated run consume every free slot", async () => {
    const scheduler = createUnifiedFairTronscanScheduler(baseOptions);
    const gate = deferred<void>();
    let started = 0;
    const tasks = Array.from({ length: 4 }, (_, index) =>
      scheduler.schedule({
        runId: "run-alone",
        lane: "interactive",
        readyAtMs: 1_000,
        requestName: `alone-${index}`,
        path: `/alone-${index}`
      }, async () => {
        started += 1;
        await gate.promise;
      })
    );
    await flush();
    expect(started).toBe(4);
    gate.resolve();
    await Promise.all(tasks);
  });

  it("uses 8:2:1 weighted lanes and readyAt rather than creation order", async () => {
    let weightedNow = 1_000;
    const scheduler = createUnifiedFairTronscanScheduler({
      ...baseOptions,
      apiKeys: ["a"],
      maxInFlight: 1,
      now: () => weightedNow,
      delay: async (ms) => {
        weightedNow += ms;
      }
    });
    const order: string[] = [];
    const tasks = [
      ...Array.from({ length: 9 }, (_, index) => ({
        lane: "interactive" as const,
        name: `i${index}`,
        readyAtMs: 1_000
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        lane: "repair" as const,
        name: `r${index}`,
        readyAtMs: 1_000
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        lane: "background" as const,
        name: `b${index}`,
        readyAtMs: 1_000
      })),
      { lane: "background" as const, name: "late-created-first", readyAtMs: 2_000 },
      { lane: "background" as const, name: "ready-created-last", readyAtMs: 1_000 }
    ].map((item) =>
      scheduler.schedule({
        runId: `run-${item.name}`,
        lane: item.lane,
        readyAtMs: item.readyAtMs,
        requestName: item.name,
        path: `/${item.name}`
      }, async () => {
        order.push(item.name);
      })
    );
    await Promise.all(tasks.slice(0, 14));
    expect(order.slice(0, 11).filter((item) => item.startsWith("i"))).toHaveLength(8);
    expect(order.slice(0, 11).filter((item) => item.startsWith("r"))).toHaveLength(2);
    expect(order.slice(0, 11).filter((item) => item.startsWith("b"))).toHaveLength(1);
    await Promise.all(tasks);
    expect(order.indexOf("ready-created-last")).toBeLessThan(order.indexOf("late-created-first"));
  });

  it("moves ready work to a healthy key after a scoped 429", async () => {
    let now = 1_000;
    const scheduler = createUnifiedFairTronscanScheduler({
      ...baseOptions,
      apiKeys: ["key-a", "key-b"],
      now: () => now,
      delay: async (ms) => {
        now += ms;
      }
    });
    const used: Array<string | null> = [];
    const error = Object.assign(new Error("429"), { status: 429 });
    await expect(scheduler.schedule({
      runId: "run-a",
      lane: "interactive",
      readyAtMs: 1_000,
      requestName: "limited",
      path: "/limited",
      endpointBucket: "transfer"
    }, async (context: TronscanScheduleContext) => {
      used.push(context.apiKey);
      throw error;
    })).rejects.toThrow("429");
    await scheduler.schedule({
      runId: "run-b",
      lane: "interactive",
      readyAtMs: 1_000,
      requestName: "healthy",
      path: "/healthy",
      endpointBucket: "transfer"
    }, async (context) => {
      used.push(context.apiKey);
    });
    expect(used).toEqual(["key-a", "key-b"]);
  });

  it.each([8, 16])("accepts %i key slots without a config-shape change", (count) => {
    const scheduler = createUnifiedFairTronscanScheduler({
      ...baseOptions,
      apiKeys: Array.from({ length: count }, (_, index) => `key-${index}`)
    });
    expect(scheduler.diagnostics().slotCount).toBe(count);
  });
});
