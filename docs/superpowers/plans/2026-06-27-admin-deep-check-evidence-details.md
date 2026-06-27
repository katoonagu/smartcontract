# Admin Deep Check Evidence Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepCheck graph selections explain the real evidence behind direct transfers, grouped boundary context, profile context, trace stops, and subject wallet role markers.

**Architecture:** Keep the backend fetch/scoring unchanged. Enrich the existing admin graph projection with evidence metadata, then make the vanilla admin console read that metadata for canvas labels and the right rail. Prefer metadata and helper functions over new abstractions or dependencies.

**Tech Stack:** TypeScript, Vitest, existing vanilla HTML/SVG admin console, existing `projectForensicJobGraph` projection.

---

## File Structure

- Modify: `src/admin/forensicsGraph.ts`
  - Adds evidence detail metadata to projected DeepCheck edges and nodes.
  - Adds DeepCheck coverage summary to existing graph summary/layer summary data.
  - Does not change forensic scoring or provider fetch limits.

- Modify: `src/admin/adminConsole.ts`
  - Adds UI helpers that read `metadata.evidenceType`, aggregate amounts, transfer counts, stop diagnostics, and role context.
  - Updates canvas labels and selected right-rail cards.
  - Keeps existing graph layout and controls.

- Modify: `tests/admin/forensicsGraph.test.ts`
  - Adds projection tests for boundary evidence details and DeepCheck coverage summary.

- Modify: `tests/admin/adminConsole.test.ts`
  - Adds HTML/helper tests for evidence labels, right-rail fields, trace stop explanation, and subject role wording.

No new dependency. No React rewrite. No provider or scoring code changes.

---

### Task 1: Add Boundary Evidence Metadata In Graph Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write the failing boundary evidence metadata test**

Add this test near the existing test named `projects address-deep boundary exposure flows as multi-hop service paths` in `tests/admin/forensicsGraph.test.ts`:

```ts
  it("projects deep-check boundary flows with selectable evidence details", () => {
    const subject = "TSubject111111111111111111111111111111";
    const via = "TViaEvidence111111111111111111111111";
    const cex = "TCexEvidence11111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 15,
            directBoundaryTxCount: 0,
            twoHopBoundaryTxCount: 1,
            incomingBoundaryVolumeRaw: "100400000000",
            outgoingBoundaryVolumeRaw: "0",
            topBoundaryEntities: [
              {
                address: cex,
                category: "cex",
                identity: "Binance-Hot 6",
                direction: "inbound",
                txCount: 1,
                volumeRaw: "100400000000",
                maxDepth: 2
              }
            ],
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: via,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Binance-Hot 6",
                amountRaw: "100400000000",
                boundaryAmountRaw: "16039056111",
                amountPreservationRatio: 0.1597,
                subjectTxHash: "subject-hop-tx",
                boundaryTxHash: "boundary-hop-tx",
                firstTransferAt: "2026-06-02T10:11:42.000Z",
                lastTransferAt: "2026-06-11T10:19:03.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 222 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryNode = result.graph.nodes.find((node) => node.address === cex);
    expect(boundaryNode?.metadata.boundaryEvidenceSummary).toMatchObject({
      evidenceType: "boundary_context",
      category: "cex",
      identity: "Binance-Hot 6",
      transferCount: 1,
      totalAmountRaw: "100400000000",
      direction: "inbound"
    });

    const boundaryEdge = result.graph.edges.find((edge) => edge.txHash === "boundary-hop-tx");
    expect(boundaryEdge?.metadata).toMatchObject({
      evidenceType: "boundary_context",
      evidenceTypeLabel: "Boundary context",
      aggregateAmountRaw: "16039056111",
      aggregateTransferCount: 1,
      boundaryAddress: cex,
      category: "cex",
      identity: "Binance-Hot 6"
    });
    expect(boundaryEdge?.metadata.underlyingTransfers).toEqual([
      expect.objectContaining({
        txHash: "boundary-hop-tx",
        amountRaw: "16039056111",
        timestamp: "2026-06-02T10:11:42.000Z",
        role: "boundary_hop"
      })
    ]);
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts -t "projects deep-check boundary flows with selectable evidence details"
```

