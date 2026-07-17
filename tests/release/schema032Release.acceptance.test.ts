import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  CANDIDATE_SHA,
  POSTCONDITIONS_SHA256,
  buildSchema032ReleaseEvidence,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

const APPROVED_CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
const CLEAN_DATABASE = "tron_watch_plan5_clean";
const CLONE_DATABASE = "tron_watch_plan5_clone";
const SANITIZED_DATABASE = "tron_watch_plan5_runtime_sanitized";
const required = process.env.REQUIRE_PLAN5_POSTGRES === "1";
const cleanUrl = process.env.PLAN5_SCHEMA_CLEAN_DATABASE_URL;
const cloneUrl = process.env.PLAN5_SCHEMA_CLONE_DATABASE_URL;
const sanitizedUrl = process.env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL;
const expectedEndpoint = process.env.PLAN5_SCHEMA_EXPECTED_ENDPOINT;
const expectedSystemIdentifier = process.env.PLAN5_SCHEMA_EXPECTED_SYSTEM_IDENTIFIER;
const CURRENT_CANDIDATE_SHA = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

type SchemaApi = typeof import("../../scripts/verifySchema032");

async function loadApi(): Promise<SchemaApi> {
  const modulePath: string = "../../scripts/verifySchema032";
  try {
    return await import(/* @vite-ignore */ modulePath) as SchemaApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: schema 032 release verifier", { cause: error });
  }
}

function databaseName(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
}

function safeChildEnv(databaseUrl: string, envName: string): NodeJS.ProcessEnv {
  const inherited = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "TEMP", "TMP"];
  return Object.fromEntries([
    ...inherited.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]]),
    [envName, databaseUrl],
    ["DOTENV_CONFIG_PATH", resolve("tests/fixtures/release/plan5-no-dotenv")]
  ]);
}

function runNode(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 120_000
  });
}

function runMigrate(databaseUrl: string) {
  return runNpmScript("db:migrate", safeChildEnv(databaseUrl, "DATABASE_URL"));
}

