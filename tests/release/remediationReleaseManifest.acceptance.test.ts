import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256
} from "../../src/release/remediationReleaseManifest";
import { canonicalReleaseJsonV2 } from "../../src/release/remediationReleaseManifestV2";
import { formatRuntimeVersion } from "../../src/runtime/runtimeVersion";
import {
  CANDIDATE_SHA,
  COMMAND_TEMPLATE_SHA256,
  GATE_COMMAND_IDS,
  PLAN_BASE_SHA,
  PREVIOUS_RUNTIME_LABEL,
  PREVIOUS_RUNTIME_SHA,
  PRE_RELEASE_GATE_IDS,
  PRODUCTION_CLONE_DATABASE_FINGERPRINT,
  REQUIRED_SUITE_GROUPS,
  RUNTIME_LABEL,
  SANITIZED_DATABASE_FINGERPRINT,
  TASK0B_EXPECTED_PRODUCTION_DATABASE,
  TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
  buildAcceptanceTraceSet,
  buildReleaseManifest,
  buildRollbackRehearsalEvidence,
  buildRuntimeVersion,
  buildRuntimeRehearsalEvidence,
  buildTask0BReleaseFreezeEvidence,
  buildTerminalLegacyPopulation,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type ManifestApi = {
  REMEDIATION_REQUIRED_SUITE_GROUPS: unknown;
  validateRemediationReleaseManifest(value: unknown): unknown;
};

const postgresIt = process.env.REQUIRE_PLAN5_POSTGRES === "1" ? it : it.skip;
const dockerIt = process.env.REQUIRE_PLAN5_DOCKER === "1" ? it : it.skip;
const execFileAsync = promisify(execFile);

async function makeProtectedTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(homedir(), prefix));
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
    ]);
    const currentSid = stdout.trim();
    if (!/^S-1-[0-9-]+$/.test(currentSid)) throw new Error("test_current_sid_unavailable");
    await execFileAsync("icacls.exe", [
      path,
      "/inheritance:r",
      "/grant:r",
      `*${currentSid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
      "*S-1-5-32-544:(OI)(CI)F"
    ]);
  } else {
    await chmod(path, 0o700);
  }
  return path;
}

async function loadManifestApi(): Promise<ManifestApi> {
  const modulePath: string = "../../src/release/remediationReleaseManifest";
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<ManifestApi>;
    if (typeof loaded.validateRemediationReleaseManifest !== "function") throw new Error("validator export missing");
    return loaded as ManifestApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: remediation release manifest validator", { cause: error });
  }
}

function buildCompleteTask0BPreflight() {
  return buildTask0BReleaseFreezeEvidence();
}

function buildTask0BPreflightConfig(artifactRoot: string, rollbackWorktreePath = resolve(artifactRoot, "rollback")) {
  const evidence = buildCompleteTask0BPreflight();
  const issuedAt = new Date();
  const {
    databaseRole,
    databaseName,
    databaseFingerprintSha256,
    operationalConfigPath,
    operationalConfigSha256,
    candidateStartCommandId,
    candidateStartTemplateSha256,
    candidateStopCommandId,
    candidateStopTemplateSha256,
    previousStartCommandId,
    previousStartTemplateSha256,
    previousStopCommandId,
    previousStopTemplateSha256
  } = evidence;
  return {
    version: "task0b-preflight-config-v1",
    source: "operator_approved_external_preflight_config",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 15 * 60_000).toISOString(),
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    previousRuntimeIdentity: {
      kind: "manager_owned_previous_runtime",
      evidencePath: "runtime-start-evidence-previous-runtime-generation-0001.json",
      evidenceSha256: evidence.previousRuntimeIdentity.startEvidenceSha256
    },
    databaseConnectionEnvName: "TASK0B_PRODUCTION_DATABASE_URL",
    productionDatabaseExpected: {
      ...TASK0B_EXPECTED_PRODUCTION_DATABASE,
      identityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT
    },
    rollbackWorktreePath,
    artifactRoot,
    candidatePort: { host: "127.0.0.1", port: 18787 },
    postgresToolProvider: {
      kind: "docker_pinned_image",
      immutableImageId: evidence.postgresTools.provider.immutableImageId,
      networkMode: "none",
      pullAllowed: false
    },
    runtimeManager: evidence.runtimeManager,
    sanitizedRehearsal: {
      databaseRole,
      databaseName,
      databaseFingerprintSha256,
      operationalConfigPath,
      operationalConfigSha256,
      candidateStartCommandId,
      candidateStartTemplateSha256,
      candidateStopCommandId,
      candidateStopTemplateSha256,
      previousStartCommandId,
      previousStartTemplateSha256,
      previousStopCommandId,
      previousStopTemplateSha256
    }
  };
}

it("[AC-41] validates the release regression manifest and required suite set", async () => {
  const api = await loadManifestApi();
  expect(api.REMEDIATION_REQUIRED_SUITE_GROUPS).toEqual(REQUIRED_SUITE_GROUPS);
  expect(() => api.validateRemediationReleaseManifest(buildReleaseManifest())).not.toThrow();
  expect(() => api.validateRemediationReleaseManifest({
    ...buildReleaseManifest(),
    planBaseSha: "b".repeat(40)
  })).toThrow(/approved Plan 5 base/i);
});

it("[REQ-38][GATE-ARTIFACT-BINDING] recomputes the concrete sanitized output hash and exact gate identity", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const gate = buildReleaseManifest().gates[2];
  const output = {
    version: "release-gate-output-v1",
    gateId: gate.id,
    candidateSha: gate.candidateSha,
    commandId: gate.commandId,
    redactedTemplateSha256: gate.redactedTemplateSha256,
    startedAt: gate.startedAt,
    finishedAt: gate.finishedAt,
    exitCode: gate.exitCode,
    state: gate.state,
    evidenceSha256s: ["a".repeat(64)]
  };
  const bytes = Buffer.from(JSON.stringify(output));
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(() => runner.validateReleaseGateOutput(bytes, { ...gate, outputSha256: hash } as any)).not.toThrow();
  expect(() => runner.validateReleaseGateOutput(bytes, { ...gate, outputSha256: "f".repeat(64) } as any)).toThrow();
  const foreign = Buffer.from(JSON.stringify({ ...output, candidateSha: "f".repeat(40) }));
  expect(() => runner.validateReleaseGateOutput(foreign, {
    ...gate,
    outputSha256: createHash("sha256").update(foreign).digest("hex")
  } as any)).toThrow();
});

it("[AC-41][SUITE-TRACE-BINDING] resolves every exact AC file and fullName in executed reports", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const trace = buildAcceptanceTraceSet();
  const executions = [
    ...trace.executions,
    ...trace.auxiliaryGreen.map(({ testFile, fullName }) => ({ testFile, fullName, status: "passed" as const }))
  ].map((execution) => ({ ...execution, failureMessages: [] }));
  expect(() => runner.assertTraceExecutionsCoveredBySuiteReports(trace, executions)).not.toThrow();
  expect(() => runner.assertTraceExecutionsCoveredBySuiteReports(trace, executions.slice(1))).toThrow();
  const skipped = cloneFixture(executions);
  skipped[0].status = "skipped";
  expect(() => runner.assertTraceExecutionsCoveredBySuiteReports(trace, skipped)).toThrow();
});

it("[REQ-38][STRICT-RELEASE-EVIDENCE] rejects dirty candidate execution and semantically validates trace coverage", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease") as any;
  expect(typeof runner.assertReleaseCandidateWorkspaceClean).toBe("function");
  expect(typeof runner.validateAcceptanceTraceEvidenceBundle).toBe("function");
  expect(() => runner.assertReleaseCandidateWorkspaceClean(CANDIDATE_SHA, {
    readHead: () => CANDIDATE_SHA,
    readStatus: () => ""
  })).not.toThrow();
  expect(() => runner.assertReleaseCandidateWorkspaceClean(CANDIDATE_SHA, {
    readHead: () => CANDIDATE_SHA,
    readStatus: () => " M src/index.ts"
  })).toThrow(/clean worktree/i);
  expect(() => runner.assertReleaseCandidateWorkspaceClean(CANDIDATE_SHA, {
    readHead: () => "f".repeat(40),
    readStatus: () => ""
  })).toThrow(/checked-out HEAD/i);

  const trace = buildAcceptanceTraceSet();
  const executions = [
    ...trace.executions,
    ...trace.auxiliaryGreen.map(({ testFile, fullName }) => ({ testFile, fullName, status: "passed" as const }))
  ].map((execution) => ({ ...execution, failureMessages: [] }));
  const localAbsenceTestCommits = new Set(trace.traces
    .filter((item) => item.red.kind === "local_product_module_absent")
    .map((item) => item.red.testCommitSha));
  expect(() => runner.validateAcceptanceTraceEvidenceBundle(
    trace,
    CANDIDATE_SHA,
    executions,
    {
      isAncestor: () => true,
      pathExistsAtCommit: (sha: string) => !localAbsenceTestCommits.has(sha)
    }
  )).not.toThrow();
  expect(() => runner.validateAcceptanceTraceEvidenceBundle(
    trace,
    CANDIDATE_SHA,
    executions.slice(1),
    {
      isAncestor: () => true,
      pathExistsAtCommit: (sha: string) => !localAbsenceTestCommits.has(sha)
    }
  )).toThrow(/observed passed/i);
  expect(() => runner.validateAcceptanceTraceEvidenceBundle(
    { version: "acceptance-trace-v1" },
    CANDIDATE_SHA,
    executions,
    { isAncestor: () => true, pathExistsAtCommit: () => false }
  )).toThrow(/trace|acceptance|required/i);
});

it("[REQ-38][STRICT-RELEASE-EVIDENCE] reaches semantic trace validation from the V2 concrete verifier", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease") as any;
  expect(typeof runner.verifyPreReleaseConcreteEvidenceV2).toBe("function");
  const root = await mkdtemp(join(tmpdir(), "plan5-semantic-verifier-"));
  try {
    await writeFile(join(root, "acceptance-trace.json"), JSON.stringify({
      version: "acceptance-trace-set-v1",
      candidateSha: CANDIDATE_SHA
    }));
    await expect(runner.verifyPreReleaseConcreteEvidenceV2(root, {
      candidateSha: CANDIDATE_SHA,
      planBaseSha: PLAN_BASE_SHA,
      gates: [{ id: "G01_TRACE", state: "passed" }]
    })).rejects.toThrow(/trace|required|acceptance/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("[REQ-35][REQ-38][RUNTIME-ARTIFACT-SEMANTICS] rejects hashable but false runtime rollback or legacy evidence", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const runtimeSchema = Buffer.from(JSON.stringify({
    candidateSha: CANDIDATE_SHA,
    databaseRole: "runtime_sanitized",
    databaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    candidateBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    shortChecksum: "41217f64c33c",
    postconditionsSha256: "d".repeat(64),
    schema033: {
      version: 33,
      migrationFilename: "033_unified_wallet_check.sql",
      checksumSha256: "d04f2aff20370a78862604c92ccbc6bf7c8b1024f95e03b4af2c8f018e701f7",
      catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
      verificationReceiptSha256: "e".repeat(64)
    },
    firstApply: "applied",
    secondApply: "already_verified"
  }));
  const productionCloneSchema = Buffer.from(JSON.stringify({
    ...JSON.parse(runtimeSchema.toString("utf8")),
    databaseRole: "production_clone",
    databaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT
  }));
  const candidateStart = Buffer.from(JSON.stringify({
    version: "runtime-start-command-evidence-v1",
    runtimeSha: CANDIDATE_SHA,
    runtimeLabel: RUNTIME_LABEL,
    commandId: "runtime_sanitized_rehearsal",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    exitCode: 0
  }));
  const previousStart = Buffer.from(JSON.stringify({
    version: "runtime-start-command-evidence-v1",
    runtimeSha: PREVIOUS_RUNTIME_SHA,
    runtimeLabel: PREVIOUS_RUNTIME_LABEL,
    commandId: "rollback_rehearsal",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    exitCode: 0
  }));
  const runtime: any = cloneFixture(buildRuntimeRehearsalEvidence());
  const rollback: any = cloneFixture(buildRollbackRehearsalEvidence());
  const terminal = buildTerminalLegacyPopulation();
  const operationalConfig = Buffer.from(JSON.stringify({
    version: "controlled-runtime-operational-config-v1",
    candidateWorktree: "C:/release/candidate",
    previousWorktree: "C:/release/previous",
    candidateAdminUrl: "http://127.0.0.1:18787/",
    previousAdminUrl: "http://127.0.0.1:18788/",
    databaseUrlEnv: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL",
    telegramRecorderPath: "runtime-telegram-recorder.json"
  }));
  const task0b = Buffer.from(JSON.stringify({
    ...buildCompleteTask0BPreflight(),
    observedAt: terminal.cutoff,
    freezeCutoff: terminal.cutoff,
    expiresAt: "2026-07-18T00:15:00.000Z",
    operationalConfigSha256: createHash("sha256").update(operationalConfig).digest("hex"),
    productionDatabase: {
      ...buildCompleteTask0BPreflight().productionDatabase,
      endpointFingerprintSha256: "1".repeat(64),
      clusterFingerprintSha256: "2".repeat(64)
    }
  }));
  terminal.task0bEvidenceSha256 = createHash("sha256").update(task0b).digest("hex");
  const state = {
    schemaVerified: true,
    allowanceStateSha256: "1".repeat(64),
    allowanceMirrorMismatchCount: 0,
    allowanceMirrorMismatchSha256: createHash("sha256").update("[]").digest("hex"),
    completedResultsSha256: "2".repeat(64),
    sentFingerprintSetSha256: "3".repeat(64),
    advisoryLockCount: 0,
    telegramSendCount: 0,
    runtimeProcessCount: 0,
    terminalLegacyPopulation: terminal
  };
  const processCapture = {
    processIdentitySha256: "4".repeat(64),
    exitCode: 0,
    signal: null,
    forced: false,
    stdoutSha256: "5".repeat(64),
    stderrSha256: "6".repeat(64),
    timedOut: false
  };
  const candidateRuntimeVersion = buildRuntimeVersion();
  const candidateVersionResponseText = formatRuntimeVersion(candidateRuntimeVersion as any, "ru");
  const previousVersionResponseText = [
    "<b>Статус runtime</b>",
    `<b>Инстанс</b>: <code>${PREVIOUS_RUNTIME_LABEL}</code>`,
    "<b>Режим</b>: <code>marked</code>",
    "По этой строке можно понять, какая версия runtime ответила в Telegram."
  ].join("\n\n");
  const subprocessCaptures = Buffer.from(JSON.stringify({
    version: "controlled-runtime-subprocess-captures-v1",
    candidateProcess: processCapture,
    previousProcess: { ...processCapture, processIdentitySha256: "7".repeat(64) }
  }));
  const queryCaptures = Buffer.from(JSON.stringify({
    version: "controlled-runtime-query-captures-v1",
    before: state,
    candidateObservation: { adminHealthStatus: 200, observedSha: CANDIDATE_SHA, observedLabel: RUNTIME_LABEL, versionResponseText: candidateVersionResponseText, versionResponseSha256: createHash("sha256").update(candidateVersionResponseText).digest("hex"), runtimeInstanceCount: 1, workerScheduleCount: 1, telegramSendCount: 0, advisoryLockCount: 0 },
    previousObservation: { adminHealthStatus: 200, observedSha: PREVIOUS_RUNTIME_SHA, observedLabel: PREVIOUS_RUNTIME_LABEL, versionResponseText: previousVersionResponseText, versionResponseSha256: createHash("sha256").update(previousVersionResponseText).digest("hex"), runtimeInstanceCount: 1, workerScheduleCount: 1, telegramSendCount: 0, advisoryLockCount: 0 },
    after: state
  }));
  const observation = Buffer.from(JSON.stringify({
    version: "controlled-runtime-rehearsal-v1",
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    timeoutMs: 15_000,
    candidateStartCommandId: "runtime_sanitized_rehearsal",
    candidateStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    candidateStopCommandId: "runtime_sanitized_stop",
    candidateStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop,
    previousStartCommandId: "rollback_rehearsal",
    previousStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    previousStopCommandId: "rollback_stop",
    previousStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop,
    subprocessCapturesSha256: createHash("sha256").update(subprocessCaptures).digest("hex"),
    queryCapturesSha256: createHash("sha256").update(queryCaptures).digest("hex")
  }));
  const runtimeSchemaHash = createHash("sha256").update(runtimeSchema).digest("hex");
  const candidateStartHash = createHash("sha256").update(candidateStart).digest("hex");
  const previousStartHash = createHash("sha256").update(previousStart).digest("hex");
  runtime.schemaEvidenceSha256 = runtimeSchemaHash;
  runtime.candidateStartEvidenceSha256 = candidateStartHash;
  runtime.previousStartEvidenceSha256 = previousStartHash;
  runtime.candidate.startEvidenceSha256 = candidateStartHash;
  runtime.previous.startEvidenceSha256 = previousStartHash;
  rollback.schemaEvidenceSha256 = runtimeSchemaHash;
  rollback.previousStartEvidenceSha256 = previousStartHash;
  rollback.terminalLegacyPopulationBefore = terminal;
  rollback.terminalLegacyPopulationAfter = cloneFixture(terminal);
  const rehearsal = await import("../../scripts/rehearseRemediationRuntime");
  const expected = rehearsal.buildRuntimeRehearsalExpectedFromArtifactBytes({
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    productionCloneDatabaseFingerprintSha256: PRODUCTION_CLONE_DATABASE_FINGERPRINT,
    schemaEvidenceBytes: runtimeSchema,
    candidateStartEvidenceBytes: candidateStart,
    previousStartEvidenceBytes: previousStart,
    candidateRuntimeLabel: RUNTIME_LABEL,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  });
  const derived = rehearsal.deriveControlledRuntimeEvidence(expected, JSON.parse(queryCaptures.toString("utf8")));
  const valid = {
    runtime: derived.runtimeEvidenceBytes,
    rollback: derived.rollbackEvidenceBytes,
    terminal: Buffer.from(JSON.stringify(terminal)),
    runtimeSchema,
    productionCloneSchema,
    candidateStart,
    previousStart,
    task0b,
    operationalObservation: observation,
    operationalSubprocessCaptures: subprocessCaptures,
    operationalQueryCaptures: queryCaptures,
    operationalConfig
  };
  expect(() => runner.validateRuntimeArtifactSet(CANDIDATE_SHA, valid, terminal.cutoff)).not.toThrow();
  expect(() => runner.validateRuntimeArtifactSet(CANDIDATE_SHA, {
    ...valid,
    runtime: Buffer.concat([valid.runtime, Buffer.from("\n")])
  }, terminal.cutoff)).toThrow(/derived|capture|binding/i);
  const invalidRuntimeVersionQueries: any = JSON.parse(queryCaptures.toString("utf8"));
  invalidRuntimeVersionQueries.candidateObservation.versionResponseText = "legacy-policy";
  invalidRuntimeVersionQueries.candidateObservation.versionResponseSha256 = createHash("sha256").update("legacy-policy").digest("hex");
  const invalidRuntimeVersionQueryBytes = Buffer.from(JSON.stringify(invalidRuntimeVersionQueries));
  const invalidRuntimeVersionProvenance: any = JSON.parse(observation.toString("utf8"));
  invalidRuntimeVersionProvenance.queryCapturesSha256 = createHash("sha256").update(invalidRuntimeVersionQueryBytes).digest("hex");
  expect(() => runner.validateRuntimeArtifactSet(CANDIDATE_SHA, {
    ...valid,
    operationalObservation: Buffer.from(JSON.stringify(invalidRuntimeVersionProvenance)),
    operationalQueryCaptures: invalidRuntimeVersionQueryBytes
  }, terminal.cutoff)).toThrow(/version_response_mismatch/i);
  expect(() => runner.validateRuntimeArtifactSet(
    CANDIDATE_SHA,
    valid,
    "2026-07-19T00:00:00.001Z"
  )).toThrow(/stale/i);
  expect(() => runner.validateRuntimeArtifactSet(CANDIDATE_SHA, {
    ...valid,
    operationalQueryCaptures: Buffer.from("{}")
  }, terminal.cutoff)).toThrow(/capture/i);
  const falseRuntime = { ...JSON.parse(derived.runtimeEvidenceBytes.toString("utf8")), outboundSendCount: 1 };
  expect(() => runner.validateRuntimeArtifactSet(CANDIDATE_SHA, {
    ...valid,
    runtime: Buffer.from(JSON.stringify(falseRuntime))
  }, terminal.cutoff)).toThrow();
  const falseTerminal = { ...terminal, populationCount: terminal.populationCount + 1 };
  expect(() => runner.validateRuntimeArtifactSet(CANDIDATE_SHA, {
    ...valid,
    terminal: Buffer.from(JSON.stringify(falseTerminal))
  }, terminal.cutoff)).toThrow();
});

it("[REQ-38][SUITE-ENVIRONMENT] strips production providers and Telegram while retaining disposable test bindings", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const env = runner.buildReleaseSuiteEnvironment({
    PATH: "test-path",
    DATABASE_URL: "postgresql://prod:secret@127.0.0.1/tron_watch",
    TELEGRAM_BOT_TOKEN: "123456789:AAExampleTokenValue",
    SERVICE_ADMIN_TG_IDS: "123456789",
    TRONSCAN_API_KEY: "secret-provider-key",
    TRON_FULLNODE_BASE_URL: "https://production-fullnode.example",
    RANGE_BASE_URL: "https://production-range.example",
    EVM_EXPLORER_BASE_URL: "https://production-evm.example",
    PLAN5_TELEGRAM_BOT_TOKEN: "123456789:AAExampleTokenValue",
    TEST_TRONSCAN_API_KEY: "secret-provider-key",
    PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch_plan5_runtime_sanitized",
    PLAN5_TASK0B_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1:56001/tron_watch",
    REQUIRE_PLAN5_POSTGRES: "1"
  });
  expect(env.PATH).toBe("test-path");
  expect(env.DATABASE_URL).toBeUndefined();
  expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  expect(env.SERVICE_ADMIN_TG_IDS).toBeUndefined();
  expect(env.TRONSCAN_API_KEY).toBeUndefined();
  expect(env.TRON_FULLNODE_BASE_URL).toBeUndefined();
  expect(env.RANGE_BASE_URL).toBeUndefined();
  expect(env.EVM_EXPLORER_BASE_URL).toBeUndefined();
  expect(env.PLAN5_TELEGRAM_BOT_TOKEN).toBeUndefined();
  expect(env.TEST_TRONSCAN_API_KEY).toBeUndefined();
  expect(env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL).toContain("tron_watch_plan5_runtime_sanitized");
  expect(env.PLAN5_TASK0B_TEST_DATABASE_URL).toContain("127.0.0.1:56001/tron_watch");
  expect(env.REQUIRE_PLAN5_POSTGRES).toBe("1");
  expect(env.DOTENV_CONFIG_PATH).toContain("plan5-no-dotenv");
  expect(() => runner.buildReleaseSuiteEnvironment({
    PLAN1_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch"
  })).toThrow(/disposable|database/i);
  expect(() => runner.buildReleaseSuiteEnvironment({
    TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch_plan2"
  }, { expectedTestDatabase: "tron_watch_plan1" })).toThrow(/disposable|database/i);
  expect(runner.buildReleaseSuiteEnvironment({
    TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch_plan1"
  }, { expectedTestDatabase: "tron_watch_plan1" }).TEST_DATABASE_URL).toContain("tron_watch_plan1");
  expect(() => runner.buildReleaseSuiteEnvironment({
    PLAN5_TASK0B_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1:55999/tron_watch"
  })).toThrow(/disposable|database/i);
  expect(() => runner.buildReleaseSuiteEnvironment({
    PLAN5_TASK0B_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1:56001/tron_watch_plan5_runtime_sanitized"
  })).toThrow(/disposable|database/i);
  expect(runner.buildReleaseSuiteEnvironment({
    PLAN5_TASK0B_TEST_DATABASE_URL: "postgresql://test:test@[::1]:56001/tron_watch"
  }).PLAN5_TASK0B_TEST_DATABASE_URL).toContain("[::1]:56001/tron_watch");
});

it("[REQ-38][TASK0-BASELINE] parses typed baseline evidence and rejects nested secrets before hash acceptance", async () => {
  const api: any = await import("../../src/release/remediationReleaseManifest");
  const baseline = {
    schemaVersion: "plan5-task0-local-baseline-v2",
    generatedAt: "2026-07-17T20:05:17.474Z",
    candidate: {
      branch: "codex/remediation-end-to-end-release",
      plan5BaseSha: "4761e1453ea03a96845b68039e6d6f4812aae540",
      branchConfigVerified: true,
      plan4FinalSha: "547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17",
      plan4FinalAncestor: true,
      approvedPlan5Commit: "37274b0b5fa1b77c8d87a22856ca903895f9af8c",
      approvedAmendmentCommit: "4761e1453ea03a96845b68039e6d6f4812aae540",
      approvedAmendmentAtHead: true
    },
    userState: {
      canonicalization: "git-status-short-lines-lf-and-stash-object-shas-lf",
      mainStatusCount: 13,
      mainManifestSha256: "1".repeat(64),
      stashCount: 4,
      stashManifestSha256: "2".repeat(64),
      stashShas: ["3".repeat(40), "4".repeat(40), "5".repeat(40), "6".repeat(40)],
      modified: false
    },
    migration: {
      file: "032_telegram_runtime_forensics_data_contracts.sql",
      sha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
      approvedMatch: true,
      migration033OrLater: ["migrations/033_unified_wallet_check.sql"],
      uncommittedMigrationChanges: []
    },
    disposableDatabases: ["tron_watch_plan5_clean", "tron_watch_plan5_clone", "tron_watch_plan5_runtime_sanitized"],
    runtimeSnapshot: {
      purpose: "task0a_observation_not_release_preflight",
      previousRuntimeSha: "0172978845ec74373bd245098ee8c075e0c39acf",
      previousRuntimeShaExistsLocally: true,
      previousRuntimeShaIsCandidateAncestor: true,
      runtimeLabel: "master-01729788",
      databaseName: "tron_watch",
      databaseHostClass: "loopback",
      databasePort: 55999,
      databaseListenerObserved: true,
      databaseSchemaState: "legacy_031",
      schema032ReceiptState: "absent",
      databaseStateSource: "user_authorized_current_runtime_baseline",
      adminUrl: "http://127.0.0.1:8787/",
      adminHttpStatus: 200,
      runtimeProcessObserved: true,
      runtimeCommandShape: "node --import tsx src/index.ts",
      telegramMode: "long_polling",
      telegramModeSource: "user_authorized_current_runtime_baseline",
      runtimeStoppedOrStartedByTask0: false,
      databaseMutatedByTask0: false,
      telegramMessageSentByTask0: false,
      requiresTask0BReverification: true
    },
    postgresToolsSnapshot: {
      hostPgDump: null,
      hostPgRestore: null,
      dockerAvailable: true,
      dockerImageId: "sha256:" + "7".repeat(64),
      pgDumpVersion: "16.14",
      pgRestoreVersion: "16.14",
      releaseCommandIdsVerified: false,
      releaseCommandVerificationDeferredTo: "task0b_before_task9"
    },
    ownerPlans: [1, 2, 3, 4].map((plan) => ({
      plan,
      base: String(plan).repeat(40),
      test: String(plan + 1).repeat(40),
      implementation: String(plan + 2).repeat(40),
      acceptance: `AC-${plan}`,
      verifiedAncestor: true
    })),
    traceCoverage: {
      priorAcceptanceIds: 40,
      priorPlanCommitTriplesResolvedAtPlanLevel: 40,
      exactPerAcRedGreenTrace: "pending_tasks_1_through_6",
      ac41Ownership: "plan5",
      ac41RedGreenTrace: "pending_tasks_1_through_6",
      task0aPass: true
    },
    operationalPreflight: {
      requiredImmediatelyBefore: "task9",
      status: "pending_not_blocking_tasks_1_through_8",
      requiredFields: ["previous_runtime_sha_and_label"],
      missingAnyFieldBlocksTask9: true,
      missingAnyFieldBlocksReadyForRelease: true
    },
    secretHandling: {
      secretValuesRecorded: false,
      credentialsRecorded: false,
      tokensRecorded: false,
      apiKeysRecorded: false
    }
  };
  const ancestryCalls: Array<[string, string]> = [];
  const ownerPlanEdges = baseline.ownerPlans.flatMap((plan) => [
    [plan.base, plan.test] as [string, string],
    [plan.test, plan.implementation] as [string, string],
    [plan.implementation, CANDIDATE_SHA] as [string, string]
  ]);
  expect(() => api.validateTask0BaselineEvidence(baseline, CANDIDATE_SHA, {
    isAncestor(ancestor: string, candidate: string) {
      ancestryCalls.push([ancestor, candidate]);
      return (ancestor === baseline.candidate.plan5BaseSha && candidate === CANDIDATE_SHA)
        || ownerPlanEdges.some(([expectedAncestor, expectedCandidate]) => (
          ancestor === expectedAncestor && candidate === expectedCandidate
        ));
    }
  })).not.toThrow();
  expect(ancestryCalls).toContainEqual([baseline.candidate.plan5BaseSha, CANDIDATE_SHA]);
  expect(ancestryCalls).toHaveLength(13);
  for (const edge of ownerPlanEdges) expect(ancestryCalls).toContainEqual(edge);
  const missingOwnerEdge = ownerPlanEdges[7]!;
  expect(() => api.validateTask0BaselineEvidence(baseline, CANDIDATE_SHA, {
    isAncestor(ancestor: string, candidate: string) {
      if (ancestor === missingOwnerEdge[0] && candidate === missingOwnerEdge[1]) return false;
      return (ancestor === baseline.candidate.plan5BaseSha && candidate === CANDIDATE_SHA)
        || ownerPlanEdges.some(([expectedAncestor, expectedCandidate]) => (
          ancestor === expectedAncestor && candidate === expectedCandidate
        ));
    }
  })).toThrow(/ancestor/i);
  expect(() => api.validateTask0BaselineEvidence(baseline, CANDIDATE_SHA, { isAncestor: () => false })).toThrow(/ancestor/i);
  const duplicateOwnerSha = structuredClone(baseline);
  duplicateOwnerSha.ownerPlans[0].test = duplicateOwnerSha.ownerPlans[0].base;
  expect(() => api.validateTask0BaselineEvidence(
    duplicateOwnerSha,
    CANDIDATE_SHA,
    { isAncestor: () => true }
  )).toThrow(/owner plan/i);
  const unexpectedMigration = structuredClone(baseline);
  unexpectedMigration.migration.migration033OrLater.push(
    "migrations/034_unreviewed.sql"
  );
  expect(() => api.validateTask0BaselineEvidence(
    unexpectedMigration,
    CANDIDATE_SHA,
    { isAncestor: () => true }
  )).toThrow(/migration/i);
  expect(() => api.validateTask0BaselineEvidence({
    ...baseline,
    nested: { telegramBotToken: "123456789:AAExampleTokenValue" }
  }, CANDIDATE_SHA, { isAncestor: () => true })).toThrow(/secret/i);
});

it("[REQ-38][TASK0B-PREFLIGHT] rejects every missing stale or unverified operational release input", async () => {
  const api: any = await import("../../src/release/remediationReleaseManifest");
  const complete = buildCompleteTask0BPreflight();
  expect(() => api.validateTask0BReleaseFreezeEvidence(
    complete,
    CANDIDATE_SHA,
    "2026-07-18T09:10:00.000Z"
  )).not.toThrow();
  const invalid: Array<(value: any) => void> = [
    (value) => { value.operatorConfig.contentSha256 = "not-a-hash"; },
    (value) => { value.operatorConfig.configExpiresAt = "2026-07-18T08:59:59.000Z"; },
    (value) => { delete value.previousRuntimeSource; },
    (value) => { value.previousRuntimeLabel += " --force"; },
    (value) => { value.candidateWorktree.cleanAfter = false; },
    (value) => { value.candidateWorktree.headAfterSha = "f".repeat(40); },
    (value) => { value.previousRuntimeVerified = false; },
    (value) => { value.previousRuntimeIdentity.runtimeSha = "f".repeat(40); },
    (value) => { value.previousRuntimeIdentity.processId = 0; },
    (value) => { value.previousRuntimeIdentity.commandLineSha256 = "not-a-hash"; },
    (value) => { value.previousRuntimeIdentity.producerId = "operator_guess"; },
    (value) => { value.previousRuntimeIdentity.attestedAt = "2026-07-17T19:42:00.001Z"; },
    (value) => { value.previousRuntimeIdentity.workingDirectoryFingerprintSha256 = "e".repeat(64); },
    (value) => { value.runtimeManager.verified = false; },
    (value) => { value.runtimeManager.source = "external_allowlisted_config_verified"; },
    (value) => { value.runtimeManager.executorSha256 = "f".repeat(64); },
    (value) => { value.runtimeManager.candidateAdminUrl = "http://127.0.0.1:18788/"; },
    (value) => {
      value.runtimeManager.candidateAdminUrl = "http://127.0.0.1:18788/";
      value.runtimeManager.candidateAdminUrlFingerprintSha256 = createHash("sha256")
        .update(value.runtimeManager.candidateAdminUrl).digest("hex");
    },
    (value) => { value.runtimeManager.rollbackPreviousTemplateSha256 = "f".repeat(64); },
    (value) => { value.productionDatabase.name = "tron_watch_plan5_clone"; },
    (value) => { value.productionDatabase.source = "operator_guess"; },
    (value) => { value.productionDatabase.identityMatchedApprovedConfig = false; },
    (value) => { value.productionDatabase.approvedIdentityFingerprintSha256 = "not-a-hash"; },
    (value) => { value.productionDatabase.schema032ReceiptPrestate.state = "unknown"; },
    (value) => { value.productionDatabase.schemaReceiptSet.count = 2; },
    (value) => { value.productionDatabase.schemaReceiptSet.aggregateSha256 = "f".repeat(64); },
    (value) => { value.productionDatabase.serverVersion = "17.1"; },
    (value) => {
      value.productionDatabase.schemaState = "schema_032_verified";
      value.productionDatabase.schema032ReceiptPrestate = {
        state: "verified",
        version: 32,
        filename: "032_telegram_runtime_forensics_data_contracts.sql",
        checksumSha256: "f".repeat(64)
      };
    },
    (value) => { value.rollbackWorktree.headSha = "f".repeat(40); },
    (value) => { value.rollbackWorktree.clean = false; },
    (value) => { value.postgresTools.pgDump.version = ""; },
    (value) => { value.postgresTools.pgDump.version = "pg_dump (PostgreSQL) 16.14 --evil"; },
    (value) => { value.postgresTools.pgRestore.version = "pg_restore (PostgreSQL) 15.9"; },
    (value) => { value.postgresTools.provider.immutableImageId = "postgres:16-alpine"; },
    (value) => { value.postgresTools.provider.networkMode = "bridge"; },
    (value) => { value.postgresTools.provider.pullAllowed = true; },
    (value) => { value.postgresTools.provider.kind = "host_executables"; },
    (value) => { value.postgresTools.pgDump.versionProbeExitCode = 1; },
    (value) => { value.postgresTools.pgDump.commandId = "raw_docker_command"; },
    (value) => { value.postgresTools.pgRestore.templateSha256 = "f".repeat(64); },
    (value) => { value.postgresTools.verified = false; },
    (value) => { value.artifactRoot.outsideRepository = false; },
    (value) => { value.artifactRoot.noSymlink = false; },
    (value) => { value.artifactRoot.restrictiveAccessVerified = false; },
    (value) => { value.artifactRoot.accessControlSource = "operator_guess"; },
    (value) => { value.artifactRoot.exclusiveWriteVerified = false; },
    (value) => { value.artifactRoot.source = "operator_guess"; },
    (value) => { value.candidatePort.host = "0.0.0.0"; },
    (value) => { value.candidatePort.port = value.productionDatabase.endpointPort; },
    (value) => { value.candidatePort.available = false; },
    (value) => { value.candidatePort.bindingSource = "operator_guess"; },
    (value) => { value.observedEffects.runtimeStopCount = 1; },
    (value) => { value.observedEffects.runtimeStartCount = 1; },
    (value) => { value.observedEffects.databaseMigrationCount = 1; },
    (value) => { value.observedEffects.telegramSendCount = 1; },
    (value) => { value.observedEffects.operationIds[0] = "runtime_start"; },
    (value) => { value.observedEffects.operationSequenceSha256 = "f".repeat(64); }
  ];
  for (const mutate of invalid) {
    const evidence: any = structuredClone(complete);
    mutate(evidence);
    expect(() => api.validateTask0BReleaseFreezeEvidence(
      evidence,
      CANDIDATE_SHA,
      "2026-07-18T09:10:00.000Z"
    )).toThrow();
  }
  expect(() => api.validateTask0BReleaseFreezeEvidence(
    complete,
    CANDIDATE_SHA,
    "2026-07-18T09:15:00.001Z"
  )).toThrow(/stale/i);
  expect(() => api.validateTask0BReleaseFreezeEvidence({
    ...complete,
    nested: { databaseUrl: "postgresql://release:secret@127.0.0.1/tron_watch" }
  }, CANDIDATE_SHA, "2026-07-18T09:10:00.000Z")).toThrow(/secret/i);
});

it("[REQ-38][TASK0B-LEGACY-RUNTIME] accepts only a fully bound read-only unmanaged previous runtime", async () => {
  const api: any = await import("../../src/release/remediationReleaseManifest");
  const managed = buildCompleteTask0BPreflight();
  const legacy: any = structuredClone(managed);
  legacy.previousRuntimeSource = "legacy_unmanaged_process_admin_database_telegram_read_only";
  legacy.previousRuntimeIdentity = {
    kind: "legacy_unmanaged_previous_runtime",
    runtimeSha: PREVIOUS_RUNTIME_SHA,
    runtimeLabel: PREVIOUS_RUNTIME_LABEL,
    processId: 11088,
    processStartedAt: "2026-07-17T19:39:12.000Z",
    commandLineSha256: "a".repeat(64),
    executablePathSha256: "b".repeat(64),
    workingDirectoryFingerprintSha256: "3".repeat(64),
    entrypointPathFingerprintSha256: "c".repeat(64),
    adminObservation: {
      endpointFingerprintSha256: "4".repeat(64),
      httpStatus: 200,
      runtimeVersionSha256: "5".repeat(64),
      observedRuntimeSha: PREVIOUS_RUNTIME_SHA,
      observedRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
      source: "loopback_admin_runtime_proof_read_only",
      verified: true
    },
    productionDatabaseObservation: {
      approvedIdentityFingerprintSha256: managed.productionDatabase.approvedIdentityFingerprintSha256,
      schemaState: managed.productionDatabase.schemaState,
      schemaReceiptSetSha256: managed.productionDatabase.schemaReceiptSet.aggregateSha256,
      source: "task0b_production_database_read_only_binding",
      verified: true
    },
    telegramObservation: {
      mode: "long_polling",
      botIdentitySha256: "8".repeat(64),
      webhookUrlSha256: createHash("sha256").update("").digest("hex"),
      source: "telegram_getme_and_getwebhookinfo_read_only",
      verified: true
    },
    actionPolicy: {
      managerOwned: false,
      stopStartRollbackAuthorized: false,
      requiresPassedPreReleaseGates: true,
      requiresMergedCandidate: true,
      requiresExplicitProductionGo: true,
      requiresActionSpecificAuthority: true
    },
    source: "legacy_unmanaged_process_admin_database_telegram_read_only",
    verified: true
  };
  expect(() => api.validateTask0BReleaseFreezeEvidence(
    legacy,
    CANDIDATE_SHA,
    "2026-07-18T09:10:00.000Z"
  )).not.toThrow();
  expect(() => api.assertTask0BPreviousRuntimeActionAuthorized(legacy.previousRuntimeIdentity))
    .toThrow(/legacy_unmanaged_previous_runtime_action_forbidden/);

  for (const mutate of [
    (value: any) => { value.previousRuntimeIdentity.adminObservation.observedRuntimeSha = "f".repeat(40); },
    (value: any) => { value.previousRuntimeIdentity.productionDatabaseObservation.schemaState = "schema_032_verified"; },
    (value: any) => { value.previousRuntimeIdentity.telegramObservation.mode = "webhook"; },
    (value: any) => { value.previousRuntimeIdentity.actionPolicy.managerOwned = true; },
    (value: any) => { value.previousRuntimeIdentity.managerExecutableSha256 = "6".repeat(64); }
  ]) {
    const changed = structuredClone(legacy);
    mutate(changed);
    expect(() => api.validateTask0BReleaseFreezeEvidence(
      changed,
      CANDIDATE_SHA,
      "2026-07-18T09:10:00.000Z"
    )).toThrow();
  }

  const producer: any = await import("../../scripts/captureTask0BPreflight");
  const legacyConfig: any = buildTask0BPreflightConfig(resolve(tmpdir(), "task0b-legacy-config"));
  legacyConfig.previousRuntimeIdentity = {
    kind: "legacy_unmanaged_previous_runtime",
    processId: legacy.previousRuntimeIdentity.processId,
    processStartedAt: legacy.previousRuntimeIdentity.processStartedAt,
    commandLineSha256: legacy.previousRuntimeIdentity.commandLineSha256,
    executablePathSha256: legacy.previousRuntimeIdentity.executablePathSha256,
    workingDirectoryFingerprintSha256: legacy.previousRuntimeIdentity.workingDirectoryFingerprintSha256,
    entrypointPathFingerprintSha256: legacy.previousRuntimeIdentity.entrypointPathFingerprintSha256,
    adminUrl: "http://127.0.0.1:18080/",
    adminReadOnlyAuthEnvName: "TASK0B_PREVIOUS_RUNTIME_ADMIN_READ_ONLY_AUTH",
    expectedRuntimeVersionSha256: legacy.previousRuntimeIdentity.adminObservation.runtimeVersionSha256,
    telegramReadOnlyAuthEnvName: "TASK0B_PREVIOUS_RUNTIME_TELEGRAM_READ_ONLY_AUTH",
    expectedTelegramBotIdentitySha256: legacy.previousRuntimeIdentity.telegramObservation.botIdentitySha256
  };
  expect(() => producer.validateTask0BPreflightConfig(legacyConfig, legacyConfig.issuedAt)).not.toThrow();
  expect(producer.parseTask0BLegacyEntrypoint(
    '"C:\\Program Files\\nodejs\\node.exe" --import tsx "C:\\runtime\\src\\index.ts"'
  )).toBe("C:\\runtime\\src\\index.ts");
  expect(typeof producer.fingerprintTask0BLegacyExecutablePath).toBe("function");
  for (const executablePath of [null, "", "node.exe"]) {
    await expect(producer.fingerprintTask0BLegacyExecutablePath(executablePath))
      .rejects.toThrow(/legacy.*executable/i);
  }
  const executableRoot = await mkdtemp(join(tmpdir(), "task0b-legacy-executable-"));
  try {
    const executablePath = join(executableRoot, "node.exe");
    await writeFile(executablePath, "test-only executable identity", "utf8");
    await expect(producer.fingerprintTask0BLegacyExecutablePath(executablePath))
      .resolves.toMatch(/^[0-9a-f]{64}$/);
  } finally {
    await rm(executableRoot, { recursive: true, force: true });
  }
  for (const commandLine of [
    'node C:\\runtime\\src\\index.ts --task0b-manager-producer=task0b_repo_runtime_manager_v1',
    'node C:\\one\\src\\index.ts C:\\two\\src\\index.ts',
    'node src\\index.ts'
  ]) expect(() => producer.parseTask0BLegacyEntrypoint(commandLine)).toThrow();
  for (const [field, value] of [
    ["adminReadOnlyAuthEnvName", "ADMIN_TOKEN"],
    ["telegramReadOnlyAuthEnvName", "BOT_TOKEN"]
  ]) {
    const changed = structuredClone(legacyConfig);
    changed.previousRuntimeIdentity[field] = value;
    expect(() => producer.validateTask0BPreflightConfig(changed, changed.issuedAt)).toThrow();
  }
  const store: any = await import("../../src/release/releaseManifestStoreV2");
  const sanitized = Object.fromEntries([
    "databaseRole", "databaseName", "databaseFingerprintSha256", "operationalConfigPath", "operationalConfigSha256",
    "candidateStartCommandId", "candidateStartTemplateSha256", "candidateStopCommandId", "candidateStopTemplateSha256",
    "previousStartCommandId", "previousStartTemplateSha256", "previousStopCommandId", "previousStopTemplateSha256"
  ].map((key) => [key, legacy[key]]));
  const readPreviousRuntime = async () => ({
    sha: PREVIOUS_RUNTIME_SHA,
    label: PREVIOUS_RUNTIME_LABEL,
    source: "legacy_unmanaged_process_admin_database_telegram_read_only",
    verified: true,
    identity: structuredClone(legacy.previousRuntimeIdentity)
  });
  const commonDependencies = {
    readCandidateState: async () => ({
      sha: CANDIDATE_SHA,
      clean: true,
      worktreePathFingerprintSha256: legacy.candidateWorktree.worktreePathFingerprintSha256,
      source: "git_direct_read"
    }),
    readPreviousRuntime,
    readSanitizedRehearsalBinding: async () => sanitized,
    readRuntimeManager: async () => legacy.runtimeManager,
    readProductionDatabase: async () => legacy.productionDatabase,
    readRollbackWorktree: async () => legacy.rollbackWorktree,
    readPostgresTools: async () => legacy.postgresTools,
    inspectArtifactRoot: async () => legacy.artifactRoot,
    probeCandidatePort: async () => legacy.candidatePort
  };
  const captured = await producer.captureTask0BReleaseFreezeEvidence({
    now: () => new Date("2026-07-18T09:00:00.000Z"),
    readOperatorConfigBinding: async () => legacy.operatorConfig,
    ...commonDependencies
  });
  expect(captured.previousRuntimeIdentity.kind).toBe("legacy_unmanaged_previous_runtime");
  const freeze = store.deriveReleaseFreezeIdentityV2(captured);
  await expect(producer.captureTask0BReleaseRevalidationEvidence(captured, freeze, {
    now: () => new Date("2026-07-18T09:10:00.000Z"),
    ...commonDependencies
  })).resolves.toMatchObject({
    current: { previousRuntimeIdentity: { kind: "legacy_unmanaged_previous_runtime", processId: 11088 } }
  });
  await expect(producer.captureTask0BReleaseRevalidationEvidence(captured, freeze, {
    now: () => new Date("2026-07-18T09:10:00.000Z"),
    ...commonDependencies,
    readPreviousRuntime: async () => {
      const current = await readPreviousRuntime();
      current.identity.processId += 1;
      return current;
    }
  })).rejects.toThrow(/runtime|revalidation/i);
});

it("[REQ-38][TASK0B-CAPTURE] produces secret-free direct evidence without runtime DB migration or Telegram mutation", { timeout: 15_000 }, async () => {
  const producer: any = await import("../../scripts/captureTask0BPreflight");
  const reads: string[] = [];
  const direct = buildCompleteTask0BPreflight();
  const sanitized = {
    databaseRole: direct.databaseRole,
    databaseName: direct.databaseName,
    databaseFingerprintSha256: direct.databaseFingerprintSha256,
    operationalConfigPath: direct.operationalConfigPath,
    operationalConfigSha256: direct.operationalConfigSha256,
    candidateStartCommandId: direct.candidateStartCommandId,
    candidateStartTemplateSha256: direct.candidateStartTemplateSha256,
    candidateStopCommandId: direct.candidateStopCommandId,
    candidateStopTemplateSha256: direct.candidateStopTemplateSha256,
    previousStartCommandId: direct.previousStartCommandId,
    previousStartTemplateSha256: direct.previousStartTemplateSha256,
    previousStopCommandId: direct.previousStopCommandId,
    previousStopTemplateSha256: direct.previousStopTemplateSha256
  };
  const evidence = await producer.captureTask0BReleaseFreezeEvidence({
    now: () => new Date("2026-07-18T09:00:00.000Z"),
    readOperatorConfigBinding: async () => { reads.push("operator_config"); return direct.operatorConfig; },
    readCandidateState: async () => {
      const phase = reads.includes("candidate_before") ? "candidate_after" : "candidate_before";
      reads.push(phase);
      return {
        sha: CANDIDATE_SHA,
        clean: true,
        worktreePathFingerprintSha256: direct.candidateWorktree.worktreePathFingerprintSha256,
        source: "git_direct_read"
      };
    },
    readPreviousRuntime: async () => {
      reads.push("runtime");
      return {
        sha: PREVIOUS_RUNTIME_SHA,
        label: PREVIOUS_RUNTIME_LABEL,
        source: "runtime_manager_attestation_and_process_direct_read",
        verified: true,
        identity: direct.previousRuntimeIdentity
      };
    },
    readSanitizedRehearsalBinding: async () => {
      reads.push("sanitized");
      return sanitized;
    },
    readRuntimeManager: async () => { reads.push("manager"); return direct.runtimeManager; },
    readProductionDatabase: async () => { reads.push("database"); return direct.productionDatabase; },
    readRollbackWorktree: async () => { reads.push("rollback"); return direct.rollbackWorktree; },
    readPostgresTools: async () => { reads.push("tools"); return direct.postgresTools; },
    inspectArtifactRoot: async () => { reads.push("root"); return direct.artifactRoot; },
    probeCandidatePort: async () => { reads.push("port"); return direct.candidatePort; }
  });
  expect(reads).toEqual([
    "operator_config", "candidate_before", "runtime", "sanitized", "manager", "database", "rollback", "tools", "root", "port",
    "candidate_after", "runtime"
  ]);
  expect(evidence).toEqual(direct);
  expect(JSON.stringify(evidence)).not.toMatch(/postgresql:\/\/|bot.?token|api.?key|credential|secret/i);

  const guessed = {
    now: () => new Date("2026-07-18T09:00:00.000Z"),
    readOperatorConfigBinding: async () => direct.operatorConfig,
    readCandidateState: async () => ({
      sha: CANDIDATE_SHA,
      clean: true,
      worktreePathFingerprintSha256: direct.candidateWorktree.worktreePathFingerprintSha256,
      source: "git_direct_read"
    }),
    readPreviousRuntime: async () => ({
      sha: PREVIOUS_RUNTIME_SHA,
      label: PREVIOUS_RUNTIME_LABEL,
      source: "operator_guess",
      verified: true
    }),
    readSanitizedRehearsalBinding: async () => sanitized,
    readRuntimeManager: async () => direct.runtimeManager,
    readProductionDatabase: async () => direct.productionDatabase,
    readRollbackWorktree: async () => direct.rollbackWorktree,
    readPostgresTools: async () => direct.postgresTools,
    inspectArtifactRoot: async () => direct.artifactRoot,
    probeCandidatePort: async () => direct.candidatePort
  };
  await expect(producer.captureTask0BReleaseFreezeEvidence(guessed)).rejects.toThrow(/source|verified/i);
  const verifiedRuntime = async () => ({
    sha: PREVIOUS_RUNTIME_SHA,
    label: PREVIOUS_RUNTIME_LABEL,
    source: "runtime_manager_attestation_and_process_direct_read",
    verified: true,
    identity: direct.previousRuntimeIdentity
  });
  const unstableStates = [
    { sha: CANDIDATE_SHA, clean: true, worktreePathFingerprintSha256: "0".repeat(64), source: "git_direct_read" },
    { sha: "f".repeat(40), clean: true, worktreePathFingerprintSha256: "0".repeat(64), source: "git_direct_read" }
  ];
  await expect(producer.captureTask0BReleaseFreezeEvidence({
    ...guessed,
    readPreviousRuntime: verifiedRuntime,
    readCandidateState: async () => unstableStates.shift()
  })).rejects.toThrow(/candidate|worktree|head/i);
  await expect(producer.captureTask0BReleaseFreezeEvidence({
    ...guessed,
    readPreviousRuntime: verifiedRuntime,
    readCandidateState: async () => ({
      sha: CANDIDATE_SHA,
      clean: false,
      worktreePathFingerprintSha256: "0".repeat(64),
      source: "git_direct_read"
    })
  })).rejects.toThrow(/candidate|worktree|clean/i);
  let runtimeReadCount = 0;
  await expect(producer.captureTask0BReleaseFreezeEvidence({
    ...guessed,
    readPreviousRuntime: async () => {
      runtimeReadCount += 1;
      const runtime = await verifiedRuntime();
      return runtimeReadCount === 1 ? runtime : {
        ...runtime,
        identity: { ...runtime.identity, processId: runtime.identity.processId + 1 }
      };
    }
  })).rejects.toThrow(/runtime.*changed/i);

  const runtimeStartEvidence = {
    version: "runtime-manager-start-evidence-v1",
    generationId: direct.previousRuntimeIdentity.generationId,
    runtimeSha: PREVIOUS_RUNTIME_SHA,
    runtimeLabel: PREVIOUS_RUNTIME_LABEL,
    processId: direct.previousRuntimeIdentity.processId,
    processStartedAt: direct.previousRuntimeIdentity.processStartedAt,
    commandLineSha256: direct.previousRuntimeIdentity.commandLineSha256,
    executablePathSha256: direct.previousRuntimeIdentity.executablePathSha256,
    workingDirectoryFingerprintSha256: direct.previousRuntimeIdentity.workingDirectoryFingerprintSha256,
    entrypointPathFingerprintSha256: direct.previousRuntimeIdentity.entrypointPathFingerprintSha256,
    managerExecutableSha256: direct.previousRuntimeIdentity.managerExecutableSha256,
    attestedAt: direct.previousRuntimeIdentity.attestedAt,
    producerId: direct.previousRuntimeIdentity.producerId,
    commandId: "runtime_manager_previous_identity",
    templateSha256: direct.previousRuntimeIdentity.templateSha256,
    exitCode: 0
  };
  const runtimeProcess = {
    processId: runtimeStartEvidence.processId,
    processStartedAt: runtimeStartEvidence.processStartedAt,
    commandLineSha256: runtimeStartEvidence.commandLineSha256,
    executablePathSha256: runtimeStartEvidence.executablePathSha256,
    runtimeSha: runtimeStartEvidence.runtimeSha,
    runtimeLabel: runtimeStartEvidence.runtimeLabel,
    workingDirectoryFingerprintSha256: runtimeStartEvidence.workingDirectoryFingerprintSha256,
    entrypointPathFingerprintSha256: runtimeStartEvidence.entrypointPathFingerprintSha256,
    runtimeProcessCount: 1
  };
  expect(() => producer.validateTask0BPreviousRuntimeIdentity(
    runtimeStartEvidence,
    runtimeProcess,
    {
      sha: PREVIOUS_RUNTIME_SHA,
      label: PREVIOUS_RUNTIME_LABEL,
      managerExecutableSha256: runtimeStartEvidence.managerExecutableSha256
    },
    direct.previousRuntimeIdentity.startEvidenceSha256
  )).not.toThrow();
  for (const mutation of [
    (value: any) => { value.runtimeSha = "f".repeat(40); },
    (value: any) => { value.runtimeLabel = `previous-${"f".repeat(8)}`; },
    (value: any) => { value.processId += 1; },
    (value: any) => { value.processStartedAt = "2026-07-17T19:39:13.000Z"; },
    (value: any) => { value.commandLineSha256 = "e".repeat(64); },
    (value: any) => { value.executablePathSha256 = "e".repeat(64); },
    (value: any) => { value.workingDirectoryFingerprintSha256 = "e".repeat(64); },
    (value: any) => { value.entrypointPathFingerprintSha256 = "e".repeat(64); },
    (value: any) => { value.managerExecutableSha256 = "e".repeat(64); },
    (value: any) => { value.producerId = "operator_guess"; },
    (value: any) => { value.attestedAt = "2026-07-17T19:42:00.001Z"; },
    (value: any) => { value.exitCode = 1; }
  ]) {
    const invalid = structuredClone(runtimeStartEvidence);
    mutation(invalid);
    expect(() => producer.validateTask0BPreviousRuntimeIdentity(
      invalid,
      runtimeProcess,
      {
        sha: PREVIOUS_RUNTIME_SHA,
        label: PREVIOUS_RUNTIME_LABEL,
        managerExecutableSha256: runtimeStartEvidence.managerExecutableSha256
      },
      direct.previousRuntimeIdentity.startEvidenceSha256
    )).toThrow();
  }
  expect(() => producer.createTask0BRuntimeManagerStartEvidence({
    observation: runtimeProcess,
    generationId: runtimeStartEvidence.generationId,
    runtimeSha: PREVIOUS_RUNTIME_SHA,
    runtimeLabel: PREVIOUS_RUNTIME_LABEL,
    managerExecutableSha256: runtimeStartEvidence.managerExecutableSha256,
    attestedAt: runtimeStartEvidence.attestedAt
  })).not.toThrow();
  const managedCommand = `node --import tsx "${resolve("src", "index.ts")}" `
    + `--task0b-manager-producer=task0b_repo_runtime_manager_v1 `
    + `--task0b-runtime-sha=${PREVIOUS_RUNTIME_SHA} --task0b-runtime-label=${PREVIOUS_RUNTIME_LABEL}`;
  expect(producer.parseTask0BManagedRuntimeCommand(managedCommand)).toEqual({
    runtimeSha: PREVIOUS_RUNTIME_SHA,
    runtimeLabel: PREVIOUS_RUNTIME_LABEL,
    entrypointPath: resolve("src", "index.ts")
  });
  for (const invalidCommand of [
    managedCommand.replace("--task0b-manager-producer=task0b_repo_runtime_manager_v1 ", ""),
    `${managedCommand} --task0b-runtime-sha=${PREVIOUS_RUNTIME_SHA}`,
    managedCommand.replace(PREVIOUS_RUNTIME_LABEL, "foreign-label"),
    managedCommand.replace(`"${resolve("src", "index.ts")}"`, "src/index.ts")
  ]) expect(() => producer.parseTask0BManagedRuntimeCommand(invalidCommand)).toThrow(/command|binding/i);
  expect(() => producer.validateTask0BPreflightConfig({ version: "task0b-preflight-config-v1" })).toThrow();
  const staleConfig = buildTask0BPreflightConfig(resolve(tmpdir(), "task0b-stale"));
  staleConfig.issuedAt = "2026-07-18T08:00:00.000Z";
  staleConfig.expiresAt = "2026-07-18T08:15:00.000Z";
  expect(() => producer.validateTask0BPreflightConfig(staleConfig, "2026-07-18T08:15:00.001Z")).toThrow(/unverified/i);
  expect(() => producer.validateTask0BPreflightConfig({
    ...buildTask0BPreflightConfig(resolve(tmpdir(), "task0b-secret")),
    rawCommand: "BOT_TOKEN=123456789:AAExampleTokenValue"
  })).toThrow(/secret/i);
  for (const invalidProvider of [
    { kind: "host_executables" },
    { kind: "docker_pinned_image", immutableImageId: "postgres:16-alpine", networkMode: "none", pullAllowed: false },
    { kind: "docker_pinned_image", immutableImageId: `sha256:${"f".repeat(64)}`, networkMode: "bridge", pullAllowed: false },
    { kind: "docker_pinned_image", immutableImageId: `sha256:${"f".repeat(64)}`, networkMode: "none", pullAllowed: true }
  ]) {
    expect(() => producer.validateTask0BPreflightConfig({
      ...buildTask0BPreflightConfig(resolve(tmpdir(), "task0b-provider")),
      postgresToolProvider: invalidProvider
    })).toThrow(/postgres|provider|unverified/i);
  }

  const artifactRoot = await makeProtectedTempDir("task0b-preflight-");
  try {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    expect(packageJson.scripts["release:task0b:preflight"]).toBe(
      "node --import tsx scripts/captureTask0BPreflight.ts"
    );
    expect(packageJson.scripts["release:task0b:runtime-manager"]).toBe(
      "node --import tsx scripts/manageTask0BRuntime.ts"
    );
    const managerBytes = await readFile(resolve("scripts", "manageTask0BRuntime.ts"));
    const managerConfig = buildTask0BPreflightConfig(artifactRoot);
    managerConfig.runtimeManager.executorSha256 = createHash("sha256").update(managerBytes).digest("hex");
    await expect(producer.createTask0BDirectDependencies(
      producer.validateTask0BPreflightConfig(managerConfig)
    ).readRuntimeManager()).resolves.toMatchObject({
      executorPath: "scripts/manageTask0BRuntime.ts",
      producerId: "task0b_repo_runtime_manager_v1"
    });
    const wrongManagerConfig = structuredClone(managerConfig);
    wrongManagerConfig.runtimeManager.executorSha256 = "f".repeat(64);
    await expect(producer.createTask0BDirectDependencies(
      producer.validateTask0BPreflightConfig(wrongManagerConfig)
    ).readRuntimeManager()).rejects.toThrow(/manager|executor|hash/i);
    await expect(producer.captureTask0BPreflightFromArtifactRoot(artifactRoot)).rejects.toThrow(/config/i);
    const guessedConfig = buildTask0BPreflightConfig(artifactRoot);
    guessedConfig.source = "operator_guess" as any;
    await writeFile(join(artifactRoot, "task0b-preflight-config.json"), JSON.stringify(guessedConfig));
    await expect(producer.captureTask0BPreflightFromArtifactRoot(artifactRoot)).rejects.toThrow(/config|verified/i);

    const stableEvidence = buildCompleteTask0BPreflight();
    await producer.writeTask0BReleaseFreezeEvidenceExclusive(artifactRoot, stableEvidence);
    const firstBytes = await readFile(join(artifactRoot, "task0b-release-freeze.json"));
    expect(firstBytes).toEqual(Buffer.from(`${canonicalReleaseJsonV2(stableEvidence)}\n`, "utf8"));
    await expect(producer.writeTask0BReleaseFreezeEvidenceExclusive(artifactRoot, stableEvidence)).rejects.toThrow();
    expect(await readFile(join(artifactRoot, "task0b-release-freeze.json"))).toEqual(firstBytes);

    const candidatePort = await new Promise<number>((resolvePort, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0 }, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close((error) => error ? reject(error) : resolvePort(port));
      });
    });
    const portConfig = buildTask0BPreflightConfig(artifactRoot);
    portConfig.candidatePort.port = candidatePort;
    portConfig.runtimeManager.candidateAdminUrl = `http://127.0.0.1:${candidatePort}/`;
    portConfig.runtimeManager.candidateAdminUrlFingerprintSha256 = createHash("sha256")
      .update(portConfig.runtimeManager.candidateAdminUrl).digest("hex");
    const operationalConfig = Buffer.from(JSON.stringify({
      version: "controlled-runtime-operational-config-v1",
      candidateWorktree: resolve("."),
      previousWorktree: portConfig.rollbackWorktreePath,
      candidateAdminUrl: `http://127.0.0.1:${candidatePort}/`,
      previousAdminUrl: "http://127.0.0.1:28787/",
      databaseUrlEnv: "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL",
      telegramRecorderPath: "runtime-telegram-recorder.json"
    }));
    portConfig.sanitizedRehearsal.operationalConfigSha256 = createHash("sha256").update(operationalConfig).digest("hex");
    await writeFile(join(artifactRoot, "runtime-operational-config.json"), operationalConfig);
    const portDependencies = producer.createTask0BDirectDependencies(producer.validateTask0BPreflightConfig(portConfig));
    await portDependencies.readSanitizedRehearsalBinding();
    const portEvidence = await portDependencies.probeCandidatePort();
    expect(portEvidence).toMatchObject({ host: "127.0.0.1", port: candidatePort, available: true });
    const mismatchedPortConfig = structuredClone(portConfig);
    mismatchedPortConfig.candidatePort.port = candidatePort === 65_535 ? candidatePort - 1 : candidatePort + 1;
    expect(() => producer.validateTask0BPreflightConfig(mismatchedPortConfig)).toThrow(/admin|port|binding/i);
    await new Promise<void>((resolveBind, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: candidatePort }, () => {
        server.close((error) => error ? reject(error) : resolveBind());
      });
    });
    const wrongOperationalConfig = Buffer.from(JSON.stringify({
      ...JSON.parse(operationalConfig.toString("utf8")),
      candidateAdminUrl: `http://127.0.0.1:${candidatePort === 65_535 ? candidatePort - 1 : candidatePort + 1}/`
    }));
    const operationalMismatch = structuredClone(portConfig);
    operationalMismatch.sanitizedRehearsal.operationalConfigSha256 = createHash("sha256")
      .update(wrongOperationalConfig).digest("hex");
    await writeFile(join(artifactRoot, "runtime-operational-config.json"), wrongOperationalConfig);
    const operationalMismatchDependencies = producer.createTask0BDirectDependencies(
      producer.validateTask0BPreflightConfig(operationalMismatch)
    );
    await operationalMismatchDependencies.readSanitizedRehearsalBinding();
    await expect(operationalMismatchDependencies.probeCandidatePort()).rejects.toThrow(/admin|port|binding/i);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
  const unsafeRoot = await makeProtectedTempDir("task0b-unsafe-root-");
  try {
    if (process.platform === "win32") {
      await execFileAsync("icacls.exe", [unsafeRoot, "/grant", "*S-1-1-0:(OI)(CI)M"]);
    } else {
      await chmod(unsafeRoot, 0o777);
    }
    await expect(producer.captureTask0BPreflightFromArtifactRoot(unsafeRoot)).rejects.toThrow(/access|acl|permission/i);
  } finally {
    await rm(unsafeRoot, { recursive: true, force: true });
  }

  const unsafeParent = await mkdtemp(join(homedir(), "task0b-unsafe-parent-"));
  const protectedChild = join(unsafeParent, "protected-child");
  await mkdir(protectedChild);
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
      ]);
      const currentSid = stdout.trim();
      await execFileAsync("icacls.exe", [
        protectedChild,
        "/inheritance:r",
        "/grant:r",
        `*${currentSid}:(OI)(CI)F`,
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F"
      ]);
      await execFileAsync("icacls.exe", [
        unsafeParent,
        "/inheritance:r",
        "/grant:r",
        `*${currentSid}:(OI)(CI)F`,
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
        "*S-1-5-32-546:(OI)(CI)M"
      ]);
    } else {
      await chmod(unsafeParent, 0o770);
      await chmod(protectedChild, 0o700);
    }
    await expect(producer.captureTask0BPreflightFromArtifactRoot(protectedChild))
      .rejects.toThrow(/access|acl|permission/i);
  } finally {
    await rm(unsafeParent, { recursive: true, force: true });
  }
});

