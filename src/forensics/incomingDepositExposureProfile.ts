import type {
  ForensicRouteEdge,
  IncomingDepositOriginPath,
  IncomingExposureSourceKind,
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
  ServiceCategory,
  ServiceClassification
} from "../types";

export type BuildIncomingFreshBundleExposureInput = {
  targetAmountRaw: string;
  originPaths: IncomingDepositOriginPath[];
};

export type BuildIncomingWalletExposureProfileInput = {
  sender: string;
  watchedWallet: string;
  windowStart: Date;
  windowEnd: Date;
  edges: ForensicRouteEdge[];
  getClassificationForAddress(
    address: string
  ): Promise<ServiceClassification | null | undefined> | ServiceClassification | null | undefined;
};

type ShareAccumulator = Record<IncomingExposureSourceKind, number>;

const SHARE_SCALE = 1_000_000n;

function emptyShares(): ShareAccumulator {
  return {
    htx_huobi: 0,
    clean_cex: 0,
    bridge_router_dex: 0,
    unknown_contract: 0,
    risky_label: 0,
    unknown: 0
  };
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function parseRawAmount(value: string): bigint {
  const normalized = value.trim();
  if (!isRawAmountString(normalized)) return 0n;

  try {
    return BigInt(normalized);
  } catch {
    return 0n;
  }
}

function isRawAmountString(value: string): boolean {
  return /^\d+$/.test(value);
}

function share(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator <= 0n) return 0;
  return clampShare(Number((numerator * SHARE_SCALE) / denominator) / Number(SHARE_SCALE));
}

function sourceKindForPath(path: IncomingDepositOriginPath): IncomingExposureSourceKind {
  switch (path.stoppedReason) {
    case "htx_huobi_reached":
      return "htx_huobi";
    case "clean_cex_reached":
      return "clean_cex";
    case "bridge_router_dex_reached":
      return "bridge_router_dex";
    case "unknown_contract_reached":
      return "unknown_contract";
    case "risky_label_reached":
      return "risky_label";
    default:
      return "unknown";
  }
}

function dominantSource(shares: ShareAccumulator): IncomingExposureSourceKind | null {
  let dominant: IncomingExposureSourceKind | null = null;
  let dominantShare = 0;

  for (const kind of Object.keys(shares) as IncomingExposureSourceKind[]) {
    const current = clampShare(shares[kind]);
    if (current > dominantShare) {
      dominant = kind;
      dominantShare = current;
    }
  }

  return dominant;
}

function formatPercent(value: number): string {
  return `${Math.round(clampShare(value) * 100)}%`;
}

function freshExposureReasons(exposure: ShareAccumulator, missingShare: number): string[] {
  const reasons: string[] = [];

  if (exposure.htx_huobi > 0) {
    reasons.push(`HTX/Huobi accounts for ${formatPercent(exposure.htx_huobi)} of checked-deposit source share.`);
  }
  if (exposure.clean_cex > 0) {
    reasons.push(`Clean CEX accounts for ${formatPercent(exposure.clean_cex)} of checked-deposit source share.`);
  }
  if (exposure.bridge_router_dex > 0) {
    reasons.push(`Bridge/router/DEX accounts for ${formatPercent(exposure.bridge_router_dex)} of checked-deposit source share.`);
  }
  if (exposure.unknown_contract > 0) {
    reasons.push(`Unknown contract accounts for ${formatPercent(exposure.unknown_contract)} of checked-deposit source share.`);
  }
  if (exposure.risky_label > 0) {
    reasons.push(`Risky label accounts for ${formatPercent(exposure.risky_label)} of checked-deposit source share.`);
  }
  if (missingShare > 0) {
    reasons.push(`Uncovered checked-deposit source share is assigned to unknown.`);
  }

  return reasons;
}

export function buildIncomingFreshBundleExposure(
  input: BuildIncomingFreshBundleExposureInput
): IncomingFreshBundleExposure {
  const shares = emptyShares();

  for (const path of input.originPaths) {
    const pathShare = clampShare(path.balanceShare ?? 0);
    if (pathShare <= 0) continue;

    shares[sourceKindForPath(path)] += pathShare;
  }

  const observedShare = Object.values(shares).reduce((sum, current) => sum + clampShare(current), 0);
  const missingShare = clampShare(1 - observedShare);
  shares.unknown += missingShare;

  const finalShares = {
    htx_huobi: clampShare(shares.htx_huobi),
    clean_cex: clampShare(shares.clean_cex),
    bridge_router_dex: clampShare(shares.bridge_router_dex),
    unknown_contract: clampShare(shares.unknown_contract),
    risky_label: clampShare(shares.risky_label),
    unknown: clampShare(shares.unknown)
  } satisfies ShareAccumulator;

  return {
    targetAmountRaw: input.targetAmountRaw,
    htxHuobiShare: finalShares.htx_huobi,
    cleanCexShare: finalShares.clean_cex,
    bridgeRouterDexShare: finalShares.bridge_router_dex,
    unknownContractShare: finalShares.unknown_contract,
    riskyLabelShare: finalShares.risky_label,
    unknownShare: finalShares.unknown,
    dominantFreshSource: dominantSource(finalShares),
    reasons: freshExposureReasons(finalShares, missingShare)
  };
}

