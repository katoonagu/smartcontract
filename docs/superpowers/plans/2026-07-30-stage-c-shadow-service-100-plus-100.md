# Stage C Shadow Service 100 + 100 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled-by-default, non-authoritative Stage C profile that evaluates the existing service-behavior `100 + 100` model from hash-verified accepted history only when every sampled event has authoritative economic-role evidence.

**Architecture:** A pure offline foundation first reconstructs per-state windows and refuses to classify when its optional hash-bound role map is absent or incomplete. The typed admission gate then calls that exact primitive for every reconstructed-history result while accounting for exactly 24 service and 6 adverse controls at their declared evidence levels. Production wiring remains blocked until a human approves that receipt and two later executable prerequisites prove useful real role coverage and safe unreferenced artifact storage.

**Tech Stack:** TypeScript, Node.js, Vitest, PostgreSQL, the existing `ServiceBehaviorResultV2` classifier, accepted address-history artifacts, canonical JSON hashing, and `insertUnifiedArtifact`.

---

## 1. Verified current facts

Product truth read for this plan: `docs/knowledge/AGENT_BRIEF.md`, `02-check-modes.md`, `03-job-lifecycle.md`, `04-data-sources-tronscan-indexing.md`, `06-deepcheck.md`, `08-admin-and-bot-ux.md`, `09-current-decisions.md`, `10-open-problems.md`, `12-runbooks.md`, and `14-current-roadmap.md`. The service-boundary specs, lean validation plan, and manual corpus replay were also read. This plan has no dependency on, shared switch with, or behavioral assumption about cashflow work.

Current code establishes these constraints:

- `src/forensics/serviceBehaviorResearch.ts:1-357` is the only `100 + 100` vector/predicate/classification authority.
- `src/types.ts:344` defines `IndexedTronUsdtTransfer` without transaction index or poisoning/GasFree/provider-risk economic role.
- `src/unifiedCheck/productionTraversalCoordinator.ts:436` reconstructs accepted history for a `group: TraversalStateV1[]`; the call at `:1066` is after V2 pre-boundary partitioning.
- V2 exact CEX labels terminalize before accepted-history application; V1 has no frozen-label authority at that seam. Binance/HTX therefore remain offline controls only. This plan adds no pre-boundary hook.
- `src/unifiedCheck/repository.ts:644` exposes `insertUnifiedArtifact`. Migration 033 allows arbitrary immutable artifact kinds, but safe unreferenced storage still requires an executable contract test before integration.
- `src/unifiedCheck/productionFinalizer.ts:238-336` reads accepted task-attempt artifacts by expected kind, not every run artifact.
- The measured broad replay at commit `d6113b066bb933b785793c2950dac5db329b4953` is `8/37`. The narrow service/adverse accounting is currently `3/24` and `5/6` under the broad runner.
- Current accepted histories have no inline economic-role authority, and no existing `service_role_event_role_map` producer or reference was found. The expected current prerequisite result is therefore zero useful real profiles and a stop before production wiring.

## 2. Scope and non-goals

In scope: typed offline evidence accounting; deterministic accepted-history reconstruction; an optional hash-bound event-role map; a JSON-safe research profile; a strict disabled flag; per-state idempotent shadow observation; immutable standalone artifact persistence if proven safe; and byte-equivalence tests for all authoritative outputs.

Out of scope: exact Binance/HTX behavior in the runtime artifact; adverse completeness or adverse runtime output; any stop/action/counterfactual-action field; production service boundary; history suppression; new provider call; `500 + 100`; physical `2 + 2` or page-cost claim; request identity v2; EOA-at-anchor authority; adverse provider probe; database migration; new task/queue; Admin UI; score/report/delivery/Telegram change; canary, rollout, activation, or Stage D.

`high_inferred_service` is behavioral role evidence only. It is not a risk, safety, cleanliness, or production-action decision. The checked subject is excluded from classification. The runtime artifact contains no exact-CEX, adverse, action, or boundary-eligibility field.

## 3. Dependency order and hard aborts

Execute in this order:

1. Task 0: implement and test the pure reconstruction/role-authority primitive. It has no config, storage, coordinator, or runtime hook.
2. Task 1: produce the exact typed receipt by calling Task 0 for reconstructed histories.
3. Stop and obtain explicit human approval of the Task 1 receipt. Tasks 2-5 are not authorized before that approval.
4. Task 2: after approval, run storage and real-role-coverage prerequisites.
5. If either Task 2 prerequisite fails, stop. Do not edit config, runtime, coordinator, or Admin. Open a separate role-materialization/storage design as appropriate.
6. Only with Task 1 approved and both Task 2 prerequisites green, execute Tasks 3-5.
7. Stop again after Stage C shadow evidence review and human adjudication.

