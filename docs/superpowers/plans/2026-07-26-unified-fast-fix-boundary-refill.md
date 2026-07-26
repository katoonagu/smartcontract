# Unified Fast Fix Boundary And Refill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce dense-wallet provider work with evidence-backed custodial boundaries and recover stale provider-slot assignments without waiting for reconciliation.

**Architecture:** Persist a versioned traversal policy in the existing immutable analysis manifest, keep v1 behavior for existing runs, and evaluate v2 boundaries only from the pinned frozen label dataset in the ordered traversal coordinator. Preserve the controller as the sole allocator, make provider-pool assignment acceptance explicit, and schedule one fresh coalesced controller cycle after a stale slot epoch. Store refill benchmark evidence in a new versioned artifact instead of changing existing V1 evidence shapes.

**Tech Stack:** TypeScript, Node.js, PostgreSQL, Vitest, existing Unified planner/controller/provider-pool infrastructure, canonical JSON/SHA-256 artifacts.

---

## Scope And File Map

This is one connected fast fix. The boundary and refill changes share the same
frozen replay, isolated live canary, and release decision, so splitting them
would duplicate the correctness gate.

### New files

- `src/unifiedCheck/productionBoundary.ts`: pure v2 boundary authorization and
  immutable boundary-evidence construction.
- `src/unifiedCheck/providerRefillDiagnostics.ts`: bounded, best-effort refill
  timing and assignment aggregates.
- `tests/unified-check/productionBoundary.test.ts`: boundary authorization and
  proof binding.
- `tests/unified-check/providerRefillDiagnostics.test.ts`: diagnostic sampler
  bounds and percentiles.
- `tests/fixtures/unified-wallet/adaptive-rolling-provider-replay-v2.json`:
  frozen v2 replay identity and provider responses; the v1 fixture remains
  byte-for-byte unchanged.

### Modified production files

- `src/config.ts`: startup default for new-run traversal policy.
- `.env.example`: document the startup selector.
- `src/unifiedCheck/contracts.ts`: traversal-policy union.
- `src/unifiedCheck/requestService.ts`: bind traversal policy into analysis
  identity, branch identity, and manifest.
- `src/unifiedCheck/repository.ts`: accept either persisted policy in canary
  batch identities without rewriting historical v1 batches.
- `src/unifiedCheck/canary.ts`: bind the selected traversal policy into canary
  identity.
- `src/unifiedCheck/frozenLabels.ts`: validate persisted frozen datasets before
  v2 use.
- `src/unifiedCheck/productionTraversal.ts`: add the v2 terminal-evidence shape
  without changing v1 artifacts.
- `src/unifiedCheck/productionTraversalCoordinator.ts`: state-scoped v1/v2
  boundary application before history discovery.
- `src/unifiedCheck/productionRuntime.ts`: load frozen boundary evidence and
  report actual provider task claims.
- `src/unifiedCheck/providerPool.ts`: return accepted and rejected permit
  assignments with stable rejection causes.
- `src/unifiedCheck/adaptiveRuntime.ts`: count accepted assignments only and
  request a fresh controller wake after stale epoch.
- `src/unifiedCheck/adaptiveObservability.ts`: add only the stable
  `checkpoint_or_commit` reason code.
- `src/index.ts`: wire policy, frozen dataset loading, refill diagnostics, and
  coalesced controller retry.
- `src/unifiedCheck/adaptiveBenchmarkRunner.ts`: honor structured assignment
  results in deterministic simulation.
- `src/unifiedCheck/adaptiveBenchmarkControl.ts`: persist and load the new
  refill observation as a separate artifact type.
- `scripts/runUnifiedAdaptiveBenchmark.ts`: select exactly one live scenario
  and policy, export refill acceptance evidence, and orchestrate the three
  required memory samples.
- `scripts/runUnifiedWalletCanary.ts`: pass the canary traversal policy and
  collect refill artifacts.

### Modified tests and docs

- `tests/config/config.test.ts`
- `tests/unified-check/requestService.test.ts`
- `tests/unified-check/canary.test.ts`
- `tests/unified-check/canary.postgres.test.ts`
- `tests/unified-check/comparator.test.ts`
- `tests/unified-check/frozenLabels.test.ts`
- `tests/unified-check/productionTraversalCoordinator.test.ts`
- `tests/unified-check/plannerRestart.postgres.test.ts`
- `tests/unified-check/plannerReplay.property.test.ts`
- `tests/unified-check/rollingOracleEquivalence.postgres.test.ts`
- `tests/unified-check/providerPool.test.ts`
- `tests/unified-check/adaptiveRuntime.test.ts`
- `tests/unified-check/providerScaleSimulation.test.ts`
- `tests/unified-check/adaptiveBenchmarkControl.test.ts`
- `tests/scripts/runUnifiedAdaptiveBenchmark.test.ts`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/12-runbooks.md`
- `docs/knowledge/13-agent-observations.md`

Migration files are not touched. Schema verification must remain exactly 036.

## Implementation Batch A: Versioned Evidence Boundary

### Task 1: Persist Traversal Policy In Every Analysis Identity

**Files:**
- Modify: `src/unifiedCheck/contracts.ts:113-134`
- Modify: `src/config.ts:20-95,185-210,420-555`
- Modify: `.env.example`
- Modify: `src/unifiedCheck/requestService.ts:428-660`
- Modify: `src/unifiedCheck/repository.ts:810-855`
- Modify: `src/unifiedCheck/canary.ts:340-360,578-780`
- Modify: `src/index.ts:2280-2335`
- Modify: `scripts/runUnifiedAdaptiveBenchmark.ts:2370-2430`
- Test: `tests/config/config.test.ts`
- Test: `tests/unified-check/requestService.test.ts`
- Test: `tests/unified-check/canary.test.ts`
- Test: `tests/unified-check/canary.postgres.test.ts`
- Test: `tests/unified-check/comparator.test.ts`
- Test: `tests/scripts/runUnifiedAdaptiveBenchmark.test.ts`

- [ ] **Step 1: Write failing config and identity tests**

Add assertions that the default remains v1, v2 is accepted, any other value
fails closed, and v1/v2 cannot reuse one analysis identity:

```ts
expect(loadConfig().unifiedTraversalPolicyVersion)
  .toBe("snapshot-closure-v1");

