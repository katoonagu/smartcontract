# Stage C3 Adverse Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete deterministic adverse-applicability receipt for each physical service candidate while preserving exact terminal red evidence, exact-bound continuations, typed unresolved states, and the existing five-trigger full-information ceiling.

**Architecture:** A pure probe module first validates an accepted C2 physical-acceptance root plus its bounded content-addressed population, then derives a complete applicability matrix only from one opaque C2 candidate context that binds the rehashed inventory, selected candidate reference, and evidence object. The persisted C3 graph embeds that exact source root, and offline verification independently revalidates and compares it before rebuilding every context. Callers cannot provide inventory authority, evidence class, mandatory checks, expected IDs, or positive-row mappings. C3 owns one frozen evidence-class-to-positive-check requirement map; the module validates per-check outcomes and reduces them to one endpoint action plus sorted continuation bindings. It adapts existing exact modules and the shared selective enricher; one optional callback exposes existing overflow without changing returned V1 bytes. A thin CLI persists standalone score-neutral artifacts with no traversal consumer.

**Tech Stack:** TypeScript 5.7, Node.js ESM, Vitest, PostgreSQL, existing exact forensics modules, selective transaction enrichment, canonical hashing, and the Unified artifact store.

---

## Verified truth and boundaries

- `decideAdversePathDispositionV1()` is the pure offline leaf for `provenance-adverse-terminal-matrix-v1` and has no production caller.
- `createSelectiveTransactionEnricher()` sorts hard before optional candidates and caps new full requests at five in `intermediate_boundary` mode.
- Subject mode is uncapped. Persisted full evidence loads before slot acquisition and does not consume the limit.
- Overflow currently becomes `missing_evidence`/continue traversal but has no dedicated standalone observer event.
- Existing modules separately cover blacklist timing, sanctions, service identity, approval/transferFrom, Verify20, GasFree, poisoning/provider risk, provider finality, and movement binding.
- Exact terminal evidence cannot be removed by service inference, materiality, or cashflow.
- C3 does not alter production traversal, boundary action, canonical facts, scoring, report, Admin, Telegram, delivery, or Stage D.

## Preconditions and hard start gate

1. C0a is accepted.
2. C2 has a reviewed real `service-boundary-physical-acceptance-v1` whose bound `service-boundary-physical-candidate-inventory-v1` meets the `15 + 3 + 3 + 3` control quotas, with exact capture receipts and authoritative `eoa_at_anchor` for every intermediate candidate. Both committed C2 roots and their bounded artifact graph must remain readable without PostgreSQL.
3. Read `AGENT_BRIEF.md`, knowledge `02`, `04`, `05`, `06`, `07`, `09`, `10`, `14`, the C2 receipt, the approved Stage C design, and the normative 2026-07-30 adverse matrix.
4. If C2 is implemented but authority-blocked, stop before Task 1 and record C3 blocked. Reconstructed history cannot satisfy this gate.

## Locked file map

**Create**

- `src/forensics/serviceBoundaryAdverseProbe.ts` — registry, C2-derived applicability matrix, strict rows, owning parsers, adapters, reducer, validator, hashes.
- `scripts/captureServiceBoundaryAdverse.ts` — dependency assembly and standalone persistence.
- `tests/forensics/serviceBoundaryAdverseProbe.test.ts` — registry/outcome/reducer/adapter tests.
- `tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts` — immutable persistence and isolation proof.

**Modify**

- `src/forensics/selectiveTransactionEnrichment.ts` — named options plus optional overflow callback; result V1 stays unchanged.
- `tests/forensics/selectiveTransactionEnrichment.test.ts` — overflow, cache, subject, and V1-shape regressions.
- Knowledge pages `02`, `04`, `05`, `06`, `09`, `10`, and `14` after real execution.

**Reuse unchanged**

- `src/forensics/serviceBoundaryEvidence.ts`
- `src/forensics/adversePathDisposition.ts`
- `src/tron/usdtBlacklistTimeline.ts`
- `src/forensics/directHardEvidence.ts`
- `src/forensics/sanctionedServiceRegistry.ts`
- `src/unifiedCheck/providerServiceBindings.ts`
- `src/forensics/approvalDrainProvenance.ts`
- `src/forensics/verify20Fingerprint.ts`
- `src/forensics/gasFreeSettlement.ts`
- `src/forensics/cashflowCanonicalTape.ts`
- `src/forensics/cashflowShadowArtifact.ts`
- `src/unifiedCheck/serviceRoleExactEvidenceCapture.ts`
- `src/unifiedCheck/labelCatalog.ts`
- `src/unifiedCheck/frozenLabels.ts`
- `src/storage/transactionEvidenceRepository.ts`
- `src/unifiedCheck/repository.ts`

Do not modify `src/index.ts`, production traversal/boundary/finalizer/scoring/report/Admin/Telegram/delivery, migrations, matrix-v4, or ScoreAnchorV3.

The C3 audit output root has one exact layout owned by this plan: fixed root files `adverse-candidate-inventory-v1.json` and `adverse-population-receipt-v1.json`, plus only `applicability-matrices/<sha256>.json`, `authority-leaves/<sha256>.json`, `check-rows/<sha256>.json`, and `adverse-receipts/<sha256>.json`. Capture and verification reject an alternate directory/name, unknown file, duplicate/path alias, orphan, symlink, or reparse point.

## Required contracts

```ts
export const SERVICE_BOUNDARY_ADVERSE_POLICY_V1 =
  "service-boundary-adverse-policy-v1" as const;

export const SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1 = {
  populationReceipt: "adverse-population-receipt-v1.json",
  candidateInventory: "adverse-candidate-inventory-v1.json",
  applicabilityMatrixRoot: "applicability-matrices",
  authorityLeafRoot: "authority-leaves",
  checkRowRoot: "check-rows",
  adverseReceiptRoot: "adverse-receipts"
} as const;

export type ServiceBoundaryAdverseStoredArtifactRefV1 = {
  readonly kind: "candidate_inventory" | "applicability_matrix" |
    "check_row" | "adverse_receipt";
  readonly sha256: string;
};

export type ServiceBoundaryAdverseAuthorityLeafRefV1<
  K extends ServiceBoundaryAdverseCheckIdV1 = ServiceBoundaryAdverseCheckIdV1
> = {
  readonly kind: "authority_leaf";
  readonly checkId: K;
  readonly sha256: string;
};

export type ServiceBoundaryAdverseGraphArtifactRefV1 =
  | ServiceBoundaryAdverseStoredArtifactRefV1
  | ServiceBoundaryAdverseAuthorityLeafRefV1;

export type ResolvedServiceBoundaryAdverseGraphArtifactV1 = {
  readonly relativePath: string;
  readonly canonicalJsonUtf8: string;
  readonly symlinkFree: true;
};

export function serviceBoundaryAdverseArtifactRelativePathV1(
  ref: ServiceBoundaryAdverseGraphArtifactRefV1
): string;

export type ServiceBoundaryAdverseCheckIdV1 =
  | "event_time_blacklist"
  | "event_time_sanctions_or_restriction"
  | "exact_service_exchange_identity"
  | "exact_restricted_service"
  | "tracked_drainer_or_collector"
  | "provider_risk_corroboration"
  | "poisoning_role"
  | "gasfree_role"
  | "approval_transferfrom_proxy_lead"
  | "verify20_terminal"
  | "verify_like_bound_lead"
  | "cashflow_terminal_relevance";

export type ServiceBoundaryAdverseAuthorityClassV1 =
  | "exact_terminal_risk"
  | "exact_bound_nonterminal"
  | "exact_service_role_context"
  | "provider_corroboration_context"
  | "economic_role_context"
  | "cashflow_relevance_context"
  | "negative_authority";

export type ServiceBoundaryAdverseDispositionClassV1 =
  | "terminal_red"
  | "continue_exact_path"
  | "context_only"
  | "applicability_context_only"
  | "cashflow_relevance_only"
  | "no_adverse_action";

const NEGATIVE_AUTHORITY_PAIR_V1 = [
  "negative_authority", "no_adverse_action"
] as const;

export const SERVICE_BOUNDARY_ADVERSE_REGISTRY_V1 = {
  event_time_blacklist: {
    positive: ["exact_terminal_risk", "terminal_red"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  event_time_sanctions_or_restriction: {
    positive: ["exact_terminal_risk", "terminal_red"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  exact_service_exchange_identity: {
    positive: ["exact_service_role_context", "context_only"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  exact_restricted_service: {
    positive: ["exact_terminal_risk", "terminal_red"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  tracked_drainer_or_collector: {
    positive: ["exact_terminal_risk", "terminal_red"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  provider_risk_corroboration: {
    positive: ["provider_corroboration_context", "context_only"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  poisoning_role: {
    positive: ["economic_role_context", "applicability_context_only"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  gasfree_role: {
    positive: ["economic_role_context", "applicability_context_only"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  approval_transferfrom_proxy_lead: {
    positive: ["exact_bound_nonterminal", "continue_exact_path"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  verify20_terminal: {
    positive: ["exact_terminal_risk", "terminal_red"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  verify_like_bound_lead: {
    positive: ["exact_bound_nonterminal", "continue_exact_path"], negative: NEGATIVE_AUTHORITY_PAIR_V1 },
  cashflow_terminal_relevance: {
    positive: ["cashflow_relevance_context", "cashflow_relevance_only"], negative: NEGATIVE_AUTHORITY_PAIR_V1 }
} as const;

export const SERVICE_BOUNDARY_ADVERSE_APPLICABILITY_V1 = {
  event_time_blacklist: "mandatory",
  event_time_sanctions_or_restriction: "mandatory",
  exact_service_exchange_identity: "mandatory",
  exact_restricted_service: "mandatory",
  tracked_drainer_or_collector: "mandatory",
  provider_risk_corroboration: "mandatory",
  poisoning_role: "mandatory",
  gasfree_role: "mandatory",
  approval_transferfrom_proxy_lead: "mandatory",
  verify20_terminal: "mandatory",
  verify_like_bound_lead: "mandatory",
  cashflow_terminal_relevance: "mandatory"
} as const satisfies Readonly<
  Record<ServiceBoundaryAdverseCheckIdV1, "mandatory" | "not_applicable">
>;

export type StageCAdverseEvidenceClassV1 =
  | "event_time_blacklist"
  | "active_sanctions_or_restriction"
  | "tracked_drainer_or_collector"
  | "exact_restricted_service"
  | "verify20_terminal"
  | "exact_bound_nonterminal";

export const SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1 = {
  event_time_blacklist: {
    satisfaction: "all_of",
    positiveCheckIds: ["event_time_blacklist"]
  },
  active_sanctions_or_restriction: {
    satisfaction: "all_of",
    positiveCheckIds: ["event_time_sanctions_or_restriction"]
  },
  tracked_drainer_or_collector: {
    satisfaction: "all_of",
    positiveCheckIds: ["tracked_drainer_or_collector"]
  },
  exact_restricted_service: {
    satisfaction: "all_of",
    positiveCheckIds: ["exact_restricted_service"]
  },
  verify20_terminal: {
    satisfaction: "all_of",
    positiveCheckIds: ["verify20_terminal"]
  },
  exact_bound_nonterminal: {
    satisfaction: "any_of",
    positiveCheckIds: [
      "approval_transferfrom_proxy_lead",
      "verify_like_bound_lead"
    ]
  }
} as const satisfies Readonly<Record<
  StageCAdverseEvidenceClassV1,
  {
    readonly satisfaction: "all_of" | "any_of";
    readonly positiveCheckIds: readonly ServiceBoundaryAdverseCheckIdV1[];
  }
>>;

export type ServiceBoundaryAdverseOutcomeV1 =
  "proven" | "not_found" | "not_applicable" | "unresolved";
```

