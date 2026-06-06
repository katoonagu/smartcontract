import { describe, expect, it } from "vitest";
import type {
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

    expect(fresh.dominantFreshSource).toBe("htx_huobi");
    expect(profile.scoreContribution).toBe(14);
  });
});
