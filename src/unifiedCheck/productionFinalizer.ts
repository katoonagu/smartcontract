import {
  buildUnifiedPresentedCompletionCandidate
} from "./orchestrator";
import {
  commitUnifiedIsolatedCanaryCompletion,
  commitUnifiedPresentedCompletion
} from "./durableCompletion";
import {
  ensureUnifiedPresentationForCompletedRequest,
  insertUnifiedArtifact,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1
} from "./contracts";
import {
  assertUnifiedWriteAllowed,
  UNIFIED_CANARY_DEADLINE_MINUTES
} from "./contracts";
import type { UnifiedBranchArtifactV1 } from "./branchAdapters";
import {
  canonicalizeUnifiedDirectHistoryPages,
  type UnifiedDirectHistoryArtifactV1,
  type UnifiedDirectHistoryPageArtifactV1
} from "./productionDirectHistory";
import {
  buildUnifiedProductionCompletionCandidate,
  type CompletedProductionBranch
} from "./productionCompletion";
import type { IndexedTronUsdtTransfer } from "../types";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type {
  UnifiedTraversalArtifactV1
} from "./productionTraversal";

function one(
  result: { rows: Array<Record<string, unknown>> },
  code: string
): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new Error(code);
  return row;
}

async function artifact<T>(
  db: UnifiedQueryable,
  input: {
    runId: string;
    sha256: string;
    kind: string;
  }
): Promise<T> {
  const row = one(
    await db.query(
      `select artifact_json
         from unified_check_artifacts
        where sha256 = $1 and created_by_run_id = $2 and kind = $3`,
      [input.sha256, input.runId, input.kind]
    ),
    `unified_production_artifact_missing:${input.kind}`
  );
  if (fingerprintCanonicalArtifact(row.artifact_json) !== input.sha256) {
    throw new Error(`unified_production_artifact_mismatch:${input.kind}`);
  }
  return row.artifact_json as T;
}

function indexedEvent(value: Omit<
  IndexedTronUsdtTransfer,
  "blockTimestamp"
> & { readonly blockTimestamp: string }): IndexedTronUsdtTransfer {
  const timestamp = new Date(value.blockTimestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("unified_production_event_timestamp_invalid");
  }
  return { ...value, blockTimestamp: timestamp };
}

function knownCounterparties(
  branches: readonly CompletedProductionBranch[]
): Map<string, readonly string[]> {
  const result = new Map<string, readonly string[]>();
  for (const branch of branches) {
    for (const fact of branch.output.analysis.facts) {
      if (
        fact === null ||
        typeof fact !== "object" ||
        Array.isArray(fact)
      ) continue;
      const record = fact as Record<string, unknown>;
      const payload = record.payload;
      if (
        record.factType !== "service_link" ||
        typeof record.counterpartyOrObject !== "string" ||
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !Array.isArray((payload as Record<string, unknown>).labels)
      ) continue;
      const labels = (payload as Record<string, unknown>).labels as unknown[];
      if (labels.every((label: unknown) => typeof label === "string")) {
        result.set(
          record.counterpartyOrObject,
          [...new Set(labels as string[])].sort()
        );
      }
    }
  }
  return result;
}

