# Stage C2 Physical Service Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture immutable physical `100 recent + 100 historical` service evidence, build a strict behavior profile, and validate `EOAAtAnchor` without promoting reconstructed history or current account metadata to authority.

**Architecture:** A pure forensic module owns the fixed window plan, physical normalization, exact order/role gates, classifier adapter, and historical account witness parser. A capture module reuses provider identity V2, the scheduler-backed TronScan page client, and existing artifact stores. C2 captures and preserves the full C0a-eligible universe with actual per-stratum counts; it never truncates that universe to C4 quotas. Every result is standalone and score-neutral. Missing authority on a required complete intermediate remains typed unresolved and blocks C2 acceptance, while an intentional incomplete control or adverse basis keeps its declared non-authoritative state without becoming a capture-wide hard abort.

**Tech Stack:** TypeScript 5.7, Node.js ESM, Vitest, PostgreSQL, existing TronScan scheduler/client, canonical JSON hashing, and the existing C/B/G/H/R/X classifier.

---

## Verified truth and boundaries

- `TronscanClient.listRelatedTrc20TransferPagePinned()` already accepts `start`, `limit`, and `endTimestamp` through the central scheduler.
- `computeServiceWindowVectorV2()` and `classifyServiceBehavior100Plus100V2()` are the only executable classifier path.
- `ServiceBehaviorRowV2` already carries `transactionIndex`, `eventIndex`, and `orderAuthority`.
- `maybeBuildServiceRoleShadowArtifactV1()` is reconstructed accepted-history evidence with `boundaryPageAuthority:false`; C2 never promotes it.
- Current `getAccount()` / `getAddressMetadata()` evidence cannot prove historical EOA.
- Exact role capture/materialization already represents ordinary, poisoning, GasFree, and provider-risk roles, but C2 requires complete bindings for its own 200 events.
- Baseline C0-C6 never requests `500+100`.
- No production traversal, finalizer, scoring, report, Admin, Telegram, delivery, rollout, or Stage D change is in scope.

## Preconditions and hard start gate

1. A reviewed real `stage-c-physical-population-feasibility-v1` C0a receipt has `complete:true`, preserves the full eligible candidate universe, reports actual counts at or above every `15/3/3/3` minimum, and binds implementable physical-page, transaction-order, role, and historical account sources.
2. Provider-request identity V2 is merged with its V1 frozen-byte gate green.
3. Read `AGENT_BRIEF.md`, knowledge `02`, `04`, `05`, `07`, `09`, `10`, `14`, the C0 receipt, and the approved Stage C design.
4. If C0a is absent/incomplete or names no implementable historical account source, stop before Task 1. Do not invent an endpoint or accept arbitrary witness JSON.

## Locked file map

**Create**

- `src/forensics/serviceBoundaryEvidence.ts` — pure request planning, normalization, profile, EOA parser, validation, hashes.
- `src/unifiedCheck/serviceBoundaryEvidenceCapture.ts` — source loading, V2 page cache, artifact persistence, capture receipt.
- `scripts/captureServiceBoundaryEvidence.ts` — strict thin CLI.
- `tests/forensics/serviceBoundaryEvidence.test.ts` — window/order/role/classifier/EOA tests.
- `tests/unified-check/serviceBoundaryEvidenceCapture.test.ts` — request/cache/no-expansion tests.
- `tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts` — immutable standalone persistence proof.

**Consume unchanged**

- `src/unifiedCheck/providerRequest.ts`
- `src/tron/tronClient.ts`
- `src/forensics/serviceBehaviorResearch.ts`
- `src/unifiedCheck/serviceRoleExactEvidenceCapture.ts`
- `src/unifiedCheck/serviceRoleMapMaterialization.ts`
- `src/forensics/tronAddressAllTimeIndex.ts`
- `src/unifiedCheck/repository.ts`

**Documentation after real execution**

- `docs/knowledge/02-check-modes.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/14-current-roadmap.md`

Do not modify `src/index.ts`, production runtime/traversal/boundary/finalizer/scoring/report/Admin/Telegram files, migrations, matrix-v4, ScoreAnchorV3, or V1 shadow schemas.

## Required contracts

```ts
export const SERVICE_BOUNDARY_PHYSICAL_POLICY_V1 =
  "service-boundary-physical-100-plus-100-v1" as const;

export type ServiceBoundaryWindowRequestV1 = {
  readonly windowKind: "recent" | "historical";
  readonly pageOffset: 0 | 50;
  readonly pageSize: 50;
  readonly timestampStartInclusiveMs: string;
  readonly timestampEndInclusiveMs: string;
};

export function buildServiceBoundaryWindowPlanV1(input: {
  anchorTimestamp: string;
  recentBaselineStartTimestamp: string | null;
}): readonly ServiceBoundaryWindowRequestV1[];
```

