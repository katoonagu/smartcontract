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
  locale?: BotLocale | null;
};

export type TronTransferEvent = {
  txHash: string;
  token: "USDT";
  sender: string;
  receiver: string;
  amount: string;
  timestamp: Date;
};

export type TronScanBlacklistRow = {
  blackAddress: string;
  tokenName: string;
  num: string;
  time: number;
  transHash: string;
  contractAddress: string;
};

export type UsdtBlacklistTimelineEvent = {
  eventKind: "added" | "removed";
  occurredAt: string;
  txHash: string;
  tokenContract: string;
  blockNumber: number | null;
  logIndex: number | null;
  verification: "verified_contract_log" | "unverified";
};

export type UsdtBlacklistTimeline = {
  events: UsdtBlacklistTimelineEvent[];
  pagination: "complete" | "partial";
  failureReason:
    | "provider_failed"
    | "address_mismatch"
    | "wrong_contract"
    | "transaction_unconfirmed"
    | "event_log_unverified"
    | "state_timeline_inconsistent"
    | null;
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
export type ScoringRiskSignalGroup = "internal_label" | "provider" | "graph" | "behavior" | "incoming_context" | "approval" | "manual";
export type RiskSignalGroup = ScoringRiskSignalGroup | "wallet_safety";
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

export type AddressPoisoningCheckStatus =
  | "pending"
  | "running"
  | "inconclusive"
  | "clear"
  | "candidate"
  | "failed"
  | "skipped"
  | "skipped_backfill";
export type AddressPoisoningCoverage = "complete" | "partial";
export type AddressPoisoningClearReason =
  | "complete_no_match"
  | "prior_relationship"
  | "trusted_sender"
  | "authoritative_service";
export type AddressPoisoningClassification = "CRITICAL" | "HIGH";
export type AddressPoisoningCandidateStatus = "candidate" | "confirmed" | "dismissed";
export type AddressPoisoningAlertStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type AddressPoisoningCheckWorkItem = {
  txHash: string;
  watchedWalletId: string;
  walletAddress: string;
  telegramUserId: string;
  sender: string;
  receiver: string;
  token: "USDT";
  amount: string;
  timestamp: Date;
  /** Completed provider failures: the initial execution starts at 0, failures 1..3 schedule retries, and failure 4 is terminal. */
  attemptCount: number;
  logicalOffset: number;
  pageCount: number;
  fetchedCount: number;
  oldestFetchedAt: Date | null;
  coverage: AddressPoisoningCoverage | null;
  accumulatedLookupJson: Record<string, unknown>;
  leaseVersion: Date;
};

export type AddressPoisoningCandidate = {
  id: string;
  callbackToken: string;
  watchedWalletId: string;
  tokenContract: string;
  tokenSymbol: string;
  tokenDecimals: number;
  suspiciousIncomingTxHash: string;
  suspiciousSender: string;
  suspiciousAmountRaw: string;
  suspiciousIncomingAt: Date;
  matchedOutgoingTxHash: string;
  genuineRecipient: string;
  matchedOutgoingAmountRaw: string;
  matchedOutgoingAt: Date;
  rawPrefixLength: number;
  meaningfulPrefixLength: number;
  suffixLength: number;
  classification: AddressPoisoningClassification;
  confidence: RiskConfidence;
  rawEvidenceId: string;
  secondaryMatches: unknown[];
  evidenceJson: Record<string, unknown>;
  status: AddressPoisoningCandidateStatus;
  alertFingerprint: string;
  alertStatus: AddressPoisoningAlertStatus;
  /** Locale fixed atomically when this alert first becomes delivery-owned. */
  alertLocale: BotLocale | null;
  /** Delivery executions consumed by claims, including stale-sending reclaims; maximum 4. */
  alertAttempts: number;
  alertLeaseUpdatedAt: Date | null;
  alertNextRetryAt: Date | null;
  alertLastError: string | null;
  telegramChatId: string | null;
  telegramMessageId: string | null;
  laterLossTxHash: string | null;
  laterLossEvidenceJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  alertSentAt: Date | null;
};

export type AddressPoisoningCandidateDelivery = AddressPoisoningCandidate & {
  walletAddress: string;
  telegramUserId: string;
  locale: BotLocale | null;
  alertMode: WalletAlertMode;
  /** Monotonic delivery-claim generation, equal to alertAttempts for this work item. */
  alertAttempt: number;
  /** Dedicated delivery lease; unrelated candidate updatedAt changes do not invalidate it. */
  alertLeaseVersion: Date;
};

export type PersistAddressPoisoningCandidateInput = {
  policyVersion: string;
  watchedWalletId: string;
  walletAddress: string;
  tokenContract: string;
  tokenSymbol: string;
  tokenDecimals: number;
  suspiciousIncomingTxHash: string;
  suspiciousSender: string;
  suspiciousAmountRaw: string;
  suspiciousIncomingAt: Date;
  matchedOutgoingTxHash: string;
  genuineRecipient: string;
  matchedOutgoingAmountRaw: string;
  matchedOutgoingAt: Date;
  rawPrefixLength: number;
  meaningfulPrefixLength: number;
  suffixLength: number;
  classification: AddressPoisoningClassification;
  confidence: RiskConfidence;
  secondaryMatches: unknown[];
  evidenceJson: Record<string, unknown>;
  coverage: AddressPoisoningCoverage;
  logicalOffset: number;
  pageCount: number;
  fetchedCount: number;
  oldestFetchedAt: Date | null;
  accumulatedLookupJson: Record<string, unknown>;
  leaseVersion: Date;
};

export type ForensicCaseStatus = "completed" | "partial" | "failed";
export type ForensicRouteConfidence = "low" | "medium" | "high";
export type ForensicRouteEdgeType = "normal_transfer" | "transfer_from" | "unknown";
export type ForensicEconomicRole = "principal" | "service_fee";
export type ForensicEconomicProtocol = "tron_gasfree";
export type ServiceCategory =
  | "bridge"
  | "bridge_pool"
  | "dex"
  | "router"
  | "cex"
  | "hot_wallet"
  | "swap_adapter"
  | "service"
  | "protocol"
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
  economicRole?: ForensicEconomicRole;
  economicProtocol?: ForensicEconomicProtocol;
};

export type IndexedTronUsdtTransfer = {
  transferId?: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  eventIndex: number;
  provider?: TronAddressUsdtIndexProvider;
  providerRowOrdinalInTx?: number | null;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  method: TronUsdtTransferMethod;
  eventType?: string | null;
  callerAddress: string | null;
  contractRet: string | null;
  finalResult?: string | null;
  reverted?: boolean;
  riskTransaction?: boolean;
  confirmed: boolean;
};

export type TronAddressUsdtIndexStatus =
  | "queued"
  | "running"
  | "complete"
  | "partial"
  | "failed_retryable"
  | "failed_terminal";

export type TronAddressUsdtCoverageKind = "provider_windowed";

export type TronAddressUsdtCoverageStatusReason =
  | "complete_provider_windowed"
  | "partial_provider_cap"
  | "partial_budget_exhausted"
  | "partial_rate_limited"
  | "partial_provider_inconsistent"
  | "too_large_deferred"
  | "failed_retryable"
  | "failed_terminal";

export type TronAddressUsdtIndexProvider = "tronscan" | "trongrid_fallback" | "mixed";

export type TronAddressUsdtCoverageMode = "all_time" | "targeted";
export type TronAddressUsdtIndexRequestKind = "broad_targeted" | "candidate_window";

export type DeepCheckAllTimeMode = "strict" | "partial";

export type DeepSecondLayerWalletStatus =
  | "expanded"
  | "grouped"
  | "stopped_service_boundary"
  | "stopped_high_degree"
  | "no_meaningful_second_hop"
  | "not_indexed"
  | "queued";

export type DeepSecondLayerGroupKind =
  | "low_signal_neighbors"
  | "service_endpoints"
  | "small_transfers"
  | "high_degree_suppressed";

export type DeepSecondLayerIndexSummary = {
  address: string;
  coverageMode: TronAddressUsdtCoverageMode | null;
  coverageKind: TronAddressUsdtCoverageKind | null;
  status: TronAddressUsdtIndexStatus | "not_requested";
  statusReason?: TronAddressUsdtCoverageStatusReason | null;
  uniqueCounterpartyCount: number;
  fetchedTransferCount?: number;
  completedAt?: string | Date | null;
};

export type DeepSecondLayerDirectWalletStatusRecord = {
  address: string;
  status: DeepSecondLayerWalletStatus;
  stopReason:
    | "service_boundary"
    | "high_degree"
    | "index_not_complete"
    | "no_meaningful_second_hop"
    | "queued_for_indexing"
    | null;
  limitationCode:
    | "deep_second_layer_service_boundary"
    | "deep_second_layer_high_degree"
    | "deep_second_layer_not_indexed"
    | "deep_second_layer_no_meaningful_neighbor"
    | "deep_second_layer_queued"
    | null;
  queued: boolean;
  serviceCategory?: ServiceCategory | null;
  identity?: string | null;
  index?: DeepSecondLayerIndexSummary | null;
  savedPathCount: number;
  groupedNeighborCount: number;
};