The registry is an exact allowlist of triples and applicability. Benign service identity is context; restricted service has a separate terminal row. Provider risk, poisoning, GasFree, or method-only Verify20 cannot become red from `outcome:"proven"` alone. Unknown triples reject the receipt. V1 deliberately makes every check mandatory for every C2 candidate: checked-subject, contract, or incomplete-control status is never a caller-controlled excuse to suppress exact adverse evidence. A later policy may introduce a frozen `not_applicable` rule only by changing the policy/version and registry; callers cannot do so in V1.

`SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1` is the sole producer-owned C3 filesystem layout. `serviceBoundaryAdverseArtifactRelativePathV1()` returns the fixed candidate-inventory filename for `candidate_inventory`, and exactly `applicability-matrices/<sha256>.json`, `authority-leaves/<sha256>.json`, `check-rows/<sha256>.json`, or `adverse-receipts/<sha256>.json` for the other four kinds. An `authority_leaf` ref additionally requires the exact check ID carried by its typed leaf body; two check families cannot reinterpret the same hash. The population receipt is always the fixed `adverse-population-receipt-v1.json`. The helper accepts no caller path, normalizes nothing, and rejects a non-lowercase SHA-256. C4/C6 import this constant/function rather than declaring another C3 layout.

`SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1` is the sole C3 owner of the six C0/C2 adverse evidence-class bindings. Five classes require their one `all_of` row. `exact_bound_nonterminal` has the unambiguous `any_of` rule: at least one of `approval_transferfrom_proxy_lead` or `verify_like_bound_lead` must be a registry-valid positive `proven` row with a complete exact continuation binding; both are permitted and both are recorded when proven. The other mapped row remains an ordinary mandatory check and therefore must still be present as `proven`, authoritative `not_found`, or typed `unresolved`; `any_of` never permits omission or `not_applicable`. Downstream C4/C6 must import this constant and verify its exact entries instead of redeclaring an adverse map.

```ts
export type ServiceBoundaryAdverseApplicabilityMatrixRowV1 = {
  readonly checkId: ServiceBoundaryAdverseCheckIdV1;
  readonly applicability: "mandatory" | "not_applicable";
  readonly applicabilityEvidenceSha256s: readonly string[];
};

export type ServiceBoundaryAdverseApplicabilityMatrixV1 = {
  readonly schemaVersion:
    "service-boundary-adverse-applicability-matrix-v1";
  readonly policyVersion: typeof SERVICE_BOUNDARY_ADVERSE_POLICY_V1;
  readonly serviceBoundaryEvidenceSha256: string;
  readonly c2InventorySha256: string;
  readonly c2CandidateId: string;
  readonly c2ControlStratum:
    ServiceBoundaryPhysicalCandidateRefV1["controlStratum"];
  readonly c2AdverseEvidenceClass: StageCAdverseEvidenceClassV1 | null;
  readonly c2AuthorityState:
    | "complete_intermediate_eoa"
    | "checked_subject_excluded"
    | "contract_at_anchor"
    | "unresolved";
  readonly rows: readonly ServiceBoundaryAdverseApplicabilityMatrixRowV1[];
  readonly productionEffect: false;
};

declare const VALIDATED_ADVERSE_APPLICABILITY_MATRIX_V1: unique symbol;
declare const VALIDATED_C2_ADVERSE_SOURCE_ROOT_V1: unique symbol;
declare const VALIDATED_C2_ADVERSE_CANDIDATE_CONTEXT_V1: unique symbol;

export type ServiceBoundaryPhysicalCandidateRefV1 =
  ServiceBoundaryPhysicalCandidateInventoryV1["candidateReceipts"][number];

export type ServiceBoundaryAdverseC2ArtifactRefV1 = {
  readonly relativePath: string;
  readonly sha256: string;
};

export type ResolvedServiceBoundaryAdverseC2ArtifactV1 = {
  readonly repositoryRelativePath: string;
  readonly canonicalJsonUtf8: string;
  readonly symlinkFree: true;
};

export type ServiceBoundaryAdverseC2SourceRootV1 = {
  readonly schemaVersion: "service-boundary-adverse-c2-source-root-v1";
  readonly physicalAcceptanceRef: ServiceBoundaryAdverseC2ArtifactRefV1;
  readonly physicalPopulationRoot: string;
  readonly physicalCandidateInventoryRef:
    ServiceBoundaryAdverseC2ArtifactRefV1;
  readonly productionEffect: false;
};

export type ValidatedC2AdverseSourceRootV1 = {
  readonly sourceRoot: ServiceBoundaryAdverseC2SourceRootV1;
  readonly acceptance: ServiceBoundaryPhysicalAcceptanceV1;
  readonly inventorySha256: string;
  readonly inventory: ServiceBoundaryPhysicalCandidateInventoryV1;
  readonly [VALIDATED_C2_ADVERSE_SOURCE_ROOT_V1]: true;
};

export function validateC2AdverseSourceRootV1(input: {
  readonly value: unknown;
  readonly resolveC2Artifact: (
    ref: ServiceBoundaryAdverseC2ArtifactRefV1
  ) => ResolvedServiceBoundaryAdverseC2ArtifactV1;
}): ValidatedC2AdverseSourceRootV1;

export type ValidatedC2AdverseCandidateContextV1 = {
  readonly inventorySha256: string;
  readonly candidateRef: ServiceBoundaryPhysicalCandidateRefV1;
  readonly evidenceSha256: string;
  readonly evidence: ServiceBoundaryEvidenceV1;
  readonly [VALIDATED_C2_ADVERSE_CANDIDATE_CONTEXT_V1]: true;
};

export function validateC2AdverseCandidateContextV1(input: {
  readonly c2Root: ValidatedC2AdverseSourceRootV1;
  readonly candidateId: string;
  readonly resolveC2Artifact: (
    ref: ServiceBoundaryAdverseC2ArtifactRefV1
  ) => ResolvedServiceBoundaryAdverseC2ArtifactV1;
}): ValidatedC2AdverseCandidateContextV1;

export type ValidatedServiceBoundaryAdverseApplicabilityMatrixV1 =
  ServiceBoundaryAdverseApplicabilityMatrixV1 & {
    readonly [VALIDATED_ADVERSE_APPLICABILITY_MATRIX_V1]: true;
  };

export function buildServiceBoundaryAdverseApplicabilityMatrixV1(input: {
  readonly c2Context: ValidatedC2AdverseCandidateContextV1;
}): {
  readonly sha256: string;
  readonly matrix: ValidatedServiceBoundaryAdverseApplicabilityMatrixV1;
};

export function validateServiceBoundaryAdverseApplicabilityMatrixV1(input: {
  readonly value: unknown;
  readonly c2Context: ValidatedC2AdverseCandidateContextV1;
}): {
  readonly sha256: string;
  readonly matrix: ValidatedServiceBoundaryAdverseApplicabilityMatrixV1;
};
```

`validateC2AdverseSourceRootV1()` strictly parses the persisted root, requires canonical repository-relative paths with no traversal and a candidate-inventory path beneath `physicalPopulationRoot`, then resolves exact UTF-8 bytes for both refs. The filesystem resolver must return the exact requested repository-relative path and `symlinkFree:true`; the validator rejects any mismatch. It invokes C2's owning one-argument physical-acceptance parser first, which recursively validates the embedded C0a/source-authority manifest, request identities, raw provider payload/pages, transaction-order, economic-role, historical account/timeline, subject/contract, adverse-basis, inventory/EOA/evidence/receipt bodies and their reference projection. It then invokes the candidate-inventory parser/serializer, requires serializer byte equality, recomputes both file hashes, requires `acceptance.body.accepted:true`, and cross-binds `acceptance.body.candidateInventorySha256` to `physicalCandidateInventoryRef.sha256`. It also requires every external candidate artifact-ref set to equal the corresponding embedded graph paths/hashes, remain canonical and duplicate-free beneath the same bounded root, and give any shared path one identical hash. Only this function returns the opaque accepted C2 source-root brand.

`validateC2AdverseCandidateContextV1()` accepts that branded root rather than inventory bytes or a caller hash. It selects exactly one in-inventory `candidateId`, resolves every artifact ref for that candidate from the bounded C2 graph, invokes each C2/upstream owning parser/serializer, and rehashes the C0a/request/raw-page/order/role/historical/control/adverse leaves plus physical inventory, EOA result, boundary evidence, and capture receipt to their declared refs. The capture receipt must bind the evidence/physical-inventory/EOA hashes; the physical inventory and events must bind their exact source/order/role leaves and candidate address/subject/snapshot/anchor; and the evidence must bind the physical-inventory/EOA authority result. Only then does it return the selected candidate ref, accepted candidate-inventory hash, boundary-evidence hash/value, and the C2-derived `candidateRef.adverseAuthorityClass` under one opaque brand. A detached or merely structurally valid inventory, hash-only/missing authority leaf, duplicate ref, out-of-root path, mismatched inventory/evidence/transitive hash, identity, snapshot, anchor, stratum, or authority state rejects before either brand is returned.