Fetch recent offsets `0,50` first. After exactly 100 canonical recent events, freeze `recentBaselineStart`; historical end is `min(anchor - 7d, recentBaselineStart - 7d)`, again offsets `0,50`. No top-up, configurable page count, or offsets above 50.

```ts
export type ServiceBoundaryPhysicalEventV1 = {
  readonly canonicalEventId: string;
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly transactionIndex: number | null;
  readonly eventIndex: number | null;
  readonly occurredAtSeconds: number;
  readonly direction: "incoming" | "outgoing";
  readonly counterpartyAddress: string;
  readonly amountRaw: string;
  readonly role: "ordinary" | "poisoning_only" | "gasfree_fee" |
    "gasfree_principal" | "provider_risk";
  readonly orderAuthority: "exact_position" | "unique_block" | "unresolved";
  readonly sourcePageSha256: string;
  readonly roleEvidenceSha256: string;
  readonly orderEvidenceSha256: string;
};

export type ServiceBoundaryPhysicalUnresolvedReasonV1 =
  | "checked_subject_excluded"
  | "future_event_present"
  | "mixed_snapshot"
  | "pagination_non_progressing"
  | "physical_window_short"
  | "canonical_event_collision"
  | "order_unproven"
  | "role_authority_missing"
  | "role_authority_conflict"
  | "anchor_binding_invalid";

export type ServiceBoundaryPhysicalInventoryV1 = {
  readonly schemaVersion: "service-boundary-physical-inventory-v1";
  readonly policyVersion: typeof SERVICE_BOUNDARY_PHYSICAL_POLICY_V1;
  readonly subjectAddress: string;
  readonly profiledAddress: string;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly anchorEventId: string;
  readonly anchorTimestamp: string;
  readonly requestIdentitySha256s: readonly string[];
  readonly rawPageSha256s: readonly string[];
  readonly recent: readonly ServiceBoundaryPhysicalEventV1[];
  readonly historical: readonly ServiceBoundaryPhysicalEventV1[];
  readonly complete: boolean;
  readonly unresolvedReasons: readonly ServiceBoundaryPhysicalUnresolvedReasonV1[];
  readonly productionEffect: false;
};
```

```ts
export type HistoricalAccountStateWitnessV1 = {
  readonly schemaVersion: "historical-account-state-witness-v1";
  readonly witnessSha256: string;
  readonly body: {
    readonly address: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly observedCode: string;
    readonly sourceParserVersion: string;
    readonly sourceRequestIdentitySha256: string;
    readonly sourcePayloadSha256: string;
  };
};

export type AccountRoleTimelineWitnessV1 = {
  readonly schemaVersion: "account-role-timeline-witness-v1";
  readonly witnessSha256: string;
  readonly body: {
    readonly address: string;
    readonly completeThroughBlockNumber: string;
    readonly completeThroughBlockHash: string;
    readonly sourceParserVersion: string;
    readonly sourceRootSha256: string;
    readonly sourceArtifactSha256s: readonly string[];
    readonly roleEvents: readonly {
      readonly blockNumber: string;
      readonly blockHash: string;
      readonly role: "eoa" | "contract";
      readonly evidenceSha256: string;
    }[];
  };
};

export type ValidatedEoaAtAnchorWitnessV1 =
  | { readonly kind: "historical_account_state";
      readonly witness: HistoricalAccountStateWitnessV1 }
  | { readonly kind: "account_role_timeline";
      readonly witness: AccountRoleTimelineWitnessV1 };

export async function validateEoaAtAnchorWitnessSourcesV1(input: {
  readonly witness: HistoricalAccountStateWitnessV1 | AccountRoleTimelineWitnessV1;
  readonly resolveArtifact: (sha256: string) => Promise<unknown>;
}): Promise<ValidatedEoaAtAnchorWitnessV1>;

export type EoaAtAnchorResultV1 =
  | { readonly state: "eoa_at_anchor" | "contract_at_anchor";
      readonly authoritative: true; readonly witnessSha256: string }
  | { readonly state: "eoa_at_anchor_unresolved";
      readonly authoritative: false;
      readonly reason: "current_only_observation" | "witness_unavailable" |
        "witness_incomplete" | "anchor_mismatch" | "witness_conflict" |
        "unsupported_witness" };

export function evaluateEoaAtAnchorV1(input: {
  profiledAddress: string;
  anchorBlockNumber: string;
  anchorBlockHash: string;
  witness: ValidatedEoaAtAnchorWitnessV1 | null;
  currentAccountObservation?: unknown;
}): EoaAtAnchorResultV1;
```

