import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import type { AppConfig } from "../../src/config";
import { createLegacyWhereIsMoneyExecution } from "../../src/forensics/deepForensicJob";
import {
  buildWhereLatencyReplayV1,
  LEGACY_WHERE_BEHAVIOR_SOURCE_FILES,
  LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
  projectWhereReplayConfig
} from "../../src/forensics/whereLatencyReplay";

const execFileAsync = promisify(execFile);

async function captureApi(): Promise<Record<string, any>> {
  return await import("../../scripts/captureWhereLatencyReplay") as Record<string, any>;
}

function secretConfig(): AppConfig {
  return {
    botToken: "bot-secret",
    databaseUrl: "postgres://db-secret",
    tronscanApiKey: "tron-primary-secret",
    tronscanApiKeys: ["tron-primary-secret", "tron-secondary-secret"],
    tronscanApiKeyGroups: [{
      groupId: "group-a",
      apiKeys: ["tron-secondary-secret", "tron-group-secret"]
    }],
    tronFullNodeApiKey: "fullnode-secret",
    rangeApiKey: "range-secret",
    evmExplorerApiKey: "evm-secret",
    alchemyApiKey: "alchemy-secret",
    llmApiKey: "llm-secret",
    adminDashboardToken: "admin-secret"
  } as AppConfig;
}

function replayFixtureBytes(): string {
  const sourceAddress = "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";
  const senderAddress = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
  const txHash = "a".repeat(64);
  const options = {
    sourceAddress,
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z"
  };
  const resolvedConfig = projectWhereReplayConfig({
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com/"),
    tronFullNodeBaseUrl: new URL("https://api.trongrid.io/"),
    rangeBaseUrl: new URL("https://api.range.org/"),
    evmExplorerBaseUrl: new URL("https://api.etherscan.io/"),
    tronscanTimeoutMs: 1,
    tronscanRetryAttempts: 1,
    tronscanRetryBaseDelayMs: 1,
    tronscanRequestMinIntervalMs: 1,
    tronscanGlobalRequestMinIntervalMs: 1,
    tronscanTransferRequestMinIntervalMs: 1,
    tronscanApprovalRequestMinIntervalMs: 1,
    tronscanContractRequestMinIntervalMs: 1,
    tronscanFullNodeRequestMinIntervalMs: 1,
    tronGridRequestMinIntervalMs: 1,
    tronscanAccountGroupRequestMinIntervalMs: 1,
    tronscanRateLimitCooldownMs: 1,
    tronscanPageLimit: 100,
    tronscanMaxInFlight: 1,
    tronscanGroupMaxInFlight: 1,
    tronscanApiKeys: [],
    tronscanApiKeyGroups: [],
    tronFullNodeApiKey: undefined,
    crossChainStage2Enabled: false,
    crossChainStage2MaxProviderCalls: 1,
    crossChainStage2CacheTtlMs: 1,
    rangeApiKey: undefined,
    rangeTimeoutMs: 1,
    rangeMaxCallsPerCheck: 1,
    evmExplorerApiKey: undefined,
    evmExplorerTimeoutMs: 1,
    evmExplorerMaxCallsPerCheck: 1,
    directHardEvidenceLiveLimit: null,
    directHardEvidenceConcurrency: null,
    tronAddressIndexSecondLayerMaxActiveWalletsPerJob: null,
    adminSecondLayerMaxActiveWallets: null
  } as any);
  return buildWhereLatencyReplayV1({
    schema: "where-latency-replay-v1",
    version: 1,
    baselineGitCommit: "4861f22e697652c688489ef4be6ab9698cd6ef9f",
    recorderGitCommit: "b".repeat(40),
    behaviorSourceFiles: [...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES],
    sourceTreeHash: LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
    recorderTreeClean: true,
    resolvedConfig,
    resolvedOptions: options,
    frozenClockIso: "2026-07-26T00:00:00.000Z",
    job: { ...options, options },
    routeCriticalTxHashes: [txHash],
    frozenKnownHardTxHashes: [],
    expectedOrdinaryOfficialUsdtTxHashes: [],
    routeCriticalAddresses: [sourceAddress],
    dependencies: [{
      method: "getTransaction",
      args: [txHash],
      response: { txID: txHash },
      origin: "supplemental_stage_b_fixture"
    }],
    indexedMovements: [{ txHashes: [txHash], rows: [{
      transferId: "transfer-1",
      txHash,
      blockNumber: 1,
      blockTimestamp: "2026-06-01T00:00:00.000Z",
      eventIndex: 0,
      provider: "tronscan",
      providerRowOrdinalInTx: 0,
      fromAddress: senderAddress,
      toAddress: sourceAddress,
      amountRaw: "1",
      method: "transfer",
      eventType: "Transfer",
      callerAddress: senderAddress,
      contractRet: "SUCCESS",
      finalResult: "SUCCESS",
      reverted: false,
      riskTransaction: false,
      confirmed: true
    }] }],
    assertionQueries: [{
      chain: "tron",
      addresses: [sourceAddress],
      txHashes: [txHash],
      rows: []
    }],
    rawTransactions: [{ txHash, response: { txID: txHash } }],
    expectedStableFacts: {
      subjectAddress: sourceAddress,
      balanceFormingTransfers: [{ txHash }]
    } as any
  } as any).canonicalJson;
}

