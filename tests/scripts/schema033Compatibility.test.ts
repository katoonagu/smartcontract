import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("schema 033 compatibility consumers", () => {
  it("pins 033 verifiers and advances the standard migrator through 034", () => {
    const migrate = readFileSync("scripts/migrate.ts", "utf8");
    expect(migrate).toContain("SCHEMA_033_VERSION");
    expect(migrate).toContain("let requiredSchema033Checksum: string | undefined;");
    expect(migrate).toContain("requiredSchema033Checksum");
    expect(migrate).toContain("if (version === SCHEMA_033_VERSION)");
    expect(migrate).toContain("SCHEMA_MIGRATION_MAX_VERSION");

    for (const path of [
      "scripts/runUnifiedWalletCanary.ts",
      "scripts/verifySchema032.ts",
      "scripts/runSchema032ReleaseSequence.ts",
      "tests/storage/migration032.postgres.test.ts"
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("SCHEMA_033_FILENAME");
      expect(source).not.toContain("REQUIRED_SCHEMA_FILENAME as RELEASE_SCHEMA_FILENAME");
    }
  });
});
