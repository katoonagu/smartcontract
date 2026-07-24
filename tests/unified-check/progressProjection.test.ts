import { describe, expect, it } from "vitest";
import {
  projectUnifiedProgress,
  type UnifiedProgressInputV1
} from "../../src/unifiedCheck/progressProjection";

const INPUT: UnifiedProgressInputV1 = {
  lifecycle: "RUNNING",
  phase: "traversal_fetch",
  provider: {
    configuredSlots: 4,
    activeSlots: 3,
    coolingDownSlots: 1,
    requests: 120,
    measurementWindowMs: 60_000,
    keyGroups: [
      { id: "group-1", requests: 30, inFlight: 1, status: "active" }
    ]
  },
  traversal: {
    discoveredOutstanding: 12,
    frontierExpanding: true,
    frontierCount: 20,
    frontierPeak: 35,
    uniqueAddresses: 48,
    fundingEpisodes: 90
  },
  storage: { checkpointBytes: 8_192, deltaArtifactBytes: 30_000 },
  reuse: {
    networkFetches: 60,
    providerCacheHits: 20,
    manifestReuses: 40,
    replayAvoided: 25
  }
};

describe("Unified Admin progress projection", () => {
  it("separates exact discovered work from an expansion lower bound", () => {
    const progress = projectUnifiedProgress(INPUT);
    expect(progress.remaining).toEqual({
      discoveredExact: 12,
      totalKnown: false,
      undiscoveredLowerBound: 0
    });
    expect(progress).not.toHaveProperty("estimatedPercent");
    expect(progress).not.toHaveProperty("etaMs");
    expect(progress.provider).toMatchObject({
      configuredSlots: 4,
      activeSlots: 3,
      idleSlots: 0,
      coolingDownSlots: 1,
      requestsPerSecond: 2
    });
  });

  it("does not expose provider keys or user-facing timing targets", () => {
    const json = JSON.stringify(projectUnifiedProgress(INPUT));
    expect(json).not.toMatch(/api.?key|2 minutes|10 minutes|\bSLO\b/i);
    expect(json).not.toMatch(/estimatedPercent|"etaMs"/i);
  });

  it("reports exact remaining work only after frontier closure", () => {
    expect(projectUnifiedProgress({
      ...INPUT,
      lifecycle: "COMPLETED",
      phase: "completed",
      traversal: {
        ...INPUT.traversal,
        discoveredOutstanding: 0,
        frontierExpanding: false,
        frontierCount: 0
      }
    })).toMatchObject({
      lifecycle: "COMPLETED",
      noScoreReason: null,
      remaining: {
        discoveredExact: 0,
        totalKnown: true,
        undiscoveredLowerBound: 0
      }
    });
  });

  it("keeps technical failure operational rather than inventing risk", () => {
    const progress = projectUnifiedProgress({
      ...INPUT,
      lifecycle: "FAILED_TECHNICAL",
      phase: "failed_technical"
    });
    expect(progress.noScoreReason).toContain("technical");
    expect(progress).not.toHaveProperty("score");
    expect(progress).not.toHaveProperty("decision");
  });
});
