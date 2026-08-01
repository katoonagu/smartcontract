# Admin Forensics Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal admin web dashboard that opens completed forensic jobs, renders a graph canvas, and shows adjacent analytics for weights, stop reasons, paths, and evidence references.

**Architecture:** Add a read-only graph projection layer over existing `forensic_check_jobs` rows, then expose it through a small token-protected admin HTTP server in the current Node process. The UI is a static admin console served by that server and backed by stable graph JSON, so browser code never parses raw forensic report internals.

**Tech Stack:** TypeScript, Node `http`, existing Postgres repository layer, existing Vitest setup, plain HTML/CSS/JavaScript for the first admin console, optional later graph library only after the data contract is stable.

---

## Spec

Primary spec: `docs/superpowers/specs/2026-06-01-admin-forensics-console-design.md`

## Scope Notes

- This plan implements post-completion graph inspection only.
- It does not add live job tracing.
- It does not change forensic scoring.
- It keeps normal Telegram user output unchanged.
- It adds admin-only endpoints guarded by `ADMIN_DASHBOARD_TOKEN`.
- It uses plain browser code first; add a graph library later only if plain SVG layout becomes insufficient.

## File Structure

- Create `src/admin/forensicsGraph.ts`: owns graph projection types and conversion from `ForensicCheckJob` to `AdminForensicsGraph`.
- Create `src/admin/adminAuth.ts`: owns admin token parsing and request authorization.
- Create `src/admin/adminServer.ts`: owns HTTP routing, JSON responses, static console serving, and server lifecycle.
- Create `src/admin/adminConsole.ts`: owns the HTML/CSS/JS string served at `/admin/forensics`.
- Modify `src/config.ts`: parse admin dashboard config.
- Modify `src/index.ts`: start the admin server when enabled and shut it down with the bot runtime.
- Modify `src/storage/repositories.ts`: add job list query for admin console.
- Create `tests/admin/forensicsGraph.test.ts`: projection behavior.
- Create `tests/admin/adminAuth.test.ts`: token auth behavior.
- Create `tests/admin/adminServer.test.ts`: endpoint behavior with mocked repository data.
- Optionally create `tests/admin/adminConsole.test.ts`: verifies the served HTML contains required app roots and controls if endpoint tests do not cover it.

## Task Order

1. Define graph projection types and where-is-money projection tests.
2. Implement minimal where-is-money graph projection.
3. Add address-deep and incoming-deposit projection coverage.
4. Add admin job list repository query.
5. Add admin config and token auth.
6. Add token-protected admin HTTP API.
7. Add static admin console shell and graph UI.
8. Wire admin server into runtime.
9. Run full verification and browser QA.

---

### Task 1: Graph Projection Types And First Failing Test

**Files:**
- Create: `src/admin/forensicsGraph.ts`
- Create: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Create the projection module with exported types and a stub**

Create `src/admin/forensicsGraph.ts`:

```ts
import type { ForensicCheckJob, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminForensicsDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
export type AdminForensicsRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdminForensicsConfidence = "low" | "medium" | "high";

export type AdminForensicsJobSummary = {
  id: string;
  kind: ForensicCheckJob["kind"];
  status: Extract<ForensicCheckJobStatus, "partial" | "completed" | "failed">;
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  requestedBy: string | null;
};

export type AdminForensicsAddressSummary = {
  address: string;
  displayLabel: string | null;
  knownLabels: string[];
  role: "checked_wallet" | "sender" | "receiver" | "unknown";
};

export type AdminForensicsSummary = {
  decision: AdminForensicsDecision;
  riskScore: number | null;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  coverageRatio: number | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
};

export type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "stop";
  label: string;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};

export type AdminForensicsEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "transfer" | "inferred_provenance" | "approval" | "service_boundary" | "stop";
  amountRaw: string | null;
  amountShare: number | null;
  txHash: string | null;
  timestamp: string | null;
  weight: number | null;
  verdict: "clean" | "review" | "risk" | "unknown";
  evidenceIds: string[];
  metadata: Record<string, unknown>;
};

export type AdminForensicsPath = {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  verdict: AdminForensicsDecision;
  riskContribution: number;
  amountRaw: string | null;
  amountShare: number | null;
  stoppedAtNodeId: string | null;
  stopReason: string | null;
  evidenceIds: string[];
};

export type AdminForensicsWeight = {
  id: string;
  source: string;
  label: string;
  value: number;
  direction: "raises_risk" | "lowers_risk" | "context";
  pathId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  explanation: string;
};

export type AdminForensicsLimitation = {
  code: string;
  label: string;
  severity: "info" | "review" | "blocking";
  pathId: string | null;
  explanation: string;
};

export type AdminForensicsEvidenceRef = {
  id: string;
  source: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  pathIds: string[];
};

export type AdminForensicsGraph = {
  job: AdminForensicsJobSummary;
  subject: AdminForensicsAddressSummary;
  summary: AdminForensicsSummary;
  nodes: AdminForensicsNode[];
  edges: AdminForensicsEdge[];
  paths: AdminForensicsPath[];
  weights: AdminForensicsWeight[];
  limitations: AdminForensicsLimitation[];
  evidence: AdminForensicsEvidenceRef[];
};

export type AdminForensicsProjectionResult =
  | { ok: true; graph: AdminForensicsGraph }
  | { ok: false; status: "not_ready" | "unsupported" | "malformed"; message: string };

export function projectForensicJobGraph(_job: ForensicCheckJob): AdminForensicsProjectionResult {
  return {
    ok: false,
    status: "unsupported",
    message: "Graph projection is not implemented for this job."
  };
}
```

- [ ] **Step 2: Add fixture helpers and the first failing projection test**

Create `tests/admin/forensicsGraph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectForensicJobGraph } from "../../src/admin/forensicsGraph";
import type { ForensicCheckJob } from "../../src/storage/repositories";

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
    requestedBy: "123",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: ["raw-1"],
    observationIds: ["obs-1"],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:01.000Z"),
    updatedAt: new Date("2026-06-01T00:10:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:02.000Z"),
    completedAt: new Date("2026-06-01T00:10:00.000Z"),
    ...overrides
  };
}

describe("projectForensicJobGraph", () => {
  it("projects a completed where-is-money job into graph JSON", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 35,
        decision: "ACCEPTABLE",
        coverage: {
          coverageRatio: 0.95,
          selectedAmountRaw: "950000000",
          targetAmountRaw: "1000000000",
          selectedInboundTxCount: 2
        },
        assessment: {
          decision: "ACCEPTABLE",
          riskScore: 35,
          provenanceConfidence: 67,
          reasons: ["95% of the requested amount was covered"]
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            txHashes: ["tx-1"],
            addresses: [
              "TSource1111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.job.id).toBe("job-1");
    expect(result.graph.subject.address).toBe("TSubject111111111111111111111111111111");
    expect(result.graph.summary.decision).toBe("ACCEPTABLE");
    expect(result.graph.summary.riskScore).toBe(35);
    expect(result.graph.summary.coverageRatio).toBe(0.95);
    expect(result.graph.nodes.some((node) => node.kind === "subject")).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === "stop")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.txHash === "tx-1")).toBe(true);
    expect(result.graph.paths[0]?.stopReason).toBe("weak_amount_or_time_continuity");
    expect(result.graph.weights[0]?.value).toBe(20);
    expect(result.graph.evidence.map((item) => item.id)).toContain("raw-1");
  });

  it("returns not_ready for queued and running jobs", () => {
    expect(projectForensicJobGraph(job({ status: "queued" }))).toMatchObject({
      ok: false,
      status: "not_ready"
    });
    expect(projectForensicJobGraph(job({ status: "running" }))).toMatchObject({
      ok: false,
      status: "not_ready"
    });
  });
});
```

