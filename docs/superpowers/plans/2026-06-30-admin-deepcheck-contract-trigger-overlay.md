# Admin DeepCheck Contract Trigger Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepCheck render smart-contract-driven top-ups as a truthful evidence map: source wallets stay wallets, the real spender/contract is visible as its own node, and the subject/collector is connected through that contract instead of a fake ordinary wallet-to-wallet transfer.

**Architecture:** Keep the existing vanilla TypeScript admin graph. Use existing `contractDrivenTransferProfiles` as the source of truth. Change only the graph projection, admin UI labels/classes/details, and focused tests. No new frontend framework, no new dependencies, no new icon set.

**Tech Stack:** TypeScript, Vitest, existing admin SVG/HTML renderer in `src/admin/adminConsole.ts`, graph projection in `src/admin/forensicsGraph.ts`, existing forensic result producers.

---

## Current Bug

DeepCheck currently has enough data to know that a token movement was contract-driven, for example:

```text
source wallet --(contract call / Verify20)--> spender contract --(USDT transfer event)--> subject collector
```

But the map can still show it as if it were an ordinary transfer:

```text
source wallet --gray/normal wallet transfer--> subject collector
```

That is misleading. The approved rule is:

```text
Normal wallet transfer only:
source wallet -> subject / counterparty

Contract-driven transfer:
source wallet -> spender contract -> subject / collector
```

Gray dashed wallet-to-wallet lines are allowed only for normal physical wallet transfers. If the transaction was triggered by a smart contract, do not draw a direct source-wallet-to-subject line.

## Files

- Modify: `src/admin/forensicsGraph.ts`
  - Route `contract_driven_transfer` from the real contract node to the receiver node.
  - Keep source wallets as `wallet`, never as fake `Contract`.
  - Keep `contract_trigger_context` from source wallet to spender contract.
  - Deduplicate duplicate contract-driven profiles.
  - Preserve underlying source/receiver/tx metadata for right rail and transfer drawer.

- Modify: `src/admin/adminConsole.ts`
  - Update labels/copy so contract-driven edges say what happened.
  - Style source-to-contract context differently from normal wallet transfers.
  - Show source wallet, spender contract, receiver, method, tx, amount, and time in the right rail/drawer.
  - Do not render contract trigger context as a transfer row.

- Modify: `tests/admin/forensicsGraph.test.ts`
  - Add/adjust graph projection tests around `contractDrivenTransferProfiles`.

- Modify: `tests/admin/adminConsole.test.ts`
  - Add/adjust HTML helper tests for labels, classes, selected flow details, and transfer drawer behavior.

- Verify, modify only if tests prove a producer gap:
  - `src/check/deepForensicCheck.ts`
  - `src/check/whereIsMoneyCheck.ts`
  - `src/forensics/contractDrivenEvidence.ts`
  - `tests/forensics/contractDrivenEvidence.test.ts`

## Non-Negotiable Rules

- Do not create new visual role icons. Use existing drainer/victim/collector/mule marks.
- Do not classify a wallet as `Contract` just because it appears in `contractDrivenTransferProfiles`.
- Do not draw direct source-wallet-to-subject lines for `contract_driven_transfer`.
- Do not draw `subject -> contract` unless a separate real transaction proves that direction.
- Single tx is never a group.
- `Verify20` is not globally "always drainer"; it becomes `likely drainer` only with receiver campaign evidence, no known service identity, repeated sources, and/or exact approval-drain proof.
- `permitTransfer` and `transferFrom` remain context-sensitive; do not mark them as drainer only by method name.

---

## Task 1: Lock The Desired Graph Shape With Tests

**Files:**
- `tests/admin/forensicsGraph.test.ts`

- [ ] Update the existing contract-driven test that currently expects a transfer edge from victim/source to subject.

Expected assertions:

```ts
expect(result.graph.edges.some((edge) =>
  edge.fromNodeId === `addr:${victim}` &&
  edge.toNodeId === `addr:${subject}` &&
  edge.metadata.evidenceType === "contract_driven_transfer"
)).toBe(false);
```

```ts
const contractTransferEdge = result.graph.edges.find((edge) =>
  edge.fromNodeId === `addr:${contract}` &&
  edge.toNodeId === `addr:${subject}` &&
  edge.metadata.evidenceType === "contract_driven_transfer"
);

expect(contractTransferEdge).toMatchObject({
  type: "transfer",
  txHash,
  amountRaw: "9370000000",
  metadata: {
    source: "contractDrivenTransferProfile",
    evidenceType: "contract_driven_transfer",
    method: "Verify20",
    contractAddress: contract,
    sourceAddress: victim,
    receiverAddress: subject,
    underlyingTransfers: [
      expect.objectContaining({
        txHash,
        sourceAddress: victim,
        receiverAddress: subject,
        contractAddress: contract
      })
    ]
  }
});
```

```ts
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
    boundaryContextOnly: true,
    relatedDebitTxHash: txHash,
    relatedDebitAmountRaw: "9370000000"
  }
});
```

- [ ] Add a regression test for a source wallet that has text/metadata containing contract-driven data but must remain a wallet:

