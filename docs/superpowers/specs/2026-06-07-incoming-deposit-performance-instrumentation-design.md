# Incoming Deposit Performance Instrumentation Design

## Summary

This spec defines the first performance block for incoming deposit checks.

The goal is to make slow incoming deposit checks measurable before changing rate limits, queue policy, caching, or scoring logic. The first implementation must not change the risk result. It only records where time is spent.

The product target remains:

```text
one incoming deposit
one objective score
one user alert after the score is ready
```

No partial score and no multi-message alert flow are introduced in this block.

## Current Facts From The Codebase

Incoming deposit alerts are queued from monitor polling as `incoming_deposit_check` forensic jobs. The monitor now skips stale backfill transactions older than the configured realtime window before queueing the job.

Source: `src/monitor/monitorWorker.ts:421`.

The incoming deposit job worker is `runSingleIncomingDepositJobCycle`.

Source: `src/forensics/incomingDepositJob.ts:1406`.

The heavy report builder is `buildIncomingDepositReport`.

Source: `src/forensics/incomingDepositJob.ts:1078`.

Incoming deposit worker dependencies include:

- `claimNextForensicCheckJob`;
- `completeForensicCheckJob`;
- `updateForensicCheckJobProgress`;
- `recordObservedTransactionRisk`;
- `sendUserAlert`;
- `buildReport`.

Source: `src/forensics/incomingDepositJob.ts:112-151`.

The runtime loop for incoming deposit jobs is `incomingDepositOnce`.

Source: `src/index.ts:585`.

`incomingDepositOnce` currently runs a batch with `maxJobs: config.forensicWhereJobsPerPoll`.

Source: `src/index.ts:589`.

The generic job claim query orders jobs by:

```text
priority desc, created_at asc
```

Source: `src/storage/repositories.ts:3589`.

`buildIncomingDepositReport` already has local in-memory caches for:

- route edges;
- latest edges;
- stablecoin restriction status;
- service classification;
- deterministic contract verdicts;
- deterministic legitimate service classifications.

Source: `src/forensics/incomingDepositJob.ts:1091-1097`.

The report builder fetches both indexed and live transfers for addresses. For the sender window it uses `RUNTIME_TRANSFER_LIMIT = 200`.

Source: `src/forensics/incomingDepositJob.ts:154` and `src/forensics/incomingDepositJob.ts:1118-1138`.

The current code does not expose a stage timing breakdown for an incoming deposit job. The app logs only aggregate handled count after the batch.

Source: `src/index.ts:610`.

## Problem

We know from production history that incoming deposit checks can take minutes after the job starts. The queue wait was a separate issue, but the check runtime itself is also heavy.

Right now we cannot say which part is slow with confidence:

- job claim;
- indexed transfer reads;
- live TronScan transfer reads;
- balance-aware provenance tracing;
- service classification;
- contract profile enrichment;
- stablecoin restriction checks;
- cross-chain discovery;
- report assembly;
- Telegram delivery.

Without stage timings, the next optimization can become guesswork. For example, changing Tronscan RPS may not help if most time is spent in repeated metadata enrichment, database reads, or deep provenance expansion.

## Goals

1. Record queue wait and runtime for every incoming deposit job.
2. Record a stage breakdown inside the incoming job cycle.
3. Record a stage breakdown inside `buildIncomingDepositReport`.
4. Persist a compact timing summary into job `progress_json`.
5. Emit structured logs that can be searched by job id, tx hash, sender, and watched wallet.
6. Keep risk scoring and alert behavior unchanged.
7. Keep the instrumentation cheap and bounded.

## Non-Goals

This block does not:

- change final score formula;
- change HTX / risky service scoring;
- change the provenance algorithm;
- add more worker processes;
- add new API providers;
- change Tronscan rate-limit math;
- change incoming job priority;
- send partial alerts;
- add a new admin UI screen.

Those are follow-up optimization blocks after we have timing evidence.

## Design

### Timing Model

Add a small timing helper for incoming deposit checks.

The helper records:

```ts
type IncomingDepositTimingStage = {
  name: string;
  durationMs: number;
};

type IncomingDepositTimingSummary = {
  queueWaitMs: number | null;
  depositAgeAtStartMs: number | null;
  totalRunMs: number;
  stages: IncomingDepositTimingStage[];
};
```

