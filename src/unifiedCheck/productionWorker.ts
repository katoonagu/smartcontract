import {
  checkpointUnifiedTask,
  claimUnifiedTask,
  completeUnifiedTaskAttempt,
  heartbeatUnifiedTask,
  recordUnifiedTaskAttemptAndWait,
  settleUnifiedTaskLease,
  type UnifiedTransactionalQueryable
} from "./repository";
import type {
  UnifiedRunPurpose
} from "./contracts";
import type {
  UnifiedCheckpointCommitResult,
  UnifiedTaskCycleRepository,
  UnifiedWorkerTask
} from "./worker";
import type {
  UnifiedAdaptiveEvent
} from "./adaptiveObservability";

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function integer(value: unknown, code: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

function canonicalSequence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("unified_worker_canonical_sequence_invalid");
  }
  return parsed;
}

function checkpointCommitResult(
  row: (Record<string, unknown> & { orderedCommit?: unknown }) | null
): UnifiedCheckpointCommitResult {
  if (row === null) {
    return {
      checkpointed: false,
      providerWorkAvailable: false,
      committedTaskStatus: null,
      committedCheckpoint: null,
      orderedCommit: null
    };
  }
  const status = row.status;
  if (status !== "QUEUED" && status !== "CANCELLED") {
    throw new Error("unified_worker_checkpoint_status_invalid");
  }
  let orderedCommit: UnifiedCheckpointCommitResult["orderedCommit"] = null;
  if (row.orderedCommit !== undefined && row.orderedCommit !== null) {
    const value = row.orderedCommit as Partial<NonNullable<
      UnifiedCheckpointCommitResult["orderedCommit"]
    >>;
    if (
      typeof value.applied !== "boolean" ||
      typeof value.runId !== "string" ||
      value.runId.length === 0 ||
      !Array.isArray(value.committedEntries)
    ) {
      throw new Error("unified_worker_ordered_commit_result_invalid");
    }
    const entries = value.committedEntries.map((entry) => {
      if (
        entry === null ||
        typeof entry !== "object" ||
        !Number.isSafeInteger(entry.canonicalSequence) ||
        entry.canonicalSequence < 0 ||
        typeof entry.taskId !== "string" ||
        entry.taskId.length === 0 ||
        typeof entry.acceptedAttemptId !== "string" ||
        entry.acceptedAttemptId.length === 0 ||
        typeof entry.artifactSha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(entry.artifactSha256)
      ) {
        throw new Error("unified_worker_ordered_commit_result_invalid");
      }
      return {
        canonicalSequence: entry.canonicalSequence,
        taskId: entry.taskId,
        acceptedAttemptId: entry.acceptedAttemptId,
        artifactSha256: entry.artifactSha256
      };
    });
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index - 1]!.canonicalSequence >=
        entries[index]!.canonicalSequence) {
        throw new Error("unified_worker_ordered_commit_result_invalid");
      }
    }
    if (
      (status === "CANCELLED" && (value.applied || entries.length > 0)) ||
      (status === "QUEUED" && !value.applied)
    ) {
      throw new Error("unified_worker_ordered_commit_result_invalid");
    }
    orderedCommit = {
      applied: value.applied,
      runId: value.runId,
      committedEntries: entries
    };
  }
  return {
    checkpointed: true,
    providerWorkAvailable: row.next_head_newly_admitted === true,
    committedTaskStatus: status,
    committedCheckpoint: structuredClone(row.checkpoint_json ?? null),
    orderedCommit
  };
}

function workerTask(row: Record<string, unknown>): UnifiedWorkerTask {
  const sequence = canonicalSequence(row.canonical_sequence);
  return {
    id: text(row.id, "unified_worker_task_id_invalid"),
    runId: text(row.run_id, "unified_worker_run_id_invalid"),
    kind: text(row.kind, "unified_worker_task_kind_invalid"),
    logicalKey: text(
      row.logical_key,
      "unified_worker_task_logical_key_invalid"
    ),
    priorityLane: text(
      row.priority_lane,
      "unified_worker_task_priority_lane_invalid"
    ) as UnifiedWorkerTask["priorityLane"],
    attempt: integer(row.attempt, "unified_worker_attempt_invalid"),
    ...(sequence === null ? {} : { canonicalSequence: sequence }),
    checkpoint: row.checkpoint_json ?? {},
    cancellationRequestedAt: row.cancellation_requested_at === null ||
      row.cancellation_requested_at === undefined
      ? null
      : new Date(String(row.cancellation_requested_at)).toISOString()
  };
}

export function createPostgresUnifiedTaskCycleRepository(
  db: UnifiedTransactionalQueryable,
  kinds: readonly string[],
  runtimeCommit: string,
  providerConfigurationSha256: string,
  runPurpose?: UnifiedRunPurpose,
  options: {
    readonly manifestMaxBytes?: number;
    readonly benchmarkReadyBufferMaxEntries?: number;
    readonly benchmarkReadyBufferMaxBytes?: number;
    readonly onCheckpointLatencyMs?: (latencyMs: number) => void;
    readonly onAdaptiveEvent?: (event: UnifiedAdaptiveEvent) => void;
  } = {}
): UnifiedTaskCycleRepository {
  if (kinds.length === 0 || kinds.some((kind) => kind.trim().length === 0)) {
    throw new TypeError("unified_worker_kinds_invalid");
  }
  if (!runtimeCommit.trim()) {
    throw new TypeError("unified_worker_runtime_commit_invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(providerConfigurationSha256)) {
    throw new TypeError("unified_worker_provider_configuration_invalid");
  }
  const claimKinds = [...new Set(kinds)].sort();
  return {
    async claim(input) {
      const row = await claimUnifiedTask(db, {
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        leaseMs: input.leaseMs,
        kinds: claimKinds,
        runPurpose,
        runtimeCommit,
        providerConfigurationSha256,
        runId: input.permit?.runId,
        priorityLane: input.permit?.lane,
        fairnessOwnerId: input.permit?.ownerId,
        benchmarkReadyBufferMaxEntries:
          options.benchmarkReadyBufferMaxEntries,
        benchmarkReadyBufferMaxBytes:
          options.benchmarkReadyBufferMaxBytes
      });
      return row ? workerTask(row) : null;
    },
    async heartbeat(input) {
      return Boolean(await heartbeatUnifiedTask(db, input));
    },
    async checkpoint(input) {
      const startedAtMs = Date.now();
      let checkpointed: Awaited<
        ReturnType<typeof checkpointUnifiedTask>
      >;
      try {
        checkpointed = await checkpointUnifiedTask(db, {
          ...input,
          barrierReservedBytes: options.manifestMaxBytes
        });
      } finally {
        try {
          options.onCheckpointLatencyMs?.(Date.now() - startedAtMs);
        } catch {
          // Observability never participates in checkpoint correctness.
        }
      }
      return checkpointCommitResult(checkpointed);
    },
    async complete(input) {
      return Boolean(await completeUnifiedTaskAttempt(db, {
        ...input,
        manifestMaxBytes: options.manifestMaxBytes,
        onAdaptiveEvent: options.onAdaptiveEvent
      }));
    },
    async settle(input) {
      return Boolean(await settleUnifiedTaskLease(db, input));
    },
    async recordAttemptAndWait(input) {
      return Boolean(await recordUnifiedTaskAttemptAndWait(db, input));
    }
  };
}
