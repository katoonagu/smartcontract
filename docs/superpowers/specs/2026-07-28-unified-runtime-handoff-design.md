---
status: approved_for_planning
date: 2026-07-28
owner_area: unified-runtime
knowledge_refs:
  - docs/knowledge/03-job-lifecycle.md
  - docs/knowledge/08-admin-and-bot-ux.md
  - docs/knowledge/09-current-decisions.md
  - docs/knowledge/10-open-problems.md
---

# Unified Runtime Handoff And User Notification Design

## Problem

An authoritative `/check` accepted for
`TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52` remained `RUNNING` after a local
deployment. The run expanded to the 500-address traversal ceiling, completed
198 tasks, left 307 queued tasks and one leased task, and never produced a
report or delivery. The run manifest is pinned to runtime commit `456263ae`,
while the replacement process runs `63c3bb4d`. Task claiming correctly rejects
a manifest whose runtime commit differs from the claimant, so the replacement
cannot safely continue the old artifact chain. The watchdog reports
`stale_lease_reclaimable` but is observational only. The request therefore has
neither a compatible worker nor a terminal user notification.

This is two failures at once:

1. deployment destroys the only worker compatible with an in-flight run;
2. the user receives neither progress nor an explicit technical outcome.

## Goals

- Preserve exact runtime-commit ownership of every Unified artifact chain.
- Let an old runtime finish its own authoritative checks while a new runtime
  accepts new checks.
- Bound deployment handoff to two hours.
- If compatible execution is unavailable, atomically end the run as a
  technical failure and notify every attached user request.
- Send one durable long-running status after five minutes without inventing a
  percentage or ETA.
- Keep technical lifecycle messages separate from analytical reports and risk
  decisions.
- Recover the currently orphaned request through the same production path.

## Non-Goals

- Do not let new code claim a run pinned to an older runtime commit.
- Do not reinterpret incomplete traversal as a score or wallet verdict.
- Do not change scoring, attribution, service-boundary, or traversal policy.
- Do not impose a two-hour limit on an ordinary check. Two hours applies only
  after a deployment asks an old runtime to drain.
- Do not send child Fast, Where, or Deep results while the parent is running.

## Chosen Approach

Use a durable two-generation handoff with a technical-notification outbox.

The active runtime owns Telegram intake and ordinary background work. When a
deployment requests drain, the old runtime releases Telegram polling, stops
accepting new work, and continues only Unified runs whose analysis manifest is
pinned to its own commit. The replacement runtime may then start immediately
and accept new checks. The old runtime exits after its compatible authoritative
runs become terminal or after the two-hour deadline.

A replacement runtime never resumes an incompatible artifact chain. If no
live compatible draining runtime exists, or the drain deadline expires, an
orphan reconciler changes the run and its requests to an explicit technical
terminal state and creates a durable lifecycle notification.

## Durable Runtime Registry

Schema 037 adds `unified_runtime_instances` with:

- immutable identity: instance ID, runtime commit, host instance label and
  start time;
- mutable lifecycle: `ACTIVE`, `DRAIN_REQUESTED`, `DRAINING`, `STOPPED`;
- heartbeat, drain request, drain deadline, Telegram polling release and stop
  timestamps;
- a constrained failure reason for an abnormal stop.

Only one live instance may own `ACTIVE` Telegram intake. Registration and
ownership transition are transactional. A runtime heartbeat is operational
state only; it is not evidence and never affects scoring.

The default drain deadline is exactly two hours after the durable drain
request. Configuration may shorten it in tests but cannot silently extend it
in production.

## Runtime Data Flow

### Normal startup

1. Verify schema 037 and the runtime version.
2. Register the runtime instance.
3. Acquire active intake ownership only when the previous owner has released
   Telegram polling or is provably dead.
4. Start Telegram polling, legacy work, current-commit Unified work and
   delivery.
5. Reconcile long-running and orphaned requests.

### Deployment handoff

1. The restart command writes `DRAIN_REQUESTED` for the current active
   instance with a two-hour deadline.
2. The old runtime observes the request, stops Telegram polling and new
   intake, stops legacy/background claims, and records
   `telegram_polling_released_at` before entering `DRAINING`.
3. The restart command starts the replacement runtime hidden with its exact
   Git SHA and instance label.
4. The old runtime continues provider, coordinator, finalizer and delivery
   cycles only for manifests whose `runtimeCommit` equals its own commit.
5. When no non-terminal authoritative run remains for that commit, the old
   runtime records `STOPPED` and exits.
6. At the deadline, remaining compatible runs are terminalized technically,
   their lifecycle notifications are enqueued, and the old runtime exits.

The old runtime may call Telegram `sendMessage` after releasing long polling;
only `getUpdates` ownership must be exclusive.

### Crash or pre-registry runtime

The active runtime periodically finds non-terminal authoritative runs whose
manifest commit differs from its own. A run is recoverable only when a
registered compatible `DRAINING` instance has a fresh heartbeat and a future
deadline. Otherwise it is an orphan.

Pre-schema-037 runs have no compatible registry row. They follow the orphan
path; the system does not fabricate ownership or run current code under the
old commit identity. This is how the currently stuck request is recovered.

## Atomic Orphan Terminalization

One repository transaction locks the run, its non-terminal tasks, attached
requests and notification identities. It then:

1. rechecks that the run is still non-terminal and no live compatible runtime
   owns it;
2. changes the run to `FAILED_TECHNICAL` with reason
   `runtime_handoff_unavailable` or `runtime_handoff_deadline_exceeded`;
