# Admin Wallet Group Expand And Edge Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix misleading admin graph rendering for wallet groups, known service members, duplicate transfer/context edges, and contract/service route clarity.

**Architecture:** Keep the change UI-first in `adminConsole.ts`: wallet-cluster presentation decides group expansion, graph presentation deduplicates competing visible evidence edges, and edge/node helpers encode clearer service and context semantics. Touch `forensicsGraph.ts` only if tests prove service identity is missing before the UI layer.

**Tech Stack:** TypeScript, existing admin graph HTML/JS helpers inside `src/admin/adminConsole.ts`, Vitest extraction-style tests in `tests/admin/adminConsole.test.ts`.

---

## Source Spec

Use this design as the source of truth:

```text
docs/superpowers/specs/2026-07-01-admin-wallet-group-expand-and-service-labels-design.md
```

## Scope Check

This is one connected admin graph readability feature. It should not change scoring, risk policy, evidence collection, provider fetching, or transaction storage. If implementation discovers missing service identity in graph payloads, make the smallest possible `src/admin/forensicsGraph.ts` projection fix and cover it with `tests/admin/forensicsGraph.test.ts`.

## File Map

Modify:

```text
src/admin/adminConsole.ts
tests/admin/adminConsole.test.ts
```

Modify only if service identity is missing before the UI layer:

```text
src/admin/forensicsGraph.ts
tests/admin/forensicsGraph.test.ts
```

Do not modify:

```text
src/risk/*
tests/risk/*
src/bot/createBot.ts
src/forensics/incomingDepositJob.ts
src/types.ts
```

Reason: the scoring-signal-matrix work is running separately, and this task is admin graph display only.

---

### Task 1: Fix Wallet Cluster Group Presentation

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing wallet-group presentation tests**

In `tests/admin/adminConsole.test.ts`, add a new test after `builds wallet cluster presentation with ordinary wallets separated from boundaries`.

Use this test body:

```ts
  it("opens wallet-cluster groups without duplicate aggregate edges and skips single-member groups", () => {
    const html = adminConsoleHtml();
    const graphModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const presentationBlock = html.slice(html.indexOf("function walletClusterNodeRole"), html.indexOf("function applyExpandedBundlePresentation"));
    const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));

    const api = new Function(`
      const state = {
        densityMode: "auto",
        servicesVisible: true,
        expandedBundleNodeIds: new Set(),
        graph: { job: { kind: "address_deep_check" } }
      };
      function stableNodeSort(a, b) {
        const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);
        const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);
        if (bWeight !== aWeight) return bWeight - aWeight;
        return String(a.id).localeCompare(String(b.id));
      }
      function nodeDisplayKind(node) {
        if (!node) return "wallet";
        if (node.displayKind) return node.displayKind;
        if (node.kind === "subject") return "subject_wallet";
        if (node.kind === "group") return "collapsed_group";
        return node.kind || "wallet";
      }
      function nodeIsServiceLike(node) {
        const kind = nodeDisplayKind(node);
        return kind === "bridge" || kind === "cex" || kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract" || kind === "service_boundary";
      }
      function nodeIsSmartContractLaneNode() { return false; }
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function rawBigInt() { return null; }
      function nodeImportanceScore(node) { return Number(node.weight || node.score || 0); }
      function rankNodesByImportance(nodes, edges) {
        return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id)));
      }
      function applyExpandedBundlePresentation(nodes, edges) { return { nodes, edges }; }
      ${graphModeBlock}
      ${presentationBlock}
      ${graphPresentationBlock}
      return { state, buildWalletClusterPresentation, graphPresentation };
    `)() as {
      state: { expandedBundleNodeIds: Set<string> };
      buildWalletClusterPresentation(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] };
      graphPresentation(nodes: any[], edges: any[]): { nodes: any[]; edges: any[]; mode: string };
    };

    const nodes = [
      { id: "subject", kind: "subject", weight: 100 },
      { id: "anchor", kind: "wallet", weight: 90 },
      { id: "hidden-a", kind: "wallet", weight: 0 },
      { id: "hidden-b", kind: "wallet", weight: 0 },
      { id: "single-hidden", kind: "wallet", weight: -1 }
    ];
    const edges = [
      { id: "anchor-subject", fromNodeId: "anchor", toNodeId: "subject" },
      { id: "hidden-a-anchor", fromNodeId: "hidden-a", toNodeId: "anchor", txHash: "tx-a" },
      { id: "hidden-b-anchor", fromNodeId: "hidden-b", toNodeId: "anchor", txHash: "tx-b" },
      { id: "single-anchor", fromNodeId: "single-hidden", toNodeId: "anchor", txHash: "tx-single" }
    ];

    const closed = api.buildWalletClusterPresentation(nodes, edges);
    expect(closed.nodes.some((node) => node.id === "collapsed:wallet_cluster:intermediate")).toBe(true);
    expect(closed.nodes.some((node) => node.label === "Group: 1 wallets")).toBe(false);
    expect(closed.nodes.some((node) => node.id === "single-hidden")).toBe(true);
    expect(closed.edges.filter((edge) => edge.displayRole === "collapsed_group")).toHaveLength(1);

    api.state.expandedBundleNodeIds.add("collapsed:wallet_cluster:intermediate");
    const opened = api.buildWalletClusterPresentation(nodes, edges);
    const openedGroup = opened.nodes.find((node) => node.id === "collapsed:wallet_cluster:intermediate");
    expect(openedGroup).toMatchObject({
      metadata: {
        walletClusterExpanded: true,
        walletClusterRole: "intermediate"
      }
    });
    expect(opened.nodes.some((node) => node.id === "hidden-a")).toBe(true);
    expect(opened.nodes.some((node) => node.id === "hidden-b")).toBe(true);
    expect(opened.edges.some((edge) => edge.displayRole === "collapsed_group")).toBe(false);
    expect(opened.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining(["hidden-a-anchor", "hidden-b-anchor", "single-anchor"]));
  });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "opens wallet-cluster groups"
```

