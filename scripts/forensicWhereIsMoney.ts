import "dotenv/config";
import { runWhereIsMoneyCheck } from "../src/check/whereIsMoneyCheck";
import { evaluateAddressRisk } from "../src/risk/evaluation";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  listAddressLabels,
  listIndexedTronUsdtTransfersForAddress
} from "../src/storage/repositories";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { parseWhereIsMoneyCliArgs } from "../src/forensics/whereIsMoneyCliArgs";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";
import { TronscanClient } from "../src/tron/tronClient";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler";
import type { ForensicRouteEdge, ServiceClassification, StablecoinRestrictionProfile } from "../src/types";

function formatRawUsdt(amountRaw: string | null): string {
  if (!amountRaw || !/^\d+$/.test(amountRaw)) return "not checked";
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function levelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

const args = parseWhereIsMoneyCliArgs(process.argv.slice(1));
const config = loadConfig();
const db = createDb(databaseUrlFromEnvironment());
const scheduler = createTronscanScheduler({
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  apiKeyConfigured: Boolean(config.tronscanApiKey)
});
const tronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKey,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: config.tronscanTimeoutMs,
  retryAttempts: config.tronscanRetryAttempts,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  scheduler
});

const edgeCache = new Map<string, ForensicRouteEdge[]>();
const classificationCache = new Map<string, ServiceClassification | null>();
const stablecoinStateCache = new Map<string, Promise<StablecoinRestrictionProfile | null>>();

async function fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]> {
  if (edgeCache.has(address)) return edgeCache.get(address) ?? [];
  const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
    address,
    minTimestamp: args.windowStart,
    maxTimestamp: args.windowEnd,
    direction: "both",
    limit: 200,
    orderBy: "newest"
  });
  const edges = transfers.map(indexedTransferToRouteEdge);
  edgeCache.set(address, edges);
  return edges;
}

async function getClassificationForAddress(address: string): Promise<ServiceClassification | null> {
  if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
  const metadata = await getAddressMetadata(db, address, new Date());
  const contractProfile = metadata?.isContract
    ? await getContractIntelligenceProfile(db, address, new Date())
    : null;
  const classification = classifyServiceAddress({ address, metadata, contractProfile });
  classificationCache.set(address, classification);
  return classification;
}

async function getStablecoinState(address: string): Promise<StablecoinRestrictionProfile | null> {
  if (!stablecoinStateCache.has(address)) {
    stablecoinStateCache.set(address, tronClient.getUsdtRestrictionStatus(address).catch(() => null));
  }
  return stablecoinStateCache.get(address) ?? null;
}

try {
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async (address) => {
      const state = await getStablecoinState(address);
      return state?.balanceRaw ?? null;
    },
    fetchEdgesForAddress,
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getClassificationForAddress,
    getFastWalletRisk: async (address) => {
      const labels = await listAddressLabels(db, address);
      const stablecoinState = await getStablecoinState(address);
      const amlSignals = stablecoinState?.isBlacklisted
        ? [{
            code: "stablecoin_usdt_blacklisted",
            message: "Official TRON USDT contract blacklist state is active for this address.",
            scoreImpact: 90,
            source: "stablecoin_contract",
            confidence: "high" as const,
            severity: "critical" as const
          }]
        : [];
      return evaluateAddressRisk({
        context: { subjectAddress: address },
        labels,
        amlSignals
      }).report;
    }
  }, {
    sourceAddress: args.source,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    maxDepth: args.depth,
    beamWidth: args.beamWidth,
    maxAddressFetches: args.maxAddressFetches,
    maxEdgesPerAddress: args.maxEdgesPerAddress
  });

  console.log(`Subject: ${report.subjectAddress}`);
  console.log(`Window: ${args.windowStart.toISOString()} -> ${args.windowEnd.toISOString()}`);
  console.log(`Current USDT balance: ${formatRawUsdt(report.currentUsdtBalanceRaw)}`);
  console.log(`Balance-forming transfers: ${report.coverage.selectedInboundTxCount} txs, covering ${formatPercent(report.coverage.currentBalanceCoverageRatio)} of current balance`);
  console.log(`Decision: ${report.decision}`);
  console.log(`Risk: ${report.riskScore}/100 ${levelFromScore(report.riskScore)}`);
  console.log("");
  console.log("Main reasons:");
  if (report.decisionReasons.length === 0) {
    console.log("- none");
  }
  for (const reason of report.decisionReasons) {
    console.log(`- ${reason}`);
  }

  console.log("");
  console.log("Balance-forming transfers:");
  if (report.balanceFormingTransfers.length === 0) {
    console.log("- none");
  }
  for (const transfer of report.balanceFormingTransfers) {
    console.log(`- ${transfer.txHash} | ${transfer.fromAddress} -> ${transfer.toAddress} | ${formatRawUsdt(transfer.amountRaw)} | share ${formatPercent(transfer.coverageShare)}`);
  }

  console.log("");
  console.log("Origin paths:");
  if (report.originPaths.length === 0) {
    console.log("- none");
  }
  for (const path of report.originPaths) {
    console.log(`- ${path.verdict} | ${path.riskScoreContribution}/100 | ${path.stoppedReason}`);
    console.log(`  path: ${path.pathAddresses.join(" -> ")}`);
    console.log(`  tx: ${path.txHashes.join(" -> ")}`);
    console.log(`  preservation: ${formatPercent(path.amountPreservationRatio)}`);
  }

  console.log("");
  console.log("Fast wallet check:");
  if (!report.fastWalletRisk) {
    console.log("- not available");
  } else {
    console.log(`- ${report.fastWalletRisk.score}/100 ${report.fastWalletRisk.level}`);
    for (const reason of report.fastWalletRisk.reasons.slice(0, 5)) {
      console.log(`- ${reason.message}`);
    }
  }

  console.log("");
  console.log("Coverage:");
  console.log(`- partial: ${report.coverage.partial ? "yes" : "no"}`);
  console.log(`- max depth: ${report.coverage.maxDepth}`);
  console.log(`- fetched addresses: ${report.coverage.fetchedAddressCount}`);
  for (const note of report.coverage.notes) {
    console.log(`- ${note}`);
  }
} finally {
  await closeDb(db);
}
