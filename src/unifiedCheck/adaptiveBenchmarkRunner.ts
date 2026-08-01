import {
  runUnifiedAdaptiveControllerCycle,
  type UnifiedAdaptiveControllerConfig
} from "./adaptiveRuntime";
import type { UnifiedDecisionReason } from "./adaptiveObservability";
import type { ProviderRunDemand } from "./fairProviderAllocator";
import type { ProviderCapacityRampState } from "./providerCapacityController";
import type { UnifiedProviderClaimPermit } from "./worker";

export type UnifiedAdaptiveBenchmarkEventPlan = {
  readonly capacity: number;
  readonly seed: number;
  readonly runs: readonly {
    readonly runId: string;
    readonly ownerId: string;
    readonly lane: ProviderRunDemand["lane"];
    readonly activeAtRound: number;
    readonly requests: readonly {
      readonly id: string;
      readonly requestIdentity: string;
    }[];
  }[];
  readonly cooldownAtRound: number | null;
  readonly cooldownCountsAs429?: boolean;
  readonly restartAtRound: number | null;
  readonly slowCanonicalHead: boolean;
  readonly commitEveryRounds: number;
};

export type UnifiedAdaptiveBenchmarkRunnerEvent = {
  readonly type:
    | "controller_cycle"
    | "provider_replay"
    | "provider_429"
    | "checkpoint"
    | "restart"
    | "reconciliation"
    | "buffer_ready"
    | "buffer_commit";
  readonly round: number;
  readonly runId?: string;
  readonly taskId?: string;
};

type MutableTask = {
  readonly id: string;
  readonly requestIdentity: string;
  state: "planned" | "ready" | "committed";
  admitted: boolean;
  readyAtRound: number;
  reservedBytes: number;
  resultBytes: number;
};

type MutableRun = {
  readonly runId: string;
  readonly ownerId: string;
  readonly lane: ProviderRunDemand["lane"];
  readonly activeAtRound: number;
  lastServedAtMs: number;
  ownerLastServedAtMs: number;
  tasks: MutableTask[];
};

const resources = {
  rssBytes: 1,
  heapUsedBytes: 1,
  availableMemoryBytes: 1_000_000_000,
  dbWaitingCount: 0,
  dbLatencyMs: 0,
  checkpointLatencyMs: 0
};

const thresholds = {
  pressureAvailableMemoryBytes: 100_000,
  criticalAvailableMemoryBytes: 10_000,
  pressureRssBytes: 2_000_000_000,
  criticalRssBytes: 3_000_000_000,
  pressureDbWaitingCount: 10,
  criticalDbWaitingCount: 20,
  pressureDbLatencyMs: 100,
  criticalDbLatencyMs: 200,
  pressureCheckpointLatencyMs: 100,
  criticalCheckpointLatencyMs: 200
};

const READY_BUFFER_MAX_ENTRIES = 4;
const READY_BUFFER_MAX_BYTES = 4 * 1024 * 1024;
const RESERVED_BUFFER_MAX_BYTES = 16 * 1024 * 1024;
const RESERVATION_BYTES_PER_TASK = 4_096;

function controllerConfig(
  capacity: number,
  chunksSinceLastRepair: number
): UnifiedAdaptiveControllerConfig {
  return {
    configuredProviderConcurrencyLimit: capacity,
    providerWorkerLimit: capacity,
    providerIncreaseStep: capacity,
    providerIncreaseIntervalMs: 1,
    analysisConcurrencyLimit: 1,
    finalizationConcurrencyLimit: 1,
    admissionPolicy: "rolling",
    lookaheadFactor: 2,
    perRunLookaheadMaximum: 100,
    readyBufferMaxEntries: READY_BUFFER_MAX_ENTRIES,
    readyBufferMaxBytes: READY_BUFFER_MAX_BYTES,
    reservedBufferMaxBytes: RESERVED_BUFFER_MAX_BYTES,
    reservationBytesPerTask: RESERVATION_BYTES_PER_TASK,
    repairShare: 0.1,
    repairMaxSlots: Math.max(1, capacity),
    repairMaxWaitChunks: 1,
    chunksSinceLastRepair
  };
}

