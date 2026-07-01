import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type {
  IncomingFreshBundleExposure,
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
  baseCandidates: MatrixCandidate[];
};

const deterministicWhereHardKinds = new Set(["approval_drain", "scam_or_blacklist", "sanctioned_service"]);

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

function fastHardProofCandidates(report: RiskReport | null | undefined): MatrixCandidate[] {
  if (!report) return [];
  return report.reasons.flatMap((reason) => {
    if (reason.code !== "stablecoin_usdt_blacklisted") return [];
    const id = reason.evidenceRef ?? `fast:${reason.code}`;
    return [candidate({
      row: "hard_proof",
      actionUnit: "wallet",
      score: Math.max(95, reason.scoreImpact),
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

function deepCandidates(report: DeepAddressForensicReport | null | undefined): MatrixCandidate[] {
  if (!report) return [];
  const candidates: MatrixCandidate[] = [];

  for (const profile of arrayOrEmpty(report.approvalDrainProvenanceProfiles)) {
    const exact = profile.evidenceStrength === "exact_approval_and_transfer_from";
    candidates.push(candidate({
      row: exact ? "hard_proof" : "route_linked_approval_pattern",
      actionUnit: "transaction",
      score: exact ? Math.max(90, profile.score) : Math.min(80, profile.score),
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

  for (const profile of arrayOrEmpty(report.assetContinuationProfiles)) {
    if (profile.evidenceClass !== "asset_continuation" || profile.tokenQuality === "unknown" || profile.score < 65) continue;
    candidates.push(candidate({
      row: "asset_continuation",
      actionUnit: "transaction",
      score: Math.min(84, profile.score),
      decisionEligibility: "review_only",
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
    if (profile.historicalTransitScore < 60) continue;
    candidates.push(candidate({
      row: "service_linked_pattern",
      actionUnit: "wallet",
      score: Math.min(84, profile.historicalTransitScore),
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

  return candidates;
}

function whereCandidates(report: WhereIsMoneyReport): MatrixCandidate[] {
  const candidates: MatrixCandidate[] = [];

  for (const item of report.assessment.hardBadEvidence) {
    if (!deterministicWhereHardKinds.has(item.kind)) continue;
    const ids = evidenceIds(item.evidenceIds, `where_hard:${item.kind}`);
    candidates.push(candidate({
      row: "hard_proof",
      actionUnit: "source_path",
      score: Math.max(90, item.score),
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

  candidates.push(...report.assessment.sourcePolicyEvidence.map(sourcePolicyCandidate));

  if (report.coverage.partial || report.coverage.fetchedAddressCount <= 1) {
    candidates.push(coverageCandidate("coverage:where_partial"));
  }

  return candidates;
}

export function buildWalletMatrixCandidates(input: WalletMatrixCandidateInput): MatrixCandidate[] {
  const candidates = [
    ...fastHardProofCandidates(input.fastReport),
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
      score: 55,
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

  return candidates;
}
