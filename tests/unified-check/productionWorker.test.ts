import { describe, expect, it, vi } from "vitest";
import {
  createPostgresUnifiedTaskCycleRepository
} from "../../src/unifiedCheck/productionWorker";
import type {
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

describe("Unified production worker adapter", () => {
  it("maps durable snake-case rows and limits claims to the resource kinds", async () => {
    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes("to_regclass('unified_check_planner_entries')")) {
        return { rows: [{ planner_table: "unified_check_planner_entries" }] };
      }
      if (sql.includes("with candidate as")) {
        expect(values[3]).toEqual(["direct_history"]);
        expect(values[7]).toBe("run-1");
        expect(values[8]).toBe("repair");
        expect(sql).toContain("canonical_sequence");
        return {
          rows: [{
            id: "task-1",
            run_id: "run-1",
            kind: "direct_history",
            logical_key: "main",
            priority_lane: "interactive",
            attempt: 2,
            checkpoint_json: { cursor: "50" },
            cancellation_requested_at: null
          }]
        };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });
    const db = {
      query,
      transaction: (work) => work({ query })
    } as UnifiedTransactionalQueryable;
    const repository = createPostgresUnifiedTaskCycleRepository(db, [
      "direct_history"
    ], "candidate", "e".repeat(64));

    await expect(repository.claim({
      workerId: "worker",
      leaseToken: "lease",
      leaseMs: 30_000,
      permit: {
        lane: "repair",
        ownerId: "owner-1",
        runId: "run-1",
        canonicalHeadPreferred: true
      }
    })).resolves.toEqual({
      id: "task-1",
      runId: "run-1",
      kind: "direct_history",
      logicalKey: "main",
      priorityLane: "interactive",
      attempt: 2,
      checkpoint: { cursor: "50" },
      cancellationRequestedAt: null
    });
  });

  it("does not fall back to a global claim when the permitted run has no task", async () => {
    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes("to_regclass('unified_check_planner_entries')")) {
        return { rows: [{ planner_table: "unified_check_planner_entries" }] };
      }
      if (sql.includes("with candidate as")) {
        expect(values[7]).toBe("run-missing");
        expect(values[8]).toBe("interactive");
        return { rows: [] };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });
    const db = {
      query,
      transaction: (work) => work({ query })
    } as UnifiedTransactionalQueryable;
    const repository = createPostgresUnifiedTaskCycleRepository(
      db,
      ["direct_history"],
      "candidate",
      "e".repeat(64)
    );

    await expect(repository.claim({
      workerId: "worker",
      leaseToken: "lease",
      leaseMs: 30_000,
      permit: {
        lane: "interactive",
        ownerId: "owner",
        runId: "run-missing",
        canonicalHeadPreferred: false
      }
    })).resolves.toBeNull();
    expect(query.mock.calls.filter(([sql]) =>
      String(sql).includes("with candidate as")
    )).toHaveLength(1);
  });

  it("does not let a throwing checkpoint observer change durable success", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("update unified_check_tasks")) {
        return {
          rows: [{
            id: "task-1",
            status: "QUEUED",
            checkpoint_json: { cursor: "50" },
            next_head_newly_admitted: false
          }]
        };
      }
      throw new Error(`unexpected_sql:${sql}`);
    });
    const db = {
      query,
      transaction: (work) => work({ query })
    } as UnifiedTransactionalQueryable;
    const repository = createPostgresUnifiedTaskCycleRepository(
      db,
      ["direct_history"],
      "candidate",
      "e".repeat(64),
      undefined,
      {
        onCheckpointLatencyMs() {
          throw new Error("snapshot exporter unavailable");
        }
      }
    );

    await expect(repository.checkpoint({
      taskId: "task-1",
      leaseToken: "lease-1",
      attempt: 1,
      checkpoint: { cursor: "50" }
    })).resolves.toEqual({
      checkpointed: true,
      providerWorkAvailable: false,
      committedTaskStatus: "QUEUED",
      committedCheckpoint: { cursor: "50" },
      orderedCommit: null
    });
  });
});
