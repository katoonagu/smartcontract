import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type RuntimeOrchestration = {
  runVerifiedStartup(): Promise<void>;
};

type CreateForensicRuntimeOrchestration = (input: {
  verifyStartupSchema(): Promise<unknown>;
  reconcileWaitingForensicJobs(): Promise<void>;
  runForensicTelegramDeliveryCycle(): Promise<void>;
  runApprovalAllowanceRefreshCycle(): Promise<void>;
}) => RuntimeOrchestration;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Plan 3 runtime schema gate integration acceptance", () => {
  it("[REQ-38][RUNTIME-GATE] starts no reconciler delivery or allowance cycle before schema 032 verification", async () => {
    const modulePath: string = "../../src/runtime/forensicRuntimeOrchestration";
    let runtimeModule: Record<string, unknown>;
    try {
      runtimeModule = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
    } catch (error) {
      throw new Error("Plan 3 feature missing: createForensicRuntimeOrchestration", { cause: error });
    }
    if (typeof runtimeModule.createForensicRuntimeOrchestration !== "function") {
      throw new Error("Plan 3 feature missing: createForensicRuntimeOrchestration");
    }
    const createForensicRuntimeOrchestration =
      runtimeModule.createForensicRuntimeOrchestration as CreateForensicRuntimeOrchestration;
    const gate = deferred<unknown>();
    const invocations = { reconciliation: 0, delivery: 0, allowance: 0 };
    const runtime = createForensicRuntimeOrchestration({
      verifyStartupSchema: () => gate.promise,
      reconcileWaitingForensicJobs: async () => { invocations.reconciliation += 1; },
      runForensicTelegramDeliveryCycle: async () => { invocations.delivery += 1; },
      runApprovalAllowanceRefreshCycle: async () => { invocations.allowance += 1; }
    });

    let startup: Promise<void> | undefined;
    try {
      startup = runtime.runVerifiedStartup();
      await Promise.resolve();
      await Promise.resolve();
      expect(invocations).toEqual({ reconciliation: 0, delivery: 0, allowance: 0 });

      const rejection = expect(startup).rejects.toThrow("schema_032_checksum_mismatch");
      gate.reject(new Error("schema_032_checksum_mismatch"));
      await rejection;
      expect(invocations).toEqual({ reconciliation: 0, delivery: 0, allowance: 0 });
    } finally {
      gate.reject(new Error("schema gate test cleanup"));
      if (startup) await Promise.allSettled([startup]);
    }
  });

  it("[REQ-38][RUNTIME-VERSION-STARTUP] builds identity after schema 032 and fails closed before providers workers or bot", async () => {
    const source = await readFile(new URL("../../src/index.ts", import.meta.url), "utf8");
    const startupTry = source.indexOf("try {");
    const schemaGate = source.indexOf("await forensicRuntimeOrchestration.runVerifiedStartup()");
    const runtimeVersion = source.indexOf("buildRuntimeVersion({");
    const startupCatch = source.indexOf("} catch (error) {", schemaGate);
    const closeDatabase = source.indexOf("await closeDb(db);", startupCatch);
    const provider = source.indexOf("const tronscanScheduler = createTronscanScheduler(");
    const bot = source.indexOf("const bot = createBot(");
    const workers = source.lastIndexOf("startBackgroundWorkSchedule();");

    expect(startupTry).toBeGreaterThanOrEqual(0);
    expect(schemaGate).toBeGreaterThan(startupTry);
    expect(runtimeVersion).toBeGreaterThan(schemaGate);
    expect(startupCatch).toBeGreaterThan(runtimeVersion);
    expect(closeDatabase).toBeGreaterThan(startupCatch);
    expect(provider).toBeGreaterThan(closeDatabase);
    expect(bot).toBeGreaterThan(provider);
    expect(workers).toBeGreaterThan(bot);
  });
});
