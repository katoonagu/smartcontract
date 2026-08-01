# Stage C6 Acceptance Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify every C0-C5 authority and non-interference receipt, build one immutable Stage C acceptance candidate, and require a separate independent human acceptance before Stage C can be declared complete.

**Architecture:** C6 is a closed-world offline verifier, not another capture or repair pipeline. It loads canonical receipts through their owning parsers, verifies their hash graph and repository reachability projection, and emits a candidate that contains no raw evidence or inferred replacements. The automated tool never creates human approval. A later human-authored artifact binds the candidate hash and is verified in a separate command/commit.

**Tech Stack:** TypeScript, Node.js/tsx, Vitest, PostgreSQL read-only queries, existing canonical JSON hashing, immutable JSON audit artifacts.

---

## Preconditions and scope

Read `docs/knowledge/AGENT_BRIEF.md`, `02-check-modes.md`, `03-job-lifecycle.md`, `04-data-sources-tronscan-indexing.md`, `05-where-is-money-and-incoming.md`, `06-deepcheck.md`, `07-risk-scoring-matrix.md`, `08-admin-and-bot-ux.md`, `09-current-decisions.md`, `10-open-problems.md`, `12-runbooks.md`, and `14-current-roadmap.md`, plus the governing Stage C design, execution index, and every C0-C5 implementation plan.

C6 starts only after all of these exist and independently verify:

- C0a physical-population feasibility receipt;
- C0b cashflow-authority feasibility receipt with at least one complete and one distinct typed-unavailable accepted-real-history current-balance control;
- C1 real-history one-group runtime shadow receipt with zero provider calls and a deliberately non-terminal queued continuation; completed-run terminal-summary behavior remains an independently executed C1 Task 7-8 gate rather than a fabricated property of the one-group evidence root;
- C2 physical-profile and EOA-at-anchor receipt;
- C3 adverse aggregate receipt;
- C4 legacy `24/24 + 6/6` receipt and disjoint blind `24 + 6` receipt;
- C5 offline `7/7`, real complete/unresolved controls, and runtime shadow receipt, represented by two self-contained roots whose embedded graphs parse after every source/replay database has been removed;
- enabled/disabled authoritative-projection equality receipts for C1 and C5;
- explicit disposable-PostgreSQL receipt with executed files/tests greater than zero and skipped files/tests equal to zero;
- typecheck, full-suite, diff-check, storage/finalizer isolation, and Admin DAG receipts.

If any prerequisite is absent, blocked, unresolved where completeness is required, or hash-invalid, the C6 verifier exits `2`. It does not run a provider, recapture data, select blind cases, adjudicate reviewer disagreements, write a role map, or repair a database.

C6 adds no checked-subject classifier. It cannot change boundary, candidates, score, report, delivery, matrix-v4, ScoreAnchorV3, or authorize Stage D.

## Task 1: Define the closed acceptance contracts

**Files:**

- Create: `tools/stage-c-acceptance/contracts.ts`
- Create: `tests/stage-c-acceptance/contracts.test.ts`
- Reference only: `src/forensics/canonicalJson.ts`
- Reference only: owning parsers from C0-C5

- [ ] **Step 1: Write red strict-parser tests**

Cover exact success, missing slice, duplicate slice, wrong schema, wrong design hash, wrong source commit, wrong receipt hash/path, noncanonical JSON, unknown keys, unsorted refs, duplicate refs, cross-slice receipt reuse, unsupported policy version, failed/unresolved prerequisite, nonzero production effect, PostgreSQL skips, zero executed tests, legacy/blind overlap, incomplete review/adjudication, accepted-attempt reachability, and tampering anywhere in the hash graph. For C0 reject a source-authority commit that is absent/not an ancestor of `testedSourceCommit`, wrong/missing fixed-path Git blob, embedded-manifest/blob byte mismatch after all C0 hashes are recomputed, multiple/no first-add commit, or first-add diff outside the exact allowlist; also reject C0b without both a complete and a distinct typed-unavailable real control. Prove the C1 and C2 one-argument acceptance parsers remain green with database/provider/filesystem resolver spies that throw; reject either acceptance if it carries only an external graph hash, or if a C2 external alias differs from the embedded population graph. For C1 also reject no or incomparable ancestry-maximal acceptance-root change, an evidence commit outside the global tested-source ancestry, zero/multiple parents, a parent different from the parsed embedded tested-source commit, a changed-path set different from `STAGE_C_C1_EVIDENCE_COMMIT_ALLOWLIST_V1`, and any root/replay-alias blob that is absent, non-regular, or byte-different between the evidence and global commits. For C3 reject a missing, duplicate, orphan, out-of-root, hash-conflicting, or symlinked transitive file, an artifact stored under a caller-invented/old layout rather than `serviceBoundaryAdverseArtifactRelativePathV1(ref)`, and a structurally valid graph bound to a detached C2 root. For C4 reject a forged/cast authority-root brand, a brand or bytes supplied from a different checkout, altered/non-ancestral acceptance `commitBindings`, package pre-seed/expectation bindings that differ from acceptance, evaluator/package present at the expectation commit, acceptance already present in `testedResultCommit`, C6 `testedSourceCommit` substituted for the earlier result commit, result bytes changed before C6, a missing reviewer, incomplete adjudication, false stop, lost red/continuation ID, package/acceptance mismatch, unknown/orphan file, or symlink at any fixed or variable path. For C5, also prove both root parsers remain green with the same throwing spies and reject a missing/orphan/cyclic embedded node, wrong normalized schema pair, changed canonical value, mismatched nested replay file, acceptance that carries only an external hash, no or incomparable ancestry-maximal runtime-acceptance change, wrong evidence parent, a diff outside or short of `STAGE_C_C5_RUNTIME_EVIDENCE_COMMIT_ALLOWLIST_V1`, or any runtime root/replay/projection alias changed before the global commit. Include one positive history where the foundation root was committed earlier, is already present in the runtime evidence parent, and is absent from the runtime evidence commit diff.

```powershell
npx vitest run tests/stage-c-acceptance/contracts.test.ts
```

Expected: FAIL because the contracts do not exist.

- [ ] **Step 2: Implement exact receipt references**

```ts
export type StageCSliceIdV1 =
  | "c0-physical-population"
  | "c0-cashflow-authority"
  | "c1-runtime-shadow"
  | "c2-physical-eoa"
  | "c3-adverse-preservation"
  | "c4-legacy-regression"
  | "c4-blind-validation"
  | "c5-cashflow-foundation"
  | "c5-cashflow-runtime"
  | "postgres-zero-skip"
  | "repository-isolation"
  | "full-verification";

export type StageCReceiptRefV1 = {
  readonly sliceId: StageCSliceIdV1;
  readonly schemaVersion: string;
  readonly relativePath: string;
  readonly sha256: string;
};

export type StageCReceiptManifestV1 = {
  readonly schemaVersion: "stage-c-receipt-manifest-v1";
  readonly testedSourceCommit: string;
  readonly generatedAt: string;
  readonly receiptRefs: readonly StageCReceiptRefV1[];
};

export const STAGE_C_RECEIPT_PATHS_V1 = {
  "c0-physical-population": "c0/physical-population-feasibility-v1.json",
  "c0-cashflow-authority": "c0/cashflow-authority-feasibility-v1.json",
  "c1-runtime-shadow": "c1/runtime-shadow-acceptance-v1.json",
  "c2-physical-eoa": "c2/physical-eoa-acceptance-v1.json",
  "c3-adverse-preservation": "c3/adverse-population-receipt-v1.json",
  "c4-legacy-regression": "c4/legacy-corpus-export-v1.json",
  "c4-blind-validation": "c4/blind-acceptance-receipt-v1.json",
  "c5-cashflow-foundation": "c5/cashflow-stage-c-receipt-v1.json",
  "c5-cashflow-runtime": "c5/cashflow-runtime-acceptance-v1.json",
  "postgres-zero-skip": "c6/postgres-zero-skip-v1.json",
  "repository-isolation": "c6/repository-isolation-v1.json",
  "full-verification": "c6/full-verification-v1.json"
} as const satisfies Readonly<Record<StageCSliceIdV1, string>>;

export const STAGE_C_C2_TRANSITIVE_LAYOUT_V1 = {
  acceptance: "c2/physical-eoa-acceptance-v1.json",
  populationRoot: "c2/physical-population-v1",
  candidateInventory:
    "c2/physical-population-v1/physical-candidate-inventory-v1.json"
} as const;

export const STAGE_C_C3_AUDIT_ROOT_V1 = "c3" as const;

export const STAGE_C_C4_TRANSITIVE_LAYOUT_V1 = {
  root: "c4",
  metricSourceManifest: "inputs/stage-c4-metric-source-manifest-v1.json",
  legacy: "c4/legacy-corpus-export-v1.json",
  protocol: "c4/blind-protocol-v1.json",
  pairedMetricTape: "c4/paired-metric-tape-v1.json",
  seedReceipt: "c4/seed-receipt-v1.json",
  selection: "c4/selection/selection-v1.json",
  reviewerA: "c4/reviews/reviewer-a-v1.json",
  reviewerB: "c4/reviews/reviewer-b-v1.json",
  expectationManifest: "c4/expectation-manifest-v1.json",
  evaluatorOutput: "c4/evaluator-output-v1.json",
  comparison: "c4/comparison-v1.json",
  package: "c4/package-v1.json",
  acceptance: "c4/blind-acceptance-receipt-v1.json",
  preseedHeadSourceRoot: "c4/preseed-head-source",
  seedSourceRoot: "c4/seed-source",
  selectionRoot: "c4/selection",
  neutralRoot: "c4/neutral",
  reviewsRoot: "c4/reviews",
  adjudicationRoot: "c4/adjudication"
} as const;

export const STAGE_C_AUDIT_REPOSITORY_ROOT_V1 =
  "docs/audit/2026-07-stage-c" as const;

export const STAGE_C_C1_EVIDENCE_COMMIT_ALLOWLIST_V1 = [
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/c1/runtime-shadow-replay-input-v1.json`,
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/c1/runtime-shadow-replay-identity-v1.json`,
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/${STAGE_C_RECEIPT_PATHS_V1["c1-runtime-shadow"]}`,
  "docs/knowledge/02-check-modes.md",
  "docs/knowledge/03-job-lifecycle.md",
  "docs/knowledge/04-data-sources-tronscan-indexing.md",
  "docs/knowledge/09-current-decisions.md",
  "docs/knowledge/10-open-problems.md",
  "docs/knowledge/14-current-roadmap.md"
] as const;

