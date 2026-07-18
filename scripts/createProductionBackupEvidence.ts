import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  assertNoSecretLikeArtifactValues,
  validateRemediationReleaseManifest,
  validateTask0BReleaseFreezeEvidence,
  type RemediationReleaseManifestV1,
  type Task0BReleaseFreezeEvidenceV1
} from "../src/release/remediationReleaseManifest";
import {
  buildTask0BProductionDatabaseIdentityFingerprint,
  inspectRealDirectory,
  readProtectedRegularFile
} from "./captureTask0BPreflight";
import {
  attestSchema032ProductionBackupFiles,
  schema032BackupPathFingerprint
} from "./runSchema032ReleaseSequence";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GENERATION = /^[a-z0-9][a-z0-9-]{15,63}$/u;
const OPERATION_ID = /^[0-9a-f]{32}$/u;
const SNAPSHOT = /^[0-9A-Fa-f-]{8,80}$/u;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_BACKUP_BYTES = 1024 ** 4;
const MAX_LIST_BYTES = 100 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 3_600_000;
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BACKUP_FILENAME = "production-backup.dump";
const LIST_FILENAME = "production-backup-restore-list.txt";
const EVIDENCE_FILENAME = "production-backup-evidence.json";
const PASSWORD_WRAPPER = "IFS= read -r PGPASSWORD || exit 97; export PGPASSWORD; exec \"$@\"";

export const attestProductionBackupFiles = attestSchema032ProductionBackupFiles;

export type ProductionBackupAuthorityV1 = {
  version: "production-backup-authority-v1";
  scope: "production_backup";
  source: "operator_protected_one_shot_production_go";
  generationId: string;
  commandId: "production_backup";
  commandTemplateSha256: string;
  issuedAt: string;
  expiresAt: string;
  candidateSha: string;
  databaseRole: "production";
  databaseIdentityFingerprintSha256: string;
  task0bEvidencePath: "task0b-release-freeze.json";
  task0bEvidenceSha256: string;
  releaseManifestPath: "release-manifest.json";
  releaseManifestSha256: string;
  releaseManifestOverall: "ready_for_release";
  artifactRootFingerprintSha256: string;
  explicitGo: true;
};

export type ProductionBackupEvidenceV1 = {
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

type Invocation = { executable: string; args: string[]; env: NodeJS.ProcessEnv; stdin: Buffer; containerName?: string };

export type ProductionBackupConsumptionV1 = {
  version: "production-backup-authority-consumption-v1";
  generationId: string;
  authoritySha256: string;
  candidateSha: string;
  databaseIdentityFingerprintSha256: string;
  artifactRootFingerprintSha256: string;
  claimedAt: string;
  expiresAt: string;
};

type ExpectedConsumption = Pick<ProductionBackupConsumptionV1,
  "generationId" | "authoritySha256" | "candidateSha" | "databaseIdentityFingerprintSha256"
  | "artifactRootFingerprintSha256" | "expiresAt">;

export type ProductionBackupProgressBinding = ExpectedConsumption & { claimSha256: string };

export type ProductionBackupDumpProgressV1 = ProductionBackupProgressBinding & {
  version: "production-backup-dump-progress-v1";
  operationId: string;
  recordedAt: string;
  backupFilename: "production-backup.dump";
  backupBytes: number;
  backupSha256: string;
  backupPathFingerprintSha256: string;
};

export type ProductionBackupListProgressV1 = ProductionBackupProgressBinding & {
  version: "production-backup-list-progress-v1";
  operationId: string;
  recordedAt: string;
  dumpProgressSha256: string;
  restoreListFilename: "production-backup-restore-list.txt";
  restoreListBytes: number;
  restoreListSha256: string;
  restoreListEntryCount: number;
};

export type ProductionBackupOperationLeaseV1 = ProductionBackupProgressBinding & {
  version: "production-backup-operation-lease-v1";
  operationId: string;
  ownerProcessId: number;
  acquiredAt: string;
  dumpContainerName: string;
  restoreContainerName: string;
};

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function claimFilename(generationId: string): string {
  return `production-backup-authority-consumed-${generationId}.json`;
}

function leaseFilename(generationId: string): string {
  return `production-backup-operation-${generationId}.json`;
}

function dumpProgressFilename(generationId: string): string {
  return `production-backup-dump-progress-${generationId}.json`;
}

function listProgressFilename(generationId: string): string {
  return `production-backup-list-progress-${generationId}.json`;
}

function canonicalPathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
}

function iso(value: unknown, code: string): Date {
  if (typeof value !== "string") throw new Error(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(code);
  return parsed;
}

export function validateProductionBackupAuthority(
  value: unknown,
  evaluatedAt = new Date().toISOString(),
  requireFresh = true
): ProductionBackupAuthorityV1 {
  assertNoSecretLikeArtifactValues(value);
  const authority = record(value, "production_backup_authority_invalid");
  exactKeys(authority, [
    "version", "scope", "source", "generationId", "commandId", "commandTemplateSha256", "issuedAt", "expiresAt",
    "candidateSha", "databaseRole", "databaseIdentityFingerprintSha256", "task0bEvidencePath", "task0bEvidenceSha256",
    "releaseManifestPath", "releaseManifestSha256", "releaseManifestOverall", "artifactRootFingerprintSha256", "explicitGo"
  ], "production_backup_authority_invalid");
  const now = iso(evaluatedAt, "production_backup_authority_time_invalid");
  const issuedAt = iso(authority.issuedAt, "production_backup_authority_time_invalid");
  const expiresAt = iso(authority.expiresAt, "production_backup_authority_time_invalid");
  if (authority.version !== "production-backup-authority-v1" || authority.scope !== "production_backup"
      || authority.source !== "operator_protected_one_shot_production_go"
      || typeof authority.generationId !== "string" || !GENERATION.test(authority.generationId)
      || authority.commandId !== "production_backup"
      || authority.commandTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.production_backup
      || issuedAt > expiresAt || expiresAt.getTime() - issuedAt.getTime() > 10 * 60_000
      || !SHA40.test(String(authority.candidateSha)) || authority.databaseRole !== "production"
      || !SHA256.test(String(authority.databaseIdentityFingerprintSha256))
      || authority.task0bEvidencePath !== "task0b-release-freeze.json" || !SHA256.test(String(authority.task0bEvidenceSha256))
      || authority.releaseManifestPath !== "release-manifest.json" || !SHA256.test(String(authority.releaseManifestSha256))
      || authority.releaseManifestOverall !== "ready_for_release"
      || !SHA256.test(String(authority.artifactRootFingerprintSha256)) || authority.explicitGo !== true) {
    throw new Error("production_backup_authority_unverified");
  }
  if (requireFresh && issuedAt > now) throw new Error("production_backup_authority_not_yet_valid");
  if (requireFresh && expiresAt <= now) throw new Error("production_backup_authority_expired");
  return authority as ProductionBackupAuthorityV1;
}

export function validateProductionBackupAuthorization(input: {
  authority: unknown;
  task0bBytes: Buffer;
  manifestBytes: Buffer;
  candidateSha: string;
  observedDatabaseIdentityFingerprintSha256: string;
  observedArtifactRootFingerprintSha256: string;
  evaluatedAt: string;
  requireFresh?: boolean;
  task0bEvaluatedAt?: string;
}): { authority: ProductionBackupAuthorityV1; task0b: Task0BReleaseFreezeEvidenceV1; manifest: RemediationReleaseManifestV1 } {
  const authority = validateProductionBackupAuthority(input.authority, input.evaluatedAt, input.requireFresh ?? true);
  const task0b = validateTask0BReleaseFreezeEvidence(
    JSON.parse(input.task0bBytes.toString("utf8")), input.candidateSha, input.task0bEvaluatedAt ?? input.evaluatedAt
  );
  const manifest = validateRemediationReleaseManifest(JSON.parse(input.manifestBytes.toString("utf8")));
  const gates = new Map(manifest.gates.map((gate) => [gate.id, gate.state]));
  if (authority.candidateSha !== input.candidateSha || task0b.candidateSha !== input.candidateSha
      || manifest.candidateSha !== input.candidateSha || manifest.overall !== "ready_for_release"
      || authority.task0bEvidenceSha256 !== hash(input.task0bBytes)
      || authority.releaseManifestSha256 !== hash(input.manifestBytes)
      || authority.databaseIdentityFingerprintSha256 !== input.observedDatabaseIdentityFingerprintSha256
      || task0b.productionDatabase.approvedIdentityFingerprintSha256 !== input.observedDatabaseIdentityFingerprintSha256
      || authority.artifactRootFingerprintSha256 !== input.observedArtifactRootFingerprintSha256
      || task0b.artifactRoot.rootFingerprintSha256 !== input.observedArtifactRootFingerprintSha256
      || [...gates.entries()].some(([id, state]) => /^G(?:0\d|1[01])_/u.test(id) && state !== "passed")
      || ["G12_PRODUCTION_BACKUP", "G13_PRODUCTION_MIGRATION", "G14_PRODUCTION_ROLLOUT", "G15_PRODUCTION_CANARY"]
        .some((id) => gates.get(id as any) !== "pending")) {
    throw new Error("production_backup_binding_unverified");
  }
  return { authority, task0b, manifest };
}

function dockerExecutable(): string {
  return process.platform === "win32"
    ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe"
    : "/usr/bin/docker";
}

function safeChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "ComSpec", "COMSPEC"]
      .flatMap((key) => source[key] === undefined ? [] : [[key, source[key]!]])
  );
}

