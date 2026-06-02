import type {
  CrossChainAddress,
  CrossChainCorridorPath,
  CrossChainCorridorReport,
  CrossChainEvidenceRef,
  CrossChainRouteEdge,
  CrossChainTerminalBoundary,
  MoneyOriginPath,
  ProviderPayloadRef,
  RiskLayerScore,
  SourcePolicyEvidence,
  WhereIsMoneyHardBadEvidence
} from "../types";
import {
  type CrossChainAddressQuery,
  type CrossChainDiscoveryProvider,
  type CrossChainTransfer,
  type ProviderRiskSnapshot,
  type TimeWindow
} from "./crossChainProviders";
import {
  type EvmChain,
  type EvmEvidenceProvider,
  type EvmInternalTransaction,
  type EvmLog,
  type EvmTokenMetadata,
  type EvmTokenTransfer,
  type EvmTransaction,
  type EvmTransactionReceipt
} from "./evmExplorerClient";
import type { CrossChainStage2TriggerEvaluation } from "./crossChainStage2Triggers";
import { createCrossChainProviderBudget } from "./crossChainBudget";
import {
  detectBridgeServiceBoundary,
  detectKnownMixerOrSanctionedService,
  detectNoNameTokenLiquidity,
  type CrossChainDetectorResult
} from "./crossChainDetectors";
import { crossChainEvidenceId, sourcePolicyEvidenceFromCrossChainLayer } from "./crossChainEvidence";

export type CrossChainCorridorAnalysisResult = {
  report: CrossChainCorridorReport;
  extraSourcePolicyEvidence: SourcePolicyEvidence[];
  extraRiskLayers: RiskLayerScore[];
  extraHardBadEvidence: WhereIsMoneyHardBadEvidence[];
};

type ProviderRunner = ReturnType<typeof createCrossChainProviderBudget>;

type ExpansionState = {
  trigger: CrossChainStage2TriggerEvaluation;
  subjectAddress: string;
  originPaths: MoneyOriginPath[];
  discoveryProvider: CrossChainDiscoveryProvider;
  evmProvider?: EvmEvidenceProvider;
  budget: ProviderRunner;
  partial: boolean;
  notes: string[];
  transfers: CrossChainTransfer[];
  payloadRefs: ProviderPayloadRef[];
  edges: CrossChainRouteEdge[];
  detectorResults: CrossChainDetectorResult[];
};

type EvmContext = {
  normal: EvmTransaction[];
  internal: EvmInternalTransaction[];
  erc20: EvmTokenTransfer[];
  receipts: EvmTransactionReceipt[];
  metadata: EvmTokenMetadata[];
};

const TERMINAL_PRIORITY: Record<CrossChainTerminalBoundary, number> = {
  sanctioned_service: 60,
  no_name_token_liquidity: 50,
  tornado_or_mixer: 45,
  bridge_boundary: 30,
  dex_router_boundary: 25,
  unknown_contract: 20,
  data_exhausted: 10,
  candidate_only: 5,
  none: 0
};

export async function runCrossChainCorridorAnalysis(input: {
  trigger: CrossChainStage2TriggerEvaluation;
  subjectAddress: string;
  originPaths: MoneyOriginPath[];
  discoveryProvider?: CrossChainDiscoveryProvider;
  evmProvider?: EvmEvidenceProvider;
  maxProviderCalls: number;
}): Promise<CrossChainCorridorAnalysisResult> {
  if (!input.trigger.triggered) {
    return {
      report: {
        enabled: true,
        triggered: false,
        skippedReason: input.trigger.skippedReason,
        paths: [],
        providerCalls: 0,
        partial: false,
        coverageNotes: input.trigger.deepCheckAvailable ? ["Deep cross-chain analysis is available but was not auto-run."] : [],
        payloadRefs: []
      },
      extraSourcePolicyEvidence: [],
      extraRiskLayers: [],
      extraHardBadEvidence: []
    };
  }

  if (!input.discoveryProvider) {
    return {
      report: {
        enabled: true,
        triggered: true,
        skippedReason: null,
        paths: [],
        providerCalls: 0,
        partial: true,
        coverageNotes: ["Stage 2 was triggered, but the cross-chain discovery provider is unavailable."],
        payloadRefs: []
      },
      extraSourcePolicyEvidence: [],
      extraRiskLayers: [],
      extraHardBadEvidence: []
    };
  }

  return expandWithProviders({
    ...input,
    discoveryProvider: input.discoveryProvider
  });
}

