import { describe, expect, it } from "vitest";
import { checkAddress, checkTransactionHash } from "../../src/check/manualCheck";

describe("manual checks", () => {
  it("checks an address using stored labels", async () => {
    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [
        {
          address: "TSubject111111111111111111111111111111",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ]
    });

    expect(result.report.level).toBe("CRITICAL");
    expect(result.subjectAddress).toBe("TSubject111111111111111111111111111111");
  });

  it("checks an address using optional risk signal providers", async () => {
    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [],
      getRiskSignalsForAddress: async () => ({
        graphSignals: [{ code: "risky_1_hop", message: "1-hop exposure to risky address", scoreImpact: 35 }],
        behaviorSignals: [{ code: "fast_transit", message: "Fast transit pattern detected", scoreImpact: 30 }],
        amlSignals: []
      })
    });

    expect(result.report.level).toBe("HIGH");
    expect(result.report.reasons.map((reason) => reason.code)).toEqual(["risky_1_hop", "fast_transit"]);
  });

  it("checks a transaction hash by extracting the TRC20 sender", async () => {
    const result = await checkTransactionHash("abc123", {
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {
            trc20TransferInfo: [
              {
                from_address: "TSender111111111111111111111111111111",
                contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
              }
            ]
          };
        }
      },
      getLabelsForAddress: async () => []
    });

    expect(result.subjectAddress).toBe("TSender111111111111111111111111111111");
    expect(result.report.level).toBe("LOW");
  });

  it("prefers official USDT transfer sender when transaction info has several token transfers", async () => {
    const result = await checkTransactionHash("abc123", {
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {
            trc20TransferInfo: [
              {
                from_address: "TNoise1111111111111111111111111111111",
                contract_address: "TNotUsdt1111111111111111111111111111"
              },
              {
                from_address: "TUsdtSender11111111111111111111111111",
                contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
              }
            ]
          };
        }
      },
      getLabelsForAddress: async () => []
    });

    expect(result.subjectAddress).toBe("TUsdtSender11111111111111111111111111");
  });

  it("throws when a transaction sender cannot be extracted", async () => {
    await expect(
      checkTransactionHash("abc123", {
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return { trc20TransferInfo: [] };
          }
        },
        getLabelsForAddress: async () => []
      })
    ).rejects.toThrow("Could not extract sender from transaction: abc123");
  });

  it("does not trust token abbreviation without the official USDT contract", async () => {
    await expect(
      checkTransactionHash("abc123", {
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return {
              trc20TransferInfo: [
                {
                  from_address: "TSpoofed11111111111111111111111111111",
                  contract_address: "TNotUsdt1111111111111111111111111111",
                  tokenInfo: { tokenAbbr: "USDT" }
                }
              ]
            };
          }
        },
        getLabelsForAddress: async () => []
      })
    ).rejects.toThrow("Could not extract sender from transaction: abc123");
  });

  it("does not fall back to transaction owner when TRC20 sender is unavailable", async () => {
    await expect(
      checkTransactionHash("abc123", {
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return {
              contractData: { owner_address: "TOwner1111111111111111111111111111111" },
              ownerAddress: "TOwner2222222222222222222222222222222"
            };
          }
        },
        getLabelsForAddress: async () => []
      })
    ).rejects.toThrow("Could not extract sender from transaction: abc123");
  });
});
