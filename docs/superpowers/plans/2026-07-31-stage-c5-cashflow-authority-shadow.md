# Stage C5 Cashflow Authority And Runtime Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the smallest production-owned `canonical_tape | unavailable` adapter, freeze the first `/check -> current_balance` query selector, and persist standalone score-neutral cashflow shadow receipts for committed Unified history.

**Architecture:** Reuse the accepted `chronologicalProportionalLedgerV1`, canonical-tape parser, and shadow-artifact builder unchanged. A pure producer admits only exact accepted history, receipt/log identity, authoritative same-block order, genesis-complete history, complete economic-role coverage, and a matching independent pinned balance witness. The runtime observer consumes only local materialized authority after the lifecycle commit; it never fetches a provider page or creates a required task. Missing authority becomes a typed unresolved receipt.

**Tech Stack:** TypeScript, Node.js/tsx, Vitest, PostgreSQL, existing canonical JSON hashing, Unified artifacts, `cashflow-canonical-tape-v1`, `cashflow-shadow-artifact-v1`.

---

## Preconditions and verified code truth

Read `docs/knowledge/AGENT_BRIEF.md`, `03-job-lifecycle.md`, `04-data-sources-tronscan-indexing.md`, `05-where-is-money-and-incoming.md`, `09-current-decisions.md`, `10-open-problems.md`, and `14-current-roadmap.md`, plus the governing Stage C design and the C0/C1 plans.

Verified current code:

- `src/forensics/chronologicalProportionalLedger.ts` already owns chronological reconstruction and proportional largest-remainder allocation.
- `src/forensics/cashflowCanonicalTape.ts` already rejects malformed identity/order/balance bindings and exposes `CashflowAuthorityEnvelopeV1`.
- `src/forensics/cashflowShadowArtifact.ts` already maps a canonical tape to `complete | unresolved | not_applicable` and maps unavailable authority to unresolved.
- The accepted offline corpus is exactly `7/7`; do not change its math or opening-balance model.
- Current `IndexedTronUsdtTransfer`/accepted address history does not carry authoritative `transactionIndex`, and production has no independent pinned USDT balance witness bound to the Unified snapshot. The default production result must therefore be typed unavailable until those local authorities are supplied.
- The PacGy fixture is real but partial and cannot be promoted to authoritative current-balance evidence.

C5 Tasks 1-3 may start only after C0b exits `0` with at least one real complete current-balance feasibility receipt. Task 4 also requires the C1 awaitable post-commit seam to be green. If C0b exits `2`, stop C5 and record the blocker; do not synthesize a balance, infer order, or use report/UI bytes.

This plan changes no score, behavioral candidate, traversal boundary, checked-subject role, finalizer, report, Admin view, or delivery.

## Task 1: Freeze the query selector and producer contract

**Files:**

- Create: `src/unifiedCheck/cashflowQuerySelector.ts`
- Create: `src/unifiedCheck/cashflowAuthorityProducer.ts`
- Test: `tests/unified-check/cashflowQuerySelector.test.ts`
- Test: `tests/unified-check/cashflowAuthorityProducer.test.ts`
- Reference only: `src/forensics/cashflowCanonicalTape.ts`
- Reference only: `src/forensics/chronologicalProportionalLedger.ts`

- [ ] **Step 1: Write red selector tests**

Cover `/check` with an exact snapshot subject, an unsupported check mode, wrong token, malformed subject/snapshot, input-order independence, and attempts to pass score, label, threshold, `amount_only`, or `exact_episode` fields.

```powershell
npx vitest run tests/unified-check/cashflowQuerySelector.test.ts
```

Expected: FAIL because the selector does not exist.

- [ ] **Step 2: Implement one closed selector**

```ts
export type UnifiedCashflowQueryV1 = {
  readonly schemaVersion: "unified-cashflow-query-v1";
  readonly checkMode: "unified_address_check";
  readonly chain: "tron";
  readonly tokenContract: typeof TRON_USDT_CONTRACT_ADDRESS;
  readonly subjectAddress: string;
  readonly snapshotBlockNumber: number;
  readonly snapshotBlockHash: string;
  readonly purpose: "current_balance";
};

export function selectUnifiedCashflowQueryV1(input: unknown): UnifiedCashflowQueryV1;
export function parseUnifiedCashflowQueryV1(value: unknown): UnifiedCashflowQueryV1;
```

The selector uses no threshold, risk score, role, label, or balance value. A zero authoritative balance becomes `not_applicable` only after ledger selection. Missing authority becomes unresolved. Do not add another query variant.

- [ ] **Step 3: Write red producer tests**

Cover:

- one exact genesis-complete current-balance tape;
- missing transaction index/order evidence;
- duplicate receipt/log identity;
- future movement and snapshot mismatch;
- partial history/non-zero opening ambiguity;
- missing, non-independent, unpinned, wrong-subject, wrong-block, wrong-hash, and mismatched balance witnesses;
- incomplete economic-role coverage;
- row permutation/hash stability;
- unknown keys and cross-variant fields;
- rejection of report, Telegram, score, risk-label, and inferred-order inputs.

```powershell
npx vitest run tests/unified-check/cashflowAuthorityProducer.test.ts
```

