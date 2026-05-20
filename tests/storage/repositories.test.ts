import { describe, expect, it } from "vitest";
import {
  claimObservedTransactionForUserAlert,
  getWalletPollState,
  claimUserAlertsForRetry,
  markUserAlertFailed,
  markUserAlertSent,
  updateWalletPollState,
  upsertWalletPollState
} from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type { TronTransferEvent } from "../../src/types";

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

const event: TronTransferEvent = {
  txHash: "tx-1",
  token: "USDT",
  sender: "sender",
  receiver: "receiver",
  amount: "10",
  timestamp: new Date("2026-05-20T00:00:00.000Z")
};

describe("wallet poll state repositories", () => {
  it("gets wallet poll state by watched wallet id", async () => {
    const updatedAt = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb(1, [
      {
        watched_wallet_id: "wallet-1",
        last_seen_block_ts: updatedAt,
        last_seen_tx_hash: "tx-1",
        backfill_anchor_block_ts: null,
        backfill_anchor_tx_hash: null,
        backfill_next_start: 0,
        backfill_complete: true,
        last_successful_poll_at: updatedAt,
        updated_at: updatedAt
      }
    ]);

    const state = await getWalletPollState(db, "wallet-1");

    expect(state?.watchedWalletId).toBe("wallet-1");
    expect(queries[0].sql).toContain("from wallet_poll_state");
    expect(queries[0].params).toEqual(["wallet-1"]);
  });

  it("upserts wallet poll state keyed by watched wallet id", async () => {
    const now = new Date("2026-05-20T00:00:00.000Z");
    const { db, queries } = createMockDb();

    await upsertWalletPollState(db, {
      watchedWalletId: "wallet-1",
      lastSeenBlockTs: now,
      lastSeenTxHash: "tx-1",
      backfillAnchorBlockTs: now,
      backfillAnchorTxHash: "tx-anchor",
      backfillNextStart: 50,
      backfillComplete: true,
      lastSuccessfulPollAt: now
    });

    expect(queries[0].sql).toContain("on conflict (watched_wallet_id) do update");
    expect(queries[0].sql).toContain("updated_at = now()");
  });

  it("updates only provided wallet poll state fields", async () => {
    const { db, queries } = createMockDb();

    await updateWalletPollState(db, { watchedWalletId: "wallet-1", backfillComplete: true, backfillNextStart: 0 });

    expect(queries[0].sql).toContain("backfill_next_start = $2");
    expect(queries[0].sql).toContain("backfill_complete = $3");
    expect(queries[0].sql).toContain("updated_at = now()");
    expect(queries[0].params).toEqual(["wallet-1", 0, true]);
  });
});

describe("observed transaction user alert repositories", () => {
  it("atomically claims an observed transaction for user alerting on insert", async () => {
    const { db, queries } = createMockDb(1);

    const claimed = await claimObservedTransactionForUserAlert(db, { watchedWalletId: "wallet-1", event });

    expect(claimed).toBe(true);
    expect(queries[0].sql).toContain("user_alert_status");
    expect(queries[0].sql).toContain("'sending'");
    expect(queries[0].sql).toContain("on conflict (tx_hash, watched_wallet_id) do nothing");
  });

  it("returns false when atomic claim hits an existing observed transaction", async () => {
    const { db } = createMockDb(0);

    await expect(claimObservedTransactionForUserAlert(db, { watchedWalletId: "wallet-1", event })).resolves.toBe(false);
  });

  it("atomically claims pending or failed user alerts for retry", async () => {
    const { db, queries } = createMockDb();

    await claimUserAlertsForRetry(db, 25);

    expect(queries[0].sql).toContain("for update skip locked");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].params).toEqual([25]);
  });

  it("marks user alerts sent", async () => {
    const { db, queries } = createMockDb();

    await markUserAlertSent(db, { txHash: "tx-1", watchedWalletId: "wallet-1" });

    expect(queries[0].sql).toContain("user_alert_status = 'sent'");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].sql).toContain("user_alert_updated_at = now()");
  });

  it("marks user alerts failed with bounded error text and incremented attempts", async () => {
    const { db, queries } = createMockDb();
    const longError = "x".repeat(3000);

    await markUserAlertFailed(db, { txHash: "tx-1", watchedWalletId: "wallet-1", error: longError });

    expect(queries[0].sql).toContain("user_alert_attempts = user_alert_attempts + 1");
    expect(queries[0].sql).toContain("user_alert_status = 'sending'");
    expect(queries[0].params[2]).toHaveLength(1024);
  });
});
