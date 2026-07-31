# Stage C4 Blind Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing Stage C `24/24 + 6/6` regression corpus, then select, review, adjudicate, compare, and accept a separate deterministic blind `24 + 6` corpus without exposing model output before expectation lock.

**Architecture:** Add an offline-only `tools/stage-c-blind` workflow over canonical JSON and existing write-once artifact primitives. C4 consumes accepted C0a/C2/C3 authority inventories, freezes historical workbook metadata, and commits a protocol, future seed height, and paired metric input tape before the seed exists. After an authority-backed finalized seed selects a disjoint set, two reviews and adjudication are committed before the evaluator may load classifier output. The evaluator derives both behavior and paired metrics from frozen inputs; callers cannot submit result numbers. C4 changes no traversal, score, production config, schema, Admin, Telegram, or runtime artifact.

**Tech Stack:** TypeScript, Node.js standard library, Vitest, `tools/golden-pilot-v2/canonicalJson.ts`, and `tools/golden-pilot-v2/artifactStore.ts`; no new dependency and no Golden score/attribution schema reuse.

---

## Frozen Truth, Inputs, And Boundary

- Untracked workbook: `C:\Users\User\OneDrive\Desktop\smartcontract\outputs\service-wallet-analysis-20260726\service_wallet_behavior_analysis_2026-07-26.xlsx`.
- Workbook SHA-256: `e7c425f08f534ef5667a7310cd2713e5f2f37beb2b66f69c2dba8791131c62f2`.
- Untracked CSV root: `C:\Users\User\OneDrive\Desktop\smartcontract\csv addresses\`.
- It contains 23 physical files but 21 unique hashes. `Transfers_20260726.csv`, `(20)`, and `(22)` share SHA `2270c4609db088ae7ba919e8b9130e813afab1fc7bc693698cb94b0b0603a6b2`; tracked corpus references `(20)`.
- Tracked corpus: `tests/fixtures/forensics/forensic-model-offline-corpus-v1.json` via `tests/fixtures/forensics/loadForensicModelCorpus.ts`.
- Current service cases: 21 `csv-*` plus `w8srl-two-window-calibration`, `tqr-d7nzp-recorded-control`, and `txc-vusxvhd-recorded-control`.
- Current adverse cases: `exact-binance-label`, `exact-htx-label`, `event-time-blacklist-partitions`, `gasfree-principal-fee-classification`, `drainer-method-only`, `drainer-complete-evidence`.
- Existing gate: `src/forensics/serviceRoleShadowGate.ts`, `scripts/replayServiceRoleShadowGate.ts`, `tests/forensics/serviceRoleShadowGate.test.ts`.
- Historical fields `Экспертная оценка`, `Рекомендация границы`, `A/S`, `Исследовательская группа` are preserved verbatim with `runtimeInput:false`; they never become authority, action, or score.

C4 starts only when these canonical accepted inputs exist and cross-bind by SHA:

- `docs/audit/2026-07-stage-c/c0/physical-population-feasibility-v1.json`;
- `docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json`;
- `docs/audit/2026-07-stage-c/c2/physical-population-v1/physical-candidate-inventory-v1.json`;
- `docs/audit/2026-07-stage-c/c3/adverse-candidate-inventory-v1.json`;
- `docs/audit/2026-07-stage-c/c3/adverse-population-receipt-v1.json`.

C4 never fetches provider evidence, infers EOA-at-anchor, repairs adverse authority, changes a quota, or substitutes an undersized population. Reviewer/operator workspaces remain under ignored `artifacts/stage-c-blind-v1/`; only immutable locks and receipts enter `docs/audit/2026-07-stage-c/c4/`.

## Exact File Map

Create:

- `tools/stage-c-blind/contracts.ts` — strict schemas/parsers and forbidden-field checks.
- `tools/stage-c-blind/legacyCorpus.ts` — workbook/CSV hashing and `21 + 3 + 6` reconciliation.
- `tools/stage-c-blind/selection.ts` — protocol, future seed, population, exclusion, collision, rejection, and selection.
- `tools/stage-c-blind/review.ts` — neutral packs, review locks, adjudication, expectation manifest.
- `tools/stage-c-blind/evaluator.ts` — post-expectation physical/adverse evaluation and paired metric derivation.
- `tools/stage-c-blind/comparator.ts` — evaluator-output parser and safety/utility gates.
- `tools/stage-c-blind/acceptance.ts` — hash-graph verification and accepted/failed package receipts.
- `tools/stage-c-blind/cli.ts`, `scripts/stageCBlind.ts` — one offline CLI.
- `tests/stage-c-blind/{builders,contracts,legacyCorpus,selection,review,evaluator,comparator,acceptance,cli.acceptance,isolation}.ts` using `.test.ts` for all except `builders.ts`.

Reuse only:

```ts
import { canonicalJson, canonicalSha256 } from "../golden-pilot-v2/canonicalJson";
import { publishArtifactOnce, verifyPublishedArtifact, type PublishedArtifact }
  from "../golden-pilot-v2/artifactStore";
import {
  SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1,
  SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1,
  SERVICE_BOUNDARY_ADVERSE_REGISTRY_V1,
  serviceBoundaryAdverseArtifactRelativePathV1,
  validateC2AdverseSourceRootV1,
  validateServiceBoundaryAdversePopulationGraphV1,
  type ResolvedServiceBoundaryAdverseC2ArtifactV1,
  type ServiceBoundaryAdverseC2ArtifactRefV1,
  type ValidatedC2AdverseSourceRootV1
} from "../../src/forensics/serviceBoundaryAdverseProbe";
```

Do not import Golden attribution, neutral-export, review, adjudication, score, or locked-manifest types.
For C4 audit files, byte identity is exactly the owning Golden primitive's `canonicalJson(...)` output as written by `publishArtifactOnce`; do not append a newline. Every verifier delegates to `verifyPublishedArtifact` before parsing.

## Core Contracts

```ts
export const STAGE_C_BLIND_STRATUM_ORDER_V1 = [
  "intermediate_eoa_complete", "checked_subject_control",
  "contract_at_anchor_control", "authority_incomplete_control",
  "event_time_blacklist", "active_sanctions", "drainer_collector",
  "restricted_service", "verify20_terminal", "exact_bound_nonterminal"
] as const;

export const STAGE_C_BLIND_QUOTAS_V1 = {
  intermediate_eoa_complete: 15, checked_subject_control: 3,
  contract_at_anchor_control: 3, authority_incomplete_control: 3,
  event_time_blacklist: 1, active_sanctions: 1, drainer_collector: 1,
  restricted_service: 1, verify20_terminal: 1, exact_bound_nonterminal: 1
} as const;

export type StageCBlindExpectedActionV1 =
  | "stop_at_boundary" | "continue_full" | "unresolved_continue_full";
export type StageCBlindAuthorityCompletenessV1 = "complete" | "incomplete" | "conflict";
export type StageCBlindReviewV1 = {
  schemaVersion: "stage-c-blind-review-v1";
  caseId: string;
  neutralBundleSha256: string;
  reviewerId: "reviewer-a" | "reviewer-b";
  roleInterpretation: "boundary_eligible_service" | "ordinary_non_boundary" |
    "checked_subject_excluded" | "contract_at_anchor" |
    "authority_incomplete" | "adverse_preservation_challenge";
  authorityCompleteness: StageCBlindAuthorityCompletenessV1;
  expectedAction: StageCBlindExpectedActionV1;
  redEventIds: readonly string[];
  continuationIds: readonly string[];
  reason: string;
};
```

All parsers reject unknown keys, duplicate semantic IDs, invalid lowercase SHA-256, non-canonical TRON addresses/integers/timestamps, unsorted set-like arrays, and `undefined`. Population, protocol, metric-tape, selection, and neutral-pack inputs recursively reject `classifierStatus`, `predicates`, `thresholds`, `expectedAction`, `score`, and `modelRank`. `expectedAction` is admitted only by the explicit human review/adjudication/expectation schemas after selection; classifier output, predicates, thresholds, score, and model rank remain forbidden there until the expectation commit is cleanly locked.

Freeze these exact authority mappings; selection never derives a stratum from labels, prose, or a positive outcome alone:

```ts
export const STAGE_C_BLIND_PHYSICAL_STRATUM_MAP_V1 = {
  intermediate_eoa_complete: {
    c0FeasibilityStratum: "intermediate_complete",
    c2ControlStratum: "intermediate_eoa_complete"
  },
  checked_subject_control: {
    c0FeasibilityStratum: "checked_subject_control",
    c2ControlStratum: "checked_subject_control"
  },
  contract_at_anchor_control: {
    c0FeasibilityStratum: "contract_at_anchor_control",
    c2ControlStratum: "contract_at_anchor_control"
  },
  authority_incomplete_control: {
    c0FeasibilityStratum: "authority_incomplete_control",
    c2ControlStratum: "authority_incomplete_control"
  }
} as const;

