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

const criticalLabels = new Set(["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract"]);
const mitigatingLabels = new Set(["trusted", "false_positive"]);

function levelFromScore(score: number): RiskReport["level"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function reasonsFromLabels(labels: AddressLabel[]): RiskReason[] {
  return labels.map((label) => {
    if (mitigatingLabels.has(label.label)) {
      return {
        code: `internal_label_${label.label}`,
        message: `Internal label: ${label.label}`,
        scoreImpact: -40
      };
    }

    return {
      code: `internal_label_${label.label}`,
      message: `Internal label: ${label.label}`,
      scoreImpact: criticalLabels.has(label.label) ? 90 : 35
    };
  });
}

function sanitizeSignals(signals: RiskSignal[]): RiskSignal[] {
  return signals
    .filter((signal) => Number.isFinite(signal.scoreImpact) && signal.scoreImpact !== 0)
    .map((signal) => ({
      ...signal,
      scoreImpact: Math.max(0, Math.min(50, signal.scoreImpact))
    }));
}

function sortReasons(reasons: RiskReason[]): RiskReason[] {
  return [...reasons].sort((a, b) => b.scoreImpact - a.scoreImpact);
}

export function calculateRisk(input: CalculateRiskInput): RiskReport {
  const labelReasons = reasonsFromLabels(input.labels);
  const hasCriticalInternalLabel = input.labels.some((label) => criticalLabels.has(label.label));
  const externalReasons = [
    ...sanitizeSignals(input.graphSignals),
    ...sanitizeSignals(input.behaviorSignals),
    ...sanitizeSignals(input.amlSignals)
  ];

  const reasons = hasCriticalInternalLabel
    ? [...labelReasons.filter((reason) => reason.scoreImpact > 0), ...externalReasons]
    : [...labelReasons, ...externalReasons];

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
    reasons: sortReasons(reasons.filter((reason) => reason.scoreImpact !== 0))
  };
}