The matrix builder receives only this opaque context: it has no inventory hash, candidate ref, evidence class, evidence hash, expected-ID list, or applicability override parameter. It copies `c2InventorySha256`, candidate identity/stratum/evidence class, authority state, and evidence hash from the context, then emits exactly one row per frozen registry key in registry order. Every row's `applicabilityEvidenceSha256s` is `sortUnique([c2Context.evidenceSha256, c2Context.inventorySha256])`; no input field can add, remove, or downgrade a check. The matrix validator independently rebuilds the expected matrix from the same context and requires exact canonical equality and hash equality. A subset, duplicate, reordered key set, caller-supplied `not_applicable`, changed context field, or extra key is invalid.

```ts
import type {
  ApprovalDrainProvenanceProfile,
  UsdtBlacklistTimeline
} from "../types.js";
import type {
  AdversePathDispositionV1,
  ExactBoundLeadInputV1,
  ExactEndpointSafetyInputV1,
  SelectedAmountRelevanceInputV1
} from "./adversePathDisposition.js";
import type {
  SanctionedCryptoService,
  SanctionedServiceTemporalState
} from "./sanctionedServiceRegistry.js";
import type {
  Verify20FingerprintInput,
  Verify20FingerprintResult
} from "./verify20Fingerprint.js";
import type { VerifiedBlacklistTransaction } from "../tron/usdtBlacklistTimeline.js";
import type {
  ServiceRoleExactEvidenceCaptureReceiptV1,
  ServiceRoleGasFreeDispositionV1,
  ServiceRolePoisoningDispositionV1,
  ServiceRoleProviderRiskDispositionV1
} from "../unifiedCheck/serviceRoleExactEvidenceCapture.js";
import type {
  TransactionProviderMovementWitnessV1,
  TronTransactionProviderEvidenceV1
} from "../storage/transactionEvidenceRepository.js";
import type {
  FrozenLabelRecordV1,
  FrozenLabelResolutionV1
} from "../unifiedCheck/labelCatalog.js";
import type { FrozenLabelDatasetV1 } from "../unifiedCheck/frozenLabels.js";
import type {
  CashflowAuthorityEnvelopeV1
} from "./cashflowCanonicalTape.js";
import type { CashflowShadowArtifactV1 } from "./cashflowShadowArtifact.js";

export type ServiceBoundaryAdverseAuthorityCoverageV1 =
  | {
      readonly state: "complete";
      readonly authorityArtifactSha256s: readonly [string, ...string[]];
      readonly unresolvedReason: null;
    }
  | {
      readonly state: "unresolved";
      readonly authorityArtifactSha256s: readonly [string, ...string[]];
      readonly unresolvedReason: "timeout" | "full_request_overflow" |
        "missing_binding" | "unsupported_authority" | "partial_coverage" |
        "provider_unavailable";
    };

export type ServiceBoundaryAdverseSourceParserVersionV1 =
  | "usdt-blacklist-rows-v1"
  | "usdt-blacklist-transaction-v1"
  | "sanctioned-service-registry-v1"
  | "frozen-label-dataset-v1"
  | "stage-c-tracked-adverse-endpoint-registry-v1"
  | "service-role-exact-evidence-capture-v1"
  | "transaction-provider-evidence-v1"
  | "approval-drain-provenance-v1"
  | "verify20-contract-profile-v1"
  | "cashflow-authority-envelope-v1"
  | "cashflow-shadow-artifact-v1";

export type ServiceBoundaryAdverseCanonicalSourceV1<
  P extends ServiceBoundaryAdverseSourceParserVersionV1
> = {
  readonly parserVersion: P;
  readonly sha256: string;
  readonly canonicalJsonUtf8: string;
};

export type StageCTrackedAdverseEndpointRegistryV1 = {
  readonly schemaVersion: "stage-c-tracked-adverse-endpoint-registry-v1";
  readonly policyVersion: "stage-c-tracked-adverse-endpoint-registry-v1";
  readonly entries: readonly {
    readonly entryId: string;
    readonly address: string;
    readonly role: "drainer" | "collector";
    readonly validFrom: string;
    readonly validTo: string | null;
    readonly sourceArtifactSha256: string;
  }[];
};

export type StageCTrackedAdverseEndpointAssertionV1 = {
  readonly schemaVersion: "stage-c-tracked-adverse-endpoint-assertion-v1";
  readonly policyVersion: "stage-c-tracked-adverse-endpoint-registry-v1";
  readonly datasetSha256: string;
  readonly entry: StageCTrackedAdverseEndpointRegistryV1["entries"][number];
};

export type EventTimeBlacklistAuthorityLeafBodyV1 = {
  readonly schemaVersion: "event-time-blacklist-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly anchorTimestamp: string;
  readonly rowsSource: ServiceBoundaryAdverseCanonicalSourceV1<
    "usdt-blacklist-rows-v1"
  >;
  readonly transactionSources: readonly ServiceBoundaryAdverseCanonicalSourceV1<
    "usdt-blacklist-transaction-v1"
  >[];
  readonly timeline: UsdtBlacklistTimeline;
  readonly verifiedTransactions: readonly VerifiedBlacklistTransaction[];
  readonly blacklistedAtAnchor: boolean | null;
};

export type EventTimeSanctionsOrRestrictionAuthorityLeafBodyV1 = {
  readonly schemaVersion:
    "event-time-sanctions-or-restriction-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly anchorTimestamp: string;
  readonly identitySource: ServiceBoundaryAdverseCanonicalSourceV1<
    "frozen-label-dataset-v1"
  >;
  readonly identityDataset: FrozenLabelDatasetV1;
  readonly identityRecord: FrozenLabelRecordV1 | null;
  readonly identityResolution: FrozenLabelResolutionV1 | null;
  readonly registrySource: ServiceBoundaryAdverseCanonicalSourceV1<
    "sanctioned-service-registry-v1"
  >;
  readonly matchedService: SanctionedCryptoService | null;
  readonly stateAtAnchor: SanctionedServiceTemporalState;
};

export type ExactServiceIdentityAuthorityLeafBodyV1 = {
  readonly schemaVersion: "exact-service-identity-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly anchorTimestamp: string;
  readonly source: ServiceBoundaryAdverseCanonicalSourceV1<
    "frozen-label-dataset-v1"
  >;
  readonly dataset: FrozenLabelDatasetV1;
  readonly record: FrozenLabelRecordV1 | null;
  readonly resolution: FrozenLabelResolutionV1 | null;
};

export type ExactRestrictedServiceAuthorityLeafBodyV1 = {
  readonly schemaVersion: "exact-restricted-service-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly anchorTimestamp: string;
  readonly identitySource: ServiceBoundaryAdverseCanonicalSourceV1<
    "frozen-label-dataset-v1"
  >;
  readonly identityDataset: FrozenLabelDatasetV1;
  readonly identityRecord: FrozenLabelRecordV1 | null;
  readonly identityResolution: FrozenLabelResolutionV1 | null;
  readonly registrySource: ServiceBoundaryAdverseCanonicalSourceV1<
    "sanctioned-service-registry-v1"
  >;
  readonly matchedService: SanctionedCryptoService | null;
  readonly stateAtAnchor: SanctionedServiceTemporalState;
  readonly terminalInput: ExactEndpointSafetyInputV1 | null;
  readonly terminalDisposition: AdversePathDispositionV1 | null;
};

export type TrackedDrainerCollectorAuthorityLeafBodyV1 = {
  readonly schemaVersion: "tracked-drainer-collector-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly anchorTimestamp: string;
  readonly registrySource: ServiceBoundaryAdverseCanonicalSourceV1<
    "stage-c-tracked-adverse-endpoint-registry-v1"
  >;
  readonly registry: StageCTrackedAdverseEndpointRegistryV1;
  readonly assertion: StageCTrackedAdverseEndpointAssertionV1 | null;
  readonly terminalInput: ExactEndpointSafetyInputV1 | null;
  readonly terminalDisposition: AdversePathDispositionV1 | null;
};

export type ProviderRiskAuthorityLeafBodyV1 = {
  readonly schemaVersion: "provider-risk-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly canonicalEventId: string;
  readonly source: ServiceBoundaryAdverseCanonicalSourceV1<
    "service-role-exact-evidence-capture-v1"
  >;
  readonly captureReceipt: ServiceRoleExactEvidenceCaptureReceiptV1;
  readonly transactionEvidenceSource:
    ServiceBoundaryAdverseCanonicalSourceV1<
      "transaction-provider-evidence-v1"
    >;
  readonly transactionEvidence: TronTransactionProviderEvidenceV1;
  readonly disposition: ServiceRoleProviderRiskDispositionV1 | null;
};

export type PoisoningRoleAuthorityLeafBodyV1 = {
  readonly schemaVersion: "poisoning-role-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly canonicalEventId: string;
  readonly source: ServiceBoundaryAdverseCanonicalSourceV1<
    "service-role-exact-evidence-capture-v1"
  >;
  readonly captureReceipt: ServiceRoleExactEvidenceCaptureReceiptV1;
  readonly disposition: ServiceRolePoisoningDispositionV1 | null;
};

export type GasFreeRoleAuthorityLeafBodyV1 = {
  readonly schemaVersion: "gasfree-role-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly canonicalEventId: string;
  readonly source: ServiceBoundaryAdverseCanonicalSourceV1<
    "service-role-exact-evidence-capture-v1"
  >;
  readonly captureReceipt: ServiceRoleExactEvidenceCaptureReceiptV1;
  readonly transactionEvidenceSource:
    ServiceBoundaryAdverseCanonicalSourceV1<
      "transaction-provider-evidence-v1"
    >;
  readonly transactionEvidence: TronTransactionProviderEvidenceV1;
  readonly disposition: ServiceRoleGasFreeDispositionV1 | null;
};

export type ApprovalTransferFromProxyAuthorityLeafBodyV1 = {
  readonly schemaVersion:
    "approval-transferfrom-proxy-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly source: ServiceBoundaryAdverseCanonicalSourceV1<
    "approval-drain-provenance-v1"
  >;
  readonly profile: ApprovalDrainProvenanceProfile | null;
  readonly evidenceBinding: {
    readonly rawEvidenceId: string;
    readonly observationId: string;
  } | null;
  readonly pathInput: ExactBoundLeadInputV1 | null;
  readonly pathDisposition: AdversePathDispositionV1 | null;
};

export type Verify20TerminalAuthorityLeafBodyV1 = {
  readonly schemaVersion: "verify20-terminal-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly contractSource: ServiceBoundaryAdverseCanonicalSourceV1<
    "verify20-contract-profile-v1"
  >;
  readonly fingerprintInput: Verify20FingerprintInput;
  readonly fingerprintResult: Verify20FingerprintResult;
  readonly transactionEvidenceSource:
    ServiceBoundaryAdverseCanonicalSourceV1<
      "transaction-provider-evidence-v1"
    > | null;
  readonly transactionEvidence: TronTransactionProviderEvidenceV1 | null;
  readonly movement: TransactionProviderMovementWitnessV1 | null;
  readonly terminalInput: ExactEndpointSafetyInputV1 | null;
  readonly terminalDisposition: AdversePathDispositionV1 | null;
};

export type VerifyLikeBoundLeadAuthorityLeafBodyV1 = {
  readonly schemaVersion: "verify-like-bound-lead-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly contractSource: ServiceBoundaryAdverseCanonicalSourceV1<
    "verify20-contract-profile-v1"
  >;
  readonly fingerprintInput: Verify20FingerprintInput;
  readonly fingerprintResult: Verify20FingerprintResult;
  readonly pathInput: ExactBoundLeadInputV1 | null;
  readonly pathDisposition: AdversePathDispositionV1 | null;
};

export type ServiceBoundaryAdverseTerminalCheckIdV1 =
  | "event_time_blacklist"
  | "event_time_sanctions_or_restriction"
  | "exact_restricted_service"
  | "tracked_drainer_or_collector"
  | "verify20_terminal";

export type CashflowRelevanceAuthorityLeafBodyV1 = {
  readonly schemaVersion: "cashflow-relevance-authority-leaf-body-v1";
  readonly coverage: ServiceBoundaryAdverseAuthorityCoverageV1;
  readonly authoritySource: ServiceBoundaryAdverseCanonicalSourceV1<
    "cashflow-authority-envelope-v1"
  >;
  readonly authorityEnvelope: CashflowAuthorityEnvelopeV1;
  readonly shadowSource: ServiceBoundaryAdverseCanonicalSourceV1<
    "cashflow-shadow-artifact-v1"
  >;
  readonly shadowArtifact: CashflowShadowArtifactV1;
  readonly terminalAuthorityLeafRef:
    ServiceBoundaryAdverseAuthorityLeafRefV1<
      ServiceBoundaryAdverseTerminalCheckIdV1
    > | null;
  readonly relevanceInput: SelectedAmountRelevanceInputV1 | null;
  readonly relevanceDisposition: AdversePathDispositionV1 | null;
};

export type ServiceBoundaryAdverseAuthorityBodyByCheckV1 = {
  event_time_blacklist: EventTimeBlacklistAuthorityLeafBodyV1;
  event_time_sanctions_or_restriction:
    EventTimeSanctionsOrRestrictionAuthorityLeafBodyV1;
  exact_service_exchange_identity: ExactServiceIdentityAuthorityLeafBodyV1;
  exact_restricted_service: ExactRestrictedServiceAuthorityLeafBodyV1;
  tracked_drainer_or_collector: TrackedDrainerCollectorAuthorityLeafBodyV1;
  provider_risk_corroboration: ProviderRiskAuthorityLeafBodyV1;
  poisoning_role: PoisoningRoleAuthorityLeafBodyV1;
  gasfree_role: GasFreeRoleAuthorityLeafBodyV1;
  approval_transferfrom_proxy_lead:
    ApprovalTransferFromProxyAuthorityLeafBodyV1;
  verify20_terminal: Verify20TerminalAuthorityLeafBodyV1;
  verify_like_bound_lead: VerifyLikeBoundLeadAuthorityLeafBodyV1;
  cashflow_terminal_relevance: CashflowRelevanceAuthorityLeafBodyV1;
};

export type ServiceBoundaryAdverseAuthorityLeafValueV1<
  K extends ServiceBoundaryAdverseCheckIdV1 = ServiceBoundaryAdverseCheckIdV1
> = { [P in K]: {
  readonly schemaVersion: "service-boundary-adverse-authority-leaf-v1";
  readonly policyVersion: typeof SERVICE_BOUNDARY_ADVERSE_POLICY_V1;
  readonly checkId: P;
  readonly candidateBinding: {
    readonly c2InventorySha256: string;
    readonly candidateId: string;
    readonly profiledAddress: string;
    readonly capturedSubjectAddress: string;
    readonly snapshotHash: string;
    readonly anchorEventId: string;
  };
  readonly authorityBinding: {
    readonly authorityEventIds: readonly string[];
    readonly finalityWitnessSha256s: readonly string[];
    readonly continuationAddress: string | null;
    readonly continuationEventIds: readonly string[];
  };
  readonly observedOutcome: ServiceBoundaryAdverseOutcomeV1;
  readonly body: ServiceBoundaryAdverseAuthorityBodyByCheckV1[P];
} }[K];

export function parseServiceBoundaryAdverseAuthorityLeafV1<
  K extends ServiceBoundaryAdverseCheckIdV1
>(
  value: unknown,
  ref: ServiceBoundaryAdverseAuthorityLeafRefV1<K>
): ServiceBoundaryAdverseAuthorityLeafValueV1<K>;

export function serializeServiceBoundaryAdverseAuthorityLeafV1<
  K extends ServiceBoundaryAdverseCheckIdV1
>(value: ServiceBoundaryAdverseAuthorityLeafValueV1<K>): string;

export function parseStageCTrackedAdverseEndpointAssertionV1(
  value: unknown
): StageCTrackedAdverseEndpointAssertionV1;
export function serializeStageCTrackedAdverseEndpointAssertionV1(
  value: StageCTrackedAdverseEndpointAssertionV1
): string;
export function parseStageCTrackedAdverseEndpointRegistryV1(
  value: unknown
): StageCTrackedAdverseEndpointRegistryV1;
export function serializeStageCTrackedAdverseEndpointRegistryV1(
  value: StageCTrackedAdverseEndpointRegistryV1
): string;

export type ServiceBoundaryAdverseAuthorityBodyCodecV1<
  K extends ServiceBoundaryAdverseCheckIdV1
> = {
  readonly schemaVersion:
    ServiceBoundaryAdverseAuthorityBodyByCheckV1[K]["schemaVersion"];
  readonly parse: (
    value: unknown
  ) => ServiceBoundaryAdverseAuthorityBodyByCheckV1[K];
  readonly serialize: (
    value: ServiceBoundaryAdverseAuthorityBodyByCheckV1[K]
  ) => string;
};

declare function parseEventTimeBlacklistAuthorityLeafBodyV1(
  value: unknown
): EventTimeBlacklistAuthorityLeafBodyV1;
declare function serializeEventTimeBlacklistAuthorityLeafBodyV1(
  value: EventTimeBlacklistAuthorityLeafBodyV1
): string;
declare function parseEventTimeSanctionsOrRestrictionAuthorityLeafBodyV1(
  value: unknown
): EventTimeSanctionsOrRestrictionAuthorityLeafBodyV1;
declare function serializeEventTimeSanctionsOrRestrictionAuthorityLeafBodyV1(
  value: EventTimeSanctionsOrRestrictionAuthorityLeafBodyV1
): string;
declare function parseExactServiceIdentityAuthorityLeafBodyV1(
  value: unknown
): ExactServiceIdentityAuthorityLeafBodyV1;
declare function serializeExactServiceIdentityAuthorityLeafBodyV1(
  value: ExactServiceIdentityAuthorityLeafBodyV1
): string;
declare function parseExactRestrictedServiceAuthorityLeafBodyV1(
  value: unknown
): ExactRestrictedServiceAuthorityLeafBodyV1;
declare function serializeExactRestrictedServiceAuthorityLeafBodyV1(
  value: ExactRestrictedServiceAuthorityLeafBodyV1
): string;
declare function parseTrackedDrainerCollectorAuthorityLeafBodyV1(
  value: unknown
): TrackedDrainerCollectorAuthorityLeafBodyV1;
declare function serializeTrackedDrainerCollectorAuthorityLeafBodyV1(
  value: TrackedDrainerCollectorAuthorityLeafBodyV1
): string;
declare function parseProviderRiskAuthorityLeafBodyV1(
  value: unknown
): ProviderRiskAuthorityLeafBodyV1;
declare function serializeProviderRiskAuthorityLeafBodyV1(
  value: ProviderRiskAuthorityLeafBodyV1
): string;
declare function parsePoisoningRoleAuthorityLeafBodyV1(
  value: unknown
): PoisoningRoleAuthorityLeafBodyV1;
declare function serializePoisoningRoleAuthorityLeafBodyV1(
  value: PoisoningRoleAuthorityLeafBodyV1
): string;
declare function parseGasFreeRoleAuthorityLeafBodyV1(
  value: unknown
): GasFreeRoleAuthorityLeafBodyV1;
declare function serializeGasFreeRoleAuthorityLeafBodyV1(
  value: GasFreeRoleAuthorityLeafBodyV1
): string;
declare function parseApprovalTransferFromProxyAuthorityLeafBodyV1(
  value: unknown
): ApprovalTransferFromProxyAuthorityLeafBodyV1;
declare function serializeApprovalTransferFromProxyAuthorityLeafBodyV1(
  value: ApprovalTransferFromProxyAuthorityLeafBodyV1
): string;
declare function parseVerify20TerminalAuthorityLeafBodyV1(
  value: unknown
): Verify20TerminalAuthorityLeafBodyV1;
declare function serializeVerify20TerminalAuthorityLeafBodyV1(
  value: Verify20TerminalAuthorityLeafBodyV1
): string;
declare function parseVerifyLikeBoundLeadAuthorityLeafBodyV1(
  value: unknown
): VerifyLikeBoundLeadAuthorityLeafBodyV1;
declare function serializeVerifyLikeBoundLeadAuthorityLeafBodyV1(
  value: VerifyLikeBoundLeadAuthorityLeafBodyV1
): string;
declare function parseCashflowRelevanceAuthorityLeafBodyV1(
  value: unknown
): CashflowRelevanceAuthorityLeafBodyV1;
declare function serializeCashflowRelevanceAuthorityLeafBodyV1(
  value: CashflowRelevanceAuthorityLeafBodyV1
): string;

export const SERVICE_BOUNDARY_ADVERSE_AUTHORITY_BODY_CODECS_V1 = {
  event_time_blacklist: {
    schemaVersion: "event-time-blacklist-authority-leaf-body-v1",
    parse: parseEventTimeBlacklistAuthorityLeafBodyV1,
    serialize: serializeEventTimeBlacklistAuthorityLeafBodyV1
  },
  event_time_sanctions_or_restriction: {
    schemaVersion: "event-time-sanctions-or-restriction-authority-leaf-body-v1",
    parse: parseEventTimeSanctionsOrRestrictionAuthorityLeafBodyV1,
    serialize: serializeEventTimeSanctionsOrRestrictionAuthorityLeafBodyV1
  },
  exact_service_exchange_identity: {
    schemaVersion: "exact-service-identity-authority-leaf-body-v1",
    parse: parseExactServiceIdentityAuthorityLeafBodyV1,
    serialize: serializeExactServiceIdentityAuthorityLeafBodyV1
  },
  exact_restricted_service: {
    schemaVersion: "exact-restricted-service-authority-leaf-body-v1",
    parse: parseExactRestrictedServiceAuthorityLeafBodyV1,
    serialize: serializeExactRestrictedServiceAuthorityLeafBodyV1
  },
  tracked_drainer_or_collector: {
    schemaVersion: "tracked-drainer-collector-authority-leaf-body-v1",
    parse: parseTrackedDrainerCollectorAuthorityLeafBodyV1,
    serialize: serializeTrackedDrainerCollectorAuthorityLeafBodyV1
  },
  provider_risk_corroboration: {
    schemaVersion: "provider-risk-authority-leaf-body-v1",
    parse: parseProviderRiskAuthorityLeafBodyV1,
    serialize: serializeProviderRiskAuthorityLeafBodyV1
  },
  poisoning_role: {
    schemaVersion: "poisoning-role-authority-leaf-body-v1",
    parse: parsePoisoningRoleAuthorityLeafBodyV1,
    serialize: serializePoisoningRoleAuthorityLeafBodyV1
  },
  gasfree_role: {
    schemaVersion: "gasfree-role-authority-leaf-body-v1",
    parse: parseGasFreeRoleAuthorityLeafBodyV1,
    serialize: serializeGasFreeRoleAuthorityLeafBodyV1
  },
  approval_transferfrom_proxy_lead: {
    schemaVersion: "approval-transferfrom-proxy-authority-leaf-body-v1",
    parse: parseApprovalTransferFromProxyAuthorityLeafBodyV1,
    serialize: serializeApprovalTransferFromProxyAuthorityLeafBodyV1
  },
  verify20_terminal: {
    schemaVersion: "verify20-terminal-authority-leaf-body-v1",
    parse: parseVerify20TerminalAuthorityLeafBodyV1,
    serialize: serializeVerify20TerminalAuthorityLeafBodyV1
  },
  verify_like_bound_lead: {
    schemaVersion: "verify-like-bound-lead-authority-leaf-body-v1",
    parse: parseVerifyLikeBoundLeadAuthorityLeafBodyV1,
    serialize: serializeVerifyLikeBoundLeadAuthorityLeafBodyV1
  },
  cashflow_terminal_relevance: {
    schemaVersion: "cashflow-relevance-authority-leaf-body-v1",
    parse: parseCashflowRelevanceAuthorityLeafBodyV1,
    serialize: serializeCashflowRelevanceAuthorityLeafBodyV1
  }
} as const satisfies {
  readonly [K in ServiceBoundaryAdverseCheckIdV1]:
    ServiceBoundaryAdverseAuthorityBodyCodecV1<K>;
};

type ServiceBoundaryAdverseCheckRowBaseV1<
  K extends ServiceBoundaryAdverseCheckIdV1
> = {
  readonly schemaVersion: "service-boundary-adverse-check-v1";
  readonly checkId: K;
  readonly applicabilityMatrixSha256: string;
  readonly authorityClass: ServiceBoundaryAdverseAuthorityClassV1;
  readonly dispositionClass: ServiceBoundaryAdverseDispositionClassV1;
  readonly outcome: ServiceBoundaryAdverseOutcomeV1;
  readonly authoritativeNegativeComplete: boolean;
  readonly terminalAuthorityComplete: boolean;
  readonly continuationAddress: string | null;
  readonly boundEventIds: readonly string[];
  readonly knownIntermediateEventIds: readonly string[];
  readonly authorityLeafRefs: readonly [
    ServiceBoundaryAdverseAuthorityLeafRefV1<K>,
    ...ServiceBoundaryAdverseAuthorityLeafRefV1<K>[]
  ];
  readonly unresolvedReason: "timeout" | "full_request_overflow" |
    "missing_binding" | "unsupported_authority" | "partial_coverage" |
    "provider_unavailable" | null;
};

export type ServiceBoundaryAdverseCheckRowV1 = {
  [K in ServiceBoundaryAdverseCheckIdV1]:
    ServiceBoundaryAdverseCheckRowBaseV1<K>
}[ServiceBoundaryAdverseCheckIdV1];

export type ServiceBoundaryAdverseAggregateActionV1 =
  "terminal_red" | "continue_full" | "continue_exact_path" |
  "adverse_clear_for_boundary";

export type ServiceBoundaryAdverseAggregateDispositionV1 =
  "terminal_red" | "adverse_unresolved" | "continue_exact_path" |
  "adverse_clear_for_boundary";

export type ServiceBoundaryAdverseReceiptV1 = {
  readonly schemaVersion: "service-boundary-adverse-receipt-v1";
  readonly policyVersion: typeof SERVICE_BOUNDARY_ADVERSE_POLICY_V1;
  readonly serviceBoundaryEvidenceSha256: string;
  readonly applicabilityMatrixSha256: string;
  readonly expectedCheckIds: readonly ServiceBoundaryAdverseCheckIdV1[];
  readonly rowSha256s: readonly string[];
  readonly resolvedCount: number;
  readonly expectedCount: number;
  readonly aggregateComplete: boolean;
  readonly terminalAuthorityComplete: boolean;
  readonly aggregateDisposition: ServiceBoundaryAdverseAggregateDispositionV1;
  readonly endpointAction: ServiceBoundaryAdverseAggregateActionV1;
  readonly continuationBindings: readonly {
    readonly continuationAddress: string;
    readonly boundEventIds: readonly string[];
  }[];
  readonly cashflowRelevanceEventIds: readonly string[];
  readonly adverseEvidenceClassRequirement: null | {
    readonly evidenceClass: StageCAdverseEvidenceClassV1;
    readonly satisfaction: "all_of" | "any_of";
    readonly mappedPositiveCheckIds:
      readonly ServiceBoundaryAdverseCheckIdV1[];
    readonly provenPositiveCheckIds:
      readonly ServiceBoundaryAdverseCheckIdV1[];
    readonly satisfied: boolean;
  };
  readonly limitations: readonly string[];
  readonly productionEffect: false;
};

export type ServiceBoundaryAdverseCandidateInventoryV1 = {
  readonly schemaVersion: "service-boundary-adverse-candidate-inventory-v1";
  readonly c2SourceRoot: ServiceBoundaryAdverseC2SourceRootV1;
  readonly c2PhysicalCandidateInventorySha256: string;
  readonly candidates: readonly {
    readonly candidateId: string;
    readonly serviceBoundaryEvidenceSha256: string;
    readonly applicabilityMatrixSha256: string;
    readonly adverseReceiptSha256: string;
    readonly aggregateComplete: boolean;
    readonly provenAuthorityClasses: readonly ServiceBoundaryAdverseAuthorityClassV1[];
    readonly adverseEvidenceClass: StageCAdverseEvidenceClassV1 | null;
    readonly evidenceClassRequirementSatisfied: boolean;
    readonly provenPositiveCheckIds:
      readonly ServiceBoundaryAdverseCheckIdV1[];
  }[];
  readonly classifierExecuted: false;
  readonly productionEffect: false;
};

export type ServiceBoundaryAdversePopulationReceiptV1 = {
  readonly schemaVersion: "service-boundary-adverse-population-receipt-v1";
  readonly candidateInventorySha256: string;
  readonly requiredAdverseEvidenceClasses: readonly [
    "event_time_blacklist",
    "active_sanctions_or_restriction",
    "tracked_drainer_or_collector",
    "exact_restricted_service",
    "verify20_terminal",
    "exact_bound_nonterminal"
  ];
  readonly evidenceClassPositiveBindings: readonly {
    readonly evidenceClass: StageCAdverseEvidenceClassV1;
    readonly candidateId: string;
    readonly satisfaction: "all_of" | "any_of";
    readonly mappedPositiveCheckIds:
      readonly ServiceBoundaryAdverseCheckIdV1[];
    readonly provenPositiveCheckIds:
      readonly ServiceBoundaryAdverseCheckIdV1[];
    readonly provenPositiveRowSha256s: readonly string[];
  }[];
  readonly completeEvidenceClassCount: number;
  readonly intermediateCompleteReceiptCount: number;
  readonly typedIncompleteControlCount: number;
  readonly checkedSubjectExactAdverseRowsPresent: true;
  readonly subjectRoleSuppressionAccepted: false;
  readonly exactAdverseSuppressionAccepted: false;
  readonly complete: boolean;
  readonly classifierExecuted: false;
  readonly productionEffect: false;
};

export function parseServiceBoundaryAdverseCandidateInventoryV1(
  value: unknown,
  expectedSha256: string
): ServiceBoundaryAdverseCandidateInventoryV1;

export function parseServiceBoundaryAdversePopulationReceiptV1(
  value: unknown,
  expectedSha256: string
): ServiceBoundaryAdversePopulationReceiptV1;

export function validateServiceBoundaryAdversePopulationGraphV1(input: {
  readonly populationReceiptValue: unknown;
  readonly expectedPopulationReceiptSha256: string;
  readonly acceptedC2Root: ValidatedC2AdverseSourceRootV1;
  readonly resolveC2Artifact: (
    ref: ServiceBoundaryAdverseC2ArtifactRefV1
  ) => ResolvedServiceBoundaryAdverseC2ArtifactV1;
  readonly resolveArtifact: (
    ref: ServiceBoundaryAdverseGraphArtifactRefV1
  ) => ResolvedServiceBoundaryAdverseGraphArtifactV1;
}): {
  readonly receipt: ServiceBoundaryAdversePopulationReceiptV1;
  readonly candidateInventory: ServiceBoundaryAdverseCandidateInventoryV1;
};

export function reduceServiceBoundaryAdverseReceiptV1(input: {
  validatedApplicabilityMatrix:
    ValidatedServiceBoundaryAdverseApplicabilityMatrixV1;
  rows: readonly ServiceBoundaryAdverseCheckRowV1[];
}): { readonly sha256: string; readonly receipt: ServiceBoundaryAdverseReceiptV1 };
```

