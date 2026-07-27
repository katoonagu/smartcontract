import type { ForensicCheckJob, ForensicCheckJobKind } from "../storage/repositories";
import type { DeepAddressForensicReport } from "../check/deepForensicCheck";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { evaluateAddressRisk } from "../risk/evaluation";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "../risk/scoringSignalMatrix";
import {
  calculateUnifiedIncomingDepositRisk,
  incomingRiskBandFromUnifiedScore,
  incomingUnifiedRiskSummary
} from "../risk/unifiedIncomingDepositRisk";
import { mergeTransactionInfoEnrichment, runWhereIsMoneyCheck } from "../check/whereIsMoneyCheck";
import { normalizeBotLocale } from "../bot/i18n";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type { ContractEnrichmentResult } from "./contractEnrichment";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { ChainContinuationProvider } from "./crossChainContinuationTypes";
import type { EvmEvidenceProvider } from "./evmExplorerClient";
import type { RouteLinkedAssertionInput, SelectiveTransactionEnricher } from "./selectiveTransactionEnrichment";
import {
  mergeForensicJobProgress,
  createForensicEnrichmentHeartbeatCoordinator,
  type ForensicEnrichmentHeartbeatRunner,
  type ForensicJobProgressPatch
} from "./forensicJobProgress";
import { createPendingForensicTelegramDelivery } from "./telegramDelivery";
import {
  createIncomingDepositTiming,
  type IncomingDepositTimingClock,
  type IncomingDepositTimingRecorder,
  type IncomingDepositTimingSummary
} from "./incomingDepositTiming";
import type {
  AddressLabel,
  BalanceFormingTransfer,
  BotLocale,
  DecisionCoverage,
  ForensicTelegramDeliveryV1,
  ForensicScoreBlockedReason,
  ForensicTechnicalStatus,
  ForensicRouteEdge,
  IncomingDepositCorridorSummary,
  IncomingDepositDecision,
  IncomingDepositFundingBundle,
  IncomingDepositOriginPath,
  IncomingDepositRiskReport,
  IncomingDepositTargetedCoverageSummary,
  IncomingWalletExposureProfile,
  IndexedTronUsdtTransfer,
  MoneyOriginTraceHistoryCoverage,
  MoneyOriginPath,
  RiskLevel,
  RiskReport,
  ServiceClassification,
  SourceBundleExposureFinding,
  SourceBundleExposureSourceKind,
  SourcePolicyEvidence,
  StablecoinRestrictionProfile,
  SubjectExposureProfile,
  TelegramMessagePayloadV1,
  TronAddressUsdtCoverageStatusReason,
  TronAddressUsdtIndexState,
  WalletAlertMode,
  WalletRole,
  WhereCandidateWindowRequest,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyReport,
  WhereTransactionInfoEnrichmentSummary
} from "../types";
import { buildAddressBehaviorProfile } from "./addressBehavior";
import { buildBoundaryExposureProfile } from "./boundaryExposure";
import {
  buildFundingBundleForOutbound,
  selectFundingBundleFundersForExpansion,
  selectIncomingDepositFundingCandidates
} from "./incomingDepositCashflow";
import {
  buildIncomingFreshBundleExposure,
  buildIncomingWalletExposureProfile
} from "./incomingDepositExposureProfile";
import { buildBalanceFormingSlice } from "./balanceFormingSlice";
import {
  DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS,
  indexedTransferToRouteEdge,
  mergeForensicRouteEdges,
  materializeIndexedTransferWindow
} from "./localTronUsdtIndex";
import { selectedMoneyOriginPathShare } from "./moneyOriginAttribution";
import { isExactGasFreeServiceFeePath, traceMoneyOriginPath } from "./moneyOriginTrace";
import {
  DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
  DEFAULT_MAX_BUNDLE_FUNDERS
} from "./provenanceTracingConfig";
import { normalizeTransfer } from "./routeSearch";
import { buildServiceExposureProfile } from "./serviceExposure";
import { buildSourceBundleExposure, unresolvedBoundaryFromFindings } from "./sourceBundleExposure";
import {
  ensureCandidateWindowsOrWait,
  ensureTargetedHistoryOrWait,
  TargetedHistoryTerminalError,
  TargetedHistoryWaitingForIndex,
  type TargetedHistoryWaiterDeps
} from "./targetedHistoryCoordinator";
import { buildWalletRoleProfile } from "./walletRoleClassifier";
import { extractGasFreeEdgeContext } from "./gasFreeSettlement";
import { buildIncomingCoverageV2 } from "./forensicCoverageV2";

