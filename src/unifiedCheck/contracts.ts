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

export type UnifiedDeliveryStatus =
  | "PENDING"
  | "LEASED"
  | "RETRYABLE"
  | "SENT_CONFIRMED"
  | "DELIVERY_UNKNOWN"
  | "BLOCKED_ADMIN"
  | "CANCELLED";

type Hash = string;

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
