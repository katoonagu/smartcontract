import { randomUUID } from "node:crypto";

export type UnifiedWorkerTask = {
  readonly id: string;
  readonly runId: string;
  readonly kind: string;
  readonly logicalKey?: string;
  readonly priorityLane?: "interactive" | "repair" | "background";
  readonly attempt: number;
  readonly canonicalSequence?: number | null;
  readonly checkpoint: unknown;
  readonly cancellationRequestedAt: string | null;
};

export type UnifiedProviderClaimPermit = Readonly<{
  lane: "interactive" | "repair" | "background";
  ownerId: string;
  runId: string;
  canonicalHeadPreferred: boolean;
}>;

export type UnifiedAcceptedArtifact = {
  readonly kind: string;
  readonly schemaVersion: string;
  readonly value: unknown;
};

export interface UnifiedProviderChunkBudget {
  readonly maxWorkUnits: number;
  readonly maxWallMs: number;
  readonly maxResponseBytes: number;
  readonly maxCheckpointBytes: number;
}

export function shouldCheckpointUnifiedProviderChunk(
  budget: UnifiedProviderChunkBudget,
  progress: {
    readonly workUnits: number;
    readonly elapsedMs: number;
    readonly responseBytes: number;
    readonly checkpointBytes: number;
  }
): boolean {
  for (const value of [
    budget.maxWorkUnits,
    budget.maxWallMs,
    budget.maxResponseBytes,
    budget.maxCheckpointBytes
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError("unified_provider_chunk_budget_invalid");
    }
  }
  if (
    !Number.isSafeInteger(progress.workUnits) ||
    progress.workUnits < 0 ||
    !Number.isFinite(progress.elapsedMs) ||
    progress.elapsedMs < 0 ||
    !Number.isSafeInteger(progress.responseBytes) ||
    progress.responseBytes < 0 ||
    !Number.isSafeInteger(progress.checkpointBytes) ||
    progress.checkpointBytes < 0
  ) {
    throw new TypeError("unified_provider_chunk_progress_invalid");
  }
  return progress.workUnits >= budget.maxWorkUnits ||
    progress.elapsedMs >= budget.maxWallMs ||
    progress.responseBytes >= budget.maxResponseBytes ||
    progress.checkpointBytes >= budget.maxCheckpointBytes;
}

export type UnifiedCompletedChunkOutcome = {
  readonly kind: "completed";
  readonly attemptId?: string;
  readonly artifactSha256: string;
  readonly acceptedArtifact?: UnifiedAcceptedArtifact;
};

export type UnifiedOrderedCommitExpectation = {
  readonly runId: string;
  readonly expectedDeltaHeadSha256: string | null;
  readonly entries: readonly {
    readonly canonicalSequence: number;
    readonly taskId: string;
    readonly logicalKey: string;
    readonly acceptedAttemptId: string;
    readonly resultBytes: number;
    readonly taskKind: string;
    readonly artifactKind: string;
    readonly artifactSchemaVersion: string;
  }[];
  readonly discoveredTasks: readonly {
    readonly parentCanonicalSequence: number;
    readonly taskId: string;
    readonly kind: string;
    readonly logicalKey: string;
    readonly priorityLane: "interactive" | "repair" | "background";
    readonly checkpoint: unknown;
  }[];
};

export type UnifiedChunkOutcome =
  | {
      kind: "checkpoint";
      checkpoint: unknown;
      orderedCommit?: UnifiedOrderedCommitExpectation;
    }
  | UnifiedCompletedChunkOutcome
  | {
      kind: "provider_wait";
      readyAt: string;
      checkpoint?: unknown;
      reason: string;
      attemptId?: string;
      artifactSha256?: string;
    }
  | { kind: "blocked"; reason: string; checkpoint?: unknown }
  | { kind: "failed"; reason: string; checkpoint?: unknown };

export type UnifiedTaskCycleRepository = {
  claim(input: {
    workerId: string;
    leaseToken: string;
    leaseMs: number;
    permit?: UnifiedProviderClaimPermit;
  }): Promise<UnifiedWorkerTask | null>;
  heartbeat(input: {
    taskId: string;
    leaseToken: string;
    leaseMs: number;
  }): Promise<boolean>;
  checkpoint(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    checkpoint: unknown;
    orderedCommit?: UnifiedOrderedCommitExpectation;
  }): Promise<{
    readonly checkpointed: boolean;
    readonly providerWorkAvailable: boolean;
  }>;
  complete(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    acceptedArtifact?: UnifiedAcceptedArtifact;
  }): Promise<boolean>;
  settle(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    status: "WAITING_RETRY" | "BLOCKED_ADMIN" | "FAILED_TECHNICAL" | "CANCELLED";
    readyAt?: string;
    checkpoint?: unknown;
    lastError?: string;
  }): Promise<boolean>;
  recordAttemptAndWait?(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    readyAt: string;
    checkpoint?: unknown;
    lastError?: string;
  }): Promise<boolean>;
};

export type UnifiedChunkHandler = (input: {
  task: UnifiedWorkerTask;
  leaseToken: string;
  heartbeat(): Promise<void>;
}) => Promise<UnifiedChunkOutcome>;

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_worker_invalid_ready_at");
  }
  return value;
}

