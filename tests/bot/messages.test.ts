import { describe, expect, it } from "vitest";
import { safetyMessage } from "../../src/bot/messages";
import type { WalletDashboard } from "../../src/wallet/dashboard";

const now = new Date("2026-05-23T00:00:00.000Z");

function dashboard(): WalletDashboard {
  return {
    wallet: {
      id: "wallet-1",
      telegramUserId: "42",
      telegramUsername: "tester",
      address: "TWallet111111111111111111111111111111",
      createdAt: now,
      alertMode: "realtime",
      digestIntervalMinutes: 10
    },
    snapshot: {
      watchedWalletId: "wallet-1",
      trxBalanceSun: "0",
      usdtBalanceMicro: "0",
      walletCreatedAt: now,
      totalTxCount: null,
      incomingTxCount: null,
      outgoingTxCount: null,
      thirtyDayInUsdt: "0",
      thirtyDayOutUsdt: "0",
      thirtyDayTransferCount: 0,
      thirtyDayFeeSun: "0",
      trxUsdPrice: null,
      analyticsPartial: false,
      refreshedAt: now,
      lastError: null
    },
    safety: {
      subjectAddress: "TWallet111111111111111111111111111111",
      level: "LOW",
      score: 0,
      reasons: [],
      confidence: { level: "limited", checked: [], notConnected: [] },
      modules: []
    },
    approvalSummary: {
      usdtApprovalCount: 1,
      unlimitedApprovalCount: 0,
      highRiskApprovalCount: 1,
      drainObservationCount: 1,
      highRiskDrainObservationCount: 1,
      topRiskyApprovals: [
        {
          watchedWalletId: "wallet-1",
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          spenderAddress: "TSpender11111111111111111111111111111",
          amountRaw: "111111000000",
          isUnlimited: false,
          currentAllowanceRaw: "111111000000",
          spenderType: "eoa",
          status: "active",
          lastApprovalTxHash: "approval-tx",
          lastApprovalAt: new Date("2026-05-22T00:00:00.000Z"),
          riskLevel: "HIGH",
          riskScore: 80,
          riskReasons: [{ code: "approval_very_large_finite_usdt", message: "Very large finite approval", scoreImpact: 70 }],
          lastAlertedTxHash: "approval-tx",
          metadataName: "Bridgers",
          metadataTag: null,
          metadataSource: "tronscan",
          metadataIsContract: true,
          contractServiceTag: null,
          contractVerified: false,
          contractActivityLevel: "low",
          contractTopMethods: [{ methodId: "23b872dd", signature: "transferFrom(address,address,uint256)", count: 3, ratio: 1, method: "transferFrom(address,address,uint256)", calls: 3, percentage: 1 }],
          contractHasTransferFromSelector: true,
          contractHasOwnerOnlyPattern: true,
          updatedAt: now
        }
      ],
      topDrainObservations: [
        {
          id: "drain-1",
          watchedWalletId: "wallet-1",
          approvalTxHash: "approval-tx",
          transferTxHash: "transfer-tx",
          ownerAddress: "TWallet111111111111111111111111111111",
          spenderAddress: "TSpender11111111111111111111111111111",
          receiverAddress: "TReceiver1111111111111111111111111111",
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          amountRaw: "320652450320",
          callerAddress: "TSpender11111111111111111111111111111",
          method: "transferFrom",
          approvalAt: new Date("2026-05-20T00:00:00.000Z"),
          transferAt: new Date("2026-05-22T00:00:00.000Z"),
          timeToTransferMs: "172800000",
          spenderType: "eoa",
          receiverType: "eoa",
          observedMode: "shadow",
          riskLevel: "CRITICAL",
          riskScore: 95,
          riskReasons: [{ code: "approval_drain_unknown_eoa_spender", message: "EOA spender", scoreImpact: 60 }],
          rawEvidenceId: "evidence-1",
          createdAt: now,
          updatedAt: now
        }
      ]
    },
    pollState: null,
    source: "cache",
    cacheAgeMs: 0,
    lastError: null
  };
}

describe("bot messages", () => {
  it("shows decoded finite approval allowance in the Safety screen", () => {
    const text = safetyMessage(dashboard());

    expect(text).toContain("Risky approvals: 1");
    expect(text).toContain("Post-approval outflows: 1");
    expect(text).toContain("Bridgers");
    expect(text).toContain("finite 111,111 USDT");
    expect(text).toContain("HIGH 80/100");
    expect(text).toContain("Contract intelligence:");
    expect(text).toContain("no service tag, not verified, low");
    expect(text).toContain("transferFrom(address,address,uint256)");
    expect(text).toContain("Shadow observations:");
    expect(text).toContain("320,652.45032 USDT");
    expect(text).toContain("CRITICAL 95/100");
    expect(text).toContain("Revoke guide:");
    expect(text).toContain("Open TronScan approvals.");
    expect(text).toContain("Connect TronLink with the watched wallet.");
    expect(text).toContain("Find USDT approval for the spender.");
    expect(text).toContain("Cancel approval if unexpected.");
    expect(text).toContain("Bot is read-only. It never signs transactions and never asks for seed/private key.");
  });
});
