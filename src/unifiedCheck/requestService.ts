import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type {
  AnalysisManifestV1,
  UnifiedRunPurpose,
  UnifiedRunStatus,
  UnifiedSideEffectPolicy,
  UnifiedTraversalPolicyVersion
} from "./contracts";
import {
  parseAnalysisManifestV1,
  UNIFIED_BOUNDARY_PREDICATE_VERSION,
  UNIFIED_LABEL_CATALOG_VERSION
} from "./contracts";
import {
  acquireConfirmedWalletSnapshot,
  type ConfirmedWalletSnapshotV1,
  type SnapshotSource
} from "./snapshot";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "./repository";
import type { FrozenLabelDatasetV1 } from "./frozenLabels";
import {
  selectUnifiedRunRolloutPolicy,
  type UnifiedRollingRolloutStage,
  type UnifiedRunRolloutPolicy
} from "./rolloutPolicy";

export type CheckRequestStatus = "ACCEPTED" | "ATTACHED" | "FAILED_TECHNICAL";

export type CheckRequestRecord = {
  readonly id: string;
  readonly requestCorrelationId: string;
  readonly subjectAddress: string;
  readonly chatId: string;
  readonly messageThreadId: string;
  readonly locale: "ru" | "en";
  readonly runPurpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly status: CheckRequestStatus;
  readonly statusReason: string | null;
  readonly runId: string | null;
  readonly readyAt: string;
  readonly attemptCount: number;
  readonly acceptedAt: string;
};

export type AnalysisRunRecord = {
  readonly id: string;
  readonly fairnessOwnerId: string;
  readonly analysisKeySha256: string;
  readonly subjectAddress: string;
  readonly runPurpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly status: UnifiedRunStatus;
  readonly snapshotHash: string;
  readonly snapshot: ConfirmedWalletSnapshotV1;
  readonly analysisManifestSha256: string;
  readonly analysisManifest: AnalysisManifestV1;
  readonly rolloutPolicy: UnifiedRunRolloutPolicy;
};

export type UnifiedInitialTask = {
  readonly id: string;
  readonly kind: string;
  readonly priorityLane: "interactive" | "repair" | "background";
  readonly logicalKey: string;
};

export type UnifiedRequestStore = {
  createOrGetAcceptedRequest(input: CheckRequestRecord): Promise<CheckRequestRecord>;
  attachedRun(request: CheckRequestRecord): Promise<AnalysisRunRecord | null>;
  attach(input: {
    requestId: string;
    candidateRun: AnalysisRunRecord;
    reuseAllowed: boolean;
    labelDataset?: {
      readonly sha256: string;
      readonly dataset: FrozenLabelDatasetV1;
    };
    initialTasks?: readonly UnifiedInitialTask[];
  }): Promise<{ request: CheckRequestRecord; run: AnalysisRunRecord; reused: boolean }>;
  providerWait(requestId: string, readyAt: string): Promise<CheckRequestRecord>;
  fail(requestId: string, reason: string): Promise<CheckRequestRecord>;
};

function requestRecord(row: Record<string, unknown>): CheckRequestRecord {
  return {
    id: String(row.id),
    requestCorrelationId: String(row.request_correlation_id),
    subjectAddress: String(row.subject_address),
    chatId: String(row.chat_id),
    messageThreadId: String(row.message_thread_id),
    locale: row.locale as "ru" | "en",
    runPurpose: row.run_purpose as UnifiedRunPurpose,
    sideEffectPolicy: row.side_effect_policy as UnifiedSideEffectPolicy,
    status: row.status as CheckRequestStatus,
    statusReason: row.status_reason === null ? null : String(row.status_reason),
    runId: row.run_id === null ? null : String(row.run_id),
    readyAt: new Date(String(row.ready_at)).toISOString(),
    attemptCount: Number(row.attempt_count),
    acceptedAt: new Date(String(row.accepted_at)).toISOString()
  };
}

