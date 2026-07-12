import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  ADDRESS_POISONING_POLICY_VERSION,
  detectAddressPoisoning,
  type AddressPoisoningMatch,
  type AddressPoisoningSuppression,
  type AddressPoisoningTransfer
} from "./addressPoisoning";
import {
  normalizeTronscanTransferForAddressIndex,
  shouldIndexCanonicalTronscanUsdtTransfer
} from "../forensics/tronAddressAllTimeIndex";
import { authoritativeRegisteredService } from "../forensics/serviceClassifier";
import { parseUsdtDecimalToRaw } from "../forensics/usdtAmount";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import {
  addressPoisoningAlertFingerprint,
  addressPoisoningAlertKeyboard,
  formatAddressPoisoningAlert
} from "../alerts/addressPoisoningAlert";
import {
  claimAddressPoisoningAlertsForDelivery,
  claimAddressPoisoningChecks,
  listAddressLabels,
  markAddressPoisoningAlertFailed,
  markAddressPoisoningAlertSent,
  markAddressPoisoningAlertSkipped,
  markAddressPoisoningCheckClear,
  markAddressPoisoningCheckFailed,
  markAddressPoisoningCheckInconclusive,
  persistAddressPoisoningCandidate,
  skipExpiredAddressPoisoningChecks,
  skipPausedAddressPoisoningChecks
} from "../storage/repositories";
import type { Db } from "../storage/db";
import type {
  AddressLabel,
  AddressPoisoningCandidateDelivery,
  AddressPoisoningCheckWorkItem,
  PersistAddressPoisoningCandidateInput
} from "../types";
import type { ListRelatedTrc20TransfersOptions } from "../tron/tronClient";

export const ADDRESS_POISONING_WORKER_DEFAULTS = {
  claimLimit: 20,
  concurrency: 2,
  pageSize: 100,
  maxPages: 5,
  retryDelayMs: 30_000
} as const;

const LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export type AddressPoisoningCycleMetrics = {
  expiredSkipped: number;
  pausedSkipped: number;
  claimed: number;
  processed: number;
  candidates: number;
  cleared: number;
  inconclusive: number;
  failed: number;
  stale: number;
  alertsClaimed: number;
  alertsSent: number;
  alertsFailed: number;
  alertsSkipped: number;
  alertsStale: number;
  alertsPersistenceFailed: number;
};

type MarkClearInput = Parameters<typeof markAddressPoisoningCheckClear>[1];
type MarkInconclusiveInput = Parameters<typeof markAddressPoisoningCheckInconclusive>[1];
type MarkFailedInput = Parameters<typeof markAddressPoisoningCheckFailed>[1];
type MarkAlertSentInput = Parameters<typeof markAddressPoisoningAlertSent>[1];
type MarkAlertFailedInput = Parameters<typeof markAddressPoisoningAlertFailed>[1];
type MarkAlertSkippedInput = Parameters<typeof markAddressPoisoningAlertSkipped>[1];

export type AddressPoisoningWorkerRepository = {
  skipExpiredChecks(db: Db, input: { expiredBefore: Date }): Promise<number>;
  skipPausedChecks(db: Db): Promise<number>;
  claimChecks(
    db: Db,
    input: { limit: number; now: Date; staleRunningBefore: Date }
  ): Promise<AddressPoisoningCheckWorkItem[]>;
  listAddressLabels(db: Db, address: string): Promise<AddressLabel[]>;
  markClear(db: Db, input: MarkClearInput): Promise<boolean>;
  markInconclusive(db: Db, input: MarkInconclusiveInput): Promise<boolean>;
  markFailed(db: Db, input: MarkFailedInput): Promise<boolean>;
  persistCandidate(db: Db, input: PersistAddressPoisoningCandidateInput): Promise<unknown>;
  claimAlerts(
    db: Db,
    input: { limit: number; now: Date; staleSendingBefore: Date }
  ): Promise<AddressPoisoningCandidateDelivery[]>;
  markAlertSent(db: Db, input: MarkAlertSentInput): Promise<boolean>;
  markAlertFailed(db: Db, input: MarkAlertFailedInput): Promise<boolean>;
  markAlertSkipped(db: Db, input: MarkAlertSkippedInput): Promise<boolean>;
};

