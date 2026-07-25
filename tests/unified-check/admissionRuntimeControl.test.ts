import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedAdmissionRuntimeControl
} from "../../src/unifiedCheck/admissionRuntimeControl";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Unified admission runtime control", () => {
  it("serializes rolling-to-barrier fallback after the active controller cycle", async () => {
    const activeCycle = deferred<void>();
    const events: string[] = [];
    const applyBarrierFallback = vi.fn(async () => {
      events.push("fallback");
      return {
        runIds: ["run-1"],
        deAdmittedTaskIds: ["tail-1"]
      };
    });
    const wake = vi.fn();
    const control = createUnifiedAdmissionRuntimeControl({
      initialPolicy: "rolling",
      applyBarrierFallback,
      wake
    });

    const cycle = control.runControllerCycle(async (policy) => {
      events.push(`cycle:${policy}`);
      await activeCycle.promise;
      events.push("cycle:done");
      return policy;
    });
    const fallback = control.switchToBarrier();
    await Promise.resolve();
    expect(events).toEqual(["cycle:rolling"]);
    expect(control.current()).toBe("rolling");

    activeCycle.resolve();
    await expect(cycle).resolves.toBe("rolling");
    await expect(fallback).resolves.toEqual({
      changed: true,
      runIds: ["run-1"],
      deAdmittedTaskIds: ["tail-1"]
    });
    expect(events).toEqual([
      "cycle:rolling",
      "cycle:done",
      "fallback"
    ]);
    expect(control.current()).toBe("barrier");
    expect(wake).toHaveBeenCalledOnce();
    await expect(control.runControllerCycle(async (policy) => policy))
      .resolves.toBe("barrier");
    await expect(control.switchToBarrier()).resolves.toEqual({
      changed: false,
      runIds: [],
      deAdmittedTaskIds: []
    });
    expect(applyBarrierFallback).toHaveBeenCalledOnce();
  });
});
