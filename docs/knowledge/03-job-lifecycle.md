---
status: current
last_verified: 2026-07-27
owner_area: forensics
code_refs:
  - src/index.ts
  - src/storage/schemaMigrations.ts
  - src/storage/repositories.ts
  - src/runtime/startupSchemaGate.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/telegramDeliveryWorker.ts
  - src/unifiedCheck/stateMachine.ts
  - src/unifiedCheck/repository.ts
  - src/unifiedCheck/productionWorker.ts
  - src/unifiedCheck/providerPool.ts
  - src/unifiedCheck/rolloutPolicy.ts
  - src/unifiedCheck/admissionRuntimeControl.ts
  - src/unifiedCheck/traversalDelta.ts
  - src/unifiedCheck/productionFinalizer.ts
  - src/unifiedCheck/delivery.ts
  - src/unifiedCheck/watchdog.ts
  - migrations/036_remove_rollout_authority.sql
---

# Job Lifecycle

## Production Truth

Production still runs the legacy forensic job tables and delivery workers.
Those jobs can wait for targeted indexing, resume from persisted state, or end
in a technical stop. Existing schema-031 results and legacy scores are not
reinterpreted as Unified results.

A technical/provider stop must remain distinguishable from a risk decision.
Legacy retries keep their current ownership rules; operators must not grant
both legacy and Unified workers delivery ownership.

Stage B legacy Where, Incoming, and Deep workers bind one `AbortController` to each
claimed job. A false progress/heartbeat compare-and-set is claim loss: the
worker aborts selective enrichment, starts no later candidate, and cannot
complete, publish, or prepare delivery. Enrichment heartbeats are written at
most once per 30 seconds while a provider promise is pending and on the final
candidate. One job-scoped coordinator, timer, cadence, and in-flight write are
shared by every concurrent selective invocation in that claimed attempt. A
final write arriving behind an unresolved periodic CAS is queued once with the
latest final summary. Heartbeat writes never overlap, and the job-level timer
is cleared and unreferenced when the whole attempt ends. Completed jobs merge
the provider and decision evidence IDs into existing `raw_evidence_ids`.

Each legacy claim now owns one millisecond-normalized `started_at` generation.
Claims are ordered by priority, creation time, then job ID; a reclaim advances
the generation even within one millisecond and refreshes `jobHeartbeatAt`
atomically. Stale recovery preserves the previous generation while requeueing.
Every worker-owned progress (including strict benchmark metrics), wait/release,
completion, index queue or inline index write, risk-evidence, derived-assertion,
and Incoming observed-risk mutation is
compare-and-set or transactionally locked to that generation. A stale worker
receives `lost_forensic_job_claim`, aborts its resolver, publishes no result or
delivery intent, and dispatches no later provider work. The per-job worker
handles and logs this ownership stop as a completed polling-cycle item so one
lost claim cannot prevent later queued jobs from running in the same batch.

The legacy Where lane uses a bounded, work-conserving slot pump. A timer poll
performs wait reconciliation and stale recovery once, then claims one
`where_is_money_check` per free slot. A finished or released-to-waiting job
requests an immediate serialized refill; an empty claim waits for the next
timer tick. The pump retains only active handler promises, has no local pending
queue, and drains them during shutdown. `FORENSIC_WHERE_WORKER_CONCURRENCY`
is validated from 1 through 2 and defaults to 1. Incoming and Deep keep their
existing independent workers and batch settings.

The Where timer defaults to two seconds and rejects configured intervals below
one second. Immediate refill does not rerun reconciliation or stale recovery;
those remain once-per-timer-poll work. The pump is bounded and work-conserving,
not preemptive or globally fair: a running job keeps its slot until it reaches a
terminal/waiting boundary, so two long jobs can still occupy both canary slots.
Shutdown first stops claims and timer refills, then waits for every active
handler promise to settle.

Where and Deep persist identity-free lifecycle timing at claim and terminal
completion. This timing records runnable queue count and age, DB-running count, local
slot occupancy, transaction-enrichment counts, and monotonic scheduler
counters. `waiting_for_targeted_index` is excluded from runnable age. Deep
remains configured for one slot; Incoming remains a separate timed lane.
The claim snapshot already has the complete lifecycle shape: all seven
transaction-enrichment counters start at zero, and each scheduler `AtEnd`
counter initially equals its matching `AtStart` value. Terminal completion
replaces those placeholders with the job's final enrichment totals and a
non-decreasing scheduler snapshot.
Queue counts and slot occupancy are lane-specific. Scheduler counters are
process-global monotonic snapshots, not Where/Deep attribution; their delta is
attributable only when the canary window isolates all other provider consumers.
Ready transitions persist `jobRunnableQueuedAtMs`; stale recovery refreshes it,
and claim preserves it. Queue age and `queueWaitMs` therefore start when a job
becomes runnable after targeted-index waiting. A never-waited job falls back to
`created_at`. The active aggregate uses the existing migration-012 partial
index and requires no schema migration.

