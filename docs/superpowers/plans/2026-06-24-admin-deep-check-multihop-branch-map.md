# Admin Deep Check Multi-Hop Branch Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `address_deep_check` open as a readable multi-hop branch map with service visibility on, visible amount/time labels by default, useful wallet labels, targeted expansion, and honest risk display.

**Architecture:** Keep the existing vanilla TypeScript string-rendered admin console. Update `src/admin/forensicsGraph.ts` so deep-check graph summaries surface available risk/decision data, then update `src/admin/adminConsole.ts` with a deep-check-only branch-map presentation/layout and label controls. Do not change `incoming_deposit_check` or `where_is_money_check` layout behavior.

**Tech Stack:** TypeScript, inline SVG admin UI, Vitest string-contract and graph-projection tests.

---

## Files

- Modify: `src/admin/forensicsGraph.ts`
  - Surface `address_deep_check` risk/decision summary from available result data.
  - Mark projected deep-check edges/nodes with enough metadata for branch layout.

- Modify: `src/admin/adminConsole.ts`
  - Add deep-check display mode `deep_branch_map`.
  - Add `Tx labels` and `Wallet labels` controls.
  - Default deep-check transaction labels to all visible amount/time labels.
  - Default deep-check services to visible.
  - Add branch-map presentation, layout, smart wallet-label placement, and targeted expansion.

- Modify: `tests/admin/forensicsGraph.test.ts`
  - Cover deep-check risk summary and multi-hop projection metadata.

- Modify: `tests/admin/adminConsole.test.ts`
  - Cover new controls, default deep-check mode, label rules, branch layout helpers, and targeted expansion behavior.

- Optional manual QA only: updated admin server at `http://127.0.0.1:8790/admin/forensics?token=local-admin-token`.

---

### Task 1: Surface Deep-Check Risk In The Admin Projection

**Files:**
- Modify: `tests/admin/forensicsGraph.test.ts`
- Modify: `src/admin/forensicsGraph.ts`

- [ ] **Step 1: Add a failing projection test for deep-check risk summary**

Add this test near the existing `address_deep_check` projection tests in `tests/admin/forensicsGraph.test.ts`:

```ts
  it("surfaces address-deep risk and decision from result data", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        decision: "REVIEW",
        riskScore: 48,
        assessment: {
          reasons: ["Direct counterparty context requires review."]
        },
        coverage: {
          coverageRatio: 0.72,
          checkedScope: "deep_profile_context"
        },
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary).toMatchObject({
      decision: "REVIEW",
      riskScore: 48,
      riskLevel: "MEDIUM",
      coverageRatio: 0.72,
      checkedScope: "deep_profile_context",
      topReasons: ["Direct counterparty context requires review."]
    });
    expect(result.graph.summary.layerSummary).toMatchObject({
      riskDisplayMode: "final_result"
    });
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- --run tests/admin/forensicsGraph.test.ts -t "surfaces address-deep risk"
```

Expected: FAIL because `projectAddressDeepJob` currently returns `decision: "UNKNOWN"` and `riskScore: null`.

- [ ] **Step 3: Add deep-check summary helpers**

In `src/admin/forensicsGraph.ts`, add these helpers near `decision()` and `riskLevelFromScore()`:

```ts
function maxWeightValue(weights: AdminForensicsWeight[]): number | null {
  const values = weights
    .map((weight) => weight.value)
    .filter((value): value is number => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

function summaryDecisionFromRisk(score: number | null): AdminForensicsDecision {
  if (score === null) return "UNKNOWN";
  if (score >= 65) return "DECLINE";
  if (score >= 35) return "REVIEW";
  return "ACCEPTABLE";
}
```

- [ ] **Step 4: Use real deep-check risk fields in `projectAddressDeepJob`**

Inside `projectAddressDeepJob`, after `serviceProfiles` is declared, add:

```ts
  const assessment = isRecord(result["assessment"]) ? result["assessment"] : {};
```

Near the final `return`, before `annotateGraphDerivedMetrics(...)`, add:

```ts
  const finalRiskScore = firstNumber(
    numberField(result, "riskScore"),
    numberField(result, "score"),
    numberField(assessment, "riskScore"),
    numberField(assessment, "score")
  );
  const profileContextScore = finalRiskScore === null ? maxWeightValue(weights) : null;
  const summaryRiskScore = finalRiskScore ?? profileContextScore;
  const explicitDecision = decision(result["decision"] ?? assessment["decision"]);
  const summaryDecision = explicitDecision !== "UNKNOWN"
    ? explicitDecision
    : summaryDecisionFromRisk(summaryRiskScore);
  const riskDisplayMode = finalRiskScore !== null
    ? "final_result"
    : profileContextScore !== null
      ? "profile_context"
      : summary.status === "partial"
        ? "partial_not_ready"
        : "missing";
```

