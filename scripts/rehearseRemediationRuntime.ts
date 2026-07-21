import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256,
  assertNoSecretLikeArtifactValues,
  validateTask0BReleaseFreezeEvidence,
  type ReleaseCommandId
} from "../src/release/remediationReleaseManifest";
import {
  assertTerminalLegacyPopulationUnchanged,
  deriveTerminalLegacyFreezeBindingFromCurrentRevalidation,
  snapshotTerminalLegacyPopulation,
  type TerminalLegacyFreezeBinding,
  type TerminalLegacyPopulationV1
} from "../src/release/terminalLegacyPopulation";
import { formatRuntimeVersion, type RuntimeVersionV1 } from "../src/runtime/runtimeVersion";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const APPROVED_SCHEMA_032_CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";
const EMPTY_ALLOWANCE_MIRROR_MISMATCH_SHA256 = createHash("sha256").update("[]", "utf8").digest("hex");
export const ROLLBACK_REHEARSAL_COMMAND_TEMPLATE_SHA256 = "9d98c145698d181dca0e35b3694a501994c7668ba61291687287775cea880f29";

export type RuntimeRehearsalExpected = {
  candidateSha: string;
  previousRuntimeSha: string;
  sanitizedDatabaseFingerprintSha256: string;
  productionCloneDatabaseFingerprintSha256: string;
  schemaEvidenceSha256: string;
  candidateStartEvidenceSha256: string;
  previousStartEvidenceSha256: string;
  candidateRuntimeLabel?: string;
  previousRuntimeLabel?: string;
};

export type RuntimeHealthEvidenceV1 = {
  observedSha: string;
  observedLabel: string;
  startCommandId: ReleaseCommandId;
  startCommandTemplateSha256: string;
  startEvidenceSha256: string;
  adminHealthStatus: 200;
  runtimeInstanceCount: 1;
  workerScheduleCount: 1;
};

export type RuntimeRehearsalEvidenceV1 = {
  version: "runtime-rehearsal-evidence-v1";
  candidateSha: string;
  previousRuntimeSha: string;
  databaseRole: "runtime_sanitized";
  sanitizedDatabaseFingerprintSha256: string;
  productionCloneDatabaseFingerprintSha256: string;
  schemaEvidenceSha256: string;
  candidateStartEvidenceSha256: string;
  previousStartEvidenceSha256: string;
  telegramTransport: "recording_disabled";
  outboundSendCount: 0;
  candidate: RuntimeHealthEvidenceV1;
  previous: RuntimeHealthEvidenceV1;
};

export type RollbackRehearsalEvidenceV1 = {
  candidateSha: string;
  previousRuntimeSha: string;
  previousRuntimeLabel: string;
  startCommandId: "rollback_rehearsal";
  startCommandTemplateSha256: string;
  schemaEvidenceSha256: string;
  previousStartEvidenceSha256: string;
  migratedSanitizedDatabaseFingerprintSha256: string;
  schemaVerification: {
    verified: true;
    version: 32;
    filename: "032_telegram_runtime_forensics_data_contracts.sql";
    checksumSha256: string;
    shortChecksum: string;
  };
  telegramTransport: "recording_disabled";
  outboundSendCount: 0;
  previousRuntimeStarted: true;
  adminHealthStatus: 200;
  runtimeInstanceCount: 1;
  workerScheduleCount: 1;
  observedPreviousVersionSha: string;
  observedPreviousVersionLabel: string;
  conservativeAllowanceMirrorsVerified: true;
  terminalLegacyPopulationBefore: TerminalLegacyPopulationV1;
  terminalLegacyPopulationAfter: TerminalLegacyPopulationV1;
  completedResultsSha256Before: string;
  completedResultsSha256After: string;
  sentFingerprintSetSha256Before: string;
  sentFingerprintSetSha256After: string;
  remainingProcessCount: 0;
  remainingAdvisoryLockCount: 0;
};

export type ControlledRuntimeStateCaptureV1 = {
  schemaVerified: boolean;
  allowanceStateSha256: string;
  allowanceMirrorMismatchCount: number;
  allowanceMirrorMismatchSha256: string;
  completedResultsSha256: string;
  sentFingerprintSetSha256: string;
  advisoryLockCount: number;
  telegramSendCount: number;
  runtimeProcessCount: number;
  terminalLegacyPopulation: TerminalLegacyPopulationV1;
};

export type ControlledRuntimeObservationV1 = {
  adminHealthStatus: number;
  observedSha: string;
  observedLabel: string;
  versionResponseText: string;
  versionResponseSha256: string;
  runtimeInstanceCount: number;
  workerScheduleCount: number;
  telegramSendCount: number;
  advisoryLockCount: number;
};

export type ControlledRuntimeProcessCaptureV1 = {
  processIdentitySha256: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  forced: boolean;
  stdoutSha256: string;
  stderrSha256: string;
  timedOut: boolean;
};

export type ControlledRuntimeRehearsalProvenanceV1 = {
  version: "controlled-runtime-rehearsal-v1";
  candidateSha: string;
  previousRuntimeSha: string;
  timeoutMs: number;
  candidateStartCommandId: "runtime_sanitized_rehearsal";
  candidateStartTemplateSha256: string;
  candidateStopCommandId: "runtime_sanitized_stop";
  candidateStopTemplateSha256: string;
  previousStartCommandId: "rollback_rehearsal";
  previousStartTemplateSha256: string;
  previousStopCommandId: "rollback_stop";
  previousStopTemplateSha256: string;
  subprocessCapturesSha256: string;
  queryCapturesSha256: string;
};

export type ControlledRuntimeSubprocessCapturesV1 = {
  version: "controlled-runtime-subprocess-captures-v1";
  candidateProcess: ControlledRuntimeProcessCaptureV1;
  previousProcess: ControlledRuntimeProcessCaptureV1;
};

export type ControlledRuntimeQueryCapturesV1 = {
  version: "controlled-runtime-query-captures-v1";
  before: ControlledRuntimeStateCaptureV1;
  candidateObservation: ControlledRuntimeObservationV1;
  previousObservation: ControlledRuntimeObservationV1;
  after: ControlledRuntimeStateCaptureV1;
};

export type ControlledRuntimeRehearsalDependencies = {
  captureState(stage: "before" | "after", signal: AbortSignal): Promise<ControlledRuntimeStateCaptureV1>;
  start(
    target: "candidate" | "previous",
    operation: { commandId: "runtime_sanitized_rehearsal" | "rollback_rehearsal"; templateSha256: string; timeoutMs: number; signal: AbortSignal }
  ): Promise<{ processIdentity: string }>;
  observe(target: "candidate" | "previous", signal: AbortSignal): Promise<ControlledRuntimeObservationV1>;
  stop(
    target: "candidate" | "previous",
    operation: { commandId: "runtime_sanitized_stop" | "rollback_stop"; templateSha256: string; timeoutMs: number; signal: AbortSignal }
  ): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; forced: boolean; stdout: string; stderr: string; timedOut: boolean }>;
  forceCleanup(
    target: "candidate" | "previous",
    signal: AbortSignal
  ): Promise<{ managedChildCount: number; runtimeProcessCount: number }>;
};

export type ControlledRuntimeOperationalConfigV1 = {
  version: "controlled-runtime-operational-config-v1";
  candidateWorktree: string;
  previousWorktree: string;
  candidateAdminUrl: string;
  previousAdminUrl: string;
  databaseUrlEnv: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL";
  telegramRecorderPath: "runtime-telegram-recorder.json";
};

type JsonRecord = Record<string, unknown>;

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}

function loopbackHttpUrl(value: unknown, expectedPath: string, code: string): string {
  if (typeof value !== "string") fail(code);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(code);
  }
  if (parsed.protocol !== "http:" || !parsed.port
      || !new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)
      || parsed.pathname !== expectedPath || parsed.search || parsed.hash || parsed.username || parsed.password) fail(code);
  return parsed.toString();
}

export function validateControlledRuntimeOperationalConfig(
  bytes: Buffer,
  binding: { operationalConfigPath: string; operationalConfigSha256: string }
): ControlledRuntimeOperationalConfigV1 {
  if (binding.operationalConfigPath !== "runtime-operational-config.json"
      || !SHA256.test(binding.operationalConfigSha256)
      || createHash("sha256").update(bytes).digest("hex") !== binding.operationalConfigSha256) {
    fail("controlled_runtime_operational_config_hash_mismatch");
  }
  const config = parseControlledCapture(bytes, "controlled_runtime_operational_config_invalid");
  assertNoSecretLikeArtifactValues(config);
  exactKeys(config, [
    "version", "candidateWorktree", "previousWorktree", "candidateAdminUrl", "previousAdminUrl",
    "databaseUrlEnv", "telegramRecorderPath"
  ], "controlled_runtime_operational_config_shape_invalid");
  if (config.version !== "controlled-runtime-operational-config-v1"
      || typeof config.candidateWorktree !== "string" || !isAbsolute(config.candidateWorktree)
      || typeof config.previousWorktree !== "string" || !isAbsolute(config.previousWorktree)
      || resolve(config.candidateWorktree) === resolve(config.previousWorktree)
      || config.databaseUrlEnv !== "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL"
      || config.telegramRecorderPath !== "runtime-telegram-recorder.json") {
    fail("controlled_runtime_operational_config_binding_invalid");
  }
  loopbackHttpUrl(config.candidateAdminUrl, "/", "controlled_runtime_candidate_admin_url_invalid");
  loopbackHttpUrl(config.previousAdminUrl, "/", "controlled_runtime_previous_admin_url_invalid");
  return config as unknown as ControlledRuntimeOperationalConfigV1;
}

