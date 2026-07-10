import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import { createContractLlmVerdictAnalyzer } from "../../src/forensics/contractLlmVerdict";
import { repairFundingSourceExactWindow } from "../../src/forensics/fundingFirstSourceProvenance";
import {
  createFixtureCrossChainDiscoveryProvider,
  type CrossChainDiscoveryProvider,
  type CrossChainTransfer,
  type FixtureCrossChainDiscoveryData,
  type ProviderRiskSnapshot
} from "../../src/forensics/crossChainProviders";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge
} from "../../src/forensics/crossChainContinuationTypes";
import type { ForensicJobProgressPatch } from "../../src/forensics/forensicJobProgress";
import type {
  EvmEvidenceProvider,
  EvmInternalTransaction,
  EvmLog,
  EvmTokenMetadata,
  EvmTokenTransfer,
  EvmTransaction,
  EvmTransactionReceipt
} from "../../src/forensics/evmExplorerClient";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel, ContractLlmVerdictSummary, ForensicRouteEdge, RiskReport, ServiceClassification, ServiceExposureProfile } from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";
import {
  manualGaryAddresses,
  manualGaryNoNameOnlyCase,
  manualGarySanctionedCase,
  manualGaryStargateTornadoCase,
  manualGaryStargateTornadoEvm
} from "../fixtures/forensics/crossChainCases";
import { regressionCases } from "../fixtures/forensics/regressionCases";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const cleanSender = "TCleanSender11111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const victim = "TVictim1111111111111111111111111111";
const spender = "TSpender111111111111111111111111111";
const operator = "TOperator111111111111111111111111111";
const wrapperContract = "TWrapper11111111111111111111111111";
const wrapperCloneContract = "TWrapper22222222222222222222222222";
const crossChainBridgeTron = "TStage2Bridge111111111111111111111";
const crossChainEthereumActor = "0x2222222222222222222222222222222222222222";
const crossChainGaryActor = "0x3333333333333333333333333333333333333333";
const crossChainSanctioned = "0x5555555555555555555555555555555555555555";
const crossChainUniswapV3Npm = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const crossChainDecreaseLiquidityTopic = "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";
const gasFreeController = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const gasFreeAccount = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const gasFreeUser = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const gasFreeReceiver = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const gasFreeTlnt = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";

const gasFreeUintWord = (value: bigint): string => value.toString(16).padStart(64, "0");
const gasFreeAddressWord = (address: string): string => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function gasFreePermitData(receiverAddress: string, value: bigint, maxFee: bigint): string {
  return [
    "6f21b898",
    gasFreeAddressWord(TRON_USDT_CONTRACT_ADDRESS),
    gasFreeAddressWord(gasFreeUser),
    gasFreeAddressWord(receiverAddress),
    gasFreeUintWord(value),
    gasFreeUintWord(maxFee),
    gasFreeUintWord(1_800_000_000n),
    gasFreeUintWord(1n),
    gasFreeUintWord(9n),
    gasFreeUintWord(0x120n),
    gasFreeUintWord(65n),
    "11".repeat(65).padEnd(192, "0")
  ].join("");
}

function gasFreeTransaction(receiverAddress = gasFreeReceiver) {
  const row = (toAddress: string, amountRaw: string) => ({
    from_address: gasFreeAccount,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    status: 0,
    tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenType: "trc20" }
  });
  const rows = [row(receiverAddress, "97000000"), row(gasFreeTlnt, "3000000")];
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: {
      contract_address: gasFreeController,
      data: gasFreePermitData(receiverAddress, 97_000_000n, 3_000_000n)
    },
    trc20TransferInfo: rows,
    tokenTransferInfo: rows.map((item) => ({ ...item }))
  };
}

function edge(
  id: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string,
  edgeType: ForensicRouteEdge["edgeType"] = "normal_transfer"
): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: edgeType === "transfer_from" ? "transferFrom" : "transfer",
    edgeType
  };
}

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

function traceableContract(identity: string): ServiceClassification {
  return {
    category: identity === "unknown" ? "unknown_contract" : "service",
    identity,
    confidence: "high",
    evidence: ["test:traceable_contract"],
    isBoundary: false
  };
}

function addressLabel(address: string, label: AddressLabel["label"]): AddressLabel {
  return {
    address,
    label,
    source: "system",
    createdByTelegramId: null,
    createdAt: new Date("2026-05-22T10:00:00.000Z")
  };
}

type RegressionCaseName = typeof regressionCases[number]["name"];

function expectRegressionReport(
  report: { userDecision: string; proofLevel: string },
  name: RegressionCaseName
): void {
  const caseItem = regressionCases.find((item) => item.name === name);
  expect(caseItem).toBeDefined();
  expect(report.userDecision).toBe(caseItem?.expectedDecision);
  expect(report.proofLevel).toBe(caseItem?.expectedProofLevel);
}

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "LOW",
  score: 0,
  reasons: []
};

