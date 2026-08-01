# Exact Role Evidence Capture And Stage C Task 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture exact local economic-role evidence for the frozen real accepted history, materialize one real `200/200` service-role map, preserve and land the existing Stage C Task 2 proof, and finish with the prerequisite audit at exit `0` without wiring Stage C into production runtime.

**Architecture:** Reuse the existing accepted-history loader, central TronScan scheduler, transaction-evidence repository, strict GasFree parser, and `address-poisoning-v1` policy. A bounded resumable operator CLI persists one content-addressed capture manifest before provider work, then only valid raw `transaction-info` evidence; it atomically publishes 200 poisoning dispositions, 200 provider-risk dispositions, and one completed receipt only when all three dimensions resolve for every sampled event. The existing materializer must validate that receipt before it can create the evidence bundle and role map.

**Tech Stack:** TypeScript, Node.js/tsx, Vitest, PostgreSQL schema 037, existing `TronscanClient` and `createTronscanScheduler`, canonical JSON hashing, Unified immutable artifacts, and the existing transaction-evidence repository.

---

## Verified boundary and frozen authority

Read before writing this plan:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/14-current-roadmap.md`
- `docs/superpowers/specs/2026-07-30-forensic-model-completion-roadmap-and-exact-role-capture-design.md`
- the existing Stage C shadow, role-map materialization, and cashflow foundation plans
- the current capture/materializer/provider repository code and focused tests

The only authorized real source for this delivery is:

```text
runId:   5417cbf6-7cef-4b91-8367-d266eaf3857e
manifest: 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0
anchor:  2026-06-04T09:20:33.000Z
```

The current materializer audit is a reproducible `exit 2` with:

```text
sampledEventCount:          200
fullyAuthorizedEventCount:  0
missing dimensions/event:   gasfree, poisoning_only, provider_risk
conflicts:                  []
matching traversal states:  7
```

All seven matching states produce the same `100 + 100` sample. The capture manifest therefore records the lexicographically first state as `primaryStateId` and also binds the sorted seven-state equivalence set. It never picks a state by database row order.

This plan adds no migration, task, queue, production config, coordinator hook, score, report, Admin field, Telegram field, delivery behavior, blind corpus, cashflow authority, or Stage D behavior. It also adds no package dependency and no package script; the CLI is intentionally invoked directly through `node --import tsx`.

## File responsibility map

| File | Responsibility | Must not do |
|---|---|---|
| `src/storage/transactionEvidenceRepository.ts` | Build and validate one permanent provider-evidence value from an endpoint payload | Provider I/O, retry, scheduling |
| `src/unifiedCheck/serviceRoleExactEvidenceCapture.ts` | Pure manifest, exact disposition, coverage, receipt, and receipt-revalidation logic | SQL, environment access, network |
| `scripts/captureServiceRoleExactEvidence.ts` | Strict CLI, source loading, resume logic, provider composition, and atomic persistence | New retry loop, history calls, role guessing |
| `scripts/materializeServiceRoleEventMap.ts` | Export the existing source loader and require/revalidate one completed receipt | Provider calls, runtime wiring |
| `src/unifiedCheck/serviceRoleMapMaterialization.ts` | Consume exact disposition types while preserving the existing pure role composer | DB receipt discovery |
| `tests/storage/transactionEvidenceRepository.test.ts` | Permanent evidence builder boundary | Live network |
| `tests/unified-check/serviceRoleExactEvidenceCapture.test.ts` | Pure exact semantics and determinism | PostgreSQL |
| `tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts` | Resume, atomic finalize, idempotency, and CLI boundary | Live provider |
| `tests/unified-check/serviceRoleMapMaterialization*.test.ts` | Completed-receipt prerequisite and map regression | Production activation |
| preserved Task 2 four-file patch | Standalone artifact safety, finalizer byte non-interference, prerequisite audit | Capture implementation |
| `docs/knowledge/{02,03,04,09,14}-*.md` and final audit receipt | Record only behavior and coverage actually proven at the end | Future runtime claims |

## Permanent contracts

Define these contracts in `src/unifiedCheck/serviceRoleExactEvidenceCapture.ts`. Keep field names and literal versions exact so the materializer can validate persisted bytes without heuristics.

```ts
export type ServiceRoleExactEvidenceCaptureManifestV1 = {
  schemaVersion: "service-role-exact-evidence-capture-manifest-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  parserVersions: {
    gasFree: "gasfree-settlement-disposition-v1";
    poisoning: "address-poisoning-v1";
    providerRisk: "tronscan-risk-transaction-boolean-v1";
  };
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  profiledAddress: string;
  addressHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
  };
  traversal: {
    primaryStateId: string;
    equivalentStateIds: readonly string[];
    anchor: string;
    sourceEventIds: readonly string[];
  };
  sample: {
    recentCanonicalEventIds: readonly string[];
    historicalCanonicalEventIds: readonly string[];
  };
  provider: {
    chain: "tron";
    provider: "tronscan";
    endpoint: "transaction-info";
    providerSchemaVersion: 1;
  };
  events: readonly {
    canonicalEventId: string;
    eventBodySha256: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: string;
    eventIndex: number;
    direction: "incoming" | "outgoing";
    fromAddress: string;
    toAddress: string;
    amountRaw: string;
  }[];
};

export type ServiceRoleGasFreeDispositionV1 =
  | {
    disposition: "not_gasfree";
    reason: "controller_not_registered" | "selector_not_registered";
    settlementSha256: null;
    movementSha256: null;
  }
  | {
    disposition: "gasfree_principal" | "gasfree_fee";
    reason: "exact_settlement_movement";
    settlementSha256: string;
    movementSha256: string;
  };

