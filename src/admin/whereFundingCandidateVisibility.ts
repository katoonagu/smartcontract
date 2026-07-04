export const WHERE_FUNDING_CANDIDATE_LIMITS = {
  exactGlobalCap: 20,
  exactPerHopSoftCap: 5,
  probableGlobalCap: 5,
  probablePerHopSoftCap: 2
} as const;

export type WhereFundingCandidateProofClass =
  | "exact"
  | "probable"
  | "pre_existing_balance_possible"
  | "unresolved"
  | "service_boundary";

export type WhereFundingCandidateRole =
  | "exact_funding_candidate"
  | "probable_funding_context"
  | "pre_existing_balance_caveat"
  | "unresolved_source_caveat"
  | "service_boundary"
  | "grouped_candidate_tail";

export type WhereFundingCandidateItem = {
  role: WhereFundingCandidateRole;
  proofClass: WhereFundingCandidateProofClass;
  pathId: string;
  pathIndex: number;
  sourceProvenanceIndex: number;
  memberIndex: number;
  candidateRank: number;
  fromAddress: string;
  toAddress: string;
  txHash: string | null;
  amountRaw: string | null;
  usedAmountRaw: string | null;
  originalAmountRaw: string | null;
  timestamp: string | null;
  candidateCoverageRatio: number | null;
  targetTxHash: string | null;
  targetHopEdgeId: string | null;
  targetFromAddress: string | null;
  targetToAddress: string | null;
  targetTimestamp: string | null;
  targetAmountRaw: string | null;
  anchorAmountRaw: string | null;
  amountContinuity: string | null;
  coverageWindow: Record<string, unknown> | null;
  stopReason: string | null;
  shouldRender: boolean;
  renderSuppressedReason: string | null;
  visibilityReason: string;
  sourceProvenance: Record<string, unknown>;
  fundingBundle: Record<string, unknown>;
  member: Record<string, unknown>;
};

export type WhereFundingCandidateGroup = {
  role: "grouped_candidate_tail";
  proofClass: "exact" | "probable";
  pathId: string;
  pathIndex: number;
  sourceProvenanceIndex: number;
  targetTxHash: string | null;
  targetHopEdgeId: string | null;
  targetFromAddress: string | null;
  targetToAddress: string | null;
  hiddenCount: number;
  hiddenCandidateIds: string[];
  amountRaw: string | null;
  visibilityReason: string;
};

export type WhereFundingCandidateCaveat = {
  role: "pre_existing_balance_caveat" | "unresolved_source_caveat" | "service_boundary";
  proofClass: "pre_existing_balance_possible" | "unresolved" | "service_boundary";
  pathId: string;
  pathIndex: number;
  sourceProvenanceIndex: number;
  targetTxHash: string | null;
  targetHopEdgeId: string | null;
  targetFromAddress: string | null;
  targetToAddress: string | null;
  targetTimestamp: string | null;
  targetAmountRaw: string | null;
  amountContinuity: string | null;
  coverageWindow: Record<string, unknown> | null;
  stopReason: string | null;
  visibilityReason: string;
  sourceProvenance: Record<string, unknown>;
};

export type WhereFundingCandidateVisibilitySummary = {
  exactShownCount: number;
  exactTotalCount: number;
  probableShownCount: number;
  probableTotalCount: number;
  groupedHiddenCount: number;
  unresolvedCaveatCount: number;
  preExistingBalanceCaveatCount: number;
  serviceBoundaryCount: number;
  routeHopCount: number;
  maxProvenRouteDepth: number;
};

export type WhereFundingCandidateVisibility = {
  candidates: WhereFundingCandidateItem[];
  groups: WhereFundingCandidateGroup[];
  caveats: WhereFundingCandidateCaveat[];
  summary: WhereFundingCandidateVisibilitySummary;
};

type Limits = typeof WHERE_FUNDING_CANDIDATE_LIMITS;

