import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import { resolveFinalDisposition } from "./finalDisposition";
import {
  scoreMatrixCandidates,
  type ClassifiedMatrixCandidate,
  type MatrixScoringResult
} from "./scoringSignalMatrix";
import { buildWalletMatrixCandidates } from "./scoringSignalMatrixInputs";
import { exactFastHardEvidence } from "./fastEvidence";
import type {
  DecisionCoverage,
  FinalDecisionBasis,
  RiskLevel,
  RiskReason,
  RiskReport,
  SourceExposureKind,
  UserExchangeDecision,
  WhereIsMoneyReport
} from "../types";

export type UnifiedWalletRiskLayer = "fast" | "deep" | "where";
export type UnifiedWalletCoverageLevel = "complete" | "partial" | "limited";

export type LayerScoreBreakdown = {
  rawScore: number;
  weight: number;
  weightedContribution: number;
  reasons: string[];
};

export type UnifiedWalletRiskReason = {
  code: string;
  message: string;
  score: number;
  source:
    | "fast_check"
    | "deep_research"
    | "where_is_money"
    | "hard_evidence"
    | "policy_floor"
    | "asset_continuation"
    | "pattern_floor"
    | "dampener"
    | "coverage"
    | "incoming_exposure";
};

export type UnifiedWalletRiskActiveAnchor = {
  code: string;
  message: string;
  score: number;
  source: UnifiedWalletRiskReason["source"];
};

export type UnifiedWalletRiskFloorBreakdown = {
  hardEvidence: number;
  policy: number;
  assetContinuation: number;
  pattern: number;
  coverage: number;
};

export type UnifiedWalletRiskScoreBreakdown = {
  weightedLayerScore: number;
  contextScore: number;
  dampener: number;
  floors: UnifiedWalletRiskFloorBreakdown;
  activeAnchor: UnifiedWalletRiskActiveAnchor | null;
  noHardEvidenceCriticalCap: {
    applied: boolean;
    maxScore: 84;
  };
};

export type UnifiedWalletRiskInput = {
  address: string;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};

export type UnifiedForensicRiskSubject =
  | { scope: "wallet"; address: string }
  | {
      scope: "incoming_deposit";
      senderAddress: string;
      receiverAddress: string;
      txHash: string;
      amountRaw: string;
      timestamp: Date;
    };

export type UnifiedForensicRiskInput = {
  subject: UnifiedForensicRiskSubject;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};

export type UnifiedWalletRiskResult = {
  finalScore: number | null;
  finalLevel: RiskLevel | null;
  finalDecision: UserExchangeDecision;
  observedContextScore: number;
  scoreValid: boolean;
  decisionBasis: FinalDecisionBasis;
  coverage: DecisionCoverage;
  weightedLayerScore: number;
  contextScore: number;
  hardEvidenceFloor: number;
  policyFloor: number;
  assetContinuationFloor: number;
  patternFloor: number;
  dampener: number;
  coverageLevel: UnifiedWalletCoverageLevel;
  layerBreakdown: Record<UnifiedWalletRiskLayer, LayerScoreBreakdown>;
  reasons: UnifiedWalletRiskReason[];
  scoreBreakdown: UnifiedWalletRiskScoreBreakdown;
  matrixScore: MatrixScoringResult;
};

export type UnifiedForensicRiskResult = UnifiedWalletRiskResult;

const FAST_LAYER_WEIGHT = 0.10;
const DEEP_LAYER_WEIGHT = 0.60;
const WHERE_LAYER_WEIGHT = 0.30;

const transitSourcePolicyKinds = new Set<SourceExposureKind>([
  "bridge_router_dex",
  "cross_chain_boundary",
  "mixer",
  "no_name_token_liquidity"
]);

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function maxScore(values: Array<number | null | undefined>): number {
  return clampScore(
    Math.max(0, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))
  );
}

