import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import { calculateHistoricalTransitBreakdown } from "../forensics/historicalTransitScore";
import type {
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
  RiskLabel,
  RiskReason,
  RiskReport,
  SourcePolicyEvidence,
  WhereIsMoneyReport
} from "../types";
import type { MatrixCandidate } from "./scoringSignalMatrix";

export type WalletMatrixCandidateInput = {
  address: string;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};

export type IncomingDepositMatrixCandidateInput = {
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  freshBundleExposure?: IncomingFreshBundleExposure | null;
  walletExposureProfile?: IncomingWalletExposureProfile | null;
  baseCandidates: MatrixCandidate[];
};

const deterministicWhereHardKinds = new Set(["approval_drain", "scam_or_blacklist", "sanctioned_service"]);
const highRiskProvenanceLabels = new Set<RiskLabel>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange"
]);
const sourcePolicyProvenanceLabels = new Set<RiskLabel>(["whitebit"]);

function candidate(input: MatrixCandidate): MatrixCandidate {
  return input;
}

function arrayOrEmpty<T>(items: T[] | null | undefined): T[] {
  return items ?? [];
}

function evidenceIds(ids: string[], fallback: string): string[] {
  const cleaned = ids.filter((id) => id.trim().length > 0);
  return cleaned.length > 0 ? cleaned : [fallback];
}

function contextScore(value: number, max = 59): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function coverageCandidate(reason: string): MatrixCandidate {
  return candidate({
    row: "coverage_uncertainty",
    actionUnit: "wallet",
    score: 0,
    decisionEligibility: "insufficient_only",
    evidenceIds: [reason],
    evidenceEpisodeIds: [reason],
    atomicSignals: ["insufficient_coverage"],
    modifiers: [],
    caps: [],
    dampeners: [],
    caveats: [reason]
  });
}