async function expandWithProviders(input: {
  trigger: CrossChainStage2TriggerEvaluation;
  subjectAddress: string;
  originPaths: MoneyOriginPath[];
  discoveryProvider: CrossChainDiscoveryProvider;
  evmProvider?: EvmEvidenceProvider;
  maxProviderCalls: number;
}): Promise<CrossChainCorridorAnalysisResult> {
  const state: ExpansionState = {
    trigger: input.trigger,
    subjectAddress: input.subjectAddress,
    originPaths: input.originPaths,
    discoveryProvider: input.discoveryProvider,
    evmProvider: input.evmProvider,
    budget: createCrossChainProviderBudget({ maxProviderCalls: input.maxProviderCalls }),
    partial: false,
    notes: [],
    transfers: [],
    payloadRefs: [],
    edges: [],
    detectorResults: []
  };

  await discoverRangeTransfers(state);
  addBridgeEdgesAndDetections(state);
  await enrichRiskSnapshots(state);
  await enrichEvmEvidence(state);

  const riskLayers = sortedRiskLayers(state.detectorResults);
  const hasDataExhaustedLayer = riskLayers.some((layer) => layer.kind === "cross_chain_data_exhausted");
  if (hasDataExhaustedLayer) {
    state.notes.push(incompleteProviderDataNote(riskLayers));
  }

  const sourcePolicyEvidence = riskLayers
    .map((layer) => sourcePolicyEvidenceFromCrossChainLayer(layer, {
      aggregateShare: selectedShare(input.originPaths),
      effectiveShare: selectedShare(input.originPaths),
      pathCount: Math.max(1, input.originPaths.length)
    }))
    .filter((evidence): evidence is SourcePolicyEvidence => evidence !== null);
  const hardBadEvidence = riskLayers
    .filter((layer) => layer.sourceExposureKind === "sanctioned_service" && layer.proofLevel === "exact_scam_or_taint_proof")
    .map(hardEvidenceFromLayer);
  const path = buildCorridorPath(state, riskLayers[0] ?? fallbackLayer(), hasDataExhaustedLayer);
  const coverageNotes = uniqueStrings([...state.notes, ...state.budget.coverageNotes()]);
  const partial = state.partial || hasDataExhaustedLayer || coverageNotes.length > 0 || path.partial;

  return {
    report: {
      enabled: true,
      triggered: true,
      skippedReason: null,
      paths: [path],
      providerCalls: state.budget.providerCalls(),
      partial,
      coverageNotes,
      payloadRefs: uniquePayloadRefs(state.payloadRefs)
    },
    extraSourcePolicyEvidence: sourcePolicyEvidence,
    extraRiskLayers: riskLayers,
    extraHardBadEvidence: hardBadEvidence
  };
}

async function discoverRangeTransfers(state: ExpansionState): Promise<void> {
  const txHashes = selectedTxHashes(state.trigger, state.originPaths);
  const addressScope = addressDiscoveryScope(state);
  const expandedAddresses = new Set<string>();
  for (const txHash of txHashes) {
    const transfers = await runBudgeted(state, "range", `transfers-by-tx:${txHash}`, () =>
      state.discoveryProvider.findTransfersByTx({ txHash })
    );
    addTransfers(state, transfers ?? []);
  }

  for (const address of boundaryActors(state.subjectAddress, state.originPaths)) {
    const query: CrossChainAddressQuery = {
      address,
      ...addressScope,
      ...(same(address, state.subjectAddress) && addressScope.assetSymbol ? { assetSymbol: addressScope.assetSymbol } : {})
    };
    expandedAddresses.add(addressQueryKey(query));
    const transfers = await runBudgeted(state, "range", `transfers-by-address:${addressQueryKey(query)}`, () =>
      state.discoveryProvider.findTransfersByAddress(query)
    );
    addTransfers(state, transfers ?? []);
  }

  const frontierAddresses = transferAddresses(state.transfers)
    .map((address) => address.address)
    .filter((address) => !same(address, state.subjectAddress));
  for (const address of frontierAddresses) {
    const query: CrossChainAddressQuery = {
      address,
      timeWindow: addressScope.timeWindow,
      minAmountRaw: addressScope.minAmountRaw
    };
    const key = addressQueryKey(query);
    if (expandedAddresses.has(key)) continue;
    expandedAddresses.add(key);
    const transfers = await runBudgeted(state, "range", `transfers-by-address:${key}`, () =>
      state.discoveryProvider.findTransfersByAddress(query)
    );
    addTransfers(state, transfers ?? []);
  }

  if (state.transfers.length === 0) {
    state.partial = true;
    state.notes.push("Stage 2 was triggered, but provider data did not return a cross-chain transfer corridor.");
  }
}

function addTransfers(state: ExpansionState, transfers: CrossChainTransfer[]): void {
  const existing = new Set(state.transfers.map(transferKey));

  for (const transfer of transfers) {
    const key = transferKey(transfer);
    if (existing.has(key)) continue;
    existing.add(key);
    state.transfers.push(transfer);
    if (transfer.payloadRef) {
      state.payloadRefs.push(transfer.payloadRef);
    }
  }
}

function addBridgeEdgesAndDetections(state: ExpansionState): void {
  for (const transfer of state.transfers) {
    addEdge(state, edgeFromTransfer(transfer));

    const result = detectBridgeServiceBoundary({
      chain: String(transfer.destination.chain),
      address: transfer.destination.address,
      protocol: transfer.protocol,
      labels: transfer.labels,
      amountRaw: transfer.amountRaw,
      assetSymbol: transfer.assetSymbol,
      evidenceRefs: transfer.evidenceRefs,
      selectedShare: selectedShare(state.originPaths),
      weakSupportOnly: isWeakOnlyTransfer(transfer)
    });

    addDetectorResult(state, result);
  }
}