type CompleteJobInput = {
  id: string;
  claimStartedAt: Date;
  status: "completed" | "partial" | "failed";
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

type IncomingDepositRiskReportBase = Omit<IncomingDepositRiskReport, "fundingCoverage" | "corridorSummary">;

type IncomingTraceFetchOptions = {
  latestTimestamp?: Date;
  deferBroadTargetedHistory?: boolean;
  targetEdge?: ForensicRouteEdge | null;
  expectedAmountRaw?: string | null;
};

export type IncomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress(
    address: string,
    options: {
      minTimestamp?: Date;
      maxTimestamp?: Date;
      limit: number;
      offset?: number;
      orderBy: "newest";
      direction: "both";
    }
  ): Promise<unknown[]>;
  listRelatedTrc20Transfers(
    address: string,
    options: { start: number; limit: number; minTimestamp?: number; endTimestamp?: number }
  ): Promise<unknown[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getContractIntelligenceProfile(address: string): Promise<ContractRiskContext | null>;
  enrichContractClassification?(address: string): Promise<ContractEnrichmentResult>;
  getTransaction(txHash: string): Promise<unknown>;
  selectiveTransactionEnricher?: SelectiveTransactionEnricher;
  listActiveRouteAssertions?(input: { addresses: string[]; txHashes: string[] }): Promise<RouteLinkedAssertionInput[]>;
  listIndexedMovementsByHashes?(txHashes: string[]): Promise<ForensicRouteEdge[]>;
  getUsdtRestrictionStatus(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile | null>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
  crossChainStage2Enabled?: boolean;
  crossChainMaxProviderCalls?: number;
  ensureAddressUsdtHistory?(input: {
    jobId: string;
    claimStartedAt: Date;
    address: string;
    coverageMode: "all_time" | "targeted";
    targetTimestamp?: Date | null;
    stopAtTimestamp?: Date | null;
    requestedByJobId?: string | null;
    queuedReason: string;
  }): Promise<TronAddressUsdtIndexState>;
  getAddressUsdtIndexState?: TargetedHistoryWaiterDeps["getAddressUsdtIndexState"];
  getCoveringAddressUsdtIndexState?: TargetedHistoryWaiterDeps["getCoveringAddressUsdtIndexState"];
  queueAddressUsdtHistory?: TargetedHistoryWaiterDeps["queueAddressUsdtHistory"];
  releaseForensicCheckJobToWaiting?: TargetedHistoryWaiterDeps["releaseForensicCheckJobToWaiting"];
  upsertForensicJobWait?: TargetedHistoryWaiterDeps["upsertForensicJobWait"];
  markWaitingForensicJobsReadyAfterTargetedIndex?: TargetedHistoryWaiterDeps["markWaitingForensicJobsReadyAfterTargetedIndex"];
};

export type BuildIncomingDepositReportInput = {
  deps: IncomingDepositRuntimeDeps;
  job: ForensicCheckJob;
  depositTxHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  timestamp: Date;
  receiverDeepReport?: DeepAddressForensicReport | null;
  localIndexMaterializationMaxRows?: number;
  timing?: IncomingDepositTimingRecorder;
  persistProgress?(patch: ForensicJobProgressPatch): Promise<Record<string, unknown> | void>;
  runWithTransactionEnrichmentHeartbeat?: TransactionEnrichmentHeartbeatRunner;
  abortSignal?: AbortSignal;
};

export type TransactionEnrichmentHeartbeatRunner = ForensicEnrichmentHeartbeatRunner;

export type RunSingleIncomingDepositJobCycleDeps = {
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: CompleteJobInput): Promise<boolean>;
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
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  recordObservedTransactionRisk(input: {
    jobId: string;
    claimStartedAt: Date;
    txHash: string;
    watchedWalletId: string;
    report: RiskReport;
  }): Promise<boolean>;
  hasUndismissedAddressPoisoningCandidateForIncoming(input: {
    watchedWalletId: string;
    incomingTxHash: string;
  }): Promise<boolean>;
  buildJobFailurePayload?(
    job: ForensicCheckJob,
    error: string
  ): TelegramMessagePayloadV1 | null | Promise<TelegramMessagePayloadV1 | null>;
  /** @deprecated Task 6 compatibility input; job runners never send Telegram directly. */
  sendUserAlert?(
    telegramUserId: string,
    message: string,
    options?: { parse_mode?: "HTML"; reply_markup?: unknown }
  ): Promise<void>;
  logger?: Logger;
  now?: () => Date;
  timingClock?: IncomingDepositTimingClock;
  /** Test seam; production uses the 30-second default. */
  transactionEnrichmentHeartbeatIntervalMs?: number;
  formatIncomingDepositRiskAlert(input: {
    jobId: string;
    amount: string;
    watchedWallet: string;
    sender: string;
    txHash: string;
    timestamp?: Date | null;
    locale?: BotLocale;
    addressPoisoningWarningActive?: boolean;
    report: IncomingDepositRiskReport;
  }): { text: string; parseMode: "HTML"; replyMarkup?: unknown };
  buildReport(input: {
    job: ForensicCheckJob;
    depositTxHash: string;
    watchedWallet: string;
    sender: string;
    amountRaw: string;
    timestamp: Date;
    timing?: IncomingDepositTimingRecorder;
    persistProgress?(patch: ForensicJobProgressPatch): Promise<Record<string, unknown> | void>;
    runWithTransactionEnrichmentHeartbeat: TransactionEnrichmentHeartbeatRunner;
    abortSignal?: AbortSignal;
  }): Promise<IncomingDepositRiskReport>;
};

const RUNTIME_TRANSFER_LIMIT = 200;
const RUNTIME_PROVENANCE_LARGE_DEPOSIT_DEPTH = 20;
const RUNTIME_PROVENANCE_STANDARD_DEPTH = 20;
const LARGE_DEPOSIT_RAW = 100_000n * 1_000_000n;
const LARGE_INTERMEDIATE_TRANSFER_RAW = 500_000n * 1_000_000n;
const LARGE_INTERMEDIATE_TRANSFER_BUNDLE_LOOKBACK_MS = 6 * 60 * 60 * 1_000;
const LARGE_INTERMEDIATE_TRANSFER_BUNDLE_MIN_COVERAGE = 0.95;
const ADAPTIVE_CORRIDOR_EXPANSION_MAX_FUNDERS = 3;
const ADAPTIVE_CORRIDOR_EXPANSION_MAX_DEPTH = 20;
const ADAPTIVE_CORRIDOR_EXPANSION_BEAM_WIDTH = 8;
const ADAPTIVE_CORRIDOR_EXPANSION_MAX_ADDRESS_FETCHES = 80;
const ADAPTIVE_CORRIDOR_EXPANSION_MAX_EDGES_PER_ADDRESS = 60;
const ADAPTIVE_CORRIDOR_EXPANSION_MIN_AMOUNT_PRESERVATION_RATIO = 0.05;
const RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 60;
const RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT = 60;
const INCOMING_DEPOSIT_SLOW_STAGE_THRESHOLD_MS = 30_000;

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function depositEdge(input: Pick<BuildIncomingDepositReportInput, "depositTxHash" | "sender" | "watchedWallet" | "amountRaw" | "timestamp">): ForensicRouteEdge {
  return {
    id: `incoming_deposit:${input.depositTxHash}`,
    fromAddress: input.sender,
    toAddress: input.watchedWallet,
    txHash: input.depositTxHash,
    amountRaw: input.amountRaw,
    timestamp: input.timestamp,
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function mergeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  return mergeForensicRouteEdges(edges);
}

function oldestRouteEdgeTimestamp(edges: ForensicRouteEdge[]): Date | null {
  const timestamps = edges
    .map((edge) => edge.timestamp.getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps));
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

function asIndexedTransfers(transfers: unknown[]): IndexedTronUsdtTransfer[] {
  return transfers as IndexedTronUsdtTransfer[];
}

function asRawTransfers(transfers: unknown[]): RawTronscanTrc20Transfer[] {
  return transfers as RawTronscanTrc20Transfer[];
}

function hasCleanCexPath(paths: IncomingDepositOriginPath[]): boolean {
  return paths.some((path) => path.stoppedReason === "clean_cex_reached");
}

function cleanIncomingDepositCoverage(report: WhereIsMoneyReport, deposit: ForensicRouteEdge): number {
  return Math.min(1, report.originPaths.reduce((sum, path) => {
    const onlyDepositSeed = path.txHashes.length === 1 && path.txHashes[0] === deposit.txHash;
    if (onlyDepositSeed || path.stoppedReason !== "allowlist_cex_reached") return sum;
    return sum + selectedAmountShare(path) * Math.min(1, Math.max(0, path.amountPreservationRatio));
  }, 0));
}

function incomingSenderRoleFromCoverage(input: {
  inferredRole: string | null;
  cleanSourceCoverageRatio: number;
}): string | null {
  if (input.cleanSourceCoverageRatio >= 0.85) return "clean_cex_funded_wallet";
  if (input.cleanSourceCoverageRatio > 0) return "partial_cex_context_wallet";
  if (input.inferredRole === "clean_cex_funded_wallet") return "operational_liquidity_wallet";
  return input.inferredRole;
}

const FULL_CLEAN_CEX_REASON = "Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.";
const PARTIAL_CLEAN_CEX_REASON = "Clean CEX origin is not fully proven; only a minority route reaches a clean CEX source.";
const ZERO_CLEAN_CEX_REASON = "Clean CEX origin is not fully proven for the deposit amount.";

function isFullCleanCexReason(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return normalized === FULL_CLEAN_CEX_REASON.toLowerCase()
    || normalized.includes("allowlisted cex sources through clean on-chain hops");
}

function isCleanCexFreshExposureReason(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return normalized.startsWith("clean cex accounts for ")
    && normalized.includes(" of checked-deposit source share");
}

function userFacingFreshBundleReasons(input: { reasons: string[] }): string[] {
  return input.reasons.filter((reason) => !isCleanCexFreshExposureReason(reason));
}

function incomingReasonsFromCoverage(input: {
  reasons: string[];
  cleanSourceCoverageRatio: number;
}): string[] {
  if (input.cleanSourceCoverageRatio >= 0.85) return input.reasons;

  const reasons = input.reasons.filter((reason) => !isFullCleanCexReason(reason));
  if (input.cleanSourceCoverageRatio > 0) {
    return uniqueStrings([...reasons, PARTIAL_CLEAN_CEX_REASON]);
  }

  if (reasons.length !== input.reasons.length) {
    return uniqueStrings([...reasons, ZERO_CLEAN_CEX_REASON]);
  }

  return reasons;
}

function isLargeDepositRaw(amountRaw: string): boolean {
  if (!/^\d+$/.test(amountRaw)) return false;
  return BigInt(amountRaw) >= LARGE_DEPOSIT_RAW;
}

function countTransfers(edges: ForensicRouteEdge[], address: string): { incoming: number; outgoing: number } {
  return edges.reduce(
    (counts, edge) => ({
      incoming: counts.incoming + (edge.toAddress === address ? 1 : 0),
      outgoing: counts.outgoing + (edge.fromAddress === address ? 1 : 0)
    }),
    { incoming: 0, outgoing: 0 }
  );
}

function mapWalletRole(role: WalletRole): string | null {
  if (role === "treasury_like" || role === "cashout_service") return "operational_liquidity_wallet";
  if (role === "unknown") return "unknown_wallet";
  return role;
}

function incomingSeedTransfer(input: BuildIncomingDepositReportInput): BalanceFormingTransfer {
  return {
    evidenceId: `incoming_deposit:${input.depositTxHash}`,
    txHash: input.depositTxHash,
    fromAddress: input.sender,
    toAddress: input.watchedWallet,
    amountRaw: input.amountRaw,
    timestamp: input.timestamp.toISOString(),
    coverageShare: 1,
    amountUsage: {
      anchorAmountRaw: input.amountRaw,
      originalAmountRaw: input.amountRaw,
      usedAmountRaw: input.amountRaw,
      coverageShare: 1,
      role: "anchor"
    },
    selectedReason: "covers_requested_amount"
  };
}

function fundingCandidateSeedTransfers(input: {
  candidates: ReturnType<typeof selectIncomingDepositFundingCandidates>["candidates"];
  depositAmountRaw: string;
}): BalanceFormingTransfer[] {
  return input.candidates.map((candidate) => ({
    evidenceId: candidate.edge.id,
    txHash: candidate.edge.txHash,
    fromAddress: candidate.edge.fromAddress,
    toAddress: candidate.edge.toAddress,
    amountRaw: candidate.usableAmountRaw,
    timestamp: candidate.edge.timestamp.toISOString(),
    method: candidate.edge.method,
    edgeType: candidate.edge.edgeType,
    economicRole: candidate.edge.economicRole,
    economicProtocol: candidate.edge.economicProtocol,
    coverageShare: candidate.coverageRatio,
    amountUsage: {
      anchorAmountRaw: input.depositAmountRaw,
      originalAmountRaw: candidate.edge.amountRaw,
      usedAmountRaw: candidate.usableAmountRaw,
      coverageShare: candidate.coverageRatio,
      role: "funding_candidate"
    },
    selectedReason: "covers_requested_amount"
  }));
}

function economicEdgeKey(edge: ForensicRouteEdge): string {
  return [
    edge.id,
    edge.txHash,
    edge.fromAddress,
    edge.toAddress,
    edge.amountRaw,
    edge.timestamp.getTime()
  ].join(":");
}

async function selectResolvedIncomingDepositFundingCandidates(input: {
  sender: string;
  watchedWallet: string;
  depositTxHash: string;
  depositAmountRaw: string;
  depositTimestamp: Date;
  edges: ForensicRouteEdge[];
  resolveEconomicContext(edge: ForensicRouteEdge): Promise<ForensicRouteEdge>;
}): Promise<{
  selection: ReturnType<typeof selectIncomingDepositFundingCandidates>;
  edges: ForensicRouteEdge[];
}> {
  let edges = input.edges;
  const resolvedKeys = new Set<string>();
  while (true) {
    const selection = selectIncomingDepositFundingCandidates({ ...input, edges });
    const unresolved = selection.candidates
      .map((candidate) => candidate.edge)
      .filter((edge) => !resolvedKeys.has(economicEdgeKey(edge)));
    if (unresolved.length === 0) return { selection, edges };

    const replacements = new Map<string, ForensicRouteEdge>();
    for (const edge of unresolved) {
      const key = economicEdgeKey(edge);
      const resolved = await input.resolveEconomicContext(edge);
      resolvedKeys.add(key);
      resolvedKeys.add(economicEdgeKey(resolved));
      replacements.set(key, resolved);
    }
    edges = edges.map((edge) => replacements.get(economicEdgeKey(edge)) ?? edge);
  }
}

async function buildResolvedFundingBundleForOutbound(input: {
  target: ForensicRouteEdge;
  edges: ForensicRouteEdge[];
  lookbackWindowMs: number;
  minCoverageRatio: number;
  resolveEconomicContext(edge: ForensicRouteEdge): Promise<ForensicRouteEdge>;
}): Promise<{
  bundle: IncomingDepositFundingBundle | null;
  edges: ForensicRouteEdge[];
}> {
  let edges = input.edges;
  const resolvedKeys = new Set<string>();
  while (true) {
    const bundle = buildFundingBundleForOutbound({ ...input, edges });
    if (!bundle) return { bundle: null, edges };
    const selectedTxHashes = new Set(bundle.fundingTxHashes);
    const unresolved = edges.filter((edge) =>
      edge.toAddress === input.target.fromAddress &&
      selectedTxHashes.has(edge.txHash) &&
      !resolvedKeys.has(economicEdgeKey(edge))
    );
    if (unresolved.length === 0) return { bundle, edges };

    const replacements = new Map<string, ForensicRouteEdge>();
    for (const edge of unresolved) {
      const key = economicEdgeKey(edge);
      const resolved = await input.resolveEconomicContext(edge);
      resolvedKeys.add(key);
      resolvedKeys.add(economicEdgeKey(resolved));
      replacements.set(key, resolved);
    }
    edges = edges.map((edge) => replacements.get(economicEdgeKey(edge)) ?? edge);
  }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

function validDate(value: Date | null | undefined): Date | null {
  if (!(value instanceof Date)) return null;
  return Number.isNaN(value.getTime()) ? null : value;
}

function msBetween(later: Date | null, earlier: Date | null): number | null {
  if (!later || !earlier) return null;
  return later.getTime() - earlier.getTime();
}

function isRecoverableTransferFetchError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  const nonRecoverableSignals = [
    "400",
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "invalid api key",
    "invalid key",
    "schema",
    "column"
  ];
  if (nonRecoverableSignals.some((needle) => message.includes(needle))) return false;

  return [
    "429",
    "rate limit",
    "too many requests",
    "aborterror",
    "aborted",
    "operation aborted",
    "timeout",
    "timed out",
    "network error",
    "socket",
    "socket hang up",
    "econnreset",
    "etimedout",
    "eai_again",
    "trongrid provider unavailable",
    "provider unavailable",
    "provider outage",
    "temporarily unavailable"
  ].some((needle) => message.includes(needle));
}

function textForPath(path: MoneyOriginPath): string {
  return [
    path.exposureSourceKey ?? "",
    path.exposureSourceLabel ?? "",
    path.rootSourceType,
    path.stoppedReason,
    ...path.reasons
  ].join(" ").toLowerCase();
}

function isHtxHuobiPath(path: MoneyOriginPath): boolean {
  const text = textForPath(path);
  return text.includes("htx") || text.includes("huobi");
}

function incomingStoppedReason(path: MoneyOriginPath): IncomingDepositOriginPath["stoppedReason"] {
  if (path.stoppedReason === "allowlist_cex_reached") return "clean_cex_reached";
  if (path.exposureSourceKey === "whitebit") return "whitebit_reached";
  if (path.rootSourceType === "risky_label" || path.stoppedReason === "risky_label_reached") return "risky_label_reached";
  if (path.rootSourceType === "decline_boundary") {
    if (isHtxHuobiPath(path)) return "htx_huobi_reached";
    return "bridge_router_dex_reached";
  }
  if (path.stoppedReason === "unlabeled_service_boundary") return "unknown_contract_reached";
  if (path.stoppedReason === "incoming_history_not_fetched") return "incoming_history_not_fetched";
  if (path.stoppedReason === "weak_amount_or_time_continuity") return "weak_cashflow_continuity";
  if (path.stoppedReason === "data_budget_exhausted") return "data_budget_exhausted";
  return "no_previous_transfer";
}

function incomingSourcePolicy(path: MoneyOriginPath): IncomingDepositOriginPath["sourcePolicy"] {
  if (path.stoppedReason === "allowlist_cex_reached") return "clean";
  if (path.exposureSourceKey === "whitebit") return path.riskScoreContribution >= 60 ? "hard_decline" : "medium_policy";
  if (path.rootSourceType === "risky_label") return "hard_decline";
  if (path.rootSourceType === "decline_boundary") return path.riskScoreContribution >= 60 ? "hard_decline" : "unknown";
  return "unknown";
}

function amountContinuity(path: MoneyOriginPath): IncomingDepositOriginPath["amountContinuity"] {
  if (path.amountPreservationRatio >= 0.9) return "strong";
  if (path.amountPreservationRatio >= 0.7) return "medium";
  return "weak";
}

function edgeStep(edge: ForensicRouteEdge): IncomingDepositOriginPath["steps"][number] {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    method: edge.method,
    edgeType: edge.edgeType
  };
}

function originPathStepToEdge(step: MoneyOriginPath["steps"][number]): ForensicRouteEdge {
  return {
    id: `origin_path:${step.txHash}:${step.fromAddress}:${step.toAddress}:${step.amountRaw}`,
    txHash: step.txHash,
    fromAddress: step.fromAddress,
    toAddress: step.toAddress,
    amountRaw: step.amountRaw,
    timestamp: new Date(step.timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function rawAmountBigInt(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

type IncomingDepositFundingBundleDeepExpansion = NonNullable<IncomingDepositFundingBundle["deepExpansion"]>;

function compareFundingEdgesChronological(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const leftTime = left.timestamp.getTime();
  const rightTime = right.timestamp.getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.txHash.localeCompare(right.txHash);
}

function compareFundingEdgeRepresentative(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const leftAmount = rawAmountBigInt(left.amountRaw) ?? 0n;
  const rightAmount = rawAmountBigInt(right.amountRaw) ?? 0n;
  if (leftAmount !== rightAmount) return rightAmount > leftAmount ? 1 : -1;
  return compareFundingEdgesChronological(left, right);
}

function fundingEdgesForBundleExpansion(input: {
  bundle: IncomingDepositFundingBundle;
  edges: ForensicRouteEdge[];
  funders: string[];
}): ForensicRouteEdge[] {
  const selectedTxHashesByFunder = new Map<string, Set<string>>();
  const selectedFunders = new Set(input.funders);
  for (const funder of input.bundle.fundingFunders) {
    if (!selectedFunders.has(funder.address)) continue;
    selectedTxHashesByFunder.set(funder.address, new Set(funder.txHashes));
  }

  const edgesByFunder = new Map<string, ForensicRouteEdge[]>();
  for (const edge of input.edges
    .filter((edge) => {
      if (edge.toAddress !== input.bundle.targetFromAddress) return false;
      const txHashes = selectedTxHashesByFunder.get(edge.fromAddress);
      return txHashes?.has(edge.txHash) ?? false;
    })) {
    const funderEdges = edgesByFunder.get(edge.fromAddress) ?? [];
    funderEdges.push(edge);
    edgesByFunder.set(edge.fromAddress, funderEdges);
  }

  return input.funders
    .map((funder) => (edgesByFunder.get(funder) ?? []).sort(compareFundingEdgeRepresentative)[0] ?? null)
    .filter((edge): edge is ForensicRouteEdge => edge !== null)
    .sort(compareFundingEdgesChronological);
}

function fundingEdgeToBalanceTransfer(edge: ForensicRouteEdge): BalanceFormingTransfer {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    method: edge.method,
    edgeType: edge.edgeType,
    economicRole: edge.economicRole,
    economicProtocol: edge.economicProtocol,
    coverageShare: 0,
    selectedReason: "covers_requested_amount"
  };
}

function fundingBundleExpansionStatus(paths: MoneyOriginPath[]): IncomingDepositFundingBundleDeepExpansion["status"] {
  if (paths.some((path) => path.rootSourceType === "risky_label")) return "hard_risk_reached";
  if (paths.some((path) => path.rootSourceType === "allowlist_cex")) return "clean_source_reached";
  if (paths.some((path) =>
    path.rootSourceType === "decline_boundary" || path.stoppedReason === "unlabeled_service_boundary"
  )) {
    return "service_boundary_reached";
  }
  return "unproven_corridor";
}

function fundingBundleExpansionReasons(input: {
  status: IncomingDepositFundingBundleDeepExpansion["status"];
  selectedFunderCount: number;
  tracedEdgeCount: number;
}): string[] {
  const statusReason = {
    not_run: "adaptive_expansion_not_run",
    clean_source_reached: "adaptive_expansion_clean_source_reached",
    hard_risk_reached: "adaptive_expansion_hard_risk_reached",
    service_boundary_reached: "adaptive_expansion_service_boundary_reached",
    unproven_corridor: "adaptive_expansion_no_clean_or_hard_source"
  }[input.status];
  return [
    statusReason,
    `expanded_funders:${input.selectedFunderCount}`,
    `traced_edges:${input.tracedEdgeCount}`
  ];
}

async function buildFundingBundleDeepExpansion(input: {
  bundle: IncomingDepositFundingBundle;
  edgesForTargetFromAddress: ForensicRouteEdge[];
  fetchEdgesForAddress(address: string, options?: IncomingTraceFetchOptions): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  resolveEconomicContext(edge: ForensicRouteEdge): Promise<ForensicRouteEdge>;
}): Promise<IncomingDepositFundingBundleDeepExpansion> {
  const topExpandedFunders = selectFundingBundleFundersForExpansion({
    bundle: input.bundle,
    maxFunders: ADAPTIVE_CORRIDOR_EXPANSION_MAX_FUNDERS
  });

  if (topExpandedFunders.length === 0) {
    return {
      status: "unproven_corridor",
      maxDepth: ADAPTIVE_CORRIDOR_EXPANSION_MAX_DEPTH,
      fetchedAddressCount: 0,
      topExpandedFunders,
      reasons: ["no_selected_funders"]
    };
  }

  const fundingEdges = fundingEdgesForBundleExpansion({
    bundle: input.bundle,
    edges: input.edgesForTargetFromAddress,
    funders: topExpandedFunders
  });
  if (fundingEdges.length === 0) {
    return {
      status: "unproven_corridor",
      maxDepth: ADAPTIVE_CORRIDOR_EXPANSION_MAX_DEPTH,
      fetchedAddressCount: 0,
      topExpandedFunders,
      reasons: ["no_selected_funding_edges"]
    };
  }

  const fetchedAddresses = new Set<string>();
  const fetchEdgesForExpansion = async (
    address: string,
    options?: IncomingTraceFetchOptions
  ): Promise<ForensicRouteEdge[]> => {
    fetchedAddresses.add(address);
    return input.fetchEdgesForAddress(address, options);
  };
  const paths: MoneyOriginPath[] = [];
  for (const fundingEdge of fundingEdges) {
    paths.push(await traceMoneyOriginPath({
      subjectAddress: input.bundle.targetFromAddress,
      balanceTransfer: fundingEdgeToBalanceTransfer(fundingEdge),
      maxDepth: ADAPTIVE_CORRIDOR_EXPANSION_MAX_DEPTH,
      beamWidth: ADAPTIVE_CORRIDOR_EXPANSION_BEAM_WIDTH,
      maxAddressFetches: ADAPTIVE_CORRIDOR_EXPANSION_MAX_ADDRESS_FETCHES,
      maxEdgesPerAddress: ADAPTIVE_CORRIDOR_EXPANSION_MAX_EDGES_PER_ADDRESS,
      minAmountPreservationRatio: ADAPTIVE_CORRIDOR_EXPANSION_MIN_AMOUNT_PRESERVATION_RATIO,
      fetchEdgesForAddress: fetchEdgesForExpansion,
      getLabelsForAddress: input.getLabelsForAddress,
      getClassificationForAddress: input.getClassificationForAddress,
      resolveEconomicContext: input.resolveEconomicContext
    }));
  }

  const status = fundingBundleExpansionStatus(paths);
  return {
    status,
    maxDepth: ADAPTIVE_CORRIDOR_EXPANSION_MAX_DEPTH,
    fetchedAddressCount: fetchedAddresses.size,
    topExpandedFunders,
    reasons: fundingBundleExpansionReasons({
      status,
      selectedFunderCount: topExpandedFunders.length,
      tracedEdgeCount: fundingEdges.length
    })
  };
}

async function buildFundingBundlesByTxHash(input: {
  whereReport: WhereIsMoneyReport;
  fetchEdgesForAddress(address: string, options?: IncomingTraceFetchOptions): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  resolveEconomicContext(edge: ForensicRouteEdge): Promise<ForensicRouteEdge>;
}): Promise<Map<string, IncomingDepositFundingBundle>> {
  const bundlesByTxHash = new Map<string, IncomingDepositFundingBundle>();
  const inspectedTxHashes = new Set<string>();

  const inspectTarget = async (target: ForensicRouteEdge): Promise<void> => {
    if (inspectedTxHashes.has(target.txHash)) return;

    const amountRaw = rawAmountBigInt(target.amountRaw);
    if (amountRaw === null || amountRaw < LARGE_INTERMEDIATE_TRANSFER_RAW) return;
    inspectedTxHashes.add(target.txHash);

    const fetchedEdges = await input.fetchEdgesForAddress(target.fromAddress, { latestTimestamp: target.timestamp });
    const resolved = await buildResolvedFundingBundleForOutbound({
      target,
      edges: fetchedEdges,
      lookbackWindowMs: LARGE_INTERMEDIATE_TRANSFER_BUNDLE_LOOKBACK_MS,
      minCoverageRatio: LARGE_INTERMEDIATE_TRANSFER_BUNDLE_MIN_COVERAGE,
      resolveEconomicContext: input.resolveEconomicContext
    });
    const bundle = resolved.bundle;
    if (!bundle) return;

    const deepExpansion = await buildFundingBundleDeepExpansion({
      bundle,
      edgesForTargetFromAddress: resolved.edges,
      fetchEdgesForAddress: input.fetchEdgesForAddress,
      getLabelsForAddress: input.getLabelsForAddress,
      getClassificationForAddress: input.getClassificationForAddress,
      resolveEconomicContext: input.resolveEconomicContext
    });
    bundlesByTxHash.set(target.txHash, { ...bundle, deepExpansion });
  };

  for (const path of input.whereReport.originPaths) {
    for (const step of path.steps) {
      await inspectTarget(originPathStepToEdge(step));
    }

    for (const bundle of path.fundingBundles ?? []) {
      for (const member of bundle.members) {
        await inspectTarget({
          id: `origin_bundle_member:${member.txHash}:${member.fromAddress}:${member.toAddress}:${member.originalAmountRaw}`,
          txHash: member.txHash,
          fromAddress: member.fromAddress,
          toAddress: member.toAddress,
          amountRaw: member.originalAmountRaw,
          timestamp: new Date(member.timestamp),
          method: "transfer",
          edgeType: "normal_transfer"
        });
      }
    }
  }

  return bundlesByTxHash;
}

function selectedAmountShare(path: MoneyOriginPath): number {
  return selectedMoneyOriginPathShare(path);
}

function incomingPathFromWhere(
  path: MoneyOriginPath,
  deposit: ForensicRouteEdge,
  fundingBundlesByTxHash?: Map<string, IncomingDepositFundingBundle>,
  sourcePolicyEvidence: SourcePolicyEvidence[] = []
): IncomingDepositOriginPath {
  const hasDepositStep = path.txHashes.includes(deposit.txHash);
  const steps = [
    ...path.steps.map((step) => ({
      ...step,
      method: "transfer",
      edgeType: "normal_transfer" as const
    })),
    ...(hasDepositStep ? [] : [edgeStep(deposit)])
  ];
  const pathAddresses = hasDepositStep
    ? path.pathAddresses
    : [...path.pathAddresses, deposit.toAddress];
  const txHashes = hasDepositStep
    ? path.txHashes
    : [...path.txHashes, deposit.txHash];
  const fundingBundles = fundingBundlesByTxHash
    ? steps
      .map((step) => fundingBundlesByTxHash.get(step.txHash) ?? null)
      .filter((bundle): bundle is IncomingDepositFundingBundle => bundle !== null)
    : [];
  const sourcePolicyKind = path.sourceExposureKind ?? path.exposureSourceKey;
  const sourcePolicyShareDetail = path.scoreBreakdown
    ?.find((layer) => layer.shareDetail && (!sourcePolicyKind || layer.sourceExposureKind === sourcePolicyKind))
    ?.shareDetail
    ?? sourcePolicyEvidence.find((evidence) => evidence.kind === sourcePolicyKind)?.shareDetail;

  return {
    verdict: path.verdict === "DECLINE" && path.riskScoreContribution >= 60
      ? "DECLINE"
      : path.verdict === "REVIEW"
        ? "REVIEW"
        : "ACCEPTABLE",
    score: path.riskScoreContribution,
    sourcePolicy: incomingSourcePolicy(path),
    stoppedReason: incomingStoppedReason(path),
    pathAddresses,
    txHashes,
    steps,
    amountCoverageRatio: path.amountPreservationRatio,
    ...(Number.isFinite(path.balanceShare) ? { balanceShare: selectedAmountShare(path) } : {}),
    amountContinuity: amountContinuity(path),
    proximityHops: Math.max(0, steps.length - 1),
    reasons: path.reasons,
    ...(path.rejectedCandidates && path.rejectedCandidates.length > 0 ? { rejectedCandidates: path.rejectedCandidates } : {}),
    ...(fundingBundles.length > 0 ? { fundingBundles } : {}),
    ...(sourcePolicyShareDetail ? { sourcePolicyShareDetail } : {})
  };
}

function incomingPathTouchesAddress(path: IncomingDepositOriginPath, address: string): boolean {
  return path.pathAddresses.includes(address) ||
    path.steps.some((step) => step.fromAddress === address || step.toAddress === address);
}

function freshExposurePathsWithLegitimateServices(input: {
  originPaths: IncomingDepositOriginPath[];
  legitimateServiceAddresses: ReadonlySet<string>;
}): IncomingDepositOriginPath[] {
  if (input.legitimateServiceAddresses.size === 0) return input.originPaths;

  return input.originPaths.map((path) => {
    if (path.stoppedReason !== "unknown_contract_reached") return path;
    const touchesLegitimateService = [...input.legitimateServiceAddresses]
      .some((address) => incomingPathTouchesAddress(path, address));
    return touchesLegitimateService
      ? { ...path, stoppedReason: "no_previous_transfer" }
      : path;
  });
}

function clampIncomingSourceShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function incomingSourceBundleClass(path: IncomingDepositOriginPath): SourceBundleExposureSourceKind {
  switch (path.stoppedReason) {
    case "htx_huobi_reached":
      return "htx_huobi";
    case "clean_cex_reached":
      return "clean_cex";
    case "bridge_router_dex_reached":
      return "bridge_router_dex";
    case "unknown_contract_reached":
      return "unknown_contract";
    case "risky_label_reached":
      return "risky_label";
    case "whitebit_reached":
    default:
      return "unknown";
  }
}

const INCOMING_SOURCE_SHARE_SCALE = 1_000_000n;

function incomingSourceBundleAmountRaw(targetAmountRaw: string, share: number): string {
  if (!/^\d+$/.test(targetAmountRaw)) return "0";

  const scaledShare = BigInt(Math.round(clampIncomingSourceShare(share) * Number(INCOMING_SOURCE_SHARE_SCALE)));
  return ((BigInt(targetAmountRaw) * scaledShare) / INCOMING_SOURCE_SHARE_SCALE).toString();
}

function incomingSourceBundleFinding(path: IncomingDepositOriginPath, targetAmountRaw: string): SourceBundleExposureFinding | null {
  const share = clampIncomingSourceShare(path.balanceShare ?? 0);
  if (share <= 0) return null;

  return {
    sourceClass: incomingSourceBundleClass(path),
    share,
    amountRaw: incomingSourceBundleAmountRaw(targetAmountRaw, share),
    evidenceTxHashes: path.txHashes,
    stoppedReason: path.stoppedReason,
    proofKind: "selected_amount"
  };
}

function buildIncomingSourceBundleExposure(input: {
  targetAmountRaw: string;
  originPaths: IncomingDepositOriginPath[];
}) {
  const exhausted = input.originPaths.some((path) => path.stoppedReason === "data_budget_exhausted");
  const findings = input.originPaths
    .map((path) => incomingSourceBundleFinding(path, input.targetAmountRaw))
    .filter((finding): finding is SourceBundleExposureFinding => finding !== null);
  const budget = {
    maxDepth: null,
    fetchedAddressCount: null,
    maxAddressFetches: null,
    liveTransferReadCount: null,
    skippedAddressCount: 0,
    exhausted,
    exhaustedPhase: exhausted ? "trace" : null
  } as const;

  return buildSourceBundleExposure({
    scope: "incoming_deposit",
    targetAmountRaw: input.targetAmountRaw,
    findings,
    budget,
    unresolvedBoundary: unresolvedBoundaryFromFindings({ findings, budget })
  });
}

function incomingSubjectExposureProfile(input: {
  subjectAddress: string;
  walletExposureProfile?: IncomingWalletExposureProfile;
}): SubjectExposureProfile | undefined {
  const profile = input.walletExposureProfile;
  if (!profile) return undefined;

  return {
    subjectAddress: input.subjectAddress,
    windowStart: profile.windowStart,
    windowEnd: profile.windowEnd,
    transferEventsScanned: profile.transferEventsScanned,
    incomingVolumeRaw: profile.incomingVolumeRaw,
    outgoingVolumeRaw: profile.outgoingVolumeRaw,
    htxHuobiIncomingShare: profile.htxHuobiIncomingShare,
    cleanCexIncomingShare: profile.cleanCexIncomingShare,
    bridgeRouterDexVolumeShare: profile.bridgeRouterDexVolumeShare,
    unknownContractVolumeShare: profile.unknownContractVolumeShare,
    unknownSourceShare: profile.unknownSourceShare,
    inOutVelocityScore: profile.inOutVelocityScore,
    scoreContribution: profile.scoreContribution,
    reasons: profile.reasons,
    warnings: profile.warnings
  };
}

export function incomingCorridorSummary(paths: IncomingDepositOriginPath[]): IncomingDepositCorridorSummary | null {
  const candidate = paths
    .filter((path) => path.sourcePolicy === "unknown" && path.steps.length >= 8)
    .sort((left, right) => right.steps.length - left.steps.length)[0];
  if (!candidate || candidate.steps.length === 0) return null;

  const largestTransferRaw = candidate.steps.reduce((largest, step) => {
    const amount = rawAmountBigInt(step.amountRaw);
    if (amount === null) return largest;
    if (amount > largest.amount) return { amount, raw: step.amountRaw };
    return largest;
  }, { amount: 0n, raw: "0" }).raw;

  return {
    kind: "large_liquidity_corridor",
    pathLength: candidate.steps.length,
    largestTransferRaw,
    cleanSourceReached: false,
    hardRiskReached: false,
    reason: "Large operational liquidity corridor; clean CEX was not reached."
  };
}

function incomingOriginCoverage(report: WhereIsMoneyReport, deposit: ForensicRouteEdge): number {
  const coveredShare = report.originPaths.reduce((sum, path) => {
    const onlyDepositSeed = path.txHashes.length === 1 && path.txHashes[0] === deposit.txHash;
    if (onlyDepositSeed) return sum;
    return sum + selectedAmountShare(path) * Math.min(1, Math.max(0, path.amountPreservationRatio));
  }, 0);
  return Math.min(1, coveredShare);
}

function incomingDataQuality(report: WhereIsMoneyReport): IncomingDepositRiskReport["dataQuality"] {
  const score = report.assessment.coverageCompleteness;
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

type IncomingTargetedCoverageBlock = {
  scoreBlockedReason: ForensicScoreBlockedReason;
  technicalStatus: ForensicTechnicalStatus;
  address: string | null;
};

function incomingDecisionCoverage(
  whereReport: WhereIsMoneyReport,
  targetedBlock: IncomingTargetedCoverageBlock | null
): DecisionCoverage {
  const invalid = targetedBlock !== null || whereReport.scoreValid !== true;
  return {
    required: invalid ? "invalid" : "valid",
    overall: invalid || whereReport.coverage.partial ? "partial" : "complete",
    invalidModes: invalid ? ["incoming_deposit_provenance"] : [],
    caveats: [
      ...whereReport.coverage.notes,
      ...(targetedBlock ? [`${targetedBlock.scoreBlockedReason}:${targetedBlock.technicalStatus}`] : [])
    ]
  };
}

function targetedCoverageMapKey(address: string, targetTimestamp: string | Date | null | undefined): string {
  const raw = targetTimestamp instanceof Date ? targetTimestamp.toISOString() : targetTimestamp ?? "";
  const parsed = Date.parse(raw);
  return `${address}:${Number.isFinite(parsed) ? parsed : raw}`;
}

function isCompleteBroadTargetedState(state: TronAddressUsdtIndexState | null | undefined): boolean {
  return state?.coverageMode === "targeted" &&
    (state.requestKind ?? "broad_targeted") === "broad_targeted" &&
    state.status === "complete" &&
    state.statusReason === "complete_provider_windowed";
}

function targetedBlockFromStatusReason(
  statusReason: TronAddressUsdtCoverageStatusReason | null | undefined,
  lastError?: string | null
): Omit<IncomingTargetedCoverageBlock, "address"> {
  const errorText = (lastError ?? "").toLowerCase();
  if (statusReason === "partial_budget_exhausted") {
    return { scoreBlockedReason: "partial_budget_exhausted", technicalStatus: "budget_limited" };
  }
  if (statusReason === "too_large_deferred") {
    return { scoreBlockedReason: "hard_safety_limit_exceeded", technicalStatus: "hard_safety_limit_exceeded" };
  }
  if (statusReason === "partial_rate_limited" || errorText.includes("429") || errorText.includes("rate")) {
    return { scoreBlockedReason: "rate_limited_after_retries", technicalStatus: "provider_limited" };
  }
  if (statusReason === "partial_provider_inconsistent") {
    return { scoreBlockedReason: "provider_inconsistent", technicalStatus: "provider_error" };
  }
  if (statusReason === "partial_provider_cap") {
    return { scoreBlockedReason: "provider_cap_unresolved", technicalStatus: "provider_cap_unresolved" };
  }
  if (statusReason === "failed_retryable" || statusReason === "failed_terminal" || errorText.length > 0) {
    return { scoreBlockedReason: "provider_error", technicalStatus: "provider_error" };
  }
  return { scoreBlockedReason: "partial_budget_exhausted", technicalStatus: "hard_safety_limit_exceeded" };
}

function buildIncomingTargetedCoverageSummary(input: {
  whereReport: WhereIsMoneyReport;
  deposit: ForensicRouteEdge;
  ensureStates: Map<string, TronAddressUsdtIndexState>;
  ensureErrors: Map<string, string>;
}): { summary: IncomingDepositTargetedCoverageSummary | null; block: IncomingTargetedCoverageBlock | null } {
  const histories = input.whereReport.originPaths
    .filter((path) => selectedAmountShare(path) > 0)
    .flatMap((path) => path.historyCoverage ?? []);
  const byKey = new Map<string, MoneyOriginTraceHistoryCoverage>();
  for (const history of histories) {
    byKey.set(targetedCoverageMapKey(history.address, history.targetTimestamp), history);
  }
  const uniqueHistories = [...byKey.values()];
  if (uniqueHistories.length === 0 && input.ensureStates.size === 0 && input.ensureErrors.size === 0) {
    return { summary: null, block: null };
  }

  const firstPartial = uniqueHistories.find((history) => history.reachedTargetHop === false) ?? null;
  const firstKey = firstPartial ? targetedCoverageMapKey(firstPartial.address, firstPartial.targetTimestamp) : null;
  const firstState = firstKey ? input.ensureStates.get(firstKey) ?? null : null;
  const firstError = firstKey ? input.ensureErrors.get(firstKey) ?? null : null;
  const block: IncomingTargetedCoverageBlock | null = firstPartial
    ? firstPartial.localMaterializationStatus === "local_limit"
      ? {
          address: firstPartial.address,
          scoreBlockedReason: "local_budget_limited",
          technicalStatus: "local_budget_limited"
        }
      : firstPartial.localMaterializationStatus === "read_failed"
        ? {
            address: firstPartial.address,
            scoreBlockedReason: "local_index_read_failed",
            technicalStatus: "local_data_error"
          }
        : {
            ...targetedBlockFromStatusReason(firstState?.statusReason, firstState?.lastError ?? firstError),
            address: firstPartial.address
          }
    : null;

  return {
    summary: {
      selectedDepositTxHash: input.deposit.txHash,
      sender: input.deposit.fromAddress,
      hopCount: uniqueHistories.length,
      completeHopCount: uniqueHistories.filter((history) => history.reachedTargetHop).length,
      partialHopCount: uniqueHistories.filter((history) => !history.reachedTargetHop).length,
      pagesFetched: uniqueHistories.reduce((sum, history) => sum + (history.fetchedPageCount ?? 0), 0),
      transfersFetched: uniqueHistories.reduce((sum, history) => sum + history.fetchedTransferCount, 0),
      firstBlockingReason: block?.scoreBlockedReason ?? null,
      firstBlockingTechnicalStatus: block?.technicalStatus ?? null,
      firstBlockingAddress: block?.address ?? null
    },
    block
  };
}

function incomingHardEvidenceFromWhere(evidence: WhereIsMoneyHardBadEvidence): IncomingDepositRiskReport["hardBadEvidence"][number] | null {
  if (evidence.kind === "fast_critical" || evidence.kind === "scam_or_blacklist") {
    return { kind: "scam_or_blacklist", score: evidence.score, message: evidence.message, evidenceIds: evidence.evidenceIds };
  }
  if (evidence.kind === "approval_drain") {
    return { kind: "approval_drain", score: evidence.score, message: evidence.message, evidenceIds: evidence.evidenceIds };
  }
  if (evidence.kind === "htx_huobi_source") {
    return { kind: "htx_huobi_source", score: evidence.score, message: evidence.message, evidenceIds: evidence.evidenceIds };
  }
  if (evidence.kind === "bridge_router_dex_boundary") {
    return { kind: "bridge_router_dex_boundary", score: evidence.score, message: evidence.message, evidenceIds: evidence.evidenceIds };
  }
  if (evidence.kind === "llm_contract_suspicion") {
    return { kind: "llm_contract_suspicion", score: evidence.score, message: evidence.message, evidenceIds: evidence.evidenceIds };
  }
  if (evidence.kind === "sanctioned_service") {
    return { kind: "sanctioned_service", score: evidence.score, message: evidence.message, evidenceIds: evidence.evidenceIds };
  }
  return null;
}

function incomingReportFromWhere(input: {
  whereReport: WhereIsMoneyReport;
  fastSenderRisk: RiskReport | null;
  senderStablecoinState: StablecoinRestrictionProfile | null;
  deposit: ForensicRouteEdge;
  fundingBundlesByTxHash?: Map<string, IncomingDepositFundingBundle>;
  walletExposureProfile?: IncomingWalletExposureProfile;
  targetedHistoryCoverage?: IncomingDepositTargetedCoverageSummary | null;
  targetedCoverageBlock?: IncomingTargetedCoverageBlock | null;
  receiverDeepReport?: DeepAddressForensicReport | null;
  legitimateServiceAddresses?: ReadonlySet<string>;
}): IncomingDepositRiskReportBase {
  const stablecoinBlacklistEvidence = input.senderStablecoinState?.isBlacklisted
    ? [{
        kind: "stablecoin_blacklist" as const,
        score: 95,
        message: "Sender is USDT-blacklisted.",
        evidenceIds: []
      }]
    : [];
  const whereEvidence = input.whereReport.assessment.hardBadEvidence
    .map(incomingHardEvidenceFromWhere)
    .filter((evidence): evidence is IncomingDepositRiskReport["hardBadEvidence"][number] => evidence !== null);
  const hardBadEvidence = [...stablecoinBlacklistEvidence, ...whereEvidence]
    .sort((left, right) => right.score - left.score);
  const originPaths = input.whereReport.originPaths.map((path) =>
    incomingPathFromWhere(
      path,
      input.deposit,
      input.fundingBundlesByTxHash,
      input.whereReport.assessment.sourcePolicyEvidence
    )
  );
  const provenanceWhereOriginPaths = input.whereReport.originPaths.filter((path) =>
    !isExactGasFreeServiceFeePath(path)
  );
  const exactGasFreeFeeOnly = originPaths.length > 0 && provenanceWhereOriginPaths.length === 0;
  const provenanceOriginPaths = provenanceWhereOriginPaths.map((path) =>
    incomingPathFromWhere(
      path,
      input.deposit,
      input.fundingBundlesByTxHash,
      input.whereReport.assessment.sourcePolicyEvidence
    )
  );
  const freshExposureOriginPaths = freshExposurePathsWithLegitimateServices({
    originPaths: provenanceOriginPaths,
    legitimateServiceAddresses: input.legitimateServiceAddresses ?? new Set()
  });
  const freshBundleExposure = freshExposureOriginPaths.length > 0
    ? buildIncomingFreshBundleExposure({
        targetAmountRaw: input.deposit.amountRaw,
        originPaths: freshExposureOriginPaths
      })
    : undefined;
  const sourceBundleExposure = freshExposureOriginPaths.length > 0
    ? buildIncomingSourceBundleExposure({
        targetAmountRaw: input.deposit.amountRaw,
        originPaths: freshExposureOriginPaths
      })
    : undefined;
  const walletExposureProfile = exactGasFreeFeeOnly ? undefined : input.walletExposureProfile;
  const subjectExposureProfile = incomingSubjectExposureProfile({
    subjectAddress: input.deposit.fromAddress,
    walletExposureProfile
  });
  const decisionCoverage = incomingDecisionCoverage(
    input.whereReport,
    input.targetedCoverageBlock ?? null
  );
  const unifiedRisk = calculateUnifiedIncomingDepositRisk({
    senderAddress: input.deposit.fromAddress,
    receiverAddress: input.deposit.toAddress,
    txHash: input.deposit.txHash,
    amountRaw: input.deposit.amountRaw,
    timestamp: input.deposit.timestamp,
    fastSenderRisk: input.fastSenderRisk,
    senderStablecoinState: input.senderStablecoinState,
    whereReport: input.whereReport,
    receiverDeepReport: input.receiverDeepReport,
    freshBundleExposure,
    walletExposureProfile: walletExposureProfile ?? null,
    decisionCoverage
  });
  const decision: IncomingDepositDecision = unifiedRisk.finalDecision;
  const scoreInvalid = !unifiedRisk.scoreValid;
  const depositRiskScore = unifiedRisk.finalScore;
  const scoreBlockedReason = scoreInvalid
    ? input.targetedCoverageBlock?.scoreBlockedReason ??
      input.whereReport.scoreBlockedReason ??
      "insufficient_coverage"
    : null;
  const technicalStatus = scoreInvalid
    ? input.targetedCoverageBlock?.technicalStatus ??
      input.whereReport.technicalStatus ??
      "provider_cap_unresolved"
    : "completed";
  const unifiedRiskSummary = incomingUnifiedRiskSummary(unifiedRisk);
  const zeroBalanceWarning = input.senderStablecoinState?.balanceRaw === "0"
    ? "Sender current balance is zero after outgoing deposit; transaction-seeded provenance was used instead of sender balance-origin mode."
    : null;

  return {
    decision,
    scoreValid: !scoreInvalid,
    scoreBlockedReason,
    technicalStatus,
    depositRiskScore,
    observedContextScore: unifiedRisk.observedContextScore,
    riskBand: depositRiskScore === null ? null : incomingRiskBandFromUnifiedScore(depositRiskScore),
    fastSenderRisk: input.fastSenderRisk,
    originPaths,
    originCoverage: incomingOriginCoverage(input.whereReport, input.deposit),
    provenanceConfidence: input.whereReport.assessment.provenanceConfidence,
    dataQuality: incomingDataQuality(input.whereReport),
    senderRole: input.whereReport.assessment.walletRole,
    targetedHistoryCoverage: input.targetedHistoryCoverage ?? undefined,
    sourcePolicyEvidence: input.whereReport.assessment.sourcePolicyEvidence,
    hardBadEvidence,
    contractVerdicts: [],
    contractDrivenReceiverProfile: input.whereReport.contractDrivenReceiverProfile ?? null,
    contractDrivenTransferProfiles: input.whereReport.contractDrivenTransferProfiles ?? [],
    contractDrivenSubjectAddress: input.whereReport.subjectAddress,
    ...(freshBundleExposure ? { freshBundleExposure } : {}),
    ...(walletExposureProfile ? { walletExposureProfile } : {}),
    ...(sourceBundleExposure ? { sourceBundleExposure } : {}),
    ...(subjectExposureProfile ? { subjectExposureProfile } : {}),
    unifiedRiskSummary,
    reasons: uniqueStrings([
      ...(scoreInvalid && input.targetedCoverageBlock
        ? [`Final incoming-deposit scoring is blocked until mandatory hop history is covered: ${input.targetedCoverageBlock.scoreBlockedReason}.`]
        : scoreInvalid
          ? [`Final incoming-deposit scoring is blocked because where-is-money scoring is invalid: ${scoreBlockedReason}.`]
        : []),
      ...hardBadEvidence.map((evidence) => evidence.message),
      ...input.whereReport.decisionReasons,
      ...(freshBundleExposure ? userFacingFreshBundleReasons(freshBundleExposure) : []),
      ...(walletExposureProfile?.reasons ?? [])
    ]),
    warnings: uniqueStrings([
      ...(scoreInvalid ? [`Technical status: ${technicalStatus}.`] : []),
      ...input.whereReport.assessment.warnings,
      ...input.whereReport.coverage.notes,
      zeroBalanceWarning
    ])
  };
}

async function inferIncomingDepositSenderRole(input: {
  sender: string;
  senderEdges: ForensicRouteEdge[];
  originPaths: IncomingDepositOriginPath[];
  stablecoinState: StablecoinRestrictionProfile | null;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
}): Promise<string | null> {
  if (hasCleanCexPath(input.originPaths)) return "clean_cex_funded_wallet";

  const addresses = new Set<string>([input.sender]);
  for (const edge of input.senderEdges) {
    addresses.add(edge.fromAddress);
    addresses.add(edge.toAddress);
  }

  const classifications = new Map<string, ServiceClassification | null>();
  for (const address of addresses) {
    classifications.set(address, await input.getClassificationForAddress(address));
  }

  const subjectClassification = classifications.get(input.sender) ?? null;
  const serviceExposureProfile = buildServiceExposureProfile({
    subjectAddress: input.sender,
    edges: input.senderEdges,
    classifications
  });
  const addressBehaviorProfile = buildAddressBehaviorProfile({
    subjectAddress: input.sender,
    edges: input.senderEdges,
    serviceExposureProfile,
    subjectClassification
  });
  const boundaryExposureProfile = buildBoundaryExposureProfile({
    subjectAddress: input.sender,
    edges: input.senderEdges,
    classifications
  });
  const walletRoleProfile = buildWalletRoleProfile({
    subjectAddress: input.sender,
    approvalDrainProfiles: [],
    addressBehaviorProfile,
    serviceExposureProfile,
    boundaryExposureProfile,
    subjectClassification
  });

  const role = mapWalletRole(walletRoleProfile.primaryRole);
  if (role && role !== "unknown_wallet") return role;

  const counts = countTransfers(input.senderEdges, input.sender);
  if (counts.incoming <= 1 && counts.outgoing <= 1 && input.stablecoinState?.balanceRaw === "0") {
    return "fresh_one_shot_wallet";
  }
  return role;
}

export async function buildIncomingDepositReport(
  input: BuildIncomingDepositReportInput
): Promise<IncomingDepositRiskReport> {
  const measureReportStage = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (!input.timing) return fn();
    return input.timing.measure(`report_${name}`, fn);
  };
  const labels = await measureReportStage("load_sender_labels", () =>
    input.deps.getLabelsForAddress(input.sender)
  );
  const fastSenderRisk = await measureReportStage("evaluate_fast_sender_risk", async () => evaluateAddressRisk({
    context: {
      subjectAddress: input.sender,
      observedTransactionHash: input.depositTxHash
    },
    labels
  }).report);

  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const targetedEdgeCacheKeys = new Set<string>();
  const historyCoverageCache = new Map<string, MoneyOriginTraceHistoryCoverage>();
  const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
  const targetedEnsureCache = new Map<string, Promise<boolean>>();
  const targetedEnsureStates = new Map<string, TronAddressUsdtIndexState>();
  const targetedEnsureErrors = new Map<string, string>();
  const stablecoinCache = new Map<string, Promise<StablecoinRestrictionProfile | null>>();
  const classificationCache = new Map<string, Promise<ServiceClassification | null>>();
  const getLegacyTransaction = (txHash: string): Promise<unknown | null> =>
    input.deps.getTransaction(txHash).catch(() => null);
  const outerTransactionEnrichment: WhereTransactionInfoEnrichmentSummary[] = [];
  const getResolvedTransaction = async (routeEdge: ForensicRouteEdge): Promise<unknown | null> => {
    if (!input.deps.selectiveTransactionEnricher) {
      return getLegacyTransaction(routeEdge.txHash);
    }
    const indexedMovements = await input.deps.listIndexedMovementsByHashes?.([routeEdge.txHash]) ?? [routeEdge];
    const routeAddresses = [...new Set([
      routeEdge.fromAddress,
      routeEdge.toAddress,
      routeEdge.callerAddress,
      routeEdge.contractAddress
    ].filter((address): address is string => Boolean(address)))];
    const assertions = await input.deps.listActiveRouteAssertions?.({
      addresses: routeAddresses,
      txHashes: [routeEdge.txHash.toLowerCase()]
    }).catch(() => []) ?? [];
    const runWithHeartbeat: TransactionEnrichmentHeartbeatRunner = input.runWithTransactionEnrichmentHeartbeat ?? (async (task) => {
      if (!input.persistProgress) return task(async () => undefined);
      const coordinator = createForensicEnrichmentHeartbeatCoordinator({
        heartbeat: async () => { await input.persistProgress!({ jobHeartbeatAt: new Date().toISOString() }); },
        isAborted: () => input.abortSignal?.aborted === true
      });
      try {
        return await coordinator.run(task);
      } finally {
        await coordinator.dispose();
      }
    });
    const enrichment = await runWithHeartbeat((onCandidateResolved) =>
      input.deps.selectiveTransactionEnricher!.enrich({
        mode: "subject",
        routeEdges: [routeEdge],
        movements: indexedMovements,
        assertions
      }, {
        signal: input.abortSignal,
        onCandidateResolved
      })
    );
    outerTransactionEnrichment.push(enrichment);
    return input.deps.selectiveTransactionEnricher.getFullTransactionInfo(routeEdge.txHash);
  };
  const resolveEconomicContext = async (routeEdge: ForensicRouteEdge): Promise<ForensicRouteEdge> => {
    const context = extractGasFreeEdgeContext(await getResolvedTransaction(routeEdge), routeEdge);
    return context
      ? {
          ...routeEdge,
          economicRole: context.movement.role,
          economicProtocol: "tron_gasfree"
        }
      : routeEdge;
  };
  const fetchWarnings: string[] = [];
  const deterministicLegitimateServiceAddresses = new Set<string>();
  const failedSenderWindowSources = new Set<string>();
  const seedDeposit = depositEdge(input);
  const minTimestamp = input.job.windowStart;
  const maxTimestamp = input.timestamp;
  const maxTimestampForFetch = (fetchOptions: IncomingTraceFetchOptions = {}): Date =>
    fetchOptions.latestTimestamp && fetchOptions.latestTimestamp < maxTimestamp
      ? fetchOptions.latestTimestamp
      : maxTimestamp;
  const edgeCacheKey = (address: string, fetchMaxTimestamp: Date): string =>
    fetchMaxTimestamp.getTime() === maxTimestamp.getTime()
      ? address
      : `${address}:${fetchMaxTimestamp.getTime()}`;
  const canWaitForTargetedIndex = Boolean(
    input.persistProgress &&
    input.deps.getAddressUsdtIndexState &&
    input.deps.queueAddressUsdtHistory &&
    input.deps.releaseForensicCheckJobToWaiting
  );
  const targetedWaiterDeps: TargetedHistoryWaiterDeps | null = canWaitForTargetedIndex
    ? {
        getAddressUsdtIndexState: input.deps.getAddressUsdtIndexState!,
        getCoveringAddressUsdtIndexState: input.deps.getCoveringAddressUsdtIndexState,
        queueAddressUsdtHistory: input.deps.queueAddressUsdtHistory!,
        releaseForensicCheckJobToWaiting: input.deps.releaseForensicCheckJobToWaiting!,
        upsertForensicJobWait: input.deps.upsertForensicJobWait,
        markWaitingForensicJobsReadyAfterTargetedIndex: input.deps.markWaitingForensicJobsReadyAfterTargetedIndex
      }
    : null;
  const persistTargetedProgress = async (
    patch: ForensicJobProgressPatch
  ): Promise<Record<string, unknown> | void> => {
    const persisted = await input.persistProgress?.(patch);
    if (persisted) input.job.progressJson = persisted;
    return persisted;
  };
  const hasCompleteBroadTargetedHistory = async (address: string, fetchMaxTimestamp: Date): Promise<boolean> => {
    if (!targetedWaiterDeps) return false;
    const exact = await targetedWaiterDeps.getAddressUsdtIndexState({
      address,
      coverageMode: "targeted",
      targetTimestamp: fetchMaxTimestamp,
      requestKind: "broad_targeted"
    }).catch(() => null);
    if (isCompleteBroadTargetedState(exact)) return true;
    const covering = await targetedWaiterDeps.getCoveringAddressUsdtIndexState?.({
      address,
      coverageMode: "targeted",
      targetTimestamp: fetchMaxTimestamp
    }).catch(() => null) ?? null;
    return isCompleteBroadTargetedState(covering);
  };
  const ensureTargetedHistory = async (
    address: string,
    fetchMaxTimestamp: Date,
    fetchOptions: IncomingTraceFetchOptions
  ): Promise<boolean> => {
    if (!fetchOptions.latestTimestamp || !input.deps.ensureAddressUsdtHistory) return true;
    const cacheKey = edgeCacheKey(address, fetchMaxTimestamp);
    const cached = targetedEnsureCache.get(cacheKey);
    if (cached) return cached;
    const ensureAddressUsdtHistory = input.deps.ensureAddressUsdtHistory;
    const ensured = Promise.resolve()
      .then(() => ensureAddressUsdtHistory({
        jobId: input.job.id,
        claimStartedAt: input.job.startedAt!,
        address,
        coverageMode: "targeted",
        targetTimestamp: fetchMaxTimestamp,
        stopAtTimestamp: fetchMaxTimestamp,
        requestedByJobId: input.job.id,
        queuedReason: "incoming_deposit_hop"
      }))
      .then((state) => {
        targetedEnsureStates.set(targetedCoverageMapKey(address, fetchMaxTimestamp), state);
        const complete = state.coverageMode === "targeted" && state.status === "complete";
        if (!complete) {
          fetchWarnings.push(`targeted history ensure incomplete for ${address}: ${state.status}`);
        }
        return complete;
      })
      .catch((error) => {
        if (formatErrorMessage(error) === "lost_forensic_job_claim") throw error;
        const message = formatErrorMessage(error);
        targetedEnsureErrors.set(targetedCoverageMapKey(address, fetchMaxTimestamp), message);
        fetchWarnings.push(`targeted history ensure failed for ${address}: ${message}`);
        return false;
      });
    targetedEnsureCache.set(cacheKey, ensured);
    return ensured;
  };
  const getStablecoinState = (
    address: string,
    options?: { includeEventTimeline?: boolean }
  ): Promise<StablecoinRestrictionProfile | null> => {
    const key = `${address}:${options?.includeEventTimeline === true ? "timeline" : "basic"}`;
    const cached = stablecoinCache.get(key);
    if (cached) return cached;
    const fetched = input.deps.getUsdtRestrictionStatus(address, options).catch(() => null);
    stablecoinCache.set(key, fetched);
    return fetched;
  };
  const readTransfersOrEmpty = async <T>(
    label: string,
    scope: "window" | "latest",
    address: string,
    read: () => Promise<T[]>
  ): Promise<T[]> => {
    try {
      return await read();
    } catch (error) {
      if (!isRecoverableTransferFetchError(error)) throw error;
      if (scope === "window" && address === input.sender) {
        failedSenderWindowSources.add(label);
      }
      fetchWarnings.push(`${label} ${scope} transfer fetch failed for ${address}: ${formatErrorMessage(error)}`);
      return [];
    }
  };
  const fetchEdgesForAddress = async (
    address: string,
    fetchOptions: IncomingTraceFetchOptions = {}
  ): Promise<ForensicRouteEdge[]> => {
    const fetchMaxTimestamp = maxTimestampForFetch(fetchOptions);
    const fetchMinTimestamp = minTimestamp <= fetchMaxTimestamp ? minTimestamp : new Date(0);
    const cacheKey = edgeCacheKey(address, fetchMaxTimestamp);
    const isTargetedHopFetch = Boolean(fetchOptions.latestTimestamp);
    const requestedBroadTargetedDefer = isTargetedHopFetch && fetchOptions.deferBroadTargetedHistory === true;
    const completeBroadTargetedHistory = requestedBroadTargetedDefer &&
      await hasCompleteBroadTargetedHistory(address, fetchMaxTimestamp);
    if (completeBroadTargetedHistory) {
      const cached = edgeCache.get(cacheKey);
      if (cached && targetedEdgeCacheKeys.has(cacheKey)) return cached;
      const expectedAmountRaw = fetchOptions.expectedAmountRaw && /^\d+$/.test(fetchOptions.expectedAmountRaw)
        ? fetchOptions.expectedAmountRaw
        : null;
      const target = fetchOptions.targetEdge
        ? {
            ...fetchOptions.targetEdge,
            amountRaw: expectedAmountRaw ?? fetchOptions.targetEdge.amountRaw
          }
        : null;
      const local = await materializeIndexedTransferWindow({
        address,
        minTimestamp: fetchMinTimestamp,
        maxTimestamp: fetchMaxTimestamp,
        pageSize: RUNTIME_TRANSFER_LIMIT,
        maxRows: input.localIndexMaterializationMaxRows ?? DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS,
        ...(target
          ? {
              // ponytail: recompute the bounded slice per page; upgrade to incremental cashflow accounting if dense local windows make this hot.
              isSatisfied: (rows: readonly unknown[]) => buildBalanceFormingSlice({
                target,
                edges: mergeEdges([target, ...asIndexedTransfers([...rows]).map(indexedTransferToRouteEdge)]),
                minCoverageRatio: DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
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
          await persistTargetedProgress({
            jobPhase: "reading_local_index",
            targetedIndex: { phase: "reading_local_index", address, rowCount, pageReadCount }
          });
        },
        readPage: (pageAddress, options) => input.deps.listIndexedUsdtTransfersForAddress(pageAddress, {
          minTimestamp: options.minTimestamp,
          maxTimestamp: options.maxTimestamp,
          limit: options.limit,
          offset: options.offset,
          orderBy: options.orderBy,
          direction: options.direction
        })
      });
      const indexedEdges = asIndexedTransfers(local.rows).map(indexedTransferToRouteEdge);
      const edges = mergeEdges([
        ...indexedEdges,
        ...(address === input.sender && fetchMaxTimestamp.getTime() === maxTimestamp.getTime() ? [seedDeposit] : [])
      ]).filter((edge) => edge.timestamp <= fetchMaxTimestamp);
      const localComplete = local.status === "complete";
      const localLimit = local.status === "local_limit";
      edgeCache.set(cacheKey, edges);
      targetedEdgeCacheKeys.add(cacheKey);
      historyCoverageCache.set(cacheKey, {
        address,
        targetTimestamp: fetchMaxTimestamp.toISOString(),
        fetchedTransferCount: indexedEdges.length,
        fetchedPageCount: local.pageReadCount,
        oldestFetchedTransferAt: oldestRouteEdgeTimestamp(indexedEdges)?.toISOString() ?? null,
        reachedTargetHop: localComplete,
        source: "local_index",
        coverageComplete: localComplete,
        providerCapHit: false,
        budgetExhausted: localLimit,
        providerInconsistent: false,
        statusReason: null,
        localMaterializationStatus: local.status,
        localMaterializationCompletionReason: local.completionReason,
        localMaterializationKnownZero: local.knownZero,
        localMaterializationError: local.error
      });
      return edges;
    }
    const locallyMaterializedEdges = edgeCache.get(cacheKey);
    if (
      locallyMaterializedEdges &&
      targetedEdgeCacheKeys.has(cacheKey) &&
      historyCoverageCache.get(cacheKey)?.localMaterializationStatus != null
    ) {
      return locallyMaterializedEdges;
    }
    const broadTargetedHistoryDeferred = requestedBroadTargetedDefer;
    const targetedEnsureSucceeded = broadTargetedHistoryDeferred
      ? false
      : await ensureTargetedHistory(address, fetchMaxTimestamp, fetchOptions);
    const cached = edgeCache.get(cacheKey);
    if (cached && (!isTargetedHopFetch || targetedEdgeCacheKeys.has(cacheKey))) return cached;

    const indexedTransfers = await measureReportStage("fetch_window_indexed_edges", () =>
      readTransfersOrEmpty("indexed", "window", address, () =>
        input.deps.listIndexedUsdtTransfersForAddress(address, {
          minTimestamp: fetchMinTimestamp,
          maxTimestamp: fetchMaxTimestamp,
          limit: RUNTIME_TRANSFER_LIMIT,
          orderBy: "newest",
          direction: "both"
        })
      )
    );
    const liveTransfers = await measureReportStage("fetch_window_live_edges", () =>
      readTransfersOrEmpty("live", "window", address, () =>
        input.deps.listRelatedTrc20Transfers(address, {
          start: 0,
          limit: RUNTIME_TRANSFER_LIMIT,
          minTimestamp: fetchMinTimestamp.getTime(),
          endTimestamp: fetchMaxTimestamp.getTime()
        })
      )
    );
    const edges = mergeEdges([
      ...asIndexedTransfers(indexedTransfers).map(indexedTransferToRouteEdge),
      ...asRawTransfers(liveTransfers).map((transfer) => normalizeTransfer(transfer)).filter((edge): edge is ForensicRouteEdge => edge !== null),
      ...(address === input.sender && fetchMaxTimestamp.getTime() === maxTimestamp.getTime() ? [seedDeposit] : [])
    ]).filter((edge) => edge.timestamp <= fetchMaxTimestamp);
    edgeCache.set(cacheKey, edges);
    if (isTargetedHopFetch) targetedEdgeCacheKeys.add(cacheKey);
    const indexedEdges = asIndexedTransfers(indexedTransfers).map(indexedTransferToRouteEdge);
    const liveEdges = asRawTransfers(liveTransfers)
      .map((transfer) => normalizeTransfer(transfer))
      .filter((edge): edge is ForensicRouteEdge => edge !== null);
    const oldestIndexedAt = oldestRouteEdgeTimestamp(indexedEdges);
    const oldestLiveAt = oldestRouteEdgeTimestamp(liveEdges);
    const oldestFetchedAt = oldestRouteEdgeTimestamp(edges);
    const indexedMayBeTruncated = indexedEdges.length >= RUNTIME_TRANSFER_LIMIT &&
      oldestIndexedAt !== null &&
      oldestIndexedAt > fetchMinTimestamp;
    const liveMayBeTruncated = liveEdges.length >= RUNTIME_TRANSFER_LIMIT &&
      oldestLiveAt !== null &&
      oldestLiveAt > fetchMinTimestamp;
    const noTruncationSignal = !indexedMayBeTruncated && !liveMayBeTruncated;
    const oldestCombinedReachesFetchMin = oldestFetchedAt !== null && oldestFetchedAt <= fetchMinTimestamp;
    historyCoverageCache.set(cacheKey, {
      address,
      targetTimestamp: fetchMaxTimestamp.toISOString(),
      fetchedTransferCount: edges.length,
      fetchedPageCount: 2,
      oldestFetchedTransferAt: oldestFetchedAt?.toISOString() ?? null,
      reachedTargetHop: targetedEnsureSucceeded && noTruncationSignal && (
        edges.length === 0 ||
        oldestCombinedReachesFetchMin ||
        (indexedEdges.length < RUNTIME_TRANSFER_LIMIT && liveEdges.length < RUNTIME_TRANSFER_LIMIT)
      ),
      source: historyCoverageSource({
        indexedEdgeCount: indexedEdges.length,
        liveEdgeCount: liveEdges.length
      })
    });
    return edges;
  };

  const getHistoryCoverageForAddress = async (
    address: string,
    fetchOptions: IncomingTraceFetchOptions = {}
  ): Promise<MoneyOriginTraceHistoryCoverage> => {
    const fetchMaxTimestamp = maxTimestampForFetch(fetchOptions);
    const cacheKey = edgeCacheKey(address, fetchMaxTimestamp);
    const cached = historyCoverageCache.get(cacheKey);
    if (cached) return cached;
    await fetchEdgesForAddress(address, fetchOptions);
    return historyCoverageCache.get(cacheKey) ?? {
      address,
      targetTimestamp: fetchMaxTimestamp.toISOString(),
      fetchedTransferCount: 0,
      fetchedPageCount: 0,
      oldestFetchedTransferAt: null,
      reachedTargetHop: false,
      source: "unknown"
    };
  };

  const fetchLatestEdgesForAddress = async (address: string, limit: number): Promise<ForensicRouteEdge[]> => {
    const cacheKey = `${address}:${limit}`;
    const cached = latestEdgeCache.get(cacheKey);
    if (cached) return cached;

    const indexedTransfers = await measureReportStage("fetch_latest_indexed_edges", () =>
      readTransfersOrEmpty("indexed", "latest", address, () =>
        input.deps.listIndexedUsdtTransfersForAddress(address, {
          minTimestamp: new Date(0),
          maxTimestamp,
          limit,
          orderBy: "newest",
          direction: "both"
        })
      )
    );
    const liveTransfers = await measureReportStage("fetch_latest_live_edges", () =>
      readTransfersOrEmpty("live", "latest", address, () =>
        input.deps.listRelatedTrc20Transfers(address, {
          start: 0,
          limit,
          endTimestamp: maxTimestamp.getTime()
        })
      )
    );
    const edges = mergeEdges([
      ...asIndexedTransfers(indexedTransfers).map(indexedTransferToRouteEdge),
      ...asRawTransfers(liveTransfers).map((transfer) => normalizeTransfer(transfer)).filter((edge): edge is ForensicRouteEdge => edge !== null),
      ...(address === input.sender ? [seedDeposit] : [])
    ]).filter((edge) => edge.timestamp <= maxTimestamp);
    latestEdgeCache.set(cacheKey, edges);
    return edges;
  };

  const getClassificationForAddress = async (address: string): Promise<ServiceClassification | null> => {
    const cached = classificationCache.get(address);
    if (cached) return cached;
    const fetched = (async () => {
      const base = await input.deps.getClassificationForAddress(address).catch(() => null);
      if (base?.category !== "unknown_contract" || !input.deps.enrichContractClassification) return base;
      const enriched = await input.deps.enrichContractClassification(address).catch(() => null);
      const enrichedClassification = enriched?.classification ?? null;
      if (enrichedClassification && (
        enrichedClassification.category === "service" ||
        enrichedClassification.category === "protocol" ||
        enrichedClassification.category === "hot_wallet"
      )) {
        deterministicLegitimateServiceAddresses.add(address);
        return enrichedClassification;
      }
      return enriched?.classification ?? base;
    })();
    classificationCache.set(address, fetched);
    return fetched;
  };

  const senderStablecoinState = await measureReportStage("sender_stablecoin_state", () =>
    getStablecoinState(input.sender)
  );
  const depositSeed = incomingSeedTransfer(input);
  const depositEconomicContext = extractGasFreeEdgeContext(
    await getResolvedTransaction(seedDeposit),
    seedDeposit
  );
  const forceTransactionSeed = depositEconomicContext?.movement.role === "service_fee";
  const resolvedDepositSeed: BalanceFormingTransfer = depositEconomicContext
    ? {
        ...depositSeed,
        economicRole: depositEconomicContext.movement.role,
        economicProtocol: "tron_gasfree"
      }
    : depositSeed;
  let senderEdges = forceTransactionSeed
    ? [seedDeposit]
    : await measureReportStage("fetch_sender_edges", () => fetchEdgesForAddress(input.sender));
  const resolvedFundingSelection = forceTransactionSeed
    ? null
    : await selectResolvedIncomingDepositFundingCandidates({
        sender: input.sender,
        watchedWallet: input.watchedWallet,
        depositTxHash: input.depositTxHash,
        depositAmountRaw: input.amountRaw,
        depositTimestamp: input.timestamp,
        edges: senderEdges,
        resolveEconomicContext
      });
  if (resolvedFundingSelection) senderEdges = resolvedFundingSelection.edges;
  edgeCache.set(edgeCacheKey(input.sender, maxTimestamp), senderEdges);
  const fundingSelection = forceTransactionSeed
    ? {
        candidates: [],
        coverageRaw: input.amountRaw,
        coverageRatio: 1,
        amountContinuity: "strong" as const
      }
    : resolvedFundingSelection!.selection;
  const seedTransfers = fundingSelection.candidates.length > 0
    ? fundingCandidateSeedTransfers({
        candidates: fundingSelection.candidates,
        depositAmountRaw: input.amountRaw
      })
    : [resolvedDepositSeed];
  const whereSubjectAddress = fundingSelection.candidates.length > 0
    ? input.sender
    : input.watchedWallet;
  const maxDepth = isLargeDepositRaw(input.amountRaw)
    ? RUNTIME_PROVENANCE_LARGE_DEPOSIT_DEPTH
    : RUNTIME_PROVENANCE_STANDARD_DEPTH;
  const requestCandidateWindows = targetedWaiterDeps
    ? (requests: WhereCandidateWindowRequest[]): Promise<true> => ensureCandidateWindowsOrWait({
        jobId: input.job.id,
        claimStartedAt: input.job.startedAt!,
        requests: requests.slice(0, 20),
        queuedReason: "incoming_candidate_window",
        requiredFor: "incoming_hop",
        progressJson: input.job.progressJson,
        deps: targetedWaiterDeps,
        persistProgress: persistTargetedProgress
      })
    : undefined;
  const ensureBroadTargetedHistory = targetedWaiterDeps
    ? (target: {
        address: string;
        targetTimestamp: Date;
      }): Promise<true> => ensureTargetedHistoryOrWait({
        jobId: input.job.id,
        claimStartedAt: input.job.startedAt!,
        address: target.address,
        targetTimestamp: target.targetTimestamp,
        queuedReason: "incoming_deposit_hop",
        requiredFor: "incoming_hop",
        progressJson: input.job.progressJson,
        deps: targetedWaiterDeps,
        persistProgress: persistTargetedProgress
      })
        .then(() => true as const)
        .catch(async (error) => {
          if (!(error instanceof TargetedHistoryTerminalError)) throw error;
          const cacheKey = edgeCacheKey(target.address, target.targetTimestamp);
          edgeCache.delete(cacheKey);
          historyCoverageCache.delete(cacheKey);
          targetedEdgeCacheKeys.delete(cacheKey);
          await fetchEdgesForAddress(target.address, { latestTimestamp: target.targetTimestamp });
          return true as const;
        })
    : undefined;
  const whereReport = await measureReportStage("run_where_is_money", () =>
    runWhereIsMoneyCheck({
      getTrc20Balance: async (address, tokenContractAddress) => {
        if (tokenContractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
        const state = await getStablecoinState(address);
        return state?.balanceRaw ?? null;
      },
      fetchEdgesForAddress,
      getHistoryCoverageForAddress,
      fetchLatestEdgesForAddress,
      getLabelsForAddress: async (address) => {
        if (address === input.sender) return [];
        const addressLabels = await input.deps.getLabelsForAddress(address);
        return addressLabels.filter((label) => label.address === address);
      },
      getClassificationForAddress,
      // The transaction seed subject is the watched wallet; the fast risk needed for this report is the sender risk.
      getFastWalletRisk: async () => fastSenderRisk,
      getTransaction: getLegacyTransaction,
      selectiveTransactionEnricher: input.deps.selectiveTransactionEnricher,
      listActiveRouteAssertions: input.deps.listActiveRouteAssertions,
      listIndexedMovementsByHashes: input.deps.listIndexedMovementsByHashes,
      listTrc20ApprovalChanges: input.deps.listTrc20ApprovalChanges,
      getUsdtRestrictionStatus: async (address, options) => {
        const state = await getStablecoinState(address, options);
        if (!state) throw new Error(`USDT restriction status unavailable for ${address}`);
        return state;
      },
      getContractIntelligenceProfile: input.deps.getContractIntelligenceProfile,
      requestCandidateWindows,
      ensureBroadTargetedHistory,
      crossChainDiscoveryProvider: input.deps.crossChainDiscoveryProvider,
      crossChainContinuationProviders: input.deps.crossChainContinuationProviders,
      evmEvidenceProvider: input.deps.evmEvidenceProvider,
    }, {
      mode: "transaction_check",
      subjectAddress: whereSubjectAddress,
      requestedAmountRaw: input.amountRaw,
      seedTransfers,
      windowStart: input.job.windowStart,
      windowEnd: maxTimestamp,
      maxDepth,
      minAmountPreservationRatio: 0.05,
      recentFallbackMinTransferCount: RUNTIME_RECENT_FALLBACK_MIN_TRANSFER_COUNT,
      recentFallbackTransferLimit: RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT,
      runWithTransactionEnrichmentHeartbeat: input.runWithTransactionEnrichmentHeartbeat,
      abortSignal: input.abortSignal,
      crossChainStage2Enabled: input.deps.crossChainStage2Enabled,
      crossChainMaxProviderCalls: input.deps.crossChainMaxProviderCalls
    })
  );
  const targetedCoverage = buildIncomingTargetedCoverageSummary({
    whereReport,
    deposit: seedDeposit,
    ensureStates: targetedEnsureStates,
    ensureErrors: targetedEnsureErrors
  });

  const fundingBundlesByTxHash = await measureReportStage("build_funding_bundles", () =>
    buildFundingBundlesByTxHash({
      whereReport,
      fetchEdgesForAddress,
      getLabelsForAddress: input.deps.getLabelsForAddress,
      getClassificationForAddress,
      resolveEconomicContext
    })
  );
  const walletExposureProfile = forceTransactionSeed
    ? undefined
    : await measureReportStage("build_wallet_exposure_profile", () =>
        buildIncomingWalletExposureProfile({
          sender: input.sender,
          watchedWallet: input.watchedWallet,
          windowStart: minTimestamp,
          windowEnd: maxTimestamp,
          edges: senderEdges,
          getClassificationForAddress: async (address) => {
            const classification = await getClassificationForAddress(address);
            return classification;
          }
        })
      );
  const transactionInfoEnrichment = mergeTransactionInfoEnrichment([
    ...outerTransactionEnrichment,
    ...(whereReport.transactionInfoEnrichment ? [whereReport.transactionInfoEnrichment] : [])
  ]);
  const enrichmentIncomplete = transactionInfoEnrichment?.coverageStatus === "coverage_incomplete";
  const effectiveWhereReport: WhereIsMoneyReport = enrichmentIncomplete
    ? {
        ...whereReport,
        transactionInfoEnrichment,
        coverage: {
          ...whereReport.coverage,
          partial: true,
          notes: uniqueStrings([
            ...whereReport.coverage.notes,
            "Transaction evidence incomplete: at least one incoming-deposit outer route candidate lacks final evidence."
          ])
        }
      }
    : { ...whereReport, ...(transactionInfoEnrichment ? { transactionInfoEnrichment } : {}) };
  const reportFromWhere = incomingReportFromWhere({
    whereReport: effectiveWhereReport,
    fastSenderRisk,
    senderStablecoinState,
    deposit: seedDeposit,
    fundingBundlesByTxHash,
    walletExposureProfile,
    targetedHistoryCoverage: targetedCoverage.summary,
    targetedCoverageBlock: targetedCoverage.block,
    receiverDeepReport: input.receiverDeepReport,
    legitimateServiceAddresses: deterministicLegitimateServiceAddresses
  });
  const fundingCoverage = {
    depositFundingCoverageRatio: fundingSelection.coverageRatio,
    cleanSourceCoverageRatio: cleanIncomingDepositCoverage(whereReport, seedDeposit),
    exactContinuityCoverageRatio: reportFromWhere.originCoverage
  };
  const report: IncomingDepositRiskReport = {
    ...reportFromWhere,
    fundingCoverage,
    corridorSummary: incomingCorridorSummary(reportFromWhere.originPaths),
    ...(transactionInfoEnrichment
      ? { transactionInfoEnrichment }
      : {})
  };
  const senderRole = await measureReportStage("infer_sender_role", () =>
    inferIncomingDepositSenderRole({
      sender: input.sender,
      senderEdges,
      originPaths: report.originPaths,
      stablecoinState: senderStablecoinState,
      getClassificationForAddress
    })
  );
  const bothSenderSourcesFailed =
    failedSenderWindowSources.has("indexed") &&
    failedSenderWindowSources.has("live");
  return measureReportStage("assemble", async () => {
    const assembled: IncomingDepositRiskReport = {
      ...report,
      dataQuality: bothSenderSourcesFailed ? "low" : report.dataQuality,
      senderRole: incomingSenderRoleFromCoverage({
        inferredRole: senderRole ?? report.senderRole,
        cleanSourceCoverageRatio: report.fundingCoverage.cleanSourceCoverageRatio
      }),
      reasons: incomingReasonsFromCoverage({
        reasons: report.reasons,
        cleanSourceCoverageRatio: report.fundingCoverage.cleanSourceCoverageRatio
      }),
      warnings: uniqueStrings([
        ...report.warnings,
        ...fetchWarnings
      ])
    };
    return {
      ...assembled,
      coverageV2: buildIncomingCoverageV2({
        deposit: {
          txHash: input.depositTxHash,
          watchedWallet: input.watchedWallet,
          sender: input.sender,
          amountRaw: input.amountRaw,
          timestamp: input.timestamp
        },
        report: assembled
      })
    };
  });
}

function riskLevelFromIncoming(report: IncomingDepositRiskReport): RiskLevel {
  if (report.riskBand === "CRITICAL") return "CRITICAL";
  if (report.riskBand === "HIGH") return "HIGH";
  if (report.riskBand === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function activeIncomingDepositReport(report: IncomingDepositRiskReport): IncomingDepositRiskReport {
  const legacyLlmPresent = report.contractVerdicts.length > 0 ||
    report.hardBadEvidence.some((evidence) => evidence.kind === "llm_contract_suspicion") ||
    report.sourcePolicyEvidence?.some((evidence) => evidence.proofLevel === "llm_assisted_suspicion") === true;
  if (!legacyLlmPresent) return report;

  return {
    decision: "NO_FINAL_DECISION",
    scoreValid: false,
    scoreBlockedReason: "insufficient_coverage",
    technicalStatus: "completed",
    depositRiskScore: null,
    observedContextScore: 0,
    riskBand: null,
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 0,
    fundingCoverage: {
      depositFundingCoverageRatio: 0,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 0
    },
    corridorSummary: null,
    provenanceConfidence: 0,
    dataQuality: "low",
    senderRole: null,
    targetedHistoryCoverage: undefined,
    coverageV2: undefined,
    sourcePolicyEvidence: [],
    hardBadEvidence: [],
    contractVerdicts: [],
    contractDrivenReceiverProfile: undefined,
    contractDrivenTransferProfiles: undefined,
    contractDrivenSubjectAddress: undefined,
    freshBundleExposure: undefined,
    walletExposureProfile: undefined,
    sourceBundleExposure: undefined,
    subjectExposureProfile: undefined,
    unifiedRiskSummary: undefined,
    reasons: [],
    warnings: [],
    transactionInfoEnrichment: report.transactionInfoEnrichment
  };
}

function riskReportFromIncoming(
  subjectAddress: string,
  report: IncomingDepositRiskReport,
  depositRiskScore: number
): RiskReport {
  return {
    subjectAddress,
    score: depositRiskScore,
    level: riskLevelFromIncoming(report),
    reasons: report.reasons.map((reason, index) => ({
      code: `incoming_deposit_reason_${index + 1}`,
      message: reason,
      scoreImpact: 0,
      source: "incoming_deposit",
      confidence: "medium",
      severity: report.decision === "DECLINE" ? "high" : "low"
    }))
  };
}

function shouldSend(alertMode: WalletAlertMode, report: IncomingDepositRiskReport): boolean {
  if (alertMode === "paused") return false;
  if (alertMode === "realtime") return true;
  if (alertMode === "risk_only") return report.decision === "DECLINE";
  if (alertMode === "digest") return false;
  return true;
}

function warnSlowIncomingDepositStages(input: {
  logger: Logger;
  job: ForensicCheckJob;
  timing: IncomingDepositTimingRecorder;
}): void {
  for (const stage of input.timing.topStages(20)) {
    if (stage.durationMs < INCOMING_DEPOSIT_SLOW_STAGE_THRESHOLD_MS) continue;
    try {
      input.logger.warn("incoming_deposit_stage_slow", {
        job_id: input.job.id,
        stage: stage.name,
        duration_ms: stage.durationMs
      });
    } catch {
      // keep job path unaffected by observability failures
    }
  }
}

function safeLoggerInfo(logger: Logger, event: string, fields: Record<string, unknown>): void {
  try {
    logger.info(event, fields);
  } catch {
    // observability only
  }
}

function safeLoggerWarn(logger: Logger, event: string, fields: Record<string, unknown>): void {
  try {
    logger.warn(event, fields);
  } catch {
    // observability only
  }
}

function replyMarkup(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Incoming Telegram reply markup must be an object");
  }
  return value as Record<string, unknown>;
}

async function buildIncomingFailureDelivery(
  deps: RunSingleIncomingDepositJobCycleDeps,
  job: ForensicCheckJob,
  error: string
): Promise<ForensicTelegramDeliveryV1 | null> {
  if (!job.chatId || !deps.buildJobFailurePayload) return null;
  const payload = await deps.buildJobFailurePayload(job, error);
  if (payload === null) return null;
  if (payload.chatId !== job.chatId) {
    throw new TypeError("Incoming failure payload chat does not match the job owner");
  }
  return createPendingForensicTelegramDelivery({
    jobId: job.id,
    kind: "incoming_deposit_check",
    payload,
    effect: null
  });
}

async function indexWalletIntelligenceBestEffort(
  deps: RunSingleIncomingDepositJobCycleDeps,
  job: ForensicCheckJob,
  input: { progressJson: Record<string, unknown>; resultJson: Record<string, unknown>; status: "completed" | "partial" }
): Promise<void> {
  if (!deps.indexWalletIntelligenceJob) return;
  try {
    await deps.indexWalletIntelligenceJob({ job, ...input });
  } catch (error) {
    safeLoggerWarn(deps.logger ?? defaultLogger, "wallet_intelligence_index_failed", {
      job_id: job.id,
      kind: job.kind,
      subject_address: job.subjectAddress,
      error: formatErrorMessage(error)
    });
  }
}

export async function runSingleIncomingDepositJobCycle(
  deps: RunSingleIncomingDepositJobCycleDeps
): Promise<boolean> {
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const timing = createIncomingDepositTiming(deps.timingClock);
  const job = await timing.measure("claim_job", () => deps.claimNextForensicCheckJob());
  if (!job) return false;
  if (!job.startedAt) throw new Error("claimed_forensic_job_missing_started_at");
  const abortController = new AbortController();
  let claimLostLogged = false;
  const logClaimLostOnce = (stage: string): void => {
    if (!abortController.signal.aborted) abortController.abort();
    if (claimLostLogged) return;
    claimLostLogged = true;
    safeLoggerWarn(logger, "forensic_job_claim_lost", {
      job_id: job.id,
      job_kind: job.kind,
      stage,
      error: "lost_forensic_job_claim"
    });
  };

  const processingStartedAt = validDate(now());
  const queueWaitMs = msBetween(validDate(job.startedAt), validDate(job.createdAt));

  const depositTxHash = stringField(job.progressJson.depositTxHash);
  const watchedWallet = stringField(job.progressJson.watchedWallet);
  const watchedWalletId = stringField(job.progressJson.watchedWalletId);
  const sender = stringField(job.progressJson.sender);
  const amountRaw = stringField(job.progressJson.amountRaw);
  const timestampText = stringField(job.progressJson.timestamp);
  const telegramUserId = stringField(job.progressJson.telegramUserId);
  const alertMode = (stringField(job.progressJson.alertMode) ?? "realtime") as WalletAlertMode;
  const locale = normalizeBotLocale(job.progressJson.locale);
  const depositTimestamp = validDate(timestampText ? new Date(timestampText) : null);
  const depositAgeAtStartMs = msBetween(processingStartedAt, depositTimestamp);

  let currentProgress = job.progressJson;
  const persistProgress = async (
    patch: ForensicJobProgressPatch,
    stageName?: string
  ): Promise<void> => {
    currentProgress = mergeForensicJobProgress(currentProgress, patch);
    job.progressJson = currentProgress;
    const persist = async (): Promise<void> => {
      const updated = await deps.updateForensicCheckJobProgress?.({
        id: job.id,
        claimStartedAt: job.startedAt!,
        progressJson: currentProgress,
        lastError: null
      });
      if (updated === false) {
        if (!abortController.signal.aborted) abortController.abort();
        throw new Error("lost_forensic_job_claim");
      }
    };
    if (stageName) {
      await timing.measure(stageName, persist);
      return;
    }
    await persist();
  };
  const persistPerformanceTiming = async (): Promise<IncomingDepositTimingSummary> => {
    const summary = timing.summary({
      queueWaitMs,
      depositAgeAtStartMs
    });
    currentProgress = mergeForensicJobProgress(currentProgress, {
      performanceTiming: summary as unknown as Record<string, unknown>
    });
    job.progressJson = currentProgress;
    try {
      const updated = await deps.updateForensicCheckJobProgress?.({
        id: job.id,
        claimStartedAt: job.startedAt!,
        progressJson: currentProgress,
        lastError: null
      });
      if (updated === false) {
        if (!abortController.signal.aborted) abortController.abort();
        throw new Error("lost_forensic_job_claim");
      }
    } catch (error) {
      if (formatErrorMessage(error) === "lost_forensic_job_claim") throw error;
      safeLoggerWarn(logger, "incoming_deposit_timing_persist_failed", {
        job_id: job.id,
        error: formatErrorMessage(error)
      });
    }
    return summary;
  };
  const logTiming = (status: "completed" | "failed"): void => {
    warnSlowIncomingDepositStages({ logger, job, timing });
    const summary = timing.summary({
      queueWaitMs,
      depositAgeAtStartMs
    });
    safeLoggerInfo(logger, "incoming_deposit_job_timing", {
      status,
      queue_wait_ms: summary.queueWaitMs,
      deposit_age_at_start_ms: summary.depositAgeAtStartMs,
      total_run_ms: summary.totalRunMs,
      top_stages: timing.topStages(5)
    });
  };

  if (!depositTxHash || !watchedWallet || !watchedWalletId || !sender || !amountRaw
    || sender !== job.subjectAddress || !timestampText || !telegramUserId
    || !job.chatId || telegramUserId !== job.chatId) {
    try {
      const error = "incoming_deposit_check job is missing required progress_json fields";
      const failureDelivery = await buildIncomingFailureDelivery(deps, job, error);
      await persistPerformanceTiming();
      const completed = await timing.measure("fail_job", () => deps.completeForensicCheckJob({
        id: job.id,
        claimStartedAt: job.startedAt!,
        status: "failed",
        progressJson: failureDelivery
          ? { ...currentProgress, telegramDelivery: failureDelivery }
          : currentProgress,
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: error
      }));
      if (!completed) {
        logClaimLostOnce("invalid_job_failure_completion");
        return true;
      }
      if (depositTxHash && watchedWalletId) {
        try {
          await timing.measure("mark_alert_failed", () =>
            deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error })
          );
        } catch (markError) {
          safeLoggerWarn(logger, "incoming_deposit_mark_alert_failed", {
            job_id: job.id,
            error: formatErrorMessage(markError)
          });
        }
      }
      logTiming("failed");
      return true;
    } catch (error) {
      if (formatErrorMessage(error) === "lost_forensic_job_claim") {
        logClaimLostOnce("invalid_job");
        return true;
      }
      throw error;
    }
  }

  const enrichmentHeartbeat = createForensicEnrichmentHeartbeatCoordinator({
    heartbeat: () => persistProgress({ jobHeartbeatAt: now().toISOString() }),
    intervalMs: deps.transactionEnrichmentHeartbeatIntervalMs,
    now: () => now().getTime(),
    isAborted: () => abortController.signal.aborted
  });
  const runWithTransactionEnrichmentHeartbeat: TransactionEnrichmentHeartbeatRunner = (task) =>
    enrichmentHeartbeat.run(task);
  try {
    const timestamp = depositTimestamp ?? new Date(timestampText);
    await persistProgress({ jobPhase: "incoming_deposit_trace" }, "persist_phase_incoming_deposit_trace");
    const report = await timing.measure("build_report", () => deps.buildReport({
      job,
      depositTxHash,
      watchedWallet,
      sender,
      amountRaw,
      timestamp,
      timing,
      persistProgress,
      runWithTransactionEnrichmentHeartbeat,
      abortSignal: abortController.signal
    }));
    const activeReport = activeIncomingDepositReport(report);
    if (activeReport.depositRiskScore !== null) {
      const riskReport = riskReportFromIncoming(sender, activeReport, activeReport.depositRiskScore);
      await persistProgress({ jobPhase: "risk_recording" }, "persist_phase_risk_recording");
      const recorded = await timing.measure("record_risk", () =>
        deps.recordObservedTransactionRisk({
          jobId: job.id,
          claimStartedAt: job.startedAt!,
          txHash: depositTxHash,
          watchedWalletId,
          report: riskReport
        })
      );
      if (!recorded) {
        if (!abortController.signal.aborted) abortController.abort();
        throw new Error("lost_forensic_job_claim");
      }
    }

    let telegramDelivery: ForensicTelegramDeliveryV1 | null = null;
    if (shouldSend(alertMode, activeReport)) {
      let addressPoisoningWarningActive = false;
      try {
        addressPoisoningWarningActive = await deps.hasUndismissedAddressPoisoningCandidateForIncoming({
          watchedWalletId,
          incomingTxHash: depositTxHash
        });
      } catch (error) {
        safeLoggerWarn(logger, "incoming_deposit_poisoning_warning_lookup_failed", {
          job_id: job.id,
          deposit_tx_hash: depositTxHash,
          watched_wallet_id: watchedWalletId,
          error: formatErrorMessage(error)
        });
      }
      const message = await timing.measure("format_alert", async () => deps.formatIncomingDepositRiskAlert({
        jobId: job.id,
        amount: stringField(job.progressJson.amount) ?? amountRaw,
        watchedWallet,
        sender,
        txHash: depositTxHash,
        timestamp,
        locale,
        addressPoisoningWarningActive,
        report: activeReport
      }));
      telegramDelivery = createPendingForensicTelegramDelivery({
        jobId: job.id,
        kind: "incoming_deposit_check",
        payload: {
          version: "telegram-message-payload-v1",
          chatId: job.chatId,
          text: message.text,
          parseMode: message.parseMode,
          replyMarkup: replyMarkup(message.replyMarkup)
        },
        effect: {
          kind: "incoming_user_alert",
          watchedWalletId,
          incomingTxHash: depositTxHash
        }
      });
    }
    await persistProgress({ jobPhase: "completing" }, "persist_phase_completing");
    await persistPerformanceTiming();
    const completion = {
      id: job.id,
      claimStartedAt: job.startedAt!,
      status: "completed",
      progressJson: telegramDelivery
        ? { ...currentProgress, telegramDelivery }
        : currentProgress,
      resultJson: {
        ...(activeReport as unknown as Record<string, unknown>),
        scoringPolicyVersion: SCORING_SIGNAL_MATRIX_POLICY_VERSION
      },
      rawEvidenceIds: [...new Set([
        ...job.rawEvidenceIds,
        ...(activeReport.transactionInfoEnrichment?.evidenceIds ?? [])
      ])],
      observationIds: [],
      lastError: null
    } satisfies CompleteJobInput;
    const completed = await timing.measure("complete_job", () => deps.completeForensicCheckJob(completion));
    if (!completed) {
      logClaimLostOnce("terminal_completion");
      return true;
    }
    if (!telegramDelivery) {
      try {
        await timing.measure("mark_alert_sent", () =>
          deps.markUserAlertSent({ txHash: depositTxHash, watchedWalletId })
        );
      } catch (markError) {
        safeLoggerWarn(logger, "incoming_deposit_mark_alert_sent_failed", {
          job_id: job.id,
          error: formatErrorMessage(markError)
        });
      }
    }
    await indexWalletIntelligenceBestEffort(deps, job, {
      progressJson: completion.progressJson,
      resultJson: completion.resultJson,
      status: completion.status
    });
    logTiming("completed");
    return true;
  } catch (error) {
    if (formatErrorMessage(error) === "lost_forensic_job_claim") {
      logClaimLostOnce("claimed_job_cycle");
      return true;
    }
    if (formatErrorMessage(error) === "selective_transaction_enrichment_aborted") {
      return true;
    }
    if (error instanceof TargetedHistoryWaitingForIndex) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    const failureDelivery = await buildIncomingFailureDelivery(deps, job, message);
    try {
      await persistPerformanceTiming();
    } catch (persistError) {
      if (formatErrorMessage(persistError) === "lost_forensic_job_claim") {
        logClaimLostOnce("failure_timing");
        return true;
      }
      throw persistError;
    }
    const completed = await timing.measure("fail_job", () => deps.completeForensicCheckJob({
      id: job.id,
      claimStartedAt: job.startedAt!,
      status: "failed",
      progressJson: failureDelivery
        ? { ...currentProgress, telegramDelivery: failureDelivery }
        : currentProgress,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    }));
    if (!completed) {
      logClaimLostOnce("failure_completion");
      return true;
    }
    try {
      await timing.measure("mark_alert_failed", () =>
        deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error: message })
      );
    } catch (markError) {
      safeLoggerWarn(logger, "incoming_deposit_mark_alert_failed", {
        job_id: job.id,
        error: formatErrorMessage(markError)
      });
    }
    logTiming("failed");
    return true;
  } finally {
    await enrichmentHeartbeat.dispose();
  }
}

export const INCOMING_DEPOSIT_JOB_KIND: ForensicCheckJobKind = "incoming_deposit_check";