it("[REQ-38][TASK0B-REVALIDATION] accepts a fresh immutable-freeze-bound recheck after the original preflight expires", async () => {
  const manifest: any = await import("../../src/release/remediationReleaseManifest");
  const producer: any = await import("../../scripts/captureTask0BPreflight");
  const store: any = await import("../../src/release/releaseManifestStoreV2");
  const frozen = buildCompleteTask0BPreflight();
  const freeze = store.deriveReleaseFreezeIdentityV2(frozen);
  const sanitized = {
    databaseRole: frozen.databaseRole,
    databaseName: frozen.databaseName,
    databaseFingerprintSha256: frozen.databaseFingerprintSha256,
    operationalConfigPath: frozen.operationalConfigPath,
    operationalConfigSha256: frozen.operationalConfigSha256,
    candidateStartCommandId: frozen.candidateStartCommandId,
    candidateStartTemplateSha256: frozen.candidateStartTemplateSha256,
    candidateStopCommandId: frozen.candidateStopCommandId,
    candidateStopTemplateSha256: frozen.candidateStopTemplateSha256,
    previousStartCommandId: frozen.previousStartCommandId,
    previousStartTemplateSha256: frozen.previousStartTemplateSha256,
    previousStopCommandId: frozen.previousStopCommandId,
    previousStopTemplateSha256: frozen.previousStopTemplateSha256
  };
  const currentRoot = {
    ...frozen.artifactRoot,
    exclusiveWriteFingerprintSha256: "9".repeat(64)
  };
  const evidence = await producer.captureTask0BReleaseRevalidationEvidence(frozen, freeze, {
    now: () => new Date("2026-07-18T10:00:00.000Z"),
    readCandidateState: async () => ({
      sha: CANDIDATE_SHA,
      clean: true,
      worktreePathFingerprintSha256: frozen.candidateWorktree.worktreePathFingerprintSha256,
      source: "git_direct_read"
    }),
    readPreviousRuntime: async () => ({
      sha: PREVIOUS_RUNTIME_SHA,
      label: PREVIOUS_RUNTIME_LABEL,
      source: "runtime_manager_attestation_and_process_direct_read",
      verified: true,
      identity: frozen.previousRuntimeIdentity
    }),
    readSanitizedRehearsalBinding: async () => sanitized,
    readRuntimeManager: async () => frozen.runtimeManager,
    readProductionDatabase: async () => frozen.productionDatabase,
    readRollbackWorktree: async () => frozen.rollbackWorktree,
    readPostgresTools: async () => frozen.postgresTools,
    inspectArtifactRoot: async () => currentRoot,
    probeCandidatePort: async () => frozen.candidatePort
  });

  expect(() => manifest.validateTask0BReleaseFreezeEvidence(
    frozen,
    CANDIDATE_SHA,
    evidence.observedAt
  )).toThrow(/stale/i);
  expect(() => manifest.validateTask0BReleaseRevalidationEvidence(
    evidence,
    frozen,
    freeze,
    "2026-07-18T10:10:00.000Z"
  )).not.toThrow();
  const mismatchedDatabase = structuredClone(evidence);
  mismatchedDatabase.current.productionDatabase.clusterFingerprintSha256 = "f".repeat(64);
  expect(() => manifest.validateTask0BReleaseRevalidationEvidence(
    mismatchedDatabase,
    frozen,
    freeze,
    "2026-07-18T10:10:00.000Z"
  )).toThrow(/binding|database|revalidation/i);
  expect(() => manifest.validateTask0BReleaseRevalidationEvidence(
    evidence,
    frozen,
    freeze,
    "2026-07-18T10:15:00.001Z"
  )).toThrow(/stale/i);
});

