import type {
  UnifiedRunPurpose,
  UnifiedSideEffectPolicy
} from "./contracts";

export type UnifiedQueryable = {
  query(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
};

function requiredRow(
  result: { rows: Array<Record<string, unknown>> },
  code: string
) {
  const row = result.rows[0];
  if (!row) throw new Error(code);
  return row;
}

export async function createOrReuseUnifiedRun(
  db: UnifiedQueryable,
  input: {
    id: string;
    analysisKeySha256: string;
    subjectAddress: string;
    runPurpose: UnifiedRunPurpose;
    sideEffectPolicy: UnifiedSideEffectPolicy;
    analysisManifestSha256: string;
  }
) {
  const inserted = await db.query(
    `insert into unified_check_runs (
      id, analysis_key_sha256, subject_address, status, run_purpose,
      side_effect_policy, analysis_manifest_sha256
    ) values ($1, $2, $3, 'RUNNING', $4, $5, $6)
    on conflict do nothing
    returning *`,
    [
      input.id,
      input.analysisKeySha256,
      input.subjectAddress,
      input.runPurpose,
      input.sideEffectPolicy,
      input.analysisManifestSha256
    ]
  );
  const row =
    inserted.rows[0] ??
    requiredRow(
      await db.query(
        `select * from unified_check_runs
          where analysis_key_sha256 = $1 and status <> 'FAILED_TECHNICAL'
          order by created_at asc limit 1`,
        [input.analysisKeySha256]
      ),
      "unified_run_reuse_failed"
    );
  return row;
}

export async function createOrGetCheckRequest(
  db: UnifiedQueryable,
  input: {
    id: string;
    requestCorrelationId: string;
    subjectAddress: string;
    chatId: string;
    messageThreadId: string;
    locale: "ru" | "en";
    runPurpose: UnifiedRunPurpose;
  }
) {
  const inserted = await db.query(
    `insert into unified_check_requests (
      id, request_correlation_id, subject_address, chat_id, message_thread_id,
      locale, run_purpose, status, accepted_at
    ) values ($1, $2, $3, $4, $5, $6, $7, 'ACCEPTED', statement_timestamp())
    on conflict (request_correlation_id) do nothing
    returning *`,
    [
      input.id,
      input.requestCorrelationId,
      input.subjectAddress,
      input.chatId,
      input.messageThreadId,
      input.locale,
      input.runPurpose
    ]
  );
  return (
    inserted.rows[0] ??
    requiredRow(
      await db.query(
        "select * from unified_check_requests where request_correlation_id = $1",
        [input.requestCorrelationId]
      ),
      "unified_request_reuse_failed"
    )
  );
}

export async function insertUnifiedArtifact(
  db: UnifiedQueryable,
  input: {
    sha256: string;
    createdByRunId: string;
    kind: string;
    schemaVersion: string;
    artifact: unknown;
  }
) {
  const inserted = await db.query(
    `insert into unified_check_artifacts (
      sha256, created_by_run_id, kind, schema_version, artifact_json
    ) values ($1, $2, $3, $4, $5::jsonb)
    on conflict (sha256) do nothing
    returning *`,
    [
      input.sha256,
      input.createdByRunId,
      input.kind,
      input.schemaVersion,
      JSON.stringify(input.artifact)
    ]
  );
  return (
    inserted.rows[0] ??
    requiredRow(
      await db.query(
        "select * from unified_check_artifacts where sha256 = $1",
        [input.sha256]
      ),
      "unified_artifact_insert_failed"
    )
  );
}

export async function createUnifiedTasks(
  db: UnifiedQueryable,
  input: {
    runId: string;
    tasks: Array<{
      id: string;
      kind: string;
      priorityLane: "interactive" | "repair" | "background";
      logicalKey: string;
    }>;
  }
) {
  const rows = [];
  for (const task of input.tasks) {
    const result = await db.query(
      `insert into unified_check_tasks (
        id, run_id, kind, status, priority_lane, logical_key
      ) values ($1, $2, $3, 'QUEUED', $4, $5)
      on conflict (run_id, kind, logical_key) do nothing
      returning *`,
      [
        task.id,
        input.runId,
        task.kind,
        task.priorityLane,
        task.logicalKey
      ]
    );
    rows.push(
      result.rows[0] ??
        requiredRow(
          await db.query(
            `select * from unified_check_tasks
              where run_id = $1 and kind = $2 and logical_key = $3`,
            [input.runId, task.kind, task.logicalKey]
          ),
          "unified_task_create_failed"
        )
    );
  }
  return rows;
}

export async function claimUnifiedTask(
  db: UnifiedQueryable,
  input: {
    workerId: string;
    leaseToken: string;
    leaseMs: number;
  }
) {
  const result = await db.query(
    `with candidate as (
      select id from unified_check_tasks
       where status in ('QUEUED','WAITING_RETRY')
         and ready_at <= statement_timestamp()
       order by case priority_lane
         when 'interactive' then 0 when 'repair' then 1 else 2 end,
         ready_at, created_at
       for update skip locked
       limit 1
    )
    update unified_check_tasks task
       set status = 'LEASED',
           lease_owner = $1,
           lease_token = $2,
           lease_expires_at = statement_timestamp() + ($3::bigint * interval '1 millisecond'),
           heartbeat_at = statement_timestamp(),
           attempt = attempt + 1,
           updated_at = statement_timestamp()
      from candidate
     where task.id = candidate.id
    returning task.*`,
    [input.workerId, input.leaseToken, input.leaseMs]
  );
  return result.rows[0] ?? null;
}

export async function heartbeatUnifiedTask(
  db: UnifiedQueryable,
  input: { taskId: string; leaseToken: string; leaseMs: number }
) {
  const result = await db.query(
    `update unified_check_tasks
        set heartbeat_at = statement_timestamp(),
            lease_expires_at = statement_timestamp() + ($3::bigint * interval '1 millisecond'),
            updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED' and lease_token = $2
      returning *`,
    [input.taskId, input.leaseToken, input.leaseMs]
  );
  return result.rows[0] ?? null;
}

export async function checkpointUnifiedTask(
  db: UnifiedQueryable,
  input: { taskId: string; leaseToken: string; checkpoint: unknown }
) {
  const result = await db.query(
    `update unified_check_tasks
        set checkpoint_json = $3::jsonb, updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED' and lease_token = $2
      returning *`,
    [input.taskId, input.leaseToken, JSON.stringify(input.checkpoint)]
  );
  return result.rows[0] ?? null;
}

export async function completeUnifiedTaskAttempt(
  db: UnifiedQueryable,
  input: {
    taskId: string;
    leaseToken: string;
    attemptId: string;
    artifactSha256: string;
  }
) {
  await db.query("begin");
  try {
    const task = requiredRow(
      await db.query(
        `select * from unified_check_tasks
          where id = $1 and status = 'LEASED' and lease_token = $2
          for update`,
        [input.taskId, input.leaseToken]
      ),
      "unified_task_lease_lost"
    );
    await db.query(
      `insert into unified_check_attempts (
        id, task_id, attempt, artifact_sha256, completed_at
      ) values ($1, $2, $3, $4, statement_timestamp())`,
      [input.attemptId, input.taskId, task.attempt, input.artifactSha256]
    );
    const result = await db.query(
      `update unified_check_tasks
          set status = 'COMPLETED', lease_owner = null, lease_token = null,
              lease_expires_at = null, heartbeat_at = null,
              updated_at = statement_timestamp()
        where id = $1 and status = 'LEASED' and lease_token = $2
        returning *`,
      [input.taskId, input.leaseToken]
    );
    await db.query("commit");
    return requiredRow(result, "unified_task_lease_lost");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function selectAcceptedAttempt(
  db: UnifiedQueryable,
  input: { taskId: string; attemptId: string }
) {
  const result = await db.query(
    `update unified_check_tasks task
        set accepted_attempt_id = $2, updated_at = statement_timestamp()
      where task.id = $1
        and task.status = 'COMPLETED'
        and task.accepted_attempt_id is null
        and exists (
          select 1 from unified_check_attempts attempt
           where attempt.id = $2 and attempt.task_id = task.id
        )
      returning task.*`,
    [input.taskId, input.attemptId]
  );
  return result.rows[0] ?? null;
}

export async function finalizeUnifiedRun(
  db: UnifiedQueryable,
  input: {
    runId: string;
    finalScore: number;
    finalDecision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
    evidenceBundleSha256: string;
    traversalClosureSha256: string;
    scoringBundleSha256: string;
    reportSha256: string;
  }
) {
  const result = await db.query(
    `update unified_check_runs
        set status = 'COMPLETED', final_score = $2, final_decision = $3,
            evidence_bundle_sha256 = $4, traversal_closure_sha256 = $5,
            scoring_bundle_sha256 = $6, report_sha256 = $7,
            completed_at = statement_timestamp(), updated_at = statement_timestamp()
      where id = $1 and status = 'FINALIZING'
      returning *`,
    [
      input.runId,
      input.finalScore,
      input.finalDecision,
      input.evidenceBundleSha256,
      input.traversalClosureSha256,
      input.scoringBundleSha256,
      input.reportSha256
    ]
  );
  return result.rows[0] ?? null;
}

export async function createUnifiedDelivery(
  db: UnifiedQueryable,
  input: { id: string; requestId: string; presentationSha256: string }
) {
  const inserted = await db.query(
    `insert into unified_check_deliveries (
      id, request_id, presentation_sha256, status
    ) values ($1, $2, $3, 'PENDING')
    on conflict (request_id, presentation_sha256) do nothing
    returning *`,
    [input.id, input.requestId, input.presentationSha256]
  );
  return (
    inserted.rows[0] ??
    requiredRow(
      await db.query(
        `select * from unified_check_deliveries
          where request_id = $1 and presentation_sha256 = $2`,
        [input.requestId, input.presentationSha256]
      ),
      "unified_delivery_create_failed"
    )
  );
}

export async function claimUnifiedDelivery(
  db: UnifiedQueryable,
  input: { leaseToken: string; leaseMs: number }
) {
  const result = await db.query(
    `with candidate as (
      select id from unified_check_deliveries
       where status in ('PENDING','RETRYABLE')
       order by updated_at, created_at
       for update skip locked limit 1
    )
    update unified_check_deliveries delivery
       set status = 'LEASED', lease_token = $1,
           lease_expires_at = statement_timestamp() + ($2::bigint * interval '1 millisecond'),
           attempt_count = attempt_count + 1,
           updated_at = statement_timestamp()
      from candidate
     where delivery.id = candidate.id
    returning delivery.*`,
    [input.leaseToken, input.leaseMs]
  );
  return result.rows[0] ?? null;
}

export async function settleUnifiedDelivery(
  db: UnifiedQueryable,
  input: {
    deliveryId: string;
    leaseToken: string;
    status: "RETRYABLE" | "SENT_CONFIRMED" | "DELIVERY_UNKNOWN";
    lastError?: string | null;
    telegramMessageId?: string | null;
  }
) {
  const result = await db.query(
    `update unified_check_deliveries
        set status = $3, lease_token = null, lease_expires_at = null,
            last_error = $4, telegram_message_id = $5,
            updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED' and lease_token = $2
      returning *`,
    [
      input.deliveryId,
      input.leaseToken,
      input.status,
      input.lastError ?? null,
      input.telegramMessageId ?? null
    ]
  );
  return result.rows[0] ?? null;
}

export async function requestCanaryCancellation(
  db: UnifiedQueryable,
  input: { runId: string }
) {
  const result = await db.query(
    `update unified_check_tasks
        set cancellation_requested_at = statement_timestamp(),
            updated_at = statement_timestamp()
      where run_id = $1
        and status in ('QUEUED','LEASED','WAITING_RETRY','BLOCKED_ADMIN')
      returning *`,
    [input.runId]
  );
  return result.rows;
}
