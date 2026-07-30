# Stage C Role-Map Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one local/offline producer that emits a `service_role_event_role_map` only when the exact Stage C sample has 200/200 immutable economic-role witnesses, and otherwise emits a canonical coverage receipt and exits `2` without writing a map.

**Architecture:** Reuse `maybeBuildServiceRoleShadowArtifactV1` to select the exact anchor-bound `100 + 100` event IDs. Resolve each ID from hash-verified accepted history plus independently validated local evidence; persist one evidence bundle and one map atomically only after all 200 roles resolve without conflict. Missing evidence remains missing: accepted page hashes and `riskTransaction=false` alone never authorize `ordinary`.

**Tech Stack:** TypeScript, Node.js/tsx, Vitest, PostgreSQL schema 037, existing canonical JSON hashing, accepted Unified artifacts, transaction-evidence validation, GasFree and address-poisoning parsers.

---

## Verified boundary

Read before this plan: `docs/knowledge/AGENT_BRIEF.md`, `03-job-lifecycle.md`, `04-data-sources-tronscan-indexing.md`, `09-current-decisions.md`, `12-runbooks.md`, and `14-current-roadmap.md`; also Task 2 of `docs/superpowers/plans/2026-07-30-stage-c-shadow-service-100-plus-100.md`, `src/unifiedCheck/serviceRoleShadow.ts`, the accepted-history/artifact repositories and schemas, and the GasFree, poisoning, and provider-risk parser tests.

Current schema-037 `tron_watch` proof:

- 3,745 accepted `address_history` manifests and zero `service_role_event_role_map` artifacts.
- Run `5417cbf6-7cef-4b91-8367-d266eaf3857e`, manifest `08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0`, has an exact anchor, 100 recent events, 100 historical events separated by seven days, and 200 unique blocks; Task 0 stops only at `role_map_missing`.
- Its sampled 200 have `0` validated transaction-info rows, `0` persisted poisoning witnesses, `0` provider-risk witnesses, and `0` exact local-index movements. All 200 accepted events contain provider `riskTransaction=false`, but that page fact alone is not ordinary authority.
- A read-only SQL prefilter over all 1,536 accepted manifests with at least 200 canonical events found only ten manifests intersecting any saved transaction-info. The maximum overlap in an entire manifest was 17; Task 0 reconstruction of all ten yielded zero transaction-info witnesses inside a valid 200-event sample. Current complete authoritative coverage is therefore `0/200`, with zero materializable maps.

This plan must end at the expected `exit 2` until local evidence is backfilled. It does not add a provider call, migration, queue/task, runtime/coordinator/config hook, score, action, boundary, report, Admin field, Stage D behavior, or knowledge-doc behavior claim.

## Closed-world role rule

For each sampled canonical event, one immutable evidence record must establish all three dimensions:

1. `provider_risk`: exact accepted event identity plus an explicit provider-risk disposition; absence of a row is unresolved.
2. `poisoning_only`: an exact `address-poisoning-v1` result bound to the event and complete local comparison coverage; skipped, partial, candidate-only-without-binding, or absent evidence is unresolved.
3. GasFree: a hash-validated successful `transaction-info` payload. The existing structural parser may prove `gasfree_fee` or `gasfree_principal`; a non-GasFree result is accepted only when a new tri-state wrapper proves the transaction is outside the registered controller/selector policy. Parser failure or an incomplete/malformed registered-controller payload is unresolved.

Combine only after all dimensions resolve. A single positive role wins only when the other dimensions are exact and non-conflicting. Zero positives becomes `ordinary`; two positives, a missing dimension, or mismatched movement identity stays unresolved. Never infer ordinary from page hash, `transfer`, `riskTransaction=false`, lack of a database row, or `extractGasFreeSettlement(...) === null`.

The separately bounded future backfill input is evidence references, not role assertions:

```ts
export type ServiceRoleLocalEvidenceBackfillV1 = {
  schemaVersion: "service-role-local-evidence-backfill-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  sampledCanonicalEventIds: readonly string[]; // exactly the Task 0 set, max 200
  entries: readonly {
    canonicalEventId: string;
    transactionInfoEvidenceId: string;
    transactionInfoPayloadSha256: string;
    transactionInfoFinalityWitnessSha256: string;
    poisoningEvidenceSha256: string;
    providerRiskEvidenceSha256: string;
  }[]; // unique IDs, max 200
};
```

