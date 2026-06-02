import "dotenv/config";
import { runWhereIsMoneyCheck } from "../src/check/whereIsMoneyCheck";
import { evaluateAddressRisk } from "../src/risk/evaluation";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  getContractLlmVerdictCache,
  getContractLlmVerdictCacheByFingerprint,
  listAddressLabels,
  listIndexedTronUsdtTransfersForAddress,
  upsertContractIntelligenceProfile,
  upsertContractLlmVerdictCache
} from "../src/storage/repositories";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { normalizeTransfer } from "../src/forensics/routeSearch";
import { parseWhereIsMoneyCliArgs } from "../src/forensics/whereIsMoneyCliArgs";
import { createContractLlmVerdictAnalyzer } from "../src/forensics/contractLlmVerdict";
import { createEtherscanV2EvmEvidenceProvider } from "../src/forensics/evmExplorerClient";
import { withLlmEnrichmentRetry } from "../src/forensics/llmEnrichmentRetry";
import { createRangeCrossChainDiscoveryProvider, RANGE_ENDPOINT_PATHS } from "../src/forensics/rangeClient";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";
import { createOpenAiCompatibleJsonClient } from "../src/llm/openAiCompatibleJsonClient";
import { proofLevelTitle } from "../src/risk/proofLevels";
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

function formatOptionalPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value) : "not calculated";
}

function provenanceScopeLabel(scope: string | null | undefined): string {
  if (scope === "recent_flow") return "Recent flow provenance";
  if (scope === "requested_amount") return "Requested amount provenance";
  if (scope === "transaction_seed") return "Transaction-seeded provenance";
  return "Current balance provenance";
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
const crossChainStage2Enabled = config.crossChainStage2Enabled || args.crossChainStage2Enabled || args.crossChainManualDeepMode;
const crossChainMaxProviderCalls = args.crossChainMaxProviderCalls ?? config.crossChainStage2MaxProviderCalls;
const crossChainDiscoveryProvider = crossChainStage2Enabled && config.rangeApiKey
  ? createRangeCrossChainDiscoveryProvider({
      apiKey: config.rangeApiKey,
      baseUrl: config.rangeBaseUrl,
      timeoutMs: config.rangeTimeoutMs,
      endpointPaths: RANGE_ENDPOINT_PATHS,
      allowUndocumentedRawAmountFields: true
    })
  : undefined;
const evmEvidenceProvider = crossChainStage2Enabled && config.evmExplorerApiKey
  ? createEtherscanV2EvmEvidenceProvider({
      apiKey: config.evmExplorerApiKey,
      baseUrl: config.evmExplorerBaseUrl,
      timeoutMs: config.evmExplorerTimeoutMs,
      maxPagesPerQuery: config.evmExplorerMaxCallsPerCheck
    })
  : undefined;
const db = createDb(databaseUrlFromEnvironment());
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
  apiKeys: config.tronscanApiKeys
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

const edgeCache = new Map<string, ForensicRouteEdge[]>();
const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
const classificationCache = new Map<string, ServiceClassification | null>();
const stablecoinStateCache = new Map<string, Promise<StablecoinRestrictionProfile | null>>();
const contractLlmVerdictAnalyzer = config.llmContractAnalysisEnabled && config.llmApiKey
  ? createContractLlmVerdictAnalyzer({
      client: createOpenAiCompatibleJsonClient({
        apiKey: config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model: config.llmModel,
        ...(config.llmProviderLabel.toLowerCase() === "deepseek"
          ? {
              thinkingEnabled: config.llmThinkingEnabled,
              reasoningEffort: config.llmReasoningEffort
            }
          : {}),
        providerLabel: config.llmProviderLabel,
        timeoutMs: config.llmTimeoutMs,
        maxRetries: config.llmMaxRetries
      }),
      providerLabel: config.llmProviderLabel,
      model: config.llmModel,
      cacheModelKey: config.llmModelCacheKey,
      cacheTtlMs: config.llmCacheTtlMs,
      requireCompleteCaseFile: true,
      getCachedVerdict: (input) => getContractLlmVerdictCache(db, input),
      getCachedVerdictByFingerprint: (input) => getContractLlmVerdictCacheByFingerprint(db, input),
      upsertVerdict: (input) => upsertContractLlmVerdictCache(db, input)
    })
  : undefined;

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}

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
  const indexedEdges = transfers.map(indexedTransferToRouteEdge);
  const liveWindowEdges = indexedEdges.length === 0
    ? (await tronClient.listRelatedTrc20Transfers(address, {
        start: 0,
        limit: args.maxEdgesPerAddress,
        minTimestamp: args.windowStart.getTime(),
        endTimestamp: args.windowEnd.getTime()
      }).catch(() => []))
        .map(normalizeTransfer)
        .filter((edge): edge is ForensicRouteEdge => edge !== null)
    : [];
  const edges = indexedEdges.length > 0 ? indexedEdges : liveWindowEdges;
  edgeCache.set(address, edges);
  return edges;
}

