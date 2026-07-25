export type ProviderWorkLane = "interactive" | "repair" | "background";

export type AllocationReason =
  | "allocated"
  | "fairness_wait"
  | "no_ready_work"
  | "merge_buffer_full"
  | "provider_unavailable"
  | "resource_guard";

export interface ProviderRunDemand {
  runId: string;
  ownerId: string;
  lane: ProviderWorkLane;
  eligibleReadyWork: number;
  ownerLastServedAtMs: number;
  lastServedAtMs: number;
  mergeBufferFull: boolean;
  providerAvailable: boolean;
  resourceGuarded: boolean;
  canonicalHeadEligible: boolean;
}

export interface ProviderSlotAllocation {
  runId: string;
  ownerId: string;
  slots: number;
  canonicalHeadPreferred: boolean;
  reason: AllocationReason;
}

export interface RepairCapacityPolicy {
  repairShare: number;
  repairMaxSlots: number;
  repairMaxWaitChunks: number;
  chunksSinceLastRepair: number;
}

type AllocationState = {
  run: ProviderRunDemand;
  remaining: number;
  slots: number;
};

function initialReason(run: ProviderRunDemand): AllocationReason | null {
  if (run.eligibleReadyWork <= 0) return "no_ready_work";
  if (run.mergeBufferFull && !run.canonicalHeadEligible) return "merge_buffer_full";
  if (!run.providerAvailable) return "provider_unavailable";
  if (run.resourceGuarded) return "resource_guard";
  return null;
}

function allocateLane(states: AllocationState[], budget: number): number {
  const byOwner = new Map<string, {
    ownerId: string;
    ownerLastServedAtMs: number;
    runs: AllocationState[];
    cursor: number;
  }>();
  for (const state of states) {
    const owner = byOwner.get(state.run.ownerId) ?? {
      ownerId: state.run.ownerId,
      ownerLastServedAtMs: state.run.ownerLastServedAtMs,
      runs: [],
      cursor: 0
    };
    owner.runs.push(state);
    byOwner.set(state.run.ownerId, owner);
  }
  for (const owner of byOwner.values()) {
    owner.runs.sort((left, right) =>
      left.run.lastServedAtMs - right.run.lastServedAtMs ||
      left.run.runId.localeCompare(right.run.runId));
  }
  let allocated = 0;

  while (allocated < budget) {
    const activeOwners = [...byOwner.values()]
      .filter((owner) => owner.runs.some((state) => state.remaining > 0))
      .sort((left, right) =>
        left.ownerLastServedAtMs - right.ownerLastServedAtMs ||
        left.ownerId.localeCompare(right.ownerId));
    if (activeOwners.length === 0) break;

    let roundAllocated = 0;
    for (const owner of activeOwners) {
      if (allocated >= budget) break;
      let selected: AllocationState | undefined;
      for (let offset = 0; offset < owner.runs.length; offset += 1) {
        const index = (owner.cursor + offset) % owner.runs.length;
        if (owner.runs[index]!.remaining <= 0) continue;
        selected = owner.runs[index]!;
        owner.cursor = (index + 1) % owner.runs.length;
        break;
      }
      if (!selected) continue;
      selected.remaining -= 1;
      selected.slots += 1;
      allocated += 1;
      roundAllocated += 1;
    }
    if (roundAllocated === 0) break;
  }

  return allocated;
}

export function calculateRepairMinimum(input: {
  effectiveCapacity: number;
  readyRepairWork: number;
  repairShare: number;
  repairMaxSlots: number;
}): number {
  if (input.readyRepairWork <= 0 || input.effectiveCapacity <= 0) return 0;
  return Math.min(
    input.readyRepairWork,
    input.repairMaxSlots,
    Math.max(1, Math.ceil(input.effectiveCapacity * input.repairShare))
  );
}

export function allocateProviderSlots(input: {
  capacity: number;
  runs: readonly ProviderRunDemand[];
  repair: RepairCapacityPolicy;
}): ProviderSlotAllocation[] {
  const capacity = Math.max(0, Math.floor(input.capacity));
  const blockedReasons = new Map<string, AllocationReason>();
  const states = input.runs.map((run): AllocationState => {
    const reason = initialReason(run);
    if (reason) blockedReasons.set(run.runId, reason);
    const readyWork = reason
      ? 0
      : run.mergeBufferFull
        ? Math.min(1, run.eligibleReadyWork)
        : run.eligibleReadyWork;
    return {
      run,
      remaining: Math.max(0, Math.floor(readyWork)),
      slots: 0
    };
  });
  const laneStates = (lane: ProviderWorkLane) =>
    states.filter((state) => state.run.lane === lane && state.remaining > 0);
  const interactive = laneStates("interactive");
  const repair = laneStates("repair");
  const background = laneStates("background");
  const repairReadyWork = repair.reduce((sum, state) => sum + state.remaining, 0);
  const interactiveReadyWork = interactive.reduce((sum, state) => sum + state.remaining, 0);

  let used = 0;
  if (capacity === 1 && repairReadyWork > 0 && interactiveReadyWork > 0) {
    const repairDue = input.repair.chunksSinceLastRepair >= input.repair.repairMaxWaitChunks;
    used += allocateLane(repairDue ? repair : interactive, 1);
  } else {
    const repairMinimum = calculateRepairMinimum({
      effectiveCapacity: capacity,
      readyRepairWork: repairReadyWork,
      repairShare: input.repair.repairShare,
      repairMaxSlots: input.repair.repairMaxSlots
    });
    used += allocateLane(repair, repairMinimum);
    used += allocateLane(interactive, capacity - used);
    used += allocateLane(repair, capacity - used);
  }
  used += allocateLane(background, capacity - used);

  return states.map((state): ProviderSlotAllocation => ({
    runId: state.run.runId,
    ownerId: state.run.ownerId,
    slots: state.slots,
    canonicalHeadPreferred: state.slots > 0 && state.run.canonicalHeadEligible,
    reason: state.slots > 0
      ? "allocated"
      : blockedReasons.get(state.run.runId) ?? "fairness_wait"
  }));
}
