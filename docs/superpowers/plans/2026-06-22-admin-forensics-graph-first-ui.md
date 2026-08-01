# Admin Forensics Graph-First UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Admin Forensics selected-job view into a graph-first investigation workspace with overlays, semantic graph visuals, compact timeline, and collapsed transfers.

**Architecture:** Keep the existing server-rendered admin console in `src/admin/adminConsole.ts` for the first release. Add focused helper functions inside the existing inline browser script instead of introducing a frontend build step. Preserve the current `/admin/api/forensic-jobs` and `/admin/api/forensic-jobs/:id/graph` API shapes.

**Tech Stack:** TypeScript, Node.js HTTP server, inline HTML/CSS/JavaScript, SVG graph rendering, Vitest.

---

## File Structure

- Modify: `src/admin/adminConsole.ts`
  - Owns the admin console HTML, CSS, and inline browser JavaScript.
  - This plan keeps changes here to avoid a frontend migration in the first release.
  - New responsibilities in this file: graph-first shell, overlay state, semantic graph layout, edge visual roles, timeline buckets, transfer drawer.

- Create: `tests/admin/adminConsole.test.ts`
  - String-level regression tests for admin console shell and inline helper contracts.
  - Keeps tests cheaper than browser automation while the console remains inline HTML/JS.

- Modify: `tests/admin/adminServer.test.ts`
  - Update existing shell assertions that currently expect the old permanent columns and transfer panel.
  - Keep API/auth tests unchanged.

- Optional modify if tests reveal missing projection metadata: `src/admin/forensicsGraph.ts`
  - Only touch this if the UI cannot derive a required display kind or edge role from current graph JSON.
  - Do not change forensic scoring or traversal.

## Known Constraints

- Do not copy Arkham code, assets, bundle output, or proprietary implementation.
- Do not add React, D3, Cytoscape, Canvas, or WebGL in this first release.
- Do not change fast/deep/where-is-money forensic logic.
- Keep unrelated dirty worktree changes untouched.
- Stage only files intentionally changed by each task.

---

### Task 1: Add Admin Console Shell Tests

**Files:**
- Create: `tests/admin/adminConsole.test.ts`
- Modify: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write the failing admin console shell test**

Create `tests/admin/adminConsole.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";

describe("adminConsoleHtml", () => {
  it("renders the graph-first investigation shell", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('data-admin-console');
    expect(html).toContain('data-graph-first-shell');
    expect(html).toContain('data-overlay="case-brief"');
    expect(html).toContain('data-overlay="jobs"');
    expect(html).toContain('id="toggleCaseBrief"');
    expect(html).toContain('id="toggleJobs"');
    expect(html).toContain('id="activityTimeline"');
    expect(html).toContain('id="toggleTransfers"');
    expect(html).toContain('data-transfer-drawer');
    expect(html).toContain('id="toolFitGraph"');
    expect(html).toContain('id="toolToggleLabels"');
    expect(html).toContain('id="toolResetView"');
    expect(html).toContain('id="flowMode"');
    expect(html).toContain('id="servicesMode"');
    expect(html).toContain('id="groupSmallWallets"');
  });

  it("keeps graph-first browser helpers available", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function setOverlay");
    expect(html).toContain("function renderCaseBrief");
    expect(html).toContain("function renderActivityTimeline");
    expect(html).toContain("function setTransferDrawer");
    expect(html).toContain("function graphFirstLayout");
    expect(html).toContain("function edgeVisualRole");
    expect(html).toContain("function edgeStrokeWidth");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because `data-graph-first-shell`, overlay controls, and graph-first helpers do not exist yet.

- [ ] **Step 3: Update the existing admin server shell assertion**

In `tests/admin/adminServer.test.ts`, in `serves admin console shell without exposing job data`, add the new shell assertions near the existing `data-admin-console` check:

```ts
expect(html).toContain("data-graph-first-shell");
expect(html).toContain("Case brief");
expect(html).toContain("Jobs");
expect(html).toContain("Activity timeline");
expect(html).toContain("Transfers");
expect(html).toContain("function renderCaseBrief");
expect(html).toContain("function renderActivityTimeline");
```

Keep the existing API/security assertions. Do not remove checks for Tronscan links, projection mode, projection gaps, allocation copy, or semantic node helpers.

- [ ] **Step 4: Run admin shell tests and verify they fail**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts -t "admin console shell|serves admin console shell"
```

Expected: FAIL on missing graph-first shell strings.

- [ ] **Step 5: Commit the failing tests**

```bash
git add tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "test: cover graph-first admin shell"
```

---

### Task 2: Replace Permanent Columns With Graph-First Shell

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Replace the page structure**

In `src/admin/adminConsole.ts`, replace the current `<section class="content">...</section>` shell with this structure. Keep existing child ids where possible so current JavaScript can still find them:

