# Admin Deep Check Wallet Clusters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Wallet clusters` default reading layer for dense `address_deep_check` graphs so DeepCheck shows ordinary wallet chains, peer links, clusters, and boundaries more clearly without changing scoring or fetching.

**Architecture:** Keep the first implementation inside the existing admin graph projection and vanilla admin console. Add lightweight DeepCheck wallet-cluster metadata in `src/admin/forensicsGraph.ts`, then add a new `wallet_clusters` display mode in `src/admin/adminConsole.ts` that reuses existing DeepCheck graph data, existing expansion state, existing service filtering, and existing right-rail evidence details.

**Tech Stack:** TypeScript, existing admin HTML/SVG/canvas runtime in `src/admin/adminConsole.ts`, existing projection logic in `src/admin/forensicsGraph.ts`, Vitest tests in `tests/admin`.

---

## Scope

Implement only the first product slice:

- `address_deep_check` gets a new default graph mode named `wallet_clusters`.
- Existing `deep_branch_map` stays available as a secondary technical graph mode.
- Existing `show_all` stays the raw/audit escape hatch.
- Existing `incoming_deposit_check` and `where_is_money_check` behavior is unchanged.
- Existing scoring, DeepCheck fetching, API budgets, and database shape are unchanged.

## File Structure

- Modify `src/admin/forensicsGraph.ts`
  - Add DeepCheck wallet-cluster metadata to projected nodes and edges.
  - Do not change traversal, fetching, or scoring.
- Modify `src/admin/adminConsole.ts`
  - Add `wallet_clusters` graph mode.
  - Add controls text for `Wallet clusters / Deep branch map / Show all raw`.
  - Add wallet-cluster presentation and layout using existing graph nodes/edges.
  - Add right-rail wording for wallet-cluster node/edge meanings.
- Modify `tests/admin/forensicsGraph.test.ts`
  - Add projection tests for cluster metadata.
- Modify `tests/admin/adminConsole.test.ts`
  - Add UI routing, layout, legend, and panel tests.

No new dependency. No React rewrite. No new database migration.

---

### Task 1: Add DeepCheck Wallet-Cluster Projection Metadata

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write the failing projection test**

Add this test near the existing `address_deep_check` projection tests in `tests/admin/forensicsGraph.test.ts`:

```ts
it("projects deep-check wallet cluster metadata for ordinary wallets and boundaries", () => {
  const subject = "TSubjectCluster111111111111111111111";
  const source = "TSourceCluster1111111111111111111111";
  const via = "TViaCluster111111111111111111111111";
  const cex = "TCexCluster111111111111111111111111";

  const result = projectForensicJobGraph(job({
    kind: "address_deep_check",
    subjectAddress: subject,
    resultJson: {
      subjectAddress: subject,
      coverage: { transferEdges: 3 },
      coverageDebug: { missingChecks: [] },
      counterpartyRiskProfiles: [
        {
          counterpartyAddress: source,
          direction: "inbound",
          score: 12,
          volumeRaw: "25000000000",
          txCount: 1,
          evidenceIds: ["source-subject"]
        }
      ],
      inboundProvenanceProfiles: [
        {
          senderAddress: source,
          paths: [
            {
              pathId: "path-source-via-subject",
              amountRaw: "25000000000",
              edges: [
                {
                  fromAddress: via,
                  toAddress: source,
                  amountRaw: "25000000000",
                  txHash: "via-source-tx",
                  timestamp: "2026-06-23T12:31:00.000Z"
                },
                {
                  fromAddress: source,
                  toAddress: subject,
                  amountRaw: "25000000000",
                  txHash: "source-subject-tx",
                  timestamp: "2026-06-23T12:36:00.000Z"
                }
              ]
            }
          ]
        }
      ],
      boundaryExposureProfiles: [
        {
          flows: [
            {
              direction: "inbound",
              depth: 2,
              viaAddress: source,
              boundaryAddress: cex,
              boundaryCategory: "cex",
              boundaryIdentity: "Exchange",
              amountRaw: "25000000000",
              boundaryAmountRaw: "25000000000",
              boundaryTxHash: "cex-source-tx",
              firstTransferAt: "2026-06-23T12:00:00.000Z"
            }
          ]
        }
      ],
      directCounterpartyInteractionProfiles: [],
      serviceExposureProfiles: [],
      walletRoleProfiles: []
    }
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);

  const subjectNode = result.graph.nodes.find((node) => node.address === subject);
  const sourceNode = result.graph.nodes.find((node) => node.address === source);
  const cexNode = result.graph.nodes.find((node) => node.address === cex);

  expect(subjectNode?.metadata.deepCheckWalletCluster).toMatchObject({
    nodeType: "subject_wallet",
    hopDepth: 0,
    expandedStatus: "checked_subject"
  });
  expect(sourceNode?.metadata.deepCheckWalletCluster).toMatchObject({
    nodeType: "ordinary_wallet",
    hopDepth: 1,
    expandedStatus: "expanded_or_observed"
  });
  expect(cexNode?.metadata.deepCheckWalletCluster).toMatchObject({
    nodeType: "boundary",
    boundaryType: "cex",
    expandedStatus: "boundary_context"
  });

  const transferEdge = result.graph.edges.find((edge) => edge.txHash === "source-subject-tx");
  const boundaryEdge = result.graph.edges.find((edge) => edge.txHash === "cex-source-tx");

  expect(transferEdge?.metadata.deepCheckWalletCluster).toMatchObject({
    edgeType: "proven_transaction",
    relationship: "wallet_to_wallet"
  });
  expect(boundaryEdge?.metadata.deepCheckWalletCluster).toMatchObject({
    edgeType: "context_boundary",
    relationship: "shared_service_or_boundary"
  });
});
```

- [ ] **Step 2: Run the failing projection test**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "projects deep-check wallet cluster metadata"
```

Expected: FAIL because `metadata.deepCheckWalletCluster` is not projected yet.

- [ ] **Step 3: Add minimal metadata helpers**

In `src/admin/forensicsGraph.ts`, near the existing DeepCheck helpers around `deepCheckCoverageSummary`, add:

```ts
function mergeDeepCheckWalletClusterMetadata(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(isRecord(current) ? current : {}),
    ...patch
  };
}

function markDeepCheckNodeCluster(
  node: AdminForensicsNode | undefined,
  patch: Record<string, unknown>
): void {
  if (!node) return;
  node.metadata = {
    ...node.metadata,
    deepCheckWalletCluster: mergeDeepCheckWalletClusterMetadata(
      node.metadata.deepCheckWalletCluster as Record<string, unknown> | undefined,
      patch
    )
  };
}

function deepCheckNodeClusterType(node: AdminForensicsNode): string {
  if (node.kind === "subject") return "subject_wallet";
  if (node.kind === "service" || node.kind === "contract" || node.kind === "bridge") return "boundary";
  if (node.kind === "group" || node.kind === "bundle") return "funding_cluster";
  if (node.kind === "trace_stop") return "history_stop";
  return "ordinary_wallet";
}

function deepCheckEdgeClusterType(edge: AdminForensicsEdge): string {
  const evidenceType = stringField(edge.metadata, "evidenceType");
  if (edge.type === "stop" || edge.displayRole === "stop") return "history_stop";
  if (evidenceType === "boundary_context" || edge.type === "service_boundary") return "context_boundary";
  if (evidenceType === "grouped_transfers") return "grouped_real_transfers";
  if (edge.displayRole === "profile_context") return "profile_context";
  return "proven_transaction";
}

