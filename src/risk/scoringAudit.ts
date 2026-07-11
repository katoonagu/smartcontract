import type { ForensicCheckJob } from "../storage/repositories";
import {
  buildIncomingSourceAttributionSummary,
  buildWhereSourceAttributionSummary,
  type IncomingSourceAttributionPathInput,
  type SourceAttributionSummary,
  type WhereSourceAttributionPathInput
} from "../forensics/sourceAttributionSummary";
import {
  buildRiskClaritySummary,
  type RiskClarityCoverageStatus,
  type RiskClarityEvidenceClass,
  type RiskClarityRiskLevel
} from "./riskClarity";
import { SCORING_SIGNAL_MATRIX_POLICY_VERSION } from "./scoringSignalMatrix";

export type ScoringAuditDecision =
  | "ACCEPTABLE"
  | "REVIEW"
  | "DECLINE"
  | "INSUFFICIENT_COVERAGE"
  | "MANUAL_REQUIRED";

export type ScoringAuditCohort =
  | "high_score_partial_coverage"
  | "low_score_incomplete_coverage"
  | "acceptable_limited_coverage"
  | "decline_without_hard_evidence"
  | "conflicting_layers"
  | "hard_evidence_cases"
  | "policy_floor_cases"
  | "dampener_cases";

export type ScoringAuditRow = {
  jobId: string;
  kind: ForensicCheckJob["kind"];
  subjectAddress: string;
  status: ForensicCheckJob["status"];
  finalScore: number | null;
  riskLevel: RiskClarityRiskLevel | null;
  productionDecision: ScoringAuditDecision;
  auditDecision: ScoringAuditDecision;
  coverageStatus: RiskClarityCoverageStatus;
  confidenceScore: number | null;
  evidenceClass: RiskClarityEvidenceClass;
  hardEvidenceObserved: boolean;
  activeAnchorCode: string | null;
  activeAnchorScore: number | null;
  dampener: number | null;
  policyVersion: string;
  missingChecks: string[];
  cohorts: ScoringAuditCohort[];
  limitations: string[];
  sourceAttribution: SourceAttributionSummary | null;
};

const cohorts: ScoringAuditCohort[] = [
  "high_score_partial_coverage",
  "low_score_incomplete_coverage",
  "acceptable_limited_coverage",
  "decline_without_hard_evidence",
  "conflicting_layers",
  "hard_evidence_cases",
  "policy_floor_cases",
  "dampener_cases"
];