export const STAGE_C_BLIND_ADVERSE_EVIDENCE_CLASS_MAP_V1 = {
  event_time_blacklist: {
    feasibilityStratum: "event_time_blacklist",
    c2ControlStratum: "adverse_authority_candidate",
    c3EvidenceClass: "event_time_blacklist"
  },
  active_sanctions: {
    feasibilityStratum: "active_sanctions_or_restriction",
    c2ControlStratum: "adverse_authority_candidate",
    c3EvidenceClass: "active_sanctions_or_restriction"
  },
  drainer_collector: {
    feasibilityStratum: "tracked_drainer_or_collector",
    c2ControlStratum: "adverse_authority_candidate",
    c3EvidenceClass: "tracked_drainer_or_collector"
  },
  restricted_service: {
    feasibilityStratum: "exact_restricted_service",
    c2ControlStratum: "adverse_authority_candidate",
    c3EvidenceClass: "exact_restricted_service"
  },
  verify20_terminal: {
    feasibilityStratum: "verify20_terminal",
    c2ControlStratum: "adverse_authority_candidate",
    c3EvidenceClass: "verify20_terminal"
  },
  exact_bound_nonterminal: {
    feasibilityStratum: "exact_bound_nonterminal",
    c2ControlStratum: "adverse_authority_candidate",
    c3EvidenceClass: "exact_bound_nonterminal"
  }
} as const;

export const STAGE_C_BLIND_INTERMEDIATE_EXACT_SERVICE_EXCLUSION_CHECKS_V1 = [
  "exact_service_exchange_identity",
  "exact_restricted_service"
] as const;
```

The physical map resolves the deliberate C0 `intermediate_complete` versus C2/C4 `intermediate_eoa_complete` naming difference; no string coercion is allowed. C4 maps only its six quota names to C0/C2 and the C3 evidence-class key. It imports `SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1` and the owning C3 row registry to derive required check IDs, authority classes, dispositions, and `all_of | any_of`; it never redeclares those values. In particular, `exact_bound_nonterminal` is satisfied only under C3's exact two-ID `any_of` rule, while both mandatory rows remain present. Tests prove every physical/adverse stratum maps to exactly these identities and that a copied/changed C3 map, unknown key, or heuristic substitution fails.

The two intermediate exclusion IDs are exact event-time authority paths, not inferred classifier labels. Before seeded ordering, C4 revalidates every intermediate candidate's complete C3 matrix/receipt and mechanically excludes it with `already_exact_service_boundary` if either row is `proven` with the owning C3 registry's exact authority/disposition and event/snapshot binding. An unresolved/not-found row follows C3 semantics and cannot be rewritten as exact identity. Thus none of the selected 15 intermediates already has a known exact service boundary, and exact identity is never measured as an inferred classifier stop.

Every C3-consuming phase enters through one owning root gate:

```ts
export type StageCBlindC2ArtifactResolverV1 = (
  ref: ServiceBoundaryAdverseC2ArtifactRefV1
) => ResolvedServiceBoundaryAdverseC2ArtifactV1;

export type StageCBlindC3ArtifactResolverV1 =
  Parameters<
    typeof validateServiceBoundaryAdversePopulationGraphV1
  >[0]["resolveArtifact"];

const VALIDATED_STAGE_C_BLIND_AUTHORITY_ROOTS_V1: unique symbol =
  Symbol("validated-stage-c-blind-authority-roots-v1");
export type ValidatedStageCBlindAuthorityRootsV1 = {
  readonly c2Root: ValidatedC2AdverseSourceRootV1;
  readonly resolveC2Artifact: StageCBlindC2ArtifactResolverV1;
  readonly resolveC3Artifact: StageCBlindC3ArtifactResolverV1;
  readonly c3Population: ReturnType<
    typeof validateServiceBoundaryAdversePopulationGraphV1
  >;
  readonly [VALIDATED_STAGE_C_BLIND_AUTHORITY_ROOTS_V1]: true;
};

export function validateStageCBlindAuthorityValuesV1(input: {
  readonly acceptedC2Root: ValidatedC2AdverseSourceRootV1;
  readonly resolveC2Artifact: StageCBlindC2ArtifactResolverV1;
  readonly populationReceiptValue: unknown;
  readonly expectedPopulationReceiptSha256: string;
  readonly resolveC3Artifact: StageCBlindC3ArtifactResolverV1;
}): ValidatedStageCBlindAuthorityRootsV1;

