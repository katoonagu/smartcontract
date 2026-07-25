import { readFile } from "node:fs/promises";
import { freemem } from "node:os";
import type { ProviderGroupCapacitySnapshot } from "../tron/tronscanScheduler";
import {
  createUnifiedAdaptiveEvent,
  createUnifiedDecisionReason,
  type UnifiedAdaptiveEvent,
  type UnifiedDecisionReason
} from "./adaptiveObservability";
import type {
  UnifiedAdminRunDecision
} from "./adminRunSnapshot";
import {
  allocateProviderSlots,
  type ProviderRunDemand,
  type ProviderSlotAllocation
} from "./fairProviderAllocator";
import {
  applyProviderCapacityRamp,
  applyRuntimeResourceState,
  calculateProviderCapacityLimit,
  calculateRunLookaheadTarget,
  calculateTargetActiveProviderSlots,
  type ProviderCapacityRampState,
  type RuntimeResourceState
} from "./providerCapacityController";
import type {
  UnifiedOrderedAdmissionBlocker
} from "./plannerRepository";
import type {
  UnifiedProviderSlotAssignment,
  UnifiedProviderSlotSnapshot
} from "./providerPool";
import type { UnifiedRunPurpose } from "./contracts";
import type { UnifiedQueryable } from "./repository";
import type { UnifiedProviderClaimPermit } from "./worker";

export type UnifiedRuntimeResourceSnapshot = {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly availableMemoryBytes: number;
  readonly dbWaitingCount: number;
  readonly dbLatencyMs: number;
  readonly checkpointLatencyMs: number;
};

export type UnifiedRuntimeResourceThresholds = {
  readonly pressureAvailableMemoryBytes: number;
  readonly criticalAvailableMemoryBytes: number;
  readonly pressureRssBytes: number;
  readonly criticalRssBytes: number;
  readonly pressureDbWaitingCount: number;
  readonly criticalDbWaitingCount: number;
  readonly pressureDbLatencyMs: number;
  readonly criticalDbLatencyMs: number;
  readonly pressureCheckpointLatencyMs: number;
  readonly criticalCheckpointLatencyMs: number;
};

export function hasHealthyCapableProviderGroup(
  groups: readonly ProviderGroupCapacitySnapshot[]
): boolean {
  return groups.some((group) =>
    group.state === "healthy" &&
    Number.isSafeInteger(group.concurrencyLimit) &&
    group.concurrencyLimit > 0
  );
}

export function attributeUnifiedPacedDemand(
  demand: readonly ProviderRunDemand[],
  isPaced: (runId: string) => boolean
): ProviderRunDemand[] {
  return demand.map((item) => ({
    ...item,
    providerPaced: isPaced(item.runId)
  }));
}

export function countUnifiedActualLaneSlots(input: {
  readonly lane: ProviderRunDemand["lane"];
  readonly slotSnapshots: readonly UnifiedProviderSlotSnapshot[];
}): number {
  return input.slotSnapshots.filter((slot) =>
    slot.active && slot.activePermit?.lane === input.lane
  ).length;
}

export function createUnifiedRepairServiceTracker(input: {
  readonly repairMaxWaitChunks?: number;
  readonly onWaitViolation?: (event: UnifiedAdaptiveEvent) => void;
  readonly now?: () => Date;
} = {}): {
  updateRepairReady(ready: boolean): void;
  recordWake(): void;
  recordAllocation(lane: ProviderRunDemand["lane"]): void;
  recordClaim(lane: ProviderRunDemand["lane"]): void;
  snapshot(): {
    readonly chunksSinceLastRepair: number;
    readonly waitViolations: number;
  };
} {
  const repairMaxWaitChunks =
    input.repairMaxWaitChunks ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(repairMaxWaitChunks) ||
    repairMaxWaitChunks < 0
  ) {
    throw new TypeError("unified_repair_max_wait_chunks_invalid");
  }
  const now = input.now ?? (() => new Date());
  let repairReady = false;
  let chunksSinceLastRepair = 0;
  let waitViolations = 0;
  let violationRecordedForEpisode = false;
  const resetEpisode = () => {
    chunksSinceLastRepair = 0;
    violationRecordedForEpisode = false;
  };
  return {
    updateRepairReady(ready) {
      repairReady = ready;
      if (!ready) resetEpisode();
    },
    recordWake() {
      // Only an actual claimed chunk is service evidence.
    },
    recordAllocation() {
      // An allocation can race away before claim and is not service evidence.
    },
    recordClaim(lane) {
      if (!repairReady) return;
      if (lane === "repair") {
        resetEpisode();
      } else {
        chunksSinceLastRepair += 1;
        if (
          chunksSinceLastRepair > repairMaxWaitChunks &&
          !violationRecordedForEpisode
        ) {
          violationRecordedForEpisode = true;
          waitViolations += 1;
          try {
            input.onWaitViolation?.(createUnifiedAdaptiveEvent({
              type: "repair_wait_violated",
              occurredAt: now().toISOString(),
              reason: createUnifiedDecisionReason(
                "pool",
                "repair_reserve_reclaim"
              )
            }));
          } catch {
            // ponytail: anomaly export cannot alter the actual claim boundary.
          }
        }
      }
    },
    snapshot: () => ({ chunksSinceLastRepair, waitViolations })
  };
}