async function runRecord(
  db: UnifiedQueryable,
  row: Record<string, unknown>
): Promise<AnalysisRunRecord> {
  const artifact = (
    await db.query(
      "select artifact_json from unified_check_artifacts where sha256 = $1",
      [row.analysis_manifest_sha256]
    )
  ).rows[0];
  if (!artifact) throw new Error("unified_analysis_manifest_missing");
  const rawManifest = artifact.artifact_json;
  const rawSnapshotHash = rawManifest !== null &&
      typeof rawManifest === "object" &&
      !Array.isArray(rawManifest) &&
      typeof (rawManifest as { snapshotHash?: unknown }).snapshotHash ===
        "string"
    ? (rawManifest as { snapshotHash: string }).snapshotHash
    : "";
  const manifest = parseAnalysisManifestV1(rawManifest, {
    runId: String(row.id),
    subjectAddress: String(row.subject_address),
    snapshotHash: rawSnapshotHash
  });
  if (fingerprintCanonicalArtifact(manifest) !== row.analysis_manifest_sha256) {
    throw new Error("unified_analysis_manifest_hash_mismatch");
  }
  const snapshotArtifact = (
    await db.query(
      "select artifact_json from unified_check_artifacts where sha256 = $1",
      [manifest.snapshotHash]
    )
  ).rows[0];
  if (!snapshotArtifact) throw new Error("unified_snapshot_artifact_missing");
  const snapshot = snapshotArtifact.artifact_json as ConfirmedWalletSnapshotV1;
  if (
    fingerprintCanonicalArtifact(snapshot) !== manifest.snapshotHash ||
    snapshot.confirmedBlockNumber !== manifest.confirmedBlockNumber ||
    snapshot.confirmedBlockHash !== manifest.confirmedBlockHash
  ) {
    throw new Error("unified_snapshot_artifact_mismatch");
  }
  return {
    id: String(row.id),
    fairnessOwnerId: requiredFairnessOwnerId(row.fairness_owner_id),
    analysisKeySha256: String(row.analysis_key_sha256),
    subjectAddress: String(row.subject_address),
    runPurpose: row.run_purpose as UnifiedRunPurpose,
    sideEffectPolicy: row.side_effect_policy as UnifiedSideEffectPolicy,
    status: row.status as UnifiedRunStatus,
    snapshotHash: manifest.snapshotHash,
    snapshot,
    analysisManifestSha256: String(row.analysis_manifest_sha256),
    analysisManifest: manifest,
    rolloutPolicy: requiredRunRolloutPolicy(row)
  };
}

function requiredRunRolloutPolicy(
  row: Record<string, unknown>
): UnifiedRunRolloutPolicy {
  const stage = row.rollout_stage;
  const admissionPolicy = row.admission_policy;
  const bucket = Number(row.rollout_bucket);
  const providerCapacityCeiling = Number(row.provider_capacity_ceiling);
  if (
    ![
      "global_barrier",
      "isolated_rolling",
      "bounded_user_check",
      "rolling_default"
    ].includes(String(stage)) ||
    !["barrier", "rolling"].includes(String(admissionPolicy)) ||
    !Number.isSafeInteger(bucket) ||
    bucket < 0 ||
    bucket > 9_999 ||
    !Number.isSafeInteger(providerCapacityCeiling) ||
    providerCapacityCeiling < 1 ||
    providerCapacityCeiling > 100
  ) {
    throw new Error("unified_run_rollout_policy_invalid");
  }
  return {
    stage: stage as UnifiedRollingRolloutStage,
    bucket,
    admissionPolicy: admissionPolicy as "barrier" | "rolling",
    providerCapacityCeiling
  };
}

function requiredFairnessOwnerId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("unified_fairness_owner_missing");
  }
  return value;
}

export function unifiedFairnessOwnerId(input: {
  runPurpose: UnifiedRunPurpose;
  chatId: string;
  runId: string;
}): string {
  const runId = requiredFairnessOwnerId(input.runId);
  if (input.runPurpose !== "user_check") return runId;
  const chatId = requiredFairnessOwnerId(input.chatId);
  return fingerprintCanonicalArtifact({
    version: "unified-fairness-owner-v1",
    channel: "telegram",
    owner: chatId
  });
}

function one(
  result: { rows: Array<Record<string, unknown>> },
  code: string
): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new Error(code);
  return row;
}

