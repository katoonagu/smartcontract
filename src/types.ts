export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskDominantRiskType = "none" | "taint" | "laundering_pattern" | "mixed";
export type WalletAlertMode = "realtime" | "risk_only" | "digest" | "paused";
export type WalletApprovalSpenderType = "eoa" | "contract" | "unknown";
export type BotLocale = "ru" | "en";

export type RiskLabel =
  | "scam"
  | "reported_scam"
  | "stolen_funds"
  | "phishing"
  | "victim"
  | "mule"
  | "collector"
  | "bridge"
  | "exchange"
  | "trusted"
  | "false_positive"
  | "needs_review"
  | "mixer_like"
  | "risky_contract"
  | "whitebit"
  | "darknet_exchange"
  | "darknet_exchange_proximity"
  | "approval_drain_proximity";

export type WatchedWallet = {
  id: string;
  telegramUserId: string;
  telegramUsername: string | null;
  address: string;
  createdAt: Date;
  alertMode: WalletAlertMode;
  digestIntervalMinutes: number;
};

export type TronTransferEvent = {
  txHash: string;
  token: "USDT";
  sender: string;
  receiver: string;
  amount: string;
  timestamp: Date;
};

export type AddressLabel = {
  address: string;
  label: RiskLabel;
  source: "service_admin" | "system";
  createdByTelegramId: string | null;
  createdAt: Date;
};

export type RiskReason = {
  code: string;
  message: string;
  scoreImpact: number;
  source?: string;
  confidence?: RiskConfidence;
  severity?: RiskSeverity;
  evidenceRef?: string;
};

export type RiskReport = {
  subjectAddress: string;
  level: RiskLevel;
  score: number;
  taintScore?: number;
  launderingPatternScore?: number;
  dominantRiskType?: RiskDominantRiskType;
  reasons: RiskReason[];
};

export type RiskConfidence = "low" | "medium" | "high";
export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";
export type RiskSignalGroup = "internal_label" | "provider" | "graph" | "behavior" | "incoming_context" | "approval" | "manual";
export type RawEvidenceSourceType = "internal_label" | "provider_response" | "detector_output" | "transfer_context" | "manual_input";
export type TronUsdtTransferMethod = "transfer" | "transferFrom";
export type CachedAddressLabelProvider = "tronscan" | "oklink" | "arkham" | "manual";
export type CachedAddressLabelCategory =
  | "cex"
  | "hot_wallet"
  | "bridge"
  | "router"
  | "dex"
  | "pool"
  | "scam"
  | "darknet_exchange"
  | "unknown";

export type RawEvidenceInput = {
  id: string;
  source: string;
  sourceType: RawEvidenceSourceType;
  chain: string;
  address: string | null;
  txHash: string | null;
  observedTransactionHash: string | null;
  evidenceJson: Record<string, unknown>;
};

export type RiskSignalObservationInput = {
  id: string;
  subjectChain: string;
  subjectAddress: string;
  subjectTxHash: string | null;
  observedTransactionHash: string | null;
  signalGroup: RiskSignalGroup;
  code: string;
  message: string;
  scoreImpact: number;
  confidence: RiskConfidence;
  severity: RiskSeverity;
  source: string;
  policyVersion: string;
  rawEvidenceId: string | null;
};

export type ForensicCaseStatus = "completed" | "partial" | "failed";
export type ForensicRouteConfidence = "low" | "medium" | "high";
export type ForensicRouteEdgeType = "normal_transfer" | "transfer_from" | "unknown";
export type ServiceCategory =
  | "bridge"
  | "bridge_pool"
  | "dex"
  | "router"
  | "cex"
  | "hot_wallet"
  | "swap_adapter"
  | "unknown_contract"
  | "none";

export type ServiceClassification = {
  category: ServiceCategory;
  identity: string | null;
  confidence: RiskConfidence;
  evidence: string[];
  isBoundary: boolean;
};

