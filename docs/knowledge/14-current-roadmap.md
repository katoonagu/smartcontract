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
  - docs/superpowers/plans/2026-07-28-authority-temporal-correctness-gate.md
  - docs/superpowers/plans/2026-07-28-stage-b-release-evidence-closure.md
---

# Current Roadmap

This page is the short current execution map. Detailed historical designs and
implementation plans do not override the status recorded here.

## Current Order

1. Close Stage B operational evidence without changing legacy defaults.
2. Implement Stage C as shadow-only behavior profiling.
3. Freeze a separate blind set, complete two reviews, and adjudicate it.
4. Plan and implement disabled-by-default Stage D / snapshot-closure-v3.
5. Build recipient wallet precheck before signing or broadcasting.

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
| Correctness gate | Complete; four authority/temporal defects closed without historical recalculation | Preserve the gate while later stages add evidence or policy |
| Stage A | Code-complete; user default remains V1 | Isolated V2 replay/canary and a separate default decision |
| Stage B | Runtime core complete; unit/client contracts present; real capture needs confirmed read-only/date/assertion/dispose plus endpoint/secret-output repairs; canary run output is not caller-bound; deployment integration and attributable rollout proof are missing; repository default 1 | Repair evidence tooling, obtain real replay/PostgreSQL proof, then take explicit deployment/observability branches; retain 1 unless all later gates pass and a reversible trial observation supports 2 |
| Stage C | Design-only | Shadow implementation, frozen blind set, two reviews and adjudication |
| Stage D | Design-only and blocked by C | Separate V3 plan, disabled default, replay and live canary |
| Unified TQr latency | Live V1/barrier/capacity-1 expansion observed | Separate V2/rolling/boundary measurements without treating TQr as terminal |
| Post A-D product | Not started | Recipient precheck design |

## Correctness Gate

The authority and event-time correctness gate is complete. Historical results
were not recalculated. Implementation landed as four independent fixes followed
by one compatibility gate:

- approval authority: [`5f7021768eb5cc941d6758379f6e8e7052bbaa35`](https://github.com/katoonagu/smartcontract/commit/5f7021768eb5cc941d6758379f6e8e7052bbaa35);
- semantic blacklist declarations: [`b926cea227bc38c7378e32e4d79079e071218550`](https://github.com/katoonagu/smartcontract/commit/b926cea227bc38c7378e32e4d79079e071218550);
- blacklist event-time active subset: [`99ed99e38f6a55a38906781de913fa45152485d7`](https://github.com/katoonagu/smartcontract/commit/99ed99e38f6a55a38906781de913fa45152485d7);
- sanctions tri-state and local evidence binding: [`a8370d1d8ea79c1f31537c1cb14fa6db9c448e9c`](https://github.com/katoonagu/smartcontract/commit/a8370d1d8ea79c1f31537c1cb14fa6db9c448e9c);
- legacy compatibility gate: [`d3a4f1b0b7e9d964df6b7bca71b937bb66290f28`](https://github.com/katoonagu/smartcontract/commit/d3a4f1b0b7e9d964df6b7bca71b937bb66290f28).

Verification passed: the combined targeted suite (`1,689` tests), Golden V2
verification (`24` tests; locked manifest
`4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`),
the production comparator contract (`8` tests), typecheck, the full suite
(`4,941` passed, `157` skipped), and the forbidden-shortcut audit. Skipped
PostgreSQL-gated tests are not PostgreSQL proof; the existing database and
Stage B operational blockers below remain open.

## Stage B Release Closure

Stage B is the legacy Where/selective-enrichment track. Its runtime core and
replay/canary client contracts are present, but the real capture path is not yet
proved and production Where concurrency two is not accepted. Code review of
`scripts/captureWhereLatencyReplay.ts` confirmed that capture must first accept
PostgreSQL `Date` values, stop exposing a completed job to mutation/claim-fence
callbacks, project assertion rows without Telegram-owned fields, and dispose the
shared execution on every exit. It must also reject credential/query-bearing
endpoint identities, reject any configured secret echoed into canonical output,
and bind the actual canary run receipt to an explicit create-only path. The
repository also does not currently provide
the deployment-owned bridge/server, tracked adapter, cycle-isolated composition,
or request attribution needed to finish the operational gates by itself.

Required capabilities and evidence:

- a clean tooling-only capture-harness fix followed by a real checked-in
  pre-Stage-B TXc replay tape and passing strict replay;
- real PostgreSQL claim/fairness tests and current schema verification;
- an approved deployment path supplying the immutable bridge, tracked adapter, cycle
  composition and deployment receipt required by the trusted canary CLI;
- dedicated isolated canary deployment and clone;
- accepted concurrency-two Where receipt plus a create-only binding manifest
  tying it to the trusted CLI, combined candidate and deployment artifact;
- separate Deep singleton residual receipt with its own canonical binding
  manifest and Deep deployment/config identity;
- a separately reviewed attributable/cycle-isolated observer and canonical
  manifest writer installed and validated before any production trial;
- attributable before/after provider-error, 429, and delivery observation
  produced during that trial. Current process-global endpoint logs alone are
  insufficient.

Replay, PostgreSQL proof, deployment integration, the Where canary and the Deep
receipt, plus observer readiness proof, are required before a separately
approved reversible production trial at Where 2. The attributable before/after
observation produced by that trial then decides whether it remains 2 or is
restored to 1. If deployment or attribution capabilities remain absent, the
official decision is to keep 1 and open a separate reviewed integration design.
Deep remains 1 throughout. Shared production state must not be altered to
manufacture a canary.

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
Execution is split into
`docs/superpowers/plans/2026-07-28-authority-temporal-correctness-gate.md` and
`docs/superpowers/plans/2026-07-28-stage-b-release-evidence-closure.md`.