For both witness variants, `witnessSha256` is exactly `fingerprintCanonicalArtifact(body)`; it never hashes an object containing itself. The parser rejects a hash over the envelope, a missing/extra body key, or a body mutation with a recomputed outer receipt only. Empty code proves EOA only after `validateEoaAtAnchorWitnessSourcesV1` has loaded the immutable request identity/raw payload (or full timeline root/artifacts), recomputed every hash, invoked the C0-approved source parser, and confirmed exact address/block/hash. Non-empty validated code proves contract. A timeline must have a verified source root and be complete through the exact anchor. Syntactically valid witness JSON or fake hashes are never authority. Current-only data can return only `current_only_observation`.

```ts
export type ServiceBoundaryEvidenceV1 = {
  readonly schemaVersion: "service-boundary-evidence-v1";
  readonly inventorySha256: string;
  readonly eoaAtAnchor: EoaAtAnchorResultV1;
  readonly authorityState:
    | "complete_intermediate_eoa"
    | "checked_subject_excluded"
    | "contract_at_anchor"
    | "unresolved";
  readonly unresolvedReasons: readonly string[];
  readonly boundaryAuthority: boolean;
  readonly classifierExecuted: false;
  readonly productionEffect: false;
};

export type ServiceBoundaryPhysicalProfileV1 = {
  readonly schemaVersion: "service-boundary-physical-profile-v1";
  readonly serviceBoundaryEvidenceSha256: string;
  readonly classifier: JsonSafeServiceBehaviorResultV2;
  readonly checkedSubjectExcluded: true;
  readonly boundaryPageAuthority: true;
  readonly productionEffect: false;
};

export type ServiceBoundaryCaptureReceiptV1 = {
  readonly schemaVersion: "service-boundary-capture-receipt-v1";
  readonly c0aReceiptSha256: string;
  readonly requestIdentitySha256s: readonly string[];
  readonly rawPageSha256s: readonly string[];
  readonly inventorySha256: string;
  readonly eoaAtAnchorSha256: string;
  readonly serviceBoundaryEvidenceSha256: string;
  readonly classifierExecuted: false;
  readonly complete: boolean;
  readonly productionEffect: false;
};

export type ServiceBoundaryPhysicalCandidateInventoryV1 = {
  readonly schemaVersion: "service-boundary-physical-candidate-inventory-v1";
  readonly c0aReceiptSha256: string;
  readonly candidateReceipts: readonly {
    readonly candidateId: string;
    readonly profiledAddress: string;
    readonly capturedSubjectAddress: string;
    readonly controlStratum: "intermediate_eoa_complete" |
      "checked_subject_control" | "contract_at_anchor_control" |
      "authority_incomplete_control" | "adverse_authority_candidate";
    readonly adverseAuthorityClass: null |
      "event_time_blacklist" | "active_sanctions_or_restriction" |
      "tracked_drainer_or_collector" | "exact_restricted_service" |
      "verify20_terminal" | "exact_bound_nonterminal";
    readonly captureReceiptSha256: string;
    readonly artifactRefs: readonly {
      readonly kind: "c0_feasibility" | "provider_request_identity" |
        "provider_raw_page" | "transaction_order_witness" |
        "economic_role_witness" | "historical_account_witness" |
        "account_role_timeline_witness" | "checked_subject_witness" |
        "contract_at_anchor_witness" | "adverse_authority_witness" |
        "physical_inventory" | "eoa_at_anchor" |
        "boundary_evidence" | "capture_receipt";
      readonly relativePath: string;
      readonly sha256: string;
    }[];
    readonly snapshotHash: string;
    readonly anchorEventId: string;
    readonly authorityState: ServiceBoundaryEvidenceV1["authorityState"];
  }[];
  readonly eligibleCounts: {
    readonly completeIntermediateCount: number;
    readonly checkedSubjectControlCount: number;
    readonly contractAtAnchorControlCount: number;
    readonly provenIncompleteAuthorityControlCount: number;
    readonly boundAdverseAuthorityCandidateCount: number;
  };
  readonly classifierExecuted: false;
  readonly blindCasesSelected: false;
  readonly productionEffect: false;
};

export type ServiceBoundaryPhysicalAcceptanceGraphV1 = {
  readonly schemaVersion: "service-boundary-physical-acceptance-graph-v1";
  readonly candidateInventory: ServiceBoundaryPhysicalCandidateInventoryV1;
  readonly artifacts: readonly {
    readonly relativePath: string;
    readonly kind: "c0_feasibility" | "provider_request_identity" |
      "provider_raw_page" | "transaction_order_witness" |
      "economic_role_witness" | "historical_account_witness" |
      "account_role_timeline_witness" | "checked_subject_witness" |
      "contract_at_anchor_witness" | "adverse_authority_witness" |
      "physical_inventory" | "eoa_at_anchor" |
      "boundary_evidence" | "capture_receipt";
    readonly sha256: string;
    readonly canonicalValue: unknown;
  }[];
  readonly referenceProjection: {
    readonly schemaVersion: "service-boundary-physical-reference-projection-v1";
    readonly testedSourceCommit: string;
    readonly acceptedAttemptArtifactRefs: readonly never[];
    readonly acceptedArtifactRefs: readonly never[];
    readonly finalHashRefs: readonly never[];
    readonly evidenceBundleRefs: readonly never[];
    readonly scoreAnchorRefs: readonly never[];
    readonly reportOrDeliveryRefs: readonly never[];
  };
};

export type ServiceBoundaryPhysicalAcceptanceV1 = {
  readonly schemaVersion: "service-boundary-physical-acceptance-v1";
  readonly receiptSha256: string;
  readonly body: {
    readonly policyVersion: "service-boundary-physical-100-plus-100-v1";
    readonly candidateInventorySha256: string;
    readonly populationGraphSha256: string;
    readonly populationGraph: ServiceBoundaryPhysicalAcceptanceGraphV1;
    readonly eligibleCompleteIntermediateCount: number;
    readonly eligibleCheckedSubjectControlCount: number;
    readonly eligibleContractAtAnchorControlCount: number;
    readonly eligibleProvenIncompleteAuthorityControlCount: number;
    readonly eligibleBoundAdverseAuthorityCandidateCount: number;
    readonly minimumQuotas: {
      readonly completeIntermediateCount: 15;
      readonly checkedSubjectControlCount: 3;
      readonly contractAtAnchorControlCount: 3;
      readonly provenIncompleteAuthorityControlCount: 3;
      readonly adverseAuthorityClassCount: 6;
    };
    readonly minimumQuotasSatisfied: true;
    readonly legacyNonBlindProfileSha256: string;
    readonly legacyNonBlindProfileCanonicalJsonUtf8: string;
    readonly populationClassifierExecuted: false;
    readonly blindCasesSelected: false;
    readonly checkedSubjectClassifierExecuted: false;
    readonly checkedSubjectRoleAuthorityProduced: false;
    readonly subjectRoleCandidateSuppression: false;
    readonly subjectRoleScoreEffect: false;
    readonly subjectRoleExactAdverseSuppression: false;
    readonly accepted: true;
    readonly productionEffect: false;
  };
};

export function parseServiceBoundaryPhysicalCandidateInventoryV1(
  value: unknown
): ServiceBoundaryPhysicalCandidateInventoryV1;

export function parseServiceBoundaryPhysicalAcceptanceV1(
  value: unknown
): ServiceBoundaryPhysicalAcceptanceV1;
```

