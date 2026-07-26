import { describe, expect, it, vi } from "vitest";
import {
  runUnifiedTaskCycle,
  shouldCheckpointUnifiedProviderChunk,
  type UnifiedTaskCycleRepository,
  type UnifiedWorkerTask
} from "../../src/unifiedCheck/worker";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

class MemoryWorkerRepository implements UnifiedTaskCycleRepository {
  lastClaimInput: unknown = null;
  task: (Mutable<UnifiedWorkerTask> & {
    status: "QUEUED" | "LEASED" | "WAITING_RETRY" | "COMPLETED" | "BLOCKED_ADMIN" | "FAILED_TECHNICAL" | "CANCELLED";
    leaseToken: string | null;
    readyAt: string;
    acceptedAttemptId: string | null;
  }) = {
    id: "task-1",
    runId: "run-1",
    kind: "direct_history",
    attempt: 0,
    checkpoint: {},
    cancellationRequestedAt: null,
    status: "QUEUED",
    leaseToken: null,
    readyAt: "2026-07-23T13:00:00.000Z",
    acceptedAttemptId: null
  };
  readonly attempts: Array<{ id: string; attempt: number; artifactSha256: string }> = [];
  lastCompletion: {
    attemptId: string;
    artifactSha256: string;
    acceptedArtifact?: unknown;
  } | null = null;
  lastOrderedCommit: unknown = null;
  providerWorkAvailable = false;
  now = new Date("2026-07-23T13:00:00.000Z");

  async claim(input: {
    leaseToken: string;
    permit?: unknown;
  }): Promise<UnifiedWorkerTask | null> {
    this.lastClaimInput = input;
    if (
      !["QUEUED", "WAITING_RETRY"].includes(this.task.status) ||
      Date.parse(this.task.readyAt) > this.now.getTime()
    ) return null;
    this.task.status = "LEASED";
    this.task.leaseToken = input.leaseToken;
    this.task.attempt += 1;
    return structuredClone(this.task);
  }

  async heartbeat(input: { leaseToken: string }): Promise<boolean> {
    return this.task.status === "LEASED" && this.task.leaseToken === input.leaseToken;
  }

  async checkpoint(input: {
    leaseToken: string;
    attempt: number;
    checkpoint: unknown;
    orderedCommit?: unknown;
  }): Promise<{
    checkpointed: boolean;
    providerWorkAvailable: boolean;
  }> {
    if (!this.matches(input)) {
      return { checkpointed: false, providerWorkAvailable: false };
    }
    this.task.checkpoint = input.checkpoint;
    this.lastOrderedCommit = input.orderedCommit ?? null;
    this.task.status = "QUEUED";
    this.task.leaseToken = null;
    return {
      checkpointed: true,
      providerWorkAvailable: this.providerWorkAvailable
    };
  }

  async complete(input: {
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    acceptedArtifact?: unknown;
  }): Promise<boolean> {
    if (!this.matches(input)) return false;
    this.lastCompletion = input;
    this.attempts.push({
      id: input.attemptId,
      attempt: input.attempt,
      artifactSha256: input.artifactSha256
    });
    this.task.status = "COMPLETED";
    this.task.leaseToken = null;
    this.task.acceptedAttemptId = input.attemptId;
    return true;
  }

  async settle(input: {
    leaseToken: string;
    attempt: number;
    status: "WAITING_RETRY" | "BLOCKED_ADMIN" | "FAILED_TECHNICAL" | "CANCELLED";
    readyAt?: string;
    checkpoint?: unknown;
  }): Promise<boolean> {
    if (!this.matches(input)) return false;
    this.task.status = input.status;
    this.task.leaseToken = null;
    if (input.readyAt) this.task.readyAt = input.readyAt;
    if (input.checkpoint !== undefined) this.task.checkpoint = input.checkpoint;
    return true;
  }

  async recordAttemptAndWait(input: {
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    readyAt: string;
    checkpoint?: unknown;
  }): Promise<boolean> {
    if (!this.matches(input)) return false;
    this.attempts.push({
      id: input.attemptId,
      attempt: input.attempt,
      artifactSha256: input.artifactSha256
    });
    this.task.status = "WAITING_RETRY";
    this.task.leaseToken = null;
    this.task.readyAt = input.readyAt;
    if (input.checkpoint !== undefined) this.task.checkpoint = input.checkpoint;
    return true;
  }

  private matches(input: { leaseToken: string; attempt: number }): boolean {
    return this.task.status === "LEASED" &&
      this.task.leaseToken === input.leaseToken &&
      this.task.attempt === input.attempt;
  }
}

