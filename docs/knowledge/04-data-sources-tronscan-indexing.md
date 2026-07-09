---
status: current
last_verified: 2026-07-09
owner_area: tronscan
code_refs:
  - src/tron/tronClient.ts
  - src/tron/tronscanScheduler.ts
  - src/check/theftReportTransaction.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/fundingFirstSourceProvenance.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/forensics/targetedIndexRepair.ts
  - src/storage/repositories.ts
  - src/index.ts
  - src/config.ts
  - scripts/repairTargetedIndexCoverage.ts
  - tests/config/config.test.ts
  - tests/tron/tronscanScheduler.test.ts
  - tests/check/theftReportTransaction.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
  - tests/forensics/fundingFirstSourceProvenance.test.ts
  - tests/forensics/addressIndexWorker.test.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/forensics/targetedIndexRepair.test.ts
  - tests/storage/repositories.test.ts
supersedes:
  - docs/provider-observations/tronscan-usdt-pagination.md
  - docs/superpowers/specs/2026-07-02-api-all-time-indexer-design.md
  - docs/project-walkthrough/11-data-sources-and-coverage.md
---

# TronScan Data And Indexing

## Current Behavior

The project uses TronScan as the primary source for TRON USDT transfer history
in this phase. There is no manual CSV product workflow.

The Telegram theft-report transaction parser validates the parent TronScan
transaction as confirmed/successful. Nested `trc20TransferInfo` rows can omit
their own `confirmed` field on real successful transfers, so a row with official
USDT contract, successful status/result fields, sender, receiver, and amount is
accepted when the parent transaction is confirmed.

The system supports a TronScan API key pool:

- comma-separated `TRONSCAN_API_KEY`;
- optional `TRONSCAN_API_KEY_GROUPS`;
- scheduler slots per key;
- account-group pacing;
- endpoint pacing;
- cooldown after 429;
- diagnostics such as `apiKeyCount`, `apiKeyGroupCount`,
  `rateLimitedRequests`, and cooldown fields.

More keys increase throughput. They do not fix local page budgets or partial
targeted-index states by themselves.

The inline live targeted seed path is capped by:

```text
TARGETED_HISTORY_INLINE_MAX_PAGES = 4
```

For ordinary `Where is money`, that four-page result is no longer a final
answer for required hops. The normal repair path is candidate-window proof
first, then a bounded balance-forming slice for the concrete hop. Broad queued
targeted history is kept for unresolved hard-evidence branches and still uses a
larger background budget:

```text
TARGETED_HISTORY_BACKGROUND_MAX_PAGES = 200
TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP = 12000
TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH = 24
TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS = 8
```

When a background targeted task stops with retryable partial coverage, the
address index worker can requeue it instead of waking the parent job:

- `partial_budget_exhausted` escalates page budget;
- `partial_rate_limited` stays retryable only until the configured max attempts
  and does not increase the page budget;
- `partial_provider_cap` stays retryable when the local page budget was also
  exhausted;
- old targeted partial states can be requeued with a larger budget when the
  previous attempt cap was reached, including `partial_provider_cap` when it
  also exhausted the local budget;
- stale `running` targeted states that were claimed from an expired lock can
  be requeued with a larger budget before replaying old windows;
- long running targeted tasks update lock heartbeat while fetching pages.

The Where targeted coordinator uses the same background page ceiling as the
worker. A `partial_budget_exhausted` or budget-exhausted `partial_provider_cap`
state can only requeue while the next retry budget can still grow inside that
ceiling. At the ceiling, the parent job receives a technical terminal result
instead of queueing an unbounded larger run.

For capped TronScan windows, the indexer now tries an adaptive cursor split
before the old midpoint split. If the capped page returns rows, the next older
window ends just before the oldest raw row returned by that page. This avoids
repeatedly fetching the same top page for heavy addresses. If the cursor would
not move the window by a useful amount, the indexer falls back to the midpoint
split.

