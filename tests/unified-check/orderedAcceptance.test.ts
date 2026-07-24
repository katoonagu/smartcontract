import { describe, expect, it } from "vitest";
import {
  completeUnifiedTaskAttempt,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

describe("Unified ordered acceptance lock and replay contract", () => {
  it("locks run before task and returns the stored attempt for a stable replay triple", async () => {
    const artifactSha256 = "a".repeat(64);
    const queries: string[] = [];
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
          normalized.includes("select task.*") &&
          normalized.includes("for update of task")
        ) {
          return {
            rows: [{
              id: "task-1",
              run_id: "run-1",
              status: "COMPLETED",
              attempt: 3,
              accepted_attempt_id: "attempt-stored",
              canary_deadline_reached: false
            }]
          };
        }
        if (normalized.includes("to_regclass")) {
          return { rows: [{ planner_table: "unified_check_planner_entries" }] };
        }
        if (
          normalized.includes("from unified_check_planner_entries") &&
          normalized.includes("for update")
        ) {
          return {
            rows: [{
              planner_state: "ready",
              admitted_at: "2026-07-24T00:00:00.000Z",
              reserved_bytes: null,
              result_bytes: "100",
              ready_at: "2026-07-24T00:01:00.000Z"
            }]
          };
        }
        if (normalized.includes("from unified_check_attempts attempt")) {
          return {
            rows: [{
              id: "attempt-stored",
              task_id: "task-1",
              attempt: 3,
              artifact_sha256: artifactSha256,
              artifact_kind: "address_history_manifest",
              artifact_schema_version: "1",
              artifact_json: { version: "manifest-v1" }
            }]
          };
        }
        throw new Error(`unexpected_sql:${normalized}`);
      }
    };
    const db: UnifiedTransactionalQueryable = {
      query: client.query,
      transaction: (work) => work(client)
    };

    const replayed = await completeUnifiedTaskAttempt(db, {
      taskId: "task-1",
      leaseToken: "lease-was-cleared",
      attempt: 3,
      attemptId: "fresh-ephemeral-attempt-id",
      artifactSha256
    });

    expect(replayed).toMatchObject({
      id: "task-1",
      status: "COMPLETED",
      accepted_attempt_id: "attempt-stored"
    });
    const runLock = queries.findIndex((sql) =>
      sql.includes("from unified_check_runs") &&
      sql.includes("for update")
    );
    const taskLock = queries.findIndex((sql) =>
      sql.includes("select task.*") &&
      sql.includes("for update of task")
    );
    const plannerLock = queries.findIndex((sql) =>
      sql.includes("from unified_check_planner_entries") &&
      sql.includes("for update")
    );
    expect(runLock).toBeGreaterThanOrEqual(0);
    expect(taskLock).toBeGreaterThan(runLock);
    expect(plannerLock).toBeGreaterThan(taskLock);
  });
});
