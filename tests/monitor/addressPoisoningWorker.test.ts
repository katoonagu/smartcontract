import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import {
  ADDRESS_POISONING_WORKER_DEFAULTS,
  runSingleAddressPoisoningCycle,
  type AddressPoisoningWorkerRepository
} from "../../src/monitor/addressPoisoningWorker";
import { authoritativeRegisteredService } from "../../src/forensics/serviceClassifier";
import type { AddressPoisoningCheckWorkItem, AddressLabel } from "../../src/types";
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
    persistCandidate: vi.fn(async () => ({ id: "candidate-1" }))
  };
}

type RelatedTransferLookup = Parameters<typeof runSingleAddressPoisoningCycle>[0]["tronClient"]["listRelatedTrc20Transfers"];

function deps(
  repo: AddressPoisoningWorkerRepository,
  listRelatedTrc20Transfers: RelatedTransferLookup = vi.fn(async () => [])
) {
  return {
    db: {} as never,
    repository: repo,
    tronClient: { listRelatedTrc20Transfers },
    realtimeMaxAgeMs: 120_000,
    now: () => NOW,
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
      retryDelayMs: 30_000,
      maxFailureAttempts: 4
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
    const page = [match, ...Array.from({ length: 99 }, (_, index) => rawTransfer({ transaction_id: `noise-${index}` }))];
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
    expect(input.evidenceJson.providerFacts).toHaveLength(100);
    expect(input.evidenceJson.providerTransferIds).toHaveLength(100);
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

  it("caps a misbehaving claim source at twenty", async () => {
    const repo = repository(Array.from({ length: 25 }, (_, index) => workItem({ txHash: `tx-${index}` })));
    const metrics = await runSingleAddressPoisoningCycle(deps(repo));
    expect(metrics.claimed).toBe(20);
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
