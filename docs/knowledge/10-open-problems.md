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
  - src/forensics/targetedIndexRepair.ts
  - src/storage/repositories.ts
  - src/admin/adminConsole.ts
  - src/admin/forensicsGraph.ts
  - src/admin/adminServer.ts
  - src/forensics/incomingDepositJob.ts
  - src/check/deepForensicCheck.ts
  - src/forensics/strictProvenanceBenchmark.ts
  - tests/check/deepForensicCheck.test.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
  - tests/forensics/addressIndexWorker.test.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/forensics/targetedIndexRepair.test.ts
  - tests/storage/repositories.test.ts
supersedes:
  - docs/superpowers/plans/2026-07-02-admin-strict-provenance-benchmark.md
  - docs/superpowers/plans/2026-07-03-where-incoming-outcome-safety.md
---

# Open Problems

## Current Behavior

- Inline targeted history currently uses `TARGETED_HISTORY_INLINE_MAX_PAGES =
  4`.
- Queued Where hop targeted indexing uses Stage 1.5 background retry/escalation
  plus Stage 1.7 adaptive cursor indexing with code constants.
- The TronScan key pool exists and can use multiple keys/account groups.
- Recent targeted partial states show the completeness bottleneck is local
  budget/partial-state handling, capped-window strategy, and heavy-address
  density, not simply the number of keys.
- Admin now has a Stage 1.6 progress graph/read model for ordinary Where jobs
  waiting on targeted history. It shows current targeted state counts, locks,
  budgets, pages, transfers, oldest/newest dates, and basic provider error
  counters without requiring manual SQL.
- Stage 1.7 live observation on `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` showed a
  normal `where_is_money_check` staying in `waiting_for_targeted_index` while
  the targeted worker continued beyond old page counts with no 429/403/5xx. It
  also showed old pre-fix targeted states can remain visible in Admin until they
  are cleaned up or superseded.
- Stage 1.7 verification gate on job
  `68c72121-2d3c-4026-986d-51c088aaa5a9` showed the new worker can reclaim an
  old stale `running` targeted state and keep heartbeat alive, but the reclaimed
  run reused the old `budget_pages=2000` and revalidated existing page windows
  instead of immediately escalating budget or jumping to uncovered windows.
  This is a local resume/lifecycle gap, not a TronScan provider terminal.
- Stage 1.8 adds cache-aware targeted resume. Saved stable page audits can be
  reused without a live TronScan request, capped cached pages no longer use
  canonical transfer count as raw provider row count, stale budget-exhausted
  `running` states can be requeued with larger budget, and old retryable
  `partial_provider_cap` states no longer force ordinary Where into a terminal
  provider-cap result.
- Stage 1.8 live observation on `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` showed a
  normal `where_is_money_check` staying in `waiting_for_targeted_index` while
  five targeted states were queued/running. Admin graph reported 3360 targeted
  pages, 2544 unique canonical hashes, repeat ratio 0.2429, max budget 8000,
  and 0/0/0 rate-limit/forbidden/server errors.
- Stage 1.9 repair on the dev DB moved 8 high-confidence false `complete`
  targeted states back to `queued` without deleting cached page audits. For
  `TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn`, the two repaired targets kept their
  800 cached pages each and were assigned larger retry budgets.
- Stage 1.9 also fixed exact targeted wait reuse: an existing repaired
  `queued`/`running` state is now reused instead of queueing a duplicate exact
  target.
- After Stage 1.9 repair, live Admin graph for job
  `a8db3956-bac6-4c95-b538-5d1324e2432b` stayed in
  `waiting_for_targeted_index`, had `terminalCount=0`, `completeCount=0`,
  `high_confidence_dirty_complete=0`, and provider errors 0/0/0. One stale
  running lock remained from an intentionally stopped dev server until lock TTL.
- Stage 1.10 fixes targeted coverage shadowing: a finished same-address covering
  state now beats an exact old non-covered `queued`/`running` state in the Where
  coordinator and Admin targeted progress read model.
- Stage 1.10 live validation on job
  `a8db3956-bac6-4c95-b538-5d1324e2432b` restarted Admin on the current HEAD and
  confirmed the new worker was alive with provider errors 0/0/0. The parent job
  remained in `waiting_for_targeted_index` because the newer covering target was
  still `running`, not yet `complete` or terminal.
- Stage 1.11 found the next bottleneck for the same job: targeted resume loaded
  only 500 saved page audits before each run, while the active target already
  had more than 2,600 saved pages. This made the worker live-refresh saved
  windows instead of skipping them from cache. The default page-audit read now
  loads up to 20,000 saved pages.
