---
status: current
last_verified: 2026-07-29
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
  - docs/superpowers/specs/2026-07-29-chronological-proportional-balance-provenance-design.md
  - docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md
  - docs/superpowers/plans/2026-07-28-authority-temporal-correctness-gate.md
  - docs/superpowers/plans/2026-07-28-stage-b-release-evidence-closure.md
---

# Current Roadmap

This page is the short current execution map. Detailed historical designs and
implementation plans do not override the status recorded here.

## Current Order

1. Keep legacy Where at concurrency 1; reopen Stage B rollout only when genuine
   replay, deployment, and attributable observation evidence exists.
2. Review and freeze the forensic-model details, then run the manual read-only
   corpus replay: chronological proportional provenance plus the revised
   `100 + 100` service probe.
3. Implement the provenance ledger as a separate versioned correctness change.
4. Implement Stage C as shadow-only behavior profiling.
5. Freeze a separate blind set, complete two reviews, and adjudicate it.
6. Plan and implement disabled-by-default Stage D / `snapshot-closure-v3`.
7. Run the full post-model knowledge/code conformance cleanup; factual
   contradictions already proven are corrected immediately, not deferred.
8. Build recipient wallet precheck before signing or broadcasting.

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
| Stage B | Runtime/evidence tooling complete; real PostgreSQL gate passed; genuine replay/deployment/observer evidence unavailable; repository default remains 1 | Park rollout at 1; reopen only when the missing real evidence exists |
| Forensic query/provenance model | Direction approved; detailed design awaiting user review; not implemented | Freeze the spec, complete manual deterministic corpus replay and conservation/order review, then write a separate versioned implementation plan |
| Stage C | `100 + 100` sampling rule approved; detailed amendment awaiting review; code absent | Manual corpus replay, then shadow implementation and frozen blind review |
| Stage D | Design-only and blocked by C | Separate V3 plan, disabled default, replay and live canary |
| Knowledge conformance cleanup | Confirmed Where/provenance/status contradictions corrected in this pass; full repository-wide pass deferred until model status stabilizes | Compare every current knowledge claim with code and accepted artifacts after the new model stages, then remove stale/historical duplication |
| Unified TQr latency | Live V1/barrier/capacity-1 expansion observed | Separate V2/rolling/boundary measurements without treating TQr as terminal |
| Post A-D product | Not started | Recipient precheck design |

## Correctness Gate

The authority and event-time correctness gate is complete. Historical results
were not recalculated. Implementation landed as four independent fixes, one
compatibility gate, and focused cross-chain authority follow-ups:

- approval authority: [`5f7021768eb5cc941d6758379f6e8e7052bbaa35`](https://github.com/katoonagu/smartcontract/commit/5f7021768eb5cc941d6758379f6e8e7052bbaa35);
- semantic blacklist declarations: [`b926cea227bc38c7378e32e4d79079e071218550`](https://github.com/katoonagu/smartcontract/commit/b926cea227bc38c7378e32e4d79079e071218550);
- blacklist event-time active subset: [`99ed99e38f6a55a38906781de913fa45152485d7`](https://github.com/katoonagu/smartcontract/commit/99ed99e38f6a55a38906781de913fa45152485d7);
- sanctions tri-state and local evidence binding: [`a8370d1d8ea79c1f31537c1cb14fa6db9c448e9c`](https://github.com/katoonagu/smartcontract/commit/a8370d1d8ea79c1f31537c1cb14fa6db9c448e9c);
- legacy compatibility gate: [`d3a4f1b0b7e9d964df6b7bca71b937bb66290f28`](https://github.com/katoonagu/smartcontract/commit/d3a4f1b0b7e9d964df6b7bca71b937bb66290f28);
- typed cross-chain sanctions authority: [`a169d6f11ca358dd9a51d2416b6a25e018c5e163`](https://github.com/katoonagu/smartcontract/commit/a169d6f11ca358dd9a51d2416b6a25e018c5e163),
  preserving separate exact corridor authority without authorizing colliding
  local sanctions artifacts;
- typed cross-chain sanctions score: [`e0d011bcaf43b47a2cf83628d4ff5a8a0fa29702`](https://github.com/katoonagu/smartcontract/commit/e0d011bcaf43b47a2cf83628d4ff5a8a0fa29702),
  retaining the validated decline score for that exact typed corridor while
  local artifacts remain isolated.

Verification passed: the combined targeted suite (`1,690` tests), Golden V2
verification (`24` tests; locked manifest
`4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`),
the production comparator contract (`8` tests), typecheck, the full suite
(`4,942` passed, `157` skipped), and the forbidden-shortcut audit. Skipped
PostgreSQL-gated tests in that run were not PostgreSQL proof; the separate
Stage B dedicated PostgreSQL gate below now closes that one evidence item while
the replay, deployment, canary, Deep, and observer blockers remain open.

## Stage B Release Closure

Stage B is the legacy Where/selective-enrichment track. Its runtime core and
replay/canary client contracts are present, but production Where concurrency
two is not accepted. Evidence-tooling hardening landed in `6bf24285` and merged
through `8bbbbc00`: PostgreSQL `Date` handling, read-only capture dependencies,
safe assertion/endpoint projection, configured-secret rejection, disposal,
create-only caller-bound canary output, canonical readers, and evidence binding
are covered by 92 targeted tests. Combined master passed 4,951 tests and
typecheck.

The real PostgreSQL gate is also complete: the dedicated `tron_watch_plan3`
database verified schema 037 and passed four migration plus 168
claim/fairness/evidence/delivery tests without skips. The replay gate remains
blocked for two independent reasons. The configured schema-037 database has no
completed TXc legacy Where job/report, and exact recorder `6bf24285` is not on
the approved historical behavior tree. A direct historical backport lacks the
later execution `dispose` and replay-schema contracts; baseline hashes and
behavior files were not weakened. The repository and all available
worktrees/refs also lack the deployment-owned bridge/server, tracked adapter,
cycle-isolated composition, deployment receipt builder, and attributable
observer required for canary and rollout proof.

Required capabilities and evidence:

- a reviewed historical-recorder identity that preserves the approved behavior
  tree while satisfying the hardened recorder contract;
- a genuine completed TXc legacy Where job followed by a checked-in replay tape
  and passing strict replay;
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

Replay, deployment integration, the Where canary and the Deep receipt, plus
observer readiness proof, are required before a separately
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
inferred-boundary case: reconstructed Stage C must produce
`estimatedWouldAction=continue_full`; any exact-page profile must produce
authoritative `wouldAction=continue_full`, and Stage D must never make the
subject terminal. Savings may come from exact event-time-valid boundaries or
separately adjudicated intermediate nodes, not by classifying TQr itself as a
service boundary.

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

The current approved designs and the two review drafts are in
`docs/superpowers/specs/2026-07-28-correctness-stage-b-unified-latency-design.md`,
`docs/superpowers/specs/2026-07-26-unified-service-boundary-and-latency-design.md`,
`docs/superpowers/specs/2026-07-29-chronological-proportional-balance-provenance-design.md`,
and
`docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md`.
The completed correctness and Stage B work is split into
`docs/superpowers/plans/2026-07-28-authority-temporal-correctness-gate.md` and
`docs/superpowers/plans/2026-07-28-stage-b-release-evidence-closure.md`.
The two 2026-07-29 review drafts intentionally have no implementation plans
until their pre-code manual corpus gates pass.
