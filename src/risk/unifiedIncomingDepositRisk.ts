import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  IncomingFreshBundleExposure,
  IncomingDepositRiskBand,
  IncomingDepositUnifiedRiskSummary,
  IncomingWalletExposureProfile,
  RiskLevel,
  RiskReport,
  StablecoinRestrictionProfile,
  UserExchangeDecision,
  WhereIsMoneyReport
} from "../types";
import {
  calculateUnifiedForensicRisk,
  type UnifiedForensicRiskResult,
  type UnifiedWalletRiskReason
} from "./unifiedWalletRisk";
import { scoreMatrixCandidates, type MatrixScoringResult } from "./scoringSignalMatrix";
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

type IncomingOverlaySignal = {
  score: number;
  code: string;
  message: string;
};

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

function incomingReason(signal: IncomingOverlaySignal): UnifiedWalletRiskReason {
  return {
    code: signal.code,
    message: signal.message,
    score: signal.score,
    source: "incoming_exposure"
  };
}

function strongestIncomingSignal(signals: IncomingOverlaySignal[]): IncomingOverlaySignal | null {
  return signals
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))[0] ?? null;
}

function incomingFreshBundleFloor(
  exposure: IncomingFreshBundleExposure | null | undefined
): IncomingOverlaySignal | null {
  if (!exposure) return null;
  const candidates: IncomingOverlaySignal[] = [];

  if (exposure.htxHuobiShare >= 0.7) {
    candidates.push({
      score: 85,
      code: "incoming_fresh_htx_huobi_source",
      message: "HTX/Huobi materially funds the fresh balance-forming bundle for this incoming deposit."
    });
  }
  if (exposure.htxHuobiShare >= 0.3) {
    candidates.push({
      score: 70,
      code: "incoming_fresh_htx_huobi_source",
      message: "HTX/Huobi funds a material share of the fresh balance-forming bundle for this incoming deposit."
    });
  }
  if (exposure.htxHuobiShare >= 0.1) {
    candidates.push({
      score: 55,
      code: "incoming_fresh_htx_huobi_context",
      message: "HTX/Huobi funds a minority share of the fresh balance-forming bundle for this incoming deposit."
    });
  }
  if (exposure.riskyLabelShare >= 0.1) {
    candidates.push({
      score: 85,
      code: "incoming_fresh_risky_label_source",
      message: "A hard-risk source materially funds the fresh balance-forming bundle for this incoming deposit."
    });
  }
  if (exposure.bridgeRouterDexShare >= 0.5) {
    candidates.push({
      score: 60,
      code: "incoming_fresh_bridge_router_dex_source",
      message: "Bridge/router/dex exposure dominates the fresh balance-forming bundle for this incoming deposit."
    });
  }
  if (exposure.unknownContractShare >= 0.5) {
    candidates.push({
      score: 45,
      code: "incoming_fresh_unknown_contract_source",
      message: "Unknown contract exposure dominates the fresh balance-forming bundle for this incoming deposit."
    });
  }

  return strongestIncomingSignal(candidates);
}

function incomingCorridorFloor(
  exposure: IncomingFreshBundleExposure | null | undefined
): IncomingOverlaySignal | null {
  if (!exposure) return null;
  if (exposure.htxHuobiShare > 0 && exposure.htxHuobiShare < 0.1) {
    return {
      score: 40,
      code: "incoming_htx_huobi_corridor_context",
      message: "HTX/Huobi appears in the fresh corridor, but exact high-share deposit-source attribution was not proven."
    };
  }
  if (exposure.bridgeRouterDexShare > 0 || exposure.unknownContractShare > 0) {
    return {
      score: 35,
      code: "incoming_service_corridor_context",
      message: "Service or unknown-contract corridor exposure is present without hard source proof."
    };
  }
  return null;
}

function incomingBackgroundScore(
  profile: IncomingWalletExposureProfile | null | undefined
): IncomingOverlaySignal | null {
  const score = Math.max(0, Math.min(20, Math.round(profile?.scoreContribution ?? 0)));
  if (score <= 0) return null;
  return {
    score,
    code: "incoming_wallet_exposure_profile",
    message: "Sender wallet historical exposure profile adds background risk and does not prove the checked deposit source."
  };
}

