import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TronWeb } from "tronweb";
import type {
  AttributionPolicy,
  GoldenDecision
} from "./contracts";
import type {
  FinalAdjudicationV2,
  ResolvedAdjudicationFactV2
} from "./adjudication";
import {
  publishArtifactOnce,
  verifyPublishedArtifact,
  type PublishedArtifact
} from "./artifactStore";
import { canonicalJson, canonicalSha256 } from "./canonicalJson";

export type ComparatorInputV1 = {
  version: "unified-wallet-comparator-input-v1";
  caseId: string;
  analysisManifestSha256: string;
  evidenceBundleSha256: string;
  reportSha256: string;
  scoringPolicyVersion: "scoring-signal-matrix-v4";
  score: number;
  decision: GoldenDecision;
  anchor: {
    version: "score-anchor-v3";
    policyVersion: "scoring-signal-matrix-v4";
    subjectAddress: string;
    mode: "unified";
    score: number;
    decision: GoldenDecision;
    matrixRow: string;
    evidenceClass: string;
    proofLevel: string;
    authority: string;
    canonicalFactIds: string[];
    primaryFactIds: string[];
    preferredFactId: string;
    lockedGoldenManifestSha256: string;
  };
  dossierAggregates: Record<string, string>;
  presentations: Array<{
    locale: "ru" | "en";
    html: string;
    presentationSha256: string;
  }>;
};

export type ComparatorOutputV1 = {
  version: "unified-wallet-comparator-output-v1";
  caseId: string;
  passed: boolean;
  violations: Array<{
    property: string;
    expected: unknown;
    actual: unknown;
  }>;
};

export type ComparatorContractV1 = {
  version: "unified-wallet-comparator-contract-v1";
  inputVersion: "unified-wallet-comparator-input-v1";
  outputVersion: "unified-wallet-comparator-output-v1";
  scoringPolicyVersion: "scoring-signal-matrix-v4";
  anchorVersion: "score-anchor-v3";
  schemaAudit: {
    auditedAnchorVersion: "score-anchor-v2";
    scoreAnchorV2Compatible: false;
    reasons: string[];
  };
  implementationOwner: "unified-wallet-check-plan-b";
};

export type LockedGoldenManifestV2 = {
  version: "locked-golden-manifest-v2";
  protocolSha256: string;
  caseCatalogSha256: string;
  comparatorContractSha256: string;
  cases: Array<{
    caseId: string;
    neutralBundleSha256: string;
    provenanceManifestSha256: string;
    validatorReceiptSha256: string;
    reviewerHashes: [string, string];
    adjudicationSha256: string;
  }>;
  selectedAttributionPolicy: AttributionPolicy;
  scoringPolicyVersion: "scoring-signal-matrix-v4";
  lockedAt: string;
  lockedBy: string;
};

export type LockGoldenCaseInput = {
  caseId: string;
  neutralBundle: PublishedArtifact;
  provenanceManifest: PublishedArtifact;
  validatorReceipt: PublishedArtifact;
  reviewerArtifacts: [PublishedArtifact, PublishedArtifact];
  adjudication: PublishedArtifact;
};

export type LockGoldenManifestInput = {
  root: string;
  outputRelativePath: string;
  protocol: PublishedArtifact;
  caseCatalog: PublishedArtifact;
  comparatorContract: PublishedArtifact;
  cases: LockGoldenCaseInput[];
  lockedAt: string;
  lockedBy: string;
};

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("golden_invalid_contract");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  source: Record<string, unknown>,
  expected: readonly string[]
): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) {
      throw new TypeError(`golden_unknown_key:${key}`);
    }
  }
  for (const key of expected) {
    if (!(key in source)) {
      throw new TypeError(`golden_missing_key:${key}`);
    }
  }
}

function string(value: unknown, error = "golden_invalid_contract"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(error);
  }
  return value;
}

function hash(value: unknown): string {
  const result = string(value, "golden_invalid_sha256");
  if (!/^[0-9a-f]{64}$/u.test(result)) {
    throw new TypeError("golden_invalid_sha256");
  }
  return result;
}

