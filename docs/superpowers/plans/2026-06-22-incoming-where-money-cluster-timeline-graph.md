# Incoming Where-Is-Money Cluster Timeline Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dense `incoming_deposit_check` and `where_is_money_check` graphs readable by default through a cluster timeline view with clear bundle semantics, capped line weight, and right-rail detail.

**Architecture:** Keep the existing vanilla HTML/SVG admin console. Add a presentation layer inside `src/admin/adminConsole.ts` that separates raw graph data from UI-only collapsed groups and real forensic funding bundles. Do not add React or a new build pipeline in this pass.

**Tech Stack:** TypeScript, embedded admin HTML/SVG in `src/admin/adminConsole.ts`, existing graph projection in `src/admin/forensicsGraph.ts`, Vitest.

---

## Source Design

Read before implementation:

- `docs/superpowers/specs/2026-06-22-incoming-where-money-cluster-timeline-graph-design.md`
- `docs/superpowers/specs/2026-06-22-admin-graph-density-fan-peer-links-design.md`
- `docs/superpowers/specs/2026-06-22-admin-graph-ux-rails-design.md`
- `docs/superpowers/prototypes/2026-06-22-cluster-timeline-graph-mockup.html`

## File Structure

- Modify `src/admin/adminConsole.ts`
  - Add cluster timeline mode.
  - Add cluster timeline layout.
  - Add bundle/group labels and expansion state.
  - Cap edge thickness.
  - Keep time/gap out of canvas labels.
  - Add right-rail bundle internals and missing-data messages.

- Modify `tests/admin/adminConsole.test.ts`
  - Add static contracts for cluster timeline helpers, controls, bundle detail copy, capped edge widths, and canvas label rules.
  - Update existing dense-mode string checks from `fan/show_all` to the new `auto/cluster/show_all` behavior where needed.

- No first-pass changes to `src/admin/forensicsGraph.ts`
  - The UI must use existing graph data first.
  - If missing bundle internals are found during QA, record that as a second backend task instead of faking data.

## Task 1: Add Cluster Timeline Mode Contract

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

In `tests/admin/adminConsole.test.ts`, add this test near the existing dense graph tests:

```typescript
  it("defaults dense incoming and where-is-money graphs to cluster timeline mode", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("adminForensicsGraphViewMode");
    expect(html).toContain('if (mode === "show_all") return "show_all";');
    expect(html).toContain('if (mode === "fan") return "fan";');
    expect(html).toContain('if (graphKindSupportsClusterTimeline(state.graph?.job?.kind)) return "cluster";');
    expect(html).toContain('return "fan";');
    expect(html).toContain("function graphKindSupportsClusterTimeline");
    expect(html).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(html).toContain("function buildClusterTimelinePresentation");
    expect(html).toContain("function clusterTimelineLayout");
    expect(html).toContain('if (dense && mode === "cluster") return clusterTimelineLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('state.densityMode === "show_all" ? "Show all raw"');
    expect(html).toContain('"Cluster timeline"');
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because `adminForensicsGraphViewMode`, `graphKindSupportsClusterTimeline`, `buildClusterTimelinePresentation`, and `clusterTimelineLayout` do not exist yet.

- [ ] **Step 3: Replace density mode storage and normalization**

In `src/admin/adminConsole.ts`, replace the current state field:

```javascript
      densityMode: localStorage.getItem("adminForensicsDensityMode") || "fan",
```

with:

```javascript
      densityMode: localStorage.getItem("adminForensicsGraphViewMode") || "auto",
```

Replace the current normalization:

```javascript
    if (!["fan", "show_all"].includes(state.densityMode)) state.densityMode = "fan";
```

with:

```javascript
    if (!["auto", "fan", "show_all"].includes(state.densityMode)) state.densityMode = "auto";
```

- [ ] **Step 4: Add graph kind and mode helpers**

In `src/admin/adminConsole.ts`, replace `graphDisplayMode` with this complete version:

```javascript
    function graphKindSupportsClusterTimeline(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check";
    }
    function graphDisplayMode(nodes, edges) {
      if (!graphIsDense(nodes, edges)) return "show_all";
      const mode = state.densityMode;
      if (mode === "show_all") return "show_all";
      if (mode === "fan") return "fan";
      if (graphKindSupportsClusterTimeline(state.graph?.job?.kind)) return "cluster";
      return "fan";
    }