export type ServiceRolePoisoningDispositionV1 = {
  schemaVersion: "service-role-poisoning-disposition-v1";
  policyVersion: "address-poisoning-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  coverage: "complete";
  disposition: "not_poisoning" | "poisoning_only";
  reason:
    | "not_incoming_to_profiled_address"
    | "complete_no_match"
    | "prior_relationship"
    | "candidate";
  comparison: {
    windowStart: string;
    windowEnd: string;
    pageArtifactHashes: readonly string[];
    canonicalComparisonEventIds: readonly string[];
    comparisonInventorySha256: string;
    orderAuthority: "not_applicable" | "strictly_earlier_timestamp";
  };
};

export type ServiceRoleProviderRiskDispositionV1 = {
  schemaVersion: "service-role-provider-risk-disposition-v1";
  policyVersion: "tronscan-risk-transaction-boolean-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  canonicalEventId: string;
  transactionInfoEvidenceId: string;
  transactionInfoPayloadSha256: string;
  riskTransaction: boolean;
  binding: "transaction_level_negative" | "sole_official_usdt_movement";
  disposition: "not_provider_risk" | "provider_risk";
};

export type ServiceRoleExactEvidenceCaptureReceiptV1 = {
  schemaVersion: "service-role-exact-evidence-capture-v1";
  policyVersion: "existing-hash-bound-economic-role-v1";
  captureManifestSha256: string;
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  sampledCanonicalEventIds: readonly string[];
  entries: readonly {
    canonicalEventId: string;
    eventBodySha256: string;
    transactionInfoEvidenceId: string;
    transactionInfoPayloadSha256: string;
    transactionInfoFinalityWitnessSha256: string;
    gasFree: ServiceRoleGasFreeDispositionV1;
    poisoningDispositionSha256: string;
    providerRiskDispositionSha256: string;
    role:
      | "ordinary"
      | "poisoning_only"
      | "gasfree_fee"
      | "gasfree_principal"
      | "provider_risk";
  }[];
};

export type ServiceRoleExactEvidenceCaptureCoverageV1 = {
  schemaVersion: "service-role-exact-evidence-capture-coverage-v1";
  runId: string;
  snapshotHash: string;
  addressHistoryManifestSha256: string;
  captureManifestSha256: string;
  sampledEventCount: number;
  uniqueTransactionCount: number;
  validTransactionEvidenceCount: number;
  fullyResolvedEventCount: number;
  missingTransactionHashes: readonly string[];
  unresolved: readonly {
    canonicalEventId: string;
    dimensions: readonly ("gasfree" | "poisoning_only" | "provider_risk")[];
    reasons: readonly string[];
  }[];
  completedReceiptSha256: string | null;
};
```

Content-address all manifest, disposition, and receipt values with `fingerprintCanonicalArtifact`. Every list in a persisted artifact must be either semantically ordered by the existing Stage C sample or explicitly sorted. Do not include `fetchedAt` in a receipt identity beyond the already persisted raw evidence bytes; retrying an identical provider response must not change the completed receipt hash.

## Task 0: Freeze the baseline and protect the preserved proof

**Files:** read-only checks only.

- [ ] **Step 1: Confirm the implementation baseline and dirty-file boundary**

```powershell
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
```

Expected branch: `codex/forensic-offline-integration-20260730`. Expected design baseline: commit `e5f26e669f84a1a5d2869528612c4a313786d7f6`. Preserve every unrelated modified/untracked file; never use bulk `git add .`.

- [ ] **Step 2: Re-run the no-network real audit**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
node --import dotenv/config --import tsx scripts/materializeServiceRoleEventMap.ts audit `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 2) { throw "expected current role coverage exit 2" }
```

Expected: `sampledEventCount=200`, `fullyAuthorizedEventCount=0`, seven sorted `traversalStateIds`, no conflicts, and no writes.

- [ ] **Step 3: Verify the preserved Task 2 worktree bytes**

```powershell
$proof = "C:\Users\User\.config\superpowers\worktrees\smartcontract\stage-c-task2-proof-20260730"
git -C $proof rev-parse HEAD
git -C $proof hash-object `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts `
  scripts/auditServiceRoleShadowPrerequisites.ts `
  tests/unified-check/serviceRoleShadowPrerequisites.test.ts
```

Expected base and file hashes, in order:

```text
13a867d278e1fece4a0436132d50008d799b2764
9ced7df8dc61d4fdd64d47819ebf9a4646de5375
27e55c1a89f9cb03c33cfc338e362d37155b102d
e9fe7f8a58b77399f6d641ffa71fa72b2fb86b35
3cf1505a52783043caf1befd437628899252518d
```

Abort if any hash differs. Do not clean, delete, reset, or commit this worktree yet.

## Task 1: Add one reusable permanent transaction-evidence builder

**Files:**

- Modify: `src/storage/transactionEvidenceRepository.ts`
- Modify: `tests/storage/transactionEvidenceRepository.test.ts`

- [ ] **Step 1: Write red tests for the builder**

Add tests proving a matching successful `transaction-info` payload produces the exact repository identity/payload/finality hashes, while wrong hash, unconfirmed, failed, ambiguous-finality, or invalid timestamp input throws `transaction_provider_evidence_not_permanent`.

```powershell
npx vitest run tests/storage/transactionEvidenceRepository.test.ts
```

