import { describe, expect, it } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  checkpointUnifiedTask,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

describe("Unified ordered checkpoint commit", () => {
  it("locks run, traversal task and exact ready prefix in one transaction", async () => {
    const priorHead = "a".repeat(64);
    const nextHead = "b".repeat(64);
    const artifact = {
      version: "unified-address-history-manifest-v1",
      schemaVersion: 1,
      key: "manifest-1"
    };
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
          normalized.includes("from unified_check_planner_entries entry") &&
          normalized.includes("for update of entry")
        ) {
          return {
            rows: [{
              head_sequence: 7,
              canonical_sequence: 7,
              planner_state: "ready",
              result_bytes: resultBytes,
              task_id: "history-1",
              accepted_attempt_id: "attempt-history-1",
              artifact_sha256: artifactSha256,
              artifact_json: artifact
            }]
          };
        }
        if (normalized.startsWith("update unified_check_tasks")) {
          return { rows: [{ id: "task-traversal", status: "QUEUED" }] };
        }
        if (
          normalized.startsWith("update unified_check_planner_entries") &&
          normalized.includes("set planner_state = 'committed'")
        ) {
          return { rows: [{ task_id: "history-1" }] };
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

    await expect(checkpointUnifiedTask(db, {
      taskId: "task-traversal",
      leaseToken: "lease-1",
      attempt: 2,
      checkpoint: {
        version: "unified-production-traversal-checkpoint-v2",
        deltaHeadSha256: nextHead
      },
      barrierReservedBytes: 1_048_576,
      orderedCommit: {
        runId: "run-1",
        expectedDeltaHeadSha256: priorHead,
        entries: [{
          canonicalSequence: 7,
          taskId: "history-1",
          acceptedAttemptId: "attempt-history-1",
          resultBytes
        }]
      }
    })).resolves.toMatchObject({ status: "QUEUED" });

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
      sql.startsWith("update unified_check_planner_entries") &&
      sql.includes("set admitted_at") &&
      sql.includes("min(head.canonical_sequence)")
    )).toBe(true);
  });
});