process.env.UNIFIED_TRAVERSAL_POLICY_VERSION = "snapshot-closure-v2";
expect(loadConfig().unifiedTraversalPolicyVersion)
  .toBe("snapshot-closure-v2");

process.env.UNIFIED_TRAVERSAL_POLICY_VERSION = "latest";
expect(() => loadConfig()).toThrow(
  "UNIFIED_TRAVERSAL_POLICY_VERSION must be snapshot-closure-v1 or snapshot-closure-v2"
);

expect(buildUnifiedAnalysisIdentity({
  ...identityInput,
  versions: { ...versions, traversalPolicyVersion: "snapshot-closure-v1" }
}).analysisKeySha256).not.toBe(buildUnifiedAnalysisIdentity({
  ...identityInput,
  versions: { ...versions, traversalPolicyVersion: "snapshot-closure-v2" }
}).analysisKeySha256);
```

In the canary test, require the batch identity and candidate run manifest to
carry the explicitly requested version rather than a hard-coded v1.

Add a revival/runtime test for a v2 manifest missing either
`labelCatalogVersion` or `boundaryPredicateVersion`; it must fail with
`unified_v2_boundary_versions_missing`. Preserve the existing compatibility
test that permits those absent fields only on historical v1 manifests.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd test -- tests/config/config.test.ts tests/unified-check/requestService.test.ts tests/unified-check/canary.test.ts tests/unified-check/canary.postgres.test.ts tests/unified-check/comparator.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
```

Expected: FAIL because the config property and `UnifiedAnalysisVersions`
member do not exist and canary identity is fixed to v1.

- [ ] **Step 3: Add the exact version types and parser**

In `contracts.ts`:

```ts
export type UnifiedTraversalPolicyVersion =
  | "snapshot-closure-v1"
  | "snapshot-closure-v2";

export type AnalysisManifestV1 = {
  // Existing fields stay byte-for-byte compatible.
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
};
```

Keep all existing manifest fields; only replace the literal type with the
union.

In `config.ts`, add:

```ts
function parseUnifiedTraversalPolicyVersion(
  rawValue: string
): AppConfig["unifiedTraversalPolicyVersion"] {
  if (
    rawValue === "snapshot-closure-v1" ||
    rawValue === "snapshot-closure-v2"
  ) return rawValue;
  throw new Error(
    "UNIFIED_TRAVERSAL_POLICY_VERSION must be " +
    "snapshot-closure-v1 or snapshot-closure-v2"
  );
}
```

Add `unifiedTraversalPolicyVersion` to `AppConfig` and default the environment
variable to `snapshot-closure-v1`.

- [ ] **Step 4: Bind policy into request and canary identities**

Add the member to `UnifiedAnalysisVersions`:

```ts
readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
```

Include it in `buildUnifiedBranchInput()`, `buildUnifiedAnalysisIdentity()`'s
shared material, `AnalysisManifestV1`, and `UnifiedCanaryBatchIdentityV1`.
Pass `config.unifiedTraversalPolicyVersion` from `src/index.ts` and
`scripts/runUnifiedWalletCanary.ts`.

Widen the PostgreSQL repository's canary batch input to the same union and
assert that its stored batch identity retains v2. Replace the benchmark live
performance manifest's hard-coded `analysisPolicyVersion` with the policy from
the completed canary outcome. Keep `replayCandidate()` in `comparator.ts`
unchanged and explicitly on v1 because the locked golden corpus is historical
v1; add a test that makes that deliberate exclusion visible.

At the manifest trust boundary, require
`UNIFIED_LABEL_CATALOG_VERSION` and `UNIFIED_BOUNDARY_PREDICATE_VERSION` when
`traversalPolicyVersion` is v2. Keep their current optional compatibility only
for loading older v1 manifests; do not make the fields optional for newly
created v1 or v2 manifests.

The isolated canary preparation input may override the process default only by
passing a complete `UnifiedAnalysisVersions` value. It must not mutate global
configuration.

- [ ] **Step 5: Document the selector**

Add to `.env.example`:

```dotenv
# New runs only; existing runs resume the version in their immutable manifest.
UNIFIED_TRAVERSAL_POLICY_VERSION=snapshot-closure-v1
```

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
npm.cmd test -- tests/config/config.test.ts tests/unified-check/requestService.test.ts tests/unified-check/canary.test.ts tests/unified-check/canary.postgres.test.ts tests/unified-check/comparator.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
npm.cmd run typecheck
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```powershell
git add .env.example src/config.ts src/index.ts src/unifiedCheck/contracts.ts src/unifiedCheck/requestService.ts src/unifiedCheck/repository.ts src/unifiedCheck/canary.ts scripts/runUnifiedWalletCanary.ts scripts/runUnifiedAdaptiveBenchmark.ts tests/config/config.test.ts tests/unified-check/requestService.test.ts tests/unified-check/canary.test.ts tests/unified-check/canary.postgres.test.ts tests/unified-check/comparator.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
git commit -m "feat(unified): version traversal closure policy"
```

### Task 2: Build A Fail-closed V2 Custodial Boundary

**Files:**
- Create: `src/unifiedCheck/productionBoundary.ts`
- Create: `tests/unified-check/productionBoundary.test.ts`
- Modify: `src/unifiedCheck/frozenLabels.ts`
- Modify: `src/unifiedCheck/productionTraversal.ts:183-245`
- Test: `tests/unified-check/frozenLabels.test.ts`

- [ ] **Step 1: Write failing frozen-dataset validation tests**

