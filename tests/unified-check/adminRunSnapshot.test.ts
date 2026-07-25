import { describe, expect, it, vi } from "vitest";
import {
  createUnifiedAdminRunDecisionStore,
  projectUnifiedAdminRunSnapshot
} from "../../src/unifiedCheck/adminRunSnapshot";
import {
  loadUnifiedAdminRunSnapshot
} from "../../src/unifiedCheck/repository";

const durable = {
  ownerId: "opaque-owner-7",
  lane: "repair" as const,
  planner: {
    durableBacklog: 7,
    admitted: 5,
    leased: 2,
    ready: 3,
    committed: 11
  },
  canonicalHead: {
    taskId: "task-head",
    state: "WAITING_RETRY",
    ageMs: 12_000
  },
  buffer: {
    readyCount: 3,
    readyBytes: 500,
    reservedBytes: 700
  },
  lastCommitAt: "2026-07-25T00:00:30.000Z",
  createdAt: "2026-07-25T00:00:00.000Z",
  completedChunks: 6
};

describe("Unified Admin run snapshot", () => {
  it("projects bounded durable and current decision state without ETA or sensitive identity", () => {
    const snapshot = projectUnifiedAdminRunSnapshot(durable, {
      runId: "run-7",
      ownerId: "opaque-owner-7",
      lane: "repair",
      fairShare: 2,
      activeSlots: 1,
      lastServedAt: "2026-07-25T00:00:40.000Z",
      lookaheadTarget: 4,
      blocker: {
        scope: "run",
        code: "canonical_head_wait"
      }
    }, new Date("2026-07-25T00:01:00.000Z"));

    expect(snapshot).toEqual({
      ownerId: "opaque-owner-7",
      lane: "repair",
      fairShare: 2,
      activeSlots: 1,
      lastServedAt: "2026-07-25T00:00:40.000Z",
      lookaheadTarget: 4,
      planner: durable.planner,
      canonicalHead: durable.canonicalHead,
      buffer: durable.buffer,
      lastCommitAt: durable.lastCommitAt,
      blocker: {
        scope: "run",
        code: "canonical_head_wait"
      },
      elapsedMs: 60_000,
      completedChunks: 6,
      throughputPerMinute: 6
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /eta|chatId|userId|providerKey|apiKey|walletAddress/iu
    );
  });

  it("returns zero/null volatile fields after restart until a controller decision", () => {
    expect(projectUnifiedAdminRunSnapshot(
      durable,
      null,
      new Date("2026-07-25T00:01:00.000Z")
    )).toMatchObject({
      lane: "repair",
      fairShare: 0,
      activeSlots: 0,
      lastServedAt: null,
      lookaheadTarget: 0,
      blocker: null
    });
  });

  it("replaces and prunes the in-memory decision set instead of accumulating runs", () => {
    const store = createUnifiedAdminRunDecisionStore();
    store.replace([{
      runId: "run-a",
      ownerId: "owner-a",
      lane: "interactive",
      fairShare: 1,
      activeSlots: 1,
      lastServedAt: null,
      lookaheadTarget: 2,
      blocker: null
    }, {
      runId: "run-b",
      ownerId: "owner-b",
      lane: "background",
      fairShare: 0,
      activeSlots: 0,
      lastServedAt: null,
      lookaheadTarget: 0,
      blocker: {
        scope: "run",
        code: "background_preempted"
      }
    }]);
    expect(store.get("run-a")?.activeSlots).toBe(1);

    store.replace([{
      runId: "run-b",
      ownerId: "owner-b",
      lane: "background",
      fairShare: 1,
      activeSlots: 1,
      lastServedAt: null,
      lookaheadTarget: 2,
      blocker: null
    }]);

    expect(store.get("run-a")).toBeNull();
    expect(store.get("run-b")?.activeSlots).toBe(1);
  });

  it("loads and projects one run with one bounded SQL query", async () => {
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      expect(values).toEqual([
        "run-7",
        "2026-07-25T00:01:00.000Z"
      ]);
      expect(sql).toContain("where id = $1");
      expect(sql).toContain("where entry.run_id = $1");
      expect(sql).toContain("order by entry.canonical_sequence");
      expect(sql).toContain("limit 1");
      return {
        rows: [{
          fairness_owner_id: "opaque-owner-7",
          created_at: "2026-07-25T00:00:00.000Z",
          lane: "repair",
          durable_backlog: 7,
          admitted: 5,
          leased: 2,
          ready: 3,
          committed: 11,
          ready_count: 3,
          ready_bytes: 500,
          reserved_bytes: 700,
          head_task_id: "task-head",
          head_state: "WAITING_RETRY",
          head_age_ms: 12_000,
          last_commit_at: "2026-07-25T00:00:30.000Z",
          completed_chunks: 6
        }]
      };
    });
    const store = createUnifiedAdminRunDecisionStore();
    store.replace([{
      runId: "run-7",
      ownerId: "opaque-owner-7",
      lane: "repair",
      fairShare: 2,
      activeSlots: 1,
      lastServedAt: "2026-07-25T00:00:40.000Z",
      lookaheadTarget: 4,
      blocker: null
    }]);

    await expect(loadUnifiedAdminRunSnapshot({ query }, {
      runId: "run-7",
      now: new Date("2026-07-25T00:01:00.000Z"),
      decision: store.get("run-7")
    })).resolves.toMatchObject({
      ownerId: "opaque-owner-7",
      lane: "repair",
      fairShare: 2,
      planner: {
        durableBacklog: 7,
        admitted: 5,
        leased: 2,
        ready: 3,
        committed: 11
      },
      canonicalHead: {
        taskId: "task-head",
        state: "WAITING_RETRY",
        ageMs: 12_000
      },
      throughputPerMinute: 6
    });
    expect(query).toHaveBeenCalledOnce();
  });
});
