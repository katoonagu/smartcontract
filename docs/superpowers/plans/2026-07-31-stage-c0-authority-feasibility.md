# Stage C0 Authority Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collision-safe provider-request identity V2 and two score-neutral, bounded feasibility receipts that truthfully prove or reject the authority prerequisites for Stage C physical service evidence and cashflow.

**Architecture:** Preserve every V1 identity byte and all production callers. Add an independent V2 builder/cache entrypoint, a code-owned source-population enumerator, and pure receipt builders; a thin operator CLI stores self-contained content-addressed standalone artifacts through the existing Unified artifact store. C0 derives the complete eligible authority universe from frozen exhausted source roots instead of accepting a caller-curated candidate list, never runs the service classifier or selects blind cases, and treats a typed unavailable result as a valid implementation outcome.

**Tech Stack:** TypeScript 5.7, Node.js ESM, Vitest, PostgreSQL, existing canonical JSON hashing, `unified_provider_pages`, and `unified_check_artifacts`.

---

## Execution checkpoint — 2026-07-31

- On `1028c2a7bd14ddfbeb233d681bfec63f32974d13`, Tasks 1-2 are
  implemented and reviewed in `009c5c60`, `65b6dc59`, `3ae832ba` and
  `472b59f9`. V1 identity bytes remain frozen; the additive V2 builder,
  immutable cache reuse and strict provenance schema pass the focused `20/20`
  provider/cache regression and typecheck. No production caller, configuration,
  traversal, finalization, report or score path uses V2.
- Execution stopped before Task 3 created files, tests or a commit. All nine
  required source-query literals and nine artifact-kind literals below exist
  only in this plan. There are no exact owning schema versions, codecs,
  fixtures or real producers for inventory/leaf rows, joins/eligibility/
  candidate derivation, provider exhaustion, or historical EOA, transaction
  order, role, subject/control and adverse-witness formats.
- Guard: do not invent private codecs, caller-authored source graphs or
  synthetic complete authority. C0a and C2-C4 remain blocked until a separately
  reviewed amendment freezes the exact owning schemas and connects real
  producers. C0b has not started; authoritative order and independent pinned
  balance remain unavailable.
- C0 and Stage C are not complete or accepted. Current production remains
  matrix-v4/ScoreAnchorV3 with no traversal, scoring or delivery effect.

## Verified truth and scope

- Baseline commit for the approved design is `4ec5cabbd63aba71fa9cc160692057d462476c83`; the design commit is `c4fe5d52143002dc19c6a611f9cddb7ee50e60ca`.
- `buildProviderRequestIdentity()` in `src/unifiedCheck/providerRequest.ts` is V1 production authority. Its canonical JSON and SHA-256 must not change.
- `loadOrFetchProviderPage()` already supplies immutable cache reuse and in-process coalescing through `ProviderPageStore`.
- `unified_provider_pages` is keyed by request SHA-256, so V2 needs no migration.
- `insertUnifiedArtifact()` in `src/unifiedCheck/repository.ts` already performs content-hash verification and conflict-safe insertion.
- Current account metadata is current-only. It cannot prove `EOAAtAnchor`.
- `IndexedTronUsdtTransfer` has no authoritative `transactionIndex`; provider row order is not a substitute.
- Current snapshots have no independent pinned USDT balance witness.
- C0 is score-neutral and has no production traversal, finalizer, Admin, Telegram, delivery, configuration, or Stage D wiring.

## Preconditions

1. Work from the clean dedicated worktree on `master`, never from the dirty historical checkout.
2. Run `git status --short --branch`; expected branch is `master` and no unrelated changes are present beyond this plan series.
3. Run the baseline focused suite before implementation:

   ```powershell
   npm test -- tests/unified-check/providerRequest.test.ts tests/unified-check/canonicalArtifacts.test.ts
   ```

   Expected: both files pass.
4. Read `docs/knowledge/AGENT_BRIEF.md`, `02-check-modes.md`, `04-data-sources-tronscan-indexing.md`, `05-where-is-money-and-incoming.md`, `07-risk-scoring-matrix.md`, `09-current-decisions.md`, `10-open-problems.md`, `14-current-roadmap.md`, and the approved Stage C design before editing.

## Locked file map

**Create**

- `src/forensics/stageCAuthorityFeasibility.ts` — pure source-root graph parser, deterministic population enumerator, receipt builders, validation, quota accounting, and typed blocker semantics.
- `scripts/captureStageCAuthorityFeasibility.ts` — argument parsing, canonical input reading, transaction-scoped standalone artifact persistence, and deterministic stdout receipt.
- `tests/forensics/stageCAuthorityFeasibility.test.ts` — pure receipt and validation tests.
- `tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts` — real artifact-store isolation/idempotence test.

**Modify**