export type DeepSecondLayerRelationshipPath = {
  id: string;
  source: "deepcheck_relationship_second_hop";
  depth: 2;
  subjectAddress: string;
  directWalletAddress: string;
  secondHopAddress: string;
  pathAddresses: [string, string, string];
  txHashes: string[];
  txCount: number;
  amountRaw: string;
  firstSeen: string | null;
  lastSeen: string | null;
  tokenContract: string | null;
  assetSymbol: string | null;
  evidence: Array<{
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountRaw: string | null;
    timestamp: string | null;
  }>;
  selectionReason: "top_amount_or_activity";
};

export type DeepSecondLayerRelationshipGroup = {
  id: string;
  kind: DeepSecondLayerGroupKind;
  label: string;
  subjectAddress: string;
  directWalletAddress: string;
  memberCount: number;
  members: string[];
  txCount: number;
  amountRaw: string;
  firstSeen: string | null;
  lastSeen: string | null;
};

export type DeepSecondLayerRelationshipCounters = {
  directWalletsConsidered: number;
  expanded: number;
  grouped: number;
  stopped: number;
  notIndexed: number;
  queued: number;
  complete: number;
  paths: number;
  groups: number;
  maxSavedDepth: number;
};

export type DeepSecondLayerRelationshipLimits = {
  maxDirectWalletsConsidered: number;
  maxExpandedDirectWallets: number;
  maxSecondHopNeighborsPerDirectWallet: number;
  maxTotalSecondHopEdges: number;
  highDegreeSuppressionThreshold: number;
};

export type DeepSecondLayerQueueRequest = {
  address: string;
  coverageMode: "all_time";
  queuedReason: "deep_second_layer";
};

export type DeepSecondLayerRelationshipProfile = {
  version: 1;
  source: "deepcheck_relationship_expansion_v1";
  subjectAddress: string;
  generatedAt: string;
  limits: DeepSecondLayerRelationshipLimits;
  directWalletStatuses: DeepSecondLayerDirectWalletStatusRecord[];
  paths: DeepSecondLayerRelationshipPath[];
  groups: DeepSecondLayerRelationshipGroup[];
  queueRequests: DeepSecondLayerQueueRequest[];
  counters: DeepSecondLayerRelationshipCounters;
};

export type TelegramDeliveryRetryableErrorCode =
  | "telegram_timeout"
  | "telegram_rate_limited"
  | "telegram_server_error"
  | "telegram_network_error"
  | "telegram_unknown_retryable";

export type TelegramDeliveryPermanentErrorCode =
  | "telegram_chat_forbidden"
  | "telegram_bad_request"
  | "telegram_attempts_exhausted";

export type TelegramDeliveryErrorCode =
  | TelegramDeliveryRetryableErrorCode
  | TelegramDeliveryPermanentErrorCode;

export type TelegramDeliveryStateV1 = {
  status: "pending" | "sent" | "retryable" | "failed";
  attemptCount: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  lastError: TelegramDeliveryErrorCode | null;
  messageFingerprint: string;
};

export type WaitReconciliationResultV1 = {
  parentJobId: string;
  readyCount: number;
  terminalCount: number;
  cancelledCount: number;
  waitingCount: number;
  outcome: "resume_ready" | "resume_terminal" | "unchanged" | "contradictory";
  diagnosticCode: "missing_wait_rows" | "cancelled_wait_present" | null;
};

export type TelegramMessagePayloadV1 = {
  version: "telegram-message-payload-v1";
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
  replyMarkup: Record<string, unknown> | null;
};

export type TelegramDeliveryEffectV1 = null | {
  kind: "incoming_user_alert";
  watchedWalletId: string;
  incomingTxHash: string;
};

export type TelegramDeliveryClaimV1 = {
  token: string;
  attempt: number;
  claimedAt: string;
  leaseExpiresAt: string;
};

export type ForensicTelegramDeliveryV1 = {
  version: "forensic-telegram-delivery-v1";
  payload: TelegramMessagePayloadV1;
  effect: TelegramDeliveryEffectV1;
  state: TelegramDeliveryStateV1;
  claim: TelegramDeliveryClaimV1 | null;
};

export type DeepSecondLayerContextV1 = {
  version: "deep-second-layer-context-v1";
  baseResultFingerprint: string;
  refreshedAt: string;
  profile: DeepSecondLayerRelationshipProfile;
};

export type RecoveredForensicDeliveryIntentReasonCode =
  | "stale_running_retry_exhausted"
  | "stale_running_incoming_retry_exhausted"
  | "stale_running_delivery_sensitive_phase";

export type RecoveredForensicDeliveryIntentPreparationErrorCode =
  | "stale_intent_context_unavailable"
  | "stale_intent_payload_build_failed"
  | "stale_intent_unknown_retryable"
  | "stale_intent_preparation_attempts_exhausted";

export type RecoveredForensicDeliveryIntentV1 = {
  version: "recovered-forensic-delivery-intent-v1";
  kind: "stale_failure";
  createdAt: string;
  reasonCode: RecoveredForensicDeliveryIntentReasonCode;
  preparationStatus: "pending" | "retryable" | "failed";
  preparationAttemptCount: number;
  lastPreparationAttemptAt: string | null;
  nextPreparationAttemptAt: string | null;
  lastPreparationError: RecoveredForensicDeliveryIntentPreparationErrorCode | null;
};

export type TronAddressUsdtIndexState = {
  address: string;
  tokenContract: string;
  coverageMode: TronAddressUsdtCoverageMode;
  coverageKind: TronAddressUsdtCoverageKind;
  status: TronAddressUsdtIndexStatus;
  statusReason: TronAddressUsdtCoverageStatusReason | null;
  provider: TronAddressUsdtIndexProvider | null;
  totalReported: number | null;
  fetchedTransferCount: number;
  uniqueCounterpartyCount: number;
  newestTransferAt: Date | null;
  oldestTransferAt: Date | null;
  coveredUntilTimestamp: Date | null;
  targetTimestamp: Date | null;
  requestKind?: TronAddressUsdtIndexRequestKind;
  windowStartTimestamp?: Date | null;
  windowEndTimestamp?: Date | null;
  relatedHopTxHash?: string | null;
  candidateTxHash?: string | null;
  fetchedPageCount: number;
  plannedPageCount: number | null;
  currentEndTimestamp: Date | null;
  providerCapHit: boolean;
  budgetExhausted: boolean;
  providerInconsistent: boolean;
  priority: number;
  nextRunAt: Date;
  attemptCount: number;
  maxAttempts: number;
  retryCount: number;
  lastError: string | null;
  lastErrorClass: string | null;
  lastSuccessfulPageAt: Date | null;
  queuedReason: string | null;
  requestedByJobId: string | null;
  lockedAt: Date | null;
  lockedUntil: Date | null;
  heartbeatAt: Date | null;
  lockOwner: string | null;
  budgetPages: number | null;
  budgetSeconds: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  claimPreviousStatus?: TronAddressUsdtIndexStatus | null;
};

export type TronAddressUsdtCoverageInterval = {
  address: string;
  tokenContract: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestamp: Date | null;
  provider: TronAddressUsdtIndexProvider;
  startTimestamp: Date;
  endTimestamp: Date;
  status: "complete" | "partial";
  statusReason: TronAddressUsdtCoverageStatusReason;
  totalReported: number | null;
  rangeTotal: number | null;
  pagesFetched: number;
  rowsFetched: number;
  uniqueRowsInserted: number;
  capHit: boolean;
  providerInconsistent: boolean;
  completedAt: Date | null;
};

export type TronAddressUsdtIndexPageStatus = "queued" | "running" | "complete" | "empty" | "failed";

