import type {
  AddressLabel,
  ExchangeDecision,
  MoneyOriginPath,
  MoneyOriginRootSourceType,
  MoneyOriginStoppedReason,
  RiskLevel,
  ServiceCategory,
  ServiceClassification,
  SourceExposureKind
} from "../types";
import { selectedMoneyOriginPathShare } from "./moneyOriginAttribution";
import { baseShareScore } from "./provenanceScoring";

export type MoneyOriginStopClassification = {
  verdict: ExchangeDecision;
  rootSourceType: MoneyOriginRootSourceType;
  stoppedReason: MoneyOriginStoppedReason;
  riskScoreContribution: number;
  exposureSourceKey?: string;
  exposureSourceLabel?: string;
  sourceExposureKind?: SourceExposureKind;
  reasons: string[];
};

export type ClassifyMoneyOriginStopInput = {
  address: string;
  labels: AddressLabel[];
  classification: ServiceClassification | null;
  balanceShare: number;
};

export type CombinedMoneyOriginDecision = {
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
};

const ALLOWLIST_CEX_IDENTITIES = [
  { needle: "binance", label: "Binance" },
  { needle: "bybit", label: "Bybit" },
  { needle: "okx", label: "OKX" },
  { needle: "coinbase", label: "Coinbase" },
  { needle: "kraken", label: "Kraken" },
  { needle: "kucoin", label: "KuCoin" },
  { needle: "gate", label: "Gate" },
  { needle: "bitget", label: "Bitget" },
  { needle: "mexc", label: "MEXC" },
  { needle: "bitstamp", label: "Bitstamp" },
  { needle: "crypto.com", label: "Crypto.com" },
  { needle: "cryptocom", label: "Crypto.com" }
];

const HIGH_RISK_IDENTITY_KEYWORDS = ["htx", "huobi"];
const WHITEBIT_IDENTITY_KEYWORDS = ["whitebit"];

const DECLINE_BOUNDARY_CATEGORIES = new Set<ServiceCategory>([
  "bridge",
  "bridge_pool",
  "dex",
  "router",
  "swap_adapter"
]);

const EXACT_RISK_LABELS = new Set<AddressLabel["label"]>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange",
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s:_-]+/g, " ").trim();
}

function identityText(classification: ServiceClassification | null): string {
  return normalizeText([
    classification?.identity ?? "",
    ...(classification?.evidence ?? [])
  ].join(" "));
}

function matchedAllowlistIdentity(text: string): string | null {
  return ALLOWLIST_CEX_IDENTITIES.find((identity) => text.includes(identity.needle))?.label ?? null;
}

