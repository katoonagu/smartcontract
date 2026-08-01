# Admin Deep-Check Local Orbit Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deep-check-only graph layout where important intermediate wallets get their own local orbit branches instead of rendering one huge subject-centered figure.

**Architecture:** Keep the admin console as the existing vanilla HTML/SVG module in `src/admin/adminConsole.ts`. Add a new internal display mode named `deep_local_orbit` for `address_deep_check` only, reuse existing node/edge rendering and label collision helpers, and leave `incoming_deposit_check` plus `where_is_money_check` on the current flow-map behavior.

**Tech Stack:** TypeScript, Vitest, vanilla DOM/SVG, existing admin console helpers.

---

## File Structure

- Modify: `tests/admin/adminConsole.test.ts`
  - Add string-level regression tests for mode routing, local-orbit helper presence, deep-only scope, viewport controls, and service/group behavior.
- Modify: `src/admin/adminConsole.ts`
  - Add `graphKindUsesLocalOrbit`.
  - Route `address_deep_check` to `deep_local_orbit`.
  - Add local-orbit layout helpers next to existing flow-map layout helpers.
  - Improve fit/zoom behavior used by the graph surface.
  - Preserve current incoming/where-is-money behavior.
- Run only existing commands:
  - `npm test -- --run tests/admin/adminConsole.test.ts`
  - `npm run typecheck`
  - `git diff --check`

No new dependencies. No React migration. No backend changes.

---

### Task 1: Add Deep-Only Local-Orbit Mode Routing

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

Add this test near the existing `"uses flow-map layout for address deep checks instead of dense fan"` test. This replaces that expectation with the new deep-only mode boundary.

```ts
  it("routes only address deep checks to local orbit mode", () => {
    const html = adminConsoleHtml();
    const kindBlock = html.slice(html.indexOf("function graphKindUsesFlowMap"), html.indexOf("function buildDenseFanPresentation"));
    const layoutBlock = html.slice(html.indexOf("function graphFirstLayout"), html.indexOf("function graphPresentation"));
    const controlsBlock = html.slice(html.indexOf("function syncDenseGraphControls"), html.indexOf("function syncGraphFirstControls"));

    expect(html).toContain("function graphKindUsesLocalOrbit");
    expect(kindBlock).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(kindBlock).toContain('return kind === "address_deep_check";');
    expect(kindBlock).toContain('if (graphKindUsesLocalOrbit(state.graph?.job?.kind)) return "deep_local_orbit";');
    expect(layoutBlock).toContain('if (mode === "deep_local_orbit") return deepLocalOrbitLayout(sourceNodes, sourceEdges);');
    expect(layoutBlock).toContain('if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);');
    expect(controlsBlock).toContain('mode === "deep_local_orbit" ? "Local orbit"');
    expect(kindBlock).not.toContain('kind === "incoming_deposit_check" || kind === "where_is_money_check" || kind === "address_deep_check"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because `graphKindUsesLocalOrbit`, `deep_local_orbit`, and `"Local orbit"` are not present yet.

- [ ] **Step 3: Implement minimal mode routing**

In `src/admin/adminConsole.ts`, replace these helpers:

```js
    function graphKindUsesFlowMap(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check" || kind === "address_deep_check";
    }
    function graphKindSupportsStepOrbit(kind) {
      return graphKindUsesFlowMap(kind);
    }
```

with:

```js
    function graphKindUsesFlowMap(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check";
    }
    function graphKindUsesLocalOrbit(kind) {
      return kind === "address_deep_check";
    }
    function graphKindSupportsStepOrbit(kind) {
      return graphKindUsesFlowMap(kind) || graphKindUsesLocalOrbit(kind);
    }
```

In `graphDisplayMode`, replace:

```js
      if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";
```

with:

```js
      if (graphKindUsesLocalOrbit(state.graph?.job?.kind)) return "deep_local_orbit";
      if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";
```

In `graphFirstLayout`, replace:

```js
      if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);
```

with:

```js
      if (mode === "deep_local_orbit") return deepLocalOrbitLayout(sourceNodes, sourceEdges);
      if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);
