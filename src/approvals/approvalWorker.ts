import type { InlineKeyboard } from "grammy";
import { approvalAlertKeyboard } from "../alerts/approvalKeyboards";
import {
  formatAdminApprovalAlert,
  formatUserApprovalAlert,
  formatUserApprovalContextResultAlert,
  formatUserApprovalPendingAlert
} from "../alerts/formatters";
import { DEFAULT_BOT_LOCALE } from "../bot/i18n";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type {
  AddressMetadata,
  ContractIntelligenceProfile,
  CustomerAlertRecipient,
  PendingApprovalContextRow,
  ApprovalContextResult,
  WalletApprovalPollState
} from "../storage/repositories";
import type {
  TronscanAddressMetadata,
  TronscanApprovalChange,
  TronscanApprovalListItem,
  TronApprovalClient,
  TronTransactionSigningMetadata
} from "../tron/tronClient";
import type {
  AddressLabel,
  RawEvidenceInput,
  RiskReport,
  RiskSignalObservationInput,
  WatchedWallet,
  WalletApprovalSpenderType,
  ApprovalAllowanceStateV2
} from "../types";
import {
  refreshApprovalAllowance,
  type ApprovalAllowanceRefreshReason
} from "./allowanceRefresh";
import { formatApprovalAllowance, parseUsdtRawAmount } from "./amounts";
import {
  evaluateApprovalRisk,
  type ApprovalGuardEvent,
  type ApprovalProviderMetadata,
  type ApprovalRiskEvaluation
} from "./approvalRisk";
import { nextApprovalState, type ApprovalMonitoringState } from "./approvalStateMachine";
import { isSuspiciousUnknownContractProfile, serviceTagFromContractProfile } from "./contractIntelligence";
import { buildApprovalDrainObservation, type ApprovalDrainObservation } from "./drainObservation";
import {
  APPROVAL_SESSION_LOOKAHEAD_MS,
  APPROVAL_SESSION_LOOKBACK_MS,
  buildApprovalSessionContext,
  type ApprovalSessionContext
} from "./sessionContext";

type ApprovalPollSuccessInput = {
  watchedWalletId: string;
  lastSeenApprovalTs: Date | null;
  lastSeenTxHash: string | null;
  lastSuccessfulPollAt: Date;
};

type WalletApprovalInput = {
  watchedWalletId: string;
  tokenContract: string;
  spenderAddress: string;
  amountRaw: string;
  isUnlimited: boolean;
  currentAllowanceRaw?: string;
  spenderType: WalletApprovalSpenderType;
  status?: "active" | "revoked" | "unknown";
  lastApprovalTxHash: string | null;
  lastApprovalAt: Date | null;
  riskLevel: RiskReport["level"];
  riskScore: number;
  riskReasons: RiskReport["reasons"];
  lastAlertedTxHash?: string | null;
};

type ObservedApprovalInput = {
  approvalTxHash: string;
  watchedWalletId: string;
  ownerAddress: string;
  tokenContract: string;
  spenderAddress: string;
  spenderType: WalletApprovalSpenderType;
  amountRaw: string;
  isUnlimited: boolean;
  approvalAt: Date;
};

type ApprovalHistoryClient = Omit<TronApprovalClient, "getUsdtAllowance">;
type AllowanceRefreshDeps = {
  now?: () => Date;
  getUsdtAllowance(input: { ownerAddress: string; spenderAddress: string }): Promise<string>;
  saveWalletApprovalAllowanceStateV2(input: {
    watchedWalletId: string;
    allowance: ApprovalAllowanceStateV2;
  }): Promise<void>;
};

const DEFAULT_METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CONTRACT_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_APPROVAL_CONTEXT_SCORE = 70;
const VERY_LARGE_FINITE_USDT_RAW = 50_000n * 1_000_000n;