function hasHighRiskIdentity(text: string): boolean {
  return HIGH_RISK_IDENTITY_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasWhitebitIdentity(text: string): boolean {
  return WHITEBIT_IDENTITY_KEYWORDS.some((keyword) => text.includes(keyword));
}

function exactRiskLabel(labels: AddressLabel[]): AddressLabel | null {
  return labels.find((label) => EXACT_RISK_LABELS.has(label.label)) ?? null;
}

function hasWhitebitLabel(labels: AddressLabel[]): boolean {
  return labels.some((label) => label.label === "whitebit");
}

function formatShare(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown share";
  const percent = value * 100;
  const precision = percent < 10 && !Number.isInteger(percent) ? 1 : 0;
  return `${percent.toFixed(precision)}%`;
}

function sourcePolicyDecision(balanceShare: number): ExchangeDecision {
  return balanceShare >= 0.5 ? "DECLINE" : "REVIEW";
}

export function classifyMoneyOriginStop(input: ClassifyMoneyOriginStopInput): MoneyOriginStopClassification | null {
  const riskLabel = exactRiskLabel(input.labels);
  if (riskLabel) {
    return {
      verdict: "DECLINE",
      rootSourceType: "risky_label",
      stoppedReason: "risky_label_reached",
      riskScoreContribution: riskLabel.label === "whitebit" ? 85 : 90,
      reasons: [`Balance-forming path reaches high-risk label ${riskLabel.label}; exchange policy declines this source.`]
    };
  }

  const classification = input.classification;
  const text = identityText(classification);
  if (hasWhitebitLabel(input.labels) || hasWhitebitIdentity(text)) {
    const score = baseShareScore("whitebit", input.balanceShare);
    return {
      verdict: sourcePolicyDecision(input.balanceShare),
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      exposureSourceKey: "whitebit",
      exposureSourceLabel: "WhiteBIT",
      sourceExposureKind: "whitebit",
      reasons: [`Balance-forming path has WhiteBIT exposure (${formatShare(input.balanceShare)} of selected provenance target); this is medium source-policy risk, not direct scam/blacklist proof or approval-drain proof.`]
    };
  }

  if (!classification || classification.category === "none" || classification.isBoundary === false) {
    return null;
  }

  if (hasHighRiskIdentity(text)) {
    const score = baseShareScore("htx_huobi", input.balanceShare);
    return {
      verdict: sourcePolicyDecision(input.balanceShare),
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      exposureSourceKey: "htx_huobi",
      exposureSourceLabel: "HTX/Huobi",
      sourceExposureKind: "htx_huobi",
      reasons: [`Balance-forming path reaches ${classification.identity ?? classification.category} exposure (${formatShare(input.balanceShare)} of selected provenance target); this is source-policy risk, not direct scam/blacklist proof or approval-drain proof.`]
    };
  }

  if (classification.category === "cex") {
    const allowlistIdentity = matchedAllowlistIdentity(text);
    if (allowlistIdentity) {
      return {
        verdict: "ACCEPTABLE",
        rootSourceType: "allowlist_cex",
        stoppedReason: "allowlist_cex_reached",
        riskScoreContribution: 5,
        reasons: [`Balance-forming path reaches allowlisted CEX ${allowlistIdentity} through clean on-chain hops.`]
      };
    }
    return {
      verdict: "REVIEW",
      rootSourceType: "unknown",
      stoppedReason: "unlabeled_service_boundary",
      riskScoreContribution: 50,
      exposureSourceKey: "unknown_cex",
      sourceExposureKind: "unknown_cex",
      reasons: [`Balance-forming path reaches unlabeled or non-allowlisted CEX ${classification.identity ?? input.address}; manual review required.`]
    };
  }

  if (classification.category === "unknown_contract") {
    const score = baseShareScore("unknown_contract", input.balanceShare);
    return {
      verdict: "REVIEW",
      rootSourceType: "unknown",
      stoppedReason: "unlabeled_service_boundary",
      riskScoreContribution: score,
      exposureSourceKey: "unknown_contract",
      sourceExposureKind: "unknown_contract",
      reasons: [`Balance-forming path reaches unknown contract boundary; clean source is not proven, but this is not direct scam or approval-drain proof.`]
    };
  }

  if (DECLINE_BOUNDARY_CATEGORIES.has(classification.category)) {
    const score = baseShareScore("bridge_router_dex", input.balanceShare);
    return {
      verdict: sourcePolicyDecision(input.balanceShare),
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      exposureSourceKey: "bridge_router_dex",
      exposureSourceLabel: "Bridge/router/DEX",
      sourceExposureKind: "bridge_router_dex",
      reasons: [`Balance-forming path reaches ${classification.category} boundary (${formatShare(input.balanceShare)} of selected provenance target); this is source-policy context unless it covers a meaningful share. Public-chain continuity after the service boundary should not be assumed.`]
    };
  }

  return {
    verdict: "REVIEW",
    rootSourceType: "unknown",
    stoppedReason: "unlabeled_service_boundary",
    riskScoreContribution: 45,
    reasons: [`Balance-forming path reaches service boundary ${classification.category}; manual review required.`]
  };
}

function decisionRank(decision: ExchangeDecision): number {
  if (decision === "DECLINE") return 3;
  if (decision === "REVIEW") return 2;
  return 1;
}

function aggregateWhitebitExposure(paths: MoneyOriginPath[]): { riskScore: number; reason: string } | null {
  const whitebitPaths = paths.filter((path) => path.exposureSourceKey === "whitebit");
  if (whitebitPaths.length < 2) return null;
  const totalShare = Math.min(1, whitebitPaths.reduce((sum, path) => {
    const share = selectedMoneyOriginPathShare(path);
    return share > 0 ? sum + share : sum;
  }, 0));
  if (totalShare <= 0) return null;
  return {
    riskScore: baseShareScore("whitebit", totalShare),
    reason: `Balance-forming paths have combined WhiteBIT exposure (${formatShare(totalShare)} of selected provenance target) across ${whitebitPaths.length} txs; this is medium source-policy risk, not direct scam/blacklist proof.`
  };
}

export function combineMoneyOriginDecision(paths: MoneyOriginPath[]): CombinedMoneyOriginDecision {
  if (paths.length === 0) {
    return {
      decision: "REVIEW",
      riskScore: 45,
      decisionReasons: ["No balance-forming origin paths were available; manual review required."]
    };
  }

  const sorted = [...paths].sort((left, right) =>
    decisionRank(right.verdict) - decisionRank(left.verdict) ||
    right.riskScoreContribution - left.riskScoreContribution
  );
  const whitebitExposure = aggregateWhitebitExposure(paths);
  const aggregateDecision: ExchangeDecision | null = whitebitExposure && whitebitExposure.riskScore >= 60
    ? "DECLINE"
    : null;
  const reasons = sorted.flatMap((path) => path.reasons);
  return {
    decision: aggregateDecision ?? sorted[0].verdict,
    riskScore: Math.max(
      ...paths.map((path) => path.riskScoreContribution),
      whitebitExposure?.riskScore ?? 0
    ),
    decisionReasons: [
      ...(whitebitExposure ? [whitebitExposure.reason] : []),
      ...reasons
    ].slice(0, 6)
  };
}

export function riskLevelFromMoneyOriginScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}
