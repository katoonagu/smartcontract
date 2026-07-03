---
status: current
last_verified: 2026-07-03
owner_area: tronscan
code_refs:
  - src/tron/tronClient.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/index.ts
  - src/config.ts
supersedes:
  - docs/provider-observations/tronscan-usdt-pagination.md
  - docs/superpowers/specs/2026-07-02-api-all-time-indexer-design.md
  - docs/project-walkthrough/11-data-sources-and-coverage.md
---

# TronScan Data And Indexing

## Current Data Source

The current plan uses TronScan as the primary source for TRON USDT transfer
history. We do not use manual CSV import and we do not add another provider for
this phase.

The system may use many TronScan API keys. More keys increase throughput, but
they do not fix our own page budgets or partial state handling by themselves.

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

## Targeted Coverage

Targeted coverage means:

```text
For address A, fetch enough USDT transfer history to prove what happened before
target timestamp T.
```

For `Where is money` and `Incoming deposit`, targeted coverage is required for
important hop addresses on the money path.

## Provider Cap

If TronScan reports a capped range, the indexer should split the time window:

```text
large range -> smaller ranges -> day/hour ranges if needed
```

Provider cap should not immediately become a final user result. It is a signal
that the indexer needs narrower windows or more budget.

## Our Budget Is Not Provider Truth

If our local config allows only a few pages and we stop, this is our limit.
It should be represented as `partial_budget_exhausted` or a budget status, not
as proof that TronScan cannot provide the data.

## Key Pool

The key pool should:

- distribute requests across keys;
- avoid hitting 429 as normal control flow;
- cool down keys that are near limits;
- retry transient 5xx/network errors;
- record request counts, pages, transfers, 429, 403, and 5xx.

## Full Answer Direction

For full provenance, the system should build a local index first and trace from
that index. Live fetches can seed or repair the index, but scoring should depend
on covered indexed history.