function validatePlan(plan: UnifiedAdaptiveBenchmarkEventPlan): void {
  if (
    !Number.isSafeInteger(plan.capacity) ||
    plan.capacity < 1 ||
    !Number.isSafeInteger(plan.seed) ||
    plan.seed < 1 ||
    !Number.isSafeInteger(plan.commitEveryRounds) ||
    plan.commitEveryRounds < 1 ||
    plan.runs.length < 1 ||
    plan.runs.some((run) =>
      run.runId.length === 0 ||
      run.ownerId.length === 0 ||
      !Number.isSafeInteger(run.activeAtRound) ||
      run.activeAtRound < 0 ||
      run.requests.length < 1
    )
  ) {
    throw new TypeError("unified_benchmark_event_plan_invalid");
  }
  const taskIds = plan.runs.flatMap((run) =>
    run.requests.map((request) => request.id)
  );
  if (
    new Set(taskIds).size !== taskIds.length ||
    plan.runs.some((run) => run.requests.some((request) =>
      request.id.length === 0 || request.requestIdentity.length === 0
    ))
  ) {
    throw new TypeError("unified_benchmark_event_plan_invalid");
  }
}

function asRuns(
  plan: UnifiedAdaptiveBenchmarkEventPlan
): MutableRun[] {
  return plan.runs.map((run) => ({
    runId: run.runId,
    ownerId: run.ownerId,
    lane: run.lane,
    activeAtRound: run.activeAtRound,
    lastServedAtMs: 0,
    ownerLastServedAtMs: 0,
    tasks: run.requests.map((request) => ({
      ...request,
      state: "planned",
      admitted: false,
      readyAtRound: run.activeAtRound,
      reservedBytes: 0,
      resultBytes: 0
    }))
  }));
}

function readyMetrics(runs: readonly MutableRun[]): {
  readonly entries: number;
  readonly bytes: number;
} {
  const ready = runs.flatMap((run) =>
    run.tasks.filter((task) => task.state === "ready")
  );
  return {
    entries: ready.length,
    bytes: ready.reduce((sum, task) => sum + task.resultBytes, 0)
  };
}

function reservedBytes(runs: readonly MutableRun[]): number {
  return runs.flatMap((run) => run.tasks).reduce(
    (sum, task) => sum + task.reservedBytes,
    0
  );
}

function allCommitted(runs: readonly MutableRun[]): boolean {
  return runs.every((run) =>
    run.tasks.every((task) => task.state === "committed")
  );
}