- [ ] **Step 3: Run the targeted test and verify it fails**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: FAIL because `projectForensicJobGraph` returns `unsupported` for completed jobs.

- [ ] **Step 4: Commit the failing test and type shell**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "test: add admin forensics graph projection contract"
```

---

### Task 2: Minimal Where-Is-Money Graph Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Implement safe field helpers and job summary projection**

Replace the stub body in `src/admin/forensicsGraph.ts` with helpers and dispatch:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function riskLevelFromScore(score: number | null): AdminForensicsRiskLevel | null {
  if (score === null) return null;
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function confidenceFromNumber(value: number | null): AdminForensicsConfidence | null {
  if (value === null) return null;
  if (value >= 70) return "high";
  if (value >= 40) return "medium";
  return "low";
}

function decision(value: unknown): AdminForensicsDecision {
  return value === "ACCEPTABLE" || value === "REVIEW" || value === "DECLINE" ? value : "UNKNOWN";
}

function completedJobSummary(job: ForensicCheckJob): AdminForensicsJobSummary | null {
  if (job.status !== "completed" && job.status !== "partial" && job.status !== "failed") return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    subjectAddress: job.subjectAddress,
    windowStart: job.windowStart.toISOString(),
    windowEnd: job.windowEnd.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    requestedBy: job.requestedBy
  };
}

function nodeId(address: string): string {
  return `addr:${address}`;
}

function stopNodeId(pathIndex: number, reason: string): string {
  return `stop:${pathIndex}:${reason}`;
}

export function projectForensicJobGraph(job: ForensicCheckJob): AdminForensicsProjectionResult {
  const summary = completedJobSummary(job);
  if (!summary) {
    return {
      ok: false,
      status: "not_ready",
      message: "Forensic graph is available after the job completes."
    };
  }
  if (job.kind === "where_is_money_check") {
    return projectWhereIsMoneyJob(job, summary);
  }
  return {
    ok: false,
    status: "unsupported",
    message: `Graph projection is not implemented for ${job.kind}.`
  };
}
```

- [ ] **Step 2: Add the `projectWhereIsMoneyJob` implementation**

Add this function below the helpers in `src/admin/forensicsGraph.ts`:

```ts
function projectWhereIsMoneyJob(
  job: ForensicCheckJob,
  jobSummary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  if (!isRecord(job.resultJson)) {
    return { ok: false, status: "malformed", message: "Job result JSON is not an object." };
  }

  const result = job.resultJson;
  const coverage = isRecord(result.coverage) ? result.coverage : {};
  const assessment = isRecord(result.assessment) ? result.assessment : {};
  const score = numberField(result, "riskScore") ?? numberField(assessment, "riskScore");
  const coverageRatio = numberField(coverage, "coverageRatio") ?? numberField(coverage, "currentBalanceCoverageRatio");
  const subjectAddress = stringField(result, "subjectAddress") ?? job.subjectAddress;
  const subjectNode: AdminForensicsNode = {
    id: nodeId(subjectAddress),
    address: subjectAddress,
    kind: "subject",
    label: subjectAddress,
    riskLevel: riskLevelFromScore(score),
    confidence: confidenceFromNumber(numberField(assessment, "provenanceConfidence")),
    weight: score,
    metadata: {
      selectedInboundTxCount: numberField(coverage, "selectedInboundTxCount")
    }
  };

  const nodes = new Map<string, AdminForensicsNode>([[subjectNode.id, subjectNode]]);
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];

  const originPaths = arrayField(result, "originPaths");
  originPaths.forEach((item, index) => {
    if (!isRecord(item)) return;
    const addresses = arrayField(item, "addresses").filter((value): value is string => typeof value === "string");
    const txHashes = arrayField(item, "txHashes").filter((value): value is string => typeof value === "string");
    const stopReason = stringField(item, "stoppedReason");
    const pathNodeIds: string[] = [];
    const pathEdgeIds: string[] = [];

    for (const address of addresses) {
      const id = nodeId(address);
      pathNodeIds.push(id);
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          address,
          kind: address === subjectAddress ? "subject" : "wallet",
          label: address,
          riskLevel: null,
          confidence: null,
          weight: null,
          metadata: {}
        });
      }
    }

    for (let edgeIndex = 0; edgeIndex < Math.max(addresses.length - 1, txHashes.length); edgeIndex += 1) {
      const fromAddress = addresses[edgeIndex] ?? addresses[0] ?? subjectAddress;
      const toAddress = addresses[edgeIndex + 1] ?? subjectAddress;
      const edgeId = `path:${index}:edge:${edgeIndex}`;
      pathEdgeIds.push(edgeId);
      edges.push({
        id: edgeId,
        fromNodeId: nodeId(fromAddress),
        toNodeId: nodeId(toAddress),
        type: "transfer",
        amountRaw: stringField(item, "amountRaw"),
        amountShare: numberField(item, "amountShare"),
        txHash: txHashes[edgeIndex] ?? txHashes[0] ?? null,
        timestamp: stringField(item, "timestamp"),
        weight: numberField(item, "riskScoreContribution"),
        verdict: decision(item.verdict) === "DECLINE" ? "risk" : decision(item.verdict) === "ACCEPTABLE" ? "clean" : "review",
        evidenceIds: job.rawEvidenceIds,
        metadata: {}
      });
    }

    let stoppedAtNodeId: string | null = null;
    if (stopReason) {
      stoppedAtNodeId = stopNodeId(index, stopReason);
      nodes.set(stoppedAtNodeId, {
        id: stoppedAtNodeId,
        address: null,
        kind: "stop",
        label: stopReason,
        riskLevel: null,
        confidence: "low",
        weight: null,
        metadata: { reason: stopReason }
      });
      const previousNodeId = pathNodeIds[pathNodeIds.length - 1] ?? subjectNode.id;
      const edgeId = `path:${index}:stop`;
      pathNodeIds.push(stoppedAtNodeId);
      pathEdgeIds.push(edgeId);
      edges.push({
        id: edgeId,
        fromNodeId: previousNodeId,
        toNodeId: stoppedAtNodeId,
        type: "stop",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp: null,
        weight: null,
        verdict: "review",
        evidenceIds: [],
        metadata: { reason: stopReason }
      });
      limitations.push({
        code: stopReason,
        label: stopReason,
        severity: "review",
        pathId: `path:${index}`,
        explanation: stopReasonExplanation(stopReason)
      });
    }

    const riskContribution = numberField(item, "riskScoreContribution") ?? 0;
    paths.push({
      id: `path:${index}`,
      nodeIds: pathNodeIds.length > 0 ? pathNodeIds : [subjectNode.id],
      edgeIds: pathEdgeIds,
      verdict: decision(item.verdict),
      riskContribution,
      amountRaw: stringField(item, "amountRaw"),
      amountShare: numberField(item, "amountShare"),
      stoppedAtNodeId,
      stopReason,
      evidenceIds: job.rawEvidenceIds
    });
    weights.push({
      id: `weight:path:${index}`,
      source: "where_is_money",
      label: stopReason ?? "path contribution",
      value: riskContribution,
      direction: riskContribution > 0 ? "raises_risk" : "context",
      pathId: `path:${index}`,
      nodeId: null,
      edgeId: null,
      explanation: stopReason ? stopReasonExplanation(stopReason) : "Path contribution from where-is-money analysis."
    });
  });

  const topReasons = arrayField(assessment, "reasons").filter((value): value is string => typeof value === "string").slice(0, 5);
  const graph: AdminForensicsGraph = {
    job: jobSummary,
    subject: {
      address: subjectAddress,
      displayLabel: null,
      knownLabels: [],
      role: "checked_wallet"
    },
    summary: {
      decision: decision(result.decision ?? assessment.decision),
      riskScore: score,
      riskLevel: riskLevelFromScore(score),
      confidence: confidenceFromNumber(numberField(assessment, "provenanceConfidence")),
      coverageRatio,
      selectedAmountRaw: stringField(coverage, "selectedAmountRaw") ?? stringField(coverage, "selectedInboundVolumeRaw"),
      targetAmountRaw: stringField(coverage, "targetAmountRaw") ?? stringField(coverage, "requestedAmountRaw"),
      topReasons
    },
    nodes: Array.from(nodes.values()),
    edges,
    paths,
    weights,
    limitations,
    evidence: job.rawEvidenceIds.map((id) => ({
      id,
      source: "forensic_check_jobs.raw_evidence_ids",
      label: id,
      nodeIds: [],
      edgeIds: [],
      pathIds: paths.map((path) => path.id)
    }))
  };

  return { ok: true, graph };
}

function stopReasonExplanation(reason: string): string {
  const explanations: Record<string, string> = {
    no_previous_transfer: "The tracer did not find a previous incoming transfer that can explain this hop.",
    weak_amount_or_time_continuity: "The previous transfer history is too weak by amount or timing to prove continuity.",
    service_boundary: "The path reached a service or pooled wallet boundary where ownership is ambiguous.",
    max_depth_reached: "The configured trace depth ended before a clean source or hard-risk source was proven.",
    metadata_unavailable: "Required address or contract metadata was unavailable.",
    provider_limit: "The upstream provider limited data needed for deeper tracing.",
    insufficient_index_coverage: "The local index does not yet cover enough history for this path.",
    unknown_contract_boundary: "The path reached a contract boundary that the system cannot classify confidently."
  };
  return explanations[reason] ?? `The tracer stopped with reason: ${reason}.`;
}
```

