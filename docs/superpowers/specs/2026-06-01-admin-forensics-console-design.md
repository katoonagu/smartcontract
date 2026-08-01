# Admin Forensics Console Design

Date: 2026-06-01

## Summary

Admins need an Arkham-like internal dashboard for every wallet that was checked by the system. The dashboard should show the completed forensic analysis as a graph, with adjacent operational analytics explaining route weights, stop reasons, confidence, evidence, and what the tracer did or did not prove.

The approved first version is an admin web panel inside this repository. It reads completed forensic jobs from the existing Postgres database and renders graph-ready data after the job finishes. It does not need live tracing during job execution in the first version.

## Approved Product Decisions

1. **Location:** build the dashboard inside the current project, not as a separate application.
2. **Timing:** show analysis after job completion. Running and queued jobs may appear in lists, but the graph is built from completed or partial job results.
3. **Primary data source:** reuse `forensic_check_jobs.progress_json` and `forensic_check_jobs.result_json`.
4. **Primary job types:** start with `where_is_money_check` and `address_deep_check`; include `incoming_deposit_check` when its result contains usable provenance data.
5. **UI shape:** graph canvas plus side analytics panel for selected wallet, path, node, edge, and evidence.
6. **Scope:** internal admin tooling only. It should not expose this view to normal Telegram users.

## Problem

The current bot can run deep checks, where-is-money provenance, route search, and incoming deposit analysis, but admins only see final reports or compact Telegram messages. That makes investigation hard:

- the final score hides which path contributed which weight;
- stop reasons are buried in JSON or long text;
- routes are difficult to compare visually;
- admins cannot inspect where the tracer stopped, what it skipped, or why confidence stayed low;
- support/debug data exists, but it is not shaped for investigation.

The goal is not to create a new scoring engine. The goal is to expose the existing analysis in a graph-first admin console.

## Non-Goals

- Do not implement live streaming of tracing steps in the first version.
- Do not replace Telegram user reports.
- Do not add wallet-control features, transaction signing, revocation, or fund movement.
- Do not introduce a new AML provider as part of this work.
- Do not claim dirty provenance when the underlying report only has review-level evidence.
- Do not require a separate frontend repository for the first version.

## Recommended Approach

Use a staged implementation:

1. Add a graph projection layer that converts completed forensic job results into a stable `AdminForensicsGraph` JSON shape.
2. Add read-only admin HTTP endpoints inside the current Node project.
3. Add an internal admin web panel that lists checked wallets/jobs and opens a graph canvas with side analytics.
4. Add post-completion trace summaries from existing `coverage`, `originPaths`, `assessment`, `rawEvidenceIds`, and `observationIds`.
5. Later, add richer step-by-step trace event capture if live progress becomes necessary.

This keeps the first version grounded in stored data. It avoids building a beautiful canvas before the backend can explain the graph reliably.

## Alternatives Considered

### Option A: Backend Graph Projection First, Then UI

Build a stable graph JSON contract first, then render it.

Pros:

- lowest risk;
- testable without a browser;
- reuses existing forensic jobs;
- makes UI simpler;
- prepares the system for future live tracing.

Cons:

- first visible result arrives after backend shaping work.

This is the recommended option.

### Option B: UI First Over Raw Job JSON

Render directly from `result_json` in the browser.

Pros:

- faster prototype;
- less backend work at the start.

Cons:

- fragile coupling to internal report shapes;
- hard to test;
- UI becomes responsible for forensic semantics;
- every scoring/report change can break the dashboard.

This is not recommended for the real implementation.

### Option C: Separate Web Application

Create a separate admin frontend and API service.

Pros:

- cleaner long-term deployment boundary;
- independent UI stack choices.

Cons:

- more authentication, deployment, and API work;
- duplicates project setup;
- slower path to useful internal tooling.

This can be revisited later if the console grows beyond internal admin use.

## Admin Experience

The first screen is a compact admin job list:

- subject address;
- job kind;
- status;
- final risk score or decision when available;
- completed time;
- requester or Telegram context if stored;
- quick filters for `completed`, `partial`, `failed`, and high-risk jobs.

Opening a job shows:

- central graph canvas;
- right-side analytics panel;
- top summary bar with subject, job status, decision, score, confidence, selected amount, coverage, and runtime;
- selectable nodes, edges, and paths;
- evidence and stop-reason detail for the current selection.

The UI should be dense and operational, not a marketing page. The admin should be able to scan many checks, open one, inspect the graph, and understand what happened without reading raw JSON.

