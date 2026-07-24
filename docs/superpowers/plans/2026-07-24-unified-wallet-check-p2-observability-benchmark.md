# Unified Wallet Check P2 Observability And Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain Unified progress in Admin and produce a deterministic P0/P1 before-after performance report from frozen TPCP, TFWG, TXc and dense cases.

**Architecture:** Project read-only progress from P0 counters, task rows and delta heads into an Admin-safe model that distinguishes exact discovered work from an expansion lower bound. A separate deterministic benchmark harness replays frozen provider bundles with fixed identity and stores measurements outside canonical analysis hashes. Only measured results inform a later internal SLO proposal.

**Tech Stack:** TypeScript, PostgreSQL, existing Admin server/console, Vitest, canonical JSON artifacts, Node.js CLI scripts.

**Prerequisites:** P0 completed; P1 completed or explicitly recorded as waiting for adjudication. P2 must not alter forensic artifacts, lifecycle, score or delivery.

**Design:** `docs/superpowers/specs/2026-07-24-unified-wallet-check-traversal-performance-design.md`

---

## File map

- Create `src/unifiedCheck/progressProjection.ts`: pure operational progress
  model and validation.
- Modify `src/unifiedCheck/repository.ts`: load task/delta/provider metrics in
  one bounded Admin query.
- Modify `src/admin/forensicsGraph.ts`: attach Unified progress to Admin graph.
- Modify `src/admin/adminServer.ts`: expose read-only progress in existing
  authorized run endpoint.
- Modify `src/admin/adminConsole.ts`: render slots, rates, reuse, frontier,
  checkpoint and no-score reason.
- Create `src/unifiedCheck/performanceBenchmark.ts`: deterministic replay
  contract and measurement comparison.
- Create `scripts/runUnifiedPerformanceBenchmark.ts`: frozen CLI runner.
- Create `tests/fixtures/unified-check/performance/*`: frozen manifests and
  provider response bundles for TPCP, TFWG, TXc and synthetic dense cases.
- Add tests under `tests/unified-check`, `tests/admin` and `tests/scripts`.
- Update knowledge pages 03, 04, 08, 09, 10 and 12.

### Task 1: Define the Admin-safe progress projection

**Files:**
- Create: `src/unifiedCheck/progressProjection.ts`
- Create: `tests/unified-check/progressProjection.test.ts`

- [ ] **Step 1: Write RED projection tests**

```typescript
it("separates exact discovered work from an expansion lower bound", () => {
  const progress = projectUnifiedProgress({
    lifecycle: "RUNNING",
    phase: "traversal_fetch",
    provider: {
      configuredSlots: 4,
      activeSlots: 3,
      coolingDownSlots: 1,
      requests: 120,
      measurementWindowMs: 60_000,
      keyGroups: [
        { id: "group-1", requests: 30, inFlight: 1, status: "active" }
      ]
    },
    traversal: {
      discoveredOutstanding: 12,
      frontierExpanding: true,
      frontierCount: 20,
      frontierPeak: 35,
      uniqueAddresses: 48,
      fundingEpisodes: 90
    },
    storage: { checkpointBytes: 8_192, deltaArtifactBytes: 30_000 },
    reuse: { networkFetches: 60, providerCacheHits: 20, manifestReuses: 40 }
  });
  expect(progress.remaining).toEqual({
    discoveredExact: 12,
    totalKnown: false,
    undiscoveredLowerBound: 0
  });
  expect(progress.estimatedPercent).toBeUndefined();
  expect(progress.etaMs).toBeUndefined();
});

it("does not expose provider keys or user-facing timing targets", () => {
  const json = JSON.stringify(projectUnifiedProgress(INPUT));
  expect(json).not.toMatch(/api.?key|2 minutes|10 minutes|slo/i);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/progressProjection.test.ts
```

- [ ] **Step 3: Implement the pure projection**

