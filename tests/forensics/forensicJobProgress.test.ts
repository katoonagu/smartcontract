import { describe, expect, it } from "vitest";
import {
  buildForensicJobRuntimeSummary,
  isIncomingDeliverySensitivePhase,
  mergeForensicJobProgress
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
});
