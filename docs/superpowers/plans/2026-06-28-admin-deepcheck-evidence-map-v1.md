# Admin DeepCheck Evidence Map v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `address_deep_check` render as an evidence map: real transfers are shown as money flow, contract-driven transfers are shown as contract scenes, context-only boundaries are not drawn as transfers, and every important node/edge explains its role, local risk, and source of evidence.

**Architecture:** Keep the existing vanilla TypeScript admin graph. Normalize evidence in `src/admin/forensicsGraph.ts`, render labels and right-rail explanations in `src/admin/adminConsole.ts`, keep server/auth behavior unchanged, and cover every semantic rule with focused Vitest tests.

**Tech Stack:** TypeScript, Vitest, existing SVG/HTML admin console, existing role icon assets, existing Postgres-backed forensic job payloads.

---

## Current Baseline

The local `master` branch already contains the first contract-scene baseline:

- `src/admin/forensicsGraph.ts` can project exact approval-drain provenance into caller, contract, victim, and receiver nodes.
- `src/admin/adminConsole.ts` has labels for `Contract called`, `Debit authority`, and contract-driven USDT movement.
- Tests exist for approval-drain scene projection and console copy.

This plan completes the product behavior around that baseline.

---

## Files To Touch

Primary implementation:

- `src/admin/forensicsGraph.ts`
- `src/admin/adminConsole.ts`

Likely tests:

- `tests/admin/forensicsGraph.test.ts`
- `tests/admin/adminConsole.test.ts`

Optional only if existing icon asset routing needs a regression check:

- `tests/admin/adminServer.test.ts`

Documentation updates after implementation:

- `docs/superpowers/specs/2026-06-28-admin-deepcheck-evidence-map-v1-design.md`

No new runtime dependency is needed.

---

## Task 1 - Preflight And Fixture Inventory

- [ ] Run status and baseline tests:

```powershell
git status --short --branch
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Expected result:

- branch is clean before editing;
- focused admin tests pass before changes;
- typecheck passes.

- [ ] Identify fixtures/jobs that represent these cases:
  - exact approval-drain provenance;
  - smart-contract-driven transfer without stored approval proof;
  - grouped boundary evidence with tx count and amount;
  - context-only boundary with no tx/group evidence;
  - multi-hop wallet chain;
  - ordinary neighbor with no local risk evidence.

Expected result:

- each fixture has a short comment in the relevant test describing the case it protects;
- no production code is changed in this task.

Commit after task:

```powershell
git add tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "test: document deepcheck evidence map fixtures"
```

---

## Task 2 - Stop Drawing Context-Only Boundaries As Money Flow

Problem:

Context-only boundary edges can look like real transfers. If an edge has no direct tx and no grouped tx evidence, the graph should not present it as money flow.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, add or tighten a single helper that answers:

```ts
isStoredMoneyEvidence(edge): boolean
```

The helper returns true only when the edge has at least one of:

- direct transaction hash;
- stored underlying transaction list;
- grouped tx count plus aggregate amount;
- a transfer event from contract-driven evidence.

- [ ] Use the helper before creating or promoting DeepCheck boundary/context edges into visible money-flow edges.

- [ ] Preserve boundary nodes and right-rail context when useful, but do not draw the relationship as a transfer if the helper returns false.

- [ ] In `src/admin/adminConsole.ts`, make context-only boundary right-rail copy explicit:

```text
Investigation boundary only.
No money-flow edge is stored for this relationship.
```

Tests:

- [ ] Add a graph test where `deepExpansionBoundaryStop` has no tx/group evidence and assert no money-flow edge is projected.
- [ ] Add a console test that the right rail does not show `amount n/a` as the primary explanation for context-only boundary evidence.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "fix: hide context-only deepcheck boundary flows"
```

---

## Task 3 - Show Grouped Boundary Evidence Instead Of `amount n/a`

Problem:

Some service/CEX/bridge/context relationships are not a single direct transfer, but they do have grouped evidence. The graph should show what is known: tx count, aggregate amount, period, connected wallets, and underlying transactions when stored.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, normalize grouped boundary data into one metadata shape:

```ts
groupedEvidence: {
  txCount: number;
  amountRaw?: string;
  amountText?: string;
  firstSeen?: string;
  lastSeen?: string;
  connectedWallets?: string[];
  underlyingTransfers?: Array<{
    txHash?: string;
    from?: string;
    to?: string;
    amountRaw?: string;
    amountText?: string;
    timestamp?: string;
  }>;
}
```

- [ ] Reuse existing boundary summary helpers where possible. Do not add a parallel abstraction if the current helper can be tightened.

- [ ] In `src/admin/adminConsole.ts`, label grouped evidence as:

```text
8 tx · 1.28M USDT
```