Expected: FAIL because `buildTransactionProviderEvidenceV1` is not exported.

- [ ] **Step 2: Implement the pure builder beside the existing validators**

```ts
export function buildTransactionProviderEvidenceV1(input: {
  identity: TransactionProviderEvidenceIdentityV1;
  payload: unknown;
  fetchedAt: string;
  movement: TransactionProviderMovementWitnessV1 | null;
}): TronTransactionProviderEvidenceV1 {
  const identity = normalizeIdentity(input.identity);
  const payload = record(input.payload);
  if (!payload) throw new TypeError("transaction_provider_evidence_not_permanent");
  const status = endpointFinalityStatus(identity, payload);
  if (status === null) throw new TypeError("transaction_provider_evidence_not_permanent");
  const evidence: TronTransactionProviderEvidenceV1 = {
    version: identity.version,
    chain: identity.chain,
    txHash: identity.txHash,
    provider: identity.provider,
    endpoint: identity.endpoint,
    providerSchemaVersion: identity.providerSchemaVersion,
    fetchedAt: isoTimestamp(input.fetchedAt),
    finality: {
      status,
      witnessKind: identity.endpoint === "gettransactionbyid"
        ? "indexed_tron_usdt_transfer"
        : "tronscan_transaction_info",
      witnessSha256: transactionProviderFinalityWitnessSha256({
        identity,
        status,
        payload,
        movement: input.movement
      }),
      movement: input.movement
    },
    payloadSha256: fingerprintCanonicalArtifact(payload),
    payload
  };
  return validatePermanentEvidence(evidence);
}
```

The function is pure and performs no persistence. Do not move provider scheduling into the repository.

- [ ] **Step 3: Run the focused regression and commit**

```powershell
npx vitest run tests/storage/transactionEvidenceRepository.test.ts tests/forensics/selectiveTransactionEnrichment.test.ts
npm.cmd run typecheck
git diff --check
git add src/storage/transactionEvidenceRepository.ts tests/storage/transactionEvidenceRepository.test.ts
git commit -m "refactor: expose permanent transaction evidence builder"
```

Expected: all checks pass; only the two allowlisted files enter the commit.

## Task 2: Build the pure capture manifest and exact dispositions

**Files:**

- Create: `src/unifiedCheck/serviceRoleExactEvidenceCapture.ts`
- Create: `tests/unified-check/serviceRoleExactEvidenceCapture.test.ts`
- Modify: `src/unifiedCheck/serviceRoleMapMaterialization.ts`
- Modify: `tests/unified-check/serviceRoleMapMaterialization.test.ts`
- Reference only: `src/unifiedCheck/serviceRoleShadow.ts`
- Reference only: `src/forensics/gasFreeSettlement.ts`
- Reference only: `src/monitor/addressPoisoning.ts`

- [ ] **Step 1: Write red manifest tests**

Cover exact `100 + 100`, seven equivalent traversal states, lexicographic primary state, sorted page hashes, input-order determinism, duplicate sampled IDs, mismatched samples between states, wrong anchor, wrong event direction, and event-body tampering.

```powershell
npx vitest run tests/unified-check/serviceRoleExactEvidenceCapture.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement deterministic manifest construction**

Export:

```ts
export declare function buildServiceRoleExactEvidenceCaptureManifestV1(input: {
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  states: readonly TraversalStateV1[];
  anchor: string;
  acceptedHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
    events: readonly IndexedTronUsdtTransfer[];
  };
}): {
  sha256: string;
  artifact: ServiceRoleExactEvidenceCaptureManifestV1;
};
```

The function must call `maybeBuildServiceRoleShadowArtifactV1` for every candidate state with `eventRoleMap:null`, require `role_map_missing`, require exactly 100 recent plus 100 historical unique IDs, and require identical sampled-ID hashes across all candidate states. Build each `eventBodySha256` from every persisted event field after converting `blockTimestamp` to ISO. An event is incoming only when `toAddress === profiledAddress` and `fromAddress !== profiledAddress`; outgoing is the inverse. Self-transfer or unrelated direction is invalid source input.

- [ ] **Step 3: Write red exact-disposition tests**

Cover:

- explicit provider `riskTransaction=false` as a transaction-level negative;
- `true` with exactly one strict official-USDT movement as `provider_risk`;
- `true` with two official-USDT movements as unresolved;
- missing/non-boolean risk, wrong transaction hash, failed finality, and tampered payload/witness hashes;
- GasFree principal, fee, exact controller/selector negative, registered-payload ambiguity, and duplicate movement mismatch;
- poisoning candidate, complete negative, outgoing structural negative, partial 24-hour interval, and same-timestamp order ambiguity;
- ordinary only after three negatives, each single positive role, two-positive conflict, one unresolved dimension, and `199/200`;
- deterministic artifacts across evidence/history input order.

Reuse real valid Tron addresses and the official USDT contract in fixtures. Do not use malformed `TSender-1` style values at this trust boundary.

- [ ] **Step 4: Implement the strict official-USDT movement parser**

Inside the new pure module, accept only the first non-empty authoritative transaction-info transfer list from the same alias set already used by GasFree. Normalize token, from, and to addresses with `TronWeb`, require canonical non-negative decimal amounts, reject conflicting token aliases, and return either a complete list or a typed unresolved reason. Do not search a second alias after accepting a non-empty first alias.

For `riskTransaction=true`, authorize the event only when the complete list contains exactly one official-USDT movement and that movement exactly matches the canonical event tuple. For `false`, bind the transaction-level negative to every sampled event in that transaction. The accepted page's normalized `riskTransaction` value is corroboration only and never replaces the payload boolean.

- [ ] **Step 5: Implement poisoning replay with complete local coverage**

For an outgoing event, emit the structural negative with empty comparison IDs and `orderAuthority:"not_applicable"`.

For an incoming event:

1. Set `windowStart = incomingAt - 24 hours` and `windowEnd = incomingAt`.
2. Reject authority if any different accepted event has the same timestamp as the incoming event; the accepted artifact lacks transaction index.
3. Select all accepted events with timestamps in `[windowStart, windowEnd)`.
4. Convert them to `AddressPoisoningTransfer` and call `detectAddressPoisoning` with `coverage:"complete"`, `suppression:null`, and no sender-account shortcut.
5. Bind the sorted comparison IDs, all accepted page hashes, and `fingerprintCanonicalArtifact(sortedComparisonIds)`.
6. Map `candidate` to `poisoning_only`; map `complete_no_match` and `prior_relationship` to `not_poisoning`; treat every inconclusive or unrepresentable result as unresolved.

The accepted manifest's hash-verified `account_creation_reached` exhaustion is the lower-bound authority. Do not perform a new address-history request.

- [ ] **Step 6: Implement the complete-only evaluator and validator**

Export:

```ts
export declare function evaluateServiceRoleExactEvidenceCaptureV1(input: {
  manifest: {
    sha256: string;
    artifact: ServiceRoleExactEvidenceCaptureManifestV1;
  };
  acceptedEvents: readonly IndexedTronUsdtTransfer[];
  transactionEvidence: ReadonlyMap<string, TronTransactionProviderEvidenceV1>;
}): {
  coverage: ServiceRoleExactEvidenceCaptureCoverageV1;
  poisoning: readonly { sha256: string; artifact: ServiceRolePoisoningDispositionV1 }[];
  providerRisk: readonly { sha256: string; artifact: ServiceRoleProviderRiskDispositionV1 }[];
  receipt: { sha256: string; artifact: ServiceRoleExactEvidenceCaptureReceiptV1 } | null;
};