dockerIt("[REQ-38][TASK0B-TOOLS] attests pg tools from an existing pinned image without pull or network", async () => {
  const producer: any = await import("../../scripts/captureTask0BPreflight");
  const artifactRoot = await makeProtectedTempDir("task0b-tools-");
  try {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"]);
    const immutableImageId = stdout.trim();
    const config: any = buildTask0BPreflightConfig(artifactRoot);
    config.postgresToolProvider = {
      kind: "docker_pinned_image",
      immutableImageId,
      networkMode: "none",
      pullAllowed: false
    };
    const tools = await producer.createTask0BDirectDependencies(
      producer.validateTask0BPreflightConfig(config)
    ).readPostgresTools();
    expect(tools).toMatchObject({
      source: "pinned_docker_image_direct_probe",
      verified: true,
      provider: {
        kind: "docker_pinned_image",
        immutableImageId,
        networkMode: "none",
        pullAllowed: false
      },
      pgDump: { versionProbeExitCode: 0, commandId: "postgres_tool_pg_dump_attest" },
      pgRestore: { versionProbeExitCode: 0, commandId: "postgres_tool_pg_restore_attest" }
    });
    expect(JSON.stringify(tools)).not.toMatch(/postgres:16-alpine|--pull|postgresql:\/\//i);

    config.postgresToolProvider.immutableImageId = `sha256:${"f".repeat(64)}`;
    await expect(producer.createTask0BDirectDependencies(
      producer.validateTask0BPreflightConfig(config)
    ).readPostgresTools()).rejects.toThrow(/direct_probe|docker|image|tool/i);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

postgresIt("[REQ-38][TASK0B-DATABASE] reads production identity and schema pre-state in a disposable read-only transaction", async () => {
  const databaseUrl = process.env.PLAN5_TASK0B_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("PLAN5_TASK0B_TEST_DATABASE_URL is required");
  const parsed = new URL(databaseUrl);
  if (decodeURIComponent(parsed.pathname.slice(1)) !== "tron_watch" || Number(parsed.port || 5432) === 55999) {
    throw new Error("Task0B PostgreSQL test requires an isolated disposable tron_watch database");
  }
  const producer: any = await import("../../scripts/captureTask0BPreflight");
  const artifactRoot = await makeProtectedTempDir("task0b-postgres-");
  const previous = process.env.TASK0B_PRODUCTION_DATABASE_URL;
  process.env.TASK0B_PRODUCTION_DATABASE_URL = databaseUrl;
  const observer = new pg.Client({ connectionString: databaseUrl });
  await observer.connect();
  try {
    await observer.query(`create table wallet_approvals (
      watched_wallet_id text, token_contract text, spender_address text, amount_raw text, is_unlimited boolean,
      current_allowance_raw text, spender_type text, status text, last_approval_tx_hash text, last_approval_at timestamptz,
      risk_level text, risk_score integer, risk_reasons jsonb, last_alerted_tx_hash text, updated_at timestamptz
    )`);
    await observer.query(`create table observed_transactions (
      poisoning_check_status text, poisoning_attempts integer, poisoning_next_retry_at timestamptz,
      poisoning_logical_offset integer, poisoning_page_count integer, poisoning_fetched_count integer,
      poisoning_oldest_fetched_at timestamptz, poisoning_lookup_coverage text,
      poisoning_accumulated_lookup_json jsonb, poisoning_last_error text, poisoning_updated_at timestamptz,
      poisoning_checked_at timestamptz
    )`);
    const before = await observer.query("select to_regclass('public.schema_migration_receipts')::text as receipt_table");
    const identity = await observer.query(`select inet_server_port() as server_port,
      current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid`);
    const control = await observer.query("select system_identifier::text as system_identifier from pg_control_system()");
    const configInput: any = buildTask0BPreflightConfig(artifactRoot);
    configInput.productionDatabaseExpected = {
      databaseName: "tron_watch",
      endpointHost: "127.0.0.1",
      endpointPort: Number(parsed.port),
      connectedServerPort: Number(identity.rows[0].server_port),
      systemIdentifier: String(control.rows[0].system_identifier),
      databaseOid: String(identity.rows[0].database_oid),
      serverVersionNum: String(identity.rows[0].server_version_num)
    };
    configInput.productionDatabaseExpected.identityFingerprintSha256 =
      producer.buildTask0BProductionDatabaseIdentityFingerprint(configInput.productionDatabaseExpected);
    const config = producer.validateTask0BPreflightConfig(configInput);
    const evidence = await producer.createTask0BDirectDependencies(config).readProductionDatabase();
    expect(evidence).toMatchObject({
      name: "tron_watch",
      endpointHostClass: "loopback",
      source: "protected_config_bound_postgresql_direct_read_only",
      verified: true
    });
    expect(evidence.endpointFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.clusterFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.approvedIdentityFingerprintSha256).toBe(configInput.productionDatabaseExpected.identityFingerprintSha256);
    expect(evidence.identityMatchedApprovedConfig).toBe(true);
    const after = await observer.query("select to_regclass('public.schema_migration_receipts')::text as receipt_table");
    expect(after.rows).toEqual(before.rows);
    process.env.TASK0B_PRODUCTION_DATABASE_URL = `${databaseUrl}?host=example.invalid&port=5432`;
    await expect(producer.createTask0BDirectDependencies(config).readProductionDatabase()).rejects.toThrow(/binding|query|url/i);
    process.env.TASK0B_PRODUCTION_DATABASE_URL = `${databaseUrl}#host=example.invalid`;
    await expect(producer.createTask0BDirectDependencies(config).readProductionDatabase()).rejects.toThrow(/binding|query|url/i);
    process.env.TASK0B_PRODUCTION_DATABASE_URL = databaseUrl;
    for (const field of ["systemIdentifier", "databaseOid", "serverVersionNum"] as const) {
      const wrongInput = structuredClone(configInput);
      wrongInput.productionDatabaseExpected[field] = field === "serverVersionNum" ? "150000" : "9".repeat(12);
      wrongInput.productionDatabaseExpected.identityFingerprintSha256 =
        producer.buildTask0BProductionDatabaseIdentityFingerprint(wrongInput.productionDatabaseExpected);
      const wrongConfig = producer.validateTask0BPreflightConfig(wrongInput);
      await expect(producer.createTask0BDirectDependencies(wrongConfig).readProductionDatabase())
        .rejects.toThrow(/identity|database|binding/i);
    }
    const wrongPortInput = structuredClone(configInput);
    wrongPortInput.productionDatabaseExpected.endpointPort += 1;
    wrongPortInput.productionDatabaseExpected.identityFingerprintSha256 =
      producer.buildTask0BProductionDatabaseIdentityFingerprint(wrongPortInput.productionDatabaseExpected);
    const wrongPortConfig = producer.validateTask0BPreflightConfig(wrongPortInput);
    await expect(producer.createTask0BDirectDependencies(wrongPortConfig).readProductionDatabase())
      .rejects.toThrow(/binding|database|connect|probe/i);
    const forgedFingerprintInput = structuredClone(configInput);
    forgedFingerprintInput.productionDatabaseExpected.identityFingerprintSha256 = "f".repeat(64);
    expect(() => producer.validateTask0BPreflightConfig(forgedFingerprintInput)).toThrow(/database|identity|unverified/i);
    await observer.query(`create table schema_migration_receipts (
      version integer primary key, filename text not null, checksum_sha256 text not null
    )`);
    await observer.query(
      "insert into schema_migration_receipts(version, filename, checksum_sha256) values (33, '033_unknown.sql', $1)",
      ["f".repeat(64)]
    );
    await expect(producer.createTask0BDirectDependencies(config).readProductionDatabase()).rejects.toThrow(/receipt|schema/i);
    await observer.query("truncate schema_migration_receipts");
    await observer.query(
      "insert into schema_migration_receipts(version, filename, checksum_sha256) values (32, $1, $2)",
      ["032_telegram_runtime_forensics_data_contracts.sql", "f".repeat(64)]
    );
    await expect(producer.createTask0BDirectDependencies(config).readProductionDatabase()).rejects.toThrow(/receipt|schema/i);
  } finally {
    await observer.query("drop table if exists schema_migration_receipts").catch(() => undefined);
    await observer.query("drop table if exists observed_transactions").catch(() => undefined);
    await observer.query("drop table if exists wallet_approvals").catch(() => undefined);
    await observer.end();
    if (previous === undefined) delete process.env.TASK0B_PRODUCTION_DATABASE_URL;
    else process.env.TASK0B_PRODUCTION_DATABASE_URL = previous;
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

it("[REQ-38][CANDIDATE-SCOPE] accepts exact approved Plan5 candidate scope and rejects AP or unknown paths", async () => {
  const runner: any = await import("../../scripts/verifyRemediationRelease");
  const { stdout: candidateScope } = await execFileAsync("git", [
    "diff", "--name-only", "--no-renames", "-z", `${PLAN_BASE_SHA}..HEAD`
  ]);
  expect(() => runner.validatePlan5CandidateScope(candidateScope)).not.toThrow();
  expect(() => runner.validatePlan5CandidateScope([
    "src/release/remediationReleaseManifest.ts",
    "scripts/captureTask0BPreflight.ts",
    "scripts/createProductionBackupEvidence.ts",
    "scripts/manageTask0BRuntime.ts",
    "tests/release/task0bRuntimeManager.acceptance.test.ts",
    "tests/release/productionBackup.acceptance.test.ts",
    "scripts/finalizeTelegramAcceptance.ts",
    "scripts/rehearseRemediationRuntimePreload.ts",
    "docs/knowledge/03-job-lifecycle.md",
    "docs/knowledge/05-where-is-money-and-incoming.md",
    "docs/knowledge/06-deepcheck.md",
    "docs/knowledge/07-risk-scoring-matrix.md",
    "docs/knowledge/08-admin-and-bot-ux.md",
    "docs/knowledge/09-current-decisions.md",
    "docs/knowledge/10-open-problems.md",
    "docs/knowledge/12-runbooks.md",
    "docs/knowledge/13-agent-observations.md",
    "docs/superpowers/verification/plan5-release/README.md"
  ].join("\0") + "\0")).not.toThrow();
  expect(() => runner.validatePlan5CandidateScope("docs/knowledge/03-job-lifecycle-and-async-checks.md\0")).toThrow();
  expect(() => runner.validatePlan5CandidateScope("src/monitor/addressPoisoning.ts\0")).toThrow();
  expect(() => runner.validatePlan5CandidateScope("src/unapproved.ts\0")).toThrow();
  expect(() => runner.validatePlan5CandidateScope(
    "docs/audit/2026-07-system-audit/golden-v2/locked/cases/unknown-case/adjudication.json\0"
  )).toThrow();
  expect(() => runner.validatePlan5CandidateScope(
    "docs/audit/2026-07-system-audit/golden-v2/locked/cases/regression-tbl7/unapproved.json\0"
  )).toThrow();
  expect(() => runner.validatePlan5CandidateScope(
    "docs/audit/2026-07-system-audit/golden-v2/../unapproved.json\0"
  )).toThrow();
  expect(() => runner.validatePlan5CandidateScope(
    "src/monitor/addressPoisoning.ts\0src/release/remediationReleaseManifest.ts\0"
  )).toThrow();
  expect(() => runner.validatePlan5CandidateScope(" src/release/remediationReleaseManifest.ts\0")).toThrow();
  expect(() => runner.validatePlan5CandidateScope("src\\release\\remediationReleaseManifest.ts\0")).toThrow();
  expect(() => runner.validatePlan5CandidateScope("src/release/remediationReleaseManifest.ts\n")).toThrow();
  expect(Object.values(runner.PLAN5_CLEANUP_DATABASES)).toEqual([
    "tron_watch_plan1", "tron_watch_plan2", "tron_watch_plan3", "tron_watch_plan4",
    "tron_watch_plan5_clean", "tron_watch_plan5_clone", "tron_watch_plan5_runtime_sanitized"
  ]);
});

it("[REQ-38][ARTIFACT-HANDLE] rejects identity changes and platform-invalid containment through one opened handle", async () => {
  const runner: any = await import("../../scripts/verifyRemediationRelease");
  const root = resolve("C:/outside-plan5-artifacts");
  const target = join(root, "evidence.json");
  let closed = false;
  const dependencies = {
    async lstat() { return { isFile: () => true, isSymbolicLink: () => false, size: 2, dev: 1, ino: 1 }; },
    async realpath() { return target; },
    async open() {
      return {
        async stat() { return { isFile: () => true, size: 2, dev: 1, ino: 2 }; },
        async readFile() { return Buffer.from("{}"); },
        async close() { closed = true; }
      };
    }
  };
  await expect(runner.readSafeArtifactFileWithDependencies(root, "evidence.json", dependencies)).rejects.toThrow();
  expect(closed).toBe(true);
  let successfulClose = false;
  const validDependencies = {
    async lstat() { return { isFile: () => true, isSymbolicLink: () => false, size: 2, dev: 1, ino: 1 }; },
    async realpath() { return process.platform === "win32" ? target.toUpperCase() : target; },
    async open() {
      return {
        async stat() { return { isFile: () => true, size: 2, dev: 1, ino: 1 }; },
        async readFile() { return Buffer.from("{}"); },
        async close() { successfulClose = true; }
      };
    }
  };
  await expect(runner.readSafeArtifactFileWithDependencies(root, "evidence.json", validDependencies)).resolves.toEqual(Buffer.from("{}"));
  expect(successfulClose).toBe(true);
  await expect(runner.readSafeArtifactFileWithDependencies(root, "evidence.json", {
    ...validDependencies,
    async lstat() { return { isFile: () => true, isSymbolicLink: () => true, size: 2, dev: 1, ino: 1 }; }
  })).rejects.toThrow(/regular file/i);
  let statCall = 0;
  await expect(runner.readSafeArtifactFileWithDependencies(root, "evidence.json", {
    ...validDependencies,
    async open() {
      return {
        async stat() {
          statCall += 1;
          return { isFile: () => true, size: 2, dev: 1, ino: statCall === 1 ? 1 : 2 };
        },
        async readFile() { return Buffer.from("{}"); },
        async close() { /* asserted through rejection */ }
      };
    }
  })).rejects.toThrow(/during read/i);
});

it("[REQ-38][G07-SCHEMA-BINDING] requires distinct semantic clean and production-clone schema evidence", async () => {
  const runner: any = await import("../../scripts/verifyRemediationRelease");
  const base = {
    candidateSha: CANDIDATE_SHA,
    databaseRole: "clean",
    databaseFingerprintSha256: "1".repeat(64),
    migrationFilename: "032_telegram_runtime_forensics_data_contracts.sql",
    candidateBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    receiptChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    shortChecksum: "41217f64c33c",
    postconditionsSha256: "d".repeat(64),
    schema033: {
      version: 33,
      migrationFilename: "033_unified_wallet_check.sql",
      checksumSha256: "d04f2aff20370a78862604c92ccbc6bf7c8b1024f95e03b4af2c8f018e701f7",
      catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
      verificationReceiptSha256: "e".repeat(64)
    },
    firstApply: "applied",
    secondApply: "already_verified"
  };
  const clean = Buffer.from(JSON.stringify(base));
  const clone = Buffer.from(JSON.stringify({ ...base, databaseRole: "production_clone", databaseFingerprintSha256: "2".repeat(64) }));
  expect(() => runner.validateOfflineSchemaArtifactSet(CANDIDATE_SHA, clean, clone)).not.toThrow();
  expect(() => runner.validateOfflineSchemaArtifactSet(CANDIDATE_SHA, clean, Buffer.from(JSON.stringify({ ...base, databaseRole: "production_clone" })))).toThrow();
});

it("[AC-41][NON-VITEST-GATES] executes direct full Vitest typecheck diff scope and PostgreSQL cleanup fail closed", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const executionRoot = resolve(tmpdir(), "plan5-exact-candidate-snapshot");
  const calls: Array<{ executable: string; args: string[]; cwd: string }> = [];
  const valid = await runner.runNonVitestReleaseChecks({
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA,
    env: {},
    executionRoot
  }, {
    run(executable, args, _env, cwd) {
      calls.push({ executable, args: [...args], cwd });
      return { status: 0, stdout: "", stderr: "", signal: null };
    },
    async postgresCleanup() {
      return {
        tron_watch_plan1: [],
        tron_watch_plan2: [],
        tron_watch_plan3: [],
        tron_watch_plan4: [],
        tron_watch_plan5_clean: [],
        tron_watch_plan5_clone: [],
        tron_watch_plan5_runtime_sanitized: []
      };
    }
  });
  const typecheckCall = calls.find((call) => call.args.slice(-2).join(" ") === "run typecheck");
  const fullTestCall = calls.find((call) => call.args[0]?.replaceAll("\\", "/").endsWith("/vitest/vitest.mjs"));
  expect(typecheckCall).toBeDefined();
  expect(fullTestCall).toEqual({
    executable: process.execPath,
    args: expect.arrayContaining([
      expect.stringMatching(/[\\/]vitest[\\/]vitest\.mjs$/),
      "run", "--configLoader", "bundle", "--no-file-parallelism",
      "--testTimeout=300000", "--hookTimeout=300000"
    ]),
    cwd: executionRoot
  });
  expect(fullTestCall?.args[0]).toBe(resolve(executionRoot, "node_modules/vitest/vitest.mjs"));
  expect(typecheckCall?.cwd).toBe(executionRoot);
  expect(fullTestCall?.args.slice(1)).toEqual([
    "run", "--configLoader", "bundle", "--no-file-parallelism",
    "--testTimeout=300000", "--hookTimeout=300000"
  ]);
  expect(calls.indexOf(typecheckCall!)).toBeLessThan(calls.indexOf(fullTestCall!));
  expect(calls.some((call) => call.args.includes("test"))).toBe(false);
  const npmCalls = [typecheckCall!];
  expect(npmCalls.every((call) => !call.executable.toLowerCase().endsWith(".cmd"))).toBe(true);
  if (process.platform === "win32") {
    expect(npmCalls.every((call) => call.executable === process.execPath)).toBe(true);
    expect(npmCalls.every((call) => call.args[0]?.replaceAll("\\", "/").endsWith("/npm/bin/npm-cli.js"))).toBe(true);
  }
  expect(calls.filter((call) => call.args[0] === "diff")).toHaveLength(2);
  expect(calls).toContainEqual({
    executable: "git",
    args: ["diff", "--name-only", "--no-renames", "-z", `${PLAN_BASE_SHA}..${CANDIDATE_SHA}`],
    cwd: expect.not.stringMatching(/plan5-exact-candidate-snapshot/)
  });
  expect(calls).toContainEqual({
    executable: "git",
    args: ["merge-base", "--is-ancestor", PLAN_BASE_SHA, CANDIDATE_SHA],
    cwd: expect.not.stringMatching(/plan5-exact-candidate-snapshot/)
  });
  expect(valid.checks).toHaveLength(5);
  expect(valid.redactedTemplateSha256).toBe(COMMAND_TEMPLATE_SHA256.full_regression);
  expect(() => runner.validateNonVitestReleaseEvidence(valid, {
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA
  })).not.toThrow();
  const invalidEvidence = cloneFixture(valid);
  invalidEvidence.checks[1].state = "failed" as any;
  expect(() => runner.validateNonVitestReleaseEvidence(invalidEvidence, {
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA
  })).toThrow();

  let invalidDatabaseSpawnCount = 0;
  await expect(runner.runNonVitestReleaseChecks({
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA,
    env: { PLAN1_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch" },
    executionRoot
  }, {
    run() {
      invalidDatabaseSpawnCount += 1;
      return { status: 0, stdout: "", stderr: "", signal: null };
    },
    async postgresCleanup() {
      throw new Error("cleanup_must_not_run");
    }
  })).rejects.toThrow(/disposable|database/i);
  expect(invalidDatabaseSpawnCount).toBe(0);

  await expect(runner.runNonVitestReleaseChecks({
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA,
    env: {},
    executionRoot
  }, {
    run(_executable, args) {
      return args[0]?.replaceAll("\\", "/").endsWith("/vitest/vitest.mjs") && args[1] === "run"
        ? { status: 1, stdout: "", stderr: "failed", signal: null }
        : { status: 0, stdout: "", stderr: "", signal: null };
    },
    async postgresCleanup() {
      return {
        tron_watch_plan1: [],
        tron_watch_plan2: [],
        tron_watch_plan3: [],
        tron_watch_plan4: [],
        tron_watch_plan5_clean: [],
        tron_watch_plan5_clone: [],
        tron_watch_plan5_runtime_sanitized: []
      };
    }
  })).rejects.toThrow();

  await expect(runner.runNonVitestReleaseChecks({
    candidateSha: CANDIDATE_SHA,
    planBaseSha: "b".repeat(40),
    env: {},
    executionRoot
  }, {
    run() {
      return { status: 0, stdout: "", stderr: "", signal: null };
    },
    async postgresCleanup() {
      return Object.fromEntries(Object.values(runner.PLAN5_CLEANUP_DATABASES).map((database: string) => [database, []]));
    }
  })).rejects.toThrow(/base/i);
});

it("[REQ-38][TASK8B-RED-BATCH] requires the exact four-file behavioral RED batch and rejects suite failures", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const requiredFullName = "[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup";
  const files = [
    "tests/release/releaseManifestLifecycle.acceptance.test.ts",
    "tests/release/releaseManifestStore.acceptance.test.ts",
    "tests/release/productionReleaseEvidence.acceptance.test.ts",
    "tests/release/productionReleaseEvidence.postgres.test.ts"
  ];
  const report = {
    success: false,
    numFailedTestSuites: 1,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTests: 4,
    testResults: files.map((name) => ({
      name,
      message: "",
      assertionResults: [{
        fullName: name.endsWith(".postgres.test.ts") ? requiredFullName : `[REQ-38] ${name}`,
        status: name.endsWith(".postgres.test.ts") ? "failed" : "passed",
        failureMessages: name.endsWith(".postgres.test.ts")
          ? ["AssertionError: Plan 5 feature missing: exact PostgreSQL release evidence"]
          : []
      }]
    }))
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const evidence = {
    version: "task8b-red-evidence-v1",
    candidateSha: CANDIDATE_SHA,
    databaseName: "tron_watch_plan5_task8b_red",
    databasePort: 56002,
    requirePlan5Postgres: true,
    postgresAssertionsExecuted: 1,
    skippedPostgresAssertions: 0,
    vitestReportSha256: createHash("sha256").update(reportBytes).digest("hex"),
    cleanupDatabaseCount: 0
  };
  expect(() => runner.validateTask8BRedEvidence(evidence, report, reportBytes, CANDIDATE_SHA)).not.toThrow();
  const validateMutation = (mutated: typeof report) => {
    const bytes = Buffer.from(JSON.stringify(mutated));
    runner.validateTask8BRedEvidence({
      ...evidence,
      vitestReportSha256: createHash("sha256").update(bytes).digest("hex")
    }, mutated, bytes, CANDIDATE_SHA);
  };
  const extraFile = cloneFixture(report);
  extraFile.testResults.push(cloneFixture(extraFile.testResults[0]));
  expect(() => validateMutation(extraFile)).toThrow(/four-file|file set/i);
  const suiteFailure = cloneFixture(report);
  suiteFailure.testResults[0].message = "Error: module loader crashed";
  expect(() => validateMutation(suiteFailure)).toThrow(/suite-level|unclassified/i);
  const foreignFailure = cloneFixture(report);
  foreignFailure.testResults[0].assertionResults[0] = {
    fullName: "[REQ-38] foreign failure",
    status: "failed",
    failureMessages: ["AssertionError: expected true to be false"]
  };
  foreignFailure.numFailedTests = 2;
  expect(() => validateMutation(foreignFailure)).toThrow(/unclassified/i);
});

it("[REQ-38][G06-BOUNDED-RUNTIME] keeps the full regression bounded with Windows execution headroom", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  expect(runner.NON_VITEST_RELEASE_PROCESS_TIMEOUT_MS).toBe(90 * 60_000);
});

it("[AC-41][NON-VITEST-TIMEOUT] terminates the full descendant process tree", { timeout: 15_000 }, async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const root = await mkdtemp(join(tmpdir(), "plan5-non-vitest-timeout-"));
  const descendantPidPath = join(root, "descendant.pid");
  let descendantPid: number | undefined;
  try {
    const script = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });',
      'writeFileSync(process.argv[1], String(child.pid));',
      'setInterval(() => {}, 1000);'
    ].join("");
    const result = await runner.runBoundedReleaseProcess(
      process.execPath,
      ["-e", script, descendantPidPath],
      process.env,
      1_000
    );
    expect(result.error?.message).toMatch(/timed out/i);
    descendantPid = Number((await readFile(descendantPidPath, "utf8")).trim());
    expect(Number.isSafeInteger(descendantPid) && descendantPid > 0).toBe(true);
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
      try { process.kill(descendantPid, 0); } catch { alive = false; }
      if (alive) await new Promise((resolveDone) => setTimeout(resolveDone, 100));
    }
    expect(alive).toBe(false);
  } finally {
    if (descendantPid) {
      try { process.kill(descendantPid, "SIGKILL"); } catch { /* already terminated */ }
    }
    await rm(root, { recursive: true, force: true });
  }
});

it("[AC-41][SUITE-TIMEOUT] routes focused suites through tree-safe bounded execution", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  await expect(runner.runReleaseSuiteInvocation({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"]
  }, tmpdir(), process.env, 100)).rejects.toThrow(/timed out|terminate normally/i);
  await expect(runner.runReleaseSuiteInvocation({
    executable: process.execPath,
    args: ["-e", "process.exit(0)"]
  }, tmpdir(), process.env, 5_000)).resolves.toBe(0);
});

