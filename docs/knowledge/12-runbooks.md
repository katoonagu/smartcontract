---
status: current
last_verified: 2026-07-27
owner_area: docs
code_refs:
  - package.json
  - scripts/migrate.ts
  - scripts/verifyCurrentSchema.ts
  - scripts/runUnifiedWalletCanary.ts
  - scripts/runUnifiedAdaptiveBenchmark.ts
  - scripts/captureUnifiedWslMemory.ps1
  - src/unifiedCheck
  - src/forensics/forensicSlotPump.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/whereLatencyReplay.ts
  - scripts/captureWhereLatencyReplay.ts
  - scripts/runWhereLatencyCanary.ts
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

## Legacy Where Latency Replay

The Stage B replay is read-only: it parses the checked-in canonical legacy tape,
runs selective transaction enrichment twice against one in-memory evidence
store, and prints only baseline/new raw/full request counts plus
`stableFactsEqual` and the non-secret HEAD commit, fixture blob, and raw-content
SHA-256 identities. The fixture freezes a canonical
`expectedOrdinaryOfficialUsdtTxHashes` manifest from baseline raw/indexed facts;
the post-Stage-B resolver cannot redefine that set to evade the zero-full-call
gate. Its `frozenKnownHardTxHashes` input is recomputed from the frozen legacy
report, and the ordinary manifest is recomputed from those known-hard facts plus
the frozen raw, indexed movement, and assertion facts before analysis.

```powershell
npm.cmd run forensic:where-latency:replay -- --fixture tests/fixtures/forensics/txc-legacy-where-latency-v1.json
```

Run this command only from the repository root. The release CLI accepts no
other fixture path, requires the canonical fixture to be tracked in HEAD with
the repository index and worktree completely clean against HEAD, including no
staged, unstaged, or untracked files (standard Git ignore rules apply), and
verifies that the fixture's current raw bytes hash to the exact HEAD blob. This
prevents executed TypeScript, module-resolution inputs, or dependencies from
differing from the commit named in the receipt. It fails closed in a source
archive without Git. Synthetic fixtures are supported only through unit-level
analysis APIs and cannot be used by the release command.

It fails closed for a missing file, noncanonical envelope, malformed evidence,
or provenance-invalid tape; it never falls back to a database or network
provider. A structurally valid route manifest may explicitly lack a raw or
full response. Analysis exposes canonical missing-raw/missing-full identity
lists; a missing raw or requested hard full response also produces
incomplete/technical-unknown report coverage. Acceptance requires both raw and
full frozen evidence for every route-critical hash, including an ordinary hash
whose Stage B run did not need to request full details. The real TXc tape is not
currently checked in, so this acceptance command and concurrency `2` remain
blocked as recorded in `10-open-problems.md`. Synthetic tests validate the
offline machinery but are not release evidence.

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
and refill phase percentiles with fixed 512-sample bounds. While the selected
control is active, the accumulator accepts only its exact run set, including
rejection, chunk, checkpoint, and claim events. It is not yet a release
evidence artifact and must not be used to claim live utilization or a higher
production capacity ceiling.

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
its children. Before accessing output paths or invoking the canary, it commits a
stable PostgreSQL selected-authorization marker. This is a terminal isolated
maintenance request with no run, not a canary result. It must remain outside
worker claims, user/delivery counts, Admin active runs, reconciliation work, and
automatic cleanup. A marker without a valid completed index stops with
`unified_benchmark_selected_partial_state`; changing output directories cannot
bypass it. Inspect the marker and any recorded run/control, then adjudicate the
orphan. Do not delete the marker merely to obtain another canary.

Selected utilization comes only from the controlled run. Any foreign active
provider permit is a contamination failure; foreign accepted/rejected
proposals and lifecycle timing events are absent from its refill diagnostics.
Only a timer/reconciliation tick can emit `reconciliation_recovered_work`; an
ordinary event/intake/slot wake cannot. Any counted recovery rejects the gate.

## WSL And Linux Memory Capture

The selected TXc command above captures each local phase automatically. For a
manual diagnostic outside that gate, capture one phase from the runtime metrics
snapshot with direct PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/captureUnifiedWslMemory.ps1 `
  -RunId <run-id> -ScenarioId <scenario-id> `
  -Phase before -NodePid <node-pid> `
  -RuntimeRssBytes <node-rss-bytes> `
  -RuntimeHeapUsedBytes <node-heap-used-bytes>
