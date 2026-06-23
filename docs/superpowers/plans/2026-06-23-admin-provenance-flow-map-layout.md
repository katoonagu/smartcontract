# Admin Provenance Flow Map Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `incoming_deposit_check` and `where_is_money_check` open in a readable left-to-right Flow Map by default, with raw expansion still available.

**Architecture:** Keep the current vanilla HTML/SVG admin console and add one deterministic layout path inside `src/admin/adminConsole.ts`. The new layout is selected by job kind in `auto` mode, uses graph paths as the primary route, attaches funding bundles near their wallet hop, keeps peer links out of the main money path, and leaves all existing rails, filters, drag persistence, and right-rail details in place.

**Tech Stack:** TypeScript template string, browser-side vanilla JavaScript, SVG, Vitest string-regression tests, npm scripts.

---

## File Map

- Modify `src/admin/adminConsole.ts`
  - Add `graphKindUsesFlowMap`.
  - Route `incoming_deposit_check` and `where_is_money_check` to a new `flow_map` display mode when `state.densityMode` is `auto`.
  - Add `flowMapLayout` and small helper functions near the existing layout helpers.
  - Keep `Show all raw` routed to `timelineLaneLayout` for provenance jobs.
  - Keep `Fan overview` routed to `denseFanLayout`.
  - Keep node drag, local saved positions, rails, service filtering, peer-link filtering, and bundle expansion behavior.
  - Make edge time labels independent from amount visibility, so `Amounts: off` hides amount text but keeps time context on visible non-stop edges.

- Modify `tests/admin/adminConsole.test.ts`
  - Update existing string tests that currently expect dense-only step-orbit routing.
  - Add string assertions for `flow_map`, `flowMapLayout`, path placement helpers, bundle attachment helpers, peer lane helpers, and time-label behavior.

- Reference only: `docs/superpowers/specs/2026-06-23-admin-provenance-flow-map-layout-design.md`
  - Do not modify this spec unless implementation uncovers a spec contradiction.

## Current Root Cause

The real job that motivated this work, `16b15186-0bfb-4b98-b4f8-532746eb1956`, has:

- `incoming_deposit_check`
- 32 nodes
- 41 edges
- 2 paths
- 8 funding bundles
- 2 stop nodes

Current code treats dense graphs as:

```js
function graphIsDense(nodes, edges) {
  return nodes.length > 32 || edges.length > 50;
}
```

This job has exactly 32 nodes and 41 edges, so it does not pass the dense threshold. It falls through to `show_all` or `legacyFanLayout`, even though this job type needs a provenance route layout.

---

### Task 1: Pin Provenance Flow Map Routing With Failing Tests

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Update the dense default test name and expectations**

Replace the current test named:

```ts
it("defaults dense incoming and where-is-money graphs to step orbit mode", () => {
```

with:

```ts
it("defaults incoming and where-is-money provenance graphs to flow map mode", () => {
```

Replace the body of that test with:

```ts
const html = adminConsoleHtml();

expect(html).toContain("adminForensicsGraphViewMode");
expect(html).toContain('if (mode === "show_all") return "show_all";');
expect(html).toContain('if (mode === "fan") return "fan";');
expect(html).toContain('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";');
expect(html).toContain('if (!graphIsDense(nodes, edges)) return "show_all";');
expect(html).toContain('return "fan";');
expect(html).toContain("function graphKindUsesFlowMap");
expect(html).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
expect(html).toContain("function flowMapLayout");
expect(html).toContain('if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);');
expect(html).toContain('if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);');
expect(html).toContain('densityButton.textContent = mode === "flow_map" ? "Flow map" : mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";');
expect(html).toContain('"Flow map"');
```

- [ ] **Step 2: Update the deterministic dense fan presentation test**

In the test named `contains deterministic dense fan presentation helpers`, replace:

```ts
expect(html).toContain('if (!graphIsDense(nodes, edges)) return "show_all";');
```

with:

```ts
expect(html).toContain('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";');
expect(html).toContain('if (!graphIsDense(nodes, edges)) return "show_all";');
```

- [ ] **Step 3: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL. The failure should mention missing `graphKindUsesFlowMap`, `flow_map`, or `flowMapLayout`.

- [ ] **Step 4: Commit the failing test**

