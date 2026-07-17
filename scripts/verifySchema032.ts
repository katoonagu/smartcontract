import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client, type ClientConfig } from "pg";
import {
  REQUIRED_SCHEMA_FILENAME,
  REQUIRED_SCHEMA_VERSION,
  type SchemaQueryable,
  checksumMigrationBytes,
  verifyRequiredSchema032
} from "../src/storage/schemaMigrations";

export const APPROVED_SCHEMA_032_CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";

export type Schema032DatabaseRole = "clean" | "production_clone" | "runtime_sanitized" | "production";
export type Schema032MigrationStatus = "applied" | "already_verified";
export type Schema032MigrationSequence = "first" | "second";
export type Schema032VerificationPhase = "first" | "final";

export type Schema032MigrationTargetBinding = {
  candidateSha: string;
  databaseRole: Schema032DatabaseRole;
  databaseName: string;
  databaseEndpoint: string;
  databaseSystemIdentifierSha256: string;
  databaseFingerprintSha256: string;
};

export type Schema032MigrationOutcomeArtifactV1 = Schema032MigrationTargetBinding & {
  version: "schema-032-migration-outcome-v1";
  sequence: Schema032MigrationSequence;
  commandId: "db_migrate";
  redactedTemplateSha256: string;
  exitCode: 0;
  migrationFilename: typeof REQUIRED_SCHEMA_FILENAME;
  checksumSha256: string;
  status: Schema032MigrationStatus;
  stdout: string;
  stdoutSha256: string;
};

export const SCHEMA_032_CLIENT_CONFIG = Object.freeze({
  connectionTimeoutMillis: 5_000,
  query_timeout: 15_000,
  statement_timeout: 15_000,
  application_name: "schema032_release_verifier"
} satisfies ClientConfig);

export interface Schema032Client extends SchemaQueryable {
  connect(): Promise<void>;
  end(): Promise<void>;
}

export type Schema032ReleaseEvidenceV1 = {
  candidateSha: string;
  databaseRole: Schema032DatabaseRole;
  databaseFingerprintSha256: string;
  migrationFilename: typeof REQUIRED_SCHEMA_FILENAME;
  candidateBytesChecksumSha256: string;
  receiptChecksumSha256: string;
  shortChecksum: string;
  postconditionsSha256: string;
  firstApply: "applied" | "already_verified";
  secondApply: "already_verified";
};

export type Schema032FirstPhaseEvidenceV1 = {
  version: "schema-032-first-phase-evidence-v1";
  phase: "first";
  candidateSha: string;
  databaseRole: Schema032DatabaseRole;
  databaseFingerprintSha256: string;
  migrationFilename: typeof REQUIRED_SCHEMA_FILENAME;
  candidateBytesChecksumSha256: string;
  receiptChecksumSha256: string;
  shortChecksum: string;
  postconditionsSha256: string;
  firstApply: "applied" | "already_verified";
};

const DATABASE_ROLES: Readonly<Record<string, Schema032DatabaseRole>> = {
  tron_watch_plan5_clean: "clean",
  tron_watch_plan5_clone: "production_clone",
  tron_watch_plan5_runtime_sanitized: "runtime_sanitized",
  tron_watch: "production"
};
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SYSTEM_IDENTIFIER_PATTERN = /^[0-9]{10,30}$/;
const MAX_MIGRATION_OUTCOME_BYTES = 1024 * 1024;
const MIGRATION_OUTPUT_LINE_PATTERN = /^Migration applied: migrations\/\d{3}_[A-Za-z0-9_.-]+\.sql$/;
const OFFLINE_RUNTIME_ENV_PATTERN = /(?:TELEGRAM|BOT_TOKEN|TRONSCAN|TRONGRID|PROVIDER|ADMIN_(?:TOKEN|PASSWORD|SECRET)|OPENAI|ANTHROPIC|LLM_|RUNTIME_GIT_SHA|RUNTIME_INSTANCE_LABEL)/i;
const MIGRATION_OUTCOME_KEYS = [
  "candidateSha",
  "databaseRole",
  "databaseName",
  "databaseEndpoint",
  "databaseSystemIdentifierSha256",
  "databaseFingerprintSha256",
  "version",
  "sequence",
  "commandId",
  "redactedTemplateSha256",
  "exitCode",
  "migrationFilename",
  "checksumSha256",
  "status",
  "stdout",
  "stdoutSha256"
] as const;
const EVIDENCE_KEYS = [
  "candidateSha",
  "databaseRole",
  "databaseFingerprintSha256",
  "migrationFilename",
  "candidateBytesChecksumSha256",
  "receiptChecksumSha256",
  "shortChecksum",
  "postconditionsSha256",
  "firstApply",
  "secondApply"
] as const;

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256 = sha256("npm run --silent db:migrate");

