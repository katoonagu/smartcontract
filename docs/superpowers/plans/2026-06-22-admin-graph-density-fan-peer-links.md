# Admin Graph Dense Fan And Peer Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dense admin forensic graphs open as readable fast-check-style fan overviews, with show-all timeline expansion, cleaner edge labels, and peer-link visibility between neighboring wallets.

**Architecture:** Keep the existing vanilla TypeScript string-rendered admin console and inline SVG renderer. Add small deterministic helper functions inside `src/admin/adminConsole.ts` around state, graph presentation, layout, edge labeling, and analytics rail rendering. Use string-contract tests in `tests/admin/adminConsole.test.ts` to protect the admin HTML behavior already used by this project.

**Tech Stack:** TypeScript, inline browser JavaScript inside `adminConsoleHtml()`, SVG, localStorage, Vitest.

---

## File Structure

- Modify `src/admin/adminConsole.ts`
  - Add dense graph controls to the existing graph toolbar.
  - Add state keys for dense graph display and peer-link visibility.
  - Add helper functions for dense detection, collapsed group presentation, fan layout, show-all timeline layout, compact amount labels, peer-link classification, and connected-neighbor detail lines.
  - Update `renderGraph()` to render from a presentation model instead of always rendering all visible raw nodes.
  - Update analytics rail rendering to show connected neighbors for selected nodes and services.
- Modify `tests/admin/adminConsole.test.ts`
  - Add focused string-contract tests for controls, dense helpers, peer-link helpers, cleaner label behavior, and connected-neighbor analytics.
- No new production dependencies.
- No backend forensic logic changes.
- No Telegram bot UI changes.

## Implementation Notes

Keep the current `graphFirstLayout()` public helper name in the HTML because tests already assert it exists. Move the current implementation body into a helper named `legacyFanLayout()` and make `graphFirstLayout()` choose between:

- `denseFanLayout()` for dense default mode;
- `timelineLaneLayout()` for `Show all`;
- `legacyFanLayout()` for non-dense graphs.

The first implementation should be deterministic and conservative:

- dense when `nodes.length > 32 || edges.length > 50`;
- default display mode is `fan`;
- `Show all` is manual through the toolbar;
- collapsed group nodes are visual-only nodes with ids prefixed by `collapsed:`;
- collapsed group edges are visual-only edges with ids prefixed by `collapsed-edge:`;
- peer links are existing edges where neither side is the subject.

---

### Task 1: Add Dense Graph Controls And State

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing test for dense controls and state**

Append this test inside `describe("adminConsoleHtml", () => { ... })` in `tests/admin/adminConsole.test.ts`:

```ts
  it("contains dense graph fan controls and peer-link state", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('id="densityMode"');
    expect(html).toContain('id="peerLinksMode"');
    expect(html).toContain("densityMode: localStorage.getItem(\"adminForensicsDensityMode\") || \"fan\"");
    expect(html).toContain("peerLinksVisible: localStorage.getItem(\"adminForensicsPeerLinks\") !== \"off\"");
    expect(html).toContain("function setDensityMode");
    expect(html).toContain("function syncDenseGraphControls");
    expect(html).toContain('el("densityMode").addEventListener("click", () => {');
    expect(html).toContain('el("peerLinksMode").addEventListener("click", () => {');
    expect(html).toContain('localStorage.setItem("adminForensicsDensityMode", state.densityMode);');
    expect(html).toContain('localStorage.setItem("adminForensicsPeerLinks", state.peerLinksVisible ? "on" : "off");');
  });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "dense graph fan controls"
```

Expected: FAIL because the new controls and state do not exist.

- [ ] **Step 3: Add toolbar controls**

In `src/admin/adminConsole.ts`, inside the existing `.graph-control-group` toolbar, insert the controls after the `amountMode` select and before `servicesMode`:

```html
            <button id="densityMode" type="button">Fan overview</button>
            <button id="peerLinksMode" type="button">Peer links on</button>
```

The surrounding block should remain:

```html
            <select id="amountMode">
              <option value="important">Amounts: important</option>
              <option value="all">Amounts: all</option>
              <option value="off">Amounts: off</option>
            </select>
            <button id="densityMode" type="button">Fan overview</button>
            <button id="peerLinksMode" type="button">Peer links on</button>
            <button id="servicesMode" type="button">Services on</button>
            <button id="toolResetLayout" type="button">Reset layout</button>
```

