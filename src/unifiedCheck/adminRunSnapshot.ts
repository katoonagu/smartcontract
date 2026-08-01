import type {
  UnifiedDecisionReason
} from "./adaptiveObservability";
import type {
  ProviderWorkLane
} from "./fairProviderAllocator";

export interface UnifiedAdminRunSnapshot {
  readonly ownerId: string;
  readonly lane: ProviderWorkLane;
  readonly fairShare: number;
  readonly activeSlots: number;
  readonly lastServedAt: string | null;
  readonly lookaheadTarget: number;
  readonly planner: {
    readonly durableBacklog: number;
    readonly admitted: number;
    readonly leased: number;
    readonly ready: number;
    readonly committed: number;
  };
  readonly canonicalHead: {
    readonly taskId: string;
    readonly state: string;
    readonly ageMs: number;
  } | null;
  readonly buffer: {
    readonly readyCount: number;
    readonly readyBytes: number;
    readonly reservedBytes: number;
  };
  readonly lastCommitAt: string | null;
  readonly blocker: UnifiedDecisionReason | null;
  readonly elapsedMs: number;
  readonly completedChunks: number;
  readonly throughputPerMinute: number;
}

export interface UnifiedAdminRunDurableSnapshot {
  readonly ownerId: string;
  readonly lane: ProviderWorkLane;
  readonly planner: UnifiedAdminRunSnapshot["planner"];
  readonly canonicalHead: UnifiedAdminRunSnapshot["canonicalHead"];
  readonly buffer: UnifiedAdminRunSnapshot["buffer"];
  readonly lastCommitAt: string | null;
  readonly createdAt: string;
  readonly completedChunks: number;
}

export interface UnifiedAdminRunDecision {
  readonly runId: string;
  readonly ownerId: string;
  readonly lane: ProviderWorkLane;
  readonly fairShare: number;
  readonly activeSlots: number;
  readonly lastServedAt: string | null;
  readonly lookaheadTarget: number;
  readonly blocker: UnifiedDecisionReason | null;
}

function nonNegative(value: number, code: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(code);
  return value;
}

export function projectUnifiedAdminRunSnapshot(
  durable: UnifiedAdminRunDurableSnapshot,
  decision: UnifiedAdminRunDecision | null,
  now: Date
): UnifiedAdminRunSnapshot {
  const nowMs = now.getTime();
  const createdAtMs = new Date(durable.createdAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdAtMs)) {
    throw new TypeError("unified_admin_snapshot_clock_invalid");
  }
  if (decision && decision.ownerId !== durable.ownerId) {
    throw new Error("unified_admin_snapshot_owner_mismatch");
  }
  const elapsedMs = Math.max(0, nowMs - createdAtMs);
  const completedChunks = nonNegative(
    durable.completedChunks,
    "unified_admin_snapshot_chunks_invalid"
  );
  return {
    ownerId: durable.ownerId,
    lane: decision?.lane ?? durable.lane,
    fairShare: nonNegative(
      decision?.fairShare ?? 0,
      "unified_admin_snapshot_share_invalid"
    ),
    activeSlots: nonNegative(
      decision?.activeSlots ?? 0,
      "unified_admin_snapshot_slots_invalid"
    ),
    lastServedAt: decision?.lastServedAt ?? null,
    lookaheadTarget: nonNegative(
      decision?.lookaheadTarget ?? 0,
      "unified_admin_snapshot_lookahead_invalid"
    ),
    planner: durable.planner,
    canonicalHead: durable.canonicalHead,
    buffer: durable.buffer,
    lastCommitAt: durable.lastCommitAt,
    blocker: decision?.blocker ?? null,
    elapsedMs,
    completedChunks,
    throughputPerMinute: elapsedMs === 0
      ? 0
      : completedChunks / (elapsedMs / 60_000)
  };
}

export function createUnifiedAdminRunDecisionStore(): {
  replace(decisions: readonly UnifiedAdminRunDecision[]): void;
  get(runId: string): UnifiedAdminRunDecision | null;
} {
  let current = new Map<string, UnifiedAdminRunDecision>();
  return {
    replace(decisions) {
      const replacement = new Map<string, UnifiedAdminRunDecision>();
      for (const decision of decisions) {
        if (replacement.has(decision.runId)) {
          throw new Error("unified_admin_snapshot_duplicate_run_decision");
        }
        replacement.set(decision.runId, Object.freeze({ ...decision }));
      }
      current = replacement;
    },
    get(runId) {
      return current.get(runId) ?? null;
    }
  };
}
