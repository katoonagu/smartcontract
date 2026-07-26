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
  onAdaptiveEvent?(event: UnifiedAdaptiveEvent): void;
  onWait?(reason: UnifiedDecisionReason): void;
  now?(): Date;
}): UnifiedReconciliation {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1) {
    throw new TypeError("unified_reconciliation_interval_invalid");
  }
  let pending = false;
  let pendingTimerTick = false;
  let running: Promise<void> | null = null;
  let interval: NodeJS.Timeout | null = null;
  let stopped = false;
  let lastResult = EMPTY_RECONCILIATION_RESULT;
  const now = input.now ?? (() => new Date());
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
    const timerTick = pendingTimerTick;
    pendingTimerTick = false;
    running = (async () => {
      try {
        lastResult = await input.runCycle();
        if (timerTick) observe(lastResult);
        if (timerTick && lastResult.actionableWorkFound) {
          emitBestEffort(
            input.onAdaptiveEvent,
            createUnifiedAdaptiveEvent({
              type: "reconciliation_recovered_work",
              occurredAt: now().toISOString()
            })
          );
        }
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
  const wake = (cause: "event" | "timer" = "event") => {
    if (stopped) return;
    if (running !== null || pending) {
      try {
        input.onWait?.(
          createUnifiedDecisionReason("pool", "reconciliation_wait")
        );
      } catch {
        // ponytail: a wait observer cannot affect the coalesced durable retry.
      }
    }
    pending = true;
    if (cause === "timer") pendingTimerTick = true;
    queueMicrotask(startPending);
  };
  const waitForIdle = (): Promise<void> => {
    if (running === null && !pending) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  };

  return {
    wake,
    async tick() {
      wake("timer");
      await waitForIdle();
      return lastResult;
    },
    start() {
      if (interval !== null || stopped) return;
      interval = setInterval(() => wake("timer"), input.intervalMs);
      interval.unref?.();
    },
    async stop() {
      stopped = true;
      pending = false;
      pendingTimerTick = false;
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      await waitForIdle();
    },
    waitForIdle
  };
}
import {
  createUnifiedAdaptiveEvent,
  createUnifiedDecisionReason,
  emitBestEffort,
  type UnifiedAdaptiveEvent,
  type UnifiedDecisionReason
} from "./adaptiveObservability";
