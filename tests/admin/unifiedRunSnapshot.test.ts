import { afterEach, describe, expect, it } from "vitest";
import {
  startAdminServer,
  type RunningAdminServer
} from "../../src/admin/adminServer";
import type {
  UnifiedAdminRunSnapshot
} from "../../src/unifiedCheck/adminRunSnapshot";
import type {
  UnifiedWatchdogRunV1
} from "../../src/unifiedCheck/watchdog";

const servers: RunningAdminServer[] = [];

const snapshot: UnifiedAdminRunSnapshot = {
  ownerId: "opaque-owner",
  lane: "interactive",
  fairShare: 2,
  activeSlots: 1,
  lastServedAt: "2026-07-25T00:00:40.000Z",
  lookaheadTarget: 4,
  planner: {
    durableBacklog: 7,
    admitted: 5,
    leased: 1,
    ready: 3,
    committed: 11
  },
  canonicalHead: {
    taskId: "task-head",
    state: "LEASED",
    ageMs: 12_000
  },
  buffer: {
    readyCount: 3,
    readyBytes: 500,
    reservedBytes: 700
  },
  lastCommitAt: "2026-07-25T00:00:30.000Z",
  blocker: null,
  elapsedMs: 60_000,
  completedChunks: 6,
  throughputPerMinute: 6
};

function run(): UnifiedWatchdogRunV1 {
  return {
    id: "run-1",
    subjectAddress: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
    status: "RUNNING",
    statusReason: null,
    runPurpose: "admin_diagnostic",
    sideEffectPolicy: "isolated",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:30.000Z",
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
      scoringPolicy: "v4",
      attributionPolicy: "v1",
      traversalPolicy: "v1",
      runtimeCommit: "candidate",
      databaseSchema: 34
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
    tasks: [],
    deliveries: []
  };
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

describe("authorized Unified run snapshot", () => {
  it("serves the latest low-cardinality aggregate on an authenticated collection route", async () => {
    const aggregate = {
      version: "unified-adaptive-aggregate-v1" as const,
      provider: {
        capacityLimit: 2,
        readyDemand: 3,
        targetActiveSlots: 2,
        actualActiveSlots: 1,
        healthyGroups: 1,
        cooldownGroups: 0,
        circuitOpenGroups: 0,
        rolling60sRequests: 4,
        rolling60sRps: 4 / 60,
        requestsTotal: 4,
        errorsTotal: 1,
        rateLimited429Total: 1
      },
      runtime: { state: "normal" as const, limitingReason: null },
      memory: { rssBytes: 1, heapUsedBytes: 1, availableMemoryBytes: 1 },
      database: { poolWaiting: 0, latencyMs: 1 },
      checkpointLatencyMs: 1,
      planner: {
        durableBacklog: 2,
        admitted: 1,
        leased: 1,
        ready: 0,
        committed: 3
      },
      buffer: { readyCount: 0, readyBytes: 0, reservedBytes: 10 },
      canonicalHeadAgeMs: 100,
      repair: { minimumSlots: 0, actualSlots: 0, waitViolations: 0 },
      reconciliation: { actionableTicks: 0 }
    };
    const server = await startAdminServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        token: "secret-token"
      },
      listJobs: async () => [],
      getJob: async () => null,
      getUnifiedAdaptiveSnapshot: () => aggregate
    });
    servers.push(server);

    const unauthorized = await fetch(
      `${server.url}/admin/api/unified-checks/adaptive-snapshot`
    );
    expect(unauthorized.status).toBe(401);
    const response = await fetch(
      `${server.url}/admin/api/unified-checks/adaptive-snapshot`,
      { headers: { authorization: "Bearer secret-token" } }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot: aggregate });
  });

  it("serves only the bounded snapshot from the existing Unified route convention", async () => {
    const server = await startAdminServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        token: "secret-token"
      },
      listJobs: async () => [],
      getJob: async () => null,
      getUnifiedRunSnapshot: async (runId) =>
        runId === "run-1" ? snapshot : null
    });
    servers.push(server);

    expect((await fetch(
      `${server.url}/admin/api/unified-checks/run-1/snapshot`
    )).status).toBe(401);
    const response = await fetch(
      `${server.url}/admin/api/unified-checks/run-1/snapshot`,
      { headers: { authorization: "Bearer secret-token" } }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.snapshot).toEqual(snapshot);
    expect(JSON.stringify(body.snapshot)).not.toMatch(
      /eta|chatId|userId|providerKey|apiKey|walletAddress/iu
    );
  });

  it("returns 404 from the one-run snapshot lookup", async () => {
    const server = await startAdminServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        token: "secret-token"
      },
      listJobs: async () => [],
      getJob: async () => null,
      getUnifiedRunSnapshot: async () => null
    });
    servers.push(server);

    const response = await fetch(
      `${server.url}/admin/api/unified-checks/missing/snapshot`,
      { headers: { authorization: "Bearer secret-token" } }
    );
    expect(response.status).toBe(404);
  });
});
