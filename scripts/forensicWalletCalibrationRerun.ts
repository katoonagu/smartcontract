import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAddressExposureRiskSignalProvider } from "../src/check/addressExposureSignals";
import { runDeepAddressForensicCheck } from "../src/check/deepForensicCheck";
import { checkAddress } from "../src/check/manualCheck";
import { runWhereIsMoneyCheck } from "../src/check/whereIsMoneyCheck";
import { loadConfig } from "../src/config";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { normalizeTransfer } from "../src/forensics/routeSearch";
import {
  whereIsMoneyIndexedFetchLimit,
  whereIsMoneyLatestFallbackCacheKey,
  whereIsMoneyLiveFallbackLimit
} from "../src/forensics/whereIsMoneyFetchLimits";
import { logger as defaultLogger, type Logger } from "../src/logging/logger";
import { TRON_USDT_CONTRACT_ADDRESS } from "../src/parser/transactionParser";
import { calculateUnifiedWalletRisk } from "../src/risk/unifiedWalletRisk";
import { closeDb, createDb, type Db } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  getTransactionProviderEvidence,
  listActiveAddressLabelAssertionsForRoute,
  listAddressLabels,
  listIndexedTronUsdtTransfersForAddress,
  listIndexedTronUsdtTransfersByHashes,
  saveTransactionEnrichmentDecisionEvidence,
  saveTransactionProviderEvidence,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile
} from "../src/storage/repositories";
import { TronscanClient } from "../src/tron/tronClient";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler";
import type {
  DeepAddressForensicReport,
  ForensicRouteEdge,
  RiskReport,
  ServiceClassification,
  StablecoinRestrictionProfile,
  WhereIsMoneyReport
} from "../src/types";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";
import { createSelectiveTransactionEnricher } from "../src/forensics/selectiveTransactionEnrichment";

export function buildCalibrationWhereRuntime(input: {
  db: Db;
  tronClient: Pick<TronscanClient, "getRawTransaction" | "getTransaction">;
}) {
  const selectiveTransactionEnricher = createSelectiveTransactionEnricher({
    getSavedEvidence: (identity) => getTransactionProviderEvidence(input.db, identity),
    saveProviderEvidence: (evidence) => saveTransactionProviderEvidence(input.db, evidence),
    saveDecisionEvidence: (evidence) => saveTransactionEnrichmentDecisionEvidence(input.db, evidence),
    getRawTransaction: (txHash) => input.tronClient.getRawTransaction(txHash),
    getFullTransactionInfo: (txHash) => input.tronClient.getTransaction(txHash),
    now: () => new Date()
  });
  return {
    selectiveTransactionEnricher,
    listActiveRouteAssertions: async ({ addresses, txHashes }: { addresses: string[]; txHashes: string[] }) =>
      (await listActiveAddressLabelAssertionsForRoute(input.db, { chain: "tron", addresses, txHashes }))
        .map((assertion) => ({
          chain: assertion.chain,
          address: assertion.address,
          status: assertion.status,
          evidenceJson: assertion.evidenceJson
        })),
    listIndexedMovementsByHashes: async (txHashes: string[]) =>
      (await listIndexedTronUsdtTransfersByHashes(input.db, [...new Set(txHashes)]))
        .map(indexedTransferToRouteEdge)
  };
}

export function calibrationWhereRunOptions(signal: AbortSignal) {
  return {
    mode: "wallet_profile" as const,
    maxDepth: 4,
    beamWidth: 8,
    maxAddressFetches: 60,
    maxEdgesPerAddress: 80,
    recentFallbackMinTransferCount: 100,
    recentFallbackTransferLimit: 100,
    approvalEnrichmentMode: "triggered" as const,
    maxApprovalCandidates: 8,
    maxContractTransactionInfoFetches: 8,
    crossChainStage2Enabled: false,
    abortSignal: signal
  };
}

const DEFAULT_ADDRESSES = [
  "THRSTA7nfbBNsM8tCL4yfA4jsFC4Yw8Pet",
  "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf",
  "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d",
  "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
  "TUzXY779GY3Tm6UDRYDPqNEojZgZEpY127"
];