function approval(overrides: Partial<TronscanApprovalChange> = {}): TronscanApprovalChange {
  return {
    txHash: "tx-approval",
    ownerAddress: victim,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "999999999999",
    isUnlimited: true,
    timestamp: new Date("2026-05-22T09:55:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

function crossChainTransfer(overrides: Partial<CrossChainTransfer> = {}): CrossChainTransfer {
  return {
    id: "range-tron-ethereum-usdt",
    protocol: "LayerZero/Stargate",
    source: {
      chain: "tron",
      chainId: "tron-mainnet",
      address: crossChainBridgeTron
    },
    destination: {
      chain: "ethereum",
      chainId: 1,
      address: crossChainEthereumActor
    },
    sourceTxHash: "tx-stage2-bridge-subject",
    destinationTxHash: "0xstage2",
    assetSymbol: "USDT",
    amountRaw: "100000000000",
    decimals: 6,
    timestamp: "2026-05-22T09:59:00.000Z",
    evidenceRefs: [{
      id: "cross_chain:range:ethereum:0xstage2:bridge_destination",
      provider: "range",
      payloadId: "range:tx:tx-stage2-bridge-subject",
      confidence: "provider_correlated"
    }],
    payloadRef: {
      id: "range:tx:tx-stage2-bridge-subject",
      provider: "range",
      endpoint: "transfers/by-tx",
      fetchedAt: "2026-06-01T00:00:00.000Z"
    },
    labels: ["LayerZero", "Stargate"],
    ...overrides
  };
}

function crossChainRiskSnapshot(overrides: Partial<ProviderRiskSnapshot> = {}): ProviderRiskSnapshot {
  return {
    address: {
      chain: "ethereum",
      chainId: 1,
      address: crossChainSanctioned
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

function crossChainContinuationEdge(overrides: Partial<CrossChainContinuationEdge> = {}): CrossChainContinuationEdge {
  return {
    id: "continuation:where-check-candidate",
    edgeType: "token_transfer",
    source: { chain: "ethereum", chainId: 1, address: crossChainEthereumActor },
    destination: { chain: "ethereum", chainId: 1, address: crossChainGaryActor },
    txHash: "0xwherecontinuation",
    amountRaw: "100000000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-22T10:30:00.000Z",
    protocol: null,
    evidenceRefs: [{
      id: "cross_chain:local:ethereum:0xwherecontinuation:token_transfer",
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

function countingContinuationProvider(
  rowsByAddress: Record<string, CrossChainContinuationEdge[]>
): ChainContinuationProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    chain: "ethereum",
    calls,
    async listEdgesForAddress(input) {
      calls.push(input.address.address);
      return input.budget.run("local", `where-check-continuation:${input.address.address.toLowerCase()}`, async () =>
        rowsByAddress[input.address.address.toLowerCase()] ?? []
      );
    }
  };
}

function countingDiscoveryProvider(data: {
  transfers?: readonly CrossChainTransfer[];
  riskSnapshots?: readonly ProviderRiskSnapshot[];
}): CrossChainDiscoveryProvider & { calls: string[] } {
  const provider = createFixtureCrossChainDiscoveryProvider({
    transfers: data.transfers ?? [],
    riskSnapshots: data.riskSnapshots ?? []
  });
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

function emptyEvmEvidenceProvider(overrides: Partial<EvmEvidenceProvider> = {}): EvmEvidenceProvider {
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

function manualGaryEvmEvidenceProvider(overrides: Partial<EvmEvidenceProvider> = {}): EvmEvidenceProvider {
  return emptyEvmEvidenceProvider({
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

function crossChainReceipt(overrides: Partial<EvmTransactionReceipt> = {}): EvmTransactionReceipt {
  return {
    chain: "ethereum",
    transactionHash: "0xgary",
    to: crossChainUniswapV3Npm,
    logs: [{
      chain: "ethereum",
      address: crossChainUniswapV3Npm,
      topics: [crossChainDecreaseLiquidityTopic],
      data: "0x",
      blockNumber: "22500000",
      transactionHash: "0xgary",
      logIndex: "0"
    } satisfies EvmLog],
    status: "1",
    ...overrides
  };
}

function crossChainTokenTransfer(overrides: Partial<EvmTokenTransfer> = {}): EvmTokenTransfer {
  return {
    chain: "ethereum",
    hash: "0xgary",
    from: crossChainGaryActor,
    to: crossChainUniswapV3Npm,
    contractAddress: "0xgary000000000000000000000000000000000000",
    value: "1000000000000000000",
    tokenSymbol: "GARY",
    tokenDecimal: "18",
    ...overrides
  };
}

function crossChainTokenMetadata(symbol: string, tokenContract = `0x${symbol.toLowerCase().padEnd(40, "0")}`): EvmTokenMetadata {
  return {
    chain: "ethereum",
    tokenContract,
    tokenName: `${symbol} token`,
    tokenSymbol: symbol,
    tokenDecimal: "18"
  };
}

function serviceExposureProfile(overrides: Partial<ServiceExposureProfile> = {}): ServiceExposureProfile {
  return {
    subjectAddress: subject,
    totalOutgoingRaw: "200000000000",
    totalOutgoingCount: 4,
    directServiceVolumeRatio: 0.75,
    directServiceTxRatio: 0.5,
    indirectServiceVolumeRatio: 0,
    indirectServiceTxRatio: 0,
    mergedServiceVolumeRatio: 0,
    mergedServiceGroupCount: 0,
    combinedServiceVolumeRatio: 0.75,
    combinedServiceTxRatio: 0.5,
    dominantCategory: "bridge",
    categoryBreakdown: [
      { category: "bridge", volumeRaw: "150000000000", txCount: 2, volumeRatio: 0.75 }
    ],
    topServiceCounterparties: [],
    topMergedServiceFlows: [],
    fastestServiceExitMs: null,
    bestAmountPreservationRatio: null,
    exposureScore: 75,
    features: [],
    ...overrides
  };
}

function stage2BridgeByAddress(input: {
  subjectAddress?: string;
  amountRaw?: string;
  includeRecentFlowAnchor?: boolean;
} = {}): Map<string, ForensicRouteEdge[]> {
  const stage2Subject = input.subjectAddress ?? subject;
  const amountRaw = input.amountRaw ?? "100000000000";
  const sourceEdges = [
    edge("tx-stage2-bridge-subject", crossChainBridgeTron, stage2Subject, amountRaw, "2026-05-22T10:00:00.000Z")
  ];
  if (input.includeRecentFlowAnchor) {
    sourceEdges.push(edge("tx-stage2-anchor-out", stage2Subject, "TStage2Receiver1111111111111111111", amountRaw, "2026-05-22T10:30:00.000Z"));
  }
  return new Map<string, ForensicRouteEdge[]>([
    [stage2Subject, sourceEdges],
    [crossChainBridgeTron, []]
  ]);
}

function manualGaryBridgeByAddress(): Map<string, ForensicRouteEdge[]> {
  return new Map<string, ForensicRouteEdge[]>([
    [
      manualGaryStargateTornadoCase.subjectAddress,
      [
        edge(
          manualGaryAddresses.rangeSourceTx,
          manualGaryAddresses.ethereumActor,
          manualGaryStargateTornadoCase.subjectAddress,
          "100000000000",
          "2026-05-05T02:41:59.000Z"
        )
      ]
    ],
    [manualGaryAddresses.ethereumActor, []]
  ]);
}

function manualGaryDeps(input: {
  data: FixtureCrossChainDiscoveryData;
  evmProvider?: EvmEvidenceProvider;
}) {
  const byAddress = manualGaryBridgeByAddress();
  const tronBridge = byAddress.get(manualGaryStargateTornadoCase.subjectAddress)?.[0]?.fromAddress;
  return {
    getTrc20Balance: async () => "100000000000",
    fetchEdgesForAddress: async (address: string) => byAddress.get(address) ?? [],
    getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
    getClassificationForAddress: async (address: string) => {
      if (address === tronBridge) return service("bridge", "LayerZero/Stargate");
      return service("none", null);
    },
    getFastWalletRisk: async () => lowFastRisk,
    crossChainDiscoveryProvider: countingDiscoveryProvider(input.data),
    evmEvidenceProvider: input.evmProvider ?? manualGaryEvmEvidenceProvider()
  };
}

describe("runWhereIsMoneyCheck", () => {
  it("keeps an exact GasFree account on the path and reaches its upstream Binance funder", async () => {
    const principalTxHash = "tx-exact-gasfree-principal";
    const getTransaction = vi.fn(async (txHash: string) =>
      txHash === principalTxHash ? gasFreeTransaction() : null
    );
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "97000000",
      fetchEdgesForAddress: async (address) => address === gasFreeAccount
        ? [edge("tx-binance-gasfree-funding", binance, gasFreeAccount, "100000000", "2026-07-10T00:00:00.000Z")]
        : [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === gasFreeAccount) return service("unknown_contract", "GasFree Account");
        return service("none", null);
      },
      getTransaction
    }, {
      mode: "transaction_check",
      subjectAddress: gasFreeReceiver,
      requestedAmountRaw: "97000000",
      seedTransfers: [{
        txHash: principalTxHash,
        fromAddress: gasFreeAccount,
        toAddress: gasFreeReceiver,
        amountRaw: "97000000",
        timestamp: "2026-07-10T00:05:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_requested_amount"
      }],
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      windowEnd: new Date("2026-07-10T01:00:00.000Z"),
      approvalEnrichmentMode: "off",
      maxContractTransactionInfoFetches: 0
    });

    expect(report.originPaths[0]).toMatchObject({
      pathAddresses: [binance, gasFreeAccount, gasFreeReceiver],
      stoppedReason: "allowlist_cex_reached",
      rootSourceAddress: binance
    });
    expect(getTransaction.mock.calls.filter(([txHash]) => txHash === principalTxHash)).toHaveLength(1);
  });

  it("reports an exact GasFree fee without risky payer share", async () => {
    const feeTxHash = "tx-exact-gasfree-fee";
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "3000000",
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === gasFreeAccount
        ? service("unknown_contract", "GasFree Account")
        : service("none", null),
      getTransaction: async (txHash) => txHash === feeTxHash ? gasFreeTransaction() : null
    }, {
      mode: "transaction_check",
      subjectAddress: gasFreeTlnt,
      requestedAmountRaw: "3000000",
      seedTransfers: [{
        txHash: feeTxHash,
        fromAddress: gasFreeAccount,
        toAddress: gasFreeTlnt,
        amountRaw: "3000000",
        timestamp: "2026-07-10T00:05:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_requested_amount"
      }],
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      windowEnd: new Date("2026-07-10T01:00:00.000Z"),
      approvalEnrichmentMode: "off",
      maxContractTransactionInfoFetches: 0
    });

    expect(report.originPaths[0]).toMatchObject({
      verdict: "REVIEW",
      stoppedReason: "service_boundary",
      riskScoreContribution: 0,
      pathAddresses: [gasFreeAccount, gasFreeTlnt]
    });
    expect(report.originPaths[0]?.reasons.join(" ")).toContain("GasFree service-fee");
    expect(report.sourceBundleExposure?.riskyLabelShare).toBe(0);
    expect(report.decision).toBe("REVIEW");
    expect(report.riskScore).toBe(0);
  });

  it("keeps an active sanctioned-service classification authoritative over an exact GasFree fee", async () => {
    const feeTxHash = "tx-sanctioned-gasfree-fee";
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "3000000",
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === gasFreeAccount
        ? service("cex", "HTX/Huobi Global")
        : service("none", null),
      getTransaction: async (txHash) => txHash === feeTxHash ? gasFreeTransaction() : null
    }, {
      mode: "transaction_check",
      subjectAddress: gasFreeTlnt,
      requestedAmountRaw: "3000000",
      seedTransfers: [{
        txHash: feeTxHash,
        fromAddress: gasFreeAccount,
        toAddress: gasFreeTlnt,
        amountRaw: "3000000",
        timestamp: "2026-07-10T00:05:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_requested_amount"
      }],
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      windowEnd: new Date("2026-07-10T01:00:00.000Z"),
      approvalEnrichmentMode: "off",
      maxContractTransactionInfoFetches: 0
    });

    expect(report.originPaths[0]).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      sourceExposureKind: "sanctioned_service"
    });
    expect(report.originPaths[0]?.reasons.join(" ")).toContain("sanctioned crypto service");
  });

  it("does not apply the canonical GasFree account override to a case-mismatched Base58 address", async () => {
    const feeTxHash = "tx-case-mismatched-gasfree-fee";
    const caseMismatchedAccount = gasFreeAccount.replace("R", "r");
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "3000000",
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === caseMismatchedAccount
        ? service("unknown_contract", "Case-mismatched account")
        : service("none", null),
      getTransaction: async (txHash) => txHash === feeTxHash ? gasFreeTransaction() : null
    }, {
      mode: "transaction_check",
      subjectAddress: gasFreeTlnt,
      requestedAmountRaw: "3000000",
      seedTransfers: [{
        txHash: feeTxHash,
        fromAddress: caseMismatchedAccount,
        toAddress: gasFreeTlnt,
        amountRaw: "3000000",
        timestamp: "2026-07-10T00:05:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_requested_amount"
      }],
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      windowEnd: new Date("2026-07-10T01:00:00.000Z"),
      approvalEnrichmentMode: "off",
      maxContractTransactionInfoFetches: 0
    });

    expect(report.originPaths[0]).toMatchObject({
      rootSourceAddress: caseMismatchedAccount,
      stoppedReason: "unlabeled_service_boundary"
    });
    expect(report.originPaths[0]?.reasons.join(" ")).not.toContain("GasFree service-fee");
  });

  it("leaves a transaction unresolved when GasFree transaction lookup fails", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "3000000",
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getTransaction: async () => {
        throw new Error("provider unavailable");
      }
    }, {
      mode: "transaction_check",
      subjectAddress: gasFreeTlnt,
      requestedAmountRaw: "3000000",
      seedTransfers: [{
        txHash: "tx-unavailable-gasfree-context",
        fromAddress: gasFreeAccount,
        toAddress: gasFreeTlnt,
        amountRaw: "3000000",
        timestamp: "2026-07-10T00:05:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_requested_amount"
      }],
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      windowEnd: new Date("2026-07-10T01:00:00.000Z"),
      approvalEnrichmentMode: "off",
      maxContractTransactionInfoFetches: 0
    });

    expect(report.originPaths[0]?.stoppedReason).not.toBe("service_boundary");
    expect(report.originPaths[0]?.reasons.join(" ")).not.toContain("GasFree service-fee");
  });

  it("does not describe an unmatched ordinary TLnt transfer as a GasFree fee", async () => {
    const txHash = "tx-ordinary-unmatched-tlnt";
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "4000000",
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getTransaction: async (requestedTxHash) => requestedTxHash === txHash ? gasFreeTransaction() : null
    }, {
      mode: "transaction_check",
      subjectAddress: gasFreeTlnt,
      requestedAmountRaw: "4000000",
      seedTransfers: [{
        txHash,
        fromAddress: gasFreeAccount,
        toAddress: gasFreeTlnt,
        amountRaw: "4000000",
        timestamp: "2026-07-10T00:05:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_requested_amount"
      }],
      windowStart: new Date("2026-07-09T00:00:00.000Z"),
      windowEnd: new Date("2026-07-10T01:00:00.000Z"),
      approvalEnrichmentMode: "off",
      maxContractTransactionInfoFetches: 0
    });

    expect(report.originPaths[0]?.reasons.join(" ")).not.toContain("GasFree service-fee");
    expect(report.originPaths[0]?.stoppedReason).not.toBe("service_boundary");
  });

  it("accepts a TEY-like operational liquidity wallet without source boundary proof", async () => {
    const senderA = "TLiquiditySenderA111111111111111111";
    const senderB = "TLiquiditySenderB111111111111111111";
    const funderA1 = "TLiquidityFunderA111111111111111111";
    const funderA2 = "TLiquidityFunderA222222222222222222";
    const funderB1 = "TLiquidityFunderB111111111111111111";
    const funderB2 = "TLiquidityFunderB222222222222222222";
    const sinkA1 = "TLiquiditySinkA11111111111111111111";
    const sinkA2 = "TLiquiditySinkA22222222222222222222";
    const sinkB1 = "TLiquiditySinkB11111111111111111111";
    const sinkB2 = "TLiquiditySinkB22222222222222222222";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-liq-a-subject", senderA, subject, "100000000", "2026-05-22T10:00:00.000Z"),
          edge("tx-liq-b-subject", senderB, subject, "100000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [
        senderA,
        [
          edge("tx-a-in-1", funderA1, senderA, "90000000", "2026-05-20T08:00:00.000Z"),
          edge("tx-a-in-2", funderA2, senderA, "80000000", "2026-05-20T09:00:00.000Z"),
          edge("tx-a-in-3", funderA1, senderA, "70000000", "2026-05-21T08:00:00.000Z"),
          edge("tx-a-in-4", funderA2, senderA, "65000000", "2026-05-21T09:00:00.000Z"),
          edge("tx-a-out-1", senderA, sinkA1, "70000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-a-out-2", senderA, sinkA2, "60000000", "2026-05-20T11:00:00.000Z"),
          edge("tx-a-out-3", senderA, sinkA1, "50000000", "2026-05-21T10:00:00.000Z"),
          edge("tx-a-out-4", senderA, sinkA2, "25000000", "2026-05-21T11:00:00.000Z"),
          edge("tx-liq-a-subject", senderA, subject, "100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [
        senderB,
        [
          edge("tx-b-in-1", funderB1, senderB, "95000000", "2026-05-20T08:30:00.000Z"),
          edge("tx-b-in-2", funderB2, senderB, "85000000", "2026-05-20T09:30:00.000Z"),
          edge("tx-b-in-3", funderB1, senderB, "75000000", "2026-05-21T08:30:00.000Z"),
          edge("tx-b-in-4", funderB2, senderB, "55000000", "2026-05-21T09:30:00.000Z"),
          edge("tx-b-out-1", senderB, sinkB1, "75000000", "2026-05-20T10:30:00.000Z"),
          edge("tx-b-out-2", senderB, sinkB2, "65000000", "2026-05-20T11:30:00.000Z"),
          edge("tx-b-out-3", senderB, sinkB1, "45000000", "2026-05-21T10:30:00.000Z"),
          edge("tx-b-out-4", senderB, sinkB2, "25000000", "2026-05-21T11:30:00.000Z"),
          edge("tx-liq-b-subject", senderB, subject, "100000000", "2026-05-22T10:05:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "200000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "200000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.userDecision).toBe("ACCEPTABLE");
    expect(report.assessment).toMatchObject({
      walletRole: "operational_liquidity_wallet",
      hardBadEvidence: [],
      riskBand: "LOW-MEDIUM"
    });
    expect(report.riskScore).toBeGreaterThanOrEqual(25);
    expect(report.riskScore).toBeLessThanOrEqual(40);
    expect(report.decisionReasons.join(" ")).toContain("operational/liquidity wallet");
  });

  it("uses seeded transaction transfer instead of reselecting balance-forming transfers", async () => {
    const calls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-other", oldSender, subject, "9000000000", "2026-05-22T11:00:00.000Z")]],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "1000000000", "2026-05-22T09:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "9000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      mode: "transaction_check",
      subjectAddress: subject,
      requestedAmountRaw: "1000000000",
      seedTransfers: [{
        txHash: "tx-seed",
        fromAddress: cleanSender,
        toAddress: subject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:00:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_current_balance"
      }],
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-seed"]);
    expect(report.coverage.requestedAmountRaw).toBe("1000000000");
    expect(report.coverage.selectedAmountRaw).toBe("1000000000");
    expect(calls).not.toContain(subject);
    expect(report.originPaths).toEqual([
      expect.objectContaining({ balanceTransferTxHash: "tx-seed", verdict: "ACCEPTABLE" })
    ]);
    expectRegressionReport(report, "Binance through clean EOA is acceptable");
  });

  it("keeps deferred trace edge cache target-specific for same-address same-timestamp hops", async () => {
    const sharedSender = "TSharedSenderSameTs111111111111111";
    const hopTimestamp = "2026-05-22T10:00:00.000Z";
    const fetchCalls: Array<{
      address: string;
      targetTxHash: string | null;
      expectedAmountRaw: string | null;
    }> = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "300000000",
      fetchEdgesForAddress: async (address, options) => {
        fetchCalls.push({
          address,
          targetTxHash: options?.targetEdge?.txHash ?? null,
          expectedAmountRaw: options?.expectedAmountRaw ?? null
        });
        const amountRaw = options?.expectedAmountRaw ?? "0";
        const targetEdge = options?.targetEdge ?? edge("tx-fallback", sharedSender, subject, amountRaw, hopTimestamp);
        return [
          targetEdge,
          edge(`fund-${targetEdge.txHash}`, binance, sharedSender, amountRaw, "2026-05-22T09:00:00.000Z")
        ];
      },
      requestCandidateWindows: async () => true,
      ensureBroadTargetedHistory: async () => true,
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      mode: "transaction_check",
      subjectAddress: subject,
      requestedAmountRaw: "300000000",
      seedTransfers: [
        {
          txHash: "tx-same-ts-one",
          fromAddress: sharedSender,
          toAddress: subject,
          amountRaw: "100000000",
          timestamp: hopTimestamp,
          coverageShare: 1 / 3,
          selectedReason: "covers_current_balance"
        },
        {
          txHash: "tx-same-ts-two",
          fromAddress: sharedSender,
          toAddress: subject,
          amountRaw: "200000000",
          timestamp: hopTimestamp,
          coverageShare: 2 / 3,
          selectedReason: "covers_current_balance"
        }
      ],
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(fetchCalls.filter((call) => call.address === sharedSender && call.targetTxHash !== null)).toEqual([
      { address: sharedSender, targetTxHash: "tx-same-ts-one", expectedAmountRaw: "100000000" },
      { address: sharedSender, targetTxHash: "tx-same-ts-two", expectedAmountRaw: "200000000" }
    ]);
    expect(report.originPaths.map((path) => path.balanceTransferTxHash)).toEqual([
      "tx-same-ts-one",
      "tx-same-ts-two"
    ]);
  });

  it("uses recent-flow provenance for low-balance wallets with a meaningful outgoing anchor", async () => {
    const lowBalanceSubject = "TSubjectLowBalance11111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("in-a", "TFunderA", lowBalanceSubject, "50000000000", "2026-05-05T08:00:00.000Z"),
          edge("in-b", "TFunderB", lowBalanceSubject, "40000000000", "2026-05-05T08:10:00.000Z"),
          edge("out-anchor", lowBalanceSubject, "TReceiver", "89473150000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.anchorTransfer?.txHash).toBe("out-anchor");
    expect(report.coverage.notes.join(" ")).toContain("recent-flow provenance");
    expect(report.balanceFormingTransfers.map((item) => item.txHash)).toEqual(["in-b", "in-a"]);
  });

  it("reports drain episode scope for a low-balance bridge/adapter drain", async () => {
    const lowBalanceSubject = "TLhV";
    const bridgeA = "TPwez";
    const bridgeB = "TUrnbc";
    const fastRisk: RiskReport = {
      subjectAddress: lowBalanceSubject,
      level: "LOW",
      score: 17,
      reasons: []
    };
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("in-1885k", "TUU1", lowBalanceSubject, "1885262475832", "2026-05-05T13:31:30.000Z"),
          edge("out-200k-a", lowBalanceSubject, bridgeA, "199994920000", "2026-05-05T13:57:27.000Z"),
          edge("out-200k-b", lowBalanceSubject, bridgeA, "199994920000", "2026-05-05T13:58:45.000Z"),
          edge("out-200k-c", lowBalanceSubject, bridgeB, "200007090000", "2026-05-05T14:23:18.000Z"),
          edge("anchor-135k", lowBalanceSubject, bridgeA, "135300000000", "2026-05-05T15:00:30.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if ([bridgeA.toLowerCase(), bridgeB.toLowerCase()].includes(address.toLowerCase())) {
          return service("bridge", "Bridge Adapter");
        }
        return service("none", null);
      },
      getFastWalletRisk: async () => fastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.coverage.drainEpisode).toMatchObject({
      episodeOutgoingRaw: "735296930000",
      bridgeOutgoingShare: 1,
      outgoingTxHashes: ["out-200k-a", "out-200k-b", "out-200k-c", "anchor-135k"]
    });
    expect(report.coverage.checkedScope).toBe("drain_episode");
    expect(report.coverage.anchorCoverageRatio).toBe(report.coverage.coverageRatio);
    expect(report.coverage.episodeCoverageRatio).not.toBeNull();
    expect(report.layerSummary?.whereIsMoney.checkedScope).toBe("drain_episode");
    expect(report.layerSummary?.fastCheck.score).toBe(17);
  });

  it("reports zero episode coverage when selected anchor provenance is not covered", async () => {
    const lowBalanceSubject = "TDrainZeroCoverage11111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("zero-coverage-in", "TDrainFunder", lowBalanceSubject, "1000000000000", "2026-05-05T13:00:00.000Z"),
          edge("zero-coverage-spend", lowBalanceSubject, "TDrainSpend", "1000000000000", "2026-05-05T13:30:00.000Z"),
          edge("zero-coverage-anchor", lowBalanceSubject, "TDrainAnchorDest", "500000000000", "2026-05-05T15:00:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      approvalEnrichmentMode: "off"
    });

    expect(report.coverage.drainEpisode).toMatchObject({
      episodeOutgoingRaw: "1500000000000",
      episodeSelectedRaw: "0",
      episodeCoverageRatio: 0,
      outgoingTxHashes: ["zero-coverage-spend", "zero-coverage-anchor"]
    });
    expect(report.coverage.selectedAmountRaw).toBe("0");
    expect(report.coverage.anchorCoverageRatio).toBe(0);
    expect(report.coverage.episodeCoverageRatio).toBe(0);
  });

  it("uses selected funding transfer as the drain episode boundary", async () => {
    const lowBalanceSubject = "TDrainSelectedFunding111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("selected-funding", "TDrainFunder", lowBalanceSubject, "800000000000", "2026-05-05T13:00:00.000Z"),
          edge("burst-out", lowBalanceSubject, "TDrainBurstDest", "200000000000", "2026-05-05T13:30:00.000Z"),
          edge("unrelated-later-large-in", "TUnrelatedFunder", lowBalanceSubject, "2000000000000", "2026-05-05T14:00:00.000Z"),
          edge("unrelated-large-spend", lowBalanceSubject, "TUnrelatedSpend", "2000000000000", "2026-05-05T14:10:00.000Z"),
          edge("selected-boundary-anchor", lowBalanceSubject, "TDrainAnchorDest", "135300000000", "2026-05-05T15:00:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      approvalEnrichmentMode: "off"
    });

    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["selected-funding"]);
    expect(report.coverage.drainEpisode).toMatchObject({
      fundingTxHash: "selected-funding",
      outgoingTxHashes: ["burst-out", "unrelated-large-spend", "selected-boundary-anchor"]
    });
  });

  it("bounds drain episode service destination classification candidates", async () => {
    const lowBalanceSubject = "TDrainCapSubject111111111111111";
    const drainDestinationPrefix = "TDrainCapDest";
    const classificationCalls: string[] = [];
    const outgoingEdges = Array.from({ length: 30 }, (_, index) => {
      const minute = String(index).padStart(2, "0");
      const amountRaw = (1_000_000_000_000n - BigInt(index) * 1_000_000n).toString();
      return edge(
        `drain-cap-out-${index}`,
        lowBalanceSubject,
        `${drainDestinationPrefix}${minute}`,
        amountRaw,
        `2026-05-05T14:${minute}:00.000Z`
      );
    });
    const anchorEdge = edge("drain-cap-anchor", lowBalanceSubject, `${drainDestinationPrefix}Anchor`, "900000000000", "2026-05-05T15:00:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("drain-cap-in", "TDrainCapFunder", lowBalanceSubject, "31000000000000", "2026-05-05T13:30:00.000Z"),
          ...outgoingEdges,
          anchorEdge
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        classificationCalls.push(address);
        if (address.toLowerCase().startsWith(drainDestinationPrefix.toLowerCase())) return service("bridge", "Bridge");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      approvalEnrichmentMode: "off"
    });

    const cappedBridgeOutgoingRaw = outgoingEdges
      .slice(0, 12)
      .reduce((sum, edge) => sum + BigInt(edge.amountRaw), 0n)
      .toString();
    const uncappedBridgeOutgoingRaw = [...outgoingEdges, anchorEdge]
      .reduce((sum, edge) => sum + BigInt(edge.amountRaw), 0n)
      .toString();
    const drainDestinationClassifications = classificationCalls.filter((address) =>
      address.toLowerCase().startsWith(drainDestinationPrefix.toLowerCase())
    );
    expect(drainDestinationClassifications.length).toBeLessThanOrEqual(12);
    expect(report.coverage.drainEpisode?.bridgeOutgoingRaw).toBe(cappedBridgeOutgoingRaw);
    expect(report.coverage.drainEpisode?.bridgeOutgoingRaw).not.toBe(uncappedBridgeOutgoingRaw);
  });

  it("uses recent-flow provenance for wallet_profile low-balance sender after outgoing transfer", async () => {
    const lowBalanceSender = "TWalletProfileLowBalanceSender111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSender,
        [
          edge("wallet-profile-in-a", "TFunderA", lowBalanceSender, "50000000000", "2026-05-05T08:00:00.000Z"),
          edge("wallet-profile-in-b", "TFunderB", lowBalanceSender, "40000000000", "2026-05-05T08:10:00.000Z"),
          edge("wallet-profile-out-anchor", lowBalanceSender, "TReceiver", "89000000000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "0",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSender,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      mode: "wallet_profile"
    });

    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.anchorTransfer?.txHash).toBe("wallet-profile-out-anchor");
    expect(report.coverage.notes.join(" ")).toContain("Recent-flow approximation");
    expect(report.assessment.reasons.join(" ")).not.toContain("balance-origin mode is not applicable");
    expect(report.balanceFormingTransfers.map((item) => item.txHash)).toEqual([
      "wallet-profile-in-b",
      "wallet-profile-in-a"
    ]);
  });

  it("preserves recent-flow anchor for wallet_profile zero-balance sender without prior funding candidates", async () => {
    const lowBalanceSender = "TWalletProfileAnchorOnly1111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSender,
        [
          edge("wallet-profile-anchor-only", lowBalanceSender, "TReceiver", "10000000000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "0",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSender,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      mode: "wallet_profile"
    });

    expect(report.balanceFormingTransfers).toEqual([]);
    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.anchorTransfer?.txHash).toBe("wallet-profile-anchor-only");
    expect(report.coverage.dataScopeNote).toContain("latest meaningful outgoing");
    expect(report.assessment.reasons.join(" ")).not.toContain("balance-origin mode is not applicable");
  });

  it("uses recent-flow for wallet_profile zero-balance sender when requestedAmountRaw is zero", async () => {
    const lowBalanceSender = "TWalletProfileZeroRequested1111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSender,
        [
          edge("wallet-profile-zero-requested-in", "TFunderA", lowBalanceSender, "10000000000", "2026-05-05T08:00:00.000Z"),
          edge("wallet-profile-zero-requested-out", lowBalanceSender, "TReceiver", "10000000000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "0",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSender,
      requestedAmountRaw: "0",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      mode: "wallet_profile"
    });

    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.anchorTransfer?.txHash).toBe("wallet-profile-zero-requested-out");
    expect(report.assessment.reasons.join(" ")).not.toContain("balance-origin mode is not applicable");
  });

  it("keeps high-balance wallet_profile on current-balance provenance instead of recent-flow", async () => {
    const highBalanceSubject = "TWalletProfileHighBalance1111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        highBalanceSubject,
        [
          edge("high-balance-in", "TFunderA", highBalanceSubject, "2000000000", "2026-05-05T08:00:00.000Z"),
          edge("high-balance-out", highBalanceSubject, "TReceiver", "10000000000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: highBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      mode: "wallet_profile"
    });

    expect(report.coverage.provenanceScope).toBe("current_balance");
    expect(report.coverage.anchorTransfer).toBeNull();
    expect(report.balanceFormingTransfers.map((item) => item.txHash)).toEqual(["high-balance-in"]);
  });

  it("does not report a historical large transfer as current-balance coverage for low-balance wallets", async () => {
    const lowBalanceSubject = "TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("historical-in", "TFG4wBaDQ8sHWWP1ACeSGnoNR6RRzevLPt", lowBalanceSubject, "89473150000", "2026-05-05T08:49:27.000Z"),
          edge("later-out", lowBalanceSubject, "TReceiver", "89473000000", "2026-05-05T09:05:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.currentBalanceCoverageRatio).toBe(0);
    expect(report.coverage.notes.join(" ")).toContain("Recent-flow approximation");
    expect(report.coverage.notes.join(" ")).toContain("rather than current balance origin");
  });

  it("preserves recent-flow metadata when low-balance wallets have only dust inbound history", async () => {
    const lowBalanceSubject = "TSubjectDustOnly111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("dust-a", "TFunderA", lowBalanceSubject, "1000000", "2026-05-05T08:00:00.000Z"),
          edge("dust-b", "TFunderB", lowBalanceSubject, "2000000", "2026-05-05T08:10:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.balanceFormingTransfers).toEqual([]);
    expect(report.coverage).toMatchObject({
      selectedInboundTxCount: 0,
      provenanceScope: "recent_flow",
      checkedScope: "recent_flow",
      drainEpisode: null,
      anchorTransfer: null,
      lowBalanceThresholdRaw: "1000000000",
      currentBalanceCoverageRatio: 0,
      fetchedAddressCount: 1,
      partial: true
    });
    expect(report.coverage.anchorCoverageRatio).toBe(report.coverage.coverageRatio);
    expect(report.coverage.episodeCoverageRatio).toBeNull();
    expect(report.layerSummary?.whereIsMoney.checkedScope).toBe("recent_flow");
    expect(report.coverage.dataScopeNote).toContain("no meaningful recent USDT flow");
    expect(report.coverage.notes.join(" ")).toContain("no meaningful recent USDT flow");
  });

  it("preserves recent-flow outgoing anchor metadata when no prior funding candidates are found", async () => {
    const lowBalanceSubject = "TSubjectAnchorNoFunding111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("out-anchor", lowBalanceSubject, "TReceiver", "10000000000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.balanceFormingTransfers).toEqual([]);
    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.anchorTransfer).toMatchObject({
      txHash: "out-anchor",
      direction: "outgoing",
      reason: "latest_meaningful_outgoing"
    });
    expect(report.coverage.targetAmountRaw).toBe("10000000000");
    expect(report.coverage.checkedScope).toBe("selected_anchor");
    expect(report.coverage.drainEpisode).toBeNull();
    expect(report.coverage.anchorCoverageRatio).toBe(report.coverage.coverageRatio);
    expect(report.coverage.episodeCoverageRatio).toBeNull();
    expect(report.layerSummary?.whereIsMoney.checkedScope).toBe("selected_anchor");
    expect(report.coverage.dataScopeNote).toContain("latest meaningful outgoing");
  });

  it("keeps requested-amount mode even when current balance is low", async () => {
    const requestedSubject = "TSubjectRequested111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        requestedSubject,
        [edge("in-a", "TFunderA", requestedSubject, "2000000000", "2026-05-05T08:00:00.000Z")]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: requestedSubject,
      requestedAmountRaw: "1000000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.coverage.provenanceScope).toBe("requested_amount");
    expect(report.coverage.anchorTransfer).toBeNull();
  });

  it("declines HTX through a clean EOA as an exchange policy case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")]],
      [cleanSender, [edge("tx-htx-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "HTX") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths[0]).toMatchObject({
      balanceTransferTxHash: "tx-clean-subject",
      pathAddresses: [binance, cleanSender, subject],
      verdict: "DECLINE"
    });
    expect(report.proofLevel).toMatch(/^exchange_policy_/);
    expect(report.assessment.hardBadEvidence).toEqual([]);
    expectRegressionReport(report, "HTX through clean EOA is high policy decline");
  });

  it("propagates runtime history coverage into origin tracing", async () => {
    const shallowWallet = "TShallowWallet11111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [edge("tx-shallow-subject", shallowWallet, subject, "2000000000", "2026-05-22T10:15:00.000Z")]
      ],
      [shallowWallet, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-05-24T00:00:00.000Z",
        fetchedTransferCount: 50,
        oldestFetchedTransferAt: "2026-05-23T00:00:00.000Z",
        reachedTargetHop: false,
        source: "live"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths.some((path) => path.stoppedReason === "incoming_history_not_fetched")).toBe(true);
  });

  it("requests candidate windows before broad targeted fallback for probable funding provenance", async () => {
    const hopAddress = "THop111111111111111111111111111111";
    const candidateFunder = "TFunder111111111111111111111111111";
    const hop = edge("hop-tx-1", hopAddress, subject, "100000000", "2026-07-04T12:00:00.000Z");
    const funding = edge("candidate-tx-1", candidateFunder, hopAddress, "100000000", "2026-07-04T11:59:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [hop]],
      [hopAddress, [funding, hop]]
    ]);
    const candidateWindows: unknown[] = [];
    const broadTargets: unknown[] = [];

    await expect(runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: 2,
        oldestFetchedTransferAt: "2026-07-04T11:59:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: false,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        throw new Error("targeted_history_waiting_for_index");
      },
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "100000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:01:00.000Z")
    })).rejects.toThrow("targeted_history_waiting_for_index");

    expect(candidateWindows).toHaveLength(1);
    expect(candidateWindows[0]).toMatchObject({
      address: hopAddress,
      candidateTxHash: "candidate-tx-1",
      relatedHopTxHash: "hop-tx-1"
    });
    expect(broadTargets).toEqual([]);
  });

  it("stops at known service boundary before candidate windows or broad fallback", async () => {
    const serviceHopAddress = "TBybitHop111111111111111111111111";
    const hop = edge("hop-tx-boundary", serviceHopAddress, subject, "100000000", "2026-07-04T12:00:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [hop]],
      [serviceHopAddress, [hop]]
    ]);
    const candidateWindows: unknown[] = [];
    const broadTargets: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: 1,
        oldestFetchedTransferAt: "2026-07-04T12:00:00.000Z",
        reachedTargetHop: false,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: true,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) =>
        address === serviceHopAddress
          ? service("cex", "Bybit")
          : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        return true;
      },
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "100000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:01:00.000Z")
    });

    expect(report.originPaths.some((path) => path.rootSourceType === "allowlist_cex")).toBe(true);
    expect(candidateWindows).toEqual([]);
    expect(broadTargets).toEqual([]);
  });

  it("does not queue broad fallback after candidate windows for below-materiality unresolved provenance", async () => {
    const hopAddress = "THopSmall111111111111111111111111111";
    const candidateFunder = "TFunderSmall11111111111111111111111";
    const largeSender = "TLargeSender111111111111111111111111";
    const hop = edge("hop-tx-small", hopAddress, subject, "500000", "2026-07-04T12:00:00.000Z");
    const large = edge("hop-tx-large", largeSender, subject, "99500000", "2026-07-04T11:00:00.000Z");
    const funding = edge("candidate-tx-small", candidateFunder, hopAddress, "500000", "2026-07-04T11:59:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [large, hop]],
      [largeSender, [edge("tx-binance-large", binance, largeSender, "99500000", "2026-07-04T10:30:00.000Z")]],
      [hopAddress, [funding, hop]]
    ]);
    const candidateWindows: unknown[] = [];
    const broadTargets: unknown[] = [];
    let repairCalled = false;

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: 2,
        oldestFetchedTransferAt: "2026-07-04T11:59:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: true,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) =>
        address === largeSender || address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        return true;
      },
      repairSourceProvenanceWindow: async (input) => {
        repairCalled = true;
        return repairFundingSourceExactWindow({
          target: input.target,
          windowEdges: [hop],
          windowCoverage: {
            complete: false,
            capped: true,
            statusReason: "partial_provider_cap",
            fetchedTransferCount: 1,
            oldestFetchedTransferAt: hop.timestamp.toISOString(),
            source: "local_index"
          },
          downstreamAmountRaw: input.downstreamAmountRaw,
          minCoverageRatio: input.minCoverageRatio,
          maxFunders: input.maxFunders
        });
      },
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "100000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:01:00.000Z"),
      maxDepth: 3,
      beamWidth: 4
    });

    expect(report.originPaths.find((path) => path.balanceTransferTxHash === "hop-tx-small")?.stoppedReason)
      .toBe("funding_first_unresolved");
    expect(repairCalled).toBe(true);
    expect(report.scoreValid).not.toBe(false);
    expect(report.sourceProvenanceMateriality).toMatchObject({
      outcome: "residual_unresolved_below_materiality"
    });
    expect(candidateWindows).toEqual([
      expect.objectContaining({
        address: hopAddress,
        candidateTxHash: "candidate-tx-small",
        relatedHopTxHash: "hop-tx-small"
      })
    ]);
    expect(broadTargets).toEqual([]);
  });

  it("allows broad targeted fallback after candidate windows leave material unresolved provenance", async () => {
    const hopAddress = "THop222222222222222222222222222222";
    const candidateFunder = "TFunder222222222222222222222222222";
    const hop = edge("hop-tx-2", hopAddress, subject, "100000000", "2026-07-04T12:00:00.000Z");
    const funding = edge("candidate-tx-2", candidateFunder, hopAddress, "100000000", "2026-07-04T11:59:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [hop]],
      [hopAddress, [funding, hop]]
    ]);
    const candidateWindows: unknown[] = [];
    const broadTargets: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: 2,
        oldestFetchedTransferAt: "2026-07-04T11:59:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: false,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        return true;
      },
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "100000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:01:00.000Z")
    });

    expect(report.originPaths[0]?.stoppedReason).toBe("incoming_history_not_fetched");
    expect(candidateWindows).toHaveLength(1);
    expect(broadTargets).toEqual([]);
  });

  it("does not queue ordinary broad fallback after candidate windows when unresolved amount exceeds the raw materiality cap", async () => {
    const hopAddress = "THopRawMaterial11111111111111111111";
    const candidateFunder = "TFunderRawMaterial111111111111111";
    const largeSender = "TLargeRawMaterial11111111111111111";
    const hop = edge("hop-tx-raw-material", hopAddress, subject, "5000000000", "2026-07-04T12:00:00.000Z");
    const large = edge("hop-tx-raw-large", largeSender, subject, "995000000000", "2026-07-04T11:00:00.000Z");
    const funding = edge("candidate-tx-raw-material", candidateFunder, hopAddress, "5000000000", "2026-07-04T11:59:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [large, hop]],
      [largeSender, [edge("tx-binance-raw-large", binance, largeSender, "995000000000", "2026-07-04T10:30:00.000Z")]],
      [hopAddress, [funding, hop]]
    ]);
    const candidateWindows: unknown[] = [];
    const broadTargets: unknown[] = [];

    await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: 2,
        oldestFetchedTransferAt: "2026-07-04T11:59:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: true,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) =>
        address === largeSender || address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        return true;
      },
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:01:00.000Z"),
      maxDepth: 3,
      beamWidth: 4
    });

    expect(candidateWindows).toEqual([
      expect.objectContaining({
        address: hopAddress,
        candidateTxHash: "candidate-tx-raw-material",
        relatedHopTxHash: "hop-tx-raw-material"
      })
    ]);
    expect(broadTargets).toEqual([]);
  });

  it("does not queue ordinary broad fallback after aggregate unresolved source provenance exceeds materiality", async () => {
    const cleanSender = "TCleanAggregate1111111111111111111";
    const unresolvedOne = "TAggregateOne111111111111111111111";
    const unresolvedTwo = "TAggregateTwo111111111111111111111";
    const unresolvedThree = "TAggregateThree111111111111111111";
    const funderOne = "TAggregateFunderOne11111111111111";
    const funderTwo = "TAggregateFunderTwo11111111111111";
    const funderThree = "TAggregateFunderThree111111111111";
    const clean = edge("tx-clean-aggregate", cleanSender, subject, "97600000", "2026-07-04T12:10:00.000Z");
    const hopOne = edge("tx-aggregate-one", unresolvedOne, subject, "800000", "2026-07-04T12:05:00.000Z");
    const hopTwo = edge("tx-aggregate-two", unresolvedTwo, subject, "800000", "2026-07-04T12:00:00.000Z");
    const hopThree = edge("tx-aggregate-three", unresolvedThree, subject, "800000", "2026-07-04T11:55:00.000Z");
    const fundingOne = edge("candidate-aggregate-one", funderOne, unresolvedOne, "800000", "2026-07-04T12:04:00.000Z");
    const fundingTwo = edge("candidate-aggregate-two", funderTwo, unresolvedTwo, "800000", "2026-07-04T11:59:00.000Z");
    const fundingThree = edge("candidate-aggregate-three", funderThree, unresolvedThree, "800000", "2026-07-04T11:54:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [clean, hopOne, hopTwo, hopThree]],
      [cleanSender, [edge("tx-binance-aggregate", binance, cleanSender, "97600000", "2026-07-04T12:09:00.000Z")]],
      [unresolvedOne, [fundingOne, hopOne]],
      [unresolvedTwo, [fundingTwo, hopTwo]],
      [unresolvedThree, [fundingThree, hopThree]]
    ]);
    const candidateWindows: unknown[] = [];
    const broadTargets: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:00:00.000Z",
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-07-04T11:59:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: true,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) =>
        address === cleanSender || address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      requestCandidateWindows: async (requests) => {
        candidateWindows.push(...requests);
        return true;
      },
      repairSourceProvenanceWindow: async (input) => {
        const target = input.target.txHash === "tx-aggregate-one"
          ? hopOne
          : input.target.txHash === "tx-aggregate-two"
            ? hopTwo
            : hopThree;
        const repaired = repairFundingSourceExactWindow({
          target: input.target,
          windowEdges: [target],
          windowCoverage: {
            complete: false,
            capped: true,
            statusReason: "partial_provider_cap",
            fetchedTransferCount: 1,
            oldestFetchedTransferAt: target.timestamp.toISOString(),
            source: "local_index"
          },
          downstreamAmountRaw: input.downstreamAmountRaw,
          minCoverageRatio: input.minCoverageRatio,
          maxFunders: input.maxFunders
        });
        return {
          ...repaired,
          provenance: {
            ...repaired.provenance,
            reasons: [...repaired.provenance.reasons, "dense_hop_provider_cap"]
          }
        };
      },
      ensureBroadTargetedHistory: async () => {
        throw new Error("aggregate broad fallback should use batch ensure");
      },
      ensureBroadTargetedHistories: async (requests) => {
        broadTargets.push(...requests);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "100000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:11:00.000Z"),
      maxDepth: 3,
      beamWidth: 4
    });

    expect(report.sourceProvenanceMateriality).toMatchObject({
      outcome: "aggregate_unresolved_above_materiality",
      unresolvedPathCount: 3
    });
    expect(candidateWindows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: unresolvedOne,
        candidateTxHash: "candidate-aggregate-one",
        relatedHopTxHash: "tx-aggregate-one"
      }),
      expect.objectContaining({
        address: unresolvedTwo,
        candidateTxHash: "candidate-aggregate-two",
        relatedHopTxHash: "tx-aggregate-two"
      }),
      expect.objectContaining({
        address: unresolvedThree,
        candidateTxHash: "candidate-aggregate-three",
        relatedHopTxHash: "tx-aggregate-three"
      })
    ]));
    expect(broadTargets).toEqual([]);
  });

  it("queues broad fallback when unresolved source provenance intersects approval-drain hard evidence", async () => {
    const cleanSender = "TCleanHardEvidence11111111111111111";
    const hardEvidenceFunder = "THardEvidenceFunder1111111111111";
    const clean = edge("tx-clean-hard-evidence", cleanSender, subject, "199500000", "2026-07-04T12:10:00.000Z");
    const drain = edge("tx-hard-evidence-drain", victim, subject, "500000", "2026-07-04T12:05:00.000Z", "transfer_from");
    const funding = edge("candidate-hard-evidence", hardEvidenceFunder, victim, "500000", "2026-07-04T12:04:00.000Z");
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [clean, drain]],
      [cleanSender, [edge("tx-binance-hard-evidence", binance, cleanSender, "199500000", "2026-07-04T12:09:00.000Z")]],
      [victim, [funding, drain]]
    ]);
    const broadTargets: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "200000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getHistoryCoverageForAddress: async (address, options) => ({
        address,
        targetTimestamp: options.latestTimestamp?.toISOString() ?? "2026-07-04T12:05:00.000Z",
        fetchedTransferCount: byAddress.get(address)?.length ?? 0,
        oldestFetchedTransferAt: "2026-07-04T12:04:30.000Z",
        reachedTargetHop: true,
        source: "local_index",
        coverageComplete: false,
        providerCapHit: true,
        budgetExhausted: true,
        providerInconsistent: false,
        statusReason: "partial_budget_exhausted"
      }),
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) =>
        address === cleanSender || address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender, trigger_info: { methodName: "transferFrom" } }),
      listTrc20ApprovalChanges: async () => [
        approval({
          txHash: "tx-hard-evidence-approval",
          ownerAddress: victim,
          spenderAddress: spender,
          amountRaw: "500000"
        })
      ],
      requestCandidateWindows: async () => true,
      repairSourceProvenanceWindow: async (input) => repairFundingSourceExactWindow({
        target: input.target,
        windowEdges: [drain],
        windowCoverage: {
          complete: false,
          capped: true,
          statusReason: "partial_provider_cap",
          fetchedTransferCount: 1,
          oldestFetchedTransferAt: drain.timestamp.toISOString(),
          source: "local_index"
        },
        downstreamAmountRaw: input.downstreamAmountRaw,
        minCoverageRatio: input.minCoverageRatio,
        maxFunders: input.maxFunders
      }),
      ensureBroadTargetedHistory: async (input) => {
        broadTargets.push(input);
        return true;
      }
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "200000000",
      windowStart: new Date("2026-07-04T00:00:00.000Z"),
      windowEnd: new Date("2026-07-04T12:11:00.000Z"),
      maxDepth: 3,
      beamWidth: 4,
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
    expect(report.sourceProvenanceMateriality).toMatchObject({
      outcome: "unresolved_source_with_hard_evidence",
      hardEvidenceInUnresolved: true
    });
    expect(broadTargets).toEqual([
      {
        address: victim,
        targetTimestamp: new Date("2026-07-04T12:05:00.000Z"),
        queuedReason: "where_is_money_hop",
        reason: "hard_evidence_requires_full_coverage"
      }
    ]);
  });

  it("keeps a small WhiteBIT balance share as exchange policy context rather than taint proof", async () => {
    const trustedSender = "TTrustedSender111111111111111111111";
    const whitebitSender = "TWhitebitSender11111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-trusted-subject", trustedSender, subject, "9000000000", "2026-05-22T10:15:00.000Z"),
          edge("tx-whitebit-subject", whitebitSender, subject, "1000000000", "2026-05-22T10:20:00.000Z")
        ]
      ],
      [trustedSender, [edge("tx-binance-trusted", binance, trustedSender, "9000000000", "2026-05-22T10:00:00.000Z")]],
      [whitebitSender, [edge("tx-whitebit-sender", bridge, whitebitSender, "1000000000", "2026-05-22T10:05:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "10000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === bridge) return service("cex", "WhiteBIT");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ balanceTransferTxHash: "tx-whitebit-subject", verdict: "REVIEW" }),
      expect.objectContaining({ balanceTransferTxHash: "tx-trusted-subject", verdict: "ACCEPTABLE" })
    ]));
    expect(report.decisionReasons.join(" ")).toContain("WhiteBIT");
    expect(report.decisionReasons.join(" ")).toContain("not direct scam/blacklist proof");
    expect(report.assessment.hardBadEvidence).toEqual([]);
    expect(report.assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "whitebit",
        proofLevel: "exchange_policy_context"
      })
    ]));
    expect(report.assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "whitebit",
      proofLevel: "exchange_policy_context"
    }));
    expectRegressionReport(report, "WhiteBIT small share is medium policy decline");
  });

  it("traces only balance-forming inbound transfers and ignores older unrelated inflows", async () => {
    const calls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-old", oldSender, subject, "20000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-bridge-subject", bridge, subject, "3000000000", "2026-05-22T10:10:00.000Z"),
          edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")
        ]
      ],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]],
      [oldSender, [edge("tx-binance-old", binance, oldSender, "20000000000", "2026-05-20T09:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === bridge) return service("bridge", "Allbridge");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.currentUsdtBalanceRaw).toBe("5000000000");
    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-clean-subject", "tx-bridge-subject"]);
    expect(calls).not.toContain(oldSender);
    expect(report.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ balanceTransferTxHash: "tx-clean-subject", verdict: "ACCEPTABLE" }),
      expect.objectContaining({ balanceTransferTxHash: "tx-bridge-subject", verdict: "DECLINE" })
    ]));
    expect(report.originPaths.find((path) => path.balanceTransferTxHash === "tx-clean-subject")?.steps).toEqual([
      expect.objectContaining({ txHash: "tx-binance-clean", amountRaw: "2000000000" }),
      expect.objectContaining({ txHash: "tx-clean-subject", amountRaw: "2000000000" })
    ]);
    expect(report.senderInteractionProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        balanceTransferTxHash: "tx-clean-subject",
        senderAddress: cleanSender,
        incomingTxCount: 1,
        outgoingTxCount: 0,
        fundingCandidates: [
          expect.objectContaining({ txHash: "tx-binance-clean", amountPreservationRatio: 1 })
        ]
      }),
      expect.objectContaining({
        balanceTransferTxHash: "tx-bridge-subject",
        senderAddress: bridge,
        incomingTxCount: 0,
        outgoingTxCount: 0,
        fundingCandidates: []
      })
    ]));
    expect(report.subjectExposureProfile).toMatchObject({
      subjectAddress: subject,
      transferEventsScanned: 3
    });
    expect(report.subjectExposureProfile?.incomingVolumeRaw).toBe("25000000000");
    const bridgePolicyEvidence = report.assessment.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(bridgePolicyEvidence?.shareDetail).toMatchObject({
      targetAmountRaw: "5000000000",
      affectedAmountRaw: "3000000000",
      rawShare: 0.6,
      effectiveShare: 0.75,
      finalContribution: 58
    });
    expect(report.decision).toBe("REVIEW");
    expect(report.riskScore).toBe(58);
    expect(report.coverage).toMatchObject({
      selectedInboundTxCount: 2,
      selectedInboundVolumeRaw: "5000000000",
      currentBalanceCoverageRatio: 1,
      partial: false
    });
  });

  it("keeps non-allowlisted CEX out of clean subject exposure", async () => {
    const whitebit = "TWhitebit111111111111111111111111111";
    const htx = "THTX111111111111111111111111111111";
    const cleanSource = "TCleanSource111111111111111111111111";
    const unknownContract = "TUnknownHop222222222222222222222222";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-whitebit-subject", whitebit, subject, "700000000", "2026-05-22T10:10:00.000Z"),
          edge("tx-htx-subject", htx, subject, "300000000", "2026-05-22T10:15:00.000Z"),
          edge("tx-clean-subject", cleanSource, subject, "1", "2026-05-22T10:20:00.000Z"),
          edge("tx-unknown-history", unknownContract, subject, "100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [whitebit, [edge("tx-whitebit-loop", whitebit, whitebit, "700000000", "2026-05-22T10:00:00.000Z")]],
      [htx, [edge("tx-htx-loop", htx, htx, "300000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSource, [edge("tx-binance-clean", binance, cleanSource, "1", "2026-05-22T10:15:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000001",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === whitebit) return service("cex", "WhiteBIT");
        if (address === htx) return service("cex", "HTX");
        if (address === binance) return service("cex", "Binance");
        if (address === unknownContract) return traceableContract("unknown");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({}),
      listTrc20ApprovalChanges: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 2,
      beamWidth: 4,
      maxAddressFetches: 20,
      maxEdgesPerAddress: 20,
      approvalEnrichmentMode: "always"
    });

    expect(report.subjectExposureProfile?.incomingVolumeRaw).toBe("1100000001");
    expect(report.subjectExposureProfile?.cleanCexIncomingShare).toBe(0);
    expect(report.subjectExposureProfile?.unknownContractVolumeShare).toBe(0);
    expect(report.subjectExposureProfile?.unknownSourceShare).toBeCloseTo(800000000 / 1100000001);
    expect(report.subjectExposureProfile?.htxHuobiIncomingShare).toBeCloseTo(300000000 / 1100000001);
  });

  it("classifies direct historical HTX source-edge counterparties with approval enrichment off", async () => {
    const htx = "TDirectHtx11111111111111111111111111";
    const cleanSelectedSender = "TCleanSelected11111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-htx-history", htx, subject, "300000000", "2026-05-22T10:00:00.000Z"),
          edge("tx-clean-current", cleanSelectedSender, subject, "1000000000", "2026-05-22T10:15:00.000Z")
        ]
      ],
      [cleanSelectedSender, [edge("tx-binance-clean", binance, cleanSelectedSender, "1000000000", "2026-05-22T10:05:00.000Z")]]
    ]);
    const classifiedAddresses: string[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        classifiedAddresses.push(address);
        if (address === htx) return service("cex", "HTX");
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 2,
      beamWidth: 4,
      maxAddressFetches: 20,
      maxEdgesPerAddress: 20,
      approvalEnrichmentMode: "off"
    });

    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-clean-current"]);
    expect(classifiedAddresses).toContain(htx);
    expect(report.subjectExposureProfile?.incomingVolumeRaw).toBe("1300000000");
    expect(report.subjectExposureProfile?.htxHuobiIncomingShare).toBeCloseTo(300000000 / 1300000000);
  });

  it("traces only latest balance-forming transfers needed to cover the requested amount", async () => {
    const calls: string[] = [];
    const senderA = "TSenderA111111111111111111111111111";
    const senderB = "TSenderB111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-old-large", oldSender, subject, "4000000000", "2026-05-22T10:00:00.000Z"),
          edge("tx-older-700", senderA, subject, "700000000", "2026-05-22T10:05:00.000Z"),
          edge("tx-newer-700", senderB, subject, "700000000", "2026-05-22T10:10:00.000Z")
        ]
      ],
      [senderA, [edge("tx-binance-a", binance, senderA, "700000000", "2026-05-22T09:50:00.000Z")]],
      [senderB, [edge("tx-binance-b", binance, senderB, "700000000", "2026-05-22T09:55:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-newer-700", "tx-older-700"]);
    expect(calls).not.toContain(oldSender);
    expect(report.coverage).toMatchObject({
      currentBalanceRaw: "5000000000",
      requestedAmountRaw: "1000000000",
      targetAmountRaw: "1000000000",
      selectedAmountRaw: "1400000000",
      selectedInboundVolumeRaw: "1400000000",
      partial: false
    });
    expect(report.coverage.coverageRatio).toBeGreaterThanOrEqual(1);
    expect(report.coverage.notes[0]).toContain("requested amount");
  });

  it("attaches requested-amount source bundle exposure for selected HTX and clean sources", async () => {
    const htxSender = "THtxSender11111111111111111111111111";
    const cleanSelectedSender = "TCleanSelected11111111111111111111";
    const htx = "THTX111111111111111111111111111111";
    const cleanCex = "TCleanCex111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-htx-selected", htxSender, subject, "700000000", "2026-05-22T10:10:00.000Z"),
          edge("tx-clean-selected", cleanSelectedSender, subject, "300000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [htxSender, [edge("tx-htx-root", htx, htxSender, "700000000", "2026-05-22T09:55:00.000Z")]],
      [cleanSelectedSender, [edge("tx-clean-root", cleanCex, cleanSelectedSender, "300000000", "2026-05-22T09:50:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === htx) return service("cex", "HTX");
        if (address === cleanCex) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      approvalEnrichmentMode: "off"
    });

    expect(report.sourceBundleExposure).toMatchObject({
      scope: "where_requested_amount",
      targetAmountRaw: "1000000000",
      dominantSource: "htx_huobi",
      coveredAmountRaw: "1000000000"
    });
    expect(report.sourceBundleExposure?.htxHuobiShare).toBeCloseTo(0.7);
    expect(report.sourceBundleExposure?.cleanCexShare).toBeCloseTo(0.3);
    expect(report.sourceBundleExposure?.coverageRatio).toBeCloseTo(1);
    expect(report.riskScore).toBeGreaterThanOrEqual(85);
    expect(report.decision).toBe("DECLINE");
  });

  it("maps fast wallet exact critical declines to exact scam or taint proof", async () => {
    const exactFastRisk: RiskReport = {
      subjectAddress: subject,
      level: "CRITICAL",
      score: 90,
      reasons: [
        {
          code: "stablecoin_usdt_blacklisted",
          message: "Official TRON USDT contract blacklist state is active for this address.",
          scoreImpact: 90,
          source: "stablecoin_contract",
          confidence: "high",
          severity: "critical"
        }
      ]
    };
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")]],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => exactFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.internalDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exact_scam_or_taint_proof");
    expect(report.decisionReasons[0]).toContain("critical score");
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("fast_critical");
  });

  it("maps risky-label origin path declines to exact scam or taint proof", async () => {
    const scamSeed = "TScamSeed11111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-sender-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")]],
      [cleanSender, [edge("tx-scam-sender", scamSeed, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]],
      [scamSeed, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address): Promise<AddressLabel[]> => address === scamSeed ? [addressLabel(scamSeed, "scam")] : [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exact_scam_or_taint_proof");
    expect(report.decisionReasons).toEqual(expect.arrayContaining([
      expect.stringContaining("high-risk label scam")
    ]));
  });

  it("declines when balance-forming funds are exact approval-drain transferFrom proceeds", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-transferfrom-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z", "transfer_from")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2576000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender }),
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-22T10:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(95);
    expect(report.decisionReasons[0]).toContain("Exact approval-drain provenance");
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
    expect(report.approvalDrainProvenanceProfiles).toEqual([
      expect.objectContaining({
        victimAddress: victim,
        spenderAddress: spender,
        drainTxHash: "tx-transferfrom-drain",
        hopDepth: 0,
        score: 90,
        evidenceStrength: "exact_approval_and_transfer_from"
      })
    ]);
  });

  it("uses contract intelligence to keep verified router swaps out of exact approval-drain proof", async () => {
    const router = "TRouter11111111111111111111111111111";
    const outputToken = "TOutput111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [
        router,
        [
          edge("tx-router-swap", victim, router, "1000000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === router) return service("router", "SunSwap Router");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({
        ownerAddress: router,
        contractAddress: TRON_USDT_CONTRACT_ADDRESS,
        trigger_info: {
          methodName: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
        },
        trc20TransferInfo: [
          {
            from_address: victim,
            to_address: router,
            quant: "1000000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          },
          {
            from_address: router,
            to_address: victim,
            quant: "250000000000000000",
            contract_address: outputToken,
            tokenInfo: { tokenAbbr: "SUN", tokenId: outputToken, tokenType: "trc20" }
          }
        ]
      }),
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000000"
        })
      ],
      getContractIntelligenceProfile: async (address) => address === router
        ? {
            contractAddress: router,
            isVerified: true,
            serviceTag: "SunSwap Router",
            topMethods: [{ methodId: "0x", signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            methodMap: {},
            rawPayload: {}
          }
        : null
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.approvalDrainReviewFindings).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-router-swap",
        reason: "service_boundary_guard",
        falsePositiveGuards: [
          expect.objectContaining({
            code: "service_boundary_route",
            address: router,
            category: "router",
            identity: "SunSwap Router"
          })
        ]
      })
    ]);
    expect(report.originPaths[0]).toMatchObject({
      rootSourceAddress: router,
      stoppedReason: "decline_boundary_reached",
      verdict: "DECLINE"
    });
    expect(report.decisionReasons).not.toEqual(expect.arrayContaining([
      expect.stringContaining("exact approval-drain transferFrom")
    ]));
    expectRegressionReport(report, "Known DEX router approval with output is guarded, not drainer proof");
  });

  it("declines TFagr-style wrapper drains even when the visible method is not transferFrom", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          {
            ...edge("tx-wrapper-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z"),
            method: "Verify20"
          }
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2576000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {
            ownerAddress: cleanSender,
            contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
            trigger_info: { methodName: "transfer" }
          },
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "999999999999"
        })
      ],
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-22T10:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(95);
    expect(report.approvalDrainProvenanceProfiles[0]).toMatchObject({
      spenderAddress: wrapperContract,
      operatorAddress: operator,
      spenderResolution: "wrapper_contract",
      score: 90
    });
    expectRegressionReport(report, "Wrapper transferFrom path to checked wallet is exact approval-drain decline");
  });

  it("produces contract-driven receiver and transfer profiles for Verify20 incoming funds", async () => {
    const secondVictim = "TVictim2222222222222222222222222222";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          { ...edge("tx-wrapper-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z"), method: "Verify20" },
          { ...edge("tx-wrapper-drain-2", secondVictim, subject, "1200000000", "2026-05-22T10:01:00.000Z"), method: "Verify20" }
        ]
      ],
      [victim, []],
      [secondVictim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "3776000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => ({
        ownerAddress: operator,
        contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
        trigger_info: { methodName: "Verify20" },
        trc20TransferInfo: [{
          from_address: txHash === "tx-wrapper-drain" ? victim : secondVictim,
          to_address: subject,
          quant: txHash === "tx-wrapper-drain" ? "2576000000" : "1200000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
        }]
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      approvalEnrichmentMode: "off"
    });

    expect(report.contractDrivenReceiverProfile).toMatchObject({
      totalIncomingTxCount: 2,
      totalIncomingAmountRaw: "3776000000",
      contractDrivenIncomingTxCount: 2,
      contractDrivenIncomingAmountRaw: "3776000000",
      uniqueSourceCount: 2,
      dominantMethod: "Verify20",
      exactApprovalDrainCount: 0
    });
    expect(report.contractDrivenTransferProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: "tx-wrapper-drain",
        method: "Verify20",
        callerAddress: operator,
        operatorAddress: operator,
        contractAddress: wrapperContract,
        spenderAddress: wrapperContract,
        sourceAddress: victim,
        victimAddress: victim,
        receiverAddress: subject,
        sourcePostDebitActivity: expect.objectContaining({
          checked: true,
          laterTxCount: 0,
          laterIncomingAmountRaw: "0",
          laterOutgoingAmountRaw: "0"
        })
      })
    ]));
  });

  it("keeps Verify20 details when sender history returns a duplicate plain transfer", async () => {
    const txHash = "tx-wrapper-duplicate";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          { ...edge(txHash, victim, subject, "5789000000", "2026-05-22T10:00:00.000Z"), method: "Verify20" }
        ]
      ],
      [
        victim,
        [
          edge(txHash, victim, subject, "5789000000", "2026-05-22T10:00:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5789000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({
        ownerAddress: operator,
        contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
        trigger_info: { methodName: "Verify20" },
        trc20TransferInfo: [{
          from_address: victim,
          to_address: subject,
          quant: "5789000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
        }]
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      approvalEnrichmentMode: "off"
    });

    expect(report.contractDrivenReceiverProfile?.contractDrivenIncomingTxCount).toBe(1);
    expect(report.contractDrivenTransferProfiles).toEqual([
      expect.objectContaining({
        txHash,
        method: "Verify20",
        contractAddress: wrapperContract,
        sourceAddress: victim,
        receiverAddress: subject
      })
    ]);
  });

  it("records a service-boundary guard without adding approval-drain auto-decline", async () => {
    const router = "TRouter11111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")]],
      [
        router,
        [
          edge("tx-drain-to-router", victim, router, "1000000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === router) return service("router", "Known router");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender, trigger_info: { methodName: "transferFrom" } }),
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000000"
        })
      ]
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.decisionReasons).not.toEqual(expect.arrayContaining([
      expect.stringContaining("exact approval-drain transferFrom")
    ]));
    expect(report.approvalDrainReviewFindings).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-drain-to-router",
        falsePositiveGuards: [
          expect.objectContaining({ code: "receiver_service_boundary" })
        ]
      })
    ]);
  });

  it("skips approval enrichment while resolving only selected clean CEX path edges", async () => {
    const txInfoCalls: string[] = [];
    const inboundEdges = Array.from({ length: 28 }, (_, index) => {
      const sender = `TBudgetSender${String(index).padStart(2, "0")}111111111111111`;
      return edge(`tx-budget-in-${index}`, sender, subject, "1000000", `2026-05-22T10:${String(index).padStart(2, "0")}:00.000Z`);
    });
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, inboundEdges]
    ]);
    inboundEdges.forEach((inbound, index) => {
      byAddress.set(inbound.fromAddress, [
        edge(`tx-budget-fund-${index}`, binance, inbound.fromAddress, "1000000", `2026-05-22T09:${String(index).padStart(2, "0")}:00.000Z`)
      ]);
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "28000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        txInfoCalls.push(txHash);
        return {};
      },
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async () => null
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "28000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 50,
      maxContractTransactionInfoFetches: 5
    });

    const selectedBranchTxHashes = new Set(report.originPaths.flatMap((path) => path.txHashes));
    expect(new Set(txInfoCalls)).toEqual(selectedBranchTxHashes);
    expect(txInfoCalls).toHaveLength(selectedBranchTxHashes.size);
    expect(report.coverage.notes).toContain("Approval/contract enrichment skipped because no contract/service trigger was found.");
  });

  it("keeps the approval candidate budget while resolving selected contract path edges", async () => {
    const txInfoCalls: string[] = [];
    let activeTxInfoCalls = 0;
    let maxActiveTxInfoCalls = 0;
    const inboundEdges = Array.from({ length: 28 }, (_, index) => {
      const sender = `TBudgetSender${String(index).padStart(2, "0")}111111111111111`;
      return edge(`tx-budget-in-${index}`, sender, subject, "1000000", `2026-05-22T10:${String(index).padStart(2, "0")}:00.000Z`);
    });
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, inboundEdges]
    ]);
    inboundEdges.forEach((inbound, index) => {
      const funder = index < 5 ? wrapperContract : `TBudgetFunder${String(index).padStart(2, "0")}111111111111111`;
      byAddress.set(inbound.fromAddress, [
        edge(`tx-budget-fund-${index}`, funder, inbound.fromAddress, "1000000", `2026-05-22T09:${String(index).padStart(2, "0")}:00.000Z`)
      ]);
    });
    byAddress.set(wrapperContract, []);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "28000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        activeTxInfoCalls += 1;
        maxActiveTxInfoCalls = Math.max(maxActiveTxInfoCalls, activeTxInfoCalls);
        txInfoCalls.push(txHash);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeTxInfoCalls -= 1;
        return {};
      },
      listTrc20ApprovalChanges: async () => []
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "28000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    const selectedBranchTxHashes = new Set(report.originPaths.flatMap((path) => path.txHashes));
    expect(new Set(txInfoCalls)).toEqual(selectedBranchTxHashes);
    expect(txInfoCalls).toHaveLength(selectedBranchTxHashes.size);
    expect(maxActiveTxInfoCalls).toBe(1);
    expect(report.coverage.notes).toContain("Approval/contract enrichment budget: checked 5 candidate edge(s).");
  });

  it("still checks explicit transferFrom edges adjacent to clean CEX-funded paths", async () => {
    const txInfoCalls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-binance-clean", binance, cleanSender, "1000000", "2026-05-22T09:00:00.000Z"),
          edge("tx-transferfrom-drain", victim, cleanSender, "1000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        txInfoCalls.push(txHash);
        return { ownerAddress: spender, trigger_info: { methodName: "transferFrom" } };
      },
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000"
        })
      ]
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    expect(report.originPaths[0]).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceType: "allowlist_cex"
    });
    expect(txInfoCalls).toContain("tx-transferfrom-drain");
    expect(report.approvalDrainProvenanceProfiles).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-transferfrom-drain",
        hopDepth: 1
      })
    ]);
    expect(report.approvalDrainProvenanceProfiles[0]?.score).toBeGreaterThanOrEqual(70);
    expect(report.decision).toBe("DECLINE");
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
  });

  it("prioritizes explicit transferFrom triggers before supporting path legs when the budget is tight", async () => {
    const txInfoCalls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-binance-clean", binance, cleanSender, "1000000", "2026-05-22T09:00:00.000Z"),
          edge("tx-transferfrom-drain", victim, cleanSender, "1000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        txInfoCalls.push(txHash);
        return { ownerAddress: spender, trigger_info: { methodName: "transferFrom" } };
      },
      listTrc20ApprovalChanges: async () => []
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 1,
      maxContractTransactionInfoFetches: 1
    });

    const selectedBranchTxHashes = new Set(report.originPaths.flatMap((path) => path.txHashes));
    expect(txInfoCalls.filter((txHash) => !selectedBranchTxHashes.has(txHash))).toEqual(["tx-transferfrom-drain"]);
    expect(new Set(txInfoCalls).size).toBe(txInfoCalls.length);
    expect([...selectedBranchTxHashes].every((txHash) => txInfoCalls.includes(txHash))).toBe(true);
    expect(txInfoCalls).toContain("tx-transferfrom-drain");
    expect(report.coverage.notes).toContain("Approval/contract enrichment budget: checked 1 candidate edge(s).");
  });

  it("does not claim approval enrichment was checked when lookup dependencies are unavailable", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    expect(report.coverage.notes).toContain("Approval/contract enrichment skipped because transaction or approval lookup dependencies are unavailable.");
    expect(report.coverage.notes.join(" ")).not.toContain("Approval/contract enrichment budget: checked");
  });

  it("uses an LLM contract verdict as capped suspicion for an uncertain wrapper approval-drain case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.95,
      contractRiskScore: 95,
      decisionRecommendation: "DECLINE",
      reasons: ["Wrapper method hides transferFrom-like token movement."],
      citedEvidenceIds: ["tx-wrapper-drain"],
      falsePositiveNotes: ["No exact approval was found; this may still be a normal service route."]
    };
    let capturedCaseFiles: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {
            ownerAddress: cleanSender,
            contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
            trigger_info: { methodName: "transfer" }
          },
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: { source_status: "available" },
            isVerified: false,
            providerRisk: null,
            hasTransferFromSelector: false,
            hasOwnerOnlyPattern: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles = caseFiles;
        return [llmVerdict];
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("llm_assisted_suspicion");
    expect(report.proofLevel).not.toBe("exact_approval_drain_provenance");
    expect(report.proofLevel).not.toBe("exact_scam_or_taint_proof");
    expect(report.riskScore).toBeLessThanOrEqual(80);
    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.contractLlmVerdicts).toEqual([llmVerdict]);
    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainReviewFindings: [
        expect.objectContaining({
          drainTxHash: "tx-wrapper-drain",
          reason: "approval_not_found"
        })
      ],
      approvalDrainReviewInterpretations: [
        expect.objectContaining({
          reviewFindingInterpretation: "candidate_only_not_exact_proof",
          exactApprovalProofStatus: "not_found",
          transferFromProofStatus: "suspected_wrapper"
        })
      ]
    });
    expect(report.decisionReasons).toEqual(expect.arrayContaining([
      "LLM contract verdict is drainer_like with score 95/100 and 95% confidence."
    ]));
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(report.assessment.hardBadEvidence).toEqual([]);
    expect(report.decisionReasons.join(" ")).not.toMatch(/exact approval-drain/i);
  });

  it("uses a high-confidence unknown-suspicious LLM verdict to decline an unproven risky contract path", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.82,
      contractRiskScore: 83,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown wrapper movement is suspicious but not exact drain proof."],
      citedEvidenceIds: ["tx-wrapper-drain"],
      falsePositiveNotes: []
    };

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {},
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: {},
            isVerified: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async () => [llmVerdict]
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("llm_assisted_suspicion");
    expect(report.riskScore).toBe(75);
    expect(report.decisionReasons).toEqual([
      "LLM contract verdict is unknown_suspicious with 82% confidence."
    ]);
    expect(report.assessment.hardBadEvidence).toEqual([]);
  });

  it("treats an unknown contract boundary as unproven context, not scam proof", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths[0]).toMatchObject({
      rootSourceAddress: wrapperContract,
      stoppedReason: "unlabeled_service_boundary",
      verdict: "REVIEW"
    });
    expect(report.assessment.hardBadEvidence).toHaveLength(0);
    expect(report.decision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exchange_policy_context");
    expect(report.decisionReasons.join(" ")).toContain("Clean source could not be proven");
  });

  it("does not reuse a drainer fingerprint verdict when the cloned contract flow is different", async () => {
    let llmCalls = 0;
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => {
          llmCalls += 1;
          return {
            ok: true,
            providerLabel: "deepseek",
            model: "deepseek-v4-flash",
            json: llmCalls === 1
              ? {
                  verdict: "drainer_like",
                  confidence: 0.9,
                  contractRiskScore: 90,
                  decisionRecommendation: "DECLINE",
                  reasons: ["Wrapper flow is drainer-like."],
                  citedEvidenceIds: ["tx-wrapper-drain"],
                  falsePositiveNotes: []
                }
              : {
                  verdict: "legitimate_service",
                  confidence: 0.82,
                  contractRiskScore: 20,
                  decisionRecommendation: "ACCEPTABLE",
                  reasons: ["No approval-drain flow is present."],
                  citedEvidenceIds: ["tx-clone-clean"],
                  falsePositiveNotes: []
                },
            rawText: "{}",
            latencyMs: 10
          };
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-28T00:00:00.000Z")
    });
    const contractProfile = (contractAddress: string) => ({
      contractAddress,
      methodMap: { deadbeef: "Verify20(address,address,uint256)" },
      topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
      providerTags: [],
      publicTags: [],
      rawPayload: { contract: { address: contractAddress, source_code: "contract X { function Verify20() public {} }" } },
      isVerified: false,
      lowMetadata: true,
      activityLevel: "low" as const
    });

    const firstFlowEdges = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [victim, []]
    ]);

    await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => firstFlowEdges.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === wrapperContract ? service("unknown_contract", null) : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {},
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract ? contractProfile(wrapperContract) : null,
      analyzeContractLlmCaseFiles: analyzer
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    const secondSubject = "TSubject22222222222222222222222222";
    const secondCleanSender = "TCleanSender222222222222222222222";
    const secondFlowEdges = new Map<string, ForensicRouteEdge[]>([
      [secondSubject, [edge("tx-clone-subject", secondCleanSender, secondSubject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [secondCleanSender, [edge("tx-clone-clean", wrapperCloneContract, secondCleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperCloneContract, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => secondFlowEdges.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === wrapperCloneContract ? service("unknown_contract", null) : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getContractIntelligenceProfile: async (address) => address === wrapperCloneContract ? contractProfile(wrapperCloneContract) : null,
      analyzeContractLlmCaseFiles: analyzer
    }, {
      sourceAddress: secondSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(llmCalls).toBe(2);
    expect(report.contractLlmVerdicts?.[0]).toMatchObject({
      source: "llm",
      verdict: "legitimate_service",
      contractAddress: wrapperCloneContract
    });
    expectRegressionReport(report, "Fingerprint clone with different flow does not reuse drainer verdict");
  });

  it("declines by insufficient coverage when LLM times out on an uncertain contract case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {},
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: {},
            isVerified: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => caseFiles.map((caseFile) => ({
        source: "unavailable" as const,
        cacheMatch: null,
        reusedFromContractAddress: null,
        providerLabel: "deepseek",
        model: "deepseek-v4-flash",
        contractAddress: caseFile.contractAddress,
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "unknown_insufficient_data" as const,
        confidence: 0,
        contractRiskScore: 65,
        decisionRecommendation: "DECLINE" as const,
        reasons: ["Clean contract intent could not be verified automatically."],
        citedEvidenceIds: [],
        falsePositiveNotes: [],
        error: "llm timed out"
      }))
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.contractLlmVerdicts?.[0]).toMatchObject({
      source: "unavailable",
      error: "llm timed out"
    });
    expect(report.riskScore).toBe(65);
    expect(report.decisionReasons[0]).toContain("LLM unavailable: llm timed out");
    expectRegressionReport(report, "LLM timeout on uncertain contract is user decline with no cache");
  });

  it("runs LLM contract reporting for deterministic unknown-contract boundary declines", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.7,
      contractRiskScore: 83,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown contract boundary has no clean service identity."],
      citedEvidenceIds: ["tx-contract-clean"],
      falsePositiveNotes: ["Could be a legitimate private router, but no service evidence was available."]
    };
    let capturedCaseFiles: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            providerTags: [],
            publicTags: [],
            methodMap: {},
            rawPayload: {},
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles = caseFiles;
        return [llmVerdict];
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(75);
    expect(report.contractLlmVerdicts).toEqual([llmVerdict]);
    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainReviewFindings: [],
      originPaths: [
        expect.objectContaining({
          rootSourceAddress: wrapperContract,
          stoppedReason: "unlabeled_service_boundary"
        })
      ],
      serviceClassification: {
        category: "unknown_contract"
      }
    });
  });

  it("uses the latest 150 transfers for sparse windows so older exchange origins are still traced", async () => {
    const calls: Array<{ address: string; mode: "window" | "latest"; limit?: number }> = [];
    const sender = "TSender11111111111111111111111111111";
    const sourceWindowEdges = [
      edge("tx-sender-subject", sender, subject, "1123000000", "2026-05-22T10:00:00.000Z")
    ];
    const senderLatestEdges = [
      edge("tx-whitebit-sender", binance, sender, "1123000000", "2025-11-01T10:00:00.000Z")
    ];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1123000000",
      fetchEdgesForAddress: async (address) => {
        calls.push({ address, mode: "window" });
        return address === subject ? sourceWindowEdges : [];
      },
      fetchLatestEdgesForAddress: async (address, limit) => {
        calls.push({ address, mode: "latest", limit });
        if (address === subject) return sourceWindowEdges;
        if (address === sender) return senderLatestEdges;
        return [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "WhiteBIT");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(calls).toEqual(expect.arrayContaining([
      { address: subject, mode: "latest", limit: 150 },
      { address: sender, mode: "latest", limit: 150 }
    ]));
    expect(report.originPaths[0]).toMatchObject({
      balanceTransferTxHash: "tx-sender-subject",
      pathAddresses: [binance, sender, subject],
      txHashes: ["tx-whitebit-sender", "tx-sender-subject"],
      verdict: "DECLINE",
      riskScoreContribution: 60
    });
    expect(report.decisionReasons[0]).toContain("WhiteBIT exposure (100% of selected provenance target)");
    expect(report.decisionReasons.join(" ")).toContain("WhiteBIT");
    expect(report.decisionReasons.join(" ")).toContain("not direct scam/blacklist proof");
    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.internalDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exchange_policy_decline");
    expect(report.assessment.hardBadEvidence).toEqual([]);
    expect(report.assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "whitebit",
      proofLevel: "exchange_policy_decline"
    }));
    expect(report.riskScore).toBeGreaterThanOrEqual(60);
    expect(report.riskScore).toBeLessThanOrEqual(68);
  });

  it("returns review incomplete when balance lookup fails", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => null,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(65);
    expect(report.coverage.partial).toBe(true);
    expect(report.decisionReasons).toEqual(["Clean source could not be proven; exchange policy declines this wallet by safe default. Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });

  it("does not treat zero current balance as medium risk in generic wallet profile context", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "0",
      fetchEdgesForAddress: async () => [],
      fetchLatestEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      windowStart: new Date("2026-04-29T00:00:00.000Z"),
      windowEnd: new Date("2026-05-29T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      mode: "wallet_profile"
    });

    expect(report.currentUsdtBalanceRaw).toBe("0");
    expect(report.coverage.coverageRatio).toBe(0);
    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.userDecision).toBe("ACCEPTABLE");
    expect(report.proofLevel).toBe("clean_source_proven");
    expect(report.assessment.reasons.join(" ")).toContain("Current USDT balance is zero; balance-origin mode is not applicable for this wallet profile check.");
    expect(report.assessment.reasons.join(" ")).not.toContain("Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds.");
    expect(report.riskScore).toBeLessThan(45);
  });

  it("does not run cross-chain providers or attach a corridor when Stage 2 is disabled", async () => {
    const byAddress = stage2BridgeByAddress();
    const provider = countingDiscoveryProvider({
      transfers: [crossChainTransfer()]
    });
    const baseDeps = {
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address: string) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address: string) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    };
    const input = {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    };

    const baseline = await runWhereIsMoneyCheck(baseDeps, input);
    const disabled = await runWhereIsMoneyCheck({
      ...baseDeps,
      crossChainDiscoveryProvider: provider,
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      ...input,
      crossChainStage2Enabled: false,
      crossChainMaxProviderCalls: 20
    });

    expect(provider.calls).toEqual([]);
    expect(disabled.crossChainCorridor).toBeUndefined();
    expect(disabled.decision).toBe(baseline.decision);
    expect(disabled.riskScore).toBe(baseline.riskScore);
    expect(disabled.proofLevel).toBe(baseline.proofLevel);
    expect(disabled.assessment.dominantRiskLayer).toEqual(baseline.assessment.dominantRiskLayer);
  });

  it("emits running Stage 2 progress before cross-chain provider calls", async () => {
    const byAddress = stage2BridgeByAddress();
    const baseProvider = countingDiscoveryProvider({
      transfers: [crossChainTransfer()]
    });
    const patches: ForensicJobProgressPatch[] = [];
    let runningProgressSeenBeforeProvider = false;
    const provider: CrossChainDiscoveryProvider = {
      async findTransfersByTx(query) {
        runningProgressSeenBeforeProvider = patches.some((patch) =>
          patch.jobPhase === "cross_chain_stage2" &&
          patch.crossChainStage2Progress?.status === "running" &&
          patch.crossChainStage2Progress.providerCalls === 0
        );
        return baseProvider.findTransfersByTx(query);
      },
      async findTransfersByAddress(query) {
        runningProgressSeenBeforeProvider = patches.some((patch) =>
          patch.jobPhase === "cross_chain_stage2" &&
          patch.crossChainStage2Progress?.status === "running" &&
          patch.crossChainStage2Progress.providerCalls === 0
        );
        return baseProvider.findTransfersByAddress(query);
      },
      async getAddressRisk(query) {
        return baseProvider.getAddressRisk(query);
      }
    };

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: provider,
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainManualDeepMode: true,
      crossChainMaxProviderCalls: 20,
      onProgress: async (patch) => {
        patches.push(patch);
      }
    });

    expect(report.crossChainCorridor?.triggered).toBe(true);
    expect(runningProgressSeenBeforeProvider).toBe(true);
    expect(patches[0]).toMatchObject({
      jobPhase: "money_origin_trace",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "pending"
      }
    });
    expect(patches).toContainEqual(expect.objectContaining({
      jobPhase: "cross_chain_stage2",
      crossChainStage2Progress: expect.objectContaining({
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        selectedAmountRaw: "100000000000",
        targetAmountRaw: "100000000000",
        providerCalls: 0
      })
    }));
  });

  it("emits money-origin trace progress while fetching multi-hop addresses", async () => {
    const progressSubject = "TProgressSubject1111111111111111111";
    const chain = Array.from({ length: 6 }, (_, index) => `TProgressHop${index}11111111111111111111`);
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        progressSubject,
        [edge("progress-hop-0", chain[0], progressSubject, "1000000", "2026-05-20T10:00:00.000Z")]
      ],
      ...chain.slice(0, 5).map((address, index): [string, ForensicRouteEdge[]] => [
        address,
        [edge(
          `progress-hop-${index + 1}`,
          chain[index + 1],
          address,
          "1000000",
          `2026-05-20T09:${String(50 - index * 5).padStart(2, "0")}:00.000Z`
        )]
      ])
    ]);
    const patches: ForensicJobProgressPatch[] = [];

    await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: progressSubject,
      seedTransfers: [{
        txHash: "progress-hop-0",
        fromAddress: chain[0],
        toAddress: progressSubject,
        amountRaw: "1000000",
        timestamp: "2026-05-20T10:00:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer",
        coverageShare: 1,
        selectedReason: "covers_current_balance"
      }],
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 8,
      beamWidth: 1,
      maxAddressFetches: 10,
      approvalEnrichmentMode: "off",
      onProgress: async (patch) => {
        patches.push(patch);
      }
    });

    expect(patches).toContainEqual(expect.objectContaining({
      jobPhase: "money_origin_trace",
      performanceTiming: expect.objectContaining({
        whereIsMoneyFetchedAddressCount: 5,
        whereIsMoneyMaxAddressFetches: 10
      })
    }));
  });

  it("applies maxAddressFetches as a global where-is-money fetch budget", async () => {
    const budgetSubject = "TGlobalBudgetSubject111111111111111";
    const chain = Array.from({ length: 8 }, (_, index) => `TGlobalBudgetHop${index}111111111111`);
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      ...chain.slice(0, 7).map((address, index): [string, ForensicRouteEdge[]] => [
        address,
        [edge(
          `budget-hop-${index + 1}`,
          chain[index + 1],
          address,
          "1000000",
          `2026-05-20T09:${String(50 - index * 5).padStart(2, "0")}:00.000Z`
        )]
      ])
    ]);
    const fetched: string[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address) => {
        fetched.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: budgetSubject,
      seedTransfers: [{
        txHash: "budget-hop-0",
        fromAddress: chain[0],
        toAddress: budgetSubject,
        amountRaw: "1000000",
        timestamp: "2026-05-20T10:00:00.000Z",
        method: "transfer",
        edgeType: "normal_transfer",
        coverageShare: 1,
        selectedReason: "covers_current_balance"
      }],
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 8,
      beamWidth: 1,
      maxAddressFetches: 3,
      approvalEnrichmentMode: "off"
    });

    expect(fetched).toHaveLength(3);
    expect(report.coverage.fetchedAddressCount).toBe(3);
    expect(report.coverage.partial).toBe(true);
    expect(report.coverage.notes).toEqual(expect.arrayContaining([
      "Trace reached global maxAddressFetches=3; source remains partially proven."
    ]));
  });

  it("attaches a skipped Stage 2 report below the automatic threshold and preserves requested_amount coverage notes", async () => {
    const byAddress = stage2BridgeByAddress({ amountRaw: "1000000" });
    const provider = countingDiscoveryProvider({
      transfers: [crossChainTransfer({ amountRaw: "1000000" })]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: provider,
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20
    });

    expect(provider.calls).toEqual([]);
    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: false,
      providerCalls: 0,
      partial: false
    });
    expect(report.crossChainCorridor?.skippedReason).toContain("low amount");
    expect(report.crossChainCorridor?.coverageNotes).toEqual(["Deep cross-chain analysis is available but was not auto-run."]);
    expect(report.coverage.partial).toBe(false);
    expect(report.coverage.provenanceScope).toBe("requested_amount");
    expect(report.coverage.notes.join(" ")).toContain("Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount");
    expect(report.coverage.notes.join(" ")).toContain("Deep cross-chain analysis is available but was not auto-run.");
  });

  it("triggers Stage 2 from deep service bridge exposure without a selected boundary path", async () => {
    const deepSubject = "TDeepStage2Subject111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        deepSubject,
        [
          edge("deep-stage2-funding", "TDeepStage2Funder", deepSubject, "100000000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      ["TDeepStage2Funder", []]
    ]);
    const provider = countingDiscoveryProvider({
      transfers: [
        crossChainTransfer({
          id: "range-deep-stage2-subject",
          source: {
            chain: "tron",
            chainId: "tron-mainnet",
            address: deepSubject
          },
          sourceTxHash: "deep-stage2-source",
          amountRaw: "150000000000"
        })
      ]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: provider,
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: deepSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20,
      deepServiceExposureProfiles: [
        serviceExposureProfile({
          subjectAddress: deepSubject,
          totalOutgoingRaw: "200000000000",
          categoryBreakdown: [
            { category: "bridge", volumeRaw: "150000000000", txCount: 2, volumeRatio: 0.75 }
          ]
        })
      ]
    });

    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: true
    });
    expect(report.crossChainCorridor?.paths[0]).toMatchObject({
      triggerReason: "deep_service_exposure_bridge",
      selectedAmountRaw: "150000000000",
      targetAmountRaw: "200000000000"
    });
    expect(provider.calls).toEqual(expect.arrayContaining([`address:${deepSubject}`]));
  });

  it("does not trigger Stage 2 from deep service bridge exposure for another wallet", async () => {
    const deepSubject = "TDeepScopedSubject111111111111111";
    const unrelatedSubject = "TDeepScopedOther1111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        deepSubject,
        [
          edge("deep-scoped-funding", "TDeepScopedFunder", deepSubject, "100000000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      ["TDeepScopedFunder", []]
    ]);
    const provider = countingDiscoveryProvider({
      transfers: [
        crossChainTransfer({
          id: "range-unrelated-deep-stage2",
          source: {
            chain: "tron",
            chainId: "tron-mainnet",
            address: unrelatedSubject
          },
          sourceTxHash: "unrelated-deep-stage2-source",
          amountRaw: "200000000000"
        })
      ]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: provider,
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: deepSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20,
      deepServiceExposureProfiles: [
        serviceExposureProfile({
          subjectAddress: unrelatedSubject,
          totalOutgoingRaw: "200000000000",
          categoryBreakdown: [
            { category: "bridge", volumeRaw: "200000000000", txCount: 2, volumeRatio: 1 }
          ]
        }),
        serviceExposureProfile({
          subjectAddress: deepSubject,
          totalOutgoingRaw: "200000000000",
          categoryBreakdown: [
            { category: "dex", volumeRaw: "10000000000", txCount: 1, volumeRatio: 0.05 }
          ]
        })
      ]
    });

    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: false,
      providerCalls: 0
    });
    expect(report.crossChainCorridor?.skippedReason).toContain("No selected cross-chain boundary");
    expect(provider.calls).toEqual([]);
  });

  it("triggers Stage 2 from low-balance drain episode bridge exposure without a selected boundary path", async () => {
    const lowBalanceSubject = "TDrainStage2Subject1111111111111";
    const bridgeDestination = "TDrainStage2Bridge11111111111111";
    const ordinaryDestination = "TDrainStage2Spend111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("drain-stage2-funding", "TDrainStage2Funder", lowBalanceSubject, "300000000000", "2026-05-05T13:00:00.000Z"),
          edge("drain-stage2-bridge", lowBalanceSubject, bridgeDestination, "150000000000", "2026-05-05T13:30:00.000Z"),
          edge("drain-stage2-spend", lowBalanceSubject, ordinaryDestination, "10000000000", "2026-05-05T13:35:00.000Z"),
          edge("drain-stage2-anchor", lowBalanceSubject, ordinaryDestination, "50000000000", "2026-05-05T15:00:00.000Z")
        ]
      ],
      ["TDrainStage2Funder", []]
    ]);
    const provider = countingDiscoveryProvider({
      transfers: [
        crossChainTransfer({
          id: "range-drain-stage2-bridge",
          sourceTxHash: "drain-stage2-bridge",
          amountRaw: "150000000000"
        })
      ]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address.toLowerCase() === bridgeDestination.toLowerCase()) {
          return service("bridge", "Bridge Adapter");
        }
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: provider,
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20,
      approvalEnrichmentMode: "off"
    });

    expect(report.coverage.drainEpisode).toMatchObject({
      bridgeOutgoingRaw: "150000000000",
      outgoingTxHashes: ["drain-stage2-bridge", "drain-stage2-spend", "drain-stage2-anchor"]
    });
    expect(report.coverage.checkedScope).toBe("drain_episode");
    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: true,
      partial: false
    });
    expect(report.crossChainCorridor?.paths[0]).toMatchObject({
      triggerReason: "drain_episode_bridge_exposure",
      selectedAmountRaw: "150000000000",
      targetAmountRaw: "210000000000"
    });
    expect(report.crossChainCorridor?.paths[0]?.balanceTransferTxHashes).toEqual(expect.arrayContaining([
      "drain-stage2-bridge",
      "drain-stage2-spend",
      "drain-stage2-anchor"
    ]));
    expect(provider.calls).toEqual(expect.arrayContaining(["tx:drain-stage2-bridge"]));
  });

  it("attaches a partial Stage 2 report when triggered but the discovery provider is missing", async () => {
    const byAddress = stage2BridgeByAddress();

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20
    });

    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: true,
      providerCalls: 0,
      partial: true,
      paths: []
    });
    expect(report.crossChainCorridor?.coverageNotes).toEqual([
      "Stage 2 was triggered, but the cross-chain discovery provider is unavailable."
    ]);
    expect(report.coverage.partial).toBe(true);
    expect(report.coverage.notes.join(" ")).toContain("Stage 2 was triggered, but the cross-chain discovery provider is unavailable.");
    expect(report.sourceBundleExposure?.unresolvedBoundary).toEqual(expect.objectContaining({
      kind: "bridge_router_dex",
      affectedShare: expect.any(Number),
      scoreFloor: 55
    }));
    expect(report.riskScore).toBeGreaterThanOrEqual(report.sourceBundleExposure?.unresolvedBoundary?.scoreFloor ?? 0);
    expect(report.assessment.sourcePolicyEvidence.map((item) => item.kind)).toContain("bridge_router_dex");
  });

  it("does not run bridge continuation in normal Stage 2 when manual deep mode is false", async () => {
    const byAddress = stage2BridgeByAddress();
    const discoveryProvider = countingDiscoveryProvider({
      transfers: [crossChainTransfer()]
    });
    const continuationProvider = countingContinuationProvider({
      [crossChainEthereumActor.toLowerCase()]: [crossChainContinuationEdge()]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: discoveryProvider,
      crossChainContinuationProviders: [continuationProvider],
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainManualDeepMode: false,
      crossChainMaxProviderCalls: 20
    });

    expect(continuationProvider.calls).toEqual([]);
    expect(report.crossChainCorridor?.triggered).toBe(true);
    expect(report.crossChainCorridor?.paths).toHaveLength(1);
    expect(report.crossChainCorridor?.paths[0]?.continuation).toBeUndefined();
  });

  it("passes continuation providers and attaches continuation in manual deep Stage 2", async () => {
    const byAddress = stage2BridgeByAddress();
    const discoveryProvider = countingDiscoveryProvider({
      transfers: [crossChainTransfer()]
    });
    const continuationProvider = countingContinuationProvider({
      [crossChainEthereumActor.toLowerCase()]: [crossChainContinuationEdge()]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: discoveryProvider,
      crossChainContinuationProviders: [continuationProvider],
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainManualDeepMode: true,
      crossChainMaxProviderCalls: 20
    });

    expect(continuationProvider.calls).toEqual(expect.arrayContaining([crossChainEthereumActor]));
    expect(continuationProvider.calls.length).toBeGreaterThan(0);
    expect(report.crossChainCorridor?.paths[0]?.continuation).toBeDefined();
    expect(report.crossChainCorridor?.paths[0]?.continuation?.edges.map((edge) => edge.id)).toContain("continuation:where-check-candidate");
  });

  it("does not run bridge continuation in normal Stage 2 when manual deep mode is undefined", async () => {
    const byAddress = stage2BridgeByAddress();
    const discoveryProvider = countingDiscoveryProvider({
      transfers: [crossChainTransfer()]
    });
    const continuationProvider = countingContinuationProvider({
      [crossChainEthereumActor.toLowerCase()]: [crossChainContinuationEdge()]
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: discoveryProvider,
      crossChainContinuationProviders: [continuationProvider],
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20
    });

    expect(continuationProvider.calls).toEqual([]);
    expect(report.crossChainCorridor?.triggered).toBe(true);
    expect(report.crossChainCorridor?.paths).toHaveLength(1);
    expect(report.crossChainCorridor?.paths[0]?.continuation).toBeUndefined();
  });

  it("uses no-name liquidity Stage 2 evidence to change the final dominant risk layer", async () => {
    const byAddress = stage2BridgeByAddress();
    const evm = emptyEvmEvidenceProvider({
      async listNormalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary",
          from: crossChainGaryActor,
          to: crossChainUniswapV3Npm,
          value: "0",
          functionName: "decreaseLiquidity(uint256 tokenId)"
        } satisfies EvmTransaction];
      },
      async listInternalTransactions() {
        return [{
          chain: "ethereum",
          hash: "0xgary",
          from: crossChainUniswapV3Npm,
          to: crossChainGaryActor,
          value: "247770000000000000000"
        } satisfies EvmInternalTransaction];
      },
      async listErc20Transfers() {
        return [
          crossChainTokenTransfer(),
          crossChainTokenTransfer({
            contractAddress: "0xweth000000000000000000000000000000000000",
            tokenSymbol: "WETH"
          })
        ];
      },
      async getTransactionReceipt({ txHash }) {
        return txHash === "0xgary" ? crossChainReceipt() : null;
      },
      async getTokenMetadata({ tokenContract }) {
        return tokenContract.includes("gary")
          ? crossChainTokenMetadata("GARY", tokenContract)
          : crossChainTokenMetadata("WETH", tokenContract);
      }
    });

    const baseDeps = {
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address: string) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address: string) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    };
    const input = {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    };
    const disabled = await runWhereIsMoneyCheck(baseDeps, input);

    const report = await runWhereIsMoneyCheck({
      ...baseDeps,
      crossChainDiscoveryProvider: countingDiscoveryProvider({
        transfers: [crossChainTransfer({
          destination: { chain: "ethereum", chainId: 1, address: crossChainGaryActor },
          destinationTxHash: "0xgary"
        })]
      }),
      evmEvidenceProvider: evm
    }, {
      ...input,
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 30
    });

    expect(report.crossChainCorridor?.paths[0]?.terminalBoundary).toBe("no_name_token_liquidity");
    expect(report.assessment.sourcePolicyEvidence.map((item) => item.kind)).toContain("no_name_token_liquidity");
    expect(report.assessment.dominantRiskLayer?.score).toBeGreaterThan(disabled.assessment.dominantRiskLayer?.score ?? 0);
    expect(report.assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    }));
    expect(report.decisionReasons.join(" ")).toContain("no-name token liquidity");
  });

  it("uses exact sanctioned Stage 2 hard evidence for a hard-proof decline", async () => {
    const byAddress = stage2BridgeByAddress();

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      crossChainDiscoveryProvider: countingDiscoveryProvider({
        transfers: [crossChainTransfer({
          destination: { chain: "ethereum", chainId: 1, address: crossChainSanctioned }
        })],
        riskSnapshots: [crossChainRiskSnapshot()]
      }),
      evmEvidenceProvider: emptyEvmEvidenceProvider()
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20
    });

    expect(report.crossChainCorridor?.paths[0]?.terminalBoundary).toBe("sanctioned_service");
    expect(report.assessment.hardBadEvidence).toEqual([
      expect.objectContaining({
        kind: "sanctioned_service",
        evidenceIds: ["cross_chain:local:ethereum:sanctioned:service_boundary"]
      })
    ]);
    expect(report.decision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exact_scam_or_taint_proof");
    expect(report.decisionReasons).toEqual(["Exact sanctioned service evidence found in cross-chain corridor."]);
  });

  it("runs the full manual GARY/Stargate/Tornado fixture regression and variants", async () => {
    const input = {
      sourceAddress: manualGaryStargateTornadoCase.subjectAddress,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 40
    };

    const report = await runWhereIsMoneyCheck(manualGaryDeps({
      data: manualGaryStargateTornadoCase.data
    }), input);
    const hardBadKinds = report.assessment.hardBadEvidence.map((item) => item.kind);
    const edges = report.crossChainCorridor?.paths[0]?.edges ?? [];
    const edgeTypes = edges.map((edge) => edge.edgeType);

    expect(report.crossChainCorridor?.triggered).toBe(true);
    expect(report.crossChainCorridor?.partial).toBe(false);
    expect(["no_name_token_liquidity", "tornado_or_mixer"]).toContain(report.crossChainCorridor?.paths[0]?.terminalBoundary);
    expect(report.assessment.dominantRiskLayer?.proofLevel).toBe("exchange_policy_decline");
    expect(hardBadKinds).not.toContain("llm_contract_suspicion");
    expect(hardBadKinds).not.toContain("unknown_contract_boundary");
    expect(hardBadKinds).not.toContain("sanctioned_service");
    expect(edgeTypes).toEqual(expect.arrayContaining([
      "bridge_protocol_link",
      "native_transfer",
      "liquidity_remove",
      "unknown_token_liquidity",
      "tornado_withdrawal"
    ]));
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);

    const baseManualGaryEvmProvider = manualGaryEvmEvidenceProvider();
    const noNameOnlyReport = await runWhereIsMoneyCheck(manualGaryDeps({
      data: manualGaryNoNameOnlyCase.data,
      evmProvider: manualGaryEvmEvidenceProvider({
        async listNormalTransactions(query) {
          const rows = await baseManualGaryEvmProvider.listNormalTransactions(query);
          return rows.filter((tx) => tx.hash !== manualGaryAddresses.tornado100Tx);
        },
        async listInternalTransactions(query) {
          const rows = await baseManualGaryEvmProvider.listInternalTransactions(query);
          return rows.filter((tx) => tx.hash !== manualGaryAddresses.tornado100Tx);
        },
        async getTokenMetadata({ chain, tokenContract }) {
          const token = manualGaryStargateTornadoEvm.tokenMetadata.find((candidate) =>
            candidate.chain === chain && candidate.tokenContract.toLowerCase() === tokenContract.toLowerCase()
          );
          return token?.tokenSymbol === "USDT" ? null : token ?? null;
        }
      })
    }), input);

    expect(noNameOnlyReport.crossChainCorridor?.paths[0]?.terminalBoundary).toBe("no_name_token_liquidity");
    expect(noNameOnlyReport.crossChainCorridor?.partial).toBe(true);
    expect(noNameOnlyReport.assessment.dominantRiskLayer?.proofLevel).toBe("exchange_policy_decline");
    expect(noNameOnlyReport.assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("sanctioned_service");

    const sanctionedReport = await runWhereIsMoneyCheck(manualGaryDeps({
      data: manualGarySanctionedCase.data
    }), input);

    expect(sanctionedReport.assessment.hardBadEvidence.map((item) => item.kind)).toContain("sanctioned_service");
    expect(sanctionedReport.assessment.dominantRiskLayer?.proofLevel).toBe("exact_scam_or_taint_proof");
  });

  it("preserves transaction_seed coverage notes when Stage 2 is triggered", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000000000",
      fetchEdgesForAddress: async (address) => address === crossChainBridgeTron ? [] : [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      mode: "transaction_check",
      subjectAddress: subject,
      requestedAmountRaw: "100000000000",
      seedTransfers: [{
        txHash: "tx-stage2-bridge-subject",
        fromAddress: crossChainBridgeTron,
        toAddress: subject,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T10:00:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_current_balance"
      }],
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20
    });

    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: true,
      partial: true,
      providerCalls: 0
    });
    expect(report.coverage.provenanceScope).toBe("transaction_seed");
    expect(report.coverage.partial).toBe(true);
    expect(report.coverage.dataScopeNote).toBe("Transaction check: the checked transaction is the provenance seed.");
    expect(report.coverage.notes.join(" ")).toContain("Transaction check: balance-forming transfer was supplied from the checked transaction.");
    expect(report.coverage.notes.join(" ")).toContain("Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount or checked transaction.");
    expect(report.coverage.notes.join(" ")).toContain("Stage 2 was triggered, but the cross-chain discovery provider is unavailable.");
  });

  it("preserves recent-flow anchor metadata when Stage 2 is triggered", async () => {
    const recentFlowSubject = "TStage2RecentFlow11111111111111111";
    const byAddress = stage2BridgeByAddress({
      subjectAddress: recentFlowSubject,
      includeRecentFlowAnchor: true
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === crossChainBridgeTron) return service("bridge", "LayerZero/Stargate");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: recentFlowSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      crossChainStage2Enabled: true,
      crossChainMaxProviderCalls: 20
    });

    expect(report.crossChainCorridor).toMatchObject({
      enabled: true,
      triggered: true,
      partial: true,
      providerCalls: 0
    });
    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.partial).toBe(true);
    expect(report.coverage.anchorTransfer?.txHash).toBe("tx-stage2-anchor-out");
    expect(report.coverage.lowBalanceThresholdRaw).toBe("1000000000");
    expect(report.coverage.notes.join(" ")).toContain("Recent-flow approximation");
    expect(report.coverage.notes.join(" ")).toContain("Stage 2 was triggered, but the cross-chain discovery provider is unavailable.");
  });
});
