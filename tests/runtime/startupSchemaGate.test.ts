import { describe, expect, it, vi } from "vitest";
import { runStartupSchemaGate } from "../../src/runtime/startupSchemaGate";

describe("schema-verified startup gate", () => {
  it("[REQ-38][DATA] performs no verified-start callback when schema 032 verification fails", async () => {
    const onVerified = vi.fn(async () => undefined);
    await expect(runStartupSchemaGate({
      verify: async () => {
        throw new Error("schema_032_checksum_mismatch");
      },
      onVerified
    })).rejects.toThrow("schema_032_checksum_mismatch");
    expect(onVerified).not.toHaveBeenCalled();
  });
});