In the returned `summary`, replace the current hardcoded fields:

```ts
        decision: "UNKNOWN",
        riskScore: null,
        riskLevel: null,
        confidence: null,
        coverageRatio: numberField(coverage, "coverageRatio"),
        checkedScope: null,
```

with:

```ts
        decision: summaryDecision,
        riskScore: summaryRiskScore,
        riskLevel: riskLevelFromScore(summaryRiskScore),
        confidence: confidenceFromNumber(summaryRiskScore),
        coverageRatio: numberField(coverage, "coverageRatio"),
        checkedScope: stringField(coverage, "checkedScope") ?? riskDisplayMode,
```

Inside `layerSummary`, add `riskDisplayMode` next to `deepCoverage`:

```ts
          riskDisplayMode,
```

Replace `topReasons: stringArrayField(result, "missingChecks")` with:

```ts
        topReasons: [
          ...stringArrayField(assessment, "reasons"),
          ...stringArrayField(result, "reasons"),
          ...stringArrayField(result, "missingChecks")
        ].slice(0, 8)
```

- [ ] **Step 5: Verify the projection test passes**

Run:

```powershell
npm test -- --run tests/admin/forensicsGraph.test.ts -t "surfaces address-deep risk"
```

Expected: PASS.

- [ ] **Step 6: Run all graph projection tests**

Run:

```powershell
npm test -- --run tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix: surface deep-check risk summary"
```

---

### Task 2: Add Deep-Check Label Controls And Defaults

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing tests for controls and deep-check defaults**

Add this test near other admin control tests in `tests/admin/adminConsole.test.ts`:

```ts
  it("adds deep-check label controls and defaults transaction labels to all", () => {
    const html = adminConsoleHtml();
    const stateBlock = html.slice(html.indexOf("const state ="), html.indexOf("if (!"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain('<select id="txLabelMode">');
    expect(html).toContain('<option value="all">Tx labels: all</option>');
    expect(html).toContain('<option value="important">Tx labels: important</option>');
    expect(html).toContain('<option value="selected">Tx labels: selected</option>');
    expect(html).toContain('<option value="off">Tx labels: off</option>');
    expect(html).toContain('<select id="walletLabelMode">');
    expect(html).toContain('<option value="smart">Wallet labels: smart</option>');
    expect(html).toContain('<option value="all">Wallet labels: all</option>');
    expect(html).toContain('<option value="important">Wallet labels: important</option>');
    expect(html).toContain('<option value="off">Wallet labels: off</option>');
    expect(stateBlock).toContain('txLabelMode: localStorage.getItem("adminForensicsTxLabelMode") || "auto"');
    expect(stateBlock).toContain('walletLabelMode: localStorage.getItem("adminForensicsWalletLabelMode") || "smart"');
    expect(html).toContain("function effectiveTxLabelMode");
    expect(html).toContain('if (state.graph?.job?.kind === "address_deep_check" && state.txLabelMode === "auto") return "all";');
    expect(renderBlock).toContain("const txLabelMode = effectiveTxLabelMode();");
    expect(renderBlock).toContain('txLabelMode === "selected"');
  });
```

- [ ] **Step 2: Run the failing admin console test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "adds deep-check label controls"
```

Expected: FAIL because the controls and helpers do not exist.

- [ ] **Step 3: Replace the amount select with transaction label controls**

In `src/admin/adminConsole.ts`, replace:

```html
            <select id="amountMode">
              <option value="important">Amounts: important</option>
              <option value="all">Amounts: all</option>
              <option value="off">Amounts: off</option>
            </select>
```

with:

```html
            <select id="txLabelMode">
              <option value="auto">Tx labels: auto</option>
              <option value="all">Tx labels: all</option>
              <option value="important">Tx labels: important</option>
              <option value="selected">Tx labels: selected</option>
              <option value="off">Tx labels: off</option>
            </select>
            <select id="walletLabelMode">
              <option value="smart">Wallet labels: smart</option>
              <option value="all">Wallet labels: all</option>
              <option value="important">Wallet labels: important</option>
              <option value="off">Wallet labels: off</option>
            </select>
```

Update the CSS selectors:

```css
    .graph-action-row #amountMode { width: 165px; }
```

to:

```css
    .graph-action-row #txLabelMode { width: 160px; }
    .graph-action-row #walletLabelMode { width: 180px; }
```

and update the media-query selector from `#amountMode` to both new selectors.

- [ ] **Step 4: Add state and validation**

In the `state` object, replace:

```js
      amountMode: localStorage.getItem("adminForensicsAmountMode") || "important",
```

with:

```js
      txLabelMode: localStorage.getItem("adminForensicsTxLabelMode") || "auto",
      walletLabelMode: localStorage.getItem("adminForensicsWalletLabelMode") || "smart",
```