async function enrichRiskSnapshots(state: ExpansionState): Promise<void> {
  for (const address of transferAddresses(state.transfers)) {
    const snapshot = await runBudgeted(state, "range", `risk:${address.chain}:${address.address}`, () =>
      state.discoveryProvider.getAddressRisk({
        chain: String(address.chain),
        address: address.address
      })
    );

    if (snapshot) {
      addRiskSnapshotDetection(state, snapshot);
    }
  }
}

function addRiskSnapshotDetection(state: ExpansionState, snapshot: ProviderRiskSnapshot): void {
  if (snapshot.payloadRef) {
    state.payloadRefs.push(snapshot.payloadRef);
  }

  const result = detectKnownMixerOrSanctionedService({
    chain: String(snapshot.address.chain),
    address: snapshot.address.address,
    labels: snapshot.labels,
    evidenceRefs: snapshot.evidenceRefs,
    selectedShare: selectedShare(state.originPaths)
  });

  if (result.terminalBoundary !== "none") {
    addEdge(state, {
      id: `risk:${snapshot.address.chain}:${snapshot.address.address}`,
      edgeType: "service_boundary",
      source: null,
      destination: snapshot.address,
      txHash: null,
      amountRaw: null,
      assetSymbol: null,
      timestamp: null,
      protocol: "provider-risk",
      evidenceRefs: [...snapshot.evidenceRefs],
      labels: [...snapshot.labels]
    });
  }

  addDetectorResult(state, result);
}

async function enrichEvmEvidence(state: ExpansionState): Promise<void> {
  const addresses = evmAddressesFromTransfers(state.transfers);
  if (addresses.length > 0 && !state.evmProvider) {
    state.partial = true;
    state.notes.push("EVM evidence provider is unavailable for Ethereum/Arbitrum corridor expansion.");
    return;
  }

  if (!state.evmProvider) return;

  for (const address of addresses) {
    const context = await loadEvmContext(state, address);
    addEvmEdges(state, address, context);
    addEvmReceiptDetections(state, address, context);
    addEvmMixerDetections(state, address, context);
    addEvmLiquidityDetections(state, address, context);
  }
}

async function loadEvmContext(state: ExpansionState, address: CrossChainAddress & { chain: EvmChain }): Promise<EvmContext> {
  const provider = state.evmProvider;
  if (!provider) return { normal: [], internal: [], erc20: [], receipts: [], metadata: [] };

  const corridorTxHashes = evmTxHashesForAddress(state.transfers, address);
  const receipts: EvmTransactionReceipt[] = [];
  for (const txHash of corridorTxHashes.slice(0, 8)) {
    const receipt = await runBudgeted(state, "etherscan", `receipt:${address.chain}:${txHash}`, () =>
      provider.getTransactionReceipt({ chain: address.chain, txHash })
    );
    if (receipt && !receipts.some((candidate) => same(candidate.transactionHash, receipt.transactionHash))) {
      receipts.push(receipt);
    }
  }

  const normal = await runBudgeted(state, "etherscan", `normal:${address.chain}:${address.address}`, () =>
    provider.listNormalTransactions({ chain: address.chain, address: address.address, pageLimit: 1 })
  ) ?? [];
  const internal = await runBudgeted(state, "etherscan", `internal:${address.chain}:${address.address}`, () =>
    provider.listInternalTransactions({ chain: address.chain, address: address.address, pageLimit: 1 })
  ) ?? [];
  const erc20 = await runBudgeted(state, "etherscan", `erc20:${address.chain}:${address.address}`, () =>
    provider.listErc20Transfers({ chain: address.chain, address: address.address, pageLimit: 1 })
  ) ?? [];

  const allowedHashes = new Set(uniqueStrings([
    ...corridorTxHashes,
    ...receipts.map((receipt) => receipt.transactionHash)
  ].filter((hash): hash is string => Boolean(hash))).map((hash) => hash.toLowerCase()));
  const scopedNormal = normal.filter((tx) => tx.hash && allowedHashes.has(tx.hash.toLowerCase()));
  const scopedInternal = internal.filter((tx) => tx.hash && allowedHashes.has(tx.hash.toLowerCase()));
  const scopedErc20 = erc20.filter((tx) => tx.hash && allowedHashes.has(tx.hash.toLowerCase()));

  const tokenContracts = uniqueStrings(scopedErc20
    .map((transfer) => transfer.contractAddress)
    .filter((tokenContract): tokenContract is string => Boolean(tokenContract)));
  const metadata: EvmTokenMetadata[] = [];
  for (const tokenContract of tokenContracts.slice(0, 8)) {
    const token = await runBudgeted(state, "etherscan", `token:${address.chain}:${tokenContract}`, () =>
      provider.getTokenMetadata({ chain: address.chain, tokenContract })
    );
    if (token) {
      metadata.push(token);
    } else {
      const fallback = fallbackTokenMetadata(address.chain, tokenContract, scopedErc20);
      if (fallback) {
        state.partial = true;
        state.notes.push("Incomplete EVM provider data: token metadata provider was empty; used ERC20 transfer token metadata fallback.");
        metadata.push(fallback);
      }
    }
  }

  return { normal: scopedNormal, internal: scopedInternal, erc20: scopedErc20, receipts, metadata };
}

