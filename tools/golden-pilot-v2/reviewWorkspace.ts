import {
  lstat,
  mkdir,
  open,
  readFile
} from "node:fs/promises";
import { join } from "node:path";
import type {
  AttributionPolicy,
  GoldenDecision
} from "./contracts";
import type {
  AttributionResult,
  compareAttributionPolicies
} from "./attribution";
import {
  publishArtifactOnce,
  type PublishedArtifact
} from "./artifactStore";
import { canonicalSha256 } from "./canonicalJson";
import type {
  NeutralEvidenceBundleV2,
  NeutralExportResultV2
} from "./neutralExport";

export type AttributionComparison = ReturnType<
  typeof compareAttributionPolicies
>;

export type ReviewFindingV2 = {
  canonicalFactId: string;
  evidenceRefs: string[];
  subjectRole: string;
  counterpartyRole: string;
  directness: "direct" | "indirect" | "not_applicable";
  timing: "at_event" | "later" | "not_applicable";
  lane: "hard" | "pattern" | "context" | "neutral";
};

export type DraftReviewV2 = {
  version: "golden-review-v2";
  status: "draft";
  caseId: string;
  reviewerId: string;
  neutralBundleSha256: string;
  provenanceManifestSha256: string;
  validatorReceiptSha256: string;
  decision: GoldenDecision | null;
  reason: string;
  findings: ReviewFindingV2[];
  terminalBoundaries: string[];
  preferredAttributionPolicy: AttributionPolicy | null;
  attributionResults: AttributionComparison;
  dossierAggregates: Record<string, string>;
  scoreProperties: string[];
  reviewedAt: string | null;
};

export type SubmittedReviewV2 = Omit<
  DraftReviewV2,
  | "status"
  | "decision"
  | "preferredAttributionPolicy"
  | "reviewedAt"
> & {
  status: "submitted";
  decision: GoldenDecision;
  preferredAttributionPolicy: AttributionPolicy;
  reviewedAt: string;
};

export type LockedReviewV2 = SubmittedReviewV2 & {
  reviewSha256: string;
  artifact: PublishedArtifact;
};

export type PreparedReviewWorkspaceV2 = {
  version: "golden-review-workspace-v2";
  reviewerId: string;
  caseId: string;
  neutralBundleSha256: string;
  provenanceManifestSha256: string;
  validatorReceiptSha256: string;
};

const REVIEW_KEYS = [
  "version",
  "status",
  "caseId",
  "reviewerId",
  "neutralBundleSha256",
  "provenanceManifestSha256",
  "validatorReceiptSha256",
  "decision",
  "reason",
  "findings",
  "terminalBoundaries",
  "preferredAttributionPolicy",
  "attributionResults",
  "dossierAggregates",
  "scoreProperties",
  "reviewedAt"
] as const;

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("golden_review_invalid");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (key === "exactScore") {
      throw new TypeError("golden_exact_score_forbidden_before_adjudication");
    }
    if (!allowed.has(key)) {
      throw new TypeError(`golden_unknown_key:${key}`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new TypeError(`golden_missing_key:${key}`);
    }
  }
}

function string(value: unknown, error = "golden_review_invalid"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(error);
  }
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("golden_review_invalid");
  }
  const result = value.map((item) => string(item));
  if (new Set(result).size !== result.length) {
    throw new TypeError("golden_review_duplicate_value");
  }
  return result;
}

function sha256(value: unknown): string {
  const result = string(value);
  if (!/^[0-9a-f]{64}$/u.test(result)) {
    throw new TypeError("golden_review_invalid_hash");
  }
  return result;
}

function decimal(value: unknown): string {
  const result = string(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result)) {
    throw new TypeError("golden_invalid_decimal_string");
  }
  return result;
}

function timestamp(value: unknown): string {
  const result = string(value);
  const parsed = Date.parse(result);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== result
  ) {
    throw new TypeError("golden_invalid_iso_utc_timestamp");
  }
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  error = "golden_review_invalid"
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(error);
  }
  return value as T;
}

