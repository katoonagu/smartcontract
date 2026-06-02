import { runDeepAddressForensicCheck, type DeepAddressForensicDeps, type DeepAddressForensicReport } from "../check/deepForensicCheck";
import { runWhereIsMoneyCheck } from "../check/whereIsMoneyCheck";
import { FORENSIC_ROUTE_POLICY_VERSION } from "./routeScorer";
import { indexedTransferToRouteEdge } from "./localTronUsdtIndex";
import { normalizeTransfer } from "./routeSearch";
import { classifyServiceAddress } from "./serviceClassifier";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { ChainContinuationProvider } from "./crossChainContinuationTypes";
import type { EvmEvidenceProvider } from "./evmExplorerClient";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../storage/repositories";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ApprovalDrainProvenanceProfile, BalanceFormingTransfer, ContractAnalysisCaseFile, ContractLlmVerdictSummary, CounterpartyRiskProfile, ForensicRouteEdge, InboundProvenancePath, MoneyOriginTraceHistoryCoverage, RawEvidenceInput, RiskLevel, RiskReport, RiskSignalObservationInput, ServiceClassification, StablecoinRestrictionProfile, WhereIsMoneyReport } from "../types";

export type DeepForensicJobRunnerDeps = DeepAddressForensicDeps & {
  getUsdtRestrictionStatus(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: {
    id: string;
    status: "completed" | "partial" | "failed";
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: string | null;
  }): Promise<boolean>;
  recordRiskEvaluation(input: {
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }): Promise<void>;
  upsertAddressLabelAssertion?(input: AddressLabelAssertionInput): Promise<unknown>;
  analyzeContractLlmCaseFiles?(caseFiles: ContractAnalysisCaseFile[]): Promise<ContractLlmVerdictSummary[]>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
  sendJobResult?(job: ForensicCheckJob, report: DeepAddressForensicReport, status: "completed" | "partial"): Promise<void>;
  sendWhereIsMoneyJobResult?(job: ForensicCheckJob, report: WhereIsMoneyReport, status: "completed" | "partial"): Promise<void>;
  sendJobFailure?(job: ForensicCheckJob, error: string): Promise<void>;
  logger?: Logger;
};

export type DeepForensicJobRunnerOptions = {
  pageLimit?: number;
  maxPagesPerAddress?: number;
  maxExpandedIntermediates?: number;
  metadataFetchLimit?: number;
  contractProfileFetchLimit?: number;
  maxInboundSenders?: number;
  maxApprovalDrainCandidates?: number;
  approvalChangeLookupLimit?: number;
  extendedSearchMode?: "disabled" | "auto" | "always";
  extendedSearchMaxDepth?: number;
  extendedSearchBeamWidth?: number;
  extendedSearchMaxAddressFetches?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
  crossChainStage2Enabled?: boolean;
  crossChainManualDeepMode?: boolean;
  crossChainMaxProviderCalls?: number;
  apiKeyConfigured?: boolean;
};

type DerivedLabelResult = {
  label: "darknet_exchange_proximity" | "approval_drain_proximity";
  assertionId: string;
} | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rawAmountField(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n ? value : null;
}

function booleanField(value: unknown): boolean {
  return value === true;
}

function seedTransfersField(value: unknown): BalanceFormingTransfer[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const transfers = value.filter((item): item is BalanceFormingTransfer => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const transfer = item as Record<string, unknown>;
    return typeof transfer.txHash === "string" &&
      typeof transfer.fromAddress === "string" &&
      typeof transfer.toAddress === "string" &&
      typeof transfer.amountRaw === "string" &&
      /^\d+$/.test(transfer.amountRaw) &&
      typeof transfer.timestamp === "string" &&
      typeof transfer.coverageShare === "number" &&
      transfer.selectedReason === "covers_current_balance";
  });
  return transfers.length > 0 ? transfers : undefined;
}

function shouldRunCrossChainStage2ForJob(
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions
): boolean {
  if (options.crossChainStage2Enabled !== true) return false;
  if (options.crossChainManualDeepMode === true) return true;
  if (booleanField(job.progressJson.crossChainStage2Enabled)) return true;
  if (booleanField(job.progressJson.crossChainManualDeepMode)) return true;
  if (rawAmountField(job.progressJson.requestedAmountRaw)) return true;
  return seedTransfersField(job.progressJson.seedTransfers) !== undefined;
}

async function sendDeepForensicJobResultBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial"
): Promise<void> {
  if (!deps.sendJobResult) return;
  try {
    await deps.sendJobResult(job, report, status);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("deep_forensic_job_result_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      status,
      error: errorMessage(error)
    });
  }
}

async function sendWhereIsMoneyJobResultBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial"
): Promise<void> {
  if (!deps.sendWhereIsMoneyJobResult) return;
  try {
    await deps.sendWhereIsMoneyJobResult(job, report, status);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("where_is_money_job_result_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      status,
      error: errorMessage(error)
    });
  }
}

async function sendDeepForensicJobFailureBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  message: string
): Promise<void> {
  if (!deps.sendJobFailure) return;
  try {
    await deps.sendJobFailure(job, message);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("deep_forensic_job_failure_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      original_error: message,
      error: errorMessage(error)
    });
  }
}

function topDarknetExchangePath(report: DeepAddressForensicReport): InboundProvenancePath | null {
  const profile = report.inboundProvenanceProfiles[0] ?? null;
  const path = profile?.paths[0] ?? null;
  if (!profile || !path) return null;
  if (profile.score <= 0 || path.label !== "darknet_exchange") return null;
  if (path.depth > 2 || path.amountPreservationRatio < 0.7) return null;
  return path;
}

function topHighRiskCounterpartyProfile(report: DeepAddressForensicReport): CounterpartyRiskProfile | null {
  return report.counterpartyRiskProfiles.find((profile) =>
    profile.score > 0 && (profile.label === "darknet_exchange" || profile.label === "darknet_exchange_proximity")
  ) ?? null;
}

async function persistDerivedDarknetExchangeProximityLabel(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport
): Promise<DerivedLabelResult> {
  if (!deps.upsertAddressLabelAssertion) return null;
  const path = topDarknetExchangePath(report);
  const counterpartyProfile = path ? null : topHighRiskCounterpartyProfile(report);
  if (!path && !counterpartyProfile) return null;

  const inboundProfile = report.inboundProvenanceProfiles[0];
  const rawEvidenceId = path
    ? report.rawEvidence.find((evidence) => "inboundProvenanceProfile" in evidence.evidenceJson)?.id ?? null
    : report.rawEvidence.find((evidence) => "counterpartyRiskProfile" in evidence.evidenceJson)?.id ?? null;
  const observationId = path
    ? report.observations.find((observation) => observation.code === "forensic_darknet_exchange_provenance")?.id ?? null
    : report.observations.find((observation) => observation.code.startsWith("forensic_counterparty_darknet_exchange"))?.id ?? null;
  const assertionId = `derived_tron_darknet_exchange_proximity_${report.subjectAddress}`;
  const firstSeenAt = path?.firstTransferAt ?? counterpartyProfile?.firstTransferAt;
  const lastSeenAt = path?.lastTransferAt ?? counterpartyProfile?.lastTransferAt;

  await deps.upsertAddressLabelAssertion({
    id: assertionId,
    chain: "tron",
    address: report.subjectAddress,
    label: "darknet_exchange_proximity",
    entityName: "Derived darknet exchange proximity",
    category: "darknet_exchange_proximity",
    confidence: "high",
    severity: "high",
    status: "active",
    sourceName: "forensic_route_search",
    sourceUrl: null,
    notes: "System-derived marker from exact TRON USDT exposure to a manually verified darknet exchange seed or derived high-risk counterparty.",
    evidenceJson: {
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      phase: "10A.8",
      source: "forensic_route_search",
      subjectAddress: report.subjectAddress,
      ...(path ? {
        seedAddress: path.sourceAddress,
        hopDepth: path.depth,
        viaAddresses: path.viaAddresses,
        txHashes: path.txHashes,
        amountRaw: path.amountRaw,
        amountPreservationRatio: path.amountPreservationRatio,
        matchedInboundVolumeRaw: inboundProfile?.matchedInboundVolumeRaw ?? "0"
      } : {
        counterpartyAddress: counterpartyProfile?.counterpartyAddress,
        counterpartyLabel: counterpartyProfile?.label,
        direction: counterpartyProfile?.direction,
        txHashes: counterpartyProfile?.txHashes ?? [],
        amountRaw: counterpartyProfile?.amountRaw ?? "0",
        volumeRatio: counterpartyProfile?.volumeRatio ?? 0,
        txCount: counterpartyProfile?.txCount ?? 0
      }),
      firstTransferAt: firstSeenAt,
      lastTransferAt: lastSeenAt,
      windowStart: report.windowStart.toISOString(),
      windowEnd: report.windowEnd.toISOString(),
      rawEvidenceId,
      observationId,
      jobId: job.id
    },
    createdByTelegramId: null,
    derivedLabelSource: "system",
    firstSeenAt: new Date(firstSeenAt ?? report.windowStart.toISOString()),
    lastSeenAt: new Date(lastSeenAt ?? report.windowEnd.toISOString())
  });

  return {
    label: "darknet_exchange_proximity",
    assertionId
  };
}

