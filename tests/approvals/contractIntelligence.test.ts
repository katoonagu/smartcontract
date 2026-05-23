import { describe, expect, it } from "vitest";
import {
  contractIntelligenceReasons,
  deriveActivityLevel,
  isSuspiciousUnknownContractProfile,
  serviceTagFromContractProfile
} from "../../src/approvals/contractIntelligence";

describe("contract intelligence policy helpers", () => {
  it("uses service tags rather than names as service identity", () => {
    expect(
      serviceTagFromContractProfile({
        name: "SwapTRX",
        serviceTag: null,
        publicTag: null,
        publicTagDesc: null,
        verified: false,
        providerRisk: false,
        trxCount: "91",
        totalCallCount: "1",
        uniqueCallerCount: "1",
        topMethods: [],
        methodMap: {},
        hasTransferFromSelector: true,
        hasOwnerOnlyPattern: true,
        lowMetadata: true,
        activityLevel: "low"
      })
    ).toBeNull();

    expect(
      serviceTagFromContractProfile({
        name: "Bridgers",
        serviceTag: "Bridgers:Cross-chain Bridge",
        publicTag: "Bridgers:Cross-chain Bridge",
        publicTagDesc: null,
        verified: true,
        providerRisk: false,
        trxCount: "4380107",
        totalCallCount: "224309",
        uniqueCallerCount: "45552",
        topMethods: [{ methodId: "d9caed12", signature: "withdraw(address,address,uint256)", count: 85070, ratio: 0.3793, method: "withdraw(address,address,uint256)", calls: 85070, percentage: 0.3793 }],
        methodMap: {},
        hasTransferFromSelector: false,
        hasOwnerOnlyPattern: false,
        lowMetadata: false,
        activityLevel: "high"
      })
    ).toBe("Bridgers:Cross-chain Bridge");
  });

  it("flags tokenApprove-like untagged pull-capable contracts as suspicious review candidates", () => {
    const profile = {
      name: "tokenApprove",
      serviceTag: null,
      publicTag: null,
      publicTagDesc: null,
      verified: false,
      providerRisk: false,
      trxCount: "2",
      totalCallCount: null,
      uniqueCallerCount: null,
      topMethods: [],
      methodMap: {},
      hasTransferFromSelector: true,
      hasOwnerOnlyPattern: true,
      lowMetadata: true,
      activityLevel: "low" as const
    };

    expect(isSuspiciousUnknownContractProfile(profile)).toBe(true);
    expect(contractIntelligenceReasons(profile).map((reason) => reason.code)).toEqual([
      "contract_intel_low_metadata",
      "contract_intel_transferfrom_capable",
      "contract_intel_owner_only_pull_pattern"
    ]);
  });

  it("derives high activity from TronScan call statistics", () => {
    expect(deriveActivityLevel({ trxCount: 4_380_107, totalCallCount: 224_309, uniqueCallerCount: 45_552, topMethods: [] })).toBe("high");
    expect(deriveActivityLevel({ trxCount: 2, totalCallCount: 0, uniqueCallerCount: 0, topMethods: [] })).toBe("low");
  });
});
