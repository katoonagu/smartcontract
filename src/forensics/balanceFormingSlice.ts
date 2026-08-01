import type { ForensicRouteEdge } from "../types";
import { buildFundingBundleForTraceHop, type TraceFundingBundle } from "./incomingDepositCashflow";

export type BalanceFormingSliceStatus =
  | "covered"
  | "partial"
  | "dense_unresolved"
  | "provider_inconsistent";

export type BalanceFormingSliceReason =
  | "balance_forming_slice_provider_inconsistent"
  | "balance_forming_slice_budget_exhausted"
  | "balance_forming_slice_provider_cap"
  | "balance_forming_slice_partial";

export type BalanceFormingSliceResult = {
  status: BalanceFormingSliceStatus;
  reason: BalanceFormingSliceReason | null;
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetAmountRaw: string;
  targetTimestamp: string;
  coveredAmountRaw: string;
  coverageRatio: number;
  fetchedTransferCount: number;
  fetchedPageCount: number;
  pageBudgetExhausted: boolean;
  providerCapHit: boolean;
  providerInconsistent: boolean;
  fundingBundle: TraceFundingBundle | null;
};

function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

export function buildBalanceFormingSlice(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  minCoverageRatio: number;
  maxFunders: number;
  fetchedPageCount: number;
  pageBudgetExhausted: boolean;
  providerCapHit: boolean;
  providerInconsistent: boolean;
}): BalanceFormingSliceResult {
  const fundingBundle = buildFundingBundleForTraceHop({
    target: input.target,
    edges: input.edges,
    minCoverageRatio: input.minCoverageRatio,
    maxFunders: input.maxFunders
  });
  const targetAmount = parseRaw(input.target.amountRaw);
  const coveredAmount = parseRaw(fundingBundle?.coveredAmountRaw ?? "0");
  const coverageRatio = fundingBundle?.coverageRatio ?? ratio(coveredAmount, targetAmount);
  const covered = fundingBundle?.meetsThreshold === true;
  const status: BalanceFormingSliceStatus = input.providerInconsistent
    ? "provider_inconsistent"
    : covered
      ? "covered"
      : input.pageBudgetExhausted || input.providerCapHit
        ? "dense_unresolved"
        : "partial";
  const reason: BalanceFormingSliceReason | null = status === "covered"
    ? null
    : status === "provider_inconsistent"
      ? "balance_forming_slice_provider_inconsistent"
      : input.pageBudgetExhausted
        ? "balance_forming_slice_budget_exhausted"
        : input.providerCapHit
          ? "balance_forming_slice_provider_cap"
          : "balance_forming_slice_partial";

  return {
    status,
    reason,
    targetTxHash: input.target.txHash,
    targetFromAddress: input.target.fromAddress,
    targetToAddress: input.target.toAddress,
    targetAmountRaw: input.target.amountRaw,
    targetTimestamp: input.target.timestamp.toISOString(),
    coveredAmountRaw: coveredAmount.toString(),
    coverageRatio,
    fetchedTransferCount: input.edges.length,
    fetchedPageCount: input.fetchedPageCount,
    pageBudgetExhausted: input.pageBudgetExhausted,
    providerCapHit: input.providerCapHit,
    providerInconsistent: input.providerInconsistent,
    fundingBundle
  };
}
