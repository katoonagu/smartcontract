import type {
  ForensicRouteEdge,
  MoneyOriginAmountContinuity,
  MoneyOriginFundingBundle,
  MoneyOriginFundingSourceProvenance,
  MoneyOriginTraceHistoryCoverage,
  MoneyOriginStoppedReason,
  TronAddressUsdtCoverageStatusReason
} from "../types";
import { buildFundingBundleForTraceHop } from "./incomingDepositCashflow";
import type { TraceFundingBundle } from "./incomingDepositCashflow";

export const FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS = {
  minFundingCoverageRatio: 0.95,
  warningFundingCoverageRatio: 0.8,
  maxDownstreamToUpstreamRatioForProof: 10,
  hardBreakDownstreamToUpstreamRatio: 100
} as const;

export type FundingSourceExactWindowCoverage = {
  complete: boolean;
  capped?: boolean | null;
  providerInconsistent?: boolean | null;
  statusReason?: TronAddressUsdtCoverageStatusReason | null;
  fetchedTransferCount?: number | null;
  fetchedPageCount?: number | null;
  oldestFetchedTransferAt?: string | null;
  source?: MoneyOriginTraceHistoryCoverage["source"];
};

export type FundingSourceExactWindowRepairResult = {
  provenance: MoneyOriginFundingSourceProvenance;
  traceBundle: TraceFundingBundle | null;
};

export function evaluateFundingFirstSourceProvenance(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  historyCoverage: MoneyOriginTraceHistoryCoverage | null;
  downstreamAmountRaw?: string | null;
  minCoverageRatio?: number;
  maxFunders?: number;
}): MoneyOriginFundingSourceProvenance {
  const minCoverageRatio = input.minCoverageRatio ??
    FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS.minFundingCoverageRatio;
  const bundle = buildFundingBundleForTraceHop({
    target: input.target,
    edges: input.edges,
    minCoverageRatio,
    maxFunders: input.maxFunders ?? 5
  });
  const moneyOriginBundle = bundle ? toMoneyOriginFundingBundle(bundle) : null;
  const amountContinuity = classifyAmountContinuity({
    targetAmountRaw: input.target.amountRaw,
    downstreamAmountRaw: input.downstreamAmountRaw
  });
  const coverage = coverageWindow(input.historyCoverage, input.target, bundle);
  const reasons: string[] = [];

  if (coverage.providerInconsistent) {
    reasons.push("provider_inconsistent");
  }
  if (!coverage.complete) {
    reasons.push("coverage_window_not_exact");
  }
  if (coverage.capped) {
    if (input.historyCoverage?.providerCapHit === true || input.historyCoverage?.statusReason === "partial_provider_cap") {
      reasons.push("provider_cap_hit");
    }
    if (input.historyCoverage?.budgetExhausted === true || input.historyCoverage?.statusReason === "partial_budget_exhausted") {
      reasons.push("budget_exhausted");
    }
  }
  if (amountContinuity === "broken") {
    reasons.push("downstream_amount_breaks_continuity");
    return result({
      target: input.target,
      bundle: moneyOriginBundle,
      coverage,
      amountContinuity,
      proofClass: "unresolved",
      stopReason: "amount_continuity_broken",
      reasons
    });
  }

  if (bundle?.meetsThreshold && moneyOriginBundle) {
    reasons.push("funding_bundle_amount_covered");
    if (coverage.complete) {
      reasons.push("funding_bundle_exact");
      return result({
        target: input.target,
        bundle: moneyOriginBundle,
        coverage,
        amountContinuity,
        proofClass: "exact",
        stopReason: null,
        reasons
      });
    }
    return result({
      target: input.target,
      bundle: moneyOriginBundle,
      coverage,
      amountContinuity,
      proofClass: "probable",
      stopReason: "incoming_history_not_fetched",
      reasons
    });
  }

  if (bundle && !bundle.meetsThreshold) {
    reasons.push("funding_bundle_below_threshold");
    return result({
      target: input.target,
      bundle: moneyOriginBundle,
      coverage,
      amountContinuity,
      proofClass: "unresolved",
      stopReason: "funding_first_unresolved",
      reasons
    });
  }

  if (coverage.complete) {
    reasons.push("no_funding_candidate_in_reached_history");
    return result({
      target: input.target,
      bundle: moneyOriginBundle,
      coverage,
      amountContinuity,
      proofClass: "pre_existing_balance_possible",
      stopReason: "pre_existing_balance_possible",
      reasons
    });
  }

  reasons.push("funding_source_unresolved");
  return result({
    target: input.target,
    bundle: moneyOriginBundle,
    coverage,
    amountContinuity,
    proofClass: "unresolved",
    stopReason: "funding_first_unresolved",
    reasons
  });
}

