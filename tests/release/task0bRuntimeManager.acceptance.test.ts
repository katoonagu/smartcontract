import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  PREVIOUS_RUNTIME_LABEL,
  PREVIOUS_RUNTIME_SHA,
  buildReleaseManifest,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";

const SHA = CANDIDATE_SHA;
const SHA256 = "b".repeat(64);
const GENERATION = "release-409515ac-generation-0001";
const START_TEMPLATE = createHash("sha256")
  .update("release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>").digest("hex");
const STOP_TEMPLATE = createHash("sha256")
  .update("release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>").digest("hex");

const ACTION_PHASES = {
  runtime_manager_stop_previous: "pre_migration_shutdown",
  runtime_manager_start_candidate: "post_migration_rollout",
  runtime_manager_stop_candidate: "rollback_candidate_stop",
  runtime_manager_rollback_previous: "rollback_previous_start"
} as const;

type RuntimeCommandId = keyof typeof ACTION_PHASES;

function manifestBytes(manifest: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
}

function setGate(
  manifest: ReturnType<typeof buildReleaseManifest>,
  id: string,
  state: "pending" | "passed" | "failed" | "blocked"
): void {
  const gate = manifest.gates.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`missing test gate ${id}`);
  gate.state = state;
  gate.exitCode = state === "failed" ? 1 : 0;
}

function actionManifest(commandId: RuntimeCommandId) {
  const manifest = structuredClone(buildReleaseManifest("ready_for_release"));
  manifest.overall = "not_ready";
  setGate(manifest, "G12_PRODUCTION_BACKUP", "passed");
  if (commandId !== "runtime_manager_stop_previous") setGate(manifest, "G13_PRODUCTION_MIGRATION", "passed");
  if (commandId === "runtime_manager_stop_candidate") setGate(manifest, "G14_PRODUCTION_ROLLOUT", "failed");
  if (commandId === "runtime_manager_rollback_previous") setGate(manifest, "G13_PRODUCTION_MIGRATION", "failed");
  return manifest;
}

function productionAuthority(overrides: Record<string, unknown> = {}) {
  const manifest = actionManifest("runtime_manager_start_candidate");
  const bytes = manifestBytes(manifest);
  return {
    version: "task0b-runtime-authority-v1",
    scope: "production_go",
    source: "operator_protected_one_shot_production_go",
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    actionPhase: "post_migration_rollout",
    commandTemplateSha256: START_TEMPLATE,
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z",
    candidateSha: SHA,
    targetRuntimeSha: SHA,
    targetRuntimeLabel: `master-${SHA.slice(0, 8)}`,
    targetWorktreePath: "C:\\release\\candidate",
    targetWorktreeFingerprintSha256: SHA256,
    adminUrl: "http://127.0.0.1:28788/",
    adminUrlFingerprintSha256: createHash("sha256").update("http://127.0.0.1:28788/").digest("hex"),
    databaseRole: "production",
    databaseIdentityFingerprintSha256: "c".repeat(64),
    telegramTransport: "production",
    telegramBotIdentitySha256: createHash("sha256").update("test-only-token").digest("hex"),
    task0bEvidenceSha256: "d".repeat(64),
    releaseManifestPath: "release-manifest.json",
    releaseManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    releaseManifestOverall: "not_ready",
    explicitGo: true,
    forcePolicy: "graceful_only",
    startEvidencePath: null,
    startEvidenceSha256: null,
    ...overrides
  };
}

function authorityFor(commandId: RuntimeCommandId, manifest = actionManifest(commandId), overrides: Record<string, unknown> = {}) {
  const previousAction = commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_rollback_previous";
  const stopAction = commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_stop_candidate";
  const bytes = manifestBytes(manifest);
  return productionAuthority({
    commandId,
    actionPhase: ACTION_PHASES[commandId],
    commandTemplateSha256: commandId.includes("stop") ? STOP_TEMPLATE : START_TEMPLATE,
    targetRuntimeSha: previousAction ? PREVIOUS_RUNTIME_SHA : SHA,
    targetRuntimeLabel: previousAction ? PREVIOUS_RUNTIME_LABEL : `master-${SHA.slice(0, 8)}`,
    targetWorktreeFingerprintSha256: previousAction ? "2".repeat(64) : SHA256,
    releaseManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    releaseManifestOverall: manifest.overall,
    startEvidencePath: stopAction ? `runtime-start-evidence-${GENERATION}.json` : null,
    startEvidenceSha256: stopAction ? "1".repeat(64) : null,
    ...overrides
  });
}

