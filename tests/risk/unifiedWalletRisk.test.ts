import { describe, expect, it } from "vitest";
import {
  calculateUnifiedForensicRisk,
  calculateUnifiedWalletRisk,
  hasUnifiedFastHardEvidence
} from "../../src/risk/unifiedWalletRisk";
import {
  calculateUnifiedIncomingDepositRisk,
  incomingRiskBandFromUnifiedScore,
  incomingUnifiedRiskSummary
} from "../../src/risk/unifiedIncomingDepositRisk";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import type {
  ApprovalDrainProvenanceProfile,
  BoundaryExposureProfile,
  CounterpartyRiskProfile,
  ExtendedProvenanceProfile,
  InboundProvenanceProfile,
  MoneyOriginSourceProvenanceMaterialitySummary,
  OperationalFlowProfile,
  RiskLabel,
  RiskLayerScore,
  RiskReport,
  SourcePolicyEvidence,
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

function sourcePolicyEvidence(score = 70): SourcePolicyEvidence {
  return {
    kind: "bridge_router_dex",
    aggregateShare: 1,
    effectiveShare: 1,
    pathCount: 1,
    score,
    riskBand: score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: false,
    reasons: ["Bridge/router/DEX source-policy exposure is strong enough for policy decline."],
    warnings: [],
    evidenceIds: ["source-policy-bridge-router-dex"]
  };
}

function sourcePolicyLayer(score = 70): RiskLayerScore {
  return {
    evidenceClass: "source_policy",
    kind: "bridge_router_dex",
    sourceExposureKind: "bridge_router_dex",
    score,
    rawScore: score,
    adjustedScore: score,
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: false,
    reasons: ["Aggregate source-policy layer is strong enough for policy decline."],
    warnings: [],
    evidenceIds: ["source-policy-layer-bridge-router-dex"]
  };
}

type DrainEpisodeFixture = NonNullable<WhereIsMoneyReport["coverage"]["drainEpisode"]>;

function drainEpisode(overrides: Partial<DrainEpisodeFixture> = {}): DrainEpisodeFixture {
  return {
    anchorTxHash: "tx-anchor-out",
    fundingTxHash: "tx-funding-in",
    fundingAmountRaw: "1885262475832",
    fundingTimestamp: "2026-05-05T13:31:30.000Z",
    startTimestamp: "2026-05-05T13:39:09.000Z",
    endTimestamp: "2026-05-05T15:00:30.000Z",
    episodeOutgoingRaw: "1885347470000",
    episodeSelectedRaw: "135300000000",
    episodeCoverageRatio: 0.071763,
    outgoingTxHashes: ["tx-bridge-1", "tx-bridge-2"],
    bridgeOutgoingRaw: "1885347470000",
    bridgeOutgoingShare: 1,
    ...overrides
  };
}

function whereReportWithDrainEpisode(
  score = 45,
  episode: DrainEpisodeFixture = drainEpisode()
): WhereIsMoneyReport {
  return whereReport(score, {
    decision: "REVIEW",
    userDecision: "DECLINE",
    internalDecision: "REVIEW",
    proofLevel: "insufficient_coverage",
    assessment: whereAssessment(score, {
      decision: "REVIEW",
      reasons: ["Clean source could not be fully proven from available balance-forming paths."]
    }),
    coverage: {
      ...whereReport(score).coverage,
      checkedScope: "drain_episode",
      provenanceScope: "recent_flow",
      drainEpisode: episode,
      episodeCoverageRatio: episode.episodeCoverageRatio,
      targetAmountRaw: episode.episodeOutgoingRaw,
      selectedAmountRaw: episode.episodeSelectedRaw
    }
  });
}

function deepReport(overrides: Partial<DeepAddressForensicReport> = {}): DeepAddressForensicReport {
  return {
    subjectAddress: address,
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    runProfile: "production_full",
    providerBudget: {
      providerCallBudget: null,
      transferCallBudget: null,
      contractCallBudget: null,
      approvalCallBudget: null,
      elapsedTimeBudgetMs: null,
      exhausted: false
    },
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

type AssetContinuationFixture = {
  subjectAddress: string;
  sourceAsset: "USDT";
  continuationAssetSymbol: string;
  continuationTokenContract: string;
  conversionTxHash: string;
  outgoingTxHash: string | null;
  protocolAddress: string | null;
  destinationAddress: string | null;
  destinationRisk: "provider_risk" | "internal_label" | "service_boundary" | "unknown";
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
  continuationAmountRaw: string | null;
  tokenQuality: "verified" | "known" | "unknown";
  score: number;
  evidenceClass: "asset_continuation";
  reasons: string[];
};

function assetContinuationProfile(overrides: Partial<AssetContinuationFixture> = {}): AssetContinuationFixture {
  return {
    subjectAddress: address,
    sourceAsset: "USDT",
    continuationAssetSymbol: "WRAPPED",
    continuationTokenContract: "TWrappedToken1111111111111111111111",
    conversionTxHash: "tx-usdt-to-wrapped",
    outgoingTxHash: "tx-wrapped-out",
    protocolAddress: "TProtocol111111111111111111111111111",
    destinationAddress: "TRiskyDestination1111111111111111111",
    destinationRisk: "provider_risk",
    elapsedMs: 12_000,
    sourceAmountRaw: "101607508600",
    continuationAmountRaw: "101607508600",
    tokenQuality: "verified",
    score: 82,
    evidenceClass: "asset_continuation",
    reasons: ["Verified TRC20 continuation left the wallet and went to a provider-risk destination."],
    ...overrides
  };
}

function deepReportWithAssetContinuation(
  profile: AssetContinuationFixture
): DeepAddressForensicReport & { assetContinuationProfiles: AssetContinuationFixture[] } {
  return {
    ...deepReport(),
    assetContinuationProfiles: [profile]
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
    historicalTransitScore: 81,
    historicalTransitBreakdown: {
      eligible: true,
      flowUsdt: 7541408,
      volumeScore: 20,
      passThrough: 0.999,
      passThroughScore: 20,
      serviceShare: 0.25,
      serviceShareScore: 6,
      score: 81
    },
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
    historicalTransitScore: 84,
    historicalTransitBreakdown: {
      eligible: true,
      flowUsdt: 10000000000,
      volumeScore: 20,
      passThrough: 1,
      passThroughScore: 20,
      serviceShare: 1,
      serviceShareScore: 25,
      score: 84
    },
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

describe("calculateUnifiedIncomingDepositRisk", () => {
  it("treats sender USDT blacklist as incoming deposit hard evidence", () => {
    const senderAddress = "TBlacklistedSender111111111111111111";
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress,
      receiverAddress: "TWatchedWallet1111111111111111111",
      txHash: "tx-blacklisted-incoming",
      amountRaw: "1000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: {
        ...blacklistProfile(),
        subjectAddress: senderAddress
      },
      whereReport: whereReport(5)
    });

    expect(result.finalScore).toBe(95);
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.hardEvidenceFloor).toBe(95);
    expect(incomingUnifiedRiskSummary(result)).toMatchObject({
      finalScore: 95,
      finalDecision: "DECLINE",
      hardEvidenceFloor: 95,
      activeAnchor: {
        code: "matrix:hard_proof",
        score: 95,
        source: "hard_evidence"
      }
    });
    expect(result.reasons.map((reason) => reason.code)).toContain("stablecoin_usdt_blacklisted");
  });

  it("preserves no-final-decision when where scoring is technically invalid", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: address,
      receiverAddress: `T${"2".repeat(33)}`,
      txHash: "tx-incoming-invalid-where",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-03T00:00:00.000Z"),
      fastSenderRisk: fastReport(0),
      senderStablecoinState: null,
      whereReport: whereReport(45, {
        decision: "REVIEW",
        userDecision: "NO_FINAL_DECISION",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        scoreValid: false,
        scoreBlockedReason: "insufficient_coverage",
        technicalStatus: "provider_cap_unresolved",
        assessment: whereAssessment(45, {
          decision: "REVIEW",
          scoreValid: false,
          scoreBlockedReason: "insufficient_coverage",
          technicalStatus: "provider_cap_unresolved"
        })
      })
    });

    expect(result.finalDecision).toBe("NO_FINAL_DECISION");
  });

  it("uses deposit-scoped matrix source policy for fresh HTX/Huobi bundle", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: address,
      receiverAddress: `T${"2".repeat(33)}`,
      txHash: "tx-incoming-htx",
      amountRaw: "1000000000",
      timestamp: new Date("2026-06-01T00:00:00.000Z"),
      fastSenderRisk: fastReport(0),
      senderStablecoinState: null,
      whereReport: whereReport(0),
      deepReport: deepReport(),
      freshBundleExposure: {
        targetAmountRaw: "1000000000",
        htxHuobiShare: 0.72,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.28,
        dominantFreshSource: "htx_huobi",
        reasons: ["HTX/Huobi fresh bundle exposure"]
      }
    });

    expect(result.matrixScore).toMatchObject({
      policyScore: 85,
      matrixDecision: "DECLINE",
      winningRow: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit"
    });
  });

  it("keeps unknown-contract-only incoming evidence in review range", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: address,
      receiverAddress: `T${"2".repeat(33)}`,
      txHash: "tx-incoming-unknown-contract",
      amountRaw: "1000000000",
      timestamp: new Date("2026-06-01T00:00:00.000Z"),
      fastSenderRisk: fastReport(0),
      senderStablecoinState: null,
      whereReport: whereReport(0),
      deepReport: deepReport(),
      freshBundleExposure: {
        targetAmountRaw: "1000000000",
        htxHuobiShare: 0,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0.87,
        riskyLabelShare: 0,
        unknownShare: 0.13,
        dominantFreshSource: "unknown_contract",
        reasons: ["Unknown contract fresh bundle exposure"]
      }
    });

    expect(result.matrixScore.policyScore).toBeLessThan(60);
    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
  });

  it("floors incoming deposit risk when HTX/Huobi materially funds the fresh bundle", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-fresh-htx",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0.8,
        cleanCexShare: 0.1,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.1,
        dominantFreshSource: "htx_huobi",
        reasons: ["HTX/Huobi accounts for 80% of checked-deposit source share."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(85);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.noHardEvidenceCriticalCap.applied).toBe(false);
    expect(result.scoreBreakdown.activeAnchor).toMatchObject({
      code: "incoming_fresh_htx_huobi_source",
      source: "incoming_exposure"
    });
    expect(result.reasons.map((reason) => reason.code)).not.toContain("incoming_htx_huobi_corridor_context");
    expect(incomingUnifiedRiskSummary(result)).toMatchObject({
      freshBundleFloor: 85,
      corridorFloor: 0
    });
  });

  it("clears no-hard-evidence cap metadata when fresh HTX source bypasses a capped base score", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-fresh-htx-over-capped-base",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(100),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0.8,
        cleanCexShare: 0.1,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.1,
        dominantFreshSource: "htx_huobi",
        reasons: ["HTX/Huobi accounts for 80% of checked-deposit source share."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(85);
    expect(result.finalLevel).toBe("CRITICAL");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.noHardEvidenceCriticalCap).toMatchObject({
      applied: false,
      maxScore: 84
    });
  });

  it("keeps no-hard-evidence cap metadata when fresh HTX floor does not lift a capped base score", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-fresh-htx-below-capped-base",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(100),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0.3,
        cleanCexShare: 0.1,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.6,
        dominantFreshSource: "unknown",
        reasons: ["HTX/Huobi accounts for 30% of checked-deposit source share."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBe(70);
    expect(result.matrixScore.policyScore).toBe(result.finalScore);
    expect(result.contextScore).toBe(100);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.noHardEvidenceCriticalCap).toMatchObject({
      applied: true,
      maxScore: 84
    });
  });

  it("caps background-only incoming overlay below CRITICAL without hard evidence", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-background-cap",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(84),
      freshBundleExposure: null,
      walletExposureProfile: {
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-05T00:00:00.000Z",
        transferEventsScanned: 50,
        incomingVolumeRaw: "500000000000",
        outgoingVolumeRaw: "450000000000",
        htxHuobiIncomingShare: 0.6,
        cleanCexIncomingShare: 0.2,
        bridgeRouterDexVolumeShare: 0,
        unknownContractVolumeShare: 0,
        unknownSourceShare: 0.2,
        inOutVelocityScore: 0,
        scoreContribution: 20,
        reasons: ["Historical HTX/Huobi sender inflow is background context only."],
        warnings: []
      }
    });

    expect(result.finalScore).toBe(20);
    expect(result.matrixScore.policyScore).toBe(result.finalScore);
    expect(result.finalLevel).toBe("LOW");
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.scoreBreakdown.noHardEvidenceCriticalCap).toMatchObject({
      applied: false,
      maxScore: 84
    });
    expect(incomingUnifiedRiskSummary(result)).toMatchObject({
      backgroundScore: 20
    });
  });

  it("uses the strongest fresh bundle signal when risky label and HTX/Huobi both appear", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-risky-label-over-htx-context",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0.1,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0.2,
        unknownShare: 0.7,
        dominantFreshSource: "unknown",
        reasons: ["Risky label accounts for 20% of checked-deposit source share."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBe(85);
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor).toMatchObject({
      code: "incoming_fresh_risky_label_source",
      source: "incoming_exposure"
    });
    expect(result.reasons.map((reason) => reason.code)).not.toContain("incoming_fresh_htx_huobi_context");
  });

  it("does not add corridor context when unknown contract already has a fresh source floor", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-fresh-unknown-contract",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0.6,
        riskyLabelShare: 0,
        unknownShare: 0.4,
        dominantFreshSource: "unknown_contract",
        reasons: ["Unknown contract accounts for 60% of checked-deposit source share."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBe(45);
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.reasons.map((reason) => reason.code)).toContain("incoming_fresh_unknown_contract_source");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("incoming_service_corridor_context");
    expect(incomingUnifiedRiskSummary(result)).toMatchObject({
      freshBundleFloor: 45,
      corridorFloor: 0
    });
  });

  it("keeps tiny HTX/Huobi fresh share as corridor context without a fresh source floor", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-tiny-htx-corridor",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0.05,
        cleanCexShare: 0.2,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.75,
        dominantFreshSource: "unknown",
        reasons: ["HTX/Huobi accounts for 5% of checked-deposit source share."]
      },
      walletExposureProfile: null
    });

    expect(result.finalScore).toBe(40);
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.reasons.map((reason) => reason.code)).toContain("incoming_htx_huobi_corridor_context");
    expect(incomingUnifiedRiskSummary(result)).toMatchObject({
      freshBundleFloor: 0,
      corridorFloor: 40
    });
  });

  it("keeps historical HTX/Huobi exposure as capped background when fresh HTX share is absent", () => {
    const result = calculateUnifiedIncomingDepositRisk({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-historical-htx",
      amountRaw: "100000000000",
      timestamp: new Date("2026-06-05T00:00:00.000Z"),
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport: whereReport(18),
      freshBundleExposure: {
        targetAmountRaw: "100000000000",
        htxHuobiShare: 0,
        cleanCexShare: 0.19,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.81,
        dominantFreshSource: "unknown",
        reasons: ["Fresh HTX/Huobi source was not proven."]
      },
      walletExposureProfile: {
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-05T00:00:00.000Z",
        transferEventsScanned: 50,
        incomingVolumeRaw: "500000000000",
        outgoingVolumeRaw: "450000000000",
        htxHuobiIncomingShare: 0.6,
        cleanCexIncomingShare: 0.2,
        bridgeRouterDexVolumeShare: 0,
        unknownContractVolumeShare: 0,
        unknownSourceShare: 0.2,
        inOutVelocityScore: 0,
        scoreContribution: 18,
        reasons: ["Historical HTX/Huobi sender inflow is background context only."],
        warnings: []
      }
    });

    expect(result.finalScore).toBe(18);
    expect(result.matrixScore.policyScore).toBe(result.finalScore);
    expect(result.finalScore).toBeLessThan(60);
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.scoreBreakdown.activeAnchor?.code).not.toBe("incoming_fresh_htx_huobi_source");
    expect(incomingUnifiedRiskSummary(result)).toMatchObject({
      backgroundScore: 18
    });
  });

  it("maps unified scores onto incoming deposit risk bands", () => {
    expect(incomingRiskBandFromUnifiedScore(85)).toBe("CRITICAL");
    expect(incomingRiskBandFromUnifiedScore(84)).toBe("HIGH");
    expect(incomingRiskBandFromUnifiedScore(60)).toBe("HIGH");
    expect(incomingRiskBandFromUnifiedScore(59)).toBe("MEDIUM");
    expect(incomingRiskBandFromUnifiedScore(45)).toBe("MEDIUM");
    expect(incomingRiskBandFromUnifiedScore(44)).toBe("LOW-MEDIUM");
    expect(incomingRiskBandFromUnifiedScore(20)).toBe("LOW-MEDIUM");
    expect(incomingRiskBandFromUnifiedScore(19)).toBe("LOW");
  });
});

