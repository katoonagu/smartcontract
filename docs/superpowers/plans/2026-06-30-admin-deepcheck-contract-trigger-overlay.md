# Admin DeepCheck Contract Trigger Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepCheck show smart-contract-driven debits as a readable graph scene: source wallet -> collector wallet for real USDT movement, and source wallet -> spender contract for trigger context.

**Architecture:** Keep the existing vanilla admin graph and existing role-mark icons. Add one new projected evidence edge type, `contract_trigger_context`, produced from stored `contractDrivenTransferProfiles`; do not add dependencies or a new renderer. UI changes are limited to edge semantics, styling, right-rail copy, and transfer drawer filtering.

**Tech Stack:** TypeScript, existing admin SVG/HTML renderer in `src/admin/adminConsole.ts`, graph projection in `src/admin/forensicsGraph.ts`, Vitest test suite.

---

## File Structure

- Modify: `src/admin/forensicsGraph.ts`
  - Add `contract_trigger_context` projection from each contract-driven source wallet to the spender contract.
  - Keep `contract_driven_transfer` as the real source wallet -> collector wallet token movement.
  - Prevent contract-driven incoming evidence from creating collector/subject -> contract money-looking edges.
  - Mark `Verify20` debited sources as `victim` when the receiver campaign is drainer-like or exact-drain, even when post-debit activity is not stored yet.

- Modify: `src/admin/adminConsole.ts`
  - Render `contract_trigger_context` as thin violet context, not yellow service flow and not green/red money flow.
  - Hide amount chips and transfer drawer rows for trigger context edges.
  - Show method, caller, contract, source, receiver, related debit tx, and proof level in the selected-flow right rail.
  - Preserve existing skull, target, mule/transit, and collector icon rendering.

- Modify: `tests/admin/forensicsGraph.test.ts`
  - Add graph projection tests for source -> contract trigger context, victim marking, contract dedupe, and no collector -> contract duplicate edge.

- Modify: `tests/admin/adminConsole.test.ts`
  - Add UI tests for edge labels, edge CSS class routing, selected-flow details, and transfer drawer filtering.

- Verify only:
  - `src/forensics/contractDrivenEvidence.ts`
  - `tests/forensics/contractDrivenEvidence.test.ts`
  - These already contain receiver/source classification logic. Do not change them unless a test proves the classifier blocks the graph feature.

## Constraints

- Do not add a new frontend framework.
- Do not create new icons; use existing role marks.
- Do not draw `collector / subject -> contract` for contract-driven incoming evidence unless a separate real transaction proves that direction.
- Do not put `contract_trigger_context` rows into the transfer drawer as normal transfers.
- Single transaction evidence remains a single edge, not a grouped edge.
- `Verify20` is not globally "always drainer"; the graph victim mark is allowed only when the receiver campaign is drainer-like/exact-drain or the specific transfer has approval-drain proof.

---

### Task 1: Add Failing Graph Projection Tests

**Files:**
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add a test for source-to-contract trigger context**

Add this test near the existing contract-driven graph tests around the current `contractDrivenTransferProfiles` coverage:

```ts
  it("projects contract-driven debits as source-to-contract trigger context", () => {
    const subject = "TCollectorContractDriven111111111111";
    const victim = "TVictimSourceWallet1111111111111111";
    const contract = "TVerifyAccountContract111111111111";
    const operator = "TOperatorCaller111111111111111111";
    const txHash = "b424fdec203c31c043933f64e3c5d3bf85c9bc70721fd84101b6a3cd39f250e7";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      result: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 175,
          totalIncomingAmountRaw: "968500000000",
          contractDrivenIncomingTxCount: 168,
          contractDrivenIncomingAmountRaw: "959200000000",
          uniqueSourceCount: 168,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "9370000000",
          amount: "9.37K USDT",
          method: "Verify20",
          callerAddress: operator,
          operatorAddress: operator,
          contractAddress: contract,
          spenderAddress: contract,
          contractName: "VerifyAccount",
          sourceAddress: victim,
          victimAddress: victim,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const triggerEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${victim}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    );

    expect(triggerEdge).toMatchObject({
      type: "approval",
      displayRole: "profile_context",
      amountRaw: null,
      txHash: null,
      metadata: {
        source: "contractDrivenTransferProfile",
        evidenceType: "contract_trigger_context",
        boundaryContextOnly: true,
        method: "Verify20",
        callerAddress: operator,
        contractAddress: contract,
        sourceAddress: victim,
        receiverAddress: subject,
        relatedDebitTxHash: txHash,
        underlyingTransfers: []
      }
    });
  });
```

