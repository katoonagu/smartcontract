import {
  DEFAULT_DEEP_ECONOMIC_EDGE_TRANSACTION_INFO_FETCH_LIMIT,
  runDeepAddressForensicCheck,
  type DeepAddressForensicDeps,
  type DeepAddressForensicReport
} from "../check/deepForensicCheck";
import { runWhereIsMoneyCheck, type BroadTargetedHistoryRequest, type RunWhereIsMoneyCheckInput, type WhereIsMoneyDeps } from "../check/whereIsMoneyCheck";
import { FORENSIC_ROUTE_POLICY_VERSION } from "./routeScorer";
import { repairFundingSourceExactWindow } from "./fundingFirstSourceProvenance";
import {
  DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS,
  indexedTransferToRouteEdge,
  mergeForensicRouteEdges,
  materializeIndexedTransferWindow
} from "./localTronUsdtIndex";
import { normalizeTransfer } from "./routeSearch";
import { classifyServiceAddress } from "./serviceClassifier";
import { markSecondLayerQueued } from "./deepSecondLayerRelationship";
import { buildBalanceFormingSlice, type BalanceFormingSliceResult } from "./balanceFormingSlice";
import { DEFAULT_MAX_BUNDLE_FUNDERS } from "./provenanceTracingConfig";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { ChainContinuationProvider } from "./crossChainContinuationTypes";
import type { EvmEvidenceProvider } from "./evmExplorerClient";
import {
  mergeForensicJobProgress,
  createForensicEnrichmentHeartbeatCoordinator,
  type ForensicEnrichmentHeartbeatCoordinator,
  type ForensicJobProgressPatch
} from "./forensicJobProgress";
import { createPendingForensicTelegramDelivery } from "./telegramDelivery";
import {
  ensureCandidateWindowsOrWait,
  ensureTargetedHistoriesOrWait,
  ensureTargetedHistoryOrWait,
  TargetedHistoryTerminalError,
  TargetedHistoryWaitingForIndex,
  targetedHistoryReadyProgressPatch,
  targetedHistoryTerminalStatus
} from "./targetedHistoryCoordinator";
import {
  addStrictBenchmarkStageTiming,
  isStrictProvenanceBenchmarkJob,
  strictBlockedResultJson,
  strictCompletedResultJson,
  strictTechnicalStatusFromBlockedReason,
  strictWaitingProgressPatch,
  type StageKey,
  type StrictScoreBlockedReason
} from "./strictProvenanceBenchmark";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import type { RouteLinkedAssertionInput, SelectiveTransactionEnricher } from "./selectiveTransactionEnrichment";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../storage/repositories";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../risk/scoringSignalMatrix";
import type { ApprovalDrainProvenanceProfile, BalanceFormingTransfer, CounterpartyRiskProfile, DeepCheckAllTimeMode, FastCheckHintAddress, FastCounterpartyTopDirection, ForensicRouteEdge, ForensicTelegramDeliveryV1, InboundProvenancePath, IndexedTronUsdtTransfer, MoneyOriginTraceHistoryCoverage, RawEvidenceInput, RiskLevel, RiskReport, RiskSignalObservationInput, ServiceClassification, StablecoinRestrictionProfile, TelegramMessagePayloadV1, TimelineBearingStablecoinRestrictionProfile, TronAddressUsdtCoverageMode, TronAddressUsdtCoverageStatusReason, TronAddressUsdtIndexRequestKind, TronAddressUsdtIndexState, TronAddressUsdtIndexStatus, WhereCandidateWindowRequest, WhereIsMoneyReport } from "../types";

export const DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 150;
export const DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT = 150;
const WHERE_BALANCE_SLICE_PAGE_SIZE = 50;
const WHERE_BALANCE_SLICE_MAX_PAGES = 20;
const WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO = 0.95;
const WHERE_BALANCE_SLICE_PROVIDER_CAP_RANGE_TOTAL = 10_000;

export type DeepForensicJobRunnerDeps = Omit<
  DeepAddressForensicDeps,
  "getAddressUsdtIndexState" | "listIndexedUsdtTransfersForAddress"
> & {
  listIndexedUsdtTransfersForAddress?(address: string, options: {
    minTimestamp: Date;
    maxTimestamp: Date;
    limit: number;
    offset?: number;
    orderBy?: "newest" | "amount_desc";
    direction?: "both";
  }): Promise<IndexedTronUsdtTransfer[]>;
  getUsdtRestrictionStatus(address: string, options?: { includeEventTimeline?: boolean }): Promise<TimelineBearingStablecoinRestrictionProfile>;
  selectiveTransactionEnricher?: SelectiveTransactionEnricher;
  listActiveRouteAssertions?(input: { addresses: string[]; txHashes: string[] }): Promise<RouteLinkedAssertionInput[]>;
  listIndexedMovementsByHashes?(txHashes: string[]): Promise<ForensicRouteEdge[]>;
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: {
    id: string;
    claimStartedAt: Date;
    status: "completed" | "partial" | "failed";
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: string | null;
  }): Promise<boolean>;
  indexWalletIntelligenceJob?(input: {
    job: ForensicCheckJob;
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    status: "completed" | "partial";
  }): Promise<void>;
  updateForensicCheckJobProgress?(input: {
    id: string;
    claimStartedAt: Date;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
  releaseForensicCheckJobToWaiting?(input: {
    id: string;
    claimStartedAt: Date;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
  markStrictProvenanceJobReadyAfterIndex?(input: {
    id: string;
    address: string;
    targetTimestamp: Date | null;
    indexStatus: TronAddressUsdtIndexStatus;
    statusReason: TronAddressUsdtCoverageStatusReason | null;
    lastError: string | null;
  }): Promise<boolean>;
  recordRiskEvaluation(input: {
    jobId: string;
    claimStartedAt: Date;
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }): Promise<boolean | void>;
  upsertAddressLabelAssertion?(input: AddressLabelAssertionInput & {
    jobId: string;
    claimStartedAt: Date;
  }): Promise<unknown | false>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
  buildJobResultPayload?(job: ForensicCheckJob, report: DeepAddressForensicReport, status: "completed" | "partial"): TelegramMessagePayloadV1 | null | Promise<TelegramMessagePayloadV1 | null>;
  buildWhereIsMoneyJobResultPayload?(job: ForensicCheckJob, report: WhereIsMoneyReport, status: "completed" | "partial"): TelegramMessagePayloadV1 | null | Promise<TelegramMessagePayloadV1 | null>;
  buildJobFailurePayload?(job: ForensicCheckJob, error: string): TelegramMessagePayloadV1 | null | Promise<TelegramMessagePayloadV1 | null>;
  buildWhereIsMoneyJobFailurePayload?(job: ForensicCheckJob, error: string): TelegramMessagePayloadV1 | null | Promise<TelegramMessagePayloadV1 | null>;
  getAddressUsdtIndexState?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    candidateTxHash?: string | null;
  }): Promise<TronAddressUsdtIndexState | null>;
  getCoveringAddressUsdtIndexState?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp: Date;
  }): Promise<TronAddressUsdtIndexState | null>;
  ensureAddressUsdtHistory?(input: {
    jobId: string;
    claimStartedAt: Date;
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    stopAtTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
  queueAddressUsdtHistory?(input: {
    claimStartedAt: Date;
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    relatedHopTxHash?: string | null;
    candidateTxHash?: string | null;
    requestedByJobId?: string | null;
    queuedReason: string;
    budgetPages?: number | null;
    maxAttempts?: number | null;
    allowRunningRequeue?: boolean | null;
  }): Promise<TronAddressUsdtIndexState>;
  upsertForensicJobWait?(input: {
    jobId: string;
    claimStartedAt: Date;
    address: string;
    targetTimestamp: Date;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    relatedHopTxHash?: string | null;
    candidateTxHash?: string | null;
    requiredFor: "where_hop" | "incoming_hop";
    statusReason?: TronAddressUsdtCoverageStatusReason | null;
    lastError?: string | null;
  }): Promise<boolean | void>;
  markWaitingForensicJobsReadyAfterTargetedIndex?(input: {
    address: string;
    targetTimestamp: Date | null;
    requestKind?: TronAddressUsdtIndexRequestKind | null;
    windowStartTimestamp?: Date | null;
    windowEndTimestamp?: Date | null;
    relatedHopTxHash?: string | null;
    candidateTxHash?: string | null;
    indexStatus: TronAddressUsdtIndexStatus;
    statusReason: TronAddressUsdtCoverageStatusReason | null;
    lastError: string | null;
    state?: TronAddressUsdtIndexState | null;
  }): Promise<number | boolean>;
  logger?: Logger;
};

export type DeepForensicJobRunnerOptions = {
  pageLimit?: number;
  maxPagesPerAddress?: number;
  maxExpandedIntermediates?: number;
  metadataFetchLimit?: number;
  contractProfileFetchLimit?: number;
  maxInboundSenders?: number;
  maxApprovalDrainCandidates?: number;
  approvalChangeLookupLimit?: number;
  economicEdgeTransactionInfoFetchLimit?: number;
  extendedSearchMode?: "disabled" | "auto" | "always";
  extendedSearchMaxDepth?: number;
  extendedSearchBeamWidth?: number;
  extendedSearchMaxAddressFetches?: number;
  recentFallbackMinTransferCount?: number;
  maxEdgesPerAddress?: number;
  recentFallbackTransferLimit?: number;
  counterpartyFastSnapshotLimit?: number;
  counterpartyFastSnapshotActiveLimit?: number;
  crossChainStage2Enabled?: boolean;
  /** Test seam; production uses the 30-second default. */
  transactionEnrichmentHeartbeatIntervalMs?: number;
  crossChainManualDeepMode?: boolean;
  crossChainMaxProviderCalls?: number;
  apiKeyConfigured?: boolean;
  allTimeDeepCheckMode?: DeepCheckAllTimeMode;
  secondLayerMaxActiveWalletsPerJob?: number;
  directHardEvidenceLiveLimit?: number;
  directHardEvidenceConcurrency?: number;
  contractTransactionInfoMinIntervalMs?: number;
  targetedHistoryMaxBudgetPages?: number;
  sourceProvenanceExactWindowRepairLimit?: number;
  localIndexMaterializationMaxRows?: number;
};

/** The legacy worker and replay capture must resolve this input identically. */
export function resolveLegacyWhereIsMoneyRunInput(
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions
): Omit<RunWhereIsMoneyCheckInput, "onProgress" | "abortSignal"> {
  return {
    mode: whereIsMoneyJobModeField(job.progressJson.mode),
    sourceAddress: job.subjectAddress,
    requestedAmountRaw: rawAmountField(job.progressJson.requestedAmountRaw),
    seedTransfers: seedTransfersField(job.progressJson.seedTransfers),
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    maxDepth: Math.max(options.extendedSearchMaxDepth ?? 20, 20),
    beamWidth: Math.max(options.extendedSearchBeamWidth ?? 12, 12),
    maxAddressFetches: Math.max(options.extendedSearchMaxAddressFetches ?? 150, 150),
    maxEdgesPerAddress: options.maxEdgesPerAddress ?? 100,
    recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
    recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT,
    crossChainStage2Enabled: shouldRunCrossChainStage2ForJob(job, options),
    crossChainManualDeepMode: options.crossChainManualDeepMode || booleanField(job.progressJson.crossChainManualDeepMode),
    crossChainMaxProviderCalls: options.crossChainMaxProviderCalls
  };
}

type DerivedLabelResult = {
  label: "darknet_exchange_proximity" | "approval_drain_proximity";
  assertionId: string;
} | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function historicalFetchMinTimestamp(job: ForensicCheckJob, maxTimestamp: Date): Date {
  return job.windowStart <= maxTimestamp ? job.windowStart : new Date(0);
}

function rawAmountField(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n ? value : null;
}

function booleanField(value: unknown): boolean {
  return value === true;
}

function deepCheckAllTimeModeField(value: unknown): DeepCheckAllTimeMode | null {
  return value === "strict" || value === "partial" ? value : null;
}

function nonNegativeIntegerField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

type WhereIsMoneyJobMode = "where_is_money" | "transaction_check" | "wallet_profile";

function whereIsMoneyJobModeField(value: unknown): WhereIsMoneyJobMode {
  if (value === "transaction_check" || value === "wallet_profile") return value;
  return "where_is_money";
}

function seedTransfersField(value: unknown): BalanceFormingTransfer[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const transfers = value.filter((item): item is BalanceFormingTransfer => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const transfer = item as Record<string, unknown>;
    return typeof transfer.txHash === "string" &&
      typeof transfer.fromAddress === "string" &&
      typeof transfer.toAddress === "string" &&
      typeof transfer.amountRaw === "string" &&
      /^\d+$/.test(transfer.amountRaw) &&
      typeof transfer.timestamp === "string" &&
      typeof transfer.coverageShare === "number" &&
      transfer.selectedReason === "covers_current_balance";
  });
  return transfers.length > 0 ? transfers : undefined;
}