export declare function validateServiceRoleExactEvidenceCaptureReceiptV1(input: {
  manifest: { sha256: string; artifact: ServiceRoleExactEvidenceCaptureManifestV1 };
  receipt: { sha256: string; artifact: ServiceRoleExactEvidenceCaptureReceiptV1 };
  acceptedEvents: readonly IndexedTronUsdtTransfer[];
  transactionEvidence: ReadonlyMap<string, TronTransactionProviderEvidenceV1>;
  poisoning: ReadonlyMap<string, { sha256: string; artifact: ServiceRolePoisoningDispositionV1 }>;
  providerRisk: ReadonlyMap<string, { sha256: string; artifact: ServiceRoleProviderRiskDispositionV1 }>;
}): ReadonlyMap<string, ServiceRoleExactEvidenceCaptureReceiptV1["entries"][number]>;
```

`evaluate` returns zero complete-only artifacts whenever one event is unresolved or conflicting. `validate` must rebuild the expected evaluator result and require the exact receipt/disposition hashes; this is the function the materializer will call.

Move the poisoning/provider-risk type authority into the new module and re-export those types from `serviceRoleMapMaterialization.ts` so existing imports remain source-compatible.

- [ ] **Step 7: Run the pure suite and commit**

```powershell
npx vitest run `
  tests/unified-check/serviceRoleExactEvidenceCapture.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.test.ts `
  tests/unified-check/serviceRoleShadow.test.ts `
  tests/forensics/gasFreeSettlement.test.ts `
  tests/monitor/addressPoisoning.test.ts
npm.cmd run typecheck
git diff --check
git add `
  src/unifiedCheck/serviceRoleExactEvidenceCapture.ts `
  src/unifiedCheck/serviceRoleMapMaterialization.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.test.ts
git commit -m "feat: derive exact service role capture evidence"
```

Expected: all tests pass and no provider/storage module is imported by the pure evaluator.

## Task 3: Add the resumable bounded operator CLI

**Files:**

- Create: `scripts/captureServiceRoleExactEvidence.ts`
- Create: `tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts`
- Modify: `scripts/materializeServiceRoleEventMap.ts`
- Reference only: `src/config.ts`
- Reference only: `src/tron/tronClient.ts`
- Reference only: `src/tron/tronscanScheduler.ts`
- Reference only: `src/unifiedCheck/repository.ts`

- [ ] **Step 1: Export the already-tested accepted-history loader**

Rename and export the existing private `loadSource` without moving its SQL or validation logic:

```ts
export type ServiceRoleMaterializationSource = Awaited<
  ReturnType<typeof loadServiceRoleMaterializationSource>
>;

