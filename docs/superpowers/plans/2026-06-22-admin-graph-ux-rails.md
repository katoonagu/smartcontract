# Admin Graph UX Rails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the admin forensic graph screen so Jobs live on the left, readable analytics live on the right, the center graph toolbar stays compact, dense graphs are easier to read, and analysts can drag nodes per job.

**Architecture:** Keep the current vanilla HTML/CSS/SVG implementation in `src/admin/adminConsole.ts`; do not add a graph library or split the whole admin console. Make small, testable edits around the existing rail panels, `renderGraph`, `graphFirstLayout`, `renderSelectionCard`, and `initPanZoom`.

**Tech Stack:** TypeScript string-rendered admin HTML, browser DOM APIs, inline SVG, localStorage, Vitest string-contract tests.

---

## File Structure

- Modify `src/admin/adminConsole.ts`
  - CSS for fixed left Jobs rail, fixed right Analytics rail, compact center toolbar, readable labels, and draggable nodes.
  - Markup for moving `selectionCard` into the right analytics rail.
  - JS helpers for full address links in detail cards.
  - JS helpers for layout collision reduction, saved node positions, reset layout, and node drag.
- Modify `tests/admin/adminConsole.test.ts`
  - Keep existing static shell tests.
  - Update old expectations that assumed `selection-card` floats over the graph.
  - Add string-contract tests for left/right rails, compact toolbar, full Tronscan detail links, shortened dense labels, layout collision helpers, and node drag helpers.
- Create no new runtime dependencies.
- Create no new production files unless `adminConsole.ts` becomes unmanageable during implementation. Default is one-file edit because the current admin console already ships as a single HTML string.

## Task 1: Left Jobs Rail, Right Analytics Rail, Compact Center Toolbar

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing shell layout test**

Replace the existing `"renders the graph-first investigation shell"` test body with this stricter version:

```ts
it("renders the graph-first investigation shell", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("data-admin-console");
  expect(html).toContain("data-graph-first-shell");
  expect(html).toContain('data-overlay="jobs"');
  expect(html).toContain('data-overlay="analytics"');
  expect(html).toContain('id="toggleJobs"');
  expect(html).toContain('id="toggleAnalytics"');
  expect(html).toContain('id="activityTimeline"');
  expect(html).toContain('id="toggleTransfers"');
  expect(html).toContain("data-transfer-drawer");
  expect(html).toContain('id="toolFitGraph"');
  expect(html).toContain('id="toolToggleLabels"');
  expect(html).toContain('id="toolResetView"');
  expect(html).toContain('id="toolResetLayout"');
  expect(html).toContain('id="flowMode"');
  expect(html).toContain('id="servicesMode"');
  expect(html).toContain("jobsOpen: true");
  expect(html).toContain("analyticsOpen: true");
  expect(html).toContain(".overlay-panel.jobs-panel { left: 12px;");
  expect(html).toContain(".overlay-panel.analytics-panel { right: 12px;");
  expect(html).toContain(".graph-action-row");
  expect(html).toContain("grid-template-columns: auto minmax(8px, 1fr) auto");
  expect(html).not.toContain('id="groupSmallWallets"');
  expect(html).not.toContain("adminForensicsGroupSmallWallets");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "renders the graph-first investigation shell"
```

Expected: FAIL because `toggleAnalytics`, `analytics-panel`, `toolResetLayout`, and the compact toolbar grid do not exist yet.

- [ ] **Step 3: Replace the graph shell CSS with fixed rails and a compact toolbar**

In `src/admin/adminConsole.ts`, update the existing CSS blocks for `.graph-workspace`, `.graph-topbar`, `.graph-action-row`, `.overlay-panel`, `.case-brief-panel`, `.jobs-panel`, `.graph-meta`, and responsive rules to this shape:

