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

export const DEFAULT_UNIFIED_CANARY_DEADLINE_MINUTES = 120;

export function resolveUnifiedCanaryDeadlineMinutes(
  raw = process.env.UNIFIED_CANARY_DEADLINE_MINUTES
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_UNIFIED_CANARY_DEADLINE_MINUTES;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_440) {
    throw new TypeError("unified_canary_deadline_minutes_invalid");
  }
  return value;
}

// ponytail: one startup-only value keeps every SQL/runtime guard aligned;
// changing it requires restart, and 24 hours is the ceiling for exceptional
// isolated benchmarks rather than an unbounded abandoned-run lifetime.
export const UNIFIED_CANARY_DEADLINE_MINUTES =
  resolveUnifiedCanaryDeadlineMinutes();

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
export type UnifiedTraversalPolicyVersion =
  | "snapshot-closure-v1"
  | "snapshot-closure-v2";

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
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
  readonly runtimeCommit: string;
  readonly databaseSchemaVersion: number;
  readonly paginationCutoffBlockNumber: string;
  readonly paginationCutoffBlockHash: string;
  readonly branchArtifactHashes: Readonly<Record<string, Hash>>;
};

export function assertUnifiedTraversalPolicyManifest(
  manifest: AnalysisManifestV1
): void {
  if (
    manifest.traversalPolicyVersion !== "snapshot-closure-v1" &&
    manifest.traversalPolicyVersion !== "snapshot-closure-v2"
  ) {
    throw new Error("unified_traversal_policy_version_invalid");
  }
  if (
    manifest.traversalPolicyVersion === "snapshot-closure-v2" &&
    (
      manifest.labelCatalogVersion === undefined ||
      manifest.boundaryPredicateVersion === undefined
    )
  ) {
    throw new Error("unified_v2_boundary_versions_missing");
  }
  if (
    manifest.traversalPolicyVersion === "snapshot-closure-v2" &&
    (
      manifest.labelCatalogVersion !== UNIFIED_LABEL_CATALOG_VERSION ||
      manifest.boundaryPredicateVersion !==
        UNIFIED_BOUNDARY_PREDICATE_VERSION
    )
  ) {
    throw new Error("unified_v2_boundary_versions_mismatch");
  }
}

const ANALYSIS_MANIFEST_HASH = /^[0-9a-f]{64}$/u;
const ANALYSIS_MANIFEST_BLOCK = /^(?:0|[1-9][0-9]*)$/u;
const ANALYSIS_MANIFEST_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

export function parseAnalysisManifestV1(
  value: unknown,
  binding: {
    readonly runId: string;
    readonly subjectAddress: string;
    readonly snapshotHash: string;
  }
): AnalysisManifestV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("unified_analysis_manifest_invalid");
  }
  const row = value as Record<string, unknown>;
  const optional = new Set([
    "labelCatalogVersion",
    "boundaryPredicateVersion"
  ]);
  const required = [
    "version", "schemaVersion", "runId", "requestHash", "snapshotHash",
    "chain", "subjectAddress", "confirmedBlockNumber",
    "confirmedBlockHash", "confirmedBlockTimestamp", "labelDatasetSha256",
    "scoringPolicyVersion", "attributionPolicyVersion",
    "traversalPolicyVersion", "runtimeCommit", "databaseSchemaVersion",
    "paginationCutoffBlockNumber", "paginationCutoffBlockHash",
    "branchArtifactHashes"
  ] as const;
  const allowed = new Set<string>([...required, ...optional]);
  const branches = row.branchArtifactHashes;
  const branchRow = branches !== null && typeof branches === "object" &&
      !Array.isArray(branches)
    ? branches as Record<string, unknown>
    : null;
  const exactBranches = branchRow !== null &&
    Object.keys(branchRow).sort().join(",") === "deep,fast,where" &&
    Object.values(branchRow).every((hash) =>
      typeof hash === "string" && ANALYSIS_MANIFEST_HASH.test(hash)
    );
  const exactTimestamp = typeof row.confirmedBlockTimestamp === "string" &&
    Number.isFinite(Date.parse(row.confirmedBlockTimestamp)) &&
    new Date(Date.parse(row.confirmedBlockTimestamp)).toISOString() ===
      row.confirmedBlockTimestamp;
  const hashFields = [
    row.requestHash,
    row.snapshotHash,
    row.confirmedBlockHash,
    row.labelDatasetSha256,
    row.paginationCutoffBlockHash
  ];
  const textFields = [
    row.runId,
    row.scoringPolicyVersion,
    row.attributionPolicyVersion,
    row.runtimeCommit
  ];
  if (
    Object.keys(row).some((key) => !allowed.has(key)) ||
    required.some((key) => !(key in row)) ||
    row.version !== "analysis-manifest-v1" ||
    row.schemaVersion !== 1 ||
    row.chain !== "tron" ||
    typeof row.subjectAddress !== "string" ||
    !ANALYSIS_MANIFEST_ADDRESS.test(row.subjectAddress) ||
    hashFields.some((hash) =>
      typeof hash !== "string" || !ANALYSIS_MANIFEST_HASH.test(hash)
    ) ||
    typeof row.confirmedBlockNumber !== "string" ||
    !ANALYSIS_MANIFEST_BLOCK.test(row.confirmedBlockNumber) ||
    typeof row.paginationCutoffBlockNumber !== "string" ||
    !ANALYSIS_MANIFEST_BLOCK.test(row.paginationCutoffBlockNumber) ||
    row.confirmedBlockNumber !== row.paginationCutoffBlockNumber ||
    row.confirmedBlockHash !== row.paginationCutoffBlockHash ||
    !exactTimestamp ||
    textFields.some((text) =>
      typeof text !== "string" || text.length < 1 || text.length > 512
    ) ||
    !Number.isSafeInteger(row.databaseSchemaVersion) ||
    (row.databaseSchemaVersion as number) < 1 ||
    !exactBranches ||
    (
      row.labelCatalogVersion !== undefined &&
      row.labelCatalogVersion !== UNIFIED_LABEL_CATALOG_VERSION
    ) ||
    (
      row.boundaryPredicateVersion !== undefined &&
      row.boundaryPredicateVersion !== UNIFIED_BOUNDARY_PREDICATE_VERSION
    )
  ) {
    throw new TypeError("unified_analysis_manifest_invalid");
  }
  assertUnifiedTraversalPolicyManifest(row as AnalysisManifestV1);
  if (
    row.runId !== binding.runId ||
    row.subjectAddress !== binding.subjectAddress ||
    row.snapshotHash !== binding.snapshotHash
  ) {
    throw new Error("unified_analysis_manifest_binding_mismatch");
  }
  return row as AnalysisManifestV1;
}

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