function assertExpected(expected: RuntimeRehearsalExpected): void {
  if (!SHA40.test(expected.candidateSha) || !SHA40.test(expected.previousRuntimeSha)) fail("runtime_rehearsal_expected_sha_invalid");
  for (const hash of [
    expected.sanitizedDatabaseFingerprintSha256,
    expected.productionCloneDatabaseFingerprintSha256,
    expected.schemaEvidenceSha256,
    expected.candidateStartEvidenceSha256,
    expected.previousStartEvidenceSha256
  ]) {
    if (!SHA256.test(hash)) fail("runtime_rehearsal_expected_evidence_invalid");
  }
  if (expected.sanitizedDatabaseFingerprintSha256 === expected.productionCloneDatabaseFingerprintSha256) {
    fail("runtime_rehearsal_expected_database_invalid");
  }
  if (expected.candidateSha === expected.previousRuntimeSha) fail("runtime_rehearsal_candidate_previous_same");
}

function validateStateCapture(value: ControlledRuntimeStateCaptureV1, label: string): void {
  assertNoSecretLikeArtifactValues(value);
  const state = record(value, `${label}_state_invalid`);
  exactKeys(state, [
    "schemaVerified", "allowanceStateSha256", "allowanceMirrorMismatchCount", "allowanceMirrorMismatchSha256",
    "completedResultsSha256", "sentFingerprintSetSha256",
    "advisoryLockCount", "telegramSendCount", "runtimeProcessCount", "terminalLegacyPopulation"
  ], `${label}_state_shape_invalid`);
  if (value.schemaVerified !== true || value.advisoryLockCount !== 0 || value.telegramSendCount !== 0
      || value.runtimeProcessCount !== 0 || value.allowanceMirrorMismatchCount !== 0
      || value.allowanceMirrorMismatchSha256 !== EMPTY_ALLOWANCE_MIRROR_MISMATCH_SHA256) fail(`${label}_state_invalid`);
  assertTerminalLegacyPopulationUnchanged(value.terminalLegacyPopulation, value.terminalLegacyPopulation);
  for (const field of ["allowanceStateSha256", "allowanceMirrorMismatchSha256", "completedResultsSha256", "sentFingerprintSetSha256"] as const) {
    if (!SHA256.test(value[field])) fail(`${label}_state_hash_invalid`);
  }
}

function validateOperationalObservation(
  value: ControlledRuntimeObservationV1,
  target: "candidate" | "previous",
  sha: string,
  label: string
): void {
  assertNoSecretLikeArtifactValues(value);
  const observation = record(value, "controlled_runtime_observation_invalid");
  exactKeys(observation, [
    "adminHealthStatus", "observedSha", "observedLabel", "versionResponseText", "versionResponseSha256", "runtimeInstanceCount", "workerScheduleCount",
    "telegramSendCount", "advisoryLockCount"
  ], "controlled_runtime_observation_shape_invalid");
  if (value.adminHealthStatus !== 200 || value.observedSha !== sha || value.observedLabel !== label
      || value.runtimeInstanceCount !== 1 || value.workerScheduleCount !== 1
      || value.telegramSendCount !== 0 || value.advisoryLockCount !== 0) fail("controlled_runtime_observation_invalid");
  if (typeof value.versionResponseText !== "string"
      || createHash("sha256").update(value.versionResponseText, "utf8").digest("hex") !== value.versionResponseSha256) {
    fail("controlled_runtime_version_response_hash_invalid");
  }
  const expectedText = target === "candidate"
    ? formatRuntimeVersion({
        version: "runtime-version-v1",
        gitCommitSha: sha,
        runtimeInstanceLabel: label,
        scoringPolicyVersion: "scoring-signal-matrix-v3",
        resultSchemaVersion: "score-anchor-v2+forensic-coverage-v2",
        narrativeVersion: "telegram-forensic-result-v1",
        migration: {
          verified: true,
          version: 32,
          filename: "032_telegram_runtime_forensics_data_contracts.sql",
          checksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
          shortChecksum: APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)
        }
      } as RuntimeVersionV1, "ru")
    : [
        "<b>Статус runtime</b>",
        "",
        `<b>Инстанс</b>: <code>${label}</code>`,
        "<b>Режим</b>: <code>marked</code>",
        "По этой строке можно понять, какая версия runtime ответила в Telegram."
      ].join("\n");
  if (value.versionResponseText !== expectedText) fail("controlled_runtime_version_response_mismatch");
}

export function validateControlledRuntimeProcessTermination(value: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  forced: boolean;
  timedOut: boolean;
}): void {
  const gracefulExit = value.exitCode === 0 && value.signal === null;
  const gracefulSignal = value.exitCode === null && value.signal === "SIGTERM";
  if ((!gracefulExit && !gracefulSignal) || value.forced !== false || value.timedOut !== false) {
    fail("controlled_runtime_termination_invalid");
  }
}

function validateProcessCapture(value: ControlledRuntimeProcessCaptureV1): void {
  const capture = record(value, "controlled_runtime_process_capture_invalid");
  exactKeys(capture, [
    "processIdentitySha256", "exitCode", "signal", "forced", "stdoutSha256", "stderrSha256", "timedOut"
  ], "controlled_runtime_process_capture_shape_invalid");
  if (!SHA256.test(value.processIdentitySha256) || !SHA256.test(value.stdoutSha256) || !SHA256.test(value.stderrSha256)) {
    fail("controlled_runtime_process_capture_invalid");
  }
  validateControlledRuntimeProcessTermination(value);
}