export async function runUnifiedAdaptiveBenchmarkEvents(input: {
  readonly plan: UnifiedAdaptiveBenchmarkEventPlan;
  readonly runControllerCycle?: typeof runUnifiedAdaptiveControllerCycle;
  executeReplay(requestIdentity: string): Promise<{
    readonly responseBytes: number;
  }>;
}): Promise<{
  readonly capacity: {
    readonly eligibleDemand: number;
    readonly targetSlots: number;
    readonly actualSlots: number;
    readonly utilization: number;
  };
  readonly provider: {
    readonly requests: number;
    readonly errors: number;
    readonly rateLimited429: number;
  };
  readonly limiting: {
    readonly reason: UnifiedDecisionReason | null;
    readonly canonicalHeadAgeMs: number | null;
  };
  readonly buffer: {
    readonly readyBytes: number;
    readonly reservedBytes: number;
  };
  readonly repair: {
    readonly maxWaitMs: number;
    readonly maxWaitChunks: number;
  };
  readonly reuse: {
    readonly providerCacheHits: number;
    readonly networkFetches: number;
    readonly addressManifestReuses: number;
    readonly addressHistoryReplaysAvoided: number;
  };
  readonly restartRecovery: {
    readonly restartCount: number;
    readonly recoveryMs: number;
    readonly reconciliationRecoveries: number;
    readonly duplicateCommits: number;
    readonly duplicateSequences: number;
  };
  readonly events: readonly UnifiedAdaptiveBenchmarkRunnerEvent[];
}> {
  validatePlan(input.plan);
  let runs = asRuns(input.plan);
  const events: UnifiedAdaptiveBenchmarkRunnerEvent[] = [];
  const committedTaskIds = new Set<string>();
  const seenRequestIdentities = new Set<string>();
  let rampState: ProviderCapacityRampState = {
    target: input.plan.capacity,
    lastIncreaseAtMs: 0
  };
  let slowHeadCheckpointed = false;
  let cooldownRecorded = false;
  let restartCount = 0;
  let reconciliationRecoveries = 0;
  let recoveryMs = 0;
  let duplicateCommits = 0;
  let duplicateSequences = 0;
  let providerRequests = 0;
  let providerErrors = 0;
  let rateLimited429 = 0;
  let maxEligibleDemand = 0;
  let maxTargetSlots = 0;
  let maxActualSlots = 0;
  let maxReadyBytes = 0;
  let maxReservedBytes = 0;
  let limitingReason: UnifiedDecisionReason | null = null;
  let canonicalHeadAgeMs: number | null = null;
  let providerCacheHits = 0;
  let addressManifestReuses = 0;
  let addressHistoryReplaysAvoided = 0;
  let repairReadyAtRound: number | null = null;
  let repairFirstServedAtRound: number | null = null;
  let chunksSinceLastRepair = 0;
  let maxRepairWaitChunks = 0;
  const maximumRounds = Math.max(
    32,
    runs.reduce((sum, run) => sum + run.tasks.length, 0) * 8
  );

  for (let round = 0; round < maximumRounds; round += 1) {
    if (
      input.plan.restartAtRound === round &&
      restartCount === 0
    ) {
      const recoverable = runs.flatMap((run) => run.tasks).filter((task) =>
        task.state !== "committed"
      ).length;
      runs = structuredClone(runs);
      restartCount += 1;
      recoveryMs += 1;
      events.push({ type: "restart", round });
      if (recoverable > 0) {
        reconciliationRecoveries += 1;
        events.push({ type: "reconciliation", round });
      }
    }

    const activeRuns = runs.filter((run) => run.activeAtRound <= round);
    const repairRun = activeRuns.find((run) =>
      run.lane === "repair" &&
      run.tasks.some((task) => task.state !== "committed")
    );
    if (repairRun && repairReadyAtRound === null) {
      repairReadyAtRound = round;
    }
    const demand: ProviderRunDemand[] = activeRuns.flatMap((run) => {
      const planned = run.tasks.filter((task) =>
        task.state === "planned" && task.readyAtRound <= round
      );
      if (planned.length === 0) return [];
      const ready = run.tasks.filter((task) => task.state === "ready");
      const head = run.tasks.find((task) => task.state !== "committed");
      return [{
        runId: run.runId,
        ownerId: run.ownerId,
        lane: run.lane,
        eligibleReadyWork: planned.length,
        ownerLastServedAtMs: run.ownerLastServedAtMs,
        lastServedAtMs: run.lastServedAtMs,
        mergeBufferFull: ready.length >= READY_BUFFER_MAX_ENTRIES,
        providerAvailable: true,
        resourceGuarded: false,
        canonicalHeadEligible:
          head?.state === "planned" && head.readyAtRound <= round
      }];
    });

    const isCooldownRound =
      input.plan.cooldownAtRound === round && !cooldownRecorded;
    if (isCooldownRound && input.plan.cooldownCountsAs429 !== false) {
      cooldownRecorded = true;
      providerRequests += 1;
      providerErrors += 1;
      rateLimited429 += 1;
      limitingReason = { scope: "run", code: "provider_cooldown" };
      events.push({ type: "provider_429", round });
    }
    let permits: readonly UnifiedProviderClaimPermit[] = [];
    const decision = await (
      input.runControllerCycle ?? runUnifiedAdaptiveControllerCycle
    )({
      nowMs: round + 1,
      rampState,
      providerGroups: Array.from(
        { length: input.plan.capacity },
        (_, index) => ({
          groupId: `benchmark-group-${index + 1}`,
          state: isCooldownRound && index === 0
            ? "cooldown" as const
            : "healthy" as const,
          concurrencyLimit: 1,
          inFlight: 0,
          cooldownUntil: isCooldownRound ? round + 2 : null
        })
      ),
      resources,
      thresholds,
      config: controllerConfig(
        input.plan.capacity,
        chunksSinceLastRepair
      ),
      demand,
      refill: async (refill) => {
        const run = runs.find((candidate) =>
          candidate.runId === refill.runId
        );
        if (!run) throw new Error("unified_benchmark_event_run_missing");
        const admittedTaskIds: string[] = [];
        const deAdmittedTaskIds: string[] = [];
        const admitted = () => run.tasks.filter((task) =>
          task.state === "planned" && task.admitted
        );
        const removable = [...admitted()].sort((left, right) =>
          right.id.localeCompare(left.id)
        );
        while (admitted().length > refill.lookaheadTarget) {
          const task = removable.shift();
          if (!task) break;
          task.admitted = false;
          task.reservedBytes = 0;
          deAdmittedTaskIds.push(task.id);
        }
        const ready = run.tasks.filter((task) => task.state === "ready");
        for (const task of run.tasks) {
          if (
            admitted().length >= refill.lookaheadTarget ||
            task.state !== "planned" ||
            task.admitted ||
            task.readyAtRound > round
          ) continue;
          if (
            ready.length >= refill.readyBufferMaxEntries &&
            task !== run.tasks.find((candidate) =>
              candidate.state !== "committed"
            )
          ) continue;
          if (
            reservedBytes(runs) + refill.reservationBytesPerTask >
            refill.reservedBufferMaxBytes
          ) break;
          task.admitted = true;
          task.reservedBytes = refill.reservationBytesPerTask;
          admittedTaskIds.push(task.id);
        }
        return {
          admittedTaskIds,
          deAdmittedTaskIds,
          blocker: admittedTaskIds.length === 0 &&
            refill.lookaheadTarget > 0
            ? ready.length >= refill.readyBufferMaxEntries
              ? "merge_buffer_full" as const
              : "no_ready_work" as const
            : null
        };
      },
      countActionableProviderWork: async (scopes) =>
        scopes.map((scope) => ({
          ...scope,
          count: runs.find((run) =>
            run.runId === scope.runId && run.lane === scope.lane
          )?.tasks.filter((task) =>
            task.state === "planned" &&
            task.admitted &&
            task.readyAtRound <= round
          ).length ?? 0
        })),
      assignProviderPermits(assignments) {
        permits = assignments.map((assignment) => assignment.permit);
        return { accepted: assignments, rejected: [] };
      },
      setPoolTarget() {
        // The assigned permits below are the observed pool target.
      },
      wakePool() {
        // Admissions are synchronously durable in this deterministic runner.
      }
    });
    const roundTargetLimit = Math.min(
      input.plan.capacity,
      decision.providerCapacityLimit,
      decision.eligibleReadyProviderWork
    );
    if (
      decision.targetActiveProviderSlots > roundTargetLimit ||
      permits.length > decision.targetActiveProviderSlots
    ) {
      throw new Error(
        "unified_benchmark_event_capacity_invariant"
      );
    }
    rampState = decision.rampState;
    maxEligibleDemand = Math.max(
      maxEligibleDemand,
      decision.eligibleReadyProviderWork
    );
    maxTargetSlots = Math.max(
      maxTargetSlots,
      decision.targetActiveProviderSlots
    );
    maxActualSlots = Math.max(maxActualSlots, permits.length);
    maxReservedBytes = Math.max(maxReservedBytes, reservedBytes(runs));
    events.push({ type: "controller_cycle", round });

    for (const permit of permits) {
      const run = runs.find((candidate) =>
        candidate.runId === permit.runId &&
        candidate.ownerId === permit.ownerId &&
        candidate.lane === permit.lane
      );
      const task = run?.tasks.find((candidate) =>
        candidate.state === "planned" &&
        candidate.admitted &&
        candidate.readyAtRound <= round
      );
      if (!run || !task) continue;
      if (
        input.plan.slowCanonicalHead &&
        !slowHeadCheckpointed &&
        task === run.tasks.find((candidate) =>
          candidate.state !== "committed"
        )
      ) {
        slowHeadCheckpointed = true;
        task.readyAtRound = round + 1;
        canonicalHeadAgeMs = 1;
        limitingReason ??= {
          scope: "run",
          code: "canonical_head_wait"
        };
        events.push({
          type: "checkpoint",
          round,
          runId: run.runId,
          taskId: task.id
        });
        continue;
      }
      const response = await input.executeReplay(task.requestIdentity);
      if (
        !Number.isSafeInteger(response.responseBytes) ||
        response.responseBytes < 1
      ) {
        throw new TypeError(
          "unified_benchmark_event_response_bytes_invalid"
        );
      }
      providerRequests += 1;
      if (seenRequestIdentities.has(task.requestIdentity)) {
        providerCacheHits += 1;
        addressManifestReuses += 1;
        addressHistoryReplaysAvoided += 1;
      }
      seenRequestIdentities.add(task.requestIdentity);
      task.state = "ready";
      task.admitted = false;
      task.reservedBytes = 0;
      task.resultBytes = response.responseBytes;
      run.lastServedAtMs = round + 1;
      for (const ownerRun of runs) {
        if (ownerRun.ownerId === run.ownerId) {
          ownerRun.ownerLastServedAtMs = round + 1;
        }
      }
      if (run.lane === "repair") {
        repairFirstServedAtRound ??= round;
        chunksSinceLastRepair = 0;
      } else if (repairReadyAtRound !== null) {
        chunksSinceLastRepair += 1;
        maxRepairWaitChunks = Math.max(
          maxRepairWaitChunks,
          chunksSinceLastRepair
        );
      }
      events.push({
        type: "provider_replay",
        round,
        runId: run.runId,
        taskId: task.id
      }, {
        type: "buffer_ready",
        round,
        runId: run.runId,
        taskId: task.id
      });
      maxReadyBytes = Math.max(
        maxReadyBytes,
        readyMetrics(runs).bytes
      );
    }

    if (round % input.plan.commitEveryRounds === 0) {
      for (const run of runs) {
        while (true) {
          const head = run.tasks.find((task) =>
            task.state !== "committed"
          );
          if (!head || head.state !== "ready") break;
          if (committedTaskIds.has(head.id)) {
            duplicateCommits += 1;
            duplicateSequences += 1;
          } else {
            committedTaskIds.add(head.id);
          }
          head.state = "committed";
          events.push({
            type: "buffer_commit",
            round,
            runId: run.runId,
            taskId: head.id
          });
        }
      }
    }
    if (allCommitted(runs)) {
      return {
        capacity: {
          eligibleDemand: maxEligibleDemand,
          targetSlots: maxTargetSlots,
          actualSlots: maxActualSlots,
          utilization: maxTargetSlots === 0
            ? 0
            : maxActualSlots / maxTargetSlots
        },
        provider: {
          requests: providerRequests,
          errors: providerErrors,
          rateLimited429
        },
        limiting: {
          reason: limitingReason,
          canonicalHeadAgeMs
        },
        buffer: {
          readyBytes: maxReadyBytes,
          reservedBytes: maxReservedBytes
        },
        repair: {
          maxWaitMs: repairReadyAtRound === null
            ? 0
            : Math.max(
                0,
                (repairFirstServedAtRound ?? round) - repairReadyAtRound
              ),
          maxWaitChunks: maxRepairWaitChunks
        },
        reuse: {
          providerCacheHits,
          networkFetches: 0,
          addressManifestReuses,
          addressHistoryReplaysAvoided
        },
        restartRecovery: {
          restartCount,
          recoveryMs,
          reconciliationRecoveries,
          duplicateCommits,
          duplicateSequences
        },
        events
      };
    }
  }
  throw new Error("unified_benchmark_event_runner_incomplete");
}
