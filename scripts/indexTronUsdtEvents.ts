import "dotenv/config";
import { indexTronUsdtEventWindow } from "../src/forensics/tronUsdtEventIndexer";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  upsertIndexedTronUsdtApprovals,
  upsertIndexedTronUsdtTransfers,
  upsertTronUsdtIndexerCursor
} from "../src/storage/repositories";
import { TronscanClient } from "../src/tron/tronClient";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler";

function parseArgs(argv: string[]): {
  start: Date;
  end: Date;
  cursorId: string;
  maxPagesPerEventName: number;
  limit: number;
} {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) continue;
    values.set(key, value);
    i += 1;
  }
  const startRaw = values.get("--start");
  const endRaw = values.get("--end");
  if (!startRaw || !endRaw) {
    throw new Error("Usage: npm run forensic:index -- --start <ISO> --end <ISO> [--cursor tron_usdt_backfill] [--max-pages 100] [--limit 200]");
  }
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error("--start and --end must be valid ISO dates, and start must be before end");
  }
  const maxPagesPerEventName = Number(values.get("--max-pages") ?? "100");
  const limit = Number(values.get("--limit") ?? "200");
  if (!Number.isSafeInteger(maxPagesPerEventName) || maxPagesPerEventName < 1) {
    throw new Error("--max-pages must be a positive integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("--limit must be an integer between 1 and 200");
  }
  return {
    start,
    end,
    cursorId: values.get("--cursor") ?? "tron_usdt_backfill",
    maxPagesPerEventName,
    limit
  };
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const db = createDb(config.databaseUrl);
const scheduler = createTronscanScheduler({
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  globalRequestMinIntervalMs: config.tronscanGlobalRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  endpointMinIntervalMs: {
    transfer: config.tronscanTransferRequestMinIntervalMs,
    approval: config.tronscanApprovalRequestMinIntervalMs,
    contract: config.tronscanContractRequestMinIntervalMs,
    fullnode: config.tronscanFullNodeRequestMinIntervalMs,
    trongrid: config.tronGridRequestMinIntervalMs
  },
  apiKeys: config.tronscanApiKeys,
  apiKeyGroups: config.tronscanApiKeyGroups,
  accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs
});
const tronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKeys,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: config.tronscanTimeoutMs,
  retryAttempts: config.tronscanRetryAttempts,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  scheduler
});

try {
  const result = await indexTronUsdtEventWindow({
    eventSource: tronClient,
    upsertTransfers: (transfers) => upsertIndexedTronUsdtTransfers(db, transfers),
    upsertApprovals: (approvals) => upsertIndexedTronUsdtApprovals(db, approvals),
    upsertCursor: (cursor) => upsertTronUsdtIndexerCursor(db, cursor)
  }, {
    cursorId: args.cursorId,
    minTimestamp: args.start,
    maxTimestamp: args.end,
    maxPagesPerEventName: args.maxPagesPerEventName,
    limit: args.limit
  });
  console.log(JSON.stringify({
    status: "completed",
    cursorId: args.cursorId,
    ...result
  }, null, 2));
} finally {
  await closeDb(db);
}
