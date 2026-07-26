import "dotenv/config";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { runWhereIsMoneyCheck, type WhereIsMoneyDeps } from "../src/check/whereIsMoneyCheck";
import { loadConfig } from "../src/config";
import { canonicalizeArtifactJson } from "../src/forensics/canonicalJson";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { normalizeTransfer } from "../src/forensics/routeSearch";
import {
  assertExpectedStableWhereFacts,
  buildWhereLatencyReplayV1,
  collectRouteCriticalTransactionHashes,
  projectStableWhereFacts
} from "../src/forensics/whereLatencyReplay";
import { whereIsMoneyIndexedFetchLimit, whereIsMoneyLatestFallbackCacheKey, whereIsMoneyLiveFallbackLimit } from "../src/forensics/whereIsMoneyFetchLimits";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";
import { TRON_USDT_CONTRACT_ADDRESS } from "../src/parser/transactionParser";
import { evaluateAddressRisk } from "../src/risk/evaluation";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  listActiveAddressLabelAssertionsForRoute,
  listAddressLabels,
  listIndexedTronUsdtTransfersByHashes,
  listIndexedTronUsdtTransfersForAddress
} from "../src/storage/repositories";
import { TronscanClient } from "../src/tron/tronClient";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler";
import type { ForensicRouteEdge, IndexedTronUsdtTransfer, RiskReport, ServiceClassification, StablecoinRestrictionProfile, WhereIsMoneyReport } from "../src/types";