export function sha256ControlledRuntimeCapture(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runControlledOperation<T>(
  timeoutMs: number,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>,
  forceCleanup?: (signal: AbortSignal) => Promise<{ managedChildCount: number; runtimeProcessCount: number }>
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  let operationSettled = false;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal)).finally(() => {
    operationSettled = true;
  });
  const performCleanup = async (): Promise<void> => {
    if (!forceCleanup) return;
    const cleanupController = new AbortController();
    const cleanupMs = Math.min(15_000, Math.max(6_000, timeoutMs));
    let cleanupTimer: NodeJS.Timeout | undefined;
    try {
      const cleanup = await Promise.race([
        forceCleanup(cleanupController.signal),
        new Promise<never>((_resolve, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupController.abort();
            reject(new Error(`${code}_force_cleanup_timeout`));
          }, cleanupMs);
        })
      ]);
      if (cleanup.managedChildCount !== 0 || cleanup.runtimeProcessCount !== 0) {
        throw new Error(`${code}_force_cleanup_incomplete`);
      }
    } finally {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    }
  };
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(code));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operationPromise, timeout]);
  } catch (error) {
    if (!timedOut) {
      await performCleanup();
      throw error;
    }
    const settlementMs = Math.min(500, timeoutMs);
    await Promise.race([
      operationPromise.then(() => undefined, () => undefined),
      new Promise<void>((resolveSettlement) => setTimeout(resolveSettlement, settlementMs))
    ]);
    if (!operationSettled && !forceCleanup) {
      throw new Error(`${code}_unsettled_without_cleanup`, { cause: error });
    }
    await performCleanup();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseControlledCapture(bytes: Buffer, code: string): JsonRecord {
  try {
    return record(JSON.parse(bytes.toString("utf8")) as unknown, code);
  } catch {
    fail(code);
  }
}

export function validateControlledRuntimeRehearsalProvenance(
  value: unknown,
  expected: { candidateSha: string; previousRuntimeSha: string; candidateRuntimeLabel: string; previousRuntimeLabel: string },
  captures?: { subprocessCaptureBytes: Buffer; queryCaptureBytes: Buffer }
): ControlledRuntimeRehearsalProvenanceV1 {
  assertNoSecretLikeArtifactValues(value);
  const provenance = record(value, "controlled_runtime_provenance_invalid") as ControlledRuntimeRehearsalProvenanceV1;
  exactKeys(provenance as unknown as JsonRecord, [
    "version", "candidateSha", "previousRuntimeSha", "timeoutMs", "candidateStartCommandId",
    "candidateStartTemplateSha256", "candidateStopCommandId", "candidateStopTemplateSha256",
    "previousStartCommandId", "previousStartTemplateSha256", "previousStopCommandId", "previousStopTemplateSha256",
    "subprocessCapturesSha256", "queryCapturesSha256"
  ], "controlled_runtime_provenance_shape_invalid");
  if (provenance.version !== "controlled-runtime-rehearsal-v1" || provenance.candidateSha !== expected.candidateSha
      || provenance.previousRuntimeSha !== expected.previousRuntimeSha || !Number.isSafeInteger(provenance.timeoutMs)
      || provenance.timeoutMs < 1_000 || provenance.timeoutMs > 120_000
      || provenance.candidateStartCommandId !== "runtime_sanitized_rehearsal"
      || provenance.candidateStartTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal
      || provenance.candidateStopCommandId !== "runtime_sanitized_stop"
      || provenance.candidateStopTemplateSha256 !== REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop
      || provenance.previousStartCommandId !== "rollback_rehearsal"
      || provenance.previousStartTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal
      || provenance.previousStopCommandId !== "rollback_stop"
      || provenance.previousStopTemplateSha256 !== REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop
      || !SHA256.test(provenance.subprocessCapturesSha256) || !SHA256.test(provenance.queryCapturesSha256)) {
    fail("controlled_runtime_provenance_identity_invalid");
  }
  if (!captures
      || sha256ControlledRuntimeCapture(captures.subprocessCaptureBytes) !== provenance.subprocessCapturesSha256
      || sha256ControlledRuntimeCapture(captures.queryCaptureBytes) !== provenance.queryCapturesSha256) {
    fail("controlled_runtime_capture_binding_missing");
  }
  const subprocess = parseControlledCapture(captures.subprocessCaptureBytes, "controlled_runtime_subprocess_capture_invalid");
  const queries = parseControlledCapture(captures.queryCaptureBytes, "controlled_runtime_query_capture_invalid");
  exactKeys(subprocess, ["version", "candidateProcess", "previousProcess"], "controlled_runtime_subprocess_capture_shape_invalid");
  exactKeys(queries, ["version", "before", "candidateObservation", "previousObservation", "after"], "controlled_runtime_query_capture_shape_invalid");
  if (subprocess.version !== "controlled-runtime-subprocess-captures-v1"
      || queries.version !== "controlled-runtime-query-captures-v1") fail("controlled_runtime_capture_version_invalid");
  const typedSubprocess = subprocess as unknown as ControlledRuntimeSubprocessCapturesV1;
  const typedQueries = queries as unknown as ControlledRuntimeQueryCapturesV1;
  validateStateCapture(typedQueries.before, "before");
  validateStateCapture(typedQueries.after, "after");
  validateOperationalObservation(typedQueries.candidateObservation, "candidate", expected.candidateSha, expected.candidateRuntimeLabel);
  validateOperationalObservation(typedQueries.previousObservation, "previous", expected.previousRuntimeSha, expected.previousRuntimeLabel);
  validateProcessCapture(typedSubprocess.candidateProcess);
  validateProcessCapture(typedSubprocess.previousProcess);
  for (const field of ["allowanceStateSha256", "allowanceMirrorMismatchSha256", "completedResultsSha256", "sentFingerprintSetSha256"] as const) {
    if (typedQueries.before[field] !== typedQueries.after[field]) fail("controlled_runtime_state_changed");
  }
  return provenance;
}

export async function executeControlledRuntimeRehearsal(
  input: {
    candidateSha: string;
    previousRuntimeSha: string;
    candidateRuntimeLabel: string;
    previousRuntimeLabel: string;
    timeoutMs: number;
    evidenceExpected: RuntimeRehearsalExpected;
  },
  dependencies: ControlledRuntimeRehearsalDependencies
): Promise<{
  provenance: ControlledRuntimeRehearsalProvenanceV1;
  subprocessCaptureBytes: Buffer;
  queryCaptureBytes: Buffer;
  runtimeEvidenceBytes: Buffer;
  rollbackEvidenceBytes: Buffer;
}> {
  if (!SHA40.test(input.candidateSha) || !SHA40.test(input.previousRuntimeSha) || input.candidateSha === input.previousRuntimeSha
      || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 120_000) {
    fail("controlled_runtime_input_invalid");
  }
  assertExpected(input.evidenceExpected);
  if (input.evidenceExpected.candidateSha !== input.candidateSha
      || input.evidenceExpected.previousRuntimeSha !== input.previousRuntimeSha
      || input.evidenceExpected.candidateRuntimeLabel !== input.candidateRuntimeLabel
      || input.evidenceExpected.previousRuntimeLabel !== input.previousRuntimeLabel) {
    fail("controlled_runtime_evidence_expected_mismatch");
  }
  const cleanupTarget = (target: "candidate" | "previous") => (signal: AbortSignal) => (
    dependencies.forceCleanup(target, signal)
  );
  const before = await runControlledOperation(input.timeoutMs, "controlled_runtime_before_timeout", (signal) => (
    dependencies.captureState("before", signal)
  ));
  validateStateCapture(before, "before");
  const candidateStart = await runControlledOperation(input.timeoutMs, "controlled_runtime_candidate_start_timeout", async (signal) => {
    const started = await dependencies.start("candidate", {
      commandId: "runtime_sanitized_rehearsal",
      templateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
      timeoutMs: input.timeoutMs,
      signal
    });
    if (typeof started.processIdentity !== "string" || !started.processIdentity) {
      fail("controlled_runtime_candidate_start_capture_invalid");
    }
    return started;
  }, cleanupTarget("candidate"));
  let candidateStop: { exitCode: number | null; signal: NodeJS.Signals | null; forced: boolean; stdout: string; stderr: string; timedOut: boolean };
  let candidateObservation: ControlledRuntimeObservationV1;
  try {
    candidateObservation = await runControlledOperation(input.timeoutMs, "controlled_runtime_candidate_observe_timeout", (signal) => (
      dependencies.observe("candidate", signal)
    ), cleanupTarget("candidate"));
  } finally {
    candidateStop = await runControlledOperation(input.timeoutMs, "controlled_runtime_candidate_stop_timeout", (signal) => dependencies.stop("candidate", {
      commandId: "runtime_sanitized_stop",
      templateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop,
      timeoutMs: input.timeoutMs,
      signal
    }), cleanupTarget("candidate"));
  }
  const previousStart = await runControlledOperation(input.timeoutMs, "controlled_runtime_previous_start_timeout", async (signal) => {
    const started = await dependencies.start("previous", {
      commandId: "rollback_rehearsal",
      templateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
      timeoutMs: input.timeoutMs,
      signal
    });
    if (typeof started.processIdentity !== "string" || !started.processIdentity) {
      fail("controlled_runtime_previous_start_capture_invalid");
    }
    return started;
  }, cleanupTarget("previous"));
  let previousStop: { exitCode: number | null; signal: NodeJS.Signals | null; forced: boolean; stdout: string; stderr: string; timedOut: boolean };
  let previousObservation: ControlledRuntimeObservationV1;
  try {
    previousObservation = await runControlledOperation(input.timeoutMs, "controlled_runtime_previous_observe_timeout", (signal) => (
      dependencies.observe("previous", signal)
    ), cleanupTarget("previous"));
  } finally {
    previousStop = await runControlledOperation(input.timeoutMs, "controlled_runtime_previous_stop_timeout", (signal) => dependencies.stop("previous", {
      commandId: "rollback_stop",
      templateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop,
      timeoutMs: input.timeoutMs,
      signal
    }), cleanupTarget("previous"));
  }
  const after = await runControlledOperation(input.timeoutMs, "controlled_runtime_after_timeout", (signal) => (
    dependencies.captureState("after", signal)
  ));
  for (const [label, stopped] of [["candidate", candidateStop!], ["previous", previousStop!]] as const) {
    if ((stopped.exitCode !== null && !Number.isSafeInteger(stopped.exitCode))
        || (stopped.signal !== null && typeof stopped.signal !== "string")
        || typeof stopped.forced !== "boolean" || typeof stopped.stdout !== "string"
        || typeof stopped.stderr !== "string" || typeof stopped.timedOut !== "boolean") {
      fail(`controlled_runtime_${label}_stop_capture_invalid`);
    }
  }
  const subprocessCaptures: ControlledRuntimeSubprocessCapturesV1 = {
    version: "controlled-runtime-subprocess-captures-v1",
    candidateProcess: {
      processIdentitySha256: createHash("sha256").update(candidateStart.processIdentity, "utf8").digest("hex"),
      exitCode: candidateStop!.exitCode,
      signal: candidateStop!.signal,
      forced: candidateStop!.forced,
      stdoutSha256: createHash("sha256").update(candidateStop!.stdout, "utf8").digest("hex"),
      stderrSha256: createHash("sha256").update(candidateStop!.stderr, "utf8").digest("hex"),
      timedOut: candidateStop!.timedOut
    },
    previousProcess: {
      processIdentitySha256: createHash("sha256").update(previousStart.processIdentity, "utf8").digest("hex"),
      exitCode: previousStop!.exitCode,
      signal: previousStop!.signal,
      forced: previousStop!.forced,
      stdoutSha256: createHash("sha256").update(previousStop!.stdout, "utf8").digest("hex"),
      stderrSha256: createHash("sha256").update(previousStop!.stderr, "utf8").digest("hex"),
      timedOut: previousStop!.timedOut
    }
  };
  const queryCaptures: ControlledRuntimeQueryCapturesV1 = {
    version: "controlled-runtime-query-captures-v1",
    before,
    candidateObservation,
    previousObservation,
    after
  };
  const subprocessCaptureBytes = Buffer.from(JSON.stringify(subprocessCaptures), "utf8");
  const queryCaptureBytes = Buffer.from(JSON.stringify(queryCaptures), "utf8");
  const provenance: ControlledRuntimeRehearsalProvenanceV1 = {
    version: "controlled-runtime-rehearsal-v1",
    candidateSha: input.candidateSha,
    previousRuntimeSha: input.previousRuntimeSha,
    timeoutMs: input.timeoutMs,
    candidateStartCommandId: "runtime_sanitized_rehearsal",
    candidateStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    candidateStopCommandId: "runtime_sanitized_stop",
    candidateStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop,
    previousStartCommandId: "rollback_rehearsal",
    previousStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    previousStopCommandId: "rollback_stop",
    previousStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop,
    subprocessCapturesSha256: sha256ControlledRuntimeCapture(subprocessCaptureBytes),
    queryCapturesSha256: sha256ControlledRuntimeCapture(queryCaptureBytes)
  };
  validateControlledRuntimeRehearsalProvenance(provenance, input, { subprocessCaptureBytes, queryCaptureBytes });
  const derived = deriveControlledRuntimeEvidence(input.evidenceExpected, queryCaptures);
  return { provenance, subprocessCaptureBytes, queryCaptureBytes, ...derived };
}

export function deriveControlledRuntimeEvidence(
  expected: RuntimeRehearsalExpected,
  captures: ControlledRuntimeQueryCapturesV1
): { runtimeEvidenceBytes: Buffer; rollbackEvidenceBytes: Buffer } {
  assertExpected(expected);
  validateStateCapture(captures.before, "before");
  validateStateCapture(captures.after, "after");
  validateOperationalObservation(captures.candidateObservation, "candidate", expected.candidateSha, expected.candidateRuntimeLabel ?? "");
  validateOperationalObservation(captures.previousObservation, "previous", expected.previousRuntimeSha, expected.previousRuntimeLabel ?? "");
  assertTerminalLegacyPopulationUnchanged(captures.before.terminalLegacyPopulation, captures.after.terminalLegacyPopulation);
  if (captures.before.allowanceStateSha256 !== captures.after.allowanceStateSha256) {
    fail("controlled_runtime_allowance_state_changed");
  }
  const health = (
    observation: ControlledRuntimeObservationV1,
    commandId: "runtime_sanitized_rehearsal" | "rollback_rehearsal",
    startEvidenceSha256: string
  ): RuntimeHealthEvidenceV1 => ({
    observedSha: observation.observedSha,
    observedLabel: observation.observedLabel,
    startCommandId: commandId,
    startCommandTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256[commandId],
    startEvidenceSha256,
    adminHealthStatus: 200,
    runtimeInstanceCount: 1,
    workerScheduleCount: 1
  });
  const runtimeEvidence: RuntimeRehearsalEvidenceV1 = {
    version: "runtime-rehearsal-evidence-v1",
    candidateSha: expected.candidateSha,
    previousRuntimeSha: expected.previousRuntimeSha,
    databaseRole: "runtime_sanitized",
    sanitizedDatabaseFingerprintSha256: expected.sanitizedDatabaseFingerprintSha256,
    productionCloneDatabaseFingerprintSha256: expected.productionCloneDatabaseFingerprintSha256,
    schemaEvidenceSha256: expected.schemaEvidenceSha256,
    candidateStartEvidenceSha256: expected.candidateStartEvidenceSha256,
    previousStartEvidenceSha256: expected.previousStartEvidenceSha256,
    telegramTransport: "recording_disabled",
    outboundSendCount: 0,
    candidate: health(captures.candidateObservation, "runtime_sanitized_rehearsal", expected.candidateStartEvidenceSha256),
    previous: health(captures.previousObservation, "rollback_rehearsal", expected.previousStartEvidenceSha256)
  };
  const rollbackEvidence: RollbackRehearsalEvidenceV1 = {
    candidateSha: expected.candidateSha,
    previousRuntimeSha: expected.previousRuntimeSha,
    previousRuntimeLabel: captures.previousObservation.observedLabel,
    startCommandId: "rollback_rehearsal",
    startCommandTemplateSha256: ROLLBACK_REHEARSAL_COMMAND_TEMPLATE_SHA256,
    schemaEvidenceSha256: expected.schemaEvidenceSha256,
    previousStartEvidenceSha256: expected.previousStartEvidenceSha256,
    migratedSanitizedDatabaseFingerprintSha256: expected.sanitizedDatabaseFingerprintSha256,
    schemaVerification: {
      verified: true,
      version: 32,
      filename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: APPROVED_SCHEMA_032_CHECKSUM,
      shortChecksum: APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)
    },
    telegramTransport: "recording_disabled",
    outboundSendCount: 0,
    previousRuntimeStarted: true,
    adminHealthStatus: 200,
    runtimeInstanceCount: 1,
    workerScheduleCount: 1,
    observedPreviousVersionSha: captures.previousObservation.observedSha,
    observedPreviousVersionLabel: captures.previousObservation.observedLabel,
    conservativeAllowanceMirrorsVerified: true,
    terminalLegacyPopulationBefore: structuredClone(captures.before.terminalLegacyPopulation),
    terminalLegacyPopulationAfter: structuredClone(captures.after.terminalLegacyPopulation),
    completedResultsSha256Before: captures.before.completedResultsSha256,
    completedResultsSha256After: captures.after.completedResultsSha256,
    sentFingerprintSetSha256Before: captures.before.sentFingerprintSetSha256,
    sentFingerprintSetSha256After: captures.after.sentFingerprintSetSha256,
    remainingProcessCount: 0,
    remainingAdvisoryLockCount: 0
  };
  validateRuntimeRehearsalEvidence(runtimeEvidence, expected);
  validateRollbackRehearsalEvidence(rollbackEvidence, expected);
  return {
    runtimeEvidenceBytes: Buffer.from(JSON.stringify(runtimeEvidence), "utf8"),
    rollbackEvidenceBytes: Buffer.from(JSON.stringify(rollbackEvidence), "utf8")
  };
}