Expected: FAIL because the producer does not exist.

- [ ] **Step 4: Implement the narrow producer**

```ts
export type CashflowAuthorityProducerInputV1 = {
  readonly tapeId: string;
  readonly query: UnifiedCashflowQueryV1;
  readonly snapshotEvidenceRef: string;
  readonly history: CashflowCanonicalTapeBodyV1["history"];
  readonly movements: CashflowCanonicalTapeBodyV1["movements"];
  readonly snapshotBalanceWitness: {
    readonly amountRaw: string;
    readonly pinned: true;
    readonly independent: true;
    readonly subjectAddress: string;
    readonly snapshotBlockNumber: number;
    readonly snapshotBlockHash: string;
    readonly evidenceRef: string;
  } | null;
  readonly economicRoleCoverage: "complete" | "incomplete";
  readonly evidenceRefs: readonly string[];
};

export function produceCashflowAuthorityV1(
  input: CashflowAuthorityProducerInputV1
): CashflowAuthorityEnvelopeV1;
```

Build a `CashflowCanonicalTapeBodyV1` only from those fields, with query `{ purpose: "current_balance", exactRedContributorLotIds: [] }`. Hash it with `fingerprintCanonicalArtifact`, then return only the result of `parseCashflowAuthorityEnvelopeV1`.

Return these public unavailable reasons before tape construction where authority is absent:

- identity ambiguity -> `canonical_event_identity_unresolved`;
- any missing `transactionIndex`/`orderEvidenceRef` -> `temporal_order_unresolved`;
- partial history or opening balance not exactly zero -> `history_incomplete_before_anchor`;
- missing/non-independent/unpinned balance -> `anchor_balance_witness_missing`;
- balance query/snapshot binding mismatch -> `provider_or_snapshot_inconsistent`.

When several blockers coexist, choose deterministically in this order: identity/finality/snapshot inconsistency, temporal order, pre-anchor history, missing balance witness, balance binding/mismatch. Preserve every supporting reference in the sorted envelope even though only one public reason is primary.

Keep `economicRoleCoverage:"incomplete"` inside an otherwise valid tape so the existing shadow builder yields `economic_role_unresolved`. Do not duplicate ledger math. Add a `ponytail:` comment that V1 supports only genesis-zero USDT current-balance queries; a non-zero opening model requires a new ledger/tape version.

- [ ] **Step 5: Run the pure green set**

```powershell
npx vitest run tests/unified-check/cashflowQuerySelector.test.ts tests/unified-check/cashflowAuthorityProducer.test.ts tests/forensics/chronologicalProportionalLedger.test.ts tests/forensics/cashflowCanonicalTape.test.ts tests/forensics/cashflowShadowArtifact.test.ts
```

Expected: PASS; the existing ledger and shadow hashes remain unchanged.

- [ ] **Step 6: Commit the pure producer slice**

```powershell
git add src/unifiedCheck/cashflowQuerySelector.ts src/unifiedCheck/cashflowAuthorityProducer.ts tests/unified-check/cashflowQuerySelector.test.ts tests/unified-check/cashflowAuthorityProducer.test.ts
git commit -m "feat: produce exact cashflow authority envelopes"
```

## Task 2: Add the bound runtime receipt

**Files:**

- Create: `src/unifiedCheck/cashflowShadowRuntime.ts`
- Test: `tests/unified-check/cashflowShadowRuntime.test.ts`
- Reference only: `src/forensics/canonicalJson.ts`
- Reference only: `src/forensics/cashflowShadowArtifact.ts`

- [ ] **Step 1: Write red receipt/parser tests**

Cover canonical-tape complete, zero-balance not-applicable, unavailable, incomplete role, identity collision, missing order, balance mismatch, two unavailable receipts for different subjects, replay, row permutation, wrong run/manifest/direct-history/snapshot/query binding, unknown keys, duplicate evidence refs, fake empty hashes, cross-variant fields, and tampered output hash.

```powershell
npx vitest run tests/unified-check/cashflowShadowRuntime.test.ts
```

Expected: FAIL because the receipt contract does not exist.

- [ ] **Step 2: Implement `cashflow-shadow-receipt-v1`**

```ts
export type CashflowShadowReceiptV1 = {
  readonly schemaVersion: "cashflow-shadow-receipt-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly runId: string;
    readonly analysisManifestSha256: string;
    readonly acceptedDirectHistoryArtifactSha256: string;
    readonly query: UnifiedCashflowQueryV1;
    readonly selectorPolicyVersion: "cashflow-current-balance-selector-v1";
    readonly ledgerPolicyVersion: "chronological-proportional-ledger-v1";
    readonly capture:
      | { readonly kind: "present"; readonly artifactSha256: string }
      | { readonly kind: "absent"; readonly typedReason: CashflowPublicUnresolvedReasonV1 };
    readonly authorityEnvelopeSha256: string;
    readonly authority:
      | { readonly kind: "canonical_tape"; readonly tapeArtifactSha256: string }
      | {
          readonly kind: "unavailable";
          readonly typedReason: CashflowPublicUnresolvedReasonV1;
          readonly evidenceRefsSha256: string;
        };
    readonly shadowArtifactSha256: string;
    readonly productionEffect: false;
  };
};
```

