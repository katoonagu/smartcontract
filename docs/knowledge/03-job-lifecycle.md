---
status: current
last_verified: 2026-07-24
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
production until the schema-033 generation fence is switched.

## Remaining Operational Work

The runtime implementation gap is closed. P1 boundary activation still waits
for blind review/adjudication, and the performance matrix waits for frozen
TPCP/TFWG/TXc provider bundles. Protected backup/migration/startup, generation
activation, and post-deploy canary also remain external rollout work.