function normalizeCatalogText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedDatabaseEndpoint(databaseUrl: string): { endpoint: string; hostname: string } {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("schema_032_database_url_invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    fail("schema_032_database_url_invalid");
  }
  if (parsed.search || parsed.hash) fail("schema_032_database_url_overrides_forbidden");
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || "5432";
  return { endpoint: `${hostname}:${port}`, hostname };
}

function normalizeExpectedEndpoint(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(`postgresql://${value}/schema032`);
  } catch {
    fail("schema_032_expected_endpoint_invalid");
  }
  const normalized = `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}`;
  if (value !== normalized || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("schema_032_expected_endpoint_invalid");
  }
  return normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function statusFromMigrationStdout(stdout: unknown, sequence: Schema032MigrationSequence): Schema032MigrationStatus {
  if (
    typeof stdout !== "string" ||
    stdout.length === 0 ||
    stdout.includes("\0") ||
    Buffer.byteLength(stdout, "utf8") > MAX_MIGRATION_OUTCOME_BYTES
  ) {
    fail("schema_032_migration_outcome_output_invalid");
  }
  const appliedLine = `Migration applied and verified: migrations/${REQUIRED_SCHEMA_FILENAME} (schema 32 ${APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)})`;
  const verifiedLine = `Migration already verified: migrations/${REQUIRED_SCHEMA_FILENAME} (schema 32 ${APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)})`;
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.some((line) => !MIGRATION_OUTPUT_LINE_PATTERN.test(line) && line !== appliedLine && line !== verifiedLine)) {
    fail("schema_032_migration_outcome_output_invalid");
  }
  const relatedLines = lines.filter((line) => line.includes(REQUIRED_SCHEMA_FILENAME) || line.includes("schema 32"));
  if (relatedLines.length !== 1) fail("schema_032_migration_outcome_output_mismatch");
  const status = relatedLines[0] === appliedLine
    ? "applied"
    : relatedLines[0] === verifiedLine
      ? "already_verified"
      : fail("schema_032_migration_outcome_output_mismatch");
  if (sequence === "second" && status !== "already_verified") {
    fail("schema_032_second_migration_not_already_verified");
  }
  return status;
}

function assertMigrationTargetBinding(value: Schema032MigrationTargetBinding): void {
  if (!SHA_PATTERN.test(value.candidateSha)) fail("schema_032_migration_candidate_invalid");
  if (DATABASE_ROLES[value.databaseName] !== value.databaseRole) fail("schema_032_migration_database_target_invalid");
  if (normalizeExpectedEndpoint(value.databaseEndpoint) !== value.databaseEndpoint) {
    fail("schema_032_migration_database_endpoint_invalid");
  }
  if (!SHA256_PATTERN.test(value.databaseSystemIdentifierSha256)) {
    fail("schema_032_migration_system_identifier_hash_invalid");
  }
  if (!SHA256_PATTERN.test(value.databaseFingerprintSha256)) {
    fail("schema_032_migration_database_fingerprint_invalid");
  }
}