- `src/unifiedCheck/providerRequest.ts` — additive V2 types, builder, validator, and cache entrypoint; V1 remains byte-compatible.
- `tests/unified-check/providerRequest.test.ts` — V1 frozen hash plus V2 collision/cache tests.
- `docs/knowledge/04-data-sources-tronscan-indexing.md` — record V2 identity and that it is not production-selected.
- `docs/knowledge/09-current-decisions.md` — record C0 receipt outcome and dependency impact.
- `docs/knowledge/10-open-problems.md` — close only authority sources actually proven; keep typed blockers.
- `docs/knowledge/14-current-roadmap.md` — mark C0a/C0b individually passed or blocked.

**Must not modify**

- `src/index.ts`, `src/unifiedCheck/productionRuntime.ts`, traversal/finalizer/scoring/report/Admin/Telegram files, migrations, matrix-v4, or ScoreAnchorV3.

## Contracts to implement

```ts
export type ProviderRequestWindowKindV2 = "recent" | "historical";

export type ProviderRequestIdentityV2Input = Omit<
  ProviderRequestIdentityInput,
  "cursor"
> & {
  readonly windowKind: ProviderRequestWindowKindV2;
  readonly timestampStartInclusiveMs: string;
  readonly timestampEndInclusiveMs: string;
  readonly pageOffset: number;
};

export type ProviderRequestIdentityV2 = Omit<
  ProviderRequestIdentity,
  "version" | "cursor"
> & {
  readonly version: "provider-request-identity-v2";
  readonly windowKind: ProviderRequestWindowKindV2;
  readonly timestampStartInclusiveMs: string;
  readonly timestampEndInclusiveMs: string;
  readonly pageOffset: number;
};

export function buildProviderRequestIdentityV2(
  input: ProviderRequestIdentityV2Input
): { identity: ProviderRequestIdentityV2; canonicalJson: string; sha256: string };

export type ProviderFetchResultV2 = Omit<ProviderFetchResult, "cursor"> & {
  readonly pageOffset: number;
};

export async function loadOrFetchProviderPageV2(input: {
  identity: ProviderRequestIdentityV2Input;
  store: ProviderPageStore;
  fetchPage: () => Promise<ProviderFetchResultV2>;
  onDiagnostic?: (diagnostic: ProviderPageDiagnostic) => void;
}): Promise<ProviderPageRecord>;
```

V2 validates unsigned decimal millisecond bounds, `start <= end`, safe integer offset `>= 0`, and the same block/snapshot/address/provider rules as V1. API credentials, route anchor, sampling policy, behavior policy, and classifier output are excluded.

