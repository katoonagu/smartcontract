import { afterEach, describe, expect, it } from "vitest";
import { addressPoisoningSmallTransferMaxRaw, loadConfig } from "../../src/config";

const originalEnv = process.env;

function setRequiredEnv(overrides: NodeJS.ProcessEnv = {}): void {
  process.env = {
    BOT_TOKEN: "token",
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/tron_guard",
    ...overrides
  };
}

afterEach(() => {
  process.env = originalEnv;
});

describe("loadConfig", () => {
  it("requires bot token and database url", () => {
    process.env = {};

    expect(() => loadConfig()).toThrow("Missing required environment variable: BOT_TOKEN");

    process.env = { BOT_TOKEN: "token" };

    expect(() => loadConfig()).toThrow("Missing required environment variable: DATABASE_URL");
  });

  it("rejects non-https TronScan base urls", () => {
    setRequiredEnv({ TRONSCAN_BASE_URL: "http://apilist.tronscanapi.com" });

    expect(() => loadConfig()).toThrow("TRONSCAN_BASE_URL must use https");
  });

  it("rejects non-https TRON full node urls", () => {
    setRequiredEnv({ TRON_FULLNODE_BASE_URL: "http://api.trongrid.io" });

    expect(() => loadConfig()).toThrow("TRON_FULLNODE_BASE_URL must use https");
  });

  it("loads defaults for TronScan polling reliability settings", () => {
    setRequiredEnv();

    const config = loadConfig();

    expect(config.tronscanPageLimit).toBe(50);
    expect(config.tronscanMaxInFlight).toBe(20);
    expect(config.tronscanGroupMaxInFlight).toBe(2);
    expect(config.tronFullNodeBaseUrl.href).toBe("https://api.trongrid.io/");
    expect(config.tronscanApiKey).toBeUndefined();
    expect(config.tronscanApiKeys).toEqual([]);
    expect(config.tronscanApiKeyGroups).toEqual([]);
    expect(config.tronFullNodeApiKey).toBeUndefined();
    expect(config.tronscanMaxPagesPerWallet).toBe(5);
    expect(config.tronscanTimeoutMs).toBe(10000);
    expect(config.tronscanRetryAttempts).toBe(3);
    expect(config.tronscanRetryBaseDelayMs).toBe(500);
    expect(config.tronscanBackfillLookbackMs).toBe(86400000);
    expect(config.tronscanDashboardCacheTtlMs).toBe(300000);
    expect(config.tronscanDashboardMaxPages).toBe(5);
    expect(config.tronscanRequestMinIntervalMs).toBe(220);
    expect(config.tronscanGlobalRequestMinIntervalMs).toBe(280);
    expect(config.tronscanTransferRequestMinIntervalMs).toBe(350);
    expect(config.tronscanApprovalRequestMinIntervalMs).toBe(300);
    expect(config.tronscanContractRequestMinIntervalMs).toBe(300);
    expect(config.tronscanFullNodeRequestMinIntervalMs).toBe(300);
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(400);
    expect(config.tronGridRequestMinIntervalMs).toBe(250);
    expect(config.tronscanRateLimitCooldownMs).toBe(30000);
    expect(config.unifiedProviderConcurrencyLimit).toBe(100);
    expect(config.unifiedProviderIncreaseStep).toBe(1);
    expect(config.unifiedProviderIncreaseIntervalMs).toBe(1000);
    expect(config.unifiedProviderWorkerLimit).toBe(100);
    expect(config.unifiedAnalysisConcurrencyLimit).toBe(2);
    expect(config.unifiedFinalizationConcurrencyLimit).toBe(2);
    expect(config.unifiedLookaheadFactor).toBe(2);
    expect(config.unifiedPerRunLookaheadMaximum).toBe(100);
    expect(config.unifiedReadyBufferMaxEntries).toBe(100);
    expect(config.unifiedReadyBufferMaxBytes).toBe(67_108_864);
    expect(config.unifiedReservedBufferMaxBytes).toBe(67_108_864);
    expect(config.unifiedManifestHardLimitBytes).toBe(16_777_216);
    expect(config.unifiedChunkMaxPages).toBe(2);
    expect(config.unifiedChunkMaxWallMs).toBe(30_000);
    expect(config.unifiedChunkMaxResponseBytes).toBe(8_388_608);
    expect(config.unifiedChunkMaxCheckpointBytes).toBe(1_048_576);
    expect(config.unifiedRepairShare).toBe(0.1);
    expect(config.unifiedRepairMaxSlots).toBe(4);
    expect(config.unifiedRepairMaxWaitChunks).toBe(8);
    expect(config.unifiedReconciliationIntervalMs).toBe(30_000);
    expect(config.unifiedRollingRolloutStage).toBe("global_barrier");
    expect(config.unifiedTraversalPolicyVersion).toBe("snapshot-closure-v1");
    expect(config.unifiedRollingUserCheckBasisPoints).toBe(0);
    expect(config.unifiedProviderCapacityCeiling).toBe(1);
    expect(config.unifiedIsolatedWorkerOnly).toBe(false);
    expect(config.tronscanDashboardForceRefreshCooldownMs).toBe(60000);
    expect(config.forensicWherePollIntervalMs).toBe(2000);
    expect(config.forensicWhereWorkerConcurrency).toBe(1);
    expect(config.forensicWhereJobsPerPoll).toBe(3);
    expect(config.forensicIncomingPollIntervalMs).toBe(2000);
    expect(config.forensicIncomingJobsPerPoll).toBe(3);
    expect(config.forensicDeepPollIntervalMs).toBe(60000);
    expect(config.forensicJobStaleAfterMs).toBe(30 * 60 * 1000);
    expect(config.forensicJobMaxRetries).toBe(2);
    expect(config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob).toBe(0);
    expect(config.adminSecondLayerMaxActiveWallets).toBe(25);
    expect(config.tronAddressIndexClaimLimit).toBe(3);
    expect(config.tronAddressIndexLockMs).toBe(10 * 60 * 1000);
    expect(config.tronAddressIndexPollIntervalMs).toBe(15_000);
    expect(config.tronAddressIndexPageBatchSize).toBe(2);
    expect(config.directHardEvidenceLiveLimit).toBe(250);
    expect(config.directHardEvidenceConcurrency).toBe(8);
    expect(config.llmContractAnalysisEnabled).toBe(false);
    expect(config.llmApiKey).toBeUndefined();
    expect(config.llmBaseUrl.href).toBe("https://api.deepseek.com/");
    expect(config.llmModel).toBe("deepseek-v4-pro");
    expect(config.llmThinkingEnabled).toBe(true);
    expect(config.llmReasoningEffort).toBe("max");
    expect(config.llmProviderLabel).toBe("deepseek");
    expect(config.llmModelCacheKey).toBe("provider=deepseek|model=deepseek-v4-pro|thinking=enabled|reasoning=max");
    expect(config.llmTimeoutMs).toBe(60000);
    expect(config.llmMaxRetries).toBe(2);
    expect(config.llmCacheTtlMs).toBe(2592000000);
    expect(config.llmEnrichmentMaxAttempts).toBe(4);
    expect(config.llmEnrichmentRetryDelayMs).toBe(15000);
    expect(config.pollStartDelayMs).toBe(5000);
    expect(config.incomingDepositRealtimeMaxAgeMs).toBe(900000);
    expect(config.addressPoisoningSmallTransferMaxUsdt).toBe("100");
    expect(config.forensicWhereStartDelayMs).toBe(3000);
    expect(config.forensicIncomingStartDelayMs).toBe(6000);
    expect(config.forensicDeepStartDelayMs).toBe(12000);
    expect(config.adminDashboardEnabled).toBe(false);
    expect(config.adminDashboardHost).toBe("127.0.0.1");
    expect(config.adminDashboardPort).toBe(8787);
    expect(config.adminDashboardToken).toBe(null);
    expect(config.runtimeInstanceLabel).toBeUndefined();
  });

  it.each(["0", "3", "1.5"])("rejects invalid Where worker concurrency %s", (value) => {
    setRequiredEnv({ FORENSIC_WHERE_WORKER_CONCURRENCY: value });
    expect(() => loadConfig()).toThrow(
      "FORENSIC_WHERE_WORKER_CONCURRENCY must be a safe integer between 1 and 2"
    );
  });

  it.each(["0", "100", "100.000001", "9007199254740993000000.123456", "9".repeat(78)])(
    "keeps valid address poisoning threshold %s as an exact decimal string",
    (value) => {
      setRequiredEnv({ ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT: value });

      expect(loadConfig().addressPoisoningSmallTransferMaxUsdt).toBe(value);
    }
  );

  it.each(["-1", "abc", "1.0000001", "1.", "9".repeat(79)])(
    "rejects invalid address poisoning threshold %s",
    (value) => {
      setRequiredEnv({ ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT: value });

      expect(() => loadConfig()).toThrow(
        "ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT must be a non-negative decimal with at most 78 integer digits and 6 fractional digits"
      );
    }
  );

  it.each([
    { input: "0.0", expected: "0" },
    { input: "0.000000", expected: "0" },
    { input: "000000", expected: "0" },
    { input: "000100", expected: "100" },
    { input: "000100.000001", expected: "100.000001" }
  ])("canonicalizes address poisoning threshold $input to $expected", ({ input, expected }) => {
    setRequiredEnv({ ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT: input });

    expect(loadConfig().addressPoisoningSmallTransferMaxUsdt).toBe(expected);
  });

  it("converts canonical zero and large thresholds to raw USDT without floating point", () => {
    setRequiredEnv({ ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT: "0.000000" });
    expect(addressPoisoningSmallTransferMaxRaw(loadConfig().addressPoisoningSmallTransferMaxUsdt)).toBe("0");

    const large = "9007199254740993000000.123456";
    setRequiredEnv({ ADDRESS_POISONING_SMALL_TRANSFER_MAX_USDT: large });
    expect(addressPoisoningSmallTransferMaxRaw(loadConfig().addressPoisoningSmallTransferMaxUsdt))
      .toBe("9007199254740993000000123456");
  });

  it("parses admin dashboard config", () => {
    setRequiredEnv({
      ADMIN_DASHBOARD_ENABLED: "true",
      ADMIN_DASHBOARD_HOST: "0.0.0.0",
      ADMIN_DASHBOARD_PORT: "9090",
      ADMIN_DASHBOARD_TOKEN: "secret-token"
    });
    const config = loadConfig();

    expect(config.adminDashboardEnabled).toBe(true);
    expect(config.adminDashboardHost).toBe("0.0.0.0");
    expect(config.adminDashboardPort).toBe(9090);
    expect(config.adminDashboardToken).toBe("secret-token");
  });

  it("rejects admin dashboard ports outside the TCP range", () => {
    setRequiredEnv({ ADMIN_DASHBOARD_PORT: "65536" });

    expect(() => loadConfig()).toThrow("ADMIN_DASHBOARD_PORT must be a safe integer between 1 and 65535");
  });

  it("parses comma-separated TronScan API keys while keeping the first key for compatibility", () => {
    setRequiredEnv({ TRONSCAN_API_KEY: " key-a, key-b,,key-a, key-c " });

    const config = loadConfig();

    expect(config.tronscanApiKeys).toEqual(["key-a", "key-b", "key-c"]);
    expect(config.tronscanApiKey).toBe("key-a");
  });

  it("uses configured TronScan API keys as the default account group when no groups are configured", () => {
    setRequiredEnv({ TRONSCAN_API_KEY: "key-a,key-b" });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "default", apiKeys: ["key-a", "key-b"] }
    ]);
  });

  it("parses TronScan API key account groups", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a,key-b,key-c",
      TRONSCAN_API_KEY_GROUPS: " main:key-a,key-b ; backup:key-c "
    });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "main", apiKeys: ["key-a", "key-b"] },
      { groupId: "backup", apiKeys: ["key-c"] }
    ]);
  });

  it("rejects TronScan API key groups with an empty group id", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a",
      TRONSCAN_API_KEY_GROUPS: ":key-a"
    });

    expect(() => loadConfig()).toThrow("TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons");
  });

  it("rejects TronScan API key groups without keys", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a",
      TRONSCAN_API_KEY_GROUPS: "main: , "
    });

    expect(() => loadConfig()).toThrow("TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons");
  });

  it("rejects malformed TronScan API key group entries without exposing the entry", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: "bare-secret-key" });

    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons");
    expect((thrown as Error).message).not.toContain("bare-secret-key");
  });

  it("rejects duplicate TronScan API key group ids", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a,key-b",
      TRONSCAN_API_KEY_GROUPS: "main:key-a; main:key-b"
    });

    expect(() => loadConfig()).toThrow('TRONSCAN_API_KEY_GROUPS contains duplicate group id "main"');
  });

  it("rejects TronScan API key groups that reference unknown keys", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a",
      TRONSCAN_API_KEY_GROUPS: "main:key-a,key-b"
    });

    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("TRONSCAN_API_KEY_GROUPS contains a key not present in TRONSCAN_API_KEY");
    expect((thrown as Error).message).not.toContain("key-b");
  });

  it("rejects TronScan API key groups when no configured keys exist without exposing the grouped key", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: "main:secret" });

    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("TRONSCAN_API_KEY_GROUPS contains a key not present in TRONSCAN_API_KEY");
    expect((thrown as Error).message).not.toContain("secret");
  });

  it("deduplicates duplicate TronScan API keys within the same account group", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a,key-b",
      TRONSCAN_API_KEY_GROUPS: "main:key-a,key-a,key-b"
    });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "main", apiKeys: ["key-a", "key-b"] }
    ]);
  });

  it("adds unassigned configured TronScan API keys to a default account group", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a,key-b,key-c",
      TRONSCAN_API_KEY_GROUPS: "main:key-a;backup:key-c"
    });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "main", apiKeys: ["key-a"] },
      { groupId: "backup", apiKeys: ["key-c"] },
      { groupId: "default", apiKeys: ["key-b"] }
    ]);
  });

  it("rejects duplicate TronScan API keys across account groups", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a",
      TRONSCAN_API_KEY_GROUPS: "main:key-a; backup:key-a"
    });

    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("TRONSCAN_API_KEY_GROUPS assigns one API key to multiple groups");
    expect((thrown as Error).message).not.toContain("key-a");
  });

  it("ignores trailing empty TronScan API key group segments", () => {
    setRequiredEnv({
      TRONSCAN_API_KEY: "key-a",
      TRONSCAN_API_KEY_GROUPS: "main:key-a;"
    });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "main", apiKeys: ["key-a"] }
    ]);
  });

  it("accepts explicit safe integer TronScan polling settings", () => {
    setRequiredEnv({
      TRONSCAN_PAGE_LIMIT: "25",
      TRONSCAN_MAX_PAGES_PER_WALLET: "3",
      TRONSCAN_TIMEOUT_MS: "2500",
      TRONSCAN_RETRY_ATTEMPTS: "2",
      TRONSCAN_RETRY_BASE_DELAY_MS: "250",
      TRONSCAN_BACKFILL_LOOKBACK_MS: "3600000",
      TRONSCAN_DASHBOARD_CACHE_TTL_MS: "120000",
      TRONSCAN_DASHBOARD_MAX_PAGES: "2",
      TRONSCAN_REQUEST_MIN_INTERVAL_MS: "100",
      TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS: "400",
      TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS: "500",
      TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS: "450",
      TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS: "425",
      TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS: "475",
      TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS: "375",
      TRONSCAN_MAX_IN_FLIGHT: "11",
      TRONSCAN_GROUP_MAX_IN_FLIGHT: "4",
      TRONGRID_REQUEST_MIN_INTERVAL_MS: "350",
      TRONSCAN_RATE_LIMIT_COOLDOWN_MS: "5000",
      TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS: "15000",
      FORENSIC_WHERE_POLL_INTERVAL_MS: "3000",
      FORENSIC_WHERE_WORKER_CONCURRENCY: "2",
      FORENSIC_WHERE_JOBS_PER_POLL: "5",
      FORENSIC_INCOMING_POLL_INTERVAL_MS: "7000",
      FORENSIC_INCOMING_JOBS_PER_POLL: "9",
      FORENSIC_DEEP_POLL_INTERVAL_MS: "45000",
      FORENSIC_JOB_STALE_AFTER_MS: "600000",
      FORENSIC_JOB_MAX_RETRIES: "1",
      TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB: "15",
      ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS: "35",
      TRON_ADDRESS_INDEX_CLAIM_LIMIT: "5",
      TRON_ADDRESS_INDEX_LOCK_MS: "300000",
      TRON_ADDRESS_INDEX_POLL_INTERVAL_MS: "20000",
      TRON_ADDRESS_INDEX_PAGE_BATCH_SIZE: "4",
      DIRECT_HARD_EVIDENCE_LIVE_LIMIT: "500",
      DIRECT_HARD_EVIDENCE_CONCURRENCY: "6",
      LLM_CONTRACT_ANALYSIS_ENABLED: "true",
      LLM_API_KEY: "llm-key",
      LLM_BASE_URL: "https://llm.example.com/v1",
      LLM_MODEL: "contract-model",
      LLM_THINKING_ENABLED: "false",
      LLM_REASONING_EFFORT: "high",
      LLM_PROVIDER_LABEL: "custom",
      LLM_TIMEOUT_MS: "5000",
      LLM_MAX_RETRIES: "4",
      LLM_CACHE_TTL_MS: "60000",
      LLM_ENRICHMENT_MAX_ATTEMPTS: "5",
      LLM_ENRICHMENT_RETRY_DELAY_MS: "250",
      POLL_START_DELAY_MS: "1000",
      INCOMING_DEPOSIT_REALTIME_MAX_AGE_MS: "1800000",
      FORENSIC_WHERE_START_DELAY_MS: "2000",
      FORENSIC_INCOMING_START_DELAY_MS: "3000",
      FORENSIC_DEEP_START_DELAY_MS: "4000"
    });

    const config = loadConfig();

    expect(config.tronscanPageLimit).toBe(25);
    expect(config.tronscanMaxPagesPerWallet).toBe(3);
    expect(config.tronscanTimeoutMs).toBe(2500);
    expect(config.tronscanRetryAttempts).toBe(2);
    expect(config.tronscanRetryBaseDelayMs).toBe(250);
    expect(config.tronscanBackfillLookbackMs).toBe(3600000);
    expect(config.tronscanDashboardCacheTtlMs).toBe(120000);
    expect(config.tronscanDashboardMaxPages).toBe(2);
    expect(config.tronscanRequestMinIntervalMs).toBe(100);
    expect(config.tronscanGlobalRequestMinIntervalMs).toBe(400);
    expect(config.tronscanTransferRequestMinIntervalMs).toBe(500);
    expect(config.tronscanApprovalRequestMinIntervalMs).toBe(450);
    expect(config.tronscanContractRequestMinIntervalMs).toBe(425);
    expect(config.tronscanFullNodeRequestMinIntervalMs).toBe(475);
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(375);
    expect(config.tronscanMaxInFlight).toBe(11);
    expect(config.tronscanGroupMaxInFlight).toBe(4);
    expect(config.tronGridRequestMinIntervalMs).toBe(350);
    expect(config.tronscanRateLimitCooldownMs).toBe(5000);
    expect(config.tronscanDashboardForceRefreshCooldownMs).toBe(15000);
    expect(config.forensicWherePollIntervalMs).toBe(3000);
    expect(config.forensicWhereWorkerConcurrency).toBe(2);
    expect(config.forensicWhereJobsPerPoll).toBe(5);
    expect(config.forensicIncomingPollIntervalMs).toBe(7000);
    expect(config.forensicIncomingJobsPerPoll).toBe(9);
    expect(config.forensicDeepPollIntervalMs).toBe(45000);
    expect(config.forensicJobStaleAfterMs).toBe(600000);
    expect(config.forensicJobMaxRetries).toBe(1);
    expect(config.tronAddressIndexSecondLayerMaxActiveWalletsPerJob).toBe(15);
    expect(config.adminSecondLayerMaxActiveWallets).toBe(35);
    expect(config.tronAddressIndexClaimLimit).toBe(5);
    expect(config.tronAddressIndexLockMs).toBe(300000);
    expect(config.tronAddressIndexPollIntervalMs).toBe(20000);
    expect(config.tronAddressIndexPageBatchSize).toBe(4);
    expect(config.directHardEvidenceLiveLimit).toBe(500);
    expect(config.directHardEvidenceConcurrency).toBe(6);
    expect(config.llmContractAnalysisEnabled).toBe(true);
    expect(config.llmApiKey).toBe("llm-key");
    expect(config.llmBaseUrl.href).toBe("https://llm.example.com/v1/");
    expect(config.llmModel).toBe("contract-model");
    expect(config.llmThinkingEnabled).toBe(false);
    expect(config.llmReasoningEffort).toBe("high");
    expect(config.llmProviderLabel).toBe("custom");
    expect(config.llmModelCacheKey).toBe("provider=custom|model=contract-model");
    expect(config.llmTimeoutMs).toBe(5000);
    expect(config.llmMaxRetries).toBe(4);
    expect(config.llmCacheTtlMs).toBe(60000);
    expect(config.llmEnrichmentMaxAttempts).toBe(5);
    expect(config.llmEnrichmentRetryDelayMs).toBe(250);
    expect(config.pollStartDelayMs).toBe(1000);
    expect(config.incomingDepositRealtimeMaxAgeMs).toBe(1800000);
    expect(config.forensicWhereStartDelayMs).toBe(2000);
    expect(config.forensicIncomingStartDelayMs).toBe(3000);
    expect(config.forensicDeepStartDelayMs).toBe(4000);
  });

  it("does not enable DeepSeek thinking request options by default for custom LLM providers", () => {
    setRequiredEnv({
      LLM_PROVIDER_LABEL: "custom",
      LLM_MODEL: "contract-model"
    });

    const config = loadConfig();

    expect(config.llmThinkingEnabled).toBe(false);
    expect(config.llmReasoningEffort).toBeUndefined();
    expect(config.llmModelCacheKey).toBe("provider=custom|model=contract-model");
  });

  it("keeps LLM contract analysis disabled when the feature flag is true but no key is configured", () => {
    setRequiredEnv({ LLM_CONTRACT_ANALYSIS_ENABLED: "true", LLM_API_KEY: "  " });

    const config = loadConfig();

    expect(config.llmApiKey).toBeUndefined();
    expect(config.llmContractAnalysisEnabled).toBe(false);
  });

  it("loads optional cross-chain Stage 2 config with disabled default", () => {
    setRequiredEnv();

    const config = loadConfig();

    expect(config.crossChainStage2Enabled).toBe(false);
    expect(config.crossChainStage2MaxProviderCalls).toBe(200);
    expect(config.crossChainStage2CacheTtlMs).toBe(86400000);
    expect(config.rangeApiKey).toBeUndefined();
    expect(config.rangeBaseUrl.href).toBe("https://api.range.org/");
    expect(config.rangeTimeoutMs).toBe(20000);
    expect(config.rangeMaxCallsPerCheck).toBe(20);
    expect(config.evmExplorerApiKey).toBeUndefined();
    expect(config.evmExplorerBaseUrl.href).toBe("https://api.etherscan.io/v2/api");
    expect(config.evmExplorerTimeoutMs).toBe(20000);
    expect(config.evmExplorerMaxCallsPerCheck).toBe(40);
    expect(config.alchemyApiKey).toBeUndefined();
    expect(config.alchemyTimeoutMs).toBe(20000);
  });

  it("loads cross-chain provider keys and budgets", () => {
    setRequiredEnv({
      CROSS_CHAIN_STAGE2_ENABLED: "true",
      CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS: "30",
      CROSS_CHAIN_STAGE2_CACHE_TTL_MS: "3600000",
      RANGE_API_KEY: " range-key ",
      RANGE_BASE_URL: "https://range.example.com/v1",
      RANGE_TIMEOUT_MS: "5000",
      RANGE_MAX_CALLS_PER_CHECK: "7",
      EVM_EXPLORER_API_KEY: " evm-key ",
      EVM_EXPLORER_BASE_URL: "https://etherscan.example.com/api",
      EVM_EXPLORER_TIMEOUT_MS: "6000",
      EVM_EXPLORER_MAX_CALLS_PER_CHECK: "9",
      ALCHEMY_API_KEY: " alchemy-key ",
      ALCHEMY_TIMEOUT_MS: "7000"
    });

    const config = loadConfig();

    expect(config.crossChainStage2Enabled).toBe(true);
    expect(config.crossChainStage2MaxProviderCalls).toBe(30);
    expect(config.crossChainStage2CacheTtlMs).toBe(3600000);
    expect(config.rangeApiKey).toBe("range-key");
    expect(config.rangeBaseUrl.href).toBe("https://range.example.com/v1");
    expect(config.rangeTimeoutMs).toBe(5000);
    expect(config.rangeMaxCallsPerCheck).toBe(7);
    expect(config.evmExplorerApiKey).toBe("evm-key");
    expect(config.evmExplorerBaseUrl.href).toBe("https://etherscan.example.com/api");
    expect(config.evmExplorerTimeoutMs).toBe(6000);
    expect(config.evmExplorerMaxCallsPerCheck).toBe(9);
    expect(config.alchemyApiKey).toBe("alchemy-key");
    expect(config.alchemyTimeoutMs).toBe(7000);
  });

  it("accepts ETHERSCAN_API_KEY as an EVM explorer key alias", () => {
    setRequiredEnv({
      ETHERSCAN_API_KEY: " etherscan-key "
    });

    const config = loadConfig();

    expect(config.evmExplorerApiKey).toBe("etherscan-key");
  });

  it("rejects non-https cross-chain provider base urls", () => {
    setRequiredEnv({ RANGE_BASE_URL: "http://api.range.org" });

    expect(() => loadConfig()).toThrow("RANGE_BASE_URL must use https");

    setRequiredEnv({ EVM_EXPLORER_BASE_URL: "http://api.etherscan.io" });

    expect(() => loadConfig()).toThrow("EVM_EXPLORER_BASE_URL must use https");
  });

  it("rejects invalid cross-chain Stage 2 boolean values", () => {
    setRequiredEnv({ CROSS_CHAIN_STAGE2_ENABLED: "sometimes" });

    expect(() => loadConfig()).toThrow("CROSS_CHAIN_STAGE2_ENABLED must be true or false");
  });

  it("rejects non-positive cross-chain provider budgets and timeouts", () => {
    setRequiredEnv({ CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS: "0" });

    expect(() => loadConfig()).toThrow("CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS must be a safe integer greater than or equal to 1");

    setRequiredEnv({ CROSS_CHAIN_STAGE2_CACHE_TTL_MS: "0" });

    expect(() => loadConfig()).toThrow("CROSS_CHAIN_STAGE2_CACHE_TTL_MS must be a safe integer greater than or equal to 1");

    setRequiredEnv({ RANGE_TIMEOUT_MS: "0" });

    expect(() => loadConfig()).toThrow("RANGE_TIMEOUT_MS must be a safe integer greater than or equal to 1");

    setRequiredEnv({ RANGE_MAX_CALLS_PER_CHECK: "0" });

    expect(() => loadConfig()).toThrow("RANGE_MAX_CALLS_PER_CHECK must be a safe integer greater than or equal to 1");

    setRequiredEnv({ EVM_EXPLORER_TIMEOUT_MS: "0" });

    expect(() => loadConfig()).toThrow("EVM_EXPLORER_TIMEOUT_MS must be a safe integer greater than or equal to 1");

    setRequiredEnv({ EVM_EXPLORER_MAX_CALLS_PER_CHECK: "0" });

    expect(() => loadConfig()).toThrow("EVM_EXPLORER_MAX_CALLS_PER_CHECK must be a safe integer greater than or equal to 1");

    setRequiredEnv({ ALCHEMY_TIMEOUT_MS: "0" });

    expect(() => loadConfig()).toThrow("ALCHEMY_TIMEOUT_MS must be a safe integer greater than or equal to 1");
  });

  it("rejects unsupported LLM reasoning effort values", () => {
    setRequiredEnv({ LLM_REASONING_EFFORT: "largest" });

    expect(() => loadConfig()).toThrow("LLM_REASONING_EFFORT must be low, medium, high, or max");
  });

  it("loads an optional runtime instance label", () => {
    setRequiredEnv({
      RUNTIME_GIT_SHA: `  ${"a".repeat(40)}  `,
      RUNTIME_INSTANCE_LABEL: "Hermes test"
    });

    expect(loadConfig().runtimeGitSha).toBe("a".repeat(40));
    expect(loadConfig().runtimeInstanceLabel).toBe("Hermes test");
  });

  it("defaults the Unified service role shadow policy to disabled", () => {
    setRequiredEnv();

    expect(loadConfig().unifiedServiceRoleShadowPolicy).toBe("disabled");
  });

  it.each([
    "disabled",
    "service-role-shadow-100-plus-100-v1"
  ])("accepts Unified service role shadow policy %s", (value) => {
    setRequiredEnv({ UNIFIED_SERVICE_ROLE_SHADOW_POLICY: value });

    expect(loadConfig().unifiedServiceRoleShadowPolicy).toBe(value);
  });

  it.each([
    "",
    "true",
    "false",
    "1",
    "service-role-shadow-500-plus-100-v1"
  ])("rejects invalid Unified service role shadow policy %j", (value) => {
    setRequiredEnv({ UNIFIED_SERVICE_ROLE_SHADOW_POLICY: value });

    expect(() => loadConfig()).toThrow("UNIFIED_SERVICE_ROLE_SHADOW_POLICY");
  });

  it("parses adaptive Unified controller settings", () => {
    setRequiredEnv({
      UNIFIED_PROVIDER_CONCURRENCY_LIMIT: "32",
      UNIFIED_PROVIDER_INCREASE_STEP: "4",
      UNIFIED_PROVIDER_INCREASE_INTERVAL_MS: "2500",
      UNIFIED_PROVIDER_WORKER_LIMIT: "24",
      UNIFIED_ANALYSIS_CONCURRENCY_LIMIT: "3",
      UNIFIED_FINALIZATION_CONCURRENCY_LIMIT: "1",
      UNIFIED_LOOKAHEAD_FACTOR: "3",
      UNIFIED_PER_RUN_LOOKAHEAD_MAXIMUM: "40",
      UNIFIED_READY_BUFFER_MAX_ENTRIES: "20",
      UNIFIED_READY_BUFFER_MAX_BYTES: "2000000",
      UNIFIED_RESERVED_BUFFER_MAX_BYTES: "3000000",
      UNIFIED_MANIFEST_HARD_LIMIT_BYTES: "1000000",
      UNIFIED_CHUNK_MAX_PAGES: "4",
      UNIFIED_CHUNK_MAX_WALL_MS: "5000",
      UNIFIED_CHUNK_MAX_RESPONSE_BYTES: "600000",
      UNIFIED_CHUNK_MAX_CHECKPOINT_BYTES: "700000",
      UNIFIED_REPAIR_SHARE: "0.25",
      UNIFIED_REPAIR_MAX_SLOTS: "5",
      UNIFIED_REPAIR_MAX_WAIT_CHUNKS: "6",
      UNIFIED_RECONCILIATION_INTERVAL_MS: "45000",
      UNIFIED_ROLLING_ROLLOUT_STAGE: "bounded_user_check",
      UNIFIED_TRAVERSAL_POLICY_VERSION: "snapshot-closure-v2",
      UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS: "2500",
      UNIFIED_PROVIDER_CAPACITY_CEILING: "4",
      UNIFIED_ISOLATED_WORKER_ONLY: "true"
    });

    expect(loadConfig()).toMatchObject({
      unifiedProviderConcurrencyLimit: 32,
      unifiedProviderIncreaseStep: 4,
      unifiedProviderIncreaseIntervalMs: 2500,
      unifiedProviderWorkerLimit: 24,
      unifiedAnalysisConcurrencyLimit: 3,
      unifiedFinalizationConcurrencyLimit: 1,
      unifiedLookaheadFactor: 3,
      unifiedPerRunLookaheadMaximum: 40,
      unifiedReadyBufferMaxEntries: 20,
      unifiedReadyBufferMaxBytes: 2_000_000,
      unifiedReservedBufferMaxBytes: 3_000_000,
      unifiedManifestHardLimitBytes: 1_000_000,
      unifiedChunkMaxPages: 4,
      unifiedChunkMaxWallMs: 5_000,
      unifiedChunkMaxResponseBytes: 600_000,
      unifiedChunkMaxCheckpointBytes: 700_000,
      unifiedRepairShare: 0.25,
      unifiedRepairMaxSlots: 5,
      unifiedRepairMaxWaitChunks: 6,
      unifiedReconciliationIntervalMs: 45_000,
      unifiedRollingRolloutStage: "bounded_user_check",
      unifiedTraversalPolicyVersion: "snapshot-closure-v2",
      unifiedRollingUserCheckBasisPoints: 2_500,
      unifiedProviderCapacityCeiling: 4,
      unifiedIsolatedWorkerOnly: true
    });
  });

  it.each([
    ["UNIFIED_PROVIDER_CONCURRENCY_LIMIT", "0"],
    ["UNIFIED_LOOKAHEAD_FACTOR", "1.5"],
    ["UNIFIED_REPAIR_SHARE", ""],
    ["UNIFIED_REPAIR_SHARE", "-0.1"],
    ["UNIFIED_REPAIR_SHARE", "1.1"],
    ["UNIFIED_ROLLING_ROLLOUT_STAGE", "all"],
    ["UNIFIED_TRAVERSAL_POLICY_VERSION", "snapshot-closure-v3"],
    ["UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS", "10001"],
    ["UNIFIED_PROVIDER_CAPACITY_CEILING", "101"]
  ])("rejects invalid adaptive Unified setting %s=%s", (name, value) => {
    setRequiredEnv({ [name]: value });

    expect(() => loadConfig()).toThrow(name);
  });

  it("keeps runtime identity optional until verified candidate startup", () => {
    setRequiredEnv({ RUNTIME_GIT_SHA: "  ", RUNTIME_INSTANCE_LABEL: "  " });

    expect(loadConfig().runtimeGitSha).toBeUndefined();
    expect(loadConfig().runtimeInstanceLabel).toBeUndefined();
  });

  it("rejects page limits outside the TronScan-safe range", () => {
    setRequiredEnv({ TRONSCAN_PAGE_LIMIT: "100" });

    expect(() => loadConfig()).toThrow("TRONSCAN_PAGE_LIMIT must be a safe integer between 1 and 50");
  });

  it("rejects active wallet and direct hard evidence limits outside their safe ranges", () => {
    setRequiredEnv({ TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB: "1001" });

    expect(() => loadConfig()).toThrow(
      "TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB must be a safe integer between 0 and 1000"
    );

    setRequiredEnv({ ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS: "1001" });

    expect(() => loadConfig()).toThrow("ADMIN_SECOND_LAYER_MAX_ACTIVE_WALLETS must be a safe integer between 0 and 1000");

    setRequiredEnv({ DIRECT_HARD_EVIDENCE_LIVE_LIMIT: "100001" });

    expect(() => loadConfig()).toThrow("DIRECT_HARD_EVIDENCE_LIVE_LIMIT must be a safe integer between 0 and 100000");
  });

  it("rejects non-positive retry and timeout settings", () => {
    setRequiredEnv({ TRONSCAN_TIMEOUT_MS: "0" });

    expect(() => loadConfig()).toThrow("TRONSCAN_TIMEOUT_MS must be a safe integer greater than or equal to 1");
  });

  it("rejects polling intervals below one second", () => {
    setRequiredEnv({ POLL_INTERVAL_MS: "999" });

    expect(() => loadConfig()).toThrow("POLL_INTERVAL_MS must be a safe integer greater than or equal to 1000");
  });
});
