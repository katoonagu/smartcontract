import { parseForensicRouteCliArgs } from "../src/forensics/routeCliArgs";
import { formatForensicRouteReport } from "../src/forensics/routeReport";
import { runForensicRouteSearch } from "../src/forensics/routeSearch";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getContractIntelligenceProfile,
  saveForensicRouteSearchResult,
  upsertContractIntelligenceProfile
} from "../src/storage/repositories";
import { TronscanClient } from "../src/tron/tronClient";
import { resolveContractIntelligenceProfile } from "../src/approvals/contractIntelligence";

async function main(): Promise<void> {
  const { sourceAddress, targetAddress, dryRun, days, maxDepth, maxPagesPerAddress, limit, amountUsdt } = parseForensicRouteCliArgs(
    process.argv.slice(2)
  );
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
  const config = loadConfig();
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

  const db = dryRun ? null : createDb(config.databaseUrl);
  try {
    const report = await runForensicRouteSearch({
      sourceAddress,
      targetAddress,
      amountUsdt,
      windowStart,
      windowEnd,
      maxDepth,
      maxPagesPerAddress,
      pageLimit: config.tronscanPageLimit,
      limit,
      tronClient,
      getAddressMetadata: (address) => tronClient.getAddressMetadata(address),
      getContractIntelligenceProfile: db
        ? (address) => resolveContractIntelligenceProfile(address, {
            tronClient,
            getCachedProfile: (contractAddress, now) => getContractIntelligenceProfile(db, contractAddress, now),
            upsertProfile: (profile) => upsertContractIntelligenceProfile(db, profile)
          })
        : (address) => tronClient.getContractIntelligenceProfile(address)
    });

    if (db) {
      await saveForensicRouteSearchResult(db, report);
    }

    console.log(formatForensicRouteReport(report, { dryRun }));
  } finally {
    if (db) {
      await closeDb(db);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
