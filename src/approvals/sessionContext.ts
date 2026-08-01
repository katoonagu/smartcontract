import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { AddressMetadata } from "../storage/repositories";
import type { TronscanApprovalChange } from "../tron/tronClient";
import type { KnownServiceSessionV1, RawEvidenceInput, RiskReason, RiskSignalObservationInput } from "../types";
import type { ApprovalGuardEvent } from "./approvalRisk";
import { findKnownServiceBySpender, type KnownApprovalServiceV1 } from "./knownServiceRegistry";

export const APPROVAL_SESSION_CONTEXT_POLICY_VERSION = "2026-05-23-approval-session-context-v1";
export const APPROVAL_SESSION_LOOKBACK_MS = 2 * 60 * 1000;
export const APPROVAL_SESSION_LOOKAHEAD_MS = 10 * 60 * 1000;
export const KNOWN_SERVICE_SESSION_WINDOW_MS = 10 * 60 * 1000;

export type KnownServiceSessionInputV1 = {
  ownerAddress: string;
  callerAddress: string;
  spenderAddress: string;
  approvalTxHash: string;
  actionTxHash: string;
  actionKind: string;
  approvalTimestampMs: number;
  actionTimestampMs: number;
  successful: boolean;
  approvedAmountRaw: string | null;
  decodedActionAmountRaw: string;
  movedUsdtAmountRaw: string;
  transactionSequenceUnbroken: boolean;
  knownService: KnownApprovalServiceV1 | null;
  providerTags?: string[];
};

function canonicalUint256(value: string | null): boolean {
  if (value === null) return true;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return false;
  return BigInt(value) < 2n ** 256n;
}

export function resolveKnownServiceSessionV1(input: KnownServiceSessionInputV1): KnownServiceSessionV1 | null {
  const registryService = findKnownServiceBySpender(input.spenderAddress);
  if (!registryService || !input.knownService || input.knownService.id !== registryService.id) return null;
  if (input.callerAddress !== input.ownerAddress) return null;
  if (!registryService.actionKinds.includes(input.actionKind as "swap" | "bridge" | "router")) return null;
  if (input.successful !== true || input.transactionSequenceUnbroken !== true) return null;
  const delayMs = input.actionTimestampMs - input.approvalTimestampMs;
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > KNOWN_SERVICE_SESSION_WINDOW_MS) return null;
  if (!canonicalUint256(input.approvedAmountRaw) || !canonicalUint256(input.decodedActionAmountRaw) || !canonicalUint256(input.movedUsdtAmountRaw)) {
    return null;
  }
  if (input.decodedActionAmountRaw !== input.movedUsdtAmountRaw) return null;
  if (!input.approvalTxHash || !input.actionTxHash) return null;

  return Object.freeze({
    walletAddress: input.ownerAddress,
    spenderAddress: input.spenderAddress,
    approvalTxHash: input.approvalTxHash,
    actionTxHash: input.actionTxHash,
    actionKind: input.actionKind as KnownServiceSessionV1["actionKind"],
    walletInitiated: true,
    successful: true,
    delayMs,
    approvedAmountRaw: input.approvedAmountRaw,
    movedAmountRaw: input.movedUsdtAmountRaw,
    amountContinuity: "exact",
    authoritativeServiceId: registryService.id
  });
}

export type ApprovalSessionClassification =
  | "known_swap_route"
  | "service_linked_helper"
  | "no_route_found"
  | "possible_collector_drain";

export type ApprovalSessionContext = {
  classification: ApprovalSessionClassification;
  linkedRouteTxHash: string | null;
  routeServiceTags: string[];
  scoreImpact: number;
  reasons: RiskReason[];
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
  knownServiceSession?: KnownServiceSessionV1 | null;
};

