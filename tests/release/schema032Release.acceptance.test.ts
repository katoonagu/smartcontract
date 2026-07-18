import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { queryControlledRuntimeStateFromClient } from "../../scripts/rehearseRemediationRuntime";
import {
  CANDIDATE_SHA,
  POSTCONDITIONS_SHA256,
  TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
  buildReleaseManifest,
  buildSchema032ReleaseEvidence,
  buildTask0BReleaseFreezeEvidence,
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
const postgresContainer = process.env.PLAN5_SCHEMA_POSTGRES_CONTAINER;
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

async function loadProducer(): Promise<any> {
  const modulePath: string = "../../scripts/runSchema032ReleaseSequence";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch (error) {
    throw new Error("Plan 5 feature missing: controlled schema 032 release producer", { cause: error });
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
    ...(process.env.npm_execpath === undefined ? [] : [["npm_execpath", process.env.npm_execpath]]),
    ["NODE_ENV", "test"],
    ["SCHEMA_032_TEST_ALLOW_DIRTY", "1"],
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
  databaseRole: "clean" | "production_clone" | "runtime_sanitized";
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

async function rehearseLegacy31ThroughProducer(options: {
  client: pg.Client;
  databaseUrl: string;
  databaseRole: "clean" | "production_clone";
  fixturePrefix: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
}): Promise<void> {
  const { client, databaseUrl, databaseRole, fixturePrefix, expectedEndpoint, expectedSystemIdentifier } = options;
  for (const filename of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (Number.parseInt(filename.slice(0, 3), 10) >= 32) continue;
    await client.query(readFileSync(resolve("migrations", filename), "utf8"));
  }
  await client.query("insert into telegram_users (telegram_user_id) values ($1)", [`${fixturePrefix}-user`]);
  await client.query(`insert into watched_wallets (id, telegram_user_id, address)
    values ($1, $2, 'TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD')`, [
    `${fixturePrefix}-wallet`, `${fixturePrefix}-user`
  ]);
  await client.query(`insert into wallet_approvals (
    watched_wallet_id, token_contract, spender_address, amount_raw, is_unlimited,
    current_allowance_raw, status, last_approval_tx_hash, last_approval_at
  ) values (
    $1, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    'TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK', '99', true, '99', 'active',
    $2, '2026-07-12T11:55:00.000Z'
  )`, [`${fixturePrefix}-wallet`, `${fixturePrefix}-approval`]);

  const artifactRoot = mkdtempSync(join(tmpdir(), `schema032-producer-${databaseRole}-`));
  const envName = databaseRole === "clean"
    ? "PLAN5_SCHEMA_CLEAN_DATABASE_URL"
    : "PLAN5_SCHEMA_CLONE_DATABASE_URL";
  const run = () => runNode([
    "--import", "tsx", "scripts/runSchema032ReleaseSequence.ts",
    "--database-url-env", envName,
    "--expected-endpoint", expectedEndpoint,
    "--expected-system-identifier", expectedSystemIdentifier,
    "--artifact-root", artifactRoot,
    "--offline"
  ], safeChildEnv(databaseUrl, envName));
  try {
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).not.toContain(databaseUrl);
    expect(first.stdout).not.toContain(expectedSystemIdentifier);
    const evidence = JSON.parse(first.stdout.trim());
    expect(evidence).toMatchObject({
      candidateSha: CURRENT_CANDIDATE_SHA,
      databaseRole,
      candidateBytesChecksumSha256: APPROVED_CHECKSUM,
      receiptChecksumSha256: APPROVED_CHECKSUM,
      firstApply: "applied",
      secondApply: "already_verified"
    });
    const artifactNames = readdirSync(artifactRoot).sort();
    expect(artifactNames).toEqual([
      "schema032-first-migration-outcome.json",
      "schema032-first-verification-evidence.json",
      "schema032-release-evidence.json",
      "schema032-second-migration-outcome.json"
    ]);
    const before = Object.fromEntries(artifactNames.map((name) => [
      name,
      sha256(readFileSync(join(artifactRoot, name), "utf8"))
    ]));
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout.trim())).toEqual(evidence);
    expect(Object.fromEntries(artifactNames.map((name) => [
      name,
      sha256(readFileSync(join(artifactRoot, name), "utf8"))
    ]))).toEqual(before);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
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

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] allows only an explicit bound target and the fixed migration command", async () => {
  const producer = await loadProducer();
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  expect(packageJson.scripts["schema:release:sequence"]).toBe(
    "node --import tsx scripts/runSchema032ReleaseSequence.ts"
  );
  expect(() => producer.parseSchema032ReleaseSequenceArgs([
    "--database-url-env", "PLAN5_SCHEMA_CLEAN_DATABASE_URL",
    "--expected-endpoint", "127.0.0.1:55435",
    "--expected-system-identifier", "1234567890123456789",
    "--artifact-root", resolve("artifacts/schema032"),
    "--offline",
    "--command", "node attacker.js"
  ], {})).toThrow("schema_032_sequence_cli_argument_invalid");
  expect(() => producer.validateSchema032ReleaseSequenceTarget({
    databaseUrlEnvName: "PLAN5_SCHEMA_CLEAN_DATABASE_URL",
    databaseUrl: "postgresql://db:secret@db.example/tron_watch_plan5_clean",
    expectedEndpoint: "db.example:5432",
    expectedSystemIdentifier: "1234567890123456789",
    artifactRoot: resolve("artifacts/schema032"),
    offline: true,
    candidateSha: "c".repeat(40)
  })).toThrow("schema_032_sequence_loopback_required");
  expect(() => producer.validateSchema032ReleaseSequenceTarget({
    databaseUrlEnvName: "PLAN5_SCHEMA_CLONE_DATABASE_URL",
    databaseUrl: "postgresql://db:secret@127.0.0.1:55435/tron_watch_plan5_clean",
    expectedEndpoint: "127.0.0.1:55435",
    expectedSystemIdentifier: "1234567890123456789",
    artifactRoot: resolve("artifacts/schema032"),
    offline: true,
    candidateSha: "c".repeat(40)
  })).toThrow("schema_032_sequence_database_env_role_mismatch");
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] resumes an exact partial sequence and a completed rerun is a verified no-op", async () => {
  const producer = await loadProducer();
  const artifactRoot = mkdtempSync(join(tmpdir(), "schema032-producer-resume-"));
  const target = migrationTarget({ candidateSha: "c".repeat(40) });
  let migrationCalls = 0;
  let verificationCalls = 0;
  const runMigration = async (sequence: "first" | "second") => {
    migrationCalls += 1;
    return {
      status: 0,
      stdout: migrationOutput(sequence === "first" ? "applied" : "already_verified"),
      stderr: "",
      signal: null
    };
  };
  const evidence = (phase: "first" | "final") => phase === "first" ? {
    version: "schema-032-first-phase-evidence-v1",
    phase: "first",
    candidateSha: target.candidateSha,
    databaseRole: target.databaseRole,
    databaseFingerprintSha256: target.databaseFingerprintSha256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    candidateBytesChecksumSha256: APPROVED_CHECKSUM,
    receiptChecksumSha256: APPROVED_CHECKSUM,
    shortChecksum: APPROVED_CHECKSUM.slice(0, 12),
    postconditionsSha256: "e".repeat(64),
    firstApply: "applied"
  } : {
    candidateSha: target.candidateSha,
    databaseRole: target.databaseRole,
    databaseFingerprintSha256: target.databaseFingerprintSha256,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    candidateBytesChecksumSha256: APPROVED_CHECKSUM,
    receiptChecksumSha256: APPROVED_CHECKSUM,
    shortChecksum: APPROVED_CHECKSUM.slice(0, 12),
    postconditionsSha256: "e".repeat(64),
    firstApply: "applied",
    secondApply: "already_verified"
  };
  try {
    await expect(producer.executeSchema032ReleaseSequence({
      artifactRoot,
      target,
      runMigration,
      verifyPhase: async () => {
        verificationCalls += 1;
        throw new Error("simulated_crash_after_first_migration");
      }
    })).rejects.toThrow("simulated_crash_after_first_migration");
    expect(readdirSync(artifactRoot)).toEqual(["schema032-first-migration-outcome.json"]);
    expect(migrationCalls).toBe(1);

    const completed = await producer.executeSchema032ReleaseSequence({
      artifactRoot,
      target,
      runMigration,
      verifyPhase: async (phase: "first" | "final") => {
        verificationCalls += 1;
        return evidence(phase);
      }
    });
    expect(completed.secondApply).toBe("already_verified");
    expect(migrationCalls).toBe(2);
    expect(readdirSync(artifactRoot).sort()).toEqual([
      "schema032-first-migration-outcome.json",
      "schema032-first-verification-evidence.json",
      "schema032-release-evidence.json",
      "schema032-second-migration-outcome.json"
    ]);

    const migrationCallsBeforeNoop = migrationCalls;
    const noOp = await producer.executeSchema032ReleaseSequence({
      artifactRoot,
      target,
      runMigration,
      verifyPhase: async (phase: "first" | "final") => {
        verificationCalls += 1;
        return evidence(phase);
      }
    });
    expect(noOp).toEqual(completed);
    expect(migrationCalls).toBe(migrationCallsBeforeNoop);
    expect(verificationCalls).toBeGreaterThan(1);
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] rejects unsafe output secrets and impossible partial states without forging evidence", async () => {
  const producer = await loadProducer();
  const target = migrationTarget({ candidateSha: "c".repeat(40) });
  const unsafeRoot = mkdtempSync(join(tmpdir(), "schema032-producer-unsafe-"));
  const partialRoot = mkdtempSync(join(tmpdir(), "schema032-producer-partial-"));
  try {
    await expect(producer.executeSchema032ReleaseSequence({
      artifactRoot: unsafeRoot,
      target,
      runMigration: async () => ({
        status: 0,
        stdout: "DATABASE_URL=postgresql://admin:secret@127.0.0.1/tron_watch\n",
        stderr: "",
        signal: null
      }),
      verifyPhase: async () => { throw new Error("verification_must_not_run"); }
    })).rejects.toThrow("schema_032_migration_outcome_output");
    expect(readdirSync(unsafeRoot)).toEqual([]);

    writeFileSync(join(partialRoot, "schema032-second-migration-outcome.json"), "{}", { flag: "wx" });
    await expect(producer.executeSchema032ReleaseSequence({
      artifactRoot: partialRoot,
      target,
      runMigration: async () => { throw new Error("migration_must_not_run"); },
      verifyPhase: async () => { throw new Error("verification_must_not_run"); }
    })).rejects.toThrow("schema_032_sequence_partial_state_invalid");
    expect(existsSync(join(partialRoot, "schema032-release-evidence.json"))).toBe(false);
  } finally {
    rmSync(unsafeRoot, { recursive: true, force: true });
    rmSync(partialRoot, { recursive: true, force: true });
  }
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] rejects dirty or mismatched candidate state and any unexpected migration output", async () => {
  const producer = await loadProducer();
  const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
  expect(() => producer.validateSchema032CandidateRepositoryState({
    candidateSha: "c".repeat(40),
    headSha: "c".repeat(40),
    status: "",
    migrationFiles: files
  })).not.toThrow();
  for (const invalid of [
    { headSha: "d".repeat(40) },
    { status: " M scripts/migrate.ts" },
    { migrationFiles: [...files, "033_future.sql"] }
  ]) {
    expect(() => producer.validateSchema032CandidateRepositoryState({
      candidateSha: "c".repeat(40), headSha: "c".repeat(40), status: "", migrationFiles: files, ...invalid
    })).toThrow("schema_032_sequence_candidate_repository_unverified");
  }
  const exactLines = files.map((name) => name.startsWith("032_")
    ? `Migration applied and verified: migrations/${name} (schema 32 ${APPROVED_CHECKSUM.slice(0, 12)})`
    : `Migration applied: migrations/${name}`);
  expect(() => producer.validateControlledMigrationOutput(`${exactLines.join("\n")}\n`, files, "first"))
    .not.toThrow();
  const invalidOutputs = [
    `${exactLines.join("\n")}\nMigration applied: migrations/033_future.sql\n`,
    `${exactLines.join("\n")}\n${exactLines.at(-1)}\n`,
    `\u001b[31m${exactLines.join("\n")}\u001b[0m\n`,
    `${exactLines.slice(1).join("\n")}\n`,
    `${exactLines.join("\n")}\0`
  ];
  for (const output of invalidOutputs) {
    expect(() => producer.validateControlledMigrationOutput(output, files, "first"))
      .toThrow("schema_032_sequence_migration_output_invalid");
  }
  expect(() => producer.validateControlledMigrationOutput(`${exactLines.join("\n")}\n`, files, "second"))
    .toThrow("schema_032_sequence_migration_output_invalid");
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] requires fresh one-shot production GO plus ready gates Task0B and backup evidence", async () => {
  const producer = await loadProducer();
  const evaluatedAt = "2026-07-18T09:05:00.000Z";
  const task0b = buildTask0BReleaseFreezeEvidence({ candidateSha: CANDIDATE_SHA });
  const currentManifest = cloneFixture(buildReleaseManifest("ready_for_release"));
  currentManifest.overall = "not_ready";
  const backupGate = currentManifest.gates.find((gate) => gate.id === "G12_PRODUCTION_BACKUP");
  if (!backupGate) throw new Error("missing G12 fixture");
  backupGate.state = "passed";
  const backup = {
    version: "production-backup-evidence-v1",
    candidateSha: CANDIDATE_SHA,
    gateId: "G12_PRODUCTION_BACKUP",
    commandId: "production_backup",
    redactedTemplateSha256: producer.SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256,
    databaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
    backupFilename: "production-backup.dump",
    backupBytes: 12,
    backupSha256: "b".repeat(64),
    backupPathFingerprintSha256: "c".repeat(64),
    restoreListFilename: "production-backup-restore-list.txt",
    restoreListBytes: 34,
    restoreListSha256: "d".repeat(64),
    restoreListEntryCount: 1,
    state: "passed"
  };
  const task0bBytes = Buffer.from(JSON.stringify(task0b));
  const manifestBytes = Buffer.from(JSON.stringify(currentManifest));
  const backupBytes = Buffer.from(JSON.stringify(backup));
  const authority = {
    version: "schema-032-production-authority-v1",
    scope: "schema_032_production_migration",
    source: "operator_protected_one_shot_production_go",
    generationId: "schema-migration-generation-0001",
    commandId: "production_migration",
    commandTemplateSha256: producer.SCHEMA_032_PRODUCTION_MIGRATION_TEMPLATE_SHA256,
    issuedAt: "2026-07-18T09:04:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z",
    candidateSha: CANDIDATE_SHA,
    databaseRole: "production",
    databaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
    task0bEvidenceSha256: sha256(task0bBytes.toString("utf8")),
    releaseManifestPath: "release-manifest.json",
    releaseManifestSha256: sha256(manifestBytes.toString("utf8")),
    releaseManifestOverall: "not_ready",
    backupEvidencePath: "production-backup-evidence.json",
    backupEvidenceSha256: sha256(backupBytes.toString("utf8")),
    explicitGo: true
  };
  expect(() => producer.validateSchema032ProductionAuthorization({
    authority,
    task0bBytes,
    manifestBytes,
    backupBytes,
    candidateSha: CANDIDATE_SHA,
    observedDatabaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
    evaluatedAt
  })).not.toThrow();
  const invalidInputs = [
    { authority: { ...authority, expiresAt: "2026-07-18T09:04:59.000Z" } },
    { authority: { ...authority, candidateSha: "f".repeat(40) } },
    { authority: { ...authority, backupEvidenceSha256: "f".repeat(64) } },
    { backupBytes: Buffer.from(JSON.stringify({ ...backup, state: "failed" })) },
    { observedDatabaseIdentityFingerprintSha256: "f".repeat(64) },
    { manifestBytes: Buffer.from(JSON.stringify({
      ...currentManifest,
      gates: currentManifest.gates.map((gate) => gate.id === "G00_BASE" ? { ...gate, state: "failed", exitCode: 1 } : gate)
    })) }
  ];
  for (const invalid of invalidInputs) {
    expect(() => producer.validateSchema032ProductionAuthorization({
      authority,
      task0bBytes,
      manifestBytes,
      backupBytes,
      candidateSha: CANDIDATE_SHA,
      observedDatabaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
      evaluatedAt,
      ...invalid
    })).toThrow(/schema_032_sequence_production|release phase/u);
  }
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] verifies the protected backup bytes restore list and no-follow paths before production authorization", async () => {
  const producer = await loadProducer();
  const root = mkdtempSync(join(tmpdir(), "schema032-backup-proof-"));
  const dumpPath = join(root, "production-backup.dump");
  const listPath = join(root, "production-backup-restore-list.txt");
  const dump = Buffer.from("PGDMP\0fixture", "utf8");
  const restoreList = Buffer.from("; archive\n1; 0 0 TABLE public x tron\n", "utf8");
  const evidence = {
    backupFilename: "production-backup.dump",
    backupBytes: dump.length,
    backupSha256: createHash("sha256").update(dump).digest("hex"),
    backupPathFingerprintSha256: producer.schema032BackupPathFingerprint(root, "production-backup.dump"),
    restoreListFilename: "production-backup-restore-list.txt",
    restoreListBytes: restoreList.length,
    restoreListSha256: createHash("sha256").update(restoreList).digest("hex"),
    restoreListEntryCount: 1
  };
  try {
    await expect(producer.attestSchema032ProductionBackupFiles(root, evidence)).rejects.toThrow(
      "schema_032_sequence_production_backup_file_unverified"
    );
    writeFileSync(dumpPath, dump, { flag: "wx" });
    writeFileSync(listPath, restoreList, { flag: "wx" });
    await expect(producer.attestSchema032ProductionBackupFiles(root, evidence)).rejects.toThrow(
      "schema_032_sequence_production_backup_file_unverified"
    );
    writeFileSync(dumpPath, Buffer.from("tampered"));
    await expect(producer.attestSchema032ProductionBackupFiles(root, evidence)).rejects.toThrow(
      "schema_032_sequence_production_backup_file_unverified"
    );
    rmSync(dumpPath);
    writeFileSync(dumpPath, Buffer.alloc(0), { flag: "wx" });
    await expect(producer.attestSchema032ProductionBackupFiles(root, evidence)).rejects.toThrow(
      "schema_032_sequence_production_backup_file_unverified"
    );
    rmSync(dumpPath);
    const outside = join(tmpdir(), `schema032-outside-${Date.now()}.dump`);
    writeFileSync(outside, dump, { flag: "wx" });
    try {
      symlinkSync(outside, dumpPath, "file");
      await expect(producer.attestSchema032ProductionBackupFiles(root, evidence)).rejects.toThrow(
        "schema_032_sequence_production_backup_file_unverified"
      );
    } finally { rmSync(outside, { force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] resumes the exact bounded production claim even before the first outcome exists", async () => {
  const producer = await loadProducer();
  const expected = {
    generationId: "schema-migration-generation-0001",
    authoritySha256: "a".repeat(64),
    candidateSha: "c".repeat(40),
    databaseIdentityFingerprintSha256: "d".repeat(64),
    resumeExpiresAt: "2026-07-18T09:10:00.000Z"
  };
  const existing = {
    version: "schema-032-production-authority-consumption-v1",
    generationId: expected.generationId,
    authoritySha256: expected.authoritySha256,
    candidateSha: expected.candidateSha,
    databaseIdentityFingerprintSha256: expected.databaseIdentityFingerprintSha256,
    claimedAt: "2026-07-18T09:05:00.000Z",
    resumeExpiresAt: expected.resumeExpiresAt
  };
  expect(() => producer.validateSchema032ProductionConsumptionState(
    existing, expected, "2026-07-18T09:06:00.000Z"
  )).not.toThrow();
  expect(() => producer.validateSchema032ProductionConsumptionState(
    existing, { ...expected, candidateSha: "f".repeat(40) }, "2026-07-18T09:06:00.000Z"
  )).toThrow("schema_032_sequence_production_consumption_mismatch");
  expect(() => producer.validateSchema032ProductionConsumptionState(
    existing, expected, "2026-07-18T09:10:00.001Z"
  )).toThrow("schema_032_sequence_production_consumption_expired");
});

it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] binds database user session role and owner into the migration child identity", async () => {
  const producer = await loadProducer();
  const identity = {
    databaseEndpoint: "127.0.0.1:5432",
    databaseName: "tron_watch_plan5_clean",
    databaseOid: "16384",
    serverVersion: "160014",
    systemIdentifier: "1234567890123456789",
    currentUser: "tron",
    sessionUser: "tron",
    currentRole: "tron",
    databaseOwner: "tron"
  };
  expect(producer.buildSchema032MigrationSessionIdentitySha256(identity)).toMatch(/^[0-9a-f]{64}$/u);
  expect(() => producer.buildSchema032MigrationSessionIdentitySha256({ ...identity, currentRole: "foreign" }))
    .toThrow("schema_032_sequence_database_role_unverified");
});

