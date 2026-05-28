import "dotenv/config";

export type AppConfig = {
  botToken: string;
  databaseUrl: string;
  tronscanBaseUrl: URL;
  tronFullNodeBaseUrl: URL;
  tronscanApiKey: string | undefined;
  tronscanApiKeys: string[];
  tronFullNodeApiKey: string | undefined;
  tronscanPageLimit: number;
  tronscanMaxPagesPerWallet: number;
  tronscanTimeoutMs: number;
  tronscanRetryAttempts: number;
  tronscanRetryBaseDelayMs: number;
  tronscanBackfillLookbackMs: number;
  tronscanRequestMinIntervalMs: number;
  tronscanRateLimitCooldownMs: number;
  tronscanDashboardCacheTtlMs: number;
  tronscanDashboardMaxPages: number;
  tronscanDashboardForceRefreshCooldownMs: number;
  forensicWherePollIntervalMs: number;
  forensicWhereJobsPerPoll: number;
  forensicDeepPollIntervalMs: number;
  llmContractAnalysisEnabled: boolean;
  llmApiKey: string | undefined;
  llmBaseUrl: URL;
  llmModel: string;
  llmProviderLabel: string;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  llmCacheTtlMs: number;
  pollIntervalMs: number;
  serviceAdminTelegramIds: Set<string>;
  runtimeInstanceLabel: string | undefined;
};

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

function withTrailingSlash(url: URL): URL {
  return url.href.endsWith("/") ? url : new URL(`${url.href}/`);
}

function parseCommaSeparatedValues(rawValue: string | undefined): string[] {
  return [...new Set((rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];
}

function parseBooleanFlag(name: string, rawValue: string | undefined, defaultValue: boolean): boolean {
  const value = (rawValue ?? "").trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  throw new Error(`${name} must be true or false`);
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

  return {
    botToken: requireEnv("BOT_TOKEN"),
    databaseUrl: requireEnv("DATABASE_URL"),
    tronscanBaseUrl: parseHttpsUrl("TRONSCAN_BASE_URL", process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com"),
    tronFullNodeBaseUrl: parseHttpsUrl("TRON_FULLNODE_BASE_URL", process.env.TRON_FULLNODE_BASE_URL ?? "https://api.trongrid.io"),
    tronscanApiKey: tronscanApiKeys[0],
    tronscanApiKeys,
    tronFullNodeApiKey: process.env.TRON_FULLNODE_API_KEY?.trim() || undefined,
    tronscanPageLimit: parseIntegerInRange("TRONSCAN_PAGE_LIMIT", process.env.TRONSCAN_PAGE_LIMIT ?? "50", 1, 50),
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
    tronscanRateLimitCooldownMs: parsePositiveInteger(
      "TRONSCAN_RATE_LIMIT_COOLDOWN_MS",
      process.env.TRONSCAN_RATE_LIMIT_COOLDOWN_MS ?? "15000",
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
    llmContractAnalysisEnabled: llmFeatureEnabled && Boolean(llmApiKey),
    llmApiKey,
    llmBaseUrl: withTrailingSlash(parseHttpsUrl("LLM_BASE_URL", process.env.LLM_BASE_URL ?? "https://api.deepseek.com")),
    llmModel: process.env.LLM_MODEL?.trim() || "deepseek-v4-flash",
    llmProviderLabel: process.env.LLM_PROVIDER_LABEL?.trim() || "deepseek",
    llmTimeoutMs: parsePositiveInteger("LLM_TIMEOUT_MS", process.env.LLM_TIMEOUT_MS ?? "20000", 1),
    llmMaxRetries: parsePositiveInteger("LLM_MAX_RETRIES", process.env.LLM_MAX_RETRIES ?? "2", 0),
    llmCacheTtlMs: parsePositiveInteger("LLM_CACHE_TTL_MS", process.env.LLM_CACHE_TTL_MS ?? "2592000000", 1),
    pollIntervalMs: parsePositiveInteger("POLL_INTERVAL_MS", process.env.POLL_INTERVAL_MS ?? "60000", 1000),
    serviceAdminTelegramIds: new Set(adminIds),
    runtimeInstanceLabel: process.env.RUNTIME_INSTANCE_LABEL?.trim() || undefined
  };
}
