# Admin Boundary Identity Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show service and boundary graph nodes as named entities with confidence, evidence, grouped transfer details, and honest context-link explanations.

**Architecture:** Keep the current TypeScript graph projection and vanilla admin SVG UI. Add one normalized `boundaryIdentity` metadata object during projection, then make existing label, canvas, and right-rail helpers read that object instead of falling back to generic `CEX`, `Service`, `Bridge`, or `amount n/a` labels.

**Tech Stack:** TypeScript, existing admin HTML/SVG renderer, Vitest, no new dependencies.

---

## File Structure

- Modify `src/admin/forensicsGraph.ts`
  - Normalize boundary identity metadata for DeepCheck, service exposure, boundary stops, and any existing service/boundary graph nodes.
  - Preserve existing `boundaryEvidenceSummary` and `underlyingTransfers`; do not change scoring.
- Modify `src/admin/adminConsole.ts`
  - Prefer normalized entity names in canvas labels.
  - Add a right-rail `Boundary identity` section for service/boundary nodes.
  - Add a right-rail `Boundary evidence` section for grouped/context edges.
  - Replace unexplained `amount n/a` on boundary/context edges with either aggregate evidence or an explicit missing-data explanation.
- Modify `tests/admin/forensicsGraph.test.ts`
  - Add projection tests for known CEX identity, service identity, unknown contract boundary, grouped transfer evidence, and context-only links.
- Modify `tests/admin/adminConsole.test.ts`
  - Add UI helper tests for labels, right-rail identity details, grouped underlying transfers, and context-only explanations.

## Implementation Notes

This plan intentionally does not add a new `Service Map` mode and does not make LLM a source of hard entity identity. The first implementation uses deterministic fields already present in graph data: `boundaryIdentity`, `identity`, `category`, `boundaryCategory`, `boundaryEvidenceSummary`, `underlyingTransfers`, `aggregateAmountRaw`, `aggregateTransferCount`, `stopReason`, and service exposure metadata.

The normalized metadata shape stored on nodes should be:

```ts
type BoundaryIdentityMetadata = {
  displayName: string;
  category: string;
  categoryLabel: string;
  confidence: "high" | "medium" | "low";
  source: string;
  evidence: string[];
  isBoundary: boolean;
  flowVerdict?: string;
  flowVerdictConfidence?: number;
};
```

The same shape may be copied to boundary/context edge metadata when the visible edge represents service or boundary evidence.

### Task 1: Normalize Boundary Identity In Graph Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add a failing DeepCheck projection test for known CEX identity**

Append this test inside the existing `describe("projectForensicJobGraph", () => {` block in `tests/admin/forensicsGraph.test.ts`:

```ts
  it("normalizes known CEX boundary identity metadata for deep-check boundary flows", () => {
    const subject = "TSubjectBoundaryIdentity111111111111111";
    const via = "TViaBoundaryIdentity111111111111111111";
    const cex = "TBybitBoundaryIdentity111111111111111";

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
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: via,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Bybit",
                amountRaw: "332800000000",
                boundaryAmountRaw: "25000000000",
                amountPreservationRatio: 0.075,
                subjectTxHash: "subject-hop-tx",
                boundaryTxHash: "boundary-hop-tx",
                firstTransferAt: "2026-06-23T12:44:00.000Z",
                lastTransferAt: "2026-06-23T13:02:00.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryNode = result.graph.nodes.find((node) => node.address === cex);
    expect(boundaryNode).toMatchObject({
      address: cex,
      displayKind: "cex",
      displayLabel: "Bybit"
    });
    expect(boundaryNode?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Bybit",
      category: "cex",
      categoryLabel: "CEX",
      confidence: "high",
      source: "known_cex_rule",
      evidence: ["identity:Bybit"],
      isBoundary: true
    });

    const boundaryEdge = result.graph.edges.find((edge) => edge.txHash === "boundary-hop-tx");
    expect(boundaryEdge?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Bybit",
      category: "cex",
      categoryLabel: "CEX"
    });
  });
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "normalizes known CEX boundary identity metadata"
```

Expected before implementation:

```text
FAIL tests/admin/forensicsGraph.test.ts
expected undefined to match object
```

