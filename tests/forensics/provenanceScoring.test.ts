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
    expect(baseShareScore("htx_huobi", 0.15)).toBe(45);
    expect(baseShareScore("htx_huobi", 0.62)).toBe(78);
    expect(baseShareScore("whitebit", 0.35)).toBe(52);
    expect(baseShareScore("bridge_router_dex", 0.25)).toBe(62);
    expect(baseShareScore("no_name_token_liquidity", 0.15)).toBe(74);
    expect(baseShareScore("mixer", 0.15)).toBe(78);
    expect(baseShareScore("sanctioned_service", 0.15)).toBe(95);
    expect(baseShareScore("unknown_contract", 0.25)).toBe(45);
    expect(baseShareScore("unknown_cex", 0.01)).toBe(40);
    expect(baseShareScore("allowlisted_cex", 1)).toBe(5);
    expect(baseShareScore("risky_label", 0.01)).toBe(90);

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

  it("scores HTX 15 percent on an operational liquidity wallet as medium context", () => {
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
    expect(htx?.score).toBeGreaterThanOrEqual(45);
    expect(htx?.score).toBeLessThan(60);
    expect(htx?.riskBand).toBe("MEDIUM");
    expect(htx?.proofLevel).toBe("exchange_policy_context");
    expect(result.sourcePolicyScore).toBeLessThan(60);
  });

  it("scores HTX 15 percent on a risky direct fast path near decline level", () => {
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

    expect(result.sourcePolicyScore).toBeGreaterThanOrEqual(60);
    expect(result.sourcePolicyScore).toBeLessThanOrEqual(75);
    expect(result.sourcePolicyEvidence[0]?.proofLevel).toBe("exchange_policy_decline");
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
