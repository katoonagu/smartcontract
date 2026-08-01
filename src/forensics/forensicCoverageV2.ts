import type {
  CoverageExclusionV1,
  CoverageLimitationV1,
  ForensicCoverageV2,
  ForensicRouteEdge,
  IncomingDepositInput,
  IncomingDepositRiskReport,
  WhereIsMoneyCoverage,
  WhereIsMoneyReport
} from "../types";

const CANONICAL_RAW = /^(0|[1-9]\d*)$/;

export type BuildForensicCoverageV2Input = {
  scope: ForensicCoverageV2["scope"];
  availableInboundTxCount: number | null;
  selectedInboundTxCount: number;
  selectedAmountRaw: string | null;
  tracedAmountRaw: string | null;
  exclusions: CoverageExclusionV1[];
  limitations: CoverageLimitationV1[];
};

export type BuildIncomingCoverageV2Input = {
  deposit: IncomingDepositInput;
  report: IncomingDepositRiskReport;
};

export type BuildDeepCoverageV2Input = {
  subjectAddress: string;
  sourceEdges: ForensicRouteEdge[];
  subjectAllTimeComplete: boolean | null;
  authoritativeCoverageExact: boolean;
  localMaterializationExact: boolean;
  authoritativeTransferCount: number | null;
  providerCapHit?: boolean;
  providerInconsistent?: boolean;
};

function isCanonicalRaw(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_RAW.test(value);
}

