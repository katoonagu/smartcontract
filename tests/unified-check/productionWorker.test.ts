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
      leaseMs: 30_000
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
});