The twelve `*AuthorityLeafBodyV1` types above are the complete V1 body surface; implementation may not add a thirteenth shape, replace one with `unknown`/`Record<string, unknown>`, or leave a body to adapter discretion. `ServiceBoundaryAdverseCanonicalSourceV1` is not a hash-only escape hatch: its exact UTF-8 bytes must hash to `sha256`, must already equal `canonicalizeArtifactJson(JSON.parse(canonicalJsonUtf8))`, and must be reparsed only by the literal `parserVersion` declared in that body's type. The typed normalized outputs beside those bytes must be byte-identical to a fresh adapter result.

`SERVICE_BOUNDARY_ADVERSE_AUTHORITY_BODY_CODECS_V1` is the only body dispatch table and has exactly these source adapters:

- `event_time_blacklist` reparses rows with `parseBlacklistRows`, verifies source transactions through `verifyBlacklistTransaction`/`verifyBlacklistEventForRow`, sorts with `sortBlacklistTimelineEvents`, and derives the anchor state with `reconstructedBlacklistState` over events no later than the anchor.
- `event_time_sanctions_or_restriction` reruns `validateFrozenLabelDatasetV1` and `resolveFrozenLabelAtEventV1`, then `resolveSanctionedCryptoService` and `sanctionedCryptoServiceStateAt` against the exact frozen registry bytes.
- `exact_service_exchange_identity` reruns `validateFrozenLabelDatasetV1` and `resolveFrozenLabelAtEventV1`; only an address-bound `eligible` exact/verified record valid at the candidate event is positive.
- `exact_restricted_service` requires that same event-time-valid label resolution plus a registry entry whose fresh `sanctionedCryptoServiceStateAt` result is `active`, then reruns `decideAdversePathDispositionV1` on `terminalInput`.
- `tracked_drainer_or_collector` reparses `StageCTrackedAdverseEndpointRegistryV1` and `StageCTrackedAdverseEndpointAssertionV1`, requires `assertion.datasetSha256` to equal the canonical registry hash, requires exactly one byte-identical registry entry whose source hash and validity interval cover the candidate anchor, and reruns `decideAdversePathDispositionV1` with the matching tracked endpoint authority class.
- `provider_risk_corroboration`, `poisoning_role`, and `gasfree_role` revalidate the exact capture receipt/event binding with `validateServiceRoleExactEvidenceCaptureReceiptV1`; provider-risk and GasFree additionally revalidate `TronTransactionProviderEvidenceV1` finality/movement hashes, and GasFree reruns `classifyGasFreeSettlementDispositionV1` plus `gasFreeMovementForEdge`.
- `approval_transferfrom_proxy_lead` reruns `isAuthoritativeDirectApprovalDrainProfile`, `authoritativeApprovalDrainEvidenceBinding`, and `decideAdversePathDispositionV1`; a route-linked or missing direct binding is not a positive.
- `verify20_terminal` reruns `detectVerify20Fingerprint`, transaction-provider finality/movement validation, and `decideAdversePathDispositionV1`; all of full fingerprint, successful matching USDT movement, selector/event/finality binding, and terminal disposition are required.
- `verify_like_bound_lead` reruns `detectVerify20Fingerprint` and `decideAdversePathDispositionV1`; only a complete exact-bound input with a continuation address and non-empty bound events is positive, while a method name alone is unresolved.
- `cashflow_terminal_relevance` reruns `parseCashflowAuthorityEnvelopeV1` and `parseCashflowShadowArtifactV1`, requires the shadow's authority SHA and allocation/source-event IDs to bind the canonical tape, resolves and fully validates its same-candidate `terminalAuthorityLeafRef`, then reruns `decideAdversePathDispositionV1` on `SelectedAmountRelevanceInputV1`; the result must be `cashflow_relevance_only` and may name only the input's non-empty known intermediate event IDs.

