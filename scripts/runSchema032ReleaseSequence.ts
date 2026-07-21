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
  readCurrentTask0BReleaseRevalidation,
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
import { REQUIRED_SCHEMA_FILENAME, REQUIRED_SCHEMA_VERSION, applyVerifiedTrackedMigration,
  checksumMigrationBytes } from "../src/storage/schemaMigrations";
import {
  buildSchema032MigrationSessionIdentitySha256,
  observeSchema032MigrationSessionIdentity,
  type Schema032MigrationSessionIdentity
} from "../src/release/schema032MigrationIdentity";
import {
  releaseFreezeIdentitySha256V2,
  validatePreparedSchema032ProductionSettlementV2,
  validateSchema032ProductionExecutionAttemptV2,
  validateProductionFailureEvidenceV2,
  validateSchema032ProductionExecutionReceiptV2,
  type ProductionFailureEvidenceV2,
  type ExecutedReleaseGateV2,
  type GateEvidenceRefV2,
  type PreparedSchema032ProductionSettlementV2,
  type Schema032ProductionExecutionAttemptV2,
  type Schema032CompletedStageV2,
  type Schema032ProductionExecutionReceiptCommonV2,
  type Schema032ProductionExecutionReceiptV2
} from "../src/release/remediationReleaseManifestV2";
import {
  selectOperationalAttestationFromStoreV2,
  verifyCurrentReleaseManifestChainV2
} from "../src/release/releaseManifestStoreV2";
import { validateGateEvidenceBytesV2 } from "../src/release/releaseGateEvidencePolicy";
import { canonicalBytesV2 } from "../src/release/releaseRootWriterStore";

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
const MAXIMUM_G13_SEQUENCE_MS = 20 * 60_000;
const G13_SETTLEMENT_MARGIN_MS = 5 * 60_000;
const MINIMUM_G13_CLAIM_VALIDITY_MS = MAXIMUM_G13_SEQUENCE_MS + G13_SETTLEMENT_MARGIN_MS;
export const SCHEMA_032_PRODUCER_ADVISORY_LOCK = 320_032_500;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const SCHEMA_032_SEQUENCE_FILES = Object.freeze({
  firstMigration: "schema032-first-migration-outcome.json",
  firstVerification: "schema032-first-verification-evidence.json",
  secondMigration: "schema032-second-migration-outcome.json",
  finalEvidence: "schema032-release-evidence.json"
});

const SCHEMA_032_FAILURE_PATHS = Object.freeze({
  first_migration: "schema032-failures/first-migration-failure-v2.json",
  first_verification: "schema032-failures/first-verification-failure-v2.json",
  second_migration: "schema032-failures/second-migration-failure-v2.json",
  final_verification: "schema032-failures/final-verification-failure-v2.json"
} as const);

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
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
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
  version: "schema-032-production-authority-consumption-v2";
  generationId: string;
  authoritySha256: string;
  operationalAttestationSha256?: string;
  operationalAttestationIssuerReceiptSha256?: string;
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