export async function runControlledRuntimeRehearsalCli(
  input: {
    candidateSha: string;
    previousRuntimeSha: string;
    candidateRuntimeLabel: string;
    previousRuntimeLabel: string;
    timeoutMs: number;
    evidenceExpected: RuntimeRehearsalExpected;
  },
  dependencies: ControlledRuntimeRehearsalDependencies,
  writeArtifact: (filename: string, bytes: Buffer) => Promise<void>,
  startEvidence: {
    candidateStartEvidenceBytes: Buffer;
    previousStartEvidenceBytes: Buffer;
  }
): Promise<ControlledRuntimeRehearsalProvenanceV1> {
  validateRuntimeStartCommandEvidenceBytes(
    startEvidence.candidateStartEvidenceBytes,
    input.candidateSha,
    input.candidateRuntimeLabel,
    "runtime_sanitized_rehearsal"
  );
  validateRuntimeStartCommandEvidenceBytes(
    startEvidence.previousStartEvidenceBytes,
    input.previousRuntimeSha,
    input.previousRuntimeLabel,
    "rollback_rehearsal"
  );
  if (createHash("sha256").update(startEvidence.candidateStartEvidenceBytes).digest("hex")
        !== input.evidenceExpected.candidateStartEvidenceSha256
      || createHash("sha256").update(startEvidence.previousStartEvidenceBytes).digest("hex")
        !== input.evidenceExpected.previousStartEvidenceSha256) {
    fail("controlled_runtime_start_evidence_binding_invalid");
  }
  const result = await executeControlledRuntimeRehearsal(input, dependencies);
  const provenanceBytes = Buffer.from(JSON.stringify(result.provenance), "utf8");
  await writeArtifact("runtime-candidate-start-evidence.json", startEvidence.candidateStartEvidenceBytes);
  await writeArtifact("runtime-previous-start-evidence.json", startEvidence.previousStartEvidenceBytes);
  await writeArtifact("runtime-subprocess-captures.json", result.subprocessCaptureBytes);
  await writeArtifact("runtime-query-captures.json", result.queryCaptureBytes);
  await writeArtifact("runtime-operational-observation.json", provenanceBytes);
  await writeArtifact("runtime-rehearsal.json", result.runtimeEvidenceBytes);
  await writeArtifact("rollback-rehearsal.json", result.rollbackEvidenceBytes);
  return result.provenance;
}

type ManagedRuntimeProcess = {
  child: ChildProcessWithoutNullStreams;
  stdout: Buffer[];
  stderr: Buffer[];
};

type ControlledRuntimeCliOperations = {
  attestWorktree(worktree: string, expectedSha: string): void;
  initializeRecorder(path: string, target: "candidate" | "previous"): Promise<void>;
  spawnRuntime: typeof spawn;
};

export function controlledRuntimeRecorderPath(
  artifactRoot: string,
  configuredPath: string,
  target: "candidate" | "previous"
): string {
  const root = resolve(artifactRoot);
  const configured = resolve(root, configuredPath);
  if (isOutside(root, configured)) fail("controlled_runtime_recorder_path_invalid");
  const parts = parse(configured);
  const extension = parts.ext || ".json";
  return join(parts.dir, `${parts.name}.${target}${extension}`);
}

export async function initializeControlledRuntimeRecorder(
  path: string,
  target: "candidate" | "previous"
): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    await handle.writeFile(JSON.stringify({
      version: "runtime-rehearsal-recorder-pending-v1",
      target
    }), "utf8");
    const stat = await handle.stat();
    if (!stat.isFile()) fail("controlled_runtime_recorder_not_regular");
  } catch {
    fail("controlled_runtime_recorder_exclusive_create_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

type ControlledRuntimeCliContext = {
  artifactRoot: string;
  candidateSha: string;
  previousRuntimeSha: string;
  candidateRuntimeLabel: string;
  previousRuntimeLabel: string;
  databaseUrl: string;
  terminalLegacyBinding: TerminalLegacyFreezeBinding;
};

const MAX_CAPTURED_PROCESS_BYTES = 10 * 1024 * 1024;

export type ControlledRuntimeProcessRecord = { pid: number; commandLine: string };

function normalizedCommandToken(value: string): string {
  const normalized = value.replace(/^"|"$/gu, "").replace(/\\/gu, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function matchingControlledRuntimeProcesses(
  records: readonly ControlledRuntimeProcessRecord[],
  input: { entrypoint: string; preloadPath: string }
): ControlledRuntimeProcessRecord[] {
  const expectedEntrypoint = normalizedCommandToken(resolve(input.entrypoint));
  const expectedPreloadUrl = normalizedCommandToken(pathToFileURL(resolve(input.preloadPath)).href);
  return records.filter((record) => {
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.commandLine !== "string") {
      fail("controlled_runtime_process_record_invalid");
    }
    const tokens = (record.commandLine.match(/"[^"]*"|\S+/gu) ?? []).map(normalizedCommandToken);
    return tokens.length === 6
      && tokens[0] === normalizedCommandToken(process.execPath)
      && tokens[1] === "--import"
      && tokens[2] === "tsx"
      && tokens[3] === "--import"
      && tokens[4] === expectedPreloadUrl
      && tokens[5] === expectedEntrypoint;
  });
}

export function countControlledRuntimeProcesses(
  records: readonly ControlledRuntimeProcessRecord[],
  input: { entrypoint: string; preloadPath: string; expectedPid?: number }
): number {
  const matching = matchingControlledRuntimeProcesses(records, input);
  if (input.expectedPid !== undefined && !matching.some((record) => record.pid === input.expectedPid)) {
    fail("controlled_runtime_expected_pid_missing");
  }
  return matching.length;
}

function enumerateControlledRuntimeProcesses(): ControlledRuntimeProcessRecord[] {
  if (process.platform === "win32") {
    const raw = execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    ], { encoding: "utf8", windowsHide: true, timeout: 5_000, maxBuffer: 10 * 1024 * 1024 }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) return [];
      const value = row as Record<string, unknown>;
      return typeof value.CommandLine === "string" && Number.isSafeInteger(value.ProcessId)
        ? [{ pid: Number(value.ProcessId), commandLine: value.CommandLine }]
        : [];
    });
  }
  return execFileSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 10 * 1024 * 1024
  })
    .split(/\r?\n/gu)
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
      return match ? [{ pid: Number(match[1]), commandLine: match[2]! }] : [];
    });
}