export type TronAddressUsdtIndexPage = {
  address: string;
  tokenContract: string;
  coverageMode: TronAddressUsdtCoverageMode;
  targetTimestampMs: number;
  windowStartTimestampMs: number;
  windowEndTimestampMs: number;
  startOffset: number;
  limitCount: number;
  status: TronAddressUsdtIndexPageStatus;
  transferCount: number;
  provider: TronAddressUsdtIndexProvider | null;
  totalReported: number | null;
  rangeTotal: number | null;
  rawResponseHash: string | null;
  canonicalTransferHash: string | null;
  attemptCount: number;
  error: string | null;
  newestTransferAt: Date | null;
  oldestTransferAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IndexedTronUsdtTransferIdentity = {
  transferId: string;
  provider: TronAddressUsdtIndexProvider;
};

export type DeepCheckAllTimeCoverage = {
  mode: DeepCheckAllTimeMode;
  subjectIndexStatus: TronAddressUsdtIndexStatus | "not_requested";
  subjectCoverageMode: TronAddressUsdtCoverageMode | null;
  subjectAllTimeComplete: boolean;
  subjectStatusReason: TronAddressUsdtCoverageStatusReason | null;
  subjectCoveredUntilTimestamp: string | null;
  subjectTargetTimestamp: string | null;
  subjectTransfersFetched: number;
  subjectUniqueDirectWallets: number;
  directWalletsHardEvidenceChecked: number;
  directWalletsHardEvidenceLiveChecked: number;
  directHardEvidenceStatus: "complete" | "local_only_partial" | "live_budget_exhausted";
  directWalletsQueuedForIndexing: number;
  secondLayerActiveBudget: number;
  secondLayerQueued: number;
  secondLayerComplete: number;
  providerEffectiveRps: number | null;
  providerRateLimitedRequests: number;
  providerCapHit: boolean;
  providerInconsistent: boolean;
  suppressedServiceWallets: number;
  suppressedHighDegreeWallets: number;
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

export type ProofLevel =
  | "exact_scam_or_taint_proof"
  | "exact_approval_drain_provenance"
  | "exchange_policy_decline"
  | "exchange_policy_context"
  | "insufficient_coverage"
  | "llm_assisted_suspicion"
  | "clean_source_proven"
  | "operational_liquidity_context";

export type ExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";
export type InternalExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";
export type UserExchangeDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "NO_FINAL_DECISION";

export type DecisionCoverage = {
  required: "valid" | "invalid" | "not_applicable";
  overall: "complete" | "partial";
  invalidModes: string[];
  caveats: string[];
};

export type FinalDecisionBasis = "exact_hard_proof" | "independent_policy" | "matrix" | "technical_stop";

export type ScoreAnchorV2 = {
  version: "score-anchor-v2";
  policyVersion: "scoring-signal-matrix-v3";
  subjectAddress: string;
  mode: "fast" | "deep" | "where" | "incoming" | "unified" | "contract";
  score: number;
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  matrixRow: string;
  evidenceClass: string;
  proofLevel: "exact" | "strong" | "context";
  authority: "on_chain" | "registry" | "deterministic_pattern" | "behavior";
  evidenceIds: string[];
  primaryEvidenceIds: string[];
  preferredFactId: string;
  coverageDependency: "none" | "required";
};

export type AddressRefV1 = {
  address: string;
  display: string;
  url: string | null;
};

export type NarrativeFactV2 = {
  id: string;
  subjectAddress: string;
  mode: ScoreAnchorV2["mode"];
  kind: string;
  role: string | null;
  section: "score_reason" | "money_origin" | "money_movement" | "coverage" | "technical";
  evidenceIds: string[];
  isScoreDriver: boolean;
  direction: "incoming" | "outgoing" | "self" | null;
  amountRaw: string | null;
  share: number | null;
  txCount: number | null;
  addresses: AddressRefV1[];
  txHashes: string[];
  factTextKey: string;
  meaningTextKey: string | null;
};

export type ScoringEvidenceV2 = {
  id: string;
  subjectAddress: string;
  matrixRow: string;
  evidenceClass: string;
  authority: ScoreAnchorV2["authority"];
  sourceEvidenceIds: string[];
};

export type ScoreAnchorDiagnostic = "score_anchor_fact_binding_failed" | null;

export type LocalIndexMaterializationStatus = "complete" | "local_limit" | "read_failed";

export type ForensicScoreBlockedReason =
  | "insufficient_coverage"
  | "partial_budget_exhausted"
  | "local_budget_limited"
  | "local_index_read_failed"
  | "provider_error"
  | "rate_limited_after_retries"
  | "provider_inconsistent"
  | "provider_cap_unresolved"
  | "hard_safety_limit_exceeded";

export type ForensicTechnicalStatus =
  | "completed"
  | "budget_limited"
  | "local_budget_limited"
  | "local_data_error"
  | "provider_error"
  | "provider_limited"
  | "provider_cap_unresolved"
  | "hard_safety_limit_exceeded";

export type ForensicScoreValidity = {
  scoringPolicyVersion?: string;
  scoreValid?: boolean;
  scoreBlockedReason?: ForensicScoreBlockedReason | null;
  technicalStatus?: ForensicTechnicalStatus | null;
};

export type MoneyOriginSourceProvenanceMaterialityOutcome =
  | "residual_unresolved_below_materiality"
  | "dense_hop_unresolved_below_materiality"
  | "material_unresolved_source"
  | "aggregate_unresolved_above_materiality"
  | "unresolved_source_with_hard_evidence";

export type MoneyOriginSourceProvenanceMaterialityTier =
  | "dust_residual"
  | "small_relative_dense_hop_tail"
  | "material_unresolved_source"
  | "hard_evidence_unresolved_source";

export type MoneyOriginSourceProvenanceMaterialitySummary = {
  outcome: MoneyOriginSourceProvenanceMaterialityOutcome;
  materialityTier: MoneyOriginSourceProvenanceMaterialityTier;
  unresolvedAmountRaw: string;
  unresolvedAmountUsdt: number;
  unresolvedShareOfCheckedBalance: number | null;
  unresolvedShareOfSelectedAmount: number | null;
  largestUnresolvedAmountRaw: string;
  largestUnresolvedAmountUsdt: number;
  aggregateUnresolvedShareOfCheckedBalance: number | null;
  aggregateUnresolvedShareOfSelectedAmount: number | null;
  unresolvedPathCount: number;
  denseHopUnresolvedPathCount: number;
  hardEvidenceInUnresolved: boolean;
  excludedFromDecisiveScore: boolean;
  unresolvedReasonCounts: Record<string, number>;
  thresholds: {
    maxResidualUnresolvedShare: number;
    maxResidualUnresolvedAmountUsdt: number;
    maxResidualUnresolvedAmountRaw: string;
    maxDenseHopUnresolvedShare: number;
    maxDenseHopAggregateUnresolvedShare: number;
    maxDenseHopUnresolvedAmountUsdt: number;
    maxDenseHopUnresolvedAmountRaw: string;
  };
};

export type RiskDecisionReasonCode =
  | "usdt_blacklist"
  | "internal_scam_label"
  | "approval_drain_exact"
  | "htx_huobi_source"
  | "whitebit_source"
  | "service_boundary"
  | "unknown_contract_boundary"
  | "insufficient_coverage"
  | "llm_contract_suspicion"
  | "clean_cex_source";

export type PolicyReason = {
  code: RiskDecisionReasonCode;
  message: string;
  evidenceIds: string[];
};

export type RiskCaseMode =
  | "fast_check"
  | "where_is_money"
  | "incoming_deposit"
  | "transaction_check"
  | "deep_research"
  | "approval_monitoring";

export type IncomingDepositDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "NO_FINAL_DECISION";
export type IncomingDepositRiskBand = "LOW" | "LOW-MEDIUM" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncomingDepositDataQuality = "low" | "medium" | "high";
export type IncomingDepositSourcePolicy = "clean" | "medium_policy" | "hard_decline" | "unknown";

export type IncomingDepositInput = {
  txHash: string;
  watchedWallet: string;
  watchedWalletId?: string | null;
  sender: string;
  amountRaw: string;
  timestamp: Date;
};

export type IncomingDepositOriginStep = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  method: string;
  edgeType: ForensicRouteEdgeType;
};

export type IncomingDepositFundingBundle = {
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetAmountRaw: string;
  bundleAmountRaw: string;
  bundleCoverageRatio: number;
  windowStart: string;
  windowEnd: string;
  fundingTxHashes: string[];
  fundingAddresses: string[];
  fundingFunders: Array<{
    address: string;
    amountRaw: string;
    txHashes: string[];
  }>;
  deepExpansion?: {
    status:
      | "not_run"
      | "clean_source_reached"
      | "hard_risk_reached"
      | "service_boundary_reached"
      | "unproven_corridor";
    maxDepth: number;
    fetchedAddressCount: number;
    topExpandedFunders: string[];
    reasons: string[];
  };
};

export type IncomingDepositOriginPath = {
  verdict: IncomingDepositDecision;
  score: number;
  sourcePolicy: IncomingDepositSourcePolicy;
  stoppedReason:
    | "clean_cex_reached"
    | "htx_huobi_reached"
    | "bridge_router_dex_reached"
    | "whitebit_reached"
    | "unknown_contract_reached"
    | "risky_label_reached"
    | "no_previous_transfer"
    | "incoming_history_not_fetched"
    | "weak_cashflow_continuity"
    | "data_budget_exhausted";
  pathAddresses: string[];
  txHashes: string[];
  steps: IncomingDepositOriginStep[];
  amountCoverageRatio: number;
  balanceShare?: number;
  amountContinuity: "weak" | "medium" | "strong";
  proximityHops: number;
  reasons: string[];
  fundingBundles?: IncomingDepositFundingBundle[];
  sourcePolicyShareDetail?: SourcePolicyShareDetail;
  rejectedCandidates?: MoneyOriginRejectedCandidate[];
};

export type IncomingDepositCorridorSummary = {
  kind: "large_liquidity_corridor";
  pathLength: number;
  largestTransferRaw: string;
  cleanSourceReached: boolean;
  hardRiskReached: boolean;
  reason: string;
};

export type IncomingDepositHardBadEvidence = {
  kind:
    | "scam_or_blacklist"
    | "stablecoin_blacklist"
    | "sanctioned_service"
    | "approval_drain"
    | "htx_huobi_source"
    | "bridge_router_dex_boundary"
    | "llm_contract_suspicion";
  score: number;
  message: string;
  evidenceIds: string[];
};

export type IncomingExposureSourceKind =
  | "htx_huobi"
  | "clean_cex"
  | "bridge_router_dex"
  | "unknown_contract"
  | "risky_label"
  | "unknown";

export type IncomingFreshBundleExposure = {
  targetAmountRaw: string;
  htxHuobiShare: number;
  cleanCexShare: number;
  bridgeRouterDexShare: number;
  unknownContractShare: number;
  riskyLabelShare: number;
  unknownShare: number;
  dominantFreshSource: IncomingExposureSourceKind | null;
  reasons: string[];
};

export type IncomingWalletExposureProfile = {
  windowStart: string;
  windowEnd: string;
  transferEventsScanned: number;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  /** Share of incomingVolumeRaw. */
  htxHuobiIncomingShare: number;
  /** Share of incomingVolumeRaw. */
  cleanCexIncomingShare: number;
  /** Share of total sender-related volume: incomingVolumeRaw + outgoingVolumeRaw. */
  bridgeRouterDexVolumeShare: number;
  /** Share of total sender-related volume: incomingVolumeRaw + outgoingVolumeRaw. */
  unknownContractVolumeShare: number;
  /** Share of total sender-related volume: incomingVolumeRaw + outgoingVolumeRaw. */
  unknownSourceShare: number;
  /** Score points, capped by the exposure profile builder. */
  inOutVelocityScore: number;
  /** Score points, capped by the exposure profile builder. */
  scoreContribution: number;
  reasons: string[];
  warnings: string[];
};

export type SourceBundleExposureSourceKind = IncomingExposureSourceKind;

export type SourceBundleExposureScope =
  | "incoming_deposit"
  | "where_current_balance"
  | "where_requested_amount"
  | "where_recent_flow"
  | "where_transaction_seed";

export type SourceBundleExposureProofKind =
  | "selected_amount"
  | "fresh_corridor_context"
  | "coverage_limited_boundary";

export type SourceBundleExposureBudget = {
  maxDepth: number | null;
  fetchedAddressCount: number | null;
  maxAddressFetches: number | null;
  liveTransferReadCount: number | null;
  skippedAddressCount: number;
  exhausted: boolean;
  exhaustedPhase:
    | "selection"
    | "trace"
    | "bundle_expansion"
    | "classification"
    | "stablecoin"
    | "internal_processing"
    | null;
};

export type SourceBundleUnresolvedBoundaryInput = {
  kind: SourceBundleExposureSourceKind;
  affectedShare: number;
  reason: string;
  evidenceTxHashes: string[];
};

export type SourceBundleUnresolvedBoundary = SourceBundleUnresolvedBoundaryInput & {
  scoreFloor: number;
};

export type SourceBundleExposureFinding = {
  sourceClass: SourceBundleExposureSourceKind;
  amountRaw: string;
  share: number;
  evidenceTxHashes: string[];
  stoppedReason: string;
  proofKind: SourceBundleExposureProofKind;
};

export type SourceBundleExposureProfile = {
  scope: SourceBundleExposureScope;
  targetAmountRaw: string | null;
  coveredAmountRaw: string;
  coverageRatio: number;
  htxHuobiShare: number;
  cleanCexShare: number;
  bridgeRouterDexShare: number;
  unknownContractShare: number;
  riskyLabelShare: number;
  unknownShare: number;
  dominantSource: SourceBundleExposureSourceKind | null;
  evidenceTxHashes: string[];
  reasons: string[];
  warnings: string[];
  budget: SourceBundleExposureBudget;
  unresolvedBoundary: SourceBundleUnresolvedBoundary | null;
};

export type SubjectExposureEvent = {
  direction: "incoming" | "outgoing";
  amountRaw: string;
  counterparty: string;
  sourceClass: SourceBundleExposureSourceKind;
  txHash: string;
  timestamp: string;
};

export type SubjectExposureProfile = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  transferEventsScanned: number;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  htxHuobiIncomingShare: number;
  cleanCexIncomingShare: number;
  bridgeRouterDexVolumeShare: number;
  unknownContractVolumeShare: number;
  unknownSourceShare: number;
  inOutVelocityScore: number;
  scoreContribution: number;
  reasons: string[];
  warnings: string[];
};

