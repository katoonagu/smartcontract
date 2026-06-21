import type {
  AddressLabel,
  AddressFeaturesDaily,
  AddressLabelCacheEntry,
  BotLocale,
  CachedAddressLabelCategory,
  CachedAddressLabelProvider,
  ForensicCaseInput,
  ForensicCaseStatus,
  ForensicRouteConfidence,
  ForensicRouteEdgeType,
  ForensicRoutePath,
  IndexedTronUsdtApproval,
  IndexedTronUsdtTransfer,
  RawEvidenceInput,
  RawEvidenceSourceType,
  RiskConfidence,
  RiskLabel,
  RiskReport,
  RiskSeverity,
  RiskSignalGroup,
  RiskSignalObservationInput,
  RiskLevel,
  RiskReason,
  TronUsdtTransferMethod,
  WalletApprovalSpenderType,
  TronTransferEvent,
  WalletAlertMode,
  WatchedWallet
} from "../types";
import type {
  ContractActivityLevel,
  ContractCallerStat,
  ContractIntelligenceProfile,
  ContractMethodStat,
  ContractProviderTag,
  ContractPublicTag
} from "../approvals/contractIntelligence";
import type {
  ContractLlmVerdictCacheLookup,
  ContractLlmVerdictCacheRecord,
  ContractLlmVerdictFingerprintCacheLookup
} from "../forensics/contractLlmVerdict";
import { deriveActivityLevel, inspectRawContractJson } from "../approvals/contractIntelligence";
import type { Db } from "./db";

export type {
  RawEvidenceInput,
  RiskSignalObservationInput
} from "../types";

export type UserAlertStatus = "pending" | "sending" | "analyzing" | "sent" | "failed" | "skipped";
export type TelegramUserPendingAction =
  | "add_wallet"
  | "check_address"
  | "check_tx"
  | "report_theft_tx"
  | "report_theft_comment"
  | "add_alert_admin"
  | "add_alert_admin_all"
  | "add_alert_admin_suspicious_only"
  | "remove_alert_admin";
export type CustomerAlertMode = "all" | "suspicious_only";

export type TelegramUserSession = {
  telegramUserId: string;
  pendingAction: TelegramUserPendingAction | null;
  selectedWalletId: string | null;
  selectedTheftReportId: string | null;
  updatedAt: Date;
};

export type TheftReportStatus = "draft" | "awaiting_deposit" | "deposit_confirmed" | "documents_requested" | "cancelled";