export declare function loadServiceRoleMaterializationSource(
  db: ServiceRoleMaterializationQueryable,
  command: Pick<ServiceRoleMaterializationCommand, "runId" | "manifestSha256" | "anchor">,
  lock: boolean
): Promise<{
  runId: string;
  snapshotHash: string;
  subjectAddress: string;
  manifest: AddressHistoryManifestV1;
  acceptedHistory: {
    manifestKey: string;
    manifestSha256: string;
    pageArtifactHashes: readonly string[];
    events: readonly IndexedTronUsdtTransfer[];
  };
  states: readonly TraversalStateV1[];
}>;
```

Use the current `loadSource` body unchanged behind this exported signature. Keep `buildMaterialization` calling this exported function. Run the materializer tests before adding capture behavior to prove the extraction is behavior-neutral.

```powershell
npx vitest run tests/unified-check/serviceRoleMapMaterialization.test.ts tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
```

Expected: PASS when `TEST_DATABASE_URL` is set; a skipped PostgreSQL file is not a pass.

- [ ] **Step 2: Write red CLI-boundary and resume tests**

The parser accepts only:

```text
audit --run 5417cbf6-7cef-4b91-8367-d266eaf3857e --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 --anchor 2026-06-04T09:20:33.000Z
capture --confirm --run 5417cbf6-7cef-4b91-8367-d266eaf3857e --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 --anchor 2026-06-04T09:20:33.000Z
```

Reject duplicate flags, `--confirm` on audit, missing confirm on capture, extra endpoint/history/address/role flags, malformed UUID/hash/timestamp, and any source other than the three explicit arguments.

PostgreSQL tests must assert:

- audit uses a repeatable-read read-only transaction, makes zero provider calls, and writes zero rows;
- capture writes the manifest before the first provider call;
- each missing unique tx hash is requested once per invocation;
- valid raw evidence is saved immediately;
- unavailable provider responses yield exit classification `incomplete` and no dispositions/receipt;
- unsupported/missing `riskTransaction`, wrong hash, or contradictory finality is fatal and never persisted;
- a second invocation skips every already valid raw evidence ID;
- complete finalize inserts exactly 200 poisoning artifacts, 200 provider-risk artifacts, and one receipt atomically;
- a conflict in artifact 400 rolls back all 401 complete-only inserts;
- repeating complete capture preserves hashes and row counts.

- [ ] **Step 3: Implement the injectable orchestration boundary**

```ts
export type ServiceRoleExactEvidenceCaptureCommand = {
  mode: "audit" | "capture";
  runId: string;
  manifestSha256: string;
  anchor: string;
};

export type ServiceRoleExactEvidenceCaptureDatabase =
  ServiceRoleMaterializationQueryable & {
    transaction<T>(
      mode: "read_only" | "read_write",
      work: (tx: ServiceRoleMaterializationQueryable) => Promise<T>
    ): Promise<T>;
  };

export type ServiceRoleExactEvidenceCaptureDependencies = {
  getTransaction(txHash: string): Promise<unknown>;
  now(): Date;
};

export declare function runServiceRoleExactEvidenceCapture(
  db: ServiceRoleExactEvidenceCaptureDatabase,
  command: ServiceRoleExactEvidenceCaptureCommand,
  deps: ServiceRoleExactEvidenceCaptureDependencies
): Promise<{
  classification: "complete" | "incomplete";
  coverage: ServiceRoleExactEvidenceCaptureCoverageV1;
  captureManifestSha256: string;
  completedReceiptSha256: string | null;
  providerLogicalRequests: number;
}>;
```

Implement this exact state machine:

1. Read-only load and validate the source; build the deterministic manifest and current coverage.
2. In audit mode, verify any existing capture artifacts and return without calling `deps.getTransaction` or any write function.
3. In capture mode, insert exactly one `service_role_exact_evidence_capture_manifest` artifact in a short serializable transaction and verify no competing manifest exists for the run/history/sample.
4. Re-read saved transaction evidence. Iterate sorted missing unique tx hashes once. Let `TronscanClient`/scheduler own retries, cooldown, key rotation, and pacing. On a valid response, require explicit boolean `riskTransaction`, build permanent evidence with Task 1, and call `saveTransactionProviderEvidence` immediately. On provider exhaustion, continue and report incomplete. On unsupported response/schema, throw after preserving already valid raw evidence.
5. Re-read all raw evidence. If pure evaluation is incomplete, return exit classification `incomplete`; write no disposition or receipt.
6. If complete, enter one serializable transaction, reload the source under lock, rebuild the manifest, reload all raw evidence, re-evaluate, and require identical hashes.
7. Insert the 200 poisoning artifacts, then 200 provider-risk artifacts, then the single `service_role_exact_evidence_capture` receipt. Verify every returned row kind/schema/creator/hash and verify zero attempt references before commit.
8. On repeat, require the same rows/hashes; any differing artifact is a conflict.

Use a sequential missing-hash loop. Add a `ponytail:` comment that V1 deliberately trades parallel speed for bounded resumability and that scheduler-owned concurrency is the upgrade path if measured operator time requires it. Do not add `sleep`, a retry loop, a second key pool, or a new provider client.

- [ ] **Step 4: Compose the existing scheduler and client only in `main`**

Construct `createTronscanScheduler` from `loadConfig()` with the same intervals, API keys/groups, cooldowns, `maxInFlight`, and `maxInFlightPerGroup` already used by runtime scripts. Construct `TronscanClient` with `schedulerDedupeNamespace:"service_role_exact_evidence_capture"`. The only client method passed into orchestration is `tronClient.getTransaction.bind(tronClient)`.

Print canonical JSON coverage. Exit `0` only when the completed receipt exists and revalidates, `2` for honest provider/disposition incompleteness, and `1` for arguments, schema, source, hash, binding, or immutable-artifact conflict.

- [ ] **Step 5: Run PostgreSQL tests without skip and commit**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
$env:DATABASE_URL = node --import dotenv/config -p "process.env.DATABASE_URL"
$env:TEST_DATABASE_URL = $env:DATABASE_URL
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL is required" }
npx vitest run `
  tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
npm.cmd run typecheck
git diff --check
git add `
  scripts/captureServiceRoleExactEvidence.ts `
  scripts/materializeServiceRoleEventMap.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts
git commit -m "feat: capture resumable exact service role evidence"
```

Expected: all three test files run, none is skipped, and only the three allowlisted files enter the commit.

## Task 4: Make the completed receipt mandatory for materialization

**Files:**

- Modify: `scripts/materializeServiceRoleEventMap.ts`
- Modify: `tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts`
- Modify: `tests/unified-check/serviceRoleMapMaterialization.test.ts` only if shared disposition fixtures require the new exact fields

- [ ] **Step 1: Write red receipt-gate tests**

Add cases for:

- 200 valid raw/disposition rows without a receipt remain incomplete and create no map;
- one hash-valid receipt produces `200/200`;
- two receipts for one run/history/sample are a conflict;
- wrong manifest/sample/event-body/raw/disposition hash is rejected;
- provided legacy `--evidence-backfill` references must exactly match receipt entries and cannot bypass the receipt;
- GasFree is re-parsed from raw evidence and compared with the inline receipt disposition;
- repeat materialize remains idempotent and unreferenced by attempts.

```powershell
npx vitest run tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
```

Expected: FAIL because the current materializer can complete from raw/disposition rows alone.

- [ ] **Step 2: Load exactly one source-bound completed receipt**

After source/sample reconstruction, query `service_role_exact_evidence_capture` artifacts by `created_by_run_id`, `addressHistoryManifestSha256`, and sample identity. Treat zero receipts as honest incomplete coverage. Treat more than one candidate, a bad artifact hash, wrong capture-manifest binding, or any invalid receipt as a conflict.

When one receipt exists:

1. Load its referenced `service_role_exact_evidence_capture_manifest` artifact.
2. Rebuild the expected manifest from the currently locked source and require the exact hash.
3. Load raw evidence through `getTransactionProviderEvidence`.
4. Load poisoning/provider-risk artifacts only by hashes named in the receipt; remove free selection of arbitrary matching disposition rows.
5. Call `validateServiceRoleExactEvidenceCaptureReceiptV1` to rerun GasFree/event/provider/poisoning binding.
6. If a backfill file was supplied, require every backfill reference to equal the corresponding receipt reference; it remains a local-reference compatibility path, not authority.
7. Only then call `materializeServiceRoleEventMapV1`.

- [ ] **Step 3: Run the complete materializer regression and commit**

```powershell
npx vitest run `
  tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.test.ts
npm.cmd run typecheck
git diff --check
git add `
  scripts/materializeServiceRoleEventMap.ts `
  tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.test.ts
git commit -m "feat: require completed capture for role maps"
```

Expected: synthetic complete path is `200/200`; the no-receipt path is incomplete; no runtime/config file changes.

## Task 5: Pre-live verification gate

**Files:** read-only checks only.

- [ ] **Step 1: Run every focused pure/repository/PostgreSQL test**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
$env:DATABASE_URL = node --import dotenv/config -p "process.env.DATABASE_URL"
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npx vitest run `
  tests/storage/transactionEvidenceRepository.test.ts `
  tests/forensics/selectiveTransactionEnrichment.test.ts `
  tests/forensics/gasFreeSettlement.test.ts `
  tests/monitor/addressPoisoning.test.ts `
  tests/unified-check/serviceRoleShadow.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all files pass and PostgreSQL suites are not skipped.

- [ ] **Step 2: Prove the production boundary is untouched**

```powershell
git diff --exit-code e5f26e669f84a1a5d2869528612c4a313786d7f6 -- `
  src/index.ts `
  src/config.ts `
  src/unifiedCheck/productionTraversalCoordinator.ts `
  src/unifiedCheck/productionFinalizer.ts `
  src/admin `
  src/bot
```

Expected: no output and exit `0`. Abort live capture if this diff is non-empty.

- [ ] **Step 3: Run capture audit and verify it is network/write free**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
node --import dotenv/config --import tsx scripts/captureServiceRoleExactEvidence.ts audit `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 2) { throw "expected pre-capture exit 2" }
```

Expected: exact 200-event manifest identity, no completed receipt, and zero provider logical requests.

## Task 6: Capture the frozen real evidence

**Files:** PostgreSQL data only; no source edit during provider capture.

- [ ] **Step 1: Run the explicitly confirmed bounded capture**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
node --import dotenv/config --import tsx scripts/captureServiceRoleExactEvidence.ts capture --confirm `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
```

Expected terminal outcomes:

- Exit `0`: continue only when `sampledEventCount=200`, `fullyResolvedEventCount=200`, `unresolved=[]`, and `completedReceiptSha256` is a 64-hex hash.
- Exit `2`: keep the manifest and valid raw evidence; record the sorted missing/unresolved list. Re-run this same command only after provider recovery. The next invocation must request only missing tx hashes.
- Exit `1`: stop. Do not edit the frozen source, synthesize a negative, select another manifest, or weaken a parser. Diagnose the exact schema/hash/binding conflict under a separately reviewed change.

There is no automatic retry shell loop and no automatic source fallback.

- [ ] **Step 2: Re-run capture audit and idempotency capture**

After the first exit `0`:

```powershell
node --import dotenv/config --import tsx scripts/captureServiceRoleExactEvidence.ts audit `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 0) { throw "completed capture failed audit" }

node --import dotenv/config --import tsx scripts/captureServiceRoleExactEvidence.ts capture --confirm `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 0) { throw "idempotent capture failed" }
```

Expected: the second capture performs zero provider logical requests and returns the identical manifest/receipt hash.

## Task 7: Materialize and verify the real `200/200` role map

**Files:** PostgreSQL data only.

- [ ] **Step 1: Run read-only materializer audit**

```powershell
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
node --import dotenv/config --import tsx scripts/materializeServiceRoleEventMap.ts audit `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 0) { throw "role materializer audit did not reach 200/200" }
```