or, if amount is missing:

```text
8 tx
```

- [ ] In the right rail, show:
  - evidence type: `Grouped boundary evidence`;
  - tx count;
  - total amount when stored;
  - first/last seen when stored;
  - underlying tx list when stored;
  - clear text that this is grouped evidence, not one direct transfer.

Tests:

- [ ] Existing grouped evidence tests should assert no `amount n/a`.
- [ ] Add a test that grouped evidence with `txCount` and `volumeRaw` renders the tx count and amount.
- [ ] Add a test that grouped evidence without stored tx list still explains that detailed tx rows are not stored.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "fix: show grouped deepcheck boundary evidence"
```

---

## Task 4 - Harden Contract-Driven Transfer Semantics

Problem:

The same on-chain transaction can contain a smart-contract call and a real token transfer. The graph must not make it look like a normal manual wallet send.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, split contract-driven evidence into three proof levels:
  - `exact_approval_drain`: approval/spender evidence is present;
  - `contract_driven_transfer`: token event proves contract-driven transfer, approval proof is not stored;
  - `contract_mediated_context`: contract and token context exist but are incomplete.

- [ ] Keep exact proof strict. A method name like `Verify20`, verified contract status, or successful tx status must not by itself create a drainer role.

- [ ] Preserve these fields when available:
  - tx hash;
  - caller/operator;
  - called contract;
  - method;
  - token event from;
  - token event to;
  - amount;
  - timestamp;
  - approval/spender evidence source.

- [ ] In `src/admin/adminConsole.ts`, right-rail copy should use:

```text
Contract-driven USDT transfer
USDT was moved by a smart-contract call, not by a normal wallet send.
```

- [ ] Do not write `not USDT flow` on the graph.

Tests:

- [ ] Exact approval-drain keeps drainer/victim/collector roles.
- [ ] Contract-driven transfer without approval proof does not claim exact approval-drain.
- [ ] Generic method name alone does not create a drainer role.
- [ ] Contract call edge and debit authority edge are not rendered as token money movement.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "fix: clarify contract-driven deepcheck transfers"
```

---

## Task 5 - Use Approved Role Icons And Fix Role Priority

Problem:

Role marks must use only the approved icons and must appear inside the address circle. Neighbor nodes must not inherit the subject role or subject risk.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, normalize node role metadata into:

```ts
nodeIntelligence: {
  primaryRole: "drainer" | "victim" | "collector" | "mule_transit" | "service_boundary" | "unknown";
  secondaryRoles: string[];
  localRisk?: number;
  riskScope?: string;
  evidenceStrength?: "hard" | "behavior" | "context" | "unknown";
  reason?: string;
  sourceMode?: string;
}
```

- [ ] Keep role priority:
  1. drainer;
  2. victim;
  3. collector;
  4. mule/transit;
  5. service/boundary;
  6. unknown wallet.

- [ ] In `src/admin/adminConsole.ts`, map roles to existing approved icons only:
  - drainer: skull/crossbones;
  - victim: red target;
  - collector: purple diamond;
  - mule/transit: black mule.

- [ ] Keep operator/caller as event role by default:
  - no new icon;
  - small `caller` badge or right-rail role line;
  - drainer icon only if hard evidence supports it.

- [ ] If an icon cannot be shown inside a small node without breaking readability, hide the icon at small zoom and keep it visible in selected-node zoom/right rail.

Tests:

- [ ] Node with drainer and collector roles shows drainer as primary and collector as secondary.
- [ ] Victim role does not imply bad actor risk.
- [ ] Operator/caller does not receive drainer icon without hard evidence.
- [ ] Subject risk is not copied to ordinary neighbors.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts tests/admin/adminServer.test.ts
git commit -m "fix: render approved deepcheck role marks"
```

---

## Task 6 - Add Important Neighbor Profile Fields Without Running FastCheck

Problem:

DeepCheck should explain important neighboring wallets when data exists, but v1 must not automatically launch FastCheck for every neighbor.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, attach stored neighbor profile fields when already present in the job payload:
  - blacklist/frozen status;
  - role evidence;
  - local risk;
  - confidence;
  - service exposure;
  - amount share;
  - freshness;
  - hop distance;
  - relationship type;
  - source mode.

- [ ] If a field is missing, store that as missing/unknown. Do not infer a clean result.

- [ ] In `src/admin/adminConsole.ts`, right rail should show:

```text
Local risk: unknown
Why: connected by observed transfer; no local risk evidence stored.
Source: DeepCheck
Scope: observed graph
```

or, when available:

```text
Local risk: 72
Why: collector-like behavior; 46% of observed amount passed through within 40 minutes.
Source: DeepCheck
Scope: observed graph
```

Tests:

- [ ] Important neighbor with stored local risk renders local risk and reason.
- [ ] Important neighbor without stored local risk renders unknown, not subject final risk.
- [ ] Missing FastCheck profile is shown as not checked/stored, not clean.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat: explain deepcheck neighbor profiles"
```

