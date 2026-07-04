# Resumable Targeted Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Keep implementation commits small. Do not start with broad rewrites.

**Goal:** `History not fully fetched` must stop being a final paid result for required Where/Incoming money paths. If a required hop lacks old enough history, the parent job queues/resumes targeted indexing, waits without holding a worker, then continues trace and scores only after coverage is complete or a real provider/safety terminal state is reached.

**Architecture:** Generalize the existing strict-provenance wait/resume idea into a shared targeted-history coordinator. Parent forensic jobs keep their logical job id. Targeted address history runs through the existing `tron_address_usdt_index_states` queue and address index worker. Parent jobs move between `running` and queued waiting states until the index worker completes or reaches a terminal technical limit.

**Tech Stack:** TypeScript, PostgreSQL migrations, existing forensic job queue, existing TronScan scheduler/key pool, Vitest.

---

## Current Code Facts

- `src/index.ts` sets `TARGETED_HISTORY_INLINE_MAX_PAGES = 4` and passes it to every targeted `ensureAddressUsdtHistory` call.
- `src/forensics/tronAddressAllTimeIndex.ts` can resume from already completed pages and can split provider windows, but it receives a per-run page budget from `maxPagesPerRun`.
- `src/storage/repositories.ts` already stores targeted index states keyed by `(address, token_contract, coverage_mode, target_timestamp_ms)` and has `budget_pages` / `budget_seconds` columns.
- `src/forensics/deepForensicJob.ts` already has strict benchmark wait/resume behavior, but it is strict-only and treats existing `partial` targeted states as terminal.
- `src/forensics/addressIndexWorker.ts` wakes only `requestedByJobId` through `markStrictProvenanceJobReadyAfterIndex`.
- `src/index.ts` runs `addressIndexOnce()` before DeepCheck, but ordinary Where and Incoming pollers do not run an index pass before processing their own jobs.
- `src/forensics/incomingDepositJob.ts` currently converts mandatory targeted coverage misses into `scoreValid=false` / `NO_FINAL_DECISION`, not a resumable parent wait.

## Product Invariant

For a required money path:

- `incoming_history_not_fetched` is an internal trace state, not a final paid answer.
- A local page budget such as 4 pages per hop can only be an inline seed budget. It cannot be the final stop for a required hop.
- Final score is allowed only when required hop history is covered, or when the path reaches an honest boundary such as known CEX/service/contract boundary, or when the provider/safety limit is terminal and the result is explicitly technical.
- Provider/safety terminal states still exist: `rate_limited_after_retries`, `provider_inconsistent`, `provider_cap_unresolved`, `hard_safety_limit_exceeded`, `provider_error`.

Required hop means:

- Where/Admin Stage 1: a hop used by the selected balance-forming flow that the trace needs to prove source lineage.
- Incoming Stage 2: a hop from a selected incoming deposit provenance path where `selectedAmountShare(path) > 0`.
- Non-selected diagnostic branches can stay partial and must not block score unless the selected path depends on them.

## Target Lifecycle

1. Parent forensic job is `running`.
2. Trace asks for a hop address history before `targetTimestamp`.
3. Shared coordinator checks local indexed coverage.
4. If targeted state is `complete`, trace reads local index and continues.
5. If state is missing, queued, running, retryable, or budget-partial but resumable, coordinator queues/requeues a targeted index task.
6. Parent job writes progress:
   - `jobPhase: "waiting_for_targeted_index"`;
   - `waitingFor.address`;
   - `waitingFor.targetTimestamp`;
   - `waitingFor.requiredFor`;
   - current pages/transfers/status if known.
7. Parent job is released back to queued/waiting state. No worker remains blocked.
8. Address index worker claims targeted index state and continues pages/window splitting from existing completed pages.
9. When index completes or reaches terminal technical status, waiting parent job is marked ready.
10. Parent resumes, reruns trace from local index, and either:
    - continues to next hop;
    - scores with `score_valid=true`;
    - or completes with technical `score_valid=false` only for terminal provider/safety reasons.

