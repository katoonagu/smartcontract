import { describe, expect, it } from "vitest";
import { calculateUnifiedWalletRisk } from "../../src/risk/unifiedWalletRisk";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import type {
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  OperationalFlowProfile,
  RiskReport,
  StablecoinRestrictionProfile,
  WhereIsMoneyAssessment,
  WhereIsMoneyReport
} from "../../src/types";

const address = `T${"1".repeat(33)}`;

function coverageDebug(summaryOverrides: Partial<CoverageDebugReport["summary"]> = {}): CoverageDebugReport {
  return {
    jobId: null,
    subjectAddress: address,
    status: null,
    windowStart: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    summary: {
      sourceTransferPages: 2,
      transferEdges: 100,
      inboundSendersExpanded: 5,
      extendedIndexedEdges: 100,
      extendedFetchedAddresses: 60,
      apiKeyConfigured: true,
      thirtyDayTransferCount: null,
      historicalFallbackTransferCount: null,
      historicalFallbackRequestedLimit: null,
      directCounterpartyCount: 0,
      analyzedCounterpartyCount: 0,
      expandedCounterpartyCount: 0,
      metadataEnrichedCounterpartyCount: 0,
      skippedCounterpartyCount: 0,
      legacyPartial: false,
      ...summaryOverrides
    },
    rows: [],
    missingChecks: [],
    notes: []
  };
}

function limitedCoverageDebug(): CoverageDebugReport {
  return {
    ...coverageDebug({
      sourceTransferPages: 0,
      transferEdges: 0,
      inboundSendersExpanded: 0,
      extendedIndexedEdges: 0,
      extendedFetchedAddresses: 0
    }),
    missingChecks: ["Metadata enrichment limited by cap"],
    notes: ["provider limit"]
  };
}

function riskBand(score: number): WhereIsMoneyAssessment["riskBand"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function whereAssessment(score: number, overrides: Partial<WhereIsMoneyAssessment> = {}): WhereIsMoneyAssessment {
  return {
    decision: score >= 60 ? "DECLINE" : "ACCEPTABLE",
    riskScore: score,
    riskBand: riskBand(score),
    provenanceConfidence: score >= 60 ? 0 : 100,
    coverageCompleteness: 100,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: [],
    warnings: [],
    ...overrides
  };
}

function whereReport(score: number, overrides: Partial<WhereIsMoneyReport> = {}): WhereIsMoneyReport {
  const assessment = overrides.assessment ?? whereAssessment(score);
  return {
    subjectAddress: address,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment,
    decision: assessment.decision,
    userDecision: assessment.decision === "DECLINE" ? "DECLINE" : "ACCEPTABLE",
    internalDecision: assessment.decision,
    proofLevel: assessment.decision === "DECLINE" ? "exchange_policy_decline" : "clean_source_proven",
    riskScore: score,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      checkedScope: "current_balance",
      maxDepth: 20,
      fetchedAddressCount: 10,
      partial: false,
      notes: []
    },
    ...overrides
  };
}

function deepReport(overrides: Partial<DeepAddressForensicReport> = {}): DeepAddressForensicReport {
  return {
    subjectAddress: address,
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    rawEvidence: [],
    observations: [],
    missingChecks: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    approvalDrainProvenanceProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    operationalFlowProfiles: [],
    stablecoinRestrictionProfiles: [],
    coverage: {
      sourceTransferPages: 2,
      inboundSendersExpanded: 5,
      transferEdges: 100,
      extendedIndexedEdges: 100,
      extendedFetchedAddresses: 60,
      apiKeyConfigured: true
    },
    coverageDebug: coverageDebug(),
    ...overrides
  };
}

function fastReport(score: number, reasons: RiskReport["reasons"] = []): RiskReport {
  return {
    subjectAddress: address,
    level: score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    score,
    taintScore: 0,
    launderingPatternScore: 0,
    dominantRiskType: "none",
    reasons
  };
}