Abort production integration when any condition holds:

- service numerator/denominator is not exactly `24/24` or adverse is not exactly `6/6`;
- typed per-case results are missing, duplicated, mismatched, or lack evidence limitations;
- `reconstructedAcceptedHistories < 1`;
- the Task 1 receipt has not received explicit human approval;
- no real accepted history has 200 sampled events with authoritative hash-bound roles;
- an anchor, canonical order, seven-day separation, role binding, or source hash is unproven;
- standalone artifact storage changes or requires accepted-attempt/result/named hashes;
- enabled mode changes provider tape, frontier, terminals, score, report, presentation, delivery, Telegram, or Admin bytes;
- implementation requires a provider call, migration, new task, new pre-boundary seam, or user-visible surface.

## 4. Reconstruction and role-authority contract

For each `TraversalStateV1` independently:

1. Resolve exactly one anchor from `sourceEventIds` and `anchorTimestamp`. Zero or multiple matches returns `insufficient_data/anchor_unproven`.
2. Use only confirmed, successful, non-reverted official-USDT canonical events for that address at or before the anchor.
3. Select the first 100 recent canonical events in descending authoritative order.
4. Let `recentBaselineStart` be the oldest recent event. Set `historicalCutoff = min(anchor - 7 days, recentBaselineStart - 7 days)`.
5. Select the first 100 canonical events strictly before that cutoff. Do not top up either window.
6. Current accepted events lack a transaction index. V1 proves order only if every selected block has at most one relevant event; otherwise return `insufficient_data/order_unproven`.
7. Verify the role-map artifact hash and its `runId`, `snapshotHash`, and `addressHistoryManifestSha256` bindings.
8. Every sampled canonical event must have exactly one authoritative role entry. Missing, duplicate, conflicting, or unbound entries return `insufficient_data/role_authority_missing` or `role_authority_conflict`. Never default an unknown role to `ordinary`.
9. Preserve state/anchor identity, manifest hash/key, accepted page hashes, role-map hash, canonical event IDs, and evidence hashes. Record `boundaryPageAuthority: false` and `physicalPageRequestHashes: []`.

Reconstruction is analytical replay from accepted artifacts, not proof of provider page geometry or request cost.

## Task 0: Build the pure role-authority and reconstruction adapter

**Files:**

- Modify: `src/forensics/serviceBehaviorResearch.ts:1-220`
- Modify: `tests/forensics/offlineForensicModelReplay.test.ts:890-1320`
- Create: `tests/forensics/serviceBehaviorResearch.test.ts`
- Create: `src/unifiedCheck/serviceRoleShadow.ts`
- Create: `tests/unified-check/serviceRoleShadow.test.ts`
- Reference only: `src/types.ts:344`
- Reference only: `src/unifiedCheck/traversal.ts:3`

- [ ] **Step 1: Write failing compatibility tests for accepted-history inputs**

Extend `ServiceBehaviorRowV2` minimally:

```ts
readonly featureRole:
  | "ordinary"
  | "poisoning_only"
  | "gasfree_fee"
  | "gasfree_principal"
  | "provider_risk";
readonly orderAuthority?: "exact_position" | "unique_block";
```

Undefined preserves the existing exact-position behavior. `unique_block` is authoritative only when every canonical row in the selected window occupies a distinct block. `provider_risk` counts canonically but is excluded from behavior features.

Add regression assertions to the existing `offlineForensicModelReplay.test.ts` service helper/tests so the current recorded vectors remain byte-identical after the type change. Add focused tests for provider-risk exclusion, unique-block success, and same-block failure in the new small test file.

Run:

```powershell
npx vitest run tests/forensics/serviceBehaviorResearch.test.ts tests/forensics/offlineForensicModelReplay.test.ts
```

Expected: FAIL on the new role/order cases; all pre-existing failures, if any, must be recorded separately and not hidden.

- [ ] **Step 2: Implement only role filtering and explicit order proof**

Include `orderAuthority` in collision equality. Keep every numeric threshold and `classifyServiceBehavior100Plus100V2` unchanged. Do not add a new vector/classification type.

- [ ] **Step 3: Define the complete pure adapter surface**

