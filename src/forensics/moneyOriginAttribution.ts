import type { AddressLabel, MoneyOriginPath } from "../types";

const EXACT_MONEY_ORIGIN_RISK_LABELS = new Set<AddressLabel["label"]>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange",
  "darknet_exchange_proximity"
]);

export function isExactMoneyOriginRiskLabel(value: string | null | undefined): value is AddressLabel["label"] {
  return EXACT_MONEY_ORIGIN_RISK_LABELS.has(value as AddressLabel["label"]);
}

export function isAuthoritativeMoneyOriginRiskLabelPath(path: MoneyOriginPath): boolean {
  return path.rootSourceType === "risky_label" &&
    path.sourceExposureKind === "risky_label" &&
    isExactMoneyOriginRiskLabel(path.exposureSourceKey);
}

export function selectedMoneyOriginPathShare(path: MoneyOriginPath): number {
  const balanceShare = path.balanceShare ?? 0;
  const usageShare = path.amountUsage?.coverageShare ?? 1;
  if (!Number.isFinite(balanceShare) || balanceShare <= 0) return 0;
  if (!Number.isFinite(usageShare) || usageShare <= 0) return 0;
  return Math.max(0, Math.min(1, balanceShare * usageShare));
}