function caseId(value: unknown): string {
  const result = string(value, "golden_invalid_case_id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) {
    throw new TypeError("golden_invalid_case_id");
  }
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  error = "golden_invalid_contract"
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(error);
  }
  return value as T;
}

function score(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new TypeError("golden_invalid_exact_score");
  }
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("golden_invalid_contract");
  }
  const result = value.map((item) => string(item));
  if (new Set(result).size !== result.length) {
    throw new TypeError("golden_duplicate_value");
  }
  return [...result].sort(lexical);
}

function stringRecord(value: unknown): Record<string, string> {
  const source = record(value);
  const result: Record<string, string> = {};
  for (const key of Object.keys(source).sort(lexical)) {
    result[string(key)] = string(source[key]);
  }
  return result;
}

export function parseComparatorContractV1(
  value: unknown
): ComparatorContractV1 {
  const source = record(value);
  exactKeys(source, [
    "version",
    "inputVersion",
    "outputVersion",
    "scoringPolicyVersion",
    "anchorVersion",
    "schemaAudit",
    "implementationOwner"
  ]);
  const audit = record(source.schemaAudit);
  exactKeys(audit, [
    "auditedAnchorVersion",
    "scoreAnchorV2Compatible",
    "reasons"
  ]);
  const reasons = strings(audit.reasons);
  if (reasons.length === 0 || audit.scoreAnchorV2Compatible !== false) {
    throw new TypeError("golden_invalid_anchor_schema_audit");
  }
  if (
    source.version !== "unified-wallet-comparator-contract-v1" ||
    source.inputVersion !== "unified-wallet-comparator-input-v1" ||
    source.outputVersion !== "unified-wallet-comparator-output-v1" ||
    source.scoringPolicyVersion !== "scoring-signal-matrix-v4" ||
    source.anchorVersion !== "score-anchor-v3" ||
    audit.auditedAnchorVersion !== "score-anchor-v2" ||
    source.implementationOwner !== "unified-wallet-check-plan-b"
  ) {
    throw new TypeError("golden_invalid_comparator_contract");
  }
  return {
    version: "unified-wallet-comparator-contract-v1",
    inputVersion: "unified-wallet-comparator-input-v1",
    outputVersion: "unified-wallet-comparator-output-v1",
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    anchorVersion: "score-anchor-v3",
    schemaAudit: {
      auditedAnchorVersion: "score-anchor-v2",
      scoreAnchorV2Compatible: false,
      reasons
    },
    implementationOwner: "unified-wallet-check-plan-b"
  };
}

