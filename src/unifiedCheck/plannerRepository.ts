import {
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

export type UnifiedOrderedTaskDiscoveryInput =
  UnifiedOrderedTaskPlanInput & {
    readonly parentCanonicalSequence: number;
  };

type PlannedTask = {
  taskId: string;
  canonicalSequence: number;
};

export type UnifiedOrderedReadyEntry = {
  readonly canonicalSequence: number;
  readonly taskId: string;
  readonly taskKind: string;
  readonly logicalKey: string;
  readonly acceptedAttemptId: string;
  readonly artifactSha256: string;
  readonly artifactKind: string;
  readonly artifactSchemaVersion: string;
  readonly artifact: unknown;
  readonly resultBytes: number;
};

function orderedArtifactEntry(
  row: Record<string, unknown>,
  expected: {
    readonly taskKind: string;
    readonly artifactKind: string;
    readonly artifactSchemaVersion: string;
  }
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
  const taskKind = requiredText(
    row.task_kind,
    "unified_planner_ready_task_kind_invalid"
  );
  const logicalKey = requiredText(
    row.task_logical_key,
    "unified_planner_ready_logical_key_invalid"
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
    taskKind !== expected.taskKind ||
    row.task_status !== "COMPLETED" ||
    row.attempt_id !== acceptedAttemptId ||
    row.attempt_task_id !== taskId ||
    row.artifact_kind !== expected.artifactKind ||
    row.artifact_schema_version !== expected.artifactSchemaVersion ||
    fingerprintCanonicalArtifact(artifact) !== artifactSha256 ||
    Buffer.byteLength(canonicalizeArtifactJson(artifact), "utf8") !==
      resultBytes
  ) {
    throw new Error("unified_planner_ready_identity_mismatch");
  }
  return {
    canonicalSequence,
    taskId,
    taskKind,
    logicalKey,
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
  const identities = input.logicalKeys.map((logicalKey) => ({
    kind: "address_history",
    logicalKey
  }));
  const durable = await loadUnifiedDurableOrderedTaskIdentities(db, {
    runId: input.runId,
    identities
  });
  return new Set(identities.flatMap(({ kind, logicalKey }) =>
    durable.has(JSON.stringify([kind, logicalKey])) ? [logicalKey] : []
  ));
}

export async function loadUnifiedDurableOrderedTaskIdentities(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly identities: readonly {
      readonly kind: string;
      readonly logicalKey: string;
    }[];
  }
): Promise<Set<string>> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const identities = [...new Map(input.identities.map((identity) => {
    const kind = requiredText(identity.kind, "unified_planner_kind_invalid");
    const logicalKey = requiredText(
      identity.logicalKey,
      "unified_planner_logical_key_invalid"
    );
    return [JSON.stringify([kind, logicalKey]), { kind, logicalKey }];
  })).values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.logicalKey.localeCompare(right.logicalKey)
  );
  if (identities.length === 0) return new Set();
  const result = await db.query(
    `with requested(kind, logical_key) as (
       select * from unnest($2::text[], $3::text[])
     )
     select task.kind, task.logical_key
       from requested
       join unified_check_tasks task
         on task.run_id = $1
        and task.kind = requested.kind
        and task.logical_key = requested.logical_key
       join unified_check_planner_entries entry
         on entry.run_id = task.run_id and entry.task_id = task.id
      order by task.kind, task.logical_key`,
    [
      runId,
      identities.map(({ kind }) => kind),
      identities.map(({ logicalKey }) => logicalKey)
    ]
  );
  return new Set(result.rows.map((row) =>
    JSON.stringify([
      requiredText(row.kind, "unified_planner_kind_invalid"),
      requiredText(row.logical_key, "unified_planner_logical_key_invalid")
    ])
  ));
}

