import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
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

export type UnifiedTransactionalQueryable = UnifiedQueryable & {
  transaction<T>(work: (client: UnifiedQueryable) => Promise<T>): Promise<T>;
};

export function createUnifiedPoolTransactionHost(pool: UnifiedQueryable & {
  connect(): Promise<UnifiedQueryable & { release(error?: Error): void }>;
}): UnifiedTransactionalQueryable {
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(work) {
      const client = await pool.connect();
      let began = false;
      let releaseError: Error | undefined;
      try {
        await client.query("begin");
        began = true;
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        if (began) {
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            releaseError = rollbackError instanceof Error
              ? rollbackError
              : new Error("unified_transaction_rollback_failed");
          }
        } else {
          releaseError = error instanceof Error
            ? error
            : new Error("unified_transaction_begin_failed");
        }
        throw error;
      } finally {
        client.release(releaseError);
      }
    }
  };
}

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
    sideEffectPolicy: UnifiedSideEffectPolicy;
  }
) {
  const inserted = await db.query(
    `insert into unified_check_requests (
      id, request_correlation_id, subject_address, chat_id, message_thread_id,
      locale, run_purpose, side_effect_policy, status, accepted_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'ACCEPTED', statement_timestamp())
    on conflict (request_correlation_id) do nothing
    returning *`,
    [
      input.id,
      input.requestCorrelationId,
      input.subjectAddress,
      input.chatId,
      input.messageThreadId,
      input.locale,
      input.runPurpose,
      input.sideEffectPolicy
    ]
  );
  const row = inserted.rows[0] ?? requiredRow(
    await db.query(
      "select * from unified_check_requests where request_correlation_id = $1",
      [input.requestCorrelationId]
    ),
    "unified_request_reuse_failed"
  );
  if (
    String(row.subject_address) !== input.subjectAddress ||
    String(row.chat_id) !== input.chatId ||
    String(row.message_thread_id) !== input.messageThreadId ||
    String(row.locale) !== input.locale ||
    String(row.run_purpose) !== input.runPurpose ||
    String(row.side_effect_policy) !== input.sideEffectPolicy
  ) {
    throw new Error("unified_request_correlation_conflict");
  }
  return row;
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
  const actualSha256 = fingerprintCanonicalArtifact(input.artifact);
  if (actualSha256 !== input.sha256) {
    throw new Error("unified_artifact_hash_mismatch");
  }
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
  const row = inserted.rows[0] ?? requiredRow(
    await db.query(
      "select * from unified_check_artifacts where sha256 = $1",
      [input.sha256]
    ),
    "unified_artifact_insert_failed"
  );
  if (
    String(row.created_by_run_id) !== input.createdByRunId ||
    String(row.kind) !== input.kind ||
    String(row.schema_version) !== input.schemaVersion ||
    fingerprintCanonicalArtifact(row.artifact_json) !== input.sha256
  ) {
    throw new Error("unified_artifact_conflict");
  }
  return row;
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
  input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    checkpoint: unknown;
  }
) {
  const result = await db.query(
    `update unified_check_tasks
        set checkpoint_json = $3::jsonb, updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $4
      returning *`,
    [
      input.taskId,
      input.leaseToken,
      JSON.stringify(input.checkpoint),
      input.attempt
    ]
  );
  return result.rows[0] ?? null;
}

export async function completeUnifiedTaskAttempt(
  db: UnifiedTransactionalQueryable,
  input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
  }
) {
  return db.transaction(async (client) => {
    const task = requiredRow(
      await client.query(
        `select * from unified_check_tasks
          where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
          for update`,
        [input.taskId, input.leaseToken, input.attempt]
      ),
      "unified_task_lease_lost"
    );
    await client.query(
      `insert into unified_check_attempts (
        id, task_id, attempt, artifact_sha256, completed_at
      ) values ($1, $2, $3, $4, statement_timestamp())`,
      [input.attemptId, input.taskId, task.attempt, input.artifactSha256]
    );
    const result = await client.query(
      `update unified_check_tasks
          set status = 'COMPLETED', lease_owner = null, lease_token = null,
              lease_expires_at = null, heartbeat_at = null,
              updated_at = statement_timestamp()
        where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
        returning *`,
      [input.taskId, input.leaseToken, input.attempt]
    );
    return requiredRow(result, "unified_task_lease_lost");
  });
}

