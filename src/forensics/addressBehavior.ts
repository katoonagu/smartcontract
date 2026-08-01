import type {
  AddressBehaviorProfile,
  ForensicRouteEdge,
  RouteScoreFeature,
  ServiceClassification,
  ServiceExposureProfile
} from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";
import { isServiceBoundary } from "./serviceClassifier";

export const ADDRESS_BEHAVIOR_DEFAULT_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export const ADDRESS_BEHAVIOR_REASON_CODES = [
  "address_behavior_deposit_then_drain",
  "address_behavior_large_inflow_preserved_outflow",
  "address_behavior_fast_post_deposit_exit",
  "address_behavior_drain_to_service_infrastructure",
  "address_behavior_high_volume_transit",
  "address_behavior_fan_in_fan_out",
  "address_behavior_large_outgoing_concentration",
  "address_behavior_top_counterparty_concentration",
  "address_behavior_collector_like_wallet"
] as const;

export type AddressBehaviorReasonCode = typeof ADDRESS_BEHAVIOR_REASON_CODES[number];

const addressBehaviorReasonCodes = new Set<string>(ADDRESS_BEHAVIOR_REASON_CODES);

export function isAddressBehaviorReasonCode(code: string): code is AddressBehaviorReasonCode {
  return addressBehaviorReasonCodes.has(code);
}

export type AddressBehaviorMetadata = {
  name?: string | null;
  tag?: string | null;
  isContract?: boolean | null;
  rawJson?: Record<string, unknown>;
};

export type BuildAddressBehaviorProfileInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  serviceExposureProfile?: ServiceExposureProfile | null;
  subjectClassification?: ServiceClassification | null;
  metadata?: AddressBehaviorMetadata | null;
  missingChecks?: string[];
  lookaheadMs?: number;
};

function parseAmount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function numberRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservationRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number((numerator < denominator ? numerator : denominator) * 10_000n / denominator) / 10_000;
}

function scaledAmount(amount: bigint, ratio: number): bigint {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0n;
  return amount * BigInt(Math.round(ratio * 10_000)) / 10_000n;
}

function feature(code: AddressBehaviorReasonCode, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): RouteScoreFeature {
  return { code, label, scoreImpact, value };
}

function dampenerFeature(code: string, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): RouteScoreFeature {
  return { code, label, scoreImpact, value };
}

function safeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function metadataText(metadata: AddressBehaviorMetadata | null | undefined): string {
  return [metadata?.name, metadata?.tag].filter(Boolean).join(" ").toLowerCase();
}

function totalTxCount(metadata: AddressBehaviorMetadata | null | undefined): number | null {
  const raw = metadata?.rawJson ?? {};
  return safeInteger(raw.totalTransactionCount ?? raw.total_tx_count ?? raw.transactions);
}