```ts
export const STAGE_C_PHYSICAL_POPULATION_QUOTAS_V1 = {
  intermediate_complete: 15,
  checked_subject_control: 3,
  contract_at_anchor_control: 3,
  authority_incomplete_control: 3
} as const;

export const STAGE_C_ADVERSE_AUTHORITY_CLASSES_V1 = [
  "event_time_blacklist",
  "active_sanctions_or_restriction",
  "tracked_drainer_or_collector",
  "exact_restricted_service",
  "verify20_terminal",
  "exact_bound_nonterminal"
] as const;

export type StageCAuthorityEvidenceStateV1 =
  | { readonly state: "available"; readonly evidenceSha256: string }
  | {
      readonly state: "unavailable";
      readonly reason:
        | "source_not_supported"
        | "historical_eoa_unavailable"
        | "transaction_order_unavailable"
        | "pinned_balance_unavailable"
        | "population_quota_unmet"
        | "authority_binding_incomplete";
    };

export const STAGE_C_PHYSICAL_SOURCE_ENUMERATION_POLICY_V1 =
  "stage-c-physical-source-enumeration-v1" as const;

export const STAGE_C_PHYSICAL_REQUIRED_SOURCE_QUERIES_V1 = [
  "accepted_history_inventory",
  "recent_provider_page_chain",
  "historical_provider_page_chain",
  "historical_account_witness_inventory",
  "transaction_order_witness_inventory",
  "economic_role_witness_inventory",
  "checked_subject_witness_inventory",
  "contract_at_anchor_witness_inventory",
  "adverse_authority_witness_inventory"
] as const;

export type StageCPhysicalSourceArtifactKindV1 =
  | "accepted_history_inventory"
  | "provider_page_v2"
  | "provider_page_chain_receipt"
  | "historical_account_witness"
  | "transaction_order_witness"
  | "economic_role_witness"
  | "checked_subject_witness"
  | "contract_at_anchor_witness"
  | "adverse_authority_witness";

export type StageCPhysicalSourceArtifactNodeV1 = {
  readonly artifactKind: StageCPhysicalSourceArtifactKindV1;
  readonly schemaVersion: string;
  readonly artifactSha256: string;
  readonly dependencySha256s: readonly string[];
  readonly canonicalValue: unknown;
};

export const STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH =
  "docs/audit/2026-07-stage-c/inputs/physical-source-authority-v1.json" as const;

export type StageCPhysicalSourceAuthorityManifestV1 = {
  readonly schemaVersion: "stage-c-physical-source-authority-manifest-v1";
  readonly auditRunId: string;
  readonly populationCutoffBlock: string;
  readonly populationCutoffTimestamp: string;
  readonly sourceRoots: readonly {
    readonly queryKind:
      typeof STAGE_C_PHYSICAL_REQUIRED_SOURCE_QUERIES_V1[number];
    readonly queryIdentitySha256: string;
    readonly artifactSha256: string;
  }[];
  readonly nodes: readonly StageCPhysicalSourceArtifactNodeV1[];
  readonly classifierExecuted: false;
  readonly productionEffect: false;
};

export type StageCPhysicalPopulationEnumerationBundleV1 = {
  readonly schemaVersion: "stage-c-physical-population-enumeration-bundle-v1";
  readonly policyVersion: typeof STAGE_C_PHYSICAL_SOURCE_ENUMERATION_POLICY_V1;
  readonly sourceAuthorityCommit: string;
  readonly sourceAuthorityManifestSha256: string;
  readonly sourceAuthorityManifest: StageCPhysicalSourceAuthorityManifestV1;
};

export function parseStageCPhysicalSourceAuthorityManifestV1(
  value: unknown
): StageCPhysicalSourceAuthorityManifestV1;

export function serializeStageCPhysicalSourceAuthorityManifestV1(
  value: StageCPhysicalSourceAuthorityManifestV1
): string;

declare const validatedStageCPhysicalPopulationEnumerationV1: unique symbol;
export type ValidatedStageCPhysicalPopulationEnumerationV1 =
  StageCPhysicalPopulationEnumerationBundleV1 & {
    readonly [validatedStageCPhysicalPopulationEnumerationV1]: true;
  };

export function parseStageCPhysicalPopulationEnumerationBundleV1(
  value: unknown
): ValidatedStageCPhysicalPopulationEnumerationV1;

export function enumerateStageCPhysicalPopulationV1(
  source: ValidatedStageCPhysicalPopulationEnumerationV1
): {
  readonly sourceDatasetSha256s: readonly string[];
  readonly candidates: readonly StageCPhysicalFeasibilityCandidateV1[];
  readonly adverseCandidates: readonly StageCAdverseFeasibilityCandidateV1[];
};

export type StageCPhysicalPopulationFeasibilityInputV1 = {
  readonly sourcePopulation:
    ValidatedStageCPhysicalPopulationEnumerationV1;
};

export type StageCCashflowAuthorityFeasibilityInputV1 = {
  readonly controls: readonly StageCCashflowFeasibilityControlV1[];
};

export type StageCPhysicalFeasibilityCandidateV1 = {
  readonly candidateId: string;
  readonly stratum: keyof typeof STAGE_C_PHYSICAL_POPULATION_QUOTAS_V1;
  readonly profiledAddress: string;
  readonly capturedSubjectAddress: string;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly anchorEventId: string;
  readonly physicalPages: StageCAuthorityEvidenceStateV1;
  readonly transactionOrder: StageCAuthorityEvidenceStateV1;
  readonly economicRoles: StageCAuthorityEvidenceStateV1;
  readonly eoaAtAnchor: StageCAuthorityEvidenceStateV1;
  readonly checkedSubjectWitness: StageCAuthorityEvidenceStateV1;
  readonly contractAtAnchorWitness: StageCAuthorityEvidenceStateV1;
  readonly deliberateGap: null | {
    readonly kind: "short_pages" | "eoa_unknown" | "order_conflict" |
      "role_conflict";
    readonly evidenceSha256: string;
  };
};

export type StageCAdverseFeasibilityCandidateV1 = {
  readonly authorityClass: typeof STAGE_C_ADVERSE_AUTHORITY_CLASSES_V1[number];
  readonly candidateId: string;
  readonly address: string;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly exactAuthority: StageCAuthorityEvidenceStateV1;
};

export type StageCCashflowFeasibilityControlV1 = {
  readonly controlId: string;
  readonly sourceKind: "accepted_real_history";
  readonly runId: string;
  readonly analysisManifestSha256: string;
  readonly acceptedDirectHistoryArtifactSha256: string;
  readonly subjectAddress: string;
  readonly tokenContract: typeof TRON_USDT_CONTRACT_ADDRESS;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly historyClosureEvidenceSha256: string;
  readonly exactMovementEvidenceSha256s: readonly string[];
  readonly transactionOrderWitness: StageCAuthorityEvidenceStateV1;
  readonly pinnedIndependentBalanceWitness: StageCAuthorityEvidenceStateV1;
};

export type StageCPhysicalPopulationFeasibilityReceiptV1 = {
  readonly schemaVersion: "stage-c-physical-population-feasibility-v1";
  readonly sourcePopulation: StageCPhysicalPopulationEnumerationBundleV1;
  readonly sourceDatasetSha256s: readonly string[];
  readonly populationCutoffBlock: string;
  readonly populationCutoffTimestamp: string;
  readonly candidates: readonly StageCPhysicalFeasibilityCandidateV1[];
  readonly quotaCounts: Readonly<Record<
    keyof typeof STAGE_C_PHYSICAL_POPULATION_QUOTAS_V1,
    number
  >>;
  readonly adverseCandidates: readonly StageCAdverseFeasibilityCandidateV1[];
  readonly blockers: readonly string[];
  readonly complete: boolean;
  readonly classifierExecuted: false;
  readonly blindCasesSelected: false;
  readonly productionEffect: false;
};

export type StageCCashflowAuthorityFeasibilityReceiptV1 = {
  readonly schemaVersion: "stage-c-cashflow-authority-feasibility-v1";
  readonly controls: readonly StageCCashflowFeasibilityControlV1[];
  readonly controlsInspected: number;
  readonly completeRealCurrentBalanceControls: number;
  readonly typedUnavailableRealControls: number;
  readonly blockers: readonly string[];
  readonly complete: boolean;
  readonly productionEffect: false;
};

export function buildStageCPhysicalPopulationFeasibilityReceiptV1(
  input: StageCPhysicalPopulationFeasibilityInputV1
): StageCPhysicalPopulationFeasibilityReceiptV1;

export function buildStageCCashflowAuthorityFeasibilityReceiptV1(
  input: StageCCashflowAuthorityFeasibilityInputV1
): StageCCashflowAuthorityFeasibilityReceiptV1;

export function validateStageCAuthorityFeasibilityReceiptV1(
  value: unknown
): StageCPhysicalPopulationFeasibilityReceiptV1 |
  StageCCashflowAuthorityFeasibilityReceiptV1;

export function parseStageCPhysicalPopulationFeasibilityV1(
  value: unknown
): StageCPhysicalPopulationFeasibilityReceiptV1;

export function parseStageCCashflowAuthorityFeasibilityV1(
  value: unknown
): StageCCashflowAuthorityFeasibilityReceiptV1;
```