export type IncomingDepositUnifiedRiskSummary = {
  finalScore: number | null;
  finalLevel: RiskLevel | null;
  finalDecision: UserExchangeDecision;
  observedContextScore: number;
  scoreValid: boolean;
  decisionBasis: FinalDecisionBasis;
  coverage: DecisionCoverage;
  matrixDecision?: "ACCEPTABLE" | "REVIEW" | "DECLINE" | "INSUFFICIENT_EVIDENCE";
  winningRow?: string;
  policyScore?: number | null;
  calibratedRiskProbability?: number | null;
  hardEvidenceFloor: number;
  policyFloor: number;
  assetContinuationFloor: number;
  patternFloor: number;
  freshBundleFloor?: number;
  corridorFloor?: number;
  backgroundScore?: number;
  dampener: number;
  activeAnchor: {
    code: string;
    message: string;
    score: number;
    source: string;
    row: string;
    evidenceIds: string[];
  } | null;
  scoreAnchorV2?: ScoreAnchorV2 | null;
  narrativeFactsV2?: NarrativeFactV2[];
  scoringEvidenceV2?: ScoringEvidenceV2[];
  scoreAnchorDiagnostic?: ScoreAnchorDiagnostic;
};

export type FreshIncomingDepositUnifiedRiskSummaryV2 = IncomingDepositUnifiedRiskSummary & {
  scoreAnchorV2: ScoreAnchorV2 | null;
  narrativeFactsV2: NarrativeFactV2[];
  scoringEvidenceV2: ScoringEvidenceV2[];
  scoreAnchorDiagnostic: ScoreAnchorDiagnostic;
};

export type IncomingDepositTargetedCoverageSummary = {
  selectedDepositTxHash: string;
  sender: string;
  hopCount: number;
  completeHopCount: number;
  partialHopCount: number;
  pagesFetched: number;
  transfersFetched: number;
  firstBlockingReason: ForensicScoreBlockedReason | null;
  firstBlockingTechnicalStatus: ForensicTechnicalStatus | null;
  firstBlockingAddress: string | null;
};

export type IncomingDepositRiskReport = ForensicScoreValidity & {
  decision: IncomingDepositDecision;
  depositRiskScore: number | null;
  observedContextScore: number;
  riskBand: IncomingDepositRiskBand | null;
  fastSenderRisk: RiskReport | null;
  originPaths: IncomingDepositOriginPath[];
  originCoverage: number;
  fundingCoverage: {
    depositFundingCoverageRatio: number;
    cleanSourceCoverageRatio: number;
    exactContinuityCoverageRatio: number;
  };
  corridorSummary: IncomingDepositCorridorSummary | null;
  provenanceConfidence: number;
  dataQuality: IncomingDepositDataQuality;
  senderRole: string | null;
  targetedHistoryCoverage?: IncomingDepositTargetedCoverageSummary;
  coverageV2?: ForensicCoverageV2;
  sourcePolicyEvidence?: SourcePolicyEvidence[];
  hardBadEvidence: IncomingDepositHardBadEvidence[];
  contractVerdicts: ContractLlmVerdictSummary[];
  contractDrivenReceiverProfile?: ContractDrivenReceiverProfile | null;
  contractDrivenTransferProfiles?: ContractDrivenTransferProfile[];
  contractDrivenSubjectAddress?: string;
  freshBundleExposure?: IncomingFreshBundleExposure;
  walletExposureProfile?: IncomingWalletExposureProfile;
  sourceBundleExposure?: SourceBundleExposureProfile;
  subjectExposureProfile?: SubjectExposureProfile;
  unifiedRiskSummary?: IncomingDepositUnifiedRiskSummary;
  reasons: string[];
  warnings: string[];
};

export type RiskCaseEvidenceType =
  | "usdt_blacklist"
  | "internal_label"
  | "provider_label"
  | "money_path"
  | "service_boundary"
  | "approval"
  | "transfer_from"
  | "contract_profile"
  | "coverage";

export type RiskCaseEvidence = {
  id: string;
  type: RiskCaseEvidenceType;
  strength: "exact" | "strong" | "context" | "weak";
  subjectAddress?: string;
  txHash?: string;
  contractAddress?: string;
  facts: Record<string, unknown>;
};

export type RiskCaseFile = {
  schemaVersion: "risk-case-v1";
  policyVersion: string;
  subject: {
    chain: "tron";
    address: string;
    asset: "USDT";
    mode: RiskCaseMode;
    requestedAmountRaw?: string | null;
    currentBalanceRaw?: string | null;
  };
  deterministicEvidence: RiskCaseEvidence[];
  scoring: {
    internalDecision: InternalExchangeDecision;
    userDecision: UserExchangeDecision;
    proofLevel: ProofLevel;
    reasons: PolicyReason[];
  };
  coverage: {
    status: "complete" | "partial" | "failed";
    fetchedAddressCount: number;
    maxDepthReached: number;
    providerErrors: string[];
    missingData: string[];
  };
  audit: {
    createdAt: string;
    sourceJobId?: string;
    evidenceIds: string[];
  };
};

export type BalanceTransferAmountRole =
  | "anchor"
  | "funding_candidate"
  | "bundle_member"
  | "episode_member";

