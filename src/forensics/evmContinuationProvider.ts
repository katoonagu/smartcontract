import type { CrossChainAddress, CrossChainEvidenceRef, CrossChainRouteEdgeType } from "../types";
import { classifyContinuationEdge } from "./bridgeContinuationScorer";
import { crossChainEvidenceId } from "./crossChainEvidence";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge
} from "./crossChainContinuationTypes";
import type {
  EvmChain,
  EvmEvidenceProvider,
  EvmInternalTransaction,
  EvmTokenTransfer,
  EvmTransaction
} from "./evmExplorerClient";

type CreateEvmContinuationProviderInput = {
  chain: EvmChain;
  evmProvider: EvmEvidenceProvider;
};

const CHAIN_IDS: Record<EvmChain, number> = {
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
  return { ...classified, protocol: edge.protocol, labels: edge.labels };
}

export function createEvmContinuationProvider(input: CreateEvmContinuationProviderInput): ChainContinuationProvider {
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

      return dedupe([
        ...forChain(input.chain, normal).filter(successfulNormalTransaction).map((tx) => normalEdge(input.chain, tx)),
        ...withFingerprintOccurrences(
          forChain(input.chain, internal).filter(successfulInternalTransaction),
          internalFingerprint
        ).map(({ row, occurrence }) => internalEdge(input.chain, row, occurrence)),
        ...withFingerprintOccurrences(forChain(input.chain, erc20), tokenFingerprint)
          .map(({ row, occurrence }) => tokenEdge(input.chain, row, occurrence))
      ]).map((edge) => classifyRawExplorerEdge(edge, query.seed));
    }
  };
}