type ParsedArgs = {
  addresses: string[];
  windowDays: number;
  fastTimeoutMs: number;
  deepTimeoutMs: number;
  whereTimeoutMs: number;
  outDir: string;
};

type LayerResult<T> = {
  ok: true;
  durationMs: number;
  value: T;
} | {
  ok: false;
  durationMs: number;
  error: string;
};

type RuntimeLog = {
  level: "warn" | "error";
  event: string;
  fields?: Record<string, unknown>;
};

type HistoricalJobSummary = {
  id: string;
  kind: string;
  status: string;
  completedAt: string | null;
  score: number | null;
  decision: string | null;
  highlights: string[];
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function numberArg(values: Map<string, string>, key: string, fallback: number): number {
  const raw = values.get(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return Math.round(parsed);
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const addresses: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      addresses.push(item);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${item} requires a value`);
    }
    values.set(item, value);
    index += 1;
  }
  return {
    addresses: addresses.length > 0 ? addresses : DEFAULT_ADDRESSES,
    windowDays: numberArg(values, "--window-days", 90),
    fastTimeoutMs: numberArg(values, "--fast-timeout-ms", 30_000),
    deepTimeoutMs: numberArg(values, "--deep-timeout-ms", 240_000),
    whereTimeoutMs: numberArg(values, "--where-timeout-ms", 240_000),
    outDir: values.get("--out-dir") ?? path.join(repoRoot(), "artifacts", "forensic-calibration")
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rawUsdt(raw: string | null | undefined): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const amount = BigInt(raw);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function compactReasons(report: RiskReport | null | undefined): Array<{ code: string; scoreImpact: number; message: string }> {
  return (report?.reasons ?? []).slice(0, 8).map((reason) => ({
    code: reason.code,
    scoreImpact: reason.scoreImpact,
    message: reason.message
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAbortableLayer<T>(
  label: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<LayerResult<T>> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([run(controller.signal), timeout]);
    return { ok: true, durationMs: Date.now() - startedAt, value };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: timedOut || controller.signal.aborted ? `${label} timed out after ${timeoutMs}ms` : messageFromError(error)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeCalibrationLogger(logs: RuntimeLog[]): Logger {
  const capture = (level: "warn" | "error", event: string, fields?: Record<string, unknown>) => {
    logs.push({ level, event, fields });
    if (event.includes("rate_limit") || event.includes("fallback") || level === "error") {
      defaultLogger[level](event, fields);
    }
  };
  return {
    info: () => undefined,
    warn: (event, fields) => capture("warn", event, fields),
    error: (event, fields) => capture("error", event, fields)
  };
}

function runtimeLogSummary(logs: RuntimeLog[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const log of logs) {
    summary[log.event] = (summary[log.event] ?? 0) + 1;
  }
  return summary;
}

function latestInterestingLogs(logs: RuntimeLog[]): RuntimeLog[] {
  return logs
    .filter((log) =>
      log.event.includes("rate_limit") ||
      log.event.includes("fallback") ||
      log.event.includes("failed") ||
      log.event.includes("400")
    )
    .slice(-20);
}

async function getCachedOrLiveContractProfile(db: Db, tronClient: TronscanClient, address: string) {
  const now = new Date();
  const cached = await getContractIntelligenceProfile(db, address, now);
  if (cached && cached.lowMetadata !== true) return cached;
  const live = await tronClient.getContractIntelligenceProfile(address, { now, requireComplete: true }).catch(() => null);
  if (live) await upsertContractIntelligenceProfile(db, live).catch(() => undefined);
  return live;
}

async function getCachedOrLiveMetadata(db: Db, tronClient: TronscanClient, address: string) {
  const now = new Date();
  const cached = await getAddressMetadata(db, address, now);
  if (cached) return cached;
  const live = await tronClient.getAddressMetadata(address, { requireComplete: true }).catch(() => null);
  if (live) await upsertAddressMetadata(db, live).catch(() => undefined);
  return live;
}

async function getStablecoinState(
  tronClient: TronscanClient,
  cache: Map<string, Promise<StablecoinRestrictionProfile | null>>,
  address: string
): Promise<StablecoinRestrictionProfile | null> {
  if (!cache.has(address)) {
    cache.set(address, tronClient.getUsdtRestrictionStatus(address).catch(() => null));
  }
  return cache.get(address) ?? null;
}

async function historicalJobs(db: Db, address: string): Promise<HistoricalJobSummary[]> {
  const result = await db.query<{
    id: string;
    kind: string;
    status: string;
    completed_at: Date | null;
    progress_json: Record<string, unknown>;
    result_json: Record<string, unknown>;
  }>(
    `
      select id, kind, status, completed_at, progress_json, result_json
      from forensic_check_jobs
      where subject_address = $1
        and status in ('completed', 'partial')
      order by completed_at desc nulls last, created_at desc
      limit 6
    `,
    [address]
  );

  return result.rows.map((row) => {
    const whereReport = row.result_json.whereIsMoneyReport as { riskScore?: unknown; userDecision?: unknown } | undefined;
    const score = typeof whereReport?.riskScore === "number"
      ? whereReport.riskScore
      : typeof row.progress_json.riskScore === "number"
        ? row.progress_json.riskScore
        : null;
    const decision = typeof whereReport?.userDecision === "string"
      ? whereReport.userDecision
      : typeof row.progress_json.decision === "string"
        ? row.progress_json.decision
        : null;
    const serviceProfiles = Array.isArray(row.result_json.serviceExposureProfiles) ? row.result_json.serviceExposureProfiles.length : 0;
    const operationalProfiles = Array.isArray(row.result_json.operationalFlowProfiles) ? row.result_json.operationalFlowProfiles.length : 0;
    const assetProfiles = Array.isArray(row.result_json.assetContinuationProfiles) ? row.result_json.assetContinuationProfiles.length : 0;
    const highlights = [
      serviceProfiles > 0 ? `serviceProfiles=${serviceProfiles}` : null,
      operationalProfiles > 0 ? `operationalProfiles=${operationalProfiles}` : null,
      assetProfiles > 0 ? `assetContinuationProfiles=${assetProfiles}` : null
    ].filter((item): item is string => item !== null);
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      completedAt: row.completed_at?.toISOString() ?? null,
      score,
      decision,
      highlights
    };
  });
}

function summarizeDeep(report: DeepAddressForensicReport) {
  return {
    missingChecks: report.missingChecks,
    serviceExposureProfiles: (report.serviceExposureProfiles ?? []).map((profile) => ({
      score: profile.exposureScore,
      paths: profile.paths?.length ?? 0,
      topLabel: profile.paths?.[0]?.label ?? null
    })),
    addressBehaviorProfiles: (report.addressBehaviorProfiles ?? []).map((profile) => ({
      score: profile.score,
      features: (profile.features ?? []).map((feature) => feature.code)
    })),
    operationalFlowProfiles: (report.operationalFlowProfiles ?? []).map((profile) => ({
      operationalScore: profile.operationalScore,
      historicalTransitScore: profile.historicalTransitScore,
      incomingUsdt: rawUsdt(profile.incomingVolumeRaw),
      outgoingUsdt: rawUsdt(profile.outgoingVolumeRaw),
      bridgeDexRouterOutgoingRatio: profile.bridgeDexRouterOutgoingRatio,
      terminalLiquidityOutgoingRatio: profile.terminalLiquidityOutgoingRatio,
      features: (profile.features ?? []).map((feature) => feature.code)
    })),
    assetContinuationProfiles: (report.assetContinuationProfiles ?? []).map((profile) => ({
      score: profile.score,
      token: profile.continuationAssetSymbol,
      tokenQuality: profile.tokenQuality,
      destinationRisk: profile.destinationRisk.score,
      reasons: profile.reasons
    })),
    boundaryExposureProfiles: (report.boundaryExposureProfiles ?? []).map((profile) => ({
      contextScore: profile.contextScore,
      flows: profile.flows?.length ?? 0
    })),
    walletRoleProfiles: (report.walletRoleProfiles ?? []).map((profile) => ({
      primaryRole: profile.primaryRole,
      roles: (profile.roles ?? []).map((role) => `${role.role}:${role.confidence}`)
    })),
    coverage: report.coverage
  };
}

function summarizeWhere(report: WhereIsMoneyReport) {
  return {
    riskScore: report.riskScore,
    decision: report.userDecision,
    proofLevel: report.proofLevel,
    provenanceScope: report.coverage.provenanceScope,
    partial: report.coverage.partial,
    currentUsdtBalance: rawUsdt(report.currentUsdtBalanceRaw),
    selectedAmount: rawUsdt(report.coverage.selectedAmountRaw),
    selectedInboundTxCount: report.coverage.selectedInboundTxCount,
    fetchedAddressCount: report.coverage.fetchedAddressCount,
    originPathVerdicts: report.originPaths.map((pathItem) => ({
      verdict: pathItem.verdict,
      score: pathItem.riskScore,
      hops: pathItem.hops,
      terminalLabel: pathItem.terminalLabel,
      reason: pathItem.reasons[0] ?? null
    })),
    decisionReasons: report.decisionReasons.slice(0, 8),
    coverageNotes: report.coverage.notes.slice(0, 8)
  };
}

function summarizeUnified(result: ReturnType<typeof calculateUnifiedWalletRisk>) {
  return {
    finalScore: result.finalScore,
    finalLevel: result.finalLevel,
    finalDecision: result.finalDecision,
    weightedLayerScore: result.weightedLayerScore,
    coverageLevel: result.coverageLevel,
    layerBreakdown: result.layerBreakdown,
    activeAnchor: result.scoreBreakdown.activeAnchor,
    floorScore: result.scoreBreakdown.floorScore,
    contextScoreBeforeDampener: result.scoreBreakdown.contextScoreBeforeDampener,
    contextScoreAfterDampener: result.scoreBreakdown.contextScoreAfterDampener,
    dampener: result.scoreBreakdown.dampener,
    reasons: result.reasons.slice(0, 10).map((reason) => ({
      code: reason.code,
      source: reason.source,
      score: reason.score,
      message: reason.message
    }))
  };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

async function writeArtifacts(
  outDir: string,
  runId: string,
  data: Record<string, unknown>,
  md: string
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${runId}.json`), `${JSON.stringify(data, jsonReplacer, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, `${runId}.md`), md, "utf8");
}

function renderMarkdown(runId: string, data: { results: Array<Record<string, unknown>>; startedAt: string; completedAt?: string }): string {
  const lines: string[] = [];
  lines.push(`# Wallet Calibration Fresh Rerun`);
  lines.push("");
  lines.push(`Run: \`${runId}\``);
  lines.push(`Started: ${data.startedAt}`);
  if (data.completedAt) lines.push(`Completed: ${data.completedAt}`);
  lines.push("");
  lines.push("| Address | Fast | Deep raw | Where | Final | Decision | Anchor / comment |");
  lines.push("|---|---:|---:|---:|---:|---|---|");
  for (const item of data.results) {
    const address = String(item.address);
    const fast = item.fast as { ok: boolean; score?: number; level?: string; error?: string } | undefined;
    const deep = item.deep as { ok: boolean; rawScore?: number; error?: string } | undefined;
    const where = item.where as { ok: boolean; riskScore?: number; decision?: string; error?: string } | undefined;
    const unified = item.unified as { finalScore?: number; finalLevel?: string; finalDecision?: string; activeAnchor?: { code?: string } | null } | undefined;
    const fastCell = fast?.ok ? `${fast.score} ${fast.level}` : `ERR ${fast?.error ?? ""}`;
    const deepCell = deep?.ok ? String(deep.rawScore ?? "n/a") : `ERR ${deep?.error ?? ""}`;
    const whereCell = where?.ok ? `${where.riskScore} ${where.decision}` : `ERR ${where?.error ?? ""}`;
    const finalCell = unified ? `${unified.finalScore} ${unified.finalLevel}` : "n/a";
    const decisionCell = unified?.finalDecision ?? "n/a";
    const anchor = unified?.activeAnchor?.code ?? "no anchor";
    lines.push(`| \`${address}\` | ${fastCell} | ${deepCell} | ${whereCell} | ${finalCell} | ${decisionCell} | ${anchor} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Fresh rerun uses the real fast, deep and where check functions with bounded runtime limits.");
  lines.push("- Historical saved jobs are included in the JSON artifact for comparison, but the table above is based on fresh execution.");
  lines.push("- Cross-chain Stage 2 and LLM contract verdicts are disabled in this calibration runner unless added explicitly later.");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = `fresh-wallet-calibration-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const runtimeLogs: RuntimeLog[] = [];
  const runtimeLogger = makeCalibrationLogger(runtimeLogs);
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
    logger: runtimeLogger
  });
  const calibrationWhereRuntime = buildCalibrationWhereRuntime({ db, tronClient });
  const windowEnd = startedAt;
  const windowStart = new Date(windowEnd.getTime() - args.windowDays * 24 * 60 * 60 * 1000);
  const stablecoinStateCache = new Map<string, Promise<StablecoinRestrictionProfile | null>>();
  const fastSignalProvider = createAddressExposureRiskSignalProvider({
    tronClient,
    getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
    upsertAddressMetadata: (metadata) => upsertAddressMetadata(db, metadata),
    getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
    upsertContractIntelligenceProfile: (profile) => upsertContractIntelligenceProfile(db, profile),
    now: () => windowEnd
  }, {
    days: args.windowDays,
    timeoutMs: args.fastTimeoutMs,
    maxDepth: 2,
    maxPagesPerAddress: 1,
    pageLimit: 50,
    limit: 10,
    metadataFetchLimit: 12,
    contractProfileFetchLimit: 6,
    maxExpandedIntermediates: 10,
    recentFallbackMinTransferCount: 100,
    recentFallbackTransferLimit: 100
  });

  const results: Array<Record<string, unknown>> = [];
  const artifactData = {
    runId,
    startedAt: startedAt.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    config: {
      addresses: args.addresses,
      windowDays: args.windowDays,
      fastTimeoutMs: args.fastTimeoutMs,
      deepTimeoutMs: args.deepTimeoutMs,
      whereTimeoutMs: args.whereTimeoutMs
    },
    results,
    runtimeLogs: {
      summary: runtimeLogSummary(runtimeLogs),
      latestInteresting: latestInterestingLogs(runtimeLogs)
    }
  };

  try {
    for (const address of args.addresses) {
      console.log(JSON.stringify({ event: "calibration_address_started", runId, address }));
      const addressStartedAt = Date.now();
      const historical = await historicalJobs(db, address);
      let fastReport: RiskReport | null = null;
      let deepReport: DeepAddressForensicReport | null = null;
      let whereReport: WhereIsMoneyReport | null = null;

      const fast = await runAbortableLayer("fast", args.fastTimeoutMs, async () => {
        const result = await checkAddress(address, {
          getLabelsForAddress: (lookupAddress) => listAddressLabels(db, lookupAddress),
          getRiskSignalsForAddress: fastSignalProvider
        });
        return result.report;
      });
      if (fast.ok) fastReport = fast.value;
      console.log(JSON.stringify({
        event: "calibration_layer_completed",
        runId,
        address,
        layer: "fast",
        ok: fast.ok,
        durationMs: fast.durationMs,
        score: fast.ok ? fast.value.score : null,
        error: fast.ok ? null : fast.error
      }));

      await sleep(1_000);

      const classificationCache = new Map<string, ServiceClassification | null>();
      const getClassificationForAddress = async (lookupAddress: string): Promise<ServiceClassification | null> => {
        if (classificationCache.has(lookupAddress)) return classificationCache.get(lookupAddress) ?? null;
        const metadata = await getCachedOrLiveMetadata(db, tronClient, lookupAddress);
        const contractProfile = metadata?.isContract
          ? await getCachedOrLiveContractProfile(db, tronClient, lookupAddress)
          : null;
        const classification = classifyServiceAddress({ address: lookupAddress, metadata, contractProfile });
        classificationCache.set(lookupAddress, classification);
        return classification;
      };

      const deep = await runAbortableLayer("deep", args.deepTimeoutMs, (signal) =>
        runDeepAddressForensicCheck({
          tronClient,
          getLabelsForAddress: (lookupAddress) => listAddressLabels(db, lookupAddress),
          getAddressMetadata: (lookupAddress) => getCachedOrLiveMetadata(db, tronClient, lookupAddress),
          getContractIntelligenceProfile: (lookupAddress) => getCachedOrLiveContractProfile(db, tronClient, lookupAddress),
          getUsdtRestrictionStatus: (lookupAddress, options) => tronClient.getUsdtRestrictionStatus(lookupAddress, options),
          listIndexedUsdtTransfersForAddress: (lookupAddress, options) => listIndexedTronUsdtTransfersForAddress(db, {
            address: lookupAddress,
            minTimestamp: options.minTimestamp,
            maxTimestamp: options.maxTimestamp,
            limit: options.limit,
            offset: options.offset,
            orderBy: options.orderBy
          })
        }, {
          sourceAddress: address,
          windowStart,
          windowEnd,
          maxDepth: 1,
          maxPagesPerAddress: 1,
          pageLimit: 50,
          limit: 10,
          maxExpandedIntermediates: 0,
          metadataFetchLimit: 0,
          contractProfileFetchLimit: 0,
          maxInboundSenders: 0,
          maxApprovalDrainCandidates: 0,
          approvalChangeLookupLimit: 0,
          extendedSearchMode: "disabled",
          extendedSearchMaxDepth: 2,
          extendedSearchBeamWidth: 4,
          extendedSearchMaxAddressFetches: 10,
          recentFallbackMinTransferCount: 100,
          recentFallbackTransferLimit: 100,
          counterpartyFastSnapshotLimit: 0,
          counterpartyFastSnapshotActiveLimit: 0,
          assetContinuationTransferLimit: 100,
          apiKeyConfigured: config.tronscanApiKeys.length > 0,
          abortSignal: signal
        })
      );
      if (deep.ok) deepReport = deep.value;
      console.log(JSON.stringify({
        event: "calibration_layer_completed",
        runId,
        address,
        layer: "deep",
        ok: deep.ok,
        durationMs: deep.durationMs,
        operationalProfiles: deep.ok ? (deep.value.operationalFlowProfiles ?? []).length : null,
        assetProfiles: deep.ok ? (deep.value.assetContinuationProfiles ?? []).length : null,
        error: deep.ok ? null : deep.error
      }));

      await sleep(1_000);

      const edgeCache = new Map<string, ForensicRouteEdge[]>();
      const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
      const fetchEdgesForAddress = async (lookupAddress: string): Promise<ForensicRouteEdge[]> => {
        if (edgeCache.has(lookupAddress)) return edgeCache.get(lookupAddress) ?? [];
        const indexedLimit = whereIsMoneyIndexedFetchLimit(80);
        const indexedTransfers = await listIndexedTronUsdtTransfersForAddress(db, {
          address: lookupAddress,
          minTimestamp: windowStart,
          maxTimestamp: windowEnd,
          direction: "both",
          limit: indexedLimit,
          orderBy: "newest"
        });
        const indexedEdges = indexedTransfers.map(indexedTransferToRouteEdge);
        const liveEdges = indexedEdges.length === 0
          ? (await tronClient.listRelatedTrc20Transfers(lookupAddress, {
              start: 0,
              limit: 80,
              minTimestamp: windowStart.getTime(),
              endTimestamp: windowEnd.getTime()
            }).catch(() => []))
              .map(normalizeTransfer)
              .filter((edge): edge is ForensicRouteEdge => edge !== null)
          : [];
        const edges = indexedEdges.length > 0 ? indexedEdges : liveEdges;
        edgeCache.set(lookupAddress, edges);
        return edges;
      };
      const fetchLatestEdgesForAddress = async (lookupAddress: string, limit: number): Promise<ForensicRouteEdge[]> => {
        const liveLimit = whereIsMoneyLiveFallbackLimit(limit, 80);
        const cacheKey = whereIsMoneyLatestFallbackCacheKey(lookupAddress, limit, liveLimit);
        if (latestEdgeCache.has(cacheKey)) return latestEdgeCache.get(cacheKey) ?? [];
        const transfers = await tronClient.listRelatedTrc20Transfers(lookupAddress, {
          start: 0,
          limit: liveLimit
        }).catch(() => []);
        const edges = transfers
          .map(normalizeTransfer)
          .filter((edge): edge is ForensicRouteEdge => edge !== null);
        latestEdgeCache.set(cacheKey, edges);
        return edges;
      };
      const getFastWalletRisk = async (lookupAddress: string): Promise<RiskReport | null> => {
        if (lookupAddress === address && fastReport) return fastReport;
        const labels = await listAddressLabels(db, lookupAddress);
        const stablecoinState = await getStablecoinState(tronClient, stablecoinStateCache, lookupAddress);
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
        return checkAddress(lookupAddress, {
          getLabelsForAddress: async () => labels,
          getRiskSignalsForAddress: async () => ({ graphSignals: [], behaviorSignals: [], amlSignals })
        }).then((result) => result.report);
      };
      const where = await runAbortableLayer("where", args.whereTimeoutMs, (signal) =>
        runWhereIsMoneyCheck({
          getTrc20Balance: async (lookupAddress, tokenContractAddress) => {
            if (tokenContractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
            const state = await getStablecoinState(tronClient, stablecoinStateCache, lookupAddress);
            return state?.balanceRaw ?? null;
          },
          fetchEdgesForAddress,
          fetchLatestEdgesForAddress,
          getLabelsForAddress: (lookupAddress) => listAddressLabels(db, lookupAddress),
          getClassificationForAddress,
          getFastWalletRisk,
          ...calibrationWhereRuntime,
          listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
          getUsdtRestrictionStatus: (lookupAddress, options) => tronClient.getUsdtRestrictionStatus(lookupAddress, options),
          getContractIntelligenceProfile: (lookupAddress) => getCachedOrLiveContractProfile(db, tronClient, lookupAddress)
        }, {
          sourceAddress: address,
          windowStart,
          windowEnd,
          ...calibrationWhereRunOptions(signal),
          deepServiceExposureProfiles: deepReport?.serviceExposureProfiles ?? [],
        })
      );
      if (where.ok) whereReport = where.value;
      console.log(JSON.stringify({
        event: "calibration_layer_completed",
        runId,
        address,
        layer: "where",
        ok: where.ok,
        durationMs: where.durationMs,
        score: where.ok ? where.value.riskScore : null,
        decision: where.ok ? where.value.userDecision : null,
        error: where.ok ? null : where.error
      }));

      const unified = fastReport && whereReport
        ? calculateUnifiedWalletRisk({
            address,
            fastReport,
            deepReport,
            whereReport
          })
        : null;

      const item: Record<string, unknown> = {
        address,
        durationMs: Date.now() - addressStartedAt,
        historical,
        fast: fast.ok
          ? {
              ok: true,
              durationMs: fast.durationMs,
              score: fast.value.score,
              level: fast.value.level,
              reasons: compactReasons(fast.value)
            }
          : { ok: false, durationMs: fast.durationMs, error: fast.error },
        deep: deep.ok
          ? {
              ok: true,
              durationMs: deep.durationMs,
              rawScore: unified?.layerBreakdown.deep.rawScore ?? null,
              ...summarizeDeep(deep.value)
            }
          : { ok: false, durationMs: deep.durationMs, error: deep.error },
        where: where.ok
          ? {
              ok: true,
              durationMs: where.durationMs,
              ...summarizeWhere(where.value)
            }
          : { ok: false, durationMs: where.durationMs, error: where.error },
        unified: unified ? summarizeUnified(unified) : null
      };
      results.push(item);
      artifactData.runtimeLogs = {
        summary: runtimeLogSummary(runtimeLogs),
        latestInteresting: latestInterestingLogs(runtimeLogs)
      };
      await writeArtifacts(args.outDir, runId, artifactData, renderMarkdown(runId, artifactData));
      console.log(JSON.stringify({
        event: "calibration_address_completed",
        runId,
        address,
        finalScore: unified?.finalScore ?? null,
        finalDecision: unified?.finalDecision ?? null,
        artifact: path.join(args.outDir, `${runId}.md`)
      }));
    }
  } finally {
    artifactData.runtimeLogs = {
      summary: runtimeLogSummary(runtimeLogs),
      latestInteresting: latestInterestingLogs(runtimeLogs)
    };
    (artifactData as { completedAt?: string }).completedAt = new Date().toISOString();
    await writeArtifacts(args.outDir, runId, artifactData, renderMarkdown(runId, artifactData));
    await closeDb(db);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "calibration_run_failed", error: messageFromError(error) }));
    process.exitCode = 1;
  });
}
