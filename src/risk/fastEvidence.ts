import type { RiskReason, RiskReport } from "../types";

export type ExactFastHardEvidence = {
  code: ExactFastHardEvidenceCode;
  score: number;
  evidenceId: string;
  message: string;
};

export const EXACT_FAST_HARD_EVIDENCE_CODES = [
  "stablecoin_usdt_blacklisted",
  "forensic_approval_drain_provenance",
  "internal_label_scam",
  "internal_label_reported_scam",
  "internal_label_stolen_funds",
  "internal_label_phishing",
  "internal_label_risky_contract",
  "internal_label_whitebit",
  "internal_label_darknet_exchange"
] as const;

export type ExactFastHardEvidenceCode = typeof EXACT_FAST_HARD_EVIDENCE_CODES[number];

const EXACT_FAST_HARD_CODE_FLOORS: Record<ExactFastHardEvidenceCode, number> = {
  stablecoin_usdt_blacklisted: 95,
  forensic_approval_drain_provenance: 95,
  internal_label_scam: 90,
  internal_label_reported_scam: 90,
  internal_label_stolen_funds: 90,
  internal_label_phishing: 90,
  internal_label_risky_contract: 90,
  internal_label_whitebit: 90,
  internal_label_darknet_exchange: 90
};

const exactFastHardEvidenceCodes = new Set<string>(EXACT_FAST_HARD_EVIDENCE_CODES);

export function isExactFastHardEvidenceCode(code: string): code is ExactFastHardEvidenceCode {
  return exactFastHardEvidenceCodes.has(code);
}

export function isExactFastHardEvidenceReason(
  reason: RiskReason
): reason is RiskReason & { code: ExactFastHardEvidenceCode } {
  return isExactFastHardEvidenceCode(reason.code) &&
    (reason.code !== "forensic_approval_drain_provenance" || Boolean(reason.evidenceRef?.trim()));
}

function hardScore(reason: RiskReason): number {
  const floor = isExactFastHardEvidenceCode(reason.code) ? EXACT_FAST_HARD_CODE_FLOORS[reason.code] : 0;
  const observed = Number.isFinite(reason.scoreImpact) ? Math.round(reason.scoreImpact) : 0;
  return Math.max(floor, Math.min(100, observed));
}

export function exactFastHardEvidence(report: RiskReport | null | undefined): ExactFastHardEvidence[] {
  if (!report) return [];
  return report.reasons
    .filter(isExactFastHardEvidenceReason)
    .map((reason) => ({
      code: reason.code,
      score: hardScore(reason),
      evidenceId: reason.evidenceRef?.trim() || `fast:${reason.code}`,
      message: reason.message
    }));
}