Stage 1.8 makes targeted resume cache-aware for saved page windows. If a saved
page audit exists with a stable raw/canonical hash, status `complete`/`empty`,
and provider metadata, the indexer uses that saved audit instead of issuing a
new TronScan request. For capped cached pages, indexed canonical transfer count
is not treated as raw provider row count; this prevents false completion when a
capped page contains fewer canonical transfers than the provider page limit.

Stage 1.9 adds a maintenance repair path for old dev/pre-fix targeted states
that were already marked `complete` incorrectly. The repair does not delete page
audits or indexed transfers. It only moves high-confidence invalid complete
states back to `queued` with a larger retry budget, so cache-aware targeted
resume can continue from saved pages.

Same-address targeted waits are coalesced by coverage semantics: a state that
indexes address `A` up to a later target timestamp can cover waits for earlier
target timestamps on the same address. The worker should not spend budget on an
older queued target while a newer queued/running target for the same address is
available.

Stage 1.10 fixes targeted wait resolution when old exact states exist. If a
newer same-address targeted state is already `complete` or terminal and covers
the requested target timestamp, the coordinator uses that covering state even
when an exact older target is still `queued`, `running`, or stale. Admin
targeted progress uses the same finished-first coverage ordering, so an old
exact state should not appear as the blocking state after a covering finished
state exists.

Stage 1.11 fixes the cache snapshot size used by targeted resume. The indexer
previously loaded only 500 saved page audits by default before a run. Heavy
background targeted runs can have thousands of saved pages, so that small
snapshot caused live re-fetch of already saved windows. The default saved-page
read now loads up to 20,000 pages, which is above the current Where background
targeted ceiling and lets cache-aware resume skip old page windows.

Stage 1.12 validates the terminal side of the Where targeted-index lifecycle.
On heavy address `TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn`, the covering target
`2026-07-01T14:10:36.000Z` ran to the 12,000-page ceiling with no 429/403/5xx.
It finished as `partial_provider_cap`; waits were marked terminal; the parent
Where job woke and ended as a technical `provider_cap_unresolved` result instead
of staying in `waiting_for_targeted_index`.

Stage 1.13b adds a bounded exact-window repair for ordinary Where
source-provenance candidates. When funding-first analysis finds a `probable`
candidate because the broad sender history was capped, Where can re-read only
the candidate-to-target transfer window from the local index and one bounded
live TronScan window. If that narrow window is complete and the amount math
still passes, the proof can upgrade to `exact`. This is not a full-address
history fetch and not a separate queued targeted-index task yet.

Where and Incoming now try queued candidate-window targeted indexing before any
broad fallback when funding-first source provenance is `probable`. The trace
selects candidate-to-hop windows and queues targeted states with
`request_kind=candidate_window`, `windowStartTimestamp`, `windowEndTimestamp`,
`relatedHopTxHash`, and `candidateTxHash`. The address indexer reads only
`windowStartTimestamp -> windowEndTimestamp` for those states. Broad targeted
requests remain `request_kind=broad_targeted` and still cover
`genesis -> targetTimestamp`; ordinary Where now reserves that broad request for
hard-evidence unresolved branches, while Incoming keeps its own fallback path.

Candidate-window coverage is narrow proof material only. It is not returned by
broad covering-history lookups, and it does not satisfy broad targeted coverage
for the same address. Parent waits use the full candidate-window identity, so
multiple candidate windows can coexist for one address and end timestamp.

Targeted index states and forensic waits reserve that durable request identity,
so `candidate_window` rows do not collide with broad targeted coverage for the
same address and target timestamp.

Ordinary Where also has a bounded balance-forming slice path for a concrete hop.
This is not a targeted index state and not a full address-history fetch. It
walks related TRC20 transfers backward from the hop's target timestamp and stops
when the incoming funding seen before that transfer can explain the target
amount, or when the local slice page budget/provider state says the slice is
partial. Progress stores compact `balanceFormingSlice` counters and coverage
metadata, not raw transfer rows. A dense or incomplete slice becomes a
source-provenance caveat unless hard evidence requires broader coverage.