function assertSchema032StageFailureAttemptInterval(
  observedAt: unknown,
  lockAcquiredAt: string,
  lockReleasedAt?: string
): void {
  const observed = parseIso(observedAt, "schema_032_sequence_stage_failure_invalid").getTime();
  const acquired = parseIso(lockAcquiredAt, "schema_032_sequence_stage_failure_invalid").getTime();
  const released = lockReleasedAt === undefined ? null
    : parseIso(lockReleasedAt, "schema_032_sequence_stage_failure_invalid").getTime();
  if (observed < acquired || (released !== null && observed > released)) {
    fail("schema_032_sequence_stage_failure_invalid");
  }
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
    candidateSha
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

async function readRequiredArtifactBytes(root: string, filename: string): Promise<Buffer> {
  const value = await readOptionalArtifact(root, filename);
  if (value === null) fail("schema_032_sequence_artifact_missing");
  return Buffer.from(value, "utf8");
}

async function writeArtifactExclusive(root: string, filename: string, value: unknown): Promise<string> {
  assertNoSecretLikeArtifactValues(value);
  const bytes = canonicalBytesV2(value);
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

async function writeArtifactExactReplay(root: string, filename: string, value: unknown): Promise<string> {
  const expected = canonicalBytesV2(value).toString("utf8");
  const existing = await readOptionalArtifact(root, filename);
  if (existing === null) return writeArtifactExclusive(root, filename, value);
  if (existing !== expected) fail("schema_032_sequence_artifact_replay_conflict");
  return existing;
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
  if (!canonicalBytesV2(left).equals(canonicalBytesV2(right))) fail(code);
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
  validateOperation?(): Promise<void>;
  runMigration(sequence: "first" | "second"): Promise<MigrationSpawnResult>;
  verifyPhase(
    phase: "first" | "final",
    artifacts: { firstMigrationOutcome: string; secondMigrationOutcome?: string }
  ): Promise<Schema032FirstPhaseEvidenceV1 | Schema032ReleaseEvidenceV1>;
}): Promise<Schema032ReleaseEvidenceV1> {
  const root = await attestArtifactRoot(input.artifactRoot, input.target.databaseRole === "production");
  await input.validateOperation?.();
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
    await input.validateOperation?.();
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
    await input.validateOperation?.();
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
    await input.validateOperation?.();
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
  await input.validateOperation?.();
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
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
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
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
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

async function runFixedMigrationInOwnedSession(
  client: Client,
  migrationFiles: string[],
  sequence: "first" | "second"
): Promise<MigrationSpawnResult> {
  const lines: string[] = [];
  try {
    await client.query("select set_config('statement_timeout', $1, false)", [`${MIGRATION_TIMEOUT_MS}ms`]);
    let requiredSchema032Checksum: string | undefined;
    for (const migrationFile of migrationFiles) {
      const migrationPath = new URL(`../migrations/${migrationFile}`, import.meta.url);
      const versionText = /^(\d+)_/u.exec(migrationFile)?.[1];
      if (versionText === undefined) fail(`schema_032_sequence_invalid_migration_filename:${migrationFile}`);
      const version = Number.parseInt(versionText, 10);
      if (version < REQUIRED_SCHEMA_VERSION) {
        await client.query(await readFile(migrationPath, "utf8"));
        lines.push(`Migration applied: migrations/${migrationFile}`);
        continue;
      }
      const verification = await applyVerifiedTrackedMigration(client, {
        version,
        filename: migrationFile,
        migrationBytes: await readFile(migrationPath),
        requiredSchema032Checksum
      });
      if (version === REQUIRED_SCHEMA_VERSION) requiredSchema032Checksum = verification.checksumSha256;
      const action = verification.status === "applied" ? "applied and verified" : "already verified";
      lines.push(`Migration ${action}: migrations/${migrationFile} (schema ${verification.version} ${verification.shortChecksum})`);
    }
    const stdout = `${lines.join("\n")}\n`;
    validateControlledMigrationOutput(stdout, migrationFiles, sequence);
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: 1, stdout: `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, stderr: "", error: error as Error };
  } finally {
    await client.query("select set_config('statement_timeout', '0', false)").catch(() => undefined);
  }
}

async function readDatabaseIdentity(client: Client, endpoint: string): Promise<{
  targetIdentity: { databaseName: string; databaseOid: string; serverVersion: string; systemIdentifier: string };
  sessionIdentity: Schema032MigrationSessionIdentity;
  sessionIdentitySha256: string;
  sessionInstanceIdentitySha256: string;
  task0bIdentityFingerprintSha256: string;
}> {
  const observed = await observeSchema032MigrationSessionIdentity(client, endpoint);
  const row = observed.identity;
  const backend = await client.query(`select pg_backend_pid()::text as "backendPid", backend_start as "backendStart"
    from pg_stat_activity where pid = pg_backend_pid()`);
  const backendPid = String(backend.rows[0]?.backendPid ?? "");
  const backendStartValue = backend.rows[0]?.backendStart;
  const backendStartDate = backendStartValue instanceof Date
    ? backendStartValue : new Date(String(backendStartValue ?? ""));
  if (!/^[1-9][0-9]*$/u.test(backendPid) || !Number.isFinite(backendStartDate.getTime())) {
    fail("schema_032_sequence_database_session_identity_invalid");
  }
  const backendStart = backendStartDate.toISOString();
  const sessionIdentitySha256 = buildSchema032MigrationSessionIdentitySha256(row);
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
    sessionIdentitySha256,
    sessionInstanceIdentitySha256: hash(JSON.stringify({ sessionIdentitySha256, backendPid, backendStart })),
    task0bIdentityFingerprintSha256: row.databaseName === "tron_watch" && endpointHost === "127.0.0.1"
      ? buildTask0BProductionDatabaseIdentityFingerprint({
        databaseName: "tron_watch",
        endpointHost: "127.0.0.1",
        endpointPort,
        connectedServerPort: observed.connectedServerPort,
        systemIdentifier: row.systemIdentifier,
        databaseOid: row.databaseOid,
        serverVersionNum: row.serverVersion
      })
      : hash(JSON.stringify({ databaseName: row.databaseName, endpointHost, endpointPort,
        connectedServerPort: observed.connectedServerPort, systemIdentifier: row.systemIdentifier,
        databaseOid: row.databaseOid, serverVersionNum: row.serverVersion }))
  };
}

async function assertSchema032ProductionSessionLock(
  client: Client,
  endpoint: string,
  expectedIdentitySha256: string
): Promise<void> {
  const identity = await readDatabaseIdentity(client, endpoint);
  const lock = await client.query(`select exists(
    select 1 from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid = (($1::bigint >> 32) & 4294967295)::oid
      and objid = ($1::bigint & 4294967295)::oid and objsubid = 1
  ) as owned`, [SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
  if (identity.sessionInstanceIdentitySha256 !== expectedIdentitySha256 || lock.rows[0]?.owned !== true) {
    fail("schema_032_sequence_production_session_lock_changed");
  }
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
      || issuedAt > now || expiresAt <= now || expiresAt.getTime() - issuedAt.getTime() > 30 * 60_000
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
    "operationalAttestationSha256", "operationalAttestationIssuerReceiptSha256",
    "databaseIdentityFingerprintSha256", "backupFilename", "backupBytes", "backupSha256",
    "backupPathFingerprintSha256", "restoreListFilename", "restoreListBytes", "restoreListSha256",
    "restoreListEntryCount", "state"
  ], "schema_032_sequence_production_backup_invalid");
  if (backup.version !== "production-backup-evidence-v1" || backup.candidateSha !== input.candidateSha
      || backup.gateId !== "G12_PRODUCTION_BACKUP" || backup.commandId !== "production_backup"
      || backup.redactedTemplateSha256 !== SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256
      || !SHA256.test(String(backup.operationalAttestationSha256))
      || !SHA256.test(String(backup.operationalAttestationIssuerReceiptSha256))
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

export function verifySchema032ProductionManifestAuthorityV2(input: {
  artifactRoot: string;
  authority: unknown;
  task0bBytes: Buffer;
  backupBytes: Buffer;
  evaluatedAt: string;
  expectedAttestationSha256?: string;
}) {
  const authority = validateProductionAuthority(input.authority, input.evaluatedAt);
  const verified = verifyCurrentReleaseManifestChainV2(input.artifactRoot);
  const { freeze, manifest, manifestSha256 } = verified;
  const states = new Map(manifest.gates.map((gate) => [gate.id, gate.state]));
  if (manifest.transitionId !== "g12_backup_passed" || manifest.overall !== "not_ready"
      || authority.generationId !== freeze.releaseGenerationId
      || authority.candidateSha !== freeze.candidateSha
      || authority.databaseIdentityFingerprintSha256 !== freeze.productionDatabaseIdentityFingerprintSha256
      || authority.releaseManifestSha256 !== manifestSha256
      || authority.task0bEvidenceSha256 !== hash(input.task0bBytes)
      || authority.backupEvidenceSha256 !== hash(input.backupBytes)
      || [...states.entries()].some(([id, state]) => /^G(?:0\d|1[0-2])_/u.test(id) && state !== "passed")
      || [...states.entries()].some(([id, state]) => /^G1[3-5]_/u.test(id) && state !== "pending")) {
    fail("schema_032_sequence_production_v2_manifest_authority_unverified");
  }
  const remainingCustomValidityMs = Date.parse(authority.expiresAt) - Date.parse(input.evaluatedAt);
  const selected = selectOperationalAttestationFromStoreV2({
    artifactRoot: input.artifactRoot,
    action: "g13_migration_passed",
    expectedSourceManifestSha256: manifestSha256,
    evaluatedAt: input.evaluatedAt,
    minimumRemainingValidityMs: remainingCustomValidityMs,
    expectedConsumedAttestationSha256: input.expectedAttestationSha256
  });
  return { ...verified, selected };
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
    "generationId" | "authoritySha256" | "operationalAttestationSha256"
    | "operationalAttestationIssuerReceiptSha256" | "candidateSha" | "databaseIdentityFingerprintSha256"
    | "resumeExpiresAt">,
  evaluatedAt: string
): ProductionAuthorityConsumptionV1 {
  const consumption = record(value, "schema_032_sequence_production_consumption_invalid");
  const bindsV2 = expected.operationalAttestationSha256 !== undefined
    || expected.operationalAttestationIssuerReceiptSha256 !== undefined;
  if (bindsV2 && (expected.operationalAttestationSha256 === undefined
      || expected.operationalAttestationIssuerReceiptSha256 === undefined)) {
    fail("schema_032_sequence_production_consumption_mismatch");
  }
  exactKeys(consumption, [
    "version", "generationId", "authoritySha256", "candidateSha", "databaseIdentityFingerprintSha256",
    ...(bindsV2 ? ["operationalAttestationSha256", "operationalAttestationIssuerReceiptSha256"] : []),
    "claimedAt", "resumeExpiresAt"
  ], "schema_032_sequence_production_consumption_invalid");
  const now = parseIso(evaluatedAt, "schema_032_sequence_production_consumption_invalid");
  const claimedAt = parseIso(consumption.claimedAt, "schema_032_sequence_production_consumption_invalid");
  const resumeExpiresAt = parseIso(consumption.resumeExpiresAt, "schema_032_sequence_production_consumption_invalid");
  if (consumption.version !== "schema-032-production-authority-consumption-v2"
      || typeof consumption.generationId !== "string" || !GENERATION.test(consumption.generationId)
      || !SHA256.test(String(consumption.authoritySha256)) || !SHA40.test(String(consumption.candidateSha))
      || !SHA256.test(String(consumption.databaseIdentityFingerprintSha256))
      || (bindsV2 && (!SHA256.test(String(consumption.operationalAttestationSha256))
        || !SHA256.test(String(consumption.operationalAttestationIssuerReceiptSha256))))
      || consumption.generationId !== expected.generationId
      || consumption.authoritySha256 !== expected.authoritySha256
      || consumption.operationalAttestationSha256 !== expected.operationalAttestationSha256
      || consumption.operationalAttestationIssuerReceiptSha256
        !== expected.operationalAttestationIssuerReceiptSha256
      || consumption.candidateSha !== expected.candidateSha
      || consumption.databaseIdentityFingerprintSha256 !== expected.databaseIdentityFingerprintSha256
      || consumption.resumeExpiresAt !== expected.resumeExpiresAt
      || claimedAt > now || claimedAt >= resumeExpiresAt) {
    fail("schema_032_sequence_production_consumption_mismatch");
  }
  if (now >= resumeExpiresAt) fail("schema_032_sequence_production_consumption_expired");
  return consumption as ProductionAuthorityConsumptionV1;
}

type Schema032ProductionExecutionBindingV2 = {
  releaseFreezeIdentitySha256: string;
  operationalAttestationSha256: string;
  operationalAttestationIssuerReceiptSha256: string;
  authorityConsumptionSha256: string;
  sourceManifestSha256: string;
  g12TransitionReceiptSha256: string;
  productionBackupEvidenceSha256: string;
  executionAttemptRelativePath: string;
  executionAttemptSha256: string;
};

type PreparedSchema032ProductionAuthorizationV2 = Awaited<ReturnType<typeof prepareProductionMutationAuthorization>>;

async function prepareProductionMutationAuthorization(input: {
  artifactRoot: string;
  candidateSha: string;
  evaluatedAt?: string;
  revalidationEvaluatedAt?: string;
  readCurrentTask0BReleaseRevalidation?: typeof readCurrentTask0BReleaseRevalidation;
}) {
  const initialEvaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const revalidationEvaluatedAt = input.revalidationEvaluatedAt ?? new Date().toISOString();
  const [task0bBytes, backupBytes] = await Promise.all([
    readProtectedRegularFile(input.artifactRoot, "task0b-release-freeze.json", MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(input.artifactRoot, "production-backup-evidence.json", MAX_ARTIFACT_BYTES)
  ]);
  const currentTask0B = await (input.readCurrentTask0BReleaseRevalidation
    ?? readCurrentTask0BReleaseRevalidation)(input.artifactRoot, revalidationEvaluatedAt);
  if (!currentTask0B.frozenBytes.equals(task0bBytes)) {
    fail("schema_032_sequence_task0b_revalidation_binding_changed");
  }
  const rootOnlyVerified = verifyCurrentReleaseManifestChainV2(input.artifactRoot);
  const rootOnlySelected = selectOperationalAttestationFromStoreV2({
    artifactRoot: input.artifactRoot,
    action: "g13_migration_passed",
    expectedSourceManifestSha256: rootOnlyVerified.manifestSha256,
    evaluatedAt: initialEvaluatedAt,
    minimumRemainingValidityMs: MINIMUM_G13_CLAIM_VALIDITY_MS
  });
  if (!canonicalBytesV2(rootOnlyVerified.freeze).equals(canonicalBytesV2(currentTask0B.freeze))
      || rootOnlyVerified.manifest.transitionId !== "g12_backup_passed"
      || rootOnlyVerified.manifest.overall !== "not_ready") {
    fail("schema_032_sequence_production_v2_manifest_authority_unverified");
  }
  const authorityValue = {
    version: "schema-032-production-authority-v1" as const,
    scope: "schema_032_production_migration" as const,
    source: "operator_protected_one_shot_production_go" as const,
    generationId: rootOnlyVerified.freeze.releaseGenerationId,
    commandId: "production_migration" as const,
    commandTemplateSha256: rootOnlySelected.authority.redactedTemplateSha256,
    issuedAt: rootOnlySelected.authority.issuedAt,
    expiresAt: rootOnlySelected.authority.expiresAt,
    candidateSha: rootOnlyVerified.freeze.candidateSha,
    databaseRole: "production" as const,
    databaseIdentityFingerprintSha256: rootOnlyVerified.freeze.productionDatabaseIdentityFingerprintSha256,
    task0bEvidenceSha256: hash(task0bBytes),
    releaseManifestPath: "release-manifest.json" as const,
    releaseManifestSha256: rootOnlyVerified.manifestSha256,
    releaseManifestOverall: "not_ready" as const,
    backupEvidencePath: "production-backup-evidence.json" as const,
    backupEvidenceSha256: hash(backupBytes),
    explicitGo: true as const
  };
  const authorityBytes = canonicalBytesV2(authorityValue);
  let authority = validateProductionAuthority(authorityValue, initialEvaluatedAt);
  const authorityFilename = `schema032-production-authority-${authority.generationId}.json`;
  const consumptionFilename = `schema032-production-authority-consumed-${authority.generationId}.json`;
  const [existingAuthorityAlias, existingConsumption] = await Promise.all([
    readOptionalArtifact(input.artifactRoot, authorityFilename),
    readOptionalArtifact(input.artifactRoot, consumptionFilename)
  ]);
  if (existingAuthorityAlias !== null && existingConsumption === null) {
    fail("schema_032_sequence_production_orphan_authority_alias");
  }
  const task0b = validateTask0BReleaseFreezeEvidence(
    parseJson(task0bBytes.toString("utf8"), "schema_032_sequence_task0b_invalid"),
    input.candidateSha
  );
  const backup = parseProductionBackupEvidence(
    parseJson(backupBytes.toString("utf8"), "schema_032_sequence_production_backup_invalid"),
    {
      candidateSha: input.candidateSha,
      observedDatabaseIdentityFingerprintSha256: authority.databaseIdentityFingerprintSha256
    }
  );
  if (task0b.productionDatabase.approvedIdentityFingerprintSha256
      !== authority.databaseIdentityFingerprintSha256) {
    fail("schema_032_sequence_production_database_binding_unverified");
  }
  const initialV2 = { ...rootOnlyVerified, selected: rootOnlySelected };
  return { ...input, authorityFilename, authorityBytes, task0bBytes, backupBytes, authorityValue, authority,
    task0b, backup, initialV2 };
}

async function readValidatedSchema032AttemptLineage(input: {
  artifactRoot: string;
  generationId: string;
  candidateSha: string;
  authorityConsumptionSha256: string;
}) {
  const prefix = `schema032-production-attempt-${input.generationId}-`;
  const attempts = await Promise.all((await readdir(input.artifactRoot))
    .filter((name) => name.startsWith(prefix) && /^[A-Za-z0-9._-]+\.json$/u.test(name))
    .map(async (name) => {
      const bytes = await readProtectedRegularFile(input.artifactRoot, name, MAX_ARTIFACT_BYTES);
      const value = validateSchema032ProductionExecutionAttemptV2(
        parseJson(bytes.toString("utf8"), "schema_032_sequence_production_attempt_invalid")
      );
      const sha256 = hash(bytes);
      if (name !== `${prefix}${sha256}.json`
          || !bytes.equals(canonicalBytesV2(value))) {
        fail("schema_032_sequence_production_attempt_invalid");
      }
      return { name, value, bytes, sha256 };
    }));
  attempts.sort((left, right) => left.value.attemptOrdinal - right.value.attemptOrdinal);
  attempts.forEach((entry, index) => {
    if (entry.value.generationId !== input.generationId || entry.value.candidateSha !== input.candidateSha
        || entry.value.authorityConsumptionSha256 !== input.authorityConsumptionSha256
        || entry.value.attemptOrdinal !== index + 1
        || entry.value.previousAttemptSha256 !== (index === 0 ? null : attempts[index - 1]!.sha256)) {
      fail("schema_032_sequence_production_attempt_lineage_invalid");
    }
  });
  return attempts;
}

async function authorizeProductionMutation(input: {
  prepared: PreparedSchema032ProductionAuthorizationV2;
  observedTask0bDatabaseFingerprintSha256: string;
  databaseSessionIdentitySha256: string;
  lockAcquiredAt: string;
  hasSequenceArtifacts: boolean;
}): Promise<{
  binding: Schema032ProductionExecutionBindingV2;
  revalidate(): Promise<void>;
}> {
  const { prepared } = input;
  const { artifactRoot, authorityFilename, candidateSha, authorityBytes, task0bBytes, backupBytes,
    authorityValue, task0b, backup, initialV2 } = prepared;
  let authority = validateProductionAuthority(authorityValue, new Date().toISOString());
  if (input.observedTask0bDatabaseFingerprintSha256 !== authority.databaseIdentityFingerprintSha256
      || input.observedTask0bDatabaseFingerprintSha256
        !== task0b.productionDatabase.approvedIdentityFingerprintSha256) {
    fail("schema_032_sequence_production_database_binding_unverified");
  }
  await attestSchema032ProductionBackupFiles(artifactRoot, backup, task0b.postgresTools);
  const claimedAt = new Date().toISOString();
  authority = validateProductionAuthority(authorityValue, claimedAt);
  const claimedV2 = verifySchema032ProductionManifestAuthorityV2({
    artifactRoot,
    authority: authorityValue,
    task0bBytes,
    backupBytes,
    evaluatedAt: claimedAt,
    expectedAttestationSha256: initialV2.selected.attestationSha256
  });
  if (authorityFilename !== `schema032-production-authority-${authority.generationId}.json`) {
    fail("schema_032_sequence_production_authority_filename_invalid");
  }
  const consumptionName = `schema032-production-authority-consumed-${authority.generationId}.json`;
  const existing = await readOptionalArtifact(artifactRoot, consumptionName);
  if (existing === null && Date.parse(authority.expiresAt) - Date.parse(claimedAt)
      < MINIMUM_G13_CLAIM_VALIDITY_MS) {
    fail("schema_032_sequence_production_authority_insufficient_claim_validity");
  }
  const expectedConsumption = {
    generationId: authority.generationId,
    authoritySha256: hash(authorityBytes),
    operationalAttestationSha256: claimedV2.selected.attestationSha256,
    operationalAttestationIssuerReceiptSha256: claimedV2.selected.issuerReceiptSha256,
    candidateSha,
    databaseIdentityFingerprintSha256: input.observedTask0bDatabaseFingerprintSha256,
    resumeExpiresAt: authority.expiresAt
  };
  const consumption: ProductionAuthorityConsumptionV1 = {
    version: "schema-032-production-authority-consumption-v2",
    generationId: expectedConsumption.generationId,
    authoritySha256: expectedConsumption.authoritySha256,
    operationalAttestationSha256: expectedConsumption.operationalAttestationSha256,
    operationalAttestationIssuerReceiptSha256: expectedConsumption.operationalAttestationIssuerReceiptSha256,
    candidateSha: expectedConsumption.candidateSha,
    databaseIdentityFingerprintSha256: expectedConsumption.databaseIdentityFingerprintSha256,
    claimedAt,
    resumeExpiresAt: expectedConsumption.resumeExpiresAt
  };
  let actualConsumption: ProductionAuthorityConsumptionV1;
  if (existing === null) {
    if (input.hasSequenceArtifacts) fail("schema_032_sequence_unconsumed_partial_production_state");
    const validatedConsumption = validateSchema032ProductionConsumptionState(
      consumption,
      expectedConsumption,
      claimedAt
    );
    await writeArtifactExclusive(artifactRoot, consumptionName, validatedConsumption);
    actualConsumption = validatedConsumption;
  } else {
    actualConsumption = validateSchema032ProductionConsumptionState(
      parseJson(existing, "schema_032_sequence_production_consumption_invalid"),
      expectedConsumption,
      claimedAt
    );
  }
  await writeArtifactExactReplay(artifactRoot, authorityFilename, authorityValue);
  const consumptionBytes = canonicalBytesV2(actualConsumption);
  const attemptPrefix = `schema032-production-attempt-${authority.generationId}-`;
  const priorAttempts = await readValidatedSchema032AttemptLineage({
    artifactRoot,
    generationId: authority.generationId,
    candidateSha,
    authorityConsumptionSha256: hash(consumptionBytes)
  });
  const executionAttempt: Schema032ProductionExecutionAttemptV2 = {
    version: "schema-032-production-execution-attempt-v2",
    generationId: authority.generationId,
    candidateSha,
    authorityConsumptionSha256: hash(consumptionBytes),
    attemptOrdinal: priorAttempts.length + 1,
    previousAttemptSha256: priorAttempts.at(-1)?.sha256 ?? null,
    advisoryLockKey: SCHEMA_032_PRODUCER_ADVISORY_LOCK,
    databaseSessionIdentitySha256: input.databaseSessionIdentitySha256,
    lockAcquiredAt: input.lockAcquiredAt
  };
  validateSchema032ProductionExecutionAttemptV2(executionAttempt);
  const executionAttemptBytes = canonicalBytesV2(executionAttempt);
  const executionAttemptSha256 = hash(executionAttemptBytes);
  const executionAttemptRelativePath = `${attemptPrefix}${executionAttemptSha256}.json`;
  await writeArtifactExclusive(artifactRoot, executionAttemptRelativePath, executionAttempt);
  const binding = {
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(claimedV2.freeze),
    operationalAttestationSha256: claimedV2.selected.attestationSha256,
    operationalAttestationIssuerReceiptSha256: claimedV2.selected.issuerReceiptSha256,
    authorityConsumptionSha256: hash(consumptionBytes),
    sourceManifestSha256: claimedV2.manifestSha256,
    g12TransitionReceiptSha256: claimedV2.manifest.latestCommittedReceiptSha256,
    productionBackupEvidenceSha256: hash(backupBytes),
    executionAttemptRelativePath,
    executionAttemptSha256
  };
  return {
    binding,
    async revalidate() {
      const evaluatedAt = new Date().toISOString();
      const [currentAuthorityBytes, currentTask0bBytes, currentBackupBytes, currentConsumption,
        currentExecutionAttempt] = await Promise.all([
        readOptionalArtifact(artifactRoot, authorityFilename)
          .then((value) => Buffer.from(value ?? authorityBytes.toString("utf8"), "utf8")),
        readProtectedRegularFile(artifactRoot, "task0b-release-freeze.json", MAX_ARTIFACT_BYTES),
        readProtectedRegularFile(artifactRoot, "production-backup-evidence.json", MAX_ARTIFACT_BYTES),
        readProtectedRegularFile(artifactRoot, consumptionName, MAX_ARTIFACT_BYTES),
        readProtectedRegularFile(artifactRoot, executionAttemptRelativePath, MAX_ARTIFACT_BYTES)
      ]);
      if (!currentAuthorityBytes.equals(authorityBytes) || !currentTask0bBytes.equals(task0bBytes)
          || !currentBackupBytes.equals(backupBytes) || !currentExecutionAttempt.equals(executionAttemptBytes)) {
        fail("schema_032_sequence_production_binding_changed");
      }
      validateSchema032ProductionConsumptionState(
        parseJson(currentConsumption.toString("utf8"), "schema_032_sequence_production_consumption_invalid"),
        expectedConsumption,
        evaluatedAt
      );
      verifySchema032ProductionManifestAuthorityV2({
        artifactRoot,
        authority: authorityValue,
        task0bBytes,
        backupBytes,
        evaluatedAt,
        expectedAttestationSha256: claimedV2.selected.attestationSha256
      });
    }
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

async function prepareSchema032ProductionSettlementV2(
  artifactRoot: string,
  executionReceiptCore: Record<string, unknown>
): Promise<{
  prepared: PreparedSchema032ProductionSettlementV2;
  relativePath: string;
  sha256: string;
}> {
  const prepared = validatePreparedSchema032ProductionSettlementV2({
    version: "prepared-schema-032-production-settlement-v2",
    preparedAt: new Date().toISOString(),
    executionReceiptCore
  });
  const bytes = canonicalBytesV2(prepared);
  const sha256 = hash(bytes);
  const relativePath = `schema032-production-settlement-prepared-${sha256}.json`;
  await writeArtifactExclusive(artifactRoot, relativePath, prepared);
  return { prepared, relativePath, sha256 };
}

type Schema032ProductionExecutionFailureV2 = Extract<Schema032ProductionExecutionReceiptV2,
  { result: "failed_after_attempt" }>;
type Schema032ProductionExecutionFailureInputV2 = Schema032ProductionExecutionReceiptCommonV2 & {
  result: "failed_after_attempt";
  failedStep: keyof typeof SCHEMA_032_FAILURE_PATHS;
  completedStages: Schema032CompletedStageV2[];
};

export async function persistSchema032ProductionFailureRouteV2(
  artifactRoot: string,
  input: {
    executionReceipt: Schema032ProductionExecutionFailureInputV2;
    failureCode: string;
    faultAt?: "after_execution_receipt";
  }
): Promise<{
  executionReceipt: Schema032ProductionExecutionFailureV2;
  failureEvidence: ProductionFailureEvidenceV2;
}> {
  if (input.failureCode.length > 160 || !/^schema_032_[a-z0-9_:.-]+$/u.test(input.failureCode)) {
    fail("schema_032_sequence_failure_code_invalid");
  }
  const { failedStep } = input.executionReceipt;
  const stageFailure = {
    version: "schema032-stage-failure-v2" as const,
    candidateSha: input.executionReceipt.candidateSha,
    failedStep,
    failureCode: input.failureCode,
    observedAt: input.executionReceipt.lockReleasedAt
  };
  const stageFailureBytes = canonicalBytesV2(stageFailure);
  const executionReceipt = validateSchema032ProductionExecutionReceiptV2({
    ...input.executionReceipt,
    failureArtifact: {
      kind: "schema032_stage_failure",
      failedStep,
      relativePath: SCHEMA_032_FAILURE_PATHS[failedStep],
      evidenceSha256: hash(stageFailureBytes)
    }
  }) as Schema032ProductionExecutionFailureV2;
  const executionReceiptBytes = canonicalBytesV2(executionReceipt);
  const failureEvidence = validateProductionFailureEvidenceV2({
    version: "production-failure-evidence-v2",
    candidateSha: executionReceipt.candidateSha,
    releaseFreezeIdentitySha256: executionReceipt.releaseFreezeIdentitySha256,
    sourceManifestSha256: executionReceipt.sourceManifestSha256,
    failedExecutionEvidenceSha256: hash(executionReceiptBytes),
    observedAt: executionReceipt.lockReleasedAt,
    failedGateId: "G13_PRODUCTION_MIGRATION",
    evidenceKind: "schema032_execution_receipt",
    attemptedExternalEffect: true,
    failureCode: `${failedStep}_failed`
  });
  await writeArtifactExactReplay(artifactRoot, SCHEMA_032_FAILURE_PATHS[failedStep], stageFailure);
  await writeArtifactExactReplay(artifactRoot, "schema032-production-execution-receipt-v2.json", executionReceipt);
  if (input.faultAt === "after_execution_receipt") fail("schema_032_test_fault_after_execution_receipt");
  await writeArtifactExactReplay(artifactRoot, "production-failure-evidence-v2.json", failureEvidence);
  return { executionReceipt, failureEvidence };
}

async function replaySchema032ProductionTerminalReceiptV2(input: {
  prepared: PreparedSchema032ProductionAuthorizationV2;
  receiptBytes: Buffer;
}): Promise<string> {
  const { prepared, receiptBytes } = input;
  const receipt = validateSchema032ProductionExecutionReceiptV2(
    parseJson(receiptBytes.toString("utf8"), "schema_032_sequence_production_receipt_invalid")
  );
  if (!receiptBytes.equals(canonicalBytesV2(receipt))) {
    fail("schema_032_sequence_production_receipt_invalid");
  }
  if (receipt.result !== "failed_after_attempt") fail("schema_032_sequence_already_completed");
  const consumptionName = `schema032-production-authority-consumed-${prepared.authority.generationId}.json`;
  const [consumptionBytes, attemptBytes, settlementBytes, stageFailureBytes] = await Promise.all([
    readProtectedRegularFile(prepared.artifactRoot, consumptionName, MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(prepared.artifactRoot, receipt.executionAttemptRelativePath, MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(prepared.artifactRoot, receipt.preparedSettlementRelativePath, MAX_ARTIFACT_BYTES),
    readRequiredArtifactBytes(prepared.artifactRoot, receipt.failureArtifact.relativePath)
  ]);
  const attemptLineage = await readValidatedSchema032AttemptLineage({
    artifactRoot: prepared.artifactRoot,
    generationId: prepared.authority.generationId,
    candidateSha: prepared.candidateSha,
    authorityConsumptionSha256: hash(consumptionBytes)
  });
  if (attemptLineage.at(-1)?.sha256 !== receipt.executionAttemptSha256) {
    fail("schema_032_sequence_production_attempt_lineage_invalid");
  }
  const attestationBytes = canonicalBytesV2(prepared.initialV2.selected.authority);
  const evidenceInputs = [
    { kind: "operational_attestation", relativePath: "operational-attestation-g13-terminal-replay.json",
      bytes: attestationBytes },
    { kind: "production_migration_authority", relativePath: prepared.authorityFilename,
      bytes: prepared.authorityBytes },
    { kind: "production_migration_consumption", relativePath: consumptionName, bytes: consumptionBytes },
    { kind: "production_migration_attempt", relativePath: receipt.executionAttemptRelativePath, bytes: attemptBytes },
    { kind: "production_migration_prepared_settlement", relativePath: receipt.preparedSettlementRelativePath,
      bytes: settlementBytes },
    { kind: "production_migration_sequence", relativePath: "schema032-production-execution-receipt-v2.json",
      bytes: receiptBytes }
  ] as const;
  const evidence: GateEvidenceRefV2[] = evidenceInputs.map(({ kind, relativePath, bytes }) => {
    const value = record(parseJson(bytes.toString("utf8"), "schema_032_sequence_replay_evidence_invalid"),
      "schema_032_sequence_replay_evidence_invalid");
    if (typeof value.version !== "string") fail("schema_032_sequence_replay_evidence_invalid");
    return {
      kind, relativePath,
      candidateSha: prepared.candidateSha,
      sha256: hash(bytes),
      schemaVersion: value.version
    };
  });
  const replayGate: ExecutedReleaseGateV2 = {
    id: "G13_PRODUCTION_MIGRATION",
    candidateSha: prepared.candidateSha,
    state: "failed",
    commandId: "production_migration",
    redactedTemplateSha256: SCHEMA_032_PRODUCTION_MIGRATION_TEMPLATE_SHA256,
    startedAt: receipt.lockAcquiredAt,
    finishedAt: receipt.lockReleasedAt,
    exitCode: 1,
    outputSha256: hash(receiptBytes),
    evidence
  };
  validateGateEvidenceBytesV2(replayGate,
    new Map<string, Buffer>(evidenceInputs.map((item) => [item.relativePath, item.bytes])), {
    releaseGenerationId: prepared.initialV2.freeze.releaseGenerationId,
    artifactRootFingerprintSha256: prepared.initialV2.freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(prepared.initialV2.freeze),
    sourceManifestSha256: prepared.initialV2.manifestSha256,
    task0bReleaseFreezeSha256: hash(prepared.task0bBytes),
    productionDatabaseIdentityFingerprintSha256:
      prepared.initialV2.freeze.productionDatabaseIdentityFingerprintSha256,
    requireStandaloneAuthorityBinding: true
  });
  if (receipt.g12TransitionReceiptSha256 !== prepared.initialV2.manifest.latestCommittedReceiptSha256
      || hash(stageFailureBytes) !== receipt.failureArtifact.evidenceSha256) {
    fail("schema_032_sequence_production_receipt_binding_invalid");
  }
  const stageFailure = record(
    parseJson(stageFailureBytes.toString("utf8"), "schema_032_sequence_stage_failure_invalid"),
    "schema_032_sequence_stage_failure_invalid"
  );
  exactKeys(stageFailure, ["version", "candidateSha", "failedStep", "failureCode", "observedAt"],
    "schema_032_sequence_stage_failure_invalid");
  if (stageFailure.version !== "schema032-stage-failure-v2"
      || stageFailure.candidateSha !== receipt.candidateSha || stageFailure.failedStep !== receipt.failedStep
      || typeof stageFailure.failureCode !== "string"
      || !/^schema_032_[a-z0-9_:.-]+$/u.test(stageFailure.failureCode)) {
    fail("schema_032_sequence_stage_failure_invalid");
  }
  assertSchema032StageFailureAttemptInterval(
    stageFailure.observedAt, receipt.lockAcquiredAt, receipt.lockReleasedAt
  );
  const failureEvidence = validateProductionFailureEvidenceV2({
    version: "production-failure-evidence-v2",
    candidateSha: receipt.candidateSha,
    releaseFreezeIdentitySha256: receipt.releaseFreezeIdentitySha256,
    sourceManifestSha256: receipt.sourceManifestSha256,
    failedExecutionEvidenceSha256: hash(receiptBytes),
    observedAt: receipt.lockReleasedAt,
    failedGateId: "G13_PRODUCTION_MIGRATION",
    evidenceKind: "schema032_execution_receipt",
    attemptedExternalEffect: true,
    failureCode: `${receipt.failedStep}_failed`
  });
  const existingFailure = await readOptionalArtifact(prepared.artifactRoot, "production-failure-evidence-v2.json");
  const expectedFailureBytes = canonicalBytesV2(failureEvidence);
  if (existingFailure === null) {
    await writeArtifactExactReplay(prepared.artifactRoot, "production-failure-evidence-v2.json", failureEvidence);
  } else if (!Buffer.from(existingFailure, "utf8").equals(expectedFailureBytes)) {
    fail("schema_032_sequence_production_failure_replay_conflict");
  }
  return stageFailure.failureCode;
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

export async function runSchema032ReleaseSequence(
  options: Schema032SequenceCliOptions,
  testDependencies?: {
    observeCandidateRepositoryState(): Promise<{ headSha: string; status: string; migrationFiles: string[] }>;
    readCurrentTask0BReleaseRevalidation?: typeof readCurrentTask0BReleaseRevalidation;
  }
): Promise<Schema032ReleaseEvidenceV1> {
  if (testDependencies !== undefined && process.env.NODE_ENV !== "test") {
    fail("schema_032_sequence_test_dependencies_forbidden");
  }
  const validated = validateSchema032ReleaseSequenceTarget(options);
  const repository = await (testDependencies?.observeCandidateRepositoryState
    ?? observeCandidateRepositoryState)();
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
  const existingProductionReceiptText = validated.databaseRole === "production"
    ? await readOptionalArtifact(artifactRoot, "schema032-production-execution-receipt-v2.json") : null;
  const existingProductionReceiptBytes = existingProductionReceiptText === null
    ? null : Buffer.from(existingProductionReceiptText, "utf8");
  const existingProductionReceipt = existingProductionReceiptBytes === null ? null
    : validateSchema032ProductionExecutionReceiptV2(parseJson(existingProductionReceiptText!,
      "schema_032_sequence_production_receipt_invalid"));
  const preparedProduction = validated.databaseRole === "production"
    ? await prepareProductionMutationAuthorization({
      artifactRoot,
      candidateSha: validated.candidateSha,
      evaluatedAt: existingProductionReceipt?.lockAcquiredAt,
      revalidationEvaluatedAt: new Date().toISOString(),
      readCurrentTask0BReleaseRevalidation: testDependencies?.readCurrentTask0BReleaseRevalidation
    })
    : null;
  if (preparedProduction !== null && existingProductionReceiptBytes !== null) {
    const failureCode = await replaySchema032ProductionTerminalReceiptV2({
      prepared: preparedProduction,
      receiptBytes: existingProductionReceiptBytes
    });
    fail(failureCode);
  }
  const client = new Client(buildSchema032ClientConfig(validated.databaseUrl, validated.offline));
  let locked = false;
  let lockAcquiredAt: string | null = null;
  let lockReleasedAt: string | null = null;
  let productionBinding: Schema032ProductionExecutionBindingV2 | null = null;
  let revalidateProductionOperation: (() => Promise<void>) | null = null;
  let productionSettlementAuthorized = false;
  let pendingSettlement: Awaited<ReturnType<typeof prepareSchema032ProductionSettlementV2>> | null = null;
  let pendingExecutionReceiptCore: Record<string, unknown> | null = null;
  let pendingFailureCode: string | null = null;
  let pendingStageFailureObservedAt: string | null = null;
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
    sessionIdentitySha256 = before.sessionInstanceIdentitySha256;
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
      const authorized = await authorizeProductionMutation({
        prepared: preparedProduction!,
        observedTask0bDatabaseFingerprintSha256: before.task0bIdentityFingerprintSha256,
        databaseSessionIdentitySha256: before.sessionInstanceIdentitySha256,
        lockAcquiredAt,
        hasSequenceArtifacts: Object.values(initialState).some((value) => value !== null)
      });
      productionBinding = authorized.binding;
      revalidateProductionOperation = async () => {
        await authorized.revalidate();
        await assertSchema032ProductionSessionLock(
          client,
          validated.expectedEndpoint,
          before.sessionInstanceIdentitySha256
        );
      };
      await revalidateProductionOperation();
    }
    const evidence = await executeSchema032ReleaseSequence({
      artifactRoot,
      target,
      validateOperation: revalidateProductionOperation ?? undefined,
      runMigration: async (sequence) => {
        await revalidateProductionOperation?.();
        const immediatelyBefore = await readDatabaseIdentity(client, validated.expectedEndpoint);
        if (JSON.stringify(immediatelyBefore) !== JSON.stringify(before)) {
          fail("schema_032_sequence_database_identity_changed");
        }
        await revalidateProductionOperation?.();
        const result = validated.databaseRole === "production"
          ? await runFixedMigrationInOwnedSession(client, repository.migrationFiles, sequence)
          : await runFixedMigration(
            validated.databaseUrl,
            repository.migrationFiles,
            sequence,
            validated.offline,
            before.sessionIdentitySha256,
            validated.expectedEndpoint
          );
        await revalidateProductionOperation?.();
        const immediatelyAfter = await readDatabaseIdentity(client, validated.expectedEndpoint);
        if (JSON.stringify(immediatelyAfter) !== JSON.stringify(before)) {
          fail("schema_032_sequence_database_identity_changed");
        }
        return result;
      },
      verifyPhase: async (phase, artifacts) => {
        await revalidateProductionOperation?.();
        return verifySchema032Release({
          phase,
          databaseUrl: validated.databaseUrl,
          offline: validated.offline,
          candidateSha: validated.candidateSha,
          expectedEndpoint: validated.expectedEndpoint,
          expectedSystemIdentifier: validated.expectedSystemIdentifier,
          firstMigrationOutcome: artifacts.firstMigrationOutcome,
          secondMigrationOutcome: artifacts.secondMigrationOutcome
        });
      }
    });
    await revalidateProductionOperation?.();
    const after = await readDatabaseIdentity(client, validated.expectedEndpoint);
    if (JSON.stringify(after) !== JSON.stringify(before)) fail("schema_032_sequence_database_identity_changed");
    await revalidateProductionOperation?.();
    if (validated.databaseRole === "production") {
      if (productionBinding === null || lockAcquiredAt === null || sessionIdentitySha256 === null
          || revalidateProductionOperation === null) {
        fail("schema_032_production_execution_binding_missing");
      }
      const state = await readSequenceState(artifactRoot);
      const ordered = [state.firstMigration, state.firstVerification, state.secondMigration, state.finalEvidence];
      if (ordered.some((value) => value === null)) fail("schema_032_production_execution_stage_missing");
      await revalidateProductionOperation();
      pendingExecutionReceiptCore = {
        version: "schema-032-production-execution-receipt-v2",
        candidateSha: validated.candidateSha,
        ...productionBinding,
        advisoryLockKey: SCHEMA_032_PRODUCER_ADVISORY_LOCK,
        databaseSessionIdentitySha256: sessionIdentitySha256,
        lockAcquiredAt,
        migrationBytesChecksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
        result: "applied_and_verified",
        completedStages: ["first_migration", "first_verification", "second_migration", "final_verification"]
          .map((step, index) => ({ step, receiptSha256: hash(Buffer.from(ordered[index]!, "utf8")) })),
        receiptChecksumSha256: evidence.receiptChecksumSha256,
        postconditionsSha256: evidence.postconditionsSha256
      };
      pendingSettlement = await prepareSchema032ProductionSettlementV2(
        artifactRoot, pendingExecutionReceiptCore
      );
      productionSettlementAuthorized = true;
    }
    completedEvidence = evidence;
  } catch (error) {
    caughtError = error;
    if (validated.databaseRole === "production" && revalidateProductionOperation !== null) {
      try {
        await revalidateProductionOperation();
        if (productionBinding === null || lockAcquiredAt === null || sessionIdentitySha256 === null) {
          fail("schema_032_production_execution_binding_missing");
        }
        const state = await readSequenceState(artifactRoot);
        const existing = [state.firstMigration, state.firstVerification, state.secondMigration, state.finalEvidence];
        const completedCount = existing.findIndex((value) => value === null);
        const count = completedCount < 0 ? existing.length : completedCount;
        if (count === existing.length) throw caughtError;
        const steps = ["first_migration", "first_verification", "second_migration", "final_verification"] as const;
        const failedStep = steps[count]!;
        pendingFailureCode = safeErrorCode(caughtError);
        const failurePath = SCHEMA_032_FAILURE_PATHS[failedStep];
        const existingStageFailure = await readOptionalArtifact(artifactRoot, failurePath);
        const stageFailure = existingStageFailure === null ? {
          version: "schema032-stage-failure-v2" as const,
          candidateSha: validated.candidateSha,
          failedStep,
          failureCode: pendingFailureCode,
          observedAt: new Date().toISOString()
        } : record(parseJson(existingStageFailure, "schema_032_sequence_stage_failure_invalid"),
          "schema_032_sequence_stage_failure_invalid");
        exactKeys(stageFailure, ["version", "candidateSha", "failedStep", "failureCode", "observedAt"],
          "schema_032_sequence_stage_failure_invalid");
        if (stageFailure.version !== "schema032-stage-failure-v2"
            || stageFailure.candidateSha !== validated.candidateSha || stageFailure.failedStep !== failedStep
            || stageFailure.failureCode !== pendingFailureCode) {
          fail("schema_032_sequence_stage_failure_invalid");
        }
        assertSchema032StageFailureAttemptInterval(stageFailure.observedAt, lockAcquiredAt);
        pendingStageFailureObservedAt = String(stageFailure.observedAt);
        const stageFailureBytes = canonicalBytesV2(stageFailure);
        if (existingStageFailure === null) await writeArtifactExclusive(artifactRoot, failurePath, stageFailure);
        else if (!Buffer.from(existingStageFailure, "utf8").equals(stageFailureBytes)) {
          fail("schema_032_sequence_stage_failure_invalid");
        }
        pendingExecutionReceiptCore = {
          version: "schema-032-production-execution-receipt-v2",
          candidateSha: validated.candidateSha,
          ...productionBinding,
          advisoryLockKey: SCHEMA_032_PRODUCER_ADVISORY_LOCK,
          databaseSessionIdentitySha256: sessionIdentitySha256,
          lockAcquiredAt,
          migrationBytesChecksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
          result: "failed_after_attempt",
          failedStep,
          completedStages: existing.slice(0, count).map((value, index) => ({
            step: steps[index], receiptSha256: hash(Buffer.from(value!, "utf8"))
          })),
          failureArtifact: {
            kind: "schema032_stage_failure",
            failedStep,
            relativePath: failurePath,
            evidenceSha256: hash(stageFailureBytes)
          }
        };
        pendingSettlement = await prepareSchema032ProductionSettlementV2(
          artifactRoot, pendingExecutionReceiptCore
        );
        productionSettlementAuthorized = true;
      } catch (authorizationError) {
        caughtError = authorizationError;
        productionSettlementAuthorized = false;
      }
    }
  } finally {
    if (locked) {
      const unlocked = await client.query("select pg_advisory_unlock($1) as unlocked",
        [SCHEMA_032_PRODUCER_ADVISORY_LOCK]).catch(() => null);
      if (unlocked?.rows[0]?.unlocked !== true) {
        await client.end().catch(() => undefined);
        fail("schema_032_sequence_advisory_unlock_failed");
      }
      lockReleasedAt ??= new Date().toISOString();
    }
    await client.end().catch(() => undefined);
  }
  if (validated.databaseRole === "production" && pendingSettlement !== null
      && pendingExecutionReceiptCore !== null && lockReleasedAt !== null) {
    const finalReceipt = validateSchema032ProductionExecutionReceiptV2({
      ...pendingExecutionReceiptCore,
      lockReleasedAt,
      preparedSettlementRelativePath: pendingSettlement.relativePath,
      preparedSettlementSha256: pendingSettlement.sha256
    });
    if (finalReceipt.result === "applied_and_verified") {
      await persistSchema032ProductionExecutionReceiptV2(artifactRoot, finalReceipt);
    } else {
      if (pendingFailureCode === null) fail("schema_032_sequence_failure_code_invalid");
      if (pendingStageFailureObservedAt === null) fail("schema_032_sequence_stage_failure_invalid");
      assertSchema032StageFailureAttemptInterval(
        pendingStageFailureObservedAt, finalReceipt.lockAcquiredAt, finalReceipt.lockReleasedAt
      );
      const executionReceiptBytes = canonicalBytesV2(finalReceipt);
      const failureEvidence = validateProductionFailureEvidenceV2({
        version: "production-failure-evidence-v2",
        candidateSha: finalReceipt.candidateSha,
        releaseFreezeIdentitySha256: finalReceipt.releaseFreezeIdentitySha256,
        sourceManifestSha256: finalReceipt.sourceManifestSha256,
        failedExecutionEvidenceSha256: hash(executionReceiptBytes),
        observedAt: finalReceipt.lockReleasedAt,
        failedGateId: "G13_PRODUCTION_MIGRATION",
        evidenceKind: "schema032_execution_receipt",
        attemptedExternalEffect: true,
        failureCode: `${finalReceipt.failedStep}_failed`
      });
      await writeArtifactExactReplay(artifactRoot, "schema032-production-execution-receipt-v2.json", finalReceipt);
      await writeArtifactExactReplay(artifactRoot, "production-failure-evidence-v2.json", failureEvidence);
    }
  }
  if (caughtError !== null) {
    throw caughtError;
  }
  if (completedEvidence === null) fail("schema_032_sequence_incomplete");
  if (validated.databaseRole === "production") {
    if (productionBinding === null || lockAcquiredAt === null || lockReleasedAt === null || sessionIdentitySha256 === null) {
      fail("schema_032_production_execution_binding_missing");
    }
    if (!productionSettlementAuthorized) fail("schema_032_production_settlement_authority_missing");
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
