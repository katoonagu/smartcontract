import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import type { CrossChainContinuationSeed } from "../../src/forensics/crossChainContinuationTypes";
import { createTronUsdtContinuationProvider } from "../../src/forensics/tronContinuationProvider";
import type { RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";

const seedAddress = "TXu3sNwjyvNvCWY9kdZGZfCSDV1ikz25A4";
const destinationAddress = "TAC21biCBL9agjuUyzd4gZr356zRgJq61b";

function seed(overrides: Partial<CrossChainContinuationSeed> = {}): CrossChainContinuationSeed {
  return {
    id: "seed:tron",
    chain: "tron",
    address: seedAddress,
    txHash: "90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122",
    amountRaw: "999000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-09T22:00:00.000Z",
    timeWindow: {
      start: "2026-05-09T21:55:00.000Z",
      end: "2026-05-09T22:10:00.000Z"
    },
    labels: ["Allbridge"],
    evidenceRefs: [],
    ...overrides
  };
}

function transfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  return {
    transaction_id: "90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122",
    from_address: seedAddress,
    to_address: destinationAddress,
    quant: "999000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    revert: false,
    block_ts: Date.parse("2026-05-09T22:01:00.000Z"),
    ...overrides
  };
}

describe("createTronUsdtContinuationProvider", () => {
  it("calls the TRON client through the continuation budget with address and time-window options", async () => {
    const calls: Array<{ address: string; options?: unknown }> = [];
    const provider = createTronUsdtContinuationProvider({
      tronClient: {
        async listRelatedTrc20Transfers(address, options) {
          calls.push({ address, options });
          return [];
        }
      }
    });
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 5 });

    const edges = await provider.listEdgesForAddress({
      address: { chain: "tron", chainId: "tron-mainnet", address: seedAddress },
      seed: seed(),
      budget
    });

    expect(provider.chain).toBe("tron");
    expect(edges).toEqual([]);
    expect(budget.providerCalls()).toBe(1);
    expect(calls).toEqual([{
      address: seedAddress,
      options: {
        start: 0,
        limit: 50,
        minTimestamp: Date.parse("2026-05-09T21:55:00.000Z"),
        endTimestamp: Date.parse("2026-05-09T22:10:00.000Z")
      }
    }]);
  });

  it("normalizes successful TRON USDT transfers into protocol-correlated continuation edges", async () => {
    const provider = createTronUsdtContinuationProvider({
      tronClient: {
        async listRelatedTrc20Transfers() {
          return [transfer()];
        }
      }
    });

    const edges = await provider.listEdgesForAddress({
      address: { chain: "tron", chainId: "tron-mainnet", address: seedAddress },
      seed: seed(),
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 })
    });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      edgeType: "token_transfer",
      source: { chain: "tron", chainId: "tron-mainnet", address: seedAddress },
      destination: { chain: "tron", chainId: "tron-mainnet", address: destinationAddress },
      txHash: "90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122",
      amountRaw: "999000000",
      assetSymbol: "USDT",
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      timestamp: "2026-05-09T22:01:00.000Z",
      protocol: "TRON USDT",
      evidenceRefs: [{
        id: "cross_chain:local:tron:90d82348b20009cda48a2294233c888a89f3133c21855044f115719f14c52122:token_transfer",
        provider: "local",
        payloadId: null,
        confidence: "protocol_correlated"
      }],
      labels: ["TRON USDT"],
      continuationEvidenceClass: "protocol_correlated"
    });
    expect(edges[0]?.score).toBeGreaterThanOrEqual(90);
  });

  it("accepts official TRON USDT tokenInfo tokenId rows when contract_address is absent", async () => {
    const provider = createTronUsdtContinuationProvider({
      tronClient: {
        async listRelatedTrc20Transfers() {
          return [transfer({
            contract_address: undefined,
            tokenInfo: {
              tokenAbbr: "USDT",
              tokenDecimal: 6,
              tokenId: TRON_USDT_CONTRACT_ADDRESS,
              tokenType: "trc20"
            }
          })];
        }
      }
    });

    const edges = await provider.listEdgesForAddress({
      address: { chain: "tron", chainId: "tron-mainnet", address: seedAddress },
      seed: seed(),
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 })
    });

    expect(edges).toHaveLength(1);
    expect(edges[0]?.tokenContract).toBe(TRON_USDT_CONTRACT_ADDRESS);
  });

  it("filters failed, reverted, non-USDT, invalid amount, invalid timestamp, and missing-address rows", async () => {
    const valid = transfer({ transaction_id: "valid-tx" });
    const provider = createTronUsdtContinuationProvider({
      tronClient: {
        async listRelatedTrc20Transfers() {
          return [
            transfer({ transaction_id: "not-confirmed", confirmed: false }),
            transfer({ transaction_id: "reverted", revert: true }),
            transfer({ transaction_id: "bad-contract-ret", contractRet: "REVERT" }),
            transfer({ transaction_id: "bad-final-result", finalResult: "FAILED" }),
            transfer({ transaction_id: "not-usdt", contract_address: "TRNotUsdt111111111111111111111111111111" }),
            transfer({ transaction_id: "bad-amount", quant: "999.000000" }),
            transfer({ transaction_id: "missing-from", from_address: "" }),
            transfer({ transaction_id: "missing-to", to_address: "" }),
            transfer({ transaction_id: "bad-time", block_ts: Number.NaN }),
            valid
          ];
        }
      }
    });

    const edges = await provider.listEdgesForAddress({
      address: { chain: "tron", chainId: "tron-mainnet", address: seedAddress },
      seed: seed(),
      budget: createCrossChainProviderBudget({ maxProviderCalls: 5 })
    });

    expect(edges.map((edge) => edge.txHash)).toEqual(["valid-tx"]);
  });
});
