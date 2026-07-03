import { runDeepAddressForensicCheck, type DeepAddressForensicDeps, type DeepAddressForensicReport } from "../check/deepForensicCheck";
import { runWhereIsMoneyCheck } from "../check/whereIsMoneyCheck";
import { FORENSIC_ROUTE_POLICY_VERSION } from "./routeScorer";
import { indexedTransferToRouteEdge } from "./localTronUsdtIndex";
import { normalizeTransfer } from "./routeSearch";
import { classifyServiceAddress } from "./serviceClassifier";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { ChainContinuationProvider } from "./crossChainContinuationTypes";
import type { EvmEvidenceProvider } from "./evmExplorerClient";
import { mergeForensicJobProgress, type ForensicJobProgressPatch } from "./forensicJobProgress";
import {
  addStrictBenchmarkStageTiming,
  isStrictProvenanceBenchmarkJob,
  strictBlockedResultJson,
  strictCompletedResultJson,
  strictWaitingProgressPatch,
  type StageKey,
  type StrictScoreBlockedReason
} from "./strictProvenanceBenchmark";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import type { AddressLabelAssertionInput, ForensicCheckJob } from "../storage/repositories";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ApprovalDrainProvenanceProfile, BalanceFormingTransfer, ContractAnalysisCaseFile, ContractLlmVerdictSummary, CounterpartyRiskProfile, DeepCheckAllTimeMode, FastCheckHintAddress, FastCounterpartyTopDirection, ForensicRouteEdge, InboundProvenancePath, MoneyOriginTraceHistoryCoverage, RawEvidenceInput, RiskLevel, RiskReport, RiskSignalObservationInput, ServiceClassification, StablecoinRestrictionProfile, TronAddressUsdtCoverageMode, TronAddressUsdtCoverageStatusReason, TronAddressUsdtIndexState, TronAddressUsdtIndexStatus, WhereIsMoneyReport } from "../types";

export const DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 150;
export const DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT = 150;

export type DeepForensicJobRunnerDeps = DeepAddressForensicDeps & {
  getUsdtRestrictionStatus(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: {
    id: string;
    status: "completed" | "partial" | "failed";
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: string | null;
  }): Promise<boolean>;
  updateForensicCheckJobProgress?(input: {
    id: string;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
  releaseForensicCheckJobToWaiting?(input: {
    id: string;
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
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }): Promise<void>;
  upsertAddressLabelAssertion?(input: AddressLabelAssertionInput): Promise<unknown>;
  analyzeContractLlmCaseFiles?(caseFiles: ContractAnalysisCaseFile[]): Promise<ContractLlmVerdictSummary[]>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
  sendJobResult?(job: ForensicCheckJob, report: DeepAddressForensicReport, status: "completed" | "partial"): Promise<void>;
  sendWhereIsMoneyJobResult?(job: ForensicCheckJob, report: WhereIsMoneyReport, status: "completed" | "partial"): Promise<void>;
  sendJobFailure?(job: ForensicCheckJob, error: string): Promise<void>;
  getAddressUsdtIndexState?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
  }): Promise<TronAddressUsdtIndexState | null>;
  ensureAddressUsdtHistory?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    stopAtTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
  queueAddressUsdtHistory?(input: {
    address: string;
    coverageMode: TronAddressUsdtCoverageMode;
    targetTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
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
  crossChainManualDeepMode?: boolean;
  crossChainMaxProviderCalls?: number;
  apiKeyConfigured?: boolean;
  allTimeDeepCheckMode?: DeepCheckAllTimeMode;
  secondLayerMaxActiveWalletsPerJob?: number;
  directHardEvidenceLiveLimit?: number;
  directHardEvidenceConcurrency?: number;
  contractTransactionInfoMinIntervalMs?: number;
};

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

async function sendDeepForensicJobResultBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: DeepAddressForensicReport,
  status: "completed" | "partial"
): Promise<void> {
  if (!deps.sendJobResult) return;
  try {
    await deps.sendJobResult(job, report, status);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("deep_forensic_job_result_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      status,
      error: errorMessage(error)
    });
  }
}

async function sendWhereIsMoneyJobResultBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  report: WhereIsMoneyReport,
  status: "completed" | "partial"
): Promise<void> {
  if (!deps.sendWhereIsMoneyJobResult) return;
  try {
    await deps.sendWhereIsMoneyJobResult(job, report, status);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("where_is_money_job_result_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      status,
      error: errorMessage(error)
    });
  }
}

