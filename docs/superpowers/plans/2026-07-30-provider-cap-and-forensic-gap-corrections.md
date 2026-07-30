# Provider Cap And Forensic Gap Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Unified from treating TronScan's 10,000-row provider window as account creation, formalize exact-red terminal disposition offline, and record the two remaining subject-service/cashflow-selector gaps without enabling new production policy.

**Architecture:** Keep the correctness patch narrow: the TronScan client exposes why a pinned window ended, and one pure adapter refuses `provider_range_capped` before it can become `reachedAccountCreation`. Add a separate pure adverse-disposition function with no production imports. Documentation records current behavior and the blocked designs; no service boundary, query selector, traversal routing, scoring, Telegram, PostgreSQL, Stage D, or `500 + 100` activation is added.

**Tech Stack:** TypeScript, Node.js, Vitest, existing TronScan pinned-page and Unified direct-history contracts.

---

## Scope fence

Allowed code paths:

- `src/tron/tronClient.ts`
- `src/unifiedCheck/providerHistoryCompletion.ts`
- `src/forensics/adversePathDisposition.ts`
- focused tests for those files
- current forensic specifications and knowledge pages 02, 04, 09, and 14

Forbidden in this plan:

- changing Unified traversal/frontier/task routing;
- enabling bounded subject-service mode;
- choosing or hard-coding the near-zero window/denominator;
- production cashflow integration;
- score, report, Telegram, Admin, PostgreSQL, migration, job, canary, rollout, Stage D, or `500 + 100` changes.

## Task 1: Distinguish provider-window exhaustion from account creation

**Files:**

- Modify: `src/tron/tronClient.ts`
- Create: `src/unifiedCheck/providerHistoryCompletion.ts`
- Modify: `src/index.ts`
- Test: `tests/tron/tronClient.test.ts`
- Create: `tests/unified-check/providerHistoryCompletion.test.ts`

- [ ] **Step 1: Write failing TronScan completion-reason tests**

Add assertions for three exact cases:

```ts
expect(ordinaryPage.completionReason).toBe("range_exhausted");
expect(underfilledSentinelPage.completionReason).toBe("provider_range_capped");
expect(fullPageAtTenThousand.completionReason).toBe("provider_range_capped");
```

The 200th-page fixture uses `start=9_950`, `limit=50`, `total=40_497`, and
`rangeTotal=10_000`. The underfilled fixture retains the existing six-row
sentinel behavior but must no longer imply account creation.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm.cmd test -- tests/tron/tronClient.test.ts
```

Expected: FAIL because `completionReason` does not exist.

- [ ] **Step 3: Add the minimum provider completion contract**

Extend `PinnedTronscanTransferPage` with:

```ts
completionReason: "more" | "range_exhausted" | "provider_range_capped";
```

Compute it once in `listRelatedTrc20TransferPagePinned`:

```ts
const completionReason = !metadataConsistent
  ? "more"
  : authoritativeRangeTotal !== null && authoritativeRangeTotal >= TRONSCAN_RANGE_TOTAL_CAP && (
      cappedWindowComplete || nextOffset >= authoritativeRangeTotal
    )
    ? "provider_range_capped"
    : authoritativeRangeTotal !== null && nextOffset >= authoritativeRangeTotal
      ? "range_exhausted"
      : "more";
```

Keep legacy `complete` as `completionReason !== "more"`; consumers that only
mean “this provider window ended” remain compatible.

- [ ] **Step 4: Write the failing Unified adapter tests**

The new pure adapter accepts the cached pinned-page projection and returns a
`DirectHistoryPage` only for `more` or `range_exhausted`:

```ts
expect(() => providerHistoryPage({
  cursor: "9950",
  provider: "tronscan",
  transfers: rows,
  nextOffset: 10_000,
  completionReason: "provider_range_capped",
  metadataConsistent: true
})).toThrow("unified_direct_history_provider_range_capped");
```

Also assert:

```ts
expect(providerHistoryPage(exhausted)).toMatchObject({
  nextCursor: null,
  reachedAccountCreation: true
});
expect(providerHistoryPage(more)).toMatchObject({
  nextCursor: "50",
  reachedAccountCreation: false
});
```

- [ ] **Step 5: Run RED**

Run:

```powershell
npm.cmd test -- tests/unified-check/providerHistoryCompletion.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement and wire the pure adapter**

Create `providerHistoryCompletion.ts` with one exported function. It validates
the completion enum, integer offset, provider, transfer array, and
`metadataConsistent === true`; `provider_range_capped` throws the stable error
above. `range_exhausted` is the only value that sets
`reachedAccountCreation=true`.