```html
<section class="content graph-first-content" data-graph-first-shell>
  <section class="graph-workspace">
    <div class="graph-topbar">
      <div class="graph-job-summary" id="activeJobSummary">
        <span class="chip">no job selected</span>
      </div>
      <div class="graph-search-wrap">
        <input id="graphSearch" placeholder="find node / tx / label / service">
      </div>
      <div id="graphStats" class="graph-meta"></div>
    </div>

    <div class="graph-action-row">
      <button id="toggleCaseBrief" class="primary-action" type="button">Case brief</button>
      <button id="toggleJobs" type="button">Jobs</button>
      <select id="flowMode" title="Flow">
        <option value="all">Flow all</option>
        <option value="incoming">Flow in</option>
        <option value="outgoing">Flow out</option>
        <option value="self">Flow self/context</option>
      </select>
      <select id="amountMode">
        <option value="important">Amounts: important</option>
        <option value="all">Amounts: all</option>
        <option value="off">Amounts: off</option>
      </select>
      <button id="servicesMode" type="button">Services on</button>
      <button id="groupSmallWallets" type="button">Group small wallets</button>
    </div>

    <aside class="overlay-panel case-brief-panel open" data-overlay="case-brief" id="caseBriefPanel">
      <div class="overlay-head">
        <strong>Case brief</strong>
        <button id="closeCaseBrief" type="button" title="Close case brief">×</button>
      </div>
      <div id="caseBrief" class="overlay-body empty">Select a completed or partial job.</div>
    </aside>

    <aside class="overlay-panel jobs-panel" data-overlay="jobs" id="jobsPanel">
      <div class="overlay-head">
        <strong>Jobs</strong>
        <button id="closeJobs" type="button" title="Close jobs">×</button>
      </div>
      <div class="section-head compact-section-head">
        <div class="filters">
          <select id="status">
            <option value="">all statuses</option>
            <option value="completed">completed</option>
            <option value="partial">partial</option>
            <option value="failed">failed</option>
            <option value="running">running</option>
            <option value="queued">queued</option>
            <option value="cancelled">cancelled</option>
          </select>
          <select id="kind">
            <option value="">all kinds</option>
            <option value="address_fast_check">address fast</option>
            <option value="where_is_money_check">where-is-money</option>
            <option value="address_deep_check">address deep</option>
            <option value="incoming_deposit_check">incoming deposit</option>
          </select>
          <input id="subject" class="wide" placeholder="job id / address / tx hash / watched wallet">
          <select id="limit">
            <option value="20">20 latest</option>
            <option value="50" selected>50 latest</option>
            <option value="100">100 latest</option>
          </select>
          <button id="refresh" type="button">Refresh</button>
        </div>
        <div class="toolbar-row">
          <button id="autoRefresh" type="button">Auto off</button>
          <button id="clearFilters" type="button">Clear</button>
        </div>
      </div>
      <div id="jobs" class="job-list"></div>
    </aside>

    <div class="graph-tool-rail" aria-label="Graph tools">
      <button id="toolFitGraph" type="button" title="Fit graph">Fit</button>
      <button id="zoomIn" class="icon-btn" type="button" title="Zoom in">+</button>
      <button id="zoomOut" class="icon-btn" type="button" title="Zoom out">-</button>
      <button id="toolToggleLabels" type="button" title="Toggle labels">Labels</button>
      <button id="toolResetView" type="button" title="Reset view">Reset</button>
      <button id="clearSelection" type="button" title="Clear selection">Clear</button>
    </div>

    <svg id="graph" role="img" aria-label="Forensics graph"></svg>

    <section class="timeline-panel">
      <div class="timeline-head">
        <strong>Activity timeline</strong>
        <span id="timelineHint" class="muted">Select a graph to inspect activity.</span>
        <button id="toggleTransfers" type="button">Transfers</button>
      </div>
      <div id="activityTimeline" class="activity-timeline"></div>
    </section>

    <section class="transfer-panel collapsed" data-transfer-drawer>
      <div class="tabbar">
        <button id="tabAll" class="active" type="button">All transfers</button>
        <button id="tabSelected" type="button">Selected path</button>
        <button id="tabStops" type="button">Boundary stops</button>
      </div>
      <div id="transferTable" class="transfer-table"></div>
    </section>
  </section>
</section>
```

- [ ] **Step 2: Replace layout CSS**

In the `<style>` block, replace the `.content`, `.jobs`, `.details`, `.workspace`, `.canvas-wrap`, `.canvas-toolbar`, and `.transfer-panel` layout rules with graph-first rules:

```css
.content.graph-first-content {
  min-height: 0;
  display: block;
}
.graph-workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: calc(100dvh - 56px);
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 42%, rgba(81, 100, 143, .15), transparent 24%),
    radial-gradient(circle at 28% 54%, rgba(70, 188, 127, .08), transparent 24%),
    radial-gradient(circle at 72% 54%, rgba(230, 72, 87, .09), transparent 24%),
    #070a0f;
}
.graph-topbar {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(240px, 420px) auto;
  gap: 10px;
  align-items: center;
  pointer-events: none;
}
.graph-topbar > * { pointer-events: auto; }
.graph-job-summary { display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
.graph-search-wrap input { width: 100%; }
.graph-action-row {
  position: absolute;
  top: 62px;
  left: 12px;
  z-index: 5;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.primary-action { background: #1474d4; border-color: #1b8cff; }
.overlay-panel {
  position: absolute;
  z-index: 6;
  top: 112px;
  left: 12px;
  width: min(390px, calc(100% - 24px));
  max-height: calc(100dvh - 230px);
  display: none;
  overflow: hidden;
  border: 1px solid #28364a;
  border-radius: 8px;
  background: rgba(12, 17, 25, .94);
  box-shadow: 0 18px 54px rgba(0, 0, 0, .42);
}
.overlay-panel.open { display: grid; grid-template-rows: auto minmax(0, 1fr); }
.jobs-panel { width: min(390px, calc(100% - 24px)); }
.overlay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.overlay-head button { min-width: 32px; padding: 5px 8px; }
.overlay-body { min-height: 0; overflow: auto; padding: 12px; }
.compact-section-head { position: static; padding: 12px; }
.graph-tool-rail {
  position: absolute;
  right: 12px;
  top: 112px;
  z-index: 5;
  display: grid;
  gap: 6px;
  width: 58px;
  padding: 6px;
  border: 1px solid #28364a;
  border-radius: 8px;
  background: rgba(12, 17, 25, .9);
}
.graph-tool-rail button { padding: 7px 6px; font-size: 12px; }
svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}
.timeline-panel {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  min-height: 72px;
  border: 1px solid #25364e;
  border-radius: 8px;
  background: rgba(10, 18, 31, .94);
  overflow: hidden;
}
.timeline-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px 5px;
  font-size: 12px;
}
.timeline-head button { margin-left: auto; padding: 6px 9px; }
.activity-timeline {
  height: 35px;
  display: flex;
  align-items: end;
  gap: 3px;
  padding: 0 12px 8px;
}
.timeline-bar {
  flex: 1;
  min-width: 6px;
  max-width: 26px;
  border: 0;
  border-radius: 2px 2px 0 0;
  background: #1479d6;
  opacity: .84;
}
.timeline-bar:hover, .timeline-bar.active { opacity: 1; background: #23a1ff; }
.transfer-panel {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 92px;
  z-index: 7;
  height: min(42dvh, 390px);
  border: 1px solid #25364e;
  border-radius: 8px;
  background: #11161b;
  overflow: hidden;
  box-shadow: 0 18px 54px rgba(0, 0, 0, .45);
}
.transfer-panel.collapsed { display: none; }
@media (max-width: 1180px) {
  body { overflow: hidden; }
  .shell { height: 100dvh; }
  .graph-workspace { height: calc(100dvh - 92px); }
  .graph-topbar { grid-template-columns: 1fr; }
  .graph-action-row { top: 122px; right: 72px; }
  .overlay-panel { top: 184px; }
}
```

