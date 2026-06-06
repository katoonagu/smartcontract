import type {
  ApprovalDrainProvenanceProfile,
  ApprovalDrainReviewFinding,
  ContractLlmVerdictSummary,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  ProofLevel,
  RiskReport,
  RiskLayerScore,
  SourceBundleExposureProfile,
  SourceExposureKind,
  SourcePolicyEvidence,
  SourcePolicyScope,
  SubjectExposureProfile,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyAssessment,
  WhereIsMoneyCoverage,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyRiskBand,
  WhereIsMoneyWalletRole
} from "../types";
import {
  aggregateLayerScores,
  scoreSourceExposures,
  sourceExposureKindFromPath
} from "./provenanceScoring";
import { selectedMoneyOriginPathShare } from "./moneyOriginAttribution";

export type BuildMoneyOriginOperationalAssessmentInput = {
  fastWalletRisk: RiskReport | null;
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
  contractLlmVerdicts: ContractLlmVerdictSummary[];
  coverage: WhereIsMoneyCoverage;
  ageSignals?: WhereIsMoneyAgeSignals | null;
  sourceBundleExposure?: SourceBundleExposureProfile | null;
  subjectExposureProfile?: SubjectExposureProfile | null;
  extraSourcePolicyEvidence?: SourcePolicyEvidence[];
  extraRiskLayers?: RiskLayerScore[];
  extraHardBadEvidence?: WhereIsMoneyHardBadEvidence[];
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

type RiskLayerCollections = Pick<
  WhereIsMoneyAssessment,
  "sourcePolicyEvidence" | "contractSuspicionEvidence" | "unknownOriginEvidence" | "riskLayers" | "dominantRiskLayer"
>;

function dominantLayer(layers: RiskLayerScore[]): RiskLayerScore | null {
  const priority = (layer: RiskLayerScore): number => {
    if (layer.evidenceClass === "hard_proof") return 60;
    if (layer.proofLevel === "exact_approval_drain_provenance" || layer.proofLevel === "exact_scam_or_taint_proof") return 55;
    if (layer.proofLevel === "llm_assisted_suspicion" && !layer.canBeDampened) return 50;
    if (layer.kind === "aggregate_source_policy") return 35;
    if (layer.proofLevel === "exchange_policy_decline") return 40;
    if (layer.evidenceClass === "source_policy") return 20;
    if (layer.evidenceClass === "contract_suspicion") return 15;
    if (layer.kind === "subject_exposure_context") return -20;
    if (layer.proofLevel === "operational_liquidity_context") return 10;
    if (layer.proofLevel === "insufficient_coverage") return -10;
    return 0;
  };

  return [...layers].sort((left, right) =>
    priority(right) - priority(left) ||
    right.score - left.score ||
    right.adjustedScore - left.adjustedScore ||
    right.rawScore - left.rawScore
  )[0] ?? null;
}

function buildRiskLayerCollections(input: {
  sourcePolicyEvidence: SourcePolicyEvidence[];
  sourcePolicyLayers: RiskLayerScore[];
  contractSuspicionEvidence: RiskLayerScore[];
  unknownOriginEvidence: RiskLayerScore[];
  aggregateSourcePolicyLayer?: RiskLayerScore | null;
  hardProofLayers?: RiskLayerScore[];
  behaviorContextLayers?: RiskLayerScore[];
}): RiskLayerCollections {
  const hardProofLayers = input.hardProofLayers ?? [];
  const behaviorContextLayers = input.behaviorContextLayers ?? [];
  const riskLayers = [
    ...hardProofLayers,
    ...input.sourcePolicyLayers,
    ...(input.aggregateSourcePolicyLayer ? [input.aggregateSourcePolicyLayer] : []),
    ...input.contractSuspicionEvidence,
    ...input.unknownOriginEvidence,
    ...behaviorContextLayers
  ];

  return {
    sourcePolicyEvidence: input.sourcePolicyEvidence,
    contractSuspicionEvidence: input.contractSuspicionEvidence,
    unknownOriginEvidence: input.unknownOriginEvidence,
    riskLayers,
    dominantRiskLayer: dominantLayer(riskLayers)
  };
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
  return selectedMoneyOriginPathShare(path);
}

function highestPathRisk(paths: MoneyOriginPath[]): number {
  return Math.max(0, ...paths.map((path) => path.riskScoreContribution));
}

function sourcePolicyScopeFromCoverage(coverage: WhereIsMoneyCoverage): SourcePolicyScope {
  if (coverage.checkedScope === "drain_episode") return "where_drain_episode";
  if (
    coverage.checkedScope === "selected_anchor" ||
    coverage.checkedScope === "requested_amount" ||
    coverage.checkedScope === "transaction_seed" ||
    coverage.provenanceScope === "requested_amount" ||
    coverage.provenanceScope === "transaction_seed"
  ) {
    return "where_selected_amount";
  }
  return "balance_forming_target";
}

function cleanCexCoverage(paths: MoneyOriginPath[]): number {
  return Math.min(1, paths.reduce((sum, path) =>
    path.verdict === "ACCEPTABLE" && path.rootSourceType === "allowlist_cex"
      ? sum + pathShare(path)
      : sum
  , 0));
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

function hardEvidenceFromApprovalDrain(
  profiles: ApprovalDrainProvenanceProfile[],
  options: { exactOnly?: boolean } = {}
): WhereIsMoneyHardBadEvidence[] {
  return profiles
    .filter((profile) => !options.exactOnly || profile.evidenceStrength === "exact_approval_and_transfer_from")
    .map((profile) => ({
      kind: "approval_drain",
      score: Math.max(profile.score, 95),
      message: `Exact approval-drain provenance reaches checked wallet via ${profile.hopDepth} hop(s).`,
      evidenceIds: [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes]
    }));
}

type ServiceRouteGuardContext = {
  active: boolean;
  guardedAddresses: Set<string>;
  guardedEvidenceIds: Set<string>;
};

function addGuardedValue(values: Set<string>, value: string | null | undefined): void {
  if (value) values.add(value.toLowerCase());
}

function buildServiceRouteGuardContext(input: BuildMoneyOriginOperationalAssessmentInput): ServiceRouteGuardContext {
  const context: ServiceRouteGuardContext = {
    active: false,
    guardedAddresses: new Set(),
    guardedEvidenceIds: new Set()
  };

  const serviceRouteCategories = new Set([
    "bridge",
    "bridge_pool",
    "dex",
    "router",
    "swap_adapter",
    "service",
    "protocol",
    "unknown_contract"
  ]);

  for (const finding of input.approvalDrainReviewFindings) {
    if (finding.reason !== "service_boundary_guard") continue;

    const routeGuards = finding.falsePositiveGuards.filter((guard) =>
      guard.code === "service_boundary_route" ||
      (guard.category !== null && serviceRouteCategories.has(guard.category))
    );
    if (routeGuards.length === 0) continue;

    context.active = true;
    addGuardedValue(context.guardedAddresses, finding.spenderAddress);
    addGuardedValue(context.guardedAddresses, finding.firstReceiverAddress);
    addGuardedValue(context.guardedEvidenceIds, finding.drainTxHash);
    for (const guard of routeGuards) {
      addGuardedValue(context.guardedAddresses, guard.address);
    }
  }

  return context;
}

function hardEvidenceFromPaths(paths: MoneyOriginPath[]): WhereIsMoneyHardBadEvidence[] {
  const evidence: WhereIsMoneyHardBadEvidence[] = [];

  for (const path of paths) {
    if (path.rootSourceType === "risky_label") {
      evidence.push({
        kind: "scam_or_blacklist",
        score: Math.max(path.riskScoreContribution, 90),
        message: path.reasons[0] ?? "Balance-forming path reaches scam or blacklist risk label.",
        evidenceIds: path.txHashes
      });
      continue;
    }
  }

  return evidence;
}

function isGuardedPath(path: MoneyOriginPath, context: ServiceRouteGuardContext | undefined): boolean {
  if (!context?.active) return false;

  const pathAddresses = [
    path.rootSourceAddress,
    ...path.pathAddresses
  ];
  if (pathAddresses.some((address) => address && context.guardedAddresses.has(address.toLowerCase()))) return true;

  const pathEvidenceIds = [
    path.balanceTransferTxHash,
    ...path.txHashes
  ];
  return pathEvidenceIds.some((id) => context.guardedEvidenceIds.has(id.toLowerCase()));
}

function approvalDrainReviewWarnings(findings: ApprovalDrainReviewFinding[]): string[] {
  return findings.slice(0, 3).map((finding) =>
    `Approval-drain review finding ${finding.reason} for drain tx ${finding.drainTxHash}; exact drain provenance was not proven.`
  );
}

function isGuardedLlmVerdict(
  verdict: ContractLlmVerdictSummary,
  context: ServiceRouteGuardContext | undefined
): boolean {
  if (!context?.active) return false;
  const contractAddress = verdict.contractAddress?.toLowerCase();
  if (contractAddress && context.guardedAddresses.has(contractAddress)) return true;
  return verdict.citedEvidenceIds.some((id) => context.guardedEvidenceIds.has(id.toLowerCase()));
}

function hardEvidenceProofLevel(kind: WhereIsMoneyHardBadEvidence["kind"]): ProofLevel {
  if (kind === "approval_drain") return "exact_approval_drain_provenance";
  if (kind === "llm_contract_suspicion") return "llm_assisted_suspicion";
  return "exact_scam_or_taint_proof";
}

function hardEvidenceClass(kind: WhereIsMoneyHardBadEvidence["kind"]): RiskLayerScore["evidenceClass"] {
  return kind === "llm_contract_suspicion" ? "contract_suspicion" : "hard_proof";
}

function hardEvidenceToLayer(evidence: WhereIsMoneyHardBadEvidence): RiskLayerScore {
  return {
    evidenceClass: hardEvidenceClass(evidence.kind),
    kind: evidence.kind,
    score: evidence.score,
    rawScore: evidence.score,
    adjustedScore: evidence.score,
    proofLevel: hardEvidenceProofLevel(evidence.kind),
    canBeDampened: false,
    reasons: [evidence.message],
    warnings: [],
    evidenceIds: evidence.evidenceIds
  };
}

function actionableContractSuspicion(verdict: ContractLlmVerdictSummary): boolean {
  if (verdict.source === "unavailable" || verdict.decisionRecommendation !== "DECLINE") return false;
  if (verdict.verdict === "drainer_like") {
    return verdict.confidence >= 0.75 || verdict.contractRiskScore >= 90;
  }
  if (verdict.verdict === "unknown_suspicious") {
    return verdict.confidence >= 0.7 && verdict.contractRiskScore >= 65;
  }
  return false;
}

function contractSuspicionLayers(
  verdicts: ContractLlmVerdictSummary[],
  options: { guardedContext?: ServiceRouteGuardContext } = {}
): RiskLayerScore[] {
  return verdicts
    .filter((verdict) => actionableContractSuspicion(verdict) && !isGuardedLlmVerdict(verdict, options.guardedContext))
    .map((verdict) => {
      const floor = verdict.verdict === "drainer_like" ? 75 : 65;
      const cap = verdict.verdict === "drainer_like" ? 80 : 75;
      const score = clampScore(Math.min(cap, Math.max(verdict.contractRiskScore, floor)));
      return {
        evidenceClass: "contract_suspicion",
        kind: verdict.verdict,
        score,
        rawScore: verdict.contractRiskScore,
        adjustedScore: score,
        proofLevel: "llm_assisted_suspicion",
        canBeDampened: true,
        reasons: [
          verdict.verdict === "drainer_like"
            ? `LLM contract verdict is drainer_like with score ${verdict.contractRiskScore}/100 and ${Math.round(verdict.confidence * 100)}% confidence.`
            : `LLM contract verdict is unknown_suspicious with ${Math.round(verdict.confidence * 100)}% confidence.`
        ],
        warnings: ["LLM contract suspicion is contextual unless exact approval-drain provenance is proven."],
        evidenceIds: verdict.citedEvidenceIds
      };
    });
}

function topLegitimateServiceLlmVerdict(verdicts: ContractLlmVerdictSummary[]): ContractLlmVerdictSummary | null {
  return verdicts
    .filter((verdict) =>
      verdict.source !== "unavailable" &&
      verdict.verdict === "legitimate_service" &&
      verdict.decisionRecommendation === "ACCEPTABLE" &&
      verdict.confidence >= 0.8 &&
      verdict.contractRiskScore <= 35
    )
    .sort((left, right) => right.confidence - left.confidence || left.contractRiskScore - right.contractRiskScore)[0] ?? null;
}

function isPositiveLegitimateServiceVerdict(verdict: ContractLlmVerdictSummary): boolean {
  return verdict.source !== "unavailable" &&
    verdict.verdict === "legitimate_service" &&
    verdict.decisionRecommendation === "ACCEPTABLE" &&
    verdict.confidence >= 0.8 &&
    verdict.contractRiskScore <= 35;
}

function pathAddressSet(path: MoneyOriginPath): Set<string> {
  return new Set([
    path.rootSourceAddress,
    ...path.pathAddresses
  ].filter((address): address is string => Boolean(address)).map((address) => address.toLowerCase()));
}

function isUnresolvedContractPath(path: MoneyOriginPath): boolean {
  const text = [
    path.rootSourceType,
    path.stoppedReason,
    path.exposureSourceKey ?? "",
    path.exposureSourceLabel ?? "",
    path.reasons.join(" ")
  ].join(" ").toLowerCase();
  return path.verdict !== "ACCEPTABLE" && (
    path.stoppedReason === "unlabeled_service_boundary" ||
    text.includes("unknown_contract") ||
    text.includes("unknown contract") ||
    text.includes("contract boundary") ||
    text.includes("service boundary")
  );
}

function positiveLlmVerdictsCoverUnresolvedContractPaths(input: BuildMoneyOriginOperationalAssessmentInput): boolean {
  const unresolvedContractPaths = input.originPaths.filter(isUnresolvedContractPath);
  if (unresolvedContractPaths.length === 0) return false;
  const positiveVerdictAddresses = new Set(input.contractLlmVerdicts
    .filter(isPositiveLegitimateServiceVerdict)
    .map((verdict) => verdict.contractAddress?.toLowerCase())
    .filter((address): address is string => Boolean(address)));
  if (positiveVerdictAddresses.size === 0) return false;
  return unresolvedContractPaths.every((path) => {
    const addresses = pathAddressSet(path);
    return [...positiveVerdictAddresses].some((address) => addresses.has(address));
  });
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

function ignoredLlmContractSuspicionWarnings(
  input: BuildMoneyOriginOperationalAssessmentInput,
  serviceRouteGuardContext: ServiceRouteGuardContext
): string[] {
  if (!serviceRouteGuardContext.active) return [];
  const hasDrainerLikeDecline = input.contractLlmVerdicts.some((verdict) =>
    verdict.verdict === "drainer_like" &&
    verdict.decisionRecommendation === "DECLINE" &&
    (verdict.confidence >= 0.75 || verdict.contractRiskScore >= 90) &&
    isGuardedLlmVerdict(verdict, serviceRouteGuardContext)
  );
  return hasDrainerLikeDecline
    ? ["LLM drainer-like contract suspicion is not used as hard approval-drain proof because a service-route guard exists."]
    : [];
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
  const cleanCoverage = cleanCexCoverage(input.originPaths);
  if (cleanCoverage >= 0.85 && input.originPaths.every((path) =>
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

type SourcePolicyAssessment = {
  sourcePolicyEvidence: SourcePolicyEvidence[];
  sourcePolicyScore: number;
  riskLayers: RiskLayerScore[];
  warnings: string[];
};

type SourceBundlePolicyExtra = {
  evidence: SourcePolicyEvidence;
  layer: RiskLayerScore;
};

function sourceBundleFloorKindFromPath(path: MoneyOriginPath): SourceExposureKind | null {
  const kind = sourceExposureKindFromPath(path);
  if (kind === "htx_huobi") return "htx_huobi";
  if (kind === "bridge_router_dex" || kind === "cross_chain_boundary") return "bridge_router_dex";
  if (kind === "unknown_contract" || kind === "unknown_cex" || kind === "no_name_token_liquidity") return "unknown_contract";
  if (kind === "risky_label" || kind === "mixer" || kind === "sanctioned_service") return "risky_label";
  return null;
}

function sourceBundleEvidenceIdsForKind(
  profile: SourceBundleExposureProfile,
  originPaths: MoneyOriginPath[],
  kind: SourceExposureKind
): string[] {
  const pathEvidenceIds = originPaths
    .filter((path) => selectedMoneyOriginPathShare(path) > 0 && sourceBundleFloorKindFromPath(path) === kind)
    .flatMap((path) => path.txHashes.length > 0 ? path.txHashes : [path.balanceTransferTxHash]);
  const uniquePathEvidenceIds = [...new Set(pathEvidenceIds)];
  if (uniquePathEvidenceIds.length > 0) return uniquePathEvidenceIds;
  if (profile.evidenceTxHashes.length > 0) return profile.evidenceTxHashes;
  return [`source-bundle-${kind}`];
}

function sourceBundlePolicyExtra(input: {
  profile: SourceBundleExposureProfile;
  originPaths: MoneyOriginPath[];
  kind: SourceExposureKind;
  share: number;
  score: number;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
}): SourceBundlePolicyExtra {
  const evidenceIds = sourceBundleEvidenceIdsForKind(input.profile, input.originPaths, input.kind);
  const sharePercent = Math.round(input.share * 100);
  const reasons = [
    `Selected amount source bundle has ${sharePercent}% ${input.kind} exposure.`
  ];
  const warnings = input.canBeDampened
    ? ["Selected-amount source exposure is contextual and can be dampened by stronger clean-source evidence."]
    : [];
  const evidence: SourcePolicyEvidence = {
    kind: input.kind,
    aggregateShare: input.share,
    effectiveShare: input.share,
    pathCount: input.profile.coverageRatio > 0 ? 1 : 0,
    score: input.score,
    riskBand: riskBandFromWhereScore(input.score),
    proofLevel: input.proofLevel,
    canBeDampened: input.canBeDampened,
    reasons,
    warnings,
    evidenceIds
  };
  return {
    evidence,
    layer: {
      evidenceClass: "source_policy",
      kind: input.kind,
      sourceExposureKind: input.kind,
      score: input.score,
      rawScore: input.score,
      adjustedScore: input.score,
      proofLevel: input.proofLevel,
      canBeDampened: input.canBeDampened,
      floorApplied: input.score,
      reasons,
      warnings,
      evidenceIds
    }
  };
}

function sourceBundlePolicyExtras(
  profile: SourceBundleExposureProfile | null | undefined,
  originPaths: MoneyOriginPath[]
): { evidence: SourcePolicyEvidence[]; layers: RiskLayerScore[] } {
  if (!profile) return { evidence: [], layers: [] };

  const extras: SourceBundlePolicyExtra[] = [];
  if (profile.riskyLabelShare >= 0.1) {
    extras.push(sourceBundlePolicyExtra({
      profile,
      originPaths,
      kind: "risky_label",
      share: profile.riskyLabelShare,
      score: 85,
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    }));
  }
  if (profile.htxHuobiShare >= 0.7) {
    extras.push(sourceBundlePolicyExtra({
      profile,
      originPaths,
      kind: "htx_huobi",
      share: profile.htxHuobiShare,
      score: 85,
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    }));
  } else if (profile.htxHuobiShare >= 0.3) {
    extras.push(sourceBundlePolicyExtra({
      profile,
      originPaths,
      kind: "htx_huobi",
      share: profile.htxHuobiShare,
      score: 70,
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    }));
  } else if (profile.htxHuobiShare >= 0.1) {
    extras.push(sourceBundlePolicyExtra({
      profile,
      originPaths,
      kind: "htx_huobi",
      share: profile.htxHuobiShare,
      score: 55,
      proofLevel: "exchange_policy_context",
      canBeDampened: true
    }));
  }
  if (profile.bridgeRouterDexShare >= 0.5) {
    extras.push(sourceBundlePolicyExtra({
      profile,
      originPaths,
      kind: "bridge_router_dex",
      share: profile.bridgeRouterDexShare,
      score: 60,
      proofLevel: "exchange_policy_decline",
      canBeDampened: false
    }));
  }
  if (profile.unknownContractShare >= 0.5) {
    extras.push(sourceBundlePolicyExtra({
      profile,
      originPaths,
      kind: "unknown_contract",
      share: profile.unknownContractShare,
      score: 45,
      proofLevel: "exchange_policy_context",
      canBeDampened: true
    }));
  }

  return {
    evidence: extras.map((extra) => extra.evidence),
    layers: extras.map((extra) => extra.layer)
  };
}

function subjectExposureContextLayer(profile: SubjectExposureProfile | null | undefined): RiskLayerScore | null {
  if (!profile || profile.scoreContribution <= 0) return null;
  const score = clampScore(Math.min(20, profile.scoreContribution));
  if (score <= 0) return null;
  return {
    evidenceClass: "behavior_context",
    kind: "subject_exposure_context",
    score,
    rawScore: score,
    adjustedScore: score,
    proofLevel: "operational_liquidity_context",
    canBeDampened: true,
    reasons: profile.reasons,
    warnings: profile.warnings,
    evidenceIds: []
  };
}

function layerEvidenceKey(layer: RiskLayerScore): string {
  return `${layer.sourceExposureKind ?? layer.kind}:${[...layer.evidenceIds].sort().join("|")}`;
}

function aggregateSourcePolicyScoreByKind(
  sourcePolicyEvidence: SourcePolicyEvidence[],
  riskLayers: RiskLayerScore[]
): number {
  const scoreByKind = new Map<string, number>();
  const addScoreByKind = (kind: string, score: number) => {
    scoreByKind.set(kind, Math.max(scoreByKind.get(kind) ?? 0, score));
  };
  for (const item of sourcePolicyEvidence) {
    addScoreByKind(item.kind, item.score);
  }
  for (const layer of riskLayers) {
    if (layer.evidenceClass !== "source_policy") continue;
    const layerKind = layer.sourceExposureKind ?? layer.kind;
    addScoreByKind(layerKind, layer.score);
  }
  return aggregateLayerScores([...scoreByKind.values()]);
}

function combineSourcePolicyExtras(
  assessment: SourcePolicyAssessment,
  extraEvidence: SourcePolicyEvidence[],
  extraLayers: RiskLayerScore[]
): SourcePolicyAssessment {
  if (extraEvidence.length === 0 && extraLayers.length === 0) return assessment;

  const sourcePolicyEvidence = [
    ...assessment.sourcePolicyEvidence,
    ...extraEvidence
  ];
  const riskLayers = [
    ...assessment.riskLayers,
    ...extraLayers
  ];

  return {
    sourcePolicyEvidence,
    sourcePolicyScore: aggregateSourcePolicyScoreByKind(sourcePolicyEvidence, riskLayers),
    riskLayers,
    warnings: [
      ...sourcePolicyEvidence.flatMap((item) => item.warnings),
      ...extraLayers.flatMap((item) => item.warnings)
    ]
  };
}

function dedupeHardProofLayers(layers: RiskLayerScore[]): RiskLayerScore[] {
  const seen = new Set<string>();
  const deduped: RiskLayerScore[] = [];
  for (const layer of layers) {
    const key = layerEvidenceKey(layer);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(layer);
  }
  return deduped;
}

function strictPathSourcePolicyCap(kind: SourceExposureKind): number {
  if (kind === "no_name_token_liquidity") return 88;
  if (kind === "mixer") return 95;
  if (kind === "sanctioned_service") return 100;
  return 100;
}

function strictPathScoreByKind(paths: MoneyOriginPath[]): Map<SourceExposureKind, number> {
  const scores = new Map<SourceExposureKind, number>();
  for (const path of paths) {
    const kind = sourceExposureKindFromPath(path);
    if (!kind) continue;
    if (kind === "unknown_contract" || kind === "unknown_cex") continue;
    const share = pathShare(path);
    if (path.verdict !== "DECLINE" || share < 0.5 || path.riskScoreContribution < 60) continue;
    const cappedScore = Math.min(path.riskScoreContribution, strictPathSourcePolicyCap(kind));
    scores.set(kind, Math.max(scores.get(kind) ?? 0, cappedScore));
  }
  return scores;
}

function withSourcePolicyEvidenceUpdate(
  assessment: SourcePolicyAssessment,
  update: (evidence: SourcePolicyEvidence) => SourcePolicyEvidence
): SourcePolicyAssessment {
  const sourcePolicyEvidence = assessment.sourcePolicyEvidence.map(update);
  const byKind = new Map<SourceExposureKind, SourcePolicyEvidence>();
  for (const evidence of sourcePolicyEvidence) {
    const previous = byKind.get(evidence.kind);
    if (!previous || evidence.score > previous.score) {
      byKind.set(evidence.kind, evidence);
    }
  }
  const evidenceForLayer = (layer: RiskLayerScore): SourcePolicyEvidence | null => {
    if (!layer.sourceExposureKind) return null;
    const matchedByEvidenceId = sourcePolicyEvidence.find((evidence) =>
      evidence.kind === layer.sourceExposureKind &&
      evidence.evidenceIds.some((id) => layer.evidenceIds.includes(id))
    );
    if (matchedByEvidenceId) return matchedByEvidenceId;
    if (layer.kind !== layer.sourceExposureKind) return null;
    return byKind.get(layer.sourceExposureKind) ?? null;
  };
  const riskLayers = assessment.riskLayers.map((layer) => {
    const evidence = evidenceForLayer(layer);
    if (!evidence) return layer;
    const capApplied = evidence.score < Math.round(layer.rawScore) ? evidence.score : undefined;
    const floorApplied = evidence.score > Math.round(layer.rawScore) ? evidence.score : undefined;
    return {
      ...layer,
      score: evidence.score,
      adjustedScore: evidence.score,
      proofLevel: evidence.proofLevel,
      canBeDampened: evidence.canBeDampened,
      capApplied,
      floorApplied,
      reasons: evidence.reasons,
      warnings: evidence.warnings,
      evidenceIds: evidence.evidenceIds
    };
  });
  return {
    sourcePolicyEvidence,
    sourcePolicyScore: aggregateSourcePolicyScoreByKind(sourcePolicyEvidence, riskLayers),
    riskLayers,
    warnings: sourcePolicyEvidence.flatMap((item) => item.warnings)
  };
}

function applyStrictPathSourcePolicyScores(
  assessment: SourcePolicyAssessment,
  paths: MoneyOriginPath[]
): SourcePolicyAssessment {
  const strictScores = strictPathScoreByKind(paths);
  if (strictScores.size === 0) return assessment;

  return withSourcePolicyEvidenceUpdate(assessment, (evidence) => {
    const strictScore = strictScores.get(evidence.kind) ?? 0;
    if (strictScore < 60 || evidence.score >= strictScore) return evidence;
    return {
      ...evidence,
      score: strictScore,
      riskBand: riskBandFromWhereScore(strictScore),
      proofLevel: "exchange_policy_decline",
      warnings: evidence.warnings.filter((warning) => !warning.includes("below decline threshold"))
    };
  });
}

function dampenUnknownContractSourcePolicy(assessment: SourcePolicyAssessment): SourcePolicyAssessment {
  return withSourcePolicyEvidenceUpdate(assessment, (evidence) => {
    if (evidence.kind !== "unknown_contract") return evidence;
    const score = Math.min(evidence.score, 35);
    return {
      ...evidence,
      score,
      riskBand: riskBandFromWhereScore(score),
      proofLevel: "exchange_policy_context",
      canBeDampened: true,
      reasons: [
        ...evidence.reasons,
        "Unknown-contract source-policy risk was dampened because a high-confidence legitimate-service verdict covers the unresolved contract path."
      ],
      warnings: [
        ...evidence.warnings,
        "Legitimate service verdict lowers unknown-contract risk but does not prove clean CEX origin."
      ]
    };
  });
}

function capOperationalSourcePolicyContext(
  assessment: SourcePolicyAssessment,
  role: WhereIsMoneyWalletRole
): SourcePolicyAssessment {
  if (role !== "operational_liquidity_wallet") return assessment;

  return withSourcePolicyEvidenceUpdate(assessment, (evidence) => {
    let cap: number | null = null;
    if (evidence.kind === "htx_huobi" && evidence.aggregateShare < 0.2) cap = 55;
    if (evidence.kind === "whitebit" && evidence.aggregateShare < 0.05) cap = 44;
    else if (evidence.kind === "whitebit" && evidence.aggregateShare < 0.5) cap = 55;
    if (cap === null || evidence.score <= cap) return evidence;

    return {
      ...evidence,
      score: cap,
      riskBand: riskBandFromWhereScore(cap),
      proofLevel: "exchange_policy_context",
      canBeDampened: true,
      warnings: [
        ...evidence.warnings,
        "Operational-liquidity wallet context caps minority source-policy exposure below the decline threshold."
      ]
    };
  });
}

function isStrictSourcePolicyDeclineEvidence(evidence: SourcePolicyEvidence): boolean {
  return evidence.proofLevel === "exchange_policy_decline" ||
    (!evidence.canBeDampened && evidence.score >= 60);
}

function isStrictSourcePolicyDeclineLayer(layer: RiskLayerScore): boolean {
  return layer.evidenceClass === "source_policy" &&
    (
      layer.proofLevel === "exchange_policy_decline" ||
      (!layer.canBeDampened && layer.score >= 60)
    );
}

function hasStrictSourcePolicyDecline(assessment: SourcePolicyAssessment): boolean {
  return assessment.sourcePolicyEvidence.some((evidence) =>
    isStrictSourcePolicyDeclineEvidence(evidence)
  ) || assessment.riskLayers.some((layer) => isStrictSourcePolicyDeclineLayer(layer));
}

function hasNonDampenableSourcePolicyDecline(assessment: SourcePolicyAssessment): boolean {
  return assessment.sourcePolicyEvidence.some((evidence) =>
    !evidence.canBeDampened &&
    (evidence.proofLevel === "exchange_policy_decline" || evidence.score >= 60)
  ) || assessment.riskLayers.some((layer) =>
    layer.evidenceClass === "source_policy" &&
    !layer.canBeDampened &&
    (layer.proofLevel === "exchange_policy_decline" || layer.score >= 60)
  );
}

function aggregateSourcePolicyDeclineLayer(assessment: SourcePolicyAssessment): RiskLayerScore | null {
  if (assessment.sourcePolicyScore < 60) return null;
  if (!hasStrictSourcePolicyDecline(assessment)) return null;
  const sourcePolicyLayers = assessment.riskLayers.filter((layer) => layer.evidenceClass === "source_policy");
  const topScore = Math.max(
    0,
    ...assessment.sourcePolicyEvidence.map((evidence) => evidence.score),
    ...sourcePolicyLayers.map((layer) => layer.score)
  );
  const evidenceIds = [...new Set([
    ...assessment.sourcePolicyEvidence.flatMap((evidence) => evidence.evidenceIds),
    ...sourcePolicyLayers.flatMap((layer) => layer.evidenceIds)
  ])];
  const reasons = [
    "Combined source-policy exposures exceed the exchange decline threshold; this is policy risk, not direct scam/drain proof."
  ];
  const warnings = [
    ...assessment.warnings,
    "Aggregate source-policy decline is based on combined contextual exposures, not a single hard-proof layer."
  ];
  return {
    evidenceClass: "source_policy",
    kind: "aggregate_source_policy",
    score: assessment.sourcePolicyScore,
    rawScore: Math.max(assessment.sourcePolicyScore, topScore),
    adjustedScore: assessment.sourcePolicyScore,
    proofLevel: "exchange_policy_decline",
    canBeDampened: false,
    reasons,
    warnings,
    evidenceIds
  };
}

function highestLayerScore(layers: RiskLayerScore[]): number {
  return Math.max(0, ...layers.map((layer) => layer.score));
}

function topSourcePolicyReason(assessment: SourcePolicyAssessment): string | null {
  const top = [...assessment.sourcePolicyEvidence].sort((left, right) => right.score - left.score)[0] ?? null;
  return top?.reasons[0] ?? null;
}

function topSourcePolicyPathReason(assessment: SourcePolicyAssessment, paths: MoneyOriginPath[]): string | null {
  const top = [...assessment.sourcePolicyEvidence].sort((left, right) => right.score - left.score)[0] ?? null;
  if (!top) return null;
  return paths.find((path) => sourceExposureKindFromPath(path) === top.kind)?.reasons[0] ?? null;
}

function unprovenOriginPaths(paths: MoneyOriginPath[]): MoneyOriginPath[] {
  return paths.filter((path) =>
    path.verdict !== "ACCEPTABLE" ||
    path.rootSourceType === "unknown" ||
    path.rootSourceType === "incomplete" ||
    path.stoppedReason === "data_budget_exhausted" ||
    path.stoppedReason === "no_previous_transfer" ||
    path.stoppedReason === "weak_amount_or_time_continuity" ||
    path.stoppedReason === "unlabeled_service_boundary"
  );
}

function pathsWithoutSourcePolicyExposure(paths: MoneyOriginPath[]): MoneyOriginPath[] {
  return paths.filter((path) => !sourceExposureKindFromPath(path));
}

function buildUnknownOriginEvidence(input: {
  paths: MoneyOriginPath[];
  role: WhereIsMoneyWalletRole;
  recentFlowScope: boolean;
  operationalRisk: number;
  fastScore: number;
  approvalDrainReviewFindingCount: number;
}): RiskLayerScore[] {
  const paths = unprovenOriginPaths(input.paths);
  if (paths.length === 0 && input.approvalDrainReviewFindingCount === 0) return [];

  const rawScore = clampScore(Math.max(
    highestPathRisk(paths),
    input.fastScore,
    input.operationalRisk,
    input.approvalDrainReviewFindingCount > 0 ? 45 : 0
  ));
  const isOperational = input.role === "operational_liquidity_wallet" && input.approvalDrainReviewFindingCount === 0;
  const adjustedScore = isOperational
    ? clampScore(Math.min(input.recentFlowScope ? 35 : 40, Math.max(25, input.operationalRisk)))
    : clampScore(Math.max(45, rawScore));
  const proofLevel: ProofLevel = isOperational ? "operational_liquidity_context" : "insufficient_coverage";

  return [{
    evidenceClass: "unknown_origin",
    kind: isOperational ? "operational_unknown_origin" : "unresolved_origin",
    score: adjustedScore,
    rawScore,
    adjustedScore,
    proofLevel,
    canBeDampened: isOperational,
    capApplied: adjustedScore < rawScore ? adjustedScore : undefined,
    floorApplied: adjustedScore > rawScore ? adjustedScore : undefined,
    reasons: [
      isOperational
        ? "Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."
        : "Clean source could not be fully proven from available balance-forming paths."
    ],
    warnings: isOperational
      ? ["Unknown-origin risk is capped for operational/liquidity wallets when no hard bad evidence is present."]
      : ["Unknown-origin evidence is contextual and does not by itself prove scam, blacklist, or approval-drain activity."],
    evidenceIds: [...new Set(paths.flatMap((path) => path.txHashes))]
  }];
}

function sourcePolicyEvidenceFromGuardedPaths(paths: MoneyOriginPath[], score: number): {
  evidence: SourcePolicyEvidence;
  layer: RiskLayerScore;
} | null {
  if (paths.length === 0) return null;
  const kind = paths.map(sourceExposureKindFromPath).find((value): value is SourceExposureKind =>
    value !== null && value !== "allowlisted_cex" && value !== "risky_label"
  ) ?? "bridge_router_dex";
  const aggregateShare = Math.min(1, paths.reduce((sum, path) => sum + pathShare(path), 0));
  const evidenceIds = [...new Set(paths.flatMap((path) => path.txHashes))];
  const reasons = ["Service boundary reached; drainer proof is not proven, but this service-origin source is declined by policy."];
  const warnings = ["Service-route guard prevents approval-drain hard proof and keeps the decision in the source-policy layer."];
  const evidence: SourcePolicyEvidence = {
    kind,
    aggregateShare,
    effectiveShare: aggregateShare,
    pathCount: paths.length,
    score,
    riskBand: riskBandFromWhereScore(score),
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: true,
    reasons,
    warnings,
    evidenceIds
  };
  return {
    evidence,
    layer: {
      evidenceClass: "source_policy",
      kind,
      sourceExposureKind: kind,
      score,
      rawScore: Math.max(score, highestPathRisk(paths)),
      adjustedScore: score,
      proofLevel: evidence.proofLevel,
      canBeDampened: true,
      capApplied: score < highestPathRisk(paths) ? score : undefined,
      reasons,
      warnings,
      evidenceIds
    }
  };
}

export function buildMoneyOriginOperationalAssessment(input: BuildMoneyOriginOperationalAssessmentInput): WhereIsMoneyAssessment {
  const serviceRouteGuardContext = buildServiceRouteGuardContext(input);
  const serviceRouteGuard = serviceRouteGuardContext.active;
  const hardBadEvidence = [
    ...hardEvidenceFromFastRisk(input.fastWalletRisk),
    ...hardEvidenceFromApprovalDrain(input.approvalDrainProvenanceProfiles, { exactOnly: serviceRouteGuard }),
    ...hardEvidenceFromPaths(input.originPaths),
    ...(input.extraHardBadEvidence ?? [])
  ].sort((left, right) => right.score - left.score);
  const extraSourcePolicyEvidence = input.extraSourcePolicyEvidence ?? [];
  const extraRiskLayers = input.extraRiskLayers ?? [];
  const sourceBundleExtras = sourceBundlePolicyExtras(input.sourceBundleExposure, input.originPaths);
  const subjectExposureLayer = subjectExposureContextLayer(input.subjectExposureProfile);
  const extraSourcePolicyLayers = extraRiskLayers.filter((layer) => layer.evidenceClass === "source_policy");
  const extraUnknownOriginEvidence = extraRiskLayers.filter((layer) =>
    layer.evidenceClass === "unknown_origin" || layer.evidenceClass === "data_quality"
  );
  const extraHardProofLayers = extraRiskLayers.filter((layer) => layer.evidenceClass === "hard_proof");

  const operationalScore = operationalLiquidityScore(input.senderInteractionProfiles);
  const coverageScore = coverageCompleteness(input);
  const provenanceScore = provenanceConfidence(input, operationalScore);
  const role = walletRole({ hardBadEvidence, originPaths: input.originPaths, operationalScore });
  const topHardEvidence = hardBadEvidence[0] ?? null;
  const approvalWarnings = approvalDrainReviewWarnings(input.approvalDrainReviewFindings);
  const llmWarnings = [
    ...llmVerdictWarnings(input.contractLlmVerdicts),
    ...ignoredLlmContractSuspicionWarnings(input, serviceRouteGuardContext)
  ];
  const riskyMoneyPath = hasRiskyMoneyPath(input);
  const safeDefaultReason = riskyMoneyPath ? llmSafeDefaultReason(input.contractLlmVerdicts) : null;
  const recentFlowScope = input.coverage.provenanceScope === "recent_flow";
  const cleanCoverage = cleanCexCoverage(input.originPaths);
  const operationalRisk = operationalRiskScore({
    provenanceConfidence: provenanceScore,
    coverageCompleteness: coverageScore,
    highestPathRisk: highestPathRisk(input.originPaths),
    ageAdjustment: ageRiskAdjustment(input.ageSignals)
  });
  let sourcePolicyAssessment = applyStrictPathSourcePolicyScores(scoreSourceExposures({
    originPaths: input.originPaths,
    walletRole: role,
    operationalLiquidityScore: operationalScore,
    cleanCexCoverage: cleanCoverage,
    coverageCompleteness: coverageScore,
    provenanceConfidence: provenanceScore,
    ageSignals: input.ageSignals ?? null,
    scope: sourcePolicyScopeFromCoverage(input.coverage),
    targetAmountRaw: input.coverage.targetAmountRaw
  }), input.originPaths);
  sourcePolicyAssessment = capOperationalSourcePolicyContext(sourcePolicyAssessment, role);
  sourcePolicyAssessment = combineSourcePolicyExtras(
    sourcePolicyAssessment,
    [
      ...sourceBundleExtras.evidence,
      ...extraSourcePolicyEvidence
    ],
    [
      ...sourceBundleExtras.layers,
      ...extraSourcePolicyLayers
    ]
  );
  const legitimateServiceVerdict = topLegitimateServiceLlmVerdict(input.contractLlmVerdicts);
  const canDampenUnknownContract = Boolean(
    legitimateServiceVerdict &&
    !safeDefaultReason &&
    !hasStrictSourcePolicyDecline(sourcePolicyAssessment) &&
    positiveLlmVerdictsCoverUnresolvedContractPaths(input) &&
    input.approvalDrainReviewFindings.length === 0 &&
    hardBadEvidence.length === 0
  );
  if (canDampenUnknownContract) {
    sourcePolicyAssessment = dampenUnknownContractSourcePolicy(sourcePolicyAssessment);
  }
  const sourcePolicyDecline = hasStrictSourcePolicyDecline(sourcePolicyAssessment);
  const aggregateDeclineLayer = aggregateSourcePolicyDeclineLayer(sourcePolicyAssessment);
  const contractSuspicionEvidence = contractSuspicionLayers(input.contractLlmVerdicts, { guardedContext: serviceRouteGuardContext });
  const defaultUnknownOriginEvidence = buildUnknownOriginEvidence({
    paths: input.originPaths,
    role,
    recentFlowScope,
    operationalRisk,
    fastScore: input.fastWalletRisk?.score ?? 0,
    approvalDrainReviewFindingCount: input.approvalDrainReviewFindings.length
  });
  const layerCollectionsWithExtras = (input: {
    sourcePolicyEvidence: SourcePolicyEvidence[];
    sourcePolicyLayers: RiskLayerScore[];
    contractSuspicionEvidence: RiskLayerScore[];
    unknownOriginEvidence: RiskLayerScore[];
    aggregateSourcePolicyLayer?: RiskLayerScore | null;
    hardProofLayers?: RiskLayerScore[];
  }) => buildRiskLayerCollections({
    sourcePolicyEvidence: input.sourcePolicyEvidence,
    sourcePolicyLayers: input.sourcePolicyLayers,
    aggregateSourcePolicyLayer: input.aggregateSourcePolicyLayer,
    contractSuspicionEvidence: input.contractSuspicionEvidence,
    unknownOriginEvidence: [
      ...input.unknownOriginEvidence,
      ...extraUnknownOriginEvidence
    ],
    behaviorContextLayers: subjectExposureLayer ? [subjectExposureLayer] : [],
    hardProofLayers: dedupeHardProofLayers([
      ...(input.hardProofLayers ?? []),
      ...extraHardProofLayers
    ])
  });
  const defaultLayerCollections = (hardProofLayers = hardBadEvidence.map(hardEvidenceToLayer)) =>
    layerCollectionsWithExtras({
      sourcePolicyEvidence: sourcePolicyAssessment.sourcePolicyEvidence,
      sourcePolicyLayers: sourcePolicyAssessment.riskLayers,
      aggregateSourcePolicyLayer: aggregateDeclineLayer,
      contractSuspicionEvidence,
      unknownOriginEvidence: defaultUnknownOriginEvidence,
      hardProofLayers
    });
  const sourcePolicyAcceptableFloor = !sourcePolicyDecline
    ? sourcePolicyAssessment.sourcePolicyScore
    : 0;

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
      ...defaultLayerCollections(),
      reasons: [topHardEvidence.message],
      warnings: [
        ...(input.coverage.partial ? ["Coverage is partial; hard bad evidence takes priority."] : []),
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  const guardedDeclinePaths = input.originPaths.filter((path) =>
    (path.rootSourceType === "decline_boundary" ||
      path.stoppedReason === "decline_boundary_reached" ||
      path.verdict === "DECLINE") &&
    isGuardedPath(path, serviceRouteGuardContext)
  );
  const hasUnguardedSourcePolicyDecline = input.originPaths.some((path) =>
    (path.rootSourceType === "decline_boundary" ||
      path.stoppedReason === "decline_boundary_reached" ||
      path.verdict === "DECLINE") &&
    path.riskScoreContribution >= 60 &&
    !isGuardedPath(path, serviceRouteGuardContext)
  );
  const topContractSuspicion = [...contractSuspicionEvidence]
    .sort((left, right) => right.score - left.score || right.rawScore - left.rawScore)[0] ?? null;
  const nonDampenableSourcePolicyDecline = hasNonDampenableSourcePolicyDecline(sourcePolicyAssessment);
  const sourcePolicyShouldPrecedeContractSuspicion = sourcePolicyDecline &&
    (hasUnguardedSourcePolicyDecline || nonDampenableSourcePolicyDecline);
  if (topContractSuspicion && (
    !sourcePolicyShouldPrecedeContractSuspicion ||
    (!nonDampenableSourcePolicyDecline && topContractSuspicion.score >= sourcePolicyAssessment.sourcePolicyScore)
  )) {
    const riskScore = clampScore(topContractSuspicion.score);
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role === "operational_liquidity_wallet" ? "risky_source_wallet" : role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      ...defaultLayerCollections([]),
      reasons: topContractSuspicion.reasons,
      warnings: [
        ...topContractSuspicion.warnings,
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (serviceRouteGuard && guardedDeclinePaths.length > 0 && !hasUnguardedSourcePolicyDecline && !nonDampenableSourcePolicyDecline) {
    const riskScore = clampScore(Math.min(75, Math.max(70, highestPathRisk(input.originPaths), input.fastWalletRisk?.score ?? 0)));
    const guardedSourcePolicy = withSourcePolicyEvidenceUpdate(sourcePolicyAssessment, (evidence) => {
      if (evidence.score <= riskScore) return evidence;
      return {
        ...evidence,
        score: riskScore,
        riskBand: riskBandFromWhereScore(riskScore),
        proofLevel: riskScore >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
        warnings: [
          ...evidence.warnings,
          "Service-route guard caps source-policy score because drainer proof is not proven."
        ]
      };
    });
    const guardFallback = guardedSourcePolicy.sourcePolicyEvidence.length === 0
      ? sourcePolicyEvidenceFromGuardedPaths(guardedDeclinePaths, riskScore)
      : null;
    const guardedUnknownOriginEvidence = defaultUnknownOriginEvidence.map((layer) =>
      layer.score > riskScore
        ? {
            ...layer,
            score: riskScore,
            adjustedScore: riskScore,
            capApplied: riskScore
          }
        : layer
    );
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence,
      ...layerCollectionsWithExtras({
        sourcePolicyEvidence: guardFallback
          ? [guardFallback.evidence, ...guardedSourcePolicy.sourcePolicyEvidence]
          : guardedSourcePolicy.sourcePolicyEvidence,
        sourcePolicyLayers: guardFallback
          ? [guardFallback.layer, ...guardedSourcePolicy.riskLayers]
          : guardedSourcePolicy.riskLayers,
        aggregateSourcePolicyLayer: aggregateSourcePolicyDeclineLayer(guardedSourcePolicy),
        contractSuspicionEvidence,
        unknownOriginEvidence: guardedUnknownOriginEvidence,
        hardProofLayers: []
      }),
      reasons: ["Service boundary reached; drainer proof is not proven, but this service-origin source is declined by policy."],
      warnings: [
        ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (sourcePolicyDecline) {
    const sourcePolicyBranchUnknownOriginEvidence = buildUnknownOriginEvidence({
      paths: pathsWithoutSourcePolicyExposure(input.originPaths),
      role,
      recentFlowScope,
      operationalRisk,
      fastScore: input.fastWalletRisk?.score ?? 0,
      approvalDrainReviewFindingCount: input.approvalDrainReviewFindings.length
    });
    const riskScore = clampScore(Math.max(
      60,
      sourcePolicyAssessment.sourcePolicyScore,
      highestLayerScore(sourcePolicyBranchUnknownOriginEvidence)
    ));
    return {
      decision: "DECLINE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: provenanceScore,
      coverageCompleteness: coverageScore,
      walletRole: role === "operational_liquidity_wallet" ? "risky_source_wallet" : role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      ...layerCollectionsWithExtras({
        sourcePolicyEvidence: sourcePolicyAssessment.sourcePolicyEvidence,
        sourcePolicyLayers: sourcePolicyAssessment.riskLayers,
        aggregateSourcePolicyLayer: aggregateDeclineLayer,
        contractSuspicionEvidence,
        unknownOriginEvidence: sourcePolicyBranchUnknownOriginEvidence,
        hardProofLayers: []
      }),
      reasons: [
        topSourcePolicyPathReason(sourcePolicyAssessment, input.originPaths) ??
        topSourcePolicyReason(sourcePolicyAssessment) ??
        "Source-policy exposure exceeds decline threshold."
      ],
      warnings: [
        ...sourcePolicyAssessment.warnings,
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (
    legitimateServiceVerdict &&
    canDampenUnknownContract
  ) {
    const riskScore = clampScore(Math.max(
      20,
      Math.min(35, sourcePolicyAssessment.sourcePolicyScore),
      Math.min(35, input.fastWalletRisk?.score ?? legitimateServiceVerdict.contractRiskScore)
    ));
    const legitimateUnknownOrigin: RiskLayerScore[] = [{
      evidenceClass: "unknown_origin",
      kind: "legitimate_service_unknown_contract",
      score: riskScore,
      rawScore: Math.max(highestPathRisk(input.originPaths), legitimateServiceVerdict.contractRiskScore),
      adjustedScore: riskScore,
      proofLevel: "exchange_policy_context",
      canBeDampened: true,
      capApplied: riskScore,
      reasons: ["Unknown contract boundary was dampened by a high-confidence legitimate-service verdict covering the unresolved path."],
      warnings: ["Legitimate service verdict lowers unknown-contract risk but does not prove clean CEX origin."],
      evidenceIds: legitimateServiceVerdict.citedEvidenceIds
    }];
    return {
      decision: "ACCEPTABLE",
      riskScore,
      riskBand: riskBandFromWhereScore(riskScore),
      provenanceConfidence: Math.max(provenanceScore, 55),
      coverageCompleteness: coverageScore,
      walletRole: role === "risky_source_wallet" ? "unknown_wallet" : role,
      operationalLiquidityScore: operationalScore,
      ageSignals: input.ageSignals ?? null,
      hardBadEvidence: [],
      ...layerCollectionsWithExtras({
        sourcePolicyEvidence: sourcePolicyAssessment.sourcePolicyEvidence,
        sourcePolicyLayers: sourcePolicyAssessment.riskLayers,
        aggregateSourcePolicyLayer: aggregateDeclineLayer,
        contractSuspicionEvidence,
        unknownOriginEvidence: legitimateUnknownOrigin,
        hardProofLayers: []
      }),
      reasons: ["Clean CEX origin is not fully proven; unknown contract boundary was downgraded because AI classified the contract as a legitimate service and no hard bad evidence was found."],
      warnings: [
        "Legitimate service verdict lowers unknown-contract risk but does not prove clean CEX origin.",
        ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (role === "clean_cex_funded_wallet") {
    const riskScore = clampScore(Math.max(
      5,
      input.fastWalletRisk?.score ?? 0,
      sourcePolicyAcceptableFloor
    ));
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
      ...defaultLayerCollections([]),
      reasons: ["Balance-forming paths reach allowlisted CEX sources through clean on-chain hops."],
      warnings: [
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (
    sourcePolicyAssessment.sourcePolicyScore > 0 &&
    !sourcePolicyDecline &&
    cleanCoverage >= 0.7 &&
    hardBadEvidence.length === 0 &&
    input.approvalDrainReviewFindings.length === 0 &&
    !safeDefaultReason
  ) {
    const riskScore = clampScore(Math.max(25, Math.min(55, sourcePolicyAssessment.sourcePolicyScore)));
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
      ...defaultLayerCollections([]),
      reasons: [topSourcePolicyPathReason(sourcePolicyAssessment, input.originPaths) ?? topSourcePolicyReason(sourcePolicyAssessment) ?? "Minority source-policy exposure is contextual and below the decline threshold."],
      warnings: [
        "Minority source-policy exposure is contextual; clean CEX coverage remains the dominant balance source.",
        ...sourcePolicyAssessment.warnings,
        ...approvalWarnings,
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
      ...defaultLayerCollections([]),
      reasons: [safeDefaultReason],
      warnings: [
        ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
        ...approvalWarnings,
        ...llmWarnings
      ]
    };
  }

  if (role === "operational_liquidity_wallet" && hardBadEvidence.length === 0 && input.approvalDrainReviewFindings.length === 0) {
    const cappedOperationalRisk = recentFlowScope
      ? Math.min(35, Math.max(25, operationalRisk))
      : Math.min(40, Math.max(25, operationalRisk));
    const riskScore = clampScore(Math.max(
      cappedOperationalRisk,
      sourcePolicyAcceptableFloor
    ));
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
      ...defaultLayerCollections([]),
      reasons: [
        recentFlowScope
          ? "Recent-flow source is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."
          : "Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."
      ],
      warnings: [
        recentFlowScope
          ? "Recent-flow coverage is wallet-flow context, not current-balance provenance."
          : "Weak amount/time continuity lowers provenance confidence but does not by itself prove high risk.",
        ...(input.coverage.partial ? ["Coverage is partial; result is conservative."] : []),
        ...llmWarnings
      ]
    };
  }

  const unresolvedRisk = clampScore(Math.max(
    45,
    sourcePolicyAssessment.sourcePolicyScore,
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
    ...defaultLayerCollections([]),
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