- [ ] **Step 3: Add boundary identity helper functions**

In `src/admin/forensicsGraph.ts`, near `shortAddress` and `mergeBoundaryEvidenceSummary`, add:

```ts
type BoundaryIdentityConfidence = "high" | "medium" | "low";

type BoundaryIdentityMetadata = {
  displayName: string;
  category: string;
  categoryLabel: string;
  confidence: BoundaryIdentityConfidence;
  source: string;
  evidence: string[];
  isBoundary: boolean;
  flowVerdict?: string;
  flowVerdictConfidence?: number;
};

function boundaryCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "cex":
      return "CEX";
    case "hot_wallet":
      return "Hot wallet";
    case "bridge":
    case "bridge_pool":
      return "Cross-chain bridge";
    case "dex":
      return "DEX";
    case "router":
      return "Router";
    case "swap_adapter":
      return "Swap adapter";
    case "service":
      return "Service";
    case "protocol":
      return "Protocol";
    case "unknown_contract":
    case "contract":
      return "Contract boundary";
    default:
      return "Boundary";
  }
}

function boundaryIdentitySource(category: string | null, identity: string | null, source: string | null): string {
  if (source) return source;
  if (category === "cex" && identity) return "known_cex_rule";
  if (identity) return "metadata";
  if (category === "unknown_contract" || category === "contract") return "weak_contract_metadata";
  if (category) return "mixed";
  return "unknown";
}

function boundaryIdentityConfidence(
  category: string | null,
  identity: string | null,
  source: string
): BoundaryIdentityConfidence {
  if (source === "known_cex_rule" || source === "service_registry" || source === "provider_tag" || source === "public_tag") {
    return "high";
  }
  if (identity || category === "unknown_contract" || category === "contract") return "medium";
  return "low";
}

function normalizeBoundaryIdentity(input: {
  address: string;
  identity?: string | null;
  category?: string | null;
  source?: string | null;
  evidence?: string[];
  displayName?: string | null;
  flowVerdict?: string | null;
  flowVerdictConfidence?: number | null;
}): BoundaryIdentityMetadata {
  const category = input.category || "unknown";
  const displayName = input.displayName || input.identity || boundaryCategoryLabel(category) || shortAddress(input.address);
  const source = boundaryIdentitySource(category, input.identity ?? null, input.source ?? null);
  const evidence = input.evidence && input.evidence.length > 0
    ? input.evidence
    : input.identity
      ? [`identity:${input.identity}`]
      : [`category:${category}`];
  const result: BoundaryIdentityMetadata = {
    displayName,
    category,
    categoryLabel: boundaryCategoryLabel(category),
    confidence: boundaryIdentityConfidence(category, input.identity ?? null, source),
    source,
    evidence,
    isBoundary: category !== "none"
  };
  if (input.flowVerdict) result.flowVerdict = input.flowVerdict;
  if (typeof input.flowVerdictConfidence === "number" && Number.isFinite(input.flowVerdictConfidence)) {
    result.flowVerdictConfidence = input.flowVerdictConfidence;
  }
  return result;
}

function attachBoundaryIdentity(
  node: AdminForensicsNode,
  identity: BoundaryIdentityMetadata
): void {
  node.metadata.boundaryIdentity = identity;
  node.metadata.identity = identity.displayName;
  node.displayLabel = identity.displayName;
  node.label = identity.displayName;
}
```

- [ ] **Step 4: Attach identity in boundary exposure flow projection**

In `src/admin/forensicsGraph.ts`, inside the boundary exposure flow projection where `boundaryNode` and boundary edges are created, build one normalized identity and attach it to the node and edges:

```ts
const boundaryIdentityMetadata = normalizeBoundaryIdentity({
  address: boundaryAddress,
  identity,
  category,
  source: category === "cex" && identity ? "known_cex_rule" : "mixed",
  evidence: identity ? [`identity:${identity}`] : category ? [`category:${category}`] : ["category:unknown"]
});
attachBoundaryIdentity(boundaryNode, boundaryIdentityMetadata);
```

When pushing a boundary edge metadata object, include:

```ts
boundaryIdentity: boundaryIdentityMetadata,
boundaryEntityName: boundaryIdentityMetadata.displayName,
boundaryCategoryLabel: boundaryIdentityMetadata.categoryLabel
```

- [ ] **Step 5: Run the targeted projection test**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "normalizes known CEX boundary identity metadata"
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
```

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: project boundary identity metadata"
```

### Task 2: Cover Service Profiles And Unknown Boundary Stops

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add a failing service profile test**

Append this test to `tests/admin/forensicsGraph.test.ts`:

```ts
  it("normalizes service exposure identity metadata", () => {
    const subject = "TSubjectServiceIdentity11111111111111";
    const service = "TGasFreeServiceIdentity111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [
          {
            address: service,
            category: "service",
            identity: "GasFree Account",
            score: 12,
            txCount: 4,
            volumeRaw: "50000000000",
            direction: "outbound"
          }
        ],
        missingChecks: [],
        coverage: { transferEdges: 4 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === service);
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "GasFree Account",
      category: "service",
      categoryLabel: "Service",
      confidence: "medium",
      source: "metadata",
      isBoundary: true
    });
  });
```

- [ ] **Step 2: Add a failing unknown contract stop test**

Append this test to `tests/admin/forensicsGraph.test.ts`:

```ts
  it("normalizes unknown contract boundary stops with a readable identity", () => {
    const subject = "TSubjectUnknownBoundary111111111111";
    const contract = "TUnknownContractBoundary111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [
          `Expansion stopped at service boundary ${contract} (unknown_contract)`
        ],
        coverage: { transferEdges: 0 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === contract);
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Unknown contract",
      category: "unknown_contract",
      categoryLabel: "Contract boundary",
      confidence: "medium",
      source: "weak_contract_metadata",
      evidence: ["category:unknown_contract"],
      isBoundary: true
    });
  });
```

- [ ] **Step 3: Run both failing tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "normalizes service exposure identity metadata|normalizes unknown contract boundary stops"
```

Expected before implementation:

```text
FAIL tests/admin/forensicsGraph.test.ts
expected undefined to match object
```

- [ ] **Step 4: Attach identity in service exposure profile projection**

In `src/admin/forensicsGraph.ts`, inside the service exposure profile projection where `upsertServiceNode` is used, call:

```ts
const serviceIdentityMetadata = normalizeBoundaryIdentity({
  address,
  identity,
  category,
  source: "metadata",
  evidence: identity ? [`identity:${identity}`] : category ? [`category:${category}`] : ["category:service"]
});
attachBoundaryIdentity(serviceNode, serviceIdentityMetadata);
```

Also store the same object on profile-context edges that point to this service node:

```ts
boundaryIdentity: serviceIdentityMetadata,
boundaryEntityName: serviceIdentityMetadata.displayName,
boundaryCategoryLabel: serviceIdentityMetadata.categoryLabel
```

- [ ] **Step 5: Attach identity in deep expansion boundary stops**

In `src/admin/forensicsGraph.ts`, inside the deep expansion boundary stop projection, call:

```ts
const stopIdentityMetadata = normalizeBoundaryIdentity({
  address: stop.address,
  identity: stop.identity ?? null,
  category: stop.category ?? "unknown_contract",
  source: stop.category === "unknown_contract" ? "weak_contract_metadata" : "mixed",
  evidence: stop.category ? [`category:${stop.category}`] : ["category:unknown_contract"],
  displayName: stop.identity ?? (stop.category === "unknown_contract" ? "Unknown contract" : null)
});
attachBoundaryIdentity(stopNode, stopIdentityMetadata);
```

Add the same identity object to the stop edge metadata:

```ts
boundaryIdentity: stopIdentityMetadata,
boundaryEntityName: stopIdentityMetadata.displayName,
boundaryCategoryLabel: stopIdentityMetadata.categoryLabel
```

- [ ] **Step 6: Run the targeted projection tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts -t "normalizes service exposure identity metadata|normalizes unknown contract boundary stops"
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
```

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: normalize service boundary stops"
```

### Task 3: Use Boundary Identity In Canvas Labels

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing tests for node label helpers**

Append this test to `tests/admin/adminConsole.test.ts`:

```ts
  it("uses boundary identity for service canvas labels", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function nodeDisplayKind\(node\) \{[\s\S]*?\n    \}(?=\n    function nodeColor)/)?.[0] || "";
    const labelBlock = html.match(/function canvasNodeLabel\(node\) \{[\s\S]*?\n    \}(?=\n    function nodeLabelAttrs)/)?.[0] || "";

    expect(helperBlock).not.toBe("");
    expect(labelBlock).not.toBe("");

    const api = new Function(
      "short",
      "asArray",
      "formatRawUsdt",
      helperBlock + "\n" + labelBlock + "\nreturn { nodeDisplayKind, nodeDisplayLabel, canvasNodeLabel };"
    )(
      (value: string) => value.length > 10 ? value.slice(0, 6) + "..." + value.slice(-4) : value,
      (value: unknown) => Array.isArray(value) ? value : [],
      () => ""
    ) as {
      nodeDisplayLabel(node: unknown): string;
      canvasNodeLabel(node: unknown): string;
    };

    const node = {
      kind: "service",
      displayKind: "cex",
      label: "CEX",
      metadata: {
        boundaryIdentity: {
          displayName: "Bybit",
          category: "cex",
          categoryLabel: "CEX",
          confidence: "high",
          source: "known_cex_rule",
          evidence: ["identity:Bybit"],
          isBoundary: true
        }
      }
    };

    expect(api.nodeDisplayLabel(node)).toBe("Bybit");
    expect(api.canvasNodeLabel(node)).toBe("Bybit");
  });
