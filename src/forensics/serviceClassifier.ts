import {
  contractProfileHasServiceActivity,
  serviceIdentityFromContractProfile,
  type ContractRiskContext
} from "../approvals/contractIntelligence";
import type { RiskConfidence, ServiceCategory, ServiceClassification } from "../types";

export type ServiceAddressMetadata = {
  address: string;
  name: string | null;
  tag: string | null;
  isContract: boolean | null;
  verified: boolean | null;
};

export type ClassifyServiceAddressInput = {
  address: string;
  metadata?: ServiceAddressMetadata | null;
  contractProfile?: ContractRiskContext | null;
};

function lowerText(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function methodText(profile: ContractRiskContext | null | undefined): string {
  return [methodTextOriginal(profile), methodMapText(profile)].filter(Boolean).join(" ").toLowerCase();
}

function methodTextOriginal(profile: ContractRiskContext | null | undefined): string {
  return (profile?.topMethods ?? [])
    .map((method) => [method.signature, method.method, method.methodId].filter(Boolean).join(" "))
    .join(" ");
}

function methodMapText(profile: ContractRiskContext | null | undefined): string {
  return Object.values(profile?.methodMap ?? {}).join(" ");
}

function profileTagText(profile: ContractRiskContext | null | undefined): string {
  const providerTags = (profile?.providerTags ?? []).map((tag) => tag.label).join(" ");
  const publicTags = (profile?.publicTags ?? []).map((tag) => [tag.label, tag.description].filter(Boolean).join(" ")).join(" ");
  return lowerText(profile?.name, profile?.serviceTag, profile?.publicTag, profile?.publicTagDesc, providerTags, publicTags);
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

const KNOWN_CEX_IDENTITIES = [
  { keywords: ["binance"], identity: "Binance" },
  { keywords: ["bybit"], identity: "Bybit" },
  { keywords: ["okx"], identity: "OKX" },
  { keywords: ["whitebit"], identity: "WhiteBIT" },
  { keywords: ["coinbase"], identity: "Coinbase" },
  { keywords: ["kraken"], identity: "Kraken" },
  { keywords: ["kucoin"], identity: "KuCoin" },
  { keywords: ["bitget"], identity: "Bitget" },
  { keywords: ["mexc"], identity: "MEXC" },
  { keywords: ["bitstamp"], identity: "Bitstamp" },
  { keywords: ["crypto.com", "cryptocom"], identity: "Crypto.com" }
];

function knownCexIdentity(text: string): string | null {
  return KNOWN_CEX_IDENTITIES.find((item) => hasAny(text, item.keywords))?.identity ?? null;
}

function identityFor(input: ClassifyServiceAddressInput, fallback: string): string | null {
  return serviceIdentityFromContractProfile(input.contractProfile) ?? input.metadata?.tag ?? input.metadata?.name ?? fallback;
}

function confidenceFor(input: ClassifyServiceAddressInput, textMatched: boolean): RiskConfidence {
  if (input.metadata?.verified === true || input.contractProfile?.verified === true || input.contractProfile?.isVerified === true) {
    return "high";
  }
  if (contractProfileHasServiceActivity(input.contractProfile) || textMatched) return "medium";
  return "low";
}

function classification(
  input: ClassifyServiceAddressInput,
  category: ServiceCategory,
  identity: string | null,
  confidence: RiskConfidence,
  evidence: string[]
): ServiceClassification {
  return {
    category,
    identity,
    confidence,
    evidence,
    isBoundary: category !== "none"
  };
}

function weakContract(input: ClassifyServiceAddressInput): boolean {
  const metadata = input.metadata ?? null;
  const profile = input.contractProfile ?? null;
  const isContract = metadata?.isContract === true || Boolean(profile);
  if (!isContract) return false;
  const verified = profile?.verified ?? profile?.isVerified ?? metadata?.verified ?? null;
  return verified !== true && (
    verified === false ||
    profile?.lowMetadata === true ||
    profile?.sourceStatus === "missing" ||
    profile?.hasTransferFromSelector === true ||
    profile?.hasOwnerOnlyPattern === true
  );
}

export function classifyServiceAddress(input: ClassifyServiceAddressInput): ServiceClassification {
  const metadataText = lowerText(input.metadata?.name, input.metadata?.tag);
  const tagText = profileTagText(input.contractProfile);
  const methods = methodText(input.contractProfile);
  const methodsOriginal = methodTextOriginal(input.contractProfile);
  const identityText = [metadataText, tagText].join(" ");
  const text = [metadataText, tagText, methods].join(" ");
  const evidence: string[] = [];

  if (
    hasAny(text, ["allbridge lp", "lp-usdt", "liquidity pool"]) ||
    (hasAny(text, ["allbridge", "bridge", "cross-chain", "cross chain"]) && hasAny(text, ["pool", " lp", "liquidity"])) ||
    (hasAny(text, ["claimrewards", "claim rewards", "claimadminfee"]) && hasAny(text, ["deposit", "withdraw"]))
  ) {
    if (metadataText) evidence.push(`metadata:${metadataText}`);
    if (methodsOriginal) evidence.push(`methods:${methodsOriginal}`);
    return classification(input, "bridge_pool", identityFor(input, "bridge pool"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["htx", "huobi"])) {
    evidence.push("tag:htx_huobi");
    const identity = hasAny(text, ["huobi"]) ? "Huobi" : "HTX";
    return classification(input, "cex", identityFor(input, identity), confidenceFor(input, true), evidence);
  }

  const cexIdentity = knownCexIdentity(text);
  if (cexIdentity) {
    evidence.push(`tag:${cexIdentity.toLowerCase()}`);
    return classification(input, "cex", identityFor(input, cexIdentity), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["hot wallet"])) {
    evidence.push("tag:hot wallet");
    return classification(input, "hot_wallet", identityFor(input, "hot wallet"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["cex", "exchange"])) {
    evidence.push("tag:exchange");
    return classification(input, "cex", identityFor(input, "exchange"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["allbridge", "bridgers", "bridge", "cross-chain", "cross chain"])) {
    evidence.push("tag:bridge");
    return classification(input, "bridge", identityFor(input, "bridge"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["adapter", "helper", "univ3adapter"])) {
    evidence.push("tag:adapter");
    return classification(input, "swap_adapter", identityFor(input, "swap adapter"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["router", "route", "aggregator", "proxy"])) {
    evidence.push("tag:router");
    return classification(input, "router", identityFor(input, "router"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["dex", "sunswap", "sun swap", "univ3", "swap"])) {
    evidence.push("tag:dex");
    return classification(input, "dex", identityFor(input, "dex"), confidenceFor(input, true), evidence);
  }

  if (hasAny(identityText, ["gasfree", "gas free"])) {
    evidence.push("tag:gasfree_service");
    if (hasAny(methods, ["permittransfer"])) evidence.push("method:permittransfer");
    return classification(input, "service", identityFor(input, "GasFree service"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["usdd", "psm", "gemjoin", "gem join", "stablecoin module", "stablecoin protocol"])) {
    evidence.push("tag:stablecoin_protocol");
    return classification(input, "protocol", identityFor(input, "stablecoin protocol"), confidenceFor(input, true), evidence);
  }

  if (hasAny(text, ["justlend", "just lend"])) {
    evidence.push("tag:lending_protocol");
    return classification(input, "protocol", identityFor(input, "lending protocol"), confidenceFor(input, true), evidence);
  }

  if (weakContract(input)) {
    evidence.push("weak contract metadata");
    return classification(input, "unknown_contract", input.metadata?.name ?? input.contractProfile?.name ?? null, "medium", evidence);
  }

  return classification(input, "none", input.metadata?.tag ?? input.metadata?.name ?? null, "low", []);
}

export function isServiceBoundary(classificationResult: ServiceClassification | null | undefined): boolean {
  return Boolean(classificationResult && classificationResult.category !== "none" && classificationResult.isBoundary);
}