```ts
expect(result.graph.nodes.find((node) => node.address === victim)).toMatchObject({
  kind: "wallet",
  displayKind: "wallet"
});

expect(result.graph.nodes.find((node) => node.address === contract)).toMatchObject({
  kind: "contract",
  displayKind: "smart_contract"
});
```

- [ ] Add a duplicate-profile guard test.

Input: two identical `contractDrivenTransferProfiles` with same `txHash`, `sourceAddress`, `receiverAddress`, `contractAddress`, `method`, `amountRaw`.

Expected:

```ts
expect(result.graph.edges.filter((edge) =>
  edge.metadata.evidenceType === "contract_driven_transfer" &&
  edge.metadata.txHash === txHash
)).toHaveLength(1);
```

- [ ] Add a breadth test for repeated Verify20 sources.

Input: three different source wallets, same spender contract, same receiver.

Expected:

```ts
expect(result.graph.edges.filter((edge) =>
  edge.toNodeId === `addr:${contract}` &&
  edge.metadata.evidenceType === "contract_trigger_context"
)).toHaveLength(3);
```

And:

```ts
expect(result.graph.edges.filter((edge) =>
  edge.fromNodeId === `addr:${contract}` &&
  edge.toNodeId === `addr:${subject}` &&
  edge.metadata.evidenceType === "contract_driven_transfer"
).length).toBeGreaterThan(0);
```

- [ ] Run focused graph tests and confirm the new/changed expectations fail before implementation:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

---

## Task 2: Change Contract-Driven Graph Projection

**Files:**
- `src/admin/forensicsGraph.ts`
- `tests/admin/forensicsGraph.test.ts`

- [ ] Add a local dedupe set inside the `contractDrivenTransferProfiles` projection loop.

Use this exact key shape:

```ts
const contractDrivenProfileKey = [
  txHash,
  sourceAddress,
  receiverAddress,
  contractAddress,
  method,
  amountRaw,
  timestamp
].join("|");
```

Skip the profile if the key was already seen.

- [ ] Keep the existing source node as:

```ts
input.upsertNode(sourceAddress, sourceAddress === input.subjectAddress ? "subject" : "wallet", ...)
```

Do not change source nodes to `contract`.

- [ ] Replace the visible contract-driven transfer route.

Change the current `contract_driven_transfer` edge from:

```ts
fromNodeId: sourceNodeId,
toNodeId: receiverNodeId,
```

to:

```ts
fromNodeId: contractNodeId,
toNodeId: receiverNodeId,
```

Only create this edge when both `contractNodeId` and `receiverNodeId` exist.

- [ ] Preserve the underlying token movement in metadata.

The edge metadata must still contain:

```ts
{
  sourceAddress,
  receiverAddress,
  contractAddress,
  callerAddress,
  method,
  txHash,
  aggregateAmountRaw: amountRaw,
  aggregateTransferCount: 1,
  underlyingTransfers: [{
    txHash,
    amountRaw,
    amount: stringField(profile, "amount"),
    timestamp,
    method,
    callerAddress,
    contractAddress,
    sourceAddress,
    receiverAddress,
    role: "contract_driven_transfer"
  }]
}
```

- [ ] Keep source-to-contract trigger context.

The existing `contract_trigger_context` edge must remain:

```text
source wallet -> spender contract
```

It must stay context only:

```ts
amountRaw: null,
txHash: null,
metadata: {
  evidenceType: "contract_trigger_context",
  boundaryContextOnly: true,
  relatedDebitTxHash: txHash,
  relatedDebitAmountRaw: amountRaw
}
```

- [ ] Keep caller/operator nodes hidden by default.

Only create caller/operator-to-contract context if `showCallerContext === true`.

- [ ] Run:

```bash
npm test -- tests/admin/forensicsGraph.test.ts
```

Expected: graph tests pass.

---

## Task 3: Update Admin UI Semantics

**Files:**
- `src/admin/adminConsole.ts`
- `tests/admin/adminConsole.test.ts`

- [ ] Update selected-flow direction copy.

Current copy to replace:

```js
if (evidenceType === "contract_driven_transfer") return "source -> receiver";
```

New copy:

```js
if (evidenceType === "contract_driven_transfer") return "spender contract -> receiver";
```

Keep:

```js
if (evidenceType === "contract_trigger_context") return "source -> spender contract";
```

- [ ] Update the selected-flow meaning for `contract_driven_transfer`.

Use concise English copy:

```text
USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.
```

- [ ] Update edge styling rules.

Required semantics:

```text
contract_trigger_context: thin violet dashed context edge
contract_driven_transfer: visible contract-to-receiver transfer edge with amount/time
normal wallet transfer: gray dashed wallet-to-wallet edge
```

Do not reuse gray wallet-transfer styling for contract-driven scenes.

- [ ] Ensure `edgeHasTransferRows` returns `false` for `contract_trigger_context`.

Expected test:

```ts
expect(api.edgeHasTransferRows({
  metadata: {
    evidenceType: "contract_trigger_context",
    boundaryContextOnly: true,
    underlyingTransfers: []
  }
})).toBe(false);
```