function edgeKey(edge: ForensicRouteEdge): string {
  const timestamp = edge.timestamp.getTime();
  return [
    edge.txHash,
    edge.fromAddress,
    edge.toAddress,
    edge.amountRaw,
    Number.isFinite(timestamp) ? edge.timestamp.toISOString() : "invalid_timestamp",
    edge.edgeType
  ].join("\u0000");
}

function uniqueEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(edgeKey(edge), edge);
  }
  return [...byKey.values()];
}

function inWindow(edge: ForensicRouteEdge, windowStart: Date, windowEnd: Date): boolean {
  const timestamp = edge.timestamp.getTime();
  return Number.isFinite(timestamp) && timestamp >= windowStart.getTime() && timestamp <= windowEnd.getTime();
}

function isHtxHuobiClassification(classification: ServiceClassification | null | undefined): boolean {
  const text = `${classification?.identity ?? ""} ${classification?.evidence?.join(" ") ?? ""}`.toLowerCase();
  return /\b(htx|huobi)\b/.test(text);
}

function categoryHasBridgeRouterDexText(classification: ServiceClassification | null | undefined): boolean {
  const text = `${classification?.identity ?? ""} ${classification?.evidence?.join(" ") ?? ""}`.toLowerCase();
  return /\b(bridge|router|dex|swap|aggregator)\b/.test(text);
}

function isBridgeRouterDexCategory(
  category: ServiceCategory | null | undefined,
  classification: ServiceClassification | null | undefined
): boolean {
  return category === "bridge" ||
    category === "bridge_pool" ||
    category === "dex" ||
    category === "router" ||
    category === "swap_adapter" ||
    (category === "protocol" && categoryHasBridgeRouterDexText(classification));
}

function isCleanCexClassification(classification: ServiceClassification | null | undefined): boolean {
  return classification?.category === "cex" && !isHtxHuobiClassification(classification);
}