export function buildSchema032DatabaseFingerprint(input: {
  databaseEndpoint: string;
  systemIdentifier: string;
  databaseName: string;
  databaseOid: string;
  serverVersion: string;
}): string {
  const endpoint = normalizeExpectedEndpoint(input.databaseEndpoint);
  if (!SYSTEM_IDENTIFIER_PATTERN.test(input.systemIdentifier)) fail("schema_032_expected_system_identifier_invalid");
  if (!DATABASE_ROLES[input.databaseName]) fail("schema_032_database_name_not_allowed");
  if (!/^\d+$/.test(input.databaseOid) || !/^\d+$/.test(input.serverVersion)) {
    fail("schema_032_database_identity_invalid");
  }
  return sha256(JSON.stringify({
    endpoint,
    systemIdentifier: input.systemIdentifier,
    databaseName: input.databaseName,
    databaseOid: input.databaseOid,
    serverVersion: input.serverVersion
  }));
}

export function buildSchema032MigrationOutcomeArtifact(input: Schema032MigrationTargetBinding & {
  sequence: Schema032MigrationSequence;
  commandId: "db_migrate";
  redactedTemplateSha256: string;
  migrationFilename: typeof REQUIRED_SCHEMA_FILENAME;
  checksumSha256: string;
  spawnResult: {
    status: number | null;
    stdout: string;
    stderr: string;
    signal?: NodeJS.Signals | null;
    error?: Error;
  };
}): string {
  assertMigrationTargetBinding(input);
  if (input.commandId !== "db_migrate" || input.redactedTemplateSha256 !== SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256) {
    fail("schema_032_migration_command_mismatch");
  }
  if (input.migrationFilename !== REQUIRED_SCHEMA_FILENAME) fail("schema_032_migration_filename_mismatch");
  if (input.checksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) fail("schema_032_migration_outcome_checksum_mismatch");
  if (input.spawnResult.status !== 0 || input.spawnResult.signal || input.spawnResult.error || input.spawnResult.stderr.trim()) {
    fail("schema_032_migration_command_failed");
  }
  const status = statusFromMigrationStdout(input.spawnResult.stdout, input.sequence);
  const artifact: Schema032MigrationOutcomeArtifactV1 = {
    candidateSha: input.candidateSha,
    databaseRole: input.databaseRole,
    databaseName: input.databaseName,
    databaseEndpoint: input.databaseEndpoint,
    databaseSystemIdentifierSha256: input.databaseSystemIdentifierSha256,
    databaseFingerprintSha256: input.databaseFingerprintSha256,
    version: "schema-032-migration-outcome-v1",
    sequence: input.sequence,
    commandId: input.commandId,
    redactedTemplateSha256: input.redactedTemplateSha256,
    exitCode: 0,
    migrationFilename: input.migrationFilename,
    checksumSha256: input.checksumSha256,
    status,
    stdout: input.spawnResult.stdout,
    stdoutSha256: sha256(input.spawnResult.stdout)
  };
  return JSON.stringify(artifact);
}

