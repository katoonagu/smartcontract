import { describe, expect, it } from "vitest";
import type {
  IncomingDepositRiskReport,
  IncomingDepositUnifiedRiskSummary,
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile
} from "../../src/types";

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