function topApprovalDrainProfile(report: DeepAddressForensicReport): ApprovalDrainProvenanceProfile | null {
  return report.approvalDrainProvenanceProfiles.find((profile) => profile.score > 0) ?? null;
}

async function persistDerivedApprovalDrainProximityLabel(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport
): Promise<DerivedLabelResult> {
  if (!deps.upsertAddressLabelAssertion) return null;
  const profile = topApprovalDrainProfile(report);
  if (!profile) return null;
  const rawEvidenceId = report.rawEvidence.find((evidence) => "approvalDrainProvenanceProfile" in evidence.evidenceJson)?.id ?? null;
  const observationId = report.observations.find((observation) => observation.code === "forensic_approval_drain_provenance")?.id ?? null;
  const assertionId = `derived_tron_approval_drain_proximity_${report.subjectAddress}`;

  await deps.upsertAddressLabelAssertion({
    id: assertionId,
    chain: "tron",
    address: report.subjectAddress,
    label: "approval_drain_proximity",
    entityName: "Derived approval-drain proximity",
    category: "approval_drain_proximity",
    confidence: "high",
    severity: profile.score >= 90 ? "critical" : "high",
    status: "active",
    sourceName: "forensic_route_search",
    sourceUrl: null,
    notes: "System-derived marker from exact TRON USDT approval-drain provenance linked to this address.",
    evidenceJson: {
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      phase: "10A.10",
      source: "forensic_route_search",
      subjectAddress: report.subjectAddress,
      victimAddress: profile.victimAddress,
      spenderAddress: profile.spenderAddress,
      firstReceiverAddress: profile.firstReceiverAddress,
      hopDepth: profile.hopDepth,
      approvalTxHash: profile.approvalTxHash,
      drainTxHash: profile.drainTxHash,
      pathTxHashes: profile.pathTxHashes,
      pathAddresses: profile.pathAddresses,
      amountRaw: profile.amountRaw,
      amountPreservationRatio: profile.amountPreservationRatio,
      score: profile.score,
      evidenceStrength: profile.evidenceStrength,
      approvalAt: profile.approvalAt,
      drainAt: profile.drainAt,
      windowStart: report.windowStart.toISOString(),
      windowEnd: report.windowEnd.toISOString(),
      rawEvidenceId,
      observationId,
      jobId: job.id
    },
    createdByTelegramId: null,
    derivedLabelSource: "system",
    firstSeenAt: new Date(profile.approvalAt),
    lastSeenAt: new Date(profile.drainAt)
  });

  return {
    label: "approval_drain_proximity",
    assertionId
  };
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function fastRiskReportFromJob(job: ForensicCheckJob): RiskReport | null {
  const snapshot = job.progressJson.fastRiskSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const score = (snapshot as Record<string, unknown>).score;
  const level = (snapshot as Record<string, unknown>).level;
  if (typeof score !== "number" || !isRiskLevel(level)) return null;
  return {
    subjectAddress: job.subjectAddress,
    score,
    level,
    reasons: []
  };
}

function dedupeRouteEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}