```

- [ ] **Step 2: Run the failing UI helper test**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "uses boundary identity for service canvas labels"
```

Expected before implementation:

```text
FAIL tests/admin/adminConsole.test.ts
expected 'CEX' to be 'Bybit'
```

- [ ] **Step 3: Add admin UI boundary identity helpers**

In `src/admin/adminConsole.ts`, before `nodeDisplayKind`, add:

```js
    function boundaryIdentityOf(value) {
      const identity = value?.metadata?.boundaryIdentity || value?.boundaryIdentity;
      return identity && typeof identity === "object" ? identity : null;
    }
    function boundaryIdentityName(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.displayName || value?.metadata?.identity || value?.metadata?.boundaryEntityName || value?.identity || "";
    }
    function boundaryIdentityCategoryLabel(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.categoryLabel || value?.metadata?.boundaryCategoryLabel || value?.metadata?.category || value?.category || "";
    }
    function boundaryIdentityConfidenceLabel(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.confidence || "unknown";
    }
```

- [ ] **Step 4: Update label helpers to prefer boundary identity**

In `src/admin/adminConsole.ts`, replace `nodeDisplayLabel` with:

```js
    function nodeDisplayLabel(node) {
      return boundaryIdentityName(node) ||
        node?.displayLabel ||
        node?.metadata?.identity ||
        node?.metadata?.exposureSourceLabel ||
        node?.metadata?.label ||
        node?.label ||
        node?.address ||
        node?.id ||
        "unknown";
    }
```

In `canvasNodeLabel`, change service-like cases so identity wins:

```js
      const identityLabel = boundaryIdentityName(node);
      if (identityLabel && nodeIsServiceLike(node)) return identityLabel + (boundaryIdentityConfidenceLabel(node) === "low" ? "?" : "");
```

Insert that block after `const kind = nodeDisplayKind(node);`.

- [ ] **Step 5: Run the UI helper test**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "uses boundary identity for service canvas labels"
```

Expected:

```text
PASS tests/admin/adminConsole.test.ts
```

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: show boundary identity labels"
```

### Task 4: Add Boundary Identity Right-Rail Details

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a failing right-rail test for service nodes**

Append this test to `tests/admin/adminConsole.test.ts`:

```ts
  it("shows boundary identity details in selected node right rail", () => {
    const html = adminConsoleHtml();
    const block = html.match(/function walletDetailBlock\(node, graph\) \{[\s\S]*?\n    \}(?=\n    function transferDetailBlock)/)?.[0] || "";

    expect(block).toContain("Boundary identity");
    expect(block).toContain("boundaryIdentityName(node)");
    expect(block).toContain("boundaryIdentityCategoryLabel(node)");
    expect(block).toContain("boundaryIdentityConfidenceLabel(node)");
    expect(block).toContain("Boundary meaning");
  });
```

