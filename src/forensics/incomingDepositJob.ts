import type { ForensicCheckJob, ForensicCheckJobKind } from "../storage/repositories";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { evaluateAddressRisk } from "../risk/evaluation";
import {
  calculateUnifiedIncomingDepositRisk,
  incomingRiskBandFromUnifiedScore,
  incomingUnifiedRiskSummary
} from "../risk/unifiedIncomingDepositRisk";
import { runWhereIsMoneyCheck } from "../check/whereIsMoneyCheck";
import { normalizeBotLocale } from "../bot/i18n";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import { createUnavailableContractLlmVerdict, hashContractAnalysisCaseFile } from "./contractLlmVerdict";
import type { ContractEnrichmentResult } from "./contractEnrichment";
import type { CrossChainDiscoveryProvider } from "./crossChainProviders";
import type { ChainContinuationProvider } from "./crossChainContinuationTypes";
import type { EvmEvidenceProvider } from "./evmExplorerClient";
import { mergeForensicJobProgress, type ForensicJobProgressPatch } from "./forensicJobProgress";
import type {
  AddressLabel,
  BalanceFormingTransfer,
  BotLocale,
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  ForensicRouteEdge,
  IncomingDepositCorridorSummary,
  IncomingDepositFundingBundle,
  IncomingDepositOriginPath,
  IncomingDepositRiskReport,
  IncomingWalletExposureProfile,
  IndexedTronUsdtTransfer,
  MoneyOriginPath,
  RiskLevel,
  RiskReport,
  ServiceClassification,
  SourceBundleExposureFinding,
  SourceBundleExposureSourceKind,
  SourcePolicyEvidence,
  StablecoinRestrictionProfile,
  SubjectExposureProfile,
  WalletAlertMode,
  WalletRole,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyReport
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
import { indexedTransferToRouteEdge } from "./localTronUsdtIndex";
import { selectedMoneyOriginPathShare } from "./moneyOriginAttribution";
import { traceMoneyOriginPath } from "./moneyOriginTrace";
import { normalizeTransfer } from "./routeSearch";
import { buildServiceExposureProfile } from "./serviceExposure";
import { buildSourceBundleExposure } from "./sourceBundleExposure";
import { buildWalletRoleProfile } from "./walletRoleClassifier";

type CompleteJobInput = {
  id: string;
  status: "completed" | "partial" | "failed";
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

type IncomingDepositRiskReportBase = Omit<IncomingDepositRiskReport, "fundingCoverage" | "corridorSummary">;

export type IncomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress(
    address: string,
    options: {
      minTimestamp?: Date;
      maxTimestamp?: Date;
      limit: number;
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
  getUsdtRestrictionStatus(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile | null>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
  crossChainDiscoveryProvider?: CrossChainDiscoveryProvider;
  crossChainContinuationProviders?: ChainContinuationProvider[];
  evmEvidenceProvider?: EvmEvidenceProvider;
  crossChainStage2Enabled?: boolean;
  crossChainMaxProviderCalls?: number;
};

export type BuildIncomingDepositReportInput = {
  deps: IncomingDepositRuntimeDeps;
  job: ForensicCheckJob;
  depositTxHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  timestamp: Date;
};

export type RunSingleIncomingDepositJobCycleDeps = {
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: CompleteJobInput): Promise<boolean>;
  updateForensicCheckJobProgress?(input: {
    id: string;
    progressJson: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<boolean>;
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  recordObservedTransactionRisk(input: { txHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  sendUserAlert(
    telegramUserId: string,
    message: string,
    options?: { parse_mode?: "HTML"; reply_markup?: unknown }
  ): Promise<void>;
  formatIncomingDepositRiskAlert(input: {
    jobId: string;
    amount: string;
    watchedWallet: string;
    sender: string;
    txHash: string;
    timestamp?: Date | null;
    locale?: BotLocale;
    report: IncomingDepositRiskReport;
  }): { text: string; parseMode: "HTML"; replyMarkup?: unknown };
  buildReport(input: {
    job: ForensicCheckJob;
    depositTxHash: string;
    watchedWallet: string;
    sender: string;
    amountRaw: string;
    timestamp: Date;
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
const RUNTIME_CONTRACT_TRANSACTION_INFO_MIN_INTERVAL_MS = 15_000;

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
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
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
    txHash: candidate.edge.txHash,
    fromAddress: candidate.edge.fromAddress,
    toAddress: candidate.edge.toAddress,
    amountRaw: candidate.usableAmountRaw,
    timestamp: candidate.edge.timestamp.toISOString(),
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
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
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
  const fetchEdgesForExpansion = async (address: string): Promise<ForensicRouteEdge[]> => {
    fetchedAddresses.add(address);
    return input.fetchEdgesForAddress(address);
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
      getClassificationForAddress: input.getClassificationForAddress
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
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
}): Promise<Map<string, IncomingDepositFundingBundle>> {
  const bundlesByTxHash = new Map<string, IncomingDepositFundingBundle>();
  const inspectedTxHashes = new Set<string>();

  const inspectTarget = async (target: ForensicRouteEdge): Promise<void> => {
    if (inspectedTxHashes.has(target.txHash)) return;

    const amountRaw = rawAmountBigInt(target.amountRaw);
    if (amountRaw === null || amountRaw < LARGE_INTERMEDIATE_TRANSFER_RAW) return;
    inspectedTxHashes.add(target.txHash);

    const edges = await input.fetchEdgesForAddress(target.fromAddress);
    const bundle = buildFundingBundleForOutbound({
      target,
      edges,
      lookbackWindowMs: LARGE_INTERMEDIATE_TRANSFER_BUNDLE_LOOKBACK_MS,
      minCoverageRatio: LARGE_INTERMEDIATE_TRANSFER_BUNDLE_MIN_COVERAGE
    });
    if (!bundle) return;

    const deepExpansion = await buildFundingBundleDeepExpansion({
      bundle,
      edgesForTargetFromAddress: edges,
      fetchEdgesForAddress: input.fetchEdgesForAddress,
      getLabelsForAddress: input.getLabelsForAddress,
      getClassificationForAddress: input.getClassificationForAddress
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
    verdict: path.verdict === "DECLINE" && path.riskScoreContribution >= 60 ? "DECLINE" : "ACCEPTABLE",
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

function deterministicLegitimateServiceAddresses(
  verdicts: ContractLlmVerdictSummary[] | null | undefined
): Set<string> {
  return new Set(
    (verdicts ?? [])
      .filter((verdict) =>
        verdict.source === "deterministic" &&
        verdict.verdict === "legitimate_service" &&
        verdict.decisionRecommendation === "ACCEPTABLE" &&
        Boolean(verdict.contractAddress)
      )
      .map((verdict) => verdict.contractAddress as string)
  );
}

function incomingPathTouchesAddress(path: IncomingDepositOriginPath, address: string): boolean {
  return path.pathAddresses.includes(address) ||
    path.steps.some((step) => step.fromAddress === address || step.toAddress === address);
}

function freshExposurePathsWithLegitimateServices(input: {
  originPaths: IncomingDepositOriginPath[];
  contractVerdicts: ContractLlmVerdictSummary[] | null | undefined;
}): IncomingDepositOriginPath[] {
  const legitimateServiceAddresses = deterministicLegitimateServiceAddresses(input.contractVerdicts);
  if (legitimateServiceAddresses.size === 0) return input.originPaths;

  return input.originPaths.map((path) => {
    if (path.stoppedReason !== "unknown_contract_reached") return path;
    const touchesLegitimateService = [...legitimateServiceAddresses]
      .some((address) => incomingPathTouchesAddress(path, address));
    if (!touchesLegitimateService) return path;

    return {
      ...path,
      stoppedReason: "no_previous_transfer"
    };
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

  return buildSourceBundleExposure({
    scope: "incoming_deposit",
    targetAmountRaw: input.targetAmountRaw,
    findings: input.originPaths
      .map((path) => incomingSourceBundleFinding(path, input.targetAmountRaw))
      .filter((finding): finding is SourceBundleExposureFinding => finding !== null),
    budget: {
      maxDepth: null,
      fetchedAddressCount: null,
      maxAddressFetches: null,
      liveTransferReadCount: null,
      skippedAddressCount: 0,
      exhausted,
      exhaustedPhase: exhausted ? "trace" : null
    }
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
  const freshExposureOriginPaths = freshExposurePathsWithLegitimateServices({
    originPaths,
    contractVerdicts: input.whereReport.contractLlmVerdicts
  });
  const freshBundleExposure = buildIncomingFreshBundleExposure({
    targetAmountRaw: input.deposit.amountRaw,
    originPaths: freshExposureOriginPaths
  });
  const sourceBundleExposure = buildIncomingSourceBundleExposure({
    targetAmountRaw: input.deposit.amountRaw,
    originPaths: freshExposureOriginPaths
  });
  const subjectExposureProfile = incomingSubjectExposureProfile({
    subjectAddress: input.deposit.fromAddress,
    walletExposureProfile: input.walletExposureProfile
  });
  const unifiedRisk = calculateUnifiedIncomingDepositRisk({
    senderAddress: input.deposit.fromAddress,
    receiverAddress: input.deposit.toAddress,
    txHash: input.deposit.txHash,
    amountRaw: input.deposit.amountRaw,
    timestamp: input.deposit.timestamp,
    fastSenderRisk: input.fastSenderRisk,
    senderStablecoinState: input.senderStablecoinState,
    whereReport: input.whereReport,
    freshBundleExposure,
    walletExposureProfile: input.walletExposureProfile ?? null
  });
  const depositRiskScore = unifiedRisk.finalScore;
  const decision = unifiedRisk.finalDecision;
  const zeroBalanceWarning = input.senderStablecoinState?.balanceRaw === "0"
    ? "Sender current balance is zero after outgoing deposit; transaction-seeded provenance was used instead of sender balance-origin mode."
    : null;

  return {
    decision,
    depositRiskScore,
    riskBand: incomingRiskBandFromUnifiedScore(depositRiskScore),
    fastSenderRisk: input.fastSenderRisk,
    originPaths,
    originCoverage: incomingOriginCoverage(input.whereReport, input.deposit),
    provenanceConfidence: input.whereReport.assessment.provenanceConfidence,
    dataQuality: incomingDataQuality(input.whereReport),
    senderRole: input.whereReport.assessment.walletRole,
    sourcePolicyEvidence: input.whereReport.assessment.sourcePolicyEvidence,
    hardBadEvidence,
    contractVerdicts: input.whereReport.contractLlmVerdicts ?? [],
    freshBundleExposure,
    walletExposureProfile: input.walletExposureProfile ?? undefined,
    sourceBundleExposure,
    subjectExposureProfile,
    unifiedRiskSummary: incomingUnifiedRiskSummary(unifiedRisk),
    reasons: uniqueStrings([
      ...hardBadEvidence.map((evidence) => evidence.message),
      ...input.whereReport.decisionReasons,
      ...userFacingFreshBundleReasons(freshBundleExposure),
      ...(input.walletExposureProfile?.reasons ?? [])
    ]),
    warnings: uniqueStrings([
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
  const labels = await input.deps.getLabelsForAddress(input.sender);
  const fastSenderRisk = evaluateAddressRisk({
    context: {
      subjectAddress: input.sender,
      observedTransactionHash: input.depositTxHash
    },
    labels
  }).report;

  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const latestEdgeCache = new Map<string, ForensicRouteEdge[]>();
  const stablecoinCache = new Map<string, Promise<StablecoinRestrictionProfile | null>>();
  const classificationCache = new Map<string, Promise<ServiceClassification | null>>();
  const deterministicContractVerdicts = new Map<string, ContractLlmVerdictSummary>();
  const deterministicLegitimateServiceClassifications = new Map<string, ServiceClassification>();
  const fetchWarnings: string[] = [];
  const failedSenderWindowSources = new Set<string>();
  const seedDeposit = depositEdge(input);
  const minTimestamp = input.job.windowStart;
  const maxTimestamp = input.timestamp;
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
  const fetchEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => {
    const cached = edgeCache.get(address);
    if (cached) return cached;

    const indexedTransfers = await readTransfersOrEmpty("indexed", "window", address, () =>
      input.deps.listIndexedUsdtTransfersForAddress(address, {
        minTimestamp,
        maxTimestamp,
        limit: RUNTIME_TRANSFER_LIMIT,
        orderBy: "newest",
        direction: "both"
      })
    );
    const liveTransfers = await readTransfersOrEmpty("live", "window", address, () =>
      input.deps.listRelatedTrc20Transfers(address, {
        start: 0,
        limit: RUNTIME_TRANSFER_LIMIT,
        minTimestamp: minTimestamp.getTime(),
        endTimestamp: maxTimestamp.getTime()
      })
    );
    const edges = mergeEdges([
      ...asIndexedTransfers(indexedTransfers).map(indexedTransferToRouteEdge),
      ...asRawTransfers(liveTransfers).map((transfer) => normalizeTransfer(transfer)).filter((edge): edge is ForensicRouteEdge => edge !== null),
      ...(address === input.sender ? [seedDeposit] : [])
    ]);
    edgeCache.set(address, edges);
    return edges;
  };

  const fetchLatestEdgesForAddress = async (address: string, limit: number): Promise<ForensicRouteEdge[]> => {
    const cacheKey = `${address}:${limit}`;
    const cached = latestEdgeCache.get(cacheKey);
    if (cached) return cached;

    const indexedTransfers = await readTransfersOrEmpty("indexed", "latest", address, () =>
      input.deps.listIndexedUsdtTransfersForAddress(address, {
        minTimestamp: new Date(0),
        maxTimestamp,
        limit,
        orderBy: "newest",
        direction: "both"
      })
    );
    const liveTransfers = await readTransfersOrEmpty("live", "latest", address, () =>
      input.deps.listRelatedTrc20Transfers(address, {
        start: 0,
        limit,
        endTimestamp: maxTimestamp.getTime()
      })
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
        deterministicLegitimateServiceClassifications.set(address, enrichedClassification);
        deterministicContractVerdicts.set(address, {
          source: "deterministic",
          cacheMatch: null,
          reusedFromContractAddress: null,
          providerLabel: "deterministic",
          model: "service-classifier",
          contractAddress: address,
          caseFileHash: `deterministic-service:${address}`,
          cacheId: null,
          verdict: "legitimate_service",
          confidence: enrichedClassification.confidence === "high" ? 0.95 : 0.8,
          contractRiskScore: 10,
          decisionRecommendation: "ACCEPTABLE",
          reasons: [`${enrichedClassification.identity ?? "Service"} matched deterministic service metadata.`],
          citedEvidenceIds: [],
          falsePositiveNotes: []
        });
        return base;
      }
      return enriched?.classification ?? base;
    })();
    classificationCache.set(address, fetched);
    return fetched;
  };

  const senderStablecoinState = await getStablecoinState(input.sender);
  const senderEdges = await fetchEdgesForAddress(input.sender);
  const fundingSelection = selectIncomingDepositFundingCandidates({
    sender: input.sender,
    watchedWallet: input.watchedWallet,
    depositTxHash: input.depositTxHash,
    depositAmountRaw: input.amountRaw,
    depositTimestamp: input.timestamp,
    edges: senderEdges
  });
  const seedTransfers = fundingSelection.candidates.length > 0
    ? fundingCandidateSeedTransfers({
        candidates: fundingSelection.candidates,
        depositAmountRaw: input.amountRaw
      })
    : [incomingSeedTransfer(input)];
  const whereSubjectAddress = fundingSelection.candidates.length > 0
    ? input.sender
    : input.watchedWallet;
  const maxDepth = isLargeDepositRaw(input.amountRaw)
    ? RUNTIME_PROVENANCE_LARGE_DEPOSIT_DEPTH
    : RUNTIME_PROVENANCE_STANDARD_DEPTH;
  const whereReport = await runWhereIsMoneyCheck({
    getTrc20Balance: async (address, tokenContractAddress) => {
      if (tokenContractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
      const state = await getStablecoinState(address);
      return state?.balanceRaw ?? null;
    },
    fetchEdgesForAddress,
    fetchLatestEdgesForAddress,
    getLabelsForAddress: async (address) => {
      if (address === input.sender) return [];
      const addressLabels = await input.deps.getLabelsForAddress(address);
      return addressLabels.filter((label) => label.address === address);
    },
    getClassificationForAddress,
    // The transaction seed subject is the watched wallet; the fast risk needed for this report is the sender risk.
    getFastWalletRisk: async () => fastSenderRisk,
    getTransaction: input.deps.getTransaction,
    listTrc20ApprovalChanges: input.deps.listTrc20ApprovalChanges,
    getUsdtRestrictionStatus: async (address, options) => {
      const state = await getStablecoinState(address, options);
      if (!state) throw new Error(`USDT restriction status unavailable for ${address}`);
      return state;
    },
    getContractIntelligenceProfile: input.deps.getContractIntelligenceProfile,
    crossChainDiscoveryProvider: input.deps.crossChainDiscoveryProvider,
    crossChainContinuationProviders: input.deps.crossChainContinuationProviders,
    evmEvidenceProvider: input.deps.evmEvidenceProvider,
    analyzeContractLlmCaseFiles: async (caseFiles) => {
      const deterministic = caseFiles
        .map((caseFile) => caseFile.contractAddress ? deterministicContractVerdicts.get(caseFile.contractAddress) ?? null : null)
        .filter((verdict): verdict is ContractLlmVerdictSummary => verdict !== null);
      const deterministicAddresses = new Set(deterministic.map((verdict) => verdict.contractAddress));
      const remaining = caseFiles.filter((caseFile) =>
        !caseFile.contractAddress || !deterministicAddresses.has(caseFile.contractAddress)
      );
      const live = remaining.length > 0 && input.deps.analyzeContractLlmCaseFiles
        ? await input.deps.analyzeContractLlmCaseFiles(remaining)
        : remaining.map((caseFile) => createUnavailableContractLlmVerdict({
            contractAddress: caseFile.contractAddress,
            caseFileHash: hashContractAnalysisCaseFile(caseFile),
            providerLabel: "disabled",
            model: "disabled",
            error: "llm disabled"
          }));
      return [...deterministic, ...live];
    }
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
    contractTransactionInfoMinIntervalMs: RUNTIME_CONTRACT_TRANSACTION_INFO_MIN_INTERVAL_MS,
    crossChainStage2Enabled: input.deps.crossChainStage2Enabled,
    crossChainMaxProviderCalls: input.deps.crossChainMaxProviderCalls
  });

  const fundingBundlesByTxHash = await buildFundingBundlesByTxHash({
    whereReport,
    fetchEdgesForAddress,
    getLabelsForAddress: input.deps.getLabelsForAddress,
    getClassificationForAddress
  });
  const walletExposureProfile = await buildIncomingWalletExposureProfile({
    sender: input.sender,
    watchedWallet: input.watchedWallet,
    windowStart: minTimestamp,
    windowEnd: maxTimestamp,
    edges: senderEdges,
    getClassificationForAddress: async (address) => {
      const classification = await getClassificationForAddress(address);
      return deterministicLegitimateServiceClassifications.get(address) ?? classification;
    }
  });
  const reportFromWhere = incomingReportFromWhere({
    whereReport,
    fastSenderRisk,
    senderStablecoinState,
    deposit: seedDeposit,
    fundingBundlesByTxHash,
    walletExposureProfile
  });
  const fundingCoverage = {
    depositFundingCoverageRatio: fundingSelection.coverageRatio,
    cleanSourceCoverageRatio: cleanIncomingDepositCoverage(whereReport, seedDeposit),
    exactContinuityCoverageRatio: reportFromWhere.originCoverage
  };
  const report: IncomingDepositRiskReport = {
    ...reportFromWhere,
    fundingCoverage,
    corridorSummary: incomingCorridorSummary(reportFromWhere.originPaths)
  };
  const senderRole = await inferIncomingDepositSenderRole({
    sender: input.sender,
    senderEdges,
    originPaths: report.originPaths,
    stablecoinState: senderStablecoinState,
    getClassificationForAddress
  });
  const bothSenderSourcesFailed =
    failedSenderWindowSources.has("indexed") &&
    failedSenderWindowSources.has("live");
  return {
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
}

function riskLevelFromIncoming(report: IncomingDepositRiskReport): RiskLevel {
  if (report.riskBand === "CRITICAL") return "CRITICAL";
  if (report.riskBand === "HIGH") return "HIGH";
  if (report.riskBand === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function riskReportFromIncoming(subjectAddress: string, report: IncomingDepositRiskReport): RiskReport {
  return {
    subjectAddress,
    score: report.depositRiskScore,
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

export async function runSingleIncomingDepositJobCycle(
  deps: RunSingleIncomingDepositJobCycleDeps
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;

  const depositTxHash = stringField(job.progressJson.depositTxHash);
  const watchedWallet = stringField(job.progressJson.watchedWallet);
  const watchedWalletId = stringField(job.progressJson.watchedWalletId);
  const sender = stringField(job.progressJson.sender);
  const amountRaw = stringField(job.progressJson.amountRaw);
  const timestampText = stringField(job.progressJson.timestamp);
  const telegramUserId = stringField(job.progressJson.telegramUserId);
  const alertMode = (stringField(job.progressJson.alertMode) ?? "realtime") as WalletAlertMode;
  const locale = normalizeBotLocale(job.progressJson.locale);

  if (!depositTxHash || !watchedWallet || !watchedWalletId || !sender || !amountRaw || !timestampText || !telegramUserId) {
    const error = "incoming_deposit_check job is missing required progress_json fields";
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: job.progressJson,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: error
    });
    return true;
  }

  let currentProgress = job.progressJson;
  const persistProgress = async (patch: ForensicJobProgressPatch): Promise<void> => {
    currentProgress = mergeForensicJobProgress(currentProgress, patch);
    await deps.updateForensicCheckJobProgress?.({
      id: job.id,
      progressJson: currentProgress,
      lastError: null
    });
  };

  try {
    const timestamp = new Date(timestampText);
    await persistProgress({ jobPhase: "incoming_deposit_trace" });
    const report = await deps.buildReport({
      job,
      depositTxHash,
      watchedWallet,
      sender,
      amountRaw,
      timestamp
    });
    const riskReport = riskReportFromIncoming(sender, report);
    await persistProgress({ jobPhase: "risk_recording" });
    await deps.recordObservedTransactionRisk({ txHash: depositTxHash, watchedWalletId, report: riskReport });

    if (shouldSend(alertMode, report)) {
      const message = deps.formatIncomingDepositRiskAlert({
        jobId: job.id,
        amount: stringField(job.progressJson.amount) ?? amountRaw,
        watchedWallet,
        sender,
        txHash: depositTxHash,
        timestamp,
        locale,
        report
      });
      await persistProgress({ jobPhase: "notification_delivery" });
      await deps.sendUserAlert(telegramUserId, message.text, {
        parse_mode: message.parseMode,
        reply_markup: message.replyMarkup
      });
    }
    await deps.markUserAlertSent({ txHash: depositTxHash, watchedWalletId });
    await persistProgress({ jobPhase: "completing" });
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "completed",
      progressJson: currentProgress,
      resultJson: report as unknown as Record<string, unknown>,
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error: message });
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: currentProgress,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    return true;
  }
}

export const INCOMING_DEPOSIT_JOB_KIND: ForensicCheckJobKind = "incoming_deposit_check";
