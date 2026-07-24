import { describe, expect, it } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  admitBarrierHeadInTransaction,
  canonicalOrderedDiscoveries,
  loadUnifiedBoundedReadyPrefix,
  loadUnifiedCommittedArtifacts,
  loadUnifiedDurableOrderedTaskIdentities,
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

describe("Unified ordered planner reads", () => {
  it("keeps earlier-parent discoveries ahead of later-parent hash order", () => {
    const common = {
      kind: "address_history",
      priorityLane: "interactive" as const,
      checkpoint: { version: "unified-address-history-checkpoint-v2" }
    };

    expect(canonicalOrderedDiscoveries([
      {
        ...common,
        parentCanonicalSequence: 4,
        taskId: "child-from-earlier-parent",
        logicalKey: "z-reversed-hash"
      },
      {
        ...common,
        parentCanonicalSequence: 5,
        taskId: "child-from-later-parent",
        logicalKey: "a-reversed-hash"
      }
    ]).map((task) => task.taskId)).toEqual([
      "child-from-earlier-parent",
      "child-from-later-parent"
    ]);
  });

  it("lets the earliest canonical parent own a duplicate discovery", () => {
    const common = {
      kind: "address_history",
      logicalKey: "shared-child",
      priorityLane: "interactive" as const,
      checkpoint: { version: "unified-address-history-checkpoint-v2" }
    };

    expect(canonicalOrderedDiscoveries([
      {
        ...common,
        parentCanonicalSequence: 9,
        taskId: "later-parent-task-id"
      },
      {
        ...common,
        parentCanonicalSequence: 3,
        taskId: "earlier-parent-task-id"
      }
    ])).toMatchObject([{
      parentCanonicalSequence: 3,
      taskId: "earlier-parent-task-id"
    }]);
  });

  it("loads only a byte-bounded continuous ready prefix from the canonical head", async () => {
    const manifests = [0, 1, 2].map((index) => ({
      version: "unified-address-history-manifest-v1",
      schemaVersion: 1,
      key: `manifest-${index}`,
      note: `result-${index}`
    }));
    const rows = manifests.map((artifact, canonicalSequence) => ({
      canonical_sequence: canonicalSequence,
      planner_state: canonicalSequence === 2 ? "planned" : "ready",
      result_bytes: Buffer.byteLength(canonicalizeArtifactJson(artifact)),
      task_id: `task-${canonicalSequence}`,
      task_kind: "address_history",
      task_logical_key: `manifest-${canonicalSequence}`,
      task_status: "COMPLETED",
      accepted_attempt_id: `attempt-${canonicalSequence}`,
      attempt_id: `attempt-${canonicalSequence}`,
      attempt_task_id: `task-${canonicalSequence}`,
      artifact_sha256: fingerprintCanonicalArtifact(artifact),
      artifact_kind: "address_history_manifest",
      artifact_schema_version: "1",
      artifact_json: artifact
    }));
    const db: UnifiedQueryable = {
      async query(sql, values) {
        expect(sql).toContain("min(canonical_sequence)");
        expect(sql).toContain("task.accepted_attempt_id");
        expect(sql).toContain("attempt.artifact_sha256");
        expect(sql).toContain("order by entry.canonical_sequence");
        expect(values).toEqual(["run-1", 3]);
        return { rows };
      }
    };

    await expect(loadUnifiedBoundedReadyPrefix(db, {
      runId: "run-1",
      maxEntries: 3,
      maxBytes:
        Number(rows[0]!.result_bytes) + Number(rows[1]!.result_bytes),
      expectedTaskKind: "address_history",
      expectedArtifactKind: "address_history_manifest",
      expectedArtifactSchemaVersion: "1"
    })).resolves.toEqual(rows.slice(0, 2).map((row, index) => ({
      canonicalSequence: index,
      taskId: row.task_id,
      taskKind: row.task_kind,
      logicalKey: row.task_logical_key,
      acceptedAttemptId: row.accepted_attempt_id,
      artifactSha256: row.artifact_sha256,
      artifactKind: row.artifact_kind,
      artifactSchemaVersion: row.artifact_schema_version,
      artifact: row.artifact_json,
      resultBytes: row.result_bytes
    })));
  });

  it("binds durable existence to the complete task identity", async () => {
    const db: UnifiedQueryable = {
      async query(sql, values) {
        expect(sql).toContain("join unified_check_planner_entries");
        expect(sql).toContain("task.kind = requested.kind");
        expect(sql).toContain("task.logical_key = requested.logical_key");
        expect(values).toEqual([
          "run-1",
          ["address_history", "address_history", "other_kind"],
          ["manifest-a", "manifest-b", "manifest-b"]
        ]);
        return {
          rows: [{
            kind: "address_history",
            logical_key: "manifest-b"
          }]
        };
      }
    };

    await expect(loadUnifiedDurableOrderedTaskIdentities(db, {
      runId: "run-1",
      identities: [
        { kind: "address_history", logicalKey: "manifest-b" },
        { kind: "other_kind", logicalKey: "manifest-b" },
        { kind: "address_history", logicalKey: "manifest-a" }
      ]
    })).resolves.toEqual(new Set([
      JSON.stringify(["address_history", "manifest-b"])
    ]));
  });

  it("loads only requested committed artifacts for deterministic history reuse", async () => {
    const artifact = {
      version: "unified-address-history-manifest-v1",
      schemaVersion: 1,
      key: "manifest-a"
    };
    const bytes = Buffer.byteLength(canonicalizeArtifactJson(artifact));
    const db: UnifiedQueryable = {
      async query(sql, values) {
        expect(sql).toContain("entry.planner_state = 'committed'");
        expect(sql).toContain("task.kind = requested.kind");
        expect(sql).toContain("attempt.task_id = task.id");
        expect(sql).toContain("task.status");
        expect(values).toEqual([
          "run-1",
          ["address_history"],
          ["manifest-a"]
        ]);
        return {
          rows: [{
            canonical_sequence: 3,
            result_bytes: bytes,
            task_id: "task-a",
            task_kind: "address_history",
            task_logical_key: "manifest-a",
            task_status: "COMPLETED",
            accepted_attempt_id: "attempt-a",
            attempt_id: "attempt-a",
            attempt_task_id: "task-a",
            artifact_sha256: fingerprintCanonicalArtifact(artifact),
            artifact_kind: "address_history_manifest",
            artifact_schema_version: "1",
            artifact_json: artifact
          }]
        };
      }
    };

    await expect(loadUnifiedCommittedArtifacts(db, {
      runId: "run-1",
      identities: [{
        kind: "address_history",
        logicalKey: "manifest-a"
      }],
      expectedArtifactKind: "address_history_manifest",
      expectedArtifactSchemaVersion: "1"
    })).resolves.toMatchObject([{
      canonicalSequence: 3,
      taskId: "task-a",
      acceptedAttemptId: "attempt-a",
      artifact: { key: "manifest-a" },
      resultBytes: bytes
    }]);
  });

  it("fails closed when the accepted attempt belongs to another task", async () => {
    const artifact = {
      version: "unified-address-history-manifest-v1",
      schemaVersion: 1,
      key: "manifest-a"
    };
    const db: UnifiedQueryable = {
      async query() {
        return {
          rows: [{
            canonical_sequence: 0,
            planner_state: "ready",
            result_bytes:
              Buffer.byteLength(canonicalizeArtifactJson(artifact)),
            task_id: "task-a",
            task_kind: "address_history",
            task_logical_key: "manifest-a",
            task_status: "COMPLETED",
            accepted_attempt_id: "attempt-b",
            attempt_id: "attempt-b",
            attempt_task_id: "task-b",
            artifact_sha256: fingerprintCanonicalArtifact(artifact),
            artifact_kind: "address_history_manifest",
            artifact_schema_version: "1",
            artifact_json: artifact
          }]
        };
      }
    };

    await expect(loadUnifiedBoundedReadyPrefix(db, {
      runId: "run-1",
      maxEntries: 1,
      maxBytes: 1_048_576,
      expectedTaskKind: "address_history",
      expectedArtifactKind: "address_history_manifest",
      expectedArtifactSchemaVersion: "1"
    })).rejects.toThrow("unified_planner_ready_identity_mismatch");
  });
});