Hash the canonical result of `parseCashflowAuthorityEnvelopeV1`, including unavailable envelopes. Query identity remains in the receipt so the same unavailable envelope produces different receipt hashes for different subjects/purposes. The parser is closed-world and recomputes every nested hash.

Export the side-effect-free owning parser as `parseCashflowShadowReceiptV1(value)`. C6 imports this function from the contract module; it never imports a CLI or trusts a manifest's schema string.

- [ ] **Step 3: Implement one pure observation function**

```ts
export function buildCashflowShadowReceiptV1(input: {
  readonly runId: string;
  readonly analysisManifestSha256: string;
  readonly acceptedDirectHistoryArtifactSha256: string;
  readonly query: UnifiedCashflowQueryV1;
  readonly capture: CashflowShadowReceiptV1["body"]["capture"];
  readonly authority: CashflowAuthorityEnvelopeV1;
}): {
  readonly shadow: CashflowShadowArtifactV1;
  readonly receipt: CashflowShadowReceiptV1;
};
```

It calls the existing shadow builder exactly once and performs no I/O.

- [ ] **Step 4: Run green tests**

```powershell
npx vitest run tests/unified-check/cashflowShadowRuntime.test.ts tests/forensics/cashflowShadowArtifact.test.ts
```

Expected: PASS with stable hashes.

- [ ] **Step 5: Commit the runtime receipt contract**

```powershell
git add src/unifiedCheck/cashflowShadowRuntime.ts tests/unified-check/cashflowShadowRuntime.test.ts
git commit -m "feat: bind cashflow shadow runtime receipts"
```

## Task 3: Add strict disabled-by-default config

**Files:**

- Modify: `src/config.ts`
- Modify: `tests/config/config.test.ts`

- [ ] **Step 1: Write red parser tests**

Assert unset and `disabled` yield `disabled`; exact `cashflow-current-balance-shadow-v1` enables; empty, whitespace, boolean-like, casing variants, and unknown values throw at startup.

- [ ] **Step 2: Add one parser and config field**

```ts
export type UnifiedCashflowShadowPolicy =
  | "disabled"
  | "cashflow-current-balance-shadow-v1";
```

Add `unifiedCashflowShadowPolicy` to `AppConfig` and parse only `UNIFIED_CASHFLOW_SHADOW_POLICY`. Do not add a second boolean.

- [ ] **Step 3: Run config tests**

```powershell
npx vitest run tests/config/config.test.ts
```

Expected: PASS; existing environment defaults are byte-compatible.

- [ ] **Step 4: Commit strict disabled configuration**

```powershell
git add src/config.ts tests/config/config.test.ts
git commit -m "feat: add strict cashflow shadow policy"
```

## Task 4: Attach a local-only post-commit observer

**Files:**

