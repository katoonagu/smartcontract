import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { WalletDashboardSnapshot, WalletPollState } from "../../src/storage/repositories";
import type { WatchedWallet } from "../../src/types";
import type { TronDashboardClient } from "../../src/tron/tronClient";
import { getWalletDashboard } from "../../src/wallet/dashboard";

const wallet: WatchedWallet = {
  id: "wallet-1",
  telegramUserId: "42",
  telegramUsername: "tester",
  address: "T1111111111111111111111111111111111",
  createdAt: new Date("2026-05-20T00:00:00.000Z"),
  alertMode: "realtime",
  digestIntervalMinutes: 10
};

const pollState: WalletPollState = {
  watchedWalletId: wallet.id,
  lastSeenBlockTs: new Date("2026-05-21T00:00:00.000Z"),
  lastSeenTxHash: "tx-1",
  backfillAnchorBlockTs: null,
  backfillAnchorTxHash: null,
  backfillNextStart: 0,
  backfillComplete: true,
  lastSuccessfulPollAt: new Date("2026-05-21T00:00:00.000Z"),
  lastPollEventCount: 1,
  lastPollNewCount: 0,
  lastPollError: null,
  updatedAt: new Date("2026-05-21T00:00:00.000Z")
};

function snapshot(overrides: Partial<WalletDashboardSnapshot> = {}): WalletDashboardSnapshot {
  return {
    watchedWalletId: wallet.id,
    trxBalanceSun: "1000000",
    usdtBalanceMicro: "2000000",
    walletCreatedAt: new Date("2026-05-01T00:00:00.000Z"),
    totalTxCount: "3",
    incomingTxCount: "2",
    outgoingTxCount: "1",
    thirtyDayInUsdt: "10",
    thirtyDayOutUsdt: "2",
    thirtyDayTransferCount: 2,
    thirtyDayFeeSun: "1000000",
    trxUsdPrice: "0.25",
    analyticsPartial: false,
    refreshedAt: new Date("2026-05-21T00:04:00.000Z"),
    lastError: null,
    ...overrides
  };
}

function createClient(overrides: Partial<TronDashboardClient> = {}): TronDashboardClient {
  return {
    listIncomingTrc20Transfers: vi.fn(async () => []),
    getTransaction: vi.fn(async () => ({})),
    getAccount: vi.fn(async () => ({
      balance: "123000000",
      date_created: "1778457600000",
      totalTransactionCount: "12",
      transactions_in: "7",
      transactions_out: "5",
      trc20token_balances: [
        {
          tokenId: TRON_USDT_CONTRACT_ADDRESS,
          balance: "7000000",
          tokenPriceInTrx: "4"
        }
      ]
    })),
    listRelatedTrc20Transfers: vi.fn(async () => [
      {
        transaction_id: "tx-in",
        from_address: "T2222222222222222222222222222222222",
        to_address: wallet.address,
        quant: "12500000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: 1778457600000
      }
    ]),
    listTransactions: vi.fn(async () => [
      {
        ownerAddress: wallet.address,
        contractRet: "SUCCESS",
        cost: { fee: "6000000" }
      }
    ]),
    ...overrides
  };
}

function createDeps(input: {
  client?: TronDashboardClient;
  cached?: WalletDashboardSnapshot | null;
  now?: Date;
  maxPages?: number;
  forceRefreshCooldownMs?: number;
}) {
  const upsertSnapshot = vi.fn(async (_snapshot: WalletDashboardSnapshot) => undefined);
  const client = input.client ?? createClient();
  return {
    deps: {
      tronClient: client,
      config: {
        tronscanDashboardCacheTtlMs: 300_000,
        tronscanDashboardMaxPages: input.maxPages ?? 5,
        tronscanDashboardForceRefreshCooldownMs: input.forceRefreshCooldownMs ?? 60_000
      },
      getSnapshot: vi.fn(async () => input.cached ?? null),
      upsertSnapshot,
      getLabelsForAddress: vi.fn(async () => []),
      getPollState: vi.fn(async () => pollState),
      now: () => input.now ?? new Date("2026-05-21T00:05:00.000Z")
    },
    client,
    upsertSnapshot
  };
}