function activeAnchorFromReasons(reasons: UnifiedWalletRiskReason[]): UnifiedWalletRiskActiveAnchor | null {
  const sorted = [...reasons]
    .filter((reason) => reason.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.code.localeCompare(right.code)
    );
  const top = sorted[0];
  return top
    ? {
        code: top.code,
        message: top.message,
        score: top.score,
        source: top.source
      }
    : null;
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function layer(rawScore: number, weight: number, reasons: string[]): LayerScoreBreakdown {
  const score = clampScore(rawScore);
  return {
    rawScore: score,
    weight,
    weightedContribution: Math.round(score * weight),
    reasons
  };
}

function selectedFastReport(input: UnifiedWalletRiskInput): RiskReport | null | undefined {
  return input.fastReport ?? input.whereReport.fastWalletRisk;
}

export function hasUnifiedFastHardEvidence(fastReport: RiskReport | null | undefined): boolean {
  return exactFastHardEvidence(fastReport).length > 0;
}

function deepLayer(report: DeepAddressForensicReport | null | undefined): LayerScoreBreakdown {
  if (!report) return layer(0, DEEP_LAYER_WEIGHT, ["Deep Research report is not available."]);
  const scores: number[] = [];
  const reasons: string[] = [];

  for (const profile of arrayOrEmpty(report.serviceExposureProfiles)) {
    scores.push(profile.exposureScore);
    if (profile.exposureScore > 0) reasons.push("service exposure profile");
  }

  for (const profile of arrayOrEmpty(report.addressBehaviorProfiles)) {
    scores.push(profile.depositThenDrainScore, profile.transitScore);
    if (profile.depositThenDrainScore > 0 || profile.transitScore > 0) reasons.push("address behavior profile");
  }

  for (const profile of arrayOrEmpty(report.operationalFlowProfiles)) {
    scores.push(profile.operationalScore);
    if (profile.operationalScore > 0) reasons.push("operational flow profile");
  }

  for (const profile of arrayOrEmpty(report.boundaryExposureProfiles)) {
    scores.push(Math.min(15, profile.contextScore));
    if (profile.contextScore > 0) reasons.push("service-boundary context");
  }

  for (const profile of arrayOrEmpty(report.approvalDrainProvenanceProfiles)) {
    scores.push(profile.score);
    if (profile.score > 0) reasons.push("approval-drain provenance profile");
  }

  for (const profile of arrayOrEmpty(report.assetContinuationProfiles)) {
    scores.push(Math.min(84, profile.score));
    if (profile.score > 0) reasons.push("asset continuation profile");
  }

  for (const profile of arrayOrEmpty(report.inboundProvenanceProfiles)) {
    scores.push(profile.score);
    if (profile.score > 0) reasons.push("inbound provenance profile");
  }

  for (const profile of arrayOrEmpty(report.counterpartyRiskProfiles)) {
    scores.push(profile.score);
    if (profile.score > 0) reasons.push("counterparty risk profile");
  }

  for (const profile of arrayOrEmpty(report.walletRoleProfiles)) {
    scores.push(...profile.roles.map((role) => role.score));
    if (profile.roles.some((role) => role.score > 0)) reasons.push("wallet role profile");
  }

  for (const profile of arrayOrEmpty(report.extendedProvenanceProfiles)) {
    scores.push(profile.score, ...profile.paths.map((path) => path.candidateScore));
    if (profile.score > 0 || profile.paths.some((path) => path.candidateScore > 0)) {
      reasons.push("extended provenance profile");
    }
  }

  for (const profile of arrayOrEmpty(report.directCounterpartyInteractionProfiles)) {
    scores.push(profile.scoreContribution);
    if (profile.scoreContribution > 0) reasons.push("direct counterparty interaction profile");
  }

  return layer(maxScore(scores), DEEP_LAYER_WEIGHT, [...new Set(reasons)]);
}

function fastLayer(input: UnifiedWalletRiskInput): LayerScoreBreakdown {
  const report = selectedFastReport(input);
  return layer(
    report?.score ?? 0,
    FAST_LAYER_WEIGHT,
    report ? report.reasons.map((reason) => reason.code) : ["Fast Check report is not available."]
  );
}

function whereLayer(report: WhereIsMoneyReport): LayerScoreBreakdown {
  return layer(report.riskScore, WHERE_LAYER_WEIGHT, report.decisionReasons);
}

function layerWithContribution(
  item: LayerScoreBreakdown,
  weightedContribution: number
): LayerScoreBreakdown {
  return {
    ...item,
    weightedContribution
  };
}

function layerIntegerWeight(item: LayerScoreBreakdown): number {
  return Math.max(0, Math.round(item.weight * 100));
}

function roundRatioHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clampScore(Math.floor((numerator * 2 + denominator) / (denominator * 2)));
}

