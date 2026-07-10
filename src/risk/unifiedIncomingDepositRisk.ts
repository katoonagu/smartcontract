import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  DecisionCoverage,
  IncomingFreshBundleExposure,
  IncomingDepositRiskBand,
  IncomingDepositUnifiedRiskSummary,
  IncomingWalletExposureProfile,
  RiskLevel,
  RiskReport,
  StablecoinRestrictionProfile,
  WhereIsMoneyReport
} from "../types";
import {
  calculateUnifiedForensicRisk,
  observedContextFromMatrix,
  type UnifiedForensicRiskResult,
  type UnifiedWalletRiskReason
} from "./unifiedWalletRisk";
import { resolveFinalDisposition } from "./finalDisposition";
import {
  scoreMatrixCandidates,
  type ClassifiedMatrixCandidate,
  type MatrixScoringResult
} from "./scoringSignalMatrix";
import { buildIncomingDepositMatrixCandidates } from "./scoringSignalMatrixInputs";

export type CalculateUnifiedIncomingDepositRiskInput = {
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  amountRaw: string;
  timestamp: Date;
  fastSenderRisk: RiskReport | null;
  senderStablecoinState: StablecoinRestrictionProfile | null;
  whereReport: WhereIsMoneyReport;
  deepReport?: DeepAddressForensicReport | null;
  freshBundleExposure?: IncomingFreshBundleExposure | null;
  walletExposureProfile?: IncomingWalletExposureProfile | null;
  decisionCoverage?: DecisionCoverage;
};

export function incomingRiskBandFromUnifiedScore(score: number): IncomingDepositRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function fastRiskWithSenderBlacklist(
  fastSenderRisk: RiskReport | null,
  senderAddress: string,
  senderStablecoinState: StablecoinRestrictionProfile | null
): RiskReport | null {
  if (!senderStablecoinState?.isBlacklisted) return fastSenderRisk;

  const base: RiskReport = fastSenderRisk ?? {
    subjectAddress: senderAddress,
    level: "LOW",
    score: 0,
    reasons: []
  };

  return {
    ...base,
    level: "CRITICAL",
    score: Math.max(base.score, 95),
    reasons: [
      ...base.reasons,
      {
        code: "stablecoin_usdt_blacklisted",
        message: "Official TRON USDT contract blacklist state is active for the incoming deposit sender.",
        scoreImpact: 95,
        source: "stablecoin_contract",
        confidence: "high",
        severity: "critical"
      }
    ]
  };
}

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

function incomingMatrixAnchorReason(matrixScore: MatrixScoringResult): UnifiedWalletRiskReason | null {
  if (matrixScore.policyScore === null) return null;
  const winner = matrixScore.winningCandidate;
  const source: UnifiedWalletRiskReason["source"] = winner.evidenceClass === "exact_hard"
    ? "hard_evidence"
    : winner.evidenceClass === "policy"
      ? "policy_floor"
      : winner.row === "asset_continuation"
        ? "asset_continuation"
        : winner.evidenceClass === "pattern"
          ? "pattern_floor"
          : winner.evidenceClass === "coverage"
            ? "coverage"
            : "deep_research";
  return {
    code: `matrix:${winner.row}`,
    message: `Scoring Signal Matrix winning row is ${winner.row}.`,
    score: matrixScore.policyScore,
    source
  };
}

function classifiedIncomingCandidates(matrix: MatrixScoringResult): ClassifiedMatrixCandidate[] {
  return Object.values(matrix.riskVector).flatMap((candidates) => candidates ?? []);
}

function incomingCoverageFromWhere(report: WhereIsMoneyReport): DecisionCoverage {
  const invalid = report.scoreValid !== true;
  return {
    required: invalid ? "invalid" : "valid",
    overall: invalid || report.coverage.partial ? "partial" : "complete",
    invalidModes: invalid ? ["incoming_deposit_provenance"] : [],
    caveats: [...report.coverage.notes, ...(report.assessment.warnings ?? [])]
  };
}