- Modify: `src/unifiedCheck/worker.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Modify: `src/index.ts`
- Modify: `tests/unified-check/worker.test.ts`
- Modify: `tests/unified-check/productionRuntime.test.ts`
- Create: `tests/unified-check/cashflowShadowRuntime.postgres.test.ts`
- Reference only after C1 lands: `src/unifiedCheck/serviceRoleShadowRuntime.ts`

- [ ] **Step 1: Reuse the C1 post-commit seam**

C1 must make lifecycle observers awaitable and invoke them only after a successful checkpoint/complete commit. Register C5 through that same `runUnifiedTaskCycle.onLifecyclePersisted` seam. If C1 has not landed, implement the generic seam first exactly as specified in the C1 plan; do not create a competing hook.

- [ ] **Step 2: Write red integration tests**

Assert:

- disabled policy performs zero cashflow reads/writes;
- enabled policy observes only successfully persisted `direct_history` completion;
- failed checkpoint, claim loss, precommit handler completion, retry, and cancellation produce no receipt;
- observer reads only a locally supplied/materialized envelope and makes zero provider calls;
- repeated notification/restart is idempotent;
- unavailable authority writes a bound unresolved receipt without fake tape/capture hashes;
- one accepted real-history artifact maps to the exact run/manifest/snapshot/query;
- observer failure is recorded/reconciled without changing the committed task lifecycle;
- a never-settling authority load, artifact insert, or observer promise is aborted at `1_000 ms`, the committed lifecycle result returns on time, and a late resolve/reject is safely consumed;
- releasing a held persistence lock after the outer deadline never creates a late artifact, and concurrent/retried observations converge on exactly one first outcome per run/query identity;
- cashflow artifacts remain absent from accepted attempts and all EvidenceBundleV1 paths.

```powershell
npx vitest run tests/unified-check/worker.test.ts tests/unified-check/productionRuntime.test.ts tests/unified-check/cashflowShadowRuntime.postgres.test.ts
```

Expected: FAIL before runtime composition exists. `TEST_DATABASE_URL` is mandatory for the PostgreSQL file; a skip is not a pass.

- [ ] **Step 3: Add the minimal injected local authority port**

Extend `createUnifiedProductionRuntime` with one optional dependency:

```ts
cashflowShadow?: {
  readonly policy: "cashflow-current-balance-shadow-v1";
  loadLocalAuthority(input: {
    readonly runId: string;
    readonly analysisManifestSha256: string;
    readonly acceptedDirectHistoryArtifactSha256: string;
    readonly query: UnifiedCashflowQueryV1;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly capture: CashflowShadowReceiptV1["body"]["capture"];
    readonly authority: CashflowAuthorityEnvelopeV1;
  }>;
  persistObservation(input: {
    readonly shadow: CashflowShadowArtifactV1;
    readonly receipt: CashflowShadowReceiptV1;
    readonly identitySha256: string;
    readonly signal: AbortSignal;
    readonly remainingBudgetMs: number;
  }): Promise<"inserted" | "reused" | "conflict">;
};
```

The default composition returns typed unavailable while order/balance authority is absent. It may query accepted local artifacts/evidence but imports no Tron client and accepts no provider callback. Persist the shadow and receipt as immutable standalone Unified artifacts with zero accepted-attempt references. Do not add a migration or required task.

Every lifecycle observer receives an `AbortSignal` and is awaited through the single C1 seam with a hard `1_000 ms` wall-clock budget. Before each database operation, pass the remaining outer budget to the persistence port and set `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout` strictly below that remaining budget; abort/cancel the driver query and roll the transaction back when the signal fires. A `Promise.race` without database cancellation is forbidden. Tests hold the advisory/row lock past the outer deadline, let the worker return, then release it and prove no shadow/receipt appears later. No transaction, provider lock, or task lease may survive the deadline. Timeout/failure is failure-contained after the authoritative commit, consumes late promise rejection, and leaves recovery to the idempotent startup sweep.

`identitySha256` is derived from `{runId,analysisManifestSha256,acceptedDirectHistoryArtifactSha256,query}`. In the same short transaction, acquire a transaction-scoped advisory lock for that identity, load all existing C5 receipts for it, and apply first-outcome semantics: zero rows inserts the shadow+receipt atomically; one byte-identical receipt reuses it; any different/multiple receipt returns `conflict` and inserts nothing. Therefore a later availability improvement cannot replace an earlier typed unavailable outcome, and admission/recovery cannot choose a convenient receipt. The replay/DB projection requires exactly one receipt for each enabled complete/unresolved identity and zero for disabled mode.

- [ ] **Step 4: Prove post-commit reconciliation**

Add `reconcileCommittedCashflowShadowV1` to `cashflowShadowRuntime.ts`. One bounded startup sweep loads admitted accepted `direct_history` completions whose standalone cashflow receipt is absent and fills each missing receipt exactly once. The entire sweep—not each row—has one `1_000 ms` deadline; child operations share its `AbortSignal`/remaining budget, so backlog cannot multiply startup latency. A restart resumes idempotently after timeout without changing the committed task. It must not scan per traversal state, mutate the C1 frozen role-map input set, or call a provider.

- [ ] **Step 5: Run the integration green set**

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name a disposable database" }
npx vitest run tests/unified-check/cashflowShadowRuntime.postgres.test.ts
npx vitest run tests/unified-check/worker.test.ts tests/unified-check/productionRuntime.test.ts tests/unified-check/productionFinalizer.postgres.test.ts
```

Expected: PASS with zero skips, zero provider calls from the observer, and zero accepted references. This is the development gate only; the C5-owned JSON execution proof is rerun later from the clean tested source commit in Task 6 and has no dependency on C6's global reporter.

- [ ] **Step 6: Commit runtime integration with knowledge truth**

```powershell
git add src/unifiedCheck/cashflowShadowRuntime.ts src/unifiedCheck/worker.ts src/unifiedCheck/productionRuntime.ts src/index.ts tests/unified-check/cashflowShadowRuntime.test.ts tests/unified-check/worker.test.ts tests/unified-check/productionRuntime.test.ts tests/unified-check/cashflowShadowRuntime.postgres.test.ts docs/knowledge/03-job-lifecycle.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "feat: observe current-balance cashflow after commit"
```

## Task 5: Capture the real complete and unresolved controls

**Files:**

- Create: `src/unifiedCheck/cashflowStageCFoundation.ts`
- Create: `scripts/captureCashflowStageC.ts`
- Create: `tests/scripts/captureCashflowStageC.test.ts`
- Create from reviewed local evidence: `docs/audit/2026-07-stage-c/inputs/cashflow-authority-capture-input-v1.json`
- Create on successful local capture: `docs/audit/2026-07-stage-c/c5/cashflow-stage-c-receipt-v1.json`
- Reference only: the C0b feasibility receipt and `tests/fixtures/forensics/authority/*`

- [ ] **Step 1: Add a bounded local-only CLI**

Support only `verify --input <canonical-json>` and `capture --input <canonical-json> --output <new-file> --confirm`. The canonical input binds the C0b receipt hash and lists exact locally persisted accepted-history, movement, history-closure, order, economic-role, balance, and authority-envelope evidence references for every control. Resolution is capture-time I/O only: the CLI parses each source with its owning parser and embeds its bounded canonical value into the output graph. It never copies a caller's role/order/balance assertion as authority. Reject symlinks, an existing output file, noncanonical JSON, embedded secrets, URLs, provider clients, extra queries, inputs not bound to the C0b authority receipt, an unregistered evidence schema, or a graph above the frozen node/byte caps.

- [ ] **Step 2: Define the self-contained foundation receipt**

```ts
export const CASHFLOW_STAGE_C_CONTROL_SCHEMA_BY_KIND_V1 = {
  accepted_direct_history: "cashflow-stage-c-accepted-direct-history-snapshot-v1",
  history_closure: "cashflow-stage-c-history-closure-evidence-v1",
  movement_set: "cashflow-stage-c-movement-set-v1",
  transaction_order: "cashflow-stage-c-transaction-order-witness-v1",
  economic_roles: "cashflow-stage-c-economic-role-set-v1",
  pinned_independent_balance: "cashflow-stage-c-pinned-independent-balance-witness-v1",
  authority_envelope: "cashflow-stage-c-authority-envelope-snapshot-v1"
} as const;

export type CashflowStageCControlArtifactValueByKindV1 = {
  readonly accepted_direct_history: CashflowStageCAcceptedDirectHistorySnapshotV1;
  readonly history_closure: CashflowStageCHistoryClosureEvidenceV1;
  readonly movement_set: CashflowStageCMovementSetV1;
  readonly transaction_order: CashflowStageCTransactionOrderWitnessV1;
  readonly economic_roles: CashflowStageCEconomicRoleSetV1;
  readonly pinned_independent_balance: CashflowStageCPinnedBalanceWitnessV1;
  readonly authority_envelope: CashflowStageCAuthorityEnvelopeSnapshotV1;
};

export type CashflowStageCEmbeddedControlArtifactV1 = {
  [K in keyof CashflowStageCControlArtifactValueByKindV1]: {
    readonly artifactKind: K;
    readonly schemaVersion: typeof CASHFLOW_STAGE_C_CONTROL_SCHEMA_BY_KIND_V1[K];
    readonly artifactSha256: string;
    readonly dependencySha256s: readonly string[];
    readonly canonicalValue: CashflowStageCControlArtifactValueByKindV1[K];
  }
}[keyof CashflowStageCControlArtifactValueByKindV1];

export type CashflowStageCControlV1 = {
  readonly controlId: string;
  readonly controlClass:
    | "real_current_balance_complete"
    | "pacgy_current_balance_unavailable"
    | "zero_balance"
    | "economic_role_incomplete"
    | "identity_collision"
    | "temporal_order_missing"
    | "balance_binding_mismatch";
  readonly runId: string;
  readonly analysisManifestSha256: string;
  readonly acceptedDirectHistoryArtifactSha256: string;
  readonly query: UnifiedCashflowQueryV1;
  readonly rootAuthorityEnvelopeSha256: string;
  readonly expectedState: "complete" | "not_applicable" | "unresolved";
  readonly expectedReason: CashflowPublicUnresolvedReasonV1 | null;
};

export type CashflowStageCReceiptV1 = {
  readonly schemaVersion: "cashflow-stage-c-receipt-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly c0bFeasibilityReceiptSha256: string;
    readonly ledgerCorpus: {
      readonly expectedCases: 7;
      readonly passedCases: 7;
      readonly corpusSha256: string;
    };
    readonly controlArtifacts: readonly CashflowStageCEmbeddedControlArtifactV1[];
    readonly controls: readonly CashflowStageCControlV1[];
    readonly replayStable: true;
    readonly movementPermutationStable: true;
    readonly productionEffect: false;
  };
};
```

The `(artifactKind, schemaVersion)` mapping is exact: the parser rejects a mismatched pair even if both literals are individually known. Define all seven mapped normalized snapshot types as exact-key types in the same side-effect-free module. Together they contain the full accepted direct-history value and every field needed to reconstruct `CashflowAuthorityProducerInputV1`; no snapshot contains only a path or unresolved hash. `CashflowStageCAuthorityEnvelopeSnapshotV1` contains the exact parsed `CashflowAuthorityEnvelopeV1`. Graph nodes are sorted by `artifactSha256`; dependency hashes are sorted and unique; every dependency exists; every node is reachable from exactly one declared control root or is a shared dependency; cycles, hash aliases with different bytes, and orphan nodes reject.

`parseCashflowStageCReceiptV1(value)` takes exactly one argument and performs no I/O. For every embedded node it selects the code-owned parser/writer from the frozen kind/schema registry, parses `canonicalValue`, serializes it with `canonicalizeArtifactJson` without an added LF, recomputes `artifactSha256 = SHA256(canonicalValueBytes)`, and checks that the typed value's exact hash references equal `dependencySha256s`. It then rebuilds each producer input from the graph, reruns `produceCashflowAuthorityV1`, recomputes the expected state/reason and all invariants, and requires `receiptSha256 = fingerprintCanonicalArtifact(body)`. It never receives a resolver, repository, database handle, path root, or provider. `serializeCashflowStageCReceiptV1(value)` first calls that parser and emits its canonical UTF-8 bytes with no added LF.

- [ ] **Step 3: Require the full control matrix**

The receipt must prove:

- offline ledger corpus `7/7` unchanged;
- at least one real authoritative `current_balance` complete control;
- PacGy as a real current-balance unresolved control using typed missing authority, not its old exact-episode tape as authority;
- zero balance -> `not_applicable`;
- incomplete role -> `unresolved/economic_role_unresolved`;
- identity collision, missing order, and balance mismatch -> separate typed unresolved controls;
- replay and movement permutation preserve hashes.

- [ ] **Step 4: Run capture and verification**

```powershell
node --import tsx scripts/captureCashflowStageC.ts verify --input docs/audit/2026-07-stage-c/inputs/cashflow-authority-capture-input-v1.json
node --import tsx scripts/captureCashflowStageC.ts capture --input docs/audit/2026-07-stage-c/inputs/cashflow-authority-capture-input-v1.json --output docs/audit/2026-07-stage-c/c5/cashflow-stage-c-receipt-v1.json --confirm
```

Expected: exit `0` and one canonical receipt only when the real complete control exists. Exit `2` for an honest missing-authority blocker; do not continue to C6.

The capture command may resolve the external evidence references once, but the published receipt must pass the one-argument offline parser after those source handles are closed. Delete/move the capture input or replace every source resolver with a throwing spy in tests and prove the committed receipt still parses and recomputes identically. The input file is operator provenance, not a C6 authority leaf.

- [ ] **Step 5: Commit the reviewed foundation before runtime admission**

```powershell
git add src/unifiedCheck/cashflowStageCFoundation.ts scripts/captureCashflowStageC.ts tests/scripts/captureCashflowStageC.test.ts docs/audit/2026-07-stage-c/inputs/cashflow-authority-capture-input-v1.json docs/audit/2026-07-stage-c/c5/cashflow-stage-c-receipt-v1.json
git commit -m "docs: freeze the Stage C cashflow foundation"
```

Expected: the committed foundation contains the real complete/unresolved controls and no runtime-admission claim yet.

## Task 6: Non-interference, documentation, and commit

**Files:**

- Create: `scripts/verifyCashflowShadowRuntime.ts`
- Create: `tests/scripts/verifyCashflowShadowRuntime.test.ts`
- Create from the reviewed real controls: `docs/audit/2026-07-stage-c/c5/runtime-replay/cashflow-runtime-replay-input-v1.json`
- Create with separate disposable identities: `docs/audit/2026-07-stage-c/c5/runtime-replay/cashflow-runtime-replay-identity-v1.json`
- Create after a green database projection: `docs/audit/2026-07-stage-c/c5/cashflow-runtime-db-projection-v1.json`
- Create after green replay: `docs/audit/2026-07-stage-c/c5/cashflow-runtime-acceptance-v1.json`
- Modify when behavior lands: `docs/knowledge/03-job-lifecycle.md`
- Modify when behavior lands: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify when behavior lands: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify when behavior lands: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md` only for remaining real authority gaps
- Modify when accepted: `docs/knowledge/14-current-roadmap.md`

- [ ] **Step 1: Implement the replay verifier, prove comparison behavior, and freeze a clean tested source commit**

Write `verifyCashflowShadowRuntime.ts` and its tests before any admission replay. The tests run the same seeded PostgreSQL lifecycle with policy disabled/enabled and compare accepted task/artifact hashes, traversal results, score anchor, report, delivery, and finalizer output byte-for-byte, ignoring only the two standalone C5 artifact kinds. They also cover the strict `prepare | replay | accept` arguments, exact schema cleanup, source/replay separation, nested artifact bytes, deadlines, and no provider path.

Tasks 1-5 have already committed the behavior, matching knowledge truth, and reviewed foundation. Commit only the admission verifier/tests, then freeze the clean tested source boundary:

```powershell
git add scripts/verifyCashflowShadowRuntime.ts tests/scripts/verifyCashflowShadowRuntime.test.ts
git commit -m "test: add cashflow runtime admission replay"
$testedSourceCommit = git rev-parse HEAD
if (git status --porcelain) { throw "C5 tested source commit must be clean" }
```

No reporter, replay contract, runtime artifact, projection, or acceptance receipt generated before this boundary is admissible.

- [ ] **Step 2: Add an isolated real-history runtime replay, database projection, and offline acceptance verifier**

Support exactly three commands:

```text
prepare --tested-source-commit <git-sha> --foundation <canonical-json> --output-root <new-directory> --confirm
replay --tested-source-commit <git-sha> --input <canonical-json> --identity <canonical-json> --postgres-reporter <json> --output <new-file> --confirm
accept --foundation <canonical-json> --db-projection <canonical-json> --output <new-file> --confirm
```

`prepare` is offline and requires `--tested-source-commit` to equal clean `HEAD`. It reads the foundation only through `parseCashflowStageCReceiptV1`, selects the declared real complete and PacGy unresolved control roots from the embedded graph, and writes a strict `cashflow-runtime-replay-input-v1` plus `cashflow-runtime-replay-identity-v1` containing their exact canonical values, separate source identities, and two UUID-suffixed disabled/enabled replay run/request/manifest/task identities. It uses no `DATABASE_URL`, source repository, artifact resolver, or provider. The files state that every imported accepted-history/authority byte is reused unchanged; they do not call the source run successful or mutate it.

`replay` requires `TEST_DATABASE_URL`, validates both reviewed files against their embedded foundation hash/values, and creates two disposable current-schema databases. Through existing repository/worker/runtime APIs it imports only the byte-identical accepted direct-history and local authority artifacts, creates the minimal two-case lifecycle (one authoritative complete control and one typed unavailable real control), and completes the ordinary `direct_history` tasks once with policy disabled and once enabled. Provider adapters are fail-fast spies. Enabled must materialize both standalone runtime receipts; disabled must materialize none. Before dropping only those exact schemas in `finally`, one read-only repeatable-read transaction derives all receipt hashes/reference counts plus enabled/disabled projections from the frozen column list. Thus the projection is produced by real current-worker lifecycle, not by assuming pre-existing production rows or by a disposable unit-test fixture.

The replay also validates `artifacts/stage-c/c5-postgres-vitest.json` as the C5-owned test execution proof: exact file list `[tests/unified-check/cashflowShadowRuntime.postgres.test.ts]`, executed files/tests greater than zero, and failed/skipped/pending/todo equal zero. Before dropping the schemas, the exclusive `cashflow-runtime-db-projection-v1` embeds the exact parsed `cashflow-runtime-replay-input-v1` and `cashflow-runtime-replay-identity-v1` values plus a sorted `runtimeArtifacts` array containing the exact canonical JSON values and SHA-256 values for each complete/unresolved shadow and runtime receipt. The projection binds the foundation hash, database schema/migration identity, tested source commit, exact source-to-replay mappings, every zero-reference count, enabled/disabled projection hashes/equality, provider calls `0`, raw reporter SHA-256, and validated test counts. It leaves no dangling hash that requires a deleted database, source database, reporter, or path resolver.

Define the two owning roots explicitly:

```ts
export const CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1 = {
  replayInput: "c5/runtime-replay/cashflow-runtime-replay-input-v1.json",
  replayIdentity: "c5/runtime-replay/cashflow-runtime-replay-identity-v1.json",
  dbProjection: "c5/cashflow-runtime-db-projection-v1.json"
} as const;

export type CashflowRuntimeArtifactValueByKindV1 = {
  readonly cashflow_shadow: CashflowShadowArtifactV1;
  readonly cashflow_shadow_receipt: CashflowShadowReceiptV1;
};

export type CashflowRuntimeEmbeddedArtifactV1 = {
  [K in keyof CashflowRuntimeArtifactValueByKindV1]: {
    readonly artifactKind: K;
    readonly schemaVersion: K extends "cashflow_shadow"
      ? "cashflow-shadow-artifact-v1"
      : "cashflow-shadow-receipt-v1";
    readonly artifactSha256: string;
    readonly canonicalValue: CashflowRuntimeArtifactValueByKindV1[K];
  }
}[keyof CashflowRuntimeArtifactValueByKindV1];

export type CashflowRuntimeDbProjectionV1 = {
  readonly schemaVersion: "cashflow-runtime-db-projection-v1";
  readonly projectionSha256: string;
  readonly body: {
    readonly testedSourceCommit: string;
    readonly foundationReceiptSha256: string;
    readonly databaseSchemaVersion: string;
    readonly migrationIdentitySha256: string;
    readonly replayInput: CashflowRuntimeReplayInputV1;
    readonly replayIdentity: CashflowRuntimeReplayIdentityV1;
    readonly runtimeArtifacts: readonly CashflowRuntimeEmbeddedArtifactV1[];
    readonly providerCallCount: 0;
    readonly acceptedAttemptReferenceCount: 0;
    readonly acceptedArtifactReferenceCount: 0;
    readonly evidenceBundleReferenceCount: 0;
    readonly scoreAnchorReferenceCount: 0;
    readonly reportReferenceCount: 0;
    readonly deliveryReferenceCount: 0;
    readonly postgresReporterSha256: string;
    readonly executedFileCount: 1;
    readonly executedTestCount: number;
    readonly failedCount: 0;
    readonly skippedCount: 0;
    readonly pendingCount: 0;
    readonly todoCount: 0;
    readonly authoritativeProjectionSha256Disabled: string;
    readonly authoritativeProjectionSha256Enabled: string;
    readonly authoritativeProjectionEqual: true;
    readonly productionEffect: false;
  };
};

export type CashflowShadowRuntimeAcceptanceV1 = {
  readonly schemaVersion: "cashflow-shadow-runtime-acceptance-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly testedSourceCommit: string;
    readonly foundation: {
      readonly receiptSha256: string;
      readonly canonicalValue: CashflowStageCReceiptV1;
    };
    readonly dbProjection: {
      readonly projectionSha256: string;
      readonly canonicalValue: CashflowRuntimeDbProjectionV1;
    };
    readonly acceptedAttemptReferenceCount: 0;
    readonly acceptedArtifactReferenceCount: 0;
    readonly evidenceBundleReferenceCount: 0;
    readonly scoreAnchorReferenceCount: 0;
    readonly reportReferenceCount: 0;
    readonly deliveryReferenceCount: 0;
    readonly providerCallCount: 0;
    readonly authoritativeProjectionEqual: true;
    readonly productionEffect: false;
  };
};
```

`accept` reads the two canonical files, parses them, and embeds their typed values into the acceptance root. `parseCashflowRuntimeDbProjectionV1(value)` recursively parses/reserializes the embedded replay documents and runtime artifacts and recomputes their hashes before requiring `projectionSha256 = fingerprintCanonicalArtifact(body)`. `parseCashflowShadowRuntimeAcceptanceV1(value)` recursively calls the foundation and projection parsers, verifies the nested hashes and cross-bindings, derives every zero/non-interference assertion, and requires `receiptSha256 = fingerprintCanonicalArtifact(body)`. Both parsers take one argument, are side-effect-free, and remain green after the replay schemas, raw reporter, and source database are unavailable.

Export strict side-effect-free owning parsers `parseCashflowRuntimeReplayInputV1(value)`, `parseCashflowRuntimeReplayIdentityV1(value)`, `parseCashflowRuntimeDbProjectionV1(value)`, and `parseCashflowShadowRuntimeAcceptanceV1(value)` plus their same-named `serialize...` counterparts. All serializers use `canonicalizeArtifactJson` with no added LF. Tests prove a whole-source-run clone, source mutation, hand-edited DB claim, wrong source/replay/control/run binding, missing/non-real control, absent enabled runtime receipt, receipt in disabled mode, reporter substitution, zero executed tests, any skip, provider call, projection mismatch, schema-cleanup escape, or corrupt hash exits nonzero.

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name a disposable replay database" }
New-Item -ItemType Directory -Force -Path artifacts/stage-c | Out-Null
npx vitest run tests/unified-check/cashflowShadowRuntime.postgres.test.ts --reporter=json --outputFile=artifacts/stage-c/c5-postgres-vitest.json
node --import tsx scripts/verifyCashflowShadowRuntime.ts prepare --tested-source-commit $testedSourceCommit --foundation docs/audit/2026-07-stage-c/c5/cashflow-stage-c-receipt-v1.json --output-root docs/audit/2026-07-stage-c/c5/runtime-replay --confirm
node --import tsx scripts/verifyCashflowShadowRuntime.ts replay --tested-source-commit $testedSourceCommit --input docs/audit/2026-07-stage-c/c5/runtime-replay/cashflow-runtime-replay-input-v1.json --identity docs/audit/2026-07-stage-c/c5/runtime-replay/cashflow-runtime-replay-identity-v1.json --postgres-reporter artifacts/stage-c/c5-postgres-vitest.json --output docs/audit/2026-07-stage-c/c5/cashflow-runtime-db-projection-v1.json --confirm
node --import tsx scripts/verifyCashflowShadowRuntime.ts accept --foundation docs/audit/2026-07-stage-c/c5/cashflow-stage-c-receipt-v1.json --db-projection docs/audit/2026-07-stage-c/c5/cashflow-runtime-db-projection-v1.json --output docs/audit/2026-07-stage-c/c5/cashflow-runtime-acceptance-v1.json --confirm
```

