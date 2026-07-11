import { describe, expect, it } from "vitest";
import { buildIncomingDepositMatrixCandidates, buildWalletMatrixCandidates } from "../../src/risk/scoringSignalMatrixInputs";
import { evaluateSmartContractAddress } from "../../src/check/smartContractCheck";
import { scoreMatrixCandidates, type MatrixCandidateContext } from "../../src/risk/scoringSignalMatrix";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type {
  AssetContinuationProfile,
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistFact,
  InboundProvenanceProfile,
  IncomingFreshBundleExposure,
  OperationalFlowProfile,
  RiskReport,
  WhereIsMoneyReport
} from "../../src/types";

const address = `T${"1".repeat(33)}`;
const blacklistedCounterparty = `T${"2".repeat(33)}`;
const directTxHash = "a".repeat(64);
const blacklistEventTxHash = "b".repeat(64);

function firstHopBlacklistFact(overrides: Partial<FirstHopBlacklistFact> = {}): FirstHopBlacklistFact {
  return {
    counterpartyAddress: blacklistedCounterparty,
    direction: "outbound",
    evidenceKind: "usdt_blacklist",
    evidenceAuthority: "official_contract",
    statusAtCheck: "active",
    temporalRelation: "became_active_after",
    effectiveAt: "2026-05-24T01:00:00.000Z",
    effectiveTxHash: blacklistEventTxHash,
    checkedAt: "2026-05-24T02:00:00.000Z",
    principalAmountRaw: "10000000000",
    principalTxCount: 1,
    directionalPrincipalShare: null,
    shareSemantics: "unavailable",
    transferTxHashes: [directTxHash],
    beforeEffectiveAmountRaw: "10000000000",
    beforeEffectiveTxCount: 1,
    activeAmountRaw: "0",
    activeTxCount: 0,
    unknownTimingAmountRaw: "0",
    unknownTimingTxCount: 0,
    directTransferCoverage: "partial",
    timelineCoverage: "complete",
    timelineEvents: [{
      eventKind: "added",
      occurredAt: "2026-05-24T01:00:00.000Z",
      txHash: blacklistEventTxHash,
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 81234567,
      logIndex: 0,
      verification: "verified_contract_log"
    }],
    ...overrides
  };
}

function directCounterpartyProfile(
  overrides: Partial<DirectCounterpartyInteractionProfile> = {}
): DirectCounterpartyInteractionProfile {
  const subjectAddress = overrides.subjectAddress ?? address;
  const direction = overrides.direction ?? "outbound";
  const counterpartyAddress = overrides.counterpartyAddress ?? blacklistedCounterparty;
  const volumeRaw = overrides.volumeRaw ?? "10000000000";
  const txHashes = overrides.txHashes ?? [directTxHash];
  const transfers = overrides.transfers ?? txHashes.map((txHash, index) => ({
    txHash,
    fromAddress: direction === "inbound" ? counterpartyAddress : subjectAddress,
    toAddress: direction === "inbound" ? subjectAddress : counterpartyAddress,
    amountRaw: index === 0 ? volumeRaw : "0",
    timestamp: "2026-05-24T00:00:00.000Z",
    method: "transfer",
    edgeType: "normal_transfer" as const
  }));
  return {
    subjectAddress,
    direction,
    counterpartyAddress,
    volumeRaw,
    volumeRatio: 1,
    txCount: 1,
    firstSeen: "2026-05-24T00:00:00.000Z",
    lastSeen: "2026-05-24T00:00:00.000Z",
    txHashes,
    transfers,
    serviceCategory: null,
    identity: null,
    snapshot: {
      address: blacklistedCounterparty,
      riskScore: 95,
      riskLevel: "CRITICAL",
      source: "stablecoin_blacklist",
      evidenceClass: "exact_labeled_counterparty",
      reasons: [],
      partialNotes: []
    },
    interactionWeight: 0.95,
    scoreContribution: 88,
    evidenceClass: "exact_labeled_counterparty",
    skippedReason: null,
    ...overrides
  };
}

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

function originPath(txHashes: string[]): WhereIsMoneyReport["originPaths"][number] {
  return {
    balanceTransferTxHash: txHashes[0] ?? "missing-path-tx",
    rootSourceAddress: "TOriginSource11111111111111111111111",
    rootSourceType: "incomplete",
    pathAddresses: ["TOriginSource11111111111111111111111", address],
    txHashes,
    steps: [],
    amountPreservationRatio: 1,
    timeSpanMs: null,
    stoppedReason: "incoming_history_not_fetched",
    verdict: "REVIEW",
    riskScoreContribution: 45,
    reasons: ["Transaction-seeded provenance path."]
  };
}