async function waitForControlledRuntimeRetry(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolveWait, rejectWait) => {
    if (signal.aborted) {
      rejectWait(new Error("controlled_runtime_observe_aborted"));
      return;
    }
    const finish = (operation: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      operation();
    };
    const onAbort = () => finish(() => rejectWait(new Error("controlled_runtime_observe_aborted")));
    const timer = setTimeout(() => finish(resolveWait), 100);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function appendBounded(chunks: Buffer[], chunk: Buffer): void {
  const used = chunks.reduce((total, item) => total + item.length, 0);
  if (used < MAX_CAPTURED_PROCESS_BYTES) chunks.push(chunk.subarray(0, MAX_CAPTURED_PROCESS_BYTES - used));
}

async function waitForManagedRuntimeExit(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolveExit, rejectExit) => {
    const cleanup = () => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolveExit({ code, signal });
    };
    const onError = (error: Error) => {
      cleanup();
      rejectExit(error);
    };
    child.once("exit", onExit);
    child.once("error", onError);
    if (child.exitCode !== null || child.signalCode !== null) onExit(child.exitCode, child.signalCode);
  });
}

type RuntimeRehearsalRecorderV1 = {
  version: "runtime-rehearsal-recorder-v1";
  target: "candidate" | "previous";
  interceptedSendCount: 1;
  versionResponseText: string;
  versionResponseSha256: string;
};

export async function readRuntimeRehearsalRecorder(
  path: string,
  target: "candidate" | "previous"
): Promise<RuntimeRehearsalRecorderV1> {
  const metadata = await lstat(path);
  const maxBytes = 1024 * 1024;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) {
    fail("controlled_runtime_recorder_invalid");
  }
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino
        || before.size !== metadata.size || before.size > maxBytes) fail("controlled_runtime_recorder_invalid");
    const buffer = Buffer.alloc(Math.min(before.size + 1, maxBytes + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    const after = await handle.stat();
    const current = await lstat(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes.length !== after.size
        || current.isSymbolicLink() || !current.isFile() || current.dev !== before.dev || current.ino !== before.ino
        || current.size !== before.size) {
      fail("controlled_runtime_recorder_changed");
    }
    const recorder = record(JSON.parse(bytes.toString("utf8")) as unknown, "controlled_runtime_recorder_invalid");
    exactKeys(recorder, [
      "version", "target", "interceptedSendCount", "versionResponseText", "versionResponseSha256"
    ], "controlled_runtime_recorder_shape_invalid");
    if (recorder.version !== "runtime-rehearsal-recorder-v1" || recorder.target !== target
        || recorder.interceptedSendCount !== 1 || typeof recorder.versionResponseText !== "string"
        || !SHA256.test(String(recorder.versionResponseSha256))
        || createHash("sha256").update(recorder.versionResponseText, "utf8").digest("hex") !== recorder.versionResponseSha256) {
      fail("controlled_runtime_recorder_invalid");
    }
    return recorder as RuntimeRehearsalRecorderV1;
  } finally {
    await handle.close();
  }
}

export function validateControlledRuntimeWorktreeState(
  value: { headSha: string; statusPorcelain: string },
  expectedSha: string
): void {
  if (value.headSha !== expectedSha) fail("controlled_runtime_worktree_head_mismatch");
  if (value.statusPorcelain !== "") fail("controlled_runtime_worktree_dirty");
}

function attestControlledRuntimeWorktree(worktree: string, expectedSha: string): void {
  const options = { cwd: worktree, encoding: "utf8" as const, windowsHide: true };
  validateControlledRuntimeWorktreeState({
    headSha: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
    statusPorcelain: execFileSync("git", ["status", "--porcelain"], options).trim()
  }, expectedSha);
}

export async function queryControlledRuntimeStateFromClient(
  client: Client,
  terminalLegacyBinding: TerminalLegacyFreezeBinding
): Promise<{
  schemaVerified: boolean;
  allowanceStateSha256: string;
  allowanceMirrorMismatchCount: number;
  allowanceMirrorMismatchSha256: string;
  completedResultsSha256: string;
  sentFingerprintSetSha256: string;
  advisoryLockCount: number;
  terminalLegacyPopulation: TerminalLegacyPopulationV1;
}> {
  const identity = await client.query<{ database_name: string }>("select current_database() as database_name");
  if (identity.rows.length !== 1 || identity.rows[0]?.database_name !== "tron_watch_plan5_runtime_sanitized") {
    fail("controlled_runtime_database_identity_invalid");
  }
  const schema = await client.query("select checksum_sha256 from public.schema_migration_receipts where version = 32");
  const allowance = await client.query("select coalesce(jsonb_agg(to_jsonb(t) order by watched_wallet_id, token_contract, spender_address), '[]'::jsonb)::text as value from (select watched_wallet_id, token_contract, spender_address, allowance_confirmed_raw, allowance_check_status, allowance_checked_at, allowance_fresh_until, allowance_last_attempt_at, allowance_failure_code from public.wallet_approvals) t");
  const allowanceMirrorMismatches = await client.query(`with assessed as (
        select watched_wallet_id, token_contract, spender_address, allowance_check_status,
          allowance_confirmed_raw, current_allowance_raw, is_unlimited, status,
          case
            when allowance_check_status = 'confirmed_active' then
              allowance_confirmed_raw is not null
              and allowance_confirmed_raw <> '0'
              and current_allowance_raw = allowance_confirmed_raw
              and is_unlimited = (allowance_confirmed_raw = '115792089237316195423570985008687907853269984665640564039457584007913129639935')
              and status = 'active'
            when allowance_check_status = 'confirmed_zero' then
              allowance_confirmed_raw = '0'
              and current_allowance_raw = '0'
              and is_unlimited = false
              and status = 'revoked'
            when allowance_check_status in ('failed', 'stale') then
              current_allowance_raw = '0'
              and is_unlimited = false
              and status = 'unknown'
            else false
          end as mirror_valid
        from public.wallet_approvals
      )
      select count(*) filter (where mirror_valid is not true)::int as mismatch_count,
        coalesce(jsonb_agg(jsonb_build_object(
          'watchedWalletId', watched_wallet_id,
          'tokenContract', token_contract,
          'spenderAddress', spender_address,
          'allowanceCheckStatus', allowance_check_status,
          'allowanceConfirmedRaw', allowance_confirmed_raw,
          'currentAllowanceRaw', current_allowance_raw,
          'isUnlimited', is_unlimited,
          'status', status
        ) order by watched_wallet_id, token_contract, spender_address)
          filter (where mirror_valid is not true), '[]'::jsonb)::text as value
      from assessed`);
  const completed = await client.query("select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb)::text as value from (select id, result_json from public.forensic_check_jobs where status = 'completed') t");
  const fingerprints = await client.query("select coalesce(jsonb_agg(fingerprint order by fingerprint), '[]'::jsonb)::text as value from (select distinct progress_json#>>'{telegramDelivery,state,messageFingerprint}' as fingerprint from public.forensic_check_jobs where progress_json#>>'{telegramDelivery,state,status}' = 'sent') t where fingerprint is not null");
  const locks = await client.query("select count(*)::int as count from pg_locks where locktype = 'advisory' and granted");
  const terminalLegacyPopulation = await snapshotTerminalLegacyPopulation(client, terminalLegacyBinding);
  const hash = (value: unknown) => createHash("sha256").update(String(value ?? "[]"), "utf8").digest("hex");
  return {
    schemaVerified: schema.rows.length === 1 && schema.rows[0]?.checksum_sha256 === APPROVED_SCHEMA_032_CHECKSUM,
    allowanceStateSha256: hash(allowance.rows[0]?.value),
    allowanceMirrorMismatchCount: Number(allowanceMirrorMismatches.rows[0]?.mismatch_count),
    allowanceMirrorMismatchSha256: hash(allowanceMirrorMismatches.rows[0]?.value),
    completedResultsSha256: hash(completed.rows[0]?.value),
    sentFingerprintSetSha256: hash(fingerprints.rows[0]?.value),
    advisoryLockCount: Number(locks.rows[0]?.count),
    terminalLegacyPopulation
  };
}

async function queryControlledRuntimeState(
  databaseUrl: string,
  terminalLegacyBinding: TerminalLegacyFreezeBinding
): ReturnType<typeof queryControlledRuntimeStateFromClient> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
    application_name: "plan5_controlled_runtime_rehearsal"
  });
  await client.connect();
  try {
    return await queryControlledRuntimeStateFromClient(client, terminalLegacyBinding);
  } finally {
    await client.end();
  }
}

