import { describe, expect, it } from "vitest";
import { runSinglePollingCycle } from "../../src/monitor/monitorWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel, TronTransferEvent, WatchedWallet } from "../../src/types";
import type { ObservedTransactionUserAlert, UserAlertStatus, WalletPollState } from "../../src/storage/repositories";

const watchedWallet: WatchedWallet = {
  id: "wallet-1",
  telegramUserId: "123",
  telegramUsername: "client_user",
  address: "TReceiver11111111111111111111111111111",
  createdAt: new Date("2026-05-20T00:00:00.000Z")
};

function rawTransfer(input: { txHash: string; sender?: string; timestamp: number; amount?: string }) {
  return {
    transaction_id: input.txHash,
    from_address: input.sender ?? `TSender${input.txHash.padEnd(28, "1")}`,
    to_address: watchedWallet.address,
    quant: input.amount ?? "1000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
    block_ts: input.timestamp
  };
}

function observedAlert(input: {
  txHash: string;
  status: UserAlertStatus;
  attempts?: number;
  timestamp?: Date;
}): ObservedTransactionUserAlert {
  const timestamp = input.timestamp ?? new Date("2026-05-20T00:00:00.000Z");
  return {
    txHash: input.txHash,
    watchedWalletId: watchedWallet.id,
    sender: "TSenderRetry111111111111111111111111",
    receiver: watchedWallet.address,
    token: "USDT",
    amount: "1",
    timestamp,
    userAlertStatus: input.status,
    userAlertAttempts: input.attempts ?? 0,
    userAlertLastError: null,
    userAlertUpdatedAt: null,
    createdAt: timestamp
  };
}

