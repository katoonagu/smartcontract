# Admin Step Orbit Graph V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dense admin forensic graphs readable by default with a Step Orbit map that separates steps, groups, services, boundaries, time, amount, and peer links.

**Architecture:** Keep the existing vanilla TypeScript + embedded HTML/SVG admin console. Add a focused Step Orbit presentation/layout path inside `src/admin/adminConsole.ts`, reuse existing graph data from `src/admin/forensicsGraph.ts`, and only add backend projection fields if a UI requirement cannot be satisfied from saved graph metadata. Avoid React and new dependencies in this pass.

**Tech Stack:** TypeScript, embedded admin HTML/SVG, existing `src/admin/adminConsole.ts`, existing `src/admin/forensicsGraph.ts`, Vitest.

---

## Source Design

Read before implementation:

- `docs/superpowers/specs/2026-06-23-admin-step-orbit-graph-v4-design.md`
- `docs/superpowers/specs/2026-06-22-incoming-where-money-cluster-timeline-graph-design.md`
- `docs/superpowers/specs/2026-06-22-admin-graph-density-fan-peer-links-design.md`
- `docs/superpowers/prototypes/2026-06-22-cluster-timeline-graph-mockup.html`

## File Structure

- Modify `src/admin/adminConsole.ts`
  - Add Step Orbit display mode for dense `incoming_deposit_check` and `where_is_money_check`.
  - Replace the current dense `clusterTimelineLayout` default with a wider step/orbit layout.
  - Keep `show_all` as the raw/timeline-lane reveal mode.
  - Add honest edge time labels: `hold`, `span`, `gap`, transaction time, or `time n/a`.
  - Add line/node glow classes and capped edge weights.
  - Make group/bundle/right-rail details explain what is inside and whether the group is real data or UI-only.
  - Make pan and node drag update transforms directly instead of full SVG rerender on every mouse move.

- Modify `tests/admin/adminConsole.test.ts`
  - Add static contracts for Step Orbit helpers, labels, glow classes, group details, services toggle, and pan/drag responsiveness.
  - Update existing dense-mode assertions from "Cluster timeline" to "Step orbit".

- Modify `src/admin/forensicsGraph.ts` only if Task 6 shows missing data that the UI cannot infer honestly.
  - Acceptable additions: metadata fields already derivable during projection, such as group time span, member timestamps, or related edge ids.
  - Do not invent internal bundle links.

- Modify `tests/admin/forensicsGraph.test.ts` only if `src/admin/forensicsGraph.ts` changes.

## Implementation Rules

- No React migration.
- No new dependency.
- No scoring changes.
- No Telegram bot changes.
- Do not fake group internals.
- Keep current jobs/history/admin APIs unchanged.
- Commit after each task that passes its local checks.

## Task 1: Rename Dense Default To Step Orbit

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Update the failing dense-mode test**

In `tests/admin/adminConsole.test.ts`, replace the current test named:

```typescript
it("defaults dense incoming and where-is-money graphs to cluster timeline mode", () => {
```

with:

```typescript
  it("defaults dense incoming and where-is-money graphs to step orbit mode", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("adminForensicsGraphViewMode");
    expect(html).toContain('if (mode === "show_all") return "show_all";');
    expect(html).toContain('if (mode === "fan") return "fan";');
    expect(html).toContain('if (graphKindSupportsStepOrbit(state.graph?.job?.kind)) return "step_orbit";');
    expect(html).toContain('return "fan";');
    expect(html).toContain("function graphKindSupportsStepOrbit");
    expect(html).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(html).toContain("function buildStepOrbitPresentation");
    expect(html).toContain("function stepOrbitLayout");
    expect(html).toContain('if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('densityButton.textContent = mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";');
    expect(html).toContain('"Step orbit"');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because the code still uses `graphKindSupportsClusterTimeline`, `buildClusterTimelinePresentation`, `clusterTimelineLayout`, and `"Cluster timeline"`.

- [ ] **Step 3: Rename the mode helpers**

In `src/admin/adminConsole.ts`, replace:

```javascript
    function graphKindSupportsClusterTimeline(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check";
    }
```

with:

```javascript
    function graphKindSupportsStepOrbit(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check";
    }
```

Replace the dense default in `graphDisplayMode`:

```javascript
      if (graphKindSupportsClusterTimeline(state.graph?.job?.kind)) return "cluster";
```

with:

```javascript
      if (graphKindSupportsStepOrbit(state.graph?.job?.kind)) return "step_orbit";
```

Keep this compatibility rule in the mode normalization path:

```javascript
    if (!["auto", "fan", "show_all", "step_orbit"].includes(state.densityMode)) state.densityMode = "auto";
```

- [ ] **Step 4: Rename the toolbar copy**

In `syncDenseGraphControls`, replace the density button label with:

```javascript
        densityButton.textContent = mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";
