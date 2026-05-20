import type { AddressLabel, RiskReason, RiskReport } from "../types";

export type RiskSignal = {
  code: string;
  message: string;
  scoreImpact: number;
};

export type CalculateRiskInput = {
  subjectAddress: string;
  labels: AddressLabel[];
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

function levelFromScore(score: number): RiskReport["level"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function reasonsFromLabels(labels: AddressLabel[]): RiskReason[] {
  return labels.map((label) => {
    if (label.label === "trusted" || label.label === "false_positive") {
      return {
        code: `internal_label_${label.label}`,
        message: `Internal label: ${label.label}`,
        scoreImpact: -40
      };
    }

    const criticalLabels = new Set(["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract"]);
    return {
      code: `internal_label_${label.label}`,
      message: `Internal label: ${label.label}`,
      scoreImpact: criticalLabels.has(label.label) ? 90 : 35
    };
  });
}

export function calculateRisk(input: CalculateRiskInput): RiskReport {
  const reasons = [
    ...reasonsFromLabels(input.labels),
    ...input.graphSignals,
    ...input.behaviorSignals,
    ...input.amlSignals
  ];

  const score = Math.max(
    0,
    Math.min(
      100,
      reasons.reduce((sum, reason) => sum + reason.scoreImpact, 0)
    )
  );

  return {
    subjectAddress: input.subjectAddress,
    level: levelFromScore(score),
    score,
    reasons: reasons.filter((reason) => reason.scoreImpact !== 0)
  };
}