export function buildWhereFundingCandidateVisibility(input: {
  subjectAddress: string;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  originPaths: Record<string, unknown>[];
  existingFundingBundleHopTxHashes: Set<string>;
  limits?: Partial<Limits>;
}): WhereFundingCandidateVisibility {
  const limits = { ...WHERE_FUNDING_CANDIDATE_LIMITS, ...(input.limits ?? {}) };
  const candidates: WhereFundingCandidateItem[] = [];
  const caveats: WhereFundingCandidateCaveat[] = [];
  let routeHopCount = 0;
  let maxProvenRouteDepth = 0;

  input.originPaths.forEach((path, pathIndex) => {
    const pathId = `path:${pathIndex}`;
    const steps = recordArrayField(path, "steps");
    routeHopCount += steps.length;
    maxProvenRouteDepth = Math.max(maxProvenRouteDepth, steps.length);

    recordArrayField(path, "sourceProvenance").forEach((sourceProvenance, sourceProvenanceIndex) => {
      const proofClass = proofClassField(sourceProvenance);
      if (!proofClass) return;

      const target = targetFields(pathIndex, steps, sourceProvenance);
      if (proofClass === "exact" || proofClass === "probable") {
        const fundingBundle = recordField(sourceProvenance, "fundingBundle");
        if (!fundingBundle) return;
        recordArrayField(fundingBundle, "members").forEach((candidateMember, memberIndex) => {
          const candidate = candidateFromMember({
            input,
            path,
            pathId,
            pathIndex,
            sourceProvenance,
            sourceProvenanceIndex,
            fundingBundle,
            member: candidateMember,
            memberIndex,
            proofClass,
            target
          });
          if (candidate) candidates.push(candidate);
        });
        return;
      }

      const caveat = caveatFromSourceProvenance({
        pathId,
        pathIndex,
        sourceProvenance,
        sourceProvenanceIndex,
        proofClass,
        target
      });
      if (caveat) caveats.push(caveat);
    });
  });

  applyCandidateLimits(candidates, limits, "exact");
  applyCandidateLimits(candidates, limits, "probable");
  const groups = groupedHiddenCandidates(candidates);
  const visibleCandidates = [...candidates].sort(compareCandidates);
  const summary: WhereFundingCandidateVisibilitySummary = {
    exactShownCount: visibleCandidates.filter((candidate) => candidate.proofClass === "exact" && candidate.shouldRender).length,
    exactTotalCount: visibleCandidates.filter((candidate) => candidate.proofClass === "exact").length,
    probableShownCount: visibleCandidates.filter((candidate) => candidate.proofClass === "probable" && candidate.shouldRender).length,
    probableTotalCount: visibleCandidates.filter((candidate) => candidate.proofClass === "probable").length,
    groupedHiddenCount: groups.reduce((sum, group) => sum + group.hiddenCount, 0),
    unresolvedCaveatCount: caveats.filter((caveat) => caveat.proofClass === "unresolved").length,
    preExistingBalanceCaveatCount: caveats.filter((caveat) => caveat.proofClass === "pre_existing_balance_possible").length,
    serviceBoundaryCount: caveats.filter((caveat) => caveat.proofClass === "service_boundary").length,
    routeHopCount,
    maxProvenRouteDepth
  };

  return {
    candidates: visibleCandidates,
    groups,
    caveats,
    summary
  };
}

