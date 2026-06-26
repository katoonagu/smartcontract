import { describe, expect, it } from "vitest";
import {
  buildIncomingSourceAttributionSummary,
  buildWhereSourceAttributionSummary
} from "../../src/forensics/sourceAttributionSummary";

describe("source attribution summary", () => {
  it("summarizes a strong where-is-money source candidate", () => {
    const summary = buildWhereSourceAttributionSummary({
      paths: [
        {
          label: "Binance",
          category: "allowlisted_cex",
          effectiveAmountShare: 0.68,
          amountContinuityRatio: 0.92,
          hopCount: 2,
          elapsedMs: 60 * 60 * 1000
        }
      ]
    });

    expect(summary.explainedAmountShare).toBe(0.68);
    expect(summary.unknownAmountShare).toBe(0.32);
    expect(summary.topSourceCandidate).toEqual(
      expect.objectContaining({
        label: "Binance",
        category: "allowlisted_cex",
        amountShare: 0.68,
        pathStrength: "strong"
      })
    );
    expect(summary.sourceConfidence).toBeGreaterThanOrEqual(70);
    expect(summary.attributionBasis).toContain("amount continuity");
  });

  it("keeps a low-continuity boundary path weak", () => {
    const summary = buildWhereSourceAttributionSummary({
      paths: [
        {
          label: "Boundary hop",
          category: "unknown",
          effectiveAmountShare: 0.2,
          amountContinuityRatio: 0.25,
          hopCount: 4,
          elapsedMs: 2 * 60 * 60 * 1000,
          stoppedReason: "service_boundary"
        }
      ]
    });

    expect(summary.explainedAmountShare).toBe(0.2);
    expect(summary.unknownAmountShare).toBe(0.8);
    expect(summary.pathStrength).toBe("weak");
    expect(summary.sourceConfidence).toBeLessThan(50);
    expect(summary.boundaryReason).toBe("service_boundary");
  });

  it("summarizes a strong incoming deposit origin path", () => {
    const summary = buildIncomingSourceAttributionSummary({
      paths: [
        {
          label: "Clean CEX",
          category: "clean",
          amountCoverageRatio: 0.85,
          amountContinuityRatio: 0.9
        }
      ]
    });

    expect(summary.explainedAmountShare).toBe(0.85);
    expect(summary.unknownAmountShare).toBe(0.15);
    expect(summary.topSourceCandidate).toEqual(
      expect.objectContaining({
        label: "Clean CEX",
        category: "clean",
        amountShare: 0.85,
        pathStrength: "strong"
      })
    );
  });

  it("returns an unknown summary when no paths exist", () => {
    const summary = buildWhereSourceAttributionSummary({ paths: [] });

    expect(summary.explainedAmountShare).toBe(0);
    expect(summary.unknownAmountShare).toBe(1);
    expect(summary.topSourceCandidate).toBeNull();
    expect(summary.sourceConfidence).toBe(0);
    expect(summary.pathStrength).toBe("unknown");
  });
});