export function createControlledRuntimeCliDependencies(
  config: ControlledRuntimeOperationalConfigV1,
  context: ControlledRuntimeCliContext,
  enumerateProcesses: () => ControlledRuntimeProcessRecord[] = enumerateControlledRuntimeProcesses,
  operations: ControlledRuntimeCliOperations = {
    attestWorktree: attestControlledRuntimeWorktree,
    initializeRecorder: initializeControlledRuntimeRecorder,
    spawnRuntime: spawn
  }
): ControlledRuntimeRehearsalDependencies {
  const processes = new Map<"candidate" | "previous", ManagedRuntimeProcess>();
  const forceCleanedTargets = new Set<"candidate" | "previous">();
  const runtimePreloadPath = resolve(config.candidateWorktree, "scripts/rehearseRemediationRuntimePreload.ts");
  const recorderPath = (target: "candidate" | "previous") => controlledRuntimeRecorderPath(
    context.artifactRoot,
    config.telegramRecorderPath,
    target
  );
  const scrubbedBaseEnv: NodeJS.ProcessEnv = Object.fromEntries(
    ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP"].flatMap((key) => (
      process.env[key] === undefined ? [] : [[key, process.env[key]]]
    ))
  );
  return {
    async captureState(_stage, signal) {
      if (signal.aborted) fail("controlled_runtime_state_aborted");
      const state = await queryControlledRuntimeState(context.databaseUrl, context.terminalLegacyBinding);
      const processSnapshot = enumerateProcesses();
      const runtimeProcessCount = [config.candidateWorktree, config.previousWorktree].reduce((count, worktree) => (
        count + countControlledRuntimeProcesses(processSnapshot, {
          entrypoint: resolve(worktree, "src/index.ts"),
          preloadPath: runtimePreloadPath
        })
      ), 0);
      return { ...state, telegramSendCount: 0, runtimeProcessCount };
    },
    async start(target, operation) {
      if (operation.signal.aborted || processes.has(target)) fail("controlled_runtime_start_invalid");
      const worktree = target === "candidate" ? config.candidateWorktree : config.previousWorktree;
      const runtimeSha = target === "candidate" ? context.candidateSha : context.previousRuntimeSha;
      const runtimeLabel = target === "candidate" ? context.candidateRuntimeLabel : context.previousRuntimeLabel;
      operations.attestWorktree(worktree, runtimeSha);
      if (operation.signal.aborted) fail("controlled_runtime_start_aborted");
      const adminUrl = new URL(target === "candidate" ? config.candidateAdminUrl : config.previousAdminUrl);
      const targetRecorderPath = recorderPath(target);
      await operations.initializeRecorder(targetRecorderPath, target);
      if (operation.signal.aborted) fail("controlled_runtime_start_aborted");
      const child = operations.spawnRuntime(process.execPath, [
        "--import", "tsx",
        "--import", pathToFileURL(runtimePreloadPath).href,
        resolve(worktree, "src/index.ts")
      ], {
        cwd: worktree,
        env: {
          ...scrubbedBaseEnv,
          BOT_TOKEN: "000000000:PLAN5_RUNTIME_REHEARSAL_ONLY",
          DATABASE_URL: context.databaseUrl,
          RUNTIME_GIT_SHA: runtimeSha,
          RUNTIME_INSTANCE_LABEL: runtimeLabel,
          ADMIN_DASHBOARD_ENABLED: "true",
          ADMIN_DASHBOARD_HOST: adminUrl.hostname.replace(/^\[|\]$/gu, ""),
          ADMIN_DASHBOARD_PORT: adminUrl.port,
          POLL_START_DELAY_MS: "86400000",
          FORENSIC_WHERE_START_DELAY_MS: "86400000",
          FORENSIC_INCOMING_START_DELAY_MS: "86400000",
          FORENSIC_DEEP_START_DELAY_MS: "86400000",
          LLM_ENABLED: "false",
          PLAN5_RUNTIME_REHEARSAL_PRELOAD: "1",
          PLAN5_RUNTIME_REHEARSAL_TARGET: target,
          PLAN5_RUNTIME_REHEARSAL_RECORDER: targetRecorderPath,
          PLAN5_RUNTIME_REHEARSAL_WORKTREE: worktree,
          DOTENV_CONFIG_PATH: resolve(context.artifactRoot, "plan5-no-dotenv")
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false
      }) as ChildProcessWithoutNullStreams;
      const managed: ManagedRuntimeProcess = { child, stdout: [], stderr: [] };
      child.stdout.on("data", (chunk: Buffer) => appendBounded(managed.stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => appendBounded(managed.stderr, chunk));
      processes.set(target, managed);
      forceCleanedTargets.delete(target);
      try {
        await new Promise<void>((resolveSpawn, rejectSpawn) => {
          const cleanupListeners = () => {
            operation.signal.removeEventListener("abort", onAbort);
            child.removeListener("spawn", onSpawn);
            child.removeListener("error", onError);
          };
          const onAbort = () => {
            cleanupListeners();
            child.kill("SIGKILL");
            rejectSpawn(new Error("controlled_runtime_start_aborted"));
          };
          const onSpawn = () => {
            cleanupListeners();
            resolveSpawn();
          };
          const onError = (error: Error) => {
            cleanupListeners();
            child.kill("SIGKILL");
            rejectSpawn(error);
          };
          operation.signal.addEventListener("abort", onAbort, { once: true });
          child.once("spawn", onSpawn);
          child.once("error", onError);
        });
      } catch (error) {
        if (child.exitCode === null) child.kill("SIGKILL");
        try {
          await waitForManagedRuntimeExit(child);
          processes.delete(target);
        } catch {
          // The wrapper's exact process enumeration owns cleanup after a non-terminal child error.
        }
        throw error;
      }
      return { processIdentity: `${child.pid ?? 0}:${runtimeSha}:${operation.commandId}` };
    },
    async observe(target, signal) {
      const adminUrl = target === "candidate" ? config.candidateAdminUrl : config.previousAdminUrl;
      const runtimeSha = target === "candidate" ? context.candidateSha : context.previousRuntimeSha;
      const runtimeLabel = target === "candidate" ? context.candidateRuntimeLabel : context.previousRuntimeLabel;
      const managed = processes.get(target);
      if (!managed) fail("controlled_runtime_observe_without_start");
      let lastError: unknown;
      while (!signal.aborted) {
        try {
          if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
            fail("controlled_runtime_process_exited_before_observation");
          }
          const [admin, state, recorder] = await Promise.all([
            fetch(adminUrl, { signal }),
            queryControlledRuntimeState(context.databaseUrl, context.terminalLegacyBinding),
            readRuntimeRehearsalRecorder(recorderPath(target), target)
          ]);
          const stdout = Buffer.concat(managed.stdout).toString("utf8");
          const workerScheduleCount = stdout.match(/startup_work_schedule_started/gu)?.length ?? 0;
          const childPid = managed.child.pid;
          if (typeof childPid !== "number" || !Number.isSafeInteger(childPid) || childPid <= 0) {
            fail("controlled_runtime_child_pid_missing");
          }
          const runtimeInstanceCount = countControlledRuntimeProcesses(enumerateProcesses(), {
            entrypoint: resolve(target === "candidate" ? config.candidateWorktree : config.previousWorktree, "src/index.ts"),
            preloadPath: runtimePreloadPath,
            expectedPid: childPid
          });
          if (admin.status !== 200 || workerScheduleCount !== 1 || runtimeInstanceCount !== 1) fail("controlled_runtime_observation_not_ready");
          return {
            adminHealthStatus: admin.status,
            observedSha: runtimeSha,
            observedLabel: runtimeLabel,
            versionResponseText: recorder.versionResponseText,
            versionResponseSha256: recorder.versionResponseSha256,
            runtimeInstanceCount,
            workerScheduleCount,
            telegramSendCount: 0,
            advisoryLockCount: state.advisoryLockCount
          };
        } catch (error) {
          lastError = error;
          await waitForControlledRuntimeRetry(signal);
        }
      }
      throw lastError instanceof Error ? lastError : new Error("controlled_runtime_observe_aborted");
    },
    async stop(target, operation) {
      const managed = processes.get(target);
      if (!managed) {
        if (!forceCleanedTargets.delete(target)) fail("controlled_runtime_stop_without_start");
        return { exitCode: null, signal: "SIGKILL", forced: true, stdout: "", stderr: "", timedOut: true };
      }
      const { child } = managed;
      let forceTimer: NodeJS.Timeout | undefined;
      let forced = false;
      let terminal = false;
      const onAbort = () => {
        forced = true;
        child.kill("SIGKILL");
      };
      operation.signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (child.exitCode === null) child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            forced = true;
            child.kill("SIGKILL");
          }
        }, Math.min(5_000, operation.timeoutMs));
        const exited = await waitForManagedRuntimeExit(child);
        terminal = true;
        return {
          exitCode: exited.code,
          signal: exited.signal,
          forced,
          stdout: Buffer.concat(managed.stdout).toString("utf8"),
          stderr: Buffer.concat(managed.stderr).toString("utf8"),
          timedOut: operation.signal.aborted
        };
      } finally {
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        operation.signal.removeEventListener("abort", onAbort);
        if (terminal) processes.delete(target);
      }
    },
    async forceCleanup(target, signal) {
      const managed = processes.get(target);
      if (managed && managed.child.exitCode === null && managed.child.signalCode === null) {
        managed.child.kill("SIGKILL");
      }
      const entrypoint = resolve(
        target === "candidate" ? config.candidateWorktree : config.previousWorktree,
        "src/index.ts"
      );
      while (!signal.aborted) {
        const matching = matchingControlledRuntimeProcesses(enumerateProcesses(), {
          entrypoint,
          preloadPath: runtimePreloadPath
        });
        const managedStillRunning = managed !== undefined
          && typeof managed.child.pid === "number"
          && managed.child.exitCode === null
          && managed.child.signalCode === null;
        if (matching.length === 0 && !managedStillRunning) {
          processes.delete(target);
          forceCleanedTargets.add(target);
          return { managedChildCount: 0, runtimeProcessCount: 0 };
        }
        for (const record of matching) {
          if (record.pid !== process.pid) {
            const identityStillMatches = matchingControlledRuntimeProcesses(enumerateProcesses(), {
              entrypoint,
              preloadPath: runtimePreloadPath
            })
              .some((current) => current.pid === record.pid);
            if (identityStillMatches) {
              try { process.kill(record.pid, "SIGKILL"); } catch { /* exact zero is verified on the next enumeration */ }
            }
          }
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      fail("controlled_runtime_force_cleanup_aborted");
    }
  };
}

function labelIncludesSha(label: unknown, sha: string, expected?: string): label is string {
  return typeof label === "string"
    && label.length > 0
    && !/[\u0000-\u001f\u007f]/.test(label)
    && label.includes(sha.slice(0, 8))
    && (expected === undefined || label === expected);
}

