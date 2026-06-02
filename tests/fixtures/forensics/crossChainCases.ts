import type { FixtureCrossChainDiscoveryData } from "../../../src/forensics/crossChainProviders";
import type {
  EvmInternalTransaction,
  EvmLog,
  EvmTokenMetadata,
  EvmTokenTransfer,
  EvmTransaction,
  EvmTransactionReceipt
} from "../../../src/forensics/evmExplorerClient";

const rangeEthereumTronPayloadId = "range:transfers/by-tx:ethereum:0x72846a16";
const manualBridgeSender = "0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315";
const manualEthereumActor = "0x7C3721C33cE975118D1Bf3F153c8eBB8945e5f60";
const manualArbitrumActor = "0x6Ca63c963948597EAF85C6A193FedF1d96c62eA7";
const manualArbitrumTornadoFunder = "0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b";
const manualStargatePoolNative = "0x8731d54E9D02c286767d56ac03e8037C07e01e98";
const manualUniswapV3PositionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const manualGaryToken = "0xGary000000000000000000000000000000000000";
const manualWethToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const manualRangeSourceTx = "0x72846a16b3c7436b8e878a68b8a4ffd7105b4a2530186ede3500b888b9eb371f";
const manualLiquidityTx = "0xgaryremove000000000000000000000000000000000000000000000000000000";
const manualEthCollectTx = "0xethcollect000000000000000000000000000000000000000000000000000000";
const manualArbitrum247Tx = "0xarb2477700000000000000000000000000000000000000000000000000000000";
const manualArbitrum250Tx = "0xarb2500000000000000000000000000000000000000000000000000000000000";
const manualTornado100Tx = "0xtornado1000000000000000000000000000000000000000000000000000000000";
const uniswapDecreaseLiquidityTopic = "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";
const uniswapCollectTopic = "0x70935338e69775456f0f7988fdb2ae37e682d0ea45f2e276aaa2e36147a76d91";

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
          address: manualBridgeSender
        },
        destination: {
          chain: "tron",
          chainId: "tron-mainnet",
          address: "TGyTCHDm9k4r6QPvine8c6A3WWaqTBZAZD"
        },
        sourceTxHash: manualRangeSourceTx,
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
          address: manualArbitrumActor
        },
        destination: {
          chain: "ethereum",
          chainId: 1,
          address: manualEthereumActor
        },
        sourceTxHash: manualArbitrum247Tx,
        destinationTxHash: manualLiquidityTx,
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
          address: manualArbitrumActor
        },
        destination: {
          chain: "ethereum",
          chainId: 1,
          address: manualEthereumActor
        },
        sourceTxHash: manualArbitrum250Tx,
        destinationTxHash: manualEthCollectTx,
        assetSymbol: "ETH",
        amountRaw: "250000000000000000000",
        decimals: 18,
        timestamp: "2026-05-05T01:05:45.000Z",
        evidenceRefs: [],
        payloadRef: null,
        labels: ["LayerZero", "Stargate"]
      },
      {
        id: "manual-arbitrum-tornado-eth-100",
        protocol: "Tornado.Cash",
        source: {
          chain: "arbitrum",
          chainId: 42161,
          address: manualArbitrumTornadoFunder
        },
        destination: {
          chain: "arbitrum",
          chainId: 42161,
          address: manualArbitrumActor
        },
        sourceTxHash: manualTornado100Tx,
        destinationTxHash: manualTornado100Tx,
        assetSymbol: "ETH",
        amountRaw: "100000000000000000000",
        decimals: 18,
        timestamp: "2026-05-05T01:03:20.000Z",
        evidenceRefs: [{
          id: "cross_chain:range:arbitrum:0xeb2cdf39fc5afa85bba1467e209974d9b19fa68b:tornado_cash_100_eth",
          provider: "range",
          payloadId: "range:transfers/by-address:arbitrum:0x6ca63",
          confidence: "protocol_correlated"
        }],
        payloadRef: {
          id: "range:transfers/by-address:arbitrum:0x6ca63",
          provider: "range",
          endpoint: "transfers/by-address",
          fetchedAt: "2026-06-01T00:00:00.000Z"
        },
        labels: ["Tornado.Cash: 100 ETH funding"]
      }
    ],
    riskSnapshots: [
      {
        address: {
          chain: "ethereum",
          chainId: 1,
          address: manualEthereumActor
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
          address: manualArbitrumTornadoFunder
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

function evmLog(overrides: Partial<EvmLog>): EvmLog {
  return {
    chain: "ethereum",
    address: manualUniswapV3PositionManager,
    topics: [uniswapDecreaseLiquidityTopic],
    data: "0x",
    blockNumber: "22500000",
    transactionHash: manualLiquidityTx,
    logIndex: "0",
    ...overrides
  };
}

export const manualGaryStargateTornadoEvm = {
  normalTransactions: [
    {
      chain: "ethereum",
      hash: manualRangeSourceTx,
      from: manualBridgeSender,
      to: manualStargatePoolNative,
      value: "0",
      timeStamp: "1777948919",
      functionName: "Stargate Pool Native sendToken()"
    },
    {
      chain: "ethereum",
      hash: manualLiquidityTx,
      from: manualEthereumActor,
      to: manualUniswapV3PositionManager,
      value: "0",
      timeStamp: "1777947200",
      functionName: "decreaseLiquidity(uint256 tokenId)"
    },
    {
      chain: "ethereum",
      hash: manualEthCollectTx,
      from: manualEthereumActor,
      to: manualUniswapV3PositionManager,
      value: "0",
      timeStamp: "1777947300",
      functionName: "collect((uint256,address,uint128,uint128))"
    },
    {
      chain: "arbitrum",
      hash: manualArbitrum247Tx,
      from: manualArbitrumActor,
      to: "0x1111111111111111111111111111111111111111",
      value: "247770000000000000000",
      timeStamp: "1777943486",
      functionName: "Stargate Pool Native bridge()"
    },
    {
      chain: "arbitrum",
      hash: manualArbitrum250Tx,
      from: manualArbitrumActor,
      to: "0x1111111111111111111111111111111111111111",
      value: "250000000000000000000",
      timeStamp: "1777943145",
      functionName: "Stargate Pool Native bridge()"
    },
    {
      chain: "arbitrum",
      hash: manualTornado100Tx,
      from: manualArbitrumTornadoFunder,
      to: manualArbitrumActor,
      value: "100000000000000000000",
      timeStamp: "1777943000",
      functionName: "Tornado.Cash 100 ETH withdrawal"
    }
  ],
  internalTransactions: [
    {
      chain: "ethereum",
      hash: manualLiquidityTx,
      from: manualUniswapV3PositionManager,
      to: manualEthereumActor,
      value: "247770000000000000000",
      timeStamp: "1777947200",
      type: "call"
    },
    {
      chain: "ethereum",
      hash: manualEthCollectTx,
      from: manualUniswapV3PositionManager,
      to: manualEthereumActor,
      value: "250000000000000000000",
      timeStamp: "1777947300",
      type: "call"
    },
    {
      chain: "arbitrum",
      hash: manualArbitrum247Tx,
      from: manualArbitrumActor,
      to: "0x1111111111111111111111111111111111111111",
      value: "247770000000000000000",
      timeStamp: "1777943486",
      type: "call"
    },
    {
      chain: "arbitrum",
      hash: manualArbitrum250Tx,
      from: manualArbitrumActor,
      to: "0x1111111111111111111111111111111111111111",
      value: "250000000000000000000",
      timeStamp: "1777943145",
      type: "call"
    },
    {
      chain: "arbitrum",
      hash: manualTornado100Tx,
      from: manualArbitrumTornadoFunder,
      to: manualArbitrumActor,
      value: "100000000000000000000",
      timeStamp: "1777943000",
      type: "call"
    }
  ],
  erc20Transfers: [
    {
      chain: "ethereum",
      hash: manualRangeSourceTx,
      from: manualBridgeSender,
      to: manualStargatePoolNative,
      contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      value: "100000000000",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      timeStamp: "1777948919"
    },
    {
      chain: "ethereum",
      hash: manualLiquidityTx,
      from: manualEthereumActor,
      to: manualUniswapV3PositionManager,
      contractAddress: manualGaryToken,
      value: "900000000000000000000000",
      tokenName: "Gary",
      tokenSymbol: "GARY",
      tokenDecimal: "18",
      timeStamp: "1777947200"
    },
    {
      chain: "ethereum",
      hash: manualLiquidityTx,
      from: manualUniswapV3PositionManager,
      to: manualEthereumActor,
      contractAddress: manualWethToken,
      value: "247770000000000000000",
      tokenName: "Wrapped Ether",
      tokenSymbol: "WETH",
      tokenDecimal: "18",
      timeStamp: "1777947200"
    },
    {
      chain: "ethereum",
      hash: manualEthCollectTx,
      from: manualUniswapV3PositionManager,
      to: manualEthereumActor,
      contractAddress: manualWethToken,
      value: "250000000000000000000",
      tokenName: "Wrapped Ether",
      tokenSymbol: "WETH",
      tokenDecimal: "18",
      timeStamp: "1777947300"
    }
  ],
  receipts: [
    {
      chain: "ethereum",
      transactionHash: manualRangeSourceTx,
      from: manualBridgeSender,
      to: manualStargatePoolNative,
      logs: [],
      status: "1"
    },
    {
      chain: "ethereum",
      transactionHash: manualLiquidityTx,
      from: manualEthereumActor,
      to: manualUniswapV3PositionManager,
      logs: [
        evmLog({ topics: [uniswapDecreaseLiquidityTopic], transactionHash: manualLiquidityTx, logIndex: "0" }),
        evmLog({ topics: [uniswapCollectTopic], transactionHash: manualLiquidityTx, logIndex: "1" })
      ],
      status: "1"
    },
    {
      chain: "ethereum",
      transactionHash: manualEthCollectTx,
      from: manualEthereumActor,
      to: manualUniswapV3PositionManager,
      logs: [
        evmLog({ topics: [uniswapCollectTopic], transactionHash: manualEthCollectTx, logIndex: "0" })
      ],
      status: "1"
    },
    {
      chain: "arbitrum",
      transactionHash: manualArbitrum247Tx,
      from: manualArbitrumActor,
      to: "0x1111111111111111111111111111111111111111",
      logs: [],
      status: "1"
    },
    {
      chain: "arbitrum",
      transactionHash: manualArbitrum250Tx,
      from: manualArbitrumActor,
      to: "0x1111111111111111111111111111111111111111",
      logs: [],
      status: "1"
    }
  ],
  tokenMetadata: [
    {
      chain: "ethereum",
      tokenContract: manualGaryToken,
      tokenName: "Gary token - low holders 14, transfers 23",
      tokenSymbol: "GARY",
      tokenDecimal: "18"
    },
    {
      chain: "ethereum",
      tokenContract: manualWethToken,
      tokenName: "Wrapped Ether",
      tokenSymbol: "WETH",
      tokenDecimal: "18"
    },
    {
      chain: "ethereum",
      tokenContract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6"
    }
  ]
} as const satisfies {
  normalTransactions: readonly EvmTransaction[];
  internalTransactions: readonly EvmInternalTransaction[];
  erc20Transfers: readonly EvmTokenTransfer[];
  receipts: readonly EvmTransactionReceipt[];
  tokenMetadata: readonly EvmTokenMetadata[];
};

export const manualGaryNoNameOnlyCase = {
  ...manualGaryStargateTornadoCase,
  name: "manual_gary_stargate_no_name_only_case",
  data: {
    transfers: manualGaryStargateTornadoCase.data.transfers.filter((transfer) =>
      transfer.id !== "manual-arbitrum-tornado-eth-100"
    ),
    riskSnapshots: []
  }
} as const satisfies {
  name: string;
  subjectAddress: string;
  data: FixtureCrossChainDiscoveryData;
};

export const manualGarySanctionedCase = {
  ...manualGaryStargateTornadoCase,
  name: "manual_gary_stargate_sanctioned_case",
  data: {
    transfers: manualGaryStargateTornadoCase.data.transfers,
    riskSnapshots: [{
      address: {
        chain: "arbitrum",
        chainId: 42161,
        address: manualArbitrumActor
      },
      provider: "local",
      riskScore: 100,
      labels: ["LOCAL_EXACT_SANCTIONED: OFAC SDN sanctioned service"],
      evidenceRefs: [{
        id: "cross_chain:local:arbitrum:0x6ca63c963948597eaf85c6a193fedf1d96c62ea7:sanctioned_service",
        provider: "local",
        payloadId: null,
        confidence: "exact"
      }],
      payloadRef: null
    }]
  }
} as const satisfies {
  name: string;
  subjectAddress: string;
  data: FixtureCrossChainDiscoveryData;
};

export const manualGaryAddresses = {
  bridgeSender: manualBridgeSender,
  ethereumActor: manualEthereumActor,
  arbitrumActor: manualArbitrumActor,
  arbitrumTornadoFunder: manualArbitrumTornadoFunder,
  stargatePoolNative: manualStargatePoolNative,
  uniswapV3PositionManager: manualUniswapV3PositionManager,
  rangeSourceTx: manualRangeSourceTx,
  liquidityTx: manualLiquidityTx,
  ethCollectTx: manualEthCollectTx,
  arbitrum247Tx: manualArbitrum247Tx,
  arbitrum250Tx: manualArbitrum250Tx,
  tornado100Tx: manualTornado100Tx
} as const;
