import type {
  ApprovalDrainProvenanceProfile,
  ApprovalDrainReviewFinding,
  ContractLlmVerdictSummary,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  RiskReport,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyAssessment,
  WhereIsMoneyCoverage,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyRiskBand,
  WhereIsMoneyWalletRole
} from "../types";

export type BuildMoneyOriginOperationalAssessmentInput = {
  fastWalletRisk: RiskReport | null;
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
  contractLlmVerdicts: ContractLlmVerdictSummary[];
  coverage: WhereIsMoneyCoverage;
  ageSignals?: WhereIsMoneyAgeSignals | null;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 10_000;
}

export function riskBandFromWhereScore(score: number): WhereIsMoneyRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function pathShare(path: MoneyOriginPath): number {
  const share = path.balanceShare ?? 0;
  return Number.isFinite(share) && share > 0 ? Math.min(1, share) : 0;
}

function highestPathRisk(paths: MoneyOriginPath[]): number {
  return Math.max(0, ...paths.map((path) => path.riskScoreContribution));
}

function hardEvidenceFromFastRisk(report: RiskReport | null): WhereIsMoneyHardBadEvidence[] {
  if (!report || report.score < 85) return [];
  return [{
    kind: "fast_critical",
    score: report.score,
    message: `Fast wallet check has critical score ${report.score}/100.`,
    evidenceIds: report.reasons.map((reason) => reason.evidenceRef ?? reason.code)
  }];
}

function hardEvidenceFromApprovalDrain(profiles: ApprovalDrainProvenanceProfile[]): WhereIsMoneyHardBadEvidence[] {
  return profiles.map((profile) => ({
    kind: "approval_drain",
    score: Math.max(profile.score, 90),
    message: `Exact approval-drain provenance reaches checked wallet via ${profile.hopDepth} hop(s).`,
    evidenceIds: [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes]
  }));
}

function hardEvidenceFromPaths(paths: MoneyOriginPath[]): WhereIsMoneyHardBadEvidence[] {
  const evidence: WhereIsMoneyHardBadEvidence[] = [];

  for (const path of paths) {
    const reasonText = path.reasons.join(" ").toLowerCase();
    if (path.rootSourceType === "risky_label") {
      evidence.push({
        kind: "scam_or_blacklist",
        score: Math.max(path.riskScoreContribution, 90),
        message: path.reasons[0] ?? "Balance-forming path reaches scam or blacklist risk label.",
        evidenceIds: path.txHashes
      });
      continue;
    }

    if (path.exposureSourceKey === "whitebit") continue;

    const exposureText = [
      path.exposureSourceKey ?? "",
      path.exposureSourceLabel ?? ""
    ].join(" ").toLowerCase();
    if (
      path.rootSourceType === "decline_boundary" &&
      (exposureText.includes("htx") ||
        exposureText.includes("huobi") ||
        reasonText.includes("htx") ||
        reasonText.includes("huobi"))
    ) {
      evidence.push({
        kind: "htx_huobi_source",
        score: Math.max(path.riskScoreContribution, 78),
        message: path.reasons[0] ?? "Balance-forming path reaches HTX/Huobi high-risk source.",
        evidenceIds: path.txHashes
      });
      continue;
    }

    if (path.rootSourceType !== "decline_boundary") continue;

    if (/\b(bridge|router|dex|swap)\b/.test(reasonText)) {
      evidence.push({
        kind: "bridge_router_dex_boundary",
        score: Math.max(path.riskScoreContribution, 65),
        message: path.reasons[0] ?? "Balance-forming path reaches bridge/router/DEX boundary.",
        evidenceIds: path.txHashes
      });
    }
  }

  return evidence;
}

function approvalDrainReviewWarnings(findings: ApprovalDrainReviewFinding[]): string[] {
  return findings.slice(0, 3).map((finding) =>
    `Approval-drain review finding ${finding.reason} for drain tx ${finding.drainTxHash}; exact drain provenance was not proven.`
  );
}