After the current density mode validation, add:

```js
    if (!["auto", "all", "important", "selected", "off"].includes(state.txLabelMode)) state.txLabelMode = "auto";
    if (!["smart", "all", "important", "off"].includes(state.walletLabelMode)) state.walletLabelMode = "smart";
```

- [ ] **Step 5: Add transaction-label mode helpers**

Near `selectedEdgeIds()`, add:

```js
    function effectiveTxLabelMode() {
      if (state.graph?.job?.kind === "address_deep_check" && state.txLabelMode === "auto") return "all";
      if (state.txLabelMode === "auto") return "important";
      return state.txLabelMode;
    }
    function selectedEdgeLabelVisible(edge) {
      const selected = selectedEdgeIds();
      return selected.has(edge.id) || selected.has(edge?.metadata?.pathId);
    }
```

- [ ] **Step 6: Update render-time label decisions**

Inside `renderGraph`, before `const edgeRenderItems = visibleEdges.map(...)`, add:

```js
      const txLabelMode = effectiveTxLabelMode();
```

Replace:

```js
        const shouldShowAmount = edgeShouldShowCanvasAmount(edge) && state.amountMode !== "off" && (state.amountMode === "all" || state.amountMode === "important");
        const shouldShowTime = edgeShouldShowCanvasTime(edge);
        const amountLines = state.amountMode === "off" ? [] : [shouldShowAmount ? amountLabel : ""].filter(Boolean);
```

with:

```js
        const selectedLabel = txLabelMode === "selected" && selectedEdgeLabelVisible(edge);
        const importantLabel = txLabelMode === "important" && edgeShouldShowCanvasAmount(edge);
        const allLabel = txLabelMode === "all";
        const labelEnabled = txLabelMode !== "off" && (allLabel || importantLabel || selectedLabel);
        const shouldShowAmount = labelEnabled && edgeShouldShowCanvasAmount(edge);
        const shouldShowTime = labelEnabled && edgeShouldShowCanvasTime(edge);
        const amountLines = labelEnabled ? [shouldShowAmount ? amountLabel : ""].filter(Boolean) : [];
```

- [ ] **Step 7: Wire control values and events**

Replace initialization:

```js
    el("amountMode").value = state.amountMode;
```

with:

```js
    el("txLabelMode").value = state.txLabelMode;
    el("walletLabelMode").value = state.walletLabelMode;
```

Replace the `amountMode` change listener with:

```js
    el("txLabelMode").addEventListener("change", () => {
      state.txLabelMode = el("txLabelMode").value;
      localStorage.setItem("adminForensicsTxLabelMode", state.txLabelMode);
      renderGraph();
      renderActivityTimeline();
      renderTransferTabs();
    });
    el("walletLabelMode").addEventListener("change", () => {
      state.walletLabelMode = el("walletLabelMode").value;
      localStorage.setItem("adminForensicsWalletLabelMode", state.walletLabelMode);
      renderGraph();
    });
```

- [ ] **Step 8: Verify the control test passes**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "adds deep-check label controls"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add deep-check graph label controls"
```

---

### Task 3: Route Deep Check To `deep_branch_map`

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add a failing routing test**

Add this test near the current local-orbit routing tests:

```ts
  it("routes address-deep checks to the deep branch map display mode", () => {
    const html = adminConsoleHtml();
    const graphDisplayModeBlock = html.slice(html.indexOf("function graphDisplayMode"), html.indexOf("function buildDenseFanPresentation"));
    const layoutBlock = html.slice(html.indexOf("function graphFirstLayout"), html.indexOf("function graphPresentation"));
    const controlsBlock = html.slice(html.indexOf("function syncDenseGraphControls"), html.indexOf("function syncGraphFirstControls"));

    expect(html).toContain("function graphKindUsesDeepBranchMap");
    expect(graphDisplayModeBlock).toContain('if (graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";');
    expect(layoutBlock).toContain('if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);');
    expect(controlsBlock).toContain('mode === "deep_branch_map" ? "Deep branch map"');
  });
```

- [ ] **Step 2: Run the failing routing test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "routes address-deep checks"
```

Expected: FAIL because `deep_branch_map` is not present.

- [ ] **Step 3: Add branch-map kind helpers**

In `src/admin/adminConsole.ts`, replace:

```js
    function graphKindUsesLocalOrbit(kind) {
      return kind === "address_deep_check";
    }
    function graphKindSupportsStepOrbit(kind) {
      return graphKindUsesFlowMap(kind) || graphKindUsesLocalOrbit(kind);
    }
```

with:

```js
    function graphKindUsesDeepBranchMap(kind) {
      return kind === "address_deep_check";
    }
    function graphKindSupportsStepOrbit(kind) {
      return graphKindUsesFlowMap(kind) || graphKindUsesDeepBranchMap(kind);
    }
```

