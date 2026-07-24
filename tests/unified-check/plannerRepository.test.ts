import { describe, expect, it } from "vitest";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  loadUnifiedBoundedReadyPrefix,
  loadUnifiedCommittedArtifacts,
  loadUnifiedDurableOrderedLogicalKeys,
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
      accepted_attempt_id: `attempt-${canonicalSequence}`,
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
        Number(rows[0]!.result_bytes) + Number(rows[1]!.result_bytes)
    })).resolves.toEqual(rows.slice(0, 2).map((row, index) => ({
      canonicalSequence: index,
      taskId: row.task_id,
      acceptedAttemptId: row.accepted_attempt_id,
      artifactSha256: row.artifact_sha256,
      artifactKind: row.artifact_kind,
      artifactSchemaVersion: row.artifact_schema_version,
      artifact: row.artifact_json,
      resultBytes: row.result_bytes
    })));
  });

  it("loads only requested logical keys that already have durable planner rows", async () => {
    const db: UnifiedQueryable = {
      async query(sql, values) {
        expect(sql).toContain("join unified_check_planner_entries");
        expect(sql).toContain("task.logical_key = any");
        expect(values).toEqual(["run-1", ["manifest-a", "manifest-b"]]);
        return { rows: [{ logical_key: "manifest-b" }] };
      }
    };

    await expect(loadUnifiedDurableOrderedLogicalKeys(db, {
      runId: "run-1",
      logicalKeys: ["manifest-b", "manifest-a", "manifest-b"]
    })).resolves.toEqual(new Set(["manifest-b"]));
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
        expect(sql).toContain("task.logical_key = any");
        expect(values).toEqual(["run-1", ["manifest-a"]]);
        return {
          rows: [{
            canonical_sequence: 3,
            result_bytes: bytes,
            task_id: "task-a",
            accepted_attempt_id: "attempt-a",
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
      logicalKeys: ["manifest-a"]
    })).resolves.toMatchObject([{
      canonicalSequence: 3,
      taskId: "task-a",
      acceptedAttemptId: "attempt-a",
      artifact: { key: "manifest-a" },
      resultBytes: bytes
    }]);
  });
});
