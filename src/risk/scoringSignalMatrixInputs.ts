import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type { SmartContractCheckReport } from "../check/smartContractCheck";
import { calculateHistoricalTransitBreakdown } from "../forensics/historicalTransitScore";
import type {
  ApprovalDrainProvenanceProfile,
  CounterpartyRiskDirection,
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistFact,
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
  RiskLabel,
  RiskReport,
  SourcePolicyEvidence,
  WhereIsMoneyReport
} from "../types";
import type {
  MatrixCandidate,
  MatrixCandidateContext,
  MatrixEvidenceAuthority
} from "./scoringSignalMatrix";
import { exactFastHardEvidence } from "./fastEvidence";
import {
  isApprovalDrainEvidenceRefBoundToDirectProfile,
  isAuthoritativeDirectApprovalDrainProfile
} from "../forensics/approvalDrainProvenance";
import {
  isAuthoritativeMoneyOriginRiskLabelPath,
  selectedMoneyOriginPathShare
} from "../forensics/moneyOriginAttribution";
import { buildUsddPsmExposure, usddPsmMatrixCandidate } from "./usddPsmExposure";
import {
  exactEightDecimalShare,
  isPersistableUsdtBlacklistTimelineEvent,
  partitionPrincipalTransfersByBlacklistTimeline
} from "../forensics/directHardEvidence";
import { activeSanctionedServicePathEvidence } from "../forensics/provenanceScoring";

export type WalletMatrixCandidateInput = {
  address: string;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
  smartContractReport?: SmartContractCheckReport | null;
};