export async function runUnifiedTaskCycle(input: {
  workerId: string;
  now(): Date;
  leaseMs: number;
  repository: UnifiedTaskCycleRepository;
  handlers: Record<string, UnifiedChunkHandler>;
  createId?: () => string;
  claimPermit?: UnifiedProviderClaimPermit;
  onProviderWorkAvailable?(): void | Promise<void>;
  onTaskClaimed?(task: UnifiedWorkerTask): void;
  onHandlerFinished?(input: {
    readonly task: UnifiedWorkerTask;
    readonly result: UnifiedChunkOutcome;
  }): void;
  onLifecyclePersisted?(input: {
    readonly task: UnifiedWorkerTask;
    readonly result: UnifiedCompletedChunkOutcome | Extract<
      UnifiedChunkOutcome,
      { kind: "checkpoint" }
    >;
  }): void;
}): Promise<
  | {
      claimed: false;
      taskId: null;
      outcome: "idle";
    }
  | {
      claimed: true;
      taskId: string;
      runId: string;
      priorityLane: UnifiedWorkerTask["priorityLane"] | null;
      outcome: "checkpointed" | "completed" | "waiting" | "blocked" | "failed";
    }
> {
  const createId = input.createId ?? randomUUID;
  const leaseToken = createId();
  const task = await input.repository.claim({
    workerId: input.workerId,
    leaseToken,
    leaseMs: input.leaseMs,
    permit: input.claimPermit
  });
  if (!task) {
    return { claimed: false, taskId: null, outcome: "idle" };
  }
  try {
    input.onTaskClaimed?.(task);
  } catch {
    // ponytail: refill timing is best-effort and never owns task lifecycle.
  }
  const cycleResult = (
    outcome: "checkpointed" | "completed" | "waiting" | "blocked" | "failed"
  ) => ({
    claimed: true as const,
    taskId: task.id,
    runId: task.runId,
    priorityLane: task.priorityLane ?? null,
    outcome
  });
  const settle = (
    status: "WAITING_RETRY" | "BLOCKED_ADMIN" | "FAILED_TECHNICAL" | "CANCELLED",
    extra: {
      readyAt?: string;
      checkpoint?: unknown;
      lastError?: string;
    } = {}
  ) => input.repository.settle({
    taskId: task.id,
    leaseToken,
    attempt: task.attempt,
    status,
    ...extra
  });
  if (task.cancellationRequestedAt !== null) {
    if (!await settle("CANCELLED")) throw new Error("unified_worker_lease_lost");
    return cycleResult("blocked");
  }
  const handler = input.handlers[task.kind];
  if (!handler) {
    await settle("BLOCKED_ADMIN", { lastError: "unified_handler_missing" });
    return cycleResult("blocked");
  }
  try {
    const result = await handler({
      task,
      leaseToken,
      async heartbeat() {
        if (!await input.repository.heartbeat({
          taskId: task.id,
          leaseToken,
          leaseMs: input.leaseMs
        })) throw new Error("unified_worker_lease_lost");
      }
    });
    try {
      input.onHandlerFinished?.({ task, result });
    } catch {
      // ponytail: refill timing is best-effort and never owns task lifecycle.
    }
    if (result.kind === "checkpoint") {
      const checkpointed = await input.repository.checkpoint({
        taskId: task.id,
        leaseToken,
        attempt: task.attempt,
        checkpoint: result.checkpoint,
        orderedCommit: result.orderedCommit
      });
      if (!checkpointed.checkpointed) {
        throw new Error("unified_worker_lease_lost");
      }
      try {
        input.onLifecyclePersisted?.({ task, result });
      } catch {
        // ponytail: refill timing is best-effort and never owns task lifecycle.
      }
      if (checkpointed.providerWorkAvailable) {
        await input.onProviderWorkAvailable?.();
      }
      return cycleResult("checkpointed");
    }
    if (result.kind === "completed") {
      if (!await input.repository.complete({
        taskId: task.id,
        leaseToken,
        attempt: task.attempt,
        attemptId: result.attemptId ?? createId(),
        artifactSha256: result.artifactSha256,
        acceptedArtifact: result.acceptedArtifact
      })) throw new Error("unified_worker_lease_lost");
      try {
        input.onLifecyclePersisted?.({ task, result });
      } catch {
        // ponytail: refill timing is best-effort and never owns task lifecycle.
      }
      return cycleResult("completed");
    }
    if (result.kind === "provider_wait") {
      const readyAt = timestamp(result.readyAt);
      const recorded = result.attemptId && result.artifactSha256 &&
        input.repository.recordAttemptAndWait
        ? await input.repository.recordAttemptAndWait({
            taskId: task.id,
            leaseToken,
            attempt: task.attempt,
            attemptId: result.attemptId,
            artifactSha256: result.artifactSha256,
            readyAt,
            checkpoint: result.checkpoint,
            lastError: result.reason
          })
        : await settle("WAITING_RETRY", {
            readyAt,
            checkpoint: result.checkpoint,
            lastError: result.reason
          });
      if (!recorded) throw new Error("unified_worker_lease_lost");
      return cycleResult("waiting");
    }
    const status = result.kind === "blocked" ? "BLOCKED_ADMIN" : "FAILED_TECHNICAL";
    if (!await settle(status, {
      checkpoint: result.checkpoint,
      lastError: result.reason
    })) throw new Error("unified_worker_lease_lost");
    return cycleResult(result.kind === "blocked" ? "blocked" : "failed");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unified_worker_failed";
    if (reason !== "unified_worker_lease_lost") {
      await settle("FAILED_TECHNICAL", { lastError: reason });
    }
    return cycleResult("failed");
  }
}