Expected: fail because single-member hidden wallets currently become `Group: 1 wallets`, and opened wallet-cluster groups are not expanded by group id.

- [ ] **Step 3: Implement wallet-cluster group presentation**

In `src/admin/adminConsole.ts`, add helpers immediately before `buildWalletClusterPresentation`:

```js
    function walletClusterGroupId(role) {
      return "collapsed:wallet_cluster:" + role;
    }
    function walletClusterGroupIsExpanded(groupId) {
      return state.expandedBundleNodeIds.has(groupId);
    }
    function walletClusterGroupNode(groupId, hiddenNodes, role, expanded) {
      return {
        id: groupId,
        kind: "group",
        displayKind: "collapsed_group",
        label: (expanded ? "Group open: " : "Group: ") + hiddenNodes.length + " wallets",
        weight: hiddenNodes.length,
        metadata: {
          walletClusterSummary: true,
          walletClusterExpanded: expanded,
          walletClusterRole: role,
          groupKind: role,
          collapsedCount: hiddenNodes.length,
          hiddenNodeIds: hiddenNodes.map((node) => node.id),
          groupReason: "wallet_cluster_overview",
          uiCollapsedGroup: true,
          realGroupKind: "ui_collapsed_wallet_cluster_group"
        }
      };
    }
```

Then replace the `hiddenByRole.forEach` block inside `buildWalletClusterPresentation` with:

```js
      hiddenByRole.forEach((hiddenNodes, role) => {
        if (hiddenNodes.length === 0) return;
        if (hiddenNodes.length === 1) {
          const node = hiddenNodes[0];
          kept.push({
            ...node,
            metadata: {
              ...node.metadata,
              walletClusterRole: role,
              walletClusterSingleton: true
            }
          });
          return;
        }
        const groupId = walletClusterGroupId(role);
        const expanded = walletClusterGroupIsExpanded(groupId);
        groupKindById.set(groupId, role);
        groups.push(walletClusterGroupNode(groupId, hiddenNodes, role, expanded));
        if (expanded) {
          hiddenNodes.forEach((node) => {
            kept.push({
              ...node,
              metadata: {
                ...node.metadata,
                walletClusterRole: role,
                walletClusterExpandedFromGroupId: groupId
              }
            });
          });
          return;
        }
        hiddenNodes.forEach((node) => hiddenNodeToGroupId.set(node.id, groupId));
      });
```