function incomingFreshFloorBypassesNoHardEvidenceCap(freshFloor: IncomingOverlaySignal | null): boolean {
  return freshFloor?.code === "incoming_fresh_risky_label_source" ||
    (
      freshFloor?.code === "incoming_fresh_htx_huobi_source" &&
      freshFloor.score >= 70
    );
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

  const freshFloor = incomingFreshBundleFloor(input.freshBundleExposure);
  const corridorFloor = freshFloor ? null : incomingCorridorFloor(input.freshBundleExposure);
  const backgroundScore = incomingBackgroundScore(input.walletExposureProfile);
  const overlayFloor = Math.max(freshFloor?.score ?? 0, corridorFloor?.score ?? 0);
  const additiveBackgroundScore = backgroundScore?.score ?? 0;
  const uncappedFinalScore = clampScore(Math.max(base.finalScore, overlayFloor) + additiveBackgroundScore);
  const bypassNoHardEvidenceCriticalCap = incomingFreshFloorBypassesNoHardEvidenceCap(freshFloor);
  const noHardEvidenceCriticalCapApplies = base.hardEvidenceFloor === 0 && !bypassNoHardEvidenceCriticalCap;
  const legacyFinalScore = noHardEvidenceCriticalCapApplies
    ? Math.min(uncappedFinalScore, base.scoreBreakdown.noHardEvidenceCriticalCap.maxScore)
    : uncappedFinalScore;
  const finalScore = matrixScore.policyScore ?? 0;
  const noHardEvidenceCriticalCapApplied = legacyFinalScore <= base.scoreBreakdown.noHardEvidenceCriticalCap.maxScore && (
    base.scoreBreakdown.noHardEvidenceCriticalCap.applied ||
    (noHardEvidenceCriticalCapApplies && uncappedFinalScore > legacyFinalScore)
  );
  const incomingFloorReasons = [freshFloor, corridorFloor]
    .filter((signal): signal is IncomingOverlaySignal => signal !== null)
    .map(incomingReason);
  const incomingReasons = [
    ...incomingFloorReasons,
    ...(backgroundScore ? [incomingReason(backgroundScore)] : [])
  ];
  const strongestIncomingFloor = incomingFloorReasons
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))[0] ?? null;
  const baseAnchorScore = Math.max(
    base.scoreBreakdown.activeAnchor?.score ?? 0,
    base.finalScore
  );
  const matrixAnchor = incomingMatrixAnchorReason(matrixScore);
  const baseOrMatrixAnchor = matrixAnchor && matrixAnchor.score >= baseAnchorScore
    ? matrixAnchor
    : base.scoreBreakdown.activeAnchor;
  const activeAnchor = strongestIncomingFloor && strongestIncomingFloor.score >= (baseOrMatrixAnchor?.score ?? 0)
    ? strongestIncomingFloor
    : baseOrMatrixAnchor;
  const finalDecision = base.finalDecision === "NO_FINAL_DECISION"
    ? "NO_FINAL_DECISION"
    : matrixScore.matrixDecision === "DECLINE"
      ? "DECLINE"
      : "ACCEPTABLE";

  return {
    ...base,
    finalScore,
    finalLevel: levelFromScore(finalScore),
    finalDecision,
    contextScore: clampScore(base.contextScore + additiveBackgroundScore),
    policyFloor: Math.max(base.policyFloor, overlayFloor),
    reasons: [
      ...base.reasons,
      ...incomingReasons
    ],
    matrixScore,
    scoreBreakdown: {
      ...base.scoreBreakdown,
      contextScore: clampScore(base.scoreBreakdown.contextScore + additiveBackgroundScore),
      floors: {
        ...base.scoreBreakdown.floors,
        policy: Math.max(base.scoreBreakdown.floors.policy, overlayFloor)
      },
      activeAnchor,
      noHardEvidenceCriticalCap: {
        ...base.scoreBreakdown.noHardEvidenceCriticalCap,
        applied: noHardEvidenceCriticalCapApplied
      }
    }
  };
}

export function incomingUnifiedRiskSummary(
  result: UnifiedForensicRiskResult
): IncomingDepositUnifiedRiskSummary {
  return {
    finalScore: result.finalScore,
    finalLevel: result.finalLevel,
    finalDecision: result.finalDecision,
    matrixDecision: result.matrixScore.matrixDecision,
    winningRow: result.matrixScore.winningRow,
    policyScore: result.matrixScore.policyScore,
    calibratedRiskProbability: result.matrixScore.calibratedRiskProbability,
    hardEvidenceFloor: result.hardEvidenceFloor,
    policyFloor: result.policyFloor,
    assetContinuationFloor: result.assetContinuationFloor,
    patternFloor: result.patternFloor,
    freshBundleFloor: result.reasons.find((reason) =>
      reason.code.startsWith("incoming_fresh_")
    )?.score ?? 0,
    corridorFloor: result.reasons.find((reason) =>
      reason.code.includes("_corridor_")
    )?.score ?? 0,
    backgroundScore: result.reasons.find((reason) =>
      reason.code === "incoming_wallet_exposure_profile"
    )?.score ?? 0,
    dampener: result.dampener,
    activeAnchor: result.scoreBreakdown.activeAnchor
  };
}