```

- [ ] **Step 5: Run the test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS for the renamed dense-mode contract or FAIL only on tests that still reference old cluster names.

- [ ] **Step 6: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: default dense admin graphs to step orbit"
```

## Task 2: Add Step Orbit Presentation And Group Semantics

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add the failing presentation test**

Add this test near the existing cluster/dense presentation tests:

```typescript
  it("builds step orbit presentation with real groups and ui-collapsed groups separated", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function stepOrbitRole");
    expect(html).toContain("function buildStepOrbitPresentation");
    expect(html).toContain("function stepOrbitSummaryNode");
    expect(html).toContain('displayKind: "collapsed_group"');
    expect(html).toContain("uiCollapsedGroup: true");
    expect(html).toContain("realGroupKind");
    expect(html).toContain("groupReason");
    expect(html).toContain("step:source");
    expect(html).toContain("step:funding");
    expect(html).toContain("step:service");
    expect(html).toContain("step:stop");
    expect(html).toContain('if (!state.servicesVisible && role === "service") return;');
    expect(html).toContain("state.expandedBundleNodeIds.has(node.id)");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because Step Orbit presentation helpers do not exist yet.

- [ ] **Step 3: Add Step Orbit role helper**

In `src/admin/adminConsole.ts`, add this next to `clusterTimelineRole`, then remove `clusterTimelineRole` after all call sites are updated:

```javascript
    function stepOrbitRole(node, subjectId, edges) {
      if (!node) return "context";
      if (node.id === subjectId) return "subject";
      if (nodeDisplayKind(node) === "funding_bundle") return "funding";
      if (nodeDisplayKind(node) === "collapsed_group") {
        const role = node?.metadata?.stepOrbitRole || node?.metadata?.clusterRole || "";
        if (role === "source" || role === "funding" || role === "service" || role === "stop" || role === "context") return role;
        const groupKind = collapsedGroupLayoutSide(node?.metadata?.groupKind);
        if (groupKind === "incoming") return "source";
        if (groupKind === "outgoing" || groupKind === "service") return "service";
        return "context";
      }
      if (nodeDisplayKind(node) === "trace_stop") return "stop";
      if (nodeIsServiceLike(node)) return "service";
      const side = nodeLayoutSide(node, subjectId, edges);
      if (side === "incoming") return "source";
      if (side === "outgoing") return "service";
      return "context";
    }
```

- [ ] **Step 4: Add UI-only group summary helper**

Replace `collapsedClusterSummaryNode` with:

```javascript
    function stepOrbitSummaryNode(id, label, hiddenNodes, groupKind, stepOrbitRole, groupReason) {
      const count = hiddenNodes.length;
      return {
        id,
        kind: "group",
        displayKind: "collapsed_group",
        label: "Group: " + count + " " + label,
        weight: count,
        metadata: {
          groupKind,
          collapsedCount: count,
          clusterSummary: true,
          stepOrbitRole,
          uiCollapsedGroup: true,
          realGroupKind: "ui_collapsed_display_group",
          groupReason,
          hiddenNodeIds: hiddenNodes.map((node) => node.id)
        }
      };
    }
```

- [ ] **Step 5: Add `buildStepOrbitPresentation`**

Replace `buildClusterTimelinePresentation` with:

```javascript
    function buildStepOrbitPresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const roles = { source: [], funding: [], subject: [subject], service: [], stop: [], context: [] };
      nodes.forEach((node) => {
        if (node.id === subjectId) return;
        const role = stepOrbitRole(node, subjectId, edges);
        roles[role].push(node);
      });
      const keepSource = importantClusterNodes(roles.source, edges, 10);
      const keepFunding = importantClusterNodes(roles.funding, edges, 12);
      const keepService = importantClusterNodes(roles.service, edges, state.servicesVisible ? 10 : 0);
      const keepStop = importantClusterNodes(roles.stop, edges, 8);
      const keepContext = importantClusterNodes(roles.context, edges, 8);
      const keptIds = new Set([subjectId, ...keepSource, ...keepFunding, ...keepService, ...keepStop, ...keepContext]);
      const visualNodes = nodes.filter((node) => keptIds.has(node.id));
      const visualEdges = edges.filter((edge) => keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId));

      const addSummary = (id, label, hiddenNodes, groupKind, role, reason) => {
        if (hiddenNodes.length === 0) return;
        if (!state.servicesVisible && role === "service") return;
        const groupNode = stepOrbitSummaryNode(id, label, hiddenNodes, groupKind, role, reason);
        visualNodes.push(groupNode);
        visualEdges.push(collapsedGroupEdge(id.replace("step:", "step-"), subjectId, id, groupKind));
      };

      addSummary("step:source", "source wallets", roles.source.filter((node) => !keptIds.has(node.id)), "incoming", "source", "Lower-priority source wallets were collapsed to keep the money route readable.");
      addSummary("step:funding", "funding groups", roles.funding.filter((node) => !keptIds.has(node.id)), "context", "funding", "Lower-priority funding groups were collapsed; real funding bundles remain distinguishable in the right rail.");
      addSummary("step:service", "services", roles.service.filter((node) => !keptIds.has(node.id)), "service", "service", "Lower-priority service-like endpoints were collapsed.");
      addSummary("step:stop", "boundary stops", roles.stop.filter((node) => !keptIds.has(node.id)), "context", "stop", "Lower-priority boundary stops were collapsed.");
      addSummary("step:context", "context wallets", roles.context.filter((node) => !keptIds.has(node.id)), "context", "context", "Lower-priority context wallets were collapsed.");

      visualNodes.filter((node) => state.expandedBundleNodeIds.has(node.id)).forEach((bundleNode) => {
        const memberNodes = expandedBundleMemberNodes(bundleNode);
        const memberEdges = expandedBundleMemberEdges(bundleNode, memberNodes);
        memberNodes.forEach((member) => visualNodes.push(member));
        memberEdges.forEach((edge) => visualEdges.push(edge));
      });
      return { nodes: visualNodes, edges: visualEdges };
    }