## State And DB Changes

Prefer one small new table for parent waiters. `requested_by_job_id` is not enough because more than one parent job can wait for the same targeted index state.

Create migration `migrations/027_forensic_job_waits.sql`:

```sql
create table if not exists forensic_job_waits (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  wait_type text not null,
  address text not null,
  coverage_mode text not null default 'targeted',
  target_timestamp_ms bigint not null,
  target_timestamp timestamptz not null,
  required_for text not null,
  status text not null,
  status_reason text,
  last_error text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, wait_type, address, coverage_mode, target_timestamp_ms)
);
```

Add checks:

- `wait_type in ('targeted_usdt_history')`;
- `coverage_mode in ('targeted')`;
- `required_for in ('where_hop', 'incoming_hop')`;
- `status in ('waiting', 'ready', 'terminal', 'cancelled')`.

Indexes:

- `(wait_type, address, coverage_mode, target_timestamp_ms, status)`;
- `(job_id, status)`.

Repository functions in `src/storage/repositories.ts`:

- `upsertForensicJobWait(input)`;
- `listReadyForensicJobWaits(input)`;
- `markForensicJobWaitReady(input)`;
- `markForensicJobWaitTerminal(input)`;
- `markForensicJobWaitCancelledForJob(input)`;
- `markWaitingForensicJobsReadyAfterTargetedIndex(input)`.

Do not remove `requested_by_job_id` yet. Keep it as a legacy/owner hint and for strict benchmark compatibility while moving wakeup logic to waiter rows.

## New Shared Coordinator

Add `src/forensics/targetedHistoryCoordinator.ts`.

Responsibilities:

- Given `(job, address, targetTimestamp, requiredFor)`, decide whether targeted coverage is ready, should be queued, should wait, or is terminal.
- Queue/requeue `tron_address_usdt_index_states`.
- Write a `forensic_job_waits` row.
- Patch parent job progress.
- Release parent job to waiting/queued state.
- Convert terminal index status into `scoreBlockedReason` and `technicalStatus`.

Public shape:

```ts
type TargetedHistoryDecision =
  | { kind: "covered" }
  | { kind: "wait_released" }
  | { kind: "terminal"; scoreBlockedReason: ForensicScoreBlockedReason; technicalStatus: ForensicTechnicalStatus };
```

The coordinator must treat these as resumable:

- missing state;
- `queued`;
- `running`;
- `failed_retryable`;
- `partial` with `statusReason = 'partial_budget_exhausted'` if attempts/budget remain;
- `partial` with `statusReason = 'partial_rate_limited'` if retry window remains.

The coordinator must treat these as terminal:

- `failed_terminal`;
- `partial_provider_inconsistent`;
- `partial_provider_cap` only after max window split / configured escalation attempts are exhausted;
- `too_large_deferred` after hard safety limit is reached.

## Removing The 4-Page Final Stop

Keep the current 4-page value only as an optional inline seed budget.

Implementation rule:

- Inline targeted fetch may try 4 pages for latency.
- If inline targeted fetch returns `partial_budget_exhausted` for a required hop, parent job must queue background targeted indexing and wait.
- The result cannot be final `NO_FINAL_DECISION` solely because the inline 4-page seed stopped.

Add config:

- `TRON_TARGETED_INLINE_MAX_PAGES`, default `4`;
- `TRON_TARGETED_INDEX_MAX_PAGES_PER_RUN`, default `200`;
- `TRON_TARGETED_INDEX_MAX_PAGES_PER_HOP`, default `2000`;
- `TRON_TARGETED_INDEX_MAX_RUNTIME_MS`, default `900000`;
- `TRON_TARGETED_INDEX_MAX_ATTEMPTS`, default `8`;
- `TRON_TARGETED_INDEX_ESCALATION_FACTOR`, default `2`.

