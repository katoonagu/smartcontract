import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import {
  REMEDIATION_COMMAND_TEMPLATE_SHA256,
  REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256
} from "../../src/release/remediationReleaseManifest";
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
  buildAcceptanceTraceSet,
  buildReleaseManifest,
  buildRollbackRehearsalEvidence,
  buildRuntimeVersion,
  buildRuntimeRehearsalEvidence,
  buildTerminalLegacyPopulation,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type ManifestApi = {
  REMEDIATION_REQUIRED_SUITE_GROUPS: unknown;
  validateRemediationReleaseManifest(value: unknown): unknown;
};

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
  const executions = trace.executions.map((execution) => ({ ...execution, failureMessages: [] }));
  expect(() => runner.assertTraceExecutionsCoveredBySuiteReports(trace, executions)).not.toThrow();
  expect(() => runner.assertTraceExecutionsCoveredBySuiteReports(trace, executions.slice(1))).toThrow();
  const skipped = cloneFixture(executions);
  skipped[0].status = "skipped";
  expect(() => runner.assertTraceExecutionsCoveredBySuiteReports(trace, skipped)).toThrow();
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
    version: "task0b-release-freeze-evidence-v1",
    candidateSha: CANDIDATE_SHA,
    observedAt: terminal.cutoff,
    freezeCutoff: terminal.cutoff,
    expiresAt: "2026-07-19T00:00:00.000Z",
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    databaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT,
    operationalConfigPath: "runtime-operational-config.json",
    operationalConfigSha256: createHash("sha256").update(operationalConfig).digest("hex"),
    candidateStartCommandId: "runtime_sanitized_rehearsal",
    candidateStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    candidateStopCommandId: "runtime_sanitized_stop",
    candidateStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.runtime_sanitized_stop,
    previousStartCommandId: "rollback_rehearsal",
    previousStartTemplateSha256: REMEDIATION_COMMAND_TEMPLATE_SHA256.rollback_rehearsal,
    previousStopCommandId: "rollback_stop",
    previousStopTemplateSha256: REMEDIATION_RUNTIME_CONTROL_TEMPLATE_SHA256.rollback_stop
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
    "",
    `<b>Инстанс</b>: <code>${PREVIOUS_RUNTIME_LABEL}</code>`,
    "<b>Режим</b>: <code>marked</code>",
    "По этой строке можно понять, какая версия runtime ответила в Telegram."
  ].join("\n");
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
    TRONSCAN_API_KEY: "secret-provider-key",
    PLAN5_TELEGRAM_BOT_TOKEN: "123456789:AAExampleTokenValue",
    TEST_TRONSCAN_API_KEY: "secret-provider-key",
    PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch_plan5_runtime_sanitized",
    REQUIRE_PLAN5_POSTGRES: "1"
  });
  expect(env.PATH).toBe("test-path");
  expect(env.DATABASE_URL).toBeUndefined();
  expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  expect(env.TRONSCAN_API_KEY).toBeUndefined();
  expect(env.PLAN5_TELEGRAM_BOT_TOKEN).toBeUndefined();
  expect(env.TEST_TRONSCAN_API_KEY).toBeUndefined();
  expect(env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL).toContain("tron_watch_plan5_runtime_sanitized");
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
      migration033OrLater: [],
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
  expect(() => api.validateTask0BaselineEvidence({
    ...baseline,
    nested: { telegramBotToken: "123456789:AAExampleTokenValue" }
  }, CANDIDATE_SHA, { isAncestor: () => true })).toThrow(/secret/i);
});

it("[REQ-38][CANDIDATE-SCOPE] accepts only approved Plan5 Task0-8 files and rejects AP or unknown paths", async () => {
  const runner: any = await import("../../scripts/verifyRemediationRelease");
  expect(() => runner.validatePlan5CandidateScope([
    "src/release/remediationReleaseManifest.ts",
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
  ].join("\n"))).not.toThrow();
  expect(() => runner.validatePlan5CandidateScope("docs/knowledge/03-job-lifecycle-and-async-checks.md\n")).toThrow();
  expect(() => runner.validatePlan5CandidateScope("src/monitor/addressPoisoning.ts\n")).toThrow();
  expect(() => runner.validatePlan5CandidateScope("src/unapproved.ts\n")).toThrow();
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
    firstApply: "applied",
    secondApply: "already_verified"
  };
  const clean = Buffer.from(JSON.stringify(base));
  const clone = Buffer.from(JSON.stringify({ ...base, databaseRole: "production_clone", databaseFingerprintSha256: "2".repeat(64) }));
  expect(() => runner.validateOfflineSchemaArtifactSet(CANDIDATE_SHA, clean, clone)).not.toThrow();
  expect(() => runner.validateOfflineSchemaArtifactSet(CANDIDATE_SHA, clean, Buffer.from(JSON.stringify({ ...base, databaseRole: "production_clone" })))).toThrow();
});

it("[AC-41][NON-VITEST-GATES] executes literal full test typecheck diff scope and PostgreSQL cleanup fail closed", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
  const calls: Array<{ executable: string; args: string[] }> = [];
  const valid = await runner.runNonVitestReleaseChecks({
    candidateSha: CANDIDATE_SHA,
    planBaseSha: PLAN_BASE_SHA,
    env: {}
  }, {
    run(executable, args) {
      calls.push({ executable, args: [...args] });
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
  expect(calls.some((call) => call.args.join(" ") === "test")).toBe(true);
  expect(calls.some((call) => call.args.join(" ") === "run typecheck")).toBe(true);
  expect(calls.filter((call) => call.args[0] === "diff")).toHaveLength(2);
  expect(calls).toContainEqual({
    executable: "git",
    args: ["merge-base", "--is-ancestor", PLAN_BASE_SHA, CANDIDATE_SHA]
  });
  expect(valid.checks).toHaveLength(5);
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
    env: { PLAN1_TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1/tron_watch" }
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
    env: {}
  }, {
    run(_executable, args) {
      return args[0] === "test"
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
    env: {}
  }, {
    run() {
      return { status: 0, stdout: "", stderr: "", signal: null };
    },
    async postgresCleanup() {
      return Object.fromEntries(Object.values(runner.PLAN5_CLEANUP_DATABASES).map((database: string) => [database, []]));
    }
  })).rejects.toThrow(/base/i);
});

it("[AC-41][SUITE-RUNNER] rejects missing skipped filtered failed or nonzero group execution", async () => {
  const runner = await import("../../scripts/verifyRemediationRelease");
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
