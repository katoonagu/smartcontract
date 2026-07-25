import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runStartupSchemaGate } from "../../src/runtime/startupSchemaGate";

describe("schema-verified startup gate", () => {
  it("[REQ-38][DATA] performs no verified-start callback when schema lineage verification fails", async () => {
    const onVerified = vi.fn(() => undefined);
    await expect(runStartupSchemaGate({
      verify: async () => {
        throw new Error("schema_032_checksum_mismatch");
      },
      onVerified
    })).rejects.toThrow("schema_032_checksum_mismatch");
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("returns verified metadata and invokes the callback once", async () => {
    const verification = {
      verified: true as const,
      version: 35 as const,
      filename: "035_unified_check_run_rollout_policy.sql" as const,
      checksumSha256: "a".repeat(64),
      shortChecksum: "a".repeat(12),
      schema032ChecksumSha256: "b".repeat(64),
      schema033ChecksumSha256: "c".repeat(64),
      schema034ChecksumSha256: "d".repeat(64)
    };
    const onVerified = vi.fn(() => undefined);
    await expect(runStartupSchemaGate({
      verify: async () => verification,
      onVerified
    })).resolves.toBe(verification);
    expect(onVerified).toHaveBeenCalledOnce();
    expect(onVerified).toHaveBeenCalledWith(verification);
  });

  it("runs startup reconciliation after schema verification and serializes later boundaries", async () => {
    const modulePath: string = "../../src/runtime/forensicRuntimeOrchestration";
    const runtimeModule = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
    expect(runtimeModule.createForensicRuntimeOrchestration).toBeTypeOf("function");

    const createForensicRuntimeOrchestration = runtimeModule.createForensicRuntimeOrchestration as (input: {
      verifyStartupSchema(): Promise<unknown>;
      reconcileWaitingForensicJobs(): Promise<Array<{
        parentJobId: string;
        readyCount: number;
        terminalCount: number;
        cancelledCount: number;
        waitingCount: number;
        outcome: "resume_ready";
        diagnosticCode: null;
      }>>;
      logger: { info(event: string, fields: Record<string, unknown>): void };
    }) => {
      runVerifiedStartup(): Promise<void>;
      runBeforeWherePoll(): Promise<void>;
      runBeforeIncomingPoll(): Promise<void>;
    };

    const calls: string[] = [];
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    let activeReconciliations = 0;
    let maxActiveReconciliations = 0;
    const runtime = createForensicRuntimeOrchestration({
      verifyStartupSchema: async () => { calls.push("schema"); },
      reconcileWaitingForensicJobs: async () => {
        calls.push("reconcile");
        activeReconciliations += 1;
        maxActiveReconciliations = Math.max(maxActiveReconciliations, activeReconciliations);
        await Promise.resolve();
        activeReconciliations -= 1;
        return [{
          parentJobId: "synthetic-job-1",
          readyCount: 2,
          terminalCount: 0,
          cancelledCount: 0,
          waitingCount: 0,
          outcome: "resume_ready" as const,
          diagnosticCode: null
        }];
      },
      logger: { info: (event, fields) => logs.push({ event, fields }) }
    });

    await runtime.runVerifiedStartup();
    await Promise.all([runtime.runBeforeWherePoll(), runtime.runBeforeIncomingPoll()]);

    expect(calls).toEqual(["schema", "reconcile", "reconcile", "reconcile"]);
    expect(maxActiveReconciliations).toBe(1);
    expect(logs).toEqual(Array.from({ length: 3 }, () => ({
      event: "forensic_wait_reconciliation",
      fields: {
        parentJobId: "synthetic-job-1",
        readyCount: 2,
        terminalCount: 0,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_ready",
        diagnosticCode: null
      }
    })));
  });

  it("places the schema gate before provider, bot and worker initialization", () => {
    const source = readFileSync("src/index.ts", "utf8");
    const createDbAt = source.indexOf("const db = createDb(config.databaseUrl)");
    const tryAt = source.indexOf("try {", createDbAt);
    const readAt = source.indexOf("await readFile", createDbAt);
    const checksumAt = source.indexOf("await checksumMigrationBytes", createDbAt);
    const orchestrationAt = source.indexOf("createForensicRuntimeOrchestration({", checksumAt);
    const gateAt = source.indexOf("runStartupSchemaGate", orchestrationAt);
    const reconciliationAt = source.indexOf("reconcileWaitingForensicCheckJobs", orchestrationAt);
    const verifiedStartupAt = source.indexOf("await forensicRuntimeOrchestration.runVerifiedStartup()", orchestrationAt);
    const catchAt = source.indexOf("} catch (error) {", verifiedStartupAt);
    const closeAt = source.indexOf("await closeDb(db)", catchAt);
    const providerAt = source.indexOf("const tronscanScheduler = createTronscanScheduler");
    const botAt = source.indexOf("const bot = createBot");
    const workersAt = source.indexOf("startBackgroundWorkSchedule();");
    expect(createDbAt).toBeGreaterThanOrEqual(0);
    expect(tryAt).toBeGreaterThan(createDbAt);
    expect(readAt).toBeGreaterThan(tryAt);
    expect(checksumAt).toBeGreaterThan(readAt);
    expect(orchestrationAt).toBeGreaterThan(checksumAt);
    expect(gateAt).toBeGreaterThan(orchestrationAt);
    expect(reconciliationAt).toBeGreaterThan(gateAt);
    expect(verifiedStartupAt).toBeGreaterThan(reconciliationAt);
    expect(catchAt).toBeGreaterThan(verifiedStartupAt);
    expect(closeAt).toBeGreaterThan(catchAt);
    expect(providerAt).toBeGreaterThan(gateAt);
    expect(providerAt).toBeGreaterThan(closeAt);
    expect(botAt).toBeGreaterThan(providerAt);
    expect(workersAt).toBeGreaterThan(botAt);
    expect(source).toContain("new URL(`../migrations/${SCHEMA_032_FILENAME}`, import.meta.url)");
    expect(source).toContain("new URL(`../migrations/${SCHEMA_033_FILENAME}`, import.meta.url)");
    expect(source).toContain("new URL(`../migrations/${SCHEMA_034_FILENAME}`, import.meta.url)");
    expect(source).toContain("new URL(`../migrations/${SCHEMA_035_FILENAME}`, import.meta.url)");
    expect(source).toContain("verifyRequiredSchema035(");
    expect(source).toContain("schema034Checksum");
  });
});