Add tests that accept the exact dataset and reject a wrong artifact hash,
snapshot, catalog version, predicate version, or malformed frozen record:

```ts
expect(validateFrozenLabelDatasetV1({
  value: result.dataset,
  expectedSha256: result.sha256,
  expectedSnapshotHash: SNAPSHOT_SHA256
})).toEqual(result.dataset);

expect(() => validateFrozenLabelDatasetV1({
  value: result.dataset,
  expectedSha256: "f".repeat(64),
  expectedSnapshotHash: SNAPSHOT_SHA256
})).toThrow("unified_frozen_label_dataset_hash_mismatch");
```

- [ ] **Step 2: Write failing v2 authorization tests**

Use the real valid TRON fixtures `TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP`
and `TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy`. Cover:

```ts
expect(evaluateProductionBoundaryV2({
  state: STATE,
  labels: [verifiedBybit],
  snapshotHash: SNAPSHOT_SHA256,
  labelDatasetSha256: DATASET_SHA256
})).toMatchObject({
  terminal: true,
  reason: "identified_service_boundary"
});

for (const labels of [
  [hintBybit],
  [verifiedAllbridge],
  [laterValidHtx],
  []
]) {
  expect(evaluateProductionBoundaryV2({
    state: STATE,
    labels,
    snapshotHash: SNAPSHOT_SHA256,
    labelDatasetSha256: DATASET_SHA256
  })).toMatchObject({ terminal: false });
}
```

Do not model `legacyRiskContext` as a `FrozenLabelRecordV1`. Add a separate
coordinator test that supplies the risk label through the existing
`loadCounterpartyLabels()` input, returns no matching frozen record, and
asserts that v2 continues traversal. This proves legacy presentation context
cannot reach or authorize the v2 evaluator.

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
npm.cmd test -- tests/unified-check/frozenLabels.test.ts tests/unified-check/productionBoundary.test.ts
```

Expected: FAIL because the validator and production v2 evaluator do not exist.

- [ ] **Step 4: Implement persisted dataset validation**

Export from `frozenLabels.ts`:

```ts
export function validateFrozenLabelDatasetV1(input: {
  readonly value: unknown;
  readonly expectedSha256: string;
  readonly expectedSnapshotHash: string;
}): FrozenLabelDatasetV1 {
  const value = input.value as FrozenLabelDatasetV1;
  if (
    value?.version !== "unified-frozen-label-dataset-v1" ||
    value.schemaVersion !== 1 ||
    value.catalogVersion !== "unified-label-catalog-v1" ||
    value.boundaryPredicateVersion !== "unified-boundary-predicates-v1" ||
    value.snapshotHash !== input.expectedSnapshotHash
  ) throw new Error("unified_frozen_label_dataset_binding_mismatch");
  const rebuilt = buildFrozenLabelDataset({
    frozenAt: value.frozenAt,
    snapshotHash: value.snapshotHash,
    labels: value.labels,
    legacyRows: value.legacyRows
  });
  if (rebuilt.sha256 !== input.expectedSha256) {
    throw new Error("unified_frozen_label_dataset_hash_mismatch");
  }
  return rebuilt.dataset;
}
```

The implementation must retain the existing field validators used by
`buildFrozenLabelDataset()`; it must not trust the cast.

- [ ] **Step 5: Implement the pure production v2 filter and proof**

In `productionBoundary.ts`, expose one result union:

```ts
export type ProductionBoundaryDecisionV2 =
  | {
      readonly terminal: true;
      readonly reason: "identified_service_boundary";
      readonly evidence: UnifiedTraversalBoundaryEvidenceV2;
    }
  | { readonly terminal: false };
```

Call `evaluateBoundaryV1()` with `restriction`, `economicRole`, and
`structuralProof` set to `null`, and route flags set to false. Locate the
returned catalog entry and accept it only when its terminal policy is exactly
`custodial_boundary` and the returned reason is exactly
`identified_service_boundary`.

Define a new evidence discriminator instead of mutating v1:

```ts
export type UnifiedTraversalBoundaryEvidenceV2 = {
  readonly version: "unified-traversal-boundary-evidence-v2";
  readonly schemaVersion: 2;
  readonly traversalPolicyVersion: "snapshot-closure-v2";
  readonly predicateVersion: "unified-boundary-predicates-v1";
  readonly stateId: string;
  readonly eventTimestamp: string;
  readonly reason: "identified_service_boundary";
  readonly snapshotHash: string;
  readonly labelDatasetSha256: string;
  readonly catalogEntryId: string;
  readonly terminalPolicy: "custodial_boundary";
  readonly authority: string;
  readonly sourcePayloadSha256: string;
};
```

- [ ] **Step 6: Run focused tests and typecheck**

```powershell
npm.cmd test -- tests/unified-check/frozenLabels.test.ts tests/unified-check/boundaryPredicates.test.ts tests/unified-check/productionBoundary.test.ts
npm.cmd run typecheck
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```powershell
git add src/unifiedCheck/frozenLabels.ts src/unifiedCheck/productionBoundary.ts src/unifiedCheck/productionTraversal.ts tests/unified-check/frozenLabels.test.ts tests/unified-check/productionBoundary.test.ts
git commit -m "feat(unified): authorize frozen custodial boundaries"
```

### Task 3: Apply V2 Boundaries Before Durable History Planning

**Files:**
- Modify: `src/unifiedCheck/productionTraversalCoordinator.ts:1-930`
- Modify: `src/unifiedCheck/productionRuntime.ts:271-625`
- Modify: `src/index.ts:500-770`
- Test: `tests/unified-check/productionTraversalCoordinator.test.ts`
- Test: `tests/unified-check/plannerRestart.postgres.test.ts`
- Test: `tests/unified-check/plannerReplay.property.test.ts`

- [ ] **Step 1: Write failing coordinator partition tests**