export function createUnifiedDbLatencySampler(): {
  record(latencyMs: number): void;
  sampleAndReset(): number;
} {
  let maximumMs = 0;
  return {
    record(latencyMs) {
      if (!Number.isFinite(latencyMs) || latencyMs < 0) {
        throw new TypeError("unified_db_latency_invalid");
      }
      maximumMs = Math.max(maximumMs, latencyMs);
    },
    sampleAndReset() {
      const sampled = maximumMs;
      maximumMs = 0;
      return sampled;
    }
  };
}

export const createUnifiedCheckpointLatencySampler =
  createUnifiedDbLatencySampler;

function atLeast(value: number, threshold: number): boolean {
  return Number.isFinite(value) && value >= threshold;
}

function atMost(value: number, threshold: number): boolean {
  return Number.isFinite(value) && value <= threshold;
}

export function classifyUnifiedRuntimeResources(
  snapshot: UnifiedRuntimeResourceSnapshot,
  thresholds: UnifiedRuntimeResourceThresholds
): RuntimeResourceState {
  if (
    atMost(
      snapshot.availableMemoryBytes,
      thresholds.criticalAvailableMemoryBytes
    ) ||
    atLeast(snapshot.rssBytes, thresholds.criticalRssBytes) ||
    atLeast(
      snapshot.dbWaitingCount,
      thresholds.criticalDbWaitingCount
    ) ||
    atLeast(snapshot.dbLatencyMs, thresholds.criticalDbLatencyMs) ||
    atLeast(
      snapshot.checkpointLatencyMs,
      thresholds.criticalCheckpointLatencyMs
    )
  ) return "critical";
  if (
    atMost(
      snapshot.availableMemoryBytes,
      thresholds.pressureAvailableMemoryBytes
    ) ||
    atLeast(snapshot.rssBytes, thresholds.pressureRssBytes) ||
    atLeast(
      snapshot.dbWaitingCount,
      thresholds.pressureDbWaitingCount
    ) ||
    atLeast(snapshot.dbLatencyMs, thresholds.pressureDbLatencyMs) ||
    atLeast(
      snapshot.checkpointLatencyMs,
      thresholds.pressureCheckpointLatencyMs
    )
  ) return "pressure";
  return "normal";
}

async function cgroupAvailableMemoryBytes(): Promise<number | null> {
  for (const [limitPath, usagePath] of [
    [
      "/sys/fs/cgroup/memory.max",
      "/sys/fs/cgroup/memory.current"
    ],
    [
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      "/sys/fs/cgroup/memory/memory.usage_in_bytes"
    ]
  ] as const) {
    try {
      const [rawLimit, rawUsage] = await Promise.all([
        readFile(limitPath, "utf8"),
        readFile(usagePath, "utf8")
      ]);
      if (rawLimit.trim() === "max") continue;
      const limit = Number(rawLimit.trim());
      const usage = Number(rawUsage.trim());
      if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(usage)) {
        continue;
      }
      return Math.max(0, limit - usage);
    } catch {
      // Try the other cgroup generation, then host memory.
    }
  }
  return null;
}

export async function readUnifiedRuntimeResources(input: {
  readonly dbWaitingCount?: number;
  readonly dbLatencyMs?: number;
  readonly checkpointLatencyMs?: number;
} = {}): Promise<UnifiedRuntimeResourceSnapshot> {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    availableMemoryBytes:
      await cgroupAvailableMemoryBytes() ?? freemem(),
    dbWaitingCount: Math.max(0, input.dbWaitingCount ?? 0),
    dbLatencyMs: Math.max(0, input.dbLatencyMs ?? 0),
    checkpointLatencyMs: Math.max(0, input.checkpointLatencyMs ?? 0)
  };
}

function providerEligibilitySql(requireAdmission: boolean): string {
  const plannerEligibility = requireAdmission
    ? `planner.task_id is null or (
         planner.planner_state = 'planned'
         and planner.admitted_at is not null
       )`
    : "planner.task_id is null or planner.planner_state = 'planned'";
  return `
    task.kind = any($2::text[])
    and task.accepted_attempt_id is null
    and task.cancellation_requested_at is null
    and run.status = 'RUNNING'
    and (
      (
        task.status in ('QUEUED', 'WAITING_RETRY')
        and task.ready_at <= least($1::timestamptz, statement_timestamp())
      ) or (
        task.status = 'LEASED'
        and task.lease_expires_at <= statement_timestamp()
      )
    )
    and (${plannerEligibility})
    and (
      task.kind not in ('address_history', 'deep_direct') or exists (
        select 1
          from unified_check_tasks prerequisite
         where prerequisite.run_id = task.run_id
           and prerequisite.kind = 'direct_history'
           and prerequisite.status = 'COMPLETED'
           and prerequisite.accepted_attempt_id is not null
      )
    )
    and (
      run.run_purpose <> 'release_canary' or
      clock_timestamp() < run.created_at + interval '35 minutes'
    )
    and ($3::text is null or run.run_purpose = $3)
    and (
      $4::text is null or
      manifest.artifact_json->>'runtimeCommit' = $4
    )
    and (
      run.run_purpose <> 'release_canary' or (
        $5::text is not null and exists (
          select 1
            from unified_check_requests request
            join unified_check_artifacts batch_identity
              on batch_identity.sha256 = substring(request.chat_id from 8)
             and batch_identity.kind = 'canary_batch_identity'
           where request.run_id = run.id
             and request.run_purpose = 'release_canary'
             and batch_identity.artifact_json#>>
               '{providerConfiguration,sha256}' = $5
        )
      )
    )`;
}

