---
status: current
last_verified: 2026-07-03
owner_area: tronscan
code_refs:
  - src/tron/tronClient.ts
  - src/tron/tronscanScheduler.ts
  - src/forensics/tronAddressAllTimeIndex.ts
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

The current live targeted history path is capped by:

```text
TARGETED_HISTORY_INLINE_MAX_PAGES = 4
```

That means a hop can stop as `partial_budget_exhausted` after four pages even
when more TronScan data may exist.

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
large range -> smaller ranges -> day/hour ranges if needed
```

Provider cap should not immediately become a final user result. It is a signal
that the indexer needs narrower windows or more budget.

## Our Budget Is Not Provider Truth

If our local config allows only a few pages and we stop, this is our limit.
It should be represented as `partial_budget_exhausted` or a budget status, not
as proof that TronScan cannot provide the data.

## Planned Behavior

For full provenance, the system should build or repair a local index first and
trace from that index. Live fetches can seed or repair the index, but scoring
should depend on covered indexed history.

Ordinary `Where is money` and `Incoming deposit` should request more targeted
indexing and resume when a required hop is incomplete.

## Known Gaps

- Full provenance is not blocked mainly by key count right now. It is blocked
  by targeted page budget and partial state handling.
- `TARGETED_HISTORY_INLINE_MAX_PAGES = 4` is too small for active hop
  addresses.
- Existing partial targeted states can block later strict benchmark runs.
- Scheduler metrics exist, but product progress does not yet clearly explain
  whether more keys improved a specific job.
