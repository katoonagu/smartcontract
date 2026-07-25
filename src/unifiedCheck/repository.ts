import { createHash } from "node:crypto";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import { addressHistoryManifestKey } from "./addressHistory";
import type {
  UnifiedCanaryBatchIdentityV1,
  UnifiedCanaryExecutionBlockedV1,
  UnifiedCanaryIsolationAuditV1,
  UnifiedCanarySelectionManifestV1
} from "./canary";
import type {
  DeliveryIntentV1,
  ManualUnifiedResendV1,
  UnifiedRunPurpose,
  UnifiedSideEffectPolicy
} from "./contracts";
import { assertUnifiedWriteAllowed } from "./contracts";
import {
  buildPresentationManifest,
  renderUnifiedWalletPresentation,
  type UnifiedPresentationResultV1
} from "./presentation";
import type { UnifiedWalletDossierV1 } from "./report";
import type { UnifiedWatchdogRunV1 } from "./watchdog";
import type {
  AddressHistoryManifestIdentityV1,
  AddressHistoryManifestV1
} from "./addressHistory";
import {
  projectUnifiedProgress,
  type UnifiedProgressInputV1,
  type UnifiedProgressLifecycleV1,
  type UnifiedProgressPhaseV1,
  type UnifiedProgressProjectionV1
} from "./progressProjection";
import {
  projectUnifiedAdminRunSnapshot,
  type UnifiedAdminRunDecision,
  type UnifiedAdminRunSnapshot
} from "./adminRunSnapshot";
import type {
  UnifiedAcceptedArtifact,
  UnifiedOrderedCommitExpectation
} from "./worker";
import {
  admitBarrierHeadInTransaction,
  planUnifiedOrderedTasksInTransaction
} from "./plannerRepository";
import {
  markUnifiedPlannerResultReady
} from "./planner";
import {
  createUnifiedAdaptiveEvent,
  emitBestEffort,
  type UnifiedAdaptiveEvent
} from "./adaptiveObservability";

export type { UnifiedOrderedCommitExpectation } from "./worker";

export const DEFAULT_UNIFIED_ORDERED_MANIFEST_MAX_BYTES = 1_048_576;

export const UNIFIED_CANARY_SELECTION_QUERY_VERSION =
  "unified-canary-selection-query-v1" as const;

export const UNIFIED_CANARY_SELECTION_QUERY = `
with eligible as (
  select
    'unified_check_requests'::text as source_table,
    id as source_row_id,
    subject_address,
    run_purpose,
    locale,
    accepted_at,
    created_at,
    true as proven_user_origin
  from unified_check_requests
  where run_purpose = 'user_check'
  union all
  select
    'forensic_check_jobs'::text as source_table,
    job.id as source_row_id,
    job.subject_address,
    'user_check'::text as run_purpose,
    case when job.progress_json->>'locale' = 'en' then 'en' else 'ru' end,
    job.created_at as accepted_at,
    job.created_at,
    true as proven_user_origin
  from forensic_check_jobs job
  where job.kind = 'address_fast_check'
    and job.chat_id is not null
    and job.requested_by is not null
    and exists (
      select 1 from telegram_users telegram_user
       where telegram_user.telegram_user_id = job.requested_by
    )
)
select *
from eligible
where greatest(accepted_at, created_at) <= $1::timestamptz
order by greatest(accepted_at, created_at) desc, subject_address asc,
         source_table asc, source_row_id asc
`.trim();

export type UnifiedQueryable = {
  query(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
};

export type UnifiedTransactionalQueryable = UnifiedQueryable & {
  transaction<T>(work: (client: UnifiedQueryable) => Promise<T>): Promise<T>;
};

function progressNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("unified_progress_repository_number_invalid");
  }
  return parsed;
}

export async function loadUnifiedProgressProjection(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly now: Date;
    readonly configuredSlots: number;
    readonly keyGroups?: UnifiedProgressInputV1["provider"]["keyGroups"];
  }
): Promise<UnifiedProgressProjectionV1> {
  if (!Number.isSafeInteger(input.configuredSlots) || input.configuredSlots < 1) {
    throw new TypeError("unified_progress_slots_invalid");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new TypeError("unified_progress_clock_invalid");
  }
  const row = (
    await db.query(
      `with selected_run as (
         select *
           from unified_check_runs
          where id = $1
       ),
       task_rollup as (
         select
           count(*) filter (
             where kind = 'address_history'
               and status not in ('COMPLETED','CANCELLED')
           )::int as address_outstanding,
           count(*) filter (
             where kind in ('direct_history','address_history','deep_direct')
               and status = 'LEASED'
               and lease_expires_at > $2::timestamptz
           )::int as provider_active,
           count(*) filter (
             where kind in ('direct_history','address_history','deep_direct')
               and status = 'WAITING_RETRY'
           )::int as provider_cooldown,
           coalesce(sum(
             coalesce(
               (checkpoint_json->'performanceCounters'->>'providerCalls')::bigint,
               0
             )
           ),0)::bigint as provider_calls,
           coalesce(sum(
             coalesce(
               (checkpoint_json->'performanceCounters'->>'networkFetches')::bigint,
               0
             )
           ),0)::bigint as network_fetches,
           coalesce(sum(
             coalesce(
               (checkpoint_json->'performanceCounters'->>'providerCacheHits')::bigint,
               0
             )
           ),0)::bigint as provider_cache_hits,
           coalesce(sum(pg_column_size(checkpoint_json)),0)::bigint
             as checkpoint_bytes,
           bool_or(kind = 'direct_history' and status <> 'COMPLETED')
             as direct_incomplete,
           bool_or(kind = 'traversal' and status <> 'COMPLETED')
             as traversal_incomplete,
           bool_or(
             kind in ('fast','where','deep') and status <> 'COMPLETED'
           ) as branches_incomplete,
           (
             coalesce(
               jsonb_agg(checkpoint_json) filter (where kind = 'traversal'),
               '[]'::jsonb
             )->0
           ) as traversal_checkpoint
         from unified_check_tasks
        where run_id = $1
       ),
       delta_rollup as (
         select coalesce(sum(pg_column_size(artifact_json)),0)::bigint
                  as delta_bytes
           from unified_check_artifacts
          where created_by_run_id = $1 and kind = 'traversal_delta'
       )
       select
         run.status,
         run.created_at,
         tasks.*,
         deltas.delta_bytes
       from selected_run run
       cross join task_rollup tasks
       cross join delta_rollup deltas`,
      [input.runId, input.now.toISOString()]
    )
  ).rows[0];
  if (!row) throw new Error("unified_progress_run_missing");

  const runStatus = String(row.status);
  const lifecycle: UnifiedProgressLifecycleV1 =
    runStatus === "COMPLETED"
      ? "COMPLETED"
      : runStatus === "FAILED_TECHNICAL"
        ? "FAILED_TECHNICAL"
        : runStatus === "WAITING_FOR_PROVIDER"
          ? "WAITING_FOR_PROVIDER"
          : runStatus === "BLOCKED_ADMIN"
            ? "BLOCKED_ADMIN"
            : "RUNNING";
  const directIncomplete = row.direct_incomplete === true;
  const traversalIncomplete = row.traversal_incomplete === true;
  const branchesIncomplete = row.branches_incomplete === true;
  const addressOutstanding = progressNumber(row.address_outstanding);
  const phase: UnifiedProgressPhaseV1 =
    lifecycle === "COMPLETED"
      ? "completed"
      : lifecycle === "FAILED_TECHNICAL"
        ? "failed_technical"
        : lifecycle === "WAITING_FOR_PROVIDER"
          ? "provider_wait"
          : directIncomplete
            ? "direct_history"
            : addressOutstanding > 0
              ? "traversal_fetch"
              : traversalIncomplete
                ? "traversal_attribution"
                : branchesIncomplete
                  ? "branch_analysis"
                  : "finalization";
  const checkpoint =
    row.traversal_checkpoint &&
    typeof row.traversal_checkpoint === "object" &&
    !Array.isArray(row.traversal_checkpoint)
      ? row.traversal_checkpoint as Record<string, unknown>
      : {};
  const operational =
    checkpoint.operational &&
    typeof checkpoint.operational === "object" &&
    !Array.isArray(checkpoint.operational)
      ? checkpoint.operational as Record<string, unknown>
      : {};
  const frontier = progressNumber(operational.frontierCount);
  const frontierPeak = Math.max(
    frontier,
    progressNumber(operational.frontierPeak)
  );
  const uniqueAddresses = progressNumber(operational.uniqueAddresses);
  const fundingEpisodes = progressNumber(operational.fundingEpisodes);
  const activeSlots = Math.min(
    input.configuredSlots,
    progressNumber(row.provider_active)
  );
  const coolingDownSlots = Math.min(
    input.configuredSlots - activeSlots,
    progressNumber(row.provider_cooldown)
  );
  const createdAt = new Date(String(row.created_at));
  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error("unified_progress_run_clock_invalid");
  }
  const measurementWindowMs = Math.max(
    1,
    Math.trunc(input.now.getTime() - createdAt.getTime())
  );
  const avoided = Math.max(0, fundingEpisodes - uniqueAddresses);

  return projectUnifiedProgress({
    lifecycle,
    phase,
    provider: {
      configuredSlots: input.configuredSlots,
      activeSlots,
      coolingDownSlots,
      requests: progressNumber(row.provider_calls),
      measurementWindowMs,
      keyGroups: input.keyGroups ?? []
    },
    traversal: {
      discoveredOutstanding: addressOutstanding,
      frontierExpanding: lifecycle !== "COMPLETED" && traversalIncomplete,
      frontierCount: frontier,
      frontierPeak,
      uniqueAddresses,
      fundingEpisodes
    },
    storage: {
      checkpointBytes: progressNumber(row.checkpoint_bytes),
      deltaArtifactBytes: progressNumber(row.delta_bytes)
    },
    reuse: {
      networkFetches: progressNumber(row.network_fetches),
      providerCacheHits: progressNumber(row.provider_cache_hits),
      manifestReuses: avoided,
      replayAvoided: avoided
    }
  });
}

function adminTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("unified_admin_snapshot_timestamp_invalid");
  }
  return date.toISOString();
}

