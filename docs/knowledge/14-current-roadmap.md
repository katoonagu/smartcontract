---
status: current
last_verified: 2026-07-28
owner_area: docs
code_refs:
  - src/index.ts
  - src/bot/createBot.ts
  - src/forensics/deepForensicJob.ts
  - src/risk/fastEvidence.ts
  - src/risk/scoringSignalMatrixInputs.ts
  - src/tron/usdtBlacklistTimeline.ts
  - src/forensics/sanctionedServiceRegistry.ts
  - src/forensics/selectiveTransactionEnrichment.ts
  - src/forensics/forensicSlotPump.ts
  - src/unifiedCheck
  - docs/superpowers/specs/2026-07-26-unified-service-boundary-and-latency-design.md
  - docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md
---

# Current Roadmap

This page is the short current execution map. Detailed historical designs and
implementation plans do not override the status recorded here.

## Current Order

1. Close the authority and event-time correctness gate.
2. Close Stage B operational evidence without changing legacy defaults.
3. Implement Stage C as shadow-only behavior profiling.
4. Freeze a separate blind set, complete two reviews, and adjudicate it.
5. Plan and implement disabled-by-default Stage D / snapshot-closure-v3.
6. Build recipient wallet precheck before signing or broadcasting.

Unified TQr latency is a separate diagnostic track. It is not Stage B release
evidence and does not change the order above.

## Production Routing

Production is currently split. Address `/check` uses Unified intake and
parent-only delivery while the active generation fence is `unified`.
Transaction `/check` plus independent or pre-existing legacy Where, Deep, and
Incoming work retain their legacy lifecycle. The delivery fence prevents both
paths from owning automatic output for the same chat/address pair.

## Status

| Area | Current state | Next acceptance boundary |
|---|---|---|
| Correctness gate | Four confirmed authority/temporal defects remain open | Negative regressions, minimal fixes, Golden/regression and PostgreSQL proof |
| Stage A | Code-complete; user default remains V1 | Isolated V2 replay/canary and a separate default decision |
| Stage B | Code-complete; release evidence incomplete; Where default 1 | Canary acceptance, reversible Where-2 trial, then clean before/after observation |
| Stage C | Design-only | Shadow implementation, frozen blind set, two reviews and adjudication |
| Stage D | Design-only and blocked by C | Separate V3 plan, disabled default, replay and live canary |
| Unified TQr latency | Live V1/barrier/capacity-1 expansion observed | Separate V2/rolling/boundary measurements without treating TQr as terminal |
| Post A-D product | Not started | Recipient precheck design |

## Correctness Gate

The first implementation plan must close all four defects before Stage C
adjudication or Stage D work:

- route-linked approval-drain evidence must not become an exact durable label
  or Fast hard-evidence floor 95;
- blacklist state acquired after a transfer must not authorize an independent
  decline for that earlier transfer;
- official blacklist logs must accept semantically equivalent indexed decoded
  signatures while retaining topic/address/transaction verification;
- missing or invalid sanctions time is unknown, not active.

Historical results are not recalculated.

## Stage B Release Closure

Stage B is the legacy Where/selective-enrichment track. Its implementation is
present, but production Where concurrency two is not accepted.

Required evidence:

- real checked-in pre-Stage-B TXc replay tape and passing strict replay;
- real PostgreSQL claim/fairness tests and current schema verification;
- dedicated isolated canary deployment and clone;
- accepted concurrency-two Where receipt;
- separate Deep singleton residual receipt;
- uncontaminated before/after provider-error, 429, and delivery observation.

The first five items are required before a reversible production trial at
Where 2. The before/after observation then decides whether it remains 2 or is
restored to 1. Deep remains 1 throughout. Shared production state must not be
altered to manufacture a canary.

## Unified TQr Latency

The 2026-07-28 `/check TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP` observation was a
Unified authoritative run on `snapshot-closure-v1`, `global_barrier`, and
provider capacity ceiling 1. Direct history completed quickly; mandatory
neighbor histories expanded the traversal. Healthy providers and current
heartbeats ruled out a simple provider outage or frozen lease at observation
time.

This delay is not caused by legacy Stage B. TQr is also a mandatory negative
inferred-boundary case: Stage C must produce `wouldStop=false`, and Stage D must
never make the subject terminal. Savings may come from exact event-time-valid
boundaries or separately adjudicated intermediate nodes, not by classifying
TQr itself as a service boundary.

## Non-Blocking Maintenance Queue

These changes are useful but do not block the product sequence:

- retire only confirmed finished worktrees and avoid duplicated dependencies
  in inactive worktrees;
- add an app-only inner-loop typecheck while retaining the full release check;
- define explicit ignore/retention policy for generated `outputs/` and raw CSV;
- perform a deletion-first pass over test-only dead modules;
- deepen shared claim/provider-failure seams only where repeated production
  behavior proves the boundary.

Do not split large files merely to reduce line counts.

## Detailed Design

The approved rationale, scope, stop rules, and acceptance criteria are in
`docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md`.