Keep the existing collapsed-edge aggregation logic. Because expanded group members are now in `kept` and not mapped through `hiddenNodeToGroupId`, raw member edges stay visible and aggregate collapsed edges disappear while the group is open.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "opens wallet-cluster groups"
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): expand wallet groups without aggregate duplicates"
```

---

### Task 2: Add Double-Click Toggle And Button Toggle

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing interaction structure test**

In `tests/admin/adminConsole.test.ts`, add this test near existing renderGraph interaction tests:

```ts
  it("toggles collapsed wallet groups from double click and expand selected", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const expandBlock = html.slice(html.indexOf("function isCollapsedGroupNodeId"), html.indexOf("function selectNode"));

    expect(html).toContain("function toggleCollapsedGroup");
    expect(expandBlock).toContain('state.expandedBundleNodeIds.delete(groupId)');
    expect(expandBlock).toContain('state.expandedBundleNodeIds.add(groupId)');
    expect(expandBlock).not.toContain('setDensityMode("show_all")');
    expect(renderBlock).toContain('node.addEventListener("dblclick", (event) => {');
    expect(renderBlock).toContain("toggleCollapsedGroup(nodeId)");
  });
```

- [ ] **Step 2: Run the interaction test and verify failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "toggles collapsed wallet groups"
```

Expected: fail because there is no `dblclick` handler and `expandCollapsedGroup()` currently calls `setDensityMode("show_all")`.

- [ ] **Step 3: Replace selected-group expansion with toggle**

In `src/admin/adminConsole.ts`, replace `expandCollapsedGroup()` with:

```js
    function toggleCollapsedGroup(groupId) {
      if (!isCollapsedGroupNodeId(groupId)) return false;
      if (isDeepBranchGroupNodeId(groupId)) return false;
      if (state.expandedBundleNodeIds.has(groupId)) {
        state.expandedBundleNodeIds.delete(groupId);
        setStatus("Collapsed selected wallet group.");
      } else {
        state.expandedBundleNodeIds.add(groupId);
        setStatus("Expanded selected wallet group.");
      }
      state.selected = { type: "node", id: groupId };
      renderGraph();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
      return true;
    }
    function expandCollapsedGroup() {
      if (!state.selected || state.selected.type !== "node") {
        setStatus("Select a wallet group first.");
        return;
      }
      if (!toggleCollapsedGroup(state.selected.id)) {
        setStatus("Selected display group cannot be toggled here.");
      }
    }
```

Leave the deep-branch group path in `expandSelectedGraphItem()` unchanged; it still has its own reveal behavior.

- [ ] **Step 4: Add double-click handler in renderGraph**

Inside the existing `svg.querySelectorAll("[data-node-id]").forEach((node) => { ... })` block, add this handler before the `mousedown` handler:

```js
        node.addEventListener("dblclick", (event) => {
          const nodeId = node.getAttribute("data-node-id");
          if (!isCollapsedGroupNodeId(nodeId) || isDeepBranchGroupNodeId(nodeId)) return;
          event.preventDefault();
          event.stopPropagation();
          toggleCollapsedGroup(nodeId);
        });
```

Update the click status copy for groups:

```js
          if (isCollapsedGroupNodeId(nodeId)) setStatus("Selected display group. Double-click or use Expand selected to toggle it.");
```

- [ ] **Step 5: Run focused interaction test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "toggles collapsed wallet groups"
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat(admin): toggle wallet groups on double click"
```

---

### Task 3: Preserve Known Service Semantics Inside Groups

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`
- Optional: `src/admin/forensicsGraph.ts`
- Optional: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing service-member classification test**

In `tests/admin/adminConsole.test.ts`, add this test near `classifies smart-contract scene nodes for a dedicated lane`:

```ts
  it("treats known service identities inside wallet groups as service-like", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function serviceEdgeTone"));
    const api = new Function(`
      const state = { graph: { nodes: [] } };
      ${helperBlock}
      return { nodeDisplayKind, nodeIsServiceLike, nodeDisplayLabel };
    `)() as {
      nodeDisplayKind(node: unknown): string;
      nodeIsServiceLike(node: unknown): boolean;
      nodeDisplayLabel(node: unknown): string;
    };

    const kucoinMember = {
      id: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
      kind: "wallet",
      label: "TUpHuD...t8J2b9",
      metadata: {
        walletClusterRole: "intermediate",
        boundaryIdentity: {
          displayName: "KuCoin",
          category: "cex",
          categoryLabel: "CEX / exchange",
          confidence: "high"
        }
      }
    };

    expect(api.nodeDisplayKind(kucoinMember)).toBe("cex");
    expect(api.nodeIsServiceLike(kucoinMember)).toBe(true);
    expect(api.nodeDisplayLabel(kucoinMember)).toBe("KuCoin");
  });
```