function normalizedWeightedLayers(
  input: UnifiedWalletRiskInput,
  breakdown: Record<UnifiedWalletRiskLayer, LayerScoreBreakdown>
): {
  weightedLayerScore: number;
  layerBreakdown: Record<UnifiedWalletRiskLayer, LayerScoreBreakdown>;
} {
  const layerAvailability: Array<{
    key: UnifiedWalletRiskLayer;
    item: LayerScoreBreakdown;
    available: boolean;
  }> = [
    { key: "fast", item: breakdown.fast, available: Boolean(selectedFastReport(input)) },
    { key: "deep", item: breakdown.deep, available: Boolean(input.deepReport) },
    { key: "where", item: breakdown.where, available: true }
  ];
  const availableLayers = layerAvailability.filter((item) => item.available);
  const weightedLayers = availableLayers.map((layerItem, index) => ({
    ...layerItem,
    integerWeight: layerIntegerWeight(layerItem.item),
    index
  }));
  const totalWeight = weightedLayers.reduce((sum, item) => sum + item.integerWeight, 0);

  const emptyBreakdown = {
    fast: layerWithContribution(breakdown.fast, 0),
    deep: layerWithContribution(breakdown.deep, 0),
    where: layerWithContribution(breakdown.where, 0)
  };
  if (totalWeight <= 0) {
    return {
      weightedLayerScore: 0,
      layerBreakdown: emptyBreakdown
    };
  }

  const totalNumerator = weightedLayers.reduce((sum, layerItem) => {
    return sum + layerItem.item.rawScore * layerItem.integerWeight;
  }, 0);
  const weightedLayerScore = roundRatioHalfUp(totalNumerator, totalWeight);
  const apportionedContributions = new Map<UnifiedWalletRiskLayer, number>([
    ["fast", 0],
    ["deep", 0],
    ["where", 0]
  ]);
  const availableContributions = weightedLayers.map((layerItem) => {
    const numerator = layerItem.item.rawScore * layerItem.integerWeight;
    const flooredContribution = Math.floor(numerator / totalWeight);
    apportionedContributions.set(layerItem.key, flooredContribution);
    return {
      key: layerItem.key,
      numerator,
      remainder: numerator % totalWeight,
      index: layerItem.index
    };
  });
  const apportionedSum = [...apportionedContributions.values()].reduce((sum, contribution) => sum + contribution, 0);
  let remainingContribution = weightedLayerScore - apportionedSum;
  const layersByRemainder = availableContributions.sort((a, b) => {
    return b.remainder - a.remainder || b.numerator - a.numerator || a.index - b.index;
  });
  for (let index = 0; remainingContribution > 0 && layersByRemainder.length > 0; index += 1) {
    const layerItem = layersByRemainder[index % layersByRemainder.length];
    apportionedContributions.set(layerItem.key, (apportionedContributions.get(layerItem.key) ?? 0) + 1);
    remainingContribution -= 1;
  }

  return {
    weightedLayerScore,
    layerBreakdown: {
      fast: layerWithContribution(breakdown.fast, apportionedContributions.get("fast") ?? 0),
      deep: layerWithContribution(breakdown.deep, apportionedContributions.get("deep") ?? 0),
      where: layerWithContribution(breakdown.where, apportionedContributions.get("where") ?? 0)
    }
  };
}

