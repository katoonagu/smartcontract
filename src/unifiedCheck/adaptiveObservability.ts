import type {
  RuntimeResourceState
} from "./providerCapacityController";

export type UnifiedReasonScope = "pool" | "run" | "task";

export type UnifiedReasonCode =
  | "no_eligible_work"
  | "fairness_wait"
  | "admission_closed"
  | "provider_rate_paced"
  | "provider_cooldown"
  | "provider_circuit_open"
  | "canonical_head_wait"
  | "merge_buffer_full"
  | "db_pressure"
  | "memory_pressure"
  | "class_capacity_limit"
  | "repair_reserve_reclaim"
  | "background_preempted"
  | "reconciliation_wait"
  | "checkpoint_or_commit";

export interface UnifiedDecisionReason {
  readonly scope: UnifiedReasonScope;
  readonly code: UnifiedReasonCode;
}

export function createUnifiedDecisionReason(
  scope: UnifiedReasonScope,
  code: UnifiedReasonCode
): UnifiedDecisionReason {
  if (
    scope === "pool" &&
    (code === "fairness_wait" || code === "background_preempted")
  ) {
    throw new TypeError("unified_reason_scope_invalid");
  }
  return Object.freeze({ scope, code });
}

export type UnifiedAdaptiveEventType =
  | "provider_group_state_changed"
  | "resource_state_changed"
  | "planner_soft_overflow"
  | "manifest_hard_limit_rejected"
  | "repair_wait_violated"
  | "reconciliation_recovered_work"
  | "invariant_violated"
  | "idempotent_acceptance_replayed";

const EVENT_TYPES = new Set<UnifiedAdaptiveEventType>([
  "provider_group_state_changed",
  "resource_state_changed",
  "planner_soft_overflow",
  "manifest_hard_limit_rejected",
  "repair_wait_violated",
  "reconciliation_recovered_work",
  "invariant_violated",
  "idempotent_acceptance_replayed"
]);

export interface UnifiedAdaptiveEvent {
  readonly type: UnifiedAdaptiveEventType;
  readonly occurredAt: string;
  readonly reason?: UnifiedDecisionReason;
}

export function createUnifiedAdaptiveEvent(
  input: UnifiedAdaptiveEvent
): UnifiedAdaptiveEvent {
  if (!EVENT_TYPES.has(input.type)) {
    throw new TypeError("unified_adaptive_event_type_invalid");
  }
  if (!Number.isFinite(new Date(input.occurredAt).getTime())) {
    throw new TypeError("unified_adaptive_event_clock_invalid");
  }
  return Object.freeze({ ...input });
}

export function emitBestEffort(
  sink: ((event: UnifiedAdaptiveEvent) => void) | undefined,
  event: UnifiedAdaptiveEvent
): void {
  try {
    sink?.(event);
  } catch {
    // ponytail: telemetry stays outside correctness; an out-of-process
    // durable channel is the upgrade path if best-effort delivery stops fitting.
  }
}

export interface UnifiedAdaptiveAggregateSnapshot {
  readonly version: "unified-adaptive-aggregate-v1";
  readonly provider: {
    readonly capacityLimit: number;
    readonly readyDemand: number;
    readonly targetActiveSlots: number;
    readonly actualActiveSlots: number;
    readonly healthyGroups: number;
    readonly cooldownGroups: number;
    readonly circuitOpenGroups: number;
    readonly rolling60sRequests: number;
    readonly rolling60sRps: number;
    readonly requestsTotal: number;
    readonly errorsTotal: number;
    readonly rateLimited429Total: number;
  };
  readonly runtime: {
    readonly state: RuntimeResourceState;
    readonly limitingReason: UnifiedDecisionReason | null;
  };
  readonly memory: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly availableMemoryBytes: number;
  };
  readonly database: {
    readonly poolWaiting: number;
    readonly latencyMs: number;
  };
  readonly checkpointLatencyMs: number;
  readonly planner: {
    readonly durableBacklog: number;
    readonly admitted: number;
    readonly leased: number;
    readonly ready: number;
    readonly committed: number;
  };
  readonly buffer: {
    readonly readyCount: number;
    readonly readyBytes: number;
    readonly reservedBytes: number;
  };
  readonly canonicalHeadAgeMs: number | null;
  readonly repair: {
    readonly minimumSlots: number;
    readonly actualSlots: number;
    readonly waitViolations: number;
  };
  readonly reconciliation: {
    readonly actionableTicks: number;
  };
}