function sourcePolicyCandidate(item: SourcePolicyEvidence): MatrixCandidate {
  const ids = evidenceIds(item.evidenceIds, `source_policy:${item.kind}`);
  return candidate({
    row: "source_policy",
    actionUnit: "source_path",
    score: item.score,
    decisionEligibility: item.proofLevel === "exchange_policy_decline" && item.score >= 60 ? "can_decline" : "review_only",
    evidenceIds: ids,
    evidenceEpisodeIds: ids,
    atomicSignals: [`source_policy_${item.kind}`],
    modifiers: item.topPath ? [`share_${Math.round(item.effectiveShare * 100)}`, `hops_${item.topPath.hops}`] : [`share_${Math.round(item.effectiveShare * 100)}`],
    caps: [],
    dampeners: item.canBeDampened ? ["source_policy_can_be_dampened"] : [],
    caveats: item.warnings
  });
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

function fastHardScore(reason: RiskReason): number {
  if (reason.code === "stablecoin_usdt_blacklisted") return 95;
  if (isFastApprovalDrainHardEvidence(reason.code)) return 95;
  if (isFastExactSelfHardEvidence(reason.code)) {
    return Math.max(90, reason.scoreImpact);
  }
  return Math.max(85, reason.scoreImpact);
}

function fastHardProofCandidates(report: RiskReport | null | undefined): MatrixCandidate[] {
  if (!report) return [];
  return report.reasons.flatMap((reason) => {
    if (
      reason.code !== "stablecoin_usdt_blacklisted" &&
      !isFastApprovalDrainHardEvidence(reason.code) &&
      !isFastExactSelfHardEvidence(reason.code)
    ) {
      return [];
    }
    const id = reason.evidenceRef ?? `fast:${reason.code}`;
    return [candidate({
      row: "hard_proof",
      actionUnit: "wallet",
      score: fastHardScore(reason),
      decisionEligibility: "can_decline",
      evidenceIds: [id],
      evidenceEpisodeIds: [id],
      atomicSignals: [reason.code],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    })];
  });
}

function fastContextCandidates(report: RiskReport | null | undefined): MatrixCandidate[] {
  if (!report || report.score <= 0 || report.reasons.some((reason) => isFastHardEvidenceCode(reason.code))) return [];
  return [candidate({
    row: "behavior_only_prior",
    actionUnit: "wallet",
    score: contextScore(report.score),
    decisionEligibility: "review_only",
    evidenceIds: [`fast_context:${report.subjectAddress}`],
    evidenceEpisodeIds: [`fast_context:${report.subjectAddress}`],
    atomicSignals: report.reasons.map((reason) => reason.code),
    modifiers: [],
    caps: [],
    dampeners: report.reasons
      .filter((reason) => reason.scoreImpact < 0)
      .map((reason) => reason.code),
    caveats: []
  })];
}

function deepCandidates(report: DeepAddressForensicReport | null | undefined): MatrixCandidate[] {
  if (!report) return [];
  const candidates: MatrixCandidate[] = [];

  for (const profile of arrayOrEmpty(report.stablecoinRestrictionProfiles)) {
    if (!profile.isBlacklisted) continue;
    candidates.push(candidate({
      row: "hard_proof",
      actionUnit: "wallet",
      score: 95,
      decisionEligibility: "can_decline",
      evidenceIds: [`stablecoin:${profile.subjectAddress}:${profile.tokenSymbol}`],
      evidenceEpisodeIds: [`stablecoin:${profile.subjectAddress}:${profile.tokenSymbol}`],
      atomicSignals: ["stablecoin_usdt_blacklisted"],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  for (const profile of arrayOrEmpty(report.approvalDrainProvenanceProfiles)) {
    const exact = profile.evidenceStrength === "exact_approval_and_transfer_from";
    candidates.push(candidate({
      row: exact ? "hard_proof" : "route_linked_approval_pattern",
      actionUnit: "transaction",
      score: exact ? 95 : Math.min(80, profile.score),
      decisionEligibility: exact ? "can_decline" : "review_only",
      evidenceIds: [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes],
      evidenceEpisodeIds: [`approval_drain:${profile.drainTxHash}`],
      atomicSignals: [exact ? "approval_drain_exact_transfer_from" : "route_linked_approval_pattern"],
      modifiers: exact ? ["hard_anchor"] : [],
      caps: [],
      dampeners: [],
      caveats: profile.falsePositiveGuards?.map((guard) => guard.code) ?? []
    }));
  }

  for (const profile of arrayOrEmpty(report.inboundProvenanceProfiles)) {
    if (profile.score <= 0 || !profile.paths.some((path) => highRiskProvenanceLabels.has(path.label))) continue;
    const ids = profile.paths.flatMap((path) => path.txHashes);
    candidates.push(candidate({
      row: "hard_proof",
      actionUnit: "source_path",
      score: Math.max(85, profile.score),
      decisionEligibility: "can_decline",
      evidenceIds: evidenceIds(ids, `inbound_provenance:${profile.subjectAddress}`),
      evidenceEpisodeIds: [`inbound_provenance:${profile.subjectAddress}`],
      atomicSignals: ["deep_high_risk_inbound_provenance"],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: profile.boundaryNotes
    }));
  }

  for (const profile of arrayOrEmpty(report.inboundProvenanceProfiles)) {
    const paths = profile.paths.filter((path) => sourcePolicyProvenanceLabels.has(path.label));
    if (paths.length === 0) continue;
    const ids = paths.flatMap((path) => path.txHashes);
    candidates.push(candidate({
      row: "source_policy",
      actionUnit: "source_path",
      score: 70,
      decisionEligibility: "can_decline",
      evidenceIds: evidenceIds(ids, `inbound_source_policy:${profile.subjectAddress}`),
      evidenceEpisodeIds: [`inbound_source_policy:${profile.subjectAddress}`],
      atomicSignals: ["deep_source_policy_inbound_provenance"],
      modifiers: paths.map((path) => `label_${path.label}`),
      caps: [],
      dampeners: [],
      caveats: profile.boundaryNotes
    }));
  }

  for (const profile of arrayOrEmpty(report.extendedProvenanceProfiles)) {
    for (const path of profile.paths) {
      if (!path.label || path.evidenceStrength !== "exact_labeled_path" || !highRiskProvenanceLabels.has(path.label)) continue;
      candidates.push(candidate({
        row: "hard_proof",
        actionUnit: "source_path",
        score: Math.max(85, profile.score, path.candidateScore),
        decisionEligibility: "can_decline",
        evidenceIds: evidenceIds(path.txHashes, `extended_provenance:${profile.subjectAddress}:${path.label}`),
        evidenceEpisodeIds: [`extended_provenance:${profile.subjectAddress}:${path.label}:${path.txHashes.join("|")}`],
        atomicSignals: ["deep_high_risk_extended_provenance"],
        modifiers: ["hard_anchor"],
        caps: [],
        dampeners: [],
        caveats: profile.coverage.stoppedReasons
      }));
    }
  }

  for (const profile of arrayOrEmpty(report.extendedProvenanceProfiles)) {
    for (const path of profile.paths) {
      if (!path.label || path.evidenceStrength !== "exact_labeled_path" || !sourcePolicyProvenanceLabels.has(path.label)) continue;
      candidates.push(candidate({
        row: "source_policy",
        actionUnit: "source_path",
        score: 70,
        decisionEligibility: "can_decline",
        evidenceIds: evidenceIds(path.txHashes, `extended_source_policy:${profile.subjectAddress}:${path.label}`),
        evidenceEpisodeIds: [`extended_source_policy:${profile.subjectAddress}:${path.label}:${path.txHashes.join("|")}`],
        atomicSignals: ["deep_source_policy_extended_provenance"],
        modifiers: [`label_${path.label}`],
        caps: [],
        dampeners: [],
        caveats: profile.coverage.stoppedReasons
      }));
    }
  }

  for (const profile of arrayOrEmpty(report.assetContinuationProfiles)) {
    if (profile.evidenceClass !== "asset_continuation" || profile.tokenQuality === "unknown" || profile.score < 65) continue;
    candidates.push(candidate({
      row: "asset_continuation",
      actionUnit: "transaction",
      score: Math.min(84, profile.score),
      decisionEligibility: "can_decline",
      evidenceIds: [profile.conversionTxHash, profile.outgoingTxHash ?? profile.conversionTxHash],
      evidenceEpisodeIds: [`asset_continuation:${profile.conversionTxHash}`],
      atomicSignals: ["asset_continuation"],
      modifiers: [`token_quality_${profile.tokenQuality}`],
      caps: [],
      dampeners: [],
      caveats: profile.reasons
    }));
  }

  for (const profile of arrayOrEmpty(report.operationalFlowProfiles)) {
    const calculatedBreakdown = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: profile.incomingVolumeRaw,
      outgoingVolumeRaw: profile.outgoingVolumeRaw,
      inflowToOutflowRatio: profile.inflowToOutflowRatio,
      bridgeDexRouterOutgoingRatio: profile.bridgeDexRouterOutgoingRatio,
      unknownContractOutgoingRatio: profile.unknownContractOutgoingRatio
    });
    const storedScore = typeof profile.historicalTransitScore === "number" && Number.isFinite(profile.historicalTransitScore)
      ? profile.historicalTransitScore
      : calculatedBreakdown.score;
    const storedBreakdownScore = profile.historicalTransitBreakdown
      ? profile.historicalTransitBreakdown.eligible ? profile.historicalTransitBreakdown.score : 0
      : calculatedBreakdown.score;
    const score = Math.min(calculatedBreakdown.score, storedScore, storedBreakdownScore);
    if (!calculatedBreakdown.eligible || score < 60) continue;
    candidates.push(candidate({
      row: "service_linked_pattern",
      actionUnit: "wallet",
      score: Math.min(84, score),
      decisionEligibility: "can_decline",
      evidenceIds: [`operational_flow:${profile.subjectAddress}`],
      evidenceEpisodeIds: [`operational_flow:${profile.subjectAddress}`],
      atomicSignals: ["historical_transit_pattern"],
      modifiers: ["service_anchor"],
      caps: [],
      dampeners: [],
      caveats: profile.features.map((feature) => feature.code)
    }));
  }

  for (const profile of arrayOrEmpty(report.serviceExposureProfiles)) {
    const score = contextScore(profile.exposureScore);
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: [`service_exposure:${profile.subjectAddress}`],
      evidenceEpisodeIds: [`service_exposure:${profile.subjectAddress}`],
      atomicSignals: ["deep_service_exposure_context"],
      modifiers: profile.dominantCategory ? [`category_${profile.dominantCategory}`] : [],
      caps: [],
      dampeners: [],
      caveats: profile.features.map((feature) => feature.code)
    }));
  }

  for (const profile of arrayOrEmpty(report.addressBehaviorProfiles)) {
    const score = Math.max(profile.depositThenDrainScore, profile.transitScore);
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "behavior_only_prior",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: [`address_behavior:${profile.subjectAddress}`],
      evidenceEpisodeIds: [`address_behavior:${profile.subjectAddress}`],
      atomicSignals: profile.features.map((feature) => feature.code),
      modifiers: [],
      caps: [],
      dampeners: profile.dampenerScore > 0 ? [`behavior_dampener_${profile.dampenerScore}`] : [],
      caveats: []
    }));
  }

  for (const profile of arrayOrEmpty(report.boundaryExposureProfiles)) {
    const score = contextScore(profile.contextScore, 29);
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: [`boundary_exposure:${profile.subjectAddress}`],
      evidenceEpisodeIds: [`boundary_exposure:${profile.subjectAddress}`],
      atomicSignals: ["deep_service_boundary_context"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: profile.coverage?.stoppedReasons ?? []
    }));
  }

  for (const profile of arrayOrEmpty(report.counterpartyRiskProfiles)) {
    const score = contextScore(profile.score);
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: evidenceIds(profile.txHashes, `counterparty_risk:${profile.counterpartyAddress}`),
      evidenceEpisodeIds: [`counterparty_risk:${profile.counterpartyAddress}`],
      atomicSignals: ["deep_counterparty_risk_context"],
      modifiers: profile.label ? [`label_${profile.label}`] : [],
      caps: [],
      dampeners: [],
      caveats: profile.features.map((feature) => feature.code)
    }));
  }

  for (const profile of arrayOrEmpty(report.walletRoleProfiles)) {
    const score = contextScore(Math.max(...profile.roles.map((role) => role.score), 0));
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "behavior_only_prior",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: [`wallet_role:${profile.subjectAddress}:${profile.primaryRole}`],
      evidenceEpisodeIds: [`wallet_role:${profile.subjectAddress}:${profile.primaryRole}`],
      atomicSignals: [`deep_wallet_role_${profile.primaryRole}`],
      modifiers: [`evidence_strength_${profile.evidenceStrength}`],
      caps: [],
      dampeners: [],
      caveats: profile.features.map((feature) => feature.code)
    }));
  }

  for (const profile of arrayOrEmpty(report.directCounterpartyInteractionProfiles)) {
    const score = contextScore(profile.scoreContribution);
    if (score <= 0) continue;
    candidates.push(candidate({
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
      decisionEligibility: "review_only",
      evidenceIds: evidenceIds(profile.txHashes, `direct_counterparty:${profile.counterpartyAddress}`),
      evidenceEpisodeIds: [`direct_counterparty:${profile.counterpartyAddress}`],
      atomicSignals: [profile.evidenceClass],
      modifiers: profile.serviceCategory ? [`category_${profile.serviceCategory}`] : [],
      caps: [],
      dampeners: profile.skippedReason ? [profile.skippedReason] : [],
      caveats: profile.snapshot.partialNotes
    }));
  }

  return candidates;
}

function positiveRawAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function rawRatio(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const scale = 1_000_000n;
  return Number((numerator * scale) / denominator) / Number(scale);
}

function whereCandidates(report: WhereIsMoneyReport): MatrixCandidate[] {
  const candidates: MatrixCandidate[] = [];

  for (const item of report.assessment.hardBadEvidence) {
    if (!deterministicWhereHardKinds.has(item.kind)) continue;
    const ids = evidenceIds(item.evidenceIds, `where_hard:${item.kind}`);
    candidates.push(candidate({
      row: "hard_proof",
      actionUnit: "source_path",
      score: item.kind === "approval_drain" ? 95 : Math.max(90, item.score),
      decisionEligibility: "can_decline",
      evidenceIds: ids,
      evidenceEpisodeIds: ids,
      atomicSignals: [`where_${item.kind}`],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  for (const item of report.assessment.hardBadEvidence) {
    if (deterministicWhereHardKinds.has(item.kind)) continue;
    if (!item.kind.includes("contract_suspicion")) continue;
    const ids = evidenceIds(item.evidenceIds, `where_contract:${item.kind}`);
    candidates.push(candidate({
      row: "contract_suspicion",
      actionUnit: "source_path",
      score: contextScore(item.score),
      decisionEligibility: "review_only",
      evidenceIds: ids,
      evidenceEpisodeIds: ids,
      atomicSignals: [`where_${item.kind}`],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  candidates.push(...report.assessment.sourcePolicyEvidence.map(sourcePolicyCandidate));

  for (const layer of report.assessment.riskLayers) {
    const score = contextScore(Math.max(layer.adjustedScore, layer.score), 84);
    if (score <= 0) continue;
    if (layer.evidenceClass === "source_policy") {
      const ids = evidenceIds(layer.evidenceIds, `where_layer:${layer.kind}`);
      candidates.push(candidate({
        row: "source_policy",
        actionUnit: "source_path",
        score,
        decisionEligibility: layer.proofLevel === "exchange_policy_decline" && score >= 60 ? "can_decline" : "review_only",
        evidenceIds: ids,
        evidenceEpisodeIds: ids,
        atomicSignals: [`source_policy_${layer.kind}`],
        modifiers: [],
        caps: [],
        dampeners: layer.canBeDampened ? ["source_policy_can_be_dampened"] : [],
        caveats: layer.warnings
      }));
    } else if (layer.evidenceClass === "contract_suspicion") {
      const ids = evidenceIds(layer.evidenceIds, `where_contract:${layer.kind}`);
      candidates.push(candidate({
        row: "contract_suspicion",
        actionUnit: "source_path",
        score: contextScore(score),
        decisionEligibility: "review_only",
        evidenceIds: ids,
        evidenceEpisodeIds: ids,
        atomicSignals: [`where_contract_${layer.kind}`],
        modifiers: [],
        caps: [],
        dampeners: layer.canBeDampened ? ["contract_suspicion_can_be_dampened"] : [],
        caveats: layer.warnings
      }));
    }
  }

  if (
    report.proofLevel === "exchange_policy_decline" &&
    report.riskScore > 0 &&
    (report.decisionReasons.length > 0 || report.assessment.reasons.length > 0 || report.assessment.warnings.length > 0) &&
    !candidates.some((item) => item.row === "source_policy")
  ) {
    candidates.push(candidate({
      row: "source_policy",
      actionUnit: "source_path",
      score: Math.max(70, Math.min(84, Math.round(report.riskScore))),
      decisionEligibility: "can_decline",
      evidenceIds: [`where_policy:${report.subjectAddress}`],
      evidenceEpisodeIds: [`where_policy:${report.subjectAddress}`],
      atomicSignals: ["where_exchange_policy_decline"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: report.assessment.warnings
    }));
  }

  if (report.coverage.partial || report.coverage.fetchedAddressCount <= 1) {
    candidates.push(coverageCandidate("coverage:where_partial"));
  }

  const episode = report.coverage.drainEpisode ?? null;
  if (episode) {
    const fundingRaw = positiveRawAmount(episode.fundingAmountRaw ?? null);
    const outgoingRaw = positiveRawAmount(episode.episodeOutgoingRaw);
    const breakdown = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: fundingRaw.toString(),
      outgoingVolumeRaw: outgoingRaw.toString(),
      inflowToOutflowRatio: rawRatio(outgoingRaw, fundingRaw),
      bridgeDexRouterOutgoingRatio: episode.bridgeOutgoingShare,
      unknownContractOutgoingRatio: 0
    });
    if (breakdown.eligible && breakdown.score >= 60) {
      candidates.push(candidate({
        row: "service_linked_pattern",
        actionUnit: "wallet",
        score: Math.min(84, breakdown.score),
        decisionEligibility: "can_decline",
        evidenceIds: [episode.anchorTxHash, episode.fundingTxHash ?? episode.anchorTxHash, ...episode.outgoingTxHashes],
        evidenceEpisodeIds: [`drain_episode:${episode.anchorTxHash}`],
        atomicSignals: ["where_drain_episode_transit_pattern"],
        modifiers: ["service_anchor"],
        caps: [],
        dampeners: [],
        caveats: []
      }));
    }
  }

  return candidates;
}

export function buildWalletMatrixCandidates(input: WalletMatrixCandidateInput): MatrixCandidate[] {
  const candidates = [
    ...fastHardProofCandidates(input.fastReport),
    ...fastContextCandidates(input.fastReport),
    ...deepCandidates(input.deepReport),
    ...whereCandidates(input.whereReport)
  ];

  const deepSparse = input.deepReport ? (input.deepReport.coverage?.transferEdges ?? 0) < 10 : true;
  if (input.whereReport.coverage.partial && deepSparse) {
    candidates.push(coverageCandidate("coverage:where_and_deep_limited"));
  }

  return candidates;
}

export function buildIncomingDepositMatrixCandidates(input: IncomingDepositMatrixCandidateInput): MatrixCandidate[] {
  const candidates = [...input.baseCandidates];
  const exposure = input.freshBundleExposure;
  const backgroundScore = Math.max(0, Math.min(20, Math.round(input.walletExposureProfile?.scoreContribution ?? 0)));
  if (backgroundScore > 0) {
    candidates.push(candidate({
      row: "behavior_only_prior",
      actionUnit: "incoming_deposit",
      score: backgroundScore,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:wallet_exposure_profile`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:wallet_exposure_profile`],
      atomicSignals: ["incoming_wallet_exposure_profile"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: input.walletExposureProfile?.warnings ?? []
    }));
  }
  if (!exposure) return candidates;

  if (exposure.riskyLabelShare >= 0.1) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:risky_label`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_risky_label_source"],
      modifiers: ["source_policy_anchor"],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  }

  if (exposure.htxHuobiShare >= 0.7) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_source"],
      modifiers: ["source_policy_anchor", `share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  } else if (exposure.htxHuobiShare >= 0.3) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 70,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_source"],
      modifiers: ["source_policy_anchor", `share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  } else if (exposure.htxHuobiShare >= 0.1) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 55,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi_context`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_context"],
      modifiers: [`share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  }

  if (exposure.bridgeRouterDexShare >= 0.5) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 70,
      decisionEligibility: "can_decline",
      evidenceIds: [`incoming:${input.txHash}:bridge_router_dex`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_bridge_router_dex_source"],
      modifiers: ["service_anchor", `share_${Math.round(exposure.bridgeRouterDexShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  }

  if (exposure.unknownContractShare >= 0.5) {
    candidates.push(candidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 45,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:unknown_contract`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_unknown_contract_source"],
      modifiers: [`share_${Math.round(exposure.unknownContractShare * 100)}`],
      caps: ["unknown_contract_cap_59"],
      dampeners: [],
      caveats: exposure.reasons
    }));
  }

  if (exposure.htxHuobiShare > 0 && exposure.htxHuobiShare < 0.1) {
    candidates.push(candidate({
      row: "counterparty_context",
      actionUnit: "incoming_deposit",
      score: 40,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:htx_huobi_corridor`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_htx_huobi_corridor_context"],
      modifiers: [`share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  } else if (exposure.bridgeRouterDexShare > 0 || exposure.unknownContractShare > 0) {
    candidates.push(candidate({
      row: "counterparty_context",
      actionUnit: "incoming_deposit",
      score: 35,
      decisionEligibility: "review_only",
      evidenceIds: [`incoming:${input.txHash}:service_corridor`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_service_corridor_context"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  }

  return candidates;
}
