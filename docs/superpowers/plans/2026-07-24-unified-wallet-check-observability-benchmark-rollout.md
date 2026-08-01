# Unified Wallet Check Observability, Benchmark, and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adaptive rolling operable, prove it against a frozen barrier oracle, run the honest one/four-group and memory gates, then promote rolling admission with a tested hot fallback.

**Architecture:** Low-cardinality aggregate metrics and on-demand Admin snapshots observe the controller without entering correctness transactions. A frozen provider replay runs barrier and rolling through the same planner/commit code and compares canonical outputs exactly. Live canaries are isolated from Telegram delivery, record actual capacity and resource behavior, and produce a fail-closed release receipt.

**Tech Stack:** TypeScript 5.7, Node.js, PostgreSQL, `pg`, Vitest, existing Admin/runtime/release tooling, PowerShell and WSL diagnostics; no new telemetry or benchmark dependency.

**Prerequisites:** Complete:

- `docs/superpowers/plans/2026-07-24-unified-wallet-check-durable-ordered-planner.md`;
- `docs/superpowers/plans/2026-07-24-unified-wallet-check-adaptive-capacity-fairness.md`.

**Design:** `docs/superpowers/specs/2026-07-24-unified-wallet-check-adaptive-rolling-planner-design.md`

---

## File map

- Create `src/unifiedCheck/adaptiveObservability.ts`: aggregate metric snapshot,
  stable reason/event types, and best-effort sinks.
- Create `src/unifiedCheck/adminRunSnapshot.ts`: bounded, on-demand per-run
  diagnostic projection.
- Modify `src/unifiedCheck/providerCapacityController.ts`,
  `src/unifiedCheck/fairProviderAllocator.ts`, and
  `src/unifiedCheck/productionRuntime.ts`: emit decision-time reasons and
  transition events.
- Modify `src/unifiedCheck/progressProjection.ts`,
  `src/unifiedCheck/repository.ts`, and Admin runtime/server files: expose the
  run snapshot without persistent high-cardinality labels or ETA.
- Create `src/unifiedCheck/providerReplay.ts` and replay fixtures: freeze
  provider responses, clock, identities, and snapshots.
- Create `scripts/runUnifiedAdaptiveBenchmark.ts`: deterministic and live
  scenario runner with canonical evidence.
- Create `scripts/captureUnifiedWslMemory.ps1`: local before/during/after WSL and
  process memory samples.
- Modify Unified release receipt/finalization scripts: require the appropriate
  replay, live, isolated-delivery, restart, and target-Linux gates.
- Add focused tests under `tests/unified-check`, `tests/admin`, and
  `tests/runtime`.
- Update knowledge pages 03, 04, 07, 08, 09, 10, and 12 after rollout behavior
  is implemented.

### Task 1: Add minimal best-effort aggregate observability

**Files:**
- Create: `src/unifiedCheck/adaptiveObservability.ts`
- Create: `tests/unified-check/adaptiveObservability.test.ts`
- Modify: `src/unifiedCheck/providerCapacityController.ts`
- Modify: `src/unifiedCheck/fairProviderAllocator.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`

- [ ] **Step 1: Write RED contract tests**

Define one aggregate snapshot and assert it contains:

- provider capacity limit, ready demand, target, active slots;
- healthy/cooldown/circuit-open group counts;
- rolling 60-second RPS, total requests/errors/429;
- runtime state and pool limiting reason;
- RSS/heap and available container/host memory;
- DB pool waiting count, DB latency, checkpoint latency;
- planner counts by merge-state;
- ready count/bytes and reserved bytes;
- canonical-head age;
- repair minimum, actual repair slots, wait violations;
- reconciliation actionable tick count.

Assert it contains no `runId`, `ownerId`, wallet address, task ID, or per-run
metric label.

Run:

```powershell
npm test -- tests/unified-check/adaptiveObservability.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Define stable decision-time reason codes**

Create:

```typescript
export type UnifiedReasonScope = "pool" | "run" | "task";

