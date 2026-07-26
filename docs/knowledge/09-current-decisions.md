---
status: current
last_verified: 2026-07-26
owner_area: docs
code_refs:
  - src/index.ts
  - src/storage/schemaMigrations.ts
  - src/runtime/startupSchemaGate.ts
  - src/unifiedCheck
  - src/risk/scoringSignalMatrixV4.ts
  - src/risk/scoreAnchorV3.ts
  - migrations/033_unified_wallet_check.sql
  - migrations/034_unified_check_adaptive_planner.sql
  - migrations/035_unified_check_run_rollout_policy.sql
  - migrations/036_remove_rollout_authority.sql
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - scripts/captureUnifiedWslMemory.ps1
---

# Current Decisions

## Unified Product Contract

- One logical `/check` owns one parent run and at most one automatic Telegram
  delivery intent.
- Fast, Where, and Deep keep separate analytical responsibilities but are
  evidence-only children. No preliminary child report is sent.
- `COMPLETED` always has one score and decision.
- `FAILED_TECHNICAL` has no score, decision, report, presentation, or delivery.
- Coverage is audit metadata. It never adds risk or blocks a completed score.
- `DELIVERY_UNKNOWN` forbids automatic retry. Manual resend is explicit,
  warned, and audited.
- Isolated canaries create no Telegram delivery intent.

## Evidence, Traversal, And Scoring

- Every run binds one confirmed snapshot.
- Direct history exhausts snapshot-bounded pages; traversal terminates through
  exhaustion or evidence-backed boundaries, never a product coverage target.
- Dense graphs remain finite through canonical deduplication, equivalent-state
  merging, and closure certificates.
- Address history is content-addressed once per snapshot/address and reused by
  separate funding allocations. Checkpoints are bounded heads over immutable
  chunks/deltas.
- Migration 034 is the durable ordered planner. Planning sequence is append-only
  and independent of capacity. Workers may finish admitted tasks in any order;
  traversal state changes only by atomic bounded commit of the continuous ready
  canonical prefix.
- Task acceptance, accepted-attempt identity, artifact identity, actual result
  bytes, reservation release, and planner `planned → ready` happen in one
  PostgreSQL transaction. Restart recovery reads planner rows and immutable
  manifests rather than rebuilding order from process memory.
- Durable admission is separate from planner merge state. `admitted_at is null`
  is backlog and cannot be claimed. Reservations bound lookahead by entry count
  and bytes. An already leased bounded chunk is never interrupted.
- Ordered tasks do not have a preassigned provider group. Eligibility means at
  least one healthy independent group can execute the task under the normal
  task, cooldown, lease, and timing rules.
- The adaptive provider controller computes supply separately from demand.
  Concurrency is bounded by healthy independent groups, configured provider and
  worker ceilings, DB/memory guards, and eligible ready work. Provider pacing,
  endpoint/account-group limits, cooldown, and 429 handling remain separate.
- Provider assignment proposals are not capacity until the pool accepts them
  against its current slot epoch. Pool targets, actionable capacity, and
  per-run assigned-slot counts use accepted assignments only. A stale epoch may
  request the existing coalesced controller wake fast path; other pool guards
  wait for their real lifecycle transition or rare reconciliation.
- Scheduling is work-conserving max-min fairness, hierarchically owner then run.
  Repair has an elastic borrowable reserve; at capacity one it receives bounded
  weighted turns at chunk boundaries.
- Canonical head is prioritized only when normally eligible and never bypasses
  owner fairness or creates a duplicate claim. One run's full merge buffer does
  not block other runs.
- Provider, CPU analysis, and finalization are separate resource classes.
  Provider capacity adapts in the first implementation; the other classes have
  small configured ceilings and pressure/critical reduction.
- Barrier and rolling use the same planning, task, manifest, and commit code.
  Barrier is the deterministic oracle and one-way runtime fallback. The fallback
  de-admits unleased tails, lets leased chunks finish, and preserves canonical
  commit semantics.
- Direct history and direct hard evidence can run alongside traversal, but only
  the completed parent owns scoring and delivery.
- Every finalization, final hash-chain commit, and completed-presentation
  reconciliation reparses the persisted manifest against the locked run,
  subject, and confirmed snapshot before score/report/delivery mutation.
- Canonical fact identity prevents Fast/Where/Deep double counting.
- Matrix v4 gives unknown addresses zero by default and creates risk only from
  evidence or confirmed behavior combinations. Hard floors are not diluted by
  safe volume.
- `ScoreAnchorV3` binds facts, policy/config versions, analysis, locked Golden
  identity, and report.

## Runtime Configuration And Schema

- Adaptive rolling is ordinary validated configuration. No signed rollout
  receipt, release authority, or special generation is required to run it.
