import { fingerprintCanonicalJson } from "../forensics/canonicalJson";
import type {
  AnalysisManifestV1,
  UnifiedRunPurpose,
  UnifiedRunStatus,
  UnifiedSideEffectPolicy
} from "./contracts";
import {
  acquireConfirmedWalletSnapshot,
  type ConfirmedWalletSnapshotV1,
  type SnapshotSource
} from "./snapshot";
import type { UnifiedQueryable } from "./repository";

export type CheckRequestStatus = "ACCEPTED" | "ATTACHED" | "FAILED_TECHNICAL";

export type CheckRequestRecord = {
  readonly id: string;
  readonly requestCorrelationId: string;
  readonly subjectAddress: string;
  readonly chatId: string;
  readonly messageThreadId: string;
  readonly locale: "ru" | "en";
  readonly runPurpose: UnifiedRunPurpose;
  readonly status: CheckRequestStatus;
  readonly statusReason: string | null;
  readonly runId: string | null;
  readonly readyAt: string;
  readonly attemptCount: number;
  readonly acceptedAt: string;
};

export type AnalysisRunRecord = {
  readonly id: string;
  readonly analysisKeySha256: string;
  readonly subjectAddress: string;
  readonly runPurpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly status: UnifiedRunStatus;
  readonly snapshotHash: string;
  readonly analysisManifestSha256: string;
  readonly analysisManifest: AnalysisManifestV1;
};