```css
    .graph-workspace {
      --left-rail-width: 330px;
      --right-rail-width: 380px;
      --rail-gap: 12px;
      position: relative;
      height: calc(100dvh - 56px);
      min-height: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 42%, rgba(122, 162, 247, .12), transparent 34%),
        linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px),
        #080b0f;
      background-size: auto, 72px 72px, 72px 72px, auto;
    }
    .graph-topbar {
      position: absolute;
      top: 12px;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      z-index: 4;
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(220px, 320px);
      gap: 10px;
      align-items: center;
      pointer-events: none;
    }
    .graph-topbar > *, .graph-action-row > *, .graph-tool-rail > *, .timeline-panel > *, .transfer-panel > *, .overlay-panel > * { pointer-events: auto; }
    .graph-action-row {
      position: absolute;
      top: 64px;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      z-index: 4;
      min-height: 40px;
      display: grid;
      grid-template-columns: auto minmax(8px, 1fr) auto;
      gap: 10px;
      align-items: center;
      pointer-events: none;
      border: 1px solid rgba(58, 67, 77, .82);
      border-radius: 8px;
      background: rgba(13, 17, 22, .86);
      box-shadow: 0 18px 45px rgba(0, 0, 0, .24);
      backdrop-filter: blur(10px);
      padding: 5px 8px;
    }
    .graph-control-group {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: nowrap;
      min-width: 0;
    }
    .graph-action-row button, .graph-action-row select {
      height: 30px;
      padding: 0 10px;
      background: rgba(12, 15, 18, .92);
      white-space: nowrap;
    }
    .graph-action-row #amountMode { width: 165px; }
    .graph-action-row #flowMode { width: 140px; }
    .graph-action-row .graph-meta {
      grid-column: 3;
      min-height: 30px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: nowrap;
      border: 0;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
    }
    .overlay-panel {
      position: absolute;
      z-index: 5;
      top: 116px;
      width: min(390px, calc(100vw - 24px));
      max-height: calc(100dvh - 132px);
      display: none;
      overflow: hidden;
      border: 1px solid rgba(58, 67, 77, .88);
      border-radius: 8px;
      background: rgba(21, 25, 29, .94);
      box-shadow: 0 22px 60px rgba(0, 0, 0, .36);
      backdrop-filter: blur(12px);
    }
    .overlay-panel.open { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .overlay-panel.jobs-panel { left: 12px; width: var(--left-rail-width); }
    .overlay-panel.analytics-panel { right: 12px; width: var(--right-rail-width); }
```

Replace the old `@media (max-width: 1180px)` panel rules with:

```css
    @media (max-width: 1180px) {
      body { overflow: auto; }
      .shell { height: auto; min-height: 100dvh; }
      .graph-workspace {
        --left-rail-width: min(330px, calc(100vw - 24px));
        --right-rail-width: min(380px, calc(100vw - 24px));
        min-height: 980px;
        height: calc(100dvh - 56px);
      }
      .graph-topbar {
        left: 12px;
        right: 12px;
        grid-template-columns: 1fr;
      }
      .graph-action-row {
        top: 128px;
        left: 12px;
        right: 12px;
        grid-template-columns: minmax(0, 1fr);
      }
      .graph-control-group { flex-wrap: wrap; }
      .graph-action-row .graph-meta {
        grid-column: 1;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      .overlay-panel { top: 224px; max-height: 360px; }
      .overlay-panel.jobs-panel { left: 12px; right: auto; }
      .overlay-panel.analytics-panel { left: 12px; right: auto; }
      .graph-tool-rail { top: 224px; }
      .topbar { grid-template-columns: 1fr; }
      .token input { width: 100%; }
    }
```

- [ ] **Step 4: Update the shell markup**

In the HTML shell:

1. Move `graphStats` out of `.graph-topbar`.
2. Rename the visible right rail from case brief to Analytics while keeping `caseBrief` as the summary section id.
3. Put `selectionCard` inside the right rail above `caseBrief`.
4. Add `toolResetLayout`.

Use this structure for the graph top and action rows:

```html
        <div class="graph-topbar">
          <div id="activeJobSummary" class="active-job-summary">
            <strong>Case brief</strong>
            <div class="hint" id="selectionHint">Select a completed or partial job.</div>
          </div>
          <input id="graphSearch" placeholder="find node / tx / label">
        </div>
        <div class="graph-action-row">
          <div class="graph-control-group">
            <button id="toggleJobs" type="button">Jobs</button>
            <button id="toggleAnalytics" type="button">Analytics</button>
            <select id="flowMode">
              <option value="all">All flows</option>
              <option value="incoming">Incoming</option>
              <option value="outgoing">Outgoing</option>
              <option value="self">Self</option>
            </select>
            <select id="amountMode">
              <option value="important">Amounts: important</option>
              <option value="all">Amounts: all</option>
              <option value="off">Amounts: off</option>
            </select>
            <button id="servicesMode" type="button">Services on</button>
            <button id="toolResetLayout" type="button">Reset layout</button>
          </div>
          <div id="graphStats" class="graph-meta"></div>
        </div>
```

Use this structure for the rails:

```html
        <aside id="jobsPanel" class="overlay-panel jobs-panel open" data-overlay="jobs">
          <div class="overlay-head">
            <h2>Jobs</h2>
            <button id="closeJobs" class="icon-btn" type="button" title="Close jobs">x</button>
          </div>
          <div class="overlay-body">
            <!-- keep existing filters and job list here -->
          </div>
        </aside>
        <aside id="caseBriefPanel" class="overlay-panel analytics-panel open" data-overlay="analytics">
          <div class="overlay-head">
            <h2>Analytics</h2>
            <button id="closeAnalytics" class="icon-btn" type="button" title="Close analytics">x</button>
          </div>
          <div class="overlay-body analytics-body">
            <div class="selection-card analytics-selection-card" id="selectionCard"></div>
            <div id="caseBrief" class="details-body empty">Select a completed or partial job.</div>
          </div>
        </aside>
```

- [ ] **Step 5: Update overlay state and control sync**

Replace `caseBriefOpen` with `analyticsOpen`, keep `jobsOpen` defaulted to true:

```js
      analyticsOpen: true,
      jobsOpen: true,
```

Update `setOverlay`:

```js
    function setOverlay(name, open) {
      if (name === "analytics") state.analyticsOpen = open;
      if (name === "jobs") state.jobsOpen = open;
      syncGraphFirstControls();
    }
```

Update `syncGraphFirstControls`:

```js
    function syncGraphFirstControls() {
      const analyticsPanel = el("caseBriefPanel");
      const jobsPanel = el("jobsPanel");
      const transferPanel = document.querySelector("[data-transfer-drawer]");
      if (analyticsPanel) analyticsPanel.classList.toggle("open", state.analyticsOpen);
      if (jobsPanel) jobsPanel.classList.toggle("open", state.jobsOpen);
      if (transferPanel) transferPanel.classList.toggle("collapsed", !state.transfersOpen);
      el("toggleAnalytics").classList.toggle("active", state.analyticsOpen);
      el("toggleJobs").classList.toggle("active", state.jobsOpen);
      el("toggleTransfers").classList.toggle("active", state.transfersOpen);
      el("toolToggleLabels").classList.toggle("active", state.labels);
      el("toolToggleLabels").textContent = state.labels ? "Aa" : "A-";
      el("toggleLabels").textContent = state.labels ? "Labels on" : "Labels off";
      el("flowMode").value = state.flowMode;
      el("servicesMode").classList.toggle("active", state.servicesVisible);
      el("servicesMode").textContent = state.servicesVisible ? "Services on" : "Services off";
    }
```

Update event listeners:

```js
    el("toggleAnalytics").addEventListener("click", () => setOverlay("analytics", !state.analyticsOpen));
    el("closeAnalytics").addEventListener("click", () => setOverlay("analytics", false));
    el("toggleJobs").addEventListener("click", () => setOverlay("jobs", !state.jobsOpen));
    el("closeJobs").addEventListener("click", () => setOverlay("jobs", false));
```

Remove the old `toggleCaseBrief`, `closeCaseBrief`, and `data-overlay="case-brief"` references.

