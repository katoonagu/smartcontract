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
  observationScope?: "unified";
  observationRunId?: string;
  observationTaskId?: string;
  observationCanonicalSequence?: number;
  observationAttempt?: number;
  observationSlotId?: number;
  observationSlotEpoch?: number;
};

export type TronscanDispatchObservation = {
  readonly requestId: number;
  readonly scope: "unified";
  readonly atMs: number;
  readonly runId?: string;
};

export type TronscanDispatchOutcomeObservation = {
  readonly requestId: number;
  readonly scope: "unified";
  readonly outcome: "success" | "error" | "rate_limited_429";
  readonly runId?: string;
};

export type TronscanRunDispatchObservation = {
  readonly requestId: number;
  readonly scope: "unified";
  readonly atMs: number;
  readonly runId: string;
  readonly groupId: string;
  readonly taskId?: string;
  readonly canonicalSequence?: number;
  readonly attempt?: number;
};

export type TronscanRunDispatchOutcomeObservation = {
  readonly requestId: number;
  readonly scope: "unified";
  readonly runId: string;
  readonly groupId: string;
  readonly taskId?: string;
  readonly canonicalSequence?: number;
  readonly attempt?: number;
  readonly outcome: "success" | "error" | "rate_limited_429";
};

export type TronscanObserverObservation = {
  readonly requestId: number;
  readonly scope: "unified";
  readonly runId: string;
  readonly slotId: number;
  readonly epoch: number;
};

export type TronscanScheduleContext = {
  apiKey: string | null;
  apiKeyIndex: number | null;
};

export type TronscanApiKeyGroup = {
  groupId: string;
  apiKeys: readonly string[];
};

export type ProviderGroupCapacitySnapshot = {
  groupId: string;
  state: "healthy" | "cooldown" | "circuit_open";
  concurrencyLimit: number;
  inFlight: number;
  cooldownUntil: number | null;
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
  dispatchedRequestsByAccountGroup: Record<string, number>;
};

export type TronscanScheduler = {
  schedule<T>(input: TronscanScheduleInput, work: (context: TronscanScheduleContext) => Promise<T>): Promise<T>;
  diagnostics(): TronscanSchedulerDiagnostics;
  groupSnapshots(): ProviderGroupCapacitySnapshot[];
  teardownBenchmarkControl(controlSha256: string): void;
  installBenchmarkGroupCooldown(input: {
    readonly controlSha256: string;
    readonly runId: string;
    readonly groupId: string;
    readonly startsAtMs: number;
    readonly endsAtMs: number;
  }): void;
  benchmarkGroupCooldown(runId: string): {
    readonly controlSha256: string;
    readonly runId: string;
    readonly groupId: string;
    readonly startsAtMs: number;
    readonly endsAtMs: number;
    readonly fallbackDispatches: number;
    readonly resumedDispatches: number;
    readonly activeObserved: boolean;
    readonly synthetic: true;
  } | null;
  installBenchmarkRunDelay(input: {
    readonly controlSha256: string;
    readonly runId: string;
    readonly taskId: string;
    readonly canonicalSequence: number;
    readonly startsAtMs: number;
    readonly endsAtMs: number;
  }): void;
  benchmarkRunDelay(runId: string): {
    readonly controlSha256: string;
    readonly runId: string;
    readonly taskId: string;
    readonly canonicalSequence: number;
    readonly startsAtMs: number;
    readonly endsAtMs: number;
    readonly activeObserved: boolean;
    readonly resumedDispatches: number;
    readonly resumedSuccessfulOutcomes: number;
    readonly successfulAttemptNumbers: readonly number[];
  } | null;
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
  providerFailureCircuitThreshold?: number;
  providerCircuitOpenMs?: number;
  apiKeyConfigured?: boolean;
  apiKeys?: readonly string[];
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  onDispatchObservation?(observation: TronscanDispatchObservation): void;
  onDispatchOutcome?(observation: TronscanDispatchOutcomeObservation): void;
  onRunDispatchObservation?(
    observation: TronscanRunDispatchObservation
  ): void;
  onRunDispatchOutcome?(
    observation: TronscanRunDispatchOutcomeObservation
  ): void;
  onPacingObservation?(input: TronscanObserverObservation): void;
  onObserverSettled?(input: TronscanObserverObservation): void;
};