function addEvmEdges(state: ExpansionState, address: CrossChainAddress & { chain: EvmChain }, context: EvmContext): void {
  for (const transaction of context.normal) {
    addEdge(state, {
      id: `evm:normal:${address.chain}:${transaction.hash ?? `${transaction.from ?? ""}:${transaction.to ?? ""}`}`,
      edgeType: "native_transfer",
      source: evmAddress(address.chain, transaction.from),
      destination: evmAddress(address.chain, transaction.to),
      txHash: transaction.hash ?? null,
      amountRaw: transaction.value ?? null,
      assetSymbol: nativeSymbol(address.chain),
      timestamp: evmTimestamp(transaction.timeStamp),
      protocol: null,
      evidenceRefs: [evmEvidence(address.chain, transaction.hash ?? address.address, "native_transfer")],
      labels: [transaction.functionName].filter((label): label is string => Boolean(label))
    });
  }

  for (const transaction of context.internal) {
    addEdge(state, {
      id: `evm:internal:${address.chain}:${transaction.hash ?? "nohash"}:${internalTransferDiscriminator(transaction)}`,
      edgeType: "internal_transfer",
      source: evmAddress(address.chain, transaction.from),
      destination: evmAddress(address.chain, transaction.to),
      txHash: transaction.hash ?? null,
      amountRaw: transaction.value ?? null,
      assetSymbol: nativeSymbol(address.chain),
      timestamp: evmTimestamp(transaction.timeStamp),
      protocol: null,
      evidenceRefs: [evmEvidence(address.chain, transaction.hash ?? address.address, "internal_transfer")],
      labels: []
    });
  }

  for (const [index, transfer] of context.erc20.entries()) {
    addEdge(state, {
      id: `evm:erc20:${address.chain}:${transfer.hash ?? "nohash"}:${erc20TransferDiscriminator(transfer, index)}`,
      edgeType: "token_transfer",
      source: evmAddress(address.chain, transfer.from),
      destination: evmAddress(address.chain, transfer.to),
      txHash: transfer.hash ?? null,
      amountRaw: transfer.value ?? null,
      assetSymbol: transfer.tokenSymbol ?? null,
      tokenContract: transfer.contractAddress ?? null,
      timestamp: evmTimestamp(transfer.timeStamp),
      protocol: null,
      evidenceRefs: [evmEvidence(address.chain, transfer.hash ?? address.address, "token_transfer")],
      labels: [transfer.tokenName, transfer.tokenSymbol].filter((label): label is string => Boolean(label))
    });
  }
}

function addEvmReceiptDetections(
  state: ExpansionState,
  address: CrossChainAddress & { chain: EvmChain },
  context: EvmContext
): void {
  for (const receipt of context.receipts) {
    const endpoints = receiptBoundaryEndpoints(receipt);
    for (const endpoint of endpoints) {
      const result = detectKnownMixerOrSanctionedService({
        chain: address.chain,
        address: endpoint.address,
        labels: [],
        evidenceIds: [evmEvidence(address.chain, receipt.transactionHash ?? endpoint.address, "service_boundary").id],
        selectedShare: selectedShare(state.originPaths)
      });

      if (result.terminalBoundary !== "tornado_or_mixer" && result.terminalBoundary !== "sanctioned_service") {
        addDetectorResult(state, result);
        continue;
      }

      addEdge(state, {
        id: `evm:receipt-boundary:${address.chain}:${endpoint.role}:${receipt.transactionHash ?? endpoint.address}`,
        edgeType: "tornado_withdrawal",
        source: evmAddress(address.chain, receipt.from),
        destination: evmAddress(address.chain, receipt.to ?? receipt.contractAddress ?? undefined),
        txHash: receipt.transactionHash ?? null,
        amountRaw: null,
        assetSymbol: nativeSymbol(address.chain),
        timestamp: null,
        protocol: "evm-receipt",
        evidenceRefs: [evmEvidence(address.chain, receipt.transactionHash ?? address.address, "service_boundary")],
        labels: [`tx-scoped receipt ${endpoint.role} boundary`]
      });

      addDetectorResult(state, result);
    }
  }
}

function receiptBoundaryEndpoints(receipt: EvmTransactionReceipt): Array<{ role: "from" | "to" | "contract"; address: string }> {
  const endpoints: Array<{ role: "from" | "to" | "contract"; address: string }> = [];
  if (receipt.from) endpoints.push({ role: "from", address: receipt.from });
  if (receipt.to) endpoints.push({ role: "to", address: receipt.to });
  if (receipt.contractAddress) endpoints.push({ role: "contract", address: receipt.contractAddress });
  return endpoints;
}

