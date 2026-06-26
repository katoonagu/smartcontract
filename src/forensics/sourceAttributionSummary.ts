export type SourceAttributionPathStrength = "strong" | "medium" | "weak" | "unknown";

export interface SourceAttributionCandidate {
  label: string;
  category: string;
  amountShare: number;
  sourceConfidence: number;
  pathStrength: SourceAttributionPathStrength;
  boundaryReason?: string;
}

export interface SourceAttributionSummary {
  explainedAmountShare: number;
  unknownAmountShare: number;
  topSourceCandidate: SourceAttributionCandidate | null;
  sourceConfidence: number;
  pathStrength: SourceAttributionPathStrength;
  attributionBasis: string[];
  boundaryReason?: string;
}

export interface WhereSourceAttributionPathInput {
  label: string;
  category: string;
  effectiveAmountShare: number;
  amountContinuityRatio: number;
  hopCount: number;
  elapsedMs?: number;
  stoppedReason?: string;
}

export interface IncomingSourceAttributionPathInput {
  label: string;
  category: string;
  amountCoverageRatio: number;
  amountContinuityRatio?: number;
  stoppedReason?: string;
}

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

export function buildWhereSourceAttributionSummary(input: {
  paths: WhereSourceAttributionPathInput[];
}): SourceAttributionSummary {
  const candidates = input.paths.map((path) => {
    const amountShare = roundShare(path.effectiveAmountShare);
    const sourceConfidence = scoreWherePath(path);

    return {
      label: path.label,
      category: path.category,
      amountShare,
      sourceConfidence,
      pathStrength: strengthForScore(sourceConfidence),
      ...(path.stoppedReason ? { boundaryReason: path.stoppedReason } : {})
    };
  });

  return buildSummary(candidates, ["amount continuity"]);
}

export function buildIncomingSourceAttributionSummary(input: {
  paths: IncomingSourceAttributionPathInput[];
}): SourceAttributionSummary {
  const candidates = input.paths.map((path) => {
    const amountShare = roundShare(path.amountCoverageRatio);
    const sourceConfidence = scoreIncomingPath(path);

    return {
      label: path.label,
      category: path.category,
      amountShare,
      sourceConfidence,
      pathStrength: strengthForScore(sourceConfidence),
      ...(path.stoppedReason ? { boundaryReason: path.stoppedReason } : {})
    };
  });

  return buildSummary(candidates, ["amount coverage"]);
}

function buildSummary(candidates: SourceAttributionCandidate[], attributionBasis: string[]): SourceAttributionSummary {
  const explainedAmountShare = roundShare(candidates.reduce((sum, candidate) => sum + candidate.amountShare, 0));
  const topSourceCandidate = [...candidates].sort(compareCandidates)[0] ?? null;

  return {
    explainedAmountShare,
    unknownAmountShare: roundShare(1 - explainedAmountShare),
    topSourceCandidate,
    sourceConfidence: topSourceCandidate?.sourceConfidence ?? 0,
    pathStrength: topSourceCandidate?.pathStrength ?? "unknown",
    attributionBasis: topSourceCandidate ? attributionBasis : [],
    ...(topSourceCandidate?.boundaryReason ? { boundaryReason: topSourceCandidate.boundaryReason } : {})
  };
}

function scoreWherePath(path: WhereSourceAttributionPathInput): number {
  const shareScore = clampRatio(path.effectiveAmountShare) * 100;
  const continuityScore = clampRatio(path.amountContinuityRatio) * 20;
  const hopPenalty = Math.max(0, path.hopCount - 2) * 10;
  const timePenalty = path.elapsedMs !== undefined && path.elapsedMs > sevenDaysMs ? 10 : 0;
  const boundaryPenalty = path.stoppedReason ? 25 : 0;

  return clampScore(shareScore + continuityScore - hopPenalty - timePenalty - boundaryPenalty);
}

function scoreIncomingPath(path: IncomingSourceAttributionPathInput): number {
  const coverageScore = clampRatio(path.amountCoverageRatio) * 100;
  const continuityBonus = clampRatio(path.amountContinuityRatio ?? 0) * 10;
  const boundaryPenalty = path.stoppedReason ? 25 : 0;

  return clampScore(coverageScore + continuityBonus - boundaryPenalty);
}

function compareCandidates(left: SourceAttributionCandidate, right: SourceAttributionCandidate): number {
  return (
    right.amountShare - left.amountShare ||
    right.sourceConfidence - left.sourceConfidence ||
    left.label.localeCompare(right.label)
  );
}

function strengthForScore(score: number): SourceAttributionPathStrength {
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

function roundShare(value: number): number {
  return Math.round(clampRatio(value) * 100) / 100;
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}
