import { sendServiceAdminAlert } from "./alerts/adminDelivery";
import { formatIncomingDepositRiskAlert } from "./alerts/formatters";
import { maybeStartAdminDashboard } from "./admin/adminRuntime";
import { startAdminServer } from "./admin/adminServer";
import { normalizeBotLocale } from "./bot/i18n";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "./approvals/approvalWorker";
import { createBot, formatDeepForensicFailureUserDeliveryReport, formatDeepForensicUserDeliveryReport, formatWhereIsMoneyUserDeliveryReport } from "./bot/createBot";
import { checkSmartContractAddress as runSmartContractAddressCheck } from "./check/smartContractCheck";
import { loadConfig } from "./config";
import { createContractLlmVerdictAnalyzer } from "./forensics/contractLlmVerdict";
import { enrichContractClassification } from "./forensics/contractEnrichment";
import { runAddressIndexWorkerOnce } from "./forensics/addressIndexWorker";
import { createEvmContinuationProvider } from "./forensics/evmContinuationProvider";
import { createEtherscanV2EvmEvidenceProvider } from "./forensics/evmExplorerClient";
import { runForensicJobBatch } from "./forensics/forensicJobBatch";
import { runSingleDeepForensicJobCycle } from "./forensics/deepForensicJob";
import { buildIncomingDepositReport, runSingleIncomingDepositJobCycle, type IncomingDepositRuntimeDeps } from "./forensics/incomingDepositJob";
import { withLlmEnrichmentRetry } from "./forensics/llmEnrichmentRetry";
import { createRangeCrossChainDiscoveryProvider, RANGE_ENDPOINT_PATHS } from "./forensics/rangeClient";
import { classifyServiceAddress } from "./forensics/serviceClassifier";
import { addStrictBenchmarkCounters, addStrictBenchmarkStageTiming, buildStrictBenchmarkInitialProgress, type CounterPatch } from "./forensics/strictProvenanceBenchmark";
import { indexTronAddressUsdtHistory } from "./forensics/tronAddressAllTimeIndex";
import { createTronUsdtContinuationProvider } from "./forensics/tronContinuationProvider";
import { createOpenAiCompatibleJsonClient } from "./llm/openAiCompatibleJsonClient";
import { logger } from "./logging/logger";
import { createCachedAddressMetadataResolver } from "./metadata/addressMetadataCache";
import { runSinglePollingCycle } from "./monitor/monitorWorker";
import { deepForensicRuntimeOptions } from "./runtime/deepForensicRuntimeOptions";
import {
  buildStartupWorkSchedule,
  startStartupWorkSchedule,
  type StartupWorkLabel,
  type StartupWorkScheduleController
} from "./runtime/startupSchedule";
import { closeDb, createDb } from "./storage/db";
import {
  claimObservedTransactionForUserAlert,
  claimDueApprovalContexts,
  claimQueuedTronAddressUsdtIndexStates,
  claimNextForensicCheckJob,
  claimObservedApprovalEvent,
  claimObservedApprovalDrainEvent,
  claimDigestTransactions,
  claimUserAlertsForRetry,
  getApprovalPollState,
  getAddressMetadata,
  getForensicCheckJob,
  getStaleAddressMetadata,
  getContractIntelligenceProfile,
  getContractLlmVerdictCache,
  getContractLlmVerdictCacheByFingerprint,
  getCoveringTronAddressUsdtIndexState,
  getTronAddressUsdtIndexState,
  getWalletPollState,
  completeForensicCheckJob,
  failTronAddressUsdtIndexState,
  markApprovalContextExpired,
  markApprovalContextFinalAlertSent,
  markApprovalContextPending,
  markApprovalContextResolved,
  markApprovalOwnerAlertFailed,
  markApprovalOwnerAlertSent,
  markApprovalOwnerAlertSkipped,
  markWaitingForensicJobsReadyAfterTargetedIndex,
  patchWaitingForensicJobsTargetedIndexProgress,
  markStrictProvenanceJobReadyAfterIndex,
  patchStrictBenchmarkProgress,
  getForensicJobTargetedHistoryProgress,
  listCustomerAlertRecipients,
  listAdminForensicCheckJobs,
  countIndexedTronUsdtCounterpartiesForAddress,
  listIndexedTronUsdtTransfersForAddress,
  listIndexedTronUsdtTransfersByHashes,
  findLatestSavedWalletRiskByAddresses,
  listAddressLabels,
  markDigestSent,
  markUserAlertAnalyzing,
  listWalletApprovalsBySpenderForTelegramUser,
  listWatchedWallets,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  listTronAddressUsdtIndexPages,
  recoverStaleForensicCheckJobs,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  recordObservedTransactionRisk,
  releaseForensicCheckJobToWaiting,
  upsertForensicJobWait,
  releaseApprovalContextAfterFailure,
  saveRiskEvaluationEvidence,
  createOrReuseForensicCheckJob,
  getLatestDeepForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddressAnyStatus,
  getLatestWhereIsMoneyCheckJobForAddress,
  queueTronAddressUsdtIndexState,
  updateForensicCheckJobProgress,
  upsertAddressLabelAssertion,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertContractLlmVerdictCache,
  upsertIndexedTronUsdtTransfers,
  upsertTronAddressUsdtCoverageInterval,
  upsertTronAddressUsdtIndexPage,
  upsertTronAddressUsdtIndexState,
  upsertWalletApproval,
  upsertWalletPollState,
  watchedWalletExists
} from "./storage/repositories";
import type { ForensicCheckJob, ForensicCheckJobKind } from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";
import { createTronscanScheduler } from "./tron/tronscanScheduler";
import type { TronAddressUsdtIndexState } from "./types";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tronscanScheduler = createTronscanScheduler({
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
  accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs,
  maxInFlight: config.tronscanMaxInFlight,
  maxInFlightPerGroup: config.tronscanGroupMaxInFlight
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
  scheduler: tronscanScheduler
});
// ponytail: inline where-hop history is latency-sensitive; move to background/index queue if we need deeper per-hop proof.
const TARGETED_HISTORY_INLINE_MAX_PAGES = 4;
const TARGETED_HISTORY_BACKGROUND_MAX_PAGES = 200;
const TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP = 12000;
const TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH = 24;
const TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS = 8;
const TARGETED_HISTORY_BACKGROUND_ESCALATION_FACTOR = 2;
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
const crossChainDiscoveryProvider = config.crossChainStage2Enabled && config.rangeApiKey
  ? createRangeCrossChainDiscoveryProvider({
      apiKey: config.rangeApiKey,
      baseUrl: config.rangeBaseUrl,
      timeoutMs: config.rangeTimeoutMs,
      endpointPaths: RANGE_ENDPOINT_PATHS,
      allowUndocumentedRawAmountFields: true
    })
  : undefined;
