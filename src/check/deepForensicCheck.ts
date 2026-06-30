import { createHash } from "node:crypto";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import {
  buildApprovalDrainProvenanceProfile,
  observationForApprovalDrainProvenance,
  rawEvidenceForApprovalDrainProvenance
} from "../forensics/approvalDrainProvenance";
import { buildContractDrivenEvidenceProfiles } from "../forensics/contractDrivenEvidence";
import { buildCounterpartyRiskProfiles } from "../forensics/counterpartyRisk";
import {
  buildDirectCounterpartyInteractionProfiles,
  riskLevelFromScore,
  selectCounterpartiesForFastSnapshot,
  type CounterpartySnapshotCandidate
} from "../forensics/counterpartyInteraction";
import { buildAssetContinuationProfiles } from "../forensics/assetContinuation";
import { buildInboundProvenanceProfile } from "../forensics/inboundProvenance";
import { FORENSIC_ROUTE_POLICY_VERSION } from "../forensics/routeScorer";
import {
  observationForStablecoinRestriction,
  rawEvidenceForStablecoinRestriction
} from "./stablecoinRestriction";
import { assembleAssetContinuationProfiles } from "./deepForensicAssembly";
import { buildBoundaryExposureProfile } from "../forensics/boundaryExposure";
import { boundaryProfilesToOperationalEdges, buildOperationalFlowProfile } from "../forensics/flowCounterpartyProfile";
import { runMultiHopBoundaryExposureSearch } from "../forensics/multiHopBoundaryExposure";
import { buildWalletRoleProfile } from "../forensics/walletRoleClassifier";
import { addressBehaviorEffectiveScore } from "../forensics/addressBehavior";
import {
  normalizeTransfer,
  runForensicAddressExposureSearch,
  type RouteSearchTronClient
} from "../forensics/routeSearch";
import { indexedTransferToRouteEdge } from "../forensics/localTronUsdtIndex";
import { runTemporalBeamSearch } from "../forensics/temporalBeamSearch";
import { classifyServiceAddress } from "../forensics/serviceClassifier";
import { buildCoverageDebugSnapshot, type CoverageDebugReport } from "../forensics/coverageDebugReport";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { AddressMetadata } from "../storage/repositories";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  AddressExposureReport,
  AddressLabel,
  ApprovalDrainProvenanceProfile,
  AssetContinuationProfile,
  BoundaryExposureDepth,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  CounterpartyRiskSnapshot,
  ContractDrivenReceiverProfile,
  ContractDrivenTransferProfile,
  DirectCounterpartyInteractionProfile,
  ExtendedProvenanceProfile,
  FastCheckHintAddress,
  ForensicRouteEdge,
  IndexedTronUsdtTransfer,
  InboundProvenanceProfile,
  OperationalFlowProfile,
  RawEvidenceInput,
  RiskSignalObservationInput,
  ServiceClassification,
  StablecoinRestrictionProfile,
  WalletRoleProfile
} from "../types";

export type DeepForensicRunProfile = "bounded_rerun" | "production_full";

export type DeepForensicProviderBudgetReport = {
  providerCallBudget: number | null;
  transferCallBudget: number | null;
  contractCallBudget: number | null;
  approvalCallBudget: number | null;
  elapsedTimeBudgetMs: number | null;
  exhausted: boolean;
};

export type DeepAddressForensicReport = AddressExposureReport & {
  runProfile: DeepForensicRunProfile;
  providerBudget: DeepForensicProviderBudgetReport;
  inboundProvenanceProfiles: InboundProvenanceProfile[];
  counterpartyRiskProfiles: CounterpartyRiskProfile[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  contractDrivenReceiverProfile?: ContractDrivenReceiverProfile | null;
  contractDrivenTransferProfiles?: ContractDrivenTransferProfile[];
  assetContinuationProfiles?: AssetContinuationProfile[];
  boundaryExposureProfiles: BoundaryExposureProfile[];
  operationalFlowProfiles?: OperationalFlowProfile[];
  walletRoleProfiles: WalletRoleProfile[];
  extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
  coverage: {
    sourceTransferPages: number;
    inboundSendersExpanded: number;
    transferEdges: number;
    extendedIndexedEdges?: number;
    extendedFetchedAddresses?: number;
    apiKeyConfigured?: boolean;
  };
  coverageDebug: CoverageDebugReport;
};

export type DeepAddressForensicDeps = {
  tronClient: RouteSearchTronClient;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getAddressMetadata?(address: string): Promise<AddressMetadata | null>;
  getContractIntelligenceProfile?(address: string): Promise<ContractRiskContext | null>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  getTransaction?(txHash: string): Promise<unknown>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  listIndexedUsdtTransfersForAddress?(address: string, options: {
    minTimestamp: Date;
    maxTimestamp: Date;
    limit: number;
    offset?: number;
    orderBy?: "newest" | "amount_desc";
  }): Promise<IndexedTronUsdtTransfer[]>;
};

export type RunDeepAddressForensicCheckInput = {
  sourceAddress: string;
  windowStart: Date;
  windowEnd: Date;
  runProfile?: DeepForensicRunProfile;
  providerCallBudget?: number | null;
  transferCallBudget?: number | null;
  contractCallBudget?: number | null;
  approvalCallBudget?: number | null;
  elapsedTimeBudgetMs?: number | null;
  maxDepth?: number;
  maxPagesPerAddress?: number;
  pageLimit?: number;
  limit?: number;
  contractProfileFetchLimit?: number;
  metadataFetchLimit?: number;
  maxExpandedIntermediates?: number;
  inboundDepth?: 1 | 2;
  maxInboundSenders?: number;
  maxApprovalDrainCandidates?: number;
  approvalChangeLookupLimit?: number;
  extendedSearchMode?: "disabled" | "auto" | "always";
  extendedSearchMaxDepth?: number;
  extendedSearchBeamWidth?: number;
  extendedSearchMaxAddressFetches?: number;
  extendedSearchMinTriggerVolumeRaw?: string;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
  counterpartyFastSnapshotLimit?: number;
  counterpartyFastSnapshotActiveLimit?: number;
  fastCheckHints?: FastCheckHintAddress[];
  assetContinuationTransferLimit?: number;
  apiKeyConfigured?: boolean;
  abortSignal?: AbortSignal;
};

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 3;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_INBOUND_SENDERS = 15;
const DEFAULT_ASSET_CONTINUATION_TRANSFER_LIMIT = 100;
const DEFAULT_EXTENDED_TRIGGER_VOLUME_RAW = "100000000000";
// ponytail: high ceiling for current mass Verify20 campaigns; move to paged/background enrichment if providers throttle.
const DEFAULT_CONTRACT_DRIVEN_TX_INFO_FETCH_LIMIT = 2000;

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("deep forensic check aborted");
}

function edgeAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function providerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecoverableProviderError(error: unknown): boolean {
  const message = providerErrorMessage(error).toLowerCase();
  const hardFailures = [
    "400",
    "401",
    "403",
    "unauthorized",
    "forbidden",
    "invalid api key",
    "invalid key",
    "schema",
    "column",
    "deep forensic check aborted",
    "forensic address exposure check aborted"
  ];
  if (hardFailures.some((needle) => message.includes(needle))) return false;
  return [
    "408",
    "429",
    "500",
    "502",
    "503",
    "504",
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

function providerPartialNote(scope: string, error: unknown): string {
  return `${scope} incomplete: ${providerErrorMessage(error)}`;
}

function emptyAddressExposureReport(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  missingCheck: string;
}): AddressExposureReport {
  return {
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    rawEvidence: [],
    observations: [],
    missingChecks: [input.missingCheck],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: []
  };
}

function sparseRecentFallbackNote(input: {
  address: string;
  windowEdgeCount: number;
  recentEdgeCount: number;
  requestedLimit: number;
}): string {
  return `30d window had ${input.windowEdgeCount} USDT transfers for ${input.address}; added latest ${input.recentEdgeCount}/${input.requestedLimit} historical USDT transfers for sparse-wallet context.`;
}

async function fetchEdgesForAddress(
  tronClient: RouteSearchTronClient,
  input: RunDeepAddressForensicCheckInput,
  address: string,
  maxPages: number,
  options: { allowRecentFallback?: boolean } = {}
): Promise<{
  edges: ForensicRouteEdge[];
  pages: number;
  missingChecks: string[];
  windowEdgeCount: number;
  recentFallbackEdgeCount: number;
  recentFallbackRequestedLimit: number | null;
}> {
  const edges: ForensicRouteEdge[] = [];
  let pages = 0;
  const pageLimit = input.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const fallbackLimit = input.recentFallbackTransferLimit ?? 0;
  for (let page = 0; page < maxPages; page += 1) {
    throwIfAborted(input.abortSignal);
    let transfers: RawTronscanTrc20Transfer[];
    try {
      transfers = await tronClient.listRelatedTrc20Transfers(address, {
        start: page * pageLimit,
        limit: pageLimit,
        minTimestamp: input.windowStart.getTime(),
        endTimestamp: input.windowEnd.getTime()
      }) as RawTronscanTrc20Transfer[];
    } catch (error) {
      if (!isRecoverableProviderError(error)) throw error;
      return {
        edges,
        pages,
        missingChecks: [providerPartialNote(`Transfer lookup for ${address}`, error)],
        windowEdgeCount: edges.length,
        recentFallbackEdgeCount: 0,
        recentFallbackRequestedLimit: fallbackLimit > 0 ? fallbackLimit : null
      };
    }
    pages += 1;
    for (const transfer of transfers) {
      const edge = normalizeTransfer(transfer);
      if (edge) edges.push(edge);
    }
    if (transfers.length < pageLimit) break;
  }
  const minCount = input.recentFallbackMinTransferCount ?? 0;
  if (!options.allowRecentFallback || minCount <= 0 || fallbackLimit <= 0 || edges.length >= minCount) {
    return {
      edges,
      pages,
      missingChecks: [],
      windowEdgeCount: edges.length,
      recentFallbackEdgeCount: 0,
      recentFallbackRequestedLimit: fallbackLimit > 0 ? fallbackLimit : null
    };
  }

  throwIfAborted(input.abortSignal);
  let recentTransfers: RawTronscanTrc20Transfer[];
  try {
    recentTransfers = await tronClient.listRelatedTrc20Transfers(address, {
      start: 0,
      limit: fallbackLimit
    }) as RawTronscanTrc20Transfer[];
  } catch (error) {
    if (!isRecoverableProviderError(error)) throw error;
    return {
      edges,
      pages,
      windowEdgeCount: edges.length,
      recentFallbackEdgeCount: 0,
      recentFallbackRequestedLimit: fallbackLimit,
      missingChecks: [providerPartialNote(`Recent transfer fallback for ${address}`, error)]
    };
  }
  pages += 1;
  const recentEdges: ForensicRouteEdge[] = [];
  for (const transfer of recentTransfers) {
    const edge = normalizeTransfer(transfer);
    if (edge) recentEdges.push(edge);
  }
  return {
    edges: dedupeEdges([...edges, ...recentEdges]),
    pages,
    windowEdgeCount: edges.length,
    recentFallbackEdgeCount: recentEdges.length,
    recentFallbackRequestedLimit: fallbackLimit,
    missingChecks: [
      sparseRecentFallbackNote({
        address,
        windowEdgeCount: edges.length,
        recentEdgeCount: recentEdges.length,
        requestedLimit: fallbackLimit
      })
    ]
  };
}

function topIncomingSenders(subjectAddress: string, edges: ForensicRouteEdge[], limit: number): string[] {
  const totals = new Map<string, bigint>();
  for (const edge of edges) {
    if (edge.toAddress !== subjectAddress) continue;
    totals.set(edge.fromAddress, (totals.get(edge.fromAddress) ?? 0n) + edgeAmount(edge));
  }
  return [...totals.entries()]
    .sort((a, b) => {
      if (a[1] === b[1]) return a[0].localeCompare(b[0]);
      return a[1] > b[1] ? -1 : 1;
    })
    .slice(0, limit)
    .map(([address]) => address);
}

function topUpstreamReceiversForApprovalDrain(input: {
  subjectAddress: string;
  directSenders: string[];
  edges: ForensicRouteEdge[];
  limit: number;
}): string[] {
  const directSenderSet = new Set(input.directSenders);
  const totals = new Map<string, bigint>();
  for (const edge of input.edges) {
    if (!directSenderSet.has(edge.toAddress)) continue;
    if (edge.fromAddress === input.subjectAddress) continue;
    totals.set(edge.fromAddress, (totals.get(edge.fromAddress) ?? 0n) + edgeAmount(edge));
  }
  return [...totals.entries()]
    .sort((a, b) => {
      if (a[1] === b[1]) return a[0].localeCompare(b[0]);
      return a[1] > b[1] ? -1 : 1;
    })
    .slice(0, input.limit)
    .map(([address]) => address);
}

function directCounterpartyAddresses(subjectAddress: string, edges: ForensicRouteEdge[]): string[] {
  const addresses = new Set<string>();
  for (const edge of edges) {
    if (edge.toAddress === subjectAddress) addresses.add(edge.fromAddress);
    if (edge.fromAddress === subjectAddress) addresses.add(edge.toAddress);
  }
  return [...addresses];
}

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const result = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    const key = `${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`;
    result.set(key, betterDedupeEdge(result.get(key), edge));
  }
  return [...result.values()];
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
  const method = edge.method.toLowerCase();
  if (edge.edgeType === "transfer_from") return 3;
  if (method.includes("verify20") || method.includes("permit") || method.includes("transferfrom")) return 2;
  if (method && method !== "transfer") return 1;
  return 0;
}

function sumEdgeVolume(edges: ForensicRouteEdge[], predicate: (edge: ForensicRouteEdge) => boolean): bigint {
  return edges.reduce((sum, edge) => predicate(edge) ? sum + edgeAmount(edge) : sum, 0n);
}