export function buildScoringAuditRow(job: ForensicCheckJob): ScoringAuditRow {
  const result = record(job.resultJson);
  const progress = record(job.progressJson);
  const report = record(result["whereIsMoneyReport"]);
  const reportAssessment = record(report["assessment"]);
  const resultAssessment = record(result["assessment"]);
  const assessment = Object.keys(reportAssessment).length > 0 ? reportAssessment : resultAssessment;
  const coverage = firstRecord(report["coverage"], result["coverage"], result["coverageDebug"]);
  const unified = record(result["unifiedRiskSummary"]);
  const activeAnchor = record(unified["activeAnchor"]);
  const finalScore = firstNumber(
    numberField(unified, "finalScore"),
    numberField(report, "riskScore"),
    numberField(report, "score"),
    numberField(result, "riskScore"),
    numberField(result, "score"),
    numberField(result, "depositRiskScore"),
    numberField(progress, "riskScore"),
    numberField(progress, "score")
  );
  const productionDecision = normalizeDecision(
    report["userDecision"]
    ?? result["userDecision"]
    ?? report["decision"]
    ?? result["decision"]
    ?? result["finalDecision"]
    ?? progress["decision"]
    ?? progress["finalDecision"]
  );
  const matrixDecision = normalizeDecision(unified["matrixDecision"]);
  const winningRow = stringField(unified, "winningRow");
  const unifiedDecision = matrixDecision === "MANUAL_REQUIRED"
    ? normalizeDecision(unified["finalDecision"])
    : matrixDecision;
  const scorerDecision = unifiedDecision === "MANUAL_REQUIRED" ? productionDecision : unifiedDecision;
  const hardEvidenceObserved = booleanField(report, "hardEvidenceObserved")
    ?? booleanField(result, "hardEvidenceObserved")
    ?? booleanField(progress, "hardEvidenceObserved")
    ?? hardEvidenceFromProof(report, assessment)
    ?? hardEvidenceFromProof(result, assessment)
    ?? false;
  const missingChecks = [
    ...stringArray(report["missingChecks"]),
    ...stringArray(result["missingChecks"]),
    ...stringArray(coverage["missingChecks"]),
    ...stringArray(coverage["notes"]),
    ...stringArray(progress["missingChecks"])
  ];
  const coveragePartial = booleanField(coverage, "partial")
    ?? booleanField(report, "coveragePartial")
    ?? booleanField(result, "coveragePartial")
    ?? booleanField(progress, "coveragePartial")
    ?? job.status === "partial";
  const clarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: executionStatus(job.status),
    finalRiskScore: finalScore,
    explicitDecision: clarityDecision(productionDecision),
    missingChecks,
    coveragePartial,
    fetchedAddressCount: numberField(coverage, "fetchedAddressCount"),
    hardEvidenceObserved,
    evidenceHints: [
      ...stringArray(report["reasons"]),
      ...stringArray(report["decisionReasons"]),
      ...stringArray(assessment["reasons"]),
      ...stringArray(result["reasons"]),
      ...stringArray(result["warnings"]),
      ...stringArray(result["evidenceHints"])
    ]
  });
  const auditDecision = auditDecisionFromSummary(scorerDecision, clarity.coverageStatus, clarity.decisionStatus);
  const rowCohorts = auditCohorts({
    finalScore,
    productionDecision,
    auditDecision,
    coverageStatus: clarity.coverageStatus,
    evidenceClass: clarity.evidenceClass,
    hardEvidenceObserved: clarity.hardEvidenceObserved,
    productionLayerDecision: productionDecision,
    unifiedDecision,
    policyFloor: numberField(unified, "policyFloor"),
    dampener: numberField(unified, "dampener")
  });

  return {
    jobId: job.id,
    kind: job.kind,
    subjectAddress: job.subjectAddress,
    status: job.status,
    finalScore,
    riskLevel: clarity.riskLevel,
    productionDecision,
    auditDecision,
    coverageStatus: clarity.coverageStatus,
    confidenceScore: clarity.confidenceScore,
    evidenceClass: clarity.evidenceClass,
    hardEvidenceObserved: clarity.hardEvidenceObserved,
    activeAnchorCode: stringField(activeAnchor, "code"),
    activeAnchorScore: numberField(activeAnchor, "score"),
    dampener: numberField(unified, "dampener"),
    policyVersion: winningRow ? SCORING_SIGNAL_MATRIX_POLICY_VERSION : clarity.policyVersion,
    missingChecks,
    cohorts: rowCohorts,
    limitations: clarity.limitations,
    sourceAttribution: sourceAttributionForJob(job.kind, report, result)
  };
}

export function cohortCounts(rows: ScoringAuditRow[]): Record<ScoringAuditCohort, number> {
  const counts = Object.fromEntries(cohorts.map((cohort) => [cohort, 0])) as Record<ScoringAuditCohort, number>;
  for (const row of rows) {
    for (const cohort of row.cohorts) {
      counts[cohort] += 1;
    }
  }
  return counts;
}

function auditDecisionFromSummary(
  productionDecision: ScoringAuditDecision,
  coverageStatus: RiskClarityCoverageStatus,
  decisionStatus: ReturnType<typeof buildRiskClaritySummary>["decisionStatus"]
): ScoringAuditDecision {
  if (productionDecision === "INSUFFICIENT_COVERAGE") {
    return "INSUFFICIENT_COVERAGE";
  }
  if (productionDecision === "ACCEPTABLE" && coverageStatus !== "complete") {
    return "INSUFFICIENT_COVERAGE";
  }
  if (decisionStatus === "acceptable") return "ACCEPTABLE";
  if (decisionStatus === "review") return "REVIEW";
  if (decisionStatus === "decline") return "DECLINE";
  if (decisionStatus === "insufficient_coverage") return "INSUFFICIENT_COVERAGE";
  return "MANUAL_REQUIRED";
}