export type AddressPoisoningWorkerDeps = {
  db: Db;
  tronClient: {
    listRelatedTrc20Transfers(
      address: string,
      options?: ListRelatedTrc20TransfersOptions
    ): Promise<RawTronscanTrc20Transfer[]>;
  };
  realtimeMaxAgeMs: number;
  sendUserAlert(
    telegramUserId: string,
    message: string,
    options: { reply_markup: ReturnType<typeof addressPoisoningAlertKeyboard>; parse_mode: "HTML" }
  ): Promise<{ chat: { id: number }; message_id: number }>;
  now?: () => Date;
  logger?: Logger;
  repository?: AddressPoisoningWorkerRepository;
};

export type AddressPoisoningWorkerOptions = {
  claimLimit?: number;
  concurrency?: number;
  pageSize?: number;
  maxPages?: number;
  retryDelayMs?: number;
};

type StoredTransfer = {
  transferId: string;
  txHash: string;
  sender: string;
  receiver: string;
  amountRaw: string;
  occurredAt: string;
};

type AccumulatedLookup = {
  version: 1;
  transfers: StoredTransfer[];
  providerFacts: RawTronscanTrc20Transfer[];
  providerTransferIds: string[];
};

const defaultRepository: AddressPoisoningWorkerRepository = {
  skipExpiredChecks: skipExpiredAddressPoisoningChecks,
  skipPausedChecks: skipPausedAddressPoisoningChecks,
  claimChecks: claimAddressPoisoningChecks,
  listAddressLabels,
  markClear: markAddressPoisoningCheckClear,
  markInconclusive: markAddressPoisoningCheckInconclusive,
  markFailed: markAddressPoisoningCheckFailed,
  persistCandidate: persistAddressPoisoningCandidate,
  claimAlerts: claimAddressPoisoningAlertsForDelivery,
  markAlertSent: markAddressPoisoningAlertSent,
  markAlertFailed: markAddressPoisoningAlertFailed,
  markAlertSkipped: markAddressPoisoningAlertSkipped
};

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum?: number): number {
  if (value === undefined || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return maximum === undefined ? value : Math.min(value, maximum);
}

function workerOptions(options: AddressPoisoningWorkerOptions) {
  return {
    claimLimit: boundedPositiveInteger(
      options.claimLimit,
      ADDRESS_POISONING_WORKER_DEFAULTS.claimLimit,
      ADDRESS_POISONING_WORKER_DEFAULTS.claimLimit
    ),
    concurrency: boundedPositiveInteger(
      options.concurrency,
      ADDRESS_POISONING_WORKER_DEFAULTS.concurrency,
      ADDRESS_POISONING_WORKER_DEFAULTS.concurrency
    ),
    pageSize: boundedPositiveInteger(
      options.pageSize,
      ADDRESS_POISONING_WORKER_DEFAULTS.pageSize,
      ADDRESS_POISONING_WORKER_DEFAULTS.pageSize
    ),
    maxPages: boundedPositiveInteger(
      options.maxPages,
      ADDRESS_POISONING_WORKER_DEFAULTS.maxPages,
      ADDRESS_POISONING_WORKER_DEFAULTS.maxPages
    ),
    retryDelayMs: boundedPositiveInteger(options.retryDelayMs, ADDRESS_POISONING_WORKER_DEFAULTS.retryDelayMs)
  };
}

function emptyLookup(): AccumulatedLookup {
  return { version: 1, transfers: [], providerFacts: [], providerTransferIds: [] };
}

function isStoredTransfer(value: unknown): value is StoredTransfer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.transferId === "string"
    && typeof row.txHash === "string"
    && typeof row.sender === "string"
    && typeof row.receiver === "string"
    && typeof row.amountRaw === "string"
    && /^\d+$/.test(row.amountRaw)
    && typeof row.occurredAt === "string"
    && Number.isFinite(new Date(row.occurredAt).getTime());
}