function runNpmScript(script: "db:migrate" | "schema:verify", env: NodeJS.ProcessEnv) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run --silent ${script}`]
    : ["run", "--silent", script];
  return spawnSync(executable, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 120_000
  });
}

async function destructiveTestClient(databaseUrl: string): Promise<pg.Client> {
  const api = await loadApi();
  return new pg.Client(api.buildSchema032ClientConfig(databaseUrl, true));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function migrationOutput(status: "applied" | "already_verified"): string {
  const action = status === "applied" ? "applied and verified" : "already verified";
  return `Migration ${action}: migrations/032_telegram_runtime_forensics_data_contracts.sql (schema 32 41217f64c33c)\n`;
}

function migrationTarget(overrides: Record<string, unknown> = {}) {
  return {
    candidateSha: CURRENT_CANDIDATE_SHA,
    databaseRole: "clean",
    databaseName: CLEAN_DATABASE,
    databaseEndpoint: "127.0.0.1:55435",
    databaseSystemIdentifierSha256: sha256("1234567890123456789"),
    databaseFingerprintSha256: "d".repeat(64),
    ...overrides
  };
}

async function resetPublicSchema(options: {
  client: pg.Client;
  databaseUrl: string;
  expectedDatabase: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
}): Promise<void> {
  const { client, databaseUrl, expectedDatabase, expectedEndpoint, expectedSystemIdentifier } = options;
  const endpoint = `${new URL(databaseUrl).hostname.toLowerCase()}:${new URL(databaseUrl).port || "5432"}`;
  if (endpoint !== expectedEndpoint) throw new Error("plan5_database_endpoint_mismatch");
  const identity = await client.query(`select current_database() as database_name,
    (pg_control_system()).system_identifier::text as system_identifier`);
  if (
    identity.rows.length !== 1 ||
    identity.rows[0]?.database_name !== expectedDatabase ||
    identity.rows[0]?.system_identifier !== expectedSystemIdentifier
  ) {
    throw new Error("plan5_database_identity_mismatch");
  }
  await client.query("drop schema public cascade");
  await client.query("create schema public");
}

async function rehearseLegacy31ToSchema032(options: {
  client: pg.Client;
  databaseUrl: string;
  databaseRole: "clean" | "production_clone";
  fixturePrefix: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
  verifyViaNpm?: boolean;
}): Promise<void> {
  const {
    client,
    databaseUrl,
    databaseRole,
    fixturePrefix,
    expectedEndpoint,
    expectedSystemIdentifier,
    verifyViaNpm = false
  } = options;
  const walletId = `${fixturePrefix}-wallet`;
  for (const filename of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    const version = Number.parseInt(filename.slice(0, 3), 10);
    if (version >= 32) continue;
    await client.query(readFileSync(resolve("migrations", filename), "utf8"));
  }
  await client.query("insert into telegram_users (telegram_user_id) values ($1)", [`${fixturePrefix}-user`]);
  await client.query(`insert into watched_wallets (id, telegram_user_id, address)
    values ($1, $2, 'TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD')`, [walletId, `${fixturePrefix}-user`]);
  await client.query(`insert into wallet_approvals (
    watched_wallet_id, token_contract, spender_address, amount_raw, is_unlimited,
    current_allowance_raw, status, last_approval_tx_hash, last_approval_at
  ) values (
    $1, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    'TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK', '99', true, '99', 'active',
    $2, '2026-07-12T11:55:00.000Z'
  )`, [walletId, `${fixturePrefix}-approval`]);

  const firstMigration = runMigrate(databaseUrl);
  expect(firstMigration.status, firstMigration.stderr).toBe(0);
  expect(firstMigration.stdout).toContain("schema 32 41217f64c33c");
  expect(firstMigration.stdout).toContain("applied and verified");

  const backfilled = await client.query(`select allowance_confirmed_raw, allowance_check_status,
    current_allowance_raw, is_unlimited, status from wallet_approvals where watched_wallet_id = $1`, [walletId]);
  expect(backfilled.rows).toEqual([{
    allowance_confirmed_raw: null,
    allowance_check_status: "stale",
    current_allowance_raw: "0",
    is_unlimited: false,
    status: "unknown"
  }]);
  await expect(client.query(`update wallet_approvals set
    allowance_check_status = 'confirmed_active', allowance_confirmed_raw = '0',
    current_allowance_raw = '0', is_unlimited = false, status = 'active'
    where watched_wallet_id = $1`, [walletId])).rejects.toMatchObject({ code: "23514" });

  const receipt = await client.query(
    "select version, filename, checksum_sha256 from schema_migration_receipts where version = 32"
  );
  expect(receipt.rows).toEqual([{
    version: 32,
    filename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksum_sha256: APPROVED_CHECKSUM
  }]);

  const api = await loadApi() as any;
  const identity = await client.query(`select current_database() as database_name,
    current_setting('server_version_num') as server_version_num,
    (select oid::text from pg_database where datname = current_database()) as database_oid,
    (pg_control_system()).system_identifier::text as system_identifier`);
  const databaseFingerprintSha256 = api.buildSchema032DatabaseFingerprint({
    databaseEndpoint: expectedEndpoint,
    systemIdentifier: expectedSystemIdentifier,
    databaseName: identity.rows[0].database_name,
    databaseOid: String(identity.rows[0].database_oid),
    serverVersion: String(identity.rows[0].server_version_num)
  });
  const target = {
    candidateSha: CURRENT_CANDIDATE_SHA,
    databaseRole,
    databaseName: identity.rows[0].database_name,
    databaseEndpoint: expectedEndpoint,
    databaseSystemIdentifierSha256: sha256(expectedSystemIdentifier),
    databaseFingerprintSha256
  };
  const firstMigrationOutcome = api.buildSchema032MigrationOutcomeArtifact({
    ...target,
    sequence: "first",
    commandId: "db_migrate",
    redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksumSha256: APPROVED_CHECKSUM,
    spawnResult: firstMigration
  });
  const artifactDir = mkdtempSync(join(tmpdir(), "schema032-release-"));
  const firstArtifactPath = join(artifactDir, "first-migration-outcome.json");
  const secondArtifactPath = join(artifactDir, "second-migration-outcome.json");
  try {
    writeFileSync(firstArtifactPath, firstMigrationOutcome, { encoding: "utf8", flag: "wx" });
    const firstVerification = runNode([
      "--import", "tsx", "scripts/verifySchema032.ts",
      "--phase", "first",
      "--database-url-env", "PLAN5_SCHEMA_DATABASE_URL",
      "--expected-endpoint", expectedEndpoint,
      "--expected-system-identifier", expectedSystemIdentifier,
      "--first-migration-outcome-file", firstArtifactPath,
      "--offline"
    ], safeChildEnv(databaseUrl, "PLAN5_SCHEMA_DATABASE_URL"));
    expect(firstVerification.status, firstVerification.stderr).toBe(0);
    const firstEvidence = JSON.parse(firstVerification.stdout.trim());
    expect(firstEvidence).toMatchObject({
      version: "schema-032-first-phase-evidence-v1",
      phase: "first",
      candidateSha: CURRENT_CANDIDATE_SHA,
      databaseRole,
      migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
      candidateBytesChecksumSha256: APPROVED_CHECKSUM,
      receiptChecksumSha256: APPROVED_CHECKSUM,
      shortChecksum: APPROVED_CHECKSUM.slice(0, 12),
      firstApply: "applied"
    });
    expect(firstEvidence).not.toHaveProperty("secondApply");
    expect(firstEvidence.databaseFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(firstEvidence.postconditionsSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(api.verifySchema032Release({
      phase: "first",
      databaseUrl,
      offline: true,
      candidateSha: firstEvidence.candidateSha,
      expectedEndpoint,
      expectedSystemIdentifier: `${BigInt(expectedSystemIdentifier) + 1n}`,
      firstMigrationOutcome
    })).rejects.toThrow("schema_032_database_cluster_mismatch");
    expect(firstVerification.stdout).not.toContain(databaseUrl);
    expect(firstVerification.stdout).not.toContain(expectedSystemIdentifier);
    expect(firstVerification.stdout).not.toContain(walletId);
    if (verifyViaNpm) {
      const firstNpmVerification = runNpmScript("schema:verify", {
        ...safeChildEnv(databaseUrl, "PLAN5_SCHEMA_DATABASE_URL"),
        SCHEMA_032_PHASE: "first",
        SCHEMA_032_DATABASE_URL_ENV: "PLAN5_SCHEMA_DATABASE_URL",
        SCHEMA_032_EXPECTED_ENDPOINT: expectedEndpoint,
        SCHEMA_032_EXPECTED_SYSTEM_IDENTIFIER: expectedSystemIdentifier,
        SCHEMA_032_FIRST_MIGRATION_OUTCOME_FILE: firstArtifactPath,
        SCHEMA_032_OFFLINE: "1"
      });
      expect(firstNpmVerification.status, firstNpmVerification.stderr).toBe(0);
      expect(JSON.parse(firstNpmVerification.stdout.trim())).toMatchObject({
        version: "schema-032-first-phase-evidence-v1",
        phase: "first",
        candidateSha: CURRENT_CANDIDATE_SHA,
        databaseRole,
        firstApply: "applied"
      });
    }

    const secondMigration = runMigrate(databaseUrl);
    expect(secondMigration.status, secondMigration.stderr).toBe(0);
    expect(secondMigration.stdout).toContain("already verified");
    const secondMigrationOutcome = api.buildSchema032MigrationOutcomeArtifact({
      ...target,
      sequence: "second",
      commandId: "db_migrate",
      redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
      migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: APPROVED_CHECKSUM,
      spawnResult: secondMigration
    });
    writeFileSync(secondArtifactPath, secondMigrationOutcome, { encoding: "utf8", flag: "wx" });
    const finalVerification = runNode([
      "--import", "tsx", "scripts/verifySchema032.ts",
      "--phase", "final",
      "--database-url-env", "PLAN5_SCHEMA_DATABASE_URL",
      "--expected-endpoint", expectedEndpoint,
      "--expected-system-identifier", expectedSystemIdentifier,
      "--first-migration-outcome-file", firstArtifactPath,
      "--second-migration-outcome-file", secondArtifactPath,
      "--offline"
    ], safeChildEnv(databaseUrl, "PLAN5_SCHEMA_DATABASE_URL"));
    expect(finalVerification.status, finalVerification.stderr).toBe(0);
    const evidence = JSON.parse(finalVerification.stdout.trim());
    expect(evidence).toMatchObject({
      databaseRole,
      migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
      candidateBytesChecksumSha256: APPROVED_CHECKSUM,
      receiptChecksumSha256: APPROVED_CHECKSUM,
      shortChecksum: APPROVED_CHECKSUM.slice(0, 12),
      firstApply: "applied",
      secondApply: "already_verified"
    });
    expect(evidence.databaseFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.postconditionsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => api.validateSchema032ReleaseEvidence(evidence, {
      candidateSha: evidence.candidateSha,
      postconditionsSha256: evidence.postconditionsSha256
    })).not.toThrow();
    expect(finalVerification.stdout).not.toContain(databaseUrl);
    expect(finalVerification.stdout).not.toContain(expectedSystemIdentifier);
    expect(finalVerification.stdout).not.toContain(walletId);
    if (verifyViaNpm) {
      const npmVerification = runNpmScript("schema:verify", {
          ...safeChildEnv(databaseUrl, "PLAN5_SCHEMA_DATABASE_URL"),
          SCHEMA_032_PHASE: "final",
          SCHEMA_032_DATABASE_URL_ENV: "PLAN5_SCHEMA_DATABASE_URL",
          SCHEMA_032_EXPECTED_ENDPOINT: expectedEndpoint,
          SCHEMA_032_EXPECTED_SYSTEM_IDENTIFIER: expectedSystemIdentifier,
          SCHEMA_032_FIRST_MIGRATION_OUTCOME_FILE: firstArtifactPath,
          SCHEMA_032_SECOND_MIGRATION_OUTCOME_FILE: secondArtifactPath,
          SCHEMA_032_OFFLINE: "1"
      });
      expect(npmVerification.status, npmVerification.stderr).toBe(0);
      expect(JSON.parse(npmVerification.stdout.trim())).toMatchObject({
        candidateSha: CURRENT_CANDIDATE_SHA,
        databaseRole,
        firstApply: "applied",
        secondApply: "already_verified"
      });
    }
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
}

it("[REQ-38][SCHEMA-032-RELEASE] rejects filename full candidate checksum receipt checksum or postcondition mismatch", async () => {
  const api = await loadApi();
  const expected = { candidateSha: CANDIDATE_SHA, postconditionsSha256: POSTCONDITIONS_SHA256 };
  expect(() => api.validateSchema032ReleaseEvidence(buildSchema032ReleaseEvidence(), expected)).not.toThrow();
  const invalid = [
    (value: any) => { value.migrationFilename = "032_wrong.sql"; },
    (value: any) => { value.candidateBytesChecksumSha256 = "f".repeat(64); },
    (value: any) => { value.receiptChecksumSha256 = "f".repeat(64); },
    (value: any) => { value.shortChecksum = "f".repeat(12); },
    (value: any) => { value.postconditionsSha256 = "f".repeat(64); },
    (value: any) => { value.secondApply = "applied"; }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(buildSchema032ReleaseEvidence());
    mutate(value);
    expect(() => api.validateSchema032ReleaseEvidence(value, expected)).toThrow();
  }
});

it("enforces exact disposable identities, offline clone isolation and credential-free verifier scope", async () => {
  const api = await loadApi();
  expect(api.classifySchema032Database(`postgresql://db:db@127.0.0.1:55435/${CLEAN_DATABASE}`, true)).toEqual({
    databaseName: CLEAN_DATABASE,
    databaseRole: "clean"
  });
  expect(api.classifySchema032Database(`postgresql://db:db@127.0.0.1:55435/${CLONE_DATABASE}`, true)).toEqual({
    databaseName: CLONE_DATABASE,
    databaseRole: "production_clone"
  });
  expect(api.classifySchema032Database(`postgresql://db:db@127.0.0.1:55435/${SANITIZED_DATABASE}`, true)).toEqual({
    databaseName: SANITIZED_DATABASE,
    databaseRole: "runtime_sanitized"
  });
  expect(() => api.classifySchema032Database(
    `postgresql://db:db@127.0.0.1:55435/${CLEAN_DATABASE}?host=attacker.invalid`,
    true
  )).toThrow("schema_032_database_url_overrides_forbidden");
  expect(() => api.classifySchema032Database(
    `postgresql://db:db@127.0.0.1:55435/${CLEAN_DATABASE}#dbname=tron_watch`,
    true
  )).toThrow("schema_032_database_url_overrides_forbidden");
  expect(() => api.classifySchema032Database("postgresql://db:db@127.0.0.1:55435/tron_watch_plan5_clone", false))
    .toThrow("schema_032_clone_requires_offline_mode");
  expect(() => api.classifySchema032Database("postgresql://db:db@127.0.0.1:55435/tron_watch_prod", false))
    .toThrow("schema_032_database_name_not_allowed");
  expect(() => api.classifySchema032Database("postgresql://db:db@127.0.0.1:55999/tron_watch", true))
    .toThrow("schema_032_production_offline_forbidden");
  expect(() => api.assertSchema032OfflineEnvironment("PLAN5_SCHEMA_DATABASE_URL", {
    PLAN5_SCHEMA_DATABASE_URL: "postgresql://db:db@127.0.0.1:55435/tron_watch_plan5_clone",
    TELEGRAM_BOT_TOKEN: "secret"
  })).toThrow("schema_032_offline_runtime_environment_forbidden");
  expect(() => api.assertSchema032OfflineEnvironment("DATABASE_URL", {
    DATABASE_URL: "postgresql://db:db@127.0.0.1:55435/tron_watch_plan5_clone"
  })).toThrow("schema_032_offline_database_url_env_forbidden");
  expect(() => api.assertSchema032OfflineEnvironment("PLAN5_SCHEMA_DATABASE_URL", {
    PLAN5_SCHEMA_DATABASE_URL: "postgresql://db:db@127.0.0.1:55435/tron_watch_plan5_clone",
    RUNTIME_GIT_SHA: "a".repeat(40)
  })).toThrow("schema_032_offline_runtime_environment_forbidden");
  expect(api.assertSchema032OfflineEnvironment("PLAN5_SCHEMA_DATABASE_URL", {
    PLAN5_SCHEMA_DATABASE_URL: "postgresql://db:db@127.0.0.1:55435/tron_watch_plan5_clone",
    NODE_ENV: "test"
  })).toBeUndefined();

  const source = readFileSync("scripts/verifySchema032.ts", "utf8");
  expect(source).not.toMatch(/from\s+["'][^"']*(?:src\/index|bot|admin|telegram|tronscan|provider)/i);
});