- [ ] **Step 2: Run the service-member test and verify failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "known service identities"
```

Expected: fail if `nodeDisplayKind()` does not inspect `boundaryIdentity.category`, `boundaryIdentity.categoryLabel`, or `boundaryIdentity.displayName`.

- [ ] **Step 3: Implement identity-aware node marker and display kind**

In `src/admin/adminConsole.ts`, update `nodeMarker(node)` to include boundary identity fields:

```js
        boundaryIdentityName(node),
        boundaryIdentityCategoryLabel(node),
        boundaryIdentityOf(node)?.category,
        boundaryIdentityOf(node)?.displayName,
        boundaryIdentityOf(node)?.categoryLabel,
```

Place those entries before `node?.label`.

Then add this check inside `nodeDisplayKind(node)` after `const marker = nodeMarker(node);`:

```js
      const boundaryCategory = String(boundaryIdentityOf(node)?.category || boundaryIdentityCategoryLabel(node) || "").toLowerCase();
      if (boundaryCategory.includes("cex") || boundaryCategory.includes("exchange")) return "cex";
      if (boundaryCategory.includes("bridge")) return "bridge";
      if (boundaryCategory.includes("dex") || boundaryCategory.includes("router")) return "dex_contract";
      if (boundaryCategory.includes("contract")) return "smart_contract";
      if (boundaryCategory.includes("service")) return "service_boundary";
```

This is a UI classification rule. Do not add a hardcoded KuCoin address list.

- [ ] **Step 4: Run service-member test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "known service identities"
```

Expected: pass.

- [ ] **Step 5: Only if the test cannot be made to pass from existing UI metadata, inspect graph projection**

If UI metadata is absent in real fixtures, search `src/admin/forensicsGraph.ts` for where boundary identity is projected into nodes. Add a focused projection test in `tests/admin/forensicsGraph.test.ts` that creates a known CEX/service node and asserts the node carries:

```ts
expect(node.metadata?.boundaryIdentity).toMatchObject({
  displayName: expect.any(String),
  category: expect.any(String)
});
```

Implement the smallest projection fix that preserves existing evidence. Do not edit scoring or collectors.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): preserve service identity in wallet groups"
```

If `forensicsGraph.ts` was touched, use:

```powershell
git add src/admin/adminConsole.ts src/admin/forensicsGraph.ts tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix(admin): preserve service identity in wallet groups"
```

---

### Task 4: Deduplicate Competing Visible Evidence Edges

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing duplicate-edge tests**

In `tests/admin/adminConsole.test.ts`, add this test near edge label/render tests:

```ts
  it("keeps one visible edge for overlapping direct and grouped evidence", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeHasAggregatedTxEvidence"), html.indexOf("const api = async"));
    const graphPresentationBlock = html.slice(html.indexOf("function simplifyVisibleEvidenceEdges"), html.indexOf("function layout"));

    expect(html).toContain("function simplifyVisibleEvidenceEdges");

    const api = new Function(`
      const state = { graph: { job: { kind: "where_is_money_check" } } };
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function nodeDisplayKind(node) { return node?.displayKind || node?.kind || "wallet"; }
      function nodeIsServiceLike(node) { return ["cex", "bridge", "service_boundary", "smart_contract", "contract_router", "contract_adapter", "dex_contract"].includes(nodeDisplayKind(node)); }
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeEvidenceType(edge) {
        if (edge?.metadata?.evidenceType) return String(edge.metadata.evidenceType);
        if (edge?.type === "transfer") return "direct_transfer";
        return "unknown";
      }
      ${helperBlock}
      ${graphPresentationBlock}
      return { simplifyVisibleEvidenceEdges };
    `)() as {
      simplifyVisibleEvidenceEdges(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] };
    };

    const nodes = [
      { id: "source", kind: "wallet" },
      { id: "subject", kind: "subject" }
    ];
    const edges = [
      {
        id: "direct-50k",
        fromNodeId: "source",
        toNodeId: "subject",
        type: "transfer",
        txHash: "tx-50k",
        amountFormatted: "50K USDT",
        metadata: { evidenceType: "direct_transfer" }
      },
      {
        id: "grouped-50k",
        fromNodeId: "source",
        toNodeId: "subject",
        type: "transfer",
        displayRole: "profile_context",
        metadata: {
          evidenceType: "grouped_transfers",
          txHashes: ["tx-50k"],
          aggregateAmountFormatted: "50K USDT",
          aggregateTransferCount: 1
        }
      }
    ];

    const simplified = api.simplifyVisibleEvidenceEdges(nodes, edges);
    expect(simplified.edges.map((edge) => edge.id)).toEqual(["direct-50k"]);
    expect(simplified.edges[0].metadata.mergedCanvasEvidenceEdgeIds).toEqual(["grouped-50k"]);
  });
