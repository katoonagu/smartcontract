import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  assertNoSecretLikeArtifactValues,
  validateRemediationReleaseManifest,
  validateTask0BReleaseFreezeEvidence
} from "../src/release/remediationReleaseManifest";
import {
  buildTask0BProductionDatabaseIdentityFingerprint,
  inspectRealDirectory,
  readProtectedRegularFile
} from "./captureTask0BPreflight";
import {
  APPROVED_SCHEMA_032_CHECKSUM,
  SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
  buildSchema032ClientConfig,
  buildSchema032DatabaseFingerprint,
  buildSchema032MigrationOutcomeArtifact,
  classifySchema032Database,
  parseSchema032MigrationOutcomeArtifact,
  validateSchema032ReleaseEvidence,
  verifySchema032Release,
  assertSchema032OfflineEnvironment,
  type Schema032FirstPhaseEvidenceV1,
  type Schema032MigrationTargetBinding,
  type Schema032ReleaseEvidenceV1
} from "./verifySchema032";
import { REQUIRED_SCHEMA_FILENAME, checksumMigrationBytes } from "../src/storage/schemaMigrations";
import {
  buildSchema032MigrationSessionIdentitySha256,
  observeSchema032MigrationSessionIdentity,
  type Schema032MigrationSessionIdentity
} from "../src/release/schema032MigrationIdentity";
import {
  validateSchema032ProductionExecutionReceiptV2,
  type Schema032ProductionExecutionReceiptV2
} from "../src/release/remediationReleaseManifestV2";

export { buildSchema032MigrationSessionIdentitySha256 } from "../src/release/schema032MigrationIdentity";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SYSTEM_IDENTIFIER = /^[0-9]{10,30}$/u;
const SAFE_ENV_NAME = /^[A-Z][A-Z0-9_]*$/u;
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 1024 * 1024;
const MAX_BACKUP_BYTES = 1024 ** 4;
const MAX_RESTORE_LIST_BYTES = 100 * 1024 * 1024;
const MIGRATION_TIMEOUT_MS = 120_000;
export const SCHEMA_032_PRODUCER_ADVISORY_LOCK = 320_032_500;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const SCHEMA_032_SEQUENCE_FILES = Object.freeze({
  firstMigration: "schema032-first-migration-outcome.json",
  firstVerification: "schema032-first-verification-evidence.json",
  secondMigration: "schema032-second-migration-outcome.json",
  finalEvidence: "schema032-release-evidence.json"
});

const ROLE_ENV: Readonly<Record<string, string>> = {
  clean: "PLAN5_SCHEMA_CLEAN_DATABASE_URL",
  production_clone: "PLAN5_SCHEMA_CLONE_DATABASE_URL",
  runtime_sanitized: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL",
  production: "TASK0B_PRODUCTION_DATABASE_URL"
};

type MigrationSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals | null;
  error?: Error;
};

export type Schema032ReleaseSequenceTarget = Schema032MigrationTargetBinding;

export type Schema032SequenceCliOptions = {
  databaseUrlEnvName: string;
  databaseUrl: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
  artifactRoot: string;
  offline: boolean;
  candidateSha: string;
  productionAuthorityFile?: string;
};

type SequenceState = {
  firstMigration: string | null;
  firstVerification: string | null;
  secondMigration: string | null;
  finalEvidence: string | null;
};

type ProductionMigrationAuthorityV1 = {
  version: "schema-032-production-authority-v1";
  scope: "schema_032_production_migration";
  source: "operator_protected_one_shot_production_go";
  generationId: string;
  commandId: "production_migration";
  commandTemplateSha256: string;
  issuedAt: string;
  expiresAt: string;
  candidateSha: string;
  databaseRole: "production";
  databaseIdentityFingerprintSha256: string;
  task0bEvidenceSha256: string;
  releaseManifestPath: "release-manifest.json";
  releaseManifestSha256: string;
  releaseManifestOverall: "not_ready";
  backupEvidencePath: "production-backup-evidence.json";
  backupEvidenceSha256: string;
  explicitGo: true;
};

type ProductionBackupEvidenceV1 = {
  version: "production-backup-evidence-v1";
  candidateSha: string;
  gateId: "G12_PRODUCTION_BACKUP";
  commandId: "production_backup";
  redactedTemplateSha256: string;
  databaseIdentityFingerprintSha256: string;
  backupFilename: "production-backup.dump";
  backupBytes: number;
  backupSha256: string;
  backupPathFingerprintSha256: string;
  restoreListFilename: "production-backup-restore-list.txt";
  restoreListBytes: number;
  restoreListSha256: string;
  restoreListEntryCount: number;
  state: "passed";
};

type ProductionAuthorityConsumptionV1 = {
  version: "schema-032-production-authority-consumption-v1";
  generationId: string;
  authoritySha256: string;
  candidateSha: string;
  databaseIdentityFingerprintSha256: string;
  claimedAt: string;
  resumeExpiresAt: string;
};

export const SCHEMA_032_PRODUCTION_MIGRATION_TEMPLATE_SHA256 = REMEDIATION_COMMAND_TEMPLATE_SHA256.production_migration;
export const SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256 = REMEDIATION_COMMAND_TEMPLATE_SHA256.production_backup;
const PRODUCTION_BACKUP_FILENAME = "production-backup.dump";
const PRODUCTION_RESTORE_LIST_FILENAME = "production-backup-restore-list.txt";

