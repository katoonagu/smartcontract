import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  forensicRouteEdgeHasExactMovementIdentity,
  forensicRouteEdgeIdentity,
  mergeForensicRouteEdges
} from "../forensics/localTronUsdtIndex";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { selectBalanceFormingTransfers } from "../forensics/balanceFormingTransfers";
import { buildForensicCoverageV2 } from "../forensics/forensicCoverageV2";
import { collectUsddPsmRouteObservations } from "../forensics/usddPsmRouteObservation";
import {
  LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW,
  selectRecentFlowProvenanceTransfers
} from "../forensics/recentFlowProvenanceSelection";
import { buildApprovalDrainProvenanceAnalysis } from "../forensics/approvalDrainProvenance";
import { buildMoneyOriginAgeSignals } from "../forensics/moneyOriginAgeSignals";
import { buildMoneyOriginOperationalAssessment, riskBandFromWhereScore } from "../forensics/moneyOriginOperationalAssessment";
import { selectedMoneyOriginPathShare } from "../forensics/moneyOriginAttribution";
import {
  buildSourceBundleExposure,
  buildSubjectExposureProfile,
  unresolvedBoundaryFromFindings
} from "../forensics/sourceBundleExposure";
import { sourceExposureKindFromPath } from "../forensics/provenanceScoring";
import { buildContractDrivenEvidenceProfiles } from "../forensics/contractDrivenEvidence";
import { buildMoneyOriginSenderInteractionProfile } from "../forensics/moneyOriginInteractions";
import { combineMoneyOriginDecision } from "../forensics/moneyOriginPolicy";
import { isExactGasFreeServiceFeePath, traceMoneyOriginPath } from "../forensics/moneyOriginTrace";
import { extractGasFreeEdgeContext, isGasFreeServiceFeeEdge } from "../forensics/gasFreeSettlement";
import { matchSanctionedCryptoService } from "../forensics/sanctionedServiceRegistry";
import { runCrossChainCorridorAnalysis } from "../forensics/crossChainCorridor";
import type { CrossChainDiscoveryProvider } from "../forensics/crossChainProviders";
import type { ChainContinuationProvider } from "../forensics/crossChainContinuationTypes";
import {
  deepBridgeExposureFromServiceProfiles,
  evaluateCrossChainStage2Trigger,
  type CrossChainDeepBridgeExposure
} from "../forensics/crossChainStage2Triggers";
import { detectDrainEpisode } from "../forensics/drainEpisode";
import { DEFAULT_DRAIN_EPISODE_WINDOW_MS } from "../forensics/provenanceTracingConfig";
import type { EvmEvidenceProvider } from "../forensics/evmExplorerClient";
import type { ForensicJobProgressPatch } from "../forensics/forensicJobProgress";
import type {
  RouteLinkedAssertionInput,
  SelectiveTransactionEnricher,
  SelectiveTransactionEnrichmentResult
} from "../forensics/selectiveTransactionEnrichment";
import { exactFastHardEvidence } from "../risk/fastEvidence";
import { assembleFreshScoreResultV2, materializeFreshScoreBindingV2 } from "../risk/scoreAnchorV2";
import {
  SCORING_SIGNAL_MATRIX_POLICY_VERSION,
  scoreMatrixCandidates,
  type MatrixCandidate
} from "../risk/scoringSignalMatrix";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  AddressLabel,
  ContractAnalysisCaseFile,
  ExchangeDecision,
  ForensicScoreBlockedReason,
  ForensicTechnicalStatus,
  ForensicCoverageV2,
  ForensicRouteEdge,
  MoneyOriginPath,
  MoneyOriginTraceHistoryCoverage,
  ProofLevel,
  RiskReport,
  ServiceClassification,
  StablecoinRestrictionProfile,
  BalanceFormingSelection,
  BalanceFormingTransfer,
  MoneyOriginDrainEpisode,
  MoneyOriginProvenanceScope,
  MoneyOriginRecentFlowAnchor,
  WhereIsMoneyAssessment,
  WhereIsMoneyCoverage,
  MoneyOriginLayerSummary,
  SourceBundleExposureFinding,
  SourceBundleExposureScope,
  SourceBundleExposureSourceKind,
  SourceExposureKind,
  ServiceExposureProfile,
  SubjectExposureEvent,
  FreshWhereIsMoneyReportV2,
  WhereCandidateWindowRequest,
  WhereIsMoneyReport,
  WhereTransactionInfoEnrichmentSummary
} from "../types";
import { userDecisionFromInternal } from "../risk/proofLevels";

export type WhereIsMoneyDeps = {
  getTrc20Balance(address: string, tokenContractAddress: string): Promise<string | null>;
  fetchEdgesForAddress(address: string, options?: {
    latestTimestamp?: Date;
    deferBroadTargetedHistory?: boolean;
    targetEdge?: ForensicRouteEdge | null;
    expectedAmountRaw?: string | null;
  }): Promise<ForensicRouteEdge[]>;
  getHistoryCoverageForAddress?(
    address: string,
    options: {
      latestTimestamp?: Date;
      deferBroadTargetedHistory?: boolean;
      targetEdge?: ForensicRouteEdge | null;
      expectedAmountRaw?: string | null;
    }
  ): Promise<MoneyOriginTraceHistoryCoverage>;
  repairSourceProvenanceWindow?: Parameters<typeof traceMoneyOriginPath>[0]["repairSourceProvenanceWindow"];
  requestCandidateWindows?(requests: WhereCandidateWindowRequest[]): Promise<true>;
  ensureBroadTargetedHistory?(input: BroadTargetedHistoryRequest): Promise<true>;
  ensureBroadTargetedHistories?(requests: BroadTargetedHistoryRequest[]): Promise<true>;
  fetchLatestEdgesForAddress?(address: string, limit: number): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getFastWalletRisk?(address: string): Promise<RiskReport | null>;
  getTransaction?(txHash: string): Promise<unknown>;
  selectiveTransactionEnricher?: SelectiveTransactionEnricher;
  listIndexedMovementsByHashes?(txHashes: string[]): Promise<ForensicRouteEdge[]>;
  listActiveRouteAssertions?(input: {
    addresses: string[];
    txHashes: string[];
  }): Promise<RouteLinkedAssertionInput[]>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  getContractIntelligenceProfile?(address: string): Promise<ContractRiskContext | null>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
};

export type BroadTargetedHistoryRequest = {
  address: string;
  targetTimestamp: Date;
  queuedReason: "where_is_money_hop";
  reason: "material_unresolved_after_candidate_windows" | "hard_evidence_requires_full_coverage";
};

export type RunWhereIsMoneyCheckInput = {
  sourceAddress?: string;
  subjectAddress?: string;
  mode?: "where_is_money" | "transaction_check" | "wallet_profile";
  requestedAmountRaw?: string | null;
  seedTransfers?: BalanceFormingTransfer[];
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  minAmountPreservationRatio?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
  approvalEnrichmentMode?: "off" | "triggered" | "always";
  maxApprovalCandidates?: number;
  maxContractTransactionInfoFetches?: number | null;
  contractTransactionInfoMinIntervalMs?: number | null;
  crossChainStage2Enabled?: boolean;
  crossChainManualDeepMode?: boolean;
  crossChainMaxProviderCalls?: number;
  deepBridgeExposure?: CrossChainDeepBridgeExposure | null;
  deepServiceExposureProfiles?: ServiceExposureProfile[];
  now?: () => number;
  onProgress?: (patch: ForensicJobProgressPatch) => Promise<void> | void;
  abortSignal?: AbortSignal;
};

const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_BEAM_WIDTH = 12;
const DEFAULT_MAX_ADDRESS_FETCHES = 150;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 100;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 150;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 150;
const DEFAULT_APPROVAL_ENRICHMENT_MODE = "triggered" as NonNullable<RunWhereIsMoneyCheckInput["approvalEnrichmentMode"]>;
const DEFAULT_MAX_APPROVAL_CANDIDATES = 30;
// ponytail: high ceiling for current mass Verify20 campaigns; move to paged/background enrichment if providers throttle.
const DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 200;
const TRACE_PROGRESS_ADDRESS_INTERVAL = 5;
const TRACE_PROGRESS_MIN_INTERVAL_MS = 15_000;
const MAX_DRAIN_EPISODE_SERVICE_DESTINATION_CLASSIFICATIONS = 12;
const MAX_SUBJECT_EXPOSURE_INCOMING_COUNTERPARTY_CLASSIFICATIONS = 20;
const MAX_SUBJECT_EXPOSURE_OUTGOING_COUNTERPARTY_CLASSIFICATIONS = MAX_DRAIN_EPISODE_SERVICE_DESTINATION_CLASSIFICATIONS;

function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

function classificationCacheKey(address: string): string {
  return address.trim();
}

function edgeFetchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

function isRecoverableEdgeFetchError(error: unknown): boolean {
  const message = edgeFetchErrorMessage(error).toLowerCase();
  const nonRecoverableSignals = [
    "400",
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "invalid api key",
    "invalid key",
    "schema",
    "column",
    "does not exist"
  ];
  if (nonRecoverableSignals.some((needle) => message.includes(needle))) return false;
  return [
    "408",
    "429",
    "500",
    "502",
    "503",
    "504",
    "5xx",
    "rate limit",
    "too many requests",
    "aborterror",
    "aborted",
    "operation aborted",
    "timeout",
    "timed out",
    "network error",
    "socket",
    "econnreset",
    "etimedout",
    "eai_again",
    "unavailable",
    "outage",
    "temporarily"
  ].some((needle) => message.includes(needle));
}