---

## Task 7 - Improve DeepCheck Multi-Step Default Layout

Problem:

DeepCheck should show real chains and clusters, not only a one-hop star around the subject.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, preserve multi-hop paths when source data has them:

```text
A -> B -> C -> subject
```

must stay as:

```text
A -> B -> C -> subject
```

- [ ] In `src/admin/adminConsole.ts`, make default DeepCheck layout prefer:
  - ordinary wallets in the main chain area;
  - boundaries/services separated to the side;
  - peer links thin and contextual;
  - groups expandable;
  - selected path prominent;
  - labels only where they help in default mode.

- [ ] Keep `Show all raw` as the full noisy mode.

- [ ] Keep Incoming Deposit and Where Is Money layouts unchanged unless the shared helper fix is strictly semantic and already covered by tests.

Tests:

- [ ] Multi-hop chain remains multi-hop in graph projection.
- [ ] Boundary/service nodes are separated from ordinary wallet chain metadata.
- [ ] `Show all raw` still includes all projected raw nodes/edges.
- [ ] Incoming Deposit and Where Is Money snapshot-style tests still pass.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat: improve deepcheck evidence map layout"
```

---

## Task 8 - Add Drainer Campaign Summary When Repeated Evidence Exists

Problem:

If the same receiver, spender contract, or operator appears across several contract-driven events, the graph should summarize the pattern without hiding underlying tx details.

Implementation:

- [ ] In `src/admin/forensicsGraph.ts`, aggregate repeated contract-driven scenes by:
  - receiver;
  - spender contract;
  - operator/caller;
  - victim count;
  - tx count;
  - total amount;
  - first seen;
  - last seen.

- [ ] Store summary metadata on the receiver/collector node and related contract nodes.

- [ ] In `src/admin/adminConsole.ts`, right rail can show:

```text
Drainer campaign evidence
7 contract-driven transfers
7 victims
3 spender contracts
120K USDT total
```

- [ ] Keep underlying transaction links available when stored.

Tests:

- [ ] Repeated scenes produce a campaign summary.
- [ ] Mixed exact and non-exact events show split proof levels.
- [ ] Underlying tx details are not lost.

Commands:

```powershell
npm test -- tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
npm run typecheck
```

Commit after task:

```powershell
git add src/admin/forensicsGraph.ts src/admin/adminConsole.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
git commit -m "feat: summarize deepcheck drainer campaigns"
```

---

## Task 9 - Manual Admin QA

- [ ] Start the admin console from the repo state that includes the implementation:

```powershell
Start-Process -WindowStyle Hidden -FilePath powershell -ArgumentList "-NoProfile -Command npm run dev"
```

- [ ] Open the admin URL currently used by the local app.

- [ ] Check at least these historical cases:
  - `TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE` DeepCheck with approval-drain evidence;
  - a DeepCheck with grouped service/CEX boundary evidence;
  - a DeepCheck with context-only boundary stops;
  - a normal one-hop DeepCheck;
  - a dense DeepCheck with `Show all raw`.

Manual acceptance checklist:

- [ ] Contract-driven scene is readable.
- [ ] Victim, drainer, collector, mule/transit icons use approved assets only.
- [ ] Context-only boundaries are not shown as money transfers.
- [ ] Grouped evidence shows tx count and amount when stored.
- [ ] Right rail explains edge and node meaning in plain language.
- [ ] Neighbor risk does not copy subject final risk.
- [ ] `Show all raw` still works.
- [ ] Dense graph stays navigable with current zoom/pan behavior.

Commit only if QA requires code or test changes.

---

## Task 10 - Full Verification And Landing

Run:

```powershell
npm run typecheck
npm test
git status --short --branch
```

Expected result:

- typecheck passes;
- full test suite passes;
- worktree is clean after final commit;
- local `master` contains implementation commits.

Push only after the above passes:

```powershell
git push origin master
```

---

## Self-Review Checklist

- [ ] Every spec acceptance criterion has at least one implementation task.
- [ ] No task requires a new dependency.
- [ ] No task changes Incoming Deposit or Where Is Money layout unless protected by tests.
- [ ] No graph label says `not USDT flow`.
- [ ] No code path marks a contract as drainer from method name or verified status alone.
- [ ] No context-only boundary renders as money flow.
- [ ] No neighbor inherits the subject final risk by default.
- [ ] Role icons are limited to the approved four-icon set.
- [ ] FastCheck is not auto-run for every neighbor in v1.
- [ ] Full verification commands are listed and runnable.
