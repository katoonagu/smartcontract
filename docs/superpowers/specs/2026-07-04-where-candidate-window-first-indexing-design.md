# Where Candidate Window First Indexing Design

Date: 2026-07-04

## Problem

`Where is money` currently has funding-first logic, but its queued targeted
index mode is still broad.

For a concrete hop:

```text
H -> R amount A at time T
```

the coordinator can ask for:

```text
address = H
targetTimestamp = T
```

The worker then indexes:

```text
TRON USDT genesis -> T
```

`targetTimestamp` is only the upper bound. There is no persistent lower bound
for queued/resumable indexing. Heavy addresses can therefore expand through
large page budgets even when the product question only needs a narrow proof:

```text
Which incoming transfers could fund this concrete outgoing hop?
```

The existing exact-window repair can check:

```text
candidateTimestamp -> targetHopTimestamp
```

but it is inline repair, not a durable queued indexing mode. It cannot replace
the current broad background targeted index for slow or interrupted cases.

## Decision

Add a `candidate-window-first` targeted indexing mode for ordinary
`where_is_money_check`.

Before queuing the broad `genesis -> targetTimestamp` fallback, Where should:

1. find strong incoming funding candidates for the concrete hop;
2. queue narrow persistent windows for top candidates;
3. re-run funding-first evaluation after those windows complete;
4. skip broad fallback when exact candidate windows cover the material amount;
5. queue broad fallback only when candidate windows cannot prove enough.

This is Where v1 only. `Incoming` can reuse the same primitive later, but is
not part of this implementation.

## Non-Goals

- Do not change scoring.
- Do not change DeepCheck relationship expansion.
- Do not change broad fallback budgets.
- Do not expand service, CEX, DEX, bridge, router, contract, or high-degree
  boundary addresses.
- Do not treat probable funding as exact proof.
- Do not remove broad targeted indexing; it remains the fallback.

## Current Code Findings

The current broad path is:

- `ensureTargetedHistoryOrWait` queues targeted address coverage with
  `address`, `coverageMode`, `targetTimestamp`, `queuedReason`, and
  `requestedByJobId`.
- `addressIndexWorker` claims `tron_address_usdt_index_states` rows and calls
  `ensureAddressUsdtHistory`.
- `indexTronAddressUsdtHistory` sets the targeted root window to:

```text
startMs = GENESIS_WINDOW_START_MS
endMs = targetTimestamp
```

Provider calls and coverage intervals already support concrete start/end
timestamps. The missing piece is a persistent request identity that carries
the lower bound and prevents narrow windows from being confused with broad
coverage.

## Data Model

Represent candidate windows as a variant of the existing
`tron_address_usdt_index_states` request, not as a new product job.

Add nullable/defaulted fields:

```text
request_kind = broad_targeted | candidate_window
window_start_timestamp_ms
window_start_timestamp
window_end_timestamp_ms
window_end_timestamp
related_hop_tx_hash
candidate_tx_hash
```

For v1:

```text
coverage_mode = targeted
targetTimestamp = windowEndTimestamp
queuedReason = where_candidate_window
requestedByJobId = parent where job id
```

Candidate-window identity must include:

```text
address
token contract
coverage mode
request kind
window start timestamp
window end timestamp
candidate tx hash
```

This is required because several candidate windows can share the same address
and end timestamp while proving different candidate transfers.

Existing broad targeted rows should default to:

```text
request_kind = broad_targeted
window_start_timestamp_ms = GENESIS_WINDOW_START_MS
window_end_timestamp_ms = target_timestamp_ms
```

## Coverage Semantics

Broad and candidate-window states must not satisfy each other's wait semantics
implicitly.

`broad_targeted` means:

```text
GENESIS_WINDOW_START_MS -> targetTimestamp
```

`candidate_window` means:

```text
windowStartTimestamp -> windowEndTimestamp
```

Rules:

- a completed candidate window proves only that narrow interval;
- a completed candidate window must not be returned as broad coverage;
- broad covering lookups must filter to `request_kind = broad_targeted`;
- broad indexed transfers can still be read by evaluation code, but should not
  mutate candidate-window lifecycle unless explicitly patched by a safe
  reconciliation step.

## Indexer Behavior