function candidateFromMember(input: {
  input: {
    selectedAmountRaw: string | null;
    targetAmountRaw: string | null;
    existingFundingBundleHopTxHashes: Set<string>;
  };
  path: Record<string, unknown>;
  pathId: string;
  pathIndex: number;
  sourceProvenance: Record<string, unknown>;
  sourceProvenanceIndex: number;
  fundingBundle: Record<string, unknown>;
  member: Record<string, unknown>;
  memberIndex: number;
  proofClass: "exact" | "probable";
  target: TargetFields;
}): WhereFundingCandidateItem | null {
  const fromAddress = stringField(input.member, "fromAddress");
  const toAddress = stringField(input.member, "toAddress");
  if (!fromAddress || !toAddress || !input.target.targetFromAddress) return null;
  if (toAddress !== input.target.targetFromAddress) return null;
  const timestamp = stringField(input.member, "timestamp");
  if (!timestampBeforeOrEqual(timestamp, input.target.targetTimestamp)) return null;
  const duplicateExistingBundle = input.target.targetTxHash
    ? input.input.existingFundingBundleHopTxHashes.has(input.target.targetTxHash)
    : false;
  const amountRaw = firstString(
    stringField(input.member, "usedAmountRaw"),
    stringField(input.member, "coveredAmountRaw"),
    stringField(input.member, "originalAmountRaw")
  );
  const targetAmountRaw = input.target.targetAmountRaw ?? stringField(input.fundingBundle, "expectedAmountRaw");
  const importantHop = targetAmountRaw !== null && (
    targetAmountRaw === input.input.selectedAmountRaw ||
    targetAmountRaw === input.input.targetAmountRaw
  ) || (numberField(input.path, "balanceShare") ?? 0) >= 0.5;

  return {
    role: input.proofClass === "exact" ? "exact_funding_candidate" : "probable_funding_context",
    proofClass: input.proofClass,
    pathId: input.pathId,
    pathIndex: input.pathIndex,
    sourceProvenanceIndex: input.sourceProvenanceIndex,
    memberIndex: input.memberIndex,
    candidateRank: 0,
    fromAddress,
    toAddress,
    txHash: stringField(input.member, "txHash"),
    amountRaw,
    usedAmountRaw: stringField(input.member, "usedAmountRaw"),
    originalAmountRaw: stringField(input.member, "originalAmountRaw"),
    timestamp,
    candidateCoverageRatio: firstNumber(
      numberField(input.member, "coverageShare"),
      numberField(input.sourceProvenance, "coverageRatio"),
      numberField(input.fundingBundle, "coverageRatio")
    ),
    targetTxHash: input.target.targetTxHash,
    targetHopEdgeId: input.target.targetHopEdgeId,
    targetFromAddress: input.target.targetFromAddress,
    targetToAddress: input.target.targetToAddress,
    targetTimestamp: input.target.targetTimestamp,
    targetAmountRaw,
    anchorAmountRaw: stringField(input.fundingBundle, "expectedAmountRaw"),
    amountContinuity: stringField(input.sourceProvenance, "amountContinuity"),
    coverageWindow: recordField(input.sourceProvenance, "coverageWindow"),
    stopReason: stringField(input.sourceProvenance, "stopReason"),
    shouldRender: !duplicateExistingBundle,
    renderSuppressedReason: duplicateExistingBundle ? "duplicate_existing_funding_bundle" : null,
    visibilityReason: input.proofClass === "exact" ? "selected_exact_funding_candidate" : "selected_probable_funding_context",
    sourceProvenance: input.sourceProvenance,
    fundingBundle: input.fundingBundle,
    member: input.member,
    ...{ importantHop }
  } as WhereFundingCandidateItem & { importantHop: boolean };
}

function caveatFromSourceProvenance(input: {
  pathId: string;
  pathIndex: number;
  sourceProvenance: Record<string, unknown>;
  sourceProvenanceIndex: number;
  proofClass: "pre_existing_balance_possible" | "unresolved" | "service_boundary";
  target: TargetFields;
}): WhereFundingCandidateCaveat | null {
  const role = input.proofClass === "pre_existing_balance_possible"
    ? "pre_existing_balance_caveat"
    : input.proofClass === "service_boundary"
      ? "service_boundary"
      : "unresolved_source_caveat";
  return {
    role,
    proofClass: input.proofClass,
    pathId: input.pathId,
    pathIndex: input.pathIndex,
    sourceProvenanceIndex: input.sourceProvenanceIndex,
    targetTxHash: input.target.targetTxHash,
    targetHopEdgeId: input.target.targetHopEdgeId,
    targetFromAddress: input.target.targetFromAddress,
    targetToAddress: input.target.targetToAddress,
    targetTimestamp: input.target.targetTimestamp,
    targetAmountRaw: input.target.targetAmountRaw,
    amountContinuity: stringField(input.sourceProvenance, "amountContinuity"),
    coverageWindow: recordField(input.sourceProvenance, "coverageWindow"),
    stopReason: stringField(input.sourceProvenance, "stopReason"),
    visibilityReason: `${role}_from_source_provenance`,
    sourceProvenance: input.sourceProvenance
  };
}

