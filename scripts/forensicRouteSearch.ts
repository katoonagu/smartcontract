import { parseForensicRouteCliArgs } from "../src/forensics/routeCliArgs";
import { formatAddressExposureReport, formatForensicRouteReport } from "../src/forensics/routeReport";
import { runForensicAddressExposureSearch, runForensicRouteSearch } from "../src/forensics/routeSearch";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getContractIntelligenceProfile,
  saveForensicRouteSearchResult,
  upsertContractIntelligenceProfile
} from "../src/storage/repositories";
import { TronscanClient } from "../src/tron/tronClient";
import { resolveContractIntelligenceProfile } from "../src/approvals/contractIntelligence";

const RECENT_FALLBACK_MIN_TRANSFER_COUNT = 10;
const RECENT_FALLBACK_TRANSFER_LIMIT = 60;

async function main(): Promise<void> {
  const parsed = parseForensicRouteCliArgs(process.argv.slice(2));
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - parsed.days * 24 * 60 * 60 * 1000);
  const config = loadConfig();
  const tronClient = new TronscanClient({
    baseUrl: config.tronscanBaseUrl,
    fullNodeBaseUrl: config.tronFullNodeBaseUrl,
    apiKey: config.tronscanApiKeys,
    apiKeyGroups: config.tronscanApiKeyGroups,
    accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs,
    fullNodeApiKey: config.tronFullNodeApiKey,
    timeoutMs: config.tronscanTimeoutMs,
    retryAttempts: config.tronscanRetryAttempts,
    retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
    requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
    rateLimitCooldownMs: config.tronscanRateLimitCooldownMs
  });

  const db = parsed.dryRun ? null : createDb(config.databaseUrl);
  try {
    const contractProfileResolver = db
      ? (address: string) => resolveContractIntelligenceProfile(address, {
          tronClient,
          getCachedProfile: (contractAddress, now) => getContractIntelligenceProfile(db, contractAddress, now),
          upsertProfile: (profile) => upsertContractIntelligenceProfile(db, profile)
        })
      : (address: string) => tronClient.getContractIntelligenceProfile(address);

    if (parsed.mode === "exposure") {
      const report = await runForensicAddressExposureSearch({
        sourceAddress: parsed.sourceAddress,
        windowStart,
        windowEnd,
        maxDepth: parsed.maxDepth,
        maxPagesPerAddress: parsed.maxPagesPerAddress,
        pageLimit: config.tronscanPageLimit,
        limit: parsed.limit,
        tronClient,
        getAddressMetadata: (address) => tronClient.getAddressMetadata(address),
        getContractIntelligenceProfile: contractProfileResolver,
        recentFallbackMinTransferCount: RECENT_FALLBACK_MIN_TRANSFER_COUNT,
        recentFallbackTransferLimit: RECENT_FALLBACK_TRANSFER_LIMIT
      });

      console.log(formatAddressExposureReport(report, { dryRun: parsed.dryRun }));
      return;
    }

    const report = await runForensicRouteSearch({
      sourceAddress: parsed.sourceAddress,
      targetAddress: parsed.targetAddress,
      amountUsdt: parsed.amountUsdt,
      windowStart,
      windowEnd,
      maxDepth: parsed.maxDepth,
      maxPagesPerAddress: parsed.maxPagesPerAddress,
      pageLimit: config.tronscanPageLimit,
      limit: parsed.limit,
      tronClient,
      getAddressMetadata: (address) => tronClient.getAddressMetadata(address),
      getContractIntelligenceProfile: contractProfileResolver,
      recentFallbackMinTransferCount: RECENT_FALLBACK_MIN_TRANSFER_COUNT,
      recentFallbackTransferLimit: RECENT_FALLBACK_TRANSFER_LIMIT
    });

    if (db) {
      await saveForensicRouteSearchResult(db, report);
    }

    console.log(formatForensicRouteReport(report, { dryRun: parsed.dryRun }));
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
