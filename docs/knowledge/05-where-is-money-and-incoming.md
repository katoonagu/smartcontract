---
status: current
last_verified: 2026-07-27
owner_area: forensics
code_refs:
  - src/forensics/moneyOriginTrace.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/forensicCoverageV2.ts
  - src/forensics/recentFlowProvenanceSelection.ts
  - src/forensics/selectiveTransactionEnrichment.ts
  - src/storage/repositories.ts
  - src/unifiedCheck/branchAdapters.ts
  - src/unifiedCheck/report.ts
  - src/unifiedCheck/presentation.ts
---

# Where Is Money And Incoming Deposit

## Questions

Where Is Money explains where the wallet sent funds. Incoming Deposit explains
where a selected received amount came from. They use related transfer evidence
but have different subjects, denominators, and directions.

## Production Truth

The deployed runtime still runs legacy Where/Incoming jobs and their existing
score-validity/coverage behavior. A technical coverage stop is not a clean
verdict. Unknown labels are not evidence of safety or risk by themselves.

## Unified Where And Incoming

Where and balance-origin analysis are evidence-only Unified children. They may
fetch and resume work but cannot send Telegram or choose the final score. Their
facts are normalized and deduplicated with Fast and Deep before scoring.

The report aggregates repeated direct transfers by service and direction,
showing amount, share, and transaction count. Direct incoming, direct outgoing,
and indirect paths remain semantically distinct. Confirmed CEX/DEX/bridge
labels are shown with their direction; unknown counterparties remain neutral
unless behavior supplies a separate risk pattern.

For a zero or very small current balance, the deterministic recent-funding
episode uses up to five latest relevant funding events, filters dust/spam, and
follows where those funds moved. There is no abrupt 1,000-USDT product switch.

Coverage remains a factual denominator, not a risk floor or publication gate.
`COMPLETED` requires traversal closure and produces one parent score.
Provider/execution failure remains `FAILED_TECHNICAL` without a partial report.

Exact TRON movement and traced-coverage proof requires rich identity on every
contributing on-chain edge: a transfer ID, an event index, or a provider plus
its row ordinal within the transaction. Legacy transaction/from/to/amount
tuples remain valid for traversal and compatibility deduplication, but cannot
by themselves prove exactly one emitted movement or contribute exact traced
coverage.

When a legacy row's tuple matches one or more rich rows, the legacy shadow is
suppressed while each distinct rich event remains separate. Legacy-only
duplicates continue to use the compatibility tuple for deduplication.

Route assertion lookup uses only active assertion records linked by an exact
route address or exact `approvalTxHash`, `drainTxHash`, or `pathTxHashes`
value. Inputs are validated and deduplicated, malformed JSON shapes are ignored
safely, and rows are returned in deterministic assertion-ID order. Flat address
labels and suggestive category/name text are not assertion authority; the
selective enrichment policy must repeat its own strict rich-evidence match.

The selective enrichment policy deduplicates route candidates by normalized
transaction hash and processes known hard candidates before optional context.
Subject analysis has no numeric ceiling that can drop a hard full-information
trigger. Intermediate-boundary analysis permits at most five triggered full
requests; overflow remains explicit missing evidence, keeps the adverse gate
incomplete, forbids an inferred stop, and continues traversal. A finalized
failed or reverted transaction is proven technical evidence but never clean;
unavailable, non-final, conflicting, or corrupt evidence remains technical
unknown and incomplete.

This contract is implemented and tested. Delivery ownership is separate from
the analysis path and does not gate isolated execution.

Stage B Where and Incoming use the shared selective resolver for
balance-forming, money-origin, GasFree, approval, and contract context. Plain
`REVIEW` paths receive raw proof without automatically fetching full details.
All eight hard triggers still reach full evidence and the existing semantic
parsers; optional context may be capped, but hard subject evidence is not.
Exact route-linked active assertions override optional approval mode, while
flat labels do not authorize a full request.

Incoming merges selective results from its deposit/funding pre-processing and
post-processing with the nested Where result. Those outer calls pass exact
active assertions and emit claim-fenced heartbeat progress. Their evidence IDs
are completion-owned too; an incomplete outer result makes the combined
transaction coverage partial instead of being hidden by a complete Where run.

If raw and full providers both fail to produce final evidence, the report keeps
a stable transaction-evidence-incomplete note, sets local coverage partial,
and publishes no clean enrichment fact. Where and Incoming completion persist
the resolver evidence IDs alongside IDs already owned by the job.
This structured incomplete/technical coverage has zero direct score impact: it
cannot add risk, prove safety, authorize a service boundary, or be converted
into a clean transaction conclusion. Finalized failed/reverted evidence is
reusable technical-proven evidence, but it remains adverse/incomplete rather
than proving `plain_usdt_raw_proven`.

Where and Incoming runner-owned writes require the non-null claim generation
returned by PostgreSQL. Claim loss stops traversal/enrichment at the worker
boundary: an in-flight shared provider promise may settle only as reusable
immutable evidence, while no later fallback, risk record, result, or Telegram
delivery intent may be attached to the reclaimed job.

Where terminal progress stores count-only queue/slot, enrichment, and
scheduler timing under `performanceTiming`; the matching lifecycle logs contain
no address, transaction hash, chat/key identifier, label, or username.
Incoming keeps its separate lane and existing `queueWaitMs`/stage timing. Its
timing log is aggregate-only and no longer repeats job, deposit, wallet,
sender, or Telegram identities.
Where and Incoming `queueWaitMs` use the persisted post-index runnable
transition, so targeted-index waiting is not reported as runnable queue delay;
jobs that never waited retain creation-to-claim timing.

Stage B behavior is code-complete, while live rollout evidence is separate.
Where remains at concurrency 1 until the real TXc replay and isolated
concurrency-two receipt pass. Deep remains a singleton and its residual queue
latency has not yet been measured; no Where test or synthetic runtime result
may stand in for that measurement.
