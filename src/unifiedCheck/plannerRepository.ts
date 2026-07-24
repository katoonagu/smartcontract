import {
  canonicalOrderedTasks,
  selectBoundedReadyPrefix
} from "./planner";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "./repository";

export type UnifiedOrderedTaskPlanInput = {
  readonly taskId: string;
  readonly kind: string;
  readonly logicalKey: string;
  readonly priorityLane: "interactive" | "repair" | "background";
  readonly checkpoint: unknown;
};

type PlannedTask = {
  taskId: string;
  canonicalSequence: number;
};

export type UnifiedOrderedReadyEntry = {
  readonly canonicalSequence: number;
  readonly taskId: string;
  readonly acceptedAttemptId: string;
  readonly artifactSha256: string;
  readonly artifactKind: string;
  readonly artifactSchemaVersion: string;
  readonly artifact: unknown;
  readonly resultBytes: number;
};

function orderedArtifactEntry(
  row: Record<string, unknown>
): UnifiedOrderedReadyEntry {
  const canonicalSequence = sequence(row.canonical_sequence);
  if (row.result_bytes === null || row.result_bytes === undefined) {
    throw new Error("unified_planner_ready_result_bytes_missing");
  }
  const resultBytes = safeNonNegativeInteger(
    Number(row.result_bytes),
    "unified_planner_result_bytes_invalid"
  );
  const taskId = requiredText(
    row.task_id,
    "unified_planner_ready_task_invalid"
  );
  const acceptedAttemptId = requiredText(
    row.accepted_attempt_id,
    "unified_planner_ready_attempt_invalid"
  );
  const artifactSha256 = requiredText(
    row.artifact_sha256,
    "unified_planner_ready_artifact_invalid"
  );
  const artifactKind = requiredText(
    row.artifact_kind,
    "unified_planner_ready_artifact_kind_invalid"
  );
  const artifactSchemaVersion = requiredText(
    row.artifact_schema_version,
    "unified_planner_ready_artifact_schema_invalid"
  );
  const artifact = row.artifact_json;
  if (
    fingerprintCanonicalArtifact(artifact) !== artifactSha256 ||
    Buffer.byteLength(canonicalizeArtifactJson(artifact), "utf8") !==
      resultBytes
  ) {
    throw new Error("unified_planner_ready_artifact_mismatch");
  }
  return {
    canonicalSequence,
    taskId,
    acceptedAttemptId,
    artifactSha256,
    artifactKind,
    artifactSchemaVersion,
    artifact,
    resultBytes
  };
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(code);
  }
  return value;
}

function safeNonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(code);
  }
  return value as number;
}

function checkpointJson(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new TypeError("unified_planner_checkpoint_invalid");
  }
  if (json === undefined) throw new TypeError("unified_planner_checkpoint_invalid");
  return json;
}

async function lockRun(db: UnifiedQueryable, runId: string): Promise<void> {
  const result = await db.query(
    "select id from unified_check_runs where id = $1 for update",
    [runId]
  );
  if (!result.rows[0]) throw new Error("unified_planner_run_missing");
}

function sequence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("unified_planner_sequence_invalid");
  }
  return parsed;
}

function positiveSafeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(code);
  }
  return value as number;
}

export async function loadUnifiedDurableOrderedLogicalKeys(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly logicalKeys: readonly string[];
  }
): Promise<Set<string>> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const logicalKeys = [...new Set(input.logicalKeys.map((logicalKey) =>
    requiredText(logicalKey, "unified_planner_logical_key_invalid")
  ))].sort();
  if (logicalKeys.length === 0) return new Set();
  const result = await db.query(
    `select task.logical_key
       from unified_check_tasks task
       join unified_check_planner_entries entry
         on entry.run_id = task.run_id and entry.task_id = task.id
      where task.run_id = $1
        and task.logical_key = any($2::text[])
      order by task.logical_key`,
    [runId, logicalKeys]
  );
  return new Set(result.rows.map((row) =>
    requiredText(row.logical_key, "unified_planner_logical_key_invalid")
  ));
}

