import type { CrossChainAddress, CrossChainEvidenceRef, CrossChainRouteEdgeType } from "../types";
import { classifyContinuationEdge } from "./bridgeContinuationScorer";
import { crossChainEvidenceId } from "./crossChainEvidence";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge,
  CrossChainContinuationSeed
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
    confidence: "protocol_correlated"
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

function internalEdge(chain: EvmChain, tx: EvmInternalTransaction): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:internal:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}:${tx.traceId ?? ""}`,
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

function tokenEdge(chain: EvmChain, tx: EvmTokenTransfer): CrossChainContinuationEdge {
  return edgeBase({
    chain,
    id: `evm-continuation:erc20:${chain}:${tx.hash ?? `${tx.from ?? ""}:${tx.to ?? ""}`}:${tx.contractAddress ?? ""}:${tx.value ?? ""}`,
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

function classify(seed: CrossChainContinuationSeed, edge: CrossChainContinuationEdge): CrossChainContinuationEdge {
  const evidenceRefs = edge.evidenceRefs;
  const classified = classifyContinuationEdge(seed, { ...edge, evidenceRefs: [] });
  return { ...classified, evidenceRefs };
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
      edge.tokenContract
    ].join("|").toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }

  return result;
}

export function createEvmContinuationProvider(input: CreateEvmContinuationProviderInput): ChainContinuationProvider {
  return {
    chain: input.chain,

    async listEdgesForAddress(query) {
      const addressValue = query.address.address;
      const [normal, internal, erc20] = await Promise.all([
        query.budget.run("etherscan", `continuation:normal:${input.chain}:${addressValue}`, () =>
          input.evmProvider.listNormalTransactions({ chain: input.chain, address: addressValue, pageLimit: 2 })
        ),
        query.budget.run("etherscan", `continuation:internal:${input.chain}:${addressValue}`, () =>
          input.evmProvider.listInternalTransactions({ chain: input.chain, address: addressValue, pageLimit: 2 })
        ),
        query.budget.run("etherscan", `continuation:erc20:${input.chain}:${addressValue}`, () =>
          input.evmProvider.listErc20Transfers({ chain: input.chain, address: addressValue, pageLimit: 2 })
        )
      ]);

      return dedupe([
        ...forChain(input.chain, normal).map((tx) => normalEdge(input.chain, tx)),
        ...forChain(input.chain, internal).map((tx) => internalEdge(input.chain, tx)),
        ...forChain(input.chain, erc20).map((tx) => tokenEdge(input.chain, tx))
      ]).map((edge) => classify(query.seed, edge));
    }
  };
}
