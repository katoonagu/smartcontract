import type { MinimalBranchResult, CompletedSlice } from "./orchestrator";
import {
  insertUnifiedArtifact,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";
import type { AnalysisRunRecord } from "./requestService";

function one(
  result: { rows: Array<Record<string, unknown>> },
  code: string
): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new Error(code);
  return row;
}

async function persistBranch(
  db: UnifiedQueryable,
  run: AnalysisRunRecord,
  branch: MinimalBranchResult,
  candidate: CompletedSlice
): Promise<void> {
  const taskId = `${run.id}:${branch.branchId}`;
  const attemptHash = candidate.evidence.acceptedChildAttemptHashes[branch.branchId];
  await db.query(
    `insert into unified_check_tasks (
      id, run_id, kind, status, priority_lane, attempt, accepted_attempt_id,
      logical_key, checkpoint_json
    ) values ($1,$2,$3,'COMPLETED','interactive',1,null,'main','{}'::jsonb)
    on conflict (run_id, kind, logical_key) do nothing`,
    [taskId, run.id, branch.branchId]
  );
  await db.query(
    `insert into unified_check_attempts (
      id, task_id, attempt, artifact_sha256, completed_at
    ) values ($1,$2,1,$3,$4)
    on conflict (task_id, attempt) do nothing`,
    [branch.attemptId, taskId, attemptHash, branch.createdAt]
  );
  const accepted = one(
    await db.query(
      `update unified_check_tasks task
          set accepted_attempt_id = attempt.id, updated_at = statement_timestamp()
         from unified_check_attempts attempt
        where task.id = $1
          and attempt.task_id = task.id
          and attempt.id = $2
          and task.status = 'COMPLETED'
          and (task.accepted_attempt_id is null or task.accepted_attempt_id = attempt.id)
        returning task.*`,
      [taskId, branch.attemptId]
    ),
    `unified_attempt_accept_failed:${branch.branchId}`
  );
  if (String(accepted.run_id) !== run.id) {
    throw new Error(`unified_attempt_run_mismatch:${branch.branchId}`);
  }
}

export async function commitMinimalUnifiedCheck(input: {
  db: UnifiedTransactionalQueryable;
  run: AnalysisRunRecord;
  branches: readonly MinimalBranchResult[];
  candidate: CompletedSlice;
}): Promise<void> {
  await input.db.transaction(async (client) => {
    const runRow = one(
      await client.query(
        "select * from unified_check_runs where id = $1 for update",
        [input.run.id]
      ),
      "unified_run_missing"
    );
    if (runRow.status === "COMPLETED") {
      if (
        String(runRow.evidence_bundle_sha256) === input.candidate.hashes.evidence &&
        String(runRow.traversal_closure_sha256) === input.candidate.hashes.closure &&
        String(runRow.scoring_bundle_sha256) === input.candidate.hashes.scoring &&
        String(runRow.report_sha256) === input.candidate.hashes.report
      ) return;
      throw new Error("unified_completed_run_conflict");
    }
    if (runRow.status !== "RUNNING") throw new Error("unified_run_not_running");

    for (const [sha256, artifact] of input.candidate.artifacts) {
      await insertUnifiedArtifact(client, {
        sha256,
        createdByRunId: input.run.id,
        kind: input.candidate.artifactKinds.get(sha256) ?? "unknown",
        schemaVersion: "1",
        artifact
      });
    }
    for (const branch of input.branches) {
      await persistBranch(client, input.run, branch, input.candidate);
    }

    one(
      await client.query(
        `update unified_check_runs
            set status = 'FINALIZING', updated_at = statement_timestamp()
          where id = $1 and status = 'RUNNING'
          returning *`,
        [input.run.id]
      ),
      "unified_run_finalizing_failed"
    );
    const incomplete = one(
      await client.query(
        `select count(*)::int as count from unified_check_tasks
          where run_id = $1
            and (status <> 'COMPLETED' or accepted_attempt_id is null)`,
        [input.run.id]
      ),
      "unified_task_gate_failed"
    );
    if (Number(incomplete.count) !== 0) throw new Error("unified_tasks_not_finalized");
    one(
      await client.query(
        `update unified_check_runs
            set status = 'COMPLETED',
                final_score = $2,
                final_decision = $3,
                evidence_bundle_sha256 = $4,
                traversal_closure_sha256 = $5,
                scoring_bundle_sha256 = $6,
                report_sha256 = $7,
                completed_at = statement_timestamp(),
                updated_at = statement_timestamp()
          where id = $1 and status = 'FINALIZING'
          returning *`,
        [
          input.run.id,
          input.candidate.report.score,
          input.candidate.report.decision,
          input.candidate.hashes.evidence,
          input.candidate.hashes.closure,
          input.candidate.hashes.scoring,
          input.candidate.hashes.report
        ]
      ),
      "unified_run_complete_failed"
    );
    const deliveries = one(
      await client.query(
        `select count(*)::int as count
           from unified_check_deliveries delivery
           join unified_check_requests request on request.id = delivery.request_id
          where request.run_id = $1`,
        [input.run.id]
      ),
      "unified_delivery_gate_failed"
    );
    if (Number(deliveries.count) !== 0) {
      throw new Error("unified_minimal_slice_must_not_deliver");
    }
  });
}