export type UnifiedRequestStore = {
  createOrGetAcceptedRequest(input: CheckRequestRecord): Promise<CheckRequestRecord>;
  attachedRun(request: CheckRequestRecord): Promise<AnalysisRunRecord | null>;
  attach(input: {
    requestId: string;
    candidateRun: AnalysisRunRecord;
    reuseAllowed: boolean;
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
  const manifest = artifact.artifact_json as AnalysisManifestV1;
  if (fingerprintCanonicalJson(manifest) !== row.analysis_manifest_sha256) {
    throw new Error("unified_analysis_manifest_hash_mismatch");
  }
  return {
    id: String(row.id),
    analysisKeySha256: String(row.analysis_key_sha256),
    subjectAddress: String(row.subject_address),
    runPurpose: row.run_purpose as UnifiedRunPurpose,
    sideEffectPolicy: row.side_effect_policy as UnifiedSideEffectPolicy,
    status: row.status as UnifiedRunStatus,
    snapshotHash: manifest.snapshotHash,
    analysisManifestSha256: String(row.analysis_manifest_sha256),
    analysisManifest: manifest
  };
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
  db: UnifiedQueryable
): UnifiedRequestStore {
  return {
    async createOrGetAcceptedRequest(input) {
      const inserted = await db.query(
        `insert into unified_check_requests (
          id, request_correlation_id, subject_address, chat_id, message_thread_id,
          locale, run_purpose, status, ready_at, attempt_count, accepted_at
        ) values ($1,$2,$3,$4,$5,$6,$7,'ACCEPTED',$8,0,$8)
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
      await db.query("begin");
      try {
        const request = one(
          await db.query(
            "select * from unified_check_requests where id = $1 for update",
            [input.requestId]
          ),
          "unified_request_missing"
        );
        if (request.status === "ATTACHED") {
          const row = one(
            await db.query("select * from unified_check_runs where id = $1", [request.run_id]),
            "unified_attached_run_missing"
          );
          const run = await runRecord(db, row);
          await db.query("commit");
          return { request: requestRecord(request), run, reused: true };
        }
        if (request.status !== "ACCEPTED") throw new Error("unified_request_not_accepted");

        let runRow = input.reuseAllowed
          ? (
              await db.query(
                `select * from unified_check_runs
                  where analysis_key_sha256 = $1 and status <> 'FAILED_TECHNICAL'
                  order by created_at asc limit 1 for update`,
                [input.candidateRun.analysisKeySha256]
              )
            ).rows[0]
          : undefined;
        let reused = Boolean(runRow);
        if (!runRow) {
          const inserted = await db.query(
            `insert into unified_check_runs (
              id, analysis_key_sha256, subject_address, status, run_purpose,
              side_effect_policy, analysis_manifest_sha256
            ) values ($1,$2,$3,'RUNNING',$4,$5,$6)
            on conflict do nothing returning *`,
            [
              input.candidateRun.id,
              input.candidateRun.analysisKeySha256,
              input.candidateRun.subjectAddress,
              input.candidateRun.runPurpose,
              input.candidateRun.sideEffectPolicy,
              input.candidateRun.analysisManifestSha256
            ]
          );
          runRow = inserted.rows[0];
          if (!runRow) {
            runRow = one(
              await db.query(
                `select * from unified_check_runs
                  where analysis_key_sha256 = $1 and status <> 'FAILED_TECHNICAL'
                  order by created_at asc limit 1`,
                [input.candidateRun.analysisKeySha256]
              ),
              "unified_run_reuse_failed"
            );
            reused = true;
          } else {
            await db.query(
              `insert into unified_check_artifacts (
                sha256, created_by_run_id, kind, schema_version, artifact_json
              ) values ($1,$2,'analysis_manifest','1',$3::jsonb)`,
              [
                input.candidateRun.analysisManifestSha256,
                input.candidateRun.id,
                JSON.stringify(input.candidateRun.analysisManifest)
              ]
            );
          }
        }
        const attached = one(
          await db.query(
            `update unified_check_requests
                set status = 'ATTACHED', run_id = $2
              where id = $1 and status = 'ACCEPTED'
              returning *`,
            [input.requestId, runRow.id]
          ),
          "unified_request_attach_failed"
        );
        const run = await runRecord(db, runRow);
        await db.query("commit");
        return { request: requestRecord(attached), run, reused };
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        throw error;
      }
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
  };
  candidateRunId: string;
  versions: UnifiedAnalysisVersions;
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

function branchInputHash(
  branch: "fast" | "deep" | "where",
  snapshotHash: string,
  versions: UnifiedAnalysisVersions
): string {
  return fingerprintCanonicalJson({
    version: "unified-branch-input-v1",
    branch,
    snapshotHash,
    labelDatasetSha256: versions.labelDatasetSha256,
    runtimeCommit: versions.runtimeCommit,
    schemaVersion: versions.schemaVersion
  });
}

export function buildUnifiedAnalysisIdentity(input: {
  subjectAddress: string;
  snapshot: ConfirmedWalletSnapshotV1;
  snapshotHash: string;
  versions: UnifiedAnalysisVersions;
  reuseScope: "shared" | string;
}): { requestHash: string; analysisKeySha256: string } {
  const sharedMaterial = {
    version: "unified-analysis-key-v1",
    chain: "tron",
    subjectAddress: input.subjectAddress,
    confirmedBlockNumber: input.snapshot.confirmedBlockNumber,
    confirmedBlockHash: input.snapshot.confirmedBlockHash,
    snapshotHash: input.snapshotHash,
    labelDatasetSha256: input.versions.labelDatasetSha256,
    scoringPolicyVersion: input.versions.scoringPolicyVersion,
    attributionPolicyVersion: input.versions.attributionPolicyVersion,
    runtimeCommit: input.versions.runtimeCommit,
    schemaVersion: input.versions.schemaVersion
  };
  const material = { ...sharedMaterial, reuseScope: input.reuseScope };
  return {
    requestHash: fingerprintCanonicalJson(sharedMaterial),
    analysisKeySha256: fingerprintCanonicalJson(material)
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
  if (accepted.status === "FAILED_TECHNICAL") {
    return { kind: "failed_technical", request: accepted };
  }
  if (accepted.status === "ATTACHED") {
    const run = await input.store.attachedRun(accepted);
    if (!run) throw new Error("unified_attached_run_missing");
    return { kind: "attached", request: accepted, run, snapshot: null, reused: true };
  }

  try {
    const { snapshot, sha256: snapshotHash } =
      await acquireConfirmedWalletSnapshot(input.snapshotSource, accepted.subjectAddress);
    const canReuse = accepted.runPurpose !== "release_canary";
    const reuseScope = canReuse ? "shared" : `isolated:${accepted.id}`;
    const identity = buildUnifiedAnalysisIdentity({
      subjectAddress: accepted.subjectAddress,
      snapshot,
      snapshotHash,
      versions: input.versions,
      reuseScope
    });
    const manifest: AnalysisManifestV1 = {
      version: "analysis-manifest-v1",
      schemaVersion: 1,
      runId: input.candidateRunId,
      requestHash: identity.requestHash,
      snapshotHash,
      branchArtifactHashes: {
        fast: branchInputHash("fast", snapshotHash, input.versions),
        deep: branchInputHash("deep", snapshotHash, input.versions),
        where: branchInputHash("where", snapshotHash, input.versions)
      }
    };
    const sideEffectPolicy: UnifiedSideEffectPolicy =
      accepted.runPurpose === "release_canary" ? "isolated" : "authoritative";
    const attached = await input.store.attach({
      requestId: accepted.id,
      reuseAllowed: canReuse,
      candidateRun: {
        id: input.candidateRunId,
        analysisKeySha256: identity.analysisKeySha256,
        subjectAddress: accepted.subjectAddress,
        runPurpose: accepted.runPurpose,
        sideEffectPolicy,
        status: "RUNNING",
        snapshotHash,
        analysisManifestSha256: fingerprintCanonicalJson(manifest),
        analysisManifest: manifest
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
