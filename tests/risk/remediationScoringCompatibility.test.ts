import { describe, expect, it } from "vitest";
import { selectRecentFlowProvenanceTransfers } from "../../src/forensics/recentFlowProvenanceSelection";
import { buildUsddPsmExposure } from "../../src/risk/usddPsmExposure";
import {
  buildIncomingDepositMatrixCandidates,
  buildWalletMatrixCandidates
} from "../../src/risk/scoringSignalMatrixInputs";
import type { ForensicRouteEdge } from "../../src/types";
import {
  NOW,
  OWNER,
  SUBJECT,
  VERIFY20,
  psmObservation
} from "../fixtures/forensics/remediationScoringCases";
import {
  TGYT_DIRECT_BLACKLIST_CASE,
  tgytDirectInteractionProfiles,
  tgytFirstHopBlacklistFact
} from "../fixtures/forensics/directBlacklistCases";

const TX_HASH = "1".repeat(64);
const FEE_TX_HASH = "2".repeat(64);

function edge(input: {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  economicRole?: "principal" | "service_fee";
  economicProtocol?: "tron_gasfree";
}): ForensicRouteEdge {
  return {
    id: input.txHash,
    txHash: input.txHash,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.timestamp),
    method: "transfer",
    edgeType: "normal_transfer",
    economicRole: input.economicRole,
    economicProtocol: input.economicProtocol
  };
}

function whereReport(overrides: Record<string, unknown> = {}) {
  return {
    subjectAddress: SUBJECT,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    contractLlmVerdicts: [],
    assessment: {
      decision: "REVIEW",
      riskScore: 45,
      riskBand: "MEDIUM",
      provenanceConfidence: 100,
      coverageCompleteness: 100,
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      ageSignals: null,
      hardBadEvidence: [],
      sourcePolicyEvidence: [{
        kind: "htx_huobi",
        aggregateShare: 0.5,
        effectiveShare: 0.5,
        pathCount: 1,
        score: 45,
        riskBand: "MEDIUM",
        proofLevel: "exchange_policy_context",
        canBeDampened: false,
        reasons: ["Typed historical exchange context."],
        warnings: [],
        evidenceIds: ["where:policy"]
      }],
      contractSuspicionEvidence: [],
      unknownOriginEvidence: [],
      riskLayers: [],
      dominantRiskLayer: null,
      reasons: [],
      warnings: []
    },
    decision: "REVIEW",
    userDecision: "REVIEW",
    internalDecision: "REVIEW",
    proofLevel: "source_policy_review",
    riskScore: 45,
    scoreValid: true,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 1,
      selectedInboundVolumeRaw: "100000000",
      currentBalanceCoverageRatio: 1,
      coverageRatio: 1,
      checkedScope: "recent_flow",
      maxDepth: 20,
      fetchedAddressCount: 10,
      partial: false,
      notes: []
    },
    ...overrides
  } as any;
}

function fastReport() {
  return {
    subjectAddress: SUBJECT,
    level: "MEDIUM",
    score: 30,
    reasons: [{
      code: "fast_context",
      message: "Typed Fast context.",
      scoreImpact: 30
    }]
  } as any;
}

function directContractReport() {
  return {
    subjectAddress: SUBJECT,
    serviceLabel: null,
    limitations: [],
    verify20Fingerprint: {
      matched: true,
      blockedByTrustedService: false,
      missingSelectors: [],
      mismatchedSelectors: []
    }
  } as any;
}