- [ ] **Step 4: Add state keys**

In the `state` object in `src/admin/adminConsole.ts`, add these keys after `amountMode`:

```js
      densityMode: localStorage.getItem("adminForensicsDensityMode") || "fan",
      peerLinksVisible: localStorage.getItem("adminForensicsPeerLinks") !== "off",
```

After the existing flow-mode validation line:

```js
    if (!["all", "incoming", "outgoing", "self"].includes(state.flowMode)) state.flowMode = "all";
```

add:

```js
    if (!["fan", "show_all"].includes(state.densityMode)) state.densityMode = "fan";
```

- [ ] **Step 5: Add control sync and setter helpers**

Near `setTransferDrawer(open)`, add:

```js
    function setDensityMode(mode) {
      state.densityMode = mode === "show_all" ? "show_all" : "fan";
      localStorage.setItem("adminForensicsDensityMode", state.densityMode);
      syncDenseGraphControls();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
    }
    function syncDenseGraphControls() {
      const densityButton = el("densityMode");
      const peerButton = el("peerLinksMode");
      if (densityButton) densityButton.textContent = state.densityMode === "show_all" ? "Show all" : "Fan overview";
      if (peerButton) peerButton.textContent = state.peerLinksVisible ? "Peer links on" : "Peer links off";
    }
```

- [ ] **Step 6: Wire button events**

Near the existing toolbar event listeners for `amountMode`, `flowMode`, and `servicesMode`, add:

```js
    el("densityMode").addEventListener("click", () => {
      setDensityMode(state.densityMode === "show_all" ? "fan" : "show_all");
    });
    el("peerLinksMode").addEventListener("click", () => {
      state.peerLinksVisible = !state.peerLinksVisible;
      localStorage.setItem("adminForensicsPeerLinks", state.peerLinksVisible ? "on" : "off");
      syncDenseGraphControls();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
    });
```

Call `syncDenseGraphControls();` once near the existing initialization calls after setting `el("amountMode").value`.

- [ ] **Step 7: Run the focused test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "dense graph fan controls"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Add admin dense graph controls"
```

---

### Task 2: Add Dense Detection And Presentation Helpers

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing test for dense graph helpers**

Append this test:

```ts
  it("contains deterministic dense fan presentation helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphIsDense");
    expect(html).toContain("return nodes.length > 32 || edges.length > 50;");
    expect(html).toContain("function graphDisplayMode");
    expect(html).toContain('return state.densityMode === "show_all" ? "show_all" : "fan";');
    expect(html).toContain("function nodeImportanceScore");
    expect(html).toContain("function rankNodesByImportance");
    expect(html).toContain("function collapsedGroupNode");
    expect(html).toContain("function collapsedGroupEdge");
    expect(html).toContain("function buildDenseFanPresentation");
    expect(html).toContain("collapsed:incoming");
    expect(html).toContain("collapsed:outgoing");
    expect(html).toContain("collapsed:service");
    expect(html).toContain("collapsed-edge:");
  });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "deterministic dense fan presentation"
```

Expected: FAIL.

- [ ] **Step 3: Add dense helper functions**

In `src/admin/adminConsole.ts`, place these helpers after `stableNodeSort(a, b)`:

```js
    function graphIsDense(nodes, edges) {
      return nodes.length > 32 || edges.length > 50;
    }
    function graphDisplayMode(nodes, edges) {
      if (!graphIsDense(nodes, edges)) return "show_all";
      return state.densityMode === "show_all" ? "show_all" : "fan";
    }
    function nodeImportanceScore(node, edges) {
      const directWeight = Number(node.weight || node.score || 0);
      const relatedRaw = edges.reduce((total, edge) => {
        if (edge.fromNodeId !== node.id && edge.toNodeId !== node.id) return total;
        const raw = rawBigInt(edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.originalAmountRaw);
        return total + (raw === null ? 0 : Number(raw > 9007199254740991n ? 9007199254740991n : raw));
      }, 0);
      const serviceBoost = nodeIsServiceLike(node) ? 1000000 : 0;
      const stopBoost = nodeDisplayKind(node) === "trace_stop" ? 900000 : 0;
      return directWeight * 1000 + relatedRaw + serviceBoost + stopBoost;
    }
    function rankNodesByImportance(nodes, edges) {
      return [...nodes].sort((a, b) => {
        const score = nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges);
        return score !== 0 ? score : String(a.id).localeCompare(String(b.id));
      });
    }
    function collapsedGroupNode(id, label, count, xHint, yHint, groupKind) {
      return {
        id,
        kind: "group",
        displayKind: "collapsed_group",
        label: "+" + count + " " + label,
        weight: count,
        metadata: { groupKind, collapsedCount: count, xHint, yHint }
      };
    }
    function collapsedGroupEdge(id, fromNodeId, toNodeId, groupKind) {
      return {
        id: "collapsed-edge:" + id,
        fromNodeId,
        toNodeId,
        type: "collapsed_group",
        displayRole: "collapsed_group",
        verdict: "review",
        weight: 1,
        metadata: { groupKind }
      };
    }