export function parseComparatorInputV1(value: unknown): ComparatorInputV1 {
  const source = record(value);
  exactKeys(source, [
    "version",
    "caseId",
    "analysisManifestSha256",
    "evidenceBundleSha256",
    "reportSha256",
    "scoringPolicyVersion",
    "score",
    "decision",
    "anchor",
    "dossierAggregates",
    "presentations"
  ]);
  const parsedScore = score(source.score);
  const decision = oneOf(
    source.decision,
    ["ACCEPTABLE", "REVIEW", "DECLINE"] as const
  );
  const anchor = record(source.anchor);
  exactKeys(anchor, [
    "version",
    "policyVersion",
    "subjectAddress",
    "mode",
    "score",
    "decision",
    "matrixRow",
    "evidenceClass",
    "proofLevel",
    "authority",
    "canonicalFactIds",
    "primaryFactIds",
    "preferredFactId",
    "lockedGoldenManifestSha256"
  ]);
  const canonicalFactIds = strings(anchor.canonicalFactIds);
  const primaryFactIds = strings(anchor.primaryFactIds);
  const preferredFactId = string(anchor.preferredFactId);
  if (
    anchor.version !== "score-anchor-v3" ||
    anchor.policyVersion !== "scoring-signal-matrix-v4" ||
    anchor.mode !== "unified" ||
    anchor.score !== parsedScore ||
    anchor.decision !== decision ||
    !TronWeb.isAddress(anchor.subjectAddress as string) ||
    primaryFactIds.some((id) => !canonicalFactIds.includes(id)) ||
    !primaryFactIds.includes(preferredFactId)
  ) {
    throw new TypeError("golden_invalid_comparator_anchor");
  }
  if (!Array.isArray(source.presentations)) {
    throw new TypeError("golden_invalid_presentations");
  }
  const seenLocales = new Set<string>();
  const presentations = source.presentations.map((item) => {
    const presentation = record(item);
    exactKeys(presentation, [
      "locale",
      "html",
      "presentationSha256"
    ]);
    const locale = oneOf(presentation.locale, ["ru", "en"] as const);
    if (seenLocales.has(locale)) {
      throw new TypeError("golden_duplicate_presentation_locale");
    }
    seenLocales.add(locale);
    return {
      locale,
      html: string(presentation.html),
      presentationSha256: hash(presentation.presentationSha256)
    };
  });
  return {
    version: oneOf(
      source.version,
      ["unified-wallet-comparator-input-v1"] as const
    ),
    caseId: caseId(source.caseId),
    analysisManifestSha256: hash(source.analysisManifestSha256),
    evidenceBundleSha256: hash(source.evidenceBundleSha256),
    reportSha256: hash(source.reportSha256),
    scoringPolicyVersion: oneOf(
      source.scoringPolicyVersion,
      ["scoring-signal-matrix-v4"] as const
    ),
    score: parsedScore,
    decision,
    anchor: {
      version: "score-anchor-v3",
      policyVersion: "scoring-signal-matrix-v4",
      subjectAddress: anchor.subjectAddress as string,
      mode: "unified",
      score: parsedScore,
      decision,
      matrixRow: string(anchor.matrixRow),
      evidenceClass: string(anchor.evidenceClass),
      proofLevel: string(anchor.proofLevel),
      authority: string(anchor.authority),
      canonicalFactIds,
      primaryFactIds,
      preferredFactId,
      lockedGoldenManifestSha256: hash(
        anchor.lockedGoldenManifestSha256
      )
    },
    dossierAggregates: stringRecord(source.dossierAggregates),
    presentations: presentations.sort((left, right) =>
      lexical(left.locale, right.locale)
    )
  };
}

export function parseComparatorOutputV1(value: unknown): ComparatorOutputV1 {
  const source = record(value);
  exactKeys(source, ["version", "caseId", "passed", "violations"]);
  if (typeof source.passed !== "boolean" || !Array.isArray(source.violations)) {
    throw new TypeError("golden_invalid_comparator_output");
  }
  const violations = source.violations.map((item) => {
    const violation = record(item);
    exactKeys(violation, ["property", "expected", "actual"]);
    canonicalJson(violation.expected);
    canonicalJson(violation.actual);
    return {
      property: string(violation.property),
      expected: violation.expected,
      actual: violation.actual
    };
  });
  if (source.passed === (violations.length > 0)) {
    throw new TypeError("golden_invalid_comparator_output");
  }
  return {
    version: oneOf(
      source.version,
      ["unified-wallet-comparator-output-v1"] as const
    ),
    caseId: caseId(source.caseId),
    passed: source.passed,
    violations
  };
}

export function canonicalAdjudicatedFactInventory(
  facts: ResolvedAdjudicationFactV2[]
): ResolvedAdjudicationFactV2[] {
  const byId = new Map<string, ResolvedAdjudicationFactV2>();
  for (const fact of facts) {
    const existing = byId.get(fact.canonicalFactId);
    if (existing && canonicalJson(existing) !== canonicalJson(fact)) {
      throw new TypeError("golden_fact_multiple_scoring_lanes");
    }
    byId.set(fact.canonicalFactId, fact);
  }
  return [...byId.values()].sort((left, right) =>
    lexical(left.canonicalFactId, right.canonicalFactId)
  );
}

export function scoreExpectation(
  adjudication: Pick<
    FinalAdjudicationV2,
    "exactScore" | "expectedDecision"
  >,
  coverage: unknown
): { score: number; decision: GoldenDecision } {
  void coverage;
  return {
    score: adjudication.exactScore,
    decision: adjudication.expectedDecision
  };
}