describe("Where latency replay capture", () => {
  it("is import-safe for focused recorder tests", async () => {
    await expect(execFileAsync(
      process.execPath,
      ["--import", "tsx", "-e", "await import('./scripts/captureWhereLatencyReplay.ts')"],
      {
        cwd: process.cwd(),
        env: { ...process.env, BOT_TOKEN: "", DATABASE_URL: "" },
        encoding: "utf8"
      }
    )).resolves.toMatchObject({ stdout: "" });
  });

  it("accepts PostgreSQL Date rows without capture mutations", async () => {
    const api = await captureApi();
    expect(typeof api.parseCaptureTimestamp).toBe("function");
    expect(typeof api.createReadOnlyCaptureRuntimeDeps).toBe("function");

    const postgresDate = new Date("2026-01-01T00:00:00.000Z");
    const parsedDate = api.parseCaptureTimestamp(postgresDate, "capture_timestamp_invalid");
    expect(parsedDate).toEqual(postgresDate);
    expect(parsedDate).not.toBe(postgresDate);
    expect(api.parseCaptureTimestamp("2026-07-01T00:00:00.000Z", "capture_timestamp_invalid"))
      .toEqual(new Date("2026-07-01T00:00:00.000Z"));
    for (const invalid of [new Date(Number.NaN), "not-a-date", 1, null, {}]) {
      expect(() => api.parseCaptureTimestamp(invalid, "capture_timestamp_invalid"))
        .toThrow("capture_timestamp_invalid");
    }

    const read = vi.fn();
    const forbidden = vi.fn();
    const deps = api.createReadOnlyCaptureRuntimeDeps({
      tronClient: {},
      getLabelsForAddress: read,
      getAddressMetadata: read,
      updateForensicCheckJobProgress: forbidden,
      releaseForensicCheckJobToWaiting: forbidden,
      queueAddressUsdtHistory: forbidden,
      upsertForensicJobWait: forbidden,
      markWaitingForensicJobsReadyAfterTargetedIndex: forbidden
    });
    expect(deps.getLabelsForAddress).toBe(read);
    expect(deps.getAddressMetadata).toBe(read);
    for (const name of [
      "updateForensicCheckJobProgress",
      "releaseForensicCheckJobToWaiting",
      "queueAddressUsdtHistory",
      "upsertForensicJobWait",
      "markWaitingForensicJobsReadyAfterTargetedIndex"
    ]) expect(deps).not.toHaveProperty(name);

    const job = {
      id: "capture-job",
      kind: "where_is_money_check",
      subjectAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      status: "completed",
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-01T00:00:00.000Z"),
      priority: 0,
      chatId: null,
      messageId: null,
      requestedBy: null,
      progressJson: { original: true },
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null,
      createdAt: postgresDate,
      updatedAt: postgresDate,
      startedAt: null,
      completedAt: postgresDate
    } as any;
    const execution = createLegacyWhereIsMoneyExecution(deps, job);
    await execution.runInput.onProgress?.({ captureProgress: "memory-only" } as any);
    expect(job.progressJson).toMatchObject({ original: true, captureProgress: "memory-only" });
    expect(forbidden).not.toHaveBeenCalled();
    await execution.dispose();
  });

  it("rejects configured credentials before capture serialization", async () => {
    const api = await captureApi();
    expect(typeof api.assertCaptureValueContainsNoConfiguredSecrets).toBe("function");
    const config = secretConfig();
    const secrets = [
      config.botToken,
      config.databaseUrl,
      config.tronscanApiKey,
      ...config.tronscanApiKeys,
      ...config.tronscanApiKeyGroups.flatMap((group) => group.apiKeys),
      config.tronFullNodeApiKey,
      config.rangeApiKey,
      config.evmExplorerApiKey,
      config.alchemyApiKey,
      config.llmApiKey,
      config.adminDashboardToken
    ].filter((value): value is string => Boolean(value));
    for (const secret of secrets) {
      expect(() => api.assertCaptureValueContainsNoConfiguredSecrets(
        { provider: { error: `failed:${secret}:done` } },
        config
      )).toThrow("where_latency_replay_configured_secret_detected");
    }
    const escapedSecret = "quote\"slash\\control\nsecret";
    const escapedConfig = { ...config, llmApiKey: escapedSecret };
    let thrown: unknown;
    try {
      api.assertCaptureValueContainsNoConfiguredSecrets(
        { providerError: `echo:${escapedSecret}:end` },
        escapedConfig
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("where_latency_replay_configured_secret_detected");
    expect((thrown as Error).message).not.toContain(escapedSecret);
    expect(() => api.assertCaptureValueContainsNoConfiguredSecrets(
      { providerError: "safe failure" },
      config
    )).not.toThrow();
  });

  it("disposes the capture execution after success and failure", async () => {
    const api = await captureApi();
    expect(typeof api.runCaptureExecution).toBe("function");

    const success = {
      run: vi.fn(async () => ({ subjectAddress: "TSource" })),
      dispose: vi.fn(async () => undefined)
    };
    await expect(api.runCaptureExecution(success, { marker: "deps" }))
      .resolves.toEqual({ subjectAddress: "TSource" });
    expect(success.run).toHaveBeenCalledWith({ marker: "deps" });
    expect(success.dispose).toHaveBeenCalledTimes(1);

    const failure = {
      run: vi.fn(async () => { throw new Error("rerun failed"); }),
      dispose: vi.fn(async () => undefined)
    };
    await expect(api.runCaptureExecution(failure, {})).rejects.toThrow("rerun failed");
    expect(failure.dispose).toHaveBeenCalledTimes(1);
  });

  it("binds capture to the canonical replay config hash", async () => {
    const api = await captureApi();
    expect(typeof api.assertExpectedReplayConfigSha256).toBe("function");
    const resolvedConfig = { endpoint: "https://example.com/", capacity: 1 };
    const expected = createHash("sha256")
      .update(canonicalizeArtifactJson(resolvedConfig))
      .digest("hex");
    expect(() => api.assertExpectedReplayConfigSha256(resolvedConfig, expected)).not.toThrow();
    expect(() => api.assertExpectedReplayConfigSha256(resolvedConfig, null))
      .toThrow("where_latency_replay_expected_config_sha256_required");
    expect(() => api.assertExpectedReplayConfigSha256(resolvedConfig, "bad"))
      .toThrow("where_latency_replay_expected_config_sha256_invalid");
    expect(() => api.assertExpectedReplayConfigSha256(resolvedConfig, "f".repeat(64)))
      .toThrow("where_latency_replay_expected_config_sha256_mismatch");
  });

  it("validates canonical capture fixtures without DB or provider work", async () => {
    const api = await captureApi();
    expect(typeof api.validateWhereLatencyReplayFixture).toBe("function");
    const directory = await mkdtemp(join(tmpdir(), "where-replay-validation-"));
    try {
      const fixturePath = join(directory, "fixture.json");
      const bytes = replayFixtureBytes();
      await writeFile(fixturePath, bytes, "utf8");
      const document = await api.validateWhereLatencyReplayFixture(fixturePath);
      expect(document).toEqual({
        schema: "where-latency-replay-validation-v1",
        version: 1,
        fixtureSchema: "where-latency-replay-v1",
        fixtureVersion: 1,
        fixtureFileSha256: createHash("sha256").update(bytes).digest("hex"),
        configProjectionSha256: createHash("sha256")
          .update(canonicalizeArtifactJson(JSON.parse(bytes).resolvedConfig))
          .digest("hex"),
        resolvedConfigHash: JSON.parse(bytes).resolvedConfigHash
      });

      const nonCanonicalPath = join(directory, "noncanonical.json");
      await writeFile(nonCanonicalPath, JSON.stringify(JSON.parse(bytes), null, 2), "utf8");
      await expect(api.validateWhereLatencyReplayFixture(nonCanonicalPath))
        .rejects.toThrow("where_latency_replay_json_not_canonical");

      const forbidden = JSON.parse(bytes);
      forbidden.requestHeaders = { authorization: "secret" };
      const forbiddenPath = join(directory, "forbidden.json");
      await writeFile(forbiddenPath, canonicalizeArtifactJson(forbidden), "utf8");
      await expect(api.validateWhereLatencyReplayFixture(forbiddenPath))
        .rejects.toThrow("where_latency_replay_forbidden_field");

      const unsafe = JSON.parse(bytes);
      unsafe.resolvedConfig.tronscanBaseUrl = "https://example.com/path?token=secret";
      unsafe.resolvedConfigHash = fingerprintCanonicalArtifact({
        config: unsafe.resolvedConfig,
        options: unsafe.resolvedOptions
      });
      const unsafePath = join(directory, "unsafe.json");
      await writeFile(unsafePath, canonicalizeArtifactJson(unsafe), "utf8");
      await expect(api.validateWhereLatencyReplayFixture(unsafePath))
        .rejects.toThrow("where_latency_replay_config_invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