```

- [ ] **Step 4: Add collapsed-group display mapping**

In `nodeDisplayKind(node)`, after the subject check, add:

```js
      if (node.kind === "group" || node.displayKind === "collapsed_group") return "collapsed_group";
```

In `canvasNodeLabel(node)`, before the final `return short(...)`, add:

```js
      if (kind === "collapsed_group") return node.label || "Group";
```

In `nodeVisualClass(node)`, no change is needed because it will produce `node-display-collapsed_group`.

- [ ] **Step 5: Add dense fan presentation helper**

Place this after `graphDisplayMode(nodes, edges)`:

```js
    function buildDenseFanPresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const incoming = nodes.filter((node) => node.id !== subjectId && nodeLayoutSide(node, subjectId, edges) === "incoming");
      const outgoing = nodes.filter((node) => node.id !== subjectId && nodeLayoutSide(node, subjectId, edges) === "outgoing");
      const services = nodes.filter((node) => node.id !== subjectId && nodeIsServiceLike(node));
      const context = nodes.filter((node) =>
        node.id !== subjectId &&
        !incoming.includes(node) &&
        !outgoing.includes(node) &&
        !services.includes(node)
      );
      const keepIncoming = new Set(rankNodesByImportance(incoming, edges).slice(0, 8).map((node) => node.id));
      const keepOutgoing = new Set(rankNodesByImportance(outgoing, edges).slice(0, 8).map((node) => node.id));
      const keepServices = new Set(rankNodesByImportance(services, edges).slice(0, 8).map((node) => node.id));
      const keepContext = new Set(rankNodesByImportance(context, edges).slice(0, 6).map((node) => node.id));
      const keptIds = new Set([subjectId, ...keepIncoming, ...keepOutgoing, ...keepServices, ...keepContext]);
      const hiddenIncoming = incoming.filter((node) => !keptIds.has(node.id));
      const hiddenOutgoing = outgoing.filter((node) => !keptIds.has(node.id));
      const hiddenServices = services.filter((node) => !keptIds.has(node.id));
      const hiddenContext = context.filter((node) => !keptIds.has(node.id));
      const visualNodes = nodes.filter((node) => keptIds.has(node.id));
      const visualEdges = edges.filter((edge) => keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId));
      const addGroup = (key, label, hidden, groupKind) => {
        if (hidden.length === 0) return;
        const groupId = "collapsed:" + key;
        visualNodes.push(collapsedGroupNode(groupId, label, hidden.length, 0, 0, groupKind));
        visualEdges.push(collapsedGroupEdge(key, subjectId, groupId, groupKind));
      };
      addGroup("incoming", "small funders", hiddenIncoming, "incoming");
      addGroup("outgoing", "small outgoing", hiddenOutgoing, "outgoing");
      addGroup("service", "services", hiddenServices, "service");
      addGroup("context", "context", hiddenContext, "context");
      return { nodes: visualNodes, edges: visualEdges };
    }
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "deterministic dense fan presentation"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Add dense admin graph presentation helpers"
```

---

### Task 3: Implement Fan Overview And Show-All Timeline Layout

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing test for layout routing**

Append this test:

```ts
  it("routes dense graphs between fan overview and show-all timeline layout", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function legacyFanLayout");
    expect(html).toContain("function denseFanLayout");
    expect(html).toContain("function timelineLaneLayout");
    expect(html).toContain("const mode = graphDisplayMode(sourceNodes, sourceEdges);");
    expect(html).toContain('if (mode === "show_all") return timelineLaneLayout(sourceNodes, sourceEdges);');
    expect(html).toContain("const presentation = buildDenseFanPresentation(sourceNodes, sourceEdges);");
    expect(html).toContain("return denseFanLayout(presentation.nodes, presentation.edges);");
    expect(html).toContain("const width = Math.max(1900, 680 + sourceNodes.length * 34);");
    expect(html).toContain("const laneY = { incoming: height * 0.25, subject: height * 0.48, outgoing: height * 0.63, service: height * 0.78, context: height * 0.36 };");
  });
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "routes dense graphs"
```

Expected: FAIL.

- [ ] **Step 3: Rename the current layout body**

In `src/admin/adminConsole.ts`, rename the current `function graphFirstLayout(sourceNodes, sourceEdges)` declaration to:

```js
    function legacyFanLayout(sourceNodes, sourceEdges) {
```

Keep the current body unchanged in this step.

- [ ] **Step 4: Add dense fan layout**

Add this function after `legacyFanLayout(...)`:

```js
    function denseFanLayout(sourceNodes, sourceEdges) {
      const width = 1900;
      const height = 1120;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const subjectX = width * 0.50;
      const subjectY = height * 0.50;
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
        ...arrangeCluster(incomingNodes, width * 0.23, subjectY, 390, 470, -1.42, 1.42),
        ...arrangeCluster(outgoingNodes, width * 0.79, subjectY, 430, 500, -1.55, 1.55),
        ...arrangeCluster(serviceNodes, width * 0.66, subjectY + 150, 430, 250, -2.20, .30),
        ...arrangeCluster(contextNodes, width * 0.45, subjectY + 235, 420, 260, -2.80, -.55)
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 34);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      const byId = new Map(boundedNodes.map((node) => [node.id, node]));
      return { width, height, nodes: boundedNodes, byId };
    }
