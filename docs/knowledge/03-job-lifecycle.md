---
status: current
last_verified: 2026-07-25
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
  - src/unifiedCheck/traversalDelta.ts
  - src/unifiedCheck/productionFinalizer.ts
  - src/unifiedCheck/delivery.ts
  - src/unifiedCheck/watchdog.ts
---

# Job Lifecycle

## Production Truth

Production still runs the legacy forensic job tables and delivery workers.
Those jobs can wait for targeted indexing, resume from persisted state, or end
in a technical stop. Existing schema-031 results and legacy scores are not
reinterpreted as Unified results.

A technical/provider stop must remain distinguishable from a risk decision.
Legacy retries keep their current ownership rules until cutover; the release
must not grant both legacy and Unified workers delivery authority.

## Implemented Release Candidate

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
The event-driven provider pool has four slots when four keys are configured.
A dense run can use all idle slots, but run-aware claiming preserves progress
opportunities for later interactive runs. Direct history and direct hard
evidence can run alongside traversal; they still cannot finalize or deliver.
A wake received while a slot is still finishing its active cycle is latched
per slot. Repeated wakes coalesce into one immediate restart, and pool drain
does not report idle between that active cycle and its latched restart.

Traversal checkpoints use a versioned V2 head plus immutable delta/chunk
artifacts. They do not copy the growing frontier, visited set, page inventory,
or timing history into every checkpoint. Existing V1 checkpoints upgrade
deterministically before a V2 writer proceeds.

Only the parent finalizer can commit the authoritative analysis manifest,
canonical fact inventory, score anchor, report, locale presentations, and
delivery intent. Completion requires terminal children, confirmed snapshot
identity, traversal closure, fact reconciliation, and matching hashes.
`FAILED_TECHNICAL` has no score, decision, report, presentation, or send.

Delivery is a separate state machine. `DELIVERY_UNKNOWN` records an ambiguous
external effect and forbids automatic resend. Manual resend creates a new
warned presentation and audit record.

These contracts are implemented in the release candidate but inactive in
production until the protected schema-034 cutover and generation-fence switch.

The active candidate startup contract now requires exact schema 034 with
verified schema-032 and schema-033 predecessor receipts. New run creation
persists an opaque stable fairness owner, and the durable planner repository
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

The candidate traversal coordinator emits every newly mandatory
address-history task with its canonical parent sequence. The run-locked
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
duplicate provider work. Adaptive rolling admission, provider-group selection,
and the capacity controller remain later steps.

## Remaining Operational Work

The schema-034 startup and base planner-persistence gap is closed. P1 boundary activation still waits
for blind review/adjudication, and the performance matrix waits for frozen
TPCP/TFWG/TXc provider bundles. Protected backup/migration/startup, generation
activation, and post-deploy canary also remain external rollout work. The
protected release receipts and promotion path remain deliberately pinned to
schema 033 until their separate Task-7 update and therefore are not yet valid
for the schema-034 candidate runtime.