type JsonRecord = Record<string, unknown>;
type TapeEntry = { method: string; args: unknown[]; response: unknown; origin?: "legacy_observed" | "supplemental_stage_b_fixture" };

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function recordField(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function nonSecretConfigHash(config: Record<string, unknown>): string {
  const visible = Object.fromEntries(Object.entries(config).filter(([key]) =>
    !/(?:api[_-]?key|database|chat|telegram|token|secret|password)/i.test(key)
  ));
  return createHash("sha256").update(canonicalizeArtifactJson(visible)).digest("hex");
}

function indexedSnapshotRow(row: IndexedTronUsdtTransfer): Record<string, unknown> {
  return {
    transferId: row.transferId ?? null,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    blockTimestamp: row.blockTimestamp.toISOString(),
    eventIndex: row.eventIndex,
    provider: row.provider ?? null,
    providerRowOrdinalInTx: row.providerRowOrdinalInTx ?? null,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    amountRaw: row.amountRaw,
    method: row.method,
    eventType: row.eventType ?? null,
    callerAddress: row.callerAddress,
    contractRet: row.contractRet,
    finalResult: row.finalResult ?? null,
    reverted: row.reverted ?? false,
    riskTransaction: row.riskTransaction ?? false,
    confirmed: row.confirmed
  };
}

async function writeReplayExclusive(path: string, bytes: string): Promise<void> {
  const file = await open(resolve(path), "wx");
  try {
    await file.writeFile(bytes, "utf8");
  } finally {
    await file.close();
  }
}

const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const source = argument("--source") ?? positional[0] ?? null;
const output = argument("--out") ?? positional[1] ?? null;
if (!source || !output) throw new Error("Usage: forensic:where-latency:capture -- --source <TRON-address> --out <new-json-file>");

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  const selected = await db.query(
    `select id, subject_address, window_start, window_end, progress_json, result_json, completed_at
     from forensic_check_jobs
     where kind = 'where_is_money_check' and status = 'completed' and subject_address = $1
     order by completed_at desc nulls last, updated_at desc
     limit 1`,
    [source]
  );
  const job = selected.rows[0] as Record<string, unknown> | undefined;
  if (!job) throw new Error("where_latency_replay_completed_legacy_job_missing");
  const progress = recordField(job.progress_json);
  const result = recordField(job.result_json);
  const savedReport = result.whereIsMoneyReport as WhereIsMoneyReport | undefined;
  if (!savedReport) throw new Error("where_latency_replay_completed_report_missing");
  const jobSource = requiredString(job.subject_address, "where_latency_replay_job_source_missing");
  const windowStart = new Date(requiredString(job.window_start, "where_latency_replay_job_window_missing"));
  const windowEnd = new Date(requiredString(job.window_end, "where_latency_replay_job_window_missing"));
  const completedAt = new Date(requiredString(job.completed_at, "where_latency_replay_job_completed_at_missing"));
  if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime()) || !Number.isFinite(completedAt.getTime()) || windowStart >= windowEnd) {
    throw new Error("where_latency_replay_job_window_invalid");
  }

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
    scheduler,
    schedulerDedupeNamespace: `where-latency:${String(job.id)}`
  });

  const tape: TapeEntry[] = [];
  const tapeByRequest = new Map<string, TapeEntry>();
  const observedTransactions = new Set<string>();
  const baselineRequestCounts: Record<string, number> = {};
  const record = async <T>(method: string, args: unknown[], operation: () => Promise<T>, origin: TapeEntry["origin"] = "legacy_observed"): Promise<T> => {
    const request = canonicalizeArtifactJson({ method, args: JSON.parse(JSON.stringify(args)) });
    const existing = tapeByRequest.get(request);
    if (existing) return structuredClone(existing.response) as T;
    const response = await operation();
    const entry = { method, args: JSON.parse(JSON.stringify(args)), response: JSON.parse(JSON.stringify(response)), origin };
    tape.push(entry);
    tapeByRequest.set(request, entry);
    baselineRequestCounts[method] = (baselineRequestCounts[method] ?? 0) + 1;
    if (method === "getTransaction" && typeof args[0] === "string") observedTransactions.add(args[0]);
    return response;
  };
  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
  const stablecoinCache = new Map<string, Promise<StablecoinRestrictionProfile | null>>();
  const getStablecoin = (address: string) => {
    if (!stablecoinCache.has(address)) stablecoinCache.set(address, tronClient.getUsdtRestrictionStatus(address).catch(() => null));
    return stablecoinCache.get(address)!;
  };
  const fetchEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => record("fetchEdgesForAddress", [address, { windowStart, windowEnd }], async () => {
    if (edgeCache.has(address)) return edgeCache.get(address)!;
    const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
      address, minTimestamp: windowStart, maxTimestamp: windowEnd, direction: "both",
      limit: whereIsMoneyIndexedFetchLimit(numberField(progress.maxEdgesPerAddress, 100)), orderBy: "newest"
    });
    const indexed = transfers.map(indexedTransferToRouteEdge);
    const live = indexed.length === 0 ? (await tronClient.listRelatedTrc20Transfers(address, {
      start: 0, limit: numberField(progress.maxEdgesPerAddress, 100), minTimestamp: windowStart.getTime(), endTimestamp: windowEnd.getTime()
    }).catch(() => [])).map(normalizeTransfer).filter((edge): edge is ForensicRouteEdge => edge !== null) : [];
    const edges = indexed.length > 0 ? indexed : live;
    edgeCache.set(address, edges);
    return edges;
  });
  const fetchLatestEdgesForAddress = async (address: string, limit: number): Promise<ForensicRouteEdge[]> => record("fetchLatestEdgesForAddress", [address, limit], async () => {
    const liveLimit = whereIsMoneyLiveFallbackLimit(limit, numberField(progress.maxEdgesPerAddress, 100));
    const key = whereIsMoneyLatestFallbackCacheKey(address, limit, liveLimit);
    if (latestEdgeCache.has(key)) return latestEdgeCache.get(key)!;
    const edges = (await tronClient.listRelatedTrc20Transfers(address, { start: 0, limit: liveLimit }).catch(() => []))
      .map(normalizeTransfer).filter((edge): edge is ForensicRouteEdge => edge !== null);
    latestEdgeCache.set(key, edges);
    return edges;
  });
  const getClassification = async (address: string): Promise<ServiceClassification | null> => record("getClassificationForAddress", [address], async () => {
    const metadata = await getAddressMetadata(db, address, new Date(windowEnd));
      // The completed legacy run must not be changed by capture; a missing cached metadata record remains unknown.
    if (!metadata) return null;
    const profile = metadata.isContract ? await getContractIntelligenceProfile(db, address, new Date(windowEnd)) : null;
    return classifyServiceAddress({ address, metadata, contractProfile: profile });
  });
  const deps: WhereIsMoneyDeps = {
    getTrc20Balance: (address, contract) => record("getTrc20Balance", [address, contract], async () => {
      if (contract !== TRON_USDT_CONTRACT_ADDRESS) return null;
      return (await getStablecoin(address))?.balanceRaw ?? null;
    }),
    fetchEdgesForAddress,
    fetchLatestEdgesForAddress,
    getLabelsForAddress: (address) => record("getLabelsForAddress", [address], () => listAddressLabels(db, address)),
    getClassificationForAddress: getClassification,
    getFastWalletRisk: (address) => record("getFastWalletRisk", [address], async () => {
      const labels = await listAddressLabels(db, address);
      const state = await getStablecoin(address);
      return evaluateAddressRisk({ context: { subjectAddress: address }, labels, amlSignals: state?.isBlacklisted ? [{
        code: "stablecoin_usdt_blacklisted", message: "Official TRON USDT contract blacklist state is active for this address.",
        scoreImpact: 90, source: "stablecoin_contract", confidence: "high", severity: "critical"
      }] : [] }).report as RiskReport;
    }),
    getTransaction: (txHash) => record("getTransaction", [txHash], () => tronClient.getTransaction(txHash)),
    listTrc20ApprovalChanges: (input) => record("listTrc20ApprovalChanges", [input], () => tronClient.listTrc20ApprovalChanges(input)),
    getUsdtRestrictionStatus: (address, options) => record("getUsdtRestrictionStatus", [address, options ?? null], () => tronClient.getUsdtRestrictionStatus(address, options)),
    getContractIntelligenceProfile: (address) => record("getContractIntelligenceProfile", [address], async () =>
      await getContractIntelligenceProfile(db, address, new Date(windowEnd)) ?? tronClient.getContractIntelligenceProfile(address, { now: new Date(windowEnd), requireComplete: true }))
  };
  const options = {
    mode: progress.mode === "transaction_check" || progress.mode === "wallet_profile" ? progress.mode : "where_is_money" as const,
    sourceAddress: jobSource,
    requestedAmountRaw: typeof progress.requestedAmountRaw === "string" ? progress.requestedAmountRaw : null,
    seedTransfers: Array.isArray(progress.seedTransfers) ? progress.seedTransfers : undefined,
    windowStart, windowEnd,
    maxDepth: numberField(progress.maxDepth, 20), beamWidth: numberField(progress.beamWidth, 12),
    maxAddressFetches: numberField(progress.maxAddressFetches, 150), maxEdgesPerAddress: numberField(progress.maxEdgesPerAddress, 100),
    approvalEnrichmentMode: progress.approvalEnrichmentMode === "off" || progress.approvalEnrichmentMode === "always" ? progress.approvalEnrichmentMode : "triggered" as const,
    maxApprovalCandidates: numberField(progress.maxApprovalCandidates, 30),
    maxContractTransactionInfoFetches: numberField(progress.maxContractTransactionInfoFetches, 2000),
    contractTransactionInfoMinIntervalMs: numberField(progress.contractTransactionInfoMinIntervalMs, 0),
    crossChainStage2Enabled: progress.crossChainStage2Enabled === true,
    crossChainManualDeepMode: progress.crossChainManualDeepMode === true,
    crossChainMaxProviderCalls: numberField(progress.crossChainMaxProviderCalls, 200)
  };
  const rerun = await runWhereIsMoneyCheck(deps, options);
  const expectedStableFacts = projectStableWhereFacts(savedReport);
  assertExpectedStableWhereFacts({ expectedStableFacts } as any, rerun);
  const routeHashes = collectRouteCriticalTransactionHashes(rerun, { legacyObservedTransactionHashes: [...observedTransactions] });
  if (routeHashes.length === 0) throw new Error("where_latency_replay_route_critical_hash_missing");
  const indexedRows = await listIndexedTronUsdtTransfersByHashes(db, routeHashes);
  if (indexedRows.length === 0 || routeHashes.some((txHash) => !indexedRows.some((row) => row.txHash === txHash))) {
    throw new Error("where_latency_replay_indexed_movement_missing");
  }
  const assertions = await listActiveAddressLabelAssertionsForRoute(db, { chain: "tron", addresses: [jobSource, ...rerun.originPaths.flatMap((path) => path.pathAddresses)], txHashes: routeHashes });
  const rawTransactions = [];
  for (const txHash of routeHashes) {
    if (!observedTransactions.has(txHash)) {
      const response = await tronClient.getTransaction(txHash);
      tape.push({ method: "getTransaction", args: [txHash], response, origin: "supplemental_stage_b_fixture" });
    }
    const raw = await tronClient.getRawTransaction(txHash) as JsonRecord;
    if (typeof raw.txID !== "string" || raw.txID.toLowerCase() !== txHash.toLowerCase()) {
      throw new Error("where_latency_replay_raw_transaction_binding_mismatch");
    }
    rawTransactions.push({ txHash, response: raw });
  }
  const complete = buildWhereLatencyReplayV1({
    schema: "where-latency-replay-v1", version: 1, baselineGitCommit: "4861f22e697652c688489ef4be6ab9698cd6ef9f",
    resolvedConfigHash: nonSecretConfigHash(config as unknown as Record<string, unknown>),
    frozenClockIso: completedAt.toISOString(),
    job: { sourceAddress: jobSource, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), options },
    dependencies: tape,
    indexedMovements: [{ txHashes: routeHashes, rows: indexedRows.map(indexedSnapshotRow) }],
    assertionQueries: [{ chain: "tron", addresses: [jobSource, ...rerun.originPaths.flatMap((path) => path.pathAddresses)], txHashes: routeHashes, rows: assertions as unknown as Record<string, unknown>[] }],
    rawTransactions, baselineRequestCounts, expectedStableFacts
  } as any);
  await writeReplayExclusive(output, complete.canonicalJson);
} finally {
  await closeDb(db);
}