Add a v2 fixture with two states for the same address: one inside an HTX
event-time interval and one outside. Assert that the terminal state is removed
through a boundary delta while the continuing state still creates exactly one
address-history discovery.

Add a second fixture where every state for the CEX address is terminal and
assert:

```ts
expect(result).toMatchObject({
  kind: "checkpoint",
  orderedCommit: { entries: [], discoveredTasks: [] }
});
expect([...persisted.values()]).toContainEqual(
  expect.objectContaining({
    version: "unified-traversal-boundary-evidence-v2",
    reason: "identified_service_boundary"
  })
);
```

Also run the same frontier with v1 and assert the existing legacy outcome is
unchanged.

- [ ] **Step 2: Run coordinator tests and verify RED**

```powershell
npm.cmd test -- tests/unified-check/productionTraversalCoordinator.test.ts
```

Expected: FAIL because the coordinator only loads string labels and evaluates
one address-level legacy boundary.

- [ ] **Step 3: Add the frozen dataset runtime loader**

Extend `createUnifiedProductionRuntime()` with:

```ts
loadFrozenLabelDataset(input: {
  readonly labelDatasetSha256: string;
  readonly snapshotHash: string;
  readonly labelCatalogVersion: string | undefined;
  readonly boundaryPredicateVersion: string | undefined;
}): Promise<FrozenLabelDatasetV1>;
```

In `src/index.ts`, select `dataset_json` by hash, validate it through
`validateFrozenLabelDatasetV1()`, and return the validated artifact. Before
loading or evaluating any v2 boundary, reject missing manifest versions with
`unified_v2_boundary_versions_missing` and reject either value when it differs
from the validated dataset with `unified_v2_boundary_versions_mismatch`. Add
tests for both fields independently; a matching dataset hash alone is not
sufficient authorization. Keep
`loadCounterpartyLabels()` for legacy hard-evidence context; do not let its
`legacyRows` authorize v2 boundaries.

- [ ] **Step 4: Partition and commit terminal states before discovery**

In the coordinator:

1. Load the v2 dataset only when the manifest selects v2.
2. Index frozen records by exact address.
3. Evaluate frontier states in canonical order.
4. Build terminal-state candidates without persistence. For each candidate,
   count the UTF-8 bytes of the canonical serialization of its boundary
   evidence plus terminal delta entry. Reject a single candidate above
   `manifestMaxBytes`; otherwise append the largest canonical prefix whose
   entry count is at most `commitMaxEntries` and whose cumulative bytes are at
   most `commitMaxBytes`.
5. Return the checkpoint before appending new planner entries.
6. On the next cycle, derive mandatory address histories only from continuing
   states.

If the first candidate cannot fit `commitMaxBytes`, fail with
`unified_v2_boundary_commit_bytes_exceeded` rather than loop without progress.
Add a byte-limited test where only the first of two terminal states commits,
restart, then prove the second state commits exactly once and in canonical
order.

For v1, retain `unifiedTraversalBoundary()` and the current terminal-evidence
shape. Never infer policy from planner presence or process configuration.

- [ ] **Step 5: Add restart and random-order tests**

In `plannerRestart.postgres.test.ts`, stop after the v2 boundary checkpoint,
create a new runtime instance, and prove the boundary is not reopened and no
address-history task is duplicated.

In `plannerReplay.property.test.ts`, include the traversal policy in the seed
case and assert every completion permutation has the same terminal inventory
and delta head for that policy. Continue printing the reproducible seed on
failure.

- [ ] **Step 6: Run the boundary/restart group**

```powershell
npm.cmd test -- tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/plannerReplay.property.test.ts
npm.cmd test -- tests/unified-check/plannerRestart.postgres.test.ts
```

Expected: all selected tests pass. The PostgreSQL test must execute rather than
report skip; `TEST_DATABASE_URL` must point to the disposable schema-036 test
database.

- [ ] **Step 7: Commit**

```powershell
git add src/index.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/productionTraversalCoordinator.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/plannerReplay.property.test.ts
git commit -m "feat(unified): commit v2 boundaries before history planning"
```

## Implementation Batch B: Accepted Assignment Refill

### Task 4: Return Provider Assignment Outcomes And Retry Stale Epochs

**Files:**
- Modify: `src/unifiedCheck/providerPool.ts:20-255`
- Modify: `src/unifiedCheck/adaptiveRuntime.ts:695-1110`
- Modify: `src/unifiedCheck/adaptiveBenchmarkRunner.ts:390-450`
- Modify: `src/index.ts:930-1200`
- Test: `tests/unified-check/providerPool.test.ts`
- Test: `tests/unified-check/adaptiveRuntime.test.ts`
- Test: `tests/unified-check/providerScaleSimulation.test.ts`
- Test: `tests/unified-check/adaptiveBenchmarkRunner.test.ts`

- [ ] **Step 1: Write the failing assignment-result test**

Add to `providerPool.test.ts`:

```ts
const result = pool.assignPermits([
  { slotId: 0, expectedEpoch: staleEpoch, permit },
  { slotId: 1, expectedEpoch: currentEpoch, permit }
]);

expect(result.accepted.map((item) => item.slotId)).toEqual([1]);
expect(result.rejected).toEqual([{
  assignment: expect.objectContaining({ slotId: 0 }),
  reason: "stale_epoch"
}]);
```

Cover `draining`, `slot_active`, and `pending_assignment` separately so the
controller never guesses rejection causes.

- [ ] **Step 2: Write the failing immediate retry test**

In `adaptiveRuntime.test.ts`, use a first assignment callback that returns one
stale rejection and a `requestControllerWake` spy. Assert:

```ts
expect(first.acceptedClaimAssignments).toEqual([]);
expect(first.actionableProviderSlots).toBe(0);
expect(requestControllerWake).toHaveBeenCalledOnce();
```

Run a second cycle with the fresh epoch and assert one accepted assignment,
pool target one, and no second retry request.