it("builds destructive clients only from strict URL fields and rejects query fragment or timeout overrides first", async () => {
  const api = await loadApi() as any;
  const valid = api.buildSchema032ClientConfig(
    `postgresql://db:secret@127.0.0.1:55435/${CLEAN_DATABASE}`,
    true
  );
  expect(valid).toMatchObject({
    host: "127.0.0.1",
    port: 55435,
    user: "db",
    password: "secret",
    database: CLEAN_DATABASE,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 15_000
  });
  expect(valid).not.toHaveProperty("connectionString");
  let clientCreations = 0;
  const create = (databaseUrl: string) => {
    const config = api.buildSchema032ClientConfig(databaseUrl, true);
    clientCreations += 1;
    return new pg.Client(config);
  };
  for (const suffix of ["?query_timeout=0", "?host=attacker.invalid", "#sslmode=disable"]) {
    expect(() => create(`postgresql://db:secret@127.0.0.1:55435/${CLEAN_DATABASE}${suffix}`)).toThrow(
      "schema_032_database_url_overrides_forbidden"
    );
  }
  expect(clientCreations).toBe(0);
});

it("requires phase-specific migration outcome arguments before connecting", () => {
  const env = safeChildEnv(
    `postgresql://db:secret@127.0.0.1:55435/${CLEAN_DATABASE}`,
    "PLAN5_SCHEMA_DATABASE_URL"
  );
  const baseArgs = [
    "--import", "tsx", "scripts/verifySchema032.ts",
    "--database-url-env", "PLAN5_SCHEMA_DATABASE_URL",
    "--expected-endpoint", "127.0.0.1:55435",
    "--expected-system-identifier", "1234567890123456789",
    "--offline"
  ];
  const missingFirst = runNode([...baseArgs, "--phase", "first"], env);
  expect(missingFirst.status).not.toBe(0);
  expect(missingFirst.stderr).toContain("schema_032_first_migration_outcome_file_required");
  const missingSecond = runNode([
    ...baseArgs,
    "--phase", "final",
    "--first-migration-outcome-file", "first.json"
  ], env);
  expect(missingSecond.status).not.toBe(0);
  expect(missingSecond.stderr).toContain("schema_032_second_migration_outcome_file_required");
});