describe("calculateUnifiedWalletRisk", () => {
  it("scores incoming deposits through the shared scorer without auto-declining insufficient coverage", () => {
    const result = calculateUnifiedForensicRisk({
      subject: {
        scope: "incoming_deposit",
        senderAddress: "TSender1111111111111111111111111111",
        receiverAddress: "TReceiver11111111111111111111111111",
        txHash: "tx-incoming-insufficient-coverage",
        amountRaw: "65000000",
        timestamp: new Date("2026-06-05T00:00:00.000Z")
      },
      fastReport: fastReport(0),
      deepReport: null,
      whereReport: whereReport(65, {
        decision: "REVIEW",
        userDecision: "DECLINE",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        assessment: whereAssessment(65, {
          decision: "REVIEW",
          reasons: ["Clean source could not be fully proven from available paths."]
        }),
        decisionReasons: ["Clean source could not be fully proven from available paths."]
      })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(60);
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.layerBreakdown.deep.weightedContribution).toBe(0);
  });

  it("anchors exchange-policy decline at the policy floor instead of diluting it by weights", () => {
    const policyEvidence = sourcePolicyEvidence(70);
    const policyLayer = sourcePolicyLayer(70);
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 45 })]
      }),
      whereReport: whereReport(70, {
        proofLevel: "exchange_policy_decline",
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [policyEvidence],
          riskLayers: [policyLayer],
          dominantRiskLayer: policyLayer
        })
      })
    });

    expect(result.weightedLayerScore).toBe(48);
    expect(result.policyFloor).toBe(70);
    expect(result.finalScore).toBe(70);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
  });

  it("exposes scoring matrix result without calibrated probability", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport(),
      whereReport: whereReport(0, {
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [sourcePolicyEvidence(70)]
        })
      })
    });

    expect(result.matrixScore).toMatchObject({
      policyVersion: "scoring-signal-matrix-v1",
      policyScore: 70,
      matrixDecision: "DECLINE",
      winningRow: "source_policy",
      queuePriorityScore: null,
      calibratedRiskProbability: null
    });
  });

  it("keeps behavior-only matrix score below decline threshold", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "1000000000",
          outgoingVolumeRaw: "990000000",
          incomingTxCount: 1,
          outgoingTxCount: 1,
          uniqueIncomingCounterparties: 1,
          uniqueOutgoingCounterparties: 1,
          largestIncomingRaw: "1000000000",
          largestOutgoingRaw: "990000000",
          topOutgoingCounterpartyAddress: `T${"2".repeat(33)}`,
          topOutgoingCounterpartyRaw: "990000000",
          topOutgoingCounterpartyTxCount: 1,
          topOutgoingCounterpartyRatio: 0.99,
          inflowToOutflowRatio: 0.99,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: 5 * 60 * 1000,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 82,
          transitScore: 82,
          dampenerScore: 0,
          features: [{ code: "address_behavior_fast_post_deposit_exit", label: "fast exit", scoreImpact: 82 }]
        }]
      }),
      whereReport: whereReport(0)
    });

    expect(result.matrixScore.policyScore).toBe(59);
    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
    expect(result.matrixScore.riskVector.behavior_only_prior?.[0].caps).toContain("behavior_only_cap_59");
  });

  it("does not turn limited coverage into a decline after matrix switch", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        coverage: {
          sourceTransferPages: 0,
          inboundSendersExpanded: 0,
          transferEdges: 0,
          extendedIndexedEdges: 0,
          extendedFetchedAddresses: 0,
          apiKeyConfigured: true
        }
      }),
      whereReport: whereReport(0, {
        coverage: {
          ...whereReport(0).coverage,
          fetchedAddressCount: 1,
          partial: true,
          notes: ["provider limit"]
        }
      })
    });

    expect(result.matrixScore.policyScore).toBeNull();
    expect(result.matrixScore.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalScore).toBe(0);
    expect(result.finalDecision).toBe("ACCEPTABLE");
  });

  it("uses matrix source-policy score as final score after switch", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport(),
      whereReport: whereReport(0, {
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [sourcePolicyEvidence(70)]
        })
      })
    });

    expect(result.finalScore).toBe(70);
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor).toMatchObject({
      code: "matrix:source_policy",
      score: 70,
      source: "policy_floor"
    });
  });

  it("does not create a policy floor for zero-score decline without source-policy evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0, {
        proofLevel: "exchange_policy_decline",
        assessment: whereAssessment(0, {
          sourcePolicyEvidence: [],
          riskLayers: [],
          dominantRiskLayer: null
        })
      })
    });

    expect(result.policyFloor).toBe(0);
    expect(result.reasons.some((reason) => reason.source === "policy_floor")).toBe(false);
  });

  it("does not create a policy floor from service-boundary context alone", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(0, {
        proofLevel: "exchange_policy_context",
        assessment: whereAssessment(0)
      }),
      deepReport: deepReport({ boundaryExposureProfiles: [boundaryExposureProfile()] })
    });

    expect(result.policyFloor).toBe(0);
    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.contextScore).toBe(10);
    expect(result.layerBreakdown.deep.rawScore).toBe(15);
    expect(result.finalScore).toBeLessThan(30);
  });

  it("anchors a Where drain episode as a historical transit pattern", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      deepReport: deepReport({
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "7541408439833",
          outgoingVolumeRaw: "7541406947200",
          incomingTxCount: 12,
          outgoingTxCount: 27,
          uniqueIncomingCounterparties: 5,
          uniqueOutgoingCounterparties: 7,
          largestIncomingRaw: "2390400000000",
          largestOutgoingRaw: "1654000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "3000000000000",
          topOutgoingCounterpartyTxCount: 4,
          topOutgoingCounterpartyRatio: 0.3978,
          inflowToOutflowRatio: 0.9999,
          drainToServiceRatio: 0.2498,
          timeToFirstOutgoingMs: 723_000,
          timeToFirstServiceExitMs: 723_000,
          depositThenDrainScore: 25,
          transitScore: 30,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3169,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReportWithDrainEpisode()
    });

    expect(result.patternFloor).toBeGreaterThanOrEqual(80);
    expect(result.finalScore).toBe(84);
    expect(result.finalLevel).toBe("HIGH");
    expect(result.finalDecision).toBe("DECLINE");
    expect(result.scoreBreakdown.activeAnchor).toEqual(expect.objectContaining({
      code: "matrix:service_linked_pattern",
      source: "pattern_floor"
    }));
    expect(result.reasons.map((reason) => reason.code)).toContain("where_drain_episode_transit_pattern");
  });

  it("caps behavior dampener when a strong drain-episode transit anchor exists", () => {
    const modestEpisode = drainEpisode({
      fundingAmountRaw: "1000000000",
      episodeOutgoingRaw: "1000000000",
      episodeSelectedRaw: "1000000000",
      bridgeOutgoingRaw: "200000000",
      bridgeOutgoingShare: 0.2,
      episodeCoverageRatio: 1
    });
    const result = calculateUnifiedWalletRisk({
      address,
      deepReport: deepReport({
        serviceExposureProfiles: [{
          subjectAddress: address,
          exposureScore: 100,
          totalOutgoingRaw: "100000000000",
          totalOutgoingCount: 10,
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
          features: []
        }],
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "100000000000",
          incomingTxCount: 12,
          outgoingTxCount: 12,
          uniqueIncomingCounterparties: 6,
          uniqueOutgoingCounterparties: 6,
          largestIncomingRaw: "30000000000",
          largestOutgoingRaw: "30000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "30000000000",
          topOutgoingCounterpartyTxCount: 3,
          topOutgoingCounterpartyRatio: 0.3,
          inflowToOutflowRatio: 1,
          drainToServiceRatio: 0.2,
          timeToFirstOutgoingMs: 600_000,
          timeToFirstServiceExitMs: 600_000,
          depositThenDrainScore: 0,
          transitScore: 0,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReportWithDrainEpisode(45, modestEpisode)
    });

    expect(result.patternFloor).toBe(70);
    expect(result.weightedLayerScore).toBe(82);
    expect(result.dampener).toBe(5);
    expect(result.contextScore).toBe(77);
    expect(result.finalScore).toBe(70);
    expect(result.matrixScore.policyScore).toBe(result.finalScore);
  });

  it("keeps behavior dampener for regular activity without a strong transit anchor", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      deepReport: deepReport({
        serviceExposureProfiles: [{
          subjectAddress: address,
          exposureScore: 90,
          totalOutgoingRaw: "100000000000",
          totalOutgoingCount: 10,
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
          features: []
        }],
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "100000000000",
          incomingTxCount: 12,
          outgoingTxCount: 12,
          uniqueIncomingCounterparties: 6,
          uniqueOutgoingCounterparties: 6,
          largestIncomingRaw: "30000000000",
          largestOutgoingRaw: "30000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "30000000000",
          topOutgoingCounterpartyTxCount: 3,
          topOutgoingCounterpartyRatio: 0.3,
          inflowToOutflowRatio: 1,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: null,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 0,
          transitScore: 0,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReport(45, {
        decision: "REVIEW",
        userDecision: "DECLINE",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        assessment: whereAssessment(45, { decision: "REVIEW" })
      })
    });

    expect(result.patternFloor).toBe(0);
    expect(result.dampener).toBe(15);
    expect(result.finalScore).toBe(59);
    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
  });

  it("does not cap behavior dampener for non-transit source-policy floors", () => {
    const policyEvidence = sourcePolicyEvidence(70);
    const policyLayer = sourcePolicyLayer(70);
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        serviceExposureProfiles: [{
          subjectAddress: address,
          exposureScore: 100,
          totalOutgoingRaw: "100000000000",
          totalOutgoingCount: 10,
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
          features: []
        }],
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "100000000000",
          incomingTxCount: 12,
          outgoingTxCount: 12,
          uniqueIncomingCounterparties: 6,
          uniqueOutgoingCounterparties: 6,
          largestIncomingRaw: "30000000000",
          largestOutgoingRaw: "30000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "30000000000",
          topOutgoingCounterpartyTxCount: 3,
          topOutgoingCounterpartyRatio: 0.3,
          inflowToOutflowRatio: 1,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: null,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 0,
          transitScore: 0,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReport(70, {
        proofLevel: "exchange_policy_decline",
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [{
            ...policyEvidence,
            kind: "whitebit",
            reasons: ["WhiteBIT source-policy exposure is strong enough for policy decline."],
            evidenceIds: ["source-policy-whitebit"]
          }],
          riskLayers: [{
            ...policyLayer,
            kind: "whitebit",
            sourceExposureKind: "whitebit",
            reasons: ["WhiteBIT source-policy layer is strong enough for policy decline."],
            evidenceIds: ["source-policy-layer-whitebit"]
          }],
          dominantRiskLayer: {
            ...policyLayer,
            kind: "whitebit",
            sourceExposureKind: "whitebit",
            reasons: ["WhiteBIT source-policy layer is strong enough for policy decline."],
            evidenceIds: ["source-policy-layer-whitebit"]
          }
        })
      })
    });

    expect(result.policyFloor).toBe(70);
    expect(result.patternFloor).toBe(0);
    expect(result.weightedLayerScore).toBe(81);
    expect(result.dampener).toBe(11);
    expect(result.contextScore).toBe(70);
  });

  it("does not cap behavior dampener for strong non-transit policy floor plus weak transit context", () => {
    const policyEvidence = sourcePolicyEvidence(70);
    const policyLayer = sourcePolicyLayer(70);
    const weakTransitEvidence = sourcePolicyEvidence(30);
    const weakTransitLayer = sourcePolicyLayer(30);
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({
        serviceExposureProfiles: [{
          subjectAddress: address,
          exposureScore: 100,
          totalOutgoingRaw: "100000000000",
          totalOutgoingCount: 10,
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
          features: []
        }],
        addressBehaviorProfiles: [{
          subjectAddress: address,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "100000000000",
          incomingTxCount: 12,
          outgoingTxCount: 12,
          uniqueIncomingCounterparties: 6,
          uniqueOutgoingCounterparties: 6,
          largestIncomingRaw: "30000000000",
          largestOutgoingRaw: "30000000000",
          topOutgoingCounterpartyAddress: "TTopCounterparty11111111111111111",
          topOutgoingCounterpartyRaw: "30000000000",
          topOutgoingCounterpartyTxCount: 3,
          topOutgoingCounterpartyRatio: 0.3,
          inflowToOutflowRatio: 1,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: null,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 0,
          transitScore: 0,
          dampenerScore: 15,
          features: [{
            code: "regular_activity_dampener",
            label: "Distributed regular activity reduces single-incident interpretation",
            value: 0.3,
            scoreImpact: -15
          }]
        }]
      }),
      whereReport: whereReport(70, {
        proofLevel: "exchange_policy_decline",
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [{
            ...policyEvidence,
            kind: "whitebit",
            reasons: ["WhiteBIT source-policy exposure is strong enough for policy decline."],
            evidenceIds: ["source-policy-whitebit"]
          }, weakTransitEvidence],
          riskLayers: [{
            ...policyLayer,
            kind: "whitebit",
            sourceExposureKind: "whitebit",
            reasons: ["WhiteBIT source-policy layer is strong enough for policy decline."],
            evidenceIds: ["source-policy-layer-whitebit"]
          }, weakTransitLayer],
          dominantRiskLayer: {
            ...policyLayer,
            kind: "whitebit",
            sourceExposureKind: "whitebit",
            reasons: ["WhiteBIT source-policy layer is strong enough for policy decline."],
            evidenceIds: ["source-policy-layer-whitebit"]
          }
        })
      })
    });

    expect(result.policyFloor).toBe(70);
    expect(result.patternFloor).toBe(0);
    expect(result.weightedLayerScore).toBe(81);
    expect(result.dampener).toBe(11);
    expect(result.contextScore).toBe(70);
  });

  it("anchors verified asset continuation above the weighted layer score", () => {
    const policyEvidence = sourcePolicyEvidence(70);
    const policyLayer = sourcePolicyLayer(70);
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReportWithAssetContinuation(assetContinuationProfile()),
      whereReport: whereReport(70, {
        proofLevel: "exchange_policy_decline",
        assessment: whereAssessment(70, {
          sourcePolicyEvidence: [policyEvidence],
          riskLayers: [policyLayer],
          dominantRiskLayer: policyLayer
        })
      })
    });

    expect(result.weightedLayerScore).toBe(70);
    expect(result.policyFloor).toBe(70);
    expect(result.assetContinuationFloor).toBe(82);
    expect(result.finalScore).toBe(82);
    expect(result.finalLevel).toBe("HIGH");
  });

  it("caps asset-continuation evidence below CRITICAL when hard evidence is absent", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReportWithAssetContinuation(assetContinuationProfile({ score: 95 })),
      whereReport: whereReport(0)
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.assetContinuationFloor).toBe(84);
    expect(result.finalScore).toBe(84);
    expect(result.finalLevel).toBe("HIGH");
  });

  it("does not let dampeners reduce policy or asset-continuation floors", () => {
    const policyEvidence = sourcePolicyEvidence(70);
    const policyLayer = sourcePolicyLayer(70);
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0, [{ code: "internal_label_false_positive", message: "trusted context", scoreImpact: -40 }]),
      deepReport: deepReportWithAssetContinuation(assetContinuationProfile({ score: 82 })),
      whereReport: whereReport(70, {
        proofLevel: "exchange_policy_decline",
        assessment: whereAssessment(70, {
          walletRole: "operational_liquidity_wallet",
          sourcePolicyEvidence: [policyEvidence],
          riskLayers: [policyLayer],
          dominantRiskLayer: policyLayer
        })
      })
    });

    expect(result.policyFloor).toBe(70);
    expect(result.assetContinuationFloor).toBe(82);
    expect(result.dampener).toBe(0);
    expect(result.finalScore).toBe(82);
  });

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

  it("does not treat wrapper campaign context without exact profiles as approval-drain hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: null,
      whereReport: whereReport(0),
      deepReport: deepReport({
        approvalDrainProvenanceProfiles: [],
        contractDrivenCampaignSummary: {
          incomingTxTotal: 116,
          incomingAmountRaw: "440672340000",
          txInfoEnrichedIncomingTx: 116,
          campaignClassificationStatus: "complete",
          countsAreLowerBounds: false,
          plainUsdtTransferTxCount: 15,
          plainUsdtTransferAmountRaw: "115542340000",
          wrapperDrivenIncomingTxCount: 101,
          wrapperDrivenIncomingAmountRaw: "325130000000",
          verify20WrapperTxCount: 101,
          transferFromWrapperTxCount: 0,
          permitWrapperTxCount: 0,
          otherContractMethodTxCount: 0,
          unknownUnenrichedTxCount: 0,
          txInfoUnavailableTxCount: 0,
          exactApprovalDrainProfileCount: 0,
          campaignClusters: []
        }
      })
    });

    expect(result.finalDecision).not.toBe("DECLINE");
    expect(result.hardEvidenceFloor).toBe(0);
  });

  it("keeps exact approval-drain profiles as hard evidence even when campaign context is partial", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: null,
      whereReport: whereReport(0),
      deepReport: deepReport({
        approvalDrainProvenanceProfiles: [approvalDrainProfile({ score: 92 })],
        contractDrivenCampaignSummary: {
          incomingTxTotal: 2400,
          incomingAmountRaw: "9000000000000",
          txInfoEnrichedIncomingTx: 200,
          campaignClassificationStatus: "partial",
          countsAreLowerBounds: true,
          plainUsdtTransferTxCount: 126,
          plainUsdtTransferAmountRaw: "1000000000000",
          wrapperDrivenIncomingTxCount: 74,
          wrapperDrivenIncomingAmountRaw: "400000000000",
          verify20WrapperTxCount: 74,
          transferFromWrapperTxCount: 0,
          permitWrapperTxCount: 0,
          otherContractMethodTxCount: 0,
          unknownUnenrichedTxCount: 2200,
          txInfoUnavailableTxCount: 0,
          exactApprovalDrainProfileCount: 1,
          campaignClusters: []
        }
      })
    });

    expect(result.finalDecision).toBe("DECLINE");
    expect(result.hardEvidenceFloor).toBeGreaterThanOrEqual(90);
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
    expect(result.matrixScore.policyScore).toBeNull();
    expect(result.matrixScore.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalScore).toBe(0);
    expect(result.finalLevel).toBe("LOW");
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.coverageLevel).toBe("partial");
  });

  it("handles legacy deep reports that do not contain newer profile arrays", () => {
    const legacyDeepReport = deepReport({
      serviceExposureProfiles: [{
        subjectAddress: address,
        exposureScore: 40,
        totalOutgoingRaw: "100000000000",
        totalOutgoingCount: 2,
        directServiceVolumeRatio: 0.4,
        directServiceTxRatio: 1,
        indirectServiceVolumeRatio: 0,
        indirectServiceTxRatio: 0,
        mergedServiceVolumeRatio: 0,
        mergedServiceGroupCount: 0,
        combinedServiceVolumeRatio: 0.4,
        combinedServiceTxRatio: 1,
        dominantCategory: "cex",
        categoryBreakdown: [],
        topServiceCounterparties: [],
        topMergedServiceFlows: [],
        fastestServiceExitMs: null,
        bestAmountPreservationRatio: null,
        features: []
      }]
    }) as unknown as Record<string, unknown>;
    delete legacyDeepReport.boundaryExposureProfiles;
    delete legacyDeepReport.walletRoleProfiles;
    delete legacyDeepReport.operationalFlowProfiles;
    delete legacyDeepReport.directCounterpartyInteractionProfiles;

    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: legacyDeepReport as unknown as DeepAddressForensicReport,
      whereReport: whereReport(45)
    });

    expect(result.layerBreakdown.deep.rawScore).toBe(40);
    expect(result.finalScore).toBeGreaterThan(0);
  });

  it("does not let insufficient coverage force decline when unified score is below high risk", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(45, {
        decision: "REVIEW",
        userDecision: "DECLINE",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        assessment: whereAssessment(45, {
          decision: "REVIEW",
          riskLayers: [{
            evidenceClass: "unknown_origin",
            kind: "unresolved_origin",
            score: 45,
            rawScore: 45,
            adjustedScore: 45,
            proofLevel: "insufficient_coverage",
            canBeDampened: false,
            reasons: ["Clean source could not be fully proven from available balance-forming paths."],
            warnings: ["Unknown-origin evidence is contextual and does not by itself prove scam, blacklist, or approval-drain activity."],
            evidenceIds: ["unknown-origin-context"]
          }],
          dominantRiskLayer: null
        })
      })
    });

    expect(result.matrixScore.policyScore).toBeNull();
    expect(result.matrixScore.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalScore).toBe(0);
    expect(result.finalLevel).toBe("LOW");
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.policyFloor).toBe(0);
  });

  it("keeps score-valid dense-hop where materiality caveats in review", () => {
    const denseHopMateriality = {
      outcome: "dense_hop_unresolved_below_materiality",
      materialityTier: "small_relative_dense_hop_tail",
      unresolvedAmountRaw: "45000000",
      unresolvedAmountUsdt: 45,
      unresolvedShareOfCheckedBalance: 0.0045,
      unresolvedShareOfSelectedAmount: 0.0045,
      largestUnresolvedAmountRaw: "45000000",
      largestUnresolvedAmountUsdt: 45,
      aggregateUnresolvedShareOfCheckedBalance: 0.0045,
      aggregateUnresolvedShareOfSelectedAmount: 0.0045,
      unresolvedPathCount: 1,
      denseHopUnresolvedPathCount: 1,
      hardEvidenceInUnresolved: false,
      excludedFromDecisiveScore: true,
      unresolvedReasonCounts: {
        incoming_history_not_fetched: 1
      },
      thresholds: {
        maxResidualUnresolvedShare: 0.01,
        maxResidualUnresolvedAmountUsdt: 100,
        maxResidualUnresolvedAmountRaw: "100000000",
        maxDenseHopUnresolvedShare: 0.01,
        maxDenseHopAggregateUnresolvedShare: 0.02,
        maxDenseHopUnresolvedAmountUsdt: 10000,
        maxDenseHopUnresolvedAmountRaw: "10000000000"
      }
    } satisfies MoneyOriginSourceProvenanceMaterialitySummary;

    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(45, {
        decision: "REVIEW",
        userDecision: "REVIEW",
        internalDecision: "REVIEW",
        proofLevel: "insufficient_coverage",
        scoreValid: true,
        sourceProvenanceMateriality: denseHopMateriality,
        assessment: whereAssessment(45, {
          decision: "REVIEW",
          scoreValid: true,
          sourceProvenanceMateriality: denseHopMateriality
        })
      })
    });

    expect(result.finalDecision).toBe("REVIEW");
    expect(result.finalScore).toBeGreaterThan(0);
  });

  it("does not turn where-is-money LLM suspicion context into deterministic hard evidence", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(88, {
        userDecision: "DECLINE",
        internalDecision: "DECLINE",
        proofLevel: "llm_assisted_suspicion",
        assessment: whereAssessment(88, {
          hardBadEvidence: [{
            kind: "llm_contract_suspicion",
            score: 88,
            message: "AI contract verdict indicates suspicious contract context.",
            evidenceIds: ["tx-llm-context"]
          }]
        })
      })
    });

    expect(result.hardEvidenceFloor).toBe(0);
    expect(result.finalScore).toBe(59);
    expect(result.finalLevel).toBe("MEDIUM");
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.matrixScore).toMatchObject({
      policyScore: 59,
      matrixDecision: "REVIEW",
      winningRow: "contract_suspicion"
    });
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
      whereReport: whereReport(79, {
        proofLevel: "exchange_policy_context",
        assessment: whereAssessment(79, {
          sourcePolicyEvidence: [],
          riskLayers: [],
          dominantRiskLayer: null
        })
      })
    });
    const contributions = Object.values(result.layerBreakdown).map((item) => item.weightedContribution);
    const contributionSum = contributions.reduce((sum, contribution) => sum + contribution, 0);

    expect(result.weightedLayerScore).toBe(60);
    expect(result.finalScore).toBe(1);
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.matrixScore.policyScore).toBe(result.finalScore);
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
    expect(result.finalScore).toBe(59);
    expect(result.finalLevel).toBe("MEDIUM");
    expect(result.finalDecision).toBe("ACCEPTABLE");
    expect(result.matrixScore.matrixDecision).toBe("REVIEW");
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
        proofLevel: "exchange_policy_context",
        assessment: whereAssessment(60, {
          sourcePolicyEvidence: [],
          riskLayers: [],
          dominantRiskLayer: null
        }),
        fastWalletRisk: fastReport(0, [{
          code: "fallback_fast_dampener",
          message: "Fallback fast report dampener.",
          scoreImpact: -20
        }])
      }),
      deepReport: deepReport({ counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 60 })] })
    });

    expect(result.dampener).toBe(10);
    expect(result.finalScore).toBe(59);
    expect(result.matrixScore.policyScore).toBe(result.finalScore);
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

  describe("fixture-based observed address style calibration", () => {
    it("keeps TLh-like historical transit HIGH/DECLINE through the Deep pattern floor", () => {
      const transitProfile = operationalFlowProfile();
      const result = calculateUnifiedWalletRisk({
        address,
        fastReport: fastReport(0),
        deepReport: deepReport({ operationalFlowProfiles: [transitProfile] }),
        whereReport: whereReport(31)
      });

      expect(transitProfile.historicalTransitScore).toBe(81);
      expect(transitProfile.historicalTransitBreakdown).toMatchObject({
        eligible: true,
        score: 81
      });
      expect(result.patternFloor).toBe(81);
      expect(result.finalScore).toBe(81);
      expect(result.finalLevel).toBe("HIGH");
      expect(result.finalDecision).toBe("DECLINE");
      expect(result.scoreBreakdown.activeAnchor).toMatchObject({
        code: "historical_transit_pattern",
        score: 81,
        source: "pattern_floor"
      });
    });

    it("keeps TYs-like verified continuation HIGH/DECLINE through the asset-continuation floor", () => {
      const policyEvidence = sourcePolicyEvidence(78);
      const policyLayer = sourcePolicyLayer(78);
      const result = calculateUnifiedWalletRisk({
        address,
        fastReport: fastReport(0),
        deepReport: deepReportWithAssetContinuation(assetContinuationProfile({
          continuationAssetSymbol: "jUSDT",
          continuationTokenContract: "TJusdt1111111111111111111111111111",
          continuationAmountRaw: "940997329982886",
          score: 84,
          reasons: ["USDT movement continued through jUSDT to a provider-risk destination."]
        })),
        whereReport: whereReport(78, {
          proofLevel: "exchange_policy_decline",
          assessment: whereAssessment(78, {
            sourcePolicyEvidence: [policyEvidence],
            riskLayers: [policyLayer],
            dominantRiskLayer: policyLayer
          })
        })
      });

      expect(result.weightedLayerScore).toBe(74);
      expect(result.policyFloor).toBe(78);
      expect(result.assetContinuationFloor).toBe(84);
      expect(result.finalScore).toBe(84);
      expect(result.finalLevel).toBe("HIGH");
      expect(result.finalDecision).toBe("DECLINE");
      expect(result.scoreBreakdown.activeAnchor).toMatchObject({
        code: "asset_continuation_floor",
        score: 84,
        source: "asset_continuation"
      });
    });

    it("keeps TPv-like policy/deep context HIGH/DECLINE without crossing into CRITICAL", () => {
      const policyEvidence = sourcePolicyEvidence(70);
      const policyLayer = sourcePolicyLayer(70);
      const result = calculateUnifiedWalletRisk({
        address,
        fastReport: fastReport(0),
        deepReport: deepReport({
          counterpartyRiskProfiles: [counterpartyRiskProfile({ score: 90 })]
        }),
        whereReport: whereReport(70, {
          proofLevel: "exchange_policy_decline",
          assessment: whereAssessment(70, {
            sourcePolicyEvidence: [policyEvidence],
            riskLayers: [policyLayer],
            dominantRiskLayer: policyLayer
          })
        })
      });

      expect(result.layerBreakdown.deep.rawScore).toBe(90);
      expect(result.policyFloor).toBe(70);
      expect(result.weightedLayerScore).toBeGreaterThan(result.policyFloor);
      expect(result.weightedLayerScore).toBe(75);
      expect(result.finalScore).toBe(result.policyFloor);
      expect(result.finalScore).toBe(70);
      expect(result.finalScore).toBeLessThan(85);
      expect(result.finalLevel).toBe("HIGH");
      expect(result.finalDecision).toBe("DECLINE");
      expect(result.matrixScore.policyScore).toBe(result.finalScore);
    });
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

  it("uses profile historicalTransitScore for pattern floor and falls back for legacy profiles", () => {
    const fresh = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        operationalFlowProfiles: [
          operationalFlowProfile({
            bridgeDexRouterOutgoingRatio: 0.28,
            historicalTransitScore: 82,
            historicalTransitBreakdown: {
              eligible: true,
              flowUsdt: 7541408,
              volumeScore: 20,
              passThrough: 0.999,
              passThroughScore: 20,
              serviceShare: 0.28,
              serviceShareScore: 7,
              score: 82
            }
          })
        ]
      })
    });

    const legacyProfile = operationalFlowProfile();
    delete (legacyProfile as Partial<OperationalFlowProfile>).historicalTransitScore;
    delete (legacyProfile as Partial<OperationalFlowProfile>).historicalTransitBreakdown;

    const legacy = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({ operationalFlowProfiles: [legacyProfile] })
    });

    expect(fresh.patternFloor).toBe(82);
    expect(fresh.scoreBreakdown.activeAnchor).toMatchObject({
      code: "historical_transit_pattern",
      score: 82
    });
    expect(legacy.patternFloor).toBe(81);
  });

  it("does not apply stale historical transit storage when raw fields are ineligible", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        operationalFlowProfiles: [
          highVolumeTransitProfile({
            bridgeDexRouterOutgoingRatio: 0,
            unknownContractOutgoingRatio: 0,
            historicalTransitScore: 82,
            historicalTransitBreakdown: {
              eligible: true,
              flowUsdt: 10000000000,
              volumeScore: 20,
              passThrough: 1,
              passThroughScore: 20,
              serviceShare: 1,
              serviceShareScore: 25,
              score: 82
            },
            operationalScore: 0
          })
        ]
      })
    });

    expect(result.patternFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(60);
  });

  it("does not create a pattern floor from an incoherent stored historical transit breakdown", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        operationalFlowProfiles: [
          operationalFlowProfile({
            historicalTransitScore: 82,
            historicalTransitBreakdown: {
              eligible: true,
              flowUsdt: 7541408,
              volumeScore: 0,
              passThrough: 0.999,
              passThroughScore: 0,
              serviceShare: 0.25,
              serviceShareScore: 0,
              score: 0
            },
            operationalScore: 0
          })
        ]
      })
    });

    expect(result.patternFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(60);
  });

  it("caps stored historical transit score to the recalculated score", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      whereReport: whereReport(25),
      deepReport: deepReport({
        operationalFlowProfiles: [
          operationalFlowProfile({
            historicalTransitScore: 84,
            historicalTransitBreakdown: {
              eligible: true,
              flowUsdt: 7541408,
              volumeScore: 20,
              passThrough: 0.999,
              passThroughScore: 20,
              serviceShare: 0.25,
              serviceShareScore: 6,
              score: 84
            }
          })
        ]
      })
    });

    expect(result.patternFloor).toBe(81);
    expect(result.scoreBreakdown.activeAnchor).toMatchObject({
      code: "historical_transit_pattern",
      score: 81
    });
  });

  it("exposes the active score anchor used for the final wallet score", () => {
    const result = calculateUnifiedWalletRisk({
      address,
      fastReport: fastReport(0),
      deepReport: deepReport({ operationalFlowProfiles: [operationalFlowProfile({ operationalScore: 58 })] }),
      whereReport: whereReport(25)
    });

    expect(result.finalScore).toBe(81);
    expect(result.scoreBreakdown.contextScore).toBe(result.contextScore);
    expect(result.scoreBreakdown.weightedLayerScore).toBe(result.weightedLayerScore);
    expect(result.scoreBreakdown).toMatchObject({
      weightedLayerScore: 42,
      contextScore: 42,
      floors: {
        hardEvidence: 0,
        policy: 0,
        assetContinuation: 0,
        pattern: 81,
        coverage: 0
      },
      activeAnchor: {
        code: "historical_transit_pattern",
        score: 81,
        source: "pattern_floor"
      },
      noHardEvidenceCriticalCap: {
        applied: false,
        maxScore: 84
      }
    });
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
            historicalTransitScore: 0,
            historicalTransitBreakdown: {
              eligible: false,
              flowUsdt: 10000000000,
              volumeScore: 20,
              passThrough: 1,
              passThroughScore: 20,
              serviceShare: 0,
              serviceShareScore: 0,
              score: 0
            },
            operationalScore: 0
          })
        ]
      })
    });

    expect(result.patternFloor).toBe(0);
    expect(result.finalScore).toBeLessThan(60);
  });

  it("reports limited coverage with no evidence as insufficient instead of adding badness", () => {
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
    expect(result.contextScore).toBeGreaterThanOrEqual(30);
    expect(result.matrixScore.policyScore).toBeNull();
    expect(result.matrixScore.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalScore).toBe(0);
    expect(result.finalLevel).toBe("LOW");
  });

  it("keeps limited coverage insufficient even when legacy dampeners apply", () => {
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
    expect(result.matrixScore.policyScore).toBeNull();
    expect(result.matrixScore.matrixDecision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalScore).toBe(0);
    expect(result.finalLevel).toBe("LOW");
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
