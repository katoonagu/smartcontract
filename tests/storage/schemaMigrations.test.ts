import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/db";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  SCHEMA_MIGRATION_LOCK_ID,
  type Schema032Verification,
  checksumMigrationBytes,
  verifyRequiredSchema032,
  verifySchema032Structure
} from "../../src/storage/schemaMigrations";

const CHECKSUM = "a".repeat(64);
const REQUIRED_CONSTRAINTS = [
  "schema_migration_receipts_checksum_check",
  "wallet_approvals_allowance_status_v2_check",
  "wallet_approvals_allowance_uint256_v2_check",
  "wallet_approvals_allowance_shape_v2_check",
  "wallet_approvals_allowance_failure_v2_check",
  "wallet_approvals_allowance_timestamps_v2_check"
] as const;

const REQUIRED_CONSTRAINT_DEFINITIONS = {
  schema_migration_receipts_checksum_check:
    "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))",
  wallet_approvals_allowance_status_v2_check:
    "CHECK ((allowance_check_status = ANY (ARRAY['confirmed_active'::text, 'confirmed_zero'::text, 'failed'::text, 'stale'::text])))",
  wallet_approvals_allowance_uint256_v2_check:
    "CHECK (((allowance_confirmed_raw IS NULL) OR ((allowance_confirmed_raw ~ '^(0|[1-9][0-9]*)$'::text) AND ((length(allowance_confirmed_raw) < 78) OR ((length(allowance_confirmed_raw) = 78) AND (allowance_confirmed_raw <= '115792089237316195423570985008687907853269984665640564039457584007913129639935'::text))))))",
  wallet_approvals_allowance_shape_v2_check:
    "CHECK ((((allowance_check_status = 'confirmed_active'::text) AND (allowance_confirmed_raw IS NOT NULL) AND (allowance_confirmed_raw <> '0'::text) AND (current_allowance_raw = allowance_confirmed_raw) AND (is_unlimited = (allowance_confirmed_raw = '115792089237316195423570985008687907853269984665640564039457584007913129639935'::text)) AND (status = 'active'::text)) OR ((allowance_check_status = 'confirmed_zero'::text) AND (allowance_confirmed_raw IS NOT NULL) AND (allowance_confirmed_raw = '0'::text) AND (current_allowance_raw = '0'::text) AND (is_unlimited = false) AND (status = 'revoked'::text)) OR ((allowance_check_status = ANY (ARRAY['failed'::text, 'stale'::text])) AND (current_allowance_raw = '0'::text) AND (is_unlimited = false) AND (status = 'unknown'::text))))",
  wallet_approvals_allowance_failure_v2_check:
    "CHECK ((((allowance_check_status = 'failed'::text) AND (allowance_failure_code IS NOT NULL) AND (allowance_failure_code = ANY (ARRAY['provider_timeout'::text, 'provider_unavailable'::text, 'malformed_response'::text, 'contract_call_reverted'::text, 'network_mismatch'::text, 'subject_binding_failed'::text, 'unknown_provider_error'::text]))) OR ((allowance_check_status <> 'failed'::text) AND (allowance_failure_code IS NULL))))",
  wallet_approvals_allowance_timestamps_v2_check:
    "CHECK ((((allowance_check_status = ANY (ARRAY['confirmed_active'::text, 'confirmed_zero'::text])) AND (allowance_checked_at IS NOT NULL) AND (allowance_last_attempt_at IS NOT NULL) AND (allowance_fresh_until IS NOT NULL) AND (allowance_last_attempt_at = allowance_checked_at) AND (allowance_fresh_until = (allowance_checked_at + '00:15:00'::interval))) OR ((allowance_check_status = 'failed'::text) AND (allowance_last_attempt_at IS NOT NULL) AND (((allowance_confirmed_raw IS NULL) AND (allowance_checked_at IS NULL) AND (allowance_fresh_until IS NULL)) OR ((allowance_confirmed_raw IS NOT NULL) AND (allowance_checked_at IS NOT NULL) AND (allowance_fresh_until IS NOT NULL) AND (allowance_last_attempt_at >= allowance_checked_at) AND (allowance_fresh_until = (allowance_checked_at + '00:15:00'::interval))))) OR ((allowance_check_status = 'stale'::text) AND (((allowance_confirmed_raw IS NULL) AND (allowance_checked_at IS NULL) AND (allowance_fresh_until IS NULL) AND (allowance_last_attempt_at IS NULL)) OR ((allowance_confirmed_raw IS NOT NULL) AND (allowance_checked_at IS NOT NULL) AND (allowance_fresh_until IS NOT NULL) AND (allowance_last_attempt_at = allowance_checked_at) AND (allowance_fresh_until = (allowance_checked_at + '00:15:00'::interval)))))))"
} as const;

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