export type IncomingDepositMatrixCandidateInput = {
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  receiverDeepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
  freshBundleExposure?: IncomingFreshBundleExposure | null;
  walletExposureProfile?: IncomingWalletExposureProfile | null;
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

function candidate(
  context: MatrixCandidateContext,
  authority: MatrixEvidenceAuthority,
  input: Omit<MatrixCandidate, "subject" | "authority">
): MatrixCandidate {
  return {
    ...input,
    subject: {
      decisionScope: context.decisionScope,
      address: context.subjectAddress,
      txHash: context.subjectTxHash
    },
    authority
  };
}

function arrayOrEmpty<T>(items: T[] | null | undefined): T[] {
  return items ?? [];
}

function evidenceIds(ids: string[], fallback: string): string[] {
  const cleaned = ids.filter((id) => id.trim().length > 0);
  return cleaned.length > 0 ? cleaned : [fallback];
}

function approvalDrainEpisodeId(profile: ApprovalDrainProvenanceProfile): string {
  return `approval_drain:${JSON.stringify([
    profile.subjectAddress,
    profile.victimAddress,
    profile.approvalTxHash,
    profile.drainTxHash,
    profile.pathTxHashes,
    profile.pathAddresses
  ])}`;
}

function contextScore(value: number, max = 59): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

const DIRECT_POLICY_ABSOLUTE_RAW = 10_000n * 1_000_000n;
const DIRECT_POLICY_RELATIVE_MIN_RAW = 100n * 1_000_000n;

type DirectPolicyPrincipalTransfer = {
  txHash: string;
  amountRaw: bigint;
  occurredAt: string;
  signature: string;
  identity: string | null;
};

type DirectPolicyProfileBinding = {
  kind: "principal";
  key: string;
  direction: CounterpartyRiskDirection;
  principalAmountRaw: bigint;
  principalTxCount: number;
  scoreContribution: number;
  principalTransfers: DirectPolicyPrincipalTransfer[];
};

type DirectPolicyProfileResult = DirectPolicyProfileBinding | {
  kind: "valid_fee_only";
  direction: CounterpartyRiskDirection;
} | {
  kind: "invalid";
  direction: CounterpartyRiskDirection | null;
};

type DirectPolicyProfileIndex = {
  results: DirectPolicyProfileResult[];
  conflictingPrincipalTxHashes: Set<string>;
};

function directPolicyProfileKey(input: {
  subjectAddress: string;
  counterpartyAddress: string;
  direction: CounterpartyRiskDirection;
  txHashes: string[];
}): string | null {
  if (input.txHashes.some((txHash) => typeof txHash !== "string" || txHash.trim().length === 0)) return null;
  const uniqueHashes = [...new Set(input.txHashes)];
  if (uniqueHashes.length !== input.txHashes.length) return null;
  return [
    input.subjectAddress.trim(),
    input.counterpartyAddress.trim(),
    input.direction,
    ...uniqueHashes.sort((left, right) => left.localeCompare(right))
  ].join(":");
}

function indexedDirectPolicyProfile(
  reportSubjectAddress: string,
  profile: DirectCounterpartyInteractionProfile
): DirectPolicyProfileResult {
  const direction = profile.direction === "inbound" || profile.direction === "outbound"
    ? profile.direction
    : null;
  if (
    direction === null ||
    !sameAddress(profile.subjectAddress, reportSubjectAddress) ||
    !Number.isFinite(profile.scoreContribution) ||
    profile.scoreContribution < 0 ||
    profile.scoreContribution > 100 ||
    !Array.isArray(profile.transfers) ||
    profile.transfers.length === 0
  ) return { kind: "invalid", direction };

  const principalTransfers: DirectPolicyPrincipalTransfer[] = [];
  const profileMovementTxHashes: string[] = [];
  let profileAmountRaw = 0n;
  let hasValidFee = false;
  const exactIdentities = new Set<string>();
  const richSignatures = new Set<string>();
  const legacySignatures = new Set<string>();
  for (const transfer of profile.transfers) {
    if (
      !transfer ||
      typeof transfer.txHash !== "string" ||
      transfer.txHash.trim().length === 0 ||
      typeof transfer.amountRaw !== "string" ||
      !/^(0|[1-9]\d*)$/.test(transfer.amountRaw) ||
      typeof transfer.timestamp !== "string" ||
      !Number.isFinite(Date.parse(transfer.timestamp)) ||
      (transfer.economicRole !== undefined &&
        transfer.economicRole !== "principal" &&
        transfer.economicRole !== "service_fee") ||
      (transfer.transferId !== undefined && transfer.transferId !== null &&
        (typeof transfer.transferId !== "string" || transfer.transferId.trim().length === 0)) ||
      (transfer.eventIndex !== undefined && transfer.eventIndex !== null &&
        (!Number.isSafeInteger(transfer.eventIndex) || transfer.eventIndex < 0)) ||
      (transfer.provider !== undefined && transfer.provider !== null &&
        (typeof transfer.provider !== "string" || transfer.provider.trim().length === 0)) ||
      (transfer.providerRowOrdinalInTx !== undefined && transfer.providerRowOrdinalInTx !== null &&
        (!Number.isSafeInteger(transfer.providerRowOrdinalInTx) || transfer.providerRowOrdinalInTx < 0))
    ) return { kind: "invalid", direction };
    const txHash = transfer.txHash.trim();
    const occurredAt = new Date(transfer.timestamp).toISOString();
    const endpointsMatch = direction === "inbound"
      ? sameAddress(transfer.fromAddress, profile.counterpartyAddress) &&
        sameAddress(transfer.toAddress, profile.subjectAddress)
      : sameAddress(transfer.fromAddress, profile.subjectAddress) &&
        sameAddress(transfer.toAddress, profile.counterpartyAddress);
    if (!endpointsMatch) return { kind: "invalid", direction };
    const amountRaw = BigInt(transfer.amountRaw);
    const isFee = transfer.economicRole === "service_fee";
    if (isFee && transfer.economicProtocol !== "tron_gasfree") {
      return { kind: "invalid", direction };
    }
    const movementSignature = JSON.stringify({
      txHash,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      amountRaw: transfer.amountRaw,
      timestamp: occurredAt,
      method: transfer.method,
      edgeType: transfer.edgeType,
      economicRole: transfer.economicRole ?? null,
      economicProtocol: transfer.economicProtocol ?? null
    });
    const transferId = transfer.transferId?.trim() || null;
    const provider = transfer.provider?.trim() || null;
    const movementIdentity = transferId
      ? `transfer:${transferId}`
      : transfer.eventIndex !== null && transfer.eventIndex !== undefined
        ? `event:${txHash}:${transfer.eventIndex}`
        : provider && transfer.providerRowOrdinalInTx !== null && transfer.providerRowOrdinalInTx !== undefined
          ? `provider:${provider}:${txHash}:${transfer.providerRowOrdinalInTx}`
          : null;
    if (movementIdentity) {
      if (exactIdentities.has(movementIdentity) || legacySignatures.has(movementSignature)) {
        return { kind: "invalid", direction };
      }
      exactIdentities.add(movementIdentity);
      richSignatures.add(movementSignature);
    } else {
      if (legacySignatures.has(movementSignature) || richSignatures.has(movementSignature)) {
        return { kind: "invalid", direction };
      }
      legacySignatures.add(movementSignature);
    }
    profileAmountRaw += amountRaw;
    profileMovementTxHashes.push(txHash);
    if (isFee) {
      hasValidFee = true;
      continue;
    }
    if (amountRaw === 0n) continue;
    principalTransfers.push({
      txHash,
      amountRaw,
      occurredAt,
      signature: movementSignature,
      identity: movementIdentity
    });
  }
  if (
    !/^(0|[1-9]\d*)$/.test(profile.volumeRaw) ||
    BigInt(profile.volumeRaw) !== profileAmountRaw ||
    profile.txCount !== profileMovementTxHashes.length ||
    !Array.isArray(profile.txHashes) ||
    profile.txHashes.length !== profileMovementTxHashes.length ||
    profile.txHashes.some((txHash, index) =>
      typeof txHash !== "string" || txHash.trim() !== profileMovementTxHashes[index]
    )
  ) return { kind: "invalid", direction };
  if (principalTransfers.length === 0) {
    return hasValidFee
      ? { kind: "valid_fee_only", direction }
      : { kind: "invalid", direction };
  }

  const principalTxHashes = [...new Set(principalTransfers.map((transfer) => transfer.txHash))];
  const key = directPolicyProfileKey({
    subjectAddress: profile.subjectAddress,
    counterpartyAddress: profile.counterpartyAddress,
    direction: profile.direction,
    txHashes: principalTxHashes
  });
  if (key === null) return { kind: "invalid", direction };
  return {
    kind: "principal",
    key,
    direction,
    principalAmountRaw: principalTransfers.reduce((sum, transfer) => sum + transfer.amountRaw, 0n),
    principalTxCount: principalTxHashes.length,
    scoreContribution: profile.scoreContribution,
    principalTransfers
  };
}

function buildDirectPolicyProfileIndex(report: DeepAddressForensicReport): DirectPolicyProfileIndex {
  const results: DirectPolicyProfileResult[] = [];
  const timestampsByTxHash = new Map<string, string>();
  const conflictingPrincipalTxHashes = new Set<string>();
  for (const profile of arrayOrEmpty(report.directCounterpartyInteractionProfiles)) {
    const result = indexedDirectPolicyProfile(report.subjectAddress, profile);
    results.push(result);
    if (result.kind !== "principal") continue;
    for (const transfer of result.principalTransfers) {
      const previous = timestampsByTxHash.get(transfer.txHash);
      if (previous !== undefined && previous !== transfer.occurredAt) {
        conflictingPrincipalTxHashes.add(transfer.txHash);
      } else {
        timestampsByTxHash.set(transfer.txHash, transfer.occurredAt);
      }
    }
  }
  return { results, conflictingPrincipalTxHashes };
}

function selectedDirectPolicyProfile(
  reportSubjectAddress: string,
  fact: FirstHopBlacklistFact,
  profileIndex: DirectPolicyProfileIndex
): { binding: DirectPolicyProfileBinding; denominator: bigint } | null {
  const sameDirection = profileIndex.results.filter((result) => result.direction === fact.direction);
  if (sameDirection.some((result) => result.kind === "invalid")) return null;
  const principal = sameDirection.filter((result): result is DirectPolicyProfileBinding => result.kind === "principal");
  const keys = new Set<string>();
  const exactIdentities = new Set<string>();
  const richSignatures = new Set<string>();
  const legacySignatures = new Set<string>();
  let denominator = 0n;
  for (const binding of principal) {
    if (keys.has(binding.key)) return null;
    keys.add(binding.key);
    denominator += binding.principalAmountRaw;
    for (const transfer of binding.principalTransfers) {
      if (transfer.identity) {
        if (exactIdentities.has(transfer.identity) || legacySignatures.has(transfer.signature)) return null;
        exactIdentities.add(transfer.identity);
        richSignatures.add(transfer.signature);
      } else {
        if (legacySignatures.has(transfer.signature) || richSignatures.has(transfer.signature)) return null;
        legacySignatures.add(transfer.signature);
      }
    }
  }
  const key = directPolicyProfileKey({
    subjectAddress: reportSubjectAddress,
    counterpartyAddress: fact.counterpartyAddress,
    direction: fact.direction,
    txHashes: fact.transferTxHashes
  });
  if (key === null || fact.principalTxCount !== fact.transferTxHashes.length) return null;
  const principalAmountRaw = BigInt(fact.principalAmountRaw);
  const bindings = principal.filter((binding) =>
    binding.key === key &&
    binding.principalAmountRaw === principalAmountRaw &&
    binding.principalTxCount === fact.principalTxCount
  );
  return bindings.length === 1 ? { binding: bindings[0], denominator } : null;
}

function directCounterpartyPolicyCandidate(
  context: MatrixCandidateContext,
  report: DeepAddressForensicReport,
  profileIndex: DirectPolicyProfileIndex,
  fact: FirstHopBlacklistFact,
  actionUnit: "wallet" | "incoming_deposit",
  requiredActiveTxHash?: string
): MatrixCandidate | null {
  if (
    fact.evidenceKind !== "usdt_blacklist" ||
    fact.evidenceAuthority !== "official_contract" ||
    fact.statusAtCheck !== "active" ||
    (fact.temporalRelation !== "active_at_transfer" && fact.temporalRelation !== "mixed") ||
    fact.timelineCoverage !== "complete" ||
    fact.directTransferCoverage !== "complete" ||
    fact.shareSemantics !== "exact" ||
    typeof fact.directionalPrincipalShare !== "number" ||
    !/^(0|[1-9]\d*)$/.test(fact.principalAmountRaw) ||
    BigInt(fact.principalAmountRaw) <= 0n ||
    fact.principalTxCount <= 0 ||
    fact.transferTxHashes.length === 0
  ) return null;

  if (!fact.timelineEvents.every(isPersistableUsdtBlacklistTimelineEvent)) return null;
  const timelineEvents = [...fact.timelineEvents].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    (left.blockNumber ?? Number.MAX_SAFE_INTEGER) - (right.blockNumber ?? Number.MAX_SAFE_INTEGER) ||
    (left.logIndex ?? Number.MAX_SAFE_INTEGER) - (right.logIndex ?? Number.MAX_SAFE_INTEGER) ||
    left.txHash.localeCompare(right.txHash)
  );
  const finalEvent = timelineEvents.at(-1);
  if (
    !finalEvent ||
    finalEvent.eventKind !== "added" ||
    finalEvent.txHash !== fact.effectiveTxHash ||
    finalEvent.occurredAt !== fact.effectiveAt
  ) return null;
  const selected = selectedDirectPolicyProfile(report.subjectAddress, fact, profileIndex);
  if (!selected || selected.denominator <= 0n) return null;
  const principalAmountRaw = BigInt(fact.principalAmountRaw);
  if (selected.denominator < principalAmountRaw) return null;
  if (
    fact.directionalPrincipalShare !== exactEightDecimalShare(principalAmountRaw, selected.denominator) ||
    (fact.directionalPrincipalTotalRaw !== undefined &&
      (!/^[1-9]\d*$/.test(fact.directionalPrincipalTotalRaw) || BigInt(fact.directionalPrincipalTotalRaw) !== selected.denominator)) ||
    (fact.temporalRelation === "mixed" && fact.directionalPrincipalTotalRaw === undefined)
  ) return null;
  const partition = partitionPrincipalTransfersByBlacklistTimeline({
    principalTransfers: selected.binding.principalTransfers,
    timeline: { events: timelineEvents, pagination: "complete", failureReason: null },
    conflictingTxHashes: profileIndex.conflictingPrincipalTxHashes
  });
  if (
    partition.temporalRelation !== fact.temporalRelation ||
    partition.before.amountRaw.toString() !== fact.beforeEffectiveAmountRaw ||
    partition.before.txHashes.length !== fact.beforeEffectiveTxCount ||
    partition.active.amountRaw.toString() !== fact.activeAmountRaw ||
    partition.active.txHashes.length !== fact.activeTxCount ||
    partition.unknown.amountRaw.toString() !== fact.unknownTimingAmountRaw ||
    partition.unknown.txHashes.length !== fact.unknownTimingTxCount ||
    (fact.temporalRelation === "active_at_transfer" && (
      partition.active.amountRaw !== principalAmountRaw ||
      partition.active.txHashes.length !== fact.principalTxCount
    )) ||
    (requiredActiveTxHash !== undefined && !partition.active.txHashes.includes(requiredActiveTxHash.trim()))
  ) return null;
  const activeAmountRaw = partition.active.amountRaw;
  const absoluteMaterial = activeAmountRaw >= DIRECT_POLICY_ABSOLUTE_RAW;
  const relativeMaterial = activeAmountRaw >= DIRECT_POLICY_RELATIVE_MIN_RAW &&
    activeAmountRaw * 100n >= selected.denominator;
  if (!absoluteMaterial && !relativeMaterial) return null;

  const currentStateId = `usdt_blacklist_state:${fact.counterpartyAddress}:${fact.checkedAt}`;
  const ids = [...new Set([
    ...partition.active.txHashes,
    finalEvent.txHash,
    currentStateId
  ])].sort((left, right) => left.localeCompare(right));
  const profileScore = selected.binding.scoreContribution;
  const mixed = fact.temporalRelation === "mixed";
  return candidate(context, {
    kind: "policy",
    decisionEligibility: "can_decline",
    coverageDependency: "none"
  }, {
    row: "direct_counterparty_policy",
    actionUnit,
    score: mixed ? 60 : Math.max(60, Math.min(90, Math.round(profileScore))),
    evidenceIds: ids,
    evidenceEpisodeIds: [`direct_counterparty_policy:${fact.direction}:${fact.counterpartyAddress}`],
    atomicSignals: ["direct_counterparty_current_usdt_blacklist"],
    modifiers: [`direction_${fact.direction}`, `blacklist_timing_${fact.temporalRelation}`],
    caps: !mixed && profileScore > 90 ? ["direct_counterparty_policy_cap_90"] : [],
    dampeners: [],
    caveats: []
  });
}