Persist `completionReason` inside the cached Unified provider-page payload and
read it back through the pure adapter in `src/index.ts`. An old cached payload
without the field fails closed as `unified_direct_history_cached_page_invalid`.

- [ ] **Step 7: Run GREEN and commit**

Run:

```powershell
npm.cmd test -- tests/tron/tronClient.test.ts tests/unified-check/providerHistoryCompletion.test.ts tests/unified-check/directHistory.test.ts tests/unified-check/productionDirectHistory.test.ts tests/unified-check/productionAddressHistory.test.ts
npm.cmd run typecheck
```

Expected: all selected tests and typecheck pass.

Commit only Task 1 files:

```powershell
git add -- src/tron/tronClient.ts src/unifiedCheck/providerHistoryCompletion.ts src/index.ts tests/tron/tronClient.test.ts tests/unified-check/providerHistoryCompletion.test.ts
git commit -m "fix: distinguish tronscan range cap from history exhaustion"
```

## Task 2: Formalize exact-red terminal disposition offline

**Files:**

- Create: `src/forensics/adversePathDisposition.ts`
- Create: `tests/forensics/adversePathDisposition.test.ts`

- [ ] **Step 1: Write failing table tests**

The wished-for API is a discriminated union matching the evidence purpose:

```ts
type AdversePathDispositionInputV1 =
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      purpose: "safety";
      evidenceKind: "exact_adverse_endpoint";
      authorityClass: ExactAdverseEndpointAuthorityClassV1;
      endpointBindingComplete: boolean;
    }
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      purpose: "selected_amount_relevance";
      evidenceKind: "exact_adverse_endpoint";
      authorityClass: ExactAdverseEndpointAuthorityClassV1;
      endpointBindingComplete: boolean;
      relevanceBindingComplete: boolean;
      knownIntermediateEventIds: readonly string[];
    }
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      purpose: "path_continuation";
      evidenceKind: "exact_bound_lead";
      authorityClass: ExactBoundLeadAuthorityClassV1;
      leadBindingComplete: boolean;
      continuationAddress: string;
      boundEventIds: readonly string[];
    }
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      purpose: "safety";
      evidenceKind: "unconfirmed_hint";
      authorityClass: UnconfirmedAdverseHintClassV1;
    };
```

The closed exact-endpoint set covers event-time blacklist, sanctions and
restricted endpoints, exact HTX, exact restricted exchange, tracked
drainer/collector, another confirmed harmful endpoint, and
`confirmed_verify20_usdt_scene`. The closed exact-lead set covers confirmed
approval, transferFrom, proxy, drainer-pattern and Verify-like leads. The hint
set contains `verify20_method_name_only` and `unconfirmed_pattern`.

Expected outcomes:

```text
event_time_restricted_endpoint + exact + bound -> terminal_red
tracked_drainer_endpoint + exact + bound -> terminal_red
exact_htx_endpoint + exact + bound -> terminal_red
exact_restricted_exchange_endpoint + exact + bound -> terminal_red
confirmed_verify20_usdt_scene + full fingerprint/final successful matching
  USDT selector/event/finality/movement binding -> terminal_red
exact-bound approval/transferFrom/proxy/drainer/Verify-like lead
  + continuationAddress + boundEventIds -> continue_exact_path
exact terminal + complete amount relevance + knownIntermediateEventIds
  -> cashflow_relevance_only
verify20_method_name_only or unconfirmed pattern -> unresolved
missing binding or unknown authority class -> unresolved
```

Assert that `continue_exact_path` returns only sorted/deduplicated exact
`boundEventIds`, `cashflow_relevance_only` returns only sorted/deduplicated
`knownIntermediateEventIds`, terminal outcomes return no path fields, sparse or
invalid identifier arrays are rejected, and unknown authority classes fail
closed to `unresolved`.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm.cmd test -- tests/forensics/adversePathDisposition.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure matrix**

Use a closed union for the approved authority classes and return a
discriminated union:

```ts
type AdversePathDispositionV1 =
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      disposition: "terminal_red";
      reason: "exact_adverse_endpoint";
    }
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      disposition: "continue_exact_path";
      reason: "exact_bound_adverse_lead";
      continuationAddress: string;
      boundEventIds: readonly string[];
    }
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      disposition: "cashflow_relevance_only";
      reason: "selected_amount_relevance_for_exact_terminal";
      knownIntermediateEventIds: readonly string[];
    }
  | {
      policyVersion: "provenance-adverse-terminal-matrix-v1";
      disposition: "unresolved";
      reason: AdversePathDispositionUnresolvedReasonV1;
    };
```

The function must not import traversal, repositories, config, scoring, bot, or
provider code. It classifies evidence already supplied by a caller; it does
not invent authority.

- [ ] **Step 4: Run GREEN and commit**