it("[AC-41][NON-VITEST-UTF8] preserves split multibyte output bytes for evidence hashing", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const result = await runner.runBoundedReleaseProcess(
    process.execPath,
    ["-e", "process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac])), 100)"],
    process.env,
    5_000
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("€");
});

it("[AC-41][SUITE-RUNNER] rejects missing skipped filtered failed or nonzero group execution", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const executionRoot = resolve(tmpdir(), "plan5-suite-exact-candidate-snapshot");
  const suiteArgs = runner.buildReleaseSuiteGroupInvocation(
    "plan5",
    resolve(tmpdir(), "plan5-suite-report.json"),
    executionRoot
  ).args;
  expect(suiteArgs[0]).toBe(resolve(executionRoot, "node_modules/vitest/vitest.mjs"));
  expect(suiteArgs).toContain("--no-file-parallelism");
  expect(suiteArgs).toContain("--testTimeout=120000");
  expect(suiteArgs).toContain("--hookTimeout=120000");
  const files = REQUIRED_SUITE_GROUPS.addressPoisoningRegression;
  const report = {
    success: true,
    numFailedTestSuites: 0,
    numFailedTests: 0,
    testResults: files.map((name, index) => ({
      name,
      assertionResults: [{
        fullName: `[G11] synthetic required execution ${index}`,
        status: "passed",
        failureMessages: []
      }]
    }))
  };
  expect(() => runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 0,
    report
  })).not.toThrow();
  const reportBytes = Buffer.from(JSON.stringify(report));
  const evidence = runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 0,
    report,
    reportBytes
  });
  expect(() => runner.validateReleaseSuiteGroupEvidence(evidence, {
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    report,
    reportBytes
  })).not.toThrow();
  expect(() => runner.validateReleaseSuiteGroupEvidence({ ...evidence, reportSha256: "f".repeat(64) }, {
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    report,
    reportBytes
  })).toThrow();
  expect(runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 0,
    report,
    reportBytes: Buffer.from("mutated report bytes")
  }).reportSha256).not.toBe(evidence.reportSha256);
  const missing = cloneFixture(report);
  missing.testResults.pop();
  expect(() => runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 0,
    report: missing
  })).toThrow();
  const skipped = cloneFixture(report);
  skipped.testResults[0].assertionResults[0].status = "skipped";
  expect(() => runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 0,
    report: skipped
  })).toThrow();
  expect(() => runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 1,
    report
  })).toThrow();
  const secret: any = cloneFixture(report);
  secret.metadata = { botToken: "123456789:AAExampleTokenValue" };
  expect(() => runner.buildReleaseSuiteGroupEvidence({
    groupId: "addressPoisoningRegression",
    candidateSha: CANDIDATE_SHA,
    exitCode: 0,
    report: secret
  })).toThrow(/secret/i);
});