```

The script emits one canonical sample on stdout and receives no runtime or
output pathname. The selected harness compares returned RSS/heap exactly with
the Node-captured argument values, validates all three phases, builds the
summary, and exclusively creates/syncs its final files from Node. For a manual
diagnostic, preserve each phase's stdout separately; it is not selected-gate
evidence. Record vmmemWSL, Linux available memory/swap, and process RSS/heap. A
missing WSL process is a diagnostic skip. Local WSL is not evidence of server
capacity; repeat capacity gates under the target Linux container/cgroup or host
limit.

## Delivery Recovery

The generation fence controls delivery ownership only. Controller, planner,
analysis, reconciliation, and isolated canaries do not depend on it.

`DELIVERY_UNKNOWN` is inspected manually and never auto-retried. Any manual
resend uses the explicit warned/audited path. Never grant legacy and Unified
automatic delivery ownership at the same time.

## Stage B Where Queue Diagnostics

Use the count-only `performanceTiming` and lifecycle logs to compare runnable
queue age, DB-running jobs, occupied/active slots, selective enrichment, and
scheduler counter deltas. Runnable age excludes
`waiting_for_targeted_index`, which belongs to the indexing wait path.
Scheduler counters are process-global. Treat any concurrent monitor, approval,
Deep, Incoming, Unified, or other provider consumer as contamination; compute
a job/canary delta only in the isolated runtime window.

In an isolated concurrency-two canary, `occupiedSlotsAtPoll = 0` or `1`
leaves capacity for new work. When it is `2`, both slots were already occupied
by monolithic jobs, so Stage B makes no bounded-start SLA claim for a newly
queued job; do not publish a start SLA from that poll. Never expand these
aggregate diagnostics with an address, transaction hash, chat/key identifier,
label, or username.

## Isolated Stage B Where Concurrency-Two Canary

This is a destructive-to-the-clone, no-delivery operational check. Run it only
inside a dedicated canary deployment and database clone. It refuses a shared
database: every runnable/running forensic job must be absent, and the same
process-global TronScan scheduler must begin with `queued = 0` and
`inFlight = 0`. Never delete or cancel user jobs to make those checks pass.

The deployment must start only these runtime cycles:

```text
address_index,delivery_reconciliation,where
```

`delivery_reconciliation` is the null-chat/no-op reconciliation used to prove
that no delivery intent or claim appears. Monitor polling, approvals, Deep,
Incoming, Unified provider work, Telegram polling, and every other provider
consumer must be disabled. Deep remains configured at one and is not run by
this canary.

The command obtains authoritative process observations through the trusted
in-process adapter named by `WHERE_LATENCY_CANARY_RUNTIME_ADAPTER`. That module
must export `createWhereLatencyCanaryRuntime(config)` and bind to the exact
dedicated Where pump, scheduler, forensic repository, and delivery repository;
an adapter that estimates scheduler counters from database rows is invalid.
The CLI resolves the module's real path, hashes its bytes before loading, checks
the bytes again after loading, and binds both values into every receipt. The
adapter must return an observed runtime attestation: cycle registry, instance
label, runtime-config SHA-256, database fingerprint, Where/Deep concurrency,
scheduler capacity, and SHA-256 binding identities for the Where pump, Deep
worker, scheduler, forensic repository, delivery repository, and address-index
worker. These observations must match the expected environment exactly; the
environment alone is never isolation evidence.
The adapter owns only jobs whose unique `requestedBy` and progress marker are
provided by the harness. Its `stopClaimsAndDrain` must stop new canary claims
and await every canary-owned handler promise before returning. The command
fails closed when the adapter is absent or does not expose the complete
contract.

Prepare the deployment with a new clone and the candidate build, verify its
cycle allowlist, then set:

```powershell
$env:DATABASE_URL = "<dedicated-canary-clone>"
$env:RUNTIME_INSTANCE_LABEL = "where-canary-<unique-instance>"
$env:WHERE_LATENCY_CANARY_DEDICATED = "true"
$env:WHERE_LATENCY_CANARY_ENABLED_CYCLES = "where,address_index,delivery_reconciliation"
$env:WHERE_LATENCY_CANARY_RUNTIME_ADAPTER = "<absolute-path-to-deployment-runtime-adapter>"
$env:WHERE_LATENCY_CANARY_RUNTIME_CONFIG_SHA256 = "<canonical-deployed-config-sha256>"
$env:FORENSIC_WHERE_WORKER_CONCURRENCY = "2"
```

The `prepare` command exclusively creates a canonical
`where-latency-canary-isolation-v1` receipt. It contains only a non-secret
database fingerprint, runtime instance label, exact cycle allowlist, Where and
Deep concurrency, polling interval, the clean scheduler baseline, capacity
fingerprint, config hash, and receipt SHA-256. The database password and API
keys are never written. `run` re-hashes the exact receipt, re-derives its
configuration and capacity, and requires the scheduler counters to still
equal the prepared clean baseline before it enqueues anything.

```powershell
npm.cmd run forensic:where-latency:canary -- prepare `
  --out outputs/where-latency-canary/isolation.json

npm.cmd run forensic:where-latency:canary -- run --confirm `
  --isolation-receipt outputs/where-latency-canary/isolation.json
