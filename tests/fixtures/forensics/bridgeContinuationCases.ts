import type {
  CrossChainContinuationEdge,
  CrossChainContinuationSeed
} from "../../../src/forensics/crossChainContinuationTypes";

export const bsc320kSeed: CrossChainContinuationSeed = {
  id: "seed:allbridge:bsc:320k",
  chain: "bsc",
  address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da",
  txHash: "allbridge-bsc-receive",
  amountRaw: "309899218851",
  assetSymbol: "USDT",
  timestamp: "2026-05-09T23:45:00.000Z",
  labels: ["Allbridge LP-USDT"],
  evidenceRefs: [{
    id: "cross_chain:range:bsc:allbridge-bsc-receive:bridge_destination",
    provider: "range",
    payloadId: "range:allbridge:320k",
    confidence: "provider_correlated"
  }]
};

export const bsc320kEdges: CrossChainContinuationEdge[] = [
  {
    id: "bsc-usdt-small",
    edgeType: "token_transfer",
    source: { chain: "bsc", chainId: 56, address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da" },
    destination: { chain: "bsc", chainId: 56, address: "0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F" },
    txHash: "0x4a5a2104e0f90e4f78ac49663d32b59c2cdd59353da17f7aa94c0d3c61f1def2",
    amountRaw: "10000000",
    assetSymbol: "USDT",
    timestamp: "2026-05-09T23:46:34.000Z",
    protocol: null,
    evidenceRefs: [],
    labels: ["Tether USD", "USDT"],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  },
  {
    id: "bsc-usdt-large",
    edgeType: "token_transfer",
    source: { chain: "bsc", chainId: 56, address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da" },
    destination: { chain: "bsc", chainId: 56, address: "0xF874c3Ed7196B5Dc72B6D83a8d30B2aF290A815F" },
    txHash: "0x56097e079fee279970992b509ca7ac6ff974577647ab800cee22ffaecbcdc369",
    amountRaw: "309889218851",
    assetSymbol: "USDT",
    timestamp: "2026-05-09T23:49:26.000Z",
    protocol: null,
    evidenceRefs: [],
    labels: ["Tether USD", "USDT"],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  }
];