function historyCoverageSource(input: {
  indexedEdgeCount: number;
  liveEdgeCount: number;
}): MoneyOriginTraceHistoryCoverage["source"] {
  if (input.indexedEdgeCount > 0 && input.liveEdgeCount > 0) return "mixed";
  if (input.indexedEdgeCount > 0) return "local_index";
  if (input.liveEdgeCount > 0) return "live";
  return "unknown";
}

function oldestRouteEdgeTimestamp(edges: ForensicRouteEdge[]): Date | null {
  const timestamps = edges
    .map((edge) => edge.timestamp.getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps));
}

async function runWhereIsMoneyJob(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions
): Promise<boolean> {
  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const historyCoverageCache = new Map<string, MoneyOriginTraceHistoryCoverage>();
  const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
  const classificationCache = new Map<string, ServiceClassification | null>();
  const maxEdgesPerAddress = options.recentFallbackTransferLimit ?? 60;
  const edgeFetchLimit = Math.max(200, maxEdgesPerAddress);

  const edgeCacheKey = (address: string, maxTimestamp: Date): string =>
    maxTimestamp.getTime() === job.windowEnd.getTime()
      ? address
      : `${address}:${maxTimestamp.getTime()}`;

  const maxTimestampForFetch = (fetchOptions: { latestTimestamp?: Date } = {}): Date =>
    fetchOptions.latestTimestamp && fetchOptions.latestTimestamp < job.windowEnd
      ? fetchOptions.latestTimestamp
      : job.windowEnd;

  const fetchEdgesForAddress = async (address: string, fetchOptions: { latestTimestamp?: Date } = {}): Promise<ForensicRouteEdge[]> => {
    const maxTimestamp = maxTimestampForFetch(fetchOptions);
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    if (edgeCache.has(cacheKey)) return edgeCache.get(cacheKey) ?? [];
    const indexedTransfers = await deps.listIndexedUsdtTransfersForAddress?.(address, {
      minTimestamp: job.windowStart,
      maxTimestamp,
      limit: edgeFetchLimit,
      orderBy: "newest"
    }).catch(() => []) ?? [];
    const indexedEdges = indexedTransfers.map(indexedTransferToRouteEdge);
    const liveWasQueried = indexedEdges.length < maxEdgesPerAddress;
    const liveEdges = liveWasQueried
      ? (await deps.tronClient.listRelatedTrc20Transfers(address, {
          start: 0,
          limit: maxEdgesPerAddress,
          minTimestamp: job.windowStart.getTime(),
          endTimestamp: maxTimestamp.getTime()
        }).catch(() => []))
          .map(normalizeTransfer)
          .filter((edge): edge is ForensicRouteEdge => edge !== null)
      : [];
    const edges = dedupeRouteEdges([...indexedEdges, ...liveEdges]);
    const oldestIndexedAt = oldestRouteEdgeTimestamp(indexedEdges);
    const oldestLiveAt = oldestRouteEdgeTimestamp(liveEdges);
    const oldestFetchedAt = oldestRouteEdgeTimestamp(edges);
    const oldestFetchedTransferAt = oldestFetchedAt?.toISOString() ?? null;
    const indexedMayBeTruncated = indexedEdges.length >= edgeFetchLimit &&
      oldestIndexedAt !== null &&
      oldestIndexedAt > job.windowStart;
    const liveMayBeTruncated = liveWasQueried &&
      liveEdges.length >= maxEdgesPerAddress &&
      oldestLiveAt !== null &&
      oldestLiveAt > job.windowStart;
    const noTruncationSignal = !indexedMayBeTruncated && !liveMayBeTruncated;
    const oldestCombinedReachesWindowStart = oldestFetchedAt !== null && oldestFetchedAt <= job.windowStart;
    historyCoverageCache.set(cacheKey, {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: edges.length,
      oldestFetchedTransferAt,
      reachedTargetHop: noTruncationSignal && (
        edges.length === 0 ||
        oldestCombinedReachesWindowStart ||
        (indexedEdges.length < edgeFetchLimit && (!liveWasQueried || liveEdges.length < maxEdgesPerAddress))
      ),
      source: historyCoverageSource({
        indexedEdgeCount: indexedEdges.length,
        liveEdgeCount: liveEdges.length
      })
    });
    edgeCache.set(cacheKey, edges);
    return edges;
  };

  const getHistoryCoverageForAddress = async (
    address: string,
    fetchOptions: { latestTimestamp?: Date } = {}
  ): Promise<MoneyOriginTraceHistoryCoverage> => {
    const maxTimestamp = maxTimestampForFetch(fetchOptions);
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const cached = historyCoverageCache.get(cacheKey);
    if (cached) return cached;
    await fetchEdgesForAddress(address, fetchOptions);
    return historyCoverageCache.get(cacheKey) ?? {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: 0,
      oldestFetchedTransferAt: null,
      reachedTargetHop: false,
      source: "unknown"
    };
  };

  const fetchLatestEdgesForAddress = async (address: string, limit: number): Promise<ForensicRouteEdge[]> => {
    const cacheKey = `${address}:${limit}`;
    if (latestEdgeCache.has(cacheKey)) return latestEdgeCache.get(cacheKey) ?? [];
    const indexedTransfers = await deps.listIndexedUsdtTransfersForAddress?.(address, {
      minTimestamp: new Date(0),
      maxTimestamp: job.windowEnd,
      limit,
      orderBy: "newest"
    }).catch(() => []) ?? [];
    const indexedEdges = indexedTransfers.map(indexedTransferToRouteEdge);
    const liveEdges = indexedEdges.length < limit
      ? (await deps.tronClient.listRelatedTrc20Transfers(address, { start: 0, limit }).catch(() => []))
          .map(normalizeTransfer)
          .filter((edge): edge is ForensicRouteEdge => edge !== null)
      : [];
    const edges = dedupeRouteEdges([...indexedEdges, ...liveEdges]);
    latestEdgeCache.set(cacheKey, edges);
    return edges;
  };

  const getClassificationForAddress = async (address: string): Promise<ServiceClassification | null> => {
    if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
    const metadata = await deps.getAddressMetadata?.(address).catch(() => null) ?? null;
    const contractProfile = metadata?.isContract
      ? await deps.getContractIntelligenceProfile?.(address).catch(() => null) ?? null
      : null;
    const classification = classifyServiceAddress({ address, metadata, contractProfile });
    classificationCache.set(address, classification);
    return classification;
  };

  const crossChainStage2Enabled = shouldRunCrossChainStage2ForJob(job, options);
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async (address, tokenContractAddress) => {
      if (tokenContractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
      const state = await deps.getUsdtRestrictionStatus(address).catch(() => null);
      return state?.balanceRaw ?? null;
    },
    fetchEdgesForAddress,
    getHistoryCoverageForAddress,
    fetchLatestEdgesForAddress,
    getLabelsForAddress: deps.getLabelsForAddress,
    getClassificationForAddress,
    getFastWalletRisk: async () => fastRiskReportFromJob(job),
    getTransaction: deps.getTransaction,
    listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
    getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus,
    getContractIntelligenceProfile: deps.getContractIntelligenceProfile,
    analyzeContractLlmCaseFiles: deps.analyzeContractLlmCaseFiles,
    crossChainDiscoveryProvider: deps.crossChainDiscoveryProvider,
    crossChainContinuationProviders: deps.crossChainContinuationProviders,
    evmEvidenceProvider: deps.evmEvidenceProvider
  }, {
    mode: job.progressJson.mode === "transaction_check" ? "transaction_check" : "where_is_money",
    sourceAddress: job.subjectAddress,
    requestedAmountRaw: rawAmountField(job.progressJson.requestedAmountRaw),
    seedTransfers: seedTransfersField(job.progressJson.seedTransfers),
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    maxDepth: Math.max(options.extendedSearchMaxDepth ?? 20, 20),
    beamWidth: Math.max(options.extendedSearchBeamWidth ?? 8, 8),
    maxAddressFetches: Math.max(options.extendedSearchMaxAddressFetches ?? 60, 60),
    maxEdgesPerAddress,
    recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 60,
    recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 60,
    contractTransactionInfoMinIntervalMs: 15000,
    crossChainStage2Enabled,
    crossChainManualDeepMode: options.crossChainManualDeepMode || booleanField(job.progressJson.crossChainManualDeepMode),
    crossChainMaxProviderCalls: options.crossChainMaxProviderCalls
  });

  const status = report.coverage.partial ? "partial" : "completed";
  await deps.completeForensicCheckJob({
    id: job.id,
    status,
    progressJson: {
      ...job.progressJson,
      whereIsMoneyCoverage: report.coverage,
      decision: report.decision,
      riskScore: report.riskScore
    },
    resultJson: {
      subjectAddress: report.subjectAddress,
      whereIsMoneyReport: report
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null
  });
  await sendWhereIsMoneyJobResultBestEffort(deps, job, report, status);
  return true;
}