Replace uses of `graphKindUsesLocalOrbit(state.graph?.job?.kind)` with `graphKindUsesDeepBranchMap(state.graph?.job?.kind)` in display routing and fit logic.

- [ ] **Step 4: Route display mode to branch map**

In `graphDisplayMode`, replace:

```js
      if (graphKindUsesLocalOrbit(state.graph?.job?.kind)) return "deep_local_orbit";
```

with:

```js
      if (graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";
```

In `syncDenseGraphControls`, replace the local-orbit label expression with:

```js
        densityButton.textContent = mode === "deep_branch_map" ? "Deep branch map" : mode === "flow_map" ? "Flow map" : mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";
```

In `graphFirstLayout`, add the new branch before the old local-orbit branch:

```js
      if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);
```

Keep `deepLocalOrbitLayout` in the file until Task 4 replaces it or delegates to the new layout. This avoids a large removal in this task.

- [ ] **Step 5: Update show-all and fit conditions**

Replace:

```js
graphKindUsesLocalOrbit(state.graph?.job?.kind)
```

with:

```js
graphKindUsesDeepBranchMap(state.graph?.job?.kind)
```

in:

- `graphFirstLayout`;
- `fitGraph`;
- any admin-console tests that assert those strings.

- [ ] **Step 6: Verify routing tests pass**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "routes address-deep checks"
```

Expected: PASS.

- [ ] **Step 7: Run admin console tests**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts
```

Expected: PASS after updating string-contract expectations from local orbit to branch map.

- [ ] **Step 8: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: route deep-check graphs to branch map"
```

---

### Task 4: Build Deep-Check Branch Presentation

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing presentation tests**

Add this test near the graph presentation tests:

```ts
  it("builds a deep-check branch presentation with grouped low-priority branch nodes", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function buildDeepBranchPresentation"), html.indexOf("function applyExpandedBundlePresentation"));

    expect(html).toContain("function buildDeepBranchPresentation");
    expect(html).toContain("function deepBranchStep1NodeIds");
    expect(html).toContain("function deepBranchAnchorForNode");
    expect(html).toContain("function deepBranchSummaryNode");
    expect(presentationBlock).toContain('metadata: {');
    expect(presentationBlock).toContain('deepBranchAnchorId');
    expect(presentationBlock).toContain('hiddenNodeIds');
    expect(presentationBlock).toContain('groupReason: "deep_branch_overview"');
    expect(presentationBlock).toContain('if (!state.servicesVisible && nodeIsServiceLike(node)) return false;');
  });
```

- [ ] **Step 2: Run the failing presentation test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "builds a deep-check branch presentation"
```

Expected: FAIL because branch presentation helpers do not exist.

- [ ] **Step 3: Add branch presentation helpers**

Insert these helpers after `buildStepOrbitPresentation` and before `applyExpandedBundlePresentation`:

```js
    function deepBranchStep1NodeIds(nodes, edges, subjectId) {
      return new Set(rankNodesByImportance(
        nodes.filter((node) =>
          node.id !== subjectId &&
          edges.some((edge) =>
            (edge.fromNodeId === subjectId && edge.toNodeId === node.id) ||
            (edge.toNodeId === subjectId && edge.fromNodeId === node.id)
          )
        ),
        edges
      ).slice(0, 18).map((node) => node.id));
    }
    function deepBranchAnchorForNode(node, edges, step1Ids, subjectId) {
      if (step1Ids.has(node.id)) return subjectId;
      const direct = edges
        .flatMap((edge) => {
          if (edge.fromNodeId === node.id && step1Ids.has(edge.toNodeId)) return [edge.toNodeId];
          if (edge.toNodeId === node.id && step1Ids.has(edge.fromNodeId)) return [edge.fromNodeId];
          return [];
        })
        .sort();
      return direct[0] || subjectId;
    }
    function deepBranchSummaryNode(id, hiddenNodes, anchorId, role) {
      return {
        id,
        kind: "group",
        displayKind: "collapsed_group",
        label: "Group: " + hiddenNodes.length + " wallets",
        weight: hiddenNodes.length,
        metadata: {
          uiCollapsedGroup: true,
          realGroupKind: "deep_branch_collapsed_group",
          groupReason: "deep_branch_overview",
          groupKind: role,
          deepBranchAnchorId: anchorId,
          hiddenNodeIds: hiddenNodes.map((node) => node.id)
        }
      };
    }
```

- [ ] **Step 4: Add `buildDeepBranchPresentation`**

Add this function immediately after the helpers from Step 3:

```js
    function buildDeepBranchPresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const step1Ids = deepBranchStep1NodeIds(nodes, edges, subjectId);
      const selectedNodeId = state.selected?.type === "node" ? state.selected.id : "";
      const expandedIds = new Set([...state.expandedBundleNodeIds, selectedNodeId].filter(Boolean));
      const anchorBuckets = new Map();
      nodes.forEach((node) => {
        if (node.id === subjectId) return;
        if (!state.servicesVisible && nodeIsServiceLike(node)) return;
        const anchorId = deepBranchAnchorForNode(node, edges, step1Ids, subjectId);
        const bucket = anchorBuckets.get(anchorId) || [];
        bucket.push(node);
        anchorBuckets.set(anchorId, bucket);
      });

      const keptIds = new Set([subjectId, ...step1Ids]);
      const visualNodes = [subject];
      const visualEdges = [];

      anchorBuckets.forEach((bucket, anchorId) => {
        const important = rankNodesByImportance(bucket, edges).slice(0, expandedIds.has(anchorId) ? 24 : 8);
        important.forEach((node) => {
          keptIds.add(node.id);
          visualNodes.push({
            ...node,
            metadata: { ...node.metadata, deepBranchAnchorId: anchorId }
          });
        });
        const hidden = bucket.filter((node) => !keptIds.has(node.id));
        if (hidden.length > 0) {
          const groupId = "collapsed:deep:" + anchorId.replace(/[^a-zA-Z0-9:_-]/g, "_");
          keptIds.add(groupId);
          visualNodes.push(deepBranchSummaryNode(groupId, hidden, anchorId, "context"));
        }
      });

      edges.forEach((edge) => {
        const bothVisible = keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId);
        if (bothVisible) {
          visualEdges.push(edge);
          return;
        }
        const fromVisible = keptIds.has(edge.fromNodeId);
        const toVisible = keptIds.has(edge.toNodeId);
        const hiddenNodeId = fromVisible ? edge.toNodeId : toVisible ? edge.fromNodeId : "";
        const visibleNodeId = fromVisible ? edge.fromNodeId : toVisible ? edge.toNodeId : "";
        if (!hiddenNodeId || !visibleNodeId) return;
        const anchorId = deepBranchAnchorForNode({ id: hiddenNodeId }, edges, step1Ids, subjectId);
        const groupId = "collapsed:deep:" + anchorId.replace(/[^a-zA-Z0-9:_-]/g, "_");
        if (!keptIds.has(groupId)) return;
        visualEdges.push({
          id: "collapsed-edge:deep:" + edge.id,
          fromNodeId: visibleNodeId,
          toNodeId: groupId,
          type: "collapsed_group",
          displayRole: "collapsed_group",
          verdict: "review",
          weight: 1,
          metadata: { groupKind: "context", sourceEdgeId: edge.id, deepBranchAnchorId: anchorId }
        });
      });

      return { nodes: visualNodes, edges: visualEdges };
    }
```

- [ ] **Step 5: Use branch presentation for deep-check overview**

In `graphPresentation`, add this branch before step-orbit/fan presentation:

```js
      if (mode === "deep_branch_map") {
        presentation = buildDeepBranchPresentation(rawVisibleNodes, rawVisibleEdges);
      } else if (dense && mode === "step_orbit") {
```

- [ ] **Step 6: Verify presentation tests pass**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "builds a deep-check branch presentation"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: group deep-check branches for overview"
```

---

### Task 5: Implement Deep Branch Map Layout

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing layout tests**

Add this test near existing layout tests:

```ts
  it("lays out deep-check branches around their owning counterparties", () => {
    const html = adminConsoleHtml();
    const layoutBlock = html.slice(html.indexOf("function deepBranchMapLayout"), html.indexOf("function deepLocalOrbitSpineNodeIds"));

    expect(html).toContain("function deepBranchMapLayout");
    expect(html).toContain("function deepBranchLayoutRole");
    expect(html).toContain("function deepBranchPoint");
    expect(layoutBlock).toContain("const subjectX = width * 0.50;");
    expect(layoutBlock).toContain("const anchorId = node?.metadata?.deepBranchAnchorId || subjectId;");
    expect(layoutBlock).toContain("slotByAnchorRole");
    expect(layoutBlock).toContain("role === \"service\"");
    expect(layoutBlock).toContain("role === \"stop\"");
    expect(layoutBlock).toContain("relaxNodeCollisions(nodes, fixedNodeIds");
  });
```

- [ ] **Step 2: Run the failing layout test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "lays out deep-check branches"
```

Expected: FAIL because `deepBranchMapLayout` does not exist.

- [ ] **Step 3: Add layout role and point helpers**

Insert these helpers before `deepLocalOrbitSpineNodeIds`:

```js
    function deepBranchLayoutRole(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "trace_stop") return "stop";
      if (nodeIsServiceLike(node)) return "service";
      if (node.kind === "group" || node.displayKind === "collapsed_group") return "group";
      return "wallet";
    }
    function deepBranchPoint(anchor, slot, role) {
      const ring = Math.floor(slot / 6);
      const localSlot = slot % 6;
      const baseAngle = role === "service" ? -0.75 : role === "stop" ? 0.78 : role === "group" ? 1.45 : -2.35;
      const angle = baseAngle + (localSlot - 2.5) * 0.34 + ring * 0.12;
      const radiusX = role === "service" ? 210 : role === "stop" ? 250 : role === "group" ? 176 : 154;
      const radiusY = role === "service" ? 130 : role === "stop" ? 150 : role === "group" ? 145 : 136;
      return {
        x: anchor.x + Math.cos(angle) * (radiusX + ring * 54),
        y: anchor.y + Math.sin(angle) * (radiusY + ring * 42)
      };
    }
```

- [ ] **Step 4: Add `deepBranchMapLayout`**

Add this function before the old `deepLocalOrbitSpineNodeIds` function:

```js
    function deepBranchMapLayout(sourceNodes, sourceEdges) {
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
      const subject = sourceNodes.find((node) => node.id === subjectId) || sourceNodes[0];
      if (!subject) return { width: 1700, height: 980, nodes: [], byId: new Map() };
      const width = Math.max(2100, 1280 + Math.min(sourceNodes.length, 120) * 10);
      const height = Math.max(1260, 860 + Math.ceil(Math.min(sourceNodes.length, 120) / 16) * 76);
      const subjectX = width * 0.50;
      const subjectY = height * 0.50;
      const nodes = [];
      const placedById = new Map();
      const subjectPlaced = { ...subject, x: subjectX, y: subjectY };
      nodes.push(subjectPlaced);
      placedById.set(subjectId, subjectPlaced);

      const step1 = sourceNodes
        .filter((node) => node.id !== subjectId && (node?.metadata?.deepBranchAnchorId || subjectId) === subjectId)
        .sort(stableNodeSort);
      const incoming = step1.filter((node) => nodeLayoutSide(node, subjectId, sourceEdges) === "incoming");
      const outgoing = step1.filter((node) => nodeLayoutSide(node, subjectId, sourceEdges) !== "incoming");
      arrangeCluster(incoming, subjectX - 360, subjectY, 260, 420, -1.65, 1.35).forEach((node) => {
        nodes.push(node);
        placedById.set(node.id, node);
      });
      arrangeCluster(outgoing, subjectX + 380, subjectY, 280, 430, -1.35, 1.65).forEach((node) => {
        nodes.push(node);
        placedById.set(node.id, node);
      });

      const slotByAnchorRole = new Map();
      sourceNodes
        .filter((node) => !placedById.has(node.id))
        .sort(stableNodeSort)
        .forEach((node) => {
          const role = deepBranchLayoutRole(node);
          const anchorId = node?.metadata?.deepBranchAnchorId || subjectId;
          const anchor = placedById.get(anchorId) || placedById.get(subjectId) || subjectPlaced;
          const key = anchor.id + ":" + role;
          const slot = slotByAnchorRole.get(key) || 0;
          slotByAnchorRole.set(key, slot + 1);
          const point = deepBranchPoint(anchor, slot, role);
          const placed = { ...node, x: point.x, y: point.y };
          nodes.push(placed);
          placedById.set(node.id, placed);
        });

      const fixedNodeIds = new Set([subjectId, ...step1.map((node) => node.id)]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 58);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
```

- [ ] **Step 5: Verify layout tests pass**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "lays out deep-check branches"
```

Expected: PASS.

- [ ] **Step 6: Run a targeted regression for deep graph routing**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "deep"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: layout deep-check branch map"
```

---

### Task 6: Add Smart Wallet Label Visibility

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing smart-label tests**

Add this test near node-label tests:

```ts
  it("keeps deep-check wallet labels smart instead of hiding every address", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function nodeCanvasLabelVisible");
    expect(html).toContain("function visibleNodeLabelIds");
    expect(html).toContain('if (state.walletLabelMode === "all") return true;');
    expect(html).toContain('if (state.walletLabelMode === "off") return node.kind === "subject" || nodeIsServiceLike(node) || state.selected?.id === node.id;');
    expect(html).toContain('if (state.walletLabelMode === "important")');
    expect(renderBlock).toContain("const visibleLabelIds = visibleNodeLabelIds(placed.nodes, visibleEdges);");
    expect(renderBlock).toContain('visibleLabelIds.has(node.id) ? "" : " label-hidden"');
  });
```

