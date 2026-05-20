import { describe, expect, it } from "vitest";
import { runSinglePollingCycle } from "../../src/monitor/monitorWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { TronTransferEvent } from "../../src/types";

const watchedWallet = {
  id: "wallet-1",
  telegramUserId: "123",
  telegramUsername: "client_user",
  address: "TReceiver11111111111111111111111111111",
  createdAt: new Date()
};

const incomingTransfer = {
  transaction_id: "tx1",
  from_address: "TSender111111111111111111111111111111",
  to_address: watchedWallet.address,
  quant: "1000000",
  contract_address: TRON_USDT_CONTRACT_ADDRESS,
  confirmed: true,
  contractRet: "SUCCESS",
  tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
  block_ts: 1779220000000
};

describe("runSinglePollingCycle", () => {
  it("alerts once for a new incoming transfer and skips already observed tx for the same wallet", async () => {
    const sentMessages: string[] = [];
    const observed = new Set<string>();

    const deps = {
      wallets: [watchedWallet],
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [incomingTransfer];
        },
        async getTransaction() {
          return {};
        }
      },
      hasObservedTransaction: async (txHash: string, watchedWalletId: string) => observed.has(`${watchedWalletId}:${txHash}`),
      saveObservedTransaction: async ({ watchedWalletId, event }: { watchedWalletId: string; event: TronTransferEvent }) => {
        observed.add(`${watchedWalletId}:${event.txHash}`);
      },
      getLabelsForAddress: async () => [],
      sendUserAlert: async (_telegramUserId: string, message: string) => {
        sentMessages.push(message);
      },
      sendAdminAlert: async () => {}
    };

    await runSinglePollingCycle(deps);
    await runSinglePollingCycle(deps);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Incoming USDT: 1");
  });

  it("sends CRITICAL incoming events to service admins with owner context", async () => {
    const adminMessages: string[] = [];

    await runSinglePollingCycle({
      wallets: [watchedWallet],
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [incomingTransfer];
        },
        async getTransaction() {
          return {};
        }
      },
      hasObservedTransaction: async () => false,
      saveObservedTransaction: async () => {},
      getLabelsForAddress: async () => [
        {
          address: incomingTransfer.from_address,
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ],
      sendUserAlert: async () => {},
      sendAdminAlert: async (message) => {
        adminMessages.push(message);
      }
    });

    expect(adminMessages).toHaveLength(1);
    expect(adminMessages[0]).toContain("CRITICAL incoming event");
    expect(adminMessages[0]).toContain("User: @client_user - tg_id: 123");
  });

  it("sends HIGH incoming events to service admins", async () => {
    const adminMessages: string[] = [];

    await runSinglePollingCycle({
      wallets: [watchedWallet],
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [incomingTransfer];
        },
        async getTransaction() {
          return {};
        }
      },
      hasObservedTransaction: async () => false,
      saveObservedTransaction: async () => {},
      getLabelsForAddress: async () => [],
      getRiskSignalsForAddress: async () => ({
        graphSignals: [{ code: "risky_1_hop", message: "1-hop exposure to risky address", scoreImpact: 35 }],
        behaviorSignals: [{ code: "fast_transit", message: "Fast transit pattern detected", scoreImpact: 30 }],
        amlSignals: []
      }),
      sendUserAlert: async () => {},
      sendAdminAlert: async (message) => {
        adminMessages.push(message);
      }
    });

    expect(adminMessages).toHaveLength(1);
    expect(adminMessages[0]).toContain("HIGH incoming event");
  });

  it("does not mark a transaction observed when alert delivery fails", async () => {
    const saved: string[] = [];

    await expect(
      runSinglePollingCycle({
        wallets: [watchedWallet],
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [incomingTransfer];
          },
          async getTransaction() {
            return {};
          }
        },
        hasObservedTransaction: async () => false,
        saveObservedTransaction: async ({ event }) => {
          saved.push(event.txHash);
        },
        getLabelsForAddress: async () => [],
        sendUserAlert: async () => {
          throw new Error("telegram send failed");
        },
        sendAdminAlert: async () => {}
      })
    ).rejects.toThrow("telegram send failed");

    expect(saved).toEqual([]);
  });
});