Expected: `sampledEventCount=200`, `fullyAuthorizedEventCount=200`, `missing=[]`, `conflicts=[]`, and non-null bundle/map hashes; audit writes nothing.

- [ ] **Step 2: Materialize and repeat**

```powershell
node --import dotenv/config --import tsx scripts/materializeServiceRoleEventMap.ts materialize --confirm `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 0) { throw "role map materialization failed" }

node --import dotenv/config --import tsx scripts/materializeServiceRoleEventMap.ts materialize --confirm `
  --run 5417cbf6-7cef-4b91-8367-d266eaf3857e `
  --manifest 08dff32559b2c793f4bf4b185b6186548296ba1694b8ee90320c228db8e0e9c0 `
  --anchor 2026-06-04T09:20:33.000Z
if ($LASTEXITCODE -ne 0) { throw "idempotent role map materialization failed" }
```

Expected: identical bundle/map hashes and exactly one row of each kind for the bound run/manifest. Both artifacts remain referenced by zero `unified_check_attempts`.

## Task 8: Land the preserved Stage C Task 2 proof only after the real map exists

**Files in the preserved worktree:**

- Modify: `tests/storage/unifiedCheck.postgres.test.ts`
- Modify: `tests/unified-check/productionFinalizer.postgres.test.ts`
- Create: `scripts/auditServiceRoleShadowPrerequisites.ts`
- Create: `tests/unified-check/serviceRoleShadowPrerequisites.test.ts`

- [ ] **Step 1: Recheck all four proof hashes and target base hashes**

```powershell
$proof = "C:\Users\User\.config\superpowers\worktrees\smartcontract\stage-c-task2-proof-20260730"
git -C $proof hash-object `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts `
  scripts/auditServiceRoleShadowPrerequisites.ts `
  tests/unified-check/serviceRoleShadowPrerequisites.test.ts
git hash-object `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts
```

Expected proof hashes remain:

```text
9ced7df8dc61d4fdd64d47819ebf9a4646de5375
27e55c1a89f9cb03c33cfc338e362d37155b102d
e9fe7f8a58b77399f6d641ffa71fa72b2fb86b35
3cf1505a52783043caf1befd437628899252518d
```

Expected current tracked target hashes before cherry-pick remain:

```text
03ca786c0d173b86e6374d71f5d6add23be95ef6
42f8fe43d8739376d1e05cafd44b95b5331571da
```

Abort if either target file changed during Tasks 1-7; resolve overlap explicitly instead of forcing the patch.

- [ ] **Step 2: Run proof tests and the real prerequisite audit in the proof worktree**

```powershell
Push-Location $proof
$env:DOTENV_CONFIG_PATH = "C:\Users\User\OneDrive\Desktop\smartcontract\.env"
$env:DATABASE_URL = node --import dotenv/config -p "process.env.DATABASE_URL"
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npx vitest run `
  tests/unified-check/serviceRoleShadowPrerequisites.test.ts `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts
if ($LASTEXITCODE -ne 0) { throw "Task 2 proof tests failed" }
node --import tsx scripts/auditServiceRoleShadowPrerequisites.ts
if ($LASTEXITCODE -ne 0) { throw "Stage C prerequisite audit did not exit 0" }
Pop-Location
```

Expected receipt: `fullyRoleBoundHistories >= 1`, `roleBoundSampledEvents >= 200`, exit `0`. PostgreSQL tests must run without skip.

- [ ] **Step 3: Commit the exact proof where it was preserved, then cherry-pick**

```powershell
git -C $proof add -- `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts `
  scripts/auditServiceRoleShadowPrerequisites.ts `
  tests/unified-check/serviceRoleShadowPrerequisites.test.ts
git -C $proof commit -m "test: prove Stage C shadow prerequisites"
$proofCommit = git -C $proof rev-parse HEAD
git cherry-pick $proofCommit
```

Expected: the four-file proof lands without conflict. Keep the proof worktree; do not remove it during this delivery.

- [ ] **Step 4: Re-run the landed proof from the integration branch**

```powershell
npx vitest run `
  tests/unified-check/serviceRoleShadowPrerequisites.test.ts `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts
node --import tsx scripts/auditServiceRoleShadowPrerequisites.ts
if ($LASTEXITCODE -ne 0) { throw "landed prerequisite audit did not exit 0" }
```

Expected: the same green tests and prerequisite receipt. The finalizer test proves authoritative bytes/bindings are identical with and without a standalone Stage C artifact.

## Task 9: Full verification, evidence packet, and knowledge conformance

**Files:**

- Create: `docs/audit/2026-07-30-stage-c-exact-role-evidence-receipt.md`
- Modify: `docs/knowledge/02-check-modes.md`
- Modify: `docs/knowledge/03-job-lifecycle.md`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/14-current-roadmap.md`
- Modify `docs/knowledge/10-open-problems.md` only if the accepted gate leaves a recurring unresolved problem

- [ ] **Step 1: Run the complete verification matrix**

