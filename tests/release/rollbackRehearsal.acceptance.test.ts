import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { formatRuntimeVersion } from "../../src/runtime/runtimeVersion";
import {
  CANDIDATE_SHA,
  CANDIDATE_START_EVIDENCE_SHA256,
  PREVIOUS_RUNTIME_SHA,
  PREVIOUS_RUNTIME_LABEL,
  PREVIOUS_START_EVIDENCE_SHA256,
  COMMAND_TEMPLATE_SHA256,
  PRODUCTION_CLONE_DATABASE_FINGERPRINT,
  RUNTIME_LABEL,
  RUNTIME_SCHEMA_EVIDENCE_SHA256,
  SANITIZED_DATABASE_FINGERPRINT,
  buildRollbackRehearsalEvidence,
  buildRuntimeRehearsalEvidence,
  buildRuntimeVersion,
  buildTerminalLegacyPopulation,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type RollbackApi = {
  validateRollbackRehearsalEvidence(value: unknown, expected: {
    candidateSha: string;
    previousRuntimeSha: string;
    sanitizedDatabaseFingerprintSha256: string;
  }): unknown;
};

it("[REQ-35][REQ-38][ROLLBACK-REHEARSAL] requires the exact previous SHA to run safely on migrated sanitized schema 032", async () => {
  const modulePath: string = "../../scripts/rehearseRemediationRuntime";
  let api: RollbackApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<RollbackApi>;
    if (typeof loaded.validateRollbackRehearsalEvidence !== "function") throw new Error("validator export missing");
    api = loaded as RollbackApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: rollback rehearsal validator", { cause: error });
  }
  const expected = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceSha256: RUNTIME_SCHEMA_EVIDENCE_SHA256,
    candidateStartEvidenceSha256: CANDIDATE_START_EVIDENCE_SHA256,
    previousStartEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  };
  const valid = buildRollbackRehearsalEvidence();
  expect(() => api.validateRollbackRehearsalEvidence(valid, expected)).not.toThrow();
  const invalid = [
    (value: any) => { value.previousRuntimeSha = "f".repeat(40); },
    (value: any) => { value.migratedSanitizedDatabaseFingerprintSha256 = "f".repeat(64); },
    (value: any) => { value.schemaVerification.verified = false; },
    (value: any) => { value.schemaVerification.version = 31; },
    (value: any) => { value.telegramTransport = "live"; },
    (value: any) => { value.outboundSendCount = 1; },
    (value: any) => { value.previousRuntimeStarted = false; },
    (value: any) => { value.adminHealthStatus = 503; },
    (value: any) => { value.runtimeInstanceCount = 2; },
    (value: any) => { value.workerScheduleCount = 2; },
    (value: any) => { value.observedPreviousVersionSha = "f".repeat(40); },
    (value: any) => { value.conservativeAllowanceMirrorsVerified = false; },
    (value: any) => { value.terminalLegacyPopulationAfter.populationCount += 1; },
    (value: any) => { value.completedResultsSha256After = "f".repeat(64); },
    (value: any) => { value.sentFingerprintSetSha256After = "f".repeat(64); },
    (value: any) => { value.remainingProcessCount = 1; },
    (value: any) => { value.remainingAdvisoryLockCount = 1; }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(valid);
    mutate(value);
    expect(() => api.validateRollbackRehearsalEvidence(value, expected)).toThrow();
  }
});

it("[REQ-35][PLAN5-RUNTIME-SANITIZED] refuses production clone identity live transport and unhealthy runtimes", async () => {
  const api = await import("../../scripts/rehearseRemediationRuntime");
  const expected = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceSha256: RUNTIME_SCHEMA_EVIDENCE_SHA256,
    candidateStartEvidenceSha256: CANDIDATE_START_EVIDENCE_SHA256,
    previousStartEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  };
  expect(() => api.validateRuntimeRehearsalEvidence(buildRuntimeRehearsalEvidence(), expected)).not.toThrow();
  const invalid = [
    (value: any) => { value.databaseRole = "production_clone"; },
    (value: any) => { value.productionCloneDatabaseFingerprintSha256 = "d".repeat(64); },
    (value: any) => { value.sanitizedDatabaseFingerprintSha256 = value.productionCloneDatabaseFingerprintSha256; },
    (value: any) => { value.schemaEvidenceSha256 = "d".repeat(64); },
    (value: any) => { value.telegramTransport = "live"; },
    (value: any) => { value.outboundSendCount = 1; },
    (value: any) => { value.candidate.observedSha = "f".repeat(40); },
    (value: any) => { value.candidate.startCommandId = "rollback_rehearsal"; },
    (value: any) => { value.candidate.startCommandTemplateSha256 = "f".repeat(64); },
    (value: any) => { value.previous.startEvidenceSha256 = "f".repeat(64); },
    (value: any) => { value.previous.adminHealthStatus = 503; },
    (value: any) => { value.candidate.workerScheduleCount = 2; }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(buildRuntimeRehearsalEvidence());
    mutate(value);
    expect(() => api.validateRuntimeRehearsalEvidence(value, expected)).toThrow();
  }
});