```ts
export type ServiceRoleShadowEventRoleV1 =
  | "ordinary" | "poisoning_only" | "gasfree_fee"
  | "gasfree_principal" | "provider_risk";

export type ServiceRoleShadowEventRoleMapV1 = {
  schemaVersion: "service-role-shadow-event-role-map-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  entries: readonly {
    canonicalEventId: string;
    role: ServiceRoleShadowEventRoleV1;
    authority: "existing_hash_bound_economic_role_v1";
    evidenceSha256: string;
  }[];
};

export type ServiceRoleShadowInsufficientReasonV1 =
  | "checked_subject_excluded" | "anchor_unproven"
  | "recent_window_incomplete" | "historical_window_incomplete"
  | "order_unproven" | "role_map_missing"
  | "role_authority_missing" | "role_authority_conflict"
  | "source_binding_invalid";

export type JsonSafeServiceWindowVectorV2 =
  | (Omit<CompleteServiceWindowVectorV2, "dominantExactAmountRaw"> & {
      dominantExactAmountRaw: string | null;
    })
  | IncompleteServiceWindowVectorV2;

export type JsonSafeServiceBehaviorResultV2 =
  Omit<ServiceBehaviorResultV2, "recentVector" | "historicalVector"> & {
    recentVector: JsonSafeServiceWindowVectorV2;
    historicalVector: JsonSafeServiceWindowVectorV2;
  };

export type ServiceRoleShadowMode =
  | "disabled"
  | "service-role-shadow-100-plus-100-v1";

export type ServiceRoleShadowArtifactV1 = {
  schemaVersion: "service-role-shadow-profile-v1";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string; snapshotHash: string; subjectAddress: string;
  profiledAddress: string; traversalStateId: string;
  anchor: { timestamp: string; sourceEventIds: readonly string[] };
  source: {
    evidenceClass: "accepted_history_reconstruction";
    manifestKey: string; manifestSha256: string;
    acceptedPageArtifactHashes: readonly string[];
    eventRoleMapSha256: string | null;
    physicalPageRequestHashes: readonly [];
    boundaryPageAuthority: false;
  };
  sampledCanonicalEventIds: {
    recent: readonly string[]; historical: readonly string[];
  };
  result: {
    status: ServiceBehaviorResultV2["status"] | "not_run";
    insufficientReason: ServiceRoleShadowInsufficientReasonV1 | null;
    classifier: JsonSafeServiceBehaviorResultV2 | null;
  };
  productionEffect: false;
};

export function maybeBuildServiceRoleShadowArtifactV1(input: {
  mode: ServiceRoleShadowMode;
  runId: string; snapshotHash: string; subjectAddress: string;
  state: TraversalStateV1;
  acceptedHistory: {
    manifestKey: string; manifestSha256: string;
    pageArtifactHashes: readonly string[];
    events: readonly IndexedTronUsdtTransfer[];
  };
  eventRoleMap: {
    sha256: string; artifact: ServiceRoleShadowEventRoleMapV1;
  } | null;
}): { sha256: string; artifact: ServiceRoleShadowArtifactV1 } | null;
```

The artifact defines no exact role, adverse summary, clean/completeness claim, action, or boundary field.

- [ ] **Step 4: Write failing pure adapter tests**

Cover disabled short-circuit; checked subject; exact anchor; cutoff formula; no top-up; 99-row windows; same-block ambiguity; duplicate/colliding canonical IDs; missing/tampered/wrong-run/wrong-snapshot/wrong-manifest role map; missing/duplicate/conflicting role entry; feature-role exclusion; deterministic JSON hash; and successful `high_inferred_service`/`non_service_profile` evidence results without production meaning.

Run:

```powershell
npx vitest run tests/unified-check/serviceRoleShadow.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 5: Implement the pure adapter and run all affected offline tests**

Add the required comment:

```ts
// ponytail: v1 proves accepted-history order only for one sampled event per
// block; upgrade after accepted artifacts carry authoritative in-block order.
```

Run:

```powershell
npx vitest run tests/forensics/serviceBehaviorResearch.test.ts tests/forensics/offlineForensicModelReplay.test.ts tests/unified-check/serviceRoleShadow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the pure unit**

```powershell
git add src/forensics/serviceBehaviorResearch.ts src/unifiedCheck/serviceRoleShadow.ts tests/forensics/serviceBehaviorResearch.test.ts tests/forensics/offlineForensicModelReplay.test.ts tests/unified-check/serviceRoleShadow.test.ts
git commit -m "feat: add offline service shadow reconstruction primitive"
```