function auditCohorts(input: {
  finalScore: number | null;
  productionDecision: ScoringAuditDecision;
  auditDecision: ScoringAuditDecision;
  coverageStatus: RiskClarityCoverageStatus;
  evidenceClass: RiskClarityEvidenceClass;
  hardEvidenceObserved: boolean;
  productionLayerDecision: ScoringAuditDecision;
  unifiedDecision: ScoringAuditDecision;
  policyFloor: number | null;
  dampener: number | null;
}): ScoringAuditCohort[] {
  const result: ScoringAuditCohort[] = [];
  const incompleteCoverage = input.coverageStatus !== "complete";

  if (input.finalScore !== null && input.finalScore >= 60 && incompleteCoverage) {
    result.push("high_score_partial_coverage");
  }
  if (input.finalScore !== null && input.finalScore < 30 && incompleteCoverage) {
    result.push("low_score_incomplete_coverage");
  }
  if (input.productionDecision === "ACCEPTABLE" && incompleteCoverage) {
    result.push("acceptable_limited_coverage");
  }
  if (input.auditDecision === "DECLINE" && !input.hardEvidenceObserved && input.evidenceClass !== "hard") {
    result.push("decline_without_hard_evidence");
  }
  if (input.unifiedDecision !== "MANUAL_REQUIRED" && input.productionLayerDecision !== input.unifiedDecision) {
    result.push("conflicting_layers");
  }
  if (input.hardEvidenceObserved || input.evidenceClass === "hard") {
    result.push("hard_evidence_cases");
  }
  if ((input.policyFloor ?? 0) > 0) {
    result.push("policy_floor_cases");
  }
  if ((input.dampener ?? 0) > 0) {
    result.push("dampener_cases");
  }

  return result;
}

function executionStatus(status: ForensicCheckJob["status"]): "queued" | "running" | "completed" | "partial" | "failed" {
  if (status === "cancelled") {
    return "failed";
  }
  return status;
}

function normalizeDecision(value: unknown): ScoringAuditDecision {
  if (value === "ACCEPTABLE" || value === "REVIEW" || value === "DECLINE") {
    return value;
  }
  if (value === "INSUFFICIENT_COVERAGE" || value === "INSUFFICIENT_EVIDENCE" || value === "NO_FINAL_DECISION") {
    return "INSUFFICIENT_COVERAGE";
  }
  return "MANUAL_REQUIRED";
}

function clarityDecision(decision: ScoringAuditDecision): "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN" {
  if (decision === "ACCEPTABLE" || decision === "REVIEW" || decision === "DECLINE") {
    return decision;
  }
  return "UNKNOWN";
}