export function validateStageCBlindAuthorityRootsV1(input: {
  readonly physicalAcceptancePath: string;
  readonly physicalPopulationRoot: string;
  readonly adverseRoot: string;
}): ValidatedStageCBlindAuthorityRootsV1;
```

`validateStageCBlindAuthorityValuesV1()` is the side-effect-free authority producer for filesystem bytes and for C6 Git-object bytes. It accepts only an independently produced `ValidatedC2AdverseSourceRootV1`, the exact C2/C3 byte resolvers, the C3 population-receipt value, and its expected SHA. It passes the full graph unchanged to `validateServiceBoundaryAdversePopulationGraphV1()` with `acceptedC2Root`, mapping `resolveC3Artifact` only to that verifier's `resolveArtifact`; C4 neither strips nor reinterprets `kind:"authority_leaf"`. It returns only after the owning C3 verifier exact-compares the external root to the root embedded in C3, rebuilds every branded candidate context and matrix, and resolves/reparses/rehashes/cross-binds every typed authority leaf body. This function alone installs the module-private, non-enumerable unique-symbol brand; every consumer performs the runtime brand check, so a cast, plain-object copy, caller-produced boolean, missing/detached leaf, or hash-only leaf rejects. It performs no path discovery, filesystem, Git, database, or network access.

`validateStageCBlindAuthorityRootsV1()` is only the filesystem adapter. It resolves `physicalAcceptancePath` and the fixed `physical-candidate-inventory-v1.json` beneath `physicalPopulationRoot`, computes their exact canonical UTF-8 refs, constructs the C3-owned source-root value, and calls `validateC2AdverseSourceRootV1()` with a repository-relative, bounded, symlink-rejecting C2 resolver. Under `adverseRoot` it accepts only the fixed population receipt plus paths produced by imported `SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1` and `serviceBoundaryAdverseArtifactRelativePathV1()`; unknown, duplicate, orphan, alternate-layout, out-of-root, hash-conflicting, or symlink entries reject. It reads and hashes the fixed population receipt, then delegates all graph validation and brand creation to `validateStageCBlindAuthorityValuesV1()`. The adapter cannot construct or copy the brand itself.

`StageCBlindMetricTapeLockInputV1`, `StageCBlindProtocolLockInputV1`, `StageCBlindPopulationInputV1`, and the evaluator authority input accept only a runtime-branded `ValidatedStageCBlindAuthorityRootsV1`, never raw candidate arrays, inventory hashes, C3 rows, evidence-class maps, caller-produced validation booleans, or a TypeScript cast. Each CLI phase rebuilds this opaque value from its three path arguments; a Git-backed consumer such as C6 supplies exact bytes/resolvers to the same pure producer. No phase trusts an opaque value persisted by an earlier process. Both entry paths are offline and read no PostgreSQL state.

The pre-seed metric artifact is an input tape, not reported results:

```ts
export type StageCBlindPairedMetricTapeV1 = {
  schemaVersion: "stage-c-blind-paired-metric-tape-v1";
  populationSourceSha256s: readonly string[];
  providerMetricSource: {
    sourceKind: "accepted_runtime_artifact_graph_v1";
    requestIndexSha256: string;
    rawArtifactRefs: readonly PublishedArtifact[];
    parserVersion: "stage-c-blind-metric-source-v1";
  };
  entries: readonly StageCBlindMetricInputEntryV1[];
  productionEffect: false;
};
```

It covers the full eligible C2/C3 universe, keyed by frozen candidate identity, and contains hash-verified logical graph edges plus raw request/page/wait timestamps needed to replay a baseline full continuation and a candidate truncation. It contains no classifier result, expected action, precomputed aggregate, or caller-supplied baseline/candidate metric. Protocol locking binds its SHA before the seed; evaluation later selects entries by the committed selection and derives integers from source bytes.

### Task 1: Strict Contracts And Isolation

**Files:** Create `tools/stage-c-blind/contracts.ts`, `tests/stage-c-blind/builders.ts`, `tests/stage-c-blind/contracts.test.ts`, `tests/stage-c-blind/isolation.test.ts`.

- [ ] Write failing tests for exact order/quotas, unknown keys, each forbidden pre-lock field, canonical IDs/hashes, and total quota `30`.
- [ ] Run `npm test -- tests/stage-c-blind/contracts.test.ts tests/stage-c-blind/isolation.test.ts`; expect FAIL because the module is missing.
- [ ] Implement the constants/types above and these exact exports:

```ts
export function parseStageCBlindProtocolV1(value: unknown): StageCBlindProtocolV1;
export function serializeStageCBlindProtocolV1(value: StageCBlindProtocolV1): string;
export function parseStageCBlindMetricSourceManifestV1(value: unknown): StageCBlindMetricSourceManifestV1;
export function serializeStageCBlindMetricSourceManifestV1(value: StageCBlindMetricSourceManifestV1): string;
export function parseStageCBlindPairedMetricTapeV1(value: unknown): StageCBlindPairedMetricTapeV1;
export function serializeStageCBlindPairedMetricTapeV1(value: StageCBlindPairedMetricTapeV1): string;
export function parseStageCBlindSeedReceiptV1(value: unknown): StageCBlindSeedReceiptV1;
export function serializeStageCBlindSeedReceiptV1(value: StageCBlindSeedReceiptV1): string;
export function parseStageCBlindSelectionV1(value: unknown): StageCBlindSelectionV1;
export function serializeStageCBlindSelectionV1(value: StageCBlindSelectionV1): string;
export function parseStageCBlindNeutralBundleV1(value: unknown): StageCBlindNeutralBundleV1;
export function serializeStageCBlindNeutralBundleV1(value: StageCBlindNeutralBundleV1): string;
export function parseStageCBlindCandidateV1(value: unknown): StageCBlindCandidateV1;
export function serializeStageCBlindCandidateV1(value: StageCBlindCandidateV1): string;
export function parseStageCBlindReviewV1(value: unknown): StageCBlindReviewV1;
export function serializeStageCBlindReviewV1(value: StageCBlindReviewV1): string;
export function parseStageCBlindReviewLockV1(value: unknown): StageCBlindReviewLockV1;
export function serializeStageCBlindReviewLockV1(value: StageCBlindReviewLockV1): string;
export function parseStageCBlindAdjudicationV1(value: unknown): StageCBlindAdjudicationV1;
export function serializeStageCBlindAdjudicationV1(value: StageCBlindAdjudicationV1): string;
export function parseStageCBlindExpectationManifestV1(value: unknown): StageCBlindExpectationManifestV1;
export function serializeStageCBlindExpectationManifestV1(value: StageCBlindExpectationManifestV1): string;
export function parseStageCBlindEvaluatorOutputV1(value: unknown): StageCBlindEvaluatorOutputV1;
export function serializeStageCBlindEvaluatorOutputV1(value: StageCBlindEvaluatorOutputV1): string;
export function parseStageCBlindComparisonV1(value: unknown): StageCBlindComparisonV1;
export function serializeStageCBlindComparisonV1(value: StageCBlindComparisonV1): string;
export function parseStageCBlindPackageV1(value: unknown): StageCBlindPackageV1;
export function serializeStageCBlindPackageV1(value: StageCBlindPackageV1): string;
export function parseStageCBlindSeedBlockWitnessV1(value: unknown): StageCBlindSeedBlockWitnessV1;
export function serializeStageCBlindSeedBlockWitnessV1(value: StageCBlindSeedBlockWitnessV1): string;
export function parseStageCLegacyCorpusExportV1(value: unknown): StageCLegacyCorpusExportV1;
export function serializeStageCLegacyCorpusExportV1(value: StageCLegacyCorpusExportV1): string;
export function parseStageCBlindAcceptanceReceiptV1(value: unknown): StageCBlindAcceptanceReceiptV1;
export function serializeStageCBlindAcceptanceReceiptV1(value: StageCBlindAcceptanceReceiptV1): string;
export function assertNoPrelockModelFields(value: unknown): void;
```

Every parser above is the only owning parser for its named C4 schema, rejects unknown keys, and recomputes its internal counts/hashes. Every paired serializer delegates to Golden `canonicalJson`, matches `publishArtifactOnce` byte-for-byte, returns exact UTF-8 text with no LF, and is exported from the same owning module as its parser. `contracts.test.ts` imports every exact symbol so a missing/renamed parser or serializer is a compile/test failure; downstream C6 never supplies a generic schema parser.

- [ ] Make isolation tests scan `tools/stage-c-blind/`: only `evaluator.ts` and `comparator.ts` may mention model output, and neither is importable by protocol/selection/review modules; no file may import scoring, DB, provider, Admin, Telegram, or forbidden Golden modules.
- [ ] Re-run the focused command; expect PASS with zero skips.
- [ ] Stage the Task 1 files, then commit `test: define Stage C4 blind contracts`.

### Task 2: Canonical Legacy Freeze

**Files:** Create `tools/stage-c-blind/legacyCorpus.ts`, `tests/stage-c-blind/legacyCorpus.test.ts`.

- [ ] Write failing tests for approved workbook SHA, 21 unique manual rows mapped one-to-one to 21 tracked `csv-*`, three named controls, six named adverse cases, duplicate physical CSV disclosure, and `runtimeInput:false` everywhere.
- [ ] Run `npm test -- tests/stage-c-blind/legacyCorpus.test.ts`; expect FAIL for missing export.
- [ ] Implement without an XLSX dependency:

```ts
export type StageCLegacyManualRowV1 = {
  caseId: string;
  address: string;
  historicalFields: {
    "Экспертная оценка": string;
    "Рекомендация границы": string;
    "A/S": string;
    "Исследовательская группа": string;
  };
  runtimeInput: false;
};
export type StageCLegacyCorpusExportV1 = {
  schemaVersion: "stage-c-legacy-corpus-export-v1";
  workbookSha256: "e7c425f08f534ef5667a7310cd2713e5f2f37beb2b66f69c2dba8791131c62f2";
  manualRows: readonly StageCLegacyManualRowV1[];
  serviceCaseIds: readonly string[];
  adverseCaseIds: readonly string[];
  regression: {
    servicePassed: 24; serviceTotal: 24;
    adversePassed: 6; adverseTotal: 6;
    mismatchCaseIds: readonly [];
    gateSchemaVersion: "service-role-shadow-gate-v1";
    trackedCorpusSha256: string;
  };
  blind: false;
  runtimeInput: false;
};
export async function freezeStageCLegacyCorpusV1(input: {
  workbookPath: string; manualRows: unknown; trackedCorpus: unknown; csvDirectoryPath: string;
}): Promise<StageCLegacyCorpusExportV1>;
export function parseStageCLegacyCorpusExportV1(value: unknown): StageCLegacyCorpusExportV1;
```

- [ ] Hash workbook/CSV bytes with `node:crypto`; bind human-exported UTF-8 rows to workbook SHA and tracked sources; invoke the existing gate on the exact tracked-corpus bytes and persist its exact `24/24 + 6/6` counts/mismatch list in schema `stage-c-legacy-corpus-export-v1`, with `blind:false`, 24 service and 6 adverse. `parseStageCLegacyCorpusExportV1` recomputes the corpus hash and rejects anything except the frozen zero-mismatch gate result.
- [ ] Add fail-closed tests for 20/22 rows, mutated SHA, missing field/control, extra adverse, unmatched address, and `runtimeInput:true`.
- [ ] Run `npm test -- tests/stage-c-blind/legacyCorpus.test.ts tests/forensics/serviceRoleShadowGate.test.ts` and `node --import tsx scripts/replayServiceRoleShadowGate.ts`; expect PASS and `24/24 + 6/6`, no mismatches.
- [ ] Stage the Task 2 files, then commit `feat: freeze the Stage C legacy corpus`.

### Task 3: Preconditions, Pre-seed Locks, Seed Authority, And Selection

**Files:** Create `tools/stage-c-blind/selection.ts`, `tests/stage-c-blind/selection.test.ts`; modify `contracts.ts`.

- [ ] Write failing tests for missing/rejected/hash-conflicting C0a/C2/C3, missing external C2 acceptance, external/embedded C2-root mismatch, a detached but structurally valid C2 acceptance/inventory pair, a missing/duplicate/alternate-layout/out-of-root/symlink C2 or C3 artifact, and a missing/detached/hash-only/wrong-family C3 authority leaf or mutated leaf subject/event/snapshot/finality/continuation binding, plus insufficient per-stratum universe, an incomplete metric source graph, caller-provided aggregate metrics, every adverse mapping substitution, and any pre-lock model field. Prove all four C3-consuming builders reject raw roots, a plain object cast to `ValidatedStageCBlindAuthorityRootsV1`, and a copied branded value; the private symbol is installed only by `validateStageCBlindAuthorityValuesV1()` after its owning full C3 graph call succeeds. Build checkout A and a byte-different checkout B: the B filesystem wrapper must reject A-bound inputs, while exact `git show <tested-commit>:<path>` bytes/resolvers from A passed to the pure value validator must reproduce A successfully without consulting B. Pass a separately valid C2 root A to a C3 graph bound to root B and prove the pure validator rejects it as detached.
- [ ] Define protocol fields: schema, lock time/head, population cutoff block/time, future seed height, paired metric tape SHA, approved seed source/parser/finality rule, source refs, exclusion hash, frozen order/quotas, allowed mechanical rejections, and `first_sorted_eligible_until_quota_v1`.
- [ ] Define the strict seed source contract:

```ts
export type StageCBlindPreseedHeadWitnessV1 = {
  schemaVersion: "stage-c-blind-preseed-head-witness-v1";
  chain: "tron";
  observedAt: string;
  latestBlockNumber: number;
  latestBlockHash: string;
  source: {
    sourceAuthority: "c0_approved_tron_block_source_v1";
    requestIdentitySha256: string;
    rawPayloadSha256: string;
    requestArtifact: PublishedArtifact;
    rawPayloadArtifact: PublishedArtifact;
    parserVersion: "stage-c-blind-tron-block-source-v1";
  };
  witnessSha256: string;
};