it("[REQ-38][ROLLBACK-SECRETS] rejects nested secrets and unapproved rollback command hashes", async () => {
  const api = await import("../../scripts/rehearseRemediationRuntime");
  const expected = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceSha256: RUNTIME_SCHEMA_EVIDENCE_SHA256,
    candidateStartEvidenceSha256: CANDIDATE_START_EVIDENCE_SHA256,
    previousStartEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  };
  const wrongCommand: any = cloneFixture(buildRollbackRehearsalEvidence());
  wrongCommand.startCommandTemplateSha256 = "f".repeat(64);
  expect(() => api.validateRollbackRehearsalEvidence(wrongCommand, expected)).toThrow();
  const wrongBinding: any = cloneFixture(buildRollbackRehearsalEvidence());
  wrongBinding.previousStartEvidenceSha256 = "f".repeat(64);
  expect(() => api.validateRollbackRehearsalEvidence(wrongBinding, expected)).toThrow();
  const secret: any = cloneFixture(buildRollbackRehearsalEvidence());
  secret.nested = { databaseUrl: "postgresql://user:secret@localhost/db" };
  expect(() => api.validateRollbackRehearsalEvidence(secret, expected)).toThrow(/secret/i);
});

it("[REQ-35][RUNTIME-INDEPENDENT-EVIDENCE] binds rehearsal claims to separately captured schema and start artifacts", async () => {
  const api = await import("../../scripts/rehearseRemediationRuntime");
  const schemaEvidenceBytes = Buffer.from(JSON.stringify({
    candidateSha: CANDIDATE_SHA,
    databaseRole: "runtime_sanitized",
    databaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    candidateBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    shortChecksum: "41217f64c33c",
    postconditionsSha256: "d".repeat(64),
    firstApply: "applied",
    secondApply: "already_verified"
  }));
  const candidateStartEvidenceBytes = Buffer.from(JSON.stringify({
    version: "runtime-start-command-evidence-v1",
    runtimeSha: CANDIDATE_SHA,
    runtimeLabel: RUNTIME_LABEL,
    commandId: "runtime_sanitized_rehearsal",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    exitCode: 0
  }));
  const previousStartEvidenceBytes = Buffer.from(JSON.stringify({
    version: "runtime-start-command-evidence-v1",
    runtimeSha: PREVIOUS_RUNTIME_SHA,
    runtimeLabel: PREVIOUS_RUNTIME_LABEL,
    commandId: "rollback_rehearsal",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    exitCode: 0
  }));
  const expected = api.buildRuntimeRehearsalExpectedFromArtifactBytes({
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceBytes,
    candidateStartEvidenceBytes,
    previousStartEvidenceBytes,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  });
  const evidence: any = cloneFixture(buildRuntimeRehearsalEvidence());
  evidence.schemaEvidenceSha256 = expected.schemaEvidenceSha256;
  evidence.candidateStartEvidenceSha256 = expected.candidateStartEvidenceSha256;
  evidence.previousStartEvidenceSha256 = expected.previousStartEvidenceSha256;
  evidence.candidate.startEvidenceSha256 = expected.candidateStartEvidenceSha256;
  evidence.previous.startEvidenceSha256 = expected.previousStartEvidenceSha256;
  expect(() => api.validateRuntimeRehearsalEvidence(evidence, expected)).not.toThrow();

  expect(() => api.buildRuntimeRehearsalExpectedFromArtifactBytes({
    ...expected,
    schemaEvidenceBytes: Buffer.from(JSON.stringify({
      ...JSON.parse(schemaEvidenceBytes.toString("utf8")),
      receiptChecksumSha256: "f".repeat(64)
    })),
    candidateStartEvidenceBytes,
    previousStartEvidenceBytes
  })).toThrow();
});