function parseProductionUrl(databaseUrl: string): { port: number; username: string; password: string } {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("production_backup_database_url_invalid"); }
  const port = Number(parsed.port || 5432);
  let username: string;
  let password: string;
  let databaseName: string;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch { throw new Error("production_backup_database_url_invalid"); }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol) || parsed.hostname !== "127.0.0.1"
      || databaseName !== "tron_watch" || parsed.search || parsed.hash
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535 || !username || !password
      || /[\0\r\n]/u.test(username) || /[\0\r\n]/u.test(password)) {
    throw new Error("production_backup_database_url_invalid");
  }
  return { port, username, password };
}

export function buildProductionPgDumpInvocation(input: {
  imageId: string;
  containerName: string;
  databaseUrl: string;
  snapshotId: string;
}, sourceEnv: NodeJS.ProcessEnv = process.env): Invocation {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.imageId) || !GENERATION.test(input.containerName.replace(/^plan5-g12-/u, ""))
      || !SNAPSHOT.test(input.snapshotId)) throw new Error("production_backup_docker_binding_invalid");
  const database = parseProductionUrl(input.databaseUrl);
  return {
    executable: dockerExecutable(),
    args: [
      "run", "--interactive", "--name", input.containerName, "--rm", "--network", "bridge",
      "--add-host", "host.docker.internal:host-gateway", "--pull", "never",
      "--entrypoint", "/bin/sh", input.imageId, "-ceu", PASSWORD_WRAPPER, "plan5-pg-dump",
      "/usr/local/bin/pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--no-password",
      "--lock-wait-timeout=30000", "--host", "host.docker.internal", "--port", String(database.port),
      "--username", database.username, "--dbname", "tron_watch", "--snapshot", input.snapshotId
    ],
    env: safeChildEnv(sourceEnv),
    stdin: Buffer.from(`${database.password}\n`, "utf8"),
    containerName: input.containerName
  };
}

export function buildProductionPgRestoreListInvocation(
  root: string,
  tools: Pick<Task0BReleaseFreezeEvidenceV1["postgresTools"], "provider">,
  containerName = `plan5-g12-restore-list-${randomBytes(8).toString("hex")}`
): Omit<Invocation, "stdin"> {
  if (!isAbsolute(root) || /[\0\r\n,]/u.test(root)
      || !/^sha256:[0-9a-f]{64}$/u.test(tools.provider.immutableImageId)
      || !/^plan5-g12-[a-z0-9-]{8,100}$/u.test(containerName)) {
    throw new Error("production_backup_docker_binding_invalid");
  }
  return {
    executable: dockerExecutable(),
    args: [
      "run", "--name", containerName, "--rm", "--network", "none", "--pull", "never",
      "--mount", `type=bind,source=${root},target=/artifacts,readonly`,
      "--entrypoint", "/usr/local/bin/pg_restore", tools.provider.immutableImageId,
      "--list", `/artifacts/${BACKUP_FILENAME}`
    ],
    env: safeChildEnv(process.env),
    containerName
  };
}

export function validateProductionBackupConsumptionState(
  value: unknown,
  expected: ExpectedConsumption,
  evaluatedAt: string,
  requireFresh = true
): ProductionBackupConsumptionV1 {
  assertNoSecretLikeArtifactValues(value);
  const consumption = record(value, "production_backup_consumption_invalid");
  exactKeys(consumption, [
    "version", "generationId", "authoritySha256", "candidateSha", "databaseIdentityFingerprintSha256",
    "artifactRootFingerprintSha256", "claimedAt", "expiresAt"
  ], "production_backup_consumption_invalid");
  const now = iso(evaluatedAt, "production_backup_consumption_invalid");
  const claimedAt = iso(consumption.claimedAt, "production_backup_consumption_invalid");
  const expiresAt = iso(consumption.expiresAt, "production_backup_consumption_invalid");
  if (consumption.version !== "production-backup-authority-consumption-v1"
      || typeof consumption.generationId !== "string" || !GENERATION.test(consumption.generationId)
      || !SHA256.test(String(consumption.authoritySha256)) || !SHA40.test(String(consumption.candidateSha))
      || !SHA256.test(String(consumption.databaseIdentityFingerprintSha256))
      || !SHA256.test(String(consumption.artifactRootFingerprintSha256))
      || consumption.generationId !== expected.generationId || consumption.authoritySha256 !== expected.authoritySha256
      || consumption.candidateSha !== expected.candidateSha
      || consumption.databaseIdentityFingerprintSha256 !== expected.databaseIdentityFingerprintSha256
      || consumption.artifactRootFingerprintSha256 !== expected.artifactRootFingerprintSha256
      || consumption.expiresAt !== expected.expiresAt || claimedAt > now || claimedAt >= expiresAt) {
    throw new Error("production_backup_consumption_mismatch");
  }
  if (requireFresh && now >= expiresAt) throw new Error("production_backup_consumption_expired");
  return consumption as ProductionBackupConsumptionV1;
}

async function readOptionalProtectedRegularFile(root: string, filename: string, maxBytes: number): Promise<Buffer | null> {
  try { await lstat(join(root, filename)); } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return readProtectedRegularFile(root, filename, maxBytes);
}

