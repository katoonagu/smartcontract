import { describe, expect, it, vi } from "vitest";
import { runCrossChainCorridorAnalysis } from "../../src/forensics/crossChainCorridor";
import {
  createFixtureCrossChainDiscoveryProvider,
  type CrossChainDiscoveryProvider,
  type CrossChainTransfer,
  type ProviderRiskSnapshot
} from "../../src/forensics/crossChainProviders";
import type {
  EvmEvidenceProvider,
  EvmInternalTransaction,
  EvmLog,
  EvmTokenMetadata,
  EvmTokenTransfer,
  EvmTransaction,
  EvmTransactionReceipt
} from "../../src/forensics/evmExplorerClient";
import type { CrossChainStage2TriggerEvaluation } from "../../src/forensics/crossChainStage2Triggers";
import type { MoneyOriginPath } from "../../src/types";
import { manualGaryStargateTornadoCase } from "../fixtures/forensics/crossChainCases";

const subjectTron = "TSubject11111111111111111111111111111";
const subjectEth = "0x1111111111111111111111111111111111111111";
const bridgeEth = "0x2222222222222222222222222222222222222222";
const garyActor = "0x3333333333333333333333333333333333333333";
const arbActor = "0x4444444444444444444444444444444444444444";
const sanctioned = "0x5555555555555555555555555555555555555555";
const tornado = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b";
const uniswapV3Npm = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const decreaseLiquidityTopic = "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";

function trigger(overrides: Partial<CrossChainStage2TriggerEvaluation> = {}): CrossChainStage2TriggerEvaluation {
  return {
    triggered: true,
    reason: "large_single_boundary",
    skippedReason: null,
    deepCheckAvailable: true,
    balanceTransferTxHashes: ["tx-range"],
    selectedAmountRaw: "100000000000",
    targetAmountRaw: "100000000000",
    ...overrides
  };
}

function originPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  const balanceTransferTxHash = overrides.balanceTransferTxHash ?? "tx-range";
  const fromAddress = overrides.rootSourceAddress ?? bridgeEth;
  const toAddress = overrides.pathAddresses?.at(-1) ?? subjectTron;

  return {
    balanceTransferTxHash,
    rootSourceAddress: fromAddress,
    rootSourceType: "decline_boundary",
    balanceShare: 1,
    exposureSourceKey: "stargate",
    exposureSourceLabel: "LayerZero/Stargate bridge",
    sourceExposureKind: "cross_chain_boundary",
    effectiveExposureShare: 1,
    linkStrength: 0.95,
    pathAddresses: [fromAddress, toAddress],
    txHashes: [balanceTransferTxHash],
    steps: [{
      txHash: balanceTransferTxHash,
      fromAddress,
      toAddress,
      amountRaw: "100000000000",
      timestamp: "2026-05-05T02:41:59.000Z"
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: "decline_boundary_reached",
    verdict: "DECLINE",
    riskScoreContribution: 70,
    reasons: ["Balance-forming path reaches a cross-chain boundary."],
    ...overrides
  };
}

function transfer(overrides: Partial<CrossChainTransfer> = {}): CrossChainTransfer {
  return {
    id: "range-tron-ethereum-usdt",
    protocol: "LayerZero/Stargate",
    source: {
      chain: "tron",
      chainId: "tron-mainnet",
      address: subjectTron
    },
    destination: {
      chain: "ethereum",
      chainId: 1,
      address: bridgeEth
    },
    sourceTxHash: "tx-range",
    destinationTxHash: "0xbridge",
    assetSymbol: "USDT",
    amountRaw: "100000000000",
    decimals: 6,
    timestamp: "2026-05-05T02:41:59.000Z",
    evidenceRefs: [{
      id: "cross_chain:range:ethereum:0xbridge:bridge_destination",
      provider: "range",
      payloadId: "range:tx:tx-range",
      confidence: "provider_correlated"
    }],
    payloadRef: {
      id: "range:tx:tx-range",
      provider: "range",
      endpoint: "transfers/by-tx",
      fetchedAt: "2026-06-01T00:00:00.000Z"
    },
    labels: ["LayerZero", "Stargate"],
    ...overrides
  };
}

function riskSnapshot(overrides: Partial<ProviderRiskSnapshot> = {}): ProviderRiskSnapshot {
  return {
    address: {
      chain: "ethereum",
      chainId: 1,
      address: sanctioned
    },
    provider: "local",
    riskScore: 100,
    labels: ["LOCAL_EXACT_SANCTIONED: OFAC SDN sanctioned service"],
    evidenceRefs: [{
      id: "cross_chain:local:ethereum:sanctioned:service_boundary",
      provider: "local",
      payloadId: null,
      confidence: "exact"
    }],
    payloadRef: null,
    ...overrides
  };
}

function discovery(data: {
  transfers?: readonly CrossChainTransfer[];
  riskSnapshots?: readonly ProviderRiskSnapshot[];
}): CrossChainDiscoveryProvider {
  return createFixtureCrossChainDiscoveryProvider({
    transfers: data.transfers ?? [],
    riskSnapshots: data.riskSnapshots ?? []
  });
}

function countingDiscovery(provider: CrossChainDiscoveryProvider): CrossChainDiscoveryProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findTransfersByTx(query) {
      calls.push(`tx:${query.txHash}`);
      return provider.findTransfersByTx(query);
    },
    async findTransfersByAddress(query) {
      calls.push(`address:${query.address}`);
      return provider.findTransfersByAddress(query);
    },
    async getAddressRisk(query) {
      calls.push(`risk:${query.address}`);
      return provider.getAddressRisk(query);
    }
  };
}