function coverageLevel(input: UnifiedWalletRiskInput): UnifiedWalletCoverageLevel {
  const wherePartial = input.whereReport.coverage.partial || input.whereReport.coverage.fetchedAddressCount <= 1;
  const deep = input.deepReport;
  const deepSparse = deep ? (deep.coverage?.transferEdges ?? 0) < 10 : true;
  if (wherePartial && deepSparse) return "limited";
  if (!deep || !selectedFastReport(input)) return "partial";
  const deepMissingCount = arrayOrEmpty(deep.missingChecks).length + arrayOrEmpty(deep.coverageDebug?.missingChecks).length;
  if (wherePartial || deepMissingCount > 0) return "partial";
  return "complete";
}

function isTransitSourcePolicyKind(kind: string | null | undefined): boolean {
  return kind !== null && kind !== undefined && transitSourcePolicyKinds.has(kind as SourceExposureKind);
}

function hasStrongTransitSourcePolicyAnchor(report: WhereIsMoneyReport): boolean {
  return arrayOrEmpty(report.assessment.sourcePolicyEvidence)
    .some((item) =>
      isTransitSourcePolicyKind(item.kind) &&
      (item.proofLevel === "exchange_policy_decline" || item.score >= 60)
    ) ||
    arrayOrEmpty(report.assessment.riskLayers).some((layerItem) =>
      layerItem.evidenceClass === "source_policy" &&
      isTransitSourcePolicyKind(layerItem.sourceExposureKind ?? layerItem.kind) &&
      (
        layerItem.proofLevel === "exchange_policy_decline" ||
        Math.max(layerItem.adjustedScore, layerItem.score) >= 60
      )
    );
}

function rawDampener(input: UnifiedWalletRiskInput, options: { strongTransitAnchor: boolean }): UnifiedWalletRiskReason {
  const fastReasons: RiskReason[] = selectedFastReport(input)?.reasons ?? [];
  const fastNegative = fastReasons
    .filter((reason) => reason.scoreImpact < 0)
    .reduce((sum, reason) => sum + Math.abs(reason.scoreImpact), 0);
  const rawBehaviorDampener =
    arrayOrEmpty(input.deepReport?.addressBehaviorProfiles)
      .reduce((max, profile) => Math.max(max, profile.dampenerScore), 0);
  const behaviorDampener = options.strongTransitAnchor
    ? Math.min(rawBehaviorDampener, 5)
    : rawBehaviorDampener;
  const roleDampener =
    input.whereReport.assessment.walletRole === "clean_cex_funded_wallet"
      ? 15
      : input.whereReport.assessment.walletRole === "operational_liquidity_wallet"
        ? 10
        : 0;

  return {
    code: "unified_dampener",
    message: "Trusted, clean-role, or behavior dampener applied to non-hard evidence.",
    score: Math.min(40, fastNegative + behaviorDampener + roleDampener),
    source: "dampener"
  };
}

function allowedDampener(input: {
  raw: number;
  contextScore: number;
  floorScore: number;
}): number {
  if (input.raw <= 0) return 0;
  if (input.contextScore <= input.floorScore) return 0;
  return Math.min(input.raw, input.contextScore - input.floorScore, 25);
}

function matrixAnchorSource(
  winner: MatrixScoringResult["winningCandidate"]
): UnifiedWalletRiskReason["source"] {
  if (winner.evidenceClass === "exact_hard") return "hard_evidence";
  if (winner.evidenceClass === "policy") return "policy_floor";
  if (winner.row === "asset_continuation") return "asset_continuation";
  if (winner.evidenceClass === "pattern") {
    return "pattern_floor";
  }
  if (winner.evidenceClass === "coverage") return "coverage";
  return "deep_research";
}

function matrixAnchorReason(matrixScore: MatrixScoringResult): UnifiedWalletRiskReason | null {
  if (matrixScore.policyScore === null) return null;
  return {
    code: `matrix:${matrixScore.winningRow}`,
    message: `Scoring Signal Matrix winning row is ${matrixScore.winningRow}.`,
    score: matrixScore.policyScore,
    source: matrixAnchorSource(matrixScore.winningCandidate)
  };
}