Each codec rejects a source/output mismatch, extra key, wrong schema/parser version, non-canonical source bytes, changed hash, impossible complete/unresolved pair, or outcome inconsistent with its typed result. A complete negative requires `coverage.state:"complete"` and a fresh negative adapter result; a null positive field with unresolved coverage is never `not_found`. `parseServiceBoundaryAdverseAuthorityLeafV1()` selects the codec only from `ref.checkId`, requires codec-serializer byte equality and the declared leaf SHA, then cross-binds candidate, subject, event, snapshot, finality, and continuation fields. The generic union preserves the exact `checkId -> body -> ref` correlation at compile time and runtime.

Every mandatory check row contains at least one typed leaf ref of its own check family. Its outcome, negative/terminal completeness, event IDs, and continuation are exact projections of the resolved leaf values. A leaf may be shared only by byte-identical refs with the same check ID; a hash-only ref, wrong-family body, missing canonical body, detached candidate/subject/snapshot/anchor, unverified finality witness, or continuation absent from the leaf rejects before reduction.

Reducer precedence:

1. Proven exact terminal with complete authority wins `terminal_red`; endpoint history stays closed. Limitations and bound continuations remain recorded but cannot reopen it.
2. Without terminal, any matrix-mandatory unresolved/overflow yields `aggregateDisposition:"adverse_unresolved"` and `endpointAction:"continue_full"`; bound continuations remain additional preserved bindings and ordinary traversal is not suppressed.
3. Without terminal/unresolved, bound leads yield `continue_exact_path` over all sorted deduplicated bindings.
4. Cashflow relevance is standalone context and does not alter endpoint action.
5. Complete receipt without terminal/continuation yields `adverse_clear_for_boundary`, never safe/clean.

