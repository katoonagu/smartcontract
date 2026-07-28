import type {
  UnifiedRuntimeInstanceV1
} from "../unifiedCheck/runtimeHandoffRepository";

export function createRuntimeHandoffCoordinator(input: {
  now(): Date;
  heartbeat(): Promise<UnifiedRuntimeInstanceV1>;
  stopTelegramPolling(): Promise<void>;
  stopAdminServer(): Promise<void>;
  stopLegacySchedules(): void;
  markPollingReleased(now: Date): Promise<UnifiedRuntimeInstanceV1>;
  countCompatibleRuns(): Promise<number>;
  hasEquivalentActiveReplacement(): Promise<boolean>;
  terminalizeExpiredCompatibleRuns(now: Date): Promise<void>;
  markStopped(
    now: Date,
    failureReason: "graceful_exit" | "shutdown_failure" | null
  ): Promise<void>;
  requestGracefulExit(): void;
  onEvent(event: string, fields?: Record<string, unknown>): void;
}): { tick(): Promise<void>; isDraining(): boolean } {
  let pollingStopped = false;
  let adminStopped = false;
  let legacyStopped = false;
  let drainObserved = false;
  let exitRequested = false;

  const finish = async (now: Date, event: string): Promise<void> => {
    if (exitRequested) return;
    await input.markStopped(now, "graceful_exit");
    input.onEvent(event);
    exitRequested = true;
    input.requestGracefulExit();
  };

  return {
    isDraining: () => pollingStopped || drainObserved,
    async tick(): Promise<void> {
      if (exitRequested) return;
      const now = input.now();
      if (!Number.isFinite(now.getTime())) {
        throw new TypeError("runtime_handoff_coordinator_clock_invalid");
      }
      let runtime = await input.heartbeat();
      if (runtime.state === "ACTIVE") return;
      if (runtime.state === "STOPPED") {
        exitRequested = true;
        input.requestGracefulExit();
        return;
      }

      drainObserved = true;
      if (runtime.state === "DRAIN_REQUESTED") {
        input.onEvent("runtime_drain_requested", {
          drainDeadlineAt: runtime.drainDeadlineAt
        });
        if (!pollingStopped) {
          await input.stopTelegramPolling();
          pollingStopped = true;
        }
        if (!adminStopped) {
          await input.stopAdminServer();
          adminStopped = true;
        }
        if (!legacyStopped) {
          input.stopLegacySchedules();
          legacyStopped = true;
        }
        runtime = await input.markPollingReleased(now);
        input.onEvent("runtime_polling_released", {
          drainDeadlineAt: runtime.drainDeadlineAt
        });
      }
      if (runtime.state !== "DRAINING") return;

      if (await input.hasEquivalentActiveReplacement()) {
        await finish(now, "runtime_drain_completed");
        return;
      }
      const deadlineMs = Date.parse(runtime.drainDeadlineAt ?? "");
      if (!Number.isFinite(deadlineMs)) {
        throw new Error("runtime_handoff_deadline_missing");
      }
      if (now.getTime() >= deadlineMs) {
        input.onEvent("runtime_drain_deadline_reached", {
          drainDeadlineAt: runtime.drainDeadlineAt
        });
        await input.terminalizeExpiredCompatibleRuns(now);
        await finish(now, "runtime_drain_completed");
        return;
      }
      const remaining = await input.countCompatibleRuns();
      if (!Number.isSafeInteger(remaining) || remaining < 0) {
        throw new Error("runtime_handoff_compatible_count_invalid");
      }
      if (remaining === 0) {
        await finish(now, "runtime_drain_completed");
      }
    }
  };
}