export type UnifiedReasonCode =
  | "no_eligible_work"
  | "fairness_wait"
  | "admission_closed"
  | "provider_rate_paced"
  | "provider_cooldown"
  | "provider_circuit_open"
  | "canonical_head_wait"
  | "merge_buffer_full"
  | "db_pressure"
  | "memory_pressure"
  | "class_capacity_limit"
  | "repair_reserve_reclaim"
  | "background_preempted"
  | "reconciliation_wait";

export interface UnifiedDecisionReason {
  scope: UnifiedReasonScope;
  code: UnifiedReasonCode;
}
```

Return the reason from the controller/scheduler action that stopped progress.
Do not derive it later from gauges. Enforce in tests that `fairness_wait` and
`background_preempted` cannot be emitted with `pool` scope.

- [ ] **Step 3: Add only transition/anomaly event types**

Allow:

```typescript
export type UnifiedAdaptiveEventType =
  | "provider_group_state_changed"
  | "resource_state_changed"
  | "planner_soft_overflow"
  | "manifest_hard_limit_rejected"
  | "repair_wait_violated"
  | "reconciliation_recovered_work"
  | "invariant_violated"
  | "idempotent_acceptance_replayed";
```

Use the existing structured logger with bounded sampling/retention settings.
Do not create a database event row for chunks, scheduler cycles, surplus
transfers, or ordinary allocation.

- [ ] **Step 4: Make every sink failure non-fatal**

Wrap exporter, logger, and snapshot callbacks at their call boundary. Tests
inject throwing sinks and prove task acceptance, checkpoint, ordered commit,
and the controller cycle still succeed.

```typescript
export function emitBestEffort(
  sink: (event: UnifiedAdaptiveEvent) => void,
  event: UnifiedAdaptiveEvent,
): void {
  try {
    sink(event);
  } catch {
    // ponytail: telemetry is deliberately outside correctness; upgrade only
    // if an out-of-process durable observability channel becomes necessary.
  }
}
```

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test -- tests/unified-check/adaptiveObservability.test.ts tests/unified-check/orderedAcceptance.postgres.test.ts tests/unified-check/orderedCommit.postgres.test.ts
npm run typecheck
git add src/unifiedCheck/adaptiveObservability.ts tests/unified-check/adaptiveObservability.test.ts src/unifiedCheck/providerCapacityController.ts src/unifiedCheck/fairProviderAllocator.ts src/unifiedCheck/productionRuntime.ts
git commit -m "feat(unified): observe adaptive controller decisions"
```

Expected: PASS; observability exceptions remain non-fatal.

### Task 2: Add a bounded on-demand Admin run snapshot

**Files:**
- Create: `src/unifiedCheck/adminRunSnapshot.ts`
- Create: `tests/unified-check/adminRunSnapshot.test.ts`
- Modify: `src/unifiedCheck/repository.ts`
- Modify: `src/unifiedCheck/progressProjection.ts`
- Modify: `tests/unified-check/progressProjection.postgres.test.ts`
- Modify: `src/admin/adminRuntime.ts`
- Modify: `src/admin/adminServer.ts`
- Create: `tests/admin/unifiedRunSnapshot.test.ts`

- [ ] **Step 1: Write the RED projection test**

For one run, assert the response contains:

```typescript
interface UnifiedAdminRunSnapshot {
  ownerId: string;
  lane: "interactive" | "repair" | "background";
  fairShare: number;
  activeSlots: number;
  lastServedAt: string | null;
  lookaheadTarget: number;
  planner: {
    durableBacklog: number;
    admitted: number;
    leased: number;
    ready: number;
    committed: number;
  };
  canonicalHead: {
    taskId: string;
    state: string;
    ageMs: number;
  } | null;
  buffer: { readyCount: number; readyBytes: number; reservedBytes: number };
  lastCommitAt: string | null;
  blocker: UnifiedDecisionReason | null;
  elapsedMs: number;
  completedChunks: number;
  throughputPerMinute: number;
}
```