- [ ] **Step 2: Run the failing smart-label test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "keeps deep-check wallet labels smart"
```

Expected: FAIL because smart label helpers do not exist.

- [ ] **Step 3: Add label box helpers**

Near `labelBox(...)`, add:

```js
    function nodeLabelBox(node) {
      const label = canvasNodeLabel(node);
      const width = Math.max(46, Math.min(150, String(label).length * 6.2));
      const labelAttrs = nodeLabelAttrs(node, { width: 1, height: 1, nodes: [], byId: new Map() });
      const x = node.x + Number(labelAttrs.x || 0);
      const y = node.y + Number(labelAttrs.y || 0) - 12;
      return { left: x - width / 2, right: x + width / 2, top: y, bottom: y + 18 };
    }
    function nodeCanvasLabelVisible(node, importantIds) {
      if (state.walletLabelMode === "all") return true;
      if (state.walletLabelMode === "off") return node.kind === "subject" || nodeIsServiceLike(node) || state.selected?.id === node.id;
      if (state.walletLabelMode === "important") {
        return node.kind === "subject" || nodeIsServiceLike(node) || importantIds.has(node.id) || state.selected?.id === node.id;
      }
      return true;
    }
```

- [ ] **Step 4: Add smart label collision filtering**

Near `nodeCanvasLabelVisible(...)`, add:

```js
    function visibleNodeLabelIds(nodes, edges) {
      const importantIds = new Set(rankNodesByImportance(nodes, edges).slice(0, 28).map((node) => node.id));
      const labels = [];
      const visible = new Set();
      nodes.forEach((node) => {
        if (!nodeCanvasLabelVisible(node, importantIds)) return;
        const box = nodeLabelBox(node);
        const protectedLabel = node.kind === "subject" || nodeIsServiceLike(node) || state.selected?.id === node.id;
        const collides = labels.some((item) => boxesOverlap(box, item, 6));
        if (!collides || protectedLabel || state.walletLabelMode === "all") {
          labels.push(box);
          visible.add(node.id);
        }
      });
      return visible;
    }
```

- [ ] **Step 5: Apply visible label ids in render**

Inside `renderGraph`, after `placed` is computed and before node SVG is built, add:

```js
      const visibleLabelIds = visibleNodeLabelIds(placed.nodes, visibleEdges);
```

In node class construction, replace:

```js
        const cls = "node node-kind-" + escapeHtml(node.kind || "wallet") + " " + escapeHtml(nodeVisualClass(node)) + (selected ? " selected" : "") + (visible ? "" : " dim");
```

with:

```js
        const cls = "node node-kind-" + escapeHtml(node.kind || "wallet") + " " + escapeHtml(nodeVisualClass(node)) + (selected ? " selected" : "") + (visible ? "" : " dim") + (visibleLabelIds.has(node.id) ? "" : " label-hidden");
```

Add CSS near node-label styles:

```css
    .node.label-hidden .node-label,
    .node.label-hidden .node-sublabel { display: none; }
```

- [ ] **Step 6: Verify smart-label tests pass**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "keeps deep-check wallet labels smart"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add smart wallet labels"
```

---

### Task 7: Expand Selected Deep Branch Groups Without Switching To Raw Mode

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing expansion tests**

Add this test near existing expansion tests:

```ts
  it("expands selected deep branch groups without forcing show-all raw mode", () => {
    const html = adminConsoleHtml();
    const expandBlock = html.slice(html.indexOf("function expandSelectedGraphItem"), html.indexOf("function stopNodeForPath"));
    const presentationBlock = html.slice(html.indexOf("function buildDeepBranchPresentation"), html.indexOf("function applyExpandedBundlePresentation"));

    expect(html).toContain("function isDeepBranchGroupNodeId");
    expect(expandBlock).toContain("state.expandedBundleNodeIds.add(state.selected.id);");
    expect(expandBlock).toContain('setStatus("Expanded selected deep-check branch group.");');
    expect(expandBlock).not.toContain('setDensityMode("show_all");');
    expect(presentationBlock).toContain("expandedIds.has(groupId)");
  });
```

- [ ] **Step 2: Run the failing expansion test**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "expands selected deep branch groups"
```

Expected: FAIL because collapsed groups currently switch to `show_all`.

- [ ] **Step 3: Add deep branch group predicate**

Near `isCollapsedGroupNodeId`, add:

```js
    function isDeepBranchGroupNodeId(nodeId) {
      return String(nodeId || "").startsWith("collapsed:deep:");
    }
```

- [ ] **Step 4: Keep expanded deep groups in overview**

In `buildDeepBranchPresentation`, after creating `groupId`, adjust the hidden-node branch:

```js
          if (expandedIds.has(groupId)) {
            hidden.forEach((node) => {
              keptIds.add(node.id);
              visualNodes.push({
                ...node,
                metadata: { ...node.metadata, deepBranchAnchorId: anchorId }
              });
            });
          } else {
            keptIds.add(groupId);
            visualNodes.push(deepBranchSummaryNode(groupId, hidden, anchorId, "context"));
          }