const evmEvidenceProvider = config.crossChainStage2Enabled && config.evmExplorerApiKey
  ? createEtherscanV2EvmEvidenceProvider({
      apiKey: config.evmExplorerApiKey,
      baseUrl: config.evmExplorerBaseUrl,
      timeoutMs: config.evmExplorerTimeoutMs,
      maxPagesPerQuery: config.evmExplorerMaxCallsPerCheck
    })
  : undefined;
const crossChainContinuationProviders = config.crossChainStage2Enabled
  ? [
      createTronUsdtContinuationProvider({ tronClient }),
      ...(evmEvidenceProvider
        ? [
            createEvmContinuationProvider({ chain: "ethereum", evmProvider: evmEvidenceProvider }),
            createEvmContinuationProvider({ chain: "arbitrum", evmProvider: evmEvidenceProvider }),
            createEvmContinuationProvider({ chain: "bsc", evmProvider: evmEvidenceProvider })
          ]
        : [])
    ]
  : [];

logger.info("tronscan_scheduler_configured", tronscanScheduler.diagnostics());

const adminDashboard = await maybeStartAdminDashboard({
  config,
  startAdminServer: (adminDeps) => startAdminServer({
    ...adminDeps,
    createStrictProvenanceBenchmarkJob: async ({ subjectAddress }) => {
      const now = new Date();
      return createOrReuseForensicCheckJob(db, {
        kind: "where_is_money_check",
        subjectAddress,
        windowStart: new Date(0),
        windowEnd: now,
        priority: 260,
        chatId: null,
        requestedBy: "admin_strict_benchmark",
        progressJson: buildStrictBenchmarkInitialProgress({
          locale: "ru",
          keyCount: tronscanScheduler.diagnostics().apiKeyCount,
          accountGroupCount: tronscanScheduler.diagnostics().apiKeyGroupCount,
          now
        })
      });
    }
  }),
  listJobs: (input) => listAdminForensicCheckJobs(db, input),
  getJob: (id) => getForensicCheckJob(db, id),
  getTargetedHistoryProgressForJob: (jobId) => getForensicJobTargetedHistoryProgress(db, jobId),
  listIndexedUsdtTransfersByHashes: (txHashes) => listIndexedTronUsdtTransfersByHashes(db, txHashes),
  findLatestSavedWalletRiskByAddresses: (addresses) => findLatestSavedWalletRiskByAddresses(db, addresses)
});
if (adminDashboard) logger.info("admin_dashboard_started", { url: adminDashboard.url });

let activePoll: Promise<void> | null = null;
let activeWhereForensicPoll: Promise<void> | null = null;
let activeDeepForensicPoll: Promise<void> | null = null;
let activeIncomingDepositPoll: Promise<void> | null = null;
let activeAddressIndexPoll: Promise<void> | null = null;
let shuttingDown = false;

const getCachedOrLiveAddressMetadata = createCachedAddressMetadataResolver({
  getFresh: (address, now) => getAddressMetadata(db, address, now),
  getStale: (address) => getStaleAddressMetadata(db, address),
  fetchLive: (address) => withLlmEnrichmentRetry({
    label: "address_metadata",
    address,
    maxAttempts: config.llmEnrichmentMaxAttempts,
    retryDelayMs: config.llmEnrichmentRetryDelayMs,
    logger
  }, () => tronClient.getAddressMetadata(address, { requireComplete: true })),
  upsert: (metadata) => upsertAddressMetadata(db, metadata),
  logger
});

function shouldRefreshContractProfileForLlm(profile: { lowMetadata?: boolean | null } | null): boolean {
  return profile?.lowMetadata === true;
}

