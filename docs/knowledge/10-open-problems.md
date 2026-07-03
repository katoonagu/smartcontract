---
status: current
last_verified: 2026-07-03
owner_area: docs
code_refs:
  - src/index.ts
  - src/forensics/tronAddressAllTimeIndex.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
  - src/check/deepForensicCheck.ts
supersedes:
  - docs/superpowers/plans/2026-07-02-admin-strict-provenance-benchmark.md
  - docs/superpowers/plans/2026-07-03-where-incoming-outcome-safety.md
---

# Open Problems

## Provenance Coverage

- Targeted hop history can stop on small local page budgets.
- Existing partial targeted index states can block later runs instead of being
  resumed.
- `History not fully fetched` still appears in graph UI for old and partial
  jobs.
- Where/Incoming need a normal "continue indexing, then resume trace" flow.

## TronScan Indexing

- Page budgets need explicit job-level and hop-level configuration.
- Time-window splitting must be used when provider cap is hit.
- Scheduler metrics should make clear whether 4, 10, or more keys are actually
  improving throughput.
- Progress should show pages, dates, requests, 429, 403, and 5xx.

## DeepCheck

- Second-layer metrics can show an empty queue even when a budget exists.
- Direct counterparty hard-evidence checks should become wider and clearer.
- Missing checks should be split into provider errors, local budget limits,
  service-boundary stops, and diagnostic notes.

## UX

- Telegram needs plain language for technical coverage blocks.
- Admin should distinguish old cached jobs from fresh live runs.
- Buttons that start jobs should show which address they used and which job id
  was queued.
