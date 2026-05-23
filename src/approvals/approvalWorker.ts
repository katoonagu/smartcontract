import type { InlineKeyboard } from "grammy";
import { approvalAlertKeyboard } from "../alerts/approvalKeyboards";
import { formatAdminApprovalAlert, formatUserApprovalAlert } from "../alerts/formatters";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type {
  AddressMetadata,
  ContractIntelligenceProfile,
  CustomerAlertRecipient,
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
  WalletApprovalSpenderType
} from "../types";
import { formatApprovalAllowance } from "./amounts";
import {
  evaluateApprovalRisk,
  type ApprovalGuardEvent,
  type ApprovalProviderMetadata,
  type ApprovalRiskEvaluation
} from "./approvalRisk";
import { buildApprovalDrainObservation, type ApprovalDrainObservation } from "./drainObservation";

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

const DEFAULT_METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CONTRACT_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

export type ApprovalPollingCycleDeps = {
  wallets: WatchedWallet[];
  tronClient: TronApprovalClient;
  pageLimit: number;
  maxPagesPerWallet: number;
  now?: () => Date;
  getApprovalPollState(watchedWalletId: string): Promise<WalletApprovalPollState | null>;
  recordApprovalPollSuccess(input: ApprovalPollSuccessInput): Promise<void>;
  recordApprovalPollFailure(input: { watchedWalletId: string; error: string }): Promise<void>;
  upsertWalletApproval(input: WalletApprovalInput): Promise<void>;
  claimObservedApprovalEvent(input: ObservedApprovalInput): Promise<boolean>;
  recordApprovalRisk(input: { approvalTxHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
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
  sendUserAlert(telegramUserId: string, message: string, options?: { reply_markup?: InlineKeyboard }): Promise<void>;
  sendCustomerAdminAlert?(telegramUserId: string, message: string, options?: { reply_markup?: InlineKeyboard }): Promise<void>;
  sendAdminAlert(message: string): Promise<void>;
  recheckExistingApprovals?: boolean;
  suppressApprovalAlerts?: boolean;
  approvalChangeLookupLimit?: number;
  targetApprovalTxHash?: string;
  approvalFilter?(approval: TronscanApprovalListItem): boolean;
  approvalEventFilter?(event: ApprovalGuardEvent): boolean;
  logger?: Logger;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function shouldNotifyCustomerAdmin(recipient: CustomerAlertRecipient, level: RiskReport["level"]): boolean {
  return recipient.alertMode === "all" || level !== "LOW";
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
    await deps.sendAdminAlert(
      formatAdminApprovalAlert({
        telegramUserId: wallet.telegramUserId,
        telegramUsername: wallet.telegramUsername,
        watchedWallet: wallet.address,
        spender: event.spenderAddress,
        spenderType: event.spenderType,
        spenderIdentity: metadataIdentity(metadata),
        approvalTxHash: event.txHash,
        report
      })
    );
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
    reply_markup: approvalAlertKeyboard({ txHash: event.txHash, spender: event.spenderAddress, wallet: wallet.address })
  };

  for (const recipient of recipients) {
    if (!shouldNotifyCustomerAdmin(recipient, report.level)) continue;
    try {
      const send = deps.sendCustomerAdminAlert ?? deps.sendUserAlert;
      await send(recipient.recipientTelegramUserId, message, options);
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
  if (!evaluation.shouldAlert) {
    await deps.markApprovalOwnerAlertSkipped({
      approvalTxHash: event.txHash,
      watchedWalletId: wallet.id,
      reason: report.level === "MEDIUM" ? "medium_dashboard_only" : "low_risk"
    });
    return;
  }

  await sendServiceAdminApprovalAlert(event, wallet, report, metadata, deps);

  if (wallet.alertMode === "paused") {
    await deps.markApprovalOwnerAlertSkipped({ approvalTxHash: event.txHash, watchedWalletId: wallet.id, reason: "paused" });
    return;
  }

  try {
    await deps.sendUserAlert(
      wallet.telegramUserId,
      formatUserApprovalAlert({
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
      }),
      { reply_markup: approvalAlertKeyboard({ txHash: event.txHash, spender: event.spenderAddress, wallet: wallet.address }) }
    );
  } catch (error) {
    await markAlertFailedSafely(event, wallet, errorMessage(error), deps);
    return;
  }

  await deps.markApprovalOwnerAlertSent({ approvalTxHash: event.txHash, watchedWalletId: wallet.id });
  await sendCustomerAdminApprovalAlerts(event, wallet, report, metadata, deps);
}

async function processApproval(
  wallet: WatchedWallet,
  approval: TronscanApprovalListItem,
  deps: ApprovalPollingCycleDeps
): Promise<ApprovalGuardEvent | null> {
  const metadata = await resolveAddressMetadata(approval.spenderAddress, deps);
  const contractProfile = await resolveContractIntelligenceProfile(approval.spenderAddress, metadata, deps);
  const spenderType = finalSpenderType(approval, metadata);
  const change = await newestApprovalChange(approval, deps);
  if (!change) {
    await deps.upsertWalletApproval({
      watchedWalletId: wallet.id,
      tokenContract: approval.tokenContract,
      spenderAddress: approval.spenderAddress,
      amountRaw: approval.amountRaw,
      isUnlimited: approval.isUnlimited,
      currentAllowanceRaw: approval.amountRaw,
      spenderType,
      status: "active",
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
  const labels = await deps.getLabelsForAddress(event.spenderAddress);
  const evaluation = evaluateApprovalRisk({
    event,
    spenderLabels: labels,
    providerMetadata: metadataToProviderMetadata(metadata),
    contractProfile
  });
  await deps.upsertWalletApproval({
    watchedWalletId: wallet.id,
    tokenContract: event.tokenContract,
    spenderAddress: event.spenderAddress,
    amountRaw: event.amountRaw,
    isUnlimited: event.isUnlimited,
    currentAllowanceRaw: approval.amountRaw,
    spenderType: event.spenderType,
    status: "active",
    lastApprovalTxHash: event.txHash,
    lastApprovalAt: event.timestamp,
    riskLevel: evaluation.report.level,
    riskScore: evaluation.report.score,
    riskReasons: evaluation.report.reasons,
    lastAlertedTxHash: evaluation.shouldAlert ? event.txHash : null
  });

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
    await deps.recordRiskEvaluation?.({
      rawEvidence: evaluation.rawEvidence,
      observations: evaluation.observations
    });
    await deps.recordApprovalRisk({
      approvalTxHash: event.txHash,
      watchedWalletId: wallet.id,
      report: evaluation.report
    });
  } catch (error) {
    await markAlertFailedSafely(event, wallet, errorMessage(error), deps);
    return event;
  }

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
    try {
      await processWallet(wallet, deps);
    } catch (error) {
      await recordFailure(wallet, error, deps);
    }
  }
}