export async function loadUnifiedCommittedArtifacts(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly logicalKeys: readonly string[];
  }
): Promise<UnifiedOrderedReadyEntry[]> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const logicalKeys = [...new Set(input.logicalKeys.map((logicalKey) =>
    requiredText(logicalKey, "unified_planner_logical_key_invalid")
  ))].sort();
  if (logicalKeys.length === 0) return [];
  const result = await db.query(
    `select entry.canonical_sequence, entry.result_bytes, entry.task_id,
            task.accepted_attempt_id,
            attempt.artifact_sha256,
            artifact.kind as artifact_kind,
            artifact.schema_version as artifact_schema_version,
            artifact.artifact_json
       from unified_check_planner_entries entry
       join unified_check_tasks task
         on task.run_id = entry.run_id and task.id = entry.task_id
       join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
       join unified_check_artifacts artifact
         on artifact.sha256 = attempt.artifact_sha256
      where entry.run_id = $1
        and entry.planner_state = 'committed'
        and task.logical_key = any($2::text[])
      order by entry.canonical_sequence`,
    [runId, logicalKeys]
  );
  return result.rows.map(orderedArtifactEntry);
}

export async function loadUnifiedBoundedReadyPrefix(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly maxEntries: number;
    readonly maxBytes: number;
  }
): Promise<UnifiedOrderedReadyEntry[]> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const maxEntries = positiveSafeInteger(
    input.maxEntries,
    "unified_planner_commit_entries_invalid"
  );
  const maxBytes = positiveSafeInteger(
    input.maxBytes,
    "unified_planner_commit_bytes_invalid"
  );
  const result = await db.query(
    `with head as (
       select min(canonical_sequence) as canonical_sequence
         from unified_check_planner_entries
        where run_id = $1 and planner_state <> 'committed'
     )
     select entry.canonical_sequence, entry.planner_state,
            entry.result_bytes, entry.task_id,
            task.accepted_attempt_id,
            attempt.artifact_sha256,
            artifact.kind as artifact_kind,
            artifact.schema_version as artifact_schema_version,
            artifact.artifact_json
       from unified_check_planner_entries entry
       join head
         on entry.canonical_sequence >= head.canonical_sequence
       join unified_check_tasks task
         on task.run_id = entry.run_id and task.id = entry.task_id
       left join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
       left join unified_check_artifacts artifact
         on artifact.sha256 = attempt.artifact_sha256
      where entry.run_id = $1
      order by entry.canonical_sequence
      limit $2`,
    [runId, maxEntries]
  );
  const candidates = result.rows.map((row) => ({
    row,
    canonicalSequence: sequence(row.canonical_sequence),
    plannerState: String(row.planner_state) as "planned" | "ready" | "committed",
    resultBytes: row.result_bytes === null
      ? null
      : safeNonNegativeInteger(
          Number(row.result_bytes),
          "unified_planner_result_bytes_invalid"
        )
  }));
  const selected = selectBoundedReadyPrefix(candidates, {
    maxEntries,
    maxBytes
  });
  return selected.map(({ row, resultBytes }) => {
    if (resultBytes === null) {
      throw new Error("unified_planner_ready_result_bytes_missing");
    }
    return orderedArtifactEntry(row);
  });
}