export async function claimProductionBackupAuthority(
  root: string,
  expected: ExpectedConsumption,
  claimedAt: string
): Promise<"claimed" | "resumed"> {
  if (!GENERATION.test(expected.generationId)) throw new Error("production_backup_consumption_invalid");
  const filename = `production-backup-authority-consumed-${expected.generationId}.json`;
  const existing = await readOptionalProtectedRegularFile(root, filename, MAX_ARTIFACT_BYTES);
  if (existing) {
    validateProductionBackupConsumptionState(JSON.parse(existing.toString("utf8")), expected, claimedAt);
    return "resumed";
  }
  const consumption: ProductionBackupConsumptionV1 = {
    version: "production-backup-authority-consumption-v1",
    ...expected,
    claimedAt
  };
  validateProductionBackupConsumptionState(consumption, expected, claimedAt);
  const bytes = Buffer.from(`${JSON.stringify(consumption)}\n`, "utf8");
  try {
    await writeExclusive(root, filename, bytes);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error("production_backup_consumption_concurrent");
    }
    throw error;
  }
  return "claimed";
}

export async function inspectProductionBackupPartialState(root: string): Promise<{ dump: boolean; list: boolean }> {
  const dumpMetadata = await lstat(join(root, BACKUP_FILENAME)).catch((error) => {
    if (isMissing(error)) return null;
    throw error;
  });
  const listMetadata = await lstat(join(root, LIST_FILENAME)).catch((error) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (dumpMetadata && (!dumpMetadata.isFile() || dumpMetadata.isSymbolicLink())) throw new Error("production_backup_partial_artifact_invalid");
  if (listMetadata && (!listMetadata.isFile() || listMetadata.isSymbolicLink())) throw new Error("production_backup_partial_artifact_invalid");
  if (dumpMetadata) {
    await stableFile(join(root, BACKUP_FILENAME), MAX_BACKUP_BYTES);
    const handle = await open(join(root, BACKUP_FILENAME), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const header = Buffer.alloc(5);
      if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length || header.toString("ascii") !== "PGDMP") {
        throw new Error("production_backup_custom_dump_invalid");
      }
    } finally { await handle.close(); }
  }
  if (listMetadata) {
    const list = await stableFile(join(root, LIST_FILENAME), MAX_LIST_BYTES, true);
    const normalized = normalizeProductionRestoreList(list.content!);
    if (!normalized.bytes.equals(list.content!)) throw new Error("production_backup_restore_list_invalid");
  }
  return { dump: dumpMetadata !== null, list: listMetadata !== null };
}

function validateProgressBinding(
  value: Record<string, unknown>,
  binding: ProductionBackupProgressBinding,
  evaluatedAt: string,
  code: string
): void {
  const recordedAt = iso(value.recordedAt, code);
  const now = iso(evaluatedAt, code);
  const expiresAt = iso(binding.expiresAt, code);
  if (value.generationId !== binding.generationId || value.authoritySha256 !== binding.authoritySha256
      || value.claimSha256 !== binding.claimSha256 || value.candidateSha !== binding.candidateSha
      || value.databaseIdentityFingerprintSha256 !== binding.databaseIdentityFingerprintSha256
      || value.artifactRootFingerprintSha256 !== binding.artifactRootFingerprintSha256
      || value.expiresAt !== binding.expiresAt || !OPERATION_ID.test(String(value.operationId))
      || recordedAt > now || recordedAt >= expiresAt) throw new Error(code);
}

function validateDumpProgress(
  value: unknown,
  binding: ProductionBackupProgressBinding,
  evaluatedAt: string
): ProductionBackupDumpProgressV1 {
  assertNoSecretLikeArtifactValues(value);
  const progress = record(value, "production_backup_dump_progress_invalid");
  exactKeys(progress, [
    "version", "generationId", "authoritySha256", "claimSha256", "candidateSha",
    "databaseIdentityFingerprintSha256", "artifactRootFingerprintSha256", "expiresAt", "operationId", "recordedAt",
    "backupFilename", "backupBytes", "backupSha256", "backupPathFingerprintSha256"
  ], "production_backup_dump_progress_invalid");
  validateProgressBinding(progress, binding, evaluatedAt, "production_backup_dump_progress_invalid");
  if (progress.version !== "production-backup-dump-progress-v1" || progress.backupFilename !== BACKUP_FILENAME
      || !Number.isSafeInteger(progress.backupBytes) || Number(progress.backupBytes) <= 0
      || !SHA256.test(String(progress.backupSha256)) || !SHA256.test(String(progress.backupPathFingerprintSha256))) {
    throw new Error("production_backup_dump_progress_invalid");
  }
  return progress as ProductionBackupDumpProgressV1;
}

function validateListProgress(
  value: unknown,
  binding: ProductionBackupProgressBinding,
  evaluatedAt: string
): ProductionBackupListProgressV1 {
  assertNoSecretLikeArtifactValues(value);
  const progress = record(value, "production_backup_list_progress_invalid");
  exactKeys(progress, [
    "version", "generationId", "authoritySha256", "claimSha256", "candidateSha",
    "databaseIdentityFingerprintSha256", "artifactRootFingerprintSha256", "expiresAt", "operationId", "recordedAt",
    "dumpProgressSha256", "restoreListFilename", "restoreListBytes", "restoreListSha256", "restoreListEntryCount"
  ], "production_backup_list_progress_invalid");
  validateProgressBinding(progress, binding, evaluatedAt, "production_backup_list_progress_invalid");
  if (progress.version !== "production-backup-list-progress-v1" || !SHA256.test(String(progress.dumpProgressSha256))
      || progress.restoreListFilename !== LIST_FILENAME || !Number.isSafeInteger(progress.restoreListBytes)
      || Number(progress.restoreListBytes) <= 0 || !SHA256.test(String(progress.restoreListSha256))
      || !Number.isSafeInteger(progress.restoreListEntryCount) || Number(progress.restoreListEntryCount) <= 0) {
    throw new Error("production_backup_list_progress_invalid");
  }
  return progress as ProductionBackupListProgressV1;
}

export async function validateProductionBackupProgress(
  root: string,
  binding: ProductionBackupProgressBinding,
  evaluatedAt: string
): Promise<{ dump: ProductionBackupDumpProgressV1 | null; list: ProductionBackupListProgressV1 | null }> {
  if (!SHA256.test(binding.claimSha256)) throw new Error("production_backup_progress_binding_invalid");
  const partial = await inspectProductionBackupPartialState(root);
  const dumpProgressBytes = await readOptionalProtectedRegularFile(root, dumpProgressFilename(binding.generationId), MAX_ARTIFACT_BYTES);
  const listProgressBytes = await readOptionalProtectedRegularFile(root, listProgressFilename(binding.generationId), MAX_ARTIFACT_BYTES);
  if (partial.dump !== (dumpProgressBytes !== null) || partial.list !== (listProgressBytes !== null)) {
    throw new Error("production_backup_progress_ownership_unverified");
  }
  let dumpProgress: ProductionBackupDumpProgressV1 | null = null;
  if (dumpProgressBytes) {
    dumpProgress = validateDumpProgress(JSON.parse(dumpProgressBytes.toString("utf8")), binding, evaluatedAt);
    const dump = await stableFile(join(root, BACKUP_FILENAME), MAX_BACKUP_BYTES);
    if (dump.bytes !== dumpProgress.backupBytes || dump.sha256 !== dumpProgress.backupSha256
        || schema032BackupPathFingerprint(root, BACKUP_FILENAME) !== dumpProgress.backupPathFingerprintSha256) {
      throw new Error("production_backup_progress_ownership_unverified");
    }
  }
  let listProgress: ProductionBackupListProgressV1 | null = null;
  if (listProgressBytes) {
    if (!dumpProgressBytes || !dumpProgress) throw new Error("production_backup_progress_ownership_unverified");
    listProgress = validateListProgress(JSON.parse(listProgressBytes.toString("utf8")), binding, evaluatedAt);
    const list = await stableFile(join(root, LIST_FILENAME), MAX_LIST_BYTES, true);
    const normalized = normalizeProductionRestoreList(list.content!);
    if (listProgress.dumpProgressSha256 !== hash(dumpProgressBytes) || list.bytes !== listProgress.restoreListBytes
        || list.sha256 !== listProgress.restoreListSha256 || normalized.entryCount !== listProgress.restoreListEntryCount) {
      throw new Error("production_backup_progress_ownership_unverified");
    }
  }
  return { dump: dumpProgress, list: listProgress };
}

