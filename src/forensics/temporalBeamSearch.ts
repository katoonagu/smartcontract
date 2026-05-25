import type {
  AddressLabel,
  ExtendedProvenanceDirection,
  ExtendedProvenancePath,
  ExtendedProvenanceProfile,
  ForensicRouteEdge,
  RiskLabel,
  RouteScoreFeature,
  ServiceClassification
} from "../types";

export type TemporalBeamSearchInput = {
  subjectAddress: string;
  direction: ExtendedProvenanceDirection;
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  minAmountPreservationRatio?: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress?(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress?(address: string): Promise<ServiceClassification | null>;
};

type BeamState = {
  currentAddress: string;
  pathEdges: ForensicRouteEdge[];
  pathAddresses: string[];
  baseAmount: bigint;
  score: number;
  stopped: boolean;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_ADDRESS_FETCHES = 60;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;
const criticalLabels = new Set<RiskLabel>([
  "scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange",
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

function edgeAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  return left <= right ? ratio(left, right) : ratio(right, left);
}

function sumAmounts(edges: ForensicRouteEdge[]): bigint {
  return edges.reduce((sum, edge) => sum + edgeAmount(edge), 0n);
}

function selectedLabel(labels: AddressLabel[]): AddressLabel | null {
  return labels.find((label) => label.label === "darknet_exchange") ??
    labels.find((label) => criticalLabels.has(label.label)) ??
    null;
}

function isBoundary(classification: ServiceClassification | null): boolean {
  return Boolean(classification && classification.isBoundary && classification.category !== "none");
}

function addFeature(features: RouteScoreFeature[], code: string, label: string, scoreImpact: number, value?: string | number | boolean): void {
  if (features.some((feature) => feature.code === code)) return;
  features.push({ code, label, scoreImpact, value });
}

function edgeTimeValid(input: {
  direction: ExtendedProvenanceDirection;
  previousEdge: ForensicRouteEdge | null;
  nextEdge: ForensicRouteEdge;
}): boolean {
  if (!input.previousEdge) return true;
  if (input.direction === "inbound") {
    return input.nextEdge.timestamp.getTime() <= input.previousEdge.timestamp.getTime();
  }
  return input.nextEdge.timestamp.getTime() >= input.previousEdge.timestamp.getTime();
}

function nextAddress(direction: ExtendedProvenanceDirection, edge: ForensicRouteEdge): string {
  return direction === "inbound" ? edge.fromAddress : edge.toAddress;
}

function candidateEdges(input: {
  direction: ExtendedProvenanceDirection;
  currentAddress: string;
  edges: ForensicRouteEdge[];
  previousEdge: ForensicRouteEdge | null;
  visited: Set<string>;
  maxEdges: number;
}): ForensicRouteEdge[] {
  const filtered = input.edges
    .filter((edge) => input.direction === "inbound" ? edge.toAddress === input.currentAddress : edge.fromAddress === input.currentAddress)
    .filter((edge) => edgeTimeValid({ direction: input.direction, previousEdge: input.previousEdge, nextEdge: edge }))
    .filter((edge) => !input.visited.has(nextAddress(input.direction, edge)))
    .sort((a, b) => {
      const byAmount = edgeAmount(b) - edgeAmount(a);
      if (byAmount !== 0n) return byAmount > 0n ? 1 : -1;
      return input.direction === "inbound"
        ? b.timestamp.getTime() - a.timestamp.getTime()
        : a.timestamp.getTime() - b.timestamp.getTime();
    });
  return filtered.slice(0, input.maxEdges);
}

function scoreCandidate(input: {
  edge: ForensicRouteEdge;
  previousEdge: ForensicRouteEdge | null;
  baseAmount: bigint;
  label: AddressLabel | null;
  classification: ServiceClassification | null;
  depth: number;
}): { score: number; preservation: number; features: RouteScoreFeature[] } {
  const features: RouteScoreFeature[] = [];
  const amount = edgeAmount(input.edge);
  let score = 0;

  if (amount >= 100_000n * 1_000_000n) {
    score += 20;
    addFeature(features, "extended_absolute_amount_high", "Large absolute USDT amount in extended path.", 20);
  } else if (amount >= 10_000n * 1_000_000n) {
    score += 10;
    addFeature(features, "extended_absolute_amount_medium", "Meaningful absolute USDT amount in extended path.", 10);
  }

  const preservation = input.previousEdge
    ? preservationRatio(edgeAmount(input.previousEdge), amount)
    : preservationRatio(input.baseAmount, amount);
  if (preservation >= 0.95) {
    score += 25;
    addFeature(features, "extended_amount_preserved_strong", "Extended path preserves most of the USDT amount.", 25, preservation);
  } else if (preservation >= 0.7) {
    score += 15;
    addFeature(features, "extended_amount_preserved", "Extended path has meaningful amount preservation.", 15, preservation);
  }

  if (input.previousEdge) {
    const deltaMs = Math.abs(input.edge.timestamp.getTime() - input.previousEdge.timestamp.getTime());
    if (deltaMs <= 60 * 60 * 1000) {
      score += 15;
      addFeature(features, "extended_time_proximity_1h", "Extended path hop occurs within 1 hour.", 15);
    } else if (deltaMs <= 6 * 60 * 60 * 1000) {
      score += 10;
      addFeature(features, "extended_time_proximity_6h", "Extended path hop occurs within 6 hours.", 10);
    } else if (deltaMs <= 24 * 60 * 60 * 1000) {
      score += 5;
      addFeature(features, "extended_time_proximity_24h", "Extended path hop occurs within 24 hours.", 5);
    }
  }

  if (input.edge.edgeType === "transfer_from") {
    score += 15;
    addFeature(features, "extended_transfer_from_edge", "Extended path includes transferFrom evidence.", 15);
  }
  if (input.label) {
    score += input.label.label === "darknet_exchange" ? 40 : 25;
    addFeature(features, "extended_known_label", `Extended path reaches ${input.label.label} label.`, input.label.label === "darknet_exchange" ? 40 : 25);
  }
  if (isBoundary(input.classification)) {
    score -= 20;
    addFeature(features, "extended_service_boundary_stop", "Service/CEX/bridge boundary reached; proof stops here.", 0, input.classification?.category);
  }
  score -= Math.max(0, input.depth - 2) * 5;

  return { score: Math.max(0, Math.min(100, score)), preservation, features };
}

function pathScore(input: {
  depth: number;
  label: AddressLabel | null;
  boundary: ServiceClassification | null;
  candidateScore: number;
  preservation: number;
}): number {
  if (!input.label) return 0;
  if (isBoundary(input.boundary) && input.label.label !== "darknet_exchange") return 0;
  if (input.depth <= 2) return input.label.label === "darknet_exchange" ? 50 : 40;
  if (input.depth <= 4 && input.preservation >= 0.95) return input.label.label === "darknet_exchange" ? 70 : 60;
  if (input.depth <= 4 && input.preservation >= 0.7) return input.label.label === "darknet_exchange" ? 60 : 55;
  return 0;
}

export async function runTemporalBeamSearch(input: TemporalBeamSearchInput): Promise<ExtendedProvenanceProfile> {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const minPreservation = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const edgesByAddress = new Map<string, ForensicRouteEdge[]>();
  const labelsByAddress = new Map<string, AddressLabel[]>();
  const classificationsByAddress = new Map<string, ServiceClassification | null>();
  const stoppedReasons: string[] = [];
  let fetchedAddressCount = 0;
  let maxDepthReached = 0;

  const fetchEdges = async (address: string): Promise<ForensicRouteEdge[]> => {
    if (edgesByAddress.has(address)) return edgesByAddress.get(address) ?? [];
    if (fetchedAddressCount >= maxAddressFetches) {
      const reason = `Extended search request budget exhausted before expanding ${address}`;
      if (!stoppedReasons.includes(reason)) stoppedReasons.push(reason);
      return [];
    }
    fetchedAddressCount += 1;
    const edges = (await input.fetchEdgesForAddress(address))
      .filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
    edgesByAddress.set(address, edges);
    return edges;
  };

  const labelsFor = async (address: string): Promise<AddressLabel[]> => {
    if (labelsByAddress.has(address)) return labelsByAddress.get(address) ?? [];
    const labels = await input.getLabelsForAddress?.(address) ?? [];
    labelsByAddress.set(address, labels);
    return labels;
  };

  const classificationFor = async (address: string): Promise<ServiceClassification | null> => {
    if (classificationsByAddress.has(address)) return classificationsByAddress.get(address) ?? null;
    const classification = await input.getClassificationForAddress?.(address) ?? null;
    classificationsByAddress.set(address, classification);
    return classification;
  };

  let frontier: BeamState[] = [{
    currentAddress: input.subjectAddress,
    pathEdges: [],
    pathAddresses: [input.subjectAddress],
    baseAmount: 0n,
    score: 0,
    stopped: false
  }];
  const paths: ExtendedProvenancePath[] = [];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const nextFrontier: BeamState[] = [];
    for (const state of frontier) {
      if (state.stopped) continue;
      const currentClassification = await classificationFor(state.currentAddress);
      if (state.currentAddress !== input.subjectAddress && isBoundary(currentClassification)) {
        const reason = `Extended expansion stopped at service boundary ${state.currentAddress} (${currentClassification?.category})`;
        if (!stoppedReasons.includes(reason)) stoppedReasons.push(reason);
        continue;
      }
      const edges = await fetchEdges(state.currentAddress);
      const previousEdge = state.pathEdges.at(-1) ?? null;
      const visited = new Set(state.pathAddresses);
      const candidates = candidateEdges({
        direction: input.direction,
        currentAddress: state.currentAddress,
        edges,
        previousEdge,
        visited,
        maxEdges: maxEdgesPerAddress
      });
      for (const edge of candidates) {
        const destination = nextAddress(input.direction, edge);
        const labels = await labelsFor(destination);
        const label = selectedLabel(labels);
        const classification = await classificationFor(destination);
        const baseAmount = state.baseAmount > 0n ? state.baseAmount : edgeAmount(edge);
        const scored = scoreCandidate({ edge, previousEdge, baseAmount, label, classification, depth });
        if (depth > 1 && scored.preservation < minPreservation && !label) continue;
        const pathEdges = [...state.pathEdges, edge];
        const pathAddresses = [...state.pathAddresses, destination];
        const pathAmount = edgeAmount(pathEdges.at(-1) ?? edge);
        const first = pathEdges[0];
        const last = pathEdges.at(-1) ?? first;
        const boundary = isBoundary(classification) ? classification : null;
        const evidenceStrength = label
          ? "exact_labeled_path"
          : boundary
            ? "service_boundary_context"
            : "weak_inferred_candidate";
        const riskScore = pathScore({
          depth,
          label,
          boundary,
          candidateScore: scored.score,
          preservation: scored.preservation
        });
        paths.push({
          direction: input.direction,
          depth,
          pathAddresses,
          txHashes: pathEdges.map((item) => item.txHash),
          amountRaw: pathAmount.toString(),
          amountPreservationRatio: scored.preservation,
          firstTransferAt: first.timestamp.toISOString(),
          lastTransferAt: last.timestamp.toISOString(),
          label: label?.label ?? null,
          labelAddress: label?.address ?? null,
          boundaryCategory: boundary?.category ?? null,
          evidenceStrength,
          candidateScore: Math.max(riskScore, scored.score),
          features: scored.features
        });
        if (!boundary && depth < maxDepth) {
          nextFrontier.push({
            currentAddress: destination,
            pathEdges,
            pathAddresses,
            baseAmount,
            score: scored.score + state.score,
            stopped: false
          });
        } else if (boundary) {
          const reason = `Extended path reached service boundary ${destination} (${boundary.category})`;
          if (!stoppedReasons.includes(reason)) stoppedReasons.push(reason);
        }
      }
    }
    if (nextFrontier.length === 0) break;
    maxDepthReached = depth;
    frontier = nextFrontier
      .sort((a, b) => b.score - a.score)
      .slice(0, beamWidth);
  }

  const sortedPaths = paths
    .sort((a, b) => b.candidateScore - a.candidateScore || b.amountPreservationRatio - a.amountPreservationRatio)
    .slice(0, beamWidth);
  const exactPaths = sortedPaths.filter((path) => path.evidenceStrength === "exact_labeled_path" && path.candidateScore > 0);
  const matchedVolume = sumAmounts(exactPaths.map((path) => ({
    id: path.txHashes.at(-1) ?? path.pathAddresses.join(":"),
    txHash: path.txHashes.at(-1) ?? "",
    fromAddress: "",
    toAddress: "",
    amountRaw: path.amountRaw,
    timestamp: new Date(path.lastTransferAt),
    method: "transfer",
    edgeType: "normal_transfer"
  })));
  const sourceEdges = await fetchEdges(input.subjectAddress);
  const directionalVolume = sourceEdges
    .filter((edge) => input.direction === "inbound" ? edge.toAddress === input.subjectAddress : edge.fromAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + edgeAmount(edge), 0n);
  const profileFeatures: RouteScoreFeature[] = [];
  if (exactPaths.some((path) => path.depth >= 3 && path.depth <= 4)) {
    addFeature(profileFeatures, "extended_3_4_hop_labeled_provenance", "Extended search found exact labeled provenance within 3-4 hops.", 0);
  }
  if (sortedPaths.some((path) => path.evidenceStrength === "service_boundary_context")) {
    addFeature(profileFeatures, "extended_service_boundary_context", "Extended search reached a service/CEX/bridge boundary.", 0);
  }

  return {
    subjectAddress: input.subjectAddress,
    direction: input.direction,
    maxDepth,
    paths: sortedPaths,
    matchedVolumeRaw: matchedVolume.toString(),
    matchedVolumeRatio: directionalVolume > 0n ? ratio(matchedVolume, directionalVolume) : 0,
    score: exactPaths.reduce((max, path) => Math.max(max, Math.min(70, path.candidateScore)), 0),
    features: profileFeatures,
    coverage: {
      expandedAddresses: edgesByAddress.size,
      fetchedAddressCount,
      stoppedReasons,
      maxDepthReached: Math.max(maxDepthReached, sortedPaths.reduce((max, path) => Math.max(max, path.depth), 0))
    }
  };
}