`boundaryAuthority` is derived only for a non-subject complete physical inventory with authoritative order, complete role evidence, and historical EOA. It is separate from classifier status. The candidate inventory reconciles candidate-for-candidate with the accepted C0a receipt and preserves every eligible physical/control row; it derives actual counts and requires them to be **at least** `15 + 3 + 3 + 3`, but neither capture nor acceptance selects or discards rows at those minima. It likewise preserves every accepted C0a adverse candidate, not merely one preselected row per class. Those rows derive their address/snapshot/anchor from the resolved exact C0 artifact, intentionally have `boundaryAuthority:false`, never run the classifier, and give C3 a hash-verified C2 subject/snapshot basis; missing physical/EOA negative authority remains typed unresolved and cannot erase their exact positive fact. Only C4's committed future-seed selection chooses exactly `15/3/3/3` plus six singletons.

The acceptance embeds the bounded complete population/control graph rather than only its hash. Its one-argument parser validates the candidate inventory with the owning parser, selects every transitive node through a frozen `(kind,schemaVersion)` parser/serializer registry, canonical-reserializes and rehashes every value, requires exact sorted path/hash closure with no missing/extra/orphan/duplicate node, and recomputes `populationGraphSha256`, `candidateInventorySha256`, actual counts, minima, and all five checked-subject negative-policy literals. The closed graph begins at the exact embedded C0a receipt and includes every request-identity body, raw provider payload/page, exact transaction-order witness, economic-role witness, historical account/timeline request and payload, subject/contract control witness, and adverse-authority basis referenced by a candidate. The parser invokes each owning C0/provider/order/role/historical/control/adverse parser, requires each physical event's source/order/role hashes and every EOA timeline leaf to resolve to those canonical nodes, then rebuilds the physical inventory, EOA result, boundary evidence, and capture receipt. A hash-only leaf or a locally rehashed substitute without its authority body rejects. It derives zero production references only from the exact embedded reference projection; C6 later independently rehydrates the standalone graph and repeats the database reachability check. Callers cannot assert those literals independently.