Every referenced item must already exist locally, be hash-valid, and bind the exact event/run/snapshot/manifest. The producer accepts no raw role label, URL, provider client, API key, or network fallback. For the known candidate, 200 validated transaction-info payloads and 200 exact poisoning/provider-risk dispositions are required; if those bytes do not exist in a local archive/database, the map remains impossible.

## Task 1: Build the pure fail-closed resolver

**Files:**

- Create: `src/unifiedCheck/serviceRoleMapMaterialization.ts`
- Modify: `src/forensics/gasFreeSettlement.ts`
- Test: `tests/unified-check/serviceRoleMapMaterialization.test.ts`
- Test: `tests/forensics/gasFreeSettlement.test.ts`
- Reference only: `src/unifiedCheck/serviceRoleShadow.ts`
- Reference only: `src/monitor/addressPoisoning.ts`

- [ ] **Step 1: Write red tests for exact role authority**

Cover 200/200 ordinary, exact GasFree fee/principal, exact poisoning/provider-risk exclusion, duplicate/conflicting roles, one missing witness, wrong event/run/snapshot/manifest binding, invalid evidence hash, 199/200 input, page-only false risk, missing transaction-info, registered-controller parse ambiguity, and deterministic input-order independence.

```powershell
npx vitest run tests/unified-check/serviceRoleMapMaterialization.test.ts tests/forensics/gasFreeSettlement.test.ts
```

Expected: FAIL because the resolver and GasFree tri-state result do not exist.

- [ ] **Step 2: Add the narrow GasFree tri-state without changing existing callers**

Add a pure exported result beside `extractGasFreeSettlement`:

```ts
export type GasFreeSettlementDispositionV1 =
  | { kind: "exact_settlement"; settlement: GasFreeSettlement }
  | { kind: "not_gasfree_v1"; reason: "controller_not_registered" | "selector_not_registered" }
  | { kind: "unresolved"; reason: "payload_invalid" | "registered_payload_ambiguous" };
```

`extractGasFreeSettlement` keeps its current return contract. Only a canonical, complete transaction-info payload with a different controller/selector may prove `not_gasfree_v1`; malformed data remains unresolved.

- [ ] **Step 3: Implement the minimal resolver and artifacts**

`serviceRoleMapMaterialization.ts` must call Task 0 with `eventRoleMap: null`, require its result to be exactly `role_map_missing`, and use its two sampled-ID arrays verbatim. Produce a canonical coverage receipt on every valid input:

```ts
export type ServiceRoleMaterializationCoverageV1 = {
  schemaVersion: "service-role-materialization-coverage-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  traversalStateIds: readonly string[];
  sampledEventCount: 200;
  fullyAuthorizedEventCount: number;
  roleCounts: Readonly<Record<ServiceRoleShadowEventRoleV1, number>>;
  missing: readonly { canonicalEventId: string; dimensions: readonly string[] }[];
  conflicts: readonly { canonicalEventId: string; roles: readonly ServiceRoleShadowEventRoleV1[] }[];
};
```

If and only if `fullyAuthorizedEventCount === 200`, `missing` and `conflicts` are empty, build:

- `service-role-event-evidence-bundle-v1`, containing sorted per-event source hashes and resolved roles;
- the existing `service-role-shadow-event-role-map-v1`, with exactly 200 sorted unique entries and every `evidenceSha256` equal to the bundle hash.

Otherwise return the receipt and no bundle/map. Add a `ponytail:` comment that V1 supports one exact 200-event sample and must be versioned before larger or cross-anchor materialization.

- [ ] **Step 4: Run green tests**

```powershell
npx vitest run tests/unified-check/serviceRoleMapMaterialization.test.ts tests/forensics/gasFreeSettlement.test.ts tests/unified-check/serviceRoleShadow.test.ts
```

Expected: PASS; the existing Task 0 behavior and GasFree callers remain unchanged.

## Task 2: Add the local DB audit/materializer

**Files:**

- Create: `scripts/materializeServiceRoleEventMap.ts`
- Create: `tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts`
- Reference only: `src/storage/transactionEvidenceRepository.ts`
- Reference only: `src/unifiedCheck/repository.ts`
- Reference only: `migrations/033_unified_wallet_check.sql`

- [ ] **Step 1: Write red PostgreSQL tests**

Seed schema-037 rows for one accepted manifest, pages, accepted attempt, traversal state, and local evidence. Assert:

- audit mode uses a read-only transaction and writes zero rows;
- 199/200 produces exit classification `incomplete`, a stable receipt, and zero map/bundle rows;
- 200/200 inserts exactly one evidence bundle and one map in one transaction;
- both inserts are idempotent, immutable, created by the bound run, and referenced by zero `unified_check_attempts`;
- a differing existing artifact, multiple maps for one manifest, or any binding/hash mismatch rolls back both inserts.

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name the disposable schema-037 test database" }
npx vitest run tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
```

Expected: FAIL because the CLI/DB composition does not exist. A skipped file is not a pass.

- [ ] **Step 2: Implement one bounded CLI**

Support only:

```text
audit --run <uuid> --manifest <sha256> --anchor <ISO timestamp> [--evidence-backfill <local-json>]
materialize --confirm --run <uuid> --manifest <sha256> --anchor <ISO timestamp> [--evidence-backfill <local-json>]
```

The CLI loads the accepted attempt/manifest/pages and matching persisted traversal states, verifies every canonical artifact hash and inventory, calls Task 0, validates referenced local evidence through existing repository readers, and calls the pure resolver. The backfill file is capped at 200 unique entries and may only reference already-persisted evidence; reject symlinks, duplicate JSON keys, extra events, embedded payloads, and role fields.

`audit` prints canonical JSON and exits `0` only at 200/200, `2` for honest incomplete coverage, and `1` for corrupt/conflicting input. `materialize` performs all validation before `BEGIN`, rechecks authoritative rows under the transaction, inserts bundle then map with `insertUnifiedArtifact`, and commits only at 200/200. It imports no Tron client, scheduler, provider runtime, config, coordinator, finalizer, delivery, or Admin module.

- [ ] **Step 3: Run the current real DB proof**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
node --import dotenv/config --import tsx scripts/materializeServiceRoleEventMap.ts audit `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
```

Expected now: exit `2`, `sampledEventCount: 200`, `fullyAuthorizedEventCount: 0`, 200 missing transaction-info authorities, no `service_role_event_role_map` row, and no provider request. This is the required hard stop; do not run `materialize`, add runtime wiring, or continue Stage C integration.

- [ ] **Step 4: Prove the green path only with a complete local fixture**

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name the disposable schema-037 test database" }
npx vitest run tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts tests/unified-check/serviceRoleMapMaterialization.test.ts
```

Expected: PASS with a synthetic local 200/200 evidence fixture; this proves producer correctness, not real role coverage.

## Task 3: Verification and commit discipline

**Files:** only the implementation/test files above. Do not update current knowledge docs until a real map exists or product behavior changes.

- [ ] **Step 1: Run the bounded checks**

```powershell
npx vitest run tests/forensics/gasFreeSettlement.test.ts tests/monitor/addressPoisoning.test.ts tests/unified-check/serviceRoleShadow.test.ts tests/unified-check/serviceRoleMapMaterialization.test.ts tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts tests/storage/transactionEvidenceRepository.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all non-PostgreSQL tests pass; PostgreSQL test runs without skips when `TEST_DATABASE_URL` is set; typecheck and diff check pass.

- [ ] **Step 2: Re-run the real audit and enforce the abort**

Expected: the known database still exits `2` at `0/200`; artifact counts remain zero for `service_role_event_role_map` and `service_role_event_evidence_bundle`. Record the canonical receipt hash in the implementation handoff, not in a production result.

- [ ] **Step 3: Commit implementation only after the tests are green**

```powershell
git add src/forensics/gasFreeSettlement.ts src/unifiedCheck/serviceRoleMapMaterialization.ts scripts/materializeServiceRoleEventMap.ts tests/forensics/gasFreeSettlement.test.ts tests/unified-check/serviceRoleMapMaterialization.test.ts tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
git commit -m "feat: materialize role maps from exact local evidence"
```

Stop after the commit and the expected real-data `exit 2`. A real map requires a separate, reviewed local evidence backfill supplying the missing immutable bytes; it does not authorize provider fetching, runtime wiring, scoring, action, or Stage D.

## Hard aborts

- Any sampled event lacks any one authority dimension.
- Task 0 returns anything except `role_map_missing` with exactly 100 recent plus 100 historical unique-block events.
- Page bytes are proposed as sole ordinary authority.
- A GasFree null/parse failure is proposed as non-GasFree proof.
- Backfill contains a role assertion, embedded unpersisted payload, more than 200 entries, or a mismatched ID/hash/binding.
- Existing maps conflict or more than one map targets the run/manifest.
- Bundle/map insertion would be non-atomic, referenced by an attempt, or visible to finalization.
- Any provider, runtime, migration, queue, score, action, boundary, report, delivery, Admin, rollout, or Stage D file enters the diff.