- [ ] **Step 3: Add overlay and drawer state**

In the inline `state` object, add:

```js
caseBriefOpen: true,
jobsOpen: false,
transfersOpen: false,
flowMode: localStorage.getItem("adminForensicsFlowMode") || "all",
servicesVisible: localStorage.getItem("adminForensicsServices") !== "off",
groupSmallWallets: localStorage.getItem("adminForensicsGroupSmallWallets") !== "off"
```

Add these helper functions near `setTransferTab`:

```js
function setOverlay(name, open) {
  if (name === "case-brief") state.caseBriefOpen = open;
  if (name === "jobs") state.jobsOpen = open;
  el("caseBriefPanel").classList.toggle("open", state.caseBriefOpen);
  el("jobsPanel").classList.toggle("open", state.jobsOpen);
}
function setTransferDrawer(open) {
  state.transfersOpen = open;
  document.querySelector("[data-transfer-drawer]")?.classList.toggle("collapsed", !open);
  el("toggleTransfers").textContent = open ? "Hide transfers" : "Transfers";
}
function syncGraphFirstControls() {
  el("flowMode").value = state.flowMode;
  el("servicesMode").classList.toggle("active", state.servicesVisible);
  el("servicesMode").textContent = state.servicesVisible ? "Services on" : "Services off";
  el("groupSmallWallets").classList.toggle("active", state.groupSmallWallets);
  el("groupSmallWallets").textContent = state.groupSmallWallets ? "Grouped" : "Ungrouped";
  el("toolToggleLabels").classList.toggle("active", state.labels);
  el("toolToggleLabels").textContent = state.labels ? "Labels" : "No labels";
}
```

- [ ] **Step 4: Wire graph-first controls**

At the bottom where existing event listeners are registered, add or replace listeners:

```js
el("toggleCaseBrief").addEventListener("click", () => setOverlay("case-brief", !state.caseBriefOpen));
el("closeCaseBrief").addEventListener("click", () => setOverlay("case-brief", false));
el("toggleJobs").addEventListener("click", () => setOverlay("jobs", !state.jobsOpen));
el("closeJobs").addEventListener("click", () => setOverlay("jobs", false));
el("toggleTransfers").addEventListener("click", () => setTransferDrawer(!state.transfersOpen));
el("toolFitGraph").addEventListener("click", fitGraph);
el("toolResetView").addEventListener("click", () => {
  state.transform = { x: 0, y: 0, scale: 1 };
  fitGraph();
});
el("toolToggleLabels").addEventListener("click", () => {
  state.labels = !state.labels;
  localStorage.setItem("adminForensicsLabels", state.labels ? "on" : "off");
  syncGraphFirstControls();
  renderGraph();
});
el("flowMode").addEventListener("change", () => {
  state.flowMode = el("flowMode").value;
  localStorage.setItem("adminForensicsFlowMode", state.flowMode);
  renderGraph();
  renderActivityTimeline();
  renderTransferTabs();
});
el("servicesMode").addEventListener("click", () => {
  state.servicesVisible = !state.servicesVisible;
  localStorage.setItem("adminForensicsServices", state.servicesVisible ? "on" : "off");
  syncGraphFirstControls();
  renderGraph();
});
el("groupSmallWallets").addEventListener("click", () => {
  state.groupSmallWallets = !state.groupSmallWallets;
  localStorage.setItem("adminForensicsGroupSmallWallets", state.groupSmallWallets ? "on" : "off");
  syncGraphFirstControls();
  renderGraph();
});
```

Keep existing `zoomIn`, `zoomOut`, `clearSelection`, tab, load, refresh, and filter listeners unless their ids changed.

- [ ] **Step 5: Update rendering calls**

In `loadGraph`, after `renderGraph();`, call:

```js
renderCaseBrief();
renderActivityTimeline();
```

In `loadJobs`, after `renderGraph();`, call:

```js
renderCaseBrief();
renderActivityTimeline();
syncGraphFirstControls();
```

Add minimal first-pass helpers so tests pass before deeper work:

```js
function renderCaseBrief() {
  const root = el("caseBrief");
  if (!state.graph) {
    root.className = "overlay-body empty";
    root.innerHTML = "Select a completed or partial job.";
    return;
  }
  root.className = "overlay-body";
  const summary = graphSummary(state.graph);
  root.innerHTML = '<div class="metric-grid">' +
    metric("Subject", graphSubject(state.graph).address || "unknown", "wide") +
    metric("Status", state.graph.job?.status || "unknown") +
    metric("Mode", projectionMode(state.graph)) +
    metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
    listMetric("Projection gaps", projectionGapLines(state.graph), "No projection gaps stored.") +
    '</div>';
}
function renderActivityTimeline() {
  const root = el("activityTimeline");
  if (!state.graph) {
    root.innerHTML = "";
    el("timelineHint").textContent = "Select a graph to inspect activity.";
    return;
  }
  const edges = filteredTransferEdges();
  el("timelineHint").textContent = edges.length + " edge(s)";
  root.innerHTML = edges.slice(0, 32).map((edge) => {
    const value = Number(edge.amountRaw || edge.amount || 1);
    const height = Math.max(6, Math.min(30, Math.round(Math.log10(Math.max(1, value)) * 5)));
    return '<button class="timeline-bar" type="button" title="' + escapeHtml(edgeTime(edge) || "time n/a") + '" style="height:' + height + 'px"></button>';
  }).join("") || '<span class="muted">No timeline data.</span>';
}
```