export function createUnifiedAdaptiveSnapshotPublisher(
  exporter?: (snapshot: UnifiedAdaptiveAggregateSnapshot) => void
): {
  publish(snapshot: UnifiedAdaptiveAggregateSnapshot): void;
  current(): UnifiedAdaptiveAggregateSnapshot | null;
} {
  let latest: UnifiedAdaptiveAggregateSnapshot | null = null;
  return {
    publish(snapshot) {
      latest = snapshot;
      try {
        exporter?.(snapshot);
      } catch {
        // ponytail: the in-process latest snapshot remains available when an
        // exporter fails; durable delivery is the upgrade path.
      }
    },
    current() {
      return latest;
    }
  };
}

export async function runUnifiedAdaptiveSnapshotPublication<TStorage, TSnapshot>(
  input: {
    load(): Promise<TStorage>;
    build(storage: TStorage): TSnapshot;
    publish(snapshot: TSnapshot): void;
    warn(error: unknown): void;
  }
): Promise<void> {
  try {
    input.publish(input.build(await input.load()));
  } catch (error) {
    try {
      input.warn(error);
    } catch {
      // ponytail: monitoring failure reporting cannot affect controller work.
    }
  }
}

export type UnifiedPacingSlotIdentity = {
  readonly runId: string;
  readonly slotId: number;
  readonly epoch: number;
};

export type UnifiedPacingObserver = UnifiedPacingSlotIdentity & {
  readonly requestId: number;
  readonly scope: "unified";
};

export function createUnifiedPacingTracker(maxTrackedRequests = 10_000): {
  paced(observer: UnifiedPacingObserver): void;
  settled(observer: UnifiedPacingObserver): void;
  isSlotPaced(slot: UnifiedPacingSlotIdentity): boolean;
} {
  if (!Number.isSafeInteger(maxTrackedRequests) || maxTrackedRequests < 1) {
    throw new TypeError("unified_pacing_tracker_limit_invalid");
  }
  const observers = new Map<string, UnifiedPacingObserver>();
  const countBySlot = new Map<string, number>();
  const slotKey = (slot: UnifiedPacingSlotIdentity) =>
    JSON.stringify([slot.runId, slot.slotId, slot.epoch]);
  const observerKey = (observer: UnifiedPacingObserver) =>
    JSON.stringify([
      observer.requestId,
      observer.runId,
      observer.slotId,
      observer.epoch
    ]);
  const settleObserver = (key: string) => {
    const observer = observers.get(key);
    if (observer === undefined) return;
    observers.delete(key);
    const keyForSlot = slotKey(observer);
    const remaining = (countBySlot.get(keyForSlot) ?? 1) - 1;
    if (remaining === 0) countBySlot.delete(keyForSlot);
    else countBySlot.set(keyForSlot, remaining);
  };
  return {
    paced(observer) {
      if (
        !Number.isSafeInteger(observer.requestId) ||
        observer.requestId < 0 ||
        observer.runId.length === 0 ||
        !Number.isSafeInteger(observer.slotId) ||
        observer.slotId < 0 ||
        !Number.isSafeInteger(observer.epoch) ||
        observer.epoch < 0
      ) {
        return;
      }
      const key = observerKey(observer);
      if (observers.has(key)) return;
      while (observers.size >= maxTrackedRequests) {
        const oldest = observers.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        settleObserver(oldest);
      }
      observers.set(key, observer);
      const keyForSlot = slotKey(observer);
      countBySlot.set(
        keyForSlot,
        (countBySlot.get(keyForSlot) ?? 0) + 1
      );
    },
    settled: (observer) => settleObserver(observerKey(observer)),
    isSlotPaced: (slot) => (countBySlot.get(slotKey(slot)) ?? 0) > 0
  };
}