Assert there is no ETA field and no provider key or raw chat/user identity.

- [ ] **Step 2: Implement one bounded SQL query**

Query a single authorized `run_id`, aggregate planner/task counts in SQL, and
limit any identity/detail join to the canonical head and last commit. Reuse the
Plan 2 in-memory allocation snapshot for current fair share/slots/reason; return
zero/null after process restart until the next controller decision.

Do not persist ordinary scheduler-cycle history.

- [ ] **Step 3: Expose the snapshot through the existing Admin authorization**

Add one read-only Admin endpoint/action using the existing Admin authentication.
Treat missing run as not found and owner as opaque. Keep the customer Telegram
report unchanged.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test -- tests/unified-check/adminRunSnapshot.test.ts tests/unified-check/progressProjection.postgres.test.ts tests/admin/unifiedRunSnapshot.test.ts
npm run typecheck
git add src/unifiedCheck/adminRunSnapshot.ts tests/unified-check/adminRunSnapshot.test.ts src/unifiedCheck/repository.ts src/unifiedCheck/progressProjection.ts tests/unified-check/progressProjection.postgres.test.ts src/admin/adminRuntime.ts src/admin/adminServer.ts tests/admin/unifiedRunSnapshot.test.ts
git commit -m "feat(admin): show unified rolling run snapshot"
```

Expected: PASS; no run/owner metric labels or ETA are introduced.

### Task 3: Build the frozen provider replay and exact oracle gate

**Files:**
- Create: `src/unifiedCheck/providerReplay.ts`
- Create: `tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json`
- Create: `tests/unified-check/providerReplay.test.ts`
- Create: `tests/unified-check/rollingOracleEquivalence.postgres.test.ts`
- Modify: `src/unifiedCheck/performanceMetrics.ts`
- Modify: `tests/unified-check/performanceMetrics.test.ts`

- [ ] **Step 1: Write RED replay validation tests**

The replay envelope must include and validate:

```typescript
interface UnifiedProviderReplayV1 {
  version: "unified-provider-replay-v1";
  frozenAt: string;
  frozenClockIso: string;
  schemaVersion: 34;
  sourceSnapshotSha256: string;
  requests: Array<{
    endpoint: string;
    canonicalRequestSha256: string;
    responseArtifactSha256: string;
  }>;
  expectedReplaySha256: string;
}
```

Reject duplicate request identities, missing responses, unreferenced responses,
invalid SHA-256, non-canonical JSON, and a replay hash mismatch.

- [ ] **Step 2: Add a deterministic recording/replay adapter**

The adapter records canonical request identity and immutable response artifact
once, then serves responses without network access. Freeze clock, snapshot,
task IDs, run IDs, and request ordering seeds. Reuse
`canonicalizeArtifactJson`; do not add a serialization dependency.

- [ ] **Step 3: Write the exact barrier-versus-rolling test**

Against separate disposable schema-034 databases:

1. run barrier admission on the replay;
2. run rolling admission at logical capacities `1, 4, 8, 16, 32, 100`;
3. randomize task completion order with recorded seeds;
4. compare canonical facts, traversal closure certificate, frontier,
   score, decision, evidence hash, report hash, and delivery-intent count.

Failure output must include replay hash, seed, capacity, and first differing
canonical path.

Do not compare hashes from independent live runs.

- [ ] **Step 4: Prove retry/restart delivery invariants**

For an authoritative `user_check`, assert one delivery intent for each eligible
request. For isolated replay, assert zero external Telegram sends. Repeat
acceptance, kill after commit, restart before refill, and prove no second intent
or commit.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test -- tests/unified-check/providerReplay.test.ts tests/unified-check/rollingOracleEquivalence.postgres.test.ts tests/unified-check/performanceMetrics.test.ts
npm run typecheck
git add src/unifiedCheck/providerReplay.ts tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json tests/unified-check/providerReplay.test.ts tests/unified-check/rollingOracleEquivalence.postgres.test.ts src/unifiedCheck/performanceMetrics.ts tests/unified-check/performanceMetrics.test.ts
git commit -m "test(unified): compare rolling with frozen barrier oracle"
```