export async function recordProductionBackupDumpProgress(
  root: string,
  binding: ProductionBackupProgressBinding,
  operationId: string,
  recordedAt: string
): Promise<ProductionBackupDumpProgressV1> {
  if (!OPERATION_ID.test(operationId)) throw new Error("production_backup_dump_progress_invalid");
  const partial = await inspectProductionBackupPartialState(root);
  if (!partial.dump || partial.list) throw new Error("production_backup_dump_progress_invalid");
  const dump = await stableFile(join(root, BACKUP_FILENAME), MAX_BACKUP_BYTES);
  const progress: ProductionBackupDumpProgressV1 = {
    version: "production-backup-dump-progress-v1", ...binding, operationId, recordedAt,
    backupFilename: BACKUP_FILENAME, backupBytes: dump.bytes, backupSha256: dump.sha256,
    backupPathFingerprintSha256: schema032BackupPathFingerprint(root, BACKUP_FILENAME)
  };
  validateDumpProgress(progress, binding, recordedAt);
  await writeExclusive(root, dumpProgressFilename(binding.generationId), Buffer.from(`${JSON.stringify(progress)}\n`),
    `.production-backup-${operationId}.dump-progress.tmp`);
  return progress;
}

export async function recordProductionBackupListProgress(
  root: string,
  binding: ProductionBackupProgressBinding,
  operationId: string,
  recordedAt: string
): Promise<ProductionBackupListProgressV1> {
  if (!OPERATION_ID.test(operationId)) throw new Error("production_backup_list_progress_invalid");
  const partial = await inspectProductionBackupPartialState(root);
  if (!partial.dump || !partial.list
      || await readOptionalProtectedRegularFile(root, listProgressFilename(binding.generationId), MAX_ARTIFACT_BYTES)) {
    throw new Error("production_backup_list_progress_invalid");
  }
  const dumpProgressBytes = await readProtectedRegularFile(root, dumpProgressFilename(binding.generationId), MAX_ARTIFACT_BYTES);
  const dumpProgress = validateDumpProgress(JSON.parse(dumpProgressBytes.toString("utf8")), binding, recordedAt);
  const dump = await stableFile(join(root, BACKUP_FILENAME), MAX_BACKUP_BYTES);
  if (dump.bytes !== dumpProgress.backupBytes || dump.sha256 !== dumpProgress.backupSha256
      || schema032BackupPathFingerprint(root, BACKUP_FILENAME) !== dumpProgress.backupPathFingerprintSha256) {
    throw new Error("production_backup_progress_ownership_unverified");
  }
  const list = await stableFile(join(root, LIST_FILENAME), MAX_LIST_BYTES, true);
  const normalized = normalizeProductionRestoreList(list.content!);
  const progress: ProductionBackupListProgressV1 = {
    version: "production-backup-list-progress-v1", ...binding, operationId, recordedAt,
    dumpProgressSha256: hash(dumpProgressBytes), restoreListFilename: LIST_FILENAME, restoreListBytes: list.bytes,
    restoreListSha256: list.sha256, restoreListEntryCount: normalized.entryCount
  };
  validateListProgress(progress, binding, recordedAt);
  await writeExclusive(root, listProgressFilename(binding.generationId), Buffer.from(`${JSON.stringify(progress)}\n`),
    `.production-backup-${operationId}.list-progress.tmp`);
  return progress;
}

export async function executeProductionBackupStateMachine<T extends Buffer>(authority: ProductionBackupAuthorityV1, dependencies: {
  now(): string;
  readCompletedEvidence(): Promise<T | null>;
  claim(): Promise<void>;
  hasClaim(): Promise<boolean>;
  acquireOperation(): Promise<{ operationId: string; release(): Promise<void> }>;
  inspectPartial(): Promise<{ dump: boolean; list: boolean }>;
  validatePartialProgress(partial: { dump: boolean; list: boolean }, operationId: string): Promise<void>;
  dump(operationId: string): Promise<void>;
  recordDumpProgress(operationId: string): Promise<void>;
  list(operationId: string): Promise<void>;
  recordListProgress(operationId: string): Promise<void>;
  attest(): Promise<void>;
  buildEvidence(): Promise<T>;
  writeEvidence(bytes: T): Promise<void>;
}): Promise<T> {
  const completed = await dependencies.readCompletedEvidence();
  if (completed) {
    await dependencies.attest();
    return completed;
  }
  validateProductionBackupAuthority(authority, dependencies.now());
  const hasClaim = await dependencies.hasClaim();
  if (!hasClaim) {
    const beforeClaim = await dependencies.inspectPartial();
    if (beforeClaim.dump || beforeClaim.list) throw new Error("production_backup_unconsumed_partial_state");
    await dependencies.claim();
  }
  const operation = await dependencies.acquireOperation();
  try {
    const completedAfterLease = await dependencies.readCompletedEvidence();
    if (completedAfterLease) {
      await dependencies.attest();
      return completedAfterLease;
    }
    const partial = await dependencies.inspectPartial();
    if (partial.list && !partial.dump) throw new Error("production_backup_partial_state_invalid");
    await dependencies.validatePartialProgress(partial, operation.operationId);
    if (!partial.dump) {
      await dependencies.dump(operation.operationId);
      await dependencies.recordDumpProgress(operation.operationId);
    }
    if (!partial.list) {
      await dependencies.list(operation.operationId);
      await dependencies.recordListProgress(operation.operationId);
    }
    await dependencies.attest();
    const evidence = await dependencies.buildEvidence();
    await dependencies.writeEvidence(evidence);
    return evidence;
  } finally { await operation.release(); }
}

async function terminateChildTree(child: ChildProcess, containerName?: string): Promise<void> {
  if (containerName) spawnSync(dockerExecutable(), ["rm", "--force", containerName], {
    env: safeChildEnv(process.env), windowsHide: true, stdio: "ignore", timeout: 10_000
  });
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

async function runDockerBuffer(args: string[], maxBytes: number, timeoutMs = 120_000, containerName?: string): Promise<Buffer> {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(dockerExecutable(), args, {
      cwd: repositoryRoot, env: safeChildEnv(process.env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = false;
    const timer = setTimeout(() => { failed = true; void terminateChildTree(child, containerName); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) { failed = true; void terminateChildTree(child, containerName); }
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > MAX_ARTIFACT_BYTES) { failed = true; void terminateChildTree(child); } });
    child.once("error", () => { failed = true; });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      if (failed || status !== 0 || signal || stderrBytes !== 0) rejectOutput(new Error("production_backup_docker_command_failed"));
      else resolveOutput(Buffer.concat(stdout, stdoutBytes));
    });
  });
}