async function classificationForAddress(
  address: string,
  input: BuildIncomingWalletExposureProfileInput,
  cache: Map<string, ServiceClassification | null>,
  warnings: string[]
): Promise<ServiceClassification | null> {
  if (cache.has(address)) return cache.get(address) ?? null;

  try {
    const classification = await input.getClassificationForAddress(address);
    const normalized = classification ?? null;
    cache.set(address, normalized);
    return normalized;
  } catch (error) {
    cache.set(address, null);
    warnings.push(`Classification lookup failed for ${address}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function inOutVelocityScore(incomingVolumeRaw: bigint, outgoingVolumeRaw: bigint): number {
  if (incomingVolumeRaw <= 0n || outgoingVolumeRaw <= 0n) return 0;
  const smaller = incomingVolumeRaw < outgoingVolumeRaw ? incomingVolumeRaw : outgoingVolumeRaw;
  const larger = incomingVolumeRaw > outgoingVolumeRaw ? incomingVolumeRaw : outgoingVolumeRaw;
  return clampScore(share(smaller, larger) * 5, 5);
}

function walletScoreContribution(input: {
  htxHuobiIncomingShare: number;
  bridgeRouterDexVolumeShare: number;
  unknownContractVolumeShare: number;
  unknownSourceShare: number;
  inOutVelocityScore: number;
}): number {
  const htxScore = input.htxHuobiIncomingShare * 20;
  const bridgeScore = input.bridgeRouterDexVolumeShare * 8;
  const unknownContractScore = input.unknownContractVolumeShare * 6;
  const unknownSourceScore = input.unknownSourceShare * 4;

  return clampScore(
    htxScore + bridgeScore + unknownContractScore + unknownSourceScore + input.inOutVelocityScore,
    20
  );
}

function walletReasons(input: {
  htxHuobiIncomingShare: number;
  cleanCexIncomingShare: number;
  bridgeRouterDexVolumeShare: number;
  unknownContractVolumeShare: number;
  unknownSourceShare: number;
  inOutVelocityScore: number;
}): string[] {
  const reasons: string[] = [];

  if (input.htxHuobiIncomingShare > 0) {
    reasons.push(
      `Historical HTX/Huobi sender inflow is ${formatPercent(input.htxHuobiIncomingShare)} of incoming wallet volume; background context only, not fresh deposit proof.`
    );
  }
  if (input.cleanCexIncomingShare > 0) {
    reasons.push(`Historical clean CEX sender inflow is ${formatPercent(input.cleanCexIncomingShare)} of incoming wallet volume.`);
  }
  if (input.bridgeRouterDexVolumeShare > 0) {
    reasons.push(`Sender history touches bridge/router/DEX volume at ${formatPercent(input.bridgeRouterDexVolumeShare)} of total sender-related volume.`);
  }
  if (input.unknownContractVolumeShare > 0) {
    reasons.push(`Sender history touches unknown-contract volume at ${formatPercent(input.unknownContractVolumeShare)} of total sender-related volume.`);
  }
  if (input.unknownSourceShare > 0) {
    reasons.push(`Sender history includes unknown counterparty volume at ${formatPercent(input.unknownSourceShare)} of total sender-related volume.`);
  }
  if (input.inOutVelocityScore > 0) {
    reasons.push(`Sender has both incoming and outgoing volume inside the exposure window.`);
  }

  return reasons;
}

export async function buildIncomingWalletExposureProfile(
  input: BuildIncomingWalletExposureProfileInput
): Promise<IncomingWalletExposureProfile> {
  const warnings: string[] = [];
  const classifications = new Map<string, ServiceClassification | null>();
  const senderEdges = uniqueEdges(input.edges)
    .filter((edge) => inWindow(edge, input.windowStart, input.windowEnd))
    .filter((edge) => edge.fromAddress === input.sender || edge.toAddress === input.sender);

  let incomingVolumeRaw = 0n;
  let outgoingVolumeRaw = 0n;
  let htxHuobiIncomingRaw = 0n;
  let cleanCexIncomingRaw = 0n;
  let bridgeRouterDexRaw = 0n;
  let unknownContractRaw = 0n;
  let unknownSourceRaw = 0n;
  let invalidAmountCount = 0;

  for (const edge of senderEdges) {
    const amountRaw = parseRawAmount(edge.amountRaw);
    if (!isRawAmountString(edge.amountRaw.trim())) invalidAmountCount += 1;

    const isIncoming = edge.toAddress === input.sender && edge.fromAddress !== input.sender;
    const isOutgoing = edge.fromAddress === input.sender && edge.toAddress !== input.sender;
    if (!isIncoming && !isOutgoing) continue;

    const counterparty = isIncoming ? edge.fromAddress : edge.toAddress;
    if (isIncoming) {
      incomingVolumeRaw += amountRaw;
    } else {
      outgoingVolumeRaw += amountRaw;
    }

    if (counterparty === input.watchedWallet || counterparty === input.sender) continue;

    const classification = await classificationForAddress(counterparty, input, classifications, warnings);
    if (isIncoming && isHtxHuobiClassification(classification)) {
      htxHuobiIncomingRaw += amountRaw;
    } else if (isIncoming && isCleanCexClassification(classification)) {
      cleanCexIncomingRaw += amountRaw;
    }

    if (isBridgeRouterDexCategory(classification?.category, classification)) {
      bridgeRouterDexRaw += amountRaw;
    } else if (classification?.category === "unknown_contract") {
      unknownContractRaw += amountRaw;
    } else if (!classification || classification.category === "none") {
      unknownSourceRaw += amountRaw;
    }
  }

  if (invalidAmountCount > 0) {
    warnings.push(`${invalidAmountCount} transfer event(s) had invalid raw amounts and were treated as zero.`);
  }

  const totalSenderRelatedVolumeRaw = incomingVolumeRaw + outgoingVolumeRaw;
  const htxHuobiIncomingShare = share(htxHuobiIncomingRaw, incomingVolumeRaw);
  const cleanCexIncomingShare = share(cleanCexIncomingRaw, incomingVolumeRaw);
  const bridgeRouterDexVolumeShare = share(bridgeRouterDexRaw, totalSenderRelatedVolumeRaw);
  const unknownContractVolumeShare = share(unknownContractRaw, totalSenderRelatedVolumeRaw);
  const unknownSourceShare = share(unknownSourceRaw, totalSenderRelatedVolumeRaw);
  const velocityScore = inOutVelocityScore(incomingVolumeRaw, outgoingVolumeRaw);

  return {
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    transferEventsScanned: senderEdges.length,
    incomingVolumeRaw: incomingVolumeRaw.toString(),
    outgoingVolumeRaw: outgoingVolumeRaw.toString(),
    htxHuobiIncomingShare,
    cleanCexIncomingShare,
    bridgeRouterDexVolumeShare,
    unknownContractVolumeShare,
    unknownSourceShare,
    inOutVelocityScore: velocityScore,
    scoreContribution: walletScoreContribution({
      htxHuobiIncomingShare,
      bridgeRouterDexVolumeShare,
      unknownContractVolumeShare,
      unknownSourceShare,
      inOutVelocityScore: velocityScore
    }),
    reasons: walletReasons({
      htxHuobiIncomingShare,
      cleanCexIncomingShare,
      bridgeRouterDexVolumeShare,
      unknownContractVolumeShare,
      unknownSourceShare,
      inOutVelocityScore: velocityScore
    }),
    warnings
  };
}