export const STAGE_C_C5_RUNTIME_EVIDENCE_COMMIT_ALLOWLIST_V1 = [
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/${CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1.replayInput}`,
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/${CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1.replayIdentity}`,
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/${CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1.dbProjection}`,
  `${STAGE_C_AUDIT_REPOSITORY_ROOT_V1}/${STAGE_C_RECEIPT_PATHS_V1["c5-cashflow-runtime"]}`,
  "docs/knowledge/09-current-decisions.md",
  "docs/knowledge/10-open-problems.md",
  "docs/knowledge/14-current-roadmap.md"
] as const;
```

Require exactly one ref for every union member, sorted by the frozen union order. The manifest still has exactly 12 roots: the C0 source-authority manifest embedded in C0a and the C2/C3/C4 transitive paths are code-owned closure, never extra manifest refs or caller-provided paths. Enforce literal path identity between `STAGE_C_C2_TRANSITIVE_LAYOUT_V1.acceptance` and the `c2-physical-eoa` manifest root, between `${STAGE_C_C3_AUDIT_ROOT_V1}/${SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1.populationReceipt}` and the `c3-adverse-preservation` root, and between `STAGE_C_C4_TRANSITIVE_LAYOUT_V1.legacy`/`.acceptance` and the two C4 manifest roots. The two C5 manifest roots remain exactly `c5/cashflow-stage-c-receipt-v1.json` and `c5/cashflow-runtime-acceptance-v1.json`; the latter embeds the former plus its replay input, replay identity, database projection, and runtime artifacts. C1's owning one-argument acceptance parser likewise supplies its complete embedded replay/runtime graph; C6 does not add a C1 filesystem resolver. C1 and C5 runtime acceptance receipts each carry their own authoritative-byte non-interference projection, so there is no caller-selectable aggregate non-interference ref. All ordinary audit paths are repository-relative descendants of `docs/audit/2026-07-stage-c/`, contain no `..`, drive prefix, symlink, or alternate separator, and point to canonical JSON bytes; C0's fixed constant is already repository-relative and is never joined to the audit root twice.

For C3, import `SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1` and `serviceBoundaryAdverseArtifactRelativePathV1()` from its owning producer. Prefix the returned relative path with only `STAGE_C_C3_AUDIT_ROOT_V1`; C6 must not redeclare filenames/directories or accept a caller path map. No directory scan chooses among candidates. For C4, fixed files use the table above; every variable source/selection-log/neutral/adjudication artifact must be explicitly reachable as a `PublishedArtifact` from the verified protocol/tape/selection/expectation/package graph and remain under its one matching bounded root. Neutral and adjudication artifacts use `<canonical-case-id>-v1.json`; the parsed selection supplies the exact 30 IDs. The resolver requires the actual Git-blob set below every bounded root to equal this derived closure, so an unknown, omitted, duplicate, or orphan file rejects.

Pin the approved design in code rather than accepting it from the manifest:

```ts
export const STAGE_C_APPROVED_DESIGN_PATH =
  "docs/superpowers/specs/2026-07-31-stage-c-runtime-blind-and-stage-d-exact-scoring-design.md";
export const STAGE_C_APPROVED_DESIGN_SHA256 =
  "92039caf6dda335b8e60621f01f817b2aae44b84ae9ff7a66b1060eb72545d2b";
```

The verifier reads the design blob with `git show <testedSourceCommit>:<STAGE_C_APPROVED_DESIGN_PATH>` and hashes those Git object bytes, not checkout bytes. This makes the pinned LF blob hash independent of Windows `core.autocrlf`; it also verifies the working-tree path, if present, resolves to the same blob before building. Neither the manifest nor the CLI accepts a design path/hash override.

Export `parseStageCReceiptManifestV1(value)`. It is exact-key and recomputes the ordered 12-ref set; `designSha256`, candidate hash, policy claims, and human decision are forbidden manifest inputs and are derived later by the verifier.

- [ ] **Step 3: Implement the acceptance candidate**

```ts
export type StageCAcceptanceCandidateV1 = {
  readonly schemaVersion: "stage-c-acceptance-candidate-v1";
  readonly candidateSha256: string;
  readonly body: {
    readonly designSha256: string;
    readonly receiptManifestSha256: string;
    readonly testedSourceCommit: string;
    readonly generatedAt: string;
    readonly receiptRefs: readonly StageCReceiptRefV1[];
    readonly policies: {
      readonly roleShadow: "service-role-shadow-100-plus-100-v1";
      readonly physical: "service-boundary-physical-100-plus-100-v1";
      readonly adverse: "service-boundary-adverse-policy-v1";
      readonly cashflowSelector: "cashflow-current-balance-selector-v1";
      readonly scoring: "scoring-signal-matrix-v4";
      readonly scoreAnchor: "score-anchor-v3";
    };
    readonly assertions: {
      readonly stageCScoreNeutral: true;
      readonly checkedSubjectClassifierAbsent: true;
      readonly subjectRoleReportOnly: true;
      readonly exactAdversePreserved: true;
      readonly acceptedAttemptShadowReferences: 0;
      readonly deliveryChanged: false;
      readonly stageDAuthorized: false;
    };
  };
};
```

`generatedAt` is supplied explicitly by the CLI and included in the candidate hash; tests freeze it. `testedSourceCommit` is the clean full 40-character Git hash on which C0-C5 receipts, all owning parsers, and all C6 verifier/test code were executed. It deliberately precedes the later commit containing generated C6 receipts and the candidate, avoiding a self-reference. The parser rejects claims that do not exactly match the fixed literals.

- [ ] **Step 4: Define but do not generate human acceptance**

```ts
export type StageCHumanAcceptanceV1 = {
  readonly schemaVersion: "stage-c-human-acceptance-v1";
  readonly acceptanceSha256: string;
  readonly body: {
    readonly candidateSha256: string;
    readonly candidateReceiptCommit: string;
    readonly reviewedTestedSourceCommit: string;
    readonly reviewerId: string;
    readonly reviewerRole: "independent-stage-c-acceptor";
    readonly reviewedAt: string;
    readonly decision: "accept" | "reject";
    readonly assertions: {
      readonly evidenceReviewed: true;
      readonly blindAdjudicationReviewed: true;
      readonly nonInterferenceReviewed: true;
      readonly postgresZeroSkipReviewed: true;
      readonly stageDStillRequiresSeparateApproval: true;
    };
  };
};
```

The repository stores a pseudonymous reviewer ID, not private identifying metadata. `candidateReceiptCommit` is the later commit that contains the exact candidate and all referenced generated C6 receipts; `reviewedTestedSourceCommit` must equal the candidate body. The acceptance verifier resolves both commits with Git and checks their exact bytes. The C6 code exports only a parser/verifier for this type. It must not export a builder that fills `decision:"accept"`.

Export explicit `serializeStageCReceiptManifestV1`, `serializeStageCAcceptanceCandidateV1`, and `serializeStageCHumanAcceptanceV1` owning writers alongside their strict parsers. Each delegates to `canonicalizeArtifactJson`, emits UTF-8 with no added LF, and is covered by raw-byte mutation tests.

- [ ] **Step 5: Run the parser green set**

```powershell
npx vitest run tests/stage-c-acceptance/contracts.test.ts tests/forensics/canonicalJson.test.ts
```

Expected: PASS.

## Task 2: Verify the C0-C5 hash graph semantically

**Files:**

- Create: `tools/stage-c-acceptance/verify.ts`
- Modify: `tests/stage-c-acceptance/contracts.test.ts`
- Reference only: C0-C5 contract/parser modules

- [ ] **Step 1: Write red semantic-verifier tests**

Use valid hashes with deliberately wrong semantics to prove a hash-only manifest cannot pass. Cover:

- C0a quota below `15 + 3 + 3 + 3`, missing an adverse authority class, a fully rehashed embedded source manifest that differs from the fixed Git blob, a non-ancestor source-authority commit, or a source-authority first-add commit with an unexpected changed path;
- C0b with no real complete current-balance control, no distinct accepted-real-history typed-unavailable current-balance control, or one control counted in both states;
- C1 without one frozen map load, exact committed reconciliation, the exact source target candidate delta, the expected queued continuation/zero-summary boundary, or non-interference; or whose acceptance-root last-change evidence commit is absent/ambiguous, not a direct child of its embedded tested-source commit, outside the global tested-source ancestry, has a non-exact allowlist diff, or has any root/replay-alias byte drift by the global commit;
- C2 with short windows, top-up/expansion, current-only EOA, contract/unknown promoted to EOA, incomplete role coverage, a missing/hash-only/wrong-owner C0/request/raw-page/order/role/historical/control/adverse authority leaf, a valid graph embedding a different C0a root, external population bytes that differ from the embedded graph, or an embedded legacy profile that is not its exact canonical accepted profile;
- C3 missing mandatory rows or typed authority leaves, wrong-family/noncanonical/detached authority leaf, hash-only evidence substituted for a leaf, unknown registry pair, wrong reducer precedence, lost terminal/continuation, incomplete receipt called clear, any of the five single-row `all_of` evidence-class bindings changed, `exact_bound_nonterminal` not satisfied by one/both of its exact two `any_of` IDs, or a detached but otherwise valid external C2 acceptance/population root;
- C4 not exactly legacy `24/24 + 6/6`, blind not exactly `24 + 6`, any overlap, missing reviewer B or any one of the 60 reviews, missing/changed adjudication, false stop, lost red/continuation, evaluator/comparison/package/acceptance hash detachment, altered/incorrectly ordered phase commits, result/acceptance commit-cycle, later C6 byte drift, or failed utility gate;
- C5 not `7/7`, missing real complete or unresolved control, wrong selector, any score/report/evidence-bundle reference, an absent/ambiguous runtime-acceptance evidence commit, wrong embedded tested-source parent, non-exact runtime evidence allowlist, or runtime root/replay/projection byte drift; prove an earlier unchanged foundation root is valid and is never required in that evidence commit's changed-path set;
- a PostgreSQL receipt with skips or a projection mismatch;
- for each C2/C3/C4 bounded root: missing, duplicate, orphan, unknown, hash-conflicting, out-of-root, symlinked, or Windows-reparse-point file, including mutations whose descendant hashes and enclosing package hashes were consistently recomputed;
- a C3 artifact with valid bytes/hash under an alternate pre-layout path, a plain-object/TypeScript-cast `ValidatedStageCBlindAuthorityRootsV1`, or a genuine brand produced from different-checkout bytes. Spy on `validateStageCBlindAuthorityRootsV1` so any call fails: C6 must obtain the runtime brand only from `validateStageCBlindAuthorityValuesV1` over Git objects at `testedSourceCommit`.

- [ ] **Step 2: Implement `verifyStageCAcceptanceCandidateV1`**

```ts
export type StageCVerificationResultV1 =
  | { readonly state: "accepted_candidate"; readonly candidate: StageCAcceptanceCandidateV1 }
  | { readonly state: "blocked"; readonly blockers: readonly string[] };

export async function verifyStageCAcceptanceCandidateV1(input: {
  readonly repositoryRoot: string;
  readonly manifest: StageCReceiptManifestV1;
}): Promise<StageCVerificationResultV1>;
```

First parse and canonically hash the manifest; the resulting SHA is the candidate's `receiptManifestSha256`. For every ref:

1. resolve it under the fixed audit root and reject symlinks;
2. cap file size;
3. require raw UTF-8 bytes to equal the exact bytes produced by that schema's owning canonical writer; for Golden artifacts call `verifyPublishedArtifact`/`publishArtifactOnce` serialization and do not append a newline;
4. recompute the file hash;
5. call the owning strict parser;
6. verify the slice-specific success semantics;
7. verify all cross-receipt bindings.

Return sorted unique typed blockers. Never turn a parser exception into an accepted candidate.

Import these side-effect-free owning APIs directly, never their CLI entrypoints:

- C0: `parseStageCPhysicalPopulationFeasibilityV1`, `parseStageCCashflowAuthorityFeasibilityV1`, `parseStageCPhysicalSourceAuthorityManifestV1`, their owning serializers, and `STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH`;
- C1: the one-argument `parseServiceRoleShadowC1AcceptanceV1` and its owning serializer; the parser recursively validates the complete embedded replay/runtime graph and accepts no resolver;
- C2: the one-argument `parseServiceBoundaryPhysicalAcceptanceV1`, `parseServiceBoundaryPhysicalCandidateInventoryV1`, and their owning serializers; the acceptance parser recursively validates the embedded population/control graph and canonical legacy profile and accepts no resolver;
- C3: `parseServiceBoundaryAdverseCandidateInventoryV1`, `parseServiceBoundaryAdversePopulationReceiptV1`, `parseServiceBoundaryAdverseAuthorityLeafV1`, `validateC2AdverseSourceRootV1`, `validateServiceBoundaryAdversePopulationGraphV1`, `SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1`, `serviceBoundaryAdverseArtifactRelativePathV1`, their owning serializers, and `SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1` from the same module;
- C4 authority/package APIs: `validateStageCBlindAuthorityValuesV1`, `verifyStageCBlindPackageV1`, `acceptStageCBlindPackageV1`, `StageCBlindPackageCommitBindingsV1`, `StageCBlindPackageResolverV1`, and Golden `verifyPublishedArtifact`; C6 never imports or invokes the path-only `validateStageCBlindAuthorityRootsV1` adapter;
- C4 owning parsers: `parseStageCLegacyCorpusExportV1`, `parseStageCBlindMetricSourceManifestV1`, `parseStageCBlindProtocolV1`, `parseStageCBlindPairedMetricTapeV1`, `parseStageCBlindSeedReceiptV1`, `parseStageCBlindSelectionV1`, `parseStageCBlindNeutralBundleV1`, `parseStageCBlindReviewV1`, `parseStageCBlindReviewLockV1`, `parseStageCBlindAdjudicationV1`, `parseStageCBlindExpectationManifestV1`, `parseStageCBlindEvaluatorOutputV1`, `parseStageCBlindComparisonV1`, `parseStageCBlindPackageV1`, and `parseStageCBlindAcceptanceReceiptV1`;
- C4 owning writers: `serializeStageCLegacyCorpusExportV1`, `serializeStageCBlindMetricSourceManifestV1`, `serializeStageCBlindProtocolV1`, `serializeStageCBlindPairedMetricTapeV1`, `serializeStageCBlindSeedReceiptV1`, `serializeStageCBlindSelectionV1`, `serializeStageCBlindNeutralBundleV1`, `serializeStageCBlindReviewV1`, `serializeStageCBlindReviewLockV1`, `serializeStageCBlindAdjudicationV1`, `serializeStageCBlindExpectationManifestV1`, `serializeStageCBlindEvaluatorOutputV1`, `serializeStageCBlindComparisonV1`, `serializeStageCBlindPackageV1`, and `serializeStageCBlindAcceptanceReceiptV1`;
- C5 manifest roots: `parseCashflowStageCReceiptV1`, `parseCashflowShadowRuntimeAcceptanceV1`, and `CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1`; the runtime acceptance parser internally invokes `parseCashflowRuntimeDbProjectionV1`, which invokes `parseCashflowRuntimeReplayInputV1`, `parseCashflowRuntimeReplayIdentityV1`, and the owning runtime-artifact parsers;
- C6 prerequisites: `parseStageCPostgresZeroSkipReceiptV1`, `parseStageCRepositoryIsolationReceiptV1`, and `parseStageCFullVerificationReceiptV1`.

Every named parser has a same-module serializer export named by replacing `parse` with `serialize` (for example `serializeServiceBoundaryPhysicalAcceptanceV1`). C0-C3/C5/C6 serializers delegate to existing `canonicalizeArtifactJson`; C4 serializers delegate to Golden `canonicalJson`/`verifyPublishedArtifact`. All return exact UTF-8 bytes with no implicit newline. C6 compares raw bytes to the owning serializer output before hashing and parsing; it never guesses LF/CRLF policy from a parser. In particular, the C1 and C2 acceptance roots and both C5 roots use one-argument parsers that recursively recompute their embedded graphs and are forbidden from accepting a resolver. C3 and C4 retain their owning external graph-verifier contracts. Repository/Git path checks are a later C6 containment layer, not hidden parser dependencies. A manifest cannot make C6 accept a schema name with no owning producer/serializer.

After parsing the C1 acceptance and C5 runtime acceptance, derive each evidence commit only from Git history bounded by `manifest.testedSourceCommit`; neither the manifest nor CLI may supply it. Enumerate commits in that ancestry which changed the fixed acceptance-root path and require exactly one ancestry-maximal last-change commit. It must be a full lowercase commit, be an ancestor of the global tested source, have exactly one parent, and have that parent equal the acceptance's parsed embedded `testedSourceCommit`. Require the parent-to-evidence changed-path set to equal, not merely be contained by, `STAGE_C_C1_EVIDENCE_COMMIT_ALLOWLIST_V1` or `STAGE_C_C5_RUNTIME_EVIDENCE_COMMIT_ALLOWLIST_V1`. Read the acceptance root and every required audit alias as regular Git blobs at both the evidence and global commits and require exact byte equality. For C1 those are the root, replay input, and replay identity. For C5 those are the runtime root, replay input, replay identity, and database projection; their global bytes must also equal the already-validated nested serializer bytes. The fixed C5 foundation root is deliberately absent from the runtime evidence allowlist: require it already present in the embedded tested-source parent and byte-identical through the evidence and global commits to the runtime acceptance's parsed nested foundation, but never require its earlier last-change commit to equal the runtime evidence commit.

For C0a, first call `parseStageCPhysicalPopulationFeasibilityV1` so the complete embedded source graph and `sourceAuthorityManifestSha256` are recomputed without Git. Then extract only its parsed `sourcePopulation.sourceAuthorityCommit` and require a lowercase full Git commit that exists and is an ancestor of `manifest.testedSourceCommit`. Read exactly `git show <sourceAuthorityCommit>:<STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH>` as raw blob bytes; require a regular blob, exact byte equality with `serializeStageCPhysicalSourceAuthorityManifestV1(embeddedManifest)`, and the embedded manifest hash already proved by the owning parser. Locate the unique first-add commit with the equivalent of `git log --format=%H --diff-filter=A --reverse <sourceAuthorityCommit> -- <fixed-path>`; require exactly one result equal to `sourceAuthorityCommit`, require that commit to have exactly one parent, require the fixed path in its parent diff, and reject any changed path outside `STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH`, `docs/knowledge/04-data-sources-tronscan-indexing.md`, `docs/knowledge/10-open-problems.md`, and `docs/knowledge/14-current-roadmap.md`. Neither the C0 receipt nor CLI may override the path, commit ancestry rule, or allowlist. This is the sole leaf allowed to rely on its parsed earlier Git blob without the C1/C5-style exact byte-preservation check at the later global commit; it remains embedded in the parsed C0 root.

For C2/C3, C6 builds one immutable resolver index from Git blobs at `manifest.testedSourceCommit`, never from a database or caller-supplied path map. It parses the fixed C2 acceptance with the one-argument parser, requires the exact embedded C0a receipt node to be byte-identical to the already verified `c0/physical-population-feasibility-v1.json` root, then derives the only permitted C2 external aliases as the fixed candidate-inventory path plus every exact `populationGraph.artifacts[].relativePath`; those paths and hashes must equal the candidate inventory's transitive refs. The owning C2 parser must have revalidated every embedded C0/request/raw-page/order/role/historical/control/adverse authority body before rebuilding physical/EOA/evidence receipts. The actual Git blob set beneath `STAGE_C_C2_TRANSITIVE_LAYOUT_V1.populationRoot` must equal that derived set, byte-for-byte, with no extra entry. C6 constructs `ServiceBoundaryAdverseC2SourceRootV1` from the fixed acceptance path/hash, fixed population root, and fixed candidate-inventory path/hash, and calls `validateC2AdverseSourceRootV1({value, resolveC2Artifact})`. `resolveC2Artifact` serves only the fixed acceptance ref or a path/hash pair in that derived alias set, returns the exact requested repository-relative path and canonical UTF-8 with `symlinkFree:true`, and rejects every other request. Thus the external C2 population root is a checked repository alias of the self-contained acceptance, never a second authority.

C6 then reads the C3 population receipt from `${STAGE_C_C3_AUDIT_ROOT_V1}/${SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1.populationReceipt}`, derives every referenced matrix/authority-leaf/check/receipt SHA, and maps each graph ref only by prefixing `serviceBoundaryAdverseArtifactRelativePathV1(ref)` with `STAGE_C_C3_AUDIT_ROOT_V1` for the Git lookup. It requires exact equality between the derived path/hash set and the Git blob set below `c3/`; no directory scan may choose a file for a requested hash. It invokes `validateServiceBoundaryAdversePopulationGraphV1({populationReceiptValue, expectedPopulationReceiptSha256, acceptedC2Root, resolveC2Artifact, resolveArtifact})` with the opaque root returned above. `resolveArtifact(ref)` looks up `c3/<producer-relative-path>` but returns `{relativePath: serviceBoundaryAdverseArtifactRelativePathV1(ref), canonicalJsonUtf8, symlinkFree:true}` exactly as the C3 contract requires; it never returns the audit-root prefix in `relativePath`. The owning verifier must select each leaf's exact `checkId -> body` parser, canonical-reserialize/re-hash it, derive the row's outcome/finality/continuation fields from its non-empty same-check leaf refs, reparse every row, matrix, aggregate receipt and C2 context, and exact-compare the C3-embedded source root with the independently validated external C2 root. A missing/wrong-family/hash-only leaf, missing edge, orphan blob, alternate layout, substituted but valid C2 root, or locally rehashed detached C3 graph blocks C6.

For C4, C6 first parses every fixed value in `STAGE_C_C4_TRANSITIVE_LAYOUT_V1`, including `metricSourceManifest` and the acceptance. It takes the exact `StageCBlindPackageCommitBindingsV1` only from `acceptance.commitBindings`; the manifest/CLI cannot supply or replace any of `preseedProtocolCommit`, `expectationCommit`, or `testedResultCommit`. Require the package's pre-seed/expectation bindings to equal the first two acceptance bindings, then prove the strict ancestry chain `preseedProtocolCommit -> expectationCommit -> testedResultCommit -> manifest.testedSourceCommit`. The acceptance-bound `testedResultCommit`, not the later C6 tested source, is passed to the C4 verifier. It must contain the exact evaluator/comparison/package and no acceptance; `manifest.testedSourceCommit` must contain the exact acceptance and byte-identical unchanged evaluator/comparison/package. A result commit containing its later acceptance, a C6 commit substituted as `testedResultCommit`, or any changed result byte rejects.

C6 computes the complete variable `PublishedArtifact` closure from the parsed metric-source manifest, protocol, metric tape, seed, selection, 30 neutral bundles, two reviewer locks containing 30 reviews each, 30 adjudications, expectation manifest, evaluator output, comparison, and package. Pre-seed head, seed, selection-log, neutral, review, and adjudication artifacts may exist only below their matching fixed root; neutral and adjudication names are exactly `<canonical-case-id>-v1.json`, and reviewer files are exactly the two fixed names. Metric-source `PublishedArtifact`s are permitted only when their path/hash is already a member of the verified upstream C1/C2/C3 artifact inventory; the source manifest cannot introduce a caller-selected root.

Implement `StageCBlindPackageResolverV1` only over Git objects: `resolvePublishedArtifact({commit,artifact})` reads the exact commit/path blob and returns matching commit, path, canonical UTF-8, SHA, byte length, and `objectType:"blob"`; `listBoundedTree({commit,root})` returns the complete sorted Git tree with `blob | symlink | gitlink`; and `isAncestor({ancestorCommit,descendantCommit})` delegates to the bounded Git ancestry check. The resolver accepts only the three parsed C4 commits. Legacy/metric-source-manifest/tape/protocol and their declared raw closure resolve at `preseedProtocolCommit`; seed/selection/neutral/review/adjudication/expectation closure resolves at `expectationCommit`; evaluator/comparison/package resolves at `testedResultCommit`. Evaluator/comparison/package must be absent at `expectationCommit`. At each phase, the actual bounded Git blob set must equal the derived reachable set, with no missing/extra/orphan path; every entry must be a regular blob rather than a symlink/gitlink. The later `manifest.testedSourceCommit` is a containment comparison only, not a phase-binding replacement. Every present checkout component must still pass `lstat`/Windows reparse-point containment before any filesystem read, but checkout bytes never mint C4 authority.

After the C2/C3 bytes and paths above pass, C6 calls `validateStageCBlindAuthorityValuesV1({acceptedC2Root, resolveC2Artifact, populationReceiptValue, expectedPopulationReceiptSha256, resolveC3Artifact})` over those same Git-object values. Only this pure C4 producer may create the runtime-branded `ValidatedStageCBlindAuthorityRootsV1`; C6 must not construct/cast/copy the brand, accept it as input, or call the path-only `validateStageCBlindAuthorityRootsV1` against the current checkout. The pure producer repeats the owning C3 graph validation and exact external/embedded C2-root comparison before returning the brand.

After `verifyPublishedArtifact` and the exact owning parser/writer pair have accepted every C4 byte sequence, call exactly:

```ts
const verifiedPackage = await verifyStageCBlindPackageV1({
  authorityRoots,
  legacy,
  protocol,
  metricSourceManifest,
  metricTape,
  seedReceipt,
  selection,
  neutralBundles,
  reviewLocks: [reviewerA, reviewerB],
  adjudications,
  expectation,
  evaluatorOutput,
  comparison,
  package: blindPackage,
  commitBindings: acceptance.commitBindings,
  resolver: gitObjectResolver
});
```

The owning verifier runtime-checks the authority brand, phase commits and exact `30/60/30` closure, reruns the evaluator byte-for-byte, comparison, current legacy `24/24 + 6/6`, disjoint blind `24 + 6`, exact-service exclusion, zero false stops, zero lost red/continuation IDs, and every safety/utility gate. Then call `acceptStageCBlindPackageV1({verifiedPackage, ownerId: acceptance.ownerId, acceptedAt: acceptance.acceptedAt})` and require its `serializeStageCBlindAcceptanceReceiptV1()` bytes to equal the parsed fixed acceptance bytes exactly. C6 never reproduces package/acceptance booleans. Removing reviewer B, changing one adjudication, adding one false stop, dropping one red or continuation ID, forging either runtime brand, substituting the C6 commit for `testedResultCommit`, or rehashing a detached package/acceptance still rejects.

C6 imports the C3 evidence-class requirement constant directly and never declares a second map. After the C3 owning graph verifier resolves the population's bound positive row hashes, require exact constant order and entries: five classes use their single mapped `all_of` row, while `exact_bound_nonterminal` uses `any_of` over exactly `approval_transferfrom_proxy_lead` and `verify_like_bound_lead`, with one or both proven and fully continuation-bound. Both mandatory rows must still exist even when only one satisfies `any_of`. Reject a copied class label, a substituted alias, a missing/downgraded sibling, a caller-provided expected-ID list, or any population binding/count not recomputed from those rows.

- [ ] **Step 3: Verify the checked-subject negative contract**

The verifier must cross-check the owning C2 physical acceptance, C3 adverse population receipt, and C4 blind acceptance—not source-code text or an undeclared policy ref—and require:

- C2's derived `checkedSubjectClassifierExecuted:false` and `checkedSubjectRoleAuthorityProduced:false`;
- no subject-role authority artifact in C0-C6;
- C2's derived subject-role candidate suppression and score effect both `false`;
- C2/C3's derived exact-adverse suppression flags `false` and complete matrix-bound checked-subject rows;
- C4's three checked-subject controls all continue full and no subject role affects model output.

- [ ] **Step 4: Run green tests**

```powershell
npx vitest run tests/stage-c-acceptance/contracts.test.ts
```

Expected: PASS with exact blocker codes for every invalid fixture.

## Task 3: Produce the explicit PostgreSQL, isolation, and verification receipts

**Files:**

- Create: `tools/stage-c-acceptance/postgres.ts`
- Create: `tools/stage-c-acceptance/prerequisites.ts`
- Create: `scripts/captureStageCAcceptancePrerequisites.ts`
- Create: `tests/stage-c-acceptance/prerequisites.test.ts`
- Create: `tests/unified-check/stageCAcceptance.postgres.test.ts`
- Create after the global reporter validates: `docs/audit/2026-07-stage-c/c6/postgres-zero-skip-v1.json`
- Create from the accepted database projection: `docs/audit/2026-07-stage-c/c6/repository-isolation-v1.json`
- Create after the complete local gate: `docs/audit/2026-07-stage-c/c6/full-verification-v1.json`
- Reference only: `src/unifiedCheck/repository.ts`
- Reference only: `src/unifiedCheck/productionFinalizer.ts`
- Reference only: current migrations/schema verifier

- [ ] **Step 1: Write red database-projection tests**

Seed all Stage C standalone artifact kinds and authoritative runtime rows. Assert the projection reports:

- exact schema version/migration head;
- every Stage C standalone artifact hash and count;
- zero accepted-attempt, accepted-artifact, finalizer, evidence bundle, score anchor, report, and delivery references;
- zero C1 run summaries in the real-history one-group acceptance replay, with the traversal and consequent provider task still queued exactly as embedded in its verified root; separately execute the completed-run summary gate from the tested C1 source;
- deterministic C1/C5 enabled/disabled authoritative projection equality;
- exact Git-derived C1/C5 runtime evidence commits, with no caller-provided commit value and an earlier unchanged C5 foundation accepted outside the runtime evidence diff;
- no Stage C artifact in the Admin task DAG;
- a mismatch or reachable standalone hash fails.

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name a disposable database" }
npx vitest run tests/unified-check/stageCAcceptance.postgres.test.ts
```

Expected: FAIL before the projection exists. A skipped file is a failure.

- [ ] **Step 2: Implement one read-only authoritative projection**

```ts
export type StageCRepositoryIsolationReceiptV1 = {
  readonly schemaVersion: "stage-c-repository-isolation-receipt-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly databaseSchemaVersion: string;
    readonly testedSourceCommit: string;
    readonly c0PhysicalPopulationReceiptSha256: string;
    readonly c0CashflowAuthorityReceiptSha256: string;
    readonly c0SourceAuthorityCommit: string;
    readonly c0SourceAuthorityManifestSha256: string;
    readonly c1RuntimeAcceptanceSha256: string;
    readonly c1RuntimeEvidenceCommit: string;
    readonly c2PhysicalAcceptanceSha256: string;
    readonly c3AdversePopulationReceiptSha256: string;
    readonly c4BlindAcceptanceSha256: string;
    readonly c5RuntimeAcceptanceSha256: string;
    readonly c5RuntimeEvidenceCommit: string;
    readonly postgresZeroSkipReceiptSha256: string;
    readonly artifactInventorySha256: string;
    readonly artifactInventory: readonly {
      readonly logicalArtifactId: string;
      readonly ownerSlice: "c0" | "c1" | "c2" | "c3" | "c4" | "c5";
      readonly storageClass: "unified_standalone" | "file_only_audit";
      readonly kind: string;
      readonly schemaVersion: string;
      readonly sha256: string;
      readonly sourceReceiptSha256: string;
      readonly repositoryPaths: readonly string[];
    }[];
    readonly artifactCount: number;
    readonly unifiedStandaloneArtifactCount: number;
    readonly fileOnlyAuditArtifactCount: number;
    readonly c1RunSummarySha256: string;
    readonly c1RunSummaryCount: 1;
    readonly c1RuntimeReceiptCount: 1;
    readonly c5RuntimeReceiptCount: 2;
    readonly acceptedAttemptReferenceCount: 0;
    readonly acceptedArtifactReferenceCount: 0;
    readonly evidenceBundleReferenceCount: 0;
    readonly finalizerReferenceCount: 0;
    readonly scoreAnchorReferenceCount: 0;
    readonly reportReferenceCount: 0;
    readonly deliveryReferenceCount: 0;
    readonly adminDagReferenceCount: 0;
    readonly authoritativeProjectionSha256Disabled: string;
    readonly authoritativeProjectionSha256Enabled: string;
    readonly authoritativeProjectionEqual: true;
  };
};
```

The C1, C2, and C5 acceptance roots are self-contained and use their owning one-argument parsers; C6 must not depend on any disposable source/replay schema still existing. C1 and C5 already contain their real-history enabled/disabled projections. After parsing them, isolation performs the exact C1/C5 last-change evidence-commit, direct-parent, ancestry, allowlist, and evidence-to-global byte checks from Task 2 and records the two derived evidence commits in the receipt. C2 embeds its complete population/control graph, canonical legacy profile, and reference projection; its external population directory is revalidated only as a byte-identical Git alias for C3/C4. C3 is then rebuilt with `validateC2AdverseSourceRootV1` and `validateServiceBoundaryAdversePopulationGraphV1`; C6 passes the same commit-backed values/resolvers through `validateStageCBlindAuthorityValuesV1` to obtain the only admissible C4 runtime brand. It never uses the path-only C4 adapter or a caller-provided brand. It parses the fixed C4 acceptance first, accepts the exact phase triple only from `acceptance.commitBindings`, and gives `verifyStageCBlindPackageV1` a Git-object resolver that reads pre-seed inputs at `preseedProtocolCommit`, expectation-phase inputs at `expectationCommit`, and evaluator/comparison/package at `testedResultCommit`. It proves that ordered ancestry through the later global `testedSourceCommit`, requires evaluator/comparison/package absent at expectation and acceptance absent at result, and requires the result trio to remain byte-identical while the acceptance is present at the global commit. The package receives `acceptance.commitBindings` unchanged; the later global commit is never substituted for `testedResultCommit`. For C5, the foundation root contributes every content-addressed control node, while the runtime root contributes the nested foundation alias, replay input, replay identity, database projection, two shadows, and two runtime receipts. The alias must be byte-identical to the fixed foundation root and is not counted twice. `CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1` fixes the three repository copies of replay input, replay identity, and projection. The foundation must already exist unchanged in the C5 embedded tested-source parent; it is compared through evidence/global but is not part of the runtime evidence commit allowlist. No missing path may be replaced by a database query, arbitrary resolver, or reconstruction from a deleted database.

Derive one exact sorted inventory keyed by `logicalArtifactId`; `repositoryPaths:[]` denotes an embedded-only artifact, while every file-backed root/transitive alias appears once in the sorted unique array. The same logical node embedded in a root and exported at one or more repository paths is one inventory entry, not duplicate logical artifacts; this represents, for example, the C0a root plus its byte-identical C2 alias without losing either path. Classify every entry from its owning producer as `unified_standalone` or `file_only_audit`: the C0 source-authority manifest is one file-only cross-commit alias at `STAGE_C_PHYSICAL_SOURCE_AUTHORITY_PATH`; C2/C3 nodes persisted through `insertUnifiedArtifact` are Unified standalone entries with their checked repository aliases; all C4 Golden/source/review/adjudication/evaluator/comparison/package/acceptance artifacts are file-only; C5 foundation/replay/projection/acceptance files are file-only; and the C5 shadows/runtime receipts are Unified standalone. Rehydrate only the clean deterministic Unified subset—including the C1 summary/runtime nodes, C2 population nodes, C3 matrix/authority-leaf/check/receipt nodes, and four C5 runtime nodes—into UUID-suffixed disposable schemas. Never insert the C0 manifest, C4, or another file-only artifact.

The canonical acceptance fixture contains no forbidden relationship. Separate negative tests insert one forbidden edge at a time in rolled-back/disposable mutations and prove the verifier fails; they are never mixed into the zero-count acceptance projection. A read-only repeatable-read transaction plus frozen database clock derives reachability and authoritative projection. The projection deliberately excludes standalone C1/C2/C3/C5 observer artifacts and wall-clock observation timestamps; document its exact columns in code/test. It includes accepted task status/checkpoints, accepted artifacts, traversal results, final result, score anchor, report, and delivery rows. Drop only the exact UUID-suffixed disposable schemas in `finally`. Export `parseStageCRepositoryIsolationReceiptV1(value)`; it recomputes storage classes/inventory/counts/receipt hash from its embedded inventory, cross-binds both C0 root hashes plus the parsed source-authority commit/manifest hash, the C1/C5 derived evidence commits, the C1/C2/C3/C4/C5 authority-root hashes, and global PostgreSQL receipt, and rejects an unknown/missing/duplicate artifact, a code-owned path/nested-value mismatch, wrong summary/runtime cardinality, DB insertion of a file-only artifact, nonzero reachability, or projection inequality. The parser itself performs no Git or database I/O; the publisher supplies the already-derived canonical inventory and Git-verified evidence commits after the separate Git checks.

- [ ] **Step 3: Define the two non-database prerequisite receipts**

```ts
export type StageCPostgresZeroSkipReceiptV1 = {
  readonly schemaVersion: "stage-c-postgres-zero-skip-receipt-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly testedSourceCommit: string;
    readonly reporterSha256: string;
    readonly exactTestFiles: readonly string[];
    readonly executionInventory: readonly {
      readonly file: string;
      readonly tests: readonly {
        readonly fullName: string;
        readonly status: "passed";
      }[];
    }[];
    readonly executedFileCount: number;
    readonly executedTestCount: number;
    readonly failedCount: 0;
    readonly skippedCount: 0;
    readonly pendingCount: 0;
    readonly todoCount: 0;
  };
};

