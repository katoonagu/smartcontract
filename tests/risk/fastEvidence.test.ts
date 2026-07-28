import { describe, expect, it } from "vitest";
import type { RiskReport } from "../../src/types";
import {
  exactFastHardEvidence,
  isExactFastHardEvidenceCode,
  isExactFastHardEvidenceReason
} from "../../src/risk/fastEvidence";

const report = (score: number, code: string, evidenceRef: string | undefined = `evidence:${code}`): RiskReport => ({
  subjectAddress: "TFastEvidence11111111111111111111111",
  score,
  level: score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
  reasons: [{ code, message: code, scoreImpact: score, evidenceRef }]
});

describe("exactFastHardEvidence", () => {
  it.each([85, 90, 100])("does not promote generic context score %s", (score) => {
    expect(exactFastHardEvidence(report(score, "critical_context_only"))).toEqual([]);
  });

  it.each([
    "stablecoin_usdt_blacklisted",
    "forensic_approval_drain_provenance",
    "internal_label_scam"
  ])("accepts explicit exact code %s", (code) => {
    expect(exactFastHardEvidence(report(90, code))).toEqual([
      expect.objectContaining({ code, score: expect.any(Number), evidenceId: `evidence:${code}` })
    ]);
  });

  it("keeps the saved approval-drain proximity label out of exact evidence", () => {
    expect(isExactFastHardEvidenceCode("internal_label_approval_drain_proximity")).toBe(false);
    expect(exactFastHardEvidence(report(80, "internal_label_approval_drain_proximity"))).toEqual([]);
  });

  it("requires a concrete evidence reference for exact approval-drain provenance", () => {
    const missing = report(90, "forensic_approval_drain_provenance");
    delete missing.reasons[0].evidenceRef;
    expect(isExactFastHardEvidenceReason(missing.reasons[0])).toBe(false);
    expect(exactFastHardEvidence(missing)).toEqual([]);
    expect(isExactFastHardEvidenceReason(report(90, "forensic_approval_drain_provenance", "  ").reasons[0])).toBe(false);
  });

  it("does not treat proximity as exact self evidence", () => {
    expect(exactFastHardEvidence(report(95, "internal_label_darknet_exchange_proximity"))).toEqual([]);
  });

  it.each([
    "internal_label_scam_proximity",
    "forensic_exact_approval_spoof",
    "approval_drain_exactish"
  ])("does not accept prefix or substring lookalike %s", (code) => {
    expect(exactFastHardEvidence(report(100, code))).toEqual([]);
    expect(isExactFastHardEvidenceCode(code)).toBe(false);
  });

  it("applies the exact floor and rounds and clamps observed impact", () => {
    const low = report(20, "internal_label_scam");
    low.reasons[0].scoreImpact = 20.4;
    expect(exactFastHardEvidence(low)).toEqual([
      expect.objectContaining({ score: 90, evidenceId: "evidence:internal_label_scam" })
    ]);

    const high = report(100, "internal_label_scam");
    high.reasons[0].scoreImpact = 101.6;
    expect(exactFastHardEvidence(high)[0]?.score).toBe(100);
    expect(isExactFastHardEvidenceReason(high.reasons[0])).toBe(true);
  });
});