export function presentationExpectation(
  reportSha256: string,
  locale: "ru" | "en",
  html: string
): {
  reportSha256: string;
  locale: "ru" | "en";
  html: string;
  presentationSha256: string;
} {
  const validatedReportSha256 = hash(reportSha256);
  const validatedHtml = string(html);
  return {
    reportSha256: validatedReportSha256,
    locale,
    html: validatedHtml,
    presentationSha256: canonicalSha256({
      version: "golden-presentation-expectation-v1",
      reportSha256: validatedReportSha256,
      locale,
      html: validatedHtml
    })
  };
}

async function verifiedJson(
  root: string,
  artifact: PublishedArtifact
): Promise<unknown> {
  try {
    await verifyPublishedArtifact(root, artifact);
    return JSON.parse(
      await readFile(
        join(root, ...artifact.relativePath.split("/")),
        "utf8"
      )
    ) as unknown;
  } catch {
    throw new Error("golden_referenced_artifact_invalid");
  }
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function assertNoPreAdjudicationScore(
  value: unknown,
  seen = new Set<object>()
): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    throw new TypeError("golden_cyclic_value");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        assertNoPreAdjudicationScore(item, seen);
      }
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (
        new Set([
          "score",
          "exactscore",
          "expectedscore",
          "systemscore",
          "finalscore"
        ]).has(normalizedKey(key))
      ) {
        throw new TypeError("golden_pre_adjudication_exact_score");
      }
      assertNoPreAdjudicationScore(nested, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function adjudicationFields(value: unknown): {
  caseId: string;
  neutralBundleSha256: string;
  reviewerHashes: [string, string];
  selectedAttributionPolicy: AttributionPolicy;
  resolvedFacts: ResolvedAdjudicationFactV2[];
} {
  const source = record(value);
  if (
    source.version !== "golden-adjudication-v2" ||
    !Array.isArray(source.reviewerHashes) ||
    source.reviewerHashes.length !== 2 ||
    !Array.isArray(source.resolvedFacts)
  ) {
    throw new TypeError("golden_invalid_final_adjudication");
  }
  const reviewerHashes = source.reviewerHashes.map(hash).sort(lexical) as [
    string,
    string
  ];
  const resolvedFacts = canonicalAdjudicatedFactInventory(
    source.resolvedFacts.map((item) => {
      const fact = record(item);
      return {
        canonicalFactId: string(fact.canonicalFactId),
        lane: oneOf(
          fact.lane,
          ["hard", "pattern", "context", "neutral"] as const
        ),
        role: string(fact.role),
        directness: oneOf(
          fact.directness,
          ["direct", "indirect", "not_applicable"] as const
        ),
        timing: oneOf(
          fact.timing,
          ["at_event", "later", "not_applicable"] as const
        )
      };
    })
  );
  score(source.exactScore);
  return {
    caseId: caseId(source.caseId),
    neutralBundleSha256: hash(source.neutralBundleSha256),
    reviewerHashes,
    selectedAttributionPolicy: oneOf(
      source.selectedAttributionPolicy,
      ["fifo", "lifo", "proportional"] as const
    ),
    resolvedFacts
  };
}

function timestamp(value: unknown): string {
  const result = string(value, "golden_invalid_lock_timestamp");
  const parsed = Date.parse(result);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== result
  ) {
    throw new TypeError("golden_invalid_lock_timestamp");
  }
  return result;
}