```typescript
export type UnifiedProgressProjectionV1 = {
  readonly version: "unified-progress-projection-v1";
  readonly lifecycle: "RUNNING" | "WAITING_FOR_PROVIDER" |
    "COMPLETED" | "FAILED_TECHNICAL";
  readonly phase:
    | "direct_history"
    | "traversal_fetch"
    | "traversal_attribution"
    | "provider_wait"
    | "branch_analysis"
    | "finalization"
    | "completed"
    | "failed_technical";
  readonly noScoreReason: string | null;
  readonly provider: {
    readonly configuredSlots: number;
    readonly activeSlots: number;
    readonly idleSlots: number;
    readonly coolingDownSlots: number;
    readonly requestsPerSecond: number;
    readonly keyGroups: readonly {
      readonly id: string;
      readonly requests: number;
      readonly inFlight: number;
      readonly status: "active" | "idle" | "cooldown";
    }[];
  };
  readonly remaining: {
    readonly discoveredExact: number;
    readonly totalKnown: boolean;
    readonly undiscoveredLowerBound: number;
  };
  readonly reuse: {
    readonly networkFetches: number;
    readonly providerCacheHits: number;
    readonly manifestReuses: number;
    readonly replayAvoided: number;
  };
  readonly traversal: {
    readonly frontier: number;
    readonly frontierPeak: number;
    readonly uniqueAddresses: number;
    readonly fundingEpisodes: number;
  };
  readonly storage: {
    readonly checkpointBytes: number;
    readonly deltaArtifactBytes: number;
  };
};
```

Use safe division for request rate. Never synthesize percent complete or ETA
while frontier can expand.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/unified-check/progressProjection.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/progressProjection.ts tests/unified-check/progressProjection.test.ts
git commit -m "feat(admin): define unified progress projection"
```

### Task 2: Load bounded progress data from PostgreSQL

**Files:**
- Modify: `src/unifiedCheck/repository.ts`
- Create: `tests/unified-check/progressProjection.postgres.test.ts`

- [ ] **Step 1: Write RED PostgreSQL tests**

Create a run with:

- four address-history tasks in mixed `LEASED`, `QUEUED`, `WAITING_RETRY`,
  `COMPLETED`;
- V2 coordinator checkpoint and delta head;
- P0 counters;
- two key-group metric rows/samples.

Assert one projection query returns exact discovered outstanding count, current
phase, bytes and no-score reason without loading every historical delta JSON.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/progressProjection.postgres.test.ts
```

- [ ] **Step 3: Add a bounded repository reader**

```typescript
export async function loadUnifiedProgressProjection(
  db: UnifiedQueryable,
  input: { runId: string; now: Date }
): Promise<UnifiedProgressProjectionV1> {
  const rows = await db.query(PROJECTION_SQL, [
    input.runId,
    input.now.toISOString()
  ]);
  return projectUnifiedProgress(mapProjectionRows(rows.rows));
}
```

The SQL aggregates task statuses and `pg_column_size(checkpoint_json)`. It reads
only coordinator chain heads and current metric summaries, not the full delta
chain. Provider group IDs are stable opaque IDs, never API key values.

- [ ] **Step 4: Verify GREEN and query bound**

```powershell
npm test -- tests/unified-check/progressProjection.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts
```

Assert the test fixture records a bounded query count.

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/repository.ts tests/unified-check/progressProjection.postgres.test.ts
git commit -m "feat(admin): load unified provider and traversal progress"
```

### Task 3: Expose progress through the existing authorized Admin endpoint

**Files:**
- Modify: `src/admin/adminServer.ts`
- Modify: `src/admin/forensicsGraph.ts`
- Modify: `tests/admin/adminServer.test.ts`
- Modify: `tests/admin/forensicsGraph.test.ts`

- [ ] **Step 1: Write RED endpoint and graph tests**

Assert:

- unauthorized request remains rejected;
- authorized run details include `unifiedProgress`;
- graph summary shows current phase and why score is absent;
- failed technical remains operational failure, not REVIEW;
- serialization contains no key material or internal SLO.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts
```

- [ ] **Step 3: Attach the projection**

Extend the existing run/snapshot dependency, not a new unauthenticated route:

```typescript
type UnifiedRunAdminDetails = {
  runId: string;
  subjectAddress: string;
  lifecycle: "RUNNING" | "WAITING_FOR_PROVIDER" |
    "COMPLETED" | "FAILED_TECHNICAL";
  unifiedProgress?: UnifiedProgressProjectionV1 | null;
};
```

In `forensicsGraph`, map phase to an operational layer and keep it outside
scoring evidence. `noScoreReason` is:

```text
Analysis is still in traversal_fetch; final score is created only after all
required evidence children complete.
```

