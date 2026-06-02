import { afterEach, describe, expect, it } from "vitest";
import { startAdminServer, type AdminServerDeps } from "../../src/admin/adminServer";
import type { ForensicCheckJob } from "../../src/storage/repositories";

const servers: Array<{ close(): Promise<void> }> = [];

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "where_is_money_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-01T01:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: null,
    progressJson: {},
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      decision: "ACCEPTABLE",
      riskScore: 20,
      coverage: {},
      assessment: {},
      originPaths: []
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T01:00:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:01.000Z"),
    completedAt: new Date("2026-06-01T01:00:00.000Z"),
    ...overrides
  };
}

function deps(): AdminServerDeps {
  const fixture = job();
  return {
    config: {
      host: "127.0.0.1",
      port: 0,
      token: "secret-token"
    },
    listJobs: async () => [fixture],
    getJob: async (id: string) => id === fixture.id ? fixture : null
  };
}

async function start(dependencies: AdminServerDeps = deps()) {
  const server = await startAdminServer(dependencies);
  servers.push(server);
  return server;
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("startAdminServer", () => {
  it("rejects admin console shell requests without bearer token", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/forensics`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("serves admin console shell for authorized admins", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/forensics`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("Admin Forensics Console");
  });

  it("rejects forensic job list requests without bearer token", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("lists forensic jobs for authorized admins", async () => {
    let receivedInput: unknown = null;
    const fixture = job();
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(
      `${server.url}/admin/api/forensic-jobs?limit=10&offset=5&status=completed&kind=where_is_money_check&subjectAddress=TSubject111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobs: [expect.objectContaining({ id: "job-1" })] });
    expect(receivedInput).toEqual({
      limit: 10,
      offset: 5,
      status: "completed",
      kind: "where_is_money_check",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
  });

  it("returns 400 for invalid forensic job status filter", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?status=bad`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job status filter."
    });
  });

  it("returns 400 for invalid forensic job kind filter", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?kind=bad`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job kind filter."
    });
  });

  it("returns 400 for non-numeric forensic job limit", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=abc`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job limit."
    });
  });

  it("returns 400 for negative forensic job limit", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=-1`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job limit."
    });
  });

  it("returns 400 for fractional forensic job offset", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?offset=1.5`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job offset."
    });
  });

  it("returns projected graph for a completed job", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        job: { id: "job-1", status: "completed" },
        subject: { address: "TSubject111111111111111111111111111111" },
        summary: { decision: "ACCEPTABLE", riskScore: 20 }
      }
    });
  });

  it("returns 404 for unknown job", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/missing/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forensic job not found."
    });
  });

  it("returns 400 for malformed forensic job id encoding", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/%zz/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job id."
    });
  });
});
