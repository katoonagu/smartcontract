import type { CrossChainAddress, CrossChainEvidenceRef, CrossChainRouteEdgeType } from "../types";
import { classifyContinuationEdge } from "./bridgeContinuationScorer";
import { crossChainEvidenceId } from "./crossChainEvidence";
import { detectKnownMixerOrSanctionedService } from "./crossChainDetectors";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge
} from "./crossChainContinuationTypes";
import type {
  EvmChain,
  EvmEvidenceProvider,
  EvmInternalTransaction,
  EvmTransactionReceipt,
  EvmTokenTransfer,
  EvmTransaction
} from "./evmExplorerClient";
import { createLayerZeroScanClient, type LayerZeroScanClient, type LayerZeroScanMessage } from "./layerZeroScanClient";

type CreateEvmContinuationProviderInput = {
  chain: EvmChain;
  evmProvider: EvmEvidenceProvider;
  layerZeroScanClient?: LayerZeroScanClient | null;
};

const CHAIN_IDS: Record<EvmChain, number> = {
  ethereum: 1,
  arbitrum: 42161,
  bsc: 56
};

const STARGATE_RECEIVED_TOPIC = "0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c";

const CHAIN_IDS_BY_NAME: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  bsc: 56
};

function timestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }

  return value;
}

function nativeSymbol(chain: EvmChain): string {
  return chain === "bsc" ? "BNB" : "ETH";
}

function address(chain: EvmChain, value: string | null | undefined): CrossChainAddress | null {
  if (!value) return null;
  return { chain, chainId: CHAIN_IDS[chain], address: value };
}

function evidence(chain: EvmChain, txHash: string | null | undefined, kind: string): CrossChainEvidenceRef {
  return {
    id: crossChainEvidenceId("etherscan", chain, txHash ?? "unknown", kind),
    provider: "etherscan",
    payloadId: null,
    confidence: "weak"
  };
}

function present(value: string | null | undefined): value is string {
  return Boolean(value);
}

function edgeBase(input: {
  chain: EvmChain;
  id: string;
  edgeType: CrossChainRouteEdgeType;
  source: string | null | undefined;
  destination: string | null | undefined;
  txHash: string | null | undefined;
  amountRaw: string | null | undefined;
  assetSymbol: string | null;
  tokenContract?: string | null;
  timestamp: string | null;
  protocol: string | null;
  evidenceKind: string;
  labels: string[];
}): CrossChainContinuationEdge {
  return {
    id: input.id,
    edgeType: input.edgeType,
    source: address(input.chain, input.source),
    destination: address(input.chain, input.destination),
    txHash: input.txHash ?? null,
    amountRaw: input.amountRaw ?? null,
    assetSymbol: input.assetSymbol,
    tokenContract: input.tokenContract,
    timestamp: input.timestamp,
    protocol: input.protocol,
    evidenceRefs: [evidence(input.chain, input.txHash, input.evidenceKind)],
    labels: input.labels,
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  };
}

function normalEdge(chain: EvmChain, tx: EvmTransaction): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:normal:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}`,
    edgeType: "native_transfer",
    source: tx.from,
    destination: tx.to,
    txHash: tx.hash,
    amountRaw: tx.value,
    assetSymbol: nativeSymbol(chain),
    timestamp: timestamp(tx.timeStamp),
    protocol: null,
    evidenceKind: "native_transfer",
    labels: [tx.functionName, tx.methodId].filter(present)
  });
}

function internalEdge(chain: EvmChain, tx: EvmInternalTransaction, index: number): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:internal:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}:${tx.traceId ?? internalFallbackDiscriminator(tx, index)}`,
    edgeType: "internal_transfer",
    source: tx.from,
    destination: tx.to,
    txHash: tx.hash,
    amountRaw: tx.value,
    assetSymbol: nativeSymbol(chain),
    timestamp: timestamp(tx.timeStamp),
    protocol: null,
    evidenceKind: "internal_transfer",
    labels: [tx.type].filter(present)
  });
}