## Task 1: Replace the broad percentage with a typed Stage C admission receipt

**Files:**

- Create: `src/forensics/serviceRoleShadowGate.ts`
- Create: `scripts/replayServiceRoleShadowGate.ts`
- Create: `tests/fixtures/forensics/service-role-shadow-reconstruction-v1.json`
- Create: `tests/forensics/serviceRoleShadowGate.test.ts`
- Reference only: `tests/fixtures/forensics/forensic-model-offline-corpus-v1.json`
- Reference only: `src/forensics/offlineForensicModelReplay.ts:130-145`, `:527-1150`
- Reference only: `tests/forensics/offlineForensicModelReplay.test.ts:890-1320`
- Reference only: `src/unifiedCheck/serviceRoleShadow.ts` created in Task 0

- [ ] **Step 1: Freeze the receipt types and evidence meanings**

Add these public types:

```ts
export type StageCCaseEvaluationV1 =
  | "reconstructed_history_replay"
  | "recorded_vector_replay"
  | "partial_observation_replay"
  | "sparse_guard_replay"
  | "expectation_integrity_only"
  | "exact_assertion_replay"
  | "adverse_composition_replay";

export type StageCCaseResultV1 = {
  id: string;
  suite: "service" | "adverse";
  evaluation: StageCCaseEvaluationV1;
  expected: string;
  observed: string;
  matched: boolean;
  sourceSha256: string | null;
  evidenceLimitations: readonly string[];
};

export type ServiceRoleShadowGateReceiptV1 = {
  schemaVersion: "service-role-shadow-gate-v1";
  service: { numerator: number; denominator: 24 };
  adverse: { numerator: number; denominator: 6 };
  cases: readonly StageCCaseResultV1[];
  reconstructedAcceptedHistories: number;
  mismatches: readonly string[];
};
```

`numerator` means “matched at the case's declared evidence level,” not blind classifier accuracy. The CLI is green only for exactly 30 unique case results, `24/24`, `6/6`, no mismatches, and at least one reconstructed accepted history.

- [ ] **Step 2: Write failing evidence-tier tests**

The test must name these limitations explicitly:

- W8: `recorded_vector_replay` and `recorded_calibration_vector_not_raw_pages`.
- D7: `sparse_guard_replay` and `checked_subject_guard_only`.
- VUS: `partial_observation_replay` and `partial_73_rows_not_two_windows`.
- All 20 whole-export controls, including `csv-q98cdn`, `csv-aEGqTr`, and `csv-H14eaf`: `expectation_integrity_only` and `whole_export_not_real_100_plus_100_windows`.
- Exact Binance and HTX assertions: offline `exact_assertion_replay` only; no runtime eligibility.
- Six adverse cases: offline composition controls only.

The reconstruction fixture must contain hash-consistent accepted manifest/page bytes, one state/anchor, 100 recent rows, 100 historical rows, and authoritative role entries. The test passes those bytes to `maybeBuildServiceRoleShadowArtifactV1` from Task 0 and derives the reconstructed case's `observed` value from the returned artifact. Tampering any source hash, anchor, role binding, or case ID must make the gate red.

Run:

```powershell
npx vitest run tests/forensics/serviceRoleShadowGate.test.ts
```

Expected: FAIL because the typed runner and fixture do not exist.

- [ ] **Step 3: Implement the focused runner without duplicating classifier thresholds**

Export only:

```ts
export function replayServiceRoleShadowGateV1(input: {
  corpus: unknown;
  reconstructedFixture: unknown;
}): ServiceRoleShadowGateReceiptV1;
```

Import `maybeBuildServiceRoleShadowArtifactV1` from Task 0 for reconstruction. The gate module must not import `serviceBehaviorResearch.ts` or implement window selection, cutoff, role binding, vector, predicate, or classification logic. Increment `reconstructedAcceptedHistories` only when Task 0 returns a hash-valid artifact whose `result.classifier` is non-null and whose observed status matches the reconstructed case expectation.

For the other declared evidence levels, reuse existing canonical JSON, broad offline replay, exact frozen-assertion decoder, and adverse partition functions. Whole-export controls validate frozen expectation/source integrity only; do not relabel them as reconstructed or classifier-replayed. Keep Binance/HTX data inside this offline path.

- [ ] **Step 4: Verify exact receipt output**

```powershell
node --import tsx scripts/replayServiceRoleShadowGate.ts
npx vitest run tests/forensics/serviceRoleShadowGate.test.ts
```