function validateOperationLease(
  value: unknown,
  binding: ProductionBackupProgressBinding,
  evaluatedAt: string
): ProductionBackupOperationLeaseV1 {
  assertNoSecretLikeArtifactValues(value);
  const lease = record(value, "production_backup_operation_lease_invalid");
  exactKeys(lease, [
    "version", "generationId", "authoritySha256", "claimSha256", "candidateSha",
    "databaseIdentityFingerprintSha256", "artifactRootFingerprintSha256", "expiresAt", "operationId",
    "ownerProcessId", "acquiredAt", "dumpContainerName", "restoreContainerName"
  ], "production_backup_operation_lease_invalid");
  const acquiredAt = iso(lease.acquiredAt, "production_backup_operation_lease_invalid");
  const now = iso(evaluatedAt, "production_backup_operation_lease_invalid");
  const expiresAt = iso(binding.expiresAt, "production_backup_operation_lease_invalid");
  if (lease.version !== "production-backup-operation-lease-v1" || lease.generationId !== binding.generationId
      || lease.authoritySha256 !== binding.authoritySha256 || lease.claimSha256 !== binding.claimSha256
      || lease.candidateSha !== binding.candidateSha
      || lease.databaseIdentityFingerprintSha256 !== binding.databaseIdentityFingerprintSha256
      || lease.artifactRootFingerprintSha256 !== binding.artifactRootFingerprintSha256
      || lease.expiresAt !== binding.expiresAt || !OPERATION_ID.test(String(lease.operationId))
      || !Number.isSafeInteger(lease.ownerProcessId) || Number(lease.ownerProcessId) < 1
      || acquiredAt > now || acquiredAt >= expiresAt
      || lease.dumpContainerName !== `plan5-g12-${lease.operationId}-dump`
      || lease.restoreContainerName !== `plan5-g12-${lease.operationId}-restore`) {
    throw new Error("production_backup_operation_lease_invalid");
  }
  return lease as ProductionBackupOperationLeaseV1;
}

async function removeExactDockerContainer(containerName: string): Promise<void> {
  const listed = spawnSync(dockerExecutable(), [
    "ps", "-a", "--format", "{{.Names}}", "--filter", `name=^/${containerName}$`
  ], { env: safeChildEnv(process.env), encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (listed.status !== 0 || listed.signal || listed.error) throw new Error("production_backup_operation_cleanup_failed");
  const names = String(listed.stdout).trim().split(/\r?\n/u).filter(Boolean);
  if (names.some((name) => name !== containerName)) throw new Error("production_backup_operation_cleanup_failed");
  if (names.length === 0) return;
  const removed = spawnSync(dockerExecutable(), ["rm", "--force", containerName], {
    env: safeChildEnv(process.env), encoding: "utf8", windowsHide: true, timeout: 10_000
  });
  if (removed.status !== 0 || removed.signal || removed.error) throw new Error("production_backup_operation_cleanup_failed");
}

async function removeOwnedRegularFile(root: string, filename: string): Promise<void> {
  const path = join(root, filename);
  const metadata = await lstat(path).catch((error) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (!metadata) return;
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("production_backup_operation_cleanup_failed");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new Error("production_backup_operation_cleanup_failed");
    }
  } finally { await handle.close(); }
  await unlink(path);
}

async function cleanupProductionBackupOperation(
  root: string,
  lease: ProductionBackupOperationLeaseV1,
  removeContainer: (containerName: string) => Promise<void>
): Promise<void> {
  await removeContainer(lease.dumpContainerName);
  await removeContainer(lease.restoreContainerName);
  for (const suffix of ["dump.tmp", "list.tmp", "dump-progress.tmp", "list-progress.tmp", "evidence.tmp"] as const) {
    await removeOwnedRegularFile(root, `.production-backup-${lease.operationId}.${suffix}`);
  }
  const dumpProgress = await readOptionalProtectedRegularFile(root, dumpProgressFilename(lease.generationId), MAX_ARTIFACT_BYTES);
  const listProgress = await readOptionalProtectedRegularFile(root, listProgressFilename(lease.generationId), MAX_ARTIFACT_BYTES);
  if (listProgress && !dumpProgress) throw new Error("production_backup_operation_cleanup_failed");
  if (!listProgress) await removeOwnedRegularFile(root, LIST_FILENAME);
  if (!dumpProgress) await removeOwnedRegularFile(root, BACKUP_FILENAME);
}

function processIsAlive(processId: number): boolean {
  try { process.kill(processId, 0); return true; } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
}

export async function acquireProductionBackupOperationLease(
  root: string,
  binding: ProductionBackupProgressBinding,
  evaluatedAt: string,
  dependencies: {
    ownerProcessId?: number;
    isProcessAlive?(processId: number): Promise<boolean>;
    removeContainer?(containerName: string): Promise<void>;
  } = {}
): Promise<{ lease: ProductionBackupOperationLeaseV1; operationId: string; release(): Promise<void> }> {
  const expectedConsumption: ExpectedConsumption = binding;
  const claimBytes = await readProtectedRegularFile(root, claimFilename(binding.generationId), MAX_ARTIFACT_BYTES);
  if (hash(claimBytes) !== binding.claimSha256) throw new Error("production_backup_progress_binding_invalid");
  validateProductionBackupConsumptionState(JSON.parse(claimBytes.toString("utf8")), expectedConsumption, evaluatedAt);
  const filename = leaseFilename(binding.generationId);
  const removeContainer = dependencies.removeContainer ?? removeExactDockerContainer;
  const existingBytes = await readOptionalProtectedRegularFile(root, filename, MAX_ARTIFACT_BYTES);
  if (existingBytes) {
    const existing = validateOperationLease(JSON.parse(existingBytes.toString("utf8")), binding, evaluatedAt);
    const alive = await (dependencies.isProcessAlive
      ? dependencies.isProcessAlive(existing.ownerProcessId)
      : Promise.resolve(processIsAlive(existing.ownerProcessId)));
    if (alive) throw new Error("production_backup_operation_concurrent");
    await cleanupProductionBackupOperation(root, existing, removeContainer);
    const unchanged = await readProtectedRegularFile(root, filename, MAX_ARTIFACT_BYTES);
    if (!unchanged.equals(existingBytes)) throw new Error("production_backup_operation_lease_changed");
    await unlink(join(root, filename));
  }
  const operationId = randomBytes(16).toString("hex");
  const ownerProcessId = dependencies.ownerProcessId ?? process.pid;
  const lease: ProductionBackupOperationLeaseV1 = {
    version: "production-backup-operation-lease-v1", ...binding, operationId, ownerProcessId,
    acquiredAt: evaluatedAt, dumpContainerName: `plan5-g12-${operationId}-dump`,
    restoreContainerName: `plan5-g12-${operationId}-restore`
  };
  validateOperationLease(lease, binding, evaluatedAt);
  const leaseBytes = Buffer.from(`${JSON.stringify(lease)}\n`, "utf8");
  try {
    await writeExclusive(root, filename, leaseBytes, `.production-backup-${operationId}.lease.tmp`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error("production_backup_operation_concurrent");
    }
    throw error;
  }
  let released = false;
  return {
    lease,
    operationId,
    release: async () => {
      if (released) return;
      await cleanupProductionBackupOperation(root, lease, removeContainer);
      const current = await readProtectedRegularFile(root, filename, MAX_ARTIFACT_BYTES);
      if (!current.equals(leaseBytes)) throw new Error("production_backup_operation_lease_changed");
      await unlink(join(root, filename));
      released = true;
    }
  };
}

export async function attestProductionPostgresTools(tools: Task0BReleaseFreezeEvidenceV1["postgresTools"]): Promise<void> {
  const imageId = tools.provider.immutableImageId;
  const inspected = (await runDockerBuffer(["image", "inspect", imageId, "--format", "{{.Id}}"], 256)).toString("utf8").trim();
  if (inspected !== imageId) throw new Error("production_backup_docker_image_changed");
  for (const [name, expected] of [["pg_dump", tools.pgDump], ["pg_restore", tools.pgRestore]] as const) {
    const digestContainer = `plan5-g12-tool-${randomBytes(8).toString("hex")}`;
    const digest = (await runDockerBuffer([
      "run", "--name", digestContainer, "--rm", "--network", "none", "--pull", "never", "--entrypoint", "/usr/bin/sha256sum",
      imageId, `/usr/local/bin/${name}`
    ], 1024, 120_000, digestContainer)).toString("utf8").trim().split(/\s+/u)[0];
    const versionContainer = `plan5-g12-tool-${randomBytes(8).toString("hex")}`;
    const version = (await runDockerBuffer([
      "run", "--name", versionContainer, "--rm", "--network", "none", "--pull", "never", "--entrypoint", `/usr/local/bin/${name}`,
      imageId, "--version"
    ], 1024, 120_000, versionContainer)).toString("utf8").trim();
    if (digest !== expected.executableIdentitySha256 || version !== expected.version) {
      throw new Error("production_backup_postgres_tool_changed");
    }
  }
}

async function stableFile(path: string, maxBytes: number, capture = false): Promise<{ bytes: number; sha256: string; content?: Buffer }> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maxBytes) throw new Error("production_backup_file_invalid");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("production_backup_file_changed");
    const digest = createHash("sha256");
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead <= 0) throw new Error("production_backup_file_changed");
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      digest.update(chunk);
      if (capture) chunks.push(chunk);
      position += bytesRead;
    }
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("production_backup_file_changed");
    return { bytes: opened.size, sha256: digest.digest("hex"), content: capture ? Buffer.concat(chunks) : undefined };
  } finally { await handle.close(); }
}