The builders derive `complete`; callers never supply it. The physical builder accepts only the opaque validated enumeration bundle, not candidate arrays. Its exact side-effect-free receipt parser recursively reparses and reserializes the embedded source graph, reruns the code-owned enumerator, requires canonical equality with every persisted candidate/adverse row, and recomputes all counts/blockers/`complete`. The cashflow parser does the equivalent for its own controls. These are the owning APIs used by C2/C5/C6; the union validator is only a convenience dispatcher. Export paired `serializeStageCPhysicalPopulationFeasibilityV1` and `serializeStageCCashflowAuthorityFeasibilityV1` writers using `canonicalizeArtifactJson` with no added LF. They reject extra keys, duplicate candidate IDs, any global collision on candidate/address/snapshot/captured-subject identity, invalid hashes/timestamps/blocks, and any input containing classifier status, C/B/G/H/R/X, expected action, or score.

The source-bundle parser first requires `sourceAuthorityManifestSha256 = fingerprintCanonicalArtifact(sourceAuthorityManifest)` and exact `STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH` provenance. The operational CLI additionally reads that blob with `git show <sourceAuthorityCommit>:<fixed-path>`, requires byte equality with the embedded manifest, requires `sourceAuthorityCommit` to be an ancestor of the clean tested implementation commit, and verifies that the commit which first added the manifest changed only the fixed source-authority/verification/knowledge allowlist. C6 repeats this Git-object check. A new or smaller manifest therefore needs a separately visible reviewed source-authority commit; it cannot be substituted by recomputing the C0 receipt.

Within that immutable authority manifest, the parser derives the complete expected root set itself from `STAGE_C_PHYSICAL_REQUIRED_SOURCE_QUERIES_V1` and canonical `SHA256({policyVersion,auditRunId,populationCutoffBlock,populationCutoffTimestamp,queryKind})`. It requires exactly one root in constant order for every query kind and no other root; callers cannot supply a smaller query list. It then uses a frozen `(artifactKind,schemaVersion) -> owning parser/serializer/enumerator adapter` registry, validates every canonical node and dependency hash, requires every root and node reachable, and rejects cycles/orphans/aliases. Provider page chains start at the frozen first offset, have no gaps or duplicates, bind V2 request identities and raw page hashes, and end only at an owning-parser-validated exhausted/terminal receipt; repository inventories bind the derived audit-run/cutoff query identity, returned row count, sorted primary-key/hash projection, and query-complete marker. No generic `candidate_source`, caller candidate row, caller query/root list, quota, rank, classifier result, or expected action is an allowed source node. The enumerator visits every eligible source row in the reviewed authority manifest under the fixed cutoff and derives both candidate arrays; removing an eligible row/page or an entire root/query while retaining the committed manifest makes the manifest bytes, required-set, chain, count, or root hash check fail. “Full universe” in C0-C4 always means this full frozen, reviewed source-authority universe; the plans make no unverifiable claim about addresses outside its declared upstream sources.

