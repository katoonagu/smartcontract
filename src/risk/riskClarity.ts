import type { ForensicCheckJobStatus, ForensicCheckJob } from "../storage/repositories";

export type RiskClarityCoverageStatus = "complete" | "partial" | "limited" | "insufficient";
export type RiskClarityDecisionStatus =
  | "acceptable"
  | "review"
  | "decline"
  | "insufficient_coverage"
  | "manual_required";
export type RiskClarityEvidenceClass = "hard" | "strong_linked" | "contextual" | "weak" | "none" | "unknown";
export type RiskClarityRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskClarityInput = {
  kind: ForensicCheckJob["kind"] | "approval_check";
  executionStatus: Extract<ForensicCheckJobStatus, "queued" | "running" | "completed" | "partial" | "failed">;
  finalRiskScore: number | null;
  explicitDecision?: "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN" | null;
  missingChecks?: string[];
  coveragePartial?: boolean;
  fetchedAddressCount?: number | null;
  hardEvidenceObserved?: boolean;
  evidenceHints?: string[];
};

export type RiskClaritySummary = {
  executionStatus: Exclude<RiskClarityInput["executionStatus"], "partial">;
  coverageStatus: RiskClarityCoverageStatus;
  decisionStatus: RiskClarityDecisionStatus;
  finalRiskScore: number | null;
  riskLevel: RiskClarityRiskLevel | null;
  confidenceScore: number | null;
  coverageScore: number;
  evidenceStrength: number;
  evidenceClass: RiskClarityEvidenceClass;
  policyVersion: string;
  hardEvidenceObserved: boolean;
  betaDiagnosticsVisible: boolean;
  limitations: string[];
  displayNotes: string[];
};

const coverageScores: Record<RiskClarityCoverageStatus, number> = {
  complete: 100,
  partial: 70,
  limited: 45,
  insufficient: 20
};

const evidenceStrengths: Record<RiskClarityEvidenceClass, number> = {
  hard: 95,
  strong_linked: 78,
  contextual: 56,
  weak: 30,
  none: 10,
  unknown: 0
};

const confidenceMultipliers: Record<RiskClarityEvidenceClass, number> = {
  hard: 1,
  strong_linked: 0.85,
  contextual: 0.65,
  weak: 0.45,
  none: 0.35,
  unknown: 0.35
};

export function riskClarityLevelFromScore(score: number | null): RiskClarityRiskLevel | null {
  if (score === null || !Number.isFinite(score)) {
    return null;
  }

  if (score >= 85) {
    return "CRITICAL";
  }
  if (score >= 60) {
    return "HIGH";
  }
  if (score >= 30) {
    return "MEDIUM";
  }
  return "LOW";
}

export function buildRiskClaritySummary(
  input: RiskClarityInput,
  options: { betaDiagnosticsVisible?: boolean } = {}
): RiskClaritySummary {
  const executionStatus = input.executionStatus === "partial" ? "completed" : input.executionStatus;
  const coverageStatus = getCoverageStatus(input);
  const coverageScore = coverageScores[coverageStatus];
  const hardEvidenceObserved = input.hardEvidenceObserved === true;
  const evidenceClass = getEvidenceClass(input.finalRiskScore, hardEvidenceObserved, input.evidenceHints ?? []);

  return {
    executionStatus,
    coverageStatus,
    decisionStatus: getDecisionStatus(input.finalRiskScore, coverageStatus, input.explicitDecision),
    finalRiskScore: input.finalRiskScore,
    riskLevel: riskClarityLevelFromScore(input.finalRiskScore),
    confidenceScore:
      input.finalRiskScore === null ? null : Math.round(coverageScore * confidenceMultipliers[evidenceClass]),
    coverageScore,
    evidenceStrength: evidenceStrengths[evidenceClass],
    evidenceClass,
    policyVersion: getPolicyVersion(input.kind),
    hardEvidenceObserved,
    betaDiagnosticsVisible: options.betaDiagnosticsVisible === true,
    limitations: input.missingChecks ?? [],
    displayNotes: getDisplayNotes(input.finalRiskScore, coverageStatus, evidenceClass)
  };
}

function getCoverageStatus(input: RiskClarityInput): RiskClarityCoverageStatus {
  if (input.executionStatus === "failed") {
    return "insufficient";
  }
  if (input.coveragePartial === true && typeof input.fetchedAddressCount === "number" && input.fetchedAddressCount <= 1) {
    return "limited";
  }
  if ((input.missingChecks?.length ?? 0) > 0 || input.coveragePartial === true) {
    return "partial";
  }
  return "complete";
}

function getEvidenceClass(
  finalRiskScore: number | null,
  hardEvidenceObserved: boolean,
  evidenceHints: string[]
): RiskClarityEvidenceClass {
  if (hardEvidenceObserved) {
    return "hard";
  }

  const hints = evidenceHints.map((hint) => hint.toLowerCase());
  // ponytail: keyword matching is intentionally naive; upgrade to tagged evidence when upstream emits it.
  if (hints.some((hint) => hint.includes("amount") || hint.includes("path") || hint.includes("route"))) {
    return "strong_linked";
  }
  if (
    hints.some(
      (hint) =>
        hint.includes("context") ||
        hint.includes("service") ||
        hint.includes("counterparty") ||
        hint.includes("boundary")
    )
  ) {
    return "contextual";
  }
  if (hints.length > 0) {
    return "weak";
  }
  if (finalRiskScore === null) {
    return "unknown";
  }
  if (finalRiskScore > 0) {
    return "weak";
  }
  return "none";
}

function getDecisionStatus(
  finalRiskScore: number | null,
  coverageStatus: RiskClarityCoverageStatus,
  explicitDecision: RiskClarityInput["explicitDecision"]
): RiskClarityDecisionStatus {
  if (finalRiskScore === null) {
    return "manual_required";
  }
  if (coverageStatus === "insufficient") {
    return "insufficient_coverage";
  }
  if (explicitDecision === "DECLINE") {
    return "decline";
  }
  if (explicitDecision === "REVIEW") {
    return "review";
  }
  if (explicitDecision === "ACCEPTABLE") {
    return "acceptable";
  }
  if (finalRiskScore >= 60) {
    return "decline";
  }
  if (finalRiskScore >= 30) {
    return "review";
  }
  return "acceptable";
}

function getPolicyVersion(kind: RiskClarityInput["kind"]): string {
  if (kind === "incoming_deposit_check") {
    return "incoming-deposit-risk-v1";
  }
  if (kind === "where_is_money_check") {
    return "where-is-money-v1";
  }
  if (kind === "approval_check") {
    return "approval-risk-v1";
  }
  return "wallet-risk-v1";
}

function getDisplayNotes(
  finalRiskScore: number | null,
  coverageStatus: RiskClarityCoverageStatus,
  evidenceClass: RiskClarityEvidenceClass
): string[] {
  const notes: string[] = [];

  if (finalRiskScore !== null && finalRiskScore >= 60 && evidenceClass !== "hard") {
    notes.push("High contextual risk; no hard evidence observed.");
  }
  if (finalRiskScore !== null && finalRiskScore < 30 && coverageStatus !== "complete") {
    notes.push("No material risk found in available data; this is not a guarantee of clean history.");
  }
  if (coverageStatus === "limited") {
    notes.push("Coverage is limited; review the evidence before treating this result as final.");
  }

  return notes;
}