## Unified Lifecycle

Schema 033 introduces one durable `CheckRequest`, one `UnifiedCheckRun`,
mutable lifecycle rows for child tasks, immutable completed attempt records,
and a canonical artifact chain. A task may be leased, checkpointed, retried, or
completed; its finished attempt evidence is append-only. Public analysis states
are:

```text
RUNNING
WAITING_FOR_PROVIDER
COMPLETED
FAILED_TECHNICAL
```

`WAITING_FOR_PROVIDER` persists cursors and completed artifacts while other
ready work continues. A retry creates a new attempt linked to the previous one;
it never mutates failed history. The watchdog may requeue recoverable work or
mark a real technical failure, but cannot convert unfinished traversal into
`COMPLETED`.

An eligible task that checkpoints refreshes its scheduling age and yields to
older ready work in the same priority lane. A long traversal therefore cannot
reclaim every provider cycle while another interactive run remains queued.
The event-driven provider pool starts at target zero and is resized by the
adaptive controller. Capacity comes from healthy independent provider groups,
configured worker/provider ceilings, eligible demand, and runtime guards; raw
key count is not capacity. Work-conserving owner-to-run max-min rounds divide
interactive and repair work, and unused repair reserve is borrowed. Direct
history and direct hard evidence can run alongside traversal; they still
cannot finalize or deliver.
A wake received while a slot is finishing a bounded chunk is coalesced without
restarting that slot from a stale permit. At the chunk boundary the slot returns
to the controller, which reallocates it from a fresh occupancy/epoch snapshot.

Traversal checkpoints use a versioned V2 head plus immutable delta/chunk
artifacts. They do not copy the growing frontier, visited set, page inventory,
or timing history into every checkpoint. Existing V1 checkpoints upgrade
deterministically before a V2 writer proceeds.

Only the parent finalizer can commit the authoritative analysis manifest,
canonical fact inventory, score anchor, report, locale presentations, and
delivery intent. Completion requires terminal children, confirmed snapshot
identity, traversal closure, fact reconciliation, and matching hashes.
Finalization, final hash-chain commit, and completed-presentation reconciliation
all parse the hash-verified manifest against the locked run, subject, and sole
run-owned confirmed snapshot before writing score, report, or delivery state.
`FAILED_TECHNICAL` has no score, decision, report, presentation, or send.

Delivery is a separate state machine. `DELIVERY_UNKNOWN` records an ambiguous
external effect and forbids automatic resend. Manual resend creates a new
warned presentation and audit record.

These contracts are implemented independently of delivery ownership.

Startup requires exact schema 036 with verified schema-032 through schema-035
predecessor receipts. Migration 035 historically added immutable rollout
policy. Migration 036 removes its receipt field while retaining rollout stage,
stable bucket, admission policy, and provider ceiling on `unified_check_runs`.
New run creation persists those fields and the opaque stable fairness owner in
the same transaction; restart and configuration changes load the stored
decision instead of inferring it from planner rows or recalculating it. The
durable planner repository
can append capacity-independent canonical task rows under a run lock.
Acceptance of an admitted ordered task is now one idempotent PostgreSQL
transaction: it inserts the immutable result artifact and attempt, completes
and releases the task lease, and moves the planner row from `planned` to
`ready` with the canonical UTF-8 result size. The accepted-attempt join remains
the only artifact authority. Replay after an uncertain response uses the stable
task ID, attempt number, and artifact hash; it does not depend on the worker's
ephemeral attempt UUID or a repeated artifact payload. Planner attachment and
acceptance serialize through the run lock before task and planner locks, so a
completed independent task cannot acquire a late `planned` row. The rolling
planner may attach a new row only to an existing unaccepted `QUEUED` or
`WAITING_RETRY` task. It rejects `LEASED`, `BLOCKED_ADMIN`,
`FAILED_TECHNICAL`, `CANCELLED`, and `COMPLETED`; a task that already owns a
planner row remains idempotently reusable after it is admitted or leased.