function parseAccumulatedLookup(value: Record<string, unknown>): AccumulatedLookup {
  if (Object.keys(value).length === 0) return emptyLookup();
  if (
    value.version !== 1
    || !Array.isArray(value.transfers)
    || !value.transfers.every(isStoredTransfer)
    || !Array.isArray(value.providerFacts)
    || !value.providerFacts.every((fact) => fact !== null && typeof fact === "object" && !Array.isArray(fact))
    || !Array.isArray(value.providerTransferIds)
    || !value.providerTransferIds.every((id) => typeof id === "string")
    || value.providerFacts.length !== value.providerTransferIds.length
  ) {
    throw new Error("Malformed accumulated address-poisoning lookup");
  }
  return {
    version: 1,
    transfers: [...value.transfers],
    providerFacts: value.providerFacts as RawTronscanTrc20Transfer[],
    providerTransferIds: [...value.providerTransferIds]
  };
}

function validNormalizedTransfer(transfer: StoredTransfer): boolean {
  return TRON_ADDRESS.test(transfer.sender)
    && TRON_ADDRESS.test(transfer.receiver)
    && transfer.sender !== transfer.receiver
    && /^\d+$/.test(transfer.amountRaw)
    && BigInt(transfer.amountRaw) > 0n;
}

function mergePage(
  accumulated: AccumulatedLookup,
  page: RawTronscanTrc20Transfer[],
  incomingAt: Date
): AccumulatedLookup {
  const byId = new Map(accumulated.transfers.map((transfer) => [transfer.transferId, transfer]));
  const factsById = new Map(accumulated.providerTransferIds.map((id, index) => [id, accumulated.providerFacts[index]]));
  for (const raw of page) {
    if (!shouldIndexCanonicalTronscanUsdtTransfer(raw)) continue;
    const normalized = normalizeTronscanTransferForAddressIndex(raw, "tronscan");
    if (!normalized.transferId) continue;
    const elapsedMs = incomingAt.getTime() - normalized.blockTimestamp.getTime();
    const stored: StoredTransfer = {
      transferId: normalized.transferId,
      txHash: normalized.txHash,
      sender: normalized.fromAddress,
      receiver: normalized.toAddress,
      amountRaw: normalized.amountRaw,
      occurredAt: normalized.blockTimestamp.toISOString()
    };
    if (elapsedMs <= 0 || elapsedMs > LOOKBACK_MS || !validNormalizedTransfer(stored)) continue;
    if (!byId.has(stored.transferId)) byId.set(stored.transferId, stored);
    if (!factsById.has(stored.transferId)) factsById.set(stored.transferId, raw);
  }
  const transfers = [...byId.values()].sort((left, right) =>
    new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
    || left.transferId.localeCompare(right.transferId));
  const providerTransferIds = [...factsById.keys()].sort();
  return {
    version: 1,
    transfers,
    providerTransferIds,
    providerFacts: providerTransferIds.map((id) => factsById.get(id)!)
  };
}

function detectorTransfer(stored: StoredTransfer): AddressPoisoningTransfer {
  return {
    txHash: stored.txHash,
    sender: stored.sender,
    receiver: stored.receiver,
    amountRaw: stored.amountRaw,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenDecimals: 6,
    occurredAt: new Date(stored.occurredAt)
  };
}

function exactSuppression(labels: AddressLabel[], sender: string): AddressPoisoningSuppression | null {
  if (labels.some((label) =>
    label.address === sender
    && label.source === "service_admin"
    && (label.label === "trusted" || label.label === "false_positive"))) {
    return { kind: "trusted_sender", address: sender };
  }
  return authoritativeRegisteredService(sender)
    ? { kind: "authoritative_service", address: sender }
    : null;
}

function oldestAcceptedTransferAt(accumulated: AccumulatedLookup): Date | null {
  return accumulated.transfers.reduce<Date | null>((oldest, transfer) => {
    const occurredAt = new Date(transfer.occurredAt);
    return !oldest || occurredAt < oldest ? occurredAt : oldest;
  }, null);
}

function senderAppearedInCheckedHistory(
  accumulated: AccumulatedLookup,
  walletAddress: string,
  suspiciousSender: string,
  incomingAt: Date
): boolean {
  return accumulated.transfers.some((transfer) => {
    const elapsedMs = incomingAt.getTime() - new Date(transfer.occurredAt).getTime();
    const directRelation = (transfer.sender === walletAddress && transfer.receiver === suspiciousSender)
      || (transfer.sender === suspiciousSender && transfer.receiver === walletAddress);
    return directRelation && elapsedMs > 0 && elapsedMs <= LOOKBACK_MS;
  });
}

