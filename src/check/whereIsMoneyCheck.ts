import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { selectBalanceFormingTransfers } from "../forensics/balanceFormingTransfers";
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
import {
  buildContractAnalysisCaseFiles,
  createUnavailableContractLlmVerdict,
  hashContractAnalysisCaseFile
} from "../forensics/contractLlmVerdict";
import { buildMoneyOriginSenderInteractionProfile } from "../forensics/moneyOriginInteractions";
import { combineMoneyOriginDecision } from "../forensics/moneyOriginPolicy";
import { traceMoneyOriginPath } from "../forensics/moneyOriginTrace";
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
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  AddressLabel,
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  ExchangeDecision,
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
  WhereIsMoneyReport
} from "../types";
import { userDecisionFromInternal } from "../risk/proofLevels";

export type WhereIsMoneyDeps = {
  getTrc20Balance(address: string, tokenContractAddress: string): Promise<string | null>;
  fetchEdgesForAddress(address: string, options?: { latestTimestamp?: Date }): Promise<ForensicRouteEdge[]>;
  getHistoryCoverageForAddress?(
    address: string,
    options: { latestTimestamp?: Date }
  ): Promise<MoneyOriginTraceHistoryCoverage>;
  fetchLatestEdgesForAddress?(address: string, limit: number): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getFastWalletRisk?(address: string): Promise<RiskReport | null>;
  getTransaction?(txHash: string): Promise<unknown>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  getContractIntelligenceProfile?(address: string): Promise<ContractRiskContext | null>;
  analyzeContractLlmCaseFiles?(caseFiles: ContractAnalysisCaseFile[]): Promise<ContractLlmVerdictSummary[]>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
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
  maxContractTransactionInfoFetches?: number;
  contractTransactionInfoMinIntervalMs?: number;
  crossChainStage2Enabled?: boolean;
  crossChainManualDeepMode?: boolean;
  crossChainMaxProviderCalls?: number;
  deepBridgeExposure?: CrossChainDeepBridgeExposure | null;
  deepServiceExposureProfiles?: ServiceExposureProfile[];
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
const DEFAULT_MAX_CONTRACT_TRANSACTION_INFO_FETCHES = 30;
const DEFAULT_CONTRACT_TRANSACTION_INFO_MIN_INTERVAL_MS = 0;
const DEFAULT_CROSS_CHAIN_MAX_PROVIDER_CALLS = 200;
const MAX_DRAIN_EPISODE_SERVICE_DESTINATION_CLASSIFICATIONS = 12;
const MAX_SUBJECT_EXPOSURE_INCOMING_COUNTERPARTY_CLASSIFICATIONS = 20;
const MAX_SUBJECT_EXPOSURE_OUTGOING_COUNTERPARTY_CLASSIFICATIONS = MAX_DRAIN_EPISODE_SERVICE_DESTINATION_CLASSIFICATIONS;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchEdgesOrPartial(read: () => Promise<ForensicRouteEdge[]>): Promise<ForensicRouteEdge[]> {
  try {
    return await read();
  } catch (error) {
    if (!isRecoverableEdgeFetchError(error)) throw error;
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
  return {
    internalDecision: input.decision,
    userDecision: userDecisionFromInternal(input.decision),
    proofLevel: proofLevelFromWhereDecision(input)
  };
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
}): WhereIsMoneyReport {
  const labelScore = Math.max(0, ...input.labels.map((label) => walletProfileLabelScore(label.label)));
  const fastScore = input.fastWalletRisk?.score ?? 0;
  const riskScore = Math.max(fastScore, labelScore);
  const hasHardLabel = input.labels.some((label) =>
    walletProfileCriticalLabels.has(label.label) || walletProfileHighRiskLabels.has(label.label)
  );
  const decision: ExchangeDecision = hasHardLabel || riskScore >= 60
    ? "DECLINE"
    : riskScore >= 45
      ? "REVIEW"
      : "ACCEPTABLE";
  const labelReasons = input.labels
    .map((label) => ({ label: label.label, score: walletProfileLabelScore(label.label) }))
    .filter((label) => label.score > 0)
    .map((label) => `Internal label: ${label.label}.`);
  const fastRiskReason = fastScore > 0 && input.fastWalletRisk
    ? [`Fast wallet risk is ${input.fastWalletRisk.score}/100 (${input.fastWalletRisk.level}).`]
    : [];
  const decisionReasons = [
    WALLET_PROFILE_ZERO_BALANCE_REASON,
    ...fastRiskReason,
    ...labelReasons
  ];
  const checkedScope = input.checkedScope ?? checkedScopeFor(input.provenanceScope, input.drainEpisode ?? null, input.anchorTransfer);
  const hardBadEvidence = hasHardLabel
    ? input.labels
        .filter((label) => walletProfileCriticalLabels.has(label.label) || walletProfileHighRiskLabels.has(label.label))
        .map((label) => ({
          kind: "scam_or_blacklist" as const,
          score: walletProfileLabelScore(label.label),
          message: `Internal label: ${label.label}`,
          evidenceIds: []
        }))
    : [];
  const assessment: WhereIsMoneyAssessment = {
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
    riskScore,
    decisionReasons,
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
  notes: string[];
}): WhereIsMoneyReport {
  const decision: ExchangeDecision = "DECLINE";
  const decisionReasons = input.notes.map((note) =>
    `Clean source could not be proven; exchange policy declines this wallet by safe default. ${note}`
  );
  const riskScore = Math.max(65, input.fastWalletRisk?.score ?? 0);
  const checkedScope = input.checkedScope ?? checkedScopeFor(input.provenanceScope, input.drainEpisode ?? null, input.anchorTransfer);
  const assessment: WhereIsMoneyAssessment = {
    decision,
    riskScore,
    riskBand: "HIGH",
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
    warnings: ["No balance-forming transfers were available."]
  };
  return {
    subjectAddress: input.sourceAddress,
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
      anchorTransfer: input.anchorTransfer ?? null,
      lowBalanceThresholdRaw: input.lowBalanceThresholdRaw ?? null,
      dataScopeNote: input.dataScopeNote ?? null,
      maxDepth: input.maxDepth,
      fetchedAddressCount: input.fetchedAddressCount ?? 0,
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

function unavailableVerdictsForCaseFiles(caseFiles: ContractAnalysisCaseFile[]): ContractLlmVerdictSummary[] {
  return caseFiles.map((caseFile) => createUnavailableContractLlmVerdict({
    contractAddress: caseFile.contractAddress,
    caseFileHash: hashContractAnalysisCaseFile(caseFile),
    providerLabel: "disabled",
    model: "disabled",
    error: "llm disabled"
  }));
}

function fastRiskDecisionScore(report: RiskReport | null): number {
  if (!report) return 0;
  return report.score >= 85 ? report.score : 0;
}

function contractLlmCandidateAddresses(input: {
  originPaths: WhereIsMoneyReport["originPaths"];
  approvalDrainProvenanceProfiles: WhereIsMoneyReport["approvalDrainProvenanceProfiles"];
  approvalDrainReviewFindings: NonNullable<WhereIsMoneyReport["approvalDrainReviewFindings"]>;
}): string[] {
  const addresses = new Set<string>();
  for (const path of input.originPaths) {
    if (path.rootSourceAddress) addresses.add(path.rootSourceAddress);
    if (path.rootSourceType === "decline_boundary" || path.stoppedReason === "unlabeled_service_boundary" || path.verdict !== "ACCEPTABLE") {
      for (const address of path.pathAddresses) addresses.add(address);
    }
  }
  for (const profile of input.approvalDrainProvenanceProfiles) {
    addresses.add(profile.spenderAddress);
  }
  for (const finding of input.approvalDrainReviewFindings) {
    if (finding.spenderAddress) addresses.add(finding.spenderAddress);
  }
  return [...addresses];
}

function windowEdges(edges: ForensicRouteEdge[], input: RunWhereIsMoneyCheckInput): ForensicRouteEdge[] {
  return edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
}

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}

function balanceTransferToEdge(transfer: BalanceFormingTransfer): ForensicRouteEdge {
  return {
    id: `balance_transfer_seed:${transfer.txHash}:${transfer.fromAddress}:${transfer.toAddress}:${transfer.amountRaw}`,
    txHash: transfer.txHash,
    fromAddress: transfer.fromAddress,
    toAddress: transfer.toAddress,
    amountRaw: transfer.amountRaw,
    timestamp: new Date(transfer.timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
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
  if (!classification || classification.category === "none") return "unknown";
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

function selectedSourceBundleTargetRaw(input: {
  selection: BalanceFormingSelection;
  coverage: WhereIsMoneyCoverage;
}): string {
  return input.selection.targetAmountRaw ??
    input.coverage.targetAmountRaw ??
    input.selection.selectedAmountRaw ??
    "0";
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
  const edgesByTxHash = new Map<string, ForensicRouteEdge>();
  for (const edge of input.edges) {
    if (!edgesByTxHash.has(edge.txHash)) edgesByTxHash.set(edge.txHash, edge);
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
    .map((txHash) => edgesByTxHash.get(txHash))
    .filter((edge): edge is ForensicRouteEdge => Boolean(edge));
  const importantWithTriggeredEdges = dedupeEdges([...triggeredContractEdges, ...important]);
  const importantKeys = new Set(importantWithTriggeredEdges.map((edge) => `${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`));
  const fallback = input.mode === "always"
    ? input.edges
        .filter((edge) => !importantKeys.has(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`))
        .sort(compareApprovalDrainCandidateAmountDesc)
    : [];
  return dedupeEdges([...importantWithTriggeredEdges, ...fallback]).slice(0, input.maxCandidates);
}

function sumRawAmounts(values: string[]): string {
  return values.reduce((sum, value) => sum + (/^\d+$/.test(value) ? BigInt(value) : 0n), 0n).toString();
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
    selectionMethod: "transaction_seed",
    notes: ["Transaction check: balance-forming transfer was supplied from the checked transaction."]
  };
}

export async function runWhereIsMoneyCheck(
  deps: WhereIsMoneyDeps,
  input: RunWhereIsMoneyCheckInput
): Promise<WhereIsMoneyReport> {
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
  const classifications = new Map<string, ServiceClassification | null>();
  const getCachedClassification = async (address: string): Promise<ServiceClassification | null> => {
    throwIfAborted(input.abortSignal);
    const cacheKey = classificationCacheKey(address);
    if (classifications.has(cacheKey)) return classifications.get(cacheKey) ?? null;
    const classification = await deps.getClassificationForAddress(cacheKey).catch(() => null);
    throwIfAborted(input.abortSignal);
    classifications.set(cacheKey, classification);
    return classification;
  };
  const fetchCachedEdgesForAddress = async (address: string, options: { latestTimestamp?: Date } = {}): Promise<ForensicRouteEdge[]> => {
    throwIfAborted(input.abortSignal);
    const cacheKey = options.latestTimestamp ? `${address}:${options.latestTimestamp.getTime()}` : address;
    const cached = edgeCache.get(cacheKey);
    if (cached) return cached;
    fetchedAddresses.add(address);
    const fetchedEdges = await fetchEdgesOrPartial(() => deps.fetchEdgesForAddress(address, options));
    throwIfAborted(input.abortSignal);
    const windowedEdges = windowEdges(fetchedEdges, input);
    const shouldUseFallback = fallbackMinTransferCount > 0 &&
      fallbackTransferLimit > 0 &&
      windowedEdges.length < fallbackMinTransferCount;
    const latestEdges = shouldUseFallback
      ? await fetchEdgesOrPartial(() => deps.fetchLatestEdgesForAddress?.(address, fallbackTransferLimit) ?? Promise.resolve(fetchedEdges))
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
      ? selectRecentFlowProvenanceTransfers({
          subjectAddress: sourceAddress,
          currentBalanceRaw,
          edges: sourceEdges
        })
      : selectBalanceFormingTransfers({
          subjectAddress: sourceAddress,
          currentBalanceRaw,
          requestedAmountRaw: input.requestedAmountRaw,
          edges: sourceEdges
        });
  }
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
      selectedAmountRaw: selection.selectedAmountRaw,
      selectedFundingTxHashes: selection.transfers.map((transfer) => transfer.txHash),
      edges: sourceEdges,
      serviceAddresses
    });
  }
  const checkedScope = checkedScopeFor(selection.provenanceScope, drainEpisode, selection.anchorTransfer ?? null);

  if (selection.transfers.length === 0) {
    const hasMeaningfulRecentFlow = selection.provenanceScope === "recent_flow" && Boolean(selection.anchorTransfer);
    if (input.mode === "wallet_profile" && rawBalanceIsZero(currentBalanceRaw) && !hasMeaningfulRecentFlow) {
      const labels = await deps.getLabelsForAddress(sourceAddress).catch(() => []);
      return walletProfileZeroBalanceReport({
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
        episodeCoverageRatio: drainEpisode?.episodeCoverageRatio ?? null
      });
    }
    return fallbackReviewReport({
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
      anchorCoverageRatio: selection.coverageRatio,
      episodeCoverageRatio: drainEpisode?.episodeCoverageRatio ?? null,
      notes: selection.notes.length > 0 ? selection.notes : ["No balance-forming inbound USDT transfers were available; manual review required."]
    });
  }

  const fetchEdgesForAddress = async (address: string, options?: { latestTimestamp?: Date }): Promise<ForensicRouteEdge[]> => {
    throwIfAborted(input.abortSignal);
    return fetchCachedEdgesForAddress(address, options);
  };

  throwIfAborted(input.abortSignal);
  const originPaths = await Promise.all(selection.transfers.map((balanceTransfer) =>
    traceMoneyOriginPath({
      subjectAddress: sourceAddress,
      balanceTransfer,
      maxDepth,
      beamWidth,
      maxAddressFetches,
      maxEdgesPerAddress,
      minAmountPreservationRatio: input.minAmountPreservationRatio,
      fetchEdgesForAddress,
      getHistoryCoverageForAddress: deps.getHistoryCoverageForAddress,
      getLabelsForAddress: deps.getLabelsForAddress,
      getClassificationForAddress: deps.getClassificationForAddress
    })
  ));
  throwIfAborted(input.abortSignal);
  const senderInteractionProfiles = await Promise.all(selection.transfers.map(async (balanceTransfer) =>
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
  const maxTxInfoFetches = input.maxContractTransactionInfoFetches ?? DEFAULT_MAX_CONTRACT_TRANSACTION_INFO_FETCHES;
  const txInfoMinIntervalMs = Math.max(
    0,
    input.contractTransactionInfoMinIntervalMs ?? DEFAULT_CONTRACT_TRANSACTION_INFO_MIN_INTERVAL_MS
  );
  const effectiveApprovalCandidateLimit = Math.max(0, Math.min(maxApprovalCandidates, maxTxInfoFetches));
  const allFetchedEdges = dedupeEdges([
    ...selection.transfers.map(balanceTransferToEdge),
    ...edgeCache.values()
  ].flat());
  const selectedApprovalEdges = selectApprovalEnrichmentEdges({
    edges: allFetchedEdges,
    originPaths,
    maxCandidates: effectiveApprovalCandidateLimit,
    mode: approvalMode
  });
  const approvalEdges = selectedApprovalEdges;
  const hasApprovalEnrichmentDeps = Boolean(deps.getTransaction && deps.listTrc20ApprovalChanges);
  const approvalBudgetNote = approvalMode === "off"
    ? "Approval/contract enrichment disabled for this run."
    : effectiveApprovalCandidateLimit <= 0
      ? "Approval/contract enrichment skipped because the transaction-info budget is zero."
    : approvalEdges.length > 0 && !hasApprovalEnrichmentDeps
      ? "Approval/contract enrichment skipped because transaction or approval lookup dependencies are unavailable."
    : approvalEdges.length > 0
      ? `Approval/contract enrichment budget: checked ${approvalEdges.length} candidate edge(s).`
      : "Approval/contract enrichment skipped because no contract/service trigger was found.";
  let approvalEnrichmentOutcomeNote: string | null = null;
  if (approvalMode !== "off" && approvalEdges.length > 0 && deps.getTransaction && deps.listTrc20ApprovalChanges) {
    throwIfAborted(input.abortSignal);
    let transactionInfoFetches = 0;
    let transactionInfoSuccesses = 0;
    let transactionInfoFailures = 0;
    const transactionInfoCache = new Map<string, Promise<unknown | null>>();
    let transactionInfoQueue = Promise.resolve();
    let lastTransactionInfoCompletedAt = Date.now() - txInfoMinIntervalMs;
    const getBudgetedTransaction = (txHash: string): Promise<unknown | null> => {
      const cached = transactionInfoCache.get(txHash);
      if (cached) return cached;
      if (transactionInfoFetches >= maxTxInfoFetches) return Promise.resolve(null);
      transactionInfoFetches += 1;
      const fetched = transactionInfoQueue.then(async () => {
        throwIfAborted(input.abortSignal);
        const waitMs = lastTransactionInfoCompletedAt + txInfoMinIntervalMs - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        throwIfAborted(input.abortSignal);
        const transaction = await (deps.getTransaction?.(txHash).catch(() => null) ?? null);
        lastTransactionInfoCompletedAt = Date.now();
        if (transaction === null) {
          transactionInfoFailures += 1;
        } else {
          transactionInfoSuccesses += 1;
        }
        return transaction;
      });
      transactionInfoQueue = fetched.then(() => undefined, () => undefined);
      transactionInfoCache.set(txHash, fetched);
      return fetched;
    };
    const edgeAddresses = new Set(approvalEdges.flatMap((edge) => [edge.fromAddress, edge.toAddress]));
    await Promise.all([...edgeAddresses].map((address) => getCachedClassification(address)));
    throwIfAborted(input.abortSignal);
    const contractProfiles = await buildApprovalDrainContractProfiles({
      edges: approvalEdges,
      classifications,
      getCachedClassification,
      getTransaction: getBudgetedTransaction,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile,
      maxCandidates: effectiveApprovalCandidateLimit
    });
    const approvalDrainAnalysis = await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: sourceAddress,
      edges: approvalEdges,
      classifications,
      contractProfiles,
      deps: {
        getTransaction: getBudgetedTransaction,
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
      approvalEnrichmentOutcomeNote = transactionInfoFailures > 0
        ? `Approval/contract enrichment result: transaction-info fetched ${transactionInfoSuccesses}/${transactionInfoFetches} candidate tx(s); ${transactionInfoFailures} candidate tx(s) were unavailable or rate-limited.`
        : `Approval/contract enrichment result: transaction-info fetched ${transactionInfoSuccesses}/${transactionInfoFetches} candidate tx(s).`;
    }
  }
  const combined = combineMoneyOriginDecision(originPaths);
  const fastScore = fastRiskDecisionScore(fastWalletRisk);
  const approvalDrainScore = approvalDrainProvenanceProfiles[0]?.score ?? 0;
  const fastDecline = fastScore >= 85;
  const approvalDrainDecline = approvalDrainScore >= 70;
  const deterministicDecision = fastDecline || approvalDrainDecline ? "DECLINE" : combined.decision;
  let contractLlmVerdicts: ContractLlmVerdictSummary[] = [];
  const needsContractLlmForDecision = !fastDecline &&
    !approvalDrainDecline &&
    (deterministicDecision === "REVIEW" || approvalDrainReviewFindings.length > 0);
  const shouldBuildContractLlmReport = Boolean(deps.analyzeContractLlmCaseFiles || needsContractLlmForDecision);
  if (shouldBuildContractLlmReport) {
    throwIfAborted(input.abortSignal);
    const candidateAddresses = contractLlmCandidateAddresses({
      originPaths,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings
    });
    await Promise.all(candidateAddresses.map((address) => getCachedClassification(address)));
    throwIfAborted(input.abortSignal);
    const preliminaryCaseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: sourceAddress,
      currentUsdtBalanceRaw: currentBalanceRaw,
      balanceFormingTransfers: selection.transfers,
      originPaths,
      senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      classifications
    });
    const contractProfiles = await buildContractProfilesForCaseFiles({
      caseFiles: preliminaryCaseFiles,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile
    });
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: sourceAddress,
      currentUsdtBalanceRaw: currentBalanceRaw,
      balanceFormingTransfers: selection.transfers,
      originPaths,
      senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      classifications,
      contractProfiles
    });
    if (caseFiles.length > 0) {
      throwIfAborted(input.abortSignal);
      contractLlmVerdicts = deps.analyzeContractLlmCaseFiles
        ? await deps.analyzeContractLlmCaseFiles(caseFiles).catch(() => unavailableVerdictsForCaseFiles(caseFiles))
        : unavailableVerdictsForCaseFiles(caseFiles);
      throwIfAborted(input.abortSignal);
    }
  }
  const coverage: WhereIsMoneyCoverage = {
    selectedInboundTxCount: selection.transfers.length,
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
    anchorTransfer: selection.anchorTransfer ?? null,
    lowBalanceThresholdRaw: selection.provenanceScope === "recent_flow"
      ? LOW_BALANCE_RECENT_FLOW_THRESHOLD_RAW
      : null,
    dataScopeNote: selection.dataScopeNote ?? null,
    maxDepth,
    fetchedAddressCount: fetchedAddresses.size,
    partial: selection.partial || originPaths.some((path) => path.verdict === "REVIEW"),
    notes: [
      selection.provenanceScope === "recent_flow"
        ? "Recent-flow approximation: current balance is low, so the report analyzes recent meaningful wallet flow rather than current balance origin."
        : selection.provenanceScope === "requested_amount" || selection.provenanceScope === "transaction_seed"
          ? "Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount or checked transaction."
          : "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.",
      ...selection.notes,
      approvalBudgetNote,
      ...(approvalEnrichmentOutcomeNote ? [approvalEnrichmentOutcomeNote] : []),
      ...originPaths
        .filter((path) => path.verdict === "REVIEW")
        .map((path) => `${path.balanceTransferTxHash}: ${path.reasons[0]}`)
    ]
  };
  const ageSignals = buildMoneyOriginAgeSignals({
    subjectAddress: sourceAddress,
    balanceFormingTransfers: selection.transfers,
    edgesByAddress: edgeCache,
    now: input.windowEnd,
    largeBalanceRaw: currentBalanceRaw
  });
  const buildWhereSourceBundleExposure = (assessmentCoverage: WhereIsMoneyCoverage) => {
    const sourceBundleTargetAmountRaw = selectedSourceBundleTargetRaw({ selection, coverage: assessmentCoverage });
    const findings = sourceBundleFindingsFromOriginPaths({
      originPaths,
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
    return buildSourceBundleExposure({
      scope: whereSourceBundleScope(assessmentCoverage.checkedScope),
      targetAmountRaw: sourceBundleTargetAmountRaw,
      findings,
      budget,
      unresolvedBoundary: unresolvedBoundaryFromFindings({ findings, budget })
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
    originPaths,
    senderInteractionProfiles,
    approvalDrainProvenanceProfiles,
    approvalDrainReviewFindings,
    contractLlmVerdicts,
    coverage,
    ageSignals,
    sourceBundleExposure,
    subjectExposureProfile
  });
  let assessment = initialAssessment;
  let crossChainCorridor: WhereIsMoneyReport["crossChainCorridor"] | undefined;
  let finalCoverage = coverage;
  if (crossChainStage2Enabled) {
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
      selection,
      originPaths,
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
      originPaths,
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
      originPaths,
      senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      contractLlmVerdicts,
      coverage: finalCoverage,
      ageSignals,
      sourceBundleExposure,
      subjectExposureProfile,
      extraSourcePolicyEvidence: crossChainAnalysis.extraSourcePolicyEvidence,
      extraRiskLayers: crossChainAnalysis.extraRiskLayers,
      extraHardBadEvidence: crossChainAnalysis.extraHardBadEvidence
    });
  }
  const decision = assessment.decision;
  const riskScore = assessment.riskScore;
  const decisionReasons = assessment.reasons;
  const layerSummary = buildLayerSummary(fastWalletRisk, finalCoverage.checkedScope ?? "current_balance");

  return {
    subjectAddress: sourceAddress,
    currentUsdtBalanceRaw: currentBalanceRaw,
    fastWalletRisk,
    balanceFormingTransfers: selection.transfers,
    originPaths,
    senderInteractionProfiles,
    approvalDrainProvenanceProfiles,
    approvalDrainReviewFindings,
    contractLlmVerdicts,
    ...(crossChainCorridor ? { crossChainCorridor } : {}),
    sourceBundleExposure,
    subjectExposureProfile,
    assessment,
    decision,
    ...whereDecisionFields({
      decision,
      decisionReasons,
      approvalDrainProvenanceProfileCount: approvalDrainProvenanceProfiles.length,
      assessment
    }),
    riskScore,
    decisionReasons,
    coverage: finalCoverage,
    layerSummary
  };
}