function shouldRunExtendedSearch(input: {
  mode: "disabled" | "auto" | "always";
  sourceAddress: string;
  sourceEdges: ForensicRouteEdge[];
  exposureReport: AddressExposureReport;
  inboundProfile: InboundProvenanceProfile;
  counterpartyRiskProfiles: CounterpartyRiskProfile[];
  approvalDrainProfile: ApprovalDrainProvenanceProfile | null;
  triggerVolumeRaw: string;
}): boolean {
  if (input.mode === "disabled") return false;
  if (input.mode === "always") return true;
  const triggerVolume = /^\d+$/.test(input.triggerVolumeRaw) ? BigInt(input.triggerVolumeRaw) : BigInt(DEFAULT_EXTENDED_TRIGGER_VOLUME_RAW);
  const incoming = sumEdgeVolume(input.sourceEdges, (edge) => edge.toAddress === input.sourceAddress);
  const outgoing = sumEdgeVolume(input.sourceEdges, (edge) => edge.fromAddress === input.sourceAddress);
  const serviceScore = input.exposureReport.serviceExposureProfiles[0]?.exposureScore ?? 0;
  const behaviorScore = input.exposureReport.addressBehaviorProfiles[0]
    ? Math.max(
        input.exposureReport.addressBehaviorProfiles[0].depositThenDrainScore,
        input.exposureReport.addressBehaviorProfiles[0].transitScore
      )
    : 0;
  return incoming >= triggerVolume ||
    outgoing >= triggerVolume ||
    serviceScore >= 40 ||
    behaviorScore >= 20 ||
    input.inboundProfile.score > 0 ||
    input.counterpartyRiskProfiles.some((profile) => profile.score > 0) ||
    Boolean(input.approvalDrainProfile);
}

function operationalBoundaryDepth(input: RunDeepAddressForensicCheckInput): BoundaryExposureDepth {
  const requestedDepth = Math.trunc(input.extendedSearchMaxDepth ?? 6);
  return Math.min(4, Math.max(1, requestedDepth)) as BoundaryExposureDepth;
}

async function getServiceClassificationForAddress(
  address: string,
  deps: DeepAddressForensicDeps,
  classificationCache: Map<string, ServiceClassification | null>
): Promise<ServiceClassification | null> {
  if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
  const metadata = await deps.getAddressMetadata?.(address) ?? null;
  const contractProfile = metadata?.isContract === true
    ? await deps.getContractIntelligenceProfile?.(address).catch(() => null) ?? null
    : null;
  const classification = classifyServiceAddress({ address, metadata, contractProfile });
  classificationCache.set(address, classification);
  return classification;
}

async function fetchIndexedRouteEdges(
  deps: DeepAddressForensicDeps,
  input: RunDeepAddressForensicCheckInput,
  address: string,
  limit = 200,
  orderBy: "newest" | "amount_desc" = "newest"
): Promise<ForensicRouteEdge[]> {
  const transfers = await deps.listIndexedUsdtTransfersForAddress?.(address, {
    minTimestamp: input.windowStart,
    maxTimestamp: input.windowEnd,
    limit,
    orderBy
  }) ?? [];
  return transfers.map(indexedTransferToRouteEdge);
}

function coveredSubjectTxHashes(profiles: BoundaryExposureProfile[]): Set<string> {
  return new Set(profiles.flatMap((profile) => profile.flows.map((flow) => flow.subjectTxHash)));
}

async function buildOperationalIndexedProfiles(input: {
  deps: DeepAddressForensicDeps;
  runInput: RunDeepAddressForensicCheckInput;
  sourceEdges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null>;
}): Promise<{
  boundaryProfiles: BoundaryExposureProfile[];
  flowProfiles: OperationalFlowProfile[];
}> {
  const classificationCache = new Map(input.classifications);
  const fetchEdgesForAddress = (address: string): Promise<ForensicRouteEdge[]> =>
    fetchIndexedRouteEdges(input.deps, input.runInput, address, 200, "amount_desc");
  const getClassificationForAddress = (address: string): Promise<ServiceClassification | null> =>
    getServiceClassificationForAddress(address, input.deps, classificationCache);
  const boundaryProfiles = input.deps.listIndexedUsdtTransfersForAddress
    ? (await Promise.all((["outbound", "inbound"] as const).map((direction) =>
      runMultiHopBoundaryExposureSearch({
        subjectAddress: input.runInput.sourceAddress,
        direction,
        windowStart: input.runInput.windowStart,
        windowEnd: input.runInput.windowEnd,
        maxDepth: operationalBoundaryDepth(input.runInput),
        beamWidth: input.runInput.extendedSearchBeamWidth ?? 12,
        maxAddressFetches: input.runInput.extendedSearchMaxAddressFetches ?? 150,
        minAmountPreservationRatio: 0.7,
        fetchEdgesForAddress,
        getClassificationForAddress
      })
    ))).filter((profile) => profile.flows.length > 0 || profile.contextScore > 0)
    : [];

  const sourceIndexedEdges = input.deps.listIndexedUsdtTransfersForAddress
    ? await fetchEdgesForAddress(input.runInput.sourceAddress)
    : [];
  const coveredTxHashes = coveredSubjectTxHashes(boundaryProfiles);
  const operationalEdges = dedupeEdges([
    ...input.sourceEdges,
    ...sourceIndexedEdges.filter((edge) => !coveredTxHashes.has(edge.txHash)),
    ...boundaryProfilesToOperationalEdges({
      subjectAddress: input.runInput.sourceAddress,
      profiles: boundaryProfiles
    })
  ]);
  if (operationalEdges.length === 0) return { boundaryProfiles, flowProfiles: [] };
  const flowProfile = buildOperationalFlowProfile({
    subjectAddress: input.runInput.sourceAddress,
    windowStart: input.runInput.windowStart,
    windowEnd: input.runInput.windowEnd,
    edges: operationalEdges,
    classifications: classificationCache
  });
  const shouldPersistFlowProfile = boundaryProfiles.length > 0 || flowProfile.operationalScore > 0;
  return {
    boundaryProfiles,
    flowProfiles: shouldPersistFlowProfile ? [flowProfile] : []
  };
}

async function labelsForAddresses(
  addresses: Iterable<string>,
  getLabelsForAddress: (address: string) => Promise<AddressLabel[]>
): Promise<Map<string, AddressLabel[]>> {
  const labels = new Map<string, AddressLabel[]>();
  for (const address of new Set(addresses)) {
    labels.set(address, await getLabelsForAddress(address));
  }
  return labels;
}

async function classificationsForAddresses(
  addresses: Iterable<string>,
  deps: DeepAddressForensicDeps
): Promise<Map<string, ServiceClassification | null>> {
  const classifications = new Map<string, ServiceClassification | null>();
  for (const address of new Set(addresses)) {
    const metadata = await deps.getAddressMetadata?.(address) ?? null;
    const contractProfile = metadata?.isContract === true
      ? await deps.getContractIntelligenceProfile?.(address).catch(() => null) ?? null
      : null;
    classifications.set(address, classifyServiceAddress({ address, metadata, contractProfile }));
  }
  return classifications;
}