function hardEvidenceFromLlm(verdicts: ContractLlmVerdictSummary[]): WhereIsMoneyHardBadEvidence[] {
  return verdicts
    .filter((verdict) =>
      verdict.verdict === "drainer_like" &&
      verdict.decisionRecommendation === "DECLINE" &&
      (verdict.confidence >= 0.75 || verdict.contractRiskScore >= 90)
    )
    .map((verdict) => ({
      kind: "llm_contract_suspicion",
      score: Math.max(verdict.contractRiskScore, 75),
      message: `LLM contract verdict is drainer_like with score ${verdict.contractRiskScore}/100 and ${Math.round(verdict.confidence * 100)}% confidence.`,
      evidenceIds: verdict.citedEvidenceIds
    }));
}

function topUnknownSuspiciousLlmVerdict(verdicts: ContractLlmVerdictSummary[]): ContractLlmVerdictSummary | null {
  return verdicts
    .filter((verdict) =>
      verdict.verdict === "unknown_suspicious" &&
      verdict.decisionRecommendation === "DECLINE" &&
      verdict.confidence >= 0.7 &&
      verdict.contractRiskScore >= 65
    )
    .sort((left, right) => right.contractRiskScore - left.contractRiskScore)[0] ?? null;
}

function llmSafeDefaultReason(verdicts: ContractLlmVerdictSummary[]): string | null {
  const unavailable = verdicts.find((verdict) => verdict.source === "unavailable");
  if (unavailable) {
    return `Clean source could not be proven; exchange policy declines this wallet by safe default. LLM unavailable: ${unavailable.error ?? "contract analysis unavailable"}.`;
  }

  const insufficient = verdicts.find((verdict) =>
    verdict.verdict === "unknown_insufficient_data" &&
    verdict.decisionRecommendation === "DECLINE"
  );
  if (insufficient) {
    return "Clean source could not be proven; exchange policy declines this wallet by safe default. Contract verdict returned insufficient data.";
  }

  return null;
}

function llmVerdictWarnings(verdicts: ContractLlmVerdictSummary[]): string[] {
  return verdicts
    .filter((verdict) => verdict.source === "unavailable" || verdict.verdict === "unknown_insufficient_data")
    .slice(0, 3)
    .map((verdict) => verdict.error
      ? `LLM contract verdict unavailable for ${verdict.contractAddress ?? "unknown contract"}: ${verdict.error}.`
      : `LLM contract verdict had insufficient data for ${verdict.contractAddress ?? "unknown contract"}.`
    );
}

function hasRiskyMoneyPath(input: BuildMoneyOriginOperationalAssessmentInput): boolean {
  return input.approvalDrainReviewFindings.length > 0 || input.originPaths.some((path) => path.verdict !== "ACCEPTABLE");
}

function operationalLiquidityScore(profiles: MoneyOriginSenderInteractionProfile[]): number {
  if (profiles.length === 0) return 0;

  const total = profiles.reduce((sum, profile) => {
    const incoming = parseAmount(profile.incomingVolumeRaw);
    const outgoing = parseAmount(profile.outgoingVolumeRaw);
    const largerVolume = incoming > outgoing ? incoming : outgoing;
    const smallerVolume = incoming < outgoing ? incoming : outgoing;
    const hasTwoSidedFlow = incoming > 0n && outgoing > 0n;
    const flowBalance = hasTwoSidedFlow ? ratio(smallerVolume, largerVolume) : 0;
    const activityScore = Math.min(35, (profile.incomingTxCount + profile.outgoingTxCount) * 5);
    const flowScore = Math.min(35, flowBalance * 35);
    const counterpartyScore = Math.min(20, (profile.topIncomingCounterparties.length + profile.topOutgoingCounterparties.length) * 3);
    const fundingScore = profile.fundingCandidates.length > 0 ? 10 : 0;
    return sum + activityScore + flowScore + counterpartyScore + fundingScore;
  }, 0);

  return clampScore(total / profiles.length);
}

function coverageCompleteness(input: BuildMoneyOriginOperationalAssessmentInput): number {
  const balanceCoverage = input.coverage.coverageRatio ?? input.coverage.currentBalanceCoverageRatio;
  const resolvedShare = input.originPaths.reduce((sum, path) =>
    path.verdict === "ACCEPTABLE" || path.verdict === "DECLINE" ? sum + pathShare(path) : sum
  , 0);
  const fetchedBreadth = input.coverage.maxDepth > 0
    ? Math.min(1, input.coverage.fetchedAddressCount / Math.max(1, input.coverage.maxDepth * 3))
    : 0;
  const partialPenalty = input.coverage.partial ? 10 : 0;
  return clampScore(balanceCoverage * 45 + Math.min(1, resolvedShare) * 35 + fetchedBreadth * 20 - partialPenalty);
}