```

- [ ] **Step 6: Wire Step Orbit presentation**

In `graphPresentation`, replace:

```javascript
      if (dense && mode === "cluster") {
        return { ...buildClusterTimelinePresentation(rawVisibleNodes, rawVisibleEdges), mode, dense };
      }
```

with:

```javascript
      if (dense && mode === "step_orbit") {
        return { ...buildStepOrbitPresentation(rawVisibleNodes, rawVisibleEdges), mode, dense };
      }
```

- [ ] **Step 7: Run the test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS for the new presentation contract.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add step orbit graph presentation"
```

## Task 3: Implement Wider Step Orbit Layout

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add the failing layout test**

Replace the current cluster timeline lane helper test with:

```typescript
  it("lays out step orbit graphs by investigation step with boundary and services separated", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function stepOrbitLayout");
    expect(html).toContain("const width = 2450;");
    expect(html).toContain("const height = 1360;");
    expect(html).toContain("const laneX = { source: width * 0.15, funding: width * 0.36, subject: width * 0.56, service: width * 0.78, stop: width * 0.91, context: width * 0.29 };");
    expect(html).toContain("const laneY = { source: height * 0.48, funding: height * 0.48, subject: height * 0.48, service: height * 0.35, stop: height * 0.62, context: height * 0.72 };");
    expect(html).toContain("function arrangeStepOrbitLane");
    expect(html).toContain("function relaxNodeCollisions");
    expect(html).toContain("relaxNodeCollisions(nodes, fixedNodeIds, 56)");
    expect(html).toContain("constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds)");
    expect(html).toContain('if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because `stepOrbitLayout` and `arrangeStepOrbitLane` are not implemented yet.

- [ ] **Step 3: Replace `arrangeTimelineLane` with `arrangeStepOrbitLane`**

In `src/admin/adminConsole.ts`, replace `arrangeTimelineLane` with:

```javascript
    function arrangeStepOrbitLane(nodes, x, centerY, gap, role) {
      const sorted = [...nodes].sort(stableNodeSort);
      const count = sorted.length;
      const startY = centerY - ((count - 1) * gap) / 2;
      return sorted.map((node, index) => {
        const orbitOffset = ((index % 3) - 1) * 26;
        const roleOffset = role === "service" ? -18 : role === "stop" ? 18 : 0;
        return {
          ...node,
          x: x + orbitOffset,
          y: startY + index * gap + roleOffset
        };
      });
    }
```

- [ ] **Step 4: Replace `clusterTimelineLayout` with `stepOrbitLayout`**

In `src/admin/adminConsole.ts`, replace `clusterTimelineLayout` with:

```javascript
    function stepOrbitLayout(sourceNodes, sourceEdges) {
      const width = 2450;
      const height = 1360;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const laneX = { source: width * 0.15, funding: width * 0.36, subject: width * 0.56, service: width * 0.78, stop: width * 0.91, context: width * 0.29 };
      const laneY = { source: height * 0.48, funding: height * 0.48, subject: height * 0.48, service: height * 0.35, stop: height * 0.62, context: height * 0.72 };
      const laneNodes = { source: [], funding: [], subject: [], service: [], stop: [], context: [] };
      sourceNodes.forEach((node) => {
        const role = stepOrbitRole(node, subjectId, sourceEdges);
        laneNodes[role].push(node);
      });
      const nodes = [
        ...arrangeStepOrbitLane(laneNodes.source, laneX.source, laneY.source, 112, "source"),
        ...arrangeStepOrbitLane(laneNodes.funding, laneX.funding, laneY.funding, 108, "funding"),
        ...arrangeStepOrbitLane(laneNodes.context, laneX.context, laneY.context, 100, "context"),
        ...arrangeStepOrbitLane(laneNodes.subject, laneX.subject, laneY.subject, 100, "subject"),
        ...arrangeStepOrbitLane(laneNodes.service, laneX.service, laneY.service, 102, "service"),
        ...arrangeStepOrbitLane(laneNodes.stop, laneX.stop, laneY.stop, 96, "stop")
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 56);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
```

- [ ] **Step 5: Wire `graphFirstLayout`**

Replace:

```javascript
      if (dense && mode === "cluster") return clusterTimelineLayout(sourceNodes, sourceEdges);
```

with:

```javascript
      if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);
