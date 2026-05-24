import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type {
  AddressExposureReport,
  ForensicCaseInput,
  ForensicRouteEdge,
  ForensicRoutePath,
  ServiceClassification,
  ServiceExposureProfile,
  RawEvidenceInput,
  RiskSignalObservationInput,
  RouteSearchOptions,
  RouteSearchReport
} from "../types";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { classifyServiceAddress, isServiceBoundary } from "./serviceClassifier";
import { buildServiceExposureProfile } from "./serviceExposure";
import { FORENSIC_ROUTE_POLICY_VERSION, scoreRouteCandidate, type RouteAddressMetadata } from "./routeScorer";

export type RouteSearchTronClient = {
  listRelatedTrc20Transfers(
    address: string,
    options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
  ): Promise<RawTronscanTrc20Transfer[]>;
};

type ForensicSearchDeps = {
  tronClient: RouteSearchTronClient;
  getAddressMetadata?(address: string): Promise<RouteAddressMetadata | null>;
  getContractIntelligenceProfile?(address: string): Promise<ContractRiskContext | null>;
  contractProfileFetchLimit?: number;
};

export type RunForensicRouteSearchInput = RouteSearchOptions & ForensicSearchDeps;
export type RunForensicAddressExposureSearchInput = Omit<RouteSearchOptions, "targetAddress" | "amountUsdt"> & ForensicSearchDeps;
type GraphSearchInput = RunForensicRouteSearchInput | RunForensicAddressExposureSearchInput;

type Direction = "forward" | "backward";

