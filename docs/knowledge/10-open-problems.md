---
status: current
last_verified: 2026-07-03
owner_area: docs
code_refs:
  - src/index.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/forensics/incomingDepositJob.ts
  - src/check/deepForensicCheck.ts
  - src/forensics/strictProvenanceBenchmark.ts
  - tests/check/deepForensicCheck.test.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
supersedes:
  - docs/superpowers/plans/2026-07-02-admin-strict-provenance-benchmark.md
  - docs/superpowers/plans/2026-07-03-where-incoming-outcome-safety.md
---

# Open Problems

## Current Behavior

- Inline targeted history currently uses `TARGETED_HISTORY_INLINE_MAX_PAGES =
  4`.
- Queued Where hop targeted indexing uses Stage 1.5 background retry/escalation
  with code constants.
- The TronScan key pool exists and can use multiple keys/account groups.
- Recent targeted partial states show the completeness bottleneck is local
  budget/partial-state handling, not simply the number of keys.
- DeepCheck direct all-time boundary works when the subject index is complete
  and small enough to materialize.
- DeepCheck second layer is still partial/planned in the audited path.

## Provenance Coverage

- Targeted hop history can still stop on configured local budgets or provider
  caps.
- The current inline page budget is 4 pages. Where background hop indexing can
  requeue retryable partials with a larger budget, but only inside the current
  code-level ceilings.
- `History not fully fetched` still appears in graph UI for old and partial
  jobs.
- Incoming still needs the normal "continue indexing, then resume trace" flow.
- Parent job wakeup now uses generic targeted waiters for Stage 1 Where, but
  Incoming is not wired to those waiters yet.

## TronScan Indexing

- Page budgets need explicit job-level and hop-level configuration instead of
  Stage 1.5 constants.
- Time-window splitting must be used when provider cap is hit.
- Partial targeted states are resumable for ordinary Where when they are
  retryable and there is remaining page-budget headroom. Incoming is not wired
  to the same flow yet.
- Scheduler metrics should make clear whether 4, 10, or more keys are actually
  improving throughput.
- Progress should show pages, dates, requests, 429, 403, and 5xx.
- Split depth/window progress is still not first-class in Admin progress.

## DeepCheck

- Second-layer metrics can show an empty queue even when a budget exists. Treat
  this as planned/partial until real queue work is implemented.
- Direct counterparty hard-evidence checks should become wider and clearer.
- Missing checks should be split into provider errors, local budget limits,
  service-boundary stops, and diagnostic notes.

## UX

- Telegram needs plain language for technical coverage blocks.
- Admin should distinguish old cached jobs from fresh live runs.
- Buttons that start jobs should show which address they used and which job id
  was queued.

## Planned Behavior

- Ordinary Where/Incoming resumable indexing to full main-path coverage.
- Final scoring only after covered indexed history for required money paths.
- Full user-facing progress for long targeted indexing in Telegram.
