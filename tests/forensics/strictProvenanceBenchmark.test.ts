import { describe, expect, it } from "vitest";
import {
  buildStrictBenchmarkInitialProgress,
  isStrictProvenanceBenchmarkJob,
  strictBlockedResultJson,
  strictCompletedResultJson,
  strictWaitingProgressPatch
} from "../../src/forensics/strictProvenanceBenchmark";

describe("strict provenance benchmark helpers", () => {
  it("builds initial Admin-only strict benchmark progress", () => {
    const progress = buildStrictBenchmarkInitialProgress({
      locale: "ru",
      keyCount: 4,
      accountGroupCount: 4,
      now: new Date("2026-07-02T10:00:00.000Z")
    });

    expect(progress).toMatchObject({
      mode: "wallet_profile",
      locale: "ru",
      strictProvenanceBenchmark: true,
      jobPhase: "selecting_flows",
      strictProvenance: {
        phase: "selecting_flows",
        scoreValid: false,
        scoreBlockedReason: null,
        technicalStatus: null,
        waitingFor: null,
        coveredHopCount: 0,
        totalHopCount: 0
      },
      strictBenchmarkMetrics: {
        total: {
          startedAt: "2026-07-02T10:00:00.000Z",
          keyCount: 4,
          accountGroupCount: 4,
          requestCount: 0
        },
        stages: {
          apiMs: 0,
          dbWriteMs: 0,
          dbReadMs: 0,
          traceMs: 0,
          scoringMs: 0
        }
      }
    });
  });

  it("recognizes only explicit strict benchmark jobs", () => {
    expect(
      isStrictProvenanceBenchmarkJob({
        progressJson: { strictProvenanceBenchmark: true }
      })
    ).toBe(true);
    expect(
      isStrictProvenanceBenchmarkJob({
        progressJson: { strictProvenanceBenchmark: "true" }
      })
    ).toBe(false);
  });

  it("builds waiting progress without marking score valid", () => {
    const patch = strictWaitingProgressPatch({
      address: "THop111111111111111111111111111111111",
      targetTimestamp: new Date("2026-06-30T11:52:00.000Z"),
      queuedReason: "where_is_money_hop"
    });

    expect(patch).toMatchObject({
      jobPhase: "waiting_for_targeted_index",
      strictProvenance: {
        phase: "waiting_for_targeted_index",
        scoreValid: false,
        waitingFor: {
          address: "THop111111111111111111111111111111111",
          coverageMode: "targeted",
          targetTimestamp: "2026-06-30T11:52:00.000Z",
          queuedReason: "where_is_money_hop"
        }
      }
    });
  });

  it("builds final score validity result fields", () => {
    expect(strictCompletedResultJson()).toEqual({
      score_valid: true,
      score_blocked_reason: null,
      technical_status: "completed"
    });
    expect(strictBlockedResultJson("provider_cap_unresolved")).toEqual({
      score_valid: false,
      score_blocked_reason: "provider_cap_unresolved",
      technical_status: "provider_limited"
    });
  });
});
