import { describe, expect, expectTypeOf, it } from "vitest";
import { runSinglePollingCycle } from "../../src/monitor/monitorWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { claimObservedTransactionForUserAlert } from "../../src/storage/repositories";
import type { AddressLabel, RawEvidenceInput, RiskSignalObservationInput, TronTransferEvent, WatchedWallet } from "../../src/types";
import type { ObservedTransactionUserAlert, UserAlertStatus, WalletPollState } from "../../src/storage/repositories";

const watchedWallet: WatchedWallet = {
  id: "wallet-1",
  telegramUserId: "123",
  telegramUsername: "client_user",
  address: "TReceiver11111111111111111111111111111",
  createdAt: new Date("2026-05-20T00:00:00.000Z"),
  alertMode: "realtime",
  digestIntervalMinutes: 10,
  locale: "en"
};

function rawTransfer(input: { txHash: string; sender?: string; receiver?: string; timestamp: number; amount?: string }) {
  return {
    transaction_id: input.txHash,
    from_address: input.sender ?? `TSender${input.txHash.padEnd(28, "1")}`,
    to_address: input.receiver ?? watchedWallet.address,
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
  const sentUserAlertOptions: Array<{ reply_markup?: unknown; parse_mode?: "HTML" } | undefined> = [];
  const sentCustomerMessages: Array<{ telegramUserId: string; message: string }> = [];
  const sentCustomerAlertOptions: Array<{ reply_markup?: unknown; parse_mode?: "HTML" } | undefined> = [];
  const sentAdminMessages: string[] = [];
  const sentDigestMessages: string[] = [];
  const sentDigestAlertOptions: Array<{ parse_mode?: "HTML" } | undefined> = [];
  const claimed: string[] = [];
  const claimInputs: Array<{
    watchedWalletId: string;
    event: TronTransferEvent;
    poisoningCheckStatus: "pending" | "skipped" | "skipped_backfill";
    poisoningCheckReason: string | null;
  }> = [];
  const sentMarks: string[] = [];
  const skippedMarks: string[] = [];
  const skippedReasons: Array<{ txHash: string; reason: string }> = [];
  const digestMarks: string[][] = [];
  const failedMarks: Array<{ txHash: string; error: string }> = [];
  const analyzingMarks: string[] = [];
  const queuedIncomingDepositJobs: Array<{
    txHash: string;
    watchedWalletId: string;
    watchedWallet: string;
    sender: string;
    amount: string;
    amountRaw: string;
    timestamp: Date;
    telegramUserId: string;
    chatId: string;
    requestedBy: string;
    alertMode: string;
    locale?: string | null;
  }> = [];
  const riskEvaluations: Array<{ rawEvidence: RawEvidenceInput[]; observations: RiskSignalObservationInput[] }> = [];
  const riskSnapshots: Array<{ txHash: string; watchedWalletId: string; level: string; score: number }> = [];
  const order: string[] = [];
  const pollStates = new Map<string, WalletPollState>();
  const updatedStates: WalletPollState[] = [];
  const updatedInputs: Array<Record<string, unknown>> = [];
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
    incomingDepositRealtimeMaxAgeMs: 24 * 60 * 60_000,
    addressPoisoningSmallTransferMaxRaw: "100000000",
    now: () => new Date("2026-05-20T01:00:00.000Z"),
    getWalletPollState: async (watchedWalletId) => pollStates.get(watchedWalletId) ?? null,
    upsertWalletPollState: async (state) => {
      updatedInputs.push({ ...state });
      const next: WalletPollState = {
        watchedWalletId: state.watchedWalletId,
        lastSeenBlockTs: state.lastSeenBlockTs ?? null,
        lastSeenTxHash: state.lastSeenTxHash ?? null,
        backfillAnchorBlockTs: state.backfillAnchorBlockTs ?? null,
        backfillAnchorTxHash: state.backfillAnchorTxHash ?? null,
        backfillNextStart: state.backfillNextStart ?? 0,
        backfillComplete: state.backfillComplete ?? false,
        lastSuccessfulPollAt: state.lastSuccessfulPollAt ?? null,
        lastPollEventCount: state.lastPollEventCount ?? 0,
        lastPollNewCount: state.lastPollNewCount ?? 0,
        lastPollError: state.lastPollError ?? null,
        updatedAt: new Date("2026-05-20T01:00:00.000Z")
      };
      pollStates.set(state.watchedWalletId, next);
      updatedStates.push(next);
    },
    claimObservedTransactionForUserAlert: async (input) => {
      claimInputs.push(input);
      const { event } = input;
      if (claimed.includes(event.txHash)) return false;
      claimed.push(event.txHash);
      return true;
    },
    claimUserAlertsForRetry: async () => [],
    claimDigestTransactions: async () => [],
    markDigestSent: async ({ txHashes }) => {
      digestMarks.push(txHashes);
      return txHashes.length;
    },
    recordObservedTransactionRisk: async ({ txHash, watchedWalletId, report }) => {
      riskSnapshots.push({ txHash, watchedWalletId, level: report.level, score: report.score });
      return true;
    },
    markUserAlertSent: async ({ txHash }) => {
      order.push(`sent:${txHash}`);
      sentMarks.push(txHash);
      return true;
    },
    markUserAlertSkipped: async ({ txHash, reason }) => {
      order.push(`skipped:${txHash}`);
      skippedMarks.push(txHash);
      skippedReasons.push({ txHash, reason });
      return true;
    },
    markUserAlertFailed: async ({ txHash, error }) => {
      order.push(`failed:${txHash}`);
      failedMarks.push({ txHash, error });
      return true;
    },
    getLabelsForAddress: async () => [],
    listCustomerAlertRecipients: async () => [],
    recordRiskEvaluation: async (evaluation) => {
      order.push("risk_evidence");
      riskEvaluations.push(evaluation);
    },
    sendUserAlert: async (_telegramUserId, message, options) => {
      order.push("user_alert");
      sentUserMessages.push(message);
      sentUserAlertOptions.push(options);
    },
    sendCustomerAdminAlert: async (telegramUserId, message, options) => {
      order.push(`customer_alert:${telegramUserId}`);
      sentCustomerMessages.push({ telegramUserId, message });
      sentCustomerAlertOptions.push(options);
    },
    sendDigestAlert: async (_telegramUserId, message, options) => {
      order.push("digest_alert");
      sentDigestMessages.push(message);
      sentDigestAlertOptions.push(options);
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

  return {
    deps,
    sentUserMessages,
    sentUserAlertOptions,
    sentCustomerMessages,
    sentCustomerAlertOptions,
    sentAdminMessages,
    sentDigestMessages,
    sentDigestAlertOptions,
    claimed,
    claimInputs,
    sentMarks,
    skippedMarks,
    skippedReasons,
    digestMarks,
    failedMarks,
    analyzingMarks,
    queuedIncomingDepositJobs,
    riskEvaluations,
    riskSnapshots,
    order,
    pollStates,
    updatedStates,
    updatedInputs,
    pages
  };
}

describe("runSinglePollingCycle", () => {
  const poisoningWallet: WatchedWallet = {
    ...watchedWallet,
    address: "THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7"
  };
  const poisoningSender = "TABPfWW3Q7vCnfPQgQ8BCpjHqFqhCd58Fg";

  it("requires an explicit raw poisoning threshold in monitor dependencies", () => {
    expectTypeOf<Parameters<typeof runSinglePollingCycle>[0]>()
      .toHaveProperty("addressPoisoningSmallTransferMaxRaw")
      .toEqualTypeOf<string>();
  });

  function poisoningTransfer(input: { amount: string; timestamp?: number; sender?: string; receiver?: string }) {
    return rawTransfer({
      txHash: `poison-${input.amount}`,
      sender: input.sender ?? poisoningSender,
      receiver: input.receiver ?? poisoningWallet.address,
      timestamp: input.timestamp ?? Date.parse("2026-05-20T00:59:00.000Z"),
      amount: input.amount
    });
  }

  it("atomically enqueues a fresh small-transfer check without a history lookup and keeps ordinary Incoming queueing", async () => {
    let relatedHistoryCalls = 0;
    const ctx = createDeps({
      wallets: [poisoningWallet],
      addressPoisoningSmallTransferMaxRaw: "100000000",
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [poisoningTransfer({ amount: "10000000" })];
        },
        async listRelatedTrc20Transfers() {
          relatedHistoryCalls += 1;
          return [];
        },
        async getTransaction() {
          return {};
        }
      } as never,
      queueIncomingDepositJob: async (input) => {
        ctx.queuedIncomingDepositJobs.push(input);
        return { id: "job-1" };
      },
      markUserAlertAnalyzing: async () => true
    });

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimInputs).toEqual([
      expect.objectContaining({
        watchedWalletId: poisoningWallet.id,
        poisoningCheckStatus: "pending",
        poisoningCheckReason: null
      })
    ]);
    expect(ctx.queuedIncomingDepositJobs).toHaveLength(1);
    expect(relatedHistoryCalls).toBe(0);
  });

  it.each([
    { label: "the exact configured maximum", amount: "100000000", status: "pending", reason: null },
    { label: "one raw unit above the maximum", amount: "100000001", status: "skipped", reason: "above_max_amount" },
    { label: "zero", amount: "0", status: "skipped", reason: "zero_amount" }
  ])("stores the initial poisoning status for $label", async ({ amount, status, reason }) => {
    const ctx = createDeps({ wallets: [poisoningWallet], addressPoisoningSmallTransferMaxRaw: "100000000" });
    ctx.pages.set(0, [poisoningTransfer({ amount })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimInputs[0]).toMatchObject({ poisoningCheckStatus: status, poisoningCheckReason: reason });
  });

  it("marks stale events as skipped backfill for poisoning", async () => {
    const ctx = createDeps({ wallets: [poisoningWallet], incomingDepositRealtimeMaxAgeMs: 15 * 60_000 });
    ctx.pages.set(0, [poisoningTransfer({ amount: "10000000", timestamp: Date.parse("2026-05-20T00:40:00.000Z") })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimInputs[0]).toMatchObject({
      poisoningCheckStatus: "skipped_backfill",
      poisoningCheckReason: "older_than_realtime_window"
    });
  });

  it.each([
    { label: "paused wallet", wallet: { ...poisoningWallet, alertMode: "paused" as const }, sender: poisoningSender, reason: "paused" },
    { label: "self transfer", wallet: poisoningWallet, sender: poisoningWallet.address, reason: "self_transfer" },
    { label: "invalid sender", wallet: poisoningWallet, sender: "not-a-tron-address", reason: "invalid_input" }
  ])("marks $label as skipped for poisoning", async ({ wallet, sender, reason }) => {
    const ctx = createDeps({ wallets: [wallet] });
    ctx.pages.set(0, [poisoningTransfer({ amount: "10000000", sender, receiver: wallet.address })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimInputs[0]).toMatchObject({ poisoningCheckStatus: "skipped", poisoningCheckReason: reason });
  });

  it("does not queue an extra ordinary job when the atomic observation was already claimed", async () => {
    let ordinaryJobs = 0;
    const ctx = createDeps({
      wallets: [poisoningWallet],
      claimObservedTransactionForUserAlert: async () => false,
      queueIncomingDepositJob: async () => {
        ordinaryJobs += 1;
        return { id: "job-1" };
      },
      markUserAlertAnalyzing: async () => true
    });
    ctx.pages.set(0, [poisoningTransfer({ amount: "10000000" })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ordinaryJobs).toBe(0);
  });

  it("persists the initial poisoning status and reason in the atomic observation insert", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const event: TronTransferEvent = {
      txHash: "atomic-poisoning",
      token: "USDT",
      sender: poisoningSender,
      receiver: poisoningWallet.address,
      amount: "10",
      timestamp: new Date("2026-05-20T00:59:00.000Z")
    };

    await claimObservedTransactionForUserAlert({
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as never, {
      watchedWalletId: poisoningWallet.id,
      event,
      poisoningCheckStatus: "skipped",
      poisoningCheckReason: "above_max_amount"
    });

    expect(queries[0].sql).toContain("poisoning_check_status");
    expect(queries[0].sql).toContain("poisoning_last_error");
    expect(queries[0].params).toEqual([
      event.txHash,
      poisoningWallet.id,
      event.sender,
      event.receiver,
      event.token,
      event.amount,
      event.timestamp,
      "skipped",
      "above_max_amount"
    ]);

    await claimObservedTransactionForUserAlert({
      async query(sql: string, params: unknown[]) {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [] };
      }
    } as never, { watchedWalletId: poisoningWallet.id, event });

    expect(queries[1].params.slice(-2)).toEqual(["skipped_backfill", null]);
  });

  it("skips stale watched wallets that were removed after the cycle loaded", async () => {
    const warnings: string[] = [];
    let transferCalls = 0;
    const ctx = createDeps({
      isWatchedWalletActive: async () => false,
      tronClient: {
        async listIncomingTrc20Transfers() {
          transferCalls += 1;
          return [];
        },
        async getTransaction() {
          return {};
        }
      },
      logger: {
        info: () => {},
        warn: (message) => {
          warnings.push(message);
        },
        error: () => {}
      }
    });

    await runSinglePollingCycle(ctx.deps);

    expect(transferCalls).toBe(0);
    expect(ctx.updatedInputs).toEqual([]);
    expect(warnings).toContain("wallet_poll_skipped_stale_wallet");
  });

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
      lastPollEventCount: 1,
      lastPollNewCount: 0,
      lastPollError: null,
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
      lastPollEventCount: 1,
      lastPollNewCount: 0,
      lastPollError: null,
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
      lastPollEventCount: 1,
      lastPollNewCount: 0,
      lastPollError: null,
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

  it("continues capped backfill even when the capped page has no parseable transfers", async () => {
    const ctx = createDeps({ maxPagesPerWallet: 1 });
    ctx.pages.set(0, [
      {
        ...rawTransfer({ txHash: "bad1", timestamp: 1_779_220_030_000 }),
        contract_address: "TNotUsdt1111111111111111111111111111"
      },
      {
        ...rawTransfer({ txHash: "bad2", timestamp: 1_779_220_020_000 }),
        contract_address: "TNotUsdt1111111111111111111111111111"
      }
    ]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.updatedStates.at(-1)).toMatchObject({
      backfillAnchorBlockTs: new Date(1_779_220_030_000),
      backfillAnchorTxHash: "bad1",
      backfillNextStart: 2,
      backfillComplete: false
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
    expect(ctx.sentUserMessages[0]).toContain(`<b>Watched wallet</b>: <code>${watchedWallet.address}</code>`);
    expect(ctx.sentUserMessages[0]).toContain("<b>Low risk</b>");
    expect(ctx.sentUserMessages[0]).toContain("<code>0/100</code>");
    expect(ctx.sentUserAlertOptions[0]?.reply_markup).toBeTruthy();
    expect(ctx.sentUserAlertOptions[0]?.parse_mode).toBe("HTML");
    expect(ctx.sentMarks).toEqual(["tx1"]);
    expect(ctx.failedMarks).toEqual([]);
    expect(ctx.order).toEqual(["risk_evidence", "user_alert", "sent:tx1"]);
  });

  it("queues incoming deposit checks instead of sending sender-only alerts when queue deps are available", async () => {
    const sender = "TSenderDeposit11111111111111111111111";
    const timestamp = 1_779_220_000_000;
    const ctx = createDeps({
      queueIncomingDepositJob: async (input) => {
        ctx.order.push(`queue:${input.txHash}`);
        ctx.queuedIncomingDepositJobs.push(input);
        return { id: "job-1" };
      },
      markUserAlertAnalyzing: async ({ txHash }) => {
        ctx.order.push(`analyzing:${txHash}`);
        ctx.analyzingMarks.push(txHash);
        return true;
      }
    } as Partial<Parameters<typeof runSinglePollingCycle>[0]>);
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", sender, timestamp, amount: "123456789" })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.queuedIncomingDepositJobs).toEqual([
      {
        txHash: "tx1",
        watchedWalletId: watchedWallet.id,
        watchedWallet: watchedWallet.address,
        sender,
        amount: "123.456789",
        amountRaw: "123456789",
        timestamp: new Date(timestamp),
        telegramUserId: watchedWallet.telegramUserId,
        chatId: watchedWallet.telegramUserId,
        requestedBy: watchedWallet.telegramUserId,
        alertMode: watchedWallet.alertMode,
        locale: "en"
      }
    ]);
    expect(ctx.queuedIncomingDepositJobs[0]).toEqual(expect.objectContaining({
      locale: "en"
    }));
    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.analyzingMarks).toEqual(["tx1"]);
    expect(ctx.order).toEqual(["queue:tx1", "analyzing:tx1"]);
  });

  it("skips stale backfill incoming deposits instead of queueing forensic jobs", async () => {
    const sender = "TSenderBackfill111111111111111111111";
    const timestamp = Date.parse("2026-05-20T00:40:00.000Z");
    const ctx = createDeps({
      incomingDepositRealtimeMaxAgeMs: 15 * 60_000,
      queueIncomingDepositJob: async (input) => {
        ctx.order.push(`queue:${input.txHash}`);
        ctx.queuedIncomingDepositJobs.push(input);
        return { id: "job-1" };
      },
      markUserAlertAnalyzing: async ({ txHash }) => {
        ctx.order.push(`analyzing:${txHash}`);
        ctx.analyzingMarks.push(txHash);
        return true;
      }
    } as Partial<Parameters<typeof runSinglePollingCycle>[0]>);
    ctx.pages.set(0, [rawTransfer({ txHash: "old1", sender, timestamp, amount: "100000000" })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimed).toEqual(["old1"]);
    expect(ctx.queuedIncomingDepositJobs).toEqual([]);
    expect(ctx.analyzingMarks).toEqual([]);
    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.riskSnapshots).toEqual([]);
    expect(ctx.skippedMarks).toEqual(["old1"]);
    expect(ctx.skippedReasons).toEqual([{ txHash: "old1", reason: "backfill_stale_transaction" }]);
    expect(ctx.order).toEqual(["skipped:old1"]);
  });

  it("marks incoming alerts failed without sender-only fallback when queueing the deposit check fails", async () => {
    const loggedErrors: string[] = [];
    const ctx = createDeps({
      queueIncomingDepositJob: async () => {
        throw new Error("queue unavailable");
      },
      markUserAlertAnalyzing: async ({ txHash }) => {
        ctx.analyzingMarks.push(txHash);
        return true;
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (message) => {
          loggedErrors.push(message);
        }
      }
    } as Partial<Parameters<typeof runSinglePollingCycle>[0]>);
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.analyzingMarks).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
    expect(ctx.failedMarks).toEqual([{ txHash: "tx1", error: "queue unavailable" }]);
    expect(loggedErrors).toContain("incoming_deposit_job_queue_failed");
  });

  it("keeps the sender-only alert path when incoming deposit queue deps are not provided", async () => {
    const ctx = createDeps();
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentUserMessages[0]).toContain("<b>Low risk</b>");
    expect(ctx.sentMarks).toEqual(["tx1"]);
    expect(ctx.failedMarks).toEqual([]);
  });

  it("risk-only mode saves LOW events without sending owner alerts", async () => {
    const riskOnlyWallet: WatchedWallet = { ...watchedWallet, alertMode: "risk_only" };
    const ctx = createDeps({ wallets: [riskOnlyWallet] });
    ctx.pages.set(0, [rawTransfer({ txHash: "low1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.claimed).toEqual(["low1"]);
    expect(ctx.riskSnapshots).toEqual([{ txHash: "low1", watchedWalletId: watchedWallet.id, level: "LOW", score: 0 }]);
    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
    expect(ctx.skippedMarks).toEqual(["low1"]);
  });

  it("risk-only mode sends MEDIUM and higher events immediately", async () => {
    const riskOnlyWallet: WatchedWallet = { ...watchedWallet, alertMode: "risk_only" };
    const ctx = createDeps({
      wallets: [riskOnlyWallet],
      getRiskSignalsForAddress: async () => ({
        graphSignals: [
          { code: "forensic_extended_provenance", message: "Route-linked risk", scoreImpact: 45, source: "test" }
        ],
        behaviorSignals: [],
        amlSignals: []
      })
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "medium1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentUserMessages[0]).toContain("<b>Medium risk</b>");
    expect(ctx.sentUserMessages[0]).toContain("<code>40/100</code>");
    expect(ctx.sentMarks).toEqual(["medium1"]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("digest mode queues LOW events but sends risky events immediately", async () => {
    const digestWallet: WatchedWallet = { ...watchedWallet, alertMode: "digest", digestIntervalMinutes: 10 };
    const ctx = createDeps({
      wallets: [digestWallet],
      getRiskSignalsForAddress: async (_address, event) => ({
        graphSignals: event.txHash === "high1"
          ? [{ code: "forensic_extended_provenance", message: "Route-linked risk", scoreImpact: 70, source: "test" }]
          : [],
        behaviorSignals: [],
        amlSignals: []
      })
    });
    ctx.pages.set(0, [
      rawTransfer({ txHash: "high1", timestamp: 1_779_220_010_000 }),
      rawTransfer({ txHash: "low1", timestamp: 1_779_220_000_000 })
    ]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentUserMessages[0]).toContain("<b>Medium risk</b>");
    expect(ctx.sentUserMessages[0]).toContain("<code>40/100</code>");
    expect(ctx.sentMarks).toEqual(["high1"]);
    expect(ctx.skippedMarks).toEqual(["low1"]);
  });

  it("sends one digest summary for due digest transactions", async () => {
    const digestWallet: WatchedWallet = { ...watchedWallet, alertMode: "digest", digestIntervalMinutes: 10 };
    const ctx = createDeps({
      wallets: [digestWallet],
      claimDigestTransactions: async () => [
        {
          ...observedAlert({ txHash: "low1", status: "skipped" }),
          riskLevel: "LOW",
          riskScore: 0,
          riskReasons: [],
          digestSentAt: null
        },
        {
          ...observedAlert({ txHash: "high1", status: "sent" }),
          sender: "TRisky111111111111111111111111111111",
          amount: "81240",
          riskLevel: "HIGH",
          riskScore: 70,
          riskReasons: [{ code: "high", message: "High risk", scoreImpact: 70 }],
          digestSentAt: null
        }
      ]
    });

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentDigestMessages).toHaveLength(1);
    expect(ctx.sentDigestMessages[0]).toContain("<b>Incoming</b>: <code>2 tx</code>");
    expect(ctx.sentDigestMessages[0]).toContain("<b>Total</b>: <code>81 241 USDT</code>");
    expect(ctx.sentDigestMessages[0]).toContain("<b>Risky</b>: <code>1 tx / 1 sender</code>");
    expect(ctx.sentDigestMessages[0]).toContain("High-risk tx were alerted immediately");
    expect(ctx.sentDigestAlertOptions[0]?.parse_mode).toBe("HTML");
    expect(ctx.digestMarks).toEqual([["low1", "high1"]]);
  });

  it("records successful poll event and new-transfer counts while clearing previous errors", async () => {
    const claimed: string[] = [];
    const ctx = createDeps({
      claimObservedTransactionForUserAlert: async ({ event }) => {
        if (event.txHash === "duplicate") return false;
        claimed.push(event.txHash);
        return true;
      }
    });
    ctx.pages.set(0, [
      rawTransfer({ txHash: "duplicate", timestamp: 1_779_220_000_000 }),
      rawTransfer({ txHash: "new1", timestamp: 1_779_220_010_000 })
    ]);

    await runSinglePollingCycle(ctx.deps);

    expect(claimed).toEqual(["new1"]);
    expect(ctx.updatedInputs.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastPollEventCount: 2,
      lastPollNewCount: 1,
      lastPollError: null
    });
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

  it("persists risk observations for internally labeled incoming senders before delivery", async () => {
    const sender = "TSenderRisk111111111111111111111111111";
    const ctx = createDeps({
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [
        {
          address: sender,
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "9001",
          createdAt: new Date("2026-05-21T00:00:00.000Z")
        }
      ]
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", sender, timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.riskEvaluations[0].observations[0]).toMatchObject({
      subjectAddress: sender,
      observedTransactionHash: "tx1",
      signalGroup: "internal_label",
      code: "internal_label_scam",
      scoreImpact: 90
    });
    expect(ctx.riskEvaluations[0].rawEvidence[0]).toMatchObject({
      sourceType: "internal_label",
      address: sender,
      observedTransactionHash: "tx1"
    });
    expect(ctx.order.slice(0, 3)).toEqual(["risk_evidence", "user_alert", "sent:tx1"]);
  });

  it("marks alert failed and does not deliver when risk evidence persistence fails", async () => {
    const ctx = createDeps({
      recordRiskEvaluation: async () => {
        throw new Error("evidence db down");
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
    expect(ctx.failedMarks).toEqual([{ txHash: "tx1", error: "evidence db down" }]);
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

  it("does not send sender-only retry alerts when no retry rows are claimed", async () => {
    let retryClaims = 0;
    const ctx = createDeps({
      claimUserAlertsForRetry: async () => {
        retryClaims += 1;
        return [];
      }
    });

    await runSinglePollingCycle(ctx.deps);

    expect(retryClaims).toBe(1);
    expect(ctx.sentUserMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
    expect(ctx.failedMarks).toEqual([]);
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

  it("sends LOW customer copies only to all-mode alert recipients", async () => {
    const ctx = createDeps({
      listCustomerAlertRecipients: async () => [
        {
          ownerTelegramUserId: watchedWallet.telegramUserId,
          recipientTelegramUserId: "777",
          alertMode: "all",
          createdAt: new Date("2026-05-22T00:00:00.000Z"),
          updatedAt: new Date("2026-05-22T00:00:00.000Z")
        },
        {
          ownerTelegramUserId: watchedWallet.telegramUserId,
          recipientTelegramUserId: "888",
          alertMode: "suspicious_only",
          createdAt: new Date("2026-05-22T00:00:00.000Z"),
          updatedAt: new Date("2026-05-22T00:00:00.000Z")
        }
      ]
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentCustomerMessages.map((message) => message.telegramUserId)).toEqual(["777"]);
    expect(ctx.sentCustomerMessages[0].message).toContain("<b>Low risk</b>");
    expect(ctx.sentCustomerMessages[0].message).toContain("<code>0/100</code>");
    expect(ctx.sentCustomerAlertOptions[0]?.reply_markup).toBeTruthy();
    expect(ctx.sentCustomerAlertOptions[0]?.parse_mode).toBe("HTML");
    expect(ctx.sentAdminMessages).toEqual([]);
  });

  it("sends MEDIUM customer copies to suspicious-only and all-mode alert recipients without service admin alerts", async () => {
    const ctx = createDeps({
      listCustomerAlertRecipients: async () => [
        {
          ownerTelegramUserId: watchedWallet.telegramUserId,
          recipientTelegramUserId: "777",
          alertMode: "all",
          createdAt: new Date("2026-05-22T00:00:00.000Z"),
          updatedAt: new Date("2026-05-22T00:00:00.000Z")
        },
        {
          ownerTelegramUserId: watchedWallet.telegramUserId,
          recipientTelegramUserId: "888",
          alertMode: "suspicious_only",
          createdAt: new Date("2026-05-22T00:00:00.000Z"),
          updatedAt: new Date("2026-05-22T00:00:00.000Z")
        }
      ],
      getRiskSignalsForAddress: async () => ({
        graphSignals: [
          {
            code: "forensic_extended_provenance",
            message: "Route-linked risk",
            scoreImpact: 45,
            source: "forensic_route_search"
          }
        ],
        behaviorSignals: [],
        amlSignals: []
      })
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentCustomerMessages.map((message) => message.telegramUserId)).toEqual(["777", "888"]);
    expect(ctx.sentCustomerMessages[0].message).toContain("<b>Medium risk</b>");
    expect(ctx.sentCustomerMessages[0].message).toContain("<code>40/100</code>");
    expect(ctx.sentAdminMessages).toEqual([]);
  });

  it("keeps customer alert failures non-blocking for owner alert status", async () => {
    const loggedErrors: string[] = [];
    const ctx = createDeps({
      listCustomerAlertRecipients: async () => [
        {
          ownerTelegramUserId: watchedWallet.telegramUserId,
          recipientTelegramUserId: "777",
          alertMode: "all",
          createdAt: new Date("2026-05-22T00:00:00.000Z"),
          updatedAt: new Date("2026-05-22T00:00:00.000Z")
        }
      ],
      sendCustomerAdminAlert: async () => {
        throw new Error("recipient has not started bot");
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (message) => {
          loggedErrors.push(message);
        }
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual(["tx1"]);
    expect(ctx.failedMarks).toEqual([]);
    expect(loggedErrors).toContain("customer_admin_alert_delivery_failed");
  });

  it("keeps customer recipient lookup failures from blocking service admin alerts", async () => {
    const sentAdminMessages: string[] = [];
    const loggedErrors: string[] = [];
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
      listCustomerAlertRecipients: async () => {
        throw new Error("recipient db down");
      },
      sendAdminAlert: async (message) => {
        sentAdminMessages.push(message);
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (message) => {
          loggedErrors.push(message);
        }
      }
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual(["tx1"]);
    expect(sentAdminMessages).toHaveLength(1);
    expect(loggedErrors).toContain("customer_alert_recipient_lookup_failed");
    expect(ctx.updatedInputs.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastPollError: null
    });
  });

  it("records wallet-level polling failures and continues polling later wallets", async () => {
    const secondWallet: WatchedWallet = {
      ...watchedWallet,
      id: "wallet-2",
      address: "TReceiver22222222222222222222222222222"
    };
    const loggedErrors: string[] = [];
    const ctx = createDeps({
      wallets: [watchedWallet, secondWallet],
      tronClient: {
        async listIncomingTrc20Transfers(address) {
          if (address === watchedWallet.address) throw new Error("tronscan unavailable");
          return [];
        },
        async getTransaction() {
          return {};
        }
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (message) => {
          loggedErrors.push(message);
        }
      }
    });

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.updatedInputs[0]).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastPollError: "tronscan unavailable"
    });
    expect(ctx.updatedInputs[0]).not.toHaveProperty("lastSeenTxHash");
    expect(ctx.updatedInputs[0]).not.toHaveProperty("lastSeenBlockTs");
    expect(ctx.updatedInputs.at(-1)).toMatchObject({
      watchedWalletId: secondWallet.id,
      lastPollEventCount: 0,
      lastPollNewCount: 0,
      lastPollError: null
    });
    expect(loggedErrors).toContain("wallet_poll_failed");
  });
});
