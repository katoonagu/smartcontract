import type {
  BoundaryExposureDepth,
  BoundaryExposureDirection,
  BoundaryExposureFlow,
  BoundaryExposureProfile,
  ForensicRouteEdge,
  RouteScoreFeature,
  ServiceClassification
} from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";
import { isServiceBoundary } from "./serviceClassifier";

export type BuildBoundaryExposureProfileInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null | undefined>;
};

type CandidateFlow = {
  flow: BoundaryExposureFlow;
  elapsedMs: number;
  boundaryAmountRaw: bigint;
};

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

function compareFlowOrder(left: BoundaryExposureFlow, right: BoundaryExposureFlow): number {
  return Date.parse(left.firstTransferAt) - Date.parse(right.firstTransferAt) ||
    Date.parse(left.lastTransferAt) - Date.parse(right.lastTransferAt) ||
    left.depth - right.depth ||
    left.direction.localeCompare(right.direction) ||
    left.boundaryAddress.localeCompare(right.boundaryAddress) ||
    left.viaAddress?.localeCompare(right.viaAddress ?? "") ||
    left.subjectTxHash.localeCompare(right.subjectTxHash) ||
    left.boundaryTxHash.localeCompare(right.boundaryTxHash);
}

function sortEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  return [...edges].sort((left, right) =>
    left.timestamp.getTime() - right.timestamp.getTime() ||
    left.id.localeCompare(right.id) ||
    left.txHash.localeCompare(right.txHash)
  );
}

function addToMap(map: Map<string, ForensicRouteEdge[]>, key: string, edge: ForensicRouteEdge): void {
  const current = map.get(key) ?? [];
  current.push(edge);
  map.set(key, current);
}

function boundaryClassification(
  classifications: Map<string, ServiceClassification | null | undefined>,
  address: string
): ServiceClassification | null {
  const classification = classifications.get(address);
  return isServiceBoundary(classification) ? classification ?? null : null;
}

function flowKey(flow: BoundaryExposureFlow): string {
  return [
    flow.direction,
    flow.depth,
    flow.boundaryAddress,
    flow.viaAddress ?? "",
    flow.subjectTxHash,
    flow.boundaryTxHash,
    flow.amountRaw,
    flow.boundaryAmountRaw
  ].join("\u0000");
}

function pushFlow(flows: BoundaryExposureFlow[], seen: Set<string>, flow: BoundaryExposureFlow): void {
  const key = flowKey(flow);
  if (seen.has(key)) return;
  seen.add(key);
  flows.push(flow);
}

function directFlow(input: {
  direction: BoundaryExposureDirection;
  boundaryAddress: string;
  boundary: ServiceClassification;
  edge: ForensicRouteEdge;
  amountRaw: bigint;
}): BoundaryExposureFlow {
  const at = input.edge.timestamp.toISOString();
  const amountRaw = input.amountRaw.toString();
  return {
    direction: input.direction,
    depth: 1,
    boundaryAddress: input.boundaryAddress,
    boundaryCategory: input.boundary.category,
    boundaryIdentity: input.boundary.identity,
    viaAddress: null,
    subjectTxHash: input.edge.txHash,
    boundaryTxHash: input.edge.txHash,
    amountRaw,
    boundaryAmountRaw: amountRaw,
    amountPreservationRatio: 1,
    firstTransferAt: at,
    lastTransferAt: at
  };
}

