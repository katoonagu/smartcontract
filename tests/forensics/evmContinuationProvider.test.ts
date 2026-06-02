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
  function emptyEvmProvider(overrides: Partial<EvmEvidenceProvider> = {}): EvmEvidenceProvider {
    return {
      async listNormalTransactions() {
        return [];
      },
      async listInternalTransactions() {
        return [];
      },
      async listErc20Transfers() {
        return [];
      },
      async getTransactionReceipt() {
        return null;
      },
      async getLogs() {
        return [];
      },
      async getTokenMetadata() {
        return null;
      },
      ...overrides
    };
  }

  it("normalizes ERC20, native, and internal edges for the requested chain", async () => {
    const evm = emptyEvmProvider({
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
      }
    });

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

  it("keeps usable edges when one explorer endpoint fails", async () => {
    const evm = emptyEvmProvider({
      async listNormalTransactions() {
        throw new Error("normal unavailable");
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
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges.map((edge) => edge.edgeType)).toEqual(["token_transfer"]);
    expect(edges[0]?.txHash).toBe("0xtoken");
  });

  it("adds LayerZero source-chain edges from Stargate receipt GUIDs", async () => {
    const guid = "0xeb5501154a8e9aa9ecf714631345b7351eb68c73683d736ec395d78b8b56efeb";
    const evm = emptyEvmProvider({
      async listInternalTransactions() {
        return [{
          chain: "arbitrum",
          hash: "0xdst",
          from: "0xa45b5130f36cdca45667738e2a258ab09f4a5f7f",
          to: "0x6ca63c963948597eaf85c6a193fedf1d96c62ea7",
          value: "99979999000000000000",
          timeStamp: "1777942873",
          type: "call"
        }];
      },
      async getTransactionReceipt() {
        return {
          chain: "arbitrum",
          transactionHash: "0xdst",
          logs: [{
            chain: "arbitrum",
            address: "0xa45b5130f36cdca45667738e2a258ab09f4a5f7f",
            topics: [
              "0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c",
              guid,
              "0x0000000000000000000000006ca63c963948597eaf85c6a193fedf1d96c62ea7"
            ],
            data: "0x",
            blockNumber: "1",
            transactionHash: "0xdst",
            logIndex: "0"
          }]
        };
      }
    });

    const provider = createEvmContinuationProvider({
      chain: "arbitrum",
      evmProvider: evm,
      layerZeroScanClient: {
        async getMessageByGuid() {
          return {
            guid,
            protocol: "Stargate",
            source: {
              chain: "ethereum",
              address: "0x6d6620efa72948c5f68a3c8646d58c00d3f4a980",
              tx: {
                txHash: "0xsrc",
                from: "0xeb2cdf39fc5afa85bba1467e209974d9b19fa68b",
                blockTimestamp: 1777942715
              }
            },
            destination: {
              chain: "arbitrum",
              address: "0x19cfce47ed54a88614648dc3f19a5980097007dd",
              tx: { txHash: "0xdst", blockTimestamp: 1777942907 }
            }
          };
        }
      }
    });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "arbitrum", chainId: 42161, address: "0x6ca63c963948597eaf85c6a193fedf1d96c62ea7" },
      seed: {
        ...seed,
        chain: "arbitrum",
        address: "0x6ca63c963948597eaf85c6a193fedf1d96c62ea7",
        amountRaw: "100000000000000000000",
        assetSymbol: "ETH"
      },
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    const layerZeroEdge = edges.find((edge) => edge.id === `layerzero-continuation:${guid}`);
    expect(layerZeroEdge).toMatchObject({
      edgeType: "bridge_protocol_link",
      source: { chain: "ethereum", chainId: 1, address: "0xeb2cdf39fc5afa85bba1467e209974d9b19fa68b" },
      destination: { chain: "arbitrum", chainId: 42161, address: "0x6ca63c963948597eaf85c6a193fedf1d96c62ea7" },
      txHash: "0xsrc",
      continuationEvidenceClass: "protocol_correlated"
    });
  });

  it("preserves identical ERC20 rows with distinct stable ids", async () => {
    const transfer = {
      chain: "ethereum" as const,
      hash: "0xtoken",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x4444444444444444444444444444444444444444",
      contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      value: "99000000000",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      timeStamp: "1777949202"
    };
    const evm = emptyEvmProvider({
      async listErc20Transfers() {
        return [transfer, transfer];
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(2);
  });

  it("keeps ERC20 ids stable when unrelated newer rows are prepended", async () => {
    const older = [{
      chain: "ethereum" as const,
      hash: "0xold1",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x4444444444444444444444444444444444444444",
      contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      value: "99000000000",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      timeStamp: "1777949202"
    }, {
      chain: "ethereum" as const,
      hash: "0xold2",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x5555555555555555555555555555555555555555",
      contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      value: "99000000000",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      timeStamp: "1777949203"
    }];
    const newer = {
      chain: "ethereum" as const,
      hash: "0xnew",
      from: "0x9999999999999999999999999999999999999999",
      to: "0x8888888888888888888888888888888888888888",
      contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      value: "1",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      timeStamp: "1777949300"
    };
    let rows = older;
    const evm = emptyEvmProvider({
      async listErc20Transfers() {
        return rows;
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const first = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });
    rows = [newer, ...older];
    const second = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(second.find((edge) => edge.txHash === "0xold1")?.id).toBe(first.find((edge) => edge.txHash === "0xold1")?.id);
    expect(second.find((edge) => edge.txHash === "0xold2")?.id).toBe(first.find((edge) => edge.txHash === "0xold2")?.id);
  });

  it("keeps internal fallback ids stable when unrelated newer rows are prepended", async () => {
    const older = [{
      chain: "ethereum" as const,
      hash: "0xinternalold1",
      from: "0x3333333333333333333333333333333333333333",
      to: "0x1111111111111111111111111111111111111111",
      value: "99000000000",
      timeStamp: "1777949202",
      type: "call"
    }, {
      chain: "ethereum" as const,
      hash: "0xinternalold2",
      from: "0x4444444444444444444444444444444444444444",
      to: "0x1111111111111111111111111111111111111111",
      value: "99000000000",
      timeStamp: "1777949203",
      type: "call"
    }];
    const newer = {
      chain: "ethereum" as const,
      hash: "0xinternalnew",
      from: "0x9999999999999999999999999999999999999999",
      to: "0x8888888888888888888888888888888888888888",
      value: "1",
      timeStamp: "1777949300",
      type: "call"
    };
    let rows = older;
    const evm = emptyEvmProvider({
      async listInternalTransactions() {
        return rows;
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const first = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });
    rows = [newer, ...older];
    const second = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(second.find((edge) => edge.txHash === "0xinternalold1")?.id).toBe(first.find((edge) => edge.txHash === "0xinternalold1")?.id);
    expect(second.find((edge) => edge.txHash === "0xinternalold2")?.id).toBe(first.find((edge) => edge.txHash === "0xinternalold2")?.id);
  });

  it("uses weak raw explorer evidence while close ERC20 amount and time remains strong", async () => {
    const evm = emptyEvmProvider({
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
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges[0]?.evidenceRefs[0]?.confidence).toBe("weak");
    expect(edges[0]?.continuationEvidenceClass).toBe("strong_amount_time");
  });

  it("does not promote raw Etherscan labels to protocol-correlated evidence", async () => {
    const evm = emptyEvmProvider({
      async listErc20Transfers() {
        return [{
          chain: "ethereum",
          hash: "0xtoken",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x4444444444444444444444444444444444444444",
          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          value: "99000000000",
          tokenName: "LayerZero USDT",
          tokenSymbol: "USDT",
          tokenDecimal: "6",
          timeStamp: "1777949202"
        }];
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges[0]?.labels).toContain("LayerZero USDT");
    expect(edges[0]?.evidenceRefs[0]?.confidence).toBe("weak");
    expect(edges[0]?.continuationEvidenceClass).toBe("strong_amount_time");
  });

  it("filters failed normal transactions", async () => {
    const evm = emptyEvmProvider({
      async listNormalTransactions() {
        return [
          {
            chain: "ethereum",
            hash: "0xreverted",
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            value: "99000000000",
            timeStamp: "1777949202",
            isError: "1"
          },
          {
            chain: "ethereum",
            hash: "0xfailedreceipt",
            from: "0x1111111111111111111111111111111111111111",
            to: "0x3333333333333333333333333333333333333333",
            value: "99000000000",
            timeStamp: "1777949202",
            txReceiptStatus: "0"
          }
        ];
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges).toHaveLength(0);
  });

  it("filters failed internal transactions", async () => {
    const evm = emptyEvmProvider({
      async listInternalTransactions() {
        return [
          {
            chain: "ethereum",
            hash: "0xinternalreverted",
            from: "0x3333333333333333333333333333333333333333",
            to: "0x1111111111111111111111111111111111111111",
            value: "99000000000",
            timeStamp: "1777949202",
            type: "call",
            isError: "1"
          },
          {
            chain: "ethereum",
            hash: "0xinternalerrcode",
            from: "0x3333333333333333333333333333333333333333",
            to: "0x1111111111111111111111111111111111111111",
            value: "99000000000",
            timeStamp: "1777949202",
            type: "call",
            errCode: "Reverted"
          }
        ];
      }
    });

    const provider = createEvmContinuationProvider({ chain: "ethereum", evmProvider: evm });
    const edges = await provider.listEdgesForAddress({
      address: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
      seed,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 10 })
    });

    expect(edges).toHaveLength(0);
  });
});