function fail(code: string): never {
  throw new Error(code);
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPathKey(path: string): string {
  const normalized = resolve(path).replace(/\\/gu, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function schema032BackupPathFingerprint(root: string, filename: string): string {
  if (!isAbsolute(root) || ![PRODUCTION_BACKUP_FILENAME, PRODUCTION_RESTORE_LIST_FILENAME].includes(filename)) {
    fail("schema_032_sequence_production_backup_file_unverified");
  }
  return hash(canonicalPathKey(join(root, filename)));
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}

function parseIso(value: unknown, code: string): Date {
  if (typeof value !== "string") fail(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(code);
  return parsed;
}

function normalizedEndpoint(databaseUrl: string): { endpoint: string; hostname: string; port: number; databaseName: string } {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { fail("schema_032_sequence_database_url_invalid"); }
  if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || parsed.search || parsed.hash) {
    fail("schema_032_sequence_database_url_invalid");
  }
  const port = Number.parseInt(parsed.port || "5432", 10);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || !databaseName || databaseName.includes("/")) {
    fail("schema_032_sequence_database_url_invalid");
  }
  return {
    endpoint: `${parsed.hostname.toLowerCase()}:${port}`,
    hostname: parsed.hostname.toLowerCase(),
    port,
    databaseName
  };
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function validateSchema032ReleaseSequenceTarget(
  options: Schema032SequenceCliOptions
): Schema032SequenceCliOptions & { databaseRole: Schema032ReleaseSequenceTarget["databaseRole"]; databaseName: string } {
  if (!SAFE_ENV_NAME.test(options.databaseUrlEnvName)) fail("schema_032_sequence_database_url_env_invalid");
  if (!SHA40.test(options.candidateSha)) fail("schema_032_sequence_candidate_sha_invalid");
  if (!SYSTEM_IDENTIFIER.test(options.expectedSystemIdentifier)) fail("schema_032_sequence_system_identifier_invalid");
  if (!isAbsolute(options.artifactRoot)) fail("schema_032_sequence_artifact_root_invalid");
  const observed = normalizedEndpoint(options.databaseUrl);
  if (!isLoopback(observed.hostname)) fail("schema_032_sequence_loopback_required");
  if (observed.endpoint !== options.expectedEndpoint) fail("schema_032_sequence_database_endpoint_mismatch");
  const classified = classifySchema032Database(options.databaseUrl, options.offline);
  if (ROLE_ENV[classified.databaseRole] !== options.databaseUrlEnvName) {
    fail("schema_032_sequence_database_env_role_mismatch");
  }
  if (classified.databaseRole === "production" && options.productionAuthorityFile === undefined) {
    fail("schema_032_sequence_production_authority_required");
  }
  if (classified.databaseRole !== "production" && options.productionAuthorityFile !== undefined) {
    fail("schema_032_sequence_production_authority_forbidden");
  }
  return { ...options, databaseRole: classified.databaseRole, databaseName: classified.databaseName };
}

export function parseSchema032ReleaseSequenceArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
  candidateSha = env.SCHEMA_032_CANDIDATE_SHA ?? "0".repeat(40)
): Schema032SequenceCliOptions {
  let databaseUrlEnvName: string | undefined;
  let expectedEndpoint: string | undefined;
  let expectedSystemIdentifier: string | undefined;
  let artifactRoot: string | undefined;
  let productionAuthorityFile: string | undefined;
  let offline = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--offline") { offline = true; continue; }
    const value = argv[index + 1];
    if (!value) fail("schema_032_sequence_cli_argument_invalid");
    if (arg === "--database-url-env" && databaseUrlEnvName === undefined) databaseUrlEnvName = value;
    else if (arg === "--expected-endpoint" && expectedEndpoint === undefined) expectedEndpoint = value;
    else if (arg === "--expected-system-identifier" && expectedSystemIdentifier === undefined) expectedSystemIdentifier = value;
    else if (arg === "--artifact-root" && artifactRoot === undefined) artifactRoot = value;
    else if (arg === "--production-authority-file" && productionAuthorityFile === undefined) productionAuthorityFile = value;
    else fail("schema_032_sequence_cli_argument_invalid");
    index += 1;
  }
  if (!databaseUrlEnvName || !expectedEndpoint || !expectedSystemIdentifier || !artifactRoot) {
    fail("schema_032_sequence_required_argument_missing");
  }
  const databaseUrl = env[databaseUrlEnvName];
  if (!databaseUrl) fail("schema_032_sequence_database_url_missing");
  return {
    databaseUrlEnvName,
    databaseUrl,
    expectedEndpoint,
    expectedSystemIdentifier,
    artifactRoot: resolve(artifactRoot),
    offline,
    candidateSha,
    productionAuthorityFile
  };
}

export function validateSchema032CandidateRepositoryState(input: {
  candidateSha: string;
  headSha: string;
  status: string;
  migrationFiles: string[];
}): void {
  const sorted = [...input.migrationFiles].sort();
  const validNames = sorted.every((name) => /^\d{3}_[A-Za-z0-9_.-]+\.sql$/u.test(name));
  const versions = sorted.map((name) => Number.parseInt(name.slice(0, 3), 10));
  if (!SHA40.test(input.candidateSha) || input.headSha !== input.candidateSha || input.status !== ""
      || !validNames || sorted.join("|") !== input.migrationFiles.join("|")
      || sorted.filter((name) => name === REQUIRED_SCHEMA_FILENAME).length !== 1
      || Math.max(...versions) !== 32 || versions.some((version) => version > 32)
      || sorted.at(-1) !== REQUIRED_SCHEMA_FILENAME) {
    fail("schema_032_sequence_candidate_repository_unverified");
  }
}

export function validateControlledMigrationOutput(
  stdout: string,
  migrationFiles: string[],
  sequence: "first" | "second"
): void {
  if (!stdout || stdout.includes("\0") || Buffer.byteLength(stdout, "utf8") > MAX_CHILD_OUTPUT_BYTES) {
    fail("schema_032_sequence_migration_output_invalid");
  }
  const lines = stdout.endsWith("\n") ? stdout.slice(0, -1).split(/\r?\n/u) : [];
  const expected = migrationFiles.map((name) => {
    if (name !== REQUIRED_SCHEMA_FILENAME) return `Migration applied: migrations/${name}`;
    const action = sequence === "first" ? "applied and verified" : "already verified";
    return `Migration ${action}: migrations/${name} (schema 32 ${APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)})`;
  });
  const firstAlreadyVerified = `Migration already verified: migrations/${REQUIRED_SCHEMA_FILENAME} (schema 32 ${APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)})`;
  if (lines.length !== expected.length || lines.some((line, index) => (
    sequence === "first" && index === expected.length - 1
      ? line !== expected[index] && line !== firstAlreadyVerified
      : line !== expected[index]
  ))) {
    fail("schema_032_sequence_migration_output_invalid");
  }
}

async function attestArtifactRoot(path: string, production: boolean): Promise<string> {
  if (!isAbsolute(path)) fail("schema_032_sequence_artifact_root_invalid");
  if (production) return inspectRealDirectory(path, true);
  const metadata = await lstat(path).catch(() => fail("schema_032_sequence_artifact_root_invalid"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("schema_032_sequence_artifact_root_invalid");
  const physical = resolve(await realpath(path));
  if (physical.toLowerCase() !== resolve(path).toLowerCase()) fail("schema_032_sequence_artifact_root_invalid");
  return physical;
}

async function readOptionalArtifact(root: string, filename: string): Promise<string | null> {
  const path = join(root, filename);
  let metadata;
  try { metadata = await lstat(path); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_ARTIFACT_BYTES) {
    fail("schema_032_sequence_artifact_invalid");
  }
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      fail("schema_032_sequence_artifact_changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      fail("schema_032_sequence_artifact_changed");
    }
    return bytes.toString("utf8");
  } finally { await handle.close(); }
}

async function writeArtifactExclusive(root: string, filename: string, value: unknown): Promise<string> {
  assertNoSecretLikeArtifactValues(value);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length <= 1 || bytes.length > MAX_ARTIFACT_BYTES) fail("schema_032_sequence_artifact_invalid");
  if (!/^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._/-]+$/u.test(filename)) {
    fail("schema_032_sequence_artifact_path_invalid");
  }
  const finalPath = resolve(root, filename);
  const fromRoot = relative(root, finalPath);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    fail("schema_032_sequence_artifact_path_invalid");
  }
  await mkdir(dirname(finalPath), { recursive: true });
  const tempPath = join(dirname(finalPath), `.${basename(filename)}.${randomBytes(12).toString("hex")}.tmp`);
  const handle = await open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    await link(tempPath, finalPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
  return bytes.toString("utf8");
}

function validateFirstEvidence(
  value: unknown,
  target: Schema032ReleaseSequenceTarget,
  firstApply: "applied" | "already_verified"
): Schema032FirstPhaseEvidenceV1 {
  const evidence = record(value, "schema_032_sequence_first_evidence_invalid");
  exactKeys(evidence, [
    "version", "phase", "candidateSha", "databaseRole", "databaseFingerprintSha256", "migrationFilename",
    "candidateBytesChecksumSha256", "receiptChecksumSha256", "shortChecksum", "postconditionsSha256", "firstApply"
  ], "schema_032_sequence_first_evidence_invalid");
  if (evidence.version !== "schema-032-first-phase-evidence-v1" || evidence.phase !== "first"
      || evidence.candidateSha !== target.candidateSha || evidence.databaseRole !== target.databaseRole
      || evidence.databaseFingerprintSha256 !== target.databaseFingerprintSha256
      || evidence.migrationFilename !== REQUIRED_SCHEMA_FILENAME
      || evidence.candidateBytesChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM
      || evidence.receiptChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM
      || evidence.shortChecksum !== APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)
      || !SHA256.test(String(evidence.postconditionsSha256)) || evidence.firstApply !== firstApply) {
    fail("schema_032_sequence_first_evidence_invalid");
  }
  return evidence as Schema032FirstPhaseEvidenceV1;
}

function parseJson(value: string, code: string): unknown {
  try { return JSON.parse(value); } catch { fail(code); }
}

function assertSameEvidence(left: unknown, right: unknown, code: string): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) fail(code);
}

