import { describe, expect, it } from "vitest";
import { runSinglePollingCycle } from "../../src/monitor/monitorWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel, RawEvidenceInput, RiskSignalObservationInput, TronTransferEvent, WatchedWallet } from "../../src/types";
import type { ObservedTransactionUserAlert, UserAlertStatus, WalletPollState } from "../../src/storage/repositories";

const watchedWallet: WatchedWallet = {
  id: "wallet-1",
  telegramUserId: "123",
  telegramUsername: "client_user",
  address: "TReceiver11111111111111111111111111111",
  createdAt: new Date("2026-05-20T00:00:00.000Z"),
  alertMode: "realtime",
  digestIntervalMinutes: 10
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
  const sentUserAlertOptions: Array<{ reply_markup?: unknown; parse_mode?: "HTML" } | undefined> = [];
  const sentCustomerMessages: Array<{ telegramUserId: string; message: string }> = [];
  const sentCustomerAlertOptions: Array<{ reply_markup?: unknown; parse_mode?: "HTML" } | undefined> = [];
  const sentAdminMessages: string[] = [];
  const sentDigestMessages: string[] = [];
  const sentDigestAlertOptions: Array<{ parse_mode?: "HTML" } | undefined> = [];
  const claimed: string[] = [];
  const sentMarks: string[] = [];
  const skippedMarks: string[] = [];
  const digestMarks: string[][] = [];
  const failedMarks: Array<{ txHash: string; error: string }> = [];
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
    claimObservedTransactionForUserAlert: async ({ event }) => {
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
    markUserAlertSkipped: async ({ txHash }) => {
      order.push(`skipped:${txHash}`);
      skippedMarks.push(txHash);
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
    sentMarks,
    skippedMarks,
    digestMarks,
    failedMarks,
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
        graphSignals: [],
        behaviorSignals: [{ code: "medium", message: "Medium risk", scoreImpact: 35, source: "test" }],
        amlSignals: []
      })
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "medium1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentUserMessages).toHaveLength(1);
    expect(ctx.sentUserMessages[0]).toContain("<b>Medium risk</b>");
    expect(ctx.sentUserMessages[0]).toContain("<code>35/100</code>");
    expect(ctx.sentMarks).toEqual(["medium1"]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("digest mode queues LOW events but sends risky events immediately", async () => {
    const digestWallet: WatchedWallet = { ...watchedWallet, alertMode: "digest", digestIntervalMinutes: 10 };
    const ctx = createDeps({
      wallets: [digestWallet],
      getRiskSignalsForAddress: async (_address, event) => ({
        graphSignals: [],
        behaviorSignals: event.txHash === "high1" ? [{ code: "high", message: "High risk", scoreImpact: 70, source: "test" }] : [],
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
    expect(ctx.sentUserMessages[0]).toContain("<code>50/100</code>");
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
        graphSignals: [],
        behaviorSignals: [
          {
            code: "behavior_medium",
            message: "Medium-risk activity pattern",
            scoreImpact: 35,
            source: "behavior"
          }
        ],
        amlSignals: []
      })
    });
    ctx.pages.set(0, [rawTransfer({ txHash: "tx1", timestamp: 1_779_220_000_000 })]);

    await runSinglePollingCycle(ctx.deps);

    expect(ctx.sentCustomerMessages.map((message) => message.telegramUserId)).toEqual(["777", "888"]);
    expect(ctx.sentCustomerMessages[0].message).toContain("<b>Medium risk</b>");
    expect(ctx.sentCustomerMessages[0].message).toContain("<code>35/100</code>");
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