- [ ] **Step 6: Run shell tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts -t "admin console shell|graph-first"
```

Expected: PASS for the shell tests. If unrelated admin server tests fail because old strings no longer exist, update only the shell assertion test to match the new layout while preserving security/API checks.

- [ ] **Step 7: Commit graph-first shell**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "feat: add graph-first admin shell"
```

---

### Task 3: Add Flow Filtering And Semantic Edge Helpers

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing tests for graph flow helpers**

Append to `tests/admin/adminConsole.test.ts`:

```ts
  it("contains semantic flow filtering helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeFlowDirection");
    expect(html).toContain("function edgePassesFlowFilter");
    expect(html).toContain("function filteredGraphEdges");
    expect(html).toContain("function filteredTransferEdges");
    expect(html).toContain('metadata?.direction === "inbound"');
    expect(html).toContain('metadata?.direction === "outbound"');
    expect(html).toContain('state.flowMode === "incoming"');
    expect(html).toContain('state.flowMode === "outgoing"');
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "semantic flow filtering"
```

Expected: FAIL because the helper names are not present.

- [ ] **Step 3: Add flow helper functions**

In `src/admin/adminConsole.ts`, near `edgeDisplayRole`, add:

```js
function edgeFlowDirection(edge) {
  const direction = edge?.metadata?.direction || edge?.direction || "";
  if (direction === "inbound" || direction === "incoming") return "incoming";
  if (direction === "outbound" || direction === "outgoing") return "outgoing";
  const subjectId = graphNodes(state.graph).find((node) => node.kind === "subject")?.id || "";
  if (subjectId && edge?.toNodeId === subjectId) return "incoming";
  if (subjectId && edge?.fromNodeId === subjectId) return "outgoing";
  return "self";
}
function edgePassesFlowFilter(edge) {
  if (state.flowMode === "all") return true;
  return edgeFlowDirection(edge) === state.flowMode;
}
function nodeIsServiceLike(node) {
  const kind = nodeDisplayKind(node);
  return kind === "bridge" ||
    kind === "cex" ||
    kind === "smart_contract" ||
    kind === "contract_adapter" ||
    kind === "contract_router" ||
    kind === "dex_contract" ||
    kind === "service_boundary";
}
function edgePassesServiceFilter(edge) {
  if (state.servicesVisible) return true;
  const from = nodeById(edge?.fromNodeId);
  const to = nodeById(edge?.toNodeId);
  return !nodeIsServiceLike(from) && !nodeIsServiceLike(to);
}
function filteredGraphEdges() {
  return graphEdges(state.graph).filter((edge) => edgePassesFlowFilter(edge) && edgePassesServiceFilter(edge));
}
function filteredTransferEdges() {
  return transferEdges().filter((edge) => edgePassesFlowFilter(edge) && edgePassesServiceFilter(edge));
}
```

- [ ] **Step 4: Use filtered edges in graph and tables**

In `renderGraph`, replace:

```js
const edgeSvg = graphEdges(graph).map((edge) => {
```

with:

```js
const visibleEdges = filteredGraphEdges();
const edgeSvg = visibleEdges.map((edge) => {
```

In graph stats, change the edge count line to:

```js
["edges", visibleEdges.length],
```

In `renderTransferTabs`, replace the all-transfer source:

```js
: transferEdges();
```

with:

```js
: filteredTransferEdges();
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "semantic flow filtering"
```

Expected: PASS.