- [ ] **Step 6: Run focused shell tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "renders the graph-first investigation shell"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Improve admin graph rails and toolbar"
```

## Task 2: Right Analytics Detail Cards And Address Display Rules

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing address display test**

Add this test to `tests/admin/adminConsole.test.ts`:

```ts
it("shows full clickable addresses in analytics details while keeping dense views shortened", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("function addressDetailLink");
  expect(html).toContain("function cardLineHtml");
  expect(html).toContain('metricHtml("Subject", addressDetailLink(subject.address || "unknown"), "wide")');
  expect(html).toContain('cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id))');
  expect(html).toContain('cardLineHtml("From", addressDetailLink(edgeFromAddress(edge) || edge.fromNodeId))');
  expect(html).toContain('cardLineHtml("To", addressDetailLink(edgeToAddress(edge) || edge.toNodeId))');
  expect(html).toContain('cardLineHtml("Tx", txDetailLink(edge.txHash || "inferred"))');
  expect(html).toContain("return amount + \" - \" + short(address, 7);");
  expect(html).toContain('explorerLink(edgeFromTronScanUrl(edge), short(edgeFromAddress(edge), 7))');
  expect(html).toContain('explorerLink(edgeToTronScanUrl(edge), short(edgeToAddress(edge), 7))');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "shows full clickable addresses"
```

Expected: FAIL because `addressDetailLink`, `txDetailLink`, and `cardLineHtml` do not exist yet.

- [ ] **Step 3: Add detail-link helpers**

Near `cardLine`, add:

```js
    function cardLineHtml(label, html) {
      return '<div class="card-line"><span class="muted">' + escapeHtml(label) + '</span><strong>' + html + '</strong></div>';
    }
    function addressDetailLink(address) {
      const value = address || "n/a";
      return explorerLink(tronscanAddressUrl(value), value);
    }
    function txDetailLink(txHash) {
      const value = txHash || "inferred";
      return explorerLink(tronscanTxUrl(value === "inferred" ? "" : value), value);
    }
```

- [ ] **Step 4: Use full address links in the analytics summary**

In `renderCaseBrief`, replace the subject metric:

```js
        metric("Subject", subject.address || "unknown", "wide") +
```

with:

```js
        metricHtml("Subject", addressDetailLink(subject.address || "unknown"), "wide") +
```

- [ ] **Step 5: Use full address links in selected node cards**

Replace `selectedNodeCard` with:

```js
    function selectedNodeCard(node) {
      if (!node) return "";
      const type = nodeType(node);
      return '<h3>Selected node</h3>' +
        cardLine("Type", type.label) +
        cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id)) +
        cardLine("Label", nodeDisplayLabel(node)) +
        cardLine("Technical type", technicalNodeType(node));
    }
```

- [ ] **Step 6: Use full address and tx links in selected flow cards**

Replace `selectedEdgeCard` with:

```js
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
        cardLineHtml("From", addressDetailLink(edgeFromAddress(edge) || edge.fromNodeId)) +
        cardLineHtml("To", addressDetailLink(edgeToAddress(edge) || edge.toNodeId)) +
        cardLineHtml("Tx", txDetailLink(edge.txHash || "inferred")) +
        cardLine("Path", edgePathId(edge) || "n/a") +
        note;
    }
```

- [ ] **Step 7: Run focused address tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "shows full clickable addresses"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Show full linked addresses in admin analytics"
```

## Task 3: Stable Graph Layout With Collision Reduction

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing graph layout test**

Replace the existing `"contains deterministic graph-first cluster layout helpers"` test with:

```ts
it("contains deterministic graph-first layout helpers with collision reduction", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("function graphFirstLayout");
  expect(html).toContain("function nodeLayoutSide");
  expect(html).toContain("function arrangeCluster");
  expect(html).toContain("function relaxNodeCollisions");
  expect(html).toContain("function nodeLabelAttrs");
  expect(html).toContain("incomingNodes");
  expect(html).toContain("outgoingNodes");
  expect(html).toContain("serviceNodes");
  expect(html).toContain("contextNodes");
  expect(html).toContain("const fixedNodeIds = new Set([subjectId])");
  expect(html).toContain("relaxNodeCollisions(nodes, fixedNodeIds)");
});
```