`expectedCheckIds` is receipt output derived from the exact matrix rows; it is never reducer input. The reducer requires exact matrix/registry cardinality: one row for every matrix row, no duplicate or unexpected check, and every row binds the matrix hash. A `mandatory` matrix row permits only `proven | not_found | unresolved`; a `not_applicable` matrix row requires exactly `outcome:"not_applicable"`, no evidence-derived authority, and no continuation. V1's frozen matrix makes all rows mandatory, so changing a row to `not_applicable` is a downgrade and rejects. `aggregateComplete` requires every derived expected check once and no mandatory unresolved row. `terminalAuthorityComplete` cannot mask incomplete aggregate. Missing row is never `not_found`; the latter requires `authoritativeNegativeComplete:true`.

The reducer also derives `adverseEvidenceClassRequirement` only from the matrix-bound `c2ControlStratum` and `c2AdverseEvidenceClass`. A non-adverse candidate gets `null`. An `adverse_authority_candidate` must have exactly one known C2 evidence class and is checked against `SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1`: an `all_of` requirement proves every mapped row, while `exact_bound_nonterminal` uses `any_of` and proves one or both mapped rows. A satisfying row must have `outcome:"proven"`, the registry's exact positive authority/disposition pair, complete terminal or continuation authority as applicable, and leaf bindings back to the same opaque C2 context. A positive row outside the frozen mapping cannot satisfy the class. Requirement satisfaction never turns missing/unresolved sibling checks into complete negatives and never changes reducer precedence.

The adverse candidate-inventory persists the exact canonical `c2SourceRoot` used during capture; its inventory SHA is redundant and must equal both the root ref and parsed C2 acceptance binding. The candidate-inventory and population builders derive every evidence-class field from the validated matrix/receipt graph. The population has exactly one binding per frozen evidence class in constant order. Each binding copies its mapped IDs and satisfaction rule from the C3 constant, records only matrix-bound proven row hashes, and must satisfy that rule; `completeEvidenceClassCount` is recomputed from those six bindings. In particular, `exact_bound_nonterminal` records one or both proven mapped IDs, never an arbitrary seventh alias. The population parser also derives its three checked-subject/adverse literals from the complete matrix-bound row graph: all exact rows must remain present for checked-subject controls, and neither a subject role nor a boundary result may suppress them. None of these values are free manifest assertions.

`validateServiceBoundaryAdversePopulationGraphV1()` receives an independently validated accepted C2 root plus exact-byte C2/C3 resolvers. For every C3 ref it recomputes the expected path with `serviceBoundaryAdverseArtifactRelativePathV1()`, requires the resolver to return that exact path with `symlinkFree:true`, requires raw UTF-8 equality with the owning serializer, and rehashes those exact bytes. It requires byte-for-byte equality between the external C2 root and the root embedded in the adverse candidate-inventory, requires a one-to-one candidate set with the accepted C2 inventory, rebuilds `ValidatedC2AdverseCandidateContextV1` for every candidate, and passes each context to the owning matrix validator before checking its rows and aggregate receipt. Only after all contexts and C3 edges revalidate does it recompute population bindings/counts. A self-consistent C3 graph pointing at a different structurally valid C2 inventory, an alternate filename/directory, or a path/hash alias is rejected. The C2 resolver may read only the acceptance ref, candidate-inventory ref, and transitive candidate refs enumerated by the accepted bounded root; verification performs no PostgreSQL lookup.

For a C2 `authorityState:"unresolved"` control, exact positive evidence is still probed and terminal precedence is preserved. A negative result cannot claim authoritative completeness across the physical gap: affected mandatory rows remain typed `unresolved:"partial_coverage"`, so a non-terminal incomplete control remains `continue_full`. Checked-subject and contract controls also keep all exact checks mandatory; their C2 non-admissibility is not converted into adverse innocence.

For a C2 inventory row with `controlStratum:"adverse_authority_candidate"`, the runner additionally requires its frozen C0/C2 `adverseAuthorityClass` and the frozen C3 requirement's positive row(s) to bind the same address/snapshot/anchor. Other mandatory rows may remain typed `partial_coverage`; the six-class population gate is satisfied only by the mapped exact positive authority under its explicit `all_of | any_of` rule, never by aggregate completeness, a label, a caller-selected class, or caller-selected check IDs. This lets the blind adverse challenges preserve real terminal/continuation facts without pretending their deliberately absent physical negative coverage is complete.

```ts
export type SelectiveTransactionEnrichmentOptions = {
  readonly signal?: AbortSignal;
  readonly onCandidateResolved?: (
    input: { completed: number; total: number }
  ) => Promise<void> | void;
  readonly onFullRequestOverflow?: (input: {
    candidateId: string;
    txHash: string;
    triggerCodes: readonly FullTransactionInfoTrigger[];
  }) => Promise<void> | void;
};
```

The callback fires only when a new full request hits the existing five-slot intermediate ceiling. It does not alter decisions, metrics, cache identity, scheduler behavior, or returned V1 bytes when omitted.

### Task 1: Freeze registry-derived applicability and strict parsers

**Files:** Create `src/forensics/serviceBoundaryAdverseProbe.ts`; create `tests/forensics/serviceBoundaryAdverseProbe.test.ts`.

