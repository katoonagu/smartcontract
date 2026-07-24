export type UnifiedProviderPoolSnapshotV1 = {
  readonly version: "unified-provider-pool-snapshot-v1";
  readonly slots: number;
  readonly activeSlots: number;
  readonly stopped: boolean;
};

export function createUnifiedProviderPool(input: {
  slots: number;
  runCycle(slotId: number): Promise<{ claimed: boolean }>;
  onError(error: unknown, slotId: number): void;
  onInFlight?(current: number): void;
}) {
  if (!Number.isSafeInteger(input.slots) || input.slots < 1) {
    throw new TypeError("unified_provider_pool_slots_invalid");
  }
  let stopped = false;
  const active: Array<Promise<void> | null> =
    Array.from({ length: input.slots }, () => null);
  const pendingWake = Array.from({ length: input.slots }, () => false);
  const idleWaiters = new Set<() => void>();

  const activeCount = () => active.filter(Boolean).length;
  const notify = () => {
    input.onInFlight?.(activeCount());
    if (activeCount() === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };
  const drain = async (slotId: number) => {
    while (!stopped) {
      const result = await input.runCycle(slotId);
      if (!result.claimed) return;
    }
  };
  const start = (slotId: number) => {
    if (stopped || active[slotId] !== null) return;
    const running = drain(slotId)
      .catch((error) => input.onError(error, slotId))
      .finally(() => {
        if (active[slotId] === running) {
          active[slotId] = null;
          if (!stopped && pendingWake[slotId]) {
            pendingWake[slotId] = false;
            start(slotId);
            return;
          }
          pendingWake[slotId] = false;
          notify();
        }
      });
    active[slotId] = running;
    notify();
  };

  return {
    wake() {
      if (stopped) return;
      for (let slotId = 0; slotId < input.slots; slotId += 1) {
        if (active[slotId] === null) {
          start(slotId);
        } else {
          pendingWake[slotId] = true;
        }
      }
    },
    waitForIdle(): Promise<void> {
      if (activeCount() === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.add(resolve));
    },
    async stop(): Promise<void> {
      stopped = true;
      pendingWake.fill(false);
      await Promise.allSettled(active.filter(
        (value): value is Promise<void> => value !== null
      ));
    },
    snapshot(): UnifiedProviderPoolSnapshotV1 {
      return {
        version: "unified-provider-pool-snapshot-v1",
        slots: input.slots,
        activeSlots: activeCount(),
        stopped
      };
    }
  };
}