function emptyEvm(overrides: Partial<EvmEvidenceProvider> = {}): EvmEvidenceProvider {
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

function log(overrides: Partial<EvmLog> = {}): EvmLog {
  return {
    chain: "ethereum",
    address: uniswapV3Npm,
    topics: [decreaseLiquidityTopic],
    data: "0x",
    blockNumber: "22500000",
    transactionHash: "0xgary",
    logIndex: "0",
    ...overrides
  };
}

function receipt(overrides: Partial<EvmTransactionReceipt> = {}): EvmTransactionReceipt {
  return {
    chain: "ethereum",
    transactionHash: "0xgary",
    to: uniswapV3Npm,
    logs: [log()],
    status: "1",
    ...overrides
  };
}

function tokenTransfer(overrides: Partial<EvmTokenTransfer> = {}): EvmTokenTransfer {
  return {
    chain: "ethereum",
    hash: "0xgary",
    from: garyActor,
    to: uniswapV3Npm,
    contractAddress: "0xgary000000000000000000000000000000000000",
    value: "1000000000000000000",
    tokenSymbol: "GARY",
    tokenDecimal: "18",
    ...overrides
  };
}

function metadata(symbol: string, tokenContract = `0x${symbol.toLowerCase().padEnd(40, "0")}`): EvmTokenMetadata {
  return {
    chain: "ethereum",
    tokenContract,
    tokenName: `${symbol} token`,
    tokenSymbol: symbol,
    tokenDecimal: "18"
  };
}

describe("runCrossChainCorridorAnalysis", () => {
  it("trigger skipped -> enabled report with triggered=false and no provider calls", async () => {
    const provider = {
      findTransfersByTx: vi.fn(),
      findTransfersByAddress: vi.fn(),
      getAddressRisk: vi.fn()
    } satisfies CrossChainDiscoveryProvider;

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({
        triggered: false,
        reason: null,
        skippedReason: "Visible boundary below auto-run threshold.",
        deepCheckAvailable: true
      }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: provider,
      evmProvider: emptyEvm(),
      maxProviderCalls: 10
    });

    expect(result).toEqual({
      report: {
        enabled: true,
        triggered: false,
        skippedReason: "Visible boundary below auto-run threshold.",
        paths: [],
        providerCalls: 0,
        partial: false,
        coverageNotes: ["Deep cross-chain analysis is available but was not auto-run."],
        payloadRefs: []
      },
      extraSourcePolicyEvidence: [],
      extraRiskLayers: [],
      extraHardBadEvidence: []
    });
    expect(provider.findTransfersByTx).not.toHaveBeenCalled();
    expect(provider.findTransfersByAddress).not.toHaveBeenCalled();
    expect(provider.getAddressRisk).not.toHaveBeenCalled();
  });

  it("triggered but discovery provider missing -> partial report", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      evmProvider: emptyEvm(),
      maxProviderCalls: 10
    });

    expect(result.report).toEqual({
      enabled: true,
      triggered: true,
      skippedReason: null,
      paths: [],
      providerCalls: 0,
      partial: true,
      coverageNotes: ["Stage 2 was triggered, but the cross-chain discovery provider is unavailable."],
      payloadRefs: []
    });
    expect(result.extraRiskLayers).toEqual([]);
    expect(result.extraHardBadEvidence).toEqual([]);
  });

  it("Range TRON -> Ethereum bridge row -> bridge edge", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 10
    });

    expect(result.report.paths).toHaveLength(1);
    expect(result.report.paths[0]?.edges).toEqual([
      expect.objectContaining({
        edgeType: "bridge_protocol_link",
        source: expect.objectContaining({ chain: "tron", address: subjectTron }),
        destination: expect.objectContaining({ chain: "ethereum", address: bridgeEth }),
        assetSymbol: "USDT",
        protocol: "LayerZero/Stargate"
      })
    ]);
    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.extraSourcePolicyEvidence[0]?.kind).toBe("cross_chain_boundary");
    expect(result.report.payloadRefs.map((ref) => ref.id)).toContain("range:tx:tx-range");
  });

  it("scopes address discovery so unrelated old transfers are excluded while tx-seeded transfer remains", async () => {
    const oldTransfer = transfer({
      id: "range-old-unrelated",
      sourceTxHash: "tx-old",
      destinationTxHash: "0xold",
      timestamp: "2022-01-01T00:00:00.000Z"
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer(), oldTransfer] }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    const bridgeEdges = result.report.paths[0]?.edges.filter((edge) => edge.edgeType === "bridge_protocol_link") ?? [];
    expect(bridgeEdges.map((edge) => edge.txHash)).toEqual(["0xbridge"]);
    expect(bridgeEdges.map((edge) => edge.txHash)).not.toContain("0xold");
  });

  it("keeps address-discovered bridge rows within normal amount preservation tolerance", async () => {
    const slippageTransfer = transfer({
      id: "range-address-slippage",
      sourceTxHash: "tx-address-only",
      destinationTxHash: "0xslippage",
      amountRaw: "90000000000"
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ balanceTransferTxHashes: [] }),
      subjectAddress: subjectTron,
      originPaths: [originPath({ txHashes: [] })],
      discoveryProvider: discovery({ transfers: [slippageTransfer] }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    const bridgeEdges = result.report.paths[0]?.edges.filter((edge) => edge.edgeType === "bridge_protocol_link") ?? [];
    expect(bridgeEdges.map((edge) => edge.txHash)).toContain("0xslippage");
    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
  });

  it("keeps provider-correlated bridge rows even when labels mention weak heuristics", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({
        transfers: [transfer({
          labels: ["LayerZero", "Stargate", "weak off-chain amount note"],
          evidenceRefs: [{
            id: "cross_chain:range:ethereum:0xbridge:provider_correlated",
            provider: "range",
            payloadId: "range:tx:tx-range",
            confidence: "provider_correlated"
          }]
        })]
      }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.extraSourcePolicyEvidence[0]?.kind).toBe("cross_chain_boundary");
  });

  it("dedupes the same bridge leg returned by tx and address endpoints with different provider ids", async () => {
    const duplicate = transfer({ id: "range-address-duplicate" });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer(), duplicate] }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    const bridgeEdges = result.report.paths[0]?.edges.filter((edge) => edge.edgeType === "bridge_protocol_link") ?? [];
    expect(bridgeEdges).toHaveLength(1);
  });

  it("Range + EVM GARY liquidity -> no_name_token_liquidity", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary",
          from: garyActor,
          to: uniswapV3Npm,
          value: "0",
          functionName: "decreaseLiquidity(uint256 tokenId)"
        } satisfies EvmTransaction];
      },
      async listInternalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary",
          from: uniswapV3Npm,
          to: garyActor,
          value: "247770000000000000000"
        } satisfies EvmInternalTransaction];
      },
      async listErc20Transfers() {
        return [
          tokenTransfer(),
          tokenTransfer({
            contractAddress: "0xweth000000000000000000000000000000000000",
            tokenSymbol: "WETH"
          })
        ];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xgary" ? receipt() : null;
      },
      async getTokenMetadata({ tokenContract }) {
        return tokenContract.includes("gary") ? metadata("GARY", tokenContract) : metadata("WETH", tokenContract);
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: garyActor, pathAddresses: [garyActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: garyActor },
          destinationTxHash: "0xgary"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("no_name_token_liquidity");
    expect(result.extraSourcePolicyEvidence[0]?.kind).toBe("no_name_token_liquidity");
    expect(result.report.paths[0]?.edges.map((edge) => edge.edgeType)).toContain("unknown_token_liquidity");
    expect(result.report.paths[0]?.reasons.join(" ")).toContain("asset-track switch");
  });

  it("uses EVM-side Range tx receipts before unrelated account history for Tornado detection", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xunrelated",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "1"
        } satisfies EvmTransaction];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xtornado-range"
          ? receipt({
            transactionHash: "0xtornado-range",
            to: tornado,
            logs: []
          })
          : null;
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: tornado, pathAddresses: [tornado, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: tornado },
          destinationTxHash: "0xtornado-range"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("tornado_or_mixer");
    expect(result.report.paths[0]?.edges.map((edge) => edge.txHash)).toContain("0xtornado-range");
  });

  it("detects tx-seeded receipt funding from a known Tornado address when account history is empty", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xtornado-from-range"
          ? receipt({
            transactionHash: "0xtornado-from-range",
            from: tornado,
            to: arbActor,
            logs: []
          })
          : null;
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: arbActor, pathAddresses: [arbActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: arbActor },
          destinationTxHash: "0xtornado-from-range"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("tornado_or_mixer");
    expect(result.extraSourcePolicyEvidence[0]?.kind).toBe("mixer");
    expect(result.report.paths[0]?.edges.map((edge) => edge.txHash)).toContain("0xtornado-from-range");
  });

  it("ignores unrelated account-history Tornado rows outside corridor tx hashes", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xold-tornado",
          from: tornado,
          to: bridgeEth,
          value: "100000000000000000000",
          functionName: "Tornado.Cash withdrawal funding"
        } satisfies EvmTransaction];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xbridge"
          ? receipt({
            transactionHash: "0xbridge",
            to: bridgeEth,
            logs: []
          })
          : null;
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.extraSourcePolicyEvidence.map((evidence) => evidence.kind)).not.toContain("mixer");
    expect(result.report.paths[0]?.edges.map((edge) => edge.txHash)).not.toContain("0xold-tornado");
  });

  it("surfaces data exhaustion from tx-seeded Uniswap receipt when account history misses the tx", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [];
      },
      async listInternalTransactions() {
        return [];
      },
      async listErc20Transfers() {
        return [];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xreceipt-liquidity"
          ? receipt({ transactionHash: "0xreceipt-liquidity" })
          : null;
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: garyActor, pathAddresses: [garyActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: garyActor },
          destinationTxHash: "0xreceipt-liquidity"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.extraRiskLayers.some((layer) => layer.kind === "cross_chain_data_exhausted")).toBe(true);
    expect(result.report.partial).toBe(true);
    expect(result.report.coverageNotes.join(" ")).toMatch(/token metadata|provider data/i);
  });

  it("falls back to ERC20 transfer token fields when token metadata provider is empty", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary",
          from: garyActor,
          to: uniswapV3Npm,
          value: "0",
          functionName: "decreaseLiquidity(uint256 tokenId)"
        } satisfies EvmTransaction];
      },
      async listInternalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary",
          from: uniswapV3Npm,
          to: garyActor,
          value: "247770000000000000000"
        } satisfies EvmInternalTransaction];
      },
      async listErc20Transfers() {
        return [
          tokenTransfer({ tokenName: "Gary Token" }),
          tokenTransfer({
            contractAddress: "0xweth000000000000000000000000000000000000",
            tokenName: "Wrapped Ether",
            tokenSymbol: "WETH"
          })
        ];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xgary" ? receipt() : null;
      },
      async getTokenMetadata() {
        return null;
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: garyActor, pathAddresses: [garyActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: garyActor },
          destinationTxHash: "0xgary"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("no_name_token_liquidity");
    expect(result.report.partial).toBe(true);
    expect([
      ...result.report.coverageNotes,
      ...(result.report.paths[0]?.warnings ?? [])
    ].join(" ")).toMatch(/fallback.*token metadata|token metadata.*fallback/i);
  });

  it("Range + EVM Arbitrum Tornado funding -> tornado_or_mixer", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [{
          chain: "arbitrum",
          hash: "0xtornado",
          from: tornado,
          to: arbActor,
          value: "100000000000000000000",
          functionName: "Tornado.Cash withdrawal funding"
        } satisfies EvmTransaction];
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: arbActor, pathAddresses: [arbActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          source: { chain: "tron", chainId: "tron-mainnet", address: subjectTron },
          destination: { chain: "arbitrum", chainId: 42161, address: arbActor },
          destinationTxHash: "0xtornado"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("tornado_or_mixer");
    expect(result.extraSourcePolicyEvidence[0]?.kind).toBe("mixer");
    expect(result.extraHardBadEvidence).toEqual([]);
  });

  it("exact sanctioned detector -> extra hard evidence candidate", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: sanctioned, pathAddresses: [sanctioned, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({ destination: { chain: "ethereum", chainId: 1, address: sanctioned } })],
        riskSnapshots: [riskSnapshot()]
      }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("sanctioned_service");
    expect(result.extraRiskLayers[0]).toMatchObject({
      evidenceClass: "hard_proof",
      proofLevel: "exact_scam_or_taint_proof"
    });
    expect(result.extraHardBadEvidence).toEqual([
      expect.objectContaining({
        kind: "sanctioned_service",
        evidenceIds: ["cross_chain:local:ethereum:sanctioned:service_boundary"]
      })
    ]);
  });

  it("provider budget exhaustion -> partial but keeps found risk", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 1
    });

    expect(result.report.partial).toBe(true);
    expect(result.report.providerCalls).toBe(1);
    expect(result.report.coverageNotes.join(" ")).toContain("budget exhausted");
    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.extraSourcePolicyEvidence[0]?.kind).toBe("cross_chain_boundary");
  });

  it("marks partial when EVM token metadata is incomplete while keeping found bridge risk", async () => {
    const evm = emptyEvm({
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary-missing-metadata",
          from: garyActor,
          to: uniswapV3Npm,
          value: "0",
          functionName: "decreaseLiquidity(uint256 tokenId)"
        } satisfies EvmTransaction];
      },
      async listInternalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary-missing-metadata",
          from: uniswapV3Npm,
          to: garyActor,
          value: "247770000000000000000"
        } satisfies EvmInternalTransaction];
      },
      async listErc20Transfers() {
        return [tokenTransfer({
          hash: "0xgary-missing-metadata",
          contractAddress: "0xgary000000000000000000000000000000000000",
          tokenName: undefined,
          tokenSymbol: undefined,
          tokenDecimal: undefined
        })];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xgary-missing-metadata"
          ? receipt({ transactionHash: "0xgary-missing-metadata" })
          : null;
      },
      async getTokenMetadata() {
        return null;
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: garyActor, pathAddresses: [garyActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: garyActor },
          destinationTxHash: "0xgary-missing-metadata"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.extraSourcePolicyEvidence.some((evidence) => evidence.kind === "cross_chain_boundary")).toBe(true);
    expect(result.extraRiskLayers.some((layer) => layer.kind === "cross_chain_data_exhausted")).toBe(true);
    expect(result.report.partial).toBe(true);
    expect(result.report.coverageNotes.join(" ")).toMatch(/incomplete.*EVM.*token metadata/i);
  });

  it("adds a coverage note when a provider call fails after finding bridge risk", async () => {
    const failingProvider: CrossChainDiscoveryProvider = {
      async findTransfersByTx() {
        return [transfer()];
      },
      async findTransfersByAddress(query) {
        throw new Error(`Range unavailable for ${query.address}`);
      },
      async getAddressRisk() {
        return null;
      }
    };

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: failingProvider,
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.report.partial).toBe(true);
    expect(result.report.coverageNotes.join(" ")).toMatch(/provider.*transfers-by-address/i);
  });

  it("weak amount/time-only match -> never clean proof", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({
        sourceExposureKind: "unknown_contract",
        reasons: ["Only amount and nearby timestamp matched."]
      })],
      discoveryProvider: discovery({
        transfers: [transfer({
          protocol: "amount-time heuristic",
          labels: ["same amount within nearby time window"],
          evidenceRefs: [{
            id: "cross_chain:range:ethereum:weak:amount_time",
            provider: "range",
            payloadId: "range:tx:weak",
            confidence: "weak"
          }]
        })]
      }),
      evmProvider: emptyEvm(),
      maxProviderCalls: 10
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("none");
    expect(result.extraHardBadEvidence).toEqual([]);
    expect(result.extraRiskLayers.every((layer) => layer.proofLevel !== "exact_scam_or_taint_proof")).toBe(true);
    expect(result.extraSourcePolicyEvidence).toEqual([]);
  });

  it("manual case path contains asset-track switch notes", async () => {
    const provider = countingDiscovery(createFixtureCrossChainDiscoveryProvider(manualGaryStargateTornadoCase.data));
    const manualRoot = "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60";

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({
        reason: "manual_deep_mode",
        balanceTransferTxHashes: ["0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f"]
      }),
      subjectAddress: manualGaryStargateTornadoCase.subjectAddress,
      originPaths: [originPath({
        balanceTransferTxHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f",
        rootSourceAddress: manualRoot,
        pathAddresses: [manualRoot, manualGaryStargateTornadoCase.subjectAddress],
        txHashes: ["0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f"]
      })],
      discoveryProvider: provider,
      evmProvider: emptyEvm(),
      maxProviderCalls: 30
    });

    const pathText = [
      ...(result.report.paths[0]?.reasons ?? []),
      ...(result.report.paths[0]?.warnings ?? []),
      ...(result.report.paths[0]?.edges.flatMap((edge) => edge.labels) ?? [])
    ].join(" ");

    expect(pathText).toContain("asset-track switch");
    expect(pathText).toContain("USDT");
    expect(pathText).toContain("ETH/native");
    expect(provider.calls.some((call) => call.toLowerCase().includes(manualRoot.toLowerCase()))).toBe(true);
  });
});