it("[REQ-35][CONTROLLED-RUNTIME-EXECUTOR] invokes allowlisted start observe stop operations and fails closed", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  const calls: string[] = [];
  const terminalLegacyPopulation = buildTerminalLegacyPopulation();
  const emptyAllowanceMirrorHash = createHash("sha256").update("[]").digest("hex");
  const evidenceExpected = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceSha256: RUNTIME_SCHEMA_EVIDENCE_SHA256,
    candidateStartEvidenceSha256: CANDIDATE_START_EVIDENCE_SHA256,
    previousStartEvidenceSha256: PREVIOUS_START_EVIDENCE_SHA256,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  };
  const executeInput = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    timeoutMs: 15_000,
    evidenceExpected
  };
  const dependencies = {
    async captureState(stage: string) {
      calls.push(`state:${stage}`);
      return { schemaVerified: true, allowanceStateSha256: "1".repeat(64), allowanceMirrorMismatchCount: 0, allowanceMirrorMismatchSha256: emptyAllowanceMirrorHash, completedResultsSha256: "2".repeat(64), sentFingerprintSetSha256: "3".repeat(64), advisoryLockCount: 0, telegramSendCount: 0, runtimeProcessCount: 0, terminalLegacyPopulation };
    },
    async start(target: string, operation: any) {
      calls.push(`start:${target}:${operation.commandId}:${operation.timeoutMs}`);
      return { processIdentity: target === "candidate" ? "candidate-process-42" : "previous-process-43" };
    },
    async observe(target: string) {
      calls.push(`observe:${target}`);
      const version = buildRuntimeVersion();
      const versionResponseText = target === "candidate"
        ? formatRuntimeVersion(version as any, "ru")
        : [
            "<b>Статус runtime</b>",
            "",
            `<b>Инстанс</b>: <code>${PREVIOUS_RUNTIME_LABEL}</code>`,
            "<b>Режим</b>: <code>marked</code>",
            "По этой строке можно понять, какая версия runtime ответила в Telegram."
          ].join("\n");
      return {
        adminHealthStatus: 200,
        observedSha: target === "candidate" ? CANDIDATE_SHA : PREVIOUS_RUNTIME_SHA,
        observedLabel: target === "candidate" ? RUNTIME_LABEL : PREVIOUS_RUNTIME_LABEL,
        versionResponseText,
        versionResponseSha256: createHash("sha256").update(versionResponseText).digest("hex"),
        runtimeInstanceCount: 1,
        workerScheduleCount: 1,
        telegramSendCount: 0,
        advisoryLockCount: 0
      };
    },
    async stop(target: string, operation: any) {
      calls.push(`stop:${target}:${operation.commandId}:${operation.timeoutMs}`);
      return { exitCode: null, signal: "SIGTERM", forced: false, stdout: `${target}-stdout`, stderr: "", timedOut: false };
    },
    async forceCleanup() {
      return { managedChildCount: 0, runtimeProcessCount: 0 };
    }
  };
  const result = await api.executeControlledRuntimeRehearsal(executeInput, dependencies);
  expect(calls).toEqual([
    "state:before", "start:candidate:runtime_sanitized_rehearsal:15000", "observe:candidate", "stop:candidate:runtime_sanitized_stop:15000",
    "start:previous:rollback_rehearsal:15000", "observe:previous", "stop:previous:rollback_stop:15000", "state:after"
  ]);
  expect(result.provenance.version).toBe("controlled-runtime-rehearsal-v1");
  expect(result.provenance.subprocessCapturesSha256).toBe(
    api.sha256ControlledRuntimeCapture(result.subprocessCaptureBytes)
  );
  expect(result.provenance.queryCapturesSha256).toBe(
    api.sha256ControlledRuntimeCapture(result.queryCaptureBytes)
  );
  expect(JSON.parse(result.runtimeEvidenceBytes.toString("utf8"))).toMatchObject({
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA
  });
  expect(JSON.parse(result.rollbackEvidenceBytes.toString("utf8"))).toMatchObject({
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    conservativeAllowanceMirrorsVerified: true,
    remainingProcessCount: 0
  });
  const subprocessCapture = JSON.parse(result.subprocessCaptureBytes.toString("utf8"));
  expect(subprocessCapture.candidateProcess.processIdentitySha256).toBe(
    createHash("sha256").update("candidate-process-42").digest("hex")
  );
  expect(subprocessCapture.candidateProcess.stdoutSha256).toBe(
    createHash("sha256").update("candidate-stdout").digest("hex")
  );
  expect(() => api.validateControlledRuntimeRehearsalProvenance(result.provenance, {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  })).toThrow(/capture/i);
  const artifacts = new Map<string, Buffer>();
  const candidateStartEvidenceBytes = api.buildRuntimeStartCommandEvidenceBytes(
    CANDIDATE_SHA,
    RUNTIME_LABEL,
    "runtime_sanitized_rehearsal"
  );
  const previousStartEvidenceBytes = api.buildRuntimeStartCommandEvidenceBytes(
    PREVIOUS_RUNTIME_SHA,
    PREVIOUS_RUNTIME_LABEL,
    "rollback_rehearsal"
  );
  const cliInput = {
    ...executeInput,
    evidenceExpected: {
      ...executeInput.evidenceExpected,
      candidateStartEvidenceSha256: createHash("sha256").update(candidateStartEvidenceBytes).digest("hex"),
      previousStartEvidenceSha256: createHash("sha256").update(previousStartEvidenceBytes).digest("hex")
    }
  };
  await api.runControlledRuntimeRehearsalCli(cliInput, dependencies, async (filename: string, bytes: Buffer) => {
    artifacts.set(filename, bytes);
  }, {
    candidateStartEvidenceBytes,
    previousStartEvidenceBytes
  });
  expect([...artifacts.keys()]).toEqual([
    "runtime-candidate-start-evidence.json",
    "runtime-previous-start-evidence.json",
    "runtime-subprocess-captures.json",
    "runtime-query-captures.json",
    "runtime-operational-observation.json",
    "runtime-rehearsal.json",
    "rollback-rehearsal.json"
  ]);
  expect(artifacts.get("runtime-candidate-start-evidence.json")).toEqual(candidateStartEvidenceBytes);
  expect(artifacts.get("runtime-previous-start-evidence.json")).toEqual(previousStartEvidenceBytes);
  expect(() => api.validateControlledRuntimeRehearsalProvenance(result.provenance, {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  }, {
    subprocessCaptureBytes: result.subprocessCaptureBytes,
    queryCaptureBytes: result.queryCaptureBytes
  })).not.toThrow();
  const tamperedQueryCapture = Buffer.from(result.queryCaptureBytes);
  tamperedQueryCapture[tamperedQueryCapture.length - 2] ^= 1;
  expect(() => api.validateControlledRuntimeRehearsalProvenance(result.provenance, {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  }, {
    subprocessCaptureBytes: result.subprocessCaptureBytes,
    queryCaptureBytes: tamperedQueryCapture
  })).toThrow(/capture/i);
  const bad = { ...dependencies, async observe() { return { ...(await dependencies.observe("candidate")), telegramSendCount: 1 }; } };
  await expect(api.executeControlledRuntimeRehearsal(executeInput, bad)).rejects.toThrow();

  let abortedObservation = false;
  let stoppedAfterAbort = false;
  const timeoutDependencies = {
    ...dependencies,
    async observe(_target: string, signal: AbortSignal) {
      return new Promise((resolve) => signal.addEventListener("abort", () => {
        abortedObservation = true;
        resolve((dependencies.observe as any)("candidate"));
      }, { once: true }));
    },
    async stop(target: string, operation: any) {
      stoppedAfterAbort = true;
      return dependencies.stop(target, operation);
    }
  };
  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, timeoutDependencies)).rejects.toThrow(/timeout/i);
  expect(abortedObservation).toBe(true);
  expect(stoppedAfterAbort).toBe(true);

  const forcedCleanupTargets: string[] = [];
  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    observe: () => new Promise(() => undefined),
    async forceCleanup(target: string) {
      forcedCleanupTargets.push(target);
      return { managedChildCount: 0, runtimeProcessCount: 0 };
    }
  })).rejects.toThrow(/timeout/i);
  expect(forcedCleanupTargets).toEqual(["candidate"]);

  const stopCleanupTargets: string[] = [];
  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    stop: () => new Promise(() => undefined),
    async forceCleanup(target: string) {
      stopCleanupTargets.push(target);
      return { managedChildCount: 0, runtimeProcessCount: 0 };
    }
  })).rejects.toThrow(/candidate_stop_timeout/i);
  expect(stopCleanupTargets).toEqual(["candidate"]);

  const lateStartCleanupTargets: string[] = [];
  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    start: (_target: string, operation: any) => new Promise((resolve) => {
      operation.signal.addEventListener("abort", () => resolve({ processIdentity: "late-candidate-process" }), { once: true });
    }),
    async forceCleanup(target: string) {
      lateStartCleanupTargets.push(target);
      return { managedChildCount: 0, runtimeProcessCount: 0 };
    }
  })).rejects.toThrow(/candidate_start_timeout/i);
  expect(lateStartCleanupTargets).toEqual(["candidate"]);

  const abortSettledStopCleanupTargets: string[] = [];
  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    stop: (_target: string, operation: any) => new Promise((resolve) => {
      operation.signal.addEventListener("abort", () => resolve({
        exitCode: null,
        signal: "SIGTERM",
        forced: false,
        stdout: "",
        stderr: "",
        timedOut: true
      }), { once: true });
    }),
    async forceCleanup(target: string) {
      abortSettledStopCleanupTargets.push(target);
      return { managedChildCount: 0, runtimeProcessCount: 0 };
    }
  })).rejects.toThrow(/candidate_stop_timeout/i);
  expect(abortSettledStopCleanupTargets).toEqual(["candidate"]);

  const rejectedStopCleanupTargets: string[] = [];
  await expect(api.executeControlledRuntimeRehearsal(executeInput, {
    ...dependencies,
    async stop() { throw new Error("simulated_stop_failure"); },
    async forceCleanup(target: string) {
      rejectedStopCleanupTargets.push(target);
      return { managedChildCount: 0, runtimeProcessCount: 0 };
    }
  })).rejects.toThrow("simulated_stop_failure");
  expect(rejectedStopCleanupTargets).toEqual(["candidate"]);

  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    observe: () => new Promise(() => undefined),
    async forceCleanup() {
      return { managedChildCount: 0, runtimeProcessCount: 1 };
    }
  })).rejects.toThrow(/force_cleanup_incomplete/i);

  await expect(api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    observe: () => new Promise(() => undefined),
    forceCleanup: () => new Promise(() => undefined)
  })).rejects.toThrow(/force_cleanup_timeout/i);

  const badMirrorState = structuredClone(await dependencies.captureState("before"));
  badMirrorState.allowanceMirrorMismatchCount = 1;
  badMirrorState.allowanceMirrorMismatchSha256 = "f".repeat(64);
  await expect(api.executeControlledRuntimeRehearsal(executeInput, {
    ...dependencies,
    async captureState() { return badMirrorState; }
  })).rejects.toThrow(/allowance|mirror|state/i);

  const neverSettles = api.executeControlledRuntimeRehearsal({ ...executeInput, timeoutMs: 1_000 }, {
    ...dependencies,
    captureState: () => new Promise(() => undefined)
  });
  await expect(Promise.race([
    neverSettles,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("outer_deadline_exceeded")), 2_500))
  ])).rejects.toThrow(/controlled_runtime_before_timeout/);
}, 30_000);