For `snapshot-closure-v2`, the traversal coordinator first evaluates the
canonical frontier against the exact frozen label dataset bound by the run
manifest. It persists the largest bounded prefix of terminal evidence and its
traversal delta as idempotent content-addressed artifacts, then commits the
checkpoint before planning any history. The byte ceiling counts the exact
canonical UTF-8 bytes of every persisted evidence artifact plus the actual
delta artifact; the individual manifest ceiling applies to each evidence
artifact. The same boundary partition runs again immediately after every
accepted history expands the frontier, before discoveries can create another
address-history task. Entry and byte ceilings are aggregate limits for one
coordinator invocation: the first accepted history that persists a generated
boundary ends the invocation, and only the processed continuous ready
sub-prefix is committed. The next ready row remains durable for restart. A
crash can leave reusable unreferenced artifacts, but cannot expose
contradictory traversal state. Restart replays the durable delta
head, so terminal states do not reopen or emit duplicate evidence. Only the
remaining non-terminal states can become new mandatory address-history work.
`snapshot-closure-v1` keeps its historical label behavior unchanged.

The traversal coordinator emits every newly mandatory address-history task
with its canonical parent sequence. The run-locked
checkpoint transaction verifies the full task/accepted-attempt/artifact
identity, persists one bounded V2 checkpoint, commits the exact continuous
ready prefix, appends discoveries after existing rows by parent sequence and
then canonical task identity, and admits the next valid barrier head. Initial
frontier tasks use the sentinel parent and canonical identity order; when two
parents discover the same task, the earlier parent owns it. Admission accepts
only unaccepted `QUEUED`/`WAITING_RETRY` planned tasks and rolls back the whole
transition on a lifecycle mismatch. A ready head is valid only after its
provider reservation is released; it remains traversal-actionable and emits no
provider wake. A newly admitted planned head wakes the provider pool only after
commit. Before any traversal delta or planner commit, both the coordinator and
checkpoint transaction recompute an address-history manifest key from its
authoritative identity fields and require it to match the exact planner task
kind and logical key. At the checkpoint boundary, any address-history marker
requires the complete expected task, stored task, artifact kind/schema, and
canonical key tuple; only marker-free generic artifacts bypass these
address-specific semantics. Committed manifests remain reusable without
duplicate provider work. Rolling admission uses fair provider share for a
bounded per-run lookahead and persists admission plus reservation before
claim. A full run buffer yields capacity to other runs, while an ordinarily
eligible canonical head may still take its protected slot. Switching to
barrier de-admits only unleased tail rows; leased bounded chunks finish and
the same ordered commit path continues head-first.

Rollout policy is selected per new run. The explicit stages are global
barrier, isolated synthetic/canary rolling, a stable bounded share of new
`user_check` runs, and rolling by default for new runs. A run without a
schema-035 rollout policy remains on barrier behavior; the rollout does not
reconstruct or silently convert pre-035 work. The process-wide one-way
fallback overrides every stage to barrier and uses the same durable
planner/commit functions.

Controller wakes coalesce after durable intake, provider lifecycle changes,
planning/commit, and cooldown expiry. A rare reconciliation tick invokes the
same cycle after restart or a lost signal. It reconstructs nothing from
process memory, and a no-action tick mutates no task. The coalescer retains
event and timer pending causes separately. If both are pending for the same
next cycle, the event cause dominates; an event/intake/slot wake never emits
`reconciliation_recovered_work`, even when its ordinary cycle sees eligible
work. Only an actual timer tick that finds actionable work emits recovery.
Provider, analysis, and
finalization retain separate capacity; pressure lowers or pauses new claims
without interrupting an in-flight provider request.

Provider-slot assignments are evaluated against the pool's current monotonic
slot epoch. Controller decisions preserve proposed and accepted assignments
separately; pool targets and per-run assigned-slot counts include only accepted
assignments. A stale-epoch rejection requests one coalesced controller wake
when healthy eligible work and safe capacity remain, while active, pending, or
draining rejections wait for the normal boundary/reconciliation path.

Refill timing is best-effort and bounded in memory: at most 512 incomplete
slot/epoch correlations and 512 completed samples per phase. Correlation uses
only the explicit active-epoch, idle assignment epoch, and next active-epoch
transition. Discontinuities are dropped rather than inferred, and exported
snapshots contain aggregate assignment counts and refill percentiles without
run, owner, task, address, key, or provider-group identities. This diagnostic
path never participates in claim, checkpoint, acceptance, or commit success.
`checkpoint_or_commit` is a stable supported reason code, but V1 intentionally
does not emit it: current lifecycle state cannot prove that a checkpoint or
commit holds the last otherwise-fillable slot. Emission waits for a direct
causal signal rather than inferring the blocker after the fact.

