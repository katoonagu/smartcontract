import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/db";
import {
  checksumMigrationBytes,
  SCHEMA_035_FILENAME,
  SCHEMA_035_VERSION,
  UNIFIED_SCHEMA_035_MIGRATION_SHA256,
  verifySchema035Structure
} from "../../src/storage/schemaMigrations";

const IMMUTABILITY_SOURCE = `
begin
  if new.rollout_stage is distinct from old.rollout_stage
    or new.rollout_bucket is distinct from old.rollout_bucket
    or new.admission_policy is distinct from old.admission_policy
    or new.provider_capacity_ceiling is distinct from old.provider_capacity_ceiling
    or new.rollout_receipt_sha256 is distinct from old.rollout_receipt_sha256
  then
    raise exception 'unified_run_rollout_policy_immutable';
  end if;
  return new;
end;
`;

function schema035Db(functionSource = IMMUTABILITY_SOURCE): Db {
  return {
    query: async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: [
          ["rollout_stage", "text", "NO", "'global_barrier'::text"],
          ["rollout_bucket", "integer", "YES", null],
          ["admission_policy", "text", "NO", "'barrier'::text"],
          ["provider_capacity_ceiling", "integer", "NO", "1"],
          ["rollout_receipt_sha256", "text", "YES", null]
        ].map(([column_name, data_type, is_nullable, column_default]) => ({
          column_name, data_type, is_nullable, column_default
        })) };
      }
      if (sql.includes("pg_constraint")) {
        return { rows: [
          "unified_check_runs_rollout_stage_check",
          "unified_check_runs_rollout_bucket_check",
          "unified_check_runs_admission_policy_check",
          "unified_check_runs_provider_capacity_ceiling_check",
          "unified_check_runs_rollout_receipt_sha256_check",
          "unified_check_runs_rollout_policy_shape_check"
        ].map((conname) => ({
          conname,
          contype: "c",
          convalidated: true
        })) };
      }
      if (sql.includes("pg_trigger")) {
        return { rows: [{
          tgname: "unified_check_runs_rollout_policy_immutable",
          proname: "unified_reject_run_rollout_policy_mutation",
          tgenabled: "O",
          tgtype: 19,
          function_language: "plpgsql",
          function_result: "trigger",
          function_arguments: "",
          function_source: functionSource
        }] };
      }
      throw new Error("unexpected_schema_035_query");
    }
  } as unknown as Db;
}

describe("migration 035 rollout policy", () => {
  it("preserves the historical checksum and immutable receipt-era policy", async () => {
    const bytes = readFileSync(`migrations/${SCHEMA_035_FILENAME}`);
    expect(SCHEMA_035_VERSION).toBe(35);
    await expect(checksumMigrationBytes(bytes)).resolves.toBe(
      UNIFIED_SCHEMA_035_MIGRATION_SHA256
    );
    const sql = bytes.toString("utf8");
    for (const column of [
      "rollout_stage",
      "rollout_bucket",
      "admission_policy",
      "provider_capacity_ceiling",
      "rollout_receipt_sha256"
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain(
      "unified_check_runs_rollout_policy_immutable"
    );
    expect(sql).toContain(
      "unified_run_rollout_policy_immutable"
    );
    expect(sql).toContain(
      "rollout_receipt_sha256 is null\n        and rollout_stage = 'global_barrier'"
    );
    expect(sql).toContain(
      "rollout_bucket is not null\n        and rollout_receipt_sha256 is not null"
    );
  });

  it("verifies the immutable trigger body, not only its name", async () => {
    await expect(
      verifySchema035Structure(schema035Db())
    ).resolves.toBeUndefined();
    await expect(
      verifySchema035Structure(schema035Db("begin return new; end;"))
    ).rejects.toThrow("schema_035_catalog_mismatch");
  });
});