function deepReportWithExactPaths(
  paths: Array<{ txHash: string; label: "scam" | "whitebit" }>
): DeepAddressForensicReport {
  return deepReport({
    extendedProvenanceProfiles: [{
      subjectAddress: address,
      direction: "inbound",
      maxDepth: 2,
      paths: paths.map(({ txHash, label }) => ({
        direction: "inbound",
        depth: 2,
        pathAddresses: ["TExtendedSource111111111111111111111", address],
        txHashes: [txHash],
        amountRaw: "100000000",
        amountPreservationRatio: 1,
        firstTransferAt: "2026-05-01T00:00:00.000Z",
        lastTransferAt: "2026-05-01T00:00:01.000Z",
        label,
        labelAddress: "TExtendedSource111111111111111111111",
        boundaryCategory: null,
        evidenceStrength: "exact_labeled_path",
        candidateScore: 95,
        features: []
      })),
      matchedVolumeRaw: "100000000",
      matchedVolumeRatio: 1,
      score: 95,
      features: [],
      coverage: {
        expandedAddresses: 1,
        fetchedAddressCount: 1,
        stoppedReasons: [],
        maxDepthReached: 2
      }
    }]
  });
}

function inboundWhitebitProfile(txHash: string): InboundProvenanceProfile {
  return {
    subjectAddress: address,
    incomingVolumeRaw: "100000000000",
    matchedInboundVolumeRaw: "100000000000",
    paths: [{
      depth: 1,
      sourceAddress: "TWhitebitSource1111111111111111111111",
      viaAddresses: [],
      label: "whitebit",
      amountRaw: "100000000000",
      amountPreservationRatio: 1,
      firstTransferAt: "2026-05-01T00:00:00.000Z",
      lastTransferAt: "2026-05-01T00:00:01.000Z",
      txHashes: [txHash]
    }],
    boundaryNotes: [],
    score: 86,
    features: []
  };
}

function assetContinuationProfile(txHash: string): AssetContinuationProfile {
  return {
    subjectAddress: address,
    sourceAsset: "USDT",
    continuationAssetSymbol: "WRAPPED",
    continuationTokenContract: "TWrappedToken1111111111111111111111",
    conversionTxHash: txHash,
    outgoingTxHash: `${txHash}:out`,
    protocolAddress: "TProtocol111111111111111111111111111",
    destinationAddress: "TRiskyDestination1111111111111111111",
    destinationRisk: "provider_risk",
    elapsedMs: 12_000,
    sourceAmountRaw: "101607508600",
    continuationAmountRaw: "101607508600",
    tokenQuality: "verified",
    score: 82,
    evidenceClass: "asset_continuation",
    reasons: ["Verified continuation reached a provider-risk destination."]
  };
}

function operationalFlowProfile(): OperationalFlowProfile {
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
    features: []
  };
}

const walletContext = (subjectAddress = address): MatrixCandidateContext => ({
  decisionScope: "wallet_unified",
  subjectAddress,
  subjectTxHash: null,
  requiredCoverage: "wallet_provenance"
});

const incomingContext = (senderAddress: string, txHash: string): MatrixCandidateContext => ({
  decisionScope: "incoming_unified",
  subjectAddress: senderAddress,
  subjectTxHash: txHash,
  requiredCoverage: "deposit_provenance"
});

const freshHtxExposure = (): IncomingFreshBundleExposure => ({
  targetAmountRaw: "1000000000",
  htxHuobiShare: 0.72,
  cleanCexShare: 0,
  bridgeRouterDexShare: 0,
  unknownContractShare: 0,
  riskyLabelShare: 0,
  unknownShare: 0.28,
  dominantFreshSource: "htx_huobi",
  reasons: ["HTX/Huobi fresh bundle exposure"]
});

function directPolicyCandidates(
  fact: FirstHopBlacklistFact,
  profiles: DirectCounterpartyInteractionProfile[] = [directCounterpartyProfile({
    volumeRaw: fact.principalAmountRaw
  })]
) {
  return buildWalletMatrixCandidates({
    address,
    fastReport: null,
    deepReport: deepReport({
      firstHopBlacklistFacts: [fact],
      directCounterpartyInteractionProfiles: profiles
    }),
    whereReport: whereReport()
  }).filter((candidate) => candidate.row === "direct_counterparty_policy");
}

