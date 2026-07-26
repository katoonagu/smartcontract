import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  createUnifiedRepairServiceTracker,
  runUnifiedAdaptiveControllerCycle,
  type UnifiedAdaptiveControllerConfig
} from "../../src/unifiedCheck/adaptiveRuntime";
import type { ProviderRunDemand } from "../../src/unifiedCheck/fairProviderAllocator";
import {
  canonicalOrderedDiscoveries
} from "../../src/unifiedCheck/plannerRepository";
import type { ProviderCapacityRampState } from "../../src/unifiedCheck/providerCapacityController";
import {
  createUnifiedProviderPool
} from "../../src/unifiedCheck/providerPool";
import {
  runUnifiedTaskCycle,
  type UnifiedAcceptedArtifact,
  type UnifiedProviderClaimPermit,
  type UnifiedTaskCycleRepository,
  type UnifiedWorkerTask
} from "../../src/unifiedCheck/worker";

const SEED = 0x5eed_034;
const CAPACITIES = [1, 4, 8, 16, 32, 100] as const;
const RUN_COUNTS = [1, 3, 15] as const;
const TASKS_PER_RUN = 20;
const READY_BUFFER_MAX_ENTRIES = 4;
const COMMIT_MAX_ENTRIES = 5;
const REPAIR_MAX_WAIT_CHUNKS = 2;

type PlannerState = "planned" | "ready" | "committed";

type ReplayTask = {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  plannerState: PlannerState;
  admitted: boolean;
  reservedBytes: number | null;
  resultBytes: number | null;
  readyRound: number;
  leased: boolean;
  leaseToken: string | null;
  attempt: number;
  acceptedAttemptId: string | null;
  artifactSha256: string | null;
};

type ReplayRun = {
  readonly runId: string;
  readonly ownerId: string;
  readonly lane: "interactive" | "repair";
  lastServedAtMs: number;
  ownerLastServedAtMs: number;
  readonly tasks: ReplayTask[];
  readonly committedArtifactHashes: string[];
};

type ReplaySnapshot = {
  readonly runs: ReplayRun[];
  slowHeadCheckpointed: boolean;
  readonly acceptedTaskIds: string[];
};