export type StageCFullVerificationReceiptV1 = {
  readonly schemaVersion: "stage-c-full-verification-receipt-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly testedSourceCommit: string;
    readonly cleanBeforeRun: true;
    readonly commands: readonly {
      readonly argv: readonly string[];
      readonly exitCode: 0;
      readonly stdoutSha256: string;
      readonly stderrSha256: string;
    }[];
    readonly productionEffect: false;
  };
};
```

Freeze the PostgreSQL file order to the six paths in Step 4. The PostgreSQL publisher validates the raw Vitest reporter and requires executed files/tests greater than zero and failed/skipped/pending/todo zero; it copies only the bounded sorted file/full-test-name/`passed` inventory into the canonical receipt. All summary counts are recomputed from that inventory. The later canonical-receipt parser validates it without depending on the ignored raw file; `reporterSha256` remains provenance, not an unavailable authority leaf. The general `npm test` summary is never accepted. `parseStageCFullVerificationReceiptV1` requires exactly `npm.cmd run typecheck`, `npm.cmd test`, and `git diff --check`, in that order, all run from a clean `testedSourceCommit`. The receipt records output hashes, not unbounded logs. It does not claim to be present in the tested commit.

Export explicit `serializeStageCPostgresZeroSkipReceiptV1`, `serializeStageCRepositoryIsolationReceiptV1`, and `serializeStageCFullVerificationReceiptV1` alongside their strict parsers, using `canonicalizeArtifactJson` with no added LF.

- [ ] **Step 4: Run the global reporter and capture all three receipts**

```powershell
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) { throw "TEST_DATABASE_URL must name a disposable database" }
$env:UNIFIED_RELEASE_GATE_MODE = "1"
New-Item -ItemType Directory -Force -Path artifacts/stage-c | Out-Null
$testedSourceCommit = git rev-parse HEAD
if (git status --porcelain) { throw "tested source commit must start clean" }
npx vitest run tests/unified-check/stageCAuthorityFeasibility.postgres.test.ts tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts tests/unified-check/cashflowShadowRuntime.postgres.test.ts tests/unified-check/stageCAcceptance.postgres.test.ts --reporter=json --outputFile=artifacts/stage-c/global-postgres-vitest.json
node --import tsx scripts/captureStageCAcceptancePrerequisites.ts full --tested-source-commit $testedSourceCommit --output docs/audit/2026-07-stage-c/c6/full-verification-v1.json --confirm
node --import tsx scripts/captureStageCAcceptancePrerequisites.ts postgres --tested-source-commit $testedSourceCommit --reporter artifacts/stage-c/global-postgres-vitest.json --output docs/audit/2026-07-stage-c/c6/postgres-zero-skip-v1.json --confirm
node --import tsx scripts/captureStageCAcceptancePrerequisites.ts isolation --tested-source-commit $testedSourceCommit --audit-root docs/audit/2026-07-stage-c --postgres-receipt docs/audit/2026-07-stage-c/c6/postgres-zero-skip-v1.json --output docs/audit/2026-07-stage-c/c6/repository-isolation-v1.json --confirm
```

`postgres` and `full` are local-only. `isolation` accepts `--audit-root` only when it resolves to the fixed repository `docs/audit/2026-07-stage-c` root and uses `TEST_DATABASE_URL` only for its exact fresh UUID-suffixed rehydration schemas. It parses the self-contained C0/C1/C2/C5 roots offline, verifies the C0 source-authority blob/ancestor/first-add allowlist at its parsed `sourceAuthorityCommit`, validates the C2 external aliases, invokes the C3 source-root/population graph verifiers, obtains the C4 runtime brand only through `validateStageCBlindAuthorityValuesV1`, parses `acceptance.commitBindings`, and invokes the C4 package verifier with that exact triple and the phase-aware symlink-safe Git-backed resolver defined in Task 2. Every fixed C0-C5 root and ordinary transitive byte must be present unchanged at `testedSourceCommit`; only the C0 fixed source-authority blob comes solely from its explicitly bound ancestor commit. In addition, C4 must prove its historical `preseedProtocolCommit -> expectationCommit -> testedResultCommit -> testedSourceCommit` chain, resolve each phase from its bound commit, and prove the later commit preserves evaluator/comparison/package bytes and adds the acceptance without retroactively placing it in `testedResultCommit`. It derives every fixture inventory/count/relationship from those verified graphs rather than accepting caller-supplied numbers. For C5 it additionally compares the three code-owned transitive Git blobs to the nested values before rehydration. It never requires a deleted C1/C2/C3/C5 source or replay database, `DATABASE_URL`, a caller-provided artifact resolver/brand/commit binding, the current-checkout C4 path adapter, network/provider access, or a production database. `full` requires the initial clean worktree; the later publishers require the same `HEAD`, no tracked modification, and permit only the exact earlier C6 output paths created by this sequence. Every command rejects a mismatched tested commit, unexpected dirt, existing target, symlink/reparse point, malformed reporter, or uncommitted verifier code. Expected: three canonical artifacts with strict parsers, zero failed/skipped tests, zero repository reachability, and equal authoritative projections.

Before publishing `repository-isolation-v1.json`, `isolation` must also derive and verify the C1 and C5 runtime evidence commits from the two parsed acceptance roots exactly as specified in Task 2; it records those commits and rejects caller-supplied values. The earlier C5 foundation remains a separately verified root already present in the C5 evidence parent, never a required change in the runtime evidence commit.

## Task 4: Add the bounded acceptance CLI

**Files:**

- Create: `tools/stage-c-acceptance/cli.ts`
- Create: `scripts/verifyStageCAcceptance.ts`
- Create: `tests/stage-c-acceptance/cli.acceptance.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write red CLI acceptance tests**

