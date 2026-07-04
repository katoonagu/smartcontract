---
status: current
last_verified: 2026-07-04
owner_area: forensics
code_refs:
  - src/index.ts
  - src/storage/repositories.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/targetedHistoryCoordinator.ts
  - src/forensics/addressIndexWorker.ts
  - src/admin/adminServer.ts
  - src/admin/forensicsGraph.ts
  - src/admin/adminConsole.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/strictProvenanceBenchmark.ts
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

`Incoming deposit` jobs do not yet use this shared resumable indexing flow.

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

- `Incoming deposit` still can end on incomplete targeted coverage instead of
  automatically continuing until coverage is complete.
- The inline targeted seed path still uses `TARGETED_HISTORY_INLINE_MAX_PAGES =
  4`; queued Where hop indexing uses a larger background budget.
- Where background budget escalation is implemented for targeted partials, but
  it is still controlled by code constants rather than job-level product
  configuration.
- Progress is richer in Admin than in Telegram. Ordinary Where targeted
  waiting has an Admin progress graph; Telegram does not yet have equivalent
  live progress.
- Targeted index lock heartbeat is updated inside long worker runs. Admin
  progress still focuses on state-level counters; split-window/page streaming is
  not yet a full product progress stream.