function provenanceConfidence(input: BuildMoneyOriginOperationalAssessmentInput, operationalScore: number): number {
  const cleanShare = input.originPaths.reduce((sum, path) => path.verdict === "ACCEPTABLE" ? sum + pathShare(path) : sum, 0);
  const weakShare = input.originPaths.reduce((sum, path) => path.verdict === "REVIEW" ? sum + pathShare(path) : sum, 0);
  const fundingQuality = input.senderInteractionProfiles.length === 0
    ? 0
    : input.senderInteractionProfiles.reduce((sum, profile) => {
      const bestCandidate = profile.fundingCandidates.reduce(
        (best, candidate) => Math.max(best, candidate.amountPreservationRatio),
        0
      );
      return sum + bestCandidate;
    }, 0) / input.senderInteractionProfiles.length;

  return clampScore(20 + cleanShare * 55 + fundingQuality * 20 + operationalScore * 0.25 - weakShare * 10);
}

function walletRole(input: {
  hardBadEvidence: WhereIsMoneyHardBadEvidence[];
  originPaths: MoneyOriginPath[];
  operationalScore: number;
}): WhereIsMoneyWalletRole {
  if (input.hardBadEvidence.length > 0) return "risky_source_wallet";
  if (input.originPaths.length > 0 && input.originPaths.every((path) =>
    path.verdict === "ACCEPTABLE" &&
    path.rootSourceType === "allowlist_cex" &&
    path.stoppedReason === "allowlist_cex_reached"
  )) {
    return "clean_cex_funded_wallet";
  }
  if (input.operationalScore >= 65) return "operational_liquidity_wallet";
  if (input.originPaths.some((path) => path.verdict === "DECLINE")) return "risky_source_wallet";
  return "unknown_wallet";
}

function ageRiskAdjustment(ageSignals: WhereIsMoneyAgeSignals | null | undefined): number {
  if (!ageSignals) return 0;
  const rawImpact = ageSignals.signals.reduce((sum, signal) => sum + signal.scoreImpact, 0);
  return Math.max(-15, Math.min(15, rawImpact));
}

function operationalRiskScore(input: {
  provenanceConfidence: number;
  coverageCompleteness: number;
  highestPathRisk: number;
  ageAdjustment: number;
}): number {
  const confidencePenalty = Math.max(0, 60 - input.provenanceConfidence) * 0.15;
  const coveragePenalty = Math.max(0, 70 - input.coverageCompleteness) * 0.1;
  const pathContext = Math.min(10, Math.max(0, input.highestPathRisk - 30) * 0.2);
  return clampScore(25 + confidencePenalty + coveragePenalty + pathContext + input.ageAdjustment);
}

function firstPathReason(paths: MoneyOriginPath[], fallback: string): string {
  return paths.flatMap((path) => path.reasons)[0] ?? fallback;
}