export type StageCBlindSeedBlockWitnessV1 = {
  schemaVersion: "stage-c-blind-seed-block-witness-v1";
  chain: "tron";
  blockNumber: number;
  blockHash: string;
  parentBlockHash: string;
  blockTimestamp: string;
  observedSolidifiedHead: number;
  confirmationCount: number;
  finalizedAt: string;
  finalityRule: { kind: "tron_solidified_v1"; minimumConfirmations: number };
  source: {
    sourceAuthority: "c0_approved_tron_block_source_v1";
    requestIdentitySha256: string;
    requestPayloadSha256: string;
    rawPayloadSha256: string;
    requestArtifact: PublishedArtifact;
    rawPayloadArtifact: PublishedArtifact;
    parserVersion: "stage-c-blind-tron-block-source-v1";
  };
  witnessSha256: string;
};
```

Each witness SHA is the canonical hash of all preceding fields. `validateStageCBlindPreseedHeadWitnessSourcesV1()` resolves/reparses the raw latest-block source bytes and `lockStageCBlindProtocolV1` accepts only its opaque validated result; the caller cannot type a low locked head. The seed parser requires lowercase 64-hex block and parent hashes, safe nonnegative integers, `blockNumber === protocol.futureSeedHeight`, `observedSolidifiedHead >= blockNumber`, and a confirmation count exactly recomputed from the solidified head and satisfying the protocol's frozen finality rule. `validateStageCBlindSeedBlockWitnessSourcesV1()` resolves both source artifacts, verifies their exact bytes against the two declared payload hashes, recomputes request identity, reruns the protocol-approved C0/Tron block parser, and recomputes every block/finality field. A typed or copied hash without those raw bytes is invalid.

- [ ] Implement and test:

```ts
export function lockStageCBlindPairedMetricTapeV1(
  input: StageCBlindMetricTapeLockInputV1
): StageCBlindPairedMetricTapeV1;
export function lockStageCBlindProtocolV1(input: StageCBlindProtocolLockInputV1): StageCBlindProtocolV1;
export async function validateStageCBlindPreseedHeadWitnessSourcesV1(
  witness: StageCBlindPreseedHeadWitnessV1,
  resolver: StageCBlindPublishedArtifactResolverV1
): Promise<ValidatedStageCBlindPreseedHeadWitnessV1>;
export function parseStageCBlindSeedBlockWitnessV1(value: unknown): StageCBlindSeedBlockWitnessV1;
export async function validateStageCBlindSeedBlockWitnessSourcesV1(
  witness: StageCBlindSeedBlockWitnessV1,
  resolver: StageCBlindPublishedArtifactResolverV1
): Promise<ValidatedStageCBlindSeedBlockWitnessV1>;
export function finalizeStageCBlindSeedV1(input: {
  protocol: StageCBlindProtocolV1;
  witness: ValidatedStageCBlindSeedBlockWitnessV1;
  preseedProtocolCommit: string;
}): StageCBlindSeedReceiptV1;
export function buildStageCBlindPopulationV1(input: StageCBlindPopulationInputV1): StageCBlindPopulationBuildV1;
export function selectStageCBlindCasesV1(input: StageCBlindSelectionInputV1): StageCBlindSelectionBuildV1;
```

- [ ] Implement `validateStageCBlindAuthorityValuesV1()` first as the only unique-symbol brand producer. It accepts the independently validated C2 root, exact C2/C3 resolvers, raw C3 population-receipt value, and expected receipt SHA; it delegates the whole graph, including every typed `authority_leaf`, unchanged to `validateServiceBoundaryAdversePopulationGraphV1()` and brands only its successful result. Then implement `validateStageCBlindAuthorityRootsV1()` as a filesystem-only adapter: build the external C2 source root from the exact acceptance file and bounded physical population, invoke `validateC2AdverseSourceRootV1()`, resolve the fixed C3 receipt and only paths from the imported C3 layout/helper (including `authority-leaves/<sha256>.json`), and delegate to the pure producer. Rebuild every branded context and exact authority body; reject a C3-embedded root that differs from the external acceptance even when both graphs are structurally valid. Add an isolation assertion that no function other than the pure producer mentions `VALIDATED_STAGE_C_BLIND_AUTHORITY_ROOTS_V1` as a write site.
- [ ] Make metric-tape locking resolve and hash every provider/request/page source byte for the full eligible universe. Derive its candidate identity/index only from the validated authority-root gate; reject missing/extra candidates, precomputed result aggregates, model fields, duplicate logical requests, source collisions, or a source after the protocol cutoff.
- [ ] Require `futureSeedHeight > lockedHead`, and require the protocol to bind the already-published metric tape SHA. `finalizeStageCBlindSeedV1` accepts only a validated witness and a clean pre-seed commit that contains byte-identical legacy, tape, and protocol artifacts; its `selectionSeed` is the verified lowercase block hash.
- [ ] Define sort key as `canonicalSha256({selectionSeed,stratum,address,anchorEventId,snapshotHash})`; prove input-reorder and rerun byte invariance.
- [ ] Enforce exclusions against current 24+6, W8/98cdn/aEGqTr/TQr/TXc, CSV/model-development, Binance/HTX regression, synthetic fixtures, C/B/G/H/R/X design addresses, and every manual-corpus address/hash. Prove the selected `24 + 6` is disjoint from the retained corpus; the blind set never replaces it.
- [ ] Reconcile the entire accepted C0/C2/C3 universe from `ValidatedStageCBlindAuthorityRootsV1` before selection and test an over-quota input: every eligible candidate must be present in the committed population/tape, while the seeded output alone is exactly `15/3/3/3 + 6`. A missing candidate with unchanged C0/C2/C3 roots is tampering, not a smaller universe.
- [ ] For every `intermediate_eoa_complete` candidate, rebuild its C3 matrix/receipt before computing the sort key. Log and exclude `already_exact_service_boundary` when either exact-service exclusion row is a registry-valid proven event-time authority; prove such a candidate is replaced by the next seeded eligible key and never reaches the classifier/evaluator.
- [ ] Resolve adverse candidates only through `STAGE_C_BLIND_ADVERSE_EVIDENCE_CLASS_MAP_V1` plus the imported C3 requirement/row registries; require its exact C0 feasibility stratum, matching C2 `adverse_authority_candidate` row/class/binding, and C3-owned positive requirement. Flat labels, copied check-ID maps, prose, provider risk, and method-name heuristics cannot populate a quota.
- [ ] Process strata in frozen order. Claim globally by candidate ID, address, snapshot, and captured subject; log `already_claimed_by:<stratum>` and take the next sort key.
- [ ] Preserve every mechanical rejection; stop a stratum immediately at quota; abort `stage_c4_population_exhausted:<stratum>` without borrowing or replacement.
- [ ] Run `npm test -- tests/stage-c-blind/contracts.test.ts tests/stage-c-blind/selection.test.ts`; expect PASS and exact 15+3+3+3+six singletons.
- [ ] Stage the Task 3 files, then commit `feat: lock and select the Stage C4 blind set`.

### Task 4: Neutral Packs, Two Reviews, And Adjudication

**Files:** Create `tools/stage-c-blind/review.ts`, `tests/stage-c-blind/review.test.ts`.

- [ ] Write failing neutral tests retaining authority/event/continuation facts but recursively excluding address, captured subject, classifier, predicates, thresholds, expected action, score, and model rank.
- [ ] Implement write-once neutral publication:

```ts
export function buildStageCBlindNeutralBundleV1(input: StageCBlindNeutralInputV1): StageCBlindNeutralBundleV1;
export async function publishStageCBlindNeutralBundleV1(root: string, bundle: StageCBlindNeutralBundleV1): Promise<PublishedArtifact>;
```

- [ ] Write failing tests for two distinct reviewer IDs, 30 complete reviews each, immutable neutral hash, sorted IDs, non-empty reason, and no default classification/action in editable drafts.
- [ ] Implement `prepareStageCBlindReviewWorkspaceV1`, `lockStageCBlindReviewsV1`, `openStageCBlindAdjudicationV1`, and `finalizeStageCBlindAdjudicationV1`.
- [ ] Require every field disagreement to be resolved before finalization; reject invented event IDs, missing/extra resolution, same reviewer ID, or changed neutral hash.
- [ ] Implement `lockStageCBlindExpectationManifestV1`; bind selection, paired metric tape, 30 neutral, 60 review, and 30 adjudication hashes; assert model output is absent.
- [ ] At expectation lock, require at least six adjudicated `boundary_eligible_service + stop_at_boundary` positives and at least six adjudicated `ordinary_non_boundary + continue_full` negatives **inside the 15 `intermediate_eoa_complete` cases**. Controls and the six adverse cases cannot satisfy either quota. Persist the exact sorted positive and negative case IDs in the expectation manifest; no reclassification after lock.
- [ ] Run `npm test -- tests/stage-c-blind/review.test.ts`; expect PASS and overwrite attempts rejected.
- [ ] Stage the Task 4 files, then commit `feat: lock Stage C4 blind expectations`.

### Task 5: Post-expectation Evaluator And Derived Paired Metrics

**Files:** Create `tools/stage-c-blind/evaluator.ts`, `tests/stage-c-blind/evaluator.test.ts`; modify `contracts.ts`.

- [ ] Write failing tests that the evaluator refuses an uncommitted/dirty expectation lock, a selection/tape/source hash mismatch, a raw authority root, a plain-object/TypeScript-cast brand substitute, a valid brand over C2/C3 roots different from those bound by the selection/tape, a pre-lock invocation, caller-provided result or metric fields, a missing tape entry, or an extra selected case. Separately prove the filesystem CLI propagates every C2/C3 parser failure before `evaluateStageCBlindV1()` is invoked.
- [ ] Define strict `stage-c-blind-evaluator-output-v1`: exact pre-seed protocol commit, expectation commit/hash, selection/tape hashes, 30 sorted case results, separate observed service-boundary action and adverse endpoint disposition, classifier status where permitted, red/continuation/future/duplicate IDs, and per-case paired baseline/candidate derived metrics for logical calls, physical HTTP calls, cache categories, histories, pages, provider wait milliseconds, and end-to-action milliseconds. An exact terminal is never serialized as an inferred service stop.
- [ ] Implement the only post-lock classifier entry point:

```ts
export async function evaluateStageCBlindV1(input: {
  readonly authorityRoots: ValidatedStageCBlindAuthorityRootsV1;
  readonly protocol: StageCBlindProtocolV1;
  readonly selection: StageCBlindSelectionV1;
  readonly expectation: StageCBlindExpectationManifestV1;
  readonly metricTape: StageCBlindPairedMetricTapeV1;
  readonly expectationCommit: string;
}): Promise<StageCBlindEvaluatorOutputV1>;
```

- [ ] `evaluateStageCBlindV1()` runtime-checks the module-private brand on `authorityRoots` before model code loads and accepts no filesystem path, raw root, resolver, parser-success boolean, or TypeScript-cast substitute. The CLI must first call `validateStageCBlindAuthorityRootsV1()` with the exact `--physical-acceptance`, `--physical-root`, and `--adverse-root` arguments and pass only that returned value; Git-backed package verification calls `validateStageCBlindAuthorityValuesV1()` over exact bound-commit bytes and passes its returned value. Both paths therefore rerun the owning C2 parsers/serializers, external-versus-embedded C2-root comparison, C3 population graph verifier, and every branded candidate context before evaluation. Call `buildServiceBoundaryPhysicalProfileV1()` only for the 15 `intermediate_eoa_complete` cases; for the three checked-subject, three contract-at-anchor, and three proven-incomplete controls, preserve the typed C2 authority outcome and do not invoke the adapter that intentionally rejects them. Rerun `runServiceBoundaryAdverseProbeV1()` plus `reduceServiceBoundaryAdverseReceiptV1()` for every selected candidate against its context-validated frozen matrix—not only the six adverse quota cases. The six challenges additionally require their C3-owned mapped exact positive row. Do not copy C/B/G/H/R/X thresholds, adverse policy, or role logic into C4.
- [ ] Derive candidate action only from those returned C2/C3 values plus frozen C4 stratum semantics. For an admissible intermediate, only `high_inferred_service` with complete physical/EOA/role/order authority and `adverse_clear_for_boundary` may stop ordinary expansion; `non_service_profile`, `insufficient_data`, `role_conflict`, and all merely probable/service-like/professional/human-like labels continue full. A checked subject remains excluded/report-only; contract and incomplete/conflict controls continue full (typed unresolved where appropriate). A C3 exact terminal/continuation remains a separate adverse endpoint disposition and all exact IDs survive even when the service boundary would stop ordinary history.
- [ ] For every selected case, resolve its frozen tape entry and raw artifacts. Replay the same logical graph twice: baseline always follows the full-continuation path; candidate follows the derived action and truncates only at its derived boundary. Count unique logical request identities, physical non-cache executions, frozen cache categories, completed histories/pages, sum raw provider wait intervals, and derive end-to-action from frozen timestamps. Reject overlaps, negative durations, duplicate identities, missing terminal events, or any number not recomputable from source bytes.
- [ ] Expose no CLI/input property for baseline/candidate metrics. `evaluateStageCBlindV1` produces them; package verification reruns the evaluator and requires byte-identical output. Prove with mutation tests that replacing a reported count without changing source bytes fails.
- [ ] Run `npm test -- tests/stage-c-blind/evaluator.test.ts tests/stage-c-blind/isolation.test.ts`; expect PASS, deterministic byte equality across reordered source discovery, and zero network/DB.
- [ ] Stage the Task 5 files, then commit `feat: evaluate the locked Stage C4 blind set`.

### Task 6: Comparator And Acceptance

**Files:** Create `tools/stage-c-blind/comparator.ts`, `acceptance.ts`; create matching tests; modify `contracts.ts`.

- [ ] Add a compile-time import fixture for every exact C4 parser, serializer, `verifyStageCBlindPackageV1`, and `acceptStageCBlindPackageV1`; a missing or renamed export must fail. Write one failing mutation test per gate: 30/30 evaluable, exact 30 neutral / 60 review / 30 adjudication closure, 6/6 exact adverse strata, zero false stops, zero lost red/continuation IDs, zero incomplete-authority stop, zero future leakage, zero duplicate logical requests, and the locked six-positive/six-negative minimum inside the 15 complete intermediates. Also reject a raw package, raw comparison, caller boolean/count object, plain-object cast to either brand, a valid brand from different authority roots/commit bytes, either 29 or 31 neutral/adjudication entries, one 29-review lock, duplicate reviewer IDs, a resolver returning valid bytes for the wrong path/commit, and non-ancestral commit bindings.
- [ ] Define positive stop accuracy only as:

```ts
const positiveIntermediateIds = expectation.positiveIntermediateCaseIds;
const positiveStopAccuracy =
  count(positiveIntermediateIds where evaluator.action === "stop_at_boundary") /
  positiveIntermediateIds.length;
