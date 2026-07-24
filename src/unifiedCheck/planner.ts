export type UnifiedPlannerState = "planned" | "ready" | "committed";

export interface UnifiedOrderedTaskIdentity {
  readonly taskId: string;
  readonly kind: string;
  readonly logicalKey: string;
}

export interface UnifiedPlannerPrefixEntry {
  readonly canonicalSequence: number;
  readonly plannerState: UnifiedPlannerState;
  readonly resultBytes: number | null;
}

export interface UnifiedPlannerDiscoveryIdentity
  extends UnifiedOrderedTaskIdentity {
  readonly parentCanonicalSequence: number;
}

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function taskField(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorCode);
  }
  return value;
}

function identityKey(task: UnifiedOrderedTaskIdentity): string {
  return JSON.stringify([task.kind, task.logicalKey]);
}

export function canonicalOrderedTasks(
  tasks: readonly UnifiedOrderedTaskIdentity[]
): UnifiedOrderedTaskIdentity[] {
  const byIdentity = new Map<string, UnifiedOrderedTaskIdentity>();
  for (const task of tasks) {
    taskField(task.taskId, "unified_planner_task_id_invalid");
    taskField(task.kind, "unified_planner_kind_invalid");
    taskField(task.logicalKey, "unified_planner_logical_key_invalid");
    const identity = identityKey(task);
    const existing = byIdentity.get(identity);
    if (existing && existing.taskId !== task.taskId) {
      throw new TypeError("unified_planner_task_identity_conflict");
    }
    if (!existing) byIdentity.set(identity, task);
  }
  return [...byIdentity.values()].sort((left, right) =>
    compareCodeUnits(left.kind, right.kind) ||
    compareCodeUnits(left.logicalKey, right.logicalKey)
  );
}

export function canonicalOrderedTaskDiscoveries<
  T extends UnifiedPlannerDiscoveryIdentity
>(tasks: readonly T[]): T[] {
  const byIdentity = new Map<string, T>();
  for (const task of tasks) {
    if (
      !Number.isSafeInteger(task.parentCanonicalSequence) ||
      task.parentCanonicalSequence < -1
    ) {
      throw new TypeError("unified_planner_parent_sequence_invalid");
    }
    taskField(task.kind, "unified_planner_kind_invalid");
    taskField(task.logicalKey, "unified_planner_logical_key_invalid");
    const identity = identityKey(task);
    const existing = byIdentity.get(identity);
    if (
      !existing ||
      task.parentCanonicalSequence < existing.parentCanonicalSequence
    ) {
      byIdentity.set(identity, task);
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.parentCanonicalSequence - right.parentCanonicalSequence ||
    left.kind.localeCompare(right.kind) ||
    left.logicalKey.localeCompare(right.logicalKey)
  );
}

export function appendUnifiedPlannerDiscovery<
  T extends UnifiedPlannerDiscoveryIdentity
>(
  lastCanonicalSequence: number | null,
  task: T
): T & UnifiedPlannerPrefixEntry {
  return {
    ...task,
    canonicalSequence: lastCanonicalSequence === null
      ? 0
      : lastCanonicalSequence + 1,
    plannerState: "planned",
    resultBytes: null
  };
}

function validPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateEntry(entry: UnifiedPlannerPrefixEntry): void {
  if (!Number.isSafeInteger(entry.canonicalSequence) || entry.canonicalSequence < 0) {
    throw new TypeError("unified_planner_sequence_invalid");
  }
  if (
    entry.resultBytes !== null &&
    (!Number.isSafeInteger(entry.resultBytes) || entry.resultBytes < 0)
  ) {
    throw new TypeError("unified_planner_result_bytes_invalid");
  }
}

export function selectBoundedReadyPrefix<T extends UnifiedPlannerPrefixEntry>(
  entries: readonly T[],
  limits: { readonly maxEntries: number; readonly maxBytes: number }
): T[] {
  if (!validPositiveSafeInteger(limits.maxEntries)) {
    throw new TypeError("unified_planner_commit_entries_invalid");
  }
  if (!validPositiveSafeInteger(limits.maxBytes)) {
    throw new TypeError("unified_planner_commit_bytes_invalid");
  }
  for (const entry of entries) validateEntry(entry);
  if (entries.length === 0) return [];

  const selected: T[] = [];
  let bytes = 0;
  let previousSequence: number | null = null;
  for (const entry of entries) {
    if (
      selected.length === limits.maxEntries ||
      entry.plannerState !== "ready" ||
      entry.resultBytes === null ||
      (previousSequence !== null && entry.canonicalSequence !== previousSequence + 1) ||
      entry.resultBytes > limits.maxBytes - bytes
    ) {
      break;
    }
    selected.push(entry);
    bytes += entry.resultBytes;
    previousSequence = entry.canonicalSequence;
  }
  return selected;
}

export function markUnifiedPlannerResultReady<
  T extends {
    readonly plannerState: unknown;
    readonly resultBytes: unknown;
  }
>(entry: T, resultBytes: number): Omit<
  T,
  "plannerState" | "resultBytes"
> & {
  readonly plannerState: "ready";
  readonly resultBytes: number;
} {
  if (entry.plannerState !== "planned" || entry.resultBytes !== null) {
    throw new TypeError("unified_ordered_planner_transition_conflict");
  }
  if (!Number.isSafeInteger(resultBytes) || resultBytes < 0) {
    throw new TypeError("unified_planner_result_bytes_invalid");
  }
  return { ...entry, plannerState: "ready", resultBytes };
}