function walletCreatedAt(metadata: AddressBehaviorMetadata | null | undefined): Date | null {
  const raw = metadata?.rawJson ?? {};
  const timestamp = safeInteger(raw.date_created ?? raw.created_at ?? raw.walletCreatedAt);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function volumeOf(edges: ForensicRouteEdge[]): bigint {
  return edges.reduce((sum, edge) => {
    const amount = parseAmount(edge.amountRaw);
    return amount === null ? sum : sum + amount;
  }, 0n);
}

function largestAmount(edges: ForensicRouteEdge[]): bigint | null {
  const amounts = edges.map((edge) => parseAmount(edge.amountRaw)).filter((amount): amount is bigint => amount !== null);
  return amounts.length > 0 ? amounts.reduce((max, amount) => amount > max ? amount : max, 0n) : null;
}

function topOutgoingCounterparty(edges: ForensicRouteEdge[], outgoingVolumeRaw: bigint): {
  address: string | null;
  volumeRaw: bigint | null;
  txCount: number;
  ratio: number;
} {
  const totals = new Map<string, { volumeRaw: bigint; txCount: number }>();
  for (const edge of edges) {
    const amount = parseAmount(edge.amountRaw);
    if (amount === null) continue;
    const current = totals.get(edge.toAddress) ?? { volumeRaw: 0n, txCount: 0 };
    current.volumeRaw += amount;
    current.txCount += 1;
    totals.set(edge.toAddress, current);
  }
  const top = [...totals.entries()]
    .sort((a, b) => Number(b[1].volumeRaw - a[1].volumeRaw) || b[1].txCount - a[1].txCount)[0];
  if (!top) return { address: null, volumeRaw: null, txCount: 0, ratio: 0 };
  const [address, total] = top;
  return {
    address,
    volumeRaw: total.volumeRaw,
    txCount: total.txCount,
    ratio: numberRatio(total.volumeRaw, outgoingVolumeRaw)
  };
}

function effectiveBehaviorScore(profile: Pick<AddressBehaviorProfile, "depositThenDrainScore" | "transitScore" | "dampenerScore">): number {
  return Math.max(0, profile.depositThenDrainScore + profile.transitScore - profile.dampenerScore);
}

export function addressBehaviorEffectiveScore(profile: AddressBehaviorProfile): number {
  return effectiveBehaviorScore(profile);
}

function scoreDepositThenDrain(input: {
  incomingVolumeRaw: bigint;
  outgoingVolumeRaw: bigint;
  largestIncomingRaw: bigint | null;
  inflowToOutflowRatio: number | null;
  drainToServiceRatio: number;
  timeToFirstOutgoingMs: number | null;
  timeToFirstServiceExitMs: number | null;
  lookaheadMs: number;
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [];
  if (input.incomingVolumeRaw <= 0n || input.timeToFirstOutgoingMs === null || input.timeToFirstOutgoingMs > input.lookaheadMs) {
    return features;
  }

  const largestIncomingRatio = input.largestIncomingRaw === null ? 0 : numberRatio(input.largestIncomingRaw, input.incomingVolumeRaw);
  if (largestIncomingRatio >= 0.7) {
    features.push(feature("address_behavior_deposit_then_drain", "Large incoming USDT amount is followed by outgoing redistribution", 10, largestIncomingRatio));
  }
  if ((input.inflowToOutflowRatio ?? 0) >= 0.9) {
    features.push(feature("address_behavior_large_inflow_preserved_outflow", "Outgoing USDT preserves most of the recent incoming amount", 15, input.inflowToOutflowRatio));
  } else if ((input.inflowToOutflowRatio ?? 0) >= 0.7) {
    features.push(feature("address_behavior_large_inflow_preserved_outflow", "Outgoing USDT preserves a meaningful share of the recent incoming amount", 10, input.inflowToOutflowRatio));
  }
  if (input.timeToFirstOutgoingMs <= 60 * 60 * 1000) {
    features.push(feature("address_behavior_fast_post_deposit_exit", "Outgoing USDT starts within 1 hour of incoming funds", 10, input.timeToFirstOutgoingMs));
  } else if (input.timeToFirstOutgoingMs <= 6 * 60 * 60 * 1000) {
    features.push(feature("address_behavior_fast_post_deposit_exit", "Outgoing USDT starts within 6 hours of incoming funds", 7, input.timeToFirstOutgoingMs));
  } else if (input.timeToFirstOutgoingMs <= input.lookaheadMs) {
    features.push(feature("address_behavior_fast_post_deposit_exit", "Outgoing USDT starts within 24 hours of incoming funds", 5, input.timeToFirstOutgoingMs));
  }
  if (input.drainToServiceRatio >= 0.7 && input.timeToFirstServiceExitMs !== null && input.timeToFirstServiceExitMs <= input.lookaheadMs) {
    features.push(feature(
      "address_behavior_drain_to_service_infrastructure",
      "Large incoming USDT amount was rapidly redistributed into service infrastructure; manual review required.",
      15,
      input.drainToServiceRatio
    ));
  } else if (input.drainToServiceRatio >= 0.4 && input.timeToFirstServiceExitMs !== null && input.timeToFirstServiceExitMs <= input.lookaheadMs) {
    features.push(feature(
      "address_behavior_drain_to_service_infrastructure",
      "Meaningful incoming USDT amount was redistributed into service infrastructure; manual review required.",
      10,
      input.drainToServiceRatio
    ));
  }
  return features;
}

function scoreTransit(input: {
  incomingVolumeRaw: bigint;
  outgoingVolumeRaw: bigint;
  incomingTxCount: number;
  outgoingTxCount: number;
  uniqueIncomingCounterparties: number;
  uniqueOutgoingCounterparties: number;
  largestOutgoingRaw: bigint | null;
  topOutgoingCounterpartyRaw: bigint | null;
  topOutgoingCounterpartyTxCount: number;
  topOutgoingCounterpartyRatio: number;
  inflowToOutflowRatio: number | null;
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [];
  if (input.incomingTxCount >= 5 && input.outgoingTxCount >= 5) {
    features.push(feature(
      "address_behavior_high_volume_transit",
      "Address shows high-volume transit-like behavior; this may also match legitimate treasury, trading, merchant, or operational wallet activity.",
      10,
      input.incomingTxCount + input.outgoingTxCount
    ));
  }
  if (input.uniqueIncomingCounterparties >= 3 && input.uniqueOutgoingCounterparties >= 3) {
    features.push(feature("address_behavior_fan_in_fan_out", "Address has meaningful fan-in and fan-out transfer activity", 10, `${input.uniqueIncomingCounterparties}/${input.uniqueOutgoingCounterparties}`));
  }
  const largestOutgoingRatio = input.largestOutgoingRaw === null ? 0 : numberRatio(input.largestOutgoingRaw, input.outgoingVolumeRaw);
  if (input.outgoingTxCount >= 3 && largestOutgoingRatio >= 0.4) {
    features.push(feature("address_behavior_large_outgoing_concentration", "Outgoing volume is concentrated in top counterparties", 10, largestOutgoingRatio));
  }
  if (
    input.topOutgoingCounterpartyRaw !== null &&
    input.topOutgoingCounterpartyRaw >= 10_000_000_000n &&
    input.topOutgoingCounterpartyTxCount >= 2 &&
    input.topOutgoingCounterpartyRatio >= 0.5
  ) {
    features.push(feature(
      "address_behavior_top_counterparty_concentration",
      "Outgoing volume is concentrated in one repeated counterparty",
      10,
      input.topOutgoingCounterpartyRatio
    ));
  }
  if ((input.inflowToOutflowRatio ?? 0) >= 0.7 && input.incomingTxCount + input.outgoingTxCount >= 8) {
    features.push(feature("address_behavior_collector_like_wallet", "Address behaves like a collector or transit wallet with rapid turnover", 10, input.inflowToOutflowRatio));
  }
  return features;
}

function scoreDampeners(input: {
  subjectClassification: ServiceClassification | null | undefined;
  metadata: AddressBehaviorMetadata | null | undefined;
  incomingTxCount: number;
  outgoingTxCount: number;
  incomingVolumeRaw: bigint;
  largestIncomingRaw: bigint | null;
  uniqueIncomingCounterparties: number;
  uniqueOutgoingCounterparties: number;
  missingChecks: string[];
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [];
  const classification = input.subjectClassification ?? null;
  const text = metadataText(input.metadata);
  if (
    (classification && isServiceBoundary(classification) && classification.category !== "unknown_contract") ||
    /treasury|merchant|payment|payroll|operation|operational/.test(text)
  ) {
    features.push(dampenerFeature("known_service_or_treasury_dampener", "Known service or treasury-like subject can legitimately show transit behavior", -25, classification?.category ?? text));
  }

  const createdAt = walletCreatedAt(input.metadata);
  const txCount = totalTxCount(input.metadata);
  if (createdAt && txCount !== null) {
    const ageDays = Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);
    if (ageDays >= 180 && txCount >= 1_000) {
      features.push(dampenerFeature("long_lived_high_activity_wallet_dampener", "Long-lived high-activity wallet can match legitimate operational behavior", -20, txCount));
    }
  }

  const largestIncomingRatio = input.largestIncomingRaw === null ? 0 : numberRatio(input.largestIncomingRaw, input.incomingVolumeRaw);
  if (
    input.incomingTxCount >= 10 &&
    input.outgoingTxCount >= 10 &&
    input.uniqueIncomingCounterparties >= 5 &&
    input.uniqueOutgoingCounterparties >= 5 &&
    largestIncomingRatio < 0.4
  ) {
    features.push(dampenerFeature("regular_activity_dampener", "Distributed regular activity reduces single-incident interpretation", -15, largestIncomingRatio));
  }

  const providerFailures = input.missingChecks.filter((item) =>
    !item.startsWith("Expansion stopped at service boundary") &&
    !item.toLowerCase().includes("sparse-wallet context")
  );
  if (providerFailures.length > 0) {
    features.push(dampenerFeature("low_context_dampener", "Partial provider context reduces behavior confidence", -15, providerFailures.length));
  }

  return features;
}

export function buildAddressBehaviorProfile(input: BuildAddressBehaviorProfileInput): AddressBehaviorProfile {
  const lookaheadMs = input.lookaheadMs ?? ADDRESS_BEHAVIOR_DEFAULT_LOOKAHEAD_MS;
  const grossIncoming = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress && parseAmount(edge.amountRaw) !== null)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const grossOutgoing = input.edges
    .filter((edge) => edge.fromAddress === input.subjectAddress && parseAmount(edge.amountRaw) !== null)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const incoming = grossIncoming.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const outgoing = grossOutgoing.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const grossIncomingVolumeRaw = volumeOf(grossIncoming);
  const grossOutgoingVolumeRaw = volumeOf(grossOutgoing);
  const incomingVolumeRaw = volumeOf(incoming);
  const outgoingVolumeRaw = volumeOf(outgoing);
  const largestIncoming = largestAmount(incoming);
  const largestOutgoing = largestAmount(outgoing);
  const topOutgoing = topOutgoingCounterparty(outgoing, outgoingVolumeRaw);
  const firstIncoming = incoming[0] ?? null;
  const firstOutgoingAfterIncoming = firstIncoming
    ? outgoing.find((edge) => edge.timestamp.getTime() >= firstIncoming.timestamp.getTime()) ?? null
    : null;
  const timeToFirstOutgoingMs = firstIncoming && firstOutgoingAfterIncoming
    ? firstOutgoingAfterIncoming.timestamp.getTime() - firstIncoming.timestamp.getTime()
    : null;
  const timeToFirstServiceExitMs = timeToFirstOutgoingMs !== null && input.serviceExposureProfile?.fastestServiceExitMs !== null && input.serviceExposureProfile?.fastestServiceExitMs !== undefined
    ? timeToFirstOutgoingMs + input.serviceExposureProfile.fastestServiceExitMs
    : null;
  const inflowToOutflowRatio = incomingVolumeRaw > 0n ? preservationRatio(outgoingVolumeRaw, incomingVolumeRaw) : null;
  const serviceOutgoingRaw = scaledAmount(grossOutgoingVolumeRaw, input.serviceExposureProfile?.combinedServiceVolumeRatio ?? 0);
  const drainToServiceRatio = incomingVolumeRaw > 0n ? preservationRatio(serviceOutgoingRaw, incomingVolumeRaw) : 0;

  const base = {
    incomingVolumeRaw,
    outgoingVolumeRaw,
    incomingTxCount: incoming.length,
    outgoingTxCount: outgoing.length,
    uniqueIncomingCounterparties: new Set(incoming.map((edge) => edge.fromAddress)).size,
    uniqueOutgoingCounterparties: new Set(outgoing.map((edge) => edge.toAddress)).size,
    largestIncomingRaw: largestIncoming,
    largestOutgoingRaw: largestOutgoing,
    topOutgoingCounterpartyAddress: topOutgoing.address,
    topOutgoingCounterpartyRaw: topOutgoing.volumeRaw,
    topOutgoingCounterpartyTxCount: topOutgoing.txCount,
    topOutgoingCounterpartyRatio: topOutgoing.ratio,
    inflowToOutflowRatio,
    drainToServiceRatio,
    timeToFirstOutgoingMs,
    timeToFirstServiceExitMs
  };
  const depositFeatures = scoreDepositThenDrain({ ...base, lookaheadMs });
  const transitFeatures = scoreTransit(base);
  const dampenerFeatures = scoreDampeners({
    subjectClassification: input.subjectClassification,
    metadata: input.metadata,
    incomingTxCount: incoming.length,
    outgoingTxCount: outgoing.length,
    incomingVolumeRaw,
    largestIncomingRaw: largestIncoming,
    uniqueIncomingCounterparties: base.uniqueIncomingCounterparties,
    uniqueOutgoingCounterparties: base.uniqueOutgoingCounterparties,
    missingChecks: input.missingChecks ?? []
  });

  const depositThenDrainScore = Math.max(0, Math.min(60, depositFeatures.reduce((sum, item) => sum + Math.max(0, item.scoreImpact), 0)));
  const transitScore = Math.max(0, Math.min(60, transitFeatures.reduce((sum, item) => sum + Math.max(0, item.scoreImpact), 0)));
  const dampenerScore = Math.max(0, Math.min(60, Math.abs(dampenerFeatures.reduce((sum, item) => sum + Math.min(0, item.scoreImpact), 0))));

  return {
    subjectAddress: input.subjectAddress,
    incomingVolumeRaw: grossIncomingVolumeRaw.toString(),
    outgoingVolumeRaw: grossOutgoingVolumeRaw.toString(),
    incomingTxCount: grossIncoming.length,
    outgoingTxCount: grossOutgoing.length,
    uniqueIncomingCounterparties: base.uniqueIncomingCounterparties,
    uniqueOutgoingCounterparties: base.uniqueOutgoingCounterparties,
    largestIncomingRaw: largestIncoming?.toString() ?? null,
    largestOutgoingRaw: largestOutgoing?.toString() ?? null,
    topOutgoingCounterpartyAddress: topOutgoing.address,
    topOutgoingCounterpartyRaw: topOutgoing.volumeRaw?.toString() ?? null,
    topOutgoingCounterpartyTxCount: topOutgoing.txCount,
    topOutgoingCounterpartyRatio: topOutgoing.ratio,
    inflowToOutflowRatio,
    drainToServiceRatio,
    timeToFirstOutgoingMs,
    timeToFirstServiceExitMs,
    depositThenDrainScore,
    transitScore,
    dampenerScore,
    features: [...depositFeatures, ...transitFeatures, ...dampenerFeatures]
  };
}