export type ApprovalSessionContextInput = {
  watchedWalletId: string;
  approval: ApprovalGuardEvent;
  relatedTransfers: RawTronscanTrc20Transfer[];
  transactionDetails: Map<string, unknown>;
  addressMetadata: Map<string, AddressMetadata | null>;
  now: Date;
  approvalChanges?: readonly TronscanApprovalChange[];
  approvalChangeWindowComplete?: boolean;
  lookbackMs?: number;
  lookaheadMs?: number;
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function reason(code: string, message: string, scoreImpact: number): RiskReason {
  return {
    code,
    message,
    scoreImpact,
    source: "approval_session_context",
    confidence: Math.abs(scoreImpact) >= 30 ? "high" : "medium",
    severity: scoreImpact >= 35 ? "medium" : "info"
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function lowerText(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function transferTimestamp(transfer: RawTronscanTrc20Transfer): Date | null {
  if (typeof transfer.block_ts !== "number" || !Number.isFinite(transfer.block_ts)) return null;
  const date = new Date(transfer.block_ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSuccessfulUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  if (transfer.contract_address !== TRON_USDT_CONTRACT_ADDRESS && transfer.tokenInfo?.tokenId !== TRON_USDT_CONTRACT_ADDRESS) {
    return false;
  }
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") return false;
  return true;
}

function isInsideWindow(
  approval: ApprovalGuardEvent,
  transfer: RawTronscanTrc20Transfer,
  lookbackMs: number,
  lookaheadMs: number
): boolean {
  const at = transferTimestamp(transfer);
  if (!at) return false;
  return at.getTime() >= approval.timestamp.getTime() - lookbackMs && at.getTime() <= approval.timestamp.getTime() + lookaheadMs;
}

function methodText(transactionInfo: unknown): string {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : {};
  const trigger = isObjectRecord(tx.trigger_info) ? tx.trigger_info : {};
  const contractData = isObjectRecord(tx.contractData) ? tx.contractData : {};
  return lowerText(
    stringField(trigger.methodName),
    stringField(trigger.method),
    stringField(trigger.methodId),
    stringField(contractData.function_selector)
  );
}

function transferMethod(transactionInfo: unknown): string | null {
  const text = methodText(transactionInfo);
  if (text.includes("transferfrom") || text.includes("23b872dd")) return "transferFrom";
  return text || null;
}

function transferCaller(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : {};
  const contractData = isObjectRecord(tx.contractData) ? tx.contractData : {};
  return stringField(tx.ownerAddress ?? contractData.owner_address);
}

function serviceTag(metadata: AddressMetadata | null | undefined): string | null {
  if (!metadata) return null;
  if (metadata.isContract !== true) return null;
  const tagText = lowerText(metadata.tag);
  const strongTagKeywords = [
    "bridgers",
    "cross-chain",
    "cross chain",
    "sunswap",
    "sun swap",
    "wtrx",
    "univ3",
    "adapter",
    "router",
    "dex",
    "pool",
    "bridge"
  ];
  if (strongTagKeywords.some((keyword) => tagText.includes(keyword))) return metadata.tag ?? "service";

  const verifiedNameText = metadata.verified === true ? lowerText(metadata.name) : "";
  const verifiedServiceKeywords = [
    "bridgers",
    "sunswap",
    "sun swap",
    "wtrx",
    "univ3",
    "adapter",
    "router",
    "pool"
  ];
  return verifiedServiceKeywords.some((keyword) => verifiedNameText.includes(keyword)) ? (metadata.name ?? "service") : null;
}

function hasRouteMethod(transactionInfo: unknown): boolean {
  const text = methodText(transactionInfo);
  return ["swap", "bridge", "withdraw", "deposit", "route", "router", "proxy"].some((keyword) => text.includes(keyword));
}

function exactActionKind(transactionInfo: unknown): KnownServiceSessionV1["actionKind"] | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : {};
  const trigger = isObjectRecord(tx.trigger_info) ? tx.trigger_info : {};
  const contractData = isObjectRecord(tx.contractData) ? tx.contractData : {};
  const raw = stringField(trigger.methodName ?? trigger.method ?? contractData.function_selector);
  if (!raw) return null;
  const method = raw.split("(", 1)[0]?.trim().toLowerCase();
  return method === "swap" || method === "bridge" || method === "router" ? method : null;
}

function exactDecodedAmountRaw(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : {};
  const trigger = isObjectRecord(tx.trigger_info) ? tx.trigger_info : {};
  const parameter = isObjectRecord(trigger.parameter) ? trigger.parameter : {};
  const contractData = isObjectRecord(tx.contractData) ? tx.contractData : {};
  const present = [tx.decodedActionAmountRaw, parameter.amount, contractData.amount]
    .filter((value) => value !== undefined && value !== null);
  if (present.length === 0 || present.some((value) => typeof value !== "string")) return null;
  const candidates = present as string[];
  if (candidates.some((value) => !/^(0|[1-9][0-9]*)$/.test(value))) return null;
  return candidates.every((value) => value === candidates[0]) ? candidates[0]! : null;
}

function exactSuccessfulReceipt(transactionInfo: unknown): boolean {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : {};
  const receipt = isObjectRecord(tx.receipt) ? tx.receipt : {};
  return receipt.success === true;
}

function isSuccessfulConfirmedApprovalChange(change: TronscanApprovalChange): boolean {
  if (change.confirmed !== true) return false;
  return !change.contractRet || change.contractRet === "SUCCESS";
}

function sameApprovalSubject(change: TronscanApprovalChange, approval: ApprovalGuardEvent): boolean {
  return change.ownerAddress === approval.ownerAddress &&
    change.spenderAddress === approval.spenderAddress &&
    change.tokenContract === TRON_USDT_CONTRACT_ADDRESS;
}

function exactApprovalSequenceUnbroken(input: ApprovalSessionContextInput, actionTimestampMs: number): boolean {
  if (input.approvalChangeWindowComplete !== true || input.approval.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) {
    return false;
  }
  const changes = input.approvalChanges ?? [];
  const originalPresent = changes.some((change) =>
    change.txHash === input.approval.txHash &&
    sameApprovalSubject(change, input.approval) &&
    change.amountRaw === input.approval.amountRaw &&
    change.timestamp.getTime() === input.approval.timestamp.getTime() &&
    isSuccessfulConfirmedApprovalChange(change)
  );
  if (!originalPresent) return false;

  const approvalTimestampMs = input.approval.timestamp.getTime();
  return !changes.some((change) => {
    if (change.txHash === input.approval.txHash || !sameApprovalSubject(change, input.approval)) return false;
    if (!isSuccessfulConfirmedApprovalChange(change)) return false;
    const changedAtMs = change.timestamp.getTime();
    return changedAtMs >= approvalTimestampMs && changedAtMs <= actionTimestampMs;
  });
}

function buildKnownServiceSession(input: ApprovalSessionContextInput, nearby: RawTronscanTrc20Transfer[]): KnownServiceSessionV1 | null {
  const knownService = findKnownServiceBySpender(input.approval.spenderAddress);
  if (!knownService) return null;
  for (const transfer of nearby) {
    if (transfer.to_address !== knownService.spenderAddress) continue;
    const detail = input.transactionDetails.get(transfer.transaction_id);
    if (!detail || !isObjectRecord(detail)) continue;
    const actionKind = exactActionKind(detail);
    const decodedActionAmountRaw = exactDecodedAmountRaw(detail);
    if (!actionKind || decodedActionAmountRaw === null) continue;
    const session = resolveKnownServiceSessionV1({
      ownerAddress: input.approval.ownerAddress,
      callerAddress: transferCaller(detail) ?? "",
      spenderAddress: input.approval.spenderAddress,
      approvalTxHash: input.approval.txHash,
      actionTxHash: transfer.transaction_id,
      actionKind,
      approvalTimestampMs: input.approval.timestamp.getTime(),
      actionTimestampMs: transfer.block_ts,
      successful: exactSuccessfulReceipt(detail),
      approvedAmountRaw: input.approval.amountRaw,
      decodedActionAmountRaw,
      movedUsdtAmountRaw: transfer.quant,
      transactionSequenceUnbroken: exactApprovalSequenceUnbroken(input, transfer.block_ts),
      knownService
    });
    if (session) return session;
  }
  return null;
}

function evidenceIdFor(input: ApprovalSessionContextInput): string {
  return stableId(["approval_session_context_raw", input.watchedWalletId, input.approval.txHash, APPROVAL_SESSION_CONTEXT_POLICY_VERSION]);
}

function observationIdFor(input: ApprovalSessionContextInput, code: string): string {
  return stableId(["approval_session_context_observation", input.watchedWalletId, input.approval.txHash, code, APPROVAL_SESSION_CONTEXT_POLICY_VERSION]);
}

function signingDelayMs(approval: ApprovalGuardEvent): number | null {
  if (!approval.signedAt) return null;
  const delay = approval.timestamp.getTime() - approval.signedAt.getTime();
  return delay >= 0 ? delay : null;
}

function signingExpirationMs(approval: ApprovalGuardEvent): number | null {
  if (!approval.signedAt || !approval.expirationAt) return null;
  const expirationMs = approval.expirationAt.getTime() - approval.signedAt.getTime();
  return expirationMs >= 0 ? expirationMs : null;
}

export function buildApprovalSessionContext(input: ApprovalSessionContextInput): ApprovalSessionContext {
  const lookbackMs = input.lookbackMs ?? APPROVAL_SESSION_LOOKBACK_MS;
  const lookaheadMs = input.lookaheadMs ?? APPROVAL_SESSION_LOOKAHEAD_MS;
  const nearby = input.relatedTransfers.filter(
    (transfer) =>
      isSuccessfulUsdtTransfer(transfer) &&
      transfer.from_address === input.approval.ownerAddress &&
      isInsideWindow(input.approval, transfer, lookbackMs, lookaheadMs)
  );
  const knownServiceSession = buildKnownServiceSession(input, nearby);

  let classification: ApprovalSessionClassification = "no_route_found";
  let linkedRouteTxHash: string | null = null;
  let scoreImpact = 0;
  const routeServiceTags = new Set<string>();
  const reasons: RiskReason[] = [];

  if (knownServiceSession) {
    classification = "known_swap_route";
    linkedRouteTxHash = knownServiceSession.actionTxHash;
    scoreImpact = -20;
    routeServiceTags.add(knownServiceSession.authoritativeServiceId);
    reasons.push(
      reason(
        "approval_temporally_linked_to_known_swap",
        "Exact wallet-initiated action and USDT movement match an authoritative service registry entry",
        scoreImpact
      )
    );
  } else {
    for (const transfer of nearby) {
      const metadata = input.addressMetadata.get(transfer.to_address) ?? null;
      const tag = serviceTag(metadata);
      const routeLike = tag !== null;

      if (routeLike) {
        classification = transfer.to_address === input.approval.spenderAddress ? "known_swap_route" : "service_linked_helper";
        linkedRouteTxHash = transfer.transaction_id;
        scoreImpact = classification === "known_swap_route" ? -20 : -35;
        if (tag) routeServiceTags.add(tag);
        reasons.push(
          reason(
            "approval_temporally_linked_to_known_swap",
            "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
            scoreImpact
          )
        );
        break;
      }
    }
  }

  if (classification === "no_route_found") {
    const collector = nearby.find((transfer) => {
      const metadata = input.addressMetadata.get(transfer.to_address) ?? null;
      const txInfo = input.transactionDetails.get(transfer.transaction_id);
      return serviceTag(metadata) === null &&
        !hasRouteMethod(txInfo) &&
        transferMethod(txInfo) === "transferFrom" &&
        transferCaller(txInfo) === input.approval.spenderAddress;
    });

    if (collector) {
      classification = "possible_collector_drain";
      linkedRouteTxHash = collector.transaction_id;
      scoreImpact = 35;
      reasons.push(
        reason(
          "approval_session_possible_collector_drain",
          "Nearby USDT movement after approval goes to a non-service receiver; review as possible collector flow",
          35
        )
      );
    } else {
      reasons.push(reason("approval_session_no_route_found", "No nearby swap/bridge route evidence found for this approval", 0));
    }
  }

  const rawEvidenceId = evidenceIdFor(input);
  const rawEvidence: RawEvidenceInput[] = [
    {
      id: rawEvidenceId,
      source: "approval_session_context",
      sourceType: "detector_output",
      chain: "tron",
      address: input.approval.spenderAddress,
      txHash: input.approval.txHash,
      observedTransactionHash: linkedRouteTxHash ?? input.approval.txHash,
      evidenceJson: {
        policyVersion: APPROVAL_SESSION_CONTEXT_POLICY_VERSION,
        watchedWalletId: input.watchedWalletId,
        approvalTxHash: input.approval.txHash,
        ownerAddress: input.approval.ownerAddress,
        spenderAddress: input.approval.spenderAddress,
        approvalAt: input.approval.timestamp.toISOString(),
        signedAt: input.approval.signedAt?.toISOString() ?? null,
        expirationAt: input.approval.expirationAt?.toISOString() ?? null,
        signedToBlockDelayMs: signingDelayMs(input.approval),
        signingExpirationMs: signingExpirationMs(input.approval),
        refBlockBytes: input.approval.refBlockBytes ?? null,
        refBlockHash: input.approval.refBlockHash ?? null,
        lookbackMs,
        lookaheadMs,
        classification,
        linkedRouteTxHash,
        routeServiceTags: [...routeServiceTags],
        nearbyTransferTxHashes: nearby.map((transfer) => transfer.transaction_id),
        knownServiceSession
      }
    }
  ];

  const observations: RiskSignalObservationInput[] = reasons.map((item) => ({
    id: observationIdFor(input, item.code),
    subjectChain: "tron",
    subjectAddress: input.approval.spenderAddress,
    subjectTxHash: input.approval.txHash,
    observedTransactionHash: linkedRouteTxHash ?? input.approval.txHash,
    signalGroup: "approval",
    code: item.code,
    message: item.message,
    scoreImpact: item.scoreImpact,
    confidence: item.confidence ?? "medium",
    severity: item.severity ?? "info",
    source: "approval_session_context",
    policyVersion: APPROVAL_SESSION_CONTEXT_POLICY_VERSION,
    rawEvidenceId
  }));

  return {
    classification,
    linkedRouteTxHash,
    routeServiceTags: [...routeServiceTags],
    scoreImpact,
    reasons,
    rawEvidence,
    observations,
    knownServiceSession
  };
}