```

- [ ] **Step 6: Run the test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS for layout contracts.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add step orbit graph layout"
```

## Task 4: Show Amount And Honest Time Labels On Edges

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add the failing edge-label test**

Replace the current test named `"caps edge thickness and keeps non-important labels off the canvas"` with:

```typescript
  it("shows calm amount and honest time labels on visible graph edges", () => {
    const html = adminConsoleHtml();
    const renderGraphBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function formatCanvasTimestamp");
    expect(html).toContain('return day + " " + monthName + ", " + hour + ":" + minute + " UTC";');
    expect(html).toContain("function edgeCanvasTimeLabel");
    expect(html).toContain('return "hold " + formatDurationMs(holdMs);');
    expect(html).toContain('return "span " + formatDurationMs(spanMs);');
    expect(html).toContain('return "gap " + gap;');
    expect(html).toContain('return formatCanvasTimestamp(edge?.timestamp || edgeTime(edge)) || "time n/a";');
    expect(html).toContain("function edgeCanvasLabelParts");
    expect(html).toContain("const timeLabel = edgeCanvasTimeLabel(edge);");
    expect(html).toContain("return [showAmount ? amountLabel : \"\", timeLabel].filter(Boolean);");
    expect(renderGraphBlock).toContain("const label = edgeCanvasLabelParts(edge);");
    expect(html).toContain(".amount-pill rect { fill: rgba(11, 14, 17, .86); stroke: transparent;");
    expect(html).toContain(".amount-pill .amount-line { fill: #f4f7fb; font-weight: 560;");
    expect(html).toContain(".amount-pill .time-line { fill: #9fc8ff;");
    expect(html).not.toContain(".amount-pill rect { fill: rgba(11, 14, 17, .94); stroke: rgba(217, 230, 242, .28);");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because the canvas still only labels selected amounts and uses the older short timestamp format.

- [ ] **Step 3: Replace the timestamp formatter**

In `src/admin/adminConsole.ts`, add:

```javascript
    function formatCanvasTimestamp(value) {
      if (!value) return "";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const day = String(date.getUTCDate()).padStart(2, "0");
      const monthName = months[date.getUTCMonth()];
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      return day + " " + monthName + ", " + hour + ":" + minute + " UTC";
    }
```

Keep `shortTimestamp` only for old right-rail summaries if needed.

- [ ] **Step 4: Add honest time-label logic**

Add this near `edgeTxGap`:

```javascript
    function edgeCanvasTimeLabel(edge) {
      const holdMs = Number(edge?.metadata?.holdMs ?? edge?.metadata?.idleMs);
      if (Number.isFinite(holdMs) && holdMs >= 0 && edge?.metadata?.holdProof === true) return "hold " + formatDurationMs(holdMs);
      const spanMs = Number(edge?.metadata?.spanMs ?? edge?.metadata?.timeSpanMs ?? edge?.metadata?.bundleTimeSpanMs);
      if (Number.isFinite(spanMs) && spanMs > 0 && (edgeDisplayRole(edge) === "bundle_member" || edge?.metadata?.bundleRole || edge?.metadata?.groupTimeSpanProof === true)) return "span " + formatDurationMs(spanMs);
      const gap = edgeTxGap(edge);
      if (gap) return "gap " + gap;
      return formatCanvasTimestamp(edge?.timestamp || edgeTime(edge)) || "time n/a";
    }
```

- [ ] **Step 5: Replace canvas label composition**

Add:

```javascript
    function edgeCanvasLabelParts(edge) {
      const amountLabel = edgeCanvasLabel(edge);
      const timeLabel = edgeCanvasTimeLabel(edge);
      const showAmount = edgeShouldShowCanvasAmount(edge) && state.amountMode !== "off" && (state.amountMode === "all" || amountLabel);
      return [showAmount ? amountLabel : "", timeLabel].filter(Boolean);
    }
```

In `renderGraph`, replace:

```javascript
        const amountLabel = edgeCanvasLabel(edge);
        const shouldShowAmount = edgeShouldShowCanvasAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel));
        const label = state.amountMode === "off"
          ? []
          : [shouldShowAmount ? amountLabel : ""].filter(Boolean);
```

with:

```javascript
        const label = edgeCanvasLabelParts(edge);