- [ ] **Step 2: Run the focused layout test to verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "deterministic graph-first layout helpers"
```

Expected: FAIL because `relaxNodeCollisions` and `nodeLabelAttrs` do not exist yet.

- [ ] **Step 3: Make cluster spacing less likely to stack nodes**

Replace `arrangeCluster` with:

```js
    function arrangeCluster(nodes, centerX, centerY, radiusX, radiusY, startAngle, endAngle) {
      const sorted = [...nodes].sort(stableNodeSort);
      const count = Math.max(1, sorted.length);
      const laneCount = count > 42 ? 5 : count > 24 ? 4 : 3;
      return sorted.map((node, index) => {
        const ratio = count === 1 ? 0.5 : index / (count - 1);
        const angle = startAngle + (endAngle - startAngle) * ratio;
        const ring = 1 + (index % laneCount) * 0.16 + Math.floor(index / laneCount) * 0.015;
        return {
          ...node,
          x: centerX + Math.cos(angle) * radiusX * ring,
          y: centerY + Math.sin(angle) * radiusY * ring
        };
      });
    }
```

- [ ] **Step 4: Add a small deterministic collision pass**

Add this helper after `arrangeCluster`:

```js
    function relaxNodeCollisions(nodes, fixedNodeIds, iterations = 26) {
      const placed = nodes.map((node) => ({ ...node }));
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (let i = 0; i < placed.length; i += 1) {
          for (let j = i + 1; j < placed.length; j += 1) {
            const a = placed[i];
            const b = placed[j];
            const minGap = nodeRadius(a) + nodeRadius(b) + 38;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            if (distance >= minGap) continue;
            const push = (minGap - distance) / 2;
            const ux = dx / distance;
            const uy = dy / distance;
            const aFixed = fixedNodeIds.has(a.id);
            const bFixed = fixedNodeIds.has(b.id);
            if (!aFixed) {
              a.x -= ux * (bFixed ? push * 2 : push);
              a.y -= uy * (bFixed ? push * 2 : push);
            }
            if (!bFixed) {
              b.x += ux * (aFixed ? push * 2 : push);
              b.y += uy * (aFixed ? push * 2 : push);
            }
          }
        }
      }
      return placed;
    }
```

- [ ] **Step 5: Apply collision reduction in `graphFirstLayout`**

In `graphFirstLayout`, replace:

```js
      const nodes = [
        { ...subject, x: subjectX, y: subjectY },
        ...arrangeCluster(incomingNodes, width * 0.28, subjectY, 250, 320, -1.32, 1.36),
        ...arrangeCluster(outgoingNodes, width * 0.78, subjectY, 270, 335, -1.72, 1.62),
        ...arrangeCluster(serviceNodes, width * 0.55, subjectY + 90, 420, 210, -2.72, .35),
        ...arrangeCluster(contextNodes, width * 0.52, subjectY + 230, 360, 180, -2.82, -.32)
      ];
      const byId = new Map(nodes.map((node) => [node.id, node]));
      return { width, height, nodes, byId };
```

with:

```js
      const nodes = [
        { ...subject, x: subjectX, y: subjectY },
        ...arrangeCluster(incomingNodes, width * 0.25, subjectY, 290, 350, -1.38, 1.38),
        ...arrangeCluster(outgoingNodes, width * 0.80, subjectY, 305, 365, -1.72, 1.62),
        ...arrangeCluster(serviceNodes, width * 0.60, subjectY + 170, 470, 230, -2.85, .30),
        ...arrangeCluster(contextNodes, width * 0.52, subjectY + 285, 410, 210, -2.82, -.32)
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds);
      const byId = new Map(relaxedNodes.map((node) => [node.id, node]));
      return { width, height, nodes: relaxedNodes, byId };
```

- [ ] **Step 6: Add label placement helper**

Add this helper near `canvasNodeLabel`:

```js
    function nodeLabelAttrs(node, placed) {
      const subject = placed.nodes.find((item) => item.kind === "subject") || placed.nodes[0] || { x: 0, y: 0 };
      const radius = nodeRadius(node);
      const dx = node.x - subject.x;
      const dy = node.y - subject.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 80) {
        return {
          x: dx > 0 ? radius + 10 : -radius - 10,
          y: 4,
          anchor: dx > 0 ? "start" : "end"
        };
      }
      return {
        x: 0,
        y: dy < 0 ? -radius - 10 : radius + 16,
        anchor: "middle"
      };
    }
