import { describe, expect, it } from "vitest";
import { calculateHistoricalTransitBreakdown } from "../../src/forensics/historicalTransitScore";

describe("calculateHistoricalTransitBreakdown", () => {
  it("scores high-volume pass-through bridge/router flow as a strong pattern", () => {
    const result = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: "7541408440000",
      outgoingVolumeRaw: "7541406950000",
      inflowToOutflowRatio: 0.999,
      bridgeDexRouterOutgoingRatio: 0.25,
      unknownContractOutgoingRatio: 0
    });

    expect(result).toMatchObject({
      eligible: true,
      flowUsdt: 7541408,
      serviceShare: 0.25,
      passThrough: 0.999,
      volumeScore: 20,
      passThroughScore: 20,
      serviceShareScore: 6,
      score: 81
    });
  });

  it("does not score ordinary low-volume service usage as a strong pattern", () => {
    const result = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: "100000000",
      outgoingVolumeRaw: "50000000",
      inflowToOutflowRatio: 0.5,
      bridgeDexRouterOutgoingRatio: 0.1,
      unknownContractOutgoingRatio: 0
    });

    expect(result).toMatchObject({
      eligible: false,
      score: 0,
      serviceShare: 0.1
    });
  });

  it("rounds only the final historical transit score for eligibility", () => {
    const result = calculateHistoricalTransitBreakdown({
      incomingVolumeRaw: "100000000",
      outgoingVolumeRaw: "50000000",
      inflowToOutflowRatio: 0.5,
      bridgeDexRouterOutgoingRatio: 0.3,
      unknownContractOutgoingRatio: 0
    });

    expect(result.eligible).toBe(false);
    expect(result.score).toBe(0);
  });
});
