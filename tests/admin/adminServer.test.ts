import { afterEach, describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";
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
    getJob: async (id: string) => id === fixture.id ? fixture : null,
    createStrictProvenanceBenchmarkJob: async () => fixture
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
  it("redirects root to the forensics console", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/forensics");
  });

  it("redirects admin root to the forensics console", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/forensics");
  });

  it("serves admin console shell without exposing job data", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/forensics`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Admin Forensics Console");
    expect(html).toContain("data-admin-console");
    expect(html).toContain("data-graph-first-shell");
    expect(html).toContain("Case brief");
    expect(html).toContain("Jobs");
    expect(html).toContain("Activity timeline");
    expect(html).toContain("Transfers");
    expect(html).toContain("function renderCaseBrief");
    expect(html).toContain("function renderActivityTimeline");
    expect(html).toContain("/admin/api/forensic-jobs");
    expect(html).toContain("Find address, tx, or job id");
    expect(html).toContain("function scheduleLoadJobs");
    expect(html).toContain("function applyInitialUrlFilters");
    expect(html).toContain("Wallet Intelligence");
    expect(html).toContain("data-wallet-intelligence-workspace");
    expect(html).toContain("/admin/api/wallet-intelligence/addresses");
    expect(html).toContain("function loadWalletIntelligenceAddresses");
    expect(html).toContain("function renderWalletIntelligenceTable");
    expect(html).toContain("function renderWalletIntelligenceDrawer");
    expect(html).toContain("Unique subjects");
    expect(html).toContain("Distinct amount");
    expect(html).toContain("This is analyst context, not scoring evidence.");
    expect(html).toContain("pendingOpenJobId");
    expect(html).toContain('el("subject").addEventListener("input"');
    expect(html).toContain('event.key !== "Enter"');
    expect(html).toContain('<option value="cancelled">cancelled</option>');
    expect(html).toContain('<option value="address_fast_check">Fast check</option>');
    expect(html).toContain("Clear selection");
    expect(html).toContain("function nodeIntelligenceBlock");
    expect(html).toContain("Node role");
    expect(html).toContain("Behavior marker");
    expect(html).toContain("This is a behavior marker, not final risk proof by itself.");
    expect(html).toContain("All transfers");
    expect(html).toContain("Selected evidence");
    expect(html).toContain("Boundary stops");
    expect(html).toContain("data-transfer-tabs");
    expect(html).toContain("Tx labels:");
    expect(html).toContain("Anchor coverage");
    expect(html).toContain("Drain episode");
    expect(html).toContain("Used for checked amount");
    expect(html).toContain("Original transfer amount");
    expect(html).toContain("Target coverage amount");
    expect(html).toContain("Used share of target");
    expect(html).toContain("Used share of transfer");
    expect(html).toContain("Only this portion of the larger transfer was counted toward the checked amount");
    expect(html).toContain("Behavioral/service exposure context");
    expect(html).toContain("Money-origin provenance step");
    expect(html).toContain("This is not money-origin proof");
    expect(html).toContain("Top incoming");
    expect(html).toContain("Top outgoing");
    expect(html).toContain("Top services");
    expect(html).toContain("fastCheckTopMetrics");
    expect(html).toContain("Canvas edge labels show original transfer amounts; allocation is explained in transfer rows and transfer details.");
    expect(html).not.toContain("Allocated amount");
    expect(html).not.toContain("Original tx amount");
    expect(html).not.toContain("Coverage amount");
    expect(html).not.toContain("edge labels and edge details");
    expect(html).toContain("tx gap");
    expect(html).toContain("Risk score");
    expect(html).toContain("https://tronscan.org/#/address/");
    expect(html).toContain("https://tronscan.org/#/transaction/");
    expect(html).toContain("Projection mode");
    expect(html).toContain("Projection gaps");
    expect(html).toContain("Funding bundle");
    expect(html).toContain("Top funders");
    expect(html).toContain("function nodeDisplayKind");
    expect(html).toContain("function nodeDisplayLabel");
    expect(html).toContain("function traceStopDetailBlock");
    expect(html).toContain("Path uncertainty penalty");
    expect(html).toContain("This is not wallet risk");
    expect(html).toContain("Stop amount");
    expect(html).toContain("Required history cutoff");
    expect(html).toContain("Oldest fetched transfer");
    expect(html).toContain("Reached required time");
    expect(html).toContain("Bridge / service");
    expect(html).toContain("Smart contract");
    expect(html).toContain("function edgeTime");
    expect(html).toContain("function edgeCanvasTimeLabel");
    expect(html).toContain('if (value === null || value === undefined || value === "") return "";');
    expect(html).toContain('if (gap) return "gap " + gap;');
    expect(html).toContain("Path timing");
    expect(html).toContain("Slowest hop");
    expect(html).toContain('typeof value === "number" && Number.isFinite(value) && value >= 0');
    expect(html).toContain("function edgePathId");
    expect(html).toContain("function edgeShouldShowAmount");
    expect(html).toContain("function boundaryStopContribution");
    const transferEdgesStart = html.indexOf("const transferEdges = () =>");
    const transferEdgesEnd = html.indexOf("const tronscanAddressUrl", transferEdgesStart);
    const transferEdgesHelper = html.slice(transferEdgesStart, transferEdgesEnd);
    expect(transferEdgesHelper).toContain('edge?.type !== "stop"');
    expect(transferEdgesHelper).toContain('edgeDisplayRole(edge) !== "stop"');
    const nodeColorStart = html.indexOf("function nodeColor(node)");
    const nodeColorEnd = html.indexOf("function nodeRadius(node)", nodeColorStart);
    const nodeColorHelper = html.slice(nodeColorStart, nodeColorEnd);
    const stopColorIndex = nodeColorHelper.indexOf('kind === "trace_stop"');
    const highRiskColorIndex = nodeColorHelper.indexOf('node.riskLevel === "HIGH"');
    expect(nodeColorHelper).toContain('node.kind === "stop"');
    expect(stopColorIndex).toBeGreaterThan(-1);
    expect(stopColorIndex).toBeLessThan(highRiskColorIndex);
    const stopBadgeReasonStart = html.indexOf("function stopBadgeReason(node)");
    const stopBadgeReasonEnd = html.indexOf("function stopBadgeLabel(reason)", stopBadgeReasonStart);
    const stopBadgeReasonHelper = html.slice(stopBadgeReasonStart, stopBadgeReasonEnd);
    expect(stopBadgeReasonHelper).toContain("node.metadata?.reason");
    expect(stopBadgeReasonHelper.indexOf("node.metadata?.reason")).toBeLessThan(stopBadgeReasonHelper.indexOf("node.metadata?.lastStopReason"));
    expect(html).toContain("Uncertainty +");
    expect(html).toContain("History checked");
    expect(html).toContain("Last real hop");
    expect(html).toContain("svg { width: 100%; height: 100%; display: block; cursor: grab; }");
    expect(html).toContain("radial-gradient");
    expect(html).not.toContain("floating-inspector");
    expect(html).not.toContain("TSubject111111111111111111111111111111");
  });

  it("serves wallet intelligence console shell", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/wallet-intelligence`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("data-wallet-intelligence-workspace");
    expect(html).toContain("Wallet Intelligence");
  });

  it("keeps node role marks inline in the graph renderer", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("Role marks on");
    expect(html).toContain("node-role");
    expect(html).toContain("nodeRoleMarkSvg");
    expect(html).toContain("/admin/assets/node-role/drainer.png");
    expect(html).not.toContain("/admin/assets/node-intelligence");
  });

  it("serves node role icon assets", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/assets/node-role/drainer.png`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("rejects forensic job list requests without bearer token", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("lists wallet intelligence summaries for authorized admins", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async (input) => {
        receivedInput = input;
        return [{
          address: "TSeen1111111111111111111111111111111",
          uniqueSubjectCount: 2,
          uniqueRequesterCount: 2,
          jobCount: 3,
          completedJobCount: 2,
          partialJobCount: 1,
          occurrenceCount: 4,
          distinctTxCount: 2,
          distinctAmountRaw: "3000000",
          minDepth: 1,
          maxDepth: 2,
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
          modes: ["address_deep_check"],
          tags: ["repeated_cross_run_address"],
          serviceCategories: ["cex"],
          labelHints: ["Binance"]
        }];
      },
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses?limit=20&offset=5&mode=address_deep_check&tag=repeated_cross_run_address&minUniqueSubjects=2&minUniqueRequesters=2&requester=client_user`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      addresses: [{
        address: "TSeen1111111111111111111111111111111",
        uniqueSubjectCount: 2,
        uniqueRequesterCount: 2,
        distinctAmountRaw: "3000000"
      }]
    });
    expect(receivedInput).toMatchObject({
      limit: 20,
      offset: 5,
      mode: "address_deep_check",
      tag: "repeated_cross_run_address",
      minUniqueSubjects: 2,
      minUniqueRequesters: 2,
      requesterQuery: "client_user"
    });
  });

  it("returns wallet intelligence address detail", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async (address) => ({
        summary: {
          address,
          uniqueSubjectCount: 1,
          uniqueRequesterCount: 1,
          jobCount: 1,
          completedJobCount: 1,
          partialJobCount: 0,
          occurrenceCount: 1,
          distinctTxCount: 1,
          distinctAmountRaw: "1000000",
          minDepth: 1,
          maxDepth: 1,
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          modes: ["address_deep_check"],
          tags: ["repeated_cross_run_address"],
          serviceCategories: [],
          labelHints: []
        },
        requesters: [{ requestedBy: "42", telegramUserId: "42", username: "client_user", locale: "ru", chatId: "42", messageId: "77", jobCount: 1 }],
        jobs: [{ jobId: "job-1", jobKind: "address_deep_check", jobStatus: "completed", subjectAddress: "TSubject111111111111111111111111111111", completedAt: new Date("2026-07-06T10:00:00.000Z") }],
        sightings: [],
        edges: []
      })
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses/TSeen1111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      detail: {
        summary: { address: "TSeen1111111111111111111111111111111" },
        requesters: [{ username: "client_user" }]
      }
    });
  });

  it("rejects wallet intelligence requests without bearer token", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/wallet-intelligence/addresses`);

    expect(response.status).toBe(401);
  });

  it("returns 404 for missing wallet intelligence address detail", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses/TMissing1111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(404);
  });

  it("rejects invalid wallet intelligence filters", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses?mode=address_fast_check`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(400);
  });

  it("returns 501 when wallet intelligence list dependency is not configured", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/wallet-intelligence/addresses`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(501);
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
    await expect(response.json()).resolves.toEqual({
      jobs: [{
        id: "job-1",
        kind: "where_is_money_check",
        subjectAddress: "TSubject111111111111111111111111111111",
        status: "completed",
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-01T01:00:00.000Z",
        priority: 100,
        lastError: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T01:00:00.000Z",
        startedAt: "2026-06-01T00:00:01.000Z",
        completedAt: "2026-06-01T01:00:00.000Z",
        decision: "ACCEPTABLE",
        riskScore: 20,
        riskLevel: "LOW"
      }]
    });
    expect(receivedInput).toEqual({
      limit: 10,
      offset: 5,
      status: "completed",
      kind: "where_is_money_check",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
  });

  it("summarizes fast-check risk fields for Jobs queue cards", async () => {
    const fixture = job({
      kind: "address_fast_check",
      status: "partial",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        fastRiskReport: {
          score: 80,
          level: "HIGH"
        }
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 75,
          level: "HIGH"
        }
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [fixture]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=1`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{
        kind: "address_fast_check",
        status: "partial",
        riskScore: 80,
        riskLevel: "HIGH"
      }]
    });
  });

  it("summarizes mode-specific risk before fast-check fallback for Jobs queue cards", async () => {
    const fast = job({
      id: "job-fast",
      kind: "address_fast_check",
      status: "partial",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        fastRiskReport: {
          score: 60,
          level: "HIGH"
        }
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 60,
          level: "HIGH"
        }
      }
    });
    const deep = job({
      id: "job-deep",
      kind: "address_deep_check",
      status: "completed",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        operationalFlowProfiles: [{
          operationalScore: 55
        }]
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 60,
          level: "HIGH"
        }
      }
    });
    const where = job({
      id: "job-where",
      kind: "where_is_money_check",
      status: "completed",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: {
          decision: "DECLINE",
          riskScore: 78,
          technicalStatus: "completed"
        }
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 60,
          level: "HIGH"
        }
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [fast, deep, where]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=3`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: Array<{ id: string; riskScore?: number; riskLevel?: string; decision?: string }> };
    const summaries = new Map(body.jobs.map((item) => [item.id, item]));
    expect(summaries.get("job-fast")).toMatchObject({ riskScore: 60, riskLevel: "HIGH" });
    expect(summaries.get("job-deep")).toMatchObject({ riskScore: 55, riskLevel: "MEDIUM" });
    expect(summaries.get("job-where")).toMatchObject({ riskScore: 78, riskLevel: "HIGH", decision: "DECLINE" });
  });

  it("creates strict provenance benchmark jobs for authorized admins", async () => {
    let receivedInput: unknown = null;
    const created = job({
      id: "strict-job-1",
      kind: "where_is_money_check",
      subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d",
      status: "queued",
      progressJson: { strictProvenanceBenchmark: true }
    });
    const server = await start({
      ...deps(),
      createStrictProvenanceBenchmarkJob: async (input) => {
        receivedInput = input;
        return created;
      }
    });

    const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
      })
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "strict-job-1",
        kind: "where_is_money_check",
        status: "queued",
        subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
      }
    });
    expect(receivedInput).toMatchObject({
      subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
    });
  });

  it("rejects strict benchmark creation without auth", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d" })
    });

    expect(response.status).toBe(401);
  });

  it("rejects invalid strict benchmark addresses", async () => {
    const server = await start({
      ...deps(),
      createStrictProvenanceBenchmarkJob: async () => {
        throw new Error("should not create invalid jobs");
      }
    });

    const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ subjectAddress: "bad" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid TRON subject address."
    });
  });

  it("passes broad forensic job search queries to the job repository", async () => {
    let receivedInput: unknown = null;
    const fixture = job({
      kind: "incoming_deposit_check",
      progressJson: {
        depositTxHash: "b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        sender: "TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3"
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(
      `${server.url}/admin/api/forensic-jobs?query=b4603c390&kind=incoming_deposit_check`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{
        id: "job-1",
        kind: "incoming_deposit_check",
        depositTxHash: "b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        sender: "TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3"
      }]
    });
    expect(receivedInput).toMatchObject({
      kind: "incoming_deposit_check",
      query: "b4603c390"
    });
  });

  it("returns scoring audit report for authorized admins", async () => {
    let receivedInput: unknown = null;
    const fixture = job({
      resultJson: {
        decision: "ACCEPTABLE",
        riskScore: 20,
        coverage: {
          partial: true,
          fetchedAddressCount: 1,
          notes: ["service boundary reached"]
        }
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(`${server.url}/admin/api/scoring-audit?limit=10`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      report: {
        totalJobs: 1,
        rows: [{
          jobId: "job-1",
          kind: "where_is_money_check"
        }],
        shadowComparisons: [{
          candidatePolicyVersion: "scoring-signal-matrix-v1"
        }]
      }
    });
    expect(receivedInput).toMatchObject({ limit: 10 });
  });

  it("rejects scoring audit requests without bearer token", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/scoring-audit`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("returns 400 for invalid scoring audit filters", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/scoring-audit?limit=abc`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job limit."
    });
  });

  it("does not include raw forensic payloads in job list responses", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: Array<Record<string, unknown>> };
    expect(body.jobs[0]).not.toHaveProperty("chatId");
    expect(body.jobs[0]).not.toHaveProperty("messageId");
    expect(body.jobs[0]).not.toHaveProperty("requestedBy");
    expect(body.jobs[0]).not.toHaveProperty("progressJson");
    expect(body.jobs[0]).not.toHaveProperty("resultJson");
    expect(body.jobs[0]).not.toHaveProperty("rawEvidenceIds");
    expect(body.jobs[0]).not.toHaveProperty("observationIds");
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

  it("accepts address_fast_check forensic job kind filters", async () => {
    let receivedInput: unknown = null;
    const fixture = job({ kind: "address_fast_check" });
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?kind=address_fast_check`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{ kind: "address_fast_check" }]
    });
    expect(receivedInput).toMatchObject({
      kind: "address_fast_check"
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

  it("requires admin auth before refreshing DeepCheck second layer", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async () => {
        called = true;
        return { status: "refreshed", expanded: 1, queued: 0, notIndexed: 0 };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST"
    });

    expect(response.status).toBe(401);
    expect(called).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("refreshes a completed DeepCheck second layer through the configured dependency", async () => {
    let receivedJobId = "";
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async (jobId: string) => {
        receivedJobId = jobId;
        return { status: "refreshed", expanded: 2, queued: 1, notIndexed: 0 };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(receivedJobId).toBe("job-1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { status: "refreshed", expanded: 2, queued: 1, notIndexed: 0 }
    });
  });

  it("returns a clear error when DeepCheck second-layer refresh is not configured", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      error: "DeepCheck second-layer refresh is not configured."
    });
  });

  it("returns 400 for malformed DeepCheck second-layer refresh job ids", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async () => {
        called = true;
        return { status: "refreshed", expanded: 1, queued: 0, notIndexed: 0 };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/%zz/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    expect(called).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job id."
    });
  });

  it("returns handler failures from DeepCheck second-layer refresh", async () => {
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async () => {
        throw new Error("refresh failed");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "refresh failed"
    });
  });

  it("returns targeted indexing progress graph for a waiting Where job", async () => {
    const waitingAddress = "TWaitingHop111111111111111111111111111";
    const fixture = job({
      status: "queued",
      progressJson: {
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: {
          phase: "waiting_for_targeted_index",
          scoreValid: false,
          waitingFor: {
            address: waitingAddress,
            targetTimestamp: "2026-07-01T12:59:30.000Z",
            queuedReason: "where_is_money_hop",
            requiredFor: "where_hop"
          },
          lastIndexStatus: "running",
          pagesFetched: 400,
          transfersFetched: 8051,
          budgetPages: 800,
          attemptCount: 11,
          maxAttempts: 12,
          retryCount: 11,
          providerCapHit: true,
          budgetExhausted: true,
          requestCount: 400,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 0
        },
        targetedHistory: {
          totalTargetedStates: 3,
          queuedCount: 2,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0
        }
      },
      resultJson: {}
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        job: { id: "job-1", status: "queued" },
        summary: {
          decision: "UNKNOWN",
          riskScore: null,
          layerSummary: {
            targetedIndex: {
              phase: "waiting_for_targeted_index",
              waitingForAddress: waitingAddress,
              pagesFetched: 400,
              transfersFetched: 8051
            },
            targetedHistory: {
              totalTargetedStates: 3,
              queuedCount: 2,
              runningCount: 1
            }
          }
        },
        limitations: [expect.objectContaining({
          code: "waiting_for_targeted_index",
          severity: "info"
        })]
      }
    });
  });

  it("hydrates waiting Where graph with targeted history progress from admin read model", async () => {
    let requestedJobId: string | null = null;
    const waitingAddress = "TWaitingHop111111111111111111111111111";
    const fixture = job({
      status: "queued",
      progressJson: {
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: {
          phase: "waiting_for_targeted_index",
          waitingFor: {
            address: waitingAddress,
            targetTimestamp: "2026-07-01T12:59:30.000Z"
          },
          pagesFetched: 400,
          transfersFetched: 8051
        }
      },
      resultJson: {}
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      getTargetedHistoryProgressForJob: async (jobId) => {
        requestedJobId = jobId;
        return {
          totalTargetedStates: 3,
          queuedCount: 2,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0,
          fetchedPageCount: 1200,
          fetchedTransferCount: 24240
        };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(requestedJobId).toBe("job-1");
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        summary: {
          layerSummary: {
            targetedHistory: {
              totalTargetedStates: 3,
              queuedCount: 2,
              runningCount: 1,
              fetchedPageCount: 1200,
              fetchedTransferCount: 24240
            }
          }
        }
      }
    });
  });

  it("hydrates candidate-window progress for a waiting Where graph", async () => {
    let requestedJobId: string | null = null;
    const fixture = job({
      status: "queued",
      progressJson: {
        jobPhase: "checking_candidate_windows",
        targetedIndex: {
          phase: "checking_candidate_windows",
          candidateWindows: { total: 2, queued: 1, running: 1, complete: 0, terminal: 0, pending: 2 },
          broadFallback: "not_queued"
        }
      },
      resultJson: {}
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      getTargetedHistoryProgressForJob: async (jobId) => {
        requestedJobId = jobId;
        return {
          totalTargetedStates: 2,
          queuedCount: 1,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0,
          candidateWindows: {
            total: 2,
            queued: 1,
            running: 1,
            complete: 0,
            terminal: 0,
            pending: 2
          },
          states: [{
            address: "THop111111111111111111111111111111",
            status: "running",
            waitStatus: "waiting",
            requestKind: "candidate_window",
            windowStartTimestamp: "2026-07-04T11:55:00.000Z",
            windowEndTimestamp: "2026-07-04T12:00:00.000Z",
            targetTimestamp: "2026-07-04T12:00:00.000Z",
            candidateTxHash: "candidate-tx-1"
          }]
        };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(requestedJobId).toBe("job-1");
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        summary: {
          layerSummary: {
            targetedIndex: {
              phase: "checking_candidate_windows",
              candidateWindows: {
                total: 2,
                queued: 1,
                running: 1,
                complete: 0,
                terminal: 0,
                pending: 2
              },
              broadFallback: "not_queued"
            },
            targetedHistory: {
              candidateWindows: {
                total: 2,
                queued: 1,
                running: 1
              },
              states: [expect.objectContaining({
                requestKind: "candidate_window",
                candidateTxHash: "candidate-tx-1"
              })]
            }
          },
          topReasons: [expect.stringContaining("candidate windows")]
        },
        limitations: [expect.objectContaining({
          code: "checking_candidate_windows",
          severity: "info"
        })]
      }
    });
  });

  it("enriches neighbor nodes with saved wallet risk without duplicating subject risk", async () => {
    const subject = "TSubject111111111111111111111111111111";
    const neighbor = "TNeighborRisk11111111111111111111111";
    const fixture = job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 45,
        coverage: {},
        assessment: {},
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: neighbor,
          direction: "inbound",
          txCount: 1,
          volumeRaw: "10000000",
          txHashes: ["tx-neighbor"]
        }]
      }
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      findLatestSavedWalletRiskByAddresses: async (addresses: string[]) => {
        expect(addresses).toContain(neighbor);
        return new Map([[
          neighbor,
          {
            address: neighbor,
            jobId: "saved-risk-job",
            kind: "where_is_money_check",
            risk: 95,
            decision: "DECLINE",
            role: "drainer",
            evidence: "exact approval-drain",
            createdAt: "2026-06-28T00:00:00.000Z"
          }
        ], [
          subject,
          {
            address: subject,
            jobId: "subject-risk-job",
            kind: "address_deep_check",
            risk: 95,
            decision: "DECLINE",
            role: "collector",
            evidence: "subject duplicate",
            createdAt: "2026-06-28T00:00:00.000Z"
          }
        ]]);
      }
    } as AdminServerDeps);

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { graph: { nodes: Array<{ address: string | null; kind: string; metadata?: Record<string, unknown> }> } };
    const neighborNode = body.graph.nodes.find((node) => node.address === neighbor);
    const subjectNode = body.graph.nodes.find((node) => node.kind === "subject");
    expect(neighborNode?.metadata?.savedWalletRisk).toMatchObject({
      risk: 95,
      role: "drainer",
      evidence: expect.stringContaining("approval-drain"),
      kind: "where_is_money_check"
    });
    expect(subjectNode?.metadata?.savedWalletRisk).toBeUndefined();
  });

  it("enriches old deep-check counterparty tx hashes with indexed transfer rows", async () => {
    const fixture = job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        decision: "REVIEW",
        riskScore: 40,
        coverage: {},
        assessment: {},
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: "TCounterparty1111111111111111111111111",
          direction: "outbound",
          txCount: 2,
          volumeRaw: "12000000",
          txHashes: ["tx-a", "tx-b"]
        }]
      }
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      listIndexedUsdtTransfersByHashes: async (txHashes) => {
        expect(txHashes).toEqual(["tx-a", "tx-b"]);
        return [{
          txHash: "tx-a",
          blockNumber: 1,
          blockTimestamp: new Date("2026-06-25T09:49:03.000Z"),
          eventIndex: 0,
          fromAddress: "TSubject111111111111111111111111111111",
          toAddress: "TCounterparty1111111111111111111111111",
          amountRaw: "5000000",
          method: "transfer",
          callerAddress: null,
          contractRet: "SUCCESS",
          confirmed: true
        }, {
          txHash: "tx-b",
          blockNumber: 2,
          blockTimestamp: new Date("2026-06-25T09:50:03.000Z"),
          eventIndex: 0,
          fromAddress: "TSubject111111111111111111111111111111",
          toAddress: "TCounterparty1111111111111111111111111",
          amountRaw: "7000000",
          method: "transfer",
          callerAddress: null,
          contractRet: "SUCCESS",
          confirmed: true
        }];
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { graph: { edges: Array<Record<string, unknown>> } };
    expect(body.graph.edges).toEqual([expect.objectContaining({
      id: "edge:direct_counterparty:0",
      amountRaw: "12000000",
      txHash: null,
      metadata: expect.objectContaining({
        evidenceType: "grouped_transfers",
        aggregateTransferCount: 2,
        underlyingTransfers: [
          expect.objectContaining({
            txHash: "tx-a",
            amountRaw: "5000000",
            timestamp: "2026-06-25T09:49:03.000Z"
          }),
          expect.objectContaining({
            txHash: "tx-b",
            amountRaw: "7000000",
            timestamp: "2026-06-25T09:50:03.000Z"
          })
        ]
      })
    })]);
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
