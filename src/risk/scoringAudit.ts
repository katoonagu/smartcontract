import type { ForensicCheckJob } from "../storage/repositories";
import {
  buildRiskClaritySummary,
  type RiskClarityCoverageStatus,
  type RiskClarityEvidenceClass,
  type RiskClarityRiskLevel
} from "./riskClarity";

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
  const coverageDebug = record(result["coverageDebug"]);
  const unified = record(result["unifiedRiskSummary"]);
  const activeAnchor = record(unified["activeAnchor"]);
  const finalScore = firstNumber(
    numberField(unified, "finalScore"),
    numberField(result, "riskScore"),
    numberField(result, "score"),
    numberField(result, "depositRiskScore"),
    numberField(progress, "riskScore"),
    numberField(progress, "score")
  );
  const productionDecision = normalizeDecision(
    result["decision"] ?? result["finalDecision"] ?? progress["decision"] ?? progress["finalDecision"]
  );
  const unifiedDecision = normalizeDecision(unified["finalDecision"]);
  const hardEvidenceObserved = booleanField(result, "hardEvidenceObserved")
    ?? booleanField(progress, "hardEvidenceObserved")
    ?? false;
  const missingChecks = [
    ...stringArray(result["missingChecks"]),
    ...stringArray(coverageDebug["missingChecks"]),
    ...stringArray(progress["missingChecks"])
  ];
  const coveragePartial = booleanField(coverageDebug, "partial")
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
    fetchedAddressCount: numberField(coverageDebug, "fetchedAddressCount"),
    hardEvidenceObserved,
    evidenceHints: [
      ...stringArray(result["reasons"]),
      ...stringArray(result["warnings"]),
      ...stringArray(result["evidenceHints"])
    ]
  });
  const auditDecision = auditDecisionFromSummary(productionDecision, clarity.coverageStatus, clarity.decisionStatus);
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
    policyVersion: clarity.policyVersion,
    missingChecks,
    cohorts: rowCohorts,
    limitations: clarity.limitations
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
  if (value === "INSUFFICIENT_COVERAGE") {
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
