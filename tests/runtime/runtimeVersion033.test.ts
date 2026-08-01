import { describe, expect, it } from "vitest";
import {
  validateRuntimeVersion
} from "../../src/runtime/runtimeVersion";

describe("historical runtime schema 033 identity", () => {
  it("is rejected by the active schema-034 runtime contract", () => {
    const gitCommitSha = "a".repeat(40);
    expect(() => validateRuntimeVersion({
      version: "runtime-version-v1",
      gitCommitSha,
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      scoringPolicyVersion: "scoring-signal-matrix-v3",
      resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2",
      narrativeVersion: "telegram-forensic-result-v1",
      migration: {
        verified: true,
        version: 33,
        filename: "033_unified_wallet_check.sql",
        checksumSha256: "b".repeat(64),
        shortChecksum: "b".repeat(12),
        schema032ChecksumSha256: "c".repeat(64)
      }
    }, gitCommitSha)).toThrow("runtime_version_migration_shape_invalid");
  });
});