export async function loadUnifiedCommittedArtifacts(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly identities: readonly {
      readonly kind: string;
      readonly logicalKey: string;
    }[];
    readonly expectedArtifactKind: string;
    readonly expectedArtifactSchemaVersion: string;
  }
): Promise<UnifiedOrderedReadyEntry[]> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const expectedArtifactKind = requiredText(
    input.expectedArtifactKind,
    "unified_planner_artifact_kind_invalid"
  );
  const expectedArtifactSchemaVersion = requiredText(
    input.expectedArtifactSchemaVersion,
    "unified_planner_artifact_schema_invalid"
  );
  const identities = [...new Map(input.identities.map((identity) => {
    const kind = requiredText(identity.kind, "unified_planner_kind_invalid");
    const logicalKey = requiredText(
      identity.logicalKey,
      "unified_planner_logical_key_invalid"
    );
    return [JSON.stringify([kind, logicalKey]), { kind, logicalKey }];
  })).values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.logicalKey.localeCompare(right.logicalKey)
  );
  if (identities.length === 0) return [];
  const result = await db.query(
    `with requested(kind, logical_key) as (
       select * from unnest($2::text[], $3::text[])
     )
     select entry.canonical_sequence, entry.result_bytes, entry.task_id,
            task.kind as task_kind, task.logical_key as task_logical_key,
            task.status as task_status, task.accepted_attempt_id,
            attempt.id as attempt_id, attempt.task_id as attempt_task_id,
            attempt.artifact_sha256,
            artifact.kind as artifact_kind,
            artifact.schema_version as artifact_schema_version,
            artifact.artifact_json
       from requested
       join unified_check_tasks task
         on task.run_id = $1
        and task.kind = requested.kind
        and task.logical_key = requested.logical_key
       join unified_check_planner_entries entry
         on entry.run_id = task.run_id and entry.task_id = task.id
       left join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
        and attempt.task_id = task.id
       left join unified_check_artifacts artifact
         on artifact.sha256 = attempt.artifact_sha256
      where entry.planner_state = 'committed'
      order by entry.canonical_sequence`,
    [
      runId,
      identities.map(({ kind }) => kind),
      identities.map(({ logicalKey }) => logicalKey)
    ]
  );
  return result.rows.map((row) => orderedArtifactEntry(row, {
    taskKind: String(row.task_kind),
    artifactKind: expectedArtifactKind,
    artifactSchemaVersion: expectedArtifactSchemaVersion
  }));
}

export async function loadUnifiedBoundedReadyPrefix(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly maxEntries: number;
    readonly maxBytes: number;
    readonly expectedTaskKind: string;
    readonly expectedArtifactKind: string;
    readonly expectedArtifactSchemaVersion: string;
  }
): Promise<UnifiedOrderedReadyEntry[]> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const expectedTaskKind = requiredText(
    input.expectedTaskKind,
    "unified_planner_kind_invalid"
  );
  const expectedArtifactKind = requiredText(
    input.expectedArtifactKind,
    "unified_planner_artifact_kind_invalid"
  );
  const expectedArtifactSchemaVersion = requiredText(
    input.expectedArtifactSchemaVersion,
    "unified_planner_artifact_schema_invalid"
  );
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
            task.kind as task_kind, task.logical_key as task_logical_key,
            task.status as task_status, task.accepted_attempt_id,
            attempt.id as attempt_id, attempt.task_id as attempt_task_id,
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
        and attempt.task_id = task.id
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
    return orderedArtifactEntry(row, {
      taskKind: expectedTaskKind,
      artifactKind: expectedArtifactKind,
      artifactSchemaVersion: expectedArtifactSchemaVersion
    });
  });
}

export function canonicalOrderedDiscoveries(
  tasks: readonly UnifiedOrderedTaskDiscoveryInput[]
): UnifiedOrderedTaskDiscoveryInput[] {
  const byIdentity = new Map<string, UnifiedOrderedTaskDiscoveryInput>();
  for (const task of tasks) {
    if (
      !Number.isSafeInteger(task.parentCanonicalSequence) ||
      task.parentCanonicalSequence < -1
    ) {
      throw new TypeError("unified_planner_parent_sequence_invalid");
    }
    const identity = JSON.stringify([
      requiredText(task.kind, "unified_planner_kind_invalid"),
      requiredText(task.logicalKey, "unified_planner_logical_key_invalid")
    ]);
    const existing = byIdentity.get(identity);
    if (
      !existing ||
      task.parentCanonicalSequence < existing.parentCanonicalSequence
    ) {
      byIdentity.set(identity, task);
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.parentCanonicalSequence - right.parentCanonicalSequence ||
    left.kind.localeCompare(right.kind) ||
    left.logicalKey.localeCompare(right.logicalKey)
  );
}

export async function planUnifiedOrderedTasksInTransaction(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly tasks: readonly UnifiedOrderedTaskDiscoveryInput[];
  }
): Promise<PlannedTask[]> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const ordered = canonicalOrderedDiscoveries(input.tasks);
  if (ordered.length === 0) return [];
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

  for (const task of ordered) {
    if (!["interactive", "repair", "background"].includes(task.priorityLane)) {
      throw new TypeError("unified_planner_priority_lane_invalid");
    }
    const insertedTask = await client.query(
      `insert into unified_check_tasks (
        id, run_id, kind, status, priority_lane, logical_key, checkpoint_json
      ) values ($1,$2,$3,'QUEUED',$4,$5,$6::jsonb)
      on conflict (run_id, kind, logical_key) do nothing
      returning id, status, accepted_attempt_id`,
      [
        task.taskId,
        runId,
        task.kind,
        task.priorityLane,
        task.logicalKey,
        checkpointJson(task.checkpoint)
      ]
    );
    const durableTask = insertedTask.rows[0] ?? (
      await client.query(
        `select id, status, accepted_attempt_id
           from unified_check_tasks
          where run_id = $1 and kind = $2 and logical_key = $3
          for update`,
        [runId, task.kind, task.logicalKey]
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
        !["QUEUED", "WAITING_RETRY"].includes(String(durableTask.status)) ||
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
    return planUnifiedOrderedTasksInTransaction(client, {
      runId,
      tasks: input.tasks.map((task) => ({
        ...task,
        parentCanonicalSequence: -1
      }))
    });
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
    return (await admitBarrierHeadInTransaction(client, {
      runId,
      reservedBytes
    })).newlyAdmitted;
  });
}

