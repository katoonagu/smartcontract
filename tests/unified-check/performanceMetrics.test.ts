import { describe, expect, it } from "vitest";
import {
  buildUnifiedPerformanceBenchmarkManifest,
  createUnifiedPerformanceCounters,
  patchUnifiedPerformanceCounters
} from "../../src/unifiedCheck/performanceMetrics";
import {
  PERFORMANCE_CASE
} from "../fixtures/unified-check/performanceBenchmark";

describe("Unified P0 performance identity", () => {
  it("keeps deterministic semantic identity separate from execution details", () => {
    const left = buildUnifiedPerformanceBenchmarkManifest(PERFORMANCE_CASE);
    const right = buildUnifiedPerformanceBenchmarkManifest({
      ...PERFORMANCE_CASE,
      runtimeCommit: "b".repeat(40),
      checkpointVersion: "unified-production-traversal-checkpoint-v2",
      logicalChunkEvents: 250,
      providerSlots: 4
    });

    expect(left.semanticIdentitySha256).toBe(right.semanticIdentitySha256);
    expect(left.executionIdentitySha256).not.toBe(
      right.executionIdentitySha256
    );
    expect(left.runId).toBe("perf:tpcp:v1");
    expect(left.frozenClockIso).toBe("2026-07-24T00:00:00.000Z");
  });

  it("changes semantic identity when frozen evidence changes", () => {
    const left = buildUnifiedPerformanceBenchmarkManifest(PERFORMANCE_CASE);
    const right = buildUnifiedPerformanceBenchmarkManifest({
      ...PERFORMANCE_CASE,
      providerBundleSha256: "9".repeat(64)
    });

    expect(left.semanticIdentitySha256).not.toBe(
      right.semanticIdentitySha256
    );
  });

  it("accumulates counters without exposing key material", () => {
    const counters = patchUnifiedPerformanceCounters(
      createUnifiedPerformanceCounters(),
      {
        providerCalls: 2,
        networkFetches: 1,
        currentInFlight: 2,
        maxInFlight: 2
      }
    );

    expect(counters).toMatchObject({
      providerCalls: 2,
      networkFetches: 1,
      currentInFlight: 2,
      maxInFlight: 2
    });
    expect(JSON.stringify(counters)).not.toMatch(/api.?key/i);
  });

  it("takes maxima for peak counters and rejects invalid patches", () => {
    const current = patchUnifiedPerformanceCounters(
      createUnifiedPerformanceCounters(),
      { maxInFlight: 4, maxCheckpointBytes: 16_384 }
    );
    const next = patchUnifiedPerformanceCounters(current, {
      maxInFlight: 2,
      maxCheckpointBytes: 8_192
    });

    expect(next.maxInFlight).toBe(4);
    expect(next.maxCheckpointBytes).toBe(16_384);
    expect(() => patchUnifiedPerformanceCounters(next, {
      providerCalls: -1
    })).toThrow("unified_performance_counter_invalid");
  });

  it("keeps provider failure, recovery, and delivery counters in the shared execution metrics", () => {
    const counters = patchUnifiedPerformanceCounters(
      createUnifiedPerformanceCounters(),
      {
        providerErrors: 2,
        rateLimited429: 1,
        restartRecoveries: 1,
        reconciliationRecoveries: 1,
        deliveryIntents: 3,
        externalTelegramSends: 0
      }
    );

    expect(counters).toMatchObject({
      providerErrors: 2,
      rateLimited429: 1,
      restartRecoveries: 1,
      reconciliationRecoveries: 1,
      deliveryIntents: 3,
      externalTelegramSends: 0
    });
  });
});