export async function runSingleDeepForensicJobCycle(
  deps: DeepForensicJobRunnerDeps,
  options: DeepForensicJobRunnerOptions = {}
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;

  try {
    if (job.kind === "where_is_money_check") {
      return await runWhereIsMoneyJob(deps, job, options);
    }

    const report = await runDeepAddressForensicCheck(deps, {
      sourceAddress: job.subjectAddress,
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      maxDepth: 2,
      pageLimit: options.pageLimit,
      maxPagesPerAddress: options.maxPagesPerAddress ?? 2,
      maxExpandedIntermediates: options.maxExpandedIntermediates ?? 10,
      metadataFetchLimit: options.metadataFetchLimit ?? 12,
      contractProfileFetchLimit: options.contractProfileFetchLimit ?? 5,
      maxInboundSenders: options.maxInboundSenders ?? 5,
      maxApprovalDrainCandidates: options.maxApprovalDrainCandidates ?? 5,
      approvalChangeLookupLimit: options.approvalChangeLookupLimit ?? 5,
      extendedSearchMode: options.extendedSearchMode ?? "auto",
      extendedSearchMaxDepth: options.extendedSearchMaxDepth ?? 4,
      extendedSearchBeamWidth: options.extendedSearchBeamWidth ?? 8,
      extendedSearchMaxAddressFetches: options.extendedSearchMaxAddressFetches ?? 60,
      recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? 60,
      recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? 60,
      apiKeyConfigured: options.apiKeyConfigured
    });
    await deps.recordRiskEvaluation({
      rawEvidence: report.rawEvidence,
      observations: report.observations
    });
    const derivedLabels = [
      await persistDerivedDarknetExchangeProximityLabel(deps, job, report),
      await persistDerivedApprovalDrainProximityLabel(deps, job, report)
    ].filter((label): label is Exclude<DerivedLabelResult, null> => label !== null);
    const derivedLabel = derivedLabels[0] ?? null;
    const status = report.missingChecks.length > 0 ? "partial" : "completed";
    await deps.completeForensicCheckJob({
      id: job.id,
      status,
      progressJson: { ...job.progressJson, ...report.coverage, derivedLabel },
      resultJson: {
        subjectAddress: report.subjectAddress,
        windowStart: report.windowStart.toISOString(),
        windowEnd: report.windowEnd.toISOString(),
        serviceExposureProfiles: report.serviceExposureProfiles,
        addressBehaviorProfiles: report.addressBehaviorProfiles,
        inboundProvenanceProfiles: report.inboundProvenanceProfiles,
        counterpartyRiskProfiles: report.counterpartyRiskProfiles,
        directCounterpartyInteractionProfiles: report.directCounterpartyInteractionProfiles ?? [],
        approvalDrainProvenanceProfiles: report.approvalDrainProvenanceProfiles,
        stablecoinRestrictionProfiles: report.stablecoinRestrictionProfiles ?? [],
        extendedProvenanceProfiles: report.extendedProvenanceProfiles ?? [],
        derivedLabel,
        derivedLabels,
        missingChecks: report.missingChecks,
        coverage: report.coverage,
        coverageDebug: { ...report.coverageDebug, jobId: job.id, status }
      },
      rawEvidenceIds: report.rawEvidence.map((evidence) => evidence.id),
      observationIds: report.observations.map((observation) => observation.id),
      lastError: null
    });
    await sendDeepForensicJobResultBestEffort(deps, job, report, status);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: {},
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    await sendDeepForensicJobFailureBestEffort(deps, job, message);
    return true;
  }
}