export async function admitBarrierHeadInTransaction(
  db: UnifiedQueryable,
  input: { readonly runId: string; readonly reservedBytes: number }
): Promise<{ readonly newlyAdmitted: boolean }> {
  const runId = requiredText(input.runId, "unified_planner_run_id_invalid");
  const reservedBytes = safeNonNegativeInteger(
    input.reservedBytes,
    "unified_planner_reserved_bytes_invalid"
  );
  const head = (
    await db.query(
      `select entry.canonical_sequence, entry.planner_state,
              entry.admitted_at, entry.reserved_bytes, entry.result_bytes,
              entry.ready_at, entry.committed_at,
              task.id as task_id, task.status as task_status,
              task.accepted_attempt_id,
              accepted_attempt.id as verified_attempt_id,
              accepted_attempt.task_id as verified_attempt_task_id
         from unified_check_planner_entries entry
         join unified_check_tasks task
           on task.run_id = entry.run_id and task.id = entry.task_id
         left join unified_check_attempts accepted_attempt
           on accepted_attempt.id = task.accepted_attempt_id
          and accepted_attempt.task_id = task.id
        where entry.run_id = $1
          and entry.planner_state <> 'committed'
        order by entry.canonical_sequence
        limit 1
        for update of entry, task`,
      [runId]
    )
  ).rows[0];
  if (!head) return { newlyAdmitted: false };

  if (head.planner_state === "ready") {
    if (
      head.admitted_at === null ||
      head.reserved_bytes !== null ||
      head.result_bytes === null ||
      head.ready_at === null ||
      head.committed_at !== null ||
      head.task_status !== "COMPLETED" ||
      head.accepted_attempt_id === null ||
      head.verified_attempt_id !== head.accepted_attempt_id ||
      head.verified_attempt_task_id !== head.task_id
    ) {
      throw new Error("unified_ordered_next_head_not_admissible");
    }
    return { newlyAdmitted: false };
  }
  if (
    head.planner_state !== "planned" ||
    !["QUEUED", "WAITING_RETRY"].includes(String(head.task_status)) ||
    head.accepted_attempt_id !== null ||
    head.result_bytes !== null
  ) {
    throw new Error("unified_ordered_next_head_not_admissible");
  }
  if (head.admitted_at !== null) {
    if (Number(head.reserved_bytes) !== reservedBytes) {
      throw new Error("unified_ordered_next_head_not_admissible");
    }
    return { newlyAdmitted: false };
  }
  if (head.reserved_bytes !== null) {
    throw new Error("unified_ordered_next_head_not_admissible");
  }
  const admitted = await db.query(
    `update unified_check_planner_entries
        set admitted_at = statement_timestamp(), reserved_bytes = $3
      where run_id = $1
        and canonical_sequence = $2
        and planner_state = 'planned'
        and admitted_at is null
      returning task_id`,
    [runId, head.canonical_sequence, reservedBytes]
  );
  if (admitted.rows.length !== 1) {
    throw new Error("unified_ordered_next_head_not_admissible");
  }
  return { newlyAdmitted: true };
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
