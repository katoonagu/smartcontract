import { describe, expect, it } from "vitest";
import { validateApprovalAllowanceStateV2 } from "../../src/approvals/allowanceState";
import type { ApprovalAllowanceStateV2 } from "../../src/types";
import {
  APPROVAL_TX_HASH,
  expiredAllowanceState,
  failedAllowanceState,
  maxAllowanceState,
  NOW,
  TNARA_OWNER,
  zeroAllowanceState
} from "../fixtures/forensics/remediationDataCases";

const validate = (input: ApprovalAllowanceStateV2) => validateApprovalAllowanceStateV2(input, NOW);

describe("ApprovalAllowanceStateV2", () => {
  it("[REQ-19][AC-19] accepts a fresh direct-call max uint256 state as confirmed active", () => {
    expect(validate(maxAllowanceState)).toMatchObject({
      version: "approval-allowance-v2",
      state: "confirmed_active",
      isUnlimited: true,
      confirmedAt: "2026-07-12T12:00:00.000Z",
      freshUntil: "2026-07-12T12:15:00.000Z"
    });
  });

  it("[REQ-19][AC-23] accepts confirmed zero and keeps the approval event separate", () => {
    expect(validate(zeroAllowanceState)).toMatchObject({
      state: "confirmed_zero",
      confirmedAllowanceRaw: "0",
      isUnlimited: false,
      observedApprovalTxHash: APPROVAL_TX_HASH
    });
  });

  it("[REQ-19][AC-24] rejects failed or stale allowance as current", () => {
    expect(validate(failedAllowanceState)).toMatchObject({ state: "failed", isUnlimited: null });
    expect(validate(expiredAllowanceState)).toMatchObject({ state: "stale", isUnlimited: null });
  });

  it("[AC-20][DATA] preserves exact owner binding for a later balance-at-risk lookup", () => {
    expect(validate(maxAllowanceState).ownerAddress).toBe(TNARA_OWNER);
  });

  it("[AC-21][DATA] keeps the historical approval tx separate from current allowance authority", () => {
    expect(validate(maxAllowanceState)).toMatchObject({
      observedApprovalTxHash: APPROVAL_TX_HASH,
      source: "official_usdt_allowance"
    });
  });

  it("[AC-22][DATA] refuses provider name or selector context as a current allowance state", () => {
    expect(() => validate({
      ...failedAllowanceState,
      isUnlimited: true,
      providerName: "TronScan",
      selectorContext: "Verify20(address,address,address,uint256)"
    } as ApprovalAllowanceStateV2)).toThrow("allowance_nonconfirmed_unlimited");
  });

  it.each([
    ["wrong owner in the exact call triple", { ...maxAllowanceState, ownerAddress: "not-tron" }],
    ["wrong spender in the exact call triple", { ...maxAllowanceState, spenderAddress: "not-tron" }],
    ["wrong official USDT token in the exact call triple", { ...maxAllowanceState, tokenContract: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV" }],
    ["signed raw", { ...maxAllowanceState, confirmedAllowanceRaw: "-1" }],
    ["leading-zero raw", { ...maxAllowanceState, confirmedAllowanceRaw: "01" }],
    ["overflow raw", { ...maxAllowanceState, confirmedAllowanceRaw: (2n ** 256n).toString() }],
    ["wrong unlimited flag", { ...maxAllowanceState, isUnlimited: false }],
    ["success outside freshness window", { ...maxAllowanceState, freshUntil: "2026-07-12T12:09:59.999Z" }],
    ["unknown failure code", { ...failedAllowanceState, failureCode: "mystery" }],
    ["contradictory timestamps", { ...maxAllowanceState, lastAttemptAt: "2026-07-12T12:01:00.000Z" }]
  ])("rejects %s", (_name, input) => {
    expect(() => validate(input as ApprovalAllowanceStateV2)).toThrow();
  });
});
