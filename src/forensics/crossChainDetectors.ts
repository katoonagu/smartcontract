import type {
  CrossChainEvidenceRef,
  CrossChainTerminalBoundary,
  EvidenceClass,
  ProofLevel,
  RiskLayerScore
} from "../types";
import type { EvmLog, EvmTokenMetadata } from "./evmExplorerClient";
import { scoreCrossChainTerminalBoundary } from "./crossChainEvidence";

export type CrossChainDetectorConfidence = "exact" | "strong" | "weak" | "none";

export type CrossChainDetectorInput = {
  chain?: string | null;
  address?: string | null;
  labels?: readonly string[];
  protocol?: string | null;
  logs?: readonly EvmLog[];
  tokenMetadata?: readonly (EvmTokenMetadata | null | undefined)[];
  nativeValueRaw?: string | null;
  amountRaw?: string | null;
  assetSymbol?: string | null;
  evidenceIds?: readonly string[];
  evidenceRefs?: readonly CrossChainEvidenceRef[];
  selectedShare?: number;
  weakSupportOnly?: boolean;
};

export type CrossChainDetectorResult = RiskLayerScore & {
  terminalBoundary: CrossChainTerminalBoundary;
  confidence: CrossChainDetectorConfidence;
};

const MAJOR_TOKEN_SYMBOLS = new Set(["USDT", "USDC", "WETH", "ETH", "WBTC", "DAI"]);
const LARGE_NATIVE_VALUE_WEI = 10_000_000_000_000_000_000n;

const UNISWAP_V3_POSITION_MANAGER = "0xc36442b4a4522e871399cd717abdd847ab11fe88";
const UNISWAP_V3_DECREASE_LIQUIDITY_TOPIC =
  "0x26f6a8ec6d85944b0b35836d2ca9c7468e4bf0b1f2a1c23f0b6d3c673dbc8f2";
const UNISWAP_V3_COLLECT_TOPIC =
  "0x70935338e69775456f0f7988fdb2ae37e682d0ea45f2e276aaa2e36147a76d91";

const KNOWN_TORNADO_ADDRESSES = new Set([
  "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
  "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936",
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf",
  "0xa160cdab225685da1d56aa342ad8841c3b53f291",
  "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144",
  "0x07687e702b410fa43f4cb4af7fa097918ffd2730",
  "0x23773e65ed146a459791799d01336db287f25334",
  "0x22aaa7720ddd5388a3c0a3333430953c68f1849b"
]);

export function detectKnownMixerOrSanctionedService(input: CrossChainDetectorInput): CrossChainDetectorResult {
  const labels = normalizedLabels(input);

  if (labels.some(isExactSanctionedLabel)) {
    return result(input, "sanctioned_service", "exact", ["Exact local sanctioned-service label matched."]);
  }

  if (isKnownTornadoAddress(input.address) || labels.some(isTornadoOrMixerLabel)) {
    return result(input, "tornado_or_mixer", "strong", ["Tornado or mixer service label/address matched."]);
  }

  return result(input, "none", weakOrNone(input), ["No known mixer or sanctioned service boundary matched."]);
}

export function detectNoNameTokenLiquidity(input: CrossChainDetectorInput): CrossChainDetectorResult {
  return detectUniswapV3LiquidityEvent(input);
}

export function detectUniswapV3LiquidityEvent(input: CrossChainDetectorInput): CrossChainDetectorResult {
  if (input.weakSupportOnly) {
    return result(input, "none", "weak", ["Only weak amount/time support was present."]);
  }

  const hasLiquidityEvent = hasUniswapV3LiquidityEvent(input);
  if (!hasLiquidityEvent) {
    return result(input, "none", weakOrNone(input), ["No Uniswap V3 remove or collect event matched."]);
  }

  const metadataCoverage = tokenMetadataCoverage(input.tokenMetadata);
  const knownTokens = metadataCoverage.symbols;
  const metadataWarnings = missingTokenMetadataWarnings(metadataCoverage);
  if (knownTokens.length === 0) {
    return result(
      input,
      "data_exhausted",
      "weak",
      ["Uniswap V3 liquidity event matched, but token metadata was unavailable."],
      metadataWarnings
    );
  }

  if (!hasLargeNativeValue(input)) {
    return result(
      input,
      "none",
      "weak",
      ["Uniswap V3 liquidity event lacked large native value support."],
      metadataWarnings
    );
  }

  const nonMajorTokens = knownTokens.filter((symbol) => !MAJOR_TOKEN_SYMBOLS.has(symbol));
  if (nonMajorTokens.length === 0) {
    return result(
      input,
      "none",
      "none",
      ["Uniswap V3 liquidity involved only major tokens."],
      metadataWarnings
    );
  }

  return result(
    input,
    "no_name_token_liquidity",
    "strong",
    [`Uniswap V3 remove/collect involved non-major token ${nonMajorTokens.join(", ")} with large native value.`],
    metadataWarnings
  );
}