async function readSequenceState(root: string): Promise<SequenceState> {
  const state = {
    firstMigration: await readOptionalArtifact(root, SCHEMA_032_SEQUENCE_FILES.firstMigration),
    firstVerification: await readOptionalArtifact(root, SCHEMA_032_SEQUENCE_FILES.firstVerification),
    secondMigration: await readOptionalArtifact(root, SCHEMA_032_SEQUENCE_FILES.secondMigration),
    finalEvidence: await readOptionalArtifact(root, SCHEMA_032_SEQUENCE_FILES.finalEvidence)
  };
  const present = [state.firstMigration, state.firstVerification, state.secondMigration, state.finalEvidence]
    .map((value) => value !== null);
  const firstMissing = present.indexOf(false);
  if (firstMissing >= 0 && present.slice(firstMissing + 1).some(Boolean)) fail("schema_032_sequence_partial_state_invalid");
  return state;
}

export async function executeSchema032ReleaseSequence(input: {
  artifactRoot: string;
  target: Schema032ReleaseSequenceTarget;
  runMigration(sequence: "first" | "second"): Promise<MigrationSpawnResult>;
  verifyPhase(
    phase: "first" | "final",
    artifacts: { firstMigrationOutcome: string; secondMigrationOutcome?: string }
  ): Promise<Schema032FirstPhaseEvidenceV1 | Schema032ReleaseEvidenceV1>;
}): Promise<Schema032ReleaseEvidenceV1> {
  const root = await attestArtifactRoot(input.artifactRoot, input.target.databaseRole === "production");
  const state = await readSequenceState(root);
  let firstOutcome = state.firstMigration;
  let firstParsed: ReturnType<typeof parseSchema032MigrationOutcomeArtifact>;
  if (firstOutcome === null) {
    const result = await input.runMigration("first");
    firstOutcome = buildSchema032MigrationOutcomeArtifact({
      ...input.target,
      sequence: "first",
      commandId: "db_migrate",
      redactedTemplateSha256: SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
      migrationFilename: REQUIRED_SCHEMA_FILENAME,
      checksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
      spawnResult: result
    });
    await writeArtifactExclusive(root, SCHEMA_032_SEQUENCE_FILES.firstMigration, parseJson(firstOutcome, "schema_032_sequence_outcome_invalid"));
  }
  firstParsed = parseSchema032MigrationOutcomeArtifact(firstOutcome, { ...input.target, sequence: "first" });

  let firstEvidence = state.firstVerification;
  if (firstEvidence === null) {
    const verified = validateFirstEvidence(
      await input.verifyPhase("first", { firstMigrationOutcome: firstOutcome }),
      input.target,
      firstParsed.status
    );
    firstEvidence = await writeArtifactExclusive(root, SCHEMA_032_SEQUENCE_FILES.firstVerification, verified);
  } else {
    const persisted = validateFirstEvidence(
      parseJson(firstEvidence, "schema_032_sequence_first_evidence_invalid"),
      input.target,
      firstParsed.status
    );
    if (state.finalEvidence === null) {
      const fresh = validateFirstEvidence(
        await input.verifyPhase("first", { firstMigrationOutcome: firstOutcome }),
        input.target,
        firstParsed.status
      );
      assertSameEvidence(persisted, fresh, "schema_032_sequence_first_evidence_changed");
    }
  }

  let secondOutcome = state.secondMigration;
  if (secondOutcome === null) {
    const result = await input.runMigration("second");
    secondOutcome = buildSchema032MigrationOutcomeArtifact({
      ...input.target,
      sequence: "second",
      commandId: "db_migrate",
      redactedTemplateSha256: SCHEMA_032_DB_MIGRATE_TEMPLATE_SHA256,
      migrationFilename: REQUIRED_SCHEMA_FILENAME,
      checksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
      spawnResult: result
    });
    await writeArtifactExclusive(root, SCHEMA_032_SEQUENCE_FILES.secondMigration, parseJson(secondOutcome, "schema_032_sequence_outcome_invalid"));
  }
  parseSchema032MigrationOutcomeArtifact(secondOutcome, { ...input.target, sequence: "second" });

  const freshFinal = await input.verifyPhase("final", {
    firstMigrationOutcome: firstOutcome,
    secondMigrationOutcome: secondOutcome
  });
  const finalEvidence = validateSchema032ReleaseEvidence(freshFinal, {
    candidateSha: input.target.candidateSha,
    postconditionsSha256: String((freshFinal as Schema032ReleaseEvidenceV1).postconditionsSha256)
  });
  if (finalEvidence.databaseRole !== input.target.databaseRole
      || finalEvidence.databaseFingerprintSha256 !== input.target.databaseFingerprintSha256) {
    fail("schema_032_sequence_final_evidence_target_mismatch");
  }
  if (state.finalEvidence !== null) {
    const persistedRaw = parseJson(state.finalEvidence, "schema_032_sequence_final_evidence_invalid");
    const persisted = validateSchema032ReleaseEvidence(persistedRaw, {
      candidateSha: input.target.candidateSha,
      postconditionsSha256: String((persistedRaw as Record<string, unknown>).postconditionsSha256 ?? "")
    });
    assertSameEvidence(persisted, finalEvidence, "schema_032_sequence_final_evidence_changed");
    return persisted;
  }
  await writeArtifactExclusive(root, SCHEMA_032_SEQUENCE_FILES.finalEvidence, finalEvidence);
  return finalEvidence;
}

function safeChildEnvironment(
  databaseUrl: string,
  npmExecPath: string,
  expectedSessionIdentitySha256: string,
  expectedEndpoint: string
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: resolve("tests/fixtures/release/plan5-no-dotenv"),
    npm_execpath: npmExecPath,
    NO_COLOR: "1",
    SCHEMA_032_RELEASE_EXPECTED_SESSION_IDENTITY_SHA256: expectedSessionIdentitySha256,
    SCHEMA_032_RELEASE_EXPECTED_ENDPOINT: expectedEndpoint
  };
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "ComSpec", "COMSPEC"] as const) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return result;
}

async function terminateChildTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveDone) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.once("error", () => resolveDone());
      killer.once("close", () => resolveDone());
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

async function resolveNpmCli(allowTestOverride: boolean): Promise<string> {
  const testOverride = allowTestOverride && process.env.NODE_ENV === "test"
      && process.env.SCHEMA_032_TEST_ALLOW_FAKE_NPM_CLI === "1"
    ? process.env.SCHEMA_032_TEST_NPM_CLI
    : undefined;
  const executableDirectory = dirname(process.execPath);
  const candidates = testOverride === undefined
    ? [
        resolve(executableDirectory, "node_modules/npm/bin/npm-cli.js"),
        resolve(executableDirectory, "../lib/node_modules/npm/bin/npm-cli.js")
      ]
    : [testOverride];
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate) || basename(candidate).toLowerCase() !== "npm-cli.js") continue;
    try {
      const physical = resolve(await realpath(candidate));
      const metadata = await lstat(physical);
      if (metadata.isFile() && !metadata.isSymbolicLink() && basename(physical).toLowerCase() === "npm-cli.js") {
        return physical;
      }
    } catch { /* try the next fixed platform location */ }
  }
  fail("schema_032_sequence_npm_cli_unverified");
}

type Schema032PostgresRestoreTool = {
  provider: {
    kind: "docker_pinned_image";
    immutableImageId: string;
    networkMode: "none";
    pullAllowed: false;
  };
  pgRestore: {
    executableIdentitySha256: string;
    commandId: "postgres_tool_pg_restore_attest";
  };
};

async function resolveFixedDockerCli(): Promise<string> {
  const candidates = process.platform === "win32"
    ? ["C:/Program Files/Docker/Docker/resources/bin/docker.exe"]
    : ["/usr/bin/docker", "/usr/local/bin/docker"];
  for (const candidate of candidates) {
    try {
      const physical = resolve(await realpath(candidate));
      const metadata = await lstat(physical);
      if (metadata.isFile() && !metadata.isSymbolicLink()) return physical;
    } catch { /* only fixed platform locations are eligible */ }
  }
  fail("schema_032_sequence_production_backup_tool_unverified");
}

