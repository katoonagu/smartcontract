import { describe, expect, it } from "vitest";
import {
  detectBridgeServiceBoundary,
  detectKnownMixerOrSanctionedService,
  detectNoNameTokenLiquidity,
  detectUniswapV3LiquidityEvent
} from "../../src/forensics/crossChainDetectors";
import type { EvmLog, EvmTokenMetadata } from "../../src/forensics/evmExplorerClient";

const UNISWAP_V3_NPM = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const DECREASE_LIQUIDITY_TOPIC = "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";
const COLLECT_TOPIC = "0x70935338e69775456f0f7988fdb2ae37e682d0ea45f2e276aaa2e36147a76d91";

function evmLog(topic0: string): EvmLog {
  return {
    chain: "ethereum",
    address: UNISWAP_V3_NPM,
    topics: [topic0],
    data: "0x",
    blockNumber: "22500000",
    transactionHash: "0xliquidity",
    logIndex: "0"
  };
}

function token(symbol: string, tokenContract = `0x${symbol.toLowerCase().padEnd(40, "0")}`): EvmTokenMetadata {
  return {
    chain: "ethereum",
    tokenContract,
    tokenSymbol: symbol,
    tokenName: `${symbol} token`,
    tokenDecimal: "18"
  };
}

describe("crossChainDetectors", () => {
  it("detects GARY Uniswap V3 remove or collect as no-name token liquidity", () => {
    const result = detectNoNameTokenLiquidity({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT", "GARY/WETH pool"],
      logs: [evmLog(DECREASE_LIQUIDITY_TOPIC), evmLog(COLLECT_TOPIC)],
      tokenMetadata: [token("GARY"), token("WETH")],
      nativeValueRaw: "247770000000000000000",
      evidenceIds: ["evidence:gary:decrease", "evidence:gary:collect"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "no_name_token_liquidity",
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline",
      evidenceIds: ["evidence:gary:decrease", "evidence:gary:collect"]
    });
    expect(result.reasons.join(" ")).toContain("GARY");
    expect(result.confidence).not.toBe("weak");
  });

  it("does not treat major-token Uniswap V3 remove or collect as no-name liquidity", () => {
    const result = detectNoNameTokenLiquidity({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT", "USDC/WETH pool"],
      logs: [evmLog(DECREASE_LIQUIDITY_TOPIC)],
      tokenMetadata: [token("USDC"), token("WETH")],
      nativeValueRaw: "250000000000000000000",
      evidenceIds: ["evidence:major:remove"]
    });

    expect(result.terminalBoundary).not.toBe("no_name_token_liquidity");
    expect(result.terminalBoundary).toBe("none");
    expect(result.evidenceClass).toBe("data_quality");
    expect(result.proofLevel).toBe("insufficient_coverage");
  });

  it("does not accept a matching Uniswap V3 topic from a non-Uniswap log address", () => {
    const unrelatedLog = {
      ...evmLog(DECREASE_LIQUIDITY_TOPIC),
      address: "0x000000000000000000000000000000000000dEaD"
    };

    const result = detectNoNameTokenLiquidity({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT", "GARY/WETH pool"],
      logs: [unrelatedLog],
      tokenMetadata: [token("GARY"), token("WETH")],
      nativeValueRaw: "247770000000000000000",
      evidenceIds: ["evidence:spoofed-topic"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "none",
      evidenceClass: "data_quality",
      proofLevel: "insufficient_coverage"
    });
  });

  it("detects labeled Uniswap V3 remove or collect evidence without requiring raw logs", () => {
    const result = detectNoNameTokenLiquidity({
      chain: "ethereum",
      labels: ["Uniswap V3 remove liquidity", "collect from GARY/WETH position"],
      tokenMetadata: [token("GARY"), token("WETH")],
      nativeValueRaw: "247770000000000000000",
      evidenceIds: ["evidence:gary:labeled-remove"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "no_name_token_liquidity",
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    });
  });

  it("returns data-exhausted coverage warning when Uniswap liquidity metadata is missing", () => {
    const result = detectUniswapV3LiquidityEvent({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT"],
      logs: [evmLog(COLLECT_TOPIC)],
      tokenMetadata: [null],
      nativeValueRaw: "247770000000000000000",
      evidenceIds: ["evidence:missing-metadata"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "data_exhausted",
      evidenceClass: "data_quality",
      proofLevel: "insufficient_coverage"
    });
    expect(result.warnings.join(" ")).toContain("token metadata");
  });

  it.each([
    ["undefined", undefined],
    ["empty", []]
  ] as const)("returns missing-token-metadata warning when token metadata is %s", (_caseName, tokenMetadata) => {
    const result = detectUniswapV3LiquidityEvent({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT"],
      logs: [evmLog(COLLECT_TOPIC)],
      tokenMetadata,
      nativeValueRaw: "247770000000000000000",
      evidenceIds: ["evidence:absent-metadata"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "data_exhausted",
      evidenceClass: "data_quality",
      proofLevel: "insufficient_coverage"
    });
    expect(result.warnings.join(" ")).toContain("missing token metadata");
  });

  it("warns on partial missing metadata while still detecting no-name liquidity", () => {
    const result = detectUniswapV3LiquidityEvent({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT", "GARY/WETH pool"],
      logs: [evmLog(DECREASE_LIQUIDITY_TOPIC)],
      tokenMetadata: [token("GARY"), null, undefined],
      nativeValueRaw: "247770000000000000000",
      evidenceIds: ["evidence:partial-metadata"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "no_name_token_liquidity",
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    });
    expect(result.warnings.join(" ")).toContain("missing token metadata");
  });

  it("warns on partial missing metadata when native value support is too small", () => {
    const result = detectUniswapV3LiquidityEvent({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT", "GARY/WETH pool"],
      logs: [evmLog(DECREASE_LIQUIDITY_TOPIC)],
      tokenMetadata: [token("GARY"), { ...token("WETH"), tokenSymbol: undefined }],
      nativeValueRaw: "1000000000000000000",
      evidenceIds: ["evidence:small-native-partial-metadata"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "none",
      evidenceClass: "data_quality",
      proofLevel: "insufficient_coverage"
    });
    expect(result.warnings.join(" ")).toContain("missing token metadata");
  });

  it("warns on partial missing metadata when known tokens are all major tokens", () => {
    const result = detectUniswapV3LiquidityEvent({
      chain: "ethereum",
      address: UNISWAP_V3_NPM,
      labels: ["Uniswap V3: Positions NFT", "USDC/WETH pool"],
      logs: [evmLog(COLLECT_TOPIC)],
      tokenMetadata: [token("USDC"), undefined],
      nativeValueRaw: "250000000000000000000",
      evidenceIds: ["evidence:major-only-partial-metadata"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "none",
      evidenceClass: "data_quality",
      proofLevel: "insufficient_coverage"
    });
    expect(result.warnings.join(" ")).toContain("missing token metadata");
  });

  it("keeps a Tornado label without exact sanctions as source-policy mixer evidence", () => {
    const result = detectKnownMixerOrSanctionedService({
      chain: "arbitrum",
      address: "0xeb2Cdf39fC5Afa85BBa1467e209974d9B19fA68b",
      labels: ["Tornado.Cash: 100 ETH", "BolshoyJoe"],
      evidenceIds: ["evidence:tornado-context"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "tornado_or_mixer",
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    });
    expect(result.terminalBoundary).not.toBe("sanctioned_service");
  });

  it("detects an exact sanctioned local label as hard-proof compatible sanctioned service", () => {
    const result = detectKnownMixerOrSanctionedService({
      chain: "ethereum",
      address: "0x1111111111111111111111111111111111111111",
      labels: ["LOCAL_EXACT_SANCTIONED: OFAC SDN sanctioned service"],
      evidenceIds: ["evidence:local-sanctioned"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "sanctioned_service",
      evidenceClass: "hard_proof",
      proofLevel: "exact_scam_or_taint_proof",
      canBeDampened: false
    });
  });

  it.each([
    "not exact sanctioned",
    "no OFAC SDN sanctioned match"
  ])("does not hard-proof negative sanctioned wording: %s", (label) => {
    const result = detectKnownMixerOrSanctionedService({
      chain: "ethereum",
      address: "0x1111111111111111111111111111111111111111",
      labels: [label],
      evidenceIds: ["evidence:negative-sanctioned-wording"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "none",
      evidenceClass: "data_quality",
      proofLevel: "insufficient_coverage"
    });
  });

  it("detects Stargate and LayerZero labels only as a bridge boundary", () => {
    const result = detectBridgeServiceBoundary({
      chain: "ethereum",
      address: "0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315",
      labels: ["LayerZero", "Stargate"],
      protocol: "LayerZero/Stargate",
      evidenceIds: ["evidence:stargate"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "bridge_boundary",
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline",
      canBeDampened: true
    });
  });

  it.each([
    "cross_chain_bridge",
    "bridge_aggregator",
    "service_route:cross_chain_bridge"
  ])("detects structured bridge label %s", (label) => {
    const result = detectBridgeServiceBoundary({
      chain: "ethereum",
      address: "0x2cFEEE2394aC0f01c92CDaDCb697feC0cF8Da315",
      labels: [label],
      evidenceIds: ["evidence:structured-bridge"]
    });

    expect(result).toMatchObject({
      terminalBoundary: "bridge_boundary",
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    });
  });

  it("keeps weak amount or time-only support out of proof boundaries", () => {
    const result = detectNoNameTokenLiquidity({
      chain: "ethereum",
      labels: ["same amount within nearby time window"],
      tokenMetadata: [token("GARY")],
      nativeValueRaw: "247770000000000000000",
      weakSupportOnly: true,
      evidenceIds: ["evidence:weak-amount-time"]
    });

    expect(["none", "data_exhausted"]).toContain(result.terminalBoundary);
    expect(result.evidenceClass).not.toBe("hard_proof");
    expect(result.proofLevel).not.toBe("exact_scam_or_taint_proof");
    expect(result.confidence).toBe("weak");
  });
});
