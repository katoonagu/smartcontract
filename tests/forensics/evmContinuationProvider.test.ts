import { describe, expect, it } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";
import { createEvmContinuationProvider } from "../../src/forensics/evmContinuationProvider";
import type { EvmEvidenceProvider } from "../../src/forensics/evmExplorerClient";
import type { CrossChainContinuationSeed } from "../../src/forensics/crossChainContinuationTypes";

const seed: CrossChainContinuationSeed = {
  id: "seed",
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  txHash: "0xseed",
  amountRaw: "100000000000",
  assetSymbol: "USDT",
  timestamp: "2026-05-05T02:41:59.000Z",
  labels: ["LayerZero"],
  evidenceRefs: []
};

describe("EVM continuation provider", () => {
  it("normalizes ERC20, native, and internal edges for the requested chain", async () => {
    const evm: EvmEvidenceProvider = {
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xnormal",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0",
          timeStamp: "1777949200",
          functionName: "bridge()"
        }];
      },
      async listInternalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xinternal",
          from: "0x3333333333333333333333333333333333333333",
          to: "0x1111111111111111111111111111111111111111",
          value: "99000000000000000000",
          timeStamp: "1777949201",
          type: "call"
        }];
      },
      async listErc20Transfers() {
        return [{
          chain: "ethereum",
          hash: "0xtoken",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x4444444444444444444444444444444444444444",
          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          value: "99000000000",
          tokenName: "Tether USD",
          tokenSymbol: "USDT",
          tokenDecimal: "6",
          timeStamp: "1777949202"
        }];
      },
      async getTransactionReceipt() {
        return null;
      },
      async getLogs() {
        return [];
      },
      async getTokenMetadata() {
        return null;
      }
    };

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges.map((edge) => edge.edgeType)).toEqual(expect.arrayContaining(["native_transfer", "internal_transfer", "token_transfer"]));
    expect(edges.find((edge) => edge.txHash === "0xtoken")?.assetSymbol).toBe("USDT");
    expect(edges.find((edge) => edge.txHash === "0xtoken")?.continuationEvidenceClass).toBe("strong_amount_time");
  });
});
