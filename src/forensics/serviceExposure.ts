import type { ForensicRouteEdge, RouteScoreFeature, ServiceCategory, ServiceClassification, ServiceExposureProfile } from "../types";
import { isServiceBoundary } from "./serviceClassifier";

export const SERVICE_EXPOSURE_DEFAULT_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const SERVICE_EXPOSURE_DEFAULT_MIN_AMOUNT_PRESERVATION = 0.7;

export type BuildServiceExposureProfileInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null>;
  indirectLookaheadMs?: number;
  minIndirectAmountPreservation?: number;
};

type Exposure = {
  direct: boolean;
  sourceEdge: ForensicRouteEdge;
  serviceAddress: string;
  service: ServiceClassification;
  amountRaw: bigint;
  serviceExitMs: number;
  amountPreservationRatio: number;
};

function parseAmount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function ratio(a: bigint, b: bigint): number {
  if (a <= 0n || b <= 0n) return 0;
  return Number((a < b ? a : b) * 10_000n / (a > b ? a : b)) / 10_000;
}

function numberRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function feature(code: string, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): RouteScoreFeature {
  return { code, label, scoreImpact, value };
}

function scoreFeatures(input: {
  combinedVolumeRatio: number;
  dominantCategory: ServiceCategory | null;
  bestAmountPreservationRatio: number | null;
  fastestServiceExitMs: number | null;
  exposedTxCount: number;
  categoryCount: number;
  hasUnknownContractExposure: boolean;
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [];
  if (input.combinedVolumeRatio >= 0.7) {
    features.push(feature("service_exposure_high_volume", "Large share of outgoing USDT volume exits to service infrastructure", 30, input.combinedVolumeRatio));
  } else if (input.combinedVolumeRatio >= 0.4) {
    features.push(feature("service_exposure_medium_volume", "Meaningful share of outgoing USDT volume exits to service infrastructure", 20, input.combinedVolumeRatio));
  } else if (input.combinedVolumeRatio >= 0.15) {
    features.push(feature("service_exposure_low_volume", "Some outgoing USDT volume exits to service infrastructure", 10, input.combinedVolumeRatio));
  }

  if ((input.dominantCategory === "bridge" || input.dominantCategory === "bridge_pool") && (input.bestAmountPreservationRatio ?? 0) >= 0.95) {
    features.push(feature("service_exposure_bridge_preserved_amount", "Bridge or bridge-pool exposure preserves most of the outgoing amount", 20, input.bestAmountPreservationRatio));
  }

  const exit = input.fastestServiceExitMs;
  if (exit !== null && exit <= 60 * 60 * 1000) {
    features.push(feature("service_exposure_fast_exit", "Outgoing USDT reaches service infrastructure within 1 hour", 15, exit));
  } else if (exit !== null && exit <= 6 * 60 * 60 * 1000) {
    features.push(feature("service_exposure_same_day_exit", "Outgoing USDT reaches service infrastructure within 6 hours", 10, exit));
  } else if (exit !== null && exit <= SERVICE_EXPOSURE_DEFAULT_LOOKAHEAD_MS) {
    features.push(feature("service_exposure_24h_exit", "Outgoing USDT reaches service infrastructure within 24 hours", 5, exit));
  }

  if (input.exposedTxCount >= 3) {
    features.push(feature("service_exposure_repeated_exits", "Repeated outgoing transfers reach service infrastructure", 10, input.exposedTxCount));
  }
  if (input.categoryCount >= 2) {
    features.push(feature("service_exposure_multiple_categories", "Outgoing transfers touch multiple service categories", 10, input.categoryCount));
  }
  if (input.hasUnknownContractExposure) {
    features.push(feature("service_exposure_unknown_contract", "Unknown contract exposure requires manual review", 10, true));
  }
  return features;
}

export function buildServiceExposureProfile(input: BuildServiceExposureProfileInput): ServiceExposureProfile {
  const lookaheadMs = input.indirectLookaheadMs ?? SERVICE_EXPOSURE_DEFAULT_LOOKAHEAD_MS;
  const minAmountPreservation = input.minIndirectAmountPreservation ?? SERVICE_EXPOSURE_DEFAULT_MIN_AMOUNT_PRESERVATION;
  const outgoing = input.edges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const outgoingByAddress = new Map<string, ForensicRouteEdge[]>();
  for (const edge of input.edges) {
    const current = outgoingByAddress.get(edge.fromAddress) ?? [];
    current.push(edge);
    outgoingByAddress.set(edge.fromAddress, current);
  }

  let totalOutgoingRaw = 0n;
  const directExposures: Exposure[] = [];
  const indirectExposures: Exposure[] = [];

  for (const sourceEdge of outgoing) {
    const amount = parseAmount(sourceEdge.amountRaw);
    if (amount === null || amount <= 0n) continue;
    totalOutgoingRaw += amount;

    const directService = input.classifications.get(sourceEdge.toAddress) ?? null;
    if (directService && isServiceBoundary(directService)) {
      directExposures.push({
        direct: true,
        sourceEdge,
        serviceAddress: sourceEdge.toAddress,
        service: directService,
        amountRaw: amount,
        serviceExitMs: 0,
        amountPreservationRatio: 1
      });
      continue;
    }

    const secondHops = (outgoingByAddress.get(sourceEdge.toAddress) ?? [])
      .filter((edge) => edge.timestamp.getTime() >= sourceEdge.timestamp.getTime())
      .filter((edge) => edge.timestamp.getTime() - sourceEdge.timestamp.getTime() <= lookaheadMs)
      .map((edge) => {
        const secondAmount = parseAmount(edge.amountRaw);
        const service = input.classifications.get(edge.toAddress) ?? null;
        return secondAmount && isServiceBoundary(service)
          ? {
              edge,
              amount: secondAmount,
              service,
              amountPreservationRatio: ratio(amount, secondAmount)
            }
          : null;
      })
      .filter((item): item is { edge: ForensicRouteEdge; amount: bigint; service: ServiceClassification; amountPreservationRatio: number } =>
        item !== null && item.amountPreservationRatio >= minAmountPreservation
      )
      .sort((a, b) => b.amountPreservationRatio - a.amountPreservationRatio || a.edge.timestamp.getTime() - b.edge.timestamp.getTime());

    const best = secondHops[0];
    if (best) {
      indirectExposures.push({
        direct: false,
        sourceEdge,
        serviceAddress: best.edge.toAddress,
        service: best.service,
        amountRaw: amount,
        serviceExitMs: best.edge.timestamp.getTime() - sourceEdge.timestamp.getTime(),
        amountPreservationRatio: best.amountPreservationRatio
      });
    }
  }

  const allExposures = [...directExposures, ...indirectExposures];
  const directVolume = directExposures.reduce((sum, item) => sum + item.amountRaw, 0n);
  const indirectVolume = indirectExposures.reduce((sum, item) => sum + item.amountRaw, 0n);
  const combinedVolume = directVolume + indirectVolume;
  const categoryTotals = new Map<ServiceCategory, { volumeRaw: bigint; txCount: number }>();
  const counterpartyTotals = new Map<string, { category: ServiceCategory; identity: string | null; volumeRaw: bigint; txCount: number }>();

  for (const exposure of allExposures) {
    const category = exposure.service.category;
    const categoryTotal = categoryTotals.get(category) ?? { volumeRaw: 0n, txCount: 0 };
    categoryTotal.volumeRaw += exposure.amountRaw;
    categoryTotal.txCount += 1;
    categoryTotals.set(category, categoryTotal);

    const counterparty = counterpartyTotals.get(exposure.serviceAddress) ?? {
      category,
      identity: exposure.service.identity,
      volumeRaw: 0n,
      txCount: 0
    };
    counterparty.volumeRaw += exposure.amountRaw;
    counterparty.txCount += 1;
    counterpartyTotals.set(exposure.serviceAddress, counterparty);
  }

  const categoryBreakdown = [...categoryTotals.entries()]
    .map(([category, total]) => ({
      category,
      volumeRaw: total.volumeRaw.toString(),
      txCount: total.txCount,
      volumeRatio: numberRatio(total.volumeRaw, totalOutgoingRaw)
    }))
    .sort((a, b) => Number(BigInt(b.volumeRaw) - BigInt(a.volumeRaw)));
  const dominantCategory = categoryBreakdown[0]?.category ?? null;
  const fastestServiceExitMs = allExposures.length > 0 ? Math.min(...allExposures.map((item) => item.serviceExitMs)) : null;
  const preservationExposures = indirectExposures.length > 0 ? indirectExposures : allExposures;
  const bestAmountPreservationRatio = preservationExposures.length > 0 ? Math.max(...preservationExposures.map((item) => item.amountPreservationRatio)) : null;
  const features = scoreFeatures({
    combinedVolumeRatio: numberRatio(combinedVolume, totalOutgoingRaw),
    dominantCategory,
    bestAmountPreservationRatio,
    fastestServiceExitMs,
    exposedTxCount: allExposures.length,
    categoryCount: categoryTotals.size,
    hasUnknownContractExposure: allExposures.some((item) => item.service.category === "unknown_contract")
  });

  return {
    subjectAddress: input.subjectAddress,
    totalOutgoingRaw: totalOutgoingRaw.toString(),
    totalOutgoingCount: outgoing.length,
    directServiceVolumeRatio: numberRatio(directVolume, totalOutgoingRaw),
    directServiceTxRatio: outgoing.length > 0 ? directExposures.length / outgoing.length : 0,
    indirectServiceVolumeRatio: numberRatio(indirectVolume, totalOutgoingRaw),
    indirectServiceTxRatio: outgoing.length > 0 ? indirectExposures.length / outgoing.length : 0,
    combinedServiceVolumeRatio: numberRatio(combinedVolume, totalOutgoingRaw),
    combinedServiceTxRatio: outgoing.length > 0 ? allExposures.length / outgoing.length : 0,
    dominantCategory,
    categoryBreakdown,
    topServiceCounterparties: [...counterpartyTotals.entries()]
      .map(([address, total]) => ({
        address,
        category: total.category,
        identity: total.identity,
        volumeRaw: total.volumeRaw.toString(),
        txCount: total.txCount
      }))
      .sort((a, b) => Number(BigInt(b.volumeRaw) - BigInt(a.volumeRaw)))
      .slice(0, 5),
    fastestServiceExitMs,
    bestAmountPreservationRatio,
    exposureScore: Math.max(0, Math.min(100, features.reduce((sum, item) => sum + item.scoreImpact, 0))),
    features
  };
}