export type TheftReport = {
  id: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  comment: string | null;
  status: TheftReportStatus;
  depositAddress: string | null;
  depositAmountUsdt: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TheftReportDraftInput = {
  id?: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  depositAddress: string | null;
  depositAmountUsdt: string;
};

export type CustomerAlertRecipient = {
  ownerTelegramUserId: string;
  recipientTelegramUserId: string;
  alertMode: CustomerAlertMode;
  createdAt: Date;
  updatedAt: Date;
};

export type WalletPollState = {
  watchedWalletId: string;
  lastSeenBlockTs: Date | null;
  lastSeenTxHash: string | null;
  backfillAnchorBlockTs: Date | null;
  backfillAnchorTxHash: string | null;
  backfillNextStart: number;
  backfillComplete: boolean;
  lastSuccessfulPollAt: Date | null;
  lastPollEventCount: number;
  lastPollNewCount: number;
  lastPollError: string | null;
  updatedAt: Date;
};

export type WalletDashboardSnapshot = {
  watchedWalletId: string;
  trxBalanceSun: string;
  usdtBalanceMicro: string;
  walletCreatedAt: Date | null;
  totalTxCount: string | null;
  incomingTxCount: string | null;
  outgoingTxCount: string | null;
  thirtyDayInUsdt: string;
  thirtyDayOutUsdt: string;
  thirtyDayTransferCount: number;
  thirtyDayFeeSun: string;
  trxUsdPrice: string | null;
  analyticsPartial: boolean;
  refreshedAt: Date;
  lastError: string | null;
};

export type ObservedTransactionUserAlert = {
  txHash: string;
  watchedWalletId: string;
  sender: string;
  receiver: string;
  token: "USDT";
  amount: string;
  timestamp: Date;
  userAlertStatus: UserAlertStatus;
  userAlertAttempts: number;
  userAlertLastError: string | null;
  userAlertUpdatedAt: Date | null;
  createdAt: Date;
};

export type ObservedTransactionDigestItem = ObservedTransactionUserAlert & {
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: RiskReason[];
  digestSentAt: Date | null;
};
export type ApprovalOwnerAlertStatus = UserAlertStatus;
export type WalletApprovalStatus = "active" | "revoked" | "unknown";
export type ApprovalContextStatus = "not_needed" | "pending" | "finalizing" | "resolved" | "expired";
export type ApprovalContextResult = "linked_swap_route" | "no_route_found" | "collector_drain" | "unknown";

export type WalletApprovalPollState = {
  watchedWalletId: string;
  lastSeenApprovalTs: Date | null;
  lastSeenTxHash: string | null;
  lastSuccessfulPollAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
};

export type WalletApproval = {
  watchedWalletId: string;
  tokenContract: string;
  spenderAddress: string;
  amountRaw: string;
  isUnlimited: boolean;
  currentAllowanceRaw: string;
  spenderType: WalletApprovalSpenderType;
  status: WalletApprovalStatus;
  lastApprovalTxHash: string | null;
  lastApprovalAt: Date | null;
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: RiskReason[];
  lastAlertedTxHash: string | null;
  metadataName: string | null;
  metadataTag: string | null;
  metadataSource: "tronscan" | null;
  metadataIsContract: boolean | null;
  contractServiceTag: string | null;
  contractVerified: boolean | null;
  contractActivityLevel: ContractActivityLevel | null;
  contractTopMethods: ContractMethodStat[];
  contractHasTransferFromSelector: boolean | null;
  contractHasOwnerOnlyPattern: boolean | null;
  approvalContextStatus?: ApprovalContextStatus | null;
  approvalContextResult?: ApprovalContextResult | null;
  approvalContextDeadlineAt?: Date | null;
  approvalFinalContextAlertSentAt?: Date | null;
  updatedAt: Date;
};

export type WalletApprovalSpenderRelation = WalletApproval & {
  watchedWalletAddress: string;
  watchedWalletTelegramUserId: string;
};

export type WalletApprovalSummary = {
  usdtApprovalCount: number;
  unlimitedApprovalCount: number;
  highRiskApprovalCount: number;
  topRiskyApprovals: WalletApproval[];
  drainObservationCount: number;
  highRiskDrainObservationCount: number;
  topDrainObservations: ObservedApprovalDrainEvent[];
};

export type ObservedApprovalEvent = {
  approvalTxHash: string;
  watchedWalletId: string;
  ownerAddress: string;
  tokenContract: string;
  spenderAddress: string;
  spenderType: WalletApprovalSpenderType;
  amountRaw: string;
  isUnlimited: boolean;
  approvalAt: Date;
  ownerAlertStatus: ApprovalOwnerAlertStatus;
  ownerAlertAttempts: number;
  ownerAlertLastError: string | null;
  ownerAlertUpdatedAt: Date | null;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  riskReasons: RiskReason[];
  createdAt: Date;
};

export type PendingApprovalContextRow = ObservedApprovalEvent & {
  contextStatus: ApprovalContextStatus;
  contextDeadlineAt: Date | null;
  contextResult: ApprovalContextResult;
  initialRiskLevel: RiskLevel | null;
  initialRiskScore: number | null;
  initialRiskReasons: RiskReason[];
  finalRiskLevel: RiskLevel | null;
  finalRiskScore: number | null;
  finalRiskReasons: RiskReason[];
  finalContextAlertSentAt: Date | null;
  contextLastError: string | null;
  contextUpdatedAt: Date;
  wallet: WatchedWallet;
};

export type ObservedApprovalDrainEvent = {
  id: string;
  watchedWalletId: string;
  approvalTxHash: string;
  transferTxHash: string;
  ownerAddress: string;
  spenderAddress: string;
  receiverAddress: string;
  tokenContract: string;
  amountRaw: string;
  callerAddress: string;
  method: string;
  approvalAt: Date;
  transferAt: Date;
  timeToTransferMs: string;
  spenderType: WalletApprovalSpenderType;
  receiverType: WalletApprovalSpenderType;
  observedMode: "shadow";
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: RiskReason[];
  rawEvidenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AddressMetadata = {
  address: string;
  source: "tronscan";
  name: string | null;
  tag: string | null;
  isContract: boolean | null;
  verified: boolean | null;
  accountType: number | null;
  rawJson: Record<string, unknown>;
  fetchedAt: Date;
  expiresAt: Date;
};

export type TelegramUserProfile = {
  telegramUserId: string;
  username: string | null;
  locale: BotLocale;
  createdAt: Date;
};

export type ForensicCheckJobStatus = "queued" | "running" | "partial" | "completed" | "failed" | "cancelled";
export type ForensicCheckJobKind =
  | "address_fast_check"
  | "address_deep_check"
  | "where_is_money_check"
  | "incoming_deposit_check";
export type QueueableForensicCheckJobKind = Exclude<ForensicCheckJobKind, "address_fast_check">;

export type ForensicCheckJob = {
  id: string;
  kind: ForensicCheckJobKind;
  subjectAddress: string;
  status: ForensicCheckJobStatus;
  windowStart: Date;
  windowEnd: Date;
  priority: number;
  chatId: string | null;
  messageId: string | null;
  requestedBy: string | null;
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type ForensicCheckJobInput = {
  kind?: QueueableForensicCheckJobKind;
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  priority?: number;
  chatId?: string | null;
  messageId?: string | null;
  requestedBy?: string | null;
  progressJson?: Record<string, unknown>;
};

export type AddressFastCheckJobInput = {
  id?: string;
  subjectAddress: string;
  status: Extract<ForensicCheckJobStatus, "completed" | "partial">;
  windowStart: Date;
  windowEnd: Date;
  priority?: number;
  chatId?: string | null;
  requestedBy?: string | null;
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

export type ListAdminForensicCheckJobsInput = {
  limit?: number;
  offset?: number;
  status?: ForensicCheckJobStatus;
  kind?: ForensicCheckJobKind;
  subjectAddress?: string;
};

export type RecoverStaleForensicCheckJobsInput = {
  staleRunningBefore: Date;
  maxRetries: number;
  limit?: number;
  recoveredAt?: Date;
};

export type RecoverStaleForensicCheckJobsResult = {
  requeued: ForensicCheckJob[];
  failed: ForensicCheckJob[];
};

export type AddressLabelAssertionStatus = "active" | "inactive" | "retired" | "false_positive";

export type AddressLabelAssertion = {
  id: string;
  chain: string;
  address: string;
  label: RiskLabel;
  entityName: string | null;
  category: string;
  confidence: RiskConfidence;
  severity: RiskSeverity;
  status: AddressLabelAssertionStatus;
  sourceName: string;
  sourceUrl: string | null;
  notes: string | null;
  evidenceJson: Record<string, unknown>;
  createdByTelegramId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AddressLabelAssertionInput = {
  id?: string;
  chain: string;
  address: string;
  label: RiskLabel;
  entityName?: string | null;
  category: string;
  confidence: RiskConfidence;
  severity: RiskSeverity;
  status: AddressLabelAssertionStatus;
  sourceName: string;
  sourceUrl?: string | null;
  notes?: string | null;
  evidenceJson?: Record<string, unknown>;
  createdByTelegramId?: string | null;
  derivedLabelSource?: "service_admin" | "system";
  firstSeenAt?: Date;
  lastSeenAt?: Date;
};

export type TronUsdtIndexerCursorStatus = "idle" | "running" | "completed" | "failed";

export type TronUsdtIndexerCursor = {
  id: string;
  status: TronUsdtIndexerCursorStatus;
  lastIndexedBlock: number | null;
  lastIndexedTimestamp: Date | null;
  lastFingerprint: string | null;
  progressJson: Record<string, unknown>;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TronUsdtIndexerCursorInput = {
  id: string;
  status: TronUsdtIndexerCursorStatus;
  lastIndexedBlock?: number | null;
  lastIndexedTimestamp?: Date | null;
  lastFingerprint?: string | null;
  progressJson?: Record<string, unknown>;
  lastError?: string | null;
};

export type IndexedTronUsdtTransferQuery = {
  address: string;
  minTimestamp?: Date;
  maxTimestamp?: Date;
  limit?: number;
  offset?: number;
  direction?: "incoming" | "outgoing" | "both";
  orderBy?: "newest" | "amount_desc";
};

export type AddressLabelCacheInput = Omit<AddressLabelCacheEntry, "firstSeenAt" | "lastSeenAt"> & {
  firstSeenAt?: Date;
  lastSeenAt?: Date;
};

export type {
  ContractActivityLevel,
  ContractCallerStat,
  ContractIntelligenceProfile,
  ContractMethodStat
};

const riskLabels = new Set<RiskLabel>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "victim",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange",
  "darknet_exchange_proximity",
  "approval_drain_proximity"
]);

const userAlertStatuses = new Set<UserAlertStatus>(["pending", "sending", "analyzing", "sent", "failed", "skipped"]);
const walletAlertModes = new Set<WalletAlertMode>(["realtime", "risk_only", "digest", "paused"]);
const telegramUserPendingActions = new Set<TelegramUserPendingAction>([
  "add_wallet",
  "check_address",
  "check_tx",
  "report_theft_tx",
  "report_theft_comment",
  "add_alert_admin",
  "add_alert_admin_all",
  "add_alert_admin_suspicious_only",
  "remove_alert_admin"
]);
const theftReportStatuses = new Set<TheftReportStatus>([
  "draft",
  "awaiting_deposit",
  "deposit_confirmed",
  "documents_requested",
  "cancelled"
]);
const customerAlertModes = new Set<CustomerAlertMode>(["all", "suspicious_only"]);
const walletApprovalStatuses = new Set<WalletApprovalStatus>(["active", "revoked", "unknown"]);
const walletApprovalSpenderTypes = new Set<WalletApprovalSpenderType>(["eoa", "contract", "unknown"]);
const approvalContextStatuses = new Set<ApprovalContextStatus>(["not_needed", "pending", "finalizing", "resolved", "expired"]);
const approvalContextResults = new Set<ApprovalContextResult>(["linked_swap_route", "no_route_found", "collector_drain", "unknown"]);
const contractActivityLevels = new Set<ContractActivityLevel>(["unknown", "none", "low", "normal", "high"]);
const rawEvidenceSourceTypes = new Set<RawEvidenceSourceType>([
  "internal_label",
  "provider_response",
  "detector_output",
  "transfer_context",
  "manual_input"
]);
const riskSignalGroups = new Set<RiskSignalGroup>([
  "internal_label",
  "provider",
  "graph",
  "behavior",
  "incoming_context",
  "approval",
  "manual"
]);
const riskConfidences = new Set<RiskConfidence>(["low", "medium", "high"]);
const riskSeverities = new Set<RiskSeverity>(["info", "low", "medium", "high", "critical"]);
const forensicCaseStatuses = new Set<ForensicCaseStatus>(["completed", "partial", "failed"]);
const forensicRouteConfidences = new Set<ForensicRouteConfidence>(["low", "medium", "high"]);
const forensicRouteEdgeTypes = new Set<ForensicRouteEdgeType>(["normal_transfer", "transfer_from", "unknown"]);
const forensicCheckJobStatuses = new Set<ForensicCheckJobStatus>(["queued", "running", "partial", "completed", "failed", "cancelled"]);
const forensicCheckJobKinds = new Set<ForensicCheckJobKind>([
  "address_fast_check",
  "address_deep_check",
  "where_is_money_check",
  "incoming_deposit_check"
]);
const addressLabelAssertionStatuses = new Set<AddressLabelAssertionStatus>(["active", "inactive", "retired", "false_positive"]);
const tronUsdtTransferMethods = new Set<TronUsdtTransferMethod>(["transfer", "transferFrom"]);
const tronUsdtIndexerCursorStatuses = new Set<TronUsdtIndexerCursorStatus>(["idle", "running", "completed", "failed"]);
const cachedAddressLabelProviders = new Set<CachedAddressLabelProvider>(["tronscan", "oklink", "arkham", "manual"]);
const cachedAddressLabelCategories = new Set<CachedAddressLabelCategory>([
  "cex",
  "hot_wallet",
  "bridge",
  "router",
  "dex",
  "pool",
  "scam",
  "darknet_exchange",
  "unknown"
]);
const botLocales = new Set<BotLocale>(["ru", "en"]);
const maxUserAlertErrorLength = 1024;
const maxPollErrorLength = 1024;

function parseRiskLabel(value: string): RiskLabel {
  if (!riskLabels.has(value as RiskLabel)) {
    throw new Error(`Invalid risk label from database: ${value}`);
  }
  return value as RiskLabel;
}

function parseLabelSource(value: string): "service_admin" | "system" {
  if (value !== "service_admin" && value !== "system") {
    throw new Error(`Invalid label source from database: ${value}`);
  }
  return value;
}

function parseUserAlertStatus(value: string): UserAlertStatus {
  if (!userAlertStatuses.has(value as UserAlertStatus)) {
    throw new Error(`Invalid user alert status from database: ${value}`);
  }
  return value as UserAlertStatus;
}

function parseWalletAlertMode(value: string): WalletAlertMode {
  if (!walletAlertModes.has(value as WalletAlertMode)) {
    throw new Error(`Invalid wallet alert mode from database: ${value}`);
  }
  return value as WalletAlertMode;
}

function parseTelegramUserPendingAction(value: string | null): TelegramUserPendingAction | null {
  if (value === null) return null;
  if (!telegramUserPendingActions.has(value as TelegramUserPendingAction)) {
    throw new Error(`Invalid telegram user pending action from database: ${value}`);
  }
  return value as TelegramUserPendingAction;
}

function parseTheftReportStatus(value: string): TheftReportStatus {
  if (!theftReportStatuses.has(value as TheftReportStatus)) {
    throw new Error(`Invalid theft report status from database: ${value}`);
  }
  return value as TheftReportStatus;
}

function parseCustomerAlertMode(value: string): CustomerAlertMode {
  if (!customerAlertModes.has(value as CustomerAlertMode)) {
    throw new Error(`Invalid customer alert mode from database: ${value}`);
  }
  return value as CustomerAlertMode;
}

function parseRawEvidenceSourceType(value: string): RawEvidenceSourceType {
  if (!rawEvidenceSourceTypes.has(value as RawEvidenceSourceType)) {
    throw new Error(`Invalid raw evidence source type from database: ${value}`);
  }
  return value as RawEvidenceSourceType;
}

function parseRiskSignalGroup(value: string): RiskSignalGroup {
  if (!riskSignalGroups.has(value as RiskSignalGroup)) {
    throw new Error(`Invalid risk signal group from database: ${value}`);
  }
  return value as RiskSignalGroup;
}

function parseRiskConfidence(value: string): RiskConfidence {
  if (!riskConfidences.has(value as RiskConfidence)) {
    throw new Error(`Invalid risk confidence from database: ${value}`);
  }
  return value as RiskConfidence;
}

function parseRiskSeverity(value: string): RiskSeverity {
  if (!riskSeverities.has(value as RiskSeverity)) {
    throw new Error(`Invalid risk severity from database: ${value}`);
  }
  return value as RiskSeverity;
}

function parseForensicCaseStatus(value: string): ForensicCaseStatus {
  if (!forensicCaseStatuses.has(value as ForensicCaseStatus)) {
    throw new Error(`Invalid forensic case status: ${value}`);
  }
  return value as ForensicCaseStatus;
}

function parseForensicRouteConfidence(value: string): ForensicRouteConfidence {
  if (!forensicRouteConfidences.has(value as ForensicRouteConfidence)) {
    throw new Error(`Invalid forensic route confidence: ${value}`);
  }
  return value as ForensicRouteConfidence;
}

function parseForensicRouteEdgeType(value: string): ForensicRouteEdgeType {
  if (!forensicRouteEdgeTypes.has(value as ForensicRouteEdgeType)) {
    throw new Error(`Invalid forensic route edge type: ${value}`);
  }
  return value as ForensicRouteEdgeType;
}

function parseBotLocale(value: string | null | undefined): BotLocale {
  if (!botLocales.has(value as BotLocale)) return "ru";
  return value as BotLocale;
}

function normalizeNullableBotLocale(value: unknown): BotLocale | null {
  return value === "en" || value === "ru" ? value : null;
}

function parseTronUsdtTransferMethod(value: string): TronUsdtTransferMethod {
  if (!tronUsdtTransferMethods.has(value as TronUsdtTransferMethod)) {
    throw new Error(`Invalid TRON USDT transfer method: ${value}`);
  }
  return value as TronUsdtTransferMethod;
}

function parseTronUsdtIndexerCursorStatus(value: string): TronUsdtIndexerCursorStatus {
  if (!tronUsdtIndexerCursorStatuses.has(value as TronUsdtIndexerCursorStatus)) {
    throw new Error(`Invalid TRON USDT indexer cursor status: ${value}`);
  }
  return value as TronUsdtIndexerCursorStatus;
}

function parseCachedAddressLabelProvider(value: string): CachedAddressLabelProvider {
  if (!cachedAddressLabelProviders.has(value as CachedAddressLabelProvider)) {
    throw new Error(`Invalid address label cache provider: ${value}`);
  }
  return value as CachedAddressLabelProvider;
}

function parseCachedAddressLabelCategory(value: string): CachedAddressLabelCategory {
  if (!cachedAddressLabelCategories.has(value as CachedAddressLabelCategory)) {
    throw new Error(`Invalid address label cache category: ${value}`);
  }
  return value as CachedAddressLabelCategory;
}

function parseForensicCheckJobStatus(value: string): ForensicCheckJobStatus {
  if (!forensicCheckJobStatuses.has(value as ForensicCheckJobStatus)) {
    throw new Error(`Invalid forensic check job status: ${value}`);
  }
  return value as ForensicCheckJobStatus;
}

function parseForensicCheckJobKind(value: string): ForensicCheckJobKind {
  if (!forensicCheckJobKinds.has(value as ForensicCheckJobKind)) {
    throw new Error(`Invalid forensic check job kind: ${value}`);
  }
  return value as ForensicCheckJobKind;
}

function parseAddressLabelAssertionStatus(value: string): AddressLabelAssertionStatus {
  if (!addressLabelAssertionStatuses.has(value as AddressLabelAssertionStatus)) {
    throw new Error(`Invalid address label assertion status: ${value}`);
  }
  return value as AddressLabelAssertionStatus;
}

function parseWalletApprovalStatus(value: string): WalletApprovalStatus {
  if (!walletApprovalStatuses.has(value as WalletApprovalStatus)) {
    throw new Error(`Invalid wallet approval status from database: ${value}`);
  }
  return value as WalletApprovalStatus;
}

function parseWalletApprovalSpenderType(value: string): WalletApprovalSpenderType {
  if (!walletApprovalSpenderTypes.has(value as WalletApprovalSpenderType)) {
    throw new Error(`Invalid wallet approval spender type from database: ${value}`);
  }
  return value as WalletApprovalSpenderType;
}

function parseApprovalContextStatus(value: string): ApprovalContextStatus {
  if (!approvalContextStatuses.has(value as ApprovalContextStatus)) {
    throw new Error(`Invalid approval context status from database: ${value}`);
  }
  return value as ApprovalContextStatus;
}

function parseApprovalContextResult(value: string): ApprovalContextResult {
  if (!approvalContextResults.has(value as ApprovalContextResult)) {
    throw new Error(`Invalid approval context result from database: ${value}`);
  }
  return value as ApprovalContextResult;
}

function parseContractActivityLevel(value: string | null): ContractActivityLevel | null {
  if (value === null) return null;
  if (!contractActivityLevels.has(value as ContractActivityLevel)) {
    throw new Error(`Invalid contract activity level from database: ${value}`);
  }
  return value as ContractActivityLevel;
}

function mapContractMethodStats(value: unknown): ContractMethodStat[] {
  const rows: unknown[] = Array.isArray(value) ? value : JSON.parse(String(value ?? "[]"));
  return rows
    .filter((row: unknown): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
    .map((row) => {
      const method = typeof row.method === "string" ? row.method : typeof row.signature === "string" ? row.signature : "unknown";
      const methodId = typeof row.methodId === "string" ? row.methodId : typeof row.method_id === "string" ? row.method_id : method;
      const calls = Number.isSafeInteger(row.calls) ? Number(row.calls) : Number.isSafeInteger(row.count) ? Number(row.count) : 0;
      const percentage = typeof row.percentage === "number" && Number.isFinite(row.percentage)
        ? row.percentage
        : typeof row.ratio === "number" && Number.isFinite(row.ratio)
          ? row.ratio
          : null;
      return {
        methodId,
        signature: typeof row.signature === "string" ? row.signature : method === methodId ? null : method,
        count: calls,
        ratio: percentage,
        method,
        calls,
        percentage
      };
    });
}

function mapContractCallerStats(value: unknown): ContractCallerStat[] {
  const rows: unknown[] = Array.isArray(value) ? value : JSON.parse(String(value ?? "[]"));
  return rows
    .filter((row: unknown): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row))
    .map((row) => {
      const count = Number.isSafeInteger(row.calls) ? Number(row.calls) : Number.isSafeInteger(row.count) ? Number(row.count) : 0;
      const ratio = typeof row.percentage === "number" && Number.isFinite(row.percentage)
        ? row.percentage
        : typeof row.ratio === "number" && Number.isFinite(row.ratio)
          ? row.ratio
          : null;
      return {
        address: typeof row.address === "string" ? row.address : "unknown",
        addressTag: typeof row.addressTag === "string" ? row.addressTag : null,
        count,
        ratio,
        calls: count,
        percentage: ratio
      };
    });
}

function mapJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapJsonStringArray(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : [];
  return Array.isArray(rows) ? rows.filter((item): item is string => typeof item === "string") : [];
}

function mapForensicCheckJobRow(row: Record<string, any>): ForensicCheckJob {
  return {
    id: row.id,
    kind: parseForensicCheckJobKind(row.kind),
    subjectAddress: row.subject_address,
    status: parseForensicCheckJobStatus(row.status),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    priority: Number(row.priority ?? 100),
    chatId: row.chat_id,
    messageId: row.message_id,
    requestedBy: row.requested_by,
    progressJson: mapJsonObject(row.progress_json),
    resultJson: mapJsonObject(row.result_json),
    rawEvidenceIds: mapJsonStringArray(row.raw_evidence_ids),
    observationIds: mapJsonStringArray(row.observation_ids),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function mapAddressLabelRow(row: Record<string, any>): AddressLabel {
  return {
    address: row.address,
    label: parseRiskLabel(row.label),
    source: parseLabelSource(row.source),
    createdByTelegramId: row.created_by_telegram_id,
    createdAt: row.created_at
  };
}

function mapAddressLabelAssertionRow(row: Record<string, any>): AddressLabelAssertion {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    label: parseRiskLabel(row.label),
    entityName: row.entity_name,
    category: row.category,
    confidence: parseRiskConfidence(row.confidence),
    severity: parseRiskSeverity(row.severity),
    status: parseAddressLabelAssertionStatus(row.status),
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    notes: row.notes,
    evidenceJson: mapJsonObject(row.evidence_json),
    createdByTelegramId: row.created_by_telegram_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapIndexedTronUsdtTransferRow(row: Record<string, any>): IndexedTronUsdtTransfer {
  return {
    txHash: row.tx_hash,
    blockNumber: Number(row.block_number),
    blockTimestamp: row.block_timestamp,
    eventIndex: Number(row.event_index),
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amountRaw: String(row.amount_raw),
    method: parseTronUsdtTransferMethod(row.method),
    callerAddress: row.caller_address ?? null,
    contractRet: row.contract_ret ?? null,
    confirmed: row.confirmed === true
  };
}

function mapIndexedTronUsdtApprovalRow(row: Record<string, any>): IndexedTronUsdtApproval {
  return {
    txHash: row.tx_hash,
    blockNumber: Number(row.block_number),
    blockTimestamp: row.block_timestamp,
    eventIndex: Number(row.event_index),
    ownerAddress: row.owner_address,
    spenderAddress: row.spender_address,
    amountRaw: String(row.amount_raw),
    isUnlimited: row.is_unlimited === true
  };
}

function mapAddressFeaturesDailyRow(row: Record<string, any>): AddressFeaturesDaily {
  return {
    address: row.address,
    day: row.day,
    inVolumeRaw: String(row.in_volume_raw),
    outVolumeRaw: String(row.out_volume_raw),
    inCount: Number(row.in_count),
    outCount: Number(row.out_count),
    uniqueIn: Number(row.unique_in),
    uniqueOut: Number(row.unique_out),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen
  };
}

function mapAddressLabelCacheRow(row: Record<string, any>): AddressLabelCacheEntry {
  return {
    chain: row.chain,
    address: row.address,
    provider: parseCachedAddressLabelProvider(row.provider),
    label: row.label,
    category: parseCachedAddressLabelCategory(row.category),
    confidence: parseRiskConfidence(row.confidence),
    sourceUrl: row.source_url,
    rawJson: mapJsonObject(row.raw_json),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at
  };
}

function mapTronUsdtIndexerCursorRow(row: Record<string, any>): TronUsdtIndexerCursor {
  return {
    id: row.id,
    status: parseTronUsdtIndexerCursorStatus(row.status),
    lastIndexedBlock: row.last_indexed_block === null || row.last_indexed_block === undefined ? null : Number(row.last_indexed_block),
    lastIndexedTimestamp: row.last_indexed_timestamp ?? null,
    lastFingerprint: row.last_fingerprint ?? null,
    progressJson: mapJsonObject(row.progress_json),
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTelegramUserSessionRow(row: Record<string, any>): TelegramUserSession {
  return {
    telegramUserId: row.telegram_user_id,
    pendingAction: parseTelegramUserPendingAction(row.pending_action),
    selectedWalletId: row.selected_wallet_id,
    selectedTheftReportId: row.selected_theft_report_id ?? null,
    updatedAt: row.updated_at
  };
}

function mapTheftReportRow(row: Record<string, any>): TheftReport {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    txHash: row.tx_hash,
    victimAddress: row.victim_address,
    reportedScamAddress: row.reported_scam_address,
    amountRaw: row.amount_raw,
    amountUsdt: row.amount_usdt,
    comment: row.comment ?? null,
    status: parseTheftReportStatus(row.status),
    depositAddress: row.deposit_address ?? null,
    depositAmountUsdt: row.deposit_amount_usdt,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCustomerAlertRecipientRow(row: Record<string, any>): CustomerAlertRecipient {
  return {
    ownerTelegramUserId: row.owner_telegram_user_id,
    recipientTelegramUserId: row.recipient_telegram_user_id,
    alertMode: parseCustomerAlertMode(row.alert_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWalletPollStateRow(row: Record<string, any>): WalletPollState {
  return {
    watchedWalletId: row.watched_wallet_id,
    lastSeenBlockTs: row.last_seen_block_ts,
    lastSeenTxHash: row.last_seen_tx_hash,
    backfillAnchorBlockTs: row.backfill_anchor_block_ts,
    backfillAnchorTxHash: row.backfill_anchor_tx_hash,
    backfillNextStart: row.backfill_next_start,
    backfillComplete: row.backfill_complete,
    lastSuccessfulPollAt: row.last_successful_poll_at,
    lastPollEventCount: row.last_poll_event_count ?? 0,
    lastPollNewCount: row.last_poll_new_count ?? 0,
    lastPollError: row.last_poll_error,
    updatedAt: row.updated_at
  };
}

function mapWalletDashboardSnapshotRow(row: Record<string, any>): WalletDashboardSnapshot {
  return {
    watchedWalletId: row.watched_wallet_id,
    trxBalanceSun: String(row.trx_balance_sun),
    usdtBalanceMicro: String(row.usdt_balance_micro),
    walletCreatedAt: row.wallet_created_at,
    totalTxCount: row.total_tx_count === null ? null : String(row.total_tx_count),
    incomingTxCount: row.incoming_tx_count === null ? null : String(row.incoming_tx_count),
    outgoingTxCount: row.outgoing_tx_count === null ? null : String(row.outgoing_tx_count),
    thirtyDayInUsdt: String(row.thirty_day_in_usdt),
    thirtyDayOutUsdt: String(row.thirty_day_out_usdt),
    thirtyDayTransferCount: row.thirty_day_transfer_count,
    thirtyDayFeeSun: String(row.thirty_day_fee_sun),
    trxUsdPrice: row.trx_usd_price === null ? null : String(row.trx_usd_price),
    analyticsPartial: row.analytics_partial,
    refreshedAt: row.refreshed_at,
    lastError: row.last_error
  };
}

function mapObservedTransactionUserAlertRow(row: Record<string, any>): ObservedTransactionUserAlert {
  return {
    txHash: row.tx_hash,
    watchedWalletId: row.watched_wallet_id,
    sender: row.sender,
    receiver: row.receiver,
    token: row.token,
    amount: row.amount,
    timestamp: row.timestamp,
    userAlertStatus: parseUserAlertStatus(row.user_alert_status),
    userAlertAttempts: row.user_alert_attempts,
    userAlertLastError: row.user_alert_last_error,
    userAlertUpdatedAt: row.user_alert_updated_at,
    createdAt: row.created_at
  };
}

function mapObservedTransactionDigestItemRow(row: Record<string, any>): ObservedTransactionDigestItem {
  return {
    ...mapObservedTransactionUserAlertRow(row),
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    riskReasons: Array.isArray(row.risk_reasons) ? row.risk_reasons : JSON.parse(row.risk_reasons ?? "[]"),
    digestSentAt: row.digest_sent_at
  };
}

function mapRiskReasons(value: unknown): RiskReason[] {
  return Array.isArray(value) ? value : JSON.parse(String(value ?? "[]"));
}

function mapWalletApprovalPollStateRow(row: Record<string, any>): WalletApprovalPollState {
  return {
    watchedWalletId: row.watched_wallet_id,
    lastSeenApprovalTs: row.last_seen_approval_ts,
    lastSeenTxHash: row.last_seen_tx_hash,
    lastSuccessfulPollAt: row.last_successful_poll_at,
    lastError: row.last_error,
    updatedAt: row.updated_at
  };
}

function mapWalletApprovalRow(row: Record<string, any>): WalletApproval {
  return {
    watchedWalletId: row.watched_wallet_id,
    tokenContract: row.token_contract,
    spenderAddress: row.spender_address,
    amountRaw: row.amount_raw,
    isUnlimited: row.is_unlimited,
    currentAllowanceRaw: row.current_allowance_raw,
    spenderType: parseWalletApprovalSpenderType(row.spender_type),
    status: parseWalletApprovalStatus(row.status),
    lastApprovalTxHash: row.last_approval_tx_hash,
    lastApprovalAt: row.last_approval_at,
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    riskReasons: mapRiskReasons(row.risk_reasons),
    lastAlertedTxHash: row.last_alerted_tx_hash,
    metadataName: row.metadata_name ?? null,
    metadataTag: row.metadata_tag ?? null,
    metadataSource: row.metadata_source === "tronscan" ? "tronscan" : null,
    metadataIsContract: typeof row.metadata_is_contract === "boolean" ? row.metadata_is_contract : null,
    contractServiceTag: row.contract_service_tag ?? null,
    contractVerified: typeof row.contract_verified === "boolean" ? row.contract_verified : null,
    contractActivityLevel: parseContractActivityLevel(row.contract_activity_level ?? null),
    contractTopMethods: mapContractMethodStats(row.contract_top_methods),
    contractHasTransferFromSelector: typeof row.contract_has_transfer_from_selector === "boolean" ? row.contract_has_transfer_from_selector : null,
    contractHasOwnerOnlyPattern: typeof row.contract_has_owner_only_pattern === "boolean" ? row.contract_has_owner_only_pattern : null,
    approvalContextStatus: row.approval_context_status ? parseApprovalContextStatus(row.approval_context_status) : null,
    approvalContextResult: row.approval_context_result ? parseApprovalContextResult(row.approval_context_result) : null,
    approvalContextDeadlineAt: row.approval_context_deadline_at ?? null,
    approvalFinalContextAlertSentAt: row.approval_final_context_alert_sent_at ?? null,
    updatedAt: row.updated_at
  };
}

function mapAddressMetadataRow(row: Record<string, any>): AddressMetadata {
  return {
    address: row.address,
    source: "tronscan",
    name: row.name ?? null,
    tag: row.tag ?? null,
    isContract: typeof row.is_contract === "boolean" ? row.is_contract : null,
    verified: typeof row.verified === "boolean" ? row.verified : null,
    accountType: Number.isSafeInteger(row.account_type) ? row.account_type : null,
    rawJson: row.raw_json && typeof row.raw_json === "object" && !Array.isArray(row.raw_json) ? row.raw_json : {},
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at
  };
}

function mapJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapNullableInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function mapContractIntelligenceProfileRow(row: Record<string, any>): ContractIntelligenceProfile {
  const providerTags = mapJsonArray<ContractProviderTag>(row.provider_tags);
  const publicTags = mapJsonArray<ContractPublicTag>(row.public_tags);
  const serviceTag = providerTags[0]?.label ?? null;
  const publicTag = publicTags[0]?.label ?? null;
  const rawPayload = mapJsonObject(row.raw_payload);
  const topMethods = mapJsonArray<ContractMethodStat>(row.top_methods);
  const topCallers = mapJsonArray<ContractCallerStat>(row.top_callers);
  const txCount = mapNullableString(row.tx_count);
  const totalCallCount = mapNullableString(row.total_call_count);
  const totalCallerCount = mapNullableString(row.total_caller_count);
  const inspection = inspectRawContractJson({ rawPayload, methodMap: mapJsonObject(row.method_map) });
  return {
    contractAddress: row.contract_address ?? row.address,
    providerTags,
    publicTags,
    isVerified: typeof row.is_verified === "boolean" ? row.is_verified : null,
    verifyStatus: mapNullableInteger(row.verify_status),
    sourceStatus: mapNullableString(row.source_status),
    contractCreatedAt: row.contract_created_at,
    contractAgeDays: mapNullableInteger(row.contract_age_days),
    txCount,
    recentCallCount: mapNullableString(row.recent_call_count),
    totalCallCount,
    totalCallerCount,
    topMethods,
    topCallers,
    methodMap: mapJsonObject(row.method_map) as Record<string, string>,
    providerRisk: typeof row.provider_risk === "boolean" ? row.provider_risk : null,
    rawPayload,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    address: row.contract_address ?? row.address,
    source: "tronscan",
    name: mapNullableString(row.name ?? (rawPayload.contract as Record<string, unknown> | undefined)?.name ?? (rawPayload.contracts as Record<string, unknown> | undefined)?.name),
    serviceTag,
    publicTag,
    publicTagDesc: publicTags[0]?.description ?? null,
    tagUrl: providerTags[0]?.url ?? null,
    verified: typeof row.is_verified === "boolean" ? row.is_verified : null,
    trxCount: txCount,
    uniqueCallerCount: totalCallerCount,
    hasTransferFromSelector: inspection.hasTransferFromSelector ||
      topMethods.some((method) => method.methodId === "23b872dd" || method.signature?.toLowerCase().includes("transferfrom")) ||
      Object.keys(mapJsonObject(row.method_map)).some((methodId) => methodId === "23b872dd"),
    hasOwnerOnlyPattern: inspection.hasOwnerOnlyPattern,
    lowMetadata: inspection.lowMetadata || (providerTags.length === 0 && publicTags.length === 0 && Object.keys(mapJsonObject(row.method_map)).length === 0),
    activityLevel: deriveActivityLevel({
      trxCount: mapNullableInteger(row.tx_count),
      totalCallCount: mapNullableInteger(row.total_call_count),
      uniqueCallerCount: mapNullableInteger(row.total_caller_count),
      topMethods
    }),
    rawJson: rawPayload
  };
}

function mapContractLlmVerdictCacheRow(row: Record<string, any>): ContractLlmVerdictCacheRecord {
  return {
    id: row.id,
    contractAddress: row.contract_address,
    profileHash: row.profile_hash,
    contractFingerprintHash: row.contract_fingerprint_hash ?? row.profile_hash,
    cacheScope: row.cache_scope ?? "address_flow",
    flowContextHash: row.flow_context_hash ?? null,
    caseFileHash: row.case_file_hash,
    policyVersion: row.policy_version,
    providerLabel: row.provider_label,
    model: row.model,
    verdict: mapJsonObject(row.verdict_json) as ContractLlmVerdictCacheRecord["verdict"],
    requestCaseHash: row.request_case_hash,
    responseJson: mapJsonObject(row.response_json),
    error: row.error ?? null,
    latencyMs: mapNullableInteger(row.latency_ms),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at
  };
}

function mapObservedApprovalEventRow(row: Record<string, any>): ObservedApprovalEvent {
  return {
    approvalTxHash: row.approval_tx_hash,
    watchedWalletId: row.watched_wallet_id,
    ownerAddress: row.owner_address,
    tokenContract: row.token_contract,
    spenderAddress: row.spender_address,
    spenderType: parseWalletApprovalSpenderType(row.spender_type),
    amountRaw: row.amount_raw,
    isUnlimited: row.is_unlimited,
    approvalAt: row.approval_at,
    ownerAlertStatus: parseUserAlertStatus(row.owner_alert_status),
    ownerAlertAttempts: row.owner_alert_attempts,
    ownerAlertLastError: row.owner_alert_last_error,
    ownerAlertUpdatedAt: row.owner_alert_updated_at,
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    riskReasons: mapRiskReasons(row.risk_reasons),
    createdAt: row.created_at
  };
}

function mapWatchedWalletFields(row: Record<string, any>): WatchedWallet {
  return {
    id: row.wallet_id ?? row.id,
    telegramUserId: row.wallet_telegram_user_id ?? row.telegram_user_id,
    telegramUsername: row.wallet_username ?? row.username ?? null,
    address: row.wallet_address ?? row.address,
    createdAt: row.wallet_created_at ?? row.created_at,
    alertMode: parseWalletAlertMode(row.wallet_alert_mode ?? row.alert_mode ?? "realtime"),
    digestIntervalMinutes: row.wallet_digest_interval_minutes ?? row.digest_interval_minutes ?? 10,
    locale: normalizeNullableBotLocale(row.locale ?? row.wallet_locale ?? null)
  };
}

function mapPendingApprovalContextRow(row: Record<string, any>): PendingApprovalContextRow {
  return {
    ...mapObservedApprovalEventRow(row),
    contextStatus: parseApprovalContextStatus(row.context_status),
    contextDeadlineAt: row.context_deadline_at,
    contextResult: parseApprovalContextResult(row.context_result),
    initialRiskLevel: row.initial_risk_level,
    initialRiskScore: row.initial_risk_score,
    initialRiskReasons: mapRiskReasons(row.initial_risk_reasons),
    finalRiskLevel: row.final_risk_level,
    finalRiskScore: row.final_risk_score,
    finalRiskReasons: mapRiskReasons(row.final_risk_reasons),
    finalContextAlertSentAt: row.final_context_alert_sent_at,
    contextLastError: row.context_last_error,
    contextUpdatedAt: row.context_updated_at,
    wallet: mapWatchedWalletFields(row)
  };
}

function mapObservedApprovalDrainEventRow(row: Record<string, any>): ObservedApprovalDrainEvent {
  return {
    id: row.id,
    watchedWalletId: row.watched_wallet_id,
    approvalTxHash: row.approval_tx_hash,
    transferTxHash: row.transfer_tx_hash,
    ownerAddress: row.owner_address,
    spenderAddress: row.spender_address,
    receiverAddress: row.receiver_address,
    tokenContract: row.token_contract,
    amountRaw: row.amount_raw,
    callerAddress: row.caller_address,
    method: row.method,
    approvalAt: row.approval_at,
    transferAt: row.transfer_at,
    timeToTransferMs: String(row.time_to_transfer_ms),
    spenderType: parseWalletApprovalSpenderType(row.spender_type),
    receiverType: parseWalletApprovalSpenderType(row.receiver_type),
    observedMode: row.observed_mode === "shadow" ? "shadow" : "shadow",
    riskLevel: row.risk_level,
    riskScore: row.risk_score,
    riskReasons: mapRiskReasons(row.risk_reasons),
    rawEvidenceId: row.raw_evidence_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRiskSignalObservationRow(row: Record<string, any>): RiskSignalObservationInput {
  return {
    id: row.id,
    subjectChain: row.subject_chain,
    subjectAddress: row.subject_address,
    subjectTxHash: row.subject_tx_hash,
    observedTransactionHash: row.observed_transaction_hash,
    signalGroup: parseRiskSignalGroup(row.signal_group),
    code: row.code,
    message: row.message,
    scoreImpact: row.score_impact,
    confidence: parseRiskConfidence(row.confidence),
    severity: parseRiskSeverity(row.severity),
    source: row.source,
    policyVersion: row.policy_version,
    rawEvidenceId: row.raw_evidence_id
  };
}

function boundedUserAlertError(error: string): string {
  return error.slice(0, maxUserAlertErrorLength);
}

function boundedPollError(error: string): string {
  return error.slice(0, maxPollErrorLength);
}

function createId(): string {
  return crypto.randomUUID();
}

export async function upsertTelegramUser(db: Db, input: { telegramUserId: string; username: string | null; locale?: BotLocale | null }): Promise<void> {
  if (input.locale !== undefined && input.locale !== null) {
    parseBotLocale(input.locale);
  }
  await db.query(
    `insert into telegram_users (telegram_user_id, username, locale)
     values ($1, $2, coalesce($3, 'ru'))
     on conflict (telegram_user_id) do update set
       username = excluded.username,
       locale = coalesce($3, telegram_users.locale)`,
    [input.telegramUserId, input.username, input.locale ?? null]
  );
}

export async function getTelegramUserLocale(db: Db, telegramUserId: string): Promise<BotLocale> {
  const result = await db.query(
    `select locale from telegram_users where telegram_user_id = $1`,
    [telegramUserId]
  );
  return parseBotLocale(result.rows[0]?.locale);
}

export async function updateTelegramUserLocale(db: Db, telegramUserId: string, locale: BotLocale): Promise<void> {
  parseBotLocale(locale);
  await db.query(
    `insert into telegram_users (telegram_user_id, username, locale)
     values ($1, null, $2)
     on conflict (telegram_user_id) do update set locale = excluded.locale`,
    [telegramUserId, locale]
  );
}

export async function getTelegramUserSession(db: Db, telegramUserId: string): Promise<TelegramUserSession | null> {
  const result = await db.query(
    `select telegram_user_id, pending_action, selected_wallet_id, selected_theft_report_id, updated_at
     from telegram_user_sessions
     where telegram_user_id = $1`,
    [telegramUserId]
  );
  return result.rows[0] ? mapTelegramUserSessionRow(result.rows[0]) : null;
}

export async function setTelegramUserPendingAction(
  db: Db,
  input: {
    telegramUserId: string;
    pendingAction: TelegramUserPendingAction;
    selectedWalletId?: string | null;
    selectedTheftReportId?: string | null;
  }
): Promise<void> {
  await db.query(
    `insert into telegram_user_sessions (telegram_user_id, pending_action, selected_wallet_id, selected_theft_report_id)
     values ($1, $2, $3, $4)
     on conflict (telegram_user_id) do update set
       pending_action = excluded.pending_action,
       selected_wallet_id = excluded.selected_wallet_id,
       selected_theft_report_id = excluded.selected_theft_report_id,
       updated_at = now()`,
    [input.telegramUserId, input.pendingAction, input.selectedWalletId ?? null, input.selectedTheftReportId ?? null]
  );
}

export async function clearTelegramUserPendingAction(db: Db, telegramUserId: string): Promise<boolean> {
  const result = await db.query(
    `update telegram_user_sessions
     set pending_action = null,
       selected_wallet_id = null,
       selected_theft_report_id = null,
       updated_at = now()
     where telegram_user_id = $1`,
    [telegramUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertTheftReportDraft(db: Db, input: TheftReportDraftInput): Promise<TheftReport | null> {
  const id = input.id ?? createId();
  const result = await db.query(
    `insert into theft_reports (
       id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, deposit_address, deposit_amount_usdt
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       tx_hash = excluded.tx_hash,
       victim_address = excluded.victim_address,
       reported_scam_address = excluded.reported_scam_address,
       amount_raw = excluded.amount_raw,
       amount_usdt = excluded.amount_usdt,
       deposit_address = excluded.deposit_address,
       deposit_amount_usdt = excluded.deposit_amount_usdt,
       status = 'draft',
       updated_at = now()
     where theft_reports.telegram_user_id = excluded.telegram_user_id
       and theft_reports.status in ('draft', 'awaiting_deposit')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [
      id,
      input.telegramUserId,
      input.txHash,
      input.victimAddress,
      input.reportedScamAddress,
      input.amountRaw,
      input.amountUsdt,
      input.depositAddress,
      input.depositAmountUsdt
    ]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function getTheftReport(db: Db, id: string): Promise<TheftReport | null> {
  const result = await db.query(
    `select id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at
     from theft_reports
     where id = $1`,
    [id]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function updateTheftReportComment(
  db: Db,
  input: { id: string; telegramUserId: string; comment: string }
): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set comment = $3,
       updated_at = now()
     where id = $1 and telegram_user_id = $2
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId, input.comment.trim().slice(0, 1000)]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function markTheftReportAwaitingDeposit(
  db: Db,
  input: { id: string; telegramUserId: string }
): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set status = 'awaiting_deposit',
       updated_at = now()
     where id = $1
       and telegram_user_id = $2
       and status in ('draft', 'awaiting_deposit')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function confirmTheftReportDeposit(
  db: Db,
  input: { id: string; telegramUserId: string }
): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set status = 'documents_requested',
       updated_at = now()
     where id = $1
       and telegram_user_id = $2
       and status in ('awaiting_deposit', 'deposit_confirmed', 'documents_requested')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function cancelTheftReport(db: Db, input: { id: string; telegramUserId: string }): Promise<TheftReport | null> {
  const result = await db.query(
    `update theft_reports
     set status = 'cancelled',
       updated_at = now()
     where id = $1
       and telegram_user_id = $2
       and status in ('draft', 'awaiting_deposit')
     returning id, telegram_user_id, tx_hash, victim_address, reported_scam_address,
       amount_raw, amount_usdt, comment, status, deposit_address, deposit_amount_usdt,
       created_at, updated_at`,
    [input.id, input.telegramUserId]
  );
  return result.rows[0] ? mapTheftReportRow(result.rows[0]) : null;
}

export async function addCustomerAlertRecipient(
  db: Db,
  input: { ownerTelegramUserId: string; recipientTelegramUserId: string; alertMode: CustomerAlertMode }
): Promise<CustomerAlertRecipient> {
  parseCustomerAlertMode(input.alertMode);
  const result = await db.query(
    `insert into customer_alert_recipients (owner_telegram_user_id, recipient_telegram_user_id, alert_mode)
     values ($1, $2, $3)
     on conflict (owner_telegram_user_id, recipient_telegram_user_id) do update set
       alert_mode = excluded.alert_mode,
       updated_at = now()
     returning owner_telegram_user_id, recipient_telegram_user_id, alert_mode, created_at, updated_at`,
    [input.ownerTelegramUserId, input.recipientTelegramUserId, input.alertMode]
  );
  return mapCustomerAlertRecipientRow(result.rows[0]);
}

export async function upsertCustomerAlertRecipient(
  db: Db,
  input: { ownerTelegramUserId: string; recipientTelegramUserId: string; alertMode?: CustomerAlertMode }
): Promise<CustomerAlertRecipient> {
  return addCustomerAlertRecipient(db, {
    ownerTelegramUserId: input.ownerTelegramUserId,
    recipientTelegramUserId: input.recipientTelegramUserId,
    alertMode: input.alertMode ?? "suspicious_only"
  });
}

export async function removeCustomerAlertRecipient(
  db: Db,
  input: { ownerTelegramUserId: string; recipientTelegramUserId: string }
): Promise<boolean> {
  const result = await db.query(
    `delete from customer_alert_recipients
     where owner_telegram_user_id = $1 and recipient_telegram_user_id = $2`,
    [input.ownerTelegramUserId, input.recipientTelegramUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listCustomerAlertRecipients(db: Db, ownerTelegramUserId: string): Promise<CustomerAlertRecipient[]> {
  const result = await db.query(
    `select owner_telegram_user_id, recipient_telegram_user_id, alert_mode, created_at, updated_at
     from customer_alert_recipients
     where owner_telegram_user_id = $1
     order by created_at asc`,
    [ownerTelegramUserId]
  );
  return result.rows.map(mapCustomerAlertRecipientRow);
}

export async function addWatchedWallet(db: Db, input: { telegramUserId: string; address: string }): Promise<WatchedWallet> {
  const result = await db.query(
    `insert into watched_wallets (id, telegram_user_id, address, alert_mode, digest_interval_minutes)
     values ($1, $2, $3, 'realtime', 10)
     on conflict (telegram_user_id, address) do update set address = excluded.address
     returning id, telegram_user_id, address, created_at, alert_mode, digest_interval_minutes`,
    [createId(), input.telegramUserId, input.address]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: null,
    address: row.address,
    createdAt: row.created_at,
    alertMode: parseWalletAlertMode(row.alert_mode ?? "realtime"),
    digestIntervalMinutes: row.digest_interval_minutes ?? 10
  };
}

export async function listWatchedWallets(db: Db, telegramUserId?: string): Promise<WatchedWallet[]> {
  const query = telegramUserId
    ? `select w.id, w.telegram_user_id, u.username, u.locale, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       where w.telegram_user_id = $1 order by w.created_at asc`
    : `select w.id, w.telegram_user_id, u.username, u.locale, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       order by w.created_at asc`;
  const result = await db.query(query, telegramUserId ? [telegramUserId] : []);
  return result.rows.map(mapWatchedWalletFields);
}

export async function getWatchedWalletByAddress(db: Db, address: string): Promise<WatchedWallet | null> {
  const result = await db.query(
    `select w.id, w.telegram_user_id, u.username, u.locale, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
     from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
     where w.address = $1
     order by w.created_at asc
     limit 1`,
    [address]
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapWatchedWalletFields(row);
}

export async function updateWatchedWalletAlertMode(
  db: Db,
  input: { telegramUserId: string; address: string; alertMode: WalletAlertMode; digestIntervalMinutes: number }
): Promise<boolean> {
  const result = await db.query(
    `update watched_wallets
     set alert_mode = $3,
       digest_interval_minutes = $4
     where telegram_user_id = $1 and address = $2`,
    [input.telegramUserId, input.address, input.alertMode, input.digestIntervalMinutes]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function removeWatchedWallet(db: Db, input: { telegramUserId: string; address: string }): Promise<boolean> {
  const result = await db.query(
    `delete from watched_wallets where telegram_user_id = $1 and address = $2`,
    [input.telegramUserId, input.address]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function watchedWalletExists(db: Db, watchedWalletId: string): Promise<boolean> {
  const result = await db.query(`select 1 from watched_wallets where id = $1`, [watchedWalletId]);
  return (result.rowCount ?? 0) > 0;
}

export async function hasObservedTransaction(db: Db, txHash: string, watchedWalletId?: string): Promise<boolean> {
  const result = watchedWalletId
    ? await db.query(`select 1 from observed_transactions where tx_hash = $1 and watched_wallet_id = $2`, [txHash, watchedWalletId])
    : await db.query(`select 1 from observed_transactions where tx_hash = $1 limit 1`, [txHash]);
  return result.rowCount === 1;
}

export async function getWalletPollState(db: Db, watchedWalletId: string): Promise<WalletPollState | null> {
  const result = await db.query(
    `select watched_wallet_id, last_seen_block_ts, last_seen_tx_hash,
       backfill_anchor_block_ts, backfill_anchor_tx_hash, backfill_next_start,
       backfill_complete, last_successful_poll_at, last_poll_event_count,
       last_poll_new_count, last_poll_error, updated_at
     from wallet_poll_state
     where watched_wallet_id = $1`,
    [watchedWalletId]
  );
  return result.rows[0] ? mapWalletPollStateRow(result.rows[0]) : null;
}

export async function upsertWalletPollState(
  db: Db,
  input: {
    watchedWalletId: string;
    lastSeenBlockTs?: Date | null;
    lastSeenTxHash?: string | null;
    backfillAnchorBlockTs?: Date | null;
    backfillAnchorTxHash?: string | null;
    backfillNextStart?: number;
    backfillComplete?: boolean;
    lastSuccessfulPollAt?: Date | null;
    lastPollEventCount?: number;
    lastPollNewCount?: number;
    lastPollError?: string | null;
  }
): Promise<void> {
  const columns = ["watched_wallet_id"];
  const values = ["$1"];
  const updates = ["updated_at = now()"];
  const params: unknown[] = [input.watchedWalletId];

  function addField(key: keyof typeof input, column: string, value: unknown): void {
    if (!(key in input)) return;
    params.push(value);
    columns.push(column);
    values.push(`$${params.length}`);
    updates.push(`${column} = excluded.${column}`);
  }

  addField("lastSeenBlockTs", "last_seen_block_ts", input.lastSeenBlockTs ?? null);
  addField("lastSeenTxHash", "last_seen_tx_hash", input.lastSeenTxHash ?? null);
  addField("backfillAnchorBlockTs", "backfill_anchor_block_ts", input.backfillAnchorBlockTs ?? null);
  addField("backfillAnchorTxHash", "backfill_anchor_tx_hash", input.backfillAnchorTxHash ?? null);
  addField("backfillNextStart", "backfill_next_start", input.backfillNextStart ?? 0);
  addField("backfillComplete", "backfill_complete", input.backfillComplete ?? false);
  addField("lastSuccessfulPollAt", "last_successful_poll_at", input.lastSuccessfulPollAt ?? null);
  addField("lastPollEventCount", "last_poll_event_count", input.lastPollEventCount ?? 0);
  addField("lastPollNewCount", "last_poll_new_count", input.lastPollNewCount ?? 0);
  addField("lastPollError", "last_poll_error", input.lastPollError === null || input.lastPollError === undefined ? null : boundedPollError(input.lastPollError));

  await db.query(
    `insert into wallet_poll_state (${columns.join(", ")})
     values (${values.join(", ")})
     on conflict (watched_wallet_id) do update set
       ${updates.join(", ")}`,
    params
  );
}

export async function updateWalletPollState(
  db: Db,
  input: {
    watchedWalletId: string;
    lastSeenBlockTs?: Date | null;
    lastSeenTxHash?: string | null;
    backfillAnchorBlockTs?: Date | null;
    backfillAnchorTxHash?: string | null;
    backfillNextStart?: number;
    backfillComplete?: boolean;
    lastSuccessfulPollAt?: Date | null;
    lastPollEventCount?: number;
    lastPollNewCount?: number;
    lastPollError?: string | null;
  }
): Promise<boolean> {
  const assignments: string[] = [];
  const params: unknown[] = [input.watchedWalletId];

  if ("lastSeenBlockTs" in input) {
    params.push(input.lastSeenBlockTs ?? null);
    assignments.push(`last_seen_block_ts = $${params.length}`);
  }
  if ("lastSeenTxHash" in input) {
    params.push(input.lastSeenTxHash ?? null);
    assignments.push(`last_seen_tx_hash = $${params.length}`);
  }
  if ("backfillAnchorBlockTs" in input) {
    params.push(input.backfillAnchorBlockTs ?? null);
    assignments.push(`backfill_anchor_block_ts = $${params.length}`);
  }
  if ("backfillAnchorTxHash" in input) {
    params.push(input.backfillAnchorTxHash ?? null);
    assignments.push(`backfill_anchor_tx_hash = $${params.length}`);
  }
  if ("backfillNextStart" in input) {
    params.push(input.backfillNextStart ?? 0);
    assignments.push(`backfill_next_start = $${params.length}`);
  }
  if ("backfillComplete" in input) {
    params.push(input.backfillComplete);
    assignments.push(`backfill_complete = $${params.length}`);
  }
  if ("lastSuccessfulPollAt" in input) {
    params.push(input.lastSuccessfulPollAt ?? null);
    assignments.push(`last_successful_poll_at = $${params.length}`);
  }
  if ("lastPollEventCount" in input) {
    params.push(input.lastPollEventCount ?? 0);
    assignments.push(`last_poll_event_count = $${params.length}`);
  }
  if ("lastPollNewCount" in input) {
    params.push(input.lastPollNewCount ?? 0);
    assignments.push(`last_poll_new_count = $${params.length}`);
  }
  if ("lastPollError" in input) {
    params.push(input.lastPollError === null || input.lastPollError === undefined ? null : boundedPollError(input.lastPollError));
    assignments.push(`last_poll_error = $${params.length}`);
  }

  const setClause = [...assignments, "updated_at = now()"].join(", ");
  const result = await db.query(`update wallet_poll_state set ${setClause} where watched_wallet_id = $1`, params);
  return (result.rowCount ?? 0) > 0;
}

export async function recordWalletPollSuccess(
  db: Db,
  input: {
    watchedWalletId: string;
    lastSeenBlockTs: Date | null;
    lastSeenTxHash: string | null;
    backfillAnchorBlockTs: Date | null;
    backfillAnchorTxHash: string | null;
    backfillNextStart: number;
    backfillComplete: boolean;
    lastSuccessfulPollAt: Date;
    eventCount: number;
    newCount: number;
  }
): Promise<void> {
  await db.query(
    `insert into wallet_poll_state (
       watched_wallet_id,
       last_seen_block_ts,
       last_seen_tx_hash,
       backfill_anchor_block_ts,
       backfill_anchor_tx_hash,
       backfill_next_start,
       backfill_complete,
       last_successful_poll_at,
       last_poll_event_count,
       last_poll_new_count,
       last_poll_error
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null)
     on conflict (watched_wallet_id) do update set
       last_seen_block_ts = excluded.last_seen_block_ts,
       last_seen_tx_hash = excluded.last_seen_tx_hash,
       backfill_anchor_block_ts = excluded.backfill_anchor_block_ts,
       backfill_anchor_tx_hash = excluded.backfill_anchor_tx_hash,
       backfill_next_start = excluded.backfill_next_start,
       backfill_complete = excluded.backfill_complete,
       last_successful_poll_at = excluded.last_successful_poll_at,
       last_poll_event_count = excluded.last_poll_event_count,
       last_poll_new_count = excluded.last_poll_new_count,
       last_poll_error = null,
       updated_at = now()`,
    [
      input.watchedWalletId,
      input.lastSeenBlockTs,
      input.lastSeenTxHash,
      input.backfillAnchorBlockTs,
      input.backfillAnchorTxHash,
      input.backfillNextStart,
      input.backfillComplete,
      input.lastSuccessfulPollAt,
      input.eventCount,
      input.newCount
    ]
  );
}

export async function recordWalletPollFailure(db: Db, input: { watchedWalletId: string; error: string }): Promise<void> {
  await db.query(
    `insert into wallet_poll_state (watched_wallet_id, last_poll_error)
     values ($1, $2)
     on conflict (watched_wallet_id) do update set
       last_poll_error = excluded.last_poll_error,
       updated_at = now()`,
    [input.watchedWalletId, boundedPollError(input.error)]
  );
}

export async function getApprovalPollState(db: Db, watchedWalletId: string): Promise<WalletApprovalPollState | null> {
  const result = await db.query(
    `select watched_wallet_id, last_seen_approval_ts, last_seen_tx_hash,
       last_successful_poll_at, last_error, updated_at
     from wallet_approval_poll_state
     where watched_wallet_id = $1`,
    [watchedWalletId]
  );
  return result.rows[0] ? mapWalletApprovalPollStateRow(result.rows[0]) : null;
}

export async function recordApprovalPollSuccess(
  db: Db,
  input: {
    watchedWalletId: string;
    lastSeenApprovalTs: Date | null;
    lastSeenTxHash: string | null;
    lastSuccessfulPollAt: Date;
  }
): Promise<void> {
  await db.query(
    `insert into wallet_approval_poll_state (
       watched_wallet_id,
       last_seen_approval_ts,
       last_seen_tx_hash,
       last_successful_poll_at,
       last_error
     )
     values ($1, $2, $3, $4, null)
     on conflict (watched_wallet_id) do update set
       last_seen_approval_ts = excluded.last_seen_approval_ts,
       last_seen_tx_hash = excluded.last_seen_tx_hash,
       last_successful_poll_at = excluded.last_successful_poll_at,
       last_error = null,
       updated_at = now()`,
    [input.watchedWalletId, input.lastSeenApprovalTs, input.lastSeenTxHash, input.lastSuccessfulPollAt]
  );
}

export async function recordApprovalPollFailure(db: Db, input: { watchedWalletId: string; error: string }): Promise<void> {
  await db.query(
    `insert into wallet_approval_poll_state (watched_wallet_id, last_error)
     values ($1, $2)
     on conflict (watched_wallet_id) do update set
       last_error = excluded.last_error,
       updated_at = now()`,
    [input.watchedWalletId, boundedPollError(input.error)]
  );
}

export async function getAddressMetadata(db: Db, address: string, now = new Date()): Promise<AddressMetadata | null> {
  const result = await db.query(
    `select address, source, name, tag, is_contract, verified, account_type, raw_json, fetched_at, expires_at
     from address_metadata
     where address = $1 and expires_at > $2
     limit 1`,
    [address, now]
  );
  return result.rows[0] ? mapAddressMetadataRow(result.rows[0]) : null;
}

export async function getStaleAddressMetadata(db: Db, address: string): Promise<AddressMetadata | null> {
  const result = await db.query(
    `select address, source, name, tag, is_contract, verified, account_type, raw_json, fetched_at, expires_at
     from address_metadata
     where address = $1
     order by fetched_at desc
     limit 1`,
    [address]
  );
  return result.rows[0] ? mapAddressMetadataRow(result.rows[0]) : null;
}

export async function upsertAddressMetadata(db: Db, input: AddressMetadata): Promise<void> {
  await db.query(
    `insert into address_metadata (
       address, source, name, tag, is_contract, verified, account_type, raw_json, fetched_at, expires_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (address) do update set
       source = excluded.source,
       name = excluded.name,
       tag = excluded.tag,
       is_contract = excluded.is_contract,
       verified = excluded.verified,
       account_type = excluded.account_type,
       raw_json = excluded.raw_json,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
    [
      input.address,
      input.source,
      input.name,
      input.tag,
      input.isContract,
      input.verified,
      input.accountType,
      JSON.stringify(input.rawJson),
      input.fetchedAt,
      input.expiresAt
    ]
  );
}

export async function getContractIntelligenceProfile(
  db: Db,
  contractAddress: string,
  now = new Date()
): Promise<ContractIntelligenceProfile | null> {
  const result = await db.query(
    `select contract_address, provider_tags, public_tags, is_verified, verify_status, source_status,
       contract_created_at, contract_age_days, tx_count::text, recent_call_count::text,
       total_call_count::text, total_caller_count::text, top_methods, top_callers, method_map,
       provider_risk, raw_payload, fetched_at, expires_at
     from contract_intelligence_profiles
     where contract_address = $1 and expires_at > $2
     limit 1`,
    [contractAddress, now]
  );
  return result.rows[0] ? mapContractIntelligenceProfileRow(result.rows[0]) : null;
}

export async function upsertContractIntelligenceProfile(db: Db, input: ContractIntelligenceProfile): Promise<void> {
  await db.query(
    `insert into contract_intelligence_profiles (
       contract_address,
       provider_tags,
       public_tags,
       is_verified,
       verify_status,
       source_status,
       contract_created_at,
       contract_age_days,
       tx_count,
       recent_call_count,
       total_call_count,
       total_caller_count,
       top_methods,
       top_callers,
       method_map,
       provider_risk,
       raw_payload,
       fetched_at,
       expires_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     on conflict (contract_address) do update set
       provider_tags = excluded.provider_tags,
       public_tags = excluded.public_tags,
       is_verified = excluded.is_verified,
       verify_status = excluded.verify_status,
       source_status = excluded.source_status,
       contract_created_at = excluded.contract_created_at,
       contract_age_days = excluded.contract_age_days,
       tx_count = excluded.tx_count,
       recent_call_count = excluded.recent_call_count,
       total_call_count = excluded.total_call_count,
       total_caller_count = excluded.total_caller_count,
       top_methods = excluded.top_methods,
       top_callers = excluded.top_callers,
       method_map = excluded.method_map,
       provider_risk = excluded.provider_risk,
       raw_payload = excluded.raw_payload,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [
      input.contractAddress,
      JSON.stringify(input.providerTags),
      JSON.stringify(input.publicTags),
      input.isVerified,
      input.verifyStatus,
      input.sourceStatus,
      input.contractCreatedAt,
      input.contractAgeDays,
      input.txCount,
      input.recentCallCount,
      input.totalCallCount,
      input.totalCallerCount,
      JSON.stringify(input.topMethods),
      JSON.stringify(input.topCallers),
      JSON.stringify(input.methodMap),
      input.providerRisk,
      JSON.stringify(input.rawPayload),
      input.fetchedAt,
      input.expiresAt
    ]
  );
}

export async function getContractLlmVerdictCache(
  db: Db,
  input: ContractLlmVerdictCacheLookup
): Promise<ContractLlmVerdictCacheRecord | null> {
  const params: unknown[] = [input.contractAddress, input.profileHash, input.policyVersion, input.model, input.now];
  const scopeClause = input.cacheScope
    ? `and cache_scope = $${params.push(input.cacheScope)}`
    : "";
  const flowContextClause = input.flowContextHash !== undefined
    ? `and flow_context_hash is not distinct from $${params.push(input.flowContextHash)}`
    : "";
  const result = await db.query(
    `select id, contract_address, profile_hash, contract_fingerprint_hash, cache_scope, flow_context_hash,
       case_file_hash, policy_version,
       provider_label, model, verdict_json, request_case_hash, response_json,
       error, latency_ms, created_at, expires_at, updated_at
     from contract_llm_verdict_cache
     where contract_address = $1
       and profile_hash = $2
       and policy_version = $3
       and model = $4
       and expires_at > $5
       ${scopeClause}
       ${flowContextClause}
     limit 1`,
    params
  );
  return result.rows[0] ? mapContractLlmVerdictCacheRow(result.rows[0]) : null;
}

export async function getContractLlmVerdictCacheByFingerprint(
  db: Db,
  input: ContractLlmVerdictFingerprintCacheLookup
): Promise<ContractLlmVerdictCacheRecord | null> {
  const cacheScope = input.cacheScope ?? "address_flow";
  const result = await db.query(
    `select id, contract_address, profile_hash, contract_fingerprint_hash, cache_scope, flow_context_hash,
       case_file_hash, policy_version,
       provider_label, model, verdict_json, request_case_hash, response_json,
       error, latency_ms, created_at, expires_at, updated_at
     from contract_llm_verdict_cache
     where contract_fingerprint_hash = $1
       and cache_scope = $2
       and flow_context_hash is not distinct from $3
       and policy_version = $4
       and model = $5
       and expires_at > $6
       and error is null
     order by updated_at desc
     limit 1`,
    [input.contractFingerprintHash, cacheScope, input.flowContextHash ?? null, input.policyVersion, input.model, input.now]
  );
  return result.rows[0] ? mapContractLlmVerdictCacheRow(result.rows[0]) : null;
}

export async function upsertContractLlmVerdictCache(
  db: Db,
  input: ContractLlmVerdictCacheRecord
): Promise<void> {
  await db.query(
    `insert into contract_llm_verdict_cache (
       id,
       contract_address,
       profile_hash,
       contract_fingerprint_hash,
       cache_scope,
       flow_context_hash,
       case_file_hash,
       policy_version,
       provider_label,
       model,
       verdict_json,
       request_case_hash,
       response_json,
       error,
       latency_ms,
       created_at,
       expires_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     on conflict (id) do update set
       contract_address = excluded.contract_address,
       profile_hash = excluded.profile_hash,
       contract_fingerprint_hash = excluded.contract_fingerprint_hash,
       cache_scope = excluded.cache_scope,
       flow_context_hash = excluded.flow_context_hash,
       case_file_hash = excluded.case_file_hash,
       policy_version = excluded.policy_version,
       provider_label = excluded.provider_label,
       model = excluded.model,
       verdict_json = excluded.verdict_json,
       request_case_hash = excluded.request_case_hash,
       response_json = excluded.response_json,
       error = excluded.error,
       latency_ms = excluded.latency_ms,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    [
      input.id,
      input.contractAddress,
      input.profileHash,
      input.contractFingerprintHash,
      input.cacheScope ?? "address_flow",
      input.flowContextHash ?? null,
      input.caseFileHash,
      input.policyVersion,
      input.providerLabel,
      input.model,
      JSON.stringify(input.verdict),
      input.requestCaseHash,
      JSON.stringify(input.responseJson),
      input.error,
      input.latencyMs,
      input.createdAt,
      input.expiresAt,
      input.updatedAt
    ]
  );
}

export async function getWalletDashboardSnapshot(db: Db, watchedWalletId: string): Promise<WalletDashboardSnapshot | null> {
  const result = await db.query(
    `select watched_wallet_id, trx_balance_sun, usdt_balance_micro, wallet_created_at,
       total_tx_count, incoming_tx_count, outgoing_tx_count, thirty_day_in_usdt,
       thirty_day_out_usdt, thirty_day_transfer_count, thirty_day_fee_sun,
       trx_usd_price, analytics_partial, refreshed_at, last_error
     from wallet_dashboard_snapshots
     where watched_wallet_id = $1`,
    [watchedWalletId]
  );
  return result.rows[0] ? mapWalletDashboardSnapshotRow(result.rows[0]) : null;
}

export async function upsertWalletDashboardSnapshot(db: Db, input: WalletDashboardSnapshot): Promise<void> {
  await db.query(
    `insert into wallet_dashboard_snapshots (
       watched_wallet_id,
       trx_balance_sun,
       usdt_balance_micro,
       wallet_created_at,
       total_tx_count,
       incoming_tx_count,
       outgoing_tx_count,
       thirty_day_in_usdt,
       thirty_day_out_usdt,
       thirty_day_transfer_count,
       thirty_day_fee_sun,
       trx_usd_price,
       analytics_partial,
       refreshed_at,
       last_error
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (watched_wallet_id) do update set
       trx_balance_sun = excluded.trx_balance_sun,
       usdt_balance_micro = excluded.usdt_balance_micro,
       wallet_created_at = excluded.wallet_created_at,
       total_tx_count = excluded.total_tx_count,
       incoming_tx_count = excluded.incoming_tx_count,
       outgoing_tx_count = excluded.outgoing_tx_count,
       thirty_day_in_usdt = excluded.thirty_day_in_usdt,
       thirty_day_out_usdt = excluded.thirty_day_out_usdt,
       thirty_day_transfer_count = excluded.thirty_day_transfer_count,
       thirty_day_fee_sun = excluded.thirty_day_fee_sun,
       trx_usd_price = excluded.trx_usd_price,
       analytics_partial = excluded.analytics_partial,
       refreshed_at = excluded.refreshed_at,
       last_error = excluded.last_error`,
    [
      input.watchedWalletId,
      input.trxBalanceSun,
      input.usdtBalanceMicro,
      input.walletCreatedAt,
      input.totalTxCount,
      input.incomingTxCount,
      input.outgoingTxCount,
      input.thirtyDayInUsdt,
      input.thirtyDayOutUsdt,
      input.thirtyDayTransferCount,
      input.thirtyDayFeeSun,
      input.trxUsdPrice,
      input.analyticsPartial,
      input.refreshedAt,
      input.lastError
    ]
  );
}

export async function saveObservedTransaction(db: Db, input: { watchedWalletId: string; event: TronTransferEvent }): Promise<void> {
  await db.query(
    `insert into observed_transactions (tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tx_hash, watched_wallet_id) do nothing`,
    [input.event.txHash, input.watchedWalletId, input.event.sender, input.event.receiver, input.event.token, input.event.amount, input.event.timestamp]
  );
}

export async function claimObservedTransactionForUserAlert(
  db: Db,
  input: { watchedWalletId: string; event: TronTransferEvent }
): Promise<boolean> {
  const result = await db.query(
    `insert into observed_transactions (
       tx_hash,
       watched_wallet_id,
       sender,
       receiver,
       token,
       amount,
       timestamp,
       user_alert_status,
       user_alert_attempts,
       user_alert_updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, 'sending', 0, now())
     on conflict (tx_hash, watched_wallet_id) do nothing`,
    [input.event.txHash, input.watchedWalletId, input.event.sender, input.event.receiver, input.event.token, input.event.amount, input.event.timestamp]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function claimUserAlertsForRetry(
  db: Db,
  input: { limit: number; staleSendingBefore: Date }
): Promise<ObservedTransactionUserAlert[]> {
  const result = await db.query(
    `with claimed as (
       select tx_hash, watched_wallet_id
       from observed_transactions
       where user_alert_status in ('pending', 'failed')
          or (user_alert_status = 'sending' and user_alert_updated_at < $2)
          or (user_alert_status = 'analyzing' and user_alert_updated_at < $2)
       order by coalesce(user_alert_updated_at, created_at) asc
       limit $1
       for update skip locked
     )
     update observed_transactions tx
     set user_alert_status = 'sending',
       user_alert_updated_at = now()
     from claimed
     where tx.tx_hash = claimed.tx_hash and tx.watched_wallet_id = claimed.watched_wallet_id
     returning tx.tx_hash, tx.watched_wallet_id, tx.sender, tx.receiver, tx.token, tx.amount, tx.timestamp,
       tx.user_alert_status, tx.user_alert_attempts, tx.user_alert_last_error, tx.user_alert_updated_at, tx.created_at`,
    [input.limit, input.staleSendingBefore]
  );
  return result.rows.map(mapObservedTransactionUserAlertRow);
}

export async function markUserAlertSent(db: Db, input: { txHash: string; watchedWalletId: string }): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'sent',
       user_alert_last_error = null,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2
       and (user_alert_status = 'sending' or user_alert_status = 'analyzing')`,
    [input.txHash, input.watchedWalletId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markUserAlertFailed(
  db: Db,
  input: { txHash: string; watchedWalletId: string; error: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'failed',
       user_alert_attempts = user_alert_attempts + 1,
       user_alert_last_error = $3,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2
       and (user_alert_status = 'sending' or user_alert_status = 'analyzing')`,
    [input.txHash, input.watchedWalletId, boundedUserAlertError(input.error)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markUserAlertSkipped(
  db: Db,
  input: { txHash: string; watchedWalletId: string; reason: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'skipped',
       user_alert_last_error = $3,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2
       and (user_alert_status = 'sending' or user_alert_status = 'analyzing')`,
    [input.txHash, input.watchedWalletId, boundedUserAlertError(input.reason)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markUserAlertAnalyzing(
  db: Db,
  input: { txHash: string; watchedWalletId: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set user_alert_status = 'analyzing',
       user_alert_last_error = null,
       user_alert_updated_at = now()
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
    [input.txHash, input.watchedWalletId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getObservedTransactionForIncomingDeposit(
  db: Db,
  input: { txHash: string; watchedWalletId: string }
): Promise<ObservedTransactionUserAlert | null> {
  const result = await db.query(
    `select tx_hash, watched_wallet_id, sender, receiver, token, amount, timestamp,
       user_alert_status, user_alert_attempts, user_alert_last_error, user_alert_updated_at, created_at
     from observed_transactions
     where tx_hash = $1 and watched_wallet_id = $2`,
    [input.txHash, input.watchedWalletId]
  );
  return result.rows[0] ? mapObservedTransactionUserAlertRow(result.rows[0]) : null;
}

export async function recordObservedTransactionRisk(
  db: Db,
  input: { txHash: string; watchedWalletId: string; report: RiskReport }
): Promise<boolean> {
  const result = await db.query(
    `update observed_transactions
     set risk_level = $3,
       risk_score = $4,
       risk_reasons = $5
     where tx_hash = $1 and watched_wallet_id = $2`,
    [input.txHash, input.watchedWalletId, input.report.level, input.report.score, JSON.stringify(input.report.reasons)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertWalletApproval(
  db: Db,
  input: {
    watchedWalletId: string;
    tokenContract: string;
    spenderAddress: string;
    amountRaw: string;
    isUnlimited: boolean;
    currentAllowanceRaw?: string;
    spenderType: WalletApprovalSpenderType;
    status?: WalletApprovalStatus;
    lastApprovalTxHash: string | null;
    lastApprovalAt: Date | null;
    riskLevel: RiskLevel;
    riskScore: number;
    riskReasons: RiskReason[];
    lastAlertedTxHash?: string | null;
  }
): Promise<void> {
  parseWalletApprovalSpenderType(input.spenderType);
  if (input.status) parseWalletApprovalStatus(input.status);
  await db.query(
    `insert into wallet_approvals (
       watched_wallet_id,
       token_contract,
       spender_address,
       amount_raw,
       is_unlimited,
       current_allowance_raw,
       spender_type,
       status,
       last_approval_tx_hash,
       last_approval_at,
       risk_level,
       risk_score,
       risk_reasons,
       last_alerted_tx_hash
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (watched_wallet_id, token_contract, spender_address) do update set
       amount_raw = excluded.amount_raw,
       is_unlimited = excluded.is_unlimited,
       current_allowance_raw = excluded.current_allowance_raw,
       spender_type = excluded.spender_type,
       status = excluded.status,
       last_approval_tx_hash = excluded.last_approval_tx_hash,
       last_approval_at = excluded.last_approval_at,
       risk_level = excluded.risk_level,
       risk_score = excluded.risk_score,
       risk_reasons = excluded.risk_reasons,
       last_alerted_tx_hash = coalesce(excluded.last_alerted_tx_hash, wallet_approvals.last_alerted_tx_hash),
       updated_at = now()`,
    [
      input.watchedWalletId,
      input.tokenContract,
      input.spenderAddress,
      input.amountRaw,
      input.isUnlimited,
      input.currentAllowanceRaw ?? input.amountRaw,
      input.spenderType,
      input.status ?? "active",
      input.lastApprovalTxHash,
      input.lastApprovalAt,
      input.riskLevel,
      input.riskScore,
      JSON.stringify(input.riskReasons),
      input.lastAlertedTxHash ?? null
    ]
  );
}

export async function claimObservedApprovalEvent(
  db: Db,
  input: {
    approvalTxHash: string;
    watchedWalletId: string;
    ownerAddress: string;
    tokenContract: string;
    spenderAddress: string;
    spenderType: WalletApprovalSpenderType;
    amountRaw: string;
    isUnlimited: boolean;
    approvalAt: Date;
  }
): Promise<boolean> {
  parseWalletApprovalSpenderType(input.spenderType);
  const result = await db.query(
    `insert into observed_approval_events (
       approval_tx_hash,
       watched_wallet_id,
       owner_address,
       token_contract,
       spender_address,
       spender_type,
       amount_raw,
       is_unlimited,
       approval_at,
       owner_alert_status,
       owner_alert_attempts,
       owner_alert_updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sending', 0, now())
     on conflict (approval_tx_hash, watched_wallet_id, owner_address, token_contract, spender_address) do update
       set owner_alert_status = 'sending',
         owner_alert_attempts = observed_approval_events.owner_alert_attempts + 1,
         owner_alert_last_error = null,
         owner_alert_updated_at = now()
       where observed_approval_events.owner_alert_status = 'failed'
         or (
           observed_approval_events.owner_alert_status = 'sending'
           and observed_approval_events.owner_alert_updated_at < now() - interval '5 minutes'
         )
     returning approval_tx_hash`,
    [
      input.approvalTxHash,
      input.watchedWalletId,
      input.ownerAddress,
      input.tokenContract,
      input.spenderAddress,
      input.spenderType,
      input.amountRaw,
      input.isUnlimited,
      input.approvalAt
    ]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function recordApprovalRisk(
  db: Db,
  input: { approvalTxHash: string; watchedWalletId: string; report: RiskReport }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set risk_level = $3,
       risk_score = $4,
       risk_reasons = $5
     where approval_tx_hash = $1 and watched_wallet_id = $2`,
    [input.approvalTxHash, input.watchedWalletId, input.report.level, input.report.score, JSON.stringify(input.report.reasons)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function claimObservedApprovalDrainEvent(
  db: Db,
  input: {
    id: string;
    watchedWalletId: string;
    approvalTxHash: string;
    transferTxHash: string;
    ownerAddress: string;
    spenderAddress: string;
    receiverAddress: string;
    tokenContract: string;
    amountRaw: string;
    callerAddress: string;
    method: string;
    approvalAt: Date;
    transferAt: Date;
    timeToTransferMs: number;
    spenderType: WalletApprovalSpenderType;
    receiverType: WalletApprovalSpenderType;
    report: RiskReport;
    rawEvidenceId: string | null;
  }
): Promise<boolean> {
  parseWalletApprovalSpenderType(input.spenderType);
  parseWalletApprovalSpenderType(input.receiverType);
  const result = await db.query(
    `insert into observed_approval_drain_events (
       id,
       watched_wallet_id,
       approval_tx_hash,
       transfer_tx_hash,
       owner_address,
       spender_address,
       receiver_address,
       token_contract,
       amount_raw,
       caller_address,
       method,
       approval_at,
       transfer_at,
       time_to_transfer_ms,
       spender_type,
       receiver_type,
       observed_mode,
       risk_level,
       risk_score,
       risk_reasons,
       raw_evidence_id
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'shadow', $17, $18, $19, $20)
     on conflict (approval_tx_hash, watched_wallet_id, transfer_tx_hash, spender_address, receiver_address) do nothing`,
    [
      input.id,
      input.watchedWalletId,
      input.approvalTxHash,
      input.transferTxHash,
      input.ownerAddress,
      input.spenderAddress,
      input.receiverAddress,
      input.tokenContract,
      input.amountRaw,
      input.callerAddress,
      input.method,
      input.approvalAt,
      input.transferAt,
      input.timeToTransferMs,
      input.spenderType,
      input.receiverType,
      input.report.level,
      input.report.score,
      JSON.stringify(input.report.reasons),
      input.rawEvidenceId
    ]
  );
  return (result.rowCount ?? 0) === 1;
}

export async function markApprovalOwnerAlertSent(
  db: Db,
  input: { approvalTxHash: string; watchedWalletId: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set owner_alert_status = 'sent',
       owner_alert_last_error = null,
       owner_alert_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2 and owner_alert_status = 'sending'`,
    [input.approvalTxHash, input.watchedWalletId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markApprovalOwnerAlertSkipped(
  db: Db,
  input: { approvalTxHash: string; watchedWalletId: string; reason: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set owner_alert_status = 'skipped',
       owner_alert_last_error = $3,
       owner_alert_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2 and owner_alert_status = 'sending'`,
    [input.approvalTxHash, input.watchedWalletId, boundedUserAlertError(input.reason)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markApprovalOwnerAlertFailed(
  db: Db,
  input: { approvalTxHash: string; watchedWalletId: string; error: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set owner_alert_status = 'failed',
       owner_alert_attempts = owner_alert_attempts + 1,
       owner_alert_last_error = $3,
       owner_alert_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2 and owner_alert_status = 'sending'`,
    [input.approvalTxHash, input.watchedWalletId, boundedUserAlertError(input.error)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markApprovalContextPending(
  db: Db,
  input: {
    approvalTxHash: string;
    watchedWalletId: string;
    contextDeadlineAt: Date;
    initialReport: RiskReport;
  }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set context_status = 'pending',
       context_deadline_at = $3,
       context_result = 'unknown',
       initial_risk_level = $4,
       initial_risk_score = $5,
       initial_risk_reasons = $6,
       final_risk_level = null,
       final_risk_score = null,
       final_risk_reasons = '[]'::jsonb,
       final_context_alert_sent_at = null,
       context_last_error = null,
       context_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2`,
    [
      input.approvalTxHash,
      input.watchedWalletId,
      input.contextDeadlineAt,
      input.initialReport.level,
      input.initialReport.score,
      JSON.stringify(input.initialReport.reasons)
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function claimDueApprovalContexts(
  db: Db,
  input: { now: Date; limit: number }
): Promise<PendingApprovalContextRow[]> {
  const limit = Math.max(1, Math.min(input.limit, 100));
  const result = await db.query(
    `with due as (
       select approval_tx_hash, watched_wallet_id
       from observed_approval_events
       where context_status = 'pending'
         and context_deadline_at is not null
         and context_deadline_at <= $1
       order by context_deadline_at asc, created_at asc
       limit $2
       for update skip locked
     )
     update observed_approval_events oae
     set context_status = 'finalizing',
       context_last_error = null,
       context_updated_at = now()
     from due
     join watched_wallets w on w.id = due.watched_wallet_id
     join telegram_users u on u.telegram_user_id = w.telegram_user_id
     where oae.approval_tx_hash = due.approval_tx_hash
       and oae.watched_wallet_id = due.watched_wallet_id
     returning oae.approval_tx_hash,
       oae.watched_wallet_id,
       oae.owner_address,
       oae.token_contract,
       oae.spender_address,
       oae.spender_type,
       oae.amount_raw,
       oae.is_unlimited,
       oae.approval_at,
       oae.owner_alert_status,
       oae.owner_alert_attempts,
       oae.owner_alert_last_error,
       oae.owner_alert_updated_at,
       oae.risk_level,
       oae.risk_score,
       oae.risk_reasons,
       oae.created_at,
       oae.context_status,
       oae.context_deadline_at,
       oae.context_result,
       oae.initial_risk_level,
       oae.initial_risk_score,
       oae.initial_risk_reasons,
       oae.final_risk_level,
       oae.final_risk_score,
       oae.final_risk_reasons,
       oae.final_context_alert_sent_at,
       oae.context_last_error,
       oae.context_updated_at,
       w.id as wallet_id,
       w.telegram_user_id as wallet_telegram_user_id,
       u.username as wallet_username,
       u.locale as wallet_locale,
       w.address as wallet_address,
       w.created_at as wallet_created_at,
       w.alert_mode as wallet_alert_mode,
       w.digest_interval_minutes as wallet_digest_interval_minutes`,
    [input.now, limit]
  );
  return result.rows.map(mapPendingApprovalContextRow);
}

export async function markApprovalContextResolved(
  db: Db,
  input: {
    approvalTxHash: string;
    watchedWalletId: string;
    result: Exclude<ApprovalContextResult, "no_route_found" | "unknown">;
    finalReport: RiskReport;
  }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set context_status = 'resolved',
       context_result = $3,
       final_risk_level = $4,
       final_risk_score = $5,
       final_risk_reasons = $6,
       risk_level = $4,
       risk_score = $5,
       risk_reasons = $6,
       context_last_error = null,
       context_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2 and context_status = 'finalizing'`,
    [
      input.approvalTxHash,
      input.watchedWalletId,
      input.result,
      input.finalReport.level,
      input.finalReport.score,
      JSON.stringify(input.finalReport.reasons)
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markApprovalContextExpired(
  db: Db,
  input: {
    approvalTxHash: string;
    watchedWalletId: string;
    finalReport: RiskReport;
  }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set context_status = 'expired',
       context_result = 'no_route_found',
       final_risk_level = $3,
       final_risk_score = $4,
       final_risk_reasons = $5,
       risk_level = $3,
       risk_score = $4,
       risk_reasons = $5,
       context_last_error = null,
       context_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2 and context_status = 'finalizing'`,
    [
      input.approvalTxHash,
      input.watchedWalletId,
      input.finalReport.level,
      input.finalReport.score,
      JSON.stringify(input.finalReport.reasons)
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markApprovalContextFinalAlertSent(
  db: Db,
  input: { approvalTxHash: string; watchedWalletId: string; sentAt: Date }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set final_context_alert_sent_at = $3,
       context_updated_at = now()
     where approval_tx_hash = $1
       and watched_wallet_id = $2
       and context_status in ('resolved', 'expired')
       and final_context_alert_sent_at is null`,
    [input.approvalTxHash, input.watchedWalletId, input.sentAt]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function releaseApprovalContextAfterFailure(
  db: Db,
  input: { approvalTxHash: string; watchedWalletId: string; error: string }
): Promise<boolean> {
  const result = await db.query(
    `update observed_approval_events
     set context_status = 'pending',
       context_last_error = $3,
       context_updated_at = now()
     where approval_tx_hash = $1 and watched_wallet_id = $2 and context_status = 'finalizing'`,
    [input.approvalTxHash, input.watchedWalletId, boundedUserAlertError(input.error)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listWalletApprovals(db: Db, watchedWalletId: string): Promise<WalletApproval[]> {
  const result = await db.query(
    `select wa.watched_wallet_id, wa.token_contract, wa.spender_address, wa.amount_raw,
       wa.is_unlimited, wa.current_allowance_raw, wa.spender_type, wa.status,
       wa.last_approval_tx_hash, wa.last_approval_at, wa.risk_level, wa.risk_score,
       wa.risk_reasons, wa.last_alerted_tx_hash, wa.updated_at,
       am.name as metadata_name,
       am.tag as metadata_tag,
       am.source as metadata_source,
       am.is_contract as metadata_is_contract,
       coalesce(cip.provider_tags->0->>'label', cip.public_tags->0->>'label') as contract_service_tag,
       cip.is_verified as contract_verified,
       case
         when coalesce(cip.tx_count, 0) >= 100000 or coalesce(cip.total_call_count, 0) >= 100000 or coalesce(cip.total_caller_count, 0) >= 10000 then 'high'
         when coalesce(cip.tx_count, 0) >= 1000 or coalesce(cip.total_call_count, 0) >= 1000 or coalesce(cip.total_caller_count, 0) >= 100 then 'normal'
         when cip.contract_address is null then null
         when coalesce(cip.tx_count, 0) = 0 and coalesce(cip.total_call_count, 0) = 0 then 'none'
         else 'low'
       end as contract_activity_level,
       cip.top_methods as contract_top_methods,
       ((cip.method_map ? '23b872dd') or cip.raw_payload::text ilike '%transferfrom%' or cip.raw_payload::text ilike '%23b872dd%') as contract_has_transfer_from_selector,
        (cip.raw_payload::text ilike '%no access%' or cip.raw_payload::text ilike '%onlyowner%' or cip.raw_payload::text ilike '%caller is not the owner%') as contract_has_owner_only_pattern,
        oae.context_status as approval_context_status,
        oae.context_result as approval_context_result,
        oae.context_deadline_at as approval_context_deadline_at,
        oae.final_context_alert_sent_at as approval_final_context_alert_sent_at
      from wallet_approvals wa
      left join address_metadata am on am.address = wa.spender_address
      left join contract_intelligence_profiles cip on cip.contract_address = wa.spender_address
      left join observed_approval_events oae
        on oae.watched_wallet_id = wa.watched_wallet_id
       and oae.approval_tx_hash = wa.last_approval_tx_hash
       and oae.spender_address = wa.spender_address
      where wa.watched_wallet_id = $1
     order by wa.risk_score desc, wa.updated_at desc`,
    [watchedWalletId]
  );
  return result.rows.map(mapWalletApprovalRow);
}

export async function listWalletApprovalsBySpenderForTelegramUser(
  db: Db,
  input: { telegramUserId: string; spenderAddress: string }
): Promise<WalletApprovalSpenderRelation[]> {
  const result = await db.query(
    `select wa.watched_wallet_id, wa.token_contract, wa.spender_address, wa.amount_raw,
       wa.is_unlimited, wa.current_allowance_raw, wa.spender_type, wa.status,
       wa.last_approval_tx_hash, wa.last_approval_at, wa.risk_level, wa.risk_score,
       wa.risk_reasons, wa.last_alerted_tx_hash, wa.updated_at,
       am.name as metadata_name,
       am.tag as metadata_tag,
       am.source as metadata_source,
       am.is_contract as metadata_is_contract,
       coalesce(cip.provider_tags->0->>'label', cip.public_tags->0->>'label') as contract_service_tag,
       cip.is_verified as contract_verified,
       case
         when coalesce(cip.tx_count, 0) >= 100000 or coalesce(cip.total_call_count, 0) >= 100000 or coalesce(cip.total_caller_count, 0) >= 10000 then 'high'
         when coalesce(cip.tx_count, 0) >= 1000 or coalesce(cip.total_call_count, 0) >= 1000 or coalesce(cip.total_caller_count, 0) >= 100 then 'normal'
         when cip.contract_address is null then null
         when coalesce(cip.tx_count, 0) = 0 and coalesce(cip.total_call_count, 0) = 0 then 'none'
         else 'low'
       end as contract_activity_level,
       cip.top_methods as contract_top_methods,
       ((cip.method_map ? '23b872dd') or cip.raw_payload::text ilike '%transferfrom%' or cip.raw_payload::text ilike '%23b872dd%') as contract_has_transfer_from_selector,
        (cip.raw_payload::text ilike '%no access%' or cip.raw_payload::text ilike '%onlyowner%' or cip.raw_payload::text ilike '%caller is not the owner%') as contract_has_owner_only_pattern,
        oae.context_status as approval_context_status,
        oae.context_result as approval_context_result,
        oae.context_deadline_at as approval_context_deadline_at,
        oae.final_context_alert_sent_at as approval_final_context_alert_sent_at,
       w.address as watched_wallet_address,
       w.telegram_user_id as watched_wallet_telegram_user_id
     from wallet_approvals wa
     join watched_wallets w on w.id = wa.watched_wallet_id
     left join address_metadata am on am.address = wa.spender_address
     left join contract_intelligence_profiles cip on cip.contract_address = wa.spender_address
     left join observed_approval_events oae
       on oae.watched_wallet_id = wa.watched_wallet_id
      and oae.approval_tx_hash = wa.last_approval_tx_hash
      and oae.token_contract = wa.token_contract
      and oae.spender_address = wa.spender_address
      and oae.owner_address = w.address
     where w.telegram_user_id = $1 and wa.spender_address = $2
     order by wa.risk_score desc, wa.updated_at desc`,
    [input.telegramUserId, input.spenderAddress]
  );
  return result.rows.map((row) => ({
    ...mapWalletApprovalRow(row),
    watchedWalletAddress: row.watched_wallet_address,
    watchedWalletTelegramUserId: row.watched_wallet_telegram_user_id
  }));
}

export async function listWalletApprovalDrainObservations(
  db: Db,
  watchedWalletId: string,
  limit = 5
): Promise<ObservedApprovalDrainEvent[]> {
  const result = await db.query(
    `select id, watched_wallet_id, approval_tx_hash, transfer_tx_hash,
       owner_address, spender_address, receiver_address, token_contract,
       amount_raw, caller_address, method, approval_at, transfer_at,
       time_to_transfer_ms, spender_type, receiver_type, observed_mode,
       risk_level, risk_score, risk_reasons, raw_evidence_id, created_at, updated_at
     from observed_approval_drain_events
     where watched_wallet_id = $1
     order by risk_score desc, transfer_at desc
     limit $2`,
    [watchedWalletId, limit]
  );
  return result.rows.map(mapObservedApprovalDrainEventRow);
}

async function countWalletApprovalDrainObservations(
  db: Db,
  watchedWalletId: string
): Promise<{ totalCount: number; highRiskCount: number }> {
  const result = await db.query(
    `select
       count(*)::int as total_count,
       count(*) filter (where risk_level in ('HIGH', 'CRITICAL'))::int as high_risk_count
     from observed_approval_drain_events
     where watched_wallet_id = $1`,
    [watchedWalletId]
  );
  const row = result.rows[0] ?? {};
  return {
    totalCount: Number(row.total_count ?? 0),
    highRiskCount: Number(row.high_risk_count ?? 0)
  };
}

export async function getWalletApprovalSummary(db: Db, watchedWalletId: string): Promise<WalletApprovalSummary> {
  const [approvals, drainObservations, drainCounts] = await Promise.all([
    listWalletApprovals(db, watchedWalletId),
    listWalletApprovalDrainObservations(db, watchedWalletId),
    countWalletApprovalDrainObservations(db, watchedWalletId)
  ]);
  return {
    usdtApprovalCount: approvals.length,
    unlimitedApprovalCount: approvals.filter((approval) => approval.isUnlimited).length,
    highRiskApprovalCount: approvals.filter((approval) => approval.riskLevel === "HIGH" || approval.riskLevel === "CRITICAL").length,
    topRiskyApprovals: approvals.filter((approval) => approval.riskScore > 0).slice(0, 5),
    drainObservationCount: drainCounts.totalCount,
    highRiskDrainObservationCount: drainCounts.highRiskCount,
    topDrainObservations: drainObservations
  };
}

export async function claimDigestTransactions(
  db: Db,
  input: { limit: number; now: Date }
): Promise<ObservedTransactionDigestItem[]> {
  const result = await db.query(
    `select tx.tx_hash, tx.watched_wallet_id, tx.sender, tx.receiver, tx.token, tx.amount, tx.timestamp,
       tx.user_alert_status, tx.user_alert_attempts, tx.user_alert_last_error, tx.user_alert_updated_at, tx.created_at,
       tx.risk_level, tx.risk_score, tx.risk_reasons, tx.digest_sent_at
     from observed_transactions tx
     join watched_wallets w on w.id = tx.watched_wallet_id
     where w.alert_mode = 'digest'
       and tx.digest_sent_at is null
       and tx.risk_level is not null
       and coalesce(tx.user_alert_last_error, '') <> 'backfill_stale_transaction'
       and tx.created_at <= ($2::timestamptz - (w.digest_interval_minutes || ' minutes')::interval)
     order by tx.created_at asc
     limit $1`,
    [input.limit, input.now]
  );
  return result.rows.map(mapObservedTransactionDigestItemRow);
}

export async function markDigestSent(db: Db, input: { watchedWalletId: string; txHashes: string[] }): Promise<number> {
  if (input.txHashes.length === 0) return 0;
  const result = await db.query(
    `update observed_transactions
     set digest_sent_at = now()
     where watched_wallet_id = $1 and tx_hash = any($2) and digest_sent_at is null`,
    [input.watchedWalletId, input.txHashes]
  );
  return result.rowCount ?? 0;
}

export async function saveAddressLabel(
  db: Db,
  input: { address: string; label: RiskLabel; source: "service_admin" | "system"; createdByTelegramId: string | null }
): Promise<void> {
  await db.query(
    `insert into address_labels (address, label, source, created_by_telegram_id)
     values ($1, $2, $3, $4)
     on conflict (address, label) do update set source = excluded.source, created_by_telegram_id = excluded.created_by_telegram_id`,
    [input.address, input.label, input.source, input.createdByTelegramId]
  );
}

export async function listAddressLabels(db: Db, address: string): Promise<AddressLabel[]> {
  const result = await db.query(
    `select address, label, source, created_by_telegram_id, created_at
     from address_labels where address = $1 order by created_at asc`,
    [address]
  );
  return result.rows.map(mapAddressLabelRow);
}

export async function listActiveRiskLabelsForAddress(db: Db, address: string, chain = "tron"): Promise<AddressLabel[]> {
  void chain;
  const result = await db.query(
    `select address, label, source, created_by_telegram_id, created_at
     from address_labels where address = $1 order by created_at asc`,
    [address]
  );
  return result.rows.map(mapAddressLabelRow);
}

export async function upsertAddressLabelAssertion(
  db: Db,
  input: AddressLabelAssertionInput
): Promise<AddressLabelAssertion> {
  parseRiskLabel(input.label);
  parseRiskConfidence(input.confidence);
  parseRiskSeverity(input.severity);
  parseAddressLabelAssertionStatus(input.status);

  const client = await db.connect();
  try {
    await client.query("begin");
    const firstSeenAt = input.firstSeenAt ?? new Date();
    const lastSeenAt = input.lastSeenAt ?? firstSeenAt;
    const assertionResult = await client.query(
      `insert into address_label_assertions (
         id, chain, address, label, entity_name, category, confidence, severity,
         status, source_name, source_url, notes, evidence_json,
         created_by_telegram_id, first_seen_at, last_seen_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (id) do update set
         chain = excluded.chain,
         address = excluded.address,
         label = excluded.label,
         entity_name = excluded.entity_name,
         category = excluded.category,
         confidence = excluded.confidence,
         severity = excluded.severity,
         status = excluded.status,
         source_name = excluded.source_name,
         source_url = excluded.source_url,
         notes = excluded.notes,
         evidence_json = excluded.evidence_json,
         created_by_telegram_id = excluded.created_by_telegram_id,
         first_seen_at = excluded.first_seen_at,
         last_seen_at = excluded.last_seen_at,
         updated_at = now()
       returning id, chain, address, label, entity_name, category, confidence,
         severity, status, source_name, source_url, notes, evidence_json,
         created_by_telegram_id, first_seen_at, last_seen_at, created_at, updated_at`,
      [
        input.id ?? createId(),
        input.chain,
        input.address,
        input.label,
        input.entityName ?? null,
        input.category,
        input.confidence,
        input.severity,
        input.status,
        input.sourceName,
        input.sourceUrl ?? null,
        input.notes ?? null,
        input.evidenceJson ?? {},
        input.createdByTelegramId ?? null,
        firstSeenAt,
        lastSeenAt
      ]
    );

    if (input.status === "active") {
      const derivedLabelSource = input.derivedLabelSource
        ?? (input.createdByTelegramId || input.sourceName === "manual_verified" ? "service_admin" : "system");
      await client.query(
        `insert into address_labels (address, label, source, created_by_telegram_id)
         values ($1, $2, $3, $4)
         on conflict (address, label) do update set
           source = excluded.source,
           created_by_telegram_id = excluded.created_by_telegram_id`,
        [input.address, input.label, derivedLabelSource, input.createdByTelegramId ?? null]
      );
    } else {
      await client.query(
        `delete from address_labels
         where address = $1 and label = $2 and not exists (
           select 1 from address_label_assertions
           where chain = $3 and address = $1 and label = $2 and status = 'active'
         )`,
        [input.address, input.label, input.chain]
      );
    }

    await client.query("commit");
    return mapAddressLabelAssertionRow(assertionResult.rows[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function assertRawAmount(value: string, fieldName = "amountRaw"): void {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be an unsigned integer string`);
  }
}

export async function upsertIndexedTronUsdtTransfers(db: Db, transfers: IndexedTronUsdtTransfer[]): Promise<void> {
  if (transfers.length === 0) return;
  const client = await db.connect();
  try {
    await client.query("begin");
    for (const transfer of transfers) {
      assertRawAmount(transfer.amountRaw);
      parseTronUsdtTransferMethod(transfer.method);
      await client.query(
        `insert into tron_usdt_transfers (
           tx_hash, block_number, block_timestamp, event_index,
           from_address, to_address, amount_raw, method,
           caller_address, contract_ret, confirmed
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (tx_hash, event_index) do update set
           block_number = excluded.block_number,
           block_timestamp = excluded.block_timestamp,
           from_address = excluded.from_address,
           to_address = excluded.to_address,
           amount_raw = excluded.amount_raw,
           method = excluded.method,
           caller_address = excluded.caller_address,
           contract_ret = excluded.contract_ret,
           confirmed = excluded.confirmed,
           updated_at = now()`,
        [
          transfer.txHash,
          transfer.blockNumber,
          transfer.blockTimestamp,
          transfer.eventIndex,
          transfer.fromAddress,
          transfer.toAddress,
          transfer.amountRaw,
          transfer.method,
          transfer.callerAddress,
          transfer.contractRet,
          transfer.confirmed
        ]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertIndexedTronUsdtApprovals(db: Db, approvals: IndexedTronUsdtApproval[]): Promise<void> {
  if (approvals.length === 0) return;
  const client = await db.connect();
  try {
    await client.query("begin");
    for (const approval of approvals) {
      assertRawAmount(approval.amountRaw);
      await client.query(
        `insert into tron_usdt_approvals (
           tx_hash, block_number, block_timestamp, event_index,
           owner_address, spender_address, amount_raw, is_unlimited
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (tx_hash, event_index) do update set
           block_number = excluded.block_number,
           block_timestamp = excluded.block_timestamp,
           owner_address = excluded.owner_address,
           spender_address = excluded.spender_address,
           amount_raw = excluded.amount_raw,
           is_unlimited = excluded.is_unlimited,
           updated_at = now()`,
        [
          approval.txHash,
          approval.blockNumber,
          approval.blockTimestamp,
          approval.eventIndex,
          approval.ownerAddress,
          approval.spenderAddress,
          approval.amountRaw,
          approval.isUnlimited
        ]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listIndexedTronUsdtTransfersForAddress(
  db: Db,
  input: IndexedTronUsdtTransferQuery
): Promise<IndexedTronUsdtTransfer[]> {
  const direction = input.direction ?? "both";
  const addressClause = direction === "incoming"
    ? "to_address = $1"
    : direction === "outgoing"
      ? "from_address = $1"
      : "(from_address = $1 or to_address = $1)";
  const params: unknown[] = [input.address];
  const filters = [addressClause];
  if (input.minTimestamp) {
    params.push(input.minTimestamp);
    filters.push(`block_timestamp >= $${params.length}`);
  }
  if (input.maxTimestamp) {
    params.push(input.maxTimestamp);
    filters.push(`block_timestamp <= $${params.length}`);
  }
  params.push(input.limit ?? 200);
  const limitParam = params.length;
  params.push(input.offset ?? 0);
  const offsetParam = params.length;
  const orderBy = input.orderBy === "amount_desc"
    ? "length(amount_raw) desc, amount_raw desc, block_timestamp desc, block_number desc, event_index desc"
    : "block_timestamp desc, block_number desc, event_index desc";
  const result = await db.query(
    `select tx_hash, block_number, block_timestamp, event_index,
       from_address, to_address, amount_raw, method, caller_address,
       contract_ret, confirmed
     from tron_usdt_transfers
     where ${filters.join(" and ")}
     order by ${orderBy}
     limit $${limitParam} offset $${offsetParam}`,
    params
  );
  return result.rows.map(mapIndexedTronUsdtTransferRow);
}

export async function listIndexedTronUsdtApprovalsForOwnerSpender(
  db: Db,
  input: {
    ownerAddress: string;
    spenderAddress: string;
    minTimestamp?: Date;
    maxTimestamp?: Date;
    limit?: number;
  }
): Promise<IndexedTronUsdtApproval[]> {
  const params: unknown[] = [input.ownerAddress, input.spenderAddress];
  const filters = ["owner_address = $1", "spender_address = $2"];
  if (input.minTimestamp) {
    params.push(input.minTimestamp);
    filters.push(`block_timestamp >= $${params.length}`);
  }
  if (input.maxTimestamp) {
    params.push(input.maxTimestamp);
    filters.push(`block_timestamp <= $${params.length}`);
  }
  params.push(input.limit ?? 20);
  const result = await db.query(
    `select tx_hash, block_number, block_timestamp, event_index,
       owner_address, spender_address, amount_raw, is_unlimited
     from tron_usdt_approvals
     where ${filters.join(" and ")}
     order by block_timestamp desc, block_number desc, event_index desc
     limit $${params.length}`,
    params
  );
  return result.rows.map(mapIndexedTronUsdtApprovalRow);
}

export async function rebuildAddressFeaturesDaily(
  db: Db,
  input: { dayStart: Date; dayEnd: Date }
): Promise<AddressFeaturesDaily[]> {
  const result = await db.query(
    `with scoped as (
       select *
       from tron_usdt_transfers
       where block_timestamp >= $1 and block_timestamp < $2 and confirmed = true
     ),
     addresses as (
       select from_address as address, date_trunc('day', block_timestamp)::date as day from scoped
       union
       select to_address as address, date_trunc('day', block_timestamp)::date as day from scoped
     ),
     aggregates as (
       select
         a.address,
         a.day,
         coalesce(sum(case when s.to_address = a.address then s.amount_raw::numeric else 0 end), 0) as in_volume_raw,
         coalesce(sum(case when s.from_address = a.address then s.amount_raw::numeric else 0 end), 0) as out_volume_raw,
         count(*) filter (where s.to_address = a.address)::int as in_count,
         count(*) filter (where s.from_address = a.address)::int as out_count,
         count(distinct s.from_address) filter (where s.to_address = a.address)::int as unique_in,
         count(distinct s.to_address) filter (where s.from_address = a.address)::int as unique_out,
         min(s.block_timestamp) as first_seen,
         max(s.block_timestamp) as last_seen
       from addresses a
       join scoped s
         on date_trunc('day', s.block_timestamp)::date = a.day
        and (s.from_address = a.address or s.to_address = a.address)
       group by a.address, a.day
     )
     insert into address_features_daily (
       address, day, in_volume_raw, out_volume_raw, in_count, out_count,
       unique_in, unique_out, first_seen, last_seen
     )
     select address, day, in_volume_raw, out_volume_raw, in_count, out_count,
       unique_in, unique_out, first_seen, last_seen
     from aggregates
     on conflict (address, day) do update set
       in_volume_raw = excluded.in_volume_raw,
       out_volume_raw = excluded.out_volume_raw,
       in_count = excluded.in_count,
       out_count = excluded.out_count,
       unique_in = excluded.unique_in,
       unique_out = excluded.unique_out,
       first_seen = excluded.first_seen,
       last_seen = excluded.last_seen,
       updated_at = now()
     returning address, day, in_volume_raw, out_volume_raw, in_count, out_count,
       unique_in, unique_out, first_seen, last_seen`,
    [input.dayStart, input.dayEnd]
  );
  return result.rows.map(mapAddressFeaturesDailyRow);
}

export async function upsertAddressLabelCache(db: Db, input: AddressLabelCacheInput): Promise<AddressLabelCacheEntry> {
  parseCachedAddressLabelProvider(input.provider);
  parseCachedAddressLabelCategory(input.category);
  parseRiskConfidence(input.confidence);
  const firstSeenAt = input.firstSeenAt ?? new Date();
  const lastSeenAt = input.lastSeenAt ?? firstSeenAt;
  const result = await db.query(
    `insert into address_labels_cache (
       chain, address, provider, label, category, confidence,
       source_url, raw_json, first_seen_at, last_seen_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (chain, address, provider, label) do update set
       category = excluded.category,
       confidence = excluded.confidence,
       source_url = excluded.source_url,
       raw_json = excluded.raw_json,
       last_seen_at = excluded.last_seen_at,
       updated_at = now()
     returning chain, address, provider, label, category, confidence,
       source_url, raw_json, first_seen_at, last_seen_at`,
    [
      input.chain,
      input.address,
      input.provider,
      input.label,
      input.category,
      input.confidence,
      input.sourceUrl,
      input.rawJson,
      firstSeenAt,
      lastSeenAt
    ]
  );
  return mapAddressLabelCacheRow(result.rows[0]);
}

export async function listAddressLabelCacheForAddress(db: Db, address: string, chain = "tron"): Promise<AddressLabelCacheEntry[]> {
  const result = await db.query(
    `select chain, address, provider, label, category, confidence,
       source_url, raw_json, first_seen_at, last_seen_at
     from address_labels_cache
     where chain = $1 and address = $2
     order by last_seen_at desc`,
    [chain, address]
  );
  return result.rows.map(mapAddressLabelCacheRow);
}

export async function getTronUsdtIndexerCursor(db: Db, id: string): Promise<TronUsdtIndexerCursor | null> {
  const result = await db.query(
    `select id, status, last_indexed_block, last_indexed_timestamp,
       last_fingerprint, progress_json, last_error, created_at, updated_at
     from tron_usdt_indexer_cursors
     where id = $1`,
    [id]
  );
  return result.rows[0] ? mapTronUsdtIndexerCursorRow(result.rows[0]) : null;
}

export async function upsertTronUsdtIndexerCursor(db: Db, input: TronUsdtIndexerCursorInput): Promise<TronUsdtIndexerCursor> {
  parseTronUsdtIndexerCursorStatus(input.status);
  const result = await db.query(
    `insert into tron_usdt_indexer_cursors (
       id, status, last_indexed_block, last_indexed_timestamp,
       last_fingerprint, progress_json, last_error
     )
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set
       status = excluded.status,
       last_indexed_block = excluded.last_indexed_block,
       last_indexed_timestamp = excluded.last_indexed_timestamp,
       last_fingerprint = excluded.last_fingerprint,
       progress_json = excluded.progress_json,
       last_error = excluded.last_error,
       updated_at = now()
     returning id, status, last_indexed_block, last_indexed_timestamp,
       last_fingerprint, progress_json, last_error, created_at, updated_at`,
    [
      input.id,
      input.status,
      input.lastIndexedBlock ?? null,
      input.lastIndexedTimestamp ?? null,
      input.lastFingerprint ?? null,
      input.progressJson ?? {},
      input.lastError ?? null
    ]
  );
  return mapTronUsdtIndexerCursorRow(result.rows[0]);
}

export async function saveRiskEvaluationEvidence(
  db: Db,
  input: {
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
  }
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");

    for (const evidence of input.rawEvidence) {
      parseRawEvidenceSourceType(evidence.sourceType);
      await client.query(
        `insert into raw_evidence (
           id, source, source_type, chain, address, tx_hash,
           observed_transaction_hash, evidence_json
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           source = excluded.source,
           source_type = excluded.source_type,
           chain = excluded.chain,
           address = excluded.address,
           tx_hash = excluded.tx_hash,
           observed_transaction_hash = excluded.observed_transaction_hash,
           evidence_json = excluded.evidence_json`,
        [
          evidence.id,
          evidence.source,
          evidence.sourceType,
          evidence.chain,
          evidence.address,
          evidence.txHash,
          evidence.observedTransactionHash,
          evidence.evidenceJson
        ]
      );
    }

    for (const observation of input.observations) {
      parseRiskSignalGroup(observation.signalGroup);
      parseRiskConfidence(observation.confidence);
      parseRiskSeverity(observation.severity);
      await client.query(
        `insert into risk_signal_observations (
           id, subject_chain, subject_address, subject_tx_hash,
           observed_transaction_hash, signal_group, code, message,
           score_impact, confidence, severity, source, policy_version,
           raw_evidence_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           subject_chain = excluded.subject_chain,
           subject_address = excluded.subject_address,
           subject_tx_hash = excluded.subject_tx_hash,
           observed_transaction_hash = excluded.observed_transaction_hash,
           signal_group = excluded.signal_group,
           code = excluded.code,
           message = excluded.message,
           score_impact = excluded.score_impact,
           confidence = excluded.confidence,
           severity = excluded.severity,
           source = excluded.source,
           policy_version = excluded.policy_version,
           raw_evidence_id = excluded.raw_evidence_id`,
        [
          observation.id,
          observation.subjectChain,
          observation.subjectAddress,
          observation.subjectTxHash,
          observation.observedTransactionHash,
          observation.signalGroup,
          observation.code,
          observation.message,
          observation.scoreImpact,
          observation.confidence,
          observation.severity,
          observation.source,
          observation.policyVersion,
          observation.rawEvidenceId
        ]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createOrReuseForensicCheckJob(
  db: Db,
  input: ForensicCheckJobInput
): Promise<ForensicCheckJob> {
  const kind = (input.kind ?? "address_deep_check") as ForensicCheckJobKind;
  if (kind === "address_fast_check") {
    throw new Error("address_fast_check jobs must be saved with saveAddressFastCheckJob");
  }
  const result = await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json
     )
     values ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9, $10)
     on conflict (kind, subject_address, window_start, window_end, coalesce(requested_by, ''), coalesce(progress_json->>'depositTxHash', ''))
       where status in ('queued', 'running')
     do update set
       chat_id = coalesce(excluded.chat_id, forensic_check_jobs.chat_id),
       message_id = coalesce(excluded.message_id, forensic_check_jobs.message_id),
       priority = greatest(forensic_check_jobs.priority, excluded.priority),
       progress_json = forensic_check_jobs.progress_json || excluded.progress_json,
       updated_at = now()
     returning id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at`,
    [
      createId(),
      kind,
      input.subjectAddress,
      input.windowStart,
      input.windowEnd,
      input.priority ?? 100,
      input.chatId ?? null,
      input.messageId ?? null,
      input.requestedBy ?? null,
      input.progressJson ?? {}
    ]
  );
  return mapForensicCheckJobRow(result.rows[0]);
}

export async function saveAddressFastCheckJob(
  db: Db,
  input: AddressFastCheckJobInput
): Promise<ForensicCheckJob> {
  if (input.status !== "completed" && input.status !== "partial") {
    throw new Error(`Invalid address fast check terminal status: ${input.status}`);
  }
  const result = await db.query(
    `insert into forensic_check_jobs (
       id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, started_at, completed_at
     )
     values ($1, 'address_fast_check', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
     returning id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at`,
    [
      input.id ?? createId(),
      input.subjectAddress,
      input.status,
      input.windowStart,
      input.windowEnd,
      input.priority ?? 100,
      input.chatId ?? null,
      input.requestedBy ?? null,
      input.progressJson,
      input.resultJson,
      JSON.stringify(input.rawEvidenceIds),
      JSON.stringify(input.observationIds),
      input.lastError
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Failed to save address fast check job.");
  return mapForensicCheckJobRow(row);
}

export async function claimNextForensicCheckJob(
  db: Db,
  input: { kinds?: ForensicCheckJobKind[] } = {}
): Promise<ForensicCheckJob | null> {
  const kinds = (input.kinds ?? []).map((kind) => {
    if (kind === "address_fast_check") {
      throw new Error("address_fast_check jobs are not queueable");
    }
    return parseForensicCheckJobKind(kind);
  });
  const kindFilter = kinds.length > 0 ? "and kind = any($1::text[])" : "";
  const result = await db.query(
    `with next_job as (
       select id
       from forensic_check_jobs
       where status = 'queued'
       and kind <> 'address_fast_check'
       ${kindFilter}
       order by priority desc, created_at asc
       limit 1
       for update skip locked
     )
     update forensic_check_jobs job
     set status = 'running',
       started_at = coalesce(job.started_at, now()),
       updated_at = now()
     from next_job
     where job.id = next_job.id
     returning job.id, job.kind, job.subject_address, job.status,
       job.window_start, job.window_end, job.priority, job.chat_id,
       job.message_id, job.requested_by, job.progress_json, job.result_json,
       job.raw_evidence_ids, job.observation_ids, job.last_error,
       job.created_at, job.updated_at, job.started_at, job.completed_at`,
    kinds.length > 0 ? [kinds] : []
  );
  return result.rows[0] ? mapForensicCheckJobRow(result.rows[0]) : null;
}

export async function recoverStaleForensicCheckJobs(
  db: Db,
  input: RecoverStaleForensicCheckJobsInput
): Promise<RecoverStaleForensicCheckJobsResult> {
  const maxRetries = Number.isFinite(input.maxRetries) ? Math.max(0, Math.floor(input.maxRetries)) : 0;
  const requestedLimit = input.limit ?? 100;
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500) : 100;
  const staleRunningBeforeIso = input.staleRunningBefore.toISOString();
  const recoveredAtIso = (input.recoveredAt ?? new Date()).toISOString();
  const result = await db.query(
    `with stale_jobs as (
       select job.id,
         job.kind,
         runtime.retry_count,
         runtime.job_phase,
         (
           job.kind in ('where_is_money_check', 'address_deep_check')
           and runtime.retry_count < $3
         ) as route_retry_allowed,
         (
           job.kind = 'incoming_deposit_check'
           and runtime.job_phase in ('incoming_deposit_trace', 'risk_recording')
           and runtime.retry_count < 1
         ) as incoming_retry_allowed,
         (
           job.kind = 'incoming_deposit_check'
           and (
             runtime.job_phase is null
             or runtime.job_phase in ('notification_delivery', 'completing')
             or runtime.job_phase not in ('incoming_deposit_trace', 'risk_recording')
           )
         ) as incoming_delivery_sensitive
       from forensic_check_jobs job
       cross join lateral (
         select
           coalesce(job.progress_json->>'jobHeartbeatAt', '') as heartbeat_text,
           coalesce(job.progress_json->>'jobHeartbeatAt', '') ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$' as has_iso_heartbeat,
           case
             when coalesce(job.progress_json->>'retryCount', '') ~ '^[0-9]+$'
               and length(coalesce(job.progress_json->>'retryCount', '')) <= 9
             then (job.progress_json->>'retryCount')::int
             else 0
           end as retry_count,
           nullif(job.progress_json->>'jobPhase', '') as job_phase
       ) runtime
       where job.status = 'running'
         and (
           (runtime.has_iso_heartbeat and runtime.heartbeat_text < $2)
           or (not runtime.has_iso_heartbeat and coalesce(job.started_at, job.created_at) < $1)
         )
       order by
         case
           when runtime.has_iso_heartbeat then runtime.heartbeat_text
           else to_char(coalesce(job.started_at, job.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         end asc,
         job.created_at asc
       limit $4
       for update of job skip locked
     ),
     decisions as (
       select id,
         case
           when route_retry_allowed or incoming_retry_allowed then 'queued'
           else 'failed'
         end as next_status,
         case
           when route_retry_allowed or incoming_retry_allowed then retry_count + 1
           else retry_count
         end as next_retry_count,
         case
           when route_retry_allowed or incoming_retry_allowed then 'queued_after_stale_recovery'
           else 'failed_after_stale_recovery'
         end as next_job_phase,
         case
           when route_retry_allowed or incoming_retry_allowed then 'stale_running_requeued'
           when kind = 'incoming_deposit_check' and incoming_delivery_sensitive then 'stale_running_delivery_sensitive_phase'
           when kind = 'incoming_deposit_check' then 'stale_running_incoming_retry_exhausted'
           else 'stale_running_retry_exhausted'
         end as recovery_reason
       from stale_jobs
     )
     update forensic_check_jobs job
     set status = decisions.next_status,
       progress_json = job.progress_json || jsonb_build_object(
         'jobPhase', decisions.next_job_phase,
         'jobHeartbeatAt', $5::text,
         'retryCount', decisions.next_retry_count,
         'lastRecoveredAt', $5::text,
         'staleRecoveryReason', decisions.recovery_reason
       ),
       last_error = case when decisions.next_status = 'failed' then decisions.recovery_reason else null end,
       started_at = case when decisions.next_status = 'queued' then null else job.started_at end,
       completed_at = case when decisions.next_status = 'failed' then $5::timestamptz else null end,
       updated_at = $5::timestamptz
     from decisions
     where job.id = decisions.id
     returning job.id, job.kind, job.subject_address, job.status,
       job.window_start, job.window_end, job.priority, job.chat_id,
       job.message_id, job.requested_by, job.progress_json, job.result_json,
       job.raw_evidence_ids, job.observation_ids, job.last_error,
       job.created_at, job.updated_at, job.started_at, job.completed_at`,
    [input.staleRunningBefore, staleRunningBeforeIso, maxRetries, limit, recoveredAtIso]
  );
  const recovered = result.rows.map(mapForensicCheckJobRow);
  return {
    requeued: recovered.filter((job) => job.status === "queued"),
    failed: recovered.filter((job) => job.status === "failed")
  };
}

export async function updateForensicCheckJobProgress(
  db: Db,
  input: { id: string; progressJson: Record<string, unknown>; lastError?: string | null }
): Promise<boolean> {
  const result = await db.query(
    `update forensic_check_jobs
     set progress_json = $2,
       last_error = $3,
       updated_at = now()
     where id = $1 and status = 'running'`,
    [input.id, input.progressJson, input.lastError ?? null]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function completeForensicCheckJob(
  db: Db,
  input: {
    id: string;
    status: Exclude<ForensicCheckJobStatus, "queued" | "running" | "cancelled">;
    progressJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    rawEvidenceIds: string[];
    observationIds: string[];
    lastError: string | null;
  }
): Promise<boolean> {
  const result = await db.query(
    `update forensic_check_jobs
     set status = $2,
       progress_json = $3,
       result_json = $4,
       raw_evidence_ids = $5,
       observation_ids = $6,
       last_error = $7,
       completed_at = now(),
       updated_at = now()
     where id = $1`,
    [
      input.id,
      input.status,
      input.progressJson,
      input.resultJson,
      JSON.stringify(input.rawEvidenceIds),
      JSON.stringify(input.observationIds),
      input.lastError
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getForensicCheckJob(db: Db, id: string): Promise<ForensicCheckJob | null> {
  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs where id = $1`,
    [id]
  );
  return result.rows[0] ? mapForensicCheckJobRow(result.rows[0]) : null;
}

export async function getLatestForensicCheckJobForAddress(db: Db, address: string): Promise<ForensicCheckJob | null> {
  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     where subject_address = $1 and kind = 'address_deep_check'
     order by created_at desc
     limit 1`,
    [address]
  );
  return result.rows[0] ? mapForensicCheckJobRow(result.rows[0]) : null;
}

export async function getLatestWhereIsMoneyCheckJobForAddress(
  db: Db,
  input: {
    subjectAddress: string;
    chatId: string | null;
    requestedBy: string | null;
    windowStart: Date | null;
    windowEnd: Date | null;
  }
): Promise<ForensicCheckJob | null> {
  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     where subject_address = $1
       and chat_id is not distinct from $2
       and requested_by is not distinct from $3
       and window_start is not distinct from $4
       and window_end is not distinct from $5
       and kind = 'where_is_money_check'
       and status in ('completed', 'partial')
     order by completed_at desc nulls last, created_at desc
     limit 1`,
    [input.subjectAddress, input.chatId, input.requestedBy, input.windowStart, input.windowEnd]
  );
  return result.rows[0] ? mapForensicCheckJobRow(result.rows[0]) : null;
}

export async function getLatestDeepForensicCheckJobForAddress(
  db: Db,
  input: {
    subjectAddress: string;
    chatId: string | null;
    requestedBy: string | null;
    windowStart: Date | null;
    windowEnd: Date | null;
  }
): Promise<ForensicCheckJob | null> {
  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     where subject_address = $1
       and chat_id is not distinct from $2
       and requested_by is not distinct from $3
       and window_start is not distinct from $4
       and window_end is not distinct from $5
       and kind = 'address_deep_check'
       and status in ('completed', 'partial')
     order by completed_at desc nulls last, created_at desc
     limit 1`,
    [input.subjectAddress, input.chatId, input.requestedBy, input.windowStart, input.windowEnd]
  );
  return result.rows[0] ? mapForensicCheckJobRow(result.rows[0]) : null;
}

export async function listAdminForensicCheckJobs(
  db: Db,
  input: ListAdminForensicCheckJobsInput = {}
): Promise<ForensicCheckJob[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = [];

  if (input.status) {
    params.push(parseForensicCheckJobStatus(input.status));
    where.push(`status = $${params.length}`);
  }
  if (input.kind) {
    params.push(parseForensicCheckJobKind(input.kind));
    where.push(`kind = $${params.length}`);
  }
  if (input.subjectAddress) {
    params.push(input.subjectAddress);
    where.push(`subject_address = $${params.length}`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await db.query(
    `select id, kind, subject_address, status, window_start, window_end,
       priority, chat_id, message_id, requested_by, progress_json, result_json,
       raw_evidence_ids, observation_ids, last_error, created_at, updated_at,
       started_at, completed_at
     from forensic_check_jobs
     ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit ${limitParam} offset ${offsetParam}`,
    params
  );
  return result.rows.map(mapForensicCheckJobRow);
}

export async function saveForensicRouteSearchResult(
  db: Db,
  input: {
    case: ForensicCaseInput;
    rawEvidence: RawEvidenceInput[];
    observations: RiskSignalObservationInput[];
    paths: ForensicRoutePath[];
  }
): Promise<void> {
  parseForensicCaseStatus(input.case.status);
  const client = await db.connect();
  try {
    await client.query("begin");

    await client.query(
      `insert into forensic_cases (
         id, source_address, target_address, amount_usdt,
         window_start, window_end, status
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         source_address = excluded.source_address,
         target_address = excluded.target_address,
         amount_usdt = excluded.amount_usdt,
         window_start = excluded.window_start,
         window_end = excluded.window_end,
         status = excluded.status,
         updated_at = now()`,
      [
        input.case.id,
        input.case.sourceAddress,
        input.case.targetAddress,
        input.case.amountUsdt,
        input.case.windowStart,
        input.case.windowEnd,
        input.case.status
      ]
    );

    await client.query(`delete from forensic_route_paths where case_id = $1`, [input.case.id]);

    for (const evidence of input.rawEvidence) {
      parseRawEvidenceSourceType(evidence.sourceType);
      await client.query(
        `insert into raw_evidence (
           id, source, source_type, chain, address, tx_hash,
           observed_transaction_hash, evidence_json
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           source = excluded.source,
           source_type = excluded.source_type,
           chain = excluded.chain,
           address = excluded.address,
           tx_hash = excluded.tx_hash,
           observed_transaction_hash = excluded.observed_transaction_hash,
           evidence_json = excluded.evidence_json`,
        [
          evidence.id,
          evidence.source,
          evidence.sourceType,
          evidence.chain,
          evidence.address,
          evidence.txHash,
          evidence.observedTransactionHash,
          evidence.evidenceJson
        ]
      );
    }

    for (const observation of input.observations) {
      parseRiskSignalGroup(observation.signalGroup);
      parseRiskConfidence(observation.confidence);
      parseRiskSeverity(observation.severity);
      await client.query(
        `insert into risk_signal_observations (
           id, subject_chain, subject_address, subject_tx_hash,
           observed_transaction_hash, signal_group, code, message,
           score_impact, confidence, severity, source, policy_version,
           raw_evidence_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           subject_chain = excluded.subject_chain,
           subject_address = excluded.subject_address,
           subject_tx_hash = excluded.subject_tx_hash,
           observed_transaction_hash = excluded.observed_transaction_hash,
           signal_group = excluded.signal_group,
           code = excluded.code,
           message = excluded.message,
           score_impact = excluded.score_impact,
           confidence = excluded.confidence,
           severity = excluded.severity,
           source = excluded.source,
           policy_version = excluded.policy_version,
           raw_evidence_id = excluded.raw_evidence_id`,
        [
          observation.id,
          observation.subjectChain,
          observation.subjectAddress,
          observation.subjectTxHash,
          observation.observedTransactionHash,
          observation.signalGroup,
          observation.code,
          observation.message,
          observation.scoreImpact,
          observation.confidence,
          observation.severity,
          observation.source,
          observation.policyVersion,
          observation.rawEvidenceId
        ]
      );
    }

    for (const path of input.paths) {
      parseForensicRouteConfidence(path.confidence);
      await client.query(
        `insert into forensic_route_paths (
           id, case_id, rank, score, confidence, path_addresses,
           features, reasons, raw_evidence_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          path.id,
          path.caseId,
          path.rank,
          path.score,
          path.confidence,
          JSON.stringify(path.pathAddresses),
          JSON.stringify(path.features),
          JSON.stringify(path.reasons),
          path.rawEvidenceId
        ]
      );

      for (const edge of path.edges) {
        parseForensicRouteEdgeType(edge.edgeType);
        await client.query(
          `insert into forensic_route_edges (
             id, path_id, from_address, to_address, tx_hash, amount_raw,
             timestamp, method, edge_type
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            edge.id,
            path.id,
            edge.fromAddress,
            edge.toAddress,
            edge.txHash,
            edge.amountRaw,
            edge.timestamp,
            edge.method,
            edge.edgeType
          ]
        );
      }
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listRecentRiskSignalObservations(
  db: Db,
  input: { subjectAddress: string; chain?: string; limit?: number }
): Promise<RiskSignalObservationInput[]> {
  const result = await db.query(
    `select id, subject_chain, subject_address, subject_tx_hash,
       observed_transaction_hash, signal_group, code, message, score_impact,
       confidence, severity, source, policy_version, raw_evidence_id
     from risk_signal_observations
     where subject_chain = $1 and subject_address = $2
     order by created_at desc
     limit $3`,
    [input.chain ?? "tron", input.subjectAddress, input.limit ?? 25]
  );
  return result.rows.map(mapRiskSignalObservationRow);
}
