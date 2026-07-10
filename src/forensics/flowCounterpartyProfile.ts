import type {
  BoundaryExposureProfile,
  FastCounterpartyTopRow,
  FastCounterpartyTopsProfile,
  FlowCategoryBreakdown,
  FlowCounterpartyDirection,
  FlowCounterpartySummary,
  ForensicRouteEdge,
  OperationalFlowProfile,
  RouteScoreFeature,
  ServiceCategory,
  ServiceClassification
} from "../types";
import { calculateHistoricalTransitBreakdown } from "./historicalTransitScore";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";
import { isServiceBoundary } from "./serviceClassifier";

export type BuildOperationalFlowProfileInput = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null | undefined>;
};

export type BuildFastCounterpartyTopsProfileInput = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null | undefined>;
  deepPriorityAddresses?: Set<string>;
};

export function boundaryProfilesToOperationalEdges(input: {
  subjectAddress: string;
  profiles: BoundaryExposureProfile[];
}): ForensicRouteEdge[] {
  return input.profiles.flatMap((profile) => profile.flows.map((flow) => ({
    id: `operational-boundary:${flow.boundaryTxHash}:${flow.direction}`,
    txHash: flow.boundaryTxHash,
    fromAddress: flow.direction === "outbound" ? input.subjectAddress : flow.boundaryAddress,
    toAddress: flow.direction === "outbound" ? flow.boundaryAddress : input.subjectAddress,
    amountRaw: flow.amountRaw,
    timestamp: new Date(flow.firstTransferAt),
    method: "transfer",
    edgeType: "normal_transfer" as const
  })));
}

type CounterpartyAggregate = {
  address: string;
  direction: FlowCounterpartyDirection;
  volumeRaw: bigint;
  txCount: number;
};

type FastCounterpartyAggregate = CounterpartyAggregate & {
  firstSeen: Date | null;
  lastSeen: Date | null;
  edges: ForensicRouteEdge[];
};

type CategoryBreakdownCounterparty = {
  direction: FlowCounterpartyDirection;
  category: ServiceCategory | null;
  volumeRaw: string;
  txCount: number;
};

function amount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservation(left: bigint, right: bigint): number | null {
  if (left <= 0n || right <= 0n) return null;
  const min = left < right ? left : right;
  const max = left > right ? left : right;
  return ratio(min, max);
}

export function isHtxHuobiClassification(classification: ServiceClassification | null | undefined): boolean {
  const text = `${classification?.identity ?? ""} ${classification?.evidence?.join(" ") ?? ""}`.toLowerCase();
  return /\b(htx|huobi)\b/.test(text);
}

export function isBridgeDexRouterCategory(category: ServiceCategory | null | undefined): boolean {
  return category === "bridge" ||
    category === "bridge_pool" ||
    category === "dex" ||
    category === "router" ||
    category === "swap_adapter";
}

export function isTerminalLiquidityClassification(classification: ServiceClassification | null | undefined): boolean {
  if (!classification || !isServiceBoundary(classification)) return false;
  return classification.category === "cex" ||
    classification.category === "hot_wallet" ||
    classification.category === "bridge" ||
    classification.category === "bridge_pool" ||
    classification.category === "dex" ||
    classification.category === "router" ||
    classification.category === "swap_adapter" ||
    classification.category === "unknown_contract";
}

function feature(code: string, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): RouteScoreFeature {
  return { code, label, scoreImpact, value };
}