Cover only these commands:

```text
build-manifest --tested-source-commit <git-sha> --generated-at <utc> --audit-root <fixed-root> --output <new-file>
build-candidate --manifest <canonical-json> --output <new-file>
verify-candidate --candidate <canonical-json> --candidate-receipt-commit <git-sha>
verify-acceptance --candidate <canonical-json> --candidate-receipt-commit <git-sha> --human-acceptance <canonical-json>
```

Assert bounded arguments, no network/database/provider import, no overwrite, no symlink traversal, no raw secret output, exit `0` for valid state, exit `2` for missing/blocked/human-acceptance-absent, and exit `1` for malformed/tampered input.

- [ ] **Step 2: Implement the thin CLI**

`build-manifest` accepts only the fixed audit root, validates `HEAD === testedSourceCommit`, no tracked modification, and only the three expected untracked C6 prerequisite outputs. It resolves the code-owned ordered table and emits exactly 12 root refs; transitive files never become extra refs or caller-provided arguments. It invokes the C0/C1/C2/C5 self-contained one-argument root parsers, performs the C0 parsed-ancestor fixed-blob/first-add-allowlist check, requires both C5 roots and their nested foundation alias to agree, and compares the three `CASHFLOW_STAGE_C_TRANSITIVE_PATHS_V1` Git blobs with the nested replay/projection serializer bytes. It also derives the exact C2/C3/C4 transitive sets from the parsed graphs, requires their complete bytes and regular-blob modes at `testedSourceCommit`, invokes `validateC2AdverseSourceRootV1` and `validateServiceBoundaryAdversePopulationGraphV1`, and obtains the C4 brand only from `validateStageCBlindAuthorityValuesV1` over those same values/resolvers. For C4 it parses acceptance before package verification, takes only `acceptance.commitBindings`, proves the four-commit ancestry chain, resolves each artifact at its producer-owned phase commit, and proves evaluator/comparison/package byte preservation at the global commit. It then calls `verifyStageCBlindPackageV1` with that exact triple and reconstructs the acceptance through `acceptStageCBlindPackageV1` for exact serialized-byte comparison. Only after all gates pass does it compute raw root hashes and exclusively publish the manifest; there is no hand-authored ref/path/hash/commit/brand list.