Expected: exit `0` only after the reviewed real complete/unresolved source controls drive actual enabled runtime receipts in isolated current-worker replay, disabled mode produces none, zero-reference queries and non-interference projection match, provider calls stay zero, both exact schemas are removed, and the C5-owned zero-skip execution proof validates. Exit `2` for honest missing authority and `1` for tampering.

- [ ] **Step 3: Run the full gate**

```powershell
npx vitest run tests/forensics/chronologicalProportionalLedger.test.ts tests/forensics/chronologicalLedgerCorpusReplay.test.ts tests/forensics/cashflowCanonicalTape.test.ts tests/forensics/cashflowShadowArtifact.test.ts tests/unified-check/cashflowQuerySelector.test.ts tests/unified-check/cashflowAuthorityProducer.test.ts tests/unified-check/cashflowShadowRuntime.test.ts tests/unified-check/cashflowShadowRuntime.postgres.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/scripts/verifyCashflowShadowRuntime.test.ts
npm.cmd run typecheck
npm.cmd test
git diff --check
```

Expected: all pass; PostgreSQL file executed with zero skips; enabled/disabled authoritative bytes match; accepted-attempt references to C5 artifacts equal zero.

- [ ] **Step 4: Commit only the generated admission receipts after the green gate**

```powershell
git add docs/audit/2026-07-stage-c/c5/runtime-replay docs/audit/2026-07-stage-c/c5/cashflow-runtime-db-projection-v1.json docs/audit/2026-07-stage-c/c5/cashflow-runtime-acceptance-v1.json docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: record Stage C cashflow runtime admission"
```

Expected: this generated-receipt commit is a direct child of `testedSourceCommit` and changes only the listed audit/knowledge paths. The acceptance receipt continues to name the tested parent, not its own containing commit.

## Hard aborts

- C0b lacks one real complete current-balance authority set.
- Any order is inferred from provider array position, timestamp, or report ordering.
- Any balance is unpinned, not independent, or not bound to exact subject/block/hash.
- Any provider call or required task is added to the shadow observer.
- Any C5 hash enters EvidenceBundleV1, candidates, score, report, finalizer, or delivery.
- Any attempt to add `amount_only`, exact-episode routing, current-exposure score rows, or a non-zero opening-balance algorithm.
