import type {
  UnifiedProviderClaimPermit
} from "./worker";

export type UnifiedProviderPoolSnapshot = {
  readonly configuredLimit: number;
  readonly targetSlots: number;
  readonly activeSlots: number;
  readonly idleSlots: number;
};

export type UnifiedProviderSlotSnapshot = {
  readonly slotId: number;
  readonly epoch: number;
  readonly active: boolean;
  readonly activePermit: UnifiedProviderClaimPermit | null;
};

export type UnifiedProviderSlotIdentity = {
  readonly slotId: number;
  readonly epoch: number;
};

export type UnifiedProviderSlotAssignment = {
  readonly slotId: number;
  readonly expectedEpoch: number;
  readonly permit: UnifiedProviderClaimPermit;
};

export type UnifiedProviderAssignmentRejectionReason =
  | "draining"
  | "slot_active"
  | "pending_assignment"
  | "stale_epoch";

export type UnifiedProviderAssignmentResult = {
  readonly accepted: readonly UnifiedProviderSlotAssignment[];
  readonly rejected: readonly {
    readonly assignment: UnifiedProviderSlotAssignment;
    readonly reason: UnifiedProviderAssignmentRejectionReason;
  }[];
};

export interface UnifiedProviderPool {
  setTargetSlots(target: number): void;
  assignPermits(
    assignments: readonly UnifiedProviderSlotAssignment[]
  ): UnifiedProviderAssignmentResult;
  wake(): void;
  drain(): Promise<void>;
  snapshot(): UnifiedProviderPoolSnapshot;
  slotSnapshots(): UnifiedProviderSlotSnapshot[];
  waitForIdle(): Promise<void>;
}