export type ForensicCaseInput = {
  id: string;
  sourceAddress: string;
  targetAddress: string;
  amountUsdt: string | null;
  windowStart: Date;
  windowEnd: Date;
  status: ForensicCaseStatus;
};

export type RouteScoreFeature = {
  code: string;
  label: string;
  scoreImpact: number;
  value?: string | number | boolean | null;
};

export type ForensicRouteEdge = {
  id: string;
  fromAddress: string;
  toAddress: string;
  txHash: string;
  amountRaw: string;
  timestamp: Date;
  method: string;
  edgeType: ForensicRouteEdgeType;
};

export type IndexedTronUsdtTransfer = {
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  eventIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  method: TronUsdtTransferMethod;
  callerAddress: string | null;
  contractRet: string | null;
  confirmed: boolean;
};

export type IndexedTronUsdtApproval = {
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  eventIndex: number;
  ownerAddress: string;
  spenderAddress: string;
  amountRaw: string;
  isUnlimited: boolean;
};

export type ExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";

export type BalanceFormingTransfer = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  coverageShare: number;
  selectedReason: "covers_current_balance";
};

export type BalanceFormingSelection = {
  transfers: BalanceFormingTransfer[];
  selectedVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  partial: boolean;
  notes: string[];
};

export type MoneyOriginRootSourceType =
  | "allowlist_cex"
  | "decline_boundary"
  | "risky_label"
  | "unknown"
  | "incomplete";

export type MoneyOriginStoppedReason =
  | "allowlist_cex_reached"
  | "decline_boundary_reached"
  | "risky_label_reached"
  | "data_budget_exhausted"
  | "no_previous_transfer"
  | "weak_amount_or_time_continuity"
  | "unlabeled_service_boundary";

export type MoneyOriginPathStep = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
};

export type MoneyOriginPath = {
  balanceTransferTxHash: string;
  rootSourceAddress: string | null;
  rootSourceType: MoneyOriginRootSourceType;
  pathAddresses: string[];
  txHashes: string[];
  steps: MoneyOriginPathStep[];
  amountPreservationRatio: number;
  timeSpanMs: number | null;
  stoppedReason: MoneyOriginStoppedReason;
  verdict: ExchangeDecision;
  riskScoreContribution: number;
  reasons: string[];
};

export type MoneyOriginCounterpartySummary = {
  address: string;
  direction: "incoming" | "outgoing";
  volumeRaw: string;
  txCount: number;
  firstSeen: string;
  lastSeen: string;
  txHashes: string[];
};

export type MoneyOriginFundingCandidate = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  amountPreservationRatio: number;
  timeDeltaMs: number;
};

export type MoneyOriginSenderInteractionProfile = {
  balanceTransferTxHash: string;
  senderAddress: string;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  topIncomingCounterparties: MoneyOriginCounterpartySummary[];
  topOutgoingCounterparties: MoneyOriginCounterpartySummary[];
  fundingCandidates: MoneyOriginFundingCandidate[];
};

export type WhereIsMoneyCoverage = {
  selectedInboundTxCount: number;
  selectedInboundVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  maxDepth: number;
  fetchedAddressCount: number;
  partial: boolean;
  notes: string[];
};

export type ContractLlmVerdictKind =
  | "legitimate_service"
  | "drainer_like"
  | "unknown_suspicious"
  | "unknown_insufficient_data";

export type ContractLlmVerdictSource = "llm" | "cache" | "unavailable";

export type ContractLlmDecisionRecommendation = "ACCEPTABLE" | "DECLINE";

export type ContractLlmVerdictSummary = {
  source: ContractLlmVerdictSource;
  cacheMatch?: "address" | "fingerprint" | null;
  reusedFromContractAddress?: string | null;
  providerLabel: string;
  model: string;
  contractAddress: string | null;
  caseFileHash: string;
  cacheId: string | null;
  verdict: ContractLlmVerdictKind;
  confidence: number;
  contractRiskScore: number;
  decisionRecommendation: ContractLlmDecisionRecommendation;
  reasons: string[];
  citedEvidenceIds: string[];
  falsePositiveNotes: string[];
  error?: string | null;
};

