import { describe, expect, it } from "vitest";
import {
  planUnifiedOrderedTasks
} from "../../src/unifiedCheck/plannerRepository";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

function leasedTaskClient(input: {
  existingPlannerSequence?: number;
}): {
  client: UnifiedQueryable;
  plannerInsertCount(): number;
} {
  let plannerInserts = 0;
  const client: UnifiedQueryable = {
    async query(sql) {
      const normalized = sql.replace(/\s+/gu, " ").trim();
      if (
        normalized.includes("from unified_check_runs") &&
        normalized.includes("for update")
      ) {
        return { rows: [{ id: "run-1" }] };
      }
      if (normalized.includes("select max(canonical_sequence)")) {
        return { rows: [{ max_sequence: null }] };
      }
      if (
        normalized.includes("insert into unified_check_tasks") &&
        normalized.includes("on conflict")
      ) {
        return { rows: [] };
      }
      if (
        normalized.includes("select id, status, accepted_attempt_id") &&
        normalized.includes("from unified_check_tasks")
      ) {
        return {
          rows: [{
            id: "task-1",
            status: "LEASED",
            accepted_attempt_id: null
          }]
        };
      }
      if (
        normalized.includes("select canonical_sequence") &&
        normalized.includes("from unified_check_planner_entries")
      ) {
        return {
          rows: input.existingPlannerSequence === undefined
            ? []
            : [{ canonical_sequence: input.existingPlannerSequence }]
        };
      }
      if (normalized.includes("insert into unified_check_planner_entries")) {
        plannerInserts += 1;
        return { rows: [{ canonical_sequence: 0 }] };
      }
      throw new Error(`unexpected_sql:${normalized}`);
    }
  };
  return { client, plannerInsertCount: () => plannerInserts };
}

function transactionHost(client: UnifiedQueryable): UnifiedTransactionalQueryable {
  return {
    query: client.query,
    transaction: (work) => work(client)
  };
}

const task = {
  taskId: "task-1",
  kind: "address_history",
  logicalKey: "manifest-1",
  priorityLane: "interactive" as const,
  checkpoint: { version: "planner-status-test-v1" }
};

describe("Unified ordered planner attachment", () => {
  it("rejects a leased existing task that has no planner row", async () => {
    const fake = leasedTaskClient({});

    await expect(planUnifiedOrderedTasks(transactionHost(fake.client), {
      runId: "run-1",
      tasks: [task]
    })).rejects.toThrow("unified_planner_task_not_plannable");
    expect(fake.plannerInsertCount()).toBe(0);
  });

  it("returns an existing planner row after its task becomes leased", async () => {
    const fake = leasedTaskClient({ existingPlannerSequence: 4 });

    await expect(planUnifiedOrderedTasks(transactionHost(fake.client), {
      runId: "run-1",
      tasks: [task]
    })).resolves.toEqual([{
      taskId: "task-1",
      canonicalSequence: 4
    }]);
    expect(fake.plannerInsertCount()).toBe(0);
  });
});