it("[REQ-35][CONTROLLED-RUNTIME-CLI] accepts only Task0B-bound data configuration and no caller JavaScript driver", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  const config = {
    version: "controlled-runtime-operational-config-v1",
    candidateWorktree: "C:/release/candidate",
    previousWorktree: "C:/release/previous",
    candidateAdminUrl: "http://127.0.0.1:18787/",
    previousAdminUrl: "http://127.0.0.1:18788/",
    databaseUrlEnv: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL",
    telegramRecorderPath: "runtime-telegram-recorder.json"
  };
  const bytes = Buffer.from(JSON.stringify(config));
  expect(() => api.validateControlledRuntimeOperationalConfig(bytes, {
    operationalConfigPath: "runtime-operational-config.json",
    operationalConfigSha256: createHash("sha256").update(bytes).digest("hex")
  })).not.toThrow();
  const missingPortBytes = Buffer.from(JSON.stringify({
    ...config,
    candidateAdminUrl: "http://127.0.0.1/"
  }));
  expect(() => api.validateControlledRuntimeOperationalConfig(missingPortBytes, {
    operationalConfigPath: "runtime-operational-config.json",
    operationalConfigSha256: createHash("sha256").update(missingPortBytes).digest("hex")
  })).toThrow(/admin_url/i);
  expect(() => api.validateControlledRuntimeOperationalConfig(bytes, {
    operationalConfigPath: "runtime-operational-config.json",
    operationalConfigSha256: "f".repeat(64)
  })).toThrow(/hash/i);
  expect(api.createControlledRuntimeCliDependencies).toBeTypeOf("function");
});

