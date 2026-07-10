import type { ForensicRouteEdge, RouteScoreFeature, ServiceCategory, ServiceClassification, ServiceExposureProfile } from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";
import { isServiceBoundary } from "./serviceClassifier";

export const SERVICE_EXPOSURE_DEFAULT_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const SERVICE_EXPOSURE_DEFAULT_MIN_AMOUNT_PRESERVATION = 0.7;
export const SERVICE_EXPOSURE_MEANINGFUL_MIN_RAW = 100_000_000n;
export const SERVICE_EXPOSURE_MEANINGFUL_MIN_RATIO = 0.01;
const SERVICE_EXPOSURE_MERGE_WINDOW_MS = 6 * 60 * 60 * 1000;

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

type SourceTransfer = {
  edge: ForensicRouteEdge;
  amountRaw: bigint;
};

type MergedExposure = {
  sourceEdges: ForensicRouteEdge[];
  intermediateAddress: string;
  serviceAddress: string;
  service: ServiceClassification;
  sourceVolumeRaw: bigint;
  serviceExitVolumeRaw: bigint;
  serviceExitTxCount: number;
  firstSourceTransferAt: Date;
  lastServiceTransferAt: Date;
  fastestServiceExitMs: number;
  amountPreservationRatio: number;
};

type ServiceExitCandidate = {
  amountRaw: bigint;
  timestamp: Date;
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
  hasMeaningfulExposure: boolean;
  hasMeaningfulMergedExposure: boolean;
  combinedVolumeRatio: number;
  mergedVolumeRatio: number;
  mergedGroupCount: number;
  dominantCategory: ServiceCategory | null;
  bestAmountPreservationRatio: number | null;
  bestMergedAmountPreservationRatio: number | null;
  fastestServiceExitMs: number | null;
  fastestMergedServiceExitMs: number | null;
  hasMergedThreeChunkFlow: boolean;
  exposedTxCount: number;
  categoryCount: number;
  hasUnknownContractExposure: boolean;
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [];
  if (input.hasMeaningfulExposure && input.combinedVolumeRatio >= 0.7) {
    features.push(feature("service_exposure_high_volume", "Large share of outgoing USDT volume exits to service infrastructure", 30, input.combinedVolumeRatio));
  } else if (input.hasMeaningfulExposure && input.combinedVolumeRatio >= 0.4) {
    features.push(feature("service_exposure_medium_volume", "Meaningful share of outgoing USDT volume exits to service infrastructure", 20, input.combinedVolumeRatio));
  } else if (input.hasMeaningfulExposure && input.combinedVolumeRatio >= 0.15) {
    features.push(feature("service_exposure_low_volume", "Some outgoing USDT volume exits to service infrastructure", 10, input.combinedVolumeRatio));
  }

  if (input.hasMeaningfulExposure && (input.dominantCategory === "bridge" || input.dominantCategory === "bridge_pool") && (input.bestAmountPreservationRatio ?? 0) >= 0.95) {
    features.push(feature("service_exposure_bridge_preserved_amount", "Bridge or bridge-pool exposure preserves most of the outgoing amount", 20, input.bestAmountPreservationRatio));
  }

  if (input.hasMeaningfulMergedExposure && input.mergedVolumeRatio >= 0.7) {
    features.push(feature("service_exposure_merged_high_volume", "Large merged outgoing USDT volume appears to exit to service infrastructure", 30, input.mergedVolumeRatio));
  }
  if (input.hasMeaningfulMergedExposure && (input.dominantCategory === "bridge" || input.dominantCategory === "bridge_pool") && (input.bestMergedAmountPreservationRatio ?? 0) >= 0.95) {
    features.push(feature("service_exposure_merged_bridge_preserved_amount", "Merged bridge or bridge-pool exposure preserves most of the outgoing amount", 20, input.bestMergedAmountPreservationRatio));
  }
  if (input.hasMeaningfulMergedExposure && input.fastestMergedServiceExitMs !== null && input.fastestMergedServiceExitMs <= 60 * 60 * 1000) {
    features.push(feature("service_exposure_merged_fast_exit", "Merged outgoing USDT reaches service infrastructure within 1 hour of the final source transfer", 15, input.fastestMergedServiceExitMs));
  }
  if (input.hasMeaningfulMergedExposure && input.hasMergedThreeChunkFlow) {
    features.push(feature("service_exposure_merge_pattern", "Multiple outgoing transfers to the same intermediate appear to merge before service exit", 10, input.mergedGroupCount));
  }

  const exit = input.fastestServiceExitMs;
  if (input.hasMeaningfulExposure && exit !== null && exit <= 60 * 60 * 1000) {
    features.push(feature("service_exposure_fast_exit", "Outgoing USDT reaches service infrastructure within 1 hour", 15, exit));
  } else if (input.hasMeaningfulExposure && exit !== null && exit <= 6 * 60 * 60 * 1000) {
    features.push(feature("service_exposure_same_day_exit", "Outgoing USDT reaches service infrastructure within 6 hours", 10, exit));
  } else if (input.hasMeaningfulExposure && exit !== null && exit <= SERVICE_EXPOSURE_DEFAULT_LOOKAHEAD_MS) {
    features.push(feature("service_exposure_24h_exit", "Outgoing USDT reaches service infrastructure within 24 hours", 5, exit));
  }

  if (input.hasMeaningfulExposure && input.exposedTxCount >= 3) {
    features.push(feature("service_exposure_repeated_exits", "Repeated outgoing transfers reach service infrastructure", 10, input.exposedTxCount));
  }
  if (input.hasMeaningfulExposure && input.categoryCount >= 2) {
    features.push(feature("service_exposure_multiple_categories", "Outgoing transfers touch multiple service categories", 10, input.categoryCount));
  }
  if (input.hasMeaningfulExposure && input.hasUnknownContractExposure) {
    features.push(feature("service_exposure_unknown_contract", "Unknown contract exposure requires manual review", 10, true));
  }
  return features;
}

