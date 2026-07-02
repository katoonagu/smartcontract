# Admin Strict Provenance Benchmark Design

Date: 2026-07-02
Status: Draft for user review

## Summary

Build an Admin-only strict provenance benchmark mode for Where Is Money and Incoming-style provenance checks.

This is a separate strict mode for real-address validation. It does not replace normal Telegram `/check` behavior yet. The goal is to prove whether the system can fetch missing hop history to the required target timestamps, avoid scoring on incomplete data, and measure actual runtime with the current TronScan API key pool.

The final forensic score is published only when the required data is covered inside the selected provenance scope. If provider errors or hard limits prevent coverage, the job ends with a technical status and `score_valid=false`, not with a partial forensic verdict.

## Scope

Strict coverage means full coverage inside the selected provenance scope, not "download everything around the wallet forever".

For the first benchmark stage, the selected provenance scope is:

- selected balance-forming incoming transfers;
- paths found from those selected transfers;
- hop addresses needed by those paths;
- each hop history fetched up to the required target timestamp;
- configured `maxDepth`;
- configured hard safety limits.

This mode does not promise global TRON coverage, unlimited second-layer crawling, or all possible neighbor expansion.

## Goals

- Run a strict Admin job on real wallets without changing normal Telegram `/check`.
- Show live progress while the job is collecting data.
- Convert `History not fully fetched` from a final stop into a targeted indexing step when the missing history can be fetched.
- Publish final scoring only after required hop histories are covered.
- Store `score_valid=true` only when the score is based on covered data.
- Store `score_valid=false` and `score_blocked_reason` when provider or hard limits block coverage.
- Measure speed on the current TronScan key pool, currently 4 keys / 4 account groups.
- Break runtime down by API, DB write, DB read, trace, and scoring stages.

## Non-Goals

- Do not enable strict mode for Telegram users in this stage.
- Do not make strict mode the default `/check` behavior.
- Do not build CSV import, browser export, captcha solving, or cookie warming.
- Do not build a global TRON USDT index.
- Do not expand all graph layers indefinitely.
- Do not keep a worker process blocked while waiting for background indexing.

## User-Facing Behavior

Admin starts a strict provenance benchmark job for a wallet or deposit case.

While the job runs, Admin shows progress only:

- selected incoming transfers;
- paths found so far;
- current phase;
- hop addresses found;
- hop addresses covered;
- hop addresses queued for targeted indexing;
- hop address currently indexing;
- pages downloaded;
- oldest fetched timestamp per active hop;
- target timestamp per active hop;
- API request count;
- retry count;
- 429 / 403 / 5xx count;
- cooldown seconds;
- effective RPS;
- elapsed seconds.

Admin does not show a final forensic verdict until the strict data requirement is satisfied.

## Result Semantics

Every strict benchmark result must explicitly store score validity.

Successful scoring:

```json
{
  "score_valid": true,
  "score_blocked_reason": null,
  "technical_status": "completed"
}
```

Blocked scoring:

```json
{
  "score_valid": false,
  "score_blocked_reason": "provider_cap_unresolved",
  "technical_status": "provider_limited"
}
```

Admin must treat `score_valid=false` as "no forensic verdict". It can show coverage, paths, and technical diagnostics, but it must not display the incomplete score as a decision.

## Technical Statuses

Final technical statuses:

- `completed`: required strict coverage was collected and scoring was calculated.
- `provider_error`: provider did not return usable data after retry.
- `rate_limited_after_retries`: 429 or 403 persisted after retry and cooldown.
- `provider_inconsistent`: provider pages were inconsistent after retry.
- `provider_cap_unresolved`: provider cap could not be bypassed by time-window splitting.
- `hard_safety_limit_exceeded`: configured safety limit stopped the job.
- `failed`: internal error unrelated to expected provider limits.

`History not fully fetched` is not a final strict result. It is an intermediate reason to enqueue targeted index work.

## State Machine

Minimum phases:

- `selecting_flows`: choose balance-forming incoming transfers or deposit source transfers.
- `tracing_paths`: build provenance paths from selected transfers.
- `checking_hop_coverage`: check whether local index covers each hop to its target timestamp.
- `indexing_hop_history`: targeted indexing is running for one or more hop addresses.
- `waiting_for_targeted_index`: strict job is waiting for index tasks; the worker does not stay occupied.
- `reading_local_index`: reload hop history from local indexed data.
- `scoring`: calculate final forensic score after coverage is satisfied.
- `completed`: score is valid and persisted.
- `provider_limited`: provider or hard limits blocked coverage; score is invalid.
- `failed`: unexpected internal failure.