3. changes every non-terminal task to `CANCELLED`, clears leases and preserves
   checkpoints and immutable attempts;
4. releases any uncommitted planner reservations without rewriting committed
   planner history;
5. changes attached requests to `FAILED_TECHNICAL` while retaining their run
   link for audit;
6. cancels an unsent long-running notification;
7. inserts exactly one technical-failure notification per request.

The request constraint is migrated so an attached request may retain `run_id`
after becoming `FAILED_TECHNICAL`. A completed run, completed task, immutable
attempt, artifact or confirmed delivery is never downgraded.

## Lifecycle Notification Outbox

Schema 037 adds `unified_check_notifications`. It is separate from
`unified_check_deliveries`, because an analytical delivery is valid only for a
completed report. Each notification stores:

- request ID and notification kind;
- locale and copy-version identifier;
- state: `PENDING`, `LEASED`, `RETRYABLE`, `SENT_CONFIRMED`,
  `DELIVERY_UNKNOWN`, `CANCELLED`;
- ready time, lease, attempt count, last error and Telegram message ID;
- created and updated timestamps.

Unique `(request_id, kind)` identity makes reconciliation idempotent. The
worker joins the request for chat/thread routing and renders text from the
stored copy version. It uses the same bounded retry and ambiguous-effect rules
as analytical delivery. `DELIVERY_UNKNOWN` is never automatically resent.

Two V1 notification kinds are required:

- `LONG_RUNNING`: due once after five minutes while the run remains
  non-terminal. Russian copy explains that a large history may require more
  time and that the result will arrive in the same chat. It contains no
  percentage or ETA.
- `FAILED_TECHNICAL_RUNTIME_HANDOFF`: explains that service updating stopped
  the check, no risk conclusion was produced, and offers a `Повторить` /
  `Retry` button bound to the same checked address.

Before sending `LONG_RUNNING`, the worker rechecks that the run is still
non-terminal. Final analytical delivery or technical terminalization cancels
an unsent progress notification.

## Restart Command

Add one documented command for local Windows deployment. It:

1. resolves the active registered instance without scanning arbitrary
   processes;
2. requests drain and waits for durable polling release;
3. starts the replacement hidden with timestamped stdout/stderr logs,
   `RUNTIME_GIT_SHA`, a matching instance label and the existing Where
   concurrency;
4. verifies schema, `bot_started`, runtime SHA and active intake ownership;
5. leaves the old draining process alive and reports its deadline.

For the first deployment from a pre-registry runtime, the operator may stop
the exact verified legacy process tree. The new orphan reconciler then owns
technical terminalization and notification; the restart command must not edit
run rows directly.

## Failure Handling

- Registry heartbeat loss never permits current code to claim the old run.
- A registry or terminalization transaction failure leaves the run untouched
  and retries reconciliation.
- Failure to send a progress notification does not affect analysis.
- Failure to enqueue or send a technical notification is operational and
  visible in Admin; it cannot create a score.
- If Telegram accepts a notification but confirmation persistence is
  ambiguous, state becomes `DELIVERY_UNKNOWN`.
- If both completion and orphan reconciliation race, row locks decide one
  terminal outcome. Completion wins only when the authoritative final report
  was already committed.

## Admin And Observability

Admin shows runtime instance state, commit, heartbeat age, drain deadline,
compatible non-terminal run count and notification state. Logs use stable
events for drain requested, polling released, drain completed, deadline
reached, orphan terminalized and lifecycle notification outcome. Telegram chat
IDs, addresses and provider keys do not become metric labels.

## Test Strategy

Implementation is test-first.

Pure state and rendering tests cover:

- compatible live drainer versus orphan classification;
- exact two-hour deadline boundary;
- RU/EN progress and technical copy;
- no score, verdict, percentage or ETA in technical lifecycle messages.

PostgreSQL repository tests cover:

- atomic orphan terminalization and task lease clearing;
- request run-link retention after technical failure;
- planner reservation release with committed history preserved;
- idempotent notification creation under concurrent reconciliation;
- completion-versus-orphan race;
- one active intake owner and durable drain transitions.

Worker and bot tests cover:

- one five-minute progress notification;
- cancellation of stale progress before send;
- retry, confirmed send and `DELIVERY_UNKNOWN` behavior;
- retry-button correlation and address preservation;
- old polling release before new intake begins.

Deployment acceptance uses a controlled in-flight test run. It proves that the
old runtime drains while the new runtime accepts a new request, then proves the
deadline/orphan path without creating an analytical report. After rollout,
the existing stuck run is expected to become `FAILED_TECHNICAL` and produce
one technical notification through the same worker.

## Documentation Changes

Implementation updates:

- `03-job-lifecycle.md` for registry, drain and orphan terminalization;
- `08-admin-and-bot-ux.md` for progress and failure messages;
- `09-current-decisions.md` for the two-hour handoff policy;
- `10-open-problems.md` to close the silent orphan symptom while retaining
  separate dense-traversal performance work.

## Acceptance Criteria

- A deployment never leaves an authoritative request silently `RUNNING`
  without a live compatible runtime.
- A live old runtime may finish its pinned runs for up to two hours without
  competing for Telegram polling or new work.
- An unrecoverable or deadline-exceeded run becomes technical, not risky.
- Every affected request receives at most one durable technical notification.
- A check running longer than five minutes receives at most one durable
  progress notification.
- Current-commit code never claims old-commit task artifacts.
- The currently orphaned TEFjf request is terminalized and notified after the
  fixed runtime is deployed.
