import { describe, expect, it } from "vitest";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const USER_ID = "42001";
const WALLET_ID = "wallet-navigation-1";
const WALLET_ADDRESS = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
const OFFICIAL_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

type Snapshot = {
  watchedWalletId: string;
  trxBalanceSun: string;
  usdtBalanceMicro: string;
  walletCreatedAt: Date | null;
  totalTxCount: string | null;
  incomingTxCount: string | null;
  outgoingTxCount: string | null;
  thirtyDayInUsdt: string;
  thirtyDayOutUsdt: string;
  thirtyDayTransferCount: number;
  thirtyDayFeeSun: string;
  trxUsdPrice: string | null;
  analyticsPartial: boolean;
  refreshedAt: Date;
  lastError: string | null;
};

type TelegramCall = { method: string; payload: Record<string, unknown> };

function dashboardSnapshot(refreshedAt: Date): Snapshot {
  return {
    watchedWalletId: WALLET_ID,
    trxBalanceSun: "5000000",
    usdtBalanceMicro: "125000000",
    walletCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    totalTxCount: "12",
    incomingTxCount: "7",
    outgoingTxCount: "5",
    thirtyDayInUsdt: "250",
    thirtyDayOutUsdt: "100",
    thirtyDayTransferCount: 8,
    thirtyDayFeeSun: "3000000",
    trxUsdPrice: "0.25",
    analyticsPartial: false,
    refreshedAt,
    lastError: null
  };
}

function snapshotRow(snapshot: Snapshot): Record<string, unknown> {
  return {
    watched_wallet_id: snapshot.watchedWalletId,
    trx_balance_sun: snapshot.trxBalanceSun,
    usdt_balance_micro: snapshot.usdtBalanceMicro,
    wallet_created_at: snapshot.walletCreatedAt,
    total_tx_count: snapshot.totalTxCount,
    incoming_tx_count: snapshot.incomingTxCount,
    outgoing_tx_count: snapshot.outgoingTxCount,
    thirty_day_in_usdt: snapshot.thirtyDayInUsdt,
    thirty_day_out_usdt: snapshot.thirtyDayOutUsdt,
    thirty_day_transfer_count: snapshot.thirtyDayTransferCount,
    thirty_day_fee_sun: snapshot.thirtyDayFeeSun,
    trx_usd_price: snapshot.trxUsdPrice,
    analytics_partial: snapshot.analyticsPartial,
    refreshed_at: snapshot.refreshedAt,
    last_error: snapshot.lastError
  };
}