export type ContractAnalysisCaseFile = {
  policyVersion: string;
  subjectAddress: string;
  checkedWalletAddress: string;
  contractAddress: string | null;
  currentUsdtBalanceRaw: string | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
  serviceClassification: ServiceClassification | null;
  contractProfile: Record<string, unknown> | null;
  evidenceIds: string[];
  policyQuestion: string;
};

export type WhereIsMoneyReport = {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings?: ApprovalDrainReviewFinding[];
  contractLlmVerdicts?: ContractLlmVerdictSummary[];
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
  coverage: WhereIsMoneyCoverage;
};

export type AddressFeaturesDaily = {
  address: string;
  day: Date;
  inVolumeRaw: string;
  outVolumeRaw: string;
  inCount: number;
  outCount: number;
  uniqueIn: number;
  uniqueOut: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
};

export type AddressLabelCacheEntry = {
  chain: string;
  address: string;
  provider: CachedAddressLabelProvider;
  label: string;
  category: CachedAddressLabelCategory;
  confidence: RiskConfidence;
  sourceUrl: string | null;
  rawJson: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type ForensicRoutePath = {
  id: string;
  caseId: string;
  rank: number;
  score: number;
  confidence: ForensicRouteConfidence;
  pathAddresses: string[];
  features: RouteScoreFeature[];
  reasons: RiskReason[];
  rawEvidenceId: string | null;
  edges: ForensicRouteEdge[];
};

export type ServiceExposureProfile = {
  subjectAddress: string;
  totalOutgoingRaw: string;
  totalOutgoingCount: number;
  directServiceVolumeRatio: number;
  directServiceTxRatio: number;
  indirectServiceVolumeRatio: number;
  indirectServiceTxRatio: number;
  mergedServiceVolumeRatio: number;
  mergedServiceGroupCount: number;
  combinedServiceVolumeRatio: number;
  combinedServiceTxRatio: number;
  dominantCategory: ServiceCategory | null;
  categoryBreakdown: Array<{
    category: ServiceCategory;
    volumeRaw: string;
    txCount: number;
    volumeRatio: number;
  }>;
  topServiceCounterparties: Array<{
    address: string;
    category: ServiceCategory;
    identity: string | null;
    volumeRaw: string;
    txCount: number;
  }>;
  topMergedServiceFlows: Array<{
    intermediateAddress: string;
    serviceAddress: string;
    category: ServiceCategory;
    identity: string | null;
    incomingRaw: string;
    outgoingServiceRaw: string;
    sourceTxCount: number;
    serviceTxCount: number;
    amountPreservationRatio: number;
    firstSourceTransferAt: string;
    lastServiceTransferAt: string;
  }>;
  fastestServiceExitMs: number | null;
  bestAmountPreservationRatio: number | null;
  exposureScore: number;
  features: RouteScoreFeature[];
};

export type WalletRole =
  | "victim"
  | "drainer_spender"
  | "first_receiver"
  | "collector"
  | "mule"
  | "cashout_service"
  | "treasury_like"
  | "unknown";

export type WalletRoleReason = RouteScoreFeature & {
  role: WalletRole;
};

export type WalletRoleProfile = {
  subjectAddress: string;
  primaryRole: WalletRole;
  roles: Array<{
    role: WalletRole;
    confidence: RiskConfidence;
    score: number;
    reasons: WalletRoleReason[];
  }>;
  evidenceStrength: "exact" | "strong_behavior" | "context" | "weak";
  features: RouteScoreFeature[];
};

export type BoundaryExposureDirection = "inbound" | "outbound";
export type BoundaryExposureDepth = 1 | 2 | 3 | 4;

export type BoundaryExposureFlow = {
  direction: BoundaryExposureDirection;
  depth: BoundaryExposureDepth;
  boundaryAddress: string;
  boundaryCategory: ServiceCategory;
  boundaryIdentity: string | null;
  viaAddress: string | null;
  viaAddresses?: string[];
  subjectTxHash: string;
  boundaryTxHash: string;
  amountRaw: string;
  boundaryAmountRaw: string;
  amountPreservationRatio: number;
  firstTransferAt: string;
  lastTransferAt: string;
};

export type BoundaryExposureEntity = {
  address: string;
  category: ServiceCategory;
  identity: string | null;
  direction: BoundaryExposureDirection;
  volumeRaw: string;
  txCount: number;
  maxDepth: BoundaryExposureDepth;
};

export type BoundaryExposureProfile = {
  subjectAddress: string;
  incomingBoundaryVolumeRaw: string;
  outgoingBoundaryVolumeRaw: string;
  incomingBoundaryVolumeRatio: number;
  outgoingBoundaryVolumeRatio: number;
  directBoundaryTxCount: number;
  twoHopBoundaryTxCount: number;
  topBoundaryEntities: BoundaryExposureEntity[];
  categoryBreakdown: Array<{
    category: ServiceCategory;
    direction: BoundaryExposureDirection;
    volumeRaw: string;
    txCount: number;
    volumeRatio: number;
  }>;
  flows: BoundaryExposureFlow[];
  contextScore: number;
  features: RouteScoreFeature[];
  coverage?: {
    expandedAddresses: number;
    fetchedAddressCount: number;
    stoppedReasons: string[];
    maxDepthReached: number;
  };
};

export type FlowCounterpartyDirection = "incoming" | "outgoing";

export type FlowCounterpartySummary = {
  address: string;
  direction: FlowCounterpartyDirection;
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
  category: ServiceCategory | null;
  identity: string | null;
  isTerminalLiquidity: boolean;
  isHtxHuobi: boolean;
};

export type FlowCategoryBreakdown = {
  direction: FlowCounterpartyDirection;
  category: ServiceCategory;
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
};

export type OperationalFlowProfile = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  inflowToOutflowRatio: number | null;
  topIncomingCounterparties: FlowCounterpartySummary[];
  topOutgoingCounterparties: FlowCounterpartySummary[];
  categoryBreakdown: FlowCategoryBreakdown[];
  terminalLiquidityIncomingRatio: number;
  terminalLiquidityOutgoingRatio: number;
  htxHuobiIncomingRatio: number;
  htxHuobiOutgoingRatio: number;
  bridgeDexRouterOutgoingRatio: number;
  unknownContractOutgoingRatio: number;
  operationalScore: number;
  features: RouteScoreFeature[];
};