export type BalanceTransferAmountUsage = {
  anchorAmountRaw: string;
  originalAmountRaw: string;
  usedAmountRaw: string;
  coverageShare: number;
  role: BalanceTransferAmountRole;
};

export type BalanceFormingTransfer = {
  evidenceId?: string;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  method?: string;
  edgeType?: ForensicRouteEdgeType;
  economicRole?: ForensicEconomicRole;
  economicProtocol?: ForensicEconomicProtocol;
  coverageShare: number;
  amountUsage?: BalanceTransferAmountUsage | null;
  selectedReason:
    | "covers_current_balance"
    | "covers_requested_amount"
    | "funds_recent_outgoing"
    | "recent_large_inbound";
};

export type ContractDrivenSourcePostDebitActivityProfile = {
  checked: boolean;
  debitAmountRaw: string;
  laterIncomingAmountRaw: string;
  laterOutgoingAmountRaw: string;
  laterTxCount: number;
  repeatedContractDrivenDebitToSameReceiver: boolean;
};

export type ContractDrivenTransferClassification =
  | "plain_usdt_transfer"
  | "gasfree_principal"
  | "gasfree_service_fee"
  | "verify20_wrapper"
  | "transfer_from_wrapper"
  | "permit_wrapper"
  | "other_contract_method"
  | "unknown_unenriched"
  | "tx_info_unavailable";

export type ContractDrivenCampaignClassificationStatus =
  | "not_enriched"
  | "partial"
  | "complete";

export type ContractDrivenCampaignCluster = {
  contractAddress: string | null;
  operatorAddress: string | null;
  method: string | null;
  receiverAddress: string;
  txCount: number;
  amountRaw: string;
  uniqueSourceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  knownServiceIdentity: string | null;
  exactProofCount: number;
  contextOnlyCount: number;
};

export type ContractDrivenCampaignSummary = {
  incomingTxTotal: number;
  incomingAmountRaw: string;
  txInfoEnrichedIncomingTx: number;
  campaignClassificationStatus: ContractDrivenCampaignClassificationStatus;
  countsAreLowerBounds: boolean;
  plainUsdtTransferTxCount: number;
  plainUsdtTransferAmountRaw: string;
  wrapperDrivenIncomingTxCount: number;
  wrapperDrivenIncomingAmountRaw: string;
  verify20WrapperTxCount: number;
  transferFromWrapperTxCount: number;
  permitWrapperTxCount: number;
  otherContractMethodTxCount: number;
  unknownUnenrichedTxCount: number;
  txInfoUnavailableTxCount: number;
  exactApprovalDrainProfileCount: number;
  campaignClusters: ContractDrivenCampaignCluster[];
};

export type ContractDrivenTransferProfile = {
  txHash: string;
  timestamp: string;
  amountRaw: string;
  amount?: string | null;
  classification?: ContractDrivenTransferClassification;
  economicRole?: ForensicEconomicRole;
  economicProtocol?: ForensicEconomicProtocol;
  countsAsDrainerContext?: boolean;
  method: string | null;
  callerAddress?: string | null;
  operatorAddress?: string | null;
  contractAddress?: string | null;
  spenderAddress?: string | null;
  contractName?: string | null;
  sourceAddress: string;
  victimAddress?: string | null;
  receiverAddress: string;
  sourcePostDebitActivity?: ContractDrivenSourcePostDebitActivityProfile;
  evidenceIds?: string[];
};

export type ContractDrivenReceiverProfile = {
  totalIncomingTxCount: number;
  totalIncomingAmountRaw: string;
  txInfoEnrichedIncomingTx?: number;
  campaignClassificationStatus?: ContractDrivenCampaignClassificationStatus;
  countsAreLowerBounds?: boolean;
  plainUsdtTransferTxCount?: number;
  contractDrivenIncomingTxCount: number;
  contractDrivenIncomingAmountRaw: string;
  wrapperDrivenIncomingTxCount?: number;
  verify20WrapperTxCount?: number;
  uniqueSourceCount: number;
  dominantMethod: string | null;
  contractNames: string[];
  knownServiceIdentity: string | null;
  exactApprovalDrainCount: number;
};

export type MoneyOriginProvenanceScope =
  | "current_balance"
  | "requested_amount"
  | "transaction_seed"
  | "recent_flow";

export type CoverageExclusionReasonV1 =
  | "after_checked_operation"
  | "consumed_by_earlier_spend"
  | "exact_gasfree_service_fee"
  | "different_selected_scope"
  | "provider_history_unavailable"
  | "local_materialization_failed"
  | "other_proven_not_selected";

export type CoverageExclusionV1 = {
  reason: CoverageExclusionReasonV1;
  direction: "incoming" | "outgoing" | null;
  txCount: number;
  amountRaw: string | null;
  evidenceIds: string[];
};

export type CoverageLimitationV1 = {
  reason: "provider_history_unavailable" | "local_materialization_failed";
  evidenceIds: string[];
};

export type ForensicCoverageV2 = {
  version: "forensic-coverage-v2";
  scope: "current_balance" | "requested_amount" | "transaction_seed" | "recent_flow" | "deep_history";
  availableInboundTxCount: number | null;
  selectedInboundTxCount: number;
  excludedInboundTxCount: number | null;
  selectedAmountRaw: string | null;
  tracedAmountRaw: string | null;
  tracedShare: number | null;
  unresolvedAmountRaw: string | null;
  unresolvedShare: number | null;
  exclusions: CoverageExclusionV1[];
  limitations: CoverageLimitationV1[];
  completeness: "complete" | "partial" | "unknown";
};

export type RecentFlowPrincipalTransferV1 = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  direction: "incoming" | "outgoing";
  amountRaw: string;
  timestamp: string;
  economicRole: "principal";
};

export type ApprovalAllowanceStateV2 = {
  version: "approval-allowance-v2";
  ownerAddress: string;
  spenderAddress: string;
  tokenContract: string;
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  state: "confirmed_active" | "confirmed_zero" | "failed" | "stale";
  confirmedAt: string | null;
  freshUntil: string | null;
  lastAttemptAt: string | null;
  failureCode: string | null;
  source: "official_usdt_allowance";
  observedApprovalTxHash: string | null;
};

export type KnownServiceSessionV1 = {
  walletAddress: string;
  spenderAddress: string;
  approvalTxHash: string;
  actionTxHash: string;
  actionKind: "swap" | "bridge" | "router";
  walletInitiated: boolean;
  successful: boolean;
  delayMs: number;
  approvedAmountRaw: string | null;
  movedAmountRaw: string;
  amountContinuity: "exact" | "broken" | "unknown";
  authoritativeServiceId: string;
};

export type ApprovalSafetyAssessmentV2 = {
  version: "approval-safety-v2";
  subjectAddress: string;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  score: number | null;
  action: "NONE" | "REVOKE_IF_UNUSED" | "REVOKE_NOW" | "CONFIRM_ALLOWANCE";
  amlScoreImpact: 0;
  allowance: ApprovalAllowanceStateV2;
  balanceAtRiskRaw: string | null;
  exactVerify20: boolean;
  exactDebit: boolean;
  debitFoundFromSubject: boolean;
  campaignEvidenceIds: string[];
  serviceSession: KnownServiceSessionV1 | null;
};

export type ContractDecisionEvidenceKindV1 =
  | "metadata_context"
  | "official_registry"
  | "gasfree_role"
  | "provider_risk"
  | "verify20_fingerprint"
  | "approval_event"
  | "allowance_read"
  | "exact_debit"
  | "service_action";

export type ContractDecisionEvidenceV1 = {
  id: string;
  kind: ContractDecisionEvidenceKindV1;
  subjectAddress: string;
  spenderAddress: string | null;
  tokenContract: string | null;
};

export type ContractDecisionV2 = {
  deterministic: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
    authority:
      | "exact_debit"
      | "provider_risk"
      | "verify20_fingerprint"
      | "official_registry"
      | "gasfree_account"
      | "known_service_session"
      | "context";
    evidenceIds: string[];
  };
  finalSource: "deterministic";
  llm: null;
};

export type UsddPsmExposureV1 = {
  mode: "where" | "incoming" | "recent_flow" | "deep_history";
  direction: "inbound_from_psm" | "outbound_to_psm";
  amountRaw: string;
  selectedAmountRaw: string;
  share: number;
  hopCount: 1 | 2;
  serviceIdentityExact: boolean;
  amountContinuityExact: boolean;
  baseModifier: 3 | 7 | 12 | 18 | 25;
  modeAdjustedModifier: number;
  appliedModifier: number;
  roundingPolicy: "half_up_non_negative";
  evidenceIds: string[];
};

export type UsddPsmRouteObservationV1 = {
  version: "usdd-psm-route-observation-v1";
  mode: "where" | "incoming" | "recent_flow" | "deep_history";
  serviceId: "usdd_psm_gemjoin";
  serviceAddress: string | null;
  direction: "inbound_from_psm" | "outbound_to_psm" | "unknown";
  amountRaw: string;
  selectedAmountRaw: string;
  hopCount: 1 | 2 | null;
  serviceIdentityExact: boolean;
  amountContinuityExact: boolean;
  scoringEligible: boolean;
  ineligibilityReason: "label_only" | "amount_discontinuous" | "unsupported_hop" | "invalid_amount" | null;
  evidenceIds: string[];
};