```powershell
npx vitest run `
  tests/storage/transactionEvidenceRepository.test.ts `
  tests/forensics/selectiveTransactionEnrichment.test.ts `
  tests/forensics/gasFreeSettlement.test.ts `
  tests/monitor/addressPoisoning.test.ts `
  tests/unified-check/serviceRoleShadow.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.test.ts `
  tests/unified-check/serviceRoleExactEvidenceCapture.postgres.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.test.ts `
  tests/unified-check/serviceRoleMapMaterialization.postgres.test.ts `
  tests/unified-check/serviceRoleShadowPrerequisites.test.ts `
  tests/storage/unifiedCheck.postgres.test.ts `
  tests/unified-check/productionFinalizer.postgres.test.ts
npm.cmd run typecheck
npm.cmd test
git diff --check
```

Expected: focused tests and full suite pass; the focused PostgreSQL files run without skips; typecheck and whitespace checks pass.

- [ ] **Step 2: Re-prove idempotency and production non-interference**

Re-run the completed capture audit, materializer audit, and prerequisite audit commands from Tasks 6-8. Require the same capture receipt, bundle, and map hashes.

```powershell
git diff --exit-code e5f26e669f84a1a5d2869528612c4a313786d7f6 -- `
  src/index.ts `
  src/config.ts `
  src/unifiedCheck/productionTraversalCoordinator.ts `
  src/unifiedCheck/productionFinalizer.ts `
  src/admin `
  src/bot
```

Expected: no production runtime/config diff.

- [ ] **Step 3: Write the evidence packet from actual outputs**

Use `apply_patch` to create `docs/audit/2026-07-30-stage-c-exact-role-evidence-receipt.md`. Record only observed values:

- exact run/manifest/anchor and integration/proof commit IDs;
- capture manifest, coverage, completed receipt, bundle, and map hashes;
- unique tx count, provider logical-request counts per invocation, raw evidence IDs/payload/finality hashes, and disposition hashes;
- role counts and `200/200`, empty missing/conflicts;
- first-run and repeat-run artifact cardinalities/hashes;
- prerequisite audit counts and exit `0`;
- exact focused/full commands and results;
- explicit statement that no API key, provider account identity, secret, production config, or runtime hook is included.

Do not invent a value and do not copy secrets into the document.

- [ ] **Step 4: Update knowledge truth after the gate is green**

Use `apply_patch` and make only factual updates:

- `02-check-modes.md`: one real Stage C role map exists, but Stage C is still offline and not a production check mode.
- `03-job-lifecycle.md`: capture is an operator CLI; its artifacts are standalone and unreferenced by accepted attempts; no job/task lifecycle changed.
- `04-data-sources-tronscan-indexing.md`: exact transaction-info capture uses the existing scheduler/repository; accepted page `riskTransaction=false` is corroboration, not authority.
- `09-current-decisions.md`: record the frozen source, exact capture/map hashes, gate result, and continued disabled runtime status.
- `14-current-roadmap.md`: mark real Stage C evidence admission/Task 2 complete and leave Stage C runtime shadow as the next separate design/plan.
- `10-open-problems.md`: change only if a recurring gap remains after acceptance; otherwise leave the user's existing dirty edit untouched.

- [ ] **Step 5: Commit docs with an exact allowlist**

```powershell
git add -- `
  docs/audit/2026-07-30-stage-c-exact-role-evidence-receipt.md `
  docs/knowledge/02-check-modes.md `
  docs/knowledge/03-job-lifecycle.md `
  docs/knowledge/04-data-sources-tronscan-indexing.md `
  docs/knowledge/09-current-decisions.md `
  docs/knowledge/14-current-roadmap.md
git commit -m "docs: record exact Stage C evidence admission"
git status --short
```

If `10-open-problems.md` was legitimately changed by this work, review the user's pre-existing diff line by line and stage only the new hunk; otherwise do not stage it. Expected final status may still show the user's unrelated original dirty files.

## Acceptance gate

Do not declare this plan complete unless every line is true:

```text
sampled events                  = 200
fully resolved capture events  = 200
fully authorized map events    = 200
missing/conflicts               = []
capture manifest                = exactly 1
completed capture receipt       = exactly 1
poisoning dispositions          = exactly 200
provider-risk dispositions      = exactly 200
evidence bundle                 = exactly 1
service role map                = exactly 1
fullyRoleBoundHistories         >= 1
prerequisite audit exit         = 0
repeat-run hashes               = identical
repeat provider requests        = 0
focused PostgreSQL tests        = pass without skip
typecheck and full suite         = pass
production runtime/config diff  = none
```

## Hard aborts

- Accepted source, manifest/page hashes, exhaustion, anchor, equivalent-state sample, or exact event set cannot be re-proven before provider calls.
- Capture attempts any endpoint other than `transaction-info`, or adds address-history/account/neighbor/graph calls.
- A response lacks matching hash, successful confirmed finality, supported structure, or explicit boolean `riskTransaction`.
- A provider-risk positive belongs to a multi-event transaction without exact event-specific authority.
- A GasFree settlement cannot be matched one-to-one to the canonical event.
- An incoming poisoning comparison has incomplete history or same-timestamp order ambiguity.
- Any event has an unresolved dimension or more than one positive role.
- Any complete-only artifact is proposed before all 200 events resolve.
- A receipt, bundle, or map conflicts with an existing immutable artifact.
- The preserved four-file proof hash changes or overlaps a target change.
- A PostgreSQL proof is skipped, the prerequisite audit is not exit `0`, repeat hashes change, or production runtime/config code differs from the baseline.

At any abort, retain only the immutable capture manifest and already valid raw transaction evidence. Do not synthesize ordinary roles, switch manifests, widen scope, enable runtime, or continue to Stage C Tasks 3-5.