The helper should use monotonic time for durations, for example `performance.now()` from Node's `perf_hooks`. Wall-clock `Date` remains useful for queue wait and deposit age because those compare database timestamps and deposit timestamps.

### Job-Level Stages

Instrument `runSingleIncomingDepositJobCycle` around these stages:

```text
claim_job
validate_progress_json
build_report
record_risk
format_alert
send_alert
mark_alert_sent
complete_job
fail_job
```

`claim_job` should measure the call to `claimNextForensicCheckJob`. If no job is returned, no final timing log is needed.

`build_report` should include the total time spent inside `buildIncomingDepositReport`.

`send_alert` measures Telegram API delivery only when `shouldSend(...)` is true.

`fail_job` is recorded only on error paths.

### Report-Level Stages

Instrument `buildIncomingDepositReport` with nested stages. The exact implementation can be incremental, but the first useful set is:

```text
load_sender_labels
evaluate_fast_sender_risk
build_sender_edges
trace_money_origin
build_source_bundle
classify_source_exposure
classify_sender_role
stablecoin_restriction_checks
contract_transaction_context
cross_chain_context
assemble_report
```

If a stage is not executed for a job, it should not appear in that job's timing list.

If a stage is executed multiple times, either record each call with a suffix or aggregate by name. The first version should aggregate by name to keep progress JSON compact:

```text
build_sender_edges: 4200 ms
stablecoin_restriction_checks: 1800 ms
```

### Persistence

Persist the final timing summary into `progress_json.performanceTiming`.

The stored shape should be compact:

```json
{
  "performanceTiming": {
    "queueWaitMs": 1234,
    "depositAgeAtStartMs": 45678,
    "totalRunMs": 98765,
    "stages": [
      { "name": "build_report", "durationMs": 90000 },
      { "name": "send_alert", "durationMs": 300 }
    ]
  }
}
```

Do not store request payloads, API keys, raw transfer lists, or large evidence blobs in timing data.

### Logging

Emit one final structured log per handled incoming job:

```text
incoming_deposit_job_timing
```

Fields:

```text
job_id
deposit_tx_hash
watched_wallet_id
sender
status
queue_wait_ms
deposit_age_at_start_ms
total_run_ms
top_stages
```

`top_stages` should include the slowest 5 stages only. Full timing remains in `progress_json.performanceTiming`.

Optionally emit warning logs for very slow stages:

```text
incoming_deposit_stage_slow
```

Only emit this if a single stage exceeds a threshold such as 30 seconds. This avoids noisy logs.

### Error Handling

Instrumentation must never fail the job.

If timing persistence fails, the job should continue through the existing success or failure path. The failure should be logged as:

```text
incoming_deposit_timing_persist_failed
```

If the job itself fails, still log and persist timing with `status: "failed"` when possible.

### Tests

Add unit tests around `runSingleIncomingDepositJobCycle`:

1. Successful job stores `performanceTiming`.
2. Successful job emits timing through logger.
3. Failed job still includes timing where possible.
4. Timing persistence failure does not turn a successful job into failed.
5. No job returned means no timing log.

Add unit tests around `buildIncomingDepositReport` only where practical:

1. Report-level stage collector receives expected stage names.
2. Repeated stages aggregate into one timing entry.
3. Instrumentation does not change the final report.

### Acceptance Criteria

After this block, we can answer for any incoming deposit job:

```text
How long did it wait in queue?
How old was the deposit when processing started?
How long did the check run?
Which 5 stages were slowest?
Did the time go into API calls, tracing, metadata/classification, or Telegram delivery?
```

The answer should come from stored job `progress_json` and logs, not from manual guessing.

## Follow-Up Blocks After This Spec

After timings exist, choose the next optimization based on measured bottlenecks:

1. If live transfer reads dominate: tune Tronscan scheduler and account group concurrency.
2. If repeated address metadata dominates: add broader cross-job metadata cache reuse.
3. If provenance expansion dominates: reduce duplicate edge fetches and add bounded reuse across source bundle and trace stages.
4. If queue wait dominates again: separate fresh incoming queue policy from manual forensic jobs.
5. If Telegram delivery dominates: isolate alert sending from forensic job completion without changing the one-alert product rule.

## Self-Review

- No scoring behavior changes are included.
- No partial alert behavior is introduced.
- The spec is focused on observability only.
- The next optimization is intentionally deferred until timing data exists.
