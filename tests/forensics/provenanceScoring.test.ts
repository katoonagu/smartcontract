import { describe, expect, it } from "vitest";
import {
  aggregateLayerScores,
  amountContinuityAdjustment,
  baseShareScore,
  hopAdjustment,
  riskBandFromScore,
  scorePathLinkStrength,
  scoreSourceExposures,
  timeAdjustment
} from "../../src/forensics/provenanceScoring";
import type { MoneyOriginPath, SourceExposureKind, WhereIsMoneyAgeSignals } from "../../src/types";

const source = "TSource111111111111111111111111111";
const hop = "THop1111111111111111111111111111";
const subject = "TSubject1111111111111111111111111";

function path(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  return {
    verdict: "REVIEW",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    rootSourceAddress: source,
    balanceTransferTxHash: "tx-balance",
    balanceShare: 0.15,
    riskScoreContribution: 45,
    txHashes: ["tx-source-hop", "tx-hop-subject"],
    pathAddresses: [source, hop, subject],
    steps: [
      {
        txHash: "tx-source-hop",
        fromAddress: source,
        toAddress: hop,
        amountRaw: "16000000000",
        timestamp: "2026-05-31T10:00:00.000Z"
      },
      {
        txHash: "tx-hop-subject",
        fromAddress: hop,
        toAddress: subject,
        amountRaw: "15000000000",
        timestamp: "2026-05-31T12:00:00.000Z"
      }
    ],
    amountPreservationRatio: 0.93,
    timeSpanMs: 2 * 60 * 60 * 1000,
    reasons: ["HTX/Huobi source-policy exposure."],
    exposureSourceKey: "htx_huobi",
    exposureSourceLabel: "HTX/Huobi",
    sourceExposureKind: "htx_huobi",
    effectiveExposureShare: null,
    linkStrength: null,
    ...overrides
  };
}

const noAgeSignals: WhereIsMoneyAgeSignals = {
  subjectFirstSeenAt: "2026-05-01T00:00:00.000Z",
  subjectAgeDays: 30,
  subjectActiveDays: 30,
  directSenderMedianAgeDays: 30,
  oldestDirectSenderAgeDays: 30,
  repeatedRelationshipCount: 0,
  longestRelationshipAgeDays: null,
  maxDormancyGapDays: null,
  signals: []
};