- [ ] **Step 3: Run refill tests and verify RED**

```powershell
npm.cmd test -- tests/unified-check/providerPool.test.ts tests/unified-check/adaptiveRuntime.test.ts
```

Expected: FAIL because `assignPermits()` returns an array and the controller
does not expose accepted assignments or a retry wake.

- [ ] **Step 4: Implement the structured pool result**

Define:

```ts
export type UnifiedProviderAssignmentRejectionReason =
  | "draining"
  | "slot_active"
  | "pending_assignment"
  | "stale_epoch";

export type UnifiedProviderAssignmentResult = {
  readonly accepted: readonly UnifiedProviderSlotAssignment[];
  readonly rejected: readonly {
    readonly assignment: UnifiedProviderSlotAssignment;
    readonly reason: UnifiedProviderAssignmentRejectionReason;
  }[];
};
```

Classify each failed guard in `assignPermits()` without changing epoch or task
state.

- [ ] **Step 5: Count only accepted assignments in the controller**

Change the controller callback to return
`UnifiedProviderAssignmentResult`. Add
`acceptedClaimAssignments` and `assignmentResult` to the decision. Compute:

```ts
const assignmentResult = input.assignProviderPermits?.(claimAssignments) ?? {
  accepted: claimAssignments,
  rejected: []
};
const actionableProviderSlots =
  activeProviderSlots.length + assignmentResult.accepted.length;
```

Use `accepted` for assigned-slot run decisions and pool target. When at least
one rejection reason is `stale_epoch`, eligible work is positive, capacity is
positive, and there is no actual blocker, call the optional
`requestControllerWake()` once.

Wire it in `src/index.ts` to the existing coalesced
`wakeUnifiedController()`. The reconciliation implementation remains the
single-flight/pending-bit guard.

- [ ] **Step 6: Update deterministic adapters and scale tests**

Every fake `assignProviderPermits` returns:

```ts
return { accepted: assignments, rejected: [] };
```

Add a logical-capacity-100 scenario with rejected epochs and prove no duplicate
permits, no oversubscription, and eventual work-conserving allocation.

- [ ] **Step 7: Run the refill batch**

```powershell
npm.cmd test -- tests/unified-check/providerPool.test.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/providerScaleSimulation.test.ts tests/unified-check/adaptiveBenchmarkRunner.test.ts
npm.cmd run typecheck
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 8: Commit**

```powershell
git add src/index.ts src/unifiedCheck/providerPool.ts src/unifiedCheck/adaptiveRuntime.ts src/unifiedCheck/adaptiveBenchmarkRunner.ts tests/unified-check/providerPool.test.ts tests/unified-check/adaptiveRuntime.test.ts tests/unified-check/providerScaleSimulation.test.ts tests/unified-check/adaptiveBenchmarkRunner.test.ts
git commit -m "fix(unified): refill slots after stale assignment epochs"
```

### Task 5: Record Bounded Refill Diagnostics Without Mutating V1 Evidence

**Files:**
- Create: `src/unifiedCheck/providerRefillDiagnostics.ts`
- Create: `tests/unified-check/providerRefillDiagnostics.test.ts`
- Modify: `src/unifiedCheck/worker.ts:175-285`
- Modify: `src/unifiedCheck/productionWorker.ts:65-145`
- Modify: `src/unifiedCheck/productionRuntime.ts:271-720`
- Modify: `src/unifiedCheck/providerPool.ts:45-170`
- Modify: `src/unifiedCheck/adaptiveObservability.ts:1-45`
- Modify: `src/index.ts:580-1235`
- Test: `tests/unified-check/worker.test.ts`
- Test: `tests/unified-check/productionWorker.test.ts`
- Test: `tests/unified-check/adaptiveObservability.test.ts`

- [ ] **Step 1: Write failing bounded-sampler tests**

Define a sampler with a fixed maximum of 512 completed handoffs. Test that it:

- counts proposed, accepted, and rejection causes;
- correlates `chunk_finished`, `checkpoint_finished`,
  `controller_decision_finished`, `permit_accepted`, and `task_claimed` by
  slot plus epoch transition;
- emits p50/p95/max for chunk-to-checkpoint, checkpoint-to-controller,
  controller-to-permit, permit-to-claim, and checkpoint-to-claim;
- evicts the oldest incomplete correlation when bounded;
- ignores invalid clocks without throwing into correctness code.

Expected snapshot:

```ts
expect(diagnostics.snapshot()).toEqual({
  version: "unified-provider-refill-diagnostics-v1",
  assignments: {
    proposed: 2,
    accepted: 1,
    rejected: {
      draining: 0,
      slotActive: 0,
      pendingAssignment: 0,
      staleEpoch: 1
    }
  },
  checkpointToClaim: {
    sampleCount: 1,
    p50Ms: 8,
    p95Ms: 8,
    maxMs: 8
  }
});
```

- [ ] **Step 2: Run sampler tests and verify RED**

```powershell
npm.cmd test -- tests/unified-check/providerRefillDiagnostics.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the bounded sampler**

Use `performance.now()` values supplied by callers. Keep only aggregate
counters plus at most 512 correlation records and 512 completed durations.
Percentiles use a sorted copy and nearest-rank selection. No run, owner, task,
address, key, or group identity appears in the exported snapshot.

- [ ] **Step 4: Wire actual claim and checkpoint boundaries**

Add optional best-effort worker callbacks:

```ts
onTaskClaimed?(input: {
  readonly taskId: string;
  readonly runId: string;
}): void;
onHandlerFinished?(input: {
  readonly taskId: string;
  readonly runId: string;
}): void;
onLifecyclePersisted?(input: {
  readonly taskId: string;
  readonly runId: string;
  readonly outcome: "checkpoint" | "completed";
}): void;
```