function cycle(
  repository: MemoryWorkerRepository,
  handler: Parameters<typeof runUnifiedTaskCycle>[0]["handlers"][string],
  ids: string[]
) {
  return runUnifiedTaskCycle({
    workerId: "worker-1",
    now: () => repository.now,
    leaseMs: 60_000,
    repository,
    handlers: { direct_history: handler },
    createId: () => ids.shift()!
  });
}

describe("Unified resumable worker", () => {
  it("observes claim, handler, and persisted lifecycle boundaries in order", async () => {
    const repository = new MemoryWorkerRepository();
    const events: string[] = [];
    const checkpoint = repository.checkpoint.bind(repository);
    repository.checkpoint = async (input) => {
      events.push("repository_checkpoint");
      return checkpoint(input);
    };

    await runUnifiedTaskCycle({
      workerId: "worker-1",
      now: () => repository.now,
      leaseMs: 60_000,
      repository,
      handlers: {
        direct_history: async () => {
          events.push("handler");
          return { kind: "checkpoint", checkpoint: { cursor: "next" } };
        }
      },
      createId: () => "lease-1",
      onTaskClaimed: () => events.push("task_claimed"),
      onHandlerFinished: () => events.push("handler_finished"),
      onLifecyclePersisted: () => events.push("lifecycle_persisted")
    });

    expect(events).toEqual([
      "task_claimed",
      "handler",
      "handler_finished",
      "repository_checkpoint",
      "lifecycle_persisted"
    ]);
  });

  it("keeps successful work independent from throwing lifecycle observers", async () => {
    const repository = new MemoryWorkerRepository();
    const throwing = () => {
      throw new Error("diagnostics unavailable");
    };

    await expect(runUnifiedTaskCycle({
      workerId: "worker-1",
      now: () => repository.now,
      leaseMs: 60_000,
      repository,
      handlers: {
        direct_history: async () => ({
          kind: "completed",
          artifactSha256: "a".repeat(64)
        })
      },
      createId: (() => {
        const ids = ["lease-1", "attempt-1"];
        return () => ids.shift()!;
      })(),
      onTaskClaimed: throwing,
      onHandlerFinished: throwing,
      onLifecyclePersisted: throwing
    })).resolves.toMatchObject({ outcome: "completed" });
  });

  it("uses one shared predicate for every provider chunk limit", () => {
    const budget = {
      maxWorkUnits: 2,
      maxWallMs: 100,
      maxResponseBytes: 1_000,
      maxCheckpointBytes: 500
    };
    const below = {
      workUnits: 1,
      elapsedMs: 99,
      responseBytes: 999,
      checkpointBytes: 499
    };

    expect(shouldCheckpointUnifiedProviderChunk(budget, below)).toBe(false);
    for (const reached of [
      { ...below, workUnits: 2 },
      { ...below, elapsedMs: 100 },
      { ...below, responseBytes: 1_000 },
      { ...below, checkpointBytes: 500 }
    ]) {
      expect(shouldCheckpointUnifiedProviderChunk(budget, reached)).toBe(true);
    }
  });

  it("runs one bounded checkpoint per cycle and prevents a second claim", async () => {
    const repository = new MemoryWorkerRepository();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = cycle(repository, async () => {
      await held;
      return { kind: "checkpoint", checkpoint: { cursor: "page-2" } };
    }, ["lease-1"]);
    await Promise.resolve();
    const second = await cycle(repository, vi.fn(), ["lease-2"]);
    expect(second).toEqual({ claimed: false, taskId: null, outcome: "idle" });
    release();
    expect(await first).toMatchObject({ claimed: true, outcome: "checkpointed" });
    expect(repository.task.checkpoint).toEqual({ cursor: "page-2" });
  });

  it("forwards an ordered commit expectation with the checkpoint", async () => {
    const repository = new MemoryWorkerRepository();
    const orderedCommit = {
      runId: "run-1",
      expectedDeltaHeadSha256: null,
      entries: [{
        canonicalSequence: 0,
        taskId: "history-1",
        logicalKey: "manifest-1",
        acceptedAttemptId: "attempt-1",
        resultBytes: 128,
        taskKind: "address_history",
        artifactKind: "address_history_manifest",
        artifactSchemaVersion: "1"
      }],
      discoveredTasks: []
    };

    await expect(cycle(repository, async () => ({
      kind: "checkpoint",
      checkpoint: { deltaHeadSha256: "a".repeat(64) },
      orderedCommit
    }), ["lease-1"])).resolves.toMatchObject({ outcome: "checkpointed" });
    expect(repository.lastOrderedCommit).toBe(orderedCommit);
  });

  it("wakes provider work exactly once after a committed head admission", async () => {
    const repository = new MemoryWorkerRepository();
    repository.providerWorkAvailable = true;
    const wake = vi.fn();

    await runUnifiedTaskCycle({
      workerId: "worker-1",
      now: () => repository.now,
      leaseMs: 60_000,
      repository,
      handlers: {
        direct_history: async () => ({
          kind: "checkpoint",
          checkpoint: { cursor: "page-2" }
        })
      },
      createId: () => "lease-1",
      onProviderWorkAvailable: wake
    } as Parameters<typeof runUnifiedTaskCycle>[0]);

    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("heartbeats only the live token and rejects stale publication", async () => {
    const repository = new MemoryWorkerRepository();
    let heartbeat!: () => Promise<void>;
    const handler = vi.fn(async (input: Parameters<
      Parameters<typeof runUnifiedTaskCycle>[0]["handlers"][string]
    >[0]) => {
      heartbeat = input.heartbeat;
      await input.heartbeat();
      repository.task.leaseToken = "replacement-token";
      return { kind: "completed" as const, artifactSha256: "a".repeat(64) };
    });
    const result = await cycle(repository, handler, ["lease-1", "attempt-1"]);
    expect(result.outcome).toBe("failed");
    await expect(heartbeat()).rejects.toThrow("unified_worker_lease_lost");
    expect(repository.attempts).toEqual([]);
  });

  it("records an immutable waiting attempt and accepts a later attempt", async () => {
    const repository = new MemoryWorkerRepository();
    const waiting = await cycle(repository, async () => ({
      kind: "provider_wait",
      readyAt: "2026-07-23T13:01:00.000Z",
      reason: "all_keys_cooling",
      attemptId: "attempt-wait",
      artifactSha256: "a".repeat(64),
      checkpoint: { cursor: "page-10" }
    }), ["lease-1"]);
    expect(waiting.outcome).toBe("waiting");
    expect(repository.attempts).toEqual([{
      id: "attempt-wait",
      attempt: 1,
      artifactSha256: "a".repeat(64)
    }]);
    expect(await cycle(repository, vi.fn(), ["lease-before-ready"]))
      .toMatchObject({ outcome: "idle" });

    repository.now = new Date("2026-07-23T13:01:00.000Z");
    const completed = await cycle(repository, async ({ task }) => {
      expect(task.checkpoint).toEqual({ cursor: "page-10" });
      return {
        kind: "completed",
        attemptId: "attempt-success",
        artifactSha256: "b".repeat(64)
      };
    }, ["lease-2"]);
    expect(completed.outcome).toBe("completed");
    expect(repository.attempts).toHaveLength(2);
    expect(repository.attempts[0]).toEqual({
      id: "attempt-wait",
      attempt: 1,
      artifactSha256: "a".repeat(64)
    });
    expect(repository.task.acceptedAttemptId).toBe("attempt-success");
  });

  it("forwards the accepted artifact payload unchanged", async () => {
    const repository = new MemoryWorkerRepository();
    const acceptedArtifact = {
      kind: "address_history_manifest",
      schemaVersion: "1",
      value: { version: "manifest-v1", note: "канон" }
    };
    const completed = await cycle(repository, async () => ({
      kind: "completed",
      attemptId: "attempt-success",
      artifactSha256: "b".repeat(64),
      acceptedArtifact
    }), ["lease-1"]);

    expect(completed.outcome).toBe("completed");
    expect(repository.lastCompletion).toMatchObject({
      attemptId: "attempt-success",
      artifactSha256: "b".repeat(64)
    });
    expect(repository.lastCompletion?.acceptedArtifact).toBe(acceptedArtifact);
  });

  it("observes cancellation at a chunk boundary without invoking a handler", async () => {
    const repository = new MemoryWorkerRepository();
    repository.task.cancellationRequestedAt = "2026-07-23T13:00:00.000Z";
    const handler = vi.fn();
    const result = await cycle(repository, handler, ["lease-1"]);
    expect(result.outcome).toBe("blocked");
    expect(repository.task.status).toBe("CANCELLED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("forwards an immutable provider permit and reports the serviced run and lane", async () => {
    const repository = new MemoryWorkerRepository();
    const permit = Object.freeze({
      lane: "repair" as const,
      ownerId: "owner-1",
      runId: "run-1",
      canonicalHeadPreferred: true
    });
    repository.task.priorityLane = "repair";

    const result = await runUnifiedTaskCycle({
      workerId: "worker-1",
      now: () => repository.now,
      leaseMs: 60_000,
      repository,
      handlers: {
        direct_history: async () => ({
          kind: "checkpoint",
          checkpoint: { cursor: "next" }
        })
      },
      claimPermit: permit,
      createId: () => "lease-1"
    });

    expect(repository.lastClaimInput).toEqual(expect.objectContaining({
      permit
    }));
    expect(result).toMatchObject({
      claimed: true,
      runId: "run-1",
      priorityLane: "repair",
      outcome: "checkpointed"
    });
  });
});
