export type TronscanRequestPriority =
  | "interactive_fast"
  | "deep_transfer"
  | "metadata"
  | "contract_profile";

export type TronscanScheduleInput = {
  requestName: string;
  path: string;
  priority?: TronscanRequestPriority;
  cacheKey?: string;
};

export type TronscanSchedulerDiagnostics = {
  apiKeyConfigured: boolean;
  queued: number;
  cooldownUntilMs: number;
};

export type TronscanScheduler = {
  schedule<T>(input: TronscanScheduleInput, work: () => Promise<T>): Promise<T>;
  diagnostics(): TronscanSchedulerDiagnostics;
};

export type TronscanSchedulerOptions = {
  requestMinIntervalMs: number;
  rateLimitCooldownMs: number;
  apiKeyConfigured?: boolean;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
};

type QueueItem<T> = {
  input: TronscanScheduleInput;
  work: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const priorityRank: Record<TronscanRequestPriority, number> = {
  interactive_fast: 0,
  metadata: 1,
  contract_profile: 2,
  deep_transfer: 3
};

function isRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429");
}

function queueRank(item: QueueItem<unknown>): number {
  return priorityRank[item.input.priority ?? "interactive_fast"];
}

function nextQueueItem(queue: Array<QueueItem<unknown>>): QueueItem<unknown> | undefined {
  if (queue.length === 0) return undefined;
  let bestIndex = 0;
  let bestRank = queueRank(queue[0]);
  for (let index = 1; index < queue.length; index += 1) {
    const rank = queueRank(queue[index]);
    if (rank < bestRank) {
      bestIndex = index;
      bestRank = rank;
    }
  }
  return queue.splice(bestIndex, 1)[0];
}

function honorsGlobalCooldown(item: QueueItem<unknown>): boolean {
  return item.input.priority !== "interactive_fast";
}

export function createTronscanScheduler(options: TronscanSchedulerOptions): TronscanScheduler {
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestMinIntervalMs = Math.max(0, options.requestMinIntervalMs);
  const rateLimitCooldownMs = Math.max(0, options.rateLimitCooldownMs);
  const inFlightByCacheKey = new Map<string, Promise<unknown>>();
  const queue: Array<QueueItem<unknown>> = [];
  let running = false;
  let nextRequestAtMs = 0;
  let cooldownUntilMs = 0;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const item = nextQueueItem(queue);
        if (!item) continue;
        const waitUntilMs = Math.max(nextRequestAtMs, honorsGlobalCooldown(item) ? cooldownUntilMs : 0);
        const waitMs = Math.max(0, waitUntilMs - now());
        if (waitMs > 0) {
          await delay(waitMs);
        }
        nextRequestAtMs = now() + requestMinIntervalMs;
        try {
          item.resolve(await item.work());
        } catch (error) {
          if (isRateLimitError(error) && rateLimitCooldownMs > 0) {
            cooldownUntilMs = Math.max(cooldownUntilMs, now() + rateLimitCooldownMs);
          }
          item.reject(error);
        }
      }
    } finally {
      running = false;
      if (queue.length > 0) void drain();
    }
  }

  function enqueue<T>(input: TronscanScheduleInput, work: () => Promise<T>): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      queue.push({
        input,
        work: work as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      void drain();
    });
    return promise;
  }

  return {
    schedule<T>(input: TronscanScheduleInput, work: () => Promise<T>): Promise<T> {
      if (!input.cacheKey) {
        return enqueue(input, work);
      }
      const existing = inFlightByCacheKey.get(input.cacheKey);
      if (existing) return existing as Promise<T>;
      const pending = enqueue(input, work).finally(() => {
        inFlightByCacheKey.delete(input.cacheKey as string);
      });
      inFlightByCacheKey.set(input.cacheKey, pending);
      return pending;
    },
    diagnostics(): TronscanSchedulerDiagnostics {
      return {
        apiKeyConfigured: options.apiKeyConfigured === true,
        queued: queue.length,
        cooldownUntilMs
      };
    }
  };
}
