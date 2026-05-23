import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config";
import { createBot } from "../../src/bot/createBot";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { Db } from "../../src/storage/db";
import type { RiskLabel, WalletAlertMode } from "../../src/types";
import type { CustomerAlertRecipient, TelegramUserPendingAction, WalletDashboardSnapshot } from "../../src/storage/repositories";
import type { TronDashboardClient } from "../../src/tron/tronClient";

const walletAddress = `T${"1".repeat(33)}`;
const secondWalletAddress = `T${"2".repeat(33)}`;
const txHash = "a".repeat(64);
const adminId = "9001";
const userId = "42";

type ReplyCall = {
  method: string;
  payload: Record<string, any>;
};

type FakeWallet = {
  id: string;
  telegramUserId: string;
  address: string;
  createdAt: Date;
  alertMode: WalletAlertMode;
  digestIntervalMinutes: number;
};

type FakeSession = {
  telegramUserId: string;
  pendingAction: TelegramUserPendingAction | null;
  selectedWalletId: string | null;
  updatedAt: Date;
};

function createConfig(): AppConfig {
  return {
    botToken: "123456:test-token",
    databaseUrl: "postgres://unused",
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com"),
    tronFullNodeBaseUrl: new URL("https://api.trongrid.io"),
    tronscanApiKey: undefined,
    tronFullNodeApiKey: undefined,
    tronscanPageLimit: 50,
    tronscanMaxPagesPerWallet: 5,
    tronscanTimeoutMs: 10000,
    tronscanRetryAttempts: 3,
    tronscanRetryBaseDelayMs: 500,
    tronscanBackfillLookbackMs: 86_400_000,
    tronscanRequestMinIntervalMs: 250,
    tronscanRateLimitCooldownMs: 30_000,
    tronscanDashboardCacheTtlMs: 300_000,
    tronscanDashboardMaxPages: 5,
    tronscanDashboardForceRefreshCooldownMs: 60_000,
    pollIntervalMs: 60_000,
    serviceAdminTelegramIds: new Set([adminId])
  };
}