describe("getWalletDashboard", () => {
  it("returns a fresh cached dashboard without calling TronScan", async () => {
    const { deps, client } = createDeps({ cached: snapshot() });

    const dashboard = await getWalletDashboard(deps, { wallet });

    expect(dashboard.source).toBe("cache");
    expect(dashboard.snapshot.usdtBalanceMicro).toBe("2000000");
    expect(dashboard.safety.score).toBe(0);
    expect(client.getAccount).not.toHaveBeenCalled();
  });

  it("bypasses a fresh cache when force refresh is requested", async () => {
    const { deps, client } = createDeps({ cached: snapshot(), forceRefreshCooldownMs: 0 });

    const dashboard = await getWalletDashboard(deps, { wallet, forceRefresh: true });

    expect(dashboard.source).toBe("fresh");
    expect(client.getAccount).toHaveBeenCalledWith(wallet.address);
  });

  it("serves cached dashboard during force-refresh cooldown", async () => {
    const { deps, client } = createDeps({
      cached: snapshot({ refreshedAt: new Date("2026-05-21T00:04:30.000Z") }),
      forceRefreshCooldownMs: 60_000
    });

    const dashboard = await getWalletDashboard(deps, { wallet, forceRefresh: true });

    expect(dashboard.source).toBe("cache");
    expect(client.getAccount).not.toHaveBeenCalled();
  });

  it("refreshes account, transfer flow, fees, and writes the snapshot", async () => {
    const { deps, upsertSnapshot } = createDeps({ cached: null });

    const dashboard = await getWalletDashboard(deps, { wallet });

    expect(dashboard.source).toBe("fresh");
    expect(dashboard.snapshot.usdtBalanceMicro).toBe("7000000");
    expect(dashboard.snapshot.thirtyDayInUsdt).toBe("12.5");
    expect(dashboard.snapshot.thirtyDayFeeSun).toBe("6000000");
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({ totalTxCount: "12", analyticsPartial: false }));
  });

  it("marks analytics partial when the page cap is hit", async () => {
    const client = createClient({
      listRelatedTrc20Transfers: vi.fn(async () => Array.from({ length: 50 }, (_, index) => ({
        transaction_id: `tx-${index}`,
        from_address: "T2222222222222222222222222222222222",
        to_address: wallet.address,
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: 1778457600000
      }))),
      listTransactions: vi.fn(async () => [])
    });
    const { deps } = createDeps({ client, maxPages: 1 });

    const dashboard = await getWalletDashboard(deps, { wallet, forceRefresh: true });

    expect(dashboard.snapshot.analyticsPartial).toBe(true);
  });

  it("falls back to a stale snapshot when refresh fails", async () => {
    const client = createClient({
      getAccount: vi.fn(async () => {
        throw new Error("TronScan unavailable");
      })
    });
    const { deps } = createDeps({
      client,
      cached: snapshot({ refreshedAt: new Date("2026-05-20T00:00:00.000Z") }),
      forceRefreshCooldownMs: 0
    });

    const dashboard = await getWalletDashboard(deps, { wallet, forceRefresh: true });

    expect(dashboard.source).toBe("stale");
    expect(dashboard.snapshot.analyticsPartial).toBe(true);
    expect(dashboard.lastError).toContain("TronScan unavailable");
  });

  it("does not treat an error snapshot as fresh cache on the next read", async () => {
    const client = createClient();
    const { deps } = createDeps({
      client,
      cached: snapshot({
        refreshedAt: new Date("2026-05-21T00:04:30.000Z"),
        analyticsPartial: true,
        lastError: "previous error"
      })
    });

    const dashboard = await getWalletDashboard(deps, { wallet });

    expect(dashboard.source).toBe("fresh");
    expect(client.getAccount).toHaveBeenCalledWith(wallet.address);
  });
});
