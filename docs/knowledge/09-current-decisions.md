---
status: current
last_verified: 2026-07-25
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
  logical capacities 1, 4, 8, 16, 32, and 100 with reproducible seeds.
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

## Separate Decisions

Address-poisoning remains a separate wallet-safety feature and cannot influence
AML score. Recipient precheck before signing is a follow-up, not part of this
change.