function parseAttributionResult(
  value: unknown,
  expectedPolicy: AttributionPolicy
): AttributionResult {
  const source = record(value);
  exactKeys(source, [
    "policy",
    "selectedAmountRaw",
    "allocatedAmountRaw",
    "residualAmountRaw",
    "allocations"
  ]);
  if (source.policy !== expectedPolicy || !Array.isArray(source.allocations)) {
    throw new TypeError("golden_review_invalid_attribution");
  }
  const allocations = source.allocations.map((value) => {
    const allocation = record(value);
    exactKeys(allocation, ["eventId", "allocatedRaw"]);
    return {
      eventId: string(allocation.eventId),
      allocatedRaw: decimal(allocation.allocatedRaw)
    };
  });
  if (new Set(allocations.map((item) => item.eventId)).size !== allocations.length) {
    throw new TypeError("golden_review_invalid_attribution");
  }
  const selectedAmountRaw = decimal(source.selectedAmountRaw);
  const allocatedAmountRaw = decimal(source.allocatedAmountRaw);
  const residualAmountRaw = decimal(source.residualAmountRaw);
  const allocationTotal = allocations.reduce(
    (sum, item) => sum + BigInt(item.allocatedRaw),
    0n
  );
  if (
    allocationTotal !== BigInt(allocatedAmountRaw) ||
    allocationTotal + BigInt(residualAmountRaw) !== BigInt(selectedAmountRaw)
  ) {
    throw new TypeError("golden_review_invalid_attribution");
  }
  return {
    policy: expectedPolicy,
    selectedAmountRaw,
    allocatedAmountRaw,
    residualAmountRaw,
    allocations
  };
}

function parseAttributionComparison(value: unknown): AttributionComparison {
  const source = record(value);
  exactKeys(source, ["fifo", "lifo", "proportional"]);
  return {
    fifo: parseAttributionResult(source.fifo, "fifo"),
    lifo: parseAttributionResult(source.lifo, "lifo"),
    proportional: parseAttributionResult(
      source.proportional,
      "proportional"
    )
  };
}

function parseFinding(value: unknown): ReviewFindingV2 {
  const source = record(value);
  exactKeys(source, [
    "canonicalFactId",
    "evidenceRefs",
    "subjectRole",
    "counterpartyRole",
    "directness",
    "timing",
    "lane"
  ]);
  return {
    canonicalFactId: string(source.canonicalFactId),
    evidenceRefs: strings(source.evidenceRefs),
    subjectRole: string(source.subjectRole),
    counterpartyRole: string(source.counterpartyRole),
    directness: oneOf(source.directness, [
      "direct",
      "indirect",
      "not_applicable"
    ] as const),
    timing: oneOf(source.timing, [
      "at_event",
      "later",
      "not_applicable"
    ] as const),
    lane: oneOf(source.lane, [
      "hard",
      "pattern",
      "context",
      "neutral"
    ] as const)
  };
}

function parseDossierAggregates(value: unknown): Record<string, string> {
  const source = record(value);
  const result: Record<string, string> = {};
  for (const key of Object.keys(source).sort()) {
    result[string(key)] = string(source[key]);
  }
  return result;
}