async function writeExclusive(root: string, filename: string, bytes: Buffer, temporaryFilename?: string): Promise<void> {
  if (temporaryFilename && (temporaryFilename.includes("/") || temporaryFilename.includes("\\"))) {
    throw new Error("production_backup_temporary_filename_invalid");
  }
  const temporary = join(root, temporaryFilename ?? `.${filename}.${randomBytes(12).toString("hex")}.tmp`);
  const target = join(root, filename);
  const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, target);
  } finally { await unlink(temporary).catch(() => undefined); }
}

export async function writeProductionDump(
  root: string,
  invocation: Invocation,
  containerName: string,
  timeoutMs = CHILD_TIMEOUT_MS,
  operationId?: string
): Promise<void> {
  if (operationId !== undefined && !OPERATION_ID.test(operationId)) throw new Error("production_backup_operation_id_invalid");
  const temporary = join(root, operationId
    ? `.production-backup-${operationId}.dump.tmp`
    : `.production-backup-${randomBytes(12).toString("hex")}.dump.tmp`);
  const target = join(root, BACKUP_FILENAME);
  const handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: repositoryRoot, env: invocation.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    let bytes = 0;
    let stderrBytes = 0;
    let failed = false;
    let writeChain = Promise.resolve();
    const timer = setTimeout(() => { failed = true; void terminateChildTree(child, containerName); }, timeoutMs);
    child.stdin.end(invocation.stdin);
    child.stdout.on("data", (chunk: Buffer) => {
      child.stdout.pause();
      bytes += chunk.length;
      if (bytes > MAX_BACKUP_BYTES) { failed = true; void terminateChildTree(child, containerName); return; }
      writeChain = writeChain.then(async () => {
        try { await handle.write(chunk); } finally { child.stdout.resume(); }
      });
    });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > MAX_ARTIFACT_BYTES) { failed = true; void terminateChildTree(child, containerName); } });
    await new Promise<void>((resolveDone, rejectDone) => {
      child.once("error", () => { failed = true; rejectDone(new Error("production_backup_pg_dump_failed")); });
      child.once("close", async (status, signal) => {
        clearTimeout(timer);
        await writeChain.catch(() => { failed = true; });
        if (failed || status !== 0 || signal || stderrBytes !== 0 || bytes <= 0) rejectDone(new Error("production_backup_pg_dump_failed"));
        else resolveDone();
      });
    });
    await handle.sync();
    const header = Buffer.alloc(5);
    if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length || header.toString("ascii") !== "PGDMP") {
      throw new Error("production_backup_custom_dump_invalid");
    }
    await handle.close();
    await link(temporary, target);
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export function normalizeProductionRestoreList(bytes: Buffer): { bytes: Buffer; entryCount: number } {
  if (bytes.length <= 0 || bytes.length > MAX_LIST_BYTES) throw new Error("production_backup_restore_list_invalid");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("production_backup_restore_list_invalid"); }
  if (text.includes("\0") || /\r(?!\n)/u.test(text)) throw new Error("production_backup_restore_list_invalid");
  const normalized = `${text.replace(/\r\n/gu, "\n").trimEnd()}\n`;
  const entryCount = normalized.split("\n").filter((line) => line.trim() !== "" && !line.startsWith(";")).length;
  if (entryCount < 1) throw new Error("production_backup_restore_list_invalid");
  return { bytes: Buffer.from(normalized, "utf8"), entryCount };
}

export async function writeProductionRestoreList(
  root: string,
  tools: Task0BReleaseFreezeEvidenceV1["postgresTools"],
  containerName?: string,
  operationId?: string
): Promise<void> {
  if (operationId !== undefined && !OPERATION_ID.test(operationId)) throw new Error("production_backup_operation_id_invalid");
  const invocation = buildProductionPgRestoreListInvocation(root, tools, containerName);
  const raw = await runDockerBuffer(invocation.args, MAX_LIST_BYTES, 120_000, invocation.containerName);
  await writeExclusive(root, LIST_FILENAME, normalizeProductionRestoreList(raw).bytes,
    operationId ? `.production-backup-${operationId}.list.tmp` : undefined);
}