async function runBoundedDocker(args: string[], maxOutputBytes: number): Promise<Buffer> {
  const docker = await resolveFixedDockerCli();
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(docker, args, {
      cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: Object.fromEntries(
        ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "ComSpec", "COMSPEC"]
          .flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]])
      ),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let failed: Error | undefined;
    let termination: Promise<void> | undefined;
    const terminate = () => termination ??= terminateChildTree(child);
    const collect = (current: Buffer, chunk: Buffer) => {
      if (current.length + chunk.length > maxOutputBytes) {
        failed = new Error("schema_032_sequence_production_backup_tool_output_too_large");
        void terminate();
        return current;
      }
      return Buffer.concat([current, chunk]);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
    child.once("error", () => { failed = new Error("schema_032_sequence_production_backup_tool_failed"); });
    const timer = setTimeout(() => {
      failed = new Error("schema_032_sequence_production_backup_tool_timeout");
      void terminate();
    }, MIGRATION_TIMEOUT_MS);
    child.once("close", async (status, signal) => {
      clearTimeout(timer);
      await termination;
      if (failed || status !== 0 || signal || stderr.length !== 0) {
        rejectOutput(failed ?? new Error("schema_032_sequence_production_backup_tool_failed"));
        return;
      }
      resolveOutput(stdout);
    });
  });
}

function normalizePgRestoreList(bytes: Buffer): { bytes: Buffer; entryCount: number } {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    fail("schema_032_sequence_production_backup_file_unverified");
  }
  if (text.includes("\0") || /\r(?!\n)/u.test(text)) {
    fail("schema_032_sequence_production_backup_file_unverified");
  }
  const normalized = `${text.replace(/\r\n/gu, "\n").trimEnd()}\n`;
  const entryCount = normalized.split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith(";")).length;
  if (entryCount < 1) fail("schema_032_sequence_production_backup_file_unverified");
  return { bytes: Buffer.from(normalized, "utf8"), entryCount };
}

async function readStableFile(input: {
  path: string;
  maxBytes: number;
  capture: boolean;
}): Promise<{
  bytes: number;
  sha256: string;
  content?: Buffer;
  dev: bigint | number;
  ino: bigint | number;
  mtimeMs: number;
  ctimeMs: number;
}> {
  const before = await lstat(input.path).catch(() => fail("schema_032_sequence_production_backup_file_unverified"));
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > input.maxBytes) {
    fail("schema_032_sequence_production_backup_file_unverified");
  }
  const handle = await open(input.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      fail("schema_032_sequence_production_backup_file_unverified");
    }
    const digest = createHash("sha256");
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead <= 0) fail("schema_032_sequence_production_backup_file_unverified");
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      digest.update(chunk);
      if (input.capture) chunks.push(chunk);
      position += bytesRead;
    }
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      fail("schema_032_sequence_production_backup_file_unverified");
    }
    return {
      bytes: opened.size,
      sha256: digest.digest("hex"),
      content: input.capture ? Buffer.concat(chunks) : undefined,
      dev: opened.dev,
      ino: opened.ino,
      mtimeMs: opened.mtimeMs,
      ctimeMs: opened.ctimeMs
    };
  } finally { await handle.close(); }
}

export async function attestSchema032ProductionBackupFiles(
  root: string,
  evidence: Pick<ProductionBackupEvidenceV1,
    "backupFilename" | "backupBytes" | "backupSha256" | "backupPathFingerprintSha256"
    | "restoreListFilename" | "restoreListBytes" | "restoreListSha256" | "restoreListEntryCount">,
  tools?: Schema032PostgresRestoreTool
): Promise<typeof evidence> {
  try {
    if (evidence.backupFilename !== PRODUCTION_BACKUP_FILENAME
        || evidence.restoreListFilename !== PRODUCTION_RESTORE_LIST_FILENAME
        || !Number.isSafeInteger(evidence.backupBytes) || evidence.backupBytes <= 0
        || !Number.isSafeInteger(evidence.restoreListBytes) || evidence.restoreListBytes <= 0
        || !Number.isSafeInteger(evidence.restoreListEntryCount) || evidence.restoreListEntryCount <= 0
        || !SHA256.test(evidence.backupSha256) || !SHA256.test(evidence.restoreListSha256)
        || evidence.backupPathFingerprintSha256 !== schema032BackupPathFingerprint(root, evidence.backupFilename)) {
      fail("schema_032_sequence_production_backup_file_unverified");
    }
    const dumpPath = join(root, evidence.backupFilename);
    const listPath = join(root, evidence.restoreListFilename);
    const dump = await readStableFile({ path: dumpPath, maxBytes: MAX_BACKUP_BYTES, capture: false });
    const list = await readStableFile({ path: listPath, maxBytes: MAX_RESTORE_LIST_BYTES, capture: true });
    if (dump.bytes !== evidence.backupBytes || dump.sha256 !== evidence.backupSha256
        || list.bytes !== evidence.restoreListBytes || list.sha256 !== evidence.restoreListSha256 || !list.content) {
      fail("schema_032_sequence_production_backup_file_unverified");
    }
    const storedList = normalizePgRestoreList(list.content);
    if (!storedList.bytes.equals(list.content) || storedList.entryCount !== evidence.restoreListEntryCount) {
      fail("schema_032_sequence_production_backup_file_unverified");
    }
    if (!tools || tools.provider.kind !== "docker_pinned_image"
        || !/^sha256:[0-9a-f]{64}$/u.test(tools.provider.immutableImageId)
        || tools.provider.networkMode !== "none" || tools.provider.pullAllowed !== false
        || tools.pgRestore.commandId !== "postgres_tool_pg_restore_attest"
        || !SHA256.test(tools.pgRestore.executableIdentitySha256)) {
      fail("schema_032_sequence_production_backup_tool_unverified");
    }
    const binaryDigest = await runBoundedDocker([
      "run", "--rm", "--network", "none", "--pull", "never", "--entrypoint", "/usr/bin/sha256sum",
      tools.provider.immutableImageId, "/usr/local/bin/pg_restore"
    ], 1024);
    if (binaryDigest.toString("utf8").trim().split(/\s+/u)[0] !== tools.pgRestore.executableIdentitySha256) {
      fail("schema_032_sequence_production_backup_tool_unverified");
    }
    const linkName = `.schema032-backup-attested-${randomBytes(12).toString("hex")}.dump`;
    const linkPath = join(root, linkName);
    try {
      await link(dumpPath, linkPath);
      const linked = await lstat(linkPath);
      if (!linked.isFile() || linked.isSymbolicLink() || linked.dev !== dump.dev || linked.ino !== dump.ino
          || linked.size !== dump.bytes || linked.mtimeMs !== dump.mtimeMs) {
        fail("schema_032_sequence_production_backup_file_unverified");
      }
      const generated = normalizePgRestoreList(await runBoundedDocker([
        "run", "--rm", "--network", "none", "--pull", "never",
        "--mount", `type=bind,source=${root},target=/artifacts,readonly`,
        "--entrypoint", "/usr/local/bin/pg_restore", tools.provider.immutableImageId,
        "--list", `/artifacts/${linkName}`
      ], MAX_RESTORE_LIST_BYTES));
      if (!generated.bytes.equals(storedList.bytes) || generated.entryCount !== storedList.entryCount) {
        fail("schema_032_sequence_production_backup_file_unverified");
      }
      const testHoldMs = process.env.NODE_ENV === "test"
        ? Number(process.env.SCHEMA_032_TEST_BACKUP_ATTEST_HOLD_MS ?? 0)
        : 0;
      if (Number.isSafeInteger(testHoldMs) && testHoldMs > 0 && testHoldMs <= 5_000) {
        await new Promise((resolveDone) => setTimeout(resolveDone, testHoldMs));
      }
      const unchanged = await readStableFile({ path: dumpPath, maxBytes: MAX_BACKUP_BYTES, capture: false });
      if (unchanged.dev !== linked.dev || unchanged.ino !== linked.ino
          || unchanged.bytes !== dump.bytes || unchanged.sha256 !== dump.sha256
          || unchanged.mtimeMs !== linked.mtimeMs || unchanged.ctimeMs !== linked.ctimeMs) {
        fail("schema_032_sequence_production_backup_file_unverified");
      }
    } finally { await unlink(linkPath).catch(() => undefined); }
    return evidence;
  } catch {
    fail("schema_032_sequence_production_backup_file_unverified");
  }
}

