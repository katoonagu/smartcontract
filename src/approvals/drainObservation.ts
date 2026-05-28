import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { AddressMetadata } from "../storage/repositories";
import type {
  RawEvidenceInput,
  RiskReport,
  RiskSignalObservationInput,
  WalletApprovalSpenderType
} from "../types";
import type { ApprovalGuardEvent } from "./approvalRisk";
import { nextApprovalState, type ApprovalMonitoringState } from "./approvalStateMachine";
import { parseUsdtRawAmount } from "./amounts";

export const APPROVAL_DRAIN_OBSERVATION_POLICY_VERSION = "2026-05-23-approval-drain-observation-v1";

const MIN_OBSERVED_DRAIN_USDT_RAW = 1n * 1_000_000n;
const LARGE_DRAIN_USDT_RAW = 10_000n * 1_000_000n;
const serviceTagKeywords = [
  "bridge",
  "cross-chain",
  "cross chain",
  "swap",
  "router",
  "dex",
  "exchange",
  "payment",
  "staking",
  "vault",
  "pool"
];

export type ApprovalDrainObservationInput = {
  watchedWalletId: string;
  approval: ApprovalGuardEvent;
  transfer: RawTronscanTrc20Transfer;
  transactionInfo: unknown;
  spenderMetadata: AddressMetadata | null;
  receiverMetadata: AddressMetadata | null;
};

export type ApprovalDrainObservation = {
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
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return null;
}