The job is one logical job, but not one blocking worker execution. If a hop needs backfill, the job records `waiting_for_targeted_index`, releases the worker, and resumes when the targeted index task completes.

## Data Flow

1. Admin creates a strict benchmark job.
2. The job selects balance-forming incoming transfers.
3. The trace engine finds paths up to `maxDepth`.
4. For every hop, the job checks local indexed coverage up to the required target timestamp.
5. If coverage is missing, the job enqueues targeted index work for that hop and moves to `waiting_for_targeted_index`.
6. When targeted indexing completes, the job resumes and reads the local index again.
7. If coverage is now sufficient, tracing continues.
8. If all required paths are covered, the job enters `scoring`.
9. If scoring succeeds, result stores `score_valid=true`.
10. If provider or hard safety limits prevent coverage, result stores `score_valid=false` with `score_blocked_reason`.

## Benchmark Metrics

The benchmark result must include total metrics and stage metrics.

Total metrics:

- total elapsed seconds;
- total API requests;
- successful API requests;
- failed API requests;
- retries;
- 429 count;
- 403 count;
- 5xx count;
- cooldown seconds;
- pages fetched;
- transfers fetched;
- effective RPS;
- key count;
- account group count.

Stage metrics:

- API time;
- DB write time;
- DB read time;
- trace time;
- scoring time.

The goal is to avoid a useless number like "job took 220 seconds" without knowing whether the bottleneck was TronScan, Postgres, local reads, trace logic, or scoring.

## Current Key Pool Baseline

Current local config has 4 TronScan keys in 4 account groups.

With `TRONSCAN_ACCOUNT_GROUP_REQUEST_MIN_INTERVAL_MS=400`, the theoretical ceiling is:

```text
2.5 RPS per account group
4 groups = about 10 RPS
limit=50 transfers per page
theoretical transfer read ceiling = about 500 transfers/sec
```

The benchmark must report actual effective RPS. The theoretical ceiling is not a success criterion by itself.

## Admin Display

Admin should show strict benchmark progress as operational state, not as a finished verdict.

Example progress copy:

```text
Phase: indexing hop history
Selected flows: 7
Paths found: 7
Hop coverage: 12/17 complete
Current hop: THJ...FMD7
Target timestamp: 2026-06-30T11:52:00.000Z
Oldest fetched: 2024-11-10T03:18:00.000Z
Pages fetched: 84
Requests: 91
429/403/5xx: 0/0/1
Effective RPS: 7.8
```

If scoring is blocked:

```text
No forensic verdict.
Score valid: false
Blocked reason: provider_cap_unresolved
Coverage reached: 14/17 hops
```

## Error Handling

Provider errors must keep enough context to explain why strict scoring was blocked:

- provider name;
- endpoint;
- address;
- target timestamp;
- request parameters;
- HTTP status;
- retry count;
- cooldown applied;
- last successful page;
- oldest fetched timestamp;
- coverage status reason.

The system must distinguish:

- history missing because we have not fetched it yet;
- history fetched and no earlier transfer exists;
- provider prevented us from proving either case.

## Testing

Minimum tests for the first implementation plan:

- strict job does not complete with `score_valid=true` while a required hop is uncovered;
- `incoming_history_not_fetched` schedules targeted indexing in strict mode;
- strict job moves to `waiting_for_targeted_index` instead of blocking the worker;
- completed targeted index resumes the same logical job;
- local index is reread after targeted indexing;
- provider limit stores `score_valid=false` and `score_blocked_reason`;
- Admin graph/progress shows phase and benchmark metrics;
- benchmark metrics split API, DB write, DB read, trace, and scoring time;
- normal Telegram `/check` behavior is unchanged.

## Success Criteria

This stage is successful when a real Admin strict benchmark run can show:

1. Live progress while hop histories are being checked and indexed.
2. No final forensic score until required scope coverage is complete.
3. `score_valid=true` only for covered strict results.
4. `score_valid=false` with a technical reason when provider or hard limits block coverage.
5. `History not fully fetched` converted into targeted indexing when technically fetchable.
6. Benchmark metrics that explain where time was spent.
7. Measured effective RPS on the current 4-key pool.
8. No behavior change for ordinary Telegram `/check`.