Release evidence does not change that historical runtime-observation shape.
While a benchmark control is active, the runtime persists separate exact
`unified-provider-refill-runtime-sample-v1` artifacts bound to the control,
runtime commit, provider configuration, and run set. The benchmark command
aggregates only the selected run's samples, validates the three process-memory
phases, and then persists one
`unified-provider-refill-observation-v1` artifact. A passing benchmark index is
written only after that artifact passes its control/run bindings and dense
acceptance checks. The selected-run index is schema V2 and directly binds the
refill artifact hash and creator run. Its sealed export-evidence sidecar binds
the execution identity, runtime/configuration, control, benchmark evidence,
refill bytes, and the exact before/during/after memory-file bytes and hashes.
Resume revalidates that complete chain without recapturing memory or starting a
second canary; any replacement or mismatch fails closed. Runtime samples and
refill observations never participate in task claim, acceptance, traversal
commit, scoring, or delivery.

Selected runtime saturation uses only the controlled run's eligible demand,
accepted/active slots, and limiting reason. A foreign active provider permit is
persisted as a failing contamination sample; it can never contribute four slots
to TXc utilization. Retained refill diagnostics reset and switch to the exact
selected run set at the new control boundary. Foreign accepted or rejected
assignments and foreign chunk/checkpoint/claim events are excluded. Actual
timer-originated `reconciliation_recovered_work` events are counted for the
active control/run and bound into lifecycle evidence. One recovery rejects the
selected gate.

Before touching output paths or invoking the selected canary, the harness
transactionally inserts a deterministic PostgreSQL authorization marker for
the exact allowlisted scenario, traversal policy, candidate, and execution
identity. Schema 036 has no marker table, so the no-migration fence is an exact
canonical `maintenance` + `isolated` + `FAILED_TECHNICAL` request with no run.
It is technical authorization state, not a canary result. It creates no task,
delivery, active Admin run, user-check count, or reconciliation work and must
never be removed by automatic cleanup. Any existing exact marker means the
execution may already have started and blocks another batch/canary; a mismatched
row or persistence failure also fails closed. A completed sealed index resumes
before this authorization path.

Memory capture creates a fresh exclusive per-execution child directory. Node
passes its captured RSS/heap values directly as validated PowerShell arguments;
PowerShell returns one exact phase sample on stdout. Node requires the returned
runtime values to match exactly, builds the summary, and creates/syncs the final
sample and summary children with exclusive no-follow handles.

Traversal policy remains owned by the persisted analysis manifest. V1 resumes
with its historical identities and evidence bytes. V2 resumes only with its
bound label dataset, catalog, and boundary predicate versions. The one-way
runtime fallback changes rolling admission to barrier execution; it does not
rewrite either traversal policy or reopen a terminal V2 state.

## Remaining Operational Work

The schema-036 startup verifier, planner, adaptive capacity, structured slot
assignment outcomes, bounded refill diagnostics, reconciliation,
staged policy, barrier fallback, and memory diagnostics are implemented.
Configuration defaults to `global_barrier`; isolated or broader rolling is an
ordinary validated configuration choice. Policy-specific PostgreSQL replay
covers logical capacities through 100 for snapshot-closure-v1 and
snapshot-closure-v2. Scheduler simulation is useful scale evidence, but the
PostgreSQL barrier-versus-rolling oracle drives the production runtime,
traversal coordinator, V2 boundary, finalizer, restart, and delivery paths and
is the exact lifecycle/hash proof within each policy; cross-policy hashes need
not match. Its scheduler receipt remains a separate immutable replay contract.
Actual live capacity
and the next DB/CPU/memory bottleneck must be measured with real independent
groups. P1 boundary
activation still waits for blind review/adjudication, and exact performance
comparison waits for frozen TPCP/TFWG/TXc provider bundles.

Stage B implementation is code-complete in this checkout, but release evidence
is not complete. The required real legacy TXc replay fixture is absent, no
accepted concurrency-two Where canary receipt exists, and the separate Deep
singleton residual receipt has not been measured. That Deep receipt is required
release evidence before production Where concurrency 2, but its latency value
is not part of the isolated Where start-SLA pass/fail. It cannot authorize a
Deep concurrency change: Deep remains 1, and a high residual opens a separate
follow-up. These missing artifacts are operational blockers, not reasons to
reinterpret deterministic tests as live evidence.