function addEvmMixerDetections(
  state: ExpansionState,
  address: CrossChainAddress & { chain: EvmChain },
  context: EvmContext
): void {
  for (const transaction of context.normal) {
    const counterpart = counterpartyForAddress(address.address, transaction.from, transaction.to);
    const labels = [
      transaction.functionName,
      transaction.methodId
    ].filter((label): label is string => Boolean(label));
    const result = detectKnownMixerOrSanctionedService({
      chain: address.chain,
      address: counterpart,
      labels,
      nativeValueRaw: transaction.value ?? null,
      evidenceIds: [evmEvidence(address.chain, transaction.hash ?? counterpart ?? address.address, "service_boundary").id],
      selectedShare: selectedShare(state.originPaths)
    });

    if (result.terminalBoundary === "tornado_or_mixer" || result.terminalBoundary === "sanctioned_service") {
      addEdge(state, {
        id: `evm:mixer:${address.chain}:${transaction.hash ?? counterpart ?? address.address}`,
        edgeType: "tornado_withdrawal",
        source: evmAddress(address.chain, transaction.from),
        destination: evmAddress(address.chain, transaction.to),
        txHash: transaction.hash ?? null,
        amountRaw: transaction.value ?? null,
        assetSymbol: nativeSymbol(address.chain),
        timestamp: evmTimestamp(transaction.timeStamp),
        protocol: "evm",
        evidenceRefs: [evmEvidence(address.chain, transaction.hash ?? counterpart ?? address.address, "service_boundary")],
        labels
      });
    }

    addDetectorResult(state, result);
  }
}

function addEvmLiquidityDetections(
  state: ExpansionState,
  address: CrossChainAddress & { chain: EvmChain },
  context: EvmContext
): void {
  const hashes = uniqueStrings([
    ...context.normal.map((tx) => tx.hash),
    ...context.internal.map((tx) => tx.hash),
    ...context.erc20.map((tx) => tx.hash),
    ...context.receipts.map((receipt) => receipt.transactionHash)
  ].filter((hash): hash is string => Boolean(hash)));

  for (const hash of hashes) {
    const receipt = context.receipts.find((candidate) => same(candidate.transactionHash, hash));
    const logs = receipt?.logs ?? [];
    const normal = context.normal.filter((tx) => same(tx.hash, hash));
    const internal = context.internal.filter((tx) => same(tx.hash, hash));
    const erc20 = context.erc20.filter((tx) => same(tx.hash, hash));
    const metadata = tokenMetadataForTransfers(context.metadata, erc20);
    const nativeValueRaw = maxRaw([
      ...normal.map((tx) => tx.value),
      ...internal.map((tx) => tx.value)
    ]);
    const labels = uniqueStrings([
      ...normal.map((tx) => tx.functionName),
      ...erc20.map((tx) => tx.tokenSymbol),
      receipt?.to,
      logs.length > 0 ? "receipt logs" : null
    ].filter((label): label is string => Boolean(label)));
    const evidenceIds = [
      evmEvidence(address.chain, hash, "unknown_token_liquidity").id,
      ...logs.map((logEntry) => evmEvidence(address.chain, logEntry.transactionHash, "log").id)
    ];

    const result = detectNoNameTokenLiquidity({
      chain: address.chain,
      address: receipt?.to ?? normal[0]?.to ?? null,
      labels,
      logs,
      tokenMetadata: metadata,
      nativeValueRaw,
      evidenceIds,
      selectedShare: selectedShare(state.originPaths)
    });

    if (result.terminalBoundary === "no_name_token_liquidity") {
      const commonEdge = {
        source: evmAddress(address.chain, address.address),
        destination: evmAddress(address.chain, receipt?.to ?? normal[0]?.to),
        txHash: hash,
        amountRaw: nativeValueRaw,
        assetSymbol: nativeSymbol(address.chain),
        timestamp: evmTimestamp(normal[0]?.timeStamp ?? internal[0]?.timeStamp ?? erc20[0]?.timeStamp),
        protocol: "Uniswap V3",
        labels: [...labels, ...metadata.map((token) => token.tokenSymbol).filter((symbol): symbol is string => Boolean(symbol))]
      };
      addEdge(state, {
        id: `evm:liquidity-remove:${address.chain}:${hash}`,
        edgeType: "liquidity_remove",
        ...commonEdge,
        evidenceRefs: [evmEvidence(address.chain, hash, "liquidity_remove")]
      });
      addEdge(state, {
        id: `evm:liquidity:${address.chain}:${hash}`,
        edgeType: "unknown_token_liquidity",
        ...commonEdge,
        evidenceRefs: evidenceIds.map((id) => ({
          id,
          provider: "etherscan",
          payloadId: null,
          confidence: "protocol_correlated"
        }))
      });
    }

    addDetectorResult(state, result);
  }
}

async function runBudgeted<T>(
  state: ExpansionState,
  provider: "range" | "etherscan",
  key: string,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await state.budget.run(provider, key, fn);
  } catch (error) {
    state.partial = true;
    state.notes.push(providerFailureNote(provider, key, error));
    return null;
  }
}

