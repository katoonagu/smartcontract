import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config";
import { createBot } from "../../src/bot/createBot";
import type { Db } from "../../src/storage/db";
import type { RiskLabel } from "../../src/types";
import type { TronClient } from "../../src/tron/tronClient";

const walletAddress = `T${"1".repeat(33)}`;
const adminId = "9001";
const userId = "42";

type ReplyCall = {
  method: string;
  payload: Record<string, unknown>;
};

function createConfig(): AppConfig {
  return {
    botToken: "123456:test-token",
    databaseUrl: "postgres://unused",
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com"),
    tronscanApiKey: undefined,
    tronscanPageLimit: 50,
    tronscanMaxPagesPerWallet: 5,
    tronscanTimeoutMs: 10000,
    tronscanRetryAttempts: 3,
    tronscanRetryBaseDelayMs: 500,
    tronscanBackfillLookbackMs: 86_400_000,
    pollIntervalMs: 60_000,
    serviceAdminTelegramIds: new Set([adminId])
  };
}

function createFakeDb(): Db {
  const wallets: Array<{ id: string; telegramUserId: string; address: string; createdAt: Date }> = [];
  const labels: Array<{ address: string; label: RiskLabel; source: "service_admin"; createdByTelegramId: string; createdAt: Date }> = [];

  return {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("insert into telegram_users")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("insert into watched_wallets")) {
        const wallet = {
          id: String(params[0]),
          telegramUserId: String(params[1]),
          address: String(params[2]),
          createdAt: new Date("2026-05-20T00:00:00.000Z")
        };
        const existing = wallets.find((item) => item.telegramUserId === wallet.telegramUserId && item.address === wallet.address);
        if (!existing) wallets.push(wallet);
        return {
          rows: [
            {
              id: existing?.id ?? wallet.id,
              telegram_user_id: wallet.telegramUserId,
              address: wallet.address,
              created_at: existing?.createdAt ?? wallet.createdAt
            }
          ],
          rowCount: 1
        };
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
            created_at: wallet.createdAt
          }));
        return { rows, rowCount: rows.length };
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

      throw new Error(`Unexpected query in bot smoke test: ${sql}`);
    }
  } as unknown as Db;
}

function createTronClient(): TronClient {
  return {
    async getTransaction() {
      throw new Error("Transaction lookup should not be used by address smoke tests.");
    },
    async listIncomingTrc20Transfers() {
      return [];
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

function lastReply(calls: ReplyCall[]): string {
  return String(calls.at(-1)?.payload.text ?? "");
}

async function createSmokeBot() {
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
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true };
  });
  await bot.init();
  return { bot, calls };
}

describe("bot command smoke coverage", () => {
  it("handles /start", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("sendMessage");
    expect(lastReply(calls)).toContain("Send a TRON address");
  });

  it("adds a valid wallet and lists it", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(calls.map((call) => call.payload.text)).toEqual([`Monitoring enabled for ${walletAddress}.`, `- ${walletAddress}`]);
  });

  it("checks an address without live Tron or database dependencies", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(lastReply(calls)).toContain(`Subject: ${walletAddress}`);
    expect(lastReply(calls)).toContain("Risk: LOW - 0/100");
  });

  it("rejects /mark for non-admin users", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} scam`, userId));

    expect(lastReply(calls)).toBe("This command is restricted to service admins.");
  });

  it("accepts /mark for configured service admins", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} scam`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(calls[0].payload.text).toBe(`Marked ${walletAddress} as scam.`);
    expect(lastReply(calls)).toContain("Risk: CRITICAL - 90/100");
  });
});