export function createUnifiedProviderPool(input: {
  configuredLimit: number;
  runCycle(
    slotId: number,
    assignment: UnifiedProviderSlotAssignment | undefined,
    slotIdentity: UnifiedProviderSlotIdentity
  ): Promise<{ claimed: boolean }>;
  requiresPermit?: boolean;
  yieldAfterClaim?: boolean;
  onError(error: unknown, slotId: number): void;
  onInFlight?(current: number): void;
  onSlotBoundary?(snapshot: UnifiedProviderSlotSnapshot): void;
}): UnifiedProviderPool {
  if (
    !Number.isSafeInteger(input.configuredLimit) ||
    input.configuredLimit < 1
  ) {
    throw new TypeError("unified_provider_pool_limit_invalid");
  }
  let targetSlots = 0;
  let draining = false;
  const active: Array<Promise<void> | null> =
    Array.from({ length: input.configuredLimit }, () => null);
  const pendingWake =
    Array.from({ length: input.configuredLimit }, () => false);
  const epochs =
    Array.from({ length: input.configuredLimit }, () => 0);
  const activePermits: Array<UnifiedProviderClaimPermit | null> =
    Array.from({ length: input.configuredLimit }, () => null);
  const pendingAssignments: Array<UnifiedProviderSlotAssignment | null> =
    Array.from({ length: input.configuredLimit }, () => null);
  const idleWaiters = new Set<() => void>();

  const activeCount = () => active.filter(Boolean).length;
  const slotSnapshot = (slotId: number): UnifiedProviderSlotSnapshot => ({
    slotId,
    epoch: epochs[slotId]!,
    active: active[slotId] !== null,
    activePermit: activePermits[slotId]
  });
  const notify = () => {
    const count = activeCount();
    input.onInFlight?.(count);
    if (count === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };
  const run = async (
    slotId: number,
    assignment: UnifiedProviderSlotAssignment | undefined
  ): Promise<"idle" | "retired" | "drained"> => {
    while (!draining) {
      const result = await input.runCycle(slotId, assignment, {
        slotId,
        epoch: epochs[slotId]!
      });
      if (!result.claimed) return "idle";
      if (input.yieldAfterClaim === true) return "idle";
      if (slotId >= targetSlots || activeCount() > targetSlots) {
        return "retired";
      }
    }
    return "drained";
  };
  const start = (slotId: number) => {
    if (
      draining ||
      slotId >= targetSlots ||
      active[slotId] !== null ||
      activeCount() >= targetSlots ||
      (
        input.requiresPermit === true &&
        pendingAssignments[slotId] === null
      )
    ) {
      return;
    }
    const assignment = pendingAssignments[slotId] ?? undefined;
    pendingAssignments[slotId] = null;
    activePermits[slotId] = assignment?.permit ?? null;
    epochs[slotId] = epochs[slotId]! + 1;
    let running!: Promise<void>;
    running = (async () => {
      let exit: "idle" | "retired" | "drained" = "idle";
      try {
        exit = await run(slotId, assignment);
      } catch (error) {
        input.onError(error, slotId);
      } finally {
        if (active[slotId] !== running) return;
        active[slotId] = null;
        activePermits[slotId] = null;
        epochs[slotId] = epochs[slotId]! + 1;
        const restart = input.requiresPermit !== true &&
          !draining &&
          slotId < targetSlots &&
          pendingWake[slotId];
        pendingWake[slotId] = false;
        if (restart) {
          start(slotId);
        } else if (exit === "retired") {
          fill();
        }
        notify();
        try {
          input.onSlotBoundary?.(slotSnapshot(slotId));
        } catch {
          // Boundary notification is a best-effort wake signal.
        }
      }
    })();
    active[slotId] = running;
    notify();
  };
  const fill = () => {
    if (draining) return;
    for (
      let slotId = 0;
      slotId < targetSlots && activeCount() < targetSlots;
      slotId += 1
    ) {
      if (active[slotId] === null) start(slotId);
    }
  };
  const drain = async (): Promise<void> => {
    if (draining) {
      await Promise.allSettled(active.filter(
        (value): value is Promise<void> => value !== null
      ));
      return;
    }
    draining = true;
    targetSlots = 0;
    pendingWake.fill(false);
    await Promise.allSettled(active.filter(
      (value): value is Promise<void> => value !== null
    ));
  };

  return {
    setTargetSlots(target) {
      if (
        !Number.isSafeInteger(target) ||
        target < 0 ||
        target > input.configuredLimit
      ) {
        throw new TypeError("unified_provider_pool_target_invalid");
      }
      if (draining) return;
      targetSlots = target;
      for (let slotId = target; slotId < pendingWake.length; slotId += 1) {
        pendingWake[slotId] = false;
        if (pendingAssignments[slotId] !== null) {
          pendingAssignments[slotId] = null;
          epochs[slotId] = epochs[slotId]! + 1;
        }
      }
      fill();
    },
    assignPermits(assignments) {
      const accepted: UnifiedProviderSlotAssignment[] = [];
      const rejected: Array<UnifiedProviderAssignmentResult["rejected"][number]> = [];
      for (const assignment of assignments) {
        if (
          !Number.isSafeInteger(assignment.slotId) ||
          assignment.slotId < 0 ||
          assignment.slotId >= input.configuredLimit ||
          !Number.isSafeInteger(assignment.expectedEpoch) ||
          assignment.expectedEpoch < 0
        ) {
          throw new TypeError("unified_provider_slot_assignment_invalid");
        }
        const slotId = assignment.slotId;
        const reason: UnifiedProviderAssignmentRejectionReason | null =
          draining
            ? "draining"
            : active[slotId] !== null
              ? "slot_active"
              : pendingAssignments[slotId] !== null
                ? "pending_assignment"
                : epochs[slotId] !== assignment.expectedEpoch
                  ? "stale_epoch"
                  : null;
        if (reason !== null) {
          rejected.push({ assignment, reason });
          continue;
        }
        pendingAssignments[slotId] = assignment;
        accepted.push(assignment);
      }
      return { accepted, rejected };
    },
    wake() {
      if (draining) return;
      if (input.requiresPermit === true) {
        fill();
        return;
      }
      for (let slotId = 0; slotId < targetSlots; slotId += 1) {
        if (active[slotId] === null) {
          start(slotId);
        } else {
          pendingWake[slotId] = true;
        }
      }
    },
    drain,
    waitForIdle(): Promise<void> {
      if (activeCount() === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.add(resolve));
    },
    slotSnapshots: () => Array.from(
      { length: input.configuredLimit },
      (_unused, slotId) => slotSnapshot(slotId)
    ),
    snapshot(): UnifiedProviderPoolSnapshot {
      const activeSlots = activeCount();
      return {
        configuredLimit: input.configuredLimit,
        targetSlots,
        activeSlots,
        idleSlots: Math.max(0, targetSlots - activeSlots)
      };
    }
  };
}