function createFakeDb(): Db {
  const wallets: FakeWallet[] = [];
  const labels: Array<{ address: string; label: RiskLabel; source: "service_admin"; createdByTelegramId: string; createdAt: Date }> = [];
  const sessions = new Map<string, FakeSession>();
  const snapshots = new Map<string, WalletDashboardSnapshot>();
  const alertRecipients: CustomerAlertRecipient[] = [];

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
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("insert into telegram_user_sessions")) {
        const session: FakeSession = {
          telegramUserId: String(params[0]),
          pendingAction: params[1] as TelegramUserPendingAction,
          selectedWalletId: params[2] === null || params[2] === undefined ? null : String(params[2]),
          updatedAt: new Date("2026-05-20T00:00:00.000Z")
        };
        sessions.set(session.telegramUserId, session);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("update telegram_user_sessions")) {
        const telegramUserId = String(params[0]);
        const existing = sessions.get(telegramUserId);
        if (!existing) return { rows: [], rowCount: 0 };
        sessions.set(telegramUserId, {
          ...existing,
          pendingAction: null,
          selectedWalletId: null,
          updatedAt: new Date("2026-05-20T00:01:00.000Z")
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from telegram_user_sessions")) {
        const session = sessions.get(String(params[0]));
        return {
          rows: session
            ? [
                {
                  telegram_user_id: session.telegramUserId,
                  pending_action: session.pendingAction,
                  selected_wallet_id: session.selectedWalletId,
                  updated_at: session.updatedAt
                }
              ]
            : [],
          rowCount: session ? 1 : 0
        };
      }

      if (sql.includes("insert into watched_wallets")) {
        const wallet = {
          id: String(params[0]),
          telegramUserId: String(params[1]),
          address: String(params[2]),
          createdAt: new Date("2026-05-20T00:00:00.000Z"),
          alertMode: "realtime" as const,
          digestIntervalMinutes: 10
        };
        const existing = wallets.find((item) => item.telegramUserId === wallet.telegramUserId && item.address === wallet.address);
        if (!existing) wallets.push(wallet);
        return {
          rows: [
            {
              id: existing?.id ?? wallet.id,
              telegram_user_id: wallet.telegramUserId,
              address: wallet.address,
              created_at: existing?.createdAt ?? wallet.createdAt,
              alert_mode: existing?.alertMode ?? wallet.alertMode,
              digest_interval_minutes: existing?.digestIntervalMinutes ?? wallet.digestIntervalMinutes
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("update watched_wallets")) {
        const telegramUserId = String(params[0]);
        const address = String(params[1]);
        const alertMode = params[2] as WalletAlertMode;
        const digestIntervalMinutes = Number(params[3]);
        const wallet = wallets.find((item) => item.telegramUserId === telegramUserId && item.address === address);
        if (!wallet) return { rows: [], rowCount: 0 };
        wallet.alertMode = alertMode;
        wallet.digestIntervalMinutes = digestIntervalMinutes;
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("delete from watched_wallets")) {
        const telegramUserId = String(params[0]);
        const address = String(params[1]);
        const before = wallets.length;
        const remaining = wallets.filter((wallet) => wallet.telegramUserId !== telegramUserId || wallet.address !== address);
        wallets.splice(0, wallets.length, ...remaining);
        return { rows: [], rowCount: before - wallets.length };
      }

      if (sql.includes("from watched_wallets")) {
        const telegramUserId = params[0] ? String(params[0]) : undefined;
        const rows = wallets
          .filter((wallet) => !telegramUserId || wallet.telegramUserId === telegramUserId)
          .map((wallet) => ({
            id: wallet.id,
            telegram_user_id: wallet.telegramUserId,
            username: "tester",
            address: wallet.address,
            created_at: wallet.createdAt,
            alert_mode: wallet.alertMode,
            digest_interval_minutes: wallet.digestIntervalMinutes
          }));
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("from wallet_poll_state")) {
        return {
          rows: [
            {
              watched_wallet_id: String(params[0]),
              last_seen_block_ts: new Date("2026-05-20T00:00:00.000Z"),
              last_seen_tx_hash: "tx_seen",
              backfill_anchor_block_ts: null,
              backfill_anchor_tx_hash: null,
              backfill_next_start: 0,
              backfill_complete: true,
              last_successful_poll_at: new Date("2026-05-21T00:00:00.000Z"),
              last_poll_event_count: 1,
              last_poll_new_count: 0,
              last_poll_error: null,
              updated_at: new Date("2026-05-21T00:00:00.000Z")
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into wallet_dashboard_snapshots")) {
        const snapshot: WalletDashboardSnapshot = {
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
        snapshots.set(snapshot.watchedWalletId, snapshot);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from wallet_dashboard_snapshots")) {
        const snapshot = snapshots.get(String(params[0]));
        return {
          rows: snapshot
            ? [
                {
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
                }
              ]
            : [],
          rowCount: snapshot ? 1 : 0
        };
      }

      if (sql.includes("from wallet_approvals")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("insert into address_labels")) {
        const label = {
          address: String(params[0]),
          label: params[1] as RiskLabel,
          source: "service_admin" as const,
          createdByTelegramId: String(params[3]),
          createdAt: new Date("2026-05-20T00:00:00.000Z")
        };
        const existing = labels.find((item) => item.address === label.address && item.label === label.label);
        if (existing) {
          existing.createdByTelegramId = label.createdByTelegramId;
        } else {
          labels.push(label);
        }
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from address_labels")) {
        const address = String(params[0]);
        const rows = labels
          .filter((label) => label.address === address)
          .map((label) => ({
            address: label.address,
            label: label.label,
            source: label.source,
            created_by_telegram_id: label.createdByTelegramId,
            created_at: label.createdAt
          }));
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("insert into customer_alert_recipients")) {
        const ownerTelegramUserId = String(params[0]);
        const recipientTelegramUserId = String(params[1]);
        const alertMode = params[2] as CustomerAlertRecipient["alertMode"];
        const existing = alertRecipients.find(
          (recipient) =>
            recipient.ownerTelegramUserId === ownerTelegramUserId && recipient.recipientTelegramUserId === recipientTelegramUserId
        );
        const now = new Date("2026-05-22T00:00:00.000Z");
        if (existing) {
          existing.alertMode = alertMode;
          existing.updatedAt = now;
        } else {
          alertRecipients.push({
            ownerTelegramUserId,
            recipientTelegramUserId,
            alertMode,
            createdAt: now,
            updatedAt: now
          });
        }
        const recipient = existing ?? alertRecipients.at(-1);
        return {
          rows: [
            {
              owner_telegram_user_id: recipient?.ownerTelegramUserId,
              recipient_telegram_user_id: recipient?.recipientTelegramUserId,
              alert_mode: recipient?.alertMode,
              created_at: recipient?.createdAt,
              updated_at: recipient?.updatedAt
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("delete from customer_alert_recipients")) {
        const ownerTelegramUserId = String(params[0]);
        const recipientTelegramUserId = String(params[1]);
        const before = alertRecipients.length;
        const remaining = alertRecipients.filter(
          (recipient) =>
            recipient.ownerTelegramUserId !== ownerTelegramUserId || recipient.recipientTelegramUserId !== recipientTelegramUserId
        );
        alertRecipients.splice(0, alertRecipients.length, ...remaining);
        return { rows: [], rowCount: before - alertRecipients.length };
      }

      if (sql.includes("from customer_alert_recipients")) {
        const ownerTelegramUserId = String(params[0]);
        const rows = alertRecipients
          .filter((recipient) => recipient.ownerTelegramUserId === ownerTelegramUserId)
          .map((recipient) => ({
            owner_telegram_user_id: recipient.ownerTelegramUserId,
            recipient_telegram_user_id: recipient.recipientTelegramUserId,
            alert_mode: recipient.alertMode,
            created_at: recipient.createdAt,
            updated_at: recipient.updatedAt
          }));
        return { rows, rowCount: rows.length };
      }

      throw new Error(`Unexpected query in bot smoke test: ${sql}`);
    }
  } as unknown as Db;
}

function createTronClient(): TronDashboardClient {
  return {
    async getTransaction() {
      return {
        trc20TransferInfo: [
          {
            from_address: secondWalletAddress,
            contract_address: TRON_USDT_CONTRACT_ADDRESS
          }
        ]
      };
    },
    async listIncomingTrc20Transfers() {
      return [];
    },
    async getAccount() {
      return {
        balance: "123456789",
        date_created: "1778457600000",
        transactions_in: "7",
        transactions_out: "5",
        totalTransactionCount: "12",
        trc20token_balances: [
          {
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            balance: "7000000",
            tokenPriceInTrx: "4"
          }
        ]
      };
    },
    async listRelatedTrc20Transfers(address) {
      return [
        {
          transaction_id: "tx_in",
          from_address: secondWalletAddress,
          to_address: address,
          quant: "12500000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          confirmed: true,
          contractRet: "SUCCESS",
          block_ts: 1778457600000
        },
        {
          transaction_id: "tx_out",
          from_address: address,
          to_address: secondWalletAddress,
          quant: "2500000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          confirmed: true,
          contractRet: "SUCCESS",
          block_ts: 1778457700000
        }
      ];
    },
    async listTransactions(address) {
      return [
        {
          ownerAddress: address,
          contractRet: "SUCCESS",
          cost: { fee: "6000000" }
        }
      ];
    }
  };
}

function messageUpdate(text: string, fromId: string | number) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      date: 1_778_880_000,
      chat: { id: Number(fromId), type: "private" as const, first_name: "Tester", username: `user_${fromId}` },
      from: { id: Number(fromId), is_bot: false, first_name: "Tester", username: `user_${fromId}` },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command" as const, offset: 0, length: text.split(/\s+/, 1)[0].length }]
        : undefined
    }
  };
}

function callbackQueryUpdate(data: string, fromId: string | number) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: `callback-${Math.random()}`,
      from: { id: Number(fromId), is_bot: false, first_name: "Tester", username: `user_${fromId}` },
      message: {
        message_id: 10,
        date: 1_778_880_000,
        chat: { id: Number(fromId), type: "private" as const, first_name: "Tester", username: `user_${fromId}` },
        text: "menu"
      },
      chat_instance: "test-chat-instance",
      data
    }
  };
}

function messageCalls(calls: ReplyCall[]): ReplyCall[] {
  return calls.filter((call) => call.method === "sendMessage" || call.method === "editMessageText");
}

function lastText(calls: ReplyCall[]): string {
  return String(messageCalls(calls).at(-1)?.payload.text ?? "");
}

function lastMessagePayload(calls: ReplyCall[]): Record<string, any> {
  return messageCalls(calls).at(-1)?.payload ?? {};
}

function findCallbackData(payload: Record<string, any>, prefix: string): string {
  const rows = payload.reply_markup?.inline_keyboard ?? [];
  for (const row of rows) {
    for (const button of row) {
      if (typeof button.callback_data === "string" && button.callback_data.startsWith(prefix)) {
        return button.callback_data;
      }
    }
  }
  throw new Error(`Callback data with prefix ${prefix} was not found`);
}

function buttonTexts(payload: Record<string, any>): string[] {
  return buttonRows(payload).flat();
}

function buttonRows(payload: Record<string, any>): string[][] {
  return (payload.reply_markup?.inline_keyboard ?? []).map((row: Array<{ text: string }>) => row.map((button) => button.text));
}

async function createSmokeBot(options: { failAnswerCallbackQuery?: boolean } = {}) {
  const bot = createBot(createConfig(), createFakeDb(), createTronClient());
  const calls: ReplyCall[] = [];
  bot.api.config.use(async (_prev, method, payload): Promise<any> => {
    if (method === "getMe") {
      return {
        ok: true,
        result: {
          id: 123456,
          is_bot: true,
          first_name: "Smoke Test Bot",
          username: "smoke_test_bot"
        }
      };
    }
    if (method === "answerCallbackQuery" && options.failAnswerCallbackQuery) {
      throw new Error("Call to 'answerCallbackQuery' failed! (400: Bad Request: query is too old and response timeout expired or query ID is invalid)");
    }
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true };
  });
  await bot.init();
  return { bot, calls };
}

describe("bot command and inline UX smoke coverage", () => {
  it("handles /start with compact bilingual product menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));

    expect(messageCalls(calls)).toHaveLength(1);
    expect(lastText(calls)).toContain("TRON Guard");
    expect(lastText(calls)).toContain("Мониторинг TRON / USDT");
    expect(lastText(calls)).toContain("Watched wallets:");
    expect(lastText(calls)).toContain("Risk checks: limited beta");
    expect(lastMessagePayload(calls).reply_markup?.inline_keyboard).toBeTruthy();
    expect(buttonRows(lastMessagePayload(calls))).toEqual([
      ["📁 My wallets", "➕ Add wallet"],
      ["🔍 Check address", "🧾 Check tx"],
      ["⚠️ Risk intel", "👤 Profile"],
      ["⚙️ Settings", "🆘 Help"]
    ]);
  });

  it("opens help from the inline menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));
    await bot.handleUpdate(callbackQueryUpdate("help", userId));

    expect(lastText(calls)).toContain("🛡 TRON Guard");
    expect(lastText(calls)).toContain("Что умеет бот:");
    expect(lastText(calls)).toContain("Risk score is limited beta");
    expect(lastText(calls)).toContain("No wallet control. No private keys.");
    expect(lastText(calls)).toContain("/profile");
    expect(lastText(calls)).toContain("/my_id");
  });

  it("continues handling stale callback queries after Telegram rejects answerCallbackQuery", async () => {
    const { bot, calls } = await createSmokeBot({ failAnswerCallbackQuery: true });

    await bot.handleUpdate(callbackQueryUpdate("help", userId));

    expect(lastText(calls)).toContain("🛡 TRON Guard");
    expect(lastText(calls)).toContain("Risk score is limited beta");
  });

  it("opens risk intelligence from the main menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("risk:intel", userId));

    expect(lastText(calls)).toContain("⚠️ Risk intelligence");
    expect(lastText(calls)).toContain("Internal labels: active");
    expect(lastText(calls)).toContain("AML providers: not connected");
    expect(lastText(calls)).toContain("Hop1/Hop2 graph: planned");
    expect(lastText(calls)).toContain("Approvals/security: limited");
  });

  it("returns the current user's Telegram ID", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/my_id", userId));

    expect(lastText(calls)).toContain(`Telegram ID: ${userId}`);
    expect(lastText(calls)).toContain("@user_42");
  });

  it("opens profile from command and inline menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/profile", userId));
    expect(lastText(calls)).toContain("👤 Profile");
    expect(lastText(calls)).toContain(`Telegram ID: ${userId}`);
    expect(lastText(calls)).toContain("Language: RU / EN");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("📁 My wallets");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("⚙️ Settings");

    await bot.handleUpdate(callbackQueryUpdate("profile", userId));
    expect(lastText(calls)).toContain("👤 Profile");
  });

  it("shows actionable settings with customer alert admin controls", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/settings", userId));

    expect(lastText(calls)).toContain("⚙️ Settings");
    expect(lastText(calls)).toContain("🔔 Owner alerts: all incoming");
    expect(lastText(calls)).toContain("👥 Alert admins: 0");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("👥 Alert admins");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ Suspicious admin");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ All-alerts admin");
  });

  it("adds a valid wallet, shows dashboard metrics, and lists it", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    const texts = messageCalls(calls).map((call) => String(call.payload.text));
    expect(texts[0]).toContain("📍 Wallet:");
    expect(texts[0]).toContain("🟢 Monitoring: active");
    expect(texts[0]).toContain("Alerts: realtime");
    expect(texts[0]).toContain("Wallet safety: OK");
    expect(texts[0]).toContain("⚠️ Risk:");
    expect(texts[0]).toContain("💵 USDT:");
    expect(texts[0]).toContain("⛽ Gas/fees 30d:");
    expect(texts[0]).not.toContain("tx total");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("🔄 Refresh");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("📊 Analytics");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("⚠️ Risk intel");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("Safety");
    expect(buttonTexts(messageCalls(calls)[0].payload).some((text) => text.includes("Alert mode"))).toBe(true);
    expect(texts[1]).toBe("My wallets: 1");
  });

  it("changes wallet alert mode through dashboard buttons", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const alertModeCallback = findCallbackData(lastMessagePayload(calls), "wl:alerts:");
    const walletId = alertModeCallback.replace("wl:alerts:", "");

    await bot.handleUpdate(callbackQueryUpdate(alertModeCallback, userId));

    expect(lastText(calls)).toContain("Alert mode");
    expect(lastText(calls)).toContain("Current: realtime");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("Digest 10m");
    expect(findCallbackData(lastMessagePayload(calls), `wl:mode:${walletId}:digest:10`)).toBe(
      `wl:mode:${walletId}:digest:10`
    );

    await bot.handleUpdate(callbackQueryUpdate(`wl:mode:${walletId}:digest:10`, userId));

    expect(lastText(calls)).toContain("Alerts: digest 10m");
  });

  it("changes wallet alert mode through /wallet_mode", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));

    await bot.handleUpdate(messageUpdate(`/wallet_mode ${walletAddress} digest 15`, userId));

    expect(lastText(calls)).toContain("Alert mode updated");
    expect(lastText(calls)).toContain("digest 15m");

    await bot.handleUpdate(messageUpdate(`/wallet_mode ${walletAddress} paused`, userId));

    expect(lastText(calls)).toContain("Alert mode updated");
    expect(lastText(calls)).toContain("paused");

    await bot.handleUpdate(messageUpdate(`/wallet_mode ${walletAddress} digest 2`, userId));

    expect(lastText(calls)).toContain("Digest interval must be between 5 and 60 minutes");
  });

  it("checks an address without live Tron or database dependencies", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(lastText(calls)).toContain(`Subject: ${walletAddress}`);
    expect(lastText(calls)).toContain("Risk: LOW - 0/100");
  });

  it("keeps button-driven check address separate from wallet monitoring", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(messageCalls(calls)[0].payload.text).toContain("risk score and reasons");
    expect(messageCalls(calls).map((call) => String(call.payload.text))).toContain(`Subject: ${walletAddress}\nRisk: LOW - 0/100\n\nReasons:\n- no obvious risk signals found`);
    expect(lastText(calls)).toBe("No watched wallets yet. Add a TRON wallet to enable monitoring.");
  });

  it("clears a stale pending action when the user navigates through /wallets", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));

    expect(lastText(calls)).toContain("Monitoring: active");
  });

  it("clears a stale pending action when the user opens a wallet callback", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const viewCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(callbackQueryUpdate(viewCallback, userId));
    await bot.handleUpdate(messageUpdate(secondWalletAddress, userId));

    expect(lastText(calls)).toContain("Monitoring: active");
    await bot.handleUpdate(messageUpdate("/wallets", userId));
    expect(lastText(calls)).toBe("My wallets: 2");
  });

  it("supports button-driven add wallet and analytics callbacks", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("wl:add", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));
    const analyticsCallback = findCallbackData(lastMessagePayload(calls), "wl:analytics:");

    await bot.handleUpdate(callbackQueryUpdate(analyticsCallback, userId));

    expect(messageCalls(calls)[0].payload.text).toContain("Send a TRON wallet address");
    expect(messageCalls(calls)[1].payload.text).toContain("Monitoring: active");
    expect(lastText(calls)).toContain("Analytics for");
    expect(lastText(calls)).toContain("Transfers: 2");
  });

  it("shows risk intelligence details and removes a wallet only after confirmation", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const dashboardPayload = lastMessagePayload(calls);
    const riskCallback = findCallbackData(dashboardPayload, "wl:risk:");
    const safetyCallback = findCallbackData(dashboardPayload, "wl:safety:");
    const removeCallback = findCallbackData(dashboardPayload, "wl:remove:");

    await bot.handleUpdate(callbackQueryUpdate(riskCallback, userId));
    expect(lastText(calls)).toContain("⚠️ Risk intelligence:");
    expect(lastText(calls)).toContain("Internal labels: active");
    expect(lastText(calls)).toContain("AML providers: not connected");
    expect(lastText(calls)).toContain("Hop1/Hop2 graph: planned");
    expect(lastText(calls)).toContain("Approvals/security: limited");
    expect(lastText(calls)).toContain("Case forensics: planned");

    await bot.handleUpdate(callbackQueryUpdate(safetyCallback, userId));
    expect(lastText(calls)).toContain("Wallet safety:");
    expect(lastText(calls)).toContain("USDT approvals: 0");
    expect(lastText(calls)).toContain("Bot is read-only");

    await bot.handleUpdate(callbackQueryUpdate(removeCallback, userId));
    const confirmCallback = findCallbackData(lastMessagePayload(calls), "wl:remove_yes:");
    expect(lastText(calls)).toContain("Remove monitoring for");

    await bot.handleUpdate(callbackQueryUpdate(confirmCallback, userId));
    expect(lastText(calls)).toBe("No watched wallets yet. Add a TRON wallet to enable monitoring.");
  });

  it("keeps the legacy security callback as an alias for risk intelligence", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    const walletId = refreshCallback.replace("wl:refresh:", "");

    await bot.handleUpdate(callbackQueryUpdate(`wl:security:${walletId}`, userId));

    expect(lastText(calls)).toContain("⚠️ Risk intelligence:");
  });

  it("rejects /mark for non-admin users", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} scam`, userId));

    expect(lastText(calls)).toBe("This command is restricted to service admins.");
  });

  it("accepts /mark for configured service admins", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} scam`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(messageCalls(calls)[0].payload.text).toBe(`Marked ${walletAddress} as scam.`);
    expect(lastText(calls)).toContain("Risk: CRITICAL - 90/100");
  });

  it("checks a transaction hash through the button-driven pending action", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:tx", userId));
    await bot.handleUpdate(messageUpdate(txHash, userId));

    expect(lastText(calls)).toContain(`Subject: ${secondWalletAddress}`);
    expect(lastText(calls)).toContain("Risk: LOW - 0/100");
  });

  it("checks a sender from an alert callback without adding it as a wallet", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate(`check:addr:${walletAddress}`, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(messageCalls(calls).map((call) => String(call.payload.text))).toContain(
      `Subject: ${walletAddress}\nRisk: LOW - 0/100\n\nReasons:\n- no obvious risk signals found`
    );
    expect(lastText(calls)).toBe("No watched wallets yet. Add a TRON wallet to enable monitoring.");
  });

  it("manages customer alert admins through commands", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/alert_add abc", userId));
    expect(lastText(calls)).toContain("Send a numeric Telegram ID");

    await bot.handleUpdate(messageUpdate(`/alert_add ${userId} all`, userId));
    expect(lastText(calls)).toContain("You already receive owner alerts");

    await bot.handleUpdate(messageUpdate("/alert_add 7777 all", userId));
    expect(lastText(calls)).toContain("Alert admin saved: 7777");
    expect(lastText(calls)).toContain("7777 - all incoming alerts");

    await bot.handleUpdate(messageUpdate("/alert_add 7777 suspicious", userId));
    await bot.handleUpdate(messageUpdate("/alert_recipients", userId));

    expect(lastText(calls)).toContain("7777 - MEDIUM/HIGH/CRITICAL alerts only");
    expect(lastText(calls).match(/7777/g)).toHaveLength(1);

    await bot.handleUpdate(messageUpdate("/alert_mode 7777 all", userId));
    await bot.handleUpdate(messageUpdate("/alert_recipients", userId));
    expect(lastText(calls)).toContain("7777 - all incoming alerts");

    await bot.handleUpdate(messageUpdate("/alert_mode 9999 all", userId));
    expect(lastText(calls)).toContain("Customer alert admin not found: 9999");

    await bot.handleUpdate(messageUpdate("/alert_mode 7777", userId));
    expect(lastText(calls)).toContain("Usage: /alert_mode");

    await bot.handleUpdate(messageUpdate("/alert_remove 7777", userId));
    expect(lastText(calls)).toContain("Removed alert admin: 7777.");

    await bot.handleUpdate(messageUpdate("/alert_recipients", userId));
    expect(lastText(calls)).toContain("No customer alert admins configured");
  });

  it("manages customer alert admins through settings buttons", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("settings:alerts", userId));
    expect(lastText(calls)).toContain("No customer alert admins configured");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ Suspicious admin");

    await bot.handleUpdate(callbackQueryUpdate("settings:add_admin:suspicious", userId));
    expect(lastText(calls)).toContain("Send a Telegram ID");

    await bot.handleUpdate(messageUpdate("8888", userId));
    expect(lastText(calls)).toContain("Alert admin saved: 8888");
    expect(lastText(calls)).toContain("8888 - MEDIUM/HIGH/CRITICAL alerts only");

    const removeCallback = findCallbackData(lastMessagePayload(calls), "settings:remove_admin:");
    await bot.handleUpdate(callbackQueryUpdate(removeCallback, userId));

    expect(lastText(calls)).toContain("Removed alert admin: 8888.");
  });

  it("keeps alert-admin pending state after an invalid command retry", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("wl:add", userId));
    await bot.handleUpdate(messageUpdate("/alert_add abc", userId));
    await bot.handleUpdate(messageUpdate("7777", userId));

    expect(lastText(calls)).toContain("Alert admin saved: 7777");
    await bot.handleUpdate(messageUpdate("/wallets", userId));
    expect(lastText(calls)).toBe("No watched wallets yet. Add a TRON wallet to enable monitoring.");
  });

  it("parses remove buttons for short Telegram IDs accepted by commands", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/alert_add 1 all", userId));
    const removeCallback = findCallbackData(lastMessagePayload(calls), "settings:remove_admin:1");
    await bot.handleUpdate(callbackQueryUpdate(removeCallback, userId));

    expect(lastText(calls)).toContain("Removed alert admin: 1.");
  });
});