export async function runUnifiedProductionFinalizationCycle(input: {
  db: UnifiedTransactionalQueryable;
  now(): Date;
  createId(): string;
  runtimeCommit: string;
  providerConfigurationSha256: string;
  runPurpose?: "user_check" | "admin_diagnostic" | "release_canary" |
    "synthetic_test" | "maintenance";
}): Promise<{ finalized: boolean; runId: string | null }> {
  if (!/^[0-9a-f]{64}$/u.test(input.providerConfigurationSha256)) {
    throw new TypeError(
      "unified_production_provider_configuration_invalid"
    );
  }
  return input.db.transaction(async (client) => {
    const run = (
      await client.query(
        `select run.*
           from unified_check_runs run
           join unified_check_artifacts manifest
             on manifest.sha256 = run.analysis_manifest_sha256
            and manifest.kind = 'analysis_manifest'
          where run.status = 'RUNNING'
            and (
              (
                run.run_purpose = 'user_check'
                and run.side_effect_policy = 'authoritative'
              ) or (
                run.run_purpose = 'release_canary'
                and run.side_effect_policy = 'isolated'
              )
            )
            and (
              run.run_purpose <> 'release_canary' or
              clock_timestamp() <
                run.created_at +
                  interval '${UNIFIED_CANARY_DEADLINE_MINUTES} minutes'
            )
            and ($1::text is null or run.run_purpose = $1)
            and manifest.artifact_json->>'runtimeCommit' = $2
            and (
              run.run_purpose <> 'release_canary' or exists (
                select 1
                  from unified_check_requests request
                  join unified_check_artifacts batch_identity
                    on batch_identity.sha256 =
                      substring(request.chat_id from 8)
                   and batch_identity.kind = 'canary_batch_identity'
                 where request.run_id = run.id
                   and request.run_purpose = 'release_canary'
                   and batch_identity.artifact_json#>>
                     '{providerConfiguration,sha256}' = $3
              )
            )
            and (
              select count(*) from unified_check_tasks task
               where task.run_id = run.id
                  and task.kind in (
                    'direct_history','traversal','fast','where','deep'
                  )
                 and task.status = 'COMPLETED'
                 and task.accepted_attempt_id is not null
             ) = 5
            and not exists (
              select 1 from unified_check_tasks task
               where task.run_id = run.id
                 and (
                   task.status <> 'COMPLETED' or
                   task.accepted_attempt_id is null
                 )
            )
          order by run.created_at, run.id
          for update skip locked
          limit 1`,
        [
          input.runPurpose ?? null,
          input.runtimeCommit,
          input.providerConfigurationSha256
        ]
      )
    ).rows[0];
    if (!run) return { finalized: false, runId: null };
    const runId = String(run.id);
    assertUnifiedWriteAllowed({
      runPurpose: run.run_purpose,
      sideEffectPolicy: run.side_effect_policy,
      namespace: "run_scoped_artifact"
    });
    const manifest = await artifact<AnalysisManifestV1>(client, {
      runId,
      sha256: String(run.analysis_manifest_sha256),
      kind: "analysis_manifest"
    });
    const labelDataset = one(
      await client.query(
        "select dataset_json from unified_label_datasets where sha256 = $1",
        [manifest.labelDatasetSha256]
      ),
      "unified_production_label_dataset_missing"
    );
    if (
      fingerprintCanonicalArtifact(labelDataset.dataset_json) !==
        manifest.labelDatasetSha256
    ) {
      throw new Error("unified_production_label_dataset_mismatch");
    }
    const accepted = (
      await client.query(
        `select task.id as task_id, task.kind, attempt.artifact_sha256
           from unified_check_tasks task
           join unified_check_attempts attempt
             on attempt.id = task.accepted_attempt_id
          where task.run_id = $1
          order by task.kind`,
        [runId]
      )
    ).rows;
    const directRow = accepted.find((row) => row.kind === "direct_history");
    if (!directRow) throw new Error("unified_production_direct_history_missing");
    const direct = await artifact<UnifiedDirectHistoryArtifactV1>(client, {
      runId,
      sha256: String(directRow.artifact_sha256),
      kind: "direct_history"
    });
    if (
      direct.runId !== runId ||
      direct.analysisManifestHash !== String(run.analysis_manifest_sha256) ||
      direct.snapshotHash !== manifest.snapshotHash ||
      direct.reachedAccountCreation !== true
    ) {
      throw new Error("unified_production_direct_history_mismatch");
    }
    const directPages: UnifiedDirectHistoryPageArtifactV1[] = [];
    for (const pageHash of direct.pageArtifactHashes) {
      const page = await artifact<UnifiedDirectHistoryPageArtifactV1>(client, {
        runId,
        sha256: pageHash,
        kind: "direct_history_page"
      });
      if (page.runId !== runId) {
        throw new Error("unified_production_direct_page_run_mismatch");
      }
      directPages.push(page);
    }
    const canonicalDirect = canonicalizeUnifiedDirectHistoryPages(
      directPages
    );
    if (
      canonicalDirect.eventCount !== direct.eventCount ||
      canonicalDirect.eventIndexHash !== direct.eventIndexHash
    ) {
      throw new Error("unified_production_direct_history_index_mismatch");
    }
    const directEvents: IndexedTronUsdtTransfer[] =
      canonicalDirect.events.map(indexedEvent);
    const traversalRow = accepted.find((row) =>
      row.kind === "traversal"
    );
    if (!traversalRow) {
      throw new Error("unified_production_traversal_missing");
    }
    const traversal = await artifact<UnifiedTraversalArtifactV1>(client, {
      runId,
      sha256: String(traversalRow.artifact_sha256),
      kind: "traversal_result"
    });
    const branches: CompletedProductionBranch[] = [];
    for (const branchId of ["fast", "where", "deep"] as const) {
      const row = accepted.find((candidate) => candidate.kind === branchId);
      if (!row) throw new Error(`unified_production_branch_missing:${branchId}`);
      const attemptHash = String(row.artifact_sha256);
      const attempt = await artifact<ChildAttemptArtifactV1>(client, {
        runId,
        sha256: attemptHash,
        kind: "child_attempt"
      });
      if (
        attempt.runId !== runId ||
        attempt.branchId !== branchId ||
        attempt.outputHash === null
      ) {
        throw new Error(`unified_production_attempt_mismatch:${branchId}`);
      }
      const outputHash = attempt.outputHash;
      const output = await artifact<UnifiedBranchArtifactV1>(client, {
        runId,
        sha256: outputHash,
        kind: `${branchId}_branch_output`
      });
      branches.push({
        branchId,
        output,
        outputHash,
        attempt,
        attemptHash
      });
    }
    const candidate = buildUnifiedProductionCompletionCandidate({
      manifest,
      directEvents,
      knownCounterparties: knownCounterparties(branches),
      branches,
      traversal
    });
    for (const [sha256, value] of candidate.artifacts) {
      await insertUnifiedArtifact(client, {
        sha256,
        createdByRunId: runId,
        kind: candidate.artifactKinds.get(sha256) ??
          "unified_production_unknown",
        schemaVersion: "1",
        artifact: value
      });
    }
    one(
      await client.query(
        `update unified_check_runs
            set status = 'FINALIZING',
                updated_at = statement_timestamp()
          where id = $1 and status = 'RUNNING'
          returning *`,
        [runId]
      ),
      "unified_production_finalizing_failed"
    );
    const transactionHost: UnifiedTransactionalQueryable = {
      query: (sql, values) => client.query(sql, values),
      transaction: (work) => work(client)
    };
    if (
      run.run_purpose === "release_canary" &&
      run.side_effect_policy === "isolated"
    ) {
      await commitUnifiedIsolatedCanaryCompletion({
        db: transactionHost,
        runId,
        report: candidate.dossier
      });
    } else {
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
      const requests = (
        await client.query(
          `select id, locale
             from unified_check_requests
            where run_id = $1 and status = 'ATTACHED'
              and side_effect_policy = 'authoritative'
            order by id`,
          [runId]
        )
      ).rows;
      const presented = buildUnifiedPresentedCompletionCandidate({
        report: candidate.dossier,
        recipients: requests.map((request) => ({
          requestId: String(request.id),
          deliveryId: input.createId(),
          locale: request.locale as "ru" | "en"
        }))
      });
      await commitUnifiedPresentedCompletion({
        db: transactionHost,
        runId,
        candidate: presented
      });
    }
    void input.now();
    return { finalized: true, runId };
  });
}

export async function runUnifiedCompletedPresentationReconciliationCycle(input: {
  db: UnifiedTransactionalQueryable;
  createId(): string;
}): Promise<{ reconciled: boolean; requestId: string | null }> {
  const request = (
    await input.db.query(
      `select request.id
         from unified_check_requests request
         join unified_check_runs run on run.id = request.run_id
        where request.status = 'ATTACHED'
          and request.side_effect_policy = 'authoritative'
          and run.status = 'COMPLETED'
          and run.run_purpose = 'user_check'
          and not exists (
            select 1
              from unified_check_deliveries delivery
             where delivery.request_id = request.id
          )
        order by request.accepted_at, request.id
        limit 1`
    )
  ).rows[0];
  if (!request) return { reconciled: false, requestId: null };
  const requestId = String(request.id);
  await ensureUnifiedPresentationForCompletedRequest(input.db, {
    requestId,
    deliveryId: input.createId()
  });
  return { reconciled: true, requestId };
}
