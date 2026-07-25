import { createHash } from "node:crypto";
import { validateApprovalAllowanceStateV2 } from "../approvals/allowanceState";
import type { ApprovalAllowanceStateV2 } from "../types";

export const SCHEMA_032_VERSION = 32;
export const SCHEMA_032_FILENAME =
  "032_telegram_runtime_forensics_data_contracts.sql";
export const SCHEMA_033_VERSION = 33;
export const SCHEMA_033_FILENAME = "033_unified_wallet_check.sql";
export const SCHEMA_034_VERSION = 34;
export const SCHEMA_034_FILENAME = "034_unified_check_adaptive_planner.sql";
export const REQUIRED_SCHEMA_VERSION = SCHEMA_034_VERSION;
export const REQUIRED_SCHEMA_FILENAME = SCHEMA_034_FILENAME;
export const SCHEMA_MIGRATION_LOCK_ID = 20260712032n;
export const SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE = 250;

export interface Schema032Verification {
  verified: true;
  version: typeof SCHEMA_032_VERSION;
  filename: typeof SCHEMA_032_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
}

export interface Schema033Verification {
  verified: true;
  version: typeof SCHEMA_033_VERSION;
  filename: typeof SCHEMA_033_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
  schema032ChecksumSha256: string;
}

export interface Schema034Verification {
  verified: true;
  version: typeof SCHEMA_034_VERSION;
  filename: typeof SCHEMA_034_FILENAME;
  checksumSha256: string;
  shortChecksum: string;
  schema032ChecksumSha256: string;
  schema033ChecksumSha256: string;
}

export interface SchemaQueryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

interface SchemaOptions {
  schemaName?: string;
}

interface ApplyVerifiedMigration032Options extends SchemaOptions {
  migrationBytes: Uint8Array;
}

interface ApplyVerifiedTrackedMigrationOptions extends SchemaOptions {
  version: number;
  filename: string;
  migrationBytes: Uint8Array;
  requiredSchema032Checksum?: string;
  requiredSchema033Checksum?: string;
}

export interface TrackedMigrationVerification {
  verified: true;
  version: number;
  filename: string;
  checksumSha256: string;
  shortChecksum: string;
  status: "applied" | "already_verified";
}

export interface TrackedMigrationReceiptExpectation {
  schemaName: string;
  version: number;
  filename: string;
  checksumSha256: string;
}

const UINT256_MAX_RAW = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

const REQUIRED_COLUMNS = [
  ["schema_migration_receipts", "version", "integer", "NO", null],
  ["schema_migration_receipts", "filename", "text", "NO", null],
  ["schema_migration_receipts", "checksum_sha256", "text", "NO", null],
  ["schema_migration_receipts", "applied_at", "timestamp with time zone", "NO", "now()"],
  ["wallet_approvals", "allowance_confirmed_raw", "text", "YES", null],
  ["wallet_approvals", "allowance_check_status", "text", "NO", "'stale'::text"],
  ["wallet_approvals", "allowance_checked_at", "timestamp with time zone", "YES", null],
  ["wallet_approvals", "allowance_fresh_until", "timestamp with time zone", "YES", null],
  ["wallet_approvals", "allowance_last_attempt_at", "timestamp with time zone", "YES", null],
  ["wallet_approvals", "allowance_failure_code", "text", "YES", null]
] as const;

const REQUIRED_CONSTRAINT_DEFINITIONS: Readonly<Record<string, string>> = {
  schema_migration_receipts_checksum_check:
    "CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text))",
  wallet_approvals_allowance_status_v2_check:
    "CHECK ((allowance_check_status = ANY (ARRAY['confirmed_active'::text, 'confirmed_zero'::text, 'failed'::text, 'stale'::text])))",
  wallet_approvals_allowance_uint256_v2_check:
    `CHECK (((allowance_confirmed_raw IS NULL) OR ((allowance_confirmed_raw ~ '^(0|[1-9][0-9]*)$'::text) AND ((length(allowance_confirmed_raw) < 78) OR ((length(allowance_confirmed_raw) = 78) AND (allowance_confirmed_raw <= '${UINT256_MAX_RAW}'::text))))))`,
  wallet_approvals_allowance_shape_v2_check:
    `CHECK ((((allowance_check_status = 'confirmed_active'::text) AND (allowance_confirmed_raw IS NOT NULL) AND (allowance_confirmed_raw <> '0'::text) AND (current_allowance_raw = allowance_confirmed_raw) AND (is_unlimited = (allowance_confirmed_raw = '${UINT256_MAX_RAW}'::text)) AND (status = 'active'::text)) OR ((allowance_check_status = 'confirmed_zero'::text) AND (allowance_confirmed_raw IS NOT NULL) AND (allowance_confirmed_raw = '0'::text) AND (current_allowance_raw = '0'::text) AND (is_unlimited = false) AND (status = 'revoked'::text)) OR ((allowance_check_status = ANY (ARRAY['failed'::text, 'stale'::text])) AND (current_allowance_raw = '0'::text) AND (is_unlimited = false) AND (status = 'unknown'::text))))`,
  wallet_approvals_allowance_failure_v2_check:
    "CHECK ((((allowance_check_status = 'failed'::text) AND (allowance_failure_code IS NOT NULL) AND (allowance_failure_code = ANY (ARRAY['provider_timeout'::text, 'provider_unavailable'::text, 'malformed_response'::text, 'contract_call_reverted'::text, 'network_mismatch'::text, 'subject_binding_failed'::text, 'unknown_provider_error'::text]))) OR ((allowance_check_status <> 'failed'::text) AND (allowance_failure_code IS NULL))))",
  wallet_approvals_allowance_timestamps_v2_check:
    "CHECK ((((allowance_check_status = ANY (ARRAY['confirmed_active'::text, 'confirmed_zero'::text])) AND (allowance_checked_at IS NOT NULL) AND (allowance_last_attempt_at IS NOT NULL) AND (allowance_fresh_until IS NOT NULL) AND (allowance_last_attempt_at = allowance_checked_at) AND (allowance_fresh_until = (allowance_checked_at + '00:15:00'::interval))) OR ((allowance_check_status = 'failed'::text) AND (allowance_last_attempt_at IS NOT NULL) AND (((allowance_confirmed_raw IS NULL) AND (allowance_checked_at IS NULL) AND (allowance_fresh_until IS NULL)) OR ((allowance_confirmed_raw IS NOT NULL) AND (allowance_checked_at IS NOT NULL) AND (allowance_fresh_until IS NOT NULL) AND (allowance_last_attempt_at >= allowance_checked_at) AND (allowance_fresh_until = (allowance_checked_at + '00:15:00'::interval))))) OR ((allowance_check_status = 'stale'::text) AND (((allowance_confirmed_raw IS NULL) AND (allowance_checked_at IS NULL) AND (allowance_fresh_until IS NULL) AND (allowance_last_attempt_at IS NULL)) OR ((allowance_confirmed_raw IS NOT NULL) AND (allowance_checked_at IS NOT NULL) AND (allowance_fresh_until IS NOT NULL) AND (allowance_last_attempt_at = allowance_checked_at) AND (allowance_fresh_until = (allowance_checked_at + '00:15:00'::interval)))))))"
};

