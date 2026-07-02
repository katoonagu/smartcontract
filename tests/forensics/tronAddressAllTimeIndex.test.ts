import { describe, expect, it, vi } from "vitest";
import {
  indexTronAddressUsdtHistory,
  normalizeTronscanTransferForAddressIndex,
  shouldIndexCanonicalTronscanUsdtTransfer
} from "../../src/forensics/tronAddressAllTimeIndex";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { TronAddressUsdtIndexState } from "../../src/types";

const address = "TSubject111111111111111111111111111111";

function raw(tx: string, from: string, to: string, amount: string, ts: number) {
  return {
    transaction_id: tx,
    block: 55_000_001,
    event_type: "Transfer",
    from_address: from,
    to_address: to,
    quant: amount,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    revert: false,
    riskTransaction: false,
    block_ts: ts
  };
}

describe("tron address all-time indexer", () => {
  it("normalizes raw TronScan transfers into stable transfer ids", () => {
    const transfer = normalizeTronscanTransferForAddressIndex(raw(
      "tx1",
      "TFrom1111111111111111111111111111111",
      "TTo111111111111111111111111111111111",
      "1000000",
      1_780_090_767_000
    ));

    expect(transfer).toMatchObject({
      txHash: "tx1",
      blockNumber: 55_000_001,
      blockTimestamp: new Date(1_780_090_767_000),
      fromAddress: "TFrom1111111111111111111111111111111",
      toAddress: "TTo111111111111111111111111111111111",
      amountRaw: "1000000",
      method: "transfer",
      eventType: "Transfer",
      confirmed: true
    });
    expect(Number.isInteger(transfer.eventIndex)).toBe(true);
    expect(transfer.transferId).toMatch(/^tronscan:/);
  });

  it("uses startTimestamp and endTimestamp for every provider window", async () => {
    const windows: Array<{ startTimestamp?: number; endTimestamp?: number; offset: number }> = [];
    const page = vi.fn(async (_address: string, options: { start?: number; limit?: number; startTimestamp?: number; endTimestamp?: number }) => {
      windows.push({
        startTimestamp: options.startTimestamp,
        endTimestamp: options.endTimestamp,
        offset: options.start ?? 0
      });
      return {
        provider: "tronscan" as const,
        total: 2,
        rangeTotal: 2,
        transfers: options.start === 0
          ? [raw("tx-a", "TA", address, "100", 1_780_000_000_000), raw("tx-b", "TB", address, "100", 1_770_000_000_000)]
          : []
      };
    });

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 1,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(windows[0]).toEqual({ startTimestamp: 0, endTimestamp: 1_790_000_000_000, offset: 0 });
    expect(result.status).toBe("complete");
    expect(result.statusReason).toBe("complete_provider_windowed");
  });

  it("splits capped windows and never marks rangeTotal 10000 complete", async () => {
    const windows: Array<{ startTimestamp?: number; endTimestamp?: number }> = [];
    const page = vi.fn(async (_address: string, options: { start?: number; limit?: number; startTimestamp?: number; endTimestamp?: number }) => {
      windows.push({ startTimestamp: options.startTimestamp, endTimestamp: options.endTimestamp });
      return {
        provider: "tronscan" as const,
        total: 10_000,
        rangeTotal: 10_000,
        transfers: [raw(`dense-${windows.length}`, "TA", address, "100", options.endTimestamp ?? 1_790_000_000_000)]
      };
    });

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 8,
      maxWindowSplitDepth: 2,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(windows.length).toBeGreaterThan(1);
    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_cap");
  });

  it("writes page audit and a complete coverage interval for an uncapped window", async () => {
    const pages: Array<{ rangeTotal: number | null; rawResponseHash: string | null; canonicalTransferHash: string | null }> = [];
    const intervals: Array<{ status: string; rangeTotal: number | null; rowsFetched: number }> = [];
    const page = vi.fn(async (_address: string, options: { start?: number }) => ({
      provider: "tronscan" as const,
      total: 3,
      rangeTotal: 3,
      transfers: options.start === 0
        ? [raw("tx-a", "TA", address, "100", 1_780_000_000_000), raw("tx-b", "TB", address, "100", 1_770_000_000_000)]
        : [raw("tx-c", "TC", address, "100", 1_760_000_000_000)]
    }));

    await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 1,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async (pageAudit) => {
        pages.push({
          rangeTotal: pageAudit.rangeTotal,
          rawResponseHash: pageAudit.rawResponseHash,
          canonicalTransferHash: pageAudit.canonicalTransferHash
        });
      },
      upsertCoverageInterval: async (interval) => {
        intervals.push({ status: interval.status, rangeTotal: interval.rangeTotal, rowsFetched: interval.rowsFetched });
      }
    });

    expect(pages.every((pageAudit) => pageAudit.rangeTotal === 3 && pageAudit.rawResponseHash && pageAudit.canonicalTransferHash)).toBe(true);
    expect(intervals).toEqual([{ status: "complete", rangeTotal: 3, rowsFetched: 3 }]);
  });

  it("fetches offset pages in bounded batches", async () => {
    let active = 0;
    let maxActive = 0;
    const offsets: number[] = [];
    const page = vi.fn(async (_address: string, options: { start?: number }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      offsets.push(options.start ?? 0);
      await new Promise((resolve) => setTimeout(resolve, options.start === 0 ? 0 : 10));
      active -= 1;
      return {
        provider: "tronscan" as const,
        total: 5,
        rangeTotal: 5,
        transfers: [raw(`tx-${options.start ?? 0}`, "TA", address, "100", 1_780_000_000_000 - (options.start ?? 0))]
      };
    });

    await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 2,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(offsets).toEqual([0, 2, 4]);
    expect(maxActive).toBe(2);
  });

  it("dedupes overlap rows by transferId", async () => {
    const insertedTransferIds: string[] = [];
    const page = vi.fn(async (_address: string, options: { start?: number; startTimestamp?: number; endTimestamp?: number }) => ({
      provider: "tronscan" as const,
      total: 4,
      rangeTotal: 4,
      transfers: options.start === 0
        ? [raw("tx-a", "TA", address, "100", 1_780_000_000_000), raw("tx-b", "TB", address, "100", 1_770_000_000_000)]
        : [raw("tx-b", "TB", address, "100", 1_770_000_000_000), raw("tx-c", "TC", address, "100", 1_760_000_000_000)]
    }));

    await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 2,
      pageBatchSize: 1,
      maxPagesPerRun: 4,
      listTransferPage: page,
      upsertTransfers: async (transfers) => {
        insertedTransferIds.push(...transfers.map((transfer) => transfer.transferId ?? ""));
      },
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(new Set(insertedTransferIds).size).toBe(insertedTransferIds.length);
  });

  it("keeps identical no-index same-tx rows split across pages distinct", async () => {
    const insertedTransferIds: string[] = [];
    const transfer = raw("tx-same", "TA", address, "100", 1_780_000_000_000);
    const page = vi.fn(async (_address: string, options: { start?: number }) => ({
      provider: "tronscan" as const,
      total: 2,
      rangeTotal: 2,
      transfers: [transfer]
    }));

    await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 1,
      pageBatchSize: 1,
      maxPagesPerRun: 3,
      listTransferPage: page,
      upsertTransfers: async (transfers) => {
        insertedTransferIds.push(...transfers.map((row) => row.transferId ?? ""));
      },
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(page).toHaveBeenCalledTimes(2);
    expect(insertedTransferIds).toHaveLength(2);
    expect(new Set(insertedTransferIds).size).toBe(2);
  });

  it("upserts fetched canonical rows when rangeTotal is null", async () => {
    const insertedTransferIds: string[] = [];

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: async () => ({
        provider: "trongrid_fallback" as const,
        total: null,
        rangeTotal: null,
        transfers: [raw("tx-null-total", "TA", address, "100", 1_780_000_000_000)]
      }),
      upsertTransfers: async (transfers) => {
        insertedTransferIds.push(...transfers.map((row) => row.transferId ?? ""));
      },
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_cap");
    expect(insertedTransferIds).toHaveLength(1);
  });

  it("upserts fetched canonical rows when the page budget stops an uncapped window", async () => {
    const insertedTransferIds: string[] = [];

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 1,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: async () => ({
        provider: "tronscan" as const,
        total: 2,
        rangeTotal: 2,
        transfers: [raw("tx-budget", "TA", address, "100", 1_780_000_000_000)]
      }),
      upsertTransfers: async (transfers) => {
        insertedTransferIds.push(...transfers.map((row) => row.transferId ?? ""));
      },
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_budget_exhausted");
    expect(insertedTransferIds).toHaveLength(1);
  });

  it("marks targeted backfill as targeted coverage only", async () => {
    const targetTimestamp = new Date("2026-06-14T15:05:15.000Z");
    const windows: Array<{ startTimestamp?: number; endTimestamp?: number }> = [];
    const page = vi.fn(async (_address: string, options: { startTimestamp?: number; endTimestamp?: number }) => {
      windows.push({ startTimestamp: options.startTimestamp, endTimestamp: options.endTimestamp });
      return {
        provider: "tronscan" as const,
        total: 1,
        rangeTotal: 1,
        transfers: [raw("target-1", "TA", address, "100", targetTimestamp.getTime() - 1_000)]
      };
    });
    const upsertState = vi.fn(async (state) => ({
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      coverageKind: "provider_windowed" as const,
      provider: "tronscan" as const,
      totalReported: 1,
      fetchedTransferCount: 1,
      uniqueCounterpartyCount: 1,
      newestTransferAt: targetTimestamp,
      oldestTransferAt: targetTimestamp,
      fetchedPageCount: 1,
      plannedPageCount: null,
      currentEndTimestamp: null,
      providerCapHit: false,
      budgetExhausted: false,
      providerInconsistent: false,
      priority: 10,
      nextRunAt: targetTimestamp,
      attemptCount: 1,
      maxAttempts: 5,
      retryCount: 0,
      lastError: null,
      lastErrorClass: null,
      lastSuccessfulPageAt: targetTimestamp,
      queuedReason: "where_is_money_hop",
      requestedByJobId: "job-1",
      lockedAt: null,
      lockedUntil: null,
      heartbeatAt: null,
      lockOwner: null,
      budgetPages: null,
      budgetSeconds: null,
      completedAt: targetTimestamp,
      createdAt: targetTimestamp,
      updatedAt: targetTimestamp,
      ...state
    }));

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "targeted",
      targetTimestamp,
      stopAtTimestamp: targetTimestamp,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: page,
      upsertTransfers: async () => undefined,
      upsertState,
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(windows[0]).toEqual({ startTimestamp: 0, endTimestamp: targetTimestamp.getTime() });
    expect(result.coverageMode).toBe("targeted");
    expect(result.targetTimestamp).toEqual(targetTimestamp);
    expect(upsertState).toHaveBeenCalledWith(expect.objectContaining({
      coverageMode: "targeted",
      targetTimestamp
    }));
  });

  it("uses stopAtTimestamp as the targeted coverage target when targetTimestamp is absent", async () => {
    const stopAtTimestamp = new Date("2026-06-01T00:00:00.000Z");
    const seenEnds: number[] = [];

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "targeted",
      stopAtTimestamp,
      now: () => new Date("2026-07-02T00:00:00.000Z"),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: async (_address, options) => {
        seenEnds.push(options.endTimestamp ?? -1);
        return {
          provider: "tronscan" as const,
          total: 0,
          rangeTotal: 0,
          transfers: []
        };
      },
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(seenEnds).toEqual([stopAtTimestamp.getTime()]);
    expect(result.targetTimestamp).toEqual(stopAtTimestamp);
  });

  it("marks provider inconsistent when the same page canonical transfer hash changes", async () => {
    const upsertTransfers = vi.fn(async () => undefined);
    const page = vi.fn(async () => ({
      provider: "tronscan" as const,
      total: 1,
      rangeTotal: 1,
      transfers: [raw("tx-a", "TA", address, "100", 1_780_000_000_000)]
    }));

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      initialPagesByKey: new Map([["0:1790000000000:0", { rawResponseHash: "old-raw-hash", canonicalTransferHash: "old-canonical-hash" }]]),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: page,
      upsertTransfers,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_inconsistent");
    expect(upsertTransfers).not.toHaveBeenCalled();
  });

  it("accepts transfer-history rows with missing event type or contractRet but rejects explicit non-canonical rows", () => {
    const base = raw("tx-filter", "TA", address, "100", 1_780_000_000_000);
    const missingEventType = { ...base, event_type: undefined };
    const approval = { ...base, event_type: "Approval" };

    expect(shouldIndexCanonicalTronscanUsdtTransfer(missingEventType)).toBe(true);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, contractRet: undefined })).toBe(true);
    expect(shouldIndexCanonicalTronscanUsdtTransfer(approval)).toBe(false);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, contractRet: "REVERT" })).toBe(false);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, finalResult: "FAILED" })).toBe(false);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, status: "FAILED" })).toBe(false);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, confirmed: false })).toBe(false);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, revert: true })).toBe(false);
    expect(shouldIndexCanonicalTronscanUsdtTransfer({ ...base, contract_address: "TWrongToken111111111111111111111111111" })).toBe(false);
  });

  it("carries providerCapHit through budget exhaustion after a capped parent window", async () => {
    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: async () => ({
        provider: "tronscan" as const,
        total: 10_000,
        rangeTotal: 10_000,
        transfers: [raw("tx-parent-cap", "TA", address, "100", 1_780_000_000_000)]
      }),
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_budget_exhausted");
    expect(result.providerCapHit).toBe(true);
  });

  it("does not upsert capped parent rows after split child pages are fetched", async () => {
    let calls = 0;
    const upsertedTxHashes: string[] = [];

    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 2,
      listTransferPage: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            provider: "tronscan" as const,
            total: 10_000,
            rangeTotal: 10_000,
            transfers: [raw("tx-parent-cap", "TA", address, "100", 1_780_000_000_000)]
          };
        }
        return {
          provider: "tronscan" as const,
          total: null,
          rangeTotal: null,
          transfers: [raw("tx-child", "TA", address, "100", 1_780_000_000_000)]
        };
      },
      upsertTransfers: async (transfers) => {
        upsertedTxHashes.push(...transfers.map((transfer) => transfer.txHash));
      },
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(calls).toBe(2);
    expect(upsertedTxHashes).toEqual(["tx-child"]);
    expect(result.fetchedTransferCount).toBe(1);
    expect(result.providerCapHit).toBe(true);
  });

  it("does not mark TronGrid fallback complete without rangeTotal or equivalent coverage", async () => {
    const result = await indexTronAddressUsdtHistory({
      address,
      coverageMode: "all_time",
      now: () => new Date(1_790_000_000_000),
      pageLimit: 50,
      pageBatchSize: 1,
      maxPagesPerRun: 1,
      listTransferPage: async () => ({
        provider: "trongrid_fallback" as const,
        total: null,
        rangeTotal: null,
        transfers: []
      }),
      upsertTransfers: async () => undefined,
      upsertState: async (state) => ({ ...state } as TronAddressUsdtIndexState),
      upsertPage: async () => undefined,
      upsertCoverageInterval: async () => undefined
    });

    expect(result.status).toBe("partial");
    expect(result.statusReason).toBe("partial_provider_cap");
  });
});