it("[REQ-35][CONTROLLED-RUNTIME-WORKTREE] rejects a wrong or dirty exact runtime worktree", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  expect(() => api.validateControlledRuntimeWorktreeState({
    headSha: CANDIDATE_SHA,
    statusPorcelain: ""
  }, CANDIDATE_SHA)).not.toThrow();
  expect(() => api.validateControlledRuntimeWorktreeState({
    headSha: PREVIOUS_RUNTIME_SHA,
    statusPorcelain: ""
  }, CANDIDATE_SHA)).toThrow(/head/i);
  expect(() => api.validateControlledRuntimeWorktreeState({
    headSha: CANDIDATE_SHA,
    statusPorcelain: " M src/index.ts"
  }, CANDIDATE_SHA)).toThrow(/dirty/i);
});

it("[REQ-35][CONTROLLED-RUNTIME-TELEGRAM] blocks remote network and records the synthetic version response", async () => {
  const runtime: any = await import("../../scripts/rehearseRemediationRuntime");
  const preload: any = await import("../../scripts/rehearseRemediationRuntimePreload");
  const root = await mkdtemp(join(tmpdir(), "plan5-runtime-preload-"));
  const recorderPath = join(root, "recorder.json");
  await runtime.initializeControlledRuntimeRecorder(recorderPath, "candidate");
  let delegated = 0;
  const guardedFetch = preload.createRuntimeRehearsalFetch({
    target: "candidate",
    recorderPath,
    originalFetch: async () => {
      delegated += 1;
      return new Response("ok", { status: 200 });
    }
  });
  let tlsHostReads = 0;
  const tlsCallback = () => undefined;
  const mutableTlsOptions = {
    port: 443,
    get host() {
      tlsHostReads += 1;
      return tlsHostReads === 1 ? "127.0.0.1" : "203.0.113.1";
    }
  };
  const stableTlsArgs = preload.snapshotAndValidateRuntimeSocketArgs([443, mutableTlsOptions, tlsCallback]);
  expect(tlsHostReads).toBe(1);
  expect(stableTlsArgs[1]).not.toBe(mutableTlsOptions);
  expect(stableTlsArgs[1]).toMatchObject({ host: "127.0.0.1", port: 443 });
  expect(stableTlsArgs[2]).toBe(tlsCallback);
  expect(Object.isFrozen(stableTlsArgs)).toBe(true);
  expect(Object.isFrozen(stableTlsArgs[1])).toBe(true);
  expect((await guardedFetch("http://127.0.0.1:18787/")).status).toBe(200);
  expect(delegated).toBe(1);
  await expect(guardedFetch("https://example.com/secret")).rejects.toThrow(/non_loopback_network_blocked/);
  const telegram = await guardedFetch("https://api.telegram.org/bot000000:test/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: 42, text: "exact /version response" })
  });
  expect(telegram.status).toBe(200);
  const recorder = JSON.parse(await readFile(recorderPath, "utf8"));
  expect(recorder).toMatchObject({
    version: "runtime-rehearsal-recorder-v1",
    target: "candidate",
    interceptedSendCount: 1,
    versionResponseText: "exact /version response",
    versionResponseSha256: createHash("sha256").update("exact /version response").digest("hex")
  });

  const updatesUrl = "https://api.telegram.org/bot000000:test/getUpdates";
  const firstUpdates = await guardedFetch(updatesUrl, { method: "POST", body: "{}" });
  expect((await firstUpdates.json() as any).result).toHaveLength(1);
  const controller = new AbortController();
  const pendingUpdates = guardedFetch(updatesUrl, { method: "POST", body: "{}", signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const stillPending = await Promise.race([
    pendingUpdates.then(() => false, () => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10))
  ]);
  expect(stillPending).toBe(true);
  controller.abort();
  await expect(pendingUpdates).rejects.toThrow(/aborted/i);

  await guardedFetch("https://api.telegram.org/bot000000:test/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: 42, text: "unexpected second message" })
  });
  const repeatedRecorder = JSON.parse(await readFile(recorderPath, "utf8"));
  expect(repeatedRecorder.interceptedSendCount).toBe(2);
  await rm(root, { recursive: true, force: true });
});