- [ ] **Step 6: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit flow filtering**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: filter admin graph flows"
```

---

### Task 4: Replace Layer Layout With Graph-First Cluster Layout

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing layout contract test**

Append to `tests/admin/adminConsole.test.ts`:

```ts
  it("contains deterministic graph-first cluster layout helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphFirstLayout");
    expect(html).toContain("function nodeLayoutSide");
    expect(html).toContain("function arrangeCluster");
    expect(html).toContain("incomingNodes");
    expect(html).toContain("outgoingNodes");
    expect(html).toContain("serviceNodes");
    expect(html).toContain("subjectX");
    expect(html).toContain("subjectY");
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "cluster layout"
```

Expected: FAIL because the new layout helper names are not present.

- [ ] **Step 3: Add deterministic cluster layout helpers**

In `src/admin/adminConsole.ts`, replace the current `layout(graph)` function with:

```js
function nodeLayoutSide(node, subjectId, edges) {
  if (node.id === subjectId) return "subject";
  if (nodeIsServiceLike(node)) return "service";
  const incoming = edges.some((edge) => edge.toNodeId === subjectId && edge.fromNodeId === node.id);
  const outgoing = edges.some((edge) => edge.fromNodeId === subjectId && edge.toNodeId === node.id);
  if (incoming && !outgoing) return "incoming";
  if (outgoing && !incoming) return "outgoing";
  if (incoming && outgoing) return "self";
  return "context";
}
function stableNodeSort(a, b) {
  const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);
  const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);
  if (bWeight !== aWeight) return bWeight - aWeight;
  return String(a.id).localeCompare(String(b.id));
}
function arrangeCluster(nodes, centerX, centerY, radiusX, radiusY, startAngle, endAngle) {
  const sorted = [...nodes].sort(stableNodeSort);
  const count = Math.max(1, sorted.length);
  return sorted.map((node, index) => {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    const angle = startAngle + (endAngle - startAngle) * ratio;
    const ring = 1 + (index % 3) * 0.13;
    return {
      ...node,
      x: centerX + Math.cos(angle) * radiusX * ring,
      y: centerY + Math.sin(angle) * radiusY * ring
    };
  });
}
function graphFirstLayout(graph) {
  const width = 1500;
  const height = 940;
  const sourceNodes = graphNodes(graph);
  const sourceEdges = filteredGraphEdges();
  if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
  const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
  const subjectX = width * 0.52;
  const subjectY = height * 0.47;
  const subject = sourceNodes.find((node) => node.id === subjectId) || sourceNodes[0];
  const incomingNodes = [];
  const outgoingNodes = [];
  const serviceNodes = [];
  const contextNodes = [];
  sourceNodes.forEach((node) => {
    if (node.id === subjectId) return;
    const side = nodeLayoutSide(node, subjectId, sourceEdges);
    if (side === "incoming") incomingNodes.push(node);
    else if (side === "outgoing") outgoingNodes.push(node);
    else if (side === "service") serviceNodes.push(node);
    else contextNodes.push(node);
  });
  const nodes = [
    { ...subject, x: subjectX, y: subjectY },
    ...arrangeCluster(incomingNodes, width * 0.28, subjectY, 250, 320, -1.32, 1.36),
    ...arrangeCluster(outgoingNodes, width * 0.78, subjectY, 270, 335, -1.72, 1.62),
    ...arrangeCluster(serviceNodes, width * 0.55, subjectY + 90, 420, 210, -2.72, .35),
    ...arrangeCluster(contextNodes, width * 0.52, subjectY + 230, 360, 180, -2.82, -.32)
  ];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { width, height, nodes, byId };
}
function layout(graph) {
  return graphFirstLayout(graph);
}
```

- [ ] **Step 4: Run layout test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "cluster layout"
```

Expected: PASS.

