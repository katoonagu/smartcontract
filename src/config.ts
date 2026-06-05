import "dotenv/config";

export type CrossChainStage2Config = {
  crossChainStage2Enabled: boolean;
  crossChainStage2MaxProviderCalls: number;
  crossChainStage2CacheTtlMs: number;
  rangeApiKey: string | undefined;
  rangeBaseUrl: URL;
  rangeTimeoutMs: number;
  rangeMaxCallsPerCheck: number;
  evmExplorerApiKey: string | undefined;
  evmExplorerBaseUrl: URL;
  evmExplorerTimeoutMs: number;
  evmExplorerMaxCallsPerCheck: number;
  alchemyApiKey: string | undefined;
  alchemyTimeoutMs: number;
};

export type TronscanApiKeyGroupConfig = {
  groupId: string;
  apiKeys: string[];
};

export type AppConfig = {
  botToken: string;
  databaseUrl: string;
  tronscanBaseUrl: URL;
  tronFullNodeBaseUrl: URL;
  tronscanApiKey: string | undefined;
  tronscanApiKeys: string[];
  tronscanApiKeyGroups: TronscanApiKeyGroupConfig[];
  tronFullNodeApiKey: string | undefined;
  tronscanPageLimit: number;
  tronscanMaxPagesPerWallet: number;
  tronscanTimeoutMs: number;
  tronscanRetryAttempts: number;
  tronscanRetryBaseDelayMs: number;
  tronscanBackfillLookbackMs: number;
  tronscanRequestMinIntervalMs: number;
  tronscanGlobalRequestMinIntervalMs: number;
  tronscanTransferRequestMinIntervalMs: number;
  tronscanApprovalRequestMinIntervalMs: number;
  tronscanContractRequestMinIntervalMs: number;
  tronscanFullNodeRequestMinIntervalMs: number;
  tronscanAccountGroupRequestMinIntervalMs: number;
  tronGridRequestMinIntervalMs: number;
  tronscanRateLimitCooldownMs: number;
  tronscanDashboardCacheTtlMs: number;
  tronscanDashboardMaxPages: number;
  tronscanDashboardForceRefreshCooldownMs: number;
  forensicWherePollIntervalMs: number;
  forensicWhereJobsPerPoll: number;
  forensicDeepPollIntervalMs: number;
  forensicJobStaleAfterMs: number;
  forensicJobMaxRetries: number;
  llmContractAnalysisEnabled: boolean;
  llmApiKey: string | undefined;
  llmBaseUrl: URL;
  llmModel: string;
  llmThinkingEnabled: boolean;
  llmReasoningEffort: "low" | "medium" | "high" | "max" | undefined;
  llmModelCacheKey: string;
  llmProviderLabel: string;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  llmCacheTtlMs: number;
  llmEnrichmentMaxAttempts: number;
  llmEnrichmentRetryDelayMs: number;
  pollIntervalMs: number;
  pollStartDelayMs: number;
  forensicWhereStartDelayMs: number;
  forensicIncomingStartDelayMs: number;
  forensicDeepStartDelayMs: number;
  serviceAdminTelegramIds: Set<string>;
  runtimeInstanceLabel: string | undefined;
  theftReportDepositAddress: string | null;
  theftReportDepositAmountUsdt: "1000";
  theftReportGuideUrl: URL | undefined;
  theftReportAdminContact: string | undefined;
  adminDashboardEnabled: boolean;
  adminDashboardHost: string;
  adminDashboardPort: number;
  adminDashboardToken: string | null;
} & CrossChainStage2Config;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInteger(name: string, rawValue: string, minimum: number): number {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

function parseIntegerInRange(name: string, rawValue: string, minimum: number, maximum: number): number {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseHttpsUrl(name: string, rawValue: string): URL {
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${name} must use https`);
  }

  return url;
}

function parseOptionalHttpsUrl(name: string, rawValue: string | undefined): URL | undefined {
  const value = rawValue?.trim();
  return value ? parseHttpsUrl(name, value) : undefined;
}

function parseOptionalTronAddress(name: string, rawValue: string | undefined): string | null {
  const value = rawValue?.trim();
  if (!value) return null;
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) {
    throw new Error(`${name} must be a base58 TRON address`);
  }
  return value;
}

function withTrailingSlash(url: URL): URL {
  return url.href.endsWith("/") ? url : new URL(`${url.href}/`);
}

function parseCommaSeparatedValues(rawValue: string | undefined): string[] {
  return [...new Set((rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];
}

const TRONSCAN_API_KEY_GROUPS_SYNTAX_ERROR = "TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons";

function parseTronscanApiKeyGroups(rawValue: string | undefined, tronscanApiKeys: string[]): TronscanApiKeyGroupConfig[] {
  const value = rawValue?.trim();
  if (!value && tronscanApiKeys.length === 0) return [];
  if (!value) return [{ groupId: "default", apiKeys: tronscanApiKeys }];

  const groups: TronscanApiKeyGroupConfig[] = [];
  const groupIds = new Set<string>();
  const configuredKeys = new Set(tronscanApiKeys);
  const assignedKeys = new Set<string>();

  for (const rawGroup of value.split(";")) {
    if (rawGroup.trim().length === 0) continue;

    const separatorIndex = rawGroup.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === rawGroup.length - 1) {
      throw new Error(TRONSCAN_API_KEY_GROUPS_SYNTAX_ERROR);
    }
    const groupId = rawGroup.slice(0, separatorIndex).trim();

    if (!groupId) {
      throw new Error(TRONSCAN_API_KEY_GROUPS_SYNTAX_ERROR);
    }
    if (groupIds.has(groupId)) {
      throw new Error(`TRONSCAN_API_KEY_GROUPS contains duplicate group id "${groupId}"`);
    }
    groupIds.add(groupId);

    const rawKeys = rawGroup.slice(separatorIndex + 1);
    const apiKeys = [...new Set(rawKeys
      .split(",")
      .map((apiKey) => apiKey.trim())
      .filter((apiKey) => apiKey.length > 0))];

    if (apiKeys.length === 0) {
      throw new Error(TRONSCAN_API_KEY_GROUPS_SYNTAX_ERROR);
    }

    for (const apiKey of apiKeys) {
      if (!configuredKeys.has(apiKey)) {
        throw new Error("TRONSCAN_API_KEY_GROUPS contains a key not present in TRONSCAN_API_KEY");
      }
      if (assignedKeys.has(apiKey)) {
        throw new Error("TRONSCAN_API_KEY_GROUPS assigns one API key to multiple groups");
      }
      assignedKeys.add(apiKey);
    }

    groups.push({ groupId, apiKeys });
  }

  const unassignedApiKeys = tronscanApiKeys.filter((apiKey) => !assignedKeys.has(apiKey));
  if (unassignedApiKeys.length > 0) {
    const defaultGroup = groups.find((group) => group.groupId === "default");
    if (defaultGroup) {
      defaultGroup.apiKeys.push(...unassignedApiKeys);
    } else {
      groups.push({ groupId: "default", apiKeys: unassignedApiKeys });
    }
  }

  return groups;
}

function parseBooleanFlag(name: string, rawValue: string | undefined, defaultValue: boolean): boolean {
  const value = (rawValue ?? "").trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  throw new Error(`${name} must be true or false`);
}

function parseLlmReasoningEffort(rawValue: string | undefined): AppConfig["llmReasoningEffort"] {
  const value = rawValue?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "max") return value;
  throw new Error("LLM_REASONING_EFFORT must be low, medium, high, or max");
}

function isDeepseekProvider(providerLabel: string): boolean {
  return providerLabel.trim().toLowerCase() === "deepseek";
}

function buildLlmModelCacheKey(input: {
  providerLabel: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: AppConfig["llmReasoningEffort"];
}): string {
  const provider = input.providerLabel.trim().toLowerCase() || "unknown";
  const parts = [`provider=${provider}`, `model=${input.model}`];
  if (provider === "deepseek") {
    parts.push(`thinking=${input.thinkingEnabled ? "enabled" : "disabled"}`);
    parts.push(`reasoning=${input.thinkingEnabled ? input.reasoningEffort ?? "none" : "none"}`);
  }
  return parts.join("|");
}

export function loadConfig(): AppConfig {
  const rawAdminIds = process.env.SERVICE_ADMIN_TG_IDS ?? "";
  const adminIds = rawAdminIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const tronscanApiKeys = parseCommaSeparatedValues(process.env.TRONSCAN_API_KEY);
  const llmApiKey = process.env.LLM_API_KEY?.trim() || undefined;
  const llmFeatureEnabled = parseBooleanFlag("LLM_CONTRACT_ANALYSIS_ENABLED", process.env.LLM_CONTRACT_ANALYSIS_ENABLED, false);
  const llmProviderLabel = process.env.LLM_PROVIDER_LABEL?.trim() || "deepseek";
  const llmModel = process.env.LLM_MODEL?.trim() || "deepseek-v4-pro";
  const llmThinkingEnabled = parseBooleanFlag(
    "LLM_THINKING_ENABLED",
    process.env.LLM_THINKING_ENABLED,
    isDeepseekProvider(llmProviderLabel)
  );
  const llmReasoningEffort = parseLlmReasoningEffort(
    process.env.LLM_REASONING_EFFORT ?? (isDeepseekProvider(llmProviderLabel) ? "max" : undefined)
  );

  return {
    botToken: requireEnv("BOT_TOKEN"),
    databaseUrl: requireEnv("DATABASE_URL"),
    tronscanBaseUrl: parseHttpsUrl("TRONSCAN_BASE_URL", process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com"),
    tronFullNodeBaseUrl: parseHttpsUrl("TRON_FULLNODE_BASE_URL", process.env.TRON_FULLNODE_BASE_URL ?? "https://api.trongrid.io"),
    tronscanApiKey: tronscanApiKeys[0],
    tronscanApiKeys,
    tronscanApiKeyGroups: parseTronscanApiKeyGroups(process.env.TRONSCAN_API_KEY_GROUPS, tronscanApiKeys),
    tronFullNodeApiKey: process.env.TRON_FULLNODE_API_KEY?.trim() || undefined,
    tronscanPageLimit: parseIntegerInRange("TRONSCAN_PAGE_LIMIT", process.env.TRONSCAN_PAGE_LIMIT ?? "100", 1, 100),
    tronscanMaxPagesPerWallet: parsePositiveInteger("TRONSCAN_MAX_PAGES_PER_WALLET", process.env.TRONSCAN_MAX_PAGES_PER_WALLET ?? "5", 1),
    tronscanTimeoutMs: parsePositiveInteger("TRONSCAN_TIMEOUT_MS", process.env.TRONSCAN_TIMEOUT_MS ?? "10000", 1),
    tronscanRetryAttempts: parsePositiveInteger("TRONSCAN_RETRY_ATTEMPTS", process.env.TRONSCAN_RETRY_ATTEMPTS ?? "3", 1),
    tronscanRetryBaseDelayMs: parsePositiveInteger("TRONSCAN_RETRY_BASE_DELAY_MS", process.env.TRONSCAN_RETRY_BASE_DELAY_MS ?? "500", 1),
    tronscanBackfillLookbackMs: parsePositiveInteger("TRONSCAN_BACKFILL_LOOKBACK_MS", process.env.TRONSCAN_BACKFILL_LOOKBACK_MS ?? "86400000", 1),
    tronscanRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_REQUEST_MIN_INTERVAL_MS ?? "220",
      0
    ),
    tronscanGlobalRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS ?? "280",
      0
    ),
    tronscanTransferRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS ?? "350",
      0
    ),
    tronscanApprovalRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS ?? "300",
      0
    ),
    tronscanContractRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS ?? "300",
      0
    ),
    tronscanFullNodeRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS ?? "300",
      0
    ),
    tronscanAccountGroupRequestMinIntervalMs: parsePositiveInteger(
      "TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS ?? "250",
      0
    ),
    tronGridRequestMinIntervalMs: parsePositiveInteger(
      "TRONGRID_REQUEST_MIN_INTERVAL_MS",
      process.env.TRONGRID_REQUEST_MIN_INTERVAL_MS ?? "250",
      0
    ),
    tronscanRateLimitCooldownMs: parsePositiveInteger(
      "TRONSCAN_RATE_LIMIT_COOLDOWN_MS",
      process.env.TRONSCAN_RATE_LIMIT_COOLDOWN_MS ?? "30000",
      0
    ),
    tronscanDashboardCacheTtlMs: parsePositiveInteger(
      "TRONSCAN_DASHBOARD_CACHE_TTL_MS",
      process.env.TRONSCAN_DASHBOARD_CACHE_TTL_MS ?? "300000",
      1
    ),
    tronscanDashboardMaxPages: parsePositiveInteger(
      "TRONSCAN_DASHBOARD_MAX_PAGES",
      process.env.TRONSCAN_DASHBOARD_MAX_PAGES ?? "5",
      1
    ),
    tronscanDashboardForceRefreshCooldownMs: parsePositiveInteger(
      "TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS",
      process.env.TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS ?? "60000",
      0
    ),
    forensicWherePollIntervalMs: parsePositiveInteger(
      "FORENSIC_WHERE_POLL_INTERVAL_MS",
      process.env.FORENSIC_WHERE_POLL_INTERVAL_MS ?? "2000",
      1000
    ),
    forensicWhereJobsPerPoll: parsePositiveInteger(
      "FORENSIC_WHERE_JOBS_PER_POLL",
      process.env.FORENSIC_WHERE_JOBS_PER_POLL ?? "3",
      1
    ),
    forensicDeepPollIntervalMs: parsePositiveInteger(
      "FORENSIC_DEEP_POLL_INTERVAL_MS",
      process.env.FORENSIC_DEEP_POLL_INTERVAL_MS ?? "60000",
      1000
    ),
    forensicJobStaleAfterMs: parsePositiveInteger(
      "FORENSIC_JOB_STALE_AFTER_MS",
      process.env.FORENSIC_JOB_STALE_AFTER_MS ?? "1800000",
      1000
    ),
    forensicJobMaxRetries: parsePositiveInteger(
      "FORENSIC_JOB_MAX_RETRIES",
      process.env.FORENSIC_JOB_MAX_RETRIES ?? "2",
      0
    ),
    crossChainStage2Enabled: parseBooleanFlag("CROSS_CHAIN_STAGE2_ENABLED", process.env.CROSS_CHAIN_STAGE2_ENABLED, false),
    crossChainStage2MaxProviderCalls: parsePositiveInteger(
      "CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS",
      process.env.CROSS_CHAIN_STAGE2_MAX_PROVIDER_CALLS ?? "200",
      1
    ),
    crossChainStage2CacheTtlMs: parsePositiveInteger(
      "CROSS_CHAIN_STAGE2_CACHE_TTL_MS",
      process.env.CROSS_CHAIN_STAGE2_CACHE_TTL_MS ?? "86400000",
      1
    ),
    rangeApiKey: process.env.RANGE_API_KEY?.trim() || undefined,
    rangeBaseUrl: parseHttpsUrl("RANGE_BASE_URL", process.env.RANGE_BASE_URL ?? "https://api.range.org"),
    rangeTimeoutMs: parsePositiveInteger("RANGE_TIMEOUT_MS", process.env.RANGE_TIMEOUT_MS ?? "20000", 1),
    rangeMaxCallsPerCheck: parsePositiveInteger("RANGE_MAX_CALLS_PER_CHECK", process.env.RANGE_MAX_CALLS_PER_CHECK ?? "20", 1),
    evmExplorerApiKey: process.env.EVM_EXPLORER_API_KEY?.trim() || process.env.ETHERSCAN_API_KEY?.trim() || undefined,
    evmExplorerBaseUrl: parseHttpsUrl(
      "EVM_EXPLORER_BASE_URL",
      process.env.EVM_EXPLORER_BASE_URL ?? "https://api.etherscan.io/v2/api"
    ),
    evmExplorerTimeoutMs: parsePositiveInteger("EVM_EXPLORER_TIMEOUT_MS", process.env.EVM_EXPLORER_TIMEOUT_MS ?? "20000", 1),
    evmExplorerMaxCallsPerCheck: parsePositiveInteger(
      "EVM_EXPLORER_MAX_CALLS_PER_CHECK",
      process.env.EVM_EXPLORER_MAX_CALLS_PER_CHECK ?? "40",
      1
    ),
    alchemyApiKey: process.env.ALCHEMY_API_KEY?.trim() || undefined,
    alchemyTimeoutMs: parsePositiveInteger("ALCHEMY_TIMEOUT_MS", process.env.ALCHEMY_TIMEOUT_MS ?? "20000", 1),
    llmContractAnalysisEnabled: llmFeatureEnabled && Boolean(llmApiKey),
    llmApiKey,
    llmBaseUrl: withTrailingSlash(parseHttpsUrl("LLM_BASE_URL", process.env.LLM_BASE_URL ?? "https://api.deepseek.com")),
    llmModel,
    llmThinkingEnabled,
    llmReasoningEffort,
    llmModelCacheKey: buildLlmModelCacheKey({
      providerLabel: llmProviderLabel,
      model: llmModel,
      thinkingEnabled: llmThinkingEnabled,
      reasoningEffort: llmReasoningEffort
    }),
    llmProviderLabel,
    llmTimeoutMs: parsePositiveInteger("LLM_TIMEOUT_MS", process.env.LLM_TIMEOUT_MS ?? "60000", 1),
    llmMaxRetries: parsePositiveInteger("LLM_MAX_RETRIES", process.env.LLM_MAX_RETRIES ?? "2", 0),
    llmCacheTtlMs: parsePositiveInteger("LLM_CACHE_TTL_MS", process.env.LLM_CACHE_TTL_MS ?? "2592000000", 1),
    llmEnrichmentMaxAttempts: parsePositiveInteger(
      "LLM_ENRICHMENT_MAX_ATTEMPTS",
      process.env.LLM_ENRICHMENT_MAX_ATTEMPTS ?? "4",
      1
    ),
    llmEnrichmentRetryDelayMs: parsePositiveInteger(
      "LLM_ENRICHMENT_RETRY_DELAY_MS",
      process.env.LLM_ENRICHMENT_RETRY_DELAY_MS ?? "15000",
      0
    ),
    pollIntervalMs: parsePositiveInteger("POLL_INTERVAL_MS", process.env.POLL_INTERVAL_MS ?? "60000", 1000),
    pollStartDelayMs: parsePositiveInteger("POLL_START_DELAY_MS", process.env.POLL_START_DELAY_MS ?? "0", 0),
    forensicWhereStartDelayMs: parsePositiveInteger(
      "FORENSIC_WHERE_START_DELAY_MS",
      process.env.FORENSIC_WHERE_START_DELAY_MS ?? "3000",
      0
    ),
    forensicIncomingStartDelayMs: parsePositiveInteger(
      "FORENSIC_INCOMING_START_DELAY_MS",
      process.env.FORENSIC_INCOMING_START_DELAY_MS ?? "6000",
      0
    ),
    forensicDeepStartDelayMs: parsePositiveInteger(
      "FORENSIC_DEEP_START_DELAY_MS",
      process.env.FORENSIC_DEEP_START_DELAY_MS ?? "12000",
      0
    ),
    adminDashboardEnabled: parseBooleanFlag("ADMIN_DASHBOARD_ENABLED", process.env.ADMIN_DASHBOARD_ENABLED, false),
    adminDashboardHost: process.env.ADMIN_DASHBOARD_HOST?.trim() || "127.0.0.1",
    adminDashboardPort: parseIntegerInRange("ADMIN_DASHBOARD_PORT", process.env.ADMIN_DASHBOARD_PORT ?? "8787", 1, 65535),
    adminDashboardToken: process.env.ADMIN_DASHBOARD_TOKEN?.trim() || null,
    serviceAdminTelegramIds: new Set(adminIds),
    runtimeInstanceLabel: process.env.RUNTIME_INSTANCE_LABEL?.trim() || undefined,
    theftReportDepositAddress: parseOptionalTronAddress("THEFT_REPORT_DEPOSIT_ADDRESS", process.env.THEFT_REPORT_DEPOSIT_ADDRESS),
    theftReportDepositAmountUsdt: "1000",
    theftReportGuideUrl: parseOptionalHttpsUrl("THEFT_REPORT_GUIDE_URL", process.env.THEFT_REPORT_GUIDE_URL),
    theftReportAdminContact: process.env.THEFT_REPORT_ADMIN_CONTACT?.trim() || undefined
  };
}
