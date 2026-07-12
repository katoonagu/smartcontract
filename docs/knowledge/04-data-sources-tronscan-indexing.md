---
status: current
last_verified: 2026-07-12
owner_area: tronscan
code_refs:
  - src/tron/tronClient.ts
  - src/tron/tronscanScheduler.ts
  - src/tron/usdtBlacklistTimeline.ts
  - src/check/theftReportTransaction.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/fundingFirstSourceProvenance.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/forensics/targetedIndexRepair.ts
  - src/forensics/localTronUsdtIndex.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
  - src/storage/repositories.ts
  - src/index.ts
  - src/config.ts
  - src/monitor/addressPoisoningWorker.ts
  - scripts/repairTargetedIndexCoverage.ts
  - tests/config/config.test.ts
  - tests/tron/tronscanScheduler.test.ts
  - tests/tron/tronClient.test.ts
  - tests/tron/usdtBlacklistTimeline.test.ts
  - tests/check/theftReportTransaction.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
  - tests/forensics/fundingFirstSourceProvenance.test.ts
  - tests/forensics/addressIndexWorker.test.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/forensics/targetedIndexRepair.test.ts
  - tests/forensics/localTronUsdtIndex.test.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/incomingDepositJob.test.ts
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

### Bounded Address-Poisoning Lookup

The realtime poisoning monitor uses the same TronScan key pool and scheduler as
the other checks, but a separate client is configured with a five-second
request timeout, zero client retries, `interactive_fast` priority, and an
`address_poisoning` deduplication namespace. The namespace prevents a poisoning
request from sharing a cached in-flight result with a deeper transfer request
that has different latency requirements.

Poisoning uses `listRelatedTrc20TransferPagePinned`, which calls TronScan only
and never switches provider inside the evidence page. Ordinary transfer methods
retain their current TronGrid fallback. A logical poisoning page contains at
most 100 rows and uses at most two internal provider calls of 50 rows each.

The main wallet monitor does not fetch relationship history. It only writes a
fresh eligible poisoning check together with the observed official-USDT
transfer. A dedicated worker requests one logical page per claim, at most 100
provider rows, with strict bounds from 24 hours before the incoming timestamp
through one millisecond before it. It accepts confirmed, successful,
non-reverted transfers of the official TRON USDT contract and persists raw
provider facts plus normalized raw amounts for reuse. TronScan's
`riskTransaction` flag is saved as context but is not transaction validity: a
canonical relationship transfer still counts when that flag is true.

Completion requires authoritative, internally consistent provider/range
metadata. Saved audit data includes provider identity, requested/start/next
offsets, raw count, `total`, `rangeTotal`, complete/consistent flags, raw and
canonical hashes, per-fact provider identity, and overlap ids. A non-null
authoritative `rangeTotal` is required for completion; `total` may be null. If
both are present, they must be consistent and `rangeTotal <= total`. Mixed
providers, missing or contradictory `rangeTotal`, contradictory paired totals,
short nonterminal or oversized pages, unexplained no progress, repeated rows
inside a logical page, or overlap with a previous claim keep coverage partial.
They can support a positive candidate or exact disqualifier, but never a
negative `clear`.

A consistent full page advances the saved logical offset. The worker can
continue for at most five pages. A negative partial result remains
`inconclusive`, so provider pagination or local limits cannot silently turn
unknown history into a clean sender.

The worker runs every 30 seconds, claims at most 20 checks, and processes at
most two lookups concurrently. Check and Telegram-delivery phases run behind
separate guards. Queue and latency logs use these events and fields:

- `address_poisoning_lookup_completed`: `txHash`, `providerLatencyMs`,
  `pageCount`, `fetchedCount`, and `coverage`; successful page processing also
  logs the accumulated `provider`, while a failed lookup logs
  `coverage=failed` without `provider`;
- `address_poisoning_cycle_completed`: `queueDepth`, `oldestQueueAgeMs`,
  `claimed`, `durationMs`, and `timeoutCount`;
- `address_poisoning_alert_sent`: `candidateId`, `classification`,
  `queueAgeMs`, and `alertLatencyMs`.

If queue metrics cannot be read, depth and age are logged as `null`, not as a
false zero. Operational logs do not include full watched/sender addresses,
Telegram user or chat identifiers, provider keys, or tokens.

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

### Address-Scoped USDT Blacklist Timeline

Current USDT blacklist state comes from the official USDT contract. When that
state is active and event history is requested, the Tron client also reads the
address-scoped TronScan `/api/stableCoin/blackList` timeline. The provider rows
are only an index of candidate transactions: each candidate must be a
successful transaction and must decode to an `AddedBlackList` or
`RemovedBlackList` log from the official USDT contract for the exact address.

The saved timeline separates current state from chronology. Current active
state remains exact contract evidence even if event history is incomplete;
dates, event kind, block order, and transaction id are used only when the
corresponding contract log is verified. Pagination, duplicate rows,
address/contract mismatch, unconfirmed transactions, undecodable logs, and a
timeline that disagrees with current state cannot become a false complete
history.

A verified result stores `pagination=complete` and the ordered events. A
provider or validation failure stores `pagination=partial` with a typed reason:
`provider_failed`, `address_mismatch`, `wrong_contract`,
`transaction_unconfirmed`, `event_log_unverified`, or
`state_timeline_inconsistent`. A partial timeline makes blacklist chronology
unknown; it does not turn an active current restriction into an inactive one.
Inactive counterparties do not trigger the extra historical scan.

### Complete Index Versus Local Materialization

A complete provider index proves that the relevant rows are available locally.
It does not prove that one bounded repository read contains the transfer needed
for an exact provenance conclusion. Where and Incoming therefore materialize
the concrete indexed time window page by page, using stable newest-first offset
ordering.

Materialization stops only when the existing amount/funding proof is satisfied,
the local window is exhausted, or a local safety condition is reached. A short
final page proves window exhaustion; an empty exhausted window is recorded as
known zero. The bounded outcomes are distinct:

- `complete`: proof satisfied or window exhausted;
- `local_limit`: more local rows exist beyond the materialization ceiling;
- `read_failed`: the local database read failed.

`local_limit` and `read_failed` are local availability failures. They do not set
`providerCapHit=true`, do not become provider-cap evidence, and do not create
risk. A complete local state for the same materialized window is consumed
without a new provider call; acquisition for a different window remains a
separate question.

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