export async function planUnifiedOrderedTasks(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly tasks: readonly UnifiedOrderedTaskPlanInput[];
  }
): Promise<PlannedTask[]> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  return db.transaction(async (client) => {
    await lockRun(client, runId);
    const taskByIdentity = new Map<string, {
      task: UnifiedOrderedTaskPlanInput;
      checkpoint: string;
    }>();
    for (const task of input.tasks) {
      if (!["interactive", "repair", "background"].includes(task.priorityLane)) {
        throw new TypeError("unified_planner_priority_lane_invalid");
      }
      const identity = JSON.stringify([task.kind, task.logicalKey]);
      if (!taskByIdentity.has(identity)) {
        taskByIdentity.set(identity, { task, checkpoint: checkpointJson(task.checkpoint) });
      }
    }
    const ordered = canonicalOrderedTasks(input.tasks);
    const maxRow = (
      await client.query(
        `select max(canonical_sequence) as max_sequence
           from unified_check_planner_entries
          where run_id = $1`,
        [runId]
      )
    ).rows[0];
    let nextSequence = maxRow?.max_sequence === null ||
      maxRow?.max_sequence === undefined
      ? 0
      : sequence(maxRow.max_sequence) + 1;
    const result: PlannedTask[] = [];

    for (const identity of ordered) {
      const planned = taskByIdentity.get(
        JSON.stringify([identity.kind, identity.logicalKey])
      );
      if (!planned) throw new Error("unified_planner_task_identity_missing");
      const insertedTask = await client.query(
        `insert into unified_check_tasks (
          id, run_id, kind, status, priority_lane, logical_key, checkpoint_json
        ) values ($1,$2,$3,'QUEUED',$4,$5,$6::jsonb)
        on conflict (run_id, kind, logical_key) do nothing
        returning id, status, accepted_attempt_id`,
        [
          planned.task.taskId,
          runId,
          planned.task.kind,
          planned.task.priorityLane,
          planned.task.logicalKey,
          planned.checkpoint
        ]
      );
      const durableTask = insertedTask.rows[0] ?? (
        await client.query(
          `select id, status, accepted_attempt_id
             from unified_check_tasks
            where run_id = $1 and kind = $2 and logical_key = $3
            for update`,
          [runId, planned.task.kind, planned.task.logicalKey]
        )
      ).rows[0];
      if (!durableTask) throw new Error("unified_planner_task_reuse_failed");
      const taskId = String(durableTask.id);
      let planner = (
        await client.query(
          `select canonical_sequence
             from unified_check_planner_entries
            where run_id = $1 and task_id = $2
            for update`,
          [runId, taskId]
        )
      ).rows[0];
      if (!planner) {
        if (
          !["QUEUED", "WAITING_RETRY"].includes(
            String(durableTask.status)
          ) ||
          durableTask.accepted_attempt_id !== null
        ) {
          throw new Error("unified_planner_task_not_plannable");
        }
        planner = (
          await client.query(
            `insert into unified_check_planner_entries (
              run_id, canonical_sequence, task_id, planner_state
            ) values ($1,$2,$3,'planned')
            returning canonical_sequence`,
            [runId, nextSequence, taskId]
          )
        ).rows[0];
        nextSequence += 1;
      }
      if (!planner) throw new Error("unified_planner_entry_insert_failed");
      result.push({
        taskId,
        canonicalSequence: sequence(planner.canonical_sequence)
      });
    }
    return result;
  });
}

export async function admitBarrierHead(
  db: UnifiedTransactionalQueryable,
  input: { readonly runId: string; readonly reservedBytes: number }
): Promise<boolean> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const reservedBytes = safeNonNegativeInteger(
    input.reservedBytes,
    "unified_planner_reserved_bytes_invalid"
  );
  return db.transaction(async (client) => {
    await lockRun(client, runId);
    return admitBarrierHeadInTransaction(client, {
      runId,
      reservedBytes
    });
  });
}

export async function admitBarrierHeadInTransaction(
  db: UnifiedQueryable,
  input: { readonly runId: string; readonly reservedBytes: number }
): Promise<boolean> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const reservedBytes = safeNonNegativeInteger(
    input.reservedBytes,
    "unified_planner_reserved_bytes_invalid"
  );
  const admitted = await db.query(
    `update unified_check_planner_entries entry
        set admitted_at = statement_timestamp(), reserved_bytes = $2
      where entry.run_id = $1
        and entry.canonical_sequence = (
          select min(head.canonical_sequence)
            from unified_check_planner_entries head
           where head.run_id = $1 and head.planner_state <> 'committed'
        )
        and entry.planner_state = 'planned'
        and entry.admitted_at is null
      returning entry.task_id`,
    [runId, reservedBytes]
  );
  return admitted.rows.length === 1;
}

export async function deAdmitUnleasedPlannerTail(
  db: UnifiedTransactionalQueryable,
  input: { readonly runId: string; readonly keepThroughSequence: number }
): Promise<number> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  if (
    !Number.isSafeInteger(input.keepThroughSequence) ||
    input.keepThroughSequence < -1
  ) {
    throw new TypeError("unified_planner_keep_sequence_invalid");
  }
  return db.transaction(async (client) => {
    await lockRun(client, runId);
    const cleared = await client.query(
      `update unified_check_planner_entries entry
          set admitted_at = null, reserved_bytes = null
         from unified_check_tasks task
        where entry.run_id = $1
          and entry.canonical_sequence > $2
          and entry.planner_state = 'planned'
          and entry.admitted_at is not null
          and task.run_id = entry.run_id
          and task.id = entry.task_id
          and task.status <> 'LEASED'
        returning entry.task_id`,
      [runId, input.keepThroughSequence]
    );
    return cleared.rows.length;
  });
}
