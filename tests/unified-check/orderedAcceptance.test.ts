import { describe, expect, it, vi } from "vitest";
import {
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
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
    let transactionActive = false;
    let committed = false;
    const db: UnifiedTransactionalQueryable = {
      query: client.query,
      async transaction(work) {
        transactionActive = true;
        const result = await work(client);
        committed = true;
        transactionActive = false;
        return result;
      }
    };
    const observed: Array<{ committed: boolean; transactionActive: boolean }> =
      [];
    const onAdaptiveEvent = vi.fn(() => {
      observed.push({ committed, transactionActive });
    });

    const replayed = await completeUnifiedTaskAttempt(db, {
      taskId: "task-1",
      leaseToken: "lease-was-cleared",
      attempt: 3,
      attemptId: "fresh-ephemeral-attempt-id",
      artifactSha256,
      onAdaptiveEvent
    });

    expect(replayed).toMatchObject({
      id: "task-1",
      status: "COMPLETED",
      accepted_attempt_id: "attempt-stored"
    });
    expect(onAdaptiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "idempotent_acceptance_replayed"
    }));
    expect(observed).toEqual([{ committed: true, transactionActive: false }]);
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

    const commitFailureEvent = vi.fn();
    const commitFailingDb: UnifiedTransactionalQueryable = {
      query: client.query,
      async transaction(work) {
        await work(client);
        throw new Error("commit_failed");
      }
    };
    await expect(completeUnifiedTaskAttempt(commitFailingDb, {
      taskId: "task-1",
      leaseToken: "lease-was-cleared",
      attempt: 3,
      attemptId: "fresh-ephemeral-attempt-id",
      artifactSha256,
      onAdaptiveEvent: commitFailureEvent
    })).rejects.toThrow("commit_failed");
    expect(commitFailureEvent).not.toHaveBeenCalled();
  });

  it("emits a hard-limit event once after rollback and rethrows the same error", async () => {
    const artifact = { payload: "larger than one byte" };
    const artifactSha256 = fingerprintCanonicalArtifact(artifact);
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
          return {
            rows: [{
              id: "run-1",
              run_purpose: "user_check",
              created_at: "2026-07-25T00:00:00.000Z"
            }]
          };
        }
        if (
          normalized.includes("select task.*") &&
          normalized.includes("for update of task")
        ) {
          return {
            rows: [{
              id: "task-1",
              run_id: "run-1",
              status: "LEASED",
              lease_token: "lease-1",
              attempt: 1,
              cancellation_requested_at: null,
              canary_deadline_reached: false
            }]
          };
        }
        if (normalized.includes("to_regclass")) {
          return {
            rows: [{ planner_table: "unified_check_planner_entries" }]
          };
        }
        if (
          normalized.includes("from unified_check_planner_entries") &&
          normalized.includes("for update")
        ) {
          return {
            rows: [{
              canonical_sequence: 0,
              planner_state: "planned",
              admitted_at: "2026-07-25T00:00:01.000Z",
              reserved_bytes: "100",
              result_bytes: null,
              ready_at: null,
              committed_at: null
            }]
          };
        }
        throw new Error(`unexpected_sql:${normalized}`);
      }
    };
    let rolledBack = false;
    let rolledBackError: unknown;
    const db: UnifiedTransactionalQueryable = {
      query: client.query,
      async transaction(work) {
        try {
          return await work(client);
        } catch (error) {
          rolledBack = true;
          rolledBackError = error;
          throw error;
        }
      }
    };
    const rollbackState: boolean[] = [];
    const onAdaptiveEvent = vi.fn(() => {
      rollbackState.push(rolledBack);
    });

    const rejected = completeUnifiedTaskAttempt(db, {
      taskId: "task-1",
      leaseToken: "lease-1",
      attempt: 1,
      attemptId: "attempt-1",
      artifactSha256,
      acceptedArtifact: {
        kind: "address_history_manifest",
        schemaVersion: "1",
        value: artifact
      },
      manifestMaxBytes: 1,
      onAdaptiveEvent
    });
    const surfacedError = await rejected.catch((error: unknown) => error);
    expect(surfacedError).toBe(rolledBackError);
    expect(surfacedError).toMatchObject({
      message: "unified_ordered_manifest_hard_limit"
    });
    expect(onAdaptiveEvent).toHaveBeenCalledOnce();
    expect(onAdaptiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "manifest_hard_limit_rejected"
    }));
    expect(rollbackState).toEqual([true]);
  });
});
