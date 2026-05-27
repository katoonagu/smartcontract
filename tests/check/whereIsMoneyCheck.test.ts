import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import type { AddressLabel, ForensicRouteEdge, RiskReport, ServiceClassification } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const cleanSender = "TCleanSender11111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";

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

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "LOW",
  score: 0,
  reasons: []
};

describe("runWhereIsMoneyCheck", () => {
  it("traces only balance-forming inbound transfers and ignores older unrelated inflows", async () => {
    const calls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-old", oldSender, subject, "20000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-bridge-subject", bridge, subject, "3000000000", "2026-05-22T10:10:00.000Z"),
          edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")
        ]
      ],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]],
      [oldSender, [edge("tx-binance-old", binance, oldSender, "20000000000", "2026-05-20T09:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === bridge) return service("bridge", "Allbridge");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.currentUsdtBalanceRaw).toBe("5000000000");
    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-clean-subject", "tx-bridge-subject"]);
    expect(calls).not.toContain(oldSender);
    expect(report.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ balanceTransferTxHash: "tx-clean-subject", verdict: "ACCEPTABLE" }),
      expect.objectContaining({ balanceTransferTxHash: "tx-bridge-subject", verdict: "DECLINE" })
    ]));
    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(78);
    expect(report.coverage).toMatchObject({
      selectedInboundTxCount: 2,
      selectedInboundVolumeRaw: "5000000000",
      currentBalanceCoverageRatio: 1,
      partial: false
    });
  });

  it("returns review incomplete when balance lookup fails", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => null,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("REVIEW");
    expect(report.riskScore).toBe(45);
    expect(report.coverage.partial).toBe(true);
    expect(report.decisionReasons).toEqual(["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });
});