function productionBindings(manifest: ReturnType<typeof buildReleaseManifest>) {
  return {
    task0b: {
      candidateSha: SHA,
      previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
      previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
      candidateWorktree: { worktreePathFingerprintSha256: SHA256 },
      previousRuntimeIdentity: { workingDirectoryFingerprintSha256: "2".repeat(64) },
      rollbackWorktree: { worktreePathFingerprintSha256: "2".repeat(64) },
      productionDatabase: { approvedIdentityFingerprintSha256: "c".repeat(64) },
      runtimeManager: {
        executorPath: "scripts/manageTask0BRuntime.ts",
        executorSha256: "9".repeat(64),
        candidateAdminUrl: "http://127.0.0.1:28788/"
      }
    },
    manifest,
    database: { approvedIdentityFingerprintSha256: "c".repeat(64) }
  };
}

it("[REQ-38][PLAN5-RUNTIME-PHASE-POSITIVE] authorizes each runtime action only at its exact production phase", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  for (const commandId of Object.keys(ACTION_PHASES) as RuntimeCommandId[]) {
    const manifest = actionManifest(commandId);
    const authority = api.validateTask0BProductionRuntimeAuthority(
      authorityFor(commandId, manifest),
      "2026-07-18T09:01:00.000Z"
    );
    const bindings = productionBindings(manifest);
    expect(() => api.assertTask0BProductionGoBindings(
      authority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
    )).not.toThrow();
  }
  const partialRollout = actionManifest("runtime_manager_start_candidate");
  const partialStop = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_stop_candidate", partialRollout),
    "2026-07-18T09:01:00.000Z"
  );
  const partialBindings = productionBindings(partialRollout);
  expect(() => api.assertTask0BProductionGoBindings(
    partialStop, partialBindings.task0b, partialBindings.manifest, partialBindings.database, "9".repeat(64)
  )).not.toThrow();
});

it("[REQ-38][PLAN5-RUNTIME-PHASE-NEGATIVE] rejects wrong overall gates phases and completed release before mutation or consumption", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const attempts: Array<{ commandId: RuntimeCommandId; manifest: ReturnType<typeof buildReleaseManifest> }> = [];
  const ready = buildReleaseManifest("ready_for_release");
  attempts.push({ commandId: "runtime_manager_stop_previous", manifest: ready });
  const missingG12 = actionManifest("runtime_manager_stop_previous");
  setGate(missingG12, "G12_PRODUCTION_BACKUP", "pending");
  missingG12.overall = "ready_for_release";
  attempts.push({ commandId: "runtime_manager_stop_previous", manifest: missingG12 });
  const missingG13 = actionManifest("runtime_manager_start_candidate");
  setGate(missingG13, "G13_PRODUCTION_MIGRATION", "pending");
  missingG13.overall = "not_ready";
  attempts.push({ commandId: "runtime_manager_start_candidate", manifest: missingG13 });
  const missingPreReleaseGate = actionManifest("runtime_manager_stop_previous");
  setGate(missingPreReleaseGate, "G11_POISONING_REGRESSION", "failed");
  attempts.push({ commandId: "runtime_manager_stop_previous", manifest: missingPreReleaseGate });
  for (const commandId of Object.keys(ACTION_PHASES) as RuntimeCommandId[]) {
    attempts.push({ commandId, manifest: buildReleaseManifest("released") });
  }

  for (const { commandId, manifest } of attempts) {
    const calls: string[] = [];
    expect(() => {
      const authority = api.validateTask0BProductionRuntimeAuthority(
        authorityFor(commandId, manifest),
        "2026-07-18T09:01:00.000Z"
      );
      const bindings = productionBindings(manifest);
      api.assertTask0BProductionGoBindings(
        authority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
      );
      calls.push("consume", commandId.includes("stop") ? "stop" : "spawn");
    }).toThrow(/phase|gate|overall|release|binding|authority/i);
    expect(calls).toEqual([]);
  }

  expect(() => api.validateTask0BProductionRuntimeAuthority(authorityFor(
    "runtime_manager_start_candidate",
    actionManifest("runtime_manager_start_candidate"),
    { actionPhase: "rollback_previous_start" }
  ), "2026-07-18T09:01:00.000Z")).toThrow(/phase|authority/i);
});

