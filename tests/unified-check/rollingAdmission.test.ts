import { describe, expect, it, vi } from "vitest";
import {
  refillOrderedAdmissions
} from "../../src/unifiedCheck/plannerRepository";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

const NOW = new Date("2026-07-25T00:00:00.000Z");

function transactionHost(
  rows: (sql: string, values: readonly unknown[]) =>
    Array<Record<string, unknown>>
): UnifiedTransactionalQueryable {
  const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => ({
    rows: rows(sql, values)
  }));
  return {
    query,
    async transaction<T>(
      work: (client: UnifiedQueryable) => Promise<T>
    ): Promise<T> {
      return work({ query });
    }
  };
}

function plannedRow(sequence: number, taskId = `task-${sequence}`) {
  return {
    canonical_sequence: String(sequence),
    planner_state: "planned",
    task_id: taskId,
    admitted_at: null,
    reserved_bytes: null,
    result_bytes: null,
    task_status: "QUEUED",
    task_lease_active: false,
    task_claim_eligible: true,
    task_ready_at: new Date("2026-07-24T00:00:00.000Z"),
    accepted_attempt_id: null
  };
}

function admittedRow(
  sequence: number,
  taskId = `task-${sequence}`,
  taskStatus = "QUEUED",
  taskLeaseActive = taskStatus === "LEASED"
) {
  return {
    ...plannedRow(sequence, taskId),
    admitted_at: new Date("2026-07-24T00:00:00.000Z"),
    reserved_bytes: "1000",
    task_status: taskStatus,
    task_lease_active: taskLeaseActive
  };
}

function admissionInput(policy: "barrier" | "rolling" = "rolling") {
  return {
    runId: "run-1",
    policy,
    lookaheadTarget: 4,
    readyBufferMaxEntries: 10,
    readyBufferMaxBytes: 10_000,
    reservedBufferMaxBytes: 4_000,
    reservationBytesPerTask: 1_000,
    now: NOW
  } as const;
}