`legacyNonBlindProfileCanonicalJsonUtf8` contains the exact no-LF canonical UTF-8 JSON text whose SHA-256 is `legacyNonBlindProfileSha256`. The same one-argument acceptance parser must parse that embedded text, require byte equality with `canonicalizeArtifactJson(parsedProfile)`, recompute its UTF-8 SHA-256, strictly validate `ServiceBoundaryPhysicalProfileV1`, and cross-bind it to the accepted legacy evidence inside `populationGraph`; it performs no database lookup and accepts no resolver. Export paired `serializeServiceBoundaryPhysicalCandidateInventoryV1` and `serializeServiceBoundaryPhysicalAcceptanceV1` writers using `canonicalizeArtifactJson` with no added LF. The two owning parsers are side-effect-free and are the only C2 entrypoints imported by C6.

Operational population capture stops at `ServiceBoundaryEvidenceV1` and the candidate inventory. Its committed export is a self-contained content-addressed hash graph: every `artifactRefs` path is repository-relative under the C2 population root, contains the canonical upstream C0/request/raw-page/order/role/historical/control/adverse authority leaf or derived inventory/EOA/evidence/receipt body named by its kind, and rehashes to the declared SHA. It contains every C0a-eligible candidate even when a stratum exceeds its future blind minimum. C4 resolves this graph offline without PostgreSQL. It must not call the classifier before the C4 selection, reviews, adjudication, and expectation manifest are locked. `ServiceBoundaryPhysicalProfileV1` is exercised on legacy/non-blind controls during C2 and on blind cases only through the post-lock C4 evaluator; the exact canonical legacy-profile bytes are embedded in the C2 acceptance so C6 can reverify them offline.

### Task 1: Gate execution on the accepted C0a receipt

**Files:** Create `src/forensics/serviceBoundaryEvidence.ts`; create `tests/forensics/serviceBoundaryEvidence.test.ts`.

- [ ] Write a failing test for exact C0a schema/hash, `complete:true`, all four source classes, preservation of an over-quota full candidate universe, and rejection of incomplete/extra-key/hash-mismatch inputs.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts -t "requires an accepted C0a receipt"`; expected FAIL because the module is absent.
- [ ] Implement `validateStageC0aForPhysicalCaptureV1(value, expectedSha256)`; it returns validated input or throws `stage_c2_c0a_not_accepted` and never repairs authority.
- [ ] Re-run the same command; expected PASS.
- [ ] Stage `src/forensics/serviceBoundaryEvidence.ts tests/forensics/serviceBoundaryEvidence.test.ts`, then commit `feat: gate Stage C2 on accepted physical authority`.

### Task 2: Freeze the exact physical window plan

**Files:** Modify the two Task 1 files.

- [ ] Add failing tests for recent `0,50`, historical `0,50`, size 50, exact cutoff, deterministic order, and absence of offsets `100..450`.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts -t "physical window requests"`; expected FAIL because the planner is missing.
- [ ] Implement `buildServiceBoundaryWindowPlanV1()` using exact ISO validation and integer milliseconds; recent-only is returned until the baseline start is known.
- [ ] Re-run the command; expected PASS.
- [ ] Stage the two Task 1 files, then commit `feat: freeze Stage C service sampling windows`.

### Task 3: Normalize events and enforce coverage/order/roles

**Files:** Modify the two Task 1 files.

