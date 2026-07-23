import { randomUUID } from "node:crypto";

export type UnifiedWorkerTask = {
  readonly id: string;
  readonly runId: string;
  readonly kind: string;
  readonly attempt: number;
  readonly checkpoint: unknown;
  readonly cancellationRequestedAt: string | null;
};

export type UnifiedChunkOutcome =
  | { kind: "checkpoint"; checkpoint: unknown }
  | { kind: "completed"; attemptId?: string; artifactSha256: string }
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
  }): Promise<boolean>;
  complete(input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
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
}): Promise<{
  claimed: boolean;
  taskId: string | null;
  outcome: "idle" | "checkpointed" | "completed" | "waiting" | "blocked" | "failed";
}> {
  const createId = input.createId ?? randomUUID;
  const leaseToken = createId();
  const task = await input.repository.claim({
    workerId: input.workerId,
    leaseToken,
    leaseMs: input.leaseMs
  });
  if (!task) return { claimed: false, taskId: null, outcome: "idle" };
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
    return { claimed: true, taskId: task.id, outcome: "blocked" };
  }
  const handler = input.handlers[task.kind];
  if (!handler) {
    await settle("BLOCKED_ADMIN", { lastError: "unified_handler_missing" });
    return { claimed: true, taskId: task.id, outcome: "blocked" };
  }
  try {
    const result = await handler({
      task,
      async heartbeat() {
        if (!await input.repository.heartbeat({
          taskId: task.id,
          leaseToken,
          leaseMs: input.leaseMs
        })) throw new Error("unified_worker_lease_lost");
      }
    });
    if (result.kind === "checkpoint") {
      if (!await input.repository.checkpoint({
        taskId: task.id,
        leaseToken,
        attempt: task.attempt,
        checkpoint: result.checkpoint
      })) throw new Error("unified_worker_lease_lost");
      return { claimed: true, taskId: task.id, outcome: "checkpointed" };
    }
    if (result.kind === "completed") {
      if (!await input.repository.complete({
        taskId: task.id,
        leaseToken,
        attempt: task.attempt,
        attemptId: result.attemptId ?? createId(),
        artifactSha256: result.artifactSha256
      })) throw new Error("unified_worker_lease_lost");
      return { claimed: true, taskId: task.id, outcome: "completed" };
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
      return { claimed: true, taskId: task.id, outcome: "waiting" };
    }
    const status = result.kind === "blocked" ? "BLOCKED_ADMIN" : "FAILED_TECHNICAL";
    if (!await settle(status, {
      checkpoint: result.checkpoint,
      lastError: result.reason
    })) throw new Error("unified_worker_lease_lost");
    return {
      claimed: true,
      taskId: task.id,
      outcome: result.kind === "blocked" ? "blocked" : "failed"
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unified_worker_failed";
    if (reason !== "unified_worker_lease_lost") {
      await settle("FAILED_TECHNICAL", { lastError: reason });
    }
    return { claimed: true, taskId: task.id, outcome: "failed" };
  }
}