export type UnifiedAdaptiveAggregateInput = Omit<
  UnifiedAdaptiveAggregateSnapshot,
  "version" | "provider" | "reconciliation"
> & {
  readonly nowMs: number;
  readonly provider: Omit<
    UnifiedAdaptiveAggregateSnapshot["provider"],
    | "rolling60sRequests"
    | "rolling60sRps"
    | "requestsTotal"
    | "errorsTotal"
    | "rateLimited429Total"
  >;
};

export type UnifiedProviderRequestOutcome =
  | "success"
  | "error"
  | "rate_limited_429";

export function classifyUnifiedProviderRequestOutcome(
  error: unknown
): UnifiedProviderRequestOutcome {
  if (error === null || error === undefined) return "success";
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (Number(record.status ?? record.statusCode) === 429) {
      return "rate_limited_429";
    }
  }
  if (error instanceof Error && /\b429\b/u.test(error.message)) {
    return "rate_limited_429";
  }
  return "error";
}

type RequestBucket = {
  second: number;
  requests: number;
};

const REQUEST_WINDOW_SECONDS = 60;

export function createUnifiedAdaptiveObservability(): {
  recordProviderDispatch(atMs: number): void;
  recordProviderOutcome(outcome: UnifiedProviderRequestOutcome): void;
  recordProviderRequest(input: {
    readonly atMs: number;
    readonly outcome: UnifiedProviderRequestOutcome;
  }): void;
  recordReconciliation(input: {
    readonly actionableWorkFound: boolean;
  }): void;
  snapshot(
    input: UnifiedAdaptiveAggregateInput
  ): UnifiedAdaptiveAggregateSnapshot;
} {
  const buckets: RequestBucket[] = Array.from(
    { length: REQUEST_WINDOW_SECONDS },
    () => ({ second: -1, requests: 0 })
  );
  let requestsTotal = 0;
  let errorsTotal = 0;
  let rateLimited429Total = 0;
  let actionableTicks = 0;

  return {
    recordProviderDispatch(atMs) {
      if (!Number.isFinite(atMs) || atMs < 0) {
        throw new TypeError("unified_provider_request_clock_invalid");
      }
      const second = Math.floor(atMs / 1_000);
      const bucket = buckets[second % REQUEST_WINDOW_SECONDS]!;
      if (bucket.second !== second) {
        bucket.second = second;
        bucket.requests = 0;
      }
      bucket.requests += 1;
      requestsTotal += 1;
    },
    recordProviderOutcome(outcome) {
      if (outcome !== "success") errorsTotal += 1;
      if (outcome === "rate_limited_429") rateLimited429Total += 1;
    },
    recordProviderRequest({ atMs, outcome }) {
      this.recordProviderDispatch(atMs);
      this.recordProviderOutcome(outcome);
    },
    recordReconciliation({ actionableWorkFound }) {
      if (actionableWorkFound) actionableTicks += 1;
    },
    snapshot(input) {
      if (!Number.isFinite(input.nowMs) || input.nowMs < 0) {
        throw new TypeError("unified_adaptive_snapshot_clock_invalid");
      }
      const currentSecond = Math.floor(input.nowMs / 1_000);
      const oldestSecond = currentSecond - REQUEST_WINDOW_SECONDS + 1;
      const rolling60sRequests = buckets.reduce(
        (sum, bucket) => sum + (
          bucket.second >= oldestSecond && bucket.second <= currentSecond
            ? bucket.requests
            : 0
        ),
        0
      );
      return {
        version: "unified-adaptive-aggregate-v1",
        provider: {
          ...input.provider,
          rolling60sRequests,
          rolling60sRps: rolling60sRequests / REQUEST_WINDOW_SECONDS,
          requestsTotal,
          errorsTotal,
          rateLimited429Total
        },
        runtime: input.runtime,
        memory: input.memory,
        database: input.database,
        checkpointLatencyMs: input.checkpointLatencyMs,
        planner: input.planner,
        buffer: input.buffer,
        canonicalHeadAgeMs: input.canonicalHeadAgeMs,
        repair: input.repair,
        reconciliation: { actionableTicks }
      };
    }
  };
}