function validateHealth(
  value: unknown,
  sha: string,
  commandId: "runtime_sanitized_rehearsal" | "rollback_rehearsal",
  startEvidenceSha256: string,
  expectedLabel?: string
): RuntimeHealthEvidenceV1 {
  const health = record(value, "runtime_rehearsal_health_invalid");
  exactKeys(health, [
    "observedSha", "observedLabel", "startCommandId", "startCommandTemplateSha256", "startEvidenceSha256",
    "adminHealthStatus", "runtimeInstanceCount", "workerScheduleCount"
  ], "runtime_rehearsal_health_shape_invalid");
  if (health.observedSha !== sha || !labelIncludesSha(health.observedLabel, sha, expectedLabel)) fail("runtime_rehearsal_health_identity_mismatch");
  if (health.startCommandId !== commandId
      || health.startCommandTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256[commandId]
      || health.startEvidenceSha256 !== startEvidenceSha256) fail("runtime_rehearsal_start_evidence_mismatch");
  if (health.adminHealthStatus !== 200 || health.runtimeInstanceCount !== 1 || health.workerScheduleCount !== 1) fail("runtime_rehearsal_health_failed");
  return health as RuntimeHealthEvidenceV1;
}

export function validateRuntimeRehearsalEvidence(
  value: unknown,
  expected: RuntimeRehearsalExpected
): RuntimeRehearsalEvidenceV1 {
  assertExpected(expected);
  assertNoSecretLikeArtifactValues(value);
  const evidence = record(value, "runtime_rehearsal_invalid");
  exactKeys(evidence, [
    "version", "candidateSha", "previousRuntimeSha", "databaseRole", "sanitizedDatabaseFingerprintSha256",
    "productionCloneDatabaseFingerprintSha256", "schemaEvidenceSha256", "candidateStartEvidenceSha256",
    "previousStartEvidenceSha256", "telegramTransport", "outboundSendCount", "candidate", "previous"
  ], "runtime_rehearsal_shape_invalid");
  if (evidence.version !== "runtime-rehearsal-evidence-v1") fail("runtime_rehearsal_version_invalid");
  if (evidence.candidateSha !== expected.candidateSha || evidence.previousRuntimeSha !== expected.previousRuntimeSha) fail("runtime_rehearsal_sha_mismatch");
  if (evidence.databaseRole !== "runtime_sanitized") fail("runtime_rehearsal_database_role_invalid");
  if (evidence.sanitizedDatabaseFingerprintSha256 !== expected.sanitizedDatabaseFingerprintSha256) fail("runtime_rehearsal_database_fingerprint_mismatch");
  if (evidence.productionCloneDatabaseFingerprintSha256 !== expected.productionCloneDatabaseFingerprintSha256
      || evidence.productionCloneDatabaseFingerprintSha256 === evidence.sanitizedDatabaseFingerprintSha256) {
    fail("runtime_rehearsal_production_clone_identity_rejected");
  }
  if (evidence.schemaEvidenceSha256 !== expected.schemaEvidenceSha256
      || evidence.candidateStartEvidenceSha256 !== expected.candidateStartEvidenceSha256
      || evidence.previousStartEvidenceSha256 !== expected.previousStartEvidenceSha256) {
    fail("runtime_rehearsal_independent_evidence_mismatch");
  }
  if (evidence.telegramTransport !== "recording_disabled" || evidence.outboundSendCount !== 0) fail("runtime_rehearsal_transport_not_disabled");
  const candidate = validateHealth(
    evidence.candidate,
    expected.candidateSha,
    "runtime_sanitized_rehearsal",
    expected.candidateStartEvidenceSha256,
    expected.candidateRuntimeLabel
  );
  const previous = validateHealth(
    evidence.previous,
    expected.previousRuntimeSha,
    "rollback_rehearsal",
    expected.previousStartEvidenceSha256,
    expected.previousRuntimeLabel
  );
  return { ...(evidence as RuntimeRehearsalEvidenceV1), candidate, previous };
}

function validateSchemaVerification(value: unknown): RollbackRehearsalEvidenceV1["schemaVerification"] {
  const schema = record(value, "rollback_schema_invalid");
  exactKeys(schema, ["verified", "version", "filename", "checksumSha256", "shortChecksum"], "rollback_schema_shape_invalid");
  if (schema.verified !== true || schema.version !== 32
      || schema.filename !== "032_telegram_runtime_forensics_data_contracts.sql"
      || schema.checksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM
      || schema.shortChecksum !== APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)) fail("rollback_schema_unverified");
  return schema as RollbackRehearsalEvidenceV1["schemaVerification"];
}

export function validateRollbackRehearsalEvidence(
  value: unknown,
  expected: RuntimeRehearsalExpected
): RollbackRehearsalEvidenceV1 {
  assertExpected(expected);
  assertNoSecretLikeArtifactValues(value);
  const evidence = record(value, "rollback_rehearsal_invalid");
  exactKeys(evidence, [
    "candidateSha", "previousRuntimeSha", "previousRuntimeLabel", "startCommandId", "startCommandTemplateSha256",
    "schemaEvidenceSha256", "previousStartEvidenceSha256", "migratedSanitizedDatabaseFingerprintSha256",
    "schemaVerification", "telegramTransport", "outboundSendCount",
    "previousRuntimeStarted", "adminHealthStatus", "runtimeInstanceCount", "workerScheduleCount",
    "observedPreviousVersionSha", "observedPreviousVersionLabel", "conservativeAllowanceMirrorsVerified",
    "terminalLegacyPopulationBefore", "terminalLegacyPopulationAfter", "completedResultsSha256Before",
    "completedResultsSha256After", "sentFingerprintSetSha256Before", "sentFingerprintSetSha256After",
    "remainingProcessCount", "remainingAdvisoryLockCount"
  ], "rollback_rehearsal_shape_invalid");
  if (evidence.candidateSha !== expected.candidateSha || evidence.previousRuntimeSha !== expected.previousRuntimeSha) fail("rollback_rehearsal_sha_mismatch");
  if (!labelIncludesSha(evidence.previousRuntimeLabel, expected.previousRuntimeSha, expected.previousRuntimeLabel)) fail("rollback_rehearsal_label_mismatch");
  if (evidence.startCommandId !== "rollback_rehearsal"
      || evidence.startCommandTemplateSha256 !== ROLLBACK_REHEARSAL_COMMAND_TEMPLATE_SHA256) fail("rollback_rehearsal_command_mismatch");
  if (evidence.schemaEvidenceSha256 !== expected.schemaEvidenceSha256
      || evidence.previousStartEvidenceSha256 !== expected.previousStartEvidenceSha256) {
    fail("rollback_rehearsal_independent_evidence_mismatch");
  }
  if (evidence.migratedSanitizedDatabaseFingerprintSha256 !== expected.sanitizedDatabaseFingerprintSha256) fail("rollback_rehearsal_database_mismatch");
  validateSchemaVerification(evidence.schemaVerification);
  if (evidence.telegramTransport !== "recording_disabled" || evidence.outboundSendCount !== 0) fail("rollback_rehearsal_transport_not_disabled");
  if (evidence.previousRuntimeStarted !== true || evidence.adminHealthStatus !== 200
      || evidence.runtimeInstanceCount !== 1 || evidence.workerScheduleCount !== 1) fail("rollback_rehearsal_runtime_unhealthy");
  if (evidence.observedPreviousVersionSha !== expected.previousRuntimeSha
      || evidence.observedPreviousVersionLabel !== evidence.previousRuntimeLabel) fail("rollback_rehearsal_version_mismatch");
  if (evidence.conservativeAllowanceMirrorsVerified !== true) fail("rollback_rehearsal_allowance_mirror_unsafe");
  assertTerminalLegacyPopulationUnchanged(evidence.terminalLegacyPopulationBefore, evidence.terminalLegacyPopulationAfter);
  for (const field of ["completedResultsSha256Before", "completedResultsSha256After", "sentFingerprintSetSha256Before", "sentFingerprintSetSha256After"] as const) {
    if (typeof evidence[field] !== "string" || !SHA256.test(evidence[field] as string)) fail("rollback_rehearsal_hash_invalid");
  }
  if (evidence.completedResultsSha256Before !== evidence.completedResultsSha256After
      || evidence.sentFingerprintSetSha256Before !== evidence.sentFingerprintSetSha256After) fail("rollback_rehearsal_immutable_state_changed");
  if (evidence.remainingProcessCount !== 0 || evidence.remainingAdvisoryLockCount !== 0) fail("rollback_rehearsal_cleanup_failed");
  return evidence as RollbackRehearsalEvidenceV1;
}

export function validateSchemaEvidenceForRehearsal(
  value: unknown,
  expected: {
    candidateSha: string;
    databaseRole: "clean" | "runtime_sanitized" | "production_clone";
    databaseFingerprintSha256: string;
  }
): void {
  const schema = record(value, "runtime_schema_evidence_invalid");
  assertNoSecretLikeArtifactValues(schema);
  exactKeys(schema, [
    "candidateSha", "databaseRole", "databaseFingerprintSha256", "migrationFilename",
    "candidateBytesChecksumSha256", "receiptChecksumSha256", "shortChecksum", "postconditionsSha256",
    "firstApply", "secondApply"
  ], "runtime_schema_evidence_shape_invalid");
  if (schema.candidateSha !== expected.candidateSha || schema.databaseRole !== expected.databaseRole
      || schema.databaseFingerprintSha256 !== expected.databaseFingerprintSha256
      || schema.migrationFilename !== "032_telegram_runtime_forensics_data_contracts.sql"
      || schema.candidateBytesChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM
      || schema.receiptChecksumSha256 !== APPROVED_SCHEMA_032_CHECKSUM
      || schema.shortChecksum !== APPROVED_SCHEMA_032_CHECKSUM.slice(0, 12)
      || typeof schema.postconditionsSha256 !== "string" || !SHA256.test(schema.postconditionsSha256)
      || (schema.firstApply !== "applied" && schema.firstApply !== "already_verified")
      || schema.secondApply !== "already_verified") {
    fail("runtime_schema_evidence_mismatch");
  }
}