The physical builder then validates each derived stratum, not just counts: intermediate requires distinct non-subject plus available pages/order/roles/historical EOA and no deliberate gap; checked-subject requires exact subject equality and its witness; contract requires the contract-at-anchor witness; incomplete requires exactly one named gap matching the unavailable authority. Every adverse class requires a distinct event/snapshot-bound available authority candidate. The receipt embeds the bounded source graph and preserves the complete sorted derived inventory so its one-argument parser and C2/C4/C6 can independently recompute completeness, quotas, and exclusions without the capture database.

The cashflow builder and CLI resolve every referenced hash through strict local witness parsers. A complete control requires the same accepted real run/manifest/direct-history, subject, token, block, and block hash on history closure, all movement/order witnesses, and the independent pinned balance witness. A typed-unavailable real control uses the same accepted-real-history binding but has at least one exact unavailable order/balance state and no contradictory available assertion. Two unrelated available hashes or caller-provided counts never form a control. The receipt preserves all controls and derives all three counts. `complete:true` requires at least one complete real current-balance control **and** at least one distinct typed-unavailable real control; neither can substitute for the other.

### Task 1: Freeze V1 and add provider-request identity V2

**Files:**
- Modify: `tests/unified-check/providerRequest.test.ts`
- Modify: `src/unifiedCheck/providerRequest.ts`

- [x] **Step 1: Add a failing frozen V1 compatibility test**

Use the existing `base` fixture and assert both exact canonical JSON and the current SHA-256. First print the current values once from the unmodified builder, paste them as literals, then remove the print. Also assert the V1 object has no V2 keys.

- [x] **Step 2: Run the V1 test before editing production code**

Run:

```powershell
npm test -- tests/unified-check/providerRequest.test.ts -t "keeps provider-request-identity-v1 bytes frozen"
```

Expected: PASS on the baseline. Abort if it fails; do not redefine the baseline from a changed tree.

- [x] **Step 3: Add failing V2 validation and collision tests**

Cover distinct hashes for `windowKind`, `timestampEndInclusiveMs`, and `pageOffset`; equal hashes when only `apiKey/apiKeyIndex` or a route-anchor value outside the identity changes; invalid decimal bounds, reversed time, negative/non-integer offset, and unknown window kind.

- [x] **Step 4: Run the new V2 tests**

Run:

```powershell
npm test -- tests/unified-check/providerRequest.test.ts -t "provider-request-identity-v2"
```

Expected: FAIL because `buildProviderRequestIdentityV2` is not exported.

- [x] **Step 5: Implement the minimal V2 builder**

Reuse the current address/text/raw/hash validation helpers. Add a safe offset validator and build a new object literal in the exact field order defined by the contract. Do not route V1 through V2.

- [x] **Step 6: Run the complete provider identity file**

Run:

```powershell
npm test -- tests/unified-check/providerRequest.test.ts
```

Expected: all tests PASS, including the frozen V1 literal.

- [x] **Step 7: Commit the identity contract**

```powershell
git add src/unifiedCheck/providerRequest.ts tests/unified-check/providerRequest.test.ts
git commit -m "feat: add Stage C provider request identity v2"
```

### Task 2: Reuse the immutable provider-page cache for V2

**Files:**
- Modify: `tests/unified-check/providerRequest.test.ts`
- Modify: `src/unifiedCheck/providerRequest.ts`

- [x] **Step 1: Add failing V2 cache tests**

Test one network call for concurrent identical V2 requests, a later cache hit, distinct storage rows for recent/historical and offsets, and one shared cache row for two different probe anchors that produce identical HTTP identity bytes. Require provenance to preserve the full credential-free V2 identity object plus its canonical JSON/hash; tampering any identity field while retaining the old hash must reject the cache row.

- [x] **Step 2: Prove the tests fail**

Run:

```powershell
npm test -- tests/unified-check/providerRequest.test.ts -t "loads provider-request-identity-v2 pages"
```

Expected: FAIL because `loadOrFetchProviderPageV2` is missing.

- [x] **Step 3: Extract only the version-neutral cache core**

Add a private helper receiving `{ identity, canonicalJson, sha256 }` and a version-specific fetched-result validator. Keep the public V1 implementation and diagnostics unchanged. V2 stores the complete credential-free `ProviderRequestIdentityV2`, its canonical JSON/hash, and `pageOffset` in provenance; `validateStoredV2` reparses the identity and recomputes the hash before accepting raw payload bytes. Route anchor and classifier fields remain absent.

- [x] **Step 4: Run cache and V1 regression tests**

```powershell
npm test -- tests/unified-check/providerRequest.test.ts tests/unified-check/productionAddressHistory.test.ts
```

Expected: both files PASS and production direct history continues to call V1.

