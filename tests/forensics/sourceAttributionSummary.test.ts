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
          sourceAddress: "TBinance111111111111111111111111111",
          exposureSourceLabel: "Binance",
          sourceExposureKind: "allowlisted_cex",
          exposureSourceKey: "cex:binance",
          rootSourceType: "cex",
          balanceShare: 0.68,
          effectiveExposureShare: 0.68,
          amountContinuity: 0.95,
          hops: 2,
          elapsedMs: 20 * 60 * 1000,
          reasons: ["amount continuity"]
        }
      ]
    });

    expect(summary.explainedAmountShare).toBe(0.68);
    expect(summary.unknownAmountShare).toBe(0.32);
    expect(summary.topSourceShare).toBe(0.68);
    expect(summary.boundaryReason).toBeNull();
    expect(summary.topSourceCandidate).toEqual(
      expect.objectContaining({
        label: "Binance",
        address: "TBinance111111111111111111111111111",
        kind: "allowlisted_cex",
        share: 0.68,
        pathStrength: "strong",
        confidence: expect.any(Number)
      })
    );
    expect(summary.sourceConfidence).toBeGreaterThanOrEqual(70);
    expect(summary.attributionBasis).toContain("amount continuity");
  });

  it("keeps a low-continuity boundary path weak", () => {
    const summary = buildWhereSourceAttributionSummary({
      paths: [
        {
          sourceAddress: "TBridge11111111111111111111111111111",
          exposureSourceLabel: "Bridge router",
          sourceExposureKind: "bridge",
          exposureSourceKey: "bridge:router",
          rootSourceType: "bridge",
          balanceShare: 0.2,
          effectiveExposureShare: 0.2,
          amountContinuity: 0.35,
          hops: 6,
          elapsedMs: 12 * 24 * 60 * 60 * 1000,
          stoppedReason: "bridge router reached",
          reasons: ["boundary reached"]
        }
      ]
    });

    expect(summary.explainedAmountShare).toBe(0.2);
    expect(summary.unknownAmountShare).toBe(0.8);
    expect(summary.pathStrength).toBe("weak");
    expect(summary.sourceConfidence).toBeLessThan(50);
    expect(summary.boundaryReason).toBe("bridge router reached");
  });

  it("summarizes a strong incoming deposit origin path", () => {
    const summary = buildIncomingSourceAttributionSummary({
      paths: [
        {
          sourceAddress: "TClean111111111111111111111111111111",
          sourceLabel: "Clean CEX",
          sourcePolicy: "clean",
          amountCoverageRatio: 0.85,
          amountContinuity: "strong",
          steps: 2,
          reasons: ["incoming origin"]
        }
      ]
    });

    expect(summary.explainedAmountShare).toBe(0.85);
    expect(summary.unknownAmountShare).toBe(0.15);
    expect(summary.topSourceShare).toBe(0.85);
    expect(summary.boundaryReason).toBeNull();
    expect(summary.topSourceCandidate).toEqual(
      expect.objectContaining({
        label: "Clean CEX",
        address: "TClean111111111111111111111111111111",
        kind: "clean",
        share: 0.85,
        pathStrength: "strong"
      })
    );
  });

  it("returns an unknown summary when no paths exist", () => {
    const summary = buildWhereSourceAttributionSummary({ paths: [] });

    expect(summary.explainedAmountShare).toBe(0);
    expect(summary.unknownAmountShare).toBe(1);
    expect(summary.topSourceCandidate).toBeNull();
    expect(summary.topSourceShare).toBe(0);
    expect(summary.sourceConfidence).toBe(0);
    expect(summary.pathStrength).toBe("unknown");
    expect(summary.boundaryReason).toBeNull();
  });
});
