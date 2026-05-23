import { describe, expect, it } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel } from "../../src/types";
import { APPROVAL_GUARD_POLICY_VERSION, evaluateApprovalRisk } from "../../src/approvals/approvalRisk";

const ownerAddress = "TOwner1111111111111111111111111111111";
const spenderAddress = "TSpender11111111111111111111111111111";
const approvalTxHash = "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";

function label(label: AddressLabel["label"]): AddressLabel {
  return {
    address: spenderAddress,
    label,
    source: "service_admin",
    createdByTelegramId: "9001",
    createdAt: new Date("2026-05-21T00:00:00.000Z")
  };
}

function event(overrides: Partial<Parameters<typeof evaluateApprovalRisk>[0]["event"]> = {}) {
  return {
    txHash: approvalTxHash,
    ownerAddress,
    spenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    timestamp: new Date("2026-05-06T19:06:15.000Z"),
    spenderType: "eoa" as const,
    ...overrides
  };
}

describe("evaluateApprovalRisk", () => {
  it("marks unlimited official USDT approval to unknown EOA as HIGH", () => {
    const evaluation = evaluateApprovalRisk({ event: event(), spenderLabels: [] });

    expect(evaluation.report).toMatchObject({
      subjectAddress: spenderAddress,
      level: "HIGH",
      score: 80
    });
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual([
      "approval_unlimited_usdt",
      "approval_spender_unknown_eoa"
    ]);
    expect(evaluation.rawEvidence[0]).toMatchObject({
      source: "approval_guard",
      sourceType: "detector_output",
      chain: "tron",
      address: spenderAddress,
      txHash: approvalTxHash
    });
    expect(evaluation.observations).toEqual([
      expect.objectContaining({
        signalGroup: "approval",
        code: "approval_unlimited_usdt",
        policyVersion: APPROVAL_GUARD_POLICY_VERSION,
        observedTransactionHash: approvalTxHash
      }),
      expect.objectContaining({
        signalGroup: "approval",
        code: "approval_spender_unknown_eoa",
        policyVersion: APPROVAL_GUARD_POLICY_VERSION
      })
    ]);
  });

  it("escalates delayed unlimited approvals to unknown EOA as CRITICAL", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({
        signedAt: new Date("2026-05-04T15:06:28.559Z"),
        expirationAt: new Date("2026-05-06T21:07:27.000Z"),
        refBlockBytes: "85bd",
        refBlockHash: "37b6a33ffa9ea697"
      }),
      spenderLabels: []
    });

    expect(evaluation.report).toMatchObject({
      level: "CRITICAL",
      score: 95
    });
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual([
      "approval_unlimited_usdt",
      "approval_spender_unknown_eoa",
      "approval_delayed_signed_transaction",
      "approval_extended_expiration"
    ]);
  });

  it("escalates risky-labeled spenders to CRITICAL", () => {
    const evaluation = evaluateApprovalRisk({ event: event(), spenderLabels: [label("phishing")] });

    expect(evaluation.report.level).toBe("CRITICAL");
    expect(evaluation.report.score).toBe(95);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toContain("approval_spender_risky_label");
  });

  it("dampens trusted spenders to LOW with no immediate alert", () => {
    const evaluation = evaluateApprovalRisk({ event: event(), spenderLabels: [label("trusted")] });

    expect(evaluation.report.level).toBe("LOW");
    expect(evaluation.report.score).toBe(0);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toContain("approval_spender_trusted");
  });

  it("dampens service-labeled unlimited approvals to MEDIUM dashboard-only risk", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ spenderType: "contract" }),
      spenderLabels: [label("bridge")]
    });

    expect(evaluation.report.level).toBe("MEDIUM");
    expect(evaluation.report.score).toBe(35);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual(["approval_spender_service_label"]);
  });

  it("dampens provider service-tag unlimited approvals to LOW", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ spenderType: "contract" }),
      spenderLabels: [],
      providerMetadata: {
        name: "Bridgers",
        tag: "Bridgers:Cross-chain Bridge",
        isContract: true,
        verified: true,
        providerRisk: false,
        accountType: 2,
        contractCreatedAt: new Date("2024-07-20T18:36:00.000Z")
      }
    });

    expect(evaluation.report.level).toBe("LOW");
    expect(evaluation.report.score).toBe(15);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual(["approval_provider_service_tag"]);
  });

  it("does not treat service-like names as trusted service tags", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ spenderType: "contract" }),
      spenderLabels: [],
      providerMetadata: {
        name: "SwapTRX",
        tag: null,
        isContract: true,
        verified: false,
        providerRisk: false,
        accountType: 2,
        contractCreatedAt: new Date("2025-12-13T08:29:03.000Z")
      }
    });

    expect(evaluation.report.level).toBe("MEDIUM");
    expect(evaluation.report.score).toBe(35);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual(["approval_provider_named_contract"]);
  });

  it("marks tokenApprove-like untagged transferFrom-capable contracts as HIGH review", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ spenderType: "contract" }),
      spenderLabels: [],
      providerMetadata: {
        name: "tokenApprove",
        tag: null,
        isContract: true,
        verified: true,
        providerRisk: false,
        accountType: 2,
        contractCreatedAt: new Date("2025-07-01T10:07:30.000Z")
      },
      contractProfile: {
        name: "tokenApprove",
        serviceTag: null,
        publicTag: null,
        publicTagDesc: null,
        verified: false,
        providerRisk: false,
        trxCount: "2",
        totalCallCount: null,
        uniqueCallerCount: null,
        topMethods: [],
        methodMap: {},
        hasTransferFromSelector: true,
        hasOwnerOnlyPattern: true,
        lowMetadata: true,
        activityLevel: "low"
      }
    });

    expect(evaluation.report.level).toBe("HIGH");
    expect(evaluation.report.score).toBe(70);
    expect(evaluation.shouldAlert).toBe(true);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual([
      "approval_unknown_drainer_contract_review",
      "contract_intel_low_metadata",
      "contract_intel_transferfrom_capable",
      "contract_intel_owner_only_pull_pattern"
    ]);
  });

  it("stores finite approvals without alerting unless the spender is risky labeled", () => {
    const finite = evaluateApprovalRisk({
      event: event({ isUnlimited: false, amountRaw: "1000000" }),
      spenderLabels: []
    });
    const riskyFinite = evaluateApprovalRisk({
      event: event({ isUnlimited: false, amountRaw: "1000000" }),
      spenderLabels: [label("scam")]
    });

    expect(finite.report.level).toBe("LOW");
    expect(finite.shouldAlert).toBe(false);
    expect(riskyFinite.report.level).toBe("CRITICAL");
    expect(riskyFinite.report.score).toBe(95);
  });

  it("keeps finite approvals below 10,000 USDT as LOW", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ isUnlimited: false, amountRaw: "9999999999" }),
      spenderLabels: []
    });

    expect(evaluation.report.level).toBe("LOW");
    expect(evaluation.report.score).toBe(0);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual(["approval_finite_usdt"]);
  });

  it("marks finite approvals at 10,000 USDT to unknown EOA as MEDIUM without immediate alert", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ isUnlimited: false, amountRaw: "10000000000" }),
      spenderLabels: []
    });

    expect(evaluation.report.level).toBe("MEDIUM");
    expect(evaluation.report.score).toBe(40);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual([
      "approval_large_finite_usdt",
      "approval_spender_unknown_eoa"
    ]);
  });

  it("marks finite approvals at 50,000 USDT as HIGH and immediate-alert eligible", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ isUnlimited: false, amountRaw: "50000000000" }),
      spenderLabels: []
    });

    expect(evaluation.report.level).toBe("HIGH");
    expect(evaluation.report.score).toBe(80);
    expect(evaluation.shouldAlert).toBe(true);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toEqual([
      "approval_very_large_finite_usdt",
      "approval_spender_unknown_eoa"
    ]);
  });

  it("dampens large finite approvals for trusted spenders to LOW", () => {
    const evaluation = evaluateApprovalRisk({
      event: event({ isUnlimited: false, amountRaw: "50000000000" }),
      spenderLabels: [label("trusted")]
    });

    expect(evaluation.report.level).toBe("LOW");
    expect(evaluation.report.score).toBe(0);
    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report.reasons.map((reason) => reason.code)).toContain("approval_spender_trusted");
  });
});