Do not render this sentence in Telegram.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminAuth.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/admin/adminServer.ts src/admin/forensicsGraph.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "feat(admin): expose unified check progress"
```

### Task 4: Render concise operational progress in Admin

**Files:**
- Modify: `src/admin/adminConsole.ts`
- Modify: `tests/admin/adminConsole.test.ts`
- Modify: `tests/admin/adminConsole.regression-1.test.ts`

- [ ] **Step 1: Write RED rendering tests**

Expected visible sections:

```text
Phase: Traversal — fetching address histories
Provider slots: 3/4 active, 1 cooling down
Requests: 2.0/sec
Network / provider cache / manifest reuse: 60 / 20 / 40
Frontier: 20 current, 35 peak
Address histories: 12 discovered and outstanding; total still expanding
Checkpoint: 8 KB; delta artifacts: 29.3 KB
Final score: waiting for required evidence children
```

Assert absence of:

```text
2 minutes
10 minutes
% complete
ETA
partial score
incomplete data
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminConsole.regression-1.test.ts
```

- [ ] **Step 3: Add one progress card**

Reuse existing Admin typography/components. Do not create a dashboard framework.
Render exact discovered work; when `totalKnown=false`, append “total still
expanding” instead of a denominator or progress bar.

- [ ] **Step 4: Verify GREEN and accessibility copy**

```powershell
npm test -- tests/admin/adminConsole.test.ts tests/admin/adminConsole.regression-1.test.ts tests/admin/adminStaticSnapshot.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/admin/adminConsole.ts tests/admin/adminConsole.test.ts tests/admin/adminConsole.regression-1.test.ts
git commit -m "feat(admin): render unified traversal progress"
```

### Task 5: Build deterministic frozen provider bundles

**Files:**
- Create: `src/unifiedCheck/performanceBenchmark.ts`
- Create: `tests/unified-check/performanceBenchmark.test.ts`
- Create: `tests/fixtures/unified-check/performance/catalog.json`
- Create: `tests/fixtures/unified-check/performance/<case-id>/manifest.json`
- Create: `tests/fixtures/unified-check/performance/<case-id>/provider-pages.json`

- [ ] **Step 1: Write RED fixture validation tests**

Require these cases:

```text
tpcp
tfwg
txc
synthetic-dense-wallet
synthetic-500-pages
synthetic-restart
synthetic-duplicates
synthetic-reorder
```

Validate fixed run ID, clock, snapshot, response order/hash, label dataset,
policy versions, locale, ID seed and provider configuration. Reject a bundle
containing API keys or a mutable live URL.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/performanceBenchmark.test.ts
```

- [ ] **Step 3: Implement fixture validator**

```typescript
export type FrozenUnifiedProviderBundleV1 = {
  readonly version: "unified-frozen-provider-bundle-v1";
  readonly benchmarkManifest: UnifiedPerformanceBenchmarkManifestV1;
  readonly pages: readonly {
    readonly requestIdentitySha256: string;
    readonly responseSha256: string;
    readonly response: unknown;
  }[];
  readonly labelsSha256: string;
  readonly bundleSha256: string;
};
```

Provider lookup consumes pages strictly by request identity, not array timing.
Missing/extra requests fail the replay. TPCP/TFWG/TXc bundles come from saved
diagnostic provider pages plus deterministic completion capture; live capture
is a one-time input preparation step and never the benchmark itself.

- [ ] **Step 4: Validate every fixture twice**

```powershell
npm test -- tests/unified-check/performanceBenchmark.test.ts
```

The second load must produce identical bundle and semantic identity hashes.

- [ ] **Step 5: Commit frozen bundles**

```powershell
git add src/unifiedCheck/performanceBenchmark.ts tests/unified-check/performanceBenchmark.test.ts tests/fixtures/unified-check/performance
git commit -m "test(unified-check): freeze dense provider benchmarks"
```

### Task 6: Implement the before/after benchmark runner

**Files:**
- Create: `scripts/runUnifiedPerformanceBenchmark.ts`
- Create: `tests/scripts/runUnifiedPerformanceBenchmark.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write RED CLI tests**

Test:

- `--variant baseline|p0|p1`;
- one or all case IDs;
- deterministic semantic result hash;
- measurement envelope contains duration/machine/runtime metadata;
- process exits non-zero for semantic mismatch, missing request or unfinished
  lifecycle;
- runner has no elapsed-time cancellation path.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/scripts/runUnifiedPerformanceBenchmark.test.ts
```

- [ ] **Step 3: Implement the runner**

Add:

```json
"unified:performance:benchmark": "node --import tsx scripts/runUnifiedPerformanceBenchmark.ts"
```

Runner creates an isolated PostgreSQL schema, fixed clock and deterministic IDs,
feeds the frozen provider, drains work until `COMPLETED` or
`FAILED_TECHNICAL`, and emits:

```typescript
type UnifiedBenchmarkResultV1 = {
  identity: {
    semanticIdentitySha256: string;
    executionIdentitySha256: string;
  };
  lifecycle: string;
  canonical: {
    inventorySha256: string;
    closureSha256: string;
    scoreAnchorSha256: string;
    reportSha256: string;
    presentationSha256: string;
  };
  measurements: {
    wallMs: number;
    providerActiveMs: number;
    providerRequests: number;
    requestsPerSecond: number;
    maxInFlight: number;
    keyGroupRequests: Record<string, number>;
    providerCacheHits: number;
    manifestReuses: number;
    replayAvoided: number;
    taskClaims: number;
    checkpoints: number;
    maxCheckpointBytes: number;
    dbWrites: number;
    taskTableBytes: number;
    taskToastBytes: number;
    frontierPeak: number;
  };
};
```

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/scripts/runUnifiedPerformanceBenchmark.test.ts tests/unified-check/performanceBenchmark.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add scripts/runUnifiedPerformanceBenchmark.ts tests/scripts/runUnifiedPerformanceBenchmark.test.ts package.json
git commit -m "feat(unified-check): add deterministic performance replay"
```

### Task 7: Produce final comparison and evidence-based SLO proposal

**Files:**
- Create: `docs/audit/2026-07-system-audit/unified-performance/final-comparison.json`
- Create: `docs/audit/2026-07-system-audit/unified-performance/final-report.md`
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/12-runbooks.md`

- [ ] **Step 1: Run targeted P2 verification**

```powershell
npm run typecheck
npm test -- tests/unified-check/progressProjection.test.ts tests/unified-check/progressProjection.postgres.test.ts tests/unified-check/performanceBenchmark.test.ts tests/scripts/runUnifiedPerformanceBenchmark.test.ts tests/admin/adminServer.test.ts tests/admin/forensicsGraph.test.ts tests/admin/adminConsole.test.ts
```

- [ ] **Step 2: Run the frozen matrix once**

```powershell
npm run unified:performance:benchmark -- --variant baseline --all --output .codex-live/perf-baseline.json
npm run unified:performance:benchmark -- --variant p0 --all --output .codex-live/perf-p0.json
npm run unified:performance:benchmark -- --variant p1 --all --output .codex-live/perf-p1.json
```

Do not rerun unchanged failures. Preserve logs and turn a repeated identical
failure into a concrete blocker.

- [ ] **Step 3: Verify semantic and lifecycle contracts**

For P0, all canonical hashes must match baseline. For P1, hashes must match the
adjudicated Golden expectations. Every successful case must be `COMPLETED` with
one score and one presentation; technical fixture failures must be
`FAILED_TECHNICAL` without score.

- [ ] **Step 4: Add the concurrency fairness measurement**

Run:

```text
dense interactive run
+ two later small interactive runs
```

Record first-progress and completion ordering. Prove dense can reach four slots
when alone and cannot starve other interactive runs under contention.

- [ ] **Step 5: Write the comparison**

For every case include:

- wall/provider time;
- requests and rate;
- max/average in-flight and key-group distribution;
- cache/manifest reuse/replay avoided;
- task claims/checkpoints/DB updates;
- checkpoint/table/TOAST bytes;
- frontier peak and boundary reductions;
- canonical hashes.

The Markdown report distinguishes measured facts from inference.

- [ ] **Step 6: Propose, do not enforce, internal SLOs**

Derive operational targets from observed distributions. State explicitly:

```text
These values are internal alerting/capacity-planning proposals. They are not
user timeouts, completion gates, coverage thresholds or publication rules.
```

Do not change runtime config or release gates in this task.

- [ ] **Step 7: Update knowledge and runbook**

Document Admin progress semantics, benchmark command, frozen identity and any
remaining measured bottleneck. Do not describe the candidate as production
deployed without actual rollout evidence.

- [ ] **Step 8: Commit the P2 milestone**

```powershell
git add src scripts tests package.json docs/knowledge docs/audit/2026-07-system-audit/unified-performance
git commit -m "feat(admin): complete unified progress and performance evidence"
```

## P2 stop conditions

Stop and report the exact blocker if:

- TPCP/TFWG/TXc provider pages cannot be frozen without missing request
  identities;
- Admin projection requires replaying the entire delta chain per page load;
- benchmark uses real time/random IDs inside canonical hashes;
- progress UI implies percent complete or ETA while frontier expands;
- instrumentation changes analysis, score, report or delivery hashes.

Do not compensate by adding a timeout, partial score or user-visible SLO.
