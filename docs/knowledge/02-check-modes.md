---
status: current
last_verified: 2026-07-31
owner_area: forensics
code_refs:
  - src/index.ts
  - src/bot/createBot.ts
  - src/check/smartContractCheck.ts
  - src/check/deepForensicCheck.ts
  - src/unifiedCheck/requestService.ts
  - src/unifiedCheck/productionRuntime.ts
  - src/unifiedCheck/rolloutFence.ts
  - src/monitor/addressPoisoningWorker.ts
---

# Check Modes

## Production Truth

Production uses a split runtime. Address `/check` is accepted by the Unified
parent while the active generation fence is `unified`; Fast, Where, and Deep
run as non-delivering child analyses, and only the parent owns delivery for
that chat/address pair. `/check <tx-hash>` and independent or pre-existing
legacy Where, Deep, and Incoming jobs retain their legacy lifecycle and
delivery path. Unified handoff quarantines unsent legacy Where/Deep delivery
only for the claimed pair; legacy workers continue running for other work.

This separation remains important: a missing Deep/Where result cannot be
silently replaced by Fast, and contract analysis does not replace transfer
analysis. Legacy score validity and partial-result behavior remain separate
from the Unified lifecycle.

Address-poisoning protection is a separate wallet-safety monitor. It never
becomes AML evidence or a substitute for any of the four checks.

Stage C exact-role evidence is still an offline operator/proof path, not a
production check mode. One frozen accepted history now has one standalone
`200/200` event-role map backed by exact transaction evidence. The map is
referenced by no accepted attempt and changes no production traversal, score,
report, delivery, configuration, or runtime hook.

The C1 accepted-history observer is implemented behind the exact disabled-by-
default `service-role-shadow-100-plus-100-v1` policy. When enabled it writes
only standalone input/fence/profile/precommit/runtime/summary evidence after
ordinary production history acceptance and durable checkpoint authority; it
cannot stop traversal or change scoring, reports, delivery, the finalizer, or
the authoritative Admin DAG. The isolated acceptance path executes one real seven-state
group, retains the consequent `QUEUED` traversal and planned provider work,
and therefore expects seven profiles, one group precommit, one runtime receipt,
and zero terminal summaries. Its producer/parser is implemented, but the
real-history acceptance root is not admitted until C1 Task 10.

## Unified Wallet Check

Unified Wallet Check keeps the same three analytical questions—Fast, Where,
and Deep—but runs them as evidence-only children of one parent request. The
children cannot send Telegram output or publish competing scores.

The parent publishes exactly one immutable report only after `COMPLETED`.
Every completed run has one matrix-v4 score and decision. Coverage is evidence
metadata; it neither blocks the score nor adds risk. `FAILED_TECHNICAL` is not
a risk decision and creates no report or delivery.

One request owns at most one automatic send. A confirmed send becomes
`DELIVERED`; an ambiguous external result becomes `DELIVERY_UNKNOWN` and is
never retried automatically. The generation fence makes legacy and Unified
delivery ownership mutually exclusive; it does not control analysis runtime.

The Unified request boundary, planner, and report contract are implemented.
Deployment and delivery ownership are operational choices separate from
adaptive analysis and isolated canaries.

## Target Ordinary Wallet Check Contract

This section defines the accepted target scope. It is not a description of the
current production traversal and does not authorize a production boundary.

```text
checked address A
  -> complete direct USDT history and exact red evidence
  -> shallow check of every direct counterparty B
  -> one broad second hop B -> C
  -> deep cashflow provenance for the selected money
  -> terminal exact adverse endpoints; continue only exact-bound nonterminal leads
```

| Question | Target rule |
|---|---|
| What is checked on subject `A`? | Exhaust its canonical, snapshot-bounded direct USDT history in both directions and evaluate exact labels, restrictions, tracked-dangerous links, blacklist state at event time, and contract/approval/drainer evidence. If the history cannot be exhausted, the run is incomplete. The checked subject is never an inferred service boundary. A future bounded subject mode is a separate unapproved policy below. |
| What is checked on every direct neighbor `B`? | Run a shallow, bidirectional adverse and role probe for every unique direct counterparty. Exact event-time blacklist/sanctions/restricted endpoint, exact HTX/restricted exchange, tracked drainer/collector, another exact harmful endpoint, or a confirmed Verify20 scene with full fingerprint plus final successful matching USDT transfer and exact selector/event/finality/movement binding is terminal red and its history is not opened. An exact-bound nonterminal approval/transferFrom/proxy/drainer/Verify-like lead continues only through its bound path; a method name, missing binding, or unknown authority remains unresolved. |
| When is the second hop inspected? | For every non-terminal `B`, inspect its anchor-bounded direct relationships to `C` once. Preserve terminal red `C` facts and exact-bound nonterminal leads, but do not automatically open the complete history of every `C`. Before downloading a very large unlabeled `B`, the service research probe may profile two frozen physical windows: `100 recent + 100 historical`. |
| Which branches continue deeply? | Beyond the broad second hop, continue the contributors needed to explain `95%` of the known selected money plus every exact-bound nonterminal adverse lead. Exact adverse endpoints are terminal facts, not mandatory history expansion. Missing authority or binding remains unresolved. |
| Where does cashflow apply? | The chronological proportional ledger answers current-balance, amount-only, and exact-episode provenance on `A`, then repeats backward for each selected contributor (`A <- B <- C <- D`). For selected-amount relevance at an exact terminal, it may inspect only already-known intermediate events and never opens the adverse endpoint history. It is independent of the broad two-hop screen. |
| Where does service boundary apply? | Only to an intermediate address, never to the checked subject. The first implementation computes the `100 + 100` profile offline and shadow-only. Actual fan-out suppression remains deferred Stage D. An ambiguous or incomplete profile follows ordinary traversal; `500 + 100` is deferred until a real ambiguous case justifies it. |

The single normative `provenance-adverse-terminal-matrix-v1` is in
`docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md`.

## Bounded Subject-Service And Query-Selector Gap

Current Unified production seeds traversal from every direct subject event and
loads history for every non-terminal frontier address. The TronScan
`rangeTotal=10000` sentinel is neither a subject-event cap nor full-history
proof; provider-cap exhaustion now fails closed instead of becoming account
creation.

A future bounded subject-service mode must be selected before full subject
history, keep the subject non-terminal, suppress ordinary neighbor tasks, and
retain exact terminal reds, exact-bound leads, selected cashflow and explicit
bounded/incomplete coverage. `SUBJECT_EVENT_CAP` is unapproved. The shared
production selector for `current_balance`, completed exact episode and
triggered relevance is also absent; both gaps remain blocked on explicit
policy and frozen fixtures. Details are in
`docs/superpowers/specs/2026-07-30-subject-service-and-cashflow-query-amendment-design.md`.

Fast does not own this contract. Legacy Fast already performs a limited
two-hop search, while current Unified Fast only reports whether direct USDT
activity exists. Its future product role can be decided separately; neither
Fast implementation participates in or blocks the first offline validation of
the cashflow and service models.
