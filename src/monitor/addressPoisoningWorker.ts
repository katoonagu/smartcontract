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
  getAddressPoisoningQueueMetrics,
  listAddressLabels,
  markAddressPoisoningAlertFailed,
  markAddressPoisoningAlertSent,
  markAddressPoisoningAlertSkipped,
  renewAddressPoisoningAlertLease,
  markAddressPoisoningCheckClear,
  markAddressPoisoningCheckFailed,
  markAddressPoisoningCheckInconclusive,
  persistAddressPoisoningCandidate,
  skipAddressPoisoningCheckIfExpired,
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
import {
  rawProviderTxRowPaginationId,
  type ListRelatedTrc20TransfersOptions,
  type PinnedTronscanTransferPage
} from "../tron/tronClient";

export const ADDRESS_POISONING_WORKER_DEFAULTS = {
  claimLimit: 20,
  concurrency: 2,
  pageSize: 100,
  maxPages: 5,
  retryDelayMs: 30_000
} as const;

// The worker aborts Telegram sends after 30 seconds, before the 40-second heartbeat and
// 120-second delivery lease; delivery does not rely on Grammy's default request timeout.
export const ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS = 120_000;
export const ADDRESS_POISONING_ALERT_HEARTBEAT_MS = 40_000;
export const ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS = 30_000;
const ADDRESS_POISONING_TELEGRAM_TIMEOUT_MIN_MS = 1_000;

const LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const MAX_PERSISTED_LOOKUP_PAGES = ADDRESS_POISONING_WORKER_DEFAULTS.maxPages;
const MAX_PERSISTED_LOOKUP_ROWS = ADDRESS_POISONING_WORKER_DEFAULTS.pageSize * MAX_PERSISTED_LOOKUP_PAGES;
const MAX_PERSISTED_PAGE_ROWS = ADDRESS_POISONING_WORKER_DEFAULTS.pageSize;
const MAX_PERSISTED_PAGE_HASHES = Math.ceil(ADDRESS_POISONING_WORKER_DEFAULTS.pageSize / 50);

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
  timeoutCount: number;
};

type MarkClearInput = Parameters<typeof markAddressPoisoningCheckClear>[1];
type MarkInconclusiveInput = Parameters<typeof markAddressPoisoningCheckInconclusive>[1];
type MarkFailedInput = Parameters<typeof markAddressPoisoningCheckFailed>[1];
type SkipCheckIfExpiredInput = Parameters<typeof skipAddressPoisoningCheckIfExpired>[1];
type MarkAlertSentInput = Parameters<typeof markAddressPoisoningAlertSent>[1];
type MarkAlertFailedInput = Parameters<typeof markAddressPoisoningAlertFailed>[1];
type MarkAlertSkippedInput = Parameters<typeof markAddressPoisoningAlertSkipped>[1];
type RenewAlertLeaseInput = Parameters<typeof renewAddressPoisoningAlertLease>[1];

export type AddressPoisoningWorkerRepository = {
  skipExpiredChecks(db: Db, input: { expiredBefore: Date }): Promise<number>;
  skipPausedChecks(db: Db): Promise<number>;
  claimChecks(
    db: Db,
    input: { limit: number; now: Date; staleRunningBefore: Date; freshEventCutoff: Date }
  ): Promise<AddressPoisoningCheckWorkItem[]>;
  listAddressLabels(db: Db, address: string): Promise<AddressLabel[]>;
  markClear(db: Db, input: MarkClearInput): Promise<boolean>;
  markInconclusive(db: Db, input: MarkInconclusiveInput): Promise<boolean>;
  markFailed(db: Db, input: MarkFailedInput): Promise<boolean>;
  skipCheckIfExpired(db: Db, input: SkipCheckIfExpiredInput): Promise<boolean>;
  persistCandidate(db: Db, input: PersistAddressPoisoningCandidateInput): Promise<unknown>;
  claimAlerts(
    db: Db,
    input: { limit: number; now: Date; staleSendingBefore: Date }
  ): Promise<AddressPoisoningCandidateDelivery[]>;
  markAlertSent(db: Db, input: MarkAlertSentInput): Promise<boolean>;
  markAlertFailed(db: Db, input: MarkAlertFailedInput): Promise<boolean>;
  markAlertSkipped(db: Db, input: MarkAlertSkippedInput): Promise<boolean>;
  renewAlertLease(db: Db, input: RenewAlertLeaseInput): Promise<Date | null>;
  getQueueMetrics(db: Db, now: Date): Promise<{ queueDepth: number; oldestQueueAgeMs: number | null }>;
};

export type AddressPoisoningWorkerDeps = {
  db: Db;
  tronClient: {
    listRelatedTrc20TransferPagePinned(
      address: string,
      options?: ListRelatedTrc20TransfersOptions
    ): Promise<PinnedTronscanTransferPage>;
  };
  realtimeMaxAgeMs: number;
  sendUserAlert(
    telegramUserId: string,
    message: string,
    options: {
      reply_markup: ReturnType<typeof addressPoisoningAlertKeyboard>;
      parse_mode: "HTML";
      signal: AbortSignal;
    }
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
  telegramTimeoutMs?: number;
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
  version: 2;
  windowStart: string | null;
  windowEnd: string | null;
  lookupProvider: "tronscan" | "trongrid_fallback" | "mixed" | null;
  providerMetadataConsistent: boolean;
  transfers: StoredTransfer[];
  providerFacts: RawTronscanTrc20Transfer[];
  providerTransferIds: string[];
  providerFactProviders: Array<"tronscan" | "trongrid_fallback" | "unknown">;
  providerFactRawRowIds: string[];
  rawProviderRowIds: string[];
  providerPages: ProviderPageAudit[];
};

type ProviderPageAudit = {
  provider: "tronscan" | "trongrid_fallback";
  start: number;
  requestedLimit: number;
  nextOffset: number;
  rawCount: number;
  total: number | null;
  rangeTotal: number | null;
  complete: boolean;
  metadataConsistent: boolean;
  overlappingTransferIds: string[];
  rawProviderRowIds: string[];
  overlappingRawRowIds: string[];
  rawResponseHashes: string[];
  canonicalTransferHashes: string[];
};

export const addressPoisoningWorkerRepository: AddressPoisoningWorkerRepository = {
  skipExpiredChecks: skipExpiredAddressPoisoningChecks,
  skipPausedChecks: skipPausedAddressPoisoningChecks,
  claimChecks: claimAddressPoisoningChecks,
  listAddressLabels,
  markClear: markAddressPoisoningCheckClear,
  markInconclusive: markAddressPoisoningCheckInconclusive,
  markFailed: markAddressPoisoningCheckFailed,
  skipCheckIfExpired: skipAddressPoisoningCheckIfExpired,
  persistCandidate: persistAddressPoisoningCandidate,
  claimAlerts: claimAddressPoisoningAlertsForDelivery,
  markAlertSent: markAddressPoisoningAlertSent,
  markAlertFailed: markAddressPoisoningAlertFailed,
  markAlertSkipped: markAddressPoisoningAlertSkipped,
  renewAlertLease: renewAddressPoisoningAlertLease,
  getQueueMetrics: getAddressPoisoningQueueMetrics
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
    retryDelayMs: boundedPositiveInteger(options.retryDelayMs, ADDRESS_POISONING_WORKER_DEFAULTS.retryDelayMs),
    telegramTimeoutMs: Math.max(
      ADDRESS_POISONING_TELEGRAM_TIMEOUT_MIN_MS,
      boundedPositiveInteger(
        options.telegramTimeoutMs,
        ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS,
        Math.min(ADDRESS_POISONING_ALERT_HEARTBEAT_MS, ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS) - 1
      )
    )
  };
}