- [ ] Add failing tests for exact `100+100`, identical duplicate without top-up, conflicting duplicate, future event, mixed snapshot, non-progressing offset, short window, exact position, valid/invalid unique-block order, missing role, and role conflict. Prove these failures hard-reject a candidate declared `intermediate_eoa_complete`, while a reviewed `authority_incomplete_control` preserves exactly its declared source-proven gap with `boundaryAuthority:false` and does not abort unrelated captures.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts -t "physical inventory"`; expected FAIL before `buildServiceBoundaryPhysicalInventoryV1()` exists.
- [ ] Implement strict source hash/snapshot/anchor/event/order/role validation. Collapse identical duplicates only, never top up, sort by chain order, require exactly 100 canonical events per window for candidates declared complete, and derive `complete`/reasons. Intentional incomplete controls must match exactly one C0-declared, source-proven gap; adverse bases carry no invented physical window.
- [ ] Re-run the command; expected PASS and equal hash under input reorder.
- [ ] Stage the two Task 1 files, then commit `feat: validate Stage C physical service inventory`.

### Task 4: Adapt only complete physical evidence to the classifier

**Files:** Modify the two Task 1 files.

- [ ] Add failing high-service, non-service, incomplete, order-conflict, role-conflict, and checked-subject tests; assert only C/B/G/H/R/X and the four existing statuses appear.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts -t "classifies only complete physical inventory"`; expected FAIL before the adapter exists.
- [ ] Implement `buildServiceBoundaryEvidenceV1()` as authority-only and `buildServiceBoundaryPhysicalProfileV1()` as the separate classifier adapter: validate decimal amount before bigint conversion, build `ServiceBehaviorRowV2`, call existing vector/classifier functions, and JSON-normalize bigint exactly as the shadow does. Do not copy thresholds. The adapter rejects checked-subject, contract, unresolved, or pre-lock blind inputs.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts tests/forensics/serviceBehaviorResearch.test.ts tests/unified-check/serviceRoleShadow.test.ts`; expected PASS and shadow authority remains false.
- [ ] Stage the two Task 1 files, then commit `feat: build physical Stage C service profiles`.

### Task 5: Validate EOAAtAnchor

**Files:** Modify the two Task 1 files.

- [ ] Add failing tests for exact source-resolved no-code EOA, contract code, complete source-rooted EOA/contract timelines, current-only, null, incomplete timeline, anchor mismatch, conflicting role events, missing source bytes, fake syntactically valid hashes, parser/address/block mismatch, tampered root/payload, and unsupported schema. Freeze `witnessSha256 = fingerprintCanonicalArtifact(body)` for both variants and reject an envelope/self-inclusive hash or a changed body under a recomputed receipt hash.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts -t "EOAAtAnchor"`; expected FAIL before the evaluator exists.
- [ ] Implement strict body-hashed witness producers/parsers plus `validateEoaAtAnchorWitnessSourcesV1()` before `evaluateEoaAtAnchorV1()`. Resolve and hash source request/payload/timeline bytes through injected local storage, require the C0-approved parser version, and reject any self-authenticating JSON. Current-only/partial/conflict is unresolved.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts`; expected PASS and no current-only fixture is authoritative.
- [ ] Stage the two Task 1 files, then commit `feat: validate Stage C EOA at anchor evidence`.

### Task 6: Capture through the existing V2 cache and scheduler

**Files:** Create `src/unifiedCheck/serviceBoundaryEvidenceCapture.ts`; create `tests/unified-check/serviceBoundaryEvidenceCapture.test.ts`.

- [ ] Write failing injected-dependency tests asserting four logical/cold HTTP requests, replay cache hits, reuse across route anchors with identical HTTP bytes, and no offset above 50.
- [ ] Run `npm test -- tests/unified-check/serviceBoundaryEvidenceCapture.test.ts`; expected FAIL because the module is absent.
- [ ] Implement `captureServiceBoundaryEvidenceV1(input,deps)`: validate C0a, iterate its full sorted physical candidate universe without quota stopping, fetch recent via `loadOrFetchProviderPageV2`, freeze cutoff, fetch historical where that candidate contract requires them, load only C0-bound order/role/EOA evidence, then build/hash inventory/EOA/authority receipt. A complete-intermediate authority failure is fail-closed; an intentional incomplete control preserves its exact proven gap and remains non-authoritative. For every C0 adverse candidate, resolve its exact authority artifact, derive the exact address/snapshot/anchor, and publish a separate typed-unresolved C2 evidence basis without inventing physical pages or negative authority. It never invokes the classifier. Add no scheduler or limiter.
- [ ] Run `npm test -- tests/unified-check/serviceBoundaryEvidenceCapture.test.ts tests/unified-check/providerRequest.test.ts tests/tron/tronClient.test.ts`; expected PASS with V1 identity frozen.
- [ ] Stage `src/unifiedCheck/serviceBoundaryEvidenceCapture.ts tests/unified-check/serviceBoundaryEvidenceCapture.test.ts`, then commit `feat: capture physical Stage C service evidence`.

### Task 7: Persist standalone artifacts and add the CLI

**Files:** Create `scripts/captureServiceBoundaryEvidence.ts`; create `tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts`; create from reviewed inputs `docs/audit/2026-07-stage-c/inputs/service-boundary-population-capture-v1.json` and `docs/audit/2026-07-stage-c/inputs/service-boundary-legacy-profile-control-v1.json`; create on capture the immutable export root `docs/audit/2026-07-stage-c/c2/physical-population-v1/`.

- [ ] Write failing strict-args/PostgreSQL tests for immutable raw request/page, inventory, source-resolved EOA, authority receipt, a self-contained full-universe candidate export/hash graph, preservation of counts above `15/3/3/3`, separately invoked legacy profile, embedded byte-identical canonical legacy-profile JSON and hash mutation, and embedded full population/control graph mutation. Delete or replace each authority-leaf family in turn—C0a, request identity, raw provider payload/page, order, role, historical account/timeline, subject/contract, adverse basis—and require the one-argument parser to reject even when the attacker recomputes parent hashes. Also cover transitive path/hash/reference-projection mutation, restart idempotence, conflict, symlink/overwrite refusal, offline re-verification with the database disconnected and population directory unavailable, and zero attempt/final-hash references.
- [ ] Run `npm test -- tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts`; expected FAIL because the CLI is absent; abort if skipped.
- [ ] Export `parseServiceBoundaryEvidenceCaptureArgs()` and `runServiceBoundaryEvidenceCapture()`. Support only `capture-population --input <canonical-json> --output-root <new-directory> --confirm`, `evaluate-legacy-profile --input <canonical-json> --population-root <directory> --output <new-file> --confirm`, `verify-population --input-root <directory>`, and `verify-acceptance --input <canonical-json>`. Persist the C2-derived kinds `service_boundary_physical_inventory`, `service_boundary_eoa_at_anchor`, `service_boundary_evidence`, `service_boundary_capture_receipt`, and `service_boundary_physical_candidate_inventory`, schema `1`, through `insertUnifiedArtifact`; export those bodies plus byte-identical canonical aliases of every accepted upstream C0/request/raw-page/order/role/historical/control/adverse authority leaf into the closed relative hash graph atomically. Never synthesize or re-author an upstream leaf. Persist `service_boundary_physical_profile` only for the explicit legacy command; construct the acceptance from the reverified full population root by embedding the complete canonical graph/reference projection plus the exact canonical profile JSON text and their hashes. `verify-acceptance` calls only `parseServiceBoundaryPhysicalAcceptanceV1(value)` and must pass with PostgreSQL disconnected and the population root moved aside. The future C4 post-lock evaluator calls the pure adapter without adding a pre-lock profile.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts tests/unified-check/serviceBoundaryEvidenceCapture.test.ts tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts`; expected PASS, PostgreSQL executed `>0`, skipped `0`.
- [ ] Stage `scripts/captureServiceBoundaryEvidence.ts tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts`, then commit `feat: persist Stage C physical service evidence`.