export type MoneyOriginRecentFlowAnchor = {
  txHash: string;
  direction: "outgoing" | "inbound";
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  reason: "latest_meaningful_outgoing" | "recent_significant_inbound_fallback";
};

export type BalanceFormingSelection = {
  transfers: BalanceFormingTransfer[];
  currentBalanceRaw: string;
  requestedAmountRaw?: string | null;
  targetAmountRaw: string;
  selectedAmountRaw: string;
  coverageRatio: number;
  selectedVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  partial: boolean;
  provenanceScope: MoneyOriginProvenanceScope;
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  dataScopeNote?: string | null;
  recentFlowPrincipalTransfers?: RecentFlowPrincipalTransferV1[];
  principalActivity?: "present" | "none";
  coverageExclusions?: CoverageExclusionV1[];
  coverageLimitations?: CoverageLimitationV1[];
  availableInboundTxCount?: number | null;
  selectionMethod:
    | "current_balance"
    | "requested_amount"
    | "transaction_seed"
    | "recent_five_principal"
    | "recent_outgoing"
    | "recent_large_inbound";
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
  | "no_incoming_transfers_seen"
  | "incoming_history_not_fetched"
  | "incoming_seen_but_below_continuity"
  | "weak_amount_or_time_continuity"
  | "unlabeled_service_boundary"
  | "service_boundary"
  | "pre_existing_balance_possible"
  | "funding_first_unresolved"
  | "amount_continuity_broken";

export type EvidenceClass =
  | "hard_proof"
  | "source_policy"
  | "contract_suspicion"
  | "unknown_origin"
  | "behavior_context"
  | "data_quality"
  | "dampener"
  | "clean_source";

export type SourceExposureKind =
  | "htx_huobi"
  | "whitebit"
  | "bridge_router_dex"
  | "cross_chain_boundary"
  | "no_name_token_liquidity"
  | "mixer"
  | "sanctioned_service"
  | "unknown_contract"
  | "unknown_cex"
  | "allowlisted_cex"
  | "risky_label";

export type SourcePolicyScope =
  | "incoming_deposit"
  | "where_selected_amount"
  | "where_drain_episode"
  | "balance_forming_target"
  | "deep_recent_flow"
  | "deep_30d_volume";

export type SourcePolicyShareDetail = {
  scope: SourcePolicyScope;
  targetAmountRaw: string;
  affectedAmountRaw: string;
  rawShare: number;
  effectiveShare: number;
  sourceSeverity: number;
  valueWeightedRaw: number;
  pathContextAdjustment: number;
  repeatedExposureAdjustment: number;
  dataQualityAdjustment: number;
  walletRoleAdjustment: number;
  shareFloor: number;
  shareCap: number;
  finalContribution: number;
  amountCap?: number;
  amountBand?: "under_5k" | "5k_to_25k" | "25k_to_100k";
  amountCapApplied?: boolean;
};

export type RiskLayerScore = {
  evidenceClass: EvidenceClass;
  kind: string;
  sourceExposureKind?: SourceExposureKind;
  score: number;
  rawScore: number;
  adjustedScore: number;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  capApplied?: number;
  floorApplied?: number;
  reasons: string[];
  warnings: string[];
  evidenceIds: string[];
  shareDetail?: SourcePolicyShareDetail;
};

export type SourcePolicyEvidence = {
  kind: SourceExposureKind;
  aggregateShare: number;
  effectiveShare: number;
  pathCount: number;
  score: number;
  riskBand: WhereIsMoneyRiskBand;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  reasons: string[];
  warnings: string[];
  evidenceIds: string[];
  shareDetail?: SourcePolicyShareDetail;
  topPath?: {
    hops: number;
    elapsedMs: number | null;
    avgTimePerHopMs: number | null;
    amountContinuity: number;
    linkStrength: number;
  };
};

export type CrossChainKnownId = "tron" | "ethereum" | "arbitrum" | "bsc";
export type CrossChainId = CrossChainKnownId | (string & {});

export type CrossChainAddress = {
  chain: CrossChainId;
  chainId: string | number;
  address: string;
};

export type CrossChainEvidenceConfidence =
  | "exact"
  | "provider_correlated"
  | "protocol_correlated"
  | "weak";

export type CrossChainEvidenceRef = {
  id: string;
  provider: "range" | "etherscan" | "alchemy" | "layerzero" | "local";
  payloadId: string | null;
  confidence: CrossChainEvidenceConfidence;
};

export type ProviderPayloadRef = {
  id: string;
  provider: "range" | "etherscan" | "alchemy" | "layerzero" | "local";
  endpoint: string;
  fetchedAt: string;
};

export type CrossChainRouteEdgeType =
  | "bridge_source"
  | "bridge_destination"
  | "bridge_protocol_link"
  | "native_transfer"
  | "token_transfer"
  | "internal_transfer"
  | "dex_swap"
  | "liquidity_add"
  | "liquidity_remove"
  | "unknown_token_liquidity"
  | "tornado_withdrawal"
  | "service_boundary";

export type CrossChainRouteEdge = {
  id: string;
  edgeType: CrossChainRouteEdgeType;
  source: CrossChainAddress | null;
  destination: CrossChainAddress | null;
  txHash: string | null;
  amountRaw: string | null;
  assetSymbol: string | null;
  tokenContract?: string | null;
  timestamp: string | null;
  protocol: string | null;
  evidenceRefs: CrossChainEvidenceRef[];
  labels: string[];
};

export type CrossChainContinuationEvidenceClass =
  | "protocol_correlated"
  | "strong_amount_time"
  | "split_join"
  | "weak_candidate";

export type CrossChainContinuationSeed = {
  id: string;
  chain: CrossChainId;
  address?: string | null;
  txHash?: string | null;
  amountRaw: string;
  assetSymbol: string;
  timestamp: string | null;
  timeWindow?: {
    start: string;
    end: string;
  };
  labels: string[];
  evidenceRefs: CrossChainEvidenceRef[];
};

export type CrossChainContinuationEdge = CrossChainRouteEdge & {
  continuationEvidenceClass: CrossChainContinuationEvidenceClass;
  score: number;
  reasons: string[];
};

export type CrossChainTerminalBoundary =
  | "tornado_or_mixer"
  | "sanctioned_service"
  | "no_name_token_liquidity"
  | "bridge_boundary"
  | "dex_router_boundary"
  | "unknown_contract"
  | "data_exhausted"
  | "candidate_only"
  | "none";

export type CrossChainContinuationReasoningStepKind =
  | "observation"
  | "hypothesis"
  | "decision"
  | "evidence_gate"
  | "stop_reason";

export type CrossChainContinuationReasoningStep = {
  kind: CrossChainContinuationReasoningStepKind;
  message: string;
  edgeId?: string;
  txHash?: string | null;
  address?: CrossChainAddress | null;
  fromChain?: string | null;
  toChain?: string | null;
  provider?: string | null;
  terminalBoundary?: CrossChainTerminalBoundary | null;
  evidenceClass?: CrossChainContinuationEvidenceClass | null;
};

export type CrossChainStage2TriggerReason =
  | "large_single_boundary"
  | "large_split_boundary"
  | "medium_direct_high_risk"
  | "drain_episode_bridge_exposure"
  | "deep_service_exposure_bridge"
  | "manual_deep_mode";

export type CrossChainContinuationReport = {
  enabled: boolean;
  seed: CrossChainContinuationSeed;
  terminalBoundary: CrossChainTerminalBoundary;
  edges: CrossChainContinuationEdge[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
  reasoningTrace?: CrossChainContinuationReasoningStep[];
  payloadRefs: ProviderPayloadRef[];
};

export type CrossChainCorridorPath = {
  id: string;
  triggerReason: CrossChainStage2TriggerReason;
  balanceTransferTxHashes: string[];
  targetAmountRaw: string;
  selectedAmountRaw: string;
  edges: CrossChainRouteEdge[];
  continuation?: CrossChainContinuationReport | null;
  terminalBoundary: CrossChainTerminalBoundary;
  riskLayer: RiskLayerScore;
  sourcePolicyEvidence?: SourcePolicyEvidence | null;
  partial: boolean;
  reasons: string[];
  warnings: string[];
};

export type CrossChainCorridorReport = {
  enabled: boolean;
  triggered: boolean;
  skippedReason: string | null;
  paths: CrossChainCorridorPath[];
  providerCalls: number;
  partial: boolean;
  coverageNotes: string[];
  payloadRefs: ProviderPayloadRef[];
};

export type MoneyOriginPathStep = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
};

export type MoneyOriginFundingBundleMember = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  originalAmountRaw: string;
  usedAmountRaw: string;
  spentBeforeHopRaw: string;
  timestamp: string;
  coverageShare: number;
};

export type MoneyOriginFundingBundle = {
  hopTxHash: string;
  hopAddress: string;
  expectedAmountRaw: string;
  coveredAmountRaw: string;
  coverageRatio: number;
  members: MoneyOriginFundingBundleMember[];
};