function walletDirectCounterpartyPolicyCandidates(
  context: MatrixCandidateContext,
  report: DeepAddressForensicReport | null | undefined
): MatrixCandidate[] {
  if (!report || !sameAddress(report.subjectAddress, context.subjectAddress)) return [];
  const profileIndex = buildDirectPolicyProfileIndex(report);
  return arrayOrEmpty(report.firstHopBlacklistFacts)
    .map((fact) => directCounterpartyPolicyCandidate(context, report, profileIndex, fact, "wallet"))
    .filter((item): item is MatrixCandidate => item !== null);
}

function incomingDirectCounterpartyPolicyCandidates(
  context: MatrixCandidateContext,
  input: Pick<IncomingDepositMatrixCandidateInput, "senderAddress" | "receiverAddress" | "txHash" | "receiverDeepReport">
): MatrixCandidate[] {
  const report = input.receiverDeepReport;
  if (!report || !sameAddress(report.subjectAddress, input.receiverAddress)) return [];
  const profileIndex = buildDirectPolicyProfileIndex(report);
  return arrayOrEmpty(report.firstHopBlacklistFacts)
    .filter((fact) =>
      fact.direction === "inbound" &&
      sameAddress(fact.counterpartyAddress, input.senderAddress) &&
      fact.transferTxHashes.includes(input.txHash)
    )
    .map((fact) => directCounterpartyPolicyCandidate(context, report, profileIndex, fact, "incoming_deposit", input.txHash))
    .filter((item): item is MatrixCandidate => item !== null)
    .map((item) => ({
      ...item,
      modifiers: [...item.modifiers, `deposit_receiver_${input.receiverAddress}`]
    }));
}

