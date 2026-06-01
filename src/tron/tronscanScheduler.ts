export type TronscanRequestPriority =
  | "interactive_fast"
  | "deep_transfer"
  | "metadata"
  | "contract_profile";

export type TronscanEndpointBucket = "transfer" | "approval" | "contract" | "fullnode" | "trongrid" | "default";

export type TronscanScheduleInput = {
  requestName: string;
  path: string;
  priority?: TronscanRequestPriority;
  cacheKey?: string;
  slotScope?: "pool" | "single";
  endpointBucket?: TronscanEndpointBucket;
};

export type TronscanScheduleContext = {
  apiKey: string | null;
  apiKeyIndex: number | null;
};

export type TronscanSchedulerDiagnostics = {
  apiKeyConfigured: boolean;
  apiKeyCount: number;
  queued: number;
  cooldownUntilMs: number;
  globalCooldownUntilMs: number;
  endpointCooldownUntilMs: Partial<Record<TronscanEndpointBucket, number>>;
};

export type TronscanScheduler = {
  schedule<T>(input: TronscanScheduleInput, work: (context: TronscanScheduleContext) => Promise<T>): Promise<T>;
  diagnostics(): TronscanSchedulerDiagnostics;
};

export type TronscanSchedulerOptions = {
  requestMinIntervalMs: number;
  rateLimitCooldownMs: number;
  globalRequestMinIntervalMs?: number;
  endpointMinIntervalMs?: Partial<Record<TronscanEndpointBucket, number>>;
  apiKeyConfigured?: boolean;
  apiKeys?: readonly string[];
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
};

type QueueItem<T> = {
  input: TronscanScheduleInput;
  work: (context: TronscanScheduleContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type ApiKeySlot = {
  apiKey: string | null;
  apiKeyIndex: number | null;
  nextRequestAtMs: number;
  cooldownUntilMs: number;
  last429AtMs: number | null;
  consecutive429Count: number;
};

type EndpointState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
};

const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;
const endpointBuckets: TronscanEndpointBucket[] = ["transfer", "approval", "contract", "fullnode", "trongrid", "default"];

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

function endpointBucket(item: QueueItem<unknown>): TronscanEndpointBucket {
  return item.input.endpointBucket ?? "default";
}

function normalizeApiKeys(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];
}