export type MoneyOriginTraceHistoryCoverage = {
  address: string;
  targetTimestamp: string;
  fetchedTransferCount: number;
  fetchedPageCount?: number | null;
  oldestFetchedTransferAt: string | null;
  reachedTargetHop: boolean;
  source: "live" | "local_index" | "mixed" | "unknown";
  coverageComplete?: boolean | null;
  providerCapHit?: boolean | null;
  budgetExhausted?: boolean | null;
  providerInconsistent?: boolean | null;
  statusReason?: TronAddressUsdtCoverageStatusReason | null;
  localMaterializationStatus?: LocalIndexMaterializationStatus | null;
  localMaterializationCompletionReason?: "proof_satisfied" | "window_exhausted" | null;
  localMaterializationKnownZero?: boolean | null;
  localMaterializationError?: string | null;
  balanceFormingSlice?: {
    status: "covered" | "partial" | "dense_unresolved" | "provider_inconsistent";
    reason: string | null;
    targetTxHash: string;
    targetFromAddress: string;
    targetToAddress: string;
    targetAmountRaw: string;
    targetTimestamp: string;
    coveredAmountRaw: string;
    coverageRatio: number;
    fetchedTransferCount: number;
    fetchedPageCount: number;
    pageBudgetExhausted: boolean;
    providerCapHit: boolean;
    providerInconsistent: boolean;
  };
};

export type MoneyOriginFundingProofClass =
  | "exact"
  | "service_boundary"
  | "probable"
  | "pre_existing_balance_possible"
  | "unresolved";

export type MoneyOriginAmountContinuity = "strong" | "weak" | "broken";

export type WhereCandidateWindowRequest = {
  address: string;
  targetTimestamp: Date;
  windowStartTimestamp: Date;
  windowEndTimestamp: Date;
  relatedHopTxHash: string;
  candidateTxHash: string;
  requestedAmountRaw: string;
  candidateAmountRaw: string;
  coverageShare: number;
};

export type MoneyOriginFundingSourceProvenance = {
  mode: "source_provenance";
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetTimestamp: string;
  targetAmountRaw: string;
  proofClass: MoneyOriginFundingProofClass;
  coveredAmountRaw: string;
  coverageRatio: number;
  amountContinuity: MoneyOriginAmountContinuity;
  stopReason: MoneyOriginStoppedReason | null;
  fundingBundle: MoneyOriginFundingBundle | null;
  coverageWindow: {
    startTimestamp: string | null;
    endTimestamp: string;
    complete: boolean;
    capped: boolean;
    providerInconsistent: boolean;
  };
  reasons: string[];
  balanceFormingSlice?: MoneyOriginTraceHistoryCoverage["balanceFormingSlice"];
};

export type MoneyOriginRejectedCandidate = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  coverageRatio: number;
  timeDeltaMs: number;
  reasons: string[];
};

export type MoneyOriginDrainEpisode = {
  anchorTxHash: string;
  fundingTxHash?: string;
  fundingAmountRaw?: string;
  fundingTimestamp?: string;
  startTimestamp: string;
  endTimestamp: string;
  episodeOutgoingRaw: string;
  episodeSelectedRaw: string;
  episodeCoverageRatio: number;
  outgoingTxHashes: string[];
  bridgeOutgoingRaw: string;
  bridgeOutgoingShare: number;
};

export type MoneyOriginLayerSummary = {
  fastCheck: {
    riskLevel: string | null;
    score: number | null;
    note: string;
  };
  whereIsMoney: {
    checkedScope: "current_balance" | "requested_amount" | "transaction_seed" | "recent_flow" | "selected_anchor" | "drain_episode";
    note: string;
  };
  deepCheck: {
    serviceExposureRaw: string | null;
    dominantCategory: string | null;
    note: string;
  };
};

export type MoneyOriginPath = {
  balanceTransferTxHash: string;
  /** Exact selected transfer event identity; absent only on legacy persisted paths. */
  balanceTransferEvidenceId?: string;
  rootSourceAddress: string | null;
  rootSourceType: MoneyOriginRootSourceType;
  balanceShare?: number;
  exposureSourceKey?: string | null;
  exposureSourceLabel?: string | null;
  sourceExposureKind?: SourceExposureKind | null;
  effectiveExposureShare?: number | null;
  linkStrength?: number | null;
  scoreBreakdown?: RiskLayerScore[];
  amountUsage?: BalanceTransferAmountUsage | null;
  pathAddresses: string[];
  txHashes: string[];
  steps: MoneyOriginPathStep[];
  fundingBundles?: MoneyOriginFundingBundle[];
  sourceProvenance?: MoneyOriginFundingSourceProvenance[];
  historyCoverage?: MoneyOriginTraceHistoryCoverage[];
  rejectedCandidates?: MoneyOriginRejectedCandidate[];
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
  currentBalanceRaw?: string | null;
  requestedAmountRaw?: string | null;
  targetAmountRaw?: string;
  selectedAmountRaw?: string;
  coverageRatio?: number;
  drainEpisode?: MoneyOriginDrainEpisode | null;
  checkedScope?: "current_balance" | "requested_amount" | "transaction_seed" | "recent_flow" | "selected_anchor" | "drain_episode";
  anchorCoverageRatio?: number | null;
  episodeCoverageRatio?: number | null;
  selectedInboundVolumeRaw: string;
  currentBalanceCoverageRatio: number;
  provenanceScope?: MoneyOriginProvenanceScope;
  selectionMethod?: BalanceFormingSelection["selectionMethod"];
  anchorTransfer?: MoneyOriginRecentFlowAnchor | null;
  lowBalanceThresholdRaw?: string | null;
  dataScopeNote?: string | null;
  maxDepth: number;
  fetchedAddressCount: number;
  questionStatus?: "applicable" | "not_applicable";
  partial: boolean;
  notes: string[];
};

export type WhereIsMoneyRiskBand =
  | "LOW"
  | "LOW-MEDIUM"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type WhereIsMoneyWalletRole =
  | "clean_cex_funded_wallet"
  | "operational_liquidity_wallet"
  | "risky_source_wallet"
  | "unknown_wallet";

export type WhereIsMoneyHardBadEvidenceKind =
  | "fast_critical"
  | "approval_drain"
  | "scam_or_blacklist"
  | "htx_huobi_source"
  | "bridge_router_dex_boundary"
  | "unknown_contract_boundary"
  | "llm_contract_suspicion"
  | "sanctioned_service";

export type WhereIsMoneyHardBadEvidence = {
  kind: WhereIsMoneyHardBadEvidenceKind;
  score: number;
  message: string;
  evidenceIds: string[];
};

export type WhereIsMoneyAgeSignal = {
  code:
    | "subject_long_lived"
    | "subject_new_large_wallet"
    | "sender_long_lived"
    | "relationship_repeated"
    | "relationship_new"
    | "dormancy_gap";
  scoreImpact: number;
  message: string;
  value: number | string | null;
  evidenceIds: string[];
};

export type WhereIsMoneyAgeSignals = {
  subjectFirstSeenAt: string | null;
  subjectAgeDays: number | null;
  subjectActiveDays: number;
  directSenderMedianAgeDays: number | null;
  oldestDirectSenderAgeDays: number | null;
  repeatedRelationshipCount: number;
  longestRelationshipAgeDays: number | null;
  maxDormancyGapDays: number | null;
  signals: WhereIsMoneyAgeSignal[];
};

export type WhereIsMoneyAssessment = ForensicScoreValidity & {
  decision: ExchangeDecision;
  riskScore: number;
  riskBand: WhereIsMoneyRiskBand;
  provenanceConfidence: number;
  coverageCompleteness: number;
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
  hardBadEvidence: WhereIsMoneyHardBadEvidence[];
  sourcePolicyEvidence: SourcePolicyEvidence[];
  contractSuspicionEvidence: RiskLayerScore[];
  unknownOriginEvidence: RiskLayerScore[];
  riskLayers: RiskLayerScore[];
  dominantRiskLayer?: RiskLayerScore | null;
  sourceProvenanceMateriality?: MoneyOriginSourceProvenanceMaterialitySummary | null;
  reasons: string[];
  warnings: string[];
};

export type ContractLlmVerdictKind =
  | "legitimate_service"
  | "drainer_like"
  | "unknown_suspicious"
  | "unknown_insufficient_data";

export type ContractLlmVerdictSource = "llm" | "cache" | "unavailable" | "deterministic";

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

export type StandaloneContractApprovalContext = {
  ownerAddress: string;
  watchedWalletAddress: string;
  approvalEvidenceId: string | null;
  tokenContract: string;
  status: "active" | "revoked" | "unknown";
  isUnlimited: boolean;
  riskScore: number;
  lastApprovalAt: string | null;
};

export type StandaloneContractContext = {
  mode: "standalone_contract_check";
  metadata: Record<string, unknown>;
  relatedApprovals: StandaloneContractApprovalContext[];
  knownLimitations: string[];
};