- Stage 1.11 live validation after the cache snapshot fix restarted Admin and
  requeued target `2026-07-01T14:10:36.000Z` with `budget_pages=12000`. In the
  10-15 minute observation window, page rows increased from 2,608 to 3,305,
  unique hashes from 2,496 to 3,193, provider errors stayed 0/0/0, and the
  parent job correctly remained in `waiting_for_targeted_index` because the
  covering target was still `running`, not `complete` or terminal.
- Stage 1.12 event monitoring on job
  `a8db3956-bac6-4c95-b538-5d1324e2432b` reached the expected terminal event.
  The covering target ran to `budget_pages=12000`, saved 11,327 page audits with
  11,215 unique canonical hashes, reached `2026-05-22T08:17:54.000Z`, and ended
  as `partial_provider_cap` with provider errors 0/0/0. All five waits became
  `terminal`; the parent Where job woke and finished as
  `provider_cap_unresolved` with `score_valid=false`.
- Post-Stage 1 cleanup keeps targeted terminal provider-cap details visible in
  Admin while suppressing the extra generic `where_origin_paths_missing` stop
  when `targetedIndex` already explains `provider_cap_unresolved`.
- Stage 1.13 adds funding-first source provenance for ordinary Where hops. The
  trace records exact, probable, pre-existing-balance, unresolved, and
  service-boundary proof classes. Exact funding windows can continue trace
  expansion. Probable capped-window funding is kept as Admin context and does
  not become hard scoring proof.
- Admin graph now surfaces funding-first source-provenance limitations and
  inferred candidate edges, so analysts can see the candidate funding source
  even when the trace cannot treat it as exact proof.
- Where history coverage metadata now carries optional flags for
  `coverageComplete`, `providerCapHit`, `budgetExhausted`, and
  `providerInconsistent` where the producer already knows those facts.
- DeepCheck direct all-time boundary works when the subject index is complete
  and small enough to materialize.
- DeepCheck second layer is still partial/planned in the audited path.

## Provenance Coverage

- Targeted hop history can still stop on configured local budgets or provider
  caps if the heavy address needs more work than the current safety ceiling.
- The current inline page budget is 4 pages. Where background hop indexing can
  requeue retryable partials with a larger budget, but only inside the current
  code-level ceilings.
- `History not fully fetched` still appears in graph UI for old and partial
  jobs.
- Funding-first exact-window repair is still not a dedicated queued indexing
  stage. Current Stage 1.13 can classify cached funding candidates, but a
  promising probable candidate does not yet automatically queue a narrow
  candidate-to-target repair window.
- Incoming still needs the normal "continue indexing, then resume trace" flow.
- Parent job wakeup now uses generic targeted waiters for Stage 1 Where, but
  Incoming is not wired to those waiters yet.

## TronScan Indexing

- Page budgets need explicit job-level and hop-level configuration instead of
  Stage 1.7 constants.
- Time-window splitting is implemented for provider caps, including adaptive
  cursor split and midpoint fallback. It still needs better product-level
  metrics for split depth/window counts.
- Targeted resume is now cache-aware for stable saved page audits. A dedicated
  maintenance repair exists for high-confidence old false `complete` states,
  but review-only single-page capped completes are not bulk-repaired.
- Stage 1.11 raises the saved-page snapshot default to 20,000 rows so heavy
  background targeted runs can actually reuse all saved page audits under the
  current 12,000-page ceiling.
- Partial targeted states are resumable for ordinary Where when they are
  retryable and there is remaining page-budget headroom. Incoming is not wired
  to the same flow yet.
- Scheduler metrics should make clear whether 4, 10, or more keys are actually
  improving throughput.
- Admin Where progress shows pages, dates, requests, 429, 403, and 5xx for
  targeted indexing. Telegram and Incoming do not yet have equivalent progress.
- Split depth/window progress is still not first-class in Admin progress.
- Old targeted states from before Stage 1.7 can make a fresh Admin graph look
  noisier than a clean run because waits/states for the same address and older
  target timestamps may still be present. Stage 1.10 prevents finished covering
  states from being hidden by those old exact states, but it does not hide old
  states while the covering state is still running.

## DeepCheck

- Second-layer metrics can show an empty queue even when a budget exists. Treat
  this as planned/partial until real queue work is implemented.
- Direct counterparty hard-evidence checks should become wider and clearer.
- Missing checks should be split into provider errors, local budget limits,
  service-boundary stops, and diagnostic notes.

## UX

- Telegram needs plain language for technical coverage blocks.
- Admin should distinguish old cached jobs from fresh live runs.
- Admin progress graph currently covers `waiting_for_targeted_index`; completed
  and failed historical jobs still need clearer separation between final
  forensic result and historical debug state.
- Buttons that start jobs should show which address they used and which job id
  was queued.

## Planned Behavior

- Ordinary Where/Incoming resumable indexing to full main-path coverage.
- Final scoring only after covered indexed history for required money paths.
- Full user-facing progress for long targeted indexing in Telegram.
