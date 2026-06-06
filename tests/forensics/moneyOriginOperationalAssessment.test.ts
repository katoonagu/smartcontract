import { describe, expect, it } from "vitest";
import { buildMoneyOriginOperationalAssessment, riskBandFromWhereScore } from "../../src/forensics/moneyOriginOperationalAssessment";
import type {
  ApprovalDrainReviewFinding,
  ApprovalDrainProvenanceProfile,
  ContractLlmVerdictSummary,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  RiskReport,
  RiskLayerScore,
  SourceBundleExposureProfile,
  SourceExposureKind,
  SourcePolicyEvidence,
  SubjectExposureProfile,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyHardBadEvidence,
  WhereIsMoneyCoverage
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const sender = "TSender1111111111111111111111111111111";
const funding = "TFunding111111111111111111111111111111";

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "LOW",
  score: 0,
  reasons: []
};

const mediumFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "MEDIUM",
  score: 55,
  reasons: [{ code: "medium_context", message: "Medium contextual risk.", scoreImpact: 55 }]
};

const criticalFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "CRITICAL",
  score: 90,
  reasons: [{ code: "critical_context", message: "Critical exact risk.", scoreImpact: 90, evidenceRef: "fast-evidence-1" }]
};

function coverage(overrides: Partial<WhereIsMoneyCoverage> = {}): WhereIsMoneyCoverage {
  return {
    selectedInboundTxCount: 2,
    currentBalanceRaw: "225240325624",
    requestedAmountRaw: null,
    targetAmountRaw: "225240325624",
    selectedAmountRaw: "225240325624",
    coverageRatio: 1,
    selectedInboundVolumeRaw: "225240325624",
    currentBalanceCoverageRatio: 1,
    maxDepth: 7,
    fetchedAddressCount: 19,
    partial: true,
    notes: [],
    ...overrides
  };
}

function reviewPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  return {
    balanceTransferTxHash: "tx-review",
    rootSourceAddress: funding,
    rootSourceType: "incomplete",
    balanceShare: 0.5,
    exposureSourceKey: null,
    exposureSourceLabel: null,
    pathAddresses: [funding, sender, subject],
    txHashes: ["tx-funding", "tx-review"],
    steps: [
      {
        txHash: "tx-funding",
        fromAddress: funding,
        toAddress: sender,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T09:00:00.000Z"
      },
      {
        txHash: "tx-review",
        fromAddress: sender,
        toAddress: subject,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T10:00:00.000Z"
      }
    ],
    amountPreservationRatio: 1,
    timeSpanMs: 60 * 60 * 1000,
    stoppedReason: "weak_amount_or_time_continuity",
    verdict: "REVIEW",
    riskScoreContribution: 30,
    reasons: ["Previous incoming transfers exist, but clean CEX origin is not fully proven."],
    ...overrides
  };
}

function cleanCexPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  return reviewPath({
    verdict: "ACCEPTABLE",
    rootSourceType: "allowlist_cex",
    stoppedReason: "allowlist_cex_reached",
    balanceShare: 1,
    riskScoreContribution: 5,
    reasons: ["Balance-forming path reaches allowlisted CEX Binance through clean on-chain hops."],
    ...overrides
  });
}

function profile(overrides: Partial<MoneyOriginSenderInteractionProfile> = {}): MoneyOriginSenderInteractionProfile {
  return {
    balanceTransferTxHash: "tx-review",
    senderAddress: sender,
    incomingVolumeRaw: "512624000216",
    outgoingVolumeRaw: "507355503200",
    incomingTxCount: 4,
    outgoingTxCount: 5,
    topIncomingCounterparties: [
      {
        address: funding,
        direction: "incoming",
        volumeRaw: "258493000000",
        txCount: 2,
        firstSeen: "2026-05-20T00:00:00.000Z",
        lastSeen: "2026-05-22T09:00:00.000Z",
        txHashes: ["tx-funding"]
      }
    ],
    topOutgoingCounterparties: [
      {
        address: subject,
        direction: "outgoing",
        volumeRaw: "100000000000",
        txCount: 1,
        firstSeen: "2026-05-22T10:00:00.000Z",
        lastSeen: "2026-05-22T10:00:00.000Z",
        txHashes: ["tx-review"]
      }
    ],
    fundingCandidates: [
      {
        txHash: "tx-funding",
        fromAddress: funding,
        toAddress: sender,
        amountRaw: "100000000000",
        timestamp: "2026-05-22T09:00:00.000Z",
        amountPreservationRatio: 1,
        timeDeltaMs: 60 * 60 * 1000
      }
    ],
    ...overrides
  };
}

function approvalDrainProfile(overrides: Partial<ApprovalDrainProvenanceProfile> = {}): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: "TVictim11111111111111111111111111111",
    approvalTxHash: "tx-approve",
    drainTxHash: "tx-drain",
    spenderAddress: "TSpender1111111111111111111111111111",
    operatorAddress: "TOperator111111111111111111111111111",
    spenderResolution: "wrapper_contract",
    falsePositiveGuards: [],
    supportingFingerprints: [],
    firstReceiverAddress: subject,
    subjectAddress: subject,
    hopDepth: 0,
    amountRaw: "100000000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-05-22T09:00:00.000Z",
    drainAt: "2026-05-22T10:00:00.000Z",
    pathTxHashes: ["tx-drain"],
    pathAddresses: ["TVictim11111111111111111111111111111", subject],
    score: 92,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: [],
    ...overrides
  };
}

function approvalReviewFinding(overrides: Partial<ApprovalDrainReviewFinding> = {}): ApprovalDrainReviewFinding {
  return {
    victimAddress: "TVictim11111111111111111111111111111",
    drainTxHash: "tx-review-drain",
    spenderAddress: "TSpender1111111111111111111111111111",
    operatorAddress: "TOperator111111111111111111111111111",
    spenderResolution: "wrapper_contract",
    firstReceiverAddress: subject,
    subjectAddress: subject,
    reason: "path_not_proven",
    falsePositiveGuards: [],
    supportingFingerprints: [],
    ...overrides
  };
}

function ageSignals(scoreImpact: number): WhereIsMoneyAgeSignals {
  return {
    subjectFirstSeenAt: "2025-01-01T00:00:00.000Z",
    subjectAgeDays: 500,
    subjectActiveDays: 10,
    directSenderMedianAgeDays: 300,
    oldestDirectSenderAgeDays: 400,
    repeatedRelationshipCount: scoreImpact < 0 ? 1 : 0,
    longestRelationshipAgeDays: scoreImpact < 0 ? 30 : null,
    maxDormancyGapDays: scoreImpact > 0 ? 120 : null,
    signals: [
      {
        code: scoreImpact < 0 ? "relationship_repeated" : "dormancy_gap",
        scoreImpact,
        message: "Fixture age signal.",
        value: null,
        evidenceIds: ["tx-age"]
      }
    ]
  };
}

function sourceBundleExposureProfile(overrides: Partial<SourceBundleExposureProfile> = {}): SourceBundleExposureProfile {
  return {
    scope: "where_requested_amount",
    targetAmountRaw: "1000000000",
    coveredAmountRaw: "1000000000",
    coverageRatio: 1,
    htxHuobiShare: 0,
    cleanCexShare: 1,
    bridgeRouterDexShare: 0,
    unknownContractShare: 0,
    riskyLabelShare: 0,
    unknownShare: 0,
    dominantSource: "clean_cex",
    evidenceTxHashes: ["tx-source-bundle"],
    reasons: ["Fixture source bundle exposure."],
    warnings: [],
    budget: {
      maxDepth: 7,
      fetchedAddressCount: 3,
      maxAddressFetches: 20,
      liveTransferReadCount: 4,
      skippedAddressCount: 0,
      exhausted: false,
      exhaustedPhase: null
    },
    unresolvedBoundary: null,
    ...overrides
  };
}

