# Admin Forensics Graph Semantics and Allocation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Admin Forensics Console display bridges, smart contracts, boundaries, profile/context edges, and allocation amounts clearly without changing forensic scoring.

**Architecture:** Add derived display semantics to the graph projection layer, then make the admin console consume those semantics instead of guessing from raw node kind. Keep raw forensic evidence intact; display-only fields explain what the UI should show. Allocation remains preserved in edge metadata, but the canvas uses the original transfer amount as the primary label and the right panel explains the used coverage portion.

**Tech Stack:** TypeScript, Vitest, inline admin console HTML/JS in `src/admin/adminConsole.ts`, graph projection in `src/admin/forensicsGraph.ts`.

---

## Files

- Modify: `src/admin/forensicsGraph.ts`
  - Add `displayKind` and `displayLabel` for nodes.
  - Add `displayRole` for edges.
  - Derive bridge/CEX/contract/boundary semantics from existing metadata.
  - Mark `address_deep_check` direct-counterparty edges as profile context.
  - Mark edges with partial `usedAmountRaw` as allocated transfer edges.
- Modify: `src/admin/adminConsole.ts`
  - Consume `node.displayKind` and `edge.displayRole`.
  - Render bridge/smart-contract badges from display semantics.
  - Replace confusing allocation labels.
  - Keep canvas labels compact.
- Modify: `tests/admin/forensicsGraph.test.ts`
  - Cover node semantic upgrades and edge display roles.
- Modify: `tests/admin/adminServer.test.ts`
  - Cover static admin HTML/copy and helper presence.

---

### Task 1: Add Node Display Semantics in Graph Projection

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write failing projection test for bridge semantic upgrade**

Add this test inside `describe("projectForensicJobGraph", ...)` in `tests/admin/forensicsGraph.test.ts`, near the existing address-deep service exposure tests:

```typescript
  it("upgrades service counterparties with bridge metadata to bridge display semantics", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
            direction: "outbound",
            volumeRaw: "1285313840000",
            volumeRatio: 0.1704,
            txCount: 8,
            evidenceClass: "service_boundary_context",
            skippedReason: "service_boundary_context",
            serviceCategory: "bridge",
            identity: "Bridgers:Cross-chain Bridge",
            scoreContribution: 0,
            txHashes: []
          }
        ],
        serviceExposureProfiles: [
          {
            exposureScore: 65,
            serviceType: "bridge",
            identity: "Bridgers:Cross-chain Bridge",
            topServiceCounterparties: [
              {
                address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
                category: "bridge",
                identity: "Bridgers:Cross-chain Bridge",
                volumeRaw: "1285313840000",
                txCount: 8
              }
            ],
            topMergedServiceFlows: []
          }
        ],
        inboundProvenancePaths: [],
        coverage: { transferEdges: 8 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const node = result.graph.nodes.find((item) => item.address === "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s");

    expect(node).toMatchObject({
      kind: "wallet",
      displayKind: "bridge",
      displayLabel: "Bridgers:Cross-chain Bridge",
      weight: 65,
      riskLevel: "HIGH"
    });
  });
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts -t "upgrades service counterparties"
```

Expected result: FAIL because `displayKind` and `displayLabel` do not exist.

- [ ] **Step 3: Add node display types**

In `src/admin/forensicsGraph.ts`, extend the types near `AdminForensicsNode`:

```typescript
export type AdminForensicsNodeDisplayKind =
  | "subject_wallet"
  | "wallet"
  | "bridge"
  | "cex"
  | "smart_contract"
  | "contract_adapter"
  | "contract_router"
  | "dex_contract"
  | "service_boundary"
  | "funding_bundle"
  | "trace_stop";

export type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "bundle" | "stop";
  displayKind?: AdminForensicsNodeDisplayKind;
  displayLabel?: string;
  label: string;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};
```

- [ ] **Step 4: Add display semantic helpers**

Add these helpers before `annotateGraphDerivedMetrics` in `src/admin/forensicsGraph.ts`:

```typescript
function textMarker(...values: unknown[]): string {
  return values
    .filter((value) => value !== null && value !== undefined && String(value).length > 0)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function nodeDisplayKind(node: AdminForensicsNode): AdminForensicsNodeDisplayKind {
  const marker = textMarker(
    node.kind,
    node.label,
    node.metadata.category,
    node.metadata.serviceCategory,
    node.metadata.serviceType,
    node.metadata.identity,
    node.metadata.sourceExposureKind,
    node.metadata.exposureSourceKey,
    node.metadata.rootSourceType,
    node.metadata.source,
    node.metadata.stopReasons
  );

  if (node.kind === "subject") return "subject_wallet";
  if (node.kind === "bundle") return "funding_bundle";
  if (node.kind === "stop") return "trace_stop";
  if (Array.isArray(node.metadata.stopReasons) && node.metadata.stopReasons.length > 0) return "service_boundary";
  if (marker.includes("bridge")) return "bridge";
  if (marker.includes("cex") || marker.includes("exchange")) return "cex";
  if (marker.includes("adapter")) return "contract_adapter";
  if (marker.includes("router")) return "contract_router";
  if (marker.includes("dex")) return "dex_contract";
  if (marker.includes("contract")) return "smart_contract";
  if (node.kind === "service") return "service_boundary";
  if (node.kind === "contract") return "smart_contract";
  return "wallet";
}

function nodeDisplayLabel(node: AdminForensicsNode): string {
  return firstString(
    stringField(node.metadata, "identity"),
    stringField(node.metadata, "exposureSourceLabel"),
    stringField(node.metadata, "label"),
    node.label,
    node.address
  ) ?? node.id;
}
```

- [ ] **Step 5: Annotate all nodes with display semantics**

At the end of the `nodesById.forEach` block inside `annotateGraphDerivedMetrics`, after `node.metadata = { ... }`, add:

```typescript
    node.displayKind = nodeDisplayKind(node);
    node.displayLabel = nodeDisplayLabel(node);
```

- [ ] **Step 6: Run focused projection test**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts -t "upgrades service counterparties"
```

Expected result: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: add admin graph node display semantics"
```

---

### Task 2: Add Edge Display Roles for Allocation and Profile Context

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write failing tests for edge roles**

Add these tests in `tests/admin/forensicsGraph.test.ts` near the allocation and address-deep tests:

```typescript
  it("marks partial coverage transfer edges as allocated transfers", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 45,
        decision: "REVIEW",
        coverage: {
          targetAmountRaw: "135300000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            riskScoreContribution: 45,
            balanceShare: 0.0006,
            pathAddresses: ["TRogXTCqB9Y4gvoc5AtDsbBtEP5B4Tvba8", "TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck", "TSubject111111111111111111111111111111"],
            steps: [
              {
                txHash: "13d262658f27b57d5a724c77e4c5b23d487b109d65416e40755117e97d8bdd8e",
                fromAddress: "TRogXTCqB9Y4gvoc5AtDsbBtEP5B4Tvba8",
                toAddress: "TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck",
                amountRaw: "828617000000",
                amountUsage: {
                  originalAmountRaw: "828617000000",
                  usedAmountRaw: "81180000",
                  anchorAmountRaw: "135300000000",
                  role: "funding_candidate"
                }
              }
            ],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const edge = result.graph.edges.find((item) => item.txHash === "13d262658f27b57d5a724c77e4c5b23d487b109d65416e40755117e97d8bdd8e");

    expect(edge).toMatchObject({
      displayRole: "allocated_transfer",
      metadata: {
        originalAmountRaw: "828617000000",
        usedAmountRaw: "81180000",
        anchorAmountRaw: "135300000000"
      }
    });
  });

  it("marks address-deep outbound direct-counterparty edges as profile context", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
            direction: "outbound",
            volumeRaw: "1285313840000",
            volumeRatio: 0.1704,
            txCount: 8,
            evidenceClass: "service_boundary_context",
            skippedReason: "service_boundary_context",
            serviceCategory: "bridge",
            identity: "Bridgers:Cross-chain Bridge",
            scoreContribution: 0,
            txHashes: []
          }
        ],
        serviceExposureProfiles: [],
        inboundProvenancePaths: [],
        coverage: { transferEdges: 8 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.edges[0]).toMatchObject({
      displayRole: "profile_context",
      metadata: {
        source: "directCounterpartyInteractionProfile",
        direction: "outbound"
      }
    });
  });
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts -t "allocated transfers|profile context"
```