```

- [ ] **Step 5: Add timeline lane layout**

Add this after `denseFanLayout(...)`:

```js
    function timelineLaneLayout(sourceNodes, sourceEdges) {
      const width = Math.max(1900, 680 + sourceNodes.length * 34);
      const height = 1160;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const laneY = { incoming: height * 0.25, subject: height * 0.48, outgoing: height * 0.63, service: height * 0.78, context: height * 0.36 };
      const sorted = rankNodesByImportance(sourceNodes, sourceEdges).reverse();
      const nodes = sorted.map((node, index) => {
        const side = node.id === subjectId ? "subject" : nodeLayoutSide(node, subjectId, sourceEdges);
        const lane = side === "incoming" || side === "outgoing" || side === "service" || side === "subject" ? side : "context";
        const x = 220 + index * Math.max(46, Math.min(84, 1400 / Math.max(1, sourceNodes.length)));
        const rowOffset = (index % 5 - 2) * 34;
        return {
          ...node,
          x: node.id === subjectId ? width * 0.52 : x,
          y: laneY[lane] + (node.id === subjectId ? 0 : rowOffset)
        };
      });
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 20);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
```

- [ ] **Step 6: Recreate graphFirstLayout as router**

After the three layout helpers, add:

```js
    function graphFirstLayout(sourceNodes, sourceEdges) {
      const mode = graphDisplayMode(sourceNodes, sourceEdges);
      if (mode === "show_all") return timelineLaneLayout(sourceNodes, sourceEdges);
      if (graphIsDense(sourceNodes, sourceEdges)) {
        const presentation = buildDenseFanPresentation(sourceNodes, sourceEdges);
        return denseFanLayout(presentation.nodes, presentation.edges);
      }
      return legacyFanLayout(sourceNodes, sourceEdges);
    }
```

- [ ] **Step 7: Update renderGraph to use presentation edges in fan mode**

Inside `renderGraph()`, replace:

```js
      const visibleEdges = filteredGraphEdges();
