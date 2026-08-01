import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeHandoffCoordinator
} from "../../src/runtime/runtimeHandoffCoordinator";
import type {
  UnifiedRuntimeInstanceV1
} from "../../src/unifiedCheck/runtimeHandoffRepository";

function runtime(
  state: UnifiedRuntimeInstanceV1["state"],
  overrides: Partial<UnifiedRuntimeInstanceV1> = {}
): UnifiedRuntimeInstanceV1 {
  return {
    instanceId: "runtime-a",
    runtimeCommit: "a".repeat(40),
    instanceLabel: "local-aaaaaaaa",
    state,
    startedAt: "2026-07-28T10:00:00.000Z",
    heartbeatAt: "2026-07-28T10:01:00.000Z",
    drainRequestedAt: state === "ACTIVE" ? null : "2026-07-28T10:00:00.000Z",
    drainDeadlineAt: state === "ACTIVE" ? null : "2026-07-28T12:00:00.000Z",
    telegramPollingReleasedAt:
      state === "DRAINING" || state === "STOPPED"
        ? "2026-07-28T10:00:01.000Z"
        : null,
    stoppedAt: state === "STOPPED" ? "2026-07-28T10:02:00.000Z" : null,
    failureReason: null,
    ...overrides
  };
}

function deps(state: UnifiedRuntimeInstanceV1["state"] = "ACTIVE") {
  let current = runtime(state);
  const events: string[] = [];
  const input = {
    now: () => new Date("2026-07-28T10:01:00.000Z"),
    heartbeat: vi.fn(async () => current),
    stopTelegramPolling: vi.fn(async () => { events.push("stop-telegram-polling"); }),
    stopAdminServer: vi.fn(async () => { events.push("stop-admin-server"); }),
    stopLegacySchedules: vi.fn(() => { events.push("stop-legacy-schedules"); }),
    markPollingReleased: vi.fn(async () => {
      events.push("mark-polling-released");
      current = runtime("DRAINING");
      return current;
    }),
    countCompatibleRuns: vi.fn(async () => 1),
    hasEquivalentActiveReplacement: vi.fn(async () => false),
    terminalizeExpiredCompatibleRuns: vi.fn(async () => undefined),
    markStopped: vi.fn(async () => undefined),
    requestGracefulExit: vi.fn(() => undefined),
    onEvent: vi.fn(() => undefined)
  };
  return { input, events, setCurrent: (next: UnifiedRuntimeInstanceV1) => { current = next; } };
}

describe("runtime handoff coordinator", () => {
  it("only heartbeats while active", async () => {
    const { input } = deps("ACTIVE");
    const coordinator = createRuntimeHandoffCoordinator(input);
    await coordinator.tick();
    expect(input.heartbeat).toHaveBeenCalledOnce();
    expect(input.stopTelegramPolling).not.toHaveBeenCalled();
    expect(coordinator.isDraining()).toBe(false);
  });

  it("releases polling before durable DRAINING and keeps Unified work alive", async () => {
    const { input, events } = deps("DRAIN_REQUESTED");
    const coordinator = createRuntimeHandoffCoordinator(input);
    await coordinator.tick();
    expect(events).toEqual([
      "stop-telegram-polling",
      "stop-admin-server",
      "stop-legacy-schedules",
      "mark-polling-released"
    ]);
    expect(input.countCompatibleRuns).toHaveBeenCalledOnce();
    expect(input.requestGracefulExit).not.toHaveBeenCalled();
    expect(coordinator.isDraining()).toBe(true);
  });

  it("does not repeat local stop effects when registry persistence retries", async () => {
    const { input } = deps("DRAIN_REQUESTED");
    input.markPollingReleased
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(runtime("DRAINING"));
    const coordinator = createRuntimeHandoffCoordinator(input);
    await expect(coordinator.tick()).rejects.toThrow("database unavailable");
    await expect(coordinator.tick()).resolves.toBeUndefined();
    expect(input.stopTelegramPolling).toHaveBeenCalledOnce();
    expect(input.stopAdminServer).toHaveBeenCalledOnce();
    expect(input.stopLegacySchedules).toHaveBeenCalledOnce();
    expect(input.markPollingReleased).toHaveBeenCalledTimes(2);
  });

  it("exits when compatible work is complete", async () => {
    const { input } = deps("DRAINING");
    input.countCompatibleRuns.mockResolvedValue(0);
    const coordinator = createRuntimeHandoffCoordinator(input);
    await coordinator.tick();
    expect(input.markStopped).toHaveBeenCalledWith(
      new Date("2026-07-28T10:01:00.000Z"),
      "graceful_exit"
    );
    expect(input.requestGracefulExit).toHaveBeenCalledOnce();
  });

  it("lets an equivalent active runtime resume and exits without cancellation", async () => {
    const { input } = deps("DRAINING");
    input.hasEquivalentActiveReplacement.mockResolvedValue(true);
    const coordinator = createRuntimeHandoffCoordinator(input);
    await coordinator.tick();
    expect(input.terminalizeExpiredCompatibleRuns).not.toHaveBeenCalled();
    expect(input.countCompatibleRuns).not.toHaveBeenCalled();
    expect(input.markStopped).toHaveBeenCalledOnce();
    expect(input.requestGracefulExit).toHaveBeenCalledOnce();
  });

  it("terminalizes only compatible work at the exact deadline", async () => {
    const { input, setCurrent } = deps("DRAINING");
    input.now = () => new Date("2026-07-28T12:00:00.000Z");
    setCurrent(runtime("DRAINING", {
      drainDeadlineAt: "2026-07-28T12:00:00.000Z"
    }));
    const coordinator = createRuntimeHandoffCoordinator(input);
    await coordinator.tick();
    expect(input.terminalizeExpiredCompatibleRuns).toHaveBeenCalledWith(
      new Date("2026-07-28T12:00:00.000Z")
    );
    expect(input.markStopped).toHaveBeenCalledOnce();
    expect(input.requestGracefulExit).toHaveBeenCalledOnce();
  });
});
