# Admin Forensics Trace Stop Diagnostics UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Admin Forensics trace-stop nodes read as diagnostic stop markers instead of wallet/transfer nodes.

**Architecture:** Keep forensic engines and scoring unchanged. Add display-only stop semantics to `projectForensicJobGraph`, then make the admin console use a dedicated trace-stop detail layout, cleaner canvas labels, and a clearer Boundary stops table. The UI should explain incomplete history as provenance uncertainty, not wallet risk.

**Tech Stack:** TypeScript, Vitest, inline admin console HTML/JS in `src/admin/adminConsole.ts`, graph projection in `src/admin/forensicsGraph.ts`.

---

## Files

- Modify: `src/admin/forensicsGraph.ts`
  - Add display-only stop reason semantics.
  - Enrich stop node/edge metadata with stop category, title, meaning, score label, score meaning, and last real edge context.
  - Add human stop labels to limitations and path objects through existing loose JSON projection.
- Modify: `src/admin/adminConsole.ts`
  - Add frontend stop semantic helpers.
  - Render a dedicated trace-stop right-panel layout.
  - Hide transfer amount pills for stop edges.
  - Replace raw stop reason strings in Boundary stops with human labels.
- Modify: `tests/admin/forensicsGraph.test.ts`
  - Cover `incoming_history_not_fetched` stop metadata and previous real hop context.
  - Cover stop edge as diagnostic/non-transfer.
- Modify: `tests/admin/adminServer.test.ts`
  - Cover static trace-stop UI copy and helper presence.

---

### Task 1: Add Display-Only Stop Semantics to Graph Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add failing projection test for incoming-history stop semantics**

Add this test inside `describe("projectForensicJobGraph", ...)` in `tests/admin/forensicsGraph.test.ts`, near the existing stop diagnostics tests:

```typescript
  it("adds diagnostic display metadata for incoming history stops", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 45,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "135300000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 45,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "incoming_history_not_fetched",
            riskScoreContribution: 45,
            balanceShare: 0.9993,
            pathAddresses: [
              "TGKDVrSource111111111111111111111111",
              "TPxymRMiddle11111111111111111111111",
              "TSubject111111111111111111111111111111"
            ],
            txHashes: ["tx-source-middle", "tx-middle-subject"],
            steps: [
              {
                txHash: "tx-source-middle",
                fromAddress: "TGKDVrSource111111111111111111111111",
                toAddress: "TPxymRMiddle11111111111111111111111",
                amountRaw: "1610000000000",
                timestamp: "2026-04-21T14:58:36.000Z"
              },
              {
                txHash: "tx-middle-subject",
                fromAddress: "TPxymRMiddle11111111111111111111111",
                toAddress: "TSubject111111111111111111111111111111",
                amountRaw: "135210000000",
                timestamp: "2026-04-27T14:33:36.000Z"
              }
            ],
            historyCoverage: [
              {
                address: "TGKDVrSource111111111111111111111111",
                targetTimestamp: "2026-04-21T14:58:36.000Z",
                fetchedTransferCount: 0,
                fetchedPageCount: 2,
                oldestFetchedTransferAt: null,
                reachedTargetHop: false,
                source: "live"
              }
            ],
            rejectedCandidates: [
              {
                txHash: "candidate-after-target",
                fromAddress: "TAfterTarget111111111111111111111",
                toAddress: "TGKDVrSource111111111111111111111111",
                amountRaw: "826610000000",
                timestamp: "2026-04-22T00:00:00.000Z",
                reasons: ["after_target_timestamp"]
              }
            ],
            reasons: [
              "Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const stopNode = result.graph.nodes.find((item) => item.kind === "stop");
    expect(stopNode).toMatchObject({
      displayKind: "trace_stop",
      displayLabel: "History incomplete",
      metadata: {
        stopCategory: "data_quality",
        stopTitle: "History not fully fetched",
        stopMeaning: "Fetched incoming history did not reach the required hop time, so source provenance remains unproven.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven.",
        stopAmountLabel: "not a transfer",
        lastRealEdgeId: "edge:0:1",
        lastRealHopAmountRaw: "135210000000",
        lastRealHopTimestamp: "2026-04-27T14:33:36.000Z"
      }
    });
    expect(stopNode?.metadata.stopDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stopReason: "incoming_history_not_fetched",
        reachedTargetHop: false,
        pagesChecked: 2,
        rejectedCandidates: expect.arrayContaining([
          expect.objectContaining({ txHash: "candidate-after-target", reasons: ["after_target_timestamp"] })
        ])
      })
    ]));

    const stopEdge = result.graph.edges.find((item) => item.type === "stop");
    expect(stopEdge).toMatchObject({
      displayRole: "stop",
      amountRaw: null,
      txHash: null,
      timestamp: null,
      metadata: {
        stopTitle: "History not fully fetched",
        stopCategory: "data_quality",
        stopAmountLabel: "not a transfer",
        lastRealEdgeId: "edge:0:1"
      }
    });

    expect(result.graph.paths[0]).toMatchObject({
      stopReason: "incoming_history_not_fetched",
      stoppedAtNodeId: stopNode?.id,
      stopReasonLabel: "History not fully fetched",
      stopCategory: "data_quality",
      lastRealEdgeId: "edge:0:1"
    });
  });
```

