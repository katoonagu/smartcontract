import { describe, expect, it, vi } from "vitest";
import { runCrossChainCorridorAnalysis } from "../../src/forensics/crossChainCorridor";
import {
  createFixtureCrossChainDiscoveryProvider,
  type CrossChainDiscoveryProvider,
  type CrossChainTransfer,
  type ProviderRiskSnapshot
} from "../../src/forensics/crossChainProviders";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge
} from "../../src/forensics/crossChainContinuationTypes";
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
import {
  manualGaryAddresses,
  manualGaryStargateTornadoCase,
  manualGaryStargateTornadoEvm
} from "../fixtures/forensics/crossChainCases";

const subjectTron = "TSubject11111111111111111111111111111";
const subjectEth = "0x1111111111111111111111111111111111111111";
const bridgeEth = "0x2222222222222222222222222222222222222222";
const garyActor = "0x3333333333333333333333333333333333333333";
const arbActor = "0x4444444444444444444444444444444444444444";
const bscActor = "0x6666666666666666666666666666666666666666";
const bscCounterparty = "0x7777777777777777777777777777777777777777";
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

function continuationEdge(overrides: Partial<CrossChainContinuationEdge> = {}): CrossChainContinuationEdge {
  return {
    id: "continuation:candidate",
    edgeType: "token_transfer",
    source: { chain: "ethereum", chainId: 1, address: bridgeEth },
    destination: { chain: "ethereum", chainId: 1, address: garyActor },
    txHash: "0xcontinuation",
    amountRaw: "100000000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-05T03:00:00.000Z",
    protocol: null,
    evidenceRefs: [{
      id: "cross_chain:local:ethereum:0xcontinuation:token_transfer",
      provider: "local",
      payloadId: null,
      confidence: "weak"
    }],
    labels: [],
    continuationEvidenceClass: "weak_candidate",
    score: 25,
    reasons: [],
    ...overrides
  };
}

function continuationProvider(
  rowsByAddress: Record<string, CrossChainContinuationEdge[]>,
  chain = "ethereum"
): ChainContinuationProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    chain,
    calls,
    async listEdgesForAddress(input) {
      calls.push(input.address.address);
      return input.budget.run("local", `corridor-continuation:${input.address.address.toLowerCase()}`, async () =>
        rowsByAddress[input.address.address.toLowerCase()] ?? []
      );
    }
  };
}

