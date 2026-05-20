import { formatAdminSuspiciousAlert, formatUserIncomingAlert } from "../alerts/formatters";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import { parseTrc20IncomingTransfer } from "../parser/transactionParser";
import { calculateRisk, type RiskSignal } from "../risk/riskEngine";
import type {
  ObservedTransactionUserAlert,
  UserAlertStatus,
  WalletPollState
} from "../storage/repositories";
import type { AddressLabel, RiskReport, TronTransferEvent, WatchedWallet } from "../types";
import type { TronClient } from "../tron/tronClient";

export type MonitorRiskSignals = {
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

type WalletPollStateInput = {
  watchedWalletId: string;
  lastSeenBlockTs?: Date | null;
  lastSeenTxHash?: string | null;
  backfillComplete?: boolean;
  lastSuccessfulPollAt?: Date | null;
};

export type PollingCycleDeps = {
  wallets: WatchedWallet[];
  tronClient: TronClient;
  pageLimit: number;
  maxPagesPerWallet: number;
  backfillLookbackMs: number;
  now?: () => Date;
  getWalletPollState(watchedWalletId: string): Promise<WalletPollState | null>;
  upsertWalletPollState(input: WalletPollStateInput): Promise<void>;
  claimObservedTransactionForUserAlert(input: { watchedWalletId: string; event: TronTransferEvent }): Promise<boolean>;
  listUserAlertsByStatus(statuses: UserAlertStatus[], limit: number): Promise<ObservedTransactionUserAlert[]>;
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getRiskSignalsForAddress?(address: string, event: TronTransferEvent, wallet: WatchedWallet): Promise<MonitorRiskSignals>;
  sendUserAlert(telegramUserId: string, message: string): Promise<void>;
  sendAdminAlert(message: string): Promise<void>;
  logger?: Logger;
  userAlertRetryLimit?: number;
};

type CollectedWalletEvents = {
  events: TronTransferEvent[];
  reachedCursor: boolean;
  pagesFetched: number;
};

function shouldNotifyAdmins(level: string): boolean {
  return level === "HIGH" || level === "CRITICAL";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
): Promise<RiskReport> {
  const [labels, signals] = await Promise.all([
    deps.getLabelsForAddress(event.sender),
    getSignals(event.sender, event, wallet, deps)
  ]);

  return calculateRisk({
    subjectAddress: event.sender,
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
    await deps.sendAdminAlert(
      formatAdminSuspiciousAlert({
        telegramUserId: wallet.telegramUserId,
        telegramUsername: wallet.telegramUsername,
        watchedWallet: wallet.address,
        amount: event.amount,
        sender: event.sender,
        txHash: event.txHash,
        report
      })
    );
  } catch (error) {
    (deps.logger ?? defaultLogger).error("admin_alert_delivery_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: errorMessage(error)
    });
  }
}

async function deliverUserAlert(event: TronTransferEvent, wallet: WatchedWallet, deps: PollingCycleDeps): Promise<void> {
  const report = await calculateSenderRisk(event, wallet, deps);

  try {
    await deps.sendUserAlert(
      wallet.telegramUserId,
      formatUserIncomingAlert({
        amount: event.amount,
        sender: event.sender,
        txHash: event.txHash,
        report
      })
    );
    await deps.markUserAlertSent({ txHash: event.txHash, watchedWalletId: wallet.id });
    await sendAdminAlertIfNeeded(event, wallet, report, deps);
  } catch (error) {
    const message = errorMessage(error);
    await deps.markUserAlertFailed({ txHash: event.txHash, watchedWalletId: wallet.id, error: message });
    (deps.logger ?? defaultLogger).error("user_alert_delivery_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      tx_hash: event.txHash,
      error: message
    });
  }
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
  const alerts = await deps.listUserAlertsByStatus(["pending", "failed"], deps.userAlertRetryLimit ?? 100);

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

function timestampFloor(wallet: WatchedWallet, state: WalletPollState | null, deps: PollingCycleDeps): number | undefined {
  if (state?.lastSeenBlockTs) return undefined;
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
  let reachedCursor = false;
  let pagesFetched = 0;

  for (let pageIndex = 0; pageIndex < deps.maxPagesPerWallet; pageIndex++) {
    const start = pageIndex * deps.pageLimit;
    const rawTransfers = await deps.tronClient.listIncomingTrc20Transfers(wallet.address, {
      start,
      limit: deps.pageLimit,
      minTimestamp
    });
    pagesFetched += 1;

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

  return { events: sortOldestFirst(collected), reachedCursor, pagesFetched };
}

async function processWallet(wallet: WatchedWallet, deps: PollingCycleDeps): Promise<void> {
  const state = await deps.getWalletPollState(wallet.id);
  const { events, reachedCursor, pagesFetched } = await collectWalletEvents(wallet, state, deps);
  let newCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    const claimed = await deps.claimObservedTransactionForUserAlert({ watchedWalletId: wallet.id, event });
    if (!claimed) {
      skippedCount += 1;
      continue;
    }
    newCount += 1;
    await deliverUserAlert(event, wallet, deps);
  }

  const latestEvent = newestEvent(events);
  await deps.upsertWalletPollState({
    watchedWalletId: wallet.id,
    lastSeenBlockTs: latestEvent?.timestamp ?? state?.lastSeenBlockTs ?? null,
    lastSeenTxHash: latestEvent?.txHash ?? state?.lastSeenTxHash ?? null,
    backfillComplete: true,
    lastSuccessfulPollAt: (deps.now ?? (() => new Date()))()
  });

  (deps.logger ?? defaultLogger).info("wallet_poll_completed", {
    wallet_id: wallet.id,
    address: wallet.address,
    pages_fetched: pagesFetched,
    event_count: events.length,
    new_count: newCount,
    skipped_count: skippedCount,
    cursor_before: state?.lastSeenTxHash ?? null,
    cursor_after: latestEvent?.txHash ?? state?.lastSeenTxHash ?? null,
    reached_cursor: reachedCursor
  });
}

export async function runSinglePollingCycle(deps: PollingCycleDeps): Promise<void> {
  await retryPendingUserAlerts(deps);

  for (const wallet of deps.wallets) {
    await processWallet(wallet, deps);
  }
}