export async function loadUnifiedProviderRunDemand(
  db: UnifiedQueryable,
  input: {
    readonly now: Date;
    readonly providerAvailable: boolean;
    readonly readyBufferMaxEntries: number;
    readonly readyBufferMaxBytes: number;
    readonly providerKinds?: readonly string[];
    readonly runPurpose?: UnifiedRunPurpose;
    readonly runtimeCommit?: string;
    readonly providerConfigurationSha256?: string;
  }
): Promise<ProviderRunDemand[]> {
  const providerKinds = input.providerKinds ?? [
    "direct_history",
    "address_history",
    "deep_direct"
  ];
  const result = await db.query(
    `with eligible as (
       select task.id as task_id, task.run_id, task.priority_lane
         from unified_check_tasks task
         join unified_check_runs run on run.id = task.run_id
         join unified_check_artifacts manifest
           on manifest.sha256 = run.analysis_manifest_sha256
          and manifest.kind = 'analysis_manifest'
         left join unified_check_planner_entries planner
           on planner.run_id = task.run_id
          and planner.task_id = task.id
        where ${providerEligibilitySql(false)}
     ),
     per_scope as (
       select run_id, priority_lane, count(*)::bigint as ready_work
         from eligible
        group by run_id, priority_lane
     ),
     service as (
       select run_id, priority_lane,
              max(updated_at) filter (where attempt > 0) as served_at
         from unified_check_tasks
        group by run_id, priority_lane
     ),
     buffers as (
       select run_id,
              count(*) filter (where planner_state = 'ready')::bigint
                as ready_count,
              coalesce(sum(result_bytes) filter (
                where planner_state = 'ready'
              ), 0)::bigint as ready_bytes
         from unified_check_planner_entries
        where planner_state <> 'committed'
        group by run_id
     )
     select run.id as run_id, run.fairness_owner_id,
            run.run_purpose, run.side_effect_policy,
            run.admission_policy,
            run.provider_capacity_ceiling,
            per_scope.ready_work, per_scope.priority_lane,
            service.served_at,
            owner_service.owner_served_at,
            coalesce(buffers.ready_count, 0)::bigint as ready_count,
            coalesce(buffers.ready_bytes, 0)::bigint as ready_bytes,
            coalesce(head.canonical_head_eligible, false)
              as canonical_head_eligible
       from per_scope
       join unified_check_runs run on run.id = per_scope.run_id
       left join service
         on service.run_id = run.id
        and service.priority_lane = per_scope.priority_lane
       left join buffers on buffers.run_id = run.id
       left join lateral (
         select max(other_service.served_at) as owner_served_at
           from unified_check_runs other_run
           left join service other_service on other_service.run_id = other_run.id
          where other_run.fairness_owner_id = run.fairness_owner_id
       ) owner_service on true
       left join lateral (
         select exists (
           select 1 from eligible
            where eligible.task_id = planner.task_id
              and eligible.priority_lane = per_scope.priority_lane
         ) as canonical_head_eligible
           from unified_check_planner_entries planner
          where planner.run_id = run.id
            and planner.planner_state <> 'committed'
          order by planner.canonical_sequence
          limit 1
       ) head on true
      order by run.fairness_owner_id, run.id,
               case per_scope.priority_lane
                 when 'repair' then 0
                 when 'interactive' then 1
                 else 2
               end`,
    [
      input.now,
      providerKinds,
      input.runPurpose ?? null,
      input.runtimeCommit ?? null,
      input.providerConfigurationSha256 ?? null
    ]
  );
  return result.rows.map((row) => {
    const lane = String(row.priority_lane);
    if (!["interactive", "repair", "background"].includes(lane)) {
      throw new Error("unified_provider_demand_lane_invalid");
    }
    const readyCount = Number(row.ready_count);
    const readyBytes = Number(row.ready_bytes);
    const servedAtMs = row.served_at
      ? new Date(String(row.served_at)).getTime()
      : 0;
    const ownerServedAtMs = row.owner_served_at
      ? new Date(String(row.owner_served_at)).getTime()
      : 0;
    return {
      runId: String(row.run_id),
      ownerId: String(row.fairness_owner_id),
      lane: lane as ProviderRunDemand["lane"],
      runPurpose: String(row.run_purpose) as
        NonNullable<ProviderRunDemand["runPurpose"]>,
      sideEffectPolicy: String(row.side_effect_policy) as
        NonNullable<ProviderRunDemand["sideEffectPolicy"]>,
      admissionPolicy:
        String(row.admission_policy) === "rolling"
          ? "rolling"
          : "barrier",
      providerCapacityCeiling: Number(row.provider_capacity_ceiling),
      eligibleReadyWork: Number(row.ready_work),
      ownerLastServedAtMs: Number.isFinite(ownerServedAtMs)
        ? ownerServedAtMs
        : 0,
      lastServedAtMs: Number.isFinite(servedAtMs) ? servedAtMs : 0,
      mergeBufferFull:
        readyCount >= input.readyBufferMaxEntries ||
        readyBytes >= input.readyBufferMaxBytes,
      providerAvailable: input.providerAvailable,
      resourceGuarded: false,
      canonicalHeadEligible: row.canonical_head_eligible === true
    };
  });
}