function buildCorridorPath(
  state: ExpansionState,
  riskLayer: RiskLayerScore,
  hasDataExhaustedLayer: boolean
): CrossChainCorridorPath {
  const switchNote = assetTrackSwitchNote(state);
  const terminalBoundary = terminalFromLayer(riskLayer);
  const sourcePolicyEvidence = sourcePolicyEvidenceFromCrossChainLayer(riskLayer, {
    aggregateShare: selectedShare(state.originPaths),
    effectiveShare: selectedShare(state.originPaths),
    pathCount: Math.max(1, state.originPaths.length)
  });

  return {
    id: `cross-chain-corridor:${state.trigger.reason ?? "triggered"}:${selectedTxHashes(state.trigger, state.originPaths).join(",")}`,
    triggerReason: state.trigger.reason ?? "manual_deep_mode",
    balanceTransferTxHashes: selectedTxHashes(state.trigger, state.originPaths),
    targetAmountRaw: state.trigger.targetAmountRaw,
    selectedAmountRaw: state.trigger.selectedAmountRaw,
    edges: state.edges,
    terminalBoundary,
    riskLayer,
    sourcePolicyEvidence,
    partial: state.partial || hasDataExhaustedLayer || terminalBoundary === "data_exhausted",
    reasons: uniqueStrings([...riskLayer.reasons, switchNote].filter((reason): reason is string => Boolean(reason))),
    warnings: [...riskLayer.warnings]
  };
}

function edgeFromTransfer(transfer: CrossChainTransfer): CrossChainRouteEdge {
  return {
    id: `range:${transfer.id}`,
    edgeType: "bridge_protocol_link",
    source: transfer.source,
    destination: transfer.destination,
    txHash: transfer.destinationTxHash ?? transfer.sourceTxHash,
    amountRaw: transfer.amountRaw,
    assetSymbol: transfer.assetSymbol,
    timestamp: transfer.timestamp,
    protocol: transfer.protocol,
    evidenceRefs: [...transfer.evidenceRefs],
    labels: [...transfer.labels]
  };
}

function hardEvidenceFromLayer(layer: RiskLayerScore): WhereIsMoneyHardBadEvidence {
  return {
    kind: "sanctioned_service",
    score: layer.score,
    message: "Exact sanctioned service evidence found in cross-chain corridor.",
    evidenceIds: [...layer.evidenceIds]
  };
}

function incompleteProviderDataNote(riskLayers: RiskLayerScore[]): string {
  const text = riskLayers
    .filter((layer) => layer.kind === "cross_chain_data_exhausted")
    .flatMap((layer) => [...layer.reasons, ...layer.warnings])
    .join(" ")
    .toLowerCase();

  if (text.includes("token metadata")) {
    return "Incomplete EVM provider data: token metadata was unavailable for a matched liquidity event.";
  }

  return "Incomplete provider data blocked full cross-chain corridor continuation.";
}

function providerFailureNote(provider: "range" | "etherscan", key: string, error: unknown): string {
  const message = error instanceof Error && error.message
    ? `: ${error.message}`
    : ".";
  return `Cross-chain provider call failed for ${provider}:${key}${message}`;
}

function addDetectorResult(state: ExpansionState, result: CrossChainDetectorResult): void {
  if (result.terminalBoundary === "none" && result.score === 0) return;
  state.detectorResults.push(result);
}

function addEdge(state: ExpansionState, edge: CrossChainRouteEdge): void {
  if (state.edges.some((existing) => existing.id === edge.id)) return;
  state.edges.push(edge);
}

function internalTransferDiscriminator(transaction: EvmInternalTransaction): string {
  return [
    transaction.traceId ?? "",
    transaction.from ?? "",
    transaction.to ?? "",
    transaction.value ?? "",
    transaction.type ?? ""
  ].join(":").toLowerCase();
}

function erc20TransferDiscriminator(transfer: EvmTokenTransfer, occurrenceIndex: number): string {
  return [
    occurrenceIndex.toString(),
    transfer.transactionIndex ?? "",
    transfer.contractAddress ?? "",
    transfer.from ?? "",
    transfer.to ?? "",
    transfer.value ?? ""
  ].join(":").toLowerCase();
}

function sortedRiskLayers(results: CrossChainDetectorResult[]): RiskLayerScore[] {
  return [...results]
    .filter((result) => result.terminalBoundary !== "none" || result.score > 0)
    .sort((left, right) => {
      const byTerminal = TERMINAL_PRIORITY[right.terminalBoundary] - TERMINAL_PRIORITY[left.terminalBoundary];
      if (byTerminal !== 0) return byTerminal;
      return right.score - left.score;
    })
    .map((result) => ({
      evidenceClass: result.evidenceClass,
      kind: result.kind,
      sourceExposureKind: result.sourceExposureKind,
      score: result.score,
      rawScore: result.rawScore,
      adjustedScore: result.adjustedScore,
      proofLevel: result.proofLevel,
      canBeDampened: result.canBeDampened,
      capApplied: result.capApplied,
      floorApplied: result.floorApplied,
      reasons: [...result.reasons],
      warnings: [...result.warnings],
      evidenceIds: [...result.evidenceIds]
    }));
}