Expected: exit 0; service `24/24`; adverse `6/6`; 30 unique typed cases; empty mismatches; `reconstructedAcceptedHistories` at least 1; nonempty case-level evidence limitations.

Also assert from the focused test that `serviceRoleShadowGate.ts` imports `serviceRoleShadow.ts` and contains no direct import of `serviceBehaviorResearch.ts`. This is the runnable check against a duplicate or precomputed reconstruction algorithm.

- [ ] **Step 5: Commit the admission unit**

```powershell
git add src/forensics/serviceRoleShadowGate.ts scripts/replayServiceRoleShadowGate.ts tests/fixtures/forensics/service-role-shadow-reconstruction-v1.json tests/forensics/serviceRoleShadowGate.test.ts
git commit -m "test: add typed stage c shadow admission gate"
```

- [ ] **Step 6: Publish the receipt for human review and stop**

Attach the stable JSON receipt, Task 0 commit hash, Task 1 commit hash, exact commands/results, and per-case evidence limitations to the review. Stop here. Do not run Task 2 or edit storage/config/runtime/coordinator files until a human explicitly approves this Stage C admission receipt.

## Task 2: Prove storage safety and real role-map usefulness

**Prerequisite:** The exact Task 1 receipt has explicit human approval. Without it, this task is not authorized.

**Files:**

- Modify: `tests/storage/unifiedCheck.postgres.test.ts:20-110`
- Modify: `tests/unified-check/productionFinalizer.postgres.test.ts:35-480`
- Create: `scripts/auditServiceRoleShadowPrerequisites.ts`
- Create: `tests/unified-check/serviceRoleShadowPrerequisites.test.ts`
- Reference only: `src/unifiedCheck/repository.ts:644-688`
- Reference only: `migrations/033_unified_wallet_check.sql:96-113`, `:222-224`

- [ ] **Step 1: Prove the exact standalone storage contract**

Extend the existing PostgreSQL repository test to call:

```ts
await insertUnifiedArtifact(scoped, {
  sha256: fingerprintCanonicalArtifact(shadow),
  createdByRunId: runId,
  kind: "service_role_shadow_profile",
  schemaVersion: "1",
  artifact: shadow
});
```

Call it twice and assert one immutable row, matching kind/schema/hash/`created_by_run_id`, and zero `unified_check_attempts.artifact_sha256` references. Mutation/deletion must remain rejected by `unified_check_artifacts_immutable`.

- [ ] **Step 2: Prove the finalizer ignores the standalone kind**

Extract the current production-finalizer fixture into a local `runFinalizerScenario({ includeShadowArtifact: boolean })` helper. Run false/true in separate schemas and compare canonical bytes for the traversal artifact, `final_score`, `final_decision`, `evidence_bundle_sha256`, `traversal_closure_sha256`, `scoring_bundle_sha256`, `report_sha256`, report artifact JSON, presentation-envelope rows, delivery-intent rows, and `unified_check_deliveries` binding fields.

Run:

```powershell
npx vitest run tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts
```

Expected with `TEST_DATABASE_URL`: PASS. If the standalone row cannot remain immutable, idempotent, unreferenced, and invisible to finalization, abort this plan. Do not add a migration or result reference here.

- [ ] **Step 3: Implement a read-only real-coverage audit**

The audit queries accepted `address_history` attempt/manifests and same-run `service_role_event_role_map` artifacts, verifies every artifact hash/binding with Task 0's validator, reconstructs both windows through Task 0's exact primitive, and emits:

```ts
export type ServiceRoleShadowPrerequisiteReceiptV1 = {
  schemaVersion: "service-role-shadow-prerequisites-v1";
  acceptedHistories: number;
  reconstructedHistories: number;
  historiesWithRoleMap: number;
  fullyRoleBoundHistories: number;
  sampledEvents: number;
  roleBoundSampledEvents: number;
  failures: readonly {
    manifestSha256: string;
    reason: ServiceRoleShadowInsufficientReasonV1;
  }[];
};
```

The script opens a read-only transaction, makes no provider call, prints stable JSON, exits 0 only when `reconstructedHistories > 0` and `fullyRoleBoundHistories > 0`, and exits 2 for a valid but non-useful zero-coverage result.

Run:

```powershell
node --import tsx scripts/auditServiceRoleShadowPrerequisites.ts
npx vitest run tests/unified-check/serviceRoleShadowPrerequisites.test.ts
```