async function fetchEdgesOrPartial(
  read: () => Promise<ForensicRouteEdge[]>,
  onRecoverableError?: () => void
): Promise<ForensicRouteEdge[]> {
  try {
    return await read();
  } catch (error) {
    if (!isRecoverableEdgeFetchError(error)) throw error;
    onRecoverableError?.();
    return [];
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("where-is-money check aborted");
}

const APPROVAL_DRAIN_SERVICE_PROFILE_CATEGORIES = new Set<ServiceClassification["category"]>([
  "router",
  "dex",
  "bridge",
  "bridge_pool",
  "swap_adapter",
  "unknown_contract"
]);

function proofLevelFromHardEvidenceKind(kind: WhereIsMoneyAssessment["hardBadEvidence"][number]["kind"]): ProofLevel {
  if (kind === "approval_drain") return "exact_approval_drain_provenance";
  if (kind === "llm_contract_suspicion") return "llm_assisted_suspicion";
  return "exact_scam_or_taint_proof";
}

function proofLevelFromWhereDecision(input: {
  decision: ExchangeDecision;
  approvalDrainProvenanceProfileCount: number;
  assessment?: WhereIsMoneyAssessment | null;
}): ProofLevel {
  const topHardEvidence = input.assessment?.hardBadEvidence
    .slice()
    .sort((left, right) => right.score - left.score)[0] ?? null;
  if (topHardEvidence) return proofLevelFromHardEvidenceKind(topHardEvidence.kind);

  if (input.approvalDrainProvenanceProfileCount > 0) {
    return "exact_approval_drain_provenance";
  }

  if (input.assessment?.dominantRiskLayer?.proofLevel) {
    return input.assessment.dominantRiskLayer.proofLevel;
  }

  if (input.decision === "ACCEPTABLE") {
    return "clean_source_proven";
  }
  return "insufficient_coverage";
}

function whereDecisionFields(input: {
  decision: ExchangeDecision;
  decisionReasons: string[];
  approvalDrainProvenanceProfileCount: number;
  assessment?: WhereIsMoneyAssessment | null;
}): Pick<WhereIsMoneyReport, "internalDecision" | "userDecision" | "proofLevel"> {
  const scoreInvalid = input.assessment?.scoreValid === false;
  return {
    internalDecision: input.decision,
    userDecision: scoreInvalid ? "NO_FINAL_DECISION" : userDecisionFromInternal(input.decision),
    proofLevel: proofLevelFromWhereDecision(input)
  };
}

function dominantWhereCandidate(report: WhereIsMoneyReport): MatrixCandidate | null {
  const layer = report.assessment.dominantRiskLayer;
  if (!layer || layer.evidenceIds.length === 0) return null;
  const subject = {
    decisionScope: "wallet_unified" as const,
    address: report.subjectAddress,
    txHash: null
  };
  const common = {
    actionUnit: "source_path" as const,
    score: layer.adjustedScore,
    evidenceIds: [...layer.evidenceIds],
    evidenceEpisodeIds: [...layer.evidenceIds],
    atomicSignals: [layer.kind],
    modifiers: ["where_dominant_policy_layer"],
    caps: [],
    dampeners: [],
    caveats: [...layer.warnings],
    subject
  };
  if (layer.evidenceClass === "hard_proof") {
    return { ...common, row: "hard_proof", authority: { kind: "exact_hard", proofSource: "where_exact_hard" } };
  }
  if (layer.evidenceClass === "source_policy") {
    return {
      ...common,
      row: "source_policy",
      authority: {
        kind: "policy",
        decisionEligibility: report.internalDecision === "DECLINE" ? "can_decline" : "review_only",
        coverageDependency: "wallet_provenance"
      }
    };
  }
  if (layer.evidenceClass === "clean_source") {
    return {
      ...common,
      row: "clean_or_operational",
      authority: { kind: "clean", coverageDependency: "wallet_provenance" }
    };
  }
  return { ...common, row: layer.evidenceClass === "contract_suspicion" ? "contract_suspicion" : "behavior_only_prior", authority: { kind: "context" } };
}

export function bindFreshWhereScoreResultV2(report: WhereIsMoneyReport): FreshWhereIsMoneyReportV2 {
  const candidate = dominantWhereCandidate(report);
  const matrix = scoreMatrixCandidates(candidate ? [candidate] : [], {
    decisionScope: "wallet_unified",
    subjectAddress: report.subjectAddress,
    subjectTxHash: null,
    requiredCoverage: "wallet_provenance"
  });
  const decision = matrix.matrixDecision === "INSUFFICIENT_EVIDENCE" ? null : matrix.matrixDecision;
  const bindable = candidate !== null &&
    report.scoreValid === true &&
    report.assessment.scoreValid === true &&
    decision !== null &&
    report.riskScore === report.assessment.riskScore &&
    matrix.policyScore === report.assessment.riskScore;
  const disposition = bindable
    ? {
        decision,
        finalScore: report.riskScore,
        observedContextScore: report.riskScore,
        scoreValid: true,
        decisionBasis: candidate.authority.kind === "exact_hard" ? "exact_hard_proof" as const : "matrix" as const,
        coverage: {
          required: candidate.authority.kind === "exact_hard" ? "valid" as const : report.coverage.partial ? "invalid" as const : "valid" as const,
          overall: report.coverage.partial ? "partial" as const : "complete" as const,
          invalidModes: report.coverage.partial ? ["where"] : [],
          caveats: [...report.coverage.notes]
        },
        hardProofEvidenceIds: candidate.authority.kind === "exact_hard" ? [...candidate.evidenceIds] : [],
        decisiveCandidate: matrix.winningCandidate
      }
    : {
        decision: "NO_FINAL_DECISION" as const,
        finalScore: null,
        observedContextScore: report.riskScore,
        scoreValid: false,
        decisionBasis: "technical_stop" as const,
        coverage: {
          required: "invalid" as const,
          overall: "partial" as const,
          invalidModes: ["where"],
          caveats: [...(report.coverage?.notes ?? [])]
        },
        hardProofEvidenceIds: [],
        decisiveCandidate: null
      };
  const binding = materializeFreshScoreBindingV2({
    mode: "where",
    subjectAddress: report.subjectAddress,
    disposition,
    matrix
  });
  const canonical = assembleFreshScoreResultV2({
    mode: "where",
    subjectAddress: report.subjectAddress,
    disposition,
    matrix,
    evidence: binding.evidence,
    facts: binding.facts,
    activeAnchors: binding.anchor ? [binding.anchor] : []
  });
  return {
    ...report,
    scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
    scoreValid: canonical.scoreValid,
    userDecision: canonical.decision,
    scoreAnchorV2: canonical.scoreAnchorV2,
    narrativeFactsV2: canonical.narrativeFactsV2,
    scoringEvidenceV2: canonical.scoringEvidenceV2,
    scoreAnchorDiagnostic: bindable
      ? canonical.scoreAnchorDiagnostic
      : "score_anchor_fact_binding_failed"
  };
}

function publishFreshWhereScoreResultV2(report: WhereIsMoneyReport): WhereIsMoneyReport {
  return bindFreshWhereScoreResultV2(report);
}

const WALLET_PROFILE_ZERO_BALANCE_REASON =
  "Current USDT balance is zero; balance-origin mode is not applicable for this wallet profile check.";
const walletProfileCriticalLabels = new Set<AddressLabel["label"]>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange"
]);
const walletProfileHighRiskLabels = new Set<AddressLabel["label"]>([
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

function rawBalanceIsZero(value: string | null): value is string {
  return value !== null && /^\d+$/.test(value) && BigInt(value) === 0n;
}

function walletProfileLabelScore(label: AddressLabel["label"]): number {
  if (label === "trusted" || label === "false_positive") return 0;
  if (label === "victim") return 0;
  if (walletProfileCriticalLabels.has(label)) return 90;
  if (walletProfileHighRiskLabels.has(label)) return 80;
  return 35;
}

function checkedScopeFor(
  provenanceScope: MoneyOriginProvenanceScope | undefined,
  drainEpisode: MoneyOriginDrainEpisode | null,
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null
): NonNullable<WhereIsMoneyCoverage["checkedScope"]> {
  if (drainEpisode) return "drain_episode";
  if (provenanceScope === "recent_flow") return anchorTransfer ? "selected_anchor" : "recent_flow";
  return provenanceScope ?? "current_balance";
}

function buildLayerSummary(
  fastWalletRisk: RiskReport | null,
  checkedScope: NonNullable<WhereIsMoneyCoverage["checkedScope"]>
): MoneyOriginLayerSummary {
  return {
    fastCheck: {
      riskLevel: fastWalletRisk?.level ?? null,
      score: fastWalletRisk?.score ?? null,
      note: "Fast check is a quick label/snapshot signal, not a full provenance trace."
    },
    whereIsMoney: {
      checkedScope,
      note: checkedScope === "drain_episode"
        ? "Where is money checked a selected drain episode derived from the low-balance recent-flow anchor."
        : "Where is money checked the selected provenance scope."
    },
    deepCheck: {
      serviceExposureRaw: null,
      dominantCategory: null,
      note: "Deep service exposure is attached by address_deep_check jobs and may include flows outside the selected provenance anchor."
    }
  };
}

function walletProfileZeroBalanceReport(input: {
  sourceAddress: string;
  currentBalanceRaw: string;
  requestedAmountRaw?: string | null;
  fastWalletRisk: RiskReport | null;
  labels: AddressLabel[];
  maxDepth: number;
  provenanceScope?: MoneyOriginProvenanceScope;
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  drainEpisode?: MoneyOriginDrainEpisode | null;
  checkedScope?: NonNullable<WhereIsMoneyCoverage["checkedScope"]>;
  anchorCoverageRatio?: number | null;
  episodeCoverageRatio?: number | null;
  coverageV2: ForensicCoverageV2;
}): WhereIsMoneyReport {
  const labelReasons = input.labels
    .map((label) => ({ label: label.label, score: walletProfileLabelScore(label.label) }))
    .filter((label) => label.score > 0)
    .map((label) => `Internal label: ${label.label}.`);
  const exactLabelEvidence = exactFastHardEvidence({
    subjectAddress: input.sourceAddress,
    score: 0,
    level: "LOW",
    reasons: input.labels.map((label) => ({
      code: `internal_label_${label.label}`,
      message: `Internal label: ${label.label}`,
      scoreImpact: walletProfileLabelScore(label.label),
      evidenceRef: `internal-label:${label.address}:${label.label}:${label.createdAt.toISOString()}`
    }))
  }).sort((left, right) => right.score - left.score);
  const hardBadEvidence = exactLabelEvidence.map((item) => ({
    kind: item.code === "internal_label_approval_drain_proximity"
      ? "approval_drain" as const
      : "scam_or_blacklist" as const,
    score: item.score,
    message: item.message,
    evidenceIds: [item.evidenceId]
  }));
  const topExact = exactLabelEvidence[0] ?? null;
  const exactHard = topExact !== null;
  const decision: ExchangeDecision = exactHard ? "DECLINE" : "REVIEW";
  const riskScore = topExact?.score ?? 0;
  const decisionFields = exactHard
    ? {
        decision,
        internalDecision: decision,
        userDecision: "DECLINE" as const,
        proofLevel: topExact.code === "internal_label_approval_drain_proximity"
          ? "exact_approval_drain_provenance" as const
          : "exact_scam_or_taint_proof" as const
      }
    : {
        decision,
        internalDecision: decision,
        userDecision: "NO_FINAL_DECISION" as const,
        proofLevel: "insufficient_coverage" as const
      };
  const decisionReasons = [WALLET_PROFILE_ZERO_BALANCE_REASON, ...labelReasons];
  const checkedScope = input.checkedScope ?? checkedScopeFor(input.provenanceScope, input.drainEpisode ?? null, input.anchorTransfer);
  const assessment: WhereIsMoneyAssessment = {
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    decision,
    riskScore,
    riskBand: riskBandFromWhereScore(riskScore),
    provenanceConfidence: 0,
    coverageCompleteness: 0,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence,
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: decisionReasons,
    warnings: [WALLET_PROFILE_ZERO_BALANCE_REASON]
  };

  return {
    subjectAddress: input.sourceAddress,
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    currentUsdtBalanceRaw: input.currentBalanceRaw,
    fastWalletRisk: input.fastWalletRisk,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment,
    ...decisionFields,
    riskScore,
    decisionReasons,
    coverageV2: input.coverageV2,
    usddPsmRouteObservations: [],
    coverage: {
      selectedInboundTxCount: 0,
      currentBalanceRaw: input.currentBalanceRaw,
      requestedAmountRaw: input.requestedAmountRaw ?? null,
      targetAmountRaw: "0",
      selectedAmountRaw: "0",
      coverageRatio: 0,
      drainEpisode: input.drainEpisode ?? null,
      checkedScope,
      anchorCoverageRatio: input.anchorCoverageRatio ?? 0,
      episodeCoverageRatio: input.episodeCoverageRatio ?? null,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      provenanceScope: input.provenanceScope,
      anchorTransfer: input.anchorTransfer ?? null,
      maxDepth: input.maxDepth,
      fetchedAddressCount: 0,
      questionStatus: "not_applicable",
      partial: false,
      notes: [WALLET_PROFILE_ZERO_BALANCE_REASON]
    },
    layerSummary: buildLayerSummary(input.fastWalletRisk, checkedScope)
  };
}

function fallbackReviewReport(input: {
  sourceAddress: string;
  currentBalanceRaw: string | null;
  requestedAmountRaw?: string | null;
  targetAmountRaw: string;
  fastWalletRisk: RiskReport | null;
  maxDepth: number;
  fetchedAddressCount?: number;
  provenanceScope?: MoneyOriginProvenanceScope;
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  lowBalanceThresholdRaw?: string | null;
  dataScopeNote?: string | null;
  drainEpisode?: MoneyOriginDrainEpisode | null;
  checkedScope?: NonNullable<WhereIsMoneyCoverage["checkedScope"]>;
  anchorCoverageRatio?: number | null;
  episodeCoverageRatio?: number | null;
  selectionMethod?: BalanceFormingSelection["selectionMethod"];
  recentFlowPrincipalTransfers?: BalanceFormingSelection["recentFlowPrincipalTransfers"];
  technicalFailure?: {
    scoreBlockedReason: ForensicScoreBlockedReason;
    technicalStatus: ForensicTechnicalStatus;
  } | null;
  notes: string[];
  coverageV2: ForensicCoverageV2;
}): WhereIsMoneyReport {
  const decision: ExchangeDecision = "REVIEW";
  const technicalFailure = input.currentBalanceRaw === null
    ? { scoreBlockedReason: "provider_error" as const, technicalStatus: "provider_error" as const }
    : input.technicalFailure ?? null;
  const scoreBlockedReason = technicalFailure?.scoreBlockedReason ?? "insufficient_coverage";
  const technicalStatus = technicalFailure?.technicalStatus ?? "completed";
  const decisionReasons = input.notes;
  const riskScore = Math.max(0, Math.min(59, input.fastWalletRisk?.score ?? 0));
  const checkedScope = input.checkedScope ?? checkedScopeFor(input.provenanceScope, input.drainEpisode ?? null, input.anchorTransfer);
  const assessment: WhereIsMoneyAssessment = {
    decision,
    scoreValid: false,
    scoreBlockedReason,
    technicalStatus,
    riskScore,
    riskBand: riskBandFromWhereScore(riskScore),
    provenanceConfidence: 0,
    coverageCompleteness: 0,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: decisionReasons,
    warnings: [technicalFailure
      ? "A technical data failure prevented provenance scoring; no final risk decision is published."
      : "Covered history did not contain a usable balance-forming source; provenance remains semantically unresolved."]
  };
  return {
    subjectAddress: input.sourceAddress,
    scoreValid: false,
    scoreBlockedReason,
    technicalStatus,
    currentUsdtBalanceRaw: input.currentBalanceRaw,
    fastWalletRisk: input.fastWalletRisk,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment,
    decision,
    ...whereDecisionFields({
      decision,
      decisionReasons,
      approvalDrainProvenanceProfileCount: 0,
      assessment
    }),
    riskScore: assessment.riskScore,
    decisionReasons,
    coverageV2: input.coverageV2,
    recentFlowPrincipalTransfers: input.recentFlowPrincipalTransfers,
    usddPsmRouteObservations: [],
    coverage: {
      selectedInboundTxCount: 0,
      currentBalanceRaw: input.currentBalanceRaw,
      requestedAmountRaw: input.requestedAmountRaw ?? null,
      targetAmountRaw: input.targetAmountRaw,
      selectedAmountRaw: "0",
      coverageRatio: 0,
      drainEpisode: input.drainEpisode ?? null,
      checkedScope,
      anchorCoverageRatio: input.anchorCoverageRatio ?? 0,
      episodeCoverageRatio: input.episodeCoverageRatio ?? null,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      provenanceScope: input.provenanceScope,
      selectionMethod: input.selectionMethod,
      anchorTransfer: input.anchorTransfer ?? null,
      lowBalanceThresholdRaw: input.lowBalanceThresholdRaw ?? null,
      dataScopeNote: input.dataScopeNote ?? null,
      maxDepth: input.maxDepth,
      fetchedAddressCount: input.fetchedAddressCount ?? 0,
      questionStatus: "applicable",
      partial: true,
      notes: input.notes
    },
    layerSummary: buildLayerSummary(input.fastWalletRisk, checkedScope)
  };
}

async function buildContractProfilesForCaseFiles(input: {
  caseFiles: ContractAnalysisCaseFile[];
  getContractIntelligenceProfile?: (address: string) => Promise<ContractRiskContext | null>;
}): Promise<Map<string, ContractRiskContext | null>> {
  const profiles = new Map<string, ContractRiskContext | null>();
  if (!input.getContractIntelligenceProfile) return profiles;
  await Promise.all(input.caseFiles.map(async (caseFile) => {
    if (!caseFile.contractAddress || profiles.has(caseFile.contractAddress)) return;
    const profile = await input.getContractIntelligenceProfile?.(caseFile.contractAddress).catch(() => null) ?? null;
    profiles.set(caseFile.contractAddress, profile);
  }));
  return profiles;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function tronAddressField(value: unknown): string | null {
  const raw = stringField(value);
  if (!raw) return null;
  if (/^41[0-9a-fA-F]{40}$/.test(raw)) {
    try {
      return TronWeb.address.fromHex(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function approvalDrainCandidateAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function compareApprovalDrainCandidateAmountDesc(a: ForensicRouteEdge, b: ForensicRouteEdge): number {
  const left = approvalDrainCandidateAmount(a);
  const right = approvalDrainCandidateAmount(b);
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function contractCandidatesFromTransaction(transactionInfo: unknown): string[] {
  const tx = objectField(transactionInfo);
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  const rawData = objectField(tx?.raw_data);
  const rawContract = objectField(arrayField(rawData?.contract)[0]);
  const rawParameter = objectField(rawContract?.parameter);
  const rawValue = objectField(rawParameter?.value);
  return [...new Set([
    tronAddressField(tx?.ownerAddress),
    tronAddressField(tx?.owner_address),
    tronAddressField(contractData?.ownerAddress),
    tronAddressField(contractData?.owner_address),
    tronAddressField(triggerInfo?.ownerAddress),
    tronAddressField(triggerInfo?.owner_address),
    tronAddressField(rawValue?.owner_address),
    tronAddressField(tx?.contractAddress),
    tronAddressField(tx?.contract_address),
    tronAddressField(contractData?.contractAddress),
    tronAddressField(contractData?.contract_address),
    tronAddressField(triggerInfo?.contractAddress),
    tronAddressField(triggerInfo?.contract_address),
    tronAddressField(rawValue?.contract_address)
  ].filter((address): address is string => Boolean(address && address !== TRON_USDT_CONTRACT_ADDRESS)))];
}

async function buildApprovalDrainContractProfiles(input: {
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null>;
  getCachedClassification(address: string): Promise<ServiceClassification | null>;
  getTransaction: (txHash: string) => Promise<unknown>;
  getContractIntelligenceProfile?: (address: string) => Promise<ContractRiskContext | null>;
  maxCandidates: number;
}): Promise<Map<string, ContractRiskContext | null>> {
  const profiles = new Map<string, ContractRiskContext | null>();
  if (!input.getContractIntelligenceProfile) return profiles;

  const maybeFetchProfile = async (address: string): Promise<void> => {
    if (profiles.has(address)) return;
    const classification = await input.getCachedClassification(address).catch(() => null);
    if (!classification || !APPROVAL_DRAIN_SERVICE_PROFILE_CATEGORIES.has(classification.category)) return;
    const profile = await input.getContractIntelligenceProfile?.(address).catch(() => null) ?? null;
    profiles.set(address, profile);
  };

  await Promise.all([...input.classifications.entries()]
    .filter(([, classification]) => classification && APPROVAL_DRAIN_SERVICE_PROFILE_CATEGORIES.has(classification.category))
    .map(([address]) => maybeFetchProfile(address)));

  const transactionCandidates = input.edges
    .filter((edge) => approvalDrainCandidateAmount(edge) > 0n)
    .sort(compareApprovalDrainCandidateAmountDesc)
    .slice(0, input.maxCandidates);
  const discoveredAddresses = await Promise.all(transactionCandidates.map(async (edge) => {
    const tx = await input.getTransaction(edge.txHash).catch(() => null);
    return contractCandidatesFromTransaction(tx);
  }));
  await Promise.all([...new Set(discoveredAddresses.flat())].map((address) => maybeFetchProfile(address)));
  return profiles;
}

function windowEdges(edges: ForensicRouteEdge[], input: RunWhereIsMoneyCheckInput): ForensicRouteEdge[] {
  return edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
}

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    const key = forensicRouteEdgeIdentity(edge);
    byKey.set(key, betterDedupeEdge(byKey.get(key), edge));
  }
  return mergeForensicRouteEdges([...byKey.values()]);
}

function mergeTransactionInfoEnrichment(
  results: readonly SelectiveTransactionEnrichmentResult[]
): WhereTransactionInfoEnrichmentSummary | undefined {
  if (results.length === 0) return undefined;
  const decisions = new Map<string, SelectiveTransactionEnrichmentResult["decisions"][number]>();
  for (const result of results) {
    for (const decision of result.decisions) decisions.set(decision.txHash, decision);
  }
  const mergedDecisions = [...decisions.values()].sort((left, right) => left.txHash.localeCompare(right.txHash));
  return {
    policyVersion: "selective-transaction-enrichment-v1",
    coverageStatus: results.some((result) => result.coverageStatus === "coverage_incomplete")
      ? "coverage_incomplete"
      : "complete",
    technicalStatus: results.some((result) => result.technicalStatus === "technical_unknown")
      ? "technical_unknown"
      : "proven",
    candidateCount: mergedDecisions.length,
    hardCandidateCount: mergedDecisions.filter((decision) => decision.priority === "hard").length,
    rawProviderRequests: results.reduce((sum, result) => sum + result.rawProviderRequests, 0),
    fullProviderRequests: results.reduce((sum, result) => sum + result.fullProviderRequests, 0),
    savedEvidenceHits: results.reduce((sum, result) => sum + result.savedEvidenceHits, 0),
    inFlightHits: results.reduce((sum, result) => sum + result.inFlightHits, 0),
    schedulerAwaitMs: results.reduce((sum, result) => sum + result.schedulerAwaitMs, 0),
    evidenceIds: [...new Set(results.flatMap((result) => result.evidenceIds))],
    decisions: mergedDecisions
  };
}

function betterDedupeEdge(current: ForensicRouteEdge | undefined, next: ForensicRouteEdge): ForensicRouteEdge {
  if (!current) return next;
  const currentRank = contractDrivenSignalRank(current);
  const nextRank = contractDrivenSignalRank(next);
  if (nextRank > currentRank) return next;
  if (nextRank < currentRank) return current;
  return next;
}

function contractDrivenSignalRank(edge: ForensicRouteEdge): number {
  const method = edge.method.trim().toLowerCase();
  if (edge.edgeType === "transfer_from") return 3;
  if (method.includes("verify20") || method.includes("permit") || method.includes("transferfrom")) return 2;
  if (method && !methodLooksPlainTransfer(method)) return 1;
  return 0;
}

function methodLooksPlainTransfer(method: string): boolean {
  const compact = method.replace(/\s+/g, "");
  const canonical = compact.replace(/transfer\(address[a-z0-9_]*,uint256[a-z0-9_]*\)/i, "transfer(address,uint256)");
  return canonical === "transfer" ||
    canonical === "transfer(address,uint256)" ||
    canonical === "a9059cbb" ||
    canonical === "transfera9059cbb" ||
    canonical === "transfer(address,uint256)a9059cbb";
}

function balanceTransferToEdge(transfer: BalanceFormingTransfer): ForensicRouteEdge {
  return {
    id: `balance_transfer_seed:${transfer.txHash}:${transfer.fromAddress}:${transfer.toAddress}:${transfer.amountRaw}`,
    txHash: transfer.txHash,
    fromAddress: transfer.fromAddress,
    toAddress: transfer.toAddress,
    amountRaw: transfer.amountRaw,
    timestamp: new Date(transfer.timestamp),
    method: transfer.method ?? "transfer",
    edgeType: transfer.edgeType ?? "normal_transfer",
    economicRole: transfer.economicRole,
    economicProtocol: transfer.economicProtocol
  };
}

function whereSourceBundleScope(
  checkedScope: WhereIsMoneyCoverage["checkedScope"] | undefined
): SourceBundleExposureScope {
  switch (checkedScope) {
    case "transaction_seed":
      return "where_transaction_seed";
    case "requested_amount":
      return "where_requested_amount";
    case "recent_flow":
    case "selected_anchor":
    case "drain_episode":
      return "where_recent_flow";
    case "current_balance":
    default:
      return "where_current_balance";
  }
}

function sourceClassFromPath(
  kind: SourceExposureKind | null,
  path: MoneyOriginPath
): SourceBundleExposureSourceKind {
  switch (kind) {
    case "htx_huobi":
      return "htx_huobi";
    case "allowlisted_cex":
      return "clean_cex";
    case "bridge_router_dex":
    case "cross_chain_boundary":
      return "bridge_router_dex";
    case "unknown_contract":
    case "unknown_cex":
    case "no_name_token_liquidity":
      return "unknown_contract";
    case "mixer":
    case "sanctioned_service":
    case "risky_label":
      return "risky_label";
    case "whitebit":
      return "unknown";
    default:
      if (path.rootSourceType === "allowlist_cex") return "clean_cex";
      if (path.rootSourceType === "risky_label") return "risky_label";
      return "unknown";
  }
}

function sourceClassFromClassification(
  classification: ServiceClassification | null | undefined
): SourceBundleExposureSourceKind {
  if (!classification?.isBoundary || classification.category === "none") return "unknown";
  const evidenceText = [classification.identity, ...classification.evidence].filter(Boolean).join(" ").toLowerCase();
  if (evidenceText.includes("htx") || evidenceText.includes("huobi")) return "htx_huobi";
  if (evidenceText.includes("whitebit")) return "unknown";
  if (classification.category === "cex") {
    const cleanCexPatterns = [
      "binance",
      "okx",
      "coinbase",
      "kraken",
      "bybit",
      "kucoin",
      "gate",
      "bitfinex",
      "bitstamp",
      "bitget",
      "mexc"
    ];
    return cleanCexPatterns.some((pattern) => evidenceText.includes(pattern)) ? "clean_cex" : "unknown";
  }
  if (
    classification.category === "bridge" ||
    classification.category === "bridge_pool" ||
    classification.category === "router" ||
    classification.category === "dex" ||
    classification.category === "swap_adapter" ||
    ((classification.category === "service" || classification.category === "protocol") &&
      /\b(bridge|router|dex|swap)\b/.test(evidenceText))
  ) {
    return "bridge_router_dex";
  }
  if (classification.category === "unknown_contract") return "unknown_contract";
  return "unknown";
}

function parseRawBigInt(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function clampUnitShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function rawAmountShare(amountRaw: string, share: number): string {
  const amount = parseRawBigInt(amountRaw);
  const scaledShare = BigInt(Math.floor(clampUnitShare(share) * 1_000_000));
  return ((amount * scaledShare) / 1_000_000n).toString();
}

function sourceBundleFindingsFromOriginPaths(input: {
  originPaths: MoneyOriginPath[];
  targetAmountRaw: string;
}): SourceBundleExposureFinding[] {
  const findings: SourceBundleExposureFinding[] = [];
  for (const path of input.originPaths) {
    const share = clampUnitShare(selectedMoneyOriginPathShare(path));
    if (share <= 0) continue;
    findings.push({
      sourceClass: sourceClassFromPath(sourceExposureKindFromPath(path), path),
      amountRaw: rawAmountShare(input.targetAmountRaw, share),
      share,
      evidenceTxHashes: path.txHashes,
      stoppedReason: path.stoppedReason,
      proofKind: "selected_amount"
    });
  }
  return findings;
}

function subjectExposureEventsFromSourceEdges(input: {
  sourceAddress: string;
  sourceEdges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null>;
}): SubjectExposureEvent[] {
  const events: SubjectExposureEvent[] = [];
  for (const edge of input.sourceEdges) {
    const isIncoming = sameAddress(edge.toAddress, input.sourceAddress);
    const isOutgoing = sameAddress(edge.fromAddress, input.sourceAddress);
    if (!isIncoming && !isOutgoing) continue;
    const counterparty = isIncoming ? edge.fromAddress : edge.toAddress;
    events.push({
      direction: isIncoming ? "incoming" : "outgoing",
      amountRaw: edge.amountRaw,
      counterparty,
      sourceClass: sourceClassFromClassification(input.classifications.get(classificationCacheKey(counterparty))),
      txHash: edge.txHash,
      timestamp: edge.timestamp.toISOString()
    });
  }
  return events;
}

function selectSubjectExposureCounterpartyClassifications(input: {
  sourceAddress: string;
  sourceEdges: ForensicRouteEdge[];
  maxIncomingClassifications: number;
  maxOutgoingClassifications: number;
}): string[] {
  if (input.maxIncomingClassifications <= 0 && input.maxOutgoingClassifications <= 0) return [];
  type Candidate = {
    address: string;
    amountRaw: bigint;
    latestTimestampMs: number;
  };
  const incomingCounterparties = new Map<string, Candidate>();
  const outgoingCounterparties = new Map<string, Candidate>();
  for (const edge of input.sourceEdges) {
    const isIncoming = sameAddress(edge.toAddress, input.sourceAddress);
    const isOutgoing = sameAddress(edge.fromAddress, input.sourceAddress);
    if (!isIncoming && !isOutgoing) continue;
    const counterparty = isIncoming ? edge.fromAddress : edge.toAddress;
    if (!counterparty) continue;
    const cacheKey = classificationCacheKey(counterparty);
    if (!cacheKey) continue;
    const amountRaw = parseRawBigInt(edge.amountRaw);
    const timestampMs = edge.timestamp.getTime();
    const latestTimestampMs = Number.isFinite(timestampMs) ? timestampMs : 0;
    const counterparties = isIncoming ? incomingCounterparties : outgoingCounterparties;
    const existing = counterparties.get(cacheKey);
    if (!existing) {
      counterparties.set(cacheKey, { address: counterparty, amountRaw, latestTimestampMs });
    } else {
      existing.amountRaw += amountRaw;
      if (latestTimestampMs > existing.latestTimestampMs) {
        existing.latestTimestampMs = latestTimestampMs;
        existing.address = counterparty;
      }
    }
  }

  const sortCandidates = (counterparties: Map<string, Candidate>): string[] => [...counterparties.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (left.amountRaw !== right.amountRaw) return left.amountRaw > right.amountRaw ? -1 : 1;
      if (left.latestTimestampMs !== right.latestTimestampMs) return right.latestTimestampMs - left.latestTimestampMs;
      return leftKey.localeCompare(rightKey);
    })
    .map(([, candidate]) => candidate.address);

  return [...new Set([
    ...sortCandidates(incomingCounterparties).slice(0, input.maxIncomingClassifications),
    ...sortCandidates(outgoingCounterparties).slice(0, input.maxOutgoingClassifications)
  ])];
}

function selectApprovalEnrichmentEdges(input: {
  edges: ForensicRouteEdge[];
  originPaths: MoneyOriginPath[];
  maxCandidates: number;
  mode: "off" | "triggered" | "always";
}): ForensicRouteEdge[] {
  if (input.mode === "off" || input.maxCandidates <= 0) return [];
  const edgesByTxHash = new Map<string, ForensicRouteEdge[]>();
  for (const edge of input.edges) {
    const sameTransaction = edgesByTxHash.get(edge.txHash) ?? [];
    sameTransaction.push(edge);
    edgesByTxHash.set(edge.txHash, sameTransaction);
  }
  const importantTxHashes = new Set<string>();
  const allPathAddresses = new Set<string>();
  const pathAddressSets: Array<{ path: MoneyOriginPath; addresses: Set<string> }> = [];
  for (const path of input.originPaths) {
    const pathAddresses = new Set(path.pathAddresses);
    pathAddressSets.push({ path, addresses: pathAddresses });
    for (const address of path.pathAddresses) allPathAddresses.add(address);
    const isImportant = input.mode === "always" ||
      path.verdict !== "ACCEPTABLE" ||
      path.stoppedReason === "unlabeled_service_boundary" ||
      path.rootSourceType === "decline_boundary";
    if (!isImportant) continue;
    for (const txHash of path.txHashes) importantTxHashes.add(txHash);
  }
  const triggeredContractEdges = input.mode === "triggered"
    ? input.edges.filter((edge) =>
        (edge.edgeType === "transfer_from" || edge.method !== "transfer") &&
        (allPathAddresses.has(edge.fromAddress) || allPathAddresses.has(edge.toAddress))
      )
    : [];
  for (const { path, addresses } of pathAddressSets) {
    if (!triggeredContractEdges.some((edge) => addresses.has(edge.fromAddress) || addresses.has(edge.toAddress))) continue;
    for (const txHash of path.txHashes) importantTxHashes.add(txHash);
  }
  const important = [...importantTxHashes]
    .flatMap((txHash) => edgesByTxHash.get(txHash) ?? []);
  const importantWithTriggeredEdges = dedupeEdges([...triggeredContractEdges, ...important]);
  const importantKeys = new Set(importantWithTriggeredEdges.map(forensicRouteEdgeIdentity));
  const fallback = input.mode === "always"
    ? input.edges
        .filter((edge) => !importantKeys.has(forensicRouteEdgeIdentity(edge)))
        .sort(compareApprovalDrainCandidateAmountDesc)
    : [];
  return dedupeEdges([...importantWithTriggeredEdges, ...fallback]).slice(0, input.maxCandidates);
}

function sumRawAmounts(values: string[]): string {
  return values.reduce((sum, value) => sum + (/^\d+$/.test(value) ? BigInt(value) : 0n), 0n).toString();
}

function selectedTransferAmountRaw(transfer: BalanceFormingTransfer): bigint {
  return parseRawBigInt(transfer.amountUsage?.usedAmountRaw ?? transfer.amountRaw);
}

function rawCoverageRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 1;
  return Number((numerator * 1_000_000_000n) / denominator) / 1_000_000_000;
}

function rebaseTransferAmountUsage(
  transfer: BalanceFormingTransfer,
  denominatorShare: number,
  provenanceTargetAmountRaw: string
): BalanceFormingTransfer {
  if (!transfer.amountUsage || denominatorShare <= 0) return transfer;
  return {
    ...transfer,
    coverageShare: clampUnitShare(transfer.coverageShare / denominatorShare),
    amountUsage: {
      ...transfer.amountUsage,
      anchorAmountRaw: provenanceTargetAmountRaw,
      coverageShare: clampUnitShare(transfer.amountUsage.coverageShare / denominatorShare)
    }
  };
}

function seededBalanceFormingSelection(input: {
  seedTransfers: BalanceFormingTransfer[];
  currentBalanceRaw: string | null;
  requestedAmountRaw?: string | null;
}): BalanceFormingSelection {
  const selectedAmountRaw = sumRawAmounts(input.seedTransfers.map((transfer) => transfer.amountRaw));
  const targetAmountRaw = input.requestedAmountRaw ?? selectedAmountRaw;
  const targetAmount = /^\d+$/.test(targetAmountRaw) ? BigInt(targetAmountRaw) : 0n;
  const selectedAmount = /^\d+$/.test(selectedAmountRaw) ? BigInt(selectedAmountRaw) : 0n;
  const coverageRatio = targetAmount > 0n
    ? Math.min(Number(selectedAmount * 1_000_000n / targetAmount) / 1_000_000, 1)
    : 1;
  return {
    transfers: input.seedTransfers,
    currentBalanceRaw: input.currentBalanceRaw ?? "0",
    requestedAmountRaw: input.requestedAmountRaw ?? null,
    targetAmountRaw,
    selectedAmountRaw,
    coverageRatio,
    selectedVolumeRaw: selectedAmountRaw,
    currentBalanceCoverageRatio: input.currentBalanceRaw && /^\d+$/.test(input.currentBalanceRaw) && BigInt(input.currentBalanceRaw) > 0n
      ? Math.min(Number(BigInt(selectedAmountRaw) * 1_000_000n / BigInt(input.currentBalanceRaw)) / 1_000_000, 1)
      : 1,
    partial: coverageRatio < 0.999,
    provenanceScope: "transaction_seed",
    anchorTransfer: null,
    dataScopeNote: "Transaction check: the checked transaction is the provenance seed.",
    availableInboundTxCount: input.seedTransfers.length,
    coverageExclusions: [],
    selectionMethod: "transaction_seed",
    notes: ["Transaction check: balance-forming transfer was supplied from the checked transaction."]
  };
}

function coverageV2ForSelection(input: {
  selection: BalanceFormingSelection;
  tracedAmountRaw: string | null;
  limitations?: ForensicCoverageV2["limitations"];
  exclusions?: ForensicCoverageV2["exclusions"];
}): ForensicCoverageV2 {
  return buildForensicCoverageV2({
    scope: input.selection.provenanceScope,
    availableInboundTxCount: input.selection.availableInboundTxCount ?? null,
    selectedInboundTxCount: input.selection.transfers.length,
    selectedAmountRaw: /^\d+$/.test(input.selection.selectedAmountRaw) ? input.selection.selectedAmountRaw : null,
    tracedAmountRaw: input.tracedAmountRaw,
    exclusions: [
      ...(input.selection.coverageExclusions ?? []),
      ...(input.exclusions ?? [])
    ],
    limitations: [
      ...(input.selection.coverageLimitations ?? []),
      ...(input.limitations ?? [])
    ]
  });
}

function exactWhereTracedAmountRaw(
  selection: BalanceFormingSelection,
  paths: MoneyOriginPath[],
  fetchedEdges: readonly ForensicRouteEdge[]
): string {
  const exactMovementEvidenceIds = new Set(
    fetchedEdges.filter(forensicRouteEdgeHasExactMovementIdentity).map((edge) => edge.id)
  );
  const pathStepIdentity = new Map<string, boolean>();
  const pathStepKey = (input: { txHash: string; fromAddress: string; toAddress: string; timestamp: string }): string =>
    [input.txHash, input.fromAddress.toLowerCase(), input.toAddress.toLowerCase(), input.timestamp].join(":");
  for (const edge of fetchedEdges) {
    const key = pathStepKey({ ...edge, timestamp: edge.timestamp.toISOString() });
    pathStepIdentity.set(
      key,
      (pathStepIdentity.get(key) ?? true) && forensicRouteEdgeHasExactMovementIdentity(edge)
    );
  }
  const selectedByTxHash = new Map<string, BalanceFormingTransfer[]>();
  const pathsByTxHash = new Map<string, MoneyOriginPath[]>();
  const pathsByEvidenceId = new Map<string, MoneyOriginPath>();
  const selectedEvidenceCounts = new Map<string, number>();
  const pathEvidenceCounts = new Map<string, number>();
  for (const transfer of selection.transfers) {
    selectedByTxHash.set(transfer.txHash, [...(selectedByTxHash.get(transfer.txHash) ?? []), transfer]);
    if (transfer.evidenceId) selectedEvidenceCounts.set(
      transfer.evidenceId,
      (selectedEvidenceCounts.get(transfer.evidenceId) ?? 0) + 1
    );
  }
  for (const path of paths) {
    pathsByTxHash.set(path.balanceTransferTxHash, [...(pathsByTxHash.get(path.balanceTransferTxHash) ?? []), path]);
    if (path.balanceTransferEvidenceId) {
      pathsByEvidenceId.set(path.balanceTransferEvidenceId, path);
      pathEvidenceCounts.set(
        path.balanceTransferEvidenceId,
        (pathEvidenceCounts.get(path.balanceTransferEvidenceId) ?? 0) + 1
      );
    }
  }
  return selection.transfers.reduce((sum, transfer) => {
    if (!transfer.evidenceId || !exactMovementEvidenceIds.has(transfer.evidenceId)) return sum;
    const path = transfer.evidenceId &&
      selectedEvidenceCounts.get(transfer.evidenceId) === 1 &&
      pathEvidenceCounts.get(transfer.evidenceId) === 1
      ? pathsByEvidenceId.get(transfer.evidenceId)
      : selectedByTxHash.get(transfer.txHash)?.length === 1 &&
          pathsByTxHash.get(transfer.txHash)?.length === 1 &&
          !pathsByTxHash.get(transfer.txHash)?.[0]?.balanceTransferEvidenceId
        ? pathsByTxHash.get(transfer.txHash)![0]
        : undefined;
    if (!path || path.rootSourceType === "incomplete" || path.rootSourceType === "unknown") return sum;
    if (!path.steps.every((step) => pathStepIdentity.get(pathStepKey(step)) === true)) return sum;
    if ((path.sourceProvenance ?? []).some((item) =>
      item.proofClass !== "exact" && item.proofClass !== "service_boundary"
    )) return sum;
    return sum + selectedTransferAmountRaw(transfer);
  }, 0n).toString();
}

function balanceTransferCoverageEvidenceId(transfer: BalanceFormingTransfer, ordinal: number): string {
  return transfer.evidenceId ?? [
    "where-transfer",
    transfer.txHash,
    transfer.fromAddress,
    transfer.toAddress,
    transfer.amountRaw,
    transfer.timestamp,
    ordinal
  ].join(":");
}

function broadTargetedHistoryKey(input: BroadTargetedHistoryRequest): string {
  return [
    input.address.toLowerCase(),
    input.targetTimestamp.getTime().toString(),
    input.reason
  ].join(":");
}

function dedupeBroadTargetedHistoryTargets(
  targets: BroadTargetedHistoryRequest[]
): BroadTargetedHistoryRequest[] {
  const byKey = new Map<string, BroadTargetedHistoryRequest>();
  for (const target of targets) {
    byKey.set(broadTargetedHistoryKey(target), target);
  }
  return [...byKey.values()];
}

function pathIntersectsHardEvidence(
  path: MoneyOriginPath,
  hardBadEvidence: WhereIsMoneyAssessment["hardBadEvidence"]
): boolean {
  if (path.rootSourceType === "risky_label") return true;
  const pathEvidenceIds = new Set([
    path.balanceTransferTxHash,
    ...path.txHashes,
    ...path.steps.map((step) => step.txHash)
  ].map((id) => id.toLowerCase()));
  return hardBadEvidence.some((evidence) =>
    evidence.evidenceIds.some((id) => pathEvidenceIds.has(id.toLowerCase()))
  );
}

function postAssessmentBroadFallbackTargets(input: {
  originPaths: MoneyOriginPath[];
  assessment: WhereIsMoneyAssessment;
}): BroadTargetedHistoryRequest[] {
  if (input.assessment.hardBadEvidence.length === 0) return [];
  const reason = "hard_evidence_requires_full_coverage" as const;

  const targets: BroadTargetedHistoryRequest[] = [];
  for (const path of input.originPaths) {
    if (!pathIntersectsHardEvidence(path, input.assessment.hardBadEvidence)) {
      // ponytail: global hard evidence without a tx/path intersection is not fanned out to every unresolved source.
      continue;
    }
    for (const sourceProvenance of path.sourceProvenance ?? []) {
      if (sourceProvenance.proofClass !== "unresolved") continue;
      const targetTimestamp = new Date(sourceProvenance.targetTimestamp);
      if (!Number.isFinite(targetTimestamp.getTime())) continue;
      targets.push({
        address: sourceProvenance.targetFromAddress,
        targetTimestamp,
        queuedReason: "where_is_money_hop",
        reason
      });
    }
  }
  return targets;
}

export async function runWhereIsMoneyCheck(
  deps: WhereIsMoneyDeps,
  input: RunWhereIsMoneyCheckInput
): Promise<WhereIsMoneyReport> {
  const nowMs = input.now ?? Date.now;
  throwIfAborted(input.abortSignal);
  const sourceAddress = input.subjectAddress ?? input.sourceAddress;
  if (!sourceAddress) {
    throw new Error("runWhereIsMoneyCheck requires sourceAddress or subjectAddress");
  }
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const fallbackMinTransferCount = input.recentFallbackMinTransferCount ?? DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT;
  const fallbackTransferLimit = input.recentFallbackTransferLimit ?? DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT;
  const fastWalletRisk = await deps.getFastWalletRisk?.(sourceAddress) ?? null;
  const currentBalanceRaw = await deps.getTrc20Balance(sourceAddress, TRON_USDT_CONTRACT_ADDRESS).catch(() => null);
  const emitProgress = async (patch: ForensicJobProgressPatch): Promise<void> => {
    await input.onProgress?.(patch);
  };
  const fetchedAddresses = new Set<string>();
  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const repairedExactWindowEdges: ForensicRouteEdge[] = [];
  const classifications = new Map<string, ServiceClassification | null>();
  const enrichmentResults: SelectiveTransactionEnrichmentResult[] = [];
  const indexedMovementCache = new Map<string, ForensicRouteEdge[]>();
  let lastEnrichmentHeartbeatAt = Number.NEGATIVE_INFINITY;
  const enrichTransactions = async (enrichmentInput: {
    routeEdges: ForensicRouteEdge[];
    movements?: ForensicRouteEdge[];
    assertions?: RouteLinkedAssertionInput[];
    hardTxHashes?: string[];
    unresolvedEconomicRoleTxHashes?: string[];
    emitHeartbeat?: boolean;
  }): Promise<SelectiveTransactionEnrichmentResult | null> => {
    if (!deps.selectiveTransactionEnricher || enrichmentInput.routeEdges.length === 0) return null;
    const missingHashes = [...new Set(enrichmentInput.routeEdges.map((edge) => edge.txHash.toLowerCase()))]
      .filter((hash) => !indexedMovementCache.has(hash));
    if (deps.listIndexedMovementsByHashes && missingHashes.length > 0) {
      const indexed = await deps.listIndexedMovementsByHashes(missingHashes);
      for (const hash of missingHashes) indexedMovementCache.set(hash, []);
      for (const edge of indexed) {
        const hash = edge.txHash.toLowerCase();
        indexedMovementCache.set(hash, [...(indexedMovementCache.get(hash) ?? []), edge]);
      }
    }
    const indexedMovements = enrichmentInput.routeEdges.flatMap((edge) =>
      indexedMovementCache.get(edge.txHash.toLowerCase()) ?? []
    );
    let heartbeatFailure: unknown;
    let heartbeatWrite = Promise.resolve();
    const writeHeartbeat = (force: boolean): Promise<void> => {
      heartbeatWrite = heartbeatWrite.then(async () => {
        const current = nowMs();
        if (!force && current - lastEnrichmentHeartbeatAt < 30_000) return;
        lastEnrichmentHeartbeatAt = current;
        await emitProgress({ jobHeartbeatAt: new Date(current).toISOString() });
      }).catch((error) => {
        heartbeatFailure ??= error;
      });
      return heartbeatWrite;
    };
    const heartbeatTimer = enrichmentInput.emitHeartbeat && input.onProgress
      ? setInterval(() => { void writeHeartbeat(false); }, 30_000)
      : null;
    let result: SelectiveTransactionEnrichmentResult;
    try {
      result = await deps.selectiveTransactionEnricher.enrich({
        mode: "subject",
        routeEdges: enrichmentInput.routeEdges,
        movements: indexedMovements.length > 0
          ? indexedMovements
          : enrichmentInput.movements ?? enrichmentInput.routeEdges,
        assertions: enrichmentInput.assertions,
        hardTxHashes: enrichmentInput.hardTxHashes,
        unresolvedEconomicRoleTxHashes: enrichmentInput.unresolvedEconomicRoleTxHashes
      }, {
        signal: input.abortSignal,
        ...(enrichmentInput.emitHeartbeat ? {
          onCandidateResolved: ({ completed, total }) => writeHeartbeat(completed === total)
        } : {})
      });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await heartbeatWrite;
    }
    if (heartbeatFailure) throw heartbeatFailure;
    enrichmentResults.push(result);
    return result;
  };
  const getResolvedFullTransaction = async (txHash: string): Promise<unknown | null> => {
    if (deps.selectiveTransactionEnricher) {
      return deps.selectiveTransactionEnricher.getFullTransactionInfo(txHash);
    }
    return deps.getTransaction?.(txHash).catch(() => null) ?? null;
  };
  const exactGasFreeAccounts = new Set<string>();
  const resolveEconomicContext = async (routeEdge: ForensicRouteEdge): Promise<ForensicRouteEdge> => {
    await enrichTransactions({ routeEdges: [routeEdge] });
    const context = extractGasFreeEdgeContext(await getResolvedFullTransaction(routeEdge.txHash), routeEdge);
    if (!context) return routeEdge;
    exactGasFreeAccounts.add(context.settlement.accountAddress);
    return {
      ...routeEdge,
      economicRole: context.movement.role,
      economicProtocol: "tron_gasfree"
    };
  };
  const resolveBalanceTransfer = async (transfer: BalanceFormingTransfer): Promise<BalanceFormingTransfer> => {
    const resolvedEdge = await resolveEconomicContext(balanceTransferToEdge(transfer));
    return {
      ...transfer,
      economicRole: resolvedEdge.economicRole,
      economicProtocol: resolvedEdge.economicProtocol
    };
  };
  const broadTargetedHistoryRequests = new Map<string, Promise<true>>();
  const ensureBroadTargetedHistory: WhereIsMoneyDeps["ensureBroadTargetedHistory"] = deps.ensureBroadTargetedHistory
    ? (request) => {
        const key = broadTargetedHistoryKey(request);
        const existing = broadTargetedHistoryRequests.get(key);
        if (existing) return existing;
        const queued = deps.ensureBroadTargetedHistory?.(request) ?? Promise.resolve(true);
        broadTargetedHistoryRequests.set(key, queued);
        return queued;
      }
    : undefined;
  let globalAddressBudgetExhausted = false;
  let recoverableEdgeFetchFailed = false;
  const providerCoverageLimitationIds = new Set<string>();
  const localCoverageLimitationIds = new Set<string>();
  let lastTraceProgressAt = nowMs();
  const emitTraceProgress = async (): Promise<void> => {
    const now = nowMs();
    if (
      fetchedAddresses.size % TRACE_PROGRESS_ADDRESS_INTERVAL !== 0 &&
      now - lastTraceProgressAt < TRACE_PROGRESS_MIN_INTERVAL_MS
    ) {
      return;
    }
    lastTraceProgressAt = now;
    await emitProgress({
      jobPhase: "money_origin_trace",
      performanceTiming: {
        whereIsMoneyFetchedAddressCount: fetchedAddresses.size,
        whereIsMoneyEdgeCacheSize: edgeCache.size,
        whereIsMoneyMaxAddressFetches: maxAddressFetches
      }
    });
  };
  const getBaseCachedClassification = async (address: string): Promise<ServiceClassification | null> => {
    throwIfAborted(input.abortSignal);
    const cacheKey = classificationCacheKey(address);
    if (classifications.has(cacheKey)) return classifications.get(cacheKey) ?? null;
    const classification = await deps.getClassificationForAddress(cacheKey).catch(() => null);
    throwIfAborted(input.abortSignal);
    classifications.set(cacheKey, classification);
    return classification;
  };
  const getCachedClassification = async (address: string): Promise<ServiceClassification | null> => {
    const base = await getBaseCachedClassification(address);
    const hardPolicyIdentity = matchSanctionedCryptoService([
      base?.identity ?? "",
      ...(base?.evidence ?? [])
    ].join(" "));
    if (exactGasFreeAccounts.has(address) && !hardPolicyIdentity) {
      return {
        category: "service",
        identity: "GasFree Account",
        confidence: "high",
        evidence: ["gasfree_settlement:exact_account"],
        isBoundary: false
      };
    }
    return base;
  };
  type WhereTraceEdgeFetchOptions = {
    latestTimestamp?: Date;
    deferBroadTargetedHistory?: boolean;
    targetEdge?: ForensicRouteEdge | null;
    expectedAmountRaw?: string | null;
  };
  const traceEdgeCacheKey = (address: string, options: WhereTraceEdgeFetchOptions = {}): string => {
    const base = options.latestTimestamp ? `${address}:${options.latestTimestamp.getTime()}` : address;
    if (options.latestTimestamp && options.deferBroadTargetedHistory === true && options.targetEdge) {
      const amountRaw = options.expectedAmountRaw && /^\d+$/.test(options.expectedAmountRaw)
        ? options.expectedAmountRaw
        : options.targetEdge.amountRaw;
      return [
        base,
        "balance_slice",
        options.targetEdge.txHash,
        options.targetEdge.fromAddress,
        options.targetEdge.toAddress,
        amountRaw
      ].join(":");
    }
    return base;
  };
  const fetchCachedEdgesForAddress = async (
    address: string,
    options: WhereTraceEdgeFetchOptions = {}
  ): Promise<ForensicRouteEdge[]> => {
    throwIfAborted(input.abortSignal);
    const cacheKey = traceEdgeCacheKey(address, options);
    const cached = edgeCache.get(cacheKey);
    if (cached) return cached;
    if (fetchedAddresses.size >= maxAddressFetches) {
      globalAddressBudgetExhausted = true;
      await emitTraceProgress();
      return [];
    }
    fetchedAddresses.add(address);
    await emitTraceProgress();
    const fetchedEdges = await fetchEdgesOrPartial(
      () => deps.fetchEdgesForAddress(address, options),
      () => {
        recoverableEdgeFetchFailed = true;
      }
    );
    throwIfAborted(input.abortSignal);
    const windowedEdges = windowEdges(fetchedEdges, input);
    const historyCoverage = deps.getHistoryCoverageForAddress
      ? await deps.getHistoryCoverageForAddress(address, options).catch(() => null)
      : null;
    const coverageEvidenceId = `where:coverage:${address}:${options.latestTimestamp?.getTime() ?? input.windowEnd.getTime()}`;
    if (historyCoverage?.providerInconsistent === true) {
      recoverableEdgeFetchFailed = true;
      providerCoverageLimitationIds.add(`${coverageEvidenceId}:provider`);
    }
    if (
      historyCoverage?.providerCapHit === true ||
      historyCoverage?.statusReason === "partial_provider_cap" ||
      historyCoverage?.statusReason === "partial_provider_inconsistent" ||
      historyCoverage?.statusReason === "partial_rate_limited"
    ) {
      providerCoverageLimitationIds.add(`${coverageEvidenceId}:provider`);
    }
    if (
      historyCoverage?.localMaterializationStatus === "local_limit" ||
      historyCoverage?.localMaterializationStatus === "read_failed"
    ) {
      localCoverageLimitationIds.add(`${coverageEvidenceId}:local`);
    }
    const shouldUseFallback = fallbackMinTransferCount > 0 &&
      fallbackTransferLimit > 0 &&
      historyCoverage?.localMaterializationStatus == null &&
      windowedEdges.length < fallbackMinTransferCount;
    const latestEdges = shouldUseFallback
      ? await fetchEdgesOrPartial(
          () => deps.fetchLatestEdgesForAddress?.(address, fallbackTransferLimit) ?? Promise.resolve(fetchedEdges),
          () => {
            recoverableEdgeFetchFailed = true;
          }
        )
      : [];
    throwIfAborted(input.abortSignal);
    const edges = dedupeEdges([...windowedEdges, ...latestEdges]);
    edgeCache.set(cacheKey, edges);
    return edges;
  };
  const hasKnownCurrentBalance = currentBalanceRaw !== null && /^\d+$/.test(currentBalanceRaw);
  const currentBalanceAmount = hasKnownCurrentBalance ? BigInt(currentBalanceRaw) : 0n;
  const hasRequestedAmount = typeof input.requestedAmountRaw === "string" &&
    /^\d+$/.test(input.requestedAmountRaw) &&
    BigInt(input.requestedAmountRaw) > 0n;
  const lowBalanceThreshold = BigInt(LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW);
  let selection: BalanceFormingSelection;
  let sourceEdges: ForensicRouteEdge[] = [];
  if (input.seedTransfers) {
    selection = seededBalanceFormingSelection({
      seedTransfers: input.seedTransfers,
      currentBalanceRaw,
      requestedAmountRaw: input.requestedAmountRaw
    });
  } else {
    sourceEdges = await fetchCachedEdgesForAddress(sourceAddress);
    const shouldUseRecentFlow =
      !hasRequestedAmount &&
      hasKnownCurrentBalance &&
      currentBalanceAmount < lowBalanceThreshold;
    selection = shouldUseRecentFlow
      ? await selectRecentFlowProvenanceTransfers({
          subjectAddress: sourceAddress,
          currentBalanceRaw,
          edges: sourceEdges,
          resolveEconomicContext
        })
      : selectBalanceFormingTransfers({
          subjectAddress: sourceAddress,
          currentBalanceRaw,
          requestedAmountRaw: input.requestedAmountRaw,
          edges: sourceEdges
        });
  }
  const balanceFormingTransfers: BalanceFormingTransfer[] = [];
  for (const transfer of selection.transfers) {
    balanceFormingTransfers.push(await resolveBalanceTransfer(transfer));
  }
  const selectedTargetAmount = parseRawBigInt(selection.targetAmountRaw);
  const exactFeeSelectedAmount = balanceFormingTransfers.reduce((sum, transfer) =>
    isGasFreeServiceFeeEdge(transfer) ? sum + selectedTransferAmountRaw(transfer) : sum
  , 0n);
  const cappedExactFeeSelectedAmount = exactFeeSelectedAmount > selectedTargetAmount
    ? selectedTargetAmount
    : exactFeeSelectedAmount;
  const provenanceTargetAmount = selectedTargetAmount - cappedExactFeeSelectedAmount;
  const provenanceTargetAmountRaw = provenanceTargetAmount.toString();
  const provenanceDenominatorShare = selectedTargetAmount > 0n
    ? rawCoverageRatio(provenanceTargetAmount, selectedTargetAmount)
    : 0;
  const traceBalanceFormingTransfers = balanceFormingTransfers.map((transfer) =>
    isGasFreeServiceFeeEdge(transfer)
      ? transfer
      : rebaseTransferAmountUsage(transfer, provenanceDenominatorShare, provenanceTargetAmountRaw)
  );
  const provenanceSelectedAmount = (() => {
    const selectedAmount = parseRawBigInt(selection.selectedAmountRaw);
    return selectedAmount > cappedExactFeeSelectedAmount
      ? selectedAmount - cappedExactFeeSelectedAmount
      : 0n;
  })();
  const roleFilteredProvenanceSelection: BalanceFormingSelection = {
    ...selection,
    transfers: traceBalanceFormingTransfers.filter((transfer) => !isGasFreeServiceFeeEdge(transfer)),
    targetAmountRaw: provenanceTargetAmountRaw,
    selectedAmountRaw: provenanceSelectedAmount.toString(),
    selectedVolumeRaw: provenanceSelectedAmount.toString(),
    coverageRatio: rawCoverageRatio(provenanceSelectedAmount, provenanceTargetAmount),
    partial: selection.partial || (provenanceTargetAmount > 0n && provenanceSelectedAmount < provenanceTargetAmount)
  };
  const crossChainStage2Enabled = input.crossChainStage2Enabled === true;
  const crossChainManualDeepMode = input.crossChainManualDeepMode === true;
  await emitProgress({
    jobPhase: "money_origin_trace",
    crossChainStage2Progress: {
      enabled: crossChainStage2Enabled,
      manualDeepMode: crossChainManualDeepMode,
      status: crossChainStage2Enabled ? "pending" : "not_applicable"
    }
  });
  let drainEpisode: MoneyOriginDrainEpisode | null = null;
  if (selection.anchorTransfer?.direction === "outgoing") {
    const serviceAddresses = new Set<string>();
    const sourceOutgoingDestinations = new Map<string, { address: string; amountRaw: bigint; timestampMs: number }>();
    const anchorEdge = sourceEdges.find((edge) =>
      edge.txHash === selection.anchorTransfer?.txHash &&
      edge.fromAddress.toLowerCase() === sourceAddress.toLowerCase()
    );
    const anchorTimestampMs = anchorEdge?.timestamp.getTime() ?? new Date(selection.anchorTransfer.timestamp).getTime();
    const windowStartMs = anchorTimestampMs - DEFAULT_DRAIN_EPISODE_WINDOW_MS;
    for (const edge of sourceEdges) {
      if (edge.fromAddress.toLowerCase() !== sourceAddress.toLowerCase()) continue;
      if (!/^\d+$/.test(edge.amountRaw) || BigInt(edge.amountRaw) <= 0n) continue;
      const timestampMs = edge.timestamp.getTime();
      if (timestampMs < windowStartMs || timestampMs > anchorTimestampMs) continue;
      const normalizedAddress = edge.toAddress.toLowerCase();
      const amountRaw = BigInt(edge.amountRaw);
      const existing = sourceOutgoingDestinations.get(normalizedAddress);
      if (!existing || amountRaw > existing.amountRaw || (amountRaw === existing.amountRaw && timestampMs > existing.timestampMs)) {
        sourceOutgoingDestinations.set(normalizedAddress, { address: edge.toAddress, amountRaw, timestampMs });
      }
    }
    const classificationCandidates = [...sourceOutgoingDestinations.entries()]
      .sort(([, left], [, right]) => {
        if (left.amountRaw !== right.amountRaw) return left.amountRaw > right.amountRaw ? -1 : 1;
        return right.timestampMs - left.timestampMs;
      })
      .slice(0, MAX_DRAIN_EPISODE_SERVICE_DESTINATION_CLASSIFICATIONS);
    throwIfAborted(input.abortSignal);
    await Promise.all(classificationCandidates.map(async ([normalizedAddress, candidate]) => {
      const classification = await getCachedClassification(candidate.address);
      if (classification?.isBoundary) {
        serviceAddresses.add(normalizedAddress);
      }
    }));
    throwIfAborted(input.abortSignal);
    drainEpisode = detectDrainEpisode({
      subjectAddress: sourceAddress,
      anchorTxHash: selection.anchorTransfer.txHash,
      selectedAmountRaw: roleFilteredProvenanceSelection.selectedAmountRaw,
      selectedFundingTxHashes: roleFilteredProvenanceSelection.transfers.map((transfer) => transfer.txHash),
      edges: sourceEdges,
      serviceAddresses
    });
  }
  const checkedScope = checkedScopeFor(selection.provenanceScope, drainEpisode, selection.anchorTransfer ?? null);
  const currentCoverageLimitations = (): ForensicCoverageV2["limitations"] => [
    ...(recoverableEdgeFetchFailed || providerCoverageLimitationIds.size > 0
      ? [{
          reason: "provider_history_unavailable" as const,
          evidenceIds: providerCoverageLimitationIds.size > 0
            ? [...providerCoverageLimitationIds]
            : ["where:coverage:provider-history"]
        }]
      : []),
    ...(globalAddressBudgetExhausted || localCoverageLimitationIds.size > 0
      ? [{
          reason: "local_materialization_failed" as const,
          evidenceIds: localCoverageLimitationIds.size > 0
            ? [...localCoverageLimitationIds]
            : ["where:coverage:address-budget"]
        }]
      : [])
  ];

  if (selection.transfers.length === 0) {
    const limitations = currentCoverageLimitations();
    const coverageV2 = coverageV2ForSelection({
      selection,
      tracedAmountRaw: limitations.length > 0 ? null : "0",
      limitations
    });
    const hasMeaningfulRecentFlow = selection.provenanceScope === "recent_flow" && Boolean(selection.anchorTransfer);
    if (input.mode === "wallet_profile" && rawBalanceIsZero(currentBalanceRaw) && !hasMeaningfulRecentFlow) {
      const labels = await deps.getLabelsForAddress(sourceAddress).catch(() => []);
      return publishFreshWhereScoreResultV2(walletProfileZeroBalanceReport({
        sourceAddress,
        currentBalanceRaw,
        requestedAmountRaw: input.requestedAmountRaw,
        fastWalletRisk,
        labels,
        maxDepth,
        provenanceScope: selection.provenanceScope,
        anchorTransfer: selection.anchorTransfer ?? null,
        drainEpisode,
        checkedScope,
        anchorCoverageRatio: selection.coverageRatio,
        episodeCoverageRatio: drainEpisode?.episodeCoverageRatio ?? null,
        coverageV2
      }));
    }
    return publishFreshWhereScoreResultV2(fallbackReviewReport({
      sourceAddress,
      currentBalanceRaw,
      requestedAmountRaw: selection.requestedAmountRaw,
      targetAmountRaw: selection.targetAmountRaw,
      fastWalletRisk,
      maxDepth,
      fetchedAddressCount: fetchedAddresses.size,
      provenanceScope: selection.provenanceScope,
      anchorTransfer: selection.anchorTransfer ?? null,
      lowBalanceThresholdRaw: selection.provenanceScope === "recent_flow"
        ? LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW
        : null,
      dataScopeNote: selection.dataScopeNote ?? null,
      drainEpisode,
      checkedScope,
      selectionMethod: selection.selectionMethod,
      recentFlowPrincipalTransfers: selection.recentFlowPrincipalTransfers,
      anchorCoverageRatio: selection.coverageRatio,
      episodeCoverageRatio: drainEpisode?.episodeCoverageRatio ?? null,
      technicalFailure: recoverableEdgeFetchFailed
        ? { scoreBlockedReason: "provider_error", technicalStatus: "provider_error" }
        : null,
      notes: selection.notes.length > 0 ? selection.notes : ["No balance-forming inbound USDT transfers were available; manual review required."],
      coverageV2
    }));
  }

  const fetchEdgesForAddress = async (
    address: string,
    options?: WhereTraceEdgeFetchOptions
  ): Promise<ForensicRouteEdge[]> => {
    throwIfAborted(input.abortSignal);
    return fetchCachedEdgesForAddress(address, options);
  };
  const repairSourceProvenanceWindow = deps.repairSourceProvenanceWindow
    ? async (repairInput: Parameters<NonNullable<WhereIsMoneyDeps["repairSourceProvenanceWindow"]>>[0]) => {
        const repaired = await deps.repairSourceProvenanceWindow!(repairInput);
        repairedExactWindowEdges.push(...(repaired?.traceBundle?.members.map((member) => member.edge) ?? []));
        return repaired;
      }
    : undefined;

  throwIfAborted(input.abortSignal);
  const originPaths: MoneyOriginPath[] = [];
  for (const balanceTransfer of traceBalanceFormingTransfers) {
    originPaths.push(await traceMoneyOriginPath({
      subjectAddress: sourceAddress,
      balanceTransfer,
      maxDepth,
      beamWidth,
      maxAddressFetches,
      maxEdgesPerAddress,
      minAmountPreservationRatio: input.minAmountPreservationRatio,
      fetchEdgesForAddress,
      getHistoryCoverageForAddress: deps.getHistoryCoverageForAddress,
      repairSourceProvenanceWindow,
      requestCandidateWindows: deps.requestCandidateWindows,
      ensureBroadTargetedHistory,
      getLabelsForAddress: deps.getLabelsForAddress,
      getClassificationForAddress: getCachedClassification,
      resolveEconomicContext
    }));
  }
  const provenanceOriginPaths = originPaths.filter((path) => !isExactGasFreeServiceFeePath(path));
  const exactGasFreeFeeOnly = originPaths.length > 0 && originPaths.every(isExactGasFreeServiceFeePath);
  throwIfAborted(input.abortSignal);
  const provenanceBalanceFormingTransfers = traceBalanceFormingTransfers.filter((_, index) =>
    !isExactGasFreeServiceFeePath(originPaths[index])
  );
  const provenanceSelection: BalanceFormingSelection = {
    ...roleFilteredProvenanceSelection,
    transfers: roleFilteredProvenanceSelection.transfers.filter((transfer) =>
      provenanceBalanceFormingTransfers.some((candidate) => candidate.txHash === transfer.txHash)
    )
  };
  const senderInteractionProfiles = await Promise.all(provenanceBalanceFormingTransfers.map(async (balanceTransfer) =>
    buildMoneyOriginSenderInteractionProfile({
      subjectAddress: sourceAddress,
      balanceTransfer,
      edges: await fetchCachedEdgesForAddress(balanceTransfer.fromAddress)
    })
  ));
  let approvalDrainProvenanceProfiles: WhereIsMoneyReport["approvalDrainProvenanceProfiles"] = [];
  let approvalDrainReviewFindings: NonNullable<WhereIsMoneyReport["approvalDrainReviewFindings"]> = [];
  const approvalMode = input.approvalEnrichmentMode ?? DEFAULT_APPROVAL_ENRICHMENT_MODE;
  const maxApprovalCandidates = input.maxApprovalCandidates ?? DEFAULT_MAX_APPROVAL_CANDIDATES;
  const effectiveApprovalCandidateLimit = Math.max(0, Math.min(
    maxApprovalCandidates,
    input.maxContractTransactionInfoFetches ?? Number.POSITIVE_INFINITY
  ));
  const allFetchedEdges = dedupeEdges([
    ...balanceFormingTransfers.map(balanceTransferToEdge),
    ...edgeCache.values()
  ].flat());
  const optionalApprovalEdges = selectApprovalEnrichmentEdges({
    edges: allFetchedEdges,
    originPaths,
    maxCandidates: effectiveApprovalCandidateLimit,
    mode: approvalMode
  });
  const routeAddresses = [...new Set(allFetchedEdges.flatMap((edge) => [
    edge.fromAddress,
    edge.toAddress,
    ...(edge.callerAddress ? [edge.callerAddress] : []),
    ...(edge.contractAddress ? [edge.contractAddress] : [])
  ]))];
  const routeTxHashes = [...new Set(allFetchedEdges.map((edge) => edge.txHash.toLowerCase()))];
  const routeAssertions = await deps.listActiveRouteAssertions?.({
    addresses: routeAddresses,
    txHashes: routeTxHashes
  }).catch(() => []) ?? [];
  await enrichTransactions({
    routeEdges: allFetchedEdges,
    assertions: routeAssertions,
    emitHeartbeat: true,
    unresolvedEconomicRoleTxHashes: approvalMode === "off"
      ? []
      : optionalApprovalEdges.map((edge) => edge.txHash)
  });
  const transactionInfoEnrichment = mergeTransactionInfoEnrichment(enrichmentResults);
  const hardEnrichmentHashes = new Set(
    (transactionInfoEnrichment?.decisions ?? [])
      .filter((decision) => decision.priority === "hard")
      .map((decision) => decision.txHash)
  );
  const approvalEdges = dedupeEdges([
    ...optionalApprovalEdges,
    ...allFetchedEdges.filter((edge) => hardEnrichmentHashes.has(edge.txHash.toLowerCase()))
  ]);
  const hasApprovalEnrichmentDeps = Boolean(
    (deps.selectiveTransactionEnricher || deps.getTransaction) && deps.listTrc20ApprovalChanges
  );
  const approvalBudgetNote = approvalMode === "off"
    ? hardEnrichmentHashes.size > 0
      ? `Optional approval exploration disabled; checked ${hardEnrichmentHashes.size} hard evidence transaction(s).`
      : "Approval/contract enrichment disabled for this run."
    : effectiveApprovalCandidateLimit <= 0
      ? "Optional approval/contract enrichment skipped because its context budget is zero."
    : approvalEdges.length > 0 && !hasApprovalEnrichmentDeps
      ? "Approval/contract enrichment skipped because transaction or approval lookup dependencies are unavailable."
    : approvalEdges.length > 0
      ? `Approval/contract enrichment budget: checked ${approvalEdges.length} candidate edge(s).`
      : "Approval/contract enrichment skipped because no contract/service trigger was found.";
  let approvalEnrichmentOutcomeNote: string | null = null;
  if (approvalEdges.length > 0 && hasApprovalEnrichmentDeps && deps.listTrc20ApprovalChanges) {
    throwIfAborted(input.abortSignal);
    const edgeAddresses = new Set(approvalEdges.flatMap((edge) => [edge.fromAddress, edge.toAddress]));
    await Promise.all([...edgeAddresses].map((address) => getCachedClassification(address)));
    throwIfAborted(input.abortSignal);
    const contractProfiles = await buildApprovalDrainContractProfiles({
      edges: approvalEdges,
      classifications,
      getCachedClassification,
      getTransaction: getResolvedFullTransaction,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile,
      maxCandidates: effectiveApprovalCandidateLimit
    });
    const approvalDrainAnalysis = await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: sourceAddress,
      edges: approvalEdges,
      classifications,
      contractProfiles,
      deps: {
        getTransaction: getResolvedFullTransaction,
        listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
        getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
      },
      maxCandidates: effectiveApprovalCandidateLimit,
      approvalChangeLookupLimit: 10
    }).catch(() => ({ profiles: [], reviewFindings: [] }));
    throwIfAborted(input.abortSignal);
    approvalDrainProvenanceProfiles = approvalDrainAnalysis.profiles;
    approvalDrainReviewFindings = approvalDrainAnalysis.reviewFindings;
    if (approvalEdges.length > 0) {
      approvalEnrichmentOutcomeNote = transactionInfoEnrichment?.coverageStatus === "coverage_incomplete"
        ? "Approval/contract enrichment result: final transaction evidence is incomplete for at least one candidate."
        : `Approval/contract enrichment result: resolved ${approvalEdges.length} candidate edge(s) through shared transaction evidence.`;
    }
  }
  const contractDrivenEvidence = await buildContractDrivenEvidenceProfiles({
    subjectAddress: sourceAddress,
    edges: allFetchedEdges,
    classifications,
    approvalDrainProvenanceProfiles,
    getTransaction: deps.selectiveTransactionEnricher || deps.getTransaction
      ? getResolvedFullTransaction
      : undefined,
    fetchEdgesForAddress,
    maxTransactionInfoFetches: input.maxContractTransactionInfoFetches ?? 2000,
    maxSourceActivityChecks: Math.min(20, input.maxContractTransactionInfoFetches ?? 20),
    incomingClassificationMode: "method_prefiltered"
  });
  const combined = combineMoneyOriginDecision(provenanceOriginPaths.length > 0 ? provenanceOriginPaths : originPaths);
  const exactFast = exactFastHardEvidence(fastWalletRisk);
  const approvalDrainScore = approvalDrainProvenanceProfiles[0]?.score ?? 0;
  const fastDecline = exactFast.length > 0;
  const approvalDrainDecline = approvalDrainScore >= 70;
  const deterministicDecision = fastDecline || approvalDrainDecline ? "DECLINE" : combined.decision;
  const contractLlmVerdicts: WhereIsMoneyReport["contractLlmVerdicts"] = [];
  const coverage: WhereIsMoneyCoverage = {
    selectedInboundTxCount: balanceFormingTransfers.length,
    currentBalanceRaw,
    requestedAmountRaw: selection.requestedAmountRaw,
    targetAmountRaw: selection.targetAmountRaw,
    selectedAmountRaw: selection.selectedAmountRaw,
    coverageRatio: selection.coverageRatio,
    drainEpisode,
    checkedScope,
    anchorCoverageRatio: selection.coverageRatio,
    episodeCoverageRatio: drainEpisode?.episodeCoverageRatio ?? null,
    selectedInboundVolumeRaw: selection.selectedVolumeRaw,
    currentBalanceCoverageRatio: selection.currentBalanceCoverageRatio,
    provenanceScope: selection.provenanceScope,
    selectionMethod: selection.selectionMethod,
    anchorTransfer: selection.anchorTransfer ?? null,
    lowBalanceThresholdRaw: selection.provenanceScope === "recent_flow"
      ? LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW
      : null,
    dataScopeNote: selection.dataScopeNote ?? null,
    maxDepth,
    fetchedAddressCount: fetchedAddresses.size,
    questionStatus: "applicable",
    partial: selection.partial || globalAddressBudgetExhausted || provenanceOriginPaths.some((path) => path.verdict === "REVIEW")
      || transactionInfoEnrichment?.coverageStatus === "coverage_incomplete",
    notes: [
      selection.provenanceScope === "recent_flow"
        ? "Recent-flow approximation: current balance is low, so the report analyzes recent meaningful wallet flow rather than current balance origin."
        : selection.provenanceScope === "requested_amount" || selection.provenanceScope === "transaction_seed"
          ? "Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount or checked transaction."
          : "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.",
      ...selection.notes,
      ...(globalAddressBudgetExhausted ? [`Trace reached global maxAddressFetches=${maxAddressFetches}; source remains partially proven.`] : []),
      approvalBudgetNote,
      ...(approvalEnrichmentOutcomeNote ? [approvalEnrichmentOutcomeNote] : []),
      ...(transactionInfoEnrichment?.technicalStatus === "technical_unknown"
        ? ["Transaction evidence incomplete: raw and full transaction providers did not produce final evidence."]
        : []),
      ...provenanceOriginPaths
        .filter((path) => path.verdict === "REVIEW")
        .map((path) => `${path.balanceTransferTxHash}: ${path.reasons[0]}`)
    ]
  };
  const ageSignals = buildMoneyOriginAgeSignals({
    subjectAddress: sourceAddress,
    balanceFormingTransfers: provenanceBalanceFormingTransfers,
    edgesByAddress: edgeCache,
    now: input.windowEnd,
    largeBalanceRaw: currentBalanceRaw
  });
  const buildWhereSourceBundleExposure = (assessmentCoverage: WhereIsMoneyCoverage) => {
    if (provenanceTargetAmount <= 0n) return undefined;
    const sourceBundleTargetAmountRaw = provenanceTargetAmountRaw;
    const findings = sourceBundleFindingsFromOriginPaths({
      originPaths: provenanceOriginPaths,
      targetAmountRaw: sourceBundleTargetAmountRaw
    });
    const budget = {
      maxDepth,
      fetchedAddressCount: fetchedAddresses.size,
      maxAddressFetches,
      liveTransferReadCount: allFetchedEdges.length,
      skippedAddressCount: 0,
      exhausted: assessmentCoverage.partial,
      exhaustedPhase: assessmentCoverage.partial ? "trace" : null
    } as const;
    const unresolvedBoundary = findings.length === 0 && budget.exhausted
      ? {
          kind: "unknown" as const,
          affectedShare: 1,
          reason: "Source bundle coverage-limited unknown boundary remains after the graph budget stopped.",
          evidenceTxHashes: []
        }
      : unresolvedBoundaryFromFindings({ findings, budget });
    return buildSourceBundleExposure({
      scope: whereSourceBundleScope(assessmentCoverage.checkedScope),
      targetAmountRaw: sourceBundleTargetAmountRaw,
      findings,
      budget,
      unresolvedBoundary
    });
  };
  let sourceBundleExposure = buildWhereSourceBundleExposure(coverage);
  const subjectExposureCounterpartyClassifications = selectSubjectExposureCounterpartyClassifications({
    sourceAddress,
    sourceEdges,
    maxIncomingClassifications: MAX_SUBJECT_EXPOSURE_INCOMING_COUNTERPARTY_CLASSIFICATIONS,
    maxOutgoingClassifications: MAX_SUBJECT_EXPOSURE_OUTGOING_COUNTERPARTY_CLASSIFICATIONS
  });
  await Promise.all(subjectExposureCounterpartyClassifications.map((address) => getCachedClassification(address)));
  throwIfAborted(input.abortSignal);
  const subjectExposureEvents = subjectExposureEventsFromSourceEdges({
    sourceAddress,
    sourceEdges,
    classifications
  });
  const subjectExposureProfile = buildSubjectExposureProfile({
    subjectAddress: sourceAddress,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    transferEventsScanned: subjectExposureEvents.length,
    events: subjectExposureEvents
  });
  const initialAssessment = buildMoneyOriginOperationalAssessment({
    fastWalletRisk,
    originPaths: provenanceOriginPaths,
    senderInteractionProfiles,
    approvalDrainProvenanceProfiles,
    approvalDrainReviewFindings,
    coverage,
    ageSignals,
    sourceBundleExposure,
    subjectExposureProfile
  });
  const broadFallbackTargets = dedupeBroadTargetedHistoryTargets(
    postAssessmentBroadFallbackTargets({ originPaths: provenanceOriginPaths, assessment: initialAssessment })
  );
  if (broadFallbackTargets.length > 0 && deps.ensureBroadTargetedHistories) {
    await deps.ensureBroadTargetedHistories(broadFallbackTargets);
  } else if (ensureBroadTargetedHistory) {
    for (const target of broadFallbackTargets) {
      await ensureBroadTargetedHistory(target);
    }
  }
  let assessment = initialAssessment;
  let crossChainCorridor: WhereIsMoneyReport["crossChainCorridor"] | undefined;
  let finalCoverage = coverage;
  if (crossChainStage2Enabled && provenanceOriginPaths.length > 0 && provenanceTargetAmount > 0n) {
    throwIfAborted(input.abortSignal);
    const explicitDeepBridgeExposure = input.deepBridgeExposure && sameAddress(input.deepBridgeExposure.subjectAddress, sourceAddress)
      ? input.deepBridgeExposure
      : null;
    const scopedServiceProfiles = (input.deepServiceExposureProfiles ?? []).filter((profile) =>
      sameAddress(profile.subjectAddress, sourceAddress)
    );
    const deepBridgeExposure = explicitDeepBridgeExposure ??
      deepBridgeExposureFromServiceProfiles(scopedServiceProfiles) ??
      null;
    const crossChainTrigger = evaluateCrossChainStage2Trigger({
      selection: provenanceSelection,
      originPaths: provenanceOriginPaths,
      assessment: initialAssessment,
      manualDeepMode: input.crossChainManualDeepMode,
      drainEpisode: coverage.drainEpisode ?? drainEpisode ?? null,
      deepBridgeExposure
    });
    await emitProgress({
      jobPhase: crossChainTrigger.triggered ? "cross_chain_stage2" : "money_origin_trace",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: crossChainManualDeepMode,
        status: crossChainTrigger.triggered ? "running" : "skipped",
        triggered: crossChainTrigger.triggered,
        reason: crossChainTrigger.reason ?? crossChainTrigger.skippedReason,
        selectedAmountRaw: crossChainTrigger.selectedAmountRaw,
        targetAmountRaw: crossChainTrigger.targetAmountRaw,
        providerCalls: 0
      }
    });
    const crossChainAnalysis = await runCrossChainCorridorAnalysis({
      trigger: crossChainTrigger,
      subjectAddress: sourceAddress,
      originPaths: provenanceOriginPaths,
      discoveryProvider: deps.crossChainDiscoveryProvider,
      evmProvider: deps.evmEvidenceProvider,
      continuationEnabled: input.crossChainManualDeepMode === true,
      continuationProviders: deps.crossChainContinuationProviders,
      maxProviderCalls: input.crossChainMaxProviderCalls ?? DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS
    });
    throwIfAborted(input.abortSignal);
    crossChainCorridor = crossChainAnalysis.report;
    finalCoverage = crossChainCorridor.coverageNotes.length > 0 || crossChainCorridor.partial
      ? {
          ...coverage,
          partial: coverage.partial || crossChainCorridor.partial,
          notes: [
            ...coverage.notes,
            ...crossChainCorridor.coverageNotes
          ]
        }
      : coverage;
    sourceBundleExposure = buildWhereSourceBundleExposure(finalCoverage);
    assessment = buildMoneyOriginOperationalAssessment({
      fastWalletRisk,
      originPaths: provenanceOriginPaths,
      senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      coverage: finalCoverage,
      ageSignals,
      sourceBundleExposure,
      subjectExposureProfile,
      extraSourcePolicyEvidence: crossChainAnalysis.extraSourcePolicyEvidence,
      extraRiskLayers: crossChainAnalysis.extraRiskLayers,
      extraHardBadEvidence: crossChainAnalysis.extraHardBadEvidence
    });
  } else if (crossChainStage2Enabled) {
    await emitProgress({
      jobPhase: "money_origin_trace",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: crossChainManualDeepMode,
        status: "skipped",
        triggered: false,
        reason: "Exact service-fee paths are excluded from provenance analysis.",
        selectedAmountRaw: provenanceSelection.selectedAmountRaw,
        targetAmountRaw: provenanceSelection.targetAmountRaw,
        providerCalls: 0
      }
    });
  }
  const fullyCoveredExactGasFreeFeeOnly = exactGasFreeFeeOnly &&
    provenanceTargetAmount === 0n &&
    selection.coverageRatio >= 0.999 &&
    !selection.partial &&
    !finalCoverage.partial;
  if (fullyCoveredExactGasFreeFeeOnly && assessment.hardBadEvidence.length === 0) {
    assessment = {
      ...assessment,
      decision: "REVIEW",
      riskScore: 0,
      riskBand: riskBandFromWhereScore(0),
      hardBadEvidence: [],
      sourcePolicyEvidence: [],
      contractSuspicionEvidence: [],
      unknownOriginEvidence: [],
      riskLayers: [],
      dominantRiskLayer: null,
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: null,
      reasons: ["Exact GasFree service-fee movement; not payer provenance."]
    };
    sourceBundleExposure = undefined;
  } else if (exactGasFreeFeeOnly && provenanceTargetAmount > 0n && assessment.hardBadEvidence.length === 0) {
    assessment = {
      ...assessment,
      decision: "REVIEW",
      scoreValid: false,
      scoreBlockedReason: "insufficient_coverage",
      technicalStatus: "provider_cap_unresolved",
      reasons: [
        "Exact GasFree service fee is visible, but the remaining requested amount has no selected provenance path."
      ],
      warnings: [
        ...assessment.warnings,
        "Final scoring is blocked until the remaining requested amount has source coverage."
      ]
    };
  }
  const decision = assessment.decision;
  const riskScore = assessment.riskScore;
  const decisionReasons = assessment.reasons;
  const layerSummary = buildLayerSummary(fastWalletRisk, finalCoverage.checkedScope ?? "current_balance");
  const coverageLimitations = currentCoverageLimitations();
  const existingCoverageEvidenceIds = new Set(
    (provenanceSelection.coverageExclusions ?? []).flatMap((item) => item.evidenceIds)
  );
  const exactFeeTransfers = balanceFormingTransfers
    .map((transfer, ordinal) => ({
      transfer,
      evidenceId: balanceTransferCoverageEvidenceId(transfer, ordinal)
    }))
    .filter(({ transfer }) => isGasFreeServiceFeeEdge(transfer))
    .filter(({ evidenceId }) => !existingCoverageEvidenceIds.has(evidenceId));
  const coverageV2 = coverageV2ForSelection({
    selection: provenanceSelection,
    tracedAmountRaw: exactWhereTracedAmountRaw(
      provenanceSelection,
      provenanceOriginPaths,
      mergeForensicRouteEdges([...edgeCache.values()].flat().concat(repairedExactWindowEdges))
    ),
    limitations: coverageLimitations,
    exclusions: exactFeeTransfers.length === 0
      ? []
      : [{
          reason: "exact_gasfree_service_fee",
          direction: exactFeeTransfers.every(({ transfer }) => transfer.fromAddress === sourceAddress)
            ? "outgoing"
            : exactFeeTransfers.every(({ transfer }) => transfer.toAddress === sourceAddress)
              ? "incoming"
              : null,
          txCount: exactFeeTransfers.length,
          amountRaw: sumRawAmounts(exactFeeTransfers.map(({ transfer }) => transfer.amountRaw)),
          evidenceIds: exactFeeTransfers.map(({ evidenceId }) => evidenceId)
        }]
  });
  const usddPsmRouteObservations = collectUsddPsmRouteObservations({
    mode: selection.provenanceScope === "recent_flow" ? "recent_flow" : "where",
    selectedAmountRaw: provenanceSelection.selectedAmountRaw,
    paths: originPaths
  });

  return publishFreshWhereScoreResultV2({
    subjectAddress: sourceAddress,
    currentUsdtBalanceRaw: currentBalanceRaw,
    fastWalletRisk,
    balanceFormingTransfers,
    originPaths,
    senderInteractionProfiles,
    approvalDrainProvenanceProfiles,
    approvalDrainReviewFindings,
    contractDrivenReceiverProfile: contractDrivenEvidence.receiverProfile,
    contractDrivenTransferProfiles: contractDrivenEvidence.transferProfiles,
    contractLlmVerdicts,
    ...(crossChainCorridor ? { crossChainCorridor } : {}),
    sourceBundleExposure,
    subjectExposureProfile,
    assessment,
    decision,
    scoreValid: assessment.scoreValid,
    scoreBlockedReason: assessment.scoreBlockedReason,
    technicalStatus: assessment.technicalStatus,
    sourceProvenanceMateriality: assessment.sourceProvenanceMateriality ?? null,
    coverageV2,
    recentFlowPrincipalTransfers: selection.recentFlowPrincipalTransfers,
    usddPsmRouteObservations,
    ...whereDecisionFields({
      decision,
      decisionReasons,
      approvalDrainProvenanceProfileCount: approvalDrainProvenanceProfiles.length,
      assessment
    }),
    riskScore,
    decisionReasons,
    coverage: finalCoverage,
    layerSummary,
    ...(transactionInfoEnrichment ? { transactionInfoEnrichment } : {})
  });
}
