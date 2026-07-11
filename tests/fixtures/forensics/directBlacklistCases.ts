import { TRON_USDT_CONTRACT_ADDRESS } from "../../../src/parser/transactionParser";
import type {
  DirectCounterpartyInteractionProfile,
  FirstHopBlacklistCoverage,
  FirstHopBlacklistFact,
  MoneyOriginPath,
  SourcePolicyEvidence,
  StablecoinRestrictionProfile
} from "../../../src/types";

export const TGYT_DIRECT_BLACKLIST_CASE = {
  subjectAddress: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
  counterpartyAddress: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm",
  gasFreeProviderAddress: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
  bridgeAddress: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV",
  smallPrincipalTxHash: "1".repeat(64),
  largePrincipalTxHash: "2".repeat(64),
  gasFreeFeeTxHash: "3".repeat(64),
  blacklistEventTxHash: "2413649b2f5b898b156b533e60f0066e727a0a4b96d7384d7ba37cdb1c005a5c",
  blacklistEffectiveAt: "2026-05-26T12:49:03.000Z",
  totalPrincipalRaw: "1176317000000",
  largestPrincipalRaw: "1176302000000",
  gasFreeFeeRaw: "3000000"
} as const;

export function tgytFirstHopBlacklistFact(): FirstHopBlacklistFact {
  const value = TGYT_DIRECT_BLACKLIST_CASE;
  return {
    counterpartyAddress: value.counterpartyAddress,
    direction: "outbound",
    evidenceKind: "usdt_blacklist",
    evidenceAuthority: "official_contract",
    statusAtCheck: "active",
    temporalRelation: "became_active_after",
    effectiveAt: value.blacklistEffectiveAt,
    effectiveTxHash: value.blacklistEventTxHash,
    checkedAt: "2026-07-11T00:00:00.000Z",
    principalAmountRaw: value.totalPrincipalRaw,
    principalTxCount: 2,
    directionalPrincipalShare: 1,
    shareSemantics: "exact",
    transferTxHashes: [value.smallPrincipalTxHash, value.largePrincipalTxHash],
    beforeEffectiveAmountRaw: value.totalPrincipalRaw,
    beforeEffectiveTxCount: 2,
    activeAmountRaw: "0",
    activeTxCount: 0,
    unknownTimingAmountRaw: "0",
    unknownTimingTxCount: 0,
    directTransferCoverage: "complete",
    timelineCoverage: "complete",
    timelineEvents: [{
      eventKind: "added",
      occurredAt: value.blacklistEffectiveAt,
      txHash: value.blacklistEventTxHash,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      blockNumber: 82950110,
      logIndex: 0,
      verification: "verified_contract_log"
    }]
  };
}

export function tgytFirstHopCoverage(): FirstHopBlacklistCoverage {
  return {
    requiredForDecision: true,
    scope: "all_time",
    windowStart: null,
    windowEnd: null,
    directPrincipalTransferCoverage: "complete",
    materialCounterpartyCount: 1,
    checkedMaterialCounterpartyCount: 1,
    failedMaterialCounterpartyCount: 0,
    uncheckedMaterialCounterpartyCount: 0,
    blacklistCheckCoverage: "complete",
    incompleteReason: null,
    confirmedAdverseFactCount: 1,
    completeTimelineFactCount: 1,
    partialTimelineFactCount: 0
  };
}