```

The denominator is all adjudicated positives among the 15 `intermediate_eoa_complete` cases, not all 30 cases, all 15 cases, or only attempted stops. The ordinary-negative quota is likewise checked only against the 15 and every stop on one is a safety-failing false stop.
- [ ] Write failing utility tests: positive stop accuracy `>=80%`; avoided histories/pages `>0`; paired provider-wait saving `>0`; and net misses:

```ts
baselineOrdinaryMisses - (candidateOrdinaryMisses + probeMisses + eoaMisses + adverseMisses + sidecarMisses) > 0
```

- [ ] Implement `compareStageCBlindV1`; accept only a strictly parsed evaluator artifact bound to the expectation/tape/selection, return every named gate and deterministic integer median/p95. A missed positive continues full and affects utility; any false stop fails safety.
- [ ] Implement these exact package-verification contracts:

```ts
export type ResolvedStageCBlindPublishedArtifactV1 = {
  readonly commit: string;
  readonly relativePath: string;
  readonly canonicalJsonUtf8: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly objectType: "blob";
};

export type StageCBlindPackageResolverV1 = {
  readonly resolvePublishedArtifact: (input: {
    readonly commit: string;
    readonly artifact: PublishedArtifact;
  }) => Promise<ResolvedStageCBlindPublishedArtifactV1>;
  readonly listBoundedTree: (input: {
    readonly commit: string;
    readonly root: string;
  }) => Promise<readonly {
    readonly relativePath: string;
    readonly objectType: "blob" | "symlink" | "gitlink";
  }[]>;
  readonly isAncestor: (input: {
    readonly ancestorCommit: string;
    readonly descendantCommit: string;
  }) => Promise<boolean>;
};