function parseSubmittedReview(value: unknown): SubmittedReviewV2 {
  const source = record(value);
  exactKeys(source, REVIEW_KEYS);
  if (source.version !== "golden-review-v2" || source.status !== "draft") {
    throw new TypeError("golden_review_invalid");
  }
  if (!Array.isArray(source.findings)) {
    throw new TypeError("golden_review_invalid");
  }
  return {
    version: "golden-review-v2",
    status: "submitted",
    caseId: string(source.caseId),
    reviewerId: string(source.reviewerId),
    neutralBundleSha256: sha256(source.neutralBundleSha256),
    provenanceManifestSha256: sha256(source.provenanceManifestSha256),
    validatorReceiptSha256: sha256(source.validatorReceiptSha256),
    decision: oneOf(source.decision, [
      "ACCEPTABLE",
      "REVIEW",
      "DECLINE"
    ] as const),
    reason: string(source.reason),
    findings: source.findings.map(parseFinding),
    terminalBoundaries: strings(source.terminalBoundaries),
    preferredAttributionPolicy: oneOf(source.preferredAttributionPolicy, [
      "fifo",
      "lifo",
      "proportional"
    ] as const),
    attributionResults: parseAttributionComparison(source.attributionResults),
    dossierAggregates: parseDossierAggregates(source.dossierAggregates),
    scoreProperties: strings(source.scoreProperties),
    reviewedAt: timestamp(source.reviewedAt)
  };
}

export function canonicalEventFactId(
  event: NeutralEvidenceBundleV2["events"][number]
): string {
  return [
    "tron",
    event.txHash,
    event.eventIndex,
    event.factType,
    event.from,
    event.to
  ].join(":");
}

function evidenceUniverse(bundle: NeutralEvidenceBundleV2): Set<string> {
  const result = new Set<string>();
  for (const event of bundle.events) {
    result.add(canonicalEventFactId(event));
  }
  for (const approval of bundle.approvals) {
    result.add(
      [
        "tron",
        approval.txHash,
        approval.eventIndex,
        "approval",
        approval.owner,
        approval.spender
      ].join(":")
    );
  }
  for (const fact of bundle.stateFacts) {
    result.add(
      [
        "tron-state",
        fact.factType,
        fact.subject,
        fact.object ?? "",
        fact.effectiveAt
      ].join(":")
    );
    for (const reference of fact.evidenceRefs) {
      result.add(reference);
    }
  }
  for (const label of bundle.labels) {
    result.add(
      [
        "tron-label",
        label.address,
        label.label,
        label.validFrom ?? ""
      ].join(":")
    );
    for (const reference of label.evidenceRefs) {
      result.add(reference);
    }
  }
  return result;
}