function fail(code: string): never {
  throw new Error(code);
}

function normalizeDefinition(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function timestampText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : String(value);
}

function resolveSchemaName(options?: SchemaOptions): string {
  const schemaName = options?.schemaName ?? "public";
  if (!IDENTIFIER_PATTERN.test(schemaName)) fail("schema_032_invalid_schema_name");
  if (schemaName !== "public" && process.env.VITEST !== "true") {
    fail("schema_032_nonpublic_schema_forbidden");
  }
  return schemaName;
}

function quoteIdentifier(value: string): string {
  return `"${value}"`;
}

function trackedMigrationError(version: number, schema032Code: string, trackedCode: string): string {
  return version === SCHEMA_032_VERSION ? schema032Code : trackedCode;
}

export async function verifyTrackedMigrationReceipt(
  queryable: SchemaQueryable,
  expectation: TrackedMigrationReceiptExpectation
): Promise<void> {
  const schemaName = resolveSchemaName({ schemaName: expectation.schemaName });
  if (!Number.isSafeInteger(expectation.version) || expectation.version < SCHEMA_032_VERSION) {
    fail("schema_migration_invalid_version");
  }
  if (!CHECKSUM_PATTERN.test(expectation.checksumSha256)) {
    fail("schema_migration_invalid_checksum");
  }
  const receipt = await queryable.query(
    `select version, filename, checksum_sha256
       from ${quoteIdentifier(schemaName)}.schema_migration_receipts
      where version = $1 or filename = $2`,
    [expectation.version, expectation.filename]
  );
  if (receipt.rows.length === 0) {
    fail(trackedMigrationError(expectation.version, "schema_032_receipt_missing", "schema_migration_receipt_missing"));
  }
  if (receipt.rows.length !== 1) {
    fail(trackedMigrationError(
      expectation.version,
      "schema_032_receipt_count_mismatch",
      "schema_migration_receipt_count_mismatch"
    ));
  }
  const row = receipt.rows[0];
  if (Number(row.version) !== expectation.version) {
    fail(trackedMigrationError(expectation.version, "schema_032_version_mismatch", "schema_migration_version_mismatch"));
  }
  if (row.filename !== expectation.filename) {
    fail(trackedMigrationError(expectation.version, "schema_032_filename_mismatch", "schema_migration_filename_mismatch"));
  }
  if (row.checksum_sha256 !== expectation.checksumSha256) {
    fail(trackedMigrationError(expectation.version, "schema_032_checksum_mismatch", "schema_migration_checksum_mismatch"));
  }
}

