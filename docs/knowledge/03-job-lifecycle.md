---
status: current
last_verified: 2026-07-13
owner_area: forensics
code_refs:
  - src/index.ts
  - src/runtime/startupSchemaGate.ts
  - src/storage/schemaMigrations.ts
  - src/storage/repositories.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/admin/adminServer.ts
  - src/admin/forensicsGraph.ts
  - src/admin/adminConsole.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/strictProvenanceBenchmark.ts
  - src/monitor/addressPoisoningWorker.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/addressIndexWorker.test.ts
  - tests/forensics/targetedHistoryCoordinator.test.ts
  - tests/forensics/tronAddressAllTimeIndex.test.ts
  - tests/forensics/incomingDepositJob.test.ts
  - tests/storage/forensicCheckJobs.test.ts
supersedes:
  - docs/project-walkthrough/10-check-lifecycle-plain-language.md
  - docs/superpowers/specs/2026-06-03-forensic-job-lifecycle-cross-chain-progress-design.md
---

# Job Lifecycle

## Current Behavior

### Plan 1 Candidate: Schema 032 Startup Gate

The Plan 1 candidate does not start providers, Telegram, or background workers
until schema 032 is verified. Startup fails closed when the receipt is missing,
the filename or SHA-256 checksum differs from the migration bytes, or the
required columns, constraints, index, and allowance-state shapes do not match.

Migration receipts are authoritative from version 032 onward. Migrations
001–031 remain legacy and untracked; the new migrator does not invent receipts
for them. Schema 032 is applied and verified transactionally under an advisory
lock. Later tracked migrations must first verify the required 032 receipt and
structure.

This is candidate behavior only. Production remains on the previous runtime
and schema 031 until the cross-plan release in Plan 5. Plan 1 must not apply
schema 032 to production or restart the production bot.

Forensic jobs are stored with these repository statuses:

```text
queued -> running -> partial -> completed -> failed -> cancelled
```

The known job kinds are:

```text
address_fast_check
address_deep_check
where_is_money_check
incoming_deposit_check
```

`address_fast_check` is saved directly as a finished job. It is not claimed by
the forensic worker queue.

The background worker schedule starts from `src/index.ts` independently of
Telegram bot startup. Admin can be reachable while Telegram is delayed or
unavailable, and queued forensic jobs should still be claimed by the scheduled
workers. `bot.start(...onStart)` also calls the same starter, but the starter is
guarded against double scheduling.

`address_deep_check` polling claims queued DeepCheck jobs without waiting for
the address index worker to finish. Address indexing runs on its own guarded
schedule; DeepCheck may kick it opportunistically, but a busy address index
worker must not leave DeepCheck jobs stuck in `queued`.

Admin-only strict benchmark jobs have a partial resumable flow. They can move
to `waiting_for_targeted_index` while a targeted index task is queued, then
resume after the index task finishes.

Ordinary `Where is money` jobs now have the Stage 1 targeted wait/resume flow:
when a required hop needs targeted history, the parent job queues an index
task, moves to `waiting_for_targeted_index`, releases the worker, and resumes
after the address index worker marks the targeted state ready or terminal.
The release step is idempotent for a job that is already queued with
`jobPhase=waiting_for_targeted_index`, because parallel trace branches can find
different required hops in the same run.

Stage 1.5 adds background retry/escalation for ordinary Where targeted index
tasks. Retryable targeted states such as `partial_budget_exhausted`,
`partial_rate_limited`, and budget-exhausted `partial_provider_cap` keep the
parent job waiting while the address index worker requeues the targeted state
with a larger background page budget where possible. Old partial targeted
states that already reached their previous attempt cap can be requeued when a
larger page budget is available.

Address index claims preserve `locked_until` while a state is running, and
stale running states can be reclaimed after the lock expires.

Stage 1.6 adds Admin visibility for ordinary Where waiting jobs. A queued
`where_is_money_check` in `waiting_for_targeted_index` can now be projected as a
progress graph while it is waiting. This graph is explicitly not a final score:
decision is `UNKNOWN`, risk score is `null`, and the limitation says the job is
waiting for targeted history rather than stuck.