```powershell
git add tests/admin/adminConsole.test.ts
git commit -m "test: pin provenance flow map routing"
```

---

### Task 2: Route Provenance Jobs To Flow Map In Auto Mode

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add the provenance kind helper**

In `src/admin/adminConsole.ts`, find:

```js
function graphKindSupportsStepOrbit(kind) {
  return kind === "incoming_deposit_check" || kind === "where_is_money_check";
}
```

Replace it with:

```js
function graphKindUsesFlowMap(kind) {
  return kind === "incoming_deposit_check" || kind === "where_is_money_check";
}
function graphKindSupportsStepOrbit(kind) {
  return graphKindUsesFlowMap(kind);
}
```

- [ ] **Step 2: Replace `graphDisplayMode`**

Replace the full existing `graphDisplayMode` function with:

```js
function graphDisplayMode(nodes, edges) {
  const mode = state.densityMode;
  if (mode === "show_all") return "show_all";
  if (mode === "fan") return "fan";
  if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";
  if (!graphIsDense(nodes, edges)) return "show_all";
  if (graphKindSupportsStepOrbit(state.graph?.job?.kind)) return "step_orbit";
  return "fan";
}
```

- [ ] **Step 3: Replace the density button label expression**

In `syncDenseGraphControls`, replace:

```js
densityButton.textContent = mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";
```

with:

```js
densityButton.textContent = mode === "flow_map" ? "Flow map" : mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";
```

- [ ] **Step 4: Replace `graphFirstLayout` routing**

Replace the full existing `graphFirstLayout` function with:

```js
function graphFirstLayout(sourceNodes, sourceEdges, mode = graphDisplayMode(sourceNodes, sourceEdges), dense = graphIsDense(sourceNodes, sourceEdges)) {
  if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);
  if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);
  if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);
  if (dense && mode === "fan") return denseFanLayout(sourceNodes, sourceEdges);
  return legacyFanLayout(sourceNodes, sourceEdges);
}
```

- [ ] **Step 5: Run the targeted test and confirm the remaining failure is the missing `flowMapLayout`**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL with `flowMapLayout is not defined` or missing layout helper assertions. The routing strings should no longer be the failing lines.