export type ApprovalPollingCycleDeps = {
  wallets: WatchedWallet[];
  tronClient: ApprovalHistoryClient;
  pageLimit: number;
  maxPagesPerWallet: number;
  now?: () => Date;
  isWatchedWalletActive?(watchedWalletId: string): Promise<boolean>;
  getApprovalPollState(watchedWalletId: string): Promise<WalletApprovalPollState | null>;
  recordApprovalPollSuccess(input: ApprovalPollSuccessInput): Promise<void>;
  recordApprovalPollFailure(input: { watchedWalletId: string; error: string }): Promise<void>;
  upsertWalletApproval(input: WalletApprovalInput): Promise<void>;
  claimObservedApprovalEvent(input: ObservedApprovalInput): Promise<boolean>;
  getUsdtAllowance(input: { ownerAddress: string; spenderAddress: string }): Promise<string>;
  saveWalletApprovalAllowanceStateV2(input: {
    watchedWalletId: string;
    allowance: ApprovalAllowanceStateV2;
  }): Promise<void>;
  allowanceRefreshReason?: ApprovalAllowanceRefreshReason;
  recordApprovalRisk(input: { approvalTxHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  markApprovalContextPending?(input: {
    approvalTxHash: string;
    watchedWalletId: string;
    contextDeadlineAt: Date;
    initialReport: RiskReport;
  }): Promise<boolean>;
  claimObservedApprovalDrainEvent?(input: {
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
  }): Promise<boolean>;
  markApprovalOwnerAlertSent(input: { approvalTxHash: string; watchedWalletId: string }): Promise<boolean>;
  markApprovalOwnerAlertSkipped(input: { approvalTxHash: string; watchedWalletId: string; reason: string }): Promise<boolean>;
  markApprovalOwnerAlertFailed(input: { approvalTxHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getAddressMetadata?(address: string, now: Date): Promise<AddressMetadata | null>;
  upsertAddressMetadata?(input: AddressMetadata): Promise<void>;
  metadataTtlMs?: number;
  getContractIntelligenceProfile?(address: string, now: Date): Promise<ContractIntelligenceProfile | null>;
  upsertContractIntelligenceProfile?(input: ContractIntelligenceProfile): Promise<void>;
  contractProfileTtlMs?: number;
  recordRiskEvaluation?(evaluation: { rawEvidence: RawEvidenceInput[]; observations: RiskSignalObservationInput[] }): Promise<void>;
  listCustomerAlertRecipients?(ownerTelegramUserId: string): Promise<CustomerAlertRecipient[]>;
  sendUserAlert(telegramUserId: string, message: string, options?: { reply_markup?: InlineKeyboard; parse_mode?: "HTML" }): Promise<void>;
  sendCustomerAdminAlert?(telegramUserId: string, message: string, options?: { reply_markup?: InlineKeyboard; parse_mode?: "HTML" }): Promise<void>;
  sendAdminAlert(message: string, options?: { parse_mode?: "HTML" }): Promise<void>;
  recheckExistingApprovals?: boolean;
  suppressApprovalAlerts?: boolean;
  approvalChangeLookupLimit?: number;
  targetApprovalTxHash?: string;
  approvalFilter?(approval: TronscanApprovalListItem): boolean;
  approvalEventFilter?(event: ApprovalGuardEvent): boolean;
  logger?: Logger;
};

export type ApprovalContextFinalizerDeps = {
  tronClient: ApprovalHistoryClient;
  pageLimit: number;
  maxPagesPerWallet: number;
  now?: () => Date;
  claimDueApprovalContexts(input: { now: Date; limit: number }): Promise<PendingApprovalContextRow[]>;
  markApprovalContextResolved(input: {
    approvalTxHash: string;
    watchedWalletId: string;
    result: Exclude<ApprovalContextResult, "no_route_found" | "unknown">;
    finalReport: RiskReport;
  }): Promise<boolean>;
  markApprovalContextExpired(input: {
    approvalTxHash: string;
    watchedWalletId: string;
    finalReport: RiskReport;
  }): Promise<boolean>;
  markApprovalContextFinalAlertSent(input: { approvalTxHash: string; watchedWalletId: string; sentAt: Date }): Promise<boolean>;
  releaseApprovalContextAfterFailure(input: { approvalTxHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  getUsdtAllowance(input: { ownerAddress: string; spenderAddress: string }): Promise<string>;
  saveWalletApprovalAllowanceStateV2(input: {
    watchedWalletId: string;
    allowance: ApprovalAllowanceStateV2;
  }): Promise<void>;
  upsertWalletApproval(input: WalletApprovalInput): Promise<void>;
  recordApprovalRisk(input: { approvalTxHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getAddressMetadata?(address: string, now: Date): Promise<AddressMetadata | null>;
  upsertAddressMetadata?(input: AddressMetadata): Promise<void>;
  metadataTtlMs?: number;
  getContractIntelligenceProfile?(address: string, now: Date): Promise<ContractIntelligenceProfile | null>;
  upsertContractIntelligenceProfile?(input: ContractIntelligenceProfile): Promise<void>;
  contractProfileTtlMs?: number;
  recordRiskEvaluation?(evaluation: { rawEvidence: RawEvidenceInput[]; observations: RiskSignalObservationInput[] }): Promise<void>;
  listCustomerAlertRecipients?(ownerTelegramUserId: string): Promise<CustomerAlertRecipient[]>;
  sendUserAlert(telegramUserId: string, message: string, options?: { reply_markup?: InlineKeyboard; parse_mode?: "HTML" }): Promise<void>;
  sendCustomerAdminAlert?(telegramUserId: string, message: string, options?: { reply_markup?: InlineKeyboard; parse_mode?: "HTML" }): Promise<void>;
  sendAdminAlert(message: string, options?: { parse_mode?: "HTML" }): Promise<void>;
  logger?: Logger;
  limit?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshAllowanceAtTrigger(
  event: ApprovalGuardEvent,
  watchedWalletId: string,
  reason: ApprovalAllowanceRefreshReason,
  deps: AllowanceRefreshDeps
): Promise<ApprovalAllowanceStateV2> {
  const allowance = await refreshApprovalAllowance({
    client: { getUsdtAllowance: deps.getUsdtAllowance },
    ownerAddress: event.ownerAddress,
    spenderAddress: event.spenderAddress,
    observedApprovalTxHash: event.txHash,
    now: (deps.now ?? (() => new Date()))(),
    reason
  });
  await deps.saveWalletApprovalAllowanceStateV2({ watchedWalletId, allowance });
  return allowance;
}

function currentAllowanceView(allowance: ApprovalAllowanceStateV2): {
  currentAllowanceRaw?: string;
  status: "active" | "revoked" | "unknown";
} {
  if (allowance.state === "confirmed_active") {
    return { currentAllowanceRaw: allowance.confirmedAllowanceRaw!, status: "active" };
  }
  if (allowance.state === "confirmed_zero") {
    return { currentAllowanceRaw: "0", status: "revoked" };
  }
  return { status: "unknown" };
}

function isWatchedWalletForeignKeyError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = errorMessage(error).toLowerCase();
  return code === "23503" && message.includes("watched_wallet")
    || message.includes("violates foreign key constraint") && message.includes("watched_wallet");
}

async function isStaleWatchedWallet(wallet: WatchedWallet, deps: ApprovalPollingCycleDeps): Promise<boolean> {
  if (!deps.isWatchedWalletActive) return false;
  return !(await deps.isWatchedWalletActive(wallet.id));
}

function logStaleWalletSkip(wallet: WatchedWallet, deps: ApprovalPollingCycleDeps, event: string, error?: unknown): void {
  (deps.logger ?? defaultLogger).warn(event, {
    wallet_id: wallet.id,
    address: wallet.address,
    error: error ? errorMessage(error) : undefined
  });
}

function spenderTypeFromApproval(approval: TronscanApprovalListItem): WalletApprovalSpenderType {
  if (approval.spenderIsContract === true) return "contract";
  if (approval.spenderIsContract === false) return "eoa";
  return "unknown";
}

function isSuccessfulConfirmedChange(change: TronscanApprovalChange): boolean {
  if (!change.confirmed) return false;
  if (change.contractRet && change.contractRet !== "SUCCESS") return false;
  return true;
}

function newestEvent(events: ApprovalGuardEvent[]): ApprovalGuardEvent | null {
  if (events.length === 0) return null;
  return [...events].sort((a, b) => {
    const byTime = b.timestamp.getTime() - a.timestamp.getTime();
    if (byTime !== 0) return byTime;
    return b.txHash.localeCompare(a.txHash);
  })[0];
}

function shouldNotifyAdmins(level: RiskReport["level"]): boolean {
  return level === "HIGH" || level === "CRITICAL";
}

function shouldNotifyCustomerAdmin(_recipient: CustomerAlertRecipient, _level: RiskReport["level"]): boolean {
  return true;
}

function allowanceType(event: ApprovalGuardEvent): string {
  return event.isUnlimited ? "unlimited" : "finite";
}

function metadataIdentity(metadata: AddressMetadata | null): string | null {
  return metadata?.name ?? metadata?.tag ?? null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateFromMaybeMs(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function providerRiskFromMetadata(metadata: AddressMetadata): boolean | null {
  const contractSearch = isObjectRecord(metadata.rawJson.contractSearch) ? metadata.rawJson.contractSearch : null;
  const risk = contractSearch?.risk;
  return typeof risk === "boolean" ? risk : null;
}

function contractCreatedAtFromMetadata(metadata: AddressMetadata): Date | null {
  const contractSearch = isObjectRecord(metadata.rawJson.contractSearch) ? metadata.rawJson.contractSearch : null;
  return dateFromMaybeMs(contractSearch?.dateCreated);
}

function metadataNeedsContractSearchRefresh(metadata: AddressMetadata | null): boolean {
  if (!metadata || metadata.isContract !== true) return false;
  return !isObjectRecord(metadata.rawJson.contractSearch);
}

function metadataToProviderMetadata(metadata: AddressMetadata | null): ApprovalProviderMetadata | null {
  if (!metadata) return null;
  return {
    name: metadata.name,
    tag: metadata.tag,
    isContract: metadata.isContract,
    verified: metadata.verified,
    providerRisk: providerRiskFromMetadata(metadata),
    accountType: metadata.accountType,
    contractCreatedAt: contractCreatedAtFromMetadata(metadata)
  };
}

function hasStrongProviderServiceTag(metadata: AddressMetadata | null): boolean {
  if (!metadata || metadata.isContract !== true || providerRiskFromMetadata(metadata) === true) return false;
  const text = (metadata.tag ?? "").toLowerCase();
  return [
    "bridge",
    "cross-chain",
    "cross chain",
    "swap",
    "router",
    "dex",
    "exchange",
    "payment",
    "energy",
    "bandwidth",
    "staking"
  ].some((keyword) => text.includes(keyword));
}

function hasRiskyLabel(labels: AddressLabel[]): boolean {
  return labels.some((label) => label.label === "scam" || label.label === "stolen_funds" || label.label === "phishing" || label.label === "risky_contract");
}

function hasUnlimitedOrVeryLargeAllowance(event: ApprovalGuardEvent): boolean {
  if (event.isUnlimited) return true;
  const amountRaw = parseUsdtRawAmount(event.amountRaw);
  return amountRaw !== null && amountRaw >= VERY_LARGE_FINITE_USDT_RAW;
}

function shouldPendApprovalContext(input: {
  event: ApprovalGuardEvent;
  labels: AddressLabel[];
  metadata: AddressMetadata | null;
  contractProfile: ContractIntelligenceProfile | null;
  now: Date;
  suppressApprovalAlerts?: boolean;
  canPersistPending: boolean;
}): boolean {
  if (input.suppressApprovalAlerts || !input.canPersistPending) return false;
  if (input.event.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (input.event.spenderType !== "contract") return false;
  if (!hasUnlimitedOrVeryLargeAllowance(input.event)) return false;
  if (input.now.getTime() >= input.event.timestamp.getTime() + APPROVAL_SESSION_LOOKAHEAD_MS) return false;
  if (hasRiskyLabel(input.labels)) return false;
  if (input.metadata && providerRiskFromMetadata(input.metadata) === true) return false;
  if (hasStrongProviderServiceTag(input.metadata)) return false;
  if (serviceTagFromContractProfile(input.contractProfile)) return false;
  return isSuspiciousUnknownContractProfile(input.contractProfile);
}

function pendingContextReason(baseScore: number): RiskReport["reasons"][number] {
  return {
    code: "approval_context_pending",
    message: "Waiting up to 10 min for related swap/bridge route context",
    scoreImpact: Math.max(0, PENDING_APPROVAL_CONTEXT_SCORE - baseScore),
    source: "approval_context_finalizer",
    confidence: "medium",
    severity: "medium"
  };
}

function pendingContextReport(event: ApprovalGuardEvent, baseReport: RiskReport): RiskReport {
  return {
    subjectAddress: event.spenderAddress,
    level: "HIGH",
    score: PENDING_APPROVAL_CONTEXT_SCORE,
    reasons: [...baseReport.reasons, pendingContextReason(baseReport.score)]
  };
}

function annotateRiskReportState(report: RiskReport, state: ApprovalMonitoringState): RiskReport {
  return {
    ...report,
    reasons: report.reasons.map((item, index) => index === 0
      ? { ...item, message: `${item.message}; approval monitoring state: ${state}` }
      : item)
  };
}

function annotateApprovalEvaluationState(
  evaluation: ApprovalRiskEvaluation,
  state: ApprovalMonitoringState
): ApprovalRiskEvaluation {
  return {
    ...evaluation,
    report: annotateRiskReportState(evaluation.report, state),
    rawEvidence: evaluation.rawEvidence.map((item) => ({
      ...item,
      evidenceJson: {
        ...item.evidenceJson,
        approvalMonitoringState: state
      }
    })),
    observations: evaluation.observations.map((item, index) => index === 0
      ? { ...item, message: `${item.message}; approval monitoring state: ${state}` }
      : item)
  };
}

function approvalMonitoringStateForSession(sessionContext: ApprovalSessionContext | null): ApprovalMonitoringState {
  if (sessionContext?.classification === "known_swap_route" || sessionContext?.classification === "service_linked_helper") {
    return "route_linked";
  }
  if (sessionContext?.classification === "possible_collector_drain") {
    return nextApprovalState({
      current: "approval_only",
      approvalObserved: true,
      transferFromObserved: true,
      serviceRouteGuarded: false,
      pathToCheckedWallet: false
    });
  }
  return nextApprovalState({
    current: "none",
    approvalObserved: true,
    transferFromObserved: false,
    serviceRouteGuarded: false,
    pathToCheckedWallet: false
  });
}

function contextDeadline(event: ApprovalGuardEvent): Date {
  return new Date(event.timestamp.getTime() + APPROVAL_SESSION_LOOKAHEAD_MS);
}

function metadataToAddressMetadata(
  metadata: TronscanAddressMetadata,
  now: Date,
  ttlMs: number
): AddressMetadata {
  return {
    address: metadata.address,
    source: metadata.source,
    name: metadata.name,
    tag: metadata.tag,
    isContract: metadata.isContract,
    verified: metadata.verified,
    accountType: metadata.accountType,
    rawJson: metadata.rawJson,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs)
  };
}

async function resolveAddressMetadata(address: string, deps: ApprovalPollingCycleDeps): Promise<AddressMetadata | null> {
  const now = (deps.now ?? (() => new Date()))();
  const cached = await deps.getAddressMetadata?.(address, now);
  if (cached && !metadataNeedsContractSearchRefresh(cached)) return cached;
  if (!deps.tronClient.getAddressMetadata) return cached ?? null;

  try {
    const providerMetadata = await deps.tronClient.getAddressMetadata(address);
    const metadata = metadataToAddressMetadata(providerMetadata, now, deps.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS);
    await deps.upsertAddressMetadata?.(metadata);
    return metadata;
  } catch (error) {
    (deps.logger ?? defaultLogger).warn("approval_address_metadata_fetch_failed", {
      address,
      error: errorMessage(error)
    });
    return cached ?? null;
  }
}

async function resolveContractIntelligenceProfile(
  address: string,
  metadata: AddressMetadata | null,
  deps: ApprovalPollingCycleDeps
): Promise<ContractIntelligenceProfile | null> {
  if (metadata?.isContract !== true) return null;
  const now = (deps.now ?? (() => new Date()))();
  const cached = await deps.getContractIntelligenceProfile?.(address, now);
  if (cached) return cached;
  if (!deps.tronClient.getContractIntelligenceProfile) return null;

  try {
    const profile = await deps.tronClient.getContractIntelligenceProfile(address, {
      now,
      ttlMs: deps.contractProfileTtlMs ?? DEFAULT_CONTRACT_PROFILE_TTL_MS
    });
    await deps.upsertContractIntelligenceProfile?.(profile);
    return profile;
  } catch (error) {
    (deps.logger ?? defaultLogger).warn("approval_contract_intelligence_fetch_failed", {
      address,
      error: errorMessage(error)
    });
    return null;
  }
}

function finalSpenderType(
  approval: TronscanApprovalListItem,
  metadata: AddressMetadata | null
): WalletApprovalSpenderType {
  if (metadata?.isContract === true) return "contract";
  if (metadata?.isContract === false) return "eoa";
  return spenderTypeFromApproval(approval);
}

async function collectCurrentApprovals(wallet: WatchedWallet, deps: ApprovalPollingCycleDeps): Promise<TronscanApprovalListItem[]> {
  const approvals: TronscanApprovalListItem[] = [];
  for (let pageIndex = 0; pageIndex < deps.maxPagesPerWallet; pageIndex += 1) {
    const start = pageIndex * deps.pageLimit;
    const page = await deps.tronClient.listTrc20Approvals(wallet.address, {
      start,
      limit: deps.pageLimit
    });
    const usdtApprovals = page.approvals.filter((approval) => approval.tokenContract === TRON_USDT_CONTRACT_ADDRESS);
    approvals.push(...usdtApprovals);

    (deps.logger ?? defaultLogger).info("wallet_approval_page_fetched", {
      wallet_id: wallet.id,
      address: wallet.address,
      page_start: start,
      page_limit: deps.pageLimit,
      approval_count: page.approvals.length,
      usdt_approval_count: usdtApprovals.length
    });

    if (page.approvals.length < deps.pageLimit) break;
  }
  return approvals;
}

async function newestApprovalChange(
  approval: TronscanApprovalListItem,
  deps: ApprovalPollingCycleDeps
): Promise<TronscanApprovalChange | null> {
  const changes = await deps.tronClient.listTrc20ApprovalChanges({
    ownerAddress: approval.ownerAddress,
    spenderAddress: approval.spenderAddress,
    contractAddress: approval.tokenContract,
    start: 0,
    limit: deps.approvalChangeLookupLimit ?? 1
  });
  if (deps.targetApprovalTxHash) {
    return changes.find((change) => change.txHash === deps.targetApprovalTxHash && isSuccessfulConfirmedChange(change)) ?? null;
  }
  return changes.find(isSuccessfulConfirmedChange) ?? null;
}

async function resolveSigningMetadata(
  txHash: string,
  deps: ApprovalPollingCycleDeps
): Promise<TronTransactionSigningMetadata | null> {
  if (!deps.tronClient.getTransactionSigningMetadata) return null;
  try {
    return await deps.tronClient.getTransactionSigningMetadata(txHash);
  } catch (error) {
    (deps.logger ?? defaultLogger).warn("approval_signing_metadata_fetch_failed", {
      approval_tx_hash: txHash,
      error: errorMessage(error)
    });
    return null;
  }
}

async function persistApprovalDrainObservation(
  observation: ApprovalDrainObservation,
  deps: ApprovalPollingCycleDeps
): Promise<boolean> {
  if (!deps.claimObservedApprovalDrainEvent) return false;

  await deps.recordRiskEvaluation?.({
    rawEvidence: observation.rawEvidence,
    observations: observation.observations
  });

  return deps.claimObservedApprovalDrainEvent({
    id: observation.id,
    watchedWalletId: observation.watchedWalletId,
    approvalTxHash: observation.approvalTxHash,
    transferTxHash: observation.transferTxHash,
    ownerAddress: observation.ownerAddress,
    spenderAddress: observation.spenderAddress,
    receiverAddress: observation.receiverAddress,
    tokenContract: observation.tokenContract,
    amountRaw: observation.amountRaw,
    callerAddress: observation.callerAddress,
    method: observation.method,
    approvalAt: observation.approvalAt,
    transferAt: observation.transferAt,
    timeToTransferMs: observation.timeToTransferMs,
    spenderType: observation.spenderType,
    receiverType: observation.receiverType,
    report: observation.report,
    rawEvidenceId: observation.rawEvidence[0]?.id ?? null
  });
}

async function observeApprovalDrainShadow(
  wallet: WatchedWallet,
  event: ApprovalGuardEvent,
  spenderMetadata: AddressMetadata | null,
  deps: ApprovalPollingCycleDeps
): Promise<void> {
  if (!deps.tronClient.listRelatedTrc20Transfers || !deps.tronClient.getTransaction || !deps.claimObservedApprovalDrainEvent) {
    return;
  }

  let observedCount = 0;
  for (let pageIndex = 0; pageIndex < deps.maxPagesPerWallet; pageIndex += 1) {
    const start = pageIndex * deps.pageLimit;
    const transfers = await deps.tronClient.listRelatedTrc20Transfers(wallet.address, {
      start,
      limit: deps.pageLimit,
      minTimestamp: event.timestamp.getTime(),
      endTimestamp: (deps.now ?? (() => new Date()))().getTime()
    });

    for (const transfer of transfers) {
      if (transfer.from_address !== event.ownerAddress) continue;
      if (transfer.to_address === event.spenderAddress) continue;

      const transactionInfo = await deps.tronClient.getTransaction(transfer.transaction_id);
      const candidate = buildApprovalDrainObservation({
        watchedWalletId: wallet.id,
        approval: event,
        transfer,
        transactionInfo,
        spenderMetadata,
        receiverMetadata: null
      });
      if (!candidate) continue;

      const receiverMetadata = await resolveAddressMetadata(candidate.receiverAddress, deps);
      const observation = buildApprovalDrainObservation({
        watchedWalletId: wallet.id,
        approval: event,
        transfer,
        transactionInfo,
        spenderMetadata,
        receiverMetadata
      });
      if (!observation) continue;

      const claimed = await persistApprovalDrainObservation(observation, deps);
      if (claimed) observedCount += 1;
    }

    if (transfers.length < deps.pageLimit) break;
  }

  if (observedCount > 0) {
    (deps.logger ?? defaultLogger).warn("approval_drain_shadow_observed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      spender_address: event.spenderAddress,
      observed_count: observedCount
    });
  }
}

function isCandidateSessionTransfer(transfer: RawTronscanTrc20Transfer, event: ApprovalGuardEvent): boolean {
  if (transfer.contract_address !== TRON_USDT_CONTRACT_ADDRESS && transfer.tokenInfo?.tokenId !== TRON_USDT_CONTRACT_ADDRESS) {
    return false;
  }
  if (transfer.from_address !== event.ownerAddress) return false;
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") return false;
  if (typeof transfer.block_ts !== "number" || !Number.isFinite(transfer.block_ts)) return false;
  return transfer.block_ts >= event.timestamp.getTime() - APPROVAL_SESSION_LOOKBACK_MS &&
    transfer.block_ts <= event.timestamp.getTime() + APPROVAL_SESSION_LOOKAHEAD_MS;
}

async function resolveApprovalSessionContext(
  wallet: WatchedWallet,
  event: ApprovalGuardEvent,
  deps: ApprovalPollingCycleDeps,
  throwOnError = false
): Promise<ApprovalSessionContext | null> {
  if (!deps.tronClient.listRelatedTrc20Transfers || !deps.tronClient.getTransaction) return null;

  try {
    const relatedTransfers = await deps.tronClient.listRelatedTrc20Transfers(wallet.address, {
      start: 0,
      limit: deps.pageLimit,
      minTimestamp: event.timestamp.getTime() - APPROVAL_SESSION_LOOKBACK_MS,
      endTimestamp: event.timestamp.getTime() + APPROVAL_SESSION_LOOKAHEAD_MS
    });
    const candidateTransfers = relatedTransfers.filter((transfer) => isCandidateSessionTransfer(transfer, event));
    const transactionDetails = new Map<string, unknown>();
    const addressMetadata = new Map<string, AddressMetadata | null>();

    for (const transfer of candidateTransfers) {
      if (!transactionDetails.has(transfer.transaction_id)) {
        transactionDetails.set(transfer.transaction_id, await deps.tronClient.getTransaction(transfer.transaction_id));
      }
      if (!addressMetadata.has(transfer.to_address)) {
        addressMetadata.set(transfer.to_address, await resolveAddressMetadata(transfer.to_address, deps));
      }
    }

    return buildApprovalSessionContext({
      watchedWalletId: wallet.id,
      approval: event,
      relatedTransfers: candidateTransfers,
      transactionDetails,
      addressMetadata,
      now: (deps.now ?? (() => new Date()))()
    });
  } catch (error) {
    if (throwOnError) throw error;
    (deps.logger ?? defaultLogger).warn("approval_session_context_fetch_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      spender_address: event.spenderAddress,
      error: errorMessage(error)
    });
    return null;
  }
}

function eventFromApprovalChange(
  approval: TronscanApprovalListItem,
  change: TronscanApprovalChange,
  spenderType: WalletApprovalSpenderType,
  signingMetadata: TronTransactionSigningMetadata | null
): ApprovalGuardEvent {
  return {
    txHash: change.txHash,
    ownerAddress: change.ownerAddress,
    spenderAddress: change.spenderAddress,
    tokenContract: change.tokenContract,
    amountRaw: change.amountRaw,
    isUnlimited: change.isUnlimited || approval.isUnlimited,
    timestamp: change.timestamp,
    spenderType,
    signedAt: signingMetadata?.signedAt ?? null,
    expirationAt: signingMetadata?.expirationAt ?? null,
    refBlockBytes: signingMetadata?.refBlockBytes ?? null,
    refBlockHash: signingMetadata?.refBlockHash ?? null
  };
}

async function markAlertFailedSafely(
  event: ApprovalGuardEvent,
  wallet: WatchedWallet,
  error: string,
  deps: ApprovalPollingCycleDeps
): Promise<void> {
  try {
    await deps.markApprovalOwnerAlertFailed({ approvalTxHash: event.txHash, watchedWalletId: wallet.id, error });
  } catch (statusError) {
    (deps.logger ?? defaultLogger).error("approval_alert_failed_status_update_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      error: errorMessage(statusError)
    });
  }
}

async function sendServiceAdminApprovalAlert(
  event: ApprovalGuardEvent,
  wallet: WatchedWallet,
  report: RiskReport,
  metadata: AddressMetadata | null,
  deps: ApprovalPollingCycleDeps
): Promise<void> {
  if (!shouldNotifyAdmins(report.level)) return;
  try {
    const alert = formatAdminApprovalAlert({
      telegramUserId: wallet.telegramUserId,
      telegramUsername: wallet.telegramUsername,
      watchedWallet: wallet.address,
      spender: event.spenderAddress,
      spenderType: event.spenderType,
      spenderIdentity: metadataIdentity(metadata),
      approvalTxHash: event.txHash,
      report
    });
    await deps.sendAdminAlert(alert.text, { parse_mode: alert.parseMode });
  } catch (error) {
    (deps.logger ?? defaultLogger).error("approval_service_admin_alert_delivery_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      error: errorMessage(error)
    });
  }
}

async function sendCustomerAdminApprovalAlerts(
  event: ApprovalGuardEvent,
  wallet: WatchedWallet,
  report: RiskReport,
  metadata: AddressMetadata | null,
  deps: ApprovalPollingCycleDeps
): Promise<void> {
  if (wallet.alertMode === "paused") return;

  let recipients: CustomerAlertRecipient[] = [];
  try {
    recipients = (await deps.listCustomerAlertRecipients?.(wallet.telegramUserId)) ?? [];
  } catch (error) {
    (deps.logger ?? defaultLogger).error("approval_customer_recipient_lookup_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      error: errorMessage(error)
    });
    return;
  }

  const message = formatUserApprovalAlert({
    locale: wallet.locale ?? DEFAULT_BOT_LOCALE,
    watchedWallet: wallet.address,
    token: "USDT",
    spender: event.spenderAddress,
    spenderType: event.spenderType,
    spenderIdentity: metadataIdentity(metadata),
    allowanceType: allowanceType(event),
    allowanceAmount: formatApprovalAllowance({ amountRaw: event.amountRaw, isUnlimited: event.isUnlimited }),
    approvalAt: event.timestamp,
    signedAt: event.signedAt ?? null,
    expirationAt: event.expirationAt ?? null,
    approvalTxHash: event.txHash,
    report
  });
  const options = {
    reply_markup: approvalAlertKeyboard({
      txHash: event.txHash,
      spender: event.spenderAddress,
      wallet: wallet.address,
      locale: wallet.locale ?? DEFAULT_BOT_LOCALE
    }),
    parse_mode: message.parseMode
  };

  for (const recipient of recipients) {
    if (!shouldNotifyCustomerAdmin(recipient, report.level)) continue;
    try {
      const send = deps.sendCustomerAdminAlert ?? deps.sendUserAlert;
      await send(recipient.recipientTelegramUserId, message.text, options);
    } catch (error) {
      (deps.logger ?? defaultLogger).error("approval_customer_admin_alert_delivery_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        recipient_telegram_user_id: recipient.recipientTelegramUserId,
        approval_tx_hash: event.txHash,
        error: errorMessage(error)
      });
    }
  }
}

async function sendCustomerAdminApprovalMessage(
  event: ApprovalGuardEvent,
  wallet: WatchedWallet,
  report: RiskReport,
  message: { text: string; parseMode: "HTML" },
  deps: Pick<ApprovalPollingCycleDeps, "listCustomerAlertRecipients" | "sendCustomerAdminAlert" | "sendUserAlert" | "logger">
): Promise<void> {
  if (wallet.alertMode === "paused") return;

  let recipients: CustomerAlertRecipient[] = [];
  try {
    recipients = (await deps.listCustomerAlertRecipients?.(wallet.telegramUserId)) ?? [];
  } catch (error) {
    (deps.logger ?? defaultLogger).error("approval_customer_recipient_lookup_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      approval_tx_hash: event.txHash,
      error: errorMessage(error)
    });
    return;
  }

  const options = {
    reply_markup: approvalAlertKeyboard({
      txHash: event.txHash,
      spender: event.spenderAddress,
      wallet: wallet.address,
      locale: wallet.locale ?? DEFAULT_BOT_LOCALE
    }),
    parse_mode: message.parseMode
  };
  for (const recipient of recipients) {
    if (!shouldNotifyCustomerAdmin(recipient, report.level)) continue;
    try {
      const send = deps.sendCustomerAdminAlert ?? deps.sendUserAlert;
      await send(recipient.recipientTelegramUserId, message.text, options);
    } catch (error) {
      (deps.logger ?? defaultLogger).error("approval_customer_admin_alert_delivery_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        recipient_telegram_user_id: recipient.recipientTelegramUserId,
        approval_tx_hash: event.txHash,
        error: errorMessage(error)
      });
    }
  }
}

async function deliverApprovalAlert(
  event: ApprovalGuardEvent,
  wallet: WatchedWallet,
  evaluation: ApprovalRiskEvaluation,
  metadata: AddressMetadata | null,
  deps: ApprovalPollingCycleDeps
): Promise<void> {
  const report = evaluation.report;
  await sendServiceAdminApprovalAlert(event, wallet, report, metadata, deps);

  if (wallet.alertMode === "paused") {
    await deps.markApprovalOwnerAlertSkipped({ approvalTxHash: event.txHash, watchedWalletId: wallet.id, reason: "paused" });
    return;
  }

  try {
    const alert = formatUserApprovalAlert({
      locale: wallet.locale ?? DEFAULT_BOT_LOCALE,
      watchedWallet: wallet.address,
      token: "USDT",
      spender: event.spenderAddress,
      spenderType: event.spenderType,
      spenderIdentity: metadataIdentity(metadata),
      allowanceType: allowanceType(event),
      allowanceAmount: formatApprovalAllowance({ amountRaw: event.amountRaw, isUnlimited: event.isUnlimited }),
      approvalAt: event.timestamp,
      signedAt: event.signedAt ?? null,
      expirationAt: event.expirationAt ?? null,
      approvalTxHash: event.txHash,
      report
    });
    await deps.sendUserAlert(
      wallet.telegramUserId,
      alert.text,
      {
        reply_markup: approvalAlertKeyboard({
          txHash: event.txHash,
          spender: event.spenderAddress,
          wallet: wallet.address,
          locale: wallet.locale ?? DEFAULT_BOT_LOCALE
        }),
        parse_mode: alert.parseMode
      }
    );
  } catch (error) {
    await markAlertFailedSafely(event, wallet, errorMessage(error), deps);
    return;
  }

  await deps.markApprovalOwnerAlertSent({ approvalTxHash: event.txHash, watchedWalletId: wallet.id });
  await sendCustomerAdminApprovalAlerts(event, wallet, report, metadata, deps);
}

async function deliverPendingApprovalAlert(
  event: ApprovalGuardEvent,
  wallet: WatchedWallet,
  report: RiskReport,
  metadata: AddressMetadata | null,
  deadlineAt: Date,
  deps: ApprovalPollingCycleDeps
): Promise<void> {
  if (wallet.alertMode === "paused") {
    await deps.markApprovalOwnerAlertSkipped({ approvalTxHash: event.txHash, watchedWalletId: wallet.id, reason: "paused" });
    return;
  }

  const alert = formatUserApprovalPendingAlert({
    locale: wallet.locale ?? DEFAULT_BOT_LOCALE,
    watchedWallet: wallet.address,
    token: "USDT",
    spender: event.spenderAddress,
    spenderType: event.spenderType,
    spenderIdentity: metadataIdentity(metadata),
    allowanceType: allowanceType(event),
    allowanceAmount: formatApprovalAllowance({ amountRaw: event.amountRaw, isUnlimited: event.isUnlimited }),
    approvalAt: event.timestamp,
    signedAt: event.signedAt ?? null,
    expirationAt: event.expirationAt ?? null,
    contextDeadlineAt: deadlineAt,
    approvalTxHash: event.txHash,
    report
  });
  try {
    await deps.sendUserAlert(
      wallet.telegramUserId,
      alert.text,
      {
        reply_markup: approvalAlertKeyboard({
          txHash: event.txHash,
          spender: event.spenderAddress,
          wallet: wallet.address,
          locale: wallet.locale ?? DEFAULT_BOT_LOCALE
        }),
        parse_mode: alert.parseMode
      }
    );
  } catch (error) {
    await markAlertFailedSafely(event, wallet, errorMessage(error), deps);
    return;
  }

  await deps.markApprovalOwnerAlertSent({ approvalTxHash: event.txHash, watchedWalletId: wallet.id });
  await sendCustomerAdminApprovalMessage(event, wallet, report, alert, deps);
}

async function processApproval(
  wallet: WatchedWallet,
  approval: TronscanApprovalListItem,
  deps: ApprovalPollingCycleDeps
): Promise<ApprovalGuardEvent | null> {
  const metadata = await resolveAddressMetadata(approval.spenderAddress, deps);
  const spenderType = finalSpenderType(approval, metadata);
  const change = await newestApprovalChange(approval, deps);
  if (!change) {
    await deps.upsertWalletApproval({
      watchedWalletId: wallet.id,
      tokenContract: approval.tokenContract,
      spenderAddress: approval.spenderAddress,
      amountRaw: approval.amountRaw,
      isUnlimited: approval.isUnlimited,
      currentAllowanceRaw: undefined,
      spenderType,
      status: "unknown",
      lastApprovalTxHash: null,
      lastApprovalAt: approval.operateTime,
      riskLevel: "LOW",
      riskScore: 0,
      riskReasons: []
    });
    return null;
  }

  const signingMetadata = await resolveSigningMetadata(change.txHash, deps);
  const event = eventFromApprovalChange(approval, change, spenderType, signingMetadata);
  if (deps.approvalEventFilter && !deps.approvalEventFilter(event)) return null;
  const claimed = await deps.claimObservedApprovalEvent({
    approvalTxHash: event.txHash,
    watchedWalletId: wallet.id,
    ownerAddress: event.ownerAddress,
    tokenContract: event.tokenContract,
    spenderAddress: event.spenderAddress,
    spenderType: event.spenderType,
    amountRaw: event.amountRaw,
    isUnlimited: event.isUnlimited,
    approvalAt: event.timestamp
  });
  if (!claimed && !deps.recheckExistingApprovals) return event;

  try {
    const allowance = await refreshAllowanceAtTrigger(
      event,
      wallet.id,
      deps.allowanceRefreshReason ?? "new_approval_event",
      deps
    );
    const currentAllowance = currentAllowanceView(allowance);
    const contractProfile = await resolveContractIntelligenceProfile(approval.spenderAddress, metadata, deps);
    const labels = await deps.getLabelsForAddress(event.spenderAddress);
    const baseEvaluation = evaluateApprovalRisk({
      event,
      spenderLabels: labels,
      providerMetadata: metadataToProviderMetadata(metadata),
      contractProfile,
      sessionContext: null
    });
    const now = (deps.now ?? (() => new Date()))();
    const shouldPendContext = shouldPendApprovalContext({
      event,
      labels,
      metadata,
      contractProfile,
      now,
      suppressApprovalAlerts: deps.suppressApprovalAlerts,
      canPersistPending: Boolean(deps.markApprovalContextPending)
    });

    if (shouldPendContext) {
      const deadlineAt = contextDeadline(event);
      const pendingBaseEvaluation = annotateApprovalEvaluationState(baseEvaluation, approvalMonitoringStateForSession(null));
      const pendingReport = annotateRiskReportState(
        pendingContextReport(event, baseEvaluation.report),
        approvalMonitoringStateForSession(null)
      );
      await deps.upsertWalletApproval({
        watchedWalletId: wallet.id,
        tokenContract: event.tokenContract,
        spenderAddress: event.spenderAddress,
        amountRaw: event.amountRaw,
        isUnlimited: event.isUnlimited,
        currentAllowanceRaw: currentAllowance.currentAllowanceRaw,
        spenderType: event.spenderType,
        status: currentAllowance.status,
        lastApprovalTxHash: event.txHash,
        lastApprovalAt: event.timestamp,
        riskLevel: pendingReport.level,
        riskScore: pendingReport.score,
        riskReasons: pendingReport.reasons,
        lastAlertedTxHash: event.txHash
      });
      await deps.recordRiskEvaluation?.(pendingBaseEvaluation);
      await deps.recordApprovalRisk({
        approvalTxHash: event.txHash,
        watchedWalletId: wallet.id,
        report: pendingReport
      });
      const markedPending = await deps.markApprovalContextPending?.({
        approvalTxHash: event.txHash,
        watchedWalletId: wallet.id,
        contextDeadlineAt: deadlineAt,
        initialReport: pendingReport
      });
      if (markedPending) {
        await deliverPendingApprovalAlert(event, wallet, pendingReport, metadata, deadlineAt, deps);
        return event;
      }
    }

    const sessionContext = await resolveApprovalSessionContext(wallet, event, deps);
    const evaluation = annotateApprovalEvaluationState(evaluateApprovalRisk({
      event,
      spenderLabels: labels,
      providerMetadata: metadataToProviderMetadata(metadata),
      contractProfile,
      sessionContext
    }), approvalMonitoringStateForSession(sessionContext));
    await deps.upsertWalletApproval({
      watchedWalletId: wallet.id,
      tokenContract: event.tokenContract,
      spenderAddress: event.spenderAddress,
      amountRaw: event.amountRaw,
      isUnlimited: event.isUnlimited,
      currentAllowanceRaw: currentAllowance.currentAllowanceRaw,
      spenderType: event.spenderType,
      status: currentAllowance.status,
      lastApprovalTxHash: event.txHash,
      lastApprovalAt: event.timestamp,
      riskLevel: evaluation.report.level,
      riskScore: evaluation.report.score,
      riskReasons: evaluation.report.reasons,
      lastAlertedTxHash: evaluation.shouldAlert ? event.txHash : null
    });
    await deps.recordRiskEvaluation?.({
      rawEvidence: [...evaluation.rawEvidence, ...(sessionContext?.rawEvidence ?? [])],
      observations: [...evaluation.observations, ...(sessionContext?.observations ?? [])]
    });
    await deps.recordApprovalRisk({
      approvalTxHash: event.txHash,
      watchedWalletId: wallet.id,
      report: evaluation.report
    });

    try {
      await observeApprovalDrainShadow(wallet, event, metadata, deps);
    } catch (error) {
      (deps.logger ?? defaultLogger).error("approval_drain_shadow_observation_failed", {
        wallet_id: wallet.id,
        address: wallet.address,
        approval_tx_hash: event.txHash,
        spender_address: event.spenderAddress,
        error: errorMessage(error)
      });
    }

    if (deps.suppressApprovalAlerts) {
      await deps.markApprovalOwnerAlertSkipped({
        approvalTxHash: event.txHash,
        watchedWalletId: wallet.id,
        reason: "safety_recheck"
      });
      return event;
    }

    await deliverApprovalAlert(event, wallet, evaluation, metadata, deps);
    return event;
  } catch (error) {
    if (claimed) {
      await markAlertFailedSafely(event, wallet, errorMessage(error), deps);
    }
    throw error;
  }
}

function eventFromPendingContext(row: PendingApprovalContextRow, signingMetadata: TronTransactionSigningMetadata | null): ApprovalGuardEvent {
  return {
    txHash: row.approvalTxHash,
    ownerAddress: row.ownerAddress,
    spenderAddress: row.spenderAddress,
    tokenContract: row.tokenContract,
    amountRaw: row.amountRaw,
    isUnlimited: row.isUnlimited,
    timestamp: row.approvalAt,
    spenderType: row.spenderType,
    signedAt: signingMetadata?.signedAt ?? null,
    expirationAt: signingMetadata?.expirationAt ?? null,
    refBlockBytes: signingMetadata?.refBlockBytes ?? null,
    refBlockHash: signingMetadata?.refBlockHash ?? null
  };
}

function initialReportFromPending(row: PendingApprovalContextRow): RiskReport {
  return {
    subjectAddress: row.spenderAddress,
    level: row.initialRiskLevel ?? "HIGH",
    score: row.initialRiskScore ?? PENDING_APPROVAL_CONTEXT_SCORE,
    reasons: row.initialRiskReasons.length > 0 ? row.initialRiskReasons : [pendingContextReason(0)]
  };
}

function contextResultFromSession(sessionContext: ApprovalSessionContext): Exclude<ApprovalContextResult, "unknown"> {
  if (sessionContext.classification === "known_swap_route" || sessionContext.classification === "service_linked_helper") {
    return "linked_swap_route";
  }
  if (sessionContext.classification === "possible_collector_drain") return "collector_drain";
  return "no_route_found";
}

function finalReportForContext(event: ApprovalGuardEvent, evaluation: ApprovalRiskEvaluation, sessionContext: ApprovalSessionContext): RiskReport {
  if (sessionContext.classification !== "possible_collector_drain") return evaluation.report;
  return {
    subjectAddress: event.spenderAddress,
    level: "CRITICAL",
    score: 95,
    reasons: evaluation.report.reasons
  };
}

async function sendFinalContextAlert(
  row: PendingApprovalContextRow,
  event: ApprovalGuardEvent,
  finalReport: RiskReport,
  initialReport: RiskReport,
  contextResult: Exclude<ApprovalContextResult, "unknown">,
  sessionContext: ApprovalSessionContext,
  metadata: AddressMetadata | null,
  deps: ApprovalContextFinalizerDeps
): Promise<void> {
  await sendServiceAdminApprovalAlert(event, row.wallet, finalReport, metadata, deps as unknown as ApprovalPollingCycleDeps);

  if (row.ownerAlertStatus !== "sent" || row.wallet.alertMode === "paused" || row.finalContextAlertSentAt) return;

  const message = formatUserApprovalContextResultAlert({
    locale: row.wallet.locale ?? DEFAULT_BOT_LOCALE,
    watchedWallet: row.wallet.address,
    token: "USDT",
    spender: event.spenderAddress,
    spenderType: event.spenderType,
    spenderIdentity: metadataIdentity(metadata),
    allowanceType: allowanceType(event),
    allowanceAmount: formatApprovalAllowance({ amountRaw: event.amountRaw, isUnlimited: event.isUnlimited }),
    approvalAt: event.timestamp,
    signedAt: event.signedAt ?? null,
    expirationAt: event.expirationAt ?? null,
    contextDeadlineAt: row.contextDeadlineAt,
    approvalTxHash: event.txHash,
    initialReport,
    finalReport,
    result: contextResult,
    linkedRouteTxHash: sessionContext.linkedRouteTxHash,
    routeServiceTags: sessionContext.routeServiceTags
  });
  const options = {
    reply_markup: approvalAlertKeyboard({
      txHash: event.txHash,
      spender: event.spenderAddress,
      wallet: row.wallet.address,
      locale: row.wallet.locale ?? DEFAULT_BOT_LOCALE
    }),
    parse_mode: message.parseMode
  };
  await deps.sendUserAlert(row.wallet.telegramUserId, message.text, options);
  await sendCustomerAdminApprovalMessage(event, row.wallet, finalReport, message, deps as unknown as ApprovalPollingCycleDeps);
  await deps.markApprovalContextFinalAlertSent({
    approvalTxHash: event.txHash,
    watchedWalletId: row.wallet.id,
    sentAt: (deps.now ?? (() => new Date()))()
  });
}

async function finalizeApprovalContext(row: PendingApprovalContextRow, deps: ApprovalContextFinalizerDeps): Promise<void> {
  const lookupDeps = deps as unknown as ApprovalPollingCycleDeps;
  const signingMetadata = await resolveSigningMetadata(row.approvalTxHash, lookupDeps);
  const event = eventFromPendingContext(row, signingMetadata);
  const metadata = await resolveAddressMetadata(event.spenderAddress, lookupDeps);
  const contractProfile = await resolveContractIntelligenceProfile(event.spenderAddress, metadata, lookupDeps);
  const labels = await deps.getLabelsForAddress(event.spenderAddress);
  const sessionContext = await resolveApprovalSessionContext(row.wallet, event, lookupDeps, true);
  if (!sessionContext) throw new Error("Approval session context could not be resolved");
  const allowance = await refreshAllowanceAtTrigger(
    event,
    row.wallet.id,
    "context_finalization",
    deps
  );
  const currentAllowance = currentAllowanceView(allowance);

  const evaluation = annotateApprovalEvaluationState(evaluateApprovalRisk({
    event,
    spenderLabels: labels,
    providerMetadata: metadataToProviderMetadata(metadata),
    contractProfile,
    sessionContext
  }), approvalMonitoringStateForSession(sessionContext));
  const finalReport = finalReportForContext(event, evaluation, sessionContext);
  const contextResult = contextResultFromSession(sessionContext);

  await deps.upsertWalletApproval({
    watchedWalletId: row.wallet.id,
    tokenContract: event.tokenContract,
    spenderAddress: event.spenderAddress,
    amountRaw: event.amountRaw,
    isUnlimited: event.isUnlimited,
    currentAllowanceRaw: currentAllowance.currentAllowanceRaw,
    spenderType: event.spenderType,
    status: currentAllowance.status,
    lastApprovalTxHash: event.txHash,
    lastApprovalAt: event.timestamp,
    riskLevel: finalReport.level,
    riskScore: finalReport.score,
    riskReasons: finalReport.reasons,
    lastAlertedTxHash: row.ownerAlertStatus === "sent" ? event.txHash : null
  });
  await deps.recordRiskEvaluation?.({
    rawEvidence: [...evaluation.rawEvidence, ...sessionContext.rawEvidence],
    observations: [...evaluation.observations, ...sessionContext.observations]
  });
  await deps.recordApprovalRisk({
    approvalTxHash: event.txHash,
    watchedWalletId: row.wallet.id,
    report: finalReport
  });

  if (contextResult === "no_route_found") {
    await deps.markApprovalContextExpired({
      approvalTxHash: event.txHash,
      watchedWalletId: row.wallet.id,
      finalReport
    });
  } else {
    await deps.markApprovalContextResolved({
      approvalTxHash: event.txHash,
      watchedWalletId: row.wallet.id,
      result: contextResult,
      finalReport
    });
  }

  await sendFinalContextAlert(row, event, finalReport, initialReportFromPending(row), contextResult, sessionContext, metadata, deps);
}

export async function runSingleApprovalContextFinalizerCycle(deps: ApprovalContextFinalizerDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const rows = await deps.claimDueApprovalContexts({ now, limit: deps.limit ?? 20 });
  for (const row of rows) {
    try {
      await finalizeApprovalContext(row, deps);
    } catch (error) {
      const message = errorMessage(error);
      try {
        await deps.releaseApprovalContextAfterFailure({
          approvalTxHash: row.approvalTxHash,
          watchedWalletId: row.watchedWalletId,
          error: message
        });
      } catch (releaseError) {
        (deps.logger ?? defaultLogger).error("approval_context_release_failed", {
          wallet_id: row.watchedWalletId,
          approval_tx_hash: row.approvalTxHash,
          error: errorMessage(releaseError)
        });
      }
      (deps.logger ?? defaultLogger).warn("approval_context_finalization_failed", {
        wallet_id: row.watchedWalletId,
        approval_tx_hash: row.approvalTxHash,
        spender_address: row.spenderAddress,
        error: message
      });
    }
  }
}

async function processWallet(wallet: WatchedWallet, deps: ApprovalPollingCycleDeps): Promise<void> {
  const approvals = (await collectCurrentApprovals(wallet, deps)).filter((approval) => deps.approvalFilter?.(approval) ?? true);
  const events: ApprovalGuardEvent[] = [];
  for (const approval of approvals) {
    const event = await processApproval(wallet, approval, deps);
    if (event) events.push(event);
  }

  const state = await deps.getApprovalPollState(wallet.id);
  const newest = newestEvent(events);
  await deps.recordApprovalPollSuccess({
    watchedWalletId: wallet.id,
    lastSeenApprovalTs: newest?.timestamp ?? state?.lastSeenApprovalTs ?? null,
    lastSeenTxHash: newest?.txHash ?? state?.lastSeenTxHash ?? null,
    lastSuccessfulPollAt: (deps.now ?? (() => new Date()))()
  });
}

async function recordFailure(wallet: WatchedWallet, error: unknown, deps: ApprovalPollingCycleDeps): Promise<void> {
  const message = errorMessage(error).slice(0, 1024);
  try {
    await deps.recordApprovalPollFailure({ watchedWalletId: wallet.id, error: message });
  } catch (statusError) {
    if (isWatchedWalletForeignKeyError(statusError) && await isStaleWatchedWallet(wallet, deps)) {
      logStaleWalletSkip(wallet, deps, "approval_poll_failure_state_skipped_stale_wallet", statusError);
      return;
    }
    (deps.logger ?? defaultLogger).error("approval_poll_failure_state_update_failed", {
      wallet_id: wallet.id,
      address: wallet.address,
      error: errorMessage(statusError)
    });
  }
  (deps.logger ?? defaultLogger).error("approval_poll_failed", {
    wallet_id: wallet.id,
    address: wallet.address,
    error: message
  });
}

export async function runSingleApprovalPollingCycle(deps: ApprovalPollingCycleDeps): Promise<void> {
  for (const wallet of deps.wallets) {
    if (await isStaleWatchedWallet(wallet, deps)) {
      logStaleWalletSkip(wallet, deps, "approval_poll_skipped_stale_wallet");
      continue;
    }
    try {
      await processWallet(wallet, deps);
    } catch (error) {
      if (isWatchedWalletForeignKeyError(error) && await isStaleWatchedWallet(wallet, deps)) {
        logStaleWalletSkip(wallet, deps, "approval_poll_skipped_stale_wallet", error);
        continue;
      }
      await recordFailure(wallet, error, deps);
    }
  }
}
