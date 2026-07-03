import { buildSecondLayerRelationshipProfiles } from "./deepSecondLayerRelationship";
import type { ForensicCheckJob } from "../storage/repositories";
import type {
  DeepSecondLayerDirectWalletStatusRecord,
  DeepSecondLayerRelationshipCounters,
  DeepSecondLayerRelationshipGroup,
  DeepSecondLayerRelationshipLimits,
  DeepSecondLayerRelationshipPath,
  DeepSecondLayerRelationshipProfile,
  DirectCounterpartyInteractionProfile,
  ForensicRouteEdge,
  ServiceClassification,
  TronAddressUsdtIndexState
} from "../types";

export type RefreshDeepCheckSecondLayerDeps = {
  jobId: string;
  getJob(id: string): Promise<ForensicCheckJob | null>;
  patchCompletedJob(input: { id: string; resultJson: Record<string, unknown>; progressJson: Record<string, unknown> }): Promise<boolean>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getIndexState(address: string): Promise<TronAddressUsdtIndexState | null>;
  listIndexedEdges(address: string): Promise<ForensicRouteEdge[]>;
};

export type RefreshDeepCheckSecondLayerResult =
  | { status: "refreshed"; expanded: number; queued: number; notIndexed: number }
  | { status: "skipped"; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function directCounterpartyProfiles(value: unknown): DirectCounterpartyInteractionProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isObject(item) && typeof item.counterpartyAddress === "string") as DirectCounterpartyInteractionProfile[];
}

function limits(value: unknown): Partial<DeepSecondLayerRelationshipLimits> | undefined {
  return isObject(value) ? value : undefined;
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function directWalletStatusRecords(value: unknown): DeepSecondLayerDirectWalletStatusRecord[] {
  return arrayOrEmpty(value as DeepSecondLayerDirectWalletStatusRecord[]).filter((status) => {
    return isObject(status) && typeof status.address === "string";
  });
}

function pathRecords(value: unknown): DeepSecondLayerRelationshipPath[] {
  return arrayOrEmpty(value as DeepSecondLayerRelationshipPath[]).filter((path) => {
    return isObject(path) && typeof path.directWalletAddress === "string";
  });
}

function groupRecords(value: unknown): DeepSecondLayerRelationshipGroup[] {
  return arrayOrEmpty(value as DeepSecondLayerRelationshipGroup[]).filter((group) => {
    return isObject(group) && typeof group.directWalletAddress === "string";
  });
}

function pendingStatuses(profile: DeepSecondLayerRelationshipProfile): DeepSecondLayerDirectWalletStatusRecord[] {
  return directWalletStatusRecords(profile.directWalletStatuses).filter((status) => {
    return status.status === "queued" || status.status === "not_indexed";
  });
}

function recomputeCounters(input: {
  statuses: readonly DeepSecondLayerDirectWalletStatusRecord[];
  paths: readonly DeepSecondLayerRelationshipPath[];
  groups: readonly DeepSecondLayerRelationshipGroup[];
}): DeepSecondLayerRelationshipCounters {
  let expanded = 0;
  let grouped = 0;
  let stopped = 0;
  let notIndexed = 0;
  let queued = 0;
  let complete = 0;

  for (const status of input.statuses) {
    if (status.status === "expanded") expanded += 1;
    if (status.status === "grouped") grouped += 1;
    if (status.status === "stopped_service_boundary" || status.status === "stopped_high_degree") stopped += 1;
    if (status.status === "not_indexed") notIndexed += 1;
    if (status.status === "queued") queued += 1;
    if (status.status === "expanded" || status.status === "grouped" || status.status === "no_meaningful_second_hop") complete += 1;
  }

  return {
    directWalletsConsidered: input.statuses.length,
    expanded,
    grouped,
    stopped,
    notIndexed,
    queued,
    complete,
    paths: input.paths.length,
    groups: input.groups.length,
    maxSavedDepth: input.paths.length > 0 ? 2 : 0
  };
}

function mergeProfile(input: {
  current: DeepSecondLayerRelationshipProfile;
  rebuilt: DeepSecondLayerRelationshipProfile;
  pendingAddresses: readonly string[];
}): DeepSecondLayerRelationshipProfile {
  const pending = new Set(input.pendingAddresses.map(normalizeAddress));
  const directWalletStatuses = [
    ...directWalletStatusRecords(input.current.directWalletStatuses).filter((status) => !pending.has(normalizeAddress(status.address))),
    ...input.rebuilt.directWalletStatuses
  ];
  const paths = [
    ...pathRecords(input.current.paths).filter((path) => !pending.has(normalizeAddress(path.directWalletAddress))),
    ...input.rebuilt.paths
  ];
  const groups = [
    ...groupRecords(input.current.groups).filter((group) => !pending.has(normalizeAddress(group.directWalletAddress))),
    ...input.rebuilt.groups
  ];

  return {
    subjectAddress: input.current.subjectAddress,
    generatedAt: input.rebuilt.generatedAt,
    limits: input.rebuilt.limits,
    directWalletStatuses,
    paths,
    groups,
    queueRequests: input.rebuilt.queueRequests,
    counters: recomputeCounters({ statuses: directWalletStatuses, paths, groups })
  };
}

export async function refreshDeepCheckSecondLayerFromIndex(
  deps: RefreshDeepCheckSecondLayerDeps
): Promise<RefreshDeepCheckSecondLayerResult> {
  const job = await deps.getJob(deps.jobId);
  if (!job || job.kind !== "address_deep_check" || job.status !== "completed") {
    return { status: "skipped", reason: "job_not_completed_deepcheck" };
  }
  if (!isObject(job.resultJson)) return { status: "skipped", reason: "missing_result_json" };

  const current = job.resultJson.secondLayerRelationshipProfiles;
  if (!isObject(current)) return { status: "skipped", reason: "missing_second_layer_profile" };

  const profile = current as DeepSecondLayerRelationshipProfile;
  const pending = pendingStatuses(profile);
  if (pending.length === 0) return { status: "skipped", reason: "no_pending_second_layer_wallets" };

  const pendingAddresses = pending.map((status) => status.address);
  const classifications = new Map<string, ServiceClassification | null>();
  for (const address of pendingAddresses) {
    classifications.set(address, await deps.getClassificationForAddress(address));
  }

  const rebuilt = await buildSecondLayerRelationshipProfiles({
    subjectAddress: job.subjectAddress,
    directBoundaryAddresses: pendingAddresses,
    directCounterpartyProfiles: directCounterpartyProfiles(job.resultJson.directCounterpartyInteractionProfiles),
    classifications,
    limits: limits(profile.limits),
    getIndexState: (address) => deps.getIndexState(address),
    listIndexedEdges: (address) => deps.listIndexedEdges(address)
  });
  const merged = mergeProfile({ current: profile, rebuilt, pendingAddresses });

  const patched = await deps.patchCompletedJob({
    id: job.id,
    resultJson: {
      ...job.resultJson,
      secondLayerRelationshipProfiles: merged
    },
    progressJson: {
      secondLayerQueued: merged.counters.queued + merged.counters.notIndexed,
      secondLayerComplete: merged.counters.complete,
      secondLayerRefreshedAt: new Date().toISOString()
    }
  });
  if (!patched) return { status: "skipped", reason: "patch_not_applied" };

  return {
    status: "refreshed",
    expanded: merged.counters.expanded,
    queued: merged.counters.queued,
    notIndexed: merged.counters.notIndexed
  };
}
