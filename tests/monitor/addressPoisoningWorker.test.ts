import { afterEach, describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS,
  ADDRESS_POISONING_ALERT_HEARTBEAT_MS,
  ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS,
  ADDRESS_POISONING_WORKER_DEFAULTS,
  runSingleAddressPoisoningAlertDeliveryCycle,
  runSingleAddressPoisoningCheckCycle,
  runSingleAddressPoisoningCycle,
  type AddressPoisoningWorkerDeps,
  type AddressPoisoningWorkerRepository
} from "../../src/monitor/addressPoisoningWorker";
import { authoritativeRegisteredService } from "../../src/forensics/serviceClassifier";
import {
  ADDRESS_POISONING_INTERVAL_MS,
  createNonOverlappingStartupWork,
  startStartupWorkSchedule,
  type StartupWorkLabel
} from "../../src/runtime/startupSchedule";
import type { AddressPoisoningCandidateDelivery, AddressPoisoningCheckWorkItem, AddressLabel, WalletAlertMode } from "../../src/types";
import { TronscanClient, type PinnedTronscanTransferPage } from "../../src/tron/tronClient";
import { createTronscanScheduler } from "../../src/tron/tronscanScheduler";
import { THJ_POISONING_CASE } from "../fixtures/monitor/addressPoisoningCases";

const NOW = new Date("2026-07-01T12:48:00.000Z");
const OTHER_WALLET = "TYDaeeSEuipFoJ2bzVdJ8daGU57emWqQPC";
let rawTransferSequence = 0;

function workItem(overrides: Partial<AddressPoisoningCheckWorkItem> = {}): AddressPoisoningCheckWorkItem {
  return {
    txHash: THJ_POISONING_CASE.incomingTxHash,
    watchedWalletId: "wallet-1",
    walletAddress: THJ_POISONING_CASE.watchedWallet,
    telegramUserId: "42",
    sender: THJ_POISONING_CASE.lookalike,
    receiver: THJ_POISONING_CASE.watchedWallet,
    token: "USDT",
    amount: "10",
    timestamp: THJ_POISONING_CASE.incomingAt,
    attemptCount: 0,
    logicalOffset: 0,
    pageCount: 0,
    fetchedCount: 0,
    oldestFetchedAt: null,
    coverage: null,
    accumulatedLookupJson: {},
    leaseVersion: new Date("2026-07-01T12:47:59.000Z"),
    ...overrides
  };
}

function rawTransfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  return {
    transaction_id: `tx-${rawTransferSequence++}`,
    from_address: THJ_POISONING_CASE.watchedWallet,
    to_address: OTHER_WALLET,
    quant: "10000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    revert: false,
    riskTransaction: false,
    block_ts: THJ_POISONING_CASE.outgoingAt.getTime(),
    ...overrides
  };
}

function testRawProviderRowIds(
  transfers: RawTronscanTrc20Transfer[],
  provider: PinnedTronscanTransferPage["provider"] = "tronscan"
): string[] {
  return transfers.map((transfer) => {
    const row = transfer as RawTronscanTrc20Transfer & { event_index?: number; log_index?: number };
    const eventIndex = row.event_index ?? row.log_index;
    return `${provider}:tx:${transfer.transaction_id.toLowerCase()}${eventIndex === undefined ? "" : `:event:${eventIndex}`}`;
  });
}

function accumulatedLookupAtLimits() {
  const providerFacts = Array.from({ length: 500 }, (_, index) => rawTransfer({
    transaction_id: `bounded-${index}`,
    block_ts: THJ_POISONING_CASE.outgoingAt.getTime() - index
  }));
  const providerTransferIds = providerFacts.map((_, index) => `tronscan:accepted:${index}`);
  const rawProviderRowIds = providerFacts.map((_, index) => `tronscan:tx:bounded-${index}`);
  return {
    version: 2,
    windowStart: new Date(THJ_POISONING_CASE.incomingAt.getTime() - 86_400_000).toISOString(),
    windowEnd: new Date(THJ_POISONING_CASE.incomingAt.getTime() - 1).toISOString(),
    lookupProvider: "tronscan",
    providerMetadataConsistent: true,
    transfers: providerFacts.map((fact, index) => ({
      transferId: providerTransferIds[index],
      txHash: fact.transaction_id,
      sender: fact.from_address,
      receiver: fact.to_address,
      amountRaw: fact.quant,
      occurredAt: new Date(fact.block_ts).toISOString()
    })),
    providerFacts,
    providerTransferIds,
    providerFactProviders: providerFacts.map(() => "tronscan"),
    rawProviderRowIds,
    providerPages: Array.from({ length: 5 }, (_, pageIndex) => ({
      provider: "tronscan",
      start: pageIndex * 100,
      requestedLimit: 100,
      nextOffset: (pageIndex + 1) * 100,
      rawCount: 100,
      total: 500,
      rangeTotal: 500,
      complete: pageIndex === 4,
      metadataConsistent: true,
      overlappingTransferIds: [] as string[],
      rawProviderRowIds: rawProviderRowIds.slice(pageIndex * 100, (pageIndex + 1) * 100),
      overlappingRawRowIds: [] as string[],
      rawResponseHashes: [`raw-${pageIndex}-0`, `raw-${pageIndex}-1`],
      canonicalTransferHashes: [`canonical-${pageIndex}-0`, `canonical-${pageIndex}-1`]
    }))
  };
}

type TestAccumulatedLookup = ReturnType<typeof accumulatedLookupAtLimits>;

const oversizedAccumulatedMutations: Array<[string, (value: TestAccumulatedLookup) => void]> = [
  ["top-level transfers", (value) => {
    value.transfers.push({ ...value.transfers[0], transferId: "tronscan:accepted:overflow-transfer" });
  }],
  ["top-level facts", (value) => {
    value.providerFacts.push(rawTransfer({ transaction_id: "overflow-fact" }));
    value.providerTransferIds.push("tronscan:accepted:overflow-fact");
    value.providerFactProviders.push("tronscan");
  }],
  ["top-level provider transfer IDs", (value) => {
    value.providerTransferIds.push("tronscan:accepted:overflow-id");
  }],
  ["top-level raw row IDs", (value) => {
    value.rawProviderRowIds.push("tronscan:tx:overflow-raw");
  }],
  ["provider pages", (value) => {
    value.providerPages.push({ ...value.providerPages[4], start: 500, nextOffset: 600 });
  }],
  ["per-page raw row IDs", (value) => {
    value.providerPages[0].rawProviderRowIds.push("tronscan:tx:overflow-page-raw");
    value.providerPages[0].rawCount = 101;
  }],
  ["per-page accepted overlap IDs", (value) => {
    value.providerPages[0].overlappingTransferIds = Array.from({ length: 101 }, (_, index) => `accepted-overlap-${index}`);
  }],
  ["per-page raw overlap IDs", (value) => {
    value.providerPages[0].overlappingRawRowIds = Array.from({ length: 101 }, (_, index) => `raw-overlap-${index}`);
  }],
  ["per-page raw response hashes", (value) => {
    value.providerPages[0].rawResponseHashes.push("raw-overflow");
  }],
  ["per-page canonical hashes", (value) => {
    value.providerPages[0].canonicalTransferHashes.push("canonical-overflow");
  }]
];

function labels(...values: Array<Pick<AddressLabel, "label" | "source">>): AddressLabel[] {
  return values.map((value) => ({
    address: THJ_POISONING_CASE.lookalike,
    createdAt: NOW,
    createdByTelegramId: null,
    ...value
  }));
}

function repository(claimed: AddressPoisoningCheckWorkItem[] = []): AddressPoisoningWorkerRepository {
  return {
    skipExpiredChecks: vi.fn(async () => 0),
    skipPausedChecks: vi.fn(async () => 0),
    claimChecks: vi.fn(async () => claimed),
    listAddressLabels: vi.fn(async () => []),
    markClear: vi.fn(async () => true),
    markInconclusive: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
    skipCheckIfExpired: vi.fn(async () => false),
    persistCandidate: vi.fn(async () => ({ id: "candidate-1" })),
    claimAlerts: vi.fn(async () => []),
    renewAlertLease: vi.fn(async (_db, input) => input.now),
    markAlertSent: vi.fn(async () => true),
    markAlertFailed: vi.fn(async () => true),
    markAlertSkipped: vi.fn(async () => true),
    getQueueMetrics: vi.fn(async () => ({ queueDepth: 0, oldestQueueAgeMs: null }))
  };
}

function deliveryCandidate(
  alertMode: WalletAlertMode = "realtime",
  overrides: Partial<AddressPoisoningCandidateDelivery> = {}
): AddressPoisoningCandidateDelivery {
  return {
    id: "candidate-delivery-1",
    callbackToken: "AbCdEf0123_-xyZ9",
    watchedWalletId: "wallet-1",
    walletAddress: THJ_POISONING_CASE.watchedWallet,
    telegramUserId: "42",
    locale: "ru",
    alertMode,
    tokenContract: THJ_POISONING_CASE.tokenContract,
    tokenSymbol: "USDT",
    tokenDecimals: 6,
    suspiciousIncomingTxHash: THJ_POISONING_CASE.incomingTxHash,
    suspiciousSender: THJ_POISONING_CASE.lookalike,
    suspiciousAmountRaw: THJ_POISONING_CASE.amountRaw,
    suspiciousIncomingAt: THJ_POISONING_CASE.incomingAt,
    matchedOutgoingTxHash: THJ_POISONING_CASE.outgoingTxHash,
    genuineRecipient: THJ_POISONING_CASE.realRecipient,
    matchedOutgoingAmountRaw: THJ_POISONING_CASE.amountRaw,
    matchedOutgoingAt: THJ_POISONING_CASE.outgoingAt,
    rawPrefixLength: 1,
    meaningfulPrefixLength: 0,
    suffixLength: 6,
    classification: "CRITICAL",
    confidence: "high",
    rawEvidenceId: "evidence-1",
    secondaryMatches: [],
    evidenceJson: {
      policyVersion: "address-poisoning-v1",
      coverage: "complete",
      windowStart: "2026-06-30T12:47:42.000Z",
      windowEnd: "2026-07-01T12:47:41.999Z",
      fetchedCount: 37,
      pageCount: 1,
      logicalOffset: 37
    },
    status: "candidate",
    alertFingerprint: "provisional-fingerprint",
    alertStatus: "sending",
    alertLocale: "ru",
    alertAttempts: 1,
    alertLeaseUpdatedAt: NOW,
    alertNextRetryAt: null,
    alertLastError: null,
    telegramChatId: null,
    telegramMessageId: null,
    laterLossTxHash: null,
    laterLossEvidenceJson: null,
    createdAt: THJ_POISONING_CASE.incomingAt,
    updatedAt: NOW,
    resolvedAt: null,
    alertSentAt: null,
    alertAttempt: 1,
    alertLeaseVersion: NOW,
    ...overrides
  };
}

type RelatedTransferLookup = (
  address: string,
  options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
) => Promise<RawTronscanTrc20Transfer[]>;
type PinnedTransferLookup = (
  address: string,
  options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
) => Promise<PinnedTronscanTransferPage>;