export async function loadUnifiedAdaptiveStorageSnapshot(
  db: UnifiedQueryable,
  input: Date | {
    readonly now: Date;
    readonly runtimeCommit?: string;
    readonly providerConfigurationSha256?: string;
  }
): Promise<{
  planner: {
    durableBacklog: number;
    admitted: number;
    leased: number;
    ready: number;
    committed: number;
  };
  buffer: {
    readyCount: number;
    readyBytes: number;
    reservedBytes: number;
  };
  canonicalHeadAgeMs: number | null;
}> {
  const snapshot = input instanceof Date ? { now: input } : input;
  const row = (await db.query(
    `with active_runs as materialized (
       select run.id
         from unified_check_runs run
        where run.status = 'RUNNING'
          and (
            $2::text is null or exists (
              select 1
                from unified_check_artifacts manifest
               where manifest.sha256 = run.analysis_manifest_sha256
                 and manifest.kind = 'analysis_manifest'
                 and manifest.artifact_json->>'runtimeCommit' = $2
            )
          )
          and (
            run.run_purpose <> 'release_canary' or (
              $3::text is not null and exists (
                select 1
                  from unified_check_requests request
                  join unified_check_artifacts batch_identity
                    on batch_identity.sha256 = substring(request.chat_id from 8)
                   and batch_identity.kind = 'canary_batch_identity'
                 where request.run_id = run.id
                   and request.run_purpose = 'release_canary'
                   and batch_identity.artifact_json#>>
                     '{providerConfiguration,sha256}' = $3
              )
            )
          )
     )
     select
       count(*) filter (
         where entry.planner_state = 'planned'
           and entry.admitted_at is null
       )::bigint
         as durable_backlog,
       count(*) filter (
         where entry.planner_state = 'planned'
           and entry.admitted_at is not null
       )::bigint
         as admitted,
       count(*) filter (where task.status = 'LEASED')::bigint as leased,
       count(*) filter (where entry.planner_state = 'ready')::bigint as ready,
       count(*) filter (where entry.planner_state = 'committed')::bigint
         as committed,
       coalesce(sum(entry.result_bytes) filter (
         where entry.planner_state = 'ready'
       ), 0)::bigint as ready_bytes,
       coalesce(sum(entry.reserved_bytes) filter (
         where entry.planner_state = 'planned'
       ), 0)::bigint as reserved_bytes,
       extract(epoch from ($1::timestamptz - min(entry.planned_at) filter (
         where entry.planner_state <> 'committed'
       ))) * 1000 as canonical_head_age_ms
     from active_runs run
     join unified_check_planner_entries entry on entry.run_id = run.id
    join unified_check_tasks task
       on task.run_id = entry.run_id and task.id = entry.task_id
    where task.cancellation_requested_at is null`,
    [
      snapshot.now,
      snapshot.runtimeCommit ?? null,
      snapshot.providerConfigurationSha256 ?? null
    ]
  )).rows[0] ?? {};
  const count = (value: unknown, code: string): number => {
    const parsed = Number(value ?? 0);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
    return parsed;
  };
  const age = row.canonical_head_age_ms === null ||
    row.canonical_head_age_ms === undefined
    ? null
    : Math.max(0, Number(row.canonical_head_age_ms));
  if (age !== null && !Number.isFinite(age)) {
    throw new Error("unified_canonical_head_age_invalid");
  }
  const ready = count(row.ready, "unified_planner_ready_invalid");
  return {
    planner: {
      durableBacklog: count(
        row.durable_backlog,
        "unified_planner_backlog_invalid"
      ),
      admitted: count(row.admitted, "unified_planner_admitted_invalid"),
      leased: count(row.leased, "unified_planner_leased_invalid"),
      ready,
      committed: count(row.committed, "unified_planner_committed_invalid")
    },
    buffer: {
      readyCount: ready,
      readyBytes: count(
        row.ready_bytes,
        "unified_planner_ready_bytes_invalid"
      ),
      reservedBytes: count(
        row.reserved_bytes,
        "unified_planner_reserved_bytes_invalid"
      )
    },
    canonicalHeadAgeMs: age
  };
}

