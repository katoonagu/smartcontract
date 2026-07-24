import { canonicalOrderedTasks } from "./planner";
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
        returning id`,
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
          `select id
             from unified_check_tasks
            where run_id = $1 and kind = $2 and logical_key = $3`,
          [runId, planned.task.kind, planned.task.logicalKey]
        )
      ).rows[0];
      if (!durableTask) throw new Error("unified_planner_task_reuse_failed");
      const taskId = String(durableTask.id);
      let planner = (
        await client.query(
          `select canonical_sequence
             from unified_check_planner_entries
            where run_id = $1 and task_id = $2`,
          [runId, taskId]
        )
      ).rows[0];
      if (!planner) {
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
    const admitted = await client.query(
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
  });
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
