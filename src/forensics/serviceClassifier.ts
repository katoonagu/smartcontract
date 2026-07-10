import {
  contractProfileHasServiceActivity,
  serviceIdentityFromContractProfile,
  type ContractRiskContext
} from "../approvals/contractIntelligence";
import type { RiskConfidence, ServiceCategory, ServiceClassification } from "../types";
import {
  matchServiceRouteRegistry,
  matchServiceRouteRegistryPhrase,
  type ServiceRouteCategory,
  type ServiceRouteRegistryEntry
} from "./serviceRouteRegistry";
import { matchSanctionedCryptoService, sanctionsDate } from "./sanctionedServiceRegistry";

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

function looksLikeTronAddress(value: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{25,}$/.test(value.trim());
}

function classificationTextPart(value: string | null | undefined, inputAddress: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === inputAddress.toLowerCase()) return null;
  if (looksLikeTronAddress(trimmed)) return null;
  return trimmed;
}

function methodText(profile: ContractRiskContext | null | undefined): string {
  return methodTextOriginal(profile).toLowerCase();
}

function methodTextOriginal(profile: ContractRiskContext | null | undefined): string {
  return (profile?.topMethods ?? [])
    .map((method) => [method.signature, method.method, method.methodId].filter(Boolean).join(" "))
    .join(" ");
}

function profileTagText(profile: ContractRiskContext | null | undefined): string {
  const providerTags = (profile?.providerTags ?? []).map((tag) => tag.label).join(" ");
  const publicTags = (profile?.publicTags ?? []).map((tag) => [tag.label, tag.description].filter(Boolean).join(" ")).join(" ");
  return lowerText(profile?.name, profile?.serviceTag, profile?.publicTag, profile?.publicTagDesc, providerTags, publicTags);
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAnyToken(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}($|[^a-z0-9])`).test(text)
  );
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

const KNOWN_POOLED_SERVICE_ADDRESSES = new Map([
  [
    "tlntw9z59lyy5kei9cmwk3pkjqga828ird",
    { category: "service" as const, identity: "TronLink GasFree provider", evidence: "registry:tronlink_gasfree_provider" }
  ]
]);

function knownCexIdentity(text: string): string | null {
  return KNOWN_CEX_IDENTITIES.find((item) => hasAny(text, item.keywords))?.identity ?? null;
}

function serviceCategoryFromRouteCategory(category: ServiceRouteCategory): ServiceCategory {
  switch (category) {
    case "cross_chain_bridge":
    case "bridge_aggregator":
      return "bridge";
    case "dex_router_or_swap_aggregator":
      return "dex";
    case "stablecoin_or_wrapped_asset_protocol":
      return "protocol";
    case "gasless_or_smart_account_service":
      return "service";
    case "unknown_service_route":
      return "unknown_contract";
  }
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
  evidence: string[],
  isBoundary = category !== "none" && category !== "unknown_contract"
): ServiceClassification {
  return { category, identity, confidence, evidence, isBoundary };
}

function serviceRouteClassification(
  input: ClassifyServiceAddressInput,
  routeMatch: ServiceRouteRegistryEntry,
  evidence: string[]
): ServiceClassification {
  evidence.push(`service_route:${routeMatch.category}`);
  evidence.push(`service_route_identity:${routeMatch.canonicalName}`);
  return classification(
    input,
    serviceCategoryFromRouteCategory(routeMatch.category),
    identityFor(input, routeMatch.canonicalName),
    confidenceFor(input, true),
    evidence
  );
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
  const registered = KNOWN_POOLED_SERVICE_ADDRESSES.get(input.address.toLowerCase());
  if (registered) {
    return classification(input, registered.category, registered.identity, "high", [registered.evidence], true);
  }

  const metadataText = lowerText(
    classificationTextPart(input.metadata?.name, input.address),
    classificationTextPart(input.metadata?.tag, input.address)
  );
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

  const gasFreeAccount = /\bgas\s*free account\b/.test(identityText);
  const gasFreeEndpoint = /\bgas\s*free (endpoint|controller)\b/.test(identityText);
  if (gasFreeAccount || gasFreeEndpoint || /\bgas\s*free\b/.test(identityText)) {
    const roleEvidence = gasFreeAccount
      ? "role:gasfree_account"
      : gasFreeEndpoint
        ? "role:gasfree_endpoint"
        : "role:gasfree_unresolved";
    return classification(
      input,
      "service",
      identityFor(input, "GasFree service"),
      confidenceFor(input, true),
      ["tag:gasfree_service", roleEvidence],
      gasFreeEndpoint
    );
  }

  const serviceRoutePhraseMatch = matchServiceRouteRegistryPhrase(text);
  if (serviceRoutePhraseMatch) {
    return serviceRouteClassification(input, serviceRoutePhraseMatch, evidence);
  }

  const sanctionedService = matchSanctionedCryptoService(text);
  if (sanctionedService) {
    evidence.push(`sanctioned_service:${sanctionedService.key}`);
    evidence.push(`sanctions_authority:${sanctionedService.authority}`);
    evidence.push(`sanctioned_at:${sanctionsDate(sanctionedService)}`);
    return classification(
      input,
      sanctionedService.category,
      identityFor(input, sanctionedService.displayName),
      confidenceFor(input, true),
      evidence
    );
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

  const serviceRouteMatch = matchServiceRouteRegistry(text);
  if (serviceRouteMatch) {
    return serviceRouteClassification(input, serviceRouteMatch, evidence);
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

  if (hasAny(text, ["sunswap", "sun swap", "univ3"]) || hasAnyToken(text, ["dex", "swap"])) {
    evidence.push("tag:dex");
    return classification(input, "dex", identityFor(input, "dex"), confidenceFor(input, true), evidence);
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