function subjectExposureProfile(overrides: Partial<SubjectExposureProfile> = {}): SubjectExposureProfile {
  return {
    subjectAddress: subject,
    windowStart: "2026-05-01T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    transferEventsScanned: 4,
    incomingVolumeRaw: "1000000000",
    outgoingVolumeRaw: "900000000",
    htxHuobiIncomingShare: 0,
    cleanCexIncomingShare: 1,
    bridgeRouterDexVolumeShare: 0,
    unknownContractVolumeShare: 0,
    unknownSourceShare: 0,
    inOutVelocityScore: 0,
    scoreContribution: 0,
    reasons: ["Fixture subject exposure."],
    warnings: [],
    ...overrides
  };
}

function assessmentInput(overrides: Partial<Parameters<typeof buildMoneyOriginOperationalAssessment>[0]> = {}): Parameters<typeof buildMoneyOriginOperationalAssessment>[0] {
  return {
    fastWalletRisk: lowFastRisk,
    originPaths: [reviewPath()],
    senderInteractionProfiles: [profile()],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    coverage: coverage(),
    ...overrides
  };
}

function legitimateServiceVerdict(overrides: Partial<ContractLlmVerdictSummary> = {}): ContractLlmVerdictSummary {
  return {
    source: "llm",
    providerLabel: "deepseek",
    model: "deepseek-v4-pro",
    contractAddress: "TContract111111111111111111111111111",
    caseFileHash: "case-hash",
    cacheId: null,
    verdict: "legitimate_service",
    confidence: 0.86,
    contractRiskScore: 20,
    decisionRecommendation: "ACCEPTABLE",
    reasons: ["Contract is a legitimate service."],
    citedEvidenceIds: ["tx-llm"],
    falsePositiveNotes: [],
    ...overrides
  };
}

function extraSourcePolicyEvidence(kind: SourceExposureKind, score: number): SourcePolicyEvidence {
  return {
    kind,
    aggregateShare: 1,
    effectiveShare: 1,
    pathCount: 1,
    score,
    riskBand: riskBandFromWhereScore(score),
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: kind !== "no_name_token_liquidity" && kind !== "mixer",
    reasons: [`Extra ${kind} source-policy evidence.`],
    warnings: [],
    evidenceIds: [`extra-${kind}`]
  };
}

function extraRiskLayer(overrides: Partial<RiskLayerScore> = {}): RiskLayerScore {
  const score = overrides.score ?? 66;
  return {
    evidenceClass: "source_policy",
    kind: "extra_layer",
    score,
    rawScore: score,
    adjustedScore: score,
    proofLevel: score >= 60 ? "exchange_policy_decline" : "exchange_policy_context",
    canBeDampened: true,
    reasons: ["Extra risk layer."],
    warnings: [],
    evidenceIds: ["extra-layer"],
    ...overrides
  };
}

function extraSanctionedHardEvidence(overrides: Partial<WhereIsMoneyHardBadEvidence> = {}): WhereIsMoneyHardBadEvidence {
  return {
    kind: "sanctioned_service",
    score: 99,
    message: "Cross-chain corridor reached a sanctioned service.",
    evidenceIds: ["extra-sanctioned-hard"],
    ...overrides
  };
}

describe("riskBandFromWhereScore", () => {
  it("uses the where-is-money operational thresholds", () => {
    expect(riskBandFromWhereScore(0)).toBe("LOW");
    expect(riskBandFromWhereScore(19)).toBe("LOW");
    expect(riskBandFromWhereScore(20)).toBe("LOW-MEDIUM");
    expect(riskBandFromWhereScore(44)).toBe("LOW-MEDIUM");
    expect(riskBandFromWhereScore(45)).toBe("MEDIUM");
    expect(riskBandFromWhereScore(59)).toBe("MEDIUM");
    expect(riskBandFromWhereScore(60)).toBe("HIGH");
    expect(riskBandFromWhereScore(84)).toBe("HIGH");
    expect(riskBandFromWhereScore(85)).toBe("CRITICAL");
  });
});

