import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../../../src/risk/scoringSignalMatrix";
import type {
  ApprovalDrainProvenanceProfile,
  MoneyOriginPath,
  RiskLayerScore,
  SourceExposureKind,
  SourcePolicyEvidence,
  WhereIsMoneyAssessment,
  WhereIsMoneyReport
} from "../../../src/types";

export const WHERE_SUBJECT = `T${"1".repeat(33)}`;
export const WHERE_SOURCE = `T${"2".repeat(33)}`;
export const WHERE_SPENDER = `T${"3".repeat(33)}`;
export const WHERE_RECEIVER = `T${"4".repeat(33)}`;
export const WHERE_ROUTE_LINK = `T${"5".repeat(33)}`;
export const POISON_RAW_REASON = "POISON raw reason transferFrom hard-proof DeepCheck must never appear";

function riskBand(score: number): WhereIsMoneyAssessment["riskBand"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

export function whereAssessmentFixture(
  overrides: Partial<WhereIsMoneyAssessment> = {}
): WhereIsMoneyAssessment {
  const riskScore = overrides.riskScore ?? 0;
  return {
    scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    decision: riskScore >= 60 ? "DECLINE" : riskScore >= 30 ? "REVIEW" : "ACCEPTABLE",
    riskScore,
    riskBand: riskBand(riskScore),
    provenanceConfidence: 100,
    coverageCompleteness: 100,
    walletRole: riskScore > 0 ? "risky_source_wallet" : "unknown_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: [POISON_RAW_REASON],
    warnings: [POISON_RAW_REASON],
    ...overrides
  };
}

export function whereReportFixture(
  overrides: Partial<WhereIsMoneyReport> = {}
): WhereIsMoneyReport {
  const riskScore = overrides.riskScore ?? overrides.assessment?.riskScore ?? 0;
  const assessment = overrides.assessment ?? whereAssessmentFixture({ riskScore });
  return {
    scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    subjectAddress: WHERE_SUBJECT,
    currentUsdtBalanceRaw: "100000000000",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    decision: assessment.decision,
    userDecision: assessment.decision,
    internalDecision: assessment.decision,
    proofLevel: assessment.decision === "ACCEPTABLE" ? "clean_source_proven" : "exchange_policy_context",
    riskScore,
    decisionReasons: [POISON_RAW_REASON],
    coverage: {
      selectedInboundTxCount: 1,
      selectedInboundVolumeRaw: "100000000000",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      selectedAmountRaw: "100000000000",
      maxDepth: 7,
      fetchedAddressCount: 2,
      partial: false,
      notes: [POISON_RAW_REASON]
    },
    ...overrides,
    assessment
  };
}

function sourcePolicy(
  kind: SourceExposureKind,
  score: number,
  share: number,
  evidenceIds: string[]
): SourcePolicyEvidence {
  return {
    kind,
    aggregateShare: share,
    effectiveShare: share,
    pathCount: 1,
    score,
    riskBand: riskBand(score),
    proofLevel: kind === "sanctioned_service" ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: kind !== "sanctioned_service",
    reasons: [POISON_RAW_REASON],
    warnings: [POISON_RAW_REASON],
    evidenceIds,
    shareDetail: {
      scope: "where_selected_amount",
      targetAmountRaw: "100000000000",
      affectedAmountRaw: String(Math.round(100_000_000_000 * share)),
      rawShare: share,
      effectiveShare: share,
      sourceSeverity: score,
      valueWeightedRaw: score,
      pathContextAdjustment: 0,
      repeatedExposureAdjustment: 0,
      dataQualityAdjustment: 0,
      walletRoleAdjustment: 0,
      shareFloor: 0,
      shareCap: 1,
      finalContribution: score
    }
  };
}

function riskLayer(
  kind: string,
  score: number,
  evidenceClass: RiskLayerScore["evidenceClass"],
  evidenceIds: string[],
  sourceExposureKind?: SourceExposureKind
): RiskLayerScore {
  return {
    evidenceClass,
    kind,
    ...(sourceExposureKind ? { sourceExposureKind } : {}),
    score,
    rawScore: score,
    adjustedScore: score,
    proofLevel: evidenceClass === "hard_proof" ? "exact_scam_or_taint_proof" : "exchange_policy_context",
    canBeDampened: evidenceClass !== "hard_proof",
    reasons: [POISON_RAW_REASON],
    warnings: [POISON_RAW_REASON],
    evidenceIds
  };
}

export function sourceWhereReportFixture(input: {
  kind: SourceExposureKind;
  score?: number;
  share?: number;
  transferCount?: number;
  label?: string;
  timestamp?: string;
}): WhereIsMoneyReport {
  const score = input.score ?? 70;
  const share = input.share ?? 0.5;
  const transferCount = input.transferCount ?? 1;
  if (!Number.isInteger(transferCount) || transferCount < 1) {
    throw new RangeError("transferCount must be a positive integer");
  }
  const evidenceIds = ["policy-evidence", ...Array.from({ length: transferCount }, (_, i) => `tx-${i + 1}`)];
  const policy = sourcePolicy(input.kind, score, share, evidenceIds);
  policy.pathCount = transferCount;
  const pathShare = share / transferCount;
  const affectedAmountRaw = BigInt(Math.round(100_000_000_000 * share));
  const amountPerPath = affectedAmountRaw / BigInt(transferCount);
  const amountRemainder = Number(affectedAmountRaw % BigInt(transferCount));
  const paths: MoneyOriginPath[] = Array.from({ length: transferCount }, (_, i) => ({
    balanceTransferTxHash: `tx-${i + 1}`,
    rootSourceAddress: WHERE_SOURCE,
    rootSourceType: input.kind === "allowlisted_cex" ? "allowlist_cex" : "decline_boundary",
    balanceShare: pathShare,
    exposureSourceKey: input.kind === "htx_huobi" ? "htx_huobi" : input.kind,
    exposureSourceLabel: input.label ?? null,
    sourceExposureKind: input.kind,
    effectiveExposureShare: pathShare,
    linkStrength: 1,
    pathAddresses: [WHERE_SOURCE, WHERE_SUBJECT],
    txHashes: [`tx-${i + 1}`],
    steps: [{
      txHash: `tx-${i + 1}`,
      fromAddress: WHERE_SOURCE,
      toAddress: WHERE_SUBJECT,
      amountRaw: String(amountPerPath + (i < amountRemainder ? 1n : 0n)),
      timestamp: input.timestamp ?? "2026-06-01T00:00:00.000Z"
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 60_000,
    stoppedReason: input.kind === "allowlisted_cex" ? "allowlist_cex_reached" : "service_boundary",
    verdict: score >= 60 ? "DECLINE" : score >= 30 ? "REVIEW" : "ACCEPTABLE",
    riskScoreContribution: score,
    reasons: [POISON_RAW_REASON]
  }));
  const dominant = riskLayer(input.kind, score, "source_policy", evidenceIds, input.kind);
  const assessment = whereAssessmentFixture({
    riskScore: score,
    sourcePolicyEvidence: [policy],
    riskLayers: [dominant],
    dominantRiskLayer: dominant
  });
  const report = whereReportFixture({ riskScore: score, originPaths: paths, assessment });
  report.coverage.selectedInboundTxCount = transferCount;
  return report;
}

export function bridgeWhereReportFixture(input: {
  score?: number;
  share?: number;
  transferCount?: number;
  scoreValid?: boolean;
} = {}): WhereIsMoneyReport {
  const report = sourceWhereReportFixture({
    kind: "cross_chain_boundary",
    score: input.score ?? 78,
    share: input.share ?? 0.83,
    transferCount: input.transferCount ?? 10,
    label: "UsdtOFT"
  });
  const scoreValid = input.scoreValid ?? true;
  report.scoreValid = scoreValid;
  report.assessment.scoreValid = scoreValid;
  return report;
}

export function htxWhereReportFixture(classification: "historical" | "sanctioned"): WhereIsMoneyReport {
  return sourceWhereReportFixture({
    kind: classification === "historical" ? "htx_huobi" : "sanctioned_service",
    score: classification === "historical" ? 55 : 90,
    share: 0.64,
    label: "HTX/Huobi",
    timestamp: classification === "historical" ? "2025-01-10T00:00:00.000Z" : "2026-06-01T00:00:00.000Z"
  });
}

function approvalProfile(role: "victim" | "first_receiver" | "route_linked"): ApprovalDrainProvenanceProfile {
  const subjectAddress = role === "victim" ? WHERE_SUBJECT : role === "first_receiver" ? WHERE_SUBJECT : WHERE_ROUTE_LINK;
  return {
    victimAddress: role === "victim" ? WHERE_SUBJECT : WHERE_SOURCE,
    approvalTxHash: "approval-tx",
    drainTxHash: "drain-tx",
    spenderAddress: WHERE_SPENDER,
    firstReceiverAddress: role === "first_receiver" ? WHERE_SUBJECT : WHERE_RECEIVER,
    subjectAddress,
    hopDepth: role === "route_linked" ? 2 : 0,
    amountRaw: "25000000000",
    amountPreservationRatio: role === "route_linked" ? 0.82 : 1,
    approvalAt: "2026-06-01T00:00:00.000Z",
    drainAt: "2026-06-01T00:01:00.000Z",
    pathTxHashes: ["drain-tx", "route-tx"],
    pathAddresses: [WHERE_SOURCE, WHERE_RECEIVER, subjectAddress],
    score: 95,
    evidenceStrength: role === "route_linked" ? "route_linked" : "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: []
  };
}

export function approvalWhereReportFixture(
  role: "victim" | "first_receiver" | "route_linked"
): WhereIsMoneyReport {
  const profile = approvalProfile(role);
  const evidenceIds = [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes];
  const dominant = riskLayer("approval_drain", 95, "hard_proof", evidenceIds);
  return whereReportFixture({
    subjectAddress: profile.subjectAddress,
    riskScore: 95,
    approvalDrainProvenanceProfiles: [profile],
    assessment: whereAssessmentFixture({
      riskScore: 95,
      hardBadEvidence: [{ kind: "approval_drain", score: 95, message: POISON_RAW_REASON, evidenceIds }],
      riskLayers: [dominant],
      dominantRiskLayer: dominant
    })
  });
}

export { riskLayer as whereRiskLayerFixture };