- [ ] **Step 6: Commit the routing implementation**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: route provenance jobs to flow map"
```

---

### Task 3: Pin Flow Map Layout Structure With Tests

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a layout structure test after the step-orbit layout test**

Insert this test after `lays out step orbit graphs by investigation step with boundary and services separated`:

```ts
it("lays out provenance flow maps as routed paths with bundles peers and stops separated", () => {
  const html = adminConsoleHtml();

  expect(html).toContain("function flowMapPathNodeIds");
  expect(html).toContain("function flowMapPathItems");
  expect(html).toContain("function flowMapBundleAnchor");
  expect(html).toContain("function flowMapConnectedPlacedNodes");
  expect(html).toContain("function flowMapStopSide");
  expect(html).toContain("function flowMapLayout");
  expect(html).toContain("const pathStartX = 260;");
  expect(html).toContain("const pathEndX = width * 0.78;");
  expect(html).toContain("const mainY = height * 0.44;");
  expect(html).toContain("const peerLaneY = height * 0.20;");
  expect(html).toContain("const bundleLaneOffsetY = 150;");
  expect(html).toContain("const stopLeftX = 120;");
  expect(html).toContain("const stopRightX = width - 150;");
  expect(html).toContain("const fixedNodeIds = new Set([subjectId].filter(Boolean));");
  expect(html).toContain("relaxNodeCollisions(nodes, fixedNodeIds, 44)");
  expect(html).toContain("constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds)");
});
```

- [ ] **Step 2: Add a label behavior test**

Add this test near `caps edge thickness and shows compact honest time on canvas labels`:

```ts
it("keeps canvas time labels visible when amount labels are off", () => {
  const html = adminConsoleHtml();

  expect(html).toContain('const amountLines = state.amountMode === "off" ? [] : [shouldShowAmount ? amountLabel : ""].filter(Boolean);');
  expect(html).toContain('const timeLines = shouldShowTime ? [timeLabel] : [];');
  expect(html).toContain("const label = [...amountLines, ...timeLines];");
  expect(html).toContain(".amount-pill text { fill: #ffffff; font-size: 10.5px; font-weight: 520;");
  expect(html).toContain(".amount-pill rect { fill: rgba(11, 14, 17, .88); stroke: rgba(237, 244, 251, .14);");
});
```

- [ ] **Step 3: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL. The missing strings should be `flowMapPathNodeIds`, `flowMapLayout`, and the new label-line variables.

- [ ] **Step 4: Commit the failing layout tests**

```powershell
git add tests/admin/adminConsole.test.ts
git commit -m "test: pin provenance flow map layout"
```

---

### Task 4: Implement Flow Map Layout

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Insert Flow Map helpers before `legacyFanLayout`**

In `src/admin/adminConsole.ts`, insert the following block immediately before `function legacyFanLayout`:

```js
function flowMapPathNodeIds(path, edgeById) {
  const explicit = asArray(path?.nodeIds).filter(Boolean);
  if (explicit.length > 0) return explicit;
  const ids = [];
  asArray(path?.edgeIds).forEach((edgeId) => {
    const edge = edgeById.get(edgeId);
    if (!edge) return;
    if (edge.fromNodeId && ids[ids.length - 1] !== edge.fromNodeId) ids.push(edge.fromNodeId);
    if (edge.toNodeId) ids.push(edge.toNodeId);
  });
  return ids;
}
function flowMapPathItems(sourceNodes, sourceEdges) {
  const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const edgeById = new Map(sourceEdges.map((edge) => [edge.id, edge]));
  return graphPaths(state.graph)
    .map((path, index) => ({
      path,
      index,
      nodeIds: flowMapPathNodeIds(path, edgeById)
        .filter((nodeId) => {
          const node = nodeById.get(nodeId);
          if (!node) return false;
          const kind = nodeDisplayKind(node);
          return kind !== "funding_bundle" && kind !== "trace_stop" && !nodeIsServiceLike(node);
        })
    }))
    .filter((item) => item.nodeIds.length > 1);
}
function flowMapConnectedPlacedNodes(node, sourceEdges, placedById) {
  return sourceEdges
    .filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id)
    .map((edge) => edge.fromNodeId === node.id ? placedById.get(edge.toNodeId) : placedById.get(edge.fromNodeId))
    .filter(Boolean);
}
function flowMapBundleAnchor(node, sourceEdges, placedById) {
  const connected = flowMapConnectedPlacedNodes(node, sourceEdges, placedById);
  if (connected.length > 0) return connected[0];
  const parent = placedById.get(node?.metadata?.parentBundleId);
  return parent || null;
}
function flowMapStopSide(node) {
  const text = String(node?.metadata?.reason || node?.metadata?.stopTitle || node?.label || "").toLowerCase();
  return text.includes("previous") || text.includes("source") || text.includes("history") ? "left" : "right";
}
function flowMapLayout(sourceNodes, sourceEdges) {
  const pathItems = flowMapPathItems(sourceNodes, sourceEdges);
  if (pathItems.length === 0) return stepOrbitLayout(sourceNodes, sourceEdges);

  const maxPathLength = Math.max(2, ...pathItems.map((item) => item.nodeIds.length));
  const width = Math.max(2200, 760 + maxPathLength * 230 + sourceNodes.length * 18);
  const height = Math.max(1260, 760 + pathItems.length * 210 + sourceNodes.length * 8);
  const pathStartX = 260;
  const pathEndX = width * 0.78;
  const mainY = height * 0.44;
  const peerLaneY = height * 0.20;
  const bundleLaneOffsetY = 150;
  const stopLeftX = 120;
  const stopRightX = width - 150;
  const pathGapY = Math.max(170, Math.min(260, height * 0.17));
  const pathStepX = maxPathLength > 1 ? (pathEndX - pathStartX) / (maxPathLength - 1) : 0;
  const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
  const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
  const pathNodeIds = new Set(pathItems.flatMap((item) => item.nodeIds));
  const pathTargets = new Map();

  pathItems.forEach((item, pathIndex) => {
    const pathY = mainY + (pathIndex - (pathItems.length - 1) / 2) * pathGapY;
    item.nodeIds.forEach((nodeId, nodeIndex) => {
      const target = { x: pathStartX + nodeIndex * pathStepX, y: pathY };
      const existing = pathTargets.get(nodeId) || [];
      existing.push(target);
      pathTargets.set(nodeId, existing);
    });
  });

  const nodes = [];
  const placedById = new Map();
  pathTargets.forEach((targets, nodeId) => {
    const node = sourceById.get(nodeId);
    if (!node) return;
    const average = targets.reduce((total, target) => ({ x: total.x + target.x, y: total.y + target.y }), { x: 0, y: 0 });
    const placed = { ...node, x: average.x / targets.length, y: average.y / targets.length };
    nodes.push(placed);
    placedById.set(nodeId, placed);
  });

  const stopNodes = [];
  const bundleNodes = [];
  const bundleMemberNodes = [];
  const serviceNodes = [];
  const peerNodes = [];
  sourceNodes.forEach((node) => {
    if (placedById.has(node.id)) return;
    const kind = nodeDisplayKind(node);
    if (kind === "trace_stop") stopNodes.push(node);
    else if (String(node.id || "").startsWith("bundle-member:")) bundleMemberNodes.push(node);
    else if (kind === "funding_bundle") bundleNodes.push(node);
    else if (nodeIsServiceLike(node)) serviceNodes.push(node);
    else peerNodes.push(node);
  });

  const bundleSlotByAnchor = new Map();
  bundleNodes.sort(stableNodeSort).forEach((node, index) => {
    const anchor = flowMapBundleAnchor(node, sourceEdges, placedById);
    const key = anchor?.id || "free";
    const slot = bundleSlotByAnchor.get(key) || 0;
    bundleSlotByAnchor.set(key, slot + 1);
    const x = anchor ? anchor.x + 80 + (slot % 3) * 118 : width * 0.52 + (index % 4 - 1.5) * 150;
    const y = anchor ? anchor.y + bundleLaneOffsetY + Math.floor(slot / 3) * 96 : mainY + bundleLaneOffsetY + Math.floor(index / 4) * 96;
    const placed = { ...node, x, y };
    nodes.push(placed);
    placedById.set(node.id, placed);
  });

  const memberSlotByBundle = new Map();
  bundleMemberNodes.sort(stableNodeSort).forEach((node, index) => {
    const parentId = node?.metadata?.parentBundleId || "";
    const parent = placedById.get(parentId);
    const slot = memberSlotByBundle.get(parentId) || 0;
    memberSlotByBundle.set(parentId, slot + 1);
    const angle = -0.95 + slot * 0.38;
    const radius = 94 + Math.floor(slot / 6) * 42;
    const x = parent ? parent.x + Math.cos(angle) * radius : width * 0.42 + (index % 5) * 82;
    const y = parent ? parent.y + 82 + Math.sin(angle) * radius : mainY + 260 + Math.floor(index / 5) * 72;
    const placed = { ...node, x, y };
    nodes.push(placed);
    placedById.set(node.id, placed);
  });

  peerNodes.sort(stableNodeSort).forEach((node, index) => {
    const connected = flowMapConnectedPlacedNodes(node, sourceEdges, placedById);
    const averageX = connected.length > 0
      ? connected.reduce((total, item) => total + item.x, 0) / connected.length
      : pathStartX + (index + 1) * ((pathEndX - pathStartX) / Math.max(2, peerNodes.length + 1));
    const row = index % 3;
    const placed = {
      ...node,
      x: averageX + ((index % 2) ? 46 : -46),
      y: peerLaneY + row * 78
    };
    nodes.push(placed);
    placedById.set(node.id, placed);
  });

  serviceNodes.sort(stableNodeSort).forEach((node, index) => {
    const placed = {
      ...node,
      x: width * 0.82 + (index % 4) * 112,
      y: height * 0.32 + Math.floor(index / 4) * 98
    };
    nodes.push(placed);
    placedById.set(node.id, placed);
  });

  stopNodes.sort(stableNodeSort).forEach((node, index) => {
    const side = flowMapStopSide(node);
    const related = flowMapConnectedPlacedNodes(node, sourceEdges, placedById)[0];
    const placed = {
      ...node,
      x: side === "left" ? stopLeftX : stopRightX,
      y: related ? related.y + 86 + (index % 3) * 56 : mainY + (index - (stopNodes.length - 1) / 2) * 92
    };
    nodes.push(placed);
    placedById.set(node.id, placed);
  });

  const fixedNodeIds = new Set([subjectId].filter(Boolean));
  const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 44);
  const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
  return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
}
```

- [ ] **Step 2: Run the targeted test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL only on label behavior strings or stale tests that still expect dense-only step-orbit routing.

- [ ] **Step 3: Remove stale default-routing wording from step-orbit assertions**

In `tests/admin/adminConsole.test.ts`, keep the compatibility assertion:

```ts
expect(html).toContain('if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);');
```

Delete any assertion or test name that still says step-orbit is the default for `incoming_deposit_check` or `where_is_money_check`. The only allowed step-orbit expectation after Task 2 is the compatibility route above, because `stepOrbitLayout` remains available but is no longer the provenance default.

```ts
expect(html).not.toContain("defaults dense incoming and where-is-money graphs to step orbit mode");
```

- [ ] **Step 4: Run the targeted test again**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL only on the label behavior test from Task 3.

- [ ] **Step 5: Commit the layout implementation**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add provenance flow map layout"
```

