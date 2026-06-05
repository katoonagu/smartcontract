export type TronscanRequestPriority =
  | "interactive_fast"
  | "deep_transfer"
  | "metadata"
  | "contract_profile";

export type TronscanEndpointBucket = "transfer" | "approval" | "contract" | "fullnode" | "trongrid" | "default";
export type TronscanRateLimitScope = "tronscan" | "fullnode" | "trongrid";

export type TronscanScheduleInput = {
  requestName: string;
  path: string;
  priority?: TronscanRequestPriority;
  cacheKey?: string;
  slotScope?: "pool" | "single";
  endpointBucket?: TronscanEndpointBucket;
  rateLimitScope?: TronscanRateLimitScope;
};

export type TronscanScheduleContext = {
  apiKey: string | null;
  apiKeyIndex: number | null;
};

export type TronscanApiKeyGroup = {
  groupId: string;
  apiKeys: readonly string[];
};

export type TronscanSchedulerDiagnostics = {
  apiKeyConfigured: boolean;
  apiKeyCount: number;
  apiKeyGroupCount: number;
  queued: number;
  cooldownUntilMs: number;
  globalCooldownUntilMs: number;
  globalCooldownUntilMsByScope: Partial<Record<TronscanRateLimitScope, number>>;
  endpointCooldownUntilMs: Partial<Record<TronscanEndpointBucket, number>>;
  accountGroupCooldownUntilMs: Record<string, number>;
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
  apiKeyGroups?: readonly TronscanApiKeyGroup[];
  accountGroupRequestMinIntervalMs?: number;
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
  groupId: string;
  nextRequestAtMs: number;
  cooldownUntilMsByScope: Record<TronscanRateLimitScope, number>;
  last429AtMsByScope: Record<TronscanRateLimitScope, number | null>;
  consecutive429CountByScope: Record<TronscanRateLimitScope, number>;
};

type EndpointState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
};

type RateLimitScopeState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
};

type AccountGroupState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
};

const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;
const DEFAULT_ACCOUNT_GROUP_ID = "default";
const endpointBuckets: TronscanEndpointBucket[] = ["transfer", "approval", "contract", "fullnode", "trongrid", "default"];
const rateLimitScopes: TronscanRateLimitScope[] = ["tronscan", "fullnode", "trongrid"];

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

function endpointBucket(item: QueueItem<unknown>): TronscanEndpointBucket {
  return item.input.endpointBucket ?? "default";
}

function defaultRateLimitScope(bucket: TronscanEndpointBucket): TronscanRateLimitScope {
  if (bucket === "fullnode" || bucket === "trongrid") return bucket;
  return "tronscan";
}

function rateLimitScope(item: QueueItem<unknown>): TronscanRateLimitScope {
  return item.input.rateLimitScope ?? defaultRateLimitScope(endpointBucket(item));
}

