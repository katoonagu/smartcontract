---
status: current
last_verified: 2026-07-03
owner_area: tronscan
code_refs:
  - src/tron/tronClient.ts
  - src/tron/tronscanScheduler.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/index.ts
  - src/config.ts
  - tests/config/config.test.ts
  - tests/tron/tronscanScheduler.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
supersedes:
  - docs/provider-observations/tronscan-usdt-pagination.md
  - docs/superpowers/specs/2026-07-02-api-all-time-indexer-design.md
  - docs/project-walkthrough/11-data-sources-and-coverage.md
---

# TronScan Data And Indexing

## Current Behavior

The project uses TronScan as the primary source for TRON USDT transfer history
in this phase. There is no manual CSV product workflow.

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
answer for required hops. The job queues a targeted index task and waits.
Queued Where hop indexing currently uses a larger background budget:

```text
TARGETED_HISTORY_BACKGROUND_MAX_PAGES = 200
TARGETED_HISTORY_BACKGROUND_MAX_PAGES_PER_HOP = 12000
TARGETED_HISTORY_BACKGROUND_MAX_WINDOW_SPLIT_DEPTH = 24
TARGETED_HISTORY_BACKGROUND_MAX_ATTEMPTS = 8
```

When a background targeted task stops with retryable partial coverage, the
address index worker can requeue it instead of waking the parent job:

- `partial_budget_exhausted` escalates page budget;
- `partial_rate_limited` stays retryable;
- `partial_provider_cap` stays retryable when the local page budget was also
  exhausted;
- old targeted partial states can be requeued with a larger budget when the
  previous attempt cap was reached.
- long running targeted tasks update lock heartbeat while fetching pages.

For capped TronScan windows, the indexer now tries an adaptive cursor split
before the old midpoint split. If the capped page returns rows, the next older
window ends just before the oldest raw row returned by that page. This avoids
repeatedly fetching the same top page for heavy addresses. If the cursor would
not move the window by a useful amount, the indexer falls back to the midpoint
split.

Same-address targeted waits are coalesced by coverage semantics: a state that
indexes address `A` up to a later target timestamp can cover waits for earlier
target timestamps on the same address. The worker should not spend budget on an
older queued target while a newer queued/running target for the same address is
available.

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

Ordinary `Where is money` now requests targeted indexing and resumes when a
required hop is incomplete. `Incoming deposit` still needs the same flow.

## Known Gaps

- Full provenance is not blocked mainly by key count right now. It is still
  affected by targeted page budgets, provider caps, and partial state handling.
- Background targeted indexing now escalates retryable partial states, but the
  values are still code constants rather than product/runtime config.
- Heavy addresses may still need more than the current code-level background
  ceiling; the new cursor makes the work less wasteful but does not remove the
  need for hard safety limits.
- Incoming deposit does not yet use resumable targeted indexing.
- Scheduler metrics exist, but product progress does not yet clearly explain
  whether more keys improved a specific job.
- Split depth/window counts are not yet first-class progress fields. The
  underlying index pages store windows, but Admin targeted progress currently
  focuses on pages, transfers, dates, request counts, and provider/budget flags.