export type StageCBlindPackageCommitBindingsV1 = {
  readonly preseedProtocolCommit: string;
  readonly expectationCommit: string;
  readonly testedResultCommit: string;
};

const VERIFIED_STAGE_C_BLIND_PACKAGE_V1: unique symbol =
  Symbol("verified-stage-c-blind-package-v1");
export type VerifiedStageCBlindPackageV1 = {
  readonly package: StageCBlindPackageV1;
  readonly comparison: StageCBlindComparisonV1;
  readonly evaluatorOutput: StageCBlindEvaluatorOutputV1;
  readonly commitBindings: StageCBlindPackageCommitBindingsV1;
  readonly closure: {
    readonly caseCount: 30;
    readonly neutralBundleCount: 30;
    readonly reviewLockCount: 2;
    readonly reviewCount: 60;
    readonly adjudicationCount: 30;
  };
  readonly [VERIFIED_STAGE_C_BLIND_PACKAGE_V1]: true;
};

export async function verifyStageCBlindPackageV1(input: {
  readonly authorityRoots: ValidatedStageCBlindAuthorityRootsV1;
  readonly legacy: StageCLegacyCorpusExportV1;
  readonly protocol: StageCBlindProtocolV1;
  readonly metricSourceManifest: StageCBlindMetricSourceManifestV1;
  readonly metricTape: StageCBlindPairedMetricTapeV1;
  readonly seedReceipt: StageCBlindSeedReceiptV1;
  readonly selection: StageCBlindSelectionV1;
  readonly neutralBundles: readonly StageCBlindNeutralBundleV1[];
  readonly reviewLocks: readonly [StageCBlindReviewLockV1, StageCBlindReviewLockV1];
  readonly adjudications: readonly StageCBlindAdjudicationV1[];
  readonly expectation: StageCBlindExpectationManifestV1;
  readonly evaluatorOutput: StageCBlindEvaluatorOutputV1;
  readonly comparison: StageCBlindComparisonV1;
  readonly package: StageCBlindPackageV1;
  readonly commitBindings: StageCBlindPackageCommitBindingsV1;
  readonly resolver: StageCBlindPackageResolverV1;
}): Promise<VerifiedStageCBlindPackageV1>;