export type AddressBehaviorProfile = {
  subjectAddress: string;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  uniqueIncomingCounterparties: number;
  uniqueOutgoingCounterparties: number;
  largestIncomingRaw: string | null;
  largestOutgoingRaw: string | null;
  topOutgoingCounterpartyAddress: string | null;
  topOutgoingCounterpartyRaw: string | null;
  topOutgoingCounterpartyTxCount: number;
  topOutgoingCounterpartyRatio: number;
  inflowToOutflowRatio: number | null;
  drainToServiceRatio: number;
  timeToFirstOutgoingMs: number | null;
  timeToFirstServiceExitMs: number | null;
  depositThenDrainScore: number;
  transitScore: number;
  dampenerScore: number;
  features: RouteScoreFeature[];
};

export type InboundProvenancePath = {
  depth: 1 | 2;
  sourceAddress: string;
  viaAddresses: string[];
  label: RiskLabel;
  amountRaw: string;
  amountPreservationRatio: number;
  firstTransferAt: string;
  lastTransferAt: string;
  txHashes: string[];
};

export type InboundProvenanceProfile = {
  subjectAddress: string;
  incomingVolumeRaw: string;
  matchedInboundVolumeRaw: string;
  paths: InboundProvenancePath[];
  boundaryNotes: string[];
  score: number;
  features: RouteScoreFeature[];
};