- [ ] **Step 2: Run the failing right-rail test**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "shows boundary identity details"
```

Expected before implementation:

```text
FAIL tests/admin/adminConsole.test.ts
expected the extracted `walletDetailBlock` source to contain 'Boundary identity'
```

- [ ] **Step 3: Add boundary identity detail helpers**

In `src/admin/adminConsole.ts`, before `walletDetailBlock`, add:

```js
    function boundaryIdentityEvidenceText(value) {
      const identity = boundaryIdentityOf(value);
      const evidence = Array.isArray(identity?.evidence) ? identity.evidence : [];
      return evidence.length ? evidence.join(" / ") : "No identity evidence stored.";
    }
    function boundaryIdentitySourceLabel(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.source || "unknown";
    }
    function boundaryMeaningLabel(value) {
      const category = String(boundaryIdentityOf(value)?.category || value?.metadata?.category || "");
      if (category === "cex" || category === "hot_wallet") return "Exchange/service boundary. Public-chain continuity after this point is limited.";
      if (category === "bridge" || category === "bridge_pool") return "Bridge boundary. Chain continuity needs explicit follow-on evidence.";
      if (category === "dex" || category === "router" || category === "swap_adapter") return "DEX/router boundary. This is service context, not direct ownership proof.";
      if (category === "unknown_contract" || category === "contract") return "Contract boundary. Manual review is required before treating this as clean or dirty.";
      return "Service boundary context. This is not proof of common ownership by itself.";
    }
    function boundaryObservedSummary(node) {
      const summary = node?.metadata?.boundaryEvidenceSummary && typeof node.metadata.boundaryEvidenceSummary === "object"
        ? node.metadata.boundaryEvidenceSummary
        : {};
      const transfers = summary.transferCount || node?.metadata?.txCount || "n/a";
      const amount = formatRawUsdt(summary.totalAmountRaw || node?.metadata?.volumeRaw) || "n/a";
      const direction = summary.direction || asArray(summary.directions).join(" / ") || node?.metadata?.direction || "n/a";
      const depth = summary.depth || asArray(summary.depths).join(" / ") || node?.metadata?.depth || "n/a";
      return [
        metric("Observed transfers", transfers),
        metric("Observed amount", amount),
        metric("Direction", direction),
        metric("Depth", depth)
      ].join("");
    }
    function boundaryIdentityBlock(node) {
      if (!boundaryIdentityOf(node) && !nodeIsServiceLike(node)) return "";
      return section("Boundary identity", [
        metric("Entity", boundaryIdentityName(node) || "Unknown entity"),
        metric("Type", boundaryIdentityCategoryLabel(node) || "Boundary"),
        metric("Confidence", boundaryIdentityConfidenceLabel(node)),
        metric("Source", boundaryIdentitySourceLabel(node)),
        metric("Evidence", boundaryIdentityEvidenceText(node)),
        metric("Boundary meaning", boundaryMeaningLabel(node)),
        boundaryObservedSummary(node)
      ].join(""));
    }
```

- [ ] **Step 4: Render the block in `walletDetailBlock`**

In `walletDetailBlock(node, graph)`, add `boundaryIdentityBlock(node)` immediately after the selected node header fields and before generic raw metadata:

```js
      boundaryIdentityBlock(node),
```

- [ ] **Step 5: Run the right-rail test**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "shows boundary identity details"
```

Expected:

```text
PASS tests/admin/adminConsole.test.ts
```

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: explain boundary identities"
```

### Task 5: Show Grouped Boundary Evidence Instead Of Plain Missing Amounts

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add failing tests for grouped boundary edge labels**

Append this test to `tests/admin/adminConsole.test.ts`:

```ts
  it("summarizes grouped boundary evidence with entity, tx count, and amount", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function edgeCanvasAmountOrMissingLabel\(edge\) \{[\s\S]*?\n    \}(?=\n    function edgeCanvasTimeLabel)/)?.[0] || "";
    const boundaryHelpers = html.match(/function boundaryIdentityOf\(value\) \{[\s\S]*?\n    \}(?=\n    function nodeDisplayKind)/)?.[0] || "";

    expect(helperBlock).not.toBe("");
    expect(boundaryHelpers).not.toBe("");

    const api = new Function(
      "formatRawUsdt",
      boundaryHelpers + "\n" + helperBlock + "\nreturn { edgeCanvasAmountOrMissingLabel };"
    )(
      (value: unknown) => value === "332800000000" ? "332.8K USDT" : ""
    ) as {
      edgeCanvasAmountOrMissingLabel(edge: unknown): string;
    };

    const edge = {
      type: "service_boundary",
      metadata: {
        evidenceType: "boundary_context",
        aggregateAmountRaw: "332800000000",
        aggregateTransferCount: 12,
        boundaryIdentity: {
          displayName: "Bybit",
          category: "cex",
          categoryLabel: "CEX",
          confidence: "high",
          source: "known_cex_rule",
          evidence: ["identity:Bybit"],
          isBoundary: true
        }
      }
    };

    expect(api.edgeCanvasAmountOrMissingLabel(edge)).toBe("Bybit / 12 tx / 332.8K USDT");
  });
```

- [ ] **Step 2: Add failing test for context-only explanation**

Append this test to `tests/admin/adminConsole.test.ts`:

```ts
  it("explains boundary context edges without stored transfer evidence", () => {
    const html = adminConsoleHtml();
    const block = html.match(/function transferDetailBlock\(edge\) \{[\s\S]*?\n    \}(?=\n    function selectedEdgeCardBlock)/)?.[0] || "";

    expect(block).toContain("Projected context");
    expect(block).toContain("no individual underlying transactions were stored");
    expect(block).toContain("Amount not stored for this projected context edge.");
  });
```

- [ ] **Step 3: Run the failing grouped evidence tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "summarizes grouped boundary evidence|explains boundary context edges"
```

Expected before implementation:

```text
FAIL tests/admin/adminConsole.test.ts
```

- [ ] **Step 4: Update canvas edge amount helper**

In `src/admin/adminConsole.ts`, update `edgeCanvasAmountOrMissingLabel(edge)` so boundary/context edges use aggregate evidence first:

```js
    function edgeBoundarySummaryLabel(edge) {
      const evidenceType = edgeEvidenceType(edge);
      const transferCount = edgeAggregateTransferCount(edge);
      const amount = edgeAggregateAmountLabel(edge) || edgeAmount(edge);
      const entity = boundaryIdentityName(edge);
      if (evidenceType !== "boundary_context" && evidenceType !== "grouped_transfers") return "";
      if (entity && transferCount && amount) return entity + " / " + transferCount + " tx / " + amount;
      if (transferCount && amount) return transferCount + " tx / " + amount;
      if (entity && transferCount) return entity + " / " + transferCount + " tx";
      if (entity && amount) return entity + " / " + amount;
      if (amount) return amount;
      return "context link";
    }
    function edgeCanvasAmountOrMissingLabel(edge) {
      const boundarySummary = edgeBoundarySummaryLabel(edge);
      if (boundarySummary) return boundarySummary;
      return edgeAmount(edge) || "amount n/a";
    }
```

- [ ] **Step 5: Update right-rail transfer details for boundary/context edges**

In `transferDetailBlock(edge)`, add this section before generic amount/from/to rows:

```js
      const boundarySummary = edgeBoundarySummaryLabel(edge);
      const underlyingLines = edgeUnderlyingTransferLines(edge);
      const hasBoundaryContext = edgeEvidenceType(edge) === "boundary_context" || edge?.type === "service_boundary";
      const boundaryEvidenceSection = hasBoundaryContext ? section("Boundary evidence", [
        metric("Entity", boundaryIdentityName(edge) || edge?.metadata?.boundaryEntityName || "Unknown entity"),
        metric("Type", boundaryIdentityCategoryLabel(edge) || "Boundary"),
        metric("Relationship", boundarySummary || "Projected context"),
        metric("Meaning", edgeEvidenceMeaning(edge)),
        metric("Aggregate amount", edgeAggregateAmountLabel(edge) || "Amount not stored for this projected context edge."),
        metric("Transfer count", edgeAggregateTransferCount(edge) || "n/a"),
        underlyingLines.length
          ? listMetric("Underlying transfers", underlyingLines, "No underlying transfers")
          : metric("Underlying transfers", "This context edge was projected from service/boundary evidence, but no individual underlying transactions were stored for this visible edge.")
      ].join("")) : "";
```