it("[REQ-38][PLAN5-RUNTIME-ROLLBACK] rejects candidate stop without start evidence and previous rollback without failed context", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const rollbackWithoutFailure = actionManifest("runtime_manager_start_candidate");
  for (const [commandId, manifest, authorityOverrides] of [
    ["runtime_manager_stop_candidate", actionManifest("runtime_manager_stop_candidate"), {
      startEvidencePath: null,
      startEvidenceSha256: null
    }],
    ["runtime_manager_rollback_previous", rollbackWithoutFailure, {}]
  ] as const) {
    const calls: string[] = [];
    expect(() => {
      const authority = api.validateTask0BProductionRuntimeAuthority(
        authorityFor(commandId, manifest, authorityOverrides),
        "2026-07-18T09:01:00.000Z"
      );
      const bindings = productionBindings(manifest);
      api.assertTask0BProductionGoBindings(
        authority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
      );
      calls.push("consume", commandId.includes("stop") ? "stop" : "spawn");
    }).toThrow(/rollback|failed|blocked|evidence|phase|authority/i);
    expect(calls).toEqual([]);
  }
});

it("[REQ-38][PLAN5-RUNTIME-MANIFEST-BYTES] validates the full exact manifest before mutation or one-shot consumption", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const manifest = actionManifest("runtime_manager_stop_previous");
  const authority = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_stop_previous", manifest),
    "2026-07-18T09:01:00.000Z"
  );
  expect(api.validateTask0BReleaseManifestBinding(authority, manifestBytes(manifest))).toEqual(
    expect.objectContaining({ candidateSha: SHA, overall: "not_ready" })
  );
  const incomplete = { ...manifest, requiredAcceptanceIds: manifest.requiredAcceptanceIds.slice(1) };
  const incompleteAuthority = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_stop_previous", incomplete as typeof manifest),
    "2026-07-18T09:01:00.000Z"
  );
  for (const changed of [
    [incompleteAuthority, manifestBytes(incomplete)],
    [authority, Buffer.from(`${JSON.stringify(manifest)} `, "utf8")]
  ] as const) {
    const calls: string[] = [];
    expect(() => {
      api.validateTask0BReleaseManifestBinding(changed[0], changed[1]);
      calls.push("consume", "stop");
    }).toThrow(/manifest|hash|acceptance|binding/i);
    expect(calls).toEqual([]);
  }
});