Stage 1.7 improves heavy targeted indexing. The address index worker passes lock
context into long targeted runs, and the indexer emits best-effort heartbeat
updates so a live worker does not look stale while it is still fetching pages.
For same-address targeted waits, a later target timestamp can cover earlier
waits because targeted coverage is indexed from genesis up to the target.
Generic wait wakeup therefore accepts a completed later target for earlier waits.

Where and Incoming candidate-window indexing now run before any broad fallback
for probable funding-first source provenance. If a narrow candidate window is
not ready, the parent job enters `waiting_for_targeted_index` for
`request_kind=candidate_window`. For ordinary Where, candidate windows are
narrow proof material only: if they do not cover ordinary material unresolved
context, the job uses the bounded balance-forming slice for the concrete hop and
then records a materiality caveat or block. Ordinary Where broad targeted
fallback is reserved for unresolved branches that intersect hard evidence.
Incoming deposit keeps its separate `incoming_hop` / `incoming_deposit_hop`
fallback path.

For ordinary `Where is money`, a resumed parent job whose targeted terminal
reason is `partial_provider_cap` is not completed from `provider_limited`
progress alone. The parent reruns the Where report builder against cached
indexed transfers so `moneyOriginOperationalAssessment` can apply materiality
rules. Non-provider-cap terminal reasons still use the technical terminal path,
and provider-cap with no usable cached evidence can still finish as an invalid
technical stop.

### Address-Poisoning Safety Lifecycle

The poisoning monitor has its own small state machine on each observed incoming
transaction. The main wallet poll writes the initial state atomically with the
new `observed_transactions` row and never waits for relationship history:

```text
pending -> running -> candidate | clear | inconclusive | failed
                 \-> skipped | skipped_backfill
```

Old rows and historical backfill default to `skipped_backfill`. A fresh row is
eligible only for official USDT, an active non-paused watched wallet, and an
amount up to the configured raw-unit threshold. Each worker claim reads one
logical page of at most 100 transfers and saves its provider/range metadata,
offsets, hashes, overlaps, accepted evidence, page count, oldest accepted
transfer time, and `complete` or `partial` coverage.

Freshness is part of ownership, not a best-effort check. The cutoff is inside
the atomic repository claim. After scheduler/provider delay, a lease-bound gate
runs before candidate, clear, inconclusive, or failure persistence. If the
event expired, that gate writes `skipped_backfill`, including on the error path.
Partial negative evidence is `inconclusive`, never `clear`. Partial evidence may
become `clear` only from an exact earlier direct relationship, an authorized
`service_admin` trusted/false-positive label, or an exact authoritative service
address.

Provider failures consume at most four executions: the initial execution and
three retries after 30, 60, and 120 seconds. The repository owns this attempt
policy; the fourth failure is terminal. An inconclusive history lookup instead
continues one saved page per claim up to five pages and never restarts page one.
A retryable `inconclusive` row has a non-null retry time and no `checked_at`;
an exhausted provider range or the fifth page produces terminal
`inconclusive` with no retry time and a populated `checked_at`. Terminal partial
rows are excluded from claims and queue-depth metrics even when the provider
range ended before page five.

The saved 24-hour lookup window must exactly match the timestamp of the current
incoming transfer. The same strict audit validates live and persisted TronScan
pages before any accepted transfer reaches the detector: provider, offsets,
range totals, completion, exact raw-row identities, and SHA-256 page hashes must
all agree. An invalid live page is discarded before merge, does not advance
offset/page/fetched progress, and uses the bounded provider-failure retry at the
same offset. Before the fifth-page limit, only a strictly validated exhausted
page may make trusted historical partiality terminal; a valid non-exhausted
fifth page is still terminal at the configured cap. For rejected persisted
facts, only raw-row identities and page-audit metadata remain visible; the
rejected facts themselves cannot create or suppress a warning.