function compareRawDesc(left: string, right: string): number {
  const diff = BigInt(right) - BigInt(left);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

function classificationFor(
  classifications: Map<string, ServiceClassification | null | undefined>,
  address: string
): ServiceClassification | null {
  return classifications.get(address) ?? null;
}

function summarizeCounterparties(input: {
  direction: FlowCounterpartyDirection;
  edges: ForensicRouteEdge[];
  totalVolumeRaw: bigint;
  subjectAddress: string;
  classifications: Map<string, ServiceClassification | null | undefined>;
}): FlowCounterpartySummary[] {
  const totals = new Map<string, CounterpartyAggregate>();
  for (const edge of input.edges) {
    const address = input.direction === "incoming" ? edge.fromAddress : edge.toAddress;
    if (address === input.subjectAddress) continue;
    const current = totals.get(address) ?? {
      address,
      direction: input.direction,
      volumeRaw: 0n,
      txCount: 0
    };
    current.volumeRaw += amount(edge);
    current.txCount += 1;
    totals.set(address, current);
  }

  return [...totals.values()]
    .map((item) => {
      const classification = classificationFor(input.classifications, item.address);
      return {
        address: item.address,
        direction: item.direction,
        volumeRaw: item.volumeRaw.toString(),
        txCount: item.txCount,
        volumeRatio: ratio(item.volumeRaw, input.totalVolumeRaw),
        category: classification?.category ?? null,
        identity: classification?.identity ?? null,
        isTerminalLiquidity: isTerminalLiquidityClassification(classification),
        isHtxHuobi: classification?.isBoundary === true && isHtxHuobiClassification(classification)
      } satisfies FlowCounterpartySummary;
    })
    .sort((left, right) =>
      compareRawDesc(left.volumeRaw, right.volumeRaw) ||
      right.txCount - left.txCount ||
      left.address.localeCompare(right.address)
    )
    .slice(0, 10);
}

function buildCategoryBreakdown(input: {
  incomingCounterparties: CategoryBreakdownCounterparty[];
  outgoingCounterparties: CategoryBreakdownCounterparty[];
  incomingVolumeRaw: bigint;
  outgoingVolumeRaw: bigint;
}): FlowCategoryBreakdown[] {
  const totals = new Map<string, {
    direction: FlowCounterpartyDirection;
    category: ServiceCategory;
    volumeRaw: bigint;
    txCount: number;
  }>();

  for (const item of [...input.incomingCounterparties, ...input.outgoingCounterparties]) {
    if (!item.category || item.category === "none") continue;
    const key = `${item.direction}\u0000${item.category}`;
    const current = totals.get(key) ?? {
      direction: item.direction,
      category: item.category,
      volumeRaw: 0n,
      txCount: 0
    };
    current.volumeRaw += BigInt(item.volumeRaw);
    current.txCount += item.txCount;
    totals.set(key, current);
  }

  return [...totals.values()]
    .map((item) => ({
      direction: item.direction,
      category: item.category,
      volumeRaw: item.volumeRaw.toString(),
      txCount: item.txCount,
      volumeRatio: ratio(item.volumeRaw, item.direction === "incoming" ? input.incomingVolumeRaw : input.outgoingVolumeRaw)
    }))
    .sort((left, right) =>
      compareRawDesc(left.volumeRaw, right.volumeRaw) ||
      left.direction.localeCompare(right.direction) ||
      left.category.localeCompare(right.category)
    );
}

function sumRatio(items: FlowCounterpartySummary[], predicate: (item: FlowCounterpartySummary) => boolean): number {
  return Math.min(1, items.filter(predicate).reduce((sum, item) => sum + item.volumeRatio, 0));
}

function summarizeFastCounterparties(input: {
  direction: FlowCounterpartyDirection;
  edges: ForensicRouteEdge[];
  totalVolumeRaw: bigint;
  subjectAddress: string;
  classifications: Map<string, ServiceClassification | null | undefined>;
  deepPriorityAddresses?: Set<string>;
}): FastCounterpartyTopRow[] {
  const totals = new Map<string, FastCounterpartyAggregate>();
  for (const edge of input.edges) {
    const address = input.direction === "incoming" ? edge.fromAddress : edge.toAddress;
    if (address === input.subjectAddress) continue;
    const current = totals.get(address) ?? {
      address,
      direction: input.direction,
      volumeRaw: 0n,
      txCount: 0,
      firstSeen: null,
      lastSeen: null,
      edges: []
    };
    current.volumeRaw += amount(edge);
    current.txCount += 1;
    current.firstSeen = current.firstSeen === null || edge.timestamp < current.firstSeen ? edge.timestamp : current.firstSeen;
    current.lastSeen = current.lastSeen === null || edge.timestamp > current.lastSeen ? edge.timestamp : current.lastSeen;
    current.edges.push(edge);
    totals.set(address, current);
  }

  return [...totals.values()]
    .map((item) => {
      const classification = classificationFor(input.classifications, item.address);
      const sampleTxHashes = [...item.edges]
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
        .slice(0, 5)
        .map((edge) => edge.txHash);
      return {
        address: item.address,
        direction: item.direction,
        volumeRaw: item.volumeRaw.toString(),
        txCount: item.txCount,
        volumeRatio: ratio(item.volumeRaw, input.totalVolumeRaw),
        firstSeen: item.firstSeen?.toISOString() ?? null,
        lastSeen: item.lastSeen?.toISOString() ?? null,
        sampleTxHashes,
        category: classification?.category ?? null,
        identity: classification?.identity ?? null,
        selectedAsDeepPriorityHint: input.deepPriorityAddresses?.has(item.address) ?? false
      } satisfies FastCounterpartyTopRow;
    })
    .sort((left, right) =>
      compareRawDesc(left.volumeRaw, right.volumeRaw) ||
      right.txCount - left.txCount ||
      left.address.localeCompare(right.address)
    );
}

function isFastServiceCategory(category: ServiceCategory | null): boolean {
  return category === "cex" ||
    category === "hot_wallet" ||
    category === "bridge" ||
    category === "bridge_pool" ||
    category === "dex" ||
    category === "router" ||
    category === "swap_adapter" ||
    category === "unknown_contract";
}

export function buildFastCounterpartyTopsProfile(input: BuildFastCounterpartyTopsProfileInput): FastCounterpartyTopsProfile {
  const windowEdges = input.edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
  const riskEligibleEdges = windowEdges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const incoming = riskEligibleEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const outgoing = riskEligibleEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const grossIncoming = windowEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const grossOutgoing = windowEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const incomingVolumeRaw = grossIncoming.reduce((sum, edge) => sum + amount(edge), 0n);
  const outgoingVolumeRaw = grossOutgoing.reduce((sum, edge) => sum + amount(edge), 0n);
  const incomingCounterparties = summarizeFastCounterparties({
    direction: "incoming",
    edges: incoming,
    totalVolumeRaw: incomingVolumeRaw,
    subjectAddress: input.subjectAddress,
    classifications: input.classifications,
    deepPriorityAddresses: input.deepPriorityAddresses
  });
  const outgoingCounterparties = summarizeFastCounterparties({
    direction: "outgoing",
    edges: outgoing,
    totalVolumeRaw: outgoingVolumeRaw,
    subjectAddress: input.subjectAddress,
    classifications: input.classifications,
    deepPriorityAddresses: input.deepPriorityAddresses
  });
  const topIncomingCounterparties = incomingCounterparties.slice(0, 10);
  const topOutgoingCounterparties = outgoingCounterparties.slice(0, 10);

  return {
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    incomingVolumeRaw: incomingVolumeRaw.toString(),
    outgoingVolumeRaw: outgoingVolumeRaw.toString(),
    incomingTxCount: grossIncoming.length,
    outgoingTxCount: grossOutgoing.length,
    topIncomingCounterparties,
    topOutgoingCounterparties,
    topServiceCounterparties: outgoingCounterparties
      .filter((row) => classificationFor(input.classifications, row.address)?.isBoundary === true && isFastServiceCategory(row.category))
      .slice(0, 10)
      .map((row) => ({ ...row, direction: "service" })),
    categoryBreakdown: buildCategoryBreakdown({
      incomingCounterparties: incomingCounterparties.map((row) => ({
        direction: "incoming",
        category: row.category,
        volumeRaw: row.volumeRaw,
        txCount: row.txCount
      })),
      outgoingCounterparties: outgoingCounterparties.map((row) => ({
        direction: "outgoing",
        category: row.category,
        volumeRaw: row.volumeRaw,
        txCount: row.txCount
      })),
      incomingVolumeRaw,
      outgoingVolumeRaw
    })
  };
}

export function buildOperationalFlowProfile(input: BuildOperationalFlowProfileInput): OperationalFlowProfile {
  const windowEdges = input.edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
  const riskEligibleEdges = windowEdges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const incoming = riskEligibleEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const outgoing = riskEligibleEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const grossIncoming = windowEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const grossOutgoing = windowEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const incomingVolumeRaw = grossIncoming.reduce((sum, edge) => sum + amount(edge), 0n);
  const outgoingVolumeRaw = grossOutgoing.reduce((sum, edge) => sum + amount(edge), 0n);

  const topIncomingCounterparties = summarizeCounterparties({
    direction: "incoming",
    edges: incoming,
    totalVolumeRaw: incomingVolumeRaw,
    subjectAddress: input.subjectAddress,
    classifications: input.classifications
  });
  const topOutgoingCounterparties = summarizeCounterparties({
    direction: "outgoing",
    edges: outgoing,
    totalVolumeRaw: outgoingVolumeRaw,
    subjectAddress: input.subjectAddress,
    classifications: input.classifications
  });

  const categoryBreakdown = buildCategoryBreakdown({
    incomingCounterparties: topIncomingCounterparties,
    outgoingCounterparties: topOutgoingCounterparties,
    incomingVolumeRaw,
    outgoingVolumeRaw
  });

  const terminalLiquidityIncomingRatio = sumRatio(topIncomingCounterparties, (item) => item.isTerminalLiquidity);
  const terminalLiquidityOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) => item.isTerminalLiquidity);
  const htxHuobiIncomingRatio = sumRatio(topIncomingCounterparties, (item) => item.isHtxHuobi);
  const htxHuobiOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) => item.isHtxHuobi);
  const bridgeDexRouterOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) =>
    classificationFor(input.classifications, item.address)?.isBoundary === true && isBridgeDexRouterCategory(item.category)
  );
  const unknownContractOutgoingRatio = sumRatio(topOutgoingCounterparties, (item) =>
    classificationFor(input.classifications, item.address)?.isBoundary === true && item.category === "unknown_contract"
  );
  const inflowToOutflowRatio = preservation(incomingVolumeRaw, outgoingVolumeRaw);
  const historicalTransitBreakdown = calculateHistoricalTransitBreakdown({
    incomingVolumeRaw: incomingVolumeRaw.toString(),
    outgoingVolumeRaw: outgoingVolumeRaw.toString(),
    inflowToOutflowRatio,
    bridgeDexRouterOutgoingRatio,
    unknownContractOutgoingRatio
  });

  const features: RouteScoreFeature[] = [];
  if (terminalLiquidityOutgoingRatio >= 0.7) {
    features.push(feature(
      "operational_flow_high_terminal_liquidity_outgoing",
      "Large outgoing 30d share exits to terminal service/liquidity boundaries.",
      30,
      terminalLiquidityOutgoingRatio
    ));
  } else if (terminalLiquidityOutgoingRatio >= 0.4) {
    features.push(feature(
      "operational_flow_medium_terminal_liquidity_outgoing",
      "Meaningful outgoing 30d share exits to terminal service/liquidity boundaries.",
      20,
      terminalLiquidityOutgoingRatio
    ));
  }
  if (htxHuobiOutgoingRatio >= 0.2) {
    features.push(feature(
      "operational_flow_htx_huobi_outgoing",
      "Outgoing 30d flow includes HTX/Huobi terminal liquidity exposure.",
      15,
      htxHuobiOutgoingRatio
    ));
  }
  if (bridgeDexRouterOutgoingRatio >= 0.4) {
    features.push(feature(
      "operational_flow_bridge_dex_router_outgoing",
      "Outgoing 30d flow uses bridge/DEX/router infrastructure.",
      20,
      bridgeDexRouterOutgoingRatio
    ));
  }
  if (unknownContractOutgoingRatio >= 0.2) {
    features.push(feature(
      "operational_flow_unknown_contract_outgoing",
      "Outgoing 30d flow reaches unknown contract boundaries.",
      10,
      unknownContractOutgoingRatio
    ));
  }
  if ((inflowToOutflowRatio ?? 0) >= 0.9) {
    features.push(feature(
      "operational_flow_preserved_inflow_outflow",
      "30d outgoing volume preserves most incoming volume.",
      15,
      inflowToOutflowRatio
    ));
  }

  return {
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    incomingVolumeRaw: incomingVolumeRaw.toString(),
    outgoingVolumeRaw: outgoingVolumeRaw.toString(),
    incomingTxCount: grossIncoming.length,
    outgoingTxCount: grossOutgoing.length,
    inflowToOutflowRatio,
    topIncomingCounterparties,
    topOutgoingCounterparties,
    categoryBreakdown,
    terminalLiquidityIncomingRatio,
    terminalLiquidityOutgoingRatio,
    htxHuobiIncomingRatio,
    htxHuobiOutgoingRatio,
    bridgeDexRouterOutgoingRatio,
    unknownContractOutgoingRatio,
    historicalTransitScore: historicalTransitBreakdown.score,
    historicalTransitBreakdown,
    operationalScore: Math.min(85, features.reduce((sum, item) => sum + item.scoreImpact, 0)),
    features
  };
}