it("[REQ-38][TASK0B-MANAGER-AUTHORITY] keeps exact target manager DB Telegram and one-shot bindings", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const manifest = actionManifest("runtime_manager_start_candidate");
  const authority = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_start_candidate", manifest),
    "2026-07-18T09:01:00.000Z"
  );
  const bindings = productionBindings(manifest);
  for (const invalid of [
    { ...bindings, database: { approvedIdentityFingerprintSha256: "8".repeat(64) } },
    { ...bindings, task0b: { ...bindings.task0b, runtimeManager: { ...bindings.task0b.runtimeManager, executorSha256: "8".repeat(64) } } }
  ]) expect(() => api.assertTask0BProductionGoBindings(
    authority, invalid.task0b, invalid.manifest, invalid.database, "9".repeat(64)
  )).toThrow(/binding|production|manifest|manager/i);
  const rollbackManifest = actionManifest("runtime_manager_rollback_previous");
  const rollbackBindings = productionBindings(rollbackManifest);
  for (const previousMismatch of [
    { targetRuntimeSha: "3".repeat(40), targetRuntimeLabel: `previous-${"3".repeat(8)}` },
    { targetRuntimeSha: PREVIOUS_RUNTIME_SHA, targetRuntimeLabel: `foreign-${PREVIOUS_RUNTIME_SHA.slice(0, 8)}` },
    {
      targetRuntimeSha: PREVIOUS_RUNTIME_SHA,
      targetRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
      targetWorktreeFingerprintSha256: "3".repeat(64)
    }
  ]) {
    const invalidPrevious = api.validateTask0BProductionRuntimeAuthority(authorityFor(
      "runtime_manager_rollback_previous",
      rollbackManifest,
      previousMismatch
    ), "2026-07-18T09:01:00.000Z");
    expect(() => api.assertTask0BProductionGoBindings(
      invalidPrevious,
      rollbackBindings.task0b,
      rollbackBindings.manifest,
      rollbackBindings.database,
      "9".repeat(64)
    )).toThrow(/binding|previous|rollback|worktree/i);
  }
  expect(api.runtimeGenerationEvidencePath("start", GENERATION)).toBe(
    `runtime-start-evidence-${GENERATION}.json`
  );
  expect(api.runtimeGenerationEvidencePath("stop", GENERATION)).toBe(
    `runtime-stop-evidence-${GENERATION}.json`
  );
  expect(api.runtimeGenerationConsumptionPath(GENERATION)).toBe(
    `runtime-authority-consumed-${GENERATION}.json`
  );

  for (const invalid of [
    productionAuthority({ explicitGo: false }),
    productionAuthority({ releaseManifestOverall: "ready_for_release" }),
    productionAuthority({ releaseManifestOverall: "rolled_back" }),
    productionAuthority({ readyManifestPath: "release-manifest.json" }),
    productionAuthority({ commandTemplateSha256: "0".repeat(64) }),
    productionAuthority({ databaseRole: "runtime_sanitized" }),
    productionAuthority({ telegramTransport: "recording_disabled" }),
    productionAuthority({ generationId: "../escape" }),
    productionAuthority({ commandId: "runtime_sanitized_rehearsal" }),
    authorityFor("runtime_manager_stop_previous", actionManifest("runtime_manager_stop_previous"), { startEvidencePath: null })
  ]) expect(() => api.validateTask0BProductionRuntimeAuthority(
    invalid,
    "2026-07-18T09:01:00.000Z"
  )).toThrow(/authority|production|generation|command/i);

  expect(api.validateTask0BSanitizedRehearsalAuthority({
    task0bVerified: true,
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    telegramTransport: "recording_disabled",
    executorPath: "scripts/rehearseRemediationRuntime.ts"
  })).toEqual(expect.objectContaining({ telegramTransport: "recording_disabled" }));
  expect(() => api.validateTask0BSanitizedRehearsalAuthority({
    task0bVerified: true,
    databaseRole: "production",
    databaseName: "tron_watch",
    telegramTransport: "production",
    executorPath: "scripts/manageTask0BRuntime.ts"
  })).toThrow(/sanitized|rehearsal|transport/i);
});

it("[REQ-38][TASK0B-MANAGER-ENV] strips inherited environment and binds production DB and Telegram transport", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const currentAuthority = productionAuthority({
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  const env = api.buildTask0BProductionRuntimeEnvironment({
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Temp",
    BOT_TOKEN: "test-only-token",
    TASK0B_PRODUCTION_DATABASE_URL: "postgresql://test@127.0.0.1:55432/tron_watch",
    TRONSCAN_API_KEY: "test-provider-key",
    UNRELATED_SECRET: "must-not-leak",
    PLAN5_RUNTIME_REHEARSAL_PRELOAD: "1"
  }, currentAuthority, "C:\\protected\\plan5-no-dotenv");
  expect(env).toMatchObject({
    BOT_TOKEN: "test-only-token",
    DATABASE_URL: "postgresql://test@127.0.0.1:55432/tron_watch",
    RUNTIME_GIT_SHA: SHA,
    RUNTIME_INSTANCE_LABEL: `master-${SHA.slice(0, 8)}`,
    ADMIN_DASHBOARD_HOST: "127.0.0.1",
    ADMIN_DASHBOARD_PORT: "28788",
    DOTENV_CONFIG_PATH: "C:\\protected\\plan5-no-dotenv"
  });
  expect(env.UNRELATED_SECRET).toBeUndefined();
  expect(env.PLAN5_RUNTIME_REHEARSAL_PRELOAD).toBeUndefined();
  expect(env.TASK0B_PRODUCTION_DATABASE_URL).toBeUndefined();
  expect(() => api.buildTask0BProductionRuntimeEnvironment({
    BOT_TOKEN: "foreign-token",
    TASK0B_PRODUCTION_DATABASE_URL: "postgresql://test@127.0.0.1:55432/tron_watch"
  }, currentAuthority, "C:\\protected\\plan5-no-dotenv")).toThrow(/environment|telegram|missing/i);
});

it("[REQ-38][TASK0B-MANAGER-FRESHNESS] rejects a fresh GO over expired Task0B or changed operator config", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const task0b = buildTask0BReleaseFreezeEvidence({ observedAt: "2026-07-18T09:00:00.000Z" });
  const authority = productionAuthority({
    candidateSha: CANDIDATE_SHA,
    targetRuntimeSha: CANDIDATE_SHA,
    targetRuntimeLabel: `plan5-${CANDIDATE_SHA.slice(0, 8)}`,
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z"
  });
  expect(() => api.validateTask0BProductionGoEvidence(
    authority, task0b, task0b.operatorConfig, "2026-07-18T09:05:00.000Z"
  )).not.toThrow();
  const freshGo = {
    ...authority,
    issuedAt: "2026-07-18T09:15:30.000Z",
    expiresAt: "2026-07-18T09:20:00.000Z"
  };
  expect(() => api.validateTask0BProductionGoEvidence(
    freshGo, task0b, task0b.operatorConfig, "2026-07-18T09:16:00.000Z"
  )).toThrow(/stale|expired|freeze/i);
  expect(() => api.validateTask0BProductionGoEvidence(
    authority,
    task0b,
    { ...task0b.operatorConfig, contentSha256: "f".repeat(64) },
    "2026-07-18T09:05:00.000Z"
  )).toThrow(/operator|config|binding/i);
});