export function createPostgresUnifiedRequestStore(
  db: UnifiedTransactionalQueryable
): UnifiedRequestStore {
  return {
    async createOrGetAcceptedRequest(input) {
      const inserted = await db.query(
        `insert into unified_check_requests (
          id, request_correlation_id, subject_address, chat_id, message_thread_id,
          locale, run_purpose, side_effect_policy, status, ready_at, attempt_count, accepted_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,'ACCEPTED',$9,0,$9)
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
          input.sideEffectPolicy,
          input.acceptedAt
        ]
      );
      const row = inserted.rows[0] ?? one(
        await db.query(
          "select * from unified_check_requests where request_correlation_id = $1",
          [input.requestCorrelationId]
        ),
        "unified_request_reuse_failed"
      );
      return requestRecord(row);
    },

    async attachedRun(request) {
      if (!request.runId) return null;
      const row = (
        await db.query("select * from unified_check_runs where id = $1", [request.runId])
      ).rows[0];
      return row ? runRecord(db, row) : null;
    },

    async attach(input) {
      return db.transaction(async (client) => {
        const request = one(
          await client.query(
            "select * from unified_check_requests where id = $1 for update",
            [input.requestId]
          ),
          "unified_request_missing"
        );
        if (request.status === "ATTACHED") {
          const row = one(
            await client.query("select * from unified_check_runs where id = $1", [request.run_id]),
            "unified_attached_run_missing"
          );
          const run = await runRecord(client, row);
          return { request: requestRecord(request), run, reused: true };
        }
        if (request.status !== "ACCEPTED") throw new Error("unified_request_not_accepted");

        if (input.labelDataset) {
          if (
            fingerprintCanonicalArtifact(input.labelDataset.dataset) !==
              input.labelDataset.sha256
          ) {
            throw new Error("unified_frozen_label_dataset_hash_mismatch");
          }
          await client.query(
            `insert into unified_label_datasets (sha256, dataset_json)
             values ($1,$2::jsonb)
             on conflict (sha256) do nothing`,
            [
              input.labelDataset.sha256,
              JSON.stringify(input.labelDataset.dataset)
            ]
          );
          const persisted = one(
            await client.query(
              `select dataset_json from unified_label_datasets
                where sha256 = $1`,
              [input.labelDataset.sha256]
            ),
            "unified_frozen_label_dataset_missing"
          );
          if (
            fingerprintCanonicalArtifact(persisted.dataset_json) !==
              input.labelDataset.sha256
          ) {
            throw new Error("unified_frozen_label_dataset_persistence_mismatch");
          }
        }

        let runRow = input.reuseAllowed
          ? (
              await client.query(
                `select * from unified_check_runs
                  where analysis_key_sha256 = $1 and status <> 'FAILED_TECHNICAL'
                  order by created_at asc limit 1 for update`,
                [input.candidateRun.analysisKeySha256]
              )
            ).rows[0]
          : undefined;
        let reused = Boolean(runRow);
        if (!runRow) {
          const inserted = await client.query(
            `insert into unified_check_runs (
              id, analysis_key_sha256, subject_address, status, run_purpose,
              side_effect_policy, analysis_manifest_sha256, fairness_owner_id,
              rollout_stage, rollout_bucket, admission_policy,
              provider_capacity_ceiling
            ) values ($1,$2,$3,'RUNNING',$4,$5,$6,$7,$8,$9,$10,$11)
            on conflict do nothing returning *`,
            [
              input.candidateRun.id,
              input.candidateRun.analysisKeySha256,
              input.candidateRun.subjectAddress,
              input.candidateRun.runPurpose,
              input.candidateRun.sideEffectPolicy,
              input.candidateRun.analysisManifestSha256,
              input.candidateRun.fairnessOwnerId,
              input.candidateRun.rolloutPolicy.stage,
              input.candidateRun.rolloutPolicy.bucket,
              input.candidateRun.rolloutPolicy.admissionPolicy,
              input.candidateRun.rolloutPolicy.providerCapacityCeiling
            ]
          );
          runRow = inserted.rows[0];
          if (!runRow) {
            runRow = one(
              await client.query(
                `select * from unified_check_runs
                  where analysis_key_sha256 = $1 and status <> 'FAILED_TECHNICAL'
                  order by created_at asc limit 1`,
                [input.candidateRun.analysisKeySha256]
              ),
              "unified_run_reuse_failed"
            );
            reused = true;
          } else {
            await client.query(
              `insert into unified_check_artifacts (
                sha256, created_by_run_id, kind, schema_version, artifact_json
              ) values
                ($1,$2,'confirmed_snapshot','1',$3::jsonb),
                ($4,$2,'analysis_manifest','1',$5::jsonb)`,
              [
                input.candidateRun.snapshotHash,
                input.candidateRun.id,
                JSON.stringify(input.candidateRun.snapshot),
                input.candidateRun.analysisManifestSha256,
                JSON.stringify(input.candidateRun.analysisManifest)
              ]
            );
          }
        }
        for (const task of input.initialTasks ?? []) {
          await client.query(
            `insert into unified_check_tasks (
              id, run_id, kind, status, priority_lane, logical_key
            ) values ($1,$2,$3,'QUEUED',$4,$5)
            on conflict (run_id, kind, logical_key) do nothing`,
            [
              task.id,
              runRow.id,
              task.kind,
              task.priorityLane,
              task.logicalKey
            ]
          );
        }
        const attached = one(
          await client.query(
            `update unified_check_requests
                set status = 'ATTACHED', run_id = $2
              where id = $1 and status = 'ACCEPTED'
              returning *`,
            [input.requestId, runRow.id]
          ),
          "unified_request_attach_failed"
        );
        const run = await runRecord(client, runRow);
        return { request: requestRecord(attached), run, reused };
      });
    },

    async providerWait(requestId, readyAt) {
      return requestRecord(one(
        await db.query(
          `update unified_check_requests
              set ready_at = $2, attempt_count = attempt_count + 1
            where id = $1 and status = 'ACCEPTED'
            returning *`,
          [requestId, readyAt]
        ),
        "unified_request_provider_wait_failed"
      ));
    },

    async fail(requestId, reason) {
      return requestRecord(one(
        await db.query(
          `update unified_check_requests
              set status = 'FAILED_TECHNICAL', status_reason = $2
            where id = $1 and status = 'ACCEPTED'
            returning *`,
          [requestId, reason]
        ),
        "unified_request_fail_failed"
      ));
    }
  };
}

export type UnifiedAnalysisVersions = {
  readonly labelDatasetSha256: string;
  readonly scoringPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
  readonly runtimeCommit: string;
  readonly schemaVersion: number;
};

export class UnifiedProviderWaitError extends Error {
  constructor(readonly readyAt: string, message = "provider_wait") {
    super(message);
  }
}

type IntakeInput = {
  store: UnifiedRequestStore;
  snapshotSource: SnapshotSource;
  request: {
    id: string;
    requestCorrelationId: string;
    subjectAddress: string;
    chatId: string;
    messageThreadId: string;
    locale: "ru" | "en";
    runPurpose: UnifiedRunPurpose;
    sideEffectPolicy: UnifiedSideEffectPolicy;
  };
  candidateRunId: string;
  initialTasks?: readonly UnifiedInitialTask[];
  versions: UnifiedAnalysisVersions;
  rolloutPolicy?: {
    readonly stage: UnifiedRollingRolloutStage;
    readonly boundedUserCheckBasisPoints: number;
    readonly providerCapacityCeiling: number;
  };
  freezeLabelDataset?(input: {
    readonly snapshot: ConfirmedWalletSnapshotV1;
    readonly snapshotHash: string;
    readonly frozenAt: string;
  }): Promise<{
    readonly sha256: string;
    readonly dataset: FrozenLabelDatasetV1;
  }>;
  now?: () => Date;
};

type AttachedIntake = {
  kind: "attached";
  request: CheckRequestRecord;
  run: AnalysisRunRecord;
  snapshot: ConfirmedWalletSnapshotV1 | null;
  reused: boolean;
};

export type UnifiedIntakeResult =
  | AttachedIntake
  | { kind: "waiting_for_provider"; request: CheckRequestRecord }
  | { kind: "failed_technical"; request: CheckRequestRecord };

function iso(date: Date): string {
  const value = date.toISOString();
  if (!Number.isFinite(date.getTime())) throw new TypeError("unified_invalid_clock");
  return value;
}

export function buildUnifiedBranchInput(
  branch: "fast" | "deep" | "where",
  snapshotHash: string,
  versions: UnifiedAnalysisVersions
): {
  readonly version: "unified-branch-input-v1" | "unified-branch-input-v2";
  readonly branch: "fast" | "deep" | "where";
  readonly snapshotHash: string;
  readonly labelDatasetSha256: string;
  readonly labelCatalogVersion: typeof UNIFIED_LABEL_CATALOG_VERSION;
  readonly boundaryPredicateVersion:
    typeof UNIFIED_BOUNDARY_PREDICATE_VERSION;
  readonly traversalPolicyVersion?: "snapshot-closure-v2";
  readonly runtimeCommit: string;
  readonly schemaVersion: number;
} {
  const legacy = {
    version: "unified-branch-input-v1",
    branch,
    snapshotHash,
    labelDatasetSha256: versions.labelDatasetSha256,
    labelCatalogVersion: UNIFIED_LABEL_CATALOG_VERSION,
    boundaryPredicateVersion: UNIFIED_BOUNDARY_PREDICATE_VERSION,
    runtimeCommit: versions.runtimeCommit,
    schemaVersion: versions.schemaVersion
  } as const;
  return versions.traversalPolicyVersion === "snapshot-closure-v1"
    ? legacy
    : {
        ...legacy,
        version: "unified-branch-input-v2",
        traversalPolicyVersion: "snapshot-closure-v2"
      };
}

function branchInputHash(
  branch: "fast" | "deep" | "where",
  snapshotHash: string,
  versions: UnifiedAnalysisVersions
): string {
  return fingerprintCanonicalArtifact(
    buildUnifiedBranchInput(branch, snapshotHash, versions)
  );
}

export function buildUnifiedAnalysisIdentity(input: {
  subjectAddress: string;
  snapshot: ConfirmedWalletSnapshotV1;
  snapshotHash: string;
  versions: UnifiedAnalysisVersions;
  reuseScope: "shared" | string;
}): { requestHash: string; analysisKeySha256: string } {
  const legacySharedMaterial = {
    version: "unified-analysis-key-v1" as const,
    chain: "tron",
    subjectAddress: input.subjectAddress,
    confirmedBlockNumber: input.snapshot.confirmedBlockNumber,
    confirmedBlockHash: input.snapshot.confirmedBlockHash,
    snapshotHash: input.snapshotHash,
    labelDatasetSha256: input.versions.labelDatasetSha256,
    labelCatalogVersion: UNIFIED_LABEL_CATALOG_VERSION,
    boundaryPredicateVersion: UNIFIED_BOUNDARY_PREDICATE_VERSION,
    scoringPolicyVersion: input.versions.scoringPolicyVersion,
    attributionPolicyVersion: input.versions.attributionPolicyVersion,
    runtimeCommit: input.versions.runtimeCommit,
    schemaVersion: input.versions.schemaVersion
  };
  const sharedMaterial = input.versions.traversalPolicyVersion ===
      "snapshot-closure-v1"
    ? legacySharedMaterial
    : {
        ...legacySharedMaterial,
        version: "unified-analysis-key-v2" as const,
        traversalPolicyVersion: "snapshot-closure-v2" as const
      };
  const material = { ...sharedMaterial, reuseScope: input.reuseScope };
  return {
    requestHash: fingerprintCanonicalArtifact(sharedMaterial),
    analysisKeySha256: fingerprintCanonicalArtifact(material)
  };
}

export async function intakeUnifiedCheck(input: IntakeInput): Promise<UnifiedIntakeResult> {
  const now = input.now ?? (() => new Date());
  const acceptedAt = iso(now());
  const accepted = await input.store.createOrGetAcceptedRequest({
    ...input.request,
    status: "ACCEPTED",
    statusReason: null,
    runId: null,
    readyAt: acceptedAt,
    attemptCount: 0,
    acceptedAt
  });
  if (
    accepted.subjectAddress !== input.request.subjectAddress ||
    accepted.chatId !== input.request.chatId ||
    accepted.messageThreadId !== input.request.messageThreadId ||
    accepted.locale !== input.request.locale ||
    accepted.runPurpose !== input.request.runPurpose ||
    accepted.sideEffectPolicy !== input.request.sideEffectPolicy
  ) {
    throw new Error("unified_request_correlation_conflict");
  }
  if (
    accepted.runPurpose === "release_canary" &&
    accepted.sideEffectPolicy !== "isolated"
  ) {
    throw new Error("unified_canary_must_be_isolated");
  }
  if (accepted.status === "FAILED_TECHNICAL") {
    return { kind: "failed_technical", request: accepted };
  }
  if (accepted.status === "ATTACHED") {
    const run = await input.store.attachedRun(accepted);
    if (!run) throw new Error("unified_attached_run_missing");
    return { kind: "attached", request: accepted, run, snapshot: null, reused: true };
  }
  if (new Date(accepted.readyAt).getTime() > now().getTime()) {
    return { kind: "waiting_for_provider", request: accepted };
  }

  try {
    const { snapshot, sha256: snapshotHash } =
      await acquireConfirmedWalletSnapshot(input.snapshotSource, accepted.subjectAddress);
    const frozenLabels = input.freezeLabelDataset
      ? await input.freezeLabelDataset({
          snapshot,
          snapshotHash,
          frozenAt: snapshot.timestamp
        })
      : null;
    if (
      frozenLabels !== null &&
      (
        frozenLabels.dataset.snapshotHash !== snapshotHash ||
        frozenLabels.dataset.frozenAt !== snapshot.timestamp ||
        fingerprintCanonicalArtifact(frozenLabels.dataset) !==
          frozenLabels.sha256
      )
    ) {
      throw new Error("unified_frozen_label_dataset_binding_mismatch");
    }
    const effectiveVersions: UnifiedAnalysisVersions = {
      ...input.versions,
      labelDatasetSha256:
        frozenLabels?.sha256 ?? input.versions.labelDatasetSha256
    };
    const canReuse = accepted.runPurpose !== "release_canary";
    const reuseScope = canReuse ? "shared" : `isolated:${accepted.id}`;
    const identity = buildUnifiedAnalysisIdentity({
      subjectAddress: accepted.subjectAddress,
      snapshot,
      snapshotHash,
      versions: effectiveVersions,
      reuseScope
    });
    const manifest: AnalysisManifestV1 = {
      version: "analysis-manifest-v1",
      schemaVersion: 1,
      runId: input.candidateRunId,
      requestHash: identity.requestHash,
      snapshotHash,
      chain: "tron",
      subjectAddress: accepted.subjectAddress,
      confirmedBlockNumber: snapshot.confirmedBlockNumber,
      confirmedBlockHash: snapshot.confirmedBlockHash,
      confirmedBlockTimestamp: snapshot.timestamp,
      labelDatasetSha256: effectiveVersions.labelDatasetSha256,
      labelCatalogVersion: UNIFIED_LABEL_CATALOG_VERSION,
      boundaryPredicateVersion: UNIFIED_BOUNDARY_PREDICATE_VERSION,
      scoringPolicyVersion: effectiveVersions.scoringPolicyVersion,
      attributionPolicyVersion: effectiveVersions.attributionPolicyVersion,
      traversalPolicyVersion: effectiveVersions.traversalPolicyVersion,
      runtimeCommit: effectiveVersions.runtimeCommit,
      databaseSchemaVersion: effectiveVersions.schemaVersion,
      paginationCutoffBlockNumber: snapshot.confirmedBlockNumber,
      paginationCutoffBlockHash: snapshot.confirmedBlockHash,
      branchArtifactHashes: {
        fast: branchInputHash("fast", snapshotHash, effectiveVersions),
        deep: branchInputHash("deep", snapshotHash, effectiveVersions),
        where: branchInputHash("where", snapshotHash, effectiveVersions)
      }
    };
    const attached = await input.store.attach({
      requestId: accepted.id,
      reuseAllowed: canReuse,
      labelDataset: frozenLabels ?? undefined,
      initialTasks: input.initialTasks,
      candidateRun: {
        id: input.candidateRunId,
        fairnessOwnerId: unifiedFairnessOwnerId({
          runPurpose: accepted.runPurpose,
          chatId: accepted.chatId,
          runId: input.candidateRunId
        }),
        analysisKeySha256: identity.analysisKeySha256,
        subjectAddress: accepted.subjectAddress,
        runPurpose: accepted.runPurpose,
        sideEffectPolicy: accepted.sideEffectPolicy,
        status: "RUNNING",
        snapshotHash,
        snapshot,
        analysisManifestSha256: fingerprintCanonicalArtifact(manifest),
        analysisManifest: manifest,
        rolloutPolicy: selectUnifiedRunRolloutPolicy({
          stage:
            input.rolloutPolicy?.stage ?? "global_barrier",
          boundedUserCheckBasisPoints:
            input.rolloutPolicy?.boundedUserCheckBasisPoints ?? 0,
          providerCapacityCeiling:
            input.rolloutPolicy?.providerCapacityCeiling ?? 1,
          runId: input.candidateRunId,
          runPurpose: accepted.runPurpose,
          sideEffectPolicy: accepted.sideEffectPolicy
        })
      }
    });
    return { kind: "attached", ...attached, snapshot };
  } catch (error) {
    if (error instanceof UnifiedProviderWaitError) {
      return {
        kind: "waiting_for_provider",
        request: await input.store.providerWait(accepted.id, error.readyAt)
      };
    }
    const code = error instanceof Error ? error.message : "unified_intake_failed";
    return {
      kind: "failed_technical",
      request: await input.store.fail(accepted.id, code)
    };
  }
}
