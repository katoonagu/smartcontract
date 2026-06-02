import { sendServiceAdminAlert } from "./alerts/adminDelivery";
import { formatIncomingDepositRiskAlert } from "./alerts/formatters";
import { normalizeBotLocale } from "./bot/i18n";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "./approvals/approvalWorker";
import { createBot, formatDeepForensicReport, formatWhereIsMoneyReport } from "./bot/createBot";
import { loadConfig } from "./config";
import { createContractLlmVerdictAnalyzer } from "./forensics/contractLlmVerdict";
import { enrichContractClassification } from "./forensics/contractEnrichment";
import { createEtherscanV2EvmEvidenceProvider } from "./forensics/evmExplorerClient";
import { runForensicJobBatch } from "./forensics/forensicJobBatch";
import { runSingleDeepForensicJobCycle } from "./forensics/deepForensicJob";
import { buildIncomingDepositReport, runSingleIncomingDepositJobCycle, type IncomingDepositRuntimeDeps } from "./forensics/incomingDepositJob";
import { withLlmEnrichmentRetry } from "./forensics/llmEnrichmentRetry";
import { createRangeCrossChainDiscoveryProvider, RANGE_ENDPOINT_PATHS } from "./forensics/rangeClient";
import { classifyServiceAddress } from "./forensics/serviceClassifier";
import { createOpenAiCompatibleJsonClient } from "./llm/openAiCompatibleJsonClient";
import { logger } from "./logging/logger";
import { createCachedAddressMetadataResolver } from "./metadata/addressMetadataCache";
import { runSinglePollingCycle } from "./monitor/monitorWorker";
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
  listIndexedTronUsdtTransfersForAddress,
  listAddressLabels,
  markDigestSent,
  markUserAlertAnalyzing,
  listWatchedWallets,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  recordObservedTransactionRisk,
  releaseApprovalContextAfterFailure,
  saveRiskEvaluationEvidence,
  createOrReuseForensicCheckJob,
  upsertAddressLabelAssertion,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertContractLlmVerdictCache,
  upsertWalletApproval,
  upsertWalletPollState,
  watchedWalletExists
} from "./storage/repositories";
import type { ForensicCheckJobKind } from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";
import { createTronscanScheduler } from "./tron/tronscanScheduler";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tronscanScheduler = createTronscanScheduler({
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
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
  scheduler: tronscanScheduler
});
const bot = createBot(config, db, tronClient);
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

logger.info("tronscan_scheduler_configured", tronscanScheduler.diagnostics());

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

async function runForensicJobsOnce(kinds: ForensicCheckJobKind[], maxJobs: number): Promise<number> {
  return runForensicJobBatch({
    maxJobs,
    runSingleCycle: () => runSingleDeepForensicJobCycle({
      tronClient,
      claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds }),
      completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
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
        const message = formatDeepForensicReport(job, report, status, {
          runtimeLabel: config.runtimeInstanceLabel,
          locale: normalizeBotLocale(job.progressJson.locale)
        });
        await bot.api.sendMessage(job.chatId, message.text, { parse_mode: message.parseMode });
      },
      sendWhereIsMoneyJobResult: async (job, report, status) => {
        if (!job.chatId) return;
        const message = formatWhereIsMoneyReport(job, report, status, {
          runtimeLabel: config.runtimeInstanceLabel,
          locale: normalizeBotLocale(job.progressJson.locale)
        });
        await bot.api.sendMessage(job.chatId, message.text, { parse_mode: message.parseMode });
      },
      sendJobFailure: async (job, error) => {
        if (!job.chatId) return;
        const label = job.kind === "where_is_money_check" ? "Where is money job" : "Deep forensic job";
        await bot.api.sendMessage(job.chatId, `${label} failed: ${error}`);
      }
    }, {
      pageLimit: config.tronscanPageLimit,
      maxPagesPerAddress: 2,
      maxExpandedIntermediates: 10,
      metadataFetchLimit: 12,
      contractProfileFetchLimit: 5,
      maxInboundSenders: 5,
      maxApprovalDrainCandidates: 5,
      approvalChangeLookupLimit: 5,
      extendedSearchMode: "auto",
      extendedSearchMaxDepth: 4,
      extendedSearchBeamWidth: 8,
      extendedSearchMaxAddressFetches: 60,
      crossChainStage2Enabled: config.crossChainStage2Enabled,
      crossChainMaxProviderCalls: config.crossChainStage2MaxProviderCalls,
      apiKeyConfigured: tronscanScheduler.diagnostics().apiKeyConfigured
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
  activeIncomingDepositPoll = runForensicJobBatch({
    maxJobs: config.forensicWhereJobsPerPoll,
    runSingleCycle: () => runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: () => claimNextForensicCheckJob(db, { kinds: ["incoming_deposit_check"] }),
      completeForensicCheckJob: (input) => completeForensicCheckJob(db, input),
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
  })
    .then((handled) => {
      if (handled > 0) logger.info("incoming_deposit_jobs_processed", { handled });
    })
    .finally(() => {
      activeIncomingDepositPoll = null;
    });
  return activeIncomingDepositPoll;
}

const pollInterval = setInterval(() => {
  pollOnce().catch((error) => {
    logger.error("polling_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
  });
}, config.pollIntervalMs);

const whereForensicInterval = setInterval(() => {
  whereForensicOnce().catch((error) => {
    logger.error("where_forensic_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
  });
}, config.forensicWherePollIntervalMs);

const deepForensicInterval = setInterval(() => {
  deepForensicOnce().catch((error) => {
    logger.error("deep_forensic_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
  });
}, config.forensicDeepPollIntervalMs);

const incomingDepositInterval = setInterval(() => {
  incomingDepositOnce().catch((error) => {
    logger.error("incoming_deposit_worker_failed", { error: error instanceof Error ? error.message : String(error) });
  });
}, config.forensicWherePollIntervalMs);

pollOnce().catch((error) => {
  logger.error("initial_polling_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
});

whereForensicOnce().catch((error) => {
  logger.error("initial_where_forensic_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
});

deepForensicOnce().catch((error) => {
  logger.error("initial_deep_forensic_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
});

incomingDepositOnce().catch((error) => {
  logger.error("initial_incoming_deposit_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_started", { signal });
  clearInterval(pollInterval);
  clearInterval(whereForensicInterval);
  clearInterval(deepForensicInterval);
  clearInterval(incomingDepositInterval);

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
  }
}).catch((error) => {
  logger.error("telegram_bot_failed", { error: error instanceof Error ? error.message : String(error) });
  void shutdown("SIGTERM").then(() => {
    process.exitCode = 1;
  });
});