```

In `renderGraph`, replace the node label SVG:

```js
          '<text class="node-label" y="' + (radius + 16) + '" text-anchor="middle">' + escapeHtml(canvasNodeLabel(node)) + '</text></g>';
```

with:

```js
          (() => {
            const label = nodeLabelAttrs(node, placed);
            return '<text class="node-label" x="' + label.x + '" y="' + label.y + '" text-anchor="' + label.anchor + '">' + escapeHtml(canvasNodeLabel(node)) + '</text></g>';
          })();
```

- [ ] **Step 7: Run focused layout tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "deterministic graph-first layout helpers"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Reduce admin graph node collisions"
```

## Task 4: Per-Job Node Drag And Reset Layout

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing node drag test**

Add this test to `tests/admin/adminConsole.test.ts`:

```ts
it("contains per-job node drag and saved layout helpers", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("nodeDrag: null");
  expect(html).toContain("renderedNodePositions: new Map()");
  expect(html).toContain("function nodePositionStorageKey");
  expect(html).toContain("function loadNodePositionOverrides");
  expect(html).toContain("function saveNodePositionOverride");
  expect(html).toContain("function clearNodePositionOverrides");
  expect(html).toContain("function graphPointFromClient");
  expect(html).toContain("function startNodeDrag");
  expect(html).toContain("function updateNodeDrag");
  expect(html).toContain("function finishNodeDrag");
  expect(html).toContain('data-node-id="');
  expect(html).toContain('addEventListener("mousedown", (event) => startNodeDrag(event, node.getAttribute("data-node-id")))');
  expect(html).toContain('el("toolResetLayout").addEventListener("click", clearNodePositionOverrides)');
});
```

- [ ] **Step 2: Run the focused node drag test to verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "per-job node drag"
```

Expected: FAIL because node drag helpers do not exist.

- [ ] **Step 3: Add state fields**

In the `state` object, add:

```js
      nodeDrag: null,
      renderedNodePositions: new Map(),
```

Reset `renderedNodePositions` in `clearGraphState`:

```js
      state.renderedNodePositions = new Map();