export function parseSchema032MigrationOutcomeArtifact(
  artifact: string,
  expected: Schema032MigrationTargetBinding & { sequence: Schema032MigrationSequence }
): { status: Schema032MigrationStatus; checksumSha256: string } {
  if (Buffer.byteLength(artifact, "utf8") > MAX_MIGRATION_OUTCOME_BYTES) fail("schema_032_migration_outcome_too_large");
  let value: unknown;
  try {
    value = JSON.parse(artifact);
  } catch {
    fail("schema_032_migration_outcome_invalid");
  }
  if (!isRecord(value)) fail("schema_032_migration_outcome_invalid");
  if (Object.keys(value).sort().join("|") !== [...MIGRATION_OUTCOME_KEYS].sort().join("|")) {
    fail("schema_032_migration_outcome_fields_mismatch");
  }
  assertMigrationTargetBinding(expected);
  for (const key of [
    "candidateSha",
    "databaseRole",
    "databaseName",
    "databaseEndpoint",
    "databaseSystemIdentifierSha256",
    "databaseFingerprintSha256"
  ] as const) {
    if (value[key] !== expected[key]) fail(`schema_032_migration_${key}_mismatch`);
  }
  if (value.version !== "schema-032-migration-outcome-v1") fail("schema_032_migration_outcome_version_mismatch");
  if (value.sequence !== expected.sequence) fail("schema_032_migration_sequence_mismatch");
  if (value.commandId !== "db_migrate" || value.redactedTemplateSha256 !== SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256) {
    fail("schema_032_migration_command_mismatch");
  }
  if (value.exitCode !== 0) fail("schema_032_migration_command_failed");
  if (value.migrationFilename !== REQUIRED_SCHEMA_FILENAME) fail("schema_032_migration_filename_mismatch");
  if (value.checksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) fail("schema_032_migration_outcome_checksum_mismatch");
  if (typeof value.stdout !== "string" || value.stdoutSha256 !== sha256(value.stdout)) {
    fail("schema_032_migration_stdout_hash_mismatch");
  }
  const status = statusFromMigrationStdout(value.stdout, expected.sequence);
  if (value.status !== status) fail("schema_032_migration_outcome_status_mismatch");
  return { status, checksumSha256: value.checksumSha256 as string };
}

export function validateSchema032ReleaseEvidence(
  value: unknown,
  expected: { candidateSha: string; postconditionsSha256: string }
): Schema032ReleaseEvidenceV1 {
  if (!isRecord(value)) fail("schema_032_release_evidence_invalid");
  if (Object.keys(value).sort().join("|") !== [...EVIDENCE_KEYS].sort().join("|")) {
    fail("schema_032_release_evidence_fields_mismatch");
  }
  if (!SHA_PATTERN.test(expected.candidateSha) || value.candidateSha !== expected.candidateSha) {
    fail("schema_032_release_candidate_mismatch");
  }
  if (!SHA256_PATTERN.test(expected.postconditionsSha256) || value.postconditionsSha256 !== expected.postconditionsSha256) {
    fail("schema_032_release_postconditions_mismatch");
  }
  if (!Object.values(DATABASE_ROLES).includes(value.databaseRole as Schema032DatabaseRole)) {
    fail("schema_032_release_database_role_invalid");
  }
  if (!SHA256_PATTERN.test(String(value.databaseFingerprintSha256 ?? ""))) {
    fail("schema_032_release_database_fingerprint_invalid");
  }
  if (value.migrationFilename !== REQUIRED_SCHEMA_FILENAME) fail("schema_032_release_filename_mismatch");
  if (value.candidateBytesChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) {
    fail("schema_032_release_candidate_checksum_mismatch");
  }
  if (value.receiptChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) {
    fail("schema_032_release_receipt_checksum_mismatch");
  }
  if (value.receiptChecksumSha256 !== value.candidateBytesChecksumSha256) {
    fail("schema_032_release_full_checksum_mismatch");
  }
  if (value.shortChecksum !== APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)) {
    fail("schema_032_release_short_checksum_mismatch");
  }
  if (value.firstApply !== "applied" && value.firstApply !== "already_verified") {
    fail("schema_032_release_first_apply_invalid");
  }
  if (value.secondApply !== "already_verified") fail("schema_032_release_second_apply_invalid");
  return value as Schema032ReleaseEvidenceV1;
}