async function runFixedMigration(
  databaseUrl: string,
  migrationFiles: string[],
  sequence: "first" | "second",
  allowTestNpmCliOverride: boolean,
  expectedSessionIdentitySha256: string,
  expectedEndpoint: string
): Promise<MigrationSpawnResult> {
  const npmCli = await resolveNpmCli(allowTestNpmCliOverride);
  const configuredTestTimeout = process.env.NODE_ENV === "test"
    ? Number(process.env.SCHEMA_032_TEST_MIGRATION_TIMEOUT_MS ?? MIGRATION_TIMEOUT_MS)
    : MIGRATION_TIMEOUT_MS;
  const timeoutMs = Number.isSafeInteger(configuredTestTimeout) && configuredTestTimeout >= 100
    ? configuredTestTimeout
    : MIGRATION_TIMEOUT_MS;
  const configuredCleanupHold = allowTestNpmCliOverride && process.env.NODE_ENV === "test"
      && process.env.SCHEMA_032_TEST_ALLOW_FAKE_NPM_CLI === "1"
    ? Number(process.env.SCHEMA_032_TEST_CLEANUP_HOLD_MS ?? 0)
    : 0;
  const cleanupHoldMs = Number.isSafeInteger(configuredCleanupHold) && configuredCleanupHold >= 0
      && configuredCleanupHold <= 5_000
    ? configuredCleanupHold
    : 0;
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [npmCli, "run", "--silent", "db:migrate"], {
      cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
      env: safeChildEnvironment(databaseUrl, npmCli, expectedSessionIdentitySha256, expectedEndpoint),
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let overflow = false;
    let termination: Promise<void> | undefined;
    const requestTermination = () => termination ??= terminateChildTree(child).then(async () => {
      if (cleanupHoldMs > 0) await new Promise((resolveDone) => setTimeout(resolveDone, cleanupHoldMs));
    });
    const collect = (current: Buffer, chunk: Buffer): Buffer => {
      if (current.length + chunk.length > MAX_CHILD_OUTPUT_BYTES) {
        overflow = true;
        void requestTermination();
        return current;
      }
      return Buffer.concat([current, chunk]);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
    let spawnError: Error | undefined;
    let timedOut = false;
    child.once("error", (error) => { spawnError = error; });
    const timer = setTimeout(() => {
      timedOut = true;
      void requestTermination();
    }, timeoutMs);
    child.once("close", async (code, signal) => {
      clearTimeout(timer);
      let decodedStdout = "";
      let decodedStderr = "";
      try {
        decodedStdout = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
        decodedStderr = new TextDecoder("utf-8", { fatal: true }).decode(stderr);
        if (!overflow && !timedOut && code === 0 && !signal && !spawnError && decodedStderr === "") {
          validateControlledMigrationOutput(decodedStdout, migrationFiles, sequence);
        }
      } catch (error) {
        spawnError = error instanceof Error ? error : new Error("schema_032_sequence_migration_output_invalid");
      }
      if (overflow || timedOut || code !== 0 || signal || spawnError || decodedStderr !== "") {
        await requestTermination();
      } else {
        await termination;
      }
      resolveResult({
        status: overflow || timedOut ? null : code,
        stdout: decodedStdout,
        stderr: decodedStderr,
        signal,
        error: overflow
          ? new Error("schema_032_sequence_migration_output_too_large")
          : timedOut
            ? new Error("schema_032_sequence_migration_timeout")
            : spawnError
      });
    });
  });
}

async function readDatabaseIdentity(client: Client, endpoint: string): Promise<{
  targetIdentity: { databaseName: string; databaseOid: string; serverVersion: string; systemIdentifier: string };
  sessionIdentity: Schema032MigrationSessionIdentity;
  sessionIdentitySha256: string;
  task0bIdentityFingerprintSha256: string;
}> {
  const observed = await observeSchema032MigrationSessionIdentity(client, endpoint);
  const row = observed.identity;
  const endpointParts = endpoint.split(":");
  const endpointPort = Number(endpointParts.at(-1));
  const endpointHost = endpointParts.slice(0, -1).join(":");
  return {
    targetIdentity: {
      databaseName: row.databaseName,
      databaseOid: row.databaseOid,
      serverVersion: row.serverVersion,
      systemIdentifier: row.systemIdentifier
    },
    sessionIdentity: row,
    sessionIdentitySha256: buildSchema032MigrationSessionIdentitySha256(row),
    task0bIdentityFingerprintSha256: buildTask0BProductionDatabaseIdentityFingerprint({
      databaseName: row.databaseName,
      endpointHost,
      endpointPort,
      connectedServerPort: observed.connectedServerPort,
      systemIdentifier: row.systemIdentifier,
      databaseOid: row.databaseOid,
      serverVersionNum: row.serverVersion
    })
  };
}

function validateProductionAuthority(value: unknown, evaluatedAt: string): ProductionMigrationAuthorityV1 {
  const authority = record(value, "schema_032_sequence_production_authority_invalid");
  exactKeys(authority, [
    "version", "scope", "source", "generationId", "commandId", "commandTemplateSha256", "issuedAt", "expiresAt",
    "candidateSha", "databaseRole", "databaseIdentityFingerprintSha256", "task0bEvidenceSha256", "releaseManifestPath",
    "releaseManifestSha256", "releaseManifestOverall", "backupEvidencePath", "backupEvidenceSha256", "explicitGo"
  ], "schema_032_sequence_production_authority_invalid");
  const now = parseIso(evaluatedAt, "schema_032_sequence_production_authority_time_invalid");
  const issuedAt = parseIso(authority.issuedAt, "schema_032_sequence_production_authority_time_invalid");
  const expiresAt = parseIso(authority.expiresAt, "schema_032_sequence_production_authority_time_invalid");
  if (authority.version !== "schema-032-production-authority-v1" || authority.scope !== "schema_032_production_migration"
      || authority.source !== "operator_protected_one_shot_production_go"
      || typeof authority.generationId !== "string" || !GENERATION.test(authority.generationId)
      || authority.commandId !== "production_migration"
      || authority.commandTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.production_migration
      || issuedAt > now || expiresAt <= now || expiresAt.getTime() - issuedAt.getTime() > 10 * 60_000
      || !SHA40.test(String(authority.candidateSha)) || authority.databaseRole !== "production"
      || !SHA256.test(String(authority.databaseIdentityFingerprintSha256))
      || !SHA256.test(String(authority.task0bEvidenceSha256))
      || authority.releaseManifestPath !== "release-manifest.json" || !SHA256.test(String(authority.releaseManifestSha256))
      || authority.releaseManifestOverall !== "not_ready"
      || authority.backupEvidencePath !== "production-backup-evidence.json"
      || !SHA256.test(String(authority.backupEvidenceSha256)) || authority.explicitGo !== true) {
    fail("schema_032_sequence_production_authority_unverified");
  }
  return authority as ProductionMigrationAuthorityV1;
}

