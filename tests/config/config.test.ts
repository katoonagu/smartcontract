import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

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

    expect(config.tronscanPageLimit).toBe(100);
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
    expect(config.tronscanAccountGroupRequestMinIntervalMs).toBe(250);
    expect(config.tronGridRequestMinIntervalMs).toBe(250);
    expect(config.tronscanRateLimitCooldownMs).toBe(30000);
    expect(config.tronscanDashboardForceRefreshCooldownMs).toBe(60000);
    expect(config.forensicWherePollIntervalMs).toBe(2000);
    expect(config.forensicWhereJobsPerPoll).toBe(3);
    expect(config.forensicDeepPollIntervalMs).toBe(60000);
    expect(config.forensicJobStaleAfterMs).toBe(30 * 60 * 1000);
    expect(config.forensicJobMaxRetries).toBe(2);
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
    expect(config.pollStartDelayMs).toBe(0);
    expect(config.forensicWhereStartDelayMs).toBe(3000);
    expect(config.forensicIncomingStartDelayMs).toBe(6000);
    expect(config.forensicDeepStartDelayMs).toBe(12000);
    expect(config.adminDashboardEnabled).toBe(false);
    expect(config.adminDashboardHost).toBe("127.0.0.1");
    expect(config.adminDashboardPort).toBe(8787);
    expect(config.adminDashboardToken).toBe(null);
    expect(config.runtimeInstanceLabel).toBeUndefined();
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

  it("parses TronScan API key account groups", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: " main:key-a,key-b ; backup:key-c " });

    const config = loadConfig();

    expect(config.tronscanApiKeyGroups).toEqual([
      { groupId: "main", apiKeys: ["key-a", "key-b"] },
      { groupId: "backup", apiKeys: ["key-c"] }
    ]);
  });

  it("rejects TronScan API key groups with an empty group id", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: ":key-a" });

    expect(() => loadConfig()).toThrow("TRONSCAN_API_KEY_GROUPS contains a group with an empty group id");
  });

  it("rejects TronScan API key groups without keys", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: "main: , " });

    expect(() => loadConfig()).toThrow('TRONSCAN_API_KEY_GROUPS group "main" must include at least one API key');
  });

  it("rejects duplicate TronScan API key group ids", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: "main:key-a; main:key-b" });

    expect(() => loadConfig()).toThrow('TRONSCAN_API_KEY_GROUPS contains duplicate group id "main"');
  });

  it("rejects duplicate TronScan API keys across account groups", () => {
    setRequiredEnv({ TRONSCAN_API_KEY_GROUPS: "main:key-a; backup:key-a" });

    expect(() => loadConfig()).toThrow('TRONSCAN_API_KEY_GROUPS contains duplicate API key "key-a" across groups');
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
      TRONGRID_REQUEST_MIN_INTERVAL_MS: "350",
      TRONSCAN_RATE_LIMIT_COOLDOWN_MS: "5000",
      TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS: "15000",
      FORENSIC_WHERE_POLL_INTERVAL_MS: "3000",
      FORENSIC_WHERE_JOBS_PER_POLL: "5",
      FORENSIC_DEEP_POLL_INTERVAL_MS: "45000",
      FORENSIC_JOB_STALE_AFTER_MS: "600000",
      FORENSIC_JOB_MAX_RETRIES: "1",
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
    expect(config.tronGridRequestMinIntervalMs).toBe(350);
    expect(config.tronscanRateLimitCooldownMs).toBe(5000);
    expect(config.tronscanDashboardForceRefreshCooldownMs).toBe(15000);
    expect(config.forensicWherePollIntervalMs).toBe(3000);
    expect(config.forensicWhereJobsPerPoll).toBe(5);
    expect(config.forensicDeepPollIntervalMs).toBe(45000);
    expect(config.forensicJobStaleAfterMs).toBe(600000);
    expect(config.forensicJobMaxRetries).toBe(1);
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
    setRequiredEnv({ RUNTIME_INSTANCE_LABEL: "Hermes test" });

    expect(loadConfig().runtimeInstanceLabel).toBe("Hermes test");
  });

  it("rejects page limits outside the TronScan-safe range", () => {
    setRequiredEnv({ TRONSCAN_PAGE_LIMIT: "101" });

    expect(() => loadConfig()).toThrow("TRONSCAN_PAGE_LIMIT must be a safe integer between 1 and 100");
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