---

### Task 5: Keep Time Labels Visible When Amount Labels Are Off

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Replace the canvas label construction**

In `renderGraph`, find:

```js
const label = state.amountMode === "off"
  ? []
  : [shouldShowAmount ? amountLabel : "", shouldShowTime ? timeLabel : ""].filter(Boolean);
```

Replace it with:

```js
const amountLines = state.amountMode === "off" ? [] : [shouldShowAmount ? amountLabel : ""].filter(Boolean);
const timeLines = shouldShowTime ? [timeLabel] : [];
const label = [...amountLines, ...timeLines];
```

- [ ] **Step 2: Soften amount label text weight**

Find this CSS rule in the HTML template:

```css
.amount-pill text { fill: #ffffff; font-size: 10.5px; font-weight: 560;
```

Replace it with:

```css
.amount-pill text { fill: #ffffff; font-size: 10.5px; font-weight: 520;
```

Keep the existing neutral pill border:

```css
.amount-pill rect { fill: rgba(11, 14, 17, .88); stroke: rgba(237, 244, 251, .14);
```

This keeps the amount white, less heavy, and avoids the old yellow-bordered label look.

- [ ] **Step 3: Run the targeted test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS for `tests/admin/adminConsole.test.ts`.

- [ ] **Step 4: Commit the label fix**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: keep graph time labels visible"
```

---

### Task 6: Verify Bundle Expansion, Service Toggle, And Raw Mode

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts` only if this task exposes a failing assertion