function lowerText(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function serviceTagFor(metadata: AddressMetadata | null): string | null {
  if (!metadata || metadata.isContract !== true) return null;
  const text = lowerText(metadata.tag);
  if (!text) return null;
  return serviceTagKeywords.find((keyword) => text.includes(keyword)) ?? null;
}

function metadataRisk(metadata: AddressMetadata | null): boolean | null {
  const contractSearch = isObjectRecord(metadata?.rawJson.contractSearch) ? metadata.rawJson.contractSearch : null;
  const risk = contractSearch?.risk;
  return typeof risk === "boolean" ? risk : null;
}

function isVerified(metadata: AddressMetadata | null): boolean {
  if (metadata?.verified === true) return true;
  const contractSearch = isObjectRecord(metadata?.rawJson.contractSearch) ? metadata.rawJson.contractSearch : null;
  return contractSearch?.verifyStatus === true;
}

function addressTypeFromMetadata(metadata: AddressMetadata | null, fallback: WalletApprovalSpenderType): WalletApprovalSpenderType {
  if (metadata?.isContract === true) return "contract";
  if (metadata?.isContract === false) return "eoa";
  return fallback;
}

function transferMethod(transfer: RawTronscanTrc20Transfer, transactionInfo: unknown): string | null {
  const transferTrigger = isObjectRecord(transfer.trigger_info) ? transfer.trigger_info : null;
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const txTrigger = isObjectRecord(tx?.trigger_info) ? tx.trigger_info : null;
  const methodName = stringField(transferTrigger?.methodName ?? txTrigger?.methodName);
  const method = stringField(transferTrigger?.method ?? txTrigger?.method);
  const methodId = stringField(txTrigger?.methodId);
  if (methodName) return methodName;
  if (method?.startsWith("transferFrom")) return "transferFrom";
  if (methodId === "23b872dd") return "transferFrom";
  return method ?? methodId;
}

function transferCaller(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = isObjectRecord(tx?.contractData) ? tx.contractData : null;
  return stringField(tx?.ownerAddress ?? contractData?.owner_address);
}

function transferTimestamp(transfer: RawTronscanTrc20Transfer): Date | null {
  if (typeof transfer.block_ts !== "number" || !Number.isFinite(transfer.block_ts)) return null;
  const date = new Date(transfer.block_ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSuccessfulOfficialUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
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

function reason(code: string, message: string, scoreImpact: number): RiskReport["reasons"][number] {
  return {
    code,
    message,
    scoreImpact,
    source: "approval_drain_observation",
    confidence: scoreImpact >= 75 ? "high" : "medium",
    severity: scoreImpact >= 90 ? "critical" : scoreImpact >= 70 ? "high" : scoreImpact >= 35 ? "medium" : "info"
  };
}

function levelFromScore(score: number): RiskReport["level"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function buildReport(input: {
  spenderType: WalletApprovalSpenderType;
  spenderMetadata: AddressMetadata | null;
  receiverMetadata: AddressMetadata | null;
  spenderAddress: string;
  amountRaw: string;
}): { report: RiskReport; approvalMonitoringState: ApprovalMonitoringState } {
  const amountRaw = parseUsdtRawAmount(input.amountRaw);
  const spenderServiceTag = serviceTagFor(input.spenderMetadata);
  const receiverServiceTag = serviceTagFor(input.receiverMetadata);
  const providerRisk = metadataRisk(input.spenderMetadata) === true;
  const serviceRouteGuarded = !providerRisk && Boolean(spenderServiceTag || receiverServiceTag);
  const approvalMonitoringState = nextApprovalState({
    current: "approval_only",
    approvalObserved: true,
    transferFromObserved: true,
    serviceRouteGuarded,
    pathToCheckedWallet: false
  });
  const verified = isVerified(input.spenderMetadata);
  const namedContract = input.spenderMetadata?.isContract === true && Boolean(input.spenderMetadata.name || input.spenderMetadata.tag);
  const large = amountRaw !== null && amountRaw >= LARGE_DRAIN_USDT_RAW;
  const reasons: RiskReport["reasons"] = [
    reason(
      "approval_transferfrom_observed",
      `Approved spender called USDT transferFrom from watched wallet to a separate receiver; approval monitoring state: ${approvalMonitoringState}`,
      25
    )
  ];

  if (providerRisk) {
    reasons.push(reason("approval_drain_provider_risky_spender", "Provider metadata marks the spender as risky", 70));
  } else if (spenderServiceTag) {
    reasons.push(
      reason(
        "approval_drain_service_spender",
        `Spender has service metadata (${input.spenderMetadata?.tag ?? input.spenderMetadata?.name ?? spenderServiceTag}); transferFrom can be normal service flow`,
        -10
      )
    );
  } else if (input.spenderType === "eoa") {
    reasons.push(reason("approval_drain_unknown_eoa_spender", "Spender is an EOA/non-contract address", large ? 60 : 45));
  } else if (namedContract && !verified) {
    reasons.push(reason("approval_drain_named_unverified_contract", "Spender is a named but unverified/untagged contract", 40));
  } else if (namedContract) {
    reasons.push(reason("approval_drain_named_contract_no_service_tag", "Spender is a named contract without service tag", 30));
  } else {
    reasons.push(reason("approval_drain_unknown_contract", "Spender contract has no service identity metadata", 45));
  }

  if (receiverServiceTag) {
    reasons.push(reason("approval_drain_service_receiver", "Receiver has service/pool/vault-like metadata", -10));
  } else if (input.receiverMetadata?.isContract === false || input.receiverMetadata?.isContract === null || !input.receiverMetadata) {
    reasons.push(reason("approval_drain_separate_unknown_receiver", "Receiver is a separate unknown/non-service address", large ? 20 : 10));
  }

  if (large) {
    reasons.push(reason("approval_drain_large_usdt_amount", "Large USDT amount moved by transferFrom", 15));
  }

  const score = Math.max(0, Math.min(95, reasons.reduce((sum, item) => sum + item.scoreImpact, 0)));
  return {
    approvalMonitoringState,
    report: {
      subjectAddress: input.spenderAddress,
      level: levelFromScore(score),
      score,
      reasons
    }
  };
}

function evidenceIdFor(id: string): string {
  return stableId(["approval_drain_raw", id]);
}

function observationIdFor(id: string, code: string): string {
  return stableId(["approval_drain_observation", id, code, APPROVAL_DRAIN_OBSERVATION_POLICY_VERSION]);
}

export function buildApprovalDrainObservation(input: ApprovalDrainObservationInput): ApprovalDrainObservation | null {
  const transfer = input.transfer;
  if (!isSuccessfulOfficialUsdtTransfer(transfer)) return null;
  if (transfer.from_address !== input.approval.ownerAddress) return null;
  if (transfer.to_address === input.approval.spenderAddress) return null;

  const amountRaw = parseUsdtRawAmount(transfer.quant);
  if (amountRaw === null || amountRaw < MIN_OBSERVED_DRAIN_USDT_RAW) return null;

  const method = transferMethod(transfer, input.transactionInfo);
  if (method !== "transferFrom") return null;

  const callerAddress = transferCaller(input.transactionInfo);
  if (callerAddress !== input.approval.spenderAddress) return null;

  const transferAt = transferTimestamp(transfer);
  if (!transferAt || transferAt.getTime() < input.approval.timestamp.getTime()) return null;

  const id = stableId([
    "approval_drain",
    input.watchedWalletId,
    input.approval.txHash,
    transfer.transaction_id,
    input.approval.ownerAddress,
    input.approval.spenderAddress,
    transfer.to_address
  ]);
  const spenderType = addressTypeFromMetadata(input.spenderMetadata, input.approval.spenderType);
  const receiverType = addressTypeFromMetadata(input.receiverMetadata, "unknown");
  const { report, approvalMonitoringState } = buildReport({
    spenderType,
    spenderMetadata: input.spenderMetadata,
    receiverMetadata: input.receiverMetadata,
    spenderAddress: input.approval.spenderAddress,
    amountRaw: transfer.quant
  });
  const rawEvidenceId = evidenceIdFor(id);
  const rawEvidence: RawEvidenceInput[] = [
    {
      id: rawEvidenceId,
      source: "approval_drain_observation",
      sourceType: "detector_output",
      chain: "tron",
      address: input.approval.spenderAddress,
      txHash: transfer.transaction_id,
      observedTransactionHash: transfer.transaction_id,
      evidenceJson: {
        approvalTxHash: input.approval.txHash,
        ownerAddress: input.approval.ownerAddress,
        spenderAddress: input.approval.spenderAddress,
        receiverAddress: transfer.to_address,
        tokenContract: input.approval.tokenContract,
        amountRaw: transfer.quant,
        callerAddress,
        method,
        approvalAt: input.approval.timestamp.toISOString(),
        transferAt: transferAt.toISOString(),
        timeToTransferMs: transferAt.getTime() - input.approval.timestamp.getTime(),
        approvalMonitoringState,
        spenderType,
        receiverType,
        spenderMetadata: input.spenderMetadata
          ? {
              name: input.spenderMetadata.name,
              tag: input.spenderMetadata.tag,
              isContract: input.spenderMetadata.isContract,
              verified: input.spenderMetadata.verified,
              accountType: input.spenderMetadata.accountType
            }
          : null,
        receiverMetadata: input.receiverMetadata
          ? {
              name: input.receiverMetadata.name,
              tag: input.receiverMetadata.tag,
              isContract: input.receiverMetadata.isContract,
              verified: input.receiverMetadata.verified,
              accountType: input.receiverMetadata.accountType
            }
          : null
      }
    }
  ];
  const observations: RiskSignalObservationInput[] = report.reasons.map((item) => ({
    id: observationIdFor(id, item.code),
    subjectChain: "tron",
    subjectAddress: input.approval.spenderAddress,
    subjectTxHash: input.approval.txHash,
    observedTransactionHash: transfer.transaction_id,
    signalGroup: "approval",
    code: item.code,
    message: item.message,
    scoreImpact: item.scoreImpact,
    confidence: item.confidence ?? "medium",
    severity: item.severity ?? "medium",
    source: "approval_drain_observation",
    policyVersion: APPROVAL_DRAIN_OBSERVATION_POLICY_VERSION,
    rawEvidenceId
  }));

  return {
    id,
    watchedWalletId: input.watchedWalletId,
    approvalTxHash: input.approval.txHash,
    transferTxHash: transfer.transaction_id,
    ownerAddress: input.approval.ownerAddress,
    spenderAddress: input.approval.spenderAddress,
    receiverAddress: transfer.to_address,
    tokenContract: input.approval.tokenContract,
    amountRaw: transfer.quant,
    callerAddress,
    method,
    approvalAt: input.approval.timestamp,
    transferAt,
    timeToTransferMs: transferAt.getTime() - input.approval.timestamp.getTime(),
    spenderType,
    receiverType,
    report,
    rawEvidence,
    observations
  };
}