For C1 and C5, `build-manifest` additionally derives each unique last-change evidence commit, proves its sole parent equals the root's embedded tested-source commit, checks the exact code-owned changed-path set, and compares every required audit blob between evidence and global commits. It cross-checks the derived commits with the isolation receipt. The C5 foundation is compared as an unchanged pre-existing root and is intentionally excluded from the runtime evidence diff.

`build-candidate` calls the same semantic verifier and writes only with exclusive creation after every root and transitive closure is green. It binds the fixed design hash and clean `testedSourceCommit`; it never guesses the future commit that will contain itself. After the candidate is committed, `verify-candidate` uses `git cat-file`/`git show` to prove `candidateReceiptCommit` has exactly one parent equal to `testedSourceCommit`, contains the exact candidate and generated C6 receipts, and changes only the fixed C6 prerequisite/manifest/candidate allowlist. Every C0-C5 root and every derived C2/C3/C4/C5 transitive Git blob must still equal its bytes in the parent `testedSourceCommit`; the C0 source-authority exception must still equal the blob in its parsed ancestor commit and pass the same first-add allowlist. For C4, verification must also retain the acceptance-owned binding triple, prove its phase ancestry, and exact-compare evaluator/comparison/package across `testedResultCommit`, `testedSourceCommit`, and the inherited candidate-commit blobs while proving acceptance absent from the result commit. The candidate commit neither duplicates nor rewrites them. Any production/code/knowledge/unexpected audit diff, detached transitive root, altered C4 phase binding or result byte, result/acceptance cycle, source-authority ancestry/blob/allowlist mismatch, or missing/orphan path rejects. `verify-acceptance` validates the independently authored human file and requires `decision:"accept"` bound to the candidate hash, `candidateReceiptCommit`, and `reviewedTestedSourceCommit`.