export async function countUnifiedActionableProviderWork(
  db: UnifiedQueryable,
  input: {
    readonly now: Date;
    readonly providerKinds?: readonly string[];
    readonly scopes: readonly {
      readonly runId: string;
      readonly lane: ProviderRunDemand["lane"];
    }[];
    readonly runPurpose?: UnifiedRunPurpose;
    readonly runtimeCommit?: string;
    readonly providerConfigurationSha256?: string;
  }
): Promise<UnifiedActionableProviderScope[]> {
  if (input.scopes.length === 0) return [];
  const providerKinds = input.providerKinds ?? [
    "direct_history",
    "address_history",
    "deep_direct"
  ];
  const result = await db.query(
    `select task.run_id, task.priority_lane,
            count(*)::bigint as actionable
       from unified_check_tasks task
       join unified_check_runs run on run.id = task.run_id
       join unified_check_artifacts manifest
         on manifest.sha256 = run.analysis_manifest_sha256
        and manifest.kind = 'analysis_manifest'
       left join unified_check_planner_entries planner
         on planner.run_id = task.run_id and planner.task_id = task.id
       join unnest($6::text[], $7::text[]) scope(run_id, priority_lane)
         on scope.run_id = task.run_id
        and scope.priority_lane = task.priority_lane
      where ${providerEligibilitySql(true)}
      group by task.run_id, task.priority_lane`,
    [
      input.now,
      providerKinds,
      input.runPurpose ?? null,
      input.runtimeCommit ?? null,
      input.providerConfigurationSha256 ?? null,
      input.scopes.map((scope) => scope.runId),
      input.scopes.map((scope) => scope.lane)
    ]
  );
  return result.rows.map((row) => {
    const count = Number(row.actionable);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("unified_actionable_provider_work_invalid");
    }
    return {
      runId: String(row.run_id),
      lane: String(row.priority_lane) as ProviderRunDemand["lane"],
      count
    };
  });
}

export type UnifiedAdaptiveControllerConfig = {
  readonly configuredProviderConcurrencyLimit: number;
  readonly providerWorkerLimit: number;
  readonly providerIncreaseStep: number;
  readonly providerIncreaseIntervalMs: number;
  readonly analysisConcurrencyLimit: number;
  readonly finalizationConcurrencyLimit: number;
  readonly admissionPolicy: "barrier" | "rolling";
  readonly lookaheadFactor: number;
  readonly perRunLookaheadMaximum: number;
  readonly readyBufferMaxEntries: number;
  readonly readyBufferMaxBytes: number;
  readonly reservedBufferMaxBytes: number;
  readonly reservationBytesPerTask: number;
  readonly repairShare: number;
  readonly repairMaxSlots: number;
  readonly repairMaxWaitChunks: number;
  readonly chunksSinceLastRepair: number;
};

type RefillResult = {
  readonly admittedTaskIds: readonly string[];
  readonly deAdmittedTaskIds: readonly string[];
  readonly blocker: UnifiedOrderedAdmissionBlocker | null;
};

export type UnifiedActionableProviderScope = {
  readonly runId: string;
  readonly lane: ProviderRunDemand["lane"];
  readonly count: number;
};

export type UnifiedAdaptiveControllerDecision = {
  readonly runtimeState: RuntimeResourceState;
  readonly limitingReason: UnifiedDecisionReason | null;
  readonly providerCapacityLimit: number;
  readonly eligibleReadyProviderWork: number;
  readonly targetActiveProviderSlots: number;
  readonly actualActiveProviderSlots: number;
  readonly actionableProviderSlots: number;
  readonly claimPermits: readonly UnifiedProviderClaimPermit[];
  readonly claimAssignments: readonly UnifiedProviderSlotAssignment[];
  readonly analysisConcurrencyLimit: number;
  readonly finalizationConcurrencyLimit: number;
  readonly allocations: ProviderSlotAllocation[];
  readonly runDecisions: readonly UnifiedAdminRunDecision[];
  readonly rampState: ProviderCapacityRampState;
  readonly admitted: number;
  readonly deAdmitted: number;
};

function resourceLimitingReason(
  snapshot: UnifiedRuntimeResourceSnapshot,
  thresholds: UnifiedRuntimeResourceThresholds,
  state: RuntimeResourceState
): UnifiedDecisionReason | null {
  if (state === "normal") return null;
  const critical = state === "critical";
  const availableMemoryThreshold = critical
    ? thresholds.criticalAvailableMemoryBytes
    : thresholds.pressureAvailableMemoryBytes;
  const rssThreshold = critical
    ? thresholds.criticalRssBytes
    : thresholds.pressureRssBytes;
  if (
    snapshot.availableMemoryBytes <= availableMemoryThreshold ||
    snapshot.rssBytes >= rssThreshold
  ) {
    return createUnifiedDecisionReason("pool", "memory_pressure");
  }
  const dbWaitingThreshold = critical
    ? thresholds.criticalDbWaitingCount
    : thresholds.pressureDbWaitingCount;
  const dbLatencyThreshold = critical
    ? thresholds.criticalDbLatencyMs
    : thresholds.pressureDbLatencyMs;
  if (
    snapshot.dbWaitingCount >= dbWaitingThreshold ||
    snapshot.dbLatencyMs >= dbLatencyThreshold
  ) {
    return createUnifiedDecisionReason("pool", "db_pressure");
  }
  return createUnifiedDecisionReason("pool", "class_capacity_limit");
}

