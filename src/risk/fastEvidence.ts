import type { RiskReason, RiskReport } from "../types";

export type ExactFastHardEvidence = {
  code: string;
  score: number;
  evidenceId: string;
  message: string;
};

const EXACT_FAST_HARD_CODE_FLOORS = new Map<string, number>([
  ["stablecoin_usdt_blacklisted", 95],
  ["forensic_approval_drain_provenance", 95],
  ["internal_label_approval_drain_proximity", 95],
  ["internal_label_scam", 90],
  ["internal_label_reported_scam", 90],
  ["internal_label_stolen_funds", 90],
  ["internal_label_phishing", 90],
  ["internal_label_risky_contract", 90],
  ["internal_label_whitebit", 90],
  ["internal_label_darknet_exchange", 90]
]);

export function isExactFastHardEvidenceCode(code: string): boolean {
  return EXACT_FAST_HARD_CODE_FLOORS.has(code);
}

export function isExactFastHardEvidenceReason(reason: RiskReason): boolean {
  return isExactFastHardEvidenceCode(reason.code);
}

function hardScore(reason: RiskReason): number {
  const floor = EXACT_FAST_HARD_CODE_FLOORS.get(reason.code);
  const observed = Number.isFinite(reason.scoreImpact) ? Math.round(reason.scoreImpact) : 0;
  return Math.max(floor ?? 0, Math.min(100, observed));
}

export function exactFastHardEvidence(report: RiskReport | null | undefined): ExactFastHardEvidence[] {
  if (!report) return [];
  return report.reasons
    .filter(isExactFastHardEvidenceReason)
    .map((reason) => ({
      code: reason.code,
      score: hardScore(reason),
      evidenceId: reason.evidenceRef ?? `fast:${reason.code}`,
      message: reason.message
    }));
}