async function fetchLatestEdgesForAddress(address: string, limit: number): Promise<ForensicRouteEdge[]> {
  const cacheKey = `${address}:${limit}`;
  if (latestEdgeCache.has(cacheKey)) return latestEdgeCache.get(cacheKey) ?? [];
  const transfers = await tronClient.listRelatedTrc20Transfers(address, {
    start: 0,
    limit
  }).catch(() => []);
  const edges = transfers
    .map(normalizeTransfer)
    .filter((edge): edge is ForensicRouteEdge => edge !== null);
  latestEdgeCache.set(cacheKey, edges);
  return edges;
}

async function getClassificationForAddress(address: string): Promise<ServiceClassification | null> {
  if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
  const metadata = await getAddressMetadata(db, address, new Date())
    ?? await withLlmEnrichmentRetry({
      label: "address_metadata",
      address,
      maxAttempts: config.llmEnrichmentMaxAttempts,
      retryDelayMs: config.llmEnrichmentRetryDelayMs
    }, () => tronClient.getAddressMetadata(address, { requireComplete: true })).catch(() => null);
  const contractProfile = metadata?.isContract
    ? await getCachedOrLiveContractProfile(address)
    : null;
  const classification = classifyServiceAddress({ address, metadata, contractProfile });
  classificationCache.set(address, classification);
  return classification;
}