export function repairFundingSourceExactWindow(input: {
  target: ForensicRouteEdge;
  windowEdges: ForensicRouteEdge[];
  windowCoverage: FundingSourceExactWindowCoverage;
  downstreamAmountRaw?: string | null;
  minCoverageRatio?: number;
  maxFunders?: number;
}): FundingSourceExactWindowRepairResult {
  const minCoverageRatio = input.minCoverageRatio ??
    FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS.minFundingCoverageRatio;
  const maxFunders = input.maxFunders ?? 5;
  const traceBundle = buildFundingBundleForTraceHop({
    target: input.target,
    edges: input.windowEdges,
    minCoverageRatio,
    maxFunders
  });
  const provenance = evaluateFundingFirstSourceProvenance({
    target: input.target,
    edges: input.windowEdges,
    historyCoverage: exactWindowHistoryCoverage(input),
    downstreamAmountRaw: input.downstreamAmountRaw,
    minCoverageRatio,
    maxFunders
  });

  return {
    provenance: provenance.proofClass === "exact"
      ? { ...provenance, reasons: Array.from(new Set([...provenance.reasons, "exact_window_repaired"])) }
      : provenance,
    traceBundle
  };
}

function result(input: {
  target: ForensicRouteEdge;
  bundle: MoneyOriginFundingBundle | null;
  coverage: MoneyOriginFundingSourceProvenance["coverageWindow"];
  amountContinuity: MoneyOriginAmountContinuity;
  proofClass: MoneyOriginFundingSourceProvenance["proofClass"];
  stopReason: MoneyOriginStoppedReason | null;
  reasons: string[];
}): MoneyOriginFundingSourceProvenance {
  return {
    mode: "source_provenance",
    targetTxHash: input.target.txHash,
    targetFromAddress: input.target.fromAddress,
    targetToAddress: input.target.toAddress,
    targetTimestamp: input.target.timestamp.toISOString(),
    targetAmountRaw: input.target.amountRaw,
    proofClass: input.proofClass,
    coveredAmountRaw: input.bundle?.coveredAmountRaw ?? "0",
    coverageRatio: input.bundle?.coverageRatio ?? 0,
    amountContinuity: input.amountContinuity,
    stopReason: input.stopReason,
    fundingBundle: input.bundle,
    coverageWindow: input.coverage,
    reasons: Array.from(new Set(input.reasons))
  };
}

function toMoneyOriginFundingBundle(bundle: TraceFundingBundle): MoneyOriginFundingBundle {
  return {
    hopTxHash: bundle.targetTxHash,
    hopAddress: bundle.targetAddress,
    expectedAmountRaw: bundle.expectedAmountRaw,
    coveredAmountRaw: bundle.coveredAmountRaw,
    coverageRatio: bundle.coverageRatio,
    members: bundle.members.map((member) => ({
      txHash: member.edge.txHash,
      fromAddress: member.edge.fromAddress,
      toAddress: member.edge.toAddress,
      originalAmountRaw: member.edge.amountRaw,
      usedAmountRaw: member.usedAmountRaw,
      spentBeforeHopRaw: member.spentBeforeHopRaw,
      timestamp: member.edge.timestamp.toISOString(),
      coverageShare: member.coverageRatio
    }))
  };
}