function schemaDb(overrides: Partial<Record<string, QueryResult>> = {}): Db {
  const results: Record<string, QueryResult> = {
    schema_migration_receipts: {
      rows: [{ version: 32, filename: "032_telegram_runtime_forensics_data_contracts.sql", checksum_sha256: CHECKSUM }]
    },
    information_schema_columns: {
      rows: [
        { table_name: "schema_migration_receipts", column_name: "version", data_type: "integer", is_nullable: "NO", column_default: null },
        { table_name: "schema_migration_receipts", column_name: "filename", data_type: "text", is_nullable: "NO", column_default: null },
        { table_name: "schema_migration_receipts", column_name: "checksum_sha256", data_type: "text", is_nullable: "NO", column_default: null },
        { table_name: "schema_migration_receipts", column_name: "applied_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
        { table_name: "wallet_approvals", column_name: "allowance_confirmed_raw", data_type: "text", is_nullable: "YES", column_default: null },
        { table_name: "wallet_approvals", column_name: "allowance_check_status", data_type: "text", is_nullable: "NO", column_default: "'stale'::text" },
        { table_name: "wallet_approvals", column_name: "allowance_checked_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { table_name: "wallet_approvals", column_name: "allowance_fresh_until", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { table_name: "wallet_approvals", column_name: "allowance_last_attempt_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { table_name: "wallet_approvals", column_name: "allowance_failure_code", data_type: "text", is_nullable: "YES", column_default: null }
      ]
    },
    pg_constraint: {
      rows: [
        { conname: "schema_migration_receipts_pkey", contype: "p" },
        { conname: "schema_migration_receipts_filename_key", contype: "u" },
        ...REQUIRED_CONSTRAINTS.map((conname) => ({
          conname,
          contype: "c",
          definition: REQUIRED_CONSTRAINT_DEFINITIONS[conname]
        }))
      ]
    },
    pg_indexes: {
      rows: [{
        indexname: "idx_wallet_approvals_allowance_refresh",
        columns: ["allowance_check_status", "allowance_fresh_until"]
      }]
    },
    legacy_backfill: { rows: [{ false_confirmed_count: "0" }] },
    ...overrides
  };
  return {
    query: async (sql: string) => {
      const normalized = sql.toLowerCase();
      const key = normalized.includes("information_schema.columns")
        ? "information_schema_columns"
        : normalized.includes("pg_constraint")
          ? "pg_constraint"
          : normalized.includes("pg_indexes") || normalized.includes("pg_index")
            ? "pg_indexes"
            : normalized.includes("false_confirmed") || normalized.includes("current_allowance_raw")
              ? "legacy_backfill"
              : "schema_migration_receipts";
      const result = results[key] ?? { rows: [] };
      return { rowCount: result.rowCount ?? result.rows.length, rows: result.rows };
    }
  } as unknown as Db;
}

describe("verified schema 032 metadata", () => {
  it("pins exact migration constants, lock and byte checksum", async () => {
    expect(REQUIRED_SCHEMA_VERSION).toBe(32);
    expect(REQUIRED_SCHEMA_FILENAME).toBe("032_telegram_runtime_forensics_data_contracts.sql");
    expect(SCHEMA_MIGRATION_LOCK_ID).toBe(20260712032n);
    await expect(checksumMigrationBytes(Buffer.from("a\nb\n"))).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(await checksumMigrationBytes(Buffer.from("a\nb\n"))).not.toBe(
      await checksumMigrationBytes(Buffer.from("a\r\nb\r\n"))
    );
  });

  it("verifies the exact receipt checksum and all schema 032 postconditions", async () => {
    const verification: Schema032Verification = await verifyRequiredSchema032(schemaDb(), CHECKSUM);
    expect(verification).toMatchObject({
      version: 32,
      filename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: CHECKSUM,
      shortChecksum: CHECKSUM.slice(0, 12),
      verified: true
    });
  });

  it("verifies required columns, six named constraints and ordered refresh index", async () => {
    await expect(verifySchema032Structure(schemaDb())).resolves.toBeUndefined();
    expect(REQUIRED_CONSTRAINTS).toHaveLength(6);
  });

  it("rejects checksum mismatch and a missing receipt", async () => {
    await expect(verifyRequiredSchema032(schemaDb(), "b".repeat(64))).rejects.toThrow("schema_032_checksum_mismatch");
    await expect(verifyRequiredSchema032(
      schemaDb({ schema_migration_receipts: { rows: [] } }),
      CHECKSUM
    )).rejects.toThrow("schema_032_receipt_missing");
  });

  it("rejects a missing named constraint, wrong column default and wrong ordered index", async () => {
    await expect(verifySchema032Structure(schemaDb({
      pg_constraint: { rows: REQUIRED_CONSTRAINTS.slice(1).map((conname) => ({
        conname,
        contype: "c",
        definition: REQUIRED_CONSTRAINT_DEFINITIONS[conname]
      })) }
    }))).rejects.toThrow("schema_032_constraint_missing");
    await expect(verifySchema032Structure(schemaDb({
      pg_constraint: { rows: REQUIRED_CONSTRAINTS.map((conname) => ({
        conname,
        contype: "c",
        definition: conname === "wallet_approvals_allowance_shape_v2_check"
          ? "CHECK (true)"
          : REQUIRED_CONSTRAINT_DEFINITIONS[conname]
      })) }
    }))).rejects.toThrow("schema_032_constraint_definition_mismatch");
    await expect(verifySchema032Structure(schemaDb({
      information_schema_columns: { rows: [{
        table_name: "wallet_approvals",
        column_name: "allowance_check_status",
        data_type: "text",
        is_nullable: "NO",
        column_default: "'confirmed_active'::text"
      }] }
    }))).rejects.toThrow("schema_032_column_mismatch");
    await expect(verifySchema032Structure(schemaDb({
      pg_indexes: { rows: [{
        indexname: "idx_wallet_approvals_allowance_refresh",
        columns: ["allowance_fresh_until", "allowance_check_status"]
      }] }
    }))).rejects.toThrow("schema_032_index_mismatch");
  });

  it("[REQ-38][DATA] pins migration SQL to stable LF bytes", () => {
    const attributesPath = ".gitattributes";
    const attributesExist = existsSync(attributesPath);
    const attributesBytes = attributesExist ? readFileSync(attributesPath) : Buffer.alloc(0);
    expect(attributesExist).toBe(true);
    const attributes = new TextDecoder("utf-8", { fatal: true }).decode(attributesBytes);
    expect(attributes).toMatch(/^\/migrations\/\*\.sql text eol=lf$/m);
    const migrationPath = `migrations/${REQUIRED_SCHEMA_FILENAME}`;
    const exists = existsSync(migrationPath);
    const bytes = exists ? readFileSync(migrationPath) : Buffer.alloc(0);
    expect(exists).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes(13)).toBe(false);
    const migrationSql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(migrationSql).toContain("schema_migration_receipts");
    const backfill = /update wallet_approvals([\s\S]*?)alter table wallet_approvals alter column allowance_check_status/i.exec(migrationSql)?.[1];
    expect(backfill).toContain("allowance_check_status = 'stale'");
    expect(backfill).toContain("allowance_confirmed_raw = null");
    expect(backfill).toContain("current_allowance_raw = '0'");
    expect(backfill).toContain("is_unlimited = false");
    expect(backfill).toContain("status = 'unknown'");
    expect(backfill).not.toMatch(/where\s+allowance_check_status/i);
  });
});