Expected on the current tree/data model: audit exit 2 with `fullyRoleBoundHistories: 0` because accepted transfers have no role map. This is the planned YAGNI stop: do not execute Task 3. Write a separate role-materialization plan that defines how existing poisoning/GasFree/provider-risk evidence becomes a run/snapshot/manifest-bound map without new provider calls.

- [ ] **Step 4: Continue only after a separately approved producer makes the audit green**

Expected before continuation: exit 0, at least one fully role-bound real accepted history, no source-binding conflicts, and the approved Task 1 receipt still exact. Re-review line references because the separate producer may change the tree.

- [ ] **Step 5: Commit the green prerequisite proof**

```powershell
git add tests/storage/unifiedCheck.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts scripts/auditServiceRoleShadowPrerequisites.ts tests/unified-check/serviceRoleShadowPrerequisites.test.ts
git commit -m "test: prove service shadow integration prerequisites"
```

Do not make this commit or continue when the audit exits 2; stop for the separate role-materialization effort.

## Task 3: Add disabled wiring and per-state observation

**Prerequisite:** The Task 1 receipt is human-approved and Task 2 is green. Otherwise this task is not authorized.

**Files:**

- Modify: `src/config.ts:26-80`, `:554-572`
- Modify: `tests/config/config.test.ts:60-110`, `:650-710`
- Modify: `src/unifiedCheck/productionTraversalCoordinator.ts:436-577`, `:1066-1095`
- Modify: `src/unifiedCheck/productionRuntime.ts:289-340`, `:410-435`
- Modify: `src/index.ts:653-700`
- Modify: `tests/unified-check/productionTraversalCoordinator.test.ts:250-320`, `:1328-1550`
- Modify: `tests/unified-check/productionRuntime.test.ts:1-35`

- [ ] **Step 1: Add strict disabled config tests**

Parse only `disabled` and `service-role-shadow-100-plus-100-v1` from `UNIFIED_SERVICE_ROLE_SHADOW_POLICY`; unset defaults to disabled; empty/boolean/unknown values fail. The mode must not enter manifest, snapshot hash, request identity, or provider configuration.

- [ ] **Step 2: Define the hook, timeout, and observer**

```ts
export const SERVICE_ROLE_SHADOW_HOOK_TIMEOUT_MS = 1_000;

export type ServiceRoleShadowHookResultV1 =
  | { kind: "persisted"; artifactSha256: string }
  | { kind: "skipped"; reason: ServiceRoleShadowInsufficientReasonV1 };

export type ServiceRoleShadowObservationV1 = {
  runId: string; traversalStateId: string;
  status: "persisted" | "skipped" | "failed" | "timed_out";
  artifactSha256: string | null;
  reason: string | null;
};

export type AcceptedAddressHistoryShadowHookV1 = (input: {
  runId: string; snapshotHash: string; subjectAddress: string;
  state: TraversalStateV1;
  manifestKey: string; manifestSha256: string;
  pageArtifactHashes: readonly string[];
  events: readonly IndexedTronUsdtTransfer[];
}) => Promise<ServiceRoleShadowHookResultV1>;

export type LoadServiceRoleShadowEventRoleMapV1 = (input: {
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
}) => Promise<{
  sha256: string;
  artifact: ServiceRoleShadowEventRoleMapV1;
} | null>;
```

Add optional `onAcceptedAddressHistoryShadow` and `onServiceRoleShadowObservation` inputs to the coordinator factory. Catch callback rejection and observer rejection separately. Race each callback against the constant timeout; attach a rejection handler to late completion so it cannot become unhandled.

- [ ] **Step 3: Write deterministic group-cardinality tests**

Add a local `twoAnchorAcceptedHistoryScenario` beside existing `twoReadyHistories`. Give one address two states with different anchor identities. After accepted authoritative application, sort a copy of `group` by `traversalStateId` and invoke the hook once per state, sequentially.

Assert N states produce N calls and N state/anchor-keyed hashes; different anchors are not deduplicated; retry yields the same per-state hashes; one failure/timeout does not suppress later states; observer events are deterministic; disabled mode produces zero calls.

- [ ] **Step 4: Implement the runtime hook only through existing local artifacts**

Add `loadServiceRoleShadowEventRoleMap` to `createUnifiedProductionRuntime` input. `src/index.ts` implements it with one local query over `unified_check_artifacts` constrained by `created_by_run_id`, `kind = 'service_role_event_role_map'`, and `artifact_json->>'addressHistoryManifestSha256'`. Zero rows returns `null`; one row is hash/binding-validated; more than one returns a shadow `role_authority_conflict` observation. This query makes no provider call.

