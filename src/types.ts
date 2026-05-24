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
  | "risky_contract";

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
  fastestServiceExitMs: number | null;
  bestAmountPreservationRatio: number | null;
  exposureScore: number;
  features: RouteScoreFeature[];
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
