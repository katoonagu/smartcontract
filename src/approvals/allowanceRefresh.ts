import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ApprovalAllowanceStateV2 } from "../types";
import {
  ALLOWANCE_FRESHNESS_MS,
  UINT256_MAX_RAW,
  validateApprovalAllowanceStateV2
} from "./allowanceState";

export type ApprovalAllowanceRefreshReason =
  | "new_approval_event"
  | "context_finalization"
  | "explicit_safety_recheck"
  | "background_stale_refresh";

export type UsdtAllowanceReader = {
  getUsdtAllowance(input: { ownerAddress: string; spenderAddress: string }): Promise<string>;
};

function canonicalUint256(value: unknown): string {
  if (typeof value !== "string") throw new Error("malformed_response");
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("malformed_response");
  if (BigInt(value) > BigInt(UINT256_MAX_RAW)) throw new Error("malformed_response");
  return value;
}

function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    let response = "";
    try {
      response = JSON.stringify(record.response) ?? "";
    } catch {
      response = "";
    }
    return [record.code, record.name, record.message, record.status, response]
      .filter((value) => value !== undefined)
      .join(" ")
      .toLowerCase();
  }
  return String(error).toLowerCase();
}

function allowanceFailureCode(error: unknown): string {
  const text = errorText(error);
  if (text.includes("timeout") || text.includes("timedout") || text.includes("aborterror")) {
    return "provider_timeout";
  }
  if (text.includes("revert") || text.includes("contract_reverted")) {
    return "contract_call_reverted";
  }
  if (text.includes("malformed_response") || text.includes("invalid_uint256")) {
    return "malformed_response";
  }
  if (text.includes("invalid_tron_address")) return "subject_binding_failed";
  return "provider_unavailable";
}

export async function buildApprovalAllowanceRefreshState(input: {
  client: UsdtAllowanceReader;
  ownerAddress: string;
  spenderAddress: string;
  observedApprovalTxHash: string | null;
  now: Date;
  completionNow?: () => Date;
  reason: ApprovalAllowanceRefreshReason;
}): Promise<ApprovalAllowanceStateV2> {
  const attemptedAt = input.now.toISOString();
  try {
    const raw = canonicalUint256(await input.client.getUsdtAllowance({
      ownerAddress: input.ownerAddress,
      spenderAddress: input.spenderAddress
    }));
    const isZero = raw === "0";
    const confirmedAt = input.completionNow?.() ?? input.now;
    return {
      version: "approval-allowance-v2",
      ownerAddress: input.ownerAddress,
      spenderAddress: input.spenderAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      confirmedAllowanceRaw: raw,
      isUnlimited: raw === UINT256_MAX_RAW,
      state: isZero ? "confirmed_zero" : "confirmed_active",
      confirmedAt: confirmedAt.toISOString(),
      freshUntil: new Date(confirmedAt.getTime() + ALLOWANCE_FRESHNESS_MS).toISOString(),
      lastAttemptAt: confirmedAt.toISOString(),
      failureCode: null,
      source: "official_usdt_allowance",
      observedApprovalTxHash: input.observedApprovalTxHash
    };
  } catch (error) {
    return {
      version: "approval-allowance-v2",
      ownerAddress: input.ownerAddress,
      spenderAddress: input.spenderAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      confirmedAllowanceRaw: null,
      isUnlimited: null,
      state: "failed",
      confirmedAt: null,
      freshUntil: null,
      lastAttemptAt: attemptedAt,
      failureCode: allowanceFailureCode(error),
      source: "official_usdt_allowance",
      observedApprovalTxHash: input.observedApprovalTxHash
    };
  }
}

export async function refreshApprovalAllowance(
  input: Parameters<typeof buildApprovalAllowanceRefreshState>[0]
): Promise<ApprovalAllowanceStateV2> {
  return validateApprovalAllowanceStateV2(
    await buildApprovalAllowanceRefreshState(input),
    input.now
  );
}