export type ApprovalDrainReviewInterpretation = {
  drainTxHash: string;
  spenderAddress: string | null;
  firstReceiverAddress: string;
  reason: ApprovalDrainReviewFinding["reason"];
  reviewFindingInterpretation: "candidate_only_not_exact_proof";
  exactApprovalProofStatus: "found" | "not_found" | "not_checked";
  transferFromProofStatus: "confirmed" | "suspected_wrapper" | "not_confirmed";
  spenderMatchStatus: "matched" | "not_matched" | "unknown";
  pathToCheckedWalletStatus: "proven" | "not_proven" | "blocked_by_service_boundary";
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
  approvalDrainReviewInterpretations: ApprovalDrainReviewInterpretation[];
  serviceClassification: ServiceClassification | null;
  contractProfile: Record<string, unknown> | null;
  evidenceIds: string[];
  policyQuestion: string;
  standaloneContractContext?: StandaloneContractContext;
};

export type WhereIsMoneyReport = ForensicScoreValidity & {
  subjectAddress: string;
  currentUsdtBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  balanceFormingTransfers: BalanceFormingTransfer[];
  originPaths: MoneyOriginPath[];
  senderInteractionProfiles: MoneyOriginSenderInteractionProfile[];
  approvalDrainProvenanceProfiles: ApprovalDrainProvenanceProfile[];
  approvalDrainReviewFindings?: ApprovalDrainReviewFinding[];
  contractDrivenReceiverProfile?: ContractDrivenReceiverProfile | null;
  contractDrivenTransferProfiles?: ContractDrivenTransferProfile[];
  contractLlmVerdicts?: ContractLlmVerdictSummary[];
  crossChainCorridor?: CrossChainCorridorReport;
  sourceBundleExposure?: SourceBundleExposureProfile;
  subjectExposureProfile?: SubjectExposureProfile;
  assessment: WhereIsMoneyAssessment;
  // Backcompat decision mirrors of assessment-owned fields for existing bot/job consumers.
  decision: ExchangeDecision;
  userDecision: UserExchangeDecision;
  internalDecision: ExchangeDecision;
  proofLevel: ProofLevel;
  policyReasons?: PolicyReason[];
  riskCaseFile?: RiskCaseFile;
  // Backcompat risk mirror of assessment.riskScore for existing bot/job consumers.
  riskScore: number;
  sourceProvenanceMateriality?: MoneyOriginSourceProvenanceMaterialitySummary | null;
  coverageV2?: ForensicCoverageV2;
  recentFlowPrincipalTransfers?: RecentFlowPrincipalTransferV1[];
  usddPsmRouteObservations?: UsddPsmRouteObservationV1[];
  scoreAnchorV2?: ScoreAnchorV2 | null;
  narrativeFactsV2?: NarrativeFactV2[];
  scoringEvidenceV2?: ScoringEvidenceV2[];
  scoreAnchorDiagnostic?: ScoreAnchorDiagnostic;
  decisionReasons: string[];
  coverage: WhereIsMoneyCoverage;
  layerSummary?: MoneyOriginLayerSummary;
};

export type FreshWhereIsMoneyReportV2 = WhereIsMoneyReport & {
  scoringPolicyVersion: "scoring-signal-matrix-v3";
  scoreAnchorV2: ScoreAnchorV2 | null;
  narrativeFactsV2: NarrativeFactV2[];
  scoringEvidenceV2: ScoringEvidenceV2[];
  scoreAnchorDiagnostic: ScoreAnchorDiagnostic;
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

export type HistoricalTransitBreakdown = {
  eligible: boolean;
  flowUsdt: number;
  volumeScore: number;
  passThrough: number;
  passThroughScore: number;
  serviceShare: number;
  serviceShareScore: number;
  score: number;
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
  historicalTransitScore: number;
  historicalTransitBreakdown: HistoricalTransitBreakdown;
  operationalScore: number;
  features: RouteScoreFeature[];
};

export type FastCounterpartyTopDirection = "incoming" | "outgoing" | "service";

export type FastCounterpartyTopRow = {
  address: string;
  direction: FastCounterpartyTopDirection;
  volumeRaw: string;
  txCount: number;
  volumeRatio: number;
  firstSeen: string | null;
  lastSeen: string | null;
  sampleTxHashes: string[];
  category: ServiceCategory | null;
  identity: string | null;
  selectedAsDeepPriorityHint: boolean;
};

export type FastCounterpartyTopsProfile = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  topIncomingCounterparties: FastCounterpartyTopRow[];
  topOutgoingCounterparties: FastCounterpartyTopRow[];
  topServiceCounterparties: FastCounterpartyTopRow[];
  categoryBreakdown: FlowCategoryBreakdown[];
};

export type FastCheckHintAddress = {
  address: string;
  direction: FastCounterpartyTopDirection;
  volumeRaw: string;
  txCount: number;
  category: ServiceCategory | null;
  identity: string | null;
  reason: string;
};

export type FastCheckHints = {
  fastCheckJobId: string;
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  topIncomingAddresses: FastCheckHintAddress[];
  topOutgoingAddresses: FastCheckHintAddress[];
  topServiceAddresses: FastCheckHintAddress[];
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

export type DirectPrincipalCounterpartyGroup = {
  address: string;
  direction: CounterpartyRiskDirection;
  principalAmountRaw: bigint;
  principalTxCount: number;
  directionalPrincipalShare: number | null;
  shareSemantics: "exact" | "unavailable";
  transferTxHashes: string[];
  principalTransfers: Array<{
    txHash: string;
    amountRaw: bigint;
    occurredAt: string;
  }>;
  material: boolean;
};

export type FirstHopTemporalRelation =
  | "active_at_transfer"
  | "became_active_after"
  | "mixed"
  | "unknown";

export type FirstHopBlacklistFact = {
  counterpartyAddress: string;
  direction: CounterpartyRiskDirection;
  evidenceKind: "usdt_blacklist";
  evidenceAuthority: "official_contract";
  statusAtCheck: "active" | "inactive" | "unknown";
  temporalRelation: FirstHopTemporalRelation;
  effectiveAt: string | null;
  effectiveTxHash: string | null;
  checkedAt: string;
  principalAmountRaw: string;
  principalTxCount: number;
  directionalPrincipalShare: number | null;
  shareSemantics: "exact" | "lower_bound" | "unavailable";
  transferTxHashes: string[];
  beforeEffectiveAmountRaw: string;
  beforeEffectiveTxCount: number;
  activeAmountRaw: string;
  activeTxCount: number;
  unknownTimingAmountRaw: string;
  unknownTimingTxCount: number;
  directTransferCoverage: "complete" | "partial";
  timelineCoverage: "complete" | "partial";
  timelineEvents: UsdtBlacklistTimelineEvent[];
};

export type FirstHopLabelFact = {
  counterpartyAddress: string;
  direction: CounterpartyRiskDirection;
  labelCode: RiskLabel;
  evidenceAuthority: "exact_internal" | "derived";
  recordedAt: string;
  effectiveAt: null;
  principalAmountRaw: string;
  principalTxCount: number;
  directionalPrincipalShare: number | null;
  shareSemantics: "exact" | "lower_bound" | "unavailable";
  transferTxHashes: string[];
  linkedToSelectedProvenance: boolean;
};

export type FirstHopBlacklistCoverage = {
  requiredForDecision: boolean;
  scope: "all_time" | "checked_window";
  windowStart: string | null;
  windowEnd: string | null;
  directPrincipalTransferCoverage: "complete" | "partial";
  materialCounterpartyCount: number;
  checkedMaterialCounterpartyCount: number;
  failedMaterialCounterpartyCount: number;
  uncheckedMaterialCounterpartyCount: number;
  blacklistCheckCoverage:
    | "complete"
    | "running"
    | "provider_failed"
    | "budget_exhausted"
    | "history_partial";
  incompleteReason: string | null;
  confirmedAdverseFactCount: number;
  completeTimelineFactCount: number;
  partialTimelineFactCount: number;
};

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
  transfers?: Array<{
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountRaw: string;
    timestamp: string;
    method: string;
    edgeType: ForensicRouteEdgeType;
    economicRole?: ForensicEconomicRole;
    economicProtocol?: ForensicEconomicProtocol;
  }>;
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

export type AssetContinuationDestinationRisk =
  | "provider_risk"
  | "internal_label"
  | "service_boundary"
  | "unknown";

export type AssetContinuationTokenQuality = "verified" | "known" | "unknown";

export type AssetContinuationProfile = {
  subjectAddress: string;
  sourceAsset: "USDT";
  continuationAssetSymbol: string;
  continuationTokenContract: string;
  conversionTxHash: string;
  outgoingTxHash: string | null;
  protocolAddress: string | null;
  destinationAddress: string | null;
  destinationRisk: AssetContinuationDestinationRisk;
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
  continuationAmountRaw: string | null;
  tokenQuality: AssetContinuationTokenQuality;
  score: number;
  evidenceClass: "asset_continuation";
  reasons: string[];
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

export type TimelineBearingStablecoinRestrictionProfile = StablecoinRestrictionProfile & {
  blacklistTimeline?: UsdtBlacklistTimeline | null;
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
  fastCounterpartyTopsProfile?: FastCounterpartyTopsProfile | null;
  walletRoleProfiles?: WalletRoleProfile[];
  usddPsmRouteObservations?: UsddPsmRouteObservationV1[];
};