function firstNumber(...values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null) ?? null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const candidate = record(value);
    if (Object.keys(candidate).length > 0) {
      return candidate;
    }
  }
  return {};
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberField(value: Record<string, unknown>, field: string): number | null {
  const raw = value[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  const raw = value[field];
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

function booleanField(value: Record<string, unknown>, field: string): boolean | null {
  const raw = value[field];
  return typeof raw === "boolean" ? raw : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hardEvidenceFromProof(result: Record<string, unknown>, assessment: Record<string, unknown>): boolean | null {
  if (Array.isArray(result["hardBadEvidence"]) && result["hardBadEvidence"].length > 0) {
    return true;
  }
  if (Array.isArray(assessment["hardBadEvidence"]) && assessment["hardBadEvidence"].length > 0) {
    return true;
  }
  const proofLevel = stringField(result, "proofLevel")?.toLowerCase() ?? "";
  if (proofLevel === "") {
    return null;
  }
  return proofLevel.includes("exact") || proofLevel.includes("blacklist") || proofLevel.includes("hard");
}

function sourceAttributionForJob(
  kind: ForensicCheckJob["kind"],
  report: Record<string, unknown>,
  result: Record<string, unknown>
): SourceAttributionSummary | null {
  const paths = recordArray(firstArray(report["originPaths"], result["originPaths"]));
  if (kind === "where_is_money_check") {
    return buildWhereSourceAttributionSummary({ paths: paths.map(whereAttributionPath) });
  }
  if (kind === "incoming_deposit_check") {
    return buildIncomingSourceAttributionSummary({ paths: paths.map(incomingAttributionPath) });
  }
  return null;
}

function whereAttributionPath(path: Record<string, unknown>): WhereSourceAttributionPathInput {
  const steps = Array.isArray(path["steps"]) ? path["steps"] : [];
  return {
    sourceAddress: firstString(
      stringField(path, "sourceAddress"),
      stringField(path, "rootSourceAddress"),
      firstStringArrayItem(path["pathAddresses"])
    ) ?? "unknown",
    exposureSourceLabel: firstString(
      stringField(path, "exposureSourceLabel"),
      stringField(path, "sourceLabel"),
      stringField(path, "rootSourceType"),
      stringField(path, "sourceExposureKind"),
      stringField(path, "stoppedReason")
    ) ?? "unknown",
    sourceExposureKind: firstString(
      stringField(path, "sourceExposureKind"),
      stringField(path, "rootSourceType"),
      stringField(path, "stoppedReason")
    ) ?? "unknown",
    exposureSourceKey: stringField(path, "exposureSourceKey") ?? "unknown",
    rootSourceType: stringField(path, "rootSourceType") ?? "unknown",
    balanceShare: numberField(path, "balanceShare") ?? 0,
    effectiveExposureShare: firstNumber(
      numberField(path, "effectiveExposureShare"),
      numberField(path, "balanceShare"),
      numberField(path, "amountCoverageRatio")
    ) ?? 0,
    amountContinuity: firstNumber(
      numberField(path, "amountContinuity"),
      numberField(path, "amountPreservationRatio")
    ) ?? 0,
    hops: numberField(path, "hops") ?? numberField(path, "proximityHops") ?? steps.length,
    elapsedMs: numberField(path, "elapsedMs") ?? numberField(path, "timeSpanMs") ?? undefined,
    stoppedReason: stringField(path, "stoppedReason"),
    reasons: stringArray(path["reasons"])
  };
}

function incomingAttributionPath(path: Record<string, unknown>): IncomingSourceAttributionPathInput {
  const steps = Array.isArray(path["steps"]) ? path["steps"] : [];
  const sourcePolicy = stringField(path, "sourcePolicy") ?? stringField(path, "stoppedReason") ?? "unknown";
  return {
    sourceAddress: firstString(stringField(path, "sourceAddress"), firstStringArrayItem(path["pathAddresses"])) ?? "unknown",
    sourceLabel: firstString(stringField(path, "sourceLabel"), sourcePolicy, stringField(path, "stoppedReason")) ?? "unknown",
    sourcePolicy,
    amountCoverageRatio: numberField(path, "amountCoverageRatio") ?? numberField(path, "balanceShare") ?? 0,
    amountContinuity: incomingContinuity(path["amountContinuity"]),
    stoppedReason: stringField(path, "stoppedReason"),
    steps: numberField(path, "steps") ?? steps.length,
    reasons: stringArray(path["reasons"])
  };
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find((value): value is unknown[] => Array.isArray(value)) ?? [];
}

function recordArray(value: unknown[]): Array<Record<string, unknown>> {
  return value.map(record).filter((item) => Object.keys(item).length > 0);
}

function firstString(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function firstStringArrayItem(value: unknown): string | null {
  return stringArray(value)[0] ?? null;
}

function incomingContinuity(value: unknown): IncomingSourceAttributionPathInput["amountContinuity"] {
  if (value === "strong" || value === "medium" || value === "weak") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.75) return "strong";
    if (value >= 0.45) return "medium";
    if (value > 0) return "weak";
  }
  return null;
}
