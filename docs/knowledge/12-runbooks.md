---
status: current
last_verified: 2026-07-26
owner_area: docs
code_refs:
  - package.json
  - scripts/migrate.ts
  - scripts/verifyCurrentSchema.ts
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - scripts/captureUnifiedWslMemory.ps1
  - src/unifiedCheck
---

# Runbooks

## Read Russian Markdown On Windows

```powershell
Get-Content -Raw -Encoding UTF8 docs/knowledge/AGENT_BRIEF.md
```

## Schema 036

Migration 036 is additive history: it removes the obsolete rollout-receipt
authority from the current run policy while leaving migrations 032–035 bytes
unchanged.

Apply all migrations and verify the current schema:

```powershell
npm.cmd run db:migrate
npm.cmd run schema:verify
```

For a migration rehearsal, use a disposable PostgreSQL database and run
`db:migrate` twice. The first run must apply and verify 032–036; the second must
report all tracked migrations already verified. PostgreSQL integration tests
must not be counted as passed if Vitest reports them skipped.

```powershell
$env:TEST_DATABASE_URL = "<temporary-postgresql-url>"
npm.cmd test -- tests/storage/migration034.postgres.test.ts tests/storage/migration035.postgres.test.ts tests/storage/migration036.postgres.test.ts tests/unified-check/requestService.postgres.test.ts tests/unified-check/rollingAdmission.postgres.test.ts tests/unified-check/claimPermits.postgres.test.ts tests/unified-check/reconciliation.postgres.test.ts tests/unified-check/barrierFallback.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/orderedCommit.postgres.test.ts
```

Never edit historical migration files and never generate a destructive down
migration. A pre-034 binary rollback must drain or block rolling runs before the
old process starts; the database remains at the forward schema.

## Adaptive Provider Configuration

Safe barrier fallback:

```powershell
$env:UNIFIED_ROLLING_ROLLOUT_STAGE = "global_barrier"
$env:UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS = "0"
$env:UNIFIED_PROVIDER_CAPACITY_CEILING = "1"
```

Isolated rolling benchmark with the currently verified ceiling:

```powershell
$env:UNIFIED_ROLLING_ROLLOUT_STAGE = "isolated_rolling"
$env:UNIFIED_ROLLING_USER_CHECK_BASIS_POINTS = "0"
$env:UNIFIED_PROVIDER_CAPACITY_CEILING = "4"
$env:UNIFIED_ISOLATED_WORKER_ONLY = "true"
```

`UNIFIED_ISOLATED_WORKER_ONLY=true` starts only Unified controller/provider/
analysis/finalization/watchdog work for `release_canary` runs. It does not start
Telegram polling, any delivery worker, or legacy/address-poisoning schedules.

`UNIFIED_PROVIDER_CAPACITY_CEILING` is only a ceiling. Actual slots are the
minimum of healthy independent group concurrency, provider/worker config,
DB/memory guards, and eligible ready provider work. RPS pacing and cooldown are
handled by the provider scheduler, not by this concurrency setting.

Run deterministic controller, fairness, pool, admission, reconciliation,
fallback, and scale checks:

```powershell
npm.cmd test -- tests/unified-check/providerCapacityController.test.ts tests/unified-check/fairProviderAllocator.test.ts tests/unified-check/providerPool.test.ts tests/unified-check/rollingAdmission.test.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/admissionRuntimeControl.test.ts tests/unified-check/reconciliation.test.ts tests/unified-check/providerScaleSimulation.test.ts
```

Run the bounded provider-refill diagnostic contract and lifecycle wiring:

```powershell
npm.cmd test -- tests/unified-check/providerRefillDiagnostics.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionWorker.test.ts tests/unified-check/adaptiveObservability.test.ts tests/unified-check/providerPool.test.ts tests/unified-check/adaptiveRuntime.test.ts
```

The `unified-provider-refill-diagnostics-v1` snapshot is identity-free,
best-effort process evidence. It reports proposed/accepted/rejected assignments
and refill phase percentiles with fixed 512-sample bounds. It is not yet a
release evidence artifact and must not be used to claim live utilization or a
higher production capacity ceiling.

### Emergency rolling-to-barrier fallback

On Linux, request the one-way hot fallback:

```bash
kill -USR2 <bot-pid>
```

`unified_admission_barrier_fallback` confirms the serialized switch. New
rolling admissions stop, unleased tails are de-admitted, and an active HTTP
request finishes its bounded chunk. Repeating the signal is idempotent. There
is no hot barrier-to-rolling switch; restart with validated configuration.

## Frozen Replay Benchmark

Use identical provider pages, snapshot, clock, and deterministic identities for
exact oracle comparison:

```powershell
node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode replay `
  --capacity 1,4,8,16,32,100 `
  --seed 24072026 `
  --traversal-policy snapshot-closure-v1 `
  --oracle-receipt artifacts/unified-adaptive/plan3-b2-oracle.json `
  --output <artifact-root>/unified-adaptive/replay-v1.json

node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode replay `
  --capacity 1,4,8,16,32,100 `
  --seed 24072026 `
  --traversal-policy snapshot-closure-v2 `
  --oracle-receipt artifacts/unified-adaptive/fast-fix-v2-oracle.json `
  --output <artifact-root>/unified-adaptive/replay-v2.json
```