function assertCount(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function assertRaw(value: unknown, field: string): asserts value is string {
  if (!isCanonicalRaw(value)) throw new Error(`${field} must be canonical non-negative raw units`);
}

function rawShare(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

function evidenceIds(input: ForensicCoverageV2): string[] {
  return [
    ...input.exclusions.flatMap((item) => item.evidenceIds),
    ...input.limitations.flatMap((item) => item.evidenceIds)
  ];
}

function expectedCompleteness(input: Pick<
  ForensicCoverageV2,
  | "scope"
  | "availableInboundTxCount"
  | "selectedAmountRaw"
  | "tracedAmountRaw"
  | "unresolvedAmountRaw"
  | "limitations"
>): ForensicCoverageV2["completeness"] {
  const exactAmounts = input.selectedAmountRaw !== null &&
    input.tracedAmountRaw !== null &&
    input.unresolvedAmountRaw !== null;
  const exactZeroUnresolved = exactAmounts && BigInt(input.unresolvedAmountRaw!) === 0n;
  const deepCountOnly = input.scope === "deep_history" &&
    input.selectedAmountRaw === null &&
    input.tracedAmountRaw === null &&
    input.unresolvedAmountRaw === null;
  const deepAuthorityAbsent = deepCountOnly && input.limitations.some((limitation) =>
    limitation.evidenceIds.includes("deep:coverage:authority-absent")
  );
  if (
    input.availableInboundTxCount !== null &&
    input.limitations.length === 0 &&
    (exactZeroUnresolved || deepCountOnly)
  ) return "complete";
  if (deepAuthorityAbsent) return "unknown";
  if (input.limitations.length > 0 || (exactAmounts && BigInt(input.unresolvedAmountRaw!) > 0n)) return "partial";
  return "unknown";
}

export function validateForensicCoverageV2(value: ForensicCoverageV2): ForensicCoverageV2 {
  if (value.version !== "forensic-coverage-v2") throw new Error("invalid coverage version");
  if (!["current_balance", "requested_amount", "transaction_seed", "recent_flow", "deep_history"].includes(value.scope)) {
    throw new Error("invalid coverage scope");
  }
  assertCount(value.selectedInboundTxCount, "selectedInboundTxCount");
  if (value.availableInboundTxCount !== null) {
    assertCount(value.availableInboundTxCount, "availableInboundTxCount");
    if (value.selectedInboundTxCount > value.availableInboundTxCount) {
      throw new Error("selected inbound count exceeds available inbound count");
    }
  }
  if (value.excludedInboundTxCount !== null) assertCount(value.excludedInboundTxCount, "excludedInboundTxCount");

  for (const [field, raw] of [
    ["selectedAmountRaw", value.selectedAmountRaw],
    ["tracedAmountRaw", value.tracedAmountRaw],
    ["unresolvedAmountRaw", value.unresolvedAmountRaw]
  ] as const) {
    if (raw !== null) assertRaw(raw, field);
  }
  if (value.selectedAmountRaw !== null && value.tracedAmountRaw !== null) {
    if (BigInt(value.tracedAmountRaw) > BigInt(value.selectedAmountRaw)) {
      throw new Error("traced amount exceeds selected amount");
    }
    const expectedUnresolved = (BigInt(value.selectedAmountRaw) - BigInt(value.tracedAmountRaw)).toString();
    if (value.unresolvedAmountRaw !== expectedUnresolved) throw new Error("unresolved amount is not derived from exact raw amounts");
    const expectedTracedShare = rawShare(BigInt(value.tracedAmountRaw), BigInt(value.selectedAmountRaw));
    const expectedUnresolvedShare = rawShare(BigInt(expectedUnresolved), BigInt(value.selectedAmountRaw));
    if (value.tracedShare !== expectedTracedShare || value.unresolvedShare !== expectedUnresolvedShare) {
      throw new Error("coverage shares are not derived at four decimal places");
    }
  } else {
    if (value.tracedAmountRaw !== null && value.selectedAmountRaw === null) {
      throw new Error("traced amount requires an exact selected denominator");
    }
    if (value.tracedShare !== null || value.unresolvedAmountRaw !== null || value.unresolvedShare !== null) {
      throw new Error("shares and unresolved coverage require exact selected and traced raw amounts");
    }
  }

  for (const exclusion of value.exclusions) {
    if (![
      "after_checked_operation",
      "consumed_by_earlier_spend",
      "exact_gasfree_service_fee",
      "different_selected_scope",
      "provider_history_unavailable",
      "local_materialization_failed",
      "other_proven_not_selected"
    ].includes(exclusion.reason)) throw new Error("invalid coverage exclusion reason");
    if (exclusion.direction !== "incoming" && exclusion.direction !== "outgoing" && exclusion.direction !== null) {
      throw new Error("invalid coverage exclusion direction");
    }
    assertCount(exclusion.txCount, "exclusion.txCount");
    if (exclusion.amountRaw !== null) assertRaw(exclusion.amountRaw, "exclusion.amountRaw");
  }
  for (const limitation of value.limitations) {
    if (limitation.reason !== "provider_history_unavailable" && limitation.reason !== "local_materialization_failed") {
      throw new Error("invalid coverage limitation reason");
    }
  }
  if (value.availableInboundTxCount !== null) {
    const incomingExcludedCount = value.exclusions
      .filter((item) => item.direction === "incoming")
      .reduce((sum, item) => sum + item.txCount, 0);
    const expectedExcludedCount = value.availableInboundTxCount - value.selectedInboundTxCount;
    if (incomingExcludedCount !== expectedExcludedCount || value.excludedInboundTxCount !== expectedExcludedCount) {
      throw new Error("incoming exclusion count does not reconcile the available denominator");
    }
  } else if (value.excludedInboundTxCount !== null) {
    throw new Error("excluded inbound count requires a known available denominator");
  }

  const ids = evidenceIds(value);
  if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
    throw new Error("coverage evidence ids must be non-empty and globally unique");
  }
  if (value.completeness !== expectedCompleteness(value)) {
    throw new Error("coverage completeness contradicts exact amounts, denominator, or limitations");
  }
  return value;
}

export function buildForensicCoverageV2(input: BuildForensicCoverageV2Input): ForensicCoverageV2 {
  assertCount(input.selectedInboundTxCount, "selectedInboundTxCount");
  if (input.availableInboundTxCount !== null) assertCount(input.availableInboundTxCount, "availableInboundTxCount");
  if (input.selectedAmountRaw !== null) assertRaw(input.selectedAmountRaw, "selectedAmountRaw");
  if (input.tracedAmountRaw !== null) assertRaw(input.tracedAmountRaw, "tracedAmountRaw");

  const selected = input.selectedAmountRaw === null ? null : BigInt(input.selectedAmountRaw);
  const traced = input.tracedAmountRaw === null ? null : BigInt(input.tracedAmountRaw);
  if (selected !== null && traced !== null && traced > selected) throw new Error("traced amount exceeds selected amount");
  const unresolved = selected !== null && traced !== null
    ? (selected > traced ? selected - traced : 0n)
    : null;
  const incomingExcludedCount = input.availableInboundTxCount === null
    ? null
    : input.exclusions
      .filter((item) => item.direction === "incoming")
      .reduce((sum, item) => sum + item.txCount, 0);
  const coverageWithoutCompleteness = {
    version: "forensic-coverage-v2",
    scope: input.scope,
    availableInboundTxCount: input.availableInboundTxCount,
    selectedInboundTxCount: input.selectedInboundTxCount,
    excludedInboundTxCount: incomingExcludedCount,
    selectedAmountRaw: input.selectedAmountRaw,
    tracedAmountRaw: input.tracedAmountRaw,
    tracedShare: selected !== null && traced !== null ? rawShare(traced, selected) : null,
    unresolvedAmountRaw: unresolved?.toString() ?? null,
    unresolvedShare: selected !== null && unresolved !== null ? rawShare(unresolved, selected) : null,
    exclusions: input.exclusions,
    limitations: input.limitations
  } as const;
  return validateForensicCoverageV2({
    ...coverageWithoutCompleteness,
    completeness: expectedCompleteness(coverageWithoutCompleteness)
  });
}

export function adaptLegacyWhereCoverageV2(coverage: WhereIsMoneyCoverage): ForensicCoverageV2 {
  const selectedAmountRaw = isCanonicalRaw(coverage.selectedAmountRaw)
    ? coverage.selectedAmountRaw
    : isCanonicalRaw(coverage.selectedInboundVolumeRaw)
      ? coverage.selectedInboundVolumeRaw
      : null;
  return {
    version: "forensic-coverage-v2",
    scope: coverage.provenanceScope ?? "current_balance",
    availableInboundTxCount: null,
    selectedInboundTxCount: Number.isInteger(coverage.selectedInboundTxCount) && coverage.selectedInboundTxCount >= 0
      ? coverage.selectedInboundTxCount
      : 0,
    excludedInboundTxCount: null,
    selectedAmountRaw,
    tracedAmountRaw: null,
    tracedShare: null,
    unresolvedAmountRaw: null,
    unresolvedShare: null,
    exclusions: [],
    limitations: [],
    completeness: "unknown"
  };
}

function exactIncomingTracedAmountRaw(report: IncomingDepositRiskReport, deposit: IncomingDepositInput): string | null {
  const depositRaw = isCanonicalRaw(deposit.amountRaw) ? BigInt(deposit.amountRaw) : null;
  if (depositRaw === null) return null;
  const candidates: bigint[] = [];
  for (const path of report.originPaths) {
    const depositStep = path.steps.find((step) =>
      step.txHash === deposit.txHash &&
      step.fromAddress === deposit.sender &&
      step.toAddress === deposit.watchedWallet &&
      step.amountRaw === deposit.amountRaw
    );
    if (!depositStep) continue;
    for (const bundle of path.fundingBundles ?? []) {
      if (
        !isCanonicalRaw(bundle.targetAmountRaw) ||
        !isCanonicalRaw(bundle.bundleAmountRaw) ||
        bundle.fundingTxHashes.length === 0 ||
        bundle.fundingFunders.length === 0 ||
        bundle.fundingFunders.some((funder) => !isCanonicalRaw(funder.amountRaw))
      ) continue;
      const funderSum = bundle.fundingFunders.reduce((sum, funder) => sum + BigInt(funder.amountRaw), 0n);
      if (funderSum !== BigInt(bundle.bundleAmountRaw)) continue;
      const targetIndex = path.steps.findIndex((step) =>
        step.txHash === bundle.targetTxHash &&
        step.fromAddress === bundle.targetFromAddress &&
        step.toAddress === bundle.targetToAddress &&
        step.amountRaw === bundle.targetAmountRaw
      );
      const depositIndex = path.steps.indexOf(depositStep);
      if (targetIndex < 0 || depositIndex < targetIndex) continue;
      const continuityRaw = path.steps.slice(targetIndex, depositIndex + 1).map((step) => step.amountRaw);
      if (continuityRaw.some((raw) => !isCanonicalRaw(raw))) continue;
      const weakestContinuity = [bundle.bundleAmountRaw, bundle.targetAmountRaw, ...continuityRaw]
        .reduce((minimum, raw) => BigInt(raw) < minimum ? BigInt(raw) : minimum, depositRaw);
      candidates.push(weakestContinuity > depositRaw ? depositRaw : weakestContinuity);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((maximum, candidate) => candidate > maximum ? candidate : maximum, 0n).toString();
}

function incomingLimitationReason(blocker: string | null | undefined): CoverageLimitationV1["reason"] | null {
  if (!blocker || blocker === "completed" || blocker === "insufficient_coverage") return null;
  if ([
    "budget_limited",
    "partial_budget_exhausted",
    "local_budget_limited",
    "local_index_read_failed",
    "local_data_error",
    "hard_safety_limit_exceeded"
  ].includes(blocker)) return "local_materialization_failed";
  if ([
    "provider_error",
    "provider_limited",
    "provider_cap_unresolved",
    "rate_limited_after_retries",
    "provider_inconsistent"
  ].includes(blocker)) return "provider_history_unavailable";
  return null;
}

function incomingLimitations(report: IncomingDepositRiskReport): CoverageLimitationV1[] {
  const targeted = report.targetedHistoryCoverage;
  const blockers = targeted
    ? [
        targeted.firstBlockingTechnicalStatus,
        targeted.firstBlockingReason,
        report.technicalStatus,
        report.scoreBlockedReason
      ]
    : [report.technicalStatus, report.scoreBlockedReason];
  const blocker = blockers.find((candidate) => incomingLimitationReason(candidate) !== null) ?? null;
  const reason = incomingLimitationReason(blocker);
  if (!blocker || !reason) return [];
  return [{
    reason,
    evidenceIds: [`incoming:coverage:${blocker}`]
  }];
}

export function buildIncomingCoverageV2(input: BuildIncomingCoverageV2Input): ForensicCoverageV2 {
  return buildForensicCoverageV2({
    scope: "transaction_seed",
    availableInboundTxCount: 1,
    selectedInboundTxCount: 1,
    selectedAmountRaw: input.deposit.amountRaw,
    tracedAmountRaw: exactIncomingTracedAmountRaw(input.report, input.deposit),
    exclusions: [],
    limitations: incomingLimitations(input.report)
  });
}

export function adaptLegacyIncomingCoverageV2(input: {
  report: Pick<IncomingDepositRiskReport, "coverageV2"> | Record<string, unknown>;
  seed: IncomingDepositInput | null;
}): ForensicCoverageV2 | null {
  const coverage = (input.report as { coverageV2?: ForensicCoverageV2 }).coverageV2;
  if (coverage) {
    try {
      return validateForensicCoverageV2(coverage);
    } catch {
      return null;
    }
  }
  if (!input.seed) return null;
  try {
    return buildForensicCoverageV2({
      scope: "transaction_seed",
      availableInboundTxCount: 1,
      selectedInboundTxCount: 1,
      selectedAmountRaw: input.seed.amountRaw,
      tracedAmountRaw: null,
      exclusions: [],
      limitations: []
    });
  } catch {
    return null;
  }
}

export function buildDeepCoverageV2(input: BuildDeepCoverageV2Input): ForensicCoverageV2 {
  const inbound = input.sourceEdges.filter((edge) =>
    edge.toAddress === input.subjectAddress &&
    edge.fromAddress !== input.subjectAddress &&
    isCanonicalRaw(edge.amountRaw) &&
    BigInt(edge.amountRaw) > 0n
  );
  const providerAuthorityExact = input.subjectAllTimeComplete === true &&
    input.authoritativeCoverageExact &&
    input.authoritativeTransferCount !== null &&
    Number.isInteger(input.authoritativeTransferCount) &&
    input.authoritativeTransferCount >= 0 &&
    input.providerCapHit !== true &&
    input.providerInconsistent !== true;
  const exactAuthority = providerAuthorityExact &&
    input.localMaterializationExact &&
    input.sourceEdges.length === input.authoritativeTransferCount;
  const hasAuthority = input.subjectAllTimeComplete !== null;
  const limitations: CoverageLimitationV1[] = exactAuthority
    ? []
    : [{
        reason: providerAuthorityExact ? "local_materialization_failed" : "provider_history_unavailable",
        evidenceIds: [providerAuthorityExact
          ? "deep:coverage:local-materialization"
          : "deep:coverage:provider-history"]
      }];
  return buildForensicCoverageV2({
    scope: "deep_history",
    availableInboundTxCount: exactAuthority ? inbound.length : null,
    selectedInboundTxCount: inbound.length,
    selectedAmountRaw: null,
    tracedAmountRaw: null,
    exclusions: [],
    limitations: !hasAuthority
      ? [{ reason: "provider_history_unavailable", evidenceIds: ["deep:coverage:authority-absent"] }]
      : limitations
  });
}

export function adaptLegacyDeepCoverageV2(input: unknown): ForensicCoverageV2 | null {
  const coverageV2 = input && typeof input === "object"
    ? (input as { coverageV2?: ForensicCoverageV2 }).coverageV2
    : undefined;
  if (!coverageV2) return null;
  try {
    return validateForensicCoverageV2(coverageV2);
  } catch {
    return null;
  }
}

export function coverageV2FromWhereReport(report: WhereIsMoneyReport): ForensicCoverageV2 {
  return report.coverageV2 ?? adaptLegacyWhereCoverageV2(report.coverage);
}