function emptyLookup(): AccumulatedLookup {
  return {
    version: 2,
    windowStart: null,
    windowEnd: null,
    lookupProvider: null,
    providerMetadataConsistent: true,
    transfers: [],
    providerFacts: [],
    providerTransferIds: [],
    providerFactProviders: [],
    providerFactRawRowIds: [],
    rawProviderRowIds: [],
    providerPages: []
  };
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

function isProviderPageAudit(value: unknown): value is ProviderPageAudit {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  const nullableCount = (count: unknown) => count === null
    || (typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
  const stringArray = (items: unknown, maximum: number) => Array.isArray(items)
    && items.length <= maximum
    && items.every((item) => typeof item === "string");
  return (page.provider === "tronscan" || page.provider === "trongrid_fallback")
    && typeof page.start === "number" && Number.isSafeInteger(page.start) && page.start >= 0
    && typeof page.requestedLimit === "number" && Number.isSafeInteger(page.requestedLimit)
    && page.requestedLimit > 0 && page.requestedLimit <= MAX_PERSISTED_PAGE_ROWS
    && typeof page.nextOffset === "number" && Number.isSafeInteger(page.nextOffset) && page.nextOffset >= 0
    && typeof page.rawCount === "number" && Number.isSafeInteger(page.rawCount)
    && page.rawCount >= 0 && page.rawCount <= MAX_PERSISTED_PAGE_ROWS
    && nullableCount(page.total)
    && nullableCount(page.rangeTotal)
    && typeof page.complete === "boolean"
    && typeof page.metadataConsistent === "boolean"
    && (page.overlappingTransferIds === undefined
      || stringArray(page.overlappingTransferIds, MAX_PERSISTED_PAGE_ROWS))
    && (page.rawProviderRowIds === undefined
      || stringArray(page.rawProviderRowIds, MAX_PERSISTED_PAGE_ROWS))
    && (page.overlappingRawRowIds === undefined
      || stringArray(page.overlappingRawRowIds, MAX_PERSISTED_PAGE_ROWS))
    && stringArray(page.rawResponseHashes, MAX_PERSISTED_PAGE_HASHES)
    && stringArray(page.canonicalTransferHashes, MAX_PERSISTED_PAGE_HASHES);
}

function parseAccumulatedLookup(value: Record<string, unknown>): AccumulatedLookup {
  if (Object.keys(value).length === 0) return emptyLookup();
  const legacy = value.version === 1;
  if (
    (!legacy && value.version !== 2)
    || !Array.isArray(value.transfers)
    || value.transfers.length > MAX_PERSISTED_LOOKUP_ROWS
    || !value.transfers.every(isStoredTransfer)
    || !Array.isArray(value.providerFacts)
    || value.providerFacts.length > MAX_PERSISTED_LOOKUP_ROWS
    || !value.providerFacts.every((fact) => fact !== null && typeof fact === "object" && !Array.isArray(fact))
    || !Array.isArray(value.providerTransferIds)
    || value.providerTransferIds.length > MAX_PERSISTED_LOOKUP_ROWS
    || !value.providerTransferIds.every((id) => typeof id === "string")
    || value.providerFacts.length !== value.providerTransferIds.length
    || (value.providerFactRawRowIds !== undefined
      && (!Array.isArray(value.providerFactRawRowIds)
        || value.providerFactRawRowIds.length > MAX_PERSISTED_LOOKUP_ROWS
        || !value.providerFactRawRowIds.every((id) => typeof id === "string")))
    || (value.rawProviderRowIds !== undefined
      && (!Array.isArray(value.rawProviderRowIds)
        || value.rawProviderRowIds.length > MAX_PERSISTED_LOOKUP_ROWS
        || !value.rawProviderRowIds.every((id) => typeof id === "string")))
  ) {
    throw new Error("Malformed accumulated address-poisoning lookup");
  }
  if (legacy) {
    const providerFacts = value.providerFacts as RawTronscanTrc20Transfer[];
    const hasLegacyEvidence = providerFacts.length > 0 || value.transfers.length > 0;
    return {
      ...emptyLookup(),
      lookupProvider: hasLegacyEvidence ? "mixed" : null,
      providerMetadataConsistent: !hasLegacyEvidence,
      transfers: [],
      providerFacts: [],
      providerTransferIds: [],
      providerFactProviders: [],
      providerFactRawRowIds: []
    };
  }
  const lookupProvider = value.lookupProvider;
  const persistedRawProviderRowIds = Array.isArray(value.rawProviderRowIds)
    ? value.rawProviderRowIds as unknown[]
    : null;
  const hasRawProviderRowIds = persistedRawProviderRowIds !== null
    && persistedRawProviderRowIds.every((id) => typeof id === "string" && id.length > 0)
    && new Set(persistedRawProviderRowIds).size === persistedRawProviderRowIds.length;
  const rawRowsHaveProviderTxHashes = hasRawProviderRowIds
    && persistedRawProviderRowIds.every((id) => !(id as string).includes(":raw:"));
  const windowStart = typeof value.windowStart === "string" ? value.windowStart : null;
  const windowEnd = typeof value.windowEnd === "string" ? value.windowEnd : null;
  if (
    !(lookupProvider === null || lookupProvider === "tronscan"
      || lookupProvider === "trongrid_fallback" || lookupProvider === "mixed")
    || typeof value.providerMetadataConsistent !== "boolean"
    || !Array.isArray(value.providerFactProviders)
    || value.providerFactProviders.length > MAX_PERSISTED_LOOKUP_ROWS
    || !value.providerFactProviders.every((provider) =>
      provider === "tronscan" || provider === "trongrid_fallback" || provider === "unknown")
    || value.providerFactProviders.length !== value.providerFacts.length
    || !Array.isArray(value.providerPages)
    || value.providerPages.length > MAX_PERSISTED_LOOKUP_PAGES
    || !value.providerPages.every(isProviderPageAudit)
  ) {
    throw new Error("Malformed accumulated address-poisoning provider metadata");
  }
  const rawProviderRowIds = hasRawProviderRowIds ? [...persistedRawProviderRowIds] as string[] : [];
  const providerTransferIds = [...value.providerTransferIds] as string[];
  const providerFacts = value.providerFacts as RawTronscanTrc20Transfer[];
  const providerFactProviders = [...value.providerFactProviders] as AccumulatedLookup["providerFactProviders"];
  const providerFactRawRowIds = Array.isArray(value.providerFactRawRowIds)
    ? [...value.providerFactRawRowIds] as string[]
    : null;
  const storedTransfers = [...value.transfers] as StoredTransfer[];
  const providerPages = value.providerPages as ProviderPageAudit[];
  const auditedRawProviderRowIds = providerPages.flatMap((page) =>
    Array.isArray(page.rawProviderRowIds) ? page.rawProviderRowIds : []);
  const auditedRawProviderRowIdSet = new Set(auditedRawProviderRowIds);
  const rawProviderRowIdSet = new Set(rawProviderRowIds);
  const priorPageRawRowIds = new Set<string>();
  let pageRawAuditConsistent = true;
  let historicalRawPaginationUnique = true;
  let orderedPageCoverageConsistent = providerPages.length === 0 || providerPages[0].start === 0;
  let expectedPageStart = 0;
  let historicalProvider: ProviderPageAudit["provider"] | null = null;
  let authoritativeRangeTotal: number | null = null;
  let previousTotal: number | null = null;
  for (const [pageIndex, page] of providerPages.entries()) {
    const pageRawIds = Array.isArray(page.rawProviderRowIds) ? page.rawProviderRowIds : [];
    const declaredOverlaps = Array.isArray(page.overlappingRawRowIds) ? page.overlappingRawRowIds : [];
    const pageRawIdSet = new Set(pageRawIds);
    const declaredOverlapSet = new Set(declaredOverlaps);
    const expectedOverlapSet = new Set(pageRawIds.filter((id) => priorPageRawRowIds.has(id)));
    const overlapDeclarationExact = declaredOverlapSet.size === expectedOverlapSet.size
      && [...expectedOverlapSet].every((id) => declaredOverlapSet.has(id));
    if (
      pageRawIdSet.size !== pageRawIds.length
      || declaredOverlapSet.size !== declaredOverlaps.length
      || !overlapDeclarationExact
    ) pageRawAuditConsistent = false;
    if (pageRawIdSet.size !== pageRawIds.length || expectedOverlapSet.size > 0) {
      historicalRawPaginationUnique = false;
    }
    const expectedHashCount = Math.max(1, Math.ceil(page.rawCount / 50));
    const sha256Hash = /^[0-9a-f]{64}$/i;
    const hashEvidenceConsistent = page.rawResponseHashes.length === expectedHashCount
      && page.canonicalTransferHashes.length === expectedHashCount
      && page.rawResponseHashes.every((hash) => sha256Hash.test(hash))
      && page.canonicalTransferHashes.every((hash) => sha256Hash.test(hash));
    if (
      page.start !== expectedPageStart
      || page.nextOffset !== page.start + page.rawCount
      || page.rawCount !== pageRawIds.length
      || page.rawCount > page.requestedLimit
      || (page.rangeTotal !== null
        && page.rawCount < page.requestedLimit
        && page.nextOffset < page.rangeTotal)
      || page.metadataConsistent !== true
      || !hashEvidenceConsistent
      || (historicalProvider !== null && page.provider !== historicalProvider)
      || page.rangeTotal === null
      || (authoritativeRangeTotal !== null && page.rangeTotal !== authoritativeRangeTotal)
      || page.nextOffset > page.rangeTotal
      || (page.total !== null && page.total < page.rangeTotal)
      || (previousTotal !== null && page.total !== null && page.total < previousTotal)
      || page.complete !== (page.nextOffset >= page.rangeTotal)
      || (page.complete && pageIndex !== providerPages.length - 1)
    ) orderedPageCoverageConsistent = false;
    expectedPageStart = page.nextOffset;
    historicalProvider ??= page.provider;
    authoritativeRangeTotal ??= page.rangeTotal;
    if (page.total !== null) previousTotal = page.total;
    for (const id of pageRawIds) priorPageRawRowIds.add(id);
  }
  if (providerPages.length > 0 && lookupProvider !== historicalProvider) {
    orderedPageCoverageConsistent = false;
  }
  const hasPriorProviderEvidence = lookupProvider !== null
    || windowStart !== null
    || windowEnd !== null
    || value.transfers.length > 0
    || value.providerFacts.length > 0
    || value.providerTransferIds.length > 0
    || value.providerFactProviders.length > 0
    || (providerFactRawRowIds?.length ?? 0) > 0
    || providerPages.length > 0;
  const rawIdentityEvidenceConsistent = hasRawProviderRowIds
    && (!hasPriorProviderEvidence || rawProviderRowIds.length > 0)
    && auditedRawProviderRowIdSet.size === rawProviderRowIdSet.size
    && [...auditedRawProviderRowIdSet].every((id) => rawProviderRowIdSet.has(id))
    && pageRawAuditConsistent
    && orderedPageCoverageConsistent
    && providerPages.every((page) =>
      Array.isArray(page.rawProviderRowIds)
      && Array.isArray(page.overlappingRawRowIds)
      && Array.isArray(page.overlappingTransferIds)
      && page.rawProviderRowIds.every((id) => id.startsWith(`${page.provider}:`))
      && page.overlappingRawRowIds.every((id) => page.rawProviderRowIds.includes(id))
      && page.overlappingTransferIds.every((id) => providerTransferIds.includes(id)));
  const storedTransfersById = new Map(storedTransfers.map((transfer) => [transfer.transferId, transfer]));
  const providerTransferIdSet = new Set(providerTransferIds);
  const storedTransferIdSet = new Set(storedTransfers.map((transfer) => transfer.transferId));
  const providerFactRawRowIdSet = new Set(providerFactRawRowIds ?? []);
  const acceptedEvidenceConsistent = providerFacts.length === 0
    ? storedTransfers.length === 0
      && providerTransferIds.length === 0
      && providerFactProviders.length === 0
      && (providerFactRawRowIds === null || providerFactRawRowIds.length === 0)
    : providerFactRawRowIds !== null
      && providerFactRawRowIds.length === providerFacts.length
      && storedTransfers.length === providerFacts.length
      && storedTransfersById.size === storedTransfers.length
      && providerTransferIdSet.size === providerTransferIds.length
      && providerFactRawRowIdSet.size === providerFactRawRowIds.length
      && storedTransferIdSet.size === providerTransferIdSet.size
      && [...storedTransferIdSet].every((id) => providerTransferIdSet.has(id))
      && providerFacts.length <= rawProviderRowIds.length
      && providerFacts.every((fact, index) => {
        const provider = providerFactProviders[index];
        if (provider === undefined || provider === "unknown") return false;
        const canonicalForPoisoning = fact.riskTransaction === true
          ? shouldIndexCanonicalTronscanUsdtTransfer({ ...fact, riskTransaction: false })
          : shouldIndexCanonicalTronscanUsdtTransfer(fact);
        if (!canonicalForPoisoning) return false;
        const normalized = normalizeTronscanTransferForAddressIndex(fact, provider);
        const providerTransferId = providerTransferIds[index];
        const rawRowId = providerFactRawRowIds[index];
        const expectedRawRowId = rawProviderTxRowPaginationId(provider, fact);
        const stored = storedTransfersById.get(providerTransferId);
        return expectedRawRowId !== null
          && rawRowId === expectedRawRowId
          && rawProviderRowIdSet.has(rawRowId)
          && normalized.transferId === providerTransferId
          && stored !== undefined
          && stored.transferId === normalized.transferId
          && stored.txHash === normalized.txHash
          && stored.sender === normalized.fromAddress
          && stored.receiver === normalized.toAddress
          && stored.amountRaw === normalized.amountRaw
          && stored.occurredAt === normalized.blockTimestamp.toISOString();
      });
  const acceptedIdByRawRowId = new Map((providerFactRawRowIds ?? []).map(
    (rawRowId, index) => [rawRowId, providerTransferIds[index]]
  ));
  const priorAcceptedTransferIds = new Set<string>();
  let acceptedOverlapAuditConsistent = true;
  let historicalAcceptedPaginationUnique = true;
  for (const page of providerPages) {
    const pageAcceptedTransferIds = new Set(page.rawProviderRowIds
      .map((rawRowId) => acceptedIdByRawRowId.get(rawRowId))
      .filter((id): id is string => typeof id === "string"));
    const expectedAcceptedOverlaps = new Set([...pageAcceptedTransferIds]
      .filter((id) => priorAcceptedTransferIds.has(id)));
    const declaredAcceptedOverlaps = new Set(page.overlappingTransferIds);
    const declarationExact = declaredAcceptedOverlaps.size === expectedAcceptedOverlaps.size
      && [...expectedAcceptedOverlaps].every((id) => declaredAcceptedOverlaps.has(id));
    if (declaredAcceptedOverlaps.size !== page.overlappingTransferIds.length || !declarationExact) {
      acceptedOverlapAuditConsistent = false;
    }
    if (expectedAcceptedOverlaps.size > 0) historicalAcceptedPaginationUnique = false;
    for (const id of pageAcceptedTransferIds) priorAcceptedTransferIds.add(id);
  }
  const acceptedEvidenceTrustworthy = rawIdentityEvidenceConsistent
    && acceptedEvidenceConsistent
    && acceptedOverlapAuditConsistent;
  return {
    version: 2,
    windowStart,
    windowEnd,
    lookupProvider,
    providerMetadataConsistent: value.providerMetadataConsistent
      && rawIdentityEvidenceConsistent
      && acceptedEvidenceConsistent
      && acceptedOverlapAuditConsistent
      && historicalAcceptedPaginationUnique
      && historicalRawPaginationUnique
      && rawRowsHaveProviderTxHashes
      && (value.providerPages.length === 0 || (windowStart !== null && windowEnd !== null))
      && value.providerPages.every((page) =>
        Array.isArray((page as Partial<ProviderPageAudit>).rawProviderRowIds)
        && (page as ProviderPageAudit).rawProviderRowIds.length === (page as ProviderPageAudit).rawCount
        && Array.isArray((page as Partial<ProviderPageAudit>).overlappingRawRowIds)),
    transfers: acceptedEvidenceTrustworthy ? storedTransfers : [],
    providerFacts: acceptedEvidenceTrustworthy ? providerFacts : [],
    providerTransferIds: acceptedEvidenceTrustworthy ? providerTransferIds : [],
    providerFactProviders: acceptedEvidenceTrustworthy ? providerFactProviders : [],
    providerFactRawRowIds: acceptedEvidenceTrustworthy ? providerFactRawRowIds ?? [] : [],
    rawProviderRowIds,
    providerPages: value.providerPages.map((page) => ({
      ...(page as ProviderPageAudit),
      overlappingTransferIds: Array.isArray((page as Partial<ProviderPageAudit>).overlappingTransferIds)
        ? [...(page as ProviderPageAudit).overlappingTransferIds]
        : [],
      rawProviderRowIds: Array.isArray((page as Partial<ProviderPageAudit>).rawProviderRowIds)
        ? [...(page as ProviderPageAudit).rawProviderRowIds]
        : [],
      overlappingRawRowIds: Array.isArray((page as Partial<ProviderPageAudit>).overlappingRawRowIds)
        ? [...(page as ProviderPageAudit).overlappingRawRowIds]
        : []
    }))
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
  page: PinnedTronscanTransferPage,
  metadataConsistent: boolean,
  incomingAt: Date
): AccumulatedLookup {
  const windowStart = new Date(incomingAt.getTime() - LOOKBACK_MS).toISOString();
  const windowEnd = new Date(incomingAt.getTime() - 1).toISOString();
  const byId = new Map(accumulated.transfers.map((transfer) => [transfer.transferId, transfer]));
  const persistedRawRowIds = new Set(accumulated.rawProviderRowIds);
  const rawProviderRowIds = new Set(accumulated.rawProviderRowIds);
  const overlappingRawRowIds = new Set<string>();
  for (const rawRowId of page.rawProviderRowIds) {
    if (persistedRawRowIds.has(rawRowId)) overlappingRawRowIds.add(rawRowId);
    rawProviderRowIds.add(rawRowId);
  }
  const persistedTransferIds = new Set(accumulated.providerTransferIds);
  const overlappingTransferIds = new Set<string>();
  const factsById = new Map(accumulated.providerTransferIds.map((id, index) => [id, accumulated.providerFacts[index]]));
  const factProvidersById = new Map(accumulated.providerTransferIds.map(
    (id, index) => [id, accumulated.providerFactProviders[index]]
  ));
  const factRawRowIdsById = new Map(accumulated.providerTransferIds.map(
    (id, index) => [id, accumulated.providerFactRawRowIds[index]]
  ));
  for (const [rawIndex, raw] of page.transfers.entries()) {
    const canonicalForPoisoning = raw.riskTransaction === true
      ? shouldIndexCanonicalTronscanUsdtTransfer({ ...raw, riskTransaction: false })
      : shouldIndexCanonicalTronscanUsdtTransfer(raw);
    if (!canonicalForPoisoning) continue;
    const normalized = normalizeTronscanTransferForAddressIndex(raw, page.provider);
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
    if (persistedTransferIds.has(stored.transferId)) overlappingTransferIds.add(stored.transferId);
    if (!byId.has(stored.transferId)) byId.set(stored.transferId, stored);
    if (!factsById.has(stored.transferId)) factsById.set(stored.transferId, raw);
    if (!factProvidersById.has(stored.transferId)) factProvidersById.set(stored.transferId, page.provider);
    if (!factRawRowIdsById.has(stored.transferId)) {
      factRawRowIdsById.set(stored.transferId, page.rawProviderRowIds[rawIndex]);
    }
  }
  const transfers = [...byId.values()].sort((left, right) =>
    new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
    || left.transferId.localeCompare(right.transferId));
  const providerTransferIds = [...factsById.keys()].sort();
  const providerChanged = accumulated.lookupProvider !== null
    && accumulated.lookupProvider !== page.provider;
  const priorPagesExist = accumulated.providerPages.length > 0;
  const windowConsistent = !priorPagesExist
    || (accumulated.windowStart === windowStart && accumulated.windowEnd === windowEnd);
  const rangeTotalConsistent = page.rangeTotal !== null
    && accumulated.providerPages.every((prior) =>
      prior.rangeTotal !== null && prior.rangeTotal === page.rangeTotal);
  const continuationConsistent = !priorPagesExist
    || accumulated.providerPages.at(-1)?.nextOffset === page.start;
  const lookupProvider = accumulated.lookupProvider === "mixed" || providerChanged
    ? "mixed" as const
    : accumulated.lookupProvider ?? page.provider;
  return {
    version: 2,
    windowStart: accumulated.windowStart ?? windowStart,
    windowEnd: accumulated.windowEnd ?? windowEnd,
    lookupProvider,
    providerMetadataConsistent: accumulated.providerMetadataConsistent
      && metadataConsistent
      && !providerChanged
      && windowConsistent
      && rangeTotalConsistent
      && continuationConsistent
      && overlappingRawRowIds.size === 0
      && overlappingTransferIds.size === 0,
    transfers,
    providerTransferIds,
    providerFacts: providerTransferIds.map((id) => factsById.get(id)!),
    providerFactProviders: providerTransferIds.map((id) => factProvidersById.get(id) ?? "unknown"),
    providerFactRawRowIds: providerTransferIds.map((id) => factRawRowIdsById.get(id) ?? ""),
    rawProviderRowIds: [...rawProviderRowIds].sort(),
    providerPages: [...accumulated.providerPages, {
      provider: page.provider,
      start: page.start,
      requestedLimit: page.requestedLimit,
      nextOffset: page.nextOffset,
      rawCount: page.transfers.length,
      total: page.total,
      rangeTotal: page.rangeTotal,
      complete: page.complete,
      metadataConsistent,
      overlappingTransferIds: [...overlappingTransferIds].sort(),
      rawProviderRowIds: [...page.rawProviderRowIds],
      overlappingRawRowIds: [...overlappingRawRowIds].sort(),
      rawResponseHashes: [...page.rawResponseHashes],
      canonicalTransferHashes: [...page.canonicalTransferHashes]
    }]
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

function nonnegativeDurationMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

function isProviderTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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

function pinnedPageMetadataIsConsistent(
  page: PinnedTronscanTransferPage,
  expectedStart: number,
  expectedLimit: number
): boolean {
  const actualNextOffset = expectedStart + page.transfers.length;
  const totalValid = page.total === null || (Number.isSafeInteger(page.total) && page.total >= 0);
  const rangeTotalValid = page.rangeTotal === null
    || (Number.isSafeInteger(page.rangeTotal) && page.rangeTotal >= 0);
  const totalsRelationallyValid = page.total === null
    || page.rangeTotal === null
    || page.rangeTotal <= page.total;
  const completionTruthful = !page.complete
    || (page.rangeTotal !== null && actualNextOffset >= page.rangeTotal);
  const rawIdsValid = page.rawProviderRowIds.length === page.transfers.length
    && new Set(page.rawProviderRowIds).size === page.rawProviderRowIds.length
    && page.rawProviderRowIds.every((id) => !id.includes(":raw:"));
  return page.metadataConsistent
    && page.start === expectedStart
    && page.requestedLimit === expectedLimit
    && page.nextOffset === actualNextOffset
    && page.transfers.length <= expectedLimit
    && totalValid
    && rangeTotalValid
    && totalsRelationallyValid
    && rawIdsValid
    && completionTruthful;
}

async function gateExpiredCheck(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  item: AddressPoisoningCheckWorkItem,
  metrics: AddressPoisoningCycleMetrics,
  logger: Logger
): Promise<{ now: Date; stop: boolean }> {
  const now = currentTime(deps);
  const freshEventCutoff = new Date(now.getTime() - deps.realtimeMaxAgeMs);
  try {
    const skipped = await repository.skipCheckIfExpired(deps.db, {
      txHash: item.txHash,
      watchedWalletId: item.watchedWalletId,
      freshEventCutoff,
      now,
      leaseVersion: item.leaseVersion
    });
    if (skipped) {
      metrics.expiredSkipped += 1;
      return { now, stop: true };
    }
    if (item.timestamp < freshEventCutoff) {
      metrics.stale += 1;
      return { now, stop: true };
    }
    return { now, stop: false };
  } catch (error) {
    metrics.failed += 1;
    logger.error("address_poisoning_expiry_persistence_failed", {
      txHash: item.txHash,
      watchedWalletId: item.watchedWalletId,
      error: errorMessage(error)
    });
    return { now, stop: true };
  }
}

async function processWorkItem(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  item: AddressPoisoningCheckWorkItem,
  options: ReturnType<typeof workerOptions>,
  metrics: AddressPoisoningCycleMetrics,
  logger: Logger
): Promise<void> {
  try {
    const accumulatedBefore = parseAccumulatedLookup(item.accumulatedLookupJson);
    const auditedPageCount = accumulatedBefore.providerPages.length;
    const auditedLogicalOffset = accumulatedBefore.providerPages.at(-1)?.nextOffset ?? 0;
    const auditedFetchedCount = accumulatedBefore.providerPages.reduce((sum, page) => sum + page.rawCount, 0);
    const emptyAccumulatedEvidence = auditedPageCount === 0
      && accumulatedBefore.lookupProvider === null
      && accumulatedBefore.windowStart === null
      && accumulatedBefore.windowEnd === null
      && accumulatedBefore.transfers.length === 0
      && accumulatedBefore.providerFacts.length === 0
      && accumulatedBefore.providerTransferIds.length === 0
      && accumulatedBefore.providerFactProviders.length === 0
      && accumulatedBefore.providerFactRawRowIds.length === 0
      && accumulatedBefore.rawProviderRowIds.length === 0;
    if (
      item.pageCount !== auditedPageCount
      || item.logicalOffset !== auditedLogicalOffset
      || item.fetchedCount !== auditedFetchedCount
      || (auditedPageCount === 0
        && (!emptyAccumulatedEvidence || item.pageCount !== 0 || item.logicalOffset !== 0 || item.fetchedCount !== 0))
      || accumulatedBefore.providerPages.at(-1)?.complete === true
    ) throw new Error("Accumulated address-poisoning lookup disagrees with queue progress");
    const incomingAmountRaw = parseUsdtDecimalToRaw(item.amount);
    if (!incomingAmountRaw) throw new Error("Invalid observed USDT amount for address-poisoning lookup");

    const providerStartedAt = currentTime(deps);
    let page: PinnedTronscanTransferPage;
    try {
      page = await deps.tronClient.listRelatedTrc20TransferPagePinned(item.walletAddress, {
        start: item.logicalOffset,
        limit: options.pageSize,
        minTimestamp: item.timestamp.getTime() - LOOKBACK_MS,
        endTimestamp: item.timestamp.getTime() - 1
      });
    } catch (error) {
      const providerFinishedAt = currentTime(deps);
      if (isProviderTimeout(error)) metrics.timeoutCount += 1;
      logger.info("address_poisoning_lookup_completed", {
        txHash: item.txHash,
        providerLatencyMs: nonnegativeDurationMs(providerStartedAt, providerFinishedAt),
        pageCount: item.pageCount,
        fetchedCount: item.fetchedCount,
        coverage: "failed"
      });
      throw error;
    }
    if (
      !page
      || (page.provider !== "tronscan" && page.provider !== "trongrid_fallback")
      || !Array.isArray(page.transfers)
      || page.transfers.length > MAX_PERSISTED_PAGE_ROWS
      || !Array.isArray(page.rawProviderRowIds)
      || page.rawProviderRowIds.length > MAX_PERSISTED_PAGE_ROWS
      || !page.rawProviderRowIds.every((id) => typeof id === "string" && id.length > 0)
      || !Array.isArray(page.rawResponseHashes)
      || page.rawResponseHashes.length > MAX_PERSISTED_PAGE_HASHES
      || !page.rawResponseHashes.every((hash) => typeof hash === "string")
      || !Array.isArray(page.canonicalTransferHashes)
      || page.canonicalTransferHashes.length > MAX_PERSISTED_PAGE_HASHES
      || !page.canonicalTransferHashes.every((hash) => typeof hash === "string")
      || accumulatedBefore.providerPages.length >= MAX_PERSISTED_LOOKUP_PAGES
      || accumulatedBefore.rawProviderRowIds.length + page.rawProviderRowIds.length > MAX_PERSISTED_LOOKUP_ROWS
      || accumulatedBefore.providerFacts.length + page.transfers.length > MAX_PERSISTED_LOOKUP_ROWS
      || accumulatedBefore.transfers.length + page.transfers.length > MAX_PERSISTED_LOOKUP_ROWS
    ) throw new Error("Address-poisoning provider page is malformed");

    const pageMetadataConsistent = pinnedPageMetadataIsConsistent(page, item.logicalOffset, options.pageSize);
    const accumulated = mergePage(accumulatedBefore, page, pageMetadataConsistent, item.timestamp);
    const coverage = page.complete && accumulated.providerMetadataConsistent
      ? "complete" as const
      : "partial" as const;
    const logicalOffset = item.logicalOffset + page.transfers.length;
    const pageCount = item.pageCount + 1;
    const fetchedCount = item.fetchedCount + page.transfers.length;
    logger.info("address_poisoning_lookup_completed", {
      txHash: item.txHash,
      providerLatencyMs: nonnegativeDurationMs(providerStartedAt, currentTime(deps)),
      pageCount,
      fetchedCount,
      coverage,
      provider: accumulated.lookupProvider
    });
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
      const gate = await gateExpiredCheck(deps, repository, item, metrics, logger);
      if (gate.stop) return;
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
          lookupProvider: accumulated.lookupProvider,
          providerMetadataConsistent: accumulated.providerMetadataConsistent,
          incoming: {
            txHash: item.txHash,
            sender: item.sender,
            receiver: item.receiver,
            amountRaw: incomingAmountRaw,
            occurredAt: item.timestamp.toISOString()
          },
          primaryMatch: serializableMatch(primary),
          providerFacts: accumulated.providerFacts,
          providerTransferIds: accumulated.providerTransferIds,
          providerFactProviders: accumulated.providerFactProviders,
          providerFactRawRowIds: accumulated.providerFactRawRowIds,
          rawProviderRowIds: accumulated.rawProviderRowIds,
          providerPages: accumulated.providerPages
        },
        ...commonProgress
      });
      metrics.candidates += 1;
      return;
    }

    if (result.kind === "clear") {
      const gate = await gateExpiredCheck(deps, repository, item, metrics, logger);
      if (gate.stop) return;
      const updated = await repository.markClear(deps.db, { ...commonProgress, reason: result.reason });
      updated ? metrics.cleared += 1 : metrics.stale += 1;
      return;
    }

    const terminal = pageCount >= options.maxPages;
    const gate = await gateExpiredCheck(deps, repository, item, metrics, logger);
    if (gate.stop) return;
    const updated = await repository.markInconclusive(deps.db, {
      ...commonProgress,
      coverage: "partial",
      nextRetryAt: terminal ? null : new Date(gate.now.getTime() + options.retryDelayMs),
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
    const gate = await gateExpiredCheck(deps, repository, item, metrics, logger);
    if (gate.stop) return;
    try {
      const updated = await repository.markFailed(deps.db, {
        txHash: item.txHash,
        watchedWalletId: item.watchedWalletId,
        error: errorMessage(error),
        now: gate.now,
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

type AlertDeliveryHeartbeat = {
  stop(): Promise<void>;
};

async function markDeliveryFailure(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  candidate: AddressPoisoningCandidateDelivery,
  error: unknown,
  metrics: AddressPoisoningCycleMetrics,
  failedAt: Date,
  logger: Logger,
  heartbeat?: AlertDeliveryHeartbeat
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
      alertAttempt: candidate.alertAttempt
    });
    updated ? metrics.alertsFailed += 1 : metrics.alertsStale += 1;
  } catch (persistenceError) {
    metrics.alertsPersistenceFailed += 1;
    logger.error("address_poisoning_alert_failure_persistence_failed", {
      candidateId: candidate.id,
      error: boundedDeliveryError(persistenceError)
    });
  } finally {
    if (heartbeat) await heartbeat.stop();
  }
}

function startAlertDeliveryHeartbeat(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  candidate: AddressPoisoningCandidateDelivery,
  metrics: AddressPoisoningCycleMetrics,
  logger: Logger
): AlertDeliveryHeartbeat {
  let alertLeaseVersion = new Date(candidate.alertLeaseVersion.getTime());
  let stopped = false;
  let ownershipLost = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = () => {
    if (stopped || ownershipLost) return;
    timer = setTimeout(() => {
      timer = null;
      const renew = async () => {
        try {
          const renewedAt = currentTime(deps);
          const renewedLease = await repository.renewAlertLease(deps.db, {
            candidateId: candidate.id,
            alertAttempt: candidate.alertAttempt,
            alertLeaseVersion,
            now: renewedAt
          });
          if (renewedLease === null) {
            ownershipLost = true;
            logger.warn("address_poisoning_alert_heartbeat_lease_lost", { candidateId: candidate.id });
            return;
          }
          alertLeaseVersion = new Date(renewedLease.getTime());
        } catch (error) {
          metrics.alertsPersistenceFailed += 1;
          logger.error("address_poisoning_alert_heartbeat_failed", {
            candidateId: candidate.id,
            error: boundedDeliveryError(error)
          });
        }
      };
      inFlight = renew().then(() => {
        inFlight = null;
        schedule();
      });
    }, ADDRESS_POISONING_ALERT_HEARTBEAT_MS);
  };
  schedule();

  return {
    stop: async () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) await inFlight;
    }
  };
}

async function deliverCandidateAlert(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  candidate: AddressPoisoningCandidateDelivery,
  options: ReturnType<typeof workerOptions>,
  metrics: AddressPoisoningCycleMetrics,
  logger: Logger
): Promise<void> {
  if (candidate.alertMode === "paused") {
    try {
      const updated = await repository.markAlertSkipped(deps.db, {
        candidateId: candidate.id,
        reason: "wallet_alert_mode_paused",
        alertAttempt: candidate.alertAttempt
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
    if (candidate.alertLocale === null) {
      throw new Error("Address poisoning delivery is missing its fixed alert locale");
    }
    const localizedCandidate = { ...candidate, locale: candidate.alertLocale };
    message = formatAddressPoisoningAlert(localizedCandidate);
    keyboard = addressPoisoningAlertKeyboard({
      callbackToken: candidate.callbackToken,
      incomingTxHash: candidate.suspiciousIncomingTxHash,
      outgoingTxHash: candidate.matchedOutgoingTxHash,
      locale: candidate.alertLocale
    });
    fingerprint = addressPoisoningAlertFingerprint(localizedCandidate);
  } catch (error) {
    await markDeliveryFailure(deps, repository, candidate, error, metrics, currentTime(deps), logger);
    return;
  }

  const sendStartedAt = currentTime(deps);
  if (sendStartedAt.getTime() - candidate.alertLeaseVersion.getTime() > ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS) {
    metrics.alertsStale += 1;
    logger.warn("address_poisoning_alert_lease_expired_before_send", { candidateId: candidate.id });
    return;
  }

  let sent!: { chat: { id: number }; message_id: number };
  const heartbeat = startAlertDeliveryHeartbeat(deps, repository, candidate, metrics, logger);
  const abortController = new AbortController();
  let telegramTimedOut = false;
  const telegramTimeout = setTimeout(() => {
    telegramTimedOut = true;
    abortController.abort();
  }, options.telegramTimeoutMs);
  let sendFailed = false;
  let sendError: unknown;
  try {
    sent = await deps.sendUserAlert(candidate.telegramUserId, message.text, {
      reply_markup: keyboard,
      parse_mode: message.parseMode,
      signal: abortController.signal
    });
  } catch (error) {
    sendFailed = true;
    sendError = error;
  } finally {
    clearTimeout(telegramTimeout);
  }
  if (sendFailed) {
    if (telegramTimedOut) metrics.timeoutCount += 1;
    await markDeliveryFailure(
      deps,
      repository,
      candidate,
      sendError,
      metrics,
      currentTime(deps),
      logger,
      heartbeat
    );
    return;
  }

  // ponytail: Telegram send and DB acknowledgement cannot be atomic. `alertAttempt` is the
  // ownership generation for this CAS; the heartbeat lease only keeps that generation alive.
  try {
    const sentAt = currentTime(deps);
    const updated = await repository.markAlertSent(deps.db, {
      candidateId: candidate.id,
      fingerprint,
      telegramChatId: String(sent.chat.id),
      telegramMessageId: String(sent.message_id),
      sentAt,
      alertAttempt: candidate.alertAttempt
    });
    if (updated) {
      metrics.alertsSent += 1;
      logger.info("address_poisoning_alert_sent", {
        candidateId: candidate.id,
        classification: candidate.classification,
        queueAgeMs: nonnegativeDurationMs(candidate.createdAt, sentAt),
        alertLatencyMs: nonnegativeDurationMs(candidate.suspiciousIncomingAt, sentAt)
      });
    } else {
      metrics.alertsStale += 1;
    }
  } catch (error) {
    metrics.alertsPersistenceFailed += 1;
    logger.error("address_poisoning_alert_sent_persistence_failed", {
      candidateId: candidate.id,
      error: boundedDeliveryError(error)
    });
  } finally {
    await heartbeat.stop();
  }
}

async function deliverCandidateAlerts(
  deps: AddressPoisoningWorkerDeps,
  repository: AddressPoisoningWorkerRepository,
  options: ReturnType<typeof workerOptions>,
  metrics: AddressPoisoningCycleMetrics,
  logger: Logger
): Promise<void> {
  let claimReservations = 0;
  let stopped = false;
  // ponytail: this reservation has no await, so the JS event loop makes the per-process
  // budget atomic; cross-process exclusivity remains the repository's SKIP LOCKED job.
  const reserveClaim = (): boolean => {
    if (stopped || claimReservations >= options.claimLimit) return false;
    claimReservations += 1;
    return true;
  };
  const consume = async () => {
    while (reserveClaim()) {
      const claimAt = currentTime(deps);
      let claimed: AddressPoisoningCandidateDelivery[];
      try {
        claimed = await repository.claimAlerts(deps.db, {
          limit: 1,
          now: claimAt,
          staleSendingBefore: new Date(claimAt.getTime() - ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS)
        });
      } catch (error) {
        stopped = true;
        metrics.alertsPersistenceFailed += 1;
        logger.error("address_poisoning_alert_claim_failed", { error: boundedDeliveryError(error) });
        return;
      }
      const candidate = claimed[0];
      if (!candidate) {
        stopped = true;
        return;
      }
      metrics.alertsClaimed += 1;
      await deliverCandidateAlert(deps, repository, candidate, options, metrics, logger);
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, consume));
}

function emptyCycleMetrics(): AddressPoisoningCycleMetrics {
  return {
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
    alertsPersistenceFailed: 0,
    timeoutCount: 0
  };
}

export async function runSingleAddressPoisoningCheckCycle(
  deps: AddressPoisoningWorkerDeps,
  optionsInput: AddressPoisoningWorkerOptions = ADDRESS_POISONING_WORKER_DEFAULTS
): Promise<AddressPoisoningCycleMetrics> {
  const options = workerOptions(optionsInput);
  const repository = deps.repository ?? addressPoisoningWorkerRepository;
  const now = currentTime(deps);
  const logger = deps.logger ?? defaultLogger;
  const metrics = emptyCycleMetrics();

  try {
    metrics.expiredSkipped = await repository.skipExpiredChecks(deps.db, {
      expiredBefore: new Date(now.getTime() - deps.realtimeMaxAgeMs)
    });
    metrics.pausedSkipped = await repository.skipPausedChecks(deps.db);
    const claimed = await repository.claimChecks(deps.db, {
      limit: options.claimLimit,
      now,
      staleRunningBefore: new Date(now.getTime() - options.retryDelayMs),
      freshEventCutoff: new Date(now.getTime() - deps.realtimeMaxAgeMs)
    });
    metrics.claimed = claimed.length;
    if (claimed.length > 0) {
      let cursor = 0;
      const consume = async () => {
        while (cursor < claimed.length) {
          const item = claimed[cursor++];
          await processWorkItem(deps, repository, item, options, metrics, logger);
        }
      };
      await Promise.all(Array.from({ length: Math.min(options.concurrency, claimed.length) }, consume));
    }
    return metrics;
  } finally {
    let queueDepth: number | null = null;
    let oldestQueueAgeMs: number | null = null;
    try {
      const queue = await repository.getQueueMetrics(deps.db, currentTime(deps));
      queueDepth = Number.isFinite(queue.queueDepth) ? Math.max(0, queue.queueDepth) : 0;
      oldestQueueAgeMs = queue.oldestQueueAgeMs === null || !Number.isFinite(queue.oldestQueueAgeMs)
        ? null
        : Math.max(0, queue.oldestQueueAgeMs);
    } catch (error) {
      logger.error("address_poisoning_queue_metrics_failed", { error: errorMessage(error) });
    }
    const completedAt = currentTime(deps);
    logger.info("address_poisoning_cycle_completed", {
      queueDepth,
      oldestQueueAgeMs,
      claimed: metrics.claimed,
      durationMs: nonnegativeDurationMs(now, completedAt),
      timeoutCount: metrics.timeoutCount
    });
  }
}

export async function runSingleAddressPoisoningAlertDeliveryCycle(
  deps: AddressPoisoningWorkerDeps,
  optionsInput: AddressPoisoningWorkerOptions = ADDRESS_POISONING_WORKER_DEFAULTS
): Promise<AddressPoisoningCycleMetrics> {
  const options = workerOptions(optionsInput);
  const repository = deps.repository ?? addressPoisoningWorkerRepository;
  const logger = deps.logger ?? defaultLogger;
  const metrics = emptyCycleMetrics();
  await deliverCandidateAlerts(deps, repository, options, metrics, logger);
  return metrics;
}

export async function runSingleAddressPoisoningCycle(
  deps: AddressPoisoningWorkerDeps,
  optionsInput: AddressPoisoningWorkerOptions = ADDRESS_POISONING_WORKER_DEFAULTS
): Promise<AddressPoisoningCycleMetrics> {
  const checkMetrics = await runSingleAddressPoisoningCheckCycle(deps, optionsInput);
  const deliveryMetrics = await runSingleAddressPoisoningAlertDeliveryCycle(deps, optionsInput);
  return {
    ...checkMetrics,
    alertsClaimed: deliveryMetrics.alertsClaimed,
    alertsSent: deliveryMetrics.alertsSent,
    alertsFailed: deliveryMetrics.alertsFailed,
    alertsSkipped: deliveryMetrics.alertsSkipped,
    alertsStale: deliveryMetrics.alertsStale,
    alertsPersistenceFailed: deliveryMetrics.alertsPersistenceFailed,
    timeoutCount: checkMetrics.timeoutCount + deliveryMetrics.timeoutCount
  };
}
