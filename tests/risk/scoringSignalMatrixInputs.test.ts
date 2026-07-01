import { describe, expect, it } from "vitest";
import { buildIncomingDepositMatrixCandidates, buildWalletMatrixCandidates } from "../../src/risk/scoringSignalMatrixInputs";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { IncomingFreshBundleExposure, RiskReport, WhereIsMoneyReport } from "../../src/types";

const address = `T${"1".repeat(33)}`;

function fastReport(score: number, code = "address_behavior_fast_post_deposit_exit"): RiskReport {
  return {
    subjectAddress: address,
    level: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    score,
    reasons: [{ code, message: code, scoreImpact: score }]
  };
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
    directCounterpartyInteractionProfiles: [],
    operationalFlowProfiles: [],
    assetContinuationProfiles: [],
    stablecoinRestrictionProfiles: [],
    coverage: {
      sourceTransferPages: 2,
      inboundSendersExpanded: 5,
      transferEdges: 100,
      extendedIndexedEdges: 100,
      extendedFetchedAddresses: 60,
      apiKeyConfigured: true
    },
    coverageDebug: {
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
        legacyPartial: false
      },
      rows: [],
      missingChecks: [],
      notes: []
    },
    ...overrides
  };
}

function whereReport(overrides: Partial<WhereIsMoneyReport> = {}): WhereIsMoneyReport {
  const assessment = {
    decision: "ACCEPTABLE" as const,
    riskScore: 0,
    riskBand: "LOW" as const,
    provenanceConfidence: 100,
    coverageCompleteness: 100,
    walletRole: "unknown_wallet" as const,
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: [],
    warnings: []
  };
  return {
    subjectAddress: address,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    assessment,
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    proofLevel: "clean_source_proven",
    riskScore: 0,
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

describe("scoring signal matrix input mappers", () => {
  it("maps Where source-policy evidence to a source-policy candidate", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({
        assessment: {
          ...whereReport().assessment,
          sourcePolicyEvidence: [{
            kind: "htx_huobi",
            aggregateShare: 0.72,
            effectiveShare: 0.72,
            pathCount: 2,
            score: 80,
            riskBand: "HIGH",
            proofLevel: "exchange_policy_decline",
            canBeDampened: false,
            reasons: ["HTX/Huobi funds material source share."],
            warnings: [],
            evidenceIds: ["source-policy:htx"]
          }]
        }
      })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "source_policy",
      actionUnit: "source_path",
      score: 80,
      decisionEligibility: "can_decline",
      evidenceIds: ["source-policy:htx"],
      evidenceEpisodeIds: ["source-policy:htx"]
    }));
  });

  it("maps limited coverage to uncertainty without badness authority", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
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
      whereReport: whereReport({
        coverage: {
          ...whereReport().coverage,
          partial: true,
          fetchedAddressCount: 1,
          notes: ["provider limit"]
        }
      })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "coverage_uncertainty",
      decisionEligibility: "insufficient_only",
      atomicSignals: expect.arrayContaining(["insufficient_coverage"])
    }));
  });

  it("maps incoming fresh HTX/Huobi exposure to deposit-scoped source policy", () => {
    const exposure: IncomingFreshBundleExposure = {
      targetAmountRaw: "1000000000",
      htxHuobiShare: 0.72,
      cleanCexShare: 0,
      bridgeRouterDexShare: 0,
      unknownContractShare: 0,
      riskyLabelShare: 0,
      unknownShare: 0.28,
      dominantFreshSource: "htx_huobi",
      reasons: ["HTX/Huobi fresh bundle exposure"]
    };

    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: "TSender1111111111111111111111111111",
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "tx-incoming",
      freshBundleExposure: exposure,
      baseCandidates: []
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      decisionEligibility: "can_decline",
      atomicSignals: ["incoming_fresh_htx_huobi_source"]
    }));
  });

  it("keeps fast behavior reasons out of hard proof candidates", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: fastReport(77),
      deepReport: null,
      whereReport: whereReport()
    });

    expect(candidates.some((item) => item.row === "hard_proof")).toBe(false);
  });
});