```

- [ ] **Step 5: Add no-op cluster presentation wrapper**

In `src/admin/adminConsole.ts`, insert this function immediately after `buildDenseFanPresentation`:

```javascript
    function buildClusterTimelinePresentation(nodes, edges) {
      return buildDenseFanPresentation(nodes, edges);
    }
```

This is intentionally minimal for Task 1. Task 2 replaces it with the real cluster presentation.

- [ ] **Step 6: Route cluster mode to a temporary layout**

In `src/admin/adminConsole.ts`, insert this function immediately after `timelineLaneLayout`:

```javascript
    function clusterTimelineLayout(sourceNodes, sourceEdges) {
      return denseFanLayout(sourceNodes, sourceEdges);
    }
```

Then update `graphFirstLayout`:

```javascript
    function graphFirstLayout(sourceNodes, sourceEdges, mode = graphDisplayMode(sourceNodes, sourceEdges), dense = graphIsDense(sourceNodes, sourceEdges)) {
      if (dense && mode === "show_all") return timelineLaneLayout(sourceNodes, sourceEdges);
      if (dense && mode === "cluster") return clusterTimelineLayout(sourceNodes, sourceEdges);
      if (dense && mode === "fan") return denseFanLayout(sourceNodes, sourceEdges);
      return legacyFanLayout(sourceNodes, sourceEdges);
    }
```

Update `graphPresentation`:

```javascript
    function graphPresentation(rawVisibleNodes, rawVisibleEdges) {
      const dense = graphIsDense(rawVisibleNodes, rawVisibleEdges);
      const mode = graphDisplayMode(rawVisibleNodes, rawVisibleEdges);
      if (dense && mode === "cluster") {
        return { ...buildClusterTimelinePresentation(rawVisibleNodes, rawVisibleEdges), mode, dense };
      }
      if (dense && mode === "fan") {
        return { ...buildDenseFanPresentation(rawVisibleNodes, rawVisibleEdges), mode, dense };
      }
      return { nodes: rawVisibleNodes, edges: rawVisibleEdges, mode, dense };
    }
```

- [ ] **Step 7: Update mode setter and button text**

Replace `setDensityMode` with:

```javascript
    function setDensityMode(mode) {
      state.densityMode = mode === "show_all" || mode === "fan" ? mode : "auto";
      state.timelineRange = null;
      localStorage.setItem("adminForensicsGraphViewMode", state.densityMode);
      if (state.densityMode !== "show_all") reconcileSelectionWithDensityMode();
      syncDenseGraphControls();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderActivityTimeline();
      renderTransferTabs();
    }
```

Replace `syncDenseGraphControls` with:

```javascript
    function syncDenseGraphControls() {
      const densityButton = el("densityMode");
      const peerButton = el("peerLinksMode");
      if (densityButton) {
        const rawEdges = filteredGraphEdges();
        const connectedNodeIds = new Set();
        rawEdges.forEach((edge) => {
          if (edge?.fromNodeId) connectedNodeIds.add(edge.fromNodeId);
          if (edge?.toNodeId) connectedNodeIds.add(edge.toNodeId);
        });
        const rawNodes = graphNodes(state.graph).filter((node) => node.kind === "subject" || connectedNodeIds.has(node.id));
        const mode = state.graph ? graphDisplayMode(rawNodes, rawEdges) : state.densityMode;
        densityButton.textContent = mode === "show_all" ? "Show all raw" : mode === "cluster" ? "Cluster timeline" : "Fan overview";
      }
      if (peerButton) peerButton.textContent = state.peerLinksVisible ? "Peer links on" : "Peer links off";
    }
```

Replace the density button event listener:

```javascript
    el("densityMode").addEventListener("click", () => {
      setDensityMode(state.densityMode === "show_all" ? "auto" : "show_all");
    });
```

- [ ] **Step 8: Run test to verify Task 1 passes**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add cluster timeline graph mode"
```

## Task 2: Build Real Cluster Timeline Presentation And Layout

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

In `tests/admin/adminConsole.test.ts`, add:

```typescript
  it("contains cluster timeline grouping and lane helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function clusterTimelineRole");
    expect(html).toContain('if (nodeDisplayKind(node) === "funding_bundle") return "funding";');
    expect(html).toContain('if (nodeDisplayKind(node) === "trace_stop") return "stop";');
    expect(html).toContain('if (nodeIsServiceLike(node)) return "service";');
    expect(html).toContain("function importantClusterNodes");
    expect(html).toContain("function collapsedClusterSummaryNode");
    expect(html).toContain("cluster:source");
    expect(html).toContain("cluster:funding");
    expect(html).toContain("cluster:context");
    expect(html).toContain("function arrangeTimelineLane");
    expect(html).toContain("const laneX = { source: width * 0.17, funding: width * 0.39, subject: width * 0.57, service: width * 0.78, stop: width * 0.88, context: width * 0.31 };");
    expect(html).toContain("const laneNodes = { source: [], funding: [], subject: [], service: [], stop: [], context: [] };");
    expect(html).toContain('if (dense && mode === "cluster") return clusterTimelineLayout(sourceNodes, sourceEdges);');
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because the cluster helpers still do not exist.

- [ ] **Step 3: Add cluster role helpers**

In `src/admin/adminConsole.ts`, insert after `nodeLayoutSide`:

```javascript
    function clusterTimelineRole(node, subjectId, edges) {
      if (!node) return "context";
      if (node.id === subjectId) return "subject";
      if (nodeDisplayKind(node) === "funding_bundle") return "funding";
      if (nodeDisplayKind(node) === "collapsed_group") {
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
    function importantClusterNodes(nodes, edges, limit) {
      return new Set(rankNodesByImportance(nodes, edges).slice(0, limit).map((node) => node.id));
    }
    function collapsedClusterSummaryNode(id, label, count, groupKind) {
      return {
        id,
        kind: "group",
        displayKind: "collapsed_group",
        label: "+" + count + " " + label,
        weight: count,
        metadata: { groupKind, collapsedCount: count, clusterSummary: true }
      };
    }
```

- [ ] **Step 4: Replace cluster presentation**

Replace the temporary `buildClusterTimelinePresentation` with:

```javascript
    function buildClusterTimelinePresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const roles = { source: [], funding: [], subject: [subject], service: [], stop: [], context: [] };
      nodes.forEach((node) => {
        if (node.id === subjectId) return;
        roles[clusterTimelineRole(node, subjectId, edges)].push(node);
      });
      const keepSource = importantClusterNodes(roles.source, edges, 8);
      const keepFunding = importantClusterNodes(roles.funding, edges, 10);
      const keepService = importantClusterNodes(roles.service, edges, 10);
      const keepStop = importantClusterNodes(roles.stop, edges, 6);
      const keepContext = importantClusterNodes(roles.context, edges, 6);
      const keptIds = new Set([subjectId, ...keepSource, ...keepFunding, ...keepService, ...keepStop, ...keepContext]);
      const visualNodes = nodes.filter((node) => keptIds.has(node.id));
      const visualEdges = edges.filter((edge) => keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId));
      const addClusterSummary = (id, label, hiddenNodes, groupKind) => {
        if (hiddenNodes.length === 0) return;
        const groupNode = collapsedClusterSummaryNode(id, label, hiddenNodes.length, groupKind);
        visualNodes.push(groupNode);
        visualEdges.push(collapsedGroupEdge(id.replace("cluster:", "cluster-"), subjectId, id, groupKind));
      };
      addClusterSummary("cluster:source", "source wallets", roles.source.filter((node) => !keptIds.has(node.id)), "incoming");
      addClusterSummary("cluster:funding", "funding groups", roles.funding.filter((node) => !keptIds.has(node.id)), "context");
      addClusterSummary("cluster:context", "context wallets", roles.context.filter((node) => !keptIds.has(node.id)), "context");
      return { nodes: visualNodes, edges: visualEdges };
    }