Expected result: FAIL because `displayRole` does not exist.

- [ ] **Step 3: Add edge display role type**

In `src/admin/forensicsGraph.ts`, add near edge types:

```typescript
export type AdminForensicsEdgeDisplayRole =
  | "real_transfer"
  | "allocated_transfer"
  | "profile_context"
  | "inferred_provenance"
  | "stop";
```

Then extend `AdminForensicsEdge`:

```typescript
export type AdminForensicsEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "transfer" | "inferred_provenance" | "approval" | "service_boundary" | "stop";
  displayRole?: AdminForensicsEdgeDisplayRole;
  amountRaw: string | null;
  amountShare: number | null;
  txHash: string | null;
  timestamp: string | null;
  weight: number | null;
  verdict: "clean" | "review" | "risk" | "unknown";
  evidenceIds: string[];
  metadata: Record<string, unknown>;
};
```

- [ ] **Step 4: Add edge role helper**

Add this helper before `annotateGraphDerivedMetrics`:

```typescript
function rawString(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function hasPartialAllocation(edge: AdminForensicsEdge): boolean {
  const original = rawString(edge.metadata.originalAmountRaw);
  const used = rawString(edge.metadata.usedAmountRaw);
  return original !== null && used !== null && original !== used;
}

function edgeDisplayRole(edge: AdminForensicsEdge, jobKind: ForensicCheckJob["kind"]): AdminForensicsEdgeDisplayRole {
  if (edge.type === "stop") return "stop";
  if (
    jobKind === "address_deep_check" &&
    (
      edge.metadata.source === "directCounterpartyInteractionProfile" ||
      String(edge.metadata.pathId ?? "").startsWith("path:direct_counterparty:")
    )
  ) {
    return "profile_context";
  }
  if (hasPartialAllocation(edge)) return "allocated_transfer";
  if (edge.type === "inferred_provenance") return "inferred_provenance";
  return "real_transfer";
}
```

- [ ] **Step 5: Pass job kind into derived annotation**

Change the signature:

```typescript
function annotateGraphDerivedMetrics(
  nodesById: Map<string, AdminForensicsNode>,
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[],
  weights: AdminForensicsWeight[],
  jobKind: ForensicCheckJob["kind"]
): void {
```

At the start of `annotateGraphDerivedMetrics`, after local maps are created, add:

```typescript
  edges.forEach((edge) => {
    edge.displayRole = edgeDisplayRole(edge, jobKind);
  });
```

Update each call:

```typescript
annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);
```

- [ ] **Step 6: Run focused projection tests**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts -t "allocated transfers|profile context|upgrades service counterparties"
```

Expected result: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat: add admin graph edge display roles"
```

---

### Task 3: Make Admin Console Consume Node Display Semantics

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Update HTML shell assertions first**

In `tests/admin/adminServer.test.ts`, change the admin shell test assertions:

```typescript
    expect(html).toContain("function nodeDisplayKind");
    expect(html).toContain("function nodeDisplayLabel");
    expect(html).toContain("Bridge / service");
    expect(html).toContain("Smart contract");
```

Keep the existing explorer link assertions.

- [ ] **Step 2: Run admin server test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: FAIL because the new helper names/copy do not exist.

- [ ] **Step 3: Add display semantic helpers in admin console JS**

In `src/admin/adminConsole.ts`, inside the `<script>` block near `nodeMarker`, add:

```javascript
    function nodeDisplayKind(node) {
      if (!node) return "wallet";
      if (node.displayKind) return node.displayKind;
      const marker = nodeMarker(node);
      if (node.kind === "subject") return "subject_wallet";
      if (node.kind === "bundle") return "funding_bundle";
      if (node.kind === "stop") return "trace_stop";
      if (hasStopReason(node)) return "service_boundary";
      if (marker.includes("bridge")) return "bridge";
      if (marker.includes("cex") || marker.includes("exchange")) return "cex";
      if (marker.includes("adapter")) return "contract_adapter";
      if (marker.includes("router")) return "contract_router";
      if (marker.includes("dex")) return "dex_contract";
      if (marker.includes("contract")) return "smart_contract";
      if (node.kind === "service") return "service_boundary";
      if (node.kind === "contract") return "smart_contract";
      return "wallet";
    }

    function nodeDisplayLabel(node) {
      return node?.displayLabel ||
        node?.metadata?.identity ||
        node?.metadata?.exposureSourceLabel ||
        node?.metadata?.label ||
        node?.label ||
        node?.address ||
        node?.id ||
        "unknown";
    }
```

- [ ] **Step 4: Replace direct kind checks for node color, radius, and canvas label**

Update `nodeColor`:

```javascript
    function nodeColor(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return "var(--accent)";
      if (node.riskLevel === "HIGH" || node.riskLevel === "CRITICAL") return "var(--bad)";
      if (kind === "trace_stop" || kind === "service_boundary") return "var(--warn)";
      if (kind === "bridge") return "var(--bridge)";
      if (kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract") return "var(--contract)";
      if (kind === "cex") return "var(--cex)";
      if (kind === "funding_bundle") return "var(--bundle)";
      if (node.riskLevel === "MEDIUM") return "var(--warn)";
      return "var(--good)";
    }
```

Update `nodeRadius`:

```javascript
    function nodeRadius(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return 24;
      if (kind === "bridge" || kind === "cex" || kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract") return 21;
      if (kind === "funding_bundle") return 22;
      return kind === "trace_stop" ? 18 : 20;
    }
```

Update `canvasNodeLabel`:

```javascript
    function canvasNodeLabel(node) {
      if (!node) return "";
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return short(node.address || node.label || node.id, 6);
      if (kind === "bridge") return "Bridge";
      if (kind === "cex") return "CEX";
      if (kind === "contract_adapter") return "Adapter";
      if (kind === "contract_router") return "Router";
      if (kind === "dex_contract") return "DEX";
      if (kind === "smart_contract") return "Contract";
      if (kind === "service_boundary") return "Service";
      if (kind === "funding_bundle") return "Bundle";
      if (kind === "trace_stop") return stopBadgeLabel(node.metadata?.reason || node.label);
      return short(nodeDisplayLabel(node), 6);
    }
```

- [ ] **Step 5: Update right-panel semantic type chips**

Replace `semanticNodeType` with:

```javascript
    function semanticNodeType(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return { label: "Subject wallet", cls: "subject" };
      if (kind === "bridge") return { label: "Bridge / service", cls: "bridge" };
      if (kind === "cex") return { label: "CEX / exchange", cls: "cex" };
      if (kind === "contract_adapter") return { label: "Contract / adapter", cls: "contract" };
      if (kind === "contract_router") return { label: "Contract / router", cls: "contract" };
      if (kind === "dex_contract") return { label: "DEX contract", cls: "contract" };
      if (kind === "smart_contract") return { label: "Smart contract", cls: "contract" };
      if (kind === "service_boundary") return { label: "Service boundary", cls: "service" };
      if (kind === "funding_bundle") return { label: "Funding bundle", cls: "bundle" };
      if (kind === "trace_stop") return { label: "Trace stop", cls: "boundary" };
      return { label: "Wallet", cls: "wallet" };
    }
```

Update `technicalNodeName` to prefer `displayLabel`:

```javascript
    function technicalNodeName(node) {
      if (!node) return "n/a";
      return nodeDisplayLabel(node);
    }
```

