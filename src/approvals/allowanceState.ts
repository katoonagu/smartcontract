import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ApprovalAllowanceStateV2 } from "../types";

export const UINT256_MAX_RAW = (2n ** 256n - 1n).toString();
export const ALLOWANCE_FRESHNESS_MS = 15 * 60 * 1000;

const FAILURE_CODES = new Set([
  "provider_timeout",
  "provider_unavailable",
  "malformed_response",
  "contract_call_reverted",
  "network_mismatch",
  "subject_binding_failed",
  "unknown_provider_error"
]);
const TRON_BASE58_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function fail(code: string): never {
  throw new Error(code);
}

function requireAddress(value: string, field: string): void {
  if (!TRON_BASE58_ADDRESS.test(value) || !TronWeb.isAddress(value)) fail(`allowance_invalid_${field}`);
}

function parseTimestamp(value: string | null, field: string): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`allowance_invalid_${field}`);
  }
  return parsed;
}

function requireCanonicalUint256(value: string | null): bigint | null {
  if (value === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) fail("allowance_invalid_uint256");
  const parsed = BigInt(value);
  if (parsed > BigInt(UINT256_MAX_RAW)) fail("allowance_uint256_overflow");
  return parsed;
}

function requireNull(value: unknown, code: string): void {
  if (value !== null) fail(code);
}

export function validateApprovalAllowanceStateV2(
  input: ApprovalAllowanceStateV2,
  evaluatedAt: Date
): ApprovalAllowanceStateV2 {
  if (!(evaluatedAt instanceof Date) || !Number.isFinite(evaluatedAt.getTime())) {
    fail("allowance_invalid_evaluated_at");
  }
  if (input.version !== "approval-allowance-v2") fail("allowance_invalid_version");
  if (input.source !== "official_usdt_allowance") fail("allowance_invalid_source");
  requireAddress(input.ownerAddress, "owner");
  requireAddress(input.spenderAddress, "spender");
  requireAddress(input.tokenContract, "token");
  if (input.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) fail("allowance_wrong_token_contract");
  const raw = requireCanonicalUint256(input.confirmedAllowanceRaw);
  const confirmedAt = parseTimestamp(input.confirmedAt, "confirmed_at");
  const freshUntil = parseTimestamp(input.freshUntil, "fresh_until");
  const lastAttemptAt = parseTimestamp(input.lastAttemptAt, "last_attempt_at");

  if (input.state === "failed") {
    if (lastAttemptAt === null) fail("allowance_failed_without_attempt");
    if (!input.failureCode || !FAILURE_CODES.has(input.failureCode)) fail("allowance_invalid_failure_code");
    if (input.isUnlimited !== null) fail("allowance_nonconfirmed_unlimited");
    if ((confirmedAt === null) !== (freshUntil === null) || (raw === null) !== (confirmedAt === null)) {
      fail("allowance_failed_history_shape");
    }
    if (confirmedAt && freshUntil && freshUntil.getTime() !== confirmedAt.getTime() + ALLOWANCE_FRESHNESS_MS) {
      fail("allowance_invalid_freshness_window");
    }
    if (confirmedAt && lastAttemptAt.getTime() < confirmedAt.getTime()) {
      fail("allowance_failure_precedes_confirmation");
    }
    return Object.freeze({ ...input, isUnlimited: null });
  }

  requireNull(input.failureCode, "allowance_nonfailed_failure_code");

  if (input.state === "stale") {
    if (input.isUnlimited !== null) fail("allowance_nonconfirmed_unlimited");
    const neverChecked = raw === null && confirmedAt === null && freshUntil === null && lastAttemptAt === null;
    if (!neverChecked) {
      if (raw === null || confirmedAt === null || freshUntil === null || lastAttemptAt === null) {
        fail("allowance_stale_history_shape");
      }
      if (confirmedAt.getTime() !== lastAttemptAt.getTime()) fail("allowance_timestamp_mismatch");
      if (freshUntil.getTime() !== confirmedAt.getTime() + ALLOWANCE_FRESHNESS_MS) {
        fail("allowance_invalid_freshness_window");
      }
      if (evaluatedAt.getTime() <= freshUntil.getTime()) fail("allowance_stale_not_expired");
    }
    return Object.freeze({ ...input, isUnlimited: null });
  }

  if (input.state !== "confirmed_active" && input.state !== "confirmed_zero") {
    fail("allowance_invalid_state");
  }
  if (raw === null || confirmedAt === null || freshUntil === null || lastAttemptAt === null) {
    fail("allowance_confirmed_shape");
  }
  if (confirmedAt.getTime() !== lastAttemptAt.getTime()) fail("allowance_timestamp_mismatch");
  if (freshUntil.getTime() !== confirmedAt.getTime() + ALLOWANCE_FRESHNESS_MS) {
    fail("allowance_invalid_freshness_window");
  }
  const isZero = raw === 0n;
  if (input.state === "confirmed_zero" && !isZero) fail("allowance_zero_state_nonzero");
  if (input.state === "confirmed_active" && isZero) fail("allowance_active_state_zero");
  const expectedUnlimited = raw === BigInt(UINT256_MAX_RAW);
  if (input.isUnlimited !== expectedUnlimited) fail("allowance_unlimited_mismatch");
  if (evaluatedAt.getTime() > freshUntil.getTime()) {
    return Object.freeze({ ...input, state: "stale", isUnlimited: null });
  }
  return Object.freeze({ ...input, isUnlimited: expectedUnlimited });
}