Then include `boundaryEvidenceSection` in the returned detail block before the generic evidence rows.

- [ ] **Step 6: Run the grouped evidence tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/adminConsole.test.ts -t "summarizes grouped boundary evidence|explains boundary context edges"
```

Expected:

```text
PASS tests/admin/adminConsole.test.ts
```

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "feat: explain grouped boundary evidence"
```

### Task 6: Preserve Underlying Transfers For Grouped Boundary Edges

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/forensicsGraph.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add projection test for grouped underlying transfer list**

Append this assertion to the existing `projects deep-check boundary flows with selectable evidence details` test or add a new test in `tests/admin/forensicsGraph.test.ts`:

```ts
    const groupedEdge = result.graph.edges.find((edge) => edge.metadata.evidenceType === "boundary_context");
    expect(groupedEdge?.metadata.underlyingTransfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: "boundary-hop-tx",
        amountRaw: "16039056111",
        timestamp: "2026-06-02T10:11:42.000Z",
        role: "boundary_hop"
      })
    ]));
```

- [ ] **Step 2: Add admin UI test for underlying transfer lines**

Append this test to `tests/admin/adminConsole.test.ts`:

```ts
  it("formats grouped boundary underlying transfers with amount, time, tx, and role", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function edgeUnderlyingTransferLines\(edge\) \{[\s\S]*?\n    \}(?=\n    function edgeDirectness)/)?.[0] || "";

    expect(helperBlock).not.toBe("");

    const api = new Function(
      "asArray",
      "formatRawUsdt",
      "canvasTimestampLabel",
      "short",
      helperBlock + "\nreturn { edgeUnderlyingTransferLines };"
    )(
      (value: unknown) => Array.isArray(value) ? value : [],
      (value: unknown) => value === "25000000000" ? "25K USDT" : "",
      (value: unknown) => value === "2026-06-23T12:44:00.000Z" ? "Jun 23, 12:44" : "",
      (value: string) => value.slice(0, 10)
    ) as {
      edgeUnderlyingTransferLines(edge: unknown): string[];
    };

    expect(api.edgeUnderlyingTransferLines({
      metadata: {
        underlyingTransfers: [
          {
            txHash: "abcdef123456",
            amountRaw: "25000000000",
            timestamp: "2026-06-23T12:44:00.000Z",
            role: "boundary_hop"
          }
        ]
      }
    })).toEqual(["25K USDT / Jun 23, 12:44 / tx abcdef1234 / boundary_hop"]);
  });
```

- [ ] **Step 3: Run the underlying evidence tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts -t "underlying transfers|selectable evidence details"
```

Expected before implementation:

```text
FAIL tests/admin/adminConsole.test.ts
```

- [ ] **Step 4: Keep projection transfer records unchanged and cap display to 20**

Confirm `src/admin/forensicsGraph.ts` keeps `underlyingTransfers` on both node summaries and edge metadata. If the projection currently drops either `amountRaw`, `timestamp`, or `txHash`, update `boundaryUnderlyingTransfer` calls so each stored transfer includes:

```ts
{
  txHash: input.txHash,
  amountRaw: input.amountRaw,
  timestamp: input.timestamp,
  role: input.role
}
```

Do not invent missing amounts. If a transfer lacks `amountRaw`, leave `amountRaw` as `null`.

- [ ] **Step 5: Keep admin transfer formatting explicit**

In `edgeUnderlyingTransferLines(edge)`, keep the existing behavior for stored values and cap the visible list to 20:

```js
    function edgeUnderlyingTransferLines(edge) {
      return asArray(edge?.metadata?.underlyingTransfers).slice(0, 20).map((item) => {
        const amount = formatRawUsdt(item?.amountRaw) || item?.amountRaw || "amount not stored";
        const time = canvasTimestampLabel(item?.timestamp) || item?.timestamp || "time not stored";
        const tx = item?.txHash ? " / tx " + short(item.txHash, 10) : "";
        const role = item?.role ? " / " + item.role : "";
        return amount + " / " + time + tx + role;
      });
    }