```

with:

```js
      const rawVisibleEdges = filteredGraphEdges();
      const rawConnectedNodeIds = new Set();
      rawVisibleEdges.forEach((edge) => {
        if (edge?.fromNodeId) rawConnectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) rawConnectedNodeIds.add(edge.toNodeId);
      });
      const rawVisibleNodes = graphNodes(graph).filter((node) => node.kind === "subject" || rawConnectedNodeIds.has(node.id));
      const densePresentation = graphDisplayMode(rawVisibleNodes, rawVisibleEdges) === "fan" && graphIsDense(rawVisibleNodes, rawVisibleEdges)
        ? buildDenseFanPresentation(rawVisibleNodes, rawVisibleEdges)
        : { nodes: rawVisibleNodes, edges: rawVisibleEdges };
      const visibleEdges = densePresentation.edges;
```

Then replace the later `visibleNodes` derivation block with:

```js
      const visibleNodes = densePresentation.nodes;
```

- [ ] **Step 8: Run focused test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "routes dense graphs"
```

Expected: PASS.

- [ ] **Step 9: Run admin console tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Route dense admin graphs through fan layouts"
```

---

### Task 4: Add Peer-Link Classification, Toggle Behavior, And Styling

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing peer-link test**

Append:

```ts
  it("contains peer-link classification and selected-neighbor highlighting", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphSubjectNodeId");
    expect(html).toContain("function edgeIsPeerLink");
    expect(html).toContain("return edge?.fromNodeId !== subjectId && edge?.toNodeId !== subjectId;");
    expect(html).toContain("function edgePassesPeerLinkFilter");
    expect(html).toContain("if (!state.peerLinksVisible && edgeIsPeerLink(edge)) return false;");
    expect(html).toContain("function edgeIsSelectionRelated");
    expect(html).toContain('edge-flow-peer');
    expect(html).toContain(".edge-flow-peer");
    expect(html).toContain(".edge-flow-peer.selected");
  });
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "peer-link classification"
```

Expected: FAIL.

- [ ] **Step 3: Add CSS for peer links**

Near the existing `.edge-flow-*` styles, add:

```css
    .edge-flow-peer { stroke: rgba(246, 193, 119, .58); stroke-dasharray: 10 8; }
    .edge-flow-peer.selected { stroke: #ffd08a; stroke-dasharray: none; }
```

- [ ] **Step 4: Add peer-link helper functions**

Near `edgeVisualRole(edge)`, add:

```js
    function graphSubjectNodeId() {
      return graphNodes(state.graph).find((node) => node.kind === "subject")?.id || "";
    }
    function edgeIsPeerLink(edge) {
      const subjectId = graphSubjectNodeId();
      if (!subjectId || !edge?.fromNodeId || !edge?.toNodeId) return false;
      return edge?.fromNodeId !== subjectId && edge?.toNodeId !== subjectId;
    }
    function edgePassesPeerLinkFilter(edge) {
      if (!state.peerLinksVisible && edgeIsPeerLink(edge)) return false;
      return true;
    }
    function edgeIsSelectionRelated(edge) {
      if (!state.selected) return true;
      if (state.selected.type === "edge") return state.selected.id === edge.id;
      if (state.selected.type === "node") return edge.fromNodeId === state.selected.id || edge.toNodeId === state.selected.id;
      return true;
    }
```

- [ ] **Step 5: Apply peer-link filtering**

Change `filteredGraphEdges()` from:

```js
      return graphEdges(state.graph).filter((edge) => edgePassesFlowFilter(edge) && edgePassesServiceFilter(edge) && edgePassesTimelineRange(edge));
```

to:

```js
      return graphEdges(state.graph).filter((edge) =>
        edgePassesFlowFilter(edge) &&
        edgePassesServiceFilter(edge) &&
        edgePassesTimelineRange(edge) &&
        edgePassesPeerLinkFilter(edge)
      );
```

- [ ] **Step 6: Add peer visual role**

At the start of `edgeVisualRole(edge)`, after the stop/context checks, add:

```js
      if (edgeIsPeerLink(edge)) return "peer";
```

- [ ] **Step 7: Highlight selected peer links**

Inside `renderGraph()`, replace the `visible` constant with:

```js
        const relatedToSelection = edgeIsSelectionRelated(edge);
        const visible = matchesSearch(edge) && (!state.selected || selected || relatedToSelection);
```

Keep the existing `dim` behavior:

```js
        const cls = "edge edge-flow-" + escapeHtml(visualRole) + " " + escapeHtml(edge.verdict) + (selected ? " selected" : "") + (visible ? "" : " dim");
```

- [ ] **Step 8: Run focused test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "peer-link classification"
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Add admin graph peer-link layer"
```

---

### Task 5: Clean Canvas Labels And Move Time To Timeline/Details

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing label behavior test**

Append:

```ts
  it("keeps dense edge labels compact and removes canvas time pills", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function compactAmountLabel");
    expect(html).toContain("return trimNumber(amount / 1000) + \"K\";");
    expect(html).toContain("function edgeCanvasLabel");
    expect(html).toContain("return compactAmountLabel(edgeOriginalAmount(edge) || edgeAmount(edge));");
    expect(html).toContain("const label = state.amountMode === \"off\"");
    expect(html).toContain("? []");
    expect(html).toContain(": [shouldShowAmount ? amountLabel : \"\"].filter(Boolean);");
    expect(html).not.toContain("[shouldShowAmount ? amountLabel : \"\", timeLabel].filter(Boolean)");
    expect(html).toContain("Full time");
  });
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "dense edge labels compact"
```

Expected: FAIL.

- [ ] **Step 3: Add compact amount helper**

After `formatRawUsdt(rawValue)`, add:

```js
    function compactAmountLabel(label) {
      const match = String(label || "").match(/^([0-9.]+)([KMB])? USDT$/);
      if (!match) return label || "";
      const value = Number(match[1]);
      if (!Number.isFinite(value)) return label || "";
      const suffix = match[2] || "";
      if (suffix) return trimNumber(value) + suffix;
      if (value >= 1000) return trimNumber(value / 1000) + "K";
      return trimNumber(value);
    }
```

- [ ] **Step 4: Add edge canvas label helper**

Replace `edgeCanvasAmountLabel(edge)` with:

```js
    function edgeCanvasAmountLabel(edge) {
      return edgeOriginalAmount(edge) || edgeAmount(edge);
    }
    function edgeCanvasLabel(edge) {
      return compactAmountLabel(edgeOriginalAmount(edge) || edgeAmount(edge));
    }
```

- [ ] **Step 5: Remove time from canvas labels**

Inside `renderGraph()`, replace:

```js
        const amountLabel = edgeShouldShowAmount(edge) ? edgeCanvasAmountLabel(edge) : "";
        const shouldShowAmount = edgeShouldShowAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel));
        const timeLabel = edgeShouldShowAmount(edge) ? edgeTimeConnectionLabel(edge) : "";
        const label = state.amountMode === "off"
          ? []
          : [shouldShowAmount ? amountLabel : "", timeLabel].filter(Boolean);
```

with:

```js
        const amountLabel = edgeShouldShowAmount(edge) ? edgeCanvasLabel(edge) : "";
        const shouldShowAmount = edgeShouldShowAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel && !edgeIsPeerLink(edge)));
        const label = state.amountMode === "off"
          ? []
          : [shouldShowAmount ? amountLabel : ""].filter(Boolean);
```

- [ ] **Step 6: Add full time to selected flow card**

In `selectedEdgeCard(edge)`, add this line after `cardLine("Amount", ...)`:

```js
        cardLine("Full time", edgeTime(edge) || "time n/a") +
```

- [ ] **Step 7: Run focused test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "dense edge labels compact"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Clean dense graph edge labels"
```

---

### Task 6: Add Connected Neighbors Block To Analytics Rail

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing connected-neighbors test**

Append:

```ts
  it("shows selected node connected neighbors in the analytics rail", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function connectedNeighborLines");
    expect(html).toContain("Connected neighbors");
    expect(html).toContain("edgeIsPeerLink(edge)");
    expect(html).toContain("addressDetailLink(otherAddress)");
    expect(html).toContain("txDetailLink(edge.txHash || \"inferred\")");
    expect(html).toContain('listMetric("Connected neighbors", connectedNeighborLines(node), "No connected neighbor links.")');
  });
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "connected neighbors"
```

Expected: FAIL.

- [ ] **Step 3: Add connected-neighbor helper**

Near the selected node detail helpers, add:

```js
    function connectedNeighborLines(node) {
      if (!node) return [];
      return graphEdges(state.graph)
        .filter((edge) => edgeIsPeerLink(edge) && (edge.fromNodeId === node.id || edge.toNodeId === node.id))
        .slice(0, 12)
        .map((edge) => {
          const otherNodeId = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
          const other = nodeById(otherNodeId);
          const otherAddress = nodeAddress(other) || otherNodeId;
          const amount = edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount n/a";
          const time = edgeTime(edge) || "time n/a";
          const tx = txDetailLink(edge.txHash || "inferred");
          return addressDetailLink(otherAddress) + " / " + escapeHtml(amount) + " / " + escapeHtml(time) + " / " + tx;
        });
    }