const postgresDescribe = cleanUrl && cloneUrl && sanitizedUrl && expectedEndpoint && expectedSystemIdentifier
  ? describe
  : describe.skip;
if (required && (!cleanUrl || !cloneUrl || !sanitizedUrl || !expectedEndpoint || !expectedSystemIdentifier || !postgresContainer)) {
  throw new Error("Plan 5 PostgreSQL acceptance requires three database URLs, endpoint, cluster identifier and container");
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

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] proves the exact custom archive with the attested pg_restore tool", async () => {
    const producer = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "schema032-real-backup-proof-"));
    const docker = process.platform === "win32"
      ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe"
      : "/usr/bin/docker";
    try {
      const imageId = execFileSync(docker, ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"], {
        encoding: "utf8"
      }).trim();
      const dump = execFileSync(docker, [
        "exec", postgresContainer!, "pg_dump", "-U", "postgres", "-Fc", "--no-owner", "--no-acl", "-d", CLEAN_DATABASE
      ], { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 });
      const dumpPath = join(root, "production-backup.dump");
      writeFileSync(dumpPath, dump, { flag: "wx" });
      const executableIdentitySha256 = execFileSync(docker, [
        "run", "--rm", "--network", "none", "--pull", "never", "--entrypoint", "/usr/bin/sha256sum",
        imageId, "/usr/local/bin/pg_restore"
      ], { encoding: "utf8" }).trim().split(/\s+/u)[0]!;
      const rawList = execFileSync(docker, [
        "run", "--rm", "--network", "none", "--pull", "never",
        "--mount", `type=bind,source=${root},target=/artifacts,readonly`,
        "--entrypoint", "/usr/local/bin/pg_restore", imageId,
        "--list", "/artifacts/production-backup.dump"
      ], { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 });
      const restoreList = Buffer.from(`${rawList.toString("utf8").replace(/\r\n/gu, "\n").trimEnd()}\n`, "utf8");
      writeFileSync(join(root, "production-backup-restore-list.txt"), restoreList, { flag: "wx" });
      const evidence = {
        backupFilename: "production-backup.dump" as const,
        backupBytes: dump.length,
        backupSha256: createHash("sha256").update(dump).digest("hex"),
        backupPathFingerprintSha256: producer.schema032BackupPathFingerprint(root, "production-backup.dump"),
        restoreListFilename: "production-backup-restore-list.txt" as const,
        restoreListBytes: restoreList.length,
        restoreListSha256: createHash("sha256").update(restoreList).digest("hex"),
        restoreListEntryCount: restoreList.toString("utf8").split("\n")
          .filter((line) => line.trim() !== "" && !line.startsWith(";")).length
      };
      const tools = {
        provider: {
          kind: "docker_pinned_image" as const,
          immutableImageId: imageId,
          networkMode: "none" as const,
          pullAllowed: false as const
        },
        pgRestore: {
          executableIdentitySha256,
          commandId: "postgres_tool_pg_restore_attest" as const
        }
      };
      await expect(producer.attestSchema032ProductionBackupFiles(root, evidence, tools)).resolves.toEqual(evidence);
      process.env.SCHEMA_032_TEST_BACKUP_ATTEST_HOLD_MS = "1000";
      try {
        const mutationAttempt = producer.attestSchema032ProductionBackupFiles(root, evidence, tools);
        for (let index = 0; index < 200
          && !readdirSync(root).some((name) => name.startsWith(".schema032-backup-attested-")); index += 1) {
          await new Promise((resolveDone) => setTimeout(resolveDone, 25));
        }
        expect(readdirSync(root).some((name) => name.startsWith(".schema032-backup-attested-"))).toBe(true);
        const transient = Buffer.from(dump);
        transient[Math.min(10, transient.length - 1)] ^= 0xff;
        writeFileSync(dumpPath, transient);
        writeFileSync(dumpPath, dump);
        await expect(mutationAttempt).rejects.toThrow("schema_032_sequence_production_backup_file_unverified");
      } finally { delete process.env.SCHEMA_032_TEST_BACKUP_ATTEST_HOLD_MS; }
      writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.from("; forged\n1; fake\n"));
      await expect(producer.attestSchema032ProductionBackupFiles(root, evidence, tools)).rejects.toThrow(
        "schema_032_sequence_production_backup_file_unverified"
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] rejects a migration child whose database session identity is not bound", () => {
    const attempt = runNpmScript("db:migrate", {
      ...safeChildEnv(cleanUrl!, "DATABASE_URL"),
      SCHEMA_032_RELEASE_EXPECTED_SESSION_IDENTITY_SHA256: "f".repeat(64),
      SCHEMA_032_RELEASE_EXPECTED_ENDPOINT: expectedEndpoint!
    });
    expect(attempt.status).not.toBe(0);
    expect(attempt.stdout).toBe("");
    expect(attempt.stderr).toContain("schema_032_sequence_migration_child_identity_mismatch");
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] executes and resumes the controlled sequence on the clean database", async () => {
    await resetPublicSchema({
      client: cleanClient,
      databaseUrl: cleanUrl!,
      expectedDatabase: CLEAN_DATABASE,
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
    await rehearseLegacy31ThroughProducer({
      client: cleanClient,
      databaseUrl: cleanUrl!,
      databaseRole: "clean",
      fixturePrefix: "synthetic-plan5-producer-clean",
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] executes and resumes the controlled sequence on the offline clone", async () => {
    await resetPublicSchema({
      client: cloneClient,
      databaseUrl: cloneUrl!,
      expectedDatabase: CLONE_DATABASE,
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
    await rehearseLegacy31ThroughProducer({
      client: cloneClient,
      databaseUrl: cloneUrl!,
      databaseRole: "production_clone",
      fixturePrefix: "synthetic-plan5-producer-clone",
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] rejects a second writer while the dedicated advisory lock is held", async () => {
    const producer = await loadProducer();
    const artifactRoot = mkdtempSync(join(tmpdir(), "schema032-producer-lock-"));
    await cleanClient.query("select pg_advisory_lock($1)", [producer.SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
    try {
      const attempt = runNode([
        "--import", "tsx", "scripts/runSchema032ReleaseSequence.ts",
        "--database-url-env", "PLAN5_SCHEMA_CLEAN_DATABASE_URL",
        "--expected-endpoint", expectedEndpoint!,
        "--expected-system-identifier", expectedSystemIdentifier!,
        "--artifact-root", artifactRoot,
        "--offline"
      ], safeChildEnv(cleanUrl!, "PLAN5_SCHEMA_CLEAN_DATABASE_URL"));
      expect(attempt.status).not.toBe(0);
      expect(attempt.stderr).toContain("schema_032_sequence_already_running");
      expect(readdirSync(artifactRoot)).toEqual([]);
    } finally {
      await cleanClient.query("select pg_advisory_unlock($1)", [producer.SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] kills and awaits a timed-out migration child tree before releasing the lock", async () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "schema032-producer-timeout-"));
    const fakeNpmRoot = mkdtempSync(join(tmpdir(), "schema032-fake-npm-"));
    const fakeNpmCli = join(fakeNpmRoot, "npm-cli.js");
    const descendantPidPath = join(fakeNpmRoot, "descendant.pid");
    writeFileSync(fakeNpmCli, `const { spawn } = require("node:child_process");\n`
      + `const { writeFileSync } = require("node:fs");\n`
      + `const { join } = require("node:path");\n`
      + `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });\n`
      + `writeFileSync(join(__dirname, "descendant.pid"), String(child.pid));\n`
      + `setInterval(() => {}, 1000);\n`, "utf8");
    try {
      const attempt = spawn(process.execPath, [
        "--import", "tsx", "scripts/runSchema032ReleaseSequence.ts",
        "--database-url-env", "PLAN5_SCHEMA_CLONE_DATABASE_URL",
        "--expected-endpoint", expectedEndpoint!,
        "--expected-system-identifier", expectedSystemIdentifier!,
        "--artifact-root", artifactRoot,
        "--offline"
      ], {
        cwd: process.cwd(),
        env: {
          ...safeChildEnv(cloneUrl!, "PLAN5_SCHEMA_CLONE_DATABASE_URL"),
          SCHEMA_032_TEST_NPM_CLI: fakeNpmCli,
          SCHEMA_032_TEST_ALLOW_FAKE_NPM_CLI: "1",
          SCHEMA_032_TEST_MIGRATION_TIMEOUT_MS: "250",
          SCHEMA_032_TEST_CLEANUP_HOLD_MS: "1000"
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stderr = "";
      attempt.stderr.setEncoding("utf8");
      attempt.stderr.on("data", (chunk: string) => { stderr += chunk; });
      const closed = new Promise<number | null>((resolveClosed) => {
        attempt.once("close", (code) => resolveClosed(code));
      });
      for (let index = 0; index < 100 && !existsSync(descendantPidPath); index += 1) {
        await new Promise((resolveDone) => setTimeout(resolveDone, 25));
      }
      expect(existsSync(descendantPidPath)).toBe(true);
      const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
      let alive = true;
      for (let index = 0; index < 100 && alive; index += 1) {
        try { process.kill(descendantPid, 0); } catch { alive = false; }
        if (alive) await new Promise((resolveDone) => setTimeout(resolveDone, 25));
      }
      expect(alive).toBe(false);
      expect(attempt.exitCode).toBeNull();
      const lockDuringCleanup = await cloneClient.query("select pg_try_advisory_lock($1) as acquired", [
        (await loadProducer()).SCHEMA_032_PRODUCER_ADVISORY_LOCK
      ]);
      expect(lockDuringCleanup.rows).toEqual([{ acquired: false }]);
      const exitCode = await closed;
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("schema_032_migration_command_failed");
      expect(readdirSync(artifactRoot)).toEqual([]);
      const lockAfterCleanup = await cloneClient.query("select pg_try_advisory_lock($1) as acquired", [
        (await loadProducer()).SCHEMA_032_PRODUCER_ADVISORY_LOCK
      ]);
      expect(lockAfterCleanup.rows).toEqual([{ acquired: true }]);
      await cloneClient.query("select pg_advisory_unlock($1)", [(await loadProducer()).SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(fakeNpmRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] kills an orphan descendant after the migration parent exits before releasing the lock", async () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "schema032-producer-exited-parent-"));
    const fakeNpmRoot = mkdtempSync(join(tmpdir(), "schema032-exited-parent-npm-"));
    const fakeNpmCli = join(fakeNpmRoot, "npm-cli.js");
    const descendantPidPath = join(fakeNpmRoot, "descendant.pid");
    writeFileSync(fakeNpmCli, `const { spawn } = require("node:child_process");\n`
      + `const { writeFileSync } = require("node:fs");\n`
      + `const { join } = require("node:path");\n`
      + `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });\n`
      + `writeFileSync(join(__dirname, "descendant.pid"), String(child.pid));\n`
      + `process.stdout.write("invalid migration output\\n");\n`
      + `setTimeout(() => process.exit(0), 25);\n`, "utf8");
    try {
      const attempt = spawn(process.execPath, [
        "--import", "tsx", "scripts/runSchema032ReleaseSequence.ts",
        "--database-url-env", "PLAN5_SCHEMA_CLONE_DATABASE_URL",
        "--expected-endpoint", expectedEndpoint!,
        "--expected-system-identifier", expectedSystemIdentifier!,
        "--artifact-root", artifactRoot,
        "--offline"
      ], {
        cwd: process.cwd(),
        env: {
          ...safeChildEnv(cloneUrl!, "PLAN5_SCHEMA_CLONE_DATABASE_URL"),
          SCHEMA_032_TEST_NPM_CLI: fakeNpmCli,
          SCHEMA_032_TEST_ALLOW_FAKE_NPM_CLI: "1",
          SCHEMA_032_TEST_MIGRATION_TIMEOUT_MS: "10000",
          SCHEMA_032_TEST_CLEANUP_HOLD_MS: "1000"
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stderr = "";
      attempt.stderr.setEncoding("utf8");
      attempt.stderr.on("data", (chunk: string) => { stderr += chunk; });
      const closed = new Promise<number | null>((resolveClosed) => {
        attempt.once("close", (code) => resolveClosed(code));
      });
      for (let index = 0; index < 100 && !existsSync(descendantPidPath); index += 1) {
        await new Promise((resolveDone) => setTimeout(resolveDone, 25));
      }
      expect(existsSync(descendantPidPath)).toBe(true);
      const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
      let alive = true;
      for (let index = 0; index < 100 && alive; index += 1) {
        try { process.kill(descendantPid, 0); } catch { alive = false; }
        if (alive) await new Promise((resolveDone) => setTimeout(resolveDone, 25));
      }
      expect(alive).toBe(false);
      expect(attempt.exitCode).toBeNull();
      const lockDuringCleanup = await cloneClient.query("select pg_try_advisory_lock($1) as acquired", [
        (await loadProducer()).SCHEMA_032_PRODUCER_ADVISORY_LOCK
      ]);
      expect(lockDuringCleanup.rows).toEqual([{ acquired: false }]);
      expect(await closed).not.toBe(0);
      expect(stderr).toContain("schema_032_migration_command_failed");
      const lockAfterCleanup = await cloneClient.query("select pg_try_advisory_lock($1) as acquired", [
        (await loadProducer()).SCHEMA_032_PRODUCER_ADVISORY_LOCK
      ]);
      expect(lockAfterCleanup.rows).toEqual([{ acquired: true }]);
      await cloneClient.query("select pg_advisory_unlock($1)", [(await loadProducer()).SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(fakeNpmRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("[REQ-38][SCHEMA-032-RELEASE-PRODUCER] ignores an arbitrary npm_execpath outside the explicit offline test seam", async () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), "schema032-producer-npm-attest-"));
    const fakeNpmRoot = mkdtempSync(join(tmpdir(), "schema032-untrusted-npm-"));
    const fakeNpmCli = join(fakeNpmRoot, "npm-cli.js");
    const marker = join(fakeNpmRoot, "untrusted-executed");
    writeFileSync(fakeNpmCli, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "yes");\n`, "utf8");
    try {
      const attempt = runNode([
        "--import", "tsx", "scripts/runSchema032ReleaseSequence.ts",
        "--database-url-env", "PLAN5_SCHEMA_CLONE_DATABASE_URL",
        "--expected-endpoint", expectedEndpoint!,
        "--expected-system-identifier", expectedSystemIdentifier!,
        "--artifact-root", artifactRoot,
        "--offline"
      ], {
        ...safeChildEnv(cloneUrl!, "PLAN5_SCHEMA_CLONE_DATABASE_URL"),
        npm_execpath: fakeNpmCli,
        SCHEMA_032_TEST_MIGRATION_TIMEOUT_MS: "10000"
      });
      expect(attempt.status, attempt.stderr).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(readdirSync(artifactRoot).sort()).toEqual([
        "schema032-first-migration-outcome.json",
        "schema032-first-verification-evidence.json",
        "schema032-release-evidence.json",
        "schema032-second-migration-outcome.json"
      ]);
    } finally {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(fakeNpmRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("[REQ-38][SCHEMA-032-PRODUCER-VERIFIER-ONLY] does not migrate the synthetic runtime-sanitized database when verification fails", async () => {
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

  it("fails the controlled runtime mirror proof when an authoritative allowance and its legacy mirror disagree", async () => {
    await rehearseLegacy31ToSchema032({
      client: sanitizedClient,
      databaseUrl: sanitizedUrl!,
      databaseRole: "runtime_sanitized",
      fixturePrefix: "synthetic-plan5-sanitized",
      expectedEndpoint: expectedEndpoint!,
      expectedSystemIdentifier: expectedSystemIdentifier!
    });
    const binding = {
      candidateSha: CURRENT_CANDIDATE_SHA,
      cutoff: "2026-07-18T00:00:00.000Z",
      cutoffSource: "task0b_release_freeze" as const,
      task0bEvidenceSha256: "a".repeat(64),
      databaseRole: "runtime_sanitized" as const,
      databaseName: SANITIZED_DATABASE as "tron_watch_plan5_runtime_sanitized",
      databaseFingerprintSha256: "b".repeat(64)
    };
    const emptyMismatchSha256 = sha256("[]");
    const valid = await queryControlledRuntimeStateFromClient(sanitizedClient, binding);
    expect(valid.allowanceMirrorMismatchCount).toBe(0);
    expect(valid.allowanceMirrorMismatchSha256).toBe(emptyMismatchSha256);

    await sanitizedClient.query("begin");
    try {
      await sanitizedClient.query(
        "alter table wallet_approvals drop constraint wallet_approvals_allowance_shape_v2_check"
      );
      const changed = await sanitizedClient.query(`update wallet_approvals
        set current_allowance_raw = case when current_allowance_raw = '0' then '1' else '0' end,
          is_unlimited = not is_unlimited,
          status = case when status = 'active' then 'unknown' else 'active' end
        where (watched_wallet_id, token_contract, spender_address) = (
          select watched_wallet_id, token_contract, spender_address
          from wallet_approvals
          order by watched_wallet_id, token_contract, spender_address
          limit 1
        )`);
      expect(changed.rowCount).toBe(1);
      const invalid = await queryControlledRuntimeStateFromClient(sanitizedClient, binding);
      expect(invalid.allowanceMirrorMismatchCount).toBe(1);
      expect(invalid.allowanceMirrorMismatchSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(invalid.allowanceMirrorMismatchSha256).not.toBe(emptyMismatchSha256);
    } finally {
      await sanitizedClient.query("rollback");
    }

    const restored = await queryControlledRuntimeStateFromClient(sanitizedClient, binding);
    expect(restored.allowanceMirrorMismatchCount).toBe(0);
    expect(restored.allowanceMirrorMismatchSha256).toBe(emptyMismatchSha256);
  }, 120_000);
});