## Graph Canvas

The canvas represents the forensic result as a directed graph.

Nodes:

- checked wallet;
- source wallets;
- intermediate wallets;
- service or boundary addresses;
- known risky labels;
- contracts when they materially affected the report;
- unresolved stops such as no previous transfer or weak continuity.

Edges:

- USDT transfers;
- inferred provenance links;
- approval-drain or spender relationships when present;
- service boundary links;
- cross-chain or corridor links only when already present in the job result.

Visual encoding:

- edge thickness reflects amount or amount share;
- edge color reflects verdict or risk contribution;
- node border/status reflects label confidence;
- stopped paths get an explicit stop marker;
- selected path highlights all related nodes, edges, tx hashes, and evidence.

## Side Analytics

The side panel should explain the graph in operational terms.

Default job panel:

- final decision and score;
- coverage ratio;
- selected inbound transfer count;
- checked amount or current-balance target;
- top risk contributors;
- top limitations;
- raw evidence count;
- observation count;
- completed time and status.

Selected path panel:

- path verdict;
- risk contribution;
- amount and amount preservation;
- hop depth;
- stop reason;
- confidence;
- tx hashes;
- evidence references.

Selected node panel:

- address;
- role in the graph;
- labels and confidence;
- service classification;
- inbound/outbound volume when available;
- why this node matters.

Selected edge panel:

- transfer amount;
- timestamp;
- tx hash;
- source and destination;
- edge type;
- weight or contribution;
- evidence source.

## Graph JSON Contract

Introduce a presentation-level contract. The UI should consume this instead of raw forensic job JSON.

```ts
type AdminForensicsGraph = {
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
```

Job summary:

```ts
type AdminForensicsJobSummary = {
  id: string;
  kind: "address_deep_check" | "where_is_money_check" | "incoming_deposit_check";
  status: "partial" | "completed" | "failed";
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  requestedBy: string | null;
};
```

Subject summary:

```ts
type AdminForensicsAddressSummary = {
  address: string;
  displayLabel: string | null;
  knownLabels: string[];
  role: "checked_wallet" | "sender" | "receiver" | "unknown";
};
```

Overall summary:

```ts
type AdminForensicsSummary = {
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
  riskScore: number | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  confidence: "low" | "medium" | "high" | null;
  coverageRatio: number | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
};
```

Nodes:

```ts
type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "stop";
  label: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  confidence: "low" | "medium" | "high" | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};
```

Edges:

```ts
type AdminForensicsEdge = {
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
```

Paths:

```ts
type AdminForensicsPath = {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  verdict: "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
  riskContribution: number;
  amountRaw: string | null;
  amountShare: number | null;
  stoppedAtNodeId: string | null;
  stopReason: string | null;
  evidenceIds: string[];
};
```

Weights:

```ts
type AdminForensicsWeight = {
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
```

Limitations:

```ts
type AdminForensicsLimitation = {
  code: string;
  label: string;
  severity: "info" | "review" | "blocking";
  pathId: string | null;
  explanation: string;
};
```

Evidence references:

```ts
type AdminForensicsEvidenceRef = {
  id: string;
  source: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  pathIds: string[];
};
```

## Data Mapping

For `where_is_money_check`, derive graph data from:

- `result_json.subjectAddress`;
- `result_json.coverage`;
- `result_json.originPaths`;
- `result_json.assessment`;
- `result_json.missingChecks`;
- `raw_evidence_ids`;
- `observation_ids`;
- useful fields in `progress_json`, such as requested amount or seed transfers.

For `address_deep_check`, derive graph data from:

- inbound provenance profiles;
- counterparty risk profiles;
- approval-drain provenance profiles;
- service exposure profiles;
- boundary exposure profiles;
- operational flow profiles;
- coverage and coverage debug.

For `incoming_deposit_check`, derive graph data from:

- deposit tx hash;
- watched wallet;
- sender;
- amount;
- embedded where-is-money or provenance result when present.

If a field is missing, the projection should omit that graph element rather than inventing evidence.

## Stop Reasons

Stop reasons must be first-class UI concepts. Common examples:

- `no_previous_transfer`;
- `weak_amount_or_time_continuity`;
- `service_boundary`;
- `max_depth_reached`;
- `metadata_unavailable`;
- `provider_limit`;
- `insufficient_index_coverage`;
- `unknown_contract_boundary`;
- `missing_requested_amount_context`.

The UI should show both the raw reason and a short admin-friendly explanation.