export function classifySchema032Database(
  databaseUrl: string,
  offline: boolean
): { databaseName: string; databaseRole: Schema032DatabaseRole } {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("schema_032_database_url_invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    fail("schema_032_database_url_invalid");
  }
  if (parsed.search || parsed.hash) fail("schema_032_database_url_overrides_forbidden");
  const path = parsed.pathname.slice(1);
  if (path.length === 0 || path.includes("/")) fail("schema_032_database_name_invalid");
  const databaseName = decodeURIComponent(path);
  const databaseRole = DATABASE_ROLES[databaseName];
  if (!databaseRole) fail("schema_032_database_name_not_allowed");
  if (databaseRole === "production_clone" && !offline) fail("schema_032_clone_requires_offline_mode");
  if (databaseRole === "production" && offline) fail("schema_032_production_offline_forbidden");
  if (databaseRole !== "production" && !offline) fail("schema_032_disposable_requires_offline_mode");
  if (databaseRole !== "production" && !isLoopbackHostname(normalizedDatabaseEndpoint(databaseUrl).hostname)) {
    fail("schema_032_disposable_loopback_required");
  }
  return { databaseName, databaseRole };
}

export function buildSchema032ClientConfig(databaseUrl: string, offline: boolean): ClientConfig {
  const target = classifySchema032Database(databaseUrl, offline);
  const endpoint = normalizedDatabaseEndpoint(databaseUrl);
  const parsed = new URL(databaseUrl);
  let user: string;
  let password: string;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    fail("schema_032_database_url_invalid");
  }
  const port = Number.parseInt(parsed.port || "5432", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail("schema_032_database_url_invalid");
  return {
    host: endpoint.hostname.replace(/^\[|\]$/g, ""),
    port,
    user: user || undefined,
    password: password || undefined,
    database: target.databaseName,
    ...SCHEMA_032_CLIENT_CONFIG
  };
}

export function assertSchema032OfflineEnvironment(
  databaseUrlEnvName: string,
  env: NodeJS.ProcessEnv
): void {
  if (!SAFE_ENV_NAME_PATTERN.test(databaseUrlEnvName)) fail("schema_032_database_url_env_invalid");
  if (databaseUrlEnvName === "DATABASE_URL" || Object.hasOwn(env, "DATABASE_URL")) {
    fail("schema_032_offline_database_url_env_forbidden");
  }
  if (!env[databaseUrlEnvName]) fail("schema_032_database_url_missing");
  for (const name of Object.keys(env)) {
    if (name !== databaseUrlEnvName && OFFLINE_RUNTIME_ENV_PATTERN.test(name)) {
      fail("schema_032_offline_runtime_environment_forbidden");
    }
  }
}