function mergeGroups(transfers: SourceTransfer[]): SourceTransfer[][] {
  const sorted = [...transfers].sort((a, b) => a.edge.timestamp.getTime() - b.edge.timestamp.getTime());
  const groups: SourceTransfer[][] = [];
  let current: SourceTransfer[] = [];
  let groupStartMs: number | null = null;

  for (const transfer of sorted) {
    const transferMs = transfer.edge.timestamp.getTime();
    if (groupStartMs === null || transferMs - groupStartMs > SERVICE_EXPOSURE_MERGE_WINDOW_MS) {
      if (current.length > 0) groups.push(current);
      current = [transfer];
      groupStartMs = transferMs;
    } else {
      current.push(transfer);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.filter((group) => group.length >= 2);
}

function isCausallyFeasibleMergedExit(input: {
  group: SourceTransfer[];
  exits: ServiceExitCandidate[];
}): boolean {
  const events = [
    ...input.group.map((transfer) => ({
      type: "source" as const,
      timestampMs: transfer.edge.timestamp.getTime(),
      amountRaw: transfer.amountRaw
    })),
    ...input.exits.map((exit) => ({
      type: "exit" as const,
      timestampMs: exit.timestamp.getTime(),
      amountRaw: exit.amountRaw
    }))
  ].sort((a, b) => a.timestampMs - b.timestampMs || (a.type === "source" ? -1 : 1));

  let cumulativeSource = 0n;
  let cumulativeExit = 0n;
  for (const event of events) {
    if (event.type === "source") {
      cumulativeSource += event.amountRaw;
    } else {
      cumulativeExit += event.amountRaw;
      if (cumulativeExit > cumulativeSource) return false;
    }
  }
  return true;
}

function buildMergedExposure(input: {
  group: SourceTransfer[];
  intermediateAddress: string;
  outgoingByAddress: Map<string, ForensicRouteEdge[]>;
  classifications: Map<string, ServiceClassification | null>;
  lookaheadMs: number;
  minAmountPreservation: number;
}): MergedExposure | null {
  const firstSourceMs = input.group[0].edge.timestamp.getTime();
  const lastSourceMs = input.group[input.group.length - 1].edge.timestamp.getTime();
  const sourceVolumeRaw = input.group.reduce((sum, transfer) => sum + transfer.amountRaw, 0n);
  const serviceTotals = new Map<string, {
    serviceAddress: string;
    service: ServiceClassification;
    exits: ServiceExitCandidate[];
    firstExitAfterLastSourceMs: number | null;
  }>();

  for (const edge of input.outgoingByAddress.get(input.intermediateAddress) ?? []) {
    const edgeMs = edge.timestamp.getTime();
    if (edgeMs < firstSourceMs || edgeMs > lastSourceMs + input.lookaheadMs) continue;
    const amount = parseAmount(edge.amountRaw);
    const service = input.classifications.get(edge.toAddress) ?? null;
    if (amount === null || amount <= 0n || service === null || !isServiceBoundary(service)) continue;

    const key = `${edge.toAddress}\u0000${service.category}`;
    const current = serviceTotals.get(key) ?? {
      serviceAddress: edge.toAddress,
      service,
      exits: [],
      firstExitAfterLastSourceMs: edgeMs >= lastSourceMs ? edgeMs : null,
    };
    current.exits.push({ amountRaw: amount, timestamp: edge.timestamp });
    current.firstExitAfterLastSourceMs = edgeMs >= lastSourceMs
      ? Math.min(current.firstExitAfterLastSourceMs ?? edgeMs, edgeMs)
      : current.firstExitAfterLastSourceMs;
    serviceTotals.set(key, current);
  }

  const valid = [...serviceTotals.values()]
    .map((total) => {
      const serviceExitVolumeRaw = total.exits.reduce((sum, exit) => sum + exit.amountRaw, 0n);
      const serviceExitTxCount = total.exits.length;
      const lastExitMs = Math.max(...total.exits.map((exit) => exit.timestamp.getTime()));
      return {
        ...total,
        serviceExitVolumeRaw,
        serviceExitTxCount,
        lastExitMs,
        amountPreservationRatio: ratio(sourceVolumeRaw, serviceExitVolumeRaw),
        causallyFeasible: isCausallyFeasibleMergedExit({ group: input.group, exits: total.exits })
      };
    })
    .filter((total) =>
      total.firstExitAfterLastSourceMs !== null &&
      total.causallyFeasible &&
      total.amountPreservationRatio >= input.minAmountPreservation
    )
    .sort((a, b) =>
      b.amountPreservationRatio - a.amountPreservationRatio ||
      Number(b.serviceExitVolumeRaw - a.serviceExitVolumeRaw) ||
      (a.firstExitAfterLastSourceMs ?? 0) - (b.firstExitAfterLastSourceMs ?? 0)
    );

  const best = valid[0];
  if (!best) return null;
  const firstExitAfterLastSourceMs = best.firstExitAfterLastSourceMs;
  if (firstExitAfterLastSourceMs === null) return null;

  return {
    sourceEdges: input.group.map((transfer) => transfer.edge),
    intermediateAddress: input.intermediateAddress,
    serviceAddress: best.serviceAddress,
    service: best.service,
    sourceVolumeRaw,
    serviceExitVolumeRaw: best.serviceExitVolumeRaw,
    serviceExitTxCount: best.serviceExitTxCount,
    firstSourceTransferAt: input.group[0].edge.timestamp,
    lastServiceTransferAt: new Date(best.lastExitMs),
    fastestServiceExitMs: firstExitAfterLastSourceMs - lastSourceMs,
    amountPreservationRatio: best.amountPreservationRatio
  };
}

export function buildServiceExposureProfile(input: BuildServiceExposureProfileInput): ServiceExposureProfile {
  const lookaheadMs = input.indirectLookaheadMs ?? SERVICE_EXPOSURE_DEFAULT_LOOKAHEAD_MS;
  const minAmountPreservation = input.minIndirectAmountPreservation ?? SERVICE_EXPOSURE_DEFAULT_MIN_AMOUNT_PRESERVATION;
  const grossOutgoing = input.edges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const riskEligibleEdges = input.edges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const outgoing = riskEligibleEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const outgoingByAddress = new Map<string, ForensicRouteEdge[]>();
  for (const edge of riskEligibleEdges) {
    const current = outgoingByAddress.get(edge.fromAddress) ?? [];
    current.push(edge);
    outgoingByAddress.set(edge.fromAddress, current);
  }

  const totalOutgoingRaw = grossOutgoing.reduce((sum, edge) => sum + (parseAmount(edge.amountRaw) ?? 0n), 0n);
  const directExposures: Exposure[] = [];
  const eligibleIndirectSources: SourceTransfer[] = [];
  const coveredSourceEdgeIds = new Set<string>();
  const indirectExposures: Exposure[] = [];

  for (const sourceEdge of outgoing) {
    const amount = parseAmount(sourceEdge.amountRaw);
    if (amount === null || amount <= 0n) continue;

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
      coveredSourceEdgeIds.add(sourceEdge.id);
      continue;
    }

    eligibleIndirectSources.push({ edge: sourceEdge, amountRaw: amount });
  }

  const sourcesByIntermediate = new Map<string, SourceTransfer[]>();
  for (const transfer of eligibleIndirectSources) {
    const current = sourcesByIntermediate.get(transfer.edge.toAddress) ?? [];
    current.push(transfer);
    sourcesByIntermediate.set(transfer.edge.toAddress, current);
  }

  const mergedExposures: MergedExposure[] = [];
  for (const [intermediateAddress, transfers] of sourcesByIntermediate.entries()) {
    const classification = input.classifications.get(intermediateAddress) ?? null;
    if (isServiceBoundary(classification)) continue;

    for (const group of mergeGroups(transfers)) {
      if (group.some((transfer) => coveredSourceEdgeIds.has(transfer.edge.id))) continue;
      const merged = buildMergedExposure({
        group,
        intermediateAddress,
        outgoingByAddress,
        classifications: input.classifications,
        lookaheadMs,
        minAmountPreservation
      });
      if (!merged) continue;
      mergedExposures.push(merged);
      for (const sourceEdge of merged.sourceEdges) {
        coveredSourceEdgeIds.add(sourceEdge.id);
      }
    }
  }

  for (const { edge: sourceEdge, amountRaw: amount } of eligibleIndirectSources) {
    if (coveredSourceEdgeIds.has(sourceEdge.id)) continue;

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
      coveredSourceEdgeIds.add(sourceEdge.id);
    }
  }

  const allExposures = [...directExposures, ...indirectExposures];
  const directVolume = directExposures.reduce((sum, item) => sum + item.amountRaw, 0n);
  const indirectVolume = indirectExposures.reduce((sum, item) => sum + item.amountRaw, 0n);
  const mergedVolume = mergedExposures.reduce((sum, item) => sum + item.sourceVolumeRaw, 0n);
  const combinedVolume = directVolume + indirectVolume + mergedVolume;
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

  for (const exposure of mergedExposures) {
    const category = exposure.service.category;
    const categoryTotal = categoryTotals.get(category) ?? { volumeRaw: 0n, txCount: 0 };
    categoryTotal.volumeRaw += exposure.sourceVolumeRaw;
    categoryTotal.txCount += exposure.sourceEdges.length;
    categoryTotals.set(category, categoryTotal);

    const counterparty = counterpartyTotals.get(exposure.serviceAddress) ?? {
      category,
      identity: exposure.service.identity,
      volumeRaw: 0n,
      txCount: 0
    };
    counterparty.volumeRaw += exposure.sourceVolumeRaw;
    counterparty.txCount += exposure.sourceEdges.length;
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
  const serviceExitTimes = [
    ...allExposures.map((item) => item.serviceExitMs),
    ...mergedExposures.map((item) => item.fastestServiceExitMs)
  ];
  const fastestServiceExitMs = serviceExitTimes.length > 0 ? Math.min(...serviceExitTimes) : null;
  const preservationRatios = [
    ...indirectExposures.map((item) => item.amountPreservationRatio),
    ...mergedExposures.map((item) => item.amountPreservationRatio)
  ];
  const fallbackPreservationRatios = allExposures.map((item) => item.amountPreservationRatio);
  const bestAmountPreservationRatio = preservationRatios.length > 0
    ? Math.max(...preservationRatios)
    : fallbackPreservationRatios.length > 0
      ? Math.max(...fallbackPreservationRatios)
      : null;
  const fastestMergedServiceExitMs = mergedExposures.length > 0 ? Math.min(...mergedExposures.map((item) => item.fastestServiceExitMs)) : null;
  const bestMergedAmountPreservationRatio = mergedExposures.length > 0 ? Math.max(...mergedExposures.map((item) => item.amountPreservationRatio)) : null;
  const combinedVolumeRatio = numberRatio(combinedVolume, totalOutgoingRaw);
  const mergedVolumeRatio = numberRatio(mergedVolume, totalOutgoingRaw);
  const hasMeaningfulExposure = combinedVolume >= SERVICE_EXPOSURE_MEANINGFUL_MIN_RAW && combinedVolumeRatio >= SERVICE_EXPOSURE_MEANINGFUL_MIN_RATIO;
  const hasMeaningfulMergedExposure = mergedVolume >= SERVICE_EXPOSURE_MEANINGFUL_MIN_RAW && mergedVolumeRatio >= SERVICE_EXPOSURE_MEANINGFUL_MIN_RATIO;
  const features = scoreFeatures({
    hasMeaningfulExposure,
    hasMeaningfulMergedExposure,
    combinedVolumeRatio,
    mergedVolumeRatio,
    mergedGroupCount: mergedExposures.length,
    dominantCategory,
    bestAmountPreservationRatio,
    bestMergedAmountPreservationRatio,
    fastestServiceExitMs,
    fastestMergedServiceExitMs,
    hasMergedThreeChunkFlow: mergedExposures.some((item) => item.sourceEdges.length >= 3),
    exposedTxCount: allExposures.length + mergedExposures.reduce((sum, item) => sum + item.sourceEdges.length, 0),
    categoryCount: categoryTotals.size,
    hasUnknownContractExposure: [...allExposures.map((item) => item.service), ...mergedExposures.map((item) => item.service)]
      .some((service) => service.category === "unknown_contract")
  });

  return {
    subjectAddress: input.subjectAddress,
    totalOutgoingRaw: totalOutgoingRaw.toString(),
    totalOutgoingCount: grossOutgoing.length,
    directServiceVolumeRatio: numberRatio(directVolume, totalOutgoingRaw),
    directServiceTxRatio: grossOutgoing.length > 0 ? directExposures.length / grossOutgoing.length : 0,
    indirectServiceVolumeRatio: numberRatio(indirectVolume, totalOutgoingRaw),
    indirectServiceTxRatio: grossOutgoing.length > 0 ? indirectExposures.length / grossOutgoing.length : 0,
    mergedServiceVolumeRatio: mergedVolumeRatio,
    mergedServiceGroupCount: mergedExposures.length,
    combinedServiceVolumeRatio: combinedVolumeRatio,
    combinedServiceTxRatio: grossOutgoing.length > 0
      ? (allExposures.length + mergedExposures.reduce((sum, item) => sum + item.sourceEdges.length, 0)) / grossOutgoing.length
      : 0,
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
    topMergedServiceFlows: mergedExposures
      .map((exposure) => ({
        intermediateAddress: exposure.intermediateAddress,
        serviceAddress: exposure.serviceAddress,
        category: exposure.service.category,
        identity: exposure.service.identity,
        incomingRaw: exposure.sourceVolumeRaw.toString(),
        outgoingServiceRaw: exposure.serviceExitVolumeRaw.toString(),
        sourceTxCount: exposure.sourceEdges.length,
        serviceTxCount: exposure.serviceExitTxCount,
        amountPreservationRatio: exposure.amountPreservationRatio,
        firstSourceTransferAt: exposure.firstSourceTransferAt.toISOString(),
        lastServiceTransferAt: exposure.lastServiceTransferAt.toISOString()
      }))
      .sort((a, b) => Number(BigInt(b.incomingRaw) - BigInt(a.incomingRaw)))
      .slice(0, 5),
    fastestServiceExitMs,
    bestAmountPreservationRatio,
    exposureScore: Math.max(0, Math.min(100, features.reduce((sum, item) => sum + item.scoreImpact, 0))),
    features
  };
}