```

- [ ] **Step 4: Render connected neighbors in selected node details**

In `renderNodeDetails(node)`, after the selected address metric, add:

```js
        listMetric("Connected neighbors", connectedNeighborLines(node), "No connected neighbor links.") +
```

If `renderNodeDetails(node)` does not exist as a named function, add the line to the existing selected-node metric grid where it currently renders:

```js
        metricHtml("Address", addressDetailLink(nodeAddress(node) || node.id), "wide") +
```

The final section should include:

```js
        metricHtml("Address", addressDetailLink(nodeAddress(node) || node.id), "wide") +
        listMetric("Connected neighbors", connectedNeighborLines(node), "No connected neighbor links.") +
```

- [ ] **Step 5: Run focused test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "connected neighbors"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Show connected neighbors in admin analytics"
```

---

### Task 7: Browser QA And Final Review

**Files:**
- Modify only if QA finds a real bug:
  - `src/admin/adminConsole.ts`
  - `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Run full test suite**

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

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Start admin server from this branch**

Use the existing local token and port:

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\User\OneDrive\Desktop\smartcontract\.env'
$env:ADMIN_DASHBOARD_ENABLED='true'
$env:ADMIN_DASHBOARD_TOKEN='local-admin-token'
$env:ADMIN_DASHBOARD_HOST='127.0.0.1'
$env:ADMIN_DASHBOARD_PORT='8788'
npm run dev
```

