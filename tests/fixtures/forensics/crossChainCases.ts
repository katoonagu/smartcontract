import type { FixtureCrossChainDiscoveryData } from "../../../src/forensics/crossChainProviders";

const rangeEthereumTronPayloadId = "range:transfers/by-tx:ethereum:0x72846a16";

export const manualGaryStargateTornadoCase = {
  name: "manual_gary_stargate_tornado_case",
  subjectAddress: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD",
  data: {
    transfers: [
      {
        id: "range-ethereum-tron-usdt-100k",
        protocol: "LayerZero/Stargate",
        source: {
          chain: "ethereum",
          chainId: 1,
          address: "0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315"
        },
        destination: {
          chain: "tron",
          chainId: "tron-mainnet",
          address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD"
        },
        sourceTxHash: "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f",
        destinationTxHash: null,
        assetSymbol: "USDT",
        amountRaw: "100000000000",
        decimals: 6,
        timestamp: "2026-05-05T02:41:59.000Z",
        evidenceRefs: [{
          id: "cross_chain:range:ethereum:0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f:bridge_source",
          provider: "range",
          payloadId: rangeEthereumTronPayloadId,
          confidence: "provider_correlated"
        }],
        payloadRef: {
          id: rangeEthereumTronPayloadId,
          provider: "range",
          endpoint: "transfers/by-tx",
          fetchedAt: "2026-06-01T00:00:00.000Z"
        },
        labels: ["LayerZero", "Stargate"]
      },
      {
        id: "manual-arbitrum-ethereum-eth-24777",
        protocol: "LayerZero/Stargate",
        source: {
          chain: "arbitrum",
          chainId: 42161,
          address: "0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7"
        },
        destination: {
          chain: "ethereum",
          chainId: 1,
          address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
        },
        sourceTxHash: null,
        destinationTxHash: null,
        assetSymbol: "ETH",
        amountRaw: "247770000000000000000",
        decimals: 18,
        timestamp: "2026-05-05T01:11:26.000Z",
        evidenceRefs: [],
        payloadRef: null,
        labels: ["LayerZero", "Stargate"]
      },
      {
        id: "manual-arbitrum-ethereum-eth-250",
        protocol: "LayerZero/Stargate",
        source: {
          chain: "arbitrum",
          chainId: 42161,
          address: "0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7"
        },
        destination: {
          chain: "ethereum",
          chainId: 1,
          address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
        },
        sourceTxHash: null,
        destinationTxHash: null,
        assetSymbol: "ETH",
        amountRaw: "250000000000000000000",
        decimals: 18,
        timestamp: "2026-05-05T01:05:45.000Z",
        evidenceRefs: [],
        payloadRef: null,
        labels: ["LayerZero", "Stargate"]
      }
    ],
    riskSnapshots: [
      {
        address: {
          chain: "ethereum",
          chainId: 1,
          address: "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60"
        },
        provider: "local",
        riskScore: 90,
        labels: ["Tornado-funded actor", "Stargate recipient"],
        evidenceRefs: [{
          id: "cross_chain:local:ethereum:0x7c3721c33ce975118d1bf3f153c8ebb8945e5f60:tornado_context",
          provider: "local",
          payloadId: null,
          confidence: "protocol_correlated"
        }],
        payloadRef: null
      },
      {
        address: {
          chain: "arbitrum",
          chainId: 42161,
          address: "0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b"
        },
        provider: "local",
        riskScore: 95,
        labels: ["Tornado.Cash: 100 ETH", "BolshoyJoe"],
        evidenceRefs: [{
          id: "cross_chain:local:arbitrum:0xeb2cdf39fc5afa85bba1467e209974d9b19fa68b:tornado_cash_100_eth",
          provider: "local",
          payloadId: null,
          confidence: "protocol_correlated"
        }],
        payloadRef: null
      }
    ]
  }
} as const satisfies {
  name: string;
  subjectAddress: string;
  data: FixtureCrossChainDiscoveryData;
};
