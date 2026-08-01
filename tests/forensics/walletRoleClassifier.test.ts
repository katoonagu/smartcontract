import { describe, expect, it } from "vitest";
import { buildWalletRoleProfile } from "../../src/forensics/walletRoleClassifier";
import type {
  AddressBehaviorProfile,
  ApprovalDrainProvenanceProfile,
  ServiceClassification,
  ServiceExposureProfile
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";

function behavior(overrides: Partial<AddressBehaviorProfile>): AddressBehaviorProfile {
  return {
    subjectAddress: subject,
    incomingVolumeRaw: "0",
    outgoingVolumeRaw: "0",
    incomingTxCount: 0,
    outgoingTxCount: 0,
    uniqueIncomingCounterparties: 0,
    uniqueOutgoingCounterparties: 0,
    largestIncomingRaw: null,
    largestOutgoingRaw: null,
    topOutgoingCounterpartyAddress: null,
    topOutgoingCounterpartyRaw: null,
    topOutgoingCounterpartyTxCount: 0,
    topOutgoingCounterpartyRatio: 0,
    inflowToOutflowRatio: null,
    drainToServiceRatio: 0,
    timeToFirstOutgoingMs: null,
    timeToFirstServiceExitMs: null,
    depositThenDrainScore: 0,
    transitScore: 0,
    dampenerScore: 0,
    features: [],
    ...overrides
  };
}

function service(overrides: Partial<ServiceExposureProfile>): ServiceExposureProfile {
  return {
    subjectAddress: subject,
    totalOutgoingRaw: "0",
    totalOutgoingCount: 0,
    directServiceVolumeRatio: 0,
    directServiceTxRatio: 0,
    indirectServiceVolumeRatio: 0,
    indirectServiceTxRatio: 0,
    mergedServiceVolumeRatio: 0,
    mergedServiceGroupCount: 0,
    combinedServiceVolumeRatio: 0,
    combinedServiceTxRatio: 0,
    dominantCategory: null,
    categoryBreakdown: [],
    topServiceCounterparties: [],
    topMergedServiceFlows: [],
    fastestServiceExitMs: null,
    bestAmountPreservationRatio: null,
    exposureScore: 0,
    features: [],
    ...overrides
  };
}

function approval(overrides: Partial<ApprovalDrainProvenanceProfile>): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: "TVictim1111111111111111111111111111111",
    approvalTxHash: "approval-tx",
    drainTxHash: "drain-tx",
    spenderAddress: "TSpender111111111111111111111111111111",
    firstReceiverAddress: subject,
    subjectAddress: subject,
    hopDepth: 0,
    amountRaw: "100000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-05-25T09:59:00.000Z",
    drainAt: "2026-05-25T10:00:00.000Z",
    pathTxHashes: ["drain-tx"],
    pathAddresses: [subject],
    score: 90,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

const htx: ServiceClassification = {
  category: "cex",
  identity: "HTX",
  confidence: "high",
  evidence: ["metadata_exchange_tag"],
  isBoundary: true
};

describe("buildWalletRoleProfile", () => {
  it("classifies exact first receiver from approval-drain provenance", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [approval({})],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("first_receiver");
    expect(profile.evidenceStrength).toBe("exact");
    expect(profile.roles[0]).toMatchObject({ role: "first_receiver", confidence: "high" });
  });

  it("classifies collector-like behavior without making exact claims", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: behavior({
        uniqueIncomingCounterparties: 8,
        uniqueOutgoingCounterparties: 1,
        topOutgoingCounterpartyRatio: 0.88,
        transitScore: 25,
        features: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet", scoreImpact: 20 }]
      }),
      serviceExposureProfile: service({ combinedServiceVolumeRatio: 0.75, exposureScore: 30 }),
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("collector");
    expect(profile.evidenceStrength).toBe("strong_behavior");
  });

  it("classifies known service boundary as cashout service context", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: htx
    });

    expect(profile.primaryRole).toBe("cashout_service");
    expect(profile.evidenceStrength).toBe("context");
  });

  it("keeps known service boundary primary over collector-like behavior", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: behavior({
        uniqueIncomingCounterparties: 12,
        uniqueOutgoingCounterparties: 1,
        topOutgoingCounterpartyRatio: 0.92,
        dampenerScore: 30,
        features: [
          { code: "known_service_or_treasury_dampener", label: "Known service/treasury dampener", scoreImpact: -30 },
          { code: "address_behavior_collector_like_wallet", label: "Collector-like wallet", scoreImpact: 55 }
        ]
      }),
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: htx
    });

    expect(profile.primaryRole).toBe("cashout_service");
    expect(profile.roles.map((role) => role.role)).not.toContain("collector");
    expect(profile.roles.map((role) => role.role)).not.toContain("mule");
  });

  it("keeps known service boundary primary over fast service redistribution", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: behavior({
        depositThenDrainScore: 30,
        transitScore: 20,
        drainToServiceRatio: 0.8,
        timeToFirstServiceExitMs: 15 * 60 * 1000
      }),
      serviceExposureProfile: service({
        combinedServiceVolumeRatio: 0.8,
        bestAmountPreservationRatio: 0.9,
        exposureScore: 40
      }),
      boundaryExposureProfile: null,
      subjectClassification: htx
    });

    expect(profile.primaryRole).toBe("cashout_service");
    expect(profile.roles.map((role) => role.role)).not.toContain("mule");
  });

  it("keeps treasury dampener primary over behavior-only collector or mule roles", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: behavior({
        uniqueIncomingCounterparties: 10,
        uniqueOutgoingCounterparties: 1,
        topOutgoingCounterpartyRatio: 0.9,
        depositThenDrainScore: 35,
        transitScore: 45,
        dampenerScore: 50,
        features: [
          { code: "long_lived_high_activity_wallet_dampener", label: "Long-lived high-activity wallet dampener", scoreImpact: -50 },
          { code: "address_behavior_collector_like_wallet", label: "Collector-like wallet", scoreImpact: 55 },
          { code: "address_behavior_transit", label: "Transit-like wallet", scoreImpact: 45 }
        ]
      }),
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("treasury_like");
    expect(profile.roles.map((role) => role.role)).not.toContain("collector");
    expect(profile.roles.map((role) => role.role)).not.toContain("mule");
  });

  it("classifies victim separately from dirty receiver roles", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [
        approval({
          victimAddress: subject,
          firstReceiverAddress: "TReceiver11111111111111111111111111111",
          subjectAddress: subject
        })
      ],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("victim");
    expect(profile.roles.some((role) => role.role === "first_receiver")).toBe(false);
  });

  it("does not case-fold TRON addresses when assigning exact roles", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject.toLowerCase(),
      approvalDrainProfiles: [approval({})],
      addressBehaviorProfile: null,
      serviceExposureProfile: null,
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("unknown");
  });

  it("does not classify slow ordinary service usage as a mule", () => {
    const profile = buildWalletRoleProfile({
      subjectAddress: subject,
      approvalDrainProfiles: [],
      addressBehaviorProfile: behavior({
        timeToFirstServiceExitMs: 48 * 60 * 60 * 1000,
        drainToServiceRatio: 0.1
      }),
      serviceExposureProfile: service({ combinedServiceVolumeRatio: 0.55, bestAmountPreservationRatio: 0.2 }),
      boundaryExposureProfile: null,
      subjectClassification: null
    });

    expect(profile.primaryRole).toBe("unknown");
  });
});