async function getCachedOrLiveContractProfile(address: string) {
  const now = new Date();
  const cached = await getContractIntelligenceProfile(db, address, now);
  if (cached && cached.lowMetadata !== true) return cached;
  const live = await withLlmEnrichmentRetry({
    label: "contract_profile",
    address,
    maxAttempts: config.llmEnrichmentMaxAttempts,
    retryDelayMs: config.llmEnrichmentRetryDelayMs
  }, () => tronClient.getContractIntelligenceProfile(address, { now, requireComplete: true })).catch(() => null);
  if (live) await upsertContractIntelligenceProfile(db, live).catch(() => undefined);
  return live;
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
    fetchLatestEdgesForAddress,
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getClassificationForAddress,
    getTransaction: (txHash) => tronClient.getTransaction(txHash),
    listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
    getUsdtRestrictionStatus: (address, options) => tronClient.getUsdtRestrictionStatus(address, options),
    getContractIntelligenceProfile: (address) => getCachedOrLiveContractProfile(address),
    analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer,
    crossChainDiscoveryProvider,
    evmEvidenceProvider,
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
    requestedAmountRaw: args.requestedAmountRaw,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    maxDepth: args.depth,
    beamWidth: args.beamWidth,
    maxAddressFetches: args.maxAddressFetches,
    maxEdgesPerAddress: args.maxEdgesPerAddress,
    approvalEnrichmentMode: args.approvalEnrichmentMode,
    maxApprovalCandidates: args.maxApprovalCandidates,
    maxContractTransactionInfoFetches: args.maxContractTransactionInfoFetches,
    contractTransactionInfoMinIntervalMs: args.contractTransactionInfoMinIntervalMs,
    crossChainStage2Enabled,
    crossChainManualDeepMode: args.crossChainManualDeepMode,
    crossChainMaxProviderCalls
  });

  console.log(`Subject: ${report.subjectAddress}`);
  console.log(`Window: ${args.windowStart.toISOString()} -> ${args.windowEnd.toISOString()}`);
  console.log(`Current USDT balance: ${formatRawUsdt(report.currentUsdtBalanceRaw)}`);
  if (report.coverage.requestedAmountRaw) {
    console.log(`Requested amount: ${formatRawUsdt(report.coverage.requestedAmountRaw)}`);
  }
  console.log(`Target amount: ${formatRawUsdt(report.coverage.targetAmountRaw)}`);
  console.log(`Provenance scope: ${provenanceScopeLabel(report.coverage.provenanceScope)}`);
  if (report.coverage.anchorTransfer) {
    const anchor = report.coverage.anchorTransfer;
    console.log(`Anchor: ${anchor.direction} ${formatRawUsdt(anchor.amountRaw)} | ${anchor.txHash} | ${anchor.reason}`);
  }
  if (report.coverage.dataScopeNote) {
    console.log(`Data scope: ${report.coverage.dataScopeNote}`);
  }
  const transferLabel = report.coverage.provenanceScope === "recent_flow"
    ? "Recent-flow funding transfers"
    : "Balance-forming transfers";
  const coverageText = report.coverage.provenanceScope === "recent_flow"
    ? `${formatOptionalPercent(report.coverage.coverageRatio)} of recent-flow anchor`
    : `${formatOptionalPercent(report.coverage.coverageRatio)} of target (${formatOptionalPercent(report.coverage.currentBalanceCoverageRatio)} of current balance)`;
  console.log(`${transferLabel}: ${report.coverage.selectedInboundTxCount} txs, covering ${coverageText}`);
  console.log(`Decision: ${report.decision}`);
  console.log(`Internal decision: ${report.internalDecision}`);
  console.log(`User decision: ${report.userDecision}`);
  console.log(`Evidence type: ${proofLevelTitle(report.proofLevel)} (${report.proofLevel})`);
  console.log(`Risk: ${report.riskScore}/100 ${report.assessment.riskBand}`);
  console.log(`Risk band: ${report.assessment.riskBand}`);
  console.log(`Provenance confidence: ${report.assessment.provenanceConfidence}/100`);
  console.log(`Coverage completeness: ${report.assessment.coverageCompleteness}/100`);
  console.log(`Wallet role: ${report.assessment.walletRole}`);
  console.log(`Operational liquidity score: ${report.assessment.operationalLiquidityScore}/100`);
  console.log(`Wallet age: ${report.assessment.ageSignals?.subjectAgeDays ?? "unknown"} observed day(s)`);
  console.log(`Repeated sender relationships: ${report.assessment.ageSignals?.repeatedRelationshipCount ?? 0}`);
  console.log(`Hard bad evidence: ${report.assessment.hardBadEvidence.length === 0 ? "none" : report.assessment.hardBadEvidence.map((item) => item.kind).join(", ")}`);
  console.log("");
  console.log("Main reasons:");
  if (report.decisionReasons.length === 0) {
    console.log("- none");
  }
  for (const reason of report.decisionReasons) {
    console.log(`- ${reason}`);
  }

  console.log("");
  console.log("AI contract verdicts:");
  const contractVerdicts = report.contractLlmVerdicts ?? [];
  if (contractVerdicts.length === 0) {
    console.log("- none");
  }
  for (const verdict of contractVerdicts) {
    const confidence = `${Math.round(verdict.confidence * 100)}%`;
    const cache = verdict.source === "cache"
      ? ` cache=${verdict.cacheMatch ?? "unknown"}${verdict.reusedFromContractAddress ? ` reusedFrom=${verdict.reusedFromContractAddress}` : ""}`
      : "";
    console.log(`- ${verdict.contractAddress ?? "unknown"} | ${verdict.verdict} | ${verdict.contractRiskScore}/100 | ${confidence} | ${verdict.decisionRecommendation} | source=${verdict.source}${cache}`);
    for (const reason of verdict.reasons.slice(0, 3)) {
      console.log(`  reason: ${reason}`);
    }
    for (const note of verdict.falsePositiveNotes.slice(0, 2)) {
      console.log(`  false-positive note: ${note}`);
    }
    if (verdict.error) {
      console.log(`  error: ${verdict.error}`);
    }
  }

  console.log("");
  console.log(report.coverage.provenanceScope === "recent_flow"
    ? "Recent-flow funding transfers:"
    : "Balance-forming transfers:");
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
    for (const step of path.steps) {
      console.log(`  step: ${step.fromAddress} -> ${step.toAddress} | ${formatRawUsdt(step.amountRaw)} | ${step.timestamp} | ${step.txHash}`);
    }
    console.log(`  preservation: ${formatPercent(path.amountPreservationRatio)}`);
  }

  console.log("");
  console.log("Sender interaction profiles:");
  if (report.senderInteractionProfiles.length === 0) {
    console.log("- none");
  }
  for (const profile of report.senderInteractionProfiles) {
    console.log(`- ${profile.senderAddress} | balance tx ${profile.balanceTransferTxHash}`);
    console.log(`  incoming: ${formatRawUsdt(profile.incomingVolumeRaw)} across ${profile.incomingTxCount} txs`);
    console.log(`  outgoing: ${formatRawUsdt(profile.outgoingVolumeRaw)} across ${profile.outgoingTxCount} txs`);
    console.log("  funding candidates:");
    if (profile.fundingCandidates.length === 0) {
      console.log("  - none");
    }
    for (const candidate of profile.fundingCandidates.slice(0, 6)) {
      console.log(`  - ${candidate.fromAddress} -> ${candidate.toAddress} | ${formatRawUsdt(candidate.amountRaw)} | ${formatPercent(candidate.amountPreservationRatio)} preservation | ${candidate.timestamp} | ${candidate.txHash}`);
    }
    console.log("  top incoming counterparties:");
    if (profile.topIncomingCounterparties.length === 0) {
      console.log("  - none");
    }
    for (const counterparty of profile.topIncomingCounterparties.slice(0, 5)) {
      console.log(`  - ${counterparty.address} | ${formatRawUsdt(counterparty.volumeRaw)} | ${counterparty.txCount} txs | latest ${counterparty.lastSeen}`);
    }
    console.log("  top outgoing counterparties:");
    if (profile.topOutgoingCounterparties.length === 0) {
      console.log("  - none");
    }
    for (const counterparty of profile.topOutgoingCounterparties.slice(0, 5)) {
      console.log(`  - ${counterparty.address} | ${formatRawUsdt(counterparty.volumeRaw)} | ${counterparty.txCount} txs | latest ${counterparty.lastSeen}`);
    }
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