export async function observeProductionDatabase(databaseUrl: string, beginSnapshot = false): Promise<{
  client: Client;
  identityFingerprintSha256: string;
  snapshotId?: string;
}> {
  const parsed = parseProductionUrl(databaseUrl);
  const client = new Client({
    host: "127.0.0.1", port: parsed.port, database: "tron_watch", user: parsed.username, password: parsed.password,
    application_name: "plan5_g12_production_backup", connectionTimeoutMillis: 5_000, statement_timeout: 10_000, query_timeout: 10_000
  });
  await client.connect();
  try {
    if (beginSnapshot) await client.query("begin isolation level repeatable read read only");
    else await client.query("begin read only");
    const identity = await client.query(`select current_database() as database_name,
      inet_server_port() as server_port, current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid`);
    const control = await client.query("select system_identifier::text as system_identifier from pg_control_system()");
    const row = identity.rows[0];
    const fingerprint = buildTask0BProductionDatabaseIdentityFingerprint({
      databaseName: "tron_watch", endpointHost: "127.0.0.1", endpointPort: parsed.port,
      connectedServerPort: Number(row?.server_port), systemIdentifier: String(control.rows[0]?.system_identifier ?? ""),
      databaseOid: String(row?.database_oid ?? ""), serverVersionNum: String(row?.server_version_num ?? "")
    });
    const snapshotId = beginSnapshot ? String((await client.query("select pg_export_snapshot() as snapshot_id")).rows[0]?.snapshot_id ?? "") : undefined;
    if (snapshotId !== undefined && !SNAPSHOT.test(snapshotId)) throw new Error("production_backup_snapshot_invalid");
    return { client, identityFingerprintSha256: fingerprint, snapshotId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
    throw error;
  }
}

export function validateProductionBackupEvidence(value: unknown, authority: ProductionBackupAuthorityV1): ProductionBackupEvidenceV1 {
  assertNoSecretLikeArtifactValues(value);
  const evidence = record(value, "production_backup_evidence_invalid");
  exactKeys(evidence, [
    "version", "candidateSha", "gateId", "commandId", "redactedTemplateSha256", "databaseIdentityFingerprintSha256",
    "backupFilename", "backupBytes", "backupSha256", "backupPathFingerprintSha256", "restoreListFilename", "restoreListBytes",
    "restoreListSha256", "restoreListEntryCount", "state"
  ], "production_backup_evidence_invalid");
  if (evidence.version !== "production-backup-evidence-v1" || evidence.candidateSha !== authority.candidateSha
      || evidence.gateId !== "G12_PRODUCTION_BACKUP" || evidence.commandId !== "production_backup"
      || evidence.redactedTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.production_backup
      || evidence.databaseIdentityFingerprintSha256 !== authority.databaseIdentityFingerprintSha256
      || evidence.backupFilename !== BACKUP_FILENAME || evidence.restoreListFilename !== LIST_FILENAME
      || !Number.isSafeInteger(evidence.backupBytes) || Number(evidence.backupBytes) <= 0 || !SHA256.test(String(evidence.backupSha256))
      || !SHA256.test(String(evidence.backupPathFingerprintSha256)) || !Number.isSafeInteger(evidence.restoreListBytes)
      || Number(evidence.restoreListBytes) <= 0 || !SHA256.test(String(evidence.restoreListSha256))
      || !Number.isSafeInteger(evidence.restoreListEntryCount) || Number(evidence.restoreListEntryCount) <= 0 || evidence.state !== "passed") {
    throw new Error("production_backup_evidence_invalid");
  }
  return evidence as ProductionBackupEvidenceV1;
}

export async function buildProductionBackupEvidence(
  root: string,
  authority: ProductionBackupAuthorityV1
): Promise<ProductionBackupEvidenceV1> {
  const partial = await inspectProductionBackupPartialState(root);
  if (!partial.dump || !partial.list) throw new Error("production_backup_artifacts_incomplete");
  const dump = await stableFile(join(root, BACKUP_FILENAME), MAX_BACKUP_BYTES);
  const list = await stableFile(join(root, LIST_FILENAME), MAX_LIST_BYTES, true);
  const normalized = normalizeProductionRestoreList(list.content!);
  const evidence: ProductionBackupEvidenceV1 = {
    version: "production-backup-evidence-v1",
    candidateSha: authority.candidateSha,
    gateId: "G12_PRODUCTION_BACKUP",
    commandId: "production_backup",
    redactedTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.production_backup,
    databaseIdentityFingerprintSha256: authority.databaseIdentityFingerprintSha256,
    backupFilename: BACKUP_FILENAME,
    backupBytes: dump.bytes,
    backupSha256: dump.sha256,
    backupPathFingerprintSha256: schema032BackupPathFingerprint(root, BACKUP_FILENAME),
    restoreListFilename: LIST_FILENAME,
    restoreListBytes: list.bytes,
    restoreListSha256: list.sha256,
    restoreListEntryCount: normalized.entryCount,
    state: "passed"
  };
  return validateProductionBackupEvidence(evidence, authority);
}

async function currentCandidate(): Promise<{ sha: string; clean: boolean }> {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  return { sha: String(sha.stdout).trim(), clean: sha.status === 0 && status.status === 0 && String(status.stdout) === "" };
}

async function assertNoForeignProductionBackupGeneration(root: string, generationId: string): Promise<void> {
  const patterns = [
    /^production-backup-authority-consumed-(.+)\.json$/u,
    /^production-backup-operation-(.+)\.json$/u,
    /^production-backup-dump-progress-(.+)\.json$/u,
    /^production-backup-list-progress-(.+)\.json$/u
  ];
  for (const filename of await readdir(root)) {
    for (const pattern of patterns) {
      const matched = pattern.exec(filename);
      if (matched && matched[1] !== generationId) throw new Error("production_backup_foreign_generation_recovery_required");
    }
  }
}

export async function runProductionBackupCommand(
  args: string[],
  environment: NodeJS.ProcessEnv,
  dependencies: {
    now?(): string;
    currentCandidate?(): Promise<{ sha: string; clean: boolean }>;
    observeProductionDatabase?: typeof observeProductionDatabase;
    attestProductionPostgresTools?: typeof attestProductionPostgresTools;
    stdout?(value: string): void;
  } = {}
): Promise<void> {
  const [artifactRootInput, authorityFilename] = args;
  if (!artifactRootInput || !authorityFilename || args.length !== 2
      || !/^production-backup-authority-[a-z0-9][a-z0-9-]{15,63}\.json$/u.test(authorityFilename)) {
    throw new Error("production_backup_arguments_invalid");
  }
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observeDatabase = dependencies.observeProductionDatabase ?? observeProductionDatabase;
  const attestTools = dependencies.attestProductionPostgresTools ?? attestProductionPostgresTools;
  const stdout = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const artifactRoot = await inspectRealDirectory(artifactRootInput, true);
  const rootFingerprint = hash(canonicalPathKey(artifactRoot));
  const [authorityBytes, task0bBytes, manifestBytes] = await Promise.all([
    readProtectedRegularFile(artifactRoot, authorityFilename, MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(artifactRoot, "task0b-release-freeze.json", MAX_ARTIFACT_BYTES),
    readProtectedRegularFile(artifactRoot, "release-manifest.json", MAX_ARTIFACT_BYTES)
  ]);
  const authorityValue = JSON.parse(authorityBytes.toString("utf8"));
  const authorityForExisting = validateProductionBackupAuthority(authorityValue, String(authorityValue.issuedAt), false);
  const candidate = await (dependencies.currentCandidate ?? currentCandidate)();
  if (!candidate.clean || candidate.sha !== authorityForExisting.candidateSha) throw new Error("production_backup_candidate_unverified");
  const expectedConsumption: ExpectedConsumption = {
    generationId: authorityForExisting.generationId,
    authoritySha256: hash(authorityBytes),
    candidateSha: candidate.sha,
    databaseIdentityFingerprintSha256: authorityForExisting.databaseIdentityFingerprintSha256,
    artifactRootFingerprintSha256: rootFingerprint,
    expiresAt: authorityForExisting.expiresAt
  };
  const claimPathName = claimFilename(authorityForExisting.generationId);
  const existingEvidenceBytes = await readOptionalProtectedRegularFile(artifactRoot, EVIDENCE_FILENAME, MAX_ARTIFACT_BYTES);
  const rawTask0b = JSON.parse(task0bBytes.toString("utf8"));
  if (existingEvidenceBytes) {
    const validated = validateProductionBackupAuthorization({
      authority: authorityValue,
      task0bBytes,
      manifestBytes,
      candidateSha: candidate.sha,
      observedDatabaseIdentityFingerprintSha256: authorityForExisting.databaseIdentityFingerprintSha256,
      observedArtifactRootFingerprintSha256: rootFingerprint,
      evaluatedAt: String(authorityForExisting.issuedAt),
      requireFresh: false,
      task0bEvaluatedAt: String(rawTask0b.observedAt)
    });
    const evidence = validateProductionBackupEvidence(JSON.parse(existingEvidenceBytes.toString("utf8")), validated.authority);
    const claim = await readOptionalProtectedRegularFile(artifactRoot, claimPathName, MAX_ARTIFACT_BYTES);
    if (!claim) throw new Error("production_backup_consumption_missing");
    validateProductionBackupConsumptionState(JSON.parse(claim.toString("utf8")), expectedConsumption, now(), false);
    await validateProductionBackupProgress(artifactRoot, { ...expectedConsumption, claimSha256: hash(claim) }, now());
    await attestTools(validated.task0b.postgresTools);
    await attestSchema032ProductionBackupFiles(artifactRoot, evidence, validated.task0b.postgresTools);
    stdout(`${JSON.stringify({ status: "already_completed", evidenceSha256: hash(existingEvidenceBytes) })}\n`);
    return;
  }
  const preflightAt = now();
  const preflight = validateProductionBackupAuthorization({
    authority: authorityValue,
    task0bBytes,
    manifestBytes,
    candidateSha: candidate.sha,
    observedDatabaseIdentityFingerprintSha256: authorityForExisting.databaseIdentityFingerprintSha256,
    observedArtifactRootFingerprintSha256: rootFingerprint,
    evaluatedAt: preflightAt
  });
  buildProductionPgRestoreListInvocation(
    artifactRoot,
    preflight.task0b.postgresTools,
    `plan5-g12-${preflight.authority.generationId}`
  );
  await assertNoForeignProductionBackupGeneration(artifactRoot, preflight.authority.generationId);
  const initialClaim = await readOptionalProtectedRegularFile(artifactRoot, claimPathName, MAX_ARTIFACT_BYTES);
  const claimExists = initialClaim !== null;
  if (initialClaim) {
    validateProductionBackupConsumptionState(JSON.parse(initialClaim.toString("utf8")), expectedConsumption, preflightAt);
    await validateProductionBackupProgress(
      artifactRoot,
      { ...expectedConsumption, claimSha256: hash(initialClaim) },
      preflightAt
    );
  }
  const initialPartial = await inspectProductionBackupPartialState(artifactRoot);
  if (!claimExists && (initialPartial.dump || initialPartial.list)) throw new Error("production_backup_unconsumed_partial_state");
  const databaseUrl = environment.TASK0B_PRODUCTION_DATABASE_URL;
  if (!databaseUrl) throw new Error("production_backup_database_url_missing");
  const snapshot = await observeDatabase(databaseUrl, true);
  try {
    const validated = validateProductionBackupAuthorization({
      authority: authorityValue, task0bBytes, manifestBytes, candidateSha: candidate.sha,
      observedDatabaseIdentityFingerprintSha256: snapshot.identityFingerprintSha256,
      observedArtifactRootFingerprintSha256: rootFingerprint, evaluatedAt: now()
    });
    await attestTools(validated.task0b.postgresTools);
    const readProgressBinding = async (): Promise<ProductionBackupProgressBinding> => {
      const bytes = await readProtectedRegularFile(artifactRoot, claimPathName, MAX_ARTIFACT_BYTES);
      validateProductionBackupConsumptionState(JSON.parse(bytes.toString("utf8")), expectedConsumption, now());
      return { ...expectedConsumption, claimSha256: hash(bytes) };
    };
    let activeLease: ProductionBackupOperationLeaseV1 | undefined;
    const dependencies = {
      now,
      readCompletedEvidence: async () => {
        const bytes = await readOptionalProtectedRegularFile(artifactRoot, EVIDENCE_FILENAME, MAX_ARTIFACT_BYTES);
        if (bytes) validateProductionBackupEvidence(JSON.parse(bytes.toString("utf8")), validated.authority);
        return bytes;
      },
      hasClaim: async () => {
        const bytes = await readOptionalProtectedRegularFile(artifactRoot, claimPathName, MAX_ARTIFACT_BYTES);
        if (!bytes) return false;
        validateProductionBackupConsumptionState(JSON.parse(bytes.toString("utf8")), expectedConsumption, now());
        return true;
      },
      claim: async () => {
        const result = await claimProductionBackupAuthority(artifactRoot, expectedConsumption, now());
        if (result !== "claimed") throw new Error("production_backup_consumption_concurrent");
      },
      acquireOperation: async () => {
        const acquired = await acquireProductionBackupOperationLease(artifactRoot, await readProgressBinding(), now());
        activeLease = acquired.lease;
        return {
          operationId: acquired.operationId,
          release: async () => { try { await acquired.release(); } finally { activeLease = undefined; } }
        };
      },
      inspectPartial: () => inspectProductionBackupPartialState(artifactRoot),
      validatePartialProgress: async (_partial: { dump: boolean; list: boolean }) => {
        await validateProductionBackupProgress(artifactRoot, await readProgressBinding(), now());
      },
      dump: async (operationId: string) => {
        if (!activeLease || activeLease.operationId !== operationId) throw new Error("production_backup_operation_lease_missing");
        await writeProductionDump(artifactRoot, buildProductionPgDumpInvocation({
          imageId: validated.task0b.postgresTools.provider.immutableImageId,
          containerName: activeLease.dumpContainerName, databaseUrl, snapshotId: snapshot.snapshotId!
        }), activeLease.dumpContainerName, CHILD_TIMEOUT_MS, operationId);
      },
      recordDumpProgress: async (operationId: string) => {
        await recordProductionBackupDumpProgress(artifactRoot, await readProgressBinding(), operationId, now());
      },
      list: async (operationId: string) => {
        if (!activeLease || activeLease.operationId !== operationId) throw new Error("production_backup_operation_lease_missing");
        await writeProductionRestoreList(
          artifactRoot, validated.task0b.postgresTools, activeLease.restoreContainerName, operationId
        );
      },
      recordListProgress: async (operationId: string) => {
        await recordProductionBackupListProgress(artifactRoot, await readProgressBinding(), operationId, now());
      },
      attest: async () => {
        const progressBinding = await readProgressBinding();
        await validateProductionBackupProgress(artifactRoot, progressBinding, now());
        const after = await observeDatabase(databaseUrl);
        try {
          if (after.identityFingerprintSha256 !== snapshot.identityFingerprintSha256) throw new Error("production_backup_database_identity_changed");
        } finally { await after.client.query("rollback").catch(() => undefined); await after.client.end().catch(() => undefined); }
        const evidence = await buildProductionBackupEvidence(artifactRoot, validated.authority);
        await attestSchema032ProductionBackupFiles(artifactRoot, evidence, validated.task0b.postgresTools);
      },
      buildEvidence: async () => {
        const evidence = await buildProductionBackupEvidence(artifactRoot, validated.authority);
        return Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8");
      },
      writeEvidence: (bytes: Buffer) => {
        if (!activeLease) throw new Error("production_backup_operation_lease_missing");
        return writeExclusive(
          artifactRoot, EVIDENCE_FILENAME, bytes, `.production-backup-${activeLease.operationId}.evidence.tmp`
        );
      }
    };
    const evidenceBytes = await executeProductionBackupStateMachine(validated.authority, dependencies);
    stdout(`${JSON.stringify({ status: "passed", evidenceSha256: hash(evidenceBytes) })}\n`);
  } finally {
    await snapshot.client.query("rollback").catch(() => undefined);
    await snapshot.client.end().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  runProductionBackupCommand(process.argv.slice(2), process.env).catch(() => {
    process.stderr.write("production_backup_failed\n");
    process.exitCode = 1;
  });
}
