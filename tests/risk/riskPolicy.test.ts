import { describe, expect, it } from "vitest";
import { boundedReasonImpact, calculateBoundedPolicyScore, calculatePolicyScoreBreakdown, policyForReason } from "../../src/risk/riskPolicy";
import type { RiskReason } from "../../src/types";

function reason(code: string, scoreImpact: number): RiskReason {
  return { code, message: code, scoreImpact };
}

describe("riskPolicy", () => {
  it("preserves exact critical stablecoin evidence", () => {
    const score = calculateBoundedPolicyScore([reason("stablecoin_usdt_blacklisted", 90)]);
    expect(score).toBe(90);
    expect(policyForReason(reason("stablecoin_usdt_blacklisted", 90))).toMatchObject({
      dimension: "provider_label",
      evidenceClass: "exact_self",
      hardEvidence: true,
      cap: 95
    });
  });

  it("caps service boundary context at 15", () => {
    const capped = boundedReasonImpact(reason("forensic_boundary_exposure_context", 80));
    expect(capped.scoreImpact).toBe(15);
    expect(calculateBoundedPolicyScore([capped])).toBe(15);
  });

  it("caps behavior-only suspicion at 30", () => {
    expect(boundedReasonImpact(reason("forensic_address_behavior", 75)).scoreImpact).toBe(30);
    expect(calculateBoundedPolicyScore([reason("forensic_address_behavior", 75)])).toBe(25);
  });

  it("combines bounded dimensions without letting weak context reach critical", () => {
    const score = calculateBoundedPolicyScore([
      reason("forensic_extended_provenance", 45),
      reason("forensic_address_behavior", 30),
      reason("forensic_boundary_exposure_context", 15)
    ]);
    expect(score).toBe(80);
  });

  it("lets exact approval-drain provenance dominate composite score", () => {
    const score = calculateBoundedPolicyScore([
      reason("forensic_approval_drain_provenance", 90),
      reason("forensic_address_behavior", 30),
      reason("forensic_boundary_exposure_context", 15)
    ]);
    expect(score).toBe(90);
  });

  it("applies trusted/false-positive dampeners to non-hard evidence", () => {
    const score = calculateBoundedPolicyScore([
      reason("forensic_address_behavior", 30),
      reason("internal_label_false_positive", -40)
    ]);
    expect(score).toBe(0);
  });

  it("separates taint proof from operational laundering-pattern risk", () => {
    const breakdown = calculatePolicyScoreBreakdown([
      reason("forensic_service_exposure", 50),
      reason("forensic_address_behavior", 30),
      reason("forensic_boundary_exposure_context", 15)
    ]);

    expect(breakdown.taintScore).toBe(0);
    expect(breakdown.launderingPatternScore).toBeGreaterThanOrEqual(60);
    expect(breakdown.score).toBe(breakdown.launderingPatternScore);
    expect(breakdown.dominantRiskType).toBe("laundering_pattern");
  });

  it("allows dominant counterparty fast snapshot context to reach HIGH without taint proof", () => {
    const breakdown = calculatePolicyScoreBreakdown([
      reason("forensic_counterparty_fast_snapshot_context", 65)
    ]);

    expect(boundedReasonImpact(reason("forensic_counterparty_fast_snapshot_context", 65)).scoreImpact).toBe(60);
    expect(breakdown.score).toBe(60);
    expect(breakdown.taintScore).toBe(0);
    expect(breakdown.dominantRiskType).toBe("laundering_pattern");
  });

  it("allows direct WhiteBIT counterparty context to carry 80/100 without marking taint proof", () => {
    const breakdown = calculatePolicyScoreBreakdown([
      reason("forensic_counterparty_whitebit", 80)
    ]);

    expect(boundedReasonImpact(reason("forensic_counterparty_whitebit", 80)).scoreImpact).toBe(80);
    expect(breakdown.score).toBe(80);
    expect(breakdown.taintScore).toBe(0);
    expect(breakdown.dominantRiskType).toBe("laundering_pattern");
  });
});