export function tgytSubjectRestriction(): StablecoinRestrictionProfile {
  return {
    subjectAddress: TGYT_DIRECT_BLACKLIST_CASE.subjectAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw: "0",
    checkedAt: "2026-07-11T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}

export function tgytDirectInteractionProfiles(): DirectCounterpartyInteractionProfile[] {
  const value = TGYT_DIRECT_BLACKLIST_CASE;
  const snapshot = {
    riskScore: 100,
    riskLevel: "CRITICAL" as const,
    source: "stablecoin_blacklist" as const,
    evidenceClass: "exact_labeled_counterparty" as const,
    reasons: ["usdt_blacklist"],
    partialNotes: []
  };
  return [{
    subjectAddress: value.subjectAddress,
    direction: "outbound",
    counterpartyAddress: value.counterpartyAddress,
    volumeRaw: value.totalPrincipalRaw,
    volumeRatio: 1,
    txCount: 2,
    firstSeen: "2026-05-26T09:44:33.000Z",
    lastSeen: "2026-05-26T09:56:18.000Z",
    txHashes: [value.smallPrincipalTxHash, value.largePrincipalTxHash],
    transfers: [{
      txHash: value.smallPrincipalTxHash,
      fromAddress: value.subjectAddress,
      toAddress: value.counterpartyAddress,
      amountRaw: "15000000",
      timestamp: "2026-05-26T09:44:33.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "principal",
      economicProtocol: "tron_gasfree"
    }, {
      txHash: value.largePrincipalTxHash,
      fromAddress: value.subjectAddress,
      toAddress: value.counterpartyAddress,
      amountRaw: value.largestPrincipalRaw,
      timestamp: "2026-05-26T09:56:18.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "principal",
      economicProtocol: "tron_gasfree"
    }],
    serviceCategory: null,
    identity: null,
    snapshot: { address: value.counterpartyAddress, ...snapshot },
    interactionWeight: 1,
    scoreContribution: 90,
    evidenceClass: "exact_labeled_counterparty",
    skippedReason: null
  }, {
    subjectAddress: value.subjectAddress,
    direction: "outbound",
    counterpartyAddress: value.gasFreeProviderAddress,
    volumeRaw: value.gasFreeFeeRaw,
    volumeRatio: 0,
    txCount: 1,
    firstSeen: "2026-05-26T09:56:19.000Z",
    lastSeen: "2026-05-26T09:56:19.000Z",
    txHashes: [value.gasFreeFeeTxHash],
    transfers: [{
      txHash: value.gasFreeFeeTxHash,
      fromAddress: value.subjectAddress,
      toAddress: value.gasFreeProviderAddress,
      amountRaw: value.gasFreeFeeRaw,
      timestamp: "2026-05-26T09:56:19.000Z",
      method: "transfer",
      edgeType: "normal_transfer",
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree"
    }],
    serviceCategory: null,
    identity: "TronLink GasFree",
    snapshot: {
      address: value.gasFreeProviderAddress,
      riskScore: 0,
      riskLevel: "LOW",
      source: "none",
      evidenceClass: "service_boundary_context",
      reasons: [],
      partialNotes: []
    },
    interactionWeight: 0,
    scoreContribution: 0,
    evidenceClass: "service_boundary_context",
    skippedReason: "service_boundary_context"
  }];
}

export function tgytBridgePath(): MoneyOriginPath {
  const value = TGYT_DIRECT_BLACKLIST_CASE;
  const bridgeTxHash = "4".repeat(64);
  return {
    balanceTransferTxHash: bridgeTxHash,
    rootSourceAddress: value.bridgeAddress,
    rootSourceType: "decline_boundary",
    balanceShare: 0.83,
    exposureSourceKey: "usdtooft",
    exposureSourceLabel: "UsdtOFT",
    sourceExposureKind: "cross_chain_boundary",
    effectiveExposureShare: 0.83,
    amountUsage: {
      anchorAmountRaw: value.totalPrincipalRaw,
      originalAmountRaw: "976343110000",
      usedAmountRaw: "976343110000",
      coverageShare: 0.83,
      role: "anchor"
    },
    pathAddresses: [value.bridgeAddress, value.subjectAddress],
    txHashes: [bridgeTxHash],
    steps: [{
      txHash: bridgeTxHash,
      fromAddress: value.bridgeAddress,
      toAddress: value.subjectAddress,
      amountRaw: "976343110000",
      timestamp: "2026-05-25T09:00:00.000Z"
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 0,
    stoppedReason: "service_boundary",
    verdict: "REVIEW",
    riskScoreContribution: 78,
    reasons: []
  };
}

export function tgytBridgePolicyEvidence(): SourcePolicyEvidence {
  const bridgeTxHash = "4".repeat(64);
  return {
    kind: "cross_chain_boundary",
    aggregateShare: 0.83,
    effectiveShare: 0.83,
    pathCount: 1,
    score: 78,
    riskBand: "HIGH",
    proofLevel: "exchange_policy_decline",
    canBeDampened: true,
    reasons: [],
    warnings: [],
    evidenceIds: [bridgeTxHash],
    shareDetail: {
      scope: "where_selected_amount",
      targetAmountRaw: TGYT_DIRECT_BLACKLIST_CASE.totalPrincipalRaw,
      affectedAmountRaw: "976343110000",
      rawShare: 0.83,
      effectiveShare: 0.83,
      sourceSeverity: 78,
      valueWeightedRaw: 78,
      pathContextAdjustment: 0,
      repeatedExposureAdjustment: 0,
      dataQualityAdjustment: 0,
      walletRoleAdjustment: 0,
      shareFloor: 0,
      shareCap: 100,
      finalContribution: 78
    }
  };
}
