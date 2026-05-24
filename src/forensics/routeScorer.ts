import type { ForensicRouteConfidence, ForensicRouteEdge, RiskReason, RouteScoreFeature, ServiceClassification } from "../types";
import { isServiceBoundary } from "./serviceClassifier";

export const FORENSIC_ROUTE_POLICY_VERSION = "2026-05-24-forensic-route-v1";

export type RouteAddressMetadata = {
  address: string;
  name: string | null;
  tag: string | null;
  isContract: boolean | null;
  verified: boolean | null;
};

export type ScoreRouteCandidateInput = {
  sourceAddress: string;
  targetAddress: string;
  targetAmountRaw?: string | null;
  edges: ForensicRouteEdge[];
  addressMetadata?: Map<string, RouteAddressMetadata | null>;
  addressClassifications?: Map<string, ServiceClassification | null>;
};

export type ScoredRouteCandidate = {
  score: number;
  confidence: ForensicRouteConfidence;
  pathAddresses: string[];
  features: RouteScoreFeature[];
  reasons: RiskReason[];
};

const serviceKeywords = [
  "bridge",
  "cross-chain",
  "cross chain",
  "router",
  "swap",
  "dex",
  "exchange",
  "cex",
  "hot wallet",
  "pool",
  "vault",
  "adapter",
  "bridgers",
  "sunswap",
  "univ3"
];

function parseRawAmount(value: string | null | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function ratioScore(ratio: number): number {
  if (ratio >= 0.99) return 25;
  if (ratio >= 0.95) return 22;
  if (ratio >= 0.9) return 18;
  if (ratio >= 0.7) return 10;
  if (ratio >= 0.5) return 4;
  return 0;
}

function amountPreservationScore(edges: ForensicRouteEdge[], targetAmountRaw?: string | null): { score: number; ratio: number | null } {
  const target = parseRawAmount(targetAmountRaw);
  const amounts = edges.map((edge) => parseRawAmount(edge.amountRaw)).filter((amount): amount is bigint => amount !== null && amount > 0n);
  if (amounts.length === 0) return { score: 0, ratio: null };
  const reference = target && target > 0n ? target : amounts[0];
  const ratios = amounts.map((amount) => Number((amount < reference ? amount : reference) * 10_000n / (amount > reference ? amount : reference)) / 10_000);
  const ratio = Math.min(...ratios);
  return { score: ratioScore(ratio), ratio };
}

function timeProximityScore(edges: ForensicRouteEdge[]): { score: number; maxDeltaMs: number | null } {
  if (edges.length < 2) return { score: 0, maxDeltaMs: null };
  const sorted = [...edges].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  let maxDeltaMs = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    maxDeltaMs = Math.max(maxDeltaMs, sorted[index].timestamp.getTime() - sorted[index - 1].timestamp.getTime());
  }
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (maxDeltaMs <= 10 * minute) return { score: 20, maxDeltaMs };
  if (maxDeltaMs <= hour) return { score: 16, maxDeltaMs };
  if (maxDeltaMs <= day) return { score: 8, maxDeltaMs };
  if (maxDeltaMs <= 7 * day) return { score: 3, maxDeltaMs };
  return { score: 0, maxDeltaMs };
}

function isTransferFrom(edge: ForensicRouteEdge): boolean {
  return edge.edgeType === "transfer_from" || edge.method.toLowerCase().includes("transferfrom");
}

function metadataText(metadata: RouteAddressMetadata | null | undefined): string {
  return [metadata?.name, metadata?.tag].filter(Boolean).join(" ").toLowerCase();
}

function isServiceLike(metadata: RouteAddressMetadata | null | undefined): boolean {
  if (!metadata) return false;
  const text = metadataText(metadata);
  if (serviceKeywords.some((keyword) => text.includes(keyword))) return true;
  return metadata.isContract === true && metadata.verified === true && serviceKeywords.some((keyword) => text.includes(keyword));
}

function isServiceAddress(input: ScoreRouteCandidateInput, address: string): boolean {
  const classification = input.addressClassifications?.get(address);
  if (classification !== undefined) return isServiceBoundary(classification);
  return isServiceLike(input.addressMetadata?.get(address));
}

function pathAddresses(input: ScoreRouteCandidateInput): string[] {
  if (input.edges.length === 0) return [input.sourceAddress];
  const addresses = [input.edges[0].fromAddress];
  for (const edge of input.edges) {
    if (addresses.at(-1) !== edge.fromAddress) addresses.push(edge.fromAddress);
    addresses.push(edge.toAddress);
  }
  return addresses;
}

function feature(code: string, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): RouteScoreFeature {
  return { code, label, scoreImpact, value };
}

function reasonFromFeature(item: RouteScoreFeature): RiskReason {
  return {
    code: item.code,
    message: `${item.label}; candidate path requires manual review`,
    scoreImpact: item.scoreImpact,
    source: "forensic_route_search",
    confidence: Math.abs(item.scoreImpact) >= 20 ? "high" : "medium",
    severity: item.scoreImpact >= 40 ? "high" : item.scoreImpact > 0 ? "medium" : "info"
  };
}

function confidenceFor(input: {
  exactTarget: boolean;
  score: number;
  amountScore: number;
  timeScore: number;
  serviceDampened: boolean;
}): ForensicRouteConfidence {
  if (!input.exactTarget) return "low";
  if (input.serviceDampened) return "low";
  if (input.amountScore >= 18 && input.timeScore >= 16 && input.score >= 45) return "high";
  if (input.score >= 30) return "medium";
  return "low";
}

export function scoreRouteCandidate(input: ScoreRouteCandidateInput): ScoredRouteCandidate {
  const features: RouteScoreFeature[] = [];
  const addresses = pathAddresses(input);
  const exactTarget = addresses.at(-1) === input.targetAddress;
  const firstEdge = input.edges[0] ?? null;

  if (input.edges.some(isTransferFrom)) {
    features.push(feature("transfer_from_from_source", "Spender-called transferFrom appears in this candidate path", 40, true));
  }

  if (firstEdge && firstEdge.fromAddress === input.sourceAddress && firstEdge.toAddress !== input.targetAddress) {
    if (!isServiceAddress(input, firstEdge.toAddress)) {
      features.push(feature("collector_like_receiver", "Funds moved from source to a non-service intermediate receiver", 25, firstEdge.toAddress));
    }
  }

  const amount = amountPreservationScore(input.edges, input.targetAmountRaw);
  if (amount.score > 0) {
    features.push(feature("amount_preservation", `${Math.round((amount.ratio ?? 0) * 100)}% amount preserved across candidate path`, amount.score, amount.ratio));
  }

  const time = timeProximityScore(input.edges);
  if (time.score > 0) {
    features.push(feature("time_proximity", "Transfers in candidate path are close together in time", time.score, time.maxDeltaMs));
  }

  const intermediateAddresses = addresses.slice(1, -1);
  const serviceDampened = intermediateAddresses.some((address) => isServiceAddress(input, address));
  if (serviceDampened) {
    features.push(feature("service_hub_dampener", "Known service/router/bridge hub reduces route confidence", -20, true));
  }

  const score = Math.max(0, Math.min(100, features.reduce((sum, item) => sum + item.scoreImpact, 0)));
  return {
    score,
    confidence: confidenceFor({
      exactTarget,
      score,
      amountScore: amount.score,
      timeScore: time.score,
      serviceDampened
    }),
    pathAddresses: addresses,
    features,
    reasons: features.map(reasonFromFeature)
  };
}