function blacklistProfile(): StablecoinRestrictionProfile {
  return {
    subjectAddress: address,
    tokenContract: "TRON_USDT",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: true,
    balanceRaw: "0",
    checkedAt: "2026-06-04T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}

function approvalDrainProfile(overrides: Partial<ApprovalDrainProvenanceProfile> = {}): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: "TVictim1111111111111111111111111111",
    approvalTxHash: "approval-tx",
    drainTxHash: "drain-tx",
    spenderAddress: "TSpender111111111111111111111111111",
    operatorAddress: null,
    spenderResolution: "direct_usdt_owner",
    falsePositiveGuards: [],
    supportingFingerprints: [],
    firstReceiverAddress: address,
    subjectAddress: address,
    hopDepth: 0,
    amountRaw: "100000000000",
    amountPreservationRatio: 0.98,
    approvalAt: "2026-05-24T00:00:00.000Z",
    drainAt: "2026-05-24T00:05:00.000Z",
    pathTxHashes: ["drain-tx"],
    pathAddresses: ["TVictim1111111111111111111111111111", address],
    score: 90,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

function operationalFlowProfile(overrides: Partial<OperationalFlowProfile> = {}): OperationalFlowProfile {
  return {
    subjectAddress: address,
    windowStart: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    incomingVolumeRaw: "7541408440000",
    outgoingVolumeRaw: "7541406950000",
    incomingTxCount: 12,
    outgoingTxCount: 27,
    inflowToOutflowRatio: 0.999,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [],
    categoryBreakdown: [],
    terminalLiquidityIncomingRatio: 0,
    terminalLiquidityOutgoingRatio: 0,
    htxHuobiIncomingRatio: 0,
    htxHuobiOutgoingRatio: 0,
    bridgeDexRouterOutgoingRatio: 0.25,
    unknownContractOutgoingRatio: 0,
    operationalScore: 65,
    features: [],
    ...overrides
  };
}

function boundaryExposureProfile(): BoundaryExposureProfile {
  return {
    subjectAddress: address,
    incomingBoundaryVolumeRaw: "0",
    outgoingBoundaryVolumeRaw: "100000000000",
    incomingBoundaryVolumeRatio: 0,
    outgoingBoundaryVolumeRatio: 0.3,
    directBoundaryTxCount: 2,
    twoHopBoundaryTxCount: 0,
    topBoundaryEntities: [],
    categoryBreakdown: [],
    flows: [],
    contextScore: 15,
    features: []
  };
}

describe("calculateUnifiedWalletRisk", () => {
  it("keeps active USDT blacklist at critical hard floor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ stablecoinRestrictionProfiles: [blacklistProfile()] })
    });

    expect(result.finalScore).toBe(95);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.hardEvidenceFloor).toBe(95);
  });

  it("keeps exact approval drain above the hard floor even with trusted dampener", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{ code: "internal_label_false_positive", message: "trusted context", scoreImpact: -40 }]),
      whereReport: whereReport(0),
      deepReport: deepReport({ approvalDrainProvenanceProfiles: [approvalDrainProfile()] })
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(90);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.dampener).toBe(0);
  });

  it("lets deep behavior contribute instead of leaving the final score at the where score", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        directCounterpartyInteractionProfiles: [{
          subjectAddress: address,
          direction: "outbound",
          counterpartyAddress: "TRisky11111111111111111111111111111",
          volumeRaw: "500000000000",
          volumeRatio: 0.5,
          txCount: 8,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          scoreContribution: 80,
          snapshot: {
            address: "TRisky11111111111111111111111111111",
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 1,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }]
      })
    });

    expect(result.finalScore).toBeGreaterThan(25);
    expect(result.layerBreakdown.deep.rawScore).toBe(80);
  });

  it("does not turn service-boundary-only context into hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ boundaryExposureProfiles: [boundaryExposureProfile()] })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.patternFloor).toBe(0);
    expect(result.layerBreakdown.deep.rawScore).toBe(15);
    expect(result.finalScore).toBeGreaterThan(0);
    expect(result.finalScore).toBeLessThan(30);
  });

  it("raises TLh-like historical transit behavior to HIGH without hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(45),
      deepReport: deepReport({ operationalFlowProfiles: [operationalFlowProfile()] })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.patternFloor).toBeGreaterThanOrEqual(70);
    expect(result.finalScore).toBeGreaterThanOrEqual(70);
    expect(result.finalScore).toBeLessThan(85);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("does not allow limited coverage with no evidence to look confidently clean", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0, {
        assessment: whereAssessment(0, { coverageCompleteness: 0 }),
        coverage: {
          selectedInboundTxCount: 0,
          selectedInboundVolumeRaw: "0",
          currentBalanceCoverageRatio: 0,
          coverageRatio: 0,
          checkedScope: "recent_flow",
          maxDepth: 20,
          fetchedAddressCount: 1,
          partial: true,
          notes: ["provider limit"]
        }
      }),
      deepReport: deepReport({
        missingChecks: ["Metadata enrichment limited by cap"],
        coverage: {
          sourceTransferPages: 0,
          inboundSendersExpanded: 0,
          transferEdges: 0,
          extendedIndexedEdges: 0,
          extendedFetchedAddresses: 0,
          apiKeyConfigured: true
        },
        coverageDebug: limitedCoverageDebug()
      })
    });

    expect(result.coverageLevel).toBe("limited");
    expect(result.finalScore).toBeGreaterThanOrEqual(30);
    expect(result.finalLevel).toBe("MEDIUM");
  });
});