describe("provenanceScoring", () => {
  it("uses source-specific share curves and risk bands", () => {
    expect(baseShareScore("htx_huobi", 0.15)).toBeLessThan(55);
    expect(baseShareScore("htx_huobi", 0.62)).toBeGreaterThanOrEqual(50);
    expect(baseShareScore("htx_huobi", 0.62)).toBeLessThanOrEqual(82);
    expect(baseShareScore("whitebit", 0.35)).toBeLessThan(55);
    expect(baseShareScore("bridge_router_dex", 0.001)).toBeLessThanOrEqual(10);
    expect(baseShareScore("bridge_router_dex", 4060 / 46000)).toBeLessThanOrEqual(30);
    expect(baseShareScore("bridge_router_dex", 0.65)).toBeGreaterThanOrEqual(60);
    expect(baseShareScore("bridge_router_dex", 0.65)).toBeLessThanOrEqual(70);
    expect(baseShareScore("no_name_token_liquidity", 0.15)).toBe(70);
    expect(baseShareScore("no_name_token_liquidity", 1)).toBe(88);
    expect(baseShareScore("mixer", 0.15)).toBe(78);
    expect(baseShareScore("mixer", 1)).toBe(92);
    expect(baseShareScore("sanctioned_service", 0.15)).toBe(95);
    expect(baseShareScore("sanctioned_service", 1)).toBe(98);
    expect(baseShareScore("unknown_contract", 0.25)).toBeLessThan(45);
    expect(baseShareScore("unknown_cex", 0.01)).toBeLessThan(35);
    expect(baseShareScore("whitebit", 0.01)).toBeLessThan(30);
    expect(baseShareScore("allowlisted_cex", 1)).toBe(5);
    expect(baseShareScore("risky_label", 0.01)).toBeLessThan(90);

    expect(riskBandFromScore(85)).toBe("CRITICAL");
    expect(riskBandFromScore(60)).toBe("HIGH");
    expect(riskBandFromScore(45)).toBe("MEDIUM");
    expect(riskBandFromScore(20)).toBe("LOW-MEDIUM");
    expect(riskBandFromScore(19)).toBe("LOW");
  });

  it("scores path continuity modifiers at their documented thresholds", () => {
    expect(hopAdjustment(0, 5 * 60 * 1000, 1)).toBe(14);
    expect(hopAdjustment(1, 5 * 60 * 1000, 1)).toBe(12);
    expect(hopAdjustment(2, 5 * 60 * 1000, 1)).toBe(8);
    expect(hopAdjustment(5, 5 * 60 * 1000, 1)).toBe(2);
    expect(hopAdjustment(8, 30 * 60 * 1000, 0.95)).toBe(-1);
    expect(hopAdjustment(13, 2 * 60 * 60 * 1000, 0.72)).toBe(-6);

    expect(timeAdjustment(10 * 60 * 1000)).toBe(12);
    expect(timeAdjustment(60 * 60 * 1000)).toBe(10);
    expect(timeAdjustment(6 * 60 * 60 * 1000)).toBe(7);
    expect(timeAdjustment(24 * 60 * 60 * 1000)).toBe(4);
    expect(timeAdjustment(7 * 24 * 60 * 60 * 1000)).toBe(0);
    expect(timeAdjustment(30 * 24 * 60 * 60 * 1000)).toBe(-5);
    expect(timeAdjustment(31 * 24 * 60 * 60 * 1000)).toBe(-12);
    expect(timeAdjustment(null)).toBe(0);

    expect(amountContinuityAdjustment(0.95)).toBe(8);
    expect(amountContinuityAdjustment(0.9)).toBe(6);
    expect(amountContinuityAdjustment(0.7)).toBe(3);
    expect(amountContinuityAdjustment(0.4)).toBe(-6);
    expect(amountContinuityAdjustment(0.39)).toBe(-12);
  });

  it("uses explicit path link strength when present and clamps computed values", () => {
    expect(scorePathLinkStrength(path({ linkStrength: 0.4 }))).toBe(0.4);
    expect(scorePathLinkStrength(path({
      pathAddresses: [source, subject],
      steps: [
        {
          txHash: "tx-direct",
          fromAddress: source,
          toAddress: subject,
          amountRaw: "15000000000",
          timestamp: "2026-05-31T10:00:00.000Z"
        }
      ],
      amountPreservationRatio: 1,
      timeSpanMs: 5 * 60 * 1000
    }))).toBe(1.25);
    expect(scorePathLinkStrength(path({
      amountPreservationRatio: 0.1,
      timeSpanMs: 45 * 24 * 60 * 60 * 1000,
      steps: []
    }))).toBeGreaterThanOrEqual(0.25);
  });

  it("scores HTX 15 percent on an operational liquidity wallet as weighted context", () => {
    const result = scoreSourceExposures({
      originPaths: [path()],
      walletRole: "operational_liquidity_wallet",
      operationalLiquidityScore: 90,
      cleanCexCoverage: 0.75,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    const htx = result.sourcePolicyEvidence.find((item) => item.kind === "htx_huobi");
    expect(htx).toBeDefined();
    expect(htx?.score).toBeGreaterThan(0);
    expect(htx?.score).toBeLessThan(60);
    expect(htx?.riskBand).toBe("LOW-MEDIUM");
    expect(htx?.proofLevel).toBe("exchange_policy_context");
    expect(result.sourcePolicyScore).toBeLessThan(60);
  });

  it("caps HTX 15 percent on a risky direct fast path as context", () => {
    const directFast = path({
      pathAddresses: [source, subject],
      steps: [
        {
          txHash: "tx-direct",
          fromAddress: source,
          toAddress: subject,
          amountRaw: "15000000000",
          timestamp: "2026-05-31T10:00:00.000Z"
        }
      ],
      amountPreservationRatio: 1,
      timeSpanMs: 5 * 60 * 1000
    });

    const result = scoreSourceExposures({
      originPaths: [directFast],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 }
    });

    expect(result.sourcePolicyScore).toBeLessThanOrEqual(55);
    expect(result.sourcePolicyEvidence[0]?.proofLevel).toBe("exchange_policy_context");
  });

  it("keeps majority HTX as high source-policy decline", () => {
    const result = scoreSourceExposures({
      originPaths: [path({ balanceShare: 0.62, amountPreservationRatio: 0.98 })],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeGreaterThanOrEqual(78);
    expect(result.sourcePolicyEvidence[0]?.proofLevel).toBe("exchange_policy_decline");
  });

  it("does not apply the HTX critical floor when attributed share is low", () => {
    const staleRawHtx = path({
      balanceShare: 0.85,
      amountPreservationRatio: 0.1,
      linkStrength: 0.25
    });

    const result = scoreSourceExposures({
      originPaths: [staleRawHtx],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000"
    });

    const htx = result.sourcePolicyEvidence.find((item) => item.kind === "htx_huobi");
    expect(htx).toBeDefined();
    expect(htx?.shareDetail?.rawShare).toBeCloseTo(0.85);
    expect(htx?.shareDetail?.effectiveShare).toBeCloseTo(0.02125);
    expect(htx?.score).toBeLessThan(85);
    expect(htx?.riskBand).not.toBe("CRITICAL");
  });

  it("does not let explicit link strength bypass weak HTX amount preservation", () => {
    const weakPreservationHtx = path({
      balanceShare: 0.85,
      amountPreservationRatio: 0.1,
      linkStrength: 1
    });

    const result = scoreSourceExposures({
      originPaths: [weakPreservationHtx],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000"
    });

    const htx = result.sourcePolicyEvidence.find((item) => item.kind === "htx_huobi");
    expect(htx).toBeDefined();
    expect(htx?.shareDetail?.rawShare).toBeCloseTo(0.85);
    expect(htx?.shareDetail?.effectiveShare).toBeCloseTo(0.085);
    expect(htx?.score).toBeLessThan(85);
    expect(htx?.riskBand).not.toBe("CRITICAL");
  });

  it("weights exact affected amount by bundle branch share", () => {
    const splitHtx = path({
      balanceShare: 0.25,
      amountPreservationRatio: 1,
      linkStrength: 1,
      amountUsage: {
        anchorAmountRaw: "100000000",
        originalAmountRaw: "100000000",
        usedAmountRaw: "100000000",
        coverageShare: 1,
        role: "funding_candidate"
      }
    });

    const result = scoreSourceExposures({
      originPaths: [splitHtx],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "100000000"
    });

    const htx = result.sourcePolicyEvidence.find((item) => item.kind === "htx_huobi");
    expect(htx?.shareDetail?.rawShare).toBeCloseTo(0.25);
    expect(htx?.shareDetail?.affectedAmountRaw).toBe("25000000");
  });

  it("keeps dominant fresh HTX as critical source-policy decline", () => {
    const freshDominantHtx = path({
      balanceShare: 0.85,
      amountPreservationRatio: 1,
      linkStrength: 1
    });

    const result = scoreSourceExposures({
      originPaths: [freshDominantHtx],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000"
    });

    const htx = result.sourcePolicyEvidence.find((item) => item.kind === "htx_huobi");
    expect(htx).toBeDefined();
    expect(htx?.shareDetail?.rawShare).toBeCloseTo(0.85);
    expect(htx?.shareDetail?.effectiveShare).toBeCloseTo(0.85);
    expect(htx?.score).toBeGreaterThanOrEqual(85);
    expect(htx?.riskBand).toBe("CRITICAL");
    expect(htx?.proofLevel).toBe("exchange_policy_decline");
  });

  it("does not let majority bridge raw share bypass weak amount preservation", () => {
    const weakPreservationBridge = path({
      balanceShare: 0.85,
      amountPreservationRatio: 0.1,
      linkStrength: 1,
      exposureSourceKey: "bridge_router_dex",
      exposureSourceLabel: "Bridge",
      sourceExposureKind: "bridge_router_dex",
      reasons: ["Bridge source-policy exposure."]
    });

    const result = scoreSourceExposures({
      originPaths: [weakPreservationBridge],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000"
    });

    const bridge = result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(bridge).toBeDefined();
    expect(bridge?.shareDetail?.rawShare).toBeCloseTo(0.85);
    expect(bridge?.shareDetail?.effectiveShare).toBeCloseTo(0.085);
    expect(bridge?.score).toBeLessThan(60);
    expect(bridge?.proofLevel).toBe("exchange_policy_context");
  });

  it("caps weak amount continuity below hard-like scores", () => {
    const weak = path({
      balanceShare: 0.25,
      amountPreservationRatio: 0.15,
      timeSpanMs: 20 * 60 * 1000,
      steps: [
        {
          txHash: "tx-source-hop",
          fromAddress: source,
          toAddress: hop,
          amountRaw: "100000000000",
          timestamp: "2026-05-31T10:00:00.000Z"
        },
        {
          txHash: "tx-hop-subject",
          fromAddress: hop,
          toAddress: subject,
          amountRaw: "5000000000",
          timestamp: "2026-05-31T10:20:00.000Z"
        }
      ]
    });

    const result = scoreSourceExposures({
      originPaths: [weak],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeLessThanOrEqual(55);
    expect(result.sourcePolicyEvidence[0]?.proofLevel).toBe("exchange_policy_context");
  });

  it("does not let multiple weak source scores explode", () => {
    expect(aggregateLayerScores([52, 38, 35])).toBe(59);
  });

  it("keeps WhiteBIT medium-ish and below HTX hard policy", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 0.35,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          reasons: ["WhiteBIT source-policy exposure."]
        })
      ],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeGreaterThanOrEqual(45);
    expect(result.sourcePolicyScore).toBeLessThan(60);
    expect(result.sourcePolicyEvidence[0]?.proofLevel).toBe("exchange_policy_context");
  });

  it("lets majority WhiteBIT become a capped source-policy decline", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 0.62,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          reasons: ["WhiteBIT source-policy exposure."]
        })
      ],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeGreaterThanOrEqual(60);
    expect(result.sourcePolicyScore).toBeLessThanOrEqual(68);
    expect(result.sourcePolicyEvidence[0]?.proofLevel).toBe("exchange_policy_decline");
  });

  it("recognizes source exposure keys when typed kind is missing", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: null,
          sourceExposureKind: null,
          reasons: []
        }),
        path({
          exposureSourceKey: "cross_chain_boundary",
          exposureSourceLabel: null,
          sourceExposureKind: null,
          reasons: []
        }),
        path({
          exposureSourceKey: "unknown_cex",
          exposureSourceLabel: null,
          sourceExposureKind: null,
          reasons: []
        })
      ],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyEvidence.map((item) => item.kind).sort()).toEqual([
      "bridge_router_dex",
      "cross_chain_boundary",
      "unknown_cex"
    ]);
  });

  it("accepts coverage and confidence as ratios or 0-100 scores", () => {
    const ratioResult = scoreSourceExposures({
      originPaths: [path()],
      walletRole: "operational_liquidity_wallet",
      operationalLiquidityScore: 90,
      cleanCexCoverage: 0.75,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });
    const scoreResult = scoreSourceExposures({
      originPaths: [path()],
      walletRole: "operational_liquidity_wallet",
      operationalLiquidityScore: 90,
      cleanCexCoverage: 0.75,
      coverageCompleteness: 90,
      provenanceConfidence: 80,
      ageSignals: noAgeSignals
    });

    expect(scoreResult.sourcePolicyScore).toBe(ratioResult.sourcePolicyScore);
  });

  it("does not turn tiny bridge exposure into critical risk", () => {
    const directFastBridge = path({
      balanceShare: 0.001,
      exposureSourceKey: "bridge_router_dex",
      exposureSourceLabel: "Bridge",
      sourceExposureKind: "bridge_router_dex",
      pathAddresses: [source, subject],
      steps: [
        {
          txHash: "tx-direct-bridge",
          fromAddress: source,
          toAddress: subject,
          amountRaw: "1000000",
          timestamp: "2026-05-31T10:00:00.000Z"
        }
      ],
      amountPreservationRatio: 1,
      timeSpanMs: 5 * 60 * 1000,
      reasons: ["Bridge source-policy exposure."]
    });

    const result = scoreSourceExposures({
      originPaths: [directFastBridge],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 }
    });

    expect(result.sourcePolicyScore).toBeLessThan(60);
    expect(result.sourcePolicyEvidence[0]?.riskBand).not.toBe("CRITICAL");
  });

  it("emits amount-weighted source-policy share details", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 4060 / 46000,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          reasons: ["Bridge source-policy exposure."]
        })
      ],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000"
    });

    const bridge = result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(Object.keys(bridge?.shareDetail ?? {}).sort()).toEqual([
      "affectedAmountRaw",
      "dataQualityAdjustment",
      "effectiveShare",
      "finalContribution",
      "pathContextAdjustment",
      "rawShare",
      "repeatedExposureAdjustment",
      "scope",
      "shareCap",
      "shareFloor",
      "sourceSeverity",
      "targetAmountRaw",
      "valueWeightedRaw",
      "walletRoleAdjustment"
    ]);
    expect(bridge?.shareDetail).toMatchObject({
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000",
      affectedAmountRaw: "4060000000",
      sourceSeverity: 65,
      pathContextAdjustment: 25,
      repeatedExposureAdjustment: 0,
      dataQualityAdjustment: 0,
      walletRoleAdjustment: 0,
      shareFloor: 0,
      shareCap: 30,
      finalContribution: 30
    });
    expect(bridge?.shareDetail?.rawShare).toBeCloseTo(0.0882608);
    expect(bridge?.shareDetail?.effectiveShare).toBeCloseTo(0.0995457);
    expect(bridge?.shareDetail?.valueWeightedRaw).toBeCloseTo(6.4705);
    expect(result.riskLayers[0]?.shareDetail).toEqual(bridge?.shareDetail);
  });

  it("applies amount-share caps to bridge and unknown source-policy scores", () => {
    const scoreFor = (kind: SourceExposureKind, share: number): number => {
      const result = scoreSourceExposures({
        originPaths: [
          path({
            balanceShare: share,
            exposureSourceKey: kind,
            exposureSourceLabel: kind,
            sourceExposureKind: kind,
            reasons: [`${kind} source-policy exposure.`]
          })
        ],
        walletRole: "risky_source_wallet",
        operationalLiquidityScore: 0,
        cleanCexCoverage: 0,
        coverageCompleteness: 0.9,
        provenanceConfidence: 0.8,
        ageSignals: { ...noAgeSignals, subjectAgeDays: 1 }
      });

      return result.sourcePolicyScore;
    };

    expect(scoreFor("bridge_router_dex", 40 / 46000)).toBeLessThanOrEqual(10);
    expect(scoreFor("bridge_router_dex", 4060 / 46000)).toBeLessThanOrEqual(30);
    expect(scoreFor("bridge_router_dex", 0.65)).toBeGreaterThanOrEqual(60);
    expect(scoreFor("bridge_router_dex", 0.65)).toBeLessThanOrEqual(70);
    expect(scoreFor("unknown_contract", 4060 / 46000)).toBeLessThanOrEqual(25);
    expect(scoreFor("unknown_cex", 0.15)).toBeLessThanOrEqual(35);
  });

  it("counts duplicate source-policy tx amount once per kind", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 0.06,
          txHashes: ["tx-shared"],
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          reasons: ["Bridge source-policy exposure."]
        }),
        path({
          balanceShare: 0.06,
          txHashes: ["tx-shared"],
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          reasons: ["Duplicate bridge source-policy exposure."]
        })
      ],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals,
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000"
    });

    const bridge = result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(bridge?.aggregateShare).toBeCloseTo(0.06);
    expect(bridge?.shareDetail?.affectedAmountRaw).toBe("2760000000");
  });

  it("keeps unknown contracts capped as contextual source-policy evidence", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 0.7,
          exposureSourceKey: "unknown_contract",
          exposureSourceLabel: "Unknown contract",
          sourceExposureKind: "unknown_contract",
          reasons: ["Unknown contract source-policy exposure."]
        })
      ],
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 0.9,
      provenanceConfidence: 0.8,
      ageSignals: noAgeSignals
    });

    expect(result.sourcePolicyScore).toBeLessThanOrEqual(55);
    expect(result.sourcePolicyEvidence[0]).toMatchObject({
      kind: "unknown_contract",
      proofLevel: "exchange_policy_context",
      canBeDampened: true
    });
    expect(result.riskLayers[0]).toMatchObject({
      evidenceClass: "source_policy",
      sourceExposureKind: "unknown_contract",
      proofLevel: "exchange_policy_context"
    });
  });

  it("keeps cross-chain terminal source-policy kinds high and non-dampened", () => {
    const highRiskKinds: Array<{
      kind: SourceExposureKind;
      minimumScore: number;
    }> = [
      { kind: "no_name_token_liquidity", minimumScore: 70 },
      { kind: "mixer", minimumScore: 78 },
      { kind: "sanctioned_service", minimumScore: 95 }
    ];

    for (const { kind, minimumScore } of highRiskKinds) {
      const result = scoreSourceExposures({
        originPaths: [
          path({
            balanceShare: 0.15,
            exposureSourceKey: kind,
            exposureSourceLabel: kind,
            sourceExposureKind: null,
            reasons: [`${kind} terminal boundary.`]
          })
        ],
        walletRole: "operational_liquidity_wallet",
        operationalLiquidityScore: 95,
        cleanCexCoverage: 0.95,
        coverageCompleteness: 0.9,
        provenanceConfidence: 0.8,
        ageSignals: noAgeSignals
      });

      const evidence = result.sourcePolicyEvidence.find((item) => item.kind === kind);
      expect(evidence).toBeDefined();
      expect(evidence?.score).toBeGreaterThanOrEqual(minimumScore);
      expect(evidence?.canBeDampened).toBe(false);
      expect(result.riskLayers.find((layer) => layer.sourceExposureKind === kind)).toMatchObject({
        evidenceClass: "source_policy",
        canBeDampened: false
      });
    }
  });
});