function twoHopFlow(input: {
  direction: BoundaryExposureDirection;
  boundaryAddress: string;
  boundary: ServiceClassification;
  viaAddress: string;
  subjectEdge: ForensicRouteEdge;
  boundaryEdge: ForensicRouteEdge;
  amountRaw: bigint;
  boundaryAmountRaw: bigint;
}): BoundaryExposureFlow {
  const firstTransferAt = input.direction === "outbound"
    ? input.subjectEdge.timestamp
    : input.boundaryEdge.timestamp;
  const lastTransferAt = input.direction === "outbound"
    ? input.boundaryEdge.timestamp
    : input.subjectEdge.timestamp;

  return {
    direction: input.direction,
    depth: 2,
    boundaryAddress: input.boundaryAddress,
    boundaryCategory: input.boundary.category,
    boundaryIdentity: input.boundary.identity,
    viaAddress: input.viaAddress,
    subjectTxHash: input.subjectEdge.txHash,
    boundaryTxHash: input.boundaryEdge.txHash,
    amountRaw: input.amountRaw.toString(),
    boundaryAmountRaw: input.boundaryAmountRaw.toString(),
    amountPreservationRatio: preservationRatio(input.amountRaw, input.boundaryAmountRaw),
    firstTransferAt: firstTransferAt.toISOString(),
    lastTransferAt: lastTransferAt.toISOString()
  };
}

function betterCandidate(left: CandidateFlow, right: CandidateFlow): CandidateFlow {
  if (left.flow.amountPreservationRatio !== right.flow.amountPreservationRatio) {
    return left.flow.amountPreservationRatio > right.flow.amountPreservationRatio ? left : right;
  }
  if (left.elapsedMs !== right.elapsedMs) return left.elapsedMs < right.elapsedMs ? left : right;
  const amountCompare = compareRawDesc(left.boundaryAmountRaw, right.boundaryAmountRaw);
  if (amountCompare !== 0) return amountCompare < 0 ? left : right;
  return compareFlowOrder(left.flow, right.flow) <= 0 ? left : right;
}

function bestOutboundTwoHop(input: {
  subjectAddress: string;
  subjectEdge: ForensicRouteEdge;
  outgoingByAddress: Map<string, ForensicRouteEdge[]>;
  classifications: Map<string, ServiceClassification | null | undefined>;
  subjectAmountRaw: bigint;
}): BoundaryExposureFlow | null {
  let best: CandidateFlow | null = null;
  for (const boundaryEdge of input.outgoingByAddress.get(input.subjectEdge.toAddress) ?? []) {
    const elapsedMs = boundaryEdge.timestamp.getTime() - input.subjectEdge.timestamp.getTime();
    if (elapsedMs < 0) continue;
    if (boundaryEdge.toAddress === input.subjectAddress) continue;
    const boundary = boundaryClassification(input.classifications, boundaryEdge.toAddress);
    if (!boundary) continue;
    const boundaryAmountRaw = parseAmount(boundaryEdge.amountRaw);
    if (boundaryAmountRaw <= 0n) continue;
    const flow = twoHopFlow({
      direction: "outbound",
      boundaryAddress: boundaryEdge.toAddress,
      boundary,
      viaAddress: input.subjectEdge.toAddress,
      subjectEdge: input.subjectEdge,
      boundaryEdge,
      amountRaw: input.subjectAmountRaw,
      boundaryAmountRaw
    });
    const candidate = { flow, elapsedMs, boundaryAmountRaw };
    best = best === null ? candidate : betterCandidate(best, candidate);
  }
  return best?.flow ?? null;
}

