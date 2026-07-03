import { createHash } from "node:crypto";
import type {
  DeepSecondLayerDirectWalletStatusRecord,
  DeepSecondLayerIndexSummary,
  DeepSecondLayerQueueRequest,
  DeepSecondLayerRelationshipGroup,
  DeepSecondLayerRelationshipLimits,
  DeepSecondLayerRelationshipPath,
  DeepSecondLayerRelationshipProfile,
  DirectCounterpartyInteractionProfile,
  ServiceClassification
} from "../types";

export type IndexedSecondLayerEdge = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw?: string | bigint | number | null;
  timestamp?: string | Date | null;
  tokenContract?: string | null;
  assetSymbol?: string | null;
};

export type BuildSecondLayerRelationshipProfilesInput = {
  subjectAddress: string;
  directBoundaryAddresses: readonly string[];
  directCounterpartyProfiles: readonly DirectCounterpartyInteractionProfile[];
  classifications: ReadonlyMap<string, ServiceClassification | null>;
  generatedAt?: string;
  limits?: Partial<DeepSecondLayerRelationshipLimits>;
  getIndexState(address: string): DeepSecondLayerIndexSummary | null | undefined | Promise<DeepSecondLayerIndexSummary | null | undefined>;
  listIndexedEdges(address: string): readonly IndexedSecondLayerEdge[] | Promise<readonly IndexedSecondLayerEdge[]>;
};

const DEFAULT_LIMITS: DeepSecondLayerRelationshipLimits = {
  maxDirectWalletsConsidered: 100,
  maxExpandedDirectWallets: 25,
  maxSecondHopNeighborsPerDirectWallet: 6,
  maxTotalSecondHopEdges: 150,
  highDegreeSuppressionThreshold: 500
};

