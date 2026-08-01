import { describe, expect, it } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory";
import {
  checkpointUnifiedTask,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import {
  createPostgresUnifiedTaskCycleRepository
} from "../../src/unifiedCheck/productionWorker";

describe("Unified ordered checkpoint commit", () => {
  it("commits, appends parent-ordered discoveries and admits the next head in one transaction", async () => {
    const priorHead = "a".repeat(64);
    const nextHead = "b".repeat(64);
    const artifact = buildAddressHistoryManifest({
      chain: "tron",
      snapshotHash: "b".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      address: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: [],
      canonicalEventIds: [],
      rawRowCount: 0,
      duplicateCount: 0,
      exhaustion: {
        kind: "account_creation_reached",
        evidenceSha256: "c".repeat(64)
      }
    });
    const artifactSha256 = fingerprintCanonicalArtifact(artifact);
    const resultBytes = Buffer.byteLength(canonicalizeArtifactJson(artifact));
    const queries: string[] = [];
    let transactions = 0;
    const client: UnifiedQueryable = {
      async query(sql) {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        queries.push(normalized);
        if (
          normalized ===
          "select run_id from unified_check_tasks where id = $1"
        ) {
          return { rows: [{ run_id: "run-1" }] };
        }
        if (
          normalized.includes("from unified_check_runs") &&
          normalized.includes("for update")
        ) {
          return { rows: [{ id: "run-1" }] };
        }
        if (
          normalized.includes("from unified_check_tasks task") &&
          normalized.includes("for update of task")
        ) {
          return {
            rows: [{
              id: "task-traversal",
              run_id: "run-1",
              kind: "traversal",
              status: "LEASED",
              lease_token: "lease-1",
              attempt: 2,
              cancellation_requested_at: null,
              checkpoint_json: {
                version: "unified-production-traversal-checkpoint-v2",
                deltaHeadSha256: priorHead
              }
            }]
          };
        }
        if (
          normalized.startsWith("with head as") &&
          normalized.includes("for update of entry")
        ) {
          return {
            rows: [{
              head_sequence: 7,
              canonical_sequence: 7,
              planner_state: "ready",
              result_bytes: resultBytes,
              task_id: "history-1",
              task_kind: "address_history",
              task_logical_key: artifact.key,
              task_status: "COMPLETED",
              accepted_attempt_id: "attempt-history-1",
              attempt_id: "attempt-history-1",
              attempt_task_id: "history-1",
              artifact_sha256: artifactSha256,
              artifact_kind: "address_history_manifest",
              artifact_schema_version: "1",
              artifact_json: artifact
            }]
          };
        }
        if (normalized.startsWith("update unified_check_tasks")) {
          return {
            rows: [{
              id: "task-traversal",
              status: "QUEUED",
              checkpoint_json: {
                version: "unified-production-traversal-checkpoint-v2",
                deltaHeadSha256: nextHead
              }
            }]
          };
        }
        if (
          normalized.startsWith("update unified_check_planner_entries") &&
          normalized.includes("set planner_state = 'committed'")
        ) {
          return {
            rows: [{ canonical_sequence: 7, task_id: "history-1" }]
          };
        }
        if (normalized.includes("select max(canonical_sequence)")) {
          return { rows: [{ max_sequence: 7 }] };
        }
        if (
          normalized.includes("insert into unified_check_tasks") &&
          normalized.includes("on conflict")
        ) {
          return {
            rows: [{
              id: "history-child",
              status: "QUEUED",
              accepted_attempt_id: null
            }]
          };
        }
        if (
          normalized.includes("select canonical_sequence") &&
          normalized.includes("from unified_check_planner_entries")
        ) {
          return { rows: [] };
        }
        if (normalized.includes("insert into unified_check_planner_entries")) {
          return { rows: [{ canonical_sequence: 8 }] };
        }
        if (
          normalized.startsWith("select entry.canonical_sequence") &&
          normalized.includes("for update of entry, task")
        ) {
          return {
            rows: [{
              canonical_sequence: 8,
              planner_state: "planned",
              admitted_at: null,
              reserved_bytes: null,
              result_bytes: null,
              task_id: "history-child",
              task_status: "QUEUED",
              accepted_attempt_id: null
            }]
          };
        }
        if (
          normalized.startsWith("update unified_check_planner_entries") &&
          normalized.includes("set admitted_at")
        ) {
          return { rows: [{ task_id: "history-2" }] };
        }
        throw new Error(`unexpected_sql:${normalized}`);
      }
    };
    const db: UnifiedTransactionalQueryable = {
      query: client.query,
      async transaction(work) {
        transactions += 1;
        return work(client);
      }
    };

    const repository = createPostgresUnifiedTaskCycleRepository(
      db,
      ["traversal"],
      "candidate",
      "e".repeat(64),
      undefined,
      {
        manifestMaxBytes: 1_048_576,
        onCheckpointLatencyMs() {
          throw new Error("ordered commit observer unavailable");
        }
      }
    );
    await expect(repository.checkpoint({
      taskId: "task-traversal",
      leaseToken: "lease-1",
      attempt: 2,
      checkpoint: {
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: nextHead
      },
      orderedCommit: {
        runId: "run-1",
        expectedDeltaHeadSha256: priorHead,
        entries: [{
          canonicalSequence: 7,
          taskId: "history-1",
          logicalKey: artifact.key,
          acceptedAttemptId: "attempt-history-1",
          resultBytes,
          taskKind: "address_history",
          artifactKind: "address_history_manifest",
          artifactSchemaVersion: "1"
        }],
        discoveredTasks: [{
          parentCanonicalSequence: 7,
          taskId: "history-child",
          kind: "address_history",
          logicalKey: "manifest-child",
          priorityLane: "interactive",
          checkpoint: {
            version: "unified-address-history-checkpoint-v2"
          }
        }]
      }
    })).resolves.toEqual({
      checkpointed: true,
      providerWorkAvailable: true,
      committedTaskStatus: "QUEUED",
      committedCheckpoint: {
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: nextHead
      },
      orderedCommit: {
        applied: true,
        runId: "run-1",
        committedEntries: [{
          canonicalSequence: 7,
          taskId: "history-1",
          acceptedAttemptId: "attempt-history-1",
          artifactSha256
        }]
      }
    });

    expect(transactions).toBe(1);
    expect(queries.findIndex((sql) =>
      sql.includes("from unified_check_runs") && sql.includes("for update")
    )).toBeLessThan(queries.findIndex((sql) =>
      sql.includes("from unified_check_tasks task") &&
      sql.includes("for update of task")
    ));
    expect(queries.some((sql) =>
      sql.startsWith("update unified_check_planner_entries") &&
      sql.includes("set planner_state = 'committed'")
    )).toBe(true);
    expect(queries.some((sql) =>
      sql.startsWith("insert into unified_check_planner_entries")
    )).toBe(true);
    expect(queries.some((sql) =>
      sql.startsWith("update unified_check_planner_entries") &&
      sql.includes("set admitted_at") &&
      sql.includes("canonical_sequence = $2")
    )).toBe(true);
  });

  it.each([
    {
      name: "another logical identity",
      taskKind: "address_history",
      acceptedAddress: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP"
    },
    {
      name: "a non-address task kind",
      taskKind: "direct_history",
      acceptedAddress: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9"
    }
  ])("rejects an accepted address manifest for $name before checkpoint mutation", async ({
    taskKind,
    acceptedAddress
  }) => {
    const priorHead = "a".repeat(64);
    const identity = (address: string) => ({
      chain: "tron" as const,
      snapshotHash: "b".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      address,
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: [] as string[],
      canonicalEventIds: [] as string[],
      rawRowCount: 0,
      duplicateCount: 0,
      exhaustion: {
        kind: "account_creation_reached" as const,
        evidenceSha256: "c".repeat(64)
      }
    });
    const manifestA = buildAddressHistoryManifest(
      identity("TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9")
    );
    const acceptedManifest = buildAddressHistoryManifest(
      identity(acceptedAddress)
    );
    const artifactSha256 = fingerprintCanonicalArtifact(acceptedManifest);
    const resultBytes = Buffer.byteLength(
      canonicalizeArtifactJson(acceptedManifest)
    );
    let checkpointMutated = false;
    const client: UnifiedQueryable = {
      async query(sql) {
        const normalized = sql.replace(/\s+/gu, " ").trim();
        if (
          normalized ===
          "select run_id from unified_check_tasks where id = $1"
        ) {
          return { rows: [{ run_id: "run-1" }] };
        }
        if (
          normalized.includes("from unified_check_runs") &&
          normalized.includes("for update")
        ) {
          return { rows: [{ id: "run-1" }] };
        }
        if (
          normalized.includes("from unified_check_tasks task") &&
          normalized.includes("for update of task")
        ) {
          return {
            rows: [{
              id: "task-traversal",
              run_id: "run-1",
              kind: "traversal",
              status: "LEASED",
              lease_token: "lease-1",
              attempt: 1,
              cancellation_requested_at: null,
              checkpoint_json: {
                version: "unified-production-traversal-checkpoint-v2",
                deltaHeadSha256: priorHead
              }
            }]
          };
        }
        if (
          normalized.startsWith("with head as") &&
          normalized.includes("for update of entry")
        ) {
          return {
            rows: [{
              head_sequence: 0,
              canonical_sequence: 0,
              planner_state: "ready",
              result_bytes: resultBytes,
              task_id: "history-a",
              task_kind: taskKind,
              task_logical_key: manifestA.key,
              task_status: "COMPLETED",
              accepted_attempt_id: "attempt-history-a",
              attempt_id: "attempt-history-a",
              attempt_task_id: "history-a",
              artifact_sha256: artifactSha256,
              artifact_kind: "address_history_manifest",
              artifact_schema_version: "1",
              artifact_json: acceptedManifest
            }]
          };
        }
        if (normalized.startsWith("update unified_check_tasks")) {
          checkpointMutated = true;
          return { rows: [{ id: "task-traversal", status: "QUEUED" }] };
        }
        if (
          normalized.startsWith("update unified_check_planner_entries") &&
          normalized.includes("set planner_state = 'committed'")
        ) {
          return { rows: [{ task_id: "history-a" }] };
        }
        if (
          normalized.startsWith("select entry.canonical_sequence") &&
          normalized.includes("for update of entry, task")
        ) {
          return { rows: [] };
        }
        throw new Error(`unexpected_sql:${normalized}`);
      }
    };
    const db: UnifiedTransactionalQueryable = {
      query: client.query,
      transaction: (work) => work(client)
    };

    await expect(checkpointUnifiedTask(db, {
      taskId: "task-traversal",
      leaseToken: "lease-1",
      attempt: 1,
      checkpoint: {
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: "d".repeat(64)
      },
      orderedCommit: {
        runId: "run-1",
        expectedDeltaHeadSha256: priorHead,
        entries: [{
          canonicalSequence: 0,
          taskId: "history-a",
          logicalKey: manifestA.key,
          acceptedAttemptId: "attempt-history-a",
          resultBytes,
          taskKind,
          artifactKind: "address_history_manifest",
          artifactSchemaVersion: "1"
        }],
        discoveredTasks: []
      }
    })).rejects.toThrow("unified_ordered_commit_prefix_mismatch");
    expect(checkpointMutated).toBe(false);
  });
});
