import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../risk/scoringSignalMatrix";
import type { Schema036Verification } from "../storage/schemaMigrations";
import {
  SCHEMA_036_FILENAME,
  SCHEMA_036_VERSION
} from "../storage/schemaMigrations";

type RuntimeSchemaVerification = Schema036Verification;
import type { TelegramForensicResultV1 } from "../telegram/forensicPresentation";
import type { ForensicCoverageV2, ScoreAnchorV2 } from "../types";

type ResultSchemaVersionV1 = `${ScoreAnchorV2["version"]}+${ForensicCoverageV2["version"]}`;
type NarrativeVersionV1 = TelegramForensicResultV1["version"];

const RESULT_SCHEMA_VERSION = "score-anchor-v2+forensic-coverage-v2" satisfies ResultSchemaVersionV1;
const NARRATIVE_VERSION = "telegram-forensic-result-v1" satisfies NarrativeVersionV1;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SECRET_PATTERN = /(?:^|[^a-z])(?:api[_-]?key|bearer|bot[_-]?token|password|postgres(?:ql)?:\/\/|secret)(?:$|[^a-z])/iu;

export type RuntimeVersionV1 = Readonly<{
  version: "runtime-version-v1";
  gitCommitSha: string;
  runtimeInstanceLabel: string;
  scoringPolicyVersion: typeof SCORING_SIGNAL_MATRIX_POLICY_VERSION;
  resultSchemaVersion: ResultSchemaVersionV1;
  narrativeVersion: NarrativeVersionV1;
  migration: Readonly<RuntimeSchemaVerification>;
}>;

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string" || !expected.includes(key))
  ) {
    fail(code);
  }
}

function validateRuntimeLabel(label: unknown, gitCommitSha: string): asserts label is string {
  if (
    typeof label !== "string" ||
    label.length === 0 ||
    label !== label.trim() ||
    CONTROL_CHARACTER_PATTERN.test(label) ||
    SECRET_PATTERN.test(label)
  ) {
    fail("runtime_version_label_invalid");
  }
  const shortSha = gitCommitSha.slice(0, 8);
  const shortShaToken = new RegExp(`(?:^|[^0-9A-Za-z])${shortSha}(?:$|[^0-9A-Za-z])`, "u");
  if (!shortShaToken.test(label)) fail("runtime_version_label_sha_mismatch");
}