- [ ] **Step 2: Add a test that collector-to-contract duplicate edges are not produced**

Add this test after the trigger context test:

```ts
  it("does not draw collector-to-contract duplicates for incoming contract-driven debits", () => {
    const subject = "TCollectorNoDuplicate111111111111";
    const victim = "TVictimNoDuplicate111111111111111";
    const contract = "TContractNoDuplicate111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      result: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 10,
          totalIncomingAmountRaw: "100000000000",
          contractDrivenIncomingTxCount: 9,
          contractDrivenIncomingAmountRaw: "90000000000",
          uniqueSourceCount: 9,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [{
          txHash: "duplicate-guard-tx",
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "10000000000",
          method: "Verify20",
          callerAddress: "TOperatorNoDuplicate111111111111",
          contractAddress: contract,
          sourceAddress: victim,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.some((edge) =>
      edge.fromNodeId === `addr:${subject}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.source === "contractDrivenTransferProfile"
    )).toBe(false);
  });
```

- [ ] **Step 3: Add a test that Verify20 debited sources get victim role marks**

Add this test after the duplicate-edge test:

```ts
  it("marks Verify20 debited sources as victims when receiver campaign is drainer-like", () => {
    const subject = "TDrainerLikeReceiver111111111111";
    const victim = "TVerify20VictimSource111111111111";
    const contract = "TVerify20Contract11111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      result: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 112,
          totalIncomingAmountRaw: "437600000000",
          contractDrivenIncomingTxCount: 97,
          contractDrivenIncomingAmountRaw: "322100000000",
          uniqueSourceCount: 97,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash: "verify20-victim-role-tx",
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "816000000",
          method: "Verify20",
          callerAddress: "TCallerVerify201111111111111111",
          contractAddress: contract,
          sourceAddress: victim,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.find((node) => node.address === victim)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim",
      source: "contract_driven_evidence"
    });
  });