### Task 8: Record real truth and run release verification

**Files:** Create from reviewed authority inputs `docs/audit/2026-07-stage-c/c2/physical-population-v1/physical-candidate-inventory-v1.json` and `docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json`; modify knowledge `02`, `04`, `09`, `10`, and `14` listed above.

- [ ] Capture the entire reviewed C0a population into the canonical candidate inventory without classifier output or quota truncation; separately run the profile adapter on one legacy/non-blind real control. Record exact command, Git/C0 hashes, full actual per-stratum counts, snapshot/anchor, request/page/inventory/evidence/EOA/receipt hashes, embedded legacy-profile byte hash, and cache decisions. Synthetic evidence cannot satisfy acceptance.

```powershell
node --import tsx scripts/captureServiceBoundaryEvidence.ts capture-population --input docs/audit/2026-07-stage-c/inputs/service-boundary-population-capture-v1.json --output-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --confirm
node --import tsx scripts/captureServiceBoundaryEvidence.ts evaluate-legacy-profile --input docs/audit/2026-07-stage-c/inputs/service-boundary-legacy-profile-control-v1.json --population-root docs/audit/2026-07-stage-c/c2/physical-population-v1 --output docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --confirm
node --import tsx scripts/captureServiceBoundaryEvidence.ts verify-population --input-root docs/audit/2026-07-stage-c/c2/physical-population-v1
node --import tsx scripts/captureServiceBoundaryEvidence.ts verify-acceptance --input docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json
```

