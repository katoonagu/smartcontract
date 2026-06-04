import { describe, expect, it } from "vitest";
import { calculateUnifiedWalletRisk, hasUnifiedFastHardEvidence } from "../../src/risk/unifiedWalletRisk";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import type {
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  ExtendedProvenanceProfile,
  InboundProvenanceProfile,
  OperationalFlowProfile,
  RiskLabel,
  RiskReport,
  StablecoinRestrictionProfile,
  WalletRoleProfile,
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

function highVolumeTransitProfile(overrides: Partial<OperationalFlowProfile> = {}): OperationalFlowProfile {
  return operationalFlowProfile({
    incomingVolumeRaw: "100000000000000000",
    outgoingVolumeRaw: "100000000000000000",
    inflowToOutflowRatio: 1,
    bridgeDexRouterOutgoingRatio: 1,
    unknownContractOutgoingRatio: 1,
    ...overrides
  });
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

function inboundProvenanceProfile(label: RiskLabel, score = 86): InboundProvenanceProfile {
  return {
    subjectAddress: address,
    incomingVolumeRaw: "100000000000",
    matchedInboundVolumeRaw: "100000000000",
    paths: [{
      depth: 1,
      sourceAddress: "TSource1111111111111111111111111111",
      viaAddresses: [],
      label,
      amountRaw: "100000000000",
      amountPreservationRatio: 0.98,
      firstTransferAt: "2026-05-24T00:00:00.000Z",
      lastTransferAt: "2026-05-24T00:05:00.000Z",
      txHashes: ["tx-inbound-provenance"]
    }],
    boundaryNotes: [],
    score,
    features: []
  };
}

function extendedProvenanceProfile(label: RiskLabel, score = 86): ExtendedProvenanceProfile {
  return {
    subjectAddress: address,
    direction: "inbound",
    maxDepth: 3,
    paths: [{
      direction: "inbound",
      depth: 2,
      pathAddresses: ["TSource1111111111111111111111111111", address],
      txHashes: ["tx-extended-provenance"],
      amountRaw: "100000000000",
      amountPreservationRatio: 0.98,
      firstTransferAt: "2026-05-24T00:00:00.000Z",
      lastTransferAt: "2026-05-24T00:05:00.000Z",
      label,
      labelAddress: "TSource1111111111111111111111111111",
      boundaryCategory: null,
      evidenceStrength: "exact_labeled_path",
      candidateScore: score,
      features: []
    }],
    matchedVolumeRaw: "100000000000",
    matchedVolumeRatio: 1,
    score,
    features: [],
    coverage: {
      expandedAddresses: 1,
      fetchedAddressCount: 1,
      stoppedReasons: [],
      maxDepthReached: 2
    }
  };
}

function counterpartyRiskProfile(overrides: Partial<CounterpartyRiskProfile> = {}): CounterpartyRiskProfile {
  return {
    subjectAddress: address,
    direction: "outbound",
    counterpartyAddress: "TRisky11111111111111111111111111111",
    label: "reported_scam",
    serviceCategory: null,
    identity: null,
    amountRaw: "500000000000",
    txCount: 8,
    volumeRatio: 0.5,
    firstTransferAt: "2026-06-01T10:00:00.000Z",
    lastTransferAt: "2026-06-01T11:00:00.000Z",
    txHashes: ["tx-counterparty"],
    score: 80,
    features: [],
    ...overrides
  };
}

function walletRoleProfile(overrides: Partial<WalletRoleProfile> = {}): WalletRoleProfile {
  return {
    subjectAddress: address,
    primaryRole: "mule",
    roles: [{
      role: "mule",
      confidence: "medium",
      score: 70,
      reasons: []
    }],
    evidenceStrength: "strong_behavior",
    features: [],
    ...overrides
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

  it("keeps fast-only active USDT blacklist at the 95 hard floor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(90, [{
        code: "stablecoin_usdt_blacklisted",
        message: "Fast Check found active TRC20 USDT blacklist evidence.",
        scoreImpact: 90
      }]),
      whereReport: whereReport(0)
    });

    expect(result.hardEvidenceFloor).toBe(95);
    expect(result.finalScore).toBe(95);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("keeps fast blacklist at 95 when lower scam evidence appears first", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(90, [{
        code: "internal_label_scam",
        message: "Fast Check found exact scam label.",
        scoreImpact: 80
      }, {
        code: "stablecoin_usdt_blacklisted",
        message: "Fast Check found active TRC20 USDT blacklist evidence.",
        scoreImpact: 90
      }]),
      whereReport: whereReport(0)
    });

    expect(result.hardEvidenceFloor).toBe(95);
    expect(result.finalScore).toBe(95);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
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

  it("keeps fast-only approval-drain provenance at the 90 hard floor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(80, [{
        code: "forensic_approval_drain_provenance",
        message: "Fast Check found exact approval-drain provenance.",
        scoreImpact: 80
      }]),
      whereReport: whereReport(0)
    });

    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(90);
    expect(result.finalScore).toBeGreaterThanOrEqual(90);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("keeps fast-only scam labels at the 90 hard floor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(80, [{
        code: "internal_label_scam",
        message: "Fast Check found exact scam label.",
        scoreImpact: 80
      }]),
      whereReport: whereReport(0)
    });

    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(90);
    expect(result.finalScore).toBeGreaterThanOrEqual(90);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("treats fast risky-contract labels as hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{
        code: "internal_label_risky_contract",
        message: "Fast Check found exact risky-contract label.",
        scoreImpact: 80
      }]),
      whereReport: whereReport(0),
      deepReport: deepReport()
    });

    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(85);
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("treats fast approval-drain proximity labels as exact approval evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{
        code: "internal_label_approval_drain_proximity",
        message: "Fast Check found exact approval-drain proximity label.",
        scoreImpact: 80
      }]),
      whereReport: whereReport(0),
      deepReport: deepReport()
    });

    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(90);
    expect(result.finalScore).toBeGreaterThanOrEqual(90);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("exposes unified fast hard-evidence detection for preliminary reports", () => {
    const report = fastReport(0, [{
      code: "internal_label_approval_drain_proximity",
      message: "Fast Check found exact approval-drain proximity label.",
      scoreImpact: 80
    }]);

    expect(hasUnifiedFastHardEvidence(report)).toBe(true);
    expect(hasUnifiedFastHardEvidence(null)).toBe(false);
  });

  it("does not treat fast darknet-exchange proximity as exact self evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{
        code: "internal_label_darknet_exchange_proximity",
        message: "Fast Check found darknet-exchange proximity label.",
        scoreImpact: 95
      }]),
      whereReport: whereReport(0),
      deepReport: deepReport()
    });

    expect(result.hardEvidenceFloor).toBe(0);
  });

  it("keeps where-only HIGH risk when fast and deep reports are unavailable", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(65)
    });
    const contributionSum = Object.values(result.layerBreakdown)
      .reduce((sum, item) => sum + item.weightedContribution, 0);

    expect(result.weightedLayerScore).toBe(65);
    expect(result.layerBreakdown.fast.weightedContribution).toBe(0);
    expect(result.layerBreakdown.deep.weightedContribution).toBe(0);
    expect(result.layerBreakdown.where.weightedContribution).toBe(65);
    expect(contributionSum).toBe(65);
    expect(result.reasons.some((reason) => reason.code === "weighted_layer_score")).toBe(false);
    expect(result.finalScore).toBeGreaterThanOrEqual(60);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.coverageLevel).toBe("partial");
  });

  it("keeps normalized layer contributions non-negative when rounding exceeds the total", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(5),
      whereReport: whereReport(0),
      deepReport: deepReport({
        boundaryExposureProfiles: [{ ...boundaryExposureProfile(), contextScore: 1 }]
      })
    });
    const contributions = Object.values(result.layerBreakdown).map((item) => item.weightedContribution);
    const contributionSum = contributions.reduce((sum, contribution) => sum + contribution, 0);

    expect(result.weightedLayerScore).toBe(1);
    expect(contributions.every((contribution) => contribution >= 0)).toBe(true);
    expect(contributionSum).toBe(1);
  });

  it("rounds normalized half-point scores up without binary float drift", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(1),
      whereReport: whereReport(79)
    });
    const contributions = Object.values(result.layerBreakdown).map((item) => item.weightedContribution);
    const contributionSum = contributions.reduce((sum, contribution) => sum + contribution, 0);

    expect(result.weightedLayerScore).toBe(60);
    expect(result.finalScore).toBe(60);
    expect(result.finalDecision).toBe("DECLINE");
    expect(contributions.every((contribution) => contribution >= 0)).toBe(true);
    expect(contributionSum).toBe(result.weightedLayerScore);
  });

  it("marks complete Deep and Where coverage as partial when Fast Check is unavailable", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport()
    });

    expect(result.coverageLevel).toBe("partial");
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

  it("lets deep counterparty risk profiles contribute to the deep layer", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({ counterpartyRiskProfiles: [counterpartyRiskProfile()] })
    });

    expect(result.layerBreakdown.deep.rawScore).toBe(80);
    expect(result.finalScore).toBeGreaterThan(25);
  });

  it("lets deep wallet role profiles contribute to the deep layer", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({ walletRoleProfiles: [walletRoleProfile()] })
    });

    expect(result.layerBreakdown.deep.rawScore).toBe(70);
    expect(result.finalScore).toBeGreaterThan(25);
  });

  it("caps combined non-hard weighted context below CRITICAL", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(100, [{
        code: "fast_context_score",
        message: "Fast Check found non-hard context.",
        scoreImpact: 100
      }]),
      whereReport: whereReport(100),
      deepReport: deepReport({ counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 100 })] })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.weightedLayerScore).toBeGreaterThanOrEqual(85);
    expect(result.finalScore).toBeLessThan(85);
    expect(result.finalLevel).toBe("HIGH");
  });

  it("uses only the selected fast report for fast dampeners", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(60, [{
        code: "selected_fast_dampener",
        message: "Selected fast report dampener.",
        scoreImpact: -10
      }]),
      whereReport: whereReport(60, {
        fastWalletRisk: fastReport(0, [{
          code: "fallback_fast_dampener",
          message: "Fallback fast report dampener.",
          scoreImpact: -20
        }])
      }),
      deepReport: deepReport({ counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 60 })] })
    });

    expect(result.dampener).toBe(10);
    expect(result.finalScore).toBe(50);
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

  it("caps historical transit pattern floors below CRITICAL without hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ operationalFlowProfiles: [highVolumeTransitProfile()] })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.patternFloor).toBeLessThan(85);
    expect(result.finalScore).toBeLessThan(85);
    expect(result.finalLevel).toBe("HIGH");
  });

  it("does not apply historical transit pattern floor without destination-risk mix", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        operationalFlowProfiles: [
          highVolumeTransitProfile({
            bridgeDexRouterOutgoingRatio: 0,
            unknownContractOutgoingRatio: 0,
            operationalScore: 0
          })
        ]
      })
    });

    expect(result.patternFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(60);
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

  it("does not let dampening push limited coverage below MEDIUM", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{ code: "internal_label_false_positive", message: "trusted context", scoreImpact: -40 }]),
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

  it("treats mixer-like inbound provenance as hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ inboundProvenanceProfiles: [inboundProvenanceProfile("mixer_like")] })
    });

    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(85);
  });

  it("does not treat darknet-exchange proximity inbound provenance as hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({
        inboundProvenanceProfiles: [inboundProvenanceProfile("darknet_exchange_proximity", 90)]
      })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(85);
  });

  it("treats risky-contract extended provenance as hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({ extendedProvenanceProfiles: [extendedProvenanceProfile("risky_contract")] })
    });

    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(85);
  });

  it("does not treat approval-drain proximity extended provenance as hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0),
      deepReport: deepReport({
        extendedProvenanceProfiles: [extendedProvenanceProfile("approval_drain_proximity", 90)]
      })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(85);
  });
});
