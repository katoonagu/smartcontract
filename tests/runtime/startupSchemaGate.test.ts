import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runStartupSchemaGate } from "../../src/runtime/startupSchemaGate";

describe("schema-verified startup gate", () => {
  it("[REQ-38][DATA] performs no verified-start callback when schema 032 verification fails", async () => {
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
      version: 32 as const,
      filename: "032_telegram_runtime_forensics_data_contracts.sql" as const,
      checksumSha256: "a".repeat(64),
      shortChecksum: "a".repeat(12)
    };
    const onVerified = vi.fn(() => undefined);
    await expect(runStartupSchemaGate({
      verify: async () => verification,
      onVerified
    })).resolves.toBe(verification);
    expect(onVerified).toHaveBeenCalledOnce();
    expect(onVerified).toHaveBeenCalledWith(verification);
  });

  it("places the schema gate before provider, bot and worker initialization", () => {
    const source = readFileSync("src/index.ts", "utf8");
    const createDbAt = source.indexOf("const db = createDb(config.databaseUrl)");
    const tryAt = source.indexOf("try {", createDbAt);
    const readAt = source.indexOf("await readFile", createDbAt);
    const checksumAt = source.indexOf("await checksumMigrationBytes", createDbAt);
    const gateAt = source.indexOf("await runStartupSchemaGate");
    const catchAt = source.indexOf("} catch (error) {", gateAt);
    const closeAt = source.indexOf("await closeDb(db)", catchAt);
    const providerAt = source.indexOf("const tronscanScheduler = createTronscanScheduler");
    const botAt = source.indexOf("const bot = createBot");
    const workersAt = source.indexOf("startBackgroundWorkSchedule();");
    expect(createDbAt).toBeGreaterThanOrEqual(0);
    expect(tryAt).toBeGreaterThan(createDbAt);
    expect(readAt).toBeGreaterThan(tryAt);
    expect(checksumAt).toBeGreaterThan(readAt);
    expect(gateAt).toBeGreaterThan(checksumAt);
    expect(catchAt).toBeGreaterThan(gateAt);
    expect(closeAt).toBeGreaterThan(catchAt);
    expect(providerAt).toBeGreaterThan(gateAt);
    expect(providerAt).toBeGreaterThan(closeAt);
    expect(botAt).toBeGreaterThan(providerAt);
    expect(workersAt).toBeGreaterThan(botAt);
    expect(source).toContain("new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url)");
  });
});