Logical capacity above the live pool proves scheduler behavior only. It does
not prove real provider RPS or speedup. Scheduler simulation does not replace
the exact within-policy PostgreSQL oracle:

```powershell
$env:TEST_DATABASE_URL = "<temporary-postgresql-url>"
$env:UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V2 = `
  "artifacts/unified-adaptive/fast-fix-v2-oracle.json"
npm.cmd test -- tests/unified-check/rollingOracleEquivalence.postgres.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
Remove-Item Env:UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V2
```

Use `UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V1` only for a new explicit V1
destination. Never rewrite `plan3-b2-oracle.json`. Receipt writes are
create-if-absent and reject differing existing bytes.

## Isolated Live Canary

The canary can run with legacy or Unified delivery ownership because isolated
runs create no delivery intent. It requires the same committed runtime SHA and
schema 036, but no release generation or signed rollout receipt.

When `UNIFIED_TRAVERSAL_POLICY_VERSION=snapshot-closure-v2`, preparation freezes
and persists the production label dataset separately for each confirmed
snapshot. The schema-2 batch identity records every subject, snapshot hash, and
dataset hash. Resume by that identity; do not substitute the current live label
rows or reuse the legacy schema-1 canary identity.

For the three-wallet operational check:

- select the latest three unique eligible addresses without score/outcome
  filtering;
- create all three isolated runs before waiting for completion;
- use `isolated_rolling` with ceiling four;
- do not impose a ten-minute timeout; use lifecycle terminal state and the
  watchdog as correctness boundaries;
- capture active/idle slots, group health, requests per group, rolling RPS,
  429/errors, DB/checkpoint latency, buffer state, limiting reasons, and memory;
- verify no Telegram delivery intent was created.

The canary does not require all four slots to remain busy when the graph lacks
independent ready work. Any idle slot must have an observable reason.
The default isolated-canary safety deadline is 120 minutes. It protects against
abandoned work and is not an SLO; do not shorten it to the ten-minute benchmark
marker. A run that reaches this guard is a blocked result, not a completed
wallet report. For an exceptional cold traversal known to exceed the default,
set `UNIFIED_CANARY_DEADLINE_MINUTES` to an integer from 1 through 1440 before
starting both the isolated worker and canary harness. The setting is
startup-only and must be reset to 120 after the benchmark.

### Selected TXc refill and memory gate

First verify that the provider-audit artifact proves four independent healthy
groups. Key strings, names, and observed traffic are not enough. Create an
existing, non-symlink directory for the memory files, then run exactly one
isolated TXc binding with direct Node:

```powershell
node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode live `
  --capacity 4 `
  --isolated `
  --scenario isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd `
  --traversal-policy snapshot-closure-v2 `
  --memory-evidence-dir <existing-memory-evidence-directory> `
  --provider-audit <four-independent-groups-audit.json> `
  --output <artifact-root>/unified-adaptive/selected-txc-v2.json
```

The command passes the traversal policy directly to the canary; it does not
mutate the process environment. It captures before/during/after process phases
within this same canary and writes no passing index until the refill and memory
artifact validates. Do not start a second memory-only canary. Resume the exact
same output/policy/scenario; resume verifies the schema-V2 index, sealed export
sidecar, refill creator/hash, control/runtime/configuration/run bindings, and
the exact bytes and hashes of all memory files without recapture. A changed
policy/scenario or replaced sidecar, refill, or memory file fails closed.
The command creates a fresh exclusive capture subdirectory; do not pre-create
its children. It also writes `selected-canary-journal.json` before invoking the
canary. If that journal exists without a valid completed index, the command
stops with `unified_benchmark_selected_partial_state` and must not be rerun or
have the journal deleted merely to obtain another canary. Inspect the recorded
run/control and adjudicate the orphan first.

Selected utilization comes only from the controlled run. Any foreign active
provider permit is a contamination failure, and any counted
`reconciliation_recovered_work` event rejects the gate.

## WSL And Linux Memory Capture

The selected TXc command above captures each local phase automatically. For a
manual diagnostic outside that gate, capture one phase from the runtime metrics
snapshot with direct PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/captureUnifiedWslMemory.ps1 `
  -RunId <run-id> -ScenarioId <scenario-id> `
  -Phase before -NodePid <node-pid> `
  -RuntimeSnapshotPath <runtime-memory.json> `
  -OutputPath <memory-samples.json>
```

Repeat for `during` and `after`; pass `-SummaryPath` on the final sample. Record
vmmemWSL, Linux available memory/swap, and process RSS/heap. A missing WSL
process is a diagnostic skip. Local WSL is not evidence of server capacity;
repeat capacity gates under the target Linux container/cgroup or host limit.

## Delivery Recovery

The generation fence controls delivery ownership only. Controller, planner,
analysis, reconciliation, and isolated canaries do not depend on it.

`DELIVERY_UNKNOWN` is inspected manually and never auto-retried. Any manual
resend uses the explicit warned/audited path. Never grant legacy and Unified
automatic delivery ownership at the same time.