Call it immediately after the repository returns a task and before executing
the handler. Call `onHandlerFinished` immediately after the handler returns and
before the repository writes checkpoint/acceptance, then call
`onLifecyclePersisted` only after that repository transaction succeeds. In
production, correlate all three callbacks with the active slot identity held
by `AsyncLocalStorage`; never export `taskId` from the sampler.

Add `onAssignmentsEvaluated(result)` to the provider pool and invoke it once
after `assignPermits()` has classified the complete proposal list. Record the
controller-decision timestamp immediately before this call. For a completed
slot epoch `N`, the next accepted assignment must have `expectedEpoch = N+1`
and its claim callback runs under active epoch `N+2`; use that explicit
transition as the correlation key. Any discontinuity closes the incomplete
sample as rejected rather than guessing a duration.

All callback invocations use `try/catch`; a diagnostic failure cannot alter a
checkpoint, permit, lease, or claim.

- [ ] **Step 5: Add the exact new reason code**

Extend `UnifiedReasonCode` with `checkpoint_or_commit`. Add tests proving it is
valid at pool/run/task scope and that `fairness_wait` remains invalid at pool
scope. Emit it only while an actual bounded checkpoint/commit transition is
holding the last otherwise-fillable slot.

- [ ] **Step 6: Run focused diagnostics tests**

```powershell
npm.cmd test -- tests/unified-check/providerRefillDiagnostics.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionWorker.test.ts tests/unified-check/adaptiveObservability.test.ts
npm.cmd run typecheck
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```powershell
git add src/index.ts src/unifiedCheck/providerRefillDiagnostics.ts src/unifiedCheck/worker.ts src/unifiedCheck/productionWorker.ts src/unifiedCheck/productionRuntime.ts src/unifiedCheck/providerPool.ts src/unifiedCheck/adaptiveObservability.ts tests/unified-check/providerRefillDiagnostics.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionWorker.test.ts tests/unified-check/adaptiveObservability.test.ts
git commit -m "feat(unified): measure bounded provider refill latency"
```

## Implementation Batch C: Evidence, Canary, And Rollout

### Task 6: Persist Separate Refill Evidence And Select One Live Scenario

**Files:**
- Modify: `src/unifiedCheck/adaptiveBenchmarkControl.ts:100-210,1660-2300`
- Modify: `scripts/runUnifiedAdaptiveBenchmark.ts:450-550,1540-1920,2280-2505`
- Modify: `scripts/runUnifiedWalletCanary.ts:35-150`
- Test: `tests/unified-check/adaptiveBenchmarkControl.test.ts`
- Test: `tests/scripts/runUnifiedAdaptiveBenchmark.test.ts`

- [ ] **Step 1: Write failing artifact contract tests**

Create a new artifact rather than adding fields to
`UnifiedAdaptiveBenchmarkRuntimeObservationV1`:

```ts
export type UnifiedProviderRefillObservationV1 = {
  readonly version: "unified-provider-refill-observation-v1";
  readonly schemaVersion: 1;
  readonly controlSha256: string;
  readonly observedAt: string;
  readonly runtimeCommit: string;
  readonly providerConfigurationSha256: string;
  readonly diagnostics: UnifiedProviderRefillDiagnosticsSnapshotV1;
  readonly saturated: {
    readonly sampleCount: number;
    readonly activeSlotSum: number;
    readonly fourOfFourSamples: number;
    readonly unexplainedIdleSamples: number;
  };
  readonly memoryEvidence: {
    readonly samplesSha256: string;
    readonly summarySha256: string;
    readonly diagnosticStatus: "captured" | "skipped";
  };
};
```

Test exact-key validation, canonical hashing, wrong control/runtime rejection,
listing by benchmark control, and rejection of missing/incomplete memory
evidence. Existing V1 observation parsers must still accept their historical
bytes unchanged.

- [ ] **Step 2: Write failing `--scenario` CLI tests**

Add one allow-listed scenario option:

```powershell
--scenario isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd
```

Add `--traversal-policy snapshot-closure-v1|snapshot-closure-v2` for both modes
and `--memory-evidence-dir PATH` for live mode. Test that live
mode accepts exactly the registered scenario, rejects an unknown address/name,
rejects memory capture in replay mode, selects the matching built-in v1/v2
fixture in replay mode, and runs only one explicit benchmark binding. The live
canary passes its policy directly to `runUnifiedWalletCanaryCli`; it must not
mutate process-global configuration.

- [ ] **Step 3: Run evidence/CLI tests and verify RED**

```powershell
npm.cmd test -- tests/unified-check/adaptiveBenchmarkControl.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
```

Expected: FAIL because the refill artifact and scenario selector do not exist.

- [ ] **Step 4: Implement the separate artifact writer/reader**

Persist `adaptive_benchmark_refill_observation` artifacts beside, not inside,
existing runtime-observation artifacts. Use the existing benchmark control to
bind allowed run IDs. List them by control hash and validate canonical content
before export.

The live evidence aggregator computes saturated samples only when:

```ts
providerCapacityLimit >= 4 &&
eligibleReadyProviderWork >= 4 &&
runtimeState === "normal" &&
healthyGroupCount >= 4
```

Short checkpoint/commit pauses remain in the denominator. Overall run-average
occupancy is reported but is not the gate.

- [ ] **Step 5: Implement one-scenario live selection**

Store selected scenario IDs in `CliOptions`. In live mode, pass either the one
selected registered scenario or the existing full matrix to
`runExistingIsolatedCanaryBenchmark()`. Do not permit an arbitrary address to
bypass the registered-scenario contract.

Include `traversalPolicyVersion` and the sorted selected scenario IDs in
`benchmarkExecutionIdentity()`. `loadCompletedLiveIndex()` must recompute that
identity before accepting an existing index, so the same output path cannot
resume v1 as v2 or resume a full matrix as the one-scenario canary. Keep the
index V1 byte shape unchanged; its existing `executionIdentitySha256` carries
the stronger binding. Add fail-closed resume tests for both a policy mismatch
and a scenario-set mismatch.

- [ ] **Step 6: Integrate fail-closed three-phase memory capture**

Add a small standard-library-only wrapper around
`scripts/captureUnifiedWslMemory.ps1`. For the one selected run:

1. `onBatchReady` knows the durable run ID; write a runtime snapshot from
   `process.memoryUsage()` and capture `before` before worker execution.
2. The first `onProgress` observation after a provider claim writes a fresh
   snapshot and captures `during` exactly once.
3. After the run completes, but before writing a passing refill observation,
   write a final snapshot and capture `after` with `SummaryPath`.

Use `process.pid`, the registered scenario ID, and the actual durable run ID
for all three calls. Read the finished sample array and summary, require exactly
one `before`, `during`, and `after` with identical identities, then bind the
SHA-256 of both files into `memoryEvidence`. A PowerShell failure, a missing
phase, or invalid JSON fails the live command before it writes a passing index.
`diagnosticStatus=skipped` is recorded on hosts without WSL, but the process
RSS/heap phases remain mandatory.

Dependency-inject the phase runner in CLI tests. Prove call order, exact IDs,
one call per phase, no second live run on capture failure, and that an existing
complete output resumes without recapturing or rerunning.

- [ ] **Step 7: Add acceptance evaluation**

For the selected dense-wallet scenario require:

```ts
const saturatedAverage = activeSlotSum / sampleCount;
if (sampleCount === 0) throw new Error("unified_fast_fix_saturation_missing");
if (saturatedAverage < 3.5) {
  throw new Error("unified_fast_fix_utilization_below_gate");
}
if (unexplainedIdleSamples !== 0) {
  throw new Error("unified_fast_fix_idle_reason_missing");
}
```

Also require all four audited groups in dispatched group IDs, zero delivery
intents, zero 429/provider errors unless the evidence marks provider cooldown
as the actual blocker, and no reconciliation recovery during normal saturated
refill.

- [ ] **Step 8: Run focused evidence tests and typecheck**

```powershell
npm.cmd test -- tests/unified-check/adaptiveBenchmarkControl.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
npm.cmd run typecheck
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 9: Commit**