function emptyScopeRecord<T>(value: T): Record<TronscanRateLimitScope, T> {
  return Object.fromEntries(rateLimitScopes.map((scope) => [scope, value])) as Record<TronscanRateLimitScope, T>;
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
  const accountGroupRequestMinIntervalMs = Math.max(0, options.accountGroupRequestMinIntervalMs ?? 0);
  const endpointMinIntervalMs = options.endpointMinIntervalMs ?? {};
  const apiKeys = normalizeApiKeys(options.apiKeys);
  const apiKeyGroupByKey = new Map<string, string>();
  for (const group of options.apiKeyGroups ?? []) {
    const groupId = group.groupId.trim() || DEFAULT_ACCOUNT_GROUP_ID;
    for (const apiKey of normalizeApiKeys(group.apiKeys)) {
      if (!apiKeyGroupByKey.has(apiKey)) {
        apiKeyGroupByKey.set(apiKey, groupId);
      }
    }
  }
  const groupIdForApiKey = (apiKey: string | null): string => {
    if (apiKey === null) return DEFAULT_ACCOUNT_GROUP_ID;
    return apiKeyGroupByKey.get(apiKey) ?? DEFAULT_ACCOUNT_GROUP_ID;
  };
  const slots: ApiKeySlot[] = apiKeys.length > 0
    ? apiKeys.map((apiKey, index) => ({
        apiKey,
        apiKeyIndex: index,
        groupId: groupIdForApiKey(apiKey),
        nextRequestAtMs: 0,
        cooldownUntilMsByScope: emptyScopeRecord(0),
        last429AtMsByScope: emptyScopeRecord<number | null>(null),
        consecutive429CountByScope: emptyScopeRecord(0)
      }))
    : [{
        apiKey: null,
        apiKeyIndex: null,
        groupId: DEFAULT_ACCOUNT_GROUP_ID,
        nextRequestAtMs: 0,
        cooldownUntilMsByScope: emptyScopeRecord(0),
        last429AtMsByScope: emptyScopeRecord<number | null>(null),
        consecutive429CountByScope: emptyScopeRecord(0)
      }];
  const accountGroupState = new Map<string, AccountGroupState>();
  function accountGroupForSlot(slot: ApiKeySlot): AccountGroupState {
    const existing = accountGroupState.get(slot.groupId);
    if (existing) return existing;
    const created: AccountGroupState = { nextRequestAtMs: 0, cooldownUntilMs: 0 };
    accountGroupState.set(slot.groupId, created);
    return created;
  }
  for (const slot of slots) {
    accountGroupForSlot(slot);
  }
  const endpointState: Record<TronscanEndpointBucket, EndpointState> = Object.fromEntries(
    endpointBuckets.map((bucket) => [bucket, { nextRequestAtMs: 0, cooldownUntilMs: 0 }])
  ) as Record<TronscanEndpointBucket, EndpointState>;
  const scopeState: Record<TronscanRateLimitScope, RateLimitScopeState> = Object.fromEntries(
    rateLimitScopes.map((scope) => [scope, { nextRequestAtMs: 0, cooldownUntilMs: 0 }])
  ) as Record<TronscanRateLimitScope, RateLimitScopeState>;
  const inFlightByCacheKey = new Map<string, Promise<unknown>>();
  const queue: Array<QueueItem<unknown>> = [];
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
    const scope = rateLimitScope(item);
    const scopedGlobalState = scopeState[scope];
    const groupState = accountGroupForSlot(slot);
    return Math.max(
      slot.nextRequestAtMs,
      slot.cooldownUntilMsByScope[scope],
      groupState.nextRequestAtMs,
      groupState.cooldownUntilMs,
      scopedGlobalState.nextRequestAtMs,
      scopedGlobalState.cooldownUntilMs,
      bucketState.nextRequestAtMs,
      bucketState.cooldownUntilMs
    );
  }

  function slotCooldownUntilMs(slot: ApiKeySlot, item: QueueItem<unknown>): number {
    return slot.cooldownUntilMsByScope[rateLimitScope(item)];
  }

  function earliestSlot(item: QueueItem<unknown>): ApiKeySlot {
    if (item.input.slotScope === "single") return slots[0];
    let best = slots[0];
    let bestReadyAt = slotReadyAtMs(best, item);
    for (const slot of slots.slice(1)) {
      const readyAt = slotReadyAtMs(slot, item);
      const slotCooldown = slotCooldownUntilMs(slot, item);
      const bestCooldown = slotCooldownUntilMs(best, item);
      if (
        readyAt < bestReadyAt ||
        (readyAt === bestReadyAt && slotCooldown < bestCooldown) ||
        (readyAt === bestReadyAt && slotCooldown === bestCooldown && slot.nextRequestAtMs < best.nextRequestAtMs)
      ) {
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
        const scope = rateLimitScope(item);
        const scopedGlobalState = scopeState[scope];
        const accountGroup = accountGroupForSlot(slot);
        const endpointIntervalMs = Math.max(0, endpointMinIntervalMs[bucket] ?? endpointMinIntervalMs.default ?? 0);
        slot.nextRequestAtMs = dispatchNow + requestMinIntervalMs;
        accountGroup.nextRequestAtMs = dispatchNow + accountGroupRequestMinIntervalMs;
        scopedGlobalState.nextRequestAtMs = dispatchNow + globalRequestMinIntervalMs;
        bucketState.nextRequestAtMs = dispatchNow + endpointIntervalMs;
        try {
          const value = await item.work({ apiKey: slot.apiKey, apiKeyIndex: slot.apiKeyIndex });
          slot.consecutive429CountByScope[scope] = 0;
          item.resolve(value);
        } catch (error) {
          if (isRateLimitError(error) && rateLimitCooldownMs > 0) {
            slot.consecutive429CountByScope[scope] += 1;
            const cooldownMs = Math.min(
              rateLimitCooldownMs * 2 ** (slot.consecutive429CountByScope[scope] - 1),
              MAX_RATE_LIMIT_COOLDOWN_MS
            );
            const cooldownStartedAtMs = now();
            const cooldownUntilMs = cooldownStartedAtMs + cooldownMs;
            const bucketState = endpointState[endpointBucket(item)];
            const scopedGlobalState = scopeState[scope];
            const accountGroup = accountGroupForSlot(slot);
            slot.last429AtMsByScope[scope] = cooldownStartedAtMs;
            slot.cooldownUntilMsByScope[scope] = Math.max(slot.cooldownUntilMsByScope[scope], cooldownUntilMs);
            accountGroup.cooldownUntilMs = Math.max(accountGroup.cooldownUntilMs, cooldownUntilMs);
            scopedGlobalState.cooldownUntilMs = Math.max(scopedGlobalState.cooldownUntilMs, cooldownUntilMs);
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
        apiKeyGroupCount: accountGroupState.size,
        queued: queue.length,
        cooldownUntilMs: Math.max(...slots.flatMap((slot) => rateLimitScopes.map((scope) => slot.cooldownUntilMsByScope[scope]))),
        globalCooldownUntilMs: Math.max(...rateLimitScopes.map((scope) => scopeState[scope].cooldownUntilMs)),
        globalCooldownUntilMsByScope: Object.fromEntries(
          rateLimitScopes.map((scope) => [scope, scopeState[scope].cooldownUntilMs])
        ) as Partial<Record<TronscanRateLimitScope, number>>,
        endpointCooldownUntilMs: Object.fromEntries(
          endpointBuckets.map((bucket) => [bucket, endpointState[bucket].cooldownUntilMs])
        ) as Partial<Record<TronscanEndpointBucket, number>>,
        accountGroupCooldownUntilMs: Object.fromEntries(
          [...accountGroupState.entries()].map(([groupId, state]) => [groupId, state.cooldownUntilMs])
        )
      };
    }
  };
}