it("[REQ-35][CONTROLLED-RUNTIME-GRAMMY-NODE-FETCH] intercepts grammY CJS node-fetch in an isolated child with no remote network", async () => {
  const runtime: any = await import("../../scripts/rehearseRemediationRuntime");
  const root = await mkdtemp(join(tmpdir(), "plan5-grammy-preload-"));
  const recorderPath = join(root, "recorder.json");
  const preloadPath = resolve("scripts/rehearseRemediationRuntimePreload.ts");
  await runtime.initializeControlledRuntimeRecorder(recorderPath, "candidate");
  const source = `
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const { Bot } = await import("grammy");
    const net = await import("node:net");
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
    const localPort = server.address().port;
    const connectLocal = (connect) => new Promise((resolve, reject) => {
      const socket = connect();
      socket.once("connect", () => { socket.end(); resolve(); });
      socket.once("error", reject);
    });
    await connectLocal(() => {
      const socket = new net.Socket();
      socket.connect({ host: "127.0.0.1", port: localPort });
      return socket;
    });
    await connectLocal(() => net.connect({ host: "127.0.0.1", port: localPort }));
    await connectLocal(() => net.createConnection({ host: "localhost", port: localPort }));
    let mutableHostReads = 0;
    await connectLocal(() => new net.Socket().connect({
      port: localPort,
      get host() {
        mutableHostReads += 1;
        return mutableHostReads === 1 ? "127.0.0.1" : "203.0.113.1";
      }
    }));
    if (mutableHostReads !== 1) throw new Error("socket_options_not_snapshotted_once");
    await new Promise((resolve) => server.close(resolve));
    let rawSocketBlocked = false;
    const remoteSocket = new net.Socket();
    try {
      remoteSocket.connect({ host: "203.0.113.1", port: 9 });
      remoteSocket.destroy();
    } catch (error) {
      rawSocketBlocked = String(error).includes("plan5_non_loopback_network_blocked");
    }
    let customLookupBlocked = false;
    try {
      new net.Socket().connect({
        host: "localhost",
        port: 9,
        lookup: (_host, _options, callback) => callback(null, "203.0.113.1", 4)
      }).destroy();
    } catch (error) {
      customLookupBlocked = String(error).includes("plan5_socket_target_invalid");
    }
    let remotePipeBlocked = false;
    try {
      new net.Socket().connect({ path: "\\\\\\\\attacker\\\\pipe\\\\plan5" }).destroy();
    } catch (error) {
      remotePipeBlocked = String(error).includes("plan5_non_loopback_network_blocked");
    }
    const bot = new Bot("000000000:PLAN5_RUNTIME_REHEARSAL_ONLY");
    const updates = await bot.api.getUpdates({ timeout: 0 });
    await bot.api.sendMessage(424242, "grammy-cjs-node-fetch-intercepted");
    const runtimeRequire = createRequire(pathToFileURL(process.cwd() + "/package.json"));
    const grammyRequire = createRequire(runtimeRequire.resolve("grammy"));
    const nodeFetch = grammyRequire("node-fetch");
    const blockedGlobal = await globalThis.fetch("https://example.com").then(() => false, (error) => String(error).includes("plan5_non_loopback_network_blocked"));
    const blockedCjs = await nodeFetch("https://example.com").then(() => false, (error) => String(error).includes("plan5_non_loopback_network_blocked"));
    const shapePreserved = nodeFetch.default === nodeFetch && ["Response", "Request", "Headers", "FetchError", "AbortError"].every((key) => typeof nodeFetch[key] === "function");
    if (updates[0]?.message?.text !== "/version" || !blockedGlobal || !blockedCjs || !rawSocketBlocked || !customLookupBlocked || !remotePipeBlocked || !shapePreserved) throw new Error("isolated_preload_assertion_failed");
    process.stdout.write(JSON.stringify({ updateText: updates[0].message.text, blockedGlobal, blockedCjs, rawSocketBlocked, customLookupBlocked, remotePipeBlocked, shapePreserved }));
  `;
  const child = spawnSync(process.execPath, [
    "--import", "tsx",
    "--import", pathToFileURL(preloadPath).href,
    "--input-type=module",
    "--eval", source
  ], {
    cwd: resolve("."),
    env: {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      PLAN5_RUNTIME_REHEARSAL_PRELOAD: "1",
      PLAN5_RUNTIME_REHEARSAL_TARGET: "candidate",
      PLAN5_RUNTIME_REHEARSAL_RECORDER: recorderPath,
      PLAN5_RUNTIME_REHEARSAL_WORKTREE: resolve(".")
    },
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true
  });
  expect({ status: child.status, signal: child.signal, stderr: child.stderr }).toEqual({ status: 0, signal: null, stderr: "" });
  expect(JSON.parse(child.stdout)).toEqual({ updateText: "/version", blockedGlobal: true, blockedCjs: true, rawSocketBlocked: true, customLookupBlocked: true, remotePipeBlocked: true, shapePreserved: true });
  expect(JSON.parse(await readFile(recorderPath, "utf8"))).toMatchObject({
    interceptedSendCount: 1,
    versionResponseText: "grammy-cjs-node-fetch-intercepted"
  });
  await rm(root, { recursive: true, force: true });
});

