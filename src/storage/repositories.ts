import type {
  AddressLabel,
  ForensicCaseInput,
  ForensicCaseStatus,
  ForensicRouteConfidence,
  ForensicRouteEdgeType,
  ForensicRoutePath,
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
import { deriveActivityLevel, inspectRawContractJson } from "../approvals/contractIntelligence";
import type { Db } from "./db";

export type {
  RawEvidenceInput,
  RiskSignalObservationInput
} from "../types";

export type UserAlertStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type TelegramUserPendingAction =
  | "add_wallet"
  | "check_address"
  | "check_tx"
  | "add_alert_admin"
  | "add_alert_admin_all"
  | "add_alert_admin_suspicious_only"
  | "remove_alert_admin";
export type CustomerAlertMode = "all" | "suspicious_only";

export type TelegramUserSession = {
  telegramUserId: string;
  pendingAction: TelegramUserPendingAction | null;
  selectedWalletId: string | null;
  updatedAt: Date;
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

export type {
  ContractActivityLevel,
  ContractCallerStat,
  ContractIntelligenceProfile,
  ContractMethodStat
};

const riskLabels = new Set<RiskLabel>([
  "scam",
  "stolen_funds",
  "phishing",
  "mule",
  "collector",
  "bridge",
  "exchange",
  "trusted",
  "false_positive",
  "needs_review",
  "mixer_like",
  "risky_contract"
]);

const userAlertStatuses = new Set<UserAlertStatus>(["pending", "sending", "sent", "failed", "skipped"]);
const walletAlertModes = new Set<WalletAlertMode>(["realtime", "risk_only", "digest", "paused"]);
const telegramUserPendingActions = new Set<TelegramUserPendingAction>([
  "add_wallet",
  "check_address",
  "check_tx",
  "add_alert_admin",
  "add_alert_admin_all",
  "add_alert_admin_suspicious_only",
  "remove_alert_admin"
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

function mapTelegramUserSessionRow(row: Record<string, any>): TelegramUserSession {
  return {
    telegramUserId: row.telegram_user_id,
    pendingAction: parseTelegramUserPendingAction(row.pending_action),
    selectedWalletId: row.selected_wallet_id,
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
    digestIntervalMinutes: row.wallet_digest_interval_minutes ?? row.digest_interval_minutes ?? 10
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

export async function upsertTelegramUser(db: Db, input: { telegramUserId: string; username: string | null }): Promise<void> {
  await db.query(
    `insert into telegram_users (telegram_user_id, username)
     values ($1, $2)
     on conflict (telegram_user_id) do update set username = excluded.username`,
    [input.telegramUserId, input.username]
  );
}

export async function getTelegramUserSession(db: Db, telegramUserId: string): Promise<TelegramUserSession | null> {
  const result = await db.query(
    `select telegram_user_id, pending_action, selected_wallet_id, updated_at
     from telegram_user_sessions
     where telegram_user_id = $1`,
    [telegramUserId]
  );
  return result.rows[0] ? mapTelegramUserSessionRow(result.rows[0]) : null;
}

export async function setTelegramUserPendingAction(
  db: Db,
  input: { telegramUserId: string; pendingAction: TelegramUserPendingAction; selectedWalletId?: string | null }
): Promise<void> {
  await db.query(
    `insert into telegram_user_sessions (telegram_user_id, pending_action, selected_wallet_id)
     values ($1, $2, $3)
     on conflict (telegram_user_id) do update set
       pending_action = excluded.pending_action,
       selected_wallet_id = excluded.selected_wallet_id,
       updated_at = now()`,
    [input.telegramUserId, input.pendingAction, input.selectedWalletId ?? null]
  );
}

export async function clearTelegramUserPendingAction(db: Db, telegramUserId: string): Promise<boolean> {
  const result = await db.query(
    `update telegram_user_sessions
     set pending_action = null,
       selected_wallet_id = null,
       updated_at = now()
     where telegram_user_id = $1`,
    [telegramUserId]
  );
  return (result.rowCount ?? 0) > 0;
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
    ? `select w.id, w.telegram_user_id, u.username, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       where w.telegram_user_id = $1 order by w.created_at asc`
    : `select w.id, w.telegram_user_id, u.username, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
       from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
       order by w.created_at asc`;
  const result = await db.query(query, telegramUserId ? [telegramUserId] : []);
  return result.rows.map((row) => ({
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.username,
    address: row.address,
    createdAt: row.created_at,
    alertMode: parseWalletAlertMode(row.alert_mode ?? "realtime"),
    digestIntervalMinutes: row.digest_interval_minutes ?? 10
  }));
}

export async function getWatchedWalletByAddress(db: Db, address: string): Promise<WatchedWallet | null> {
  const result = await db.query(
    `select w.id, w.telegram_user_id, u.username, w.address, w.created_at, w.alert_mode, w.digest_interval_minutes
     from watched_wallets w join telegram_users u on u.telegram_user_id = w.telegram_user_id
     where w.address = $1
     order by w.created_at asc
     limit 1`,
    [address]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.username,
    address: row.address,
    createdAt: row.created_at,
    alertMode: parseWalletAlertMode(row.alert_mode ?? "realtime"),
    digestIntervalMinutes: row.digest_interval_minutes ?? 10
  };
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
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
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
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
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
     where tx_hash = $1 and watched_wallet_id = $2 and user_alert_status = 'sending'`,
    [input.txHash, input.watchedWalletId, boundedUserAlertError(input.reason)]
  );
  return (result.rowCount ?? 0) > 0;
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
  return result.rows.map((row) => ({
    address: row.address,
    label: parseRiskLabel(row.label),
    source: parseLabelSource(row.source),
    createdByTelegramId: row.created_by_telegram_id,
    createdAt: row.created_at
  }));
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