- [x] **Step 5: Commit cache reuse**

```powershell
git add src/unifiedCheck/providerRequest.ts tests/unified-check/providerRequest.test.ts
git commit -m "feat: cache Stage C provider pages by v2 identity"
```

### Task 3: Build physical-population feasibility receipts

**Files:**
- Create: `tests/forensics/stageCAuthorityFeasibility.test.ts`
- Create: `src/forensics/stageCAuthorityFeasibility.ts`

> **Execution blocker — stop before Step 1:** The nine required query literals
> and nine artifact-kind literals in this plan have no exact owning schema
> versions, codecs, fixtures or real producers. The plan also leaves
> inventory/leaf rows, joins/eligibility/candidate derivation, exhaustion and
> EOA/order/role/control/adverse-witness formats unfrozen. Do not create private
> codecs or synthetic complete authority. Resume only after a separately
> reviewed amendment defines those contracts and their real producers.

- [ ] **Step 1: Write failing quota and forbidden-field tests**

Construct an exhausted, content-addressed over-quota source graph that derives 16/4/4/4 globally distinct, fully bound source-authority candidates and two distinct available entries for each adverse class. Assert the derived counts, `complete=true`, and byte-for-byte preservation of every sorted candidate: C0 must not trim, rank, or preselect the future blind quota. Delete one otherwise eligible source row/page while leaving the owning inventory count/page-chain terminal receipt unchanged and assert rejection. Also remove one whole internally consistent root/query while the remaining roots still exceed quotas and assert required-root-set rejection. Rebuild a genuinely complete smaller source graph below a minimum and assert typed `population_quota_unmet`. Add a missing/gapped/duplicate page, false exhaustion, wrong query identity, duplicate/missing/extra required query, orphan/root alias, unknown kind/schema, cross-stratum address/snapshot/captured-subject collision, wrong subject/control equality, a gap that does not match its unavailable authority, or an extra `classifierStatus` key and assert rejection/blocking.

- [ ] **Step 2: Run the pure tests**

```powershell
npm test -- tests/forensics/stageCAuthorityFeasibility.test.ts -t "physical population"
```

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement strict parsing and deterministic counting**

Implement the exact source-kind/schema registry and validate/re-hash the complete embedded graph through owning parsers. Require gapless terminal provider chains and complete fixed-query repository inventories, enumerate every eligible row under the cutoff, canonical-sort the derived population, enforce global uniqueness by candidate ID/address/snapshot/captured subject, and derive every stratum count from those rows. Persist the self-contained graph and its root hashes plus typed blockers. These are feasibility-universe entries, not selected blind cases. Emit no caller candidates, classifier fields, quotas-as-selection, expected class/action, or score.

- [ ] **Step 4: Run the physical receipt tests**

```powershell
npm test -- tests/forensics/stageCAuthorityFeasibility.test.ts -t "physical population"
```

Expected: PASS with deterministic hashes under input reorder.

- [ ] **Step 5: Commit the C0a contract**

```powershell
git add src/forensics/stageCAuthorityFeasibility.ts tests/forensics/stageCAuthorityFeasibility.test.ts
git commit -m "feat: add Stage C physical authority feasibility receipt"
```

### Task 4: Build cashflow feasibility receipts

**Files:**
- Modify: `tests/forensics/stageCAuthorityFeasibility.test.ts`
- Modify: `src/forensics/stageCAuthorityFeasibility.ts`

- [ ] **Step 1: Add failing C0b controls**

Test a complete real control only when accepted run/manifest/direct-history, closure, every movement/order witness, and independent pinned balance are all available and bound to the same subject/token/snapshot. Add a distinct accepted-real-history control with one exact unavailable order/balance reason and assert `typedUnavailableRealControls:1`. Either control missing keeps `complete:false`. Test two unrelated available hashes, caller-forged counts, current balance, provider row ordinal, a balance observed at another subject/snapshot, or one control presented as both complete and unavailable as rejection/typed blocker.

- [ ] **Step 2: Run the C0b tests**

```powershell
npm test -- tests/forensics/stageCAuthorityFeasibility.test.ts -t "cashflow authority"
```

Expected: FAIL before the cashflow builder exists.

- [ ] **Step 3: Implement the minimal C0b builder**

Resolve every local evidence hash through its strict parser. Require at least one accepted-real-history control with exact matching run/manifest/direct-history/subject/token/snapshot binding, authoritative transaction order for all movements, history closure, and independent pinned balance evidence, plus one distinct accepted-real-history control whose unavailable state is proved by its owning order/balance witness. Preserve the controls, derive all three counts/blockers/`complete`, and never infer missing fields.

- [ ] **Step 4: Run the complete pure suite**

```powershell
npm test -- tests/forensics/stageCAuthorityFeasibility.test.ts
```

Expected: PASS, including explicit C0a/C0b independence.

- [ ] **Step 5: Commit the C0b contract**

