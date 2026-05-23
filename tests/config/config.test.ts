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

    expect(config.tronscanPageLimit).toBe(50);
    expect(config.tronFullNodeBaseUrl.href).toBe("https://api.trongrid.io/");
    expect(config.tronFullNodeApiKey).toBeUndefined();
    expect(config.tronscanMaxPagesPerWallet).toBe(5);
    expect(config.tronscanTimeoutMs).toBe(10000);
    expect(config.tronscanRetryAttempts).toBe(3);
    expect(config.tronscanRetryBaseDelayMs).toBe(500);
    expect(config.tronscanBackfillLookbackMs).toBe(86400000);
    expect(config.tronscanDashboardCacheTtlMs).toBe(300000);
    expect(config.tronscanDashboardMaxPages).toBe(5);
    expect(config.tronscanRequestMinIntervalMs).toBe(250);
    expect(config.tronscanRateLimitCooldownMs).toBe(30000);
    expect(config.tronscanDashboardForceRefreshCooldownMs).toBe(60000);
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
      TRONSCAN_RATE_LIMIT_COOLDOWN_MS: "5000",
      TRONSCAN_DASHBOARD_FORCE_REFRESH_COOLDOWN_MS: "15000"
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
    expect(config.tronscanRateLimitCooldownMs).toBe(5000);
    expect(config.tronscanDashboardForceRefreshCooldownMs).toBe(15000);
  });

  it("rejects page limits outside the TronScan-safe range", () => {
    setRequiredEnv({ TRONSCAN_PAGE_LIMIT: "51" });

    expect(() => loadConfig()).toThrow("TRONSCAN_PAGE_LIMIT must be a safe integer between 1 and 50");
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