export function validateRuntimeVersion(value: unknown, candidateSha: string): RuntimeVersionV1 {
  if (!SHA_PATTERN.test(candidateSha)) fail("runtime_version_candidate_sha_invalid");
  const runtime = record(value, "runtime_version_invalid");
  exactKeys(runtime, [
    "version",
    "gitCommitSha",
    "runtimeInstanceLabel",
    "scoringPolicyVersion",
    "resultSchemaVersion",
    "narrativeVersion",
    "migration"
  ], "runtime_version_shape_invalid");
  if (runtime.version !== "runtime-version-v1") fail("runtime_version_version_mismatch");
  if (typeof runtime.gitCommitSha !== "string" || !SHA_PATTERN.test(runtime.gitCommitSha)) {
    fail("runtime_version_git_sha_invalid");
  }
  if (runtime.gitCommitSha !== candidateSha) fail("runtime_version_git_sha_mismatch");
  validateRuntimeLabel(runtime.runtimeInstanceLabel, runtime.gitCommitSha);
  if (runtime.scoringPolicyVersion !== SCORING_SIGNAL_MATRIX_POLICY_VERSION) {
    fail("runtime_version_scoring_policy_mismatch");
  }
  if (runtime.resultSchemaVersion !== RESULT_SCHEMA_VERSION) fail("runtime_version_result_schema_mismatch");
  if (runtime.narrativeVersion !== NARRATIVE_VERSION) fail("runtime_version_narrative_mismatch");

  const migration = record(runtime.migration, "runtime_version_migration_invalid");
  const migrationKeys = [
    "verified",
    "version",
    "filename",
    "checksumSha256",
    "shortChecksum",
    "schema032ChecksumSha256",
    "schema033ChecksumSha256",
    "schema034ChecksumSha256",
    "schema035ChecksumSha256"
  ];
  exactKeys(migration, migrationKeys, "runtime_version_migration_shape_invalid");
  if (migration.verified !== true) fail("runtime_version_migration_unverified");
  if (migration.version !== SCHEMA_036_VERSION) {
    fail("runtime_version_migration_version_mismatch");
  }
  if (migration.filename !== SCHEMA_036_FILENAME) {
    fail("runtime_version_migration_filename_mismatch");
  }
  if (typeof migration.checksumSha256 !== "string" || !CHECKSUM_PATTERN.test(migration.checksumSha256)) {
    fail("runtime_version_migration_checksum_invalid");
  }
  if (migration.shortChecksum !== migration.checksumSha256.slice(0, 12)) {
    fail("runtime_version_migration_short_checksum_mismatch");
  }
  if (
    typeof migration.schema032ChecksumSha256 !== "string" ||
    !CHECKSUM_PATTERN.test(migration.schema032ChecksumSha256)
  ) {
    fail("runtime_version_schema_032_checksum_invalid");
  }
  if (
    typeof migration.schema033ChecksumSha256 !== "string" ||
    !CHECKSUM_PATTERN.test(migration.schema033ChecksumSha256)
  ) {
    fail("runtime_version_schema_033_checksum_invalid");
  }
  if (
    typeof migration.schema034ChecksumSha256 !== "string" ||
    !CHECKSUM_PATTERN.test(migration.schema034ChecksumSha256)
  ) {
    fail("runtime_version_schema_034_checksum_invalid");
  }
  if (
    typeof migration.schema035ChecksumSha256 !== "string" ||
    !CHECKSUM_PATTERN.test(migration.schema035ChecksumSha256)
  ) {
    fail("runtime_version_schema_035_checksum_invalid");
  }

  Object.freeze(migration);
  return Object.freeze(runtime) as RuntimeVersionV1;
}

export function buildRuntimeVersion(input: {
  gitCommitSha: string | undefined;
  runtimeInstanceLabel: string | undefined;
  migration: RuntimeSchemaVerification;
}): RuntimeVersionV1 {
  const runtime = {
    version: "runtime-version-v1",
    gitCommitSha: input.gitCommitSha,
    runtimeInstanceLabel: input.runtimeInstanceLabel,
    scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    narrativeVersion: NARRATIVE_VERSION,
    migration: { ...input.migration }
  };
  return validateRuntimeVersion(runtime, input.gitCommitSha ?? "");
}

export function formatRuntimeVersion<
  TMigration extends Readonly<{ version: number; shortChecksum: string }>
>(
  runtime: Omit<RuntimeVersionV1, "migration"> & Readonly<{ migration: TMigration }>,
  locale: "ru" | "en"
): string {
  const schemaVersion = String(runtime.migration.version).padStart(3, "0");
  return locale === "en"
    ? [
        "Runtime version",
        `Git SHA: ${runtime.gitCommitSha}`,
        `Instance: ${runtime.runtimeInstanceLabel}`,
        `Scoring policy: ${runtime.scoringPolicyVersion}`,
        `Result schema: ${runtime.resultSchemaVersion}`,
        `Narrative: ${runtime.narrativeVersion}`,
        `Database schema: schema ${schemaVersion} verified · ${runtime.migration.shortChecksum}`
      ].join("\n")
    : [
        "Версия runtime",
        `Git SHA: ${runtime.gitCommitSha}`,
        `Инстанс: ${runtime.runtimeInstanceLabel}`,
        `Политика скоринга: ${runtime.scoringPolicyVersion}`,
        `Схема результата: ${runtime.resultSchemaVersion}`,
        `Версия объяснения: ${runtime.narrativeVersion}`,
        `Схема БД: schema ${schemaVersion} verified · ${runtime.migration.shortChecksum}`
      ].join("\n");
}