it("binds migration outcomes to the exact release target and controlled command result", async () => {
  const api = await loadApi() as any;
  const target = migrationTarget();
  const build = (sequence: "first" | "second", status: "applied" | "already_verified") =>
    api.buildSchema032MigrationOutcomeArtifact({
      ...target,
      sequence,
      commandId: "db_migrate",
      redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
      migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: APPROVED_CHECKSUM,
      spawnResult: { status: 0, stdout: migrationOutput(status), stderr: "", signal: null }
    });
  const first = build("first", "applied");
  const second = build("second", "already_verified");
  expect(api.parseSchema032MigrationOutcomeArtifact(first, { ...target, sequence: "first" }))
    .toEqual({ status: "applied", checksumSha256: APPROVED_CHECKSUM });
  expect(api.parseSchema032MigrationOutcomeArtifact(second, { ...target, sequence: "second" }))
    .toEqual({ status: "already_verified", checksumSha256: APPROVED_CHECKSUM });

  for (const [field, value] of Object.entries({
    candidateSha: "f".repeat(40),
    databaseRole: "production_clone",
    databaseName: CLONE_DATABASE,
    databaseEndpoint: "127.0.0.1:55436",
    databaseSystemIdentifierSha256: "e".repeat(64),
    databaseFingerprintSha256: "f".repeat(64),
    sequence: "second",
    commandId: "schema_verify",
    redactedTemplateSha256: "a".repeat(64),
    exitCode: 1,
    migrationFilename: "031_address_poisoning_monitor.sql",
    checksumSha256: "b".repeat(64),
    stdout: migrationOutput("already_verified")
  })) {
    const invalid = JSON.parse(first);
    invalid[field] = value;
    expect(() => api.parseSchema032MigrationOutcomeArtifact(JSON.stringify(invalid), {
      ...target,
      sequence: "first"
    }), field).toThrow();
  }
  const invalidSecond = JSON.parse(second);
  invalidSecond.databaseFingerprintSha256 = "f".repeat(64);
  expect(() => api.parseSchema032MigrationOutcomeArtifact(JSON.stringify(invalidSecond), {
    ...target,
    sequence: "second"
  })).toThrow("schema_032_migration_databaseFingerprintSha256_mismatch");
  expect(() => build("first", "already_verified")).not.toThrow();
  expect(() => build("second", "applied")).toThrow("schema_032_second_migration_not_already_verified");
  expect(() => api.buildSchema032MigrationOutcomeArtifact({
    ...target,
    sequence: "first",
    commandId: "db_migrate",
    redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksumSha256: APPROVED_CHECKSUM,
    spawnResult: { status: 1, stdout: migrationOutput("applied"), stderr: "failed", signal: null }
  })).toThrow("schema_032_migration_command_failed");
  expect(() => api.buildSchema032MigrationOutcomeArtifact({
    ...target,
    sequence: "first",
    commandId: "db_migrate",
    redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksumSha256: APPROVED_CHECKSUM,
    spawnResult: {
      status: 0,
      stdout: "Migration applied: migrations/031_address_poisoning_monitor.sql\n",
      stderr: "",
      signal: null
    }
  })).toThrow("schema_032_migration_outcome_output_mismatch");
});