it("[REQ-38][RELEASE-MANIFEST] rejects missing pending failed foreign-SHA or unhashed gate artifacts", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  const invalid = [
    (manifest: any) => { manifest.gates.splice(7, 1); },
    (manifest: any) => { manifest.gates[7].state = "pending"; },
    (manifest: any) => { manifest.gates[7].state = "failed"; manifest.gates[7].exitCode = 1; },
    (manifest: any) => { manifest.gates[7].candidateSha = "f".repeat(40); },
    (manifest: any) => { manifest.gates[7].outputSha256 = "unhashed"; },
    (manifest: any) => { manifest.gates[7].redactedTemplateSha256 = "unhashed"; },
    (manifest: any) => { manifest.gates[7].redactedTemplateSha256 = "f".repeat(64); }
  ];
  for (const mutate of invalid) {
    const manifest: any = cloneFixture(buildReleaseManifest());
    mutate(manifest);
    expect(() => validate(manifest)).toThrow();
  }
});

it("[REQ-38][RELEASE-PHASES] derives ready only from G00-G11 and released only from G00-G15", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  expect(() => validate(buildReleaseManifest("ready_for_release"))).not.toThrow();
  expect(() => validate(buildReleaseManifest("released"))).not.toThrow();

  const prematureReady: any = cloneFixture(buildReleaseManifest("ready_for_release"));
  prematureReady.gates[11].state = "pending";
  expect(() => validate(prematureReady)).toThrow();

  const prematureRelease: any = cloneFixture(buildReleaseManifest("released"));
  prematureRelease.gates[15].state = "pending";
  expect(() => validate(prematureRelease)).toThrow();

  const notReady: any = cloneFixture(prematureReady);
  notReady.overall = "not_ready";
  expect(() => validate(notReady)).not.toThrow();

  const productionInProgress: any = cloneFixture(buildReleaseManifest("ready_for_release"));
  productionInProgress.gates[12].state = "passed";
  expect(() => validate(productionInProgress)).toThrow();
  productionInProgress.overall = "not_ready";
  expect(() => validate(productionInProgress)).not.toThrow();
});