export function acceptStageCBlindPackageV1(input: {
  readonly verifiedPackage: VerifiedStageCBlindPackageV1;
  readonly ownerId: "stage-c-owner";
  readonly acceptedAt: string;
}): StageCBlindAcceptanceReceiptV1;
```

Package verification runtime-checks the fresh `ValidatedStageCBlindAuthorityRootsV1` brand and is the only creator of `VERIFIED_STAGE_C_BLIND_PACKAGE_V1`. It resolves every declared `PublishedArtifact` at the exact bound commit, requires returned path/hash/byte length/canonical bytes to equal the ref and owning serializer, requires regular blobs and exact bounded-tree closure, and proves `preseedProtocolCommit -> expectationCommit -> testedResultCommit` ancestry. Legacy/metric-source-manifest/tape/protocol must match their pre-seed bytes; selection, all neutral/review/adjudication roots, and expectation must match expectation-commit bytes; evaluator/comparison/package must be absent at the expectation commit and match tested-result bytes. `testedResultCommit` is the already-created commit containing evaluator/comparison/package but not the later human acceptance, so no artifact claims its own containing commit.

The verifier derives the case IDs only from the parsed selection and requires exactly 30 matching neutral bundles, exactly two reviewer locks with identities `reviewer-a` and `reviewer-b`, exactly 30 reviews in each lock and therefore 60 unique `(caseId,reviewerId)` pairs, and exactly 30 finalized adjudications. It rejects every missing, extra, duplicate, cross-case, unhashed, or orphan value and requires the expectation/package refs to equal this exact `30/60/30` closure. It then repeats the full C2/C3 authority gate through `authorityRoots`, reruns the evaluator byte-for-byte, recomputes comparison and every safety/utility gate, and reruns current legacy `24/24 + 6/6` plus blind disjoint `24 + 6`.

`acceptStageCBlindPackageV1()` runtime-checks the private verified-package brand and accepts no package, comparison, booleans, counts, or cast in its place. It derives every acceptance field from the verified result plus the exact owner/time pair. To verify an existing acceptance, parse it, invoke `acceptStageCBlindPackageV1()` with its owner/time fields and the freshly verified package, and require byte equality with `serializeStageCBlindAcceptanceReceiptV1()`; a failed comparator produces only `failed_immutable_regression` and can never obtain the brand.

`StageCBlindPackageV1` binds `preseedProtocolCommit` and `expectationCommit` but cannot name its own future containing commit. `StageCBlindAcceptanceReceiptV1` contains the exact `commitBindings: StageCBlindPackageCommitBindingsV1` triple plus package/comparison hashes; its first two commits must equal the parsed package fields, and `testedResultCommit` must be the verified pre-existing commit containing the exact evaluator/comparison/package bytes. Thus C6 reads the first two bindings from the package, the full triple from acceptance, requires equality, verifies that `testedResultCommit` is an ancestor of its later `manifest.testedSourceCommit`, and separately requires the same three result blobs to remain byte-identical there. It never substitutes the later commit for the acceptance-bound result commit.
- [ ] Run `npm test -- tests/stage-c-blind/comparator.test.ts tests/stage-c-blind/acceptance.test.ts`; expect PASS for accepted and failed immutable paths.
- [ ] Stage the Task 6 files, then commit `feat: compare and verify Stage C4 blind results`.

### Task 7: Strict Offline CLI

**Files:** Create `tools/stage-c-blind/cli.ts`, `scripts/stageCBlind.ts`, `tests/stage-c-blind/cli.acceptance.test.ts`.

- [ ] Write failing tests for commands `freeze-legacy`, `lock-metric-tape`, `lock-protocol`, `finalize-seed`, `select`, `neutralize`, `prepare-review`, `lock-review`, `open-adjudication`, `finalize-adjudication`, `lock-expectations`, `evaluate`, `compare`, `describe-package`, `accept`, `verify`.
- [ ] Reject unknown/repeated/missing flags, identical input/output, symlinks, non-empty write-once output, out-of-order phase, and a second publication.
- [ ] Implement:

```ts
export async function runStageCBlindCli(
  args: readonly string[],
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream }
): Promise<number>;
```

- [ ] Keep `scripts/stageCBlind.ts` a thin call using `process.argv.slice(2)`; stderr contains typed codes but no address, subject, hash, reviewer personal data, or raw evidence.
- [ ] Require the exact trio `--physical-acceptance <file> --physical-root <directory> --adverse-root <directory>` on `lock-metric-tape`, `lock-protocol`, `select`, `evaluate`, `accept`, and final `verify`; a missing/repeated/mismatched root flag is fatal. Each command independently calls `validateStageCBlindAuthorityRootsV1()` before consuming any C3 artifact. The `evaluate` command must pass the returned branded value as `authorityRoots` to `evaluateStageCBlindV1()` and must not pass, rediscover, or let the evaluator read any of the three filesystem paths. `lock-metric-tape` accepts raw metric source roots but no aggregates; `evaluate` additionally requires `--expectation-commit` plus locked protocol/selection/expectation/tape, with no metric/result flags. `accept` and final `verify` require exactly `--preseed-commit`, `--expectation-commit`, and `--tested-result-commit`, build `StageCBlindPackageCommitBindingsV1`, parse every owning C4 root, and invoke `verifyStageCBlindPackageV1()`; `accept` may call `acceptStageCBlindPackageV1()` only with that fresh branded result. All reject dirty or unreachable binding commits as appropriate.
- [ ] Run `npm test -- tests/stage-c-blind/cli.acceptance.test.ts tests/stage-c-blind/isolation.test.ts`; expect PASS, zero skips, no network/DB.
- [ ] Stage the Task 7 files, then commit `feat: add the Stage C4 blind workflow CLI`.

### Task 8: Real Freeze, Pre-seed Commit, Seed, And Selection

**Files:** Operator inputs under `artifacts/stage-c-blind-v1/`; immutable outputs under `docs/audit/2026-07-stage-c/c4/`.

- [ ] Workbook owner exports exactly 21 UTF-8 manual rows to `artifacts/stage-c-blind-v1/operator/legacy-manual-rows-v1.json`; do not commit workbook, CSV directory, or workspace.
- [ ] Prepare and human-review `docs/audit/2026-07-stage-c/inputs/stage-c4-metric-source-manifest-v1.json` plus an authority-backed pre-seed head witness. The manifest names the full eligible C2/C3 universe and only accepted request/page/timing source artifacts; it contains no result aggregate or model output.
- [ ] While the chosen seed height is still strictly in the future, run the pre-seed commands (replace only the reviewed future height/head-witness values):

```powershell
node --import tsx scripts/stageCBlind.ts freeze-legacy --workbook "C:\Users\User\OneDrive\Desktop\smartcontract\outputs\service-wallet-analysis-20260726\service_wallet_behavior_analysis_2026-07-26.xlsx" --manual-rows artifacts/stage-c-blind-v1/operator/legacy-manual-rows-v1.json --tracked-corpus tests/fixtures/forensics/forensic-model-offline-corpus-v1.json --csv-root "C:\Users\User\OneDrive\Desktop\smartcontract\csv addresses" --output docs/audit/2026-07-stage-c/c4/legacy-corpus-export-v1.json
node --import tsx scripts/stageCBlind.ts lock-metric-tape --physical-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --physical-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --adverse-root docs/audit/2026-07-stage-c/c3 --source-manifest docs/audit/2026-07-stage-c/inputs/stage-c4-metric-source-manifest-v1.json --output docs/audit/2026-07-stage-c/c4/paired-metric-tape-v1.json
node --import tsx scripts/stageCBlind.ts lock-protocol --physical-feasibility docs/audit/2026-07-stage-c/c0/physical-population-feasibility-v1.json --physical-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --physical-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --adverse-root docs/audit/2026-07-stage-c/c3 --legacy docs/audit/2026-07-stage-c/c4/legacy-corpus-export-v1.json --metric-tape docs/audit/2026-07-stage-c/c4/paired-metric-tape-v1.json --head-witness artifacts/stage-c-blind-v1/operator/preseed-head-witness-v1.json --head-source-root artifacts/stage-c-blind-v1/operator/preseed-head-source --head-source-output-root docs/audit/2026-07-stage-c/c4/preseed-head-source --future-seed-height <reviewed-future-height> --output docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json
```

- [ ] Verify the protocol's locked head is below the future seed height and the tape covers every eligible source. Stage and commit **only** the input manifest plus immutable legacy/tape/protocol artifacts before that block can be observed:

```powershell
git add docs/audit/2026-07-stage-c/inputs/stage-c4-metric-source-manifest-v1.json docs/audit/2026-07-stage-c/c4/legacy-corpus-export-v1.json docs/audit/2026-07-stage-c/c4/paired-metric-tape-v1.json docs/audit/2026-07-stage-c/c4/preseed-head-source docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json
git commit -m "docs: lock the Stage C4 preseed protocol"
git status --porcelain
git rev-parse HEAD
```

The status output must be empty. Record the resulting hash as `preseedProtocolCommit` in the ignored operator log. If the seed block was already produced before this commit completed, abort this protocol version; never select and then backfill a lock.

- [ ] Only after the locked block is solidified under the frozen rule, capture the approved request bytes and raw block response into write-once source artifacts and construct `stage-c-blind-seed-block-witness-v1`. Do not type the block hash into a receipt. Run:

```powershell
node --import tsx scripts/stageCBlind.ts finalize-seed --protocol docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json --preseed-commit <preseedProtocolCommit> --witness artifacts/stage-c-blind-v1/operator/seed-block-witness-v1.json --source-root artifacts/stage-c-blind-v1/operator/seed-source --source-output-root docs/audit/2026-07-stage-c/c4/seed-source --output docs/audit/2026-07-stage-c/c4/seed-receipt-v1.json
git add docs/audit/2026-07-stage-c/c4/seed-receipt-v1.json docs/audit/2026-07-stage-c/c4/seed-source
git commit -m "docs: finalize the Stage C4 authority seed"
git status --porcelain
```

Expect an empty status after the commit. The committed seed receipt binds the earlier pre-seed commit and validated raw source graph; it does not claim or hash its own later commit.

- [ ] With the committed seed fixed, select and neutralize exactly once:

```powershell
node --import tsx scripts/stageCBlind.ts select --protocol docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json --seed docs/audit/2026-07-stage-c/c4/seed-receipt-v1.json --physical-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --physical-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --adverse-root docs/audit/2026-07-stage-c/c3 --output-root docs/audit/2026-07-stage-c/c4/selection
node --import tsx scripts/stageCBlind.ts neutralize --selection docs/audit/2026-07-stage-c/c4/selection/selection-v1.json --output-root docs/audit/2026-07-stage-c/c4/neutral
```

- [ ] Expect exact `24 + 6`, all quota/collision/rejection logs, exact adverse mapping, no overlap with any legacy/manual address or evidence hash, and 30 neutral bundles with zero forbidden fields. Insufficient quota is terminal; do not borrow, replace, or rerun.
- [ ] Commit population/selection/neutral outputs separately from both the pre-seed and seed-authority commits:

```powershell
git add docs/audit/2026-07-stage-c/c4/selection docs/audit/2026-07-stage-c/c4/neutral
git commit -m "docs: lock the Stage C4 blind selection"
git status --porcelain
```

Expect an empty status. Preserve all three chronology hashes (pre-seed, seed, selection) in the later verification document.

### Task 9: Human Expectation Commit, Unblind, Result Branch, And Docs

**Files:** Reviewer/adjudicator workspaces under `artifacts/stage-c-blind-v1/`; locked reviews/results under audit root; create `docs/superpowers/verification/2026-07-31-stage-c4-blind-validation.md`; modify `docs/knowledge/09-current-decisions.md`, `docs/knowledge/10-open-problems.md`, and `docs/knowledge/14-current-roadmap.md`.

- [ ] Prepare separate `reviewer-a` and `reviewer-b` workspaces; two humans independently fill role, completeness, three-way action, red IDs, continuation IDs, reason; model output remains unavailable.
- [ ] Prepare, lock, adjudicate, and freeze expectations with these phase-ordered commands (the editable paths stay ignored):

```powershell
node --import tsx scripts/stageCBlind.ts prepare-review --neutral-root docs/audit/2026-07-stage-c/c4/neutral --reviewer reviewer-a --output artifacts/stage-c-blind-v1/reviewer-a
node --import tsx scripts/stageCBlind.ts prepare-review --neutral-root docs/audit/2026-07-stage-c/c4/neutral --reviewer reviewer-b --output artifacts/stage-c-blind-v1/reviewer-b
node --import tsx scripts/stageCBlind.ts lock-review --selection docs/audit/2026-07-stage-c/c4/selection/selection-v1.json --workspace artifacts/stage-c-blind-v1/reviewer-a --output docs/audit/2026-07-stage-c/c4/reviews/reviewer-a-v1.json
node --import tsx scripts/stageCBlind.ts lock-review --selection docs/audit/2026-07-stage-c/c4/selection/selection-v1.json --workspace artifacts/stage-c-blind-v1/reviewer-b --output docs/audit/2026-07-stage-c/c4/reviews/reviewer-b-v1.json
node --import tsx scripts/stageCBlind.ts open-adjudication --review-a docs/audit/2026-07-stage-c/c4/reviews/reviewer-a-v1.json --review-b docs/audit/2026-07-stage-c/c4/reviews/reviewer-b-v1.json --output artifacts/stage-c-blind-v1/adjudicator
node --import tsx scripts/stageCBlind.ts finalize-adjudication --workspace artifacts/stage-c-blind-v1/adjudicator --output-root docs/audit/2026-07-stage-c/c4/adjudication
node --import tsx scripts/stageCBlind.ts lock-expectations --protocol docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json --selection docs/audit/2026-07-stage-c/c4/selection/selection-v1.json --metric-tape docs/audit/2026-07-stage-c/c4/paired-metric-tape-v1.json --neutral-root docs/audit/2026-07-stage-c/c4/neutral --reviews-root docs/audit/2026-07-stage-c/c4/reviews --adjudication-root docs/audit/2026-07-stage-c/c4/adjudication --output docs/audit/2026-07-stage-c/c4/expectation-manifest-v1.json
```

- [ ] Require exact 30-case roots from two distinct humans and 30 fully resolved adjudications, plus the six-positive/six-negative minimum within the 15 complete intermediates. Stop if either quota is absent; controls/adverse cases do not fill it.
- [ ] Stage and commit **all** 60 reviews, 30 adjudications, and the expectation manifest before any evaluator output is created:

```powershell
git add docs/audit/2026-07-stage-c/c4/reviews docs/audit/2026-07-stage-c/c4/adjudication docs/audit/2026-07-stage-c/c4/expectation-manifest-v1.json
git commit -m "docs: lock the Stage C4 blind expectations"
git status --porcelain
git rev-parse HEAD
```

The status output must be empty. Record this hash as `expectationCommit`. Verify that this commit and all ancestors contain no evaluator/comparator output. If any output existed before the commit, abort this blind version.

- [ ] Only after that clean expectation commit, run the concrete evaluator and comparator; no command accepts metric values:

```powershell
node --import tsx scripts/stageCBlind.ts evaluate --protocol docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json --selection docs/audit/2026-07-stage-c/c4/selection/selection-v1.json --expectation docs/audit/2026-07-stage-c/c4/expectation-manifest-v1.json --metric-tape docs/audit/2026-07-stage-c/c4/paired-metric-tape-v1.json --physical-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --physical-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --adverse-root docs/audit/2026-07-stage-c/c3 --expectation-commit <expectationCommit> --output docs/audit/2026-07-stage-c/c4/evaluator-output-v1.json
node --import tsx scripts/stageCBlind.ts compare --protocol docs/audit/2026-07-stage-c/c4/blind-protocol-v1.json --expectation docs/audit/2026-07-stage-c/c4/expectation-manifest-v1.json --metric-tape docs/audit/2026-07-stage-c/c4/paired-metric-tape-v1.json --evaluator-output docs/audit/2026-07-stage-c/c4/evaluator-output-v1.json --output docs/audit/2026-07-stage-c/c4/comparison-v1.json
node --import tsx scripts/stageCBlind.ts describe-package --input docs/audit/2026-07-stage-c/c4 --output docs/audit/2026-07-stage-c/c4/package-v1.json
```

- [ ] Run comparator and package descriptor. If any gate fails, preserve and commit `failed_immutable_regression`, update knowledge 10/14, and stop without retuning/replacement/acceptance.
- [ ] If all gates pass, commit evaluator/comparison/package first, with no acceptance or verification prose in that commit. Require a clean status and record the resulting hash as `testedResultCommit`:

```powershell
git add docs/audit/2026-07-stage-c/c4/evaluator-output-v1.json docs/audit/2026-07-stage-c/c4/comparison-v1.json docs/audit/2026-07-stage-c/c4/package-v1.json
git commit -m "docs: record Stage C4 blind result package"
git status --porcelain
git rev-parse HEAD
```
- [ ] Only after that immutable result commit exists, obtain explicit owner acceptance. Run `accept` with the three authority roots and exact commit bindings so the CLI parses the complete C4 roots, produces the authority brand, invokes `verifyStageCBlindPackageV1()`, and passes only its runtime-branded result to `acceptStageCBlindPackageV1()`. The opaque ID is exactly `stage-c-owner`; the actual UTC timestamp remains score-neutral and authorizes neither rollout nor Stage D.

```powershell
node --import tsx scripts/stageCBlind.ts accept --input docs/audit/2026-07-stage-c/c4 --physical-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --physical-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --adverse-root docs/audit/2026-07-stage-c/c3 --preseed-commit <preseedProtocolCommit> --expectation-commit <expectationCommit> --tested-result-commit <testedResultCommit> --owner-id stage-c-owner --accepted-at <actual-UTC-timestamp> --output docs/audit/2026-07-stage-c/c4/blind-acceptance-receipt-v1.json
```
- [ ] Record all hashes, commands, counts, gates, opaque human roles, limitations, and off-Git workspaces in the verification doc.
- [ ] For success update knowledge 09, remove only the completed blind blocker from 10, mark C4 accepted while C5/C6 and D remain gated in 14. For failure leave 09 without acceptance and record exact failure in 10/14.
- [ ] Run:

```powershell
node --import tsx scripts/replayServiceRoleShadowGate.ts
npm test -- tests/stage-c-blind tests/forensics/serviceRoleShadowGate.test.ts tests/forensics/offlineForensicModelReplay.test.ts tests/golden-v2
npm run typecheck
npm test
git diff --check
node --import tsx scripts/stageCBlind.ts verify --input docs/audit/2026-07-stage-c/c4 --physical-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --physical-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --adverse-root docs/audit/2026-07-stage-c/c3 --preseed-commit <preseedProtocolCommit> --expectation-commit <expectationCommit> --tested-result-commit <testedResultCommit>
```

- [ ] Expect legacy `24/24 + 6/6`, focused zero skips, all tests/typecheck exit `0`, empty diff-check, verified package SHA/outcome.
- [ ] Commit the acceptance, verification, and knowledge only after checking no private metadata; evaluator/comparator/package are already immutable in `testedResultCommit`:

```powershell
git add docs/audit/2026-07-stage-c/c4/blind-acceptance-receipt-v1.json docs/superpowers/verification/2026-07-31-stage-c4-blind-validation.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: accept Stage C4 blind validation"
```

For a failed immutable regression, stage the failure receipt at its owning output path instead of the absent acceptance file. Protocol/expectation/result artifacts bind only earlier commits; the later acceptance alone records the already-existing `testedResultCommit`. No artifact claims its own containing commit.

## Hard Aborts And Completion

Abort without acceptance on any prerequisite/hash/schema/quota conflict; a missing/renamed owning C4 parser or serializer; raw/unbranded package or authority input; missing external C2 physical acceptance; external/embedded C2-root mismatch; detached but structurally valid C2 inventory; missing, duplicate, out-of-root, hash-conflicting, orphan, or symlinked C2/C3 artifact; any missing/detached/hash-only/wrong-family C3 authority leaf or leaf whose subject/event/snapshot/finality/continuation binding fails; any C3-consuming phase that does not freshly enter the pure/path authority producer and owning C3 population graph verifier; incomplete or quota-trimmed C0/C2/C3 universe; a selected intermediate with a proven exact service identity/boundary; a copied C3 evidence-class/check-row map; workbook SHA or 21-row mismatch; legacy result other than exact `24/24 + 6/6`; incomplete/unverifiable paired tape; protocol or tape not cleanly committed while the seed height is future; protocol locked after seed height; unfinalized/conflicting/manually supplied seed; pre-lock model leakage; unlogged rejection/collision; exclusion overlap; stratum exhaustion; anything other than exact 30 neutral/60 reviews/30 adjudications; neutral identifying/model leakage; equal/incomplete reviews; unresolved disagreement; fewer than six positives or six ordinary negatives inside the 15 complete intermediates; reviews/adjudication/expectation not cleanly committed before evaluator output; model output before or outside that expectation commit; evaluator/comparison/package absent or different in the pre-existing `testedResultCommit`; acceptance created before that result commit; caller-provided metrics; a non-reproducible evaluator byte; any safety/utility failure; overwrite/symlink/tamper; or absent human acceptance.

After unblind, never reseed, replace cases, change cutoff/quota/rejections, delete artifacts, or retune on this set. A failed set becomes immutable regression and a new policy version requires a new blind set.

C4 is complete only with the exact owning parser/serializer export surface, canonical legacy preservation, passing legacy gate, independently validated external/embedded C2 roots and rebuilt C3 branded contexts in every consuming phase, a clean pre-seed protocol/tape commit, an authority-validated finalized seed, disjoint locked 24+6, exact 30 neutral/60 reviews/30 adjudications, a clean expectation commit before model output, byte-reproducible derived paired metrics, passing comparator, an immutable verified `testedResultCommit`, a separately committed explicit human acceptance bound to it, and updated verification/knowledge docs. C4 remains score-neutral, does not classify/suppress the checked subject, does not activate production boundaries, and does not replace the manual corpus.