it("requires the explicit normalized endpoint and closes a bounded client after partial connect failure", async () => {
  const api = await loadApi() as any;
  let receivedConfig: Record<string, unknown> | undefined;
  let ended = false;
  const target = migrationTarget({
    candidateSha: "c".repeat(40),
    databaseEndpoint: "127.0.0.1:54329"
  });
  const firstMigrationOutcome = api.buildSchema032MigrationOutcomeArtifact({
    ...target,
    sequence: "first",
    commandId: "db_migrate",
    redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksumSha256: APPROVED_CHECKSUM,
    spawnResult: { status: 0, stdout: migrationOutput("applied"), stderr: "", signal: null }
  });
  const secondMigrationOutcome = api.buildSchema032MigrationOutcomeArtifact({
    ...target,
    sequence: "second",
    commandId: "db_migrate",
    redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    checksumSha256: APPROVED_CHECKSUM,
    spawnResult: { status: 0, stdout: migrationOutput("already_verified"), stderr: "", signal: null }
  });
  await expect(api.verifySchema032Release({
    databaseUrl: "postgresql://db:db@127.0.0.1:54329/tron_watch_plan5_clean",
    offline: true,
    candidateSha: "c".repeat(40),
    expectedEndpoint: "127.0.0.1:54329",
    expectedSystemIdentifier: "1234567890123456789",
    firstMigrationOutcome,
    secondMigrationOutcome,
    clientFactory: (config: Record<string, unknown>) => {
      receivedConfig = config;
      return {
        connect: async () => { throw new Error("simulated_partial_connect"); },
        query: async () => ({ rows: [] }),
        end: async () => { ended = true; }
      };
    }
  })).rejects.toThrow("simulated_partial_connect");
  expect(receivedConfig).toMatchObject({
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 15_000
  });
  expect(ended).toBe(true);
  await expect(api.verifySchema032Release({
    databaseUrl: "postgresql://db:db@127.0.0.1:54329/tron_watch_plan5_clean",
    offline: true,
    candidateSha: "c".repeat(40),
    expectedEndpoint: "localhost:54329",
    expectedSystemIdentifier: "1234567890123456789",
    firstMigrationOutcome,
    secondMigrationOutcome,
    clientFactory: () => { throw new Error("client_must_not_be_created"); }
  })).rejects.toThrow("schema_032_database_endpoint_mismatch");
});

