import { createHash } from "node:crypto";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import {
  buildApprovalDrainProvenanceProfile,
  observationForApprovalDrainProvenance,
  rawEvidenceForApprovalDrainProvenance
} from "../forensics/approvalDrainProvenance";
import { buildCounterpartyRiskProfiles } from "../forensics/counterpartyRisk";
import { buildInboundProvenanceProfile } from "../forensics/inboundProvenance";
import { FORENSIC_ROUTE_POLICY_VERSION } from "../forensics/routeScorer";
import {
  observationForStablecoinRestriction,
  rawEvidenceForStablecoinRestriction
} from "./stablecoinRestriction";
import { buildBoundaryExposureProfile } from "../forensics/boundaryExposure";
import { boundaryProfilesToOperationalEdges, buildOperationalFlowProfile } from "../forensics/flowCounterpartyProfile";
import { runMultiHopBoundaryExposureSearch } from "../forensics/multiHopBoundaryExposure";
import { buildWalletRoleProfile } from "../forensics/walletRoleClassifier";
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
  BoundaryExposureDepth,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  ExtendedProvenanceProfile,
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

export type DeepAddressForensicReport = AddressExposureReport & {
  inboundProvenanceProfiles: InboundProvenanceProfile[];
  counterpartyRiskProfiles: CounterpartyRiskProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
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
  apiKeyConfigured?: boolean;
  abortSignal?: AbortSignal;
};

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES_PER_ADDRESS = 2;
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_INBOUND_SENDERS = 5;
const DEFAULT_EXTENDED_TRIGGER_VOLUME_RAW = "100000000000";

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("deep forensic check aborted");
}

function edgeAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
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
  for (let page = 0; page < maxPages; page += 1) {
    throwIfAborted(input.abortSignal);
    const transfers = await tronClient.listRelatedTrc20Transfers(address, {
      start: page * pageLimit,
      limit: pageLimit,
      minTimestamp: input.windowStart.getTime(),
      endTimestamp: input.windowEnd.getTime()
    });
    pages += 1;
    for (const transfer of transfers as RawTronscanTrc20Transfer[]) {
      const edge = normalizeTransfer(transfer);
      if (edge) edges.push(edge);
    }
    if (transfers.length < pageLimit) break;
  }
  const minCount = input.recentFallbackMinTransferCount ?? 0;
  const fallbackLimit = input.recentFallbackTransferLimit ?? 0;
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
  const recentTransfers = await tronClient.listRelatedTrc20Transfers(address, {
    start: 0,
    limit: fallbackLimit
  });
  pages += 1;
  const recentEdges: ForensicRouteEdge[] = [];
  for (const transfer of recentTransfers as RawTronscanTrc20Transfer[]) {
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
    result.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...result.values()];
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
  const requestedDepth = Math.trunc(input.extendedSearchMaxDepth ?? 4);
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
  classifications: Map<string, ServiceClassification | null>;
}): Promise<{
  boundaryProfiles: BoundaryExposureProfile[];
  flowProfiles: OperationalFlowProfile[];
}> {
  if (!input.deps.listIndexedUsdtTransfersForAddress) return { boundaryProfiles: [], flowProfiles: [] };
  const classificationCache = new Map(input.classifications);
  const fetchEdgesForAddress = (address: string): Promise<ForensicRouteEdge[]> =>
    fetchIndexedRouteEdges(input.deps, input.runInput, address, 200, "amount_desc");
  const getClassificationForAddress = (address: string): Promise<ServiceClassification | null> =>
    getServiceClassificationForAddress(address, input.deps, classificationCache);
  const boundaryProfiles = (await Promise.all((["outbound", "inbound"] as const).map((direction) =>
    runMultiHopBoundaryExposureSearch({
      subjectAddress: input.runInput.sourceAddress,
      direction,
      windowStart: input.runInput.windowStart,
      windowEnd: input.runInput.windowEnd,
      maxDepth: operationalBoundaryDepth(input.runInput),
      beamWidth: input.runInput.extendedSearchBeamWidth ?? 8,
      maxAddressFetches: input.runInput.extendedSearchMaxAddressFetches ?? 60,
      minAmountPreservationRatio: 0.7,
      fetchEdgesForAddress,
      getClassificationForAddress
    })
  ))).filter((profile) => profile.flows.length > 0 || profile.contextScore > 0);

  const sourceIndexedEdges = await fetchEdgesForAddress(input.runInput.sourceAddress);
  const coveredTxHashes = coveredSubjectTxHashes(boundaryProfiles);
  const operationalEdges = dedupeEdges([
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
    code: input.profile.label === "darknet_exchange"
      ? "forensic_counterparty_darknet_exchange"
      : "forensic_counterparty_darknet_exchange_proximity",
    message: input.profile.label === "darknet_exchange"
      ? "Direct counterparty is a manually verified darknet exchange seed."
      : "Direct counterparty has a confirmed darknet exchange proximity marker.",
    scoreImpact: input.profile.score,
    confidence: "high",
    severity: "high",
    source: "counterparty_propagation",
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
  const exposureReport = await runForensicAddressExposureSearch({
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
  const sourceTransfers = await fetchEdgesForAddress(
    deps.tronClient,
    input,
    input.sourceAddress,
    input.maxPagesPerAddress ?? DEFAULT_MAX_PAGES_PER_ADDRESS,
    { allowRecentFallback: true }
  );
  const transferCoverageNotes = [...sourceTransfers.missingChecks];
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
  const directBoundaryExposureProfile = buildBoundaryExposureProfile({
    subjectAddress: input.sourceAddress,
    edges: provenanceEdges,
    classifications
  });
  const operationalIndexedProfiles = await buildOperationalIndexedProfiles({
    deps,
    runInput: input,
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
        maxDepth: input.extendedSearchMaxDepth ?? 4,
        beamWidth: input.extendedSearchBeamWidth ?? 8,
        maxAddressFetches: input.extendedSearchMaxAddressFetches ?? 60,
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
    missingChecks,
    rawEvidence: [
      ...exposureReport.rawEvidence,
      inboundEvidence,
      ...counterpartyEvidence,
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
      ...(approvalDrainObservation ? [approvalDrainObservation] : []),
      ...(stablecoinObservation ? [stablecoinObservation] : []),
      ...boundaryObservations,
      ...operationalFlowObservations,
      ...walletRoleObservations,
      ...extendedObservations
    ],
    inboundProvenanceProfiles: [inboundProfile],
    counterpartyRiskProfiles,
    approvalDrainProvenanceProfiles: approvalDrainProfiles,
    stablecoinRestrictionProfiles: stablecoinRestrictionProfile?.isBlacklisted ? [stablecoinRestrictionProfile] : [],
    boundaryExposureProfiles,
    operationalFlowProfiles,
    walletRoleProfiles,
    extendedProvenanceProfiles,
    coverage,
    coverageDebug
  };
}