Expected: FAIL because `boundaryEvidenceSummary`, `evidenceType`, `aggregateAmountRaw`, and `underlyingTransfers` are not projected yet.

- [ ] **Step 3: Add minimal projection helpers**

In `src/admin/forensicsGraph.ts`, near the existing utility helpers before `projectAddressDeepCheckGraph`, add:

```ts
function addRawDecimalStrings(left: string | null, right: string | null): string | null {
  if (!left && !right) return left ?? right;
  try {
    return String(BigInt(left ?? "0") + BigInt(right ?? "0"));
  } catch {
    return left ?? right;
  }
}

function boundaryUnderlyingTransfer(input: {
  txHash: string | null;
  amountRaw: string | null;
  timestamp: string | null;
  role: string;
}): Record<string, unknown> | null {
  if (!input.txHash && !input.amountRaw && !input.timestamp) return null;
  return {
    txHash: input.txHash,
    amountRaw: input.amountRaw,
    timestamp: input.timestamp,
    role: input.role
  };
}

function mergeBoundaryEvidenceSummary(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> {
  const currentCount = numberField(current ?? {}, "transferCount") ?? 0;
  const nextCount = numberField(next, "transferCount") ?? 0;
  const currentAmount = stringField(current ?? {}, "totalAmountRaw");
  const nextAmount = stringField(next, "totalAmountRaw");
  const currentTransfers = recordArrayField(current ?? {}, "underlyingTransfers");
  const nextTransfers = recordArrayField(next, "underlyingTransfers");
  return {
    ...current,
    ...next,
    transferCount: currentCount + nextCount,
    totalAmountRaw: addRawDecimalStrings(currentAmount, nextAmount),
    underlyingTransfers: [...currentTransfers, ...nextTransfers].slice(0, 25)
  };
}
```

This helper is intentionally small. It sums decimal string amounts without adding a big number dependency.

- [ ] **Step 4: Attach evidence metadata while projecting boundary flows**

In the `boundaryProfiles.forEach` block in `src/admin/forensicsGraph.ts`, after `hopDetails` is created and before edges are pushed, add:

```ts
      const flowUnderlyingTransfers = hopDetails
        .map((hop) => boundaryUnderlyingTransfer({
          txHash: hop.txHash,
          amountRaw: hop.amountRaw,
          timestamp: hop.timestamp,
          role: hop.role
        }))
        .filter((item): item is Record<string, unknown> => item !== null);
      const boundarySummary = {
        evidenceType: "boundary_context",
        category,
        identity,
        direction,
        depth: numberField(flow, "depth"),
        transferCount: 1,
        totalAmountRaw: amountRaw,
        boundaryAmountRaw,
        amountPreservationRatio: amountShare,
        underlyingTransfers: flowUnderlyingTransfers
      };
      if (boundaryNode) {
        boundaryNode.metadata = {
          ...boundaryNode.metadata,
          boundaryEvidenceSummary: mergeBoundaryEvidenceSummary(
            boundaryNode.metadata.boundaryEvidenceSummary as Record<string, unknown> | undefined,
            boundarySummary
          )
        };
      }
```

Then extend the edge `metadata` object inside the same block with:

```ts
            evidenceType: "boundary_context",
            evidenceTypeLabel: "Boundary context",
            evidenceMeaning: "DeepCheck reached service, exchange, bridge, DEX, or contract infrastructure while expanding wallet context.",
            aggregateAmountRaw: hop.amountRaw,
            aggregateTransferCount: 1,
            underlyingTransfers: hop.txHash || hop.amountRaw || hop.timestamp
              ? [{
                txHash: hop.txHash,
                amountRaw: hop.amountRaw,
                timestamp: hop.timestamp,
                role: hop.role
              }]
              : flowUnderlyingTransfers,
```

Keep the existing fields (`source`, `pathId`, `direction`, `category`, `identity`, `boundaryAddress`, `boundaryTxHash`) unchanged.

