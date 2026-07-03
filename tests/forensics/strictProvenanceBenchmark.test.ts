import { describe, expect, it } from "vitest";
import {
  addStrictBenchmarkStageTiming,
  buildStrictBenchmarkInitialProgress,
  addStrictBenchmarkCounters,
  isStrictProvenanceBenchmarkJob,
  measureStrictBenchmarkStage,
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
      technical_status: "provider_cap_unresolved"
    });
    expect(strictBlockedResultJson("provider_error")).toEqual({
      score_valid: false,
      score_blocked_reason: "provider_error",
      technical_status: "provider_error"
    });
    expect(strictBlockedResultJson("rate_limited_after_retries")).toEqual({
      score_valid: false,
      score_blocked_reason: "rate_limited_after_retries",
      technical_status: "provider_limited"
    });
    expect(strictBlockedResultJson("provider_inconsistent")).toEqual({
      score_valid: false,
      score_blocked_reason: "provider_inconsistent",
      technical_status: "provider_inconsistent"
    });
    expect(strictBlockedResultJson("hard_safety_limit_exceeded")).toEqual({
      score_valid: false,
      score_blocked_reason: "hard_safety_limit_exceeded",
      technical_status: "hard_safety_limit_exceeded"
    });
  });

  it("accumulates benchmark stage timings", async () => {
    const progress = buildStrictBenchmarkInitialProgress({
      locale: "ru",
      keyCount: 4,
      accountGroupCount: 4,
      now: new Date("2026-07-02T10:00:00.000Z")
    });

    const measured = await measureStrictBenchmarkStage(progress, "traceMs", async () => "ok", {
      nowMs: (() => {
        const values = [1000, 1250];
        return () => values.shift() ?? 1250;
      })()
    });

    expect(measured.value).toBe("ok");
    expect(measured.progress.strictBenchmarkMetrics.stages.traceMs).toBe(250);
  });

  it("adds stage timings to the latest progress snapshot", () => {
    const progress = buildStrictBenchmarkInitialProgress({
      locale: "ru",
      keyCount: 4,
      accountGroupCount: 4,
      now: new Date("2026-07-02T10:00:00.000Z")
    });

    const updated = addStrictBenchmarkStageTiming({
      ...progress,
      crossChainStage2Progress: { checked: 2 }
    }, "traceMs", 75, { nowMs: () => Date.parse("2026-07-02T10:00:01.000Z") });

    expect(updated.crossChainStage2Progress).toEqual({ checked: 2 });
    expect(updated.strictBenchmarkMetrics.stages.traceMs).toBe(75);
    expect(updated.strictBenchmarkMetrics.total.elapsedMs).toBe(1000);
  });

  it("adds provider request counters without exposing keys", () => {
    const progress = buildStrictBenchmarkInitialProgress({
      locale: "ru",
      keyCount: 4,
      accountGroupCount: 4,
      now: new Date("2026-07-02T10:00:00.000Z")
    });

    const updated = addStrictBenchmarkCounters(progress, {
      requestCount: 3,
      successCount: 2,
      failedCount: 1,
      rateLimitedCount: 1,
      pagesFetched: 2,
      transfersFetched: 100
    });

    expect(updated.strictBenchmarkMetrics.total).toMatchObject({
      keyCount: 4,
      accountGroupCount: 4,
      requestCount: 3,
      successCount: 2,
      failedCount: 1,
      rateLimitedCount: 1,
      pagesFetched: 2,
      transfersFetched: 100
    });
    expect(JSON.stringify(updated)).not.toContain("apiKey");
  });

  it("scrubs existing API key value fields while preserving key counts", () => {
    const updated = addStrictBenchmarkCounters({
      strictBenchmarkMetrics: {
        total: {
          startedAt: "2026-07-02T10:00:00.000Z",
          keyCount: 4,
          apiKey: "secret-key-value"
        },
        apiKeys: ["secret-key-value"],
        stages: { traceMs: 1 }
      }
    }, {});

    expect(updated.strictBenchmarkMetrics.total.keyCount).toBe(4);
    expect(JSON.stringify(updated)).not.toContain("secret-key-value");
    expect(JSON.stringify(updated)).not.toContain("apiKey");
  });
});