- [ ] **Step 3: Run the targeted tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If TypeScript rejects `item.verdict`, change the verdict lines to `decision(item["verdict"])`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: project where-is-money jobs for admin graph"
```

---

### Task 3: Address-Deep And Incoming-Deposit Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add tests for supported job kinds**

Append these tests inside the existing `describe` block:

```ts
it("projects address-deep profile arrays into context nodes and weights", () => {
  const result = projectForensicJobGraph(job({
    kind: "address_deep_check",
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      counterpartyRiskProfiles: [
        {
          counterpartyAddress: "TCounterparty1111111111111111111111111",
          label: "darknet_exchange_proximity",
          score: 70,
          direction: "inbound",
          amountRaw: "100000000"
        }
      ],
      serviceExposureProfiles: [
        {
          serviceAddress: "TService111111111111111111111111111111",
          serviceType: "exchange",
          score: 15
        }
      ],
      coverage: {
        transferEdges: 4
      }
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.graph.nodes.some((node) => node.address === "TCounterparty1111111111111111111111111")).toBe(true);
  expect(result.graph.weights.some((weight) => weight.value === 70)).toBe(true);
  expect(result.graph.nodes.some((node) => node.kind === "service")).toBe(true);
});

it("projects incoming-deposit jobs from progress and embedded result data", () => {
  const result = projectForensicJobGraph(job({
    kind: "incoming_deposit_check",
    subjectAddress: "TSender1111111111111111111111111111111",
    progressJson: {
      watchedWallet: "TReceiver111111111111111111111111111111",
      sender: "TSender1111111111111111111111111111111",
      depositTxHash: "deposit-tx",
      amountRaw: "250000000"
    },
    resultJson: {
      decision: "REVIEW",
      riskScore: 48
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.graph.subject.role).toBe("sender");
  expect(result.graph.edges[0]).toMatchObject({
    txHash: "deposit-tx",
    amountRaw: "250000000",
    type: "transfer"
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: FAIL because only `where_is_money_check` is supported.

- [ ] **Step 3: Dispatch additional job kinds**

Modify `projectForensicJobGraph`:

```ts
  if (job.kind === "where_is_money_check") {
    return projectWhereIsMoneyJob(job, summary);
  }
  if (job.kind === "address_deep_check") {
    return projectAddressDeepJob(job, summary);
  }
  if (job.kind === "incoming_deposit_check") {
    return projectIncomingDepositJob(job, summary);
  }
```

- [ ] **Step 4: Add the address-deep projection**

Add to `src/admin/forensicsGraph.ts`:

```ts
function projectAddressDeepJob(
  job: ForensicCheckJob,
  jobSummary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const result = isRecord(job.resultJson) ? job.resultJson : {};
  const subjectAddress = stringField(result, "subjectAddress") ?? job.subjectAddress;
  const nodes = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];
  nodes.set(nodeId(subjectAddress), {
    id: nodeId(subjectAddress),
    address: subjectAddress,
    kind: "subject",
    label: subjectAddress,
    riskLevel: null,
    confidence: null,
    weight: null,
    metadata: {}
  });

  arrayField(result, "counterpartyRiskProfiles").forEach((item, index) => {
    if (!isRecord(item)) return;
    const address = stringField(item, "counterpartyAddress");
    if (!address) return;
    const id = nodeId(address);
    const score = numberField(item, "score") ?? 0;
    nodes.set(id, {
      id,
      address,
      kind: "wallet",
      label: stringField(item, "label") ?? address,
      riskLevel: riskLevelFromScore(score),
      confidence: "medium",
      weight: score,
      metadata: { direction: stringField(item, "direction"), amountRaw: stringField(item, "amountRaw") }
    });
    const edgeId = `deep:counterparty:${index}`;
    edges.push({
      id: edgeId,
      fromNodeId: id,
      toNodeId: nodeId(subjectAddress),
      type: "inferred_provenance",
      amountRaw: stringField(item, "amountRaw"),
      amountShare: numberField(item, "volumeRatio"),
      txHash: null,
      timestamp: null,
      weight: score,
      verdict: score >= 65 ? "risk" : "review",
      evidenceIds: job.rawEvidenceIds,
      metadata: { label: stringField(item, "label") }
    });
    const pathId = `deep:counterparty:${index}`;
    paths.push({
      id: pathId,
      nodeIds: [id, nodeId(subjectAddress)],
      edgeIds: [edgeId],
      verdict: score >= 65 ? "DECLINE" : "REVIEW",
      riskContribution: score,
      amountRaw: stringField(item, "amountRaw"),
      amountShare: numberField(item, "volumeRatio"),
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: job.rawEvidenceIds
    });
    weights.push({
      id: `weight:${pathId}`,
      source: "address_deep_check",
      label: stringField(item, "label") ?? "counterparty risk",
      value: score,
      direction: score > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: id,
      edgeId,
      explanation: "Counterparty profile contributed risk context to the deep address check."
    });
  });

  arrayField(result, "serviceExposureProfiles").forEach((item, index) => {
    if (!isRecord(item)) return;
    const address = stringField(item, "serviceAddress") ?? stringField(item, "address");
    if (!address) return;
    const id = nodeId(address);
    const score = numberField(item, "score");
    nodes.set(id, {
      id,
      address,
      kind: "service",
      label: stringField(item, "serviceType") ?? address,
      riskLevel: riskLevelFromScore(score),
      confidence: "medium",
      weight: score,
      metadata: item
    });
    weights.push({
      id: `weight:service:${index}`,
      source: "address_deep_check",
      label: "service exposure",
      value: score ?? 0,
      direction: "context",
      pathId: null,
      nodeId: id,
      edgeId: null,
      explanation: "Service exposure is shown as context unless another signal proves bad provenance."
    });
  });

  return {
    ok: true,
    graph: {
      job: jobSummary,
      subject: { address: subjectAddress, displayLabel: null, knownLabels: [], role: "checked_wallet" },
      summary: {
        decision: "UNKNOWN",
        riskScore: null,
        riskLevel: null,
        confidence: null,
        coverageRatio: null,
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: []
      },
      nodes: Array.from(nodes.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: job.rawEvidenceIds.map((id) => ({ id, source: "forensic_check_jobs.raw_evidence_ids", label: id, nodeIds: [], edgeIds: [], pathIds: [] }))
    }
  };
}
```

- [ ] **Step 5: Add the incoming-deposit projection**

Add to `src/admin/forensicsGraph.ts`:

```ts
function projectIncomingDepositJob(
  job: ForensicCheckJob,
  jobSummary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const result = isRecord(job.resultJson) ? job.resultJson : {};
  const sender = stringField(progress, "sender") ?? job.subjectAddress;
  const receiver = stringField(progress, "watchedWallet") ?? stringField(progress, "receiver") ?? job.subjectAddress;
  const score = numberField(result, "riskScore");
  const senderNodeId = nodeId(sender);
  const receiverNodeId = nodeId(receiver);
  const edgeId = "incoming:deposit";
  return {
    ok: true,
    graph: {
      job: jobSummary,
      subject: { address: sender, displayLabel: null, knownLabels: [], role: "sender" },
      summary: {
        decision: decision(result.decision),
        riskScore: score,
        riskLevel: riskLevelFromScore(score),
        confidence: null,
        coverageRatio: null,
        selectedAmountRaw: stringField(progress, "amountRaw"),
        targetAmountRaw: stringField(progress, "amountRaw"),
        topReasons: []
      },
      nodes: [
        { id: senderNodeId, address: sender, kind: "subject", label: sender, riskLevel: riskLevelFromScore(score), confidence: null, weight: score, metadata: {} },
        { id: receiverNodeId, address: receiver, kind: "wallet", label: receiver, riskLevel: null, confidence: null, weight: null, metadata: { role: "watched_wallet" } }
      ],
      edges: [{
        id: edgeId,
        fromNodeId: senderNodeId,
        toNodeId: receiverNodeId,
        type: "transfer",
        amountRaw: stringField(progress, "amountRaw"),
        amountShare: 1,
        txHash: stringField(progress, "depositTxHash"),
        timestamp: stringField(progress, "timestamp"),
        weight: score,
        verdict: score !== null && score >= 65 ? "risk" : score !== null && score >= 35 ? "review" : "unknown",
        evidenceIds: job.rawEvidenceIds,
        metadata: {}
      }],
      paths: [{
        id: "incoming:deposit",
        nodeIds: [senderNodeId, receiverNodeId],
        edgeIds: [edgeId],
        verdict: decision(result.decision),
        riskContribution: score ?? 0,
        amountRaw: stringField(progress, "amountRaw"),
        amountShare: 1,
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: job.rawEvidenceIds
      }],
      weights: [{
        id: "weight:incoming:deposit",
        source: "incoming_deposit_check",
        label: "incoming deposit score",
        value: score ?? 0,
        direction: score !== null && score > 0 ? "raises_risk" : "context",
        pathId: "incoming:deposit",
        nodeId: senderNodeId,
        edgeId,
        explanation: "Incoming deposit check result for this sender and transfer."
      }],
      limitations: [],
      evidence: job.rawEvidenceIds.map((id) => ({ id, source: "forensic_check_jobs.raw_evidence_ids", label: id, nodeIds: [], edgeIds: [edgeId], pathIds: ["incoming:deposit"] }))
    }
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: project all forensic job kinds for admin graph"
```

---

### Task 4: Admin Job List Repository Query

**Files:**
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/forensicCheckJobs.test.ts`

- [ ] **Step 1: Add a failing repository test**

First, update the local `createMockDb` helper in `tests/storage/forensicCheckJobs.test.ts` so one test can override the next query result without changing existing tests:

```ts
function createMockDb(
  overrides: { rows: Record<string, unknown>[]; rowCount?: number }[] = []
): { db: Db; queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  const queuedOverrides = [...overrides];
  return {
    db: {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        const override = queuedOverrides.shift();
        if (override) {
          return {
            rows: override.rows,
            rowCount: override.rowCount ?? override.rows.length
          };
        }
```

Keep the existing `if (sql.includes(...))` branches exactly as they are after the new override block.

Then append this test near existing forensic job repository tests:

```ts
it("lists recent forensic jobs for the admin console", async () => {
  const { db, queries } = createMockDb([
    {
      rows: [{
        id: "job-1",
        kind: "where_is_money_check",
        subject_address: "TSubject111111111111111111111111111111",
        status: "completed",
        window_start: new Date("2026-06-01T00:00:00.000Z"),
        window_end: new Date("2026-06-01T01:00:00.000Z"),
        priority: 100,
        chat_id: null,
        message_id: null,
        requested_by: "123",
        progress_json: {},
        result_json: { riskScore: 35, decision: "ACCEPTABLE" },
        raw_evidence_ids: [],
        observation_ids: [],
        last_error: null,
        created_at: new Date("2026-06-01T00:00:00.000Z"),
        updated_at: new Date("2026-06-01T01:00:00.000Z"),
        started_at: new Date("2026-06-01T00:00:01.000Z"),
        completed_at: new Date("2026-06-01T01:00:00.000Z")
      }]
    }
  ]);

  const jobs = await listAdminForensicCheckJobs(db, { limit: 20, offset: 0, status: "completed" });

  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.id).toBe("job-1");
  expect(queries[0]?.sql).toContain("from forensic_check_jobs");
  expect(queries[0]?.sql).toContain("status = $1");
});
```

If `createMockDb` uses a different helper name in this file, use the existing local mock helper and keep the assertions.

- [ ] **Step 2: Import the new function in the test**

Update the import from `src/storage/repositories`:

```ts
import {
  claimNextForensicCheckJob,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob,
  getLatestDeepForensicCheckJobForAddress,
  getLatestForensicCheckJobForAddress,
  listAdminForensicCheckJobs
} from "../../src/storage/repositories";
```

- [ ] **Step 3: Run the targeted test and verify failure**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts
```

Expected: FAIL because `listAdminForensicCheckJobs` is not exported.

- [ ] **Step 4: Add the repository input type and function**

Add near forensic job repository functions in `src/storage/repositories.ts`:

```ts
export type ListAdminForensicCheckJobsInput = {
  limit?: number;
  offset?: number;
  status?: ForensicCheckJobStatus;
  kind?: ForensicCheckJobKind;
  subjectAddress?: string;
};

export async function listAdminForensicCheckJobs(
  db: Db,
  input: ListAdminForensicCheckJobsInput = {}
): Promise<ForensicCheckJob[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = [];

  if (input.status) {
    params.push(parseForensicCheckJobStatus(input.status));
    where.push(`status = $${params.length}`);
  }
  if (input.kind) {
    params.push(parseForensicCheckJobKind(input.kind));
    where.push(`kind = $${params.length}`);
  }
  if (input.subjectAddress) {
    params.push(input.subjectAddress);
    where.push(`subject_address = $${params.length}`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit ${limitParam} offset ${offsetParam}`,
    params
  );
  return result.rows.map(mapForensicCheckJobRow);
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/storage/forensicCheckJobs.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories.ts tests/storage/forensicCheckJobs.test.ts
git commit -m "feat: list forensic jobs for admin dashboard"
```

---

### Task 5: Admin Config And Token Auth

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config/config.test.ts`
- Create: `src/admin/adminAuth.ts`
- Create: `tests/admin/adminAuth.test.ts`

- [ ] **Step 1: Add failing config assertions**

In `tests/config/config.test.ts`, extend the default config test:

```ts
expect(config.adminDashboardEnabled).toBe(false);
expect(config.adminDashboardHost).toBe("127.0.0.1");
expect(config.adminDashboardPort).toBe(8787);
expect(config.adminDashboardToken).toBe(null);
```

Add a new test:

```ts
it("parses admin dashboard config", () => {
  setRequiredEnv({
    BOT_TOKEN: "token",
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/tron_guard",
    SERVICE_ADMIN_TG_IDS: "123",
    ADMIN_DASHBOARD_ENABLED: "true",
    ADMIN_DASHBOARD_HOST: "0.0.0.0",
    ADMIN_DASHBOARD_PORT: "9090",
    ADMIN_DASHBOARD_TOKEN: "secret-token"
  });
  const config = loadConfig();

  expect(config.adminDashboardEnabled).toBe(true);
  expect(config.adminDashboardHost).toBe("0.0.0.0");
  expect(config.adminDashboardPort).toBe(9090);
  expect(config.adminDashboardToken).toBe("secret-token");
});
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```bash
npm test -- tests/config/config.test.ts
```

Expected: FAIL because config fields do not exist.

- [ ] **Step 3: Add config fields**

In `src/config.ts`, extend `AppConfig`:

```ts
  adminDashboardEnabled: boolean;
  adminDashboardHost: string;
  adminDashboardPort: number;
  adminDashboardToken: string | null;
```

In `loadConfig`, add:

```ts
    adminDashboardEnabled: parseBooleanFlag("ADMIN_DASHBOARD_ENABLED", process.env.ADMIN_DASHBOARD_ENABLED, false),
    adminDashboardHost: process.env.ADMIN_DASHBOARD_HOST?.trim() || "127.0.0.1",
    adminDashboardPort: parsePositiveInteger("ADMIN_DASHBOARD_PORT", process.env.ADMIN_DASHBOARD_PORT ?? "8787", 1),
    adminDashboardToken: process.env.ADMIN_DASHBOARD_TOKEN?.trim() || null,
```

- [ ] **Step 4: Add admin auth tests**

Create `tests/admin/adminAuth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { authorizeAdminRequest } from "../../src/admin/adminAuth";

describe("authorizeAdminRequest", () => {
  it("rejects requests when dashboard token is not configured", () => {
    expect(authorizeAdminRequest(undefined, null)).toEqual({
      ok: false,
      statusCode: 503,
      message: "Admin dashboard token is not configured."
    });
  });

  it("accepts a matching bearer token", () => {
    expect(authorizeAdminRequest("Bearer secret-token", "secret-token")).toEqual({ ok: true });
  });

  it("rejects missing or wrong bearer tokens", () => {
    expect(authorizeAdminRequest(undefined, "secret-token")).toMatchObject({ ok: false, statusCode: 401 });
    expect(authorizeAdminRequest("Bearer wrong", "secret-token")).toMatchObject({ ok: false, statusCode: 401 });
    expect(authorizeAdminRequest("Basic secret-token", "secret-token")).toMatchObject({ ok: false, statusCode: 401 });
  });
});
```

- [ ] **Step 5: Create admin auth implementation**

Create `src/admin/adminAuth.ts`:

```ts
export type AdminAuthResult =
  | { ok: true }
  | { ok: false; statusCode: 401 | 503; message: string };

export function authorizeAdminRequest(
  authorizationHeader: string | string[] | undefined,
  expectedToken: string | null
): AdminAuthResult {
  if (!expectedToken) {
    return { ok: false, statusCode: 503, message: "Admin dashboard token is not configured." };
  }
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) {
    return { ok: false, statusCode: 401, message: "Admin authorization required." };
  }
  const token = header.slice(prefix.length);
  if (token !== expectedToken) {
    return { ok: false, statusCode: 401, message: "Admin authorization required." };
  }
  return { ok: true };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/config/config.test.ts tests/admin/adminAuth.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/config/config.test.ts src/admin/adminAuth.ts tests/admin/adminAuth.test.ts
git commit -m "feat: add admin dashboard config and auth"
```

---

### Task 6: Token-Protected Admin HTTP API

**Files:**
- Create: `src/admin/adminServer.ts`
- Create: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add server endpoint tests**

Create `tests/admin/adminServer.test.ts`:

```ts
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

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("admin server", () => {
  it("rejects API requests without a bearer token", async () => {
    const server = await startAdminServer(deps());
    servers.push(server);

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`);

    expect(response.status).toBe(401);
  });

  it("lists forensic jobs for authorized admins", async () => {
    const server = await startAdminServer(deps());
    servers.push(server);

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`, {
      headers: { Authorization: "Bearer secret-token" }
    });
    const body = await response.json() as { jobs: Array<{ id: string; status: string }> };

    expect(response.status).toBe(200);
    expect(body.jobs[0]).toMatchObject({ id: "job-1", status: "completed" });
  });

  it("returns projected graph for a completed job", async () => {
    const server = await startAdminServer(deps());
    servers.push(server);

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { Authorization: "Bearer secret-token" }
    });
    const body = await response.json() as { graph: { job: { id: string } } };

    expect(response.status).toBe(200);
    expect(body.graph.job.id).toBe("job-1");
  });

  it("returns 404 for an unknown job", async () => {
    const server = await startAdminServer(deps());
    servers.push(server);

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/missing/graph`, {
      headers: { Authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run server tests and verify failure**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
```

Expected: FAIL because `src/admin/adminServer.ts` does not exist.

- [ ] **Step 3: Implement admin server**

Create `src/admin/adminServer.ts`:

```ts
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { authorizeAdminRequest } from "./adminAuth";
import { projectForensicJobGraph } from "./forensicsGraph";
import { adminConsoleHtml } from "./adminConsole";
import type { ForensicCheckJob, ForensicCheckJobKind, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminServerConfig = {
  host: string;
  port: number;
  token: string | null;
};

export type AdminServerDeps = {
  config: AdminServerConfig;
  listJobs(input: {
    limit?: number;
    offset?: number;
    status?: ForensicCheckJobStatus;
    kind?: ForensicCheckJobKind;
    subjectAddress?: string;
  }): Promise<ForensicCheckJob[]>;
  getJob(id: string): Promise<ForensicCheckJob | null>;
};

export type RunningAdminServer = {
  url: string;
  close(): Promise<void>;
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function parseInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStatus(value: string | null): ForensicCheckJobStatus | undefined {
  const allowed = new Set<ForensicCheckJobStatus>(["queued", "running", "partial", "completed", "failed", "cancelled"]);
  return allowed.has(value as ForensicCheckJobStatus) ? value as ForensicCheckJobStatus : undefined;
}

function parseKind(value: string | null): ForensicCheckJobKind | undefined {
  const allowed = new Set<ForensicCheckJobKind>(["address_deep_check", "where_is_money_check", "incoming_deposit_check"]);
  return allowed.has(value as ForensicCheckJobKind) ? value as ForensicCheckJobKind : undefined;
}

async function handleRequest(deps: AdminServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (url.pathname === "/admin/forensics") {
    sendHtml(response, adminConsoleHtml());
    return;
  }

  if (!url.pathname.startsWith("/admin/api/")) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const auth = authorizeAdminRequest(request.headers.authorization, deps.config.token);
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { error: auth.message });
    return;
  }

  if (url.pathname === "/admin/api/forensic-jobs") {
    const jobs = await deps.listJobs({
      limit: parseInteger(url.searchParams.get("limit"), 50),
      offset: parseInteger(url.searchParams.get("offset"), 0),
      status: parseStatus(url.searchParams.get("status")),
      kind: parseKind(url.searchParams.get("kind")),
      subjectAddress: url.searchParams.get("subjectAddress") ?? undefined
    });
    sendJson(response, 200, { jobs });
    return;
  }

  const graphMatch = url.pathname.match(/^\/admin\/api\/forensic-jobs\/([^/]+)\/graph$/);
  if (graphMatch) {
    const job = await deps.getJob(decodeURIComponent(graphMatch[1] ?? ""));
    if (!job) {
      sendJson(response, 404, { error: "Forensic job not found." });
      return;
    }
    const projection = projectForensicJobGraph(job);
    if (!projection.ok) {
      const statusCode = projection.status === "not_ready" ? 409 : projection.status === "unsupported" ? 422 : 500;
      sendJson(response, statusCode, { error: projection.message, status: projection.status });
      return;
    }
    sendJson(response, 200, { graph: projection.graph });
    return;
  }

  const rawMatch = url.pathname.match(/^\/admin\/api\/forensic-jobs\/([^/]+)\/raw$/);
  if (rawMatch) {
    const job = await deps.getJob(decodeURIComponent(rawMatch[1] ?? ""));
    if (!job) {
      sendJson(response, 404, { error: "Forensic job not found." });
      return;
    }
    sendJson(response, 200, { job });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

export async function startAdminServer(deps: AdminServerDeps): Promise<RunningAdminServer> {
  const server = http.createServer((request, response) => {
    handleRequest(deps, request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.config.port, deps.config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : deps.config.port;
  return {
    url: `http://${deps.config.host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}
```

- [ ] **Step 4: Add temporary admin console export**

Create `src/admin/adminConsole.ts`:

```ts
export function adminConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Forensics Console</title>
</head>
<body>
  <main id="app">Admin Forensics Console</main>
</body>
</html>`;
}
```

- [ ] **Step 5: Run server tests and typecheck**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/adminServer.ts src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: add admin forensic HTTP API"
```

---

### Task 7: Static Admin Console And Graph UI

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add HTML endpoint test**

Append to `tests/admin/adminServer.test.ts`:

```ts
it("serves the admin console shell", async () => {
  const server = await startAdminServer(deps());
  servers.push(server);

  const response = await fetch(`${server.url}/admin/forensics`);
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toContain("Admin Forensics Console");
  expect(html).toContain("data-admin-console");
  expect(html).toContain("/admin/api/forensic-jobs");
});
```

- [ ] **Step 2: Run server tests and verify failure**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
```

Expected: FAIL because the temporary shell does not include `data-admin-console` or API client code.

- [ ] **Step 3: Replace admin console HTML**

Replace `src/admin/adminConsole.ts` with:

```ts
export function adminConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Forensics Console</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111315;
      color: #edf0f2;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #111315; }
    button, input, select { font: inherit; }
    .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #2a2f34; background: #171a1d; }
    .topbar h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
    .token { display: flex; gap: 8px; align-items: center; }
    .token input { width: 260px; background: #0d0f11; color: #edf0f2; border: 1px solid #343a40; border-radius: 6px; padding: 8px; }
    .content { display: grid; grid-template-columns: 340px minmax(0, 1fr) 380px; min-height: 0; }
    .jobs, .details { border-right: 1px solid #2a2f34; padding: 12px; overflow: auto; }
    .details { border-right: 0; border-left: 1px solid #2a2f34; }
    .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    .filters input, .filters select { min-width: 0; background: #0d0f11; color: #edf0f2; border: 1px solid #343a40; border-radius: 6px; padding: 8px; }
    .job { width: 100%; text-align: left; background: #171a1d; color: #edf0f2; border: 1px solid #2a2f34; border-radius: 6px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
    .job:hover, .job.active { border-color: #7aa2f7; }
    .job strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
    .job span { display: block; color: #a8b0b8; font-size: 12px; margin-top: 4px; }
    .canvas-wrap { position: relative; overflow: hidden; background: #0d0f11; }
    svg { width: 100%; height: 100%; min-height: calc(100vh - 54px); display: block; }
    .node { cursor: pointer; }
    .edge { stroke: #6f7780; stroke-width: 2; fill: none; opacity: .9; }
    .edge.risk { stroke: #ff6b6b; }
    .edge.review { stroke: #f6c177; }
    .edge.clean { stroke: #8bd5a6; }
    .panel h2 { margin: 0 0 10px; font-size: 16px; }
    .metric { border: 1px solid #2a2f34; border-radius: 6px; padding: 10px; margin-bottom: 8px; background: #171a1d; }
    .metric label { display: block; color: #a8b0b8; font-size: 12px; margin-bottom: 4px; }
    .metric div { overflow-wrap: anywhere; }
    .error { color: #ff6b6b; padding: 8px 0; }
    .empty { color: #a8b0b8; padding: 16px 0; }
  </style>
</head>
<body>
  <main class="shell" data-admin-console>
    <header class="topbar">
      <h1>Admin Forensics Console</h1>
      <div class="token">
        <input id="token" type="password" placeholder="Bearer token" autocomplete="off">
        <button id="load">Load</button>
      </div>
    </header>
    <section class="content">
      <aside class="jobs">
        <div class="filters">
          <select id="status">
            <option value="">all statuses</option>
            <option value="completed">completed</option>
            <option value="partial">partial</option>
            <option value="failed">failed</option>
            <option value="running">running</option>
            <option value="queued">queued</option>
          </select>
          <select id="kind">
            <option value="">all kinds</option>
            <option value="where_is_money_check">where-is-money</option>
            <option value="address_deep_check">address deep</option>
            <option value="incoming_deposit_check">incoming deposit</option>
          </select>
          <input id="subject" placeholder="subject address">
          <button id="refresh">Refresh</button>
        </div>
        <div id="jobs"></div>
      </aside>
      <section class="canvas-wrap">
        <svg id="graph" role="img" aria-label="Forensics graph"></svg>
      </section>
      <aside class="details panel">
        <h2>Analysis</h2>
        <div id="details" class="empty">Select a completed job.</div>
      </aside>
    </section>
  </main>
  <script>
    const state = { token: "", jobs: [], graph: null, selected: null };
    const el = (id) => document.getElementById(id);
    const api = async (path) => {
      const response = await fetch(path, { headers: { Authorization: "Bearer " + state.token } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    };
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    function renderJobs() {
      const root = el("jobs");
      if (state.jobs.length === 0) {
        root.innerHTML = '<div class="empty">No jobs found.</div>';
        return;
      }
      root.innerHTML = state.jobs.map((job) => '<button class="job" data-job-id="' + escapeHtml(job.id) + '"><strong>' + escapeHtml(job.subjectAddress) + '</strong><span>' + escapeHtml(job.kind) + ' · ' + escapeHtml(job.status) + '</span><span>' + escapeHtml(job.completedAt || job.updatedAt || "") + '</span></button>').join("");
      root.querySelectorAll("[data-job-id]").forEach((button) => button.addEventListener("click", () => loadGraph(button.getAttribute("data-job-id"))));
    }
    async function loadJobs() {
      state.token = el("token").value.trim();
      const params = new URLSearchParams();
      if (el("status").value) params.set("status", el("status").value);
      if (el("kind").value) params.set("kind", el("kind").value);
      if (el("subject").value.trim()) params.set("subjectAddress", el("subject").value.trim());
      try {
        const body = await api("/admin/api/forensic-jobs?" + params.toString());
        state.jobs = body.jobs || [];
        renderJobs();
      } catch (error) {
        el("jobs").innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      }
    }
    async function loadGraph(jobId) {
      try {
        const body = await api("/admin/api/forensic-jobs/" + encodeURIComponent(jobId) + "/graph");
        state.graph = body.graph;
        state.selected = null;
        renderGraph();
        renderDetails();
      } catch (error) {
        el("details").innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      }
    }
    function layout(graph) {
      const width = 900;
      const height = 620;
      const nodes = graph.nodes.map((node, index) => {
        const angle = graph.nodes.length <= 1 ? 0 : (Math.PI * 2 * index) / graph.nodes.length;
        const radius = node.kind === "subject" ? 0 : 230;
        return { ...node, x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius };
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      return { width, height, nodes, byId };
    }
    function renderGraph() {
      const svg = el("graph");
      if (!state.graph) {
        svg.innerHTML = "";
        return;
      }
      const graph = state.graph;
      const placed = layout(graph);
      svg.setAttribute("viewBox", "0 0 " + placed.width + " " + placed.height);
      const edgeSvg = graph.edges.map((edge) => {
        const from = placed.byId.get(edge.fromNodeId);
        const to = placed.byId.get(edge.toNodeId);
        if (!from || !to) return "";
        const cls = "edge " + escapeHtml(edge.verdict);
        return '<path class="' + cls + '" data-edge-id="' + escapeHtml(edge.id) + '" d="M ' + from.x + ' ' + from.y + ' L ' + to.x + ' ' + to.y + '"></path>';
      }).join("");
      const nodeSvg = placed.nodes.map((node) => {
        const color = node.kind === "subject" ? "#7aa2f7" : node.kind === "stop" ? "#f6c177" : node.riskLevel === "HIGH" || node.riskLevel === "CRITICAL" ? "#ff6b6b" : "#8bd5a6";
        return '<g class="node" data-node-id="' + escapeHtml(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')"><circle r="20" fill="#171a1d" stroke="' + color + '" stroke-width="3"></circle><text y="38" text-anchor="middle" fill="#edf0f2" font-size="12">' + escapeHtml(node.label.slice(0, 10)) + '</text></g>';
      }).join("");
      svg.innerHTML = edgeSvg + nodeSvg;
      svg.querySelectorAll("[data-node-id]").forEach((node) => node.addEventListener("click", () => {
        state.selected = { type: "node", id: node.getAttribute("data-node-id") };
        renderDetails();
      }));
      svg.querySelectorAll("[data-edge-id]").forEach((edge) => edge.addEventListener("click", () => {
        state.selected = { type: "edge", id: edge.getAttribute("data-edge-id") };
        renderDetails();
      }));
    }
    function renderDetails() {
      const root = el("details");
      const graph = state.graph;
      if (!graph) {
        root.innerHTML = '<div class="empty">Select a completed job.</div>';
        return;
      }
      if (state.selected?.type === "node") {
        const node = graph.nodes.find((item) => item.id === state.selected.id);
        root.innerHTML = detailBlock("Node", node);
        return;
      }
      if (state.selected?.type === "edge") {
        const edge = graph.edges.find((item) => item.id === state.selected.id);
        root.innerHTML = detailBlock("Edge", edge);
        return;
      }
      root.innerHTML = [
        metric("Subject", graph.subject.address),
        metric("Decision", graph.summary.decision),
        metric("Risk", (graph.summary.riskScore ?? "n/a") + " / " + (graph.summary.riskLevel ?? "unknown")),
        metric("Coverage", graph.summary.coverageRatio ?? "n/a"),
        metric("Paths", graph.paths.length),
        metric("Limitations", graph.limitations.map((item) => item.label).join(", ") || "none")
      ].join("");
    }
    function metric(label, value) {
      return '<div class="metric"><label>' + escapeHtml(label) + '</label><div>' + escapeHtml(value) + '</div></div>';
    }
    function detailBlock(title, value) {
      if (!value) return '<div class="empty">No detail found.</div>';
      return '<h2>' + escapeHtml(title) + '</h2><pre class="metric">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
    }
    el("load").addEventListener("click", loadJobs);
    el("refresh").addEventListener("click", loadJobs);
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test -- tests/admin/adminServer.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: add admin forensics console UI"
```

---

### Task 8: Runtime Wiring

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/runtime/startupSchedule.test.ts` or create `tests/runtime/adminServerStartup.test.ts`

- [ ] **Step 1: Add a startup unit test for disabled config**

If `src/index.ts` has hard-to-test startup side effects, create `src/admin/adminRuntime.ts` and test that instead. Create `tests/runtime/adminServerStartup.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { maybeStartAdminDashboard } from "../../src/admin/adminRuntime";

describe("maybeStartAdminDashboard", () => {
  it("does not start when disabled", async () => {
    const start = vi.fn();
    const server = await maybeStartAdminDashboard({
      config: {
        adminDashboardEnabled: false,
        adminDashboardHost: "127.0.0.1",
        adminDashboardPort: 8787,
        adminDashboardToken: null
      },
      startAdminServer: start,
      listJobs: async () => [],
      getJob: async () => null
    });

    expect(server).toBe(null);
    expect(start).not.toHaveBeenCalled();
  });

  it("throws when enabled without a token", async () => {
    await expect(maybeStartAdminDashboard({
      config: {
        adminDashboardEnabled: true,
        adminDashboardHost: "127.0.0.1",
        adminDashboardPort: 8787,
        adminDashboardToken: null
      },
      startAdminServer: vi.fn(),
      listJobs: async () => [],
      getJob: async () => null
    })).rejects.toThrow("ADMIN_DASHBOARD_TOKEN");
  });
});
```

- [ ] **Step 2: Create runtime helper**

Create `src/admin/adminRuntime.ts`:

```ts
import { startAdminServer, type RunningAdminServer } from "./adminServer";
import type { AppConfig } from "../config";
import type { ForensicCheckJob, ForensicCheckJobKind, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminRuntimeDeps = {
  config: Pick<AppConfig, "adminDashboardEnabled" | "adminDashboardHost" | "adminDashboardPort" | "adminDashboardToken">;
  startAdminServer?: typeof startAdminServer;
  listJobs(input: {
    limit?: number;
    offset?: number;
    status?: ForensicCheckJobStatus;
    kind?: ForensicCheckJobKind;
    subjectAddress?: string;
  }): Promise<ForensicCheckJob[]>;
  getJob(id: string): Promise<ForensicCheckJob | null>;
};

export async function maybeStartAdminDashboard(deps: AdminRuntimeDeps): Promise<RunningAdminServer | null> {
  if (!deps.config.adminDashboardEnabled) return null;
  if (!deps.config.adminDashboardToken) {
    throw new Error("ADMIN_DASHBOARD_TOKEN is required when ADMIN_DASHBOARD_ENABLED=true");
  }
  return (deps.startAdminServer ?? startAdminServer)({
    config: {
      host: deps.config.adminDashboardHost,
      port: deps.config.adminDashboardPort,
      token: deps.config.adminDashboardToken
    },
    listJobs: deps.listJobs,
    getJob: deps.getJob
  });
}
```

- [ ] **Step 3: Run runtime helper tests**

Run:

```bash
npm test -- tests/runtime/adminServerStartup.test.ts
```

Expected: PASS.

- [ ] **Step 4: Wire helper into `src/index.ts`**

Add imports:

```ts
import { maybeStartAdminDashboard } from "./admin/adminRuntime";
import { listAdminForensicCheckJobs } from "./storage/repositories";
```

After the DB is initialized and before long-running workers start, add:

```ts
  const adminDashboard = await maybeStartAdminDashboard({
    config,
    listJobs: (input) => listAdminForensicCheckJobs(db, input),
    getJob: (id) => getForensicCheckJob(db, id)
  });
  if (adminDashboard) {
    logger.info("admin_dashboard_started", { url: adminDashboard.url });
  }
```

In the shutdown path, add:

```ts
    if (adminDashboard) {
      await adminDashboard.close();
      logger.info("admin_dashboard_stopped", {});
    }
```

If `src/index.ts` currently has shutdown state in a different scope, place `let adminDashboard: RunningAdminServer | null = null;` near the runtime variables and assign it after startup.

- [ ] **Step 5: Run focused runtime and type tests**

Run:

```bash
npm test -- tests/runtime/adminServerStartup.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/adminRuntime.ts tests/runtime/adminServerStartup.test.ts src/index.ts
git commit -m "feat: wire admin dashboard into runtime"
```

---

### Task 9: Verification And Browser QA

**Files:**
- Modify only if verification finds defects.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Start local dependencies if needed**

If Postgres is not running:

```bash
docker compose up -d postgres
npm run db:migrate
```

Expected: migrations complete without errors.

- [ ] **Step 4: Start the app with dashboard enabled**

Run in a terminal:

```bash
$env:ADMIN_DASHBOARD_ENABLED='true'
$env:ADMIN_DASHBOARD_HOST='127.0.0.1'
$env:ADMIN_DASHBOARD_PORT='8787'
$env:ADMIN_DASHBOARD_TOKEN='local-admin-token'
npm run dev
```

Expected: logs include `admin_dashboard_started` with `http://127.0.0.1:8787`.

- [ ] **Step 5: Check API manually**

Run:

```bash
curl -H "Authorization: Bearer local-admin-token" http://127.0.0.1:8787/admin/api/forensic-jobs
```

Expected: JSON body with `jobs`.

- [ ] **Step 6: Check unauthorized API manually**

Run:

```bash
curl -i http://127.0.0.1:8787/admin/api/forensic-jobs
```

Expected: HTTP `401` and no job data.

- [ ] **Step 7: Browser QA**

Open:

```text
http://127.0.0.1:8787/admin/forensics
```

Verify:

- the page renders without console errors;
- entering `local-admin-token` and pressing `Load` shows jobs;
- selecting a completed job renders a non-empty graph;
- selecting a node updates the side panel;
- selecting an edge updates the side panel;
- running/queued jobs show API `409` if opened directly through the graph endpoint;
- failed jobs are visible in the list with their status.

- [ ] **Step 8: Final commit for verification fixes**

If defects were fixed:

```bash
git status --short
git add src/admin src/config.ts src/index.ts tests/admin tests/config tests/runtime tests/storage
git commit -m "fix: stabilize admin forensics console"
```

If no defects were found, do not create an empty commit.

---

## Final Review Checklist

- [ ] Graph projection never requires live tracing data.
- [ ] UI consumes `AdminForensicsGraph`, not raw report JSON.
- [ ] Admin API requires `Authorization: Bearer <token>`.
- [ ] Dashboard is disabled by default.
- [ ] Normal Telegram bot behavior is unchanged.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] Browser QA confirms graph is non-empty for at least one completed fixture or real job.