```

- [ ] **Step 6: Run the underlying evidence tests again**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts -t "underlying transfers|selectable evidence details"
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
PASS tests/admin/adminConsole.test.ts
```

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat: preserve boundary transfer evidence"
```

### Task 7: Cross-Mode Regression Tests

**Files:**
- Test: `tests/admin/forensicsGraph.test.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add a FastCheck reuse assertion**

In the existing `projects an address fast check job into admin graph` test in `tests/admin/forensicsGraph.test.ts`, add an assertion for at least one service/boundary node that already has identity metadata:

```ts
    const fastServiceNode = result.graph.nodes.find((node) => node.address === cex);
    expect(fastServiceNode?.metadata.boundaryIdentity).toMatchObject({
      displayName: expect.any(String),
      isBoundary: true
    });
```

- [ ] **Step 2: Add direct-transfer unchanged UI assertion**

Append this test to `tests/admin/adminConsole.test.ts`:

```ts
  it("keeps direct transfer missing amount label unchanged for ordinary transfers", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function edgeCanvasAmountOrMissingLabel\(edge\) \{[\s\S]*?\n    \}(?=\n    function edgeCanvasTimeLabel)/)?.[0] || "";

    expect(helperBlock).not.toBe("");

    const api = new Function(
      "edgeBoundarySummaryLabel",
      "edgeAmount",
      helperBlock + "\nreturn { edgeCanvasAmountOrMissingLabel };"
    )(
      () => "",
      () => ""
    ) as {
      edgeCanvasAmountOrMissingLabel(edge: unknown): string;
    };

    expect(api.edgeCanvasAmountOrMissingLabel({ type: "transfer", metadata: {} })).toBe("amount n/a");
  });
```

- [ ] **Step 3: Run focused cross-mode tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts -t "address fast check|direct transfer missing amount"
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
PASS tests/admin/adminConsole.test.ts
```

- [ ] **Step 4: Run full admin graph and console tests**

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
PASS tests/admin/adminConsole.test.ts
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript compiles with `tsc --noEmit`
```

The command exits with code `0`.

- [ ] **Step 6: Commit Task 7**

Run:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "test: cover boundary identity display"
```

## Manual QA Checklist

- [ ] Open the admin console and load a DeepCheck job with CEX/service/contract boundaries.
- [ ] Confirm known CEX nodes show concrete names such as `Bybit` or `Binance-Hot 6`, not only `CEX`.
- [ ] Confirm service nodes show concrete names such as `GasFree Account` when identity exists.
- [ ] Confirm unknown contract nodes show `Unknown contract` and the right rail explains why the identity is weak.
- [ ] Click a boundary node and confirm the right rail shows `Boundary identity`, `Entity`, `Type`, `Confidence`, `Source`, `Evidence`, and `Boundary meaning`.
- [ ] Click a grouped boundary/context edge and confirm the right rail shows aggregate amount, transfer count, and underlying transfer rows when stored.
- [ ] Click a context edge without stored transfers and confirm the right rail explains that this is projected context instead of showing unexplained missing data.
- [ ] Confirm ordinary direct wallet-to-wallet transfers still display as before.
- [ ] Confirm risk colors and role icons remain separate from service category labels.

## Final Verification

Run:

```bash
npx vitest run --configLoader bundle tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
git status --short --branch
```

Expected:

```text
PASS tests/admin/forensicsGraph.test.ts
PASS tests/admin/adminConsole.test.ts
TypeScript compiles with exit code 0
git status prints the current branch and no unstaged implementation files
```

After implementation and verification, push only after a final review of the diff:

```bash
git diff --stat origin/master...HEAD
git log --oneline origin/master..HEAD
```