Expected: every rolling capacity produces exact canonical equality.

### Task 4: Create a reproducible benchmark and evidence contract

**Files:**
- Create: `src/unifiedCheck/adaptiveBenchmarkEvidence.ts`
- Create: `tests/unified-check/adaptiveBenchmarkEvidence.test.ts`
- Create: `scripts/runUnifiedAdaptiveBenchmark.ts`
- Modify: `package.json`
- Create: `tests/scripts/runUnifiedAdaptiveBenchmark.test.ts`

- [ ] **Step 1: Write RED evidence-validation tests**

Require one canonical result per scenario with:

- mode (`replay` or `live`);
- admission policy and actual independent-group capacity;
- wall time and aggregate throughput;
- capacity/demand/target/actual slots and utilization;
- RPS, requests, errors, 429;
- limiting reason and canonical-head age;
- ready/reserved bytes;
- DB/checkpoint latency and pool waiting;
- RSS/heap and available container/host memory;
- repair wait, cache/reuse, restart recovery;
- replay/oracle hashes where applicable;
- delivery intents and external Telegram send count;
- immutable evidence SHA-256.

Reject evidence that claims live capacities not present in its audited group
snapshot.

- [ ] **Step 2: Implement one benchmark CLI**

Add:

```json
"benchmark:unified-adaptive": "tsx scripts/runUnifiedAdaptiveBenchmark.ts"
```

Support explicit commands:

```powershell
npm run benchmark:unified-adaptive -- --mode replay --capacity 1,4,8,16,32,100 --seed 24072026 --output artifacts/unified-adaptive/replay.json
npm run benchmark:unified-adaptive -- --mode live --capacity 1 --isolated --output artifacts/unified-adaptive/live-capacity-1.json
npm run benchmark:unified-adaptive -- --mode live --capacity 4 --isolated --output artifacts/unified-adaptive/live-capacity-4.json
```

The live capacity-4 command must fail closed unless a configuration audit marks
all four groups independent. Never infer independence from four API key strings.

- [ ] **Step 3: Encode the scenario matrix**

Replay runs:

- one, three, and fifteen simultaneous wallets;
- new interactive work during heavy traversal;
- slow canonical head;
- cooldown;
- kill/restart;
- one full merge buffer;
- repair arrival and capacity-1 alternation.

Live runs for actual capacity 1 and audited capacity 4:

- one dense wallet;
- three dense wallets concurrently;
- new interactive work during heavy traversal;
- slow canonical head;
- one-group cooldown;
- kill/restart;
- one run filling its buffer;
- the three isolated real wallets:
  `TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV`,
  `TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr`,
  `TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd`.

Live mode must create no external Telegram delivery and must not claim exact
hash equality with a run made at a different blockchain/provider time.

- [ ] **Step 4: Make output canonical and resumable**

Write each completed scenario as an immutable artifact before advancing the
suite. On restart, verify its hash and skip only an identical completed
scenario. Produce one final canonical index referencing every artifact.

- [ ] **Step 5: Run the deterministic CLI test and commit**

```powershell
npm test -- tests/unified-check/adaptiveBenchmarkEvidence.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
npm run typecheck
git add src/unifiedCheck/adaptiveBenchmarkEvidence.ts tests/unified-check/adaptiveBenchmarkEvidence.test.ts scripts/runUnifiedAdaptiveBenchmark.ts package.json tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
git commit -m "feat(unified): add adaptive rolling benchmark"
```