async function sendDeepForensicJobFailureBestEffort(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  message: string
): Promise<void> {
  if (!deps.sendJobFailure) return;
  try {
    await deps.sendJobFailure(job, message);
  } catch (error) {
    (deps.logger ?? defaultLogger).error("deep_forensic_job_failure_delivery_failed", {
      job_id: job.id,
      subject_address: job.subjectAddress,
      chat_id: job.chatId,
      original_error: message,
      error: errorMessage(error)
    });
  }
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

  await deps.upsertAddressLabelAssertion({
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

  await deps.upsertAddressLabelAssertion({
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

function strictScoreBlockedReasonFromError(error: unknown): StrictScoreBlockedReason {
  const message = errorMessage(error);
  if (/429|rate.?limit/i.test(message)) return "rate_limited_after_retries";
  if (message.includes("provider_inconsistent")) return "provider_inconsistent";
  if (message.includes("hard_safety_limit")) return "hard_safety_limit_exceeded";
  if (message.includes("provider_cap") || message.includes(":partial")) return "provider_cap_unresolved";
  return "provider_error";
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
      technicalStatus: "provider_limited",
      waitingFor: null
    }
  });
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
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
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

async function runWhereIsMoneyJob(
  deps: DeepForensicJobRunnerDeps,
  job: ForensicCheckJob,
  options: DeepForensicJobRunnerOptions
): Promise<boolean> {
  let currentProgress = job.progressJson;
  const persistProgress = async (patch: ForensicJobProgressPatch): Promise<void> => {
    currentProgress = mergeForensicJobProgress(currentProgress, patch);
    job.progressJson = currentProgress;
    await deps.updateForensicCheckJobProgress?.({
      id: job.id,
      progressJson: currentProgress,
      lastError: null
    });
  };
  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const targetedEdgeCacheKeys = new Set<string>();
  const historyCoverageCache = new Map<string, MoneyOriginTraceHistoryCoverage>();
  const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
  const classificationCache = new Map<string, ServiceClassification | null>();
  const targetedEnsureCache = new Map<string, Promise<boolean>>();
  const maxEdgesPerAddress = options.maxEdgesPerAddress ?? 100;
  const recentFallbackTransferLimit = options.recentFallbackTransferLimit ?? 150;
  const edgeFetchLimit = Math.max(recentFallbackTransferLimit, maxEdgesPerAddress);
  const strictBenchmark = isStrictProvenanceBenchmarkJob(job);
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

  const maxTimestampForFetch = (fetchOptions: { latestTimestamp?: Date } = {}): Date =>
    fetchOptions.latestTimestamp && fetchOptions.latestTimestamp < job.windowEnd
      ? fetchOptions.latestTimestamp
      : job.windowEnd;

  const ensureTargetedHistory = async (
    address: string,
    maxTimestamp: Date,
    fetchOptions: { latestTimestamp?: Date }
  ): Promise<boolean> => {
    if (!fetchOptions.latestTimestamp) return true;
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const cached = targetedEnsureCache.get(cacheKey);
    if (cached) return cached;
    if (strictBenchmark) {
      const getAddressUsdtIndexState = deps.getAddressUsdtIndexState;
      if (!getAddressUsdtIndexState) throw new Error("strict_provenance_wait_missing_dependencies");
      const ensured = Promise.resolve()
        .then(async () => {
          const existing = await getAddressUsdtIndexState({
            address,
            coverageMode: "targeted",
            targetTimestamp: maxTimestamp
          });
          if (existing?.status === "complete") return true;
          if (existing?.status === "partial" || existing?.status === "failed_terminal") {
            throw new Error(`strict_provenance_targeted_index_terminal:${existing.status}`);
          }
          const queueAddressUsdtHistory = deps.queueAddressUsdtHistory;
          const releaseForensicCheckJobToWaiting = deps.releaseForensicCheckJobToWaiting;
          if (!queueAddressUsdtHistory || !releaseForensicCheckJobToWaiting) {
            throw new Error("strict_provenance_wait_missing_dependencies");
          }
          const queued = await queueAddressUsdtHistory({
            address,
            coverageMode: "targeted",
            targetTimestamp: maxTimestamp,
            requestedByJobId: job.id,
            queuedReason: "where_is_money_hop"
          });
          if (queued.status === "complete") return true;
          if (queued.status !== "queued" && queued.status !== "running" && queued.status !== "failed_retryable") {
            throw new Error(`strict_provenance_targeted_index_terminal:${queued.status}`);
          }
          if (queued.requestedByJobId !== job.id) {
            throw new Error("strict_provenance_targeted_index_not_owned");
          }
          await persistProgress(strictWaitingProgressPatch({
            address,
            targetTimestamp: maxTimestamp,
            queuedReason: "where_is_money_hop"
          }));
          const released = await releaseForensicCheckJobToWaiting({
            id: job.id,
            progressJson: currentProgress,
            lastError: null
          });
          if (!released) throw new Error("strict_provenance_wait_release_failed");
          const afterRelease = await getAddressUsdtIndexState({
            address,
            coverageMode: "targeted",
            targetTimestamp: maxTimestamp
          });
          if (
            afterRelease?.requestedByJobId === job.id &&
            (afterRelease.status === "complete" || afterRelease.status === "partial" || afterRelease.status === "failed_terminal")
          ) {
            const markStrictProvenanceJobReadyAfterIndex = deps.markStrictProvenanceJobReadyAfterIndex;
            if (!markStrictProvenanceJobReadyAfterIndex) throw new Error("strict_provenance_wait_missing_dependencies");
            await markStrictProvenanceJobReadyAfterIndex({
              id: job.id,
              address: afterRelease.address,
              targetTimestamp: afterRelease.targetTimestamp,
              indexStatus: afterRelease.status,
              statusReason: afterRelease.statusReason,
              lastError: afterRelease.lastError
            });
          }
          throw new StrictProvenanceWaitingForIndex();
        });
      targetedEnsureCache.set(cacheKey, ensured);
      return ensured;
    }
    if (!deps.ensureAddressUsdtHistory) return true;
    const ensureAddressUsdtHistory = deps.ensureAddressUsdtHistory;
    const ensured = Promise.resolve()
      .then(() => ensureAddressUsdtHistory({
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

  const fetchEdgesForAddress = async (address: string, fetchOptions: { latestTimestamp?: Date } = {}): Promise<ForensicRouteEdge[]> => {
    const maxTimestamp = maxTimestampForFetch(fetchOptions);
    const minTimestamp = historicalFetchMinTimestamp(job, maxTimestamp);
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const isTargetedHopFetch = Boolean(fetchOptions.latestTimestamp);
    const targetedEnsureSucceeded = await ensureTargetedHistory(address, maxTimestamp, fetchOptions);
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
    const liveWasQueried = indexedEdges.length < maxEdgesPerAddress;
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
    const noTruncationSignal = !indexedMayBeTruncated && !liveMayBeTruncated;
    const fetchFailed = indexedFetchFailed || liveFetchFailed || !targetedEnsureSucceeded;
    const oldestCombinedReachesFetchMin = oldestFetchedAt !== null && oldestFetchedAt <= minTimestamp;
    const fetchedPageCount = (deps.listIndexedUsdtTransfersForAddress ? 1 : 0) + (liveWasQueried ? 1 : 0);
    historyCoverageCache.set(cacheKey, {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: edges.length,
      fetchedPageCount,
      oldestFetchedTransferAt,
      reachedTargetHop: !fetchFailed && noTruncationSignal && (
        edges.length === 0 ||
        oldestCombinedReachesFetchMin ||
        (indexedEdges.length < edgeFetchLimit && (!liveWasQueried || liveEdges.length < maxEdgesPerAddress))
      ),
      source: historyCoverageSource({
        indexedEdgeCount: indexedEdges.length,
        liveEdgeCount: liveEdges.length
      })
    });
    edgeCache.set(cacheKey, edges);
    if (isTargetedHopFetch) targetedEdgeCacheKeys.add(cacheKey);
    return edges;
  };

  const getHistoryCoverageForAddress = async (
    address: string,
    fetchOptions: { latestTimestamp?: Date } = {}
  ): Promise<MoneyOriginTraceHistoryCoverage> => {
    const maxTimestamp = maxTimestampForFetch(fetchOptions);
    const cacheKey = edgeCacheKey(address, maxTimestamp);
    const cached = historyCoverageCache.get(cacheKey);
    if (cached) return cached;
    await fetchEdgesForAddress(address, fetchOptions);
    return historyCoverageCache.get(cacheKey) ?? {
      address,
      targetTimestamp: maxTimestamp.toISOString(),
      fetchedTransferCount: 0,
      fetchedPageCount: 0,
      oldestFetchedTransferAt: null,
      reachedTargetHop: false,
      source: "unknown"
    };
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

  const crossChainStage2Enabled = shouldRunCrossChainStage2ForJob(job, options);
  let report: WhereIsMoneyReport;
  try {
    report = await measureJobStage("traceMs", () => runWhereIsMoneyCheck({
      getTrc20Balance: async (address, tokenContractAddress) => {
        if (tokenContractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
        const state = await deps.getUsdtRestrictionStatus(address).catch(() => null);
        return state?.balanceRaw ?? null;
      },
      fetchEdgesForAddress,
      getHistoryCoverageForAddress,
      fetchLatestEdgesForAddress,
      getLabelsForAddress: deps.getLabelsForAddress,
      getClassificationForAddress,
      getFastWalletRisk: async () => fastRiskReportFromJob(job),
      getTransaction: deps.getTransaction,
      listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
      getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile,
      analyzeContractLlmCaseFiles: deps.analyzeContractLlmCaseFiles,
      crossChainDiscoveryProvider: deps.crossChainDiscoveryProvider,
      crossChainContinuationProviders: deps.crossChainContinuationProviders,
      evmEvidenceProvider: deps.evmEvidenceProvider
    }, {
      mode: whereIsMoneyJobModeField(job.progressJson.mode),
      sourceAddress: job.subjectAddress,
      requestedAmountRaw: rawAmountField(job.progressJson.requestedAmountRaw),
      seedTransfers: seedTransfersField(job.progressJson.seedTransfers),
      windowStart: job.windowStart,
      windowEnd: job.windowEnd,
      maxDepth: Math.max(options.extendedSearchMaxDepth ?? 20, 20),
      beamWidth: Math.max(options.extendedSearchBeamWidth ?? 12, 12),
      maxAddressFetches: Math.max(options.extendedSearchMaxAddressFetches ?? 150, 150),
      maxEdgesPerAddress,
      recentFallbackMinTransferCount: options.recentFallbackMinTransferCount ?? DEEP_FORENSIC_RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
      recentFallbackTransferLimit,
      contractTransactionInfoMinIntervalMs: options.contractTransactionInfoMinIntervalMs ?? 1000,
      crossChainStage2Enabled,
      crossChainManualDeepMode: options.crossChainManualDeepMode || booleanField(job.progressJson.crossChainManualDeepMode),
      crossChainMaxProviderCalls: options.crossChainMaxProviderCalls,
      onProgress: persistProgress
    }));
  } catch (error) {
    if (error instanceof StrictProvenanceWaitingForIndex) return true;
    throw error;
  }

  const status = report.crossChainCorridor?.partial === true ? "partial" : "completed";
  const strictPartial = report.coverage?.partial === true || report.crossChainCorridor?.partial === true;
  if (strictBenchmark) {
    await measureJobStage("scoringMs", async () => null);
  }
  if (strictBenchmark && strictPartial) {
    // ponytail: no local partial-reason taxonomy yet; map provider partial details here if one appears.
    const reason: StrictScoreBlockedReason = "provider_error";
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: {
        ...strictProviderLimitedProgressJson(currentProgress, reason),
        whereIsMoneyCoverage: report.coverage,
        decision: report.decision,
        riskScore: report.riskScore
      },
      resultJson: {
        subjectAddress: report.subjectAddress,
        whereIsMoneyReport: report,
        contractDrivenReceiverProfile: report.contractDrivenReceiverProfile ?? null,
        contractDrivenTransferProfiles: report.contractDrivenTransferProfiles ?? [],
        ...strictBlockedResultJson(reason)
      },
      rawEvidenceIds: [],
      observationIds: [],
      lastError: reason
    });
    return true;
  }
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
  await deps.completeForensicCheckJob({
    id: job.id,
    status,
    progressJson: {
      ...currentProgress,
      ...strictProgressPatch,
      whereIsMoneyCoverage: report.coverage,
      decision: report.decision,
      riskScore: report.riskScore
    },
    resultJson: {
      subjectAddress: report.subjectAddress,
      ...(strictBenchmark ? strictCompletedResultJson() : {}),
      whereIsMoneyReport: report,
      contractDrivenReceiverProfile: report.contractDrivenReceiverProfile ?? null,
      contractDrivenTransferProfiles: report.contractDrivenTransferProfiles ?? []
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null
  });
  await sendWhereIsMoneyJobResultBestEffort(deps, job, report, status);
  return true;
}

export async function runSingleDeepForensicJobCycle(
  deps: DeepForensicJobRunnerDeps,
  options: DeepForensicJobRunnerOptions = {}
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;

  try {
    if (job.kind === "where_is_money_check") {
      if (isStrictProvenanceBenchmarkJob(job) && job.progressJson.jobPhase === "provider_limited") {
        const strictProvenance = isRecord(job.progressJson.strictProvenance)
          ? job.progressJson.strictProvenance
          : {};
        const reason = strictScoreBlockedReasonField(strictProvenance.scoreBlockedReason);
        await deps.completeForensicCheckJob({
          id: job.id,
          status: "failed",
          progressJson: job.progressJson,
          resultJson: {
            subjectAddress: job.subjectAddress,
            ...strictBlockedResultJson(reason)
          },
          rawEvidenceIds: [],
          observationIds: [],
          lastError: reason
        });
        return true;
      }
      return await runWhereIsMoneyJob(deps, job, options);
    }

    job.progressJson = mergeForensicJobProgress(job.progressJson, { jobPhase: "address_deep_trace" });
    await deps.updateForensicCheckJobProgress?.({
      id: job.id,
      progressJson: job.progressJson,
      lastError: null
    });

    const allTimeMode = deepCheckAllTimeModeField(job.progressJson.allTimeDeepCheckMode) ?? options.allTimeDeepCheckMode ?? "partial";
    const allTimeSubjectIndexState = allTimeMode === "strict" && deps.ensureAddressUsdtHistory
      ? await deps.ensureAddressUsdtHistory({
          address: job.subjectAddress,
          coverageMode: "all_time",
          requestedByJobId: job.id,
          queuedReason: "deep_subject"
        })
      : null;
    if (allTimeMode === "partial" && deps.queueAddressUsdtHistory) {
      await deps.queueAddressUsdtHistory({
        address: job.subjectAddress,
        coverageMode: "all_time",
        requestedByJobId: job.id,
        queuedReason: "deep_subject"
      });
    }

    const report = await runDeepAddressForensicCheck(deps, {
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
      apiKeyConfigured: options.apiKeyConfigured
    });
    await deps.recordRiskEvaluation({
      rawEvidence: report.rawEvidence,
      observations: report.observations
    });
    const derivedLabels = [
      await persistDerivedDarknetExchangeProximityLabel(deps, job, report),
      await persistDerivedApprovalDrainProximityLabel(deps, job, report)
    ].filter((label): label is Exclude<DerivedLabelResult, null> => label !== null);
    const derivedLabel = derivedLabels[0] ?? null;
    const status = "completed";
    const { allTime: allTimeCoverage, ...progressCoverage } = report.coverage;
    await deps.completeForensicCheckJob({
      id: job.id,
      status,
      progressJson: {
        ...job.progressJson,
        ...progressCoverage,
        ...(allTimeCoverage === undefined ? {} : { allTimeCoverage }),
        derivedLabel
      },
      resultJson: {
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
        contractDrivenReceiverProfile: report.contractDrivenReceiverProfile ?? null,
        contractDrivenTransferProfiles: report.contractDrivenTransferProfiles ?? [],
        assetContinuationProfiles: report.assetContinuationProfiles ?? [],
        boundaryExposureProfiles: report.boundaryExposureProfiles,
        operationalFlowProfiles: report.operationalFlowProfiles ?? [],
        walletRoleProfiles: report.walletRoleProfiles,
        stablecoinRestrictionProfiles: report.stablecoinRestrictionProfiles ?? [],
        extendedProvenanceProfiles: report.extendedProvenanceProfiles ?? [],
        derivedLabel,
        derivedLabels,
        missingChecks: report.missingChecks,
        coverage: report.coverage,
        coverageDebug: { ...report.coverageDebug, jobId: job.id, status }
      },
      rawEvidenceIds: report.rawEvidence.map((evidence) => evidence.id),
      observationIds: report.observations.map((observation) => observation.id),
      lastError: null
    });
    await sendDeepForensicJobResultBestEffort(deps, job, report, status);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    if (job.kind === "where_is_money_check" && isStrictProvenanceBenchmarkJob(job)) {
      const reason = strictScoreBlockedReasonFromError(error);
      await deps.completeForensicCheckJob({
        id: job.id,
        status: "failed",
        progressJson: strictProviderLimitedProgressJson(job.progressJson, reason),
        resultJson: {
          subjectAddress: job.subjectAddress,
          ...strictBlockedResultJson(reason)
        },
        rawEvidenceIds: [],
        observationIds: [],
        lastError: message
      });
      await sendDeepForensicJobFailureBestEffort(deps, job, message);
      return true;
    }
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: job.progressJson,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    await sendDeepForensicJobFailureBestEffort(deps, job, message);
    return true;
  }
}