it("[REQ-35][CONTROLLED-RUNTIME-RECORDER-PATHS] uses unique exclusive regular files and leaves a symlink target unchanged", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  const root = await mkdtemp(join(tmpdir(), "plan5-recorder-paths-"));
  const candidate = api.controlledRuntimeRecorderPath(root, "runtime-telegram-recorder.json", "candidate");
  const previous = api.controlledRuntimeRecorderPath(root, "runtime-telegram-recorder.json", "previous");
  expect(candidate).not.toBe(previous);
  await api.initializeControlledRuntimeRecorder(candidate, "candidate");
  await api.initializeControlledRuntimeRecorder(previous, "previous");
  await expect(api.initializeControlledRuntimeRecorder(candidate, "candidate")).rejects.toThrow(/exists|exclusive|recorder/i);

  const protectedTarget = join(root, "protected.txt");
  const symlinkRecorder = join(root, "symlink-recorder.json");
  await writeFile(protectedTarget, "unchanged", "utf8");
  await symlink(protectedTarget, symlinkRecorder, "file");
  await expect(api.initializeControlledRuntimeRecorder(symlinkRecorder, "candidate")).rejects.toThrow(/exists|symlink|recorder/i);
  expect(await readFile(protectedTarget, "utf8")).toBe("unchanged");

  const validRecorderTarget = join(root, "valid-recorder-target.json");
  const symlinkReadPath = join(root, "symlink-read-recorder.json");
  await writeFile(validRecorderTarget, JSON.stringify({
    version: "runtime-rehearsal-recorder-v1",
    target: "candidate",
    interceptedSendCount: 1,
    versionResponseText: "candidate-version",
    versionResponseSha256: createHash("sha256").update("candidate-version").digest("hex")
  }), "utf8");
  await symlink(validRecorderTarget, symlinkReadPath, "file");
  await expect(api.readRuntimeRehearsalRecorder(symlinkReadPath, "candidate")).rejects.toThrow(/symlink|recorder|invalid/i);

  const oversizedRecorder = join(root, "oversized-recorder.json");
  await writeFile(oversizedRecorder, "x".repeat(1024 * 1024 + 1), "utf8");
  const preload: any = await import("../../scripts/rehearseRemediationRuntimePreload");
  const oversizedFetch = preload.createRuntimeRehearsalFetch({
    target: "candidate",
    recorderPath: oversizedRecorder,
    originalFetch: globalThis.fetch.bind(globalThis)
  });
  await expect(oversizedFetch("https://api.telegram.org/bot000000000:PLAN5/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: 1, text: "version" })
  })).rejects.toThrow("runtime_rehearsal_recorder_too_large");
  await rm(root, { recursive: true, force: true });
});

it("[REQ-35][CONTROLLED-RUNTIME-PROCESS-COUNT] binds exact runtime entrypoint and child PID through an injected process snapshot", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  const entrypoint = "C:/release/candidate/src/index.ts";
  const preloadPath = "C:/release/candidate/scripts/rehearseRemediationRuntimePreload.ts";
  const preloadUrl = pathToFileURL(resolve(preloadPath)).href;
  const processes = [
    { pid: 42, commandLine: `"${process.execPath}" --import tsx --import ${preloadUrl} ${entrypoint}` },
    { pid: 43, commandLine: "node --import tsx C:/release/other/src/index.ts" },
    { pid: 44, commandLine: `node --import tsx ${entrypoint}.backup` },
    { pid: 46, commandLine: `powershell.exe -Command inspect ${entrypoint}` },
    { pid: 47, commandLine: `"${process.execPath}" diagnostic.js ${entrypoint}` },
    { pid: 48, commandLine: `"${process.execPath}" --import tsx --import file:///lookalike/scripts/rehearseRemediationRuntimePreload.ts ${entrypoint}` }
  ];
  expect(api.countControlledRuntimeProcesses(processes, { entrypoint, preloadPath, expectedPid: 42 })).toBe(1);
  expect(() => api.countControlledRuntimeProcesses(processes, { entrypoint, preloadPath, expectedPid: 43 })).toThrow(/pid/i);
  expect(api.countControlledRuntimeProcesses([...processes, {
    pid: 45,
    commandLine: `"${process.execPath}" --import tsx --import ${preloadUrl} "${entrypoint}"`
  }], { entrypoint, preloadPath, expectedPid: 42 })).toBe(2);
});