Use existing DB columns:

- `tron_address_usdt_index_states.budget_pages`;
- `tron_address_usdt_index_states.budget_seconds`;
- `attempt_count`;
- `max_attempts`.

Change `ensureAddressUsdtHistory` so targeted background/index-worker calls use state/input budget, not the global inline constant.

## Worker And Wakeup Changes

Update `src/forensics/addressIndexWorker.ts`:

- After each targeted state finishes as `complete`, `partial`, or `failed_terminal`, call generic `markWaitingForensicJobsReadyAfterTargetedIndex`.
- Continue supporting `markStrictProvenanceJobReadyAfterIndex` until strict benchmark is migrated or deleted.

Update `src/index.ts`:

- Pass budget pages/seconds from claimed index state into `ensureAddressUsdtHistory`.
- Run `addressIndexOnce()` before or alongside Where/Incoming polls, or ensure the existing `address_index` interval is enough and parent wakeup does not depend on DeepCheck.
- Keep parent workers non-blocking: they can claim a job, discover missing targeted history, queue wait, release, and exit.

Stale job recovery:

- Waiting parent job older than lock with a complete targeted state should be marked ready.
- Waiting parent job whose targeted state is terminal should be marked ready with terminal progress, not left stale forever.
- Queued parent job with `jobPhase = waiting_for_targeted_index` should not run trace until its wait row is ready/terminal.

## Stage 1: Where/Admin Proof-Of-Flow

Scope:

- Admin-started Where jobs and strict benchmark jobs first.
- No Telegram behavior change except not breaking existing `/check`.

Tasks:

- [ ] Add `forensic_job_waits` migration and repository functions.
- [ ] Add `targetedHistoryCoordinator`.
- [ ] Replace strict-only wait/release block in `src/forensics/deepForensicJob.ts` with coordinator for Where trace targeted hops.
- [ ] Keep strict benchmark progress fields but write generic progress too:
  - `jobPhase`;
  - `targetedIndex.waitingFor`;
  - `targetedIndex.pagesFetched`;
  - `targetedIndex.transfersFetched`;
  - `targetedIndex.statusReason`.
- [ ] Make `partial_budget_exhausted` resumable for Where/Admin until configured hop/job budget is exhausted.
- [ ] On terminal technical state, complete with `score_valid=false` and technical reason, never user-facing `DECLINE`.

Minimal tests:

- `tests/forensics/deepForensicJob.test.ts`: missing targeted hop queues wait and does not complete score.
- `tests/forensics/deepForensicJob.test.ts`: complete targeted state resumes and completes with `score_valid=true`.
- `tests/forensics/deepForensicJob.test.ts`: existing `partial_budget_exhausted` is requeued when attempts/budget remain.
- `tests/forensics/deepForensicJob.test.ts`: terminal provider state completes technical `score_valid=false`.
- `tests/storage/repositories.test.ts` or nearest storage test: duplicate wait rows are idempotent.

## Stage 2: Incoming

Scope:

- Incoming deposit jobs use the same coordinator for mandatory selected provenance paths.
- Do not block score for non-selected diagnostic branches.

Tasks:

- [ ] Inject targeted coordinator into `src/forensics/incomingDepositJob.ts`.
- [ ] Replace `targetedCoverageBlock` finalization for resumable statuses with parent wait/release.
- [ ] Keep `scoreValid=false` only for terminal provider/safety states after escalation is exhausted.
- [ ] Update incoming progress:
  - selected deposit tx;
  - sender;
  - required hop count;
  - complete/partial/waiting counts;
  - pages/transfers fetched;
  - first waiting address and target timestamp.

Minimal tests:

- `tests/forensics/incomingDepositJob.test.ts`: mandatory hop budget partial queues wait, no final report.
- `tests/forensics/incomingDepositJob.test.ts`: non-selected path partial does not block selected-path score.
- `tests/forensics/incomingDepositJob.test.ts`: ready targeted wait resumes and score is published.
- `tests/forensics/incomingDepositJob.test.ts`: terminal provider cap returns technical `scoreValid=false`.

