import { describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/db";
import {
  clearTelegramUserPendingAction,
  getTelegramUserSession,
  getWalletDashboardSnapshot,
  recordWalletPollFailure,
  recordWalletPollSuccess,
  setTelegramUserPendingAction,
  upsertWalletDashboardSnapshot
} from "../../src/storage/repositories";

function createMockDb(rowCount = 0, rows: Record<string, unknown>[] = []): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rowCount, rows };
      }
    } as unknown as Db,
    queries
  };
}

describe("telegram user session repositories", () => {
  it("maps a stored pending action session", async () => {
    const updatedAt = new Date("2026-05-21T08:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        telegram_user_id: "123",
        pending_action: "add_wallet",
        selected_wallet_id: "wallet-1",
        updated_at: updatedAt
      }
    ]);

    const session = await getTelegramUserSession(db, "123");

    expect(session).toEqual({
      telegramUserId: "123",
      pendingAction: "add_wallet",
      selectedWalletId: "wallet-1",
      updatedAt
    });
    expect(queries[0].sql).toContain("from telegram_user_sessions");
    expect(queries[0].params).toEqual(["123"]);
  });

  it("upserts a pending action for a telegram user", async () => {
    const { db, queries } = createMockDb();

    await setTelegramUserPendingAction(db, {
      telegramUserId: "123",
      pendingAction: "check_address",
      selectedWalletId: "wallet-1"
    });

    expect(queries[0].sql).toContain("on conflict (telegram_user_id) do update");
    expect(queries[0].sql).toContain("pending_action = excluded.pending_action");
    expect(queries[0].params).toEqual(["123", "check_address", "wallet-1"]);
  });

  it("clears pending action without deleting the session row", async () => {
    const { db, queries } = createMockDb();

    await clearTelegramUserPendingAction(db, "123");

    expect(queries[0].sql).toContain("pending_action = null");
    expect(queries[0].sql).toContain("selected_wallet_id = null");
    expect(queries[0].params).toEqual(["123"]);
  });
});

describe("wallet dashboard snapshot repositories", () => {
  it("maps numeric database fields as strings", async () => {
    const refreshedAt = new Date("2026-05-21T08:05:00.000Z");
    const { db } = createMockDb(1, [
      {
        watched_wallet_id: "wallet-1",
        trx_balance_sun: "123456789",
        usdt_balance_micro: "2500000",
        wallet_created_at: new Date("2026-05-01T00:00:00.000Z"),
        total_tx_count: 42,
        incoming_tx_count: 30,
        outgoing_tx_count: 12,
        thirty_day_in_usdt: "100.500000",
        thirty_day_out_usdt: "25.125000",
        thirty_day_transfer_count: 7,
        thirty_day_fee_sun: "3000000",
        trx_usd_price: "0.12500000",
        analytics_partial: false,
        refreshed_at: refreshedAt,
        last_error: null
      }
    ]);

    const snapshot = await getWalletDashboardSnapshot(db, "wallet-1");

    expect(snapshot).toMatchObject({
      watchedWalletId: "wallet-1",
      trxBalanceSun: "123456789",
      usdtBalanceMicro: "2500000",
      thirtyDayInUsdt: "100.500000",
      thirtyDayOutUsdt: "25.125000",
      thirtyDayFeeSun: "3000000",
      trxUsdPrice: "0.12500000",
      refreshedAt
    });
  });

  it("upserts a dashboard snapshot by watched wallet id", async () => {
    const { db, queries } = createMockDb();

    await upsertWalletDashboardSnapshot(db, {
      watchedWalletId: "wallet-1",
      trxBalanceSun: "123456789",
      usdtBalanceMicro: "2500000",
      walletCreatedAt: null,
      totalTxCount: null,
      incomingTxCount: "1",
      outgoingTxCount: "2",
      thirtyDayInUsdt: "100.500000",
      thirtyDayOutUsdt: "25.125000",
      thirtyDayTransferCount: 7,
      thirtyDayFeeSun: "3000000",
      trxUsdPrice: null,
      analyticsPartial: true,
      refreshedAt: new Date("2026-05-21T08:05:00.000Z"),
      lastError: "partial refresh"
    });

    expect(queries[0].sql).toContain("on conflict (watched_wallet_id) do update");
    expect(queries[0].sql).toContain("analytics_partial = excluded.analytics_partial");
    expect(queries[0].params).toContain("123456789");
    expect(queries[0].params).toContain("100.500000");
  });
});

describe("wallet poll result repositories", () => {
  it("records poll success counts and clears the previous poll error", async () => {
    const now = new Date("2026-05-21T08:10:00.000Z");
    const { db, queries } = createMockDb();

    await recordWalletPollSuccess(db, {
      watchedWalletId: "wallet-1",
      lastSeenBlockTs: now,
      lastSeenTxHash: "tx-1",
      backfillAnchorBlockTs: null,
      backfillAnchorTxHash: null,
      backfillNextStart: 0,
      backfillComplete: true,
      lastSuccessfulPollAt: now,
      eventCount: 3,
      newCount: 2
    });

    expect(queries[0].sql).toContain("last_poll_event_count");
    expect(queries[0].sql).toContain("last_poll_error = null");
    expect(queries[0].params).toEqual(["wallet-1", now, "tx-1", null, null, 0, true, now, 3, 2]);
  });

  it("records a bounded poll failure without updating cursor columns", async () => {
    const { db, queries } = createMockDb();

    await recordWalletPollFailure(db, { watchedWalletId: "wallet-1", error: "x".repeat(3000) });

    expect(queries[0].sql).toContain("last_poll_error");
    expect(queries[0].sql).not.toContain("last_seen_tx_hash");
    expect(queries[0].params).toEqual(["wallet-1", "x".repeat(1024)]);
  });
});