- [ ] **Step 2: Run focused projection test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts -t "adds diagnostic display metadata"
```

Expected result: FAIL because `stopCategory`, `stopTitle`, `scoreLabel`, `lastRealEdgeId`, and path stop display fields do not exist yet.

- [ ] **Step 3: Add stop display helper types**

In `src/admin/forensicsGraph.ts`, after `export type AdminForensicsEdgeDisplayRole`, add:

```typescript
type AdminForensicsStopCategory =
  | "data_quality"
  | "continuity"
  | "terminal_boundary"
  | "service_boundary"
  | "unknown";

type StopDisplaySemantics = {
  category: AdminForensicsStopCategory;
  title: string;
  canvasLabel: string;
  meaning: string;
  scoreLabel: string;
  scoreMeaning: string;
};
```

- [ ] **Step 4: Add stop display semantic helper**

In `src/admin/forensicsGraph.ts`, before `stopDiagnostics`, add:

```typescript
function stopDisplaySemantics(reason: string | null): StopDisplaySemantics {
  switch (reason) {
    case "incoming_history_not_fetched":
      return {
        category: "data_quality",
        title: "History not fully fetched",
        canvasLabel: "History incomplete",
        meaning: "Fetched incoming history did not reach the required hop time, so source provenance remains unproven.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
    case "data_budget_exhausted":
      return {
        category: "data_quality",
        title: "Search budget exhausted",
        canvasLabel: "Budget stop",
        meaning: "The trace hit a configured search budget before reaching a terminal source.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
    case "no_previous_transfer":
      return {
        category: "continuity",
        title: "No prior inbound found",
        canvasLabel: "No prior input",
        meaning: "Fetched history reached the required time, but no earlier inbound USDT transfer was found for this hop.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "no_incoming_transfers_seen":
      return {
        category: "continuity",
        title: "No previous incoming",
        canvasLabel: "No incoming",
        meaning: "Fetched history reached the required time and no inbound USDT transfers were seen.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "incoming_seen_but_below_continuity":
      return {
        category: "continuity",
        title: "Prior inputs do not match",
        canvasLabel: "Inputs mismatch",
        meaning: "Prior inbound transfers exist, but none match amount/time continuity thresholds.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "weak_amount_or_time_continuity":
      return {
        category: "continuity",
        title: "Weak continuity",
        canvasLabel: "Weak continuity",
        meaning: "A possible connection exists, but amount or time continuity is too weak to prove provenance.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "unlabeled_service_boundary":
      return {
        category: "service_boundary",
        title: "Service boundary",
        canvasLabel: "Service boundary",
        meaning: "The trace reached a service or contract boundary where normal wallet-to-wallet provenance should stop.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached service boundary."
      };
    case "allowlist_cex_reached":
      return {
        category: "terminal_boundary",
        title: "Allowlisted CEX reached",
        canvasLabel: "Allowlisted CEX",
        meaning: "The trace reached a known allowlisted centralized exchange source.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    case "decline_boundary_reached":
      return {
        category: "terminal_boundary",
        title: "Decline boundary reached",
        canvasLabel: "Risk boundary",
        meaning: "The trace reached a policy boundary that can raise risk.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    case "risky_label_reached":
      return {
        category: "terminal_boundary",
        title: "Risky label reached",
        canvasLabel: "Risky label",
        meaning: "The trace reached a known risky label.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    default:
      return {
        category: "unknown",
        title: reason ? reason.replace(/_/g, " ") : "Trace stop",
        canvasLabel: "Trace stop",
        meaning: "The trace stopped before reaching a complete provenance source.",
        scoreLabel: "Path contribution",
        scoreMeaning: "This contribution belongs to the stopped path, not to a wallet by itself."
      };
  }
}
```

- [ ] **Step 5: Add helper for previous real edge context**

In `src/admin/forensicsGraph.ts`, before `projectWhereIsMoneyGraph`, add:

```typescript
function lastRealEdgeForPath(edgeIds: string[], edges: AdminForensicsEdge[]): AdminForensicsEdge | null {
  for (let index = edgeIds.length - 1; index >= 0; index -= 1) {
    const edge = edges.find((item) => item.id === edgeIds[index]);
    if (edge && edge.type !== "stop") return edge;
  }
  return null;
}

function stopDisplayMetadata(input: {
  reason: string;
  pathId: string;
  diagnostics: Record<string, unknown>;
  lastRealEdge: AdminForensicsEdge | null;
}): Record<string, unknown> {
  const semantics = stopDisplaySemantics(input.reason);
  return {
    reason: input.reason,
    pathId: input.pathId,
    stopDetails: [input.diagnostics],
    stopCategory: semantics.category,
    stopTitle: semantics.title,
    stopCanvasLabel: semantics.canvasLabel,
    stopMeaning: semantics.meaning,
    scoreLabel: semantics.scoreLabel,
    scoreMeaning: semantics.scoreMeaning,
    stopAmountLabel: "not a transfer",
    lastRealEdgeId: input.lastRealEdge?.id ?? null,
    lastRealHopAmountRaw: input.lastRealEdge?.amountRaw ?? null,
    lastRealHopTimestamp: input.lastRealEdge?.timestamp ?? null,
    lastRealHopTxHash: input.lastRealEdge?.txHash ?? null
  };
}
```

- [ ] **Step 6: Use display metadata in where-is-money stop nodes**

In `src/admin/forensicsGraph.ts`, inside the `projectWhereIsMoneyGraph` stop block, immediately after:

```typescript
const diagnostics = stopDiagnostics({ path: item, pathId, stopReason: stoppedReason, riskContribution });
```

add:

```typescript
const lastRealEdge = lastRealEdgeForPath(pathEdgeIds, edges);
const stopMetadata = stopDisplayMetadata({
  reason: stoppedReason,
  pathId,
  diagnostics,
  lastRealEdge
});
const stopSemantics = stopDisplaySemantics(stoppedReason);
```

Then replace the stop node metadata field:

```typescript
metadata: { reason: stoppedReason, pathId, stopDetails: [diagnostics] }
```

with:

```typescript
metadata: stopMetadata
```

Also replace the stop edge metadata field:

```typescript
metadata: { reason: stoppedReason, pathId, stopDetails: [diagnostics] }
```

with:

```typescript
metadata: stopMetadata
```

Also change the limitation label from:

```typescript
label: stoppedReason,
```

to:

```typescript
label: stopSemantics.title,
```

At the end of the pushed path object, add display fields to the object literal even though `AdminForensicsPath` must be extended in the next step:

```typescript
stopReasonLabel: stoppedReason ? stopDisplaySemantics(stoppedReason).title : null,
stopCategory: stoppedReason ? stopDisplaySemantics(stoppedReason).category : null,
lastRealEdgeId: stoppedReason ? lastRealEdgeForPath(pathEdgeIds, edges)?.id ?? null : null,
```

- [ ] **Step 7: Extend `AdminForensicsPath` with optional display fields**

In `src/admin/forensicsGraph.ts`, extend `AdminForensicsPath`:

```typescript
  stopReasonLabel?: string | null;
  stopCategory?: AdminForensicsStopCategory | null;
  lastRealEdgeId?: string | null;
```

- [ ] **Step 8: Run focused projection test**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts -t "adds diagnostic display metadata"
```

Expected result: PASS.

- [ ] **Step 9: Run full graph projection tests**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts
```

Expected result: PASS.

- [ ] **Step 10: Commit Task 1**

Run:

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: add trace stop display metadata"
```

---

### Task 2: Render Dedicated Trace Stop Details in the Right Panel

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add failing admin shell assertions**

In `tests/admin/adminServer.test.ts`, in the `serves admin console shell without exposing job data` test, add:

```typescript
    expect(html).toContain("function traceStopDetailBlock");
    expect(html).toContain("Path uncertainty penalty");
    expect(html).toContain("This is not wallet risk");
    expect(html).toContain("Stop amount");
    expect(html).toContain("Required history cutoff");
    expect(html).toContain("Oldest fetched transfer");
    expect(html).toContain("Reached required time");
```

- [ ] **Step 2: Run admin shell test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: FAIL because `traceStopDetailBlock` and the new copy do not exist yet.

- [ ] **Step 3: Add frontend stop semantic helpers**

In `src/admin/adminConsole.ts`, after `stopBadgeLabel`, add:

```javascript
    function stopCategoryLabel(category) {
      const labels = {
        data_quality: "Data quality",
        continuity: "Continuity",
        terminal_boundary: "Terminal boundary",
        service_boundary: "Service boundary",
        unknown: "Unknown"
      };
      return labels[category] || "Unknown";
    }
    function stopReasonTitle(reason) {
      return stopBadgeLabel(reason);
    }
    function stopNodeTitle(node) {
      return node?.metadata?.stopTitle || stopReasonTitle(node?.metadata?.reason || node?.label);
    }
    function stopNodeMeaning(node) {
      return node?.metadata?.stopMeaning || "The trace stopped before reaching a complete provenance source.";
    }
    function stopNodeCategory(node) {
      return node?.metadata?.stopCategory || "unknown";
    }
    function stopScoreLabel(node) {
      return node?.metadata?.scoreLabel || "Path contribution";
    }
    function stopScoreMeaning(node) {
      return node?.metadata?.scoreMeaning || "This contribution belongs to the stopped path, not to a wallet by itself.";
    }
```

- [ ] **Step 4: Add helper to find previous real edge for a stop node**

In `src/admin/adminConsole.ts`, near `pathForEdge`, add:

```javascript
    function pathForStopNode(node) {
      const pathId = node?.metadata?.pathId;
      if (!pathId) return null;
      return graphPaths(state.graph).find((path) => path.id === pathId) || null;
    }
    function lastRealEdgeForStop(node) {
      const edgeId = node?.metadata?.lastRealEdgeId;
      if (edgeId) {
        const edge = graphEdges(state.graph).find((item) => item.id === edgeId);
        if (edge) return edge;
      }
      const path = pathForStopNode(node);
      const edgeIds = asArray(path?.edgeIds);
      for (let index = edgeIds.length - 1; index >= 0; index -= 1) {
        const edge = graphEdges(state.graph).find((item) => item.id === edgeIds[index]);
        if (edge && edge.type !== "stop") return edge;
      }
      return null;
    }
```

- [ ] **Step 5: Add stop detail line helpers**

In `src/admin/adminConsole.ts`, before `stopDetailLines`, add:

```javascript
    function stopHistoryLines(node) {
      return asArray(node?.metadata?.stopDetails).flatMap((detail) => {
        const lines = [];
        if (detail?.targetTimestamp) lines.push("Required history cutoff: " + iso(detail.targetTimestamp));
        if (detail?.oldestFetchedTransferAt) lines.push("Oldest fetched transfer: " + iso(detail.oldestFetchedTransferAt));
        if (detail?.reachedTargetHop !== null && detail?.reachedTargetHop !== undefined) {
          lines.push("Reached required time: " + (detail.reachedTargetHop ? "yes" : "no"));
        }
        if (detail?.historyDaysChecked !== null && detail?.historyDaysChecked !== undefined) {
          lines.push("History span checked: " + trimNumber(detail.historyDaysChecked) + " day(s)");
        }
        if (detail?.pagesChecked !== null && detail?.pagesChecked !== undefined) {
          lines.push("Pages checked: " + detail.pagesChecked);
        }
        if (detail?.totalFetchedTransferCount !== null && detail?.totalFetchedTransferCount !== undefined) {
          lines.push("History tx checked: " + detail.totalFetchedTransferCount);
        }
        return lines;
      });
    }
    function rejectedCandidateLines(node) {
      const details = asArray(node?.metadata?.stopDetails);
      return details.flatMap((detail) => asArray(detail?.rejectedCandidates)).slice(0, 5).map((candidate) => {
        const reasons = asArray(candidate?.reasons).map((reason) => {
          if (reason === "after_target_timestamp") return "after required hop time";
          if (reason === "amount_continuity_below_threshold") return "amount continuity too weak";
          if (reason === "time_continuity_above_threshold") return "time gap too large";
          return String(reason || "unknown").replace(/_/g, " ");
        });
        return short(candidate?.txHash || "unknown", 5) + ": " + (reasons.join(", ") || "no reason stored");
      });
    }
```

- [ ] **Step 6: Add `traceStopDetailBlock`**

In `src/admin/adminConsole.ts`, before `walletDetailBlock`, add:

```javascript
    function traceStopDetailBlock(node, graph) {
      if (!node) return '<div class="empty">No trace stop found.</div>';
      const path = pathForStopNode(node);
      const lastEdge = lastRealEdgeForStop(node);
      const pathSpan = typeof path?.timeSpanMs === "number" ? formatDurationMs(path.timeSpanMs) : "";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip("Trace stop", "boundary")) +
        metric("Stop type", stopCategoryLabel(stopNodeCategory(node))) +
        metric("Reason", stopNodeTitle(node)) +
        metric("Meaning", stopNodeMeaning(node), "wide") +
        metric("Stop id", node.id || "n/a", "wide") +
        metric("Stop amount", node?.metadata?.stopAmountLabel || "not a transfer") +
        metric(stopScoreLabel(node), node.weight ?? "n/a") +
        metric("Score meaning", stopScoreMeaning(node), "wide") +
        metric("Path contribution band", node.riskLevel || "n/a") +
        metric("Path", node?.metadata?.pathId || path?.id || "n/a") +
        metric("Path span", pathSpan || "n/a") +
        metric("Last real hop amount", lastEdge ? edgeDetailedAmountLabel(lastEdge) || edgeCanvasAmountLabel(lastEdge) || "n/a" : "n/a") +
        metric("Last real hop time", lastEdge ? edgeTime(lastEdge) || "time n/a" : "n/a") +
        metric("Previous hop gap", lastEdge ? edgeTxGap(lastEdge) || "n/a" : "n/a") +
        listMetric("History coverage", stopHistoryLines(node), "No history coverage details stored.") +
        listMetric("Rejected candidates", rejectedCandidateLines(node), "No rejected candidates stored.") +
        listMetric("Trace stop", stopDetailLines(node.metadata?.stopDetails), "Trace stop details are not stored.") +
        rawBlock("Trace stop JSON", node) +
        '</div>';
    }
```

- [ ] **Step 7: Route stop nodes to the dedicated layout**

In `walletDetailBlock`, replace:

```javascript
      if (node.kind === "bundle") return bundleDetailBlock(node, graph);
```

with:

```javascript
      if (node.kind === "stop" || nodeDisplayKind(node) === "trace_stop") return traceStopDetailBlock(node, graph);
      if (node.kind === "bundle") return bundleDetailBlock(node, graph);
```

- [ ] **Step 8: Run focused admin shell test**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected result: PASS.

- [ ] **Step 10: Commit Task 2**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: render trace stop diagnostics panel"
```

---

### Task 3: Clean Stop Canvas Labels and Boundary Stops Table

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add failing shell assertions for stop canvas/table helpers**

In `tests/admin/adminServer.test.ts`, in the admin shell test, add:

```typescript
    expect(html).toContain("function edgeShouldShowAmount");
    expect(html).toContain("function boundaryStopContribution");
    expect(html).toContain("Uncertainty +");
    expect(html).toContain("History checked");
    expect(html).toContain("Last real hop");
```

- [ ] **Step 2: Run admin shell test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: FAIL because the helper/table copy does not exist yet.

- [ ] **Step 3: Stop raw ids from appearing as canvas labels**

In `canvasNodeLabel`, replace:

```javascript
      if (kind === "trace_stop") return stopBadgeLabel(node.metadata?.reason || node.label);
```

with:

```javascript
      if (kind === "trace_stop") return node?.metadata?.stopCanvasLabel || stopBadgeLabel(node.metadata?.reason || node.label);
```

- [ ] **Step 4: Hide amount pills on stop edges**

In `src/admin/adminConsole.ts`, near `edgeCanvasAmountLabel`, add:

```javascript
    function edgeShouldShowAmount(edge) {
      return edge?.type !== "stop" && edgeDisplayRole(edge) !== "stop";
    }
```

In `renderGraph`, replace:

```javascript
        const amountLabel = edgeCanvasAmountLabel(edge);
        const shouldShowAmount = state.amountMode === "all" || (state.amountMode === "important" && amountLabel);
```

with:

```javascript
        const amountLabel = edgeShouldShowAmount(edge) ? edgeCanvasAmountLabel(edge) : "";
        const shouldShowAmount = edgeShouldShowAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel));
```

- [ ] **Step 5: Add Boundary stops table helpers**

In `src/admin/adminConsole.ts`, before `renderBoundaryStops`, add:

```javascript
    function stopNodeForPath(path) {
      return graphNodes(state.graph).find((node) => node.id === path?.stoppedAtNodeId) || null;
    }
    function boundaryStopTitle(path) {
      const node = stopNodeForPath(path);
      return node?.metadata?.stopTitle || path?.stopReasonLabel || stopBadgeLabel(path?.stopReason);
    }
    function boundaryStopType(path) {
      const node = stopNodeForPath(path);
      return stopCategoryLabel(node?.metadata?.stopCategory || path?.stopCategory || "unknown");
    }
    function boundaryStopContribution(path) {
      const node = stopNodeForPath(path);
      const category = node?.metadata?.stopCategory || path?.stopCategory;
      const value = path?.riskContribution ?? "n/a";
      if (category === "data_quality") return "Uncertainty +" + value;
      if (category === "continuity") return "Continuity +" + value;
      return "Boundary +" + value;
    }
    function boundaryStopReachedTime(path) {
      const node = stopNodeForPath(path);
      const detail = asArray(node?.metadata?.stopDetails)[0];
      if (!detail || detail.reachedTargetHop === null || detail.reachedTargetHop === undefined) return "n/a";
      return detail.reachedTargetHop ? "yes" : "no";
    }
    function boundaryStopHistoryChecked(path) {
      const node = stopNodeForPath(path);
      const detail = asArray(node?.metadata?.stopDetails)[0];
      if (!detail) return "n/a";
      const txCount = detail.totalFetchedTransferCount ?? "n/a";
      const pages = detail.pagesChecked ?? "n/a";
      return txCount + " tx / " + pages + " page(s)";
    }
    function boundaryStopLastHop(path) {
      const node = stopNodeForPath(path);
      const edge = node ? lastRealEdgeForStop(node) : null;
      if (!edge) return "n/a";
      return (edgeTime(edge) || "time n/a") + " / " + (edgeCanvasAmountLabel(edge) || "amount n/a");
    }
```

- [ ] **Step 6: Replace Boundary stops table columns**

In `renderBoundaryStops`, replace the `root.innerHTML = ...` expression with:

```javascript
      root.innerHTML = '<div class="transfer-head boundary"><span>path</span><span>stop</span><span>type</span><span>contribution</span><span>reached required time</span><span>history checked</span><span>last real hop</span></div>' +
        paths.map((path) => '<div role="button" tabindex="0" class="transfer-row boundary" data-stop-node-id="' + escapeHtml(path.stoppedAtNodeId || "") + '">' +
          '<span>' + escapeHtml(path.id || "n/a") + '</span>' +
          '<span>' + escapeHtml(boundaryStopTitle(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopType(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopContribution(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopReachedTime(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopHistoryChecked(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopLastHop(path)) + '</span>' +
          '</div>').join("");
```

- [ ] **Step 7: Run focused admin shell test**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: PASS.

- [ ] **Step 8: Run admin tests**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts
```

Expected result: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: clarify trace stop canvas and table"
```

---

### Task 4: Verification and Runtime Smoke

**Files:**
- No source files changed in this task unless a test failure requires a fix.

- [ ] **Step 1: Run admin-focused tests**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
```

Expected result: PASS.

- [ ] **Step 2: Run bot menu regression tests**

Run:

```powershell
npx vitest run tests/bot/createBot.test.ts -t "uses Russian by default and can switch to English"
npx vitest run tests/bot/createBot.test.ts -t "handles /start with compact product menu"
```

Expected result: PASS. This is not part of trace-stop UI, but it guards the runtime/source-of-truth issue that previously made the Telegram button show stale copy.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected result: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```powershell
npm test
```

Expected result: PASS.

- [ ] **Step 5: Restart only the admin server from root checkout if needed**

If port `8787` is still used by an admin server, stop only that port owner:

```powershell
$conn = Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue
if ($conn) {
  $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -ErrorAction SilentlyContinue
  }
}
```

Start the root admin server using the existing ignored runtime script if present:

```powershell
Start-Process -FilePath 'node' `
  -ArgumentList @('--import','tsx','.runtime/admin-server-root.mjs') `
  -WorkingDirectory 'C:\Users\User\OneDrive\Desktop\smartcontract' `
  -WindowStyle Hidden
```

- [ ] **Step 6: Smoke check admin shell copy**

Run:

```powershell
$response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/admin/forensics' -UseBasicParsing -TimeoutSec 10
$response.StatusCode
$response.Content.Contains('Admin Forensics Console')
$response.Content.Contains('Path uncertainty penalty')
$response.Content.Contains('This is not wallet risk')
$response.Content.Contains('History not fully fetched')
$response.Content.Contains('Stop amount')
```

Expected result:

```text
200
True
True
True
True
True
```

- [ ] **Step 7: Runtime manual check**

In the browser at `http://127.0.0.1:8787/admin/forensics`:

1. Open a `where_is_money_check` job with a stop reason such as `incoming_history_not_fetched`.
2. Select the stop marker on the canvas.
3. Confirm the right panel starts with `Selected: Trace stop`.
4. Confirm it shows `Path uncertainty penalty`, not wallet `Risk score`.
5. Confirm it does not show `Visible incoming: n/a` or `Visible outgoing: n/a`.
6. Open `Boundary stops` and confirm the row says `History not fully fetched`, `Data quality`, and `Uncertainty +45`.

- [ ] **Step 8: Commit only if verification required a fix**

If no files changed during verification, do not create an empty commit.

If a fix was required:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
git commit -m "fix: stabilize trace stop diagnostics UI"
```

---

## Self-Review

- Spec coverage:
  - Trace stops remain visible but diagnostic: Task 3.
  - Right panel no longer treats stop as wallet: Task 2.
  - Data-quality score is labeled as uncertainty, not wallet risk: Task 2.
  - Amount display says `not a transfer` and uses last real hop context: Task 1 and Task 2.
  - Timing/history coverage fields are exposed: Task 1 and Task 2.
  - Boundary stops table uses human labels: Task 3.
- Scope:
  - No scoring rules, path selection, or forensic engine behavior changes.
  - Changes are limited to graph projection display metadata, admin console UI, and tests.
- Type consistency:
  - Backend metadata names match frontend helper names: `stopCategory`, `stopTitle`, `stopCanvasLabel`, `stopMeaning`, `scoreLabel`, `scoreMeaning`, `stopAmountLabel`, `lastRealEdgeId`.
  - Path optional fields match table helpers: `stopReasonLabel`, `stopCategory`, `lastRealEdgeId`.