- [ ] Write failing tests for every allowed triple, context/terminal separation, unknown triple, extra key, malformed hash, duplicate event ID, and forbidden context-to-red promotion. Freeze the exact producer-owned artifact layout, including `authorityLeafRoot:"authority-leaves"` and `kind:"authority_leaf"`, and test each fixed/root-plus-SHA path plus rejection of malformed SHA or alternate aliases. Instantiate all twelve typed `checkId -> authority body -> authority leaf ref` variants; reject a wrong-family body/ref, `unknown` body, non-canonical body, missing body, hash-only substitute, detached candidate/subject/snapshot/anchor, finality mismatch, and continuation mismatch. Freeze all six evidence-class requirements and prove the five single-row `all_of` mappings plus the exact two-ID `any_of` mapping for `exact_bound_nonterminal`. Add source-root/context/matrix fixtures proving exact registry cardinality/order and deterministic derivation from an owning-parser-validated C2 acceptance/inventory/candidate/evidence graph. Reject a detached but structurally valid inventory, acceptance-to-inventory hash mismatch, non-canonical/raw-hash mismatch, out-of-root or symlink path, inventory-hash mismatch, detached/duplicate candidate, detached/duplicate evidence ref, identity/snapshot/anchor/authority mismatch, subset, duplicate, extra, reordered, forged-evidence, hash-tampered, and mandatory-to-not-applicable downgrade inputs.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts -t "frozen adverse registry"`; expected FAIL because the module is absent.
- [ ] Implement the explicit frozen row registry, evidence-class requirement map, all twelve concrete authority-body types/codecs and the exhaustive `SERVICE_BOUNDARY_ADVERSE_AUTHORITY_BODY_CODECS_V1` table exactly as declared above, their typed ref/value union, paired `parseServiceBoundaryAdverseAuthorityLeafV1()` / `serializeServiceBoundaryAdverseAuthorityLeafV1()`, opaque `validateC2AdverseSourceRootV1()`, `validateC2AdverseCandidateContextV1()`, `buildServiceBoundaryAdverseApplicabilityMatrixV1()`, `validateServiceBoundaryAdverseApplicabilityMatrixV1()`, and `validateServiceBoundaryAdverseCheckRowV1(value)`. The compile-time fixture must instantiate every body and assert `keyof typeof SERVICE_BOUNDARY_ADVERSE_AUTHORITY_BODY_CODECS_V1` equals `ServiceBoundaryAdverseCheckIdV1`; no fallback/default codec or second dispatch switch is allowed. Invoke the C2 and exact per-family adapters listed above on exact canonical bytes, cross-bind the accepted physical-acceptance root to its candidate inventory and complete embedded upstream authority graph, then select the candidate and resolve/revalidate every bounded C0a/request/raw-page/order/role/historical/control/adverse plus inventory/EOA/evidence/capture-receipt ref. Return one branded `{ inventorySha256, candidateRef, evidenceSha256, evidence }` context. Derive every matrix binding from that context, emit all registry keys exactly once, validate exact keys/sorted unique IDs, and never derive applicability, evidence class, or authority from caller prose/outcome.
- [ ] Re-run the command; expected PASS.
- [ ] Stage the two Task 1 files, then commit `feat: freeze Stage C adverse authority registry`.

### Task 2: Enforce four-way outcomes and authoritative negatives

**Files:** Modify the two Task 1 files.

- [ ] Add failing tests for proven, complete not-found, timeout, overflow, missing binding, unsupported authority, partial coverage, absent row, and contradictory fields. Every outcome, including complete `not_found` and typed `unresolved`, must resolve at least one exact same-family authority leaf carrying its owning coverage/result body; a hash without that body rejects. Prove matrix-mandatory rows reject `not_applicable`; a parser fixture for a future registry-declared not-applicable row must require exactly `outcome:"not_applicable"` with a typed applicability-authority leaf but no evidence-derived positive authority/continuation.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts -t "validates adverse outcomes"`; expected FAIL before outcome validation exists.
- [ ] Require complete negative only for `not_found`, a typed reason for unresolved, registry-permitted binding fields, and full event/finality/subject binding before terminal authority.
- [ ] Re-run the command; expected PASS.
- [ ] Stage the two Task 1 files, then commit `feat: validate Stage C adverse probe outcomes`.

### Task 3: Implement matrix-bound aggregate reducer precedence

**Files:** Modify the two Task 1 files.

- [ ] Add failing fixtures for terminal+overflow, terminal+continuation, unresolved+continuation, duplicate bindings, relevance-only, complete clear, missing mandatory row, and incomplete terminal binding; reorder rows and assert identical hash. Add subset/duplicate/unexpected check, detached/wrong matrix hash, forged matrix, empty/subset caller-supplied expected list, and applicability downgrade tests. For every evidence class, prove only its frozen positive row(s) can satisfy it; for `exact_bound_nonterminal`, prove either mapped row and both mapped rows satisfy `any_of`, while neither, an arbitrary exact-bound triple, a missing sibling row, or `not_applicable` fails the appropriate contract.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts -t "reduces adverse rows"`; expected FAIL before the reducer exists.
- [ ] Accept only a validated applicability matrix, derive expected IDs and the candidate evidence-class requirement from its exact frozen rows/context, require every check row to bind its hash, reject duplicate/missing/unexpected rows, compute requirement satisfaction/counts, dedupe continuation/relevance IDs, then apply the five precedence rules exactly once. There is no `expectedCheckIds`, `mandatory`, evidence-class, or positive-check-map caller parameter. Do not import classifier/scoring code.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts tests/forensics/adversePathDisposition.test.ts`; expected PASS.
- [ ] Stage the two Task 1 files, then commit `feat: reduce Stage C adverse preservation receipts`.

### Task 4: Expose five-trigger overflow without changing V1 bytes

**Files:** Modify `src/forensics/selectiveTransactionEnrichment.ts`; modify `tests/forensics/selectiveTransactionEnrichment.test.ts`.

- [ ] Add failing tests: seven hard intermediate candidates produce five new full requests/two ordered overflow events; seven cached full rows produce zero overflow; subject produces seven requests; no-callback result keys equal the existing V1 fixture.
- [ ] Run `npm test -- tests/forensics/selectiveTransactionEnrichment.test.ts -t "full request overflow"`; expected FAIL because the callback is absent.
- [ ] Export named options, pass it to resolution, and call `onFullRequestOverflow` only for `ProviderResolution.kind === "capped"`; preserve hard-first/hash order and `fullSlots >= 5`. Add no retry/budget.
- [ ] Run `npm test -- tests/forensics/selectiveTransactionEnrichment.test.ts`; expected PASS with unchanged V1 shapes.
- [ ] Stage `src/forensics/selectiveTransactionEnrichment.ts tests/forensics/selectiveTransactionEnrichment.test.ts`, then commit `feat: observe bounded Stage C enrichment overflow`.

### Task 5: Adapt existing exact authority modules

**Files:** Modify the two Task 1 files.

- [ ] Add failing adapter tests for blacklist timeline, sanctions, service/restricted-service identity, approval/transferFrom binding, complete Verify20 plus successful matching movement, GasFree, poisoning/provider risk, and overflow; method-only/incomplete binding stays unresolved. For a C2 incomplete control or adverse-authority basis, exact positives still survive, while any otherwise-negative check whose authority crosses the proven physical gap becomes typed `partial_coverage` rather than `not_found`. Prove each adverse basis can populate only its exact frozen C0/C2 class and mapped C3 row.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts -t "adapts exact authority"`; expected FAIL because `runServiceBoundaryAdverseProbeV1()` is absent.
- [ ] Define narrow `ServiceBoundaryAdverseProbeDependenciesV1` returning validated artifacts. Start from `ValidatedC2AdverseCandidateContextV1` and its derived matrix; canonicalize and persist each exact typed authority leaf body rather than retaining only its hash, convert overflow to an unresolved leaf, and pass terminal/lead inputs through `decideAdversePathDispositionV1`. Every emitted row binds `applicabilityMatrixSha256` and non-empty same-check `authorityLeafRefs`; the runner derives outcome/event/finality/continuation fields from those values and derives the evidence class/positive-row requirement from `c2Context.candidateRef`. Flat labels/method names never grant authority.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/verify20Fingerprint.test.ts tests/forensics/gasFreeSettlement.test.ts tests/forensics/sanctionedServiceRegistry.test.ts tests/tron/usdtBlacklistTimeline.test.ts`; expected all PASS.
- [ ] Stage the two Task 1 files, then commit `feat: probe Stage C exact adverse authority`.

### Task 6: Persist matrices, rows, and aggregate receipts

**Files:** Create `scripts/captureServiceBoundaryAdverse.ts`; create `tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts`; create from reviewed inputs `docs/audit/2026-07-stage-c/inputs/service-boundary-adverse-population-v1.json`.