```

This replaces the previous unconditional group-node push for hidden nodes.

- [ ] **Step 5: Update `expandSelectedGraphItem`**

At the top of the selected-node branch, before the generic collapsed-group branch, add:

```js
      if (isDeepBranchGroupNodeId(state.selected.id)) {
        state.expandedBundleNodeIds.add(state.selected.id);
        setStatus("Expanded selected deep-check branch group.");
        renderGraph();
        renderDetails();
        renderSelectionCard();
        return;
      }
```

Keep the old `expandCollapsedGroup()` behavior for non-deep collapsed groups.

- [ ] **Step 6: Verify expansion tests pass**

Run:

```powershell
npm test -- --run tests/admin/adminConsole.test.ts -t "expands selected deep branch groups"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: expand deep-check branch groups in place"
```

---

### Task 8: Manual QA And Regression

**Files:**
- Modify only if QA reveals defects:
  - `src/admin/adminConsole.ts`
  - `src/admin/forensicsGraph.ts`
  - `tests/admin/adminConsole.test.ts`
  - `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Run focused tests**

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

- [ ] **Step 4: Restart the local admin runner**

Run:

```powershell
$port = 8790
$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { Stop-Process -Id $listener.OwningProcess -Force; Start-Sleep -Seconds 1 }
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList @('--import','tsx','C:\Users\User\AppData\Local\Temp\smartcontract-admin-8790-runner.ts') -WorkingDirectory 'C:\Users\User\OneDrive\Desktop\smartcontract\.worktrees\master-merge-push' -WindowStyle Hidden
Start-Sleep -Seconds 2
Invoke-WebRequest -Uri 'http://127.0.0.1:8790/admin/forensics?token=local-admin-token' -UseBasicParsing -TimeoutSec 5 | Select-Object StatusCode
```

Expected: `StatusCode` is `200`.

- [ ] **Step 5: Verify the shipped HTML contains the new behavior**

Run:

```powershell
$html = (Invoke-WebRequest -Uri 'http://127.0.0.1:8790/admin/forensics?token=local-admin-token' -UseBasicParsing -TimeoutSec 5).Content
@(
  'deep_branch_map',
  'Deep branch map',
  'function buildDeepBranchPresentation',
  'function deepBranchMapLayout',
  'function effectiveTxLabelMode',
  'function visibleNodeLabelIds'
) | ForEach-Object { if ($html.Contains($_)) { "FOUND $_" } else { "MISSING $_" } }
```

Expected: every line starts with `FOUND`.

- [ ] **Step 6: Manual browser pass**

Open:

```text
http://127.0.0.1:8790/admin/forensics?token=local-admin-token
```

Check an `address_deep_check` job:

- graph button reads `Deep branch map`;
- services are visible on first load;
- transaction labels show amount plus time/gap by default;
- wallet labels are visible but not every overlapping address is forced on top;
- selecting a group and pressing `Expand selected` expands only that branch;
- `Show all raw` still shows the raw graph;
- right rail no longer shows hardcoded `n/a / unknown` when risk exists.

- [ ] **Step 7: Commit QA fixes or final verification**

If QA required fixes:

```powershell
git add src/admin/adminConsole.ts src/admin/forensicsGraph.ts tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix: polish deep-check branch map"
```

If no QA fixes were required:

```powershell
git status --short
```

Expected: no modified source or test files.

---

## Self-Review

Spec coverage:

- Multi-hop deep-check graph: Tasks 3, 4, and 5.
- Services visible by default: Task 2 preserves default service visibility and Task 4 keeps services in branch presentation unless explicitly toggled off.
- Amount/time visible everywhere by default: Task 2 sets deep-check `auto` transaction labels to `all`.
- Important-only transaction label mode: Task 2 adds `important`.
- Wallet labels not reduced to gray dots: Task 6 adds smart wallet labels.
- Services and boundaries separated: Task 5 gives service/stop roles separate branch positions.
- Peer links: existing `Peer links on/off` remains, and Task 4 keeps visible peer edges if endpoints are retained.
- Targeted expansion: Task 7.
- Risk not hardcoded unknown: Task 1.
- Incoming-deposit and where-is-money untouched: every routing change is guarded by `address_deep_check`.

Open-item scan:

- The plan contains no open markers.
- Every code step names exact files and concrete functions.
- Every test step has a command and expected result.

Type consistency:

- New display mode string is `deep_branch_map`.
- New helpers are `graphKindUsesDeepBranchMap`, `buildDeepBranchPresentation`, `deepBranchMapLayout`, `effectiveTxLabelMode`, `visibleNodeLabelIds`, and `isDeepBranchGroupNodeId`.
- State keys are `txLabelMode`, `walletLabelMode`, `servicesVisible`, `peerLinksVisible`, and `expandedBundleNodeIds`.
