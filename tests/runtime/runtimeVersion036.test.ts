import { describe, expect, it } from "vitest";
import {
  buildRuntimeVersion,
  formatRuntimeVersion,
  validateRuntimeVersion
} from "../../src/runtime/runtimeVersion";

const gitCommitSha = "a".repeat(40);
const migration036 = {
  verified: true as const,
  version: 36 as const,
  filename: "036_remove_rollout_authority.sql" as const,
  checksumSha256: "b".repeat(64),
  shortChecksum: "b".repeat(12),
  schema032ChecksumSha256: "c".repeat(64),
  schema033ChecksumSha256: "d".repeat(64),
  schema034ChecksumSha256: "e".repeat(64),
  schema035ChecksumSha256: "f".repeat(64)
};

describe("active runtime schema 036 identity", () => {
  it("accepts and renders only the exact verified schema-036 shape", () => {
    const runtime = buildRuntimeVersion({
      gitCommitSha,
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      migration: migration036
    });
    expect(runtime.migration).toEqual(migration036);
    expect(formatRuntimeVersion(runtime, "en")).toContain("schema 036 verified");
    expect(formatRuntimeVersion(runtime, "ru")).toContain("schema 036 verified");
  });

  it.each([
    {
      name: "schema 035",
      migration: {
        ...migration036,
        version: 35,
        filename: "035_unified_check_run_rollout_policy.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "unknown schema 037",
      migration: {
        ...migration036,
        version: 37,
        filename: "037_unknown.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "missing schema 035 predecessor checksum",
      migration: Object.fromEntries(
        Object.entries(migration036).filter(([key]) =>
          key !== "schema035ChecksumSha256"
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
