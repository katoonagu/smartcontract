import type {
  AddressLabel,
  CounterpartyRiskDirection,
  DirectPrincipalCounterpartyGroup,
  FirstHopBlacklistCoverage,
  FirstHopBlacklistFact,
  FirstHopLabelFact,
  ForensicRouteEdge,
  ServiceClassification,
  TimelineBearingStablecoinRestrictionProfile,
  UsdtBlacklistTimeline,
  UsdtBlacklistTimelineEvent
} from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";
import {
  matchSanctionedCryptoService,
  sanctionedCryptoServiceActiveAt
} from "./sanctionedServiceRegistry";

export const DIRECT_BOUNDARY_MAX_MATERIALIZED_TRANSFERS = 50_000;
export const DEFAULT_DIRECT_BOUNDARY_PAGE_SIZE = 1_000;
const DIRECT_PRINCIPAL_ABSOLUTE_MATERIAL_RAW = 10_000_000000n;
const DIRECT_PRINCIPAL_RELATIVE_MINIMUM_RAW = 100_000000n;

export type DirectHardEvidenceSnapshot = {
  address: string;
  labels: AddressLabel[];
  classification: ServiceClassification | null;
  usdtRestriction: TimelineBearingStablecoinRestrictionProfile | null;
  evidenceStatus: "live_checked" | "local_only";
  hasHardEvidence: boolean;
  reasons: string[];
};

export type DirectHardEvidenceResult = {
  status: "complete" | "local_only_partial" | "live_budget_exhausted";
  checkedCount: number;
  liveCheckedCount: number;
  liveFailedCount: number;
  serviceCount: number;
  blacklistedCount: number;
  blacklistFacts: FirstHopBlacklistFact[];
  labelFacts: FirstHopLabelFact[];
  firstHopBlacklistCoverage: FirstHopBlacklistCoverage;
  snapshots: DirectHardEvidenceSnapshot[];
  missingChecks: string[];
};

type MutableDirectPrincipalCounterpartyGroup = {
  address: string;
  direction: CounterpartyRiskDirection;
  principalAmountRaw: bigint;
  transferTxHashes: string[];
  seenTxHashes: Set<string>;
  principalTransfers: DirectPrincipalCounterpartyGroup["principalTransfers"];
};

function normalizedAddress(address: string): string {
  return address.trim();
}

function principalAmountRaw(amountRaw: string): bigint {
  if (!/^\d+$/.test(amountRaw)) throw new Error(`Invalid direct principal amount: ${amountRaw}`);
  return BigInt(amountRaw);
}

function exactShare(numerator: bigint, denominator: bigint): number {
  return denominator > 0n
    ? Number(numerator * 100_000_000n / denominator) / 100_000_000
    : 0;
}

