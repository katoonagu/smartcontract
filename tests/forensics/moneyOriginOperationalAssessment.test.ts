import { describe, expect, it } from "vitest";
import { buildMoneyOriginOperationalAssessment, riskBandFromWhereScore } from "../../src/forensics/moneyOriginOperationalAssessment";
import type {
  ApprovalDrainReviewFinding,
  ApprovalDrainProvenanceProfile,
  ContractLlmVerdictSummary,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  RiskReport,
  WhereIsMoneyAgeSignals,
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

  it("keeps WhiteBIT as a medium decline without hard bad evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          riskScoreContribution: 45,
          reasons: ["Balance-forming path has WhiteBIT exposure (20% of selected provenance target); this is a medium-risk source signal, not HTX/Huobi high-risk exposure."]
        })
      ]
    }));

    expect(assessment).toMatchObject({
      decision: "DECLINE",
      riskScore: 45,
      riskBand: "MEDIUM",
      hardBadEvidence: []
    });
  });

  it("keeps WhiteBIT medium even when path contribution is lower than medium", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          riskScoreContribution: 5,
          reasons: ["Balance-forming path has WhiteBIT exposure."]
        })
      ]
    }));

    expect(assessment).toMatchObject({
      decision: "DECLINE",
      riskScore: 45,
      riskBand: "MEDIUM",
      hardBadEvidence: []
    });
  });

  it("uses WhiteBIT path reasons when another path appears first", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          reasons: ["Unrelated clean/review path reason."]
        }),
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          exposureSourceKey: "whitebit",
          exposureSourceLabel: "WhiteBIT",
          riskScoreContribution: 45,
          reasons: ["Balance-forming path has WhiteBIT exposure."]
        })
      ]
    }));

    expect(assessment.reasons).toEqual(["Balance-forming path has WhiteBIT exposure."]);
  });

  it("declines HTX/Huobi as hard source evidence", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches HTX; exchange policy treats HTX/Huobi sources as high risk."]
        })
      ]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(78);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("htx_huobi_source");
  });

  it("can identify HTX/Huobi from structured exposure fields", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          exposureSourceKey: "htx",
          exposureSourceLabel: "HTX",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches a high-risk source."]
        })
      ]
    }));

    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("htx_huobi_source");
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

  it("declines bridge/router/DEX boundaries as hard bad evidence but not unknown contracts", () => {
    const bridgeAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches bridge boundary."]
        })
      ]
    }));
    const unknownContractAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 65,
          reasons: ["Balance-forming path reaches unknown_contract boundary."]
        })
      ]
    }));

    expect(bridgeAssessment.hardBadEvidence.map((item) => item.kind)).toContain("bridge_router_dex_boundary");
    expect(unknownContractAssessment.hardBadEvidence.map((item) => item.kind)).not.toContain("unknown_contract_boundary");
    expect(unknownContractAssessment.hardBadEvidence).toHaveLength(0);
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

  it("does not let LLM legitimate_service override bridge/router/DEX hard boundary", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
          riskScoreContribution: 78,
          reasons: ["Balance-forming path reaches bridge router boundary."]
        })
      ],
      contractLlmVerdicts: [legitimateServiceVerdict()]
    }));

    expect(assessment.decision).toBe("DECLINE");
    expect(assessment.riskScore).toBe(78);
    expect(assessment.hardBadEvidence.map((item) => item.kind)).toContain("bridge_router_dex_boundary");
  });

  it("does not let LLM legitimate_service override structured bridge/router/DEX boundary fields", () => {
    const keyAssessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
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
    expect(keyAssessment.riskScore).toBe(78);
    expect(keyAssessment.reasons.join(" ")).not.toContain("downgraded");
    expect(labelAssessment.decision).toBe("DECLINE");
    expect(labelAssessment.riskScore).toBe(78);
    expect(labelAssessment.reasons.join(" ")).not.toContain("downgraded");
  });

  it("does not let LLM legitimate_service override structured bridge/router/DEX keys with separators", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          verdict: "DECLINE",
          rootSourceType: "decline_boundary",
          stoppedReason: "decline_boundary_reached",
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
    expect(assessment.riskScore).toBe(78);
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

  it("declines high-confidence LLM drainer verdicts as hard bad evidence", () => {
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
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "llm_contract_suspicion", evidenceIds: ["tx-llm"] })
    ]));
  });

  it("declines high-score LLM drainer verdicts even when provider confidence is missing", () => {
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
    expect(assessment.riskScore).toBeGreaterThanOrEqual(98);
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "llm_contract_suspicion", score: 98 })
    ]));
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
      score: 92,
      evidenceIds: ["tx-exact-approve", "tx-exact-drain", "tx-exact-drain"]
    }));
    expect(assessment.hardBadEvidence.flatMap((item) => item.evidenceIds)).not.toContain("tx-route-drain");
    expect(assessment.reasons.join(" ")).toContain("Exact approval-drain provenance");
    expect(assessment.reasons.join(" ")).not.toContain("Service boundary reached");
  });

  it("keeps unrelated drainer-like LLM verdicts as hard evidence when service-route guard suppresses a guarded verdict", () => {
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
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "llm_contract_suspicion", evidenceIds: ["tx-unrelated-llm"] })
    ]));
    expect(assessment.hardBadEvidence.flatMap((item) => item.evidenceIds)).not.toContain("tx-review-drain");
    expect(assessment.reasons.join(" ")).toContain("LLM contract verdict is drainer_like");
    expect(assessment.reasons.join(" ")).not.toContain("Service boundary reached");
  });

  it("keeps unrelated bridge/router decline paths as hard evidence when a service-route guard exists", () => {
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
    expect(assessment.hardBadEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bridge_router_dex_boundary",
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
});