```

- [ ] **Step 2: Run duplicate-edge test and verify failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "one visible edge"
```

Expected: fail because `simplifyVisibleEvidenceEdges` does not exist.

- [ ] **Step 3: Implement UI-only edge simplification helpers**

In `src/admin/adminConsole.ts`, add these helpers before `graphPresentation`:

```js
    function edgeEndpointPairKey(edge) {
      const from = String(edge?.fromNodeId || "");
      const to = String(edge?.toNodeId || "");
      return from <= to ? from + "<->" + to : to + "<->" + from;
    }
    function edgeTxHashSet(edge) {
      return new Set(edgeTxHashes(edge));
    }
    function edgesShareTxEvidence(left, right) {
      const leftHashes = edgeTxHashSet(left);
      if (leftHashes.size === 0) return false;
      return edgeTxHashes(right).some((hash) => leftHashes.has(hash));
    }
    function edgeVisibleEvidencePriority(edge) {
      const type = edgeEvidenceType(edge);
      if (type === "direct_transfer" || type === "contract_driven_transfer") return 100;
      if (type === "approval_drain_transfer") return 95;
      if (edge?.type === "transfer" && edge?.txHash && edgeDisplayRole(edge) === "real_transfer") return 90;
      if (type === "grouped_transfers") return 50;
      if (type === "boundary_context" || type === "profile_context") return 35;
      return 10;
    }
    function mergeCanvasEvidenceEdge(primary, duplicate) {
      return {
        ...primary,
        metadata: {
          ...primary.metadata,
          mergedCanvasEvidenceEdgeIds: [
            ...asArray(primary?.metadata?.mergedCanvasEvidenceEdgeIds),
            duplicate.id
          ].filter(Boolean),
          mergedCanvasEvidenceTxHashes: [
            ...edgeTxHashes(primary),
            ...edgeTxHashes(duplicate)
          ].filter(Boolean)
        }
      };
    }
    function simplifyVisibleEvidenceEdges(nodes, edges) {
      const kept = [];
      const sorted = [...edges].sort((a, b) => edgeVisibleEvidencePriority(b) - edgeVisibleEvidencePriority(a));
      sorted.forEach((edge) => {
        const duplicateIndex = kept.findIndex((candidate) =>
          edgeEndpointPairKey(candidate) === edgeEndpointPairKey(edge) &&
          edgesShareTxEvidence(candidate, edge)
        );
        if (duplicateIndex === -1) {
          kept.push(edge);
          return;
        }
        const primary = kept[duplicateIndex];
        const secondary = edgeVisibleEvidencePriority(primary) >= edgeVisibleEvidencePriority(edge) ? edge : primary;
        const winner = edgeVisibleEvidencePriority(primary) >= edgeVisibleEvidencePriority(edge) ? primary : edge;
        kept[duplicateIndex] = mergeCanvasEvidenceEdge(winner, secondary);
      });
      return { nodes, edges: kept.sort((a, b) => String(a.id).localeCompare(String(b.id))) };
    }
```

This helper only removes duplicate visible canvas edges. It preserves duplicate evidence ids and tx hashes on the primary edge metadata for right-rail details.

- [ ] **Step 4: Apply simplification in graphPresentation**

Change the end of `graphPresentation` from:

```js
      return { ...applyExpandedBundlePresentation(presentation.nodes, presentation.edges), mode, dense };
```

to:

```js
      const expanded = applyExpandedBundlePresentation(presentation.nodes, presentation.edges);
      const simplified = simplifyVisibleEvidenceEdges(expanded.nodes, expanded.edges);
      return { ...simplified, mode, dense };
```

- [ ] **Step 5: Run duplicate-edge test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "one visible edge"
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): dedupe overlapping graph evidence edges"
```

---

### Task 5: Clarify Contract Routes And Dense Service Context

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing contract-route and service fan tests**

In `tests/admin/adminConsole.test.ts`, add this test near the duplicate-edge test:

```ts
  it("marks contract route duplicates and dense service context as secondary", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeHasAggregatedTxEvidence"), html.indexOf("const api = async"));
    const presentationBlock = html.slice(html.indexOf("function edgeEndpointPairKey"), html.indexOf("function layout"));
    const extraClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeStrokeWidth"));

    expect(html).toContain("uiDenseServiceFanContext");
    expect(html).toContain("edge-service-fan-context");

    const api = new Function(`
      const state = { graph: { job: { kind: "address_deep_check" } } };
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function nodeDisplayKind(node) { return node?.displayKind || node?.kind || "wallet"; }
      const nodesById = new Map([
        ["subject", { id: "subject", kind: "subject" }],
        ["contract", { id: "contract", kind: "contract" }],
        ["gasfree", { id: "gasfree", kind: "service", displayKind: "service_boundary" }],
        ["bybit", { id: "bybit", kind: "service", displayKind: "cex" }]
      ]);
      function nodeById(id) { return nodesById.get(id); }
      function nodeIsServiceLike(node) { return ["cex", "service_boundary", "smart_contract"].includes(nodeDisplayKind(node)); }
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || (edge?.type === "transfer" ? "direct_transfer" : "unknown"); }
      ${helperBlock}
      ${presentationBlock}
      ${extraClassBlock}
      return { simplifyVisibleEvidenceEdges, markDenseServiceFanContext, edgeExtraClass };
    `)() as {
      simplifyVisibleEvidenceEdges(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] };
      markDenseServiceFanContext(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] };
      edgeExtraClass(edge: any, role: string): string;
    };

    const routeEdges = [
      { id: "gasfree-contract", fromNodeId: "gasfree", toNodeId: "contract", metadata: { evidenceType: "contract_trigger_context", txHashes: ["tx-50k"] } },
      { id: "contract-subject", fromNodeId: "contract", toNodeId: "subject", metadata: { evidenceType: "contract_driven_transfer", txHashes: ["tx-50k"] } },
      { id: "gasfree-subject-duplicate", fromNodeId: "gasfree", toNodeId: "subject", displayRole: "profile_context", metadata: { evidenceType: "grouped_transfers", txHashes: ["tx-50k"] } }
    ];
    const simplifiedRoute = api.simplifyVisibleEvidenceEdges([...nodesById.values()], routeEdges);
    expect(simplifiedRoute.edges.map((edge) => edge.id)).toEqual(["contract-subject", "gasfree-contract"]);

    const fanEdges = Array.from({ length: 10 }, (_, index) => ({
      id: "bybit-context-" + index,
      fromNodeId: "wallet-" + index,
      toNodeId: "bybit",
      displayRole: "profile_context",
      metadata: { evidenceType: "profile_context", aggregateAmountFormatted: "19K USDT" }
    }));
    const marked = api.markDenseServiceFanContext([...nodesById.values()], fanEdges);
    expect(marked.edges.every((edge) => edge.metadata.uiDenseServiceFanContext === true)).toBe(true);
    expect(api.edgeExtraClass(marked.edges[0], "service")).toContain("edge-service-fan-context");
  });
```

- [ ] **Step 2: Run contract/service context test and verify failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "contract route duplicates"
```

Expected: fail because dense service context marking and contract-route duplicate removal are not implemented yet.

- [ ] **Step 3: Extend duplicate detection for contract-mediated route duplicates**

In `src/admin/adminConsole.ts`, add these helpers near `simplifyVisibleEvidenceEdges`:

```js
    function edgeNodeIds(edge) {
      return [String(edge?.fromNodeId || ""), String(edge?.toNodeId || "")].filter(Boolean);
    }
    function edgeTouchesNode(edge, nodeId) {
      return edge?.fromNodeId === nodeId || edge?.toNodeId === nodeId;
    }
    function edgeIsContractRouteDuplicate(edge, kept) {
      const hashes = edgeTxHashSet(edge);
      if (hashes.size === 0) return false;
      const endpoints = edgeNodeIds(edge);
      const endpointNodes = endpoints.map((nodeId) => nodeById(nodeId)).filter(Boolean);
      const touchesService = endpointNodes.some((node) => nodeIsServiceLike(node));
      const touchesSubject = endpointNodes.some((node) => node?.kind === "subject");
      if (!touchesService || !touchesSubject) return false;
      const contractRouteEdges = kept.filter((candidate) =>
        edgeTxHashes(candidate).some((hash) => hashes.has(hash)) &&
        edgeNodeIds(candidate).some((nodeId) => {
          const node = nodeById(nodeId);
          return node?.kind === "contract" || nodeDisplayKind(node) === "smart_contract";
        })
      );
      return contractRouteEdges.length >= 2;
    }
```

Inside `simplifyVisibleEvidenceEdges`, before the endpoint-pair duplicate check, add:

```js
        if (edgeIsContractRouteDuplicate(edge, kept)) {
          const primaryIndex = kept.findIndex((candidate) => edgesShareTxEvidence(candidate, edge));
          if (primaryIndex >= 0) kept[primaryIndex] = mergeCanvasEvidenceEdge(kept[primaryIndex], edge);
          return;
        }
```

- [ ] **Step 4: Add dense service fan marking**

Add this helper before `graphPresentation`:

```js
    function edgeIsServiceFanContext(edge) {
      const type = edgeEvidenceType(edge);
      return type === "profile_context" || type === "boundary_context" || type === "grouped_transfers";
    }
    function markDenseServiceFanContext(nodes, edges) {
      const serviceIds = new Set(nodes.filter(nodeIsServiceLike).map((node) => node.id));
      const countByServiceId = new Map();
      edges.forEach((edge) => {
        if (!edgeIsServiceFanContext(edge)) return;
        [edge.fromNodeId, edge.toNodeId].forEach((nodeId) => {
          if (serviceIds.has(nodeId)) countByServiceId.set(nodeId, (countByServiceId.get(nodeId) || 0) + 1);
        });
      });
      const denseServiceIds = new Set([...countByServiceId.entries()].filter(([, count]) => count >= 8).map(([nodeId]) => nodeId));
      return {
        nodes,
        edges: edges.map((edge) => {
          const dense = denseServiceIds.has(edge.fromNodeId) || denseServiceIds.has(edge.toNodeId);
          if (!dense || !edgeIsServiceFanContext(edge)) return edge;
          return {
            ...edge,
            metadata: {
              ...edge.metadata,
              uiDenseServiceFanContext: true
            }
          };
        })
      };
    }
```

Apply it in `graphPresentation` after `simplifyVisibleEvidenceEdges`:

```js
      const simplified = simplifyVisibleEvidenceEdges(expanded.nodes, expanded.edges);
      const serviceReadable = markDenseServiceFanContext(simplified.nodes, simplified.edges);
      return { ...serviceReadable, mode, dense };
```

Update `edgeExtraClass(edge, visualRole)`:

```js
      if (edge?.metadata?.uiDenseServiceFanContext === true) classes.push("edge-service-fan-context");
```

Add CSS near service edge classes:

```css
    .edge.edge-service-fan-context { opacity: .34; stroke-dasharray: 8 10; }
    .edge.edge-service-fan-context.selected { opacity: .95; }
```

Update `edgeShouldShowCanvasAmount(edge)` and `edgeShouldShowCanvasTime(edge)` to hide labels on dense service fan context unless selected:

```js
      if (edge?.metadata?.uiDenseServiceFanContext === true && !selectedEdgeLabelVisible(edge)) return false;
```

- [ ] **Step 5: Run contract/service context test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "contract route duplicates"
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): clarify contract and service context edges"
```

---

### Task 6: Fix Connected Neighbor Copy For Service Nodes

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `src/admin/adminConsole.ts`

- [ ] **Step 1: Add failing connected-neighbor service test**

In `tests/admin/adminConsole.test.ts`, extend `shows selected node connected neighbors in the analytics rail` or add this adjacent test:

```ts
  it("uses rendered evidence edges for selected service connected neighbors", () => {
    const html = adminConsoleHtml();
    const block = html.slice(html.indexOf("function connectedNeighborLines"), html.indexOf("function selectedNodeTransferEdges"));

    expect(block).toContain("state.renderedEdgesById.values()");
    expect(block).toContain("edgeHasStoredMoneyEvidence(edge)");
  });