```

- [ ] **Step 4: Add a test that repeated profiles reuse one contract node**

Add this test after the victim role test:

```ts
  it("deduplicates repeated contract-driven profiles by spender contract address", () => {
    const subject = "TCollectorContractDedupe111111111";
    const contract = "TSharedVerifyContract111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      result: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 3,
          totalIncomingAmountRaw: "3000000000",
          contractDrivenIncomingTxCount: 2,
          contractDrivenIncomingAmountRaw: "2000000000",
          uniqueSourceCount: 2,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [
          {
            txHash: "contract-dedupe-a",
            timestamp: "2026-06-28T00:01:00.000Z",
            amountRaw: "1000000000",
            method: "Verify20",
            callerAddress: "TCallerDedupeA111111111111111",
            contractAddress: contract,
            sourceAddress: "TVictimDedupeA111111111111111",
            receiverAddress: subject
          },
          {
            txHash: "contract-dedupe-b",
            timestamp: "2026-06-28T00:02:00.000Z",
            amountRaw: "1000000000",
            method: "Verify20",
            callerAddress: "TCallerDedupeB111111111111111",
            contractAddress: contract,
            sourceAddress: "TVictimDedupeB111111111111111",
            receiverAddress: subject
          }
        ],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.filter((node) => node.address === contract)).toHaveLength(1);
    expect(result.graph.edges.filter((edge) =>
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toHaveLength(2);
  });
```

- [ ] **Step 5: Run the graph tests and confirm they fail**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts --runInBand
```

Expected: FAIL. At least the first test fails because `contract_trigger_context` is not projected yet.

---

### Task 2: Project Contract Trigger Context Edges

**Files:**
- Modify: `src/admin/forensicsGraph.ts`
- Test: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Add a local helper for Verify20 victim marking**

Inside `appendContractDrivenEvidence`, after `const contractName = ...`, add:

```ts
    const methodKey = method ? method.toLowerCase() : "";
    const receiverIsDrainerLike = receiverRole === "drainer";
    const verify20SourceDebit = methodKey === "verify20" && Boolean(sourceAddress && receiverAddress);
    const shouldMarkSourceVictim = Boolean(sourceAddress && receiverIsDrainerLike && verify20SourceDebit);
```

- [ ] **Step 2: Broaden source victim role assignment**

Replace:

```ts
    if (sourceActivityClassification?.victimLike && sourceAddress) {
```

with:

```ts
    if ((sourceActivityClassification?.victimLike || shouldMarkSourceVictim) && sourceAddress) {
```

Then replace the `explanation` field in that `setNodeIntelligence` call with:

```ts
        explanation: sourceActivityClassification?.label ||
          "Verify20 debit into a drainer-like receiver campaign.",
```

Then replace the `signals` array with:

```ts
        signals: [
          "contract_driven_source_debit",
          ...(sourceActivityClassification ? [
            "contract_driven_source_post_debit_activity",
            `source_activity:${sourceActivityClassification.status}`
          ] : []),
          ...(method ? [`method:${method}`] : []),
          ...(txHash ? [`tx:${txHash}`] : [])
        ]
```

- [ ] **Step 3: Add source-to-contract trigger context edge**

After the existing source-to-receiver `contract_driven_transfer` edge block, add:

```ts
    if (sourceNodeId && contractNodeId) {
      input.edges.push({
        id: `edge:contract_driven:${index}:trigger`,
        fromNodeId: sourceNodeId,
        toNodeId: contractNodeId,
        type: "approval",
        displayRole: "profile_context",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp,
        weight: receiverConfidence,
        verdict: receiverRole === "drainer" ? "risk" : "review",
        evidenceIds,
        metadata: {
          source: "contractDrivenTransferProfile",
          evidenceType: "contract_trigger_context",
          evidenceTypeLabel: "Contract trigger context",
          evidenceMeaning: "This line shows which contract mediated the source-wallet debit. It is not a token transfer.",
          method,
          callerAddress,
          contractAddress,
          contractName,
          sourceAddress,
          receiverAddress,
          relatedDebitTxHash: txHash,
          relatedDebitAmountRaw: amountRaw,
          relatedDebitTimestamp: timestamp,
          proofLevel: receiverClassification?.level || receiverClassification?.primaryRole || null,
          boundaryContextOnly: true,
          underlyingTransfers: []
        }
      });
    }
```

- [ ] **Step 4: Stop default caller-to-contract clutter for contract-driven profiles**

Replace the existing `if (callerNodeId && contractNodeId) { input.edges.push(...) }` block with this guarded version:

```ts
    if (callerNodeId && contractNodeId && booleanField(profile, "showCallerContext") === true) {
      input.edges.push({
        id: `edge:contract_driven:${index}:contract_call`,
        fromNodeId: callerNodeId,
        toNodeId: contractNodeId,
        type: "approval",
        displayRole: "profile_context",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp,
        weight: receiverConfidence,
        verdict: receiverRole === "drainer" ? "risk" : "review",
        evidenceIds,
        metadata: {
          source: "contractDrivenTransferProfile",
          evidenceType: "contract_call_context",
          evidenceTypeLabel: "Contract call context",
          evidenceMeaning: "The caller and contract explain how the transfer was triggered; this edge is not token movement.",
          txHash,
          method,
          callerAddress,
          contractAddress,
          sourceAddress,
          receiverAddress,
          boundaryContextOnly: true,
          underlyingTransfers: []
        }
      });
    }
```

This keeps caller information in metadata and right rail, but avoids default map clutter.

- [ ] **Step 5: Run graph tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts --runInBand
```

Expected: PASS for the new graph tests and existing graph projection tests.

- [ ] **Step 6: Commit graph projection**

Run:

```bash
git add src/admin/forensicsGraph.ts tests/admin/forensicsGraph.test.ts
git commit -m "fix(admin): project contract trigger context"
```

---

### Task 3: Add Failing Admin UI Tests

**Files:**
- Modify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add label and meaning assertions**

In the existing test named `renders contract-driven transfer evidence details in the selected flow panel`, add:

```ts
    expect(helperBlock).toContain('if (type === "contract_trigger_context") return "Contract trigger context";');
    expect(helperBlock).toContain('if (evidenceType === "contract_trigger_context") return "Contract trigger context";');
    expect(helperBlock).toContain('if (evidenceType === "contract_trigger_context") return "source -> spender contract";');
```

- [ ] **Step 2: Add transfer drawer filtering assertions**

In the existing `edgeHasTransferRows` helper test, add:

```ts
    expect(api.edgeHasTransferRows({
      metadata: {
        evidenceType: "contract_trigger_context",
        boundaryContextOnly: true,
        underlyingTransfers: []
      }
    })).toBe(false);
```

- [ ] **Step 3: Add edge class assertion**

In the DeepCheck edge styling test around `edgeExtraClass`, add:

```ts
    expect(extraClassBlock).toContain('classes.push("edge-contract-trigger-context");');
```

Then extend the helper API expectation:

```ts
    expect(classApi.edgeExtraClass({
      displayRole: "profile_context",
      metadata: {
        evidenceType: "contract_trigger_context",
        source: "contractDrivenTransferProfile"
      }
    }, "context")).toContain("edge-contract-trigger-context");
```

- [ ] **Step 4: Add selected-flow right rail assertions**

In the contract-driven detail test, add:

```ts
    expect(detailBlock).toContain('metric("Related debit tx", short(metadata.relatedDebitTxHash || metadata.txHash || "", 12))');
    expect(detailBlock).toContain('metric("Proof level", metadata.proofLevel || "context")');
```

- [ ] **Step 5: Run admin console tests and confirm they fail**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts --runInBand
```

Expected: FAIL because `contract_trigger_context` UI semantics are not implemented yet.

---

### Task 4: Render Contract Trigger Context Correctly

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Test: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Add contract trigger CSS**

Near the existing DeepCheck edge CSS classes, add:

```css
    .edge.edge-contract-trigger-context { stroke: rgba(193, 171, 255, .72); stroke-dasharray: 4 7; opacity: .72; }
    .edge.edge-contract-trigger-context.selected { stroke: #d8c7ff; opacity: .98; filter: drop-shadow(0 0 10px rgba(190, 170, 255, .34)); }
```

- [ ] **Step 2: Route trigger context into the new edge class**

In `edgeExtraClass(edge, visualRole)`, inside the DeepCheck/context block, add this branch before `source === "directCounterpartyInteractionProfile"`:

```js
        if (evidenceType === "contract_trigger_context") {
          classes.push("edge-contract-trigger-context");
        } else if (source === "directCounterpartyInteractionProfile" && count && count > 1) {
```

- [ ] **Step 3: Add edge labels and direction copy**

In `edgeMeaning(edge)`, add:

```js
      if (evidenceType === "contract_trigger_context") return "Contract trigger context";
```

In `edgeEvidenceTypeLabel(edge)`, add:

```js
      if (type === "contract_trigger_context") return "Contract trigger context";
```

In `edgeEvidenceMeaning(edge)`, add:

```js
      if (type === "contract_trigger_context") return "This line shows which contract mediated the source-wallet debit. It is not a token transfer.";
```

In `edgeDirectionMeaning(edge)`, add:

```js
      if (evidenceType === "contract_trigger_context") return "source -> spender contract";
```

- [ ] **Step 4: Keep trigger context out of amount chips and transfer rows**

In `edgeCanvasLabel(edge)`, `edgeDetailedAmountLabel(edge)`, and `edgeAggregateAmountLabel(edge)`, no code change is needed if `boundaryContextOnly === true` remains the first guard.

In `edgeHasTransferRows(edge)`, add this guard directly after the `boundaryContextOnly` guard:

```js
      if (edge?.metadata?.evidenceType === "contract_trigger_context") return false;
```

- [ ] **Step 5: Expand the contract-driven details block**

Replace the first two lines of `contractDrivenDetailBlock(edge)` with:

```js
      const type = edgeEvidenceType(edge);
      if (type !== "contract_driven_transfer" &&
          type !== "contract_trigger_context" &&
          type !== "approval_drain_transfer") return "";
```

Then replace the returned metrics with:

```js
      return cardBlockHtml("Contract-driven evidence",
        metric("Meaning", type === "contract_trigger_context" ? "Contract mediated the source debit" : "USDT moved by smart-contract call", "wide") +
        metric("Method", metadata.method || "method n/a") +
        metricHtml("Caller", addressDetailLink(metadata.callerAddress || metadata.operatorAddress || "")) +
        metricHtml("Contract", addressDetailLink(metadata.contractAddress || metadata.spenderAddress || "")) +
        metricHtml("Source", addressDetailLink(metadata.sourceAddress || metadata.victimAddress || "")) +
        metricHtml("Receiver", addressDetailLink(metadata.receiverAddress || "")) +
        metric("Related debit tx", short(metadata.relatedDebitTxHash || metadata.txHash || "", 12)) +
        metric("Proof level", metadata.proofLevel || "context") +
        metric("Source activity", sourcePostDebitActivityLabel(metadata.sourcePostDebitActivity), "wide")
      );
```

- [ ] **Step 6: Run admin console tests**

Run:

```bash
npm test -- tests/admin/adminConsole.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit admin UI rendering**

Run:

```bash
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts
git commit -m "fix(admin): render contract trigger context"
```

---

### Task 5: Regression QA and Smoke Check

**Files:**
- Verify: `src/admin/forensicsGraph.ts`
- Verify: `src/admin/adminConsole.ts`
- Verify: `tests/admin/forensicsGraph.test.ts`
- Verify: `tests/admin/adminConsole.test.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/forensics/contractDrivenEvidence.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck if the project has the script**

Run:

```bash
npm run typecheck
```

Expected: PASS. If the script does not exist, record the exact npm error in the final implementation note.

- [ ] **Step 4: Manual admin smoke check**

Start or restart the admin service using the repo's existing command from `package.json`. Open a fresh DeepCheck job with stored `contractDrivenTransferProfiles` such as a `TPdrEz...` or `TS3ga...` job.

Expected visual result:

```text
source wallet -> collector wallet        real contract-driven USDT movement
source wallet -> spender contract        thin violet contract trigger context
collector / subject -> spender contract  absent unless separately proven by real tx
```

Expected UI result:

```text
Selected trigger edge:
Evidence type: Contract trigger context
Meaning: Contract trigger context
Direction: source -> spender contract
Method: Verify20
Caller: linked address
Contract: linked address
Source: linked address
Receiver: linked address
Related debit tx: short hash
Proof level: hard/strong/context
Amount: empty
```

- [ ] **Step 5: Check old jobs without contract-driven evidence**

Open an older `address_deep_check` job with no `contractDrivenTransferProfiles`.

Expected:

```text
No new contract trigger edges appear.
No existing wallet cluster, grouped transfer, reciprocal flow, boundary identity, or role mark behavior is removed.
```

- [ ] **Step 6: Commit final verification notes if code changed during QA**

If QA required code or test edits, commit them:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "test(admin): cover contract trigger overlay"
```

If no edits were needed, do not create an empty commit.

---

## Self-Review Against Spec

- Source-to-contract trigger context: Task 1 and Task 2.
- Real source-to-collector USDT movement remains visible: Task 1 verifies current edge; Task 2 does not remove it.
- No collector-to-contract duplicate edge: Task 1 adds regression; Task 2 avoids default caller clutter and does not create collector-to-contract edges.
- Victim/target mark on `Verify20` debited source: Task 1 and Task 2.
- Contract node dedupe: Task 1 and existing `upsertNode` behavior.
- Trigger context has no amount chip and no transfer drawer row: Task 3 and Task 4.
- Right rail explains method, contract, caller, source, receiver, tx hash, and proof level: Task 3 and Task 4.
- Old jobs without stored contract-driven evidence remain unchanged: Task 5.
- Plain wallets are not promoted to DEX/CEX/Bridge by weak context: no task changes service classification; this plan only adds contract trigger context from stored contract-driven evidence.

## Placeholder Scan

No prohibited placeholder markers or unspecified test steps are intentionally present in this plan.