function incomingCandidateReason(candidate: ClassifiedMatrixCandidate): UnifiedWalletRiskReason {
  const code = candidate.atomicSignals[0] ?? `${candidate.row}:${candidate.evidenceIds[0] ?? "unknown"}`;
  const source: UnifiedWalletRiskReason["source"] = candidate.evidenceClass === "exact_hard"
    ? "hard_evidence"
    : code.startsWith("incoming_")
      ? "incoming_exposure"
      : candidate.evidenceClass === "policy"
        ? "policy_floor"
        : candidate.row === "asset_continuation"
          ? "asset_continuation"
          : candidate.evidenceClass === "pattern"
            ? "pattern_floor"
            : candidate.evidenceClass === "coverage"
              ? "coverage"
              : "deep_research";
  return {
    code,
    message: candidate.evidenceClass === "exact_hard"
      ? "Applicable exact hard evidence from the canonical scoring matrix."
      : `Applicable ${candidate.row} evidence from the canonical scoring matrix.`,
    score: candidate.score,
    source
  };
}

function activeIncomingAnchor(reasons: UnifiedWalletRiskReason[]): UnifiedWalletRiskReason | null {
  return [...reasons]
    .filter((reason) => reason.score > 0)
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))[0] ?? null;
}

export function calculateUnifiedIncomingDepositRisk(
  input: CalculateUnifiedIncomingDepositRiskInput
): UnifiedForensicRiskResult {
  const fastSenderRisk = fastRiskWithSenderBlacklist(
    input.fastSenderRisk,
    input.senderAddress,
    input.senderStablecoinState
  );
  const base = calculateUnifiedForensicRisk({
    subject: {
      scope: "incoming_deposit",
      senderAddress: input.senderAddress,
      receiverAddress: input.receiverAddress,
      txHash: input.txHash,
      amountRaw: input.amountRaw,
      timestamp: input.timestamp
    },
    fastReport: fastSenderRisk,
    deepReport: input.deepReport,
    whereReport: input.whereReport
  });
  const matrixScore = scoreMatrixCandidates(buildIncomingDepositMatrixCandidates({
    senderAddress: input.senderAddress,
    receiverAddress: input.receiverAddress,
    txHash: input.txHash,
    fastReport: fastSenderRisk,
    deepReport: input.deepReport,
    whereReport: input.whereReport,
    freshBundleExposure: input.freshBundleExposure,
    walletExposureProfile: input.walletExposureProfile
  }), {
    decisionScope: "incoming_unified",
    subjectAddress: input.senderAddress,
    subjectTxHash: input.txHash,
    requiredCoverage: "deposit_provenance"
  });
  const classifiedCandidates = classifiedIncomingCandidates(matrixScore);
  const exactHardCandidates = classifiedCandidates.filter((candidate) =>
    candidate.evidenceClass === "exact_hard" && candidate.proofLevel === "exact"
  );
  const policyCandidates = classifiedCandidates.filter((candidate) => candidate.evidenceClass === "policy");
  const assetCandidates = classifiedCandidates.filter((candidate) => candidate.row === "asset_continuation");
  const patternCandidates = classifiedCandidates.filter((candidate) =>
    candidate.evidenceClass === "pattern" && candidate.row !== "asset_continuation"
  );
  const coverageCandidates = classifiedCandidates.filter((candidate) => candidate.evidenceClass === "coverage");
  const diagnosticCandidates = classifiedCandidates.filter((candidate) =>
    candidate.evidenceClass !== "coverage" && candidate.evidenceClass !== "clean"
  );
  const incomingReasons = diagnosticCandidates.map(incomingCandidateReason);
  const hardEvidenceFloor = Math.max(0, ...exactHardCandidates.map((candidate) => candidate.score));
  const policyFloor = Math.max(0, ...policyCandidates.map((candidate) => candidate.score));
  const assetContinuationFloor = Math.max(0, ...assetCandidates.map((candidate) => candidate.score));
  const patternFloor = Math.max(0, ...patternCandidates.map((candidate) => candidate.score));
  const coverageFloor = Math.max(0, ...coverageCandidates.map((candidate) => candidate.score));
  const backgroundScore = Math.max(0, ...classifiedCandidates
    .filter((candidate) => candidate.atomicSignals.includes("incoming_wallet_exposure_profile"))
    .map((candidate) => candidate.score));
  const overlayFloor = Math.max(0, ...classifiedCandidates
    .filter((candidate) => candidate.atomicSignals.some((signal) =>
      signal.startsWith("incoming_fresh_") || signal.includes("_corridor_")
    ))
    .map((candidate) => candidate.score));
  const baseDiagnosticScore = base.finalScore ?? base.observedContextScore;
  const uncappedDiagnosticScore = clampScore(Math.max(baseDiagnosticScore, overlayFloor) + backgroundScore);
  const bypassNoHardEvidenceCriticalCap = classifiedCandidates.some((candidate) =>
    candidate.atomicSignals.includes("incoming_fresh_risky_label_source") ||
    (candidate.atomicSignals.includes("incoming_fresh_htx_huobi_source") && candidate.score >= 70)
  );
  const noHardEvidenceCriticalCapApplies = hardEvidenceFloor === 0 && !bypassNoHardEvidenceCriticalCap;
  const cappedDiagnosticScore = noHardEvidenceCriticalCapApplies
    ? Math.min(uncappedDiagnosticScore, 84)
    : uncappedDiagnosticScore;
  const observedContextScore = observedContextFromMatrix(matrixScore, cappedDiagnosticScore);
  const disposition = resolveFinalDisposition({
    subject: {
      decisionScope: "incoming_unified",
      address: input.senderAddress,
      txHash: input.txHash
    },
    matrixScore,
    coverage: input.decisionCoverage ?? incomingCoverageFromWhere(input.whereReport),
    observedContextScore
  });
  const matrixAnchor = incomingMatrixAnchorReason(matrixScore);
  const dampenerReason: UnifiedWalletRiskReason | null = base.dampener > 0
    ? {
        code: "unified_dampener",
        message: "Trusted, clean-role, or behavior dampener applied to non-hard evidence.",
        score: base.dampener,
        source: "dampener"
      }
    : null;
  const reasons = [
    ...incomingReasons,
    ...(matrixAnchor ? [matrixAnchor] : []),
    ...(dampenerReason ? [dampenerReason] : [])
  ].sort((left, right) => right.score - left.score || left.code.localeCompare(right.code));
  const activeAnchor = activeIncomingAnchor([
    ...incomingReasons,
    ...(matrixAnchor ? [matrixAnchor] : [])
  ]);

  return {
    finalScore: disposition.finalScore,
    finalLevel: disposition.finalScore === null ? null : levelFromScore(disposition.finalScore),
    finalDecision: disposition.decision,
    observedContextScore: disposition.observedContextScore,
    scoreValid: disposition.scoreValid,
    decisionBasis: disposition.decisionBasis,
    coverage: disposition.coverage,
    weightedLayerScore: base.weightedLayerScore,
    contextScore: observedContextScore,
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloor,
    patternFloor,
    dampener: base.dampener,
    coverageLevel: base.coverageLevel,
    layerBreakdown: base.layerBreakdown,
    reasons,
    matrixScore,
    scoreBreakdown: {
      weightedLayerScore: base.weightedLayerScore,
      contextScore: observedContextScore,
      dampener: base.dampener,
      floors: {
        hardEvidence: hardEvidenceFloor,
        policy: policyFloor,
        assetContinuation: assetContinuationFloor,
        pattern: patternFloor,
        coverage: coverageFloor
      },
      activeAnchor,
      noHardEvidenceCriticalCap: {
        applied: noHardEvidenceCriticalCapApplies && uncappedDiagnosticScore > cappedDiagnosticScore,
        maxScore: 84
      }
    }
  };
}