it("[REQ-35][CONTROLLED-RUNTIME-PRODUCTION-CLEANUP] kills exact enumerated runtime processes and verifies zero", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  const candidateWorktree = resolve("C:/release/candidate");
  const candidateEntrypoint = resolve(candidateWorktree, "src/index.ts");
  const candidatePreloadUrl = pathToFileURL(resolve(candidateWorktree, "scripts/rehearseRemediationRuntimePreload.ts")).href;
  const population = buildTerminalLegacyPopulation();
  let enumerationCount = 0;
  const dependencies = api.createControlledRuntimeCliDependencies({
    version: "controlled-runtime-operational-config-v1",
    candidateWorktree,
    previousWorktree: resolve("C:/release/previous"),
    candidateAdminUrl: "http://127.0.0.1:18787/",
    previousAdminUrl: "http://127.0.0.1:18788/",
    databaseUrlEnv: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL",
    telegramRecorderPath: "runtime-telegram-recorder.json"
  }, {
    artifactRoot: resolve("C:/release/artifacts"),
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    databaseUrl: "postgresql://disabled:disabled@127.0.0.1:1/tron_watch_plan5_runtime_sanitized",
    terminalLegacyBinding: {
      candidateSha: population.candidateSha,
      cutoff: population.cutoff,
      cutoffSource: population.cutoffSource,
      task0bEvidenceSha256: population.task0bEvidenceSha256,
      databaseRole: population.databaseRole,
      databaseName: population.databaseName,
      databaseFingerprintSha256: population.databaseFingerprintSha256
    }
  }, () => {
    enumerationCount += 1;
    return enumerationCount <= 2
      ? [{ pid: 2_147_483_000, commandLine: `"${process.execPath}" --import tsx --import ${candidatePreloadUrl} "${candidateEntrypoint}"` }]
      : [];
  });
  await expect(dependencies.forceCleanup("candidate", new AbortController().signal)).resolves.toEqual({
    managedChildCount: 0,
    runtimeProcessCount: 0
  });
  expect(enumerationCount).toBeGreaterThanOrEqual(2);
});

it("[REQ-35][CONTROLLED-RUNTIME-LATE-PREPARATION] aborts after recorder preparation without spawning a late child", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  const population = buildTerminalLegacyPopulation();
  let preparationStarted = false;
  let releasePreparation: (() => void) | undefined;
  let spawnCount = 0;
  const dependencies = api.createControlledRuntimeCliDependencies({
    version: "controlled-runtime-operational-config-v1",
    candidateWorktree: resolve("C:/release/candidate"),
    previousWorktree: resolve("C:/release/previous"),
    candidateAdminUrl: "http://127.0.0.1:18787/",
    previousAdminUrl: "http://127.0.0.1:18788/",
    databaseUrlEnv: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL",
    telegramRecorderPath: "runtime-telegram-recorder.json"
  }, {
    artifactRoot: resolve("C:/release/artifacts"),
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    databaseUrl: "postgresql://disabled:disabled@127.0.0.1:1/tron_watch_plan5_runtime_sanitized",
    terminalLegacyBinding: {
      candidateSha: population.candidateSha,
      cutoff: population.cutoff,
      cutoffSource: population.cutoffSource,
      task0bEvidenceSha256: population.task0bEvidenceSha256,
      databaseRole: population.databaseRole,
      databaseName: population.databaseName,
      databaseFingerprintSha256: population.databaseFingerprintSha256
    }
  }, () => [], {
    attestWorktree: () => undefined,
    initializeRecorder: () => new Promise<void>((resolvePreparation) => {
      preparationStarted = true;
      releasePreparation = resolvePreparation;
    }),
    spawnRuntime: () => {
      spawnCount += 1;
      throw new Error("late_spawn_must_not_run");
    }
  });
  const controller = new AbortController();
  const outcome = dependencies.start("candidate", {
    commandId: "runtime_sanitized_rehearsal",
    templateSha256: "a".repeat(64),
    timeoutMs: 1_000,
    signal: controller.signal
  }).then(() => null, (error: unknown) => error);
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  expect(preparationStarted).toBe(true);
  controller.abort();
  releasePreparation?.();
  await expect(outcome).resolves.toMatchObject({ message: "controlled_runtime_start_aborted" });
  expect(spawnCount).toBe(0);
  await expect(dependencies.forceCleanup("candidate", new AbortController().signal)).resolves.toEqual({
    managedChildCount: 0,
    runtimeProcessCount: 0
  });
});

it("[REQ-35][CONTROLLED-RUNTIME-TERMINATION] accepts graceful SIGTERM and rejects forced termination", async () => {
  const api: any = await import("../../scripts/rehearseRemediationRuntime");
  expect(() => api.validateControlledRuntimeProcessTermination({
    exitCode: null,
    signal: "SIGTERM",
    forced: false,
    timedOut: false
  })).not.toThrow();
  expect(() => api.validateControlledRuntimeProcessTermination({
    exitCode: null,
    signal: "SIGKILL",
    forced: true,
    timedOut: false
  })).toThrow(/termination/i);
});
