import { describe, expect, it } from "vitest";
import {
  LONG_RUNNING_NOTIFICATION_DELAY_MS,
  RUNTIME_HANDOFF_DRAIN_MS,
  RUNTIME_HEARTBEAT_INTERVAL_MS,
  RUNTIME_HEARTBEAT_STALE_MS,
  classifyRuntimeOwnership,
  renderUnifiedLifecycleMessage
} from "../../src/unifiedCheck/runtimeHandoffPolicy";

const address = "TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52";

describe("Unified runtime handoff policy", () => {
  it("pins production clocks", () => {
    expect(RUNTIME_HANDOFF_DRAIN_MS).toBe(7_200_000);
    expect(RUNTIME_HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(RUNTIME_HEARTBEAT_STALE_MS).toBe(60_000);
    expect(LONG_RUNNING_NOTIFICATION_DELAY_MS).toBe(300_000);
  });

  it("keeps a fresh compatible drainer recoverable", () => {
    expect(classifyRuntimeOwnership({
      now: new Date("2026-07-28T10:00:00.000Z"),
      heartbeatStaleMs: 60_000,
      compatibleRuntime: {
        state: "DRAINING",
        heartbeatAt: "2026-07-28T09:59:30.000Z",
        drainDeadlineAt: "2026-07-28T12:00:00.000Z"
      }
    })).toBe("recoverable");
  });

  it("uses the exact deadline boundary before heartbeat staleness", () => {
    expect(classifyRuntimeOwnership({
      now: new Date("2026-07-28T12:00:00.000Z"),
      heartbeatStaleMs: 60_000,
      compatibleRuntime: {
        state: "DRAINING",
        heartbeatAt: "2026-07-28T11:59:59.000Z",
        drainDeadlineAt: "2026-07-28T12:00:00.000Z"
      }
    })).toBe("runtime_handoff_deadline_exceeded");
  });

  it("classifies a stale or absent compatible runtime as unavailable", () => {
    expect(classifyRuntimeOwnership({
      now: new Date("2026-07-28T10:00:00.000Z"),
      heartbeatStaleMs: 60_000,
      compatibleRuntime: {
        state: "DRAINING",
        heartbeatAt: "2026-07-28T09:58:59.999Z",
        drainDeadlineAt: "2026-07-28T12:00:00.000Z"
      }
    })).toBe("runtime_handoff_unavailable");
    expect(classifyRuntimeOwnership({
      now: new Date("2026-07-28T10:00:00.000Z"),
      heartbeatStaleMs: 60_000,
      compatibleRuntime: null
    })).toBe("runtime_handoff_unavailable");
  });

  it.each(["ru", "en"] as const)("renders score-free %s lifecycle copy", (locale) => {
    const progress = renderUnifiedLifecycleMessage({
      kind: "LONG_RUNNING",
      locale,
      address
    });
    expect(progress.text).not.toMatch(/\d+%|ETA|score|риск:\s*\d/iu);
    expect(progress.callbackData).toBeNull();
    expect(progress.buttonText).toBeNull();

    const failed = renderUnifiedLifecycleMessage({
      kind: "FAILED_TECHNICAL_RUNTIME_HANDOFF",
      locale,
      address
    });
    expect(failed.callbackData).toBe(`check:addr:${address}`);
    expect(failed.buttonText).toBe(locale === "ru" ? "Повторить" : "Retry");
    expect(failed.text).toMatch(
      locale === "ru" ? /вывод о риске не сформирован/u : /no risk conclusion/iu
    );
    expect(failed.text).not.toMatch(/\d+%|score|оценка\s*\d/iu);
  });

  it("rejects invalid clocks, limits and addresses", () => {
    expect(() => classifyRuntimeOwnership({
      now: new Date("invalid"),
      heartbeatStaleMs: 60_000,
      compatibleRuntime: null
    })).toThrow("runtime_handoff_policy_input_invalid");
    expect(() => classifyRuntimeOwnership({
      now: new Date(),
      heartbeatStaleMs: 0,
      compatibleRuntime: null
    })).toThrow("runtime_handoff_policy_input_invalid");
    expect(() => renderUnifiedLifecycleMessage({
      kind: "LONG_RUNNING",
      locale: "ru",
      address: "not-a-tron-address"
    })).toThrow("unified_lifecycle_address_invalid");
  });
});