function deps(
  repo: AddressPoisoningWorkerRepository,
  listRelatedTrc20Transfers: RelatedTransferLookup = vi.fn(async () => []),
  sendUserAlert: AddressPoisoningWorkerDeps["sendUserAlert"] = vi.fn(async () => ({
    chat: { id: 42 }, message_id: 1001
  })),
  now = () => NOW,
  pinnedLookup?: PinnedTransferLookup
) {
  const listRelatedTrc20TransferPagePinned: PinnedTransferLookup = pinnedLookup ?? (async (address, options = {}) => {
    const transfers = await listRelatedTrc20Transfers(address, options);
    const start = options.start ?? 0;
    const requestedLimit = options.limit ?? 100;
    const complete = transfers.length < requestedLimit;
    return {
      provider: "tronscan",
      transfers,
      rawProviderRowIds: testRawProviderRowIds(transfers),
      start,
      requestedLimit,
      nextOffset: start + transfers.length,
      total: complete ? start + transfers.length : start + transfers.length + 1,
      rangeTotal: complete ? start + transfers.length : start + transfers.length + 1,
      complete,
      metadataConsistent: true,
      rawResponseHashes: ["raw-test-page"],
      canonicalTransferHashes: ["canonical-test-page"]
    };
  });
  return {
    db: {} as never,
    repository: repo,
    tronClient: { listRelatedTrc20TransferPagePinned },
    realtimeMaxAgeMs: 120_000,
    sendUserAlert,
    now,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
}

describe("address poisoning worker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the bounded defaults and skips expired and paused work before claiming", async () => {
    expect(ADDRESS_POISONING_WORKER_DEFAULTS).toEqual({
      claimLimit: 20,
      concurrency: 2,
      pageSize: 100,
      maxPages: 5,
      retryDelayMs: 30_000
    });
    const repo = repository();

    const metrics = await runSingleAddressPoisoningCycle(deps(repo));

    expect(metrics.claimed).toBe(0);
    expect(repo.skipExpiredChecks).toHaveBeenCalledBefore(repo.skipPausedChecks as ReturnType<typeof vi.fn>);
    expect(repo.skipPausedChecks).toHaveBeenCalledBefore(repo.claimChecks as ReturnType<typeof vi.fn>);
    expect(repo.claimChecks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 20 }));
    expect(repo.claimChecks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      freshEventCutoff: new Date(NOW.getTime() - 120_000)
    }));
  });

  it("continues distinct logical pages 0 to 100 to 200, then clears on authoritative exhaustion", async () => {
    let current = workItem();
    const starts: number[] = [];
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => [current]);
    (repo.markInconclusive as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      current = workItem({
        logicalOffset: input.logicalOffset,
        pageCount: input.pageCount,
        fetchedCount: input.fetchedCount,
        oldestFetchedAt: input.oldestFetchedAt,
        coverage: input.coverage,
        accumulatedLookupJson: input.accumulatedLookupJson,
        leaseVersion: new Date(current.leaseVersion.getTime() + 1_000)
      });
      return true;
    });
    const client: PinnedTransferLookup = vi.fn(async (_address: string, options = {}): Promise<PinnedTronscanTransferPage> => {
      const start = options?.start ?? 0;
      starts.push(start);
      const transfers = start === 200
        ? [rawTransfer({ transaction_id: "final-200" })]
        : Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `${start}-${index}` }));
      return {
        provider: "tronscan",
        transfers,
        rawProviderRowIds: testRawProviderRowIds(transfers),
        start,
        requestedLimit: 100,
        nextOffset: start + transfers.length,
        total: 201,
        rangeTotal: 201,
        complete: start + transfers.length >= 201,
        metadataConsistent: true,
        rawResponseHashes: [`raw-${start}`],
        canonicalTransferHashes: [`canonical-${start}`]
      };
    });

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, client));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, client));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, client));

    expect(starts).toEqual([0, 100, 200]);
    expect(repo.markClear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      logicalOffset: 201,
      pageCount: 3,
      fetchedCount: 201,
      reason: "complete_no_match",
      coverage: "complete"
    }));
    const clearInput = (repo.markClear as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(clearInput.accumulatedLookupJson.transfers).toHaveLength(201);
  });

  it("leaves a full fifth page terminal and non-retryable", async () => {
    const item = workItem({ logicalOffset: 400, pageCount: 4, fetchedCount: 400 });
    const repo = repository([item]);
    const page = Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `last-${index}` }));

    await runSingleAddressPoisoningCycle(deps(repo, vi.fn(async () => page)));

    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      logicalOffset: 500,
      pageCount: 5,
      coverage: "partial",
      nextRetryAt: null,
      reason: "max_pages_reached"
    }));
  });

  it("persists the exact THJ match from partial coverage and stops lookup", async () => {
    const repo = repository([workItem()]);
    const match = rawTransfer({
      transaction_id: THJ_POISONING_CASE.outgoingTxHash,
      to_address: THJ_POISONING_CASE.realRecipient,
      quant: THJ_POISONING_CASE.amountRaw,
      block_ts: THJ_POISONING_CASE.outgoingAt.getTime(),
      riskTransaction: true
    });
    const page = [
      match,
      rawTransfer({ transaction_id: "noncanonical-noise", contract_address: OTHER_WALLET }),
      ...Array.from({ length: 98 }, (_, index) => rawTransfer({ transaction_id: `noise-${index}` }))
    ];
    const client = vi.fn(async () => page);

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, client));

    expect(metrics.candidates).toBe(1);
    expect(client).toHaveBeenCalledTimes(1);
    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      classification: "CRITICAL",
      matchedOutgoingTxHash: THJ_POISONING_CASE.outgoingTxHash,
      genuineRecipient: THJ_POISONING_CASE.realRecipient,
      coverage: "partial",
      logicalOffset: 100,
      pageCount: 1,
      fetchedCount: 100
    }));
    const input = (repo.persistCandidate as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(input.evidenceJson.providerFacts).toHaveLength(99);
    expect(input.evidenceJson.providerTransferIds).toHaveLength(99);
    expect((input.evidenceJson.providerFacts as RawTronscanTrc20Transfer[])
      .find((fact) => fact.transaction_id === THJ_POISONING_CASE.outgoingTxHash)?.riskTransaction).toBe(true);
    expect(input.evidenceJson).toMatchObject({
      windowStart: "2026-06-30T12:47:42.000Z",
      windowEnd: "2026-07-01T12:47:41.999Z",
      fetchedCount: input.fetchedCount,
      acceptedTransferCount: 99,
      pageCount: input.pageCount,
      logicalOffset: input.logicalOffset,
      oldestFetchedAt: THJ_POISONING_CASE.outgoingAt.toISOString(),
      oldestFetchedAtBasis: "oldest_accepted_canonical_transfer",
      senderAppearedInCheckedHistory: false
    });
  });

  it("ranks multiple HIGH matches deterministically before persistence", async () => {
    const repo = repository([workItem()]);
    const older = rawTransfer({
      transaction_id: "high-older",
      to_address: THJ_POISONING_CASE.realRecipient,
      quant: "9000000",
      block_ts: THJ_POISONING_CASE.outgoingAt.getTime()
    });
    const newer = rawTransfer({
      transaction_id: "high-newer",
      to_address: THJ_POISONING_CASE.realRecipient,
      quant: "8000000",
      block_ts: THJ_POISONING_CASE.incomingAt.getTime() - 10_000
    });

    await runSingleAddressPoisoningCycle(deps(repo, vi.fn(async () => [older, newer])));

    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      classification: "HIGH",
      matchedOutgoingTxHash: "high-newer",
      secondaryMatches: expect.arrayContaining([expect.objectContaining({ outgoingTxHash: "high-older" })])
    }));
  });

  it.each([
    ["manual", labels({ label: "trusted", source: "service_admin" }), THJ_POISONING_CASE.lookalike, "trusted_sender"],
    ["manual false-positive", labels({ label: "false_positive", source: "service_admin" }), THJ_POISONING_CASE.lookalike, "trusted_sender"],
    ["relationship", [], THJ_POISONING_CASE.lookalike, "prior_relationship"],
    ["registry", [], "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird", "authoritative_service"]
  ])("clears a partial page for an exact %s disqualifier", async (_name, addressLabels, sender, reason) => {
    const item = workItem({ sender });
    const repo = repository([item]);
    (repo.listAddressLabels as ReturnType<typeof vi.fn>).mockResolvedValue(addressLabels);
    const relation = rawTransfer({ to_address: sender });
    const page = _name === "relationship"
      ? Array.from({ length: 100 }, (_, index) => index === 0 ? relation : rawTransfer({ transaction_id: `r-${index}` }))
      : Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `r-${index}` }));

    await runSingleAddressPoisoningCycle(deps(repo, vi.fn(async () => page)));

    expect(repo.markClear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason,
      coverage: "partial"
    }));
  });

  it("does not suppress from a system/free-text label", async () => {
    const repo = repository([workItem()]);
    (repo.listAddressLabels as ReturnType<typeof vi.fn>).mockResolvedValue(labels({ label: "trusted", source: "system" }));
    const match = rawTransfer({
      transaction_id: THJ_POISONING_CASE.outgoingTxHash,
      to_address: THJ_POISONING_CASE.realRecipient
    });

    await runSingleAddressPoisoningCycle(deps(repo, vi.fn(async () => [
      { ...match, tokenInfo: { tokenName: "Trusted Binance service", tokenId: TRON_USDT_CONTRACT_ADDRESS } }
    ])));

    expect(repo.persistCandidate).toHaveBeenCalledTimes(1);
    expect(repo.markClear).not.toHaveBeenCalled();
  });

  it("ignores future, equal-time, outside-window, invalid, and noncanonical transfers", async () => {
    const repo = repository([workItem()]);
    const rows = [
      rawTransfer({ transaction_id: "future", to_address: THJ_POISONING_CASE.realRecipient, block_ts: THJ_POISONING_CASE.incomingAt.getTime() + 1 }),
      rawTransfer({ transaction_id: "equal", to_address: THJ_POISONING_CASE.realRecipient, block_ts: THJ_POISONING_CASE.incomingAt.getTime() }),
      rawTransfer({ transaction_id: "old", to_address: THJ_POISONING_CASE.realRecipient, block_ts: THJ_POISONING_CASE.incomingAt.getTime() - 86_400_001 }),
      rawTransfer({ transaction_id: "invalid", to_address: "bad" }),
      rawTransfer({ transaction_id: "wrong-token", to_address: THJ_POISONING_CASE.realRecipient, contract_address: OTHER_WALLET }),
      rawTransfer({ transaction_id: "unconfirmed", to_address: THJ_POISONING_CASE.realRecipient, confirmed: false }),
      rawTransfer({ transaction_id: "reverted", to_address: THJ_POISONING_CASE.realRecipient, revert: true })
    ];

    await runSingleAddressPoisoningCycle(deps(repo, vi.fn(async () => rows)));

    expect(repo.persistCandidate).not.toHaveBeenCalled();
    expect(repo.markClear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "complete_no_match" }));
  });

  it("retains persisted progress on provider failure and treats a stale lease as benign", async () => {
    const repo = repository([workItem({ logicalOffset: 100, pageCount: 1, fetchedCount: 100 })]);
    (repo.markFailed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, vi.fn(async () => { throw new Error("provider down"); })));

    expect(repo.markFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      txHash: THJ_POISONING_CASE.incomingTxHash,
      error: "provider down",
      leaseVersion: expect.any(Date)
    }));
    expect(metrics.failed).toBe(0);
    expect(metrics.stale).toBe(1);
  });

  it("fails malformed accumulated lookup safely without calling the provider", async () => {
    const repo = repository([workItem({ accumulatedLookupJson: { version: 1, transfers: "not-an-array" } })]);
    const client = vi.fn(async () => []);

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, client));

    expect(client).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      error: expect.stringContaining("accumulated")
    }));
    expect(metrics.failed).toBe(1);
  });

  it.each(oversizedAccumulatedMutations)("rejects oversized persisted %s before provider work", async (_name, mutate) => {
    const accumulated = accumulatedLookupAtLimits();
    mutate(accumulated);
    const repo = repository([workItem({
      logicalOffset: 500,
      pageCount: 5,
      fetchedCount: 500,
      accumulatedLookupJson: accumulated
    })]);
    const provider = vi.fn(async () => { throw new Error("provider must not run"); });

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, provider));

    expect(provider).not.toHaveBeenCalled();
    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.persistCandidate).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      error: expect.stringContaining("accumulated")
    }));
  });

  it("accepts persisted lookup arrays exactly at their product limits", async () => {
    const repo = repository([workItem({
      logicalOffset: 500,
      pageCount: 5,
      fetchedCount: 500,
      accumulatedLookupJson: accumulatedLookupAtLimits()
    })]);
    const provider = vi.fn(async () => { throw new Error("provider reached"); });

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, provider));

    expect(provider).toHaveBeenCalledTimes(1);
    expect(repo.markFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ error: "provider reached" }));
  });

  it("rejects an oversized live page before copying it into persisted progress", async () => {
    const repo = repository([workItem()]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [],
      rawProviderRowIds: [],
      start: 0,
      requestedLimit: 100,
      nextOffset: 0,
      total: 0,
      rangeTotal: 0,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["raw-0", "raw-1", "raw-overflow"],
      canonicalTransferHashes: ["canonical-0"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      error: expect.stringContaining("provider page")
    }));
  });

  it("bounds provider concurrency at two and continues after one item fails", async () => {
    const items = Array.from({ length: 5 }, (_, index) => workItem({
      txHash: `incoming-${index}`,
      watchedWalletId: `wallet-${index}`,
      walletAddress: index === 0 ? THJ_POISONING_CASE.watchedWallet : OTHER_WALLET,
      receiver: index === 0 ? THJ_POISONING_CASE.watchedWallet : OTHER_WALLET,
      sender: THJ_POISONING_CASE.lookalike
    }));
    const repo = repository(items);
    let active = 0;
    let maximum = 0;
    let calls = 0;
    const client = vi.fn(async () => {
      const call = calls++;
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (call === 0) throw new Error("first failed");
      return [];
    });

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, client));

    expect(maximum).toBe(2);
    expect(metrics.claimed).toBe(5);
    expect(metrics.processed).toBe(5);
    expect(metrics.failed).toBe(1);
    expect(repo.markClear).toHaveBeenCalledTimes(4);
  });

  it("continues the cycle when persisting one item failure also fails", async () => {
    const first = workItem({ txHash: "failed-write" });
    const second = workItem({ txHash: "still-processed", watchedWalletId: "wallet-2" });
    const repo = repository([first, second]);
    (repo.markFailed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("database unavailable"));
    const client = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce([]);

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, client));

    expect(metrics.processed).toBe(2);
    expect(repo.markClear).toHaveBeenCalledTimes(1);
    expect(metrics.failed).toBe(1);
  });

  it("supports smaller injected worker bounds", async () => {
    const repo = repository([workItem()]);
    const client = vi.fn(async () => [
      rawTransfer({ transaction_id: "small-page-1" }),
      rawTransfer({ transaction_id: "small-page-2" })
    ]);

    await runSingleAddressPoisoningCycle(deps(repo, client), {
      claimLimit: 3,
      concurrency: 1,
      pageSize: 2,
      maxPages: 2,
      retryDelayMs: 1
    });

    expect(repo.claimChecks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 3 }));
    expect(client).toHaveBeenCalledWith(THJ_POISONING_CASE.watchedWallet, expect.objectContaining({ limit: 2 }));
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      nextRetryAt: new Date(NOW.getTime() + 1)
    }));
  });

  it("clamps oversized bounds to the product maxima", async () => {
    const items = Array.from({ length: 3 }, (_, index) => workItem({
      txHash: `oversized-${index}`,
      watchedWalletId: `oversized-wallet-${index}`,
      pageCount: 4,
      logicalOffset: 400,
      fetchedCount: 400
    }));
    const repo = repository(items);
    let active = 0;
    let maximum = 0;
    const client = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `bounded-${index}` }));
    });

    await runSingleAddressPoisoningCycle(deps(repo, client), {
      claimLimit: 999,
      concurrency: 999,
      pageSize: 999,
      maxPages: 999,
      retryDelayMs: 1
    });

    expect(repo.claimChecks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 20 }));
    expect(client).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ limit: 100 }));
    expect(maximum).toBe(2);
    expect(repo.markInconclusive).toHaveBeenCalledTimes(3);
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      pageCount: 5,
      nextRetryAt: null
    }));
  });

  it("falls back consistently for zero and non-finite bounds", async () => {
    const repo = repository();
    await runSingleAddressPoisoningCycle(deps(repo), {
      claimLimit: 0,
      concurrency: Number.NaN,
      pageSize: 0,
      maxPages: Number.POSITIVE_INFINITY,
      retryDelayMs: 0
    });
    expect(repo.claimChecks).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 20 }));
  });

  it("processes every claimed row even when a fake repository returns more than requested", async () => {
    const repo = repository(Array.from({ length: 25 }, (_, index) => workItem({ txHash: `tx-${index}` })));
    const metrics = await runSingleAddressPoisoningCycle(deps(repo));
    expect(metrics.claimed).toBe(25);
    expect(metrics.processed).toBe(25);
    expect(repo.markClear).toHaveBeenCalledTimes(25);
  });

  it("keeps mixed provider continuation partial and labels every persisted fact truthfully", async () => {
    let current = workItem();
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => [current]);
    (repo.markInconclusive as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      current = workItem({
        logicalOffset: input.logicalOffset,
        pageCount: input.pageCount,
        fetchedCount: input.fetchedCount,
        accumulatedLookupJson: input.accumulatedLookupJson,
        leaseVersion: new Date(current.leaseVersion.getTime() + 1_000)
      });
      return true;
    });
    const tronscanPage: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [rawTransfer({ transaction_id: "tronscan-context" })],
      rawProviderRowIds: ["tronscan:tx:tronscan-context"],
      start: 0,
      requestedLimit: 100,
      nextOffset: 1,
      total: 2,
      rangeTotal: 2,
      complete: false,
      metadataConsistent: true,
      rawResponseHashes: ["tronscan-raw"],
      canonicalTransferHashes: ["tronscan-canonical"]
    };
    const fallbackMatch = rawTransfer({
      transaction_id: THJ_POISONING_CASE.outgoingTxHash,
      to_address: THJ_POISONING_CASE.realRecipient,
      riskTransaction: true
    });
    const fallbackPage: PinnedTronscanTransferPage = {
      provider: "trongrid_fallback",
      transfers: [fallbackMatch],
      rawProviderRowIds: testRawProviderRowIds([fallbackMatch], "trongrid_fallback"),
      start: 1,
      requestedLimit: 100,
      nextOffset: 2,
      total: 2,
      rangeTotal: 2,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["fallback-raw"],
      canonicalTransferHashes: ["fallback-canonical"]
    };
    const pages = vi.fn().mockResolvedValueOnce(tronscanPage).mockResolvedValueOnce(fallbackPage);

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));

    expect(repo.markClear).not.toHaveBeenCalled();
    const candidate = (repo.persistCandidate as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(candidate.coverage).toBe("partial");
    expect(candidate.evidenceJson.lookupProvider).toBe("mixed");
    expect(candidate.evidenceJson.providerFactProviders).toEqual(expect.arrayContaining(["tronscan", "trongrid_fallback"]));
    expect(candidate.evidenceJson.providerTransferIds).toEqual(expect.arrayContaining([
      expect.stringMatching(/^tronscan:/),
      expect.stringMatching(/^trongrid_fallback:/)
    ]));
    expect(candidate.evidenceJson.providerPages).toEqual([
      expect.objectContaining({ provider: "tronscan", start: 0, nextOffset: 1 }),
      expect.objectContaining({ provider: "trongrid_fallback", start: 1, nextOffset: 2 })
    ]);
  });

  it("never clears when authoritative range totals contradict across claims", async () => {
    let current = workItem();
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => [current]);
    (repo.markInconclusive as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      current = workItem({
        logicalOffset: input.logicalOffset,
        pageCount: input.pageCount,
        fetchedCount: input.fetchedCount,
        accumulatedLookupJson: input.accumulatedLookupJson,
        leaseVersion: new Date(current.leaseVersion.getTime() + 1_000)
      });
      return true;
    });
    const first: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `range-first-${index}` })),
      rawProviderRowIds: Array.from({ length: 100 }, (_, index) => `tronscan:tx:range-first-${index}`),
      start: 0,
      requestedLimit: 100,
      nextOffset: 100,
      total: 200,
      rangeTotal: 200,
      complete: false,
      metadataConsistent: true,
      rawResponseHashes: ["range-first-raw"],
      canonicalTransferHashes: ["range-first-canonical"]
    };
    const contradictory: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [],
      rawProviderRowIds: [],
      start: 100,
      requestedLimit: 100,
      nextOffset: 100,
      total: 100,
      rangeTotal: 100,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["range-second-raw"],
      canonicalTransferHashes: ["range-second-canonical"]
    };
    const pages = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(contradictory);

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledTimes(2);
    const second = (repo.markInconclusive as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(second.coverage).toBe("partial");
    expect(second.accumulatedLookupJson.providerMetadataConsistent).toBe(false);
    expect(second.accumulatedLookupJson.providerPages).toEqual([
      expect.objectContaining({ rangeTotal: 200 }),
      expect.objectContaining({ rangeTotal: 100 })
    ]);
  });

  it("never clears when a later logical page overlaps persisted transfer evidence", async () => {
    let current = workItem();
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => [current]);
    (repo.markInconclusive as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      current = workItem({
        logicalOffset: input.logicalOffset,
        pageCount: input.pageCount,
        fetchedCount: input.fetchedCount,
        accumulatedLookupJson: input.accumulatedLookupJson,
        leaseVersion: new Date(current.leaseVersion.getTime() + 1_000)
      });
      return true;
    });
    const repeated = rawTransfer({ transaction_id: "cross-claim-overlap" });
    const firstTransfers = [
      repeated,
      ...Array.from({ length: 99 }, (_, index) => rawTransfer({ transaction_id: `cross-first-${index}` }))
    ];
    const secondTransfers = [
      repeated,
      ...Array.from({ length: 99 }, (_, index) => rawTransfer({ transaction_id: `cross-second-${index}` }))
    ];
    const pages = vi.fn()
      .mockResolvedValueOnce({
        provider: "tronscan",
        transfers: firstTransfers,
        rawProviderRowIds: testRawProviderRowIds(firstTransfers),
        start: 0,
        requestedLimit: 100,
        nextOffset: 100,
        total: 200,
        rangeTotal: 200,
        complete: false,
        metadataConsistent: true,
        rawResponseHashes: ["cross-first-raw"],
        canonicalTransferHashes: ["cross-first-canonical"]
      } satisfies PinnedTronscanTransferPage)
      .mockResolvedValueOnce({
        provider: "tronscan",
        transfers: secondTransfers,
        rawProviderRowIds: testRawProviderRowIds(secondTransfers),
        start: 100,
        requestedLimit: 100,
        nextOffset: 200,
        total: 200,
        rangeTotal: 200,
        complete: true,
        metadataConsistent: true,
        rawResponseHashes: ["cross-second-raw"],
        canonicalTransferHashes: ["cross-second-canonical"]
      } satisfies PinnedTronscanTransferPage);

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledTimes(2);
    const second = (repo.markInconclusive as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(second.coverage).toBe("partial");
    expect(second.accumulatedLookupJson.providerMetadataConsistent).toBe(false);
    expect(second.accumulatedLookupJson.providerTransferIds).toHaveLength(199);
    expect(second.accumulatedLookupJson.transfers).toHaveLength(199);
    expect(second.accumulatedLookupJson.providerPages[1].overlappingTransferIds).toHaveLength(1);
    expect(second.accumulatedLookupJson.providerPages[1].overlappingTransferIds[0]).toMatch(/^tronscan:/);
  });

  it("audits raw row overlap before rejecting rows from detector evidence", async () => {
    let current = workItem();
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => [current]);
    (repo.markInconclusive as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      current = workItem({
        logicalOffset: input.logicalOffset,
        pageCount: input.pageCount,
        fetchedCount: input.fetchedCount,
        accumulatedLookupJson: input.accumulatedLookupJson,
        leaseVersion: new Date(current.leaseVersion.getTime() + 1_000)
      });
      return true;
    });
    const rejectedFirst = rawTransfer({
      transaction_id: "rejected-raw-overlap",
      ...({ event_index: 7 } as Record<string, unknown>),
      contractRet: "REVERT",
      revert: true
    });
    const rejectedChanged = rawTransfer({
      transaction_id: "rejected-raw-overlap",
      ...({ event_index: 7 } as Record<string, unknown>),
      quant: "99999999",
      contractRet: "REVERT",
      revert: true
    });
    const firstTransfers = [
      rejectedFirst,
      ...Array.from({ length: 99 }, (_, index) => rawTransfer({ transaction_id: `raw-first-${index}` }))
    ];
    const secondTransfers = [
      rejectedChanged,
      ...Array.from({ length: 99 }, (_, index) => rawTransfer({ transaction_id: `raw-second-${index}` }))
    ];
    const repeatedRawId = "tronscan:tx:rejected-raw-overlap:event:7";
    const pages = vi.fn()
      .mockResolvedValueOnce({
        provider: "tronscan",
        transfers: firstTransfers,
        rawProviderRowIds: [repeatedRawId, ...firstTransfers.slice(1).map((row) => `tronscan:tx:${row.transaction_id}`)],
        start: 0,
        requestedLimit: 100,
        nextOffset: 100,
        total: 200,
        rangeTotal: 200,
        complete: false,
        metadataConsistent: true,
        rawResponseHashes: ["raw-rejected-first"],
        canonicalTransferHashes: ["canonical-rejected-first"]
      } satisfies PinnedTronscanTransferPage & { rawProviderRowIds: string[] })
      .mockResolvedValueOnce({
        provider: "tronscan",
        transfers: secondTransfers,
        rawProviderRowIds: [repeatedRawId, ...secondTransfers.slice(1).map((row) => `tronscan:tx:${row.transaction_id}`)],
        start: 100,
        requestedLimit: 100,
        nextOffset: 200,
        total: 200,
        rangeTotal: 200,
        complete: true,
        metadataConsistent: true,
        rawResponseHashes: ["raw-rejected-second"],
        canonicalTransferHashes: ["canonical-rejected-second"]
      } satisfies PinnedTronscanTransferPage & { rawProviderRowIds: string[] });

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));

    expect(repo.markClear).not.toHaveBeenCalled();
    const second = (repo.markInconclusive as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(second.coverage).toBe("partial");
    expect(second.accumulatedLookupJson.providerMetadataConsistent).toBe(false);
    expect(second.accumulatedLookupJson.rawProviderRowIds).toHaveLength(199);
    expect(second.accumulatedLookupJson.providerTransferIds).toHaveLength(198);
    expect(second.accumulatedLookupJson.transfers).toHaveLength(198);
    expect(second.accumulatedLookupJson.providerPages[1].overlappingRawRowIds).toEqual([repeatedRawId]);
    expect(second.accumulatedLookupJson.providerPages[1].overlappingTransferIds).toEqual([]);
  });

  it("keeps changed tx-less rows as audit evidence but never clears them", async () => {
    let current = workItem();
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => [current]);
    (repo.markInconclusive as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      current = workItem({
        logicalOffset: input.logicalOffset,
        pageCount: input.pageCount,
        fetchedCount: input.fetchedCount,
        accumulatedLookupJson: input.accumulatedLookupJson,
        leaseVersion: new Date(current.leaseVersion.getTime() + 1_000)
      });
      return true;
    });
    const firstTxLess = rawTransfer({ transaction_id: "", quant: "1" });
    const changedTxLess = rawTransfer({ transaction_id: "", quant: "2", block_ts: THJ_POISONING_CASE.outgoingAt.getTime() - 1 });
    const firstRawId = "tronscan:raw:first-fingerprint";
    const changedRawId = "tronscan:raw:changed-fingerprint";
    const pages = vi.fn()
      .mockResolvedValueOnce({
        provider: "tronscan",
        transfers: [firstTxLess],
        rawProviderRowIds: [firstRawId],
        start: 0,
        requestedLimit: 100,
        nextOffset: 1,
        total: 2,
        rangeTotal: 2,
        complete: false,
        metadataConsistent: true,
        rawResponseHashes: ["tx-less-first-raw"],
        canonicalTransferHashes: ["tx-less-first-canonical"]
      } satisfies PinnedTronscanTransferPage)
      .mockResolvedValueOnce({
        provider: "tronscan",
        transfers: [changedTxLess],
        rawProviderRowIds: [changedRawId],
        start: 1,
        requestedLimit: 100,
        nextOffset: 2,
        total: 2,
        rangeTotal: 2,
        complete: true,
        metadataConsistent: true,
        rawResponseHashes: ["tx-less-second-raw"],
        canonicalTransferHashes: ["tx-less-second-canonical"]
      } satisfies PinnedTronscanTransferPage);

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, pages));

    expect(repo.markClear).not.toHaveBeenCalled();
    const second = (repo.markInconclusive as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(second.coverage).toBe("partial");
    expect(second.accumulatedLookupJson.providerMetadataConsistent).toBe(false);
    expect(second.accumulatedLookupJson.rawProviderRowIds).toEqual([changedRawId, firstRawId]);
    expect(second.accumulatedLookupJson.providerPages).toEqual([
      expect.objectContaining({ rawProviderRowIds: [firstRawId] }),
      expect.objectContaining({ rawProviderRowIds: [changedRawId] })
    ]);
    expect(second.accumulatedLookupJson.providerTransferIds).toEqual([]);
  });

  it("does not treat a retried but previously unpersisted page as cross-claim overlap", async () => {
    const item = workItem();
    const repo = repository([item]);
    (repo.markClear as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("clear persistence failed"))
      .mockResolvedValueOnce(true);
    const transfers = Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `unpersisted-${index}` }));
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers,
      rawProviderRowIds: testRawProviderRowIds(transfers),
      start: 0,
      requestedLimit: 100,
      nextOffset: 100,
      total: 100,
      rangeTotal: 100,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["unpersisted-raw"],
      canonicalTransferHashes: ["unpersisted-canonical"]
    };
    const lookup = vi.fn(async () => page);

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, lookup));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, lookup));

    expect(repo.markFailed).toHaveBeenCalledTimes(1);
    expect(repo.markClear).toHaveBeenCalledTimes(2);
    expect((repo.markClear as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ coverage: "complete" });
    expect(repo.markInconclusive).not.toHaveBeenCalled();
  });

  it("does not upgrade persisted unknown provider metadata to a complete clear", async () => {
    const legacyTransfer = rawTransfer({ transaction_id: "legacy-unknown" });
    const repo = repository([workItem({
      logicalOffset: 1,
      pageCount: 1,
      fetchedCount: 1,
      accumulatedLookupJson: {
        version: 1,
        transfers: [{
          transferId: "tronscan:legacy",
          txHash: legacyTransfer.transaction_id,
          sender: legacyTransfer.from_address,
          receiver: legacyTransfer.to_address,
          amountRaw: legacyTransfer.quant,
          occurredAt: new Date(legacyTransfer.block_ts).toISOString()
        }],
        providerFacts: [legacyTransfer],
        providerTransferIds: ["tronscan:legacy"]
      }
    })]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [],
      rawProviderRowIds: [],
      start: 1,
      requestedLimit: 100,
      nextOffset: 1,
      total: 1,
      rangeTotal: 1,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["legacy-final-raw"],
      canonicalTransferHashes: ["legacy-final-canonical"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverage: "partial" }));
  });

  it("fails closed when a version-two accumulated lookup predates raw row IDs", async () => {
    const repo = repository([workItem({
      accumulatedLookupJson: {
        version: 2,
        windowStart: null,
        windowEnd: null,
        lookupProvider: null,
        providerMetadataConsistent: true,
        transfers: [],
        providerFacts: [],
        providerTransferIds: [],
        providerFactProviders: [],
        providerPages: []
      }
    })]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [],
      rawProviderRowIds: [],
      start: 0,
      requestedLimit: 100,
      nextOffset: 0,
      total: 0,
      rangeTotal: 0,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["legacy-v2-final-raw"],
      canonicalTransferHashes: ["legacy-v2-final-canonical"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverage: "partial" }));
  });

  it("keeps an overlapping full logical page partial", async () => {
    const repo = repository([workItem()]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `overlap-worker-${index}` })),
      rawProviderRowIds: Array.from({ length: 100 }, (_, index) => `tronscan:tx:overlap-worker-${index}`),
      start: 0,
      requestedLimit: 100,
      nextOffset: 100,
      total: 100,
      rangeTotal: 100,
      complete: false,
      metadataConsistent: false,
      rawResponseHashes: ["overlap-a", "overlap-b"],
      canonicalTransferHashes: ["overlap-ca", "overlap-cb"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverage: "partial" }));
  });

  it("continues a short authoritative page that reports remaining rows", async () => {
    const repo = repository([workItem()]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [rawTransfer({ transaction_id: "short-incomplete" })],
      rawProviderRowIds: ["tronscan:tx:short-incomplete"],
      start: 0,
      requestedLimit: 100,
      nextOffset: 1,
      total: 100,
      rangeTotal: 100,
      complete: false,
      metadataConsistent: true,
      rawResponseHashes: ["raw-short"],
      canonicalTransferHashes: ["canonical-short"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      coverage: "partial",
      logicalOffset: 1
    }));
  });

  it("clears a short page only when pinned metadata proves the range exhausted", async () => {
    const repo = repository([workItem()]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [rawTransfer({ transaction_id: "short-complete" })],
      rawProviderRowIds: ["tronscan:tx:short-complete"],
      start: 0,
      requestedLimit: 100,
      nextOffset: 1,
      total: 1,
      rangeTotal: 1,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["raw-complete"],
      canonicalTransferHashes: ["canonical-complete"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      coverage: "complete",
      reason: "complete_no_match"
    }));
  });

  it("never clears inconsistent or zero-progress provider metadata", async () => {
    const repo = repository([workItem()]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: [],
      rawProviderRowIds: [],
      start: 0,
      requestedLimit: 100,
      nextOffset: 0,
      total: 10,
      rangeTotal: 10,
      complete: true,
      metadataConsistent: false,
      rawResponseHashes: ["raw-inconsistent"],
      canonicalTransferHashes: ["canonical-inconsistent"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      coverage: "partial",
      logicalOffset: 0
    }));
  });

  it("never clears impossible same-page totals even when the provider marks them complete", async () => {
    const repo = repository([workItem()]);
    const page: PinnedTronscanTransferPage = {
      provider: "tronscan",
      transfers: Array.from({ length: 100 }, (_, index) => rawTransfer({ transaction_id: `impossible-worker-${index}` })),
      rawProviderRowIds: Array.from({ length: 100 }, (_, index) => `tronscan:tx:impossible-worker-${index}`),
      start: 0,
      requestedLimit: 100,
      nextOffset: 100,
      total: 50,
      rangeTotal: 100,
      complete: true,
      metadataConsistent: true,
      rawResponseHashes: ["impossible-worker-raw"],
      canonicalTransferHashes: ["impossible-worker-canonical"]
    };

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, undefined, vi.fn(async () => page)));

    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverage: "partial" }));
    const stored = (repo.markInconclusive as ReturnType<typeof vi.fn>).mock.calls[0][1].accumulatedLookupJson;
    expect(stored.providerMetadataConsistent).toBe(false);
    expect(stored.providerPages[0]).toMatchObject({ total: 50, rangeTotal: 100 });
  });

  it("skips a candidate that ages out while its provider request is queued", async () => {
    let clock = new Date(THJ_POISONING_CASE.incomingAt.getTime() + 60_000);
    const repo = repository([workItem()]);
    (repo.skipCheckIfExpired as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) =>
      THJ_POISONING_CASE.incomingAt < input.freshEventCutoff);
    const match = rawTransfer({
      transaction_id: THJ_POISONING_CASE.outgoingTxHash,
      to_address: THJ_POISONING_CASE.realRecipient
    });
    const page = vi.fn(async () => {
      clock = new Date(THJ_POISONING_CASE.incomingAt.getTime() + 120_001);
      return {
        provider: "tronscan" as const,
        transfers: [match],
        rawProviderRowIds: testRawProviderRowIds([match]),
        start: 0,
        requestedLimit: 100,
        nextOffset: 1,
        total: 1,
        rangeTotal: 1,
        complete: true,
        metadataConsistent: true,
        rawResponseHashes: ["raw"],
        canonicalTransferHashes: ["canonical"]
      };
    });

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, () => clock, page));

    expect(repo.skipCheckIfExpired).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      freshEventCutoff: new Date(THJ_POISONING_CASE.incomingAt.getTime() + 1)
    }));
    expect(metrics.expiredSkipped).toBe(1);
    expect(repo.persistCandidate).not.toHaveBeenCalled();
    expect(repo.markClear).not.toHaveBeenCalled();
    expect(repo.markInconclusive).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it("applies the same post-wait freshness gate before provider failure persistence", async () => {
    let clock = new Date(THJ_POISONING_CASE.incomingAt.getTime() + 60_000);
    const repo = repository([workItem()]);
    (repo.skipCheckIfExpired as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) =>
      THJ_POISONING_CASE.incomingAt < input.freshEventCutoff);
    const page = vi.fn(async () => {
      clock = new Date(THJ_POISONING_CASE.incomingAt.getTime() + 120_001);
      throw new Error("provider failed after queue");
    });

    await runSingleAddressPoisoningCycle(deps(repo, undefined, undefined, () => clock, page));

    expect(repo.skipCheckIfExpired).toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it("keeps an event fresh at the exact inclusive cutoff boundary", async () => {
    const boundaryNow = new Date(THJ_POISONING_CASE.incomingAt.getTime() + 120_000);
    const repo = repository([workItem()]);
    const match = rawTransfer({
      transaction_id: THJ_POISONING_CASE.outgoingTxHash,
      to_address: THJ_POISONING_CASE.realRecipient
    });

    await runSingleAddressPoisoningCycle(deps(
      repo,
      vi.fn(async () => [match]),
      undefined,
      () => boundaryNow
    ));

    expect(repo.skipCheckIfExpired).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      freshEventCutoff: THJ_POISONING_CASE.incomingAt
    }));
    expect(repo.persistCandidate).toHaveBeenCalledTimes(1);
  });

  it("logs one lookup and one cycle metric with exact operational fields", async () => {
    let timeMs = NOW.getTime();
    const repo = repository([workItem()]);
    (repo.getQueueMetrics as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      timeMs += 75;
      return { queueDepth: 3, oldestQueueAgeMs: 12_000 };
    });
    const workerDeps = deps(
      repo,
      vi.fn(async () => {
        timeMs += 125;
        return [];
      }),
      undefined,
      () => new Date(timeMs)
    );

    const metrics = await runSingleAddressPoisoningCycle(workerDeps);

    expect(metrics.timeoutCount).toBe(0);
    expect(workerDeps.logger.info).toHaveBeenCalledWith("address_poisoning_lookup_completed", {
      txHash: THJ_POISONING_CASE.incomingTxHash,
      providerLatencyMs: 125,
      pageCount: 1,
      fetchedCount: 0,
      coverage: "complete",
      provider: "tronscan"
    });
    expect(workerDeps.logger.info).toHaveBeenCalledWith("address_poisoning_cycle_completed", {
      queueDepth: 3,
      oldestQueueAgeMs: 12_000,
      claimed: 1,
      durationMs: 200,
      timeoutCount: 0
    });
    const metricCalls = (workerDeps.logger.info as ReturnType<typeof vi.fn>).mock.calls
      .filter(([event]) => String(event).startsWith("address_poisoning_"));
    expect(metricCalls).toHaveLength(2);
    for (const [, fields] of metricCalls) {
      expect(fields).not.toHaveProperty("walletAddress");
      expect(fields).not.toHaveProperty("telegramUserId");
      expect(fields).not.toHaveProperty("callbackToken");
      expect(fields).not.toHaveProperty("apiKey");
      expect(fields).not.toHaveProperty("providerFacts");
    }
  });

  it("reports unavailable queue metrics as null and includes the failed query in cycle duration", async () => {
    let timeMs = NOW.getTime();
    const repo = repository();
    (repo.getQueueMetrics as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      timeMs += 40;
      throw new Error("metrics database unavailable");
    });
    const workerDeps = deps(repo, undefined, undefined, () => new Date(timeMs));

    await runSingleAddressPoisoningCheckCycle(workerDeps);

    expect(workerDeps.logger.error).toHaveBeenCalledWith("address_poisoning_queue_metrics_failed", {
      error: "metrics database unavailable"
    });
    expect(workerDeps.logger.info).toHaveBeenCalledWith("address_poisoning_cycle_completed", {
      queueDepth: null,
      oldestQueueAgeMs: null,
      claimed: 0,
      durationMs: 40,
      timeoutCount: 0
    });
  });

  it("continues detection on a later tick while a Telegram delivery remains held", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let releaseSend!: (value: { chat: { id: number }; message_id: number }) => void;
    const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
      releaseSend = resolve;
    });
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate()])
      .mockResolvedValue([]);
    const workerDeps = deps(
      repo,
      vi.fn(async () => [rawTransfer({
        transaction_id: THJ_POISONING_CASE.outgoingTxHash,
        to_address: THJ_POISONING_CASE.realRecipient,
        quant: THJ_POISONING_CASE.amountRaw,
        block_ts: THJ_POISONING_CASE.outgoingAt.getTime()
      })]),
      vi.fn(async () => heldSend),
      () => new Date(Date.now())
    );
    const checkGuard = createNonOverlappingStartupWork(() =>
      runSingleAddressPoisoningCheckCycle(workerDeps).then(() => undefined));
    const deliveryGuard = createNonOverlappingStartupWork(() =>
      runSingleAddressPoisoningAlertDeliveryCycle(workerDeps).then(() => undefined));
    const tick = () => Promise.all([checkGuard.run(), deliveryGuard.run()]).then(() => undefined);
    const noOp = vi.fn(async () => undefined);
    const startupWork = Object.fromEntries([
      "poll",
      "where_forensic",
      "incoming_deposit",
      "deep_forensic",
      "address_index"
    ].map((label) => [label, noOp])) as unknown as Record<StartupWorkLabel, () => Promise<void>>;
    startupWork.address_poisoning = tick;
    const started = startStartupWorkSchedule({
      schedule: [{ label: "address_poisoning", delayMs: 0 }],
      startupWork,
      intervalByLabel: {
        poll: 60_000,
        where_forensic: 60_000,
        incoming_deposit: 60_000,
        deep_forensic: 60_000,
        address_index: 60_000,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
      },
      onError: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(deliveryGuard.active()).not.toBeNull();
    const deliveryClaimsWhileHeld = (repo.claimAlerts as ReturnType<typeof vi.fn>).mock.calls.length;
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockResolvedValueOnce([workItem()]);

    await vi.advanceTimersByTimeAsync(ADDRESS_POISONING_INTERVAL_MS);

    expect(repo.persistCandidate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      suspiciousIncomingTxHash: THJ_POISONING_CASE.incomingTxHash,
      classification: "CRITICAL"
    }));
    expect(deliveryGuard.active()).not.toBeNull();
    expect(workerDeps.sendUserAlert).toHaveBeenCalledTimes(1);
    expect(repo.claimAlerts).toHaveBeenCalledTimes(deliveryClaimsWhileHeld);
    expect(repo.claimChecks).toHaveBeenCalledTimes(2);

    releaseSend({ chat: { id: 42 }, message_id: 1001 });
    await vi.advanceTimersByTimeAsync(0);
    expect(deliveryGuard.active()).toBeNull();
    started.stop();
  });

  it("counts only AbortError provider failures as timeouts and logs the failed lookup", async () => {
    let timeMs = NOW.getTime();
    const repo = repository([workItem()]);
    const workerDeps = deps(
      repo,
      vi.fn(async () => {
        timeMs += 5_000;
        throw new DOMException("lookup aborted", "AbortError");
      }),
      undefined,
      () => new Date(timeMs)
    );

    const metrics = await runSingleAddressPoisoningCycle(workerDeps);

    expect(metrics.timeoutCount).toBe(1);
    expect(workerDeps.logger.info).toHaveBeenCalledWith("address_poisoning_lookup_completed", {
      txHash: THJ_POISONING_CASE.incomingTxHash,
      providerLatencyMs: 5_000,
      pageCount: 0,
      fetchedCount: 0,
      coverage: "failed"
    });

    const nonTimeoutRepo = repository([workItem({ txHash: "ordinary-provider-error" })]);
    const nonTimeoutMetrics = await runSingleAddressPoisoningCycle(deps(
      nonTimeoutRepo,
      vi.fn(async () => { throw new TypeError("network unavailable"); })
    ));
    expect(nonTimeoutMetrics.timeoutCount).toBe(0);
  });

  it("logs a successful alert from decision timestamps and never logs stale sends", async () => {
    let timeMs = NOW.getTime();
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate("realtime", {
        createdAt: new Date(NOW.getTime() - 20_000),
        suspiciousIncomingAt: new Date(NOW.getTime() - 45_000)
      })])
      .mockResolvedValue([]);
    const workerDeps = deps(
      repo,
      undefined,
      vi.fn(async () => {
        timeMs += 250;
        return { chat: { id: 42 }, message_id: 1001 };
      }),
      () => new Date(timeMs)
    );

    await runSingleAddressPoisoningCycle(workerDeps);

    expect(workerDeps.logger.info).toHaveBeenCalledWith("address_poisoning_alert_sent", {
      candidateId: "candidate-delivery-1",
      classification: "CRITICAL",
      queueAgeMs: 20_250,
      alertLatencyMs: 45_250
    });
    const sentFields = (workerDeps.logger.info as ReturnType<typeof vi.fn>).mock.calls
      .find(([event]) => event === "address_poisoning_alert_sent")![1];
    expect(Object.keys(sentFields).sort()).toEqual([
      "alertLatencyMs",
      "candidateId",
      "classification",
      "queueAgeMs"
    ]);

    const staleRepo = repository();
    (staleRepo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate()])
      .mockResolvedValue([]);
    (staleRepo.markAlertSent as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const staleDeps = deps(staleRepo);
    await runSingleAddressPoisoningCycle(staleDeps);
    expect(staleDeps.logger.info).not.toHaveBeenCalledWith("address_poisoning_alert_sent", expect.anything());
  });

  it("alerts a worst-phase THJ event within 120 seconds through a busy real shared scheduler", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(THJ_POISONING_CASE.incomingAt);
    const queued: AddressPoisoningCheckWorkItem[] = [];
    let candidateReady = false;
    let alertClaimed = false;
    const repo = repository();
    (repo.claimChecks as ReturnType<typeof vi.fn>).mockImplementation(async () => queued.splice(0, queued.length));
    (repo.persistCandidate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      candidateReady = true;
      return { id: "candidate-slo" };
    });
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      if (!candidateReady || alertClaimed) return [];
      alertClaimed = true;
      return [deliveryCandidate("realtime", {
        id: "candidate-slo",
        createdAt: THJ_POISONING_CASE.incomingAt,
        suspiciousIncomingAt: THJ_POISONING_CASE.incomingAt,
        alertLeaseUpdatedAt: input.now,
        alertLeaseVersion: input.now,
        updatedAt: input.now
      })];
    });
    const match = rawTransfer({
      transaction_id: THJ_POISONING_CASE.outgoingTxHash,
      to_address: THJ_POISONING_CASE.realRecipient,
      quant: THJ_POISONING_CASE.amountRaw,
      block_ts: THJ_POISONING_CASE.outgoingAt.getTime()
    });
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));
    const schedulerEvents: string[] = [];
    let releaseScheduler!: () => void;
    const schedulerBlocker = new Promise<void>((resolve) => {
      releaseScheduler = resolve;
    });
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      maxInFlight: 1
    });
    const poisoningClient = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => {
        schedulerEvents.push("poisoning");
        return new Response(JSON.stringify({ token_transfers: [match] }), {
          headers: { "content-type": "application/json" }
        });
      }),
      timeoutMs: 5_000,
      retryAttempts: 0,
      schedulerDedupeNamespace: "address_poisoning",
      transferSchedulingPriority: "interactive_fast",
      scheduler
    });
    const bulkClient = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => {
        schedulerEvents.push("bulk");
        return new Response(JSON.stringify({ token_transfers: [] }), {
          headers: { "content-type": "application/json" }
        });
      }),
      scheduler
    });
    const workerDeps = deps(
      repo,
      poisoningClient.listRelatedTrc20Transfers.bind(poisoningClient),
      send,
      () => new Date(Date.now())
    );
    const noOp = vi.fn(async () => undefined);
    const startupWork = Object.fromEntries([
      "poll",
      "where_forensic",
      "incoming_deposit",
      "deep_forensic",
      "address_index"
    ].map((label) => [label, noOp])) as unknown as Record<StartupWorkLabel, () => Promise<void>>;
    const checkGuard = createNonOverlappingStartupWork(() =>
      runSingleAddressPoisoningCheckCycle(workerDeps).then(() => undefined));
    const deliveryGuard = createNonOverlappingStartupWork(() =>
      runSingleAddressPoisoningAlertDeliveryCycle(workerDeps).then(() => undefined));
    startupWork.address_poisoning = () => Promise.all([checkGuard.run(), deliveryGuard.run()]).then(() => undefined);
    const started = startStartupWorkSchedule({
      schedule: [{ label: "address_poisoning", delayMs: 0 }],
      startupWork,
      intervalByLabel: {
        poll: 60_000,
        where_forensic: 60_000,
        incoming_deposit: 60_000,
        deep_forensic: 60_000,
        address_index: 60_000,
        address_poisoning: ADDRESS_POISONING_INTERVAL_MS
      },
      onError: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(0);
    queued.push(workItem({ timestamp: THJ_POISONING_CASE.incomingAt }));
    const blocker = scheduler.schedule({ requestName: "blocker", path: "/blocker" }, async () => schedulerBlocker);
    await Promise.resolve();
    const bulk = bulkClient.listRelatedTrc20Transfers("TBulk11111111111111111111111111111111");
    await vi.advanceTimersByTimeAsync(ADDRESS_POISONING_INTERVAL_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).not.toHaveBeenCalled();
    releaseScheduler();
    await blocker;
    await bulk;
    expect(schedulerEvents).toEqual(["poisoning", "bulk"]);
    await vi.advanceTimersByTimeAsync(ADDRESS_POISONING_INTERVAL_MS);

    expect(send).toHaveBeenCalledTimes(1);
    const sentAt = (repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1].sentAt as Date;
    const latencyMs = sentAt.getTime() - THJ_POISONING_CASE.incomingAt.getTime();
    expect(latencyMs).toBe(2 * ADDRESS_POISONING_INTERVAL_MS);
    expect(latencyMs).toBeLessThanOrEqual(120_000);
    expect(latencyMs).toBeLessThanOrEqual(2 * 60_000);
    started.stop();
  });

  it.each(["realtime", "risk_only", "digest"] as const)("delivers %s safety alerts immediately even when no checks were claimed", async (mode) => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate(mode)])
      .mockResolvedValue([]);
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001, text: "accepted" }));

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, undefined, send));

    expect(metrics.claimed).toBe(0);
    expect(metrics.alertsClaimed).toBe(1);
    expect(metrics.alertsSent).toBe(1);
    expect(send).toHaveBeenCalledWith("42", expect.stringContaining("Возможна подмена адреса"), expect.objectContaining({
      parse_mode: "HTML",
      reply_markup: expect.anything()
    }));
    expect(repo.markAlertSent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      candidateId: "candidate-delivery-1",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      telegramChatId: "42",
      telegramMessageId: "1001",
      sentAt: NOW,
      alertAttempt: 1
    }));
  });

  it("marks paused alerts skipped under the claimed generation without sending", async () => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate("paused")])
      .mockResolvedValue([]);
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, undefined, send));

    expect(send).not.toHaveBeenCalled();
    expect(repo.markAlertSkipped).toHaveBeenCalledWith(expect.anything(), {
      candidateId: "candidate-delivery-1",
      reason: "wallet_alert_mode_paused",
      alertAttempt: 1
    });
    expect(metrics.alertsSkipped).toBe(1);
  });

  it("passes the candidate locale to the delivered keyboard", async () => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      deliveryCandidate("realtime", { alertLocale: "en", locale: "ru" })
    ]);
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));

    await runSingleAddressPoisoningCycle(deps(repo, undefined, send), {
      claimLimit: 1,
      concurrency: 1
    });

    const calls = send.mock.calls as unknown as Array<[
      string,
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } }
    ]>;
    const keyboard = calls[0]![2].reply_markup;
    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Incoming transfer",
      "Outgoing transfer",
      "I know this address",
      "Mark as replacement"
    ]);
  });

  it("does not send an alert without a locale fixed by the delivery claim", async () => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      deliveryCandidate("realtime", { alertLocale: null, locale: "en" })
    ]);
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));

    await runSingleAddressPoisoningCycle(deps(repo, undefined, send), {
      claimLimit: 1,
      concurrency: 1
    });

    expect(send).not.toHaveBeenCalled();
    expect(repo.markAlertFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      candidateId: "candidate-delivery-1",
      error: expect.stringContaining("fixed alert locale")
    }));
  });

  it("persists a bounded delivery failure and continues with later alerts", async () => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate("realtime", { id: "first" })])
      .mockResolvedValueOnce([deliveryCandidate("realtime", { id: "second", callbackToken: "AbCdEf0123_-xyZ8" })])
      .mockResolvedValue([]);
    const send = vi.fn()
      .mockRejectedValueOnce(new Error(`Telegram refused ${"x".repeat(2_000)}\nsecret`))
      .mockResolvedValueOnce({ chat: { id: 42 }, message_id: 1002 });

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, undefined, send));

    expect(send).toHaveBeenCalledTimes(2);
    expect(repo.markAlertFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      candidateId: "first",
      error: expect.not.stringContaining("\n"),
      now: NOW,
      alertAttempt: 1
    }));
    const failure = (repo.markAlertFailed as ReturnType<typeof vi.fn>).mock.calls[0][1].error as string;
    expect(failure.length).toBeLessThanOrEqual(500);
    expect(repo.markAlertSent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ candidateId: "second" }));
    expect(metrics.alertsFailed).toBe(1);
    expect(metrics.alertsSent).toBe(1);
  });

  it("leaves sending retryable when Telegram accepted but sent persistence crashes", async () => {
    const state = {
      status: "pending" as "pending" | "sending" | "sent" | "failed",
      updatedAt: NOW
    };
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      const claimable = state.status === "pending"
        || (state.status === "sending" && state.updatedAt < input.staleSendingBefore);
      if (!claimable) return [];
      state.status = "sending";
      state.updatedAt = input.now;
      return [deliveryCandidate("realtime", {
        alertAttempt: 1,
        alertLeaseUpdatedAt: input.now,
        alertLeaseVersion: input.now,
        updatedAt: input.now
      })];
    });
    (repo.markAlertSent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("database connection lost"));
    (repo.markAlertFailed as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      state.status = "failed";
      return true;
    });
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));

    const metrics = await runSingleAddressPoisoningCycle(deps(repo, undefined, send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.markAlertFailed).not.toHaveBeenCalled();
    expect(state.status).toBe("sending");
    expect(metrics.alertsPersistenceFailed).toBe(1);
    expect(await repo.claimAlerts({} as never, {
      limit: 1,
      now: new Date(NOW.getTime() + ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS + 1),
      staleSendingBefore: new Date(NOW.getTime() + 1)
    })).toHaveLength(1);
  });

  it("treats a stale sent CAS as benign and does not let one failed alert stop others", async () => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate("realtime", { id: "stale" })])
      .mockResolvedValueOnce([deliveryCandidate("realtime", { id: "fresh", callbackToken: "AbCdEf0123_-xyZ8" })])
      .mockResolvedValue([]);
    (repo.markAlertSent as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const metrics = await runSingleAddressPoisoningCycle(deps(repo));

    expect(metrics.alertsStale).toBe(1);
    expect(metrics.alertsSent).toBe(1);
  });

  it("stores the sent fingerprint once and never reclaims the sent candidate", async () => {
    const state: { status: "pending" | "sending" | "sent"; fingerprint: string | null } = {
      status: "pending",
      fingerprint: null
    };
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (state.status !== "pending") return [];
      state.status = "sending";
      return [deliveryCandidate()];
    });
    (repo.markAlertSent as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      if (state.status !== "sending") return false;
      state.status = "sent";
      state.fingerprint = input.fingerprint;
      return true;
    });
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));

    await runSingleAddressPoisoningCycle(deps(repo, undefined, send));
    await runSingleAddressPoisoningCycle(deps(repo, undefined, send));

    expect(state.status).toBe("sent");
    expect(state.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("anchors the sent timestamp after Grammy accepts the message and persists Grammy ids", async () => {
    const startedAt = new Date("2026-07-01T12:48:00.000Z");
    const acceptedAt = new Date("2026-07-01T12:48:07.250Z");
    const times = [startedAt, startedAt, startedAt, startedAt, acceptedAt, acceptedAt];
    const clock = vi.fn(() => times.shift()!);
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate()])
      .mockResolvedValue([]);
    const send = vi.fn(async () => ({ chat: { id: -1001234567890 }, message_id: 9876, date: 1 }));

    await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
      claimLimit: 1,
      concurrency: 1
    });

    expect(clock).toHaveBeenCalledTimes(6);
    expect(repo.markAlertSent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      telegramChatId: "-1001234567890",
      telegramMessageId: "9876",
      sentAt: acceptedAt
    }));
  });

  it("anchors retry scheduling to the actual Telegram failure time", async () => {
    const startedAt = new Date("2026-07-01T12:48:00.000Z");
    const failedAt = new Date("2026-07-01T12:48:09.500Z");
    const times = [startedAt, startedAt, startedAt, startedAt, startedAt, failedAt];
    const clock = vi.fn(() => times.shift()!);
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate()])
      .mockResolvedValue([]);

    await runSingleAddressPoisoningCycle(deps(
      repo,
      undefined,
      vi.fn(async () => { throw new Error("Telegram timeout"); }),
      clock
    ), { claimLimit: 1, concurrency: 1 });

    expect(repo.markAlertFailed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ now: failedAt }));
  });

  it("records distinct completion times for multiple accepted alerts", async () => {
    const startedAt = new Date("2026-07-01T12:48:00.000Z");
    const firstAcceptedAt = new Date("2026-07-01T12:48:01.000Z");
    const secondAcceptedAt = new Date("2026-07-01T12:48:04.000Z");
    const times = [
      startedAt,
      startedAt,
      startedAt,
      startedAt,
      startedAt,
      firstAcceptedAt,
      firstAcceptedAt,
      firstAcceptedAt,
      secondAcceptedAt
    ];
    const clock = vi.fn(() => times.shift()!);
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([deliveryCandidate("realtime", { id: "first" })])
      .mockResolvedValueOnce([deliveryCandidate("realtime", { id: "second", callbackToken: "AbCdEf0123_-xyZ8" })])
      .mockResolvedValue([]);

    await runSingleAddressPoisoningCycle(deps(repo, undefined, vi.fn(async () => ({
      chat: { id: 42 }, message_id: 1001
    })), clock), { claimLimit: 2, concurrency: 1 });

    expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].sentAt))
      .toEqual([firstAcceptedAt, secondAcceptedAt]);
  });

  it("claims each queued alert only immediately before its bounded send slot is free", async () => {
    let releaseFirst!: (value: { chat: { id: number }; message_id: number }) => void;
    const firstSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];
    const queued = [
      deliveryCandidate("realtime", { id: "first" }),
      deliveryCandidate("realtime", { id: "second", callbackToken: "AbCdEf0123_-xyZ8" }),
      deliveryCandidate("realtime", { id: "third", callbackToken: "AbCdEf0123_-xyZ7" })
    ];
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      expect(input.limit).toBe(1);
      const next = queued.shift();
      events.push(next ? `claim:${next.id}` : "claim:empty");
      return next ? [next] : [];
    });
    let sendCount = 0;
    const send = vi.fn(async () => {
      sendCount += 1;
      events.push(`send:${sendCount}`);
      if (sendCount === 1) return firstSend;
      return { chat: { id: 42 }, message_id: 1000 + sendCount };
    });

    const cycle = runSingleAddressPoisoningCycle(deps(repo, undefined, send), {
      claimLimit: 3,
      concurrency: 1
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["claim:first", "send:1"]);

    releaseFirst({ chat: { id: 42 }, message_id: 1001 });
    await cycle;

    expect(events).toEqual([
      "claim:first", "send:1",
      "claim:second", "send:2",
      "claim:third", "send:3"
    ]);
    expect(repo.claimAlerts).toHaveBeenCalledTimes(3);
  });

  it("shares one alert claim budget across both delivery consumers", async () => {
    let candidateIndex = 0;
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      candidateIndex += 1;
      return [deliveryCandidate("realtime", {
        id: `candidate-${candidateIndex}`,
        callbackToken: `AbCdEf0123_-xy${candidateIndex}Z`
      })];
    });

    const metrics = await runSingleAddressPoisoningCycle(deps(repo), {
      claimLimit: 3,
      concurrency: 2
    });

    expect(repo.claimAlerts).toHaveBeenCalledTimes(3);
    expect(metrics.alertsClaimed).toBe(3);
    expect(metrics.alertsSent).toBe(3);
  });

  it("does not call Telegram when the freshly claimed lease is already known stale", async () => {
    const claimAt = NOW;
    const times = [
      claimAt,
      claimAt,
      new Date(claimAt.getTime() + ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS + 1)
    ];
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      deliveryCandidate("realtime", {
        alertLeaseUpdatedAt: claimAt,
        alertLeaseVersion: claimAt,
        updatedAt: claimAt
      })
    ]);
    const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));

    const metrics = await runSingleAddressPoisoningCycle(deps(
      repo,
      undefined,
      send,
      () => times.shift()!
    ), { claimLimit: 1, concurrency: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(repo.markAlertSent).not.toHaveBeenCalled();
    expect(repo.markAlertFailed).not.toHaveBeenCalled();
    expect(metrics.alertsStale).toBe(1);
  });

  it("does not reclaim an active send at 31 seconds but reclaims it after the delivery lease", async () => {
    const startedAt = NOW.getTime();
    let currentMs = startedAt;
    const clock = () => new Date(currentMs);
    let releaseFirst!: (value: { chat: { id: number }; message_id: number }) => void;
    const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
      releaseFirst = resolve;
    });
    const state: { status: "pending" | "sending" | "sent"; updatedAt: Date; attempts: number } = {
      status: "pending",
      updatedAt: new Date(0),
      attempts: 0
    };
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      const claimable = state.status === "pending"
        || (state.status === "sending" && state.updatedAt < input.staleSendingBefore);
      if (!claimable || state.attempts >= 4) return [];
      state.status = "sending";
      state.updatedAt = input.now;
      state.attempts += 1;
      return [deliveryCandidate("realtime", {
        alertAttempts: state.attempts,
        alertAttempt: state.attempts,
        alertLeaseUpdatedAt: input.now,
        updatedAt: input.now,
        alertLeaseVersion: input.now
      })];
    });
    (repo.markAlertSent as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
      if (
        state.status !== "sending"
        || state.attempts !== input.alertAttempt
      ) return false;
      state.status = "sent";
      return true;
    });
    let sendCount = 0;
    const send = vi.fn(async () => {
      sendCount += 1;
      if (sendCount === 1) return heldSend;
      return { chat: { id: 42 }, message_id: 1000 + sendCount };
    });

    const workerA = runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    currentMs = startedAt + 31_000;
    await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock));
    expect(send).toHaveBeenCalledTimes(1);
    const workerBClaim = (repo.claimAlerts as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      (call[1].now as Date).getTime() === currentMs);
    expect((workerBClaim![1].staleSendingBefore as Date).getTime())
      .toBe(currentMs - ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS);

    currentMs = startedAt + ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS + 1;
    await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock));
    expect(send).toHaveBeenCalledTimes(2);
    expect(state.attempts).toBe(2);
    expect(state.status).toBe("sent");

    releaseFirst({ chat: { id: 42 }, message_id: 1001 });
    await workerA;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("heartbeats a held Telegram send so other workers cannot reclaim it after 120 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      let release!: (value: { chat: { id: number }; message_id: number }) => void;
      const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
        release = resolve;
      });
      const state: { status: "pending" | "sending" | "sent"; updatedAt: Date; attempts: number } = {
        status: "pending",
        updatedAt: new Date(0),
        attempts: 0
      };
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        const claimable = state.status === "pending"
          || (state.status === "sending" && state.updatedAt < input.staleSendingBefore);
        if (!claimable || state.attempts >= 4) return [];
        state.status = "sending";
        state.updatedAt = input.now;
        state.attempts += 1;
        return [deliveryCandidate("realtime", {
          alertAttempts: state.attempts,
          alertAttempt: state.attempts,
          alertLeaseUpdatedAt: input.now,
          updatedAt: input.now,
          alertLeaseVersion: input.now
        })];
      });
      (repo.renewAlertLease as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (
          state.status !== "sending"
          || state.attempts !== input.alertAttempt
          || state.updatedAt.getTime() !== input.alertLeaseVersion.getTime()
        ) return null;
        state.updatedAt = input.now;
        return input.now;
      });
      (repo.markAlertSent as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (
          state.status !== "sending"
          || state.attempts !== input.alertAttempt
        ) return false;
        state.status = "sent";
        return true;
      });
      const send = vi.fn(async () => heldSend);
      const clock = () => new Date(Date.now());

      const workerA = runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock));
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(121_000);
      await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock));
      expect(send).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(40_000);
      await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock));
      expect(send).toHaveBeenCalledTimes(1);
      expect((repo.renewAlertLease as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].now.getTime()))
        .toEqual([40_000, 80_000, 120_000, 160_000].map((offset) => NOW.getTime() + offset));

      release({ chat: { id: 42 }, message_id: 1001 });
      await workerA;
      expect(state.status).toBe("sent");
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(expect.objectContaining({
        alertAttempt: 1
      }));
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1])
        .not.toHaveProperty("alertLeaseVersion");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sending ownership when a callback changes candidate status and generic updatedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      let release!: (value: { chat: { id: number }; message_id: number }) => void;
      const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
        release = resolve;
      });
      const state = {
        candidateStatus: "candidate" as "candidate" | "confirmed",
        alertStatus: "pending" as "pending" | "sending" | "sent",
        alertAttempt: 0,
        alertLease: null as Date | null,
        genericUpdatedAt: NOW
      };
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (state.alertStatus !== "pending") return [];
        state.alertStatus = "sending";
        state.alertAttempt += 1;
        state.alertLease = input.now;
        state.genericUpdatedAt = input.now;
        return [deliveryCandidate("realtime", {
          status: state.candidateStatus,
          alertAttempts: state.alertAttempt,
          alertAttempt: state.alertAttempt,
          alertLeaseUpdatedAt: input.now,
          alertLeaseVersion: input.now,
          updatedAt: state.genericUpdatedAt
        })];
      });
      (repo.renewAlertLease as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (
          state.alertStatus !== "sending"
          || state.alertAttempt !== input.alertAttempt
          || state.alertLease?.getTime() !== input.alertLeaseVersion.getTime()
        ) return null;
        state.alertLease = input.now;
        return input.now;
      });
      (repo.markAlertSent as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (
          state.alertStatus !== "sending"
          || state.alertAttempt !== input.alertAttempt
        ) return false;
        state.alertStatus = "sent";
        state.alertLease = null;
        return true;
      });
      const cycle = runSingleAddressPoisoningCycle(deps(
        repo,
        undefined,
        vi.fn(async () => heldSend),
        () => new Date(Date.now())
      ), { claimLimit: 1, concurrency: 1 });
      await vi.advanceTimersByTimeAsync(20_000);

      state.candidateStatus = "confirmed";
      state.genericUpdatedAt = new Date(Date.now());
      const callbackUpdatedAt = state.genericUpdatedAt;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(1);
      expect(state.alertLease).toEqual(new Date(NOW.getTime() + 40_000));
      expect(state.genericUpdatedAt).toEqual(callbackUpdatedAt);

      release({ chat: { id: 42 }, message_id: 1001 });
      await cycle;
      expect(state).toMatchObject({
        candidateStatus: "confirmed",
        alertStatus: "sent",
        alertAttempt: 1,
        alertLease: null,
        genericUpdatedAt: callbackUpdatedAt
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["success", "failure"] as const)("stops the heartbeat after the terminal %s acknowledgement", async (outcome) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      let resolveSend!: (value: { chat: { id: number }; message_id: number }) => void;
      let rejectSend!: (error: Error) => void;
      const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve, reject) => {
        resolveSend = resolve;
        rejectSend = reject;
      });
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([deliveryCandidate()]);
      const cycle = runSingleAddressPoisoningCycle(deps(
        repo,
        undefined,
        vi.fn(async () => heldSend),
        () => new Date(Date.now())
      ), { claimLimit: 1, concurrency: 1 });
      await vi.advanceTimersByTimeAsync(40_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(1);

      if (outcome === "success") resolveSend({ chat: { id: 42 }, message_id: 1001 });
      else rejectSend(new Error("Telegram failed"));
      await cycle;
      const renewalsAfterSettle = (repo.renewAlertLease as ReturnType<typeof vi.fn>).mock.calls.length;

      await vi.advanceTimersByTimeAsync(200_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(renewalsAfterSettle);
      const finalInput = outcome === "success"
        ? (repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1]
        : (repo.markAlertFailed as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(finalInput).toEqual(expect.objectContaining({ alertAttempt: 1 }));
      expect(finalInput).not.toHaveProperty("alertLeaseVersion");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a terminal generation conflict after heartbeat ownership loss as benign", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      let release!: (value: { chat: { id: number }; message_id: number }) => void;
      const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
        release = resolve;
      });
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([deliveryCandidate()]);
      (repo.renewAlertLease as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (repo.markAlertSent as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const cycle = runSingleAddressPoisoningCycle(deps(
        repo,
        undefined,
        vi.fn(async () => heldSend),
        () => new Date(Date.now())
      ), { claimLimit: 1, concurrency: 1 });

      await vi.advanceTimersByTimeAsync(200_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(1);
      release({ chat: { id: 42 }, message_id: 1001 });
      await expect(cycle).resolves.toMatchObject({ alertsStale: expect.any(Number) });
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1])
        .not.toHaveProperty("alertLeaseVersion");
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains heartbeat errors and retries without overwriting the confirmed lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      let release!: (value: { chat: { id: number }; message_id: number }) => void;
      const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
        release = resolve;
      });
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([deliveryCandidate()]);
      (repo.renewAlertLease as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("temporary database error"))
        .mockImplementationOnce(async (_db, input) => input.now);
      const cycle = runSingleAddressPoisoningCycle(deps(
        repo,
        undefined,
        vi.fn(async () => heldSend),
        () => new Date(Date.now())
      ), { claimLimit: 1, concurrency: 1 });

      await vi.advanceTimersByTimeAsync(80_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(2);
      release({ chat: { id: 42 }, message_id: 1001 });
      await expect(cycle).resolves.toMatchObject({ alertsPersistenceFailed: 1 });
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1])
        .not.toHaveProperty("alertLeaseVersion");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never overlaps heartbeat renewals when a database renewal is slow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      let releaseSend!: (value: { chat: { id: number }; message_id: number }) => void;
      const heldSend = new Promise<{ chat: { id: number }; message_id: number }>((resolve) => {
        releaseSend = resolve;
      });
      let releaseRenewal!: (value: Date) => void;
      const slowRenewal = new Promise<Date>((resolve) => {
        releaseRenewal = resolve;
      });
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([deliveryCandidate()]);
      (repo.renewAlertLease as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () => slowRenewal)
        .mockImplementationOnce(async (_db, input) => input.now);
      const cycle = runSingleAddressPoisoningCycle(deps(
        repo,
        undefined,
        vi.fn(async () => heldSend),
        () => new Date(Date.now())
      ), { claimLimit: 1, concurrency: 1 });

      await vi.advanceTimersByTimeAsync(160_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(1);
      releaseRenewal(new Date(NOW.getTime() + 40_000));
      await vi.advanceTimersByTimeAsync(39_999);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(2);

      releaseSend({ chat: { id: 42 }, message_id: 1001 });
      await cycle;
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts two hung Telegram sends at 30 seconds, releases both slots, and allows a later retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      expect(ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS).toBe(30_000);
      expect(ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS).toBeLessThan(ADDRESS_POISONING_ALERT_HEARTBEAT_MS);
      let queued = [
        deliveryCandidate("realtime", { id: "hung-1" }),
        deliveryCandidate("realtime", { id: "hung-2", callbackToken: "AbCdEf0123_-xyZ8" })
      ];
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        const next = queued.shift();
        return next ? [next] : [];
      });
      const send = vi.fn(async (
        _telegramUserId: string,
        _message: string,
        options: { signal: AbortSignal }
      ) => new Promise<{ chat: { id: number }; message_id: number }>((resolve, reject) => {
        if (send.mock.calls.length > 2) {
          resolve({ chat: { id: 42 }, message_id: 2001 });
          return;
        }
        options.signal.addEventListener("abort", () => {
          const error = new Error("Telegram request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }));
      const clock = () => new Date(Date.now());

      const firstCycle = runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
        claimLimit: 2,
        concurrency: 2
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);
      const signals = send.mock.calls.map((call) => call[2].signal);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(repo.markAlertFailed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await expect(firstCycle).resolves.toMatchObject({ alertsFailed: 2, timeoutCount: 2 });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(repo.markAlertFailed).toHaveBeenCalledTimes(2);
      expect((repo.markAlertFailed as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].now))
        .toEqual([new Date(NOW.getTime() + 30_000), new Date(NOW.getTime() + 30_000)]);
      expect(vi.getTimerCount()).toBe(0);

      const retryAt = new Date(Date.now() + 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      queued = [deliveryCandidate("realtime", {
        id: "hung-1",
        alertAttempts: 2,
        alertAttempt: 2,
        alertLeaseUpdatedAt: retryAt,
        alertLeaseVersion: retryAt,
        updatedAt: retryAt
      })];
      await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
        claimLimit: 1,
        concurrency: 1
      });
      expect(send).toHaveBeenCalledTimes(3);
      expect(repo.markAlertSent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        candidateId: "hung-1",
        alertAttempt: 2
      }));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [1, 1_000],
    [999_999, ADDRESS_POISONING_ALERT_HEARTBEAT_MS - 1],
    [0, ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS],
    [Number.NaN, ADDRESS_POISONING_TELEGRAM_TIMEOUT_MS]
  ])("normalizes injected Telegram timeout %s to %sms", async (configured, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([deliveryCandidate()]);
    const send = vi.fn(async (
      _telegramUserId: string,
      _message: string,
      options: { signal: AbortSignal }
    ) => new Promise<{ chat: { id: number }; message_id: number }>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    const cycle = runSingleAddressPoisoningCycle(deps(repo, undefined, send, () => new Date(Date.now())), {
      claimLimit: 1,
      concurrency: 1,
      telegramTimeoutMs: configured
    });
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(repo.markAlertFailed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await cycle;
    expect(repo.markAlertFailed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("heartbeats through a slow sent CAS and acknowledges the same claim generation once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const state = {
        status: "pending" as "pending" | "sending" | "sent",
        attempt: 0,
        lease: new Date(0)
      };
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        const claimable = state.status === "pending"
          || (state.status === "sending" && state.lease < input.staleSendingBefore);
        if (!claimable) return [];
        state.status = "sending";
        state.attempt += 1;
        state.lease = input.now;
        return [deliveryCandidate("realtime", {
          alertAttempts: state.attempt,
          alertAttempt: state.attempt,
          alertLeaseUpdatedAt: state.lease,
          alertLeaseVersion: state.lease,
          updatedAt: input.now
        })];
      });
      (repo.renewAlertLease as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (
          state.status !== "sending"
          || state.attempt !== input.alertAttempt
          || state.lease.getTime() !== input.alertLeaseVersion.getTime()
        ) return null;
        state.lease = input.now;
        return input.now;
      });
      let releaseFirstCas!: (updated: boolean) => void;
      const firstCas = new Promise<boolean>((resolve) => {
        releaseFirstCas = resolve;
      });
      (repo.markAlertSent as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        const updated = await firstCas;
        if (updated && state.status === "sending" && state.attempt === input.alertAttempt) state.status = "sent";
        return updated;
      });
      const send = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 }));
      const clock = () => new Date(Date.now());

      const workerA = runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
        claimLimit: 1,
        concurrency: 1
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(repo.markAlertSent).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(201_000);
      await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
        claimLimit: 1,
        concurrency: 1
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(5);
      releaseFirstCas(true);

      await workerA;
      expect(repo.markAlertSent).toHaveBeenCalledTimes(1);
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty("alertLeaseVersion");
      expect(state.status).toBe("sent");
      expect(send).toHaveBeenCalledTimes(1);
      const renewalCount = (repo.renewAlertLease as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(200_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(renewalCount);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("heartbeats through a slow failed CAS and acknowledges the same claim generation once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const state = {
        status: "pending" as "pending" | "sending" | "failed",
        attempt: 0,
        lease: new Date(0)
      };
      const repo = repository();
      (repo.claimAlerts as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        const claimable = state.status === "pending"
          || (state.status === "sending" && state.lease < input.staleSendingBefore);
        if (!claimable) return [];
        state.status = "sending";
        state.attempt += 1;
        state.lease = input.now;
        return [deliveryCandidate("realtime", {
          alertAttempts: state.attempt,
          alertAttempt: state.attempt,
          alertLeaseUpdatedAt: state.lease,
          alertLeaseVersion: state.lease,
          updatedAt: input.now
        })];
      });
      (repo.renewAlertLease as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        if (
          state.status !== "sending"
          || state.attempt !== input.alertAttempt
          || state.lease.getTime() !== input.alertLeaseVersion.getTime()
        ) return null;
        state.lease = input.now;
        return input.now;
      });
      let releaseFirstCas!: (updated: boolean) => void;
      const firstCas = new Promise<boolean>((resolve) => {
        releaseFirstCas = resolve;
      });
      (repo.markAlertFailed as ReturnType<typeof vi.fn>).mockImplementation(async (_db, input) => {
        const updated = await firstCas;
        if (updated && state.status === "sending" && state.attempt === input.alertAttempt) state.status = "failed";
        return updated;
      });
      const send = vi.fn(async () => {
        throw new Error("Telegram rejected request");
      });
      const clock = () => new Date(Date.now());
      const workerA = runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
        claimLimit: 1,
        concurrency: 1
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(repo.markAlertFailed).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(201_000);
      await runSingleAddressPoisoningCycle(deps(repo, undefined, send, clock), {
        claimLimit: 1,
        concurrency: 1
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(5);
      releaseFirstCas(true);

      await workerA;
      expect(repo.markAlertFailed).toHaveBeenCalledTimes(1);
      expect((repo.markAlertFailed as ReturnType<typeof vi.fn>).mock.calls[0][1])
        .not.toHaveProperty("alertLeaseVersion");
      expect(state.status).toBe("failed");
      const renewalCount = (repo.renewAlertLease as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(200_000);
      expect(repo.renewAlertLease).toHaveBeenCalledTimes(renewalCount);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("authoritativeRegisteredService", () => {
  it("matches only the exact registered address", () => {
    expect(authoritativeRegisteredService("TLntW9Z59LYY5KEi9cmwk3PKjQga828ird")).toEqual({
      identity: "TronLink GasFree provider",
      evidence: "registry:tronlink_gasfree_provider"
    });
    expect(authoritativeRegisteredService("tlntw9z59lyy5kei9cmwk3pkjqga828ird")).toBeNull();
    expect(authoritativeRegisteredService("Binance hot wallet")).toBeNull();
  });
});