it("[REQ-38][TASK0B-MANAGER-START] writes append-only generation evidence before success and cleans a failed child", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const calls: string[] = [];
  await expect(api.completeTask0BManagedRuntimeStart({
    generationId: GENERATION,
    processId: 77,
    evidence: { processId: 77 },
    async writeEvidence(path: string) { calls.push(`write:${path}`); throw new Error("evidence collision"); },
    async terminateAndVerify(processId: number) { calls.push(`cleanup:${processId}`); }
  })).rejects.toThrow(/collision/);
  expect(calls).toEqual([
    `write:runtime-start-evidence-${GENERATION}.json`,
    "cleanup:77"
  ]);
});

it("[REQ-38][TASK0B-MANAGER-UNMARKED] blocks before authority consumption spawn or evidence", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const calls: string[] = [];
  await expect(api.executeTask0BAuthorizedStart({
    async countRuntimeCandidates() { return 1; },
    async consumeAuthority() { calls.push("consume"); },
    async startRuntime() { calls.push("spawn"); return { status: "started" }; }
  })).rejects.toThrow(/overlap|runtime|running/i);
  expect(calls).toEqual([]);
});

it("[REQ-38][TASK0B-MANAGER-STOP] verifies exact identity graceful exit zero overlap and explicit force policy", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const expected = { processId: 77, processStartedAt: "2026-07-18T09:00:00.000Z", runtimeProcessCount: 1 };
  const calls: string[] = [];
  const observations: Array<typeof expected | null> = [expected, null];
  await api.stopTask0BManagedRuntime(expected, "graceful_only", {
    async observeExact() { return observations.shift() ?? null; },
    async countRuntimeCandidates() { return 0; },
    signal(_pid: number, signal: string) { calls.push(signal); },
    async wait() {}
  }, { timeoutMs: 10, pollMs: 1 });
  expect(calls).toEqual(["SIGTERM"]);

  await expect(api.stopTask0BManagedRuntime(expected, "graceful_only", {
    async observeExact() { return expected; },
    async countRuntimeCandidates() { return 1; },
    signal() {},
    async wait() {}
  }, { timeoutMs: 2, pollMs: 1 })).rejects.toThrow(/graceful|timeout|running/i);

  const forced: string[] = [];
  let forceSent = false;
  await api.stopTask0BManagedRuntime(expected, "graceful_then_force", {
    async observeExact() { return forceSent ? null : expected; },
    async countRuntimeCandidates() { return 0; },
    signal(_pid: number, signal: string) { forced.push(signal); if (signal === "SIGKILL") forceSent = true; },
    async wait() { await new Promise((resolve) => setTimeout(resolve, 2)); }
  }, { timeoutMs: 1, pollMs: 1 });
  expect(forced).toEqual(["SIGTERM", "SIGKILL"]);
});