function bestInboundTwoHop(input: {
  subjectAddress: string;
  subjectEdge: ForensicRouteEdge;
  incomingByAddress: Map<string, ForensicRouteEdge[]>;
  classifications: Map<string, ServiceClassification | null | undefined>;
  subjectAmountRaw: bigint;
}): BoundaryExposureFlow | null {
  let best: CandidateFlow | null = null;
  for (const boundaryEdge of input.incomingByAddress.get(input.subjectEdge.fromAddress) ?? []) {
    const elapsedMs = input.subjectEdge.timestamp.getTime() - boundaryEdge.timestamp.getTime();
    if (elapsedMs < 0) continue;
    if (boundaryEdge.fromAddress === input.subjectAddress) continue;
    const boundary = boundaryClassification(input.classifications, boundaryEdge.fromAddress);
    if (!boundary) continue;
    const boundaryAmountRaw = parseAmount(boundaryEdge.amountRaw);
    if (boundaryAmountRaw <= 0n) continue;
    const flow = twoHopFlow({
      direction: "inbound",
      boundaryAddress: boundaryEdge.fromAddress,
      boundary,
      viaAddress: input.subjectEdge.fromAddress,
      subjectEdge: input.subjectEdge,
      boundaryEdge,
      amountRaw: input.subjectAmountRaw,
      boundaryAmountRaw
    });
    const candidate = { flow, elapsedMs, boundaryAmountRaw };
    best = best === null ? candidate : betterCandidate(best, candidate);
  }
  return best?.flow ?? null;
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

function buildFeatures(input: {
  flows: BoundaryExposureFlow[];
  incomingBoundaryVolumeRaw: bigint;
  outgoingBoundaryVolumeRaw: bigint;
  incomingBoundaryVolumeRatio: number;
  outgoingBoundaryVolumeRatio: number;
}): RouteScoreFeature[] {
  if (input.flows.length === 0) return [];

  const features: RouteScoreFeature[] = [];
  const directCount = input.flows.filter((flow) => flow.depth === 1).length;
  const twoHopCount = input.flows.filter((flow) => flow.depth === 2).length;
  const maxVolumeRatio = Math.max(input.incomingBoundaryVolumeRatio, input.outgoingBoundaryVolumeRatio);
  const maxBoundaryVolumeRaw = input.incomingBoundaryVolumeRaw > input.outgoingBoundaryVolumeRaw
    ? input.incomingBoundaryVolumeRaw
    : input.outgoingBoundaryVolumeRaw;
  const fastestElapsedMs = Math.min(
    ...input.flows.map((flow) => Date.parse(flow.lastTransferAt) - Date.parse(flow.firstTransferAt))
  );
  const hasExchangeIdentity = input.flows.some((flow) =>
    flow.boundaryCategory === "cex" ||
    flow.boundaryCategory === "hot_wallet" ||
    /\b(htx|bybit|binance|okx|huobi|exchange)\b/i.test(flow.boundaryIdentity ?? "")
  );

  if (directCount > 0) {
    addFeature(features, "boundary_exposure_direct_service", "Direct transfer touches service boundary infrastructure as context only.", 10, directCount);
  }
  if (twoHopCount > 0) {
    addFeature(features, "boundary_exposure_two_hop_service", "Two-hop transfer touches service boundary infrastructure as context only.", 8, twoHopCount);
  }
  if (maxVolumeRatio >= 0.5 || maxBoundaryVolumeRaw >= 100_000_000n) {
    addFeature(features, "boundary_exposure_high_volume_context", "Boundary context covers a meaningful share of subject-side volume.", 5, maxVolumeRatio);
  }
  if (fastestElapsedMs <= 60 * 60 * 1000) {
    addFeature(features, "boundary_exposure_fast_context", "Boundary context appears within one hour of the subject-side transfer.", 4, fastestElapsedMs);
  }
  if (hasExchangeIdentity) {
    addFeature(features, "boundary_exposure_exchange_identity", "Boundary context reaches identified exchange or hot-wallet infrastructure.", 5, true);
  }

  addFeature(features, "boundary_exposure_continuity_stop", "Service boundary contact is context only and stops exact taint continuity.", 0, true);
  return features;
}

export function buildBoundaryExposureProfile(input: BuildBoundaryExposureProfileInput): BoundaryExposureProfile {
  const grossSortedEdges = sortEdges(input.edges);
  const sortedEdges = grossSortedEdges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const outgoingByAddress = new Map<string, ForensicRouteEdge[]>();
  const incomingByAddress = new Map<string, ForensicRouteEdge[]>();
  for (const edge of sortedEdges) {
    addToMap(outgoingByAddress, edge.fromAddress, edge);
    addToMap(incomingByAddress, edge.toAddress, edge);
  }

  const flows: BoundaryExposureFlow[] = [];
  const seenFlowKeys = new Set<string>();

  for (const edge of sortedEdges) {
    const amountRaw = parseAmount(edge.amountRaw);
    if (amountRaw <= 0n) continue;

    if (edge.toAddress === input.subjectAddress && edge.fromAddress !== input.subjectAddress) {
      const boundary = boundaryClassification(input.classifications, edge.fromAddress);
      if (boundary) {
        pushFlow(flows, seenFlowKeys, directFlow({
          direction: "inbound",
          boundaryAddress: edge.fromAddress,
          boundary,
          edge,
          amountRaw
        }));
      }
    }

    if (edge.fromAddress === input.subjectAddress && edge.toAddress !== input.subjectAddress) {
      const boundary = boundaryClassification(input.classifications, edge.toAddress);
      if (boundary) {
        pushFlow(flows, seenFlowKeys, directFlow({
          direction: "outbound",
          boundaryAddress: edge.toAddress,
          boundary,
          edge,
          amountRaw
        }));
      }
    }
  }

  for (const subjectEdge of sortedEdges) {
    const subjectAmountRaw = parseAmount(subjectEdge.amountRaw);
    if (subjectAmountRaw <= 0n) continue;

    if (subjectEdge.fromAddress === input.subjectAddress && subjectEdge.toAddress !== input.subjectAddress) {
      if (boundaryClassification(input.classifications, subjectEdge.toAddress)) continue;
      const flow = bestOutboundTwoHop({
        subjectAddress: input.subjectAddress,
        subjectEdge,
        outgoingByAddress,
        classifications: input.classifications,
        subjectAmountRaw
      });
      if (flow) pushFlow(flows, seenFlowKeys, flow);
    }

    if (subjectEdge.toAddress === input.subjectAddress && subjectEdge.fromAddress !== input.subjectAddress) {
      if (boundaryClassification(input.classifications, subjectEdge.fromAddress)) continue;
      const flow = bestInboundTwoHop({
        subjectAddress: input.subjectAddress,
        subjectEdge,
        incomingByAddress,
        classifications: input.classifications,
        subjectAmountRaw
      });
      if (flow) pushFlow(flows, seenFlowKeys, flow);
    }
  }

  flows.sort(compareFlowOrder);

  if (flows.length === 0) {
    return {
      subjectAddress: input.subjectAddress,
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
      features: []
    };
  }

  const incomingSubjectVolumeRaw = grossSortedEdges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const outgoingSubjectVolumeRaw = grossSortedEdges
    .filter((edge) => edge.fromAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const incomingBoundaryVolumeRaw = flows
    .filter((flow) => flow.direction === "inbound")
    .reduce((sum, flow) => sum + parseAmount(flow.amountRaw), 0n);
  const outgoingBoundaryVolumeRaw = flows
    .filter((flow) => flow.direction === "outbound")
    .reduce((sum, flow) => sum + parseAmount(flow.amountRaw), 0n);
  const incomingBoundaryVolumeRatio = ratio(incomingBoundaryVolumeRaw, incomingSubjectVolumeRaw);
  const outgoingBoundaryVolumeRatio = ratio(outgoingBoundaryVolumeRaw, outgoingSubjectVolumeRaw);

  const entityTotals = new Map<string, {
    address: string;
    category: BoundaryExposureFlow["boundaryCategory"];
    identity: string | null;
    direction: BoundaryExposureDirection;
    volumeRaw: bigint;
    txCount: number;
    maxDepth: BoundaryExposureDepth;
  }>();
  const categoryTotals = new Map<string, {
    category: BoundaryExposureFlow["boundaryCategory"];
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
      maxDepth: 1 as BoundaryExposureDepth
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

  const features = buildFeatures({
    flows,
    incomingBoundaryVolumeRaw,
    outgoingBoundaryVolumeRaw,
    incomingBoundaryVolumeRatio,
    outgoingBoundaryVolumeRatio
  });
  const contextScore = Math.min(15, features.reduce((sum, feature) => sum + Math.max(0, feature.scoreImpact), 0));

  return {
    subjectAddress: input.subjectAddress,
    incomingBoundaryVolumeRaw: incomingBoundaryVolumeRaw.toString(),
    outgoingBoundaryVolumeRaw: outgoingBoundaryVolumeRaw.toString(),
    incomingBoundaryVolumeRatio,
    outgoingBoundaryVolumeRatio,
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
        volumeRatio: ratio(
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
    features
  };
}
