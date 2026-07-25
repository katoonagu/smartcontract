export type UnifiedRunStatus =
  | "RUNNING"
  | "WAITING_FOR_PROVIDER"
  | "BLOCKED_ADMIN"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED_TECHNICAL";

export type UnifiedBranchStatus =
  | "RUNNING"
  | "COMPLETED"
  | "NOT_APPLICABLE"
  | "WAITING_RETRY"
  | "BLOCKED_ADMIN"
  | "FAILED_TECHNICAL";

export type UnifiedRunPurpose =
  | "user_check"
  | "admin_diagnostic"
  | "release_canary"
  | "synthetic_test"
  | "maintenance";

export type UnifiedSideEffectPolicy = "authoritative" | "isolated";

// ponytail: this is a safety guard for abandoned isolated canaries, not a
// performance SLO. Keep every SQL/runtime deadline derived from this value.
export const UNIFIED_CANARY_DEADLINE_MINUTES = 120;

export type UnifiedWriteNamespace =
  | "run_scoped_artifact"
  | "authoritative_derived"
  | "delivery_intent";

export function assertUnifiedWriteAllowed(input: {
  readonly runPurpose: unknown;
  readonly sideEffectPolicy: unknown;
  readonly namespace: UnifiedWriteNamespace;
}): void {
  if (
    ![
      "user_check",
      "admin_diagnostic",
      "release_canary",
      "synthetic_test",
      "maintenance"
    ].includes(String(input.runPurpose)) ||
    !["authoritative", "isolated"].includes(String(input.sideEffectPolicy))
  ) {
    throw new Error("unified_write_policy_identity_invalid");
  }
  if (
    input.runPurpose === "release_canary" &&
    input.sideEffectPolicy !== "isolated"
  ) {
    throw new Error("unified_canary_must_be_isolated");
  }
  if (
    input.sideEffectPolicy === "isolated" &&
    input.namespace !== "run_scoped_artifact"
  ) {
    throw new Error(
      input.namespace === "delivery_intent"
        ? "unified_canary_delivery_intent_forbidden"
        : "unified_canary_authoritative_write_forbidden"
    );
  }
}

export type UnifiedDeliveryStatus =
  | "PENDING"
  | "LEASED"
  | "RETRYABLE"
  | "SENT_CONFIRMED"
  | "DELIVERY_UNKNOWN"
  | "BLOCKED_ADMIN"
  | "CANCELLED";

type Hash = string;

export const UNIFIED_LABEL_CATALOG_VERSION =
  "unified-label-catalog-v1" as const;
export const UNIFIED_BOUNDARY_PREDICATE_VERSION =
  "unified-boundary-predicates-v1" as const;

export type CheckRequestV1 = {
  readonly version: "check-request-v1";
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly subjectAddress: string;
  readonly purpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly requestedAt: string;
};

export type AnalysisManifestV1 = {
  readonly version: "analysis-manifest-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly requestHash: Hash;
  readonly snapshotHash: Hash;
  readonly chain: "tron";
  readonly subjectAddress: string;
  readonly confirmedBlockNumber: string;
  readonly confirmedBlockHash: string;
  readonly confirmedBlockTimestamp: string;
  readonly labelDatasetSha256: Hash;
  /** Optional only when reviving a manifest created before the P1 rollout. */
  readonly labelCatalogVersion?: typeof UNIFIED_LABEL_CATALOG_VERSION;
  /** Optional only when reviving a manifest created before the P1 rollout. */
  readonly boundaryPredicateVersion?:
    typeof UNIFIED_BOUNDARY_PREDICATE_VERSION;
  readonly scoringPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly traversalPolicyVersion: "snapshot-closure-v1";
  readonly runtimeCommit: string;
  readonly databaseSchemaVersion: number;
  readonly paginationCutoffBlockNumber: string;
  readonly paginationCutoffBlockHash: string;
  readonly branchArtifactHashes: Readonly<Record<string, Hash>>;
};

export type ChildAttemptArtifactV1 = {
  readonly version: "child-attempt-artifact-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly branchId: string;
  readonly attemptId: string;
  readonly previousAttemptHash: Hash | null;
  readonly inputHash: Hash;
  readonly outputHash: Hash | null;
  readonly status: UnifiedBranchStatus;
  readonly createdAt: string;
};

export type EvidenceBundleV1 = {
  readonly version: "evidence-bundle-v1";
  readonly schemaVersion: 1;
  readonly analysisManifestHash: Hash;
  readonly canonicalFactsHash: Hash;
  readonly canonicalFactIds: readonly string[];
  readonly acceptedChildAttemptHashes: Readonly<
    Record<"fast" | "deep" | "where", Hash>
  >;
  readonly branchOutputHashes: Readonly<
    Record<"fast" | "deep" | "where", Hash | null>
  >;
};

export type TraversalClosureCertificateV1 = {
  readonly version: "traversal-closure-certificate-v1";
  readonly schemaVersion: 1;
  readonly analysisManifestHash: Hash;
  readonly snapshotHash: Hash;
  readonly visitedStateHash: Hash;
  readonly frontierHash: Hash;
  readonly closed: true;
};

export type ScoringBundleV1 = {
  readonly version: "scoring-bundle-v1";
  readonly schemaVersion: 1;
  readonly evidenceBundleHash: Hash;
  readonly traversalClosureHash: Hash;
  readonly policyVersion: string;
  readonly scoreAnchorHash: Hash;
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
};

export type UnifiedWalletReportV1 = {
  readonly version: "unified-wallet-report-v1";
  readonly schemaVersion: 1;
  readonly analysisManifestHash: Hash;
  readonly evidenceBundleHash: Hash;
  readonly traversalClosureHash: Hash;
  readonly scoringBundleHash: Hash;
  readonly subjectAddress: string;
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  readonly factInventoryHash: Hash;
};

export type PresentationArtifactV1 = {
  readonly version: "presentation-artifact-v1";
  readonly schemaVersion: 1;
  readonly reportHash: Hash;
  readonly locale: string;
  readonly html: string;
  readonly htmlHash: Hash;
};

export type PresentationCompletenessReceiptV1 = {
  readonly version: "presentation-completeness-receipt-v1";
  readonly schemaVersion: 1;
  readonly presentationHash: Hash;
  readonly reportHash: Hash;
  readonly factInventoryHash: Hash;
  readonly omittedCanonicalFactIds: readonly string[];
};

export type DeliveryIntentV1 = {
  readonly version: "delivery-intent-v1";
  readonly schemaVersion: 1;
  readonly logicalRequestId: string;
  readonly presentationHash: Hash;
  readonly payloadHash: Hash;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
};

export type ManualUnifiedResendV1 = {
  readonly version: "manual-unified-resend-v1";
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly originalDeliveryId: string;
  readonly originalPresentationHash: Hash;
  readonly warningPresentationHash: Hash;
  readonly warningCode: "manual_resend_after_delivery_unknown";
};