Expected: PASS; no network or Telegram call occurs in the CLI unit test.

### Task 5: Capture local WSL memory and require target-Linux evidence

**Files:**
- Create: `scripts/captureUnifiedWslMemory.ps1`
- Create: `tests/scripts/captureUnifiedWslMemory.test.ts`
- Modify: `scripts/runUnifiedAdaptiveBenchmark.ts`
- Modify: `src/unifiedCheck/adaptiveBenchmarkEvidence.ts`

- [ ] **Step 1: Write RED parser/evidence tests**

Given saved command output, parse:

- Windows `vmmemWSL` working set;
- Linux `MemAvailable`;
- Linux swap total/free;
- Unified Node process RSS/heap;
- sample phase: before, during, after;
- run/scenario identity and timestamp.

Treat missing WSL as a local diagnostic skip, not a production pass.

- [ ] **Step 2: Implement the PowerShell sampler**

Use `Get-Process -Name vmmemWSL -ErrorAction SilentlyContinue` and
`wsl.exe -- cat /proc/meminfo`; sample the target Node PID through the existing
runtime metrics endpoint/snapshot. Write JSON samples at a configured interval
and one canonical summary.

Do not use “70% Windows memory” as a leak verdict. Calculate repeated-run trends
for RSS/WSL, available memory, post-run release, and swap growth.

- [ ] **Step 3: Add target Linux/container requirements**

Benchmark evidence distinguishes:

- `local_wsl_diagnostic`;
- `target_linux_cgroup_gate`.

Only the latter can satisfy the production memory gate. Require process
RSS/heap, cgroup/container or host available memory, DB latency, checkpoint
latency, and bounded post-run state.

- [ ] **Step 4: Run checks and commit**

```powershell
npm test -- tests/scripts/captureUnifiedWslMemory.test.ts tests/unified-check/adaptiveBenchmarkEvidence.test.ts
npm run typecheck
git add scripts/captureUnifiedWslMemory.ps1 tests/scripts/captureUnifiedWslMemory.test.ts scripts/runUnifiedAdaptiveBenchmark.ts src/unifiedCheck/adaptiveBenchmarkEvidence.ts
git commit -m "feat(unified): capture bounded memory benchmark evidence"
```

Expected: PASS; WSL evidence cannot masquerade as target-Linux capacity proof.

### Task 6: Add fail-closed rollout evidence and hot fallback