function coverageCandidate(context: MatrixCandidateContext, reason: string): MatrixCandidate {
  return candidate(context, { kind: "coverage", coverageDependency: context.requiredCoverage }, {
    row: "coverage_uncertainty",
    actionUnit: context.decisionScope === "incoming_unified" ? "incoming_deposit" : "wallet",
    score: 0,
    evidenceIds: [reason],
    evidenceEpisodeIds: [reason],
    atomicSignals: ["insufficient_coverage"],
    modifiers: [],
    caps: [],
    dampeners: [],
    caveats: [reason]
  });
}

function sourcePolicyCandidate(
  context: MatrixCandidateContext,
  item: SourcePolicyEvidence,
  sanctionsAuthorized = true
): MatrixCandidate {
  const ids = evidenceIds(item.evidenceIds, `source_policy:${item.kind}`);
  if (item.kind === "sanctioned_service" && !sanctionsAuthorized) {
    return candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "source_path",
      score: contextScore(item.score),
      evidenceIds: ids,
      evidenceEpisodeIds: ids,
      atomicSignals: ["source_policy_sanctioned_service_context"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: item.warnings
    });
  }
  const decisionEligibility = item.proofLevel === "exchange_policy_decline" && item.score >= 60
    ? "can_decline" as const
    : "review_only" as const;
  return candidate(context, { kind: "policy", decisionEligibility, coverageDependency: context.requiredCoverage }, {
    row: "source_policy",
    actionUnit: "source_path",
    score: item.score,
    evidenceIds: ids,
    evidenceEpisodeIds: ids,
    atomicSignals: [`source_policy_${item.kind}`],
    modifiers: item.topPath ? [`share_${Math.round(item.effectiveShare * 100)}`, `hops_${item.topPath.hops}`] : [`share_${Math.round(item.effectiveShare * 100)}`],
    caps: [],
    dampeners: item.canBeDampened ? ["source_policy_can_be_dampened"] : [],
    caveats: item.warnings
  });
}

function fastHardProofCandidates(
  context: MatrixCandidateContext,
  report: RiskReport | null | undefined,
  input: Pick<WalletMatrixCandidateInput, "deepReport" | "whereReport">
): MatrixCandidate[] {
  const profiles = [
    ...arrayOrEmpty(input.whereReport.approvalDrainProvenanceProfiles),
    ...arrayOrEmpty(input.deepReport?.approvalDrainProvenanceProfiles)
  ];
  const authorized = exactFastHardEvidence(report).filter((item) =>
    item.code !== "forensic_approval_drain_provenance" ||
    isApprovalDrainEvidenceRefBoundToDirectProfile({
      checkedSubjectAddress: context.subjectAddress,
      evidenceRef: item.evidenceId,
      profiles,
      rawEvidence: input.deepReport?.rawEvidence,
      observations: input.deepReport?.observations
    })
  );
  return authorized.map((item) => candidate(
    context,
    { kind: "exact_hard", proofSource: "fast_exact_code" },
    {
      row: item.code === "stablecoin_usdt_blacklisted" ? "subject_restriction" : "hard_proof",
      actionUnit: "wallet",
      score: item.score,
      evidenceIds: [item.evidenceId],
      evidenceEpisodeIds: [item.evidenceId],
      atomicSignals: [item.code],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    }
  ));
}

function sameAddress(left: string | null | undefined, right: string): boolean {
  return (left ?? "") === right;
}