```powershell
git add src/unifiedCheck/adaptiveBenchmarkControl.ts scripts/runUnifiedAdaptiveBenchmark.ts scripts/runUnifiedWalletCanary.ts tests/unified-check/adaptiveBenchmarkControl.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
git commit -m "feat(unified): gate fast fix with refill evidence"
```

### Task 7: Prove Oracle Equivalence, Update Product Truth, And Run One Canary

**Files:**
- Create: `tests/fixtures/unified-wallet/adaptive-rolling-provider-replay-v2.json`
- Modify: `tests/unified-check/rollingOracleEquivalence.postgres.test.ts`
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/12-runbooks.md`
- Modify: `docs/knowledge/13-agent-observations.md`

- [ ] **Step 1: Extend the PostgreSQL oracle test to both policies**

Create the v2 replay fixture from the same frozen provider responses, clock,
and snapshot as v1, but bind `snapshot-closure-v2`, the real frozen label
dataset hash, and a recomputed replay hash. Never edit the v1 fixture.

Parameterize the PostgreSQL test over the two built-in fixtures and policies.
For v2, seed the exact frozen label dataset artifact before creating the run.
Run each frozen replay twice per policy: barrier and rolling. Assert exact
equality within each policy for frontier, terminal facts, closure, score,
decision, evidence hash, report hash, and restart result. Assert only that v1
and v2 are independently deterministic; do not require cross-policy hash
equality.

Retain immutable receipt output and add separate optional destinations:
`UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V1` and
`UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V2`. Each receipt binds its own replay
hash, barrier facts, capacity rows, and policy-specific fixture.

- [ ] **Step 2: Run correctness-critical PostgreSQL tests**

With `TEST_DATABASE_URL` pointing to the disposable schema-036 database, run:

```powershell
npm.cmd test -- tests/unified-check/rollingOracleEquivalence.postgres.test.ts tests/unified-check/plannerRestart.postgres.test.ts tests/unified-check/orderedCommit.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
```

Expected: every selected test executes and passes; zero skipped PostgreSQL
tests.

- [ ] **Step 3: Run the deterministic replay command**

First create the v2 barrier receipt through the PostgreSQL oracle itself:

```powershell
$env:UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V2 = `
  "artifacts/unified-adaptive/fast-fix-v2-oracle.json"
npm.cmd test -- tests/unified-check/rollingOracleEquivalence.postgres.test.ts
Remove-Item Env:UNIFIED_ROLLING_ORACLE_RECEIPT_OUTPUT_V2
```

The test uses create-if-absent semantics and fails if an existing file differs.
Then run both deterministic scheduler replays explicitly:

```powershell
node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode replay `
  --traversal-policy snapshot-closure-v1 `
  --capacity 1,4,8,16,32,100 `
  --seed 24072026 `
  --oracle-receipt artifacts/unified-adaptive/plan3-b2-oracle.json `
  --output artifacts/unified-adaptive/fast-fix-v1-replay.json

node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode replay `
  --traversal-policy snapshot-closure-v2 `
  --capacity 1,4,8,16,32,100 `
  --seed 24072026 `
  --oracle-receipt artifacts/unified-adaptive/fast-fix-v2-oracle.json `
  --output artifacts/unified-adaptive/fast-fix-v2-replay.json
```

Expected: both commands exit 0 and validate all requested logical capacities
against the matching policy receipt. The PostgreSQL test, not the scheduler
simulation, is the exact traversal/hash equivalence proof. Never rewrite
`plan3-b2-oracle.json`.