export function buildRuntimeRehearsalExpectedFromArtifactBytes(input: {
  candidateSha: string;
  previousRuntimeSha: string;
  sanitizedDatabaseFingerprintSha256: string;
  productionCloneDatabaseFingerprintSha256: string;
  schemaEvidenceBytes: Buffer;
  candidateStartEvidenceBytes: Buffer;
  previousStartEvidenceBytes: Buffer;
  candidateRuntimeLabel?: string;
  previousRuntimeLabel?: string;
}): RuntimeRehearsalExpected {
  validateSchemaEvidenceForRehearsal(JSON.parse(input.schemaEvidenceBytes.toString("utf8")) as unknown, {
    candidateSha: input.candidateSha,
    databaseRole: "runtime_sanitized",
    databaseFingerprintSha256: input.sanitizedDatabaseFingerprintSha256
  });
  validateRuntimeStartCommandEvidenceBytes(
    input.candidateStartEvidenceBytes,
    input.candidateSha,
    input.candidateRuntimeLabel,
    "runtime_sanitized_rehearsal"
  );
  validateRuntimeStartCommandEvidenceBytes(
    input.previousStartEvidenceBytes,
    input.previousRuntimeSha,
    input.previousRuntimeLabel,
    "rollback_rehearsal"
  );
  return {
    candidateSha: input.candidateSha,
    previousRuntimeSha: input.previousRuntimeSha,
    sanitizedDatabaseFingerprintSha256: input.sanitizedDatabaseFingerprintSha256,
    productionCloneDatabaseFingerprintSha256: input.productionCloneDatabaseFingerprintSha256,
    schemaEvidenceSha256: createHash("sha256").update(input.schemaEvidenceBytes).digest("hex"),
    candidateStartEvidenceSha256: createHash("sha256").update(input.candidateStartEvidenceBytes).digest("hex"),
    previousStartEvidenceSha256: createHash("sha256").update(input.previousStartEvidenceBytes).digest("hex"),
    candidateRuntimeLabel: input.candidateRuntimeLabel,
    previousRuntimeLabel: input.previousRuntimeLabel
  };
}

function validateRuntimeStartCommandEvidenceBytes(
  bytes: Buffer,
  sha: string,
  label: string | undefined,
  commandId: "runtime_sanitized_rehearsal" | "rollback_rehearsal"
): void {
  if (!label) fail("runtime_start_label_required");
  const capture = record(JSON.parse(bytes.toString("utf8")) as unknown, "runtime_start_evidence_invalid");
  assertNoSecretLikeArtifactValues(capture);
  exactKeys(capture, [
    "version", "runtimeSha", "runtimeLabel", "commandId", "redactedTemplateSha256", "exitCode"
  ], "runtime_start_evidence_shape_invalid");
  if (capture.version !== "runtime-start-command-evidence-v1" || capture.runtimeSha !== sha
      || capture.runtimeLabel !== label || capture.commandId !== commandId
      || capture.redactedTemplateSha256 !== REMEDIATION_COMMAND_TEMPLATE_SHA256[commandId]
      || capture.exitCode !== 0) fail("runtime_start_evidence_mismatch");
}

export function buildRuntimeStartCommandEvidenceBytes(
  runtimeSha: string,
  runtimeLabel: string,
  commandId: "runtime_sanitized_rehearsal" | "rollback_rehearsal"
): Buffer {
  if (!SHA40.test(runtimeSha) || !labelIncludesSha(runtimeLabel, runtimeSha)) {
    fail("runtime_start_identity_invalid");
  }
  return Buffer.from(JSON.stringify({
    version: "runtime-start-command-evidence-v1",
    runtimeSha,
    runtimeLabel,
    commandId,
    redactedTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256[commandId],
    exitCode: 0
  }), "utf8");
}

function isOutside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.startsWith("..") || isAbsolute(path);
}

async function readStableOperationalArtifact(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  const physical = resolve(await realpath(path));
  const samePath = process.platform === "win32"
    ? physical.toLowerCase() === path.toLowerCase()
    : physical === path;
  if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath) fail("controlled_runtime_artifact_invalid");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      fail("controlled_runtime_artifact_changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || bytes.length !== after.size) {
      fail("controlled_runtime_artifact_changed");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const [artifactRootInput] = process.argv.slice(2);
  const candidateSha = process.env.RELEASE_SHA ?? "";
  const candidateRuntimeLabel = process.env.PLAN5_CANDIDATE_RUNTIME_LABEL ?? "";
  const timeoutMs = Number(process.env.PLAN5_RUNTIME_REHEARSAL_TIMEOUT_MS ?? "30000");
  if (!artifactRootInput || process.argv.length !== 3 || !candidateRuntimeLabel
  ) fail("controlled_runtime_cli_input_invalid");
  const artifactRoot = resolve(await realpath(resolve(artifactRootInput)));
  const artifactRootMetadata = await lstat(artifactRoot);
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (!artifactRootMetadata.isDirectory() || artifactRootMetadata.isSymbolicLink()
      || !isOutside(repositoryRoot, artifactRoot)) fail("controlled_runtime_artifact_root_invalid");
  const evaluatedAt = new Date().toISOString();
  const { readCurrentTask0BReleaseRevalidation } = await import("./captureTask0BPreflight");
  const currentTask0B = await readCurrentTask0BReleaseRevalidation(artifactRoot, evaluatedAt);
  const task0bBytes = currentTask0B.frozenBytes;
  const task0b = validateTask0BReleaseFreezeEvidence(
    JSON.parse(task0bBytes.toString("utf8")) as unknown,
    candidateSha
  );
  const operationalConfigBytes = await readStableOperationalArtifact(resolve(artifactRoot, task0b.operationalConfigPath));
  const operationalConfig = validateControlledRuntimeOperationalConfig(operationalConfigBytes, task0b);
  if (resolve(operationalConfig.candidateWorktree) !== repositoryRoot) {
    fail("controlled_runtime_candidate_worktree_invalid");
  }
  attestControlledRuntimeWorktree(operationalConfig.candidateWorktree, candidateSha);
  attestControlledRuntimeWorktree(operationalConfig.previousWorktree, task0b.previousRuntimeSha);
  const databaseUrl = process.env[operationalConfig.databaseUrlEnv] ?? "";
  const databaseTarget = new URL(databaseUrl);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseTarget.hostname)
      || decodeURIComponent(databaseTarget.pathname.slice(1)) !== "tron_watch_plan5_runtime_sanitized"
      || databaseTarget.search || databaseTarget.hash) fail("controlled_runtime_database_target_invalid");
  const [runtimeSchemaBytes, productionCloneSchemaBytes] = await Promise.all([
    readStableOperationalArtifact(resolve(artifactRoot, "schema-runtime-sanitized-evidence.json")),
    readStableOperationalArtifact(resolve(artifactRoot, "schema-production-clone-evidence.json"))
  ]);
  const productionCloneSchema = record(
    JSON.parse(productionCloneSchemaBytes.toString("utf8")) as unknown,
    "controlled_runtime_production_clone_schema_invalid"
  );
  if (typeof productionCloneSchema.databaseFingerprintSha256 !== "string") {
    fail("controlled_runtime_production_clone_schema_invalid");
  }
  const productionCloneFingerprint = productionCloneSchema.databaseFingerprintSha256;
  const candidateStartEvidenceBytes = buildRuntimeStartCommandEvidenceBytes(
    candidateSha,
    candidateRuntimeLabel,
    "runtime_sanitized_rehearsal"
  );
  const previousStartEvidenceBytes = buildRuntimeStartCommandEvidenceBytes(
    task0b.previousRuntimeSha,
    task0b.previousRuntimeLabel,
    "rollback_rehearsal"
  );
  const evidenceExpected = buildRuntimeRehearsalExpectedFromArtifactBytes({
    candidateSha,
    previousRuntimeSha: task0b.previousRuntimeSha,
    sanitizedDatabaseFingerprintSha256: task0b.databaseFingerprintSha256,
    productionCloneDatabaseFingerprintSha256: productionCloneFingerprint,
    schemaEvidenceBytes: runtimeSchemaBytes,
    candidateStartEvidenceBytes,
    previousStartEvidenceBytes,
    candidateRuntimeLabel,
    previousRuntimeLabel: task0b.previousRuntimeLabel
  });
  const dependencies = createControlledRuntimeCliDependencies(operationalConfig, {
    artifactRoot,
    candidateSha,
    previousRuntimeSha: task0b.previousRuntimeSha,
    candidateRuntimeLabel,
    previousRuntimeLabel: task0b.previousRuntimeLabel,
    databaseUrl,
    terminalLegacyBinding: deriveTerminalLegacyFreezeBindingFromCurrentRevalidation(
      task0bBytes,
      candidateSha,
      currentTask0B.evidence,
      currentTask0B.freeze,
      evaluatedAt
    )
  });
  const provenance = await runControlledRuntimeRehearsalCli({
    candidateSha,
    previousRuntimeSha: task0b.previousRuntimeSha,
    candidateRuntimeLabel,
    previousRuntimeLabel: task0b.previousRuntimeLabel,
    timeoutMs,
    evidenceExpected
  }, dependencies, async (filename, bytes) => {
    await writeFile(resolve(artifactRoot, filename), bytes, { flag: "wx" });
  }, {
    candidateStartEvidenceBytes,
    previousStartEvidenceBytes
  });
  process.stdout.write(`${JSON.stringify({
    status: "captured",
    commandId: "runtime_sanitized_rehearsal",
    subprocessCapturesSha256: provenance.subprocessCapturesSha256,
    queryCapturesSha256: provenance.queryCapturesSha256
  })}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch(() => {
    process.stderr.write("rollback_rehearsal_invalid\n");
    process.exitCode = 1;
  });
}