The worker should pass request-kind-specific bounds into
`indexTronAddressUsdtHistory`.

For broad targeted:

```text
startMs = GENESIS_WINDOW_START_MS
endMs = targetTimestamp
```

For candidate window:

```text
startMs = windowStartTimestamp
endMs = windowEndTimestamp
```

Use the same provider and coverage interval path. The provider already accepts
`startTimestamp` and `endTimestamp`; the durable state is what changes.

Recommended v1 limits:

```text
max candidate windows per hop = 5
max candidate windows per job = 20
initial pages per window = 50
max pages per window = 200
broad fallback max = existing targeted limit
```

## Where Flow

For a concrete hop:

```text
H -> R amount A at time T
```

Where should do this:

1. run local funding-first evaluation from already indexed data;
2. if source is exact enough, continue without queueing;
3. if source is probable because coverage is incomplete, choose top incoming
   candidates `F -> H before T`;
4. queue candidate windows for the selected candidates;
5. put the parent Where job into `checking_candidate_windows`;
6. after window completion, re-run funding-first evaluation;
7. if exact windows cover the material amount, continue trace normally;
8. if material amount remains unresolved and the address is not a boundary,
   queue the existing broad targeted fallback;
9. if the address is a service/high-degree boundary, stop with a boundary
   reason instead of queueing deeper history.

Materiality should use the existing residual materiality threshold from the
Where outcome policy. This design changes queue order, not proof math.

## Boundary Policy

Do not queue candidate windows or broad fallback through:

```text
CEX
DEX
bridge
router
contract
known service wallet
high-degree wallet
```

Persist the stop as a boundary status so Admin can explain that the trace
stopped intentionally.

## Resume And Completion

Candidate windows are background index requests. The parent Where job waits on
their terminal state, not on full-address history.

Parent progress should distinguish:

```text
checking_candidate_windows
waiting_broad_targeted_index
```

Candidate-window counters:

```text
total
queued
running
complete
partial
failed
```

Resume rule:

1. when all required candidate windows are terminal, wake the parent job;
2. parent re-runs funding-first evaluation from indexed transfers;
3. parent either skips broad fallback, queues broad fallback, or records a
   boundary stop;
4. duplicate window requests dedupe by stable request identity.

The worker must not complete the parent forensic job directly. It should only
patch index state/progress and trigger the existing parent resume path.

## Admin Visibility

Admin should not show this as a generic stuck targeted index wait.

Show:

```text
Checking candidate windows: 3 / 5
Exact funding covered: 92%
Broad fallback: not needed | queued | running | completed
Worker busy with: address + window range
```

For boundary cases, show:

```text
Service boundary
High-degree boundary
Broad fallback: not queued
```

This makes narrow-window progress visible and explains why the system did or
did not start the expensive fallback.

## Acceptance Tests

Repository tests:

- multiple candidate windows for the same address/end timestamp can coexist
  when their start timestamp or candidate tx differs;
- candidate-window state is not returned by broad covering lookups;
- broad targeted state remains backward compatible.

Indexer tests:

- broad targeted calls the provider with `GENESIS_WINDOW_START_MS ->
  targetTimestamp`;
- candidate window calls the provider with `windowStartTimestamp ->
  windowEndTimestamp`;
- candidate-window page limits cap at the configured narrow-window limit.

Coordinator tests:

- Where queues candidate windows before broad fallback;
- broad fallback is not queued when exact candidate windows cover the material
  amount;
- broad fallback is queued when material unresolved amount remains;
- service/high-degree boundary skips candidate windows and broad fallback.

Resume tests:

- parent Where resumes when candidate windows finish;
- duplicate candidate windows do not create duplicate waits;
- partial/failed windows lead to broad fallback only when unresolved materiality
  requires it.

Admin tests:

- progress shows `checking_candidate_windows`;
- candidate-window counts are rendered separately from broad fallback;
- broad fallback state is explicit.

## Implementation Notes

Keep the first implementation narrow:

- one migration for index state fields and identity;
- one repository queue/read path for candidate windows;
- one coordinator branch before broad fallback;
- one indexer bound selection branch;
- one Admin progress projection update.

Avoid adding a new job type unless the existing state row model proves
insufficient.
