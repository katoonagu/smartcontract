import { describe, expect, it } from "vitest";
import { createIncomingDepositTiming } from "../../src/forensics/incomingDepositTiming";

describe("createIncomingDepositTiming", () => {
  it("records measured async stages with deterministic durations", async () => {
    let current = 10;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    const result = await timing.measure("build_report", async () => {
      current = 35;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(timing.summary({
      queueWaitMs: 1000,
      depositAgeAtStartMs: 2000
    })).toEqual({
      queueWaitMs: 1000,
      depositAgeAtStartMs: 2000,
      totalRunMs: 25,
      stages: [
        { name: "build_report", durationMs: 25 }
      ]
    });
  });

  it("aggregates repeated stage names", async () => {
    let current = 0;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    await timing.measure("fetch_edges", async () => {
      current = 10;
    });
    await timing.measure("fetch_edges", async () => {
      current = 25;
    });

    expect(timing.summary({ queueWaitMs: null, depositAgeAtStartMs: null }).stages).toEqual([
      { name: "fetch_edges", durationMs: 25 }
    ]);
  });

  it("sorts top stages by duration descending", async () => {
    let current = 0;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    await timing.measure("short", async () => {
      current = 5;
    });
    await timing.measure("long", async () => {
      current = 30;
    });
    await timing.measure("medium", async () => {
      current = 40;
    });

    expect(timing.topStages(2)).toEqual([
      { name: "long", durationMs: 25 },
      { name: "medium", durationMs: 10 }
    ]);
  });

  it("keeps thrown errors and still records the failed stage duration", async () => {
    let current = 0;
    const timing = createIncomingDepositTiming({
      nowMs: () => current
    });

    await expect(timing.measure("send_alert", async () => {
      current = 12;
      throw new Error("telegram unavailable");
    })).rejects.toThrow("telegram unavailable");

    expect(timing.summary({ queueWaitMs: null, depositAgeAtStartMs: null }).stages).toEqual([
      { name: "send_alert", durationMs: 12 }
    ]);
  });

  it("normalizes summary queueWait and depositAge values", () => {
    const timing = createIncomingDepositTiming({
      nowMs: () => 10
    });

    const summary = timing.summary({
      queueWaitMs: 1500.7,
      depositAgeAtStartMs: -12
    });

    expect(summary.queueWaitMs).toBe(1501);
    expect(summary.depositAgeAtStartMs).toBe(0);

    const nullSummary = timing.summary({
      queueWaitMs: null,
      depositAgeAtStartMs: null
    });

    expect(nullSummary.queueWaitMs).toBe(null);
    expect(nullSummary.depositAgeAtStartMs).toBe(null);
  });
});
