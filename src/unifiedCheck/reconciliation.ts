export type UnifiedReconciliationResult = {
  readonly actionableWorkFound: boolean;
  readonly admitted: number;
  readonly wokenSlots: number;
};

export interface UnifiedReconciliation {
  wake(): void;
  tick(): Promise<UnifiedReconciliationResult>;
  start(): void;
  stop(): Promise<void>;
  waitForIdle(): Promise<void>;
}

const EMPTY_RECONCILIATION_RESULT: UnifiedReconciliationResult = {
  actionableWorkFound: false,
  admitted: 0,
  wokenSlots: 0
};

export function createUnifiedReconciliation(input: {
  readonly intervalMs: number;
  runCycle(): Promise<UnifiedReconciliationResult>;
  onResult?(result: UnifiedReconciliationResult): void;
  onError?(error: unknown): void;
}): UnifiedReconciliation {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1) {
    throw new TypeError("unified_reconciliation_interval_invalid");
  }
  let pending = false;
  let running: Promise<void> | null = null;
  let interval: NodeJS.Timeout | null = null;
  let stopped = false;
  let lastResult = EMPTY_RECONCILIATION_RESULT;
  const idleWaiters = new Set<() => void>();

  const notifyIdle = () => {
    if (running !== null || pending) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };
  const observe = (result: UnifiedReconciliationResult) => {
    try {
      input.onResult?.(result);
    } catch {
      // Observability is explicitly best-effort.
    }
  };
  const startPending = () => {
    if (stopped || running !== null || !pending) return;
    pending = false;
    running = (async () => {
      try {
        lastResult = await input.runCycle();
        observe(lastResult);
      } catch (error) {
        try {
          input.onError?.(error);
        } catch {
          // Observability is explicitly best-effort.
        }
      } finally {
        running = null;
        if (pending && !stopped) {
          startPending();
        } else {
          notifyIdle();
        }
      }
    })();
  };
  const wake = () => {
    if (stopped) return;
    pending = true;
    queueMicrotask(startPending);
  };
  const waitForIdle = (): Promise<void> => {
    if (running === null && !pending) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  };

  return {
    wake,
    async tick() {
      wake();
      await waitForIdle();
      return lastResult;
    },
    start() {
      if (interval !== null || stopped) return;
      interval = setInterval(wake, input.intervalMs);
      interval.unref?.();
    },
    async stop() {
      stopped = true;
      pending = false;
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      await waitForIdle();
    },
    waitForIdle
  };
}