Run:

```powershell
npm.cmd test -- tests/forensics/adversePathDisposition.test.ts tests/forensics/offlineForensicModelReplay.test.ts
npm.cmd run typecheck
```

Expected: all selected tests and typecheck pass.

Commit only Task 2 files:

```powershell
git add -- src/forensics/adversePathDisposition.ts tests/forensics/adversePathDisposition.test.ts
git commit -m "feat: add offline adverse path disposition"
```

## Task 3: Correct the design and product truth

**Files:**

- Create: `docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-chronological-proportional-balance-provenance-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md`
- Modify: `docs/knowledge/02-check-modes.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/14-current-roadmap.md`

- [ ] **Step 1: Correct red-branch language**

Keep one normative matrix in the 2026-07-30 amendment and link the service,
cashflow and knowledge docs to it. Freeze these distinctions:

```text
exact event-time adverse endpoint -> terminal red fact
full Verify20 fingerprint + final successful matching USDT movement
  + exact selector/event/finality/movement binding -> terminal red fact
exact-bound nonterminal approval/transferFrom/proxy/drainer/Verify-like lead
  -> continue only exact bound path
amount relevance question -> cashflow inside known intermediate events;
                              never expand the adverse endpoint itself
method-name-only, missing binding (including continuation binding), or unknown
  authority class -> unresolved
```

Exact terminals are preserved; only exact-bound nonterminal leads create
mandatory deep continuation. Align the service spec, chronological cashflow
spec, knowledge 02, and knowledge 09 without duplicating the normative table.

- [ ] **Step 2: Record current subject-service behavior and the bounded design**

The new amendment must state:

- production currently expands every subject event and every nonterminal
  frontier address;
- the 10,000 provider sentinel is not a policy cap or full-history proof;
- checked subject remains non-terminal;
- a future bounded subject-service mode must be selected before full subject
  history and suppress ordinary neighbor tasks, while keeping exact red facts,
  unresolved leads, selected cashflow episodes, and explicit incomplete
  coverage;
- `SUBJECT_EVENT_CAP` remains unapproved until frozen replay measures it;
- recorded `…W8SRL` is calibration only and `…D7NzP` remains the negative
  checked-subject control.

- [ ] **Step 3: Record Cashflow Query Selector truth without inventing policy**

Document:

- legacy `<1000` recent-flow handling and its one-anchor/five-row limitations;
- Incoming exact-deposit behavior;
- missing shared selector for `current_balance`, completed exact episode, and
  triggered evidence relevance;
- the proposed `10 USDT / 0.1%` rule is not approved because recent window,
  gross-turnover denominator, materiality, episode coverage, and ordinary
  episode bound are not frozen;
- recorded `…W8SRL → …PacGy` `180/300` chronology checks arithmetic only, with
  a separate synthetic zero-opening control; real `…PacGy` remains unresolved
  without complete canonical history and an independent pinned balance witness;
- real `…dwxxhs` must remain recorded/unresolved: ingress, approval and `669`
  debit observations are not canonical exact proof until a frozen tape binds
  identity, order, opening and amount authority.

- [ ] **Step 4: Update roadmap and commit**

Roadmap must distinguish:

- cap correctness fixed;
- offline adverse disposition implemented but not wired;
- subject-service and query-selector production work blocked on explicit
  policy plus frozen fixtures;
- Stage D remains deferred.

Run:

```powershell
git diff --check
```

Commit only Task 3 docs.

## Task 4: Final verification and scope audit

- [ ] **Step 1: Run focused and authority regressions**

```powershell
npm.cmd test -- tests/tron/tronClient.test.ts tests/unified-check/providerHistoryCompletion.test.ts tests/unified-check/directHistory.test.ts tests/unified-check/productionDirectHistory.test.ts tests/unified-check/productionAddressHistory.test.ts tests/forensics/adversePathDisposition.test.ts tests/forensics/offlineForensicModelReplay.test.ts tests/forensics/recentFlowProvenanceSelection.test.ts tests/forensics/moneyOriginTrace.test.ts tests/unified-check/productionBoundary.test.ts tests/unified-check/traversal.test.ts
npm.cmd run typecheck
```

- [ ] **Step 2: Run the full suite**

```powershell
npm.cmd test
```

- [ ] **Step 3: Audit scope**

```powershell
git diff --check HEAD~3..HEAD
git diff --name-only HEAD~3..HEAD
rg -n "adversePathDisposition|providerHistoryCompletion" src/index.ts src/unifiedCheck src/forensics
```

Expected: the provider completion helper is reachable only through page
adaptation; adverse disposition remains offline-only. No traversal policy,
score, report, Telegram, DB, job, Stage D, or `500 + 100` change exists.
