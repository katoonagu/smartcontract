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
  inFlight: number;
  maxInFlight: number;
  maxInFlightPerGroup: number;
  dispatchedRequests: number;
  completedRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  cooldownUntilMs: number;
  globalCooldownUntilMs: number;
  globalCooldownUntilMsByScope: Partial<Record<TronscanRateLimitScope, number>>;
  endpointCooldownUntilMs: Partial<Record<TronscanEndpointBucket, number>>;
  accountGroupCooldownUntilMs: Record<string, number>;
  inFlightByAccountGroup: Record<string, number>;
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
  maxInFlight?: number;
  maxInFlightPerGroup?: number;
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
  inFlight: number;
  nextRequestAtMs: number;
  cooldownUntilMs: number;
  nextRequestAtMsByScope: Record<TronscanRateLimitScope, number>;
  endpointNextRequestAtMs: Record<TronscanEndpointBucket, number>;
  endpointCooldownUntilMs: Record<TronscanEndpointBucket, number>;
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

function emptyEndpointRecord<T>(value: T): Record<TronscanEndpointBucket, T> {
  return Object.fromEntries(endpointBuckets.map((bucket) => [bucket, value])) as Record<TronscanEndpointBucket, T>;
}

function normalizeApiKeys(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0))];
}

function normalizeConcurrencyLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function createTronscanScheduler(options: TronscanSchedulerOptions): TronscanScheduler {
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestMinIntervalMs = Math.max(0, options.requestMinIntervalMs);
  const rateLimitCooldownMs = Math.max(0, options.rateLimitCooldownMs);
  const globalRequestMinIntervalMs = Math.max(0, options.globalRequestMinIntervalMs ?? 0);
  const accountGroupRequestMinIntervalMs = Math.max(0, options.accountGroupRequestMinIntervalMs ?? 0);
  const accountGroupPacingEnabled = (options.apiKeyGroups?.length ?? 0) > 0 || accountGroupRequestMinIntervalMs > 0;
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
  const maxInFlight = normalizeConcurrencyLimit(options.maxInFlight, Math.max(1, slots.length));
  const maxInFlightPerGroup = normalizeConcurrencyLimit(options.maxInFlightPerGroup, 2);
  const accountGroupState = new Map<string, AccountGroupState>();
  function accountGroupForSlot(slot: ApiKeySlot): AccountGroupState {
    const existing = accountGroupState.get(slot.groupId);
    if (existing) return existing;
    const created: AccountGroupState = {
      inFlight: 0,
      nextRequestAtMs: 0,
      cooldownUntilMs: 0,
      nextRequestAtMsByScope: emptyScopeRecord(0),
      endpointNextRequestAtMs: emptyEndpointRecord(0),
      endpointCooldownUntilMs: emptyEndpointRecord(0)
    };
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
  let inFlight = 0;
  let dispatchedRequests = 0;
  let completedRequests = 0;
  let failedRequests = 0;
  let rateLimitedRequests = 0;
  let running = false;
  let drainScheduled = false;
  let wakeDeadlineMs: number | null = null;
  let wakeToken = 0;

  function scheduleDrain(): void {
    if (drainScheduled) return;
    drainScheduled = true;
    void Promise.resolve().then(() => {
      drainScheduled = false;
      drain();
    });
  }

  function scheduleWake(waitMs: number): void {
    const wakeAtMs = now() + Math.max(0, waitMs);
    if (wakeDeadlineMs !== null && wakeDeadlineMs <= wakeAtMs) return;
    wakeDeadlineMs = wakeAtMs;
    const token = ++wakeToken;
    void delay(waitMs).then(
      () => {
        if (token !== wakeToken) return;
        wakeDeadlineMs = null;
        scheduleDrain();
      },
      () => {
        if (token !== wakeToken) return;
        wakeDeadlineMs = null;
        scheduleDrain();
      }
    );
  }

  function slotReadyAtMs(slot: ApiKeySlot, item: QueueItem<unknown>): number {
    const bucket = endpointBucket(item);
    const bucketState = endpointState[bucket];
    const scope = rateLimitScope(item);
    const scopedGlobalState = scopeState[scope];
    const groupState = accountGroupPacingEnabled ? accountGroupForSlot(slot) : undefined;
    const groupScopeNextRequestAtMs = groupState?.nextRequestAtMsByScope[scope] ?? 0;
    const groupEndpointNextRequestAtMs = groupState?.endpointNextRequestAtMs[bucket] ?? 0;
    const groupEndpointCooldownUntilMs = groupState?.endpointCooldownUntilMs[bucket] ?? 0;
    return Math.max(
      slot.nextRequestAtMs,
      slot.cooldownUntilMsByScope[scope],
      groupState?.nextRequestAtMs ?? 0,
      groupState?.cooldownUntilMs ?? 0,
      accountGroupPacingEnabled ? groupScopeNextRequestAtMs : scopedGlobalState.nextRequestAtMs,
      accountGroupPacingEnabled ? 0 : scopedGlobalState.cooldownUntilMs,
      accountGroupPacingEnabled ? groupEndpointNextRequestAtMs : bucketState.nextRequestAtMs,
      accountGroupPacingEnabled ? groupEndpointCooldownUntilMs : bucketState.cooldownUntilMs
    );
  }

  function slotCooldownUntilMs(slot: ApiKeySlot, item: QueueItem<unknown>): number {
    return slot.cooldownUntilMsByScope[rateLimitScope(item)];
  }

  function earliestSlotFrom(item: QueueItem<unknown>, candidateSlots: readonly ApiKeySlot[]): ApiKeySlot | undefined {
    if (candidateSlots.length === 0) return undefined;
    if (item.input.slotScope === "single") {
      return candidateSlots.includes(slots[0]) ? slots[0] : undefined;
    }
    let best = candidateSlots[0];
    let bestReadyAt = slotReadyAtMs(best, item);
    for (const slot of candidateSlots.slice(1)) {
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

  function availableSlots(item: QueueItem<unknown>): ApiKeySlot[] {
    const scopedSlots = item.input.slotScope === "single" ? [slots[0]] : slots;
    if (!accountGroupPacingEnabled) return scopedSlots;
    return scopedSlots.filter((slot) => accountGroupForSlot(slot).inFlight < maxInFlightPerGroup);
  }

  function takeNextReadyItem(): { item: QueueItem<unknown>; slot: ApiKeySlot } | undefined {
    if (inFlight >= maxInFlight) return undefined;
    const readyAtMs = now();
    let bestIndex = -1;
    let bestRank = Number.POSITIVE_INFINITY;
    let bestSlot: ApiKeySlot | undefined;
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      const slot = earliestSlotFrom(item, availableSlots(item));
      if (!slot || slotReadyAtMs(slot, item) > readyAtMs) continue;
      const rank = queueRank(item);
      if (bestIndex === -1 || rank < bestRank) {
        bestIndex = index;
        bestRank = rank;
        bestSlot = slot;
      }
    }
    if (bestIndex === -1 || !bestSlot) return undefined;
    const [item] = queue.splice(bestIndex, 1);
    return { item, slot: bestSlot };
  }

  function nextWakeDelayMs(): number | undefined {
    if (queue.length === 0 || inFlight >= maxInFlight) return undefined;
    const wakeNow = now();
    let earliestReadyAtMs = Number.POSITIVE_INFINITY;
    for (const item of queue) {
      const slot = earliestSlotFrom(item, availableSlots(item));
      if (!slot) continue;
      earliestReadyAtMs = Math.min(earliestReadyAtMs, slotReadyAtMs(slot, item));
    }
    if (earliestReadyAtMs === Number.POSITIVE_INFINITY) return undefined;
    return Math.max(0, earliestReadyAtMs - wakeNow);
  }

  function dispatch(item: QueueItem<unknown>, slot: ApiKeySlot): void {
    const dispatchNow = now();
    const bucket = endpointBucket(item);
    const bucketState = endpointState[bucket];
    const scope = rateLimitScope(item);
    const scopedGlobalState = scopeState[scope];
    const accountGroup = accountGroupForSlot(slot);
    const groupState = accountGroupPacingEnabled ? accountGroup : undefined;
    const endpointIntervalMs = Math.max(0, endpointMinIntervalMs[bucket] ?? endpointMinIntervalMs.default ?? 0);
    slot.nextRequestAtMs = dispatchNow + requestMinIntervalMs;
    // Account groups model provider-side quota buckets: independent groups can run in parallel,
    // while keys from the same account keep sharing pacing and cooldown.
    if (groupState) {
      groupState.nextRequestAtMs = dispatchNow + accountGroupRequestMinIntervalMs;
      groupState.nextRequestAtMsByScope[scope] = dispatchNow + globalRequestMinIntervalMs;
      groupState.endpointNextRequestAtMs[bucket] = dispatchNow + endpointIntervalMs;
    } else {
      scopedGlobalState.nextRequestAtMs = dispatchNow + globalRequestMinIntervalMs;
      bucketState.nextRequestAtMs = dispatchNow + endpointIntervalMs;
    }
    inFlight += 1;
    accountGroup.inFlight += 1;
    dispatchedRequests += 1;
    void (async () => {
      try {
        const value = await item.work({ apiKey: slot.apiKey, apiKeyIndex: slot.apiKeyIndex });
        slot.consecutive429CountByScope[scope] = 0;
        completedRequests += 1;
        item.resolve(value);
      } catch (error) {
        failedRequests += 1;
        if (isRateLimitError(error) && rateLimitCooldownMs > 0) {
          rateLimitedRequests += 1;
          slot.consecutive429CountByScope[scope] += 1;
          const cooldownMs = Math.min(
            rateLimitCooldownMs * 2 ** (slot.consecutive429CountByScope[scope] - 1),
            MAX_RATE_LIMIT_COOLDOWN_MS
          );
          const cooldownStartedAtMs = now();
          const cooldownUntilMs = cooldownStartedAtMs + cooldownMs;
          const endpoint = endpointBucket(item);
          const endpointStateForItem = endpointState[endpoint];
          const scopedGlobalStateForItem = scopeState[scope];
          const pacingGroup = accountGroupPacingEnabled ? accountGroupForSlot(slot) : undefined;
          slot.last429AtMsByScope[scope] = cooldownStartedAtMs;
          slot.cooldownUntilMsByScope[scope] = Math.max(slot.cooldownUntilMsByScope[scope], cooldownUntilMs);
          if (pacingGroup) {
            pacingGroup.cooldownUntilMs = Math.max(pacingGroup.cooldownUntilMs, cooldownUntilMs);
            pacingGroup.endpointCooldownUntilMs[endpoint] = Math.max(
              pacingGroup.endpointCooldownUntilMs[endpoint],
              cooldownUntilMs
            );
          } else {
            scopedGlobalStateForItem.cooldownUntilMs = Math.max(scopedGlobalStateForItem.cooldownUntilMs, cooldownUntilMs);
            endpointStateForItem.cooldownUntilMs = Math.max(endpointStateForItem.cooldownUntilMs, cooldownUntilMs);
          }
        }
        item.reject(error);
      } finally {
        inFlight -= 1;
        accountGroup.inFlight -= 1;
        scheduleDrain();
      }
    })();
  }

  function drain(): void {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0 && inFlight < maxInFlight) {
        const candidate = takeNextReadyItem();
        if (!candidate) break;
        dispatch(candidate.item, candidate.slot);
      }
    } finally {
      running = false;
    }
    const waitMs = nextWakeDelayMs();
    if (waitMs !== undefined) scheduleWake(waitMs);
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
        inFlight,
        maxInFlight,
        maxInFlightPerGroup,
        dispatchedRequests,
        completedRequests,
        failedRequests,
        rateLimitedRequests,
        cooldownUntilMs: Math.max(...slots.flatMap((slot) => rateLimitScopes.map((scope) => slot.cooldownUntilMsByScope[scope]))),
        globalCooldownUntilMs: Math.max(...rateLimitScopes.map((scope) => scopeState[scope].cooldownUntilMs)),
        globalCooldownUntilMsByScope: Object.fromEntries(
          rateLimitScopes.map((scope) => [scope, scopeState[scope].cooldownUntilMs])
        ) as Partial<Record<TronscanRateLimitScope, number>>,
        endpointCooldownUntilMs: Object.fromEntries(
          endpointBuckets.map((bucket) => [bucket, Math.max(
            endpointState[bucket].cooldownUntilMs,
            ...[...accountGroupState.values()].map((state) => state.endpointCooldownUntilMs[bucket])
          )])
        ) as Partial<Record<TronscanEndpointBucket, number>>,
        accountGroupCooldownUntilMs: Object.fromEntries(
          [...accountGroupState.entries()].map(([groupId, state]) => [groupId, state.cooldownUntilMs])
        ),
        inFlightByAccountGroup: Object.fromEntries(
          [...accountGroupState.entries()].map(([groupId, state]) => [groupId, state.inFlight])
        )
      };
    }
  };
}