async function collectPostconditionsSha256(client: SchemaQueryable): Promise<string> {
  const columns = await client.query(`select table_name, column_name, data_type, is_nullable,
      coalesce(column_default, '') as column_default
    from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'schema_migration_receipts' and column_name = any($1::text[]))
        or (table_name = 'wallet_approvals' and column_name = any($2::text[])))
    order by table_name, column_name`, [
    ["version", "filename", "checksum_sha256", "applied_at"],
    ["allowance_confirmed_raw", "allowance_check_status", "allowance_checked_at", "allowance_fresh_until", "allowance_last_attempt_at", "allowance_failure_code"]
  ]);
  const constraints = await client.query(`select t.relname as table_name, c.conname, c.contype,
      c.convalidated, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and c.conname = any($1::text[])
    order by t.relname, c.conname`, [[
    "schema_migration_receipts_pkey",
    "schema_migration_receipts_filename_key",
    "schema_migration_receipts_checksum_check",
    "wallet_approvals_allowance_status_v2_check",
    "wallet_approvals_allowance_uint256_v2_check",
    "wallet_approvals_allowance_shape_v2_check",
    "wallet_approvals_allowance_failure_v2_check",
    "wallet_approvals_allowance_timestamps_v2_check"
  ]]);
  const index = await client.query(`select indexname, indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'wallet_approvals'
      and indexname = 'idx_wallet_approvals_allowance_refresh'`);
  const receipt = await client.query(`select version, filename, checksum_sha256
    from public.schema_migration_receipts where version = $1`, [REQUIRED_SCHEMA_VERSION]);
  const postconditions = {
    version: 1,
    verification: "verifyRequiredSchema032:passed",
    columns: columns.rows.map((row) => ({
      tableName: row.table_name,
      columnName: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable,
      columnDefault: normalizeCatalogText(row.column_default)
    })),
    constraints: constraints.rows.map((row) => ({
      tableName: row.table_name,
      name: row.conname,
      type: row.contype,
      validated: row.convalidated,
      definition: normalizeCatalogText(row.definition)
    })),
    index: index.rows.map((row) => ({
      name: row.indexname,
      definition: normalizeCatalogText(row.indexdef)
    })),
    receipt: receipt.rows.map((row) => ({
      version: Number(row.version),
      filename: row.filename,
      checksumSha256: row.checksum_sha256
    }))
  };
  return sha256(JSON.stringify(postconditions));
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): {
  phase: Schema032VerificationPhase;
  databaseUrlEnvName: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
  firstMigrationOutcomeFile: string;
  secondMigrationOutcomeFile?: string;
  offline: boolean;
} {
  let phase: Schema032VerificationPhase | undefined;
  let databaseUrlEnvName: string | undefined;
  let expectedEndpoint: string | undefined;
  let expectedSystemIdentifier: string | undefined;
  let firstMigrationOutcomeFile: string | undefined;
  let secondMigrationOutcomeFile: string | undefined;
  let offline = env.SCHEMA_032_OFFLINE === "1";
  if (env.SCHEMA_032_OFFLINE !== undefined && env.SCHEMA_032_OFFLINE !== "0" && env.SCHEMA_032_OFFLINE !== "1") {
    fail("schema_032_offline_env_invalid");
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--offline") {
      offline = true;
      continue;
    }
    if (arg === "--phase" && phase === undefined) {
      const value = argv[index + 1];
      if (value !== "first" && value !== "final") fail("schema_032_phase_invalid");
      phase = value;
      index += 1;
      continue;
    }
    if (arg === "--database-url-env" && databaseUrlEnvName === undefined) {
      databaseUrlEnvName = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-endpoint" && expectedEndpoint === undefined) {
      expectedEndpoint = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--expected-system-identifier" && expectedSystemIdentifier === undefined) {
      expectedSystemIdentifier = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--first-migration-outcome-file" && firstMigrationOutcomeFile === undefined) {
      firstMigrationOutcomeFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--second-migration-outcome-file" && secondMigrationOutcomeFile === undefined) {
      secondMigrationOutcomeFile = argv[index + 1];
      index += 1;
      continue;
    }
    fail("schema_032_cli_argument_invalid");
  }
  databaseUrlEnvName ??= env.SCHEMA_032_DATABASE_URL_ENV ?? "DATABASE_URL";
  const phaseFromEnv = env.SCHEMA_032_PHASE;
  if (phase === undefined && phaseFromEnv !== undefined && phaseFromEnv !== "first" && phaseFromEnv !== "final") {
    fail("schema_032_phase_invalid");
  }
  phase ??= phaseFromEnv as Schema032VerificationPhase | undefined;
  phase ??= "final";
  expectedEndpoint ??= env.SCHEMA_032_EXPECTED_ENDPOINT;
  expectedSystemIdentifier ??= env.SCHEMA_032_EXPECTED_SYSTEM_IDENTIFIER;
  firstMigrationOutcomeFile ??= env.SCHEMA_032_FIRST_MIGRATION_OUTCOME_FILE;
  secondMigrationOutcomeFile ??= env.SCHEMA_032_SECOND_MIGRATION_OUTCOME_FILE;
  if (!databaseUrlEnvName || !SAFE_ENV_NAME_PATTERN.test(databaseUrlEnvName)) {
    fail("schema_032_database_url_env_required");
  }
  if (!expectedEndpoint) fail("schema_032_expected_endpoint_required");
  if (!expectedSystemIdentifier) fail("schema_032_expected_system_identifier_required");
  if (!firstMigrationOutcomeFile) fail("schema_032_first_migration_outcome_file_required");
  if (phase === "final" && !secondMigrationOutcomeFile) fail("schema_032_second_migration_outcome_file_required");
  return {
    phase,
    databaseUrlEnvName,
    expectedEndpoint,
    expectedSystemIdentifier,
    firstMigrationOutcomeFile,
    secondMigrationOutcomeFile,
    offline
  };
}

