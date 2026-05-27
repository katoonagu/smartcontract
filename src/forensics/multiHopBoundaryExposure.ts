import type {
  BoundaryExposureDepth,
  BoundaryExposureDirection,
  BoundaryExposureFlow,
  BoundaryExposureProfile,
  ForensicRouteEdge,
  RouteScoreFeature,
  ServiceCategory,
  ServiceClassification
} from "../types";
import { isServiceBoundary } from "./serviceClassifier";

export type RunMultiHopBoundaryExposureSearchInput = {
  subjectAddress: string;
  direction: BoundaryExposureDirection;
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: BoundaryExposureDepth;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  minAmountPreservationRatio?: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};

type BeamState = {
  currentAddress: string;
  pathAddresses: string[];
  pathEdges: ForensicRouteEdge[];
  baseAmountRaw: bigint;
  score: number;
};

type Coverage = NonNullable<BoundaryExposureProfile["coverage"]>;

const DEFAULT_MAX_DEPTH: BoundaryExposureDepth = 4;
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_ADDRESS_FETCHES = 60;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;

function parseAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function cappedRatio(numerator: bigint, denominator: bigint): number {
  return Math.min(1, ratio(numerator, denominator));
}

function preservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  const min = left < right ? left : right;
  const max = left > right ? left : right;
  return ratio(min, max);
}