function serializableMatch(match: AddressPoisoningMatch): Record<string, unknown> {
  return { ...match, outgoingAt: match.outgoingAt.toISOString() };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedDeliveryError(error: unknown): string {
  const clean = errorMessage(error).replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "telegram_delivery_failed").slice(0, 500);
}

function currentTime(deps: Pick<AddressPoisoningWorkerDeps, "now">): Date {
  const value = deps.now?.() ?? new Date();
  return new Date(value.getTime());
}

function lostLease(error: unknown): boolean {
  return error instanceof Error && error.message.includes("lost its running check lease");
}

async function processWorkItem(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  item: AddressPoisoningCheckWorkItem,
  options: ReturnType<typeof workerOptions>,
  metrics: AddressPoisoningCycleMetrics,
  now: Date,
  logger: Logger
): Promise<void> {
  try {
    const accumulatedBefore = parseAccumulatedLookup(item.accumulatedLookupJson);
    const incomingAmountRaw = parseUsdtDecimalToRaw(item.amount);
    if (!incomingAmountRaw) throw new Error("Invalid observed USDT amount for address-poisoning lookup");

    const page = await deps.tronClient.listRelatedTrc20Transfers(item.walletAddress, {
      start: item.logicalOffset,
      limit: options.pageSize,
      minTimestamp: item.timestamp.getTime() - LOOKBACK_MS,
      endTimestamp: item.timestamp.getTime() - 1
    });
    if (!Array.isArray(page)) throw new Error("Address-poisoning provider page is not an array");

    const accumulated = mergePage(accumulatedBefore, page, item.timestamp);
    const complete = page.length < options.pageSize;
    const coverage = complete ? "complete" as const : "partial" as const;
    const logicalOffset = item.logicalOffset + page.length;
    const pageCount = item.pageCount + 1;
    const fetchedCount = item.fetchedCount + page.length;
    const oldest = oldestAcceptedTransferAt(accumulated);
    const senderSeen = senderAppearedInCheckedHistory(accumulated, item.walletAddress, item.sender, item.timestamp);
    const labels = await repository.listAddressLabels(deps.db, item.sender);
    const result = detectAddressPoisoning({
      incoming: {
        txHash: item.txHash,
        sender: item.sender,
        receiver: item.receiver,
        amountRaw: incomingAmountRaw,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenDecimals: 6,
        occurredAt: item.timestamp
      },
      checkedTransfers: accumulated.transfers.map(detectorTransfer),
      coverage,
      suppression: exactSuppression(labels, item.sender)
    });
    const commonProgress = {
      txHash: item.txHash,
      watchedWalletId: item.watchedWalletId,
      coverage,
      logicalOffset,
      pageCount,
      fetchedCount,
      oldestFetchedAt: oldest,
      accumulatedLookupJson: accumulated,
      leaseVersion: item.leaseVersion
    };

    if (result.kind === "candidate") {
      const primary = result.primary;
      await repository.persistCandidate(deps.db, {
        policyVersion: ADDRESS_POISONING_POLICY_VERSION,
        walletAddress: item.walletAddress,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenDecimals: 6,
        suspiciousIncomingTxHash: item.txHash,
        suspiciousSender: item.sender,
        suspiciousAmountRaw: incomingAmountRaw,
        suspiciousIncomingAt: item.timestamp,
        matchedOutgoingTxHash: primary.outgoingTxHash,
        genuineRecipient: primary.genuineRecipient,
        matchedOutgoingAmountRaw: primary.outgoingAmountRaw,
        matchedOutgoingAt: primary.outgoingAt,
        rawPrefixLength: primary.rawPrefixLength,
        meaningfulPrefixLength: primary.meaningfulPrefixLength,
        suffixLength: primary.suffixLength,
        classification: primary.classification,
        confidence: primary.classification === "CRITICAL" ? "high" : "medium",
        secondaryMatches: result.secondary.map(serializableMatch),
        evidenceJson: {
          policyVersion: ADDRESS_POISONING_POLICY_VERSION,
          coverage,
          windowStart: new Date(item.timestamp.getTime() - LOOKBACK_MS).toISOString(),
          windowEnd: new Date(item.timestamp.getTime() - 1).toISOString(),
          fetchedCount,
          acceptedTransferCount: accumulated.transfers.length,
          pageCount,
          logicalOffset,
          oldestFetchedAt: oldest?.toISOString() ?? null,
          oldestFetchedAtBasis: "oldest_accepted_canonical_transfer",
          senderAppearedInCheckedHistory: senderSeen,
          incoming: {
            txHash: item.txHash,
            sender: item.sender,
            receiver: item.receiver,
            amountRaw: incomingAmountRaw,
            occurredAt: item.timestamp.toISOString()
          },
          primaryMatch: serializableMatch(primary),
          providerFacts: accumulated.providerFacts,
          providerTransferIds: accumulated.providerTransferIds
        },
        ...commonProgress
      });
      metrics.candidates += 1;
      return;
    }

    if (result.kind === "clear") {
      const updated = await repository.markClear(deps.db, { ...commonProgress, reason: result.reason });
      updated ? metrics.cleared += 1 : metrics.stale += 1;
      return;
    }

    const terminal = pageCount >= options.maxPages;
    const updated = await repository.markInconclusive(deps.db, {
      ...commonProgress,
      coverage: "partial",
      nextRetryAt: terminal ? null : new Date(now.getTime() + options.retryDelayMs),
      reason: terminal ? "max_pages_reached" : result.reason
    });
    updated ? metrics.inconclusive += 1 : metrics.stale += 1;
  } catch (error) {
    if (lostLease(error)) {
      metrics.stale += 1;
      return;
    }
    logger.warn("address_poisoning_check_failed", {
      txHash: item.txHash,
      watchedWalletId: item.watchedWalletId,
      error: errorMessage(error)
    });
    try {
      const updated = await repository.markFailed(deps.db, {
        txHash: item.txHash,
        watchedWalletId: item.watchedWalletId,
        error: errorMessage(error),
        now,
        leaseVersion: item.leaseVersion
      });
      updated ? metrics.failed += 1 : metrics.stale += 1;
    } catch (persistenceError) {
      metrics.failed += 1;
      logger.error("address_poisoning_failure_persistence_failed", {
        txHash: item.txHash,
        watchedWalletId: item.watchedWalletId,
        error: errorMessage(persistenceError)
      });
    }
  } finally {
    metrics.processed += 1;
  }
}