export async function settleUnifiedTaskLease(
  db: UnifiedQueryable,
  input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    status: "WAITING_RETRY" | "BLOCKED_ADMIN" | "FAILED_TECHNICAL" | "CANCELLED";
    readyAt?: string;
    checkpoint?: unknown;
    lastError?: string | null;
  }
) {
  const result = await db.query(
    `update unified_check_tasks
        set status = $4,
            ready_at = coalesce($5::timestamptz, ready_at),
            checkpoint_json = coalesce($6::jsonb, checkpoint_json),
            last_error = $7,
            lease_owner = null, lease_token = null,
            lease_expires_at = null, heartbeat_at = null,
            updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
      returning *`,
    [
      input.taskId,
      input.leaseToken,
      input.attempt,
      input.status,
      input.readyAt ?? null,
      input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint),
      input.lastError ?? null
    ]
  );
  return result.rows[0] ?? null;
}

export async function recordUnifiedTaskAttemptAndWait(
  db: UnifiedTransactionalQueryable,
  input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    readyAt: string;
    checkpoint?: unknown;
    lastError?: string | null;
  }
) {
  return db.transaction(async (client) => {
    requiredRow(
      await client.query(
        `select id from unified_check_tasks
          where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
          for update`,
        [input.taskId, input.leaseToken, input.attempt]
      ),
      "unified_task_lease_lost"
    );
    await client.query(
      `insert into unified_check_attempts (
        id, task_id, attempt, artifact_sha256, completed_at
      ) values ($1,$2,$3,$4,statement_timestamp())`,
      [input.attemptId, input.taskId, input.attempt, input.artifactSha256]
    );
    return requiredRow(
      await client.query(
        `update unified_check_tasks
            set status = 'WAITING_RETRY', ready_at = $4,
                checkpoint_json = coalesce($5::jsonb, checkpoint_json),
                last_error = $6,
                lease_owner = null, lease_token = null,
                lease_expires_at = null, heartbeat_at = null,
                updated_at = statement_timestamp()
          where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
          returning *`,
        [
          input.taskId,
          input.leaseToken,
          input.attempt,
          input.readyAt,
          input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint),
          input.lastError ?? null
        ]
      ),
      "unified_task_lease_lost"
    );
  });
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
  db: UnifiedTransactionalQueryable,
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
  return db.transaction(async (client) => {
    const run = requiredRow(
      await client.query(
        "select * from unified_check_runs where id = $1 and status = 'FINALIZING' for update",
        [input.runId]
      ),
      "unified_run_not_finalizing"
    );
    const references = [
      ["analysis_manifest", String(run.analysis_manifest_sha256)],
      ["evidence_bundle", input.evidenceBundleSha256],
      ["traversal_closure", input.traversalClosureSha256],
      ["scoring_bundle", input.scoringBundleSha256],
      ["unified_wallet_report", input.reportSha256]
    ] as const;
    const artifacts = new Map<string, Record<string, unknown>>();
    for (const [kind, sha256] of references) {
      const artifact = requiredRow(
        await client.query(
          `select created_by_run_id, kind, artifact_json
             from unified_check_artifacts where sha256 = $1`,
          [sha256]
        ),
        `unified_final_artifact_missing:${kind}`
      );
      if (
        String(artifact.created_by_run_id) !== input.runId ||
        String(artifact.kind) !== kind ||
        fingerprintCanonicalArtifact(artifact.artifact_json) !== sha256
      ) {
        throw new Error(`unified_final_artifact_mismatch:${kind}`);
      }
      if (
        typeof artifact.artifact_json !== "object" ||
        artifact.artifact_json === null ||
        Array.isArray(artifact.artifact_json)
      ) {
        throw new Error(`unified_final_artifact_shape:${kind}`);
      }
      artifacts.set(kind, artifact.artifact_json as Record<string, unknown>);
    }
    const manifest = artifacts.get("analysis_manifest")!;
    const evidence = artifacts.get("evidence_bundle")!;
    const closure = artifacts.get("traversal_closure")!;
    const scoring = artifacts.get("scoring_bundle")!;
    const report = artifacts.get("unified_wallet_report")!;
    const resolveLinkedArtifact = async (
      kind: string,
      sha256: unknown
    ): Promise<Record<string, unknown>> => {
      if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256)) {
        throw new Error(`unified_linked_artifact_hash_invalid:${kind}`);
      }
      const row = requiredRow(
        await client.query(
          `select artifact_json from unified_check_artifacts
            where sha256 = $1 and created_by_run_id = $2 and kind = $3`,
          [sha256, input.runId, kind]
        ),
        `unified_linked_artifact_missing:${kind}`
      );
      if (
        typeof row.artifact_json !== "object" ||
        row.artifact_json === null ||
        Array.isArray(row.artifact_json) ||
        fingerprintCanonicalArtifact(row.artifact_json) !== sha256
      ) {
        throw new Error(`unified_linked_artifact_mismatch:${kind}`);
      }
      return row.artifact_json as Record<string, unknown>;
    };
    if (
      evidence.analysisManifestHash !== run.analysis_manifest_sha256 ||
      closure.analysisManifestHash !== run.analysis_manifest_sha256 ||
      closure.snapshotHash !== manifest.snapshotHash ||
      scoring.evidenceBundleHash !== input.evidenceBundleSha256 ||
      scoring.traversalClosureHash !== input.traversalClosureSha256 ||
      report.analysisManifestHash !== run.analysis_manifest_sha256 ||
      report.evidenceBundleHash !== input.evidenceBundleSha256 ||
      report.traversalClosureHash !== input.traversalClosureSha256 ||
      report.scoringBundleHash !== input.scoringBundleSha256 ||
      Number(scoring.score) !== input.finalScore ||
      scoring.decision !== input.finalDecision ||
      Number(report.score) !== input.finalScore ||
      report.decision !== input.finalDecision
    ) {
      throw new Error("unified_final_artifact_chain_mismatch");
    }
    await resolveLinkedArtifact("confirmed_snapshot", manifest.snapshotHash);
    await resolveLinkedArtifact("canonical_facts", evidence.canonicalFactsHash);
    const visited = await resolveLinkedArtifact(
      "traversal_visited",
      closure.visitedStateHash
    );
    const frontier = await resolveLinkedArtifact(
      "traversal_frontier",
      closure.frontierHash
    );
    const scoreAnchor = await resolveLinkedArtifact(
      "score_anchor",
      scoring.scoreAnchorHash
    );
    const factInventory = await resolveLinkedArtifact(
      "report_fact_inventory",
      report.factInventoryHash
    );
    if (
      closure.closed !== true ||
      !Array.isArray(visited.states) ||
      !Array.isArray(frontier.states) ||
      frontier.states.length !== 0 ||
      Number(scoreAnchor.score) !== input.finalScore ||
      scoreAnchor.decision !== input.finalDecision ||
      !Array.isArray(evidence.canonicalFactIds) ||
      !Array.isArray(factInventory.canonicalFactIds) ||
      JSON.stringify(factInventory.canonicalFactIds) !==
        JSON.stringify(evidence.canonicalFactIds)
    ) {
      throw new Error("unified_linked_artifact_contract_mismatch");
    }
    const acceptedAttemptHashes = evidence.acceptedChildAttemptHashes;
    const branchOutputHashes = evidence.branchOutputHashes;
    const manifestBranchHashes = manifest.branchArtifactHashes;
    if (
      typeof acceptedAttemptHashes !== "object" ||
      acceptedAttemptHashes === null ||
      Array.isArray(acceptedAttemptHashes) ||
      Object.keys(acceptedAttemptHashes).sort().join(",") !== "deep,fast,where" ||
      typeof branchOutputHashes !== "object" ||
      branchOutputHashes === null ||
      Array.isArray(branchOutputHashes) ||
      Object.keys(branchOutputHashes).sort().join(",") !== "deep,fast,where" ||
      typeof manifestBranchHashes !== "object" ||
      manifestBranchHashes === null ||
      Array.isArray(manifestBranchHashes) ||
      Object.keys(manifestBranchHashes).sort().join(",") !== "deep,fast,where"
    ) {
      throw new Error("unified_final_attempt_chain_mismatch");
    }
    for (const branchId of ["fast", "deep", "where"] as const) {
      const attemptHash = String(
        (acceptedAttemptHashes as Record<string, unknown>)[branchId] ?? ""
      );
      const attempt = requiredRow(
        await client.query(
          `select artifact_json from unified_check_artifacts
            where sha256 = $1 and created_by_run_id = $2 and kind = 'child_attempt'`,
          [attemptHash, input.runId]
        ),
        `unified_final_attempt_missing:${branchId}`
      );
      const artifact = attempt.artifact_json as Record<string, unknown>;
      const inputHash = (manifestBranchHashes as Record<string, unknown>)[branchId];
      const outputHash = (branchOutputHashes as Record<string, unknown>)[branchId];
      if (
        fingerprintCanonicalArtifact(artifact) !== attemptHash ||
        artifact.runId !== input.runId ||
        artifact.branchId !== branchId ||
        artifact.inputHash !== inputHash ||
        artifact.outputHash !== outputHash ||
        !["COMPLETED", "NOT_APPLICABLE"].includes(String(artifact.status))
      ) {
        throw new Error(`unified_final_attempt_mismatch:${branchId}`);
      }
      const inputArtifact = await resolveLinkedArtifact(
        `${branchId}_branch_input`,
        inputHash
      );
      if (
        inputArtifact.runId !== undefined ||
        inputArtifact.branch !== branchId ||
        inputArtifact.snapshotHash !== manifest.snapshotHash
      ) {
        throw new Error(`unified_final_branch_input_mismatch:${branchId}`);
      }
      if (outputHash === null) {
        if (artifact.outputHash !== null) {
          throw new Error(`unified_final_branch_output_mismatch:${branchId}`);
        }
      } else {
        const outputArtifact = await resolveLinkedArtifact(
          `${branchId}_branch_output`,
          outputHash
        );
        if (
          outputArtifact.runId !== input.runId ||
          outputArtifact.branchId !== branchId
        ) {
          throw new Error(`unified_final_branch_output_mismatch:${branchId}`);
        }
      }
      const seenAttempts = new Set<string>([attemptHash]);
      let predecessor = artifact.previousAttemptHash;
      while (predecessor !== null) {
        if (typeof predecessor !== "string" || seenAttempts.has(predecessor)) {
          throw new Error(`unified_final_attempt_cycle:${branchId}`);
        }
        seenAttempts.add(predecessor);
        const prior = await resolveLinkedArtifact("child_attempt", predecessor);
        if (prior.runId !== input.runId || prior.branchId !== branchId) {
          throw new Error(`unified_final_attempt_predecessor_mismatch:${branchId}`);
        }
        predecessor = prior.previousAttemptHash;
      }
      const accepted = await client.query(
        `select task.id
           from unified_check_tasks task
           join unified_check_attempts attempt
             on attempt.id = task.accepted_attempt_id
          where task.run_id = $1 and task.kind = $2
            and task.status = 'COMPLETED'
            and attempt.artifact_sha256 = $3`,
        [input.runId, branchId, attemptHash]
      );
      if (accepted.rows.length !== 1) {
        throw new Error(`unified_final_accepted_attempt_mismatch:${branchId}`);
      }
    }
    const unfinished = requiredRow(
      await client.query(
        `select count(*)::int as count from unified_check_tasks
          where run_id = $1
            and (status <> 'COMPLETED' or accepted_attempt_id is null)`,
        [input.runId]
      ),
      "unified_task_gate_failed"
    );
    if (Number(unfinished.count) !== 0) throw new Error("unified_tasks_not_finalized");
    const result = await client.query(
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
    if (String(run.id) !== input.runId) throw new Error("unified_run_identity_mismatch");
    return result.rows[0] ?? null;
  });
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