describe("scoring signal matrix input mappers", () => {
  it("maps an exact Verify20 report only for the checked contract subject", () => {
    const report = evaluateSmartContractAddress({
      subjectAddress: address,
      metadata: {
        address,
        source: "tronscan",
        name: null,
        tag: null,
        isContract: true,
        verified: false,
        accountType: null,
        rawJson: {},
        fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
        expiresAt: new Date("2026-07-12T00:00:00.000Z")
      },
      contractProfile: {
        contractAddress: address,
        providerTags: [],
        publicTags: [],
        isVerified: false,
        verifyStatus: null,
        sourceStatus: "missing",
        contractCreatedAt: null,
        contractAgeDays: null,
        txCount: "1",
        recentCallCount: null,
        totalCallCount: "1",
        totalCallerCount: "1",
        topMethods: [],
        topCallers: [],
        methodMap: {
          "5082dd12": "Verify20(address,address,address,uint256)",
          "fc61dd23": "Verify10(address,uint256)",
          "ea4418d9": "withdrawAllTrxTo(address)",
          "f2fde38b": "transferOwnership(address)"
        },
        providerRisk: false,
        rawPayload: {},
        fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
        expiresAt: new Date("2026-07-12T00:00:00.000Z")
      },
      relatedApprovals: []
    });

    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport(),
      smartContractReport: report
    });
    expect(candidates).toContainEqual(expect.objectContaining({
      row: "contract_suspicion",
      actionUnit: "wallet",
      score: 85,
      authority: { kind: "pattern", decisionEligibility: "can_decline", coverageDependency: "none" },
      atomicSignals: ["exact_verify20_contract_pattern"],
      subject: { decisionScope: "wallet_unified", address, txHash: null }
    }));

    expect(buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport(),
      smartContractReport: { ...report, subjectAddress: "TOtherContract11111111111111111111111" }
    }).some((candidate) => candidate.atomicSignals.includes("exact_verify20_contract_pattern"))).toBe(false);
  });

  it("maps a material active official first-hop blacklist fact to independent wallet policy", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: deepReport({
        firstHopBlacklistFacts: [firstHopBlacklistFact()],
        directCounterpartyInteractionProfiles: [directCounterpartyProfile()]
      }),
      whereReport: whereReport()
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "direct_counterparty_policy",
      actionUnit: "wallet",
      score: 60,
      authority: {
        kind: "policy",
        decisionEligibility: "can_decline",
        coverageDependency: "none"
      },
      evidenceIds: [
        directTxHash,
        blacklistEventTxHash,
        `usdt_blacklist_state:${blacklistedCounterparty}:2026-05-24T02:00:00.000Z`
      ].sort(),
      modifiers: ["direction_outbound", "blacklist_timing_became_active_after"],
      subject: { decisionScope: "wallet_unified", address, txHash: null }
    }));
  });

  it("uses exact direct-policy materiality boundaries for partial and complete denominators", () => {
    expect(directPolicyCandidates(firstHopBlacklistFact({
      principalAmountRaw: "9999999000",
      beforeEffectiveAmountRaw: "9999999000"
    }))).toEqual([]);
    expect(directPolicyCandidates(firstHopBlacklistFact({
      principalAmountRaw: "10000000000",
      beforeEffectiveAmountRaw: "10000000000"
    }))).toEqual([expect.objectContaining({ score: 60 })]);

    const completeFact = {
      directTransferCoverage: "complete" as const,
      shareSemantics: "exact" as const
    };
    expect(directPolicyCandidates(firstHopBlacklistFact({
      ...completeFact,
      principalAmountRaw: "99999000",
      beforeEffectiveAmountRaw: "99999000",
      directionalPrincipalShare: 0.5
    }))).toEqual([]);
    expect(directPolicyCandidates(firstHopBlacklistFact({
      ...completeFact,
      principalAmountRaw: "100000000",
      beforeEffectiveAmountRaw: "100000000",
      directionalPrincipalShare: 0.00999
    }))).toEqual([]);
    expect(directPolicyCandidates(firstHopBlacklistFact({
      ...completeFact,
      principalAmountRaw: "100000000",
      beforeEffectiveAmountRaw: "100000000",
      directionalPrincipalShare: 0.01
    }))).toEqual([expect.objectContaining({ score: 88 })]);
  });

  it("joins exact-share score only by counterparty, direction, and evidence transaction, capped at 90", () => {
    const exactFact = firstHopBlacklistFact({
      directTransferCoverage: "complete",
      shareSemantics: "exact",
      directionalPrincipalShare: 1
    });
    const unrelated = [
      directCounterpartyProfile({ counterpartyAddress: `T${"3".repeat(33)}`, scoreContribution: 99 }),
      directCounterpartyProfile({ direction: "inbound", scoreContribution: 98 }),
      directCounterpartyProfile({ txHashes: ["c".repeat(64)], scoreContribution: 97 })
    ];

    expect(directPolicyCandidates(exactFact, unrelated)).toEqual([]);
    expect(directPolicyCandidates(exactFact, [directCounterpartyProfile({ scoreContribution: 95 })])).toEqual([
      expect.objectContaining({ score: 90, caps: ["direct_counterparty_policy_cap_90"] })
    ]);
  });

  it("rejects inactive, non-official, non-USDT, and fee-only/no-principal inputs", () => {
    const invalidFacts = [
      firstHopBlacklistFact({ statusAtCheck: "inactive" }),
      firstHopBlacklistFact({ evidenceAuthority: "derived" } as unknown as Partial<FirstHopBlacklistFact>),
      firstHopBlacklistFact({ evidenceKind: "sanctions" } as unknown as Partial<FirstHopBlacklistFact>),
      firstHopBlacklistFact({
        principalAmountRaw: "0",
        principalTxCount: 0,
        transferTxHashes: [],
        beforeEffectiveAmountRaw: "0",
        beforeEffectiveTxCount: 0
      })
    ];

    for (const fact of invalidFacts) expect(directPolicyCandidates(fact)).toEqual([]);
    expect(buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: deepReport({
        firstHopBlacklistFacts: [],
        directCounterpartyInteractionProfiles: [directCounterpartyProfile({
          transfers: [{
            txHash: directTxHash,
            fromAddress: address,
            toAddress: blacklistedCounterparty,
            amountRaw: "3000000",
            timestamp: "2026-05-24T00:00:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer",
            economicRole: "service_fee",
            economicProtocol: "tron_gasfree"
          }]
        })]
      }),
      whereReport: whereReport()
    }).some((candidate) => candidate.row === "direct_counterparty_policy")).toBe(false);
  });

  it("requires an exact transfer-hash, amount, and count binding before absolute policy", () => {
    const secondTxHash = "c".repeat(64);
    const exactFact = firstHopBlacklistFact({
      transferTxHashes: [directTxHash, secondTxHash],
      principalTxCount: 2
    });
    const validTransfers = [
      directCounterpartyProfile().transfers![0],
      { ...directCounterpartyProfile().transfers![0], txHash: secondTxHash, amountRaw: "0" }
    ];
    const invalidProfiles = [
      directCounterpartyProfile({ txHashes: [directTxHash], transfers: [validTransfers[0]] }),
      directCounterpartyProfile({
        txHashes: [directTxHash, secondTxHash],
        transfers: [{ ...validTransfers[0], amountRaw: "9999999999" }, validTransfers[1]]
      }),
      directCounterpartyProfile({
        txHashes: [directTxHash, secondTxHash],
        transfers: validTransfers.slice(0, 1)
      })
    ];

    for (const profile of invalidProfiles) {
      expect(directPolicyCandidates(exactFact, [profile])).toEqual([]);
    }
  });

  it("aggregates distinct positive principal movements by transaction and rejects identical duplicates", () => {
    const transfer = directCounterpartyProfile().transfers![0];
    const validMovements = [
      { ...transfer, amountRaw: "6000000000" },
      { ...transfer, amountRaw: "4000000000" },
      { ...transfer, amountRaw: "0" }
    ];
    expect(directPolicyCandidates(firstHopBlacklistFact(), [
      directCounterpartyProfile({ transfers: validMovements })
    ])).toEqual([expect.objectContaining({
      row: "direct_counterparty_policy",
      score: 60,
      evidenceIds: expect.arrayContaining([directTxHash])
    })]);

    const duplicatedMovement = { ...transfer, amountRaw: "2500000000" };
    expect(directPolicyCandidates(firstHopBlacklistFact(), [
      directCounterpartyProfile({
        transfers: [
          duplicatedMovement,
          { ...duplicatedMovement },
          { ...transfer, amountRaw: "5000000000" }
        ]
      })
    ])).toEqual([]);
  });

  it("rejects fee-only, malformed, and endpoint-inconsistent transfer profiles", () => {
    const transfer = directCounterpartyProfile().transfers![0];
    const invalidTransfers: DirectCounterpartyInteractionProfile["transfers"][] = [
      [{ ...transfer, economicRole: "service_fee", economicProtocol: "tron_gasfree" }],
      [{ ...transfer, amountRaw: "01" }],
      [{ ...transfer, amountRaw: "-1" }],
      [{ ...transfer, fromAddress: blacklistedCounterparty, toAddress: address }],
      []
    ];

    for (const transfers of invalidTransfers) {
      expect(directPolicyCandidates(firstHopBlacklistFact(), [
        directCounterpartyProfile({ transfers })
      ])).toEqual([]);
    }
  });

  it("rejects a noncanonical fact amount even when its numeric value matches principal transfers", () => {
    const fact = firstHopBlacklistFact({
      principalAmountRaw: "010000000000",
      beforeEffectiveAmountRaw: "010000000000"
    });

    expect(directPolicyCandidates(fact, [directCounterpartyProfile()])).toEqual([]);
  });

  it("rejects nonfinite and out-of-range joined profile contributions", () => {
    const exactFact = firstHopBlacklistFact({
      directTransferCoverage: "complete",
      shareSemantics: "exact",
      directionalPrincipalShare: 1
    });

    for (const scoreContribution of [Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
      expect(directPolicyCandidates(exactFact, [
        directCounterpartyProfile({ scoreContribution })
      ])).toEqual([]);
    }
  });

  it("maps the checked subject blacklist to the highest-priority restriction row", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: deepReport({
        stablecoinRestrictionProfiles: [{
          subjectAddress: address,
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          tokenSymbol: "USDT",
          tokenStandard: "TRC20",
          decimals: 6,
          isBlacklisted: true,
          balanceRaw: null,
          checkedAt: "2026-05-24T02:00:00.000Z",
          evidenceStrength: "exact_contract_state",
          methods: { blacklist: "isBlackListed(address)", balance: null }
        }],
        firstHopBlacklistFacts: [firstHopBlacklistFact({
          directTransferCoverage: "complete",
          shareSemantics: "exact",
          directionalPrincipalShare: 1
        })],
        directCounterpartyInteractionProfiles: [directCounterpartyProfile({ scoreContribution: 90 })]
      }),
      whereReport: whereReport()
    });
    const scored = scoreMatrixCandidates(candidates, walletContext());

    expect(scored.winningRow).toBe("subject_restriction");
    expect(scored.riskVector.subject_restriction).toHaveLength(1);
    expect(scored.riskVector.direct_counterparty_policy).toHaveLength(1);
  });

  it("maps exact Fast subject blacklist evidence to the subject restriction row", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: fastReport(95, "stablecoin_usdt_blacklisted"),
      deepReport: null,
      whereReport: whereReport()
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "subject_restriction",
      atomicSignals: ["stablecoin_usdt_blacklisted"]
    }));
    expect(candidates.some((candidate) =>
      candidate.row === "hard_proof" && candidate.atomicSignals.includes("stablecoin_usdt_blacklisted")
    )).toBe(false);
  });

  it("keeps a 95-point exact approval drain above a 90-point direct policy candidate", () => {
    const approvalTxHash = "c".repeat(64);
    const drainTxHash = "d".repeat(64);
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: deepReport({
        firstHopBlacklistFacts: [firstHopBlacklistFact({
          directTransferCoverage: "complete",
          shareSemantics: "exact",
          directionalPrincipalShare: 1
        })],
        directCounterpartyInteractionProfiles: [directCounterpartyProfile({ scoreContribution: 90 })],
        approvalDrainProvenanceProfiles: [{
          subjectAddress: address,
          victimAddress: address,
          spenderAddress: `T${"4".repeat(33)}`,
          operatorAddress: `T${"5".repeat(33)}`,
          firstReceiverAddress: `T${"6".repeat(33)}`,
          approvalTxHash,
          drainTxHash,
          amountRaw: "100000000",
          amountPreservationRatio: 1,
          approvalAt: "2026-05-24T00:00:00.000Z",
          drainAt: "2026-05-24T00:01:00.000Z",
          pathTxHashes: [drainTxHash],
          pathAddresses: [address, `T${"6".repeat(33)}`],
          hopDepth: 1,
          score: 95,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }]
      }),
      whereReport: whereReport()
    });
    const scored = scoreMatrixCandidates(candidates, walletContext());

    expect(scored.winningRow).toBe("hard_proof");
    expect(scored.policyScore).toBe(95);
    expect(scored.riskVector.direct_counterparty_policy?.[0].score).toBe(90);
  });

  it("promotes only the exact receiver-relative inbound deposit fact to incoming direct policy", () => {
    const senderAddress = address;
    const receiverAddress = `T${"7".repeat(33)}`;
    const txHash = "e".repeat(64);
    const receiverFact = firstHopBlacklistFact({
      counterpartyAddress: senderAddress,
      direction: "inbound",
      transferTxHashes: [txHash],
      directTransferCoverage: "complete",
      shareSemantics: "exact",
      directionalPrincipalShare: 1
    });
    const receiverProfile = directCounterpartyProfile({
      subjectAddress: receiverAddress,
      counterpartyAddress: senderAddress,
      direction: "inbound",
      txHashes: [txHash],
      scoreContribution: 87
    });
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress,
      receiverAddress,
      txHash,
      fastReport: null,
      deepReport: null,
      receiverDeepReport: deepReport({
        subjectAddress: receiverAddress,
        firstHopBlacklistFacts: [receiverFact],
        directCounterpartyInteractionProfiles: [receiverProfile]
      }),
      whereReport: whereReport({ subjectAddress: senderAddress })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "direct_counterparty_policy",
      actionUnit: "incoming_deposit",
      score: 87,
      authority: { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "none" },
      modifiers: expect.arrayContaining(["direction_inbound", `deposit_receiver_${receiverAddress}`]),
      subject: { decisionScope: "incoming_unified", address: senderAddress, txHash }
    }));
  });

  it("does not promote absent or mismatched receiver facts, nor sender-deep outbound history", () => {
    const senderAddress = address;
    const receiverAddress = `T${"7".repeat(33)}`;
    const txHash = "e".repeat(64);
    const receiverFact = firstHopBlacklistFact({
      counterpartyAddress: senderAddress,
      direction: "inbound",
      transferTxHashes: [txHash]
    });
    const base = {
      senderAddress,
      receiverAddress,
      txHash,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({ subjectAddress: senderAddress })
    };
    const receiverReport = (fact: FirstHopBlacklistFact, subjectAddress = receiverAddress) => deepReport({
      subjectAddress,
      firstHopBlacklistFacts: [fact],
      directCounterpartyInteractionProfiles: []
    });
    const inputs = [
      base,
      { ...base, receiverDeepReport: receiverReport(receiverFact, `T${"8".repeat(33)}`) },
      { ...base, receiverDeepReport: receiverReport(firstHopBlacklistFact({ ...receiverFact, counterpartyAddress: `T${"9".repeat(33)}` })) },
      { ...base, receiverDeepReport: receiverReport(firstHopBlacklistFact({ ...receiverFact, direction: "outbound" })) },
      { ...base, receiverDeepReport: receiverReport(firstHopBlacklistFact({ ...receiverFact, transferTxHashes: ["f".repeat(64)] })) },
      {
        ...base,
        deepReport: deepReport({
          firstHopBlacklistFacts: [firstHopBlacklistFact({ transferTxHashes: [txHash] })],
          directCounterpartyInteractionProfiles: [directCounterpartyProfile({ txHashes: [txHash] })]
        })
      }
    ];

    for (const input of inputs) {
      expect(buildIncomingDepositMatrixCandidates(input)
        .some((candidate) => candidate.row === "direct_counterparty_policy")).toBe(false);
    }
  });

  it("maps Where source-policy evidence with explicit policy authority", () => {
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
      authority: {
        kind: "policy",
        decisionEligibility: "can_decline",
        coverageDependency: "wallet_provenance"
      },
      subject: {
        decisionScope: "wallet_unified",
        address,
        txHash: null
      },
      evidenceIds: ["source-policy:htx"]
    }));
  });

  it("maps limited coverage to explicit coverage authority", () => {
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
      authority: { kind: "coverage", coverageDependency: "wallet_provenance" },
      atomicSignals: expect.arrayContaining(["insufficient_coverage"])
    }));
  });

  it("maps incoming fresh HTX/Huobi exposure to deposit-scoped source policy", () => {
    const senderAddress = "TSender1111111111111111111111111111";
    const txHash = "tx-incoming";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({ subjectAddress: senderAddress }),
      freshBundleExposure: freshHtxExposure()
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 85,
      authority: {
        kind: "policy",
        decisionEligibility: "can_decline",
        coverageDependency: "deposit_provenance"
      },
      subject: { decisionScope: "incoming_unified", address: senderAddress, txHash },
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

    expect(candidates.some((item) => item.authority.kind === "exact_hard")).toBe(false);
  });

  it("ignores exact Fast evidence linked to another address", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: {
        ...fastReport(95, "stablecoin_usdt_blacklisted"),
        subjectAddress: "TOtherFastAddress1111111111111111111"
      },
      deepReport: null,
      whereReport: whereReport()
    });
    const scored = scoreMatrixCandidates(candidates, walletContext());

    expect(scored.riskVector.hard_proof ?? []).toHaveLength(0);
  });

  it("does not turn generated context into exact proof when assigned the hard row", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: fastReport(77),
      deepReport: null,
      whereReport: whereReport()
    });
    const contextual = candidates.find((item) => item.authority.kind === "context");
    expect(contextual).toBeDefined();
    const scored = scoreMatrixCandidates([{ ...contextual!, row: "hard_proof", score: 100 }], walletContext());

    expect(scored.riskVector.hard_proof?.[0]).toMatchObject({
      evidenceClass: "context",
      proofLevel: "context",
      score: 59
    });
  });

  it("does not give an Incoming hard floor to unrelated historical Deep exact evidence", () => {
    const senderAddress = address;
    const txHash = "incoming-deposit-tx";
    const deep = deepReport({
      extendedProvenanceProfiles: [{
        subjectAddress: senderAddress,
        direction: "inbound",
        maxDepth: 2,
        paths: [{
          direction: "inbound",
          depth: 2,
          pathAddresses: ["THistoricalSource", senderAddress],
          txHashes: ["historical-deep-tx"],
          amountRaw: "100000000",
          amountPreservationRatio: 1,
          firstTransferAt: "2026-05-01T00:00:00.000Z",
          lastTransferAt: "2026-05-01T00:00:01.000Z",
          label: "scam",
          labelAddress: "THistoricalSource",
          boundaryCategory: null,
          evidenceStrength: "exact_labeled_path",
          candidateScore: 95,
          features: []
        }],
        matchedVolumeRaw: "100000000",
        matchedVolumeRatio: 1,
        score: 95,
        features: [],
        coverage: {
          expandedAddresses: 1,
          fetchedAddressCount: 1,
          stoppedReasons: [],
          maxDepthReached: 2
        }
      }]
    });
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: deep,
      whereReport: whereReport({ subjectAddress: senderAddress })
    });
    const scored = scoreMatrixCandidates(candidates, incomingContext(senderAddress, txHash));

    expect(scored.riskVector.hard_proof?.some((item) => item.evidenceClass === "exact_hard") ?? false).toBe(false);
    expect(Object.values(scored.riskVector).flat().some((item) =>
      item.atomicSignals.includes("deep_high_risk_extended_provenance") && item.evidenceClass === "context"
    )).toBe(true);
  });

  it("accepts exact Deep evidence joined through a proved transaction-seeded Where path", () => {
    const txHash = "incoming-deposit-linked";
    const upstreamTxHash = "deep-upstream-linked";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: address,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: deepReportWithExactPaths([{ txHash: upstreamTxHash, label: "scam" }]),
      whereReport: whereReport({
        subjectAddress: address,
        originPaths: [originPath([txHash, upstreamTxHash])]
      })
    });
    const scored = scoreMatrixCandidates(candidates, incomingContext(address, txHash));

    expect(scored.riskVector.hard_proof ?? []).toContainEqual(expect.objectContaining({
      evidenceClass: "exact_hard",
      proofLevel: "exact",
      evidenceIds: [upstreamTxHash]
    }));
  });

  it("keeps only transaction-linked exact Deep source-policy paths authoritative for Incoming", () => {
    const txHash = "incoming-policy-deposit";
    const linkedTxHash = "deep-whitebit-linked";
    const unrelatedTxHash = "deep-whitebit-unrelated";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: address,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: deepReportWithExactPaths([
        { txHash: linkedTxHash, label: "whitebit" },
        { txHash: unrelatedTxHash, label: "whitebit" }
      ]),
      whereReport: whereReport({
        subjectAddress: address,
        originPaths: [originPath([txHash, linkedTxHash])]
      })
    });

    expect(candidates.find((item) => item.evidenceIds.includes(linkedTxHash))?.authority).toMatchObject({
      kind: "policy",
      decisionEligibility: "can_decline"
    });
    expect(candidates.find((item) => item.evidenceIds.includes(unrelatedTxHash))).toMatchObject({
      row: "counterparty_context",
      authority: { kind: "context" }
    });
  });

  it("keeps only transaction-linked inbound WhiteBIT evidence decline-capable for Incoming", () => {
    const txHash = "incoming-inbound-policy";
    const linkedTxHash = "inbound-whitebit-linked";
    const unrelatedTxHash = "inbound-whitebit-unrelated";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: address,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: deepReport({
        inboundProvenanceProfiles: [
          inboundWhitebitProfile(linkedTxHash),
          inboundWhitebitProfile(unrelatedTxHash)
        ]
      }),
      whereReport: whereReport({
        subjectAddress: address,
        originPaths: [originPath([txHash, linkedTxHash])]
      })
    });

    expect(candidates.find((item) => item.evidenceIds.includes(linkedTxHash))).toMatchObject({
      row: "source_policy",
      authority: { kind: "policy", decisionEligibility: "can_decline" }
    });
    expect(candidates.find((item) => item.evidenceIds.includes(unrelatedTxHash))).toMatchObject({
      row: "counterparty_context",
      authority: { kind: "context" }
    });
  });

  it("keeps only transaction-linked asset continuation decline-capable for Incoming", () => {
    const txHash = "incoming-asset-continuation";
    const linkedTxHash = "asset-continuation-linked";
    const unrelatedTxHash = "asset-continuation-unrelated";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: address,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: deepReport({
        assetContinuationProfiles: [
          assetContinuationProfile(linkedTxHash),
          assetContinuationProfile(unrelatedTxHash)
        ]
      }),
      whereReport: whereReport({
        subjectAddress: address,
        originPaths: [originPath([txHash, linkedTxHash])]
      })
    });

    expect(candidates.find((item) => item.evidenceIds.includes(linkedTxHash))).toMatchObject({
      row: "asset_continuation",
      authority: { kind: "pattern", decisionEligibility: "can_decline" }
    });
    expect(candidates.find((item) => item.evidenceIds.includes(unrelatedTxHash))).toMatchObject({
      row: "counterparty_context",
      authority: { kind: "context" }
    });
  });

  it("keeps historical operational flow contextual for Incoming and decline-capable for Wallet", () => {
    const profile = operationalFlowProfile();
    const deep = deepReport({ operationalFlowProfiles: [profile] });
    const incoming = buildIncomingDepositMatrixCandidates({
      senderAddress: address,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash: "incoming-operational-flow",
      fastReport: null,
      deepReport: deep,
      whereReport: whereReport({ subjectAddress: address })
    }).find((item) => item.atomicSignals.includes("historical_transit_pattern"));
    const wallet = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: deep,
      whereReport: whereReport()
    }).find((item) => item.atomicSignals.includes("historical_transit_pattern"));

    expect(incoming).toMatchObject({
      row: "behavior_only_prior",
      authority: { kind: "context" }
    });
    expect(wallet).toMatchObject({
      row: "service_linked_pattern",
      authority: { kind: "pattern", decisionEligibility: "can_decline" }
    });
  });

  it("matches exact Where proof levels to their evidence kind", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({
        proofLevel: "exact_approval_drain_provenance",
        assessment: {
          ...whereReport().assessment,
          hardBadEvidence: [
            { kind: "approval_drain", score: 95, message: "Exact approval drain.", evidenceIds: ["where-approval"] },
            { kind: "sanctioned_service", score: 90, message: "Sanctioned service.", evidenceIds: ["where-sanction"] },
            { kind: "scam_or_blacklist", score: 90, message: "Scam context.", evidenceIds: ["where-scam"] }
          ]
        }
      })
    });

    expect(candidates.find((item) => item.evidenceIds.includes("where-approval"))?.authority).toEqual({
      kind: "exact_hard",
      proofSource: "where_exact_hard"
    });
    expect(candidates.find((item) => item.evidenceIds.includes("where-sanction"))?.authority).toMatchObject({
      kind: "policy",
      decisionEligibility: "can_decline"
    });
    expect(candidates.find((item) => item.evidenceIds.includes("where-scam"))?.authority).toEqual({ kind: "context" });
  });

  it("admits only deposit-path-linked evidence from a mismatched transaction-seeded Where report", () => {
    const txHash = "incoming-mismatched-deposit";
    const linkedPolicyTx = "where-linked-policy";
    const unrelatedPolicyTx = "where-unrelated-policy";
    const unrelatedRiskTx = "where-unrelated-risk";
    const unrelatedHardTx = "where-unrelated-hard";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress: address,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({
        subjectAddress: "TOtherIncomingWhereSubject",
        originPaths: [originPath([txHash, linkedPolicyTx])],
        assessment: {
          ...whereReport().assessment,
          hardBadEvidence: [{
            kind: "scam_or_blacklist",
            score: 90,
            message: "Unrelated hard evidence.",
            evidenceIds: [unrelatedHardTx]
          }],
          sourcePolicyEvidence: [linkedPolicyTx, unrelatedPolicyTx].map((evidenceId) => ({
            kind: "whitebit" as const,
            aggregateShare: 0.8,
            effectiveShare: 0.8,
            pathCount: 1,
            score: 80,
            riskBand: "HIGH" as const,
            proofLevel: "exchange_policy_decline" as const,
            canBeDampened: false,
            reasons: ["Source-policy evidence."],
            warnings: [],
            evidenceIds: [evidenceId]
          })),
          riskLayers: [{
            evidenceClass: "source_policy",
            kind: "whitebit",
            sourceExposureKind: "whitebit",
            score: 80,
            rawScore: 80,
            adjustedScore: 80,
            proofLevel: "exchange_policy_decline",
            canBeDampened: false,
            reasons: ["Unrelated aggregate risk layer."],
            warnings: [],
            evidenceIds: [unrelatedRiskTx]
          }]
        },
        coverage: {
          ...whereReport().coverage,
          drainEpisode: {
            anchorTxHash: "where-unrelated-drain-anchor",
            fundingTxHash: "where-unrelated-drain-funding",
            fundingAmountRaw: "1885262475832",
            fundingTimestamp: "2026-05-05T13:31:30.000Z",
            startTimestamp: "2026-05-05T13:39:09.000Z",
            endTimestamp: "2026-05-05T15:00:30.000Z",
            episodeOutgoingRaw: "1885347470000",
            episodeSelectedRaw: "135300000000",
            episodeCoverageRatio: 0.071763,
            outgoingTxHashes: ["where-unrelated-drain-out"],
            bridgeOutgoingRaw: "1885347470000",
            bridgeOutgoingShare: 1
          }
        }
      })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      evidenceIds: [linkedPolicyTx],
      authority: expect.objectContaining({ kind: "policy" })
    }));
    expect(candidates).toContainEqual(expect.objectContaining({
      evidenceIds: ["coverage:where_subject_mismatch"],
      authority: { kind: "coverage", coverageDependency: "deposit_provenance" }
    }));
    expect(candidates.some((item) => item.evidenceIds.includes(unrelatedPolicyTx))).toBe(false);
    expect(candidates.some((item) => item.evidenceIds.includes(unrelatedRiskTx))).toBe(false);
    expect(candidates.some((item) => item.evidenceIds.includes(unrelatedHardTx))).toBe(false);
    expect(candidates.some((item) => item.atomicSignals.includes("where_drain_episode_transit_pattern"))).toBe(false);
  });

  it("turns a Where subject mismatch into coverage evidence", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({ subjectAddress: "TOtherWhereSubject111111111111111111" })
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        row: "coverage_uncertainty",
        authority: { kind: "coverage", coverageDependency: "wallet_provenance" },
        evidenceIds: ["coverage:where_subject_mismatch"]
      })
    ]);
  });

  it("uses deposit coverage when the Incoming Where subject mismatches the sender", () => {
    const senderAddress = address;
    const txHash = "incoming-subject-mismatch";
    const candidates = buildIncomingDepositMatrixCandidates({
      senderAddress,
      receiverAddress: "TReceiver11111111111111111111111111",
      txHash,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({ subjectAddress: "TOtherIncomingWhereSubject" })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      authority: { kind: "coverage", coverageDependency: "deposit_provenance" },
      subject: { decisionScope: "incoming_unified", address: senderAddress, txHash },
      actionUnit: "incoming_deposit",
      evidenceIds: ["coverage:where_subject_mismatch"]
    }));
  });

  it("keeps score-valid below-materiality Where residue as bounded review context", () => {
    const candidates = buildWalletMatrixCandidates({
      address,
      fastReport: null,
      deepReport: null,
      whereReport: whereReport({
        scoreValid: true,
        decision: "REVIEW",
        userDecision: "REVIEW",
        internalDecision: "REVIEW",
        riskScore: 54,
        coverage: { ...whereReport().coverage, partial: true },
        sourceProvenanceMateriality: {
          outcome: "residual_unresolved_below_materiality",
          materialityTier: "dust_residual",
          unresolvedAmountRaw: "1000000",
          unresolvedAmountUsdt: 1,
          unresolvedShareOfCheckedBalance: 0.001,
          unresolvedShareOfSelectedAmount: 0.001,
          largestUnresolvedAmountRaw: "1000000",
          largestUnresolvedAmountUsdt: 1,
          aggregateUnresolvedShareOfCheckedBalance: 0.001,
          aggregateUnresolvedShareOfSelectedAmount: 0.001,
          unresolvedPathCount: 1,
          denseHopUnresolvedPathCount: 0,
          hardEvidenceInUnresolved: false,
          excludedFromDecisiveScore: true,
          unresolvedReasonCounts: { residual: 1 },
          thresholds: {
            maxResidualUnresolvedShare: 0.01,
            maxResidualUnresolvedAmountUsdt: 100,
            maxResidualUnresolvedAmountRaw: "100000000",
            maxDenseHopUnresolvedShare: 0.01,
            maxDenseHopAggregateUnresolvedShare: 0.02,
            maxDenseHopUnresolvedAmountUsdt: 10000,
            maxDenseHopUnresolvedAmountRaw: "10000000000"
          }
        }
      })
    });

    expect(candidates).toContainEqual(expect.objectContaining({
      row: "counterparty_context",
      score: 54,
      authority: { kind: "context" },
      atomicSignals: ["where_residual_unresolved_below_materiality"]
    }));
    expect(candidates.some((item) => item.authority.kind === "coverage")).toBe(false);
  });
});
