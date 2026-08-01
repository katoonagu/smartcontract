import { describe, expect, it } from "vitest";

const USER_ID = "42002";
const ADDRESS = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
const SENDER = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
const TX_HASH = "a".repeat(64);
const OFFICIAL_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

type TelegramCall = { method: string; payload: Record<string, unknown> };
type PendingAction = "check_address" | "check_tx" | null;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createConfig(): Record<string, unknown> {
  return {
    botToken: "123456:runtime-check-test",
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

function sessionRow(pendingAction: PendingAction): Record<string, unknown> {
  return {
    telegram_user_id: USER_ID,
    pending_action: pendingAction,
    selected_wallet_id: null,
    selected_theft_report_id: null,
    updated_at: new Date("2026-07-15T12:00:00.000Z")
  };
}

function createCheckDb(input: {
  beforeUserWrite?: () => void;
  userWrite?: Promise<void>;
} = {}) {
  let pendingAction: PendingAction = null;
  return {
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("insert into telegram_users")) {
        input.beforeUserWrite?.();
        await input.userWrite;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("select locale") && sql.includes("from telegram_users")) {
        return { rows: [{ locale: "en" }], rowCount: 1 };
      }
      if (sql.includes("insert into telegram_user_sessions")) {
        pendingAction = params[1] as PendingAction;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("update telegram_user_sessions")) {
        pendingAction = null;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("from telegram_user_sessions")) {
        return { rows: pendingAction ? [sessionRow(pendingAction)] : [], rowCount: pendingAction ? 1 : 0 };
      }
      if (sql.includes("from address_labels")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected check-callback query: ${sql}`);
    }
  };
}

function transactionFixture() {
  return {
    trc20TransferInfo: [{
      from_address: SENDER,
      to_address: ADDRESS,
      quant: "1000000",
      contract_address: OFFICIAL_USDT,
      confirmed: true,
      contractRet: "SUCCESS",
      block_ts: Date.parse("2026-07-15T11:55:00.000Z")
    }]
  };
}

function emptyRiskSignals() {
  return {
    graphSignals: [],
    behaviorSignals: [],
    amlSignals: [],
    rawEvidence: [],
    observations: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    stablecoinRestrictionProfiles: [],
    missingChecks: []
  };
}

let nextUpdateId = 1_000;

function messageUpdate(text: string) {
  const updateId = nextUpdateId++;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_784_112_000,
      chat: { id: Number(USER_ID), type: "private" as const, first_name: "Runtime" },
      from: { id: Number(USER_ID), is_bot: false, first_name: "Runtime" },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command" as const, offset: 0, length: text.split(/\s+/, 1)[0].length }]
        : undefined
    }
  };
}

function callbackUpdate(data: string) {
  const updateId = nextUpdateId++;
  return {
    update_id: updateId,
    callback_query: {
      id: `runtime-check-${updateId}`,
      from: { id: Number(USER_ID), is_bot: false, first_name: "Runtime" },
      message: {
        message_id: updateId,
        date: 1_784_112_000,
        chat: { id: Number(USER_ID), type: "private" as const, first_name: "Runtime" },
        text: "check"
      },
      chat_instance: "runtime-checks",
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
  db?: ReturnType<typeof createCheckDb>;
  addressRiskSignals?: () => Promise<Record<string, unknown>>;
  getTransaction?: () => Promise<unknown>;
  onTelegramCall?: (method: string) => void;
} = {}) {
  const createBot = await loadBotFactory();
  const db = input.db ?? createCheckDb();
  const client = {
    getTransaction: input.getTransaction ?? (async () => transactionFixture()),
    async listIncomingTrc20Transfers() { return []; },
    async getAccount() { return {}; },
    async listRelatedTrc20Transfers() { return []; },
    async listTransactions() { return []; }
  };
  const bot = createBot(createConfig() as never, db as never, client as never, {
    getAddressRiskSignalsForAddress: input.addressRiskSignals ?? (async () => emptyRiskSignals()),
    queueWhereIsMoneyJob: async () => null,
    queueDeepForensicJob: async () => null,
    saveAddressFastCheckJob: async () => null
  } as never);
  const calls: TelegramCall[] = [];
  bot.api.config.use(async (_previous: unknown, method: string, payload: Record<string, unknown>) => {
    if (method === "getMe") {
      return { ok: true, result: { id: 123456, is_bot: true, first_name: "Runtime", username: "runtime_bot" } };
    }
    input.onTelegramCall?.(method);
    calls.push({ method, payload });
    return { ok: true, result: true };
  });
  await bot.init();
  return { bot, calls };
}

function renderedText(calls: TelegramCall[]): string {
  return calls
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String(call.payload.text ?? "").replace(/<[^>]+>/g, ""))
    .join("\n");
}

async function settlesThisTurn(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => false),
    new Promise<false>((resolve) => setImmediate(() => resolve(false)))
  ]);
}

async function flushTurns(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("Plan 3 check callback acceptance", () => {
  it("[AC-18] returns check callbacks before slow work completes", async () => {
    const scenarios = [
      { name: "/check address", setup: null, update: messageUpdate(`/check ${ADDRESS}`), slow: "address" },
      { name: "direct address callback", setup: null, update: callbackUpdate(`check:addr:${ADDRESS}`), slow: "address" },
      { name: "pending address", setup: callbackUpdate("check:addr"), update: messageUpdate(ADDRESS), slow: "address" },
      { name: "pending tx", setup: callbackUpdate("check:tx"), update: messageUpdate(TX_HASH), slow: "tx" },
      { name: "direct tx text", setup: null, update: messageUpdate(TX_HASH), slow: "tx" }
    ] as const;

    for (const scenario of scenarios) {
      const slow = createDeferred<any>();
      const runtime = await createRuntimeBot({
        addressRiskSignals: scenario.slow === "address" ? () => slow.promise : undefined,
        getTransaction: scenario.slow === "tx" ? () => slow.promise : undefined
      });
      if (scenario.setup) await runtime.bot.handleUpdate(scenario.setup);
      const update = runtime.bot.handleUpdate(scenario.update);

      try {
        expect(await settlesThisTurn(update), scenario.name).toBe(true);
        expect(renderedText(runtime.calls), scenario.name).toMatch(/check started/i);
      } finally {
        slow.resolve(scenario.slow === "address" ? emptyRiskSignals() : transactionFixture());
        await Promise.allSettled([update]);
        await flushTurns();
      }
    }
  });

  it("[REQ-37][CALLBACK-ACK] acknowledges non-poison callbacks before database work", async () => {
    const userWrite = createDeferred<void>();
    const events: string[] = [];
    const db = createCheckDb({
      beforeUserWrite: () => events.push("database"),
      userWrite: userWrite.promise
    });
    const runtime = await createRuntimeBot({
      db,
      onTelegramCall: (method) => {
        if (method === "answerCallbackQuery") events.push("ack");
      }
    });
    const update = runtime.bot.handleUpdate(callbackUpdate("check:addr"));

    try {
      await flushTurns(1);
      expect(events).toEqual(["ack", "database"]);
      expect(runtime.calls[0]?.method).toBe("answerCallbackQuery");
    } finally {
      userWrite.resolve();
      await Promise.allSettled([update]);
    }
    await expect(update).resolves.toBeUndefined();
  });

  it("[REQ-37][CHECK-ERROR] handles detached check rejection without an unhandled promise", async () => {
    const slow = createDeferred<Record<string, unknown>>();
    const runtime = await createRuntimeBot({ addressRiskSignals: () => slow.promise });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    const update = runtime.bot.handleUpdate(messageUpdate(`/check ${ADDRESS}`));

    try {
      const returnedEarly = await settlesThisTurn(update);
      slow.reject(new Error("provider-secret-payload-must-not-leak"));
      const outcome = await Promise.allSettled([update]);
      await flushTurns(5);

      expect(returnedEarly).toBe(true);
      expect(outcome[0]?.status).toBe("fulfilled");
      expect(unhandled).toEqual([]);
      expect(renderedText(runtime.calls)).toContain("Check did not finish");
      expect(renderedText(runtime.calls)).not.toContain("provider-secret-payload-must-not-leak");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