type GraphCollectionState = {
  metadata: Map<string, RouteAddressMetadata | null>;
  classifications: Map<string, ServiceClassification | null>;
  missingChecks: string[];
  stoppedBoundaryNotes: Set<string>;
  fetchedProfiles: number;
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isOfficialSuccessfulTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  const tokenId = transfer.contract_address ?? transfer.tokenInfo?.tokenId;
  if (tokenId !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") return false;
  return true;
}

function transferMethod(transfer: RawTronscanTrc20Transfer): { method: string; edgeType: ForensicRouteEdge["edgeType"] } {
  const trigger = isObjectRecord(transfer.trigger_info) ? transfer.trigger_info : {};
  const text = [
    stringField(trigger.methodName),
    stringField(trigger.method),
    stringField(trigger.methodId)
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("transferfrom") || text.includes("23b872dd")) {
    return { method: "transferFrom", edgeType: "transfer_from" };
  }
  return { method: text || "transfer", edgeType: "normal_transfer" };
}

function normalizeTransfer(transfer: RawTronscanTrc20Transfer): ForensicRouteEdge | null {
  if (!isOfficialSuccessfulTransfer(transfer)) return null;
  if (!stringField(transfer.transaction_id)) return null;
  if (!stringField(transfer.from_address) || !stringField(transfer.to_address)) return null;
  if (!/^\d+$/.test(transfer.quant)) return null;
  if (typeof transfer.block_ts !== "number" || !Number.isFinite(transfer.block_ts)) return null;
  const timestamp = new Date(transfer.block_ts);
  if (Number.isNaN(timestamp.getTime())) return null;
  const method = transferMethod(transfer);
  return {
    id: stableId(["forensic_route_edge", transfer.transaction_id, transfer.from_address, transfer.to_address, transfer.quant]),
    fromAddress: transfer.from_address,
    toAddress: transfer.to_address,
    txHash: transfer.transaction_id,
    amountRaw: transfer.quant,
    timestamp,
    method: method.method,
    edgeType: method.edgeType
  };
}

function amountUsdtToRaw(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Amount must be a positive USDT value with up to 6 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return `${whole}${fraction.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "") || "0";
}

async function fetchAddressEdges(input: GraphSearchInput, address: string): Promise<ForensicRouteEdge[]> {
  const edges: ForensicRouteEdge[] = [];
  for (let page = 0; page < input.maxPagesPerAddress; page += 1) {
    const transfers = await input.tronClient.listRelatedTrc20Transfers(address, {
      start: page * input.pageLimit,
      limit: input.pageLimit,
      minTimestamp: input.windowStart.getTime(),
      endTimestamp: input.windowEnd.getTime()
    });
    for (const transfer of transfers) {
      const edge = normalizeTransfer(transfer);
      if (edge) edges.push(edge);
    }
    if (transfers.length < input.pageLimit) break;
  }
  return edges;
}

async function expansionBoundaryClassification(
  input: GraphSearchInput,
  state: GraphCollectionState,
  address: string
): Promise<ServiceClassification | null> {
  if (state.classifications.has(address)) {
    return state.classifications.get(address) ?? null;
  }

  let metadata = state.metadata.get(address);
  if (metadata === undefined) {
    metadata = input.getAddressMetadata ? await input.getAddressMetadata(address) : null;
    state.metadata.set(address, metadata);
  }

  let contractProfile: ContractRiskContext | null = null;
  const profileLimit = input.contractProfileFetchLimit ?? 20;
  if (input.getContractIntelligenceProfile && metadata?.isContract === true && state.fetchedProfiles < profileLimit) {
    try {
      contractProfile = await input.getContractIntelligenceProfile(address);
      state.fetchedProfiles += 1;
    } catch (error) {
      state.missingChecks.push(`Contract intelligence unavailable for ${address}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const classification = classifyServiceAddress({ address, metadata, contractProfile });
  state.classifications.set(address, classification);
  return classification;
}

async function shouldStopAtServiceBoundary(
  input: GraphSearchInput,
  state: GraphCollectionState,
  item: { address: string; depth: number; direction: Direction }
): Promise<boolean> {
  if (item.address === input.sourceAddress) return false;

  const classification = await expansionBoundaryClassification(input, state, item.address);
  if (classification === null || !isServiceBoundary(classification)) return false;

  const note = `Expansion stopped at service boundary ${item.address} (${classification.category})`;
  if (!state.stoppedBoundaryNotes.has(note)) {
    state.stoppedBoundaryNotes.add(note);
    state.missingChecks.push(note);
  }
  return true;
}

async function collectGraph(
  input: GraphSearchInput,
  options: { targetAddress?: string | null } = {}
): Promise<{ edges: Map<string, ForensicRouteEdge>; missingChecks: string[] }> {
  const byKey = new Map<string, ForensicRouteEdge>();
  const seen = new Set<string>();
  const state: GraphCollectionState = {
    metadata: new Map(),
    classifications: new Map(),
    missingChecks: [],
    stoppedBoundaryNotes: new Set(),
    fetchedProfiles: 0
  };
  const queue: Array<{ address: string; depth: number; direction: Direction }> = [
    { address: input.sourceAddress, depth: 0, direction: "forward" }
  ];
  if (options.targetAddress) {
    queue.push({ address: options.targetAddress, depth: 0, direction: "backward" });
  }

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    const seenKey = `${item.direction}:${item.address}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    if (item.depth >= input.maxDepth) continue;
    if (await shouldStopAtServiceBoundary(input, state, item)) continue;

    const edges = await fetchAddressEdges(input, item.address);
    for (const edge of edges) {
      byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
      const nextAddress = item.direction === "forward" ? edge.toAddress : edge.fromAddress;
      if (nextAddress !== item.address && item.depth + 1 < input.maxDepth) {
        queue.push({ address: nextAddress, depth: item.depth + 1, direction: item.direction });
      }
    }
  }

  return { edges: byKey, missingChecks: state.missingChecks };
}

function adjacency(edges: Iterable<ForensicRouteEdge>): Map<string, ForensicRouteEdge[]> {
  const result = new Map<string, ForensicRouteEdge[]>();
  for (const edge of edges) {
    const current = result.get(edge.fromAddress) ?? [];
    current.push(edge);
    result.set(edge.fromAddress, current);
  }
  for (const current of result.values()) {
    current.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  return result;
}

function buildCandidateEdgePaths(input: {
  sourceAddress: string;
  targetAddress: string;
  edges: ForensicRouteEdge[];
  addressClassifications: Map<string, ServiceClassification | null>;
  maxDepth: number;
  limit: number;
}): ForensicRouteEdge[][] {
  const graph = adjacency(input.edges);
  const exact: ForensicRouteEdge[][] = [];
  const partial: ForensicRouteEdge[][] = [];

  const walk = (address: string, path: ForensicRouteEdge[], visited: Set<string>) => {
    if (path.length > 0 && address === input.targetAddress) {
      exact.push(path);
      return;
    }
    const addressClassification = input.addressClassifications.get(address) ?? null;
    if (path.length > 0 && isServiceBoundary(addressClassification)) {
      partial.push(path);
      return;
    }
    if (path.length >= input.maxDepth) {
      if (path.length > 0) partial.push(path);
      return;
    }
    const outgoing = graph.get(address) ?? [];
    if (outgoing.length === 0 && path.length > 0) partial.push(path);
    let traversed = false;
    for (const edge of outgoing) {
      if (visited.has(edge.toAddress)) continue;
      const previous = path.at(-1);
      if (previous && edge.timestamp.getTime() < previous.timestamp.getTime()) continue;
      traversed = true;
      walk(edge.toAddress, [...path, edge], new Set([...visited, edge.toAddress]));
    }
    if (!traversed && outgoing.length > 0 && path.length > 0) partial.push(path);
  };

  walk(input.sourceAddress, [], new Set([input.sourceAddress]));
  const candidates = exact.length > 0 ? exact : partial;
  return candidates.slice(0, Math.max(input.limit * 4, input.limit));
}

async function metadataForPaths(
  paths: ForensicRouteEdge[][],
  getAddressMetadata?: (address: string) => Promise<RouteAddressMetadata | null>
): Promise<Map<string, RouteAddressMetadata | null>> {
  const metadata = new Map<string, RouteAddressMetadata | null>();
  if (!getAddressMetadata) return metadata;
  const addresses = new Set(paths.flatMap((path) => path.flatMap((edge) => [edge.fromAddress, edge.toAddress])));
  for (const address of addresses) {
    metadata.set(address, await getAddressMetadata(address));
  }
  return metadata;
}

async function metadataForAddresses(
  addresses: Iterable<string>,
  getAddressMetadata?: (address: string) => Promise<RouteAddressMetadata | null>
): Promise<Map<string, RouteAddressMetadata | null>> {
  const metadata = new Map<string, RouteAddressMetadata | null>();
  if (!getAddressMetadata) return metadata;
  for (const address of new Set(addresses)) {
    metadata.set(address, await getAddressMetadata(address));
  }
  return metadata;
}

function exposureAddresses(sourceAddress: string, edges: ForensicRouteEdge[]): Set<string> {
  const addresses = new Set<string>();
  const firstHopReceivers = new Set<string>();
  for (const edge of edges) {
    if (edge.fromAddress === sourceAddress) {
      addresses.add(edge.toAddress);
      firstHopReceivers.add(edge.toAddress);
    }
  }
  for (const edge of edges) {
    if (firstHopReceivers.has(edge.fromAddress)) {
      addresses.add(edge.toAddress);
    }
  }
  return addresses;
}

function graphAddresses(edges: ForensicRouteEdge[]): Set<string> {
  const addresses = new Set<string>();
  for (const edge of edges) {
    addresses.add(edge.fromAddress);
    addresses.add(edge.toAddress);
  }
  return addresses;
}

async function classificationsForAddresses(input: {
  addresses: Iterable<string>;
  metadata: Map<string, RouteAddressMetadata | null>;
  getContractIntelligenceProfile?: (address: string) => Promise<ContractRiskContext | null>;
  contractProfileFetchLimit?: number;
}): Promise<{ classifications: Map<string, ServiceClassification | null>; missingChecks: string[] }> {
  const classifications = new Map<string, ServiceClassification | null>();
  const missingChecks: string[] = [];
  let fetchedProfiles = 0;
  const profileLimit = input.contractProfileFetchLimit ?? 20;

  for (const address of new Set(input.addresses)) {
    const metadata = input.metadata.get(address) ?? null;
    let contractProfile: ContractRiskContext | null = null;
    if (input.getContractIntelligenceProfile && metadata?.isContract === true && fetchedProfiles < profileLimit) {
      try {
        contractProfile = await input.getContractIntelligenceProfile(address);
        fetchedProfiles += 1;
      } catch (error) {
        missingChecks.push(`Contract intelligence unavailable for ${address}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    classifications.set(address, classifyServiceAddress({ address, metadata, contractProfile }));
  }

  return { classifications, missingChecks };
}