function shouldRunCrossChainStage2ForJob(
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions
): boolean {
  if (options.crossChainStage2Enabled !== true) return false;
  if (options.crossChainManualDeepMode === true) return true;
  if (booleanField(job.progressJson.crossChainStage2Enabled)) return true;
  if (booleanField(job.progressJson.crossChainManualDeepMode)) return true;
  if (rawAmountField(job.progressJson.requestedAmountRaw)) return true;
  return seedTransfersField(job.progressJson.seedTransfers) !== undefined;
}

function pendingDelivery(
  job: ForensicCheckJob,
  payload: TelegramMessagePayloadV1 | null
): ForensicTelegramDeliveryV1 | null {
  if (payload === null) return null;
  if (!job.chatId || payload.chatId !== job.chatId) {
    throw new TypeError("Forensic Telegram payload chat does not match the job owner");
  }
  return createPendingForensicTelegramDelivery({
    jobId: job.id,
    kind: job.kind === "where_is_money_check" ? "where_is_money_check" : "address_deep_check",
    payload,
    effect: null
  });
}

async function buildDeepForensicJobResultDelivery(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial"
): Promise<ForensicTelegramDeliveryV1 | null> {
  if (!job.chatId || !deps.buildJobResultPayload) return null;
  return pendingDelivery(job, await deps.buildJobResultPayload(job, report, status));
}

async function buildWhereIsMoneyJobResultDelivery(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial"
): Promise<ForensicTelegramDeliveryV1 | null> {
  if (!job.chatId || !deps.buildWhereIsMoneyJobResultPayload) return null;
  return pendingDelivery(job, await deps.buildWhereIsMoneyJobResultPayload(job, report, status));
}

async function indexWalletIntelligenceBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  input: { progressJson: Record<string, unknown>; resultJson: Record<string, unknown>; status: "completed" | "partial" }
): Promise<void> {
  if (!deps.indexWalletIntelligenceJob) return;
  try {
    await deps.indexWalletIntelligenceJob({ job, ...input });
  } catch (error) {
    (deps.logger ?? defaultLogger).warn("wallet_intelligence_index_failed", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      error: errorMessage(error)
    });
  }
}

async function buildForensicJobFailureDelivery(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  message: string
): Promise<ForensicTelegramDeliveryV1 | null> {
  if (!job.chatId) return null;
  const builder = job.kind === "where_is_money_check"
    ? deps.buildWhereIsMoneyJobFailurePayload
    : deps.buildJobFailurePayload;
  if (!builder) return null;
  return pendingDelivery(job, await builder(job, message));
}

function progressWithDelivery(
  progressJson: Record<string, unknown>,
  delivery: ForensicTelegramDeliveryV1 | null
): Record<string, unknown> {
  return delivery ? { ...progressJson, telegramDelivery: delivery } : progressJson;
}

function topDarknetExchangePath(report: DeepAddressForensicReport): InboundProvenancePath | null {
  const profile = report.inboundProvenanceProfiles[0] ?? null;
  const path = profile?.paths[0] ?? null;
  if (!profile || !path) return null;
  if (profile.score <= 0 || path.label !== "darknet_exchange") return null;
  if (path.depth > 2 || path.amountPreservationRatio < 0.7) return null;
  return path;
}

function topHighRiskCounterpartyProfile(report: DeepAddressForensicReport): CounterpartyRiskProfile | null {
  return report.counterpartyRiskProfiles.find((profile) =>
    profile.score > 0 && (profile.label === "darknet_exchange" || profile.label === "darknet_exchange_proximity")
  ) ?? null;
}

async function persistDerivedDarknetExchangeProximityLabel(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport
): Promise<DerivedLabelResult> {
  if (!deps.upsertAddressLabelAssertion) return null;
  const path = topDarknetExchangePath(report);
  const counterpartyProfile = path ? null : topHighRiskCounterpartyProfile(report);
  if (!path && !counterpartyProfile) return null;

  const inboundProfile = report.inboundProvenanceProfiles[0];
  const rawEvidenceId = path
    ? report.rawEvidence.find((evidence) => "inboundProvenanceProfile" in evidence.evidenceJson)?.id ?? null
    : report.rawEvidence.find((evidence) => "counterpartyRiskProfile" in evidence.evidenceJson)?.id ?? null;
  const observationId = path
    ? report.observations.find((observation) => observation.code === "forensic_darknet_exchange_provenance")?.id ?? null
    : report.observations.find((observation) => observation.code.startsWith("forensic_counterparty_darknet_exchange"))?.id ?? null;
  const assertionId = `derived_tron_darknet_exchange_proximity_${report.subjectAddress}`;
  const firstSeenAt = path?.firstTransferAt ?? counterpartyProfile?.firstTransferAt;
  const lastSeenAt = path?.lastTransferAt ?? counterpartyProfile?.lastTransferAt;

  const saved = await deps.upsertAddressLabelAssertion({
    jobId: job.id,
    claimStartedAt: job.startedAt!,
    id: assertionId,
    chain: "tron",
    address: report.subjectAddress,
    label: "darknet_exchange_proximity",
    entityName: "Derived darknet exchange proximity",
    category: "darknet_exchange_proximity",
    confidence: "high",
    severity: "high",
    status: "active",
    sourceName: "forensic_route_search",
    sourceUrl: null,
    notes: "System-derived marker from exact TRON USDT exposure to a manually verified darknet exchange seed or derived high-risk counterparty.",
    evidenceJson: {
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      phase: "10A.8",
      source: "forensic_route_search",
      subjectAddress: report.subjectAddress,
      ...(path ? {
        seedAddress: path.sourceAddress,
        hopDepth: path.depth,
        viaAddresses: path.viaAddresses,
        txHashes: path.txHashes,
        amountRaw: path.amountRaw,
        amountPreservationRatio: path.amountPreservationRatio,
        matchedInboundVolumeRaw: inboundProfile?.matchedInboundVolumeRaw ?? "0"
      } : {
        counterpartyAddress: counterpartyProfile?.counterpartyAddress,
        counterpartyLabel: counterpartyProfile?.label,
        direction: counterpartyProfile?.direction,
        txHashes: counterpartyProfile?.txHashes ?? [],
        amountRaw: counterpartyProfile?.amountRaw ?? "0",
        volumeRatio: counterpartyProfile?.volumeRatio ?? 0,
        txCount: counterpartyProfile?.txCount ?? 0
      }),
      firstTransferAt: firstSeenAt,
      lastTransferAt: lastSeenAt,
      windowStart: report.windowStart.toISOString(),
      windowEnd: report.windowEnd.toISOString(),
      rawEvidenceId,
      observationId,
      jobId: job.id
    },
    createdByTelegramId: null,
    derivedLabelSource: "system",
    firstSeenAt: new Date(firstSeenAt ?? report.windowStart.toISOString()),
    lastSeenAt: new Date(lastSeenAt ?? report.windowEnd.toISOString())
  });

  if (saved === false) throw new Error("lost_forensic_job_claim");
  return {
    label: "darknet_exchange_proximity",
    assertionId
  };
}

function topApprovalDrainProfile(report: DeepAddressForensicReport): ApprovalDrainProvenanceProfile | null {
  return report.approvalDrainProvenanceProfiles.find((profile) => profile.score > 0) ?? null;
}

async function persistDerivedApprovalDrainProximityLabel(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport
): Promise<DerivedLabelResult> {
  if (!deps.upsertAddressLabelAssertion) return null;
  const profile = topApprovalDrainProfile(report);
  if (!profile) return null;
  const rawEvidenceId = report.rawEvidence.find((evidence) => "approvalDrainProvenanceProfile" in evidence.evidenceJson)?.id ?? null;
  const observationId = report.observations.find((observation) => observation.code === "forensic_approval_drain_provenance")?.id ?? null;
  const assertionId = `derived_tron_approval_drain_proximity_${report.subjectAddress}`;

  const saved = await deps.upsertAddressLabelAssertion({
    jobId: job.id,
    claimStartedAt: job.startedAt!,
    id: assertionId,
    chain: "tron",
    address: report.subjectAddress,
    label: "approval_drain_proximity",
    entityName: "Derived approval-drain proximity",
    category: "approval_drain_proximity",
    confidence: "high",
    severity: profile.score >= 90 ? "critical" : "high",
    status: "active",
    sourceName: "forensic_route_search",
    sourceUrl: null,
    notes: "System-derived marker from exact TRON USDT approval-drain provenance linked to this address.",
    evidenceJson: {
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      phase: "10A.10",
      source: "forensic_route_search",
      subjectAddress: report.subjectAddress,
      victimAddress: profile.victimAddress,
      spenderAddress: profile.spenderAddress,
      firstReceiverAddress: profile.firstReceiverAddress,
      hopDepth: profile.hopDepth,
      approvalTxHash: profile.approvalTxHash,
      drainTxHash: profile.drainTxHash,
      pathTxHashes: profile.pathTxHashes,
      pathAddresses: profile.pathAddresses,
      amountRaw: profile.amountRaw,
      amountPreservationRatio: profile.amountPreservationRatio,
      score: profile.score,
      evidenceStrength: profile.evidenceStrength,
      approvalAt: profile.approvalAt,
      drainAt: profile.drainAt,
      windowStart: report.windowStart.toISOString(),
      windowEnd: report.windowEnd.toISOString(),
      rawEvidenceId,
      observationId,
      jobId: job.id
    },
    createdByTelegramId: null,
    derivedLabelSource: "system",
    firstSeenAt: new Date(profile.approvalAt),
    lastSeenAt: new Date(profile.drainAt)
  });

  if (saved === false) throw new Error("lost_forensic_job_claim");
  return {
    label: "approval_drain_proximity",
    assertionId
  };
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function strictScoreBlockedReasonField(value: unknown): StrictScoreBlockedReason {
  if (
    value === "provider_error" ||
    value === "rate_limited_after_retries" ||
    value === "provider_inconsistent" ||
    value === "provider_cap_unresolved" ||
    value === "hard_safety_limit_exceeded"
  ) {
    return value;
  }
  return "provider_error";
}

function targetedStatusReasonField(value: unknown): TronAddressUsdtCoverageStatusReason | null {
  if (
    value === "complete_provider_windowed" ||
    value === "partial_provider_cap" ||
    value === "partial_budget_exhausted" ||
    value === "partial_rate_limited" ||
    value === "partial_provider_inconsistent" ||
    value === "too_large_deferred" ||
    value === "failed_retryable" ||
    value === "failed_terminal"
  ) {
    return value;
  }
  return null;
}

function targetedTerminalStatusReasonFromError(error: TargetedHistoryTerminalError | null): TronAddressUsdtCoverageStatusReason | null {
  if (!error) return null;
  const parts = error.message.split(":");
  return targetedStatusReasonField(parts.at(-1));
}

function nullableStringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strictScoreBlockedReasonFromError(error: unknown): StrictScoreBlockedReason {
  const message = errorMessage(error);
  if (/429|rate.?limit/i.test(message)) return "rate_limited_after_retries";
  if (message.includes("provider_inconsistent")) return "provider_inconsistent";
  if (message.includes("hard_safety_limit")) return "hard_safety_limit_exceeded";
  if (message.includes("provider_cap") || message.includes(":partial")) return "provider_cap_unresolved";
  return "provider_error";
}

function strictErrorMessageFromTargetedHistoryError(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("targeted_history_terminal:partial")) return "strict_provenance_targeted_index_terminal:partial";
  if (message.includes("targeted_history_terminal:failed_terminal")) return "strict_provenance_targeted_index_terminal:failed_terminal";
  if (message === "targeted_history_wait_release_failed") return "strict_provenance_wait_release_failed";
  return message;
}