```

- [ ] **Step 4: Add per-job node-position storage helpers**

Add these helpers after `layout(graph)`:

```js
    function nodePositionStorageKey() {
      return state.activeJobId ? "adminForensicsNodePositions:" + state.activeJobId : "";
    }
    function loadNodePositionOverrides() {
      const key = nodePositionStorageKey();
      if (!key) return {};
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    function saveNodePositionOverride(nodeId, x, y) {
      const key = nodePositionStorageKey();
      if (!key || !nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const overrides = loadNodePositionOverrides();
      overrides[nodeId] = { x, y };
      localStorage.setItem(key, JSON.stringify(overrides));
    }
    function clearNodePositionOverrides() {
      const key = nodePositionStorageKey();
      if (key) localStorage.removeItem(key);
      renderGraph();
    }
    function applyNodePositionOverrides(placed) {
      const overrides = loadNodePositionOverrides();
      const nodes = placed.nodes.map((node) => {
        const override = overrides[node.id];
        if (!override || !Number.isFinite(override.x) || !Number.isFinite(override.y)) return node;
        return { ...node, x: override.x, y: override.y };
      });
      return { ...placed, nodes, byId: new Map(nodes.map((node) => [node.id, node])) };
    }
```

- [ ] **Step 5: Apply saved positions during render**

In `renderGraph`, replace:

```js
      const placed = graphFirstLayout(visibleNodes, visibleEdges);
```

with:

```js
      const placed = applyNodePositionOverrides(graphFirstLayout(visibleNodes, visibleEdges));
      state.renderedNodePositions = new Map(placed.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
```

- [ ] **Step 6: Add graph coordinate and drag helpers**

Add these helpers before `initPanZoom`:

```js
    function graphPointFromClient(event) {
      const svg = el("graph");
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const svgX = viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width;
      const svgY = viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height;
      return {
        x: (svgX - state.transform.x) / state.transform.scale,
        y: (svgY - state.transform.y) / state.transform.scale
      };
    }
    function startNodeDrag(event, nodeId) {
      if (!nodeId) return;
      event.preventDefault();
      event.stopPropagation();
      const current = state.renderedNodePositions.get(nodeId);
      if (!current) return;
      const point = graphPointFromClient(event);
      state.nodeDrag = {
        nodeId,
        offsetX: current.x - point.x,
        offsetY: current.y - point.y,
        moved: false
      };
      el("graph").classList.add("dragging");
    }
    function updateNodeDrag(event) {
      if (!state.nodeDrag) return false;
      const point = graphPointFromClient(event);
      const nextX = point.x + state.nodeDrag.offsetX;
      const nextY = point.y + state.nodeDrag.offsetY;
      state.nodeDrag.moved = true;
      saveNodePositionOverride(state.nodeDrag.nodeId, nextX, nextY);
      // ponytail: Re-rendering on drag is simple and acceptable for admin-sized SVGs; upgrade to direct path mutation if drag becomes visibly slow.
      renderGraph();
      return true;
    }
    function finishNodeDrag() {
      if (!state.nodeDrag) return false;
      const moved = state.nodeDrag.moved;
      state.nodeDrag = null;
      el("graph").classList.remove("dragging");
      return moved;
    }
```

- [ ] **Step 7: Wire node drag without breaking node click**

In `renderGraph`, add the node mousedown handler after the existing node click handler:

```js
      svg.querySelectorAll("[data-node-id]").forEach((node) => {
        node.addEventListener("click", (event) => {
          if (state.nodeDrag?.moved) {
            event.stopPropagation();
            return;
          }
          event.stopPropagation();
          selectNode(node.getAttribute("data-node-id"));
        });
        node.addEventListener("mousedown", (event) => startNodeDrag(event, node.getAttribute("data-node-id")));
      });
```

Remove the existing node click block that starts with `svg.querySelectorAll("[data-node-id]").forEach((node) => node.addEventListener("click"` so node click is registered once.

- [ ] **Step 8: Keep canvas pan separate from node drag**

In `initPanZoom`, update mouse handling:

```js
    function initPanZoom() {
      const svg = el("graph");
      let drag = null;
      svg.addEventListener("mousedown", (event) => {
        if (event.target instanceof Element && event.target.closest("[data-node-id]")) return;
        drag = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y };
        svg.classList.add("dragging");
      });
      window.addEventListener("mousemove", (event) => {
        if (updateNodeDrag(event)) return;
        if (!drag) return;
        state.transform.x = drag.startX + (event.clientX - drag.x);
        state.transform.y = drag.startY + (event.clientY - drag.y);
        applyTransform();
      });
      window.addEventListener("mouseup", () => {
        const nodeMoved = finishNodeDrag();
        drag = null;
        svg.classList.remove("dragging");
        if (nodeMoved) renderGraph();
      });
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoom(event.deltaY > 0 ? .9 : 1.1);
      }, { passive: false });
      svg.addEventListener("click", () => {
        if (state.nodeDrag?.moved) return;
        state.selected = null;
        renderGraph();
        renderCaseBrief();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
      });
    }
```

- [ ] **Step 9: Wire Reset layout**

Add the event listener:

```js
    el("toolResetLayout").addEventListener("click", clearNodePositionOverrides);
```

Keep `toolResetView` for pan/zoom reset.

- [ ] **Step 10: Run focused node drag tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "per-job node drag"
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Add draggable admin graph nodes"
```

## Task 5: Selection Card Responsive Cleanup

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Replace the old floating selection-card responsive test**

Replace `"keeps selection card responsive controls clear"` with:

```ts
it("keeps selected details inside the analytics rail", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("analytics-selection-card");
  expect(html).toContain('<div class="selection-card analytics-selection-card" id="selectionCard"></div>');
  expect(html).toContain(".analytics-selection-card {");
  expect(html).toContain(".analytics-selection-card.open { display: block;");
  expect(html).not.toContain("right: 82px;");
  expect(html).not.toContain("top: 112px;");
  expect(html).not.toContain("max-height: calc(100dvh - 330px)");
});
```

- [ ] **Step 2: Run the focused selected-details test to verify it fails**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "selected details inside the analytics rail"
```

Expected: FAIL until the old absolute `.selection-card` CSS is removed.

- [ ] **Step 3: Replace floating selection card CSS**

Replace the old `.selection-card` absolute-position CSS with:

```css
    .analytics-body {
      display: grid;
      gap: 10px;
      align-content: start;
      padding: 12px;
    }
    .analytics-body .details-body {
      padding: 0;
    }
    .selection-card.analytics-selection-card {
      position: static;
      width: 100%;
      display: none;
      border: 1px solid #28364a;
      border-radius: 8px;
      background: rgba(12, 17, 25, .94);
      box-shadow: none;
      padding: 12px;
    }
    .selection-card.analytics-selection-card.open { display: block; }
    .selection-card h3 { margin: 0 0 8px; font-size: 14px; }
    .selection-card .card-line { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid rgba(42, 48, 54, .7); font-size: 12px; }
    .selection-card .card-line:first-of-type { border-top: 0; }
    .selection-card .card-line strong { min-width: 0; text-align: right; overflow-wrap: anywhere; }
    .selection-card .card-note { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
```

- [ ] **Step 4: Run focused selected-details tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "selected details inside the analytics rail"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Keep admin selected details in analytics rail"
```

## Task 6: Full Verification And Visual QA

**Files:**
- Modify only if tests reveal regressions:
  - `src/admin/adminConsole.ts`
  - `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Run the full admin console test file**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Start the admin server from this worktree for browser QA**

Run from `C:\Users\User\OneDrive\Desktop\smartcontract\.worktrees\admin-graph-first-ui`:

```bash
$env:ADMIN_DASHBOARD_ENABLED='true'
$env:ADMIN_DASHBOARD_TOKEN='local-admin-token'
$env:ADMIN_DASHBOARD_HOST='127.0.0.1'
$env:ADMIN_DASHBOARD_PORT='8788'
node --import tsx src/index.ts
```

Expected log: admin dashboard starts on `http://127.0.0.1:8788`.

- [ ] **Step 6: Browser-check the UI manually**

Open:

```text
http://127.0.0.1:8788/admin/forensics
```

Check:

- Jobs rail is on the left and opens by default.
- Analytics rail is on the right and opens by default.
- The center toolbar is one compact row at desktop width.
- Graph stats are right-aligned and vertically centered with controls.
- Selecting a node shows selected node details in the right rail.
- Selecting an edge shows selected flow details in the right rail.
- Selected details do not cover Jobs.
- Detail cards show full clickable Tronscan address links.
- Transfer tables still show shortened addresses.
- Dragging a node moves it.
- Reloading the same job keeps the moved node position.
- Reset layout clears moved node positions.
- Empty canvas drag still pans the graph.
- Wheel zoom still works.

- [ ] **Step 7: Fix only regressions found by verification**

If a check fails, make the smallest correction in `src/admin/adminConsole.ts`, then rerun:

```bash
npm test -- tests/admin/adminConsole.test.ts
npm run typecheck
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 8: Commit verification fixes if any were needed**

If Step 7 changed files, run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Polish admin graph UX rails"
```

If Step 7 changed nothing, do not create an empty commit.

## Self-Review

Spec coverage:

- Jobs left rail: Task 1.
- Analytics right rail: Task 1.
- Selected flow/node details inside right rail: Tasks 2 and 5.
- Compact toolbar: Task 1.
- Full clickable detail addresses and shortened dense addresses: Task 2.
- Dense graph overlap reduction: Task 3.
- Manual node movement and reset: Task 4.
- Error and partial data behavior: existing rendering paths remain; Task 6 verifies partial jobs still render.
- No Arkham code/assets and no new dependency: file structure and task constraints.

Placeholder scan:

- This plan contains concrete file paths, function names, commands, expected results, and code snippets for each code change step.

Type/name consistency:

- Right rail state is `analyticsOpen`.
- Right rail toggle is `toggleAnalytics`.
- Right rail close button is `closeAnalytics`.
- Node layout reset is `toolResetLayout`.
- Pan/zoom reset remains `toolResetView`.
- Selection details keep the existing id `selectionCard` to minimize JS churn.