describe("Unified durable rolling admission", () => {
  it("locks the run before admitting and reserving one planner entry", async () => {
    const queries: string[] = [];
    const head = plannedRow(0);
    const db = transactionHost((sql) => {
      queries.push(sql);
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [head];
      if (sql.includes("entry.admitted_at is not null")) return [];
      if (sql.includes("entry.admitted_at is null")) return [head];
      if (sql.includes("set admitted_at = greatest(statement_timestamp(), planned_at)")) {
        return [{ task_id: "task-0" }];
      }
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, admissionInput())).resolves
      .toEqual({
        admittedTaskIds: ["task-0"],
        deAdmittedTaskIds: [],
        blocker: null
      });
    expect(queries[0]?.replaceAll(/\s+/gu, " ").trim()).toBe(
      "select id from unified_check_runs where id = $1 for update"
    );
  });

  it("admits only the canonical head through a full soft ready buffer", async () => {
    const head = plannedRow(0, "head");
    const tail = plannedRow(3, "tail");
    const db = transactionHost((sql) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "2", ready_bytes: "2000" }];
      }
      if (sql.includes("as canonical_head")) return [head];
      if (sql.includes("entry.admitted_at is not null")) return [];
      if (sql.includes("entry.admitted_at is null")) return [head, tail];
      if (sql.includes("set admitted_at = greatest(statement_timestamp(), planned_at)")) {
        return [{ task_id: "head" }];
      }
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, {
      ...admissionInput(),
      readyBufferMaxEntries: 1,
      readyBufferMaxBytes: 1_000
    })).resolves.toEqual({
      admittedTaskIds: ["head"],
      deAdmittedTaskIds: [],
      blocker: "merge_buffer_full"
    });
  });

  it("keeps barrier admission head-only even when its lookahead input is larger", async () => {
    const candidates = [plannedRow(0), plannedRow(1), plannedRow(2)];
    const admitted: string[] = [];
    const db = transactionHost((sql, values) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [candidates[0]!];
      if (sql.includes("entry.admitted_at is not null")) return [];
      if (sql.includes("entry.admitted_at is null")) return candidates;
      if (sql.includes("set admitted_at = greatest(statement_timestamp(), planned_at)")) {
        admitted.push(String(values[1]));
        return [{ task_id: String(values[1]) }];
      }
      throw new Error(`unexpected_sql:${sql}`);
    });

    const result = await refillOrderedAdmissions(
      db,
      admissionInput("barrier")
    );

    expect(result.admittedTaskIds).toEqual(["task-0"]);
    expect(admitted).toEqual(["task-0"]);
  });

  it("de-admits an expired lease but preserves an active leased tail", async () => {
    const head = admittedRow(0, "head");
    const unleasedTail = admittedRow(1, "tail-unleased");
    const activeLeasedTail = admittedRow(2, "tail-active-lease", "LEASED");
    const expiredLeasedTail = admittedRow(
      3,
      "tail-expired-lease",
      "LEASED",
      false
    );
    const db = transactionHost((sql) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [head];
      if (sql.includes("set admitted_at = null")) {
        return [{ task_id: "tail-unleased" }];
      }
      if (sql.includes("entry.admitted_at is not null")) {
        return [
          head,
          unleasedTail,
          activeLeasedTail,
          expiredLeasedTail
        ];
      }
      if (sql.includes("entry.admitted_at is null")) return [];
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, {
      ...admissionInput(),
      lookaheadTarget: 1
    })).resolves.toEqual({
      admittedTaskIds: [],
      deAdmittedTaskIds: ["tail-expired-lease", "tail-unleased"],
      blocker: null
    });
  });

  it("fails closed when a head reservation cannot fit", async () => {
    const head = plannedRow(0, "head");
    const db = transactionHost((sql) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [head];
      if (sql.includes("entry.admitted_at is not null")) return [];
      if (sql.includes("entry.admitted_at is null")) return [head];
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, {
      ...admissionInput(),
      reservedBufferMaxBytes: 999
    })).resolves.toEqual({
      admittedTaskIds: [],
      deAdmittedTaskIds: [],
      blocker: "reservation_full"
    });
  });

  it("replaces an admitted ineligible head with later ready work", async () => {
    const delayedHead = {
      ...admittedRow(0, "delayed-head", "WAITING_RETRY"),
      task_claim_eligible: false,
      task_ready_at: new Date("2026-07-26T00:00:00.000Z")
    };
    const readyTail = plannedRow(1, "ready-tail");
    const db = transactionHost((sql, values) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [delayedHead];
      if (sql.includes("set admitted_at = null")) {
        return [{ task_id: "delayed-head" }];
      }
      if (sql.includes("entry.admitted_at is not null")) {
        return [delayedHead];
      }
      if (sql.includes("entry.admitted_at is null")) return [readyTail];
      if (sql.includes("set admitted_at = greatest(statement_timestamp(), planned_at)")) {
        return [{ task_id: String(values[1]) }];
      }
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, {
      ...admissionInput(),
      lookaheadTarget: 1
    })).resolves.toEqual({
      admittedTaskIds: ["ready-tail"],
      deAdmittedTaskIds: ["delayed-head"],
      blocker: null
    });
  });

  it("reports no blocker while eligible admitted work can progress", async () => {
    const admittedHead = admittedRow(0, "admitted-head");
    const db = transactionHost((sql) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [admittedHead];
      if (sql.includes("entry.admitted_at is not null")) {
        return [admittedHead];
      }
      if (sql.includes("entry.admitted_at is null")) return [];
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, {
      ...admissionInput(),
      lookaheadTarget: 1
    })).resolves.toEqual({
      admittedTaskIds: [],
      deAdmittedTaskIds: [],
      blocker: null
    });
  });

  it("reports no ready work when barrier cannot pass an ineligible head", async () => {
    const delayedHead = {
      ...plannedRow(0, "delayed-head"),
      task_status: "WAITING_RETRY",
      task_claim_eligible: false,
      task_ready_at: new Date("2026-07-26T00:00:00.000Z")
    };
    const readyTail = plannedRow(1, "ready-tail");
    const db = transactionHost((sql) => {
      if (sql.includes("from unified_check_runs")) return [{ id: "run-1" }];
      if (sql.includes("ready_count")) {
        return [{ ready_count: "0", ready_bytes: "0" }];
      }
      if (sql.includes("as canonical_head")) return [delayedHead];
      if (sql.includes("entry.admitted_at is not null")) return [];
      if (sql.includes("entry.admitted_at is null")) return [readyTail];
      throw new Error(`unexpected_sql:${sql}`);
    });

    await expect(refillOrderedAdmissions(db, {
      ...admissionInput("barrier"),
      lookaheadTarget: 1
    })).resolves.toEqual({
      admittedTaskIds: [],
      deAdmittedTaskIds: [],
      blocker: "canonical_head_wait"
    });
  });
});
