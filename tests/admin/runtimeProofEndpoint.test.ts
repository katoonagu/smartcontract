import { afterEach, describe, expect, it } from "vitest";
import { startAdminServer, type RunningAdminServer } from "../../src/admin/adminServer";
import { createRuntimeCycleRecorder } from "../../src/runtime/runtimeLiveProof";
import { buildRuntimeVersion } from "../../src/runtime/runtimeVersion";

const TOKEN = "runtime-proof-token";
const SHA = "a".repeat(40);
const RUNTIME_VERSION = buildRuntimeVersion({
  gitCommitSha: SHA,
  runtimeInstanceLabel: `test-${SHA.slice(0, 8)}`,
  migration: {
    verified: true,
    version: 35,
    filename: "035_unified_check_run_rollout_policy.sql",
    checksumSha256: "e".repeat(64),
    shortChecksum: "e".repeat(12),
    schema032ChecksumSha256: "b".repeat(64),
    schema033ChecksumSha256: "c".repeat(64),
    schema034ChecksumSha256: "d".repeat(64)
  }
});

function deps() {
  return {
    config: { host: "127.0.0.1", port: 0, token: TOKEN },
    listJobs: async () => [],
    getJob: async () => null,
    getRuntimeProof: () => createRuntimeCycleRecorder({
      runtimeVersion: RUNTIME_VERSION,
      logger: { info: () => undefined }
    }).proof(),
    runRuntimeNavigationProbe: async () => ({
      version: "runtime-navigation-probe-v1" as const,
      runtimeSha: SHA,
      cacheOnly: { reads: 2 as const, providerCalls: 0 as const, sources: ["cache", "cache"] as const },
      explicitRefresh: { attempts: 1 as const, providerCalls: 1, completed: true as const },
      telegramTransport: "absent" as const,
      completedAt: "2026-07-19T10:15:00.000Z"
    })
  };
}

describe("runtime proof Admin endpoints", () => {
  const servers: RunningAdminServer[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

  it("requires Admin authorization and returns the exact runtime proof", async () => {
    const server = await startAdminServer(deps());
    servers.push(server);
    expect((await fetch(`${server.url}/admin/api/runtime-proof`)).status).toBe(401);

    const response = await fetch(`${server.url}/admin/api/runtime-proof`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: "runtime-proof-v1",
      runtimeVersion: { gitCommitSha: SHA }
    });
  });

  it("runs a loopback-only bodyless navigation probe without identity fields", async () => {
    const server = await startAdminServer(deps());
    servers.push(server);
    const response = await fetch(`${server.url}/admin/api/runtime-navigation-probe`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      cacheOnly: { providerCalls: 0 },
      explicitRefresh: { providerCalls: 1 },
      telegramTransport: "absent"
    });
    expect(text).not.toMatch(/wallet|address|chat|user|telegram[_-]?id/i);

    const withBody = await fetch(`${server.url}/admin/api/runtime-navigation-probe`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{}"
    });
    expect(withBody.status).toBe(400);
  });
});
