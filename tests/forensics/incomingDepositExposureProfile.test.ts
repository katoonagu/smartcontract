import { describe, expect, it } from "vitest";
import {
  buildIncomingFreshBundleExposure,
  buildIncomingWalletExposureProfile
} from "../../src/forensics/incomingDepositExposureProfile";
import type {
  ForensicRouteEdge,
  IncomingDepositOriginPath,
  IncomingDepositRiskReport,
  IncomingDepositUnifiedRiskSummary,
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
  ServiceClassification
} from "../../src/types";

function originPath(overrides: Partial<IncomingDepositOriginPath>): IncomingDepositOriginPath {
  return {
    verdict: "ACCEPTABLE",
    score: 5,
    sourcePolicy: "unknown",
    stoppedReason: "no_previous_transfer",
    pathAddresses: ["TSender", "TReceiver"],
    txHashes: ["deposit-tx"],
    steps: [],
    amountCoverageRatio: 1,
    amountContinuity: "strong",
    proximityHops: 1,
    reasons: [],
    ...overrides
  };
}

function edge(overrides: Partial<ForensicRouteEdge>): ForensicRouteEdge {
  return {
    id: overrides.txHash ?? "tx",
    txHash: "tx",
    fromAddress: "TFrom",
    toAddress: "TTo",
    amountRaw: "1000000",
    timestamp: new Date("2026-06-02T00:00:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer",
    ...overrides
  };
}

const classifications = new Map<string, ServiceClassification>([
  [
    "THTX",
    {
      category: "cex",
      identity: "HTX 4",
      confidence: "high",
      evidence: ["metadata:HTX"],
      isBoundary: true
    }
  ],
  [
    "TClean",
    {
      category: "cex",
      identity: "Binance",
      confidence: "high",
      evidence: ["metadata:clean-cex"],
      isBoundary: true
    }
  ],
  [
    "THTXTag",
    {
      category: "cex",
      identity: null,
      confidence: "high",
      evidence: ["tag:htx_huobi"],
      isBoundary: true
    }
  ],
  [
    "TWhiteBIT",
    {
      category: "cex",
      identity: "WhiteBIT",
      confidence: "high",
      evidence: ["metadata:whitebit"],
      isBoundary: true
    }
  ],
  [
    "TBridge",
    {
      category: "bridge",
      identity: "Stargate",
      confidence: "high",
      evidence: ["metadata:bridge"],
      isBoundary: true
    }
  ],
  [
    "TUnknownContract",
    {
      category: "unknown_contract",
      identity: null,
      confidence: "medium",
      evidence: ["metadata:contract"],
      isBoundary: true
    }
  ]
]);

describe("incoming deposit exposure profile types", () => {
  it("supports persisted fresh source and wallet background breakdowns", () => {
    const fresh: IncomingFreshBundleExposure = {
      targetAmountRaw: "100000000000",
      htxHuobiShare: 0.8,
      cleanCexShare: 0.1,
      bridgeRouterDexShare: 0,
      unknownContractShare: 0,
      riskyLabelShare: 0,
      unknownShare: 0.1,
      dominantFreshSource: "htx_huobi",
      reasons: ["HTX/Huobi materially funds the checked deposit."]
    };

    const profile: IncomingWalletExposureProfile = {
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-04T12:58:54.000Z",
      transferEventsScanned: 50,
      incomingVolumeRaw: "500000000000",
      outgoingVolumeRaw: "450000000000",
      htxHuobiIncomingShare: 0.4,
      cleanCexIncomingShare: 0.2,
      bridgeRouterDexVolumeShare: 0.1,
      unknownContractVolumeShare: 0,
      unknownSourceShare: 0.3,
      inOutVelocityScore: 6,
      scoreContribution: 14,
      reasons: ["Historical HTX/Huobi exposure is material."],
      warnings: []
    };

    const unifiedSummary: IncomingDepositUnifiedRiskSummary = {
      finalScore: 42,
      finalLevel: "MEDIUM",
      finalDecision: "ACCEPTABLE",
      hardEvidenceFloor: 0,
      policyFloor: 0,
      assetContinuationFloor: 0,
      patternFloor: 0,
      freshBundleFloor: 25,
      corridorFloor: 35,
      backgroundScore: 14,
      dampener: 0,
      activeAnchor: null
    };

    const report: IncomingDepositRiskReport = {
      decision: "ACCEPTABLE",
      depositRiskScore: 42,
      riskBand: "MEDIUM",
      fastSenderRisk: null,
      originPaths: [],
      originCoverage: 0,
      fundingCoverage: {
        depositFundingCoverageRatio: 0,
        cleanSourceCoverageRatio: 0,
        exactContinuityCoverageRatio: 0
      },
      corridorSummary: null,
      provenanceConfidence: 1,
      dataQuality: "high",
      senderRole: null,
      hardBadEvidence: [],
      contractVerdicts: [],
      freshBundleExposure: fresh,
      walletExposureProfile: profile,
      unifiedRiskSummary: unifiedSummary,
      reasons: [],
      warnings: []
    };

    expect(fresh.dominantFreshSource).toBe("htx_huobi");
    expect(profile.scoreContribution).toBe(14);
    expect(report.freshBundleExposure?.targetAmountRaw).toBe("100000000000");
    expect(report.walletExposureProfile?.scoreContribution).toBe(14);
    expect(report.unifiedRiskSummary?.freshBundleFloor).toBe(25);
    expect(report.unifiedRiskSummary?.corridorFloor).toBe(35);
    expect(report.unifiedRiskSummary?.backgroundScore).toBe(14);
  });
});

describe("buildIncomingFreshBundleExposure", () => {
  it("preserves incoming fresh shape for HTX and clean CEX source shares", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({
          stoppedReason: "htx_huobi_reached",
          sourcePolicy: "hard_decline",
          balanceShare: 0.49,
          txHashes: ["tx-htx"]
        }),
        originPath({
          stoppedReason: "clean_cex_reached",
          sourcePolicy: "clean",
          balanceShare: 0.51,
          txHashes: ["tx-clean"]
        })
      ]
    });

    expect(exposure).toMatchObject({
      targetAmountRaw: "100000000000",
      bridgeRouterDexShare: 0,
      unknownContractShare: 0,
      riskyLabelShare: 0,
      unknownShare: 0,
      dominantFreshSource: "clean_cex"
    });
    expect(exposure.htxHuobiShare).toBeCloseTo(0.49);
    expect(exposure.cleanCexShare).toBeCloseTo(0.51);
    expect(exposure.reasons.join(" ")).toContain("checked-deposit source share");
  });

  it("sums checked-deposit balance shares by stopped source type", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({ stoppedReason: "htx_huobi_reached", sourcePolicy: "hard_decline", balanceShare: 0.8 }),
        originPath({ stoppedReason: "clean_cex_reached", sourcePolicy: "clean", balanceShare: 0.2 })
      ]
    });

    expect(exposure.htxHuobiShare).toBeCloseTo(0.8);
    expect(exposure.cleanCexShare).toBeCloseTo(0.2);
    expect(exposure.dominantFreshSource).toBe("htx_huobi");
  });

  it("ignores zero balance shares and assigns missing coverage to unknown", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({ stoppedReason: "htx_huobi_reached", sourcePolicy: "hard_decline", balanceShare: 0 }),
        originPath({ stoppedReason: "clean_cex_reached", sourcePolicy: "clean", balanceShare: 0.19 })
      ]
    });

    expect(exposure.htxHuobiShare).toBe(0);
    expect(exposure.cleanCexShare).toBeCloseTo(0.19);
    expect(exposure.unknownShare).toBeCloseTo(0.81);
    expect(exposure.dominantFreshSource).toBe("unknown");
  });

  it("maps bridge, unknown-contract, risky-label, and fallback paths", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({ stoppedReason: "bridge_router_dex_reached", balanceShare: 0.15 }),
        originPath({ stoppedReason: "unknown_contract_reached", balanceShare: 0.1 }),
        originPath({ stoppedReason: "risky_label_reached", balanceShare: 0.05 }),
        originPath({ stoppedReason: "data_budget_exhausted", balanceShare: 0.25 })
      ]
    });

    expect(exposure.bridgeRouterDexShare).toBeCloseTo(0.15);
    expect(exposure.unknownContractShare).toBeCloseTo(0.1);
    expect(exposure.riskyLabelShare).toBeCloseTo(0.05);
    expect(exposure.unknownShare).toBeCloseTo(0.7);
    expect(exposure.dominantFreshSource).toBe("unknown");
    expect(exposure.reasons.join(" ")).toContain("Observed unknown source paths");
  });

  it("keeps data-budget-exhausted source coverage in unknown", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({
          stoppedReason: "data_budget_exhausted",
          balanceShare: 0.4,
          txHashes: ["tx-budget"]
        })
      ]
    });

    expect(exposure.unknownShare).toBe(1);
    expect(exposure.htxHuobiShare).toBe(0);
    expect(exposure.bridgeRouterDexShare).toBe(0);
    expect(exposure.reasons.join(" ")).toContain("Uncovered checked-deposit source share");
    expect(exposure.reasons.join(" ")).not.toContain("Uncovered selected source share");
  });

  it("keeps WhiteBIT fresh source policy context in unknown without treating it as clean", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({ stoppedReason: "whitebit_reached", sourcePolicy: "hard_decline", balanceShare: 0.4 })
      ]
    });

    expect(exposure.cleanCexShare).toBe(0);
    expect(exposure.unknownShare).toBeCloseTo(1);
    expect(exposure.reasons.join(" ")).toContain("WhiteBIT");
    expect(exposure.reasons.join(" ")).toContain("source-policy context");
  });

  it("normalizes overlapping balance shares so category shares do not exceed one", () => {
    const exposure = buildIncomingFreshBundleExposure({
      targetAmountRaw: "100000000000",
      originPaths: [
        originPath({ stoppedReason: "htx_huobi_reached", balanceShare: 0.8 }),
        originPath({ stoppedReason: "clean_cex_reached", balanceShare: 0.8 })
      ]
    });

    const totalShare = exposure.htxHuobiShare +
      exposure.cleanCexShare +
      exposure.bridgeRouterDexShare +
      exposure.unknownContractShare +
      exposure.riskyLabelShare +
      exposure.unknownShare;

    expect(totalShare).toBeLessThanOrEqual(1);
    expect(exposure.htxHuobiShare).toBeCloseTo(0.5);
    expect(exposure.cleanCexShare).toBeCloseTo(0.5);
    expect(exposure.unknownShare).toBe(0);
  });
});