- [ ] Ensure `edgeHasTransferRows` returns `true` for `contract_driven_transfer` when `underlyingTransfers` exists.

Expected test:

```ts
expect(api.edgeHasTransferRows({
  metadata: {
    evidenceType: "contract_driven_transfer",
    underlyingTransfers: [{ txHash: "tx1" }]
  }
})).toBe(true);
```

- [ ] Update right-rail details for `contract_driven_transfer`.

The selected-flow panel must include:

```text
Source wallet
Spender contract
Receiver
Method
Caller / operator
Tx
Amount
Time
```

- [ ] Use human-readable time everywhere in admin detail panels.

Examples:

```text
Jun 23, 13:17 UTC
2025 Jul 22, 09:41 UTC
```

Do not show raw ISO time in newly touched contract-driven evidence blocks.

- [ ] Run:

```bash
npm test -- tests/admin/adminConsole.test.ts
```

Expected: admin console tests pass.

---

## Task 4: Verify Producer Coverage For Many Contract-Driven Inputs

**Files:**
- `src/check/deepForensicCheck.ts`
- `src/check/whereIsMoneyCheck.ts`
- `src/forensics/contractDrivenEvidence.ts`
- `tests/forensics/contractDrivenEvidence.test.ts`

- [ ] Inspect where `contractDrivenTransferProfiles` is built for DeepCheck and Where Is Money.

Confirm this invariant:

```text
Every detected contract-driven incoming transfer that survives job limits is saved as a contractDrivenTransferProfiles[] item.
```

- [ ] Add or update a producer test with multiple Verify20 incoming transfers.

Input:

```text
source A -> VerifyAccount contract -> receiver
source B -> same VerifyAccount contract -> receiver
source C -> same VerifyAccount contract -> receiver
```

Expected:

```ts
expect(result.contractDrivenTransferProfiles).toHaveLength(3);
expect(result.contractDrivenTransferProfiles.map((profile) => profile.sourceAddress)).toEqual([
  sourceA,
  sourceB,
  sourceC
]);
```

- [ ] If the producer currently stores only selected/material examples, keep that limit explicit in metadata.

Required metadata/copy if limited:

```text
contractDrivenTransferProfilesShown
contractDrivenTransferProfilesTotal
contractDrivenTransferProfileLimitReason
```

Do not silently show 2 examples when 160 were detected.

- [ ] Run:

```bash
npm test -- tests/forensics/contractDrivenEvidence.test.ts
```

Expected: producer/evidence tests pass.

---

## Task 5: QA The User-Reported Cases

**Manual data cases:**

- `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE`
- `TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf`
- tx `b424fdec203c31c043933f64e3c5d3bf85c9bc70721fd84101b6a3cd39f250e7`
- tx `c9589d85d63e9913a22045691b19374bbdfaf90b1b17c88bf5b9c780bfba8484`

- [ ] Start admin locally from the current branch.

Use the project's existing admin start command already used in this repo. If there is a running stale process, stop it and start a fresh one from the current `master` worktree.

- [ ] Open `/admin/forensics`.

- [ ] Run or select a fresh DeepCheck job for `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE`.

- [ ] Confirm visually:

```text
Victim/source wallet nodes remain wallet nodes.
Real spender contracts appear as contract nodes.
Contract-driven top-ups route source wallet -> contract -> TPdrEz.
There is no gray direct source wallet -> TPdrEz line for those txs.
The drainer icon remains on TPdrEz when evidence supports it.
Victim/target marks appear on Verify20 debited source wallets when campaign evidence supports it.
Single tx remains single, not grouped.
Repeated tx through same spender may group only when same direction/evidence/episode.
```

- [ ] Click a contract-to-receiver transfer edge.

Right rail must show:

```text
Source wallet
Spender contract
Receiver
Method Verify20
Tx link to Tronscan
Amount
Time
```

- [ ] Click a source-to-contract trigger context edge.

Right rail must explain this is trigger/spender authority context and must not present it as a USDT transfer.

- [ ] Click `Expand selected`.

Transfer drawer must:

```text
open with a close button;
show human-readable time;
show tx gap where available;
show tx links;
not show contract_trigger_context as transfer rows.
```

---

## Task 6: Full Verification And Commit

- [ ] Run focused tests:

```bash
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/forensics/contractDrivenEvidence.test.ts
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

- [ ] Run full test suite:

```bash
npm test
```

- [ ] Review diff:

```bash
git diff -- src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/forensics/contractDrivenEvidence.test.ts
git status --short
```

- [ ] Commit implementation separately from the already approved spec:

```bash
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/forensics/contractDrivenEvidence.test.ts
git commit -m "fix(admin): route contract-driven transfers through spender contracts"
```

- [ ] Push `master` after tests pass:

```bash
git push origin master
```

---

## Rollback

If the graph becomes unreadable or old jobs break, revert only the implementation commit:

```bash
git revert <implementation-commit-sha>
```

The spec commit can remain because it documents the intended product behavior.