describe("Plan 2 remediation scoring compatibility", () => {
  it("[REQ-01][REQ-30][COMPAT] structural GasFree principal stays eligible for latest-five scoring", async () => {
    const principal = edge({
      txHash: TX_HASH,
      fromAddress: OWNER,
      toAddress: SUBJECT,
      amountRaw: "100000000",
      timestamp: "2026-07-13T09:00:00.000Z",
      economicRole: "principal",
      economicProtocol: "tron_gasfree"
    });

    const selection = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SUBJECT,
      currentBalanceRaw: "0",
      edges: [principal],
      maxCandidates: 5
    });

    expect(selection.selectionMethod).toBe("recent_five_principal");
    expect(selection.recentFlowPrincipalTransfers).toContainEqual(expect.objectContaining({
      txHash: TX_HASH,
      economicRole: "principal"
    }));
    expect(selection.transfers).toContainEqual(expect.objectContaining({ txHash: TX_HASH }));
  });

  it("[REQ-02][COMPAT] exact GasFree service fee remains excluded from v3 scoring candidates", () => {
    const feeTransfer = {
      txHash: FEE_TX_HASH,
      fromAddress: SUBJECT,
      toAddress: VERIFY20,
      amountRaw: "3000000",
      timestamp: NOW.toISOString(),
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree"
    };
    const candidates = buildWalletMatrixCandidates({
      address: SUBJECT,
      fastReport: null,
      whereReport: whereReport(),
      deepReport: {
        subjectAddress: SUBJECT,
        firstHopBlacklistFacts: [{
          counterpartyAddress: VERIFY20,
          direction: "outbound",
          evidenceKind: "usdt_blacklist",
          evidenceAuthority: "official_contract",
          statusAtCheck: "active",
          temporalRelation: "active_at_transfer",
          effectiveAt: NOW.toISOString(),
          effectiveTxHash: null,
          checkedAt: NOW.toISOString(),
          principalAmountRaw: "3000000",
          principalTxCount: 1,
          directionalPrincipalShare: null,
          shareSemantics: "unavailable",
          transferTxHashes: [FEE_TX_HASH],
          beforeEffectiveAmountRaw: "0",
          beforeEffectiveTxCount: 0,
          activeAmountRaw: "3000000",
          activeTxCount: 1,
          unknownTimingAmountRaw: "0",
          unknownTimingTxCount: 0,
          directTransferCoverage: "partial",
          timelineCoverage: "partial",
          timelineEvents: []
        }],
        directCounterpartyInteractionProfiles: [{
          subjectAddress: SUBJECT,
          direction: "outbound",
          counterpartyAddress: VERIFY20,
          volumeRaw: "3000000",
          volumeRatio: 1,
          txCount: 1,
          firstSeen: NOW.toISOString(),
          lastSeen: NOW.toISOString(),
          txHashes: [FEE_TX_HASH],
          transfers: [feeTransfer],
          snapshot: {
            address: VERIFY20,
            riskScore: 0,
            riskLevel: "LOW",
            source: "stablecoin_blacklist",
            evidenceClass: "exact_labeled_counterparty",
            reasons: [],
            partialNotes: []
          },
          scoreContribution: 0,
          evidenceClass: "exact_labeled_counterparty",
          skippedReason: null
        }]
      } as any
    });

    expect(candidates.some((candidate) => candidate.row === "direct_counterparty_policy")).toBe(false);
    expect(JSON.stringify(candidates)).not.toContain(FEE_TX_HASH);
  });

  it("[COMPAT] recomputes legacy active denominators but never hardens legacy mixed facts", () => {
    const value = TGYT_DIRECT_BLACKLIST_CASE;
    const activeEventAt = "2026-05-26T08:00:00.000Z";
    const active = {
      ...tgytFirstHopBlacklistFact(),
      temporalRelation: "active_at_transfer" as const,
      effectiveAt: activeEventAt,
      beforeEffectiveAmountRaw: "0",
      beforeEffectiveTxCount: 0,
      activeAmountRaw: value.totalPrincipalRaw,
      activeTxCount: 2,
      timelineEvents: tgytFirstHopBlacklistFact().timelineEvents.map((event) => ({ ...event, occurredAt: activeEventAt }))
    } as ReturnType<typeof tgytFirstHopBlacklistFact> & Record<string, unknown>;
    delete active.directionalPrincipalTotalRaw;
    const build = (fact: ReturnType<typeof tgytFirstHopBlacklistFact>) => buildWalletMatrixCandidates({
      address: value.subjectAddress,
      fastReport: null,
      whereReport: whereReport({ subjectAddress: value.subjectAddress }),
      deepReport: {
        subjectAddress: value.subjectAddress,
        firstHopBlacklistFacts: [fact],
        directCounterpartyInteractionProfiles: tgytDirectInteractionProfiles()
      } as any
    }).filter((candidate) => candidate.row === "direct_counterparty_policy");
    expect(build(active)).toHaveLength(1);

    const mixedEventAt = "2026-05-26T09:50:00.000Z";
    const mixed = {
      ...active,
      temporalRelation: "mixed" as const,
      effectiveAt: mixedEventAt,
      beforeEffectiveAmountRaw: "15000000",
      beforeEffectiveTxCount: 1,
      activeAmountRaw: value.largestPrincipalRaw,
      activeTxCount: 1,
      timelineEvents: active.timelineEvents.map((event) => ({ ...event, occurredAt: mixedEventAt }))
    };
    expect(build(mixed)).toEqual([]);
  });

  it("[REQ-04][COMPAT] legacy v2 result is read without synthesizing ScoreAnchorV2", async () => {
    const { buildScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const legacy = JSON.parse(JSON.stringify({
      finalScore: 78,
      finalDecision: "DECLINE",
      scoreValid: true,
      matrixScore: {
        policyVersion: "scoring-signal-matrix-v2",
        policyScore: 78,
        matrixDecision: "DECLINE",
        winningRow: "source_policy"
      }
    }));

    const result = buildScoreAnchorV2({
      mode: "unified",
      subjectAddress: SUBJECT,
      disposition: {
        decision: legacy.finalDecision,
        finalScore: legacy.finalScore,
        observedContextScore: legacy.finalScore,
        scoreValid: legacy.scoreValid,
        decisionBasis: "independent_policy",
        coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
        hardProofEvidenceIds: [],
        decisiveCandidate: null
      },
      matrix: legacy.matrixScore,
      facts: []
    } as any);

    expect(legacy.matrixScore.policyVersion).toBe("scoring-signal-matrix-v2");
    expect(result).toEqual({ anchor: null, diagnostic: null });
    expect(legacy).not.toHaveProperty("scoreAnchorV2");
  });

  it("[REQ-05][COMPAT] direct contract result does not suppress Wallet/Incoming analysis", () => {
    const walletInput = {
      address: SUBJECT,
      fastReport: fastReport(),
      whereReport: whereReport()
    };
    const walletBaseline = buildWalletMatrixCandidates(walletInput);
    const walletWithContract = buildWalletMatrixCandidates({
      ...walletInput,
      smartContractReport: directContractReport()
    });
    for (const candidate of walletBaseline) expect(walletWithContract).toContainEqual(candidate);
    expect(walletWithContract).toContainEqual(expect.objectContaining({
      row: "contract_suspicion",
      atomicSignals: ["exact_verify20_contract_pattern"]
    }));

    const incomingInput = {
      senderAddress: SUBJECT,
      receiverAddress: OWNER,
      txHash: TX_HASH,
      fastReport: fastReport(),
      whereReport: whereReport()
    };
    const incomingBaseline = buildIncomingDepositMatrixCandidates(incomingInput);
    const incomingWithUnrelatedContractResult = buildIncomingDepositMatrixCandidates({
      ...incomingInput,
      smartContractReport: directContractReport()
    } as any);
    expect(incomingWithUnrelatedContractResult).toEqual(incomingBaseline);
    expect(incomingBaseline.length).toBeGreaterThan(0);
  });

  it("[REQ-18][COMPAT] ApprovalSafetyAssessmentV2 never enters AML score inputs", () => {
    const approvalSafetyAssessmentV2 = {
      version: "approval-safety-assessment-v2",
      subjectAddress: OWNER,
      spenderAddress: VERIFY20,
      score: 90,
      decision: "DECLINE",
      evidenceIds: ["approval-safety-only"]
    };
    const walletInput = {
      address: SUBJECT,
      fastReport: fastReport(),
      whereReport: whereReport()
    };
    const incomingInput = {
      senderAddress: SUBJECT,
      receiverAddress: OWNER,
      txHash: TX_HASH,
      fastReport: fastReport(),
      whereReport: whereReport()
    };

    const walletBaseline = buildWalletMatrixCandidates(walletInput);
    const incomingBaseline = buildIncomingDepositMatrixCandidates(incomingInput);
    const walletWithSafety = buildWalletMatrixCandidates({
      ...walletInput,
      approvalSafetyAssessmentV2
    } as any);
    const incomingWithSafety = buildIncomingDepositMatrixCandidates({
      ...incomingInput,
      approvalSafetyAssessmentV2
    } as any);

    expect(walletWithSafety).toEqual(walletBaseline);
    expect(incomingWithSafety).toEqual(incomingBaseline);
    expect(JSON.stringify([walletWithSafety, incomingWithSafety])).not.toContain("approval-safety-only");
  });

  it("[REQ-38][COMPAT] invalid anchor/PSM stays fail-closed and legacy LLM stays audit-only after JSON round-trip", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    expect(() => validateScoreAnchorV2({
      anchor: {
        version: "score-anchor-v2",
        policyVersion: "scoring-signal-matrix-v3",
        subjectAddress: SUBJECT,
        mode: "unified",
        score: 101,
        decision: "DECLINE",
        matrixRow: "source_policy",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "provider",
        evidenceIds: ["invalid-anchor"],
        primaryEvidenceIds: ["invalid-anchor"],
        preferredFactId: "fact:invalid",
        coverageDependency: "none"
      },
      checkedSubjectAddress: SUBJECT,
      checkedMode: "unified",
      evidence: [],
      facts: []
    } as any)).toThrow("score_anchor_fact_binding_failed");

    expect(buildUsddPsmExposure(psmObservation({
      amountRaw: "101000000",
      selectedAmountRaw: "100000000"
    }))).toBeNull();

    const legacyVerdict = {
      source: "cache",
      providerLabel: "legacy-provider",
      model: "legacy-model",
      contractAddress: VERIFY20,
      verdict: "drainer_like",
      confidence: 0.99,
      contractRiskScore: 96,
      decisionRecommendation: "DECLINE",
      reasons: ["legacy-llm-prose"],
      citedEvidenceIds: ["legacy-llm-citation"]
    };
    const baselineReport = JSON.parse(JSON.stringify(whereReport()));
    const legacyReport = JSON.parse(JSON.stringify({
      ...whereReport(),
      contractLlmVerdicts: [legacyVerdict]
    }));
    const originalLegacyPayload = JSON.parse(JSON.stringify(legacyReport.contractLlmVerdicts));

    expect(buildWalletMatrixCandidates({
      address: SUBJECT,
      fastReport: fastReport(),
      whereReport: legacyReport
    })).toEqual(buildWalletMatrixCandidates({
      address: SUBJECT,
      fastReport: fastReport(),
      whereReport: baselineReport
    }));
    expect(legacyReport.contractLlmVerdicts).toEqual(originalLegacyPayload);
    expect(JSON.stringify(legacyReport.contractLlmVerdicts)).toContain("legacy-llm-citation");
  });
});