async function readMigrationOutcomeFile(path: string): Promise<string> {
  const metadata = await stat(path).catch(() => fail("schema_032_migration_outcome_file_invalid"));
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MIGRATION_OUTCOME_BYTES) {
    fail("schema_032_migration_outcome_file_invalid");
  }
  return readFile(path, "utf8");
}

export async function verifySchema032Release(options: {
  phase?: Schema032VerificationPhase;
  databaseUrl: string;
  offline: boolean;
  candidateSha: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
  firstMigrationOutcome: string;
  secondMigrationOutcome?: string;
  clientFactory?: (config: ClientConfig) => Schema032Client;
}): Promise<Schema032FirstPhaseEvidenceV1 | Schema032ReleaseEvidenceV1> {
  const phase = options.phase ?? "final";
  if (!SHA_PATTERN.test(options.candidateSha)) fail("schema_032_candidate_sha_invalid");
  const expectedEndpoint = normalizeExpectedEndpoint(options.expectedEndpoint);
  if (normalizedDatabaseEndpoint(options.databaseUrl).endpoint !== expectedEndpoint) {
    fail("schema_032_database_endpoint_mismatch");
  }
  if (!SYSTEM_IDENTIFIER_PATTERN.test(options.expectedSystemIdentifier)) {
    fail("schema_032_expected_system_identifier_invalid");
  }
  const target = classifySchema032Database(options.databaseUrl, options.offline);
  const migrationBytes = await readFile(new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url));
  const candidateBytesChecksumSha256 = await checksumMigrationBytes(migrationBytes);
  if (candidateBytesChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM) {
    fail("schema_032_release_candidate_checksum_mismatch");
  }
  const clientConfig = buildSchema032ClientConfig(options.databaseUrl, options.offline);
  const client = options.clientFactory?.(clientConfig) ?? new Client(clientConfig);
  let primaryFailure: unknown;
  try {
    await client.connect();
    const identity = await client.query(`select current_database() as database_name,
      current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid,
      (pg_control_system()).system_identifier::text as system_identifier`);
    const identityRow = identity.rows[0];
    if (identity.rows.length !== 1 || identityRow?.database_name !== target.databaseName) {
      fail("schema_032_database_identity_mismatch");
    }
    if (identityRow.system_identifier !== options.expectedSystemIdentifier) {
      fail("schema_032_database_cluster_mismatch");
    }
    const databaseFingerprintSha256 = buildSchema032DatabaseFingerprint({
      databaseEndpoint: expectedEndpoint,
      systemIdentifier: options.expectedSystemIdentifier,
      databaseName: target.databaseName,
      databaseOid: String(identityRow.database_oid),
      serverVersion: String(identityRow.server_version_num)
    });
    const migrationTarget: Schema032MigrationTargetBinding = {
      candidateSha: options.candidateSha,
      databaseRole: target.databaseRole,
      databaseName: target.databaseName,
      databaseEndpoint: expectedEndpoint,
      databaseSystemIdentifierSha256: sha256(options.expectedSystemIdentifier),
      databaseFingerprintSha256
    };
    const firstMigration = parseSchema032MigrationOutcomeArtifact(options.firstMigrationOutcome, {
      ...migrationTarget,
      sequence: "first"
    });
    const secondMigration = phase === "final"
      ? parseSchema032MigrationOutcomeArtifact(
          options.secondMigrationOutcome ?? fail("schema_032_second_migration_outcome_required"),
          { ...migrationTarget, sequence: "second" }
        )
      : null;
    if (secondMigration !== null && secondMigration.status !== "already_verified") {
      fail("schema_032_second_migration_not_already_verified");
    }
    const first = await verifyRequiredSchema032(client, candidateBytesChecksumSha256);
    if (first.filename !== REQUIRED_SCHEMA_FILENAME || first.checksumSha256 !== candidateBytesChecksumSha256) {
      fail("schema_032_release_verification_mismatch");
    }
    const postconditionsSha256 = await collectPostconditionsSha256(client);
    const second = await verifyRequiredSchema032(client, candidateBytesChecksumSha256);
    const receipt = await client.query(`select filename, checksum_sha256
      from public.schema_migration_receipts where version = $1`, [REQUIRED_SCHEMA_VERSION]);
    if (receipt.rows.length !== 1) fail("schema_032_receipt_count_mismatch");
    if (receipt.rows[0]?.filename !== REQUIRED_SCHEMA_FILENAME) fail("schema_032_filename_mismatch");
    if (receipt.rows[0]?.checksum_sha256 !== candidateBytesChecksumSha256) fail("schema_032_checksum_mismatch");
    if (phase === "first") {
      return {
        version: "schema-032-first-phase-evidence-v1",
        phase: "first",
        candidateSha: options.candidateSha,
        databaseRole: target.databaseRole,
        databaseFingerprintSha256,
        migrationFilename: REQUIRED_SCHEMA_FILENAME,
        candidateBytesChecksumSha256,
        receiptChecksumSha256: String(receipt.rows[0].checksum_sha256),
        shortChecksum: second.shortChecksum,
        postconditionsSha256,
        firstApply: firstMigration.status
      };
    }
    if (secondMigration === null) fail("schema_032_second_migration_outcome_required");
    const evidence: Schema032ReleaseEvidenceV1 = {
      candidateSha: options.candidateSha,
      databaseRole: target.databaseRole,
      databaseFingerprintSha256,
      migrationFilename: REQUIRED_SCHEMA_FILENAME,
      candidateBytesChecksumSha256,
      receiptChecksumSha256: String(receipt.rows[0].checksum_sha256),
      shortChecksum: second.shortChecksum,
      postconditionsSha256,
      firstApply: firstMigration.status,
      secondApply: "already_verified"
    };
    return validateSchema032ReleaseEvidence(evidence, {
      candidateSha: options.candidateSha,
      postconditionsSha256
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      await client.end();
    } catch (error) {
      if (primaryFailure === undefined) throw error;
    }
  }
}

