import { describe, expect, it } from "vitest";
import {
  buildRuntimeVersion,
  formatRuntimeVersion,
  validateRuntimeVersion
} from "../../src/runtime/runtimeVersion";

const gitCommitSha = "a".repeat(40);
const migration034 = {
  verified: true as const,
  version: 34 as const,
  filename: "034_unified_check_adaptive_planner.sql" as const,
  checksumSha256: "b".repeat(64),
  shortChecksum: "b".repeat(12),
  schema032ChecksumSha256: "c".repeat(64),
  schema033ChecksumSha256: "d".repeat(64)
};

describe("active runtime schema 034 identity", () => {
  it("accepts and renders only the exact verified schema-034 shape", () => {
    const runtime = buildRuntimeVersion({
      gitCommitSha,
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      migration: migration034
    });
    expect(runtime.migration).toEqual(migration034);
    expect(formatRuntimeVersion(runtime, "en")).toContain("schema 034 verified");
    expect(formatRuntimeVersion(runtime, "ru")).toContain("schema 034 verified");
  });

  it.each([
    {
      name: "schema 033",
      migration: {
        ...migration034,
        version: 33,
        filename: "033_unified_wallet_check.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "unknown schema 035",
      migration: {
        ...migration034,
        version: 35,
        filename: "035_unknown.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "missing schema 033 predecessor checksum",
      migration: Object.fromEntries(
        Object.entries(migration034).filter(([key]) => key !== "schema033ChecksumSha256")
      ),
      code: "runtime_version_migration_shape_invalid"
    }
  ])("rejects $name", ({ migration, code }) => {
    expect(() => validateRuntimeVersion({
      version: "runtime-version-v1",
      gitCommitSha,
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      scoringPolicyVersion: "scoring-signal-matrix-v3",
      resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2",
      narrativeVersion: "telegram-forensic-result-v1",
      migration
    }, gitCommitSha)).toThrow(code);
  });
});
