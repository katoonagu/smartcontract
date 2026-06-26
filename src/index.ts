import { sendServiceAdminAlert } from "./alerts/adminDelivery";
import { formatIncomingDepositRiskAlert } from "./alerts/formatters";
import { maybeStartAdminDashboard } from "./admin/adminRuntime";
import { normalizeBotLocale } from "./bot/i18n";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "./approvals/approvalWorker";
import { createBot, formatDeepForensicFailureUserDeliveryReport, formatDeepForensicUserDeliveryReport, formatWhereIsMoneyUserDeliveryReport } from "./bot/createBot";
import { checkSmartContractAddress as runSmartContractAddressCheck } from "./check/smartContractCheck";
import { loadConfig } from "./config";
import { createContractLlmVerdictAnalyzer } from "./forensics/contractLlmVerdict";
import { enrichContractClassification } from "./forensics/contractEnrichment";
import { createEvmContinuationProvider } from "./forensics/evmContinuationProvider";
import { createEtherscanV2EvmEvidenceProvider } from "./forensics/evmExplorerClient";
import { runForensicJobBatch } from "./forensics/forensicJobBatch";
import { runSingleDeepForensicJobCycle } from "./forensics/deepForensicJob";
import { buildIncomingDepositReport, runSingleIncomingDepositJobCycle, type IncomingDepositRuntimeDeps } from "./forensics/incomingDepositJob";
import { withLlmEnrichmentRetry } from "./forensics/llmEnrichmentRetry";
import { createRangeCrossChainDiscoveryProvider, RANGE_ENDPOINT_PATHS } from "./forensics/rangeClient";
import { classifyServiceAddress } from "./forensics/serviceClassifier";
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
  getWalletPollState,
  completeForensicCheckJob,
  markApprovalContextExpired,
  markApprovalContextFinalAlertSent,
  markApprovalContextPending,
  markApprovalContextResolved,
  markApprovalOwnerAlertFailed,
  markApprovalOwnerAlertSent,
  markApprovalOwnerAlertSkipped,
  listCustomerAlertRecipients,
  listAdminForensicCheckJobs,
  listIndexedTronUsdtTransfersForAddress,
  listAddressLabels,
  markDigestSent,
  markUserAlertAnalyzing,
  listWalletApprovalsBySpenderForTelegramUser,
  listWatchedWallets,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  recoverStaleForensicCheckJobs,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  recordObservedTransactionRisk,
  releaseApprovalContextAfterFailure,
  saveRiskEvaluationEvidence,
  createOrReuseForensicCheckJob,
  getLatestDeepForensicCheckJobForAddress,
  getLatestDeepForensicCheckJobForAddressAnyStatus,
  getLatestWhereIsMoneyCheckJobForAddress,
  updateForensicCheckJobProgress,
  upsertAddressLabelAssertion,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertContractLlmVerdictCache,
  upsertWalletApproval,
  upsertWalletPollState,
  watchedWalletExists
} from "./storage/repositories";
import type { ForensicCheckJob, ForensicCheckJobKind } from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";
import { createTronscanScheduler } from "./tron/tronscanScheduler";

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
  scheduler: tronscanScheduler
});
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
  listJobs: (input) => listAdminForensicCheckJobs(db, input),
  getJob: (id) => getForensicCheckJob(db, id)
});
if (adminDashboard) logger.info("admin_dashboard_started", { url: adminDashboard.url });

let activePoll: Promise<void> | null = null;
let activeWhereForensicPoll: Promise<void> | null = null;
let activeDeepForensicPoll: Promise<void> | null = null;
let activeIncomingDepositPoll: Promise<void> | null = null;
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
    }, deepForensicRuntimeOptions(config, tronscanScheduler.diagnostics().apiKeyConfigured))
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

async function deepForensicOnce(): Promise<void> {
  if (activeDeepForensicPoll) return activeDeepForensicPoll;
  activeDeepForensicPoll = runForensicJobsOnce(["address_deep_check"], 1)
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
  deep_forensic: deepForensicOnce
};

const intervalByLabel: Record<StartupWorkLabel, number> = {
  poll: config.pollIntervalMs,
  where_forensic: config.forensicWherePollIntervalMs,
  incoming_deposit: config.forensicIncomingPollIntervalMs,
  deep_forensic: config.forensicDeepPollIntervalMs
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
      deep_forensic: "initial_deep_forensic_cycle_failed"
    },
    intervalErrorEventByLabel: {
      poll: "polling_cycle_failed",
      where_forensic: "where_forensic_cycle_failed",
      incoming_deposit: "incoming_deposit_worker_failed",
      deep_forensic: "deep_forensic_cycle_failed"
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
