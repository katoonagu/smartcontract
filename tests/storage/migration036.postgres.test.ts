import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  SCHEMA_035_FILENAME,
  SCHEMA_036_FILENAME,
  applyVerifiedMigration032,
  applyVerifiedTrackedMigration,
  checksumMigrationBytes,
  verifyRequiredSchema036
} from "../../src/storage/schemaMigrations";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("migration 036 PostgreSQL acceptance", () => {
  it("upgrades 035, verifies 032→036 lineage, and is idempotent", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `unified036_${randomUUID().replaceAll("-", "")}`;
    const files = [
      SCHEMA_032_FILENAME,
      SCHEMA_033_FILENAME,
      SCHEMA_034_FILENAME,
      SCHEMA_035_FILENAME,
      SCHEMA_036_FILENAME
    ] as const;
    const bytes = new Map(files.map((file) => [
      file,
      readFileSync(`migrations/${file}`)
    ]));
    const checksums = new Map<string, string>();
    try {
      for (const file of files) {
        checksums.set(file, await checksumMigrationBytes(bytes.get(file)!));
      }
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        "create table watched_wallets (id text primary key, address text not null)"
      );
      await client.query(readFileSync("migrations/006_approval_guard.sql", "utf8"));

      await applyVerifiedMigration032(client, {
        migrationBytes: bytes.get(SCHEMA_032_FILENAME)!,
        schemaName: schema
      });
      for (const [version, file] of [
        [33, SCHEMA_033_FILENAME],
        [34, SCHEMA_034_FILENAME],
        [35, SCHEMA_035_FILENAME],
        [36, SCHEMA_036_FILENAME]
      ] as const) {
        await applyVerifiedTrackedMigration(client, {
          version,
          filename: file,
          migrationBytes: bytes.get(file)!,
          requiredSchema032Checksum: checksums.get(SCHEMA_032_FILENAME),
          requiredSchema033Checksum: checksums.get(SCHEMA_033_FILENAME),
          requiredSchema034Checksum: checksums.get(SCHEMA_034_FILENAME),
          requiredSchema035Checksum: checksums.get(SCHEMA_035_FILENAME),
          schemaName: schema
        });
      }

      await expect(verifyRequiredSchema036(
        client,
        checksums.get(SCHEMA_036_FILENAME)!,
        checksums.get(SCHEMA_032_FILENAME)!,
        checksums.get(SCHEMA_033_FILENAME)!,
        checksums.get(SCHEMA_034_FILENAME)!,
        checksums.get(SCHEMA_035_FILENAME)!,
        { schemaName: schema }
      )).resolves.toMatchObject({ version: 36 });
      await expect(applyVerifiedTrackedMigration(client, {
        version: 36,
        filename: SCHEMA_036_FILENAME,
        migrationBytes: bytes.get(SCHEMA_036_FILENAME)!,
        requiredSchema032Checksum: checksums.get(SCHEMA_032_FILENAME),
        requiredSchema033Checksum: checksums.get(SCHEMA_033_FILENAME),
        requiredSchema034Checksum: checksums.get(SCHEMA_034_FILENAME),
        requiredSchema035Checksum: checksums.get(SCHEMA_035_FILENAME),
        schemaName: schema
      })).resolves.toMatchObject({ status: "already_verified" });

      const catalog = await client.query(
        `select column_name from information_schema.columns
          where table_schema = $1 and table_name = 'unified_check_runs'`,
        [schema]
      );
      expect(catalog.rows.map((row) => row.column_name))
        .not.toContain("rollout_receipt_sha256");
      await client.query(`insert into unified_check_runs (
        id, analysis_key_sha256, subject_address, status, run_purpose,
        side_effect_policy, analysis_manifest_sha256, fairness_owner_id,
        rollout_stage, rollout_bucket, admission_policy,
        provider_capacity_ceiling
      ) values ('rolling-run',$1,'TA','RUNNING','synthetic_test','isolated',
        $2,'rolling-run','isolated_rolling',1,'rolling',4)`, [
        "a".repeat(64),
        "b".repeat(64)
      ]);
      await expect(client.query(
        "update unified_check_runs set provider_capacity_ceiling=3 where id='rolling-run'"
      )).rejects.toThrow("unified_run_rollout_policy_immutable");
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`)
        .catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