function fastContextCandidates(
  context: MatrixCandidateContext,
  report: RiskReport | null | undefined,
  hasAuthorizedHardEvidence: boolean
): MatrixCandidate[] {
  if (!report || report.score <= 0 || hasAuthorizedHardEvidence) return [];
  return [candidate(context, { kind: "context" }, {
    row: "behavior_only_prior",
    actionUnit: "wallet",
    score: contextScore(report.score),
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

function deepCandidates(
  context: MatrixCandidateContext,
  report: DeepAddressForensicReport | null | undefined,
  whereReport: WhereIsMoneyReport,
  incomingTxHash: string | null = null
): MatrixCandidate[] {
  if (!report) return [];
  const candidates: MatrixCandidate[] = [];
  const isIncomingLinked = (ids: string[]): boolean =>
    evidenceLinkedToIncoming(whereReport, ids, incomingTxHash);

  for (const observation of arrayOrEmpty(report.usddPsmRouteObservations)) {
    if (observation.mode !== "deep_history") continue;
    const exposure = buildUsddPsmExposure(observation);
    if (!exposure) continue;
    candidates.push(usddPsmMatrixCandidate({ exposure, context }));
  }

  for (const profile of arrayOrEmpty(report.stablecoinRestrictionProfiles)) {
    if (!profile.isBlacklisted || !sameAddress(profile.subjectAddress, context.subjectAddress)) continue;
    candidates.push(candidate(context, { kind: "exact_hard", proofSource: "stablecoin_restriction" }, {
      row: "subject_restriction",
      actionUnit: "wallet",
      score: 95,
      evidenceIds: [`stablecoin:${profile.subjectAddress}:${profile.tokenSymbol}`],
      evidenceEpisodeIds: [`stablecoin:${profile.subjectAddress}:${profile.tokenSymbol}`],
      atomicSignals: ["stablecoin_usdt_blacklisted"],
      modifiers: ["hard_anchor"],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  if (context.decisionScope !== "incoming_unified") {
    candidates.push(...walletDirectCounterpartyPolicyCandidates(context, report));
  }

  for (const profile of arrayOrEmpty(report.approvalDrainProvenanceProfiles)) {
    const ids = [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes];
    const exact = isAuthoritativeDirectApprovalDrainProfile(profile, context.subjectAddress) &&
      isIncomingLinked(ids);
    const authority: MatrixEvidenceAuthority = exact
      ? { kind: "exact_hard", proofSource: "approval_drain_exact" }
      : profile.evidenceStrength === "route_linked"
        ? { kind: "pattern", decisionEligibility: "review_only", coverageDependency: context.requiredCoverage }
        : { kind: "context" };
    candidates.push(candidate(context, authority, {
      row: exact ? "hard_proof" : profile.evidenceStrength === "route_linked" ? "route_linked_approval_pattern" : "counterparty_context",
      actionUnit: "transaction",
      score: exact
        ? 95
        : profile.evidenceStrength === "route_linked"
          ? Math.min(80, profile.score)
          : contextScore(profile.score),
      evidenceIds: ids,
      evidenceEpisodeIds: [approvalDrainEpisodeId(profile)],
      atomicSignals: [exact ? "approval_drain_exact_transfer_from" : profile.evidenceStrength === "route_linked" ? "route_linked_approval_pattern" : "historical_approval_drain_context"],
      modifiers: exact ? ["hard_anchor"] : [],
      caps: [],
      dampeners: [],
      caveats: profile.falsePositiveGuards?.map((guard) => guard.code) ?? []
    }));
  }

  for (const profile of arrayOrEmpty(report.inboundProvenanceProfiles)) {
    if (profile.score <= 0 || !profile.paths.some((path) => highRiskProvenanceLabels.has(path.label))) continue;
    const ids = profile.paths.flatMap((path) => path.txHashes);
    const walletPattern = incomingTxHash === null;
    candidates.push(candidate(context, walletPattern
      ? { kind: "pattern", decisionEligibility: "can_decline", coverageDependency: context.requiredCoverage }
      : { kind: "context" }, {
      row: walletPattern ? "service_linked_pattern" : "counterparty_context",
      actionUnit: "source_path",
      score: walletPattern ? Math.max(85, profile.score) : contextScore(profile.score),
      evidenceIds: evidenceIds(ids, `inbound_provenance:${profile.subjectAddress}`),
      evidenceEpisodeIds: [`inbound_provenance:${profile.subjectAddress}`],
      atomicSignals: ["deep_high_risk_inbound_provenance"],
      modifiers: walletPattern ? ["service_anchor"] : [],
      caps: [],
      dampeners: [],
      caveats: profile.boundaryNotes
    }));
  }

  for (const profile of arrayOrEmpty(report.inboundProvenanceProfiles)) {
    const paths = profile.paths.filter((path) => sourcePolicyProvenanceLabels.has(path.label));
    if (paths.length === 0) continue;
    const groups = [
      { linked: true, paths: paths.filter((path) => isIncomingLinked(path.txHashes)) },
      { linked: false, paths: paths.filter((path) => !isIncomingLinked(path.txHashes)) }
    ];
    for (const group of groups) {
      if (group.paths.length === 0) continue;
      const ids = group.paths.flatMap((path) => path.txHashes);
      candidates.push(candidate(context, group.linked
        ? {
            kind: "policy",
            decisionEligibility: "can_decline",
            coverageDependency: context.requiredCoverage
          }
        : { kind: "context" }, {
        row: group.linked ? "source_policy" : "counterparty_context",
        actionUnit: "source_path",
        score: group.linked ? 70 : contextScore(70),
        evidenceIds: evidenceIds(ids, `inbound_source_policy:${profile.subjectAddress}`),
        evidenceEpisodeIds: [`inbound_source_policy:${profile.subjectAddress}${group.linked ? "" : ":context"}`],
        atomicSignals: ["deep_source_policy_inbound_provenance"],
        modifiers: group.paths.map((path) => `label_${path.label}`),
        caps: [],
        dampeners: [],
        caveats: profile.boundaryNotes
      }));
    }
  }

  for (const profile of arrayOrEmpty(report.extendedProvenanceProfiles)) {
    for (const path of profile.paths) {
      if (!path.label || path.evidenceStrength !== "exact_labeled_path" || !highRiskProvenanceLabels.has(path.label)) continue;
      const exact = isIncomingLinked(path.txHashes);
      candidates.push(candidate(context, exact
        ? { kind: "exact_hard", proofSource: "exact_labeled_path" }
        : { kind: "context" }, {
        row: exact ? "hard_proof" : "counterparty_context",
        actionUnit: "source_path",
        score: exact ? Math.max(85, profile.score, path.candidateScore) : contextScore(Math.max(profile.score, path.candidateScore)),
        evidenceIds: evidenceIds(path.txHashes, `extended_provenance:${profile.subjectAddress}:${path.label}`),
        evidenceEpisodeIds: [`extended_provenance:${profile.subjectAddress}:${path.label}:${path.txHashes.join("|")}`],
        atomicSignals: ["deep_high_risk_extended_provenance"],
        modifiers: exact ? ["hard_anchor"] : [],
        caps: [],
        dampeners: [],
        caveats: profile.coverage.stoppedReasons
      }));
    }
  }

  for (const profile of arrayOrEmpty(report.extendedProvenanceProfiles)) {
    for (const path of profile.paths) {
      if (!path.label || path.evidenceStrength !== "exact_labeled_path" || !sourcePolicyProvenanceLabels.has(path.label)) continue;
      const linked = isIncomingLinked(path.txHashes);
      candidates.push(candidate(context, linked
        ? {
            kind: "policy",
            decisionEligibility: "can_decline",
            coverageDependency: context.requiredCoverage
          }
        : { kind: "context" }, {
        row: linked ? "source_policy" : "counterparty_context",
        actionUnit: "source_path",
        score: linked ? 70 : contextScore(70),
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
    const ids = [profile.conversionTxHash, profile.outgoingTxHash ?? profile.conversionTxHash];
    const linked = isIncomingLinked(ids);
    candidates.push(candidate(context, linked
      ? {
          kind: "pattern",
          decisionEligibility: "can_decline",
          coverageDependency: context.requiredCoverage
        }
      : { kind: "context" }, {
      row: linked ? "asset_continuation" : "counterparty_context",
      actionUnit: "transaction",
      score: linked ? Math.min(84, profile.score) : contextScore(profile.score),
      evidenceIds: ids,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "behavior_only_prior",
      actionUnit: "wallet",
      score: 35,
      evidenceIds: [`operational_flow:${profile.subjectAddress}`],
      evidenceEpisodeIds: [`operational_flow:${profile.subjectAddress}`],
      atomicSignals: ["collector_transit_behavior"],
      modifiers: [],
      caps: ["collector_only_cap_35"],
      dampeners: [],
      caveats: profile.features.map((feature) => feature.code)
    }));
  }

  for (const profile of arrayOrEmpty(report.serviceExposureProfiles)) {
    const score = contextScore(profile.exposureScore);
    if (score <= 0) continue;
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "behavior_only_prior",
      actionUnit: "wallet",
      score,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "behavior_only_prior",
      actionUnit: "wallet",
      score,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "wallet",
      score,
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

const belowMaterialityOutcomes = new Set([
  "residual_unresolved_below_materiality",
  "dense_hop_unresolved_below_materiality"
]);

function hasBelowMaterialityCaveat(report: WhereIsMoneyReport): boolean {
  const outcome = report.sourceProvenanceMateriality?.outcome ??
    report.assessment.sourceProvenanceMateriality?.outcome ?? null;
  return report.scoreValid === true && outcome !== null && belowMaterialityOutcomes.has(outcome);
}

function evidenceLinkedToIncoming(
  report: WhereIsMoneyReport,
  evidenceIds: string[],
  incomingTxHash: string | null
): boolean {
  if (incomingTxHash === null) return true;
  if (evidenceIds.includes(incomingTxHash)) return true;
  if (report.originPaths
    .filter((path) => path.txHashes.includes(incomingTxHash))
    .some((path) => evidenceIds.some((id) => path.txHashes.includes(id)))) {
    return true;
  }
  return report.crossChainCorridor?.paths.some((path) =>
    path.balanceTransferTxHashes.includes(incomingTxHash) &&
    [
      ...path.riskLayer.evidenceIds,
      ...(path.sourcePolicyEvidence?.evidenceIds ?? [])
    ].some((id) => evidenceIds.includes(id))
  ) ?? false;
}

function whereReportLinkedToIncoming(report: WhereIsMoneyReport, incomingTxHash: string): boolean {
  return report.balanceFormingTransfers.some((transfer) => transfer.txHash === incomingTxHash) ||
    report.originPaths.some((path) => path.txHashes.includes(incomingTxHash));
}

function whereRiskyLabelEvidenceAuthorized(
  report: WhereIsMoneyReport,
  evidenceIdsToCheck: string[],
  fastReport: RiskReport | null
): boolean {
  const requested = new Set(evidenceIdsToCheck.filter((id) => id.trim().length > 0));
  if (requested.size === 0) return false;
  const pathAuthorized = report.originPaths
    .filter(isAuthoritativeMoneyOriginRiskLabelPath)
    .some((path) => [path.balanceTransferTxHash, ...path.txHashes, ...path.steps.map((step) => step.txHash)]
      .some((id) => requested.has(id)));
  if (pathAuthorized) return true;
  const explicitlyReferencedFastEvidence = new Set((fastReport?.reasons ?? [])
    .map((reason) => reason.evidenceRef?.trim() ?? "")
    .filter((evidenceRef) => evidenceRef.length > 0));
  return exactFastHardEvidence(fastReport).some((item) =>
    item.code !== "forensic_approval_drain_provenance" &&
    explicitlyReferencedFastEvidence.has(item.evidenceId) &&
    requested.has(item.evidenceId)
  );
}

function hasExactWhereHardProof(
  context: MatrixCandidateContext,
  report: WhereIsMoneyReport,
  kind: string,
  evidenceIdsToCheck: string[],
  fastReport: RiskReport | null
): boolean {
  if (kind === "scam_or_blacklist") {
    return whereRiskyLabelEvidenceAuthorized(report, evidenceIdsToCheck, fastReport);
  }
  if (kind !== "approval_drain") return false;
  return report.approvalDrainProvenanceProfiles.some((profile) => {
    const profileIds = [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes];
    return isAuthoritativeDirectApprovalDrainProfile(profile, context.subjectAddress) &&
      evidenceIdsToCheck.some((id) => profileIds.includes(id));
  });
}

function activeLocalSanctionsEvidenceIds(report: WhereIsMoneyReport): Set<string> {
  return new Set(report.originPaths.flatMap((path) =>
    activeSanctionedServicePathEvidence(path)?.evidenceIds ?? []
  ));
}

function whereCandidates(
  context: MatrixCandidateContext,
  report: WhereIsMoneyReport,
  incomingTxHash: string | null = null,
  requireIncomingEvidenceLink = false,
  fastReport: RiskReport | null = null
): MatrixCandidate[] {
  const candidates: MatrixCandidate[] = [];
  const notApplicable = report.coverage.questionStatus === "not_applicable";
  const activeLocalSanctionsIds = activeLocalSanctionsEvidenceIds(report);
  const sanctionsAuthorized = (ids: string[]): boolean =>
    ids.some((id) => activeLocalSanctionsIds.has(id));
  const admits = (ids: string[]): boolean =>
    !requireIncomingEvidenceLink || evidenceLinkedToIncoming(report, ids, incomingTxHash);
  for (const observation of arrayOrEmpty(report.usddPsmRouteObservations)) {
    if (observation.mode === "deep_history") continue;
    const exposure = buildUsddPsmExposure(observation);
    if (!exposure || !admits(exposure.evidenceIds)) continue;
    candidates.push(usddPsmMatrixCandidate({ exposure, context }));
  }

  for (const profile of arrayOrEmpty(report.approvalDrainProvenanceProfiles)) {
    if (profile.evidenceStrength !== "route_linked" || !sameAddress(profile.subjectAddress, context.subjectAddress)) continue;
    const ids = [profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes];
    if (!admits(ids)) continue;
    candidates.push(candidate(context, {
      kind: "pattern",
      decisionEligibility: "review_only",
      coverageDependency: context.requiredCoverage
    }, {
      row: "route_linked_approval_pattern",
      actionUnit: "transaction",
      score: Math.min(80, profile.score),
      evidenceIds: ids,
      evidenceEpisodeIds: [approvalDrainEpisodeId(profile)],
      atomicSignals: ["route_linked_approval_pattern"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: profile.falsePositiveGuards?.map((guard) => guard.code) ?? []
    }));
  }

  for (const item of report.assessment.hardBadEvidence) {
    if (!deterministicWhereHardKinds.has(item.kind)) continue;
    if (!admits(item.evidenceIds)) continue;
    const ids = evidenceIds(item.evidenceIds, `where_hard:${item.kind}`);
    const exact = hasExactWhereHardProof(context, report, item.kind, item.evidenceIds, fastReport) &&
      evidenceLinkedToIncoming(report, item.evidenceIds, incomingTxHash);
    if (notApplicable && !exact) continue;
    const authority: MatrixEvidenceAuthority = exact
      ? { kind: "exact_hard", proofSource: incomingTxHash === null ? "where_exact_hard" : "incoming_exact_hard" }
      : item.kind === "sanctioned_service" && sanctionsAuthorized(item.evidenceIds)
        ? { kind: "policy", decisionEligibility: "can_decline", coverageDependency: context.requiredCoverage }
        : { kind: "context" };
    candidates.push(candidate(context, authority, {
      row: exact
        ? "hard_proof"
        : item.kind === "sanctioned_service" && sanctionsAuthorized(item.evidenceIds)
          ? "source_policy"
          : "counterparty_context",
      actionUnit: "source_path",
      score: exact ? item.kind === "approval_drain" ? 95 : Math.max(90, item.score) : contextScore(item.score),
      evidenceIds: ids,
      evidenceEpisodeIds: ids,
      atomicSignals: [`where_${item.kind}`],
      modifiers: exact ? ["hard_anchor"] : [],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  if (notApplicable) return candidates;

  for (const item of report.assessment.hardBadEvidence) {
    if (deterministicWhereHardKinds.has(item.kind)) continue;
    if (!item.kind.includes("contract_suspicion")) continue;
    if (!admits(item.evidenceIds)) continue;
    const ids = evidenceIds(item.evidenceIds, `where_contract:${item.kind}`);
    candidates.push(candidate(context, { kind: "context" }, {
      row: "contract_suspicion",
      actionUnit: "source_path",
      score: contextScore(item.score),
      evidenceIds: ids,
      evidenceEpisodeIds: ids,
      atomicSignals: [`where_${item.kind}`],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: []
    }));
  }

  candidates.push(...report.assessment.sourcePolicyEvidence
    .filter((item) => admits(item.evidenceIds) &&
      (item.kind !== "risky_label" || whereRiskyLabelEvidenceAuthorized(report, item.evidenceIds, fastReport)))
    .map((item) => sourcePolicyCandidate(
      context,
      item,
      item.kind !== "sanctioned_service" || sanctionsAuthorized(item.evidenceIds)
    )));

  for (const layer of report.assessment.riskLayers) {
    if (!admits(layer.evidenceIds)) continue;
    if ((layer.sourceExposureKind === "risky_label" || layer.kind === "risky_label") &&
      !whereRiskyLabelEvidenceAuthorized(report, layer.evidenceIds, fastReport)) continue;
    const score = contextScore(Math.max(layer.adjustedScore, layer.score), 84);
    if (score <= 0) continue;
    if (layer.evidenceClass === "source_policy") {
      const ids = evidenceIds(layer.evidenceIds, `where_layer:${layer.kind}`);
      const localSanctionsAuthorized = layer.sourceExposureKind !== "sanctioned_service" && layer.kind !== "sanctioned_service" ||
        sanctionsAuthorized(layer.evidenceIds);
      if (!localSanctionsAuthorized) {
        candidates.push(candidate(context, { kind: "context" }, {
          row: "counterparty_context",
          actionUnit: "source_path",
          score,
          evidenceIds: ids,
          evidenceEpisodeIds: ids,
          atomicSignals: [`source_policy_${layer.kind}_context`],
          modifiers: [],
          caps: [],
          dampeners: [],
          caveats: layer.warnings
        }));
        continue;
      }
      const decisionEligibility = layer.proofLevel === "exchange_policy_decline" && score >= 60
        ? "can_decline" as const
        : "review_only" as const;
      candidates.push(candidate(context, {
        kind: "policy",
        decisionEligibility,
        coverageDependency: context.requiredCoverage
      }, {
        row: "source_policy",
        actionUnit: "source_path",
        score,
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
      candidates.push(candidate(context, { kind: "context" }, {
        row: "contract_suspicion",
        actionUnit: "source_path",
        score: contextScore(score),
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

  const materialityOutcome = report.sourceProvenanceMateriality?.outcome ??
    report.assessment.sourceProvenanceMateriality?.outcome ?? null;
  const belowMateriality = hasBelowMaterialityCaveat(report);
  if (!requireIncomingEvidenceLink && belowMateriality && materialityOutcome) {
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "source_path",
      score: contextScore(report.riskScore),
      evidenceIds: [`where_materiality:${materialityOutcome}`],
      evidenceEpisodeIds: [`where_materiality:${materialityOutcome}`],
      atomicSignals: [`where_${materialityOutcome}`],
      modifiers: [],
      caps: ["below_materiality_review_context"],
      dampeners: [],
      caveats: report.coverage.notes
    }));
  } else if (
    !requireIncomingEvidenceLink &&
    (report.coverage.partial || report.coverage.fetchedAddressCount <= 1 || report.scoreValid === false)
  ) {
    candidates.push(coverageCandidate(context, "coverage:where_partial"));
  }

  const episode = report.coverage.drainEpisode ?? null;
  const episodeEvidenceIds = episode
    ? [episode.anchorTxHash, episode.fundingTxHash ?? episode.anchorTxHash, ...episode.outgoingTxHashes]
    : [];
  if (episode && admits(episodeEvidenceIds)) {
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
      candidates.push(candidate(context, {
        kind: "pattern",
        decisionEligibility: "can_decline",
        coverageDependency: context.requiredCoverage
      }, {
        row: "service_linked_pattern",
        actionUnit: "wallet",
        score: Math.min(84, breakdown.score),
        evidenceIds: episodeEvidenceIds,
        evidenceEpisodeIds: [`drain_episode:${episode.anchorTxHash}`],
        atomicSignals: ["where_drain_episode_transit_pattern"],
        modifiers: ["service_anchor"],
        caps: [],
        dampeners: [],
        caveats: []
      }));
    }
  }

  if (
    !requireIncomingEvidenceLink &&
    candidates.length === 0 &&
    report.scoreValid !== false &&
    !report.coverage.partial &&
    (report.proofLevel === "clean_source_proven" || report.userDecision === "ACCEPTABLE")
  ) {
    candidates.push(candidate(context, { kind: "clean", coverageDependency: context.requiredCoverage }, {
      row: "clean_or_operational",
      actionUnit: "wallet",
      score: contextScore(report.riskScore, 29),
      evidenceIds: [`where_clean:${report.subjectAddress}`],
      evidenceEpisodeIds: [`where_clean:${report.subjectAddress}`],
      atomicSignals: ["where_clean_or_operational"],
      modifiers: [],
      caps: [],
      dampeners: [],
      caveats: report.coverage.notes
    }));
  }

  return candidates;
}

function buildAddressEvidenceCandidates(
  context: MatrixCandidateContext,
  input: Pick<WalletMatrixCandidateInput, "fastReport" | "deepReport" | "whereReport">,
  incomingTxHash: string | null = null
): MatrixCandidate[] {
  const fastReport = sameAddress(input.fastReport?.subjectAddress, context.subjectAddress) ? input.fastReport : null;
  const deepReport = sameAddress(input.deepReport?.subjectAddress, context.subjectAddress) ? input.deepReport : null;
  const fastHardCandidates = fastHardProofCandidates(context, fastReport, { deepReport, whereReport: input.whereReport });
  const candidates = [
    ...fastHardCandidates,
    ...fastContextCandidates(context, fastReport, fastHardCandidates.length > 0),
    ...deepCandidates(context, deepReport, input.whereReport, incomingTxHash)
  ];
  if (!sameAddress(input.whereReport.subjectAddress, context.subjectAddress)) {
    if (incomingTxHash !== null && whereReportLinkedToIncoming(input.whereReport, incomingTxHash)) {
      candidates.push(...whereCandidates(context, input.whereReport, incomingTxHash, true, fastReport));
    }
    candidates.push(coverageCandidate(context, "coverage:where_subject_mismatch"));
    return candidates;
  }
  candidates.push(...whereCandidates(context, input.whereReport, incomingTxHash, false, fastReport));
  return candidates;
}

function directContractCandidates(
  context: MatrixCandidateContext,
  report: SmartContractCheckReport | null | undefined
): MatrixCandidate[] {
  if (!report || !sameAddress(report.subjectAddress, context.subjectAddress)) return [];
  const fingerprint = report.verify20Fingerprint;
  if (!fingerprint?.matched || fingerprint.blockedByTrustedService || report.serviceLabel !== null ||
    fingerprint.missingSelectors.length > 0 || fingerprint.mismatchedSelectors.length > 0) return [];
  const evidenceId = `contract:${context.subjectAddress}:verify20`;
  return [candidate(context, {
    kind: "pattern",
    decisionEligibility: "can_decline",
    coverageDependency: "none"
  }, {
    row: "contract_suspicion",
    actionUnit: "wallet",
    score: 85,
    evidenceIds: [evidenceId],
    evidenceEpisodeIds: [evidenceId],
    atomicSignals: ["exact_verify20_contract_pattern"],
    modifiers: ["direct_contract_subject_anchor"],
    caps: [],
    dampeners: [],
    caveats: report.limitations
  })];
}

export function buildWalletMatrixCandidates(input: WalletMatrixCandidateInput): MatrixCandidate[] {
  const context: MatrixCandidateContext = {
    decisionScope: "wallet_unified",
    subjectAddress: input.address,
    subjectTxHash: null,
    requiredCoverage: "wallet_provenance"
  };
  if (!sameAddress(input.whereReport.subjectAddress, input.address)) {
    return [
      ...directContractCandidates(context, input.smartContractReport),
      coverageCandidate(context, "coverage:where_subject_mismatch")
    ];
  }
  const candidates = buildAddressEvidenceCandidates(context, input);
  candidates.push(...directContractCandidates(context, input.smartContractReport));

  const deepReport = sameAddress(input.deepReport?.subjectAddress, input.address) ? input.deepReport : null;
  const deepSparse = deepReport ? (deepReport.coverage?.transferEdges ?? 0) < 10 : true;
  if (input.whereReport.coverage.partial && deepSparse && !hasBelowMaterialityCaveat(input.whereReport)) {
    candidates.push(coverageCandidate(context, "coverage:where_and_deep_limited"));
  }

  return candidates;
}

export function buildIncomingDepositMatrixCandidates(input: IncomingDepositMatrixCandidateInput): MatrixCandidate[] {
  const context: MatrixCandidateContext = {
    decisionScope: "incoming_unified",
    subjectAddress: input.senderAddress,
    subjectTxHash: input.txHash,
    requiredCoverage: "deposit_provenance"
  };
  const candidates = buildAddressEvidenceCandidates(context, input, input.txHash);
  candidates.push(...incomingDirectCounterpartyPolicyCandidates(context, input));
  const exposure = input.freshBundleExposure;
  const backgroundScore = Math.max(0, Math.min(20, Math.round(input.walletExposureProfile?.scoreContribution ?? 0)));
  if (backgroundScore > 0) {
    candidates.push(candidate(context, { kind: "context" }, {
      row: "behavior_only_prior",
      actionUnit: "incoming_deposit",
      score: backgroundScore,
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

  const reportMatchesSender = sameAddress(input.whereReport.subjectAddress, input.senderAddress);
  const boundRiskyLabelPaths = input.whereReport.originPaths.filter((path) =>
    isAuthoritativeMoneyOriginRiskLabelPath(path) &&
    (reportMatchesSender || path.balanceTransferTxHash === input.txHash || path.txHashes.includes(input.txHash) ||
      path.steps.some((step) => step.txHash === input.txHash))
  );
  const boundRiskyLabelShare = Math.min(1, boundRiskyLabelPaths.reduce(
    (sum, path) => sum + selectedMoneyOriginPathShare(path),
    0
  ));
  if (boundRiskyLabelShare >= 0.1) {
    const boundEvidenceIds = [...new Set(boundRiskyLabelPaths.flatMap((path) =>
      [path.balanceTransferTxHash, ...path.txHashes, ...path.steps.map((step) => step.txHash)]))];
    candidates.push(candidate(context, {
      kind: "policy",
      decisionEligibility: "can_decline",
      coverageDependency: context.requiredCoverage
    }, {
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      evidenceIds: boundEvidenceIds,
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_risky_label_source"],
      modifiers: ["source_policy_anchor"],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  }

  if (exposure.htxHuobiShare >= 0.7) {
    candidates.push(candidate(context, {
      kind: "policy",
      decisionEligibility: "can_decline",
      coverageDependency: context.requiredCoverage
    }, {
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      evidenceIds: [`incoming:${input.txHash}:htx_huobi`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_source"],
      modifiers: ["source_policy_anchor", `share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  } else if (exposure.htxHuobiShare >= 0.3) {
    candidates.push(candidate(context, {
      kind: "policy",
      decisionEligibility: "can_decline",
      coverageDependency: context.requiredCoverage
    }, {
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 70,
      evidenceIds: [`incoming:${input.txHash}:htx_huobi`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_fresh_htx_huobi_source"],
      modifiers: ["source_policy_anchor", `share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  } else if (exposure.htxHuobiShare >= 0.1) {
    candidates.push(candidate(context, {
      kind: "policy",
      decisionEligibility: "review_only",
      coverageDependency: context.requiredCoverage
    }, {
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 55,
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
    candidates.push(candidate(context, {
      kind: "policy",
      decisionEligibility: "can_decline",
      coverageDependency: context.requiredCoverage
    }, {
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 70,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 45,
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
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "incoming_deposit",
      score: 40,
      evidenceIds: [`incoming:${input.txHash}:htx_huobi_corridor`],
      evidenceEpisodeIds: [`incoming:${input.txHash}:fresh_bundle`],
      atomicSignals: ["incoming_htx_huobi_corridor_context"],
      modifiers: [`share_${Math.round(exposure.htxHuobiShare * 100)}`],
      caps: [],
      dampeners: [],
      caveats: exposure.reasons
    }));
  } else if (exposure.bridgeRouterDexShare > 0 || exposure.unknownContractShare > 0) {
    candidates.push(candidate(context, { kind: "context" }, {
      row: "counterparty_context",
      actionUnit: "incoming_deposit",
      score: 35,
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