- [ ] **Step 4: Run all tests once before live work**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run schema:verify
```

Expected: the full Vitest suite and typecheck pass, and schema 36 verifies.
Do not repeat this full suite unless code changes afterward.

- [ ] **Step 5: Update knowledge and runbook truth**

Document:

- v1/v2 manifest ownership and new-run fallback;
- frozen CEX-only v2 closure and non-terminal legacy risk labels;
- accepted/rejected assignment semantics;
- saturated utilization denominator;
- one-canary command and WSL memory capture;
- the deferred historical restriction/route/economic boundaries;
- the repeated agent rule that a provider assignment proposal is not capacity
  evidence until the pool accepts it.

Keep the new behavior labelled implemented only after Steps 1-4 pass.

- [ ] **Step 6: Commit code-complete documentation**

```powershell
git add tests/fixtures/unified-wallet/adaptive-rolling-provider-replay-v2.json tests/unified-check/rollingOracleEquivalence.postgres.test.ts artifacts/unified-adaptive/fast-fix-v2-oracle.json docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md docs/knowledge/13-agent-observations.md
git commit -m "test(unified): record v2 oracle and rollout contract"
```

- [ ] **Step 7: Prepare the exact live environment**

Use the clean feature worktree. Set:

```powershell
$candidate = (git rev-parse HEAD).Trim()
$evidenceRoot = Join-Path $env:LOCALAPPDATA "Temp\unified-fast-fix-$candidate"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$env:RUNTIME_GIT_SHA = $candidate
$env:UNIFIED_TRAVERSAL_POLICY_VERSION = "snapshot-closure-v1"
$env:UNIFIED_ROLLING_ROLLOUT_STAGE = "isolated_rolling"
$env:UNIFIED_PROVIDER_CAPACITY_CEILING = "4"
$env:UNIFIED_ISOLATED_WORKER_ONLY = "true"
```

Require the operator-owned four-group audit artifact through
`UNIFIED_PROVIDER_AUDIT_PATH`; never synthesize independence evidence from API
keys, configured group names, or observed traffic. Copy the exact approved
bytes into this run's evidence directory and let the benchmark's existing
`parseUnifiedProviderGroupAuditV1()` validation reject non-canonical content,
bad hashes, unhealthy groups, or capacity below four:

```powershell
$approvedAudit = $env:UNIFIED_PROVIDER_AUDIT_PATH
if ([string]::IsNullOrWhiteSpace($approvedAudit) -or
    -not (Test-Path -LiteralPath $approvedAudit -PathType Leaf)) {
  throw "UNIFIED_PROVIDER_AUDIT_PATH must name the approved four-group audit"
}
$providerAudit = Join-Path $evidenceRoot "provider-audit.json"
Copy-Item -LiteralPath $approvedAudit -Destination $providerAudit
```

If the approved artifact does not exist, stop before starting WSL, Docker, the
worker, or a live run. Creating the operator audit is an external rollout
authorization step and is not part of this code implementation.

- [ ] **Step 8: Run exactly one live scenario with integrated memory capture**

The harness from Task 6 captures and seals `before`, `during`, and `after` in
this same invocation. Run:

```powershell
node --import tsx scripts/runUnifiedAdaptiveBenchmark.ts `
  --mode live `
  --traversal-policy snapshot-closure-v2 `
  --capacity 4 `
  --isolated `
  --scenario isolated:TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd `
  --provider-audit "$providerAudit" `
  --memory-evidence-dir "$evidenceRoot" `
  --output "$evidenceRoot\fast-fix-live.json"
```

Expected: one isolated run only, no Telegram delivery intent, all four audited
groups dispatched, saturated average at least 3.5/4, zero unexplained idle
samples, bounded RSS/WSL memory, and no sustained swap growth.

If any memory phase or any other post-run gate fails, retain the evidence,
leave new user checks on v1, and do not launch a second canary without separate
authorization.

- [ ] **Step 9: Compare provider work with the preserved baseline**

Record the new wall time, histories, pages, terminal-boundary count, p50/p95
checkpoint-to-claim, group request counts, errors, 429, RSS range, WSL available
memory, and swap beside the saved baseline observation of roughly 1,177
histories, 6,926 pages, 2.39/4 average slots, and 20.2% 4/4 samples.

Do not claim exact live hash equality because the provider snapshot can differ.
Require internal closure and use frozen replay for exact correctness.

- [ ] **Step 10: Switch new user checks only after the live gate**

If every gate passes, restart the normal bot with:

```powershell
$env:UNIFIED_TRAVERSAL_POLICY_VERSION = "snapshot-closure-v2"
$env:UNIFIED_ROLLING_ROLLOUT_STAGE = "rolling_default"
$env:UNIFIED_PROVIDER_CAPACITY_CEILING = "4"
$env:UNIFIED_ISOLATED_WORKER_ONLY = "false"
```

Verify the startup log reports schema 36, the intended runtime commit, four
configured groups, and `bot_started`. Existing v1 runs keep v1. On regression,
restart with `UNIFIED_TRAVERSAL_POLICY_VERSION=snapshot-closure-v1`; do not
reinterpret or cancel active v2 runs automatically.

## Final Completion Gate

The implementation is complete only when all conditions hold:

- no migration file changed and schema 36 verifies;
- existing v1 fixtures retain their hashes;
- v2 closes only exact frozen custodial/CEX states;
- v2 legacy risk labels, hints, unknowns, bridge/DEX, and generic contracts
  continue traversal;
- mixed address states preserve required history;
- restart creates no reopened boundary or duplicate commit;
- pool assignment outcomes distinguish accepted and rejected proposals;
- stale epoch receives one immediate coalesced retry and never waits for the
  normal reconciliation interval;
- existing V1 benchmark evidence bytes and parsers remain unchanged;
- frozen rolling and barrier are exactly equal within each policy;
- full tests, typecheck, and schema verification pass on the final code;
- the one permitted isolated dense-wallet canary meets utilization, delivery,
  provider, closure, and memory gates;
- knowledge documents describe code-proven current behavior;
- `.codex-live/` and unrelated user changes remain untouched.