function compareRawDesc(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function nextAddress(direction: BoundaryExposureDirection, edge: ForensicRouteEdge): string {
  return direction === "inbound" ? edge.fromAddress : edge.toAddress;
}

function followsDirection(direction: BoundaryExposureDirection, currentAddress: string, edge: ForensicRouteEdge): boolean {
  return direction === "inbound" ? edge.toAddress === currentAddress : edge.fromAddress === currentAddress;
}

function edgeTimeValid(input: {
  direction: BoundaryExposureDirection;
  previousEdge: ForensicRouteEdge | null;
  nextEdge: ForensicRouteEdge;
}): boolean {
  if (!input.previousEdge) return true;
  return input.direction === "inbound"
    ? input.nextEdge.timestamp.getTime() <= input.previousEdge.timestamp.getTime()
    : input.nextEdge.timestamp.getTime() >= input.previousEdge.timestamp.getTime();
}

function sortedCandidateEdges(input: {
  direction: BoundaryExposureDirection;
  currentAddress: string;
  edges: ForensicRouteEdge[];
  previousEdge: ForensicRouteEdge | null;
  visited: Set<string>;
  maxEdges: number;
}): ForensicRouteEdge[] {
  return input.edges
    .filter((edge) => followsDirection(input.direction, input.currentAddress, edge))
    .filter((edge) => edge.timestamp >= new Date(0))
    .filter((edge) => edgeTimeValid({ direction: input.direction, previousEdge: input.previousEdge, nextEdge: edge }))
    .filter((edge) => !input.visited.has(nextAddress(input.direction, edge)))
    .filter((edge) => parseAmount(edge.amountRaw) > 0n)
    .sort((left, right) => {
      const amountCompare = compareRawDesc(parseAmount(left.amountRaw), parseAmount(right.amountRaw));
      if (amountCompare !== 0) return amountCompare;
      const timeCompare = input.direction === "inbound"
        ? right.timestamp.getTime() - left.timestamp.getTime()
        : left.timestamp.getTime() - right.timestamp.getTime();
      if (timeCompare !== 0) return timeCompare;
      return left.txHash.localeCompare(right.txHash) || left.id.localeCompare(right.id);
    })
    .slice(0, input.maxEdges);
}

function addFeature(
  features: RouteScoreFeature[],
  code: string,
  label: string,
  scoreImpact: number,
  value?: RouteScoreFeature["value"]
): void {
  if (features.some((feature) => feature.code === code)) return;
  features.push({ code, label, scoreImpact, value });
}

function isHtxHuobi(classification: ServiceClassification | null | undefined): boolean {
  const text = `${classification?.identity ?? ""} ${classification?.evidence?.join(" ") ?? ""}`.toLowerCase();
  return /\b(htx|huobi)\b/.test(text);
}

function isBridgeDexRouter(category: ServiceCategory | null | undefined): boolean {
  return category === "bridge" ||
    category === "bridge_pool" ||
    category === "dex" ||
    category === "router" ||
    category === "swap_adapter";
}

function pathElapsedMs(edges: ForensicRouteEdge[]): number {
  if (edges.length === 0) return 0;
  const times = edges.map((edge) => edge.timestamp.getTime());
  return Math.max(...times) - Math.min(...times);
}

function chronologicalBounds(edges: ForensicRouteEdge[]): { firstTransferAt: string; lastTransferAt: string } {
  const times = edges.map((edge) => edge.timestamp.getTime());
  return {
    firstTransferAt: new Date(Math.min(...times)).toISOString(),
    lastTransferAt: new Date(Math.max(...times)).toISOString()
  };
}

function scoreState(input: {
  depth: number;
  preservation: number;
  edgeAmountRaw: bigint;
  elapsedMs: number;
  boundary: ServiceClassification | null;
}): number {
  let score = input.preservation * 100;
  if (input.edgeAmountRaw >= 100_000n * 1_000_000n) score += 15;
  else if (input.edgeAmountRaw >= 10_000n * 1_000_000n) score += 8;
  if (input.elapsedMs <= 60 * 60 * 1000) score += 10;
  else if (input.elapsedMs <= 6 * 60 * 60 * 1000) score += 6;
  else if (input.elapsedMs <= 24 * 60 * 60 * 1000) score += 3;
  if (input.boundary) {
    score += 25;
    if (isHtxHuobi(input.boundary)) score += 10;
    if (isBridgeDexRouter(input.boundary.category)) score += 8;
    if (input.boundary.category === "unknown_contract") score += 5;
  }
  score -= Math.max(0, input.depth - 1) * 3;
  return score;
}

function flowKey(flow: BoundaryExposureFlow): string {
  return [
    flow.direction,
    flow.depth,
    flow.boundaryAddress,
    flow.viaAddresses?.join(",") ?? flow.viaAddress ?? "",
    flow.subjectTxHash,
    flow.boundaryTxHash,
    flow.amountRaw,
    flow.boundaryAmountRaw
  ].join("\u0000");
}

function buildBoundaryFlow(input: {
  direction: BoundaryExposureDirection;
  boundaryAddress: string;
  boundary: ServiceClassification;
  pathAddresses: string[];
  pathEdges: ForensicRouteEdge[];
  baseAmountRaw: bigint;
  boundaryAmountRaw: bigint;
}): BoundaryExposureFlow {
  const bounds = chronologicalBounds(input.pathEdges);
  const viaAddresses = input.pathAddresses.slice(1, -1);
  const depth = input.pathEdges.length as BoundaryExposureDepth;
  const subjectEdge = input.pathEdges[0];
  const boundaryEdge = input.pathEdges[input.pathEdges.length - 1];
  return {
    direction: input.direction,
    depth,
    boundaryAddress: input.boundaryAddress,
    boundaryCategory: input.boundary.category,
    boundaryIdentity: input.boundary.identity,
    viaAddress: viaAddresses[0] ?? null,
    viaAddresses,
    subjectTxHash: subjectEdge.txHash,
    boundaryTxHash: boundaryEdge.txHash,
    amountRaw: input.baseAmountRaw.toString(),
    boundaryAmountRaw: input.boundaryAmountRaw.toString(),
    amountPreservationRatio: preservationRatio(input.baseAmountRaw, input.boundaryAmountRaw),
    firstTransferAt: bounds.firstTransferAt,
    lastTransferAt: bounds.lastTransferAt
  };
}

function buildProfileFeatures(flows: BoundaryExposureFlow[]): RouteScoreFeature[] {
  if (flows.length === 0) return [];
  const features: RouteScoreFeature[] = [];
  const maxPreservation = flows.reduce((max, flow) => Math.max(max, flow.amountPreservationRatio), 0);
  const fastestElapsedMs = Math.min(...flows.map((flow) => Date.parse(flow.lastTransferAt) - Date.parse(flow.firstTransferAt)));
  const maxDepth = flows.reduce((max, flow) => Math.max(max, flow.depth), 1);

  if (flows.some((flow) => flow.depth >= 2)) {
    addFeature(features, "boundary_exposure_multi_hop_service", "Multi-hop transfer reaches service/liquidity boundary infrastructure as operational context only.", 20, maxDepth);
  } else {
    addFeature(features, "boundary_exposure_multi_hop_service", "Transfer reaches service/liquidity boundary infrastructure as operational context only.", 12, 1);
  }
  if (flows.some((flow) => /\b(htx|huobi)\b/i.test(`${flow.boundaryIdentity ?? ""} ${flow.boundaryAddress}`))) {
    addFeature(features, "boundary_exposure_htx_huobi_terminal", "Boundary exposure reaches HTX/Huobi terminal liquidity context.", 15, true);
  }
  if (flows.some((flow) => isBridgeDexRouter(flow.boundaryCategory))) {
    addFeature(features, "boundary_exposure_bridge_dex_router_terminal", "Boundary exposure reaches bridge/DEX/router terminal liquidity context.", 15, true);
  }
  if (flows.some((flow) => flow.boundaryCategory === "unknown_contract")) {
    addFeature(features, "boundary_exposure_unknown_contract_terminal", "Boundary exposure reaches unknown contract terminal context.", 10, true);
  }
  if (maxPreservation >= 0.95) {
    addFeature(features, "boundary_exposure_preserved_amount", "Boundary path preserves most of the transferred amount.", 15, maxPreservation);
  } else if (maxPreservation >= 0.7) {
    addFeature(features, "boundary_exposure_preserved_amount", "Boundary path preserves a meaningful share of the transferred amount.", 10, maxPreservation);
  }
  if (fastestElapsedMs <= 60 * 60 * 1000) {
    addFeature(features, "boundary_exposure_fast_path", "Boundary path completes within one hour.", 5, fastestElapsedMs);
  } else if (fastestElapsedMs <= 6 * 60 * 60 * 1000) {
    addFeature(features, "boundary_exposure_fast_path", "Boundary path completes within six hours.", 3, fastestElapsedMs);
  }
  addFeature(features, "boundary_exposure_continuity_stop", "Service/liquidity boundary is operational context and stops exact taint continuity.", 0, true);
  return features;
}

function emptyProfile(subjectAddress: string, coverage: Coverage): BoundaryExposureProfile {
  return {
    subjectAddress,
    incomingBoundaryVolumeRaw: "0",
    outgoingBoundaryVolumeRaw: "0",
    incomingBoundaryVolumeRatio: 0,
    outgoingBoundaryVolumeRatio: 0,
    directBoundaryTxCount: 0,
    twoHopBoundaryTxCount: 0,
    topBoundaryEntities: [],
    categoryBreakdown: [],
    flows: [],
    contextScore: 0,
    features: [],
    coverage
  };
}

export async function runMultiHopBoundaryExposureSearch(
  input: RunMultiHopBoundaryExposureSearchInput
): Promise<BoundaryExposureProfile> {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const minPreservation = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const edgesByAddress = new Map<string, ForensicRouteEdge[]>();
  const classificationsByAddress = new Map<string, ServiceClassification | null>();
  const stoppedReasons: string[] = [];
  const flows: BoundaryExposureFlow[] = [];
  const seenFlows = new Set<string>();
  let fetchedAddressCount = 0;
  let maxDepthReached = 0;

  const addStoppedReason = (reason: string): void => {
    if (!stoppedReasons.includes(reason)) stoppedReasons.push(reason);
  };

  const fetchEdges = async (address: string): Promise<ForensicRouteEdge[]> => {
    if (edgesByAddress.has(address)) return edgesByAddress.get(address) ?? [];
    if (fetchedAddressCount >= maxAddressFetches) {
      addStoppedReason(`Multi-hop boundary search request budget exhausted before expanding ${address}`);
      return [];
    }
    fetchedAddressCount += 1;
    const edges = (await input.fetchEdgesForAddress(address))
      .filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
    edgesByAddress.set(address, edges);
    return edges;
  };

  const classificationFor = async (address: string): Promise<ServiceClassification | null> => {
    if (classificationsByAddress.has(address)) return classificationsByAddress.get(address) ?? null;
    const classification = await input.getClassificationForAddress(address);
    classificationsByAddress.set(address, classification);
    return classification;
  };

  let frontier: BeamState[] = [{
    currentAddress: input.subjectAddress,
    pathAddresses: [input.subjectAddress],
    pathEdges: [],
    baseAmountRaw: 0n,
    score: 0
  }];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const nextFrontier: BeamState[] = [];
    for (const state of frontier) {
      const currentClassification = state.currentAddress === input.subjectAddress
        ? null
        : await classificationFor(state.currentAddress);
      if (state.currentAddress !== input.subjectAddress && isServiceBoundary(currentClassification)) {
        addStoppedReason(`Multi-hop boundary expansion stopped at service boundary ${state.currentAddress} (${currentClassification?.category})`);
        continue;
      }

      const previousEdge = state.pathEdges.at(-1) ?? null;
      const visited = new Set(state.pathAddresses);
      const candidates = sortedCandidateEdges({
        direction: input.direction,
        currentAddress: state.currentAddress,
        edges: await fetchEdges(state.currentAddress),
        previousEdge,
        visited,
        maxEdges: maxEdgesPerAddress
      });

      for (const edge of candidates) {
        const destination = nextAddress(input.direction, edge);
        const boundary = await classificationFor(destination);
        const isBoundary = isServiceBoundary(boundary);
        const edgeAmountRaw = parseAmount(edge.amountRaw);
        const baseAmountRaw = state.baseAmountRaw > 0n ? state.baseAmountRaw : edgeAmountRaw;
        const preservation = preservationRatio(baseAmountRaw, edgeAmountRaw);
        if (depth > 1 && preservation < minPreservation) continue;

        const pathEdges = [...state.pathEdges, edge];
        const pathAddresses = [...state.pathAddresses, destination];
        maxDepthReached = Math.max(maxDepthReached, depth);

        if (isBoundary && boundary) {
          const flow = buildBoundaryFlow({
            direction: input.direction,
            boundaryAddress: destination,
            boundary,
            pathAddresses,
            pathEdges,
            baseAmountRaw,
            boundaryAmountRaw: edgeAmountRaw
          });
          const key = flowKey(flow);
          if (!seenFlows.has(key)) {
            seenFlows.add(key);
            flows.push(flow);
          }
          addStoppedReason(`Multi-hop boundary search reached service boundary ${destination} (${boundary.category})`);
          continue;
        }

        if (depth < maxDepth) {
          nextFrontier.push({
            currentAddress: destination,
            pathAddresses,
            pathEdges,
            baseAmountRaw,
            score: state.score + scoreState({
              depth,
              preservation,
              edgeAmountRaw,
              elapsedMs: pathElapsedMs(pathEdges),
              boundary: null
            })
          });
        }
      }
    }

    if (nextFrontier.length === 0) break;
    frontier = nextFrontier
      .sort((left, right) => right.score - left.score || left.currentAddress.localeCompare(right.currentAddress))
      .slice(0, beamWidth);
  }

  flows.sort((left, right) =>
    right.amountPreservationRatio - left.amountPreservationRatio ||
    left.depth - right.depth ||
    Date.parse(left.firstTransferAt) - Date.parse(right.firstTransferAt) ||
    left.boundaryAddress.localeCompare(right.boundaryAddress) ||
    left.subjectTxHash.localeCompare(right.subjectTxHash)
  );

  const coverage: Coverage = {
    expandedAddresses: edgesByAddress.size,
    fetchedAddressCount,
    stoppedReasons,
    maxDepthReached
  };

  if (flows.length === 0) return emptyProfile(input.subjectAddress, coverage);

  const subjectEdges = await fetchEdges(input.subjectAddress);
  const incomingSubjectVolumeRaw = subjectEdges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const outgoingSubjectVolumeRaw = subjectEdges
    .filter((edge) => edge.fromAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const incomingBoundaryVolumeRaw = flows
    .filter((flow) => flow.direction === "inbound")
    .reduce((sum, flow) => sum + parseAmount(flow.amountRaw), 0n);
  const outgoingBoundaryVolumeRaw = flows
    .filter((flow) => flow.direction === "outbound")
    .reduce((sum, flow) => sum + parseAmount(flow.amountRaw), 0n);

  const entityTotals = new Map<string, {
    address: string;
    category: ServiceCategory;
    identity: string | null;
    direction: BoundaryExposureDirection;
    volumeRaw: bigint;
    txCount: number;
    maxDepth: BoundaryExposureDepth;
  }>();
  const categoryTotals = new Map<string, {
    category: ServiceCategory;
    direction: BoundaryExposureDirection;
    volumeRaw: bigint;
    txCount: number;
  }>();

  for (const flow of flows) {
    const amountRaw = parseAmount(flow.amountRaw);
    const entityKey = `${flow.direction}\u0000${flow.boundaryAddress}\u0000${flow.boundaryCategory}\u0000${flow.boundaryIdentity ?? ""}`;
    const entity = entityTotals.get(entityKey) ?? {
      address: flow.boundaryAddress,
      category: flow.boundaryCategory,
      identity: flow.boundaryIdentity,
      direction: flow.direction,
      volumeRaw: 0n,
      txCount: 0,
      maxDepth: flow.depth
    };
    entity.volumeRaw += amountRaw;
    entity.txCount += 1;
    entity.maxDepth = entity.maxDepth < flow.depth ? flow.depth : entity.maxDepth;
    entityTotals.set(entityKey, entity);

    const categoryKey = `${flow.direction}\u0000${flow.boundaryCategory}`;
    const category = categoryTotals.get(categoryKey) ?? {
      category: flow.boundaryCategory,
      direction: flow.direction,
      volumeRaw: 0n,
      txCount: 0
    };
    category.volumeRaw += amountRaw;
    category.txCount += 1;
    categoryTotals.set(categoryKey, category);
  }

  const features = buildProfileFeatures(flows);
  const contextScore = Math.min(45, features.reduce((sum, feature) => sum + Math.max(0, feature.scoreImpact), 0));

  return {
    subjectAddress: input.subjectAddress,
    incomingBoundaryVolumeRaw: incomingBoundaryVolumeRaw.toString(),
    outgoingBoundaryVolumeRaw: outgoingBoundaryVolumeRaw.toString(),
    incomingBoundaryVolumeRatio: cappedRatio(incomingBoundaryVolumeRaw, incomingSubjectVolumeRaw),
    outgoingBoundaryVolumeRatio: cappedRatio(outgoingBoundaryVolumeRaw, outgoingSubjectVolumeRaw),
    directBoundaryTxCount: flows.filter((flow) => flow.depth === 1).length,
    twoHopBoundaryTxCount: flows.filter((flow) => flow.depth === 2).length,
    topBoundaryEntities: [...entityTotals.values()]
      .map((entity) => ({
        address: entity.address,
        category: entity.category,
        identity: entity.identity,
        direction: entity.direction,
        volumeRaw: entity.volumeRaw.toString(),
        txCount: entity.txCount,
        maxDepth: entity.maxDepth
      }))
      .sort((left, right) =>
        compareRawDesc(parseAmount(left.volumeRaw), parseAmount(right.volumeRaw)) ||
        right.txCount - left.txCount ||
        left.direction.localeCompare(right.direction) ||
        left.address.localeCompare(right.address)
      )
      .slice(0, 5),
    categoryBreakdown: [...categoryTotals.values()]
      .map((category) => ({
        category: category.category,
        direction: category.direction,
        volumeRaw: category.volumeRaw.toString(),
        txCount: category.txCount,
        volumeRatio: cappedRatio(
          category.volumeRaw,
          category.direction === "inbound" ? incomingSubjectVolumeRaw : outgoingSubjectVolumeRaw
        )
      }))
      .sort((left, right) =>
        compareRawDesc(parseAmount(left.volumeRaw), parseAmount(right.volumeRaw)) ||
        left.direction.localeCompare(right.direction) ||
        left.category.localeCompare(right.category)
      ),
    flows,
    contextScore,
    features,
    coverage
  };
}
