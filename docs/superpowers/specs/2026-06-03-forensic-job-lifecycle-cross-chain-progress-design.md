# Forensic Job Lifecycle And Cross-Chain Progress Design

Date: 2026-06-03

## Summary

Some forensic jobs can remain in `running` after the worker process stops or after a long provider stage is interrupted. The visible symptom is worst for manual cross-chain checks: the admin console shows `RUNNING`, but it does not say that the job is in cross-chain Stage 2, and the graph endpoint returns `not_ready` until the job completes.

The approved direction is to add explicit job progress phases, heartbeat timestamps, and stale-running recovery. The implementation should reuse `progress_json` rather than add a new table or migration. This keeps the change small and makes the admin UI, workers, and recovery logic read the same state.

## Case Motivation

Observed job:

`5b6299e6-e4e2-4a47-b0aa-eb48f7389b41`

Subject:

`TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`

Observed state:

- `kind`: `where_is_money_check`
- `status`: `running`
- `startedAt`: `2026-06-02T20:14:29.271Z`
- `completedAt`: `null`
- `lastError`: `null`
- `resultJson`: empty
- `progressJson`: `{ mode: "wallet_profile", locale: "ru", crossChainManualDeepMode: true }`

The same address can complete in later non-manual checks, which means the address itself is not enough to explain the stuck job. A CLI run with `--cross-chain-stage2 --cross-chain-manual-deep` completed as `partial` and reported provider failures as coverage notes. This points to a lifecycle gap, not a deterministic cross-chain algorithm crash.

Other active stale jobs were also found:

- old `where_is_money_check` job;
- old `incoming_deposit_check` job.

So the fix must be general. Cross-chain only makes the issue more visible because it is a longer provider-heavy stage.

## Current Behavior

### Claiming

`claimNextForensicCheckJob` selects only `queued` jobs and changes them to `running`. If a process dies after this update, the job stays `running`.

### Reuse

`createOrReuseForensicCheckJob` treats `queued` and `running` jobs as active. On conflict it merges `progress_json` and refreshes `updated_at`, but it does not requeue or fail stale work.

This can make a stale job look recently updated even when `started_at` is many hours old.

### Completion

The normal happy path is safe:

- `where_is_money_check` catches Stage 2 provider failures inside the report and completes as `partial`;
- `incoming_deposit_check` completes or fails inside the job cycle;
- `address_deep_check` completes or fails inside the job cycle.

The missing piece is recovery for jobs that never reach the completion update.

### Admin UI

The job list summary currently exposes only generic job fields. It does not include progress phase or cross-chain runtime state. For `running` jobs the graph endpoint returns `409 not_ready`, so details cannot recover the missing context from the graph.

## Problems To Fix

1. **Stale running jobs are never recovered**

   A worker interruption leaves the job in `running` indefinitely.

2. **Cross-chain stage is invisible while running**

   `crossChainManualDeepMode: true` is stored, but the admin list does not receive or render it.

3. **No heartbeat**

   `updated_at` can be refreshed by duplicate job creation. It is not a reliable worker heartbeat.

4. **Provider-heavy stages have no progress checkpoint**

   Stage 2 can take longer than a normal route trace, but the DB is not updated immediately before provider work begins.

5. **Incoming deposit jobs need a safer policy**

   Requeueing an `incoming_deposit_check` after Telegram delivery starts can duplicate alerts. Recovery must distinguish pre-delivery work from delivery-phase work.

6. **No tests cover stale lifecycle**

   Current tests cover normal completion and provider partials, but not stuck `running` jobs.

## Design

### 1. Store Runtime Progress In `progress_json`

Add conventional top-level runtime fields:

```json
{
  "jobPhase": "cross_chain_stage2",
  "jobHeartbeatAt": "2026-06-03T00:00:00.000Z",
  "retryCount": 1,
  "lastRecoveredAt": "2026-06-03T00:00:00.000Z",
  "staleRecoveryReason": "running job exceeded 30 minute heartbeat window",
  "crossChainStage2Progress": {
    "enabled": true,
    "manualDeepMode": true,
    "status": "running",
    "triggered": true,
    "reason": "manual_deep_mode",
    "selectedAmountRaw": "989179150000",
    "targetAmountRaw": "1289099000000",
    "providerCalls": 0,
    "updatedAt": "2026-06-03T00:00:00.000Z"
  }
}
```

These fields are advisory. Existing reports remain valid if they do not contain them.

### 2. Use Explicit Phases

Supported phases:

- `queued`
- `claimed`
- `address_deep_trace`
- `money_origin_trace`
- `cross_chain_stage2`
- `incoming_deposit_trace`
- `risk_recording`
- `notification_delivery`
- `completing`
- `queued_after_stale_recovery`
- `failed_after_stale_recovery`