function deepCheckEdgeClusterRelationship(
  edge: AdminForensicsEdge,
  nodesById: Map<string, AdminForensicsNode>
): string {
  const edgeType = deepCheckEdgeClusterType(edge);
  if (edgeType === "context_boundary") return "shared_service_or_boundary";
  if (edgeType === "history_stop") return "investigation_stop";
  const from = nodesById.get(edge.fromNodeId);
  const to = nodesById.get(edge.toNodeId);
  if (from?.kind !== "subject" && to?.kind !== "subject") return "wallet_to_wallet";
  return "subject_neighborhood";
}
```

- [ ] **Step 4: Mark projected DeepCheck nodes before returning the graph**

In `projectAddressDeepCheckGraph`, after all DeepCheck nodes and edges are created and before the final graph object is returned, add this loop:

```ts
for (const node of nodesById.values()) {
  const nodeType = deepCheckNodeClusterType(node);
  const boundarySummary = isRecord(node.metadata.boundaryEvidenceSummary)
    ? node.metadata.boundaryEvidenceSummary
    : {};
  markDeepCheckNodeCluster(node, {
    nodeType,
    hopDepth: node.kind === "subject" ? 0 : numberField(node.metadata, "hopDepth") || numberField(node.metadata, "depth") || null,
    boundaryType: firstString(stringField(boundarySummary, "category"), stringField(node.metadata, "category"), stringField(node.metadata, "serviceCategory")),
    expandedStatus: node.kind === "subject"
      ? "checked_subject"
      : nodeType === "boundary"
        ? "boundary_context"
        : nodeType === "history_stop"
          ? "history_stop"
          : "expanded_or_observed"
  });
}

for (const edge of edges) {
  edge.metadata = {
    ...edge.metadata,
    deepCheckWalletCluster: {
      edgeType: deepCheckEdgeClusterType(edge),
      relationship: deepCheckEdgeClusterRelationship(edge, nodesById),
      evidenceType: stringField(edge.metadata, "evidenceType") || null
    }
  };
}
```

If the exact return position is not obvious, put this immediately before the `return { ok: true, graph: ... }` block inside `projectAddressDeepCheckGraph`.

- [ ] **Step 5: Run the projection test**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts -t "projects deep-check wallet cluster metadata"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: add deep check wallet cluster metadata"
```

---

### Task 2: Add `Wallet clusters` Graph Mode Routing

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing mode-routing tests**

In `tests/admin/adminConsole.test.ts`, add or update the DeepCheck routing test:

```ts
it("routes dense address deep checks to wallet clusters before deep branch map", () => {
  const html = adminConsoleHtml();
  const kindBlock = html.slice(html.indexOf("function graphKindUsesFlowMap"), html.indexOf("function buildDenseFanPresentation"));
  const graphDisplayModeBlock = html.slice(html.indexOf("function graphDisplayMode"), html.indexOf("function buildDenseFanPresentation"));
  const graphFirstLayoutIndex = html.indexOf("function graphFirstLayout");
  const layoutBlock = html.slice(graphFirstLayoutIndex, html.indexOf("function graphPresentation", graphFirstLayoutIndex));
  const controlsBlock = html.slice(html.indexOf("function syncDenseGraphControls"), html.indexOf("function syncGraphFirstControls"));

  expect(kindBlock).toContain("function graphKindUsesWalletClusters");
  expect(kindBlock).toContain('return kind === "address_deep_check";');
  expect(graphDisplayModeBlock).toContain('if (mode === "deep_branch_map") return "deep_branch_map";');
  expect(graphDisplayModeBlock).toContain('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";');
  expect(layoutBlock).toContain('if (mode === "wallet_clusters") return walletClusterLayout(sourceNodes, sourceEdges);');
  expect(controlsBlock).toContain('mode === "wallet_clusters" ? "Wallet clusters"');
});
```

Update older tests that expect the default DeepCheck route to be `deep_branch_map` so they expect `wallet_clusters` for auto/default mode and `deep_branch_map` only when manually selected.