function manualGaryEvm(overrides: Partial<EvmEvidenceProvider> = {}): EvmEvidenceProvider {
  return emptyEvm({
    async listNormalTransactions({ chain, address }) {
      return manualGaryStargateTornadoEvm.normalTransactions.filter((tx) =>
        tx.chain === chain &&
        [tx.from, tx.to].some((candidate) => candidate?.toLowerCase() === address.toLowerCase())
      );
    },
    async listInternalTransactions({ chain, address }) {
      return manualGaryStargateTornadoEvm.internalTransactions.filter((tx) =>
        tx.chain === chain &&
        [tx.from, tx.to].some((candidate) => candidate?.toLowerCase() === address.toLowerCase())
      );
    },
    async listErc20Transfers({ chain, address }) {
      return manualGaryStargateTornadoEvm.erc20Transfers.filter((tx) =>
        tx.chain === chain &&
        [tx.from, tx.to].some((candidate) => candidate?.toLowerCase() === address.toLowerCase())
      );
    },
    async getTransactionReceipt({ chain, txHash }) {
      return manualGaryStargateTornadoEvm.receipts.find((receipt) =>
        receipt.chain === chain && receipt.transactionHash?.toLowerCase() === txHash.toLowerCase()
      ) ?? null;
    },
    async getTokenMetadata({ chain, tokenContract }) {
      return manualGaryStargateTornadoEvm.tokenMetadata.find((token) =>
        token.chain === chain && token.tokenContract.toLowerCase() === tokenContract.toLowerCase()
      ) ?? null;
    },
    ...overrides
  });
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

  it("runs continuation only in manual mode after a bridge boundary", async () => {
    const provider = continuationProvider({
      [bridgeEth.toLowerCase()]: []
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "manual_deep_mode" }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [provider],
      maxProviderCalls: 20
    });

    expect(provider.calls).toEqual([bridgeEth]);
    expect(result.report.paths[0]?.continuation).toMatchObject({
      enabled: true,
      terminalBoundary: "data_exhausted",
      partial: true,
      seed: {
        chain: "ethereum",
        address: bridgeEth,
        txHash: "0xbridge",
        amountRaw: "100000000000",
        assetSymbol: "USDT",
        timestamp: "2026-05-05T02:41:59.000Z",
        labels: ["LayerZero", "Stargate"]
      }
    });
    expect(result.report.paths[0]?.continuation?.seed.timeWindow).toEqual({
      start: "2026-05-04T02:41:59.000Z",
      end: "2026-05-06T02:41:59.000Z"
    });
    expect(result.report.paths[0]?.continuation?.providerCalls).toBe(1);
    expect(result.report.providerCalls).toBeGreaterThan(provider.calls.length);
  });

  it("does not run continuation for automatic Stage 2 even when enabled", async () => {
    const provider = continuationProvider({
      [bridgeEth.toLowerCase()]: [continuationEdge()]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "large_single_boundary" }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [provider],
      maxProviderCalls: 20
    });

    expect(provider.calls).toEqual([]);
    expect(result.report.paths[0]?.continuation).toBeUndefined();
  });

  it("does not run continuation in automatic Stage 2 mode when disabled", async () => {
    const provider = continuationProvider({
      [bridgeEth.toLowerCase()]: [continuationEdge()]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: false,
      continuationProviders: [provider],
      maxProviderCalls: 20
    });

    expect(provider.calls).toEqual([]);
    expect(result.report.paths[0]?.continuation).toBeUndefined();
  });

  it("candidate-only continuation attaches without replacing the bridge boundary verdict", async () => {
    const provider = continuationProvider({
      [bridgeEth.toLowerCase()]: [continuationEdge({
        id: "continuation:candidate-only",
        continuationEvidenceClass: "strong_amount_time",
        score: 70
      })]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "manual_deep_mode" }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [provider],
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.continuation?.terminalBoundary).toBe("candidate_only");
    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.report.paths[0]?.riskLayer.kind).toBe("cross_chain_bridge_boundary");
    expect(result.report.paths[0]?.sourcePolicyEvidence?.kind).toBe("cross_chain_boundary");
    expect(result.extraHardBadEvidence).toEqual([]);
  });

  it("protocol-correlated Tornado continuation may promote the path terminal without hard sanctioned evidence", async () => {
    const tornadoEvidenceId = "cross_chain:local:ethereum:tornado-continuation:service_boundary";
    const provider = continuationProvider({
      [bridgeEth.toLowerCase()]: [continuationEdge({
        id: "continuation:tornado",
        edgeType: "tornado_withdrawal",
        destination: { chain: "ethereum", chainId: 1, address: tornado },
        protocol: "Tornado Cash",
        labels: ["mixer withdrawal"],
        evidenceRefs: [{
          id: tornadoEvidenceId,
          provider: "local",
          payloadId: null,
          confidence: "protocol_correlated"
        }],
        continuationEvidenceClass: "protocol_correlated",
        score: 95
      })]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "manual_deep_mode" }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [provider],
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.continuation?.terminalBoundary).toBe("tornado_or_mixer");
    expect(result.report.paths[0]?.terminalBoundary).toBe("tornado_or_mixer");
    expect(result.report.paths[0]?.riskLayer.kind).toBe("cross_chain_tornado_or_mixer");
    expect(result.report.paths[0]?.sourcePolicyEvidence).toMatchObject({
      kind: "mixer",
      evidenceIds: [tornadoEvidenceId]
    });
    expect(result.extraSourcePolicyEvidence[0]).toMatchObject({
      kind: "mixer",
      evidenceIds: [tornadoEvidenceId]
    });
    expect(result.extraHardBadEvidence).toEqual([]);
  });

  it("keeps accepted terminal evidence only when promoted continuation also reports weak terminal-looking edges", async () => {
    const acceptedEvidenceId = "cross_chain:local:ethereum:tornado-accepted:service_boundary";
    const weakEvidenceId = "cross_chain:local:ethereum:tornado-weak:service_boundary";
    const provider = continuationProvider({
      [bridgeEth.toLowerCase()]: [
        continuationEdge({
          id: "continuation:tornado-accepted",
          edgeType: "tornado_withdrawal",
          destination: { chain: "ethereum", chainId: 1, address: tornado },
          protocol: "Tornado Cash",
          evidenceRefs: [{
            id: acceptedEvidenceId,
            provider: "local",
            payloadId: null,
            confidence: "protocol_correlated"
          }],
          continuationEvidenceClass: "protocol_correlated",
          score: 95
        }),
        continuationEdge({
          id: "continuation:tornado-weak",
          edgeType: "tornado_withdrawal",
          destination: { chain: "ethereum", chainId: 1, address: tornado },
          protocol: "Tornado Cash",
          evidenceRefs: [{
            id: weakEvidenceId,
            provider: "local",
            payloadId: null,
            confidence: "weak"
          }],
          continuationEvidenceClass: "weak_candidate",
          score: 90
        })
      ]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "manual_deep_mode" }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [provider],
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.continuation?.edges.map((edge) => edge.id)).toContain("continuation:tornado-weak");
    expect(result.report.paths[0]?.terminalBoundary).toBe("tornado_or_mixer");
    expect(result.report.paths[0]?.sourcePolicyEvidence?.evidenceIds).toEqual([acceptedEvidenceId]);
    expect(result.extraSourcePolicyEvidence[0]?.evidenceIds).toEqual([acceptedEvidenceId]);
  });

  it("keeps stronger base sanctioned terminal when continuation ends at a weaker bridge boundary", async () => {
    const provider = continuationProvider({
      [sanctioned.toLowerCase()]: [continuationEdge({
        id: "continuation:weaker-bridge",
        edgeType: "bridge_protocol_link",
        source: { chain: "ethereum", chainId: 1, address: sanctioned },
        destination: { chain: "ethereum", chainId: 1, address: bridgeEth },
        protocol: "LayerZero/Stargate",
        evidenceRefs: [{
          id: "cross_chain:local:ethereum:weaker-bridge:bridge_boundary",
          provider: "local",
          payloadId: null,
          confidence: "protocol_correlated"
        }],
        continuationEvidenceClass: "protocol_correlated",
        score: 90
      })]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "manual_deep_mode" }),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: sanctioned, pathAddresses: [sanctioned, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({ destination: { chain: "ethereum", chainId: 1, address: sanctioned } })],
        riskSnapshots: [riskSnapshot()]
      }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [provider],
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.continuation?.terminalBoundary).toBe("bridge_boundary");
    expect(result.report.paths[0]?.terminalBoundary).toBe("sanctioned_service");
    expect(result.report.paths[0]?.riskLayer.kind).toBe("cross_chain_sanctioned_service");
    expect(result.report.paths[0]?.sourcePolicyEvidence).toBeNull();
    expect(result.extraHardBadEvidence).toEqual([
      expect.objectContaining({
        kind: "sanctioned_service",
        evidenceIds: ["cross_chain:local:ethereum:sanctioned:service_boundary"]
      })
    ]);
  });

  it("missing continuation provider attaches partial continuation without replacing bridge boundary", async () => {
    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({ reason: "manual_deep_mode" }),
      subjectAddress: subjectTron,
      originPaths: [originPath()],
      discoveryProvider: discovery({ transfers: [transfer()] }),
      evmProvider: emptyEvm(),
      continuationEnabled: true,
      continuationProviders: [],
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.continuation).toMatchObject({
      terminalBoundary: "data_exhausted",
      partial: true
    });
    expect(result.report.paths[0]?.terminalBoundary).toBe("bridge_boundary");
    expect(result.report.paths[0]?.riskLayer.kind).toBe("cross_chain_bridge_boundary");
    expect(result.report.coverageNotes.join(" ")).toContain("Bridge continuation provider is unavailable");
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
      maxProviderCalls: 60
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

  it("enriches Range BSC addresses with EVM-native BNB evidence", async () => {
    const evmCalls: string[] = [];
    const bscTxHash = "0xbscnative";
    const evm = emptyEvm({
      async getTransactionReceipt({ chain, txHash }) {
        evmCalls.push(`receipt:${chain}:${txHash}`);
        return null;
      },
      async listNormalTransactions({ chain, address }) {
        evmCalls.push(`normal:${chain}:${address}`);
        return [{
          chain: "bsc",
          hash: bscTxHash,
          from: bscCounterparty,
          to: address,
          value: "1000000000000000000"
        } satisfies EvmTransaction];
      },
      async listInternalTransactions({ chain, address }) {
        evmCalls.push(`internal:${chain}:${address}`);
        return [];
      },
      async listErc20Transfers({ chain, address }) {
        evmCalls.push(`erc20:${chain}:${address}`);
        return [];
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: bscActor, pathAddresses: [bscActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "bsc", chainId: 56, address: bscActor },
          destinationTxHash: bscTxHash
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 20
    });

    expect(evmCalls).toContain(`normal:bsc:${bscActor}`);
    expect(result.report.paths[0]?.edges).toContainEqual(expect.objectContaining({
      edgeType: "native_transfer",
      source: expect.objectContaining({ chain: "bsc", chainId: 56, address: bscCounterparty }),
      destination: expect.objectContaining({ chain: "bsc", chainId: 56, address: bscActor }),
      txHash: bscTxHash,
      assetSymbol: "BNB"
    }));
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
    const manualRoot = manualGaryAddresses.ethereumActor;

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger({
        reason: "manual_deep_mode",
        balanceTransferTxHashes: [manualGaryAddresses.rangeSourceTx]
      }),
      subjectAddress: manualGaryStargateTornadoCase.subjectAddress,
      originPaths: [originPath({
        balanceTransferTxHash: manualGaryAddresses.rangeSourceTx,
        rootSourceAddress: manualRoot,
        pathAddresses: [manualRoot, manualGaryStargateTornadoCase.subjectAddress],
        txHashes: [manualGaryAddresses.rangeSourceTx],
        steps: [{
          txHash: manualGaryAddresses.rangeSourceTx,
          fromAddress: manualRoot,
          toAddress: manualGaryStargateTornadoCase.subjectAddress,
          amountRaw: "100000000000",
          timestamp: "2026-05-05T02:41:59.000Z"
        }]
      })],
      discoveryProvider: provider,
      evmProvider: manualGaryEvm(),
      maxProviderCalls: 60
    });

    const pathText = [
      ...(result.report.paths[0]?.reasons ?? []),
      ...(result.report.paths[0]?.warnings ?? []),
      ...(result.report.paths[0]?.edges.flatMap((edge) => edge.labels) ?? [])
    ].join(" ");

    expect(pathText).toContain("asset-track switch");
    expect(pathText).toContain("USDT");
    expect(pathText).toContain("ETH/native");
    const firstPath = result.report.paths[0];
    const edgeTypes = firstPath?.edges.map((edge) => edge.edgeType) ?? [];

    expect(result.report.triggered).toBe(true);
    expect(result.report.partial).toBe(false);
    expect(firstPath?.terminalBoundary).toBe("no_name_token_liquidity");
    expect(firstPath?.riskLayer.proofLevel).toBe("exchange_policy_decline");
    expect(result.extraHardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(result.extraHardBadEvidence.map((item) => item.kind)).not.toContain("unknown_contract_boundary");
    expect(result.extraHardBadEvidence.map((item) => item.kind)).not.toContain("sanctioned_service");
    expect(edgeTypes).toEqual(expect.arrayContaining([
      "bridge_protocol_link",
      "native_transfer",
      "liquidity_remove",
      "unknown_token_liquidity",
      "tornado_withdrawal"
    ]));
    expect(firstPath?.edges.some((edge) =>
      edge.txHash === manualGaryAddresses.liquidityTx &&
      edge.labels.join(" ").includes("GARY")
    )).toBe(true);
    expect(firstPath?.edges.some((edge) =>
      edge.edgeType === "tornado_withdrawal" &&
      edge.txHash === manualGaryAddresses.tornado100Tx &&
      edge.amountRaw === "100000000000000000000"
    )).toBe(true);
    expect(firstPath?.edges.filter((edge) =>
      edge.edgeType === "bridge_protocol_link" &&
      edge.source?.address === manualGaryAddresses.arbitrumActor &&
      edge.destination?.address === manualGaryAddresses.ethereumActor
    ).map((edge) => edge.amountRaw)).toEqual(expect.arrayContaining([
      "247770000000000000000",
      "250000000000000000000"
    ]));
    expect(new Set(firstPath?.edges.map((edge) => edge.id)).size).toBe(firstPath?.edges.length);
    expect(provider.calls.some((call) => call.toLowerCase().includes(manualRoot.toLowerCase()))).toBe(true);
  });

  it("does not reuse an asset-scoped Range address cache for unscoped frontier continuation", async () => {
    const scopedAddress = "0xScope111111111111111111111111111111111111";
    const ethContinuation = "0xEth2222222222222222222222222222222222222";
    const provider = discovery({
      transfers: [
        transfer({
          id: "scoped-usdt-transfer",
          source: { chain: "ethereum", chainId: 1, address: scopedAddress },
          destination: { chain: "tron", chainId: "tron-mainnet", address: subjectTron },
          sourceTxHash: "0xscoped-usdt",
          destinationTxHash: "tx-range",
          assetSymbol: "USDT",
          amountRaw: "100000000000"
        }),
        transfer({
          id: "unscoped-eth-continuation",
          source: { chain: "ethereum", chainId: 1, address: ethContinuation },
          destination: { chain: "ethereum", chainId: 1, address: scopedAddress },
          sourceTxHash: "0xunscoped-eth",
          destinationTxHash: "0xunscoped-eth",
          assetSymbol: "ETH",
          amountRaw: "100000000000000000000",
          decimals: 18
        })
      ]
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({
        rootSourceAddress: scopedAddress,
        pathAddresses: [scopedAddress, subjectTron],
        exposureSourceLabel: "LayerZero/Stargate bridge USDT"
      })],
      discoveryProvider: provider,
      evmProvider: emptyEvm(),
      maxProviderCalls: 20
    });

    expect(result.report.paths[0]?.edges.some((edge) =>
      edge.id === "range:unscoped-eth-continuation" &&
      edge.assetSymbol === "ETH"
    )).toBe(true);
  });

  it("keeps distinct same-hash internal and ERC20 EVM events when deduping edges", async () => {
    const evm = emptyEvm({
      async listInternalTransactions() {
        return [
          {
            chain: "ethereum",
            hash: "0xsame",
            from: bridgeEth,
            to: garyActor,
            value: "11000000000000000000",
            traceId: "0"
          },
          {
            chain: "ethereum",
            hash: "0xsame",
            from: bridgeEth,
            to: garyActor,
            value: "12000000000000000000",
            traceId: "1"
          }
        ] satisfies EvmInternalTransaction[];
      },
      async listErc20Transfers() {
        return [
          tokenTransfer({
            hash: "0xsame",
            contractAddress: "0xgary000000000000000000000000000000000000",
            from: bridgeEth,
            to: garyActor,
            value: "1000000000000000000",
            transactionIndex: "0"
          }),
          tokenTransfer({
            hash: "0xsame",
            contractAddress: "0xgary000000000000000000000000000000000000",
            from: bridgeEth,
            to: garyActor,
            value: "1000000000000000000",
            transactionIndex: "0"
          })
        ];
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: garyActor, pathAddresses: [garyActor, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [transfer({
          destination: { chain: "ethereum", chainId: 1, address: garyActor },
          destinationTxHash: "0xsame"
        })]
      }),
      evmProvider: evm,
      maxProviderCalls: 20
    });

    const edges = result.report.paths[0]?.edges ?? [];
    expect(edges.filter((edge) => edge.edgeType === "internal_transfer" && edge.txHash === "0xsame")).toHaveLength(2);
    expect(edges.filter((edge) => edge.edgeType === "token_transfer" && edge.txHash === "0xsame")).toHaveLength(2);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
  });

  it("loads address-scoped EVM evidence for later addresses sharing the same tx hash", async () => {
    const sharedTx = "0xshared-liquidity";
    const firstAddress = bridgeEth;
    const secondAddress = garyActor;
    const evm = emptyEvm({
      async listNormalTransactions({ address }) {
        if (address.toLowerCase() !== secondAddress.toLowerCase()) return [];
        return [{
          chain: "ethereum",
          hash: sharedTx,
          from: secondAddress,
          to: uniswapV3Npm,
          value: "0",
          functionName: "decreaseLiquidity(uint256 tokenId)"
        } satisfies EvmTransaction];
      },
      async listInternalTransactions({ address }) {
        if (address.toLowerCase() !== secondAddress.toLowerCase()) return [];
        return [{
          chain: "ethereum",
          hash: sharedTx,
          from: uniswapV3Npm,
          to: secondAddress,
          value: "247770000000000000000"
        } satisfies EvmInternalTransaction];
      },
      async listErc20Transfers({ address }) {
        if (address.toLowerCase() !== secondAddress.toLowerCase()) return [];
        return [
          tokenTransfer({ hash: sharedTx, from: secondAddress, to: uniswapV3Npm }),
          tokenTransfer({
            hash: sharedTx,
            from: uniswapV3Npm,
            to: secondAddress,
            contractAddress: "0xweth000000000000000000000000000000000000",
            tokenSymbol: "WETH"
          })
        ];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === sharedTx ? receipt({ transactionHash: sharedTx }) : null;
      },
      async getTokenMetadata({ tokenContract }) {
        return tokenContract.includes("gary")
          ? metadata("GARY", tokenContract)
          : metadata("WETH", tokenContract);
      }
    });

    const result = await runCrossChainCorridorAnalysis({
      trigger: trigger(),
      subjectAddress: subjectTron,
      originPaths: [originPath({ rootSourceAddress: firstAddress, pathAddresses: [firstAddress, subjectTron] })],
      discoveryProvider: discovery({
        transfers: [
          transfer({
            source: { chain: "ethereum", chainId: 1, address: firstAddress },
            destination: { chain: "ethereum", chainId: 1, address: secondAddress },
            destinationTxHash: sharedTx
          })
        ]
      }),
      evmProvider: evm,
      maxProviderCalls: 30
    });

    expect(result.report.paths[0]?.terminalBoundary).toBe("no_name_token_liquidity");
    expect(result.report.paths[0]?.edges.some((edge) =>
      edge.edgeType === "unknown_token_liquidity" && edge.txHash === sharedTx
    )).toBe(true);
  });
});
