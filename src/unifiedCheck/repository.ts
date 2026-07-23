import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type {
  DeliveryIntentV1,
  ManualUnifiedResendV1,
  UnifiedRunPurpose,
  UnifiedSideEffectPolicy
} from "./contracts";
import {
  buildPresentationManifest,
  renderUnifiedWalletPresentation,
  type UnifiedPresentationResultV1
} from "./presentation";
import type { UnifiedWalletDossierV1 } from "./report";
import type { UnifiedWatchdogRunV1 } from "./watchdog";

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
    kinds?: readonly string[];
  }
) {
  if (input.kinds?.length === 0) return null;
  const result = await db.query(
    `with candidate as (
      select task.id
        from unified_check_tasks task
        join unified_check_runs run on run.id = task.run_id
       where (
           (
             task.status in ('QUEUED','WAITING_RETRY')
             and task.ready_at <= statement_timestamp()
           ) or (
             task.status = 'LEASED'
             and task.lease_expires_at <= statement_timestamp()
           )
         )
         and run.status = 'RUNNING'
         and ($4::text[] is null or task.kind = any($4::text[]))
         and (
           task.kind <> 'traversal' or exists (
             select 1
               from unified_check_tasks prerequisite
              where prerequisite.run_id = task.run_id
                and prerequisite.kind = 'direct_history'
                and prerequisite.status = 'COMPLETED'
                and prerequisite.accepted_attempt_id is not null
           )
         )
         and (
           task.kind not in ('fast','where','deep') or exists (
             select 1
               from unified_check_tasks prerequisite
              where prerequisite.run_id = task.run_id
                and prerequisite.kind = 'traversal'
                and prerequisite.status = 'COMPLETED'
                and prerequisite.accepted_attempt_id is not null
           )
         )
       order by case task.priority_lane
         when 'interactive' then 0 when 'repair' then 1 else 2 end,
         task.ready_at, task.created_at
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
    [
      input.workerId,
      input.leaseToken,
      input.leaseMs,
      input.kinds ? [...input.kinds] : null
    ]
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
        set checkpoint_json = $3::jsonb,
            status = 'QUEUED',
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null,
            heartbeat_at = null,
            updated_at = statement_timestamp()
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
          set status = 'COMPLETED', accepted_attempt_id = $4,
              lease_owner = null, lease_token = null,
              lease_expires_at = null, heartbeat_at = null,
              updated_at = statement_timestamp()
        where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
        returning *`,
      [input.taskId, input.leaseToken, input.attempt, input.attemptId]
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
    const canonicalFacts = await resolveLinkedArtifact(
      "canonical_facts",
      evidence.canonicalFactsHash
    );
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
    const orderedUniqueFactIds = (value: unknown): string[] | null => {
      if (
        !Array.isArray(value) ||
        value.some((id) => typeof id !== "string" || id.length === 0)
      ) return null;
      const canonical = [...new Set(value)].sort();
      return JSON.stringify(value) === JSON.stringify(canonical)
        ? canonical
        : null;
    };
    const canonicalFactIds = Array.isArray(canonicalFacts.facts)
      ? orderedUniqueFactIds(canonicalFacts.facts.map((fact) =>
          typeof fact === "object" && fact !== null && !Array.isArray(fact)
            ? (fact as Record<string, unknown>).id
            : null
        ))
      : null;
    const evidenceFactIds = orderedUniqueFactIds(evidence.canonicalFactIds);
    const anchorFactIds = orderedUniqueFactIds(scoreAnchor.canonicalFactIds);
    const inventoryFactIds = orderedUniqueFactIds(factInventory.canonicalFactIds);
    if (
      closure.closed !== true ||
      !Array.isArray(visited.states) ||
      !Array.isArray(frontier.states) ||
      frontier.states.length !== 0 ||
      Number(scoreAnchor.score) !== input.finalScore ||
      scoreAnchor.decision !== input.finalDecision ||
      canonicalFactIds === null ||
      evidenceFactIds === null ||
      anchorFactIds === null ||
      inventoryFactIds === null ||
      JSON.stringify(canonicalFactIds) !== JSON.stringify(evidenceFactIds) ||
      JSON.stringify(canonicalFactIds) !== JSON.stringify(anchorFactIds) ||
      JSON.stringify(canonicalFactIds) !== JSON.stringify(inventoryFactIds)
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

export async function persistUnifiedPresentationDelivery(
  db: UnifiedQueryable,
  input: {
    runId: string;
    requestId: string;
    deliveryId: string;
    presentation: UnifiedPresentationResultV1;
  }
): Promise<{
  presentationSha256: string;
  receiptSha256: string;
  intentSha256: string;
}> {
  const request = requiredRow(
    await db.query(
      "select * from unified_check_requests where id = $1 for update",
      [input.requestId]
    ),
    "unified_delivery_request_missing"
  );
  if (
    String(request.run_id) !== input.runId ||
    request.status !== "ATTACHED" ||
    request.side_effect_policy !== "authoritative" ||
    request.locale !== input.presentation.manifest.locale
  ) {
    throw new Error("unified_delivery_request_binding_invalid");
  }
  const envelope = {
    version: "unified-presentation-envelope-v1" as const,
    manifest: input.presentation.manifest,
    artifact: input.presentation.artifact,
    receiptBodyHash: input.presentation.receiptBodyHash
  };
  const presentationSha256 = fingerprintCanonicalArtifact(envelope);
  const {
    presentationHash: _presentationHash,
    ...receiptBody
  } = input.presentation.receipt;
  if (
    presentationSha256 !== input.presentation.presentationHash ||
    input.presentation.receipt.presentationHash !== presentationSha256 ||
    fingerprintCanonicalArtifact(receiptBody) !==
      input.presentation.receiptBodyHash ||
    input.presentation.receipt.omittedCanonicalFactIds.length !== 0 ||
    input.presentation.payload.text !== input.presentation.artifact.html
  ) {
    throw new Error("unified_delivery_presentation_binding_invalid");
  }
  const receiptSha256 = fingerprintCanonicalArtifact(
    input.presentation.receipt
  );
  const intent: DeliveryIntentV1 = {
    version: "delivery-intent-v1",
    schemaVersion: 1,
    logicalRequestId: input.requestId,
    presentationHash: presentationSha256,
    payloadHash: fingerprintCanonicalArtifact(input.presentation.payload),
    sideEffectPolicy: "authoritative"
  };
  const intentSha256 = fingerprintCanonicalArtifact(intent);
  await insertUnifiedArtifact(db, {
    sha256: presentationSha256,
    createdByRunId: input.runId,
    kind: "presentation_envelope",
    schemaVersion: "1",
    artifact: envelope
  });
  await insertUnifiedArtifact(db, {
    sha256: receiptSha256,
    createdByRunId: input.runId,
    kind: "presentation_completeness_receipt",
    schemaVersion: "1",
    artifact: input.presentation.receipt
  });
  await insertUnifiedArtifact(db, {
    sha256: intentSha256,
    createdByRunId: input.runId,
    kind: "delivery_intent",
    schemaVersion: "1",
    artifact: intent
  });
  await createUnifiedDelivery(db, {
    id: input.deliveryId,
    requestId: input.requestId,
    presentationSha256
  });
  return { presentationSha256, receiptSha256, intentSha256 };
}

export async function ensureUnifiedPresentationForCompletedRequest(
  db: UnifiedTransactionalQueryable,
  input: { requestId: string; deliveryId: string }
): Promise<{
  presentationSha256: string;
  receiptSha256: string;
  intentSha256: string;
}> {
  return db.transaction(async (client) => {
    const request = requiredRow(
      await client.query(
        "select * from unified_check_requests where id = $1 for update",
        [input.requestId]
      ),
      "unified_delivery_request_missing"
    );
    const run = requiredRow(
      await client.query(
        "select * from unified_check_runs where id = $1 for update",
        [request.run_id]
      ),
      "unified_delivery_run_missing"
    );
    if (
      request.status !== "ATTACHED" ||
      request.side_effect_policy !== "authoritative" ||
      run.status !== "COMPLETED" ||
      typeof run.report_sha256 !== "string"
    ) {
      throw new Error("unified_delivery_completed_request_invalid");
    }
    const reportRow = requiredRow(
      await client.query(
        `select artifact_json from unified_check_artifacts
          where sha256 = $1 and kind = 'unified_wallet_report'`,
        [run.report_sha256]
      ),
      "unified_delivery_report_missing"
    );
    const report = reportRow.artifact_json as UnifiedWalletDossierV1;
    if (fingerprintCanonicalArtifact(report) !== run.report_sha256) {
      throw new Error("unified_delivery_report_hash_mismatch");
    }
    const locale = request.locale as "ru" | "en";
    const presentation = renderUnifiedWalletPresentation({
      report,
      manifest: buildPresentationManifest(report, locale)
    });
    return persistUnifiedPresentationDelivery(client, {
      runId: String(run.id),
      requestId: input.requestId,
      deliveryId: input.deliveryId,
      presentation
    });
  });
}

export async function persistManualUnifiedResend(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly operation: ManualUnifiedResendV1;
    readonly deliveryId: string;
    readonly warningPresentation: UnifiedPresentationResultV1;
  }
): Promise<void> {
  await db.transaction(async (client) => {
    const original = requiredRow(
      await client.query(
        `select delivery.*, request.run_id, request.locale
           from unified_check_deliveries delivery
           join unified_check_requests request on request.id = delivery.request_id
          where delivery.id = $1
          for update of delivery, request`,
        [input.operation.originalDeliveryId]
      ),
      "unified_manual_resend_original_missing"
    );
    const expectedWarning = original.locale === "ru"
      ? "⚠️ Ручная повторная отправка"
      : "⚠️ Manual resend";
    if (
      original.status !== "DELIVERY_UNKNOWN" ||
      String(original.presentation_sha256) !==
        input.operation.originalPresentationHash ||
      input.warningPresentation.presentationHash !==
        input.operation.warningPresentationHash ||
      input.operation.originalPresentationHash ===
        input.operation.warningPresentationHash ||
      !input.warningPresentation.artifact.html.includes(expectedWarning)
    ) {
      throw new Error("unified_manual_resend_binding_invalid");
    }
    const operationSha256 = fingerprintCanonicalArtifact(input.operation);
    await insertUnifiedArtifact(client, {
      sha256: operationSha256,
      createdByRunId: String(original.run_id),
      kind: "manual_resend_operation",
      schemaVersion: "1",
      artifact: input.operation
    });
    await persistUnifiedPresentationDelivery(client, {
      runId: String(original.run_id),
      requestId: String(original.request_id),
      deliveryId: input.deliveryId,
      presentation: input.warningPresentation
    });
  });
}

export async function loadUnifiedUnknownDeliveryPresentation(
  db: UnifiedQueryable,
  input: { readonly runId: string; readonly deliveryId: string }
): Promise<{
  readonly originalStatus: "DELIVERY_UNKNOWN";
  readonly originalPresentationHash: string;
  readonly presentation: UnifiedPresentationResultV1;
}> {
  const delivery = requiredRow(
    await db.query(
      `select delivery.*, request.run_id
         from unified_check_deliveries delivery
         join unified_check_requests request on request.id = delivery.request_id
        where delivery.id = $1 and request.run_id = $2`,
      [input.deliveryId, input.runId]
    ),
    "unified_manual_resend_original_missing"
  );
  if (delivery.status !== "DELIVERY_UNKNOWN") {
    throw new Error("unified_manual_resend_original_not_unknown");
  }
  const presentationHash = String(delivery.presentation_sha256);
  const envelopeRow = requiredRow(
    await db.query(
      `select artifact_json from unified_check_artifacts
        where sha256 = $1 and created_by_run_id = $2
          and kind = 'presentation_envelope'`,
      [presentationHash, input.runId]
    ),
    "unified_manual_resend_presentation_missing"
  );
  const receiptRows = (await db.query(
    `select artifact_json from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'presentation_completeness_receipt'
        and artifact_json->>'presentationHash' = $2`,
    [input.runId, presentationHash]
  )).rows;
  if (receiptRows.length !== 1) {
    throw new Error("unified_manual_resend_receipt_missing");
  }
  const envelope = object(envelopeRow.artifact_json);
  const manifest = envelope.manifest as
    UnifiedPresentationResultV1["manifest"];
  const artifact = envelope.artifact as
    UnifiedPresentationResultV1["artifact"];
  const receipt = receiptRows[0]!.artifact_json as
    UnifiedPresentationResultV1["receipt"];
  const receiptBodyHash = String(envelope.receiptBodyHash);
  const {
    presentationHash: _presentationHash,
    ...receiptBody
  } = receipt;
  const presentation: UnifiedPresentationResultV1 = {
    manifest,
    artifact,
    receipt,
    receiptBodyHash,
    presentationHash,
    payload: { text: artifact.html, parseMode: "HTML" }
  };
  if (
    fingerprintCanonicalArtifact({
      version: "unified-presentation-envelope-v1",
      manifest,
      artifact,
      receiptBodyHash
    }) !== presentationHash ||
    fingerprintCanonicalArtifact(receiptBody) !== receiptBodyHash ||
    receipt.presentationHash !== presentationHash ||
    receipt.omittedCanonicalFactIds.length !== 0 ||
    artifact.htmlHash !== fingerprintCanonicalArtifact(artifact.html)
  ) {
    throw new Error("unified_manual_resend_presentation_invalid");
  }
  return {
    originalStatus: "DELIVERY_UNKNOWN",
    originalPresentationHash: presentationHash,
    presentation
  };
}

export async function claimUnifiedDelivery(
  db: UnifiedQueryable,
  input: { leaseToken: string; leaseMs: number; now: Date }
) {
  if (Number.isNaN(input.now.getTime())) {
    throw new TypeError("unified_delivery_claim_time_invalid");
  }
  const result = await db.query(
    `with candidate as (
      select id from unified_check_deliveries
       where status = 'PENDING'
          or (
            status = 'RETRYABLE'
            and next_attempt_at is not null
            and next_attempt_at <= $3::timestamptz
          )
       order by updated_at, created_at
       for update skip locked limit 1
    )
    update unified_check_deliveries delivery
       set status = 'LEASED', lease_token = $1,
           lease_expires_at = statement_timestamp() + ($2::bigint * interval '1 millisecond'),
           next_attempt_at = null,
           attempt_count = attempt_count + 1,
           updated_at = statement_timestamp()
      from candidate
     where delivery.id = candidate.id
    returning delivery.*`,
    [input.leaseToken, input.leaseMs, input.now.toISOString()]
  );
  return result.rows[0] ?? null;
}

export async function markExpiredUnifiedDeliveryLeasesUnknown(
  db: UnifiedQueryable,
  input: { now: Date }
): Promise<number> {
  if (Number.isNaN(input.now.getTime())) {
    throw new TypeError("unified_delivery_recovery_time_invalid");
  }
  const result = await db.query(
    `update unified_check_deliveries
        set status = 'DELIVERY_UNKNOWN',
            lease_token = null,
            lease_expires_at = null,
            next_attempt_at = null,
            last_error = 'unified_delivery_lease_expired_after_handoff',
            updated_at = statement_timestamp()
      where status = 'LEASED'
        and lease_expires_at <= $1::timestamptz
      returning id`,
    [input.now.toISOString()]
  );
  return result.rows.length;
}

export async function settleUnifiedDelivery(
  db: UnifiedQueryable,
  input: {
    deliveryId: string;
    leaseToken: string;
    status:
      | "RETRYABLE"
      | "SENT_CONFIRMED"
      | "DELIVERY_UNKNOWN"
      | "BLOCKED_ADMIN";
    lastError?: string | null;
    telegramMessageId?: string | null;
    retryAt?: string | null;
  }
) {
  const retryAt = input.retryAt ?? null;
  if (
    (input.status === "RETRYABLE") !== (retryAt !== null) ||
    (retryAt !== null && Number.isNaN(Date.parse(retryAt)))
  ) {
    throw new TypeError("unified_delivery_retry_time_invalid");
  }
  const result = await db.query(
    `update unified_check_deliveries
        set status = $3, lease_token = null, lease_expires_at = null,
            last_error = $4, telegram_message_id = $5,
            next_attempt_at = $6::timestamptz,
            updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED' and lease_token = $2
      returning *`,
    [
      input.deliveryId,
      input.leaseToken,
      input.status,
      input.lastError ?? null,
      input.telegramMessageId ?? null,
      retryAt
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

function iso(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("unified_admin_invalid_timestamp");
  }
  return date.toISOString();
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function duration(value: unknown): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
}

export async function listUnifiedWatchdogRuns(
  db: UnifiedQueryable,
  input: { limit?: number } = {}
): Promise<UnifiedWatchdogRunV1[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const runs = (await db.query(
    "select * from unified_check_runs order by updated_at desc, id limit $1",
    [limit]
  )).rows;
  const fence = (await db.query(
    `select generation_id, delivery_generation, activated_at
       from unified_check_generation_fence
      where active = true
      order by activated_at desc, generation_id
      limit 1`
  )).rows[0];
  const result: UnifiedWatchdogRunV1[] = [];
  for (const run of runs) {
    const tasks = (await db.query(
      "select * from unified_check_tasks where run_id = $1 order by kind, id",
      [run.id]
    )).rows;
    const attempts = (await db.query(
      `select attempt.*, task.kind
         from unified_check_attempts attempt
         join unified_check_tasks task on task.id = attempt.task_id
        where task.run_id = $1
        order by task.kind, attempt.attempt`,
      [run.id]
    )).rows;
    const deliveries = (await db.query(
      `select delivery.*
         from unified_check_deliveries delivery
         join unified_check_requests request on request.id = delivery.request_id
        where request.run_id = $1
        order by delivery.created_at, delivery.id`,
      [run.id]
    )).rows;
    const manifestRow = (await db.query(
      "select artifact_json from unified_check_artifacts where sha256 = $1",
      [run.analysis_manifest_sha256]
    )).rows[0];
    const manifest = object(manifestRow?.artifact_json);
    // ponytail: Admin reads at most 500 runs; batch linked-artifact lookup if this
    // projection ever becomes a high-frequency API.
    const closureRow = run.traversal_closure_sha256 === null
      ? undefined
      : (await db.query(
          `select artifact_json from unified_check_artifacts
            where sha256 = $1 and kind = 'traversal_closure'`,
          [run.traversal_closure_sha256]
        )).rows[0];
    const closure = object(closureRow?.artifact_json);
    const visitedRow = typeof closure.visitedStateHash === "string"
      ? (await db.query(
          `select artifact_json from unified_check_artifacts
            where sha256 = $1 and kind = 'traversal_visited'`,
          [closure.visitedStateHash]
        )).rows[0]
      : undefined;
    const frontierRow = typeof closure.frontierHash === "string"
      ? (await db.query(
          `select artifact_json from unified_check_artifacts
            where sha256 = $1 and kind = 'traversal_frontier'`,
          [closure.frontierHash]
        )).rows[0]
      : undefined;
    const visited = object(visitedRow?.artifact_json);
    const frontier = object(frontierRow?.artifact_json);
    const createdAt = iso(run.created_at);
    result.push({
      id: String(run.id),
      subjectAddress: String(run.subject_address),
      status: run.status as UnifiedWatchdogRunV1["status"],
      statusReason: run.status_reason === null
        ? null
        : String(run.status_reason),
      runPurpose: run.run_purpose as UnifiedRunPurpose,
      sideEffectPolicy: run.side_effect_policy as UnifiedSideEffectPolicy,
      createdAt,
      updatedAt: iso(run.updated_at),
      completedAt: nullableIso(run.completed_at),
      canaryDeadlineAt: run.run_purpose === "release_canary"
        ? new Date(Date.parse(createdAt) + 35 * 60_000).toISOString()
        : null,
      finalScore: run.final_score === null ? null : Number(run.final_score),
      finalDecision: run.final_decision as
        UnifiedWatchdogRunV1["finalDecision"],
      hashes: {
        snapshot: String(manifest.snapshotHash ?? ""),
        analysisManifest: String(run.analysis_manifest_sha256),
        evidence: run.evidence_bundle_sha256 === null
          ? null
          : String(run.evidence_bundle_sha256),
        closure: run.traversal_closure_sha256 === null
          ? null
          : String(run.traversal_closure_sha256),
        scoring: run.scoring_bundle_sha256 === null
          ? null
          : String(run.scoring_bundle_sha256),
        report: run.report_sha256 === null
          ? null
          : String(run.report_sha256)
      },
      versions: {
        scoringPolicy: String(manifest.scoringPolicyVersion ?? ""),
        attributionPolicy: String(manifest.attributionPolicyVersion ?? ""),
        traversalPolicy: String(manifest.traversalPolicyVersion ?? ""),
        runtimeCommit: String(manifest.runtimeCommit ?? ""),
        databaseSchema: Number(manifest.databaseSchemaVersion ?? 0)
      },
      traversal: {
        closed: typeof closure.closed === "boolean" ? closure.closed : null,
        visitedCount: Array.isArray(visited.states)
          ? visited.states.length
          : null,
        frontierCount: Array.isArray(frontier.states)
          ? frontier.states.length
          : null
      },
      generation: {
        analysis: "unified",
        deliveryAuthority: fence?.delivery_generation === "unified"
          ? "unified"
          : fence?.delivery_generation === "legacy"
            ? "legacy"
            : "shadow",
        fenceId: fence === undefined ? null : String(fence.generation_id),
        activatedAt: fence === undefined ? null : iso(fence.activated_at)
      },
      tasks: tasks.map((task) => {
        const checkpoint = object(task.checkpoint_json);
        const providerState = ["ready", "waiting", "unavailable"].includes(
          String(checkpoint.providerState)
        )
          ? checkpoint.providerState as "ready" | "waiting" | "unavailable"
          : task.status === "WAITING_RETRY"
            ? "waiting"
            : "ready";
        return {
          id: String(task.id),
          kind: String(task.kind),
          status: task.status as UnifiedWatchdogRunV1["tasks"][number]["status"],
          priorityLane: task.priority_lane as
            "interactive" | "repair" | "background",
          readyAt: iso(task.ready_at),
          leaseExpiresAt: nullableIso(task.lease_expires_at),
          heartbeatAt: nullableIso(task.heartbeat_at),
          cancellationRequestedAt: nullableIso(task.cancellation_requested_at),
          providerState,
          checkpoint,
          attempts: attempts
            .filter((attempt) => attempt.task_id === task.id)
            .map((attempt) => ({
              id: String(attempt.id),
              attempt: Number(attempt.attempt),
              artifactSha256: attempt.artifact_sha256 === null
                ? null
                : String(attempt.artifact_sha256),
              completedAt: nullableIso(attempt.completed_at)
            })),
          durationsMs: {
            queue: duration(checkpoint.queueDurationMs),
            provider: duration(checkpoint.providerDurationMs),
            compute: duration(checkpoint.computeDurationMs)
          }
        };
      }),
      deliveries: deliveries.map((delivery) => ({
        id: String(delivery.id),
        status: delivery.status as
          UnifiedWatchdogRunV1["deliveries"][number]["status"],
        presentationSha256: String(delivery.presentation_sha256),
        attemptCount: Number(delivery.attempt_count),
        lastError: delivery.last_error === null
          ? null
          : String(delivery.last_error),
        telegramMessageId: delivery.telegram_message_id === null
          ? null
          : String(delivery.telegram_message_id)
      }))
    });
  }
  return result;
}

export async function applyUnifiedRecoveryAction(
  db: UnifiedTransactionalQueryable,
  input: {
    runId: string;
    action: "resume" | "fail-technical" | "retry-task";
    actorId: string;
    reason: string;
    targetId: string | null;
  }
): Promise<{ ok: boolean; code: string }> {
  return db.transaction(async (client) => {
    const action = {
      version: "unified-admin-recovery-action-v1",
      schemaVersion: 1,
      runId: input.runId,
      action: input.action,
      actorId: input.actorId,
      reason: input.reason,
      targetId: input.targetId
    } as const;
    if (
      input.runId.trim().length === 0 ||
      input.actorId.trim().length === 0 ||
      input.reason.trim().length === 0
    ) {
      return { ok: false, code: "invalid_audit_fields" };
    }
    let updated: Record<string, unknown> | undefined;
    if (input.action === "resume") {
      updated = (await client.query(
        `update unified_check_runs
            set status = 'RUNNING', status_reason = $2,
                updated_at = statement_timestamp()
          where id = $1 and status = 'BLOCKED_ADMIN'
          returning *`,
        [input.runId, `admin_resume:${input.reason}`]
      )).rows[0];
    } else if (input.action === "fail-technical") {
      updated = (await client.query(
        `update unified_check_runs
            set status = 'FAILED_TECHNICAL', status_reason = $2,
                final_score = null, final_decision = null,
                evidence_bundle_sha256 = null,
                traversal_closure_sha256 = null,
                scoring_bundle_sha256 = null,
                report_sha256 = null,
                updated_at = statement_timestamp()
          where id = $1 and status in (
            'RUNNING','WAITING_FOR_PROVIDER','BLOCKED_ADMIN','FINALIZING'
          )
          returning *`,
        [input.runId, `admin_failed_technical:${input.reason}`]
      )).rows[0];
      if (updated) {
        await client.query(
          `update unified_check_tasks
              set status = 'CANCELLED',
                  cancellation_requested_at = statement_timestamp(),
                  lease_owner = null, lease_token = null,
                  lease_expires_at = null, heartbeat_at = null,
                  last_error = 'parent_failed_technical',
                  updated_at = statement_timestamp()
            where run_id = $1
              and status in (
                'QUEUED','LEASED','WAITING_RETRY',
                'BLOCKED_ADMIN','FAILED_TECHNICAL'
              )`,
          [input.runId]
        );
      }
    } else if (input.targetId !== null) {
      updated = (await client.query(
        `update unified_check_tasks
            set status = 'QUEUED', priority_lane = 'repair',
                ready_at = statement_timestamp(),
                lease_owner = null, lease_token = null,
                lease_expires_at = null, heartbeat_at = null,
                last_error = null, updated_at = statement_timestamp()
          where id = $1 and run_id = $2
            and status in ('BLOCKED_ADMIN','FAILED_TECHNICAL')
            and exists (
              select 1 from unified_check_runs run
               where run.id = $2 and run.status in ('RUNNING','BLOCKED_ADMIN')
            )
          returning *`,
        [input.targetId, input.runId]
      )).rows[0];
      if (updated) {
        await client.query(
          `update unified_check_runs
              set status = 'RUNNING', status_reason = $2,
                  updated_at = statement_timestamp()
            where id = $1 and status in ('RUNNING','BLOCKED_ADMIN')`,
          [input.runId, `admin_retry_task:${input.reason}`]
        );
      }
    }
    if (!updated) return { ok: false, code: "recovery_transition_conflict" };
    const sha256 = fingerprintCanonicalArtifact(action);
    await insertUnifiedArtifact(client, {
      sha256,
      createdByRunId: input.runId,
      kind: "admin_recovery_action",
      schemaVersion: "1",
      artifact: action
    });
    return { ok: true, code: input.action };
  });
}