async function markDeliveryFailure(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  candidate: AddressPoisoningCandidateDelivery,
  error: unknown,
  metrics: AddressPoisoningCycleMetrics,
  failedAt: Date,
  logger: Logger
): Promise<void> {
  logger.warn("address_poisoning_alert_delivery_failed", {
    candidateId: candidate.id,
    error: boundedDeliveryError(error)
  });
  try {
    const updated = await repository.markAlertFailed(deps.db, {
      candidateId: candidate.id,
      error: boundedDeliveryError(error),
      now: failedAt,
      leaseVersion: candidate.leaseVersion
    });
    updated ? metrics.alertsFailed += 1 : metrics.alertsStale += 1;
  } catch (persistenceError) {
    metrics.alertsPersistenceFailed += 1;
    logger.error("address_poisoning_alert_failure_persistence_failed", {
      candidateId: candidate.id,
      error: boundedDeliveryError(persistenceError)
    });
  }
}

async function deliverCandidateAlert(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  candidate: AddressPoisoningCandidateDelivery,
  metrics: AddressPoisoningCycleMetrics,
  logger: Logger
): Promise<void> {
  if (candidate.alertMode === "paused") {
    try {
      const updated = await repository.markAlertSkipped(deps.db, {
        candidateId: candidate.id,
        reason: "wallet_alert_mode_paused",
        leaseVersion: candidate.leaseVersion
      });
      updated ? metrics.alertsSkipped += 1 : metrics.alertsStale += 1;
    } catch (error) {
      metrics.alertsPersistenceFailed += 1;
      logger.error("address_poisoning_alert_skip_persistence_failed", {
        candidateId: candidate.id,
        error: boundedDeliveryError(error)
      });
    }
    return;
  }

  let message: ReturnType<typeof formatAddressPoisoningAlert>;
  let keyboard: ReturnType<typeof addressPoisoningAlertKeyboard>;
  let fingerprint: string;
  try {
    message = formatAddressPoisoningAlert(candidate);
    keyboard = addressPoisoningAlertKeyboard({
      callbackToken: candidate.callbackToken,
      incomingTxHash: candidate.suspiciousIncomingTxHash,
      outgoingTxHash: candidate.matchedOutgoingTxHash
    });
    fingerprint = addressPoisoningAlertFingerprint(candidate);
  } catch (error) {
    await markDeliveryFailure(deps, repository, candidate, error, metrics, currentTime(deps), logger);
    return;
  }

  let sent: { chat: { id: number }; message_id: number };
  try {
    sent = await deps.sendUserAlert(candidate.telegramUserId, message.text, {
      reply_markup: keyboard,
      parse_mode: message.parseMode
    });
  } catch (error) {
    await markDeliveryFailure(deps, repository, candidate, error, metrics, currentTime(deps), logger);
    return;
  }

  // ponytail: Telegram send and DB acknowledgement cannot be atomic. A crash here leaves
  // `sending` retryable, so delivery is intentionally at-least-once with at most four claims.
  try {
    const updated = await repository.markAlertSent(deps.db, {
      candidateId: candidate.id,
      fingerprint,
      telegramChatId: String(sent.chat.id),
      telegramMessageId: String(sent.message_id),
      sentAt: currentTime(deps),
      leaseVersion: candidate.leaseVersion
    });
    updated ? metrics.alertsSent += 1 : metrics.alertsStale += 1;
  } catch (error) {
    metrics.alertsPersistenceFailed += 1;
    logger.error("address_poisoning_alert_sent_persistence_failed", {
      candidateId: candidate.id,
      error: boundedDeliveryError(error)
    });
  }
}