export async function runUnifiedAdaptiveControllerCycle(input: {
  readonly nowMs: number;
  readonly rampState: ProviderCapacityRampState;
  readonly providerGroups: readonly ProviderGroupCapacitySnapshot[];
  readonly resources: UnifiedRuntimeResourceSnapshot;
  readonly thresholds: UnifiedRuntimeResourceThresholds;
  readonly config: UnifiedAdaptiveControllerConfig;
  readonly demand: readonly ProviderRunDemand[];
  readonly providerSlots?: readonly UnifiedProviderSlotSnapshot[];
  isProviderSlotPaced?(slot: {
    readonly runId: string;
    readonly slotId: number;
    readonly epoch: number;
  }): boolean;
  refill(input: {
    readonly runId: string;
    readonly policy: "barrier" | "rolling";
    readonly lookaheadTarget: number;
    readonly readyBufferMaxEntries: number;
    readonly readyBufferMaxBytes: number;
    readonly reservedBufferMaxBytes: number;
    readonly reservationBytesPerTask: number;
    readonly now: Date;
  }): Promise<RefillResult>;
  countActionableProviderWork?(
    scopes: readonly {
      readonly runId: string;
      readonly lane: ProviderRunDemand["lane"];
    }[]
  ): Promise<readonly UnifiedActionableProviderScope[]>;
  assignProviderPermits?(
    assignments: readonly UnifiedProviderSlotAssignment[]
  ): void;
  setPoolTarget(target: number): void;
  wakePool(): void;
  onDecision?(decision: UnifiedAdaptiveControllerDecision): void;
}): Promise<UnifiedAdaptiveControllerDecision> {
  const runtimeState = classifyUnifiedRuntimeResources(
    input.resources,
    input.thresholds
  );
  const guarded = applyRuntimeResourceState({
    state: runtimeState,
    providerGuardLimit: input.config.providerWorkerLimit,
    analysisConcurrencyLimit: input.config.analysisConcurrencyLimit,
    finalizationConcurrencyLimit: input.config.finalizationConcurrencyLimit
  });
  const healthyIndependentGroupConcurrency = input.providerGroups
    .filter((group) => group.state === "healthy")
    .reduce((sum, group) => sum + group.concurrencyLimit, 0);
  const providerCapacityLimit = calculateProviderCapacityLimit({
    healthyIndependentGroupConcurrency,
    configuredProviderConcurrencyLimit:
      input.config.configuredProviderConcurrencyLimit,
    providerWorkerLimit: input.config.providerWorkerLimit,
    dbAndMemoryGuardLimit: guarded.providerGuardLimit
  });
  const eligibleReadyProviderWork = input.demand.reduce(
    (sum, run) => sum + (
      run.eligibleReadyWork > 0 &&
      run.providerAvailable &&
      !run.resourceGuarded &&
      (!run.mergeBufferFull || run.canonicalHeadEligible)
        ? run.eligibleReadyWork
        : 0
    ),
    0
  );
  const activeProviderSlots = (input.providerSlots ?? []).filter((slot) =>
    slot.active && slot.activePermit !== null
  );
  const rampState = applyProviderCapacityRamp({
    state: input.rampState,
    capacityLimit: providerCapacityLimit,
    nowMs: input.nowMs,
    increaseStep: input.config.providerIncreaseStep,
    increaseIntervalMs: input.config.providerIncreaseIntervalMs
  });
  const targetActiveProviderSlots = calculateTargetActiveProviderSlots({
    providerCapacityLimit: rampState.target,
    eligibleReadyProviderWork:
      eligibleReadyProviderWork + activeProviderSlots.length
  });
  const allocations = allocateProviderSlots({
    capacity: targetActiveProviderSlots,
    runs: input.demand,
    occupied: activeProviderSlots.map((slot) => ({
      runId: slot.activePermit!.runId,
      ownerId: slot.activePermit!.ownerId,
      lane: slot.activePermit!.lane
    })),
    repair: {
      repairShare: input.config.repairShare,
      repairMaxSlots: input.config.repairMaxSlots,
      repairMaxWaitChunks: input.config.repairMaxWaitChunks,
      chunksSinceLastRepair: input.config.chunksSinceLastRepair
    }
  });

  let admitted = 0;
  let deAdmitted = 0;
  const providerShareByRun = new Map<string, number>();
  const activeSlotsByRun = new Map<string, number>();
  const activeSlotIdentitiesByRun =
    new Map<string, UnifiedProviderSlotSnapshot[]>();
  for (const slot of activeProviderSlots) {
    const runId = slot.activePermit!.runId;
    activeSlotsByRun.set(runId, (activeSlotsByRun.get(runId) ?? 0) + 1);
    activeSlotIdentitiesByRun.set(runId, [
      ...(activeSlotIdentitiesByRun.get(runId) ?? []),
      slot
    ]);
    providerShareByRun.set(
      runId,
      (providerShareByRun.get(runId) ?? 0) + 1
    );
  }
  for (const allocation of allocations) {
    providerShareByRun.set(
      allocation.runId,
      (providerShareByRun.get(allocation.runId) ?? 0) + allocation.slots
    );
  }
  const firstDemandByRun = new Map<string, ProviderRunDemand>();
  const decisionIdentityByRun = new Map<string, {
    readonly runId: string;
    readonly ownerId: string;
    readonly lane: ProviderRunDemand["lane"];
  }>();
  const lookaheadByRun = new Map<string, number>();
  const refillByRun = new Map<string, RefillResult>();
  for (const run of input.demand) {
    if (!firstDemandByRun.has(run.runId)) {
      firstDemandByRun.set(run.runId, run);
      decisionIdentityByRun.set(run.runId, run);
    }
  }
  for (const slot of activeProviderSlots) {
    const permit = slot.activePermit!;
    if (!decisionIdentityByRun.has(permit.runId)) {
      decisionIdentityByRun.set(permit.runId, permit);
    }
  }
  for (const run of firstDemandByRun.values()) {
    const fairProviderShare = providerShareByRun.get(run.runId) ?? 0;
    const lookaheadTarget = fairProviderShare > 0
      ? calculateRunLookaheadTarget({
          providerCapacity: targetActiveProviderSlots,
          fairProviderShare,
          configuredLookaheadFactor: input.config.lookaheadFactor,
          configuredPerRunMaximum: input.config.perRunLookaheadMaximum
        })
      : 0;
    const result = await input.refill({
      runId: run.runId,
      policy: run.admissionPolicy ?? input.config.admissionPolicy,
      lookaheadTarget,
      readyBufferMaxEntries: input.config.readyBufferMaxEntries,
      readyBufferMaxBytes: input.config.readyBufferMaxBytes,
      reservedBufferMaxBytes: input.config.reservedBufferMaxBytes,
      reservationBytesPerTask: input.config.reservationBytesPerTask,
      now: new Date(input.nowMs)
    });
    lookaheadByRun.set(run.runId, lookaheadTarget);
    refillByRun.set(run.runId, result);
    admitted += result.admittedTaskIds.length;
    deAdmitted += result.deAdmittedTaskIds.length;
  }

  const allocationScopes = allocations
    .filter((allocation) => allocation.slots > 0)
    .map((allocation) => ({
      runId: allocation.runId,
      lane: allocation.lane
    }));
  const actionable = input.countActionableProviderWork
    ? await input.countActionableProviderWork(allocationScopes)
    : allocationScopes.map((scope) => ({
        ...scope,
        count: allocations.find((allocation) =>
          allocation.runId === scope.runId
        )?.slots ?? 0
      }));
  const actionableByScope = new Map(actionable.map((scope) => [
    JSON.stringify([scope.runId, scope.lane]),
    Math.max(0, Math.floor(scope.count))
  ]));
  const claimPermits: UnifiedProviderClaimPermit[] = [];
  for (const allocation of allocations) {
    if (allocation.slots <= 0) continue;
    const run = input.demand.find((candidate) =>
      candidate.runId === allocation.runId &&
      candidate.ownerId === allocation.ownerId &&
      candidate.lane === allocation.lane
    );
    if (!run) throw new Error("unified_allocation_demand_missing");
    const count = Math.min(
      allocation.slots,
      actionableByScope.get(JSON.stringify([run.runId, run.lane])) ?? 0
    );
    for (let slot = 0; slot < count; slot += 1) {
      claimPermits.push(Object.freeze({
        lane: run.lane,
        ownerId: run.ownerId,
        runId: run.runId,
        canonicalHeadPreferred: allocation.canonicalHeadPreferred
      }));
    }
  }
  const idleSlots = input.providerSlots
    ? input.providerSlots
        .filter((slot) => !slot.active)
        .sort((left, right) => left.slotId - right.slotId)
    : claimPermits.map((_permit, slotId) => ({
        slotId,
        epoch: 0,
        active: false,
        activePermit: null
      }));
  const claimAssignments = claimPermits
    .slice(0, idleSlots.length)
    .map((permit, index): UnifiedProviderSlotAssignment => ({
      slotId: idleSlots[index]!.slotId,
      expectedEpoch: idleSlots[index]!.epoch,
      permit
    }));
  const actionableProviderSlots =
    activeProviderSlots.length + claimAssignments.length;
  input.assignProviderPermits?.(claimAssignments);
  input.setPoolTarget(Math.min(
    targetActiveProviderSlots,
    actionableProviderSlots
  ));
  if (admitted > 0) {
    try {
      input.wakePool();
    } catch {
      // ponytail: wake is an optimization; durable admission is the authority.
    }
  }
  const resourceReason = resourceLimitingReason(
    input.resources,
    input.thresholds,
    runtimeState
  );
  const limitingReason = resourceReason ??
    (
      healthyIndependentGroupConcurrency === 0
        ? createUnifiedDecisionReason(
            "pool",
            input.providerGroups.some((group) => group.state === "cooldown")
              ? "provider_cooldown"
              : input.providerGroups.some((group) =>
                  group.state === "circuit_open"
                )
                ? "provider_circuit_open"
                : "class_capacity_limit"
          )
        : eligibleReadyProviderWork === 0
          ? createUnifiedDecisionReason("pool", "no_eligible_work")
          : actionableProviderSlots < targetActiveProviderSlots
            ? createUnifiedDecisionReason("pool", "admission_closed")
            : rampState.target < providerCapacityLimit
              ? createUnifiedDecisionReason("pool", "class_capacity_limit")
              : null
    );
  const lanePriority: Record<ProviderRunDemand["lane"], number> = {
    interactive: 0,
    repair: 1,
    background: 2
  };
  const runDecisions = [...decisionIdentityByRun.values()].map((first) => {
    const candidates = input.demand
      .filter((item) => item.runId === first.runId)
      .sort((left, right) => lanePriority[left.lane] - lanePriority[right.lane]);
    const allocation = allocations
      .filter((item) => item.runId === first.runId)
      .sort((left, right) =>
        Number(right.slots > 0) - Number(left.slots > 0) ||
        lanePriority[left.lane] - lanePriority[right.lane]
      )[0];
    const lane = allocation?.lane ?? candidates[0]?.lane ?? first.lane;
    const activeSlots = activeSlotsByRun.get(first.runId) ?? 0;
    const assignedSlots = claimAssignments.filter((item) =>
      item.permit.runId === first.runId
    ).length;
    const allocationReason = allocation?.reason ?? "no_eligible_work";
    const refillBlocker = refillByRun.get(first.runId)?.blocker ?? null;
    const refillReason = refillBlocker === "reservation_full"
      ? "admission_closed"
      : refillBlocker === "no_provider_capacity"
        ? "class_capacity_limit"
        : refillBlocker === "no_ready_work"
          ? "no_eligible_work"
        : refillBlocker;
    const repairReclaimPending =
      lane === "repair" &&
      input.config.chunksSinceLastRepair >=
        input.config.repairMaxWaitChunks &&
      candidates.some((item) =>
        item.lane === "repair" && item.eligibleReadyWork > 0
      ) &&
      activeSlots + assignedSlots === 0 &&
      actionableProviderSlots >= targetActiveProviderSlots;
    const providerPacingStopped =
      (activeSlotIdentitiesByRun.get(first.runId) ?? []).length > 0 &&
      input.isProviderSlotPaced !== undefined &&
      (activeSlotIdentitiesByRun.get(first.runId) ?? []).every((slot) =>
        input.isProviderSlotPaced!({
          runId: first.runId,
          slotId: slot.slotId,
          epoch: slot.epoch
        })
      );
    const blocker = providerPacingStopped
      ? createUnifiedDecisionReason("run", "provider_rate_paced")
      : activeSlots + assignedSlots > 0
        ? null
      : createUnifiedDecisionReason(
          "run",
          repairReclaimPending
            ? "repair_reserve_reclaim"
            : refillReason === "canonical_head_wait" ||
              refillReason === "merge_buffer_full"
            ? refillReason
            : allocationReason === "allocated"
              ? refillReason ?? "admission_closed"
              : allocationReason
        );
    const lastServedAtMs = candidates.reduce(
      (maximum, item) => Math.max(maximum, item.lastServedAtMs),
      0
    );
    return Object.freeze({
      runId: first.runId,
      ownerId: first.ownerId,
      lane,
      fairShare: firstDemandByRun.has(first.runId)
        ? providerShareByRun.get(first.runId) ?? 0
        : 0,
      activeSlots,
      lastServedAt: lastServedAtMs > 0
        ? new Date(lastServedAtMs).toISOString()
        : null,
      lookaheadTarget: lookaheadByRun.get(first.runId) ?? 0,
      blocker
    });
  });
  const decision: UnifiedAdaptiveControllerDecision = {
    runtimeState,
    limitingReason,
    providerCapacityLimit,
    eligibleReadyProviderWork,
    targetActiveProviderSlots,
    actualActiveProviderSlots: activeProviderSlots.length,
    actionableProviderSlots,
    claimPermits,
    claimAssignments,
    analysisConcurrencyLimit: guarded.analysisConcurrencyLimit,
    finalizationConcurrencyLimit: guarded.finalizationConcurrencyLimit,
    allocations,
    runDecisions,
    rampState,
    admitted,
    deAdmitted
  };
  try {
    input.onDecision?.(decision);
  } catch {
    // ponytail: a current-snapshot observer is best-effort and replaced on the
    // next cycle; an out-of-process channel is the upgrade path.
  }
  return decision;
}
