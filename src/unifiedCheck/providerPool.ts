export type UnifiedProviderPoolSnapshot = {
  readonly configuredLimit: number;
  readonly targetSlots: number;
  readonly activeSlots: number;
  readonly idleSlots: number;
};

export interface UnifiedProviderPool {
  setTargetSlots(target: number): void;
  wake(): void;
  drain(): Promise<void>;
  snapshot(): UnifiedProviderPoolSnapshot;
  waitForIdle(): Promise<void>;
  stop(): Promise<void>;
}

export function createUnifiedProviderPool(input: {
  configuredLimit: number;
  runCycle(slotId: number): Promise<{ claimed: boolean }>;
  onError(error: unknown, slotId: number): void;
  onInFlight?(current: number): void;
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
  const idleWaiters = new Set<() => void>();

  const activeCount = () => active.filter(Boolean).length;
  const notify = () => {
    const count = activeCount();
    input.onInFlight?.(count);
    if (count === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };
  const run = async (
    slotId: number
  ): Promise<"idle" | "retired" | "drained"> => {
    while (!draining) {
      const result = await input.runCycle(slotId);
      if (!result.claimed) return "idle";
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
      activeCount() >= targetSlots
    ) {
      return;
    }
    let running!: Promise<void>;
    running = (async () => {
      let exit: "idle" | "retired" | "drained" = "idle";
      try {
        exit = await run(slotId);
      } catch (error) {
        input.onError(error, slotId);
      } finally {
        if (active[slotId] !== running) return;
        active[slotId] = null;
        const restart = !draining &&
          slotId < targetSlots &&
          pendingWake[slotId];
        pendingWake[slotId] = false;
        if (restart) {
          start(slotId);
        } else if (exit === "retired") {
          fill();
        }
        notify();
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
      }
      fill();
    },
    wake() {
      if (draining) return;
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
    // ponytail: retained until the Plan 2 runtime wiring switches its shutdown
    // call to drain(); both names have the same terminal semantics.
    stop: drain,
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