- [ ] **Step 5: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit graph-first layout**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: arrange admin graph as flow clusters"
```

---

### Task 5: Improve Edge Rendering And Node Visual Classes

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing visual-role test**

Append to `tests/admin/adminConsole.test.ts`:

```ts
  it("contains semantic edge and node visual helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeVisualRole");
    expect(html).toContain("function edgeStrokeWidth");
    expect(html).toContain("function edgeCurvePath");
    expect(html).toContain("function nodeVisualClass");
    expect(html).toContain('edge-flow-incoming');
    expect(html).toContain('edge-flow-outgoing');
    expect(html).toContain('edge-flow-context');
    expect(html).toContain('node-display-cex');
    expect(html).toContain('node-display-bridge');
  });
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "semantic edge and node visual"
```

Expected: FAIL because the new visual helpers/classes are missing.

- [ ] **Step 3: Add graph visual CSS**

Add these CSS rules near the current `.edge` and `.node` rules:

```css
.edge {
  fill: none;
  opacity: .88;
  cursor: pointer;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
}
.edge-flow-incoming { stroke: #62d28f; }
.edge-flow-outgoing { stroke: #ff5966; }
.edge-flow-context { stroke: #8d97a8; stroke-dasharray: 7 9; opacity: .52; }
.edge-flow-service { stroke: #ffd36b; }
.edge-flow-stop { stroke: #f6c177; stroke-dasharray: 4 7; }
.edge.dim, .node.dim { opacity: .16; }
.edge.selected { opacity: 1; filter: drop-shadow(0 0 8px rgba(122, 162, 247, .42)); }
.node circle { fill: #303846; stroke-width: 2.2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 8px 8px rgba(0, 0, 0, .36)); }
.node-display-subject_wallet circle { fill: #171f31; stroke: var(--accent); stroke-width: 3.4; }
.node-display-wallet circle { fill: #303846; stroke: #788394; }
.node-display-cex circle { fill: #473131; stroke: var(--cex); }
.node-display-bridge circle { fill: #133c72; stroke: #5aa7ff; }
.node-display-smart_contract circle,
.node-display-contract_adapter circle,
.node-display-contract_router circle,
.node-display-dex_contract circle { fill: #312845; stroke: var(--contract); }
.node-display-service_boundary circle { fill: #3d3422; stroke: var(--warn); }
.node-display-trace_stop circle { fill: #3d3422; stroke: var(--warn); stroke-dasharray: 4 5; }
.node-display-funding_bundle circle { fill: #322843; stroke: var(--bundle); }
.service-glyph { fill: #fff; font-size: 12px; font-weight: 800; pointer-events: none; }
```

- [ ] **Step 4: Add visual helper functions**

Near `canvasNodeLabel`, add:

```js
function edgeVisualRole(edge) {
  const role = edgeDisplayRole(edge);
  if (role === "stop") return "stop";
  if (role === "profile_context" || role === "inferred_provenance") return "context";
  const from = nodeById(edge?.fromNodeId);
  const to = nodeById(edge?.toNodeId);
  if (nodeIsServiceLike(from) || nodeIsServiceLike(to)) return "service";
  return edgeFlowDirection(edge);
}
function edgeStrokeWidth(edge) {
  const raw = Number(edge?.amountRaw || edge?.metadata?.amountRaw || edge?.weight || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 1.6;
  const scaled = Math.log10(raw + 10) * 0.7;
  return Math.max(1.4, Math.min(8, scaled));
}
function edgeCurvePath(startX, startY, endX, endY, edge) {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const curve = edgeFlowDirection(edge) === "incoming" ? -0.18 : 0.18;
  const cx = (startX + endX) / 2 - dy * curve;
  const cy = (startY + endY) / 2 + dx * curve;
  if (distance < 80) return "M " + startX + " " + startY + " L " + endX + " " + endY;
  return "M " + startX + " " + startY + " Q " + cx + " " + cy + " " + endX + " " + endY;
}
function nodeVisualClass(node) {
  return "node-display-" + nodeDisplayKind(node);
}
function serviceGlyph(node) {
  const kind = nodeDisplayKind(node);
  if (kind === "bridge") return "↔";
  if (kind === "cex") return "CEX";
  if (kind === "dex_contract") return "DEX";
  if (kind === "contract_router") return "R";
  if (kind === "contract_adapter") return "A";
  if (kind === "smart_contract") return "{}";
  return "";
}
```

- [ ] **Step 5: Use visual helpers inside `renderGraph`**

In `renderGraph`, when building each edge:

1. Replace the old edge class line with:

```js
const visualRole = edgeVisualRole(edge);
const cls = "edge edge-flow-" + escapeHtml(visualRole) + " " + escapeHtml(edge.verdict) + (selected ? " selected" : "") + (visible ? "" : " dim");
```

2. Replace the path `d` value with:

```js
const pathD = edgeCurvePath(startX, startY, endX, endY, edge);
```

3. Replace the path element with:

```js
'<path class="' + cls + '" style="stroke-width:' + edgeStrokeWidth(edge) + '" d="' + pathD + '"' + marker + '></path>'
```

When building each node, replace the class construction with:

```js
const cls = "node node-kind-" + escapeHtml(node.kind || "wallet") + " " + escapeHtml(nodeVisualClass(node)) + (selected ? " selected" : "") + (visible ? "" : " dim");
const glyph = serviceGlyph(node);
```

Add glyph text before the label:

```js
(glyph ? '<text class="service-glyph" y="4" text-anchor="middle">' + escapeHtml(glyph) + '</text>' : '') +
```

- [ ] **Step 6: Run visual helper test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "semantic edge and node visual"
```

Expected: PASS.

- [ ] **Step 7: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit graph visual polish**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: improve admin graph visual semantics"
```

---

### Task 6: Build Case Brief Content

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing case brief test**

Append to `tests/admin/adminConsole.test.ts`:

```ts
  it("contains case brief summary helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function caseBriefTopIncoming");
    expect(html).toContain("function caseBriefTopOutgoing");
    expect(html).toContain("function caseBriefTopServices");
    expect(html).toContain("Top incoming");
    expect(html).toContain("Top outgoing");
    expect(html).toContain("Top services");
    expect(html).toContain("Boundary stops");
    expect(html).toContain("Profile/context graph");
  });
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "case brief summary"
```

Expected: FAIL because summary helpers and copy do not exist.

- [ ] **Step 3: Add case brief helper functions**

Near `renderCaseBrief`, add:

```js
function formatBriefEdge(edge) {
  const amount = edgeCanvasAmountLabel(edge) || edgeDetailedAmountLabel(edge) || "amount n/a";
  const address = edgeFlowDirection(edge) === "incoming" ? edgeFromAddress(edge) : edgeToAddress(edge);
  return amount + " · " + short(address, 7);
}
function caseBriefTopIncoming() {
  return filteredTransferEdges()
    .filter((edge) => edgeFlowDirection(edge) === "incoming")
    .sort((a, b) => Number(b.amountRaw || 0) - Number(a.amountRaw || 0))
    .slice(0, 5)
    .map(formatBriefEdge);
}
function caseBriefTopOutgoing() {
  return filteredTransferEdges()
    .filter((edge) => edgeFlowDirection(edge) === "outgoing")
    .sort((a, b) => Number(b.amountRaw || 0) - Number(a.amountRaw || 0))
    .slice(0, 5)
    .map(formatBriefEdge);
}
function caseBriefTopServices() {
  return graphNodes(state.graph)
    .filter(nodeIsServiceLike)
    .slice(0, 8)
    .map((node) => canvasNodeLabel(node) + " · " + short(nodeAddress(node) || node.id, 6));
}
function caseBriefStopCount() {
  return graphPaths(state.graph).filter((path) => path.stopReason).length;
}
function caseBriefModeLine(graph) {
  if (graph?.job?.kind === "address_deep_check") return "Profile/context graph. This is not money-origin proof.";
  if (graph?.job?.kind === "where_is_money_check") return "Money-origin trace.";
  if (graph?.job?.kind === "incoming_deposit_check") return "Deposit-origin trace.";
  if (graph?.job?.kind === "address_fast_check") return "Fast direct-neighborhood profile.";
  return projectionMode(graph);
}
```

- [ ] **Step 4: Replace `renderCaseBrief` body**

Replace `renderCaseBrief` with:

```js
function renderCaseBrief() {
  const root = el("caseBrief");
  if (!state.graph) {
    root.className = "overlay-body empty";
    root.innerHTML = "Select a completed or partial job.";
    return;
  }
  root.className = "overlay-body";
  const graph = state.graph;
  const summary = graphSummary(graph);
  const activeJob = state.jobs.find((job) => job.id === state.activeJobId) || graph.job;
  root.innerHTML = '<div class="metric-grid">' +
    metric("Subject", graphSubject(graph).address || "unknown", "wide") +
    metric("Job", (graph.job?.kind || activeJob?.kind || "unknown") + " / " + (graph.job?.status || activeJob?.status || "unknown"), "wide") +
    metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
    metric("Decision", summary.decision || "UNKNOWN") +
    metric("Mode", caseBriefModeLine(graph), "wide") +
    listMetric("Top incoming", caseBriefTopIncoming(), "No incoming profile edges.") +
    listMetric("Top outgoing", caseBriefTopOutgoing(), "No outgoing profile edges.") +
    listMetric("Top services", caseBriefTopServices(), "No service nodes.") +
    metric("Boundary stops", String(caseBriefStopCount())) +
    listMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
    '</div>';
}
```

- [ ] **Step 5: Run case brief test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "case brief summary"
```

Expected: PASS.

- [ ] **Step 6: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit case brief**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add admin graph case brief"
```

---

### Task 7: Implement Timeline Buckets And Transfer Drawer

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing timeline test**

Append to `tests/admin/adminConsole.test.ts`:

```ts
  it("contains activity timeline bucket helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeTimestampMs");
    expect(html).toContain("function activityTimelineBuckets");
    expect(html).toContain("function selectTimelineBucket");
    expect(html).toContain("state.timelineRange");
    expect(html).toContain("timeline-bar");
    expect(html).toContain("data-timeline-index");
  });
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "activity timeline"
```

Expected: FAIL because timeline bucket helpers are missing.

- [ ] **Step 3: Add timeline state**

In `state`, add:

```js
timelineRange: null
```

- [ ] **Step 4: Add timeline helpers**

Replace the first-pass `renderActivityTimeline` with these helpers:

```js
function edgeTimestampMs(edge) {
  const value = edge?.timestamp || edge?.timestampIso || edge?.time || edge?.metadata?.timestamp;
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}
function activityTimelineBuckets(edges, bucketCount = 32) {
  const dated = edges
    .map((edge) => ({ edge, timestamp: edgeTimestampMs(edge) }))
    .filter((item) => item.timestamp !== null);
  if (dated.length === 0) return [];
  const min = Math.min(...dated.map((item) => item.timestamp));
  const max = Math.max(...dated.map((item) => item.timestamp));
  const span = Math.max(1, max - min);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    start: min + span * index / bucketCount,
    end: min + span * (index + 1) / bucketCount,
    count: 0,
    amount: 0
  }));
  dated.forEach((item) => {
    const index = Math.min(bucketCount - 1, Math.floor(((item.timestamp - min) / span) * bucketCount));
    const bucket = buckets[index];
    bucket.count += 1;
    bucket.amount += Number(item.edge.amountRaw || item.edge.metadata?.amountRaw || 0);
  });
  return buckets;
}
function edgePassesTimelineRange(edge) {
  if (!state.timelineRange) return true;
  const timestamp = edgeTimestampMs(edge);
  if (timestamp === null) return true;
  return timestamp >= state.timelineRange.start && timestamp <= state.timelineRange.end;
}
function selectTimelineBucket(index) {
  const buckets = activityTimelineBuckets(filteredTransferEdges());
  const bucket = buckets[index];
  state.timelineRange = bucket ? { start: bucket.start, end: bucket.end, index } : null;
  renderGraph();
  renderActivityTimeline();
  renderTransferTabs();
}
function renderActivityTimeline() {
  const root = el("activityTimeline");
  if (!state.graph) {
    root.innerHTML = "";
    el("timelineHint").textContent = "Select a graph to inspect activity.";
    return;
  }
  const buckets = activityTimelineBuckets(filteredTransferEdges());
  if (buckets.length === 0) {
    root.innerHTML = '<span class="muted">No timestamped activity.</span>';
    el("timelineHint").textContent = "No timestamped activity.";
    return;
  }
  const maxAmount = Math.max(1, ...buckets.map((bucket) => bucket.amount || bucket.count));
  const activeIndex = state.timelineRange?.index;
  el("timelineHint").textContent = state.timelineRange ? "Filtered to selected timeline bucket." : "Click a bar to filter graph and table.";
  root.innerHTML = buckets.map((bucket) => {
    const value = bucket.amount || bucket.count;
    const height = Math.max(6, Math.round((value / maxAmount) * 30));
    const active = activeIndex === bucket.index ? " active" : "";
    return '<button class="timeline-bar' + active + '" data-timeline-index="' + bucket.index + '" type="button" title="' + escapeHtml(new Date(bucket.start).toISOString()) + '" style="height:' + height + 'px"></button>';
  }).join("");
  root.querySelectorAll("[data-timeline-index]").forEach((button) => {
    button.addEventListener("click", () => selectTimelineBucket(Number(button.getAttribute("data-timeline-index"))));
  });
}
```

- [ ] **Step 5: Apply timeline filter to edge lists**

In `filteredGraphEdges`, add the timeline predicate:

```js
return graphEdges(state.graph).filter((edge) =>
  edgePassesFlowFilter(edge) &&
  edgePassesServiceFilter(edge) &&
  edgePassesTimelineRange(edge)
);
```

In `filteredTransferEdges`, add the same predicate.

- [ ] **Step 6: Add clear timeline behavior**

In `loadGraph`, reset timeline state:

```js
state.timelineRange = null;
```

In `flowMode`, `servicesMode`, and `groupSmallWallets` event handlers, also set:

```js
state.timelineRange = null;
```

- [ ] **Step 7: Run timeline test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "activity timeline"
```

Expected: PASS.

- [ ] **Step 8: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit timeline and drawer**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add admin graph activity timeline"
```

---

### Task 8: Update Selection Details For Graph-First Cards

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing selection-card test**

Append to `tests/admin/adminConsole.test.ts`:

```ts
  it("contains graph-first selected node and flow cards", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function renderSelectionCard");
    expect(html).toContain("function selectedNodeCard");
    expect(html).toContain("function selectedEdgeCard");
    expect(html).toContain("Selected flow");
    expect(html).toContain("Selected node");
    expect(html).toContain("Meaning");
    expect(html).toContain("This is not money-origin proof");
  });
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "selected node and flow"
```

Expected: FAIL because selected graph-first cards do not exist.

- [ ] **Step 3: Add selection card container to shell**

In the graph workspace HTML, after `caseBriefPanel`, add:

```html
<aside class="selection-card" id="selectionCard"></aside>
```

Add CSS:

```css
.selection-card {
  position: absolute;
  right: 82px;
  top: 112px;
  z-index: 6;
  width: min(360px, calc(100% - 106px));
  display: none;
  border: 1px solid #28364a;
  border-radius: 8px;
  background: rgba(12, 17, 25, .94);
  box-shadow: 0 18px 54px rgba(0, 0, 0, .42);
  padding: 12px;
}
.selection-card.open { display: block; }
.selection-card h3 { margin: 0 0 8px; font-size: 14px; }
.selection-card .card-line { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid rgba(42, 48, 54, .7); font-size: 12px; }
.selection-card .card-line:first-of-type { border-top: 0; }
.selection-card .card-note { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
```

- [ ] **Step 4: Add selected card helpers**

Near `renderDetails`, add:

```js
function cardLine(label, value) {
  return '<div class="card-line"><span class="muted">' + escapeHtml(label) + '</span><strong>' + escapeHtml(value || "n/a") + '</strong></div>';
}
function selectedNodeCard(node) {
  if (!node) return "";
  const type = nodeType(node);
  return '<h3>Selected node</h3>' +
    cardLine("Type", type.label) +
    cardLine("Address", nodeAddress(node) || node.id) +
    cardLine("Label", nodeDisplayLabel(node)) +
    cardLine("Technical type", technicalNodeType(node));
}
function selectedEdgeCard(edge) {
  if (!edge) return "";
  const role = edgeDisplayRole(edge);
  const note = role === "profile_context"
    ? '<div class="card-note">This is not money-origin proof. It is behavioral/service exposure context.</div>'
    : "";
  return '<h3>Selected flow</h3>' +
    cardLine("Meaning", edgeMeaning(edge)) +
    cardLine("Direction", edgeDirectionMeaning(edge)) +
    cardLine("Amount", edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge)) +
    cardLine("From", edgeFromAddress(edge)) +
    cardLine("To", edgeToAddress(edge)) +
    cardLine("Tx", edge.txHash || "inferred") +
    cardLine("Path", edgePathId(edge) || "n/a") +
    note;
}
function renderSelectionCard() {
  const root = el("selectionCard");
  if (!root || !state.graph || !state.selected) {
    if (root) {
      root.classList.remove("open");
      root.innerHTML = "";
    }
    return;
  }
  root.classList.add("open");
  if (state.selected.type === "node") {
    root.innerHTML = selectedNodeCard(nodeById(state.selected.id));
    return;
  }
  if (state.selected.type === "edge") {
    root.innerHTML = selectedEdgeCard(graphEdges(state.graph).find((edge) => edge.id === state.selected.id));
    return;
  }
  root.classList.remove("open");
  root.innerHTML = "";
}
```

- [ ] **Step 5: Wire selected card rendering**

In `selectNode` and `selectEdge`, after `renderDetails();`, call:

```js
renderSelectionCard();
```

In `loadGraph`, after `renderDetails();`, call:

```js
renderSelectionCard();
```

In the clear selection handler, after clearing `state.selected`, call:

```js
renderSelectionCard();
```

- [ ] **Step 6: Run selection card test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "selected node and flow"
```

Expected: PASS.

- [ ] **Step 7: Run admin tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit selected cards**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add admin graph selection cards"
```

---

### Task 9: Full Verification And Browser QA

**Files:**
- Modify only if QA finds a bug: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`
- Test: `tests/admin/adminServer.test.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with exit code 0.

- [ ] **Step 3: Start local admin console**

Use the existing env file from the project root if needed:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\User\OneDrive\Desktop\smartcontract\.env'
$env:ADMIN_DASHBOARD_ENABLED='true'
$env:ADMIN_DASHBOARD_HOST='127.0.0.1'
$env:ADMIN_DASHBOARD_PORT='8788'
$env:ADMIN_DASHBOARD_TOKEN='local-admin-token'
node --import tsx src/index.ts
```

Expected: admin dashboard starts at `http://127.0.0.1:8788`.

- [ ] **Step 4: Browser QA on known TYDaeo job**

Open:

```text
http://127.0.0.1:8788/admin/forensics?query=TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC&limit=50
```

Manual checks:

- selected graph occupies most of the viewport;
- `Case brief` opens and closes;
- `Jobs` opens and closes;
- graph pan/zoom/fit still works;
- flow filter changes visible edges;
- services toggle hides/shows service nodes and edges;
- labels toggle hides/shows labels;
- selecting a node opens `Selected node`;
- selecting an edge opens `Selected flow`;
- profile context edges say `This is not money-origin proof`;
- timeline bars render when timestamped edges exist;
- `Transfers` opens and closes the bottom table;
- Tronscan links still open in a new tab.

- [ ] **Step 5: Browser QA on job kinds**

Open one job of each kind from the job list:

- `address_fast_check`;
- `address_deep_check`;
- `where_is_money_check`;
- `incoming_deposit_check`.

Expected:

- each job loads without JavaScript console errors;
- case brief mode text matches the job kind;
- graph stats update;
- transfer drawer remains collapsed by default;
- `where_is_money_check` keeps money-origin wording;
- `address_deep_check` keeps profile/context wording.

- [ ] **Step 6: Fix QA bugs with smallest patches**

If QA finds bugs, write a focused regression test first when practical. Use the smallest code patch that fixes the observed behavior. Do not add new dependencies.

- [ ] **Step 7: Final verification**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 8: Commit final QA fixes**

If Task 9 changed files:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix: polish admin graph-first ui"
```

If Task 9 changed no files, do not create an empty commit.

---

## Execution Order

1. Task 1 creates failing tests.
2. Task 2 lands the graph-first shell.
3. Task 3 adds flow/service filtering.
4. Task 4 replaces the layered layout with deterministic flow clusters.
5. Task 5 improves visual semantics.
6. Task 6 fills `Case brief`.
7. Task 7 adds timeline buckets and transfer drawer behavior.
8. Task 8 adds selected node/flow cards.
9. Task 9 verifies all admin graph modes in tests and browser QA.

## Self-Review Notes

- Spec coverage: all first-release scope items map to Tasks 2-9.
- Red-flag scan: no task uses unfinished-marker language.
- Type consistency: helper names introduced in tests match helper names in implementation steps.
- Scope control: no new dependencies, no Arkham code copying, no scoring/traversal changes.