```

In the `show_all` branch in `graphFirstLayout`, replace:

```js
      if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);
```

with:

```js
      if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind) || graphKindUsesLocalOrbit(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);
```

In `syncDenseGraphControls`, replace the `densityButton.textContent = ...` line with:

```js
        densityButton.textContent = mode === "deep_local_orbit" ? "Local orbit" : mode === "flow_map" ? "Flow map" : mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";
```

- [ ] **Step 4: Add a temporary placeholder layout to make routing compile**

Add this directly before `graphFirstLayout`:

```js
    function deepLocalOrbitLayout(sourceNodes, sourceEdges) {
      return flowMapLayout(sourceNodes, sourceEdges);
    }
```

This is intentionally temporary for Task 1 only. Task 2 replaces it with the real layout.

- [ ] **Step 5: Run the focused test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "test: route deep check to local orbit mode"
```

---

### Task 2: Build The Deep Local-Orbit Layout

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing layout-helper test**

Add this test after the flow-map layout test.

```ts
  it("lays out address deep checks as a route spine with local orbit branches", () => {
    const html = adminConsoleHtml();
    const localOrbitBlock = html.slice(html.indexOf("function deepLocalOrbitSpineNodeIds"), html.indexOf("function legacyFanLayout"));

    expect(html).toContain("function deepLocalOrbitSpineNodeIds");
    expect(html).toContain("function deepLocalOrbitAnchorFor");
    expect(html).toContain("function deepLocalOrbitRole");
    expect(html).toContain("function deepLocalOrbitPoint");
    expect(html).toContain("function deepLocalOrbitLayout");
    expect(localOrbitBlock).toContain("const spineNodeIds = deepLocalOrbitSpineNodeIds(sourceNodes, sourceEdges);");
    expect(localOrbitBlock).toContain("const anchor = deepLocalOrbitAnchorFor(node, sourceEdges, placedById, subjectId);");
    expect(localOrbitBlock).toContain("const point = deepLocalOrbitPoint(anchor, slot, role, width, height);");
    expect(localOrbitBlock).toContain("role === \"group\"");
    expect(localOrbitBlock).toContain("role === \"service\"");
    expect(localOrbitBlock).toContain("role === \"stop\"");
    expect(localOrbitBlock).toContain("role === \"peer\"");
    expect(localOrbitBlock).toContain("relaxNodeCollisions(nodes, fixedNodeIds, 44)");
    expect(localOrbitBlock).toContain("constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds)");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because local-orbit helper functions are not implemented.

- [ ] **Step 3: Replace the temporary `deepLocalOrbitLayout` with helpers**

Insert these helpers between `flowMapLayout` and `legacyFanLayout`, replacing the temporary Task 1 `deepLocalOrbitLayout`.

```js
    function deepLocalOrbitSpineNodeIds(sourceNodes, sourceEdges) {
      const pathItems = flowMapPathItems(sourceNodes, sourceEdges);
      if (pathItems.length > 0) {
        const ranked = [...pathItems].sort((a, b) =>
          b.nodeIds.length - a.nodeIds.length ||
          Number(b.path?.riskContribution || 0) - Number(a.path?.riskContribution || 0) ||
          a.index - b.index
        );
        return ranked[0].nodeIds;
      }
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
      const direct = sourceNodes
        .filter((node) => node.id !== subjectId)
        .filter((node) => sourceEdges.some((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id))
        .sort((a, b) => nodeImportanceScore(b, sourceEdges) - nodeImportanceScore(a, sourceEdges))
        .slice(0, 8)
        .map((node) => node.id);
      return subjectId ? [subjectId, ...direct] : direct;
    }
    function deepLocalOrbitRole(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "trace_stop") return "stop";
      if (kind === "funding_bundle" || node.kind === "group" || node.displayKind === "collapsed_group") return "group";
      if (nodeIsServiceLike(node)) return "service";
      return "peer";
    }
    function deepLocalOrbitAnchorFor(node, sourceEdges, placedById, subjectId) {
      const parent = placedById.get(node?.metadata?.parentBundleId);
      if (parent) return parent;
      const connected = flowMapConnectedPlacedNodes(node, sourceEdges, placedById)
        .sort((a, b) => {
          if (a.id === subjectId) return 1;
          if (b.id === subjectId) return -1;
          return Math.abs(a.x - b.x) || String(a.id).localeCompare(String(b.id));
        });
      return connected[0] || placedById.get(subjectId) || [...placedById.values()][0] || null;
    }
    function deepLocalOrbitPoint(anchor, slot, role, width, height) {
      const baseX = anchor?.x ?? width * 0.5;
      const baseY = anchor?.y ?? height * 0.5;
      const ring = Math.floor(slot / 5);
      const localSlot = slot % 5;
      const radiusX = role === "service" ? 176 : role === "stop" ? 210 : role === "group" ? 150 : 126;
      const radiusY = role === "service" ? 108 : role === "stop" ? 116 : role === "group" ? 128 : 112;
      const roleBaseAngle = role === "peer" ? -2.2 : role === "group" ? 1.28 : role === "service" ? -0.34 : 0.34;
      const angle = roleBaseAngle + (localSlot - 2) * 0.42 + ring * 0.16;
      return {
        x: baseX + Math.cos(angle) * (radiusX + ring * 46),
        y: baseY + Math.sin(angle) * (radiusY + ring * 38)
      };
    }
    function deepLocalOrbitLayout(sourceNodes, sourceEdges) {
      const spineNodeIds = deepLocalOrbitSpineNodeIds(sourceNodes, sourceEdges);
      if (spineNodeIds.length === 0) return flowMapLayout(sourceNodes, sourceEdges);
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || spineNodeIds[0] || "";
      const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
      const spineNodes = spineNodeIds.map((id) => sourceById.get(id)).filter(Boolean);
      const width = Math.max(1480, 520 + spineNodes.length * 190 + Math.min(sourceNodes.length, 80) * 4);
      const height = Math.max(940, 700 + Math.ceil(Math.min(sourceNodes.length, 80) / 18) * 90);
      const startX = 180;
      const endX = width - 220;
      const centerY = height * 0.48;
      const stepX = spineNodes.length > 1 ? (endX - startX) / (spineNodes.length - 1) : 0;
      const nodes = [];
      const placedById = new Map();
      spineNodes.forEach((node, index) => {
        const wave = Math.sin(index * 0.85) * 64;
        const placed = {
          ...node,
          x: startX + index * stepX,
          y: centerY + wave
        };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });
      if (subjectId && placedById.has(subjectId)) {
        const subject = placedById.get(subjectId);
        const targetX = Math.max(subject.x, width * 0.62);
        const deltaX = targetX - subject.x;
        if (deltaX > 0) {
          nodes.forEach((node) => {
            if (node.x >= subject.x) node.x += deltaX;
          });
        }
      }
      const slotByAnchorRole = new Map();
      sourceNodes
        .filter((node) => !placedById.has(node.id))
        .sort(stableNodeSort)
        .forEach((node) => {
          const role = deepLocalOrbitRole(node);
          const anchor = deepLocalOrbitAnchorFor(node, sourceEdges, placedById, subjectId);
          const key = (anchor?.id || "free") + ":" + role;
          const slot = slotByAnchorRole.get(key) || 0;
          slotByAnchorRole.set(key, slot + 1);
          const point = deepLocalOrbitPoint(anchor, slot, role, width, height);
          const placed = { ...node, x: point.x, y: point.y };
          nodes.push(placed);
          placedById.set(node.id, placed);
        });
      const fixedNodeIds = new Set([subjectId, ...spineNodeIds].filter(Boolean));
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 44);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add deep-check local orbit graph layout"
```

---

### Task 3: Keep Labels And Reverse Transfers Readable In Local-Orbit Mode

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing readability test**

Add this test near the existing edge-label tests.

```ts
  it("keeps local-orbit edge labels attached to separated curves", () => {
    const html = adminConsoleHtml();
    const labelBlock = html.slice(html.indexOf("function edgeLabelPoint"), html.indexOf("function edgeMarkerId"));
    const routeBlock = html.slice(html.indexOf("function buildEdgeRouteIndex"), html.indexOf("function edgeCurvePath"));

    expect(routeBlock).toContain("directionSign: sign");
    expect(routeBlock).toContain("sameDirectionIndex");
    expect(routeBlock).toContain("parallelOffset");
    expect(labelBlock).toContain("const t = edgeVisualRole(edge) === \"stop\" ? 0.58 : 0.52;");
    expect(labelBlock).toContain("const role = edgeVisualRole(edge);");
    expect(labelBlock).toContain("const side = role === \"stop\" || role === \"peer\" ? -1 : 1;");
    expect(labelBlock).toContain("function avoidEdgeLabelCollisions");
    expect(labelBlock).toContain("const shifts = [0, -28, 28, -52, 52, -78, 78, -106, 106, -138, 138];");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because the collision shifts do not include `-138, 138` yet.

- [ ] **Step 3: Extend label collision fallback**

In `avoidEdgeLabelCollisions`, replace:

```js
      const shifts = [0, -28, 28, -52, 52, -78, 78, -106, 106];
```

with:

```js
      const shifts = [0, -28, 28, -52, 52, -78, 78, -106, 106, -138, 138];
```

This keeps the existing algorithm but gives dense deep-check local branches more room before a label is allowed to overlap a node.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: improve deep-check local orbit label placement"
```

---

### Task 4: Improve Graph Viewport Controls

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing viewport test**

Update the existing `"fits the graph viewport from rendered node bounds"` test to expect the wider zoom range and new cursor-centered zoom helper. Replace its body with:

```ts
    const html = adminConsoleHtml();
    const fitGraphBlock = html.slice(html.indexOf("function fitGraph"), html.indexOf("function zoomAtClientPoint"));
    const zoomBlock = html.slice(html.indexOf("function zoomAtClientPoint"), html.indexOf("function graphPointFromClient"));
    const panZoomBlock = html.slice(html.indexOf("function initPanZoom"), html.indexOf("function setAutoRefresh"));

    expect(fitGraphBlock).toContain("const positions = [...state.renderedNodePositions.values()];");
    expect(fitGraphBlock).toContain("const padding = graphKindUsesLocalOrbit(state.graph?.job?.kind) ? 120 : 180;");
    expect(fitGraphBlock).toContain("const minScale = graphKindUsesLocalOrbit(state.graph?.job?.kind) ? .08 : .25;");
    expect(fitGraphBlock).toContain("const maxFitScale = graphKindUsesLocalOrbit(state.graph?.job?.kind) ? 3.5 : 2.4;");
    expect(fitGraphBlock).toContain("const scale = Math.max(minScale, Math.min(maxFitScale, rawScale));");
    expect(zoomBlock).toContain("function zoomAtClientPoint(event, multiplier)");
    expect(zoomBlock).toContain("const nextScale = Math.max(.08, Math.min(14, previousScale * multiplier));");
    expect(zoomBlock).toContain("state.transform.x = svgX - graphPoint.x * nextScale;");
    expect(zoomBlock).toContain("state.transform.y = svgY - graphPoint.y * nextScale;");
    expect(panZoomBlock).toContain("zoomAtClientPoint(event, event.deltaY > 0 ? .86 : 1.16);");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: FAIL because `zoomAtClientPoint` and the deep-check fit constants do not exist.

- [ ] **Step 3: Update `fitGraph`**

Inside `fitGraph`, replace:

```js
      const padding = 180;
      const boundsWidth = Math.max(1, maxX - minX + padding * 2);
      const boundsHeight = Math.max(1, maxY - minY + padding * 2);
      const rawScale = Math.min(viewBox.width / boundsWidth, viewBox.height / boundsHeight) * .88;
      const scale = Math.max(.35, Math.min(2.4, rawScale));
```

with:

```js
      const padding = graphKindUsesLocalOrbit(state.graph?.job?.kind) ? 120 : 180;
      const boundsWidth = Math.max(1, maxX - minX + padding * 2);
      const boundsHeight = Math.max(1, maxY - minY + padding * 2);
      const rawScale = Math.min(viewBox.width / boundsWidth, viewBox.height / boundsHeight) * .88;
      const minScale = graphKindUsesLocalOrbit(state.graph?.job?.kind) ? .08 : .25;
      const maxFitScale = graphKindUsesLocalOrbit(state.graph?.job?.kind) ? 3.5 : 2.4;
      const scale = Math.max(minScale, Math.min(maxFitScale, rawScale));
```

- [ ] **Step 4: Replace `zoom` with cursor-centered zoom**

Replace:

```js
    function zoom(multiplier) {
      state.transform.scale = Math.max(.25, Math.min(4, state.transform.scale * multiplier));
      applyTransform();
    }
```

with:

```js
    function svgPointFromClient(event) {
      const svg = el("graph");
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      return {
        x: viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
        y: viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height
      };
    }
    function zoomAtClientPoint(event, multiplier) {
      const previousScale = state.transform.scale;
      const nextScale = Math.max(.08, Math.min(14, previousScale * multiplier));
      const svgPoint = svgPointFromClient(event);
      const graphPoint = {
        x: (svgPoint.x - state.transform.x) / previousScale,
        y: (svgPoint.y - state.transform.y) / previousScale
      };
      state.transform.x = svgPoint.x - graphPoint.x * nextScale;
      state.transform.y = svgPoint.y - graphPoint.y * nextScale;
      state.transform.scale = nextScale;
      applyTransform();
    }
    function zoom(multiplier) {
      const svg = el("graph");
      const rect = svg.getBoundingClientRect();
      zoomAtClientPoint({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, multiplier);
    }
```

- [ ] **Step 5: Simplify `graphPointFromClient` to reuse `svgPointFromClient`**

Replace the body of `graphPointFromClient` with:

```js
      const point = svgPointFromClient(event);
      return {
        x: (point.x - state.transform.x) / state.transform.scale,
        y: (point.y - state.transform.y) / state.transform.scale
      };
```

- [ ] **Step 6: Update wheel zoom speed**

Replace:

```js
        zoom(event.deltaY > 0 ? .9 : 1.1);
```

with:

```js
        zoomAtClientPoint(event, event.deltaY > 0 ? .86 : 1.16);
```

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: improve admin graph zoom controls"
```

---

### Task 5: Final Regression And Manual QA

**Files:**
- Modify only if a test fails:
  - `src/admin/adminConsole.ts`
  - `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Run focused admin tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: no output.

- [ ] **Step 4: Start or refresh admin console**

Use the existing project command used for local admin runs. If the admin is already running, restart it after the implementation commits so the served HTML reflects the new `adminConsoleHtml`.

Expected manual checks:

- `address_deep_check` dense job button reads `Local orbit`.
- `address_deep_check` graph shows a route spine with local branches near intermediate wallets.
- `incoming_deposit_check` still uses the existing provenance flow-map behavior.
- `where_is_money_check` still uses the existing provenance flow-map behavior.
- `Show all raw` still expands to the raw/timeline lane view.
- Services toggle still hides/shows service-like nodes.
- Peer links toggle still hides/shows peer links.
- Wheel zoom follows cursor and can zoom in past the old limit.
- Background drag pans without browser text selection.

- [ ] **Step 5: Commit any QA fixes**

If Step 1-4 required fixes, commit them:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: polish deep-check local orbit graph qa"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Deep-only scope is covered by Task 1 tests and routing.
- Local route spine plus local branches is covered by Task 2.
- Reverse transfer and label readability is covered by Task 3 and existing route-index helpers.
- Viewport zoom/pan is covered by Task 4.
- Incoming/where-is-money non-regression is covered by Task 1 and Task 5 manual checks.
- Group expansion no-members message already exists; this plan preserves it and verifies the expansion path through existing tests.

Placeholder scan:

- No placeholder tokens or unspecified implementation steps are used.
- Every code-edit step includes exact snippets.

Type consistency:

- New display mode string is `deep_local_orbit` in tests and implementation snippets.
- New helper names are `graphKindUsesLocalOrbit`, `deepLocalOrbitSpineNodeIds`, `deepLocalOrbitAnchorFor`, `deepLocalOrbitRole`, `deepLocalOrbitPoint`, and `deepLocalOrbitLayout`.
- Existing commands match `package.json`.
