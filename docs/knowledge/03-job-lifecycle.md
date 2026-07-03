---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/index.ts
  - src/storage/repositories.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/strictProvenanceBenchmark.ts
  - tests/forensics/deepForensicJob.test.ts
  - tests/forensics/incomingDepositJob.test.ts
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

Admin-only strict benchmark jobs have a partial resumable flow. They can move
to `waiting_for_targeted_index` while a targeted index task is queued, then
resume after the index task finishes.

Ordinary `Where is money` and `Incoming deposit` jobs do not yet have a shared
general resumable indexing flow that keeps expanding targeted hop history until
full coverage is reached.

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

- Ordinary `Where is money` and `Incoming deposit` still can end on incomplete
  targeted coverage instead of automatically continuing until coverage is
  complete.
- The live targeted index path currently uses
  `TARGETED_HISTORY_INLINE_MAX_PAGES = 4`.
- Existing partial targeted index states can be treated as terminal by strict
  benchmark jobs.
- Progress is richer in Admin than in Telegram.
