import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  RiskLabel,
  RiskLevel,
  RiskReason,
  RiskReport,
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
    | "coverage";
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

export type UnifiedWalletRiskResult = {
  finalScore: number;
  finalLevel: RiskLevel;
  finalDecision: UserExchangeDecision;
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
};

const FAST_LAYER_WEIGHT = 0.10;
const DEEP_LAYER_WEIGHT = 0.60;
const WHERE_LAYER_WEIGHT = 0.30;
const TRON_USDT_DECIMALS = 1_000_000;

const highRiskProvenanceLabels = new Set<RiskLabel>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange"
]);
const deterministicWhereHardEvidenceKinds = new Set([
  "approval_drain",
  "scam_or_blacklist",
  "sanctioned_service"
]);

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function decisionFromScore(score: number): UserExchangeDecision {
  return score >= 60 ? "DECLINE" : "ACCEPTABLE";
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

function rawUsdtAmount(raw: string | null | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const whole = BigInt(raw) / BigInt(TRON_USDT_DECIMALS);
  const capped = whole > 10_000_000_000n ? 10_000_000_000n : whole;
  return Number(capped);
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

function isFastApprovalDrainHardEvidence(code: string): boolean {
  return code === "forensic_approval_drain_provenance" ||
    code === "internal_label_approval_drain_proximity" ||
    code.includes("approval_drain_exact") ||
    code.includes("exact_approval");
}

function isFastExactSelfHardEvidence(code: string): boolean {
  return code.startsWith("internal_label_scam") ||
    code.startsWith("internal_label_reported_scam") ||
    code.startsWith("internal_label_stolen_funds") ||
    code.startsWith("internal_label_phishing") ||
    code.startsWith("internal_label_risky_contract") ||
    code.startsWith("internal_label_whitebit") ||
    (code.startsWith("internal_label_darknet_exchange") && !code.includes("proximity"));
}

function isFastHardEvidenceCode(code: string): boolean {
  return code === "stablecoin_usdt_blacklisted" ||
    isFastApprovalDrainHardEvidence(code) ||
    isFastExactSelfHardEvidence(code);
}

function fastHardEvidenceScore(reason: RiskReason): number {
  if (reason.code === "stablecoin_usdt_blacklisted") return 95;
  if (isFastApprovalDrainHardEvidence(reason.code) || isFastExactSelfHardEvidence(reason.code)) {
    return Math.max(90, clampScore(reason.scoreImpact));
  }
  return Math.max(85, clampScore(reason.scoreImpact));
}

function fastHardEvidenceFloor(fastReport: RiskReport | null | undefined): UnifiedWalletRiskReason | null {
  return fastReport?.reasons
    .filter((reason) => isFastHardEvidenceCode(reason.code))
    .map((reason) => ({
      code: reason.code,
      message: reason.message,
      score: fastHardEvidenceScore(reason),
      source: "hard_evidence" as const
    }))
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

export function hasUnifiedFastHardEvidence(fastReport: RiskReport | null | undefined): boolean {
  return fastHardEvidenceFloor(fastReport) !== null;
}

function deepHardEvidenceFloors(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason[] {
  if (!report) return [];
  const reasons: UnifiedWalletRiskReason[] = [];

  if (arrayOrEmpty(report.stablecoinRestrictionProfiles).some((profile) => profile.isBlacklisted)) {
    reasons.push({
      code: "usdt_blacklist",
      message: "Active TRC20 USDT blacklist evidence found.",
      score: 95,
      source: "hard_evidence"
    });
  }

  const exactDrain = arrayOrEmpty(report.approvalDrainProvenanceProfiles).find(
    (profile) => profile.score >= 85 && profile.evidenceStrength === "exact_approval_and_transfer_from"
  );
  if (exactDrain) {
    reasons.push({
      code: "exact_approval_drain",
      message: "Exact approval-drain provenance found.",
      score: Math.max(90, clampScore(exactDrain.score)),
      source: "hard_evidence"
    });
  }

  for (const profile of arrayOrEmpty(report.inboundProvenanceProfiles)) {
    if (profile.score <= 0) continue;
    if (profile.paths.some((path) => highRiskProvenanceLabels.has(path.label))) {
      reasons.push({
        code: "deep_high_risk_inbound_provenance",
        message: "Deep Research found deterministic high-risk inbound provenance.",
        score: Math.max(85, clampScore(profile.score)),
        source: "hard_evidence"
      });
    }
  }

  for (const profile of arrayOrEmpty(report.extendedProvenanceProfiles)) {
    for (const path of profile.paths) {
      if (path.label && path.evidenceStrength === "exact_labeled_path" && highRiskProvenanceLabels.has(path.label)) {
        reasons.push({
          code: "deep_high_risk_extended_provenance",
          message: "Deep Research found exact high-risk extended provenance.",
          score: Math.max(85, clampScore(Math.max(profile.score, path.candidateScore))),
          source: "hard_evidence"
        });
      }
    }
  }

  return reasons;
}

function whereHardEvidenceFloor(report: WhereIsMoneyReport): UnifiedWalletRiskReason | null {
  const top = report.assessment.hardBadEvidence
    .filter((item) => deterministicWhereHardEvidenceKinds.has(item.kind))
    .map((item) => clampScore(item.score))
    .sort((a, b) => b - a)[0];
  if (top === undefined) return null;
  return {
    code: "where_hard_bad_evidence",
    message: "Where Is Money found deterministic hard bad evidence.",
    score: Math.max(85, top),
    source: "hard_evidence"
  };
}

function wherePolicyFloor(report: WhereIsMoneyReport): UnifiedWalletRiskReason | null {
  const policyEvidenceScores = arrayOrEmpty(report.assessment.sourcePolicyEvidence)
    .filter((item) => item.proofLevel === "exchange_policy_decline" || item.score >= 60)
    .map((item) => clampScore(item.score));

  const layerScores = arrayOrEmpty(report.assessment.riskLayers)
    .filter((layerItem) =>
      layerItem.evidenceClass === "source_policy" &&
      (layerItem.proofLevel === "exchange_policy_decline" ||
        Math.max(layerItem.adjustedScore, layerItem.score) >= 60)
    )
    .map((layerItem) => clampScore(Math.max(layerItem.adjustedScore, layerItem.score)));

  const explicitDecline = report.proofLevel === "exchange_policy_decline";
  const candidate = maxScore([
    ...policyEvidenceScores,
    ...layerScores,
    explicitDecline ? report.riskScore : 0
  ]);

  if (candidate <= 0) return null;
  if (!explicitDecline && candidate < 60) return null;

  return {
    code: "where_source_policy_floor",
    message: "Where Is Money found source-policy decline evidence that should not be diluted by layer weights.",
    score: Math.min(84, Math.max(70, candidate)),
    source: "policy_floor"
  };
}

function assetContinuationFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const top = arrayOrEmpty(report?.assetContinuationProfiles)
    .filter((profile) =>
      profile.evidenceClass === "asset_continuation" &&
      profile.tokenQuality !== "unknown" &&
      profile.score >= 65
    )
    .map((profile) => ({
      profile,
      score: Math.min(84, clampScore(profile.score))
    }))
    .sort((left, right) => right.score - left.score)[0] ?? null;

  if (!top) return null;
  return {
    code: "asset_continuation_floor",
    message: top.profile.reasons[0] ?? "Verified TRC20 asset continuation found after USDT movement.",
    score: top.score,
    source: "asset_continuation"
  };
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

function historicalTransitPatternFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const profiles = arrayOrEmpty(report?.operationalFlowProfiles);
  let best: UnifiedWalletRiskReason | null = null;

  for (const profile of profiles) {
    const incomingUsdt = rawUsdtAmount(profile.incomingVolumeRaw);
    const outgoingUsdt = rawUsdtAmount(profile.outgoingVolumeRaw);
    const flowUsdt = Math.max(incomingUsdt, outgoingUsdt);
    if (flowUsdt <= 0 || outgoingUsdt <= 0) continue;

    const volumeFactor = clampRatio(Math.log10(flowUsdt + 1) / 6);
    const passThrough = clampRatio(profile.inflowToOutflowRatio ?? (incomingUsdt > 0 ? outgoingUsdt / incomingUsdt : 0));
    const serviceShare = clampRatio(Math.max(profile.bridgeDexRouterOutgoingRatio, profile.unknownContractOutgoingRatio));
    if (serviceShare < 0.20) continue;

    const score = clampScore(35 + volumeFactor * 20 + passThrough * 20 + serviceShare * 25);

    if (score >= 60 && (!best || score > best.score)) {
      best = {
        code: "historical_transit_pattern",
        message: "Large historical pass-through flow with bridge/swap/router/DEX or unknown-contract exposure.",
        score: Math.min(84, score),
        source: "pattern_floor"
      };
    }
  }

  return best;
}

function routeLinkedApprovalPatternFloor(report: DeepAddressForensicReport | null | undefined): UnifiedWalletRiskReason | null {
  const routeLinked = arrayOrEmpty(report?.approvalDrainProvenanceProfiles)
    .filter((profile) => profile.evidenceStrength === "route_linked")
    .map((profile) => clampScore(profile.score))
    .sort((a, b) => b - a)[0];
  if (routeLinked === undefined || routeLinked < 60) return null;
  return {
    code: "route_linked_approval_pattern",
    message: "Route-linked approval-drain context found without exact approval-drain proof.",
    score: Math.min(80, routeLinked),
    source: "pattern_floor"
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

function coverageFloor(levelValue: UnifiedWalletCoverageLevel): UnifiedWalletRiskReason | null {
  if (levelValue !== "limited") return null;
  return {
    code: "limited_coverage_floor",
    message: "Coverage is too limited to treat the wallet as confidently clean.",
    score: 30,
    source: "coverage"
  };
}

function rawDampener(input: UnifiedWalletRiskInput): UnifiedWalletRiskReason {
  const fastReasons: RiskReason[] = selectedFastReport(input)?.reasons ?? [];
  const fastNegative = fastReasons
    .filter((reason) => reason.scoreImpact < 0)
    .reduce((sum, reason) => sum + Math.abs(reason.scoreImpact), 0);
  const behaviorDampener =
    arrayOrEmpty(input.deepReport?.addressBehaviorProfiles)
      .reduce((max, profile) => Math.max(max, profile.dampenerScore), 0);
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

export function calculateUnifiedWalletRisk(input: UnifiedWalletRiskInput): UnifiedWalletRiskResult {
  const fast = fastLayer(input);
  const deep = deepLayer(input.deepReport);
  const where = whereLayer(input.whereReport);
  const { weightedLayerScore, layerBreakdown } = normalizedWeightedLayers(input, { fast, deep, where });

  const hardReasons = [
    fastHardEvidenceFloor(selectedFastReport(input)),
    ...deepHardEvidenceFloors(input.deepReport),
    whereHardEvidenceFloor(input.whereReport)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const hardEvidenceFloor = maxScore(hardReasons.map((reason) => reason.score));

  const coverage = coverageLevel(input);
  const coverageReason = coverageFloor(coverage);
  const patternReasons = [
    historicalTransitPatternFloor(input.deepReport),
    routeLinkedApprovalPatternFloor(input.deepReport),
    coverageReason
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const patternFloor = maxScore(patternReasons.map((reason) => reason.score));

  const policyReasons = [
    wherePolicyFloor(input.whereReport)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const policyFloor = maxScore(policyReasons.map((reason) => reason.score));

  const assetContinuationReasons = [
    assetContinuationFloor(input.deepReport)
  ].filter((reason): reason is UnifiedWalletRiskReason => reason !== null);
  const assetContinuationFloorScore = maxScore(assetContinuationReasons.map((reason) => reason.score));

  const floorScore = maxScore([
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloorScore,
    patternFloor
  ]);
  const dampenerReason = rawDampener(input);
  const dampener = allowedDampener({
    raw: dampenerReason.score,
    contextScore: weightedLayerScore,
    floorScore
  });
  const contextScore = clampScore(weightedLayerScore - dampener);
  const coverageAdjustedContextScore = coverage === "limited" ? Math.max(contextScore, 30) : contextScore;
  const finalBeforeHardCap = maxScore([coverageAdjustedContextScore, floorScore]);
  const finalScore = hardEvidenceFloor === 0 ? Math.min(finalBeforeHardCap, 84) : finalBeforeHardCap;
  const finalDecision = input.whereReport.userDecision === "DECLINE"
    ? "DECLINE"
    : decisionFromScore(finalScore);

  const floorReasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons
  ];
  const noHardEvidenceCriticalCapApplied = hardEvidenceFloor === 0 && finalBeforeHardCap > finalScore;

  const reasons = [
    ...hardReasons,
    ...policyReasons,
    ...assetContinuationReasons,
    ...patternReasons,
    ...(dampener > 0 ? [{ ...dampenerReason, score: dampener }] : [])
  ].sort((a, b) => b.score - a.score);

  return {
    finalScore,
    finalLevel: levelFromScore(finalScore),
    finalDecision,
    weightedLayerScore,
    contextScore: coverageAdjustedContextScore,
    hardEvidenceFloor,
    policyFloor,
    assetContinuationFloor: assetContinuationFloorScore,
    patternFloor,
    dampener,
    coverageLevel: coverage,
    layerBreakdown,
    reasons,
    scoreBreakdown: {
      weightedLayerScore,
      contextScore: coverageAdjustedContextScore,
      dampener,
      floors: {
        hardEvidence: hardEvidenceFloor,
        policy: policyFloor,
        assetContinuation: assetContinuationFloorScore,
        pattern: patternFloor,
        coverage: coverageReason?.score ?? 0
      },
      activeAnchor: activeAnchorFromReasons(floorReasons),
      noHardEvidenceCriticalCap: {
        applied: noHardEvidenceCriticalCapApplied,
        maxScore: 84
      }
    }
  };
}
