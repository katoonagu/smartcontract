import { describe, expect, it } from "vitest";
import { assembleAssetContinuationProfiles } from "../../src/check/deepForensicAssembly";
import type { AssetContinuationProfile } from "../../src/types";

const subjectAddress = "TSubject111111111111111111111111111111";
const windowStart = new Date("2026-05-01T00:00:00.000Z");
const windowEnd = new Date("2026-05-24T00:00:00.000Z");

function assetContinuationProfile(overrides: Partial<AssetContinuationProfile> = {}): AssetContinuationProfile {
  return {
    subjectAddress,
    sourceAsset: "USDT",
    continuationAssetSymbol: "WRAPPED",
    continuationTokenContract: "TWrappedToken1111111111111111111111",
    conversionTxHash: "tx-token-in",
    outgoingTxHash: "tx-token-out",
    protocolAddress: "TProtocol111111111111111111111111111",
    destinationAddress: "TRiskyDestination1111111111111111111",
    destinationRisk: "provider_risk",
    elapsedMs: 7_000,
    sourceAmountRaw: "101607508600",
    continuationAmountRaw: "101607508600",
    tokenQuality: "verified",
    score: 82,
    evidenceClass: "asset_continuation",
    reasons: ["USDT movement continued through WRAPPED to a provider_risk destination."],
    ...overrides
  };
}

describe("assembleAssetContinuationProfiles", () => {
  it("keeps all profiles in the report but persists only floor-grade profiles", () => {
    const high = assetContinuationProfile();
    const low = assetContinuationProfile({
      conversionTxHash: "tx-low-token-in",
      outgoingTxHash: "tx-low-token-out",
      tokenQuality: "unknown",
      score: 40,
      reasons: ["USDT movement continued through an unknown token."]
    });

    const result = assembleAssetContinuationProfiles({
      subjectAddress,
      windowStart,
      windowEnd,
      profiles: [high, low]
    });

    expect(result.profiles).toEqual([high, low]);
    expect(result.persistedProfiles).toEqual([high]);
    expect(result.rawEvidence).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
    expect(result.rawEvidence[0]).toMatchObject({
      source: "tronscan_all_token_transfer_history",
      sourceType: "detector_output",
      chain: "tron",
      address: subjectAddress,
      txHash: "tx-token-in",
      observedTransactionHash: "tx-token-out"
    });
    expect(result.rawEvidence[0]?.evidenceJson).toMatchObject({
      assetContinuationProfile: high,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString()
    });
    expect(result.observations[0]).toMatchObject({
      subjectChain: "tron",
      subjectAddress,
      subjectTxHash: "tx-token-in",
      observedTransactionHash: "tx-token-out",
      signalGroup: "incoming_context",
      code: "forensic_asset_continuation",
      message: "USDT movement continued through another verified TRC20 asset.",
      scoreImpact: 82,
      confidence: "high",
      severity: "high",
      source: "asset_continuation",
      rawEvidenceId: result.rawEvidence[0]?.id
    });
  });

  it("uses medium confidence for known token metadata and medium severity below 80", () => {
    const profile = assetContinuationProfile({
      tokenQuality: "known",
      score: 66
    });

    const result = assembleAssetContinuationProfiles({
      subjectAddress,
      windowStart,
      windowEnd,
      profiles: [profile]
    });

    expect(result.observations[0]).toMatchObject({
      confidence: "medium",
      severity: "medium",
      scoreImpact: 66
    });
  });

  it("persists score 65 and rejects score 64", () => {
    const floor = assetContinuationProfile({
      conversionTxHash: "tx-floor-token-in",
      outgoingTxHash: "tx-floor-token-out",
      score: 65
    });
    const belowFloor = assetContinuationProfile({
      conversionTxHash: "tx-below-floor-token-in",
      outgoingTxHash: "tx-below-floor-token-out",
      score: 64,
      reasons: ["USDT movement continued below the persistence floor."]
    });

    const result = assembleAssetContinuationProfiles({
      subjectAddress,
      windowStart,
      windowEnd,
      profiles: [floor, belowFloor]
    });

    expect(result.profiles).toEqual([floor, belowFloor]);
    expect(result.persistedProfiles).toEqual([floor]);
    expect(result.rawEvidence).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
    expect(result.rawEvidence[0]).toMatchObject({
      txHash: "tx-floor-token-in",
      observedTransactionHash: "tx-floor-token-out"
    });
    expect(result.observations[0]).toMatchObject({
      subjectTxHash: "tx-floor-token-in",
      observedTransactionHash: "tx-floor-token-out",
      scoreImpact: 65
    });
  });
});