export function createTronscanScheduler(options: TronscanSchedulerOptions): TronscanScheduler {
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestMinIntervalMs = Math.max(0, options.requestMinIntervalMs);
  const rateLimitCooldownMs = Math.max(0, options.rateLimitCooldownMs);
  const globalRequestMinIntervalMs = Math.max(0, options.globalRequestMinIntervalMs ?? 0);
  const endpointMinIntervalMs = options.endpointMinIntervalMs ?? {};
  const apiKeys = normalizeApiKeys(options.apiKeys);
  const slots: ApiKeySlot[] = apiKeys.length > 0
    ? apiKeys.map((apiKey, index) => ({
        apiKey,
        apiKeyIndex: index,
        nextRequestAtMs: 0,
        cooldownUntilMs: 0,
        last429AtMs: null,
        consecutive429Count: 0
      }))
    : [{
        apiKey: null,
        apiKeyIndex: null,
        nextRequestAtMs: 0,
        cooldownUntilMs: 0,
        last429AtMs: null,
        consecutive429Count: 0
      }];
  const endpointState: Record<TronscanEndpointBucket, EndpointState> = Object.fromEntries(
    endpointBuckets.map((bucket) => [bucket, { nextRequestAtMs: 0, cooldownUntilMs: 0 }])
  ) as Record<TronscanEndpointBucket, EndpointState>;
  const inFlightByCacheKey = new Map<string, Promise<unknown>>();
  const queue: Array<QueueItem<unknown>> = [];
  let globalNextRequestAtMs = 0;
  let globalCooldownUntilMs = 0;
  let running = false;
  let drainScheduled = false;

  function scheduleDrain(): void {
    if (drainScheduled) return;
    drainScheduled = true;
    void Promise.resolve().then(() => {
      drainScheduled = false;
      void drain();
    });
  }

  function slotReadyAtMs(slot: ApiKeySlot, item: QueueItem<unknown>): number {
    const bucketState = endpointState[endpointBucket(item)];
    return Math.max(
      slot.nextRequestAtMs,
      honorsGlobalCooldown(item) ? slot.cooldownUntilMs : 0,
      globalNextRequestAtMs,
      honorsGlobalCooldown(item) ? globalCooldownUntilMs : 0,
      bucketState.nextRequestAtMs,
      bucketState.cooldownUntilMs
    );
  }

  function earliestSlot(item: QueueItem<unknown>): ApiKeySlot {
    if (item.input.slotScope === "single") return slots[0];
    let best = slots[0];
    let bestReadyAt = slotReadyAtMs(best, item);
    for (const slot of slots.slice(1)) {
      const readyAt = slotReadyAtMs(slot, item);
      if (readyAt < bestReadyAt || (readyAt === bestReadyAt && slot.nextRequestAtMs < best.nextRequestAtMs)) {
        best = slot;
        bestReadyAt = readyAt;
      }
    }
    return best;
  }

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const item = nextQueueItem(queue);
        if (!item) continue;
        const slot = earliestSlot(item);
        const waitUntilMs = slotReadyAtMs(slot, item);
        const waitMs = Math.max(0, waitUntilMs - now());
        if (waitMs > 0) {
          await delay(waitMs);
        }
        const dispatchNow = now();
        const bucket = endpointBucket(item);
        const bucketState = endpointState[bucket];
        const endpointIntervalMs = Math.max(0, endpointMinIntervalMs[bucket] ?? endpointMinIntervalMs.default ?? 0);
        slot.nextRequestAtMs = dispatchNow + requestMinIntervalMs;
        globalNextRequestAtMs = dispatchNow + globalRequestMinIntervalMs;
        bucketState.nextRequestAtMs = dispatchNow + endpointIntervalMs;
        try {
          const value = await item.work({ apiKey: slot.apiKey, apiKeyIndex: slot.apiKeyIndex });
          slot.consecutive429Count = 0;
          item.resolve(value);
        } catch (error) {
          if (isRateLimitError(error) && rateLimitCooldownMs > 0) {
            slot.consecutive429Count += 1;
            const cooldownMs = Math.min(
              rateLimitCooldownMs * 2 ** (slot.consecutive429Count - 1),
              MAX_RATE_LIMIT_COOLDOWN_MS
            );
            const cooldownStartedAtMs = now();
            const cooldownUntilMs = cooldownStartedAtMs + cooldownMs;
            const bucketState = endpointState[endpointBucket(item)];
            slot.last429AtMs = cooldownStartedAtMs;
            slot.cooldownUntilMs = Math.max(slot.cooldownUntilMs, cooldownUntilMs);
            globalCooldownUntilMs = Math.max(globalCooldownUntilMs, cooldownUntilMs);
            bucketState.cooldownUntilMs = Math.max(bucketState.cooldownUntilMs, cooldownUntilMs);
          }
          item.reject(error);
        }
      }
    } finally {
      running = false;
      if (queue.length > 0) scheduleDrain();
    }
  }

  function enqueue<T>(input: TronscanScheduleInput, work: (context: TronscanScheduleContext) => Promise<T>): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      queue.push({
        input,
        work: work as (context: TronscanScheduleContext) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      scheduleDrain();
    });
    return promise;
  }

  return {
    schedule<T>(input: TronscanScheduleInput, work: (context: TronscanScheduleContext) => Promise<T>): Promise<T> {
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
        apiKeyConfigured: apiKeys.length > 0 || options.apiKeyConfigured === true,
        apiKeyCount: apiKeys.length,
        queued: queue.length,
        cooldownUntilMs: Math.max(...slots.map((slot) => slot.cooldownUntilMs)),
        globalCooldownUntilMs,
        endpointCooldownUntilMs: Object.fromEntries(
          endpointBuckets.map((bucket) => [bucket, endpointState[bucket].cooldownUntilMs])
        ) as Partial<Record<TronscanEndpointBucket, number>>
      };
    }
  };
}