function applyCandidateLimits(
  candidates: WhereFundingCandidateItem[],
  limits: Limits,
  proofClass: "exact" | "probable"
): void {
  const globalCap = proofClass === "exact" ? limits.exactGlobalCap : limits.probableGlobalCap;
  const perHopSoftCap = proofClass === "exact" ? limits.exactPerHopSoftCap : limits.probablePerHopSoftCap;
  let shown = 0;
  const shownByHop = new Map<string, number>();
  const sorted = candidates
    .filter((candidate) => candidate.proofClass === proofClass)
    .sort(compareCandidates);

  sorted.forEach((candidate, index) => {
    candidate.candidateRank = index + 1;
    if (!candidate.shouldRender) return;
    const hopKey = candidate.targetTxHash ?? `${candidate.pathId}:${candidate.sourceProvenanceIndex}`;
    const hopShown = shownByHop.get(hopKey) ?? 0;
    const importantHop = Boolean((candidate as WhereFundingCandidateItem & { importantHop?: boolean }).importantHop);
    if (shown >= globalCap) {
      candidate.shouldRender = false;
      candidate.renderSuppressedReason = "over_global_cap";
      return;
    }
    if (!importantHop && hopShown >= perHopSoftCap) {
      candidate.shouldRender = false;
      candidate.renderSuppressedReason = "over_per_hop_cap";
      return;
    }
    shown += 1;
    shownByHop.set(hopKey, hopShown + 1);
  });
}

function groupedHiddenCandidates(candidates: WhereFundingCandidateItem[]): WhereFundingCandidateGroup[] {
  const byHop = new Map<string, WhereFundingCandidateItem[]>();
  candidates.forEach((candidate) => {
    if (candidate.shouldRender) return;
    if (candidate.renderSuppressedReason !== "over_global_cap" && candidate.renderSuppressedReason !== "over_per_hop_cap") return;
    const key = [
      candidate.proofClass,
      candidate.pathId,
      candidate.sourceProvenanceIndex,
      candidate.targetTxHash ?? ""
    ].join(":");
    const items = byHop.get(key) ?? [];
    items.push(candidate);
    byHop.set(key, items);
  });

  return Array.from(byHop.values()).map((items) => {
    const first = items[0];
    return {
      role: "grouped_candidate_tail",
      proofClass: first.proofClass as "exact" | "probable",
      pathId: first.pathId,
      pathIndex: first.pathIndex,
      sourceProvenanceIndex: first.sourceProvenanceIndex,
      targetTxHash: first.targetTxHash,
      targetHopEdgeId: first.targetHopEdgeId,
      targetFromAddress: first.targetFromAddress,
      targetToAddress: first.targetToAddress,
      hiddenCount: items.length,
      hiddenCandidateIds: items.map(candidateStableId),
      amountRaw: sumRaw(items.map((item) => item.amountRaw)),
      visibilityReason: "grouped_over_limit_funding_candidates"
    };
  });
}

type TargetFields = {
  targetTxHash: string | null;
  targetHopEdgeId: string | null;
  targetFromAddress: string | null;
  targetToAddress: string | null;
  targetTimestamp: string | null;
  targetAmountRaw: string | null;
};