`verify-candidate` reruns the C1/C5 evidence-boundary checks against its parent `testedSourceCommit`, requires the same derived evidence commits recorded by isolation, and proves the candidate commit only inherits the unchanged C1/C5 roots and aliases. A later or substituted evidence commit, changed alias, wrong direct parent, non-exact allowlist, or treating the earlier C5 foundation commit as the runtime evidence commit rejects.

Do not add a `create-human-acceptance`, `sign`, `--accept`, or automatic approval command.

- [ ] **Step 3: Add one package script**

```json
"stage-c:acceptance": "node --import tsx scripts/verifyStageCAcceptance.ts"
```

- [ ] **Step 4: Run CLI tests**

```powershell
npx vitest run tests/stage-c-acceptance/cli.acceptance.test.ts tests/stage-c-acceptance/contracts.test.ts
```

Expected: PASS.

## Task 5: Build the acceptance candidate

**Files:**

- Create after C0-C5 are green: `docs/audit/2026-07-stage-c/acceptance/receipt-manifest-v1.json`
- Create after verification: `docs/audit/2026-07-stage-c/acceptance/stage-c-acceptance-candidate-v1.json`

- [ ] **Step 1: Commit verifier code and freeze the tested source commit**

Before generating any C6 receipt, commit the C6 contract/verifier/CLI/test code. Freeze `testedSourceCommit = git rev-parse HEAD` only when the worktree is clean. That commit must contain all C0-C5 canonical receipts, their owning parsers, and all C6 code/tests, but cannot contain the receipts/candidate that will be generated by testing itself. Do not use a dirty-tree hash and do not require a commit to contain a receipt that claims that same commit.

