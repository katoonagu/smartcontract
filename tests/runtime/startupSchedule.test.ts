import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStartupWorkSchedule,
  startStartupWorkSchedule,
  type StartupWorkLabel
} from "../../src/runtime/startupSchedule";

const labels: StartupWorkLabel[] = ["poll", "where_forensic", "incoming_deposit", "deep_forensic"];

function buildWork() {
  return Object.fromEntries(labels.map((label) => [label, vi.fn(async () => undefined)])) as Record<
    StartupWorkLabel,
    ReturnType<typeof vi.fn<() => Promise<void>>>
  >;
}

describe("startup work schedule", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default config-like delays in startup order", () => {
    expect(buildStartupWorkSchedule({
      pollStartDelayMs: 5_000,
      forensicWhereStartDelayMs: 3_000,
      forensicIncomingStartDelayMs: 6_000,
      forensicDeepStartDelayMs: 12_000
    })).toEqual([
      { label: "poll", delayMs: 5_000 },
      { label: "where_forensic", delayMs: 3_000 },
      { label: "incoming_deposit", delayMs: 6_000 },
      { label: "deep_forensic", delayMs: 12_000 }
    ]);
  });

  it("does not run workers before their configured start delays", async () => {
    vi.useFakeTimers();
    const startupWork = buildWork();
    const schedule = buildStartupWorkSchedule({
      pollStartDelayMs: 10,
      forensicWhereStartDelayMs: 25,
      forensicIncomingStartDelayMs: 50,
      forensicDeepStartDelayMs: 75
    });

    startStartupWorkSchedule({
      schedule,
      startupWork,
      intervalByLabel: {
        poll: 100,
        where_forensic: 100,
        incoming_deposit: 100,
        deep_forensic: 100
      },
      onError: vi.fn()
    });

    expect(startupWork.poll).not.toHaveBeenCalled();
    expect(startupWork.where_forensic).not.toHaveBeenCalled();
    expect(startupWork.incoming_deposit).not.toHaveBeenCalled();
    expect(startupWork.deep_forensic).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(24);
    expect(startupWork.poll).toHaveBeenCalledTimes(1);
    expect(startupWork.where_forensic).not.toHaveBeenCalled();
    expect(startupWork.incoming_deposit).not.toHaveBeenCalled();
    expect(startupWork.deep_forensic).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(startupWork.where_forensic).toHaveBeenCalledTimes(1);
    expect(startupWork.incoming_deposit).not.toHaveBeenCalled();
    expect(startupWork.deep_forensic).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(startupWork.incoming_deposit).toHaveBeenCalledTimes(1);
    expect(startupWork.deep_forensic).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(startupWork.deep_forensic).toHaveBeenCalledTimes(1);
  });

  it("repeats workers after their interval and stops cleanly", async () => {
    vi.useFakeTimers();
    const startupWork = buildWork();
    const started = startStartupWorkSchedule({
      schedule: [{ label: "poll", delayMs: 10 }],
      startupWork,
      intervalByLabel: {
        poll: 25,
        where_forensic: 25,
        incoming_deposit: 25,
        deep_forensic: 25
      },
      onError: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(9);
    expect(startupWork.poll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(startupWork.poll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(startupWork.poll).toHaveBeenCalledTimes(2);

    started.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(startupWork.poll).toHaveBeenCalledTimes(2);
  });

  it("stops pending startup timers before workers run", async () => {
    vi.useFakeTimers();
    const startupWork = buildWork();
    const started = startStartupWorkSchedule({
      schedule: [{ label: "deep_forensic", delayMs: 50 }],
      startupWork,
      intervalByLabel: {
        poll: 25,
        where_forensic: 25,
        incoming_deposit: 25,
        deep_forensic: 25
      },
      onError: vi.fn()
    });

    started.stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(startupWork.deep_forensic).not.toHaveBeenCalled();
  });
});