- [ ] **Step 2: Run the failing UI tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "wallet clusters"
```

Expected: FAIL because `wallet_clusters` routing does not exist.

- [ ] **Step 3: Add mode routing helpers**

In `src/admin/adminConsole.ts`, near `graphKindUsesDeepBranchMap`, add:

```js
function graphKindUsesWalletClusters(kind) {
  return kind === "address_deep_check";
}
```

Update `graphDisplayMode(nodes, edges)`:

```js
function graphDisplayMode(nodes, edges) {
  const mode = state.densityMode;
  if (mode === "show_all") return "show_all";
  if (mode === "deep_branch_map") return "deep_branch_map";
  if (mode === "fan") return "fan";
  if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";
  if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";
  if (!graphIsDense(nodes, edges)) return "show_all";
  if (graphKindSupportsStepOrbit(state.graph?.job?.kind)) return "step_orbit";
  return "fan";
}
```

Keep `graphKindUsesDeepBranchMap(kind)` returning `kind === "address_deep_check"` because the manual Deep Branch Map mode still exists.

- [ ] **Step 4: Update the graph mode button label**

In `syncDenseGraphControls`, update the density button label expression:

```js
densityButton.textContent = mode === "wallet_clusters" ? "Wallet clusters" : mode === "deep_branch_map" ? "Deep branch map" : mode === "flow_map" ? "Flow map" : mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";
```

Update the graph mode click handler so the cycle for DeepCheck is:

```text
auto -> deep_branch_map -> show_all -> auto
```

Use this logic inside the existing `el("densityMode").addEventListener("click", ...)` handler:

```js
const current = state.densityMode;
if (graphKindUsesWalletClusters(state.graph?.job?.kind)) {
  setDensityMode(current === "auto" ? "deep_branch_map" : current === "deep_branch_map" ? "show_all" : "auto");
} else {
  setDensityMode(current === "show_all" ? "auto" : "show_all");
}
```

- [ ] **Step 5: Run the UI tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "wallet clusters"
```

Expected: PASS for the new routing test.

- [ ] **Step 6: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: route deep check to wallet clusters"
```

---

### Task 3: Build Wallet-Cluster Presentation And Layout

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing presentation test**

Add this test in `tests/admin/adminConsole.test.ts` near the existing deep-branch presentation tests:

```ts
it("builds wallet cluster presentation with ordinary wallets separated from boundaries", () => {
  const html = adminConsoleHtml();
  const graphModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
  const presentationBlock = html.slice(html.indexOf("function buildWalletClusterPresentation"), html.indexOf("function applyExpandedBundlePresentation"));
  const layoutBlock = html.slice(html.indexOf("function walletClusterLayout"), html.indexOf("function graphFirstLayout"));
  const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));

  expect(html).toContain("function walletClusterNodeRole");
  expect(html).toContain("function buildWalletClusterPresentation");
  expect(html).toContain("function walletClusterLayout");
  expect(presentationBlock).toContain('metadata: {');
  expect(presentationBlock).toContain('walletClusterSummary: true');
  expect(presentationBlock).toContain('groupReason: "wallet_cluster_overview"');
  expect(layoutBlock).toContain('const laneNodes = { source: [], intermediate: [], subject: [], outgoing: [], boundary: [], stop: [], group: [] };');
  expect(layoutBlock).toContain('walletClusterNodeRole(node, subjectId, sourceEdges)');
  expect(layoutBlock).toContain('relaxNodeCollisions(nodes, fixedNodeIds, 64)');
  expect(graphPresentationBlock).toContain('if (mode === "wallet_clusters") {');
});
```

- [ ] **Step 2: Run the failing presentation test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "wallet cluster presentation"
```

Expected: FAIL because the presentation and layout functions do not exist.

- [ ] **Step 3: Add wallet-cluster role helper**

In `src/admin/adminConsole.ts`, near `stepOrbitRole`, add:

```js
function walletClusterNodeRole(node, subjectId, edges) {
  if (!node) return "intermediate";
  if (node.id === subjectId || node.kind === "subject") return "subject";
  const cluster = node?.metadata?.deepCheckWalletCluster || {};
  const clusterType = String(cluster.nodeType || "");
  if (clusterType === "boundary" || nodeIsServiceLike(node)) return "boundary";
  if (clusterType === "history_stop" || nodeDisplayKind(node) === "trace_stop") return "stop";
  if (clusterType === "funding_cluster" || nodeDisplayKind(node) === "funding_bundle" || nodeDisplayKind(node) === "collapsed_group") return "group";
  const incoming = edges.some((edge) => edge.toNodeId === subjectId && edge.fromNodeId === node.id);
  const outgoing = edges.some((edge) => edge.fromNodeId === subjectId && edge.toNodeId === node.id);
  if (incoming && !outgoing) return "source";
  if (outgoing && !incoming) return "outgoing";
  return "intermediate";
}
```

- [ ] **Step 4: Add wallet-cluster presentation grouping**

In `src/admin/adminConsole.ts`, place this function near `buildDeepBranchPresentation`:

```js
function buildWalletClusterPresentation(rawNodes, rawEdges) {
  const subjectId = rawNodes.find((node) => node.kind === "subject")?.id || rawNodes[0]?.id || "";
  if (!subjectId) return { nodes: rawNodes, edges: rawEdges };
  const important = importantClusterNodes(rawNodes, rawEdges, 72);
  const kept = [];
  const hiddenByRole = new Map();

  rawNodes.sort(stableNodeSort).forEach((node) => {
    const role = walletClusterNodeRole(node, subjectId, rawEdges);
    const keep = node.id === subjectId ||
      role === "boundary" ||
      role === "stop" ||
      role === "group" ||
      important.has(node.id);
    if (keep || state.expandedBundleNodeIds.has(node.id)) {
      kept.push({
        ...node,
        metadata: {
          ...node.metadata,
          walletClusterRole: role
        }
      });
      return;
    }
    const bucket = hiddenByRole.get(role) || [];
    bucket.push(node);
    hiddenByRole.set(role, bucket);
  });

  const groups = [];
  hiddenByRole.forEach((hiddenNodes, role) => {
    if (hiddenNodes.length === 0) return;
    const id = "collapsed:wallet_cluster:" + role;
    groups.push({
      id,
      kind: "group",
      displayKind: "collapsed_group",
      label: "Group: " + hiddenNodes.length + " wallets",
      weight: hiddenNodes.length,
      metadata: {
        walletClusterSummary: true,
        walletClusterRole: role,
        groupKind: role,
        collapsedCount: hiddenNodes.length,
        hiddenNodeIds: hiddenNodes.map((node) => node.id),
        groupReason: "wallet_cluster_overview",
        uiCollapsedGroup: true,
        realGroupKind: "ui_collapsed_wallet_cluster_group"
      }
    });
  });

  const visibleIds = new Set([...kept, ...groups].map((node) => node.id));
  const edges = rawEdges.filter((edge) => visibleIds.has(edge.fromNodeId) && visibleIds.has(edge.toNodeId));
  return { nodes: [...kept, ...groups], edges };
}
```

This is intentionally conservative. It keeps important nodes, services, boundaries, stops, and groups. It collapses only low-priority ordinary wallets.

- [ ] **Step 5: Add wallet-cluster layout**

In `src/admin/adminConsole.ts`, near `stepOrbitLayout`, add:

```js
function arrangeWalletClusterLane(nodes, x, centerY, gap, role) {
  const sorted = [...nodes].sort(stableNodeSort);
  const startY = centerY - ((sorted.length - 1) * gap) / 2;
  return sorted.map((node, index) => {
    const bend = ((index % 4) - 1.5) * 22;
    const roleOffset = role === "boundary" ? -20 : role === "stop" ? 24 : role === "group" ? 46 : 0;
    return {
      ...node,
      x: x + bend,
      y: startY + index * gap + roleOffset
    };
  });
}

function walletClusterLayout(sourceNodes, sourceEdges) {
  const width = Math.max(2300, 1500 + Math.min(sourceNodes.length, 120) * 8);
  const height = Math.max(1300, 900 + Math.ceil(Math.min(sourceNodes.length, 120) / 16) * 72);
  if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
  const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
  const laneX = {
    source: width * 0.16,
    intermediate: width * 0.36,
    subject: width * 0.56,
    outgoing: width * 0.74,
    boundary: width * 0.88,
    stop: width * 0.91,
    group: width * 0.40
  };
  const laneY = {
    source: height * 0.48,
    intermediate: height * 0.48,
    subject: height * 0.48,
    outgoing: height * 0.48,
    boundary: height * 0.34,
    stop: height * 0.64,
    group: height * 0.72
  };
  const laneNodes = { source: [], intermediate: [], subject: [], outgoing: [], boundary: [], stop: [], group: [] };
  sourceNodes.forEach((node) => {
    const role = walletClusterNodeRole(node, subjectId, sourceEdges);
    laneNodes[role].push(node);
  });
  const nodes = [
    ...arrangeWalletClusterLane(laneNodes.source, laneX.source, laneY.source, 118, "source"),
    ...arrangeWalletClusterLane(laneNodes.intermediate, laneX.intermediate, laneY.intermediate, 110, "intermediate"),
    ...arrangeWalletClusterLane(laneNodes.group, laneX.group, laneY.group, 108, "group"),
    ...arrangeWalletClusterLane(laneNodes.subject, laneX.subject, laneY.subject, 100, "subject"),
    ...arrangeWalletClusterLane(laneNodes.outgoing, laneX.outgoing, laneY.outgoing, 110, "outgoing"),
    ...arrangeWalletClusterLane(laneNodes.boundary, laneX.boundary, laneY.boundary, 98, "boundary"),
    ...arrangeWalletClusterLane(laneNodes.stop, laneX.stop, laneY.stop, 92, "stop")
  ];
  const fixedNodeIds = new Set([subjectId]);
  const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 64);
  const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
  return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
}
```

- [ ] **Step 6: Wire presentation and layout**

Update `graphFirstLayout`:

```js
function graphFirstLayout(sourceNodes, sourceEdges, mode = graphDisplayMode(sourceNodes, sourceEdges), dense = graphIsDense(sourceNodes, sourceEdges)) {
  if (mode === "wallet_clusters") return walletClusterLayout(sourceNodes, sourceEdges);
  if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);
  if (mode === "deep_local_orbit") return deepLocalOrbitLayout(sourceNodes, sourceEdges);
  if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);
  if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind) || graphKindUsesDeepBranchMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);
  if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);
  if (dense && mode === "fan") return denseFanLayout(sourceNodes, sourceEdges);
  return legacyFanLayout(sourceNodes, sourceEdges);
}
```

Update `graphPresentation`:

```js
function graphPresentation(rawVisibleNodes, rawVisibleEdges) {
  const dense = graphIsDense(rawVisibleNodes, rawVisibleEdges);
  const mode = graphDisplayMode(rawVisibleNodes, rawVisibleEdges);
  let presentation = { nodes: rawVisibleNodes, edges: rawVisibleEdges };
  if (mode === "wallet_clusters") {
    presentation = buildWalletClusterPresentation(rawVisibleNodes, rawVisibleEdges);
  } else if (mode === "deep_branch_map") {
    presentation = buildDeepBranchPresentation(rawVisibleNodes, rawVisibleEdges);
  } else if (dense && mode === "step_orbit") {
    presentation = buildStepOrbitPresentation(rawVisibleNodes, rawVisibleEdges);
  } else if (dense && mode === "fan") {
    presentation = buildDenseFanPresentation(rawVisibleNodes, rawVisibleEdges);
  }
  return { ...applyExpandedBundlePresentation(presentation.nodes, presentation.edges), mode, dense };
}
```