```powershell
git add src/forensics/stageCAuthorityFeasibility.ts tests/forensics/stageCAuthorityFeasibility.test.ts
git commit -m "feat: add Stage C cashflow authority feasibility receipt"
```

### Task 5: Add the standalone capture CLI and PostgreSQL isolation proof

**Files:**
- Create: `scripts/captureStageCAuthorityFeasibility.ts`
- Create: `tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts`
- Create as ignored operator input from reviewed query bounds: `artifacts/stage-c/c0/physical-source-capture-v1.json`
- Create from the code-owned source queries: `docs/audit/2026-07-stage-c/inputs/physical-source-authority-v1.json`
- Create from reviewed inventories: `docs/audit/2026-07-stage-c/inputs/physical-population-feasibility-input-v1.json`
- Create from reviewed inventories: `docs/audit/2026-07-stage-c/inputs/cashflow-authority-feasibility-input-v1.json`

- [ ] **Step 1: Write failing argument/parser and PostgreSQL tests**

Import the CLI functions without executing `main`. Test strict commands `freeze-physical-source`, `physical`, and `cashflow`, canonical JSON input, owning-parser resolution of every physical source root, exhaustive fixed-query/page-chain capture, omission rejection from an over-quota source, exact source-authority Git blob/ancestor/allowlist validation, idempotent insertion, hash conflict rejection, one-argument offline receipt verification after disconnecting PostgreSQL, and queries proving no row in `unified_check_attempts.artifact_sha256` references either receipt and no task selects such an attempt through `accepted_attempt_id`.

- [ ] **Step 2: Run the tests against a disposable PostgreSQL database**

```powershell
npm test -- tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts
```

Expected: FAIL because the CLI module is absent. If the file skips for database readiness, stop: a skipped file is not C0 PostgreSQL proof.

- [ ] **Step 3: Implement the CLI**

Export `parseStageCAuthorityFeasibilityArgs(argv)` and `runStageCAuthorityFeasibilityCapture(command,deps)`. Support only `freeze-physical-source --input <canonical-json> --output <fixed-path> --confirm`, `physical --source-authority-commit <git-sha> --input <canonical-json> --output <new-file> --confirm`, and `cashflow --input <canonical-json> --output <new-file> --confirm`. `freeze-physical-source` requires a clean implementation commit; its strict input contains only `auditRunId` and cutoff. Code derives the exact required query identities, resolves each through its owning adapter, exhausts every fixed provider/repository query, and publishes the canonical authority manifest exclusively at `STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH`; it accepts no root list or candidate row. `physical` requires that manifest already exist in `sourceAuthorityCommit`, validates its Git bytes/commit allowlist, builds the self-contained enumeration bundle around those exact bytes, calls its parser/enumerator, and only then calls the pure receipt builder. It never accepts source-root/query lists, `candidates`, or `adverseCandidates`. The cashflow envelope contains its one receipt input and bounded local evidence references. Insert only the final results as kind `stage_c_physical_population_feasibility` or `stage_c_cashflow_authority_feasibility`, schema `1`, create every output exclusively, then print only bounded hash/status counts.

- [ ] **Step 4: Re-run unit and PostgreSQL tests**

```powershell
npm test -- tests/forensics/stageCAuthorityFeasibility.test.ts tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts
```

Expected: both files PASS; PostgreSQL executed tests `> 0`, skipped `= 0`.

- [ ] **Step 5: Commit the capture path**

```powershell
git add scripts/captureStageCAuthorityFeasibility.ts tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts
git commit -m "feat: persist Stage C authority feasibility receipts"
```

### Task 6: Record the honest C0 result and run release verification