function fallbackLayer(): RiskLayerScore {
  return {
    evidenceClass: "data_quality",
    kind: "cross_chain_none",
    score: 0,
    rawScore: 0,
    adjustedScore: 0,
    proofLevel: "insufficient_coverage",
    canBeDampened: true,
    reasons: ["No cross-chain terminal boundary was detected."],
    warnings: [],
    evidenceIds: []
  };
}

function terminalFromLayer(layer: RiskLayerScore): CrossChainTerminalBoundary {
  if (layer.kind.startsWith("cross_chain_")) {
    const value = layer.kind.slice("cross_chain_".length);
    if (value in TERMINAL_PRIORITY) {
      return value as CrossChainTerminalBoundary;
    }
  }

  return "none";
}

function addressDiscoveryScope(state: ExpansionState): Pick<CrossChainAddressQuery, "timeWindow" | "assetSymbol" | "minAmountRaw"> {
  return {
    timeWindow: selectedPathTimeWindow(state.originPaths),
    assetSymbol: selectedPathAssetSymbol(state.originPaths),
    minAmountRaw: selectedPathMinAmountRaw(state.originPaths)
  };
}

function selectedPathTimeWindow(originPaths: MoneyOriginPath[]): TimeWindow | undefined {
  const timestamps = originPaths
    .flatMap((path) => path.steps.map((step) => Date.parse(step.timestamp)))
    .filter((timestamp) => Number.isFinite(timestamp));

  if (timestamps.length === 0) return undefined;

  const twoHoursMs = 2 * 60 * 60 * 1000;
  return {
    start: new Date(Math.min(...timestamps) - twoHoursMs).toISOString(),
    end: new Date(Math.max(...timestamps) + twoHoursMs).toISOString()
  };
}

function selectedPathAssetSymbol(originPaths: MoneyOriginPath[]): string | undefined {
  const text = originPaths
    .flatMap((path) => [
      path.exposureSourceKey,
      path.exposureSourceLabel,
      path.sourceExposureKind,
      ...path.reasons
    ])
    .join(" ")
    .toUpperCase();

  if (text.includes("USDT")) return "USDT";
  if (text.includes("USDC")) return "USDC";
  return undefined;
}

function selectedPathMinAmountRaw(originPaths: MoneyOriginPath[]): string | undefined {
  let min: bigint | null = null;

  for (const amount of originPaths.flatMap((path) => path.steps.map((step) => step.amountRaw))) {
    if (!/^\d+$/.test(amount)) continue;
    const parsed = BigInt(amount);
    if (parsed <= 0n) continue;
    if (min === null || parsed < min) min = parsed;
  }

  return min === null ? undefined : ((min * 65n) / 100n).toString();
}

function selectedTxHashes(trigger: CrossChainStage2TriggerEvaluation, originPaths: MoneyOriginPath[]): string[] {
  return uniqueStrings([
    ...trigger.balanceTransferTxHashes,
    ...originPaths.map((path) => path.balanceTransferTxHash),
    ...originPaths.flatMap((path) => path.txHashes)
  ].filter(Boolean));
}

function boundaryActors(subjectAddress: string, originPaths: MoneyOriginPath[]): string[] {
  return uniqueStrings([
    subjectAddress,
    ...originPaths.map((path) => path.rootSourceAddress),
    ...originPaths.flatMap((path) => path.pathAddresses),
    ...originPaths.flatMap((path) => path.steps.flatMap((step) => [step.fromAddress, step.toAddress]))
  ].filter((address): address is string => Boolean(address)));
}

