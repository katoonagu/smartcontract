import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { AddressLabel, RawEvidenceInput, RiskReport, RiskSignalObservationInput } from "../types";
import { parseUsdtRawAmount } from "./amounts";

export const APPROVAL_GUARD_POLICY_VERSION = "2026-05-23-approval-guard-v3";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const LARGE_FINITE_USDT_RAW = 10_000n * 1_000_000n;
const VERY_LARGE_FINITE_USDT_RAW = 50_000n * 1_000_000n;
const DELAYED_SIGNED_APPROVAL_MS = 6 * 60 * 60 * 1000;
const EXTENDED_EXPIRATION_MS = 24 * 60 * 60 * 1000;
const riskyLabels = new Set(["scam", "stolen_funds", "phishing", "risky_contract"]);
const trustedLabels = new Set(["trusted", "false_positive"]);
const serviceLabels = new Set(["bridge", "exchange"]);
const serviceTagKeywords = [
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
];

export type ApprovalSpenderType = "eoa" | "contract" | "unknown";

export type ApprovalGuardEvent = {
  txHash: string;
  ownerAddress: string;
  spenderAddress: string;
  tokenContract: string;
  amountRaw: string;
  isUnlimited: boolean;
  timestamp: Date;
  spenderType: ApprovalSpenderType;
  signedAt?: Date | null;
  expirationAt?: Date | null;
  refBlockBytes?: string | null;
  refBlockHash?: string | null;
};

export type ApprovalProviderMetadata = {
  name: string | null;
  tag: string | null;
  isContract: boolean | null;
  verified: boolean | null;
  providerRisk: boolean | null;
  accountType: number | null;
  contractCreatedAt: Date | null;
};

