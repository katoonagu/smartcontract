---
status: current
last_verified: 2026-07-26
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
process memory, and a no-action tick mutates no task. Provider, analysis, and
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

## Remaining Operational Work

The schema-036 startup verifier, planner, adaptive capacity, structured slot
assignment outcomes, bounded refill diagnostics, reconciliation,
staged policy, barrier fallback, and memory diagnostics are implemented.
Configuration defaults to `global_barrier`; isolated or broader rolling is an
ordinary validated configuration choice. Deterministic replay covers logical
capacities through 100, while actual live capacity and the next DB/CPU/memory
bottleneck must be measured with real independent groups. P1 boundary
activation still waits for blind review/adjudication, and exact performance
comparison waits for frozen TPCP/TFWG/TXc provider bundles.