One positive check atomically stores raw evidence, one zero-impact
`wallet_safety` observation, one candidate, and the observed-row terminal state.
Candidate status is `candidate`, `confirmed`, or `dismissed`. Owner callbacks
are compare-and-set transitions: the first terminal choice wins, repeating the
same choice is idempotent, and the opposite choice returns a neutral conflict.

Alert delivery has a separate lifecycle:

```text
pending -> sending -> sent | failed | skipped
```

Delivery claims are taken just before a send slot is free. The locale is fixed
on the first claim. A claim increments a generation counter; at most four send
executions are allowed. Telegram receives an abortable 30-second deadline,
implemented with `AbortController` rather than `Promise.race`; it is shorter
than the 40-second heartbeat and 120-second stale reclaim window.

The dedicated alert lease timestamp owns heartbeat/liveness and stale reclaim.
The monotonic `alertAttempt` generation separately owns `sent`, `failed`, and
`skipped` terminal compare-and-set writes. A started heartbeat stays active
until the final database acknowledgement finishes. Repository row locking plus
the generation predicate serializes stale reclaim against finalization; an old
generation cannot acknowledge a reclaimed send. Check and delivery phases have
independent non-overlap guards, so a slow Telegram send does not stop new
poisoning checks. Telegram delivery remains at-least-once because its external
acceptance cannot be atomic with the database acknowledgement.

Normal Incoming Deposit analysis remains independent. Immediately before its
message is formatted, it queries whether the same incoming transaction has an
active `candidate` or `confirmed` warning. A dismissed candidate removes the
line. A lookup failure is logged and Incoming delivery continues; the safety
lookup never changes its score, decision, or `shouldSend` result.

## Planned Behavior

Long provenance checks should expose a product-level lifecycle like this:

```text
created -> queued -> running -> indexing_history -> waiting_for_index -> running -> scoring -> completed
```

The user should still see one check. Internally, index tasks may run separately
so the worker does not block inside one long `await`.

"Background index task" means technical decomposition inside one user request.
It does not mean a second product mode and it does not mean the user is ignored.

The parent job should show progress:

- selected deposits or balance-forming transfers;
- required hop addresses;
- covered hop addresses;
- currently checked balance-forming slice;
- currently indexing address;
- pages fetched;
- oldest reached date;
- request counts;
- rate limits and provider errors.

## Current Technical Stops

A technical stop means the system could not produce a valid forensic score
because required data was not covered.

Technical stop is not the same as a risk verdict.

Examples:

- `budget_limited`;
- `provider_cap_unresolved`;
- `hard_safety_limit_exceeded`;
- `provider_error`;
- `rate_limited_after_retries`;
- `provider_inconsistent`.

## Score Validity

Some paths already store invalid-score fields. For example, strict benchmark
jobs and selected Incoming/Where safety flows can store:

```json
{
  "score_valid": false,
  "score_blocked_reason": "insufficient_coverage",
  "technical_status": "provider_cap_unresolved"
}
```

The bot and Admin should not turn this into a final decline. This is partly
implemented, but not yet consistent across every ordinary Where/Incoming path.

## Known Gaps

- `Incoming deposit` now uses the shared candidate-window-first wait/resume
  flow, but it can still finish with a technical terminal status if candidate
  windows plus broad fallback cannot cover the required hop inside provider and
  safety limits.
- The inline targeted seed path still uses `TARGETED_HISTORY_INLINE_MAX_PAGES =
  4`; queued Where hop indexing uses a larger background budget.
- Where background budget escalation is implemented for targeted partials, but
  it is still controlled by code constants rather than job-level product
  configuration.
- Progress is richer in Admin than in Telegram. Ordinary Where targeted
  waiting and bounded balance-forming slice checks have Admin progress
  graph/card states; Telegram does not yet have equivalent live progress.
- Targeted index lock heartbeat is updated inside long worker runs. Admin
  progress still focuses on state-level counters; split-window/page streaming is
  not yet a full product progress stream.
