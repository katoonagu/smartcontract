import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/db";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  SCHEMA_033_FILENAME,
  SCHEMA_033_VERSION,
  SCHEMA_034_FILENAME,
  SCHEMA_034_VERSION,
  SCHEMA_032_FILENAME,
  SCHEMA_032_VERSION,
  SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE,
  SCHEMA_MIGRATION_LOCK_ID,
  type Schema032Verification,
  checksumMigrationBytes,
  projectSchema033CatalogAfter034,
  verifyRequiredSchema032,
  verifyRequiredSchema034,
  verifySchema032Structure,
  verifySchema034Structure,
  verifyTrackedMigrationReceipt
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

type QueryResult = {
  rows?: Record<string, unknown>[];
  pages?: Record<string, unknown>[][];
  rowCount?: number;
};

function schemaDb(overrides: Partial<Record<string, QueryResult>> = {}): Db {
  const calls: Record<string, number> = {};
  const valuesByKey: Record<string, unknown[][]> = {};
  const results: Record<string, QueryResult> = {
    schema_migration_receipts: {
      rows: [{ version: 32, filename: "032_telegram_runtime_forensics_data_contracts.sql", checksum_sha256: CHECKSUM }]
    },
    to_regclass: { rows: [{ receipt_table: "schema_migration_receipts" }] },
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
        { conname: "schema_migration_receipts_pkey", contype: "p", convalidated: true, table_name: "schema_migration_receipts", definition: "PRIMARY KEY (version)" },
        { conname: "schema_migration_receipts_filename_key", contype: "u", convalidated: true, table_name: "schema_migration_receipts", definition: "UNIQUE (filename)" },
        ...REQUIRED_CONSTRAINTS.map((conname) => ({
          conname,
          contype: "c",
          convalidated: true,
          table_name: conname === "schema_migration_receipts_checksum_check"
            ? "schema_migration_receipts"
            : "wallet_approvals",
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
    legacy_backfill: { rows: [{ false_confirmed_count: "0", stale_not_expired_count: "0" }] },
    evaluation_time: { rows: [{ evaluated_at: new Date("2026-07-13T00:00:00.000Z") }] },
    allowance_states: { rows: [] },
    ...overrides
  };
  return {
    query: async (sql: string, values?: unknown[]) => {
      const normalized = sql.toLowerCase();
      const key = normalized.includes("information_schema.columns")
        ? "information_schema_columns"
        : normalized.includes("to_regclass")
          ? "to_regclass"
        : normalized.includes("pg_constraint")
          ? "pg_constraint"
          : normalized.includes("statement_timestamp() as evaluated_at")
            ? "evaluation_time"
          : normalized.includes("join") && normalized.includes("watched_wallets")
            ? "allowance_states"
          : normalized.includes("pg_indexes") || normalized.includes("pg_index")
            ? "pg_indexes"
            : normalized.includes("false_confirmed") || normalized.includes("current_allowance_raw")
              ? "legacy_backfill"
              : "schema_migration_receipts";
      const result = results[key] ?? { rows: [] };
      calls[key] = (calls[key] ?? 0) + 1;
      valuesByKey[key] ??= [];
      valuesByKey[key].push(values ?? []);
      const rows = result.pages?.[calls[key] - 1] ?? result.rows ?? [];
      return { rowCount: result.rowCount ?? rows.length, rows };
    },
    __calls: calls,
    __values: valuesByKey
  } as unknown as Db;
}

const PLANNER_COLUMNS = [
  ["run_id", "text", "NO", null],
  ["canonical_sequence", "bigint", "NO", null],
  ["task_id", "text", "NO", null],
  ["planner_state", "text", "NO", null],
  ["result_bytes", "bigint", "YES", null],
  ["admitted_at", "timestamp with time zone", "YES", null],
  ["reserved_bytes", "bigint", "YES", null],
  ["planned_at", "timestamp with time zone", "NO", "statement_timestamp()"],
  ["ready_at", "timestamp with time zone", "YES", null],
  ["committed_at", "timestamp with time zone", "YES", null]
] as const;

const PLANNER_STATE_SHAPE = "CHECK ((((planner_state = 'planned'::text) AND (result_bytes IS NULL) AND (ready_at IS NULL) AND (committed_at IS NULL) AND (((admitted_at IS NULL) AND (reserved_bytes IS NULL)) OR ((admitted_at IS NOT NULL) AND (reserved_bytes IS NOT NULL)))) OR ((planner_state = 'ready'::text) AND (admitted_at IS NOT NULL) AND (reserved_bytes IS NULL) AND (result_bytes IS NOT NULL) AND (ready_at IS NOT NULL) AND (committed_at IS NULL)) OR ((planner_state = 'committed'::text) AND (admitted_at IS NOT NULL) AND (reserved_bytes IS NULL) AND (result_bytes IS NOT NULL) AND (ready_at IS NOT NULL) AND (committed_at IS NOT NULL))))";

const PLANNER_CONSTRAINTS = [
  ["unified_check_runs_fairness_owner_not_blank_check", "unified_check_runs", "c", "CHECK ((btrim(fairness_owner_id) <> ''::text))"],
  ["unified_check_tasks_run_id_id_key", "unified_check_tasks", "u", "UNIQUE (run_id, id)"],
  ["unified_check_planner_entries_pkey", "unified_check_planner_entries", "p", "PRIMARY KEY (run_id, canonical_sequence)"],
  ["unified_check_planner_entries_run_id_task_id_key", "unified_check_planner_entries", "u", "UNIQUE (run_id, task_id)"],
  ["unified_check_planner_entries_run_id_fkey", "unified_check_planner_entries", "f", "FOREIGN KEY (run_id) REFERENCES unified_check_runs(id)"],
  ["unified_check_planner_entries_run_task_fk", "unified_check_planner_entries", "f", "FOREIGN KEY (run_id, task_id) REFERENCES unified_check_tasks(run_id, id)"],
  ["unified_check_planner_entries_canonical_sequence_check", "unified_check_planner_entries", "c", "CHECK ((canonical_sequence >= 0))"],
  ["unified_check_planner_entries_result_bytes_check", "unified_check_planner_entries", "c", "CHECK (((result_bytes IS NULL) OR (result_bytes >= 0)))"],
  ["unified_check_planner_entries_reserved_bytes_check", "unified_check_planner_entries", "c", "CHECK (((reserved_bytes IS NULL) OR (reserved_bytes >= 0)))"],
  ["unified_check_planner_entries_state_check", "unified_check_planner_entries", "c", "CHECK ((planner_state = ANY (ARRAY['planned'::text, 'ready'::text, 'committed'::text])))"],
  ["unified_check_planner_entries_state_shape_check", "unified_check_planner_entries", "c", PLANNER_STATE_SHAPE],
  ["unified_check_planner_entries_timestamp_order_check", "unified_check_planner_entries", "c", "CHECK ((((admitted_at IS NULL) OR (admitted_at >= planned_at)) AND ((ready_at IS NULL) OR (ready_at >= admitted_at)) AND ((committed_at IS NULL) OR (committed_at >= ready_at))))"]
] as const;

function schema034Db(options?: {
  stateShape?: string;
  foreignSchema?: string;
  taskForeignKeyDeleteAction?: string;
}): Db {
  let informationSchemaCall = 0;
  return {
    query: async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        informationSchemaCall += 1;
        return {
          rows: informationSchemaCall === 1
            ? PLANNER_COLUMNS.map(([column_name, data_type, is_nullable, column_default]) => ({
              column_name, data_type, is_nullable, column_default
            }))
            : [{ data_type: "text", is_nullable: "NO", column_default: null }]
        };
      }
      if (sql.includes("pg_constraint")) {
        return {
          rows: PLANNER_CONSTRAINTS.map(([conname, table_name, contype, definition]) => ({
            conname,
            table_name,
            contype,
            convalidated: true,
            definition: conname === "unified_check_planner_entries_state_shape_check"
              ? options?.stateShape ?? definition
              : definition,
            columns: conname === "unified_check_tasks_run_id_id_key"
              ? ["run_id", "id"]
              : conname === "unified_check_planner_entries_pkey"
                ? ["run_id", "canonical_sequence"]
                : conname === "unified_check_planner_entries_run_id_task_id_key"
                  ? ["run_id", "task_id"]
                  : conname === "unified_check_planner_entries_run_id_fkey"
                    ? ["run_id"]
                    : conname === "unified_check_planner_entries_run_task_fk"
                      ? ["run_id", "task_id"]
                      : null,
            foreign_table_name: conname === "unified_check_planner_entries_run_id_fkey"
              ? "unified_check_runs"
              : conname === "unified_check_planner_entries_run_task_fk"
                ? "unified_check_tasks"
                : null,
            foreign_columns: conname === "unified_check_planner_entries_run_id_fkey"
              ? ["id"]
              : conname === "unified_check_planner_entries_run_task_fk"
                ? ["run_id", "id"]
                : null,
            foreign_schema_name: conname === "unified_check_planner_entries_run_id_fkey" ||
              conname === "unified_check_planner_entries_run_task_fk"
              ? options?.foreignSchema ?? "public"
              : null,
            foreign_match_type: conname === "unified_check_planner_entries_run_id_fkey" ||
              conname === "unified_check_planner_entries_run_task_fk" ? "s" : null,
            foreign_update_type: conname === "unified_check_planner_entries_run_id_fkey" ||
              conname === "unified_check_planner_entries_run_task_fk" ? "a" : null,
            foreign_delete_type: conname === "unified_check_planner_entries_run_task_fk"
              ? options?.taskForeignKeyDeleteAction ?? "a"
              : conname === "unified_check_planner_entries_run_id_fkey" ? "a" : null,
            condeferrable: false,
            condeferred: false
          }))
        };
      }
      if (sql.includes("pg_indexes")) {
        return {
          rows: [
            ["unified_check_planner_entries_next_uncommitted_idx", "CREATE INDEX x ON y (run_id, canonical_sequence) WHERE (planner_state <> 'committed'::text)"],
            ["unified_check_planner_entries_ready_prefix_idx", "CREATE INDEX x ON y (run_id, canonical_sequence) WHERE (planner_state = 'ready'::text)"],
            ["unified_check_planner_entries_admitted_task_idx", "CREATE INDEX x ON y (run_id, task_id) WHERE ((planner_state = 'planned'::text) AND (admitted_at IS NOT NULL))"],
            ["unified_check_planner_entries_buffer_aggregate_idx", "CREATE INDEX x ON y (run_id, planner_state) INCLUDE (result_bytes, reserved_bytes, ready_at, admitted_at)"]
          ].map(([indexname, indexdef]) => ({ indexname, indexdef }))
        };
      }
      return { rows: [] };
    }
  } as unknown as Db;
}

describe("verified schema 032 metadata", () => {
  it("pins exact migration constants, lock and byte checksum", async () => {
    expect(SCHEMA_032_VERSION).toBe(32);
    expect(SCHEMA_032_FILENAME).toBe("032_telegram_runtime_forensics_data_contracts.sql");
    expect(SCHEMA_033_VERSION).toBe(33);
    expect(SCHEMA_033_FILENAME).toBe("033_unified_wallet_check.sql");
    expect(SCHEMA_034_VERSION).toBe(34);
    expect(REQUIRED_SCHEMA_VERSION).toBe(34);
    expect(REQUIRED_SCHEMA_FILENAME).toBe("034_unified_check_adaptive_planner.sql");
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
    await expect(verifyRequiredSchema032(
      schemaDb({ to_regclass: { rows: [{ receipt_table: null }] } }),
      CHECKSUM
    )).rejects.toThrow("schema_032_receipt_missing");
    await expect(verifyRequiredSchema032(schemaDb(), "A".repeat(64))).rejects.toThrow(
      "schema_032_invalid_expected_checksum"
    );
  });

  it("rejects a missing named constraint, wrong column default and wrong ordered index", async () => {
    await expect(verifySchema032Structure(schemaDb({
      pg_constraint: { rows: REQUIRED_CONSTRAINTS.slice(1).map((conname) => ({
        conname,
        contype: "c",
        convalidated: true,
        table_name: "wallet_approvals",
        definition: REQUIRED_CONSTRAINT_DEFINITIONS[conname]
      })) }
    }))).rejects.toThrow("schema_032_constraint_missing");
    await expect(verifySchema032Structure(schemaDb({
      pg_constraint: { rows: REQUIRED_CONSTRAINTS.map((conname) => ({
        conname,
        contype: "c",
        convalidated: true,
        table_name: conname === "schema_migration_receipts_checksum_check"
          ? "schema_migration_receipts"
          : "wallet_approvals",
        definition: conname === "wallet_approvals_allowance_shape_v2_check"
          ? "CHECK (true)"
          : REQUIRED_CONSTRAINT_DEFINITIONS[conname]
      })) }
    }))).rejects.toThrow("schema_032_constraint_definition_mismatch");
    await expect(verifySchema032Structure(schemaDb({
      pg_constraint: { rows: [
        { conname: "schema_migration_receipts_pkey", contype: "p", convalidated: true, table_name: "schema_migration_receipts", definition: "PRIMARY KEY (version)" },
        { conname: "schema_migration_receipts_filename_key", contype: "u", convalidated: true, table_name: "schema_migration_receipts", definition: "UNIQUE (filename)" },
        ...REQUIRED_CONSTRAINTS.map((conname) => ({
          conname,
          contype: "c",
          convalidated: true,
          table_name: "wallet_approvals",
          definition: REQUIRED_CONSTRAINT_DEFINITIONS[conname]
        }))
      ] }
    }))).rejects.toThrow("schema_032_constraint_table_mismatch");
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

  it("accepts natural expiry but rejects malformed or premature authoritative allowance states", async () => {
    const baseRow = {
      watched_wallet_id: "wallet-1",
      owner_address: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      spender_address: "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK",
      token_contract: TRON_USDT_CONTRACT_ADDRESS,
      allowance_confirmed_raw: "1",
      allowance_check_status: "confirmed_active",
      allowance_checked_at: new Date("2020-01-01T00:00:00.000Z"),
      allowance_fresh_until: new Date("2020-01-01T00:15:00.000Z"),
      allowance_last_attempt_at: new Date("2020-01-01T00:00:00.000Z"),
      allowance_failure_code: null,
      last_approval_tx_hash: null
    };
    await expect(verifySchema032Structure(schemaDb({
      allowance_states: { rows: [baseRow] }
    }))).resolves.toBeUndefined();
    await expect(verifySchema032Structure(schemaDb({
      evaluation_time: { rows: [{ evaluated_at: new Date("2026-07-13T00:00:00.100Z") }] },
      allowance_states: { rows: [{
        ...baseRow,
        allowance_confirmed_raw: "0",
        allowance_check_status: "confirmed_zero",
        allowance_checked_at: new Date("2026-07-13T00:00:00.100Z"),
        allowance_fresh_until: new Date("2026-07-13T00:15:00.100Z"),
        allowance_last_attempt_at: new Date("2026-07-13T00:00:00.100Z")
      }] }
    }))).resolves.toBeUndefined();
    await expect(verifySchema032Structure(schemaDb({
      allowance_states: { rows: [{
        ...baseRow,
        allowance_check_status: "stale",
        allowance_checked_at: new Date("2099-01-01T00:00:00.000Z"),
        allowance_fresh_until: new Date("2099-01-01T00:15:00.000Z"),
        allowance_last_attempt_at: new Date("2099-01-01T00:00:00.000Z")
      }] }
    }))).rejects.toThrow("schema_032_allowance_state_invalid");
    await expect(verifySchema032Structure(schemaDb({
      allowance_states: { rows: [{
        ...baseRow,
        allowance_checked_at: new Date("2099-01-01T00:00:00.000Z"),
        allowance_fresh_until: new Date("2099-01-01T00:15:00.000Z"),
        allowance_last_attempt_at: new Date("2099-01-01T00:00:00.000Z")
      }] }
    }))).rejects.toThrow("schema_032_allowance_state_invalid");
    await expect(verifySchema032Structure(schemaDb({
      allowance_states: { rows: [{ ...baseRow, token_contract: "not-usdt" }] }
    }))).rejects.toThrow("schema_032_allowance_state_invalid");

    const pagedDb = schemaDb({
      allowance_states: {
        pages: [
          Array.from({ length: SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE }, () => ({ ...baseRow })),
          [{ ...baseRow, watched_wallet_id: "wallet-2" }]
        ]
      }
    });
    await expect(verifySchema032Structure(pagedDb)).resolves.toBeUndefined();
    expect(SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE).toBe(250);
    expect((pagedDb as unknown as { __calls: Record<string, number> }).__calls.allowance_states).toBe(2);
    expect((pagedDb as unknown as { __calls: Record<string, number> }).__calls.evaluation_time).toBe(1);
    const queryValues = (pagedDb as unknown as {
      __values: Record<string, unknown[][]>;
    }).__values.allowance_states;
    expect(queryValues.every((values) => values.at(-1) === SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE)).toBe(true);
  });

  it("rereads and exactly verifies tracked migration receipts", async () => {
    const exact = schemaDb({
      schema_migration_receipts: {
        rows: [{ version: 33, filename: "033_test.sql", checksum_sha256: CHECKSUM }]
      }
    });
    await expect(verifyTrackedMigrationReceipt(exact, {
      schemaName: "public",
      version: 33,
      filename: "033_test.sql",
      checksumSha256: CHECKSUM
    })).resolves.toBeUndefined();
    await expect(verifyTrackedMigrationReceipt(schemaDb({
      schema_migration_receipts: { rows: [] }
    }), {
      schemaName: "public",
      version: 33,
      filename: "033_test.sql",
      checksumSha256: CHECKSUM
    })).rejects.toThrow("schema_migration_receipt_missing");
    await expect(verifyTrackedMigrationReceipt(schemaDb({
      schema_migration_receipts: {
        rows: [{ version: 33, filename: "033_test.sql", checksum_sha256: "b".repeat(64) }]
      }
    }), {
      schemaName: "public",
      version: 33,
      filename: "033_test.sql",
      checksumSha256: CHECKSUM
    })).rejects.toThrow("schema_migration_checksum_mismatch");
  });

  it("[REQ-38][DATA] pins migration SQL to stable LF bytes", () => {
    const attributesPath = ".gitattributes";
    const attributesExist = existsSync(attributesPath);
    const attributesBytes = attributesExist ? readFileSync(attributesPath) : Buffer.alloc(0);
    expect(attributesExist).toBe(true);
    const attributes = new TextDecoder("utf-8", { fatal: true }).decode(attributesBytes);
    expect(attributes).toMatch(/^\/migrations\/\*\.sql text eol=lf$/m);
    const migrationPath = `migrations/${SCHEMA_032_FILENAME}`;
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

describe("verified schema 034 metadata", () => {
  it("rejects a database receipt above the active schema version", async () => {
    const values: unknown[][] = [];
    const db = {
      query: async (sql: string, queryValues?: unknown[]) => {
        if (!sql.includes("where version > $1")) {
          throw new Error("schema_034_higher_version_query_missing");
        }
        values.push(queryValues ?? []);
        return { rows: [{ version: 35 }], rowCount: 1 };
      }
    } as unknown as Db;

    await expect(verifyRequiredSchema034(
      db,
      "b".repeat(64),
      "c".repeat(64),
      "d".repeat(64)
    )).rejects.toThrow("schema_034_newer_receipt_present");
    expect(values).toEqual([[34]]);
  });

  it("normalizes only the table-qualified 034 additions from the frozen 033 catalog", () => {
    const projection = projectSchema033CatalogAfter034({
      columns: [
        { table_name: "unified_check_runs", column_name: "fairness_owner_id" },
        { table_name: "unified_check_requests", column_name: "fairness_owner_id" }
      ],
      constraints: [
        { table_name: "unified_check_runs", conname: "unified_check_runs_fairness_owner_not_blank_check" },
        { table_name: "unified_check_tasks", conname: "unified_check_tasks_run_id_id_key" },
        { table_name: "unified_check_requests", conname: "unified_check_tasks_run_id_id_key" }
      ],
      indexes: [
        { tablename: "unified_check_tasks", indexname: "unified_check_tasks_run_id_id_key" },
        { tablename: "unified_check_requests", indexname: "unified_check_tasks_run_id_id_key" }
      ]
    });
    expect(projection).toEqual({
      columns: [{ table_name: "unified_check_requests", column_name: "fairness_owner_id" }],
      constraints: [{ table_name: "unified_check_requests", conname: "unified_check_tasks_run_id_id_key" }],
      indexes: [{ tablename: "unified_check_requests", indexname: "unified_check_tasks_run_id_id_key" }]
    });
  });

  it("pins 034 structural checks, including the planner state shape", async () => {
    await expect(verifySchema034Structure(schema034Db())).resolves.toBeUndefined();
    await expect(verifySchema034Structure(schema034Db({ stateShape: "CHECK (true)" }))).rejects.toThrow(
      "schema_034_constraint_definition_mismatch"
    );
  });

  it("rejects cross-schema and cascading planner foreign keys", async () => {
    await expect(verifySchema034Structure(schema034Db({ foreignSchema: "other_schema" }))).rejects.toThrow(
      "schema_034_foreign_key_mismatch"
    );
    await expect(verifySchema034Structure(schema034Db({ taskForeignKeyDeleteAction: "c" }))).rejects.toThrow(
      "schema_034_foreign_key_mismatch"
    );
  });

});
