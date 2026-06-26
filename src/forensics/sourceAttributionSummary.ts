export type SourceAttributionPathStrength = "strong" | "medium" | "weak" | "unknown";

export interface SourceAttributionCandidate {
  label: string;
  address: string;
  kind: string;
  share: number;
  pathStrength: SourceAttributionPathStrength;
  confidence: number;
  boundaryReason: string | null;
  category?: string;
  amountShare?: number;
  sourceConfidence?: number;
}

export interface SourceAttributionSummary {
  explainedAmountShare: number;
  unknownAmountShare: number;
  topSourceCandidate: SourceAttributionCandidate | null;
  topSourceShare: number;
  sourceConfidence: number;
  pathStrength: SourceAttributionPathStrength;
  attributionBasis: string[];
  boundaryReason: string | null;
}

export interface WhereSourceAttributionPathInput {
  sourceAddress: string;
  exposureSourceLabel: string;
  sourceExposureKind: string;
  exposureSourceKey: string;
  rootSourceType: string;
  balanceShare: number;
  effectiveExposureShare: number;
  amountContinuity: number;
  hops: number;
  elapsedMs?: number;
  stoppedReason?: string | null;
  reasons: string[];
}

export interface IncomingSourceAttributionPathInput {
  sourceAddress: string;
  sourceLabel: string;
  sourcePolicy: string;
  amountCoverageRatio: number;
  amountContinuity: "strong" | "medium" | "weak" | null;
  stoppedReason?: string | null;
  steps: number;
  reasons: string[];
}

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

export function buildWhereSourceAttributionSummary(input: {
  paths: WhereSourceAttributionPathInput[];
}): SourceAttributionSummary {
  const candidates = input.paths.map((path) => {
    const share = roundShare(path.effectiveExposureShare);
    const confidence = scoreWherePath(path);

    return {
      label: path.exposureSourceLabel,
      address: path.sourceAddress,
      kind: path.sourceExposureKind,
      share,
      pathStrength: strengthForCandidate(confidence),
      confidence,
      boundaryReason: path.stoppedReason ?? null,
      category: path.sourceExposureKind,
      amountShare: share,
      sourceConfidence: confidence
    };
  });

  return buildSummary(candidates, ["amount continuity"]);
}

export function buildIncomingSourceAttributionSummary(input: {
  paths: IncomingSourceAttributionPathInput[];
}): SourceAttributionSummary {
  const candidates = input.paths.map((path) => {
    const share = roundShare(path.amountCoverageRatio);
    const confidence = scoreIncomingPath(path);

    return {
      label: path.sourceLabel,
      address: path.sourceAddress,
      kind: path.sourcePolicy,
      share,
      pathStrength: strengthForCandidate(confidence),
      confidence,
      boundaryReason: path.stoppedReason ?? null,
      category: path.sourcePolicy,
      amountShare: share,
      sourceConfidence: confidence
    };
  });

  return buildSummary(candidates, ["amount coverage"]);
}

function buildSummary(candidates: SourceAttributionCandidate[], attributionBasis: string[]): SourceAttributionSummary {
  const explainedAmountShare = roundShare(candidates.reduce((sum, candidate) => sum + candidate.share, 0));
  const topSourceCandidate = [...candidates].sort(compareCandidates)[0] ?? null;

  return {
    explainedAmountShare,
    unknownAmountShare: roundShare(1 - explainedAmountShare),
    topSourceCandidate,
    topSourceShare: topSourceCandidate?.share ?? 0,
    sourceConfidence: topSourceCandidate?.confidence ?? 0,
    pathStrength: topSourceCandidate?.pathStrength ?? "unknown",
    attributionBasis: topSourceCandidate ? attributionBasis : [],
    boundaryReason: topSourceCandidate?.boundaryReason ?? null
  };
}

function scoreWherePath(path: WhereSourceAttributionPathInput): number {
  const shareScore = clampRatio(path.effectiveExposureShare) * 100;
  const continuityScore = clampRatio(path.amountContinuity) * 20;
  const hopPenalty = Math.max(0, path.hops - 2) * 10;
  const timePenalty = path.elapsedMs !== undefined && path.elapsedMs > sevenDaysMs ? 10 : 0;
  const boundaryPenalty = path.stoppedReason ? 25 : 0;

  return clampScore(shareScore + continuityScore - hopPenalty - timePenalty - boundaryPenalty);
}

function scoreIncomingPath(path: IncomingSourceAttributionPathInput): number {
  const coverageScore = clampRatio(path.amountCoverageRatio) * 100;
  const continuityBonus = continuityRatio(path.amountContinuity) * 10;
  const boundaryPenalty = path.stoppedReason ? 25 : 0;

  return clampScore(coverageScore + continuityBonus - boundaryPenalty);
}

function compareCandidates(left: SourceAttributionCandidate, right: SourceAttributionCandidate): number {
  return (
    right.share - left.share ||
    right.confidence - left.confidence ||
    left.label.localeCompare(right.label)
  );
}

function strengthForCandidate(score: number): SourceAttributionPathStrength {
  if (score >= 70) {
    return "strong";
  }
  if (score >= 50) {
    return "medium";
  }
  if (score > 0) {
    return "weak";
  }
  return "weak";
}

function continuityRatio(continuity: IncomingSourceAttributionPathInput["amountContinuity"]): number {
  if (continuity === "strong") {
    return 1;
  }
  if (continuity === "medium") {
    return 0.6;
  }
  if (continuity === "weak") {
    return 0.3;
  }
  return 0;
}

function roundShare(value: number): number {
  return Math.round(clampRatio(value) * 100) / 100;
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clampScore(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : 0;
}