export type ApprovalRiskEvaluation = {
  report: RiskReport;
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
  shouldAlert: boolean;
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function reason(code: string, message: string, scoreImpact: number): RiskReport["reasons"][number] {
  return {
    code,
    message,
    scoreImpact,
    source: "approval_guard",
    confidence: "high",
    severity: scoreImpact >= 90 ? "critical" : scoreImpact >= 60 ? "high" : "info"
  };
}

function levelFromScore(score: number): RiskReport["level"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function isOfficialUsdt(event: ApprovalGuardEvent): boolean {
  return event.tokenContract === TRON_USDT_CONTRACT_ADDRESS;
}

function isUnlimited(event: ApprovalGuardEvent): boolean {
  return event.isUnlimited || event.amountRaw === MAX_UINT256;
}

function isUnknownEoa(event: ApprovalGuardEvent): boolean {
  return event.spenderType !== "contract";
}

function providerText(metadata: ApprovalProviderMetadata | null): string {
  if (!metadata) return "";
  return [metadata.name, metadata.tag].filter(Boolean).join(" ").toLowerCase();
}

function serviceTagFor(metadata: ApprovalProviderMetadata | null): string | null {
  if (!metadata || metadata.isContract !== true || metadata.providerRisk === true) return null;
  const text = providerText(metadata);
  if (!text) return null;
  return serviceTagKeywords.find((keyword) => text.includes(keyword)) ?? null;
}

function hasNamedProviderContract(metadata: ApprovalProviderMetadata | null): boolean {
  if (!metadata || metadata.isContract !== true || metadata.providerRisk === true) return false;
  return Boolean(metadata.name || metadata.tag);
}

function signingDelayMs(event: ApprovalGuardEvent): number | null {
  if (!event.signedAt) return null;
  const delayMs = event.timestamp.getTime() - event.signedAt.getTime();
  return delayMs >= 0 ? delayMs : null;
}

function signingExpirationMs(event: ApprovalGuardEvent): number | null {
  if (!event.signedAt || !event.expirationAt) return null;
  const expirationMs = event.expirationAt.getTime() - event.signedAt.getTime();
  return expirationMs >= 0 ? expirationMs : null;
}

function evidenceIdFor(event: ApprovalGuardEvent): string {
  return stableId(["approval_raw", event.txHash, event.ownerAddress, event.tokenContract, event.spenderAddress]);
}

function observationIdFor(event: ApprovalGuardEvent, code: string): string {
  return stableId([
    "approval_observation",
    event.txHash,
    event.ownerAddress,
    event.tokenContract,
    event.spenderAddress,
    code,
    APPROVAL_GUARD_POLICY_VERSION
  ]);
}

export function evaluateApprovalRisk(input: {
  event: ApprovalGuardEvent;
  spenderLabels: AddressLabel[];
  providerMetadata?: ApprovalProviderMetadata | null;
}): ApprovalRiskEvaluation {
  const event = input.event;
  const metadata = input.providerMetadata ?? null;
  const labels = input.spenderLabels.filter((label) => label.address === event.spenderAddress);
  const hasTrustedLabel = labels.some((label) => trustedLabels.has(label.label));
  const riskyLabel = labels.find((label) => riskyLabels.has(label.label));
  const serviceLabel = labels.find((label) => serviceLabels.has(label.label));
  const providerServiceTag = serviceTagFor(metadata);
  const namedProviderContract = hasNamedProviderContract(metadata);
  const providerRisk = metadata?.providerRisk === true;
  const delayMs = signingDelayMs(event);
  const expirationMs = signingExpirationMs(event);
  const reasons: RiskReport["reasons"] = [];
  const amountRaw = parseUsdtRawAmount(event.amountRaw);
  const unlimited = isUnlimited(event);

  if (riskyLabel) {
    reasons.push(reason("approval_spender_risky_label", `Approval spender has internal label: ${riskyLabel.label}`, 95));
  } else if (hasTrustedLabel) {
    reasons.push(reason("approval_spender_trusted", "Approval spender is trusted/false-positive labeled", 0));
  } else if (providerRisk) {
    reasons.push(reason("approval_provider_risky_contract", "Provider metadata marks spender contract as risky", 90));
  } else if (
    providerServiceTag &&
    isOfficialUsdt(event) &&
    (unlimited || (amountRaw !== null && amountRaw >= LARGE_FINITE_USDT_RAW))
  ) {
    reasons.push(
      reason(
        "approval_provider_service_tag",
        `Provider metadata identifies spender as service contract: ${metadata?.tag ?? metadata?.name ?? providerServiceTag}`,
        15
      )
    );
  } else if (
    serviceLabel &&
    isOfficialUsdt(event) &&
    (unlimited || (amountRaw !== null && amountRaw >= LARGE_FINITE_USDT_RAW))
  ) {
    reasons.push(
      reason(
        "approval_spender_service_label",
        `Large or unlimited official TRON USDT approval to service-labeled spender: ${serviceLabel.label}`,
        35
      )
    );
  } else if (
    namedProviderContract &&
    isOfficialUsdt(event) &&
    (unlimited || (amountRaw !== null && amountRaw >= LARGE_FINITE_USDT_RAW))
  ) {
    reasons.push(
      reason(
        "approval_provider_named_contract",
        `Provider metadata identifies spender as named smart contract: ${metadata?.name ?? metadata?.tag}`,
        unlimited ? 35 : 25
      )
    );
  } else if (isOfficialUsdt(event) && unlimited) {
    reasons.push(reason("approval_unlimited_usdt", "Unlimited approval for official TRON USDT", 60));
    if (isUnknownEoa(event)) {
      reasons.push(reason("approval_spender_unknown_eoa", "Approval spender is a wallet address (EOA), not a smart contract", 20));
    }
  } else if (isOfficialUsdt(event) && amountRaw !== null && amountRaw >= VERY_LARGE_FINITE_USDT_RAW) {
    reasons.push(reason("approval_very_large_finite_usdt", "Very large finite approval for official TRON USDT", 70));
    if (isUnknownEoa(event)) {
      reasons.push(reason("approval_spender_unknown_eoa", "Approval spender is a wallet address (EOA), not a smart contract", 10));
    }
  } else if (isOfficialUsdt(event) && amountRaw !== null && amountRaw >= LARGE_FINITE_USDT_RAW) {
    reasons.push(reason("approval_large_finite_usdt", "Large finite approval for official TRON USDT", 30));
    if (isUnknownEoa(event)) {
      reasons.push(reason("approval_spender_unknown_eoa", "Approval spender is a wallet address (EOA), not a smart contract", 10));
    }
  } else {
    reasons.push(reason("approval_finite_usdt", "Finite official TRON USDT approval observed", 0));
  }

  if (!hasTrustedLabel && !providerServiceTag && delayMs !== null && delayMs >= DELAYED_SIGNED_APPROVAL_MS) {
    reasons.push(reason("approval_delayed_signed_transaction", "Approval transaction was signed long before it appeared on-chain", 10));
  }

  if (!hasTrustedLabel && !providerServiceTag && expirationMs !== null && expirationMs >= EXTENDED_EXPIRATION_MS) {
    reasons.push(reason("approval_extended_expiration", "Approval transaction used an unusually long expiration window", 5));
  }

  const score = hasTrustedLabel && !riskyLabel
    ? 0
    : riskyLabel
      ? 95
      : Math.max(0, Math.min(100, reasons.reduce((sum, item) => sum + item.scoreImpact, 0)));
  const evidenceId = evidenceIdFor(event);
  const visibleReasons = reasons.filter((item) => item.scoreImpact !== 0 || item.code === "approval_spender_trusted" || item.code === "approval_finite_usdt");
  const rawEvidence: RawEvidenceInput[] = [
    {
      id: evidenceId,
      source: "approval_guard",
      sourceType: "detector_output",
      chain: "tron",
      address: event.spenderAddress,
      txHash: event.txHash,
      observedTransactionHash: event.txHash,
      evidenceJson: {
        ownerAddress: event.ownerAddress,
        spenderAddress: event.spenderAddress,
        tokenContract: event.tokenContract,
        amountRaw: event.amountRaw,
        isUnlimited: unlimited,
        spenderType: event.spenderType,
        labels: labels.map((label) => label.label),
        providerMetadata: metadata
          ? {
              name: metadata.name,
              tag: metadata.tag,
              isContract: metadata.isContract,
              verified: metadata.verified,
              providerRisk: metadata.providerRisk,
              accountType: metadata.accountType,
              contractCreatedAt: metadata.contractCreatedAt?.toISOString() ?? null
            }
          : null,
        signedAt: event.signedAt?.toISOString() ?? null,
        expirationAt: event.expirationAt?.toISOString() ?? null,
        signedToBlockDelayMs: delayMs,
        signingExpirationMs: expirationMs,
        refBlockBytes: event.refBlockBytes ?? null,
        refBlockHash: event.refBlockHash ?? null,
        approvalAt: event.timestamp.toISOString()
      }
    }
  ];
  const observations: RiskSignalObservationInput[] = visibleReasons.map((item) => ({
    id: observationIdFor(event, item.code),
    subjectChain: "tron",
    subjectAddress: event.spenderAddress,
    subjectTxHash: event.txHash,
    observedTransactionHash: event.txHash,
    signalGroup: "approval",
    code: item.code,
    message: item.message,
    scoreImpact: item.scoreImpact,
    confidence: item.confidence ?? "high",
    severity: item.severity ?? "high",
    source: "approval_guard",
    policyVersion: APPROVAL_GUARD_POLICY_VERSION,
    rawEvidenceId: evidenceId
  }));
  const report: RiskReport = {
    subjectAddress: event.spenderAddress,
    level: levelFromScore(score),
    score,
    reasons: visibleReasons
  };

  return {
    report,
    rawEvidence,
    observations,
    shouldAlert: report.level === "HIGH" || report.level === "CRITICAL"
  };
}
