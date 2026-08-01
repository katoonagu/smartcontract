import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  SCHEMA_035_FILENAME,
  applyVerifiedMigration032,
  applyVerifiedTrackedMigration,
  checksumMigrationBytes,
  verifyRequiredSchema035
} from "../../src/storage/schemaMigrations";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("migration 035 PostgreSQL acceptance", () => {
  it("applies the rollout policy and remains verifiable on an idempotent migration restart", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `unified035_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        "create table watched_wallets (id text primary key, address text not null)"
      );
      await client.query(readFileSync("migrations/006_approval_guard.sql", "utf8"));

      const migration032Bytes = readFileSync(`migrations/${SCHEMA_032_FILENAME}`);
      const migration033Bytes = readFileSync(`migrations/${SCHEMA_033_FILENAME}`);
      const migration034Bytes = readFileSync(`migrations/${SCHEMA_034_FILENAME}`);
      const migration035Bytes = readFileSync(`migrations/${SCHEMA_035_FILENAME}`);
      const schema032Checksum = await checksumMigrationBytes(migration032Bytes);
      const schema033Checksum = await checksumMigrationBytes(migration033Bytes);
      const schema034Checksum = await checksumMigrationBytes(migration034Bytes);
      const schema035Checksum = await checksumMigrationBytes(migration035Bytes);

      await applyVerifiedMigration032(client, {
        migrationBytes: migration032Bytes,
        schemaName: schema
      });
      await applyVerifiedTrackedMigration(client, {
        version: 33,
        filename: SCHEMA_033_FILENAME,
        migrationBytes: migration033Bytes,
        requiredSchema032Checksum: schema032Checksum,
        schemaName: schema
      });
      await applyVerifiedTrackedMigration(client, {
        version: 34,
        filename: SCHEMA_034_FILENAME,
        migrationBytes: migration034Bytes,
        requiredSchema032Checksum: schema032Checksum,
        requiredSchema033Checksum: schema033Checksum,
        schemaName: schema
      });
      await applyVerifiedTrackedMigration(client, {
        version: 35,
        filename: SCHEMA_035_FILENAME,
        migrationBytes: migration035Bytes,
        requiredSchema032Checksum: schema032Checksum,
        requiredSchema033Checksum: schema033Checksum,
        requiredSchema034Checksum: schema034Checksum,
        schemaName: schema
      });

      await expect(verifyRequiredSchema035(
        client,
        schema035Checksum,
        schema032Checksum,
        schema033Checksum,
        schema034Checksum,
        { schemaName: schema }
      )).resolves.toMatchObject({
        version: 35,
        filename: SCHEMA_035_FILENAME
      });

      const tracked = [
        {
          version: 33,
          filename: SCHEMA_033_FILENAME,
          migrationBytes: migration033Bytes,
          requiredSchema032Checksum: schema032Checksum
        },
        {
          version: 34,
          filename: SCHEMA_034_FILENAME,
          migrationBytes: migration034Bytes,
          requiredSchema032Checksum: schema032Checksum,
          requiredSchema033Checksum: schema033Checksum
        },
        {
          version: 35,
          filename: SCHEMA_035_FILENAME,
          migrationBytes: migration035Bytes,
          requiredSchema032Checksum: schema032Checksum,
          requiredSchema033Checksum: schema033Checksum,
          requiredSchema034Checksum: schema034Checksum
        }
      ] as const;
      for (const migration of tracked) {
        await expect(applyVerifiedTrackedMigration(client, {
          ...migration,
          schemaName: schema,
          allowNewerReceipt: true,
          allowSchema035Additions: true
        })).resolves.toMatchObject({
          version: migration.version,
          status: "already_verified"
        });
      }

      await client.query(`insert into unified_check_runs (
        id, analysis_key_sha256, subject_address, status, run_purpose,
        side_effect_policy, analysis_manifest_sha256, fairness_owner_id
      ) values ('legacy-run', $1, 'TA', 'RUNNING', 'synthetic_test',
        'isolated', $2, 'legacy-run')`,
      ["a".repeat(64), "b".repeat(64)]);
      await expect(client.query(
        "update unified_check_runs set provider_capacity_ceiling = 2 where id = 'legacy-run'"
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