function compareBigintDesc(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function groupDirectPrincipalCounterparties(input: {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  directTransferCoverage: "complete" | "partial";
}): DirectPrincipalCounterpartyGroup[] {
  const subject = normalizedAddress(input.subjectAddress);
  const groups = new Map<string, MutableDirectPrincipalCounterpartyGroup>();
  const directionalTotals: Record<CounterpartyRiskDirection, bigint> = {
    inbound: 0n,
    outbound: 0n
  };
  const seenEdgeIds = new Set<string>();
  const edgeSignatures = new Map<string, string>();

  for (const edge of input.edges) {
    if (isGasFreeServiceFeeEdge(edge)) continue;
    const from = normalizedAddress(edge.fromAddress);
    const to = normalizedAddress(edge.toAddress);
    if (from === subject && to === subject) continue;
    const direction = to === subject
      ? "inbound" as const
      : from === subject
        ? "outbound" as const
        : null;
    if (!direction) continue;
    const amountRaw = principalAmountRaw(edge.amountRaw);
    if (amountRaw <= 0n) continue;
    if (!Number.isFinite(edge.timestamp.getTime())) throw new Error(`Invalid direct principal timestamp for ${edge.txHash}`);
    const edgeId = typeof edge.id === "string" && edge.id.trim().length > 0 ? edge.id : null;
    if (edgeId !== null) {
      const signature = JSON.stringify({
        fromAddress: edge.fromAddress,
        toAddress: edge.toAddress,
        amountRaw: edge.amountRaw,
        txHash: edge.txHash,
        timestamp: edge.timestamp.toISOString(),
        economicRole: edge.economicRole ?? null,
        economicProtocol: edge.economicProtocol ?? null
      });
      const previous = edgeSignatures.get(edgeId);
      if (previous !== undefined && previous !== signature) {
        throw new Error(`Conflicting direct principal edge id: ${edgeId}`);
      }
      if (seenEdgeIds.has(edgeId)) continue;
      seenEdgeIds.add(edgeId);
      edgeSignatures.set(edgeId, signature);
    }
    const address = (direction === "inbound" ? edge.fromAddress : edge.toAddress).trim();
    const key = `${direction}:${normalizedAddress(address)}`;
    const group = groups.get(key) ?? {
      address,
      direction,
      principalAmountRaw: 0n,
      transferTxHashes: [],
      seenTxHashes: new Set<string>(),
      principalTransfers: []
    };
    group.principalAmountRaw += amountRaw;
    group.principalTransfers.push({
      txHash: edge.txHash,
      amountRaw,
      occurredAt: edge.timestamp.toISOString()
    });
    if (!group.seenTxHashes.has(edge.txHash)) {
      group.seenTxHashes.add(edge.txHash);
      group.transferTxHashes.push(edge.txHash);
    }
    groups.set(key, group);
    directionalTotals[direction] += amountRaw;
  }

  return [...groups.values()]
    .map((group): DirectPrincipalCounterpartyGroup => {
      const denominator = directionalTotals[group.direction];
      const shareExact = input.directTransferCoverage === "complete";
      return {
        address: group.address,
        direction: group.direction,
        principalAmountRaw: group.principalAmountRaw,
        principalTxCount: group.transferTxHashes.length,
        directionalPrincipalShare: shareExact ? exactShare(group.principalAmountRaw, denominator) : null,
        shareSemantics: shareExact ? "exact" : "unavailable",
        transferTxHashes: group.transferTxHashes,
        principalTransfers: group.principalTransfers,
        material: group.principalAmountRaw >= DIRECT_PRINCIPAL_ABSOLUTE_MATERIAL_RAW || (
          shareExact &&
          group.principalAmountRaw >= DIRECT_PRINCIPAL_RELATIVE_MINIMUM_RAW &&
          group.principalAmountRaw * 100n >= denominator
        )
      };
    })
    .sort((left, right) =>
      compareBigintDesc(left.principalAmountRaw, right.principalAmountRaw) ||
      compareText(left.address, right.address) ||
      compareText(left.direction, right.direction)
    );
}

export function selectDirectPrincipalLookupAddresses(
  groups: DirectPrincipalCounterpartyGroup[],
  liveLimit: number
): string[] {
  const combinedByAddress = new Map<string, {
    address: string;
    principalAmountRaw: bigint;
    hasMaterial: boolean;
  }>();
  for (const group of groups) {
    const key = normalizedAddress(group.address);
    const combined = combinedByAddress.get(key) ?? {
      address: key,
      principalAmountRaw: 0n,
      hasMaterial: false
    };
    combined.principalAmountRaw += group.principalAmountRaw;
    combined.hasMaterial ||= group.material;
    combinedByAddress.set(key, combined);
  }
  return [...combinedByAddress.values()]
    .filter((item) => item.hasMaterial)
    .sort((left, right) =>
      compareBigintDesc(left.principalAmountRaw, right.principalAmountRaw) ||
      compareText(left.address, right.address)
    )
    .slice(0, Math.max(0, Math.trunc(liveLimit)))
    .map((item) => item.address);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workerCount = Math.max(1, Math.min(Math.trunc(concurrency), items.length || 1));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function uniqueAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of addresses) {
    if (!address || seen.has(address)) continue;
    seen.add(address);
    result.push(address);
  }
  return result;
}

type TransferTiming = "before" | "active" | "unknown";

function sortedVerifiedTimeline(events: UsdtBlacklistTimelineEvent[]): UsdtBlacklistTimelineEvent[] {
  return [...events]
    .filter((event) => event.verification === "verified_contract_log")
    .sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      (left.blockNumber ?? Number.MAX_SAFE_INTEGER) - (right.blockNumber ?? Number.MAX_SAFE_INTEGER) ||
      (left.logIndex ?? Number.MAX_SAFE_INTEGER) - (right.logIndex ?? Number.MAX_SAFE_INTEGER) ||
      compareText(left.txHash, right.txHash)
    );
}

function completeActiveTimeline(timeline: UsdtBlacklistTimeline | null | undefined): boolean {
  if (timeline?.pagination !== "complete" || timeline.failureReason !== null) return false;
  const events = sortedVerifiedTimeline(timeline.events);
  if (events.length !== timeline.events.length) return false;
  if (events.some((event) => !Number.isFinite(Date.parse(event.occurredAt)))) return false;
  return events.reduce((active, event) => event.eventKind === "added", false);
}