function parseProductionBackupEvidence(value: unknown, input: {
  candidateSha: string;
  observedDatabaseIdentityFingerprintSha256: string;
}): ProductionBackupEvidenceV1 {
  const backup = record(value, "schema_032_sequence_production_backup_invalid");
  assertNoSecretLikeArtifactValues(backup);
  exactKeys(backup, [
    "version", "candidateSha", "gateId", "commandId", "redactedTemplateSha256",
    "databaseIdentityFingerprintSha256", "backupFilename", "backupBytes", "backupSha256",
    "backupPathFingerprintSha256", "restoreListFilename", "restoreListBytes", "restoreListSha256",
    "restoreListEntryCount", "state"
  ], "schema_032_sequence_production_backup_invalid");
  if (backup.version !== "production-backup-evidence-v1" || backup.candidateSha !== input.candidateSha
      || backup.gateId !== "G12_PRODUCTION_BACKUP" || backup.commandId !== "production_backup"
      || backup.redactedTemplateSha256 !== SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256
      || backup.databaseIdentityFingerprintSha256 !== input.observedDatabaseIdentityFingerprintSha256
      || backup.backupFilename !== PRODUCTION_BACKUP_FILENAME
      || !Number.isSafeInteger(backup.backupBytes) || Number(backup.backupBytes) <= 0
      || !SHA256.test(String(backup.backupSha256)) || !SHA256.test(String(backup.backupPathFingerprintSha256))
      || backup.restoreListFilename !== PRODUCTION_RESTORE_LIST_FILENAME
      || !Number.isSafeInteger(backup.restoreListBytes) || Number(backup.restoreListBytes) <= 0
      || !SHA256.test(String(backup.restoreListSha256))
      || !Number.isSafeInteger(backup.restoreListEntryCount) || Number(backup.restoreListEntryCount) <= 0
      || backup.state !== "passed") {
    fail("schema_032_sequence_production_backup_unverified");
  }
  return backup as ProductionBackupEvidenceV1;
}

export function validateSchema032ProductionAuthorization(input: {
  authority: unknown;
  task0bBytes: Buffer;
  manifestBytes: Buffer;
  backupBytes: Buffer;
  candidateSha: string;
  observedDatabaseIdentityFingerprintSha256: string;
  evaluatedAt: string;
}): ProductionMigrationAuthorityV1 {
  const authority = validateProductionAuthority(input.authority, input.evaluatedAt);
  const task0b = validateTask0BReleaseFreezeEvidence(
    parseJson(input.task0bBytes.toString("utf8"), "schema_032_sequence_task0b_invalid"),
    input.candidateSha,
    input.evaluatedAt
  );
  const manifest = validateRemediationReleaseManifest(
    parseJson(input.manifestBytes.toString("utf8"), "schema_032_sequence_manifest_invalid")
  );
  parseProductionBackupEvidence(
    parseJson(input.backupBytes.toString("utf8"), "schema_032_sequence_production_backup_invalid"),
    {
      candidateSha: input.candidateSha,
      observedDatabaseIdentityFingerprintSha256: input.observedDatabaseIdentityFingerprintSha256
    }
  );
  const gates = new Map(manifest.gates.map((gate) => [gate.id, gate.state]));
  const preReleasePassed = [...gates.entries()]
    .filter(([id]) => /^G(?:0\d|1[01])_/u.test(id))
    .every(([, state]) => state === "passed");
  if (authority.candidateSha !== input.candidateSha || authority.task0bEvidenceSha256 !== hash(input.task0bBytes)
      || authority.releaseManifestSha256 !== hash(input.manifestBytes) || authority.backupEvidenceSha256 !== hash(input.backupBytes)
      || manifest.candidateSha !== input.candidateSha || manifest.overall !== "not_ready" || !preReleasePassed
      || gates.get("G12_PRODUCTION_BACKUP") !== "passed" || gates.get("G13_PRODUCTION_MIGRATION") !== "pending"
      || gates.get("G14_PRODUCTION_ROLLOUT") !== "pending" || gates.get("G15_PRODUCTION_CANARY") !== "pending"
      || task0b.productionDatabase.approvedIdentityFingerprintSha256 !== input.observedDatabaseIdentityFingerprintSha256
      || authority.databaseIdentityFingerprintSha256 !== input.observedDatabaseIdentityFingerprintSha256) {
    fail("schema_032_sequence_production_binding_unverified");
  }
  return authority;
}

type Schema032ProductionAuthorizationInput = Omit<
  Parameters<typeof validateSchema032ProductionAuthorization>[0],
  "evaluatedAt"
>;

export async function validateSchema032ProductionClaimWindow(input: {
  authorization: Schema032ProductionAuthorizationInput;
  initialEvaluatedAt: string;
  attestBackup(): Promise<void>;
  now(): string;
}): Promise<{ authority: ProductionMigrationAuthorityV1; claimedAt: string }> {
  validateSchema032ProductionAuthorization({
    ...input.authorization,
    evaluatedAt: input.initialEvaluatedAt
  });
  await input.attestBackup();
  const claimedAt = input.now();
  const authority = validateSchema032ProductionAuthorization({
    ...input.authorization,
    evaluatedAt: claimedAt
  });
  return { authority, claimedAt };
}

export function validateSchema032ProductionConsumptionState(
  value: unknown,
  expected: Pick<ProductionAuthorityConsumptionV1,
    "generationId" | "authoritySha256" | "candidateSha" | "databaseIdentityFingerprintSha256" | "resumeExpiresAt">,
  evaluatedAt: string
): ProductionAuthorityConsumptionV1 {
  const consumption = record(value, "schema_032_sequence_production_consumption_invalid");
  exactKeys(consumption, [
    "version", "generationId", "authoritySha256", "candidateSha", "databaseIdentityFingerprintSha256",
    "claimedAt", "resumeExpiresAt"
  ], "schema_032_sequence_production_consumption_invalid");
  const now = parseIso(evaluatedAt, "schema_032_sequence_production_consumption_invalid");
  const claimedAt = parseIso(consumption.claimedAt, "schema_032_sequence_production_consumption_invalid");
  const resumeExpiresAt = parseIso(consumption.resumeExpiresAt, "schema_032_sequence_production_consumption_invalid");
  if (consumption.version !== "schema-032-production-authority-consumption-v1"
      || typeof consumption.generationId !== "string" || !GENERATION.test(consumption.generationId)
      || !SHA256.test(String(consumption.authoritySha256)) || !SHA40.test(String(consumption.candidateSha))
      || !SHA256.test(String(consumption.databaseIdentityFingerprintSha256))
      || consumption.generationId !== expected.generationId
      || consumption.authoritySha256 !== expected.authoritySha256
      || consumption.candidateSha !== expected.candidateSha
      || consumption.databaseIdentityFingerprintSha256 !== expected.databaseIdentityFingerprintSha256
      || consumption.resumeExpiresAt !== expected.resumeExpiresAt
      || claimedAt > now || claimedAt >= resumeExpiresAt) {
    fail("schema_032_sequence_production_consumption_mismatch");
  }
  if (now > resumeExpiresAt) fail("schema_032_sequence_production_consumption_expired");
  return consumption as ProductionAuthorityConsumptionV1;
}

type Schema032ProductionExecutionBindingV2 = {
  releaseFreezeIdentitySha256: string;
  operationalAttestationSha256: string;
  authorityConsumptionSha256: string;
  sourceManifestSha256: string;
  g12TransitionReceiptSha256: string;
  productionBackupEvidenceSha256: string;
};