The worker should update `jobHeartbeatAt` at phase transitions. It does not need to update heartbeat every few seconds.

### 3. Cross-Chain Progress Semantics

`where_is_money_check` should write progress twice:

1. After claim, before route tracing:

   ```json
   {
     "jobPhase": "money_origin_trace",
     "crossChainStage2Progress": {
       "enabled": true,
       "manualDeepMode": true,
       "status": "pending"
     }
   }
   ```

2. After Stage 2 trigger evaluation, before provider calls:

   ```json
   {
     "jobPhase": "cross_chain_stage2",
     "crossChainStage2Progress": {
       "enabled": true,
       "manualDeepMode": true,
       "status": "running",
       "triggered": true,
       "reason": "manual_deep_mode"
     }
   }
   ```

If Stage 2 is skipped, it can write:

```json
{
  "jobPhase": "money_origin_trace",
  "crossChainStage2Progress": {
    "enabled": true,
    "manualDeepMode": false,
    "status": "skipped",
    "triggered": false,
    "reason": "No selected cross-chain boundary is visible."
  }
}
```

### 4. Stale Recovery Policy

Use `started_at` plus `jobHeartbeatAt`, not `updated_at`, to decide staleness.

Default thresholds:

- `where_is_money_check`: 30 minutes
- `address_deep_check`: 30 minutes
- `incoming_deposit_check`: 30 minutes

Recovery actions:

- `where_is_money_check`: requeue if `retryCount < 2`;
- `address_deep_check`: requeue if `retryCount < 2`;
- `incoming_deposit_check`: requeue only if phase is a known pre-delivery phase, currently `incoming_deposit_trace` or `risk_recording`, and `retryCount < 1`;
- `incoming_deposit_check` in `notification_delivery`, `completing`, or legacy unknown phase: fail stale with manual review text rather than retrying automatically.

Delivery-sensitive incoming jobs must not be silently retried because Telegram sends are not idempotent.

### 5. Admin API And UI

The job list endpoint should include a compact runtime summary:

```json
{
  "runtime": {
    "phase": "cross_chain_stage2",
    "heartbeatAt": "2026-06-03T00:00:00.000Z",
    "retryCount": 1,
    "crossChain": {
      "enabled": true,
      "manualDeepMode": true,
      "status": "running",
      "reason": "manual_deep_mode"
    }
  }
}
```

The admin list card should show:

- `RUNNING`
- `cross-chain`
- `manual deep`
- stale age when applicable

Example:

`where_is_money_check · running · cross-chain · manual deep · 18m`

For stale recovered jobs:

`where_is_money_check · queued · recovered retry 1`

### 6. Graph Endpoint

Keep graph projection unavailable for `running` jobs. Rendering partial in-flight graphs from progress JSON is out of scope for this change.

The admin details pane can still show runtime status when graph is not ready.

### 7. Observability

Add structured logs:

- `forensic_job_progress_updated`
- `forensic_job_stale_requeued`
- `forensic_job_stale_failed`
- `forensic_job_stale_recovery_skipped`

Logs should include:

- `job_id`
- `kind`
- `subject_address`
- `phase`
- `retry_count`
- `age_ms`

### 8. Compatibility

Existing jobs without `jobPhase` remain readable.

Legacy `running` jobs should be handled conservatively:

- `where_is_money_check` and `address_deep_check`: can be requeued;
- `incoming_deposit_check`: fail stale unless a known pre-delivery phase is present.

### 9. Out Of Scope

- New database table for job attempts.
- Full in-flight graph projection.
- Provider-specific timeout redesign.
- Retrying Telegram delivery after the bot has already attempted to send a user alert.

## Acceptance Criteria

1. A manual cross-chain where-is-money job writes `jobPhase = "cross_chain_stage2"` before provider calls.
2. Admin job list shows `cross-chain` and `manual deep` for running manual Stage 2 jobs.
3. Stale `where_is_money_check` jobs older than the threshold are requeued with incremented `retryCount`.
4. Stale `address_deep_check` jobs older than the threshold are requeued with incremented `retryCount`.
5. Stale `incoming_deposit_check` jobs in known pre-delivery phases are requeued with incremented `retryCount`.
6. Stale `incoming_deposit_check` jobs in delivery-sensitive or legacy unknown phase are failed, not requeued.
7. Fresh running jobs are not recovered.
8. Recovered jobs store `lastRecoveredAt` and `staleRecoveryReason`.
9. Unit tests cover progress merge, stale recovery SQL behavior, where-is-money Stage 2 progress, incoming delivery-safe recovery, and admin runtime summary.