describe("Unified ordered head admission", () => {
  it("treats a valid ready head with a released reservation as already actionable", async () => {
    let mutated = false;
    const db: UnifiedQueryable = {
      async query(sql) {
        if (sql.includes("for update of entry, task")) {
          return {
            rows: [{
              canonical_sequence: 1,
              planner_state: "ready",
              admitted_at: new Date("2026-07-25T00:00:00.000Z"),
              reserved_bytes: null,
              result_bytes: 128,
              ready_at: new Date("2026-07-25T00:01:00.000Z"),
              committed_at: null,
              task_id: "task-1",
              task_status: "COMPLETED",
              accepted_attempt_id: "attempt-1",
              verified_attempt_id: "attempt-1",
              verified_attempt_task_id: "task-1"
            }]
          };
        }
        mutated = true;
        return { rows: [] };
      }
    };

    await expect(admitBarrierHeadInTransaction(db, {
      runId: "run-1",
      reservedBytes: 1_048_576
    })).resolves.toEqual({ newlyAdmitted: false });
    expect(mutated).toBe(false);
  });

  it("rejects a ready head that retains a provider reservation", async () => {
    const db: UnifiedQueryable = {
      async query() {
        return {
          rows: [{
            canonical_sequence: 1,
            planner_state: "ready",
            admitted_at: new Date("2026-07-25T00:00:00.000Z"),
            reserved_bytes: 1_048_576,
            result_bytes: 128,
            ready_at: new Date("2026-07-25T00:01:00.000Z"),
            committed_at: null,
            task_id: "task-1",
            task_status: "COMPLETED",
            accepted_attempt_id: "attempt-1",
            verified_attempt_id: "attempt-1",
            verified_attempt_task_id: "task-1"
          }]
        };
      }
    };

    await expect(admitBarrierHeadInTransaction(db, {
      runId: "run-1",
      reservedBytes: 1_048_576
    })).rejects.toThrow("unified_ordered_next_head_not_admissible");
  });

  it("rejects an invalid next-task lifecycle before admission", async () => {
    let mutated = false;
    const db: UnifiedQueryable = {
      async query(sql) {
        if (sql.includes("for update of entry, task")) {
          return {
            rows: [{
              canonical_sequence: 1,
              planner_state: "planned",
              admitted_at: null,
              reserved_bytes: null,
              result_bytes: null,
              task_id: "task-1",
              task_status: "COMPLETED",
              accepted_attempt_id: null
            }]
          };
        }
        mutated = true;
        return { rows: [] };
      }
    };

    await expect(admitBarrierHeadInTransaction(db, {
      runId: "run-1",
      reservedBytes: 1_048_576
    })).rejects.toThrow("unified_ordered_next_head_not_admissible");
    expect(mutated).toBe(false);
  });
});
