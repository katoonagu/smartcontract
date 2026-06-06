import type { MoneyOriginPath } from "../types";

export function selectedMoneyOriginPathShare(path: MoneyOriginPath): number {
  const balanceShare = path.balanceShare ?? 0;
  const usageShare = path.amountUsage?.coverageShare ?? 1;
  if (!Number.isFinite(balanceShare) || balanceShare <= 0) return 0;
  if (!Number.isFinite(usageShare) || usageShare <= 0) return 0;
  return Math.max(0, Math.min(1, balanceShare * usageShare));
}