For each callback, load that already-materialized role map, validate and reconstruct it with Task 0's primitive, build the profile, and call:

```ts
await insertUnifiedArtifact(input.db, {
  sha256,
  createdByRunId: runId,
  kind: "service_role_shadow_profile",
  schemaVersion: "1",
  artifact
});
```

No label dataset, provider binding, `address_metadata` query, exact CEX role, or adverse evidence enters this path. No map returns `skipped/role_map_missing`; it never defaults roles.

- [ ] **Step 5: Run focused wiring tests and commit**

```powershell
npx vitest run tests/config/config.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/productionRuntime.test.ts
git add src/config.ts src/index.ts src/unifiedCheck/productionTraversalCoordinator.ts src/unifiedCheck/productionRuntime.ts tests/config/config.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/productionRuntime.test.ts
git commit -m "feat: observe role-authoritative service profiles per state"
```

Expected: PASS; default disabled has zero loader/hook/observer calls.

## Task 4: Prove exact non-interference with existing harnesses

**Files:**

- Modify: `tests/unified-check/productionTraversalCoordinator.test.ts:1328-1550`
- Modify: `tests/unified-check/productionRuntime.postgres.test.ts:20-390`
- Modify: `tests/unified-check/productionFinalizer.postgres.test.ts:35-480`
- Modify: `tests/admin/forensicsGraph.test.ts:1-120`
- Reference only: `src/unifiedCheck/presentation.ts:1210-1305`
- Reference only: `src/unifiedCheck/delivery.ts:149-270`

- [ ] **Step 1: Define the exact runtime observable snapshot**

Refactor the existing restart acceptance fixture into `runRuntimeRestartScenario({ shadowMode, roleMap })` and return:

```ts
type RuntimeObservableSnapshotV1 = {
  providerRequestTapeBytes: string;
  frontierBytes: string;
  terminalStatesBytes: string;
  scoreBytes: string;
  reportBytes: string;
  presentationBytes: string;
  telegramPayloadBytes: string;
  deliveryBytes: string;
  acceptedTaskBytes: string;
  plannerBytes: string;
};
```

Build every field with `canonicalizeArtifactJson`. Provider tape is exactly `loadProviderPage.mock.calls.map(([v]) => [v.address, v.cursor])`. Frontier and terminals come from the accepted `traversal_result` artifact's `frontier` and `terminalStates`. Score bytes contain `final_score`, `final_decision`, and the four final hashes. Report bytes are the artifact at `report_sha256`. Presentation/Telegram bytes come from sorted `presentation_envelope` artifact JSON and its payload. Delivery bytes contain sorted `request_id`, `presentation_sha256`, `status`, `attempt_count`, `last_error`, and `telegram_message_id`.

- [ ] **Step 2: Compare disabled and enabled runs byte-for-byte**

Run identical seeded schemas and IDs once disabled and once enabled with a complete fixture role map. Assert `expect(enabled).toEqual(disabled)` for every `RuntimeObservableSnapshotV1` field. Separately assert enabled has exactly N standalone shadow rows for N accepted states and those hashes appear in no task attempt, run final hash, presentation, or delivery reference.

- [ ] **Step 3: Prove timeout/error isolation**

In `productionTraversalCoordinator.test.ts` use Vitest fake timers to advance exactly `SERVICE_ROLE_SHADOW_HOOK_TIMEOUT_MS`. Test builder rejection, persistence rejection, timeout, observer throw, missing map, and malformed map. Authoritative checkpoint/result bytes, frontier, terminals, and subsequent per-state callbacks must equal disabled mode.

- [ ] **Step 4: Prove finalizer and Admin projection exclusion**

Keep Task 2's false/true finalizer comparison. In `tests/admin/forensicsGraph.test.ts` add `projectUnifiedRunDag` coverage using the same `UnifiedWatchdogRunV1` authoritative fields before/after standalone shadow insertion; canonical DAG bytes must match because arbitrary unreferenced artifacts are not an input.

- [ ] **Step 5: Run exact non-interference checks and commit**

```powershell
npx vitest run tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/admin/forensicsGraph.test.ts
git add tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/admin/forensicsGraph.test.ts
git commit -m "test: prove stage c shadow byte non-interference"
```

Expected with `TEST_DATABASE_URL`: PASS; provider tape, frontier, terminals, score, report, presentation, Telegram payload, delivery, and Admin DAG bytes are identical.

## Task 5: Full verification, product truth, and mandatory human stop