- [ ] **Step 7: Run the presentation tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "wallet cluster presentation"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: add deep check wallet cluster layout"
```

---

### Task 4: Add Wallet-Cluster Legend And Right-Rail Wording

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write failing legend and panel tests**

Add this test near existing legend/right-rail tests:

```ts
it("explains wallet cluster evidence in legend and selected details", () => {
  const html = adminConsoleHtml();
  const legendBlock = html.slice(html.indexOf("function graphLegendHtml"), html.indexOf("function renderGraph"));
  const selectedNodeBlock = html.slice(html.indexOf("function selectedNodeDetails"), html.indexOf("function selectedEdgeDetails"));
  const selectedEdgeBlock = html.slice(html.indexOf("function selectedEdgeDetails"), html.indexOf("function subjectReportBlock"));

  expect(legendBlock).toContain('data-graph-legend="wallet_clusters"');
  expect(legendBlock).toContain("Wallet transfers");
  expect(legendBlock).toContain("Peer/context links");
  expect(legendBlock).toContain("Service boundaries");
  expect(legendBlock).toContain("History stops");
  expect(selectedNodeBlock).toContain("DeepCheck wallet-cluster role");
  expect(selectedNodeBlock).toContain("This wallet was observed in the DeepCheck graph.");
  expect(selectedEdgeBlock).toContain("Wallet-cluster relationship");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "wallet cluster evidence"
```

Expected: FAIL because legend and panel wording are missing.

- [ ] **Step 3: Add wallet-cluster label helpers**

In `src/admin/adminConsole.ts`, near `edgeEvidenceTypeLabel`, add:

```js
function walletClusterNodeRoleLabel(node) {
  const role = String(node?.metadata?.walletClusterRole || node?.metadata?.deepCheckWalletCluster?.nodeType || "");
  if (role === "subject" || role === "subject_wallet") return "Checked wallet";
  if (role === "source") return "Source wallet";
  if (role === "intermediate" || role === "ordinary_wallet") return "Intermediate wallet";
  if (role === "outgoing") return "Outgoing wallet";
  if (role === "boundary") return "Service/boundary";
  if (role === "stop" || role === "history_stop") return "Investigation stop";
  if (role === "group" || role === "funding_cluster") return "Wallet group";
  return "";
}

function walletClusterEdgeLabel(edge) {
  const edgeType = String(edge?.metadata?.deepCheckWalletCluster?.edgeType || "");
  if (edgeType === "proven_transaction") return "Proven transaction";
  if (edgeType === "grouped_real_transfers") return "Grouped real transfers";
  if (edgeType === "context_boundary") return "Service/boundary context";
  if (edgeType === "history_stop") return "History stop";
  if (edgeType === "profile_context") return "Profile context";
  return "";
}

function walletClusterRelationshipLabel(edge) {
  const relationship = String(edge?.metadata?.deepCheckWalletCluster?.relationship || "");
  if (relationship === "wallet_to_wallet") return "Wallet-to-wallet";
  if (relationship === "subject_neighborhood") return "Subject neighborhood";
  if (relationship === "shared_service_or_boundary") return "Shared service or boundary";
  if (relationship === "investigation_stop") return "Investigation stop";
  return "";
}
```

- [ ] **Step 4: Update graph legend for wallet clusters**

In `graphLegendHtml(mode)`, add a wallet-clusters branch before the existing Deep Branch Map branch:

```js
if (mode === "wallet_clusters") {
  return '<span class="chip graph-legend-chip" data-graph-legend="wallet_clusters">' +
    '<span class="legend-item"><span class="legend-line legend-transfer"></span> Wallet transfers</span>' +
    '<span class="legend-item"><span class="legend-line legend-context"></span> Peer/context links</span>' +
    '<span class="legend-item"><span class="legend-line legend-service"></span> Service boundaries</span>' +
    '<span class="legend-item"><span class="legend-line legend-stop"></span> History stops</span>' +
    '<span class="legend-item"><span class="legend-line legend-group"></span> Wallet groups</span>' +
    '</span>';
}
```

- [ ] **Step 5: Add selected-node wording**

In the selected node detail block, add the wallet-cluster role line after the node type/address lines:

```js
const clusterRole = walletClusterNodeRoleLabel(node);
const clusterNote = clusterRole
  ? metric("DeepCheck wallet-cluster role", clusterRole, "wide") +
    '<div class="card-note">This wallet was observed in the DeepCheck graph. A role here explains graph context; it is not a standalone completed wallet check unless the right rail says so.</div>'
  : "";
```

Then include `clusterNote` in the selected-node details HTML.

- [ ] **Step 6: Add selected-edge wording**

In the selected edge detail block, add:

```js
const walletClusterEdge = walletClusterEdgeLabel(edge);
const walletClusterRelationship = walletClusterRelationshipLabel(edge);
const walletClusterBlock = walletClusterEdge || walletClusterRelationship
  ? metric("Wallet-cluster evidence", walletClusterEdge || "Graph context") +
    metric("Wallet-cluster relationship", walletClusterRelationship || "Context relationship")
  : "";
```

Then include `walletClusterBlock` before the existing evidence type metrics.

- [ ] **Step 7: Run the legend and panel tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts -t "wallet cluster evidence"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: explain wallet cluster graph evidence"
```

---

### Task 5: Regression Test Existing Modes And Final QA

**Files:**
- Modify only if tests expose a regression.

- [ ] **Step 1: Run focused admin tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminConsole.regression-1.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Verify no unintended file changes**

Run:

```bash
git status --short
```

Expected: no uncommitted files, or only files from a just-fixed regression that are committed in the next step.

- [ ] **Step 4: Manual admin smoke check**

Start the admin server the same way this workspace currently runs it. Open an `address_deep_check` job and verify:

- button label shows `Wallet clusters` on default DeepCheck view;
- clicking the graph mode cycles to `Deep branch map`;
- clicking again cycles to `Show all raw`;
- services are visible by default;
- peer links remain toggleable;
- role marks remain toggleable;
- right rail explains selected wallet-cluster node roles;
- right rail explains selected wallet-cluster edge relationships;
- `incoming_deposit_check` still uses its previous flow/step layout;
- `where_is_money_check` still uses its previous flow/step layout.

- [ ] **Step 5: Commit any regression fixes**

If Step 1 or Step 2 forced changes, commit them:

```bash
git add src/admin/adminConsole.ts src/admin/forensicsGraph.ts tests/admin/adminConsole.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix: stabilize wallet cluster graph regressions"
```

If no changes were needed, do not create an empty commit.

---

## Spec Coverage Review

- Default dense DeepCheck view is `Wallet clusters`: Task 2.
- Ordinary wallets and boundaries are separated: Task 3.
- Existing 2-3 hop data is displayed when stored: Task 1 and Task 3.
- Peer links remain visible but secondary: Task 3 and existing peer-link toggle.
- Shared service exits and boundaries are context, not ownership proof: Task 1 and Task 4.
- Funding clusters and grouped wallets can be selected/explained: Task 3 and Task 4.
- `Show all raw` remains available: Task 2.
- Right rail distinguishes graph evidence types: Task 4.
- Incoming Deposit and Where Is Money are unchanged: Task 2 and Task 5.
- No scoring or fetching changes: all tasks are admin projection/UI only.

## Plan Self-Review

- No unresolved filler text remains.
- Every task has concrete files, test commands, and implementation snippets.
- The plan avoids new dependencies and avoids a React rewrite.
- The plan keeps the first implementation intentionally small: metadata, mode routing, layout, and explanation.
