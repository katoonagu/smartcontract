import type {
  AddressLabel,
  CounterpartyRiskDirection,
  DirectPrincipalCounterpartyGroup,
  ForensicRouteEdge,
  ServiceClassification,
  StablecoinRestrictionProfile
} from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";

export const DIRECT_BOUNDARY_MAX_MATERIALIZED_TRANSFERS = 50_000;
export const DEFAULT_DIRECT_BOUNDARY_PAGE_SIZE = 1_000;
const DIRECT_PRINCIPAL_ABSOLUTE_MATERIAL_RAW = 10_000_000000n;
const DIRECT_PRINCIPAL_RELATIVE_MINIMUM_RAW = 100_000000n;

export type DirectHardEvidenceSnapshot = {
  address: string;
  labels: AddressLabel[];
  classification: ServiceClassification | null;
  usdtRestriction: StablecoinRestrictionProfile | null;
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
  snapshots: DirectHardEvidenceSnapshot[];
  missingChecks: string[];
};

type MutableDirectPrincipalCounterpartyGroup = {
  address: string;
  direction: CounterpartyRiskDirection;
  principalAmountRaw: bigint;
  transferTxHashes: string[];
  seenTxHashes: Set<string>;
};

function normalizedAddress(address: string): string {
  return address.trim();
}

function principalAmountRaw(amountRaw: string): bigint {
  return /^\d+$/.test(amountRaw) ? BigInt(amountRaw) : 0n;
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
    const edgeId = typeof edge.id === "string" && edge.id.trim().length > 0 ? edge.id : null;
    if (edgeId !== null) {
      if (seenEdgeIds.has(edgeId)) continue;
      seenEdgeIds.add(edgeId);
    }
    const address = (direction === "inbound" ? edge.fromAddress : edge.toAddress).trim();
    const key = `${direction}:${normalizedAddress(address)}`;
    const group = groups.get(key) ?? {
      address,
      direction,
      principalAmountRaw: 0n,
      transferTxHashes: [],
      seenTxHashes: new Set<string>()
    };
    group.principalAmountRaw += amountRaw;
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

export async function buildDirectHardEvidenceSnapshots(input: {
  addresses: string[];
  concurrency?: number;
  liveLimit?: number;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getUsdtRestrictionStatus?(address: string): Promise<StablecoinRestrictionProfile>;
}): Promise<DirectHardEvidenceResult> {
  const addresses = uniqueAddresses(input.addresses);
  const liveLimit = Math.max(0, Math.trunc(input.liveLimit ?? 250));
  const liveAddresses = input.getUsdtRestrictionStatus ? new Set(addresses.slice(0, liveLimit)) : new Set<string>();
  const missingChecks: string[] = [];

  const snapshots = await mapWithConcurrency(addresses, input.concurrency ?? 8, async (address) => {
    const [labels, classification] = await Promise.all([
      input.getLabelsForAddress(address),
      input.getClassificationForAddress(address)
    ]);
    let usdtRestriction: StablecoinRestrictionProfile | null = null;
    if (liveAddresses.has(address) && input.getUsdtRestrictionStatus) {
      try {
        usdtRestriction = await input.getUsdtRestrictionStatus(address);
      } catch (error) {
        missingChecks.push(`Direct hard evidence USDT blacklist lookup incomplete for ${address}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const reasons = [
      ...labels.map((label) => `label:${label.label}`),
      ...(classification?.isBoundary ? [`service:${classification.identity ?? classification.category}`] : []),
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

  return {
    status,
    checkedCount: snapshots.length,
    liveCheckedCount,
    liveFailedCount,
    serviceCount: snapshots.filter((snapshot) => snapshot.labels.length > 0 || snapshot.classification?.isBoundary).length,
    blacklistedCount: snapshots.filter((snapshot) => snapshot.usdtRestriction?.isBlacklisted).length,
    snapshots,
    missingChecks
  };
}
