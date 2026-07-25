import type {
  UnifiedReasonCode
} from "./adaptiveObservability";

export type ProviderWorkLane = "interactive" | "repair" | "background";

export type AllocationReason =
  | "allocated"
  | UnifiedReasonCode;

export interface ProviderRunDemand {
  runId: string;
  ownerId: string;
  lane: ProviderWorkLane;
  eligibleReadyWork: number;
  ownerLastServedAtMs: number;
  lastServedAtMs: number;
  mergeBufferFull: boolean;
  providerAvailable: boolean;
  providerPaced?: boolean;
  resourceGuarded: boolean;
  providerBlocker?: Extract<
    UnifiedReasonCode,
    "provider_rate_paced" | "provider_cooldown" | "provider_circuit_open"
  >;
  resourceGuardReason?: Extract<
    UnifiedReasonCode,
    "db_pressure" | "memory_pressure" | "class_capacity_limit"
  >;
  canonicalHeadEligible: boolean;
}

export interface ProviderSlotAllocation {
  runId: string;
  ownerId: string;
  lane: ProviderWorkLane;
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

export type ProviderOccupiedSlot = {
  readonly runId: string;
  readonly ownerId: string;
  readonly lane: ProviderWorkLane;
};

function allocationIdentity(input: {
  readonly runId: string;
  readonly ownerId: string;
  readonly lane: ProviderWorkLane;
}): string {
  return JSON.stringify([input.runId, input.ownerId, input.lane]);
}

type AllocationState = {
  run: ProviderRunDemand;
  remaining: number;
  occupied: number;
  slots: number;
};

function initialReason(run: ProviderRunDemand): AllocationReason | null {
  if (run.eligibleReadyWork <= 0) return "no_eligible_work";
  if (run.mergeBufferFull && !run.canonicalHeadEligible) return "merge_buffer_full";
  if (!run.providerAvailable) return run.providerBlocker ?? "provider_cooldown";
  if (run.resourceGuarded) {
    return run.resourceGuardReason ?? "class_capacity_limit";
  }
  return null;
}

function allocateLane(states: AllocationState[], budget: number): number {
  let allocated = 0;
  while (allocated < budget) {
    const byOwner = new Map<string, AllocationState[]>();
    for (const state of states) {
      const ownerRuns = byOwner.get(state.run.ownerId) ?? [];
      ownerRuns.push(state);
      byOwner.set(state.run.ownerId, ownerRuns);
    }
    const owner = [...byOwner.entries()]
      .filter(([_ownerId, ownerRuns]) =>
        ownerRuns.some((state) => state.remaining > 0)
      )
      .sort(([leftOwner, leftRuns], [rightOwner, rightRuns]) =>
        leftRuns.reduce(
          (sum, state) => sum + state.occupied + state.slots,
          0
        ) -
          rightRuns.reduce(
            (sum, state) => sum + state.occupied + state.slots,
            0
          ) ||
        Math.min(...leftRuns.map((state) =>
          state.run.ownerLastServedAtMs
        )) -
          Math.min(...rightRuns.map((state) =>
            state.run.ownerLastServedAtMs
          )) ||
        leftOwner.localeCompare(rightOwner)
      )[0];
    if (!owner) break;
    const selected = owner[1]
      .filter((state) => state.remaining > 0)
      .sort((left, right) =>
      left.occupied + left.slots - (right.occupied + right.slots) ||
      left.run.lastServedAtMs - right.run.lastServedAtMs ||
      left.run.runId.localeCompare(right.run.runId)
    )[0]!;
    selected.remaining -= 1;
    selected.slots += 1;
    allocated += 1;
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
  occupied?: readonly ProviderOccupiedSlot[];
}): ProviderSlotAllocation[] {
  const capacity = Math.max(0, Math.floor(input.capacity));
  const occupied = input.occupied ?? [];
  const occupiedByIdentity = new Map<string, number>();
  for (const slot of occupied) {
    const key = allocationIdentity(slot);
    occupiedByIdentity.set(key, (occupiedByIdentity.get(key) ?? 0) + 1);
  }
  const blockedReasons = new Map<string, AllocationReason>();
  const states = input.runs.map((run): AllocationState => {
    const reason = initialReason(run);
    if (reason) blockedReasons.set(allocationIdentity(run), reason);
    const readyWork = reason
      ? 0
      : run.mergeBufferFull
        ? Math.min(1, run.eligibleReadyWork)
        : run.eligibleReadyWork;
    return {
      run,
      remaining: Math.max(0, Math.floor(readyWork)),
      occupied: occupiedByIdentity.get(allocationIdentity(run)) ?? 0,
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
  const occupiedRepair = occupied.filter((slot) =>
    slot.lane === "repair"
  ).length;

  let used = 0;
  const available = Math.max(0, capacity - occupied.length);
  if (
    capacity === 1 &&
    occupied.length === 0 &&
    repairReadyWork > 0 &&
    interactiveReadyWork > 0
  ) {
    const repairDue = input.repair.chunksSinceLastRepair >= input.repair.repairMaxWaitChunks;
    used += allocateLane(repairDue ? repair : interactive, 1);
  } else {
    const repairMinimum = Math.max(0, calculateRepairMinimum({
      effectiveCapacity: capacity,
      readyRepairWork: repairReadyWork + occupiedRepair,
      repairShare: input.repair.repairShare,
      repairMaxSlots: input.repair.repairMaxSlots
    }) - occupiedRepair);
    used += allocateLane(repair, repairMinimum);
    used += allocateLane(interactive, available - used);
    used += allocateLane(repair, available - used);
  }
  used += allocateLane(background, available - used);

  return states.map((state): ProviderSlotAllocation => ({
    runId: state.run.runId,
    ownerId: state.run.ownerId,
    lane: state.run.lane,
    slots: state.slots,
    canonicalHeadPreferred: state.slots > 0 && state.run.canonicalHeadEligible,
    reason: state.slots > 0
      ? "allocated"
      : blockedReasons.get(allocationIdentity(state.run)) ??
        (state.run.lane === "background"
          ? "background_preempted"
          : "fairness_wait")
  }));
}
