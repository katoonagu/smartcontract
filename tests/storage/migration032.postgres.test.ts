import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  ALLOWANCE_FRESHNESS_MS,
  UINT256_MAX_RAW,
  validateApprovalAllowanceStateV2
} from "../../src/approvals/allowanceState";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { saveWalletApprovalAllowanceStateV2 } from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { ApprovalAllowanceStateV2 } from "../../src/types";

const required = process.env.REQUIRE_PLAN1_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
if (required && !connectionString) {
  throw new Error("PLAN1 PostgreSQL acceptance requires TEST_DATABASE_URL");
}

const postgresDescribe = connectionString ? describe : describe.skip;

async function installApprovalBaseline(client: pg.PoolClient): Promise<void> {
  await client.query("create table watched_wallets (id text primary key, address text not null)");
  await client.query(readFileSync("migrations/006_approval_guard.sql", "utf8"));
}

postgresDescribe("migration 032 PostgreSQL acceptance", () => {
  it("[REQ-38][DATA] applies, receipts, verifies and fails closed transactionally", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `plan1_${randomUUID().replaceAll("-", "")}`;
    const failureSchema = `${schema}_rollback`;
    const partialSchema = `${schema}_partial`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await installApprovalBaseline(client);
      await client.query(
        "insert into watched_wallets (id, address) values ('legacy-wallet', 'TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD')"
      );
      await client.query(`insert into observed_approval_events (
        approval_tx_hash, watched_wallet_id, owner_address, token_contract,
        spender_address, spender_type, amount_raw, is_unlimited, approval_at
      ) values (
        'legacy-event-approval', 'legacy-wallet', 'TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD', $1,
        'TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK', 'contract', '99', true,
        '2026-07-12T11:55:00.000Z'
      )`, [TRON_USDT_CONTRACT_ADDRESS]);
      await client.query(`insert into wallet_approvals (
        watched_wallet_id, token_contract, spender_address, amount_raw,
        is_unlimited, current_allowance_raw, status, last_approval_tx_hash, last_approval_at
      ) values (
        'legacy-wallet', $1, 'TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK', '99', true, '99', 'active',
        'legacy-event-approval', '2026-07-12T11:55:00.000Z'
      )`, [
        TRON_USDT_CONTRACT_ADDRESS
      ]);
      console.log(`[PLAN1_PG_TEMP_SCHEMA] ${schema}`);

      // Intentionally dynamic: Task 1 proves PostgreSQL was reached before the missing implementation fails RED.
      const migrations = await import("../../src/storage/schemaMigrations");
      const migrationBytes = readFileSync(`migrations/${migrations.SCHEMA_032_FILENAME}`);

      const checksumSha256 = await migrations.checksumMigrationBytes(migrationBytes);
      await migrations.applyVerifiedMigration032(client, { migrationBytes, schemaName: schema });
      await expect(migrations.verifySchema032Structure(client, { schemaName: schema })).resolves.toBeUndefined();
      await expect(migrations.verifyRequiredSchema032(client, checksumSha256, {
        schemaName: schema
      })).resolves.toMatchObject({ verified: true, checksumSha256 });
      await expect(client.query(`select amount_raw, last_approval_tx_hash,
        allowance_confirmed_raw, allowance_check_status, current_allowance_raw,
        is_unlimited, status from wallet_approvals
        where watched_wallet_id = 'legacy-wallet'`)).resolves.toMatchObject({
        rows: [{
          amount_raw: "99",
          last_approval_tx_hash: "legacy-event-approval",
          allowance_confirmed_raw: null,
          allowance_check_status: "stale",
          current_allowance_raw: "0",
          is_unlimited: false,
          status: "unknown"
        }]
      });
      await client.query(`update wallet_approvals set
        allowance_confirmed_raw = '0',
        allowance_check_status = 'confirmed_zero',
        allowance_checked_at = statement_timestamp(),
        allowance_fresh_until = statement_timestamp() + interval '15 minutes',
        allowance_last_attempt_at = statement_timestamp(),
        current_allowance_raw = '0',
        is_unlimited = false,
        status = 'revoked'
        where watched_wallet_id = 'legacy-wallet'`);
      await expect(migrations.applyVerifiedMigration032(client, {
        migrationBytes,
        schemaName: schema
      })).resolves.toMatchObject({
        status: "already_verified"
      });
      const preserved = await client.query(
        "select allowance_check_status from wallet_approvals where watched_wallet_id = 'legacy-wallet'"
      );
      expect(preserved.rows[0]?.allowance_check_status).toBe("confirmed_zero");

      const migration033Bytes = readFileSync(
        `migrations/${migrations.REQUIRED_SCHEMA_FILENAME}`
      );
      await expect(migrations.applyVerifiedTrackedMigration(client, {
        version: 33,
        filename: migrations.REQUIRED_SCHEMA_FILENAME,
        migrationBytes: migration033Bytes,
        requiredSchema032Checksum: checksumSha256,
        schemaName: schema
      })).resolves.toMatchObject({ status: "applied", version: 33 });
      await expect(migrations.applyVerifiedTrackedMigration(client, {
        version: 33,
        filename: migrations.REQUIRED_SCHEMA_FILENAME,
        migrationBytes: migration033Bytes,
        requiredSchema032Checksum: checksumSha256,
        schemaName: schema
      })).resolves.toMatchObject({ status: "already_verified", version: 33 });
      const receipt033 = await client.query(
        "select filename from schema_migration_receipts where version = 33"
      );
      expect(receipt033.rows).toEqual([{ filename: migrations.REQUIRED_SCHEMA_FILENAME }]);

      await client.query(`update wallet_approvals set
        allowance_confirmed_raw = '1',
        allowance_check_status = 'confirmed_active',
        allowance_checked_at = '2020-01-01T00:00:00.000Z',
        allowance_fresh_until = '2020-01-01T00:15:00.000Z',
        allowance_last_attempt_at = '2020-01-01T00:00:00.000Z',
        current_allowance_raw = '1',
        is_unlimited = false,
        status = 'active'
        where watched_wallet_id = 'legacy-wallet'`);
      await expect(migrations.verifyRequiredSchema032(client, checksumSha256, {
        schemaName: schema
      })).resolves.toMatchObject({ verified: true });
      expect(validateApprovalAllowanceStateV2({
        version: "approval-allowance-v2",
        ownerAddress: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
        spenderAddress: "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK",
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        confirmedAllowanceRaw: "1",
        isUnlimited: false,
        state: "confirmed_active",
        confirmedAt: "2020-01-01T00:00:00.000Z",
        freshUntil: "2020-01-01T00:15:00.000Z",
        lastAttemptAt: "2020-01-01T00:00:00.000Z",
        failureCode: null,
        source: "official_usdt_allowance",
        observedApprovalTxHash: null
      }, new Date("2020-01-01T01:00:00.000Z"))).toMatchObject({
        state: "stale",
        isUnlimited: null
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
      await expect(migrations.applyVerifiedMigration032(client, {
        migrationBytes,
        schemaName: schema
      })).rejects.toThrow("schema_032_index_missing");

      await client.query(`create schema "${partialSchema}"`);
      await client.query(`set search_path to "${partialSchema}"`);
      await installApprovalBaseline(client);
      await client.query("alter table wallet_approvals add column allowance_confirmed_raw text");
      await expect(migrations.applyVerifiedMigration032(client, {
        migrationBytes,
        schemaName: partialSchema
      })).resolves.toMatchObject({ status: "applied", verified: true });
      const recoveredReceipt = await client.query(
        "select checksum_sha256 from schema_migration_receipts where version = 32"
      );
      expect(recoveredReceipt.rows).toHaveLength(1);

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
      await client.query(`drop schema if exists "${partialSchema}" cascade`).catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it("[REQ-19][REQ-38][DATA-COMPAT] keeps rollback mirrors conservative and atomic on real PostgreSQL", async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    const schema = `plan1_compat_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await installApprovalBaseline(client);
      await client.query(
        "insert into watched_wallets (id, address) values ('compat-wallet', 'TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD')"
      );

      const migrations = await import("../../src/storage/schemaMigrations");
      const migrationBytes = readFileSync(`migrations/${migrations.SCHEMA_032_FILENAME}`);
      await migrations.applyVerifiedMigration032(client, { migrationBytes, schemaName: schema });

      const legacyColumns = await client.query(
        `select column_name, is_nullable
           from information_schema.columns
          where table_schema = $1
            and table_name = 'wallet_approvals'
            and column_name = any($2::text[])
          order by column_name`,
        [schema, ["current_allowance_raw", "is_unlimited", "status"]]
      );
      expect(legacyColumns.rows).toEqual([
        { column_name: "current_allowance_raw", is_nullable: "NO" },
        { column_name: "is_unlimited", is_nullable: "NO" },
        { column_name: "status", is_nullable: "NO" }
      ]);

      const now = new Date(Date.now() - 60_000);
      const freshUntil = new Date(now.getTime() + ALLOWANCE_FRESHNESS_MS);
      const state = (
        spenderAddress: string,
        overrides: Partial<ApprovalAllowanceStateV2>
      ): ApprovalAllowanceStateV2 => ({
        version: "approval-allowance-v2",
        ownerAddress: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
        spenderAddress,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        confirmedAllowanceRaw: null,
        isUnlimited: null,
        state: "stale",
        confirmedAt: null,
        freshUntil: null,
        lastAttemptAt: null,
        failureCode: null,
        source: "official_usdt_allowance",
        observedApprovalTxHash: null,
        ...overrides
      });
      const states: ApprovalAllowanceStateV2[] = [
        state("TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK", {
          confirmedAllowanceRaw: UINT256_MAX_RAW,
          isUnlimited: true,
          state: "confirmed_active",
          confirmedAt: now.toISOString(),
          freshUntil: freshUntil.toISOString(),
          lastAttemptAt: now.toISOString()
        }),
        state("TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ", {
          confirmedAllowanceRaw: "0",
          isUnlimited: false,
          state: "confirmed_zero",
          confirmedAt: now.toISOString(),
          freshUntil: freshUntil.toISOString(),
          lastAttemptAt: now.toISOString()
        }),
        state("TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ", {
          state: "failed",
          lastAttemptAt: now.toISOString(),
          failureCode: "provider_unavailable"
        }),
        state("TXka46PPwttNPWfFDPtt3GUodbPThyufaV", {})
      ];
      for (const allowance of states) {
        await saveWalletApprovalAllowanceStateV2(client as unknown as Db, {
          watchedWalletId: "compat-wallet",
          allowance
        });
      }

      const persisted = await client.query(`select spender_address,
        allowance_confirmed_raw, allowance_check_status, current_allowance_raw,
        is_unlimited, status
        from wallet_approvals where watched_wallet_id = 'compat-wallet'
        order by spender_address`);
      const bySpender = Object.fromEntries(
        persisted.rows.map((row) => [row.spender_address, row])
      );
      expect(bySpender.TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK).toEqual({
        spender_address: "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK",
        allowance_confirmed_raw: UINT256_MAX_RAW,
        allowance_check_status: "confirmed_active",
        current_allowance_raw: UINT256_MAX_RAW,
        is_unlimited: true,
        status: "active"
      });
      expect(bySpender.TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ).toEqual({
        spender_address: "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ",
        allowance_confirmed_raw: "0",
        allowance_check_status: "confirmed_zero",
        current_allowance_raw: "0",
        is_unlimited: false,
        status: "revoked"
      });
      expect(bySpender.TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ).toEqual({
        spender_address: "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ",
        allowance_confirmed_raw: null,
        allowance_check_status: "failed",
        current_allowance_raw: "0",
        is_unlimited: false,
        status: "unknown"
      });
      expect(bySpender.TXka46PPwttNPWfFDPtt3GUodbPThyufaV).toEqual({
        spender_address: "TXka46PPwttNPWfFDPtt3GUodbPThyufaV",
        allowance_confirmed_raw: null,
        allowance_check_status: "stale",
        current_allowance_raw: "0",
        is_unlimited: false,
        status: "unknown"
      });
    } finally {
      await client.query("reset search_path").catch(() => undefined);
      await client.query(`drop schema if exists "${schema}" cascade`).catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