function rawEvidenceForPath(input: {
  caseId: string;
  pathId: string;
  sourceAddress: string;
  edges: ForensicRouteEdge[];
  pathAddresses: string[];
  features: unknown[];
}): RawEvidenceInput {
  return {
    id: stableId(["forensic_route_raw", input.caseId, input.pathId]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.sourceAddress,
    txHash: input.edges[0]?.txHash ?? null,
    observedTransactionHash: input.edges[0]?.txHash ?? null,
    evidenceJson: {
      caseId: input.caseId,
      pathId: input.pathId,
      pathAddresses: input.pathAddresses,
      edges: input.edges.map((edge) => ({
        txHash: edge.txHash,
        fromAddress: edge.fromAddress,
        toAddress: edge.toAddress,
        amountRaw: edge.amountRaw,
        timestamp: edge.timestamp.toISOString(),
        method: edge.method,
        edgeType: edge.edgeType
      })),
      features: input.features
    }
  };
}

function observationForPath(input: {
  caseId: string;
  path: ForensicRoutePath;
  targetAddress: string;
}): RiskSignalObservationInput {
  return {
    id: stableId(["forensic_route_observation", input.caseId, input.path.id, FORENSIC_ROUTE_POLICY_VERSION]),
    subjectChain: "tron",
    subjectAddress: input.targetAddress,
    subjectTxHash: null,
    observedTransactionHash: input.path.edges[0]?.txHash ?? null,
    signalGroup: "graph",
    code: "forensic_route_candidate",
    message: `Candidate path links source to target for manual review (${input.path.confidence} confidence)`,
    scoreImpact: input.path.score,
    confidence: input.path.confidence,
    severity: input.path.score >= 85 ? "critical" : input.path.score >= 60 ? "high" : input.path.score >= 30 ? "medium" : "info",
    source: "forensic_route_search",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.path.rawEvidenceId
  };
}

function rawEvidenceForServiceExposure(input: {
  caseId: string;
  sourceAddress: string;
  profile: ServiceExposureProfile;
}): RawEvidenceInput {
  return {
    id: stableId(["forensic_service_exposure_raw", input.caseId, input.profile.subjectAddress]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.profile.subjectAddress,
    txHash: null,
    observedTransactionHash: null,
    evidenceJson: {
      caseId: input.caseId,
      sourceAddress: input.sourceAddress,
      serviceExposureProfile: input.profile
    }
  };
}

function observationForServiceExposure(input: {
  caseId: string;
  profile: ServiceExposureProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (input.profile.exposureScore <= 0) return null;
  return {
    id: stableId(["forensic_service_exposure_observation", input.caseId, input.profile.subjectAddress, FORENSIC_ROUTE_POLICY_VERSION]),
    subjectChain: "tron",
    subjectAddress: input.profile.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: null,
    signalGroup: "graph",
    code: "forensic_service_exposure",
    message: `Service exposure profile requires manual review (${Math.round(input.profile.combinedServiceVolumeRatio * 100)}% outgoing USDT volume reaches service infrastructure)`,
    scoreImpact: input.profile.exposureScore,
    confidence: input.profile.exposureScore >= 60 ? "high" : "medium",
    severity: input.profile.exposureScore >= 85 ? "critical" : input.profile.exposureScore >= 60 ? "high" : input.profile.exposureScore >= 30 ? "medium" : "info",
    source: "forensic_route_search",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

export async function runForensicRouteSearch(input: RunForensicRouteSearchInput): Promise<RouteSearchReport> {
  const amountRaw = amountUsdtToRaw(input.amountUsdt);
  const caseId = stableId([
    "forensic_case",
    input.sourceAddress,
    input.targetAddress,
    input.amountUsdt ?? null,
    input.windowStart.toISOString(),
    input.windowEnd.toISOString(),
    input.maxDepth
  ]);
  const graphCollection = await collectGraph(input, { targetAddress: input.targetAddress });
  const graphEdges = [...graphCollection.edges.values()];
  const metadataAddresses = new Set([
    ...graphAddresses(graphEdges),
    ...exposureAddresses(input.sourceAddress, graphEdges)
  ]);
  const metadata = await metadataForAddresses(metadataAddresses, input.getAddressMetadata);
  const classificationResult = await classificationsForAddresses({
    addresses: metadataAddresses,
    metadata,
    getContractIntelligenceProfile: input.getContractIntelligenceProfile,
    contractProfileFetchLimit: input.contractProfileFetchLimit
  });
  const candidateEdgePaths = buildCandidateEdgePaths({
    sourceAddress: input.sourceAddress,
    targetAddress: input.targetAddress,
    edges: graphEdges,
    addressClassifications: classificationResult.classifications,
    maxDepth: input.maxDepth,
    limit: input.limit
  });
  const serviceExposureProfiles = [
    buildServiceExposureProfile({
      subjectAddress: input.sourceAddress,
      edges: graphEdges,
      classifications: classificationResult.classifications
    })
  ];
  const scored = candidateEdgePaths.map((edges) => ({
    edges,
    score: scoreRouteCandidate({
      sourceAddress: input.sourceAddress,
      targetAddress: input.targetAddress,
      targetAmountRaw: amountRaw,
      edges,
      addressMetadata: metadata,
      addressClassifications: classificationResult.classifications
    })
  }));
  scored.sort((a, b) => b.score.score - a.score.score || a.edges.length - b.edges.length);

  const serviceExposureEvidence = serviceExposureProfiles.map((profile) => rawEvidenceForServiceExposure({
    caseId,
    sourceAddress: input.sourceAddress,
    profile
  }));
  const rawEvidence: RawEvidenceInput[] = [...serviceExposureEvidence];
  const paths: ForensicRoutePath[] = scored.slice(0, input.limit).map((item, index) => {
    const pathId = stableId(["forensic_route_path", caseId, item.edges.map((edge) => edge.id)]);
    const evidence = rawEvidenceForPath({
      caseId,
      pathId,
      sourceAddress: input.sourceAddress,
      edges: item.edges,
      pathAddresses: item.score.pathAddresses,
      features: item.score.features
    });
    rawEvidence.push(evidence);
    return {
      id: pathId,
      caseId,
      rank: index + 1,
      score: item.score.score,
      confidence: item.score.confidence,
      pathAddresses: item.score.pathAddresses,
      features: item.score.features,
      reasons: item.score.reasons,
      rawEvidenceId: evidence.id,
      edges: item.edges
    };
  });
  const observations = [
    ...paths.map((path) => observationForPath({ caseId, path, targetAddress: input.targetAddress })),
    ...serviceExposureProfiles.map((profile, index) => observationForServiceExposure({
      caseId,
      profile,
      rawEvidenceId: serviceExposureEvidence[index].id
    })).filter((item): item is RiskSignalObservationInput => item !== null)
  ];
  const exactPathFound = paths.some((path) => path.pathAddresses.at(-1) === input.targetAddress);
  const forensicCase: ForensicCaseInput = {
    id: caseId,
    sourceAddress: input.sourceAddress,
    targetAddress: input.targetAddress,
    amountUsdt: input.amountUsdt ?? null,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    status: exactPathFound ? "completed" : paths.length > 0 ? "partial" : "failed"
  };

  return {
    case: forensicCase,
    paths,
    rawEvidence,
    observations,
    missingChecks: [
      ...(exactPathFound ? [] : ["No exact source-to-target path found within configured depth/page caps."]),
      ...graphCollection.missingChecks,
      ...classificationResult.missingChecks
    ],
    serviceExposureProfiles
  };
}

export async function runForensicAddressExposureSearch(input: RunForensicAddressExposureSearchInput): Promise<AddressExposureReport> {
  const caseId = stableId([
    "forensic_address_exposure",
    input.sourceAddress,
    input.windowStart.toISOString(),
    input.windowEnd.toISOString(),
    input.maxDepth
  ]);
  const graphCollection = await collectGraph(input);
  const graphEdges = [...graphCollection.edges.values()];
  const metadataAddresses = exposureAddresses(input.sourceAddress, graphEdges);
  const metadata = await metadataForAddresses(metadataAddresses, input.getAddressMetadata);
  const classificationResult = await classificationsForAddresses({
    addresses: metadataAddresses,
    metadata,
    getContractIntelligenceProfile: input.getContractIntelligenceProfile,
    contractProfileFetchLimit: input.contractProfileFetchLimit
  });
  const serviceExposureProfiles = [
    buildServiceExposureProfile({
      subjectAddress: input.sourceAddress,
      edges: graphEdges,
      classifications: classificationResult.classifications
    })
  ];
  const rawEvidence = serviceExposureProfiles.map((profile) => rawEvidenceForServiceExposure({
    caseId,
    sourceAddress: input.sourceAddress,
    profile
  }));
  const observations = serviceExposureProfiles.map((profile, index) => observationForServiceExposure({
    caseId,
    profile,
    rawEvidenceId: rawEvidence[index].id
  })).filter((item): item is RiskSignalObservationInput => item !== null);

  return {
    subjectAddress: input.sourceAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    rawEvidence,
    observations,
    missingChecks: [
      ...graphCollection.missingChecks,
      ...classificationResult.missingChecks
    ],
    serviceExposureProfiles
  };
}
