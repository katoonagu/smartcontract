import "dotenv/config";

export type AppConfig = {
  botToken: string;
  databaseUrl: string;
  tronscanBaseUrl: URL;
  tronscanApiKey: string | undefined;
  tronscanPageLimit: number;
  tronscanMaxPagesPerWallet: number;
  tronscanTimeoutMs: number;
  tronscanRetryAttempts: number;
  tronscanRetryBaseDelayMs: number;
  tronscanBackfillLookbackMs: number;
  pollIntervalMs: number;
  serviceAdminTelegramIds: Set<string>;
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

export function loadConfig(): AppConfig {
  const rawAdminIds = process.env.SERVICE_ADMIN_TG_IDS ?? "";
  const adminIds = rawAdminIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return {
    botToken: requireEnv("BOT_TOKEN"),
    databaseUrl: requireEnv("DATABASE_URL"),
    tronscanBaseUrl: parseHttpsUrl("TRONSCAN_BASE_URL", process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com"),
    tronscanApiKey: process.env.TRONSCAN_API_KEY?.trim() || undefined,
    tronscanPageLimit: parseIntegerInRange("TRONSCAN_PAGE_LIMIT", process.env.TRONSCAN_PAGE_LIMIT ?? "50", 1, 50),
    tronscanMaxPagesPerWallet: parsePositiveInteger("TRONSCAN_MAX_PAGES_PER_WALLET", process.env.TRONSCAN_MAX_PAGES_PER_WALLET ?? "5", 1),
    tronscanTimeoutMs: parsePositiveInteger("TRONSCAN_TIMEOUT_MS", process.env.TRONSCAN_TIMEOUT_MS ?? "10000", 1),
    tronscanRetryAttempts: parsePositiveInteger("TRONSCAN_RETRY_ATTEMPTS", process.env.TRONSCAN_RETRY_ATTEMPTS ?? "3", 1),
    tronscanRetryBaseDelayMs: parsePositiveInteger("TRONSCAN_RETRY_BASE_DELAY_MS", process.env.TRONSCAN_RETRY_BASE_DELAY_MS ?? "500", 1),
    tronscanBackfillLookbackMs: parsePositiveInteger("TRONSCAN_BACKFILL_LOOKBACK_MS", process.env.TRONSCAN_BACKFILL_LOOKBACK_MS ?? "86400000", 1),
    pollIntervalMs: parsePositiveInteger("POLL_INTERVAL_MS", process.env.POLL_INTERVAL_MS ?? "60000", 1000),
    serviceAdminTelegramIds: new Set(adminIds)
  };
}