type NeighborAggregate = {
  address: string;
  amountRaw: bigint;
  txCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  tokenContract: string | null;
  assetSymbol: string | null;
  evidence: DeepSecondLayerRelationshipPath["evidence"];
  txHashes: string[];
};

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function stableId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function amountToBigInt(value: string | bigint | number | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? BigInt(Math.trunc(value)) : 0n;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

function limitValue(defaultValue: number, override: number | undefined): number {
  if (override === undefined) return defaultValue;
  return Number.isFinite(override) ? Math.max(0, Math.floor(override)) : 0;
}

function normalizeLimits(limits: Partial<DeepSecondLayerRelationshipLimits> | undefined): DeepSecondLayerRelationshipLimits {
  return {
    maxDirectWalletsConsidered: limitValue(DEFAULT_LIMITS.maxDirectWalletsConsidered, limits?.maxDirectWalletsConsidered),
    maxExpandedDirectWallets: limitValue(DEFAULT_LIMITS.maxExpandedDirectWallets, limits?.maxExpandedDirectWallets),
    maxSecondHopNeighborsPerDirectWallet: limitValue(
      DEFAULT_LIMITS.maxSecondHopNeighborsPerDirectWallet,
      limits?.maxSecondHopNeighborsPerDirectWallet
    ),
    maxTotalSecondHopEdges: limitValue(DEFAULT_LIMITS.maxTotalSecondHopEdges, limits?.maxTotalSecondHopEdges),
    highDegreeSuppressionThreshold: limitValue(DEFAULT_LIMITS.highDegreeSuppressionThreshold, limits?.highDegreeSuppressionThreshold)
  };
}

function isoTimestamp(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function minTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

function maxTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function isCompleteAllTimeProviderWindow(index: DeepSecondLayerIndexSummary | null | undefined): boolean {
  return Boolean(index && index.status === "complete" && index.coverageMode === "all_time" && index.coverageKind === "provider_windowed");
}

function classificationFor(
  classifications: ReadonlyMap<string, ServiceClassification | null>,
  normalizedClassifications: ReadonlyMap<string, ServiceClassification | null>,
  address: string
): ServiceClassification | null {
  return classifications.get(address) ?? normalizedClassifications.get(normalizeAddress(address)) ?? null;
}

function buildNormalizedClassifications(classifications: ReadonlyMap<string, ServiceClassification | null>): Map<string, ServiceClassification | null> {
  const normalized = new Map<string, ServiceClassification | null>();
  for (const [address, classification] of classifications) normalized.set(normalizeAddress(address), classification);
  return normalized;
}

function directWallets(input: BuildSecondLayerRelationshipProfilesInput, limits: DeepSecondLayerRelationshipLimits): string[] {
  const subject = normalizeAddress(input.subjectAddress);
  const profilesByAddress = new Map<string, DirectCounterpartyInteractionProfile>();
  const displayByAddress = new Map<string, string>();

  for (const profile of input.directCounterpartyProfiles) {
    const normalized = normalizeAddress(profile.counterpartyAddress);
    if (!normalized || normalized === subject) continue;
    profilesByAddress.set(normalized, profile);
    if (!displayByAddress.has(normalized)) displayByAddress.set(normalized, profile.counterpartyAddress);
  }

  for (const address of input.directBoundaryAddresses) {
    const normalized = normalizeAddress(address);
    if (!normalized || normalized === subject) continue;
    if (!displayByAddress.has(normalized)) displayByAddress.set(normalized, address);
  }

  return Array.from(displayByAddress.entries())
    .sort(([leftKey, leftAddress], [rightKey, rightAddress]) => {
      const left = profilesByAddress.get(leftKey);
      const right = profilesByAddress.get(rightKey);
      const volumeDelta = amountToBigInt(right?.volumeRaw) - amountToBigInt(left?.volumeRaw);
      if (volumeDelta !== 0n) return volumeDelta > 0n ? 1 : -1;
      const txDelta = (right?.txCount ?? 0) - (left?.txCount ?? 0);
      if (txDelta !== 0) return txDelta;
      return leftAddress.localeCompare(rightAddress);
    })
    .slice(0, limits.maxDirectWalletsConsidered)
    .map(([, address]) => address);
}

function compareEvidence(
  left: DeepSecondLayerRelationshipPath["evidence"][number],
  right: DeepSecondLayerRelationshipPath["evidence"][number]
): number {
  return (
    (left.timestamp ?? "").localeCompare(right.timestamp ?? "") ||
    left.txHash.localeCompare(right.txHash) ||
    left.fromAddress.localeCompare(right.fromAddress) ||
    left.toAddress.localeCompare(right.toAddress) ||
    (left.amountRaw ?? "").localeCompare(right.amountRaw ?? "")
  );
}

function neighborAggregates(subjectAddress: string, directWalletAddress: string, edges: readonly IndexedSecondLayerEdge[]): NeighborAggregate[] {
  const subject = normalizeAddress(subjectAddress);
  const directWallet = normalizeAddress(directWalletAddress);
  const byNeighbor = new Map<string, NeighborAggregate>();

  for (const edge of edges) {
    const from = normalizeAddress(edge.fromAddress);
    const to = normalizeAddress(edge.toAddress);
    const neighborAddress = from === directWallet ? edge.toAddress : to === directWallet ? edge.fromAddress : null;
    if (!neighborAddress) continue;

    const neighbor = normalizeAddress(neighborAddress);
    if (!neighbor || neighbor === subject || neighbor === directWallet) continue;

    const existing = byNeighbor.get(neighbor);
    const timestamp = isoTimestamp(edge.timestamp);
    const amountRaw = amountToBigInt(edge.amountRaw);
    const evidence = {
      txHash: edge.txHash,
      fromAddress: edge.fromAddress,
      toAddress: edge.toAddress,
      amountRaw: edge.amountRaw == null ? null : amountRaw.toString(),
      timestamp
    };

    if (existing) {
      existing.amountRaw += amountRaw;
      existing.txCount += 1;
      existing.firstSeen = minTimestamp(existing.firstSeen, timestamp);
      existing.lastSeen = maxTimestamp(existing.lastSeen, timestamp);
      existing.evidence.push(evidence);
      existing.txHashes.push(edge.txHash);
      existing.tokenContract ??= edge.tokenContract ?? null;
      existing.assetSymbol ??= edge.assetSymbol ?? null;
    } else {
      byNeighbor.set(neighbor, {
        address: neighborAddress,
        amountRaw,
        txCount: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
        tokenContract: edge.tokenContract ?? null,
        assetSymbol: edge.assetSymbol ?? null,
        evidence: [evidence],
        txHashes: [edge.txHash]
      });
    }
  }

  return Array.from(byNeighbor.values()).map((neighbor) => {
    const evidence = [...neighbor.evidence].sort(compareEvidence);
    return { ...neighbor, evidence, txHashes: evidence.map((item) => item.txHash) };
  }).sort((left, right) => {
    const amountDelta = right.amountRaw - left.amountRaw;
    if (amountDelta !== 0n) return amountDelta > 0n ? 1 : -1;
    if (right.txCount !== left.txCount) return right.txCount - left.txCount;
    return left.address.localeCompare(right.address);
  });
}

function pathFor(input: {
  subjectAddress: string;
  directWalletAddress: string;
  neighbor: NeighborAggregate;
}): DeepSecondLayerRelationshipPath {
  return {
    id: stableId(["deep_second_layer_path", input.subjectAddress, input.directWalletAddress, input.neighbor.address, ...input.neighbor.txHashes]),
    source: "deepcheck_relationship_second_hop",
    depth: 2,
    subjectAddress: input.subjectAddress,
    directWalletAddress: input.directWalletAddress,
    secondHopAddress: input.neighbor.address,
    pathAddresses: [input.subjectAddress, input.directWalletAddress, input.neighbor.address],
    txHashes: input.neighbor.txHashes,
    txCount: input.neighbor.txCount,
    amountRaw: input.neighbor.amountRaw.toString(),
    firstSeen: input.neighbor.firstSeen,
    lastSeen: input.neighbor.lastSeen,
    tokenContract: input.neighbor.tokenContract,
    assetSymbol: input.neighbor.assetSymbol,
    evidence: input.neighbor.evidence,
    selectionReason: "top_amount_or_activity"
  };
}

function groupFor(input: {
  subjectAddress: string;
  directWalletAddress: string;
  tail: readonly NeighborAggregate[];
}): DeepSecondLayerRelationshipGroup {
  const amountRaw = input.tail.reduce((sum, neighbor) => sum + neighbor.amountRaw, 0n);
  const txCount = input.tail.reduce((sum, neighbor) => sum + neighbor.txCount, 0);
  const firstSeen = input.tail.reduce<string | null>((earliest, neighbor) => minTimestamp(earliest, neighbor.firstSeen), null);
  const lastSeen = input.tail.reduce<string | null>((latest, neighbor) => maxTimestamp(latest, neighbor.lastSeen), null);
  const members = input.tail.map((neighbor) => neighbor.address).sort((left, right) => left.localeCompare(right));

  return {
    id: stableId(["deep_second_layer_group", input.subjectAddress, input.directWalletAddress, ...members]),
    kind: "low_signal_neighbors",
    label: `${members.length} low-signal neighbors`,
    subjectAddress: input.subjectAddress,
    directWalletAddress: input.directWalletAddress,
    memberCount: members.length,
    members,
    txCount,
    amountRaw: amountRaw.toString(),
    firstSeen,
    lastSeen
  };
}

function emptyCounters(): DeepSecondLayerRelationshipProfile["counters"] {
  return {
    directWalletsConsidered: 0,
    expanded: 0,
    grouped: 0,
    stopped: 0,
    notIndexed: 0,
    queued: 0,
    complete: 0,
    paths: 0,
    groups: 0,
    maxSavedDepth: 0
  };
}

export async function buildSecondLayerRelationshipProfiles(input: BuildSecondLayerRelationshipProfilesInput): Promise<DeepSecondLayerRelationshipProfile> {
  const limits = normalizeLimits(input.limits);
  const normalizedClassifications = buildNormalizedClassifications(input.classifications);
  const statuses: DeepSecondLayerDirectWalletStatusRecord[] = [];
  const paths: DeepSecondLayerRelationshipPath[] = [];
  const groups: DeepSecondLayerRelationshipGroup[] = [];
  const queueRequests: DeepSecondLayerQueueRequest[] = [];
  const counters = emptyCounters();
  let expandedDirectWallets = 0;

  for (const address of directWallets(input, limits)) {
    counters.directWalletsConsidered += 1;

    const classification = classificationFor(input.classifications, normalizedClassifications, address);
    if (classification?.isBoundary === true && classification.category !== "none") {
      counters.stopped += 1;
      statuses.push({
        address,
        status: "stopped_service_boundary",
        stopReason: "service_boundary",
        limitationCode: "deep_second_layer_service_boundary",
        queued: false,
        serviceCategory: classification.category,
        identity: classification.identity,
        index: null,
        savedPathCount: 0,
        groupedNeighborCount: 0
      });
      continue;
    }

    const index = await input.getIndexState(address) ?? null;
    if (isCompleteAllTimeProviderWindow(index) && index && index.uniqueCounterpartyCount >= limits.highDegreeSuppressionThreshold) {
      counters.stopped += 1;
      statuses.push({
        address,
        status: "stopped_high_degree",
        stopReason: "high_degree",
        limitationCode: "deep_second_layer_high_degree",
        queued: false,
        serviceCategory: classification?.category ?? null,
        identity: classification?.identity ?? null,
        index,
        savedPathCount: 0,
        groupedNeighborCount: 0
      });
      continue;
    }

    if (!isCompleteAllTimeProviderWindow(index)) {
      counters.notIndexed += 1;
      queueRequests.push({ address, coverageMode: "all_time", queuedReason: "deep_second_layer" });
      statuses.push({
        address,
        status: "not_indexed",
        stopReason: "index_not_complete",
        limitationCode: "deep_second_layer_not_indexed",
        queued: false,
        serviceCategory: classification?.category ?? null,
        identity: classification?.identity ?? null,
        index,
        savedPathCount: 0,
        groupedNeighborCount: 0
      });
      continue;
    }

    if (expandedDirectWallets >= limits.maxExpandedDirectWallets) {
      // ponytail: status union has no budget-exhausted state; omit complete over-budget wallets until the report schema grows one.
      continue;
    }

    const neighbors = neighborAggregates(input.subjectAddress, address, await input.listIndexedEdges(address));
    if (neighbors.length === 0) {
      counters.complete += 1;
      statuses.push({
        address,
        status: "no_meaningful_second_hop",
        stopReason: "no_meaningful_second_hop",
        limitationCode: "deep_second_layer_no_meaningful_neighbor",
        queued: false,
        serviceCategory: classification?.category ?? null,
        identity: classification?.identity ?? null,
        index,
        savedPathCount: 0,
        groupedNeighborCount: 0
      });
      expandedDirectWallets += 1;
      continue;
    }

    const remainingPathBudget = Math.max(0, limits.maxTotalSecondHopEdges - paths.length);
    const selected = neighbors.slice(0, Math.min(limits.maxSecondHopNeighborsPerDirectWallet, remainingPathBudget));
    const tail = neighbors.slice(selected.length);
    const walletPaths = selected.map((neighbor) => pathFor({ subjectAddress: input.subjectAddress, directWalletAddress: address, neighbor }));
    paths.push(...walletPaths);

    if (tail.length > 0) groups.push(groupFor({ subjectAddress: input.subjectAddress, directWalletAddress: address, tail }));

    counters.complete += 1;
    if (tail.length > 0) counters.grouped += 1;
    else counters.expanded += 1;
    statuses.push({
      address,
      status: tail.length > 0 ? "grouped" : "expanded",
      stopReason: null,
      limitationCode: null,
      queued: false,
      serviceCategory: classification?.category ?? null,
      identity: classification?.identity ?? null,
      index,
      savedPathCount: walletPaths.length,
      groupedNeighborCount: tail.length
    });
    expandedDirectWallets += 1;
  }

  counters.paths = paths.length;
  counters.groups = groups.length;
  counters.maxSavedDepth = paths.length > 0 ? 2 : 0;

  return {
    subjectAddress: input.subjectAddress,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    limits,
    directWalletStatuses: statuses,
    paths,
    groups,
    queueRequests,
    counters
  };
}

export function markSecondLayerQueued(
  profile: DeepSecondLayerRelationshipProfile,
  queuedAddresses: readonly string[]
): DeepSecondLayerRelationshipProfile {
  const queued = new Set(queuedAddresses.map(normalizeAddress));
  let newlyQueued = 0;
  let newlyNotIndexed = 0;

  const directWalletStatuses = profile.directWalletStatuses.map((status) => {
    if (!queued.has(normalizeAddress(status.address)) || status.status === "queued") return status;
    if (status.status !== "not_indexed") return status;
    newlyQueued += 1;
    if (!status.queued) newlyNotIndexed += 1;
    return {
      ...status,
      status: "queued" as const,
      stopReason: "queued_for_indexing" as const,
      limitationCode: "deep_second_layer_queued" as const,
      queued: true
    };
  });

  if (newlyQueued === 0) return profile;

  return {
    ...profile,
    directWalletStatuses,
    counters: {
      ...profile.counters,
      notIndexed: Math.max(0, profile.counters.notIndexed - newlyNotIndexed),
      queued: profile.counters.queued + newlyQueued
    }
  };
}
