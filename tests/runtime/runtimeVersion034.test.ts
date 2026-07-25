import { describe, expect, it } from "vitest";
import {
  buildRuntimeVersion,
  formatRuntimeVersion,
  validateRuntimeVersion
} from "../../src/runtime/runtimeVersion";

const gitCommitSha = "a".repeat(40);
const migration035 = {
  verified: true as const,
  version: 35 as const,
  filename: "035_unified_check_run_rollout_policy.sql" as const,
  checksumSha256: "b".repeat(64),
  shortChecksum: "b".repeat(12),
  schema032ChecksumSha256: "c".repeat(64),
  schema033ChecksumSha256: "d".repeat(64),
  schema034ChecksumSha256: "e".repeat(64)
};

describe("active runtime schema 035 identity", () => {
  it("accepts and renders only the exact verified schema-035 shape", () => {
    const runtime = buildRuntimeVersion({
      gitCommitSha,
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      migration: migration035
    });
    expect(runtime.migration).toEqual(migration035);
    expect(formatRuntimeVersion(runtime, "en")).toContain("schema 035 verified");
    expect(formatRuntimeVersion(runtime, "ru")).toContain("schema 035 verified");
  });

  it.each([
    {
      name: "schema 033",
      migration: {
        ...migration035,
        version: 33,
        filename: "033_unified_wallet_check.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "unknown schema 036",
      migration: {
        ...migration035,
        version: 36,
        filename: "036_unknown.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "missing schema 033 predecessor checksum",
      migration: Object.fromEntries(
        Object.entries(migration035).filter(([key]) =>
          key !== "schema034ChecksumSha256"
        )
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
