export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type WalletAlertMode = "realtime" | "risk_only" | "digest" | "paused";
export type WalletApprovalSpenderType = "eoa" | "contract" | "unknown";

export type RiskLabel =
  | "scam"
  | "stolen_funds"
  | "phishing"
  | "mule"
  | "collector"
  | "bridge"
  | "exchange"
  | "trusted"
  | "false_positive"
  | "needs_review"
  | "mixer_like"
  | "risky_contract"
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

export type ApprovalDrainTokenState = {
  address: string;
  balanceRaw: string | null;
  isBlacklisted: boolean | null;
  blockedBalanceRaw: string | null;
  checkedAt: string | null;
};

export type ApprovalDrainProvenanceProfile = {
  victimAddress: string;
  approvalTxHash: string;
  drainTxHash: string;
  spenderAddress: string;
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
  stablecoinRestrictionProfiles?: StablecoinRestrictionProfile[];
  extendedProvenanceProfiles?: ExtendedProvenanceProfile[];
};
