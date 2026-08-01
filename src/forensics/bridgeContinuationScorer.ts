import type {
  CrossChainContinuationEdge,
  CrossChainContinuationEvidenceClass,
  CrossChainContinuationSeed
} from "./crossChainContinuationTypes";
import type { CrossChainTerminalBoundary } from "../types";

const AMOUNT_PRESERVATION_BPS = 9_500n;
const SPLIT_JOIN_PRESERVATION_BPS = 9_500n;
const BPS_DENOMINATOR = 10_000n;
const CLOSE_TIME_MS = 24 * 60 * 60 * 1000;
const PROOF_TERMINALS = new Set<CrossChainTerminalBoundary>([
  "tornado_or_mixer",
  "sanctioned_service",
  "no_name_token_liquidity"
]);
const DATA_QUALITY_TERMINALS = new Set<CrossChainTerminalBoundary>([
  "candidate_only",
  "data_exhausted",
  "none"
]);

function parseRawAmount(value: string | null | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function amountPreserved(seedAmountRaw: string, edgeAmountRaw: string | null | undefined, thresholdBps: bigint): boolean {
  const seedAmount = parseRawAmount(seedAmountRaw);
  const edgeAmount = parseRawAmount(edgeAmountRaw);
  if (seedAmount === null || edgeAmount === null || seedAmount <= 0n || edgeAmount <= 0n) return false;

  const smaller = seedAmount < edgeAmount ? seedAmount : edgeAmount;
  const larger = seedAmount > edgeAmount ? seedAmount : edgeAmount;
  return smaller * BPS_DENOMINATOR >= larger * thresholdBps;
}

function sameAsset(seed: CrossChainContinuationSeed, edge: CrossChainContinuationEdge): boolean {
  return seed.assetSymbol.toLowerCase() === (edge.assetSymbol ?? "").toLowerCase();
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function closeToSeedTime(seed: CrossChainContinuationSeed, edge: CrossChainContinuationEdge): boolean {
  const edgeTime = parseTime(edge.timestamp);
  if (edgeTime === null) return false;

  if (seed.timeWindow) {
    const start = parseTime(seed.timeWindow.start);
    const end = parseTime(seed.timeWindow.end);
    if (start !== null && end !== null && edgeTime >= start && edgeTime <= end) return true;
  }

  const seedTime = parseTime(seed.timestamp);
  if (seedTime === null) return false;
  return Math.abs(edgeTime - seedTime) <= CLOSE_TIME_MS;
}

function normalizedText(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
}

function hasProtocolCorrelation(seed: CrossChainContinuationSeed, edge: CrossChainContinuationEdge): boolean {
  if (edge.evidenceRefs.some((ref) => ref.confidence === "provider_correlated" || ref.confidence === "protocol_correlated" || ref.confidence === "exact")) {
    return true;
  }

  const edgeText = normalizedText([edge.protocol, ...edge.labels]);
  if (!edgeText) return false;
  return seed.labels.some((label) => edgeText.includes(label.toLowerCase()));
}

export function classifyContinuationEdge(
  seed: CrossChainContinuationSeed,
  edge: CrossChainContinuationEdge
): CrossChainContinuationEdge {
  const reasons: string[] = [];
  const amountClose = sameAsset(seed, edge) && amountPreserved(seed.amountRaw, edge.amountRaw, AMOUNT_PRESERVATION_BPS);
  const timeClose = closeToSeedTime(seed, edge);

  if (hasProtocolCorrelation(seed, edge)) {
    reasons.push("Provider or protocol evidence correlates this edge with the bridge continuation.");
    if (amountClose) reasons.push("Edge amount is close to the seed amount.");
    if (timeClose) reasons.push("Edge timestamp is close to the seed timestamp.");
    return {
      ...edge,
      continuationEvidenceClass: "protocol_correlated",
      score: Math.max(edge.score, amountClose || timeClose ? 90 : 85),
      reasons: [...edge.reasons, ...reasons]
    };
  }

  if (amountClose) reasons.push("Edge amount is close to the seed amount.");
  if (timeClose) reasons.push("Edge timestamp is close to the seed timestamp.");

  if (amountClose && timeClose) {
    return {
      ...edge,
      continuationEvidenceClass: "strong_amount_time",
      score: Math.max(edge.score, 70),
      reasons: [...edge.reasons, ...reasons]
    };
  }

  return {
    ...edge,
    continuationEvidenceClass: "weak_candidate",
    score: Math.max(edge.score, amountClose || timeClose ? 30 : 10),
    reasons: [...edge.reasons, ...reasons]
  };
}

export function groupSplitJoinEdges(
  seed: CrossChainContinuationSeed,
  edges: CrossChainContinuationEdge[]
): CrossChainContinuationEdge | null {
  if (edges.length < 2) return null;

  let sum = 0n;
  for (const edge of edges) {
    if (!sameAsset(seed, edge)) return null;
    const amount = parseRawAmount(edge.amountRaw);
    if (amount === null || amount <= 0n) return null;
    sum += amount;
  }

  const amountRaw = sum.toString();
  if (!amountPreserved(seed.amountRaw, amountRaw, SPLIT_JOIN_PRESERVATION_BPS)) return null;

  const first = edges[0];
  const last = edges[edges.length - 1];
  return {
    ...first,
    id: `split_join:${seed.id}:${edges.map((edge) => edge.id).join("+")}`,
    edgeType: "token_transfer",
    source: first.source,
    destination: last.destination,
    txHash: null,
    amountRaw,
    assetSymbol: seed.assetSymbol,
    timestamp: last.timestamp ?? first.timestamp,
    protocol: first.protocol,
    evidenceRefs: edges.flatMap((edge) => edge.evidenceRefs),
    labels: Array.from(new Set(edges.flatMap((edge) => edge.labels))),
    continuationEvidenceClass: "split_join",
    score: 75,
    reasons: ["Split/join candidate preserves the seed amount across multiple edges."]
  };
}

export function terminalAllowedForContinuationClass(
  terminal: CrossChainTerminalBoundary,
  evidenceClass: CrossChainContinuationEvidenceClass
): boolean {
  if (DATA_QUALITY_TERMINALS.has(terminal)) return true;
  if (PROOF_TERMINALS.has(terminal)) return evidenceClass === "protocol_correlated";
  return evidenceClass !== "weak_candidate";
}
