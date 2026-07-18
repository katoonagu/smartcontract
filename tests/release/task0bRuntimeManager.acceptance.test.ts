import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";

const SHA = "a".repeat(40);
const SHA256 = "b".repeat(64);
const GENERATION = "release-409515ac-generation-0001";
const START_TEMPLATE = createHash("sha256")
  .update("release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>").digest("hex");
const STOP_TEMPLATE = createHash("sha256")
  .update("release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>").digest("hex");

function productionAuthority(overrides: Record<string, unknown> = {}) {
  return {
    version: "task0b-runtime-authority-v1",
    scope: "production_go",
    source: "operator_protected_one_shot_production_go",
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
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
    readyManifestPath: "release-manifest.json",
    readyManifestSha256: "e".repeat(64),
    readyManifestOverall: "ready_for_release",
    explicitGo: true,
    forcePolicy: "graceful_only",
    startEvidencePath: null,
    startEvidenceSha256: null,
    ...overrides
  };
}

it("[REQ-38][TASK0B-MANAGER-AUTHORITY] separates sanitized rehearsal from one-shot production GO", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const authority = api.validateTask0BProductionRuntimeAuthority(
    productionAuthority(),
    "2026-07-18T09:01:00.000Z"
  );
  expect(authority.scope).toBe("production_go");
  const bindings = {
    task0b: {
      candidateSha: SHA,
      previousRuntimeSha: "1".repeat(40),
      previousRuntimeLabel: `previous-${"1".repeat(8)}`,
      candidateWorktree: { worktreePathFingerprintSha256: SHA256 },
      previousRuntimeIdentity: { workingDirectoryFingerprintSha256: "2".repeat(64) },
      rollbackWorktree: { worktreePathFingerprintSha256: "2".repeat(64) },
      productionDatabase: { approvedIdentityFingerprintSha256: "c".repeat(64) },
      runtimeManager: {
        executorPath: "scripts/manageTask0BRuntime.ts",
        executorSha256: "9".repeat(64),
        candidateAdminUrl: authority.adminUrl
      }
    },
    manifest: { candidateSha: SHA, overall: "ready_for_release" },
    database: { approvedIdentityFingerprintSha256: "c".repeat(64) }
  };
  expect(() => api.assertTask0BProductionGoBindings(
    authority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
  )).not.toThrow();
  for (const exactAuthority of [
    authority,
    api.validateTask0BProductionRuntimeAuthority(productionAuthority({
      commandId: "runtime_manager_stop_candidate",
      commandTemplateSha256: STOP_TEMPLATE,
      startEvidencePath: "runtime-start-evidence-candidate-runtime-generation-0001.json",
      startEvidenceSha256: "1".repeat(64)
    }), "2026-07-18T09:01:00.000Z"),
    api.validateTask0BProductionRuntimeAuthority(productionAuthority({
      commandId: "runtime_manager_stop_previous",
      commandTemplateSha256: STOP_TEMPLATE,
      targetRuntimeSha: "1".repeat(40),
      targetRuntimeLabel: `previous-${"1".repeat(8)}`,
      targetWorktreeFingerprintSha256: "2".repeat(64),
      startEvidencePath: "runtime-start-evidence-previous-runtime-generation-0001.json",
      startEvidenceSha256: "1".repeat(64)
    }), "2026-07-18T09:01:00.000Z"),
    api.validateTask0BProductionRuntimeAuthority(productionAuthority({
      commandId: "runtime_manager_rollback_previous",
      commandTemplateSha256: START_TEMPLATE,
      targetRuntimeSha: "1".repeat(40),
      targetRuntimeLabel: `previous-${"1".repeat(8)}`,
      targetWorktreeFingerprintSha256: "2".repeat(64)
    }), "2026-07-18T09:01:00.000Z")
  ]) expect(() => api.assertTask0BProductionGoBindings(
    exactAuthority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
  )).not.toThrow();
  for (const invalid of [
    { ...bindings, manifest: { ...bindings.manifest, overall: "not_ready" } },
    { ...bindings, database: { approvedIdentityFingerprintSha256: "8".repeat(64) } },
    { ...bindings, task0b: { ...bindings.task0b, runtimeManager: { ...bindings.task0b.runtimeManager, executorSha256: "8".repeat(64) } } }
  ]) expect(() => api.assertTask0BProductionGoBindings(
    authority, invalid.task0b, invalid.manifest, invalid.database, "9".repeat(64)
  )).toThrow(/binding|production|manifest|manager/i);
  for (const previousMismatch of [
    { targetRuntimeSha: "3".repeat(40), targetRuntimeLabel: `previous-${"3".repeat(8)}` },
    { targetRuntimeSha: "1".repeat(40), targetRuntimeLabel: `foreign-${"1".repeat(8)}` },
    { targetRuntimeSha: "1".repeat(40), targetRuntimeLabel: `previous-${"1".repeat(8)}`, targetWorktreeFingerprintSha256: "3".repeat(64) }
  ]) {
    const invalidPrevious = api.validateTask0BProductionRuntimeAuthority(productionAuthority({
      commandId: "runtime_manager_rollback_previous",
      commandTemplateSha256: START_TEMPLATE,
      targetWorktreeFingerprintSha256: "2".repeat(64),
      ...previousMismatch
    }), "2026-07-18T09:01:00.000Z");
    expect(() => api.assertTask0BProductionGoBindings(
      invalidPrevious, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
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
    productionAuthority({ readyManifestOverall: "not_ready" }),
    productionAuthority({ commandTemplateSha256: "0".repeat(64) }),
    productionAuthority({ databaseRole: "runtime_sanitized" }),
    productionAuthority({ telegramTransport: "recording_disabled" }),
    productionAuthority({ generationId: "../escape" }),
    productionAuthority({ commandId: "runtime_sanitized_rehearsal" }),
    productionAuthority({
      commandId: "runtime_manager_stop_previous",
      commandTemplateSha256: createHash("sha256")
        .update("release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>").digest("hex"),
      startEvidencePath: "runtime-start-evidence-previous-runtime-generation-0001.json",
      startEvidenceSha256: "1".repeat(64)
    })
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