```

Both isolation and run receipts are create-only: remove neither and choose a
new path for every attempt. A pass receipt is written under
`outputs/where-latency-canary/` only after both canary jobs are terminal, their
null-chat delivery intent/claim counts are zero, new canary claims are stopped,
all canary-owned promises are drained, and the final scheduler snapshot is
taken. The fresh TXc handler must start within two Where poll intervals and no
later than five seconds while the long TQr handler occupies exactly one slot.
At TXc start, the adapter must observe both handlers active, report exactly two
active Where handlers, and still report the long job as running. The receipt
contains start/end lane snapshots, pre-drain and post-drain delivery snapshots,
and matching monotonic dispatched/completed scheduler deltas.
Maximum active Where handlers is two; scheduler rate-limited and failed-request
deltas are zero; scheduler/key capacity is unchanged.

If both slots are occupied before TXc can be introduced, the receipt is
`non_gating_not_isolated` with `no_stage_b_start_guarantee`. It is not a failed
one-slot measurement and cannot promote concurrency two. Wait for a genuinely
isolated window; never evict work. A shared-scheduler diagnostic is likewise
non-gating and its global deltas are not release evidence.

Cleanup ownership belongs to the operator of the disposable clone. Preserve
receipts and structured logs, stop the dedicated process, confirm its pump is
drained, and then retire the clone through the normal infrastructure workflow.
The harness does not delete jobs or databases.

After the Where canary, restart the dedicated deployment with only
`address_index,deep,delivery_reconciliation` enabled and Deep at one. Keep the
same adapter/config identity requirements, choose a new output path, and run:

```powershell
$env:WHERE_LATENCY_CANARY_ENABLED_CYCLES = "deep,address_index,delivery_reconciliation"
npm.cmd run forensic:where-latency:canary -- deep-residual --confirm `
  --out outputs/where-latency-canary/deep-residual-<unique-id>.json
```

The create-only `where-latency-deep-residual-v1` receipt records TXc queue age,
handler start, terminal state, job and scheduler provider errors/rate limits,
before/start/after-drain process memory, start/end lane and scheduler snapshots,
and delivery before/after drain. It requires the observed Deep handler count to
remain exactly one and delivery to remain zero. This is a measurement, not a
Where promotion gate. Do not mix it into the Where receipt and do not raise
Deep concurrency under this plan. If Deep dominates, keep a separate
`default 1 / isolated canary 2` design problem.

For production promotion, compare the existing structured scheduler logs for
30 minutes before and 30 minutes after enabling Where concurrency two. Compute
rate-limited requests per dispatched request and failed requests per dispatched
request for each window. Neither post-window rate may be higher. Any
contamination, missing denominator, capacity increase, or delivery duplication
blocks promotion and restores the default value of one.

No Stage B concurrency-two receipt has been produced yet. This checkout has no
dedicated canary database/configuration or deployment-owned attested runtime adapter,
and the real legacy TXc replay evidence is still absent. Do not run against the
current shared environment and do not treat the deterministic fake-runtime
tests as rollout evidence; production concurrency two remains blocked.