function strictProviderLimitedProgressJson(
  progressJson: Record<string, unknown>,
  reason: StrictScoreBlockedReason
): Record<string, unknown> {
  return mergeForensicJobProgress(progressJson, {
    jobPhase: "provider_limited",
    strictProvenance: {
      phase: "provider_limited",
      scoreValid: false,
      scoreBlockedReason: reason,
      technicalStatus: strictTechnicalStatusFromBlockedReason(reason),
      waitingFor: null
    }
  });
}

function whereReportScoreValidityResultJson(report: WhereIsMoneyReport): Record<string, unknown> {
  return {
    score_valid: report.scoreValid === true,
    score_blocked_reason: report.scoreBlockedReason ?? null,
    technical_status: report.technicalStatus ?? "completed"
  };
}

function fastRiskReportFromJob(job: ForensicCheckJob): RiskReport | null {
  const snapshot = job.progressJson.fastRiskSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const score = (snapshot as Record<string, unknown>).score;
  const level = (snapshot as Record<string, unknown>).level;
  if (typeof score !== "number" || !isRiskLevel(level)) return null;
  const reasons = fastRiskReasonsField((snapshot as Record<string, unknown>).reasons);
  return {
    subjectAddress: job.subjectAddress,
    score,
    level,
    reasons
  };
}

const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function fastHintCategory(value: unknown): FastCheckHintAddress["category"] | undefined {
  if (value === null) return null;
  if (
    value === "bridge" ||
    value === "bridge_pool" ||
    value === "dex" ||
    value === "router" ||
    value === "cex" ||
    value === "hot_wallet" ||
    value === "swap_adapter" ||
    value === "service" ||
    value === "protocol" ||
    value === "unknown_contract" ||
    value === "none"
  ) {
    return value;
  }
  return undefined;
}

function fastHintRows(value: unknown, direction: FastCounterpartyTopDirection): FastCheckHintAddress[] {
  if (!Array.isArray(value)) return [];
  const rows: FastCheckHintAddress[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const address = item.address;
    const volumeRaw = item.volumeRaw;
    const txCount = item.txCount;
    const category = fastHintCategory(item.category);
    const identity = item.identity;
    if (typeof address !== "string" || !TRON_ADDRESS_PATTERN.test(address)) continue;
    if (typeof volumeRaw !== "string" || !/^\d+$/.test(volumeRaw)) continue;
    if (typeof txCount !== "number" || !Number.isFinite(txCount) || txCount <= 0) continue;
    if (category === undefined) continue;
    if (identity !== null && typeof identity !== "string") continue;
    rows.push({
      address,
      direction,
      volumeRaw,
      txCount,
      category,
      identity,
      reason: typeof item.reason === "string" && item.reason.length > 0 ? item.reason : `fast_check_${direction}_priority`
    });
  }
  return rows;
}

function fastCheckHintsFromJob(job: ForensicCheckJob): FastCheckHintAddress[] {
  const hints = job.progressJson.fastCheckHints;
  if (!isRecord(hints)) return [];
  if (
    hints.subjectAddress !== job.subjectAddress ||
    hints.windowStart !== job.windowStart.toISOString() ||
    hints.windowEnd !== job.windowEnd.toISOString()
  ) {
    return [];
  }

  const deduped = new Map<string, FastCheckHintAddress>();
  for (const hint of [
    ...fastHintRows(hints.topIncomingAddresses, "incoming"),
    ...fastHintRows(hints.topOutgoingAddresses, "outgoing"),
    ...fastHintRows(hints.topServiceAddresses, "service")
  ]) {
    if (!deduped.has(hint.address)) deduped.set(hint.address, hint);
  }
  return [...deduped.values()];
}

function fastRiskReasonsField(value: unknown): RiskReport["reasons"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item)) &&
      typeof (item as Record<string, unknown>).code === "string" &&
      typeof (item as Record<string, unknown>).message === "string" &&
      typeof (item as Record<string, unknown>).scoreImpact === "number" &&
      Number.isFinite((item as Record<string, unknown>).scoreImpact)
    )
    .map((item) => ({
      code: item.code as string,
      message: item.message as string,
      scoreImpact: item.scoreImpact as number,
      ...(typeof item.source === "string" ? { source: item.source } : {}),
      ...(typeof item.confidence === "string" ? { confidence: item.confidence as RiskReport["reasons"][number]["confidence"] } : {}),
      ...(typeof item.severity === "string" ? { severity: item.severity as RiskReport["reasons"][number]["severity"] } : {}),
      ...(typeof item.evidenceRef === "string" ? { evidenceRef: item.evidenceRef } : {})
    }));
}

function dedupeRouteEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  return mergeForensicRouteEdges(edges);
}

function historyCoverageSource(input: {
  indexedEdgeCount: number;
  liveEdgeCount: number;
}): MoneyOriginTraceHistoryCoverage["source"] {
  if (input.indexedEdgeCount > 0 && input.liveEdgeCount > 0) return "mixed";
  if (input.indexedEdgeCount > 0) return "local_index";
  if (input.liveEdgeCount > 0) return "live";
  return "unknown";
}

function oldestRouteEdgeTimestamp(edges: ForensicRouteEdge[]): Date | null {
  const timestamps = edges
    .map((edge) => edge.timestamp.getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps));
}

class StrictProvenanceWaitingForIndex extends Error {
  constructor() {
    super("strict_provenance_waiting_for_targeted_index");
  }
}

export type LegacyWhereIsMoneyExecution = {
  dependencies: WhereIsMoneyDeps;
  runInput: RunWhereIsMoneyCheckInput;
  run(dependencies?: WhereIsMoneyDeps): Promise<WhereIsMoneyReport>;
  measureStage<T>(stage: StageKey, operation: () => Promise<T>): Promise<T>;
  getCurrentProgress(): Record<string, unknown>;
  dispose(): Promise<void>;
};