export function incomingUnifiedRiskSummary(
  result: UnifiedForensicRiskResult
): IncomingDepositUnifiedRiskSummary {
  const candidates = classifiedIncomingCandidates(result.matrixScore);
  const scoreForSignal = (predicate: (signal: string) => boolean): number => Math.max(0, ...candidates
    .filter((candidate) => candidate.atomicSignals.some(predicate))
    .map((candidate) => candidate.score));
  return {
    finalScore: result.finalScore,
    finalLevel: result.finalLevel,
    finalDecision: result.finalDecision,
    observedContextScore: result.observedContextScore,
    scoreValid: result.scoreValid,
    decisionBasis: result.decisionBasis,
    coverage: result.coverage,
    matrixDecision: result.matrixScore.matrixDecision,
    winningRow: result.matrixScore.winningRow,
    policyScore: result.matrixScore.policyScore,
    calibratedRiskProbability: result.matrixScore.calibratedRiskProbability,
    hardEvidenceFloor: result.hardEvidenceFloor,
    policyFloor: result.policyFloor,
    assetContinuationFloor: result.assetContinuationFloor,
    patternFloor: result.patternFloor,
    freshBundleFloor: scoreForSignal((signal) => signal.startsWith("incoming_fresh_")),
    corridorFloor: scoreForSignal((signal) => signal.includes("_corridor_")),
    backgroundScore: scoreForSignal((signal) => signal === "incoming_wallet_exposure_profile"),
    dampener: result.dampener,
    activeAnchor: result.scoreBreakdown.activeAnchor
  };
}