async function writeTextOnce(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function prepareReviewWorkspace(
  workspacePath: string,
  reviewerId: string,
  neutral: NeutralExportResultV2,
  attributionResults: AttributionComparison
): Promise<PreparedReviewWorkspaceV2> {
  const validatedReviewerId = string(
    reviewerId,
    "golden_invalid_reviewer_id"
  );
  if (
    neutral.manifest.contentSha256 !== canonicalSha256(neutral.bundle) ||
    neutral.manifest.validatorReceiptSha256 !==
      canonicalSha256(neutral.receipt) ||
    neutral.bundle.caseId !== neutral.manifest.caseId ||
    neutral.bundle.caseId !== neutral.receipt.caseId
  ) {
    throw new TypeError("golden_neutral_export_invalid");
  }
  const parsedAttribution = parseAttributionComparison(attributionResults);
  const neutralBundleSha256 = canonicalSha256(neutral.bundle);
  const provenanceManifestSha256 = canonicalSha256(neutral.manifest);
  const validatorReceiptSha256 = canonicalSha256(neutral.receipt);
  const review: DraftReviewV2 = {
    version: "golden-review-v2",
    status: "draft",
    caseId: neutral.bundle.caseId,
    reviewerId: validatedReviewerId,
    neutralBundleSha256,
    provenanceManifestSha256,
    validatorReceiptSha256,
    decision: null,
    reason: "",
    findings: [],
    terminalBoundaries: [],
    preferredAttributionPolicy: null,
    attributionResults: parsedAttribution,
    dossierAggregates: {},
    scoreProperties: [],
    reviewedAt: null
  };

  try {
    await mkdir(workspacePath);
  } catch (error) {
    if (errno(error) === "EEXIST") {
      throw new Error("golden_review_workspace_already_exists");
    }
    throw error;
  }
  await publishArtifactOnce(
    workspacePath,
    "neutral-bundle.json",
    neutral.bundle
  );
  await publishArtifactOnce(
    workspacePath,
    "provenance-manifest.json",
    neutral.manifest
  );
  await publishArtifactOnce(
    workspacePath,
    "validator-receipt.json",
    neutral.receipt
  );
  await publishArtifactOnce(workspacePath, "review.json", review);
  await writeTextOnce(
    join(workspacePath, "instructions.md"),
    [
      "# Golden Pilot V2 blind review",
      "",
      `Reviewer: ${validatedReviewerId}`,
      `Case: ${neutral.bundle.caseId}`,
      "",
      "Review only the frozen neutral evidence in this workspace.",
      "Complete every field in review.json. Do not add an exact score.",
      "Submit by running the lock-review command."
    ].join("\n")
  );

  return {
    version: "golden-review-workspace-v2",
    reviewerId: validatedReviewerId,
    caseId: neutral.bundle.caseId,
    neutralBundleSha256,
    provenanceManifestSha256,
    validatorReceiptSha256
  };
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errno(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function lockReview(
  workspacePath: string
): Promise<LockedReviewV2> {
  if (await exists(join(workspacePath, "submitted-review.json"))) {
    throw new Error("golden_review_already_locked");
  }
  const [bundleValue, manifestValue, receiptValue, reviewValue] =
    await Promise.all([
      json(join(workspacePath, "neutral-bundle.json")),
      json(join(workspacePath, "provenance-manifest.json")),
      json(join(workspacePath, "validator-receipt.json")),
      json(join(workspacePath, "review.json"))
    ]);
  const bundle = bundleValue as NeutralEvidenceBundleV2;
  const manifest = record(manifestValue);
  const reviewSource = record(reviewValue);
  const neutralBundleSha256 = canonicalSha256(bundleValue);
  const provenanceManifestSha256 = canonicalSha256(manifestValue);
  const validatorReceiptSha256 = canonicalSha256(receiptValue);
  if (
    reviewSource.neutralBundleSha256 !== neutralBundleSha256 ||
    reviewSource.provenanceManifestSha256 !== provenanceManifestSha256 ||
    reviewSource.validatorReceiptSha256 !== validatorReceiptSha256 ||
    manifest.contentSha256 !== neutralBundleSha256 ||
    manifest.validatorReceiptSha256 !== validatorReceiptSha256
  ) {
    throw new Error("golden_workspace_tampered");
  }

  const submitted = parseSubmittedReview(reviewValue);
  const knownEvidence = evidenceUniverse(bundle);
  for (const finding of submitted.findings) {
    for (const reference of [
      finding.canonicalFactId,
      ...finding.evidenceRefs
    ]) {
      if (!knownEvidence.has(reference)) {
        throw new TypeError(
          `golden_review_evidence_reference_missing:${reference}`
        );
      }
    }
  }
  const artifact = await publishArtifactOnce(
    workspacePath,
    "submitted-review.json",
    submitted
  ).catch((error: unknown) => {
    if ((error as Error).message === "golden_artifact_already_exists") {
      throw new Error("golden_review_already_locked");
    }
    throw error;
  });
  return {
    ...submitted,
    reviewSha256: artifact.sha256,
    artifact
  };
}

export function assertReviewsReadyForUnblind(
  reviews: LockedReviewV2[]
): [LockedReviewV2, LockedReviewV2] {
  if (reviews.length !== 2) {
    throw new TypeError("golden_two_reviews_required");
  }
  const [left, right] = reviews as [LockedReviewV2, LockedReviewV2];
  if (
    left.reviewerId === right.reviewerId ||
    left.reviewSha256 === right.reviewSha256
  ) {
    throw new TypeError("golden_distinct_reviews_required");
  }
  if (
    left.caseId !== right.caseId ||
    left.neutralBundleSha256 !== right.neutralBundleSha256
  ) {
    throw new TypeError("golden_review_neutral_hash_mismatch");
  }
  return [left, right];
}
