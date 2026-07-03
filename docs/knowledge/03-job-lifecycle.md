---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/index.ts
  - src/storage/repositories.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
supersedes:
  - docs/project-walkthrough/10-check-lifecycle-plain-language.md
  - docs/superpowers/specs/2026-06-03-forensic-job-lifecycle-cross-chain-progress-design.md
---

# Job Lifecycle

## Basic Flow

A forensic job should have a visible lifecycle:

```text
created -> queued -> running -> scoring -> completed
```

Long provenance checks need extra states:

```text
running -> indexing_history -> waiting_for_index -> running -> scoring
```

The user still sees one check. Internally, index tasks may run separately so
the worker does not block inside one long `await`.

## Background Does Not Mean Separate Product

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

## Technical Stops

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

If a job cannot cover a required money path, the result should store:

```json
{
  "score_valid": false,
  "score_blocked_reason": "insufficient_coverage",
  "technical_status": "provider_cap_unresolved"
}
```

The bot and Admin should not turn this into a final decline.

## Current Direction

`Where is money` and `Incoming deposit` should move toward resumable indexing.
If a hop history is incomplete, the job should request more index coverage,
wait, then continue trace and scoring.
