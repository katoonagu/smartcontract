import { describe, expect, it } from "vitest";
import { traceMoneyOriginPath } from "../../src/forensics/moneyOriginTrace";
import type { AddressLabel, BalanceFormingTransfer, ForensicRouteEdge, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const walletB = "TWalletB1111111111111111111111111111";
const walletC = "TWalletC1111111111111111111111111111";
const walletD = "TWalletD1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const whitebit = "TWhiteBIT11111111111111111111111111";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function balanceTransfer(fromAddress: string, txHash = "tx-balance"): BalanceFormingTransfer {
  return {
    txHash,
    fromAddress,
    toAddress: subject,
    amountRaw: "5000000000",
    timestamp: "2026-05-22T10:15:00.000Z",
    coverageShare: 1,
    selectedReason: "covers_current_balance"
  };
}

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

function whitebitLabel(): AddressLabel {
  return {
    address: whitebit,
    label: "whitebit",
    source: "service_admin",
    createdByTelegramId: "1",
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

describe("traceMoneyOriginPath", () => {
  it("accepts a clean multi-hop EOA chain from an allowlisted CEX", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletD, [edge("tx-c-d", walletC, walletD, "5000000000", "2026-05-22T10:10:00.000Z")]],
      [walletC, [edge("tx-b-c", walletB, walletC, "5000000000", "2026-05-22T10:05:00.000Z")]],
      [walletB, [edge("tx-binance-b", binance, walletB, "5000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletD),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceAddress: binance,
      rootSourceType: "allowlist_cex",
      stoppedReason: "allowlist_cex_reached",
      riskScoreContribution: 5,
      pathAddresses: [binance, walletB, walletC, walletD, subject],
      txHashes: ["tx-binance-b", "tx-b-c", "tx-c-d", "tx-balance"],
      amountPreservationRatio: 1
    });
  });

  it("declines when the balance-forming path reaches a bridge boundary", async () => {
    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(bridge),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === bridge ? service("bridge", "Allbridge") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceAddress: bridge,
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 78,
      exposureSourceKey: "bridge_router_dex",
      sourceExposureKind: "bridge_router_dex",
      pathAddresses: [bridge, subject]
    });
    expect(path.reasons.join(" ")).toContain("source-policy decline risk");
  });

  it("scores WhiteBIT labels as medium even when the service classification is generic CEX", async () => {
    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(whitebit),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async (address) => address === whitebit ? [whitebitLabel()] : [],
      getClassificationForAddress: async (address) => address === whitebit ? service("cex", "WhiteBIT") : service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      riskScoreContribution: 60,
      exposureSourceKey: "whitebit",
      sourceExposureKind: "whitebit"
    });
    expect(path.reasons[0]).toContain("WhiteBIT exposure (100% of selected provenance target)");
  });

  it("returns review incomplete when clean EOA tracing exhausts the configured depth", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletD, [edge("tx-c-d", walletC, walletD, "5000000000", "2026-05-22T10:10:00.000Z")]],
      [walletC, [edge("tx-b-c", walletB, walletC, "5000000000", "2026-05-22T10:05:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletD),
      maxDepth: 2,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path).toMatchObject({
      verdict: "REVIEW",
      rootSourceAddress: walletB,
      rootSourceType: "incomplete",
      stoppedReason: "data_budget_exhausted",
      riskScoreContribution: 45,
      pathAddresses: [walletB, walletC, walletD, subject]
    });
  });

  it("treats weak amount or time continuity as provenance weakness instead of high risk", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [walletB, [edge("tx-c-b-weak", walletC, walletB, "1000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const path = await traceMoneyOriginPath({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(walletB),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null)
    });

    expect(path.stoppedReason).toBe("weak_amount_or_time_continuity");
    expect(path.verdict).toBe("REVIEW");
    expect(path.riskScoreContribution).toBe(30);
    expect(path.reasons[0]).toMatch(/Clean CEX origin is not fully proven/i);
  });
});
