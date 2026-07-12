import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  ADDRESS_POISONING_ALERT_DELIVERY_LEASE_MS,
  ADDRESS_POISONING_WORKER_DEFAULTS,
  runSingleAddressPoisoningCycle,
  type AddressPoisoningWorkerRepository
} from "../../src/monitor/addressPoisoningWorker";
import { authoritativeRegisteredService } from "../../src/forensics/serviceClassifier";
import type { AddressPoisoningCandidateDelivery, AddressPoisoningCheckWorkItem, AddressLabel, WalletAlertMode } from "../../src/types";
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
    persistCandidate: vi.fn(async () => ({ id: "candidate-1" })),
    claimAlerts: vi.fn(async () => []),
    renewAlertLease: vi.fn(async (_db, input) => input.now),
    markAlertSent: vi.fn(async () => true),
    markAlertFailed: vi.fn(async () => true),
    markAlertSkipped: vi.fn(async () => true)
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

type RelatedTransferLookup = Parameters<typeof runSingleAddressPoisoningCycle>[0]["tronClient"]["listRelatedTrc20Transfers"];

function deps(
  repo: AddressPoisoningWorkerRepository,
  listRelatedTrc20Transfers: RelatedTransferLookup = vi.fn(async () => []),
  sendUserAlert = vi.fn(async () => ({ chat: { id: 42 }, message_id: 1001 })),
  now = () => NOW
) {
  return {
    db: {} as never,
    repository: repo,
    tronClient: { listRelatedTrc20Transfers },
    realtimeMaxAgeMs: 120_000,
    sendUserAlert,
    now,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
}

describe("address poisoning worker", () => {
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
  });

  it("continues logical pages 0 to 100 to 200, deduplicates accumulated facts, then clears on a short page", async () => {
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
    const repeated = rawTransfer({ transaction_id: "repeat" });
    const client = vi.fn(async (_address: string, options: { start?: number }) => {
      starts.push(options.start ?? -1);
      if (options.start === 200) return [repeated];
      return Array.from({ length: 100 }, (_, index) => index === 0
        ? repeated
        : rawTransfer({ transaction_id: `${options.start}-${index}` }));
    });

    await runSingleAddressPoisoningCycle(deps(repo, client));
    await runSingleAddressPoisoningCycle(deps(repo, client));
    await runSingleAddressPoisoningCycle(deps(repo, client));

    expect(starts).toEqual([0, 100, 200]);
    expect(repo.markClear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      logicalOffset: 201,
      pageCount: 3,
      fetchedCount: 201,
      reason: "complete_no_match",
      coverage: "complete"
    }));
    const clearInput = (repo.markClear as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect((clearInput.accumulatedLookupJson.transfers as unknown[]).filter((row: any) => row.txHash === "repeat")).toHaveLength(1);
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
      block_ts: THJ_POISONING_CASE.outgoingAt.getTime()
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
      rawTransfer({ transaction_id: "unconfirmed", to_address: THJ_POISONING_CASE.realRecipient, confirmed: false })
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
      alertAttempt: 1,
      alertLeaseVersion: NOW
    }));
  });

  it("marks paused alerts skipped under the claimed lease without sending", async () => {
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
      alertAttempt: 1,
      alertLeaseVersion: NOW
    });
    expect(metrics.alertsSkipped).toBe(1);
  });

  it("passes the candidate locale to the delivered keyboard", async () => {
    const repo = repository();
    (repo.claimAlerts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      deliveryCandidate("realtime", { locale: "en" })
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
      alertAttempt: 1,
      alertLeaseVersion: NOW
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
    const times = [startedAt, startedAt, startedAt, acceptedAt];
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

    expect(clock).toHaveBeenCalledTimes(4);
    expect(repo.markAlertSent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      telegramChatId: "-1001234567890",
      telegramMessageId: "9876",
      sentAt: acceptedAt
    }));
  });

  it("anchors retry scheduling to the actual Telegram failure time", async () => {
    const startedAt = new Date("2026-07-01T12:48:00.000Z");
    const failedAt = new Date("2026-07-01T12:48:09.500Z");
    const times = [startedAt, startedAt, startedAt, failedAt];
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
        || state.updatedAt.getTime() !== input.alertLeaseVersion.getTime()
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
          || state.updatedAt.getTime() !== input.alertLeaseVersion.getTime()
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
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1].alertLeaseVersion)
        .toEqual(new Date(NOW.getTime() + 160_000));
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
          || state.alertLease?.getTime() !== input.alertLeaseVersion.getTime()
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

  it.each(["success", "failure"] as const)("stops the heartbeat immediately after Telegram %s", async (outcome) => {
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
      expect(finalInput.alertLeaseVersion).toEqual(new Date(NOW.getTime() + 40_000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the old lease after a stale heartbeat and treats the final CAS as benign", async () => {
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
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1].alertLeaseVersion).toEqual(NOW);
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
      expect((repo.markAlertSent as ReturnType<typeof vi.fn>).mock.calls[0][1].alertLeaseVersion)
        .toEqual(new Date(NOW.getTime() + 80_000));
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