## Stage 3: Admin And Telegram UX

Scope:

- Make long checks understandable while they are still working.
- Do not expose raw `History not fully fetched` as the final paid result for new jobs.

Admin:

- Show `waiting_for_targeted_index` as active progress, not failure.
- Show address, target timestamp, pages, oldest fetched date, transfers, request counts, 429/403/5xx if available.
- Distinguish old cached jobs from new resumable jobs.
- Keep graph stop nodes for debugging, but label new waiting jobs as indexing coverage.

Telegram:

- `/check` can say the forensic check is still indexing old history.
- Do not send final risk score until required Where/Incoming coverage is ready.
- If terminal provider/safety stop occurs, send a technical message with no final verdict.

Minimal tests:

- `tests/admin/forensicsGraph.test.ts`: waiting targeted index produces progress node/metadata, not final failure.
- `tests/bot/createBot.test.ts`: user-facing message for waiting coverage does not say `DECLINE`.
- `tests/bot/createBot.test.ts`: terminal technical stop is `NO_FINAL_DECISION` with reason.

## Stage 4: Budget Escalation And Larger Key Pool

Scope:

- Use 4 keys now, support 10+ later without changing product logic.
- Measure whether speed is limited by provider, DB writes, DB reads, trace, or scoring.

Tasks:

- [ ] Wire `TRON_TARGETED_*` config into `src/config.ts`.
- [ ] Pass `budgetPages` / `budgetSeconds` from queued index state to `indexTronAddressUsdtHistory`.
- [ ] Add escalation: each retry can increase pages up to hop/job max.
- [ ] Add job-level hard ceilings to prevent infinite jobs:
  - max pages per hop;
  - max pages per parent job;
  - max attempts;
  - max runtime;
  - max window split depth.
- [ ] Expose scheduler diagnostics in progress:
  - key count;
  - key group count;
  - max in-flight;
  - cooldowns;
  - 429/403/5xx counters.

Minimal tests:

- `tests/forensics/tronAddressAllTimeIndex.test.ts`: existing completed pages are reused after a budget partial.
- `tests/forensics/tronAddressAllTimeIndex.test.ts`: provider cap still triggers window splitting.
- `tests/config.test.ts` or existing config test: targeted budget env vars parse correctly.
- `tests/forensics/addressIndexWorker.test.ts`: completed targeted index wakes all waiting jobs.

## Risks And Guards

- Infinite jobs: hard caps on attempts, pages, runtime, hop count, and window split depth.
- Provider cap: keep time-window splitting; only terminal after configured split/escalation is exhausted.
- Old partial states: reclassify budget/rate partial as resumable when attempts remain; keep provider-inconsistent and terminal states technical.
- Stale DB jobs: recovery must inspect wait rows and index states, then mark parents ready or terminal.
- Duplicate index tasks: rely on existing index state primary key plus `forensic_job_waits` unique key.
- Multiple parent jobs waiting on one index: use waiter rows, not single `requested_by_job_id`.
- Scoring on stale partial: add invariant checks before completing Where/Incoming score.
- Key pool overload: keep scheduler pacing/cooldowns; bigger budgets must not bypass scheduler.
- Old cached Admin jobs: UI must show they were produced before resumable targeted indexing.

## Verification Commands

Run after each implementation stage:

```powershell
npm test -- tests/forensics/deepForensicJob.test.ts tests/forensics/incomingDepositJob.test.ts tests/forensics/tronAddressAllTimeIndex.test.ts
npm test -- tests/admin/forensicsGraph.test.ts tests/bot/createBot.test.ts
npm run typecheck
```

Stage 4 benchmark should be admin-only first. Do not run live benchmark without explicitly choosing address, check kind, and expected duration.
