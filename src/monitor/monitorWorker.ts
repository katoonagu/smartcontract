import { formatAdminSuspiciousAlert, formatDigestAlert, formatUserIncomingAlert } from "../alerts/formatters";
import { userIncomingAlertKeyboard } from "../alerts/keyboards";
import type { InlineKeyboard } from "grammy";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import { parseTrc20IncomingTransfer } from "../parser/transactionParser";
import { initialAddressPoisoningCheckStatus } from "./addressPoisoning";
import { parseUsdtDecimalToRaw } from "../forensics/usdtAmount";
import { evaluateAddressRisk, type RiskEvaluation } from "../risk/evaluation";
import type { RiskSignal } from "../risk/riskEngine";
import type {
  CustomerAlertRecipient,
  ObservedTransactionDigestItem,
  ObservedTransactionUserAlert,
  UserAlertStatus,
  WalletPollState
} from "../storage/repositories";
import type { AddressLabel, RawEvidenceInput, RiskLevel, RiskReport, RiskSignalObservationInput, TronTransferEvent, WalletAlertMode, WatchedWallet } from "../types";
import type { TronClient } from "../tron/tronClient";

export type MonitorRiskSignals = {
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

type TelegramAlertOptions = {
  reply_markup?: InlineKeyboard;
  parse_mode?: "HTML";
};

type WalletPollStateInput = {
  watchedWalletId: string;
  lastSeenBlockTs?: Date | null;
  lastSeenTxHash?: string | null;
  backfillAnchorBlockTs?: Date | null;
  backfillAnchorTxHash?: string | null;
  backfillNextStart?: number;
  backfillComplete?: boolean;
  lastSuccessfulPollAt?: Date | null;
  lastPollEventCount?: number;
  lastPollNewCount?: number;
  lastPollError?: string | null;
};

type WalletPollSuccessInput = {
  watchedWalletId: string;
  lastSeenBlockTs: Date | null;
  lastSeenTxHash: string | null;
  backfillAnchorBlockTs: Date | null;
  backfillAnchorTxHash: string | null;
  backfillNextStart: number;
  backfillComplete: boolean;
  lastSuccessfulPollAt: Date;
  eventCount: number;
  newCount: number;
};

export type PollingCycleDeps = {
  wallets: WatchedWallet[];
  tronClient: TronClient;
  pageLimit: number;
  maxPagesPerWallet: number;
  backfillLookbackMs: number;
  incomingDepositRealtimeMaxAgeMs?: number;
  addressPoisoningSmallTransferMaxRaw?: string;
  now?: () => Date;
  isWatchedWalletActive?(watchedWalletId: string): Promise<boolean>;
  getWalletPollState(watchedWalletId: string): Promise<WalletPollState | null>;
  upsertWalletPollState(input: WalletPollStateInput): Promise<void>;
  recordWalletPollSuccess?(input: WalletPollSuccessInput): Promise<void>;
  recordWalletPollFailure?(input: { watchedWalletId: string; error: string }): Promise<void>;
  claimObservedTransactionForUserAlert(input: {
    watchedWalletId: string;
    event: TronTransferEvent;
    poisoningCheckStatus: "pending" | "skipped" | "skipped_backfill";
    poisoningCheckReason: string | null;
  }): Promise<boolean>;
  claimUserAlertsForRetry(input: { limit: number; staleSendingBefore: Date }): Promise<ObservedTransactionUserAlert[]>;
  claimDigestTransactions(input: { limit: number; now: Date }): Promise<ObservedTransactionDigestItem[]>;
  recordObservedTransactionRisk(input: { txHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  queueIncomingDepositJob?(input: {
    txHash: string;
    watchedWalletId: string;
    watchedWallet: string;
    sender: string;
    amount: string;
    amountRaw: string;
    timestamp: Date;
    telegramUserId: string;
    chatId: string;
    requestedBy: string;
    alertMode: WalletAlertMode;
    locale?: string | null;
  }): Promise<{ id: string }>;
  markUserAlertAnalyzing?(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertSkipped(input: { txHash: string; watchedWalletId: string; reason: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  markDigestSent(input: { watchedWalletId: string; txHashes: string[] }): Promise<number>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getRiskSignalsForAddress?(address: string, event: TronTransferEvent, wallet: WatchedWallet): Promise<MonitorRiskSignals>;
  recordRiskEvaluation?(evaluation: {
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }): Promise<void>;
  listCustomerAlertRecipients?(ownerTelegramUserId: string): Promise<CustomerAlertRecipient[]>;
  sendUserAlert(telegramUserId: string, message: string, options?: TelegramAlertOptions): Promise<void>;
  sendCustomerAdminAlert?(telegramUserId: string, message: string, options?: TelegramAlertOptions): Promise<void>;
  sendDigestAlert(telegramUserId: string, message: string, options?: TelegramAlertOptions): Promise<void>;
  sendAdminAlert(message: string, options?: TelegramAlertOptions): Promise<void>;
  logger?: Logger;
  userAlertRetryLimit?: number;
  digestClaimLimit?: number;
};

const DEFAULT_INCOMING_DEPOSIT_REALTIME_MAX_AGE_MS = 15 * 60_000;
const DEFAULT_ADDRESS_POISONING_SMALL_TRANSFER_MAX_RAW = "100000000";
const BACKFILL_STALE_TRANSACTION_REASON = "backfill_stale_transaction";

type CollectedWalletEvents = {
  events: TronTransferEvent[];
  reachedCursor: boolean;
  pagesFetched: number;
  pageAnchorBlockTs: Date | null;
  pageAnchorTxHash: string | null;
};

function shouldNotifyAdmins(level: string): boolean {
  return level === "HIGH" || level === "CRITICAL";
}

function shouldNotifyCustomerAdmin(recipient: CustomerAlertRecipient, level: string): boolean {
  return recipient.alertMode === "all" || level !== "LOW";
}

function shouldSendImmediateOwnerAlert(mode: WalletAlertMode, level: RiskLevel): boolean {
  if (mode === "realtime") return true;
  if (mode === "risk_only" || mode === "digest") return level !== "LOW";
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWatchedWalletForeignKeyError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = errorMessage(error).toLowerCase();
  return code === "23503" && message.includes("watched_wallet")
    || message.includes("violates foreign key constraint") && message.includes("watched_wallet");
}

async function isStaleWatchedWallet(wallet: WatchedWallet, deps: PollingCycleDeps): Promise<boolean> {
  if (!deps.isWatchedWalletActive) return false;
  return !(await deps.isWatchedWalletActive(wallet.id));
}

function logStaleWalletSkip(wallet: WatchedWallet, deps: PollingCycleDeps, event: string, error?: unknown): void {
  (deps.logger ?? defaultLogger).warn(event, {
    wallet_id: wallet.id,
    address: wallet.address,
    error: error ? errorMessage(error) : undefined
  });
}

function parseUsdtToMicro(amount: string): bigint {
  const normalized = amount.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function parseUsdtDisplayToRaw(amount: string): string {
  return parseUsdtToMicro(amount).toString();
}

function formatUsdtMicro(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = value % 1_000_000n;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if (fraction === 0n) return wholeText;
  return `${wholeText}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function boundedPollError(error: string): string {
  return error.slice(0, 1024);
}

function incomingDepositRealtimeMaxAgeMs(deps: PollingCycleDeps): number {
  const value = deps.incomingDepositRealtimeMaxAgeMs ?? DEFAULT_INCOMING_DEPOSIT_REALTIME_MAX_AGE_MS;
  if (!Number.isFinite(value)) return DEFAULT_INCOMING_DEPOSIT_REALTIME_MAX_AGE_MS;
  return Math.max(0, Math.floor(value));
}

function normalizedEventAmountRaw(amount: string): string {
  if (amount === "0") return "0";
  return parseUsdtDecimalToRaw(amount) ?? "invalid";
}

async function skipStaleIncomingDepositBackfill(
  event: TronTransferEvent,
  wallet: WatchedWallet,
  deps: PollingCycleDeps,
  ageMs: number,
  maxAgeMs: number
): Promise<void> {
  try {
    await deps.markUserAlertSkipped({
      txHash: event.txHash,
      watchedWalletId: wallet.id,
      reason: BACKFILL_STALE_TRANSACTION_REASON
    });
  } catch (error) {
    (deps.logger ?? defaultLogger).error("incoming_deposit_backfill_skip_status_update_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: errorMessage(error)
    });
    return;
  }

  (deps.logger ?? defaultLogger).info("incoming_deposit_backfill_alert_skipped", {
    wallet_id: wallet.id,
    address: wallet.address,
    tx_hash: event.txHash,
    tx_timestamp: event.timestamp.toISOString(),
    age_ms: ageMs,
    max_age_ms: maxAgeMs
  });
}

function buildDigestAlert(wallet: WatchedWallet, items: ObservedTransactionDigestItem[]) {
  const total = items.reduce((sum, item) => sum + parseUsdtToMicro(item.amount), 0n);
  const uniqueSenders = new Set(items.map((item) => item.sender));
  const riskyItems = items.filter((item) => item.riskLevel !== "LOW");
  const riskySenders = new Set(riskyItems.map((item) => item.sender));
  const topRisky = [...riskyItems].sort((a, b) => b.riskScore - a.riskScore)[0] ?? null;
  return formatDigestAlert({
    walletAddress: wallet.address,
    intervalMinutes: wallet.digestIntervalMinutes,
    transactionCount: items.length,
    totalUsdt: formatUsdtMicro(total),
    uniqueSenderCount: uniqueSenders.size,
    riskyTransactionCount: riskyItems.length,
    riskySenderCount: riskySenders.size,
    topRisky: topRisky ? { level: topRisky.riskLevel, score: topRisky.riskScore, sender: topRisky.sender } : null
  });
}

async function recordPollSuccess(input: WalletPollSuccessInput, deps: PollingCycleDeps): Promise<void> {
  if (deps.recordWalletPollSuccess) {
    await deps.recordWalletPollSuccess(input);
    return;
  }

  await deps.upsertWalletPollState({
    watchedWalletId: input.watchedWalletId,
    lastSeenBlockTs: input.lastSeenBlockTs,
    lastSeenTxHash: input.lastSeenTxHash,
    backfillAnchorBlockTs: input.backfillAnchorBlockTs,
    backfillAnchorTxHash: input.backfillAnchorTxHash,
    backfillNextStart: input.backfillNextStart,
    backfillComplete: input.backfillComplete,
    lastSuccessfulPollAt: input.lastSuccessfulPollAt,
    lastPollEventCount: input.eventCount,
    lastPollNewCount: input.newCount,
    lastPollError: null
  });
}

async function recordPollFailure(wallet: WatchedWallet, error: unknown, deps: PollingCycleDeps): Promise<void> {
  const message = boundedPollError(errorMessage(error));
  const logger = deps.logger ?? defaultLogger;

  try {
    if (deps.recordWalletPollFailure) {
      await deps.recordWalletPollFailure({ watchedWalletId: wallet.id, error: message });
    } else {
      await deps.upsertWalletPollState({ watchedWalletId: wallet.id, lastPollError: message });
    }
  } catch (statusError) {
    if (isWatchedWalletForeignKeyError(statusError) && await isStaleWatchedWallet(wallet, deps)) {
      logStaleWalletSkip(wallet, deps, "wallet_poll_failure_state_skipped_stale_wallet", statusError);
      return;
    }
    logger.error("wallet_poll_failure_state_update_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      error: errorMessage(statusError)
    });
  }

  logger.error("wallet_poll_failed", {
    wallet_id: wallet.id,
    address: wallet.address,
    error: message
  });
}

async function getSignals(
  address: string,
  event: TronTransferEvent,
  wallet: WatchedWallet,
  deps: PollingCycleDeps
): Promise<MonitorRiskSignals> {
  return (
    (await deps.getRiskSignalsForAddress?.(address, event, wallet)) ?? {
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    }
  );
}

async function calculateSenderRisk(
  event: TronTransferEvent,
  wallet: WatchedWallet,
  deps: PollingCycleDeps
): Promise<RiskEvaluation> {
  const [labels, signals] = await Promise.all([
    deps.getLabelsForAddress(event.sender),
    getSignals(event.sender, event, wallet, deps)
  ]);

  return evaluateAddressRisk({
    context: {
      subjectAddress: event.sender,
      observedTransactionHash: event.txHash
    },
    labels,
    graphSignals: signals.graphSignals,
    behaviorSignals: signals.behaviorSignals,
    amlSignals: signals.amlSignals
  });
}

async function sendAdminAlertIfNeeded(
  event: TronTransferEvent,
  wallet: WatchedWallet,
  report: RiskReport,
  deps: PollingCycleDeps
): Promise<void> {
  if (!shouldNotifyAdmins(report.level)) return;

  try {
    const alert = formatAdminSuspiciousAlert({
      telegramUserId: wallet.telegramUserId,
      telegramUsername: wallet.telegramUsername,
      watchedWallet: wallet.address,
      amount: event.amount,
      sender: event.sender,
      txHash: event.txHash,
      report
    });
    await deps.sendAdminAlert(alert.text, { parse_mode: alert.parseMode });
  } catch (error) {
    (deps.logger ?? defaultLogger).error("admin_alert_delivery_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: errorMessage(error)
    });
  }
}

async function sendCustomerAdminAlertsIfNeeded(
  event: TronTransferEvent,
  wallet: WatchedWallet,
  report: RiskReport,
  deps: PollingCycleDeps
): Promise<void> {
  let recipients: CustomerAlertRecipient[] = [];
  try {
    recipients = (await deps.listCustomerAlertRecipients?.(wallet.telegramUserId)) ?? [];
  } catch (error) {
    (deps.logger ?? defaultLogger).error("customer_alert_recipient_lookup_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      owner_telegram_user_id: wallet.telegramUserId,
      tx_hash: event.txHash,
      error: errorMessage(error)
    });
    return;
  }
  if (recipients.length === 0) return;

  const message = formatUserIncomingAlert({
    amount: event.amount,
    watchedWallet: wallet.address,
    sender: event.sender,
    txHash: event.txHash,
    report
  });
  const options = {
    reply_markup: userIncomingAlertKeyboard({ sender: event.sender, txHash: event.txHash }),
    parse_mode: message.parseMode
  };

  for (const recipient of recipients) {
    if (!shouldNotifyCustomerAdmin(recipient, report.level)) continue;

    try {
      const send = deps.sendCustomerAdminAlert ?? deps.sendUserAlert;
      await send(recipient.recipientTelegramUserId, message.text, options);
    } catch (error) {
      (deps.logger ?? defaultLogger).error("customer_admin_alert_delivery_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        owner_telegram_user_id: wallet.telegramUserId,
        recipient_telegram_user_id: recipient.recipientTelegramUserId,
        tx_hash: event.txHash,
        error: errorMessage(error)
      });
    }
  }
}

async function markUserAlertFailedSafely(
  event: TronTransferEvent,
  wallet: WatchedWallet,
  error: string,
  deps: PollingCycleDeps
): Promise<void> {
  try {
    await deps.markUserAlertFailed({ txHash: event.txHash, watchedWalletId: wallet.id, error });
  } catch (statusError) {
    (deps.logger ?? defaultLogger).error("user_alert_failed_status_update_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: errorMessage(statusError)
    });
  }
}

async function deliverUserAlert(event: TronTransferEvent, wallet: WatchedWallet, deps: PollingCycleDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const maxAgeMs = incomingDepositRealtimeMaxAgeMs(deps);
  const ageMs = now.getTime() - event.timestamp.getTime();
  if (ageMs > maxAgeMs) {
    await skipStaleIncomingDepositBackfill(event, wallet, deps, ageMs, maxAgeMs);
    return;
  }

  if (deps.queueIncomingDepositJob && deps.markUserAlertAnalyzing) {
    try {
      await deps.queueIncomingDepositJob({
        txHash: event.txHash,
        watchedWalletId: wallet.id,
        watchedWallet: wallet.address,
        sender: event.sender,
        amount: event.amount,
        amountRaw: parseUsdtDisplayToRaw(event.amount),
        timestamp: event.timestamp,
        telegramUserId: wallet.telegramUserId,
        chatId: wallet.telegramUserId,
        requestedBy: wallet.telegramUserId,
        alertMode: wallet.alertMode,
        locale: wallet.locale ?? null
      });
      await deps.markUserAlertAnalyzing({ txHash: event.txHash, watchedWalletId: wallet.id });
      return;
    } catch (error) {
      const message = errorMessage(error);
      await markUserAlertFailedSafely(event, wallet, message, deps);
      (deps.logger ?? defaultLogger).error("incoming_deposit_job_queue_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        tx_hash: event.txHash,
        error: message
      });
      return;
    }
  }

  let evaluation: RiskEvaluation;

  try {
    evaluation = await calculateSenderRisk(event, wallet, deps);
  } catch (error) {
    const message = errorMessage(error);
    await markUserAlertFailedSafely(event, wallet, message, deps);
    (deps.logger ?? defaultLogger).error("user_alert_risk_calculation_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: message
    });
    return;
  }

  try {
    await deps.recordRiskEvaluation?.({
      rawEvidence: evaluation.rawEvidence,
      observations: evaluation.observations
    });
  } catch (error) {
    const message = errorMessage(error);
    await markUserAlertFailedSafely(event, wallet, message, deps);
    (deps.logger ?? defaultLogger).error("user_alert_risk_evidence_persist_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: message
    });
    return;
  }

  try {
    await deps.recordObservedTransactionRisk({
      txHash: event.txHash,
      watchedWalletId: wallet.id,
      report: evaluation.report
    });
  } catch (error) {
    const message = errorMessage(error);
    await markUserAlertFailedSafely(event, wallet, message, deps);
    (deps.logger ?? defaultLogger).error("user_alert_risk_snapshot_persist_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: message
    });
    return;
  }

  if (!shouldSendImmediateOwnerAlert(wallet.alertMode, evaluation.report.level)) {
    try {
      await deps.markUserAlertSkipped({
        txHash: event.txHash,
        watchedWalletId: wallet.id,
        reason: wallet.alertMode
      });
    } catch (error) {
      (deps.logger ?? defaultLogger).error("user_alert_skipped_status_update_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        tx_hash: event.txHash,
        error: errorMessage(error)
      });
    }
    return;
  }

  try {
    const alert = formatUserIncomingAlert({
      amount: event.amount,
      watchedWallet: wallet.address,
      sender: event.sender,
      txHash: event.txHash,
      report: evaluation.report
    });
    await deps.sendUserAlert(
      wallet.telegramUserId,
      alert.text,
      { reply_markup: userIncomingAlertKeyboard({ sender: event.sender, txHash: event.txHash }), parse_mode: alert.parseMode }
    );
  } catch (error) {
    const message = errorMessage(error);
    await markUserAlertFailedSafely(event, wallet, message, deps);
    (deps.logger ?? defaultLogger).error("user_alert_delivery_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: message
    });
    return;
  }

  try {
    await deps.markUserAlertSent({ txHash: event.txHash, watchedWalletId: wallet.id });
  } catch (error) {
    (deps.logger ?? defaultLogger).error("user_alert_sent_status_update_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: errorMessage(error)
    });
  }

  await sendCustomerAdminAlertsIfNeeded(event, wallet, evaluation.report, deps);
  await sendAdminAlertIfNeeded(event, wallet, evaluation.report, deps);
}

function eventFromObservedAlert(alert: ObservedTransactionUserAlert): TronTransferEvent {
  return {
    txHash: alert.txHash,
    token: alert.token,
    sender: alert.sender,
    receiver: alert.receiver,
    amount: alert.amount,
    timestamp: alert.timestamp
  };
}

async function retryPendingUserAlerts(deps: PollingCycleDeps): Promise<void> {
  const walletById = new Map(deps.wallets.map((wallet) => [wallet.id, wallet]));
  const now = (deps.now ?? (() => new Date()))();
  const alerts = await deps.claimUserAlertsForRetry({
    limit: deps.userAlertRetryLimit ?? 100,
    staleSendingBefore: new Date(now.getTime() - 5 * 60_000)
  });

  for (const alert of alerts) {
    const wallet = walletById.get(alert.watchedWalletId);
    if (!wallet) {
      (deps.logger ?? defaultLogger).warn("user_alert_retry_wallet_missing", {
        wallet_id: alert.watchedWalletId,
        tx_hash: alert.txHash
      });
      continue;
    }

    await deliverUserAlert(eventFromObservedAlert(alert), wallet, deps);
  }
}

async function deliverDueDigestAlerts(deps: PollingCycleDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const walletById = new Map(deps.wallets.map((wallet) => [wallet.id, wallet]));
  const items = await deps.claimDigestTransactions({
    limit: deps.digestClaimLimit ?? 500,
    now
  });

  const grouped = new Map<string, ObservedTransactionDigestItem[]>();
  for (const item of items) {
    const wallet = walletById.get(item.watchedWalletId);
    if (!wallet || wallet.alertMode !== "digest") continue;
    const existing = grouped.get(item.watchedWalletId) ?? [];
    existing.push(item);
    grouped.set(item.watchedWalletId, existing);
  }

  for (const [watchedWalletId, walletItems] of grouped) {
    const wallet = walletById.get(watchedWalletId);
    if (!wallet || walletItems.length === 0) continue;

    try {
      const alert = buildDigestAlert(wallet, walletItems);
      await deps.sendDigestAlert(wallet.telegramUserId, alert.text, { parse_mode: alert.parseMode });
      await deps.markDigestSent({
        watchedWalletId,
        txHashes: walletItems.map((item) => item.txHash)
      });
    } catch (error) {
      (deps.logger ?? defaultLogger).error("digest_alert_delivery_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        tx_count: walletItems.length,
        error: errorMessage(error)
      });
    }
  }
}

function isBackfillContinuation(state: WalletPollState | null): state is WalletPollState {
  return Boolean(state && !state.backfillComplete && state.backfillAnchorBlockTs && state.backfillNextStart > 0);
}

function timestampFloor(wallet: WatchedWallet, state: WalletPollState | null, deps: PollingCycleDeps): number | undefined {
  if (state?.lastSeenBlockTs && !isBackfillContinuation(state)) return undefined;
  const now = (deps.now ?? (() => new Date()))().getTime();
  return Math.max(wallet.createdAt.getTime(), now - deps.backfillLookbackMs);
}

function isAtOrBeforeCursor(event: TronTransferEvent, state: WalletPollState | null): boolean {
  if (!state) return false;
  if (state.lastSeenTxHash && event.txHash === state.lastSeenTxHash) return true;
  if (state.lastSeenBlockTs && event.timestamp.getTime() < state.lastSeenBlockTs.getTime()) return true;
  return false;
}

function sortOldestFirst(events: TronTransferEvent[]): TronTransferEvent[] {
  return [...events].sort((a, b) => {
    const byTime = a.timestamp.getTime() - b.timestamp.getTime();
    if (byTime !== 0) return byTime;
    return a.txHash.localeCompare(b.txHash);
  });
}

function newestEvent(events: TronTransferEvent[]): TronTransferEvent | null {
  if (events.length === 0) return null;
  return [...events].sort((a, b) => {
    const byTime = b.timestamp.getTime() - a.timestamp.getTime();
    if (byTime !== 0) return byTime;
    return b.txHash.localeCompare(a.txHash);
  })[0];
}

async function collectWalletEvents(
  wallet: WatchedWallet,
  state: WalletPollState | null,
  deps: PollingCycleDeps
): Promise<CollectedWalletEvents> {
  const collected: TronTransferEvent[] = [];
  const minTimestamp = timestampFloor(wallet, state, deps);
  const backfillContinuation = isBackfillContinuation(state);
  const startOffset = backfillContinuation ? state.backfillNextStart : 0;
  const endTimestamp = backfillContinuation ? state.backfillAnchorBlockTs?.getTime() : undefined;
  let reachedCursor = false;
  let pagesFetched = 0;
  let pageAnchorBlockTs: Date | null = null;
  let pageAnchorTxHash: string | null = null;

  for (let pageIndex = 0; pageIndex < deps.maxPagesPerWallet; pageIndex++) {
    const start = startOffset + pageIndex * deps.pageLimit;
    const rawTransfers = await deps.tronClient.listIncomingTrc20Transfers(wallet.address, {
      start,
      limit: deps.pageLimit,
      minTimestamp,
      endTimestamp
    });
    pagesFetched += 1;

    const firstRaw = rawTransfers[0];
    if (!pageAnchorBlockTs && firstRaw && typeof firstRaw.block_ts === "number" && Number.isFinite(firstRaw.block_ts)) {
      pageAnchorBlockTs = new Date(firstRaw.block_ts);
      pageAnchorTxHash = typeof firstRaw.transaction_id === "string" ? firstRaw.transaction_id : null;
    }

    (deps.logger ?? defaultLogger).info("wallet_transfer_page_fetched", {
      wallet_id: wallet.id,
      address: wallet.address,
      page_start: start,
      page_limit: deps.pageLimit,
      event_count: rawTransfers.length
    });

    for (const rawTransfer of rawTransfers) {
      const event = parseTrc20IncomingTransfer(rawTransfer, wallet.address);
      if (!event) continue;
      if (isAtOrBeforeCursor(event, state)) {
        reachedCursor = true;
        break;
      }
      collected.push(event);
    }

    if (reachedCursor || rawTransfers.length < deps.pageLimit) break;
  }

  return { events: sortOldestFirst(collected), reachedCursor, pagesFetched, pageAnchorBlockTs, pageAnchorTxHash };
}

async function processWallet(wallet: WatchedWallet, deps: PollingCycleDeps): Promise<void> {
  const state = await deps.getWalletPollState(wallet.id);
  const { events, reachedCursor, pagesFetched, pageAnchorBlockTs, pageAnchorTxHash } = await collectWalletEvents(wallet, state, deps);
  let newCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    const poisoning = initialAddressPoisoningCheckStatus({
      amountRaw: normalizedEventAmountRaw(event.amount),
      sender: event.sender,
      receiver: event.receiver,
      eventAt: event.timestamp,
      now: (deps.now ?? (() => new Date()))(),
      realtimeMaxAgeMs: incomingDepositRealtimeMaxAgeMs(deps),
      maxAmountRaw: deps.addressPoisoningSmallTransferMaxRaw ?? DEFAULT_ADDRESS_POISONING_SMALL_TRANSFER_MAX_RAW,
      alertMode: wallet.alertMode
    });
    const claimed = await deps.claimObservedTransactionForUserAlert({
      watchedWalletId: wallet.id,
      event,
      poisoningCheckStatus: poisoning.status,
      poisoningCheckReason: poisoning.reason
    });
    if (!claimed) {
      skippedCount += 1;
      continue;
    }
    newCount += 1;
    await deliverUserAlert(event, wallet, deps);
  }

  const latestEvent = newestEvent(events);
  const saturatedWithoutCursor = pagesFetched >= deps.maxPagesPerWallet && !reachedCursor;
  const nextBackfillStart = (state?.backfillNextStart ?? 0) + pagesFetched * deps.pageLimit;
  const anchorBlockTs = state?.backfillAnchorBlockTs ?? latestEvent?.timestamp ?? pageAnchorBlockTs ?? null;
  const anchorTxHash = state?.backfillAnchorTxHash ?? latestEvent?.txHash ?? pageAnchorTxHash ?? null;
  const cursorBlockTs = saturatedWithoutCursor ? state?.lastSeenBlockTs ?? null : anchorBlockTs ?? latestEvent?.timestamp ?? state?.lastSeenBlockTs ?? null;
  const cursorTxHash = saturatedWithoutCursor ? state?.lastSeenTxHash ?? null : anchorTxHash ?? latestEvent?.txHash ?? state?.lastSeenTxHash ?? null;

  await recordPollSuccess({
    watchedWalletId: wallet.id,
    lastSeenBlockTs: cursorBlockTs,
    lastSeenTxHash: cursorTxHash,
    backfillAnchorBlockTs: saturatedWithoutCursor ? anchorBlockTs : null,
    backfillAnchorTxHash: saturatedWithoutCursor ? anchorTxHash : null,
    backfillNextStart: saturatedWithoutCursor ? nextBackfillStart : 0,
    backfillComplete: !saturatedWithoutCursor,
    lastSuccessfulPollAt: (deps.now ?? (() => new Date()))(),
    eventCount: events.length,
    newCount
  }, deps);

  (deps.logger ?? defaultLogger).info("wallet_poll_completed", {
    wallet_id: wallet.id,
    address: wallet.address,
    pages_fetched: pagesFetched,
    event_count: events.length,
    new_count: newCount,
    skipped_count: skippedCount,
    cursor_before: state?.lastSeenTxHash ?? null,
    cursor_after: cursorTxHash,
    backfill_next_start: saturatedWithoutCursor ? nextBackfillStart : 0,
    reached_cursor: reachedCursor
  });
}

export async function runSinglePollingCycle(deps: PollingCycleDeps): Promise<void> {
  await retryPendingUserAlerts(deps);

  for (const wallet of deps.wallets) {
    if (await isStaleWatchedWallet(wallet, deps)) {
      logStaleWalletSkip(wallet, deps, "wallet_poll_skipped_stale_wallet");
      continue;
    }
    try {
      await processWallet(wallet, deps);
    } catch (error) {
      if (isWatchedWalletForeignKeyError(error) && await isStaleWatchedWallet(wallet, deps)) {
        logStaleWalletSkip(wallet, deps, "wallet_poll_skipped_stale_wallet", error);
        continue;
      }
      await recordPollFailure(wallet, error, deps);
    }
  }

  await deliverDueDigestAlerts(deps);
}
