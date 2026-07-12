import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADDRESS_POISONING_INTERVAL_MS,
  buildStartupWorkSchedule,
  createNonOverlappingStartupWork,
  startStartupWorkSchedule,
  type StartupWorkLabel
} from "../../src/runtime/startupSchedule";

const labels: StartupWorkLabel[] = [
  "poll",
  "where_forensic",
  "incoming_deposit",
  "deep_forensic",
  "address_index",
  "address_poisoning"
];

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
      { label: "deep_forensic", delayMs: 12_000 },
      { label: "address_index", delayMs: 12_000 },
      { label: "address_poisoning", delayMs: 5_000 }
    ]);
    expect(ADDRESS_POISONING_INTERVAL_MS).toBe(30_000);
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
        deep_forensic: 100,
        address_index: 100,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
      },
      onError: vi.fn()
    });

    expect(startupWork.poll).not.toHaveBeenCalled();
    expect(startupWork.where_forensic).not.toHaveBeenCalled();
    expect(startupWork.incoming_deposit).not.toHaveBeenCalled();
    expect(startupWork.deep_forensic).not.toHaveBeenCalled();
    expect(startupWork.address_index).not.toHaveBeenCalled();
    expect(startupWork.address_poisoning).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(24);
    expect(startupWork.poll).toHaveBeenCalledTimes(1);
    expect(startupWork.address_poisoning).toHaveBeenCalledTimes(1);
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
    expect(startupWork.address_index).toHaveBeenCalledTimes(1);
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
        deep_forensic: 25,
        address_index: 25,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
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
        deep_forensic: 25,
        address_index: 25,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
      },
      onError: vi.fn()
    });

    started.stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(startupWork.deep_forensic).not.toHaveBeenCalled();
  });

  it("skips overlapping poisoning ticks without returning the active promise and runs again after settle", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = vi.fn()
      .mockImplementationOnce(async () => held)
      .mockResolvedValue(undefined);
    const guarded = createNonOverlappingStartupWork(worker);

    const first = guarded.run();
    const overlap = guarded.run();
    expect(overlap).not.toBe(first);
    await expect(overlap).resolves.toBeUndefined();
    expect(worker).toHaveBeenCalledTimes(1);
    expect(guarded.active()).toBe(first);

    release();
    await first;
    expect(guarded.active()).toBeNull();

    await guarded.run();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("clears the active poisoning cycle after an error so a later tick recovers", async () => {
    const worker = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue(undefined);
    const guarded = createNonOverlappingStartupWork(worker);

    await expect(guarded.run()).rejects.toThrow("provider unavailable");
    expect(guarded.active()).toBeNull();
    await expect(guarded.run()).resolves.toBeUndefined();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("reports one poisoning cycle error through the schedule and runs the next interval", async () => {
    vi.useFakeTimers();
    let rejectFirst!: (error: Error) => void;
    const heldFailure = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const worker = vi.fn()
      .mockImplementationOnce(async () => heldFailure)
      .mockResolvedValue(undefined);
    const guarded = createNonOverlappingStartupWork(worker);
    const startupWork: Record<StartupWorkLabel, () => Promise<void>> = {
      ...buildWork(),
      address_poisoning: guarded.run
    };
    const onError = vi.fn();
    const started = startStartupWorkSchedule({
      schedule: [{ label: "address_poisoning", delayMs: 0 }],
      startupWork,
      intervalByLabel: {
        poll: 60_000,
        where_forensic: 60_000,
        incoming_deposit: 60_000,
        deep_forensic: 60_000,
        address_index: 60_000,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
      },
      initialErrorEventByLabel: { address_poisoning: "initial_address_poisoning_cycle_failed" },
      intervalErrorEventByLabel: { address_poisoning: "address_poisoning_cycle_failed" },
      onError
    });

    await vi.advanceTimersByTimeAsync(3 * ADDRESS_POISONING_INTERVAL_MS);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    rejectFirst(new Error("temporary provider error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(
      "initial_address_poisoning_cycle_failed",
      expect.objectContaining({ message: "temporary provider error" }),
      "address_poisoning"
    );
    await vi.advanceTimersByTimeAsync(ADDRESS_POISONING_INTERVAL_MS);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    started.stop();
  });

  it("does not start a new poisoning cycle after shutdown and exposes the active one to await", async () => {
    vi.useFakeTimers();
    let shuttingDown = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = vi.fn(async () => held);
    const guarded = createNonOverlappingStartupWork(worker, () => shuttingDown);
    const startupWork: Record<StartupWorkLabel, () => Promise<void>> = {
      ...buildWork(),
      address_poisoning: guarded.run
    };
    const started = startStartupWorkSchedule({
      schedule: [{ label: "address_poisoning", delayMs: 0 }],
      startupWork,
      intervalByLabel: {
        poll: 60_000,
        where_forensic: 60_000,
        incoming_deposit: 60_000,
        deep_forensic: 60_000,
        address_index: 60_000,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
      },
      onError: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(0);
    const active = guarded.active();
    expect(active).not.toBeNull();
    shuttingDown = true;
    started.stop();
    expect(guarded.run()).not.toBe(active);
    release();
    await active!;
    await guarded.run();
    await vi.advanceTimersByTimeAsync(2 * ADDRESS_POISONING_INTERVAL_MS);

    expect(worker).toHaveBeenCalledTimes(1);
    expect(guarded.active()).toBeNull();
  });
});