export type ExtendedProvenanceDirection = "inbound" | "outbound";
export type ExtendedProvenanceEvidenceStrength =
  | "exact_labeled_path"
  | "service_boundary_context"
  | "weak_inferred_candidate";

export type ExtendedProvenancePath = {
  direction: ExtendedProvenanceDirection;
  depth: number;
  pathAddresses: string[];
  txHashes: string[];
  amountRaw: string;
  amountPreservationRatio: number;
  firstTransferAt: string;
  lastTransferAt: string;
  label: RiskLabel | null;
  labelAddress: string | null;
  boundaryCategory: ServiceCategory | null;
  evidenceStrength: ExtendedProvenanceEvidenceStrength;
  candidateScore: number;
  features: RouteScoreFeature[];
};

export type ExtendedProvenanceProfile = {
  subjectAddress: string;
  direction: ExtendedProvenanceDirection;
  maxDepth: number;
  paths: ExtendedProvenancePath[];
  matchedVolumeRaw: string;
  matchedVolumeRatio: number;
  score: number;
  features: RouteScoreFeature[];
  coverage: {
    expandedAddresses: number;
    fetchedAddressCount: number;
    stoppedReasons: string[];
    maxDepthReached: number;
  };
};

export type CounterpartyRiskDirection = "inbound" | "outbound";

export type CounterpartyRiskProfile = {
  subjectAddress: string;
  direction: CounterpartyRiskDirection;
  counterpartyAddress: string;
  label: RiskLabel | null;
  serviceCategory: ServiceCategory | null;
  identity: string | null;
  amountRaw: string;
  txCount: number;
  volumeRatio: number;
  firstTransferAt: string;
  lastTransferAt: string;
  txHashes: string[];
  score: number;
  features: RouteScoreFeature[];
};

export type CounterpartyRiskSnapshotSource =
  | "exact_label"
  | "derived_label"
  | "stablecoin_blacklist"
  | "prior_risk_evaluation"
  | "fast_address_check"
  | "service_boundary"
  | "none";

export type CounterpartyRiskSnapshotEvidenceClass =
  | "exact_labeled_counterparty"
  | "derived_labeled_counterparty"
  | "counterparty_fast_risk_snapshot"
  | "counterparty_behavior_context"
  | "service_boundary_context"
  | "no_exact_label_or_cached_taint"
  | "provider_partial";

export type CounterpartyRiskSnapshot = {
  address: string;
  riskScore: number;
  riskLevel: RiskLevel;
  source: CounterpartyRiskSnapshotSource;
  evidenceClass: CounterpartyRiskSnapshotEvidenceClass;
  reasons: string[];
  partialNotes: string[];
};

export type DirectCounterpartyInteractionProfile = {
  subjectAddress: string;
  direction: CounterpartyRiskDirection;
  counterpartyAddress: string;
  volumeRaw: string;
  volumeRatio: number;
  txCount: number;
  firstSeen: string;
  lastSeen: string;
  txHashes: string[];
  serviceCategory: ServiceCategory | null;
  identity: string | null;
  snapshot: CounterpartyRiskSnapshot;
  interactionWeight: number;
  scoreContribution: number;
  evidenceClass: CounterpartyRiskSnapshotEvidenceClass;
  skippedReason:
    | "not_selected_for_fast_snapshot"
    | "provider_partial"
    | "no_exact_label_or_cached_taint"
    | "service_boundary_context"
    | "counterparty_behavior_context"
    | null;
};

export type ApprovalDrainTokenState = {
  address: string;
  balanceRaw: string | null;
  isBlacklisted: boolean | null;
  blockedBalanceRaw: string | null;
  checkedAt: string | null;
};

export type ApprovalDrainSpenderResolution = "direct_usdt_owner" | "wrapper_contract" | "unknown";