## What We Need From TronScan

For provenance checks we need:

- transfer hash;
- from address;
- to address;
- amount;
- token contract;
- timestamp;
- provider pagination data;
- enough history to reach the required target timestamp.

## Current Targeted Coverage

Targeted coverage means:

```text
For address A, fetch enough USDT transfer history to prove what happened before
target timestamp T.
```

For `Where is money` and `Incoming deposit`, targeted coverage is required for
important hop addresses on the money path.

The indexer can mark targeted or all-time coverage as:

- `complete_provider_windowed`;
- `partial_provider_cap`;
- `partial_budget_exhausted`;
- `partial_rate_limited`;
- `partial_provider_inconsistent`;
- `failed_retryable`;
- `failed_terminal`.

## Current Provider Cap Handling

If TronScan reports a capped range, the indexer can split the time window:

```text
large range -> adaptive cursor by oldest returned row -> smaller ranges
fallback: large range -> midpoint split -> smaller ranges
```

Provider cap should not immediately become a final user result. It is a signal
that the indexer needs narrower windows or more budget.

If the provider cap is still unresolved after the configured background budget
and retry escalation, the job can still finish as a technical terminal state.
That is different from the old four-page inline stop.

## Our Budget Is Not Provider Truth

If our local config allows only a few pages and we stop, this is our limit.
It should be represented as `partial_budget_exhausted` or a budget status, not
as proof that TronScan cannot provide the data.

## Planned Behavior

For full provenance, the system should build or repair a local index first and
trace from that index. Live fetches can seed or repair the index, but scoring
should depend on covered indexed history.

Ordinary `Where is money` now requests durable targeted indexing for narrow
candidate windows and uses bounded balance-forming slices before deciding
caveat/block. It requests broad targeted history only when unresolved coverage
intersects hard evidence. Incoming shares the same candidate-window-first
primitive but keeps its own job kind, queued reasons, and fallback path.

## Known Gaps

- Full provenance is not blocked mainly by key count right now. It is still
  affected by targeted page budgets, provider caps, and partial state handling.
- Background targeted indexing now escalates retryable partial states, but the
  values are still code constants rather than product/runtime config.
- Heavy addresses may still need more than the current code-level background
  ceiling; the new cursor makes the work less wasteful but does not remove the
  need for hard safety limits.
- Existing targeted states that were incorrectly marked `complete` by older
  dev/pre-fix runs can be repaired with
  `scripts/repairTargetedIndexCoverage.ts`. The script is maintenance-only and
  not part of ordinary user flow.
- During long live runs, old exact `queued`/`running` states can still be visible
  until a newer covering state reaches `complete` or terminal. Stage 1.10 only
  prevents those old exact states from shadowing finished covering evidence.
- Heavy targeted states can still run for a long time even after Stage 1.11.
  The cache snapshot fix removes wasteful replay of saved windows, but it does
  not make a dense heavy address instantly complete.
- Stage 1.12 proves the lifecycle exits waiting at the current ceiling, but it
  also proves some heavy addresses still need either a higher product budget or
  a better split/indexing strategy to reach complete coverage.
- Candidate-window indexing is resumable and queued, but it is intentionally
  narrow. It proves candidate-to-hop windows; it does not become broad address
  coverage. Ordinary Where now uses bounded balance-forming slices for concrete
  hop funding before any hard-evidence broad fallback.
- Incoming deposit now uses resumable targeted indexing, but it can still end
  with a technical provider/budget stop when narrow windows and broad fallback
  do not cover the required history inside current limits.
- Scheduler metrics exist, but product progress does not yet clearly explain
  whether more keys improved a specific job.
- Split depth/window counts are not yet first-class progress fields. The
  underlying index pages store windows, but Admin targeted progress currently
  focuses on pages, transfers, dates, request counts, and provider/budget flags.