function tokenEdge(chain: EvmChain, tx: EvmTokenTransfer, index: number): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:erc20:${chain}:${tokenFingerprint(tx)}:occurrence:${index}`,
    edgeType: "token_transfer",
    source: tx.from,
    destination: tx.to,
    txHash: tx.hash,
    amountRaw: tx.value,
    assetSymbol: tx.tokenSymbol ?? null,
    tokenContract: tx.contractAddress ?? null,
    timestamp: timestamp(tx.timeStamp),
    protocol: null,
    evidenceKind: "token_transfer",
    labels: [tx.tokenName, tx.tokenSymbol].filter(present)
  });
}

function forChain<T extends { chain: EvmChain }>(chain: EvmChain, rows: T[]): T[] {
  return rows.filter((row) => row.chain === chain);
}

function successfulNormalTransaction(tx: EvmTransaction): boolean {
  return tx.isError !== "1" && tx.txReceiptStatus !== "0";
}

function successfulInternalTransaction(tx: EvmInternalTransaction): boolean {
  return tx.isError !== "1" && !present(tx.errCode);
}

function stablePart(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function tokenFingerprint(tx: EvmTokenTransfer): string {
  return [
    tx.hash,
    tx.from,
    tx.to,
    tx.contractAddress,
    tx.value,
    tx.tokenSymbol,
    tx.timeStamp,
    tx.blockNumber,
    tx.transactionIndex
  ].map(stablePart).join(":");
}

function internalFingerprint(tx: EvmInternalTransaction): string {
  return [
    tx.hash,
    tx.from,
    tx.to,
    tx.value,
    tx.type,
    tx.timeStamp,
    tx.blockNumber
  ].map(stablePart).join(":");
}

function internalFallbackDiscriminator(tx: EvmInternalTransaction, occurrence: number): string {
  return `${internalFingerprint(tx)}:occurrence:${occurrence}`;
}

function withFingerprintOccurrences<T>(rows: T[], fingerprint: (row: T) => string): Array<{ row: T; occurrence: number }> {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const key = fingerprint(row);
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return { row, occurrence };
  });
}

function dedupe(edges: CrossChainContinuationEdge[]): CrossChainContinuationEdge[] {
  const seen = new Set<string>();
  const result: CrossChainContinuationEdge[] = [];

  for (const edge of edges) {
    const key = [
      edge.edgeType,
      edge.txHash,
      edge.source?.address,
      edge.destination?.address,
      edge.amountRaw,
      edge.assetSymbol,
      edge.tokenContract,
      edge.id
    ].join("|").toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }

  return result;
}

function classifyRawExplorerEdge(edge: CrossChainContinuationEdge, seed: Parameters<typeof classifyContinuationEdge>[0]): CrossChainContinuationEdge {
  const classified = classifyContinuationEdge(seed, { ...edge, protocol: null, labels: [] });
  return promoteKnownServiceEdge({ ...classified, protocol: edge.protocol, labels: edge.labels });
}

function promoteKnownServiceEdge(edge: CrossChainContinuationEdge): CrossChainContinuationEdge {
  const labels = [edge.protocol, ...edge.labels].filter((label): label is string => Boolean(label?.trim()));
  const source = detectKnownMixerOrSanctionedService({
    chain: String(edge.source?.chain ?? ""),
    address: edge.source?.address ?? null,
    labels,
    protocol: edge.protocol,
    evidenceRefs: edge.evidenceRefs
  });
  const destination = detectKnownMixerOrSanctionedService({
    chain: String(edge.destination?.chain ?? ""),
    address: edge.destination?.address ?? null,
    labels,
    protocol: edge.protocol,
    evidenceRefs: edge.evidenceRefs
  });
  const terminalBoundary = source.terminalBoundary !== "none" ? source.terminalBoundary : destination.terminalBoundary;
  if (terminalBoundary === "none") return edge;

  return {
    ...edge,
    continuationEvidenceClass: "protocol_correlated",
    score: Math.max(edge.score, terminalBoundary === "sanctioned_service" ? 98 : 90),
    reasons: [
      ...edge.reasons,
      "Known mixer or sanctioned service address/label matched on an exact explorer transfer."
    ],
    labels: edge.labels.length > 0 ? edge.labels : [terminalBoundary]
  };
}

async function layerZeroEdgesForBaseEdges(input: {
  chain: EvmChain;
  evmProvider: EvmEvidenceProvider;
  layerZeroScanClient: LayerZeroScanClient | null;
  budget: Parameters<ChainContinuationProvider["listEdgesForAddress"]>[0]["budget"];
  address: CrossChainAddress;
  baseEdges: CrossChainContinuationEdge[];
}): Promise<CrossChainContinuationEdge[]> {
  if (!input.layerZeroScanClient) return [];

  const results: CrossChainContinuationEdge[] = [];
  const seenGuids = new Set<string>();
  for (const edge of input.baseEdges) {
    if (!edge.txHash || !sameAddress(edge.destination, input.address)) continue;
    const receipt = await input.budget
      .run("etherscan", `continuation:receipt:${input.chain}:${edge.txHash}`, () =>
        input.evmProvider.getTransactionReceipt({ chain: input.chain, txHash: edge.txHash! })
      )
      .catch(() => null);
    if (!receipt) continue;

    for (const guid of layerZeroGuids(receipt)) {
      if (seenGuids.has(guid)) continue;
      seenGuids.add(guid);
      const message = await input.budget
        .run("layerzero", `message-guid:${guid}`, () => input.layerZeroScanClient!.getMessageByGuid(guid))
        .catch(() => null);
      const linked = layerZeroEdgeForMessage({ guid, message, edge, address: input.address });
      if (linked) results.push(linked);
    }
  }

  return results;
}

function layerZeroGuids(receipt: EvmTransactionReceipt): string[] {
  const guids: string[] = [];
  for (const log of receipt.logs) {
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 !== STARGATE_RECEIVED_TOPIC) continue;
    const guid = normalizeGuid(log.topics[1]);
    if (guid) guids.push(guid);
  }

  return [...new Set(guids)];
}

function layerZeroEdgeForMessage(input: {
  guid: string;
  message: LayerZeroScanMessage | null;
  edge: CrossChainContinuationEdge;
  address: CrossChainAddress;
}): CrossChainContinuationEdge | null {
  const sourceChain = input.message?.source.chain;
  const sourceTx = input.message?.source.tx;
  if (!sourceChain || !sourceTx?.from || !sourceTx.txHash) return null;

  return {
    id: `layerzero-continuation:${input.guid}`,
    edgeType: "bridge_protocol_link",
    source: {
      chain: sourceChain,
      chainId: CHAIN_IDS_BY_NAME[sourceChain] ?? sourceChain,
      address: sourceTx.from
    },
    destination: input.address,
    txHash: sourceTx.txHash,
    amountRaw: input.edge.amountRaw,
    assetSymbol: input.edge.assetSymbol,
    tokenContract: input.edge.tokenContract,
    timestamp: sourceTx.blockTimestamp !== undefined
      ? new Date(sourceTx.blockTimestamp * 1000).toISOString()
      : input.edge.timestamp,
    protocol: "LayerZero/Stargate",
    evidenceRefs: [{
      id: crossChainEvidenceId("layerzero", sourceChain, input.guid, "message_guid"),
      provider: "layerzero",
      payloadId: `layerzero:message:${input.guid}`,
      confidence: "provider_correlated"
    }],
    labels: [
      `layerzero_guid:${input.guid}`,
      `destination_tx:${input.message?.destination.tx?.txHash ?? input.edge.txHash ?? "unknown"}`
    ],
    continuationEvidenceClass: "protocol_correlated",
    score: Math.max(input.edge.score, 95),
    reasons: [
      "LayerZero Scan correlated the destination bridge delivery to its source-chain transaction."
    ]
  };
}

function normalizeGuid(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function sameAddress(left: CrossChainAddress | null | undefined, right: CrossChainAddress | null | undefined): boolean {
  return Boolean(
    left &&
    right &&
    String(left.chain).toLowerCase() === String(right.chain).toLowerCase() &&
    left.address.toLowerCase() === right.address.toLowerCase()
  );
}

export function createEvmContinuationProvider(input: CreateEvmContinuationProviderInput): ChainContinuationProvider {
  const layerZeroScanClient = input.layerZeroScanClient === undefined
    ? createLayerZeroScanClient()
    : input.layerZeroScanClient;

  return {
    chain: input.chain,

    async listEdgesForAddress(query) {
      const addressValue = query.address.address;
      const normal = await query.budget
        .run("etherscan", `continuation:normal:${input.chain}:${addressValue}`, () =>
          input.evmProvider.listNormalTransactions({ chain: input.chain, address: addressValue, pageLimit: 2 })
        )
        .catch(() => []);
      const internal = await query.budget
        .run("etherscan", `continuation:internal:${input.chain}:${addressValue}`, () =>
          input.evmProvider.listInternalTransactions({ chain: input.chain, address: addressValue, pageLimit: 2 })
        )
        .catch(() => []);
      const erc20 = await query.budget
        .run("etherscan", `continuation:erc20:${input.chain}:${addressValue}`, () =>
          input.evmProvider.listErc20Transfers({ chain: input.chain, address: addressValue, pageLimit: 2 })
        )
        .catch(() => []);

      const baseEdges = dedupe([
        ...forChain(input.chain, normal).filter(successfulNormalTransaction).map((tx) => normalEdge(input.chain, tx)),
        ...withFingerprintOccurrences(
          forChain(input.chain, internal).filter(successfulInternalTransaction),
          internalFingerprint
        ).map(({ row, occurrence }) => internalEdge(input.chain, row, occurrence)),
        ...withFingerprintOccurrences(forChain(input.chain, erc20), tokenFingerprint)
          .map(({ row, occurrence }) => tokenEdge(input.chain, row, occurrence))
      ]).map((edge) => classifyRawExplorerEdge(edge, query.seed));

      const layerZeroEdges = await layerZeroEdgesForBaseEdges({
        chain: input.chain,
        evmProvider: input.evmProvider,
        layerZeroScanClient,
        budget: query.budget,
        address: query.address,
        baseEdges
      });

      return dedupe([...baseEdges, ...layerZeroEdges]);
    }
  };
}