function transferAddresses(transfers: CrossChainTransfer[]): CrossChainAddress[] {
  const addresses: CrossChainAddress[] = [];
  const seen = new Set<string>();

  for (const transfer of transfers) {
    for (const address of [transfer.source, transfer.destination]) {
      const key = `${String(address.chain).toLowerCase()}:${address.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      addresses.push(address);
    }
  }

  return addresses;
}

function evmAddressesFromTransfers(transfers: CrossChainTransfer[]): Array<CrossChainAddress & { chain: EvmChain }> {
  return transferAddresses(transfers).filter((address): address is CrossChainAddress & { chain: EvmChain } =>
    address.chain === "ethereum" || address.chain === "arbitrum"
  );
}

function evmTxHashesForAddress(
  transfers: CrossChainTransfer[],
  address: CrossChainAddress & { chain: EvmChain }
): string[] {
  return uniqueStrings(transfers.flatMap((transfer) => {
    const hashes: string[] = [];
    if (same(String(transfer.source.chain), address.chain) && same(transfer.source.address, address.address) && transfer.sourceTxHash) {
      hashes.push(transfer.sourceTxHash);
    }
    if (
      same(String(transfer.destination.chain), address.chain) &&
      same(transfer.destination.address, address.address) &&
      transfer.destinationTxHash
    ) {
      hashes.push(transfer.destinationTxHash);
    }
    return hashes;
  }));
}

function transferKey(transfer: CrossChainTransfer): string {
  return [
    transfer.source.chain,
    transfer.source.address,
    transfer.destination.chain,
    transfer.destination.address,
    transfer.sourceTxHash,
    transfer.destinationTxHash,
    transfer.amountRaw,
    transfer.assetSymbol,
    transfer.timestamp,
    transfer.protocol
  ].join("|").toLowerCase();
}

function isWeakOnlyTransfer(transfer: CrossChainTransfer): boolean {
  const text = [transfer.protocol, ...transfer.labels, ...transfer.evidenceRefs.map((ref) => ref.confidence)].join(" ").toLowerCase();
  const hasWeakHeuristic = text.includes("same amount") ||
    text.includes("time-only") ||
    text.includes("amount-time") ||
    text.includes("weak");
  const hasStrongerEvidence = transfer.evidenceRefs.some((ref) =>
    ref.confidence === "exact" ||
    ref.confidence === "provider_correlated" ||
    ref.confidence === "protocol_correlated"
  );
  const allEvidenceRefsWeak = transfer.evidenceRefs.length === 0 ||
    transfer.evidenceRefs.every((ref) => ref.confidence === "weak");

  return hasWeakHeuristic && allEvidenceRefsWeak && !hasStrongerEvidence;
}

function selectedShare(originPaths: MoneyOriginPath[]): number {
  const values = originPaths
    .map((path) => path.effectiveExposureShare ?? path.balanceShare)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) return 1;
  return Math.max(0, Math.min(1, Math.max(...values)));
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function uniquePayloadRefs(payloadRefs: ProviderPayloadRef[]): ProviderPayloadRef[] {
  const seen = new Set<string>();
  const result: ProviderPayloadRef[] = [];

  for (const payloadRef of payloadRefs) {
    if (seen.has(payloadRef.id)) continue;
    seen.add(payloadRef.id);
    result.push(payloadRef);
  }

  return result;
}

function addressQueryKey(query: CrossChainAddressQuery): string {
  return [
    query.chain ?? "",
    query.address,
    query.assetSymbol ?? "",
    query.minAmountRaw ?? "",
    query.timeWindow?.start ?? "",
    query.timeWindow?.end ?? ""
  ].join("|").toLowerCase();
}

function evmAddress(chain: EvmChain, address: string | null | undefined): CrossChainAddress | null {
  if (!address) return null;
  return {
    chain,
    chainId: chain === "ethereum" ? 1 : 42161,
    address
  };
}

function evmEvidence(chain: EvmChain, sourceId: string, kind: string): CrossChainEvidenceRef {
  return {
    id: crossChainEvidenceId("etherscan", chain, sourceId, kind),
    provider: "etherscan",
    payloadId: null,
    confidence: "protocol_correlated"
  };
}

function nativeSymbol(chain: EvmChain): string {
  void chain;
  return "ETH";
}

function evmTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }
  return value;
}

function counterpartyForAddress(address: string, from: string | null | undefined, to: string | null | undefined): string | null {
  if (same(address, from)) return to ?? null;
  if (same(address, to)) return from ?? null;
  return from ?? to ?? null;
}

function same(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function tokenMetadataForTransfers(metadata: EvmTokenMetadata[], transfers: EvmTokenTransfer[]): EvmTokenMetadata[] {
  const contracts = new Set(transfers
    .map((transfer) => transfer.contractAddress?.toLowerCase())
    .filter((contract): contract is string => Boolean(contract)));

  return metadata.filter((token) => contracts.has(token.tokenContract.toLowerCase()));
}

function fallbackTokenMetadata(
  chain: EvmChain,
  tokenContract: string,
  transfers: EvmTokenTransfer[]
): EvmTokenMetadata | null {
  const transfer = transfers.find((candidate) =>
    same(candidate.contractAddress, tokenContract) &&
    Boolean(candidate.tokenSymbol?.trim() || candidate.tokenName?.trim() || candidate.tokenDecimal?.trim())
  );

  if (!transfer) return null;

  return {
    chain,
    tokenContract,
    tokenName: transfer.tokenName,
    tokenSymbol: transfer.tokenSymbol,
    tokenDecimal: transfer.tokenDecimal
  };
}

function maxRaw(values: readonly (string | null | undefined)[]): string | null {
  let max: bigint | null = null;
  for (const value of values) {
    if (!value || !/^\d+$/.test(value)) continue;
    const parsed = BigInt(value);
    if (max === null || parsed > max) max = parsed;
  }
  return max?.toString() ?? null;
}

function assetTrackSwitchNote(state: ExpansionState): string | null {
  const hasUsdt = state.transfers.some((transfer) => transfer.assetSymbol.toUpperCase() === "USDT") ||
    state.edges.some((edge) => edge.assetSymbol?.toUpperCase() === "USDT");
  const hasNativeEth = state.transfers.some((transfer) => transfer.assetSymbol.toUpperCase() === "ETH") ||
    state.edges.some((edge) => edge.assetSymbol?.toUpperCase() === "ETH" && edge.amountRaw && edge.amountRaw !== "0");

  return hasUsdt && hasNativeEth
    ? "asset-track switch observed: USDT bridge leg followed by ETH/native transfer."
    : null;
}
