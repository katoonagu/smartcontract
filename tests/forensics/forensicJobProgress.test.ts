import { describe, expect, it } from "vitest";
import {
  buildForensicJobRuntimeSummary,
  isIncomingDeliverySensitivePhase,
  mergeForensicJobProgress,
  parseForensicJobPhase
} from "../../src/forensics/forensicJobProgress";

describe("forensic job progress helpers", () => {
  it("merges a phase update and refreshes heartbeat without removing existing fields", () => {
    const progress = mergeForensicJobProgress(
      { locale: "ru", mode: "wallet_profile" },
      {
        jobPhase: "cross_chain_stage2",
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "running",
          triggered: true,
          reason: "manual_deep_mode"
        }
      },
      new Date("2026-06-03T00:00:00.000Z")
    );

    expect(progress).toMatchObject({
      locale: "ru",
      mode: "wallet_profile",
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });
  });

  it("backfills existing cross-chain progress updatedAt when patch omits cross-chain progress", () => {
    const progress = mergeForensicJobProgress(
      {
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: false,
          status: "pending",
          reason: "queued"
        }
      },
      { jobPhase: "risk_recording" },
      new Date("2026-06-03T01:00:00.000Z")
    );

    expect(progress).toMatchObject({
      jobPhase: "risk_recording",
      jobHeartbeatAt: "2026-06-03T01:00:00.000Z",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: false,
        status: "pending",
        reason: "queued",
        updatedAt: "2026-06-03T01:00:00.000Z"
      }
    });
  });

  it("deep-merges strict benchmark nested progress", () => {
    const progress = mergeForensicJobProgress(
      {
        strictProvenance: {
          phase: "checking_hop_coverage",
          coveredHopCount: 1,
          totalHopCount: 2
        },
        strictBenchmarkMetrics: {
          total: { requestCount: 3 },
          stages: { apiMs: 10 }
        }
      },
      {
        strictProvenance: { phase: "waiting_for_targeted_index", waitingFor: null },
        strictBenchmarkMetrics: { stages: { traceMs: 20 } }
      },
      new Date("2026-07-02T10:00:00.000Z")
    );

    expect(progress).toMatchObject({
      strictProvenance: {
        phase: "waiting_for_targeted_index",
        coveredHopCount: 1,
        totalHopCount: 2,
        waitingFor: null
      },
      strictBenchmarkMetrics: {
        total: { requestCount: 3 },
        stages: { apiMs: 10, traceMs: 20 }
      }
    });
  });

  it("extracts a compact admin runtime summary from progress json", () => {
    const summary = buildForensicJobRuntimeSummary({
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });

    expect(summary).toEqual({
      phase: "cross_chain_stage2",
      heartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      lastRecoveredAt: null,
      staleRecoveryReason: null,
      crossChain: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        selectedAmountRaw: null,
        targetAmountRaw: null,
        providerCalls: null,
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });
  });

  it("returns null for invalid cross-chain progress status", () => {
    const summary = buildForensicJobRuntimeSummary({
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "unexpected_status"
      }
    });

    expect(summary.crossChain?.status).toBe(null);
  });

  it("returns null for missing cross-chain progress status", () => {
    const summary = buildForensicJobRuntimeSummary({
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true
      }
    });

    expect(summary.crossChain?.status).toBe(null);
  });

  it("marks delivery-sensitive incoming phases", () => {
    expect(isIncomingDeliverySensitivePhase("notification_delivery")).toBe(true);
    expect(isIncomingDeliverySensitivePhase("completing")).toBe(true);
    expect(isIncomingDeliverySensitivePhase("incoming_deposit_trace")).toBe(false);
    expect(isIncomingDeliverySensitivePhase(null)).toBe(true);
  });

  it("accepts strict provenance benchmark phases", () => {
    expect(parseForensicJobPhase("selecting_flows")).toBe("selecting_flows");
    expect(parseForensicJobPhase("tracing_paths")).toBe("tracing_paths");
    expect(parseForensicJobPhase("checking_hop_coverage")).toBe("checking_hop_coverage");
    expect(parseForensicJobPhase("indexing_hop_history")).toBe("indexing_hop_history");
    expect(parseForensicJobPhase("waiting_for_targeted_index")).toBe("waiting_for_targeted_index");
    expect(parseForensicJobPhase("reading_local_index")).toBe("reading_local_index");
    expect(parseForensicJobPhase("scoring")).toBe("scoring");
    expect(parseForensicJobPhase("provider_limited")).toBe("provider_limited");
  });

  it("summarizes waiting strict benchmark phase", () => {
    expect(
      buildForensicJobRuntimeSummary({
        jobPhase: "waiting_for_targeted_index",
        jobHeartbeatAt: "2026-07-02T10:00:00.000Z"
      })
    ).toMatchObject({
      phase: "waiting_for_targeted_index",
      heartbeatAt: "2026-07-02T10:00:00.000Z"
    });
  });
});