**Files:**

- Modify during implementation only: `docs/knowledge/02-check-modes.md`
- Modify during implementation only: `docs/knowledge/03-job-lifecycle.md`
- Modify during implementation only: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify during implementation only: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify during implementation only: `docs/knowledge/09-current-decisions.md`
- Modify during implementation only: `docs/knowledge/14-current-roadmap.md`
- Modify only for a remaining recurring gap: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Rerun both admission receipts**

```powershell
node --import tsx scripts/replayServiceRoleShadowGate.ts
node --import tsx scripts/auditServiceRoleShadowPrerequisites.ts
```

Expected: exact `24/24` and `6/6` typed offline receipt, nonzero reconstructed histories, nonempty honest evidence limitations, and nonzero fully role-bound real accepted histories. Otherwise stop.

- [ ] **Step 2: Run focused, subsystem, full, and type checks**

```powershell
npx vitest run tests/forensics/serviceRoleShadowGate.test.ts tests/forensics/serviceBehaviorResearch.test.ts tests/forensics/offlineForensicModelReplay.test.ts tests/unified-check/serviceRoleShadow.test.ts tests/unified-check/serviceRoleShadowPrerequisites.test.ts
npx vitest run tests/config/config.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/productionRuntime.test.ts tests/unified-check/productionRuntime.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/storage/unifiedCheck.postgres.test.ts tests/admin/forensicsGraph.test.ts
npm test
npm run typecheck
```

Expected: every command exits 0.

- [ ] **Step 3: Self-review exact scope and diff**

```powershell
git diff --check
git diff --stat
git status --short
```

Confirm no placeholder text; every public type used by later tasks is defined above; all paths exist or are explicitly created; no threshold duplication; no exact-CEX/adverse/action runtime fields; no provider call, cashflow assumption, `500 + 100`, request identity, EOA boundary, pre-boundary seam, migration, Admin UI, history suppression, Stage D, canary, rollout, or activation.

- [ ] **Step 4: Update product truth only after verified implementation**

Document the disabled flag, per-state cardinality, accepted-history/role-map bindings, non-authoritative artifact, storage isolation, no-provider/no-output guarantee, evidence limitations, and Admin deferral. Record the missing-role/order problem in `10-open-problems.md` only if still unresolved. Do not update knowledge docs when Task 2 aborts before behavior exists.

- [ ] **Step 5: Commit verified documentation**

```powershell
git add docs/knowledge/02-check-modes.md docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: record stage c role-authoritative shadow behavior"
```

Add `docs/knowledge/10-open-problems.md` only if this implementation created or confirmed a still-open recurring problem; do not stage unrelated dirty edits.

- [ ] **Step 6: Produce the evidence packet and stop**

Include the typed 30-case receipt, per-case limitations, reconstruction count, real role-coverage receipt, storage/finalizer proof, N-state/N-artifact proof, timeout observations, and every byte-equivalence result. State that Binance/HTX are offline controls only and that the runtime artifact has no adverse/action authority.

Stop for human Stage C evidence review and adjudication. Do not enable the switch, run a canary, plan rollout, or begin Stage D without a new approved design and plan.

## Final implementation gate

- [ ] Offline receipt is exactly service `24/24` and adverse `6/6` with 30 typed unique cases.
- [ ] Evidence limitations truthfully distinguish W8 recorded, D7 sparse, VUS partial, and all 20 whole-export expectation-only controls.
- [ ] At least one accepted-history reconstruction replays in the offline gate.
- [ ] Task 1's stable receipt received explicit human approval before any Task 2-5 work.
- [ ] At least one real accepted history has complete hash-bound roles for both 100-event windows; otherwise integration stopped.
- [ ] Missing roles never default to ordinary.
- [ ] Exact Binance/HTX and all adverse controls remain offline-only.
- [ ] One sorted callback and one idempotent artifact exist per unique state/anchor; no cross-anchor dedupe.
- [ ] Standalone storage is immutable, unreferenced, idempotent, and invisible to finalization.
- [ ] Default disabled performs no shadow work.
- [ ] Provider tape, frontier, terminals, score, report, presentation, Telegram, delivery, and Admin bytes are identical on/off.
- [ ] Shadow rejection, timeout, or observer failure cannot change authoritative work.
- [ ] No forbidden scope entered the implementation.
- [ ] Tests, `npm test`, `npm run typecheck`, and diff checks pass.
- [ ] Knowledge docs match verified code, and execution stops for human approval.