```

- [ ] **Step 6: Calm down the amount pill CSS**

Replace the current `.amount-pill` CSS with:

```css
    .amount-pill rect { fill: rgba(11, 14, 17, .86); stroke: transparent; stroke-width: 0; rx: 5; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 5px rgba(255, 255, 255, .10)); }
    .amount-pill text { paint-order: stroke; stroke: rgba(11, 14, 17, .72); stroke-width: 1.6px; stroke-linejoin: round; }
    .amount-pill .amount-line { fill: #f4f7fb; font-size: 10.5px; font-weight: 560; }
    .amount-pill .time-line { fill: #9fc8ff; font-size: 9.5px; font-weight: 620; }
```

Update `amountPill` so the first line gets `class="amount-line"` and the second line gets `class="time-line"`:

```javascript
        const className = index === 0 ? ' class="amount-line"' : ' class="time-line"';
```

- [ ] **Step 7: Run the test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS for the edge-label contract.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: show step orbit edge time labels"
```

## Task 5: Add Semantic Glow And Cap Visual Noise

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add the failing glow test**

Add this test near the semantic visual tests:

```typescript
  it("uses speed glow, semantic amount glow, and node-type glow without yellow label borders", () => {
    const html = adminConsoleHtml();
    const renderGraphBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeSpeedClass");
    expect(html).toContain('if (gapMs <= 15 * 60000) return "speed-15m";');
    expect(html).toContain('if (gapMs <= 60 * 60000) return "speed-1h";');
    expect(html).toContain('if (gapMs <= 6 * 60 * 60000) return "speed-6h";');
    expect(html).toContain('if (gapMs <= 24 * 60 * 60000) return "speed-24h";');
    expect(html).toContain("function edgeAmountImportanceClass");
    expect(html).toContain("function edgeVisibleAmountNumber");
    expect(html).toContain("const majorAmountCutoff = visibleEdgeMajorAmountCutoff(visibleEdges);");
    expect(renderGraphBlock).toContain("edgeSpeedClass(edge)");
    expect(renderGraphBlock).toContain("edgeAmountImportanceClass(edge, majorAmountCutoff)");
    expect(html).toContain(".edge.speed-15m");
    expect(html).toContain(".edge.speed-1h");
    expect(html).toContain(".edge.speed-6h");
    expect(html).toContain(".edge.speed-24h");
    expect(html).toContain(".edge.major-amount");
    expect(html).toContain(".node-display-funding_bundle circle {");
    expect(html).toContain("filter: drop-shadow(0 0 9px rgba(196, 150, 255, .32));");
    expect(html).not.toContain("stroke: rgba(246, 193, 119");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because glow classes and major amount cutoff are missing.

- [ ] **Step 3: Add edge speed and amount helpers**

Add near `edgeStrokeWidth`:

```javascript
    function edgeSpeedClass(edge) {
      const gapMs = Number(edge?.metadata?.txGapMs);
      if (!Number.isFinite(gapMs) || gapMs < 0) return "";
      if (gapMs <= 15 * 60000) return "speed-15m";
      if (gapMs <= 60 * 60000) return "speed-1h";
      if (gapMs <= 6 * 60 * 60000) return "speed-6h";
      if (gapMs <= 24 * 60 * 60000) return "speed-24h";
      return "";
    }
    function edgeVisibleAmountNumber(edge) {
      const raw = rawBigInt(edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.originalAmountRaw);
      if (raw === null) return 0;
      return Number(raw > 9007199254740991n ? 9007199254740991n : raw);
    }
    function visibleEdgeMajorAmountCutoff(edges) {
      const amounts = edges.map(edgeVisibleAmountNumber).filter((value) => value > 0).sort((a, b) => b - a);
      if (amounts.length === 0) return Number.POSITIVE_INFINITY;
      const index = Math.max(0, Math.floor(amounts.length * 0.2) - 1);
      return amounts[index] || Number.POSITIVE_INFINITY;
    }
    function edgeAmountImportanceClass(edge, majorAmountCutoff) {
      const amount = edgeVisibleAmountNumber(edge);
      if (amount <= 0 || amount < majorAmountCutoff) return "";
      return "major-amount";
    }
```

- [ ] **Step 4: Add classes in `renderGraph`**

Before `edgeSvg`, add:

```javascript
      const majorAmountCutoff = visibleEdgeMajorAmountCutoff(visibleEdges);
```

Replace the edge class composition with:

```javascript
        const cls = [
          "edge",
          "edge-flow-" + escapeHtml(visualRole),
          escapeHtml(edge.verdict),
          edgeSpeedClass(edge),
          edgeAmountImportanceClass(edge, majorAmountCutoff),
          selected ? "selected" : "",
          visible ? "" : "dim"
        ].filter(Boolean).join(" ");
```

- [ ] **Step 5: Add CSS for glow**

In `src/admin/adminConsole.ts`, update graph CSS with:

```css
    .edge { fill: none; stroke-linecap: round; opacity: .72; filter: drop-shadow(0 0 2px rgba(255, 255, 255, .15)); }
    .edge.speed-15m { filter: drop-shadow(0 0 4px rgba(117, 188, 255, .95)) drop-shadow(0 0 12px rgba(117, 188, 255, .46)); }
    .edge.speed-1h { filter: drop-shadow(0 0 4px rgba(117, 188, 255, .72)) drop-shadow(0 0 10px rgba(117, 188, 255, .32)); }
    .edge.speed-6h { filter: drop-shadow(0 0 3px rgba(117, 188, 255, .48)) drop-shadow(0 0 8px rgba(117, 188, 255, .22)); }
    .edge.speed-24h { filter: drop-shadow(0 0 3px rgba(198, 221, 255, .32)) drop-shadow(0 0 7px rgba(198, 221, 255, .16)); }
    .edge.edge-flow-incoming.major-amount, .edge.edge-flow-outgoing.major-amount { filter: drop-shadow(0 0 4px rgba(133, 225, 166, .45)) drop-shadow(0 0 11px rgba(133, 225, 166, .24)); }
    .edge.edge-flow-context.major-amount, .edge.edge-flow-service.major-amount { filter: drop-shadow(0 0 4px rgba(246, 193, 119, .44)) drop-shadow(0 0 11px rgba(246, 193, 119, .22)); }
    .node-display-funding_bundle circle { fill: #35244f; stroke: var(--bundle); filter: drop-shadow(0 0 9px rgba(196, 150, 255, .32)); }
    .node-display-service_boundary circle, .node-display-cex circle, .node-display-bridge circle, .node-display-dex_contract circle, .node-display-smart_contract circle, .node-display-contract_router circle, .node-display-contract_adapter circle { filter: drop-shadow(0 0 9px rgba(246, 193, 119, .26)); }
    .node-display-subject_wallet circle { filter: drop-shadow(0 0 11px rgba(122, 162, 247, .36)); }
```

- [ ] **Step 6: Keep edge width capped**

Verify `edgeStrokeWidth` still caps at `4.4`:

```javascript
      return Math.max(2, Math.min(4.4, scaled));
```

If any previous edit increased the cap, restore `4.4`.

- [ ] **Step 7: Run the test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS for glow and edge width contracts.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add semantic graph glow"
```

## Task 6: Make Expand Selected And Group Details Useful

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`
- Optional Modify: `src/admin/forensicsGraph.ts`
- Optional Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add the failing group detail test**

Replace or extend the current funding bundle detail test with:

```typescript
  it("explains funding bundles and ui-collapsed groups in the analytics rail", () => {
    const html = adminConsoleHtml();
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));

    expect(html).toContain("function groupDetailBlock");
    expect(html).toContain("function groupKindExplanation");
    expect(html).toContain("function groupHiddenNodeLines");
    expect(html).toContain("This is a UI-collapsed display group, not a wallet.");
    expect(html).toContain("This is a saved funding bundle, not a wallet.");
    expect(html).toContain("Internal transfers were not found in saved graph data.");
    expect(html).toContain("Known internal links");
    expect(html).toContain("External links");
    expect(walletDetailBlock).toContain('if (nodeDisplayKind(node) === "collapsed_group") return groupDetailBlock(node, graph);');
    expect(html).toContain('setStatus("Selected item has no expandable internals.");');
    expect(html).toContain('setStatus("Expanded collapsed graph groups.");');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because collapsed group details and non-silent expand fallback are missing or too thin.

- [ ] **Step 3: Add group explanation helpers**

In `src/admin/adminConsole.ts`, add near `bundleDetailBlock`:

```javascript
    function groupKindExplanation(node) {
      if (node?.metadata?.uiCollapsedGroup === true) return "This is a UI-collapsed display group, not a wallet.";
      if (nodeDisplayKind(node) === "funding_bundle") return "This is a saved funding bundle, not a wallet.";
      return "This is a graph group, not a wallet.";
    }
    function groupHiddenNodeLines(node) {
      return asArray(node?.metadata?.hiddenNodeIds).slice(0, 40).map((nodeId) => {
        const hidden = nodeById(nodeId);
        return (hidden ? canvasNodeLabel(hidden) : short(nodeId, 7)) + " / " + nodeId;
      });
    }
    function groupDetailBlock(node, graph) {
      const count = node?.metadata?.collapsedCount ?? node?.metadata?.memberCount ?? "n/a";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip("Display group", "bundle")) +
        metric("Meaning", groupKindExplanation(node), "wide") +
        metric("Why grouped", node?.metadata?.groupReason || "Lower-priority nodes were grouped so the route remains readable.", "wide") +
        metric("Group type", node?.metadata?.realGroupKind || "ui_collapsed_display_group") +
        metric("Members", count) +
        metric("Role", node?.metadata?.stepOrbitRole || node?.metadata?.clusterRole || "context") +
        '<button type="button" class="wide detail-action" data-action="expand-bundle">Expand selected</button>' +
        listMetric("Wallets/stops inside", groupHiddenNodeLines(node), "No hidden node list stored.") +
        listMetric("Known internal links", bundleInternalEdgeLines(node, graph), "Internal transfers were not found in saved graph data.") +
        listMetric("External links", bundleExternalEdgeLines(node, graph), "No external links stored.") +
        rawBlock("Group JSON", node) +
        '</div>';
    }
```

- [ ] **Step 4: Route collapsed groups into `groupDetailBlock`**

In `walletDetailBlock`, add before the funding bundle branch:

```javascript
      if (nodeDisplayKind(node) === "collapsed_group") return groupDetailBlock(node, graph);
```

- [ ] **Step 5: Make expand fallback explicit**

Replace `expandSelectedGraphItem` with:

```javascript
    function expandSelectedGraphItem() {
      if (!state.selected || state.selected.type !== "node") {
        setStatus("Select a group, bundle, or boundary first.");
        return;
      }
      if (isCollapsedGroupNodeId(state.selected.id)) {
        expandCollapsedGroup();
        return;
      }
      const node = nodeById(state.selected.id);
      if (nodeDisplayKind(node) === "trace_stop") {
        setTransferTab("stops");
        setStatus("Boundary details are shown in the right rail and stops table.");
        return;
      }
      if (nodeDisplayKind(node) !== "funding_bundle") {
        setStatus("Selected item has no expandable internals.");
        return;
      }
      state.expandedBundleNodeIds.add(state.selected.id);
      setStatus("Expanded selected funding bundle.");
      renderGraph();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
    }
```

- [ ] **Step 6: Check if projection needs real metadata**

Run:

```powershell
rg -n "relatedEdgeIds|topFunders|memberCount|timeSpanMs|spanMs|holdMs|txGapMs" src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
```

Expected:

- `relatedEdgeIds`, `topFunders`, and `memberCount` exist for saved funding bundles.
- `txGapMs` exists on transfer edges when the backend has it.
- If bundle time ranges are missing, keep `span` absent until backend has honest data.

If this command shows no honest source for a field, do not add fake UI values.

- [ ] **Step 7: Run tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: explain expandable graph groups"
```

If `src/admin/forensicsGraph.ts` did not change, stage only the two admin console files.

## Task 7: Make Pan And Node Drag Responsive

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add the failing drag responsiveness test**

Add this test near the per-job node drag test:

```typescript
  it("updates pan and node drag without selecting text or rerendering the full svg on every mousemove", () => {
    const html = adminConsoleHtml();
    const updateDragBlock = html.slice(html.indexOf("function updateNodeDrag"), html.indexOf("function suppressNextGraphClick"));
    const initPanBlock = html.slice(html.indexOf("function initPanZoom"), html.indexOf("function setAutoRefresh"));

    expect(html).toContain("body.graph-interacting, body.graph-interacting * { user-select: none;");
    expect(html).toContain("function setGraphInteracting");
    expect(html).toContain("function updateDraggedNodeDom");
    expect(html).toContain("function updateConnectedEdgeDom");
    expect(updateDragBlock).toContain("updateDraggedNodeDom(state.nodeDrag.nodeId, nextX, nextY);");
    expect(updateDragBlock).toContain("state.renderedNodePositions.set(state.nodeDrag.nodeId, { x: nextX, y: nextY });");
    expect(updateDragBlock).not.toContain("renderGraph();");
    expect(initPanBlock).toContain("event.preventDefault();");
    expect(initPanBlock).toContain("setGraphInteracting(true);");
    expect(initPanBlock).toContain("setGraphInteracting(false);");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because `updateNodeDrag` still calls `renderGraph()` during mouse movement.

- [ ] **Step 3: Add no-selection CSS**

Add to the admin CSS:

```css
    body.graph-interacting, body.graph-interacting * { user-select: none; }
```

- [ ] **Step 4: Add interaction helper**

Add near `applyTransform`:

```javascript
    function setGraphInteracting(active) {
      document.body.classList.toggle("graph-interacting", !!active);
    }
```

- [ ] **Step 5: Add direct DOM update helpers**

Add near `updateNodeDrag`:

```javascript
    function edgeGeometry(edge, placedById) {
      const from = placedById.get(edge.fromNodeId);
      const to = placedById.get(edge.toNodeId);
      if (!from || !to) return null;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const fromOffset = nodeRadius(from) + 3;
      const toOffset = nodeRadius(to) + 7;
      const startX = from.x + (dx / length) * fromOffset;
      const startY = from.y + (dy / length) * fromOffset;
      const endX = to.x - (dx / length) * toOffset;
      const endY = to.y - (dy / length) * toOffset;
      return { startX, startY, endX, endY };
    }
    function updateConnectedEdgeDom(nodeId) {
      const placedById = new Map(state.renderedNodesById);
      state.renderedNodePositions.forEach((position, id) => {
        const node = placedById.get(id);
        if (node) placedById.set(id, { ...node, x: position.x, y: position.y });
      });
      state.renderedEdgesById.forEach((edge) => {
        if (edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId) return;
        const geometry = edgeGeometry(edge, placedById);
        if (!geometry) return;
        const path = document.querySelector('[data-edge-id="' + CSS.escape(edge.id) + '"] path.edge');
        if (path) path.setAttribute("d", edgeCurvePath(geometry.startX, geometry.startY, geometry.endX, geometry.endY, edge));
      });
    }
    function updateDraggedNodeDom(nodeId, x, y) {
      const node = document.querySelector('[data-node-id="' + CSS.escape(nodeId) + '"]');
      if (node) node.setAttribute("transform", "translate(" + x + " " + y + ")");
      updateConnectedEdgeDom(nodeId);
    }
```

- [ ] **Step 6: Replace `updateNodeDrag`**

Replace the body of `updateNodeDrag` with:

```javascript
    function updateNodeDrag(event) {
      if (!state.nodeDrag) return false;
      event.preventDefault();
      const point = graphPointFromClient(event);
      const nextX = point.x + state.nodeDrag.offsetX;
      const nextY = point.y + state.nodeDrag.offsetY;
      state.nodeDrag.moved = true;
      state.renderedNodePositions.set(state.nodeDrag.nodeId, { x: nextX, y: nextY });
      updateDraggedNodeDom(state.nodeDrag.nodeId, nextX, nextY);
      return true;
    }
```

- [ ] **Step 7: Persist dragged node on mouseup**

In `finishNodeDrag`, save once on mouseup:

```javascript
      const nodeId = state.nodeDrag.nodeId;
      const position = state.renderedNodePositions.get(nodeId);
      if (moved && position) saveNodePositionOverride(nodeId, position.x, position.y);
```

Place this before `state.nodeDrag = null;`.

- [ ] **Step 8: Prevent text selection while panning**

In `initPanZoom`, update the pan start:

```javascript
      svg.addEventListener("mousedown", (event) => {
        if (event.target instanceof Element && event.target.closest("[data-node-id]")) return;
        event.preventDefault();
        drag = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y };
        setGraphInteracting(true);
        svg.classList.add("dragging");
      });
```

Update mouseup:

```javascript
        setGraphInteracting(false);
```

- [ ] **Step 9: Run the test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS for drag responsiveness contracts.

- [ ] **Step 10: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: make admin graph drag responsive"
```

## Task 8: Final QA And Admin Smoke Test

**Files:**
- Modify only if QA finds a regression in previous tasks.

- [ ] **Step 1: Run focused admin tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite if focused checks pass**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Start the app/admin locally**

Run the existing project startup command:

```powershell
npm run dev
```

Expected: local bot/admin process starts without TypeScript startup errors. Keep the terminal session open only while doing the browser smoke test.

- [ ] **Step 5: Browser smoke test dense Step Orbit**

Open the admin console and select a dense `where_is_money_check` job for `TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC`.

Verify:

- default button says `Step orbit`;
- source wallets, funding groups, subject, services, and boundary stops are visually separated;
- edge labels show amount plus time label;
- no ISO timestamp appears on canvas edge labels;
- `Show all raw` expands into raw lane/timeline view;
- `Services off` visibly removes service-like nodes/edges;
- selecting a funding group shows members and internal/external links in the right rail;
- `Expand selected` either expands the bundle or explicitly explains the selected item has no expandable internals;
- panning does not select page text;
- dragging a node feels immediate.

- [ ] **Step 6: Browser smoke test incoming deposit**

Select a dense `incoming_deposit_check` job.

Verify:

- default button says `Step orbit`;
- boundary/stop nodes sit away from the main wallet cluster;
- thick edges do not hide labels;
- fast edges are visibly glowed up to 24 hours;
- selected edge right rail shows amount, full time, tx gap, from, to, tx, and path.

- [ ] **Step 7: Commit final QA fixes**

If Step 1 through Step 6 required fixes, commit them:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix: polish step orbit graph qa issues"
```

If there were no changes, do not create an empty commit.

## Self-Review Checklist

- [ ] Dense `incoming_deposit_check` and `where_is_money_check` use Step Orbit by default.
- [ ] `Show all raw` still exists and reveals raw/timeline details.
- [ ] Services toggle visibly changes graph nodes/edges.
- [ ] Edge labels include a compact amount/time label.
- [ ] Canvas time labels use `hold`, `span`, `gap`, transaction time, or `time n/a` without overclaiming.
- [ ] Full timestamps remain available in the right rail and transfer table.
- [ ] Edge thickness remains capped.
- [ ] Speed glow applies through the 24-hour threshold.
- [ ] Node glow follows semantic node type.
- [ ] Selected node keeps semantic color and adds a selected state.
- [ ] Funding bundle and UI-collapsed group are visually and textually distinct.
- [ ] `Expand selected` is not silent.
- [ ] Pan does not select text.
- [ ] Node drag does not call `renderGraph()` on every mouse move.
- [ ] Focused admin tests, typecheck, and full tests pass before final handoff.