function matrixCandidates(matrix: MatrixScoringResult): ClassifiedMatrixCandidate[] {
  return Object.values(matrix.riskVector).flatMap((candidates) => candidates ?? []);
}

function matrixCandidateReason(
  candidate: ClassifiedMatrixCandidate,
  source: UnifiedWalletRiskReason["source"]
): UnifiedWalletRiskReason {
  return {
    code: candidate.atomicSignals[0] ?? `${candidate.row}:${candidate.evidenceIds[0] ?? "unknown"}`,
    message: source === "hard_evidence"
      ? "Applicable exact hard evidence from the canonical scoring matrix."
      : `Applicable ${candidate.row} evidence from the canonical scoring matrix.`,
    score: candidate.score,
    source
  };
}

function walletDecisionCoverage(
  report: WhereIsMoneyReport,
  coverageLevel: UnifiedWalletCoverageLevel
): DecisionCoverage {
  const notApplicable = report.coverage.questionStatus === "not_applicable";
  const invalid = !notApplicable && report.scoreValid !== true;
  return {
    required: notApplicable ? "not_applicable" : invalid ? "invalid" : "valid",
    overall: invalid || report.coverage.partial || coverageLevel !== "complete" ? "partial" : "complete",
    invalidModes: invalid ? ["where_is_money"] : [],
    caveats: [...report.coverage.notes, ...(report.assessment.warnings ?? [])]
  };
}

export function observedContextFromMatrix(matrix: MatrixScoringResult, weightedContextScore: number): number {
  const candidateScores = matrixCandidates(matrix)
    .filter((candidate) =>
      candidate.evidenceClass !== "exact_hard" &&
      candidate.evidenceClass !== "coverage" &&
      candidate.evidenceClass !== "clean"
    )
    .map((candidate) => candidate.score);
  return Math.max(weightedContextScore, ...candidateScores, 0);
}