- `UNIFIED_ROLLING_ROLLOUT_STAGE` selects `global_barrier`,
  `isolated_rolling`, `bounded_user_check`, or `rolling_default` for new runs.
- `UNIFIED_PROVIDER_CAPACITY_CEILING` is a safety ceiling from 1 through 100;
  effective active capacity can be lower because of supply, demand, cooldown,
  DB, CPU, or memory guards.
- `UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS` controls deterministic admission in
  `bounded_user_check`.
- Migration 035 remains immutable historical evidence. Migration 036 removes
  its rollout-receipt column and receipt-specific constraints while retaining
  stage, bucket, admission policy, capacity ceiling, and immutability.
- Startup verifies exact migration 036 plus exact predecessor receipts and
  structure for migrations 032–035 before provider, bot, or worker startup.
- Existing runs created before schema 035 remain barrier. New runs persist their
  selected policy in the run creation transaction.
- `UNIFIED_TRAVERSAL_POLICY_VERSION` selects `snapshot-closure-v1` or
  `snapshot-closure-v2` for new runs. Existing runs always resume the traversal
  policy frozen in their analysis manifest. Historical v1 branch, request,
  analysis, and canary identity material remains byte-for-byte compatible;
  only v2 uses the new policy-discriminated identities.
- Newly created manifests bind the current label catalog and boundary predicate
  versions. Only historical v1 manifests may omit those fields; v2 fails closed.
- The production v2 boundary evaluator accepts only an exact frozen label
  record that is valid at the state's event time and whose catalog policy is
  `custodial_boundary`. Hints, legacy risk rows, unknowns, bridges, DEXes,
  generic contracts, and later-valid labels remain non-terminal. Its terminal
  evidence uses the separate immutable schema-2 discriminator; v1 evidence is
  unchanged. Before history planning, the v2 coordinator persists the largest
  entry- and byte-bounded canonical prefix of terminal evidence and its delta
  as idempotent content-addressed artifacts, then commits the checkpoint that
  references the durable delta head. A crash may leave reusable unreferenced
  artifacts, but cannot expose contradictory traversal state. Restart resumes
  without reopening terminal states; only continuing states can emit
  address-history work. The partition is repeated for frontier states generated
  by every accepted history before discovery. The entry and byte limits are
  aggregate per coordinator invocation: after the first generated-boundary
  partition, only the processed continuous ready sub-prefix commits and the
  next ready row resumes later. Commit byte limits count the exact persisted
  evidence artifacts plus the exact persisted delta, not a synthetic estimate.
- A v2 isolated canary freezes one label dataset per confirmed snapshot during
  preparation, persists each content-addressed dataset in the batch
  transaction, and binds all snapshot/dataset hashes in a schema-2 batch
  identity. V1 canary identity bytes remain unchanged. V2 rollout is not
  authorized merely by this plumbing; the existing frozen replay, live canary,
  adjudication, and capacity gates still apply.
- The active check generation fence is retained only for wallet-delivery
  idempotency between legacy and Unified delivery workers. It does not start,
  stop, authorize, or limit planner/controller execution and does not block an
  isolated canary.
- Schema changes are additive. Migration files 032–035 are never rewritten;
  no destructive down migration is generated.

## Golden Pilot V2

- Golden Pilot is offline and imports no production code.
- Exact scores exist only after two blind reviews and adjudication.
- FIFO, LIFO, and proportional attribution were compared; proportional is the
  selected locked policy.
- TBL7 and TQr are frozen regression cases. Live runs are separate canaries and
  cannot rewrite Golden expected artifacts.
- Locked manifest SHA-256 is
  `4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`.

## Telegram And Admin

The final Telegram dossier presents score, decisive evidence, balance
formation, outgoing movement, services/contracts/approvals, relationships and
behavior, coverage, wallet profile, and a compact conclusion. Repeated
transactions are aggregated. RU and EN share one report hash and have separate
presentation manifests.

Admin owns operational visibility: parent/child lifecycle, immutable attempts,
provider waits, capacity and limiting reason, planner backlog/admission/leases,
ready-buffer bytes, canonical-head age, closure/coverage, hashes, score anchor,
delivery state, and watchdog actions. Progress reports exact counters only; an
expanding frontier has no percent or ETA.

## Benchmark And Memory Evidence

- Frozen replay is the exact barrier-versus-rolling oracle and exercises
  logical capacities 1, 4, 8, 16, 32, and 100 with reproducible seeds. V1 and
  V2 have separate immutable fixtures and PostgreSQL receipts. Each receipt
  binds its own replay hash, barrier facts, policy fixture, and capacity rows;
  exact equality is required within a policy, not across policies.
