import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  SCHEMA_032_FILENAME,
  SCHEMA_032_VERSION,
  verifySchema033Structure
} from "../../src/storage/schemaMigrations";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;

postgresDescribe("migration 033 PostgreSQL acceptance", () => {
  it("creates the exact durable Unified schema and immutable artifacts", async () => {
    expect(REQUIRED_SCHEMA_VERSION).toBe(33);
    expect(REQUIRED_SCHEMA_FILENAME).toBe("033_unified_wallet_check.sql");
    expect(SCHEMA_032_VERSION).toBe(32);
    expect(SCHEMA_032_FILENAME).toBe(
      "032_telegram_runtime_forensics_data_contracts.sql"
    );

    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `unified033_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      await expect(
        verifySchema033Structure(client, { schemaName: schema })
      ).resolves.toBeUndefined();

      await client.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256
        ) values ('run', $1, 'TSubject', 'RUNNING', 'synthetic_test',
          'isolated', $2)`,
        ["a".repeat(64), "b".repeat(64)]
      );
      await client.query(
        `insert into unified_check_artifacts (
          sha256, created_by_run_id, kind, schema_version, artifact_json
        ) values ($1, 'run', 'evidence', '1', '{"ok":true}')`,
        ["c".repeat(64)]
      );
      await expect(
        client.query(
          "update unified_check_artifacts set kind = 'changed' where sha256 = $1",
          ["c".repeat(64)]
        )
      ).rejects.toThrow("unified_immutable_artifact_mutation");
      await expect(
        client.query("delete from unified_check_artifacts where sha256 = $1", [
          "c".repeat(64)
        ])
      ).rejects.toThrow("unified_immutable_artifact_mutation");
      await client.query(
        "drop trigger unified_provider_pages_immutable on unified_provider_pages"
      );
      await expect(
        verifySchema033Structure(client, { schemaName: schema })
      ).rejects.toThrow("schema_033_catalog_mismatch");
    } finally {
      await client.query("reset search_path");
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