const postgresDescribe = cleanUrl && cloneUrl && sanitizedUrl && expectedEndpoint && expectedSystemIdentifier
  ? describe
  : describe.skip;
if (required && (!cleanUrl || !cloneUrl || !sanitizedUrl || !expectedEndpoint || !expectedSystemIdentifier)) {
  throw new Error("Plan 5 PostgreSQL acceptance requires three database URLs, endpoint and cluster identifier");
}
if (required && (
  databaseName(cleanUrl!) !== CLEAN_DATABASE ||
  databaseName(cloneUrl!) !== CLONE_DATABASE ||
  databaseName(sanitizedUrl!) !== SANITIZED_DATABASE
)) {
  throw new Error("Plan 5 PostgreSQL acceptance requires exact disposable database names");
}

postgresDescribe("schema 032 release PostgreSQL acceptance", () => {
  let cleanClient: pg.Client;
  let cloneClient: pg.Client;
  let sanitizedClient: pg.Client;

  beforeAll(async () => {
    [cleanClient, cloneClient, sanitizedClient] = await Promise.all([
      destructiveTestClient(cleanUrl!),
      destructiveTestClient(cloneUrl!),
      destructiveTestClient(sanitizedUrl!)
    ]);
    await Promise.all([cleanClient.connect(), cloneClient.connect(), sanitizedClient.connect()]);
    await resetPublicSchema({
      client: cleanClient,
      databaseUrl: cleanUrl!,
      expectedDatabase: CLEAN_DATABASE,
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
    await resetPublicSchema({
      client: cloneClient,
      databaseUrl: cloneUrl!,
      expectedDatabase: CLONE_DATABASE,
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
    await resetPublicSchema({
      client: sanitizedClient,
      databaseUrl: sanitizedUrl!,
      expectedDatabase: SANITIZED_DATABASE,
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
  }, 120_000);

  afterAll(async () => {
    const cleanup = await Promise.allSettled([
      cleanClient?.end(),
      cloneClient?.end(),
      sanitizedClient?.end()
    ].filter((value): value is Promise<void> => value !== undefined));
    const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "plan5_client_cleanup_failed");
  });

  it("connects, migrates clean legacy state, runs the npm schema verifier entry point and repeats as a no-op", async () => {
    await rehearseLegacy31ToSchema032({
      client: cleanClient,
      databaseUrl: cleanUrl!,
      databaseRole: "clean",
      fixturePrefix: "synthetic-plan5-clean",
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!,
      verifyViaNpm: true
    });
  }, 120_000);

  it("rehearses the synthetic offline clone from legacy 31 through verified schema 032 and no-op", async () => {
    await rehearseLegacy31ToSchema032({
      client: cloneClient,
      databaseUrl: cloneUrl!,
      databaseRole: "production_clone",
      fixturePrefix: "synthetic-plan5-clone",
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
  }, 120_000);

  it("does not migrate the synthetic runtime-sanitized database when verification fails", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "schema032-release-empty-"));
    const firstArtifactPath = join(artifactDir, "first-migration-outcome.json");
    const secondArtifactPath = join(artifactDir, "second-migration-outcome.json");
    try {
      const api = await loadApi() as any;
      const identity = await sanitizedClient.query(`select current_database() as database_name,
        current_setting('server_version_num') as server_version_num,
        (select oid::text from pg_database where datname = current_database()) as database_oid,
        (pg_control_system()).system_identifier::text as system_identifier`);
      const target = {
        candidateSha: CURRENT_CANDIDATE_SHA,
        databaseRole: "runtime_sanitized",
        databaseName: SANITIZED_DATABASE,
        databaseEndpoint: expectedEndpoint!,
        databaseSystemIdentifierSha256: sha256(expectedSystemIdentifier!),
        databaseFingerprintSha256: api.buildSchema032DatabaseFingerprint({
          databaseEndpoint: expectedEndpoint!,
          systemIdentifier: expectedSystemIdentifier!,
          databaseName: identity.rows[0].database_name,
          databaseOid: String(identity.rows[0].database_oid),
          serverVersion: String(identity.rows[0].server_version_num)
        })
      };
      writeFileSync(firstArtifactPath, api.buildSchema032MigrationOutcomeArtifact({
        ...target,
        sequence: "first",
        commandId: "db_migrate",
        redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
        migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
        checksumSha256: APPROVED_CHECKSUM,
        spawnResult: { status: 0, stdout: migrationOutput("applied"), stderr: "", signal: null }
      }), { encoding: "utf8", flag: "wx" });
      writeFileSync(secondArtifactPath, api.buildSchema032MigrationOutcomeArtifact({
        ...target,
        sequence: "second",
        commandId: "db_migrate",
        redactedTemplateSha256: api.SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
        migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
        checksumSha256: APPROVED_CHECKSUM,
        spawnResult: { status: 0, stdout: migrationOutput("already_verified"), stderr: "", signal: null }
      }), { encoding: "utf8", flag: "wx" });
      const verification = runNode([
        "--import", "tsx", "scripts/verifySchema032.ts",
        "--database-url-env", "PLAN5_SCHEMA_DATABASE_URL",
        "--expected-endpoint", expectedEndpoint!,
        "--expected-system-identifier", expectedSystemIdentifier!,
        "--first-migration-outcome-file", firstArtifactPath,
        "--second-migration-outcome-file", secondArtifactPath,
        "--offline"
      ], safeChildEnv(sanitizedUrl!, "PLAN5_SCHEMA_DATABASE_URL"));
      expect(verification.status).not.toBe(0);
      expect(verification.stderr).toContain("schema_032_receipt_missing");
      expect(verification.stderr).not.toContain(sanitizedUrl!);
      expect(verification.stderr).not.toContain(expectedSystemIdentifier!);
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
    const receiptTable = await sanitizedClient.query("select to_regclass('public.schema_migration_receipts') as receipt_table");
    expect(receiptTable.rows).toEqual([{ receipt_table: null }]);
  });
});