async function authorizeProductionMutation(input: {
  artifactRoot: string;
  authorityFilename: string;
  candidateSha: string;
  observedTask0bDatabaseFingerprintSha256: string;
  hasSequenceArtifacts: boolean;
}): Promise<Schema032ProductionExecutionBindingV2> {
  if (!/^schema032-production-authority-[a-z0-9][a-z0-9-]{15,63}\.json$/u.test(input.authorityFilename)) {
    fail("schema_032_sequence_production_authority_filename_invalid");
  }
  const initialEvaluatedAt = new Date().toISOString();
  const [authorityBytes, task0bBytes, manifestBytes, backupBytes] = await Promise.all([
    readProtectedRegularFile(input.artifactRoot, input.authorityFilename, MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(input.artifactRoot, "task0b-release-freeze.json", MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(input.artifactRoot, "release-manifest.json", MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(input.artifactRoot, "production-backup-evidence.json", MAX_ARTIFACT_BYTES)
  ]);
  const authorization: Schema032ProductionAuthorizationInput = {
    authority: parseJson(authorityBytes.toString("utf8"), "schema_032_sequence_production_authority_invalid"),
    task0bBytes,
    manifestBytes,
    backupBytes,
    candidateSha: input.candidateSha,
    observedDatabaseIdentityFingerprintSha256: input.observedTask0bDatabaseFingerprintSha256
  };
  const task0b = validateTask0BReleaseFreezeEvidence(
    parseJson(task0bBytes.toString("utf8"), "schema_032_sequence_task0b_invalid"),
    input.candidateSha,
    initialEvaluatedAt
  );
  const backup = parseProductionBackupEvidence(
    parseJson(backupBytes.toString("utf8"), "schema_032_sequence_production_backup_invalid"),
    {
      candidateSha: input.candidateSha,
      observedDatabaseIdentityFingerprintSha256: input.observedTask0bDatabaseFingerprintSha256
    }
  );
  const { authority, claimedAt } = await validateSchema032ProductionClaimWindow({
    authorization,
    initialEvaluatedAt,
    attestBackup: () => attestSchema032ProductionBackupFiles(input.artifactRoot, backup, task0b.postgresTools).then(() => undefined),
    now: () => new Date().toISOString()
  });
  if (input.authorityFilename !== `schema032-production-authority-${authority.generationId}.json`) {
    fail("schema_032_sequence_production_authority_filename_invalid");
  }
  const consumptionName = `schema032-production-authority-consumed-${authority.generationId}.json`;
  const existing = await readOptionalArtifact(input.artifactRoot, consumptionName);
  const expectedConsumption = {
    generationId: authority.generationId,
    authoritySha256: hash(authorityBytes),
    candidateSha: input.candidateSha,
    databaseIdentityFingerprintSha256: input.observedTask0bDatabaseFingerprintSha256,
    resumeExpiresAt: authority.expiresAt
  };
  const consumption: ProductionAuthorityConsumptionV1 = {
    version: "schema-032-production-authority-consumption-v1",
    generationId: expectedConsumption.generationId,
    authoritySha256: expectedConsumption.authoritySha256,
    candidateSha: expectedConsumption.candidateSha,
    databaseIdentityFingerprintSha256: expectedConsumption.databaseIdentityFingerprintSha256,
    claimedAt,
    resumeExpiresAt: expectedConsumption.resumeExpiresAt
  };
  if (existing === null) {
    if (input.hasSequenceArtifacts) fail("schema_032_sequence_unconsumed_partial_production_state");
    const validatedConsumption = validateSchema032ProductionConsumptionState(
      consumption,
      expectedConsumption,
      claimedAt
    );
    await writeArtifactExclusive(input.artifactRoot, consumptionName, validatedConsumption);
  } else {
    validateSchema032ProductionConsumptionState(
      parseJson(existing, "schema_032_sequence_production_consumption_invalid"),
      expectedConsumption,
      claimedAt
    );
  }
  const freezeBytes = await readOptionalArtifact(input.artifactRoot, "release-freeze-identity-v2.json");
  const rawManifest = parseJson(manifestBytes.toString("utf8"), "schema_032_sequence_manifest_invalid") as Record<string, unknown>;
  const consumptionBytes = Buffer.from(`${JSON.stringify(consumption)}\n`, "utf8");
  return {
    releaseFreezeIdentitySha256: freezeBytes === null ? hash(task0bBytes) : hash(Buffer.from(freezeBytes, "utf8")),
    operationalAttestationSha256: hash(authorityBytes),
    authorityConsumptionSha256: hash(consumptionBytes),
    sourceManifestSha256: hash(manifestBytes),
    g12TransitionReceiptSha256: typeof rawManifest.latestCommittedReceiptSha256 === "string"
      && SHA256.test(rawManifest.latestCommittedReceiptSha256)
      ? rawManifest.latestCommittedReceiptSha256 : hash(manifestBytes),
    productionBackupEvidenceSha256: hash(backupBytes)
  };
}

export async function persistSchema032ProductionExecutionReceiptV2(
  artifactRoot: string,
  value: unknown
): Promise<Schema032ProductionExecutionReceiptV2> {
  const receipt = validateSchema032ProductionExecutionReceiptV2(value);
  await writeArtifactExclusive(artifactRoot, "schema032-production-execution-receipt-v2.json", receipt);
  return receipt;
}

async function currentCandidateSha(): Promise<string> {
  const result = await new Promise<MigrationSpawnResult>((resolveResult) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { cwd: resolve(fileURLToPath(new URL("..", import.meta.url))), windowsHide: true });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    let error: Error | undefined;
    child.once("error", (value) => { error = value; });
    child.once("close", (status, signal) => resolveResult({ status, signal, stdout, stderr: "", error }));
  });
  const sha = result.stdout.trim();
  if (result.status !== 0 || result.error || !SHA40.test(sha)) fail("schema_032_sequence_candidate_sha_invalid");
  return sha;
}

async function observeCandidateRepositoryState(): Promise<{ headSha: string; status: string; migrationFiles: string[] }> {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const runGit = (args: string[]) => new Promise<string>((resolveOutput, rejectOutput) => {
    const child = spawn("git", args, { cwd: repositoryRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => rejectOutput(new Error("schema_032_sequence_candidate_repository_unverified")));
    child.once("close", (status) => status === 0 && stderr === ""
      ? resolveOutput(stdout.trimEnd())
      : rejectOutput(new Error("schema_032_sequence_candidate_repository_unverified")));
  });
  const [headSha, status, migrationFiles] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=all"]),
    readdir(new URL("../migrations/", import.meta.url)).then((files) => files.filter((name) => name.endsWith(".sql")).sort())
  ]);
  return { headSha, status, migrationFiles };
}

