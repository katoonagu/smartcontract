import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";

const required = process.env.REQUIRE_PLAN1_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
if (required && !connectionString) {
  throw new Error("PLAN1 PostgreSQL acceptance requires TEST_DATABASE_URL");
}

const postgresDescribe = connectionString ? describe : describe.skip;

async function installApprovalBaseline(client: pg.PoolClient): Promise<void> {
  await client.query("create table watched_wallets (id text primary key)");
  await client.query(readFileSync("migrations/006_approval_guard.sql", "utf8"));
}

postgresDescribe("migration 032 PostgreSQL acceptance", () => {
  it("[REQ-38][DATA] applies, receipts, verifies and fails closed transactionally", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `plan1_${randomUUID().replaceAll("-", "")}`;
    const failureSchema = `${schema}_rollback`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await installApprovalBaseline(client);
      console.log(`[PLAN1_PG_TEMP_SCHEMA] ${schema}`);

      // Intentionally dynamic: Task 1 proves PostgreSQL was reached before the missing implementation fails RED.
      const migrations = await import("../../src/storage/schemaMigrations");
      const migrationBytes = readFileSync(`migrations/${migrations.REQUIRED_SCHEMA_FILENAME}`);

      const checksumSha256 = await migrations.checksumMigrationBytes(migrationBytes);
      await migrations.applyVerifiedMigration032(client, { migrationBytes, schemaName: schema });
      await expect(migrations.verifySchema032Structure(client, { schemaName: schema })).resolves.toBeUndefined();
      await expect(migrations.verifyRequiredSchema032(client, checksumSha256, {
        schemaName: schema
      })).resolves.toMatchObject({ verified: true, checksumSha256 });
      await expect(migrations.applyVerifiedMigration032(client, {
        migrationBytes,
        schemaName: schema
      })).resolves.toMatchObject({
        status: "already_verified"
      });

      const receipts = await client.query(
        "select version, filename, checksum_sha256 from schema_migration_receipts where version = 32"
      );
      expect(receipts.rows).toHaveLength(1);
      expect(receipts.rows[0]).toMatchObject({
        version: 32,
        filename: "032_telegram_runtime_forensics_data_contracts.sql"
      });
      expect(receipts.rows[0].checksum_sha256).toMatch(/^[a-f0-9]{64}$/);

      const mutatedBytes = Buffer.concat([migrationBytes, Buffer.from("\n-- mutated same version\n")]);
      await expect(migrations.applyVerifiedMigration032(client, {
        migrationBytes: mutatedBytes,
        schemaName: schema
      })).rejects.toThrow(
        "schema_032_checksum_mismatch"
      );

      await client.query("drop index idx_wallet_approvals_allowance_refresh");
      await expect(migrations.verifySchema032Structure(client, {
        schemaName: schema
      })).rejects.toThrow("schema_032_index_missing");

      await client.query(`create schema "${failureSchema}"`);
      await client.query(`set search_path to "${failureSchema}"`);
      await installApprovalBaseline(client);
      const invalidBytes = Buffer.concat([migrationBytes, Buffer.from("\nselect * from plan1_missing_relation;\n")]);
      await expect(migrations.applyVerifiedMigration032(client, {
        migrationBytes: invalidBytes,
        schemaName: failureSchema
      })).rejects.toThrow();
      const receiptTable = await client.query(
        "select to_regclass('schema_migration_receipts') as receipt_table"
      );
      if (receiptTable.rows[0]?.receipt_table) {
        const failedReceipts = await client.query("select * from schema_migration_receipts where version = 32");
        expect(failedReceipts.rows).toHaveLength(0);
      }
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${failureSchema}" cascade`).catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