Expected log lines:

```text
admin_dashboard_started
bot_started
```

- [ ] **Step 5: Browser-check dense TYDaeo graph**

Open:

```text
http://127.0.0.1:8788/admin/forensics?query=TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC&limit=50
```

Check:

- dense graph starts in fan overview;
- important nodes do not overlap;
- collapsed group nodes are visible when the graph is dense;
- `Show all` expands the map;
- `Peer links off` hides peer links;
- `Peer links on` shows peer links;
- selecting a neighbor highlights peer links to nearby wallets/services;
- edge labels show short amount only;
- selected flow card shows full time;
- right analytics rail shows connected neighbors for selected nodes.

- [ ] **Step 6: Browser-check non-dense graph**

Open a small `incoming_deposit_check` job from the Jobs rail.

Check:

- graph still loads;
- existing path shape still reads correctly;
- `Show all` does not damage small graphs;
- selected edge details still stay inside the analytics rail.

- [ ] **Step 7: Fix only confirmed QA bugs**

If a check fails, make the smallest code change in `src/admin/adminConsole.ts` and add a focused string-contract assertion in `tests/admin/adminConsole.test.ts`.

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit QA fixes**

If Step 7 changed files, run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "Polish dense admin graph fan QA"
```

If Step 7 made no changes, do not create an empty commit.

---

## Plan Self-Review

Spec coverage:

- Fast-check fan default: Task 2 and Task 3.
- Show all timeline-lane map: Task 1 and Task 3.
- Short edge amount labels and time moved out of edge pills: Task 5.
- Peer links between neighboring wallets/services: Task 4.
- Connected-neighbor details in right rail: Task 6.
- Manual drag and reset layout preserved: Task 3 keeps existing position override flow; Task 7 verifies it.
- No backend/Telegram/dependency changes: File Structure and Task scopes keep work in admin UI/tests.

Placeholder scan:

- No unresolved implementation markers are required by this plan.
- Every code-editing task includes the function names and snippets to add or replace.

Type consistency:

- State keys are `densityMode` and `peerLinksVisible`.
- Control ids are `densityMode` and `peerLinksMode`.
- Dense layout helpers are `graphIsDense`, `graphDisplayMode`, `buildDenseFanPresentation`, `denseFanLayout`, `timelineLaneLayout`, and `legacyFanLayout`.
- Peer helpers are `graphSubjectNodeId`, `edgeIsPeerLink`, `edgePassesPeerLinkFilter`, `edgeIsSelectionRelated`, and `connectedNeighborLines`.
