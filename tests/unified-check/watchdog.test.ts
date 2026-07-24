import { describe, expect, it } from "vitest";
import {
  inspectUnifiedRuns,
  type UnifiedWatchdogRunV1
} from "../../src/unifiedCheck/watchdog";
import {
  applyUnifiedRecoveryAction,
  claimUnifiedTask,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";

function run(
  overrides: Partial<UnifiedWatchdogRunV1> = {}
): UnifiedWatchdogRunV1 {
  return {
    id: "run-1",
    subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
    status: "RUNNING",
    statusReason: null,
    runPurpose: "user_check",
    sideEffectPolicy: "authoritative",
    createdAt: "2026-07-23T17:00:00.000Z",
    updatedAt: "2026-07-23T17:01:00.000Z",
    completedAt: null,
    canaryDeadlineAt: null,
    finalScore: null,
    finalDecision: null,
    hashes: {
      snapshot: "1".repeat(64),
      analysisManifest: "2".repeat(64),
      evidence: null,
      closure: null,
      scoring: null,
      report: null
    },
    versions: {
      scoringPolicy: "scoring-signal-matrix-v4",
      attributionPolicy: "selected-attribution-policy-v1",
      traversalPolicy: "snapshot-closure-v1",
      runtimeCommit: "candidate",
      databaseSchema: 33
    },
    traversal: {
      closed: null,
      visitedCount: null,
      frontierCount: null
    },
    generation: {
      analysis: "unified",
      deliveryAuthority: "shadow",
      fenceId: null,
      activatedAt: null
    },
    tasks: [{
      id: "task-fast",
      kind: "fast",
      status: "LEASED",
      priorityLane: "interactive",
      readyAt: "2026-07-23T17:00:00.000Z",
      leaseExpiresAt: "2026-07-23T17:10:00.000Z",
      heartbeatAt: "2026-07-23T17:01:30.000Z",
      cancellationRequestedAt: null,
      lastError: null,
      providerState: "ready",
      checkpoint: { page: 2 },
      attempts: [{
        id: "attempt-1",
        attempt: 1,
        artifactSha256: null,
        completedAt: null
      }],
      attemptDurations: [],
      durationsMs: {
        queue: 10,
        provider: 20,
        compute: 30
      }
    }],
    deliveries: [],
    ...overrides
  };
}

describe("Unified watchdog", () => {
  it("classifies health without mutating run input and hides score before COMPLETED", () => {
    const source = run({
      finalScore: 99,
      finalDecision: "DECLINE"
    });
    const before = structuredClone(source);
    const findings = inspectUnifiedRuns([source], {
      now: new Date("2026-07-23T17:02:00.000Z"),
      staleHeartbeatMs: 120_000
    });
    expect(findings[0]).toMatchObject({
      finding: "healthy",
      finalScore: null,
      finalDecision: null,
      score: null,
      decision: null
    });
    expect(source).toEqual(before);
  });

  it.each([
    {
      expected: "waiting_provider",
      value: run({ status: "WAITING_FOR_PROVIDER" })
    },
    {
      expected: "stale_lease_reclaimable",
      value: run({
        tasks: [{
          ...run().tasks[0]!,
          leaseExpiresAt: "2026-07-23T17:01:00.000Z"
        }]
      })
    },
    {
      expected: "blocked_source_unavailable",
      value: run({
        tasks: [{
          ...run().tasks[0]!,
          status: "WAITING_RETRY",
          leaseExpiresAt: null,
          heartbeatAt: null,
          providerState: "unavailable"
        }]
      })
    },
    {
      expected: "blocked_admin_review",
      value: run({
        status: "BLOCKED_ADMIN",
        statusReason: "manual evidence review"
      })
    },
    {
      expected: "delivery_unknown",
      value: run({
        status: "COMPLETED",
        finalScore: 45,
        finalDecision: "REVIEW",
        deliveries: [{
          id: "delivery-1",
          status: "DELIVERY_UNKNOWN",
          presentationSha256: "3".repeat(64),
          attemptCount: 1,
          lastError: "transport_reset",
          telegramMessageId: null
        }]
      })
    },
    {
      expected: "canary_deadline_reached",
      value: run({
        runPurpose: "release_canary",
        sideEffectPolicy: "isolated",
        canaryDeadlineAt: "2026-07-23T17:01:00.000Z"
      })
    }
  ])("emits $expected from durable state", ({ expected, value }) => {
    expect(inspectUnifiedRuns([value], {
      now: new Date("2026-07-23T17:02:00.000Z"),
      staleHeartbeatMs: 120_000
    })[0]?.finding).toBe(expected);
  });

  it("shows score and immutable hashes only for a completed run", () => {
    const completed = run({
      status: "COMPLETED",
      completedAt: "2026-07-23T17:02:00.000Z",
      finalScore: 22,
      finalDecision: "ACCEPTABLE",
      hashes: {
        snapshot: "1".repeat(64),
        analysisManifest: "2".repeat(64),
        evidence: "3".repeat(64),
        closure: "4".repeat(64),
        scoring: "5".repeat(64),
        report: "6".repeat(64)
      },
      tasks: []
    });
    expect(inspectUnifiedRuns([completed], {
      now: new Date("2026-07-23T17:03:00.000Z"),
      staleHeartbeatMs: 120_000
    })[0]).toMatchObject({
      finding: "healthy",
      score: 22,
      decision: "ACCEPTABLE",
      hashes: completed.hashes,
      versions: completed.versions,
      traversal: completed.traversal,
      generation: completed.generation
    });
  });

  it("terminal technical recovery cancels children and leaves no claimable work", async () => {
    const state = {
      runStatus: "RUNNING",
      taskStatus: "LEASED",
      leaseToken: "lease-1"
    };
    const client: UnifiedQueryable = {
      async query(sql, values = []) {
        if (sql.includes("set status = 'FAILED_TECHNICAL'")) {
          if (!["RUNNING", "WAITING_FOR_PROVIDER", "BLOCKED_ADMIN", "FINALIZING"]
            .includes(state.runStatus)) return { rows: [] };
          state.runStatus = "FAILED_TECHNICAL";
          return { rows: [{ id: values[0], status: state.runStatus }] };
        }
        if (sql.includes("set status = 'CANCELLED'")) {
          state.taskStatus = "CANCELLED";
          state.leaseToken = "";
          return { rows: [] };
        }
        if (sql.includes("insert into unified_check_artifacts")) {
          return {
            rows: [{
              created_by_run_id: values[1],
              kind: values[2],
              schema_version: values[3],
              artifact_json: JSON.parse(String(values[4]))
            }]
          };
        }
        if (sql.includes("to_regclass('unified_check_planner_entries')")) {
          return { rows: [{ planner_table: null }] };
        }
        if (sql.includes("with candidate as")) {
          expect(sql).toContain("join unified_check_runs run");
          expect(sql).toContain("run.status = 'RUNNING'");
          return state.runStatus === "RUNNING" && state.taskStatus === "QUEUED"
            ? { rows: [{ id: "task-fast" }] }
            : { rows: [] };
        }
        throw new Error(`unexpected_query:${sql}`);
      }
    };
    const db: UnifiedTransactionalQueryable = {
      ...client,
      transaction: (work) => work(client)
    };
    await expect(applyUnifiedRecoveryAction(db, {
      runId: "run-1",
      action: "fail-technical",
      actorId: "admin-1",
      reason: "provider permanently unavailable",
      targetId: null
    })).resolves.toEqual({ ok: true, code: "fail-technical" });
    expect(state).toEqual({
      runStatus: "FAILED_TECHNICAL",
      taskStatus: "CANCELLED",
      leaseToken: ""
    });
    await expect(claimUnifiedTask(client, {
      workerId: "worker-1",
      leaseToken: "lease-2",
      leaseMs: 30_000
    })).resolves.toBeNull();
  });
});
