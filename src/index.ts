import { sendServiceAdminAlert } from "./alerts/adminDelivery";
import { runSingleApprovalPollingCycle } from "./approvals/approvalWorker";
import { createBot } from "./bot/createBot";
import { loadConfig } from "./config";
import { logger } from "./logging/logger";
import { runSinglePollingCycle } from "./monitor/monitorWorker";
import { closeDb, createDb } from "./storage/db";
import {
  claimObservedTransactionForUserAlert,
  claimObservedApprovalEvent,
  claimObservedApprovalDrainEvent,
  claimDigestTransactions,
  claimUserAlertsForRetry,
  getApprovalPollState,
  getAddressMetadata,
  getContractIntelligenceProfile,
  getWalletPollState,
  markApprovalOwnerAlertFailed,
  markApprovalOwnerAlertSent,
  markApprovalOwnerAlertSkipped,
  listCustomerAlertRecipients,
  listAddressLabels,
  markDigestSent,
  listWatchedWallets,
  markUserAlertFailed,
  markUserAlertSent,
  markUserAlertSkipped,
  recordApprovalPollFailure,
  recordApprovalPollSuccess,
  recordApprovalRisk,
  recordObservedTransactionRisk,
  saveRiskEvaluationEvidence,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertWalletApproval,
  upsertWalletPollState
} from "./storage/repositories";
import { TronscanClient } from "./tron/tronClient";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const tronClient = new TronscanClient({
  baseUrl: config.tronscanBaseUrl,
  fullNodeBaseUrl: config.tronFullNodeBaseUrl,
  apiKey: config.tronscanApiKey,
  fullNodeApiKey: config.tronFullNodeApiKey,
  timeoutMs: config.tronscanTimeoutMs,
  retryAttempts: config.tronscanRetryAttempts,
  retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs
});
const bot = createBot(config, db, tronClient);

let activePoll: Promise<void> | null = null;
let shuttingDown = false;

async function sendAdminAlert(message: string): Promise<void> {
  await sendServiceAdminAlert({
    adminIds: config.serviceAdminTelegramIds,
    message,
    sendMessage: async (telegramUserId, alertMessage) => {
      await bot.api.sendMessage(telegramUserId, alertMessage);
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
      getWalletPollState: (watchedWalletId) => getWalletPollState(db, watchedWalletId),
      upsertWalletPollState: (input) => upsertWalletPollState(db, input),
      claimObservedTransactionForUserAlert: (input) => claimObservedTransactionForUserAlert(db, input),
      claimUserAlertsForRetry: (input) => claimUserAlertsForRetry(db, input),
      claimDigestTransactions: (input) => claimDigestTransactions(db, input),
      recordObservedTransactionRisk: (input) => recordObservedTransactionRisk(db, input),
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
      sendDigestAlert: async (telegramUserId, message) => {
        await bot.api.sendMessage(telegramUserId, message);
      },
      sendAdminAlert,
      logger
    });
    await runSingleApprovalPollingCycle({
      wallets,
      tronClient,
      pageLimit: config.tronscanPageLimit,
      maxPagesPerWallet: config.tronscanMaxPagesPerWallet,
      getApprovalPollState: (watchedWalletId) => getApprovalPollState(db, watchedWalletId),
      recordApprovalPollSuccess: (input) => recordApprovalPollSuccess(db, input),
      recordApprovalPollFailure: (input) => recordApprovalPollFailure(db, input),
      upsertWalletApproval: (input) => upsertWalletApproval(db, input),
      claimObservedApprovalEvent: (input) => claimObservedApprovalEvent(db, input),
      claimObservedApprovalDrainEvent: (input) => claimObservedApprovalDrainEvent(db, input),
      recordApprovalRisk: (input) => recordApprovalRisk(db, input),
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
  })().finally(() => {
    activePoll = null;
  });

  return activePoll;
}

const pollInterval = setInterval(() => {
  pollOnce().catch((error) => {
    logger.error("polling_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
  });
}, config.pollIntervalMs);

pollOnce().catch((error) => {
  logger.error("initial_polling_cycle_failed", { error: error instanceof Error ? error.message : String(error) });
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_started", { signal });
  clearInterval(pollInterval);

  if (activePoll) {
    try {
      await activePoll;
    } catch (error) {
      logger.error("active_poll_shutdown_wait_failed", { error: error instanceof Error ? error.message : String(error) });
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