function currentCandidateSha(): string {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!SHA_PATTERN.test(sha)) fail("schema_032_candidate_sha_invalid");
  return sha;
}

async function main(): Promise<void> {
  const {
    phase,
    databaseUrlEnvName,
    expectedEndpoint,
    expectedSystemIdentifier,
    firstMigrationOutcomeFile,
    secondMigrationOutcomeFile,
    offline
  } = parseArgs(process.argv.slice(2), process.env);
  if (offline) assertSchema032OfflineEnvironment(databaseUrlEnvName, process.env);
  const databaseUrl = process.env[databaseUrlEnvName];
  if (!databaseUrl) fail("schema_032_database_url_missing");
  const evidence = await verifySchema032Release({
    phase,
    databaseUrl,
    offline,
    candidateSha: currentCandidateSha(),
    expectedEndpoint,
    expectedSystemIdentifier,
    firstMigrationOutcome: await readMigrationOutcomeFile(firstMigrationOutcomeFile),
    secondMigrationOutcome: secondMigrationOutcomeFile === undefined
      ? undefined
      : await readMigrationOutcomeFile(secondMigrationOutcomeFile)
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^schema_[a-z0-9_:.-]+$/.test(message) ? message : "schema_032_verification_failed";
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url).toLowerCase() === invokedPath.toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: safeErrorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