async function deliverCandidateAlerts(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  options: ReturnType<typeof workerOptions>,
  metrics: AddressPoisoningCycleMetrics,
  now: Date,
  logger: Logger
): Promise<void> {
  let claimed: AddressPoisoningCandidateDelivery[];
  try {
    claimed = await repository.claimAlerts(deps.db, {
      limit: options.claimLimit,
      now,
      staleSendingBefore: new Date(now.getTime() - options.retryDelayMs)
    });
  } catch (error) {
    metrics.alertsPersistenceFailed += 1;
    logger.error("address_poisoning_alert_claim_failed", { error: boundedDeliveryError(error) });
    return;
  }
  metrics.alertsClaimed = claimed.length;
  for (const candidate of claimed) {
    await deliverCandidateAlert(deps, repository, candidate, metrics, logger);
  }
}

export async function runSingleAddressPoisoningCycle(
  deps: AddressPoisoningWorkerDeps,
  optionsInput: AddressPoisoningWorkerOptions = ADDRESS_POISONING_WORKER_DEFAULTS
): Promise<AddressPoisoningCycleMetrics> {
  const options = workerOptions(optionsInput);
  const repository = deps.repository ?? defaultRepository;
  const now = currentTime(deps);
  const logger = deps.logger ?? defaultLogger;
  const metrics: AddressPoisoningCycleMetrics = {
    expiredSkipped: 0,
    pausedSkipped: 0,
    claimed: 0,
    processed: 0,
    candidates: 0,
    cleared: 0,
    inconclusive: 0,
    failed: 0,
    stale: 0,
    alertsClaimed: 0,
    alertsSent: 0,
    alertsFailed: 0,
    alertsSkipped: 0,
    alertsStale: 0,
    alertsPersistenceFailed: 0
  };

  metrics.expiredSkipped = await repository.skipExpiredChecks(deps.db, {
    expiredBefore: new Date(now.getTime() - deps.realtimeMaxAgeMs)
  });
  metrics.pausedSkipped = await repository.skipPausedChecks(deps.db);
  const claimed = await repository.claimChecks(deps.db, {
    limit: options.claimLimit,
    now,
    staleRunningBefore: new Date(now.getTime() - options.retryDelayMs)
  });
  metrics.claimed = claimed.length;
  if (claimed.length > 0) {
    let cursor = 0;
    const consume = async () => {
      while (cursor < claimed.length) {
        const item = claimed[cursor++];
        await processWorkItem(deps, repository, item, options, metrics, now, logger);
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency, claimed.length) }, consume));
  }
  await deliverCandidateAlerts(deps, repository, options, metrics, now, logger);
  return metrics;
}