describe("buildIncomingWalletExposureProfile", () => {
  it("treats historical HTX/Huobi inflow as background exposure instead of fresh proof", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "htx-in", fromAddress: "THTX", toAddress: "TSender", amountRaw: "400000000000" }),
        edge({ txHash: "clean-in", fromAddress: "TClean", toAddress: "TSender", amountRaw: "100000000000" }),
        edge({ txHash: "sender-out", fromAddress: "TSender", toAddress: "TWatched", amountRaw: "100000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.htxHuobiIncomingShare).toBeCloseTo(0.8);
    expect(profile.cleanCexIncomingShare).toBeCloseTo(0.2);
    expect(profile.scoreContribution).toBeGreaterThanOrEqual(15);
    expect(profile.scoreContribution).toBeLessThanOrEqual(20);
    expect(profile.reasons.join(" ")).toContain("Historical HTX/Huobi");
  });

  it("detects HTX/Huobi evidence with token separators", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "htx-tag-in", fromAddress: "THTXTag", toAddress: "TSender", amountRaw: "300000000000" }),
        edge({ txHash: "clean-in", fromAddress: "TClean", toAddress: "TSender", amountRaw: "100000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.htxHuobiIncomingShare).toBeCloseTo(0.75);
    expect(profile.cleanCexIncomingShare).toBeCloseTo(0.25);
  });

  it("treats WhiteBIT wallet exposure as background unknown risk instead of clean CEX", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "whitebit-in", fromAddress: "TWhiteBIT", toAddress: "TSender", amountRaw: "300000000000" }),
        edge({ txHash: "clean-in", fromAddress: "TClean", toAddress: "TSender", amountRaw: "100000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.cleanCexIncomingShare).toBeCloseTo(0.25);
    expect(profile.unknownSourceShare).toBeCloseTo(0.75);
    expect(profile.reasons.join(" ")).toContain("WhiteBIT");
    expect(profile.reasons.join(" ")).toContain("background");
  });

  it("uses total sender-related volume for bridge, unknown-contract, and unknown source shares", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "bridge-in", fromAddress: "TBridge", toAddress: "TSender", amountRaw: "200000000000" }),
        edge({ txHash: "unknown-contract-in", fromAddress: "TUnknownContract", toAddress: "TSender", amountRaw: "100000000000" }),
        edge({ txHash: "unknown-in", fromAddress: "TUnclassified", toAddress: "TSender", amountRaw: "100000000000" }),
        edge({ txHash: "out", fromAddress: "TSender", toAddress: "TWatched", amountRaw: "100000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.incomingVolumeRaw).toBe("400000000000");
    expect(profile.outgoingVolumeRaw).toBe("100000000000");
    expect(profile.bridgeRouterDexVolumeShare).toBeCloseTo(0.4);
    expect(profile.unknownContractVolumeShare).toBeCloseTo(0.2);
    expect(profile.unknownSourceShare).toBeCloseTo(0.2);
  });

  it("caps score contribution at twenty for heavy mixed exposure", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "htx-in", fromAddress: "THTX", toAddress: "TSender", amountRaw: "900000000000" }),
        edge({ txHash: "bridge-in", fromAddress: "TBridge", toAddress: "TSender", amountRaw: "50000000000" }),
        edge({ txHash: "unknown-contract-in", fromAddress: "TUnknownContract", toAddress: "TSender", amountRaw: "50000000000" }),
        edge({ txHash: "sender-out", fromAddress: "TSender", toAddress: "TWatched", amountRaw: "1000000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.scoreContribution).toBe(20);
  });

  it("warns on classification lookup failure and invalid raw amounts", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({ txHash: "bad-in", fromAddress: "TLookupFails", toAddress: "TSender", amountRaw: "not-a-number" })
      ],
      getClassificationForAddress: async (address) => {
        if (address === "TLookupFails") throw new Error("lookup unavailable");
        return classifications.get(address) ?? null;
      }
    });

    expect(profile.incomingVolumeRaw).toBe("0");
    expect(profile.warnings.join(" ")).toContain("Classification lookup failed for TLookupFails");
    expect(profile.warnings.join(" ")).toContain("invalid raw amounts");
  });

  it("ignores transfers outside the exposure window", async () => {
    const profile = await buildIncomingWalletExposureProfile({
      sender: "TSender",
      watchedWallet: "TWatched",
      windowStart: new Date("2026-06-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-04T12:58:54.000Z"),
      edges: [
        edge({
          txHash: "old-htx-in",
          fromAddress: "THTX",
          toAddress: "TSender",
          amountRaw: "900000000000",
          timestamp: new Date("2026-05-31T23:59:59.000Z")
        }),
        edge({ txHash: "clean-in", fromAddress: "TClean", toAddress: "TSender", amountRaw: "100000000000" })
      ],
      getClassificationForAddress: async (address) => classifications.get(address) ?? null
    });

    expect(profile.transferEventsScanned).toBe(1);
    expect(profile.incomingVolumeRaw).toBe("100000000000");
    expect(profile.htxHuobiIncomingShare).toBe(0);
    expect(profile.cleanCexIncomingShare).toBe(1);
  });
});