describe("buildMoneyOriginOperationalAssessment", () => {
  it("floors selected risky-label source bundle share at 85 and declines", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      sourceBundleExposure: sourceBundleExposureProfile({
        riskyLabelShare: 0.1,
        cleanCexShare: 0.9,
        dominantSource: "risky_label"
      })
    }));

    expect(assessment.riskScore).toBeGreaterThanOrEqual(85);
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "risky_label",
        score: 85,
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
  });

  it("applies the 10 percent HTX/Huobi context floor before clean CEX acceptance", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [cleanCexPath()],
      senderInteractionProfiles: [],
      sourceBundleExposure: sourceBundleExposureProfile({
        htxHuobiShare: 0.1,
        cleanCexShare: 0.9,
        dominantSource: "clean_cex"
      })
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(55);
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "htx_huobi",
        score: 55,
        proofLevel: "exchange_policy_context",
        canBeDampened: true
      })
    ]));
  });

  it("applies the 50 percent unknown-contract context floor before clean CEX acceptance", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [cleanCexPath()],
      senderInteractionProfiles: [],
      sourceBundleExposure: sourceBundleExposureProfile({
        unknownContractShare: 0.5,
        cleanCexShare: 0.5,
        dominantSource: "clean_cex"
      })
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(45);
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "unknown_contract",
        score: 45,
        proofLevel: "exchange_policy_context",
        canBeDampened: true
      })
    ]));
  });

  it("floors selected HTX/Huobi source bundle share at 85 and declines", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      sourceBundleExposure: sourceBundleExposureProfile({
        htxHuobiShare: 0.7,
        cleanCexShare: 0.3,
        dominantSource: "htx_huobi"
      })
    }));

    expect(assessment.riskScore).toBeGreaterThanOrEqual(85);
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "htx_huobi",
        score: 85,
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
  });

  it("floors selected HTX/Huobi source bundle share at 70 and declines", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      sourceBundleExposure: sourceBundleExposureProfile({
        htxHuobiShare: 0.31,
        cleanCexShare: 0.69,
        dominantSource: "htx_huobi"
      })
    }));

    expect(assessment.riskScore).toBeGreaterThanOrEqual(70);
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "htx_huobi",
        score: 70,
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
  });

  it("floors selected bridge/router/dex source bundle share at 60 and declines", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      sourceBundleExposure: sourceBundleExposureProfile({
        bridgeRouterDexShare: 0.5,
        cleanCexShare: 0.5,
        dominantSource: "bridge_router_dex"
      })
    }));

    expect(assessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bridge_router_dex",
        score: 60,
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
  });

  it("adds capped subject exposure context without declining by itself", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      subjectExposureProfile: subjectExposureProfile({
        scoreContribution: 20,
        htxHuobiIncomingShare: 0.2,
        reasons: ["Subject has contextual HTX/Huobi background exposure."]
      })
    }));
    const subjectLayer = assessment.riskLayers.find((layer) => layer.kind === "subject_exposure_context");

    expect(subjectLayer).toMatchObject({
      evidenceClass: "behavior_context",
      proofLevel: "operational_liquidity_context",
      canBeDampened: true,
      score: 20,
      rawScore: 20,
      adjustedScore: 20
    });
    expect(assessment.sourcePolicyEvidence.map((item) => item.kind)).not.toContain("htx_huobi");
    expect(assessment.riskScore).toBeLessThan(70);
    expect(assessment.decision).not.toBe("DECLINE");
  });

  it("accepts an operational liquidity wallet when no hard bad evidence exists", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({ balanceShare: 0.45 }),
        reviewPath({ balanceTransferTxHash: "tx-review-2", balanceShare: 0.55 })
      ],
      senderInteractionProfiles: [
        profile(),
        profile({
          balanceTransferTxHash: "tx-review-2",
          incomingVolumeRaw: "1399178000000",
          outgoingVolumeRaw: "1382660771000",
          incomingTxCount: 8,
          outgoingTxCount: 9
        })
      ]
    }));

    expect(assessment).toMatchObject({
      decision: "ACCEPTABLE",
      riskBand: "LOW-MEDIUM",
      walletRole: "operational_liquidity_wallet",
      hardBadEvidence: []
    });
    expect(assessment.riskScore).toBeGreaterThanOrEqual(25);
    expect(assessment.riskScore).toBeLessThanOrEqual(40);
    expect(assessment.provenanceConfidence).toBeGreaterThanOrEqual(45);
    expect(assessment.reasons.join(" ")).toContain("operational/liquidity wallet");
    expect(assessment.unknownOriginEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "unknown_origin",
        proofLevel: "operational_liquidity_context"
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "unknown_origin",
      proofLevel: "operational_liquidity_context"
    }));
  });

  it("keeps unresolved recent-flow operational wallets low-medium without hard evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          riskScoreContribution: 35,
          stoppedReason: "no_previous_transfer",
          balanceShare: 1,
          reasons: ["No previous inbound USDT transfer found before this recent-flow anchor."]
        })
      ],
      coverage: coverage({
        selectedInboundTxCount: 2,
        currentBalanceRaw: "147000",
        requestedAmountRaw: null,
        targetAmountRaw: "89473150000",
        selectedAmountRaw: "89473150000",
        coverageRatio: 1,
        selectedInboundVolumeRaw: "89473150000",
        currentBalanceCoverageRatio: 0,
        provenanceScope: "recent_flow",
        anchorTransfer: {
          txHash: "out-anchor",
          direction: "outgoing",
          fromAddress: subject,
          toAddress: "TReceiver11111111111111111111111111",
          amountRaw: "89473150000",
          timestamp: "2026-05-05T08:49:27.000Z",
          reason: "latest_meaningful_outgoing"
        },
        lowBalanceThresholdRaw: "1000000000",
        dataScopeNote: "Low-balance recent-flow mode.",
        partial: true
      }),
      ageSignals: null
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeLessThanOrEqual(40);
    expect(assessment.riskBand).toBe("LOW-MEDIUM");
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.reasons.join(" ")).toContain("Recent-flow source is not fully proven");
  });

  it("keeps LLM-unavailable safe default ahead of operational liquidity downgrades", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({ balanceShare: 0.45 }),
        reviewPath({ balanceTransferTxHash: "tx-review-2", balanceShare: 0.55 })
      ],
      senderInteractionProfiles: [
        profile(),
        profile({
          balanceTransferTxHash: "tx-review-2",
          incomingVolumeRaw: "1399178000000",
          outgoingVolumeRaw: "1382660771000",
          incomingTxCount: 8,
          outgoingTxCount: 9
        })
      ],
      contractLlmVerdicts: [{
        source: "unavailable",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "unknown_insufficient_data",
        confidence: 0,
        contractRiskScore: 65,
        decisionRecommendation: "DECLINE",
        reasons: ["Clean contract intent could not be verified automatically."],
        citedEvidenceIds: [],
        falsePositiveNotes: [],
        error: "llm timed out"
      }]
    }));

    expect(assessment).toMatchObject({
      decision: "DECLINE",
      riskScore: 65,
      riskBand: "HIGH",
      walletRole: "operational_liquidity_wallet",
      hardBadEvidence: []
    });
    expect(assessment.reasons.join(" ")).toContain("LLM unavailable: llm timed out");
    expect(assessment.warnings.join(" ")).toContain("LLM contract verdict unavailable");
  });

  it("declines exact approval-drain provenance as hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      approvalDrainProvenanceProfiles: [approvalDrainProfile()]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(90);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
  });

  it("declines exact risky labels as scam or blacklist hard evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "risky_label",
          stoppedReason: "risky_label_reached",
          balanceShare: 1,
          riskScoreContribution: 90,
          reasons: ["Balance-forming path reaches high-risk label scam; exchange policy declines this source."]
        })
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(90);
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scam_or_blacklist" })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "hard_proof",
      proofLevel: "exact_scam_or_taint_proof"
    }));
  });

  it("keeps small WhiteBIT as medium source-policy context without hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.1,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          riskScoreContribution: 38,
          reasons: ["Balance-forming path has WhiteBIT exposure (10% of selected provenance target); this is medium source-policy risk, not direct scam/blacklist proof."]
        })
      ]
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeLessThan(60);
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "whitebit",
        proofLevel: "exchange_policy_context"
      })
    ]));
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "source_policy",
        sourceExposureKind: "whitebit"
      })
    ]));
  });

  it("does not apply a fixed WhiteBIT decline floor for tiny exposure", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.03,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          effectiveExposureShare: 0.03,
          riskScoreContribution: 24,
          reasons: ["Balance-forming path has WhiteBIT exposure."]
        })
      ]
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeLessThan(45);
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.sourcePolicyEvidence[0]).toMatchObject({
      kind: "whitebit",
      proofLevel: "exchange_policy_context"
    });
  });

  it("uses WhiteBIT source-policy reasons when another path appears first", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          reasons: ["Unrelated clean/review path reason."]
        }),
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.1,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          riskScoreContribution: 38,
          reasons: ["Balance-forming path has WhiteBIT exposure."]
        })
      ]
    }));

    expect(assessment.reasons.join(" ")).toContain("operational/liquidity wallet");
    expect(assessment.sourcePolicyEvidence[0]?.reasons.join(" ")).toContain("whitebit exposure");
  });

  it("keeps minority HTX/Huobi exposure out of hard evidence and accepts operational wallets", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.15,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 45,
          reasons: ["Balance-forming path reaches HTX/Huobi exposure (15% of selected provenance target); this is source-policy risk, not direct scam/blacklist proof."]
        })
      ]
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(35);
    expect(assessment.riskScore).toBeLessThanOrEqual(55);
    expect(assessment.riskBand).toBe("LOW-MEDIUM");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("htx_huobi_source");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "htx_huobi",
        proofLevel: "exchange_policy_context"
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "htx_huobi",
      proofLevel: "exchange_policy_context"
    }));
  });

  it("declines majority HTX/Huobi through a source-policy dominant layer without hard source evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.62,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches HTX/Huobi exposure (62% of selected provenance target); this is source-policy risk, not direct scam/blacklist proof."]
        })
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(78);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("htx_huobi_source");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "htx_huobi",
        proofLevel: "exchange_policy_decline"
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "htx_huobi",
      proofLevel: "exchange_policy_decline"
    }));
  });

  it("uses aggregate source-policy decline layer when contextual exposures combine above threshold", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.19,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 45,
          reasons: ["Balance-forming path reaches HTX/Huobi exposure; this is source-policy risk, not direct scam/blacklist proof."]
        }),
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.45,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          riskScoreContribution: 55,
          reasons: ["Balance-forming path has WhiteBIT exposure; this is medium source-policy risk, not direct scam/blacklist proof."]
        })
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      kind: "aggregate_source_policy",
      proofLevel: "exchange_policy_decline"
    }));
  });

  it("does not report final risk below the dominant contextual source-policy layer", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.49,
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          sourceExposureKind: "whitebit",
          riskScoreContribution: 52,
          reasons: ["Balance-forming path has WhiteBIT exposure; this is medium source-policy risk, not direct scam/blacklist proof."]
        })
      ],
      senderInteractionProfiles: []
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.dominantRiskLayer?.score ?? 0).toBeGreaterThan(0);
    expect(assessment.riskScore).toBeGreaterThanOrEqual(assessment.dominantRiskLayer?.score ?? 0);
  });

  it("declines fast critical evidence as hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      fastWalletRisk: criticalFastRisk
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(90);
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "fast_critical", evidenceIds: ["fast-evidence-1"] })
    ]));
  });

  it("keeps exact approval-drain proof as dominant even when source-policy score is higher", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches HTX/Huobi exposure; this is source-policy risk, not direct scam/blacklist proof."]
        })
      ],
      approvalDrainProvenanceProfiles: [approvalDrainProfile({ score: 92 })]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      kind: "approval_drain",
      proofLevel: "exact_approval_drain_provenance"
    }));
  });

  it("declines bridge/router/DEX boundaries as source-policy evidence but not hard bad evidence", () => {
    const bridgeAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches bridge boundary."]
        })
      ]
    }));
    const unknownContractAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "unknown",
          stoppedReason: "unlabeled_service_boundary",
          balanceShare: 1,
          exposureSourceKey: "unknown_contract",
          sourceExposureKind: "unknown_contract",
          riskScoreContribution: 55,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        })
      ]
    }));

    expect(bridgeAssessment.decision).toBe("DECLINE");
    expect(bridgeAssessment.hardBadEvidence.map((item) => item.kind)).not.toContain("bridge_router_dex_boundary");
    expect(bridgeAssessment.sourcePolicyEvidence[0]).toMatchObject({
      kind: "bridge_router_dex",
      proofLevel: "exchange_policy_decline"
    });
    expect(unknownContractAssessment.hardBadEvidence.map((item) => item.kind)).not.toContain("unknown_contract_boundary");
    expect(unknownContractAssessment.hardBadEvidence).toHaveLength(0);
    expect(unknownContractAssessment.sourcePolicyEvidence[0]).toMatchObject({
      kind: "unknown_contract",
      proofLevel: "exchange_policy_context"
    });
  });

  it("keeps minority bridge/router/DEX exposure contextual against the selected amount", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      coverage: coverage({
        targetAmountRaw: "46000000000",
        selectedAmountRaw: "46000000000",
        checkedScope: "transaction_seed",
        provenanceScope: "transaction_seed"
      }),
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 4060 / 46000,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 30,
          reasons: ["Balance-forming path reaches bridge boundary."]
        })
      ]
    }));

    expect(assessment.decision).not.toBe("DECLINE");
    expect(assessment.riskScore).toBeLessThan(45);
    expect(assessment.sourcePolicyEvidence[0]?.shareDetail).toMatchObject({
      scope: "where_selected_amount",
      targetAmountRaw: "46000000000",
      affectedAmountRaw: "4060000000",
      shareCap: 30
    });
  });

  it("lets high-confidence LLM legitimate_service lower unknown contract boundary risk", () => {
    const contract = "TContract111111111111111111111111111";
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          rootSourceAddress: contract,
          pathAddresses: [contract, sender, subject],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 65,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [legitimateServiceVerdict({ contractAddress: contract })]
    }));

    expect(assessment).toMatchObject({
      decision: "ACCEPTABLE",
      riskBand: "LOW-MEDIUM",
      hardBadEvidence: []
    });
    expect(assessment.riskScore).toBeLessThanOrEqual(35);
    expect(assessment.riskScore).toBeGreaterThanOrEqual(assessment.dominantRiskLayer?.score ?? 0);
    expect(assessment.reasons).toEqual([
      "Clean CEX origin is not fully proven; unknown contract boundary was downgraded because AI classified the contract as a legitimate service and no hard bad evidence was found."
    ]);
  });

  it("does not let one legitimate_service verdict lower unrelated unresolved contract paths", () => {
    const coveredContract = "TCoveredContract111111111111111111";
    const unresolvedContract = "TUncoveredContract111111111111111";
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          rootSourceAddress: coveredContract,
          pathAddresses: [coveredContract, sender, subject],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 65,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        }),
        reviewPath({
          balanceTransferTxHash: "tx-review-2",
          rootSourceAddress: unresolvedContract,
          pathAddresses: [unresolvedContract, sender, subject],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 65,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [legitimateServiceVerdict({ contractAddress: coveredContract })]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThan(35);
    expect(assessment.reasons.join(" ")).not.toContain("downgraded");
  });

  it("does not let LLM legitimate_service override strict bridge/router/DEX source policy", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches bridge router boundary."]
        })
      ],
      contractLlmVerdicts: [legitimateServiceVerdict()]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("bridge_router_dex_boundary");
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "bridge_router_dex",
      proofLevel: "exchange_policy_decline"
    }));
  });

  it("does not let LLM legitimate_service override structured bridge/router/DEX boundary fields", () => {
    const keyAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge",
          exposureSourceLabel: null,
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches a declined service boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [legitimateServiceVerdict()]
    }));
    const labelAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: null,
          exposureSourceLabel: "DEX aggregator",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches a declined service boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [legitimateServiceVerdict()]
    }));

    expect(keyAssessment.decision).toBe("DECLINE");
    expect(keyAssessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(keyAssessment.hardBadEvidence).toEqual([]);
    expect(keyAssessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    }));
    expect(keyAssessment.reasons.join(" ")).not.toContain("downgraded");
    expect(labelAssessment.decision).toBe("DECLINE");
    expect(labelAssessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(labelAssessment.hardBadEvidence).toEqual([]);
    expect(labelAssessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    }));
    expect(labelAssessment.reasons.join(" ")).not.toContain("downgraded");
  });

  it("does not let LLM legitimate_service override structured bridge/router/DEX keys with separators", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge_pool",
          exposureSourceLabel: null,
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches a declined service boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [legitimateServiceVerdict()]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    }));
    expect(assessment.reasons.join(" ")).not.toContain("downgraded");
  });

  it("does not let LLM legitimate_service override mixed unavailable safe-default verdicts", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 65,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [
        legitimateServiceVerdict(),
        {
          source: "unavailable",
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TOtherContract111111111111111111111",
          caseFileHash: "case-hash-2",
          cacheId: null,
          verdict: "unknown_insufficient_data",
          confidence: 0,
          contractRiskScore: 65,
          decisionRecommendation: "DECLINE",
          reasons: ["Contract analysis unavailable."],
          citedEvidenceIds: [],
          falsePositiveNotes: [],
          error: "llm timed out"
        }
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(65);
    expect(assessment.reasons.join(" ")).toContain("LLM unavailable: llm timed out");
    expect(assessment.reasons.join(" ")).not.toContain("downgraded");
  });

  it("does not let low-confidence LLM legitimate_service lower unknown contract boundary risk", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 65,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [legitimateServiceVerdict({ confidence: 0.79 })]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThan(35);
    expect(assessment.hardBadEvidence).toHaveLength(0);
    expect(assessment.reasons.join(" ")).not.toContain("downgraded");
  });

  it("declines high-confidence LLM drainer verdicts as capped contextual suspicion", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.8,
        contractRiskScore: 82,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeLessThanOrEqual(80);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "drainer_like",
        score: 80,
        proofLevel: "llm_assisted_suspicion",
        canBeDampened: true,
        evidenceIds: ["tx-llm"]
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      kind: "drainer_like",
      proofLevel: "llm_assisted_suspicion"
    }));
    expect(assessment.warnings.join(" ")).toContain("LLM contract suspicion is contextual unless exact approval-drain provenance is proven");
  });

  it("caps high-score LLM drainer verdicts even when provider confidence is missing", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0,
        contractRiskScore: 98,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeLessThanOrEqual(80);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "drainer_like",
        score: 80,
        proofLevel: "llm_assisted_suspicion",
        canBeDampened: true
      })
    ]));
  });

  it("caps unknown_suspicious LLM suspicion and keeps it out of hard evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 70,
          reasons: ["Balance-forming path reaches unknown contract boundary."]
        })
      ],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "unknown_suspicious",
        confidence: 0.85,
        contractRiskScore: 99,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract metadata was suspicious."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeLessThanOrEqual(75);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "unknown_suspicious",
        score: 75,
        proofLevel: "llm_assisted_suspicion",
        canBeDampened: true
      })
    ]));
  });

  it("keeps exact approval-drain hard proof ahead of LLM suspicion", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      approvalDrainProvenanceProfiles: [
        approvalDrainProfile({
          approvalTxHash: "tx-exact-approve",
          drainTxHash: "tx-exact-drain",
          pathTxHashes: ["tx-exact-drain"],
          evidenceStrength: "exact_approval_and_transfer_from",
          score: 96
        })
      ],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.92,
        contractRiskScore: 99,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(95);
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "approval_drain", evidenceIds: ["tx-exact-approve", "tx-exact-drain", "tx-exact-drain"] })
    ]));
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "drainer_like", proofLevel: "llm_assisted_suspicion" })
    ]));
  });

  it("floors exact approval-drain hard proof at 95", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      approvalDrainProvenanceProfiles: [
        approvalDrainProfile({
          score: 90,
          evidenceStrength: "exact_approval_and_transfer_from"
        })
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(95);
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "approval_drain", score: 95 })
    ]));
  });

  it("does not let capped LLM suspicion downgrade stronger source-policy decline", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.62,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches HTX/Huobi exposure (62% of selected provenance target); this is source-policy risk, not direct scam/blacklist proof."]
        })
      ],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.92,
        contractRiskScore: 95,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(78);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "drainer_like",
        score: 80,
        proofLevel: "llm_assisted_suspicion"
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "htx_huobi",
      proofLevel: "exchange_policy_decline"
    }));
  });

  it("keeps unguarded source-policy decline ahead of LLM suspicion even when another guarded route exists", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-guarded-route",
          txHashes: ["tx-guarded-route"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.5,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 75,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Guarded service-route path reaches a bridge boundary."]
        }),
        reviewPath({
          balanceTransferTxHash: "tx-unguarded-htx",
          txHashes: ["tx-unguarded-htx"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.62,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 78,
          reasons: ["Unguarded HTX/Huobi source-policy decline."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          drainTxHash: "tx-guarded-route",
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TUnrelated1111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 96,
        decisionRecommendation: "DECLINE",
        reasons: ["Unrelated contract behaves like drainer."],
        citedEvidenceIds: ["tx-unrelated-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(78);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "htx_huobi",
        proofLevel: "exchange_policy_decline"
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      proofLevel: "exchange_policy_decline"
    }));
  });

  it("keeps exact approval-drain evidence ahead of higher route-linked profiles under a service-route guard", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 75,
          balanceShare: 1,
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainProvenanceProfiles: [
        approvalDrainProfile({
          approvalTxHash: "tx-exact-approve",
          drainTxHash: "tx-exact-drain",
          pathTxHashes: ["tx-exact-drain"],
          evidenceStrength: "exact_approval_and_transfer_from",
          score: 92
        }),
        approvalDrainProfile({
          approvalTxHash: "tx-route-approve",
          drainTxHash: "tx-route-drain",
          pathTxHashes: ["tx-route-drain"],
          evidenceStrength: "route_linked",
          score: 99
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.hardBadEvidence[0]).toEqual(expect.objectContaining({
      kind: "approval_drain",
      score: 95,
      evidenceIds: ["tx-exact-approve", "tx-exact-drain", "tx-exact-drain"]
    }));
    expect(assessment.hardBadEvidence.flatMap((item) => item.evidenceIds)).not.toContain("tx-route-drain");
    expect(assessment.reasons.join(" ")).toContain("Exact approval-drain provenance");
    expect(assessment.reasons.join(" ")).not.toContain("Service boundary reached");
  });

  it("keeps unrelated drainer-like LLM verdicts as contextual suspicion when service-route guard suppresses a guarded verdict", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 92,
          balanceShare: 1,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      contractLlmVerdicts: [
        {
          source: "llm",
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TLayerZero11111111111111111111111111",
          caseFileHash: "case-hash",
          cacheId: null,
          verdict: "drainer_like",
          confidence: 0.9,
          contractRiskScore: 95,
          decisionRecommendation: "DECLINE",
          reasons: ["Guarded service-route contract was suspicious."],
          citedEvidenceIds: ["tx-review-drain"],
          falsePositiveNotes: []
        },
        {
          source: "llm",
          providerLabel: "deepseek",
          model: "deepseek-v4-pro",
          contractAddress: "TUnrelated1111111111111111111111111",
          caseFileHash: "case-hash",
          cacheId: null,
          verdict: "drainer_like",
          confidence: 0.9,
          contractRiskScore: 96,
          decisionRecommendation: "DECLINE",
          reasons: ["Unrelated contract behaves like drainer."],
          citedEvidenceIds: ["tx-unrelated-llm"],
          falsePositiveNotes: []
        }
      ],
      coverage: coverage({
        provenanceScope: "recent_flow"
      })
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThan(75);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.contractSuspicionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "drainer_like", evidenceIds: ["tx-unrelated-llm"] })
    ]));
    expect(assessment.hardBadEvidence.flatMap((item) => item.evidenceIds)).not.toContain("tx-review-drain");
    expect(assessment.reasons.join(" ")).toContain("LLM contract verdict is drainer_like");
    expect(assessment.reasons.join(" ")).not.toContain("Service boundary reached");
  });

  it("keeps unrelated bridge/router decline paths as source-policy evidence when a service-route guard exists", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-unrelated-bridge",
          rootSourceAddress: "TUnrelatedRoot111111111111111111111",
          pathAddresses: [
            "TUnrelatedRoot111111111111111111111",
            "TUnrelatedHop1111111111111111111111",
            subject
          ],
          txHashes: ["tx-unrelated-bridge"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 90,
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          reasons: ["Balance-forming path reaches unrelated bridge/router boundary."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          firstReceiverAddress: "TGuardedReceiver11111111111111111111",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      coverage: coverage({
        provenanceScope: "recent_flow"
      })
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThan(75);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("bridge_router_dex_boundary");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bridge_router_dex",
        evidenceIds: ["tx-unrelated-bridge"]
      })
    ]));
    expect(assessment.reasons).toEqual(["Balance-forming path reaches unrelated bridge/router boundary."]);
    expect(assessment.reasons.join(" ")).not.toContain("Service boundary reached");
  });

  it("caps drainer-like LLM suspicion when approval review found a service-route guard", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 92,
          balanceShare: 1,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainProvenanceProfiles: [],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TLayerZero11111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 95,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-review-drain"],
        falsePositiveNotes: []
      }],
      coverage: coverage({
        provenanceScope: "recent_flow"
      })
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeLessThanOrEqual(75);
    expect(assessment.riskBand).toBe("HIGH");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("bridge_router_dex_boundary");
    expect(assessment.reasons.join(" ")).toContain("Service boundary reached");
    expect(assessment.reasons.join(" ")).toContain("drainer proof is not proven");
    expect(assessment.warnings.join(" ")).toContain("service_boundary_guard");
  });

  it("caps route-linked approval drain profiles when a service-route guard exists", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 92,
          balanceShare: 1,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainProvenanceProfiles: [
        approvalDrainProfile({
          evidenceStrength: "route_linked",
          score: 92
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TLayerZero11111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 95,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-review-drain"],
        falsePositiveNotes: []
      }],
      coverage: coverage({
        provenanceScope: "recent_flow"
      })
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeLessThanOrEqual(75);
    expect(assessment.riskBand).toBe("HIGH");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("approval_drain");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("llm_contract_suspicion");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("bridge_router_dex_boundary");
    expect(assessment.reasons.join(" ")).toContain("Service boundary reached");
  });

  it("does not cap non-dampenable source-policy declines under a service-route guard", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-no-name-liquidity",
          txHashes: ["tx-no-name-liquidity"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 95,
          balanceShare: 0.5,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          exposureSourceKey: "no_name_token_liquidity",
          exposureSourceLabel: "No-name token liquidity",
          sourceExposureKind: "no_name_token_liquidity",
          reasons: ["Balance-forming path reaches no-name token liquidity."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      coverage: coverage({
        provenanceScope: "recent_flow"
      })
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(88);
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "no_name_token_liquidity",
        score: 88,
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "no_name_token_liquidity",
      score: 88,
      adjustedScore: 88,
      canBeDampened: false
    }));
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "source_policy",
        kind: "aggregate_source_policy",
        score: 88,
        adjustedScore: 88
      })
    ]));
    expect(assessment.reasons.join(" ")).not.toContain("Service boundary reached");
  });

  it("keeps non-dampenable mixer source-policy decline ahead of higher LLM suspicion", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-low-share-mixer",
          txHashes: ["tx-low-share-mixer"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 78,
          balanceShare: 0.15,
          exposureSourceKey: "mixer",
          exposureSourceLabel: "Mixer",
          sourceExposureKind: "mixer",
          amountPreservationRatio: 0.15,
          timeSpanMs: 45 * 24 * 60 * 60 * 1000,
          steps: [
            {
              txHash: "tx-mixer-hop",
              fromAddress: funding,
              toAddress: sender,
              amountRaw: "100000000000",
              timestamp: "2026-04-01T00:00:00.000Z"
            },
            {
              txHash: "tx-low-share-mixer",
              fromAddress: sender,
              toAddress: subject,
              amountRaw: "15000000000",
              timestamp: "2026-05-16T00:00:00.000Z"
            }
          ],
          reasons: ["Balance-forming path reaches mixer source-policy exposure."]
        })
      ],
      senderInteractionProfiles: [],
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 96,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(78);
    expect(assessment.reasons).toEqual(["Balance-forming path reaches mixer source-policy exposure."]);
    expect(assessment.reasons.join(" ")).not.toContain("LLM contract verdict is drainer_like");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "mixer",
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "mixer",
      proofLevel: "exchange_policy_decline"
    }));
  });

  it("classifies unstructured no-name token liquidity text as source-policy evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-unstructured-no-name",
          txHashes: ["tx-unstructured-no-name"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 88,
          balanceShare: 0.5,
          exposureSourceKey: "terminal_boundary",
          exposureSourceLabel: "Unlabeled token pool",
          sourceExposureKind: null,
          reasons: ["Balance-forming path reaches no-name token liquidity exposure."]
        })
      ],
      senderInteractionProfiles: []
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "no_name_token_liquidity",
        score: 88,
        proofLevel: "exchange_policy_decline",
        canBeDampened: false
      })
    ]));
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "no_name_token_liquidity"
    }));
  });

  it("keeps independent unresolved-origin risk in the top-level score alongside capped source-policy evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-no-name-liquidity",
          txHashes: ["tx-no-name-liquidity"],
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 95,
          balanceShare: 0.5,
          exposureSourceKey: "no_name_token_liquidity",
          exposureSourceLabel: "No-name token liquidity",
          sourceExposureKind: "no_name_token_liquidity",
          reasons: ["Balance-forming path reaches no-name token liquidity."]
        }),
        reviewPath({
          balanceTransferTxHash: "tx-unresolved-high",
          txHashes: ["tx-unresolved-high"],
          verdict: "REVIEW",
          rootSourceType: "incomplete",
          stoppedReason: "data_budget_exhausted",
          riskScoreContribution: 95,
          balanceShare: 0.5,
          exposureSourceKey: null,
          exposureSourceLabel: null,
          sourceExposureKind: null,
          reasons: ["Independent path has unresolved high-risk coverage."]
        })
      ],
      senderInteractionProfiles: []
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "no_name_token_liquidity",
        score: 88
      })
    ]));
    expect(assessment.unknownOriginEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "unknown_origin",
        score: 95
      })
    ]));
    expect(assessment.riskScore).toBe(95);
  });

  it("does not promote zero-confidence unknown_suspicious LLM verdicts to hard risk", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "unknown_suspicious",
        confidence: 0,
        contractRiskScore: 65,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract metadata was incomplete."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }]
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.hardBadEvidence).toHaveLength(0);
    expect(assessment.walletRole).toBe("operational_liquidity_wallet");
  });

  it("accepts only explicit allowlisted CEX paths as clean CEX funded", () => {
    const cleanAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "ACCEPTABLE",
          rootSourceType: "allowlist_cex",
          stoppedReason: "allowlist_cex_reached",
          balanceShare: 1,
          riskScoreContribution: 5,
          reasons: ["Balance-forming path reaches allowlisted CEX Binance through clean on-chain hops."]
        })
      ],
      senderInteractionProfiles: []
    }));
    const genericAcceptableAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "ACCEPTABLE",
          rootSourceType: "unknown",
          stoppedReason: "data_budget_exhausted",
          riskScoreContribution: 5,
          reasons: ["Generic acceptable path without allowlisted CEX proof."]
        })
      ],
      senderInteractionProfiles: []
    }));

    expect(cleanAssessment).toMatchObject({
      decision: "ACCEPTABLE",
      walletRole: "clean_cex_funded_wallet",
      riskScore: 5
    });
    expect(genericAcceptableAssessment.walletRole).not.toBe("clean_cex_funded_wallet");
    expect(genericAcceptableAssessment.decision).toBe("DECLINE");
  });

  it("does not inflate clean CEX coverage from transaction-seed branch internals", () => {
    const cleanPath = (txHash: string): MoneyOriginPath => reviewPath({
      balanceTransferTxHash: txHash,
      txHashes: [txHash],
      verdict: "ACCEPTABLE",
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached",
      balanceShare: 1,
      amountUsage: {
        anchorAmountRaw: "1000000",
        originalAmountRaw: "1000000",
        usedAmountRaw: "1000000",
        coverageShare: 0.1,
        role: "funding_candidate"
      },
      riskScoreContribution: 5,
      reasons: ["Balance-forming path reaches allowlisted CEX Binance through clean on-chain hops."]
    });
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [cleanPath("tx-clean-minority-1"), cleanPath("tx-clean-minority-2")],
      senderInteractionProfiles: []
    }));

    expect(assessment.walletRole).not.toBe("clean_cex_funded_wallet");
  });

  it("keeps operational wallets acceptable with non-critical fast risk when no hard evidence exists", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      fastWalletRisk: mediumFastRisk,
      originPaths: [
        reviewPath({ balanceShare: 0.45 }),
        reviewPath({ balanceTransferTxHash: "tx-review-2", balanceShare: 0.55 })
      ],
      senderInteractionProfiles: [
        profile(),
        profile({
          balanceTransferTxHash: "tx-review-2",
          incomingVolumeRaw: "1399178000000",
          outgoingVolumeRaw: "1382660771000",
          incomingTxCount: 8,
          outgoingTxCount: 9
        })
      ]
    }));

    expect(assessment).toMatchObject({
      decision: "ACCEPTABLE",
      riskBand: "LOW-MEDIUM",
      walletRole: "operational_liquidity_wallet",
      hardBadEvidence: []
    });
    expect(assessment.riskScore).toBeLessThanOrEqual(40);
  });

  it("does not accept operational wallets when approval-drain review findings remain unresolved", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({ balanceShare: 0.45 }),
        reviewPath({ balanceTransferTxHash: "tx-review-2", balanceShare: 0.55 })
      ],
      senderInteractionProfiles: [
        profile(),
        profile({
          balanceTransferTxHash: "tx-review-2",
          incomingVolumeRaw: "1399178000000",
          outgoingVolumeRaw: "1382660771000",
          incomingTxCount: 8,
          outgoingTxCount: 9
        })
      ],
      approvalDrainReviewFindings: [approvalReviewFinding()]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.hardBadEvidence).toEqual([]);
    expect(assessment.reasons.join(" ")).toContain("Approval-drain review findings exist");
    expect(assessment.warnings.join(" ")).toContain("tx-review-drain");
  });

  it("conservatively declines unresolved non-operational wallets", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      senderInteractionProfiles: [],
      originPaths: [reviewPath({ riskScoreContribution: 30 })]
    }));

    expect(assessment).toMatchObject({
      decision: "DECLINE",
      riskScore: 45,
      riskBand: "MEDIUM",
      walletRole: "unknown_wallet",
      hardBadEvidence: []
    });
  });

  it("applies age signals to operational risk but keeps the floor at 25", () => {
    const baseInput = assessmentInput({
      originPaths: [reviewPath({ riskScoreContribution: 40 })],
      ageSignals: ageSignals(-12)
    });

    const dampened = buildMoneyOriginOperationalAssessment(baseInput);
    const boosted = buildMoneyOriginOperationalAssessment({
      ...baseInput,
      ageSignals: ageSignals(12)
    });

    expect(dampened.ageSignals).toBe(baseInput.ageSignals);
    expect(dampened.riskScore).toBe(25);
    expect(boosted.riskScore).toBeGreaterThan(dampened.riskScore);
    expect(boosted.riskScore).toBeLessThanOrEqual(40);
  });

  it("makes an extra no-name source-policy layer the dominant risk layer", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraSourcePolicyEvidence: [extraSourcePolicyEvidence("no_name_token_liquidity", 88)],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "no_name_token_liquidity",
        sourceExposureKind: "no_name_token_liquidity",
        score: 88,
        rawScore: 88,
        adjustedScore: 88,
        canBeDampened: false,
        evidenceIds: ["extra-no-name-layer"]
      })]
    }));

    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "no_name_token_liquidity",
        score: 88
      })
    ]));
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(88);
    expect(assessment.riskBand).toBe("CRITICAL");
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "no_name_token_liquidity",
      score: 88
    }));
  });

  it("makes an extra mixer source-policy layer decline an otherwise operational wallet", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraSourcePolicyEvidence: [extraSourcePolicyEvidence("mixer", 95)],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "mixer",
        sourceExposureKind: "mixer",
        score: 95,
        rawScore: 95,
        adjustedScore: 95,
        canBeDampened: false,
        evidenceIds: ["extra-mixer-layer"]
      })]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(95);
    expect(assessment.riskBand).toBe("CRITICAL");
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "mixer",
      score: 95
    }));
  });

  it("uses the stronger same-kind extra source-policy layer score", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraSourcePolicyEvidence: [extraSourcePolicyEvidence("mixer", 45)],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "mixer",
        sourceExposureKind: "mixer",
        score: 95,
        rawScore: 95,
        adjustedScore: 95,
        canBeDampened: false,
        evidenceIds: ["extra-mixer-layer"]
      })]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(95);
    expect(assessment.riskBand).toBe("CRITICAL");
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      sourceExposureKind: "mixer",
      score: 95
    }));
  });

  it("does not double-count same-kind base and extra source-policy exposure", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches bridge boundary."]
        })
      ],
      extraSourcePolicyEvidence: [extraSourcePolicyEvidence("bridge_router_dex", 85)],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "cross_chain_bridge_router_dex",
        sourceExposureKind: "bridge_router_dex",
        score: 85,
        rawScore: 85,
        adjustedScore: 85,
        proofLevel: "exchange_policy_decline",
        evidenceIds: ["extra-bridge_router_dex"]
      })]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(85);
    expect(assessment.riskBand).toBe("CRITICAL");
    expect(assessment.sourcePolicyEvidence.filter((item) => item.kind === "bridge_router_dex")).toHaveLength(2);
  });

  it("keeps an extra no-name source-policy layer out of hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "no_name_token_liquidity",
        sourceExposureKind: "no_name_token_liquidity",
        score: 88,
        rawScore: 88,
        adjustedScore: 88,
        canBeDampened: false
      })]
    }));

    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("sanctioned_service");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("scam_or_blacklist");
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "source_policy",
        sourceExposureKind: "no_name_token_liquidity"
      })
    ]));
  });

  it("keeps an extra mixer source-policy layer out of hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "mixer",
        sourceExposureKind: "mixer",
        score: 95,
        rawScore: 95,
        adjustedScore: 95,
        canBeDampened: false
      })]
    }));

    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("sanctioned_service");
    expect(assessment.hardBadEvidence.map((item) => item.kind)).not.toContain("scam_or_blacklist");
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "source_policy",
        sourceExposureKind: "mixer"
      })
    ]));
  });

  it("adds extra sanctioned hard evidence to hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraHardBadEvidence: [extraSanctionedHardEvidence()]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.hardBadEvidence[0]).toEqual(expect.objectContaining({
      kind: "sanctioned_service",
      score: 99,
      evidenceIds: ["extra-sanctioned-hard"]
    }));
  });

  it("does not duplicate matching sanctioned hard proof layers", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraHardBadEvidence: [extraSanctionedHardEvidence()],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "hard_proof",
        kind: "cross_chain_sanctioned_service",
        sourceExposureKind: "sanctioned_service",
        score: 99,
        rawScore: 99,
        adjustedScore: 99,
        proofLevel: "exact_scam_or_taint_proof",
        canBeDampened: false,
        reasons: ["Cross-chain corridor reached a sanctioned service."],
        evidenceIds: ["extra-sanctioned-hard"]
      })]
    }));

    const sanctionedHardLayers = assessment.riskLayers.filter((layer) =>
      layer.evidenceClass === "hard_proof" &&
      layer.evidenceIds.includes("extra-sanctioned-hard")
    );
    expect(sanctionedHardLayers).toHaveLength(1);
  });

  it("does not let operational dampening lower extra no-name or mixer layers below HIGH", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      extraRiskLayers: [
        extraRiskLayer({
          evidenceClass: "source_policy",
          kind: "no_name_token_liquidity",
          sourceExposureKind: "no_name_token_liquidity",
          score: 88,
          rawScore: 88,
          adjustedScore: 88,
          canBeDampened: false,
          evidenceIds: ["extra-no-name-layer"]
        }),
        extraRiskLayer({
          evidenceClass: "source_policy",
          kind: "mixer",
          sourceExposureKind: "mixer",
          score: 95,
          rawScore: 95,
          adjustedScore: 95,
          canBeDampened: false,
          evidenceIds: ["extra-mixer-layer"]
        })
      ]
    }));

    expect(assessment.walletRole).toBe("risky_source_wallet");
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(60);
    expect(["HIGH", "CRITICAL"]).toContain(assessment.riskBand);
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceExposureKind: "no_name_token_liquidity",
        score: 88,
        adjustedScore: 88
      }),
      expect.objectContaining({
        sourceExposureKind: "mixer",
        score: 95,
        adjustedScore: 95
      })
    ]));
  });

  it("preserves extra risk layers in the top hard evidence branch", () => {
    const extraLayer = extraRiskLayer({ evidenceClass: "data_quality", kind: "extra_hard_branch_partial", score: 52 });
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      fastWalletRisk: criticalFastRisk,
      extraRiskLayers: [extraLayer]
    }));

    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("fast_critical");
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceClass: "data_quality", kind: "extra_hard_branch_partial" })
    ]));
  });

  it("preserves extra risk layers in the top contract suspicion branch", () => {
    const extraLayer = extraRiskLayer({ evidenceClass: "data_quality", kind: "extra_contract_branch_partial", score: 52 });
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      contractLlmVerdicts: [{
        source: "llm",
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TContract111111111111111111111111111",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "drainer_like",
        confidence: 0.9,
        contractRiskScore: 96,
        decisionRecommendation: "DECLINE",
        reasons: ["Contract behaves like drainer."],
        citedEvidenceIds: ["tx-llm"],
        falsePositiveNotes: []
      }],
      extraRiskLayers: [extraLayer]
    }));

    expect(assessment.reasons.join(" ")).toContain("LLM contract verdict is drainer_like");
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceClass: "data_quality", kind: "extra_contract_branch_partial" })
    ]));
  });

  it("preserves extra risk layers in the service route guard branch", () => {
    const extraLayer = extraRiskLayer({ evidenceClass: "data_quality", kind: "extra_guard_branch_partial", score: 52 });
    const extraSourcePolicyLayer = extraRiskLayer({
      evidenceClass: "source_policy",
      kind: "extra_guard_source_policy",
      sourceExposureKind: "unknown_contract",
      score: 52,
      rawScore: 52,
      adjustedScore: 52,
      proofLevel: "exchange_policy_context",
      evidenceIds: ["extra-guard-source-policy"]
    });
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 92,
          balanceShare: 1,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      coverage: coverage({ provenanceScope: "recent_flow" }),
      extraRiskLayers: [extraLayer, extraSourcePolicyLayer]
    }));

    expect(assessment.reasons.join(" ")).toContain("Service boundary reached");
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceClass: "data_quality", kind: "extra_guard_branch_partial" }),
      expect.objectContaining({ evidenceClass: "source_policy", kind: "extra_guard_source_policy" })
    ]));
  });

  it("keeps same-kind source-policy aggregate capped in the service route guard branch", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 92,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      coverage: coverage({ provenanceScope: "recent_flow" }),
      extraSourcePolicyEvidence: [extraSourcePolicyEvidence("bridge_router_dex", 85)],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "cross_chain_bridge_router_dex",
        sourceExposureKind: "bridge_router_dex",
        score: 85,
        rawScore: 85,
        adjustedScore: 85,
        proofLevel: "exchange_policy_decline",
        evidenceIds: ["extra-bridge_router_dex"]
      })]
    }));

    const aggregateLayer = assessment.riskLayers.find((layer) => layer.kind === "aggregate_source_policy");
    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(75);
    expect(aggregateLayer).toEqual(expect.objectContaining({
      kind: "aggregate_source_policy",
      score: 75
    }));
  });

  it("keeps stronger same-kind source-policy layer dominant after service route guard caps", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge/router/DEX",
          sourceExposureKind: "bridge_router_dex",
          riskScoreContribution: 92,
          pathAddresses: [funding, "TLayerZero11111111111111111111111111", subject],
          reasons: ["Recent-flow path reaches cross-chain bridge router service boundary."]
        })
      ],
      approvalDrainReviewFindings: [
        approvalReviewFinding({
          reason: "service_boundary_guard",
          falsePositiveGuards: [{
            code: "service_boundary_route",
            label: "LayerZero/OFT route boundary",
            address: "TLayerZero11111111111111111111111111",
            category: "bridge",
            identity: "LayerZero/OFT"
          }]
        })
      ],
      coverage: coverage({ provenanceScope: "recent_flow" }),
      extraSourcePolicyEvidence: [extraSourcePolicyEvidence("bridge_router_dex", 65)],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "source_policy",
        kind: "cross_chain_bridge_router_dex",
        sourceExposureKind: "bridge_router_dex",
        score: 65,
        rawScore: 65,
        adjustedScore: 65,
        proofLevel: "exchange_policy_decline",
        evidenceIds: ["extra-bridge_router_dex"]
      })]
    }));

    const extraLayer = assessment.riskLayers.find((layer) => layer.kind === "cross_chain_bridge_router_dex");
    expect(assessment.riskScore).toBe(75);
    expect(assessment.dominantRiskLayer).toEqual(expect.objectContaining({
      evidenceClass: "source_policy",
      sourceExposureKind: "bridge_router_dex",
      score: 75,
      evidenceIds: expect.arrayContaining(["tx-review"])
    }));
    expect(extraLayer).toEqual(expect.objectContaining({
      score: 65,
      evidenceIds: ["extra-bridge_router_dex"]
    }));
  });

  it("preserves extra risk layers in the source policy decline branch", () => {
    const extraLayer = extraRiskLayer({ evidenceClass: "data_quality", kind: "extra_source_policy_branch_partial", score: 52 });
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          balanceShare: 0.62,
          exposureSourceKey: "htx_huobi",
          exposureSourceLabel: "HTX/Huobi",
          sourceExposureKind: "htx_huobi",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches HTX/Huobi exposure."]
        })
      ],
      senderInteractionProfiles: [],
      extraRiskLayers: [extraLayer]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "htx_huobi" })
    ]));
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceClass: "data_quality", kind: "extra_source_policy_branch_partial" })
    ]));
  });

  it("preserves extra risk layers in the legitimate service verdict branch", () => {
    const extraLayer = extraRiskLayer({ evidenceClass: "data_quality", kind: "extra_legitimate_service_branch_partial", score: 52 });
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "REVIEW",
          rootSourceType: "decline_boundary",
          stoppedReason: "unlabeled_service_boundary",
          balanceShare: 1,
          exposureSourceKey: "unknown_contract",
          exposureSourceLabel: "Unknown contract",
          sourceExposureKind: "unknown_contract",
          riskScoreContribution: 70,
          pathAddresses: [funding, "TContract111111111111111111111111111", subject],
          reasons: ["Balance-forming path stops at unknown contract boundary."]
        })
      ],
      contractLlmVerdicts: [legitimateServiceVerdict({
        contractAddress: "TContract111111111111111111111111111",
        citedEvidenceIds: ["tx-review"]
      })],
      senderInteractionProfiles: [],
      extraRiskLayers: [extraLayer]
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.reasons.join(" ")).toContain("legitimate service");
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceClass: "data_quality", kind: "extra_legitimate_service_branch_partial" })
    ]));
  });

  it("preserves extra data-quality partial layers in the acceptable branch", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "ACCEPTABLE",
          rootSourceType: "allowlist_cex",
          stoppedReason: "allowlist_cex_reached",
          balanceShare: 1,
          riskScoreContribution: 5,
          reasons: ["Balance-forming path reaches allowlisted CEX Binance through clean on-chain hops."]
        })
      ],
      senderInteractionProfiles: [],
      extraRiskLayers: [extraRiskLayer({
        evidenceClass: "data_quality",
        kind: "extra_cross_chain_partial",
        score: 48,
        rawScore: 48,
        adjustedScore: 48,
        proofLevel: "insufficient_coverage",
        canBeDampened: false,
        evidenceIds: ["extra-cross-chain-partial"]
      })]
    }));

    expect(assessment.decision).toBe("ACCEPTABLE");
    expect(assessment.unknownOriginEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "data_quality",
        kind: "extra_cross_chain_partial",
        evidenceIds: ["extra-cross-chain-partial"]
      })
    ]));
    expect(assessment.riskLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceClass: "data_quality",
        kind: "extra_cross_chain_partial"
      })
    ]));
  });
});