function transferTiming(
  occurredAt: string,
  events: UsdtBlacklistTimelineEvent[],
  timelineComplete: boolean
): TransferTiming {
  if (!timelineComplete) return "unknown";
  const transferTime = Date.parse(occurredAt);
  if (!Number.isFinite(transferTime)) return "unknown";
  let active = false;
  for (const event of events) {
    const eventTime = Date.parse(event.occurredAt);
    if (!Number.isFinite(eventTime)) return "unknown";
    // A direct transfer has no log index, so equal wall-clock time cannot prove ordering.
    if (eventTime === transferTime) return "unknown";
    if (eventTime > transferTime) break;
    active = event.eventKind === "added";
  }
  return active ? "active" : "before";
}

function buildBlacklistFact(input: {
  group: DirectPrincipalCounterpartyGroup;
  restriction: TimelineBearingStablecoinRestrictionProfile;
  directTransferCoverage: "complete" | "partial";
  conflictingTxHashes: Set<string>;
}): FirstHopBlacklistFact {
  const timeline = input.restriction.blacklistTimeline ?? null;
  const events = sortedVerifiedTimeline(timeline?.events ?? []);
  const timelineComplete = completeActiveTimeline(timeline);
  const repeatedAdditionLifecycle = events.filter((event) => event.eventKind === "added").length > 1;
  const amounts: Record<TransferTiming, bigint> = { before: 0n, active: 0n, unknown: 0n };
  const hashes: Record<TransferTiming, Set<string>> = {
    before: new Set<string>(),
    active: new Set<string>(),
    unknown: new Set<string>()
  };
  const transfersByTxHash = new Map<string, DirectPrincipalCounterpartyGroup["principalTransfers"]>();
  for (const transfer of input.group.principalTransfers) {
    const transfers = transfersByTxHash.get(transfer.txHash) ?? [];
    transfers.push(transfer);
    transfersByTxHash.set(transfer.txHash, transfers);
  }
  for (const [txHash, transfers] of transfersByTxHash) {
    const occurredAtValues = new Set(transfers.map((transfer) => transfer.occurredAt));
    const transferTimings = new Set(transfers.map((transfer) =>
      transferTiming(transfer.occurredAt, events, timelineComplete)
    ));
    const timing = repeatedAdditionLifecycle ||
      input.conflictingTxHashes.has(txHash) ||
      occurredAtValues.size !== 1 ||
      transferTimings.size !== 1
      ? "unknown"
      : [...transferTimings][0];
    amounts[timing] += transfers.reduce((sum, transfer) => sum + transfer.amountRaw, 0n);
    hashes[timing].add(txHash);
  }
  const temporalRelation = hashes.unknown.size > 0
    ? "unknown" as const
    : hashes.active.size > 0 && hashes.before.size > 0
      ? "mixed" as const
      : hashes.active.size > 0
        ? "active_at_transfer" as const
        : "became_active_after" as const;
  const effectiveEvent = [...events].reverse().find((event) => event.eventKind === "added") ?? null;

  return {
    counterpartyAddress: input.group.address,
    direction: input.group.direction,
    evidenceKind: "usdt_blacklist",
    evidenceAuthority: "official_contract",
    statusAtCheck: "active",
    temporalRelation,
    effectiveAt: effectiveEvent?.occurredAt ?? input.restriction.blacklistEventTimestamp ?? null,
    effectiveTxHash: effectiveEvent?.txHash ?? input.restriction.blacklistEventTxHash ?? null,
    checkedAt: input.restriction.checkedAt,
    principalAmountRaw: input.group.principalAmountRaw.toString(),
    principalTxCount: input.group.principalTxCount,
    directionalPrincipalShare: input.directTransferCoverage === "complete"
      ? input.group.directionalPrincipalShare
      : null,
    shareSemantics: input.directTransferCoverage === "complete" ? "exact" : "unavailable",
    transferTxHashes: [...input.group.transferTxHashes].sort(compareText),
    beforeEffectiveAmountRaw: amounts.before.toString(),
    beforeEffectiveTxCount: hashes.before.size,
    activeAmountRaw: amounts.active.toString(),
    activeTxCount: hashes.active.size,
    unknownTimingAmountRaw: amounts.unknown.toString(),
    unknownTimingTxCount: hashes.unknown.size,
    directTransferCoverage: input.directTransferCoverage,
    timelineCoverage: timelineComplete ? "complete" : "partial",
    timelineEvents: events
  };
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid first-hop coverage bound: ${String(value)}`);
  return date.toISOString();
}

function sanctionReason(
  classification: ServiceClassification | null,
  groups: DirectPrincipalCounterpartyGroup[],
  selectedProvenanceTxHashes: Set<string>
): string | null {
  if (!classification) return null;
  const service = matchSanctionedCryptoService([
    classification.identity,
    ...classification.evidence
  ].filter(Boolean).join(" "));
  if (!service) return null;
  return groups.some((group) => group.direction === "inbound" && group.principalTransfers.some((transfer) =>
    selectedProvenanceTxHashes.has(transfer.txHash) &&
    sanctionedCryptoServiceActiveAt(service, transfer.occurredAt)
  )) ? `sanctioned_service:${service.key}` : null;
}

function validateCoverageShareEnvelope(
  groups: DirectPrincipalCounterpartyGroup[],
  coverage: "complete" | "partial"
): void {
  for (const group of groups) {
    const exactShare = group.shareSemantics === "exact" && group.directionalPrincipalShare !== null;
    const unavailableShare = group.shareSemantics === "unavailable" && group.directionalPrincipalShare === null;
    if (coverage === "complete" ? !exactShare : !unavailableShare) {
      throw new Error(
        `Direct transfer coverage/share mismatch for ${group.direction}:${group.address}.`
      );
    }
  }
}

function comparePersistedPrincipal(
  left: { principalAmountRaw: string; counterpartyAddress: string; direction: CounterpartyRiskDirection },
  right: { principalAmountRaw: string; counterpartyAddress: string; direction: CounterpartyRiskDirection }
): number {
  return compareBigintDesc(BigInt(left.principalAmountRaw), BigInt(right.principalAmountRaw)) ||
    compareText(left.counterpartyAddress, right.counterpartyAddress) ||
    compareText(left.direction, right.direction);
}

function conflictingPrincipalTxHashes(groups: DirectPrincipalCounterpartyGroup[]): Set<string> {
  const timestampsByTxHash = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const group of groups) {
    for (const transfer of group.principalTransfers) {
      const previous = timestampsByTxHash.get(transfer.txHash);
      if (previous !== undefined && previous !== transfer.occurredAt) conflicting.add(transfer.txHash);
      else timestampsByTxHash.set(transfer.txHash, transfer.occurredAt);
    }
  }
  return conflicting;
}

export async function buildDirectHardEvidenceSnapshots(input: {
  addresses: string[];
  principalGroups?: DirectPrincipalCounterpartyGroup[];
  directTransferCoverage?: "complete" | "partial";
  windowStart?: Date | string | null;
  windowEnd?: Date | string | null;
  requiredForDecision?: boolean;
  selectedProvenanceTxHashes?: string[];
  concurrency?: number;
  liveLimit?: number;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getUsdtRestrictionStatus?(
    address: string,
    options?: { includeEventTimeline?: boolean }
  ): Promise<TimelineBearingStablecoinRestrictionProfile>;
}): Promise<DirectHardEvidenceResult> {
  const hasDirectedPrincipalGroups = input.principalGroups !== undefined;
  const principalGroups = input.principalGroups ?? [];
  const materialGroups = principalGroups.filter((group) => group.material);
  const materialAddresses = selectDirectPrincipalLookupAddresses(principalGroups, Number.MAX_SAFE_INTEGER);
  const conflictingTxHashes = conflictingPrincipalTxHashes(materialGroups);
  const requestedDirectTransferCoverage = hasDirectedPrincipalGroups
    ? input.directTransferCoverage ?? "partial"
    : "partial";
  if (hasDirectedPrincipalGroups) validateCoverageShareEnvelope(principalGroups, requestedDirectTransferCoverage);
  const directTransferCoverage = conflictingTxHashes.size > 0
    ? "partial" as const
    : requestedDirectTransferCoverage;
  const hasWindowStart = input.windowStart !== null && input.windowStart !== undefined;
  const hasWindowEnd = input.windowEnd !== null && input.windowEnd !== undefined;
  if (
    hasDirectedPrincipalGroups &&
    directTransferCoverage !== "complete" &&
    (!hasWindowStart || !hasWindowEnd)
  ) {
    throw new Error("Partial first-hop coverage requires explicit checked-window bounds.");
  }
  if (!hasDirectedPrincipalGroups && hasWindowStart !== hasWindowEnd) {
    throw new Error("Legacy first-hop checked-window bounds must be both present or both absent.");
  }
  const checkedWindowStart = directTransferCoverage === "complete" || !hasWindowStart
    ? null
    : isoOrNull(input.windowStart);
  const checkedWindowEnd = directTransferCoverage === "complete" || !hasWindowEnd
    ? null
    : isoOrNull(input.windowEnd);
  if (
    checkedWindowStart !== null &&
    checkedWindowEnd !== null &&
    Date.parse(checkedWindowStart) > Date.parse(checkedWindowEnd)
  ) {
    throw new Error("First-hop checked-window start must not be after its end.");
  }
  const addresses = input.principalGroups
    ? materialAddresses
    : uniqueAddresses(input.addresses);
  const liveLimit = Math.max(0, Math.trunc(input.liveLimit ?? 250));
  const liveAddresses = input.getUsdtRestrictionStatus ? new Set(addresses.slice(0, liveLimit)) : new Set<string>();
  const missingChecks: string[] = [];
  const checkedAddresses = new Set<string>();
  const failedAddresses = new Set<string>();
  const selectedProvenanceTxHashes = new Set(
    (input.selectedProvenanceTxHashes ?? []).filter((txHash) => txHash.length > 0)
  );
  const groupsByAddress = new Map<string, DirectPrincipalCounterpartyGroup[]>();
  for (const group of principalGroups) {
    const key = normalizedAddress(group.address);
    const groups = groupsByAddress.get(key) ?? [];
    groups.push(group);
    groupsByAddress.set(key, groups);
  }

  const snapshots = await mapWithConcurrency(addresses, input.concurrency ?? 8, async (address) => {
    const [labels, classification] = await Promise.all([
      input.getLabelsForAddress(address),
      input.getClassificationForAddress(address)
    ]);
    let usdtRestriction: TimelineBearingStablecoinRestrictionProfile | null = null;
    if (liveAddresses.has(address) && input.getUsdtRestrictionStatus) {
      try {
        usdtRestriction = await input.getUsdtRestrictionStatus(address, { includeEventTimeline: true });
        checkedAddresses.add(address);
      } catch (error) {
        failedAddresses.add(address);
        missingChecks.push(`Direct hard evidence USDT blacklist lookup incomplete for ${address}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const relatedGroups = groupsByAddress.get(normalizedAddress(address)) ?? [];
    const sanctioned = sanctionReason(classification, relatedGroups, selectedProvenanceTxHashes);
    const reasons = [
      ...labels.map((label) => `label:${label.label}`),
      ...(classification?.isBoundary ? [`service:${classification.identity ?? classification.category}`] : []),
      ...(sanctioned ? [sanctioned] : []),
      ...(usdtRestriction?.isBlacklisted ? ["usdt_blacklist"] : [])
    ];

    return {
      address,
      labels,
      classification,
      usdtRestriction,
      evidenceStatus: liveAddresses.has(address) ? "live_checked" as const : "local_only" as const,
      hasHardEvidence: reasons.length > 0,
      reasons
    };
  });

  const liveFailedCount = missingChecks.length;
  const liveCheckedCount = snapshots.filter((snapshot) =>
    snapshot.evidenceStatus === "live_checked" && snapshot.usdtRestriction !== null
  ).length;
  const status = !input.getUsdtRestrictionStatus
    ? "local_only_partial"
    : liveFailedCount > 0
      ? "local_only_partial"
      : liveAddresses.size >= addresses.length ? "complete" : "live_budget_exhausted";
  const snapshotsByAddress = new Map(snapshots.map((snapshot) => [normalizedAddress(snapshot.address), snapshot]));
  const blacklistFacts = materialGroups.flatMap((group) => {
    const restriction = snapshotsByAddress.get(normalizedAddress(group.address))?.usdtRestriction;
    return restriction?.isBlacklisted
      ? [buildBlacklistFact({ group, restriction, directTransferCoverage, conflictingTxHashes })]
      : [];
  }).sort(comparePersistedPrincipal);
  const labelFacts = materialGroups.flatMap((group): FirstHopLabelFact[] => {
    const labels = snapshotsByAddress.get(normalizedAddress(group.address))?.labels ?? [];
    return labels.map((label) => ({
      counterpartyAddress: group.address,
      direction: group.direction,
      labelCode: label.label,
      evidenceAuthority: label.source === "service_admin" ? "exact_internal" : "derived",
      recordedAt: label.createdAt.toISOString(),
      effectiveAt: null,
      principalAmountRaw: group.principalAmountRaw.toString(),
      principalTxCount: group.principalTxCount,
      directionalPrincipalShare: directTransferCoverage === "complete"
        ? group.directionalPrincipalShare
        : null,
      shareSemantics: directTransferCoverage === "complete" ? "exact" : "unavailable",
      transferTxHashes: [...group.transferTxHashes].sort(compareText),
      linkedToSelectedProvenance: group.transferTxHashes.some((txHash) =>
        selectedProvenanceTxHashes.has(txHash)
      )
    }));
  }).sort((left, right) =>
    comparePersistedPrincipal(left, right) ||
    compareText(left.labelCode, right.labelCode) ||
    compareText(left.recordedAt, right.recordedAt) ||
    compareText(left.evidenceAuthority, right.evidenceAuthority)
  );
  const materialCounterpartyCount = materialAddresses.length;
  const checkedMaterialCounterpartyCount = hasDirectedPrincipalGroups ? checkedAddresses.size : 0;
  const failedMaterialCounterpartyCount = hasDirectedPrincipalGroups ? failedAddresses.size : 0;
  const uncheckedMaterialCounterpartyCount = Math.max(
    0,
    materialCounterpartyCount - checkedMaterialCounterpartyCount - failedMaterialCounterpartyCount
  );
  const completeTimelineFactCount = blacklistFacts.filter((fact) => fact.timelineCoverage === "complete").length;
  const partialTimelineFactCount = blacklistFacts.filter((fact) => fact.timelineCoverage === "partial").length;
  const blacklistCheckCoverage = !hasDirectedPrincipalGroups
    ? "history_partial" as const
    : !input.getUsdtRestrictionStatus
      ? "running" as const
      : failedMaterialCounterpartyCount > 0
        ? "provider_failed" as const
        : uncheckedMaterialCounterpartyCount > 0
          ? "budget_exhausted" as const
          : directTransferCoverage === "partial" || partialTimelineFactCount > 0
            ? "history_partial" as const
            : "complete" as const;
  const incompleteReason = !hasDirectedPrincipalGroups
    ? "Legacy integration is pending directed principal groups; snapshots are excluded from first-hop decision coverage."
    : blacklistCheckCoverage === "complete"
      ? null
      : blacklistCheckCoverage === "running"
        ? "USDT blacklist provider is not available for this run."
        : blacklistCheckCoverage === "provider_failed"
          ? `${failedMaterialCounterpartyCount} material counterparty blacklist lookup(s) failed.`
          : blacklistCheckCoverage === "budget_exhausted"
            ? `${uncheckedMaterialCounterpartyCount} material counterparty blacklist lookup(s) were outside the live budget.`
            : conflictingTxHashes.size > 0
              ? `${conflictingTxHashes.size} direct principal transaction(s) have conflicting timestamps.`
              : directTransferCoverage === "partial"
                ? "Direct principal transfer history is partial."
                : "A confirmed adverse blacklist fact has only partial timeline history.";
  const firstHopBlacklistCoverage: FirstHopBlacklistCoverage = {
    requiredForDecision: hasDirectedPrincipalGroups && (input.requiredForDecision ?? materialCounterpartyCount > 0),
    scope: directTransferCoverage === "complete" ? "all_time" : "checked_window",
    windowStart: checkedWindowStart,
    windowEnd: checkedWindowEnd,
    directPrincipalTransferCoverage: directTransferCoverage,
    materialCounterpartyCount,
    checkedMaterialCounterpartyCount,
    failedMaterialCounterpartyCount,
    uncheckedMaterialCounterpartyCount,
    blacklistCheckCoverage,
    incompleteReason,
    confirmedAdverseFactCount: blacklistFacts.length,
    completeTimelineFactCount,
    partialTimelineFactCount
  };

  return {
    status,
    checkedCount: snapshots.length,
    liveCheckedCount,
    liveFailedCount,
    serviceCount: snapshots.filter((snapshot) => snapshot.labels.length > 0 || snapshot.classification?.isBoundary).length,
    blacklistedCount: snapshots.filter((snapshot) => snapshot.usdtRestriction?.isBlacklisted).length,
    blacklistFacts,
    labelFacts,
    firstHopBlacklistCoverage,
    snapshots,
    missingChecks: missingChecks.sort(compareText)
  };
}