```powershell
git add tools/stage-c-acceptance scripts/captureStageCAcceptancePrerequisites.ts scripts/verifyStageCAcceptance.ts tests/stage-c-acceptance tests/unified-check/stageCAcceptance.postgres.test.ts package.json
git commit -m "feat: verify Stage C acceptance closure"
$testedSourceCommit = git rev-parse HEAD
if (git status --porcelain) { throw "tested source commit must be clean" }
```

- [ ] **Step 2: Run every final check and preserve its canonical receipt**

The Task 3 `full` publisher is the sole recorded runner for exactly `npm.cmd run typecheck`, `npm.cmd test`, and `git diff --check`; do not run an unrecorded substitute and then hand-write its receipt. Run the full explicit PostgreSQL/prerequisite-capture sequence from Task 3. Record exact commands, tested source commit, schema version, executed/failed/skipped counts, and output hashes in the three concrete C6 receipts. Then run the deterministic exclusive manifest publisher:

```powershell
$generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
npm.cmd run stage-c:acceptance -- build-manifest --tested-source-commit $testedSourceCommit --generated-at $generatedAt --audit-root docs/audit/2026-07-stage-c --output docs/audit/2026-07-stage-c/acceptance/receipt-manifest-v1.json
```

Expected: exactly the code-owned 12 refs; no hand-authored path/hash/count.

