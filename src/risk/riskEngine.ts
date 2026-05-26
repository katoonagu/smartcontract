import type { AddressLabel, RiskConfidence, RiskReason, RiskReport, RiskSeverity } from "../types";
import { boundedReasonImpact, calculateBoundedPolicyScore } from "./riskPolicy";

export type RiskSignal = {
  code: string;
  message: string;
  scoreImpact: number;
  source?: string;
  confidence?: RiskConfidence;
  severity?: RiskSeverity;
  evidenceRef?: string;
};

export type CalculateRiskInput = {
  subjectAddress: string;
  labels: AddressLabel[];
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

const criticalLabels = new Set(["scam", "stolen_funds", "phishing", "mixer_like", "risky_contract", "darknet_exchange"]);
const highRiskLabels = new Set(["darknet_exchange_proximity", "approval_drain_proximity"]);
const mitigatingLabels = new Set(["trusted", "false_positive"]);
const exactCriticalSignalCodes = new Set(["stablecoin_usdt_blacklisted", "forensic_approval_drain_provenance"]);

function labelScoreImpact(label: AddressLabel["label"]): number {
  if (criticalLabels.has(label)) return 90;
  if (highRiskLabels.has(label)) return 80;
  return 35;
}

function labelMessage(label: AddressLabel["label"]): string {
  if (label === "darknet_exchange_proximity") {
    return "Derived high-risk marker: confirmed on-chain exposure to known darknet exchange seed within 2 hops.";
  }
  if (label === "approval_drain_proximity") {
    return "Derived high-risk marker: exact upstream approval-drain provenance linked to this address.";
  }
  return `Internal label: ${label}`;
}

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
      message: labelMessage(label.label),
      scoreImpact: labelScoreImpact(label.label)
    };
  });
}

function sanitizeSignals(signals: RiskSignal[]): RiskSignal[] {
  return signals
    .filter((signal) => Number.isFinite(signal.scoreImpact) && signal.scoreImpact !== 0)
    .map((signal) => ({
      ...signal,
      scoreImpact: Math.max(0, Math.min(exactCriticalSignalCodes.has(signal.code) ? 90 : 50, signal.scoreImpact))
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

  const boundedReasons = reasons.map((reason) => boundedReasonImpact(reason));
  const score = calculateBoundedPolicyScore(boundedReasons);

  return {
    subjectAddress: input.subjectAddress,
    level: levelFromScore(score),
    score,
    reasons: sortReasons(boundedReasons.filter((reason) => reason.scoreImpact !== 0))
  };
}