- [ ] **Step 1: Add a regression test for controls that must keep working**

Add this test near the dense graph controls tests:

```ts
it("keeps provenance flow map controls compatible with raw expansion services and bundles", () => {
  const html = adminConsoleHtml();

  expect(html).toContain('el("densityMode").addEventListener("click", () => {');
  expect(html).toContain('setDensityMode(state.densityMode === "show_all" ? "auto" : "show_all");');
  expect(html).toContain('if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);');
  expect(html).toContain('el("servicesMode").addEventListener("click", () => {');
  expect(html).toContain('state.servicesVisible = !state.servicesVisible;');
  expect(html).toContain('edgePassesServiceFilter(edge)');
  expect(html).toContain('state.expandedBundleNodeIds.add(state.selected.id);');
  expect(html).toContain("flowMapBundleAnchor(node, sourceEdges, placedById)");
  expect(html).toContain("String(node.id || \"\").startsWith(\"bundle-member:\")");
});
```

- [ ] **Step 2: Run the targeted test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS. If it fails because an existing string differs, inspect the current implementation and update the assertion to the exact current code only when the behavior is already present.

- [ ] **Step 3: Commit the regression test**

```powershell
git add tests/admin/adminConsole.test.ts src/admin/adminConsole.ts
git commit -m "test: cover provenance graph controls"
```

---

### Task 7: Run Full Local Checks

**Files:**
- No planned file edits

- [ ] **Step 1: Run the admin console tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```powershell
git diff --stat HEAD~4..HEAD
git diff -- src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
```

Expected:

- Only `src/admin/adminConsole.ts` and `tests/admin/adminConsole.test.ts` changed during implementation.
- The implementation adds Flow Map routing and layout helpers.
- No Telegram bot files changed.
- No backend risk scoring files changed.

---

### Task 8: Manual QA On The Real Incoming Deposit Job

**Files:**
- No planned file edits