- [ ] **Step 3: Build and verify the candidate**

```powershell
npm.cmd run stage-c:acceptance -- build-candidate --manifest docs/audit/2026-07-stage-c/acceptance/receipt-manifest-v1.json --output docs/audit/2026-07-stage-c/acceptance/stage-c-acceptance-candidate-v1.json
```

Expected: build exits `0` with a stable candidate hash, `stageDAuthorized:false`, score policy matrix-v4, ScoreAnchorV3, zero shadow references, and no human acceptance file yet. Full commit-containment verification deliberately waits until the next step because the candidate cannot name the future commit containing itself.

- [ ] **Step 4: Commit the candidate, not acceptance**

```powershell
git add docs/audit/2026-07-stage-c/c6/postgres-zero-skip-v1.json docs/audit/2026-07-stage-c/c6/repository-isolation-v1.json docs/audit/2026-07-stage-c/c6/full-verification-v1.json docs/audit/2026-07-stage-c/acceptance/receipt-manifest-v1.json docs/audit/2026-07-stage-c/acceptance/stage-c-acceptance-candidate-v1.json
git commit -m "chore: build Stage C acceptance candidate"
$candidateReceiptCommit = git rev-parse HEAD
npm.cmd run stage-c:acceptance -- verify-candidate --candidate docs/audit/2026-07-stage-c/acceptance/stage-c-acceptance-candidate-v1.json --candidate-receipt-commit $candidateReceiptCommit
```

Expected: Git proves the candidate commit's sole parent is `testedSourceCommit`, its diff is exactly the allowlisted generated paths, receipt/candidate containment is non-circular, and verification exits `0`. The handoff must say `candidate built; human acceptance pending`. Do not mark Stage C complete.

## Task 6: Independent human acceptance and final verification

**Files:**

- Human-created later: `docs/audit/2026-07-stage-c/acceptance/stage-c-human-acceptance-v1.json`
- Modify only after valid acceptance: relevant `docs/knowledge/02-check-modes.md`
- Modify only after valid acceptance: `docs/knowledge/03-job-lifecycle.md`
- Modify only after valid acceptance: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify only after valid acceptance: `docs/knowledge/05-where-is-money-and-incoming.md`
- Modify only after valid acceptance: `docs/knowledge/06-deepcheck.md`
- Modify only after valid acceptance: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify only after valid acceptance: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify only after valid acceptance: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md` for remaining post-C gaps
- Modify only after valid acceptance: `docs/knowledge/14-current-roadmap.md`

- [ ] **Step 1: Stop and hand the candidate to an independent reviewer**

The reviewer examines the actual C0-C5 receipts, blind adjudication, non-interference projection, PostgreSQL zero-skip receipt, and known limitations. The implementation agent cannot complete this checkbox on the reviewer's behalf.

- [ ] **Step 2: Verify the independently authored file**

```powershell
$candidateReceiptCommit = git rev-parse HEAD
npm.cmd run stage-c:acceptance -- verify-acceptance --candidate docs/audit/2026-07-stage-c/acceptance/stage-c-acceptance-candidate-v1.json --candidate-receipt-commit $candidateReceiptCommit --human-acceptance docs/audit/2026-07-stage-c/acceptance/stage-c-human-acceptance-v1.json
```

Expected before review: exit `2`. Expected after a valid independent acceptance: exit `0`. A reject decision remains exit `2` and preserves the candidate/review artifacts.

- [ ] **Step 3: Update knowledge truth only after exit `0`**

Record that Stage C evidence/observer work is accepted but still score-neutral and not production-activated. Record that checked-subject role remains report-only/absent and Stage D remains blocked on separate human approval and its own plan. Do not describe matrix-v5 or ScoreAnchorV4 as current.

- [ ] **Step 4: Commit human acceptance and truth update separately**

```powershell
git add docs/audit/2026-07-stage-c/acceptance/stage-c-human-acceptance-v1.json docs/knowledge
git commit -m "docs: accept Stage C evidence closure"
```

This commit still does not authorize production rollout or Stage D.

## Hard aborts

- Any C0-C5 receipt is missing, unresolved where completeness is required, or hash/semantic invalid.
- The C0 source-authority commit is not a verified ancestor, its fixed Git blob is absent/different from the embedded manifest, or its first-add commit changes a non-allowlisted path; or C0b lacks either the complete or distinct typed-unavailable accepted-real-history current-balance control.
- The unique C1 or C5 runtime acceptance last-change commit cannot be derived below the global tested source, is not a single-parent direct child of the parsed embedded tested-source commit, changes anything other than its exact code-owned allowlist, or any required audit root/alias differs between evidence and global commits. The earlier C5 foundation is missing/changed across its parent/evidence/global chain or is incorrectly required to have been added by the runtime evidence commit.
- A C2 external population alias differs from its embedded acceptance graph; C3 does not pass both owning source-root/population verifiers against that external C2 root and the producer-owned C3 layout; or C4 does not obtain its runtime brand through `validateStageCBlindAuthorityValuesV1`, take the exact commit triple from acceptance, prove `preseedProtocolCommit -> expectationCommit -> testedResultCommit -> testedSourceCommit`, resolve the complete code-owned closure at its owning phase commits, keep acceptance out of the result commit, preserve evaluator/comparison/package bytes at the later commit, and pass `verifyStageCBlindPackageV1` plus the exact reconstructed-acceptance byte comparison.
- The general test suite skipped PostgreSQL files and no explicit zero-skip receipt exists.
- A standalone Stage C artifact is reachable from an accepted attempt, evidence bundle, finalizer, score, report, Admin DAG, or delivery.
- Legacy `24/24 + 6/6`, blind disjointness, two reviews, adjudication, or cashflow real complete/unresolved controls are absent.
- The candidate or CLI attempts to generate human approval.
- The reviewer is not independent from the implementation decision.
- Any knowledge update claims Stage D, matrix-v5, ScoreAnchorV4, scoring change, checked-subject suppression, production activation, or historical recalculation.