- [ ] Write failing strict-args/PostgreSQL tests for the accepted C2 physical-acceptance root, persisted bounded C2 source root, derived validated candidate contexts, authority-leaf/applicability-matrix/row/aggregate/candidate-inventory/population-receipt insert, restart idempotence, conflict, missing row rejection, forbidden classifier fields, and zero attempt/final-hash references. Prove capture writes only the two fixed files and four exact content-addressed directories from `SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1`; rename/move one valid leaf/matrix/row/receipt, add an alias/unknown/orphan file, or return a mismatched resolver path and assert rejection even when hashes remain valid. Delete an authority leaf, replace it by its hash, change its check family/candidate/subject/event/snapshot/finality/continuation, or substitute a separately valid detached leaf and prove offline rejection. Prove the CLI derives the inventory SHA and every candidate evidence class from that revalidated C2 graph. With PostgreSQL disconnected, prove `verify` passes against the committed C2 files, then substitute a separately well-formed inventory/acceptance pair or change only the embedded C2 root and prove rejection as `detached_c2_physical_acceptance_root`. Also reject missing/transitive/out-of-root/symlink C2 files. A capture input containing `c2InventorySha256`, `adverseEvidenceClass`, `mandatory`, `expectedCheckIds`, a positive-check map/list, an applicability matrix, authority-leaf hash/body, or a per-row applicability override rejects before any write.
- [ ] Run `npm test -- tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts`; expected FAIL because the CLI is absent; abort if skipped.
- [ ] Export `parseServiceBoundaryAdverseCaptureArgs()` and `runServiceBoundaryAdverseCapture()`. Support only `capture-population --input <canonical-json> --output <new-directory> --confirm` and `verify --input <canonical-json> --c2-acceptance <canonical-json> --c2-population-root <directory>`. The capture input binds only the accepted C2 physical-acceptance artifact ref plus its population-root locator; resolve exact canonical bytes, derive the candidate-inventory ref from the parsed acceptance, validate `ValidatedC2AdverseSourceRootV1`, and create every `ValidatedC2AdverseCandidateContextV1` before probing. Persist that exact bounded root in the adverse candidate-inventory. Derive the evidence-class requirement and matrix internally, then persist `service_boundary_adverse_authority_leaf`, `service_boundary_adverse_applicability_matrix`, `service_boundary_adverse_check`, `service_boundary_adverse_receipt`, `service_boundary_adverse_candidate_inventory`, and `service_boundary_adverse_population_receipt`, schema `1`, through `insertUnifiedArtifact`; publish their canonical aliases only at paths returned by `serviceBoundaryAdverseArtifactRelativePathV1()` plus the fixed population receipt. Leaves must be published before their referencing rows. `verify --input` requires that fixed receipt filename, derives the root from it, builds the same exact layout resolver without directory-choice heuristics, and rejects any extra/missing path. Output canonical counts/actions/hashes only. The input contains no inventory hash, candidate evidence class, classifier output, matrix, authority leaf/ref, positive-check map/list, expected-ID list, or applicability decision.
- [ ] Export the side-effect-free owning parsers `parseServiceBoundaryAdverseCandidateInventoryV1(value, expectedSha256)` and `parseServiceBoundaryAdversePopulationReceiptV1(value, expectedSha256)` plus paired `serializeServiceBoundaryAdverseCandidateInventoryV1` and `serializeServiceBoundaryAdversePopulationReceiptV1` from `serviceBoundaryAdverseProbe.ts`. Serializers use `canonicalizeArtifactJson` with no added LF; parsers reject extra keys, rehash exact canonical bytes, and validate sorted/unique declared bindings without importing the CLI. `verify` independently builds `ValidatedC2AdverseSourceRootV1` from `--c2-acceptance` plus `--c2-population-root`, exact-compares it with the embedded root, and passes it with the exact-layout filesystem resolver to `validateServiceBoundaryAdversePopulationGraphV1`. That verifier requires each resolved path/raw byte sequence to match the producer-owned layout/writer, rebuilds every branded context and matrix, resolves every row's typed leaf refs, invokes `parseServiceBoundaryAdverseAuthorityLeafV1()` and its check-specific owning parser/serializer on every canonical leaf body, rehashes it, and cross-binds candidate/subject/event/snapshot/finality/continuation before recomputing row and evidence-class satisfaction. It rejects an alternate layout, missing/detached/hash-only/wrong-family leaf, detached root/inventory, copied class, changed mapped IDs/rule, non-positive satisfying row, wrong leaf/row hash, duplicate/missing class, or count mismatch. The capture verifier and later C4/C6 resolvers import the C3 layout constant/function, owning writers/parsers, and graph verifier rather than maintaining another mapping. This path reads only committed canonical files and passes after the disposable PostgreSQL database is gone.
- [ ] Run `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts tests/forensics/selectiveTransactionEnrichment.test.ts tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts`; expected PASS, PostgreSQL executed `>0`, skipped `0`.
- [ ] Stage the Task 6 implementation and tests, then commit `feat: persist Stage C adverse preservation receipts`.

### Task 7: Record a real result and verify

**Files:** Create the reviewed input and complete `docs/audit/2026-07-stage-c/c3/` output graph; modify knowledge `02`, `04`, `05`, `06`, `09`, `10`, and `14`.

- [ ] Run C3 against the accepted real C2 candidate inventory; record exact command, Git/C2 hashes, derived applicability-matrix hashes, leaf/row/receipt hashes, logical/physical/cache counts, overflow, completeness, action, continuations, and limitations.

```powershell
node --import tsx scripts/captureServiceBoundaryAdverse.ts capture-population --input docs/audit/2026-07-stage-c/inputs/service-boundary-adverse-population-v1.json --output docs/audit/2026-07-stage-c/c3 --confirm
node --import tsx scripts/captureServiceBoundaryAdverse.ts verify --input docs/audit/2026-07-stage-c/c3/adverse-population-receipt-v1.json --c2-acceptance docs/audit/2026-07-stage-c/c2/physical-eoa-acceptance-v1.json --c2-population-root docs/audit/2026-07-stage-c/c2/physical-population-v1
```

Expected: the capture creates fixed `adverse-candidate-inventory-v1.json` and `adverse-population-receipt-v1.json`, plus exactly one `applicability-matrices/<sha256>.json`, `authority-leaves/<sha256>.json`, `check-rows/<sha256>.json`, and `adverse-receipts/<sha256>.json` alias for every referenced artifact, with no other path. The candidate inventory binds the exact accepted C2 source root. The offline verify command performs zero database reads, exact-compares its independently validated C2 command root with the embedded root, rebuilds every branded context, parses/rehashes every exact typed authority leaf, and rejects a detached structurally valid inventory/leaf, a hash-only leaf, or alternate C3 layout. It exits `0` only when every matrix-derived expected row is present, every row binds the correct validated C2 context/matrix and exact same-family leaf bodies, every unresolved row has typed coverage authority, every complete intermediate candidate has a complete adverse receipt, and all six C3-owned evidence-class requirements have one exact population binding. The `exact_bound_nonterminal` binding must prove one or both of its two mapped rows under `any_of`; no other row can substitute. The three deliberately incomplete physical controls remain explicit `continue_full` controls unless exact terminal evidence correctly wins precedence. It exits `2` for an honest authority/coverage gap and `1` without acceptance on corrupt input.
- [ ] Accept C3 only after the database-disconnected verify command reproduces the exact external/embedded C2 root, every branded context, every typed authority leaf body, and the full C3 graph, plus the stratum-aware and frozen evidence-class requirement rules above. Matrix-mandatory rows may be typed unresolved for the three deliberately incomplete controls, but never absent, hash-only, detached, or downgraded; complete intermediate candidates require aggregate-complete adverse authority. Each of the six adverse candidates must satisfy the C3-owned positive-row requirement derived from its validated C2 context. A terminal may coexist with limitations but cannot make aggregate completeness true, and unresolved non-terminal remains `continue_full`.
- [ ] Update knowledge with exact coverage/blockers and state standalone/score-neutral/no traversal suppression/no Stage D.
- [ ] Run focused gate: `npm test -- tests/forensics/serviceBoundaryAdverseProbe.test.ts tests/forensics/adversePathDisposition.test.ts tests/forensics/selectiveTransactionEnrichment.test.ts tests/forensics/directHardEvidence.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/forensics/verify20Fingerprint.test.ts tests/forensics/gasFreeSettlement.test.ts tests/forensics/sanctionedServiceRegistry.test.ts tests/tron/usdtBlacklistTimeline.test.ts tests/unified-check/serviceBoundaryAdverseProbe.postgres.test.ts`; expected all PASS and zero PostgreSQL skips.
- [ ] Run `npm run typecheck`, `npm test`, and `git diff --check`; expected exit `0`/no new failures.
- [ ] Stage the reviewed input, complete write-once C3 audit graph (matrices, authority leaves, rows, aggregate receipts, candidate inventory, and population receipt), and knowledge truth, then commit:

```powershell
git add docs/audit/2026-07-stage-c/inputs/service-boundary-adverse-population-v1.json docs/audit/2026-07-stage-c/c3 docs/knowledge/02-check-modes.md docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/05-where-is-money-and-incoming.md docs/knowledge/06-deepcheck.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/14-current-roadmap.md
git commit -m "docs: record Stage C adverse preservation result"
```

## Hard aborts

- Abort if C2 authority is unaccepted; the externally validated C2 acceptance/population root is absent or differs byte-for-byte from the root embedded in C3; a C2 path escapes the bounded root or is a symlink; a detached structurally valid inventory is accepted; the accepted C2 inventory, selected candidate ref, and evidence do not form one rehashed opaque context; any matrix identity/hash/class comes from a separate caller field; the matrix is not reproduced exactly from that context and the frozen registry; a caller can choose evidence class, positive mapped rows, expected/mandatory checks; an absent row becomes not-found; or partial evidence becomes authoritative negative.
- Abort if C3 capture/parser/verifier does not use `SERVICE_BOUNDARY_ADVERSE_ARTIFACT_LAYOUT_V1`; an artifact appears at an alternate path, has a second path alias, is missing/orphan/unknown, or a resolver returns a path/raw byte sequence different from the producer-owned mapping/writer. Abort if any row lacks a canonical same-check authority-leaf body; a leaf is hash-only, wrong-family, detached from candidate/subject/event/snapshot/anchor, lacks required finality/coverage/continuation authority, or is not reparsed, canonically reserialized, rehashed, and cross-bound by its owning exact codec.
- Abort if any adverse evidence class is not checked against `SERVICE_BOUNDARY_ADVERSE_EVIDENCE_CLASS_REQUIREMENTS_V1`; C4/C6 redeclares a competing map; `exact_bound_nonterminal` is satisfied by neither mapped row or by an unmapped alias; its unproven sibling is omitted/downgraded; or a population binding/count is accepted without re-resolving the positive row hashes.
- Abort if benign service/provider/poisoning/GasFree/method-only evidence becomes terminal red, or terminal red lacks exact subject/event/selector/finality/movement binding.
- Abort if terminal endpoint history reopens, unresolved/overflow suppresses ordinary traversal, or bound continuation IDs are lost.
- Abort if intermediate mode makes more than five new full requests, cached evidence consumes a slot, subject gains the cap, or the optional callback changes existing V1 bytes.
- Abort if `verify` needs PostgreSQL, omits the external accepted C2 root arguments, trusts only the C3-embedded inventory hash or row leaf hashes, skips any accepted C2 candidate/context/authority leaf, or does not rerun the owning C2 parsers/serializers, per-check authority codecs, and matrix validator.
- Abort if C3 artifacts reach attempts, production traversal, canonical facts, matrix-v4, score, report, Admin, Telegram, or delivery.

## Completion definition

C3 code is complete when accepted C2 source-root validation, opaque inventory/candidate/evidence context validation, producer-owned exact artifact layout including canonical typed authority leaves, registry-derived applicability, the frozen six-class positive-row requirements, strict outcomes, matrix-bound reducer precedence, overflow observation, exact adapters, standalone persistence, disposable PostgreSQL proof, database-disconnected full-graph verification, focused gate, typecheck, and full suite pass. Authority is accepted only after a reviewed real complete receipt preserves every red fact and continuation and the committed input/output graph reproduces the exact layout, external/embedded C2 root, every context, matrix, per-check authority-leaf body/finality/continuation binding, positive-row binding, and population hash; otherwise C3 remains implemented but blocked with production unchanged.