async function getCachedOrLiveContractIntelligenceProfile(address: string, now = new Date()) {
  const cached = await getContractIntelligenceProfile(db, address, now).catch((error) => {
    logger.warn("contract_profile_cache_read_failed", {
      address,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });
  if (cached && !shouldRefreshContractProfileForLlm(cached)) return cached;

  const live = await withLlmEnrichmentRetry({
    label: "contract_profile",
    address,
    maxAttempts: config.llmEnrichmentMaxAttempts,
    retryDelayMs: config.llmEnrichmentRetryDelayMs,
    logger
  }, () => tronClient.getContractIntelligenceProfile(address, { now, requireComplete: true })).catch((error) => {
    logger.warn("contract_profile_live_fetch_failed", {
      address,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });
  if (!live) return null;

  await upsertContractIntelligenceProfile(db, live).catch((error) => {
    logger.warn("contract_profile_cache_write_failed", {
      address,
      error: error instanceof Error ? error.message : String(error)
    });
  });
  return live;
}

async function ensureAddressUsdtHistory(input: {
  address: string;
  coverageMode: "all_time" | "targeted";
  targetTimestamp?: Date | null;
  stopAtTimestamp?: Date | null;
  requestedByJobId?: string | null;
  queuedReason: string;
  maxPagesPerRun?: number | null;
  maxWindowSplitDepth?: number | null;
  lockOwner?: string | null;
  lockMs?: number | null;
}) {
  const targetTimestamp = input.targetTimestamp ?? input.stopAtTimestamp ?? null;
  const existing = await getTronAddressUsdtIndexState(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp
  });
  if (existing?.status === "complete" && existing.statusReason === "complete_provider_windowed") return existing;

  const completedPages = await listTronAddressUsdtIndexPages(db, {
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestampMs: input.coverageMode === "targeted" ? targetTimestamp?.getTime() ?? 0 : 0
  });
  let benchmarkPatchChain: Promise<void> = Promise.resolve();
  const patchStrictBenchmarkMetrics = async (
    buildProgress: (progressJson: Record<string, unknown>) => Record<string, any>
  ): Promise<void> => {
    if (!input.requestedByJobId) return;
    benchmarkPatchChain = benchmarkPatchChain
      .catch(() => undefined)
      .then(async () => {
        const existingJob = await getForensicCheckJob(db, input.requestedByJobId!).catch(() => null);
        if (existingJob?.progressJson.strictProvenanceBenchmark !== true) return;
        const progress = buildProgress(existingJob.progressJson);
        await patchStrictBenchmarkProgress(db, {
          id: input.requestedByJobId!,
          patchJson: {
            strictBenchmarkMetrics: progress.strictBenchmarkMetrics
          }
        });
      })
      .catch((error) => {
        logger.warn("strict_benchmark_metric_patch_failed", {
          jobId: input.requestedByJobId,
          address: input.address,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    await benchmarkPatchChain;
  };
  const patchBenchmarkStage = async (stage: "apiMs" | "dbWriteMs", elapsedMs: number): Promise<void> => {
    await patchStrictBenchmarkMetrics((progressJson) =>
      addStrictBenchmarkStageTiming(progressJson, stage, elapsedMs)
    );
  };
  const patchBenchmarkCounters = async (patch: CounterPatch): Promise<void> => {
    await patchStrictBenchmarkMetrics((progressJson) =>
      addStrictBenchmarkCounters(progressJson, patch)
    );
  };
  const extendIndexLock = async (): Promise<void> => {
    if (!input.lockOwner || !input.lockMs) return;
    const now = new Date();
    await upsertTronAddressUsdtIndexState(db, {
      address: input.address,
      coverageMode: input.coverageMode,
      targetTimestamp,
      status: "running",
      requestedByJobId: input.requestedByJobId ?? existing?.requestedByJobId ?? null,
      queuedReason: input.queuedReason,
      lockedUntil: new Date(now.getTime() + Math.max(1, input.lockMs)),
      heartbeatAt: now,
      lockOwner: input.lockOwner
    });
  };

  const state = await indexTronAddressUsdtHistory({
    address: input.address,
    coverageMode: input.coverageMode,
    targetTimestamp,
    stopAtTimestamp: input.stopAtTimestamp ?? null,
    initialState: existing,
    initialPagesByKey: new Map(completedPages
      .filter((page) => (page.status === "complete" || page.status === "empty") && page.rawResponseHash && page.canonicalTransferHash)
      .map((page) => [`${page.windowStartTimestampMs}:${page.windowEndTimestampMs}:${page.startOffset}`, {
        rawResponseHash: page.rawResponseHash,
        canonicalTransferHash: page.canonicalTransferHash,
        status: page.status,
        transferCount: page.transferCount,
        provider: page.provider,
        totalReported: page.totalReported,
        rangeTotal: page.rangeTotal,
        newestTransferAt: page.newestTransferAt,
        oldestTransferAt: page.oldestTransferAt
      }])),
    pageLimit: config.tronscanPageLimit,
    pageBatchSize: config.tronAddressIndexPageBatchSize,
    maxPagesPerRun: input.maxPagesPerRun ??
      (input.coverageMode === "targeted" ? TARGETED_HISTORY_INLINE_MAX_PAGES : undefined),
    maxWindowSplitDepth: input.maxWindowSplitDepth ?? undefined,
    requestedByJobId: input.requestedByJobId ?? null,
    queuedReason: input.queuedReason,
    onBenchmarkStageTiming: patchBenchmarkStage,
    onBenchmarkCounters: patchBenchmarkCounters,
    onProgressHeartbeat: extendIndexLock,
    listTransferPage: (address, options) => tronClient.listRelatedTrc20TransferPage(address, options),
    upsertTransfers: (transfers) => upsertIndexedTronUsdtTransfers(db, transfers),
    countIndexedCounterparties: (address) => countIndexedTronUsdtCounterpartiesForAddress(db, address),
    upsertState: (state) => upsertTronAddressUsdtIndexState(db, state),
    upsertPage: (page) => upsertTronAddressUsdtIndexPage(db, page),
    upsertCoverageInterval: (interval) => upsertTronAddressUsdtCoverageInterval(db, interval)
  });
  const wakeJobId = state.requestedByJobId ?? input.requestedByJobId ?? null;
  if (wakeJobId && input.coverageMode === "targeted" && shouldWakeTargetedWaiterAfterEnsure(state)) {
    await markStrictProvenanceJobReadyAfterIndex(db, {
      id: wakeJobId,
      address: state.address,
      targetTimestamp: state.targetTimestamp,
      indexStatus: state.status,
      statusReason: state.statusReason,
      lastError: state.lastError
    });
  }
  return state;
}

function shouldWakeTargetedWaiterAfterEnsure(state: TronAddressUsdtIndexState): boolean {
  if (state.status === "complete" || state.status === "failed_terminal") return true;
  if (state.status !== "partial") return false;
  if (state.statusReason === "partial_provider_inconsistent" ||
    state.statusReason === "too_large_deferred" ||
    state.statusReason === "failed_terminal") {
    return true;
  }
  if (state.statusReason === "partial_provider_cap") {
    return state.attemptCount >= Math.max(state.maxAttempts, TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS);
  }
  return false;
}

const bot = createBot(config, db, tronClient, {
  checkSmartContractAddress: async ({ address, telegramUserId }) => {
    const metadata = await getCachedOrLiveAddressMetadata(address).catch((error) => {
      logger.warn("smart_contract_metadata_lookup_failed", {
        address,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });
    const contractProfile = metadata?.isContract === true || metadata === null
      ? await getCachedOrLiveContractIntelligenceProfile(address).catch(() => null)
      : null;
    if (metadata?.isContract !== true && !contractProfile) return { kind: "not_contract" };
    if (!metadata) return { kind: "unavailable", error: "contract metadata unavailable" };
    const relatedApprovals = telegramUserId
      ? await listWalletApprovalsBySpenderForTelegramUser(db, { telegramUserId, spenderAddress: address }).catch((error) => {
          logger.warn("smart_contract_approval_lookup_failed", {
            address,
            telegramUserId,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error("approval relation lookup failed");
        })
      : [];
    const serviceClassification = classifyServiceAddress({ address, metadata, contractProfile });
    return {
      kind: "report",
      report: await runSmartContractAddressCheck({
        address,
        metadata,
        contractProfile,
        serviceClassification,
        relatedApprovals,
        analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer
      })
    };
  }
});

const incomingDepositRuntimeDeps: IncomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress: (address, options) => listIndexedTronUsdtTransfersForAddress(db, {
    address,
    minTimestamp: options.minTimestamp,
    maxTimestamp: options.maxTimestamp,
    limit: options.limit,
    orderBy: options.orderBy,
    direction: "both"
  }),
  listRelatedTrc20Transfers: (address, options) => tronClient.listRelatedTrc20Transfers(address, options),
  getLabelsForAddress: (address) => listAddressLabels(db, address),
  getClassificationForAddress: async (address) => {
    const metadata = await getCachedOrLiveAddressMetadata(address);
    const contractProfile = metadata?.isContract === true
      ? await getCachedOrLiveContractIntelligenceProfile(address)
      : null;
    return classifyServiceAddress({ address, metadata, contractProfile });
  },
  getContractIntelligenceProfile: (address) => getCachedOrLiveContractIntelligenceProfile(address),
  enrichContractClassification: (address) => enrichContractClassification({
    address,
    getMetadata: (candidate) => getCachedOrLiveAddressMetadata(candidate),
    getCachedProfile: (candidate, now) => getContractIntelligenceProfile(db, candidate, now),
    fetchLiveProfile: (candidate, now) => withLlmEnrichmentRetry({
      label: "contract_profile",
      address: candidate,
      maxAttempts: config.llmEnrichmentMaxAttempts,
      retryDelayMs: config.llmEnrichmentRetryDelayMs,
      logger
    }, () => tronClient.getContractIntelligenceProfile(candidate, { now, requireComplete: true })),
    upsertProfile: (profile) => upsertContractIntelligenceProfile(db, profile),
    logger
  }),
  getTransaction: (txHash) => tronClient.getTransaction(txHash),
  getUsdtRestrictionStatus: (address) => tronClient.getUsdtRestrictionStatus(address),
  listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
  ensureAddressUsdtHistory,
  analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer,
  crossChainDiscoveryProvider,
  evmEvidenceProvider,
  crossChainContinuationProviders,
  crossChainStage2Enabled: config.crossChainStage2Enabled,
  crossChainMaxProviderCalls: config.crossChainStage2MaxProviderCalls
};

async function sendAdminAlert(message: string, options?: { parse_mode?: "HTML" }): Promise<void> {
  await sendServiceAdminAlert({
    adminIds: config.serviceAdminTelegramIds,
    message,
    options,
    sendMessage: async (telegramUserId, alertMessage, alertOptions) => {
      await bot.api.sendMessage(telegramUserId, alertMessage, alertOptions);
    },
    logger
  });
}

async function findMatchingWhereIsMoneyJob(job: ForensicCheckJob): Promise<ForensicCheckJob | null> {
  if (job.kind !== "address_deep_check" || !job.chatId) return null;
  return getLatestWhereIsMoneyCheckJobForAddress(db, {
    subjectAddress: job.subjectAddress,
    chatId: job.chatId,
    requestedBy: job.requestedBy,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd
  });
}

async function sendForensicJobFailure(job: ForensicCheckJob, error: string, whereJob?: ForensicCheckJob | null): Promise<void> {
  if (!job.chatId) return;
  const message = formatDeepForensicFailureUserDeliveryReport(job, error, whereJob, {
    runtimeLabel: config.runtimeInstanceLabel,
    locale: normalizeBotLocale(job.progressJson.locale)
  });
  await bot.api.sendMessage(job.chatId, message.text, { parse_mode: message.parseMode });
}

async function pollOnce(): Promise<void> {
  if (activePoll) return activePoll;

  activePoll = (async () => {
    const wallets = await listWatchedWallets(db);
    await runSinglePollingCycle({
      wallets,
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      backfillLookbackMs: config.tronscanBackfillLookbackMs,
      incomingDepositRealtimeMaxAgeMs: config.incomingDepositRealtimeMaxAgeMs,
      isWatchedWalletActive: (watchedWalletId) => watchedWalletExists(db, watchedWalletId),
      getWalletPollState: (watchedWalletId) => getWalletPollState(db, watchedWalletId),
      upsertWalletPollState: (input) => upsertWalletPollState(db, input),
      claimObservedTransactionForUserAlert: (input) => claimObservedTransactionForUserAlert(db, input),
      claimUserAlertsForRetry: (input) => claimUserAlertsForRetry(db, input),
      claimDigestTransactions: (input) => claimDigestTransactions(db, input),
      recordObservedTransactionRisk: (input) => recordObservedTransactionRisk(db, input),
      queueIncomingDepositJob: async (input) => {
        const windowEnd = new Date(input.timestamp.getTime() + 60_000);
        const windowStart = new Date(input.timestamp.getTime() - 30 * 24 * 60 * 60 * 1000);
        const job = await createOrReuseForensicCheckJob(db, {
          kind: "incoming_deposit_check",
          subjectAddress: input.sender,
          windowStart,
          windowEnd,
          chatId: input.chatId,
          requestedBy: input.requestedBy,
          priority: 140,
          progressJson: {
            depositTxHash: input.txHash,
            watchedWalletId: input.watchedWalletId,
            watchedWallet: input.watchedWallet,
            sender: input.sender,
            amount: input.amount,
            amountRaw: input.amountRaw,
            timestamp: input.timestamp.toISOString(),
            telegramUserId: input.telegramUserId,
            alertMode: input.alertMode,
            locale: input.locale ?? null
          }
        });
        return { id: job.id };
      },
      markUserAlertAnalyzing: (input) => markUserAlertAnalyzing(db, input),
      markUserAlertSent: (input) => markUserAlertSent(db, input),
      markUserAlertSkipped: (input) => markUserAlertSkipped(db, input),
      markUserAlertFailed: (input) => markUserAlertFailed(db, input),
      markDigestSent: (input) => markDigestSent(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      listCustomerAlertRecipients: (ownerTelegramUserId) => listCustomerAlertRecipients(db, ownerTelegramUserId),
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendCustomerAdminAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendDigestAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendAdminAlert,
      logger
    });
    await runSingleApprovalPollingCycle({
      wallets,
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      isWatchedWalletActive: (watchedWalletId) => watchedWalletExists(db, watchedWalletId),
      getApprovalPollState: (watchedWalletId) => getApprovalPollState(db, watchedWalletId),
      recordApprovalPollSuccess: (input) => recordApprovalPollSuccess(db, input),
      recordApprovalPollFailure: (input) => recordApprovalPollFailure(db, input),
      upsertWalletApproval: (input) => upsertWalletApproval(db, input),
      claimObservedApprovalEvent: (input) => claimObservedApprovalEvent(db, input),
      claimObservedApprovalDrainEvent: (input) => claimObservedApprovalDrainEvent(db, input),
      recordApprovalRisk: (input) => recordApprovalRisk(db, input),
      markApprovalContextPending: (input) => markApprovalContextPending(db, input),
      markApprovalOwnerAlertSent: (input) => markApprovalOwnerAlertSent(db, input),
      markApprovalOwnerAlertSkipped: (input) => markApprovalOwnerAlertSkipped(db, input),
      markApprovalOwnerAlertFailed: (input) => markApprovalOwnerAlertFailed(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
      upsertAddressMetadata: (input) => upsertAddressMetadata(db, input),
      getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
      upsertContractIntelligenceProfile: (input) => upsertContractIntelligenceProfile(db, input),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      listCustomerAlertRecipients: (ownerTelegramUserId) => listCustomerAlertRecipients(db, ownerTelegramUserId),
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendCustomerAdminAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendAdminAlert,
      logger
    });
    await runSingleApprovalContextFinalizerCycle({
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      claimDueApprovalContexts: (input) => claimDueApprovalContexts(db, input),
      markApprovalContextResolved: (input) => markApprovalContextResolved(db, input),
      markApprovalContextExpired: (input) => markApprovalContextExpired(db, input),
      markApprovalContextFinalAlertSent: (input) => markApprovalContextFinalAlertSent(db, input),
      releaseApprovalContextAfterFailure: (input) => releaseApprovalContextAfterFailure(db, input),
      upsertWalletApproval: (input) => upsertWalletApproval(db, input),
      recordApprovalRisk: (input) => recordApprovalRisk(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getAddressMetadata: (address, now) => getAddressMetadata(db, address, now),
      upsertAddressMetadata: (input) => upsertAddressMetadata(db, input),
      getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(db, address, now),
      upsertContractIntelligenceProfile: (input) => upsertContractIntelligenceProfile(db, input),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      listCustomerAlertRecipients: (ownerTelegramUserId) => listCustomerAlertRecipients(db, ownerTelegramUserId),
      sendUserAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendCustomerAdminAlert: async (telegramUserId, message, options) => {
        await bot.api.sendMessage(telegramUserId, message, options);
      },
      sendAdminAlert,
      logger
    });
  })().finally(() => {
    activePoll = null;
  });

  return activePoll;
}

async function recoverStaleForensicJobsOnce(): Promise<void> {
  const recoveredAt = new Date();
  const result = await recoverStaleForensicCheckJobs(db, {
    staleRunningBefore: new Date(recoveredAt.getTime() - config.forensicJobStaleAfterMs),
    recoveredAt,
    maxRetries: config.forensicJobMaxRetries
  });
  for (const job of result.requeued) {
    logger.warn("forensic_job_stale_requeued", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      retry_count: job.progressJson.retryCount,
      reason: job.progressJson.staleRecoveryReason
    });
  }
  for (const job of result.failed) {
    logger.warn("forensic_job_stale_failed", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      retry_count: job.progressJson.retryCount,
      reason: job.progressJson.staleRecoveryReason
    });
    if (!job.chatId) continue;
    const reason = typeof job.progressJson.staleRecoveryReason === "string"
      ? job.progressJson.staleRecoveryReason
      : job.lastError ?? "stale forensic job exceeded retry limit";
    try {
      await sendForensicJobFailure(job, reason, await findMatchingWhereIsMoneyJob(job));
    } catch (error) {
      logger.error("forensic_job_stale_failure_delivery_failed", {
        job_id: job.id,
        kind: job.kind,
        subject_address: job.subjectAddress,
        chat_id: job.chatId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function runForensicJobsOnce(kinds: ForensicCheckJobKind[], maxJobs: number): Promise<number> {
  await recoverStaleForensicJobsOnce();
  return runForensicJobBatch({
    maxJobs,
    runSingleCycle: () => runSingleDeepForensicJobCycle({
      tronClient,
      claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds }),
      completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
      updateForensicCheckJobProgress: (input) => updateForensicCheckJobProgress(db, input),
      releaseForensicCheckJobToWaiting: (input) => releaseForensicCheckJobToWaiting(db, input),
      recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(db, evaluation),
      upsertAddressLabelAssertion: (input) => upsertAddressLabelAssertion(db, input),
      getLabelsForAddress: (address) => listAddressLabels(db, address),
      getAddressMetadata: (address) => getCachedOrLiveAddressMetadata(address),
      getContractIntelligenceProfile: (address) => getCachedOrLiveContractIntelligenceProfile(address),
      getUsdtRestrictionStatus: (address) => tronClient.getUsdtRestrictionStatus(address),
      getTransaction: (txHash) => tronClient.getTransaction(txHash),
      listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
      analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer,
      crossChainDiscoveryProvider,
      evmEvidenceProvider,
      crossChainContinuationProviders,
      listIndexedUsdtTransfersForAddress: (address, options) => listIndexedTronUsdtTransfersForAddress(db, {
        address,
        minTimestamp: options.minTimestamp,
        maxTimestamp: options.maxTimestamp,
        limit: options.limit,
        offset: options.offset,
        orderBy: options.orderBy,
        direction: "both"
      }),
      getAddressUsdtIndexState: (input) => getTronAddressUsdtIndexState(db, input),
      getCoveringAddressUsdtIndexState: (input) => getCoveringTronAddressUsdtIndexState(db, input),
      ensureAddressUsdtHistory,
      upsertForensicJobWait: (input) => upsertForensicJobWait(db, input),
      markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input),
      queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
        address: input.address,
        coverageMode: input.coverageMode,
        targetTimestamp: input.targetTimestamp ?? null,
        queuedReason: input.queuedReason,
        requestedByJobId: input.requestedByJobId ?? null,
        priority: input.queuedReason === "where_is_money_hop" ? 250 : input.queuedReason === "deep_subject" ? 100 : 10,
        nextRunAt: new Date(),
        budgetPages: input.budgetPages ??
          (input.coverageMode === "targeted" && input.queuedReason === "where_is_money_hop"
            ? TARGETED_HISTORY_BACKGROUND_MAX_PAGES
            : null),
        maxAttempts: input.coverageMode === "targeted" && input.queuedReason === "where_is_money_hop"
          ? input.maxAttempts ?? TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS
          : input.maxAttempts ?? null,
        allowRunningRequeue: input.allowRunningRequeue === true
      }),
      sendJobResult: async (job, report, status) => {
        if (!job.chatId) return;
        const locale = normalizeBotLocale(job.progressJson.locale);
        const whereJob = await getLatestWhereIsMoneyCheckJobForAddress(db, {
          subjectAddress: job.subjectAddress,
          chatId: job.chatId,
          requestedBy: job.requestedBy,
          windowStart: job.windowStart,
          windowEnd: job.windowEnd
        });
        const message = formatDeepForensicUserDeliveryReport(job, report, status, whereJob, {
          runtimeLabel: config.runtimeInstanceLabel,
          locale,
          showBetaDiagnostics: config.botBetaRiskDiagnosticsEnabled
        });
        await bot.api.sendMessage(job.chatId, message.text, { parse_mode: message.parseMode });
      },
      sendWhereIsMoneyJobResult: async (job, report, status) => {
        if (!job.chatId) return;
        const deepJob = await getLatestDeepForensicCheckJobForAddressAnyStatus(db, {
          subjectAddress: job.subjectAddress,
          chatId: job.chatId,
          requestedBy: job.requestedBy,
          windowStart: job.windowStart,
          windowEnd: job.windowEnd
        });
        const message = formatWhereIsMoneyUserDeliveryReport(job, report, status, deepJob, {
          runtimeLabel: config.runtimeInstanceLabel,
          locale: normalizeBotLocale(job.progressJson.locale),
          showBetaDiagnostics: config.botBetaRiskDiagnosticsEnabled
        });
        await bot.api.sendMessage(job.chatId, message.text, { parse_mode: message.parseMode });
      },
      sendJobFailure: async (job, error) => {
        await sendForensicJobFailure(job, error, await findMatchingWhereIsMoneyJob(job));
      }
    }, {
      ...deepForensicRuntimeOptions(config, tronscanScheduler.diagnostics().apiKeyConfigured),
      targetedHistoryMaxBudgetPages: TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP
    })
  });
}

async function whereForensicOnce(): Promise<void> {
  if (activeWhereForensicPoll) return activeWhereForensicPoll;
  activeWhereForensicPoll = runForensicJobsOnce(["where_is_money_check"], config.forensicWhereJobsPerPoll)
    .then((handled) => {
      if (handled > 0) logger.info("where_forensic_jobs_processed", { handled });
    })
    .finally(() => {
      activeWhereForensicPoll = null;
    });
  return activeWhereForensicPoll;
}

async function addressIndexOnce(): Promise<void> {
  if (activeAddressIndexPoll) return activeAddressIndexPoll;
  activeAddressIndexPoll = runAddressIndexWorkerOnce({
    claimQueuedTronAddressUsdtIndexStates: (input) => claimQueuedTronAddressUsdtIndexStates(db, input),
    ensureAddressUsdtHistory,
    queueAddressUsdtHistory: (input) => queueTronAddressUsdtIndexState(db, {
      address: input.address,
      coverageMode: input.coverageMode,
      targetTimestamp: input.targetTimestamp ?? null,
      queuedReason: input.queuedReason,
      requestedByJobId: input.requestedByJobId ?? null,
      priority: input.priority ?? 250,
      nextRunAt: input.nextRunAt ?? new Date(),
      budgetPages: input.budgetPages ?? null,
      maxAttempts: input.maxAttempts ?? null,
      allowRunningRequeue: input.allowRunningRequeue === true
    }),
    failTronAddressUsdtIndexState: (input) => failTronAddressUsdtIndexState(db, input),
    markWaitingForensicJobsReadyAfterTargetedIndex: (input) => markWaitingForensicJobsReadyAfterTargetedIndex(db, input),
    patchWaitingForensicJobsTargetedIndexProgress: (input) => patchWaitingForensicJobsTargetedIndexProgress(db, input),
    markStrictProvenanceJobReadyAfterIndex: (input) => markStrictProvenanceJobReadyAfterIndex(db, input)
  }, {
    claimLimit: config.tronAddressIndexClaimLimit ?? 3,
    lockMs: config.tronAddressIndexLockMs ?? 600_000,
    workerId: process.env.HOSTNAME ?? `pid-${process.pid}`,
    targetedRetry: {
      basePages: TARGETED_HISTORY_BACKGROUND_MAX_PAGES,
      maxPagesPerHop: TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP,
      maxWindowSplitDepth: TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH,
      escalationFactor: TARGETED_HISTORY_BACKGROUND_ESCALATION_FACTOR,
      maxAttempts: TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS,
      retryDelayMs: 30_000
    }
  })
    .then(() => undefined)
    .finally(() => {
      activeAddressIndexPoll = null;
    });
  return activeAddressIndexPoll;
}

async function deepForensicOnce(): Promise<void> {
  if (activeDeepForensicPoll) return activeDeepForensicPoll;
  activeDeepForensicPoll = addressIndexOnce()
    .then(() => runForensicJobsOnce(["address_deep_check"], 1))
    .then((handled) => {
      if (handled > 0) logger.info("deep_forensic_jobs_processed", { handled });
    })
    .finally(() => {
      activeDeepForensicPoll = null;
    });
  return activeDeepForensicPoll;
}

async function incomingDepositOnce(): Promise<void> {
  if (activeIncomingDepositPoll) return activeIncomingDepositPoll;
  activeIncomingDepositPoll = (async () => {
    await recoverStaleForensicJobsOnce();
    return runForensicJobBatch({
      maxJobs: config.forensicIncomingJobsPerPoll,
      runSingleCycle: () => runSingleIncomingDepositJobCycle({
        claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds: ["incoming_deposit_check"] }),
        completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
        updateForensicCheckJobProgress: (input) => updateForensicCheckJobProgress(db, input),
        markUserAlertSent: (input) => markUserAlertSent(db, input),
        markUserAlertFailed: (input) => markUserAlertFailed(db, input),
        recordObservedTransactionRisk: (input) => recordObservedTransactionRisk(db, input),
        formatIncomingDepositRiskAlert,
        sendUserAlert: async (telegramUserId, message, options) => {
          await bot.api.sendMessage(telegramUserId, message, options as Parameters<typeof bot.api.sendMessage>[2]);
        },
        buildReport: (input) => buildIncomingDepositReport({
          ...input,
          deps: incomingDepositRuntimeDeps
        })
      })
    });
  })()
    .then((handled) => {
      if (handled > 0) logger.info("incoming_deposit_jobs_processed", { handled });
    })
    .finally(() => {
      activeIncomingDepositPoll = null;
    });
  return activeIncomingDepositPoll;
}

const startupWork: Record<StartupWorkLabel, () => Promise<void>> = {
  poll: pollOnce,
  where_forensic: whereForensicOnce,
  incoming_deposit: incomingDepositOnce,
  deep_forensic: deepForensicOnce,
  address_index: addressIndexOnce
};

const intervalByLabel: Record<StartupWorkLabel, number> = {
  poll: config.pollIntervalMs,
  where_forensic: config.forensicWherePollIntervalMs,
  incoming_deposit: config.forensicIncomingPollIntervalMs,
  deep_forensic: config.forensicDeepPollIntervalMs,
  address_index: config.tronAddressIndexPollIntervalMs ?? 15_000
};

let startupWorkSchedule: StartupWorkScheduleController | null = null;
const startupWorkScheduleItems = buildStartupWorkSchedule(config);

function startBackgroundWorkSchedule(): void {
  if (startupWorkSchedule) return;
  startupWorkSchedule = startStartupWorkSchedule({
    schedule: startupWorkScheduleItems,
    startupWork,
    intervalByLabel,
    initialErrorEventByLabel: {
      poll: "initial_polling_cycle_failed",
      where_forensic: "initial_where_forensic_cycle_failed",
      incoming_deposit: "initial_incoming_deposit_cycle_failed",
      deep_forensic: "initial_deep_forensic_cycle_failed",
      address_index: "initial_address_index_cycle_failed"
    },
    intervalErrorEventByLabel: {
      poll: "polling_cycle_failed",
      where_forensic: "where_forensic_cycle_failed",
      incoming_deposit: "incoming_deposit_worker_failed",
      deep_forensic: "deep_forensic_cycle_failed",
      address_index: "address_index_cycle_failed"
    },
    onError: (eventName, error) => {
      logger.error(eventName, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  logger.info("startup_work_schedule_started", { schedule: startupWorkScheduleItems });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_started", { signal });
  startupWorkSchedule?.stop();
  startupWorkSchedule = null;

  if (activePoll) {
    try {
      await activePoll;
    } catch (error) {
      logger.error("active_poll_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeWhereForensicPoll) {
    try {
      await activeWhereForensicPoll;
    } catch (error) {
      logger.error("active_where_forensic_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeDeepForensicPoll) {
    try {
      await activeDeepForensicPoll;
    } catch (error) {
      logger.error("active_deep_forensic_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeIncomingDepositPoll) {
    try {
      await activeIncomingDepositPoll;
    } catch (error) {
      logger.error("active_incoming_deposit_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (activeAddressIndexPoll) {
    try {
      await activeAddressIndexPoll;
    } catch (error) {
      logger.error("active_address_index_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    await bot.stop();
  } catch (error) {
    logger.error("bot_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
  }

  if (adminDashboard) {
    try {
      await adminDashboard.close();
      logger.info("admin_dashboard_stopped", {});
    } catch (error) {
      logger.error("admin_dashboard_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  try {
    await closeDb(db);
  } catch (error) {
    logger.error("database_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

startBackgroundWorkSchedule();

bot.start({
  onStart: () => {
    logger.info("bot_started");
    startBackgroundWorkSchedule();
  }
}).catch((error) => {
  logger.error("telegram_bot_failed", { error: error instanceof Error ? error.message : String(error) });
  void shutdown("SIGTERM").then(() => {
    process.exitCode = 1;
  });
});
