import { describe, expect, it } from "vitest";
import {
  buildRuntimeVersion,
  formatRuntimeVersion,
  validateRuntimeVersion
} from "../../src/runtime/runtimeVersion";

const gitCommitSha = "a".repeat(40);
const migration037 = {
  verified: true as const,
  version: 37 as const,
  filename: "037_unified_runtime_handoff.sql" as const,
  checksumSha256: "b".repeat(64),
  shortChecksum: "b".repeat(12),
  schema032ChecksumSha256: "c".repeat(64),
  schema033ChecksumSha256: "d".repeat(64),
  schema034ChecksumSha256: "e".repeat(64),
  schema035ChecksumSha256: "f".repeat(64),
  schema036ChecksumSha256: "1".repeat(64)
};

describe("active runtime schema 037 identity", () => {
  it("accepts and renders only the exact verified schema-037 shape", () => {
    const runtime = buildRuntimeVersion({
      gitCommitSha,
      runtimeInstanceLabel: "candidate-aaaaaaaa",
      migration: migration037
    });
    expect(runtime.migration).toEqual(migration037);
    expect(formatRuntimeVersion(runtime, "en")).toContain("schema 037 verified");
    expect(formatRuntimeVersion(runtime, "ru")).toContain("schema 037 verified");
  });

  it.each([
    {
      name: "schema 036",
      migration: {
        ...migration037,
        version: 36,
        filename: "036_remove_rollout_authority.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "unknown schema 038",
      migration: {
        ...migration037,
        version: 38,
        filename: "038_unknown.sql"
      },
      code: "runtime_version_migration_version_mismatch"
    },
    {
      name: "missing schema 036 predecessor checksum",
      migration: Object.fromEntries(
        Object.entries(migration037).filter(([key]) =>
          key !== "schema036ChecksumSha256"
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
