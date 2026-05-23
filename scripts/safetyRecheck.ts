import { runSafetyRecheck, formatSafetyRecheckSummary, parseSafetyRecheckTarget } from "../src/approvals/safetyRecheck";
import { loadConfig } from "../src/config";
import { logger } from "../src/logging/logger";
import { closeDb, createDb } from "../src/storage/db";
import { TronscanClient } from "../src/tron/tronClient";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const walletAddress = argValue("--wallet");
  if (!walletAddress) {
    throw new Error("Usage: npm run safety:recheck -- --wallet <address> [--spender <address>] [--tx <hash>]");
  }

  const spender = argValue("--spender");
  const tx = argValue("--tx");
  if (spender && tx) {
    throw new Error("Use either --spender or --tx, not both.");
  }

  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const tronClient = new TronscanClient({
    baseUrl: config.tronscanBaseUrl,
    fullNodeBaseUrl: config.tronFullNodeBaseUrl,
    apiKey: config.tronscanApiKey,
    fullNodeApiKey: config.tronFullNodeApiKey,
    timeoutMs: config.tronscanTimeoutMs,
    retryAttempts: config.tronscanRetryAttempts,
    retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
    requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
    rateLimitCooldownMs: config.tronscanRateLimitCooldownMs
  });

  try {
    const summary = await runSafetyRecheck({
      db,
      tronClient,
      walletAddress,
      target: parseSafetyRecheckTarget(spender ?? tx),
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      logger
    });
    console.log(formatSafetyRecheckSummary(summary));
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