function createDashboardDb(initialSnapshot: Snapshot | null) {
  let cached = initialSnapshot;
  return {
    get snapshot() {
      return cached;
    },
    set snapshot(value: Snapshot | null) {
      cached = value;
    },
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("insert into telegram_users")) return { rows: [], rowCount: 1 };
      if (sql.includes("select locale") && sql.includes("from telegram_users")) {
        return { rows: [{ locale: "en" }], rowCount: 1 };
      }
      if (sql.includes("update telegram_user_sessions")) return { rows: [], rowCount: 0 };
      if (sql.includes("from watched_wallets")) {
        return {
          rows: [{
            id: WALLET_ID,
            telegram_user_id: USER_ID,
            username: "runtime_acceptance",
            address: WALLET_ADDRESS,
            created_at: new Date("2026-01-01T00:00:00.000Z"),
            alert_mode: "realtime",
            digest_interval_minutes: 10
          }],
          rowCount: 1
        };
      }
      if (sql.includes("from wallet_dashboard_snapshots")) {
        return { rows: cached ? [snapshotRow(cached)] : [], rowCount: cached ? 1 : 0 };
      }
      if (sql.includes("insert into wallet_dashboard_snapshots")) {
        cached = {
          watchedWalletId: String(params[0]),
          trxBalanceSun: String(params[1]),
          usdtBalanceMicro: String(params[2]),
          walletCreatedAt: params[3] as Date | null,
          totalTxCount: params[4] === null ? null : String(params[4]),
          incomingTxCount: params[5] === null ? null : String(params[5]),
          outgoingTxCount: params[6] === null ? null : String(params[6]),
          thirtyDayInUsdt: String(params[7]),
          thirtyDayOutUsdt: String(params[8]),
          thirtyDayTransferCount: Number(params[9]),
          thirtyDayFeeSun: String(params[10]),
          trxUsdPrice: params[11] === null ? null : String(params[11]),
          analyticsPartial: Boolean(params[12]),
          refreshedAt: params[13] as Date,
          lastError: params[14] === null ? null : String(params[14])
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("from wallet_poll_state")) return { rows: [], rowCount: 0 };
      if (sql.includes("from wallet_approvals")) return { rows: [], rowCount: 0 };
      if (sql.includes("count(*)") && sql.includes("from observed_approval_drain_events")) {
        return { rows: [{ total_count: 0, high_risk_count: 0 }], rowCount: 1 };
      }
      if (sql.includes("from observed_approval_drain_events")) return { rows: [], rowCount: 0 };
      if (sql.includes("from address_labels")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected wallet-navigation query: ${sql}`);
    }
  };
}

function createConfig(): Record<string, unknown> {
  return {
    botToken: "123456:runtime-navigation-test",
    tronscanPageLimit: 100,
    tronscanDashboardCacheTtlMs: 300_000,
    tronscanDashboardMaxPages: 2,
    tronscanDashboardForceRefreshCooldownMs: 0,
    serviceAdminTelegramIds: new Set<string>(),
    botBetaRiskDiagnosticsEnabled: false,
    crossChainStage2Enabled: false,
    runtimeInstanceLabel: "plan3-runtime-acceptance",
    theftReportDepositAddress: OFFICIAL_USDT,
    theftReportDepositAmountUsdt: "1000"
  };
}

function accountFixture() {
  return {
    balance: "9000000",
    date_created: String(Date.parse("2026-01-01T00:00:00.000Z")),
    totalTransactionCount: "13",
    transactions_in: "8",
    transactions_out: "5",
    trc20token_balances: [{ tokenId: OFFICIAL_USDT, balance: "130000000", tokenPriceInTrx: "4" }]
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function callbackUpdate(data: string, updateId: number) {
  return {
    update_id: updateId,
    callback_query: {
      id: `runtime-callback-${updateId}`,
      from: { id: Number(USER_ID), is_bot: false, first_name: "Runtime" },
      message: {
        message_id: 10,
        date: 1_784_112_000,
        chat: { id: Number(USER_ID), type: "private" as const, first_name: "Runtime" },
        text: "wallet"
      },
      chat_instance: "runtime-navigation",
      data
    }
  };
}

async function loadBotFactory() {
  const modulePath: string = "../../src/bot/createBot";
  const module = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  if (typeof module.createBot !== "function") throw new Error("Plan 3 feature missing: createBot");
  return module.createBot as (config: never, db: never, client: never, options: never) => any;
}

async function createRuntimeBot(input: {
  db: ReturnType<typeof createDashboardDb>;
  getAccount: () => Promise<unknown>;
}) {
  const createBot = await loadBotFactory();
  let providerCalls = 0;
  const client = {
    async getAccount() {
      providerCalls += 1;
      return input.getAccount();
    },
    async listRelatedTrc20Transfers() {
      return [];
    },
    async listTransactions() {
      return [];
    },
    async listIncomingTrc20Transfers() {
      return [];
    },
    async getTransaction() {
      return {};
    }
  };
  const bot = createBot(createConfig() as never, input.db as never, client as never, {
    getAddressRiskSignalsForAddress: async () => ({ graphSignals: [], behaviorSignals: [], amlSignals: [] })
  } as never);
  const calls: TelegramCall[] = [];
  bot.api.config.use(async (_previous: unknown, method: string, payload: Record<string, unknown>) => {
    if (method === "getMe") {
      return { ok: true, result: { id: 123456, is_bot: true, first_name: "Runtime", username: "runtime_bot" } };
    }
    calls.push({ method, payload });
    return { ok: true, result: true };
  });
  await bot.init();
  return { bot, calls, providerCalls: () => providerCalls };
}

function renderedText(calls: TelegramCall[]): string {
  return calls
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String(call.payload.text ?? ""))
    .join("\n");
}

async function settlesThisTurn(promises: Promise<unknown>[]): Promise<boolean> {
  return Promise.race([
    Promise.all(promises).then(() => true),
    new Promise<false>((resolve) => setImmediate(() => resolve(false)))
  ]);
}

describe("Plan 3 wallet navigation acceptance", () => {
  it("[AC-17] keeps normal navigation cache-only and refresh explicit", async () => {
    const db = createDashboardDb(dashboardSnapshot(new Date("2099-01-01T00:00:00.000Z")));
    const runtime = await createRuntimeBot({ db, getAccount: async () => accountFixture() });
    const normalCallbacks = ["wl:view", "wl:analytics", "wl:risk", "wl:safety"];

    for (const [index, prefix] of normalCallbacks.entries()) {
      await runtime.bot.handleUpdate(callbackUpdate(`${prefix}:${WALLET_ID}`, 100 + index));
    }
    expect(runtime.providerCalls()).toBe(0);

    db.snapshot = dashboardSnapshot(new Date(NOW.getTime() - 3_600_000));
    await runtime.bot.handleUpdate(callbackUpdate(`wl:refresh:${WALLET_ID}`, 200));
    expect(runtime.providerCalls()).toBe(1);
    expect(renderedText(runtime.calls)).toMatch(/loading|refreshing/i);
  });

  it("[REQ-37][CACHE-MISS] shows loading and deduplicates first-load refresh", async () => {
    const account = createDeferred<unknown>();
    const db = createDashboardDb(null);
    const runtime = await createRuntimeBot({ db, getAccount: () => account.promise });
    const updates = [
      runtime.bot.handleUpdate(callbackUpdate(`wl:view:${WALLET_ID}`, 300)),
      runtime.bot.handleUpdate(callbackUpdate(`wl:analytics:${WALLET_ID}`, 301))
    ];

    try {
      expect(await settlesThisTurn(updates)).toBe(true);
      expect(runtime.providerCalls()).toBe(1);
      expect(renderedText(runtime.calls)).toMatch(/loading/i);
    } finally {
      account.resolve(accountFixture());
      await Promise.allSettled(updates);
      await new Promise((resolve) => setImmediate(resolve));
    }
  });

  it("[REQ-37][CACHE-STALE] serves stale cache without a provider call", async () => {
    const db = createDashboardDb(dashboardSnapshot(new Date(NOW.getTime() - 86_400_000)));
    const runtime = await createRuntimeBot({
      db,
      getAccount: async () => {
        throw new Error("normal navigation must not call the provider");
      }
    });

    for (const [index, prefix] of ["wl:view", "wl:analytics", "wl:risk", "wl:safety"].entries()) {
      await runtime.bot.handleUpdate(callbackUpdate(`${prefix}:${WALLET_ID}`, 400 + index));
    }

    expect(runtime.providerCalls()).toBe(0);
    expect(renderedText(runtime.calls)).toContain("125");
  });
});
