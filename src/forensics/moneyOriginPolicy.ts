import type {
  AddressLabel,
  ExchangeDecision,
  MoneyOriginPath,
  MoneyOriginRootSourceType,
  MoneyOriginStoppedReason,
  RiskLevel,
  ServiceCategory,
  ServiceClassification
} from "../types";

export type MoneyOriginStopClassification = {
  verdict: ExchangeDecision;
  rootSourceType: MoneyOriginRootSourceType;
  stoppedReason: MoneyOriginStoppedReason;
  riskScoreContribution: number;
  exposureSourceKey?: string;
  exposureSourceLabel?: string;
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
  "swap_adapter",
  "unknown_contract"
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
  return `${Math.round(value * 100)}%`;
}

function whitebitMediumScore(balanceShare: number): number {
  if (balanceShare >= 0.5) return 55;
  if (balanceShare >= 0.15) return 45;
  return 35;
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
    const score = whitebitMediumScore(input.balanceShare);
    return {
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      exposureSourceKey: "whitebit",
      exposureSourceLabel: "WhiteBIT",
      reasons: [`Balance-forming path has WhiteBIT exposure (${formatShare(input.balanceShare)} of current balance); this is a medium-risk source signal, not HTX/Huobi high-risk exposure.`]
    };
  }

  if (!classification || classification.category === "none" || classification.isBoundary === false) {
    return null;
  }

  if (hasHighRiskIdentity(text)) {
    return {
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 78,
      reasons: [`Balance-forming path reaches ${classification.identity ?? classification.category}; exchange policy treats HTX/Huobi sources as high risk.`]
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
      reasons: [`Balance-forming path reaches unlabeled or non-allowlisted CEX ${classification.identity ?? input.address}; manual review required.`]
    };
  }

  if (DECLINE_BOUNDARY_CATEGORIES.has(classification.category)) {
    const score = classification.category === "unknown_contract" && input.balanceShare < 0.5 ? 65 : 78;
    return {
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: score,
      reasons: [`Balance-forming path reaches ${classification.category} boundary; this is an exchange-policy decline source. Public-chain continuity after the service boundary should not be assumed.`]
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
    const share = path.balanceShare ?? 0;
    return Number.isFinite(share) && share > 0 ? sum + share : sum;
  }, 0));
  if (totalShare <= 0) return null;
  return {
    riskScore: whitebitMediumScore(totalShare),
    reason: `Balance-forming paths have combined WhiteBIT exposure (${formatShare(totalShare)} of current balance) across ${whitebitPaths.length} txs; this is a medium-risk source signal, not HTX/Huobi high-risk exposure.`
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
  const reasons = sorted.flatMap((path) => path.reasons);
  return {
    decision: sorted[0].verdict,
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