export function buildMoneyOriginOperationalAssessment(input: BuildMoneyOriginOperationalAssessmentInput): WhereIsMoneyAssessment {
  const hardBadEvidence = [
    ...hardEvidenceFromFastRisk(input.fastWalletRisk),
    ...hardEvidenceFromApprovalDrain(input.approvalDrainProvenanceProfiles),
    ...hardEvidenceFromPaths(input.originPaths),
    ...hardEvidenceFromLlm(input.contractLlmVerdicts)
  ].sort((left, right) => right.score - left.score);

  const operationalScore = operationalLiquidityScore(input.senderInteractionProfiles);
  const coverageScore = coverageCompleteness(input);
  const provenanceScore = provenanceConfidence(input, operationalScore);
  const role = walletRole({ hardBadEvidence, originPaths: input.originPaths, operationalScore });
  const topHardEvidence = hardBadEvidence[0] ?? null;
  const approvalWarnings = approvalDrainReviewWarnings(input.approvalDrainReviewFindings);
  const llmWarnings = llmVerdictWarnings(input.contractLlmVerdicts);
  const riskyMoneyPath = hasRiskyMoneyPath(input);
  const safeDefaultReason = riskyMoneyPath ? llmSafeDefaultReason(input.contractLlmVerdicts) : null;

  if (topHardEvidence) {
    const riskScore = clampScore(Math.max(topHardEvidence.score, highestPathRisk(input.originPaths)));
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence,
      reasons: [topHardEvidence.message],
      warnings: [
        ...(input.coverage.partial ? ["Coverage is partial; hard bad evidence takes priority."] : []),
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  const unknownSuspiciousVerdict = topUnknownSuspiciousLlmVerdict(input.contractLlmVerdicts);
  if (unknownSuspiciousVerdict && riskyMoneyPath) {
    const evidence: WhereIsMoneyHardBadEvidence = {
      kind: "llm_contract_suspicion",
      score: Math.max(unknownSuspiciousVerdict.contractRiskScore, 78),
      message: `LLM contract verdict is unknown_suspicious with ${Math.round(unknownSuspiciousVerdict.confidence * 100)}% confidence.`,
      evidenceIds: unknownSuspiciousVerdict.citedEvidenceIds
    };
    const riskScore = clampScore(evidence.score);
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [evidence],
      reasons: [evidence.message],
      warnings: [
        "LLM suspicion is used only because the money path is not cleanly proven.",
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  const whitebitPaths = input.originPaths.filter((path) => path.exposureSourceKey === "whitebit");
  const whitebitScore = Math.max(
    0,
    ...whitebitPaths.map((path) => Math.max(45, path.riskScoreContribution))
  );
  if (whitebitScore > 0) {
    return {
      decision: "DECLINE",
      riskScore: whitebitScore,
      riskBand: riskBandFromWhereScore(whitebitScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: [firstPathReason(whitebitPaths, "Balance-forming path has WhiteBIT policy exposure.")],
      warnings: [
        "WhiteBIT exposure is medium source-policy risk, not hard scam/blacklist proof.",
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (role === "clean_cex_funded_wallet") {
    const riskScore = clampScore(Math.max(5, input.fastWalletRisk?.score ?? 0));
    return {
      decision: "ACCEPTABLE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: Math.max(provenanceScore, 80),
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: ["Balance-forming paths reach allowlisted CEX sources through clean on-chain hops."],
      warnings: [
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (role === "operational_liquidity_wallet" && hardBadEvidence.length === 0 && input.approvalDrainReviewFindings.length === 0) {
    const riskScore = Math.min(40, Math.max(25, operationalRiskScore({
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      highestPathRisk: highestPathRisk(input.originPaths),
      ageAdjustment: ageRiskAdjustment(input.ageSignals)
    })));
    return {
      decision: "ACCEPTABLE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: ["Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."],
      warnings: [
        "Weak amount/time continuity lowers provenance confidence but does not by itself prove high risk.",
        ...llmWarnings
      ]
    };
  }

  if (safeDefaultReason) {
    const riskScore = clampScore(Math.max(65, highestPathRisk(input.originPaths), input.fastWalletRisk?.score ?? 0));
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      reasons: [safeDefaultReason],
      warnings: [
        ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  const unresolvedRisk = clampScore(Math.max(
    45,
    highestPathRisk(input.originPaths),
    input.fastWalletRisk?.score ?? 0
  ));
  return {
    decision: "DECLINE",
    riskScore: unresolvedRisk,
    riskBand: riskBandFromWhereScore(unresolvedRisk),
    provenanceConfidence: provenanceScore,
    coverageCompleteness: coverageScore,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: operationalScore,
    ageSignals: input.ageSignals ?? null,
    hardBadEvidence: [],
    reasons: [
      input.approvalDrainReviewFindings.length > 0
        ? "Approval-drain review findings exist but exact benign or drain provenance was not proven."
        : "Clean source could not be proven and the wallet did not match the ordinary operational/liquidity pattern."
    ],
    warnings: [
      ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
      ...approvalWarnings,
      ...llmWarnings
    ]
  };
}
