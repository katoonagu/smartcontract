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

function workerTask(row: Record<string, unknown>): UnifiedWorkerTask {
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
        fairnessOwnerId: input.permit?.ownerId
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
      return {
        checkpointed: Boolean(checkpointed),
        providerWorkAvailable:
          checkpointed?.next_head_newly_admitted === true
      };
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