function exactWindowHistoryCoverage(input: {
  target: ForensicRouteEdge;
  windowEdges: ForensicRouteEdge[];
  windowCoverage: FundingSourceExactWindowCoverage;
}): MoneyOriginTraceHistoryCoverage {
  const capped = input.windowCoverage.capped === true ||
    statusReasonIsCapped(input.windowCoverage.statusReason);
  const providerInconsistent = input.windowCoverage.providerInconsistent === true ||
    input.windowCoverage.statusReason === "partial_provider_inconsistent";
  const complete = input.windowCoverage.complete === true && !capped && !providerInconsistent;
  return {
    address: input.target.fromAddress,
    targetTimestamp: input.target.timestamp.toISOString(),
    fetchedTransferCount: input.windowCoverage.fetchedTransferCount ?? input.windowEdges.length,
    fetchedPageCount: input.windowCoverage.fetchedPageCount ?? null,
    oldestFetchedTransferAt: input.windowCoverage.oldestFetchedTransferAt ?? oldestEdgeTimestamp(input.windowEdges),
    reachedTargetHop: complete,
    source: input.windowCoverage.source ?? "local_index",
    coverageComplete: complete,
    providerCapHit: capped,
    budgetExhausted: input.windowCoverage.statusReason === "partial_budget_exhausted",
    providerInconsistent,
    statusReason: input.windowCoverage.statusReason ?? (complete ? null : capped ? "partial_provider_cap" : null)
  };
}

function coverageWindow(
  historyCoverage: MoneyOriginTraceHistoryCoverage | null,
  target: ForensicRouteEdge,
  bundle: TraceFundingBundle | null
): MoneyOriginFundingSourceProvenance["coverageWindow"] {
  const capped = historyCoverageCapped(historyCoverage);
  const providerInconsistent = historyCoverageInconsistent(historyCoverage);
  return {
    startTimestamp: fundingStartTimestamp(bundle),
    endTimestamp: target.timestamp.toISOString(),
    complete: historyCoverageExact(historyCoverage) && !capped && !providerInconsistent,
    capped,
    providerInconsistent
  };
}

function historyCoverageExact(historyCoverage: MoneyOriginTraceHistoryCoverage | null): boolean {
  if (!historyCoverage) return false;
  if (historyCoverage.coverageComplete === true) return true;
  if (historyCoverage.coverageComplete === false) return false;
  return historyCoverage.reachedTargetHop &&
    !historyCoverageCapped(historyCoverage) &&
    !historyCoverageInconsistent(historyCoverage);
}

function historyCoverageCapped(historyCoverage: MoneyOriginTraceHistoryCoverage | null): boolean {
  if (!historyCoverage) return true;
  return historyCoverage.providerCapHit === true ||
    historyCoverage.budgetExhausted === true ||
    statusReasonIsCapped(historyCoverage.statusReason);
}

function historyCoverageInconsistent(historyCoverage: MoneyOriginTraceHistoryCoverage | null): boolean {
  if (!historyCoverage) return false;
  return historyCoverage.providerInconsistent === true ||
    historyCoverage.statusReason === "partial_provider_inconsistent";
}

function statusReasonIsCapped(statusReason: TronAddressUsdtCoverageStatusReason | null | undefined): boolean {
  return statusReason === "partial_provider_cap" ||
    statusReason === "partial_budget_exhausted" ||
    statusReason === "partial_rate_limited" ||
    statusReason === "too_large_deferred";
}

function fundingStartTimestamp(bundle: TraceFundingBundle | null): string | null {
  if (!bundle || bundle.members.length === 0) return null;
  const oldest = bundle.members.reduce<Date | null>((current, member) => {
    if (!current || member.edge.timestamp < current) return member.edge.timestamp;
    return current;
  }, null);
  return oldest?.toISOString() ?? null;
}

function oldestEdgeTimestamp(edges: ForensicRouteEdge[]): string | null {
  const oldest = edges.reduce<Date | null>((current, edge) => {
    if (!current || edge.timestamp < current) return edge.timestamp;
    return current;
  }, null);
  return oldest?.toISOString() ?? null;
}

function classifyAmountContinuity(input: {
  targetAmountRaw: string;
  downstreamAmountRaw?: string | null;
}): MoneyOriginAmountContinuity {
  const target = parseRaw(input.targetAmountRaw);
  const downstream = parseRaw(input.downstreamAmountRaw ?? input.targetAmountRaw);
  if (target <= 0n || downstream <= 0n) return "strong";
  if (downstream >= target * BigInt(FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS.hardBreakDownstreamToUpstreamRatio)) {
    return "broken";
  }
  if (downstream >= target * BigInt(FUNDING_FIRST_SOURCE_PROVENANCE_THRESHOLDS.maxDownstreamToUpstreamRatioForProof)) {
    return "weak";
  }
  return "strong";
}

function parseRaw(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}