```

- [ ] **Step 2: Run connected-neighbor test and verify failure**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "rendered evidence edges"
```

Expected: fail if `connectedNeighborLines()` only uses `filteredTransferEdges()` and misses rendered/presentation evidence edges.

- [ ] **Step 3: Update connectedNeighborLines**

In `src/admin/adminConsole.ts`, replace the start of `connectedNeighborLines(node)` with:

```js
      const candidateEdges = [
        ...filteredTransferEdges(),
        ...state.renderedEdgesById.values()
      ];
      const seenEdgeIds = new Set();
      return candidateEdges
        .filter((edge) => {
          if (!edge?.id || seenEdgeIds.has(edge.id)) return false;
          seenEdgeIds.add(edge.id);
          return true;
        })
```

Keep the existing endpoint mapping and `addressDetailLink` logic. If the existing filter uses `edgeIsPeerLink(edge)`, allow service/context edges with stored money evidence:

```js
        .filter((edge) => edgeIsPeerLink(edge) || edgeHasStoredMoneyEvidence(edge))
```

This keeps the right rail from saying "No connected neighbor links" when service evidence lines or transfer cards are visibly connected to the selected service node.

- [ ] **Step 4: Run connected-neighbor test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "rendered evidence edges|connected neighbors"
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): show service evidence neighbors"
```

---

### Task 7: Full Verification And Diff Review

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run full admin console test**

Run:

```powershell
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts
```

Expected: pass, currently 114 tests plus the new tests.

- [ ] **Step 2: Run admin graph projection test if touched**

If `src/admin/forensicsGraph.ts` changed, run:

```powershell
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Inspect changed files for scoring leakage**

Run:

```powershell
git diff --name-only master..HEAD
git diff --stat master..HEAD
```

Expected changed files are limited to:

```text
docs/superpowers/specs/2026-07-01-admin-wallet-group-expand-and-service-labels-design.md
docs/superpowers/plans/2026-07-01-admin-wallet-group-expand-and-edge-clarity.md
src/admin/adminConsole.ts
tests/admin/adminConsole.test.ts
```

If `forensicsGraph.ts` was needed, the allowed list also includes:

```text
src/admin/forensicsGraph.ts
tests/admin/forensicsGraph.test.ts
```

No `src/risk/*`, `tests/risk/*`, scoring matrix, bot scoring, or incoming job files should be changed.

- [ ] **Step 5: Commit verification leftovers if any**

Run:

```powershell
git status --short
```

If clean, skip this step. If only test expectation updates remain, commit them:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "test(admin): verify wallet group edge clarity"
```

Do not run `git add .`.

---

## Implementation Notes

- Keep this lazy: no new dependencies, no graph library rewrite, no dashboard redesign.
- Prefer presentation-layer filtering and metadata over collector changes.
- Preserve evidence in right-rail details even when hiding duplicate canvas edges.
- A muted edge or hidden aggregate edge is a UI decision only; it must not delete tx hashes from the graph payload.
- Use `ponytail:` comments only for intentional simplifications with a known ceiling, such as the dense service fan threshold.

## Self-Review

Spec coverage:

- Double-click group toggle: Task 2.
- `Expand selected` toggle: Task 2.
- Single-member group removal: Task 1.
- Open group handle and no aggregate duplicates: Task 1.
- Known service members inside groups: Task 3.
- Where-is-money duplicate transfer/context edges: Task 4.
- Contract-mediated gas-free/service route clarity: Task 5.
- Dashed context label consistency and service fan visual deemphasis: Task 5.
- Service selected-node connected neighbor copy: Task 6.
- Scoring isolation: Task 7.

- Each code-changing task includes concrete tests, implementation snippets, commands, expected results, and commit commands.

Type consistency:

- New helpers are consistently named: `walletClusterGroupId`, `walletClusterGroupIsExpanded`, `walletClusterGroupNode`, `toggleCollapsedGroup`, `simplifyVisibleEvidenceEdges`, `markDenseServiceFanContext`.
- Tests reference helpers introduced in the same task or earlier tasks.
