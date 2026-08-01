import {
  buildMinimalUnifiedCheckCandidate,
  type MinimalBranchResult,
  type CompletedSlice,
  type UnifiedPresentedCompletionCandidateV1
} from "./orchestrator";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import {
  finalizeUnifiedRun,
  insertUnifiedArtifact,
  persistUnifiedPresentationDelivery,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";
import type { AnalysisRunRecord } from "./requestService";
import type { UnifiedWalletDossierV1 } from "./report";
import {
  assertUnifiedWriteAllowed,
  UNIFIED_CANARY_DEADLINE_MINUTES
} from "./contracts";

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
  if (
    input.run.runPurpose !== "synthetic_test" ||
    input.run.sideEffectPolicy !== "isolated"
  ) {
    throw new Error("unified_minimal_slice_must_be_isolated_synthetic");
  }
  await input.db.transaction(async (client) => {
    const candidate = buildMinimalUnifiedCheckCandidate({
      run: input.run,
      branches: input.branches
    });
    if (
      JSON.stringify(candidate.hashes) !== JSON.stringify(input.candidate.hashes) ||
      candidate.artifacts.size !== input.candidate.artifacts.size ||
      [...candidate.artifacts.keys()].some((hash) => !input.candidate.artifacts.has(hash))
    ) {
      throw new Error("unified_completion_candidate_mismatch");
    }
    const runRow = one(
      await client.query(
        "select * from unified_check_runs where id = $1 for update",
        [input.run.id]
      ),
      "unified_run_missing"
    );
    if (
      String(runRow.analysis_key_sha256) !== input.run.analysisKeySha256 ||
      String(runRow.subject_address) !== input.run.subjectAddress ||
      String(runRow.run_purpose) !== input.run.runPurpose ||
      String(runRow.side_effect_policy) !== input.run.sideEffectPolicy ||
      String(runRow.analysis_manifest_sha256) !== input.run.analysisManifestSha256
    ) {
      throw new Error("unified_completion_run_binding_mismatch");
    }
    if (
      runRow.run_purpose !== "synthetic_test" ||
      runRow.side_effect_policy !== "isolated"
    ) {
      throw new Error("unified_minimal_slice_must_be_isolated_synthetic");
    }
    if (runRow.status === "COMPLETED") {
      if (
        String(runRow.evidence_bundle_sha256) === candidate.hashes.evidence &&
        String(runRow.traversal_closure_sha256) === candidate.hashes.closure &&
        String(runRow.scoring_bundle_sha256) === candidate.hashes.scoring &&
        String(runRow.report_sha256) === candidate.hashes.report
      ) return;
      throw new Error("unified_completed_run_conflict");
    }
    if (runRow.status !== "RUNNING") throw new Error("unified_run_not_running");

    for (const [sha256, artifact] of candidate.artifacts) {
      await insertUnifiedArtifact(client, {
        sha256,
        createdByRunId: input.run.id,
        kind: candidate.artifactKinds.get(sha256) ?? "unknown",
        schemaVersion: "1",
        artifact
      });
    }
    for (const branch of input.branches) {
      await persistBranch(client, input.run, branch, candidate);
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
          candidate.report.score,
          candidate.report.decision,
          candidate.hashes.evidence,
          candidate.hashes.closure,
          candidate.hashes.scoring,
          candidate.hashes.report
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

export async function commitUnifiedPresentedCompletion(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly runId: string;
  readonly candidate: UnifiedPresentedCompletionCandidateV1;
}): Promise<void> {
  await input.db.transaction(async (client) => {
    const run = one(
      await client.query(
        "select * from unified_check_runs where id = $1 for update",
        [input.runId]
      ),
      "unified_run_missing"
    );
    assertUnifiedWriteAllowed({
      runPurpose: run.run_purpose,
      sideEffectPolicy: run.side_effect_policy,
      namespace: "authoritative_derived"
    });
    assertUnifiedWriteAllowed({
      runPurpose: run.run_purpose,
      sideEffectPolicy: run.side_effect_policy,
      namespace: "delivery_intent"
    });
    if (
      run.status !== "FINALIZING" ||
      Number(run.final_score ?? input.candidate.report.score) !==
        input.candidate.report.score
    ) {
      throw new Error("unified_presented_run_not_finalizing");
    }
    if (
      input.candidate.reportHash !==
        input.candidate.deliveries[0]?.presentation.manifest.reportHash
    ) {
      throw new Error("unified_presented_report_binding_invalid");
    }
    const requestRows = (await client.query(
      `select id, locale
         from unified_check_requests
        where run_id = $1 and status = 'ATTACHED'
          and side_effect_policy = 'authoritative'
        order by id`,
      [input.runId]
    )).rows;
    const expectedRequests = input.candidate.deliveries.map((item) => ({
      id: item.requestId,
      locale: item.presentation.manifest.locale
    })).sort((left, right) => left.id.localeCompare(right.id));
    const actualRequests = requestRows.map((row) => ({
      id: String(row.id),
      locale: String(row.locale)
    }));
    if (JSON.stringify(actualRequests) !== JSON.stringify(expectedRequests)) {
      throw new Error("unified_presented_recipient_set_mismatch");
    }
    await insertUnifiedArtifact(client, {
      sha256: input.candidate.reportHash,
      createdByRunId: input.runId,
      kind: "unified_wallet_report",
      schemaVersion: "1",
      artifact: input.candidate.report
    });
    await insertUnifiedArtifact(client, {
      sha256: input.candidate.report.factInventoryHash,
      createdByRunId: input.runId,
      kind: "report_fact_inventory",
      schemaVersion: "1",
      artifact: input.candidate.report.factInventory
    });
    for (const delivery of input.candidate.deliveries) {
      await persistUnifiedPresentationDelivery(client, {
        runId: input.runId,
        requestId: delivery.requestId,
        deliveryId: delivery.deliveryId,
        presentation: delivery.presentation
      });
    }
    const transactionHost: UnifiedTransactionalQueryable = {
      query: (sql, values) => client.query(sql, values),
      transaction: (work) => work(client)
    };
    const completed = await finalizeUnifiedRun(transactionHost, {
      runId: input.runId,
      finalScore: input.candidate.report.score,
      finalDecision: input.candidate.report.decision,
      evidenceBundleSha256: input.candidate.report.evidenceBundleHash,
      traversalClosureSha256: input.candidate.report.traversalClosureHash,
      scoringBundleSha256: input.candidate.report.scoringBundleHash,
      reportSha256: input.candidate.reportHash
    });
    if (completed === null) {
      throw new Error("unified_presented_completion_conflict");
    }
  });
}

export async function commitUnifiedIsolatedCanaryCompletion(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly runId: string;
  readonly report: UnifiedWalletDossierV1;
}): Promise<void> {
  await input.db.transaction(async (client) => {
    const run = one(
      await client.query(
        "select * from unified_check_runs where id = $1 for update",
        [input.runId]
      ),
      "unified_run_missing"
    );
    assertUnifiedWriteAllowed({
      runPurpose: run.run_purpose,
      sideEffectPolicy: run.side_effect_policy,
      namespace: "run_scoped_artifact"
    });
    if (
      run.status !== "FINALIZING" ||
      run.run_purpose !== "release_canary" ||
      run.side_effect_policy !== "isolated"
    ) {
      throw new Error("unified_canary_run_not_finalizing");
    }
    const deadline = one(
      await client.query(
        `select clock_timestamp() <
                  created_at + interval '${UNIFIED_CANARY_DEADLINE_MINUTES} minutes'
                    as before_deadline
           from unified_check_runs where id = $1`,
        [input.runId]
      ),
      "unified_canary_deadline_check_failed"
    );
    if (deadline.before_deadline !== true) {
      throw new Error("unified_canary_deadline_reached");
    }
    const requests = (
      await client.query(
        `select id from unified_check_requests
          where run_id = $1 and status = 'ATTACHED'`,
        [input.runId]
      )
    ).rows;
    if (requests.length !== 1) {
      throw new Error("unified_canary_request_set_invalid");
    }
    const deliveries = one(
      await client.query(
        `select count(*)::int as count
           from unified_check_deliveries delivery
           join unified_check_requests request
             on request.id = delivery.request_id
          where request.run_id = $1`,
        [input.runId]
      ),
      "unified_canary_delivery_gate_failed"
    );
    if (Number(deliveries.count) !== 0) {
      throw new Error("unified_canary_delivery_intent_forbidden");
    }
    const reportHash = fingerprintCanonicalArtifact(input.report);
    await insertUnifiedArtifact(client, {
      sha256: reportHash,
      createdByRunId: input.runId,
      kind: "unified_wallet_report",
      schemaVersion: "1",
      artifact: input.report
    });
    await insertUnifiedArtifact(client, {
      sha256: input.report.factInventoryHash,
      createdByRunId: input.runId,
      kind: "report_fact_inventory",
      schemaVersion: "1",
      artifact: input.report.factInventory
    });
    const transactionHost: UnifiedTransactionalQueryable = {
      query: (sql, values) => client.query(sql, values),
      transaction: (work) => work(client)
    };
    const completed = await finalizeUnifiedRun(transactionHost, {
      runId: input.runId,
      finalScore: input.report.score,
      finalDecision: input.report.decision,
      evidenceBundleSha256: input.report.evidenceBundleHash,
      traversalClosureSha256: input.report.traversalClosureHash,
      scoringBundleSha256: input.report.scoringBundleHash,
      reportSha256: reportHash
    });
    if (completed === null) {
      throw new Error("unified_canary_completion_conflict");
    }
  });
}