**Files:**
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`
- Modify: `docs/knowledge/14-current-roadmap.md`

- [ ] **Step 1: Freeze and commit the reviewed physical source authority before enumeration**

Run only from the clean Task 5 implementation commit. `freeze-physical-source` executes the exact code-owned query set and publishes no candidates, classifier output, quota selection, or expected action. Review the complete query/page/root inventory, then commit only the fixed manifest and the three source-status knowledge pages as the direct child of the implementation commit.

```powershell
if (git status --porcelain) { throw "source authority capture requires clean implementation commit" }
$sourceProducerCommit=(git rev-parse HEAD).Trim()
node --import tsx scripts/captureStageCAuthorityFeasibility.ts freeze-physical-source --input artifacts/stage-c/c0/physical-source-capture-v1.json --output docs/audit/2026-07-stage-c/inputs/physical-source-authority-v1.json --confirm
git add docs/audit/2026-07-stage-c/inputs/physical-source-authority-v1.json docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: freeze Stage C physical source authority"
$sourceAuthorityCommit=(git rev-parse HEAD).Trim()
if ((git rev-parse HEAD^).Trim() -ne $sourceProducerCommit -or (git status --porcelain)) { throw "invalid source authority commit boundary" }
```

Expected: the manifest contains every exact required root/query and raw authority graph under one reviewed hash, its commit changes only the four allowlisted paths, and no model field exists. A smaller or changed upstream universe requires a new explicit source-authority commit and a new C0/C2-C4 run; it cannot silently replace this manifest.

- [ ] **Step 2: Execute C0 only with the frozen source authority and reviewed cashflow controls**

Run the CLI against the exact manifest blob in `$sourceAuthorityCommit` and the reviewed cashflow controls. Record exact commands, source-authority commit/hash, input SHA-256, implementation Git commit, receipt SHA-256, complete/unavailable counts, blockers, PostgreSQL schema, and timestamp. Never use a synthetic fixture as a passing operational receipt.

```powershell
node --import tsx scripts/captureStageCAuthorityFeasibility.ts physical --source-authority-commit $sourceAuthorityCommit --input docs/audit/2026-07-stage-c/inputs/physical-population-feasibility-input-v1.json --output docs/audit/2026-07-stage-c/c0/physical-population-feasibility-v1.json --confirm
node --import tsx scripts/captureStageCAuthorityFeasibility.ts cashflow --input docs/audit/2026-07-stage-c/inputs/cashflow-authority-feasibility-input-v1.json --output docs/audit/2026-07-stage-c/c0/cashflow-authority-feasibility-v1.json --confirm
```

Expected: each command exits `0` only when its derived `complete` is true, exits `2` after writing an honest typed blocker receipt when authority is incomplete, and exits `1` without output on malformed/corrupt input. C0a re-enumerates every row in the committed source authority; C0b requires one complete and one distinct typed-unavailable real control.

- [ ] **Step 3: Apply the dependency decision**

- If C0a is incomplete, mark C2–C4 and Stage D blocked; C1 may continue independently.
- If C0b is incomplete, mark C5/C6 and current-exposure policy blocked; C2–C4 remain eligible if C0a passed.
- Do not rewrite an unavailable result into pass.

- [ ] **Step 4: Update knowledge truth**

Record V2 as additive/offline, preserve V1 production truth, list every remaining authority blocker, and state explicitly that no classifier, blind selection, traversal, score, or activation occurred.

- [ ] **Step 5: Run focused verification**

```powershell
npm test -- tests/unified-check/providerRequest.test.ts tests/forensics/stageCAuthorityFeasibility.test.ts tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts
```

Expected: all listed files PASS; PostgreSQL skipped count is zero.

- [ ] **Step 6: Run full verification**

```powershell
npm run typecheck
npm test
git diff --check
```

Expected: typecheck exits `0`; full suite has no new failures; diff check exits `0`.

- [ ] **Step 7: Commit documentation and receipt references**

```powershell
git add docs/audit/2026-07-stage-c/inputs/physical-population-feasibility-input-v1.json docs/audit/2026-07-stage-c/inputs/cashflow-authority-feasibility-input-v1.json docs/audit/2026-07-stage-c/c0/physical-population-feasibility-v1.json docs/audit/2026-07-stage-c/c0/cashflow-authority-feasibility-v1.json docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: record Stage C authority feasibility result"
```

## Hard aborts

- Abort on any V1 canonical JSON/hash drift.
- Abort if V2 includes API key selection, route anchor, classifier policy, expected action, or score.
- Abort if C0 counts synthetic/calibration cases as physical-population authority.
- Abort if the physical source authority is not a byte-identical blob in its reviewed allowlisted ancestor commit, or if “full universe” is claimed beyond or below that manifest without a new explicit source-authority review/commit.
- Abort if a physical receipt accepts caller-supplied candidate/query/root lists, a missing/extra required root identity, a non-exhausted/gapped source chain, an unverified repository inventory, or a source graph from which an eligible row or whole required query can be removed without verification failure.
- Abort if a current-only account response is treated as historical EOA.
- Abort if provider row order is treated as transaction order.
- Abort if an observed current balance is treated as independent pinned balance.
- Abort C0b acceptance if either the complete real control or the distinct typed-unavailable real control is absent, duplicated, synthetic, or cross-bound to another run/subject/snapshot.
- Abort if a PostgreSQL proof skips, references an accepted attempt, or changes final hashes.
- Abort before C2 if C0a `complete` is false. A typed C0 blocker is an acceptable completed implementation result.

## Completion definition

C0 implementation is complete when V1 bytes remain frozen, V2 collision/cache tests pass, the reviewed source-authority manifest is committed before enumeration, the physical receipt independently re-enumerates its complete self-contained exhausted graph, both receipts are deterministic and standalone, C0b proves one complete plus one typed-unavailable real control, the disposable PostgreSQL proof runs without skips, knowledge records the actual pass/block state, and no production path changed. C0a/C0b authority acquisition is accepted only for receipts whose `complete` value is derived true from reviewed real evidence; preserving caller-provided rows or silently replacing the source-authority commit is not a completeness proof.