function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function invariant(
  condition: unknown,
  label: string,
  capacity: number,
  runCount: number
): asserts condition {
  if (!condition) {
    throw new Error(
      `provider_scale_simulation_failed seed=${SEED} capacity=${capacity} runs=${runCount} invariant=${label}`
    );
  }
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function artifactFor(task: ReplayTask) {
  return {
    version: "unified-provider-scale-replay-v1",
    runId: task.runId,
    canonicalSequence: task.sequence
  };
}

function createRun(
  runId: string,
  ownerId: string,
  lane: ReplayRun["lane"],
  random: () => number,
  taskCount = TASKS_PER_RUN
): ReplayRun {
  const ordered = canonicalOrderedDiscoveries(shuffle(
    Array.from({ length: taskCount }, (_, sourceSequence) => ({
      parentCanonicalSequence: -1,
      taskId: `${runId}-ordered-${sourceSequence}`,
      kind: "provider_ordered",
      logicalKey: `key-${sourceSequence}`,
      priorityLane: lane,
      checkpoint: { sourceSequence }
    })),
    random
  ));
  return {
    runId,
    ownerId,
    lane,
    lastServedAtMs: 0,
    ownerLastServedAtMs: 0,
    tasks: ordered.map((planned, sequence) => ({
      id: planned.taskId,
      runId,
      sequence,
      plannerState: "planned" as const,
      admitted: false,
      reservedBytes: null,
      resultBytes: null,
      readyRound: 0,
      leased: false,
      leaseToken: null,
      attempt: 0,
      acceptedAttemptId: null,
      artifactSha256: null
    })),
    committedArtifactHashes: []
  };
}

function cloneSnapshot(snapshot: ReplaySnapshot): ReplaySnapshot {
  return structuredClone(snapshot);
}

class SeededProviderReplay implements UnifiedTaskCycleRepository {
  private snapshot: ReplaySnapshot;
  round = 0;
  maxReadyBuffer = 0;
  maxReservedBytes = 0;

  constructor(snapshot: ReplaySnapshot) {
    this.snapshot = snapshot;
  }

  restart(): SeededProviderReplay {
    const restarted = new SeededProviderReplay(cloneSnapshot(this.snapshot));
    restarted.round = this.round;
    restarted.maxReadyBuffer = this.maxReadyBuffer;
    restarted.maxReservedBytes = this.maxReservedBytes;
    return restarted;
  }

  durableSnapshot(): ReplaySnapshot {
    return cloneSnapshot(this.snapshot);
  }

  runs(): readonly ReplayRun[] {
    return this.snapshot.runs;
  }

  demand(): ProviderRunDemand[] {
    return this.snapshot.runs.flatMap((run) => {
      const eligible = run.tasks.filter((task) =>
        task.plannerState === "planned" &&
        task.readyRound <= this.round
      );
      if (eligible.length === 0) return [];
      const head = run.tasks.find((task) => task.plannerState !== "committed");
      const readyCount = run.tasks.filter((task) =>
        task.plannerState === "ready"
      ).length;
      return [{
        runId: run.runId,
        ownerId: run.ownerId,
        lane: run.lane,
        eligibleReadyWork: eligible.length,
        ownerLastServedAtMs: run.ownerLastServedAtMs,
        lastServedAtMs: run.lastServedAtMs,
        mergeBufferFull: readyCount >= READY_BUFFER_MAX_ENTRIES,
        providerAvailable: true,
        resourceGuarded: false,
        canonicalHeadEligible:
          head?.plannerState === "planned" &&
          head.readyRound <= this.round
      }];
    });
  }

  refill(input: {
    readonly runId: string;
    readonly lookaheadTarget: number;
    readonly reservedBufferMaxBytes: number;
    readonly reservationBytesPerTask: number;
  }) {
    const run = this.snapshot.runs.find((item) => item.runId === input.runId);
    if (!run) throw new Error("scale_replay_run_missing");
    const admittedTaskIds: string[] = [];
    const deAdmittedTaskIds: string[] = [];
    const admittedPlanned = () => run.tasks.filter((task) =>
      task.plannerState === "planned" && task.admitted
    );
    const removable = [...admittedPlanned()]
      .filter((task) => !task.leased)
      .sort((left, right) => right.sequence - left.sequence);
    while (admittedPlanned().length > input.lookaheadTarget) {
      const task = removable.shift();
      if (!task) break;
      task.admitted = false;
      task.reservedBytes = null;
      deAdmittedTaskIds.push(task.id);
    }

    const readyCount = run.tasks.filter((task) =>
      task.plannerState === "ready"
    ).length;
    const head = run.tasks.find((task) => task.plannerState !== "committed");
    const candidates = run.tasks.filter((task) =>
      task.plannerState === "planned" &&
      !task.admitted &&
      task.readyRound <= this.round &&
      (
        readyCount < READY_BUFFER_MAX_ENTRIES ||
        task.id === head?.id
      )
    );
    let reserved = admittedPlanned().reduce(
      (sum, task) => sum + (task.reservedBytes ?? 0),
      0
    );
    for (const task of candidates) {
      if (admittedPlanned().length >= input.lookaheadTarget) break;
      if (
        reserved + input.reservationBytesPerTask >
        input.reservedBufferMaxBytes
      ) break;
      task.admitted = true;
      task.reservedBytes = input.reservationBytesPerTask;
      admittedTaskIds.push(task.id);
      reserved += input.reservationBytesPerTask;
    }
    this.maxReservedBytes = Math.max(this.maxReservedBytes, reserved);
    return Promise.resolve({
      admittedTaskIds,
      deAdmittedTaskIds,
      blocker: admittedTaskIds.length === 0 && input.lookaheadTarget > 0
        ? readyCount >= READY_BUFFER_MAX_ENTRIES
          ? "merge_buffer_full" as const
          : "no_ready_work" as const
        : null
    });
  }

  actionable(scopes: readonly {
    readonly runId: string;
    readonly lane: ProviderRunDemand["lane"];
  }[]) {
    return scopes.map((scope) => {
      const run = this.snapshot.runs.find((item) =>
        item.runId === scope.runId && item.lane === scope.lane
      );
      return {
        ...scope,
        count: run?.tasks.filter((task) =>
          task.plannerState === "planned" &&
          task.admitted &&
          !task.leased &&
          task.readyRound <= this.round
        ).length ?? 0
      };
    });
  }

  async claim(input: {
    workerId: string;
    leaseToken: string;
    leaseMs: number;
    permit?: UnifiedProviderClaimPermit;
  }): Promise<UnifiedWorkerTask | null> {
    const permit = input.permit;
    if (!permit) return null;
    const run = this.snapshot.runs.find((item) =>
      item.runId === permit.runId &&
      item.ownerId === permit.ownerId &&
      item.lane === permit.lane
    );
    if (!run) return null;
    const head = run.tasks.find((task) => task.plannerState !== "committed");
    const task = run.tasks
      .filter((candidate) =>
        candidate.plannerState === "planned" &&
        candidate.admitted &&
        !candidate.leased &&
        candidate.readyRound <= this.round
      )
      .sort((left, right) =>
        Number(right.id === head?.id) - Number(left.id === head?.id) ||
        left.sequence - right.sequence
      )[0];
    if (!task) return null;
    task.leased = true;
    task.leaseToken = input.leaseToken;
    task.attempt += 1;
    run.lastServedAtMs = this.round + 1;
    for (const ownerRun of this.snapshot.runs) {
      if (ownerRun.ownerId === run.ownerId) {
        ownerRun.ownerLastServedAtMs = this.round + 1;
      }
    }
    return {
      id: task.id,
      runId: task.runId,
      kind: "provider_ordered",
      logicalKey: `key-${task.sequence}`,
      priorityLane: run.lane,
      attempt: task.attempt,
      checkpoint: { canonicalSequence: task.sequence },
      cancellationRequestedAt: null
    };
  }

  async heartbeat(input: {
    taskId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const task = this.task(input.taskId);
    return task?.leased === true && task.leaseToken === input.leaseToken;
  }

  async checkpoint(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
  }): Promise<{
    readonly checkpointed: boolean;
    readonly providerWorkAvailable: boolean;
  }> {
    const task = this.task(input.taskId);
    if (
      !task ||
      !task.leased ||
      task.leaseToken !== input.leaseToken ||
      task.attempt !== input.attempt
    ) {
      return { checkpointed: false, providerWorkAvailable: false };
    }
    task.leased = false;
    task.leaseToken = null;
    task.readyRound = this.round + 1;
    this.snapshot.slowHeadCheckpointed = true;
    return { checkpointed: true, providerWorkAvailable: true };
  }

  async complete(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    acceptedArtifact?: UnifiedAcceptedArtifact;
  }): Promise<boolean> {
    const task = this.task(input.taskId);
    if (
      !task ||
      !task.leased ||
      task.leaseToken !== input.leaseToken ||
      task.attempt !== input.attempt ||
      !input.acceptedArtifact
    ) return false;
    const expected = artifactFor(task);
    if (
      canonicalizeArtifactJson(input.acceptedArtifact.value) !==
        canonicalizeArtifactJson(expected) ||
      fingerprintCanonicalArtifact(input.acceptedArtifact.value) !==
        input.artifactSha256 ||
      this.snapshot.acceptedTaskIds.includes(task.id)
    ) return false;
    task.leased = false;
    task.leaseToken = null;
    task.plannerState = "ready";
    task.reservedBytes = null;
    task.resultBytes = Buffer.byteLength(
      canonicalizeArtifactJson(input.acceptedArtifact.value),
      "utf8"
    );
    task.acceptedAttemptId = input.attemptId;
    task.artifactSha256 = input.artifactSha256;
    this.snapshot.acceptedTaskIds.push(task.id);
    this.maxReadyBuffer = Math.max(
      this.maxReadyBuffer,
      this.snapshot.runs.find((run) => run.runId === task.runId)!.tasks
        .filter((candidate) => candidate.plannerState === "ready").length
    );
    return true;
  }

  async settle(input: {
    taskId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const task = this.task(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) return false;
    task.leased = false;
    task.leaseToken = null;
    return true;
  }

  commitReadyPrefixes(): void {
    for (const run of this.snapshot.runs) {
      let committed = 0;
      while (committed < COMMIT_MAX_ENTRIES) {
        const head = run.tasks.find((task) =>
          task.plannerState !== "committed"
        );
        if (!head || head.plannerState !== "ready") break;
        if (
          head.acceptedAttemptId === null ||
          head.artifactSha256 === null ||
          head.resultBytes === null
        ) throw new Error("scale_replay_ready_identity_missing");
        head.plannerState = "committed";
        run.committedArtifactHashes.push(head.artifactSha256);
        committed += 1;
      }
    }
  }

  allInteractiveCommitted(): boolean {
    return this.snapshot.runs
      .filter((run) => run.lane === "interactive")
      .every((run) => run.tasks.every((task) =>
        task.plannerState === "committed"
      ));
  }

  private task(taskId: string): ReplayTask | undefined {
    return this.snapshot.runs
      .flatMap((run) => run.tasks)
      .find((task) => task.id === taskId);
  }
}

const resources = {
  rssBytes: 100,
  heapUsedBytes: 50,
  availableMemoryBytes: 10_000,
  dbWaitingCount: 0,
  dbLatencyMs: 1,
  checkpointLatencyMs: 1
};

const thresholds = {
  pressureAvailableMemoryBytes: 1_000,
  criticalAvailableMemoryBytes: 100,
  pressureRssBytes: 10_000,
  criticalRssBytes: 20_000,
  pressureDbWaitingCount: 10,
  criticalDbWaitingCount: 20,
  pressureDbLatencyMs: 100,
  criticalDbLatencyMs: 200,
  pressureCheckpointLatencyMs: 100,
  criticalCheckpointLatencyMs: 200
};

function config(
  capacity: number,
  chunksSinceLastRepair: number
): UnifiedAdaptiveControllerConfig {
  return {
    configuredProviderConcurrencyLimit: capacity,
    providerWorkerLimit: capacity,
    providerIncreaseStep: capacity,
    providerIncreaseIntervalMs: 1,
    analysisConcurrencyLimit: 2,
    finalizationConcurrencyLimit: 2,
    admissionPolicy: "rolling",
    lookaheadFactor: 2,
    perRunLookaheadMaximum: 100,
    readyBufferMaxEntries: READY_BUFFER_MAX_ENTRIES,
    readyBufferMaxBytes: 1_000_000,
    reservedBufferMaxBytes: 1_000,
    reservationBytesPerTask: 10,
    repairShare: 0.1,
    repairMaxSlots: 4,
    repairMaxWaitChunks: REPAIR_MAX_WAIT_CHUNKS,
    chunksSinceLastRepair
  };
}

async function runReplay(capacity: number, runCount: number) {
  const random = randomFrom(SEED + capacity * 101 + runCount);
  let replay = new SeededProviderReplay({
    runs: [
      ...Array.from({ length: runCount }, (_, index) => createRun(
        `run-${index}`,
        `owner-${index % Math.max(1, Math.ceil(runCount / 2))}`,
        "interactive",
        random
      )),
      createRun("repair-run", "repair-owner", "repair", random, 20)
    ],
    slowHeadCheckpointed: false,
    acceptedTaskIds: []
  });
  const repairTracker = createUnifiedRepairServiceTracker();
  let rampState: ProviderCapacityRampState = {
    target: capacity,
    lastIncreaseAtMs: 0
  };
  let restartIdentity: string | null = null;
  let permitCounter = 0;
  const maxRounds = runCount * TASKS_PER_RUN + 100;

  for (let round = 0; round < maxRounds; round += 1) {
    replay.round = round;
    const repairReady = round >= 2 && replay.runs()
      .find((run) => run.runId === "repair-run")!.tasks
      .some((task) => task.plannerState !== "committed");
    repairTracker.updateRepairReady(repairReady);
    const demand = replay.demand().filter((run) =>
      run.runId !== "repair-run" || round >= 2
    );
    let permits: readonly UnifiedProviderClaimPermit[] = [];
    let poolTarget = -1;
    const healthyCapacity = round === 5
      ? Math.max(0, capacity - 1)
      : capacity;
    const result = await runUnifiedAdaptiveControllerCycle({
      nowMs: round + 1,
      rampState,
      providerGroups: Array.from({ length: capacity }, (_, index) => ({
        groupId: `group-${index}`,
        state: index < healthyCapacity ? "healthy" as const : "cooldown" as const,
        concurrencyLimit: 1,
        inFlight: 0,
        cooldownUntil: index < healthyCapacity
          ? null
          : round + 2
      })),
      resources,
      thresholds,
      config: config(
        capacity,
        repairTracker.snapshot().chunksSinceLastRepair
      ),
      demand,
      refill: (input) => replay.refill(input),
      countActionableProviderWork: (scopes) =>
        Promise.resolve(replay.actionable(scopes)),
      assignProviderPermits(next) {
        permits = next.map((assignment) => assignment.permit);
        return { accepted: next, rejected: [] };
      },
      setPoolTarget(target) {
        poolTarget = target;
      },
      wakePool() {
        // Durable admissions are synchronously visible to this replay.
      }
    });
    rampState = result.rampState;
    invariant(
      result.providerCapacityLimit === healthyCapacity,
      "capacity_follows_group_health",
      capacity,
      runCount
    );
    invariant(
      poolTarget === permits.length &&
        result.actionableProviderSlots === permits.length &&
        permits.length <= healthyCapacity,
      "actionable_permit_bound",
      capacity,
      runCount
    );

    const repairPermits = permits.filter((permit) => permit.lane === "repair");
    const interactivePermits = shuffle(
      permits.filter((permit) => permit.lane !== "repair"),
      random
    );
    let repairClaimedThisWave = false;
    for (const permit of [...repairPermits, ...interactivePermits]) {
      const cycle = await runUnifiedTaskCycle({
        workerId: `logical-slot-${permitCounter}`,
        now: () => new Date(round + 1),
        leaseMs: 30_000,
        repository: replay,
        claimPermit: permit,
        createId: () => `scale-id-${permitCounter++}`,
        handlers: {
          async provider_ordered({ task }) {
            const sequence = Number(
              (task.checkpoint as { canonicalSequence: number })
                .canonicalSequence
            );
            if (
              task.runId === "run-0" &&
              sequence === 0 &&
              !replay.durableSnapshot().slowHeadCheckpointed
            ) {
              return {
                kind: "checkpoint" as const,
                checkpoint: { canonicalSequence: sequence, workUnits: 1 }
              };
            }
            const modelTask = replay.runs()
              .find((run) => run.runId === task.runId)!.tasks[sequence]!;
            const artifact = artifactFor(modelTask);
            return {
              kind: "completed" as const,
              artifactSha256: fingerprintCanonicalArtifact(artifact),
              acceptedArtifact: {
                kind: "provider_manifest",
                schemaVersion: "1",
                value: artifact
              }
            };
          }
        }
      });
      if (cycle.claimed) {
        repairTracker.recordClaim(cycle.priorityLane ?? "interactive");
        repairClaimedThisWave ||= cycle.priorityLane === "repair";
      }
    }
    replay.commitReadyPrefixes();
    invariant(
      capacity !== 1 ||
        repairTracker.snapshot().chunksSinceLastRepair <=
          REPAIR_MAX_WAIT_CHUNKS,
      "capacity_one_repair_wait_bound",
      capacity,
      runCount
    );
    invariant(
      capacity === 1 ||
        !demand.some((run) =>
          run.lane === "repair" &&
          run.eligibleReadyWork > 0 &&
          (!run.mergeBufferFull || run.canonicalHeadEligible)
        ) ||
        healthyCapacity === 0 ||
        repairClaimedThisWave,
      "repair_minimum_served_per_parallel_wave",
      capacity,
      runCount
    );
    const acceptedTaskIds = replay.durableSnapshot().acceptedTaskIds;
    invariant(
      new Set(acceptedTaskIds).size === acceptedTaskIds.length,
      "global_duplicate_acceptance",
      capacity,
      runCount
    );
    invariant(
      replay.maxReservedBytes <= 1_000,
      "reservation_bound",
      capacity,
      runCount
    );
    invariant(
      replay.maxReadyBuffer <= READY_BUFFER_MAX_ENTRIES + capacity,
      "soft_overflow_bound",
      capacity,
      runCount
    );

    if (round === 2) {
      const before = replay.durableSnapshot();
      restartIdentity = fingerprintCanonicalArtifact(before);
      const restarted = replay.restart();
      invariant(
        fingerprintCanonicalArtifact(restarted.durableSnapshot()) ===
          restartIdentity,
        "restart_durable_identity",
        capacity,
        runCount
      );
      replay = restarted;
    }
    if (replay.allInteractiveCommitted()) break;
  }

  invariant(
    replay.allInteractiveCommitted(),
    "interactive_completion",
    capacity,
    runCount
  );
  invariant(
    replay.durableSnapshot().slowHeadCheckpointed,
    "slow_head_checkpoint_exercised",
    capacity,
    runCount
  );
  invariant(
    restartIdentity !== null,
    "restart_exercised",
    capacity,
    runCount
  );
  for (const run of replay.runs().filter((item) =>
    item.lane === "interactive"
  )) {
    invariant(
      run.committedArtifactHashes.length === TASKS_PER_RUN &&
        new Set(run.committedArtifactHashes).size === TASKS_PER_RUN,
      `exactly_once_commit:${run.runId}`,
      capacity,
      runCount
    );
  }
  return fingerprintCanonicalArtifact(
    replay.runs()
      .filter((run) => run.lane === "interactive")
      .map((run) => ({
        runId: run.runId,
        committedArtifactHashes: run.committedArtifactHashes
      }))
  );
}

describe("deterministic provider scale replay", () => {
  it("refills one stale epoch at logical capacity 100 without duplicate or starved permits", async () => {
    let releaseActive!: (value: { claimed: boolean }) => void;
    const active = new Promise<{ claimed: boolean }>((resolve) => {
      releaseActive = resolve;
    });
    let bumpingEpoch = true;
    const pool = createUnifiedProviderPool({
      configuredLimit: 100,
      requiresPermit: true,
      yieldAfterClaim: true,
      runCycle: async () => {
        if (bumpingEpoch) {
          bumpingEpoch = false;
          return { claimed: false };
        }
        return active;
      },
      onError(error) {
        throw error;
      }
    });
    const staleSnapshot = pool.slotSnapshots();
    pool.assignPermits([{
      slotId: 0,
      expectedEpoch: 0,
      permit: {
        runId: "epoch-bump",
        ownerId: "epoch-bump",
        lane: "interactive",
        canonicalHeadPreferred: false
      }
    }]);
    pool.setTargetSlots(1);
    pool.wake();
    await pool.waitForIdle();

    const targets: number[] = [];
    const requestControllerWake = vi.fn();
    let rampState: ProviderCapacityRampState = {
      target: 100,
      lastIncreaseAtMs: 0
    };
    const demand = Array.from({ length: 100 }, (_unused, index) => ({
      runId: `run-${index}`,
      ownerId: `owner-${index}`,
      lane: "interactive" as const,
      eligibleReadyWork: 1,
      ownerLastServedAtMs: 0,
      lastServedAtMs: 0,
      mergeBufferFull: false,
      providerAvailable: true,
      resourceGuarded: false,
      canonicalHeadEligible: true
    }));
    const cycle = async (
      providerSlots: ReturnType<typeof pool.slotSnapshots>
    ) => {
      const result = await runUnifiedAdaptiveControllerCycle({
        nowMs: 1,
        rampState,
        providerGroups: Array.from({ length: 100 }, (_unused, index) => ({
          groupId: `group-${index}`,
          state: "healthy" as const,
          concurrencyLimit: 1,
          inFlight: 0,
          cooldownUntil: null
        })),
        resources,
        thresholds,
        config: config(100, 0),
        providerSlots,
        demand,
        refill: async () => ({
          admittedTaskIds: [],
          deAdmittedTaskIds: [],
          blocker: null
        }),
        assignProviderPermits: (assignments) =>
          pool.assignPermits(assignments),
        setPoolTarget(target) {
          targets.push(target);
          pool.setTargetSlots(target);
        },
        wakePool: () => pool.wake(),
        requestControllerWake
      });
      rampState = result.rampState;
      expect(result.acceptedClaimAssignments.length).toBeLessThanOrEqual(100);
      return result;
    };

    const stale = await cycle(staleSnapshot);
    expect(stale.acceptedClaimAssignments).toHaveLength(99);
    expect(stale.assignmentResult.rejected).toEqual([
      expect.objectContaining({ reason: "stale_epoch" })
    ]);
    expect(stale.actionableProviderSlots).toBe(99);
    expect(pool.snapshot()).toMatchObject({
      targetSlots: 99,
      activeSlots: 99
    });
    expect(pool.slotSnapshots()[99]).toMatchObject({
      active: true,
      activePermit: expect.any(Object)
    });
    expect(stale.acceptedClaimAssignments.every((assignment) =>
      pool.slotSnapshots()[assignment.slotId]?.activePermit ===
        assignment.permit
    )).toBe(true);
    expect(requestControllerWake).toHaveBeenCalledOnce();
    const fresh = await cycle(pool.slotSnapshots());
    expect(fresh.acceptedClaimAssignments).toHaveLength(1);
    expect(fresh.actionableProviderSlots).toBe(100);
    expect(targets).toEqual([99, 100]);
    expect(pool.snapshot()).toMatchObject({
      targetSlots: 100,
      activeSlots: 100
    });
    expect(new Set(pool.slotSnapshots().map((slot) =>
      slot.activePermit?.runId
    )).size).toBe(100);
    expect(requestControllerWake).toHaveBeenCalledOnce();

    releaseActive({ claimed: false });
    await pool.waitForIdle();
  });

  it("uses the real controller and worker claim lifecycle through capacity, cooldown, repair, buffer and restart scenarios", async () => {
    const baselines = new Map<number, string>();
    for (const capacity of CAPACITIES) {
      for (const runCount of RUN_COUNTS) {
        const replayHash = await runReplay(capacity, runCount);
        const baseline = baselines.get(runCount);
        if (baseline === undefined) {
          baselines.set(runCount, replayHash);
        } else {
          invariant(
            replayHash === baseline,
            "capacity_independent_canonical_hash",
            capacity,
            runCount
          );
        }
      }
    }
  }, 30_000);
});