- Scheduler replay proves deterministic admission behavior at logical scale.
  The PostgreSQL barrier-versus-rolling oracle executes the production runtime,
  traversal coordinator, policy boundary, finalizer, restart, and fake delivery
  path. It is the exact traversal, terminal/frontier, canonical-fact, closure,
  manifest binding, score, decision, evidence, report, presentation, restart,
  and delivery-idempotency proof. Immutable scheduler receipts remain a
  separate compatibility artifact.
- Live claims are limited to the independent groups actually configured and
  observed. Capacity above that is simulation evidence only.
- Exact hashes are compared on one frozen provider replay. Separate live runs
  may observe different chain/provider state and instead prove internal
  consistency, closure, errors, throughput, and bounded resources.
- Ten minutes is a comparison marker, not a timeout, ceiling, or completion
  rule. The system uses all safe capacity provided there is independent work.
- Isolated canaries default to a 120-minute abandoned-run safety guard. It is
  not a performance target: dense live checks continue beyond the ten-minute
  marker, and an explicitly supplied earlier watchdog deadline remains
  authoritative. Exceptional cold benchmarks may raise the startup-only
  `UNIFIED_CANARY_DEADLINE_MINUTES` guard (1..1440); restart is required.
- Local WSL samples are diagnostics. Record vmmemWSL, Linux available memory,
  swap, process RSS/heap, DB latency, and checkpoint latency before/during/after.
  Sustained growth across equivalent completed runs is the leak signal; a
  single Windows percentage is not.
- Production capacity increases require a live canary under the real Linux
  container/cgroup or host limit. New key groups raise the configured ceiling
  only after their independent grouping and live behavior are verified.
- Provider refill diagnostics are a separate best-effort V1 aggregate. They
  retain at most 512 incomplete slot/epoch correlations and 512 durations per
  phase, drop discontinuities, and export no run/task/provider identities.
  Proposed, accepted, and rejected assignments retain the pool's current-epoch
  result; rejected proposals never count as active capacity.
  They do not mutate the historical adaptive benchmark observation V1 shape;
  the current release path persists separate control/run-bound runtime samples
  and one `unified-provider-refill-observation-v1` artifact.
- A saturated sample enters the selected dense denominator only when provider
  capacity is at least four, eligible ready provider work is at least four,
  runtime resources are normal, and at least four healthy groups exist. Short
  checkpoint/commit pauses remain in the denominator. Overall average is
  reported, but the selected gate requires a non-empty denominator, at least
  3.5 active slots per sample, zero unexplained idle samples, all four audited
  groups dispatched, zero provider errors/429, zero delivery intents/external
  sends, and zero reconciliation recovery during normal saturation.
- The selected TXc benchmark is exactly one isolated canary. The command
  captures process memory before execution, once after the first provider
  claim, and after completion; it hashes the exact sample and summary files
  before persisting passing refill evidence or the index. The schema-V2 selected
  index directly binds refill hash/creator, and a sealed export sidecar binds
  runtime/configuration/run identity plus every memory file's bytes and hash.
  Resume verifies that chain without another capture or canary. Missing WSL is
  a diagnostic `skipped`, but missing/invalid/tampered process phases fail
  closed.
- Selected saturation and limiting evidence is scoped to the controlled run.
  Foreign active permits create a failing contamination sample, retained refill
  diagnostics reset and filter every assignment/rejection and
  chunk/checkpoint/claim event to the selected run set at the control boundary,
  and only timer-originated reconciliation recovery events are counted for the
  active control/run. Process-global work cannot satisfy the selected
  utilization gate.
- The selected harness writes an exclusive journal before invoking the canary.
  It syncs the file and, where supported, its parent directory before canary
  execution. A required sync failure and any partial journal state without a
  completed index block a second invocation; neither is permission to create
  another run. Memory evidence uses a fresh exclusive capture directory;
  PowerShell emits phase bytes on stdout and Node alone writes/syncs final
  children through exclusive no-follow handles.
- `checkpoint_or_commit` is a stable pool/run/task reason code but is not
  emitted by diagnostic V1. Existing state cannot prove that the transition
  holds the last otherwise-fillable slot; emission remains pending a direct
  causal signal and is never reconstructed after the fact.
- The four-group provider audit is a precondition, not evidence manufactured
  from key names, account names, or traffic. Live utilization, Linux target
  memory, and rollout remain unverified until the isolated TXc canary and
  adjudication gates pass. There is no ETA or completion percentage for an
  expanding traversal frontier.

## Separate Decisions

Address-poisoning remains a separate wallet-safety feature and cannot influence
AML score. Recipient precheck before signing is a follow-up, not part of this
change.