export async function runSchema032ReleaseSequence(options: Schema032SequenceCliOptions): Promise<Schema032ReleaseEvidenceV1> {
  const validated = validateSchema032ReleaseSequenceTarget(options);
  const repository = await observeCandidateRepositoryState();
  validateSchema032CandidateRepositoryState({
    candidateSha: validated.candidateSha,
    headSha: repository.headSha,
    status: validated.offline && process.env.NODE_ENV === "test" && process.env.SCHEMA_032_TEST_ALLOW_DIRTY === "1"
      ? ""
      : repository.status,
    migrationFiles: repository.migrationFiles
  });
  const migrationBytes = await readFile(new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url));
  if (await checksumMigrationBytes(migrationBytes) !== APPROVED_SCHEMA_032_CHECKSUM) {
    fail("schema_032_sequence_migration_checksum_mismatch");
  }
  const artifactRoot = await attestArtifactRoot(validated.artifactRoot, validated.databaseRole === "production");
  const client = new Client(buildSchema032ClientConfig(validated.databaseUrl, validated.offline));
  let locked = false;
  let lockAcquiredAt: string | null = null;
  let lockReleasedAt: string | null = null;
  let productionBinding: Schema032ProductionExecutionBindingV2 | null = null;
  let completedEvidence: Schema032ReleaseEvidenceV1 | null = null;
  let sessionIdentitySha256: string | null = null;
  let caughtError: unknown = null;
  try {
    await client.connect();
    const acquired = await client.query("select pg_try_advisory_lock($1) as acquired", [SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
    if (acquired.rows[0]?.acquired !== true) fail("schema_032_sequence_already_running");
    locked = true;
    lockAcquiredAt = new Date().toISOString();
    const before = await readDatabaseIdentity(client, validated.expectedEndpoint);
    sessionIdentitySha256 = before.sessionIdentitySha256;
    if (before.targetIdentity.databaseName !== validated.databaseName
        || before.targetIdentity.systemIdentifier !== validated.expectedSystemIdentifier) {
      fail("schema_032_sequence_database_identity_mismatch");
    }
    const target: Schema032ReleaseSequenceTarget = {
      candidateSha: validated.candidateSha,
      databaseRole: validated.databaseRole,
      databaseName: validated.databaseName,
      databaseEndpoint: validated.expectedEndpoint,
      databaseSystemIdentifierSha256: hash(validated.expectedSystemIdentifier),
      databaseFingerprintSha256: buildSchema032DatabaseFingerprint({
        databaseEndpoint: validated.expectedEndpoint,
        systemIdentifier: validated.expectedSystemIdentifier,
        databaseName: before.targetIdentity.databaseName,
        databaseOid: before.targetIdentity.databaseOid,
        serverVersion: before.targetIdentity.serverVersion
      })
    };
    const initialState = await readSequenceState(artifactRoot);
    if (validated.databaseRole === "production") {
      productionBinding = await authorizeProductionMutation({
        artifactRoot,
        authorityFilename: validated.productionAuthorityFile!,
        candidateSha: validated.candidateSha,
        observedTask0bDatabaseFingerprintSha256: before.task0bIdentityFingerprintSha256,
        hasSequenceArtifacts: Object.values(initialState).some((value) => value !== null)
      });
    }
    const evidence = await executeSchema032ReleaseSequence({
      artifactRoot,
      target,
      runMigration: async (sequence) => {
        const immediatelyBefore = await readDatabaseIdentity(client, validated.expectedEndpoint);
        if (JSON.stringify(immediatelyBefore) !== JSON.stringify(before)) {
          fail("schema_032_sequence_database_identity_changed");
        }
        const result = await runFixedMigration(
          validated.databaseUrl,
          repository.migrationFiles,
          sequence,
          validated.offline,
          before.sessionIdentitySha256,
          validated.expectedEndpoint
        );
        const immediatelyAfter = await readDatabaseIdentity(client, validated.expectedEndpoint);
        if (JSON.stringify(immediatelyAfter) !== JSON.stringify(before)) {
          fail("schema_032_sequence_database_identity_changed");
        }
        return result;
      },
      verifyPhase: (phase, artifacts) => verifySchema032Release({
        phase,
        databaseUrl: validated.databaseUrl,
        offline: validated.offline,
        candidateSha: validated.candidateSha,
        expectedEndpoint: validated.expectedEndpoint,
        expectedSystemIdentifier: validated.expectedSystemIdentifier,
        firstMigrationOutcome: artifacts.firstMigrationOutcome,
        secondMigrationOutcome: artifacts.secondMigrationOutcome
      })
    });
    const after = await readDatabaseIdentity(client, validated.expectedEndpoint);
    if (JSON.stringify(after) !== JSON.stringify(before)) fail("schema_032_sequence_database_identity_changed");
    completedEvidence = evidence;
  } catch (error) {
    caughtError = error;
  } finally {
    if (locked) {
      const unlocked = await client.query("select pg_advisory_unlock($1) as unlocked",
        [SCHEMA_032_PRODUCER_ADVISORY_LOCK]).catch(() => null);
      if (unlocked?.rows[0]?.unlocked !== true) fail("schema_032_sequence_advisory_unlock_failed");
      lockReleasedAt = new Date().toISOString();
    }
    await client.end().catch(() => undefined);
  }
  if (caughtError !== null) {
    if (validated.databaseRole === "production" && productionBinding !== null
        && lockAcquiredAt !== null && lockReleasedAt !== null && sessionIdentitySha256 !== null) {
      const state = await readSequenceState(artifactRoot);
      const existing = [state.firstMigration, state.firstVerification, state.secondMigration, state.finalEvidence];
      const completedCount = existing.findIndex((value) => value === null);
      const count = completedCount < 0 ? existing.length : completedCount;
      const steps = ["first_migration", "first_verification", "second_migration", "final_verification"] as const;
      const failedStep = steps[Math.min(count, steps.length - 1)]!;
      const failurePaths = {
        first_migration: "schema032-failures/first-migration-failure-v2.json",
        first_verification: "schema032-failures/first-verification-failure-v2.json",
        second_migration: "schema032-failures/second-migration-failure-v2.json",
        final_verification: "schema032-failures/final-verification-failure-v2.json"
      } as const;
      const failureCode = safeErrorCode(caughtError);
      const failureEvidenceSha256 = hash(`${failedStep}:${failureCode}`);
      const failureArtifact = { kind: "schema032_stage_failure" as const, failedStep,
        relativePath: failurePaths[failedStep], evidenceSha256: failureEvidenceSha256 };
      await writeArtifactExclusive(artifactRoot, failureArtifact.relativePath, {
        version: "schema032-stage-failure-v2", candidateSha: validated.candidateSha,
        ...failureArtifact, failureCode, observedAt: lockReleasedAt
      });
      await persistSchema032ProductionExecutionReceiptV2(artifactRoot, {
        version: "schema-032-production-execution-receipt-v2",
        candidateSha: validated.candidateSha,
        ...productionBinding,
        advisoryLockKey: SCHEMA_032_PRODUCER_ADVISORY_LOCK,
        databaseSessionIdentitySha256: sessionIdentitySha256,
        lockAcquiredAt,
        lockReleasedAt,
        migrationBytesChecksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
        result: "failed_after_attempt",
        failedStep,
        completedStages: existing.slice(0, count).map((value, index) => ({
          step: steps[index], receiptSha256: hash(Buffer.from(value!, "utf8"))
        })),
        failureArtifact
      });
    }
    throw caughtError;
  }
  if (completedEvidence === null) fail("schema_032_sequence_incomplete");
  if (validated.databaseRole === "production") {
    if (productionBinding === null || lockAcquiredAt === null || lockReleasedAt === null || sessionIdentitySha256 === null) {
      fail("schema_032_production_execution_binding_missing");
    }
    const state = await readSequenceState(artifactRoot);
    const ordered = [state.firstMigration, state.firstVerification, state.secondMigration, state.finalEvidence];
    if (ordered.some((value) => value === null)) fail("schema_032_production_execution_stage_missing");
    await persistSchema032ProductionExecutionReceiptV2(artifactRoot, {
      version: "schema-032-production-execution-receipt-v2",
      candidateSha: validated.candidateSha,
      ...productionBinding,
      advisoryLockKey: SCHEMA_032_PRODUCER_ADVISORY_LOCK,
      databaseSessionIdentitySha256: sessionIdentitySha256,
      lockAcquiredAt,
      lockReleasedAt,
      migrationBytesChecksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
      result: "applied_and_verified",
      completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
        .map((step, index) => ({ step, receiptSha256: hash(Buffer.from(ordered[index]!, "utf8")) })),
      receiptChecksumSha256: completedEvidence.receiptChecksumSha256,
      postconditionsSha256: completedEvidence.postconditionsSha256
    });
  }
  return completedEvidence;
}

async function main(): Promise<void> {
  const candidateSha = await currentCandidateSha();
  const options = parseSchema032ReleaseSequenceArgs(process.argv.slice(2), process.env, candidateSha);
  if (options.offline) assertSchema032OfflineEnvironment(options.databaseUrlEnvName, process.env);
  const evidence = await runSchema032ReleaseSequence(options);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^schema_032_[a-z0-9_:.-]+$/u.test(message)
    ? message
    : "schema_032_sequence_failed";
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && resolve(SCRIPT_PATH).toLowerCase() === invokedPath.toLowerCase()) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: safeErrorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