- [ ] **Step 1: Start or confirm the admin server**

If the admin is not running, start it using the project command already used for local admin runs. If a local admin is already available at `http://127.0.0.1:8790/admin/forensics`, use the running server.

- [ ] **Step 2: Open the real job**

Open:

```text
http://127.0.0.1:8790/admin/forensics?jobId=16b15186-0bfb-4b98-b4f8-532746eb1956
```

Expected:

- The graph button reads `Flow map`.
- The main route is left-to-right.
- The visible route includes the deposit path ending around `TNMKtwF4Qj... -> TYDaeo...`.
- Funding bundle nodes sit near the wallet hop they fund and do not cover the route.
- Peer links are visible when `Peer links on`, but they do not run through the center of the main route.
- Stop nodes such as `No previous transfer` and `clean cex reached` sit at the side or edge of the map.

- [ ] **Step 3: Verify raw expansion**

Click `Flow map` once.

Expected:

- Button changes to `Show all raw`.
- Layout switches to the raw/timeline lane style.
- The graph shows the full visible graph without Flow Map grouping.

Click the same button again.

Expected:

- Button returns to `Flow map`.
- Layout returns to the Flow Map.

- [ ] **Step 4: Verify bundle expansion**

Select a funding bundle node and click `Expand selected`.

Expected:

- The selected bundle expands.
- Top funder member nodes appear around the selected bundle.
- The expanded member nodes do not cover the main route.
- The right rail still explains that the selected node is a saved funding bundle, not a wallet.

- [ ] **Step 5: Verify services toggle**

Click `Services off`.

Expected:

- Service, CEX, DEX, bridge, contract, and service-boundary nodes disappear when their edges are filtered out.
- Main wallet path remains readable.

Click `Services on`.

Expected:

- Service nodes return to their side zone.

- [ ] **Step 6: Verify labels and fast-chain visual cue**

Use `Amounts: important` and inspect visible non-stop edges.

Expected:

- Important money edges show compact amount and time.
- Amount text is white and medium weight.
- Time is visible as `hold`, `span`, `gap`, a compact UTC timestamp, or `time n/a` based on available data.
- There is no yellow border around amount/time pills.
- Fast edges within 24 hours keep a subtle speed glow.

Switch to `Amounts: off`.

Expected:

- Amount text disappears.
- Time labels remain visible on non-stop edges.

- [ ] **Step 7: Verify manual drag and reset**

Drag one node.

Expected:

- The node moves immediately without selecting page text.
- Connected edges update while dragging.

Click `Reset layout`.

Expected:

- Saved positions clear.
- The graph returns to Flow Map, not legacy fan layout.

---

### Task 9: Final Review And Landing Commit

**Files:**
- Modify only if review finds an issue in `src/admin/adminConsole.ts` or `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Review the final diff**

Run:

```powershell
git diff origin/master...HEAD -- src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
```

Expected:

- Flow Map default is job-kind based.
- `address_fast_check` and `address_deep_check` defaults are unchanged.
- `Show all raw` remains available.
- `Fan overview` remains available.
- No new dependency was added.
- No React migration was added.

- [ ] **Step 2: Run the final checks**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 3: Commit final fixups if the review changed files**

If Step 1 or Step 2 produced a necessary fix, commit it:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: polish provenance flow map layout"
```

If no files changed after Task 8, skip this commit.

---

## Acceptance Mapping

- Provenance jobs default to Flow Map: Tasks 1-2.
- Example 32-node job no longer opens in legacy fallback: Tasks 1-2 and manual QA Task 8.
- Main money paths read left-to-right: Task 4.
- Multiple paths separated vertically: Task 4.
- Funding bundles attach near the hop wallet they explain: Task 4.
- Expanded bundle members avoid the main route: Task 4 and Task 8.
- Peer links visible but secondary: Task 4 and Task 8.
- Boundary and stop nodes sit at edges: Task 4 and Task 8.
- Node overlap reduced for 30-60 node provenance jobs: Task 4.
- Edge labels readable and not yellow-bordered: Task 5.
- Time remains visible when amounts are off: Task 5.
- Reset layout returns to Flow Map: Task 2 and Task 8.
- `Show all raw` remains available: Task 2 and Task 8.
- Existing fast/deep defaults unchanged: Task 9.
