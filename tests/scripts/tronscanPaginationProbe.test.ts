import { describe, expect, it } from "vitest";
import { runWallClockCadence } from "../../scripts/tronscan-pagination-probe";

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("tronscan pagination probe RPS ramp scheduling", () => {
  it("starts work by wall-clock cadence without waiting for prior work to finish", async () => {
    let clockMs = 0;
    const startedAt: number[] = [];

    const results = await runWallClockCadence({
      items: [1, 2, 3],
      targetRps: 4,
      maxConcurrency: 3,
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
      runItem: async () => {
        startedAt.push(clockMs);
      }
    });

    expect(startedAt).toEqual([0, 250, 500]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
  });

  it("waits for an in-flight slot instead of creating unbounded work", async () => {
    let clockMs = 0;
    const startedAt: number[] = [];
    const releases: Array<() => void> = [];

    const run = runWallClockCadence({
      items: [1, 2, 3],
      targetRps: 10,
      maxConcurrency: 2,
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
      runItem: async (_, index) => {
        startedAt.push(clockMs);
        await new Promise<void>((resolve) => {
          releases[index] = resolve;
        });
      }
    });

    await flushMicrotasks();
    expect(startedAt).toEqual([0, 100]);

    releases[0]();
    await flushMicrotasks();
    expect(startedAt).toEqual([0, 100, 200]);

    releases[1]();
    releases[2]();
    const results = await run;
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
  });
});