export async function checksumMigrationBytes(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifySchema032Structure(
  queryable: SchemaQueryable,
  options?: SchemaOptions
): Promise<void> {
  const schemaName = resolveSchemaName(options);
  const columns = await queryable.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = $1
        and ((table_name = 'schema_migration_receipts' and column_name = any($2::text[]))
          or (table_name = 'wallet_approvals' and column_name = any($3::text[])))`,
    [
      schemaName,
      ["version", "filename", "checksum_sha256", "applied_at"],
      ["allowance_confirmed_raw", "allowance_check_status", "allowance_checked_at", "allowance_fresh_until", "allowance_last_attempt_at", "allowance_failure_code"]
    ]
  );
  for (const [tableName, columnName, dataType, isNullable, columnDefault] of REQUIRED_COLUMNS) {
    const row = columns.rows.find((candidate) =>
      candidate.table_name === tableName && candidate.column_name === columnName
    );
    if (!row) continue;
    if (
      row.data_type !== dataType ||
      row.is_nullable !== isNullable ||
      normalizeDefinition(row.column_default) !== normalizeDefinition(columnDefault)
    ) {
      fail("schema_032_column_mismatch");
    }
  }
  for (const [tableName, columnName] of REQUIRED_COLUMNS) {
    if (!columns.rows.some((row) => row.table_name === tableName && row.column_name === columnName)) {
      fail("schema_032_column_missing");
    }
  }

  const constraints = await queryable.query(
    `select c.conname, c.contype, c.convalidated, t.relname as table_name,
            pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = $1
        and t.relname in ('schema_migration_receipts', 'wallet_approvals')`,
    [schemaName]
  );
  for (const [name, expectedDefinition] of Object.entries(REQUIRED_CONSTRAINT_DEFINITIONS)) {
    const row = constraints.rows.find((candidate) => candidate.conname === name);
    if (!row || row.contype !== "c") fail("schema_032_constraint_missing");
    const expectedTable = name === "schema_migration_receipts_checksum_check"
      ? "schema_migration_receipts"
      : "wallet_approvals";
    if (row.table_name !== expectedTable) fail("schema_032_constraint_table_mismatch");
    if (row.convalidated !== true) fail("schema_032_constraint_not_valid");
    if (normalizeDefinition(row.definition) !== normalizeDefinition(expectedDefinition)) {
      fail("schema_032_constraint_definition_mismatch");
    }
  }
  const primary = constraints.rows.find((row) => row.conname === "schema_migration_receipts_pkey");
  const unique = constraints.rows.find((row) => row.conname === "schema_migration_receipts_filename_key");
  if (primary?.contype !== "p") fail("schema_032_receipt_primary_key_missing");
  if (primary.table_name !== "schema_migration_receipts") fail("schema_032_receipt_primary_key_mismatch");
  if (normalizeDefinition(primary.definition) !== "PRIMARY KEY (version)") {
    fail("schema_032_receipt_primary_key_mismatch");
  }
  if (unique?.contype !== "u") fail("schema_032_receipt_unique_missing");
  if (unique.table_name !== "schema_migration_receipts") fail("schema_032_receipt_unique_mismatch");
  if (normalizeDefinition(unique.definition) !== "UNIQUE (filename)") {
    fail("schema_032_receipt_unique_mismatch");
  }

  const indexes = await queryable.query(
    `select i.relname as indexname,
            array_agg(a.attname::text order by key_columns.ordinality) as columns
       from pg_index x
       join pg_class i on i.oid = x.indexrelid
       join pg_class t on t.oid = x.indrelid
       join pg_namespace n on n.oid = t.relnamespace
       join lateral unnest(x.indkey) with ordinality as key_columns(attnum, ordinality) on true
       join pg_attribute a on a.attrelid = t.oid and a.attnum = key_columns.attnum
      where n.nspname = $1
        and t.relname = 'wallet_approvals'
        and i.relname = 'idx_wallet_approvals_allowance_refresh'
      group by i.relname`,
    [schemaName]
  );
  const refreshIndex = indexes.rows.find((row) => row.indexname === "idx_wallet_approvals_allowance_refresh");
  if (!refreshIndex) fail("schema_032_index_missing");
  if (
    !Array.isArray(refreshIndex.columns) ||
    refreshIndex.columns.length !== 2 ||
    refreshIndex.columns[0] !== "allowance_check_status" ||
    refreshIndex.columns[1] !== "allowance_fresh_until"
  ) {
    fail("schema_032_index_mismatch");
  }

  const legacyBackfill = await queryable.query(
    `select count(*) filter (
        where allowance_check_status in ('confirmed_active', 'confirmed_zero')
          and (allowance_confirmed_raw is null
            or allowance_checked_at is null
            or allowance_fresh_until is null
            or allowance_last_attempt_at is null)
      )::text as false_confirmed_count
       from ${quoteIdentifier(schemaName)}.wallet_approvals
    `
  );
  if (String(legacyBackfill.rows[0]?.false_confirmed_count ?? "-1") !== "0") {
    fail("schema_032_legacy_backfill_invalid");
  }
  const evaluationTime = await queryable.query("select statement_timestamp() as evaluated_at");
  const evaluatedAtValue = evaluationTime.rows[0]?.evaluated_at;
  const evaluatedAt = evaluatedAtValue instanceof Date
    ? evaluatedAtValue
    : new Date(String(evaluatedAtValue ?? ""));
  if (evaluationTime.rows.length !== 1 || !Number.isFinite(evaluatedAt.getTime())) {
    fail("schema_032_evaluation_timestamp_invalid");
  }
  let allowanceCursor: [string, string, string] | null = null;
  // ponytail: startup validation is O(n) in approvals but O(batch) in memory; upgrade to a set-based or precomputed integrity marker if startup latency becomes material.
  while (true) {
    const cursorPredicate = allowanceCursor === null
      ? ""
      : "where (wa.watched_wallet_id, wa.token_contract, wa.spender_address) > ($1, $2, $3)";
    const values = allowanceCursor === null
      ? [SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE]
      : [...allowanceCursor, SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE];
    const limitPlaceholder = allowanceCursor === null ? "$1" : "$4";
    const allowanceRows = await queryable.query(
      `select wa.watched_wallet_id, w.address as owner_address, wa.spender_address, wa.token_contract,
              wa.allowance_confirmed_raw, wa.allowance_check_status,
              wa.allowance_checked_at, wa.allowance_fresh_until,
              wa.allowance_last_attempt_at, wa.allowance_failure_code,
              wa.last_approval_tx_hash
         from ${quoteIdentifier(schemaName)}.wallet_approvals wa
         join ${quoteIdentifier(schemaName)}.watched_wallets w on w.id = wa.watched_wallet_id
         ${cursorPredicate}
        order by wa.watched_wallet_id, wa.token_contract, wa.spender_address
        limit ${limitPlaceholder}`,
      values
    );
    if (allowanceRows.rows.length > SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE) {
      fail("schema_032_allowance_batch_overflow");
    }
    for (const row of allowanceRows.rows) {
      const state = String(row.allowance_check_status) as ApprovalAllowanceStateV2["state"];
      const confirmedAllowanceRaw = row.allowance_confirmed_raw === null
        ? null
        : String(row.allowance_confirmed_raw);
      const allowance: ApprovalAllowanceStateV2 = {
        version: "approval-allowance-v2",
        ownerAddress: String(row.owner_address ?? ""),
        spenderAddress: String(row.spender_address ?? ""),
        tokenContract: String(row.token_contract ?? ""),
        confirmedAllowanceRaw,
        isUnlimited: state === "confirmed_active"
          ? confirmedAllowanceRaw === UINT256_MAX_RAW
          : state === "confirmed_zero"
            ? false
            : null,
        state,
        confirmedAt: timestampText(row.allowance_checked_at),
        freshUntil: timestampText(row.allowance_fresh_until),
        lastAttemptAt: timestampText(row.allowance_last_attempt_at),
        failureCode: row.allowance_failure_code === null ? null : String(row.allowance_failure_code),
        source: "official_usdt_allowance",
        observedApprovalTxHash: row.last_approval_tx_hash === null ? null : String(row.last_approval_tx_hash)
      };
      try {
        validateApprovalAllowanceStateV2(allowance, evaluatedAt);
        const confirmedAtMs = allowance.confirmedAt === null ? null : new Date(allowance.confirmedAt).getTime();
        const lastAttemptAtMs = allowance.lastAttemptAt === null ? null : new Date(allowance.lastAttemptAt).getTime();
        if (
          (confirmedAtMs !== null && confirmedAtMs > evaluatedAt.getTime()) ||
          (lastAttemptAtMs !== null && lastAttemptAtMs > evaluatedAt.getTime())
        ) {
          fail("schema_032_allowance_state_invalid");
        }
      } catch {
        fail("schema_032_allowance_state_invalid");
      }
    }
    if (allowanceRows.rows.length < SCHEMA_ALLOWANCE_VALIDATION_BATCH_SIZE) break;
    const last = allowanceRows.rows.at(-1)!;
    allowanceCursor = [
      String(last.watched_wallet_id),
      String(last.token_contract),
      String(last.spender_address)
    ];
    if (allowanceCursor.some((part) => part.length === 0)) {
      fail("schema_032_allowance_key_invalid");
    }
  }
}

export async function verifyRequiredSchema032(
  queryable: SchemaQueryable,
  expectedChecksum: string,
  options?: SchemaOptions
): Promise<Schema032Verification> {
  if (!CHECKSUM_PATTERN.test(expectedChecksum)) fail("schema_032_invalid_expected_checksum");
  const schemaName = resolveSchemaName(options);
  const receiptTable = await queryable.query(
    "select to_regclass($1) as receipt_table",
    [`${schemaName}.schema_migration_receipts`]
  );
  if (!receiptTable.rows[0]?.receipt_table) fail("schema_032_receipt_missing");
  const receipt = await queryable.query(
    `select version, filename, checksum_sha256
       from ${quoteIdentifier(schemaName)}.schema_migration_receipts
      where version = $1`,
    [SCHEMA_032_VERSION]
  );
  if (receipt.rows.length === 0) fail("schema_032_receipt_missing");
  if (receipt.rows.length !== 1) fail("schema_032_receipt_count_mismatch");
  const row = receipt.rows[0];
  if (Number(row.version) !== SCHEMA_032_VERSION) fail("schema_032_version_mismatch");
  if (row.filename !== SCHEMA_032_FILENAME) fail("schema_032_filename_mismatch");
  if (row.checksum_sha256 !== expectedChecksum) fail("schema_032_checksum_mismatch");
  await verifySchema032Structure(queryable, { schemaName });
  return {
    verified: true,
    version: SCHEMA_032_VERSION,
    filename: SCHEMA_032_FILENAME,
    checksumSha256: expectedChecksum,
    shortChecksum: expectedChecksum.slice(0, 12)
  };
}

const UNIFIED_TABLES = [
  "unified_check_runs",
  "unified_check_requests",
  "unified_check_tasks",
  "unified_check_attempts",
  "unified_check_artifacts",
  "unified_check_deliveries",
  "unified_provider_pages",
  "unified_label_datasets",
  "unified_wallet_delivery_ownership",
  "unified_check_generation_fence"
] as const;

export const UNIFIED_SCHEMA_033_CATALOG_SHA256 =
  "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4";
export const UNIFIED_SCHEMA_034_MIGRATION_SHA256 =
  "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb";

function unifiedCatalogHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const SCHEMA_034_NORMALIZED_DELTA_CATALOG = {
  tables: [{ tableName: "unified_check_planner_entries" }],
  columns: [
    ["unified_check_planner_entries", 1, "run_id", "text", "NO", null],
    ["unified_check_planner_entries", 2, "canonical_sequence", "bigint", "NO", null],
    ["unified_check_planner_entries", 3, "task_id", "text", "NO", null],
    ["unified_check_planner_entries", 4, "planner_state", "text", "NO", null],
    ["unified_check_planner_entries", 5, "result_bytes", "bigint", "YES", null],
    ["unified_check_planner_entries", 6, "admitted_at", "timestamp with time zone", "YES", null],
    ["unified_check_planner_entries", 7, "reserved_bytes", "bigint", "YES", null],
    ["unified_check_planner_entries", 8, "planned_at", "timestamp with time zone", "NO", "statement_timestamp()"],
    ["unified_check_planner_entries", 9, "ready_at", "timestamp with time zone", "YES", null],
    ["unified_check_planner_entries", 10, "committed_at", "timestamp with time zone", "YES", null],
    ["unified_check_runs", 18, "fairness_owner_id", "text", "NO", null]
  ].map(([tableName, ordinalPosition, columnName, dataType, isNullable, columnDefault]) => ({
    tableName, ordinalPosition, columnName, dataType, isNullable, columnDefault
  })),
  constraints: [
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_canonical_sequence_check",
      type: "c", validated: true,
      definition: "CHECK ((canonical_sequence >= 0))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_pkey",
      type: "p", validated: true,
      definition: "PRIMARY KEY (run_id, canonical_sequence)",
      keyColumns: ["run_id", "canonical_sequence"], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_reserved_bytes_check",
      type: "c", validated: true,
      definition: "CHECK (((reserved_bytes IS NULL) OR (reserved_bytes >= 0)))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_result_bytes_check",
      type: "c", validated: true,
      definition: "CHECK (((result_bytes IS NULL) OR (result_bytes >= 0)))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_run_id_fkey",
      type: "f", validated: true,
      definition: "FOREIGN KEY (run_id) REFERENCES unified_check_runs(id)",
      keyColumns: ["run_id"],
      foreign: {
        schemaName: "<schema>", tableName: "unified_check_runs", columns: ["id"],
        matchType: "s", updateType: "a", deleteType: "a", deferrable: false, deferred: false
      }
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_run_id_task_id_key",
      type: "u", validated: true,
      definition: "UNIQUE (run_id, task_id)",
      keyColumns: ["run_id", "task_id"], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_run_task_fk",
      type: "f", validated: true,
      definition: "FOREIGN KEY (run_id, task_id) REFERENCES unified_check_tasks(run_id, id)",
      keyColumns: ["run_id", "task_id"],
      foreign: {
        schemaName: "<schema>", tableName: "unified_check_tasks", columns: ["run_id", "id"],
        matchType: "s", updateType: "a", deleteType: "a", deferrable: false, deferred: false
      }
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_state_check",
      type: "c", validated: true,
      definition: "CHECK ((planner_state = ANY (ARRAY['planned'::text, 'ready'::text, 'committed'::text])))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_state_shape_check",
      type: "c", validated: true,
      definition: "CHECK ((((planner_state = 'planned'::text) AND (result_bytes IS NULL) AND (ready_at IS NULL) AND (committed_at IS NULL) AND (((admitted_at IS NULL) AND (reserved_bytes IS NULL)) OR ((admitted_at IS NOT NULL) AND (reserved_bytes IS NOT NULL)))) OR ((planner_state = 'ready'::text) AND (admitted_at IS NOT NULL) AND (reserved_bytes IS NULL) AND (result_bytes IS NOT NULL) AND (ready_at IS NOT NULL) AND (committed_at IS NULL)) OR ((planner_state = 'committed'::text) AND (admitted_at IS NOT NULL) AND (reserved_bytes IS NULL) AND (result_bytes IS NOT NULL) AND (ready_at IS NOT NULL) AND (committed_at IS NOT NULL))))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_timestamp_order_check",
      type: "c", validated: true,
      definition: "CHECK ((((admitted_at IS NULL) OR (admitted_at >= planned_at)) AND ((ready_at IS NULL) OR (ready_at >= admitted_at)) AND ((committed_at IS NULL) OR (committed_at >= ready_at))))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_runs",
      name: "unified_check_runs_fairness_owner_not_blank_check",
      type: "c", validated: true,
      definition: "CHECK ((btrim(fairness_owner_id) <> ''::text))",
      keyColumns: [], foreign: null
    },
    {
      tableName: "unified_check_tasks",
      name: "unified_check_tasks_run_id_id_key",
      type: "u", validated: true,
      definition: "UNIQUE (run_id, id)",
      keyColumns: ["run_id", "id"], foreign: null
    }
  ],
  indexes: [
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_admitted_task_idx",
      definition: "CREATE INDEX unified_check_planner_entries_admitted_task_idx ON <schema>.unified_check_planner_entries USING btree (run_id, task_id) WHERE ((planner_state = 'planned'::text) AND (admitted_at IS NOT NULL))"
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_buffer_aggregate_idx",
      definition: "CREATE INDEX unified_check_planner_entries_buffer_aggregate_idx ON <schema>.unified_check_planner_entries USING btree (run_id, planner_state) INCLUDE (result_bytes, reserved_bytes, ready_at, admitted_at)"
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_next_uncommitted_idx",
      definition: "CREATE INDEX unified_check_planner_entries_next_uncommitted_idx ON <schema>.unified_check_planner_entries USING btree (run_id, canonical_sequence) WHERE (planner_state <> 'committed'::text)"
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_pkey",
      definition: "CREATE UNIQUE INDEX unified_check_planner_entries_pkey ON <schema>.unified_check_planner_entries USING btree (run_id, canonical_sequence)"
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_ready_prefix_idx",
      definition: "CREATE INDEX unified_check_planner_entries_ready_prefix_idx ON <schema>.unified_check_planner_entries USING btree (run_id, canonical_sequence) WHERE (planner_state = 'ready'::text)"
    },
    {
      tableName: "unified_check_planner_entries",
      name: "unified_check_planner_entries_run_id_task_id_key",
      definition: "CREATE UNIQUE INDEX unified_check_planner_entries_run_id_task_id_key ON <schema>.unified_check_planner_entries USING btree (run_id, task_id)"
    },
    {
      tableName: "unified_check_tasks",
      name: "unified_check_tasks_run_id_id_key",
      definition: "CREATE UNIQUE INDEX unified_check_tasks_run_id_id_key ON <schema>.unified_check_tasks USING btree (run_id, id)"
    }
  ],
  triggers: []
} as const;

const SCHEMA_034_NORMALIZED_STRUCTURAL_CATALOG = {
  predecessorCatalogSha256: UNIFIED_SCHEMA_033_CATALOG_SHA256,
  delta: SCHEMA_034_NORMALIZED_DELTA_CATALOG
} as const;

export const UNIFIED_SCHEMA_034_CATALOG_SHA256 =
  "9709b71e13ce8c84140d95b6416f631dafa1dd0ba67da7b2a4d3e4dbedaaeb1a";
if (unifiedCatalogHash(SCHEMA_034_NORMALIZED_STRUCTURAL_CATALOG)
    !== UNIFIED_SCHEMA_034_CATALOG_SHA256) {
  throw new Error("schema_034_expected_catalog_identity_invalid");
}

const SCHEMA_034_COLUMNS_ADDED_TO_033_TABLES = new Set([
  "unified_check_runs.fairness_owner_id"
]);
const SCHEMA_034_CONSTRAINTS_ADDED_TO_033_TABLES = new Set([
  "unified_check_runs.unified_check_runs_fairness_owner_not_blank_check",
  "unified_check_tasks.unified_check_tasks_run_id_id_key"
]);
const SCHEMA_034_INDEXES_ADDED_TO_033_TABLES = new Set([
  "unified_check_tasks.unified_check_tasks_run_id_id_key"
]);

type Schema033CatalogRows = Readonly<{
  columns: readonly Record<string, unknown>[];
  constraints: readonly Record<string, unknown>[];
  indexes: readonly Record<string, unknown>[];
}>;

export function projectSchema033CatalogAfter034(
  catalog: Schema033CatalogRows
): Schema033CatalogRows {
  return {
    ...catalog,
    columns: catalog.columns.filter((row) => !SCHEMA_034_COLUMNS_ADDED_TO_033_TABLES.has(
      `${row.table_name}.${row.column_name}`
    )),
    constraints: catalog.constraints.filter((row) => !SCHEMA_034_CONSTRAINTS_ADDED_TO_033_TABLES.has(
      `${row.table_name}.${row.conname}`
    )),
    indexes: catalog.indexes.filter((row) => !SCHEMA_034_INDEXES_ADDED_TO_033_TABLES.has(
      `${row.tablename}.${row.indexname}`
    ))
  };
}

export async function verifySchema033Structure(
  queryable: SchemaQueryable,
  options?: SchemaOptions
): Promise<void> {
  await verifySchema033StructureInternal(queryable, options, false);
}

async function verifySchema033StructureInternal(
  queryable: SchemaQueryable,
  options: SchemaOptions | undefined,
  allowSchema034Additions: boolean
): Promise<void> {
  const schemaName = resolveSchemaName(options);
  const tables = await queryable.query(
    `select c.relname as table_name,
            pg_get_userbyid(c.relowner) as table_owner,
            current_user as current_user
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind = 'r'
        and c.relname = any($2::text[])
      order by c.relname`,
    [schemaName, [...UNIFIED_TABLES]]
  );
  if (
    tables.rows.length !== UNIFIED_TABLES.length ||
    UNIFIED_TABLES.some((name) => !tables.rows.some((row) => row.table_name === name))
  ) {
    fail("schema_033_table_missing");
  }
  if (tables.rows.some((row) => row.table_owner !== row.current_user)) {
    fail("schema_033_table_owner_mismatch");
  }
  const columns = await queryable.query(
    `select table_name, ordinal_position, column_name, data_type,
            is_nullable, column_default
       from information_schema.columns
      where table_schema = $1 and table_name = any($2::text[])
      order by table_name, ordinal_position`,
    [schemaName, [...UNIFIED_TABLES]]
  );
  const constraints = await queryable.query(
    `select t.relname as table_name, c.conname, c.contype,
            c.convalidated, pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = $1 and t.relname = any($2::text[])
      order by t.relname, c.conname`,
    [schemaName, [...UNIFIED_TABLES]]
  );
  const indexes = await queryable.query(
    `select tablename, indexname, indexdef
       from pg_indexes
      where schemaname = $1 and tablename = any($2::text[])
      order by tablename, indexname`,
    [schemaName, [...UNIFIED_TABLES]]
  );
  const triggers = await queryable.query(
    `select c.relname as table_name, t.tgname,
            pg_get_triggerdef(t.oid) as definition
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = any($2::text[])
        and not t.tgisinternal
      order by c.relname, t.tgname`,
    [schemaName, [...UNIFIED_TABLES]]
  );
  const functions = await queryable.query(
    `select p.proname, pg_get_function_result(p.oid) as result,
            pg_get_function_arguments(p.oid) as arguments,
            l.lanname as language, p.prosrc
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_language l on l.oid = p.prolang
      where n.nspname = $1 and p.proname = 'unified_reject_immutable_mutation'
      order by p.oid`,
    [schemaName]
  );
  const normalizeSchema = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value.replaceAll(`${schemaName}.`, "<schema>.")
          : value
      ])
    );
  const catalog = allowSchema034Additions
    ? projectSchema033CatalogAfter034({
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows
    })
    : { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
  const actualHash = unifiedCatalogHash({
    columns: catalog.columns,
    constraints: catalog.constraints,
    indexes: catalog.indexes.map(normalizeSchema),
    triggers: triggers.rows.map(normalizeSchema),
    functions: functions.rows
  });
  if (actualHash !== UNIFIED_SCHEMA_033_CATALOG_SHA256) {
    fail("schema_033_catalog_mismatch");
  }
}

export async function verifyRequiredSchema033(
  queryable: SchemaQueryable,
  expectedChecksum: string,
  schema032ChecksumSha256: string,
  options?: SchemaOptions
): Promise<Schema033Verification> {
  if (!CHECKSUM_PATTERN.test(expectedChecksum)) {
    fail("schema_033_invalid_expected_checksum");
  }
  const schemaName = resolveSchemaName(options);
  await verifyRequiredSchema032(queryable, schema032ChecksumSha256, {
    schemaName
  });
  await verifyTrackedMigrationReceipt(queryable, {
    schemaName,
    version: SCHEMA_033_VERSION,
    filename: SCHEMA_033_FILENAME,
    checksumSha256: expectedChecksum
  });
  await verifySchema033Structure(queryable, { schemaName });
  return {
    verified: true,
    version: SCHEMA_033_VERSION,
    filename: SCHEMA_033_FILENAME,
    checksumSha256: expectedChecksum,
    shortChecksum: expectedChecksum.slice(0, 12),
    schema032ChecksumSha256
  };
}

async function verifySchema033LineageForSchema034(
  queryable: SchemaQueryable,
  expectedChecksum: string,
  schema032ChecksumSha256: string,
  schemaName: string
): Promise<void> {
  if (!CHECKSUM_PATTERN.test(expectedChecksum)) fail("schema_033_invalid_expected_checksum");
  await verifyRequiredSchema032(queryable, schema032ChecksumSha256, { schemaName });
  await verifyTrackedMigrationReceipt(queryable, {
    schemaName,
    version: SCHEMA_033_VERSION,
    filename: SCHEMA_033_FILENAME,
    checksumSha256: expectedChecksum
  });
  await verifySchema033StructureInternal(queryable, { schemaName }, true);
}

export async function verifySchema034Structure(
  queryable: SchemaQueryable,
  options?: SchemaOptions
): Promise<void> {
  const schemaName = resolveSchemaName(options);
  const normalizeSchema = (value: unknown) => normalizeDefinition(value)
    .replaceAll(`${schemaName}.`, "<schema>.")
    .replaceAll(`"${schemaName}".`, "<schema>.");
  const tables = await queryable.query(
    `select c.relname as table_name,
            pg_get_userbyid(c.relowner) as table_owner,
            current_user as current_user
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind = 'r'
        and c.relname = 'unified_check_planner_entries'
      order by c.relname`,
    [schemaName]
  );
  if (
    tables.rows.length !== 1 ||
    tables.rows[0]?.table_name !== "unified_check_planner_entries" ||
    tables.rows[0]?.table_owner !== tables.rows[0]?.current_user
  ) fail("schema_034_catalog_mismatch");
  const columns = await queryable.query(
    `select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = $1
        and (table_name = 'unified_check_planner_entries'
          or (table_name = 'unified_check_runs' and column_name = 'fairness_owner_id'))
      order by table_name, ordinal_position`,
    [schemaName]
  );
  const constraints = await queryable.query(
    `select t.relname as table_name, c.conname, c.contype, c.convalidated,
            pg_get_constraintdef(c.oid) as definition,
            ft.relname as foreign_table_name,
            fn.nspname as foreign_schema_name,
            c.confmatchtype as foreign_match_type,
            c.confupdtype as foreign_update_type,
            c.confdeltype as foreign_delete_type,
            c.condeferrable,
            c.condeferred,
            array(
              select a.attname
                from unnest(c.conkey) with ordinality as key_columns(attnum, ordinality)
                join pg_attribute a on a.attrelid = t.oid and a.attnum = key_columns.attnum
               order by key_columns.ordinality
            ) as columns,
            array(
              select fa.attname
                from unnest(c.confkey) with ordinality as foreign_key_columns(attnum, ordinality)
                join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = foreign_key_columns.attnum
               order by foreign_key_columns.ordinality
            ) as foreign_columns
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       left join pg_class ft on ft.oid = c.confrelid
       left join pg_namespace fn on fn.oid = ft.relnamespace
      where n.nspname = $1
        and (t.relname = 'unified_check_planner_entries'
          or (t.relname = 'unified_check_runs'
            and c.conname = 'unified_check_runs_fairness_owner_not_blank_check')
          or (t.relname = 'unified_check_tasks'
            and c.conname = 'unified_check_tasks_run_id_id_key'))
      order by t.relname, c.conname`,
    [schemaName]
  );
  const indexes = await queryable.query(
    `select tablename, indexname, indexdef
       from pg_indexes
      where schemaname = $1
        and (tablename = 'unified_check_planner_entries'
          or (tablename = 'unified_check_tasks'
            and indexname = 'unified_check_tasks_run_id_id_key'))
      order by tablename, indexname`,
    [schemaName]
  );
  const triggers = await queryable.query(
    `select c.relname as table_name, t.tgname as trigger_name,
            pg_get_triggerdef(t.oid) as definition
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = 'unified_check_planner_entries'
        and not t.tgisinternal
      order by c.relname, t.tgname`,
    [schemaName]
  );
  const delta = {
    tables: tables.rows.map((row) => ({ tableName: row.table_name })),
    columns: columns.rows.map((row) => ({
      tableName: row.table_name,
      ordinalPosition: Number(row.ordinal_position),
      columnName: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable,
      columnDefault: row.column_default === null ? null : normalizeSchema(row.column_default)
    })),
    constraints: constraints.rows.map((row) => ({
      tableName: row.table_name,
      name: row.conname,
      type: row.contype,
      validated: row.convalidated,
      definition: normalizeSchema(row.definition),
      keyColumns: row.contype === "p" || row.contype === "u" || row.contype === "f"
        ? row.columns
        : [],
      foreign: row.contype === "f"
        ? {
            schemaName: row.foreign_schema_name === schemaName ? "<schema>" : row.foreign_schema_name,
            tableName: row.foreign_table_name,
            columns: row.foreign_columns,
            matchType: row.foreign_match_type,
            updateType: row.foreign_update_type,
            deleteType: row.foreign_delete_type,
            deferrable: row.condeferrable,
            deferred: row.condeferred
          }
        : null
    })),
    indexes: indexes.rows.map((row) => ({
      tableName: row.tablename,
      name: row.indexname,
      definition: normalizeSchema(row.indexdef)
    })),
    triggers: triggers.rows.map((row) => ({
      tableName: row.table_name,
      name: row.trigger_name,
      definition: normalizeSchema(row.definition)
    }))
  };
  const actualHash = unifiedCatalogHash({
    predecessorCatalogSha256: UNIFIED_SCHEMA_033_CATALOG_SHA256,
    delta
  });
  if (actualHash !== UNIFIED_SCHEMA_034_CATALOG_SHA256) fail("schema_034_catalog_mismatch");
}

export async function verifyRequiredSchema034(
  queryable: SchemaQueryable,
  expectedChecksum: string,
  schema032ChecksumSha256: string,
  schema033ChecksumSha256: string,
  options?: SchemaOptions
): Promise<Schema034Verification> {
  if (!CHECKSUM_PATTERN.test(expectedChecksum)) fail("schema_034_invalid_expected_checksum");
  const schemaName = resolveSchemaName(options);
  const newerReceipt = await queryable.query(
    `select version
       from ${quoteIdentifier(schemaName)}.schema_migration_receipts
      where version > $1
      order by version asc
      limit 1`,
    [SCHEMA_034_VERSION]
  );
  if (newerReceipt.rows.length > 0) fail("schema_034_newer_receipt_present");
  await verifySchema033LineageForSchema034(
    queryable,
    schema033ChecksumSha256,
    schema032ChecksumSha256,
    schemaName
  );
  await verifyTrackedMigrationReceipt(queryable, {
    schemaName,
    version: SCHEMA_034_VERSION,
    filename: SCHEMA_034_FILENAME,
    checksumSha256: expectedChecksum
  });
  await verifySchema034Structure(queryable, { schemaName });
  return {
    verified: true,
    version: SCHEMA_034_VERSION,
    filename: SCHEMA_034_FILENAME,
    checksumSha256: expectedChecksum,
    shortChecksum: expectedChecksum.slice(0, 12),
    schema032ChecksumSha256,
    schema033ChecksumSha256
  };
}

export async function applyVerifiedTrackedMigration(
  queryable: SchemaQueryable,
  options: ApplyVerifiedTrackedMigrationOptions
): Promise<TrackedMigrationVerification> {
  const schemaName = resolveSchemaName(options);
  if (!Number.isSafeInteger(options.version) || options.version < SCHEMA_032_VERSION) {
    fail("schema_migration_invalid_version");
  }
  const filenameVersion = /^(\d+)_/.exec(options.filename)?.[1];
  if (filenameVersion === undefined || Number(filenameVersion) !== options.version || !options.filename.endsWith(".sql")) {
    fail("schema_migration_filename_version_mismatch");
  }
  if (options.version === SCHEMA_032_VERSION && options.filename !== SCHEMA_032_FILENAME) {
    fail("schema_032_filename_mismatch");
  }
  if (options.version === SCHEMA_033_VERSION && options.filename !== SCHEMA_033_FILENAME) {
    fail("schema_033_filename_mismatch");
  }
  if (options.version === SCHEMA_034_VERSION && options.filename !== SCHEMA_034_FILENAME) {
    fail("schema_034_filename_mismatch");
  }
  if (options.version > SCHEMA_032_VERSION && !CHECKSUM_PATTERN.test(options.requiredSchema032Checksum ?? "")) {
    fail("schema_migration_schema_032_checksum_required");
  }
  if (options.version > SCHEMA_033_VERSION && !CHECKSUM_PATTERN.test(options.requiredSchema033Checksum ?? "")) {
    fail("schema_migration_schema_033_checksum_required");
  }
  const checksumSha256 = await checksumMigrationBytes(options.migrationBytes);
  let sql: string;
  try {
    sql = new TextDecoder("utf-8", { fatal: true }).decode(options.migrationBytes);
  } catch {
    fail("schema_032_invalid_utf8");
  }
  await queryable.query("begin");
  try {
    await queryable.query("select pg_advisory_xact_lock($1::bigint)", [SCHEMA_MIGRATION_LOCK_ID.toString()]);
    await queryable.query(`set local search_path to ${quoteIdentifier(schemaName)}`);
    const receiptTable = await queryable.query(
      "select to_regclass($1) as receipt_table",
      [`${schemaName}.schema_migration_receipts`]
    );
    if (!receiptTable.rows[0]?.receipt_table && options.version > SCHEMA_032_VERSION) {
      fail("schema_migration_receipt_table_missing");
    }
    if (receiptTable.rows[0]?.receipt_table) {
      const existing = await queryable.query(
        `select version, filename, checksum_sha256
           from ${quoteIdentifier(schemaName)}.schema_migration_receipts
          where version = $1 or filename = $2`,
        [options.version, options.filename]
      );
      if (existing.rows.length > 0) {
        await verifyTrackedMigrationReceipt(queryable, {
          schemaName,
          version: options.version,
          filename: options.filename,
          checksumSha256
        });
        if (options.version === SCHEMA_032_VERSION) {
          await verifyRequiredSchema032(queryable, checksumSha256, { schemaName });
        } else if (options.version === SCHEMA_034_VERSION && options.filename === SCHEMA_034_FILENAME) {
          await verifyRequiredSchema034(
            queryable,
            checksumSha256,
            options.requiredSchema032Checksum!,
            options.requiredSchema033Checksum!,
            { schemaName }
          );
        } else if (options.version === SCHEMA_033_VERSION && options.filename === SCHEMA_033_FILENAME) {
          await verifyRequiredSchema033(
            queryable,
            checksumSha256,
            options.requiredSchema032Checksum!,
            { schemaName }
          );
        } else {
          await verifyRequiredSchema032(queryable, options.requiredSchema032Checksum!, { schemaName });
        }
        await queryable.query("commit");
        return {
          verified: true,
          version: options.version,
          filename: options.filename,
          checksumSha256,
          shortChecksum: checksumSha256.slice(0, 12),
          status: "already_verified"
        };
      }
    }

    if (options.version > SCHEMA_033_VERSION) {
      await verifyRequiredSchema033(
        queryable,
        options.requiredSchema033Checksum!,
        options.requiredSchema032Checksum!,
        { schemaName }
      );
    } else if (options.version > SCHEMA_032_VERSION) {
      await verifyRequiredSchema032(queryable, options.requiredSchema032Checksum!, { schemaName });
    }
    await queryable.query(sql);
    if (options.version === SCHEMA_032_VERSION) {
      await verifySchema032Structure(queryable, { schemaName });
    }
    await queryable.query(
      `insert into ${quoteIdentifier(schemaName)}.schema_migration_receipts
        (version, filename, checksum_sha256)
       values ($1, $2, $3)`,
      [options.version, options.filename, checksumSha256]
    );
    await verifyTrackedMigrationReceipt(queryable, {
      schemaName,
      version: options.version,
      filename: options.filename,
      checksumSha256
    });
    if (options.version === SCHEMA_032_VERSION) {
      await verifyRequiredSchema032(queryable, checksumSha256, { schemaName });
    } else if (options.version === SCHEMA_034_VERSION && options.filename === SCHEMA_034_FILENAME) {
      await verifyRequiredSchema034(
        queryable,
        checksumSha256,
        options.requiredSchema032Checksum!,
        options.requiredSchema033Checksum!,
        { schemaName }
      );
    } else if (options.version === SCHEMA_033_VERSION && options.filename === SCHEMA_033_FILENAME) {
      await verifyRequiredSchema033(
        queryable,
        checksumSha256,
        options.requiredSchema032Checksum!,
        { schemaName }
      );
    } else {
      await verifyRequiredSchema032(queryable, options.requiredSchema032Checksum!, { schemaName });
    }
    await queryable.query("commit");
    return {
      verified: true,
      version: options.version,
      filename: options.filename,
      checksumSha256,
      shortChecksum: checksumSha256.slice(0, 12),
      status: "applied"
    };
  } catch (error) {
    await queryable.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function applyVerifiedMigration032(
  queryable: SchemaQueryable,
  options: ApplyVerifiedMigration032Options
): Promise<Schema032Verification & { status: "applied" | "already_verified" }> {
  const verification = await applyVerifiedTrackedMigration(queryable, {
    ...options,
      version: SCHEMA_032_VERSION,
      filename: SCHEMA_032_FILENAME
  });
  return {
    ...verification,
    version: SCHEMA_032_VERSION,
    filename: SCHEMA_032_FILENAME
  };
}