## HTTP Surface

Add read-only admin endpoints inside the current project.

Initial endpoints:

- `GET /admin/forensics` - HTML shell for the admin console.
- `GET /admin/api/forensic-jobs` - paginated job list.
- `GET /admin/api/forensic-jobs/:id/graph` - graph projection for a completed or partial job.
- `GET /admin/api/forensic-jobs/:id/raw` - optional raw JSON debug endpoint for admins only.

The first version can use a small built-in HTTP server or a minimal routing layer in the existing Node process. It should not require a new framework unless the implementation plan finds an existing project pattern that supports it.

## Access Control

The console must be admin-only.

Minimum local/staging gate:

- require an admin token from environment, for example `ADMIN_DASHBOARD_TOKEN`;
- reject requests without `Authorization: Bearer <token>`;
- do not log the token.

If the project later gets a proper operator login, this token gate can be replaced.

Do not expose the admin server publicly without TLS and access control.

## Configuration

Add environment-driven configuration:

- `ADMIN_DASHBOARD_ENABLED=false` by default;
- `ADMIN_DASHBOARD_HOST=127.0.0.1`;
- `ADMIN_DASHBOARD_PORT=8787`;
- `ADMIN_DASHBOARD_TOKEN` required when enabled.

The dashboard should be disabled by default in production-like environments until explicitly configured.

## UI Implementation Notes

The UI can start as a simple static HTML/TypeScript bundle served by the Node process.

Recommended graph rendering:

- use a proven graph/canvas library if added during implementation;
- avoid hand-rolling graph layout for non-trivial route graphs;
- keep the data contract independent from the rendering library.

Expected controls:

- job search/filter;
- status filter;
- risk filter;
- graph zoom/pan;
- fit-to-screen;
- selected path highlight;
- node/edge/path detail panel;
- raw JSON toggle for admins.

## Error Handling

Job list:

- show empty state when no jobs exist;
- show failed jobs with `last_error`;
- hide graph button for queued/running jobs or show "analysis not completed yet".

Graph endpoint:

- return `404` for unknown job;
- return `409` or a structured "not ready" response for queued/running jobs;
- return graph plus error summary for `partial` jobs when enough data exists;
- return a clear projection error if result JSON is malformed.

Projection:

- never throw because one optional report section is missing;
- preserve raw unknown fields in `metadata` only when useful;
- keep evidence IDs even when evidence details are not loaded.

## Testing

Backend tests:

- graph projection from a representative where-is-money result;
- graph projection from a partial result with stop reasons;
- graph projection from address-deep profiles;
- job list repository/API shape;
- auth rejects missing or wrong admin token;
- queued/running jobs do not return a completed graph.

Frontend tests or browser QA:

- job list renders;
- completed job opens graph;
- selecting a node updates side analytics;
- selecting a path shows stop reason and weights;
- empty and failed states are readable;
- graph is non-empty for fixture data.

## Skills For Next Phases

Use these skills in order:

1. `brainstorming` - already used to shape this design.
2. `writing-plans` - next step after this spec is reviewed.
3. `test-driven-development` - required when implementing projection, API, and auth behavior.
4. `design-taste-frontend` or `redesign-existing-projects` - use for the admin dashboard UI once backend contract is clear.
5. `playwright` or `browse` - use for real browser verification of the local dashboard.
6. `qa` - use for end-to-end checks across job list, graph view, and detail panel.
7. `verification-before-completion` - use before claiming the feature is done.
8. `requesting-code-review` - use before landing if the implementation touches the server, storage, and UI together.

## Implementation Boundaries

This feature should be split into tasks in the implementation plan:

1. Define graph projection types and fixture tests.
2. Implement `where_is_money_check` graph projection.
3. Implement `address_deep_check` graph projection.
4. Add read-only admin repository/API endpoints with token auth.
5. Add minimal admin web shell and job list.
6. Add graph canvas and side analytics.
7. Add browser QA and fixture-driven regression coverage.

Do not combine graph projection, server routing, and UI polish into one large untested edit.

## Open Questions For Implementation Planning

- Which graph rendering library should be used in this repo's Node/TypeScript setup?
- Should the admin server run inside the bot process or as a separate script using the same codebase and database?
- Should raw evidence details be loaded in the first version or only evidence IDs?
- What retention and pagination limits should be used for job history?

The default implementation plan should choose conservative answers if the user does not override them: run inside the current process when enabled, use evidence IDs first, paginate newest jobs, and add a library only if it materially reduces graph layout risk.