- [ ] **Step 6: Run admin server shell test**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: render admin graph node semantics"
```

---

### Task 4: Make Allocation UI Clear Without Canvas Noise

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Update admin HTML copy assertions**

In `tests/admin/adminServer.test.ts`, replace allocation copy expectations:

```typescript
    expect(html).toContain("Used for checked amount");
    expect(html).toContain("Original transfer amount");
    expect(html).toContain("Target coverage amount");
    expect(html).toContain("Used share of target");
    expect(html).toContain("Used share of transfer");
    expect(html).toContain("Only this portion of the larger transfer was counted toward the checked amount");
    expect(html).not.toContain("Allocated amount");
    expect(html).not.toContain("Original tx amount");
    expect(html).not.toContain("Coverage amount");
```

- [ ] **Step 2: Run admin server test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: FAIL because legacy labels are still present.

- [ ] **Step 3: Add raw amount share helpers**

In `src/admin/adminConsole.ts`, near `formatRawUsdt`, add:

```javascript
    function rawBigInt(value) {
      if (typeof value !== "string" || !/^\\d+$/.test(value)) return null;
      try {
        return BigInt(value);
      } catch {
        return null;
      }
    }

    function rawShare(numeratorRaw, denominatorRaw) {
      const numerator = rawBigInt(numeratorRaw);
      const denominator = rawBigInt(denominatorRaw);
      if (numerator === null || denominator === null || denominator === 0n) return "n/a";
      return percent(Number(numerator) / Number(denominator));
    }
```

- [ ] **Step 4: Split canvas amount from detailed amount**

Replace `edgeAmountLabel` with these functions:

```javascript
    function edgeHasAllocation(edge) {
      const original = edge?.metadata?.originalAmountRaw;
      const used = edge?.metadata?.usedAmountRaw;
      return typeof original === "string" && typeof used === "string" && original !== used;
    }

    function edgeCanvasAmountLabel(edge) {
      return edgeOriginalAmount(edge) || edgeAmount(edge);
    }

    function edgeDetailedAmountLabel(edge) {
      const used = edgeAllocatedAmount(edge);
      const original = edgeOriginalAmount(edge);
      if (!used && !original) return "";
      if (!edgeHasAllocation(edge)) return original || used;
      return original + " original; " + used + " used";
    }
```

In `renderGraph`, replace:

```javascript
        const amountLabel = edgeAmountLabel(edge);
```

with:

```javascript
        const amountLabel = edgeCanvasAmountLabel(edge);
```

In transfer table amount cells and transfer line helpers, use `edgeDetailedAmountLabel(edge)` where the UI has room for details, and `edgeCanvasAmountLabel(edge)` where the UI must stay compact.

- [ ] **Step 5: Update transfer details copy**

Replace `transferDetailBlock` amount metrics with:

```javascript
        metric("Amount", edgeDetailedAmountLabel(edge) || "amount n/a") +
        metric("Used for checked amount", edgeHasAllocation(edge) ? edgeAllocatedAmount(edge) || "n/a" : "same as transfer") +
        metric("Original transfer amount", edgeOriginalAmount(edge) || "n/a") +
        metric("Target coverage amount", edgeAnchorAmount(edge) || "n/a") +
        metric("Used share of target", edgeHasAllocation(edge) ? rawShare(edge?.metadata?.usedAmountRaw, edge?.metadata?.anchorAmountRaw) : "n/a") +
        metric("Used share of transfer", edgeHasAllocation(edge) ? rawShare(edge?.metadata?.usedAmountRaw, edge?.metadata?.originalAmountRaw) : "n/a") +
        (edgeHasAllocation(edge)
          ? metric("Allocation note", "Only this portion of the larger transfer was counted toward the checked amount; the rest was not used in this path.", "wide")
          : "") +
```

Keep the existing `Time`, `Tx gap from previous hop`, `From`, `To`, `Tx hash`, `Path`, `Verdict`, `Weight`, and `Direction` metrics after these amount metrics.

- [ ] **Step 6: Run admin server shell test**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: clarify admin graph allocation UI"
```

---

### Task 5: Add Edge Meaning for Profile vs Provenance

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Add static shell assertions for edge meaning copy**

In `tests/admin/adminServer.test.ts`, add:

```typescript
    expect(html).toContain("Behavioral/service exposure context");
    expect(html).toContain("Money-origin provenance step");
    expect(html).toContain("This is not money-origin proof");
```

- [ ] **Step 2: Run admin shell test and verify it fails**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: FAIL because these phrases do not exist.

- [ ] **Step 3: Add edge meaning helpers**

In `src/admin/adminConsole.ts`, near `edgePathId`, add:

```javascript
    function edgeDisplayRole(edge) {
      return edge?.displayRole || "real_transfer";
    }

    function edgeMeaning(edge) {
      const role = edgeDisplayRole(edge);
      if (role === "profile_context") return "Behavioral/service exposure context";
      if (role === "allocated_transfer") return "Money-origin provenance step with partial coverage allocation";
      if (role === "inferred_provenance") return "Inferred provenance step";
      if (role === "stop") return "Trace stop";
      return "Money-origin provenance step";
    }

    function edgeDirectionMeaning(edge) {
      const role = edgeDisplayRole(edge);
      if (role === "profile_context" && edge?.metadata?.direction === "outbound") return "subject -> counterparty";
      if (role === "profile_context" && edge?.metadata?.direction === "inbound") return "counterparty -> subject";
      return edge?.metadata?.direction || edge?.direction || "n/a";
    }
```

- [ ] **Step 4: Render edge meaning in details**

In `transferDetailBlock`, add these metrics after `Selected`:

```javascript
        metric("Meaning", edgeMeaning(edge)) +
        metric("Direction", edgeDirectionMeaning(edge)) +
        (edgeDisplayRole(edge) === "profile_context"
          ? metric("Proof scope", "This is not money-origin proof.", "wide")
          : "") +
```

Remove or keep the old final `metric("Direction", edge.direction || "n/a")` only if it does not duplicate the new direction metric. The final details panel should show one `Direction` field.

- [ ] **Step 5: Run admin shell test**

Run:

```powershell
npx vitest run tests/admin/adminServer.test.ts -t "serves admin console shell"
```

Expected result: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```powershell
git add src/admin/adminConsole.ts tests/admin/adminServer.test.ts
git commit -m "feat: label admin graph edge meaning"
```

---

### Task 6: Full Verification and Runtime Smoke

**Files:**
- No source files changed in this task.

- [ ] **Step 1: Run admin-focused tests**

Run:

```powershell
npx vitest run tests/admin/forensicsGraph.test.ts tests/admin/adminServer.test.ts
```

Expected result: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected result: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected result: PASS.

- [ ] **Step 4: Restart admin server from current root checkout**

If the existing admin process is still running on port `8787`, stop only that process:

```powershell
$conn = Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue
if ($conn) {
  $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -ErrorAction SilentlyContinue
  }
}
```

Start the project admin server using the same root checkout command used by the current runtime setup.

- [ ] **Step 5: Smoke check admin console shell**

Run:

```powershell
$response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/admin/forensics' -UseBasicParsing -TimeoutSec 10
$response.StatusCode
$response.Content.Contains('Admin Forensics Console')
$response.Content.Contains('Used for checked amount')
$response.Content.Contains('Bridge / service')
```

Expected result:

```text
200
True
True
True
```

- [ ] **Step 6: Commit final verification note if no code changed**

If Task 6 produces no file changes, do not create an empty commit. If a runtime helper file was changed under `.runtime`, do not commit it because `.runtime` is ignored.

---

## Self-Review

- Spec coverage:
  - Node semantics are covered by Task 1 and Task 3.
  - Allocation details and canvas simplification are covered by Task 4.
  - Profile/context edge distinction is covered by Task 2 and Task 5.
  - Testing and runtime smoke are covered by Task 6.
- Scope:
  - Scoring logic and forensic path selection are intentionally unchanged.
  - The plan does not remove outbound deep-check edges; it labels them as profile context.
- Type consistency:
  - Backend uses `displayKind`, `displayLabel`, and `displayRole`.
  - Frontend helpers consume the same names.
  - Tests assert the same property names.