export type ApprovalDrainFalsePositiveGuard = {
  code:
    | "spender_service_boundary"
    | "receiver_service_boundary"
    | "intermediate_service_boundary"
    | "subject_service_boundary"
    | "service_boundary_route";
  label: string;
  address: string | null;
  category: ServiceCategory | null;
  identity: string | null;
};

export type ApprovalDrainSupportingFingerprint = {
  code:
    | "misleading_wrapper_method"
    | "nearby_non_usdt_token_transfer"
    | "amount_preservation"
    | "multiple_exact_approval_drain_profiles"
    | "same_spender_cluster"
    | "same_receiver_cluster";
  label: string;
  value?: string | number | boolean | null;
};

export type ApprovalDrainProvenanceProfile = {
  victimAddress: string;
  approvalTxHash: string;
  drainTxHash: string;
  spenderAddress: string;
  operatorAddress?: string | null;
  spenderResolution?: ApprovalDrainSpenderResolution;
  falsePositiveGuards?: ApprovalDrainFalsePositiveGuard[];
  supportingFingerprints?: ApprovalDrainSupportingFingerprint[];
  firstReceiverAddress: string;
  subjectAddress: string;
  hopDepth: 0 | 1 | 2;
  amountRaw: string;
  amountPreservationRatio: number;
  approvalAt: string;
  drainAt: string;
  pathTxHashes: string[];
  pathAddresses: string[];
  score: number;
  evidenceStrength: "exact_approval_and_transfer_from" | "route_linked";
  subjectTokenState: ApprovalDrainTokenState | null;
  victimTokenState: ApprovalDrainTokenState | null;
  features: RouteScoreFeature[];
};

export type ApprovalDrainReviewFinding = {
  victimAddress: string;
  drainTxHash: string;
  spenderAddress: string | null;
  operatorAddress: string | null;
  spenderResolution: ApprovalDrainSpenderResolution;
  firstReceiverAddress: string;
  subjectAddress: string;
  reason:
    | "spender_unknown"
    | "approval_not_found"
    | "path_not_proven"
    | "service_boundary_guard";
  falsePositiveGuards: ApprovalDrainFalsePositiveGuard[];
  supportingFingerprints: ApprovalDrainSupportingFingerprint[];
};

export type StablecoinRestrictionProfile = {
  subjectAddress: string;
  tokenContract: string;
  tokenSymbol: "USDT";
  tokenStandard: "TRC20";
  decimals: number;
  isBlacklisted: boolean;
  balanceRaw: string | null;
  checkedAt: string;
  evidenceStrength: "exact_contract_state";
  blacklistEventTxHash?: string | null;
  blacklistEventTimestamp?: string | null;
  blacklistEventBlock?: number | null;
  methods: {
    blacklist: "isBlackListed(address)" | "getBlackListStatus(address)";
    balance: "balanceOf(address)" | null;
  };
};

export type RouteSearchOptions = {
  sourceAddress: string;
  targetAddress: string;
  amountUsdt?: string | null;
  windowStart: Date;
  windowEnd: Date;
  maxDepth: number;
  maxPagesPerAddress: number;
  pageLimit: number;
  limit: number;
};

export type RouteSearchReport = {
  case: ForensicCaseInput;
  paths: ForensicRoutePath[];
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
  missingChecks: string[];
  serviceExposureProfiles: ServiceExposureProfile[];
};

export type AddressExposureReport = {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
  missingChecks: string[];
  serviceExposureProfiles: ServiceExposureProfile[];
  addressBehaviorProfiles: AddressBehaviorProfile[];
  inboundProvenanceProfiles?: InboundProvenanceProfile[];
  counterpartyRiskProfiles?: CounterpartyRiskProfile[];
  directCounterpartyInteractionProfiles?: DirectCounterpartyInteractionProfile[];
  stablecoinRestrictionProfiles?: StablecoinRestrictionProfile[];
  extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
  boundaryExposureProfiles?: BoundaryExposureProfile[];
  operationalFlowProfiles?: OperationalFlowProfile[];
  walletRoleProfiles?: WalletRoleProfile[];
};