type UnifiedObserver = Omit<
  TronscanObserverObservation,
  "requestId" | "scope"
> & {
  readonly taskId?: string;
  readonly canonicalSequence?: number;
  readonly attempt?: number;
};

type QueueItem<T> = {
  requestId: number;
  input: TronscanScheduleInput;
  work: (context: TronscanScheduleContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  unifiedObserved: boolean;
  observers: Map<string, UnifiedObserver>;
  pacedObservers: Set<string>;
  settledObservers: Set<string>;
  pacingActive: boolean;
  dispatchedAtMs: number | null;
  dispatchedGroupId: string | null;
  dispatchObserved: boolean;
  dispatchObservedRunIds: Set<string>;
  outcome: TronscanDispatchOutcomeObservation["outcome"] | null;
  outcomeObserved: boolean;
  outcomeObservedRunIds: Set<string>;
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
  dispatchedRequests: number;
  consecutiveProviderFailures: number;
  circuitOpenUntilMs: number;
  halfOpenProbeInFlight: boolean;
  nextRequestAtMs: number;
  cooldownUntilMs: number;
  nextRequestAtMsByScope: Record<TronscanRateLimitScope, number>;
  endpointNextRequestAtMs: Record<TronscanEndpointBucket, number>;
  endpointCooldownUntilMs: Record<TronscanEndpointBucket, number>;
};

type BenchmarkGroupCooldown = {
  controlSha256: string;
  runId: string;
  groupId: string;
  startsAtMs: number;
  endsAtMs: number;
  fallbackDispatches: number;
  resumedDispatches: number;
  activeObserved: boolean;
  synthetic: true;
};

type BenchmarkRunDelay = {
  controlSha256: string;
  runId: string;
  taskId: string;
  canonicalSequence: number;
  startsAtMs: number;
  endsAtMs: number;
  activeObserved: boolean;
  resumedDispatches: number;
  resumedSuccessfulOutcomes: number;
  successfulAttemptNumbers: Set<number>;
};

const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;
const MAX_COALESCED_UNIFIED_RUN_OBSERVERS = 128;
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
  const providerFailureCircuitThreshold = options.providerFailureCircuitThreshold === undefined
    ? 0
    : Math.max(0, Math.floor(options.providerFailureCircuitThreshold));
  const providerCircuitOpenMs = Math.max(
    1,
    Math.floor(options.providerCircuitOpenMs ?? Math.max(1, rateLimitCooldownMs))
  );
  const accountGroupState = new Map<string, AccountGroupState>();
  function accountGroupForSlot(slot: ApiKeySlot): AccountGroupState {
    const existing = accountGroupState.get(slot.groupId);
    if (existing) return existing;
    const created: AccountGroupState = {
      inFlight: 0,
      dispatchedRequests: 0,
      consecutiveProviderFailures: 0,
      circuitOpenUntilMs: 0,
      halfOpenProbeInFlight: false,
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
  const inFlightByCacheKey = new Map<string, {
    readonly promise: Promise<unknown>;
    readonly item: QueueItem<unknown>;
  }>();
  const benchmarkGroupCooldownByRunId =
    new Map<string, BenchmarkGroupCooldown>();
  const benchmarkRunDelayByRunId = new Map<string, BenchmarkRunDelay>();
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
  let nextRequestId = 0;

  function observeDispatch(item: QueueItem<unknown>): void {
    if (
      !item.unifiedObserved ||
      item.dispatchObserved ||
      item.dispatchedAtMs === null
    ) {
      return;
    }
    item.dispatchObserved = true;
    try {
      options.onDispatchObservation?.({
        requestId: item.requestId,
        scope: "unified",
        atMs: item.dispatchedAtMs
      });
    } catch {
      // ponytail: telemetry cannot participate in provider requests.
    }
    observeRunDispatches(item);
  }

  function observeRunDispatches(item: QueueItem<unknown>): void {
    if (
      item.dispatchedAtMs === null ||
      item.dispatchedGroupId === null
    ) {
      return;
    }
    for (const observer of item.observers.values()) {
      if (item.dispatchObservedRunIds.has(observer.runId)) continue;
      item.dispatchObservedRunIds.add(observer.runId);
      try {
        options.onRunDispatchObservation?.({
          requestId: item.requestId,
          scope: "unified",
          atMs: item.dispatchedAtMs,
          runId: observer.runId,
          groupId: item.dispatchedGroupId,
          taskId: observer.taskId,
          canonicalSequence: observer.canonicalSequence,
          attempt: observer.attempt
        });
      } catch {
        // ponytail: benchmark telemetry never affects provider work.
      }
    }
  }

  function observeOutcome(item: QueueItem<unknown>): void {
    if (
      !item.unifiedObserved ||
      item.outcomeObserved ||
      item.outcome === null
    ) {
      return;
    }
    item.outcomeObserved = true;
    try {
      options.onDispatchOutcome?.({
        requestId: item.requestId,
        scope: "unified",
        outcome: item.outcome
      });
    } catch {
      // ponytail: telemetry cannot participate in provider requests.
    }
    observeRunOutcomes(item);
  }

  function observeRunOutcomes(item: QueueItem<unknown>): void {
    if (item.outcome === null || item.dispatchedGroupId === null) return;
    for (const observer of item.observers.values()) {
      if (item.outcomeObservedRunIds.has(observer.runId)) continue;
      item.outcomeObservedRunIds.add(observer.runId);
      try {
        options.onRunDispatchOutcome?.({
          requestId: item.requestId,
          scope: "unified",
          runId: observer.runId,
          groupId: item.dispatchedGroupId,
          taskId: observer.taskId,
          canonicalSequence: observer.canonicalSequence,
          attempt: observer.attempt,
          outcome: item.outcome
        });
      } catch {
        // ponytail: benchmark telemetry never affects provider work.
      }
    }
  }

  function observePacing(
    item: QueueItem<unknown>,
    key: string,
    observer: UnifiedObserver
  ): void {
    if (
      !item.pacingActive ||
      item.pacedObservers.has(key)
    ) {
      return;
    }
    item.pacedObservers.add(key);
    try {
      options.onPacingObservation?.({
        requestId: item.requestId,
        scope: "unified",
        ...observer
      });
    } catch {
      // ponytail: telemetry cannot participate in provider scheduling.
    }
  }

  function observeSettled(
    item: QueueItem<unknown>,
    key: string,
    observer: UnifiedObserver
  ): void {
    if (
      item.outcome === null ||
      item.settledObservers.has(key)
    ) {
      return;
    }
    item.settledObservers.add(key);
    try {
      options.onObserverSettled?.({
        requestId: item.requestId,
        scope: "unified",
        ...observer
      });
    } catch {
      // ponytail: telemetry cannot participate in provider requests.
    }
  }

  function attachObserver(
    item: QueueItem<unknown>,
    input: TronscanScheduleInput
  ): void {
    if (input.observationScope !== "unified") return;
    item.unifiedObserved = true;
    const runId = input.observationRunId?.trim();
    const slotId = input.observationSlotId;
    const epoch = input.observationSlotEpoch;
    const taskId = input.observationTaskId?.trim();
    const canonicalSequence = input.observationCanonicalSequence;
    const attempt = input.observationAttempt;
    if (
      runId &&
      Number.isSafeInteger(slotId) &&
      Number(slotId) >= 0 &&
      Number.isSafeInteger(epoch) &&
      Number(epoch) >= 0
    ) {
      const observer = {
        runId,
        slotId: Number(slotId),
        epoch: Number(epoch),
        ...(taskId &&
          Number.isSafeInteger(canonicalSequence) &&
          Number(canonicalSequence) >= 0
          ? {
              taskId,
              canonicalSequence: Number(canonicalSequence),
              ...(Number.isSafeInteger(attempt) && Number(attempt) > 0
                ? { attempt: Number(attempt) }
                : {})
            }
          : {})
      };
      const key = JSON.stringify([
        observer.runId,
        observer.slotId,
        observer.epoch,
        observer.taskId ?? null,
        observer.canonicalSequence ?? null,
        observer.attempt ?? null
      ]);
      if (
        item.observers.has(key) ||
        item.observers.size < MAX_COALESCED_UNIFIED_RUN_OBSERVERS
      ) {
        item.observers.set(key, observer);
        observePacing(item, key, observer);
        observeSettled(item, key, observer);
      }
    }
    observeRunDispatches(item);
    observeRunOutcomes(item);
    observeDispatch(item);
    observeOutcome(item);
  }

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
      groupState?.circuitOpenUntilMs ?? 0,
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
    const observations = [...item.observers.values()];
    let activeDelayedObservers = 0;
    for (const observer of observations) {
      const gate = benchmarkRunDelayByRunId.get(observer.runId);
      if (
        gate &&
        gate.taskId === observer.taskId &&
        gate.canonicalSequence === observer.canonicalSequence &&
        gate.startsAtMs <= now() &&
        gate.endsAtMs > now()
      ) {
        gate.activeObserved = true;
        activeDelayedObservers += 1;
        scheduleWake(Math.max(0, gate.endsAtMs - now()));
      }
    }
    if (
      activeDelayedObservers > 0 &&
      activeDelayedObservers === observations.length
    ) return [];
    const itemRunIds = new Set(observations.map((item) => item.runId));
    const excludedGroupIds = new Set([...itemRunIds].flatMap((runId) => {
      const fault = benchmarkGroupCooldownByRunId.get(runId);
      if (
        fault &&
        fault.startsAtMs <= now() &&
        fault.endsAtMs > now()
      ) {
        fault.activeObserved = true;
      }
      return fault &&
        fault.startsAtMs <= now() &&
        fault.endsAtMs > now()
        ? [fault.groupId]
        : [];
    }));
    return scopedSlots.filter((slot) => {
      if (excludedGroupIds.has(slot.groupId)) return false;
      const group = accountGroupForSlot(slot);
      if (accountGroupPacingEnabled && group.inFlight >= maxInFlightPerGroup) {
        return false;
      }
      return !(
        group.circuitOpenUntilMs > 0 &&
        group.circuitOpenUntilMs <= now() &&
        group.halfOpenProbeInFlight
      );
    });
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
      const itemReadyAtMs = slotReadyAtMs(slot, item);
      if (
        itemReadyAtMs > wakeNow &&
        item.unifiedObserved &&
        !item.pacingActive
      ) {
        item.pacingActive = true;
        for (const [key, observer] of item.observers) {
          observePacing(item, key, observer);
        }
      }
      earliestReadyAtMs = Math.min(earliestReadyAtMs, itemReadyAtMs);
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
    if (
      accountGroup.circuitOpenUntilMs > 0 &&
      accountGroup.circuitOpenUntilMs <= dispatchNow
    ) {
      accountGroup.halfOpenProbeInFlight = true;
    }
    accountGroup.dispatchedRequests += 1;
    dispatchedRequests += 1;
    item.dispatchedGroupId = slot.groupId;
    for (const runId of new Set([
      ...(item.input.observationRunId
        ? [item.input.observationRunId]
        : []),
      ...[...item.observers.values()].map((observer) => observer.runId)
    ])) {
      const fault = benchmarkGroupCooldownByRunId.get(runId);
      if (
        fault &&
        fault.startsAtMs <= dispatchNow &&
        fault.endsAtMs > dispatchNow &&
        fault.groupId !== slot.groupId
      ) {
        fault.fallbackDispatches += 1;
      } else if (
        fault &&
        fault.endsAtMs <= dispatchNow &&
        fault.groupId === slot.groupId
      ) {
        fault.resumedDispatches += 1;
      }
    }
    item.dispatchedAtMs = dispatchNow;
    observeDispatch(item);
    void (async () => {
      try {
        const value = await item.work({ apiKey: slot.apiKey, apiKeyIndex: slot.apiKeyIndex });
        slot.consecutive429CountByScope[scope] = 0;
        accountGroup.consecutiveProviderFailures = 0;
        accountGroup.circuitOpenUntilMs = 0;
        accountGroup.halfOpenProbeInFlight = false;
        completedRequests += 1;
        item.outcome = "success";
        observeOutcome(item);
        for (const [key, observer] of item.observers) {
          observeSettled(item, key, observer);
        }
        item.resolve(value);
      } catch (error) {
        failedRequests += 1;
        const rateLimited = isRateLimitError(error);
        item.outcome = rateLimited ? "rate_limited_429" : "error";
        observeOutcome(item);
        for (const [key, observer] of item.observers) {
          observeSettled(item, key, observer);
        }
        if (rateLimited && rateLimitCooldownMs > 0) {
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
          if (accountGroup.halfOpenProbeInFlight) {
            accountGroup.circuitOpenUntilMs = cooldownUntilMs;
            accountGroup.halfOpenProbeInFlight = false;
          }
        } else if (
          !rateLimited &&
          providerFailureCircuitThreshold > 0
        ) {
          accountGroup.consecutiveProviderFailures += 1;
          if (
            accountGroup.consecutiveProviderFailures >=
              providerFailureCircuitThreshold
          ) {
            accountGroup.circuitOpenUntilMs =
              now() + providerCircuitOpenMs;
          }
          accountGroup.halfOpenProbeInFlight = false;
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

  function enqueue<T>(
    input: TronscanScheduleInput,
    work: (context: TronscanScheduleContext) => Promise<T>
  ): { readonly promise: Promise<T>; readonly item: QueueItem<T> } {
    let item!: QueueItem<T>;
    const promise = new Promise<T>((resolve, reject) => {
      item = {
        requestId: nextRequestId++,
        input,
        work: work as (context: TronscanScheduleContext) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        unifiedObserved: false,
        observers: new Map(),
        pacedObservers: new Set(),
        settledObservers: new Set(),
        pacingActive: false,
        dispatchedAtMs: null,
        dispatchedGroupId: null,
        dispatchObserved: false,
        dispatchObservedRunIds: new Set(),
        outcome: null,
        outcomeObserved: false,
        outcomeObservedRunIds: new Set()
      } as QueueItem<T>;
      attachObserver(item as QueueItem<unknown>, input);
      queue.push(item as QueueItem<unknown>);
      scheduleDrain();
    });
    return { promise, item };
  }

  function settleScheduledObserver<T>(
    promise: Promise<T>,
    input: TronscanScheduleInput
  ): Promise<T> {
    const gate = input.observationRunId === undefined
      ? null
      : benchmarkRunDelayByRunId.get(input.observationRunId);
    if (
      gate === null ||
      gate === undefined ||
      gate.taskId !== input.observationTaskId ||
      gate.canonicalSequence !== input.observationCanonicalSequence
    ) {
      return promise;
    }
    if (gate.startsAtMs <= now() && now() < gate.endsAtMs) {
      gate.activeObserved = true;
    }
    return (async () => {
      let value: T;
      try {
        value = await promise;
      } catch (error) {
        if (now() < gate.endsAtMs) {
          await delay(gate.endsAtMs - now());
        }
        gate.resumedDispatches += 1;
        throw error;
      }
      if (now() < gate.endsAtMs) {
        await delay(gate.endsAtMs - now());
      }
      gate.resumedDispatches += 1;
      gate.resumedSuccessfulOutcomes += 1;
      if (
        Number.isSafeInteger(input.observationAttempt) &&
        Number(input.observationAttempt) > 0
      ) {
        gate.successfulAttemptNumbers.add(
          Number(input.observationAttempt)
        );
      }
      return value;
    })();
  }

  return {
    teardownBenchmarkControl(controlSha256): void {
      if (!/^[0-9a-f]{64}$/u.test(controlSha256)) {
        throw new TypeError("tronscan_benchmark_control_invalid");
      }
      for (const [runId, value] of benchmarkGroupCooldownByRunId) {
        if (value.controlSha256 === controlSha256) {
          benchmarkGroupCooldownByRunId.delete(runId);
        }
      }
      for (const [runId, value] of benchmarkRunDelayByRunId) {
        if (value.controlSha256 === controlSha256) {
          benchmarkRunDelayByRunId.delete(runId);
        }
      }
    },
    schedule<T>(input: TronscanScheduleInput, work: (context: TronscanScheduleContext) => Promise<T>): Promise<T> {
      if (!input.cacheKey) {
        return settleScheduledObserver(
          enqueue(input, work).promise,
          input
        );
      }
      const existing = inFlightByCacheKey.get(input.cacheKey);
      if (existing) {
        attachObserver(existing.item, input);
        return settleScheduledObserver(
          existing.promise as Promise<T>,
          input
        );
      }
      const enqueued = enqueue(input, work);
      const pending = enqueued.promise.finally(() => {
        inFlightByCacheKey.delete(input.cacheKey as string);
      });
      inFlightByCacheKey.set(input.cacheKey, {
        promise: pending,
        item: enqueued.item as QueueItem<unknown>
      });
      return settleScheduledObserver(pending, input);
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
        ),
        dispatchedRequestsByAccountGroup: Object.fromEntries(
          [...accountGroupState.entries()].map(([groupId, state]) => [groupId, state.dispatchedRequests])
        )
      };
    },
    groupSnapshots(): ProviderGroupCapacitySnapshot[] {
      const snapshotNow = now();
      return [...accountGroupState.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([groupId, state]) => {
          const circuitOpen = state.circuitOpenUntilMs > snapshotNow;
          const cooldown = state.cooldownUntilMs > snapshotNow;
          const cooldownUntil = circuitOpen
            ? state.circuitOpenUntilMs
            : cooldown
              ? state.cooldownUntilMs
              : null;
          return {
            groupId,
            state: circuitOpen
              ? "circuit_open"
              : cooldown
                ? "cooldown"
                : "healthy",
            concurrencyLimit: Math.min(
              maxInFlightPerGroup,
              maxInFlight
            ),
            inFlight: state.inFlight,
            cooldownUntil
          };
        });
    },
    installBenchmarkGroupCooldown(input): void {
      if (
        !/^[0-9a-f]{64}$/u.test(input.controlSha256) ||
        !input.runId.trim() ||
        !accountGroupState.has(input.groupId) ||
        !Number.isSafeInteger(input.startsAtMs) ||
        !Number.isSafeInteger(input.endsAtMs) ||
        input.endsAtMs <= input.startsAtMs ||
        input.endsAtMs - input.startsAtMs >
          MAX_RATE_LIMIT_COOLDOWN_MS
      ) {
        throw new TypeError("tronscan_benchmark_cooldown_invalid");
      }
      const existing = benchmarkGroupCooldownByRunId.get(input.runId);
      if (
        existing &&
        (
          existing.controlSha256 !== input.controlSha256 ||
          existing.groupId !== input.groupId ||
          existing.startsAtMs !== input.startsAtMs ||
          existing.endsAtMs !== input.endsAtMs
        )
      ) {
        throw new Error("tronscan_benchmark_cooldown_conflict");
      }
      if (!existing) {
        benchmarkGroupCooldownByRunId.set(input.runId, {
          ...input,
          fallbackDispatches: 0,
          resumedDispatches: 0,
          activeObserved:
            input.startsAtMs <= now() && input.endsAtMs > now(),
          synthetic: true
        });
      }
      scheduleWake(Math.max(0, input.endsAtMs - now()));
    },
    benchmarkGroupCooldown(runId) {
      const value = benchmarkGroupCooldownByRunId.get(runId);
      return value ? { ...value } : null;
    },
    installBenchmarkRunDelay(input): void {
      if (
        !/^[0-9a-f]{64}$/u.test(input.controlSha256) ||
        !input.runId.trim() ||
        !input.taskId.trim() ||
        !Number.isSafeInteger(input.canonicalSequence) ||
        input.canonicalSequence < 0 ||
        !Number.isSafeInteger(input.startsAtMs) ||
        !Number.isSafeInteger(input.endsAtMs) ||
        input.endsAtMs <= input.startsAtMs ||
        input.endsAtMs - input.startsAtMs >
          MAX_RATE_LIMIT_COOLDOWN_MS
      ) {
        throw new TypeError("tronscan_benchmark_run_delay_invalid");
      }
      const existing = benchmarkRunDelayByRunId.get(input.runId);
      if (existing && (
          existing.controlSha256 !== input.controlSha256 ||
          existing.taskId !== input.taskId ||
          existing.canonicalSequence !== input.canonicalSequence ||
          existing.startsAtMs !== input.startsAtMs ||
        existing.endsAtMs !== input.endsAtMs
      )) {
        throw new Error("tronscan_benchmark_run_delay_conflict");
      }
      if (!existing) {
        benchmarkRunDelayByRunId.set(input.runId, {
          ...input,
          activeObserved: false,
          resumedDispatches: 0,
          resumedSuccessfulOutcomes: 0,
          successfulAttemptNumbers: new Set()
        });
      }
    },
    benchmarkRunDelay(runId) {
      const value = benchmarkRunDelayByRunId.get(runId);
      return value
        ? {
            ...value,
            successfulAttemptNumbers: [
              ...value.successfulAttemptNumbers
            ].sort((left, right) => left - right)
          }
        : null;
    }
  };
}