Expected: exit `0` when the inventory exactly reconciles the full C0a-eligible universe, its actual counts are at least 15 fully bound intermediates, three exact checked-subject controls, three exact contract controls, and three controls whose named authority gap is itself proven by source bytes, and it contains at least one hash-bound typed-unresolved C2 evidence basis for every C0 adverse authority class. A fixture with `17/4/3/5` must remain `17/4/3/5`; no C2 step may trim it to `15/3/3/3`. The incomplete/adverse rows remain `boundaryAuthority:false`; they do not block exact-positive C3/C4 preservation, but they can never support a complete negative. A required complete-intermediate authority failure exits `2`. An invalid control/adverse binding is preserved as a typed ineligible/blocker result and prevents acceptance or C4 start without aborting unrelated candidate capture; malformed/tampered input exits `1` without acceptance.
- [ ] Accept C2 only when the embedded full population graph reparses offline, its candidate inventory has actual counts at or above the C4 `15 + 3 + 3 + 3` minima, it covers all six adverse classes, its reference projection is all-zero, and at least one legacy/non-blind real complete `100+100` profile proves the adapter path. Require both the embedded graph and canonical profile bytes to hash/cross-bind through the one-argument parser. C2 does not choose the eventual cases. Otherwise record C2 implemented but authority-blocked and do not start C3/C4 acceptance.
- [ ] Update knowledge truth: exact source/result or blocker, shadow still non-authoritative, no `500+100`, no production/score change.
- [ ] Run focused gate: `npm test -- tests/forensics/serviceBoundaryEvidence.test.ts tests/forensics/serviceBehaviorResearch.test.ts tests/unified-check/serviceBoundaryEvidenceCapture.test.ts tests/unified-check/serviceBoundaryEvidenceCapture.postgres.test.ts tests/unified-check/providerRequest.test.ts tests/unified-check/serviceRoleShadow.test.ts`; expected all PASS and zero PostgreSQL skips.
- [ ] Run `npm run typecheck`, `npm test`, and `git diff --check`; expected exit `0`/no new failures.
- [ ] Stage the write-once inputs/exports and knowledge truth, then commit:

```powershell
git add docs/audit/2026-07-stage-c/inputs/service-boundary-population-capture-v1.json docs/audit/2026-07-stage-c/inputs/service-boundary-legacy-profile-control-v1.json docs/audit/2026-07-stage-c/c2/physical-population-v1 docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json docs/knowledge/02-check-modes.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: record Stage C physical authority result"
```

## Hard aborts

- Abort if C0a is unaccepted, a historical endpoint is guessed, or arbitrary witness JSON is trusted.
- Abort if a witness hash includes its own envelope, or if any C0/request/raw-page/order/role/historical/control/adverse authority leaf is represented only by a hash, cannot be parsed from canonical bytes by its owner, or is absent from the embedded closure.
- For a candidate declared `intermediate_eoa_complete`, abort that mandatory capture on window size other than exactly 100 canonical events, duplicate top-up, future/mixed-snapshot data, page collision, non-progressing pagination, role gap/conflict, unresolved order, or unresolved historical EOA. Do not apply this hard-abort rule to a reviewed intentional-incomplete control whose single named gap is source-proven, or to an adverse basis that intentionally has no physical negative-authority claim.
- A malformed or mismatched intentional-incomplete/control/adverse binding makes that row typed ineligible and C2/C4 authority-blocked; it does not erase already captured rows or turn the expected non-authoritative state itself into a hard abort.
- Abort if route anchor/classifier policy enters HTTP identity or any offset above 50 is requested.
- Abort if reconstructed history/current metadata is promoted, or any C2 artifact enters attempts, final hashes, traversal, score, report, Admin, Telegram, or delivery.
- Abort C3/C4 acceptance if the C2 acceptance, embedded population/control graph, reference projection, or full-universe reconciliation is absent/tampered, or if the minimum complete-intermediate authority is unresolved. Do not block solely because accepted intentional-incomplete controls and adverse bases retain their required `boundaryAuthority:false`/typed-unresolved state.

## Completion definition

C2 code is complete when the fixed capture, cache reuse, immutable full-universe inventory, derived actual counts, order/role gates, classifier adapter, EOA parser, self-contained population/control graph and legacy-profile acceptance, standalone persistence, disposable PostgreSQL proof, typecheck, and full suite pass. C2 authority is accepted only after a reviewed real receipt proves every required complete-intermediate authority, every control's declared basis, coverage of all six adverse classes, counts at or above the frozen minima, zero production references, and offline re-verification of the embedded graph/profile without PostgreSQL or the external population root. Selection of exactly `15/3/3/3 + 6` belongs only to C4; otherwise the documented authority blocker is the correct result.