- [ ] **Step 5: Run the targeted test and confirm it passes**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts -t "projects deep-check boundary flows with selectable evidence details"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: add deep check boundary evidence metadata"
```

---

### Task 2: Add DeepCheck Coverage Summary To Graph Data

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write the failing DeepCheck coverage summary test**

Add this test near the DeepCheck projection tests in `tests/admin/forensicsGraph.test.ts`:

```ts
  it("projects deep-check coverage summary for right-rail explanation", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [{ counterparty: "A" }, { counterparty: "B" }],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [
          "Expansion stopped at service boundary TBoundary11111111111111111111111111 (cex)",
          "Metadata enrichment limited to 30 of 917 candidate exposure addresses."
        ],
        coverage: {
          transferEdges: 2646,
          sourceTransferPages: 4,
          inboundSendersExpanded: 15,
          extendedFetchedAddresses: 24,
          extendedIndexedEdges: 24
        },
        coverageDebug: {
          summary: {
            directCounterpartyCount: 100,
            analyzedCounterpartyCount: 100,
            expandedCounterpartyCount: 18,
            skippedCounterpartyCount: 71,
            metadataEnrichedCounterpartyCount: 3
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCheckCoverage: {
        directCounterpartiesAnalyzed: 100,
        directCounterpartiesExpanded: 18,
        transferEdgesCollected: 2646,
        extendedAddressesFetched: 24,
        boundaryStopCount: 1,
        metadataEnrichmentLimited: true
      }
    });
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts -t "projects deep-check coverage summary for right-rail explanation"
```

Expected: FAIL because `summary.layerSummary.deepCheckCoverage` is not projected.

- [ ] **Step 3: Add a small coverage summary helper**

In `src/admin/forensicsGraph.ts`, add:

```ts
function deepCheckCoverageSummary(result: Record<string, unknown>): Record<string, unknown> {
  const coverage = recordField(result, "coverage");
  const debug = recordField(result, "coverageDebug");
  const debugSummary = recordField(debug, "summary");
  const missingChecks = stringArrayField(result, "missingChecks");
  return {
    directCounterpartiesAnalyzed: firstNumber(
      numberField(debugSummary, "analyzedCounterpartyCount"),
      recordArrayField(result, "directCounterpartyInteractionProfiles").length
    ),
    directCounterpartiesExpanded: firstNumber(
      numberField(debugSummary, "expandedCounterpartyCount"),
      numberField(coverage, "inboundSendersExpanded")
    ),
    transferEdgesCollected: numberField(coverage, "transferEdges"),
    sourceTransferPages: numberField(coverage, "sourceTransferPages"),
    extendedAddressesFetched: numberField(coverage, "extendedFetchedAddresses"),
    extendedIndexedEdges: numberField(coverage, "extendedIndexedEdges"),
    boundaryStopCount: missingChecks.filter((item) => item.includes("Expansion stopped at service boundary")).length,
    metadataEnrichmentLimited: missingChecks.some((item) => item.includes("Metadata enrichment limited"))
  };
}
```

- [ ] **Step 4: Add summary to DeepCheck layer summary**

In the DeepCheck graph summary construction in `src/admin/forensicsGraph.ts`, add:

```ts
deepCheckCoverage: deepCheckCoverageSummary(result)
```

inside the existing `layerSummary` object for `address_deep_check`. Keep existing `projectedProfiles` and risk fields unchanged.

- [ ] **Step 5: Run targeted projection tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts -t "deep-check"
```

Expected: PASS for DeepCheck-related tests.

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: expose deep check coverage summary"
```

---

### Task 3: Improve Canvas Labels For Boundary Context Amounts

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write the failing admin console helper test**

Add this test near the existing amount label tests in `tests/admin/adminConsole.test.ts`:

```ts
  it("labels boundary context with aggregate tx count and amount when available", () => {
    const html = adminConsoleHtml();
    expect(html).toContain("function edgeEvidenceType");
    expect(html).toContain("function edgeAggregateAmountLabel");
    expect(html).toContain("function edgeContextCanvasLabel");
    expect(html).toContain('return count + " tx / " + amount;');
    expect(html).toContain('return "Amount not available for this projected context edge.";');
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "labels boundary context with aggregate tx count and amount when available"
```

Expected: FAIL because helper names and strings do not exist.

- [ ] **Step 3: Add evidence label helpers**

In `src/admin/adminConsole.ts`, near the existing `edgeAmount`, `edgeCanvasAmountLabel`, and `edgeCanvasAmountOrMissingLabel` helpers, add:

```js
    function edgeEvidenceType(edge) {
      if (edge?.metadata?.evidenceType) return String(edge.metadata.evidenceType);
      if (edge?.type === "stop" || edgeDisplayRole(edge) === "stop") return "trace_stop";
      if (edgeDisplayRole(edge) === "profile_context") return "profile_context";
      if (edge?.type === "service_boundary") return "boundary_context";
      if (edge?.type === "transfer") return edge?.metadata?.txCount > 1 ? "grouped_transfers" : "direct_transfer";
      return "unknown";
    }
    function edgeAggregateAmountLabel(edge) {
      return formatRawUsdt(edge?.metadata?.aggregateAmountRaw) ||
        formatRawUsdt(edge?.metadata?.totalAmountRaw) ||
        formatRawUsdt(edge?.metadata?.boundaryAmountRaw) ||
        "";
    }
    function edgeAggregateTransferCount(edge) {
      const count = Number(edge?.metadata?.aggregateTransferCount ?? edge?.metadata?.transferCount ?? edge?.metadata?.txCount);
      return Number.isFinite(count) && count > 0 ? count : null;
    }
    function edgeContextCanvasLabel(edge) {
      const type = edgeEvidenceType(edge);
      if (type !== "boundary_context" && type !== "grouped_transfers") return "";
      const amount = edgeAggregateAmountLabel(edge) || edgeCanvasLabel(edge);
      const countValue = edgeAggregateTransferCount(edge);
      const count = countValue ? countValue + " tx" : "";
      if (count && amount) return count + " / " + amount;
      if (amount) return amount;
      if (count) return count;
      return "";
    }
```

Then change `edgeCanvasAmountOrMissingLabel` from:

```js
      const amount = edgeCanvasLabel(edge);
      return amount || "amount n/a";
```

to:

```js
      const context = edgeContextCanvasLabel(edge);
      if (context) return context;
      const amount = edgeCanvasLabel(edge);
      if (amount) return amount;
      if (edgeEvidenceType(edge) === "boundary_context" || edgeEvidenceType(edge) === "profile_context") {
        return "Amount not available for this projected context edge.";
      }
      return "amount n/a";
```

- [ ] **Step 4: Run the targeted admin console test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "labels boundary context with aggregate tx count and amount when available"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: label boundary context evidence"
```

---

### Task 4: Upgrade Selected Edge Right Rail

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write the failing right-rail test**

Add this test near the existing selected edge card tests:

```ts
  it("shows selected edge evidence type and projected context amount explanation", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));

    expect(selectedEdgeCardBlock).toContain('cardLine("Evidence type", edgeEvidenceTypeLabel(edge))');
    expect(transferDetailBlock).toContain('metric("Evidence type", edgeEvidenceTypeLabel(edge))');
    expect(transferDetailBlock).toContain('metric("Aggregate amount", edgeAggregateAmountLabel(edge) || "n/a")');
    expect(transferDetailBlock).toContain('metric("Transfer count", edgeAggregateTransferCount(edge) ?? "n/a")');
    expect(transferDetailBlock).toContain('listMetric("Underlying transactions", edgeUnderlyingTransferLines(edge), "No underlying transactions stored.")');
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "shows selected edge evidence type and projected context amount explanation"
```

Expected: FAIL.

- [ ] **Step 3: Add right-rail helper functions**

In `src/admin/adminConsole.ts`, near `edgeMeaning` and selected-card helpers, add:

```js
    function edgeEvidenceTypeLabel(edge) {
      const type = edgeEvidenceType(edge);
      if (type === "direct_transfer") return "Direct transfer";
      if (type === "grouped_transfers") return "Grouped transfers";
      if (type === "boundary_context") return "Boundary context";
      if (type === "profile_context") return "Profile context";
      if (type === "trace_stop") return "Trace stop";
      return "Unknown evidence";
    }
    function edgeEvidenceMeaning(edge) {
      const type = edgeEvidenceType(edge);
      if (type === "direct_transfer") return "A real on-chain transfer exists between these endpoints.";
      if (type === "grouped_transfers") return "Multiple real transfers are grouped into this visible connection.";
      if (type === "boundary_context") return "DeepCheck reached service, exchange, bridge, DEX, or contract infrastructure while expanding wallet context.";
      if (type === "profile_context") return "This relationship comes from a summarized behavior or exposure profile, not one direct transfer.";
      if (type === "trace_stop") return "The investigation stopped here because the next step could not be proven with available data.";
      return "Evidence details are not classified for this edge.";
    }
    function edgeUnderlyingTransferLines(edge) {
      return asArray(edge?.metadata?.underlyingTransfers).slice(0, 20).map((item) => {
        const amount = formatRawUsdt(item?.amountRaw) || item?.amountRaw || "amount n/a";
        const time = canvasTimestampLabel(item?.timestamp) || item?.timestamp || "time n/a";
        const tx = item?.txHash ? " / tx " + short(item.txHash, 10) : "";
        const role = item?.role ? " / " + item.role : "";
        return amount + " / " + time + tx + role;
      });
    }
```

- [ ] **Step 4: Update selected edge card and transfer detail block**

In `selectedEdgeCard(edge)`, add these lines after the heading:

```js
        cardLine("Evidence type", edgeEvidenceTypeLabel(edge)) +
```

Replace the existing profile-only note with:

```js
      const note = edgeEvidenceType(edge) === "boundary_context" || edgeEvidenceType(edge) === "profile_context"
        ? '<div class="card-note">' + escapeHtml(edgeEvidenceMeaning(edge)) + ' This is context, not clean money-origin proof by itself.</div>'
        : "";
```

In `transferDetailBlock(edge)`, add these fields after `Selected`:

```js
        metric("Evidence type", edgeEvidenceTypeLabel(edge)) +
        metric("Evidence meaning", edgeEvidenceMeaning(edge), "wide") +
        metric("Aggregate amount", edgeAggregateAmountLabel(edge) || "n/a") +
        metric("Transfer count", edgeAggregateTransferCount(edge) ?? "n/a") +
        listMetric("Underlying transactions", edgeUnderlyingTransferLines(edge), "No underlying transactions stored.") +
```

Do not remove the existing raw JSON block.

- [ ] **Step 5: Run targeted admin console tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "selected edge"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: explain selected edge evidence"
```

---

### Task 5: Explain Trace Stops And Incoming History Limits

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write the failing trace stop explanation test**

Add this test near the existing trace stop/admin detail tests:

```ts
  it("explains incoming history not fetched as a coverage limit", () => {
    const html = adminConsoleHtml();
    const traceStopBlock = html.slice(html.indexOf("function traceStopDetailBlock"), html.indexOf("function walletDetailBlock"));

    expect(html).toContain("function traceStopCoverageExplanation");
    expect(traceStopBlock).toContain('metric("Coverage explanation", traceStopCoverageExplanation(node), "wide")');
    expect(html).toContain("We found a transfer into the checked wallet");
    expect(html).toContain("This is a coverage limit, not proof of bad origin.");
    expect(html).toContain("the address is very active");
    expect(html).toContain("the page or request budget was reached");
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "explains incoming history not fetched as a coverage limit"
```

Expected: FAIL.

- [ ] **Step 3: Add trace stop explanation helpers**

In `src/admin/adminConsole.ts`, near `traceStopDetailBlock`, add:

```js
    function traceStopReasonCode(node) {
      return node?.metadata?.stopReason || node?.metadata?.reason || node?.metadata?.stoppedReason || "";
    }
    function traceStopCoverageExplanation(node) {
      const reason = traceStopReasonCode(node);
      if (reason === "incoming_history_not_fetched") {
        return "We found a transfer into the checked wallet, then tried to inspect the sender's earlier funding. The fetched incoming history did not give enough evidence to prove where that sender got the money. This is a coverage limit, not proof of bad origin.";
      }
      if (reason === "service_boundary" || reason === "unlabeled_service_boundary") {
        return "The trace reached service, exchange, bridge, DEX, or contract infrastructure. Public-chain wallet-to-wallet continuity stops here unless there is stronger source evidence.";
      }
      if (reason === "data_budget_exhausted") {
        return "The trace stopped because the configured fetch budget was reached before a stronger source conclusion was found.";
      }
      if (reason === "no_previous_transfer" || reason === "no_incoming_transfers_seen") {
        return "The trace did not find a reliable earlier incoming funding transfer before this hop.";
      }
      return "The investigation stopped here because the next step could not be proven with available graph data.";
    }
    function traceStopPossibleCauseLines(node) {
      const reason = traceStopReasonCode(node);
      if (reason !== "incoming_history_not_fetched") return [];
      return [
        "the address is very active",
        "the provider or index did not return the needed part of history",
        "the page or request budget was reached",
        "no reliable earlier funding transfer was found before the hop being checked"
      ];
    }
```

- [ ] **Step 4: Add fields to `traceStopDetailBlock`**

In `traceStopDetailBlock(node, graph)`, after `metric("Meaning", stopNodeMeaning(node), "wide")`, add:

```js
        metric("Coverage explanation", traceStopCoverageExplanation(node), "wide") +
        listMetric("Possible causes", traceStopPossibleCauseLines(node), "No specific cause list stored.") +
```

- [ ] **Step 5: Run targeted trace stop tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "trace stop"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: explain trace stop coverage limits"
```

---

### Task 6: Show Subject Wallet Role And DeepCheck Coverage Without Overstating Risk

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write the failing subject detail test**

Add this test near the subject/right-rail tests:

```ts
  it("keeps subject wallet identity separate from behavior role and shows deep-check coverage", () => {
    const html = adminConsoleHtml();
    const subjectBlock = html.slice(html.indexOf("function subjectReportBlock"), html.indexOf("function nodeIntelligenceEvidenceLabel"));
    const intelligenceBlock = html.slice(html.indexOf("function nodeIntelligenceBlock"), html.indexOf("function traceStopDetailBlock"));

    expect(subjectBlock).toContain("DeepCheck coverage");
    expect(subjectBlock).toContain("direct counterparties analyzed");
    expect(subjectBlock).toContain("counterparties expanded");
    expect(subjectBlock).toContain("transfer edges collected");
    expect(subjectBlock).toContain("extended addresses fetched");
    expect(intelligenceBlock).toContain("behavior marker, not final risk proof by itself");
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "keeps subject wallet identity separate from behavior role"
```

Expected: FAIL if the new coverage text is not present.

- [ ] **Step 3: Add DeepCheck coverage lines helper**

In `src/admin/adminConsole.ts`, near `subjectReportBlock`, add:

```js
    function deepCheckCoverageLines(summary) {
      const coverage = summary?.layerSummary?.deepCheckCoverage;
      if (!coverage || typeof coverage !== "object") return [];
      const lines = [];
      if (coverage.directCounterpartiesAnalyzed !== null && coverage.directCounterpartiesAnalyzed !== undefined) {
        lines.push(coverage.directCounterpartiesAnalyzed + " direct counterparties analyzed");
      }
      if (coverage.directCounterpartiesExpanded !== null && coverage.directCounterpartiesExpanded !== undefined) {
        lines.push(coverage.directCounterpartiesExpanded + " counterparties expanded");
      }
      if (coverage.transferEdgesCollected !== null && coverage.transferEdgesCollected !== undefined) {
        lines.push(coverage.transferEdgesCollected + " transfer edges collected");
      }
      if (coverage.extendedAddressesFetched !== null && coverage.extendedAddressesFetched !== undefined) {
        lines.push(coverage.extendedAddressesFetched + " extended addresses fetched");
      }
      if (coverage.boundaryStopCount !== null && coverage.boundaryStopCount !== undefined) {
        lines.push(coverage.boundaryStopCount + " expansion stops / limitations");
      }
      if (coverage.metadataEnrichmentLimited) {
        lines.push("service metadata enrichment was limited");
      }
      return lines;
    }
```

- [ ] **Step 4: Add coverage and role wording to the right rail**

In `subjectReportBlock(node, graph)`, add:

```js
        listMetric("DeepCheck coverage", deepCheckCoverageLines(summary), "No DeepCheck coverage summary stored.") +
```

In `nodeIntelligenceBlock(node)`, change the behavior/context safety note to include the exact required wording:

```js
      const safetyNote = intelligence.evidenceStrength === "hard"
        ? ""
        : " This is a behavior marker, not final risk proof by itself.";
```

- [ ] **Step 5: Run the targeted test**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "keeps subject wallet identity separate from behavior role"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: show deep check coverage details"
```

---

### Task 7: Expand Selected Feedback For Non-Expandable Evidence

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Write the failing expansion feedback test**

Add this test near the existing `Expand selected` tests:

```ts
  it("explains non-expandable boundary context instead of silently doing nothing", () => {
    const html = adminConsoleHtml();
    const expandBlock = html.slice(html.indexOf("function expandSelectedGraphItem"), html.indexOf("function selectNode"));

    expect(expandBlock).toContain("Boundary/context details are shown in the right rail. No stored raw expansion is available for this item.");
    expect(expandBlock).toContain("No stored expansion data for this item. The right rail shows the available summary evidence.");
  });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "explains non-expandable boundary context"
```

Expected: FAIL until the wording is added.

- [ ] **Step 3: Update `expandSelectedGraphItem` messages**

In `src/admin/adminConsole.ts`, update the boundary node branch:

```js
      if (node?.kind === "service" || node?.kind === "contract" || nodeDisplayKind(node) === "service_boundary") {
        setStatus("Boundary/context details are shown in the right rail. No stored raw expansion is available for this item.");
        renderSelectionCard();
        renderDetails();
        return;
      }
```

Update the final no-data message to:

```js
      setStatus("No stored expansion data for this item. The right rail shows the available summary evidence.");
```

- [ ] **Step 4: Run expansion tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts -t "Expand selected"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix: explain non-expandable graph evidence"
```

---

### Task 8: Full Verification And Manual QA

**Files:**
- Verify only.

- [ ] **Step 1: Run admin projection tests**

Run:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run admin console tests**

Run:

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminConsole.regression-1.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Start admin locally**

Use the existing project admin startup command or the currently used local admin process. If the app is already running, restart it so the new admin bundle is served.

Manual QA cases:

- Open a completed `address_deep_check`.
- Select the subject wallet.
- Confirm it says `Selected: Subject wallet`.
- Confirm collector/mule behavior role appears as a role marker note, not as final proof.
- Select a service/CEX/contract boundary edge.
- Confirm right rail says `Evidence type: Boundary context`.
- Confirm aggregate amount and transfer count are shown when present.
- Confirm `amount n/a` is replaced by a projected-context explanation when aggregate amount is not present.
- Select a `History incomplete` or `History not fully fetched` stop.
- Confirm right rail explains coverage limitation and possible causes.
- Click `Expand selected` on a non-expandable boundary.
- Confirm status explains that details are in the right rail.

- [ ] **Step 5: Commit verification fixes if any were needed**

If manual QA requires fixes:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "fix: polish deep check evidence details"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Direct transfer right-rail explanation: Task 4.
- Grouped transfer and boundary context aggregate labels: Tasks 1, 3, and 4.
- `incoming_history_not_fetched` explanation: Task 5.
- Subject wallet role separation: Task 6.
- DeepCheck coverage summary: Task 2 and Task 6.
- `Expand selected` no-data explanation: Task 7.
- No scoring/fetching changes: all tasks are limited to `src/admin/forensicsGraph.ts`, `src/admin/adminConsole.ts`, and admin tests.

Marker scan:

- The plan contains no unresolved work markers.
- Every task has exact files, test snippets, commands, expected outcomes, and commit commands.

Type consistency:

- Evidence type values are metadata strings: `direct_transfer`, `grouped_transfers`, `boundary_context`, `profile_context`, `trace_stop`.
- UI helpers read metadata defensively and fall back to existing edge type/display role.
- Boundary aggregate fields are metadata fields, so the public graph schema remains backward compatible.