```

- [ ] **Step 5: Replace cluster layout**

Replace the temporary `clusterTimelineLayout` with:

```javascript
    function arrangeTimelineLane(nodes, x, centerY, gap, role) {
      const sorted = [...nodes].sort(stableNodeSort);
      const count = sorted.length;
      const startY = centerY - ((count - 1) * gap) / 2;
      return sorted.map((node, index) => ({
        ...node,
        x,
        y: startY + index * gap + (role === "funding" && index % 2 === 1 ? gap * 0.22 : 0)
      }));
    }
    function clusterTimelineLayout(sourceNodes, sourceEdges) {
      const width = 2050;
      const height = 1180;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const laneX = { source: width * 0.17, funding: width * 0.39, subject: width * 0.57, service: width * 0.78, stop: width * 0.88, context: width * 0.31 };
      const laneY = { source: height * 0.47, funding: height * 0.47, subject: height * 0.47, service: height * 0.38, stop: height * 0.62, context: height * 0.72 };
      const laneNodes = { source: [], funding: [], subject: [], service: [], stop: [], context: [] };
      sourceNodes.forEach((node) => {
        const role = clusterTimelineRole(node, subjectId, sourceEdges);
        laneNodes[role].push(node);
      });
      const nodes = [
        ...arrangeTimelineLane(laneNodes.source, laneX.source, laneY.source, 96, "source"),
        ...arrangeTimelineLane(laneNodes.funding, laneX.funding, laneY.funding, 92, "funding"),
        ...arrangeTimelineLane(laneNodes.context, laneX.context, laneY.context, 88, "context"),
        ...arrangeTimelineLane(laneNodes.subject, laneX.subject, laneY.subject, 100, "subject"),
        ...arrangeTimelineLane(laneNodes.service, laneX.service, laneY.service, 88, "service"),
        ...arrangeTimelineLane(laneNodes.stop, laneX.stop, laneY.stop, 86, "stop")
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 36);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add cluster timeline graph layout"
```

## Task 3: Make Bundles Read As Groups And Expand Selected Bundle

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

In `tests/admin/adminConsole.test.ts`, add:

```typescript
  it("shows funding bundles as expandable groups with right-rail internals", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("expandedBundleNodeIds: new Set()");
    expect(html).toContain('id="expandSelected"');
    expect(html).toContain("function bundleCanvasLabel");
    expect(html).toContain('return "Group: " + memberCount + " wallets";');
    expect(html).toContain("function bundleSubLabel");
    expect(html).toContain("function expandedBundleMemberNodes");
    expect(html).toContain("function expandedBundleMemberEdges");
    expect(html).toContain("function expandSelectedGraphItem");
    expect(html).toContain('state.expandedBundleNodeIds.add(state.selected.id);');
    expect(html).toContain("function bundleInternalEdgeLines");
    expect(html).toContain("Internal transfers were not found in saved graph data.");
    expect(html).toContain("This is a group, not a wallet.");
    expect(html).toContain("Expand bundle");
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because bundle expansion state and detail helpers do not exist.

- [ ] **Step 3: Add toolbar button**

In the graph toolbar, after the density button:

```html
            <button id="expandSelected" type="button">Expand selected</button>
```

- [ ] **Step 4: Add state**

In the `state` object, after `renderedNodePositions: new Map()` add a comma and the new field:

```javascript
      renderedNodePositions: new Map(),
      expandedBundleNodeIds: new Set()
```

- [ ] **Step 5: Add bundle label helpers**

In `src/admin/adminConsole.ts`, insert before `canvasNodeLabel`:

```javascript
    function bundleMemberCount(node) {
      const value = Number(node?.metadata?.memberCount ?? node?.metadata?.funderCount ?? asArray(node?.metadata?.topFunders).length);
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    function bundleCanvasLabel(node) {
      const memberCount = bundleMemberCount(node);
      return memberCount > 0 ? "Group: " + memberCount + " wallets" : "Group";
    }
    function bundleSubLabel(node) {
      const amount = formatRawUsdt(node?.metadata?.coveredAmountRaw || node?.metadata?.bundleAmountRaw || node?.metadata?.targetAmountRaw);
      const txCount = Number(node?.metadata?.txCount ?? asArray(node?.metadata?.txHashes).length);
      return [amount, Number.isFinite(txCount) && txCount > 0 ? txCount + " tx" : ""].filter(Boolean).join(" / ");
    }
```

Replace the `funding_bundle` branch in `canvasNodeLabel`:

```javascript
      if (kind === "funding_bundle") return bundleCanvasLabel(node);
```

- [ ] **Step 6: Render a bundle sublabel**

In `renderGraph`, inside the node SVG string, replace this label line:

```javascript
            return '<text class="node-label" x="' + label.x + '" y="' + label.y + '" text-anchor="' + label.anchor + '">' + escapeHtml(canvasNodeLabel(node)) + '</text></g>';
```

with:

```javascript
            const subLabel = nodeDisplayKind(node) === "funding_bundle" ? bundleSubLabel(node) : "";
            return '<text class="node-label" x="' + label.x + '" y="' + label.y + '" text-anchor="' + label.anchor + '">' + escapeHtml(canvasNodeLabel(node)) + '</text>' +
              (subLabel ? '<text class="node-sublabel" x="' + label.x + '" y="' + (label.y + 15) + '" text-anchor="' + label.anchor + '">' + escapeHtml(subLabel) + '</text>' : '') +
              '</g>';
```

Add CSS near `.node-label` rules:

```css
    .node-sublabel { fill: var(--muted); font-size: 10px; font-weight: 700; paint-order: stroke; stroke: #081018; stroke-width: 3px; stroke-linejoin: round; }
```

- [ ] **Step 7: Add expanded bundle member projection helpers**

Insert after `buildClusterTimelinePresentation`:

```javascript
    function expandedBundleMemberNodes(bundleNode) {
      return asArray(bundleNode?.metadata?.topFunders).map((funder, index) => ({
        id: "bundle-member:" + bundleNode.id + ":" + index,
        kind: "wallet",
        displayKind: "wallet",
        address: funder.address || null,
        label: funder.address || "bundle member",
        weight: Number(funder.amountRaw || 0),
        metadata: { parentBundleId: bundleNode.id, bundleMember: true, amountRaw: funder.amountRaw || null, txHashes: asArray(funder.txHashes) }
      }));
    }
    function expandedBundleMemberEdges(bundleNode, memberNodes) {
      return memberNodes.map((member) => ({
        id: "bundle-member-edge:" + member.id,
        fromNodeId: member.id,
        toNodeId: bundleNode.id,
        type: "inferred_provenance",
        displayRole: "bundle_member",
        amountRaw: member.metadata?.amountRaw || null,
        txHash: asArray(member.metadata?.txHashes)[0] || null,
        timestamp: null,
        verdict: "unknown",
        weight: member.weight || 1,
        metadata: { parentBundleId: bundleNode.id, direction: "inbound" }
      }));
    }
```

In `buildClusterTimelinePresentation`, before `return { nodes: visualNodes, edges: visualEdges };`, insert:

```javascript
      visualNodes.filter((node) => state.expandedBundleNodeIds.has(node.id)).forEach((bundleNode) => {
        const memberNodes = expandedBundleMemberNodes(bundleNode);
        const memberEdges = expandedBundleMemberEdges(bundleNode, memberNodes);
        memberNodes.forEach((member) => visualNodes.push(member));
        memberEdges.forEach((edge) => visualEdges.push(edge));
      });
```

- [ ] **Step 8: Add selected expansion handler**

Insert after `expandCollapsedGroup`:

```javascript
    function expandSelectedGraphItem() {
      if (!state.selected || state.selected.type !== "node") return;
      if (isCollapsedGroupNodeId(state.selected.id)) {
        expandCollapsedGroup();
        return;
      }
      const node = nodeById(state.selected.id);
      if (nodeDisplayKind(node) !== "funding_bundle") return;
      state.expandedBundleNodeIds.add(state.selected.id);
      setStatus("Expanded selected funding bundle.");
      renderGraph();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
    }
```

Add event listener near the other toolbar listeners:

```javascript
    el("expandSelected").addEventListener("click", expandSelectedGraphItem);
```

- [ ] **Step 9: Add bundle internal detail lines**

Replace `bundleDetailBlock` with:

```javascript
    function bundleInternalEdgeLines(node, graph) {
      const relatedEdgeIds = new Set(asArray(node?.metadata?.relatedEdgeIds));
      const memberAddresses = new Set(asArray(node?.metadata?.topFunders).map((item) => item.address).filter(Boolean));
      const edges = graphEdges(graph).filter((edge) => {
        const fromAddress = edgeFromAddress(edge);
        const toAddress = edgeToAddress(edge);
        if (relatedEdgeIds.has(edge.id) && memberAddresses.has(fromAddress) && memberAddresses.has(toAddress)) return true;
        return memberAddresses.has(fromAddress) && memberAddresses.has(toAddress);
      });
      return edges.map((edge) => {
        const amount = edgeDetailedAmountLabel(edge) || edgeAmount(edge) || "amount n/a";
        const time = edgeTime(edge) || "time n/a";
        return short(edgeFromAddress(edge), 7) + " -> " + short(edgeToAddress(edge), 7) + " / " + amount + " / " + time;
      });
    }
    function bundleExternalEdgeLines(node, graph) {
      const relatedEdgeIds = new Set(asArray(node?.metadata?.relatedEdgeIds));
      return graphEdges(graph)
        .filter((edge) => relatedEdgeIds.has(edge.id) || edge.fromNodeId === node.id || edge.toNodeId === node.id)
        .map((edge) => {
          const amount = edgeDetailedAmountLabel(edge) || edgeAmount(edge) || "amount n/a";
          return short(edgeFromAddress(edge), 7) + " -> " + short(edgeToAddress(edge), 7) + " / " + amount;
        });
    }
    function bundleDetailBlock(node, graph) {
      const type = nodeType(node);
      const relatedPathIds = new Set(asArray(node.metadata?.relatedPathIds));
      const relatedPaths = graphPaths(graph).filter((path) => relatedPathIds.has(path.id) || asArray(path.nodeIds).includes(node.id));
      const covered = formatRawUsdt(node.metadata?.coveredAmountRaw || node.metadata?.bundleAmountRaw) || node.metadata?.coveredAmountRaw || node.metadata?.bundleAmountRaw || "n/a";
      const target = formatRawUsdt(node.metadata?.expectedAmountRaw || node.metadata?.targetAmountRaw) || node.metadata?.expectedAmountRaw || node.metadata?.targetAmountRaw || "n/a";
      const tail = node.metadata?.smallTailAmountRaw ? formatRawUsdt(node.metadata.smallTailAmountRaw) || node.metadata.smallTailAmountRaw : "n/a";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip(type.label, type.cls)) +
        metric("Meaning", "This is a group, not a wallet.", "wide") +
        metric("Path", node.metadata?.pathId || "n/a") +
        metric("Coverage", percent(node.metadata?.coverageRatio)) +
        metric("Covered amount", covered) +
        metric("Target amount", target) +
        metric("Top funders", node.metadata?.funderCount ?? "n/a") +
        metric("Members", node.metadata?.memberCount ?? "n/a") +
        metric("Small tail", (node.metadata?.smallTailCount ?? 0) + " funder(s) / " + tail) +
        metric("Hop/target tx", node.metadata?.hopTxHash || node.metadata?.targetTxHash || "n/a", "wide") +
        '<button type="button" class="wide detail-action" onclick="document.getElementById(&quot;expandSelected&quot;).click()">Expand bundle</button>' +
        listMetric("Top funders", bundleFunderLines(node), "No top funders stored.") +
        listMetric("Internal bundle links", bundleInternalEdgeLines(node, graph), "Internal transfers were not found in saved graph data.") +
        listMetric("External bundle links", bundleExternalEdgeLines(node, graph), "No external bundle links stored.") +
        listMetric("Path context", pathLines(relatedPaths), "No related paths in this graph.") +
        rawBlock("Funding bundle JSON", node) +
        '</div>';
    }
```

- [ ] **Step 10: Run tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 3**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: make funding bundles expandable groups"
```

## Task 4: Cap Edge Weight And Clean Canvas Labels

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Write the failing test**

In `tests/admin/adminConsole.test.ts`, add:

```typescript
  it("caps edge thickness and keeps non-important labels off the canvas", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeStrokeWidth");
    expect(html).toContain('if (role === "peer") return 1.5;');
    expect(html).toContain('if (role === "context") return 1.8;');
    expect(html).toContain('return Math.max(2, Math.min(4.4, scaled));');
    expect(html).not.toContain("Math.min(8, scaled)");
    expect(html).toContain("function edgeShouldShowCanvasAmount");
    expect(html).toContain('if (edgeIsPeerLink(edge)) return false;');
    expect(html).toContain('if (edgeDisplayRole(edge) === "collapsed_group") return false;');
    expect(html).toContain('if (edgeVisualRole(edge) === "context") return false;');
    expect(html).toContain("const shouldShowAmount = edgeShouldShowCanvasAmount(edge)");
    expect(html).toContain("Full time");
    expect(html).toContain("Tx gap");
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: FAIL because `edgeShouldShowCanvasAmount` does not exist and the old max width is still `8`.

- [ ] **Step 3: Replace edge stroke width**

Replace `edgeStrokeWidth` with:

```javascript
    function edgeStrokeWidth(edge) {
      const role = edgeVisualRole(edge);
      if (role === "peer") return 1.5;
      if (role === "context") return 1.8;
      if (role === "stop") return 2;
      const raw = Number(edge?.amountRaw || edge?.metadata?.amountRaw || edge?.weight || 0);
      if (!Number.isFinite(raw) || raw <= 0) return 2;
      const scaled = 2 + Math.log10(raw + 10) * 0.22;
      return Math.max(2, Math.min(4.4, scaled));
    }
```

- [ ] **Step 4: Add canvas amount filter**

Insert after `edgeShouldShowAmount`:

```javascript
    function edgeShouldShowCanvasAmount(edge) {
      if (!edgeShouldShowAmount(edge)) return false;
      if (edgeIsPeerLink(edge)) return false;
      if (edgeDisplayRole(edge) === "collapsed_group") return false;
      if (edgeDisplayRole(edge) === "bundle_member") return false;
      if (edgeVisualRole(edge) === "context") return false;
      return true;
    }
```

In `renderGraph`, replace:

```javascript
        const shouldShowAmount = edgeShouldShowAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel && !edgeIsPeerLink(edge)));
```

with:

```javascript
        const shouldShowAmount = edgeShouldShowCanvasAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel));
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: reduce dense graph edge noise"
```

## Task 5: Full Verification And Browser QA

**Files:**
- Modify only if a defect is found during this task.

- [ ] **Step 1: Run focused admin tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminConsole.regression-1.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Start admin server locally**

If no admin server is running, use the normal project startup:

```powershell
npm run dev
```

Open the admin URL already used in this project, for example:

```text
http://127.0.0.1:8787/admin/forensics
```

Expected: admin console opens and accepts the local admin token.

- [ ] **Step 5: Browser QA for a dense where-is-money job**

Use a known dense `where_is_money_check` job for:

```text
TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC
```

Expected:

- Toolbar mode reads `Cluster timeline`.
- Main route reads left-to-right.
- Lines are not thick ropes.
- Amount labels appear only on important edges.
- Time/gap are visible in timeline/right rail when selecting an edge.
- Peer links remain quiet.
- `Show all raw` expands to a wide timeline map.

- [ ] **Step 6: Browser QA for a dense incoming deposit job**

Use the job shown in the request:

```text
incoming_deposit_check
sender TNMKtwF4Qj...N9tMXJuHCp
watched wallet TYDaeoSF...7emWqQPC
tx 2a000a39...b2908aad
```

Expected:

- Default graph is `Cluster timeline`.
- Funding bundles are shown as groups, not wallets.
- Selecting a group opens bundle details in the right rail.
- Right rail says `This is a group, not a wallet.`
- If no internal links exist, right rail says `Internal transfers were not found in saved graph data.`
- `Expand bundle` reveals top funder/member nodes when stored top funders exist.

- [ ] **Step 7: Commit QA fixes if any**

If Task 5 required a code fix:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: polish cluster timeline graph qa"
```

If no fix was required, do not create an empty commit.

## Self-Review

Spec coverage:

- Cluster timeline default for dense `incoming_deposit_check` and `where_is_money_check`: Task 1 and Task 2.
- Left-to-right route stage layout: Task 2.
- Bundle shown as a group, not a wallet: Task 3.
- Selected bundle details and missing internal data message: Task 3.
- Expand one selected bundle: Task 3.
- Show all raw remains available: Task 1.
- Thinner capped lines: Task 4.
- Color/dash/meaning remains through existing `edgeVisualRole` and CSS, with width cleanup in Task 4.
- Amount-only important labels on canvas: Task 4.
- Time/gap in timeline and right rail: Task 4 verifies existing details remain.
- Neighbor links quiet layer: existing peer-link layer remains; Task 4 prevents peer labels from crowding canvas.
- Full addresses in right rail: existing tests remain; no change needed.

Placeholder scan:

- No unfilled marker text.
- No placeholder-only test steps.
- No fake bundle internal links; missing saved data is displayed honestly.

Type consistency:

- `densityMode` remains the existing state field to reduce churn.
- New persisted key is `adminForensicsGraphViewMode`, which avoids stale `adminForensicsDensityMode` values.
- `cluster` is a presentation mode only.
- `funding_bundle` remains the existing real forensic bundle display kind.
- `collapsed_group` remains UI-only grouping.