function createDeps(overrides: Partial<Parameters<typeof runSinglePollingCycle>[0]> = {}) {
  const sentUserMessages: string[] = [];
  const sentAdminMessages: string[] = [];
  const claimed: string[] = [];
  const sentMarks: string[] = [];
  const failedMarks: Array<{ txHash: string; error: string }> = [];
  const pollStates = new Map<string, WalletPollState>();
  const updatedStates: WalletPollState[] = [];
  const pages = new Map<number, ReturnType<typeof rawTransfer>[]>();

  const deps: Parameters<typeof runSinglePollingCycle>[0] = {
    wallets: [watchedWallet],
    tronClient: {
      async listIncomingTrc20Transfers(_address, options) {
        return pages.get(options?.start ?? 0) ?? [];
      },
      async getTransaction() {
        return {};
      }
    },
    pageLimit: 2,
    maxPagesPerWallet: 3,
    backfillLookbackMs: 86_400_000,
    now: () => new Date("2026-05-20T01:00:00.000Z"),
    getWalletPollState: async (watchedWalletId) => pollStates.get(watchedWalletId) ?? null,
    upsertWalletPollState: async (state) => {
      const next: WalletPollState = {
        watchedWalletId: state.watchedWalletId,
        lastSeenBlockTs: state.lastSeenBlockTs ?? null,
        lastSeenTxHash: state.lastSeenTxHash ?? null,
        backfillAnchorBlockTs: state.backfillAnchorBlockTs ?? null,
        backfillAnchorTxHash: state.backfillAnchorTxHash ?? null,
        backfillNextStart: state.backfillNextStart ?? 0,
        backfillComplete: state.backfillComplete ?? false,
        lastSuccessfulPollAt: state.lastSuccessfulPollAt ?? null,
        updatedAt: new Date("2026-05-20T01:00:00.000Z")
      };
      pollStates.set(state.watchedWalletId, next);
      updatedStates.push(next);
    },
    claimObservedTransactionForUserAlert: async ({ event }) => {
      if (claimed.includes(event.txHash)) return false;
      claimed.push(event.txHash);
      return true;
    },
    claimUserAlertsForRetry: async () => [],
    markUserAlertSent: async ({ txHash }) => {
      sentMarks.push(txHash);
      return true;
    },
    markUserAlertFailed: async ({ txHash, error }) => {
      failedMarks.push({ txHash, error });
      return true;
    },
    getLabelsForAddress: async () => [],
    sendUserAlert: async (_telegramUserId, message) => {
      sentUserMessages.push(message);
    },
    sendAdminAlert: async (message) => {
      sentAdminMessages.push(message);
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    ...overrides
  };

  return { deps, sentUserMessages, sentAdminMessages, claimed, sentMarks, failedMarks, pollStates, updatedStates, pages };
}

describe("runSinglePollingCycle", () => {
  it("fetches paginated transfers until the stored cursor and processes new transfers oldest first", async () => {
    const ctx = createDeps();
    ctx.pollStates.set(watchedWallet.id, {
      watchedWalletId: watchedWallet.id,
      lastSeenBlockTs: new Date(1_779_220_000_000),
      lastSeenTxHash: "cursor",
      backfillAnchorBlockTs: null,
      backfillAnchorTxHash: null,
      backfillNextStart: 0,
      backfillComplete: true,
      lastSuccessfulPollAt: new Date("2026-05-20T00:30:00.000Z"),
      updatedAt: new Date("2026-05-20T00:30:00.000Z")
    });
    ctx.pages.set(0, [
      rawTransfer({ txHash: "newest", timestamp: 1_779_220_030_000 }),
      rawTransfer({ txHash: "middle", timestamp: 1_779_220_020_000 })
    ]);
    ctx.pages.set(2, [
      rawTransfer({ txHash: "oldest", timestamp: 1_779_220_010_000 }),
      rawTransfer({ txHash: "cursor", timestamp: 1_779_220_000_000 })
    ]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimed).toEqual(["oldest", "middle", "newest"]);
    expect(ctx.sentUserMessages).toHaveLength(3);
    expect(ctx.updatedStates.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastSeenTxHash: "newest",
      backfillComplete: true
    });
  });

  it("uses wallet creation time and backfill lookback as the first-poll timestamp floor", async () => {
    const ctx = createDeps();
    const starts: Array<number | undefined> = [];
    ctx.deps.tronClient = {
      async listIncomingTrc20Transfers(_address, options) {
        starts.push(options?.minTimestamp);
        return [];
      },
      async getTransaction() {
        return {};
      }
    };

    await runSinglePollingCycle(ctx.deps);

    expect(starts[0]).toBe(watchedWallet.createdAt.getTime());
    expect(ctx.updatedStates.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      backfillComplete: true
    });
  });

  it("does not advance the main cursor when page cap is hit before reaching the stored cursor", async () => {
    const ctx = createDeps({ maxPagesPerWallet: 1 });
    ctx.pollStates.set(watchedWallet.id, {
      watchedWalletId: watchedWallet.id,
      lastSeenBlockTs: new Date(1_779_220_000_000),
      lastSeenTxHash: "cursor",
      backfillAnchorBlockTs: null,
      backfillAnchorTxHash: null,
      backfillNextStart: 0,
      backfillComplete: true,
      lastSuccessfulPollAt: new Date("2026-05-20T00:30:00.000Z"),
      updatedAt: new Date("2026-05-20T00:30:00.000Z")
    });
    ctx.pages.set(0, [
      rawTransfer({ txHash: "newest", timestamp: 1_779_220_030_000 }),
      rawTransfer({ txHash: "middle", timestamp: 1_779_220_020_000 })
    ]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.updatedStates.at(-1)).toMatchObject({
      lastSeenTxHash: "cursor",
      backfillAnchorTxHash: "newest",
      backfillNextStart: 2,
      backfillComplete: false
    });
  });

  it("continues incomplete backfill from the stored page start and promotes the anchor after reaching the cursor", async () => {
    const starts: number[] = [];
    const endTimestamps: Array<number | undefined> = [];
    const ctx = createDeps();
    ctx.pollStates.set(watchedWallet.id, {
      watchedWalletId: watchedWallet.id,
      lastSeenBlockTs: new Date(1_779_220_000_000),
      lastSeenTxHash: "cursor",
      backfillAnchorBlockTs: new Date(1_779_220_030_000),
      backfillAnchorTxHash: "newest",
      backfillNextStart: 2,
      backfillComplete: false,
      lastSuccessfulPollAt: new Date("2026-05-20T00:30:00.000Z"),
      updatedAt: new Date("2026-05-20T00:30:00.000Z")
    });
    ctx.deps.tronClient = {
      async listIncomingTrc20Transfers(_address, options) {
        starts.push(options?.start ?? 0);
        endTimestamps.push(options?.endTimestamp);
        return [
          rawTransfer({ txHash: "oldest", timestamp: 1_779_220_010_000 }),
          rawTransfer({ txHash: "cursor", timestamp: 1_779_220_000_000 })
        ];
      },
      async getTransaction() {
        return {};
      }
    };

    await runSinglePollingCycle(ctx.deps);

    expect(starts[0]).toBe(2);
    expect(endTimestamps[0]).toBe(1_779_220_030_000);
    expect(ctx.updatedStates.at(-1)).toMatchObject({
      lastSeenTxHash: "newest",
      backfillAnchorTxHash: null,
      backfillNextStart: 0,
      backfillComplete: true
    });
  });

  it("does not send a new alert when atomic claim reports an existing transaction", async () => {
    const ctx = createDeps({
      claimObservedTransactionForUserAlert: async () => false
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
  });

  it("marks claimed user alerts sent after successful delivery", async () => {
    const ctx = createDeps();
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual(["tx1"]);
    expect(ctx.failedMarks).toEqual([]);
  });

  it("marks claimed user alerts failed when Telegram delivery fails", async () => {
    const ctx = createDeps({
      sendUserAlert: async () => {
        throw new Error("telegram send failed");
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentMarks).toEqual([]);
    expect(ctx.failedMarks).toEqual([{ txHash: "tx1", error: "telegram send failed" }]);
  });

  it("retries pending and failed user alerts before polling new transfers", async () => {
    const retried: string[] = [];
    const ctx = createDeps({
      claimUserAlertsForRetry: async () => [observedAlert({ txHash: "retry1", status: "sending" })],
      sendUserAlert: async (_telegramUserId, message) => {
        retried.push(message);
      }
    });

    await runSinglePollingCycle(ctx.deps);

    expect(retried).toHaveLength(1);
    expect(ctx.sentMarks).toEqual(["retry1"]);
  });

  it("does not let a retry risk calculation failure block wallet polling", async () => {
    const ctx = createDeps({
      claimUserAlertsForRetry: async () => [observedAlert({ txHash: "retry1", status: "sending" })],
      getLabelsForAddress: async (address) => {
        if (address === "TSenderRetry111111111111111111111111") throw new Error("label db down");
        return [];
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "new1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.failedMarks).toContainEqual({ txHash: "retry1", error: "label db down" });
    expect(ctx.claimed).toContain("new1");
  });

  it("does not mark a delivered user alert failed when only the sent status update fails", async () => {
    const adminMessages: string[] = [];
    const ctx = createDeps({
      markUserAlertSent: async () => {
        throw new Error("db write failed");
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [
        {
          address: "TSender",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ],
      sendAdminAlert: async (message) => {
        adminMessages.push(message);
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.failedMarks).toEqual([]);
    expect(adminMessages).toHaveLength(1);
  });

  it("sends HIGH and CRITICAL events to admins without blocking user alert status", async () => {
    const ctx = createDeps({
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [
        {
          address: "TSender",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ],
      sendAdminAlert: async () => {
        throw new Error("admin chat blocked bot");
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual(["tx1"]);
  });
});
