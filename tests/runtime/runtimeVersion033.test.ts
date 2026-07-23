import { describe, expect, it } from "vitest";
import {
  buildRuntimeVersion,
  formatRuntimeVersion
} from "../../src/runtime/runtimeVersion";

describe("runtime schema 033 identity", () => {
  it("accepts and renders the exact verified schema-033 shape", () => {
    const runtime = buildRuntimeVersion({
      gitCommitSha: "a".repeat(40),
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      migration: {
        verified: true,
        version: 33,
        filename: "033_unified_wallet_check.sql",
        checksumSha256: "b".repeat(64),
        shortChecksum: "b".repeat(12),
        schema032ChecksumSha256: "c".repeat(64)
      }
    });
    expect(runtime.migration.version).toBe(33);
    expect(formatRuntimeVersion(runtime, "en")).toContain("schema 033 verified");
    expect(formatRuntimeVersion(runtime, "ru")).toContain("schema 033 verified");
  });
});