export function calculateUnifiedWalletRisk(input: UnifiedWalletRiskInput): UnifiedWalletRiskResult {
  const fast = fastLayer(input);
  const deep = deepLayer(input.deepReport);
  const where = whereLayer(input.whereReport);
  const { weightedLayerScore, layerBreakdown } = normalizedWeightedLayers(input, { fast, deep, where });
  const matrixScore = scoreMatrixCandidates(buildWalletMatrixCandidates(input), {
    decisionScope: "wallet_unified",
    subjectAddress: input.address,
    subjectTxHash: null,
    requiredCoverage: "wallet_provenance"
  });
  const classifiedCandidates = matrixCandidates(matrixScore);
  const exactHardCandidates = classifiedCandidates.filter((candidate) =>
    candidate.evidenceClass === "exact_hard" && candidate.proofLevel === "exact"
  );
  const policyCandidates = classifiedCandidates.filter((candidate) => candidate.evidenceClass === "policy");
  const assetContinuationCandidates = classifiedCandidates.filter((candidate) => candidate.row === "asset_continuation");
  const patternCandidates = classifiedCandidates.filter((candidate) =>
    candidate.evidenceClass === "pattern" && candidate.row !== "asset_continuation"
  );
  const coverageCandidates = classifiedCandidates.filter((candidate) => candidate.evidenceClass === "coverage");
  const hardReasons = exactHardCandidates.map((candidate) => matrixCandidateReason(candidate, "hard_evidence"));
  const policyReasons = policyCandidates.map((candidate) => matrixCandidateReason(candidate, "policy_floor"));
  const assetContinuationReasons = assetContinuationCandidates
    .map((candidate) => matrixCandidateReason(candidate, "asset_continuation"));
  const patternReasons = patternCandidates.map((candidate) => matrixCandidateReason(candidate, "pattern_floor"));
  const hardEvidenceFloor = maxScore(exactHardCandidates.map((candidate) => candidate.score));
  const policyFloor = maxScore(policyCandidates.map((candidate) => candidate.score));
  const assetContinuationFloorScore = maxScore(assetContinuationCandidates.map((candidate) => candidate.score));
  const patternFloor = maxScore(patternCandidates.map((candidate) => candidate.score));
  const coverageFloorScore = maxScore(coverageCandidates.map((candidate) => candidate.score));
  const coverageLevelValue = coverageLevel(input);

  const floorScore = maxScore([
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloorScore,
    patternFloor
  ]);
  const dampenerReason = rawDampener(input, {
    strongTransitAnchor: assetContinuationFloorScore > 0 ||
      patternFloor > 0 ||
      (policyFloor > 0 && hasStrongTransitSourcePolicyAnchor(input.whereReport))
  });
  const dampener = allowedDampener({
    raw: dampenerReason.score,
    contextScore: weightedLayerScore,
    floorScore
  });
  const contextScore = clampScore(weightedLayerScore - dampener);
  const coverageAdjustedContextScore = coverageLevelValue === "limited" ? Math.max(contextScore, 30) : contextScore;
  const legacyFinalBeforeHardCap = maxScore([coverageAdjustedContextScore, floorScore]);
  const legacyFinalScore = hardEvidenceFloor === 0 ? Math.min(legacyFinalBeforeHardCap, 84) : legacyFinalBeforeHardCap;
  const decisionCoverage = walletDecisionCoverage(input.whereReport, coverageLevelValue);
  const disposition = resolveFinalDisposition({
    subject: { decisionScope: "wallet_unified", address: input.address, txHash: null },
    matrixScore,
    coverage: decisionCoverage,
    observedContextScore: observedContextFromMatrix(matrixScore, coverageAdjustedContextScore)
  });
  const matrixAnchor = matrixAnchorReason(matrixScore);

  const floorReasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons,
    ...(matrixAnchor ? [matrixAnchor] : [])
  ];
  const noHardEvidenceCriticalCapApplied = hardEvidenceFloor === 0 && legacyFinalBeforeHardCap > legacyFinalScore;

  const reasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons,
    ...(matrixAnchor ? [matrixAnchor] : []),
    ...(dampener > 0 ? [{ ...dampenerReason, score: dampener }] : [])
  ].sort((a, b) => b.score - a.score);

  return {
    finalScore: disposition.finalScore,
    finalLevel: disposition.finalScore === null ? null : levelFromScore(disposition.finalScore),
    finalDecision: disposition.decision,
    observedContextScore: disposition.observedContextScore,
    scoreValid: disposition.scoreValid,
    decisionBasis: disposition.decisionBasis,
    coverage: disposition.coverage,
    weightedLayerScore,
    contextScore: coverageAdjustedContextScore,
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloor: assetContinuationFloorScore,
    patternFloor,
    dampener,
    coverageLevel: coverageLevelValue,
    layerBreakdown,
    reasons,
    matrixScore,
    scoreBreakdown: {
      weightedLayerScore,
      contextScore: coverageAdjustedContextScore,
      dampener,
      floors: {
        hardEvidence: hardEvidenceFloor,
        policy: policyFloor,
        assetContinuation: assetContinuationFloorScore,
        pattern: patternFloor,
        coverage: coverageFloorScore
      },
      activeAnchor: activeAnchorFromReasons(floorReasons),
      noHardEvidenceCriticalCap: {
        applied: noHardEvidenceCriticalCapApplied,
        maxScore: 84
      }
    }
  };
}

function addressFromForensicSubject(subject: UnifiedForensicRiskSubject): string {
  return subject.scope === "wallet" ? subject.address : subject.senderAddress;
}

export function calculateUnifiedForensicRisk(input: UnifiedForensicRiskInput): UnifiedForensicRiskResult {
  return calculateUnifiedWalletRisk({
    address: addressFromForensicSubject(input.subject),
    fastReport: input.fastReport,
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });
}