const criticalCounterpartyLabels = new Set<string>([
  "scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange"
]);
const derivedCounterpartyLabels = new Set<string>([
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

function snapshotForLabels(address: string, labels: AddressLabel[] | undefined): CounterpartyRiskSnapshot | null {
  const label = labels?.find((item) => criticalCounterpartyLabels.has(item.label))
    ?? labels?.find((item) => derivedCounterpartyLabels.has(item.label))
    ?? null;
  if (!label) return null;
  const derived = derivedCounterpartyLabels.has(label.label);
  const riskScore = derived ? 80 : 90;
  return {
    address,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    source: derived ? "derived_label" : "exact_label",
    evidenceClass: derived ? "derived_labeled_counterparty" : "exact_labeled_counterparty",
    reasons: [derived
      ? `counterparty has derived high-risk label ${label.label}`
      : `counterparty has exact high-risk label ${label.label}`],
    partialNotes: []
  };
}

function snapshotForService(address: string, classification: ServiceClassification | null): CounterpartyRiskSnapshot | null {
  const serviceCategory = classification?.category && classification.category !== "none" ? classification.category : null;
  if (!serviceCategory) return null;
  return {
    address,
    riskScore: 0,
    riskLevel: "LOW",
    source: "service_boundary",
    evidenceClass: "service_boundary_context",
    reasons: [`counterparty is ${serviceCategory} boundary${classification?.identity ? ` (${classification.identity})` : ""}`],
    partialNotes: []
  };
}

function snapshotCandidatesFromProfiles(
  profiles: DirectCounterpartyInteractionProfile[]
): CounterpartySnapshotCandidate[] {
  return profiles.map((profile) => ({
    counterpartyAddress: profile.counterpartyAddress,
    volumeRaw: profile.volumeRaw,
    volumeRatio: profile.volumeRatio,
    txCount: profile.txCount,
    snapshot: profile.snapshot.source === "none" ? null : profile.snapshot
  }));
}

function snapshotFromAddressExposureReport(
  address: string,
  report: AddressExposureReport
): CounterpartyRiskSnapshot {
  const serviceScore = Math.min(50, report.serviceExposureProfiles[0]?.exposureScore ?? 0);
  const behaviorScore = report.addressBehaviorProfiles[0]
    ? Math.min(30, addressBehaviorEffectiveScore(report.addressBehaviorProfiles[0]))
    : 0;
  const riskScore = Math.max(0, Math.min(100, serviceScore + behaviorScore));
  const partialNotes = report.missingChecks.filter((check) =>
    check.toLowerCase().includes("partial") ||
    check.toLowerCase().includes("incomplete") ||
    check.toLowerCase().includes("timeout") ||
    check.toLowerCase().includes("limited")
  );

  if (riskScore <= 0 && partialNotes.length > 0) {
    return {
      address,
      riskScore: 0,
      riskLevel: "LOW",
      source: "fast_address_check",
      evidenceClass: "provider_partial",
      reasons: [],
      partialNotes
    };
  }

  return {
    address,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    source: "fast_address_check",
    evidenceClass: riskScore > 0 ? "counterparty_behavior_context" : "no_exact_label_or_cached_taint",
    reasons: [
      ...(serviceScore > 0 ? ["counterparty fast check found service exposure context"] : []),
      ...(behaviorScore > 0 ? ["counterparty fast check found behavior context"] : [])
    ],
    partialNotes
  };
}

async function buildCounterpartyFastSnapshots(input: {
  deps: DeepAddressForensicDeps;
  runInput: RunDeepAddressForensicCheckInput;
  sourceEdges: ForensicRouteEdge[];
  labelsByAddress: Map<string, AddressLabel[]>;
  classifications: Map<string, ServiceClassification | null>;
}): Promise<Map<string, CounterpartyRiskSnapshot>> {
  const seedProfiles = buildDirectCounterpartyInteractionProfiles({
    subjectAddress: input.runInput.sourceAddress,
    edges: input.sourceEdges,
    snapshotsByAddress: new Map(),
    classifications: input.classifications
  });
  const sparseWallet = seedProfiles.reduce((sum, profile) => sum + profile.txCount, 0) < (input.runInput.recentFallbackMinTransferCount ?? 150);
  const baseline = new Map<string, CounterpartyRiskSnapshot>();
  for (const profile of seedProfiles) {
    const labelSnapshot = snapshotForLabels(profile.counterpartyAddress, input.labelsByAddress.get(profile.counterpartyAddress));
    const serviceSnapshot = snapshotForService(profile.counterpartyAddress, input.classifications.get(profile.counterpartyAddress) ?? null);
    if (labelSnapshot) baseline.set(profile.counterpartyAddress, labelSnapshot);
    else if (serviceSnapshot) baseline.set(profile.counterpartyAddress, serviceSnapshot);
  }

  const seedAddresses = new Set(seedProfiles.map((profile) => profile.counterpartyAddress));
  const priorityAddresses = (input.runInput.fastCheckHints ?? [])
    .map((hint) => hint.address)
    .filter((address, index, addresses) => seedAddresses.has(address) && addresses.indexOf(address) === index);

  const selected = selectCounterpartiesForFastSnapshot({
    profiles: snapshotCandidatesFromProfiles(seedProfiles).map((candidate) => ({
      ...candidate,
      snapshot: baseline.get(candidate.counterpartyAddress) ?? candidate.snapshot
    })),
    sparseWallet,
    maxSparse: input.runInput.counterpartyFastSnapshotLimit ?? 60,
    maxActive: input.runInput.counterpartyFastSnapshotActiveLimit ?? 30,
    priorityAddresses
  });
  const snapshots = new Map(baseline);
  for (const address of selected) {
    const existingSnapshot = snapshots.get(address) ?? null;
    if (existingSnapshot?.source === "service_boundary") continue;
    if (existingSnapshot?.riskScore && existingSnapshot.riskScore >= 80) continue;
    throwIfAborted(input.runInput.abortSignal);
    if (input.deps.getUsdtRestrictionStatus) {
      const restriction = await input.deps.getUsdtRestrictionStatus(address).catch(() => null);
      if (restriction?.isBlacklisted) {
        snapshots.set(address, {
          address,
          riskScore: 90,
          riskLevel: "CRITICAL",
          source: "stablecoin_blacklist",
          evidenceClass: "exact_labeled_counterparty",
          reasons: ["official TRON USDT contract blacklist state is active for counterparty"],
          partialNotes: []
        });
        continue;
      }
    }
    const report = await runForensicAddressExposureSearch({
      sourceAddress: address,
      windowStart: input.runInput.windowStart,
      windowEnd: input.runInput.windowEnd,
      maxDepth: 1,
      maxPagesPerAddress: 1,
      pageLimit: input.runInput.pageLimit ?? DEFAULT_PAGE_LIMIT,
      limit: input.runInput.limit ?? DEFAULT_LIMIT,
      tronClient: input.deps.tronClient,
      getAddressMetadata: input.deps.getAddressMetadata,
      getContractIntelligenceProfile: input.deps.getContractIntelligenceProfile,
      contractProfileFetchLimit: Math.min(input.runInput.contractProfileFetchLimit ?? 2, 2),
      metadataFetchLimit: Math.min(input.runInput.metadataFetchLimit ?? 4, 4),
      maxExpandedIntermediates: 0,
      recentFallbackMinTransferCount: input.runInput.recentFallbackMinTransferCount,
      recentFallbackTransferLimit: input.runInput.recentFallbackTransferLimit,
      abortSignal: input.runInput.abortSignal
    }).catch((error: unknown): AddressExposureReport => ({
      subjectAddress: address,
      windowStart: input.runInput.windowStart,
      windowEnd: input.runInput.windowEnd,
      rawEvidence: [],
      observations: [],
      missingChecks: [`Counterparty fast snapshot incomplete: ${error instanceof Error ? error.message : String(error)}`],
      serviceExposureProfiles: [],
      addressBehaviorProfiles: []
    }));
    const snapshot = snapshotFromAddressExposureReport(address, report);
    const existing = snapshots.get(address) ?? null;
    if (!existing || snapshot.riskScore > existing.riskScore || snapshot.evidenceClass === "provider_partial") {
      snapshots.set(address, snapshot);
    }
  }
  return snapshots;
}

function rawEvidenceForInbound(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: InboundProvenanceProfile;
}): RawEvidenceInput {
  return {
    id: stableId(["forensic_inbound_provenance_raw", input.subjectAddress, input.windowStart.toISOString(), input.windowEnd.toISOString()]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.paths[0]?.txHashes[0] ?? null,
    observedTransactionHash: input.profile.paths[0]?.txHashes.at(-1) ?? null,
    evidenceJson: {
      inboundProvenanceProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForInbound(input: {
  subjectAddress: string;
  profile: InboundProvenanceProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.score <= 0) return null;
  const topPath = input.profile.paths[0] ?? null;
  if (topPath?.label === "darknet_exchange") {
    return {
      id: stableId(["forensic_darknet_exchange_provenance_observation", input.subjectAddress, FORENSIC_ROUTE_POLICY_VERSION]),
      subjectChain: "tron",
      subjectAddress: input.subjectAddress,
      subjectTxHash: null,
      observedTransactionHash: topPath.txHashes.at(-1) ?? null,
      signalGroup: "incoming_context",
      code: "forensic_darknet_exchange_provenance",
      message: "Confirmed on-chain exposure to known darknet exchange seed within 2 hops.",
      scoreImpact: Math.min(50, input.profile.score),
      confidence: "high",
      severity: input.profile.score >= 50 ? "critical" : "high",
      source: "incoming_provenance",
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      rawEvidenceId: input.rawEvidenceId
    };
  }
  if (topPath?.label === "whitebit") {
    return {
      id: stableId(["forensic_whitebit_provenance_observation", input.subjectAddress, FORENSIC_ROUTE_POLICY_VERSION]),
      subjectChain: "tron",
      subjectAddress: input.subjectAddress,
      subjectTxHash: null,
      observedTransactionHash: topPath.txHashes.at(-1) ?? null,
      signalGroup: "incoming_context",
      code: "forensic_whitebit_provenance",
      message: "Inbound provenance candidate from WhiteBIT high-risk source; manual review required.",
      scoreImpact: Math.min(50, input.profile.score),
      confidence: "high",
      severity: "high",
      source: "incoming_provenance",
      policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
      rawEvidenceId: input.rawEvidenceId
    };
  }
  return {
    id: stableId(["forensic_inbound_provenance_observation", input.subjectAddress, FORENSIC_ROUTE_POLICY_VERSION]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: topPath?.txHashes.at(-1) ?? null,
    signalGroup: "incoming_context",
    code: "forensic_inbound_provenance",
    message: "Inbound provenance candidate; manual review required.",
    scoreImpact: Math.min(40, input.profile.score),
    confidence: input.profile.score >= 40 ? "high" : "medium",
    severity: input.profile.score >= 40 ? "high" : "medium",
    source: "incoming_provenance",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

function rawEvidenceForCounterparty(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: CounterpartyRiskProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_counterparty_risk_raw",
      input.subjectAddress,
      input.profile.direction,
      input.profile.counterpartyAddress,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.txHashes[0] ?? null,
    observedTransactionHash: input.profile.txHashes.at(-1) ?? null,
    evidenceJson: {
      counterpartyRiskProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForCounterparty(input: {
  subjectAddress: string;
  profile: CounterpartyRiskProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.score <= 0 || !input.profile.label) return null;
  const code = input.profile.label === "darknet_exchange"
    ? "forensic_counterparty_darknet_exchange"
    : input.profile.label === "whitebit"
      ? "forensic_counterparty_whitebit"
      : "forensic_counterparty_darknet_exchange_proximity";
  const message = input.profile.label === "darknet_exchange"
    ? "Direct counterparty is a manually verified darknet exchange seed."
    : input.profile.label === "whitebit"
      ? "Direct counterparty is labeled WhiteBIT high-risk source."
      : "Direct counterparty has a confirmed darknet exchange proximity marker.";
  return {
    id: stableId([
      "forensic_counterparty_risk_observation",
      input.subjectAddress,
      input.profile.direction,
      input.profile.counterpartyAddress,
      input.profile.label,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: input.profile.txHashes.at(-1) ?? null,
    signalGroup: "incoming_context",
    code,
    message,
    scoreImpact: input.profile.score,
    confidence: "high",
    severity: "high",
    source: "counterparty_propagation",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

function rawEvidenceForDirectCounterpartyInteraction(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: DirectCounterpartyInteractionProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_direct_counterparty_interaction_raw",
      input.subjectAddress,
      input.profile.direction,
      input.profile.counterpartyAddress,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_counterparty_fast_snapshot",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.txHashes[0] ?? null,
    observedTransactionHash: input.profile.txHashes.at(-1) ?? null,
    evidenceJson: {
      directCounterpartyInteractionProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForDirectCounterpartyInteraction(input: {
  subjectAddress: string;
  profile: DirectCounterpartyInteractionProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.scoreContribution <= 0) return null;
  return {
    id: stableId([
      "forensic_direct_counterparty_interaction_observation",
      input.subjectAddress,
      input.profile.direction,
      input.profile.counterpartyAddress,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: input.profile.txHashes.at(-1) ?? null,
    signalGroup: "incoming_context",
    code: "forensic_counterparty_fast_snapshot_context",
    message: "Major direct counterparty has high fast forensic risk; this is interaction context, not exact taint proof.",
    scoreImpact: input.profile.scoreContribution,
    confidence: input.profile.scoreContribution >= 60 ? "high" : "medium",
    severity: input.profile.scoreContribution >= 60 ? "high" : "medium",
    source: "counterparty_fast_snapshot",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

function rawEvidenceForExtendedProvenance(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: ExtendedProvenanceProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_extended_provenance_raw",
      input.subjectAddress,
      input.profile.direction,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "local_tron_usdt_index",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.paths[0]?.txHashes[0] ?? null,
    observedTransactionHash: input.profile.paths[0]?.txHashes.at(-1) ?? null,
    evidenceJson: {
      extendedProvenanceProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForExtendedProvenance(input: {
  subjectAddress: string;
  profile: ExtendedProvenanceProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.score <= 0) return null;
  const topPath = input.profile.paths.find((path) => path.evidenceStrength === "exact_labeled_path" && path.candidateScore > 0) ?? null;
  if (!topPath) return null;
  return {
    id: stableId([
      "forensic_extended_provenance_observation",
      input.subjectAddress,
      input.profile.direction,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: topPath.txHashes.at(-1) ?? null,
    signalGroup: "incoming_context",
    code: "forensic_extended_provenance",
    message: `Extended ${input.profile.direction} on-chain provenance candidate within ${topPath.depth} hops; manual review required.`,
    scoreImpact: Math.min(70, input.profile.score),
    confidence: topPath.depth <= 4 ? "high" : "medium",
    severity: input.profile.score >= 60 ? "high" : "medium",
    source: "local_tron_usdt_index",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

function rawEvidenceForBoundaryExposure(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: BoundaryExposureProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_boundary_exposure_raw",
      input.subjectAddress,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.flows[0]?.subjectTxHash ?? null,
    observedTransactionHash: input.profile.flows[0]?.boundaryTxHash ?? null,
    evidenceJson: {
      boundaryExposureProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForBoundaryExposure(input: {
  subjectAddress: string;
  profile: BoundaryExposureProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.contextScore <= 0 || input.profile.flows.length === 0) return null;
  return {
    id: stableId([
      "forensic_boundary_exposure_observation",
      input.subjectAddress,
      input.profile.flows[0]?.direction ?? "unknown",
      input.profile.flows[0]?.boundaryTxHash ?? "none",
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: input.profile.flows[0]?.boundaryTxHash ?? null,
    signalGroup: "incoming_context",
    code: "forensic_boundary_exposure_context",
    message: "Funds touched service-boundary infrastructure; public-chain continuity after this point should not be assumed.",
    scoreImpact: input.profile.contextScore,
    confidence: "medium",
    severity: input.profile.contextScore >= 10 ? "low" : "info",
    source: "forensic_route_search",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

function rawEvidenceForOperationalFlow(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: OperationalFlowProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_operational_flow_raw",
      input.subjectAddress,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_operational_profile",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: null,
    observedTransactionHash: null,
    evidenceJson: {
      operationalFlowProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForOperationalFlow(input: {
  subjectAddress: string;
  profile: OperationalFlowProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.operationalScore <= 0) return null;
  return {
    id: stableId(["forensic_operational_flow_observation", input.subjectAddress, FORENSIC_ROUTE_POLICY_VERSION]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: null,
    signalGroup: "behavior",
    code: "forensic_operational_boundary_flow",
    message: "Operational flow pattern: 30d counterparty and multi-hop boundary flow indicate terminal liquidity routing; this is not direct blacklist evidence.",
    scoreImpact: input.profile.operationalScore,
    confidence: input.profile.operationalScore >= 45 ? "high" : "medium",
    severity: input.profile.operationalScore >= 60 ? "high" : input.profile.operationalScore >= 30 ? "medium" : "low",
    source: "forensic_operational_profile",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

function rawEvidenceForWalletRole(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: WalletRoleProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_wallet_role_raw",
      input.subjectAddress,
      input.profile.primaryRole,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: null,
    observedTransactionHash: null,
    evidenceJson: {
      walletRoleProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

function observationForWalletRole(input: {
  subjectAddress: string;
  profile: WalletRoleProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.primaryRole === "unknown") return null;
  const primary = input.profile.roles.find((role) => role.role === input.profile.primaryRole) ?? input.profile.roles[0] ?? null;
  return {
    id: stableId(["forensic_wallet_role_observation", input.subjectAddress, input.profile.primaryRole, FORENSIC_ROUTE_POLICY_VERSION]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: null,
    signalGroup: "incoming_context",
    code: "forensic_wallet_role_context",
    message: `Wallet role context: ${input.profile.primaryRole} (${primary?.confidence ?? "medium"} confidence).`,
    scoreImpact: 0,
    confidence: primary?.confidence ?? "medium",
    severity: "info",
    source: "forensic_route_search",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

export async function runDeepAddressForensicCheck(
  deps: DeepAddressForensicDeps,
  input: RunDeepAddressForensicCheckInput
): Promise<DeepAddressForensicReport> {
  let exposureReport: AddressExposureReport;
  try {
    exposureReport = await runForensicAddressExposureSearch({
      sourceAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxPagesPerAddress: input.maxPagesPerAddress ?? DEFAULT_MAX_PAGES_PER_ADDRESS,
      pageLimit: input.pageLimit ?? DEFAULT_PAGE_LIMIT,
      limit: input.limit ?? DEFAULT_LIMIT,
      tronClient: deps.tronClient,
      getAddressMetadata: deps.getAddressMetadata,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile,
      contractProfileFetchLimit: input.contractProfileFetchLimit,
      metadataFetchLimit: input.metadataFetchLimit,
      maxExpandedIntermediates: input.maxExpandedIntermediates,
      recentFallbackMinTransferCount: input.recentFallbackMinTransferCount,
      recentFallbackTransferLimit: input.recentFallbackTransferLimit,
      abortSignal: input.abortSignal
    });
  } catch (error) {
    if (!isRecoverableProviderError(error)) throw error;
    exposureReport = emptyAddressExposureReport({
      subjectAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      missingCheck: providerPartialNote("Address exposure search", error)
    });
  }
  const sourceTransfers = await fetchEdgesForAddress(
    deps.tronClient,
    input,
    input.sourceAddress,
    input.maxPagesPerAddress ?? DEFAULT_MAX_PAGES_PER_ADDRESS,
    { allowRecentFallback: true }
  );
  const transferCoverageNotes = [...sourceTransfers.missingChecks];
  let allTokenTransfers: RawTronscanTrc20Transfer[] = [];
  if (deps.tronClient.listRelatedTrc20TransfersAllTokens) {
    try {
      allTokenTransfers = await deps.tronClient.listRelatedTrc20TransfersAllTokens(input.sourceAddress, {
        start: 0,
        limit: input.assetContinuationTransferLimit ?? DEFAULT_ASSET_CONTINUATION_TRANSFER_LIMIT,
        minTimestamp: input.windowStart.getTime(),
        endTimestamp: input.windowEnd.getTime()
      });
    } catch (error) {
      transferCoverageNotes.push(`Asset-continuation all-token transfer lookup incomplete: ${error instanceof Error ? error.message : String(error)}`);
      allTokenTransfers = [];
    }
  }
  const assetContinuationProfiles = allTokenTransfers.length > 0
    ? await buildAssetContinuationProfiles({
      subjectAddress: input.sourceAddress,
      usdtTransfers: allTokenTransfers,
      allTokenTransfers,
      getLabelsForAddress: deps.getLabelsForAddress
    })
    : [];
  const senders = topIncomingSenders(input.sourceAddress, sourceTransfers.edges, input.maxInboundSenders ?? DEFAULT_MAX_INBOUND_SENDERS);
  const upstreamEdges: ForensicRouteEdge[] = [];
  const approvalDrainRootEdges: ForensicRouteEdge[] = [];
  const expandedAddresses = new Set<string>();
  let inboundSendersExpanded = 0;
  if ((input.inboundDepth ?? 2) >= 2) {
    for (const sender of senders) {
      throwIfAborted(input.abortSignal);
      const senderTransfers = await fetchEdgesForAddress(deps.tronClient, input, sender, 1, { allowRecentFallback: true });
      upstreamEdges.push(...senderTransfers.edges);
      transferCoverageNotes.push(...senderTransfers.missingChecks);
      expandedAddresses.add(sender);
      inboundSendersExpanded += 1;
    }
  }
  if (deps.getTransaction && deps.listTrc20ApprovalChanges && (input.inboundDepth ?? 2) >= 2) {
    const alreadyFetched = new Set([input.sourceAddress, ...senders]);
    const rootCandidates = topUpstreamReceiversForApprovalDrain({
      subjectAddress: input.sourceAddress,
      directSenders: senders,
      edges: upstreamEdges,
      limit: input.maxApprovalDrainCandidates ?? 5
    });
    for (const candidate of rootCandidates) {
      if (alreadyFetched.has(candidate)) continue;
      throwIfAborted(input.abortSignal);
      const candidateTransfers = await fetchEdgesForAddress(deps.tronClient, input, candidate, 1);
      approvalDrainRootEdges.push(...candidateTransfers.edges);
      transferCoverageNotes.push(...candidateTransfers.missingChecks);
      expandedAddresses.add(candidate);
      alreadyFetched.add(candidate);
    }
  }
  const provenanceEdges = dedupeEdges([...sourceTransfers.edges, ...upstreamEdges, ...approvalDrainRootEdges]);
  const provenanceAddresses = new Set<string>();
  for (const edge of provenanceEdges) {
    provenanceAddresses.add(edge.fromAddress);
    provenanceAddresses.add(edge.toAddress);
  }
  const labelsByAddress = await labelsForAddresses(provenanceAddresses, deps.getLabelsForAddress);
  const classificationAddresses = new Set<string>([input.sourceAddress]);
  for (const address of provenanceAddresses) {
    classificationAddresses.add(address);
  }
  for (const address of directCounterpartyAddresses(input.sourceAddress, provenanceEdges)) {
    classificationAddresses.add(address);
  }
  const classifications = await classificationsForAddresses(classificationAddresses, deps);
  const inboundProfile = buildInboundProvenanceProfile({
    subjectAddress: input.sourceAddress,
    edges: provenanceEdges,
    labelsByAddress,
    classifications
  });
  const counterpartyRiskProfiles = buildCounterpartyRiskProfiles({
    subjectAddress: input.sourceAddress,
    edges: provenanceEdges,
    labelsByAddress,
    classifications
  });
  const counterpartySnapshots = await buildCounterpartyFastSnapshots({
    deps,
    runInput: input,
    sourceEdges: sourceTransfers.edges,
    labelsByAddress,
    classifications
  });
  const directCounterpartyInteractionProfiles = buildDirectCounterpartyInteractionProfiles({
    subjectAddress: input.sourceAddress,
    edges: sourceTransfers.edges,
    snapshotsByAddress: counterpartySnapshots,
    classifications
  });
  const inboundEvidence = rawEvidenceForInbound({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile: inboundProfile
  });
  const inboundObservation = observationForInbound({
    subjectAddress: input.sourceAddress,
    profile: inboundProfile,
    rawEvidenceId: inboundEvidence.id
  });
  const counterpartyEvidence = counterpartyRiskProfiles.map((profile) => rawEvidenceForCounterparty({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile
  }));
  const counterpartyObservations = counterpartyEvidence
    .map((evidence, index) => observationForCounterparty({
      subjectAddress: input.sourceAddress,
      profile: counterpartyRiskProfiles[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
  const directCounterpartyInteractionEvidence = directCounterpartyInteractionProfiles
    .filter((profile) => profile.scoreContribution > 0)
    .map((profile) => rawEvidenceForDirectCounterpartyInteraction({
      subjectAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      profile
    }));
  const directCounterpartyInteractionObservations = directCounterpartyInteractionEvidence
    .map((evidence, index) => observationForDirectCounterpartyInteraction({
      subjectAddress: input.sourceAddress,
      profile: directCounterpartyInteractionProfiles.filter((profile) => profile.scoreContribution > 0)[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
  const assetContinuationAssembly = assembleAssetContinuationProfiles({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profiles: assetContinuationProfiles
  });
  const approvalDrainProfile = deps.getTransaction && deps.listTrc20ApprovalChanges
    ? await buildApprovalDrainProvenanceProfile({
      subjectAddress: input.sourceAddress,
      edges: provenanceEdges,
      classifications,
      deps: {
        getTransaction: deps.getTransaction,
        listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
        getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
      },
      maxCandidates: input.maxApprovalDrainCandidates,
      approvalChangeLookupLimit: input.approvalChangeLookupLimit
    }).catch(() => null)
    : null;
  const approvalDrainEvidence = approvalDrainProfile
    ? rawEvidenceForApprovalDrainProvenance({
      subjectAddress: input.sourceAddress,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      profile: approvalDrainProfile
    })
    : null;
  const approvalDrainObservation = approvalDrainProfile && approvalDrainEvidence
    ? observationForApprovalDrainProvenance({
      subjectAddress: input.sourceAddress,
      profile: approvalDrainProfile,
      rawEvidenceId: approvalDrainEvidence.id
    })
    : null;
  const stablecoinRestrictionProfile = deps.getUsdtRestrictionStatus
    ? await deps.getUsdtRestrictionStatus(input.sourceAddress).catch(() => null)
    : null;
  const stablecoinEvidence = stablecoinRestrictionProfile?.isBlacklisted
    ? rawEvidenceForStablecoinRestriction(stablecoinRestrictionProfile)
    : null;
  const stablecoinObservation = stablecoinEvidence && stablecoinRestrictionProfile
    ? observationForStablecoinRestriction({ profile: stablecoinRestrictionProfile, rawEvidenceId: stablecoinEvidence.id })
    : null;
  const approvalDrainProfiles = approvalDrainProfile ? [approvalDrainProfile] : [];
  const contractDrivenTxInfoFetchLimit = Math.max(
    input.maxApprovalDrainCandidates ?? 0,
    DEFAULT_CONTRACT_DRIVEN_TX_INFO_FETCH_LIMIT
  );
  const contractDrivenEvidence = await buildContractDrivenEvidenceProfiles({
    subjectAddress: input.sourceAddress,
    edges: provenanceEdges,
    classifications,
    approvalDrainProvenanceProfiles: approvalDrainProfiles,
    getTransaction: deps.getTransaction,
    fetchEdgesForAddress: async (address) => {
      const result = await fetchEdgesForAddress(deps.tronClient, input, address, 1, { allowRecentFallback: true });
      return result.edges;
    },
    maxTransactionInfoFetches: contractDrivenTxInfoFetchLimit,
    maxSourceActivityChecks: Math.min(20, contractDrivenTxInfoFetchLimit)
  });
  const directBoundaryExposureProfile = buildBoundaryExposureProfile({
    subjectAddress: input.sourceAddress,
    edges: provenanceEdges,
    classifications
  });
  const operationalIndexedProfiles = await buildOperationalIndexedProfiles({
    deps,
    runInput: input,
    sourceEdges: sourceTransfers.edges,
    classifications
  });
  const boundaryExposureProfiles = [
    directBoundaryExposureProfile,
    ...operationalIndexedProfiles.boundaryProfiles
  ];
  const boundaryProfileForWalletRole = boundaryExposureProfiles.find((profile) =>
    profile.contextScore > 0 && profile.flows.length > 0
  ) ?? boundaryExposureProfiles[0] ?? null;
  const operationalFlowProfiles = operationalIndexedProfiles.flowProfiles;
  const walletRoleProfiles = [buildWalletRoleProfile({
    subjectAddress: input.sourceAddress,
    approvalDrainProfiles,
    addressBehaviorProfile: exposureReport.addressBehaviorProfiles[0] ?? null,
    serviceExposureProfile: exposureReport.serviceExposureProfiles[0] ?? null,
    boundaryExposureProfile: boundaryProfileForWalletRole,
    subjectClassification: classifications.get(input.sourceAddress) ?? null
  })];
  const persistedBoundaryExposureProfiles = boundaryExposureProfiles.filter((profile) =>
    profile.contextScore > 0 && profile.flows.length > 0
  );
  const persistedWalletRoleProfiles = walletRoleProfiles.filter((profile) => profile.primaryRole !== "unknown");
  const boundaryEvidence = persistedBoundaryExposureProfiles.map((profile) => rawEvidenceForBoundaryExposure({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile
  }));
  const boundaryObservations = boundaryEvidence
    .map((evidence, index) => observationForBoundaryExposure({
      subjectAddress: input.sourceAddress,
      profile: persistedBoundaryExposureProfiles[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
  const operationalFlowEvidence = operationalFlowProfiles.map((profile) => rawEvidenceForOperationalFlow({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile
  }));
  const operationalFlowObservations = operationalFlowEvidence
    .map((evidence, index) => observationForOperationalFlow({
      subjectAddress: input.sourceAddress,
      profile: operationalFlowProfiles[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
  const walletRoleEvidence = persistedWalletRoleProfiles.map((profile) => rawEvidenceForWalletRole({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile
  }));
  const walletRoleObservations = walletRoleEvidence
    .map((evidence, index) => observationForWalletRole({
      subjectAddress: input.sourceAddress,
      profile: persistedWalletRoleProfiles[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
  const extendedProvenanceProfiles: ExtendedProvenanceProfile[] = [];
  if (deps.listIndexedUsdtTransfersForAddress && shouldRunExtendedSearch({
    mode: input.extendedSearchMode ?? "auto",
    sourceAddress: input.sourceAddress,
    sourceEdges: sourceTransfers.edges,
    exposureReport,
    inboundProfile,
    counterpartyRiskProfiles,
    approvalDrainProfile,
    triggerVolumeRaw: input.extendedSearchMinTriggerVolumeRaw ?? DEFAULT_EXTENDED_TRIGGER_VOLUME_RAW
  })) {
    const classificationCache = new Map(classifications);
    const getClassificationForAddress = async (address: string): Promise<ServiceClassification | null> => {
      if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
      const metadata = await deps.getAddressMetadata?.(address) ?? null;
      const contractProfile = metadata?.isContract === true
        ? await deps.getContractIntelligenceProfile?.(address).catch(() => null) ?? null
        : null;
      const classification = classifyServiceAddress({ address, metadata, contractProfile });
      classificationCache.set(address, classification);
      return classification;
    };
    const fetchIndexedEdges = async (address: string): Promise<ForensicRouteEdge[]> => {
      const transfers = await deps.listIndexedUsdtTransfersForAddress?.(address, {
        minTimestamp: input.windowStart,
        maxTimestamp: input.windowEnd,
        limit: input.pageLimit ?? DEFAULT_PAGE_LIMIT,
        orderBy: "amount_desc"
      }) ?? [];
      return transfers.map(indexedTransferToRouteEdge);
    };
    for (const direction of ["inbound", "outbound"] as const) {
      const profile = await runTemporalBeamSearch({
        subjectAddress: input.sourceAddress,
        direction,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        maxDepth: input.extendedSearchMaxDepth ?? 6,
        beamWidth: input.extendedSearchBeamWidth ?? 12,
        maxAddressFetches: input.extendedSearchMaxAddressFetches ?? 150,
        fetchEdgesForAddress: fetchIndexedEdges,
        getLabelsForAddress: deps.getLabelsForAddress,
        getClassificationForAddress
      });
      if (profile.paths.length > 0) extendedProvenanceProfiles.push(profile);
    }
  }
  const extendedEvidence = extendedProvenanceProfiles.map((profile) => rawEvidenceForExtendedProvenance({
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    profile
  }));
  const extendedObservations = extendedEvidence
    .map((evidence, index) => observationForExtendedProvenance({
      subjectAddress: input.sourceAddress,
      profile: extendedProvenanceProfiles[index],
      rawEvidenceId: evidence.id
    }))
    .filter((observation): observation is RiskSignalObservationInput => observation !== null);
  const missingChecks = [...new Set([
    ...exposureReport.missingChecks,
    ...transferCoverageNotes
  ])];
  const coverage = {
    sourceTransferPages: sourceTransfers.pages,
    inboundSendersExpanded,
    transferEdges: provenanceEdges.length,
    extendedIndexedEdges: extendedProvenanceProfiles.reduce((sum, profile) => sum + profile.paths.length, 0),
    extendedFetchedAddresses: extendedProvenanceProfiles.reduce((sum, profile) => sum + profile.coverage.fetchedAddressCount, 0),
    apiKeyConfigured: input.apiKeyConfigured
  };
  const coverageDebug = buildCoverageDebugSnapshot({
    subjectAddress: input.sourceAddress,
    status: null,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    sourceTransferPages: sourceTransfers.pages,
    inboundSendersExpanded,
    sourceWindowEdgeCount: sourceTransfers.windowEdgeCount,
    sourceRecentFallbackEdgeCount: sourceTransfers.recentFallbackEdgeCount,
    sourceRecentFallbackRequestedLimit: sourceTransfers.recentFallbackRequestedLimit ?? 0,
    sourceEdges: sourceTransfers.edges,
    provenanceEdges,
    expandedAddresses,
    labelsByAddress,
    classifications,
    counterpartyRiskProfiles,
    directCounterpartyInteractionProfiles,
    serviceExposureProfiles: exposureReport.serviceExposureProfiles,
    addressBehaviorProfiles: exposureReport.addressBehaviorProfiles,
    inboundProvenanceProfiles: [inboundProfile],
    boundaryExposureProfiles,
    operationalFlowProfiles,
    walletRoleProfiles,
    extendedProvenanceProfiles,
    missingChecks,
    apiKeyConfigured: input.apiKeyConfigured
  });

  return {
    ...exposureReport,
    runProfile: input.runProfile ?? "production_full",
    providerBudget: {
      providerCallBudget: input.providerCallBudget ?? null,
      transferCallBudget: input.transferCallBudget ?? null,
      contractCallBudget: input.contractCallBudget ?? null,
      approvalCallBudget: input.approvalCallBudget ?? null,
      elapsedTimeBudgetMs: input.elapsedTimeBudgetMs ?? null,
      exhausted: false
    },
    missingChecks,
    rawEvidence: [
      ...exposureReport.rawEvidence,
      inboundEvidence,
      ...counterpartyEvidence,
      ...directCounterpartyInteractionEvidence,
      ...assetContinuationAssembly.rawEvidence,
      ...(approvalDrainEvidence ? [approvalDrainEvidence] : []),
      ...(stablecoinEvidence ? [stablecoinEvidence] : []),
      ...boundaryEvidence,
      ...operationalFlowEvidence,
      ...walletRoleEvidence,
      ...extendedEvidence
    ],
    observations: [
      ...exposureReport.observations,
      ...(inboundObservation ? [inboundObservation] : []),
      ...counterpartyObservations,
      ...directCounterpartyInteractionObservations,
      ...assetContinuationAssembly.observations,
      ...(approvalDrainObservation ? [approvalDrainObservation] : []),
      ...(stablecoinObservation ? [stablecoinObservation] : []),
      ...boundaryObservations,
      ...operationalFlowObservations,
      ...walletRoleObservations,
      ...extendedObservations
    ],
    inboundProvenanceProfiles: [inboundProfile],
    counterpartyRiskProfiles,
    directCounterpartyInteractionProfiles,
    approvalDrainProvenanceProfiles: approvalDrainProfiles,
    contractDrivenReceiverProfile: contractDrivenEvidence.receiverProfile,
    contractDrivenTransferProfiles: contractDrivenEvidence.transferProfiles,
    assetContinuationProfiles: assetContinuationAssembly.profiles,
    stablecoinRestrictionProfiles: stablecoinRestrictionProfile?.isBlacklisted ? [stablecoinRestrictionProfile] : [],
    boundaryExposureProfiles,
    operationalFlowProfiles,
    walletRoleProfiles,
    extendedProvenanceProfiles,
    coverage,
    coverageDebug
  };
}