export async function loadUnifiedAdminRunSnapshot(
  db: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly now: Date;
    readonly decision: UnifiedAdminRunDecision | null;
  }
): Promise<UnifiedAdminRunSnapshot | null> {
  if (!input.runId.trim()) {
    throw new TypeError("unified_admin_snapshot_run_id_invalid");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new TypeError("unified_admin_snapshot_clock_invalid");
  }
  const row = (
    await db.query(
      `with selected_run as (
         select id, fairness_owner_id, created_at
           from unified_check_runs
          where id = $1
       ),
       planner_rollup as (
         select
           count(*) filter (
             where entry.planner_state = 'planned'
               and entry.admitted_at is null
           )::bigint as durable_backlog,
           count(*) filter (
             where entry.planner_state = 'planned'
               and entry.admitted_at is not null
           )::bigint as admitted,
           count(*) filter (
             where task.status = 'LEASED'
           )::bigint as leased,
           count(*) filter (
             where entry.planner_state = 'ready'
           )::bigint as ready,
           count(*) filter (
             where entry.planner_state = 'committed'
           )::bigint as committed,
           coalesce(sum(entry.result_bytes) filter (
             where entry.planner_state = 'ready'
           ), 0)::bigint as ready_bytes,
           coalesce(sum(entry.reserved_bytes) filter (
             where entry.planner_state = 'planned'
           ), 0)::bigint as reserved_bytes,
           max(entry.committed_at) as last_commit_at
         from unified_check_planner_entries entry
         left join unified_check_tasks task
           on task.run_id = entry.run_id and task.id = entry.task_id
        where entry.run_id = $1
       ),
       task_rollup as (
         select
           coalesce(sum(coalesce(
             (checkpoint_json->'performanceCounters'->>'logicalChunks')::bigint,
             0
           )), 0)::bigint as completed_chunks,
           min(case priority_lane
             when 'interactive' then 1
             when 'repair' then 2
             else 3
           end) as lane_order
         from unified_check_tasks
        where run_id = $1
       ),
       canonical_head as (
         select entry.task_id, task.status as task_state,
                task.priority_lane,
                greatest(0, floor(extract(epoch from (
                  $2::timestamptz - coalesce(
                    entry.ready_at,
                    entry.admitted_at,
                    entry.planned_at
                  )
                )) * 1000))::bigint as age_ms
           from unified_check_planner_entries entry
           join unified_check_tasks task
             on task.run_id = entry.run_id and task.id = entry.task_id
          where entry.run_id = $1
            and entry.planner_state <> 'committed'
          order by entry.canonical_sequence
          limit 1
       )
       select run.fairness_owner_id, run.created_at,
              case coalesce(
                case head.priority_lane
                  when 'interactive' then 1
                  when 'repair' then 2
                  when 'background' then 3
                end,
                tasks.lane_order,
                1
              )
                when 2 then 'repair'
                when 3 then 'background'
                else 'interactive'
              end as lane,
              planner.durable_backlog, planner.admitted,
              planner.leased, planner.ready, planner.committed,
              planner.ready as ready_count,
              planner.ready_bytes, planner.reserved_bytes,
              planner.last_commit_at,
              head.task_id as head_task_id,
              head.task_state as head_state,
              head.age_ms as head_age_ms,
              tasks.completed_chunks
         from selected_run run
         cross join planner_rollup planner
         cross join task_rollup tasks
         left join canonical_head head on true`,
      [input.runId, input.now.toISOString()]
    )
  ).rows[0];
  if (!row) return null;
  const lane = String(row.lane);
  if (!["interactive", "repair", "background"].includes(lane)) {
    throw new Error("unified_admin_snapshot_lane_invalid");
  }
  const createdAt = adminTimestamp(row.created_at);
  if (createdAt === null) {
    throw new Error("unified_admin_snapshot_created_at_missing");
  }
  return projectUnifiedAdminRunSnapshot({
    ownerId: String(row.fairness_owner_id),
    lane: lane as "interactive" | "repair" | "background",
    planner: {
      durableBacklog: progressNumber(row.durable_backlog),
      admitted: progressNumber(row.admitted),
      leased: progressNumber(row.leased),
      ready: progressNumber(row.ready),
      committed: progressNumber(row.committed)
    },
    canonicalHead: row.head_task_id === null ||
      row.head_task_id === undefined
      ? null
      : {
          taskId: String(row.head_task_id),
          state: String(row.head_state),
          ageMs: progressNumber(row.head_age_ms)
        },
    buffer: {
      readyCount: progressNumber(row.ready_count),
      readyBytes: progressNumber(row.ready_bytes),
      reservedBytes: progressNumber(row.reserved_bytes)
    },
    lastCommitAt: adminTimestamp(row.last_commit_at),
    createdAt,
    completedChunks: progressNumber(row.completed_chunks)
  }, input.decision, input.now);
}

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
        `select *,
                clock_timestamp() <
                  created_at + interval '35 minutes' as before_deadline
           from unified_check_runs
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
      checkpoint?: unknown;
    }>;
  }
) {
  const rows = [];
  for (const task of input.tasks) {
    const result = await db.query(
      `insert into unified_check_tasks (
        id, run_id, kind, status, priority_lane, logical_key, checkpoint_json
      ) values ($1, $2, $3, 'QUEUED', $4, $5, $6::jsonb)
      on conflict (run_id, kind, logical_key) do nothing
      returning *`,
      [
        task.id,
        input.runId,
        task.kind,
        task.priorityLane,
        task.logicalKey,
        JSON.stringify(task.checkpoint ?? {})
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

export async function ensureAddressHistoryTasks(
  db: UnifiedQueryable,
  input: {
    runId: string;
    priorityLane: "interactive" | "repair" | "background";
    histories: readonly {
      taskId: string;
      manifestKey: string;
      identity: AddressHistoryManifestIdentityV1;
    }[];
  }
) {
  return createUnifiedTasks(db, {
    runId: input.runId,
    tasks: input.histories.map((history) => ({
      id: history.taskId,
      kind: "address_history",
      priorityLane: input.priorityLane,
      logicalKey: history.manifestKey,
      checkpoint: {
        version: "unified-address-history-checkpoint-v2",
        identity: history.identity,
        history: null,
        chunkHeadSha256: null,
        chunkCount: 0,
        pageCount: 0,
        rawRowCount: 0
      }
    }))
  });
}

export async function loadCompletedAddressHistoryManifests(
  db: UnifiedQueryable,
  input: {
    runId: string;
    manifestKeys: readonly string[];
  }
): Promise<Map<string, AddressHistoryManifestV1>> {
  const manifestKeys = [...new Set(input.manifestKeys)].sort();
  if (manifestKeys.length === 0) return new Map();
  const result = await db.query(
    `select task.logical_key, artifact.artifact_json
       from unified_check_tasks task
       join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
       join unified_check_artifacts artifact
         on artifact.sha256 = attempt.artifact_sha256
      where task.run_id = $1
        and task.kind = 'address_history'
        and task.status = 'COMPLETED'
        and task.logical_key = any($2::text[])
        and artifact.kind = 'address_history_manifest'
      order by task.logical_key`,
    [input.runId, manifestKeys]
  );
  const manifests = new Map<string, AddressHistoryManifestV1>();
  for (const row of result.rows) {
    const logicalKey = String(row.logical_key);
    const artifact = row.artifact_json as Partial<AddressHistoryManifestV1>;
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      artifact.version !== "unified-address-history-manifest-v1" ||
      artifact.schemaVersion !== 1 ||
      artifact.key !== logicalKey
    ) {
      throw new Error("unified_address_history_manifest_row_invalid");
    }
    manifests.set(logicalKey, artifact as AddressHistoryManifestV1);
  }
  return manifests;
}

export async function loadUnifiedCanarySelectionRows(
  db: UnifiedQueryable,
  input: { cutoffAt: string }
) {
  const result = await db.query(
    UNIFIED_CANARY_SELECTION_QUERY,
    [input.cutoffAt]
  );
  return result.rows.map((row) => ({
    sourceTable: String(row.source_table) as
      "unified_check_requests" | "forensic_check_jobs",
    sourceRowId: String(row.source_row_id),
    subjectAddress: String(row.subject_address),
    runPurpose: String(row.run_purpose),
    locale: row.locale as "ru" | "en",
    acceptedAt: row.accepted_at === null
      ? null
      : new Date(String(row.accepted_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    provenUserOrigin: row.proven_user_origin === true
  }));
}

export async function createUnifiedCanaryBatch(
  db: UnifiedTransactionalQueryable,
  input: {
    selectionManifest: {
      version: "unified-canary-selection-manifest-v1";
      schemaVersion: 1;
      source: {
        table: "unified_check_requests" | "adaptive_benchmark_cli";
      };
      selected: readonly {
        subjectAddress: string;
        sourceRowId: string;
      }[];
    };
    batchIdentity: {
      version: "unified-canary-batch-identity-v1";
      schemaVersion: 1;
      selectedSourceSetSha256: string;
      snapshots: readonly {
        subjectAddress: string;
        snapshotSha256: string;
      }[];
      candidateCommit: string;
      activeGenerationId: string;
      labelDatasetSha256: string;
      scoringPolicyVersion: string;
      attributionPolicyVersion: string;
      traversalPolicyVersion: "snapshot-closure-v1";
      providerSchemaVersion: "tronscan-transfer-page-v1";
      providerConfiguration: {
        sha256: string;
        artifact: unknown;
      };
      databaseSchemaVersion: number;
      databaseSchemaChecksumSha256: string;
      schema032ChecksumSha256: string;
      diagnosticHypothesis: {
        sha256: string;
        artifact: {
          version: "unified-canary-diagnostic-hypothesis-v1";
          schemaVersion: 1;
          hypothesisId: string;
          reason: string;
          changedInputs: readonly string[];
          createdAt: string;
        };
      } | null;
    };
    runs: readonly {
      request: {
        id: string;
        requestCorrelationId: string;
        subjectAddress: string;
        chatId: string;
        messageThreadId: string;
        locale: "ru" | "en";
        runPurpose: UnifiedRunPurpose;
        sideEffectPolicy: UnifiedSideEffectPolicy;
        acceptedAt: string;
      };
      candidateRun: {
        id: string;
        fairnessOwnerId: string;
        analysisKeySha256: string;
        subjectAddress: string;
        runPurpose: UnifiedRunPurpose;
        sideEffectPolicy: UnifiedSideEffectPolicy;
        snapshotHash: string;
        snapshot: unknown;
        analysisManifestSha256: string;
        analysisManifest: unknown;
        rolloutPolicy: {
          stage:
            | "global_barrier"
            | "isolated_rolling"
            | "bounded_user_check"
            | "rolling_default";
          bucket: number;
          admissionPolicy: "barrier" | "rolling";
          providerCapacityCeiling: number;
          receiptSha256: string | null;
        };
      };
      reuseAllowed: false;
      initialTasks: readonly {
        id: string;
        kind: string;
        priorityLane: "interactive" | "repair" | "background";
        logicalKey: string;
      }[];
    }[];
  }
) {
  const adaptiveBenchmark =
    input.selectionManifest.source.table === "adaptive_benchmark_cli";
  const expectedRunCount = adaptiveBenchmark
    ? input.selectionManifest.selected.length
    : 8;
  if (
    expectedRunCount < 1 ||
    expectedRunCount > 100 ||
    (!adaptiveBenchmark && expectedRunCount !== 8) ||
    input.runs.length !== expectedRunCount ||
    input.runs.some((item, index) =>
      item.reuseAllowed !== false ||
      item.request.runPurpose !== "release_canary" ||
      item.request.sideEffectPolicy !== "isolated" ||
      item.candidateRun.runPurpose !== "release_canary" ||
      item.candidateRun.sideEffectPolicy !== "isolated" ||
      item.request.subjectAddress !== item.candidateRun.subjectAddress ||
      item.request.subjectAddress !==
        input.selectionManifest.selected[index]?.subjectAddress ||
      item.initialTasks.length !== 6
    ) ||
    new Set(input.runs.map((item) => item.request.id)).size !==
      expectedRunCount ||
    new Set(input.runs.map((item) => item.candidateRun.id)).size !==
      expectedRunCount ||
    (
      !adaptiveBenchmark &&
      new Set(input.runs.map((item) =>
        item.candidateRun.analysisKeySha256
      )).size !== expectedRunCount
    )
  ) {
    throw new Error("unified_canary_batch_contract_invalid");
  }
  const selectionManifestSha256 = fingerprintCanonicalArtifact(
    input.selectionManifest
  );
  const batchIdentitySha256 = fingerprintCanonicalArtifact(
    input.batchIdentity
  );
  if (
    input.batchIdentity.selectedSourceSetSha256 !==
      fingerprintCanonicalArtifact({
        version: "unified-canary-selected-source-set-v1",
        selected: input.selectionManifest.selected
      }) ||
    input.batchIdentity.snapshots.length !== expectedRunCount ||
    input.batchIdentity.snapshots.some((snapshot) =>
      !input.runs.some((item) =>
        item.candidateRun.subjectAddress === snapshot.subjectAddress &&
        item.candidateRun.snapshotHash === snapshot.snapshotSha256
      )
    ) ||
    input.runs.some((item) =>
      item.request.chatId !== `canary:${batchIdentitySha256}` ||
      item.request.messageThreadId !== selectionManifestSha256
    )
  ) {
    throw new Error("unified_canary_batch_identity_invalid");
  }
  return db.transaction(async (client) => {
    if ((
      await client.query(
        `select id from unified_check_requests
          where request_correlation_id = $1
          limit 1`,
        [input.runs[0]!.request.requestCorrelationId]
      )
    ).rows[0]) {
      throw new Error(
        `unified_canary_duplicate_batch_resume:${batchIdentitySha256}`
      );
    }
    const runs: { id: string; createdAt: string }[] = [];
    for (const item of input.runs) {
      const run = requiredRow(
        await client.query(
          `insert into unified_check_runs (
            id, analysis_key_sha256, subject_address, status, run_purpose,
            side_effect_policy, analysis_manifest_sha256, fairness_owner_id,
            rollout_stage, rollout_bucket, admission_policy,
            provider_capacity_ceiling, rollout_receipt_sha256
          ) values (
            $1,$2,$3,'RUNNING','release_canary','isolated',$4,$5,
            $6,$7,$8,$9,$10
          )
          returning *`,
          [
            item.candidateRun.id,
            item.candidateRun.analysisKeySha256,
            item.candidateRun.subjectAddress,
            item.candidateRun.analysisManifestSha256,
            item.candidateRun.fairnessOwnerId,
            item.candidateRun.rolloutPolicy.stage,
            item.candidateRun.rolloutPolicy.bucket,
            item.candidateRun.rolloutPolicy.admissionPolicy,
            item.candidateRun.rolloutPolicy.providerCapacityCeiling,
            item.candidateRun.rolloutPolicy.receiptSha256
          ]
        ),
        "unified_canary_run_create_failed"
      );
      await client.query(
        `insert into unified_check_requests (
          id, request_correlation_id, run_id, subject_address, chat_id,
          message_thread_id, locale, run_purpose, side_effect_policy, status,
          ready_at, attempt_count, accepted_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,'release_canary','isolated','ATTACHED',
          $8,0,$8
        )`,
        [
          item.request.id,
          item.request.requestCorrelationId,
          item.candidateRun.id,
          item.request.subjectAddress,
          item.request.chatId,
          item.request.messageThreadId,
          item.request.locale,
          item.request.acceptedAt
        ]
      );
      await insertUnifiedArtifact(client, {
        sha256: item.candidateRun.snapshotHash,
        createdByRunId: item.candidateRun.id,
        kind: "confirmed_snapshot",
        schemaVersion: "1",
        artifact: item.candidateRun.snapshot
      });
      await insertUnifiedArtifact(client, {
        sha256: item.candidateRun.analysisManifestSha256,
        createdByRunId: item.candidateRun.id,
        kind: "analysis_manifest",
        schemaVersion: "1",
        artifact: item.candidateRun.analysisManifest
      });
      for (const task of item.initialTasks) {
        await client.query(
          `insert into unified_check_tasks (
            id, run_id, kind, status, priority_lane, logical_key
          ) values ($1,$2,$3,'QUEUED',$4,$5)`,
          [
            task.id,
            item.candidateRun.id,
            task.kind,
            task.priorityLane,
            task.logicalKey
          ]
        );
      }
      runs.push({
        id: String(run.id),
        createdAt: new Date(String(run.created_at)).toISOString()
      });
    }
    await insertUnifiedArtifact(client, {
      sha256: selectionManifestSha256,
      createdByRunId: runs[0]!.id,
      kind: "canary_selection_manifest",
      schemaVersion: "1",
      artifact: input.selectionManifest
    });
    await insertUnifiedArtifact(client, {
      sha256: batchIdentitySha256,
      createdByRunId: runs[0]!.id,
      kind: "canary_batch_identity",
      schemaVersion: "1",
      artifact: input.batchIdentity
    });
    return { selectionManifestSha256, batchIdentitySha256, runs };
  });
}

export async function loadUnifiedCanaryBatchByIdentity(
  db: UnifiedQueryable,
  input: { batchIdentitySha256: string }
): Promise<{
  batchIdentitySha256: string;
  batchIdentity: UnifiedCanaryBatchIdentityV1;
  selectionManifestSha256: string;
  selectionManifest: UnifiedCanarySelectionManifestV1;
  runs: readonly {
    id: string;
    createdAt: string;
    subjectAddress: string;
    locale: "ru" | "en";
  }[];
}> {
  if (!/^[0-9a-f]{64}$/u.test(input.batchIdentitySha256)) {
    throw new TypeError("unified_canary_resume_identity_invalid");
  }
  const identityRow = (
    await db.query(
      `select artifact_json, created_by_run_id
         from unified_check_artifacts
        where sha256 = $1 and kind = 'canary_batch_identity'`,
      [input.batchIdentitySha256]
    )
  ).rows[0];
  if (
    !identityRow ||
    fingerprintCanonicalArtifact(identityRow.artifact_json) !==
      input.batchIdentitySha256
  ) {
    throw new Error("unified_canary_resume_identity_missing");
  }
  const batchIdentity =
    identityRow.artifact_json as UnifiedCanaryBatchIdentityV1;
  const runRows = (
    await db.query(
      `select run.id, run.created_at, request.subject_address, request.locale,
              request.message_thread_id
         from unified_check_requests request
         join unified_check_runs run on run.id = request.run_id
        where request.chat_id = $1
          and request.run_purpose = 'release_canary'
          and request.side_effect_policy = 'isolated'
          and run.run_purpose = 'release_canary'
          and run.side_effect_policy = 'isolated'
        order by request.subject_address, request.id`,
      [`canary:${input.batchIdentitySha256}`]
    )
  ).rows;
  const selectionManifestHashes = new Set(runRows.map((row) =>
    String(row.message_thread_id)
  ));
  if (
    runRows.length < 1 ||
    runRows.length > 100 ||
    selectionManifestHashes.size !== 1
  ) {
    throw new Error("unified_canary_resume_batch_invalid");
  }
  const selectionManifestSha256 = [...selectionManifestHashes][0]!;
  const selectionRow = (
    await db.query(
      `select artifact_json from unified_check_artifacts
        where sha256 = $1 and kind = 'canary_selection_manifest'`,
      [selectionManifestSha256]
    )
  ).rows[0];
  if (
    !selectionRow ||
    fingerprintCanonicalArtifact(selectionRow.artifact_json) !==
      selectionManifestSha256
  ) {
    throw new Error("unified_canary_resume_selection_missing");
  }
  const selectionManifest =
    selectionRow.artifact_json as UnifiedCanarySelectionManifestV1;
  const adaptiveBenchmark =
    selectionManifest.source.table === "adaptive_benchmark_cli";
  const expectedRunCount = adaptiveBenchmark
    ? selectionManifest.selected.length
    : 8;
  const runs = runRows.map((row) => ({
    id: String(row.id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    subjectAddress: String(row.subject_address),
    locale: row.locale as "ru" | "en"
  }));
  if (
    expectedRunCount < 1 ||
    expectedRunCount > 100 ||
    (!adaptiveBenchmark && expectedRunCount !== 8) ||
    runs.length !== expectedRunCount ||
    new Set(runs.map((run) => run.id)).size !== expectedRunCount ||
    (
      !adaptiveBenchmark &&
      new Set(runs.map((run) => run.subjectAddress)).size !==
        expectedRunCount
    ) ||
    selectionManifest.selected.some((selected) =>
      !runs.some((run) =>
        run.subjectAddress === selected.subjectAddress &&
        run.locale === selected.locale
      )
    )
  ) {
    throw new Error("unified_canary_resume_batch_invalid");
  }
  return {
    batchIdentitySha256: input.batchIdentitySha256,
    batchIdentity,
    selectionManifestSha256,
    selectionManifest,
    runs
  };
}

export async function claimUnifiedTask(
  db: UnifiedQueryable,
  input: {
    workerId: string;
    leaseToken: string;
    leaseMs: number;
    kinds?: readonly string[];
    runPurpose?: UnifiedRunPurpose;
    runtimeCommit?: string;
    providerConfigurationSha256?: string;
    runId?: string;
    priorityLane?: "interactive" | "repair" | "background";
    fairnessOwnerId?: string;
    benchmarkReadyBufferMaxEntries?: number;
    benchmarkReadyBufferMaxBytes?: number;
  }
) {
  if (input.kinds?.length === 0) return null;
  if (input.runId !== undefined && input.runId.trim().length === 0) {
    throw new TypeError("unified_claim_run_id_invalid");
  }
  if (
    input.priorityLane !== undefined &&
    !["interactive", "repair", "background"].includes(input.priorityLane)
  ) {
    throw new TypeError("unified_claim_priority_lane_invalid");
  }
  if (
    input.fairnessOwnerId !== undefined &&
    input.fairnessOwnerId.trim().length === 0
  ) {
    throw new TypeError("unified_claim_owner_id_invalid");
  }
  const plannerTable = (
    await db.query(
      "select to_regclass('unified_check_planner_entries') as planner_table"
    )
  ).rows[0]?.planner_table;
  const orderedAdmission = plannerTable
    ? `and (
           not exists (
             select 1
               from unified_check_planner_entries ordered_task
              where ordered_task.run_id = task.run_id
                and ordered_task.task_id = task.id
           ) or exists (
             select 1
               from unified_check_planner_entries ordered_task
              where ordered_task.run_id = task.run_id
                and ordered_task.task_id = task.id
                and ordered_task.planner_state = 'planned'
                and ordered_task.admitted_at is not null
           )
         )`
    : "";
  const traversalActionability = plannerTable
    ? `and (
             not exists (
               select 1
                 from unified_check_planner_entries any_entry
                where any_entry.run_id = task.run_id
             )
             or not exists (
               select 1
                 from unified_check_planner_entries uncommitted
                where uncommitted.run_id = task.run_id
                  and uncommitted.planner_state <> 'committed'
             )
             or exists (
               select 1
                 from unified_check_planner_entries head_entry
                where head_entry.run_id = task.run_id
                  and head_entry.planner_state = 'ready'
                  and head_entry.canonical_sequence = (
                    select min(uncommitted.canonical_sequence)
                      from unified_check_planner_entries uncommitted
                     where uncommitted.run_id = task.run_id
                       and uncommitted.planner_state <> 'committed'
                  )
             )
           )`
    : "";
  const providerPermitOrder = plannerTable
    ? `case
         when exists (
           select 1
             from unified_check_planner_entries permit_head
            where permit_head.run_id = task.run_id
              and permit_head.task_id = task.id
              and permit_head.planner_state = 'planned'
              and permit_head.admitted_at is not null
              and permit_head.canonical_sequence = (
                select min(uncommitted.canonical_sequence)
                  from unified_check_planner_entries uncommitted
                 where uncommitted.run_id = task.run_id
                   and uncommitted.planner_state <> 'committed'
              )
         ) then 0
         when exists (
           select 1
             from unified_check_planner_entries permit_tail
            where permit_tail.run_id = task.run_id
              and permit_tail.task_id = task.id
         ) then 1
         else 2
       end,
       (
         select permit_entry.canonical_sequence
           from unified_check_planner_entries permit_entry
          where permit_entry.run_id = task.run_id
            and permit_entry.task_id = task.id
       ) nulls last,`
    : "";
  const candidateCanonicalSequence = plannerTable
    ? `(
         select planner.canonical_sequence
           from unified_check_planner_entries planner
          where planner.run_id = task.run_id
            and planner.task_id = task.id
       )`
    : "null::bigint";
  const result = await db.query(
    `with candidate as (
      select task.id,
             ${candidateCanonicalSequence} as canonical_sequence
        from unified_check_tasks task
        join unified_check_runs run on run.id = task.run_id
        join unified_check_artifacts manifest
          on manifest.sha256 = run.analysis_manifest_sha256
         and manifest.kind = 'analysis_manifest'
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
         and task.cancellation_requested_at is null
         and (
           run.run_purpose <> 'release_canary' or
           clock_timestamp() < run.created_at + interval '35 minutes'
         )
         and ($4::text[] is null or task.kind = any($4::text[]))
         and ($5::text is null or run.run_purpose = $5)
         and ($8::text is null or task.run_id = $8)
         and ($9::text is null or task.priority_lane = $9)
         and ($10::text is null or run.fairness_owner_id = $10)
         and not (
           $11::int is not null
           and $12::bigint is not null
           and exists (
             select 1
               from unified_check_planner_entries benchmark_head
              where benchmark_head.run_id = task.run_id
                and benchmark_head.task_id = task.id
                and benchmark_head.planner_state = 'planned'
                and benchmark_head.canonical_sequence = (
                  select min(uncommitted.canonical_sequence)
                    from unified_check_planner_entries uncommitted
                   where uncommitted.run_id = task.run_id
                     and uncommitted.planner_state <> 'committed'
                )
           )
           and exists (
             select 1
               from unified_check_planner_entries benchmark_tail
              where benchmark_tail.run_id = task.run_id
                and benchmark_tail.planner_state = 'planned'
                and benchmark_tail.admitted_at is not null
                and benchmark_tail.canonical_sequence > (
                  select min(uncommitted.canonical_sequence)
                    from unified_check_planner_entries uncommitted
                   where uncommitted.run_id = task.run_id
                     and uncommitted.planner_state <> 'committed'
                )
           )
           and exists (
             select 1
               from unified_check_artifacts benchmark_control
               cross join lateral jsonb_array_elements(
                 case
                   when jsonb_typeof(
                     benchmark_control.artifact_json->'runPlans'
                   ) = 'array'
                   then benchmark_control.artifact_json->'runPlans'
                   else '[]'::jsonb
                 end
               ) benchmark_plan(value)
              where benchmark_control.kind =
                'adaptive_benchmark_control'
                and benchmark_plan.value->>'runId' = task.run_id
                and benchmark_plan.value->>'fault' =
                  'merge_buffer_full'
                and benchmark_control.artifact_json->>'runtimeCommit' =
                  $6
                and benchmark_control.artifact_json->>
                  'providerConfigurationSha256' = $7
                and case
                  when benchmark_control.artifact_json->>'expiresAt' ~
                    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  then (
                    benchmark_control.artifact_json->>'expiresAt'
                  )::timestamptz
                  else '-infinity'::timestamptz
                end > statement_timestamp()
                and not exists (
                  select 1
                    from unified_check_artifacts released
                   where released.kind =
                     'adaptive_benchmark_control_release'
                     and released.artifact_json->>'controlSha256' =
                       benchmark_control.sha256
                )
                and not exists (
                  select 1
                    from unified_check_artifacts symptom
                   where symptom.kind =
                     'adaptive_benchmark_scenario_symptom'
                     and symptom.artifact_json->>'controlSha256' =
                       benchmark_control.sha256
                     and symptom.artifact_json->>'runId' = task.run_id
                     and symptom.artifact_json->>'phase' =
                       'merge_buffer_full_observed'
                )
           )
           and (
             select count(*) < $11::int
                    and coalesce(sum(result_bytes), 0) < $12::bigint
               from unified_check_planner_entries buffered
              where buffered.run_id = task.run_id
                and buffered.planner_state = 'ready'
           )
         )
         and (
           $6::text is null or
           manifest.artifact_json->>'runtimeCommit' = $6
         )
         ${orderedAdmission}
         and (
           run.run_purpose <> 'release_canary' or (
             $7::text is not null and exists (
               select 1
                 from unified_check_requests request
                 join unified_check_artifacts batch_identity
                   on batch_identity.sha256 =
                     substring(request.chat_id from 8)
                  and batch_identity.kind = 'canary_batch_identity'
                where request.run_id = run.id
                  and request.run_purpose = 'release_canary'
                  and batch_identity.artifact_json#>>
                    '{providerConfiguration,sha256}' = $7
             )
           )
         )
          and (
            task.kind not in ('address_history','deep_direct') or exists (
              select 1
                from unified_check_tasks prerequisite
               where prerequisite.run_id = task.run_id
                 and prerequisite.kind = 'direct_history'
                 and prerequisite.status = 'COMPLETED'
                 and prerequisite.accepted_attempt_id is not null
            )
          )
          and (
            task.kind <> 'traversal' or (
              exists (
                select 1
                  from unified_check_tasks prerequisite
                 where prerequisite.run_id = task.run_id
                   and prerequisite.kind = 'direct_history'
                   and prerequisite.status = 'COMPLETED'
                   and prerequisite.accepted_attempt_id is not null
              )
              ${traversalActionability}
            )
          )
         and (
           task.kind <> 'fast' or exists (
             select 1
               from unified_check_tasks prerequisite
              where prerequisite.run_id = task.run_id
                and prerequisite.kind = 'direct_history'
                and prerequisite.status = 'COMPLETED'
                and prerequisite.accepted_attempt_id is not null
           )
         )
         and (
           task.kind not in ('where','deep') or exists (
             select 1
               from unified_check_tasks prerequisite
              where prerequisite.run_id = task.run_id
                and prerequisite.kind = 'traversal'
                and prerequisite.status = 'COMPLETED'
                and prerequisite.accepted_attempt_id is not null
           )
         )
         and (
           task.kind <> 'deep' or not exists (
             select 1
               from unified_check_tasks direct_evidence
              where direct_evidence.run_id = task.run_id
                and direct_evidence.kind = 'deep_direct'
                and direct_evidence.status <> 'COMPLETED'
           )
         )
       order by ${providerPermitOrder} case task.priority_lane
         when 'interactive' then 0 when 'repair' then 1 else 2 end,
         (
           select count(*)
             from unified_check_tasks active_task
            where active_task.run_id = task.run_id
              and active_task.status = 'LEASED'
              and active_task.lease_expires_at > statement_timestamp()
         ),
         coalesce(
           (
             select max(served_task.updated_at)
               from unified_check_tasks served_task
              where served_task.run_id = task.run_id
                and served_task.attempt > 0
           ),
           '-infinity'::timestamptz
         ),
         greatest(task.ready_at, task.updated_at), task.created_at
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
           checkpoint_json = (
             task.checkpoint_json || jsonb_build_object(
               'queueDurationMs',
               coalesce(
                 (task.checkpoint_json->>'queueDurationMs')::double precision,
                 0
               ) + case when task.status = 'LEASED' then 0 else
                 greatest(
                   extract(epoch from (
                     statement_timestamp() -
                     case when task.status = 'WAITING_RETRY'
                       then greatest(task.ready_at, task.updated_at)
                       else task.updated_at
                     end
                   )) * 1000,
                   0
                 )
               end,
               'providerDurationMs',
               coalesce(
                 (task.checkpoint_json->>'providerDurationMs')::double precision,
                 0
               ) + case when task.status = 'WAITING_RETRY' then
                 greatest(
                   extract(epoch from (
                     least(statement_timestamp(), task.ready_at) -
                     task.updated_at
                   )) * 1000,
                   0
                 )
               else 0 end,
               'timingSummary',
               jsonb_build_object(
                 'attemptCount', task.attempt,
                 'queueDurationMs',
                 coalesce(
                   (task.checkpoint_json->>'queueDurationMs')::double precision,
                   0
                 ) + case when task.status = 'LEASED' then 0 else
                   greatest(
                     extract(epoch from (
                       statement_timestamp() -
                       case when task.status = 'WAITING_RETRY'
                         then greatest(task.ready_at, task.updated_at)
                         else task.updated_at
                       end
                     )) * 1000,
                     0
                   )
                 end,
                 'providerDurationMs',
                 coalesce(
                   (task.checkpoint_json->>'providerDurationMs')::double precision,
                   0
                 ) + case when task.status = 'WAITING_RETRY' then
                   greatest(
                     extract(epoch from (
                       least(statement_timestamp(), task.ready_at) -
                       task.updated_at
                     )) * 1000,
                     0
                   )
                 else 0 end
               ),
               'performanceCounters',
               coalesce(
                 task.checkpoint_json->'performanceCounters',
                 '{}'::jsonb
               ) || jsonb_build_object(
                 'taskClaims',
                 coalesce(
                   (task.checkpoint_json->'performanceCounters'->>'taskClaims')::bigint,
                   0
                 ) + 1
               ),
               'recentAttempts',
               jsonb_path_query_array(
                 coalesce(
                   task.checkpoint_json->'recentAttempts',
                   task.checkpoint_json->'attemptTimings',
                   '[]'::jsonb
                 ) || case when task.status = 'LEASED'
                   then jsonb_build_array(jsonb_build_object(
                   'attempt', task.attempt,
                   'startedAt', coalesce(
                     task.checkpoint_json->>'currentAttemptStartedAt',
                     task.updated_at::text
                   ),
                   'completedAt', statement_timestamp(),
                   'durationMs', greatest(
                     extract(epoch from (
                       statement_timestamp() - coalesce(
                         (task.checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                         task.updated_at
                       )
                     )) * 1000,
                     0
                   ),
                   'outcome', 'LEASE_EXPIRED'
                   ))
                   else '[]'::jsonb
                 end,
                 '$[last - 7 to last]'
               ),
               'currentAttempt',
               task.attempt + 1,
               'currentAttemptStartedAt',
               statement_timestamp()
             )
           ) - 'attemptTimings',
           updated_at = statement_timestamp()
      from candidate
     where task.id = candidate.id
    returning task.*, candidate.canonical_sequence`,
    [
      input.workerId,
      input.leaseToken,
      input.leaseMs,
      input.kinds ? [...input.kinds] : null,
      input.runPurpose ?? null,
      input.runtimeCommit ?? null,
      input.providerConfigurationSha256 ?? null,
      input.runId ?? null,
      input.priorityLane ?? null,
      input.fairnessOwnerId ?? null,
      input.benchmarkReadyBufferMaxEntries ?? null,
      input.benchmarkReadyBufferMaxBytes ?? null
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

export async function recordUnifiedTaskProviderDuration(
  db: UnifiedQueryable,
  input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    durationMs: number;
    providerSource?: "network" | "cache" | "inflight";
  }
) {
  if (
    !Number.isFinite(input.durationMs) ||
    input.durationMs < 0
  ) {
    throw new TypeError("unified_task_provider_duration_invalid");
  }
  const result = await db.query(
    `update unified_check_tasks
        set checkpoint_json = checkpoint_json || jsonb_build_object(
              'providerDurationMs',
              coalesce(
                (checkpoint_json->>'providerDurationMs')::double precision,
                0
              ) + $4::double precision,
              'performanceCounters',
              coalesce(
                checkpoint_json->'performanceCounters',
                '{}'::jsonb
              ) || jsonb_build_object(
                'providerCalls',
                coalesce(
                  (checkpoint_json->'performanceCounters'->>'providerCalls')::bigint,
                  0
                ) + 1,
                'networkFetches',
                coalesce(
                  (checkpoint_json->'performanceCounters'->>'networkFetches')::bigint,
                  0
                ) + case when $5 = 'network' then 1 else 0 end,
                'providerCacheHits',
                coalesce(
                  (checkpoint_json->'performanceCounters'->>'providerCacheHits')::bigint,
                  0
                ) + case when $5 in ('cache', 'inflight') then 1 else 0 end
              )
            ),
            updated_at = statement_timestamp()
      where id = $1 and status = 'LEASED'
        and lease_token = $2 and attempt = $3
      returning *`,
    [
      input.taskId,
      input.leaseToken,
      input.attempt,
      input.durationMs,
      input.providerSource ?? "network"
    ]
  );
  return result.rows[0] ?? null;
}

type UnifiedCheckpointInput = {
  taskId: string;
  leaseToken: string;
  attempt: number;
  checkpoint: unknown;
  orderedCommit?: UnifiedOrderedCommitExpectation;
  barrierReservedBytes?: number;
};

async function checkpointUnifiedTaskRow(
  db: UnifiedQueryable,
  input: UnifiedCheckpointInput
): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `update unified_check_tasks
        set checkpoint_json = (
            $3::jsonb || jsonb_build_object(
              'queueDurationMs',
              coalesce(
                (checkpoint_json->>'queueDurationMs')::double precision,
                0
              ),
              'providerDurationMs',
              coalesce(
                (checkpoint_json->>'providerDurationMs')::double precision,
                0
              ),
              'timingSummary',
              jsonb_build_object(
                'attemptCount', $4::int,
                'queueDurationMs',
                coalesce(
                  (checkpoint_json->>'queueDurationMs')::double precision,
                  0
                ),
                'providerDurationMs',
                coalesce(
                  (checkpoint_json->>'providerDurationMs')::double precision,
                  0
                )
              ),
              'performanceCounters',
              coalesce(
                checkpoint_json->'performanceCounters',
                '{}'::jsonb
              ) || jsonb_build_object(
                'checkpoints',
                coalesce(
                  (checkpoint_json->'performanceCounters'->>'checkpoints')::bigint,
                  0
                ) + 1,
                'logicalChunks',
                coalesce(
                  (checkpoint_json->'performanceCounters'->>'logicalChunks')::bigint,
                  0
                ) + 1
              ),
              'recentAttempts',
              jsonb_path_query_array(
                coalesce(
                  checkpoint_json->'recentAttempts',
                  checkpoint_json->'attemptTimings',
                  '[]'::jsonb
                ) || jsonb_build_array(jsonb_build_object(
                  'attempt', $4::int,
                  'startedAt', coalesce(
                    checkpoint_json->>'currentAttemptStartedAt',
                    updated_at::text
                  ),
                  'completedAt', statement_timestamp(),
                  'durationMs', greatest(
                    extract(epoch from (
                      statement_timestamp() - coalesce(
                        (checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                        updated_at
                      )
                    )) * 1000,
                    0
                  ),
                  'outcome', case
                    when cancellation_requested_at is null
                      and not exists (
                        select 1 from unified_check_runs run
                         where run.id = unified_check_tasks.run_id
                           and run.run_purpose = 'release_canary'
                           and clock_timestamp() >=
                             run.created_at + interval '35 minutes'
                      )
                    then 'CHECKPOINTED'
                    else 'CANCELLED'
                  end
                )),
                '$[last - 7 to last]'
              )
              )
            )
          - 'currentAttemptStartedAt' - 'currentAttempt' - 'attemptTimings',
            status = case
              when cancellation_requested_at is null
                and not exists (
                  select 1 from unified_check_runs run
                   where run.id = unified_check_tasks.run_id
                     and run.run_purpose = 'release_canary'
                     and clock_timestamp() >=
                       run.created_at + interval '35 minutes'
                )
              then 'QUEUED'
              else 'CANCELLED'
            end,
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

function orderedCommitExpectation(
  value: UnifiedOrderedCommitExpectation
): UnifiedOrderedCommitExpectation {
  if (
    typeof value.runId !== "string" ||
    value.runId.trim().length === 0 ||
    (
      value.expectedDeltaHeadSha256 !== null &&
      !/^[0-9a-f]{64}$/u.test(value.expectedDeltaHeadSha256)
    ) ||
    (value.entries.length === 0 && value.discoveredTasks.length === 0)
  ) {
    throw new TypeError("unified_ordered_commit_expectation_invalid");
  }
  let priorSequence: number | null = null;
  const taskIds = new Set<string>();
  for (const entry of value.entries) {
    if (
      !Number.isSafeInteger(entry.canonicalSequence) ||
      entry.canonicalSequence < 0 ||
      typeof entry.taskId !== "string" ||
      entry.taskId.trim().length === 0 ||
      typeof entry.logicalKey !== "string" ||
      entry.logicalKey.trim().length === 0 ||
      typeof entry.acceptedAttemptId !== "string" ||
      entry.acceptedAttemptId.trim().length === 0 ||
      !Number.isSafeInteger(entry.resultBytes) ||
      entry.resultBytes < 0 ||
      typeof entry.taskKind !== "string" ||
      entry.taskKind.trim().length === 0 ||
      typeof entry.artifactKind !== "string" ||
      entry.artifactKind.trim().length === 0 ||
      typeof entry.artifactSchemaVersion !== "string" ||
      entry.artifactSchemaVersion.trim().length === 0 ||
      (
        priorSequence !== null &&
        entry.canonicalSequence !== priorSequence + 1
      ) ||
      taskIds.has(entry.taskId)
    ) {
      throw new TypeError("unified_ordered_commit_expectation_invalid");
    }
    taskIds.add(entry.taskId);
    priorSequence = entry.canonicalSequence;
  }
  for (const task of value.discoveredTasks) {
    if (
      !Number.isSafeInteger(task.parentCanonicalSequence) ||
      task.parentCanonicalSequence < -1 ||
      typeof task.taskId !== "string" ||
      task.taskId.trim().length === 0 ||
      typeof task.kind !== "string" ||
      task.kind.trim().length === 0 ||
      typeof task.logicalKey !== "string" ||
      task.logicalKey.trim().length === 0 ||
      !["interactive", "repair", "background"].includes(task.priorityLane)
    ) {
      throw new TypeError("unified_ordered_commit_expectation_invalid");
    }
  }
  return value;
}

function checkpointDeltaHead(checkpoint: unknown): string | null {
  if (
    checkpoint === null ||
    typeof checkpoint !== "object" ||
    Array.isArray(checkpoint)
  ) {
    return null;
  }
  const head = (checkpoint as { deltaHeadSha256?: unknown }).deltaHeadSha256;
  if (head === null || head === undefined) return null;
  if (typeof head !== "string" || !/^[0-9a-f]{64}$/u.test(head)) {
    throw new Error("unified_ordered_commit_checkpoint_head_invalid");
  }
  return head;
}

function orderedArtifactIdentityMatches(
  input: {
    artifact: unknown;
    expected: UnifiedOrderedCommitExpectation["entries"][number];
    taskKind: unknown;
    taskLogicalKey: unknown;
    artifactKind: unknown;
    artifactSchemaVersion: unknown;
  }
): boolean {
  const {
    artifact,
    expected,
    taskKind,
    taskLogicalKey,
    artifactKind,
    artifactSchemaVersion
  } = input;
  const manifest = (
    artifact !== null &&
    typeof artifact === "object" &&
    !Array.isArray(artifact)
  )
    ? artifact as Record<string, unknown>
    : null;
  const addressHistoryMarker =
    expected.taskKind === "address_history" ||
    taskKind === "address_history" ||
    expected.artifactKind === "address_history_manifest" ||
    artifactKind === "address_history_manifest" ||
    manifest?.version === "unified-address-history-manifest-v1" ||
    (
      manifest !== null &&
      "key" in manifest &&
      "chain" in manifest &&
      "snapshotHash" in manifest &&
      "tokenContract" in manifest &&
      "address" in manifest &&
      "providerRequestVersion" in manifest
    );
  if (!addressHistoryMarker) return true;
  if (
    expected.taskKind !== "address_history" ||
    taskKind !== "address_history" ||
    expected.artifactKind !== "address_history_manifest" ||
    artifactKind !== "address_history_manifest" ||
    expected.artifactSchemaVersion !== "1" ||
    artifactSchemaVersion !== "1" ||
    manifest === null
  ) {
    return false;
  }
  if (
    manifest.version !== "unified-address-history-manifest-v1" ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.key !== "string" ||
    manifest.chain !== "tron" ||
    typeof manifest.snapshotHash !== "string" ||
    typeof manifest.tokenContract !== "string" ||
    typeof manifest.address !== "string" ||
    typeof manifest.providerRequestVersion !== "string"
  ) {
    return false;
  }
  try {
    const recomputed = addressHistoryManifestKey({
      chain: manifest.chain,
      snapshotHash: manifest.snapshotHash,
      tokenContract: manifest.tokenContract,
      address: manifest.address,
      providerRequestVersion: manifest.providerRequestVersion
    });
    return recomputed === manifest.key &&
      manifest.key === taskLogicalKey &&
      taskLogicalKey === expected.logicalKey;
  } catch {
    return false;
  }
}

function isTransactional(
  db: UnifiedQueryable
): db is UnifiedTransactionalQueryable {
  return typeof (db as Partial<UnifiedTransactionalQueryable>).transaction ===
    "function";
}

async function checkpointUnifiedOrderedTask(
  client: UnifiedQueryable,
  input: UnifiedCheckpointInput,
  expectation: UnifiedOrderedCommitExpectation
): Promise<Record<string, unknown>> {
  const discoveredTask = (
    await client.query(
      "select run_id from unified_check_tasks where id = $1",
      [input.taskId]
    )
  ).rows[0];
  if (!discoveredTask) throw new Error("unified_task_lease_lost");
  const runId = String(discoveredTask.run_id);
  const run = (
    await client.query(
      `select id, run_purpose, created_at
         from unified_check_runs
        where id = $1
        for update`,
      [runId]
    )
  ).rows[0];
  if (!run || runId !== expectation.runId) {
    throw new Error("unified_ordered_commit_run_mismatch");
  }
  const task = (
    await client.query(
      `select task.*,
              (
                $3::text = 'release_canary' and
                clock_timestamp() >=
                  $4::timestamptz + interval '35 minutes'
              ) as canary_deadline_reached
         from unified_check_tasks task
        where task.id = $1 and task.run_id = $2
        for update of task`,
      [input.taskId, runId, run.run_purpose, run.created_at]
    )
  ).rows[0];
  if (
    !task ||
    String(task.kind) !== "traversal" ||
    String(task.status) !== "LEASED" ||
    String(task.lease_token) !== input.leaseToken ||
    Number(task.attempt) !== input.attempt
  ) {
    throw new Error("unified_task_lease_lost");
  }
  if (
    checkpointDeltaHead(task.checkpoint_json) !==
      expectation.expectedDeltaHeadSha256
  ) {
    throw new Error("unified_ordered_commit_stale_head");
  }

  if (expectation.entries.length > 0) {
    const firstSequence = expectation.entries[0]!.canonicalSequence;
    const lastSequence = expectation.entries.at(-1)!.canonicalSequence;
    const rows = (
      await client.query(
      `with head as (
         select min(canonical_sequence) as canonical_sequence
           from unified_check_planner_entries
          where run_id = $1 and planner_state <> 'committed'
       )
       select head.canonical_sequence as head_sequence,
              entry.canonical_sequence, entry.planner_state,
              entry.result_bytes, entry.task_id,
              task.kind as task_kind, task.logical_key as task_logical_key,
              task.status as task_status,
              task.accepted_attempt_id,
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
         join unified_check_attempts attempt
           on attempt.id = task.accepted_attempt_id
          and attempt.task_id = task.id
         join unified_check_artifacts artifact
           on artifact.sha256 = attempt.artifact_sha256
        where entry.run_id = $1
          and entry.canonical_sequence between $2 and $3
        order by entry.canonical_sequence
        for update of entry`,
      [runId, firstSequence, lastSequence]
      )
    ).rows;
    if (rows.length !== expectation.entries.length) {
      throw new Error("unified_ordered_commit_prefix_mismatch");
    }
    for (const [index, expected] of expectation.entries.entries()) {
      const row = rows[index]!;
      const resultBytes = Number(row.result_bytes);
      if (
        Number(row.head_sequence) !== firstSequence ||
        Number(row.canonical_sequence) !== expected.canonicalSequence ||
        String(row.planner_state) !== "ready" ||
        String(row.task_id) !== expected.taskId ||
        String(row.task_kind) !== expected.taskKind ||
        String(row.task_logical_key) !== expected.logicalKey ||
        String(row.task_status) !== "COMPLETED" ||
        String(row.accepted_attempt_id) !== expected.acceptedAttemptId ||
        String(row.attempt_id) !== expected.acceptedAttemptId ||
        String(row.attempt_task_id) !== expected.taskId ||
        String(row.artifact_kind) !== expected.artifactKind ||
        String(row.artifact_schema_version) !==
          expected.artifactSchemaVersion ||
        !orderedArtifactIdentityMatches({
          artifact: row.artifact_json,
          expected,
          taskKind: row.task_kind,
          taskLogicalKey: row.task_logical_key,
          artifactKind: row.artifact_kind,
          artifactSchemaVersion: row.artifact_schema_version
        }) ||
        resultBytes !== expected.resultBytes ||
        fingerprintCanonicalArtifact(row.artifact_json) !==
          String(row.artifact_sha256) ||
        Buffer.byteLength(
          canonicalizeArtifactJson(row.artifact_json),
          "utf8"
        ) !== resultBytes
      ) {
        throw new Error("unified_ordered_commit_prefix_mismatch");
      }
    }
  }

  const checkpointed = await checkpointUnifiedTaskRow(client, input);
  if (!checkpointed) throw new Error("unified_task_lease_lost");
  if (String(checkpointed.status) === "CANCELLED") {
    return { ...checkpointed, next_head_newly_admitted: false };
  }
  if (expectation.entries.length > 0) {
    const committed = await client.query(
      `update unified_check_planner_entries
          set planner_state = 'committed',
              committed_at = statement_timestamp()
        where run_id = $1
          and canonical_sequence = any($2::bigint[])
          and planner_state = 'ready'
          and committed_at is null
        returning task_id`,
      [runId, expectation.entries.map((entry) => entry.canonicalSequence)]
    );
    if (committed.rows.length !== expectation.entries.length) {
      throw new Error("unified_ordered_commit_prefix_mismatch");
    }
  }
  await planUnifiedOrderedTasksInTransaction(client, {
    runId,
    tasks: expectation.discoveredTasks
  });
  const admission = await admitBarrierHeadInTransaction(client, {
    runId,
    reservedBytes: input.barrierReservedBytes ??
      DEFAULT_UNIFIED_ORDERED_MANIFEST_MAX_BYTES
  });
  return {
    ...checkpointed,
    next_head_newly_admitted: admission.newlyAdmitted
  };
}

export async function checkpointUnifiedTask(
  db: UnifiedQueryable,
  input: UnifiedCheckpointInput
): Promise<Record<string, unknown> | null> {
  if (!isTransactional(db)) {
    if (input.orderedCommit) {
      throw new TypeError("unified_ordered_commit_transaction_required");
    }
    return checkpointUnifiedTaskRow(db, input);
  }
  return db.transaction(async (client) => input.orderedCommit
    ? checkpointUnifiedOrderedTask(
        client,
        input,
        orderedCommitExpectation(input.orderedCommit)
      )
    : checkpointUnifiedTaskRow(client, input)
  );
}

function acceptedArtifactIdentity(
  artifact: UnifiedAcceptedArtifact
): void {
  if (
    typeof artifact.kind !== "string" ||
    artifact.kind.trim().length === 0 ||
    typeof artifact.schemaVersion !== "string" ||
    artifact.schemaVersion.trim().length === 0
  ) {
    throw new TypeError("unified_ordered_artifact_identity_invalid");
  }
}

function prepareAcceptedArtifact(
  artifact: UnifiedAcceptedArtifact,
  artifactSha256: string
): {
  readonly canonical: string;
  readonly bytes: number;
} {
  acceptedArtifactIdentity(artifact);
  const canonical = canonicalizeArtifactJson(artifact.value);
  const actualSha256 = createHash("sha256").update(canonical).digest("hex");
  if (actualSha256 !== artifactSha256) {
    throw new Error("unified_artifact_hash_mismatch");
  }
  return {
    canonical,
    bytes: Buffer.byteLength(canonical, "utf8")
  };
}

function orderedManifestMaxBytes(value: number | undefined): number {
  const limit = value ?? DEFAULT_UNIFIED_ORDERED_MANIFEST_MAX_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("unified_ordered_manifest_max_bytes_invalid");
  }
  return limit;
}

export async function completeUnifiedTaskAttempt(
  db: UnifiedTransactionalQueryable,
  input: {
    taskId: string;
    leaseToken: string;
    attempt: number;
    attemptId: string;
    artifactSha256: string;
    acceptedArtifact?: UnifiedAcceptedArtifact;
    manifestMaxBytes?: number;
    onAdaptiveEvent?: (event: UnifiedAdaptiveEvent) => void;
  }
) {
  let hardLimitError: Error | null = null;
  try {
    const outcome = await db.transaction(async (client) => {
    const discoveredTask = (
      await client.query(
        "select run_id from unified_check_tasks where id = $1",
        [input.taskId]
      )
    ).rows[0];
    if (!discoveredTask) throw new Error("unified_task_lease_lost");
    const runId = String(discoveredTask.run_id);
    const run = (
      await client.query(
        `select id, run_purpose, created_at
           from unified_check_runs
          where id = $1
          for update`,
        [runId]
      )
    ).rows[0];
    if (!run || String(run.id) !== runId) {
      throw new Error("unified_task_acceptance_conflict");
    }
    const task = (
      await client.query(
        `select task.*,
                (
                  $3::text = 'release_canary' and
                  clock_timestamp() >=
                    $4::timestamptz + interval '35 minutes'
                ) as canary_deadline_reached
           from unified_check_tasks task
          where task.id = $1 and task.run_id = $2
          for update of task`,
        [input.taskId, runId, run.run_purpose, run.created_at]
      )
    ).rows[0];
    if (!task || String(task.run_id) !== runId) {
      throw new Error("unified_task_acceptance_conflict");
    }
    const plannerTable = (
      await client.query(
        "select to_regclass('unified_check_planner_entries') as planner_table"
      )
    ).rows[0]?.planner_table;
    const planner = plannerTable
      ? (
          await client.query(
            `select *
               from unified_check_planner_entries
              where run_id = $1 and task_id = $2
              for update`,
            [task.run_id, input.taskId]
          )
        ).rows[0]
      : undefined;

    if (task.status === "COMPLETED") {
      const accepted = (
        await client.query(
          `select attempt.*, artifact.kind as artifact_kind,
                  artifact.schema_version as artifact_schema_version,
                  artifact.artifact_json
             from unified_check_attempts attempt
             join unified_check_artifacts artifact
               on artifact.sha256 = attempt.artifact_sha256
            where attempt.id = $1`,
          [task.accepted_attempt_id]
        )
      ).rows[0];
      if (
        !accepted ||
        String(accepted.task_id) !== input.taskId ||
        Number(accepted.attempt) !== input.attempt ||
        Number(task.attempt) !== input.attempt ||
        String(accepted.id) !== String(task.accepted_attempt_id) ||
        String(accepted.artifact_sha256) !== input.artifactSha256
      ) {
        throw new Error("unified_task_acceptance_conflict");
      }
      let prepared: ReturnType<typeof prepareAcceptedArtifact> | undefined;
      if (input.acceptedArtifact) {
        try {
          prepared = prepareAcceptedArtifact(
            input.acceptedArtifact,
            input.artifactSha256
          );
        } catch {
          throw new Error("unified_task_acceptance_conflict");
        }
        if (
          String(accepted.artifact_kind) !== input.acceptedArtifact.kind ||
          String(accepted.artifact_schema_version) !==
            input.acceptedArtifact.schemaVersion ||
          canonicalizeArtifactJson(accepted.artifact_json) !==
            prepared.canonical
        ) {
          throw new Error("unified_task_acceptance_conflict");
        }
      }
      if (planner) {
        const plannerResultBytes = Number(planner.result_bytes);
        if (
          !["ready", "committed"].includes(String(planner.planner_state)) ||
          planner.admitted_at === null ||
          planner.reserved_bytes !== null ||
          planner.ready_at === null ||
          !Number.isSafeInteger(plannerResultBytes) ||
          plannerResultBytes < 0 ||
          (
            prepared !== undefined &&
            plannerResultBytes !== prepared.bytes
          )
        ) {
          throw new Error("unified_task_acceptance_conflict");
        }
      }
      const {
        canary_deadline_reached: _canaryDeadlineReached,
        ...completedTask
      } = task;
      return {
        value: completedTask,
        eventType: "idempotent_acceptance_replayed" as const
      };
    }

    if (
      task.status !== "LEASED" ||
      task.lease_token !== input.leaseToken ||
      Number(task.attempt) !== input.attempt
    ) {
      throw new Error("unified_task_lease_lost");
    }
    if (
      task.cancellation_requested_at !== null ||
      task.canary_deadline_reached === true
    ) {
      await client.query(
        `update unified_check_tasks
            set status = 'CANCELLED',
                checkpoint_json = (
                  checkpoint_json || jsonb_build_object(
                    'timingSummary',
                    jsonb_build_object(
                      'attemptCount', attempt,
                      'queueDurationMs',
                      coalesce(
                        (checkpoint_json->>'queueDurationMs')::double precision,
                        0
                      ),
                      'providerDurationMs',
                      coalesce(
                        (checkpoint_json->>'providerDurationMs')::double precision,
                        0
                      )
                    ),
                    'recentAttempts',
                    jsonb_path_query_array(
                      coalesce(
                        checkpoint_json->'recentAttempts',
                        checkpoint_json->'attemptTimings',
                        '[]'::jsonb
                      ) || jsonb_build_array(jsonb_build_object(
                      'attempt', attempt,
                      'startedAt', coalesce(
                        checkpoint_json->>'currentAttemptStartedAt',
                        updated_at::text
                      ),
                      'completedAt', statement_timestamp(),
                      'durationMs', greatest(
                        extract(epoch from (
                          statement_timestamp() - coalesce(
                            (checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                            updated_at
                          )
                        )) * 1000,
                        0
                      ),
                      'outcome', 'CANCELLED'
                      )),
                      '$[last - 7 to last]'
                    )
                  )
                ) - 'currentAttemptStartedAt' - 'currentAttempt'
                  - 'attemptTimings',
                lease_owner = null, lease_token = null,
                lease_expires_at = null, heartbeat_at = null,
                last_error = 'late_result_rejected_after_cancellation',
                updated_at = statement_timestamp()
          where id = $1 and status = 'LEASED' and lease_token = $2
            and attempt = $3`,
        [input.taskId, input.leaseToken, input.attempt]
      );
      return { value: null, eventType: null };
    }

    let resultBytes: number | null = null;
    let readyPlannerState: "ready" | null = null;
    if (planner) {
      if (
        planner.admitted_at === null ||
        planner.reserved_bytes === null ||
        planner.ready_at !== null ||
        planner.committed_at !== null
      ) {
        throw new Error("unified_ordered_planner_transition_conflict");
      }
      if (!input.acceptedArtifact) {
        throw new Error("unified_ordered_artifact_required");
      }
    }
    if (input.acceptedArtifact) {
      const prepared = prepareAcceptedArtifact(
        input.acceptedArtifact,
        input.artifactSha256
      );
      if (
        planner &&
        prepared.bytes > orderedManifestMaxBytes(input.manifestMaxBytes)
      ) {
        hardLimitError = new Error("unified_ordered_manifest_hard_limit");
        throw hardLimitError;
      }
      await insertUnifiedArtifact(client, {
        sha256: input.artifactSha256,
        createdByRunId: String(task.run_id),
        kind: input.acceptedArtifact.kind,
        schemaVersion: input.acceptedArtifact.schemaVersion,
        artifact: input.acceptedArtifact.value
      });
      if (planner) {
        const transitioned = markUnifiedPlannerResultReady({
          canonicalSequence: Number(planner.canonical_sequence),
          plannerState: planner.planner_state,
          resultBytes: planner.result_bytes
        }, prepared.bytes);
        readyPlannerState = transitioned.plannerState;
        resultBytes = transitioned.resultBytes;
      }
    }

    await client.query(
      `insert into unified_check_attempts (
        id, task_id, attempt, artifact_sha256, completed_at
      ) values ($1, $2, $3, $4, statement_timestamp())`,
      [input.attemptId, input.taskId, task.attempt, input.artifactSha256]
    );
    const result = await client.query(
      `update unified_check_tasks
          set status = 'COMPLETED', accepted_attempt_id = $4,
              checkpoint_json = (
                checkpoint_json || jsonb_build_object(
                  'timingSummary',
                  jsonb_build_object(
                    'attemptCount', attempt,
                    'queueDurationMs',
                    coalesce(
                      (checkpoint_json->>'queueDurationMs')::double precision,
                      0
                    ),
                    'providerDurationMs',
                    coalesce(
                      (checkpoint_json->>'providerDurationMs')::double precision,
                      0
                    )
                  ),
                  'recentAttempts',
                  jsonb_path_query_array(
                    coalesce(
                      checkpoint_json->'recentAttempts',
                      checkpoint_json->'attemptTimings',
                      '[]'::jsonb
                    ) || jsonb_build_array(jsonb_build_object(
                    'attempt', attempt,
                    'startedAt', coalesce(
                      checkpoint_json->>'currentAttemptStartedAt',
                      updated_at::text
                    ),
                    'completedAt', statement_timestamp(),
                    'durationMs', greatest(
                      extract(epoch from (
                        statement_timestamp() - coalesce(
                          (checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                          updated_at
                        )
                      )) * 1000,
                      0
                    ),
                    'outcome', 'COMPLETED'
                    )),
                    '$[last - 7 to last]'
                  )
                )
              ) - 'currentAttemptStartedAt' - 'currentAttempt'
                - 'attemptTimings',
              lease_owner = null, lease_token = null,
              lease_expires_at = null, heartbeat_at = null,
              updated_at = statement_timestamp()
        where id = $1 and status = 'LEASED' and lease_token = $2 and attempt = $3
        returning *`,
      [input.taskId, input.leaseToken, input.attempt, input.attemptId]
    );
    const completed = requiredRow(result, "unified_task_lease_lost");
    if (planner) {
      const transitioned = await client.query(
        `update unified_check_planner_entries
            set planner_state = $3,
                result_bytes = $4,
                reserved_bytes = null,
                ready_at = statement_timestamp()
          where run_id = $1 and task_id = $2
            and planner_state = 'planned'
            and admitted_at is not null
            and reserved_bytes is not null
            and result_bytes is null
            and ready_at is null
            and committed_at is null
          returning task_id`,
        [task.run_id, input.taskId, readyPlannerState, resultBytes]
      );
      if (transitioned.rows.length !== 1) {
        throw new Error("unified_ordered_planner_transition_conflict");
      }
    }
      return { value: completed, eventType: null };
    });
    if (outcome.eventType !== null) {
      emitBestEffort(
        input.onAdaptiveEvent,
        createUnifiedAdaptiveEvent({
          type: outcome.eventType,
          occurredAt: new Date().toISOString()
        })
      );
    }
    return outcome.value;
  } catch (error) {
    if (error === hardLimitError) {
      emitBestEffort(
        input.onAdaptiveEvent,
        createUnifiedAdaptiveEvent({
          type: "manifest_hard_limit_rejected",
          occurredAt: new Date().toISOString()
        })
      );
    }
    throw error;
  }
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
        set status = case
              when cancellation_requested_at is null
                and not exists (
                  select 1 from unified_check_runs run
                   where run.id = unified_check_tasks.run_id
                     and run.run_purpose = 'release_canary'
                     and clock_timestamp() >=
                       run.created_at + interval '35 minutes'
                )
              then $4
              else 'CANCELLED'
            end,
            ready_at = coalesce($5::timestamptz, ready_at),
            checkpoint_json = (
              (
                case
                  when $6::jsonb is null then checkpoint_json
                  else $6::jsonb || jsonb_build_object(
                    'queueDurationMs',
                    coalesce(
                      (checkpoint_json->>'queueDurationMs')::double precision,
                      0
                    ),
                    'providerDurationMs',
                    coalesce(
                      (checkpoint_json->>'providerDurationMs')::double precision,
                      0
                    ),
                    'performanceCounters',
                    coalesce(
                      checkpoint_json->'performanceCounters',
                      '{}'::jsonb
                    )
                  )
                end
              ) || jsonb_build_object(
                'timingSummary',
                jsonb_build_object(
                  'attemptCount', $3::int,
                  'queueDurationMs',
                  coalesce(
                    (checkpoint_json->>'queueDurationMs')::double precision,
                    0
                  ),
                  'providerDurationMs',
                  coalesce(
                    (checkpoint_json->>'providerDurationMs')::double precision,
                    0
                  )
                ),
                'recentAttempts',
                jsonb_path_query_array(
                  coalesce(
                    checkpoint_json->'recentAttempts',
                    checkpoint_json->'attemptTimings',
                    '[]'::jsonb
                  ) || jsonb_build_array(jsonb_build_object(
                    'attempt', $3::int,
                    'startedAt', coalesce(
                      checkpoint_json->>'currentAttemptStartedAt',
                      updated_at::text
                    ),
                    'completedAt', statement_timestamp(),
                    'durationMs', greatest(
                      extract(epoch from (
                        statement_timestamp() - coalesce(
                          (checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                          updated_at
                        )
                      )) * 1000,
                      0
                    ),
                    'outcome', case
                      when cancellation_requested_at is null
                        and not exists (
                          select 1 from unified_check_runs run
                           where run.id = unified_check_tasks.run_id
                             and run.run_purpose = 'release_canary'
                             and clock_timestamp() >=
                               run.created_at + interval '35 minutes'
                        )
                      then $4
                      else 'CANCELLED'
                    end
                    )),
                    '$[last - 7 to last]'
                  )
              )
            ) - 'currentAttemptStartedAt' - 'currentAttempt'
              - 'attemptTimings',
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
            set status = case
                  when cancellation_requested_at is null
                    and not exists (
                      select 1 from unified_check_runs run
                       where run.id = unified_check_tasks.run_id
                         and run.run_purpose = 'release_canary'
                         and clock_timestamp() >=
                           run.created_at + interval '35 minutes'
                    )
                  then 'WAITING_RETRY'
                  else 'CANCELLED'
                end,
                ready_at = $4,
                checkpoint_json = (
                  (
                    case
                      when $5::jsonb is null then checkpoint_json
                      else $5::jsonb || jsonb_build_object(
                        'queueDurationMs',
                        coalesce(
                          (checkpoint_json->>'queueDurationMs')::double precision,
                          0
                        ),
                        'providerDurationMs',
                        coalesce(
                          (checkpoint_json->>'providerDurationMs')::double precision,
                          0
                        ),
                        'performanceCounters',
                        coalesce(
                          checkpoint_json->'performanceCounters',
                          '{}'::jsonb
                        )
                      )
                    end
                  ) || jsonb_build_object(
                    'timingSummary',
                    jsonb_build_object(
                      'attemptCount', $3::int,
                      'queueDurationMs',
                      coalesce(
                        (checkpoint_json->>'queueDurationMs')::double precision,
                        0
                      ),
                      'providerDurationMs',
                      coalesce(
                        (checkpoint_json->>'providerDurationMs')::double precision,
                        0
                      )
                    ),
                    'recentAttempts',
                    jsonb_path_query_array(
                      coalesce(
                        checkpoint_json->'recentAttempts',
                        checkpoint_json->'attemptTimings',
                        '[]'::jsonb
                      ) || jsonb_build_array(jsonb_build_object(
                      'attempt', $3::int,
                      'startedAt', coalesce(
                        checkpoint_json->>'currentAttemptStartedAt',
                        updated_at::text
                      ),
                      'completedAt', statement_timestamp(),
                      'durationMs', greatest(
                        extract(epoch from (
                          statement_timestamp() - coalesce(
                            (checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                            updated_at
                          )
                        )) * 1000,
                        0
                      ),
                      'outcome', case
                        when cancellation_requested_at is null
                          and not exists (
                            select 1 from unified_check_runs run
                             where run.id = unified_check_tasks.run_id
                               and run.run_purpose = 'release_canary'
                               and clock_timestamp() >=
                                 run.created_at + interval '35 minutes'
                          )
                        then 'WAITING_RETRY'
                        else 'CANCELLED'
                      end
                      )),
                      '$[last - 7 to last]'
                    )
                  )
                ) - 'currentAttemptStartedAt' - 'currentAttempt'
                  - 'attemptTimings',
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
            where sha256 = $1 and kind = $2`,
          [sha256, kind]
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
  assertUnifiedWriteAllowed({
    runPurpose: request.run_purpose as UnifiedRunPurpose,
    sideEffectPolicy: request.side_effect_policy as UnifiedSideEffectPolicy,
    namespace: "delivery_intent"
  });
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
        set cancellation_requested_at =
              coalesce(cancellation_requested_at, statement_timestamp()),
            updated_at = statement_timestamp()
      where run_id = $1
        and status in ('QUEUED','LEASED','WAITING_RETRY','BLOCKED_ADMIN')
        and cancellation_requested_at is null
      returning *`,
    [input.runId]
  );
  return result.rows;
}

export async function auditUnifiedCanaryIsolation(
  db: UnifiedQueryable,
  input: { runIds: readonly string[] }
): Promise<UnifiedCanaryIsolationAuditV1> {
  if (
    input.runIds.length < 1 ||
    input.runIds.length > 100 ||
    new Set(input.runIds).size !== input.runIds.length
  ) {
    throw new TypeError("unified_canary_isolation_audit_scope_invalid");
  }
  const row = requiredRow(
    await db.query(
      `with scoped_runs as (
         select *
           from unified_check_runs
          where id = any($1::text[])
       ), scoped_requests as (
         select request.*
           from unified_check_requests request
           join scoped_runs run on run.id = request.run_id
       )
       select
         (select count(*)::int from scoped_runs) as run_count,
         (select count(*)::int from scoped_requests) as request_count,
         (
           select count(*)::int
             from scoped_runs run
             join scoped_requests request on request.run_id = run.id
            where run.run_purpose <> 'release_canary'
               or request.run_purpose <> 'release_canary'
               or run.side_effect_policy <> 'isolated'
               or request.side_effect_policy <> 'isolated'
         ) as policy_violation_count,
         (
           select count(*)::int
             from unified_check_deliveries delivery
             join scoped_requests request on request.id = delivery.request_id
         ) as delivery_intent_write_count,
         (
           select count(*)::int
             from unified_wallet_delivery_ownership ownership
             join scoped_requests request
               on request.subject_address = ownership.subject_address
              and request.chat_id = ownership.chat_id
         ) as delivery_ownership_write_count,
         (
           select count(*)::int
             from unified_check_artifacts artifact
            where artifact.created_by_run_id = any($1::text[])
              and artifact.kind in (
                'presentation_envelope',
                'presentation_completeness_receipt',
                'delivery_intent'
              )
         ) as authoritative_presentation_artifact_count,
         (
           select count(*)::int
             from unified_check_artifacts artifact
            where artifact.created_by_run_id = any($1::text[])
         ) as namespaced_artifact_count`,
      [[...input.runIds]]
    ),
    "unified_canary_isolation_audit_failed"
  );
  if (
    Number(row.run_count) !== input.runIds.length ||
    Number(row.request_count) !== input.runIds.length
  ) {
    throw new Error("unified_canary_isolation_audit_scope_mismatch");
  }
  const deliveryOwnershipWriteCount =
    Number(row.delivery_ownership_write_count);
  const authoritativePresentationArtifactCount =
    Number(row.authoritative_presentation_artifact_count);
  return {
    version: "unified-canary-isolation-audit-v1",
    writerPolicyVersion: "unified-write-policy-v1",
    auditedRunCount: input.runIds.length,
    auditedRequestCount: input.runIds.length,
    policyViolationCount: Number(row.policy_violation_count),
    authoritativeNamespaceWriteCount:
      deliveryOwnershipWriteCount +
      authoritativePresentationArtifactCount,
    deliveryIntentWriteCount: Number(row.delivery_intent_write_count),
    deliveryOwnershipWriteCount,
    authoritativePresentationArtifactCount,
    namespacedArtifactCount: Number(row.namespaced_artifact_count),
    authoritativeNamespaces: [
      "unified_check_deliveries",
      "unified_wallet_delivery_ownership",
      "authoritative_presentation_artifacts"
    ]
  };
}

export async function reconcileUnifiedCanaryCancelledLeases(
  db: UnifiedQueryable
): Promise<string[]> {
  const result = await db.query(
    `update unified_check_tasks task
        set status = 'CANCELLED',
            checkpoint_json = (
              task.checkpoint_json || jsonb_build_object(
                'recentAttempts',
                jsonb_path_query_array(
                  coalesce(
                    task.checkpoint_json->'recentAttempts',
                    task.checkpoint_json->'attemptTimings',
                    '[]'::jsonb
                  ) || jsonb_build_array(jsonb_build_object(
                  'attempt', task.attempt,
                  'startedAt', coalesce(
                    task.checkpoint_json->>'currentAttemptStartedAt',
                    task.updated_at::text
                  ),
                  'completedAt', statement_timestamp(),
                  'durationMs', greatest(
                    extract(epoch from (
                      statement_timestamp() - coalesce(
                        (task.checkpoint_json->>'currentAttemptStartedAt')::timestamptz,
                        task.updated_at
                      )
                    )) * 1000,
                    0
                  ),
                  'outcome', 'CANCELLED'
                  )),
                  '$[last - 7 to last]'
                )
              )
            ) - 'currentAttemptStartedAt' - 'currentAttempt'
              - 'attemptTimings',
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null,
            heartbeat_at = null,
            last_error = coalesce(
              task.last_error,
              'canary_cancelled_lease_expired'
            ),
            updated_at = statement_timestamp()
       from unified_check_runs run
      where run.id = task.run_id
        and run.run_purpose = 'release_canary'
        and run.side_effect_policy = 'isolated'
        and run.status in ('BLOCKED_ADMIN','FAILED_TECHNICAL')
        and task.status = 'LEASED'
        and task.cancellation_requested_at is not null
        and task.lease_expires_at <= statement_timestamp()
      returning task.id`
  );
  return result.rows.map((row) => String(row.id));
}

export async function persistUnifiedCanaryBlocker(
  db: UnifiedTransactionalQueryable,
  input: {
    runId: string;
    sha256: string;
    artifact: UnifiedCanaryExecutionBlockedV1;
  }
) {
  return db.transaction(async (client) => {
    const run = requiredRow(
      await client.query(
        `select *,
                clock_timestamp() <
                  created_at + interval '35 minutes' as before_deadline
           from unified_check_runs
          where id = $1 and run_purpose = 'release_canary'
            and side_effect_policy = 'isolated'
          for update`,
        [input.runId]
      ),
      "unified_canary_run_missing"
    );
    if (String(run.id) !== input.runId) {
      throw new Error("unified_canary_run_binding_invalid");
    }
    if (run.status === "COMPLETED") {
      return { state: "completed" as const };
    }
    if (run.status === "FAILED_TECHNICAL") {
      throw new Error("unified_canary_blocker_after_technical_failure");
    }
    if (run.status === "BLOCKED_ADMIN") {
      const existing = requiredRow(
        await client.query(
          `select sha256, artifact_json
             from unified_check_artifacts
            where created_by_run_id = $1
              and kind = 'canary_execution_blocked'
            order by created_at, sha256
            limit 1`,
          [input.runId]
        ),
        "unified_canary_persisted_blocker_missing"
      );
      if (
        fingerprintCanonicalArtifact(existing.artifact_json) !==
          existing.sha256
      ) {
        throw new Error("unified_canary_persisted_blocker_invalid");
      }
      return {
        state: "blocked" as const,
        artifact: existing.artifact_json as UnifiedCanaryExecutionBlockedV1
      };
    }
    if (run.before_deadline === true) {
      throw new Error("unified_canary_deadline_not_reached");
    }
    requiredRow(
      await client.query(
        `update unified_check_runs
            set status = 'BLOCKED_ADMIN',
                status_reason = 'canary_execution_blocked',
                final_score = null,
                final_decision = null,
                updated_at = statement_timestamp()
          where id = $1 and status in (
            'RUNNING','WAITING_FOR_PROVIDER','FINALIZING'
          )
          returning *`,
        [input.runId]
      ),
      "unified_canary_blocker_fence_failed"
    );
    await client.query(
      `update unified_check_tasks
          set status = case
                when status = 'LEASED' then status
                else 'CANCELLED'
              end,
              cancellation_requested_at =
                coalesce(cancellation_requested_at, statement_timestamp()),
              lease_owner = case
                when status = 'LEASED' then lease_owner else null end,
              lease_token = case
                when status = 'LEASED' then lease_token else null end,
              lease_expires_at = case
                when status = 'LEASED' then lease_expires_at else null end,
              heartbeat_at = case
                when status = 'LEASED' then heartbeat_at else null end,
              updated_at = statement_timestamp()
        where run_id = $1
          and status in ('QUEUED','LEASED','WAITING_RETRY','BLOCKED_ADMIN')`,
      [input.runId]
    );
    await insertUnifiedArtifact(client, {
      sha256: input.sha256,
      createdByRunId: input.runId,
      kind: "canary_execution_blocked",
      schemaVersion: "1",
      artifact: input.artifact
    });
    return { state: "blocked" as const, artifact: input.artifact };
  });
}

export async function cooperateUnifiedCanaryRun(
  db: UnifiedTransactionalQueryable,
  input: { runId: string }
): Promise<boolean> {
  return db.transaction(async (client) => {
    const run = requiredRow(
      await client.query(
        `select id, status, run_purpose, side_effect_policy,
                clock_timestamp() <
                  created_at + interval '35 minutes' as before_deadline
           from unified_check_runs
          where id = $1
          for update`,
        [input.runId]
      ),
      "unified_canary_run_missing"
    );
    if (run.run_purpose !== "release_canary") return true;
    if (run.side_effect_policy !== "isolated") {
      throw new Error("unified_canary_side_effect_policy_invalid");
    }
    const mayContinue =
      run.status === "RUNNING" && run.before_deadline === true;
    if (mayContinue) return true;
    await client.query(
      `update unified_check_tasks
          set cancellation_requested_at =
                coalesce(cancellation_requested_at, statement_timestamp()),
              updated_at = statement_timestamp()
        where run_id = $1
          and status in ('QUEUED','LEASED','WAITING_RETRY','BLOCKED_ADMIN')`,
      [input.runId]
    );
    return false;
  });
}

export async function reconcileUnifiedCanaryTechnicalFailures(
  db: UnifiedTransactionalQueryable
) {
  return db.transaction(async (client) => {
    const runs = (
      await client.query(
        `update unified_check_runs run
            set status = 'FAILED_TECHNICAL',
                status_reason = (
                  select task.last_error
                    from unified_check_tasks task
                   where task.run_id = run.id
                     and task.status = 'FAILED_TECHNICAL'
                   order by task.updated_at, task.id
                   limit 1
                ),
                final_score = null,
                final_decision = null,
                updated_at = statement_timestamp()
          where run.status in ('RUNNING','WAITING_FOR_PROVIDER')
            and run.run_purpose = 'release_canary'
            and run.side_effect_policy = 'isolated'
            and exists (
              select 1
                from unified_check_tasks task
               where task.run_id = run.id
                 and task.status = 'FAILED_TECHNICAL'
            )
          returning run.id`
      )
    ).rows;
    for (const run of runs) {
      await client.query(
        `update unified_check_tasks
            set status = case
                  when status = 'LEASED' then status
                  else 'CANCELLED'
                end,
                cancellation_requested_at =
                  coalesce(cancellation_requested_at, statement_timestamp()),
                lease_owner = case
                  when status = 'LEASED' then lease_owner else null end,
                lease_token = case
                  when status = 'LEASED' then lease_token else null end,
                lease_expires_at = case
                  when status = 'LEASED' then lease_expires_at else null end,
                heartbeat_at = case
                  when status = 'LEASED' then heartbeat_at else null end,
                updated_at = statement_timestamp()
          where run_id = $1
            and status in ('QUEUED','LEASED','WAITING_RETRY','BLOCKED_ADMIN')`,
        [run.id]
      );
    }
    return runs.map((run) => String(run.id));
  });
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

function attemptDurations(
  value: unknown
): UnifiedWatchdogRunV1["tasks"][number]["attemptDurations"] {
  if (!Array.isArray(value)) return [];
  const outcomes = new Set([
    "CHECKPOINTED",
    "WAITING_RETRY",
    "COMPLETED",
    "BLOCKED_ADMIN",
    "FAILED_TECHNICAL",
    "CANCELLED",
    "LEASE_EXPIRED"
  ]);
  return value.flatMap((raw) => {
    const timing = object(raw);
    const attempt = Number(timing.attempt);
    const outcome = String(timing.outcome);
    if (
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      !outcomes.has(outcome)
    ) return [];
    try {
      return [{
        attempt,
        startedAt: iso(timing.startedAt),
        completedAt: iso(timing.completedAt),
        durationMs: duration(timing.durationMs),
        outcome: outcome as
          UnifiedWatchdogRunV1["tasks"][number][
            "attemptDurations"
          ][number]["outcome"]
      }];
    } catch {
      return [];
    }
  });
}

export async function listUnifiedWatchdogRuns(
  db: UnifiedQueryable,
  input: { limit?: number; runIds?: readonly string[] } = {}
): Promise<UnifiedWatchdogRunV1[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  if (input.runIds?.length === 0) return [];
  const runs = (await db.query(
    `select * from unified_check_runs
      where ($2::text[] is null or id = any($2::text[]))
      order by updated_at desc, id limit $1`,
    [limit, input.runIds ? [...new Set(input.runIds)] : null]
  )).rows;
  const fence = (await db.query(
    `select generation_id, delivery_generation, activated_at
       from unified_check_generation_fence
      where active = true
      order by activated_at desc, generation_id
      limit 1`
  )).rows[0];
  const result: UnifiedWatchdogRunV1[] = [];
  const projectionNow = Date.now();
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
        const storedQueue = duration(checkpoint.queueDurationMs);
        const storedProvider = duration(checkpoint.providerDurationMs);
        const updatedAt = Date.parse(iso(task.updated_at));
        const readyAt = Date.parse(iso(task.ready_at));
        const queue = storedQueue + (
          task.status === "QUEUED"
            ? Math.max(0, projectionNow - updatedAt)
            : task.status === "WAITING_RETRY"
              ? Math.max(0, projectionNow - Math.max(readyAt, updatedAt))
              : 0
        );
        const provider = storedProvider + (
          task.status === "WAITING_RETRY"
            ? Math.max(
              0,
              Math.min(projectionNow, readyAt) - updatedAt
            )
            : 0
        );
        const terminal = [
          "COMPLETED",
          "FAILED_TECHNICAL",
          "CANCELLED",
          "BLOCKED_ADMIN"
        ].includes(String(task.status));
        const elapsed = Math.max(
          0,
          (terminal ? Date.parse(iso(task.updated_at)) : projectionNow) -
            Date.parse(iso(task.created_at))
        );
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
          lastError: task.last_error === null
            ? null
            : String(task.last_error),
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
          attemptDurations: attemptDurations(
            checkpoint.recentAttempts ?? checkpoint.attemptTimings
          ),
          durationsMs: {
            queue,
            provider,
            compute: Math.max(0, elapsed - queue - provider)
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