/** Construct the one legacy Where execution graph used by production and capture. */
export function createLegacyWhereIsMoneyExecution(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions = {},
  runtime: { now?: () => number; abortSignal?: AbortSignal; abortController?: AbortController } = {}
): LegacyWhereIsMoneyExecution {
  let currentProgress = job.progressJson;
  const persistProgress = async (patch: ForensicJobProgressPatch): Promise<Record<string, unknown>> => {
    currentProgress = mergeForensicJobProgress(currentProgress, patch);
    job.progressJson = currentProgress;
    const updated = await deps.updateForensicCheckJobProgress?.({
      id: job.id,
      claimStartedAt: job.startedAt!,
      progressJson: currentProgress,
      lastError: null
    });
    if (updated === false) {
      runtime.abortController?.abort();
      throw new Error("lost_forensic_job_claim");
    }
    return currentProgress;
  };
  const enrichmentHeartbeat = createForensicEnrichmentHeartbeatCoordinator({
    intervalMs: options.transactionEnrichmentHeartbeatIntervalMs,
    now: runtime.now,
    isAborted: () => runtime.abortSignal?.aborted === true,
    heartbeat: async () => { await persistProgress({ jobHeartbeatAt: new Date(runtime.now?.() ?? Date.now()).toISOString() }); }
  });
  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const targetedEdgeCacheKeys = new Set<string>();
  const balanceSliceEdgeCacheKeys = new Set<string>();
  const historyCoverageCache = new Map<string, MoneyOriginTraceHistoryCoverage>();
  const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
  const classificationCache = new Map<string, ServiceClassification | null>();
  const targetedEnsureCache = new Map<string, Promise<boolean>>();
  const maxEdgesPerAddress = options.maxEdgesPerAddress ?? 100;
  const recentFallbackTransferLimit = options.recentFallbackTransferLimit ?? 150;
  const edgeFetchLimit = Math.max(recentFallbackTransferLimit, maxEdgesPerAddress);
  const exactWindowRepairLimit = Math.max(edgeFetchLimit, Math.floor(options.sourceProvenanceExactWindowRepairLimit ?? 500));
  const strictBenchmark = isStrictProvenanceBenchmarkJob(job);
  const canWaitForTargetedIndex = Boolean(
    deps.getAddressUsdtIndexState &&
    deps.queueAddressUsdtHistory &&
    deps.releaseForensicCheckJobToWaiting
  );
  const measureJobStage = async <T>(stage: StageKey, fn: () => Promise<T>): Promise<T> => {
    if (!strictBenchmark) return fn();
    const started = Date.now();
    try {
      return await fn();
    } finally {
      currentProgress = addStrictBenchmarkStageTiming(currentProgress, stage, Date.now() - started);
      job.progressJson = currentProgress;
    }
  };

  const edgeCacheKey = (address: string, maxTimestamp: Date): string =>
    maxTimestamp.getTime() === job.windowEnd.getTime()
      ? address
      : `${address}:${maxTimestamp.getTime()}`;

  const balanceSliceCacheKey = (
    address: string,
    maxTimestamp: Date,
    targetEdge: ForensicRouteEdge,
    expectedAmountRaw?: string | null
  ): string => {
    const amountRaw = expectedAmountRaw && /^\d+$/.test(expectedAmountRaw)
      ? expectedAmountRaw
      : targetEdge.amountRaw;
    return [
      edgeCacheKey(address, maxTimestamp),
      "balance_slice",
      targetEdge.txHash,
      targetEdge.fromAddress,
      targetEdge.toAddress,
      amountRaw
    ].join(":");
  };

  const maxTimestampForFetch = (fetchOptions: { latestTimestamp?: Date } = {}): Date =>
    fetchOptions.latestTimestamp && fetchOptions.latestTimestamp < job.windowEnd
      ? fetchOptions.latestTimestamp
      : job.windowEnd;

  type WhereEdgeFetchOptions = {
    latestTimestamp?: Date;
    deferBroadTargetedHistory?: boolean;
    targetEdge?: ForensicRouteEdge | null;
    expectedAmountRaw?: string | null;
  };

  const balanceFormingSliceProgressPatch = (input: {
    phase: "checking_balance_forming_slice" | "completed";
    address: string;
    target: ForensicRouteEdge;
    slice?: BalanceFormingSliceResult | null;
  }): ForensicJobProgressPatch => ({
    jobPhase: "checking_balance_forming_slice",
    balanceFormingSlice: {
      phase: input.phase,
      source: "live_bounded_slice",
      address: input.address,
      targetTimestamp: input.target.timestamp.toISOString(),
      targetTxHash: input.target.txHash,
      relatedHopTxHash: input.target.txHash,
      targetFromAddress: input.target.fromAddress,
      targetToAddress: input.target.toAddress,
      targetAmountRaw: input.target.amountRaw,
      fetchedPageCount: input.slice?.fetchedPageCount ?? 0,
      fetchedTransferCount: input.slice?.fetchedTransferCount ?? 0,
      status: input.slice?.status ?? null,
      reason: input.slice?.reason ?? null,
      coverageRatio: input.slice?.coverageRatio ?? null,
      coveredAmountRaw: input.slice?.coveredAmountRaw ?? null,
      providerCapHit: input.slice?.providerCapHit ?? false,
      budgetExhausted: input.slice?.pageBudgetExhausted ?? false,
      providerInconsistent: input.slice?.providerInconsistent ?? false
    }
  });

  const fetchBalanceFormingSlice = async (
    address: string,
    maxTimestamp: Date,
    targetEdge: ForensicRouteEdge,
    expectedAmountRaw?: string | null
  ): Promise<{ edges: ForensicRouteEdge[]; coverage: MoneyOriginTraceHistoryCoverage }> => {
    const minTimestamp = historicalFetchMinTimestamp(job, maxTimestamp);
    const target = expectedAmountRaw && /^\d+$/.test(expectedAmountRaw)
      ? { ...targetEdge, amountRaw: expectedAmountRaw }
      : targetEdge;
    await persistProgress(balanceFormingSliceProgressPatch({
      phase: "checking_balance_forming_slice",
      address,
      target
    }));
    const fetchedEdges: ForensicRouteEdge[] = [];
    let fetchedPageCount = 0;
    let providerInconsistent = false;
    let providerCapHit = false;
    let lastPageWasFull = false;
    let slice = buildBalanceFormingSlice({
      target,
      edges: [target],
      minCoverageRatio: WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO,
      maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
      fetchedPageCount,
      pageBudgetExhausted: false,
      providerCapHit: false,
      providerInconsistent
    });

    for (let page = 0; page < WHERE_BALANCE_SLICE_MAX_PAGES; page += 1) {
      let liveEdges: ForensicRouteEdge[] = [];
      try {
        const pageOptions = {
          start: page * WHERE_BALANCE_SLICE_PAGE_SIZE,
          limit: WHERE_BALANCE_SLICE_PAGE_SIZE,
          minTimestamp: minTimestamp.getTime(),
          endTimestamp: maxTimestamp.getTime()
        };
        const pageClient = deps.tronClient as typeof deps.tronClient & {
          listRelatedTrc20TransferPage?(
            address: string,
            options?: typeof pageOptions
          ): Promise<{ transfers: RawTronscanTrc20Transfer[]; rangeTotal: number | null }>;
        };
        let transfers: RawTronscanTrc20Transfer[];
        if (pageClient.listRelatedTrc20TransferPage) {
          const transferPage = await measureJobStage("apiMs", () =>
            pageClient.listRelatedTrc20TransferPage!(address, pageOptions)
          );
          transfers = transferPage.transfers;
          providerCapHit = providerCapHit ||
            (transferPage.rangeTotal !== null && transferPage.rangeTotal >= WHERE_BALANCE_SLICE_PROVIDER_CAP_RANGE_TOTAL);
        } else {
          transfers = await measureJobStage("apiMs", () =>
            deps.tronClient.listRelatedTrc20Transfers(address, pageOptions)
          );
        }
        fetchedPageCount += 1;
        liveEdges = transfers
          .map(normalizeTransfer)
          .filter((edge): edge is ForensicRouteEdge => edge !== null);
        lastPageWasFull = liveEdges.length >= WHERE_BALANCE_SLICE_PAGE_SIZE;
        fetchedEdges.push(...liveEdges);
      } catch (error) {
        fetchedPageCount += 1;
        providerInconsistent = true;
        lastPageWasFull = false;
        deps.logger?.warn("where_is_money_balance_forming_slice_fetch_failed", {
          jobId: job.id,
          address,
          targetTimestamp: maxTimestamp.toISOString(),
          error: errorMessage(error)
        });
      }

      const pageBudgetExhausted = !providerInconsistent &&
        page === WHERE_BALANCE_SLICE_MAX_PAGES - 1 &&
        lastPageWasFull;
      slice = buildBalanceFormingSlice({
        target,
        edges: dedupeRouteEdges([target, ...fetchedEdges]),
        minCoverageRatio: WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO,
        maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
        fetchedPageCount,
        pageBudgetExhausted,
        providerCapHit,
        providerInconsistent
      });
      if (slice.status === "covered" || slice.status === "provider_inconsistent" || !lastPageWasFull) break;
    }

    const edges = dedupeRouteEdges([target, ...fetchedEdges]);
    const oldestFetchedTransferAt = oldestRouteEdgeTimestamp(edges)?.toISOString() ?? null;
    const coverageComplete = slice.status === "covered";
    const coverageProviderCapHit = slice.providerCapHit;
    const budgetExhausted = slice.pageBudgetExhausted;
    const providerInconsistentFlag = slice.providerInconsistent;
    const balanceFormingSlice = {
      status: slice.status,
      reason: slice.reason,
      targetTxHash: slice.targetTxHash,
      targetFromAddress: slice.targetFromAddress,
      targetToAddress: slice.targetToAddress,
      targetAmountRaw: slice.targetAmountRaw,
      targetTimestamp: slice.targetTimestamp,
      coveredAmountRaw: slice.coveredAmountRaw,
      coverageRatio: slice.coverageRatio,
      fetchedTransferCount: slice.fetchedTransferCount,
      fetchedPageCount: slice.fetchedPageCount,
      pageBudgetExhausted: slice.pageBudgetExhausted,
      providerCapHit: slice.providerCapHit,
      providerInconsistent: slice.providerInconsistent
    };
    await persistProgress(balanceFormingSliceProgressPatch({
      phase: "completed",
      address,
      target,
      slice
    }));
    return {
      edges,
      coverage: {
        address,
        targetTimestamp: maxTimestamp.toISOString(),
        fetchedTransferCount: edges.length,
        fetchedPageCount,
        oldestFetchedTransferAt,
        reachedTargetHop: coverageComplete,
        source: "live",
        coverageComplete,
        providerCapHit: coverageProviderCapHit,
        budgetExhausted,
        providerInconsistent: providerInconsistentFlag,
        statusReason: providerInconsistentFlag
          ? "partial_provider_inconsistent"
          : coverageProviderCapHit
            ? "partial_provider_cap"
            : budgetExhausted
              ? "partial_budget_exhausted"
              : null,
        balanceFormingSlice
      }
    };
  };

  const ensureTargetedHistory = async (
    address: string,
    maxTimestamp: Date,
    fetchOptions: WhereEdgeFetchOptions
  ): Promise<boolean> => {
    if (!fetchOptions.latestTimestamp) return true;
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const cached = targetedEnsureCache.get(cacheKey);
    if (cached) return cached;
    if (canWaitForTargetedIndex) {
      const ensured = Promise.resolve()
        .then(() => ensureTargetedHistoryOrWait({
          jobId: job.id,
          claimStartedAt: job.startedAt!,
          address,
          targetTimestamp: maxTimestamp,
          queuedReason: "where_is_money_hop",
          requiredFor: "where_hop",
          maxRetryBudgetPages: options.targetedHistoryMaxBudgetPages,
          progressJson: currentProgress,
          deps: {
            getAddressUsdtIndexState: deps.getAddressUsdtIndexState!,
            getCoveringAddressUsdtIndexState: deps.getCoveringAddressUsdtIndexState,
            queueAddressUsdtHistory: deps.queueAddressUsdtHistory!,
            releaseForensicCheckJobToWaiting: deps.releaseForensicCheckJobToWaiting!,
            upsertForensicJobWait: deps.upsertForensicJobWait,
            markWaitingForensicJobsReadyAfterTargetedIndex: deps.markWaitingForensicJobsReadyAfterTargetedIndex
          },
          persistProgress,
          afterWaitingPatch: strictBenchmark
            ? strictWaitingProgressPatch({
                address,
                targetTimestamp: maxTimestamp,
                queuedReason: "where_is_money_hop"
              })
            : undefined
        }));
      targetedEnsureCache.set(cacheKey, ensured);
      return ensured;
    }
    if (!deps.ensureAddressUsdtHistory) return true;
    const ensureAddressUsdtHistory = deps.ensureAddressUsdtHistory;
    const ensured = Promise.resolve()
      .then(() => ensureAddressUsdtHistory({
        jobId: job.id,
        claimStartedAt: job.startedAt!,
        address,
        coverageMode: "targeted",
        targetTimestamp: maxTimestamp,
        stopAtTimestamp: maxTimestamp,
        requestedByJobId: job.id,
        queuedReason: "where_is_money_hop"
      }))
      .then((state) => {
        const complete = state.coverageMode === "targeted" && state.status === "complete";
        if (!complete) {
          deps.logger?.warn("where_is_money_targeted_history_ensure_incomplete", {
            jobId: job.id,
            address,
            targetTimestamp: maxTimestamp.toISOString(),
            status: state.status
          });
        }
        return complete;
      })
      .catch((error) => {
        deps.logger?.warn("where_is_money_targeted_history_ensure_failed", {
          jobId: job.id,
          address,
          targetTimestamp: maxTimestamp.toISOString(),
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      });
    targetedEnsureCache.set(cacheKey, ensured);
    return ensured;
  };

  const isCompleteBroadTargetedState = (state: TronAddressUsdtIndexState | null | undefined): boolean =>
    state?.coverageMode === "targeted" &&
    state.status === "complete" &&
    state.statusReason === "complete_provider_windowed" &&
    (state.requestKind ?? "broad_targeted") === "broad_targeted";

  const hasCompleteBroadTargetedHistory = async (address: string, maxTimestamp: Date): Promise<boolean> => {
    if (!canWaitForTargetedIndex || !deps.getAddressUsdtIndexState) return false;
    const exact = await deps.getAddressUsdtIndexState({
      address,
      coverageMode: "targeted",
      targetTimestamp: maxTimestamp,
      requestKind: "broad_targeted"
    }).catch(() => null);
    if (isCompleteBroadTargetedState(exact)) return true;
    const covering = await deps.getCoveringAddressUsdtIndexState?.({
      address,
      coverageMode: "targeted",
      targetTimestamp: maxTimestamp
    }).catch(() => null) ?? null;
    return isCompleteBroadTargetedState(covering);
  };

  const fetchEdgesForAddress = async (address: string, fetchOptions: WhereEdgeFetchOptions = {}): Promise<ForensicRouteEdge[]> => {
    const maxTimestamp = maxTimestampForFetch(fetchOptions);
    const minTimestamp = historicalFetchMinTimestamp(job, maxTimestamp);
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const isTargetedHopFetch = Boolean(fetchOptions.latestTimestamp);
    const requestedBroadTargetedDefer = isTargetedHopFetch && fetchOptions.deferBroadTargetedHistory === true;
    const completeBroadTargetedHistory = requestedBroadTargetedDefer
      ? await hasCompleteBroadTargetedHistory(address, maxTimestamp)
      : false;
    if (
      isTargetedHopFetch &&
      fetchOptions.deferBroadTargetedHistory === true &&
      fetchOptions.targetEdge &&
      !strictBenchmark &&
      !completeBroadTargetedHistory
    ) {
      const sliceCacheKey = balanceSliceCacheKey(
        address,
        maxTimestamp,
        fetchOptions.targetEdge,
        fetchOptions.expectedAmountRaw
      );
      if (edgeCache.has(sliceCacheKey) && balanceSliceEdgeCacheKeys.has(sliceCacheKey)) {
        return edgeCache.get(sliceCacheKey) ?? [];
      }
      const slice = await fetchBalanceFormingSlice(
        address,
        maxTimestamp,
        fetchOptions.targetEdge,
        fetchOptions.expectedAmountRaw
      );
      edgeCache.set(sliceCacheKey, slice.edges);
      historyCoverageCache.set(sliceCacheKey, slice.coverage);
      balanceSliceEdgeCacheKeys.add(sliceCacheKey);
      return slice.edges;
    }
    if (completeBroadTargetedHistory) {
      if (edgeCache.has(cacheKey) && targetedEdgeCacheKeys.has(cacheKey)) {
        return edgeCache.get(cacheKey) ?? [];
      }
      const expectedAmountRaw = rawAmountField(fetchOptions.expectedAmountRaw);
      const target = fetchOptions.targetEdge
        ? {
            ...fetchOptions.targetEdge,
            amountRaw: expectedAmountRaw ?? fetchOptions.targetEdge.amountRaw
          }
        : null;
      const materialized = await measureJobStage("dbReadMs", () => materializeIndexedTransferWindow({
        address,
        minTimestamp,
        maxTimestamp,
        pageSize: edgeFetchLimit,
        maxRows: options.localIndexMaterializationMaxRows ?? DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS,
        ...(target
          ? {
              // ponytail: recompute the bounded slice per page; upgrade to incremental cashflow accounting if dense local windows make this hot.
              isSatisfied: (rows: readonly IndexedTronUsdtTransfer[]) => buildBalanceFormingSlice({
                target,
                edges: dedupeRouteEdges([target, ...rows.map(indexedTransferToRouteEdge)]),
                minCoverageRatio: WHERE_BALANCE_SLICE_MIN_COVERAGE_RATIO,
                maxFunders: DEFAULT_MAX_BUNDLE_FUNDERS,
                fetchedPageCount: 0,
                pageBudgetExhausted: false,
                providerCapHit: false,
                providerInconsistent: false
              }).status === "covered"
            }
          : {}),
        onPage: async ({ rowCount, pageReadCount }) => {
          if (pageReadCount !== 1 && pageReadCount % 10 !== 0) return;
          await persistProgress({
            jobPhase: "reading_local_index",
            targetedIndex: {
              phase: "reading_local_index",
              address,
              rowCount,
              pageReadCount
            }
          });
        },
        readPage: async (pageAddress, pageOptions) => {
          if (!deps.listIndexedUsdtTransfersForAddress) {
            throw new Error("local index reader unavailable");
          }
          return deps.listIndexedUsdtTransfersForAddress(pageAddress, {
            minTimestamp: pageOptions.minTimestamp,
            maxTimestamp: pageOptions.maxTimestamp,
            limit: pageOptions.limit,
            offset: pageOptions.offset,
            orderBy: pageOptions.orderBy,
            direction: pageOptions.direction
          });
        }
      }));
      const localEdges = dedupeRouteEdges(materialized.rows.map(indexedTransferToRouteEdge));
      const edges = target ? dedupeRouteEdges([target, ...localEdges]) : localEdges;
      const localComplete = materialized.status === "complete";
      historyCoverageCache.set(cacheKey, {
        address,
        targetTimestamp: maxTimestamp.toISOString(),
        fetchedTransferCount: materialized.rows.length,
        fetchedPageCount: materialized.pageReadCount,
        oldestFetchedTransferAt: oldestRouteEdgeTimestamp(localEdges)?.toISOString() ?? null,
        reachedTargetHop: localComplete,
        source: "local_index",
        coverageComplete: localComplete,
        providerCapHit: false,
        budgetExhausted: materialized.status === "local_limit",
        providerInconsistent: false,
        statusReason: null,
        localMaterializationStatus: materialized.status,
        localMaterializationCompletionReason: materialized.completionReason,
        localMaterializationKnownZero: materialized.knownZero,
        localMaterializationError: materialized.error
      });
      edgeCache.set(cacheKey, edges);
      targetedEdgeCacheKeys.add(cacheKey);
      return edges;
    }
    const broadTargetedHistoryDeferred = requestedBroadTargetedDefer && !completeBroadTargetedHistory;
    let targetedEnsureSucceeded = !broadTargetedHistoryDeferred;
    let targetedTerminalError: TargetedHistoryTerminalError | null = null;
    try {
      if (!broadTargetedHistoryDeferred) {
        targetedEnsureSucceeded = await ensureTargetedHistory(address, maxTimestamp, fetchOptions);
      }
    } catch (error) {
      if (!(error instanceof TargetedHistoryTerminalError) || !deps.listIndexedUsdtTransfersForAddress) {
        throw error;
      }
      targetedEnsureSucceeded = false;
      targetedTerminalError = error;
    }
    if (edgeCache.has(cacheKey) && (!isTargetedHopFetch || targetedEdgeCacheKeys.has(cacheKey))) {
      return edgeCache.get(cacheKey) ?? [];
    }
    let indexedFetchFailed = false;
    let liveFetchFailed = false;
    const indexedTransfers = deps.listIndexedUsdtTransfersForAddress
      ? await measureJobStage("dbReadMs", () =>
          deps.listIndexedUsdtTransfersForAddress!(address, {
            minTimestamp,
            maxTimestamp,
            limit: edgeFetchLimit,
            orderBy: "newest"
          }).catch(() => {
            indexedFetchFailed = true;
            return [];
          })
        )
      : [];
    const indexedEdges = indexedTransfers.map(indexedTransferToRouteEdge);
    if (targetedTerminalError && indexedEdges.length === 0) throw targetedTerminalError;
    const liveWasQueried = !completeBroadTargetedHistory && indexedEdges.length < maxEdgesPerAddress;
    const liveTransfers = liveWasQueried
      ? await deps.tronClient.listRelatedTrc20Transfers(address, {
          start: 0,
          limit: maxEdgesPerAddress,
          minTimestamp: minTimestamp.getTime(),
          endTimestamp: maxTimestamp.getTime()
        }).catch(() => {
          liveFetchFailed = true;
          return [];
        })
      : [];
    const liveEdges = liveTransfers
      .map(normalizeTransfer)
      .filter((edge): edge is ForensicRouteEdge => edge !== null);
    const edges = dedupeRouteEdges([...indexedEdges, ...liveEdges]);
    const oldestIndexedAt = oldestRouteEdgeTimestamp(indexedEdges);
    const oldestLiveAt = oldestRouteEdgeTimestamp(liveEdges);
    const oldestFetchedAt = oldestRouteEdgeTimestamp(edges);
    const oldestFetchedTransferAt = oldestFetchedAt?.toISOString() ?? null;
    const indexedMayBeTruncated = indexedEdges.length >= edgeFetchLimit &&
      oldestIndexedAt !== null &&
      oldestIndexedAt > minTimestamp;
    const liveMayBeTruncated = liveWasQueried &&
      liveEdges.length >= maxEdgesPerAddress &&
      oldestLiveAt !== null &&
      oldestLiveAt > minTimestamp;
    const targetedTerminalStatusReason = targetedTerminalStatusReasonFromError(targetedTerminalError);
    const targetedTerminalProviderCapHit = targetedTerminalStatusReason === "partial_provider_cap";
    const targetedTerminalBudgetExhausted = targetedTerminalStatusReason === "partial_budget_exhausted";
    const targetedTerminalProviderInconsistent = targetedTerminalStatusReason === "partial_provider_inconsistent" ||
      targetedTerminalStatusReason === "failed_terminal";
    const noTruncationSignal = completeBroadTargetedHistory || (!indexedMayBeTruncated && !liveMayBeTruncated);
    const fetchFailed = indexedFetchFailed || liveFetchFailed || targetedTerminalProviderInconsistent;
    const oldestCombinedReachesFetchMin = oldestFetchedAt !== null && oldestFetchedAt <= minTimestamp;
    const fetchedPageCount = (deps.listIndexedUsdtTransfersForAddress ? 1 : 0) + (liveWasQueried ? 1 : 0);
    const reachedTargetHop = !broadTargetedHistoryDeferred && targetedEnsureSucceeded && !fetchFailed && noTruncationSignal && (
      completeBroadTargetedHistory ||
      edges.length === 0 ||
      oldestCombinedReachesFetchMin ||
      (indexedEdges.length < edgeFetchLimit && (!liveWasQueried || liveEdges.length < maxEdgesPerAddress))
    );
    const budgetExhausted = broadTargetedHistoryDeferred ||
      (!completeBroadTargetedHistory && (indexedMayBeTruncated || liveMayBeTruncated)) ||
      targetedTerminalBudgetExhausted;
    const providerCapHit = targetedTerminalProviderCapHit;
    historyCoverageCache.set(cacheKey, {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: edges.length,
      fetchedPageCount,
      oldestFetchedTransferAt,
      reachedTargetHop,
      source: historyCoverageSource({
        indexedEdgeCount: indexedEdges.length,
        liveEdgeCount: liveEdges.length
      }),
      coverageComplete: reachedTargetHop,
      providerCapHit,
      budgetExhausted,
      providerInconsistent: fetchFailed,
      statusReason: targetedTerminalStatusReason ??
        (fetchFailed ? "partial_provider_inconsistent" : budgetExhausted ? "partial_budget_exhausted" : null)
    });
    edgeCache.set(cacheKey, edges);
    if (isTargetedHopFetch && !broadTargetedHistoryDeferred) targetedEdgeCacheKeys.add(cacheKey);
    return edges;
  };

  const getHistoryCoverageForAddress = async (
    address: string,
    fetchOptions: WhereEdgeFetchOptions = {}
  ): Promise<MoneyOriginTraceHistoryCoverage> => {
    const maxTimestamp = maxTimestampForFetch(fetchOptions);
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const isTargetedHopFetch = Boolean(fetchOptions.latestTimestamp);
    const isBalanceSliceFetch = isTargetedHopFetch &&
      fetchOptions.deferBroadTargetedHistory === true &&
      Boolean(fetchOptions.targetEdge) &&
      !strictBenchmark;
    const coverageCacheKey = isBalanceSliceFetch && fetchOptions.targetEdge
      ? balanceSliceCacheKey(address, maxTimestamp, fetchOptions.targetEdge, fetchOptions.expectedAmountRaw)
      : cacheKey;
    const cached = historyCoverageCache.get(coverageCacheKey);
    if (cached && (
      !isTargetedHopFetch ||
      targetedEdgeCacheKeys.has(coverageCacheKey) ||
      !balanceSliceEdgeCacheKeys.has(coverageCacheKey) ||
      (isBalanceSliceFetch && balanceSliceEdgeCacheKeys.has(coverageCacheKey))
    )) {
      return cached;
    }
    await fetchEdgesForAddress(address, fetchOptions);
    return historyCoverageCache.get(coverageCacheKey) ?? historyCoverageCache.get(cacheKey) ?? {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: 0,
      fetchedPageCount: 0,
      oldestFetchedTransferAt: null,
      reachedTargetHop: false,
      source: "unknown",
      coverageComplete: false,
      providerCapHit: null,
      budgetExhausted: null,
      providerInconsistent: true,
      statusReason: "partial_provider_inconsistent"
    };
  };

  const repairSourceProvenanceWindow = async (input: {
    target: ForensicRouteEdge;
    windowStart: Date;
    windowEnd: Date;
    downstreamAmountRaw?: string | null;
    minCoverageRatio: number;
    maxFunders: number;
  }) => {
    const minTimestamp = input.windowStart;
    const maxTimestamp = input.windowEnd;
    let indexedFetchFailed = false;
    let liveFetchFailed = false;
    const indexedTransfers = deps.listIndexedUsdtTransfersForAddress
      ? await measureJobStage("dbReadMs", () =>
          deps.listIndexedUsdtTransfersForAddress!(input.target.fromAddress, {
            minTimestamp,
            maxTimestamp,
            limit: exactWindowRepairLimit,
            orderBy: "newest"
          }).catch(() => {
            indexedFetchFailed = true;
            return [];
          })
        )
      : [];
    const indexedEdges = indexedTransfers.map(indexedTransferToRouteEdge);
    const liveLimit = exactWindowRepairLimit;
    const liveWasQueried = indexedEdges.length < exactWindowRepairLimit;
    const liveTransfers = liveWasQueried
      ? await deps.tronClient.listRelatedTrc20Transfers(input.target.fromAddress, {
          start: 0,
          limit: liveLimit,
          minTimestamp: minTimestamp.getTime(),
          endTimestamp: maxTimestamp.getTime()
        }).catch(() => {
          liveFetchFailed = true;
          return [];
        })
      : [];
    const liveEdges = liveTransfers
      .map(normalizeTransfer)
      .filter((edge): edge is ForensicRouteEdge => edge !== null);
    const edges = dedupeRouteEdges([...indexedEdges, ...liveEdges, input.target]);
    const oldestIndexedAt = oldestRouteEdgeTimestamp(indexedEdges);
    const oldestLiveAt = oldestRouteEdgeTimestamp(liveEdges);
    const oldestFetchedAt = oldestRouteEdgeTimestamp(edges);
    const indexedMayBeTruncated = indexedEdges.length >= exactWindowRepairLimit &&
      oldestIndexedAt !== null &&
      oldestIndexedAt > minTimestamp;
    const liveMayBeTruncated = liveWasQueried &&
      liveEdges.length >= liveLimit &&
      oldestLiveAt !== null &&
      oldestLiveAt > minTimestamp;
    const fetchFailed = indexedFetchFailed || liveFetchFailed;
    const oldestCombinedReachesWindowStart = oldestFetchedAt !== null && oldestFetchedAt <= minTimestamp;
    const complete = !fetchFailed && !indexedMayBeTruncated && !liveMayBeTruncated && (
      edges.length === 0 ||
      oldestCombinedReachesWindowStart ||
      (indexedEdges.length < exactWindowRepairLimit && (!liveWasQueried || liveEdges.length < liveLimit))
    );
    const capped = indexedMayBeTruncated || liveMayBeTruncated;

    return repairFundingSourceExactWindow({
      target: input.target,
      windowEdges: edges,
      windowCoverage: {
        complete,
        capped,
        providerInconsistent: fetchFailed,
        statusReason: fetchFailed
          ? "partial_provider_inconsistent"
          : capped
            ? "partial_provider_cap"
            : null,
        fetchedTransferCount: edges.length,
        fetchedPageCount: (deps.listIndexedUsdtTransfersForAddress ? 1 : 0) + (liveWasQueried ? 1 : 0),
        oldestFetchedTransferAt: oldestFetchedAt?.toISOString() ?? null,
        source: historyCoverageSource({
          indexedEdgeCount: indexedEdges.length,
          liveEdgeCount: liveEdges.length
        })
      },
      downstreamAmountRaw: input.downstreamAmountRaw,
      minCoverageRatio: input.minCoverageRatio,
      maxFunders: input.maxFunders
    });
  };

  const fetchLatestEdgesForAddress = async (address: string, limit: number): Promise<ForensicRouteEdge[]> => {
    const liveLimit = Math.min(limit, maxEdgesPerAddress);
    const cacheKey = `${address}:${limit}:${liveLimit}`;
    if (latestEdgeCache.has(cacheKey)) return latestEdgeCache.get(cacheKey) ?? [];
    const indexedTransfers = deps.listIndexedUsdtTransfersForAddress
      ? await measureJobStage("dbReadMs", () =>
          deps.listIndexedUsdtTransfersForAddress!(address, {
            minTimestamp: new Date(0),
            maxTimestamp: job.windowEnd,
            limit,
            orderBy: "newest"
          }).catch(() => [])
        )
      : [];
    const indexedEdges = indexedTransfers.map(indexedTransferToRouteEdge);
    const liveEdges = indexedEdges.length < limit
      ? (await deps.tronClient.listRelatedTrc20Transfers(address, { start: 0, limit: liveLimit }).catch(() => []))
          .map(normalizeTransfer)
          .filter((edge): edge is ForensicRouteEdge => edge !== null)
      : [];
    const edges = dedupeRouteEdges([...indexedEdges, ...liveEdges]);
    latestEdgeCache.set(cacheKey, edges);
    return edges;
  };

  const getClassificationForAddress = async (address: string): Promise<ServiceClassification | null> => {
    if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
    const metadata = await deps.getAddressMetadata?.(address).catch(() => null) ?? null;
    const contractProfile = metadata?.isContract
      ? await deps.getContractIntelligenceProfile?.(address).catch(() => null) ?? null
      : null;
    const classification = classifyServiceAddress({ address, metadata, contractProfile });
    classificationCache.set(address, classification);
    return classification;
  };

  const requestCandidateWindows = canWaitForTargetedIndex
    ? (requests: WhereCandidateWindowRequest[]): Promise<true> => ensureCandidateWindowsOrWait({
        jobId: job.id,
        claimStartedAt: job.startedAt!,
        requests: requests.slice(0, 20),
        progressJson: currentProgress,
        deps: {
          getAddressUsdtIndexState: deps.getAddressUsdtIndexState!,
          getCoveringAddressUsdtIndexState: deps.getCoveringAddressUsdtIndexState,
          queueAddressUsdtHistory: deps.queueAddressUsdtHistory!,
          releaseForensicCheckJobToWaiting: deps.releaseForensicCheckJobToWaiting!,
          upsertForensicJobWait: deps.upsertForensicJobWait,
          markWaitingForensicJobsReadyAfterTargetedIndex: deps.markWaitingForensicJobsReadyAfterTargetedIndex
        },
        persistProgress
      })
    : undefined;

  const ensureBroadTargetedHistory = canWaitForTargetedIndex
    ? (input: {
        address: string;
        targetTimestamp: Date;
        queuedReason: "where_is_money_hop";
        reason: "material_unresolved_after_candidate_windows" | "hard_evidence_requires_full_coverage";
      }): Promise<true> => ensureTargetedHistory(input.address, input.targetTimestamp, {
        latestTimestamp: input.targetTimestamp
      })
        .then(() => true as const)
        .catch(async (error) => {
          if (!(error instanceof TargetedHistoryTerminalError) || !deps.listIndexedUsdtTransfersForAddress) throw error;
          const cacheKey = edgeCacheKey(input.address, input.targetTimestamp);
          edgeCache.delete(cacheKey);
          historyCoverageCache.delete(cacheKey);
          targetedEdgeCacheKeys.delete(cacheKey);
          balanceSliceEdgeCacheKeys.delete(cacheKey);
          await fetchEdgesForAddress(input.address, { latestTimestamp: input.targetTimestamp });
          return true as const;
        })
    : undefined;

  const ensureBroadTargetedHistories = canWaitForTargetedIndex
    ? (requests: BroadTargetedHistoryRequest[]): Promise<true> => ensureTargetedHistoriesOrWait({
        jobId: job.id,
        claimStartedAt: job.startedAt!,
        requests: requests.map((request) => ({
          ...request,
          requiredFor: "where_hop" as const
        })),
        maxRetryBudgetPages: options.targetedHistoryMaxBudgetPages,
        progressJson: currentProgress,
        deps: {
          getAddressUsdtIndexState: deps.getAddressUsdtIndexState!,
          getCoveringAddressUsdtIndexState: deps.getCoveringAddressUsdtIndexState,
          queueAddressUsdtHistory: deps.queueAddressUsdtHistory!,
          releaseForensicCheckJobToWaiting: deps.releaseForensicCheckJobToWaiting!,
          upsertForensicJobWait: deps.upsertForensicJobWait,
          markWaitingForensicJobsReadyAfterTargetedIndex: deps.markWaitingForensicJobsReadyAfterTargetedIndex
        },
        persistProgress,
        afterWaitingPatch: strictBenchmark && requests.length > 0
          ? strictWaitingProgressPatch({
              address: requests[0].address,
              targetTimestamp: requests[0].targetTimestamp,
              queuedReason: requests[0].queuedReason
            })
          : undefined,
        onTerminalTarget: async ({ request, error }) => {
          if (!deps.listIndexedUsdtTransfersForAddress) throw error;
          const cacheKey = edgeCacheKey(request.address, request.targetTimestamp);
          edgeCache.delete(cacheKey);
          historyCoverageCache.delete(cacheKey);
          targetedEdgeCacheKeys.delete(cacheKey);
          balanceSliceEdgeCacheKeys.delete(cacheKey);
          await fetchEdgesForAddress(request.address, { latestTimestamp: request.targetTimestamp });
        }
      })
    : undefined;

  const fastRiskReport = fastRiskReportFromJob(job);
  const dependencies: WhereIsMoneyDeps = {
    getTrc20Balance: async (address, tokenContractAddress) => {
      if (tokenContractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
      const state = await deps.getUsdtRestrictionStatus(address).catch(() => null);
      return state?.balanceRaw ?? null;
    },
    fetchEdgesForAddress,
    getHistoryCoverageForAddress,
    repairSourceProvenanceWindow,
    ...(requestCandidateWindows ? { requestCandidateWindows } : {}),
    ...(ensureBroadTargetedHistory ? { ensureBroadTargetedHistory } : {}),
    ...(ensureBroadTargetedHistories ? { ensureBroadTargetedHistories } : {}),
    fetchLatestEdgesForAddress,
    getLabelsForAddress: deps.getLabelsForAddress,
    getClassificationForAddress,
    getFastWalletRisk: async () => fastRiskReport,
    ...(deps.getTransaction ? { getTransaction: deps.getTransaction } : {}),
    ...(deps.selectiveTransactionEnricher ? { selectiveTransactionEnricher: deps.selectiveTransactionEnricher } : {}),
    ...(deps.listActiveRouteAssertions ? { listActiveRouteAssertions: deps.listActiveRouteAssertions } : {}),
    ...(deps.listIndexedMovementsByHashes ? { listIndexedMovementsByHashes: deps.listIndexedMovementsByHashes } : {}),
    ...(deps.listTrc20ApprovalChanges ? { listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges } : {}),
    getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus,
    ...(deps.getContractIntelligenceProfile
      ? { getContractIntelligenceProfile: deps.getContractIntelligenceProfile }
      : {}),
    ...(deps.crossChainDiscoveryProvider
      ? { crossChainDiscoveryProvider: deps.crossChainDiscoveryProvider }
      : {}),
    ...(deps.crossChainContinuationProviders
      ? { crossChainContinuationProviders: deps.crossChainContinuationProviders }
      : {}),
    ...(deps.evmEvidenceProvider ? { evmEvidenceProvider: deps.evmEvidenceProvider } : {})
  };
  const runInput: RunWhereIsMoneyCheckInput = {
    ...resolveLegacyWhereIsMoneyRunInput(job, options),
    ...(runtime.now ? { now: runtime.now } : {}),
    ...(runtime.abortSignal ? { abortSignal: runtime.abortSignal } : {}),
    runWithTransactionEnrichmentHeartbeat: (task) => enrichmentHeartbeat.run(task),
    onProgress: async (patch) => {
      await persistProgress(patch);
    }
  };
  return {
    dependencies,
    runInput,
    run: (runtimeDependencies = dependencies) =>
      measureJobStage("traceMs", () => runWhereIsMoneyCheck(runtimeDependencies, runInput)),
    measureStage: measureJobStage,
    getCurrentProgress: () => currentProgress,
    dispose: () => enrichmentHeartbeat.dispose()
  };
}

async function runWhereIsMoneyJob(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions,
  abortController?: AbortController
): Promise<boolean> {
  const execution = createLegacyWhereIsMoneyExecution(deps, job, options, {
    abortSignal: abortController?.signal,
    abortController
  });
  try {
  const strictBenchmark = isStrictProvenanceBenchmarkJob(job);
  let report: WhereIsMoneyReport;
  try {
    const currentReport = await execution.run();
    report = {
      ...currentReport,
      scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
    };
  } catch (error) {
    if (error instanceof StrictProvenanceWaitingForIndex || error instanceof TargetedHistoryWaitingForIndex) return true;
    throw error;
  }

  const status = report.crossChainCorridor?.partial === true ? "partial" : "completed";
  const strictPartial = report.coverage?.partial === true || report.crossChainCorridor?.partial === true;
  if (strictBenchmark) {
    await execution.measureStage("scoringMs", async () => null);
  }
  if (strictBenchmark && strictPartial) {
    // ponytail: no local partial-reason taxonomy yet; map provider partial details here if one appears.
    const reason: StrictScoreBlockedReason = "provider_error";
    const delivery = await buildForensicJobFailureDelivery(deps, job, reason);
    const completed = await deps.completeForensicCheckJob({
      id: job.id,
      claimStartedAt: job.startedAt!,
      status: "failed",
      progressJson: progressWithDelivery({
        ...strictProviderLimitedProgressJson(execution.getCurrentProgress(), reason),
        whereIsMoneyCoverage: report.coverage,
        decision: report.decision,
        riskScore: report.riskScore
      }, delivery),
      resultJson: {
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        subjectAddress: report.subjectAddress,
        whereIsMoneyReport: report,
        contractDrivenReceiverProfile: report.contractDrivenReceiverProfile ?? null,
        contractDrivenTransferProfiles: report.contractDrivenTransferProfiles ?? [],
        ...strictBlockedResultJson(reason)
      },
      rawEvidenceIds: [...new Set([
        ...job.rawEvidenceIds,
        ...(report.transactionInfoEnrichment?.evidenceIds ?? [])
      ])],
      observationIds: [],
      lastError: reason
    });
    if (!completed) {
      if (abortController && !abortController.signal.aborted) abortController.abort();
      throw new Error("lost_forensic_job_claim");
    }
    return true;
  }
  const currentProgress = execution.getCurrentProgress();
  const strictProgressPatch = strictBenchmark
    ? {
        strictProvenance: {
          ...(isRecord(currentProgress.strictProvenance) ? currentProgress.strictProvenance : {}),
          phase: "completed",
          scoreValid: true,
          scoreBlockedReason: null,
          technicalStatus: "completed",
          waitingFor: null
        }
      }
    : {};
  const completion = {
    id: job.id,
    claimStartedAt: job.startedAt!,
    status,
    progressJson: progressWithDelivery({
      ...execution.getCurrentProgress(),
      ...strictProgressPatch,
      whereIsMoneyCoverage: report.coverage,
      decision: report.decision,
      riskScore: report.riskScore
    }, await buildWhereIsMoneyJobResultDelivery(deps, job, report, status)),
    resultJson: {
      scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
      subjectAddress: report.subjectAddress,
      ...(strictBenchmark ? strictCompletedResultJson() : whereReportScoreValidityResultJson(report)),
      whereIsMoneyReport: report,
      contractDrivenReceiverProfile: report.contractDrivenReceiverProfile ?? null,
      contractDrivenTransferProfiles: report.contractDrivenTransferProfiles ?? []
    },
    rawEvidenceIds: [...new Set([
      ...job.rawEvidenceIds,
      ...(report.transactionInfoEnrichment?.evidenceIds ?? [])
    ])],
    observationIds: [],
    lastError: null
  } satisfies Parameters<DeepForensicJobRunnerDeps["completeForensicCheckJob"]>[0];
  const completed = await deps.completeForensicCheckJob(completion);
  if (!completed) {
    if (abortController && !abortController.signal.aborted) abortController.abort();
    throw new Error("lost_forensic_job_claim");
  }
  await indexWalletIntelligenceBestEffort(deps, job, {
    progressJson: completion.progressJson,
    resultJson: completion.resultJson,
    status
  });
  return true;
  } finally {
    await execution.dispose();
  }
}

export async function runSingleDeepForensicJobCycle(
  deps: DeepForensicJobRunnerDeps,
  options: DeepForensicJobRunnerOptions = {}
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;
  if (!job.startedAt) throw new Error("claimed_forensic_job_missing_started_at");
  const abortController = new AbortController();
  let enrichmentHeartbeat: ForensicEnrichmentHeartbeatCoordinator | null = null;

  try {
    if (job.kind === "where_is_money_check") {
      if (isStrictProvenanceBenchmarkJob(job) && job.progressJson.jobPhase === "provider_limited") {
        const strictProvenance = isRecord(job.progressJson.strictProvenance)
          ? job.progressJson.strictProvenance
          : {};
        const reason = strictScoreBlockedReasonField(strictProvenance.scoreBlockedReason);
        const delivery = await buildForensicJobFailureDelivery(deps, job, reason);
        const completed = await deps.completeForensicCheckJob({
          id: job.id,
          claimStartedAt: job.startedAt,
          status: "failed",
          progressJson: progressWithDelivery(job.progressJson, delivery),
          resultJson: {
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
            subjectAddress: job.subjectAddress,
            ...strictBlockedResultJson(reason)
          },
          rawEvidenceIds: [],
          observationIds: [],
          lastError: reason
        });
        if (!completed) {
          if (!abortController.signal.aborted) abortController.abort();
          throw new Error("lost_forensic_job_claim");
        }
        return true;
      }
      if (job.progressJson.jobPhase === "provider_limited") {
        const targetedIndex = isRecord(job.progressJson.targetedIndex)
          ? job.progressJson.targetedIndex
          : {};
        const statusReason = targetedStatusReasonField(targetedIndex.statusReason);
        if (statusReason === "partial_provider_cap") {
          return await runWhereIsMoneyJob(deps, job, options, abortController);
        }
        const mapped = targetedHistoryTerminalStatus(
          statusReason,
          nullableStringField(targetedIndex.lastError)
        );
        const delivery = await buildForensicJobFailureDelivery(deps, job, mapped.scoreBlockedReason);
        const completed = await deps.completeForensicCheckJob({
          id: job.id,
          claimStartedAt: job.startedAt,
          status: "failed",
          progressJson: progressWithDelivery(job.progressJson, delivery),
          resultJson: {
            scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
            subjectAddress: job.subjectAddress,
            score_valid: false,
            score_blocked_reason: mapped.scoreBlockedReason,
            technical_status: mapped.technicalStatus
          },
          rawEvidenceIds: [],
          observationIds: [],
          lastError: mapped.scoreBlockedReason
        });
        if (!completed) {
          if (!abortController.signal.aborted) abortController.abort();
          throw new Error("lost_forensic_job_claim");
        }
        return true;
      }
      return await runWhereIsMoneyJob(deps, job, options, abortController);
    }

    job.progressJson = mergeForensicJobProgress(job.progressJson, { jobPhase: "address_deep_trace" });
    const claimedProgress = await deps.updateForensicCheckJobProgress?.({
      id: job.id,
      claimStartedAt: job.startedAt,
      progressJson: job.progressJson,
      lastError: null
    });
    if (claimedProgress === false) {
      abortController.abort();
      return true;
    }
    enrichmentHeartbeat = createForensicEnrichmentHeartbeatCoordinator({
      intervalMs: options.transactionEnrichmentHeartbeatIntervalMs,
      isAborted: () => abortController.signal.aborted,
      heartbeat: async () => {
        job.progressJson = mergeForensicJobProgress(job.progressJson, {
          jobHeartbeatAt: new Date().toISOString()
        });
        const updated = await deps.updateForensicCheckJobProgress?.({
          id: job.id,
          claimStartedAt: job.startedAt!,
          progressJson: job.progressJson,
          lastError: null
        });
        if (updated === false) {
          abortController.abort();
          throw new Error("lost_forensic_job_claim");
        }
      }
    });

    const allTimeMode = deepCheckAllTimeModeField(job.progressJson.allTimeDeepCheckMode) ?? options.allTimeDeepCheckMode ?? "partial";
    const allTimeSubjectIndexState = allTimeMode === "strict" && deps.ensureAddressUsdtHistory
      ? await deps.ensureAddressUsdtHistory({
          jobId: job.id,
          claimStartedAt: job.startedAt,
          address: job.subjectAddress,
          coverageMode: "all_time",
          requestedByJobId: job.id,
          queuedReason: "deep_subject"
        })
      : null;
    if (allTimeMode === "partial" && deps.queueAddressUsdtHistory) {
      await deps.queueAddressUsdtHistory({
        claimStartedAt: job.startedAt,
        address: job.subjectAddress,
        coverageMode: "all_time",
        requestedByJobId: job.id,
        queuedReason: "deep_subject"
      });
    }

    const deepSelectiveEvidenceIds = new Set<string>();
    const resolveDeepTransaction = async (txHash: string): Promise<unknown | null> => {
      if (!deps.selectiveTransactionEnricher) {
        return deps.getTransaction?.(txHash).catch(() => null) ?? null;
      }
      const movements = await deps.listIndexedMovementsByHashes?.([txHash]) ?? [];
      const addresses = [...new Set(movements.flatMap((edge) => [edge.fromAddress, edge.toAddress]))];
      const assertions = await deps.listActiveRouteAssertions?.({ addresses, txHashes: [txHash] }) ?? [];
      const enrichment = await enrichmentHeartbeat!.run((onCandidateResolved) =>
        deps.selectiveTransactionEnricher!.enrich({
          mode: "subject",
          routeEdges: movements,
          movements,
          assertions,
          hardTxHashes: [txHash]
        }, {
          signal: abortController.signal,
          onCandidateResolved
        })
      );
      for (const evidenceId of enrichment.evidenceIds) deepSelectiveEvidenceIds.add(evidenceId);
      return deps.selectiveTransactionEnricher.getFullTransactionInfo(txHash);
    };
    const { getAddressUsdtIndexState, ...deepCheckBaseDeps } = deps;
    const deepCheckDeps: DeepAddressForensicDeps = {
      ...deepCheckBaseDeps,
      ...(deps.getTransaction ? { getTransaction: resolveDeepTransaction } : {}),
      ...(getAddressUsdtIndexState
        ? {
            getAddressUsdtIndexState: (address: string) => getAddressUsdtIndexState({
              address,
              coverageMode: "all_time",
              targetTimestamp: null
            })
          }
        : {})
    };

    const report = await runDeepAddressForensicCheck(deepCheckDeps, {
      sourceAddress: job.subjectAddress,
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      maxDepth: 3,
      pageLimit: options.pageLimit ?? 100,
      maxPagesPerAddress: options.maxPagesPerAddress ?? 3,
      maxExpandedIntermediates: options.maxExpandedIntermediates ?? 30,
      metadataFetchLimit: options.metadataFetchLimit ?? 30,
      contractProfileFetchLimit: options.contractProfileFetchLimit ?? 15,
      maxInboundSenders: options.maxInboundSenders ?? 15,
      maxApprovalDrainCandidates: options.maxApprovalDrainCandidates ?? 15,
      approvalChangeLookupLimit: options.approvalChangeLookupLimit ?? 20,
      economicEdgeTransactionInfoFetchLimit: options.economicEdgeTransactionInfoFetchLimit ?? DEFAULT_DEEP_ECONOMIC_EDGE_TRANSACTION_INFO_FETCH_LIMIT,
      extendedSearchMode: options.extendedSearchMode ?? "always",
      extendedSearchMaxDepth: options.extendedSearchMaxDepth ?? 6,
      extendedSearchBeamWidth: options.extendedSearchBeamWidth ?? 12,
      extendedSearchMaxAddressFetches: options.extendedSearchMaxAddressFetches ?? 150,
      recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
      recentFallbackTransferLimit: options.recentFallbackTransferLimit ?? DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT,
      counterpartyFastSnapshotLimit: options.counterpartyFastSnapshotLimit ?? 60,
      counterpartyFastSnapshotActiveLimit: options.counterpartyFastSnapshotActiveLimit ?? 30,
      fastCheckHints: fastCheckHintsFromJob(job),
      allTimeSubjectIndexState,
      allTimeMode,
      secondLayerMaxActiveWalletsPerJob: nonNegativeIntegerField(job.progressJson.secondLayerMaxActiveWalletsPerJob) ?? options.secondLayerMaxActiveWalletsPerJob,
      directHardEvidenceLiveLimit: options.directHardEvidenceLiveLimit,
      directHardEvidenceConcurrency: options.directHardEvidenceConcurrency,
      apiKeyConfigured: options.apiKeyConfigured,
      abortSignal: abortController.signal
    });
    const secondLayerProfile = report.secondLayerRelationshipProfiles;
    if (secondLayerProfile && secondLayerProfile.queueRequests.length > 0 && deps.queueAddressUsdtHistory) {
      const queuedAddresses = new Set<string>();
      for (const request of secondLayerProfile.queueRequests) {
        const targetTimestamp = "targetTimestamp" in request ? request.targetTimestamp : undefined;
        const queuedInput = {
          claimStartedAt: job.startedAt,
          address: request.address,
          coverageMode: request.coverageMode,
          requestedByJobId: job.id,
          queuedReason: request.queuedReason,
          ...(targetTimestamp instanceof Date || targetTimestamp === null ? { targetTimestamp } : {})
        };
        try {
          const queuedState = await deps.queueAddressUsdtHistory(queuedInput);
          if (queuedState.status === "queued" || queuedState.status === "running") {
            queuedAddresses.add(request.address);
          }
        } catch (error) {
          if (errorMessage(error) === "lost_forensic_job_claim") {
            if (!abortController.signal.aborted) abortController.abort();
            throw error;
          }
          deps.logger?.warn("deep_second_layer_queue_failed", {
            jobId: job.id,
            address: request.address,
            queuedReason: request.queuedReason,
            error: errorMessage(error)
          });
        }
      }
      const updatedProfile = markSecondLayerQueued(secondLayerProfile, [...queuedAddresses]);
      report.secondLayerRelationshipProfiles = updatedProfile;
      if (report.coverage.allTime) {
        report.coverage.allTime = {
          ...report.coverage.allTime,
          directWalletsQueuedForIndexing: queuedAddresses.size,
          secondLayerQueued: updatedProfile.counters.queued,
          secondLayerComplete: updatedProfile.counters.complete
        };
      }
    }
    const recordedRisk = await deps.recordRiskEvaluation({
      jobId: job.id,
      claimStartedAt: job.startedAt,
      rawEvidence: report.rawEvidence,
      observations: report.observations
    });
    if (recordedRisk === false) {
      abortController.abort();
      throw new Error("lost_forensic_job_claim");
    }
    const derivedLabels = [
      await persistDerivedDarknetExchangeProximityLabel(deps, job, report),
      await persistDerivedApprovalDrainProximityLabel(deps, job, report)
    ].filter((label): label is Exclude<DerivedLabelResult, null> => label !== null);
    const derivedLabel = derivedLabels[0] ?? null;
    const status = "completed";
    const { allTime: allTimeCoverage, ...progressCoverage } = report.coverage;
    const completion = {
      id: job.id,
      claimStartedAt: job.startedAt,
      status,
      progressJson: progressWithDelivery({
        ...job.progressJson,
        ...progressCoverage,
        ...(allTimeCoverage === undefined ? {} : { allTimeCoverage }),
        firstHopBlacklistFacts: report.firstHopBlacklistFacts ?? [],
        firstHopLabelFacts: report.firstHopLabelFacts ?? [],
        firstHopBlacklistCoverage: report.firstHopBlacklistCoverage ?? null,
        directHardEvidenceSnapshots: report.directHardEvidenceSnapshots ?? [],
        derivedLabel
      }, await buildDeepForensicJobResultDelivery(deps, job, report, status)),
      resultJson: {
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
        subjectAddress: report.subjectAddress,
        windowStart: report.windowStart.toISOString(),
        windowEnd: report.windowEnd.toISOString(),
        runProfile: report.runProfile,
        providerBudget: report.providerBudget,
        serviceExposureProfiles: report.serviceExposureProfiles,
        addressBehaviorProfiles: report.addressBehaviorProfiles,
        inboundProvenanceProfiles: report.inboundProvenanceProfiles,
        counterpartyRiskProfiles: report.counterpartyRiskProfiles,
        directCounterpartyInteractionProfiles: report.directCounterpartyInteractionProfiles ?? [],
        approvalDrainProvenanceProfiles: report.approvalDrainProvenanceProfiles,
        secondLayerRelationshipProfiles: report.secondLayerRelationshipProfiles ?? null,
        contractDrivenReceiverProfile: report.contractDrivenReceiverProfile ?? null,
        contractDrivenCampaignSummary: report.contractDrivenCampaignSummary ?? null,
        contractDrivenTransferProfiles: report.contractDrivenTransferProfiles ?? [],
        assetContinuationProfiles: report.assetContinuationProfiles ?? [],
        boundaryExposureProfiles: report.boundaryExposureProfiles,
        operationalFlowProfiles: report.operationalFlowProfiles ?? [],
        walletRoleProfiles: report.walletRoleProfiles,
        stablecoinRestrictionProfiles: report.stablecoinRestrictionProfiles ?? [],
        firstHopBlacklistFacts: report.firstHopBlacklistFacts ?? [],
        firstHopLabelFacts: report.firstHopLabelFacts ?? [],
        firstHopBlacklistCoverage: report.firstHopBlacklistCoverage ?? null,
        directHardEvidenceSnapshots: report.directHardEvidenceSnapshots ?? [],
        extendedProvenanceProfiles: report.extendedProvenanceProfiles ?? [],
        derivedLabel,
        derivedLabels,
        missingChecks: report.missingChecks,
        coverage: report.coverage,
        coverageDebug: { ...report.coverageDebug, jobId: job.id, status }
      },
      rawEvidenceIds: [...new Set([
        ...job.rawEvidenceIds,
        ...report.rawEvidence.map((evidence) => evidence.id),
        ...deepSelectiveEvidenceIds
      ])],
      observationIds: report.observations.map((observation) => observation.id),
      lastError: null
    } satisfies Parameters<DeepForensicJobRunnerDeps["completeForensicCheckJob"]>[0];
    const completed = await deps.completeForensicCheckJob(completion);
    if (!completed) {
      if (!abortController.signal.aborted) abortController.abort();
      throw new Error("lost_forensic_job_claim");
    }
    await indexWalletIntelligenceBestEffort(deps, job, {
      progressJson: completion.progressJson,
      resultJson: completion.resultJson,
      status
    });
    return true;
  } catch (error) {
    const message = errorMessage(error);
    if (message === "lost_forensic_job_claim") {
      if (!abortController.signal.aborted) abortController.abort();
      return true;
    }
    if (message === "selective_transaction_enrichment_aborted") {
      return true;
    }
    if (job.kind === "where_is_money_check" && isStrictProvenanceBenchmarkJob(job)) {
      const reason = strictScoreBlockedReasonFromError(error);
      const strictMessage = strictErrorMessageFromTargetedHistoryError(error);
      const delivery = await buildForensicJobFailureDelivery(deps, job, strictMessage);
      const completed = await deps.completeForensicCheckJob({
        id: job.id,
        claimStartedAt: job.startedAt,
        status: "failed",
        progressJson: progressWithDelivery(
          strictProviderLimitedProgressJson(job.progressJson, reason),
          delivery
        ),
        resultJson: {
          scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
          subjectAddress: job.subjectAddress,
          ...strictBlockedResultJson(reason)
        },
        rawEvidenceIds: [],
        observationIds: [],
        lastError: strictMessage
      });
      if (!completed) {
        if (!abortController.signal.aborted) abortController.abort();
        (deps.logger ?? defaultLogger).warn("forensic_job_claim_lost", {
          jobId: job.id,
          stage: "strict_failure_completion",
          error: "lost_forensic_job_claim"
        });
        return true;
      }
      return true;
    }
    if (job.kind === "where_is_money_check" && error instanceof TargetedHistoryTerminalError) {
      const progressJson = mergeForensicJobProgress(job.progressJson, targetedHistoryReadyProgressPatch({
        address: job.subjectAddress,
        targetTimestamp: null,
        indexStatus: "failed_terminal",
        statusReason: null,
        lastError: message
      }));
      const delivery = await buildForensicJobFailureDelivery(deps, job, message);
      const completed = await deps.completeForensicCheckJob({
        id: job.id,
        claimStartedAt: job.startedAt,
        status: "failed",
        progressJson: progressWithDelivery(progressJson, delivery),
        resultJson: {
          scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION,
          subjectAddress: job.subjectAddress,
          score_valid: false,
          score_blocked_reason: error.scoreBlockedReason,
          technical_status: error.technicalStatus
        },
        rawEvidenceIds: [],
        observationIds: [],
        lastError: message
      });
      if (!completed) {
        if (!abortController.signal.aborted) abortController.abort();
        (deps.logger ?? defaultLogger).warn("forensic_job_claim_lost", {
          jobId: job.id,
          stage: "targeted_terminal_completion",
          error: "lost_forensic_job_claim"
        });
        return true;
      }
      return true;
    }
    const delivery = await buildForensicJobFailureDelivery(deps, job, message);
    const completed = await deps.completeForensicCheckJob({
      id: job.id,
      claimStartedAt: job.startedAt,
      status: "failed",
      progressJson: progressWithDelivery(job.progressJson, delivery),
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    if (!completed) {
      if (!abortController.signal.aborted) abortController.abort();
      (deps.logger ?? defaultLogger).warn("forensic_job_claim_lost", {
        jobId: job.id,
        stage: "failure_completion",
        error: "lost_forensic_job_claim"
      });
      return true;
    }
    return true;
  } finally {
    await enrichmentHeartbeat?.dispose();
  }
}
