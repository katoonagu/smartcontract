import type {
  AddressLabel,
  ServiceClassification,
  StablecoinRestrictionProfile
} from "../types";

export const DIRECT_BOUNDARY_MAX_MATERIALIZED_TRANSFERS = 50_000;
export const DEFAULT_DIRECT_BOUNDARY_PAGE_SIZE = 1_000;

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