export async function buildLockedGoldenManifest(
  input: LockGoldenManifestInput
): Promise<LockedGoldenManifestV2> {
  if (input.cases.length === 0) {
    throw new TypeError("golden_no_cases_to_lock");
  }
  const seenCaseIds = new Set<string>();
  for (const item of input.cases) {
    if (seenCaseIds.has(item.caseId)) {
      throw new TypeError(`golden_duplicate_case_id:${item.caseId}`);
    }
    seenCaseIds.add(item.caseId);
  }

  await Promise.all([
    verifiedJson(input.root, input.protocol),
    verifiedJson(input.root, input.caseCatalog)
  ]);
  const comparatorContract = await verifiedJson(
    input.root,
    input.comparatorContract
  );
  parseComparatorContractV1(comparatorContract);

  const selectedPolicies = new Set<AttributionPolicy>();
  const cases = [];
  for (const item of [...input.cases].sort((left, right) =>
    lexical(left.caseId, right.caseId)
  )) {
    const [
      neutralBundle,
      provenanceManifest,
      validatorReceipt,
      reviewerA,
      reviewerB,
      adjudicationValue
    ] = await Promise.all([
      verifiedJson(input.root, item.neutralBundle),
      verifiedJson(input.root, item.provenanceManifest),
      verifiedJson(input.root, item.validatorReceipt),
      verifiedJson(input.root, item.reviewerArtifacts[0]),
      verifiedJson(input.root, item.reviewerArtifacts[1]),
      verifiedJson(input.root, item.adjudication)
    ]);
    for (const value of [
      neutralBundle,
      provenanceManifest,
      validatorReceipt,
      reviewerA,
      reviewerB
    ]) {
      assertNoPreAdjudicationScore(value);
    }
    const neutral = record(neutralBundle);
    const provenance = record(provenanceManifest);
    const receipt = record(validatorReceipt);
    const reviews = [record(reviewerA), record(reviewerB)];
    const adjudication = adjudicationFields(adjudicationValue);
    const reviewerHashes = item.reviewerArtifacts
      .map((artifact) => artifact.sha256)
      .sort(lexical) as [string, string];
    if (
      neutral.caseId !== item.caseId ||
      provenance.caseId !== item.caseId ||
      receipt.caseId !== item.caseId ||
      provenance.contentSha256 !== item.neutralBundle.sha256 ||
      provenance.validatorReceiptSha256 !== item.validatorReceipt.sha256 ||
      reviews.some(
        (review) =>
          review.version !== "golden-review-v2" ||
          review.status !== "submitted" ||
          review.caseId !== item.caseId ||
          review.neutralBundleSha256 !== item.neutralBundle.sha256 ||
          review.provenanceManifestSha256 !==
            item.provenanceManifest.sha256 ||
          review.validatorReceiptSha256 !== item.validatorReceipt.sha256
      ) ||
      new Set(reviews.map((review) => review.reviewerId)).size !== 2 ||
      adjudication.caseId !== item.caseId ||
      adjudication.neutralBundleSha256 !== item.neutralBundle.sha256 ||
      canonicalJson(adjudication.reviewerHashes) !==
        canonicalJson(reviewerHashes)
    ) {
      throw new TypeError("golden_mixed_neutral_or_review_hash");
    }
    selectedPolicies.add(adjudication.selectedAttributionPolicy);
    cases.push({
      caseId: item.caseId,
      neutralBundleSha256: item.neutralBundle.sha256,
      provenanceManifestSha256: item.provenanceManifest.sha256,
      validatorReceiptSha256: item.validatorReceipt.sha256,
      reviewerHashes,
      adjudicationSha256: item.adjudication.sha256
    });
  }
  if (selectedPolicies.size !== 1) {
    throw new TypeError(
      "golden_inconsistent_selected_attribution_policy"
    );
  }

  return {
    version: "locked-golden-manifest-v2",
    protocolSha256: input.protocol.sha256,
    caseCatalogSha256: input.caseCatalog.sha256,
    comparatorContractSha256: input.comparatorContract.sha256,
    cases,
    selectedAttributionPolicy: [...selectedPolicies][0]!,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    lockedAt: timestamp(input.lockedAt),
    lockedBy: string(input.lockedBy, "golden_invalid_locker")
  };
}

export async function lockGoldenManifest(
  input: LockGoldenManifestInput
): Promise<{
  manifest: LockedGoldenManifestV2;
  artifact: PublishedArtifact;
}> {
  const manifest = await buildLockedGoldenManifest(input);
  const artifact = await publishArtifactOnce(
    input.root,
    input.outputRelativePath,
    manifest
  );
  return { manifest, artifact };
}

export async function verifyLockedGoldenManifest(
  root: string,
  artifact: PublishedArtifact
): Promise<LockedGoldenManifestV2> {
  const value = await verifiedJson(root, artifact);
  const source = record(value);
  if (
    source.version !== "locked-golden-manifest-v2" ||
    !Array.isArray(source.cases)
  ) {
    throw new TypeError("golden_invalid_locked_manifest");
  }
  return value as LockedGoldenManifestV2;
}