function targetFields(
  pathIndex: number,
  steps: Record<string, unknown>[],
  sourceProvenance: Record<string, unknown>
): TargetFields {
  const targetTxHash = stringField(sourceProvenance, "targetTxHash");
  const stepIndex = targetTxHash
    ? steps.findIndex((step) => stringField(step, "txHash") === targetTxHash)
    : -1;
  const step = stepIndex >= 0 ? steps[stepIndex] : null;
  return {
    targetTxHash,
    targetHopEdgeId: stepIndex >= 0 ? `edge:${pathIndex}:${stepIndex}` : null,
    targetFromAddress: stringField(sourceProvenance, "targetFromAddress") ?? (step ? stringField(step, "fromAddress") : null),
    targetToAddress: stringField(sourceProvenance, "targetToAddress") ?? (step ? stringField(step, "toAddress") : null),
    targetTimestamp: stringField(sourceProvenance, "targetTimestamp") ?? (step ? stringField(step, "timestamp") : null),
    targetAmountRaw: stringField(sourceProvenance, "targetAmountRaw") ?? (step ? stringField(step, "amountRaw") : null)
  };
}

function compareCandidates(left: WhereFundingCandidateItem, right: WhereFundingCandidateItem): number {
  return proofRank(left.proofClass) - proofRank(right.proofClass) ||
    compareNumberDesc(left.candidateCoverageRatio, right.candidateCoverageRatio) ||
    compareRawDesc(left.usedAmountRaw ?? left.amountRaw, right.usedAmountRaw ?? right.amountRaw) ||
    compareTimeDelta(left, right) ||
    continuityRank(left.amountContinuity) - continuityRank(right.amountContinuity) ||
    String(left.txHash ?? "").localeCompare(String(right.txHash ?? "")) ||
    left.pathIndex - right.pathIndex ||
    left.sourceProvenanceIndex - right.sourceProvenanceIndex ||
    left.memberIndex - right.memberIndex;
}

function proofRank(value: WhereFundingCandidateProofClass): number {
  if (value === "exact") return 0;
  if (value === "probable") return 1;
  return 2;
}

function continuityRank(value: string | null): number {
  if (value === "strong") return 0;
  if (value === "weak") return 1;
  if (value === "broken") return 2;
  return 3;
}

function compareNumberDesc(left: number | null, right: number | null): number {
  return (right ?? -1) - (left ?? -1);
}

function compareRawDesc(left: string | null, right: string | null): number {
  const leftValue = parseRaw(left);
  const rightValue = parseRaw(right);
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? -1 : 1;
}

function compareTimeDelta(left: WhereFundingCandidateItem, right: WhereFundingCandidateItem): number {
  const leftDelta = timeDelta(left.timestamp, left.targetTimestamp);
  const rightDelta = timeDelta(right.timestamp, right.targetTimestamp);
  return (leftDelta ?? Number.MAX_SAFE_INTEGER) - (rightDelta ?? Number.MAX_SAFE_INTEGER);
}

function candidateStableId(candidate: WhereFundingCandidateItem): string {
  return [
    candidate.pathIndex,
    candidate.sourceProvenanceIndex,
    candidate.memberIndex,
    candidate.txHash ?? candidate.fromAddress
  ].join(":");
}

function proofClassField(record: Record<string, unknown>): WhereFundingCandidateProofClass | null {
  const value = stringField(record, "proofClass");
  if (
    value === "exact" ||
    value === "probable" ||
    value === "pre_existing_balance_possible" ||
    value === "unresolved" ||
    value === "service_boundary"
  ) return value;
  return null;
}

function timestampBeforeOrEqual(candidateTimestamp: string | null, targetTimestamp: string | null): boolean {
  const candidateTime = parseTime(candidateTimestamp);
  const targetTime = parseTime(targetTimestamp);
  if (candidateTime === null || targetTime === null) return true;
  return candidateTime <= targetTime;
}

function timeDelta(candidateTimestamp: string | null, targetTimestamp: string | null): number | null {
  const candidateTime = parseTime(candidateTimestamp);
  const targetTime = parseTime(targetTimestamp);
  if (candidateTime === null || targetTime === null) return null;
  return Math.abs(targetTime - candidateTime);
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function sumRaw(values: Array<string | null>): string | null {
  const sum = values.reduce((total, value) => total + parseRaw(value), 0n);
  return sum > 0n ? sum.toString() : null;
}

function parseRaw(value: string | null): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

function firstString(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function firstNumber(...values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null) ?? null;
}

function recordArrayField(record: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const value = record[field];
  return isRecord(value) ? value : null;
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