it("[REQ-38][RELEASE-SECRETS] rejects secret-like values in every artifact field", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  const probes: Array<[string, string]> = [
    ["id", "BOT_TOKEN=123456789:AAExampleTokenValue"],
    ["candidateSha", "TRONSCAN_API_KEY=example-secret-value"],
    ["commandId", "chat_id=123456789"],
    ["redactedTemplateSha256", "postgresql://release:secret@127.0.0.1/db"],
    ["startedAt", "DATABASE_URL=postgresql://user:secret@host/db"],
    ["finishedAt", "API_TOKEN=example-secret-value"],
    ["outputSha256", "TELEGRAM_BOT_TOKEN=123456789:AAExampleTokenValue"],
    ["state", "user_id=987654321"]
  ];
  for (const [field, secret] of probes) {
    const manifest: any = cloneFixture(buildReleaseManifest());
    manifest.gates[0][field] = secret;
    expect(() => validate(manifest), field).toThrow(/secret/i);
  }
  const nested: any = cloneFixture(buildReleaseManifest());
  nested.gates[0].diagnostic = { nested: { botToken: "123456789:AAExampleTokenValue" } };
  expect(() => validate(nested)).toThrow(/secret/i);
});

it("[REQ-35][REQ-36][PLAN5-RUNTIME] requires startup delivery and worker gates before ready_for_release", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  for (const gateId of ["G04_RUNTIME", "G08_VERSION_SANITIZED", "G10_ROLLBACK_REHEARSAL"]) {
    const manifest: any = cloneFixture(buildReleaseManifest());
    const gate = manifest.gates.find((item: any) => item.id === gateId);
    gate.state = "pending";
    expect(() => validate(manifest), gateId).toThrow();
  }
});

it("[G11][ADDRESS-POISONING] requires unchanged regression and excludes closeout from release readiness", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  const missingRegression: any = cloneFixture(buildReleaseManifest());
  const gate = missingRegression.gates.find((item: any) => item.id === PRE_RELEASE_GATE_IDS[11]);
  gate.commandId = GATE_COMMAND_IDS.G10_ROLLBACK_REHEARSAL;
  expect(() => validate(missingRegression)).toThrow();

  const closeoutSubstitution: any = cloneFixture(buildReleaseManifest());
  closeoutSubstitution.gates = closeoutSubstitution.gates.filter((item: any) => item.id !== "G11_POISONING_REGRESSION");
  closeoutSubstitution.gates.push({ ...closeoutSubstitution.gates[0], id: "APC-01", candidateSha: CANDIDATE_SHA });
  expect(() => validate(closeoutSubstitution)).toThrow();
});