**Files:**
- Modify: `scripts/runUnifiedWalletCanary.ts`
- Create: `tests/unified-check/rolloutPolicy.test.ts`
- Create: `tests/runtime/runtimeVersion036.test.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write RED release-gate tests**

Reject promotion when any required item is absent or mismatched:

- schema 034 structural/checksum gate;
- exact frozen barrier/rolling replay equality;
- transactional restart/retry gate;
- logical capacities through 100;
- live capacity 1;
- live capacity 4 only when four independent groups are audited;
- three named wallets in isolated mode;
- zero isolated Telegram sends;
- target Linux/container memory gate;
- tested rolling→barrier hot fallback.

If four independent groups are not auditable, the receipt must clearly leave
capacity 4 unverified and block promotion above capacity 1; it must not invent
evidence.

- [ ] **Step 2: Implement staged policy selection**

Support these explicit runtime stages:

1. global barrier;
2. rolling only for synthetic/isolated canary;
3. rolling for a bounded set of new `user_check` runs;
4. rolling default for new runs.

Existing pre-034 runs stay on their generation. Changing rolling to barrier
stops new rolling admission, de-admits unleased tail, lets leased chunks finish,
then admits head-only through the same planner/commit functions.

- [ ] **Step 3: Make binary rollback rules explicit**

The finalizer must state that rollback to a pre-034 binary is not hot:

1. close the generation to new claims;
2. drain or block active rolling runs;
3. stop the new runtime;
4. start the old binary;
5. retain migration 034.

Do not generate destructive down-migration SQL.

- [ ] **Step 4: Run the automated rollout gate**

```powershell
npm test -- tests/unified-check/rolloutPolicy.test.ts tests/runtime/runtimeVersion036.test.ts
npm run typecheck
```

Expected: PASS on fixtures; intentionally incomplete evidence is rejected.

- [ ] **Step 5: Run replay and live canaries**

First run the frozen replay command from Task 4. Then run isolated live capacity
1. Run capacity 4 only after the independent-group audit passes. Capture local
WSL diagnostics during repeated local runs, then repeat performance/memory
scenarios under the target Linux/container limit.

Expected acceptance:

- closure and internal hashes are self-consistent;
- rolling exactly matches oracle on frozen replay;
- rolling reduces wall time or increases throughput relative to frozen barrier;
- memory/DB usage stays bounded;
- every idle slot has an emitted limiting reason;
- all three named wallets finish with score, decision, closure, evidence, and
  hashes;
- isolated external Telegram sends equal zero.

Ten minutes is recorded as a comparison point, never a timeout or ceiling.

- [ ] **Step 6: Promote one stage at a time**

After each stage, inspect errors/429, DB/checkpoint latency, RSS/available
memory, buffer, canonical-head age, repair wait, and fallback readiness. Save a
signed/canonical receipt before advancing. Stop and use barrier fallback on a
correctness mismatch, unbounded resource trend, or unexplained idle capacity.

- [ ] **Step 7: Commit release wiring**

```powershell
git add scripts/runUnifiedWalletCanary.ts tests/unified-check/rolloutPolicy.test.ts tests/runtime/runtimeVersion036.test.ts src/config.ts src/index.ts
git commit -m "feat(unified): configure adaptive rolling runtime"
```

### Task 7: Final verification and knowledge handoff

**Files:**
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/07-admin-operations.md`
- Modify: `docs/knowledge/08-testing-and-validation.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/12-runbooks.md`
- Modify: `docs/knowledge/13-agent-observations.md`

- [ ] **Step 1: Run the full automated gate**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Validate documentation against code**

Document:

- ordered task eligibility by any capable healthy group, with no pre-binding;
- schema 034 planner/admission/acceptance/commit lifecycle;
- owner→run fairness and repair reserve;
- provider versus analysis/finalization capacity;
- reason codes, Admin snapshot, and no ETA;
- replay/live distinction and verified capacity ceiling;
- WSL diagnostic versus target-Linux proof;
- staged rolling rollout and barrier/binary fallback;
- order-independent merge remains deferred until measured head-of-line loss.

Move any resolved fixed-four-slot issue out of open problems. Keep real
unverified scale and measured bottlenecks open.

- [ ] **Step 3: Re-run doc-sensitive checks**

```powershell
npm test -- tests/unified-check/rolloutPolicy.test.ts tests/unified-check/rollingOracleEquivalence.postgres.test.ts
git diff --check
git status --short
```

Expected: PASS; status contains only intended docs/code and explicitly ignored
local evidence.

- [ ] **Step 4: Commit**

```powershell
git add docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/07-admin-operations.md docs/knowledge/08-testing-and-validation.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md docs/knowledge/13-agent-observations.md
git commit -m "docs: record adaptive rolling operations"
```

## Plan 3 completion gate

The work is complete only when:

- migration 033 is byte-identical and schema 034 is fail-closed;
- frozen replay produces exact barrier/rolling equality at every logical
  capacity;
- live evidence reports only capacity actually audited and exercised;
- the three named wallets complete in isolated mode without Telegram delivery;
- local WSL diagnostics show repeated-run trends and target Linux/container
  evidence satisfies the production memory gate;
- rolling improves wall time or throughput without unbounded memory/DB growth;
- idle capacity has a decision-time limiting reason;
- rolling→barrier fallback passes without a second traversal implementation;
- production promotion receipt is canonical, complete, and accepted.
