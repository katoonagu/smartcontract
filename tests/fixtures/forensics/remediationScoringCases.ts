import { UINT256_MAX_RAW } from "../../../src/approvals/allowanceState";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../../src/parser/transactionParser";
import type {
  ApprovalAllowanceStateV2,
  UsddPsmRouteObservationV1
} from "../../../src/types";

export const SUBJECT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
export const OWNER = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
export const VERIFY20 = "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK";
export const BRIDGERS = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
export const USDD_PSM = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";
export const APPROVAL_TX =
  "fde8e8925a5b0d65050bbfe102c21c79b508087113f955dd51f25514c2f823d1";
export const SWAP_TX =
  "c16e27c144732bee70de72c88f5e3e501ac2bd5bbcdad66f6edac5b66cd31743";
export const NOW = new Date("2026-07-13T10:00:00.000Z");

export function activeAllowance(
  raw = UINT256_MAX_RAW,
  spenderAddress = VERIFY20
): ApprovalAllowanceStateV2 {
  return {
    version: "approval-allowance-v2",
    ownerAddress: OWNER,
    spenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    confirmedAllowanceRaw: raw,
    isUnlimited: raw === UINT256_MAX_RAW,
    state: raw === "0" ? "confirmed_zero" : "confirmed_active",
    confirmedAt: NOW.toISOString(),
    freshUntil: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    lastAttemptAt: NOW.toISOString(),
    failureCode: null,
    source: "official_usdt_allowance",
    observedApprovalTxHash: APPROVAL_TX
  };
}

export function psmObservation(
  input: Partial<UsddPsmRouteObservationV1> = {}
): UsddPsmRouteObservationV1 {
  return {
    version: "usdd-psm-route-observation-v1",
    mode: "where",
    serviceId: "usdd_psm_gemjoin",
    serviceAddress: USDD_PSM,
    direction: "inbound_from_psm",
    amountRaw: "83000000",
    selectedAmountRaw: "100000000",
    hopCount: 1,
    serviceIdentityExact: true,
    amountContinuityExact: true,
    scoringEligible: true,
    ineligibilityReason: null,
    evidenceIds: ["tx-psm", "tx-selected"],
    ...input
  };
}