export function detectBridgeServiceBoundary(input: CrossChainDetectorInput): CrossChainDetectorResult {
  const haystack = normalizedText([input.protocol, ...(input.labels ?? [])]);
  const hasBridgeLabel = /\b(stargate|layerzero|bridge)\b/.test(haystack);

  if (hasBridgeLabel) {
    return result(input, "bridge_boundary", "strong", ["Bridge service label or protocol matched."]);
  }

  return result(input, "none", weakOrNone(input), ["No bridge service boundary matched."]);
}

function result(
  input: CrossChainDetectorInput,
  terminalBoundary: CrossChainTerminalBoundary,
  confidence: CrossChainDetectorConfidence,
  extraReasons: string[] = [],
  extraWarnings: string[] = []
): CrossChainDetectorResult {
  const layer = scoreCrossChainTerminalBoundary({
    terminalBoundary,
    selectedShare: selectedShare(input, terminalBoundary),
    evidenceIds: evidenceIds(input)
  });

  return {
    ...layer,
    terminalBoundary,
    confidence,
    reasons: [...layer.reasons, ...extraReasons],
    warnings: [...layer.warnings, ...extraWarnings]
  };
}

function selectedShare(input: CrossChainDetectorInput, terminalBoundary: CrossChainTerminalBoundary): number {
  if (input.selectedShare !== undefined) return input.selectedShare;
  return terminalBoundary === "none" ? 0 : 1;
}

function evidenceIds(input: CrossChainDetectorInput): string[] {
  return [...new Set([
    ...(input.evidenceIds ?? []),
    ...(input.evidenceRefs ?? []).map((evidenceRef) => evidenceRef.id)
  ])];
}

function normalizedLabels(input: CrossChainDetectorInput): string[] {
  return (input.labels ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean);
}

function normalizedText(values: readonly (string | null | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[_:\/-]+/g, " ");
}

function isExactSanctionedLabel(label: string): boolean {
  return /^(?:local_exact_sanctioned|exact_sanctioned)(?:$|[\s:;,|])/.test(label) ||
    /[:;,|](?:local_exact_sanctioned|exact_sanctioned)(?:$|[\s:;,|])/.test(label);
}

function isTornadoOrMixerLabel(label: string): boolean {
  return label.includes("tornado") || label.includes("mixer");
}

function isKnownTornadoAddress(address: string | null | undefined): boolean {
  return typeof address === "string" && KNOWN_TORNADO_ADDRESSES.has(address.toLowerCase());
}

function hasUniswapV3LiquidityEvent(input: CrossChainDetectorInput): boolean {
  const labels = normalizedText([input.address, ...(input.labels ?? [])]);
  const hasUniswapLabel = labels.includes("uniswap v3");
  const hasPositionManagerAddress = input.address?.toLowerCase() === UNISWAP_V3_POSITION_MANAGER;
  const hasLabeledLiquidityEvent = hasUniswapLabel &&
    /\b(remove|decrease|collect)\b/.test(labels) &&
    /\bliquidity\b|\bposition\b/.test(labels);
  const hasLog = (input.logs ?? []).some((log) => {
    const topic0 = log.topics[0]?.toLowerCase();
    return log.address.toLowerCase() === UNISWAP_V3_POSITION_MANAGER &&
      (topic0 === UNISWAP_V3_DECREASE_LIQUIDITY_TOPIC || topic0 === UNISWAP_V3_COLLECT_TOPIC);
  });

  return hasLabeledLiquidityEvent || (hasLog && (hasUniswapLabel || hasPositionManagerAddress));
}

function tokenMetadataCoverage(metadata: CrossChainDetectorInput["tokenMetadata"]): {
  symbols: string[];
  hasMissing: boolean;
} {
  const entries = metadata ?? [];

  return {
    symbols: entries
      .map((token) => token?.tokenSymbol?.trim().toUpperCase())
      .filter((symbol): symbol is string => Boolean(symbol)),
    hasMissing: entries.length === 0 || entries.some((token) => !token?.tokenSymbol?.trim())
  };
}

function missingTokenMetadataWarnings(metadataCoverage: { hasMissing: boolean }): string[] {
  return metadataCoverage.hasMissing
    ? ["Partial coverage: missing token metadata for Uniswap V3 liquidity event."]
    : [];
}

function hasLargeNativeValue(input: CrossChainDetectorInput): boolean {
  const rawValue = input.nativeValueRaw ?? nativeAssetAmount(input);
  if (!rawValue || !/^\d+$/.test(rawValue)) return false;
  return BigInt(rawValue) >= LARGE_NATIVE_VALUE_WEI;
}

function nativeAssetAmount(input: CrossChainDetectorInput): string | null {
  if (!input.amountRaw) return null;
  const asset = input.assetSymbol?.trim().toUpperCase();
  return asset === "ETH" || asset === "WETH" ? input.amountRaw : null;
}

function weakOrNone(input: CrossChainDetectorInput): CrossChainDetectorConfidence {
  return input.weakSupportOnly ? "weak" : "none";
}

export type {
  EvidenceClass,
  ProofLevel
};
