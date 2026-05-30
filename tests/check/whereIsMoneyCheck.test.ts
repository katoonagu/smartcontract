import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import { createContractLlmVerdictAnalyzer } from "../../src/forensics/contractLlmVerdict";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel, ContractLlmVerdictSummary, ForensicRouteEdge, RiskReport, ServiceClassification } from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";
import { regressionCases } from "../fixtures/forensics/regressionCases";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const cleanSender = "TCleanSender11111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const victim = "TVictim1111111111111111111111111111";
const spender = "TSpender111111111111111111111111111";
const operator = "TOperator111111111111111111111111111";
const wrapperContract = "TWrapper11111111111111111111111111";
const wrapperCloneContract = "TWrapper22222222222222222222222222";

function edge(
  id: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string,
  edgeType: ForensicRouteEdge["edgeType"] = "normal_transfer"
): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: edgeType === "transfer_from" ? "transferFrom" : "transfer",
    edgeType
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

function addressLabel(address: string, label: AddressLabel["label"]): AddressLabel {
  return {
    address,
    label,
    source: "system",
    createdByTelegramId: null,
    createdAt: new Date("2026-05-22T10:00:00.000Z")
  };
}

type RegressionCaseName = typeof regressionCases[number]["name"];

function expectRegressionReport(
  report: { userDecision: string; proofLevel: string },
  name: RegressionCaseName
): void {
  const caseItem = regressionCases.find((item) => item.name === name);
  expect(caseItem).toBeDefined();
  expect(report.userDecision).toBe(caseItem?.expectedDecision);
  expect(report.proofLevel).toBe(caseItem?.expectedProofLevel);
}

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "LOW",
  score: 0,
  reasons: []
};

function approval(overrides: Partial<TronscanApprovalChange> = {}): TronscanApprovalChange {
  return {
    txHash: "tx-approval",
    ownerAddress: victim,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "999999999999",
    isUnlimited: true,
    timestamp: new Date("2026-05-22T09:55:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

describe("runWhereIsMoneyCheck", () => {
  it("accepts a TEY-like operational liquidity wallet without source boundary proof", async () => {
    const senderA = "TLiquiditySenderA111111111111111111";
    const senderB = "TLiquiditySenderB111111111111111111";
    const funderA1 = "TLiquidityFunderA111111111111111111";
    const funderA2 = "TLiquidityFunderA222222222222222222";
    const funderB1 = "TLiquidityFunderB111111111111111111";
    const funderB2 = "TLiquidityFunderB222222222222222222";
    const sinkA1 = "TLiquiditySinkA11111111111111111111";
    const sinkA2 = "TLiquiditySinkA22222222222222222222";
    const sinkB1 = "TLiquiditySinkB11111111111111111111";
    const sinkB2 = "TLiquiditySinkB22222222222222222222";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-liq-a-subject", senderA, subject, "100000000", "2026-05-22T10:00:00.000Z"),
          edge("tx-liq-b-subject", senderB, subject, "100000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [
        senderA,
        [
          edge("tx-a-in-1", funderA1, senderA, "90000000", "2026-05-20T08:00:00.000Z"),
          edge("tx-a-in-2", funderA2, senderA, "80000000", "2026-05-20T09:00:00.000Z"),
          edge("tx-a-in-3", funderA1, senderA, "70000000", "2026-05-21T08:00:00.000Z"),
          edge("tx-a-in-4", funderA2, senderA, "65000000", "2026-05-21T09:00:00.000Z"),
          edge("tx-a-out-1", senderA, sinkA1, "70000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-a-out-2", senderA, sinkA2, "60000000", "2026-05-20T11:00:00.000Z"),
          edge("tx-a-out-3", senderA, sinkA1, "50000000", "2026-05-21T10:00:00.000Z"),
          edge("tx-a-out-4", senderA, sinkA2, "25000000", "2026-05-21T11:00:00.000Z"),
          edge("tx-liq-a-subject", senderA, subject, "100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [
        senderB,
        [
          edge("tx-b-in-1", funderB1, senderB, "95000000", "2026-05-20T08:30:00.000Z"),
          edge("tx-b-in-2", funderB2, senderB, "85000000", "2026-05-20T09:30:00.000Z"),
          edge("tx-b-in-3", funderB1, senderB, "75000000", "2026-05-21T08:30:00.000Z"),
          edge("tx-b-in-4", funderB2, senderB, "55000000", "2026-05-21T09:30:00.000Z"),
          edge("tx-b-out-1", senderB, sinkB1, "75000000", "2026-05-20T10:30:00.000Z"),
          edge("tx-b-out-2", senderB, sinkB2, "65000000", "2026-05-20T11:30:00.000Z"),
          edge("tx-b-out-3", senderB, sinkB1, "45000000", "2026-05-21T10:30:00.000Z"),
          edge("tx-b-out-4", senderB, sinkB2, "25000000", "2026-05-21T11:30:00.000Z"),
          edge("tx-liq-b-subject", senderB, subject, "100000000", "2026-05-22T10:05:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "200000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.userDecision).toBe("ACCEPTABLE");
    expect(report.assessment).toMatchObject({
      walletRole: "operational_liquidity_wallet",
      hardBadEvidence: [],
      riskBand: "LOW-MEDIUM"
    });
    expect(report.riskScore).toBeGreaterThanOrEqual(25);
    expect(report.riskScore).toBeLessThanOrEqual(40);
    expect(report.decisionReasons.join(" ")).toContain("operational/liquidity wallet");
  });

  it("uses seeded transaction transfer instead of reselecting balance-forming transfers", async () => {
    const calls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-other", oldSender, subject, "9000000000", "2026-05-22T11:00:00.000Z")]],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "1000000000", "2026-05-22T09:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "9000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      mode: "transaction_check",
      subjectAddress: subject,
      requestedAmountRaw: "1000000000",
      seedTransfers: [{
        txHash: "tx-seed",
        fromAddress: cleanSender,
        toAddress: subject,
        amountRaw: "1000000000",
        timestamp: "2026-05-22T10:00:00.000Z",
        coverageShare: 1,
        selectedReason: "covers_current_balance"
      }],
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-seed"]);
    expect(report.coverage.requestedAmountRaw).toBe("1000000000");
    expect(report.coverage.selectedAmountRaw).toBe("1000000000");
    expect(calls).not.toContain(subject);
    expect(report.originPaths).toEqual([
      expect.objectContaining({ balanceTransferTxHash: "tx-seed", verdict: "ACCEPTABLE" })
    ]);
    expectRegressionReport(report, "Binance through clean EOA is acceptable");
  });

  it("uses recent-flow provenance for low-balance wallets with a meaningful outgoing anchor", async () => {
    const lowBalanceSubject = "TSubjectLowBalance11111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        lowBalanceSubject,
        [
          edge("in-a", "TFunderA", lowBalanceSubject, "50000000000", "2026-05-05T08:00:00.000Z"),
          edge("in-b", "TFunderB", lowBalanceSubject, "40000000000", "2026-05-05T08:10:00.000Z"),
          edge("out-anchor", lowBalanceSubject, "TReceiver", "89473150000", "2026-05-05T08:49:27.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "147000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: lowBalanceSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.coverage.provenanceScope).toBe("recent_flow");
    expect(report.coverage.anchorTransfer?.txHash).toBe("out-anchor");
    expect(report.coverage.notes.join(" ")).toContain("recent-flow provenance");
    expect(report.balanceFormingTransfers.map((item) => item.txHash)).toEqual(["in-b", "in-a"]);
  });

  it("keeps requested-amount mode even when current balance is low", async () => {
    const requestedSubject = "TSubjectRequested111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        requestedSubject,
        [edge("in-a", "TFunderA", requestedSubject, "2000000000", "2026-05-05T08:00:00.000Z")]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "100000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: requestedSubject,
      requestedAmountRaw: "1000000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(report.coverage.provenanceScope).toBe("requested_amount");
    expect(report.coverage.anchorTransfer).toBeNull();
  });

  it("declines HTX through a clean EOA as an exchange policy case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")]],
      [cleanSender, [edge("tx-htx-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "HTX") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths[0]).toMatchObject({
      balanceTransferTxHash: "tx-clean-subject",
      pathAddresses: [binance, cleanSender, subject],
      verdict: "DECLINE"
    });
    expectRegressionReport(report, "HTX through clean EOA is high policy decline");
  });

  it("declines a small WhiteBIT balance share as exchange policy rather than taint proof", async () => {
    const trustedSender = "TTrustedSender111111111111111111111";
    const whitebitSender = "TWhitebitSender11111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-trusted-subject", trustedSender, subject, "9000000000", "2026-05-22T10:15:00.000Z"),
          edge("tx-whitebit-subject", whitebitSender, subject, "1000000000", "2026-05-22T10:20:00.000Z")
        ]
      ],
      [trustedSender, [edge("tx-binance-trusted", binance, trustedSender, "9000000000", "2026-05-22T10:00:00.000Z")]],
      [whitebitSender, [edge("tx-whitebit-sender", bridge, whitebitSender, "1000000000", "2026-05-22T10:05:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "10000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === bridge) return service("cex", "WhiteBIT");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ balanceTransferTxHash: "tx-whitebit-subject", verdict: "DECLINE" }),
      expect.objectContaining({ balanceTransferTxHash: "tx-trusted-subject", verdict: "ACCEPTABLE" })
    ]));
    expect(report.decisionReasons.join(" ")).toContain("WhiteBIT");
    expect(report.decisionReasons.join(" ")).not.toMatch(/direct scam proof|exact scam|blacklist/i);
    expectRegressionReport(report, "WhiteBIT small share is medium policy decline");
  });

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
    expect(report.originPaths.find((path) => path.balanceTransferTxHash === "tx-clean-subject")?.steps).toEqual([
      expect.objectContaining({ txHash: "tx-binance-clean", amountRaw: "2000000000" }),
      expect.objectContaining({ txHash: "tx-clean-subject", amountRaw: "2000000000" })
    ]);
    expect(report.senderInteractionProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        balanceTransferTxHash: "tx-clean-subject",
        senderAddress: cleanSender,
        incomingTxCount: 1,
        outgoingTxCount: 0,
        fundingCandidates: [
          expect.objectContaining({ txHash: "tx-binance-clean", amountPreservationRatio: 1 })
        ]
      }),
      expect.objectContaining({
        balanceTransferTxHash: "tx-bridge-subject",
        senderAddress: bridge,
        incomingTxCount: 0,
        outgoingTxCount: 0,
        fundingCandidates: []
      })
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

  it("traces only latest balance-forming transfers needed to cover the requested amount", async () => {
    const calls: string[] = [];
    const senderA = "TSenderA111111111111111111111111111";
    const senderB = "TSenderB111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-old-large", oldSender, subject, "4000000000", "2026-05-22T10:00:00.000Z"),
          edge("tx-older-700", senderA, subject, "700000000", "2026-05-22T10:05:00.000Z"),
          edge("tx-newer-700", senderB, subject, "700000000", "2026-05-22T10:10:00.000Z")
        ]
      ],
      [senderA, [edge("tx-binance-a", binance, senderA, "700000000", "2026-05-22T09:50:00.000Z")]],
      [senderB, [edge("tx-binance-b", binance, senderB, "700000000", "2026-05-22T09:55:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      requestedAmountRaw: "1000000000",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-newer-700", "tx-older-700"]);
    expect(calls).not.toContain(oldSender);
    expect(report.coverage).toMatchObject({
      currentBalanceRaw: "5000000000",
      requestedAmountRaw: "1000000000",
      targetAmountRaw: "1000000000",
      selectedAmountRaw: "1400000000",
      selectedInboundVolumeRaw: "1400000000",
      partial: false
    });
    expect(report.coverage.coverageRatio).toBeGreaterThanOrEqual(1);
    expect(report.coverage.notes[0]).toContain("requested amount");
  });

  it("maps fast wallet exact critical declines to exact scam or taint proof", async () => {
    const exactFastRisk: RiskReport = {
      subjectAddress: subject,
      level: "CRITICAL",
      score: 90,
      reasons: [
        {
          code: "stablecoin_usdt_blacklisted",
          message: "Official TRON USDT contract blacklist state is active for this address.",
          scoreImpact: 90,
          source: "stablecoin_contract",
          confidence: "high",
          severity: "critical"
        }
      ]
    };
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")]],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        return service("none", null);
      },
      getFastWalletRisk: async () => exactFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.internalDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exact_scam_or_taint_proof");
    expect(report.decisionReasons[0]).toContain("critical score");
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("fast_critical");
  });

  it("maps risky-label origin path declines to exact scam or taint proof", async () => {
    const scamSeed = "TScamSeed11111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-sender-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")]],
      [cleanSender, [edge("tx-scam-sender", scamSeed, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]],
      [scamSeed, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (address): Promise<AddressLabel[]> => address === scamSeed ? [addressLabel(scamSeed, "scam")] : [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exact_scam_or_taint_proof");
    expect(report.decisionReasons).toEqual(expect.arrayContaining([
      expect.stringContaining("high-risk label scam")
    ]));
  });

  it("declines when balance-forming funds are exact approval-drain transferFrom proceeds", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-transferfrom-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z", "transfer_from")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2576000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender }),
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-22T10:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(90);
    expect(report.decisionReasons[0]).toContain("Exact approval-drain provenance");
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
    expect(report.approvalDrainProvenanceProfiles).toEqual([
      expect.objectContaining({
        victimAddress: victim,
        spenderAddress: spender,
        drainTxHash: "tx-transferfrom-drain",
        hopDepth: 0,
        score: 90,
        evidenceStrength: "exact_approval_and_transfer_from"
      })
    ]);
  });

  it("uses contract intelligence to keep verified router swaps out of exact approval-drain proof", async () => {
    const router = "TRouter11111111111111111111111111111";
    const outputToken = "TOutput111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [
        router,
        [
          edge("tx-router-swap", victim, router, "1000000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === router) return service("router", "SunSwap Router");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({
        ownerAddress: router,
        contractAddress: TRON_USDT_CONTRACT_ADDRESS,
        trigger_info: {
          methodName: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
        },
        trc20TransferInfo: [
          {
            from_address: victim,
            to_address: router,
            quant: "1000000000",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            tokenInfo: { tokenAbbr: "USDT", tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" }
          },
          {
            from_address: router,
            to_address: victim,
            quant: "250000000000000000",
            contract_address: outputToken,
            tokenInfo: { tokenAbbr: "SUN", tokenId: outputToken, tokenType: "trc20" }
          }
        ]
      }),
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000000"
        })
      ],
      getContractIntelligenceProfile: async (address) => address === router
        ? {
            contractAddress: router,
            isVerified: true,
            serviceTag: "SunSwap Router",
            topMethods: [{ methodId: "0x", signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            methodMap: {},
            rawPayload: {}
          }
        : null
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.approvalDrainReviewFindings).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-router-swap",
        reason: "service_boundary_guard",
        falsePositiveGuards: [
          expect.objectContaining({
            code: "service_boundary_route",
            address: router,
            category: "router",
            identity: "SunSwap Router"
          })
        ]
      })
    ]);
    expect(report.originPaths[0]).toMatchObject({
      rootSourceAddress: router,
      stoppedReason: "decline_boundary_reached",
      verdict: "DECLINE"
    });
    expect(report.decisionReasons).not.toEqual(expect.arrayContaining([
      expect.stringContaining("exact approval-drain transferFrom")
    ]));
    expectRegressionReport(report, "Known DEX router approval with output is guarded, not drainer proof");
  });

  it("declines TFagr-style wrapper drains even when the visible method is not transferFrom", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          {
            ...edge("tx-wrapper-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z"),
            method: "Verify20"
          }
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2576000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {
            ownerAddress: cleanSender,
            contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
            trigger_info: { methodName: "transfer" }
          },
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "999999999999"
        })
      ],
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-22T10:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(90);
    expect(report.approvalDrainProvenanceProfiles[0]).toMatchObject({
      spenderAddress: wrapperContract,
      operatorAddress: operator,
      spenderResolution: "wrapper_contract",
      score: 90
    });
    expectRegressionReport(report, "Wrapper transferFrom path to checked wallet is exact approval-drain decline");
  });

  it("records a service-boundary guard without adding approval-drain auto-decline", async () => {
    const router = "TRouter11111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")]],
      [
        router,
        [
          edge("tx-drain-to-router", victim, router, "1000000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === router) return service("router", "Known router");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender, trigger_info: { methodName: "transferFrom" } }),
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000000"
        })
      ]
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.decisionReasons).not.toEqual(expect.arrayContaining([
      expect.stringContaining("exact approval-drain transferFrom")
    ]));
    expect(report.approvalDrainReviewFindings).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-drain-to-router",
        falsePositiveGuards: [
          expect.objectContaining({ code: "receiver_service_boundary" })
        ]
      })
    ]);
  });

  it("skips approval transaction-info enrichment for clean CEX-funded wallets without triggers", async () => {
    const txInfoCalls: string[] = [];
    const inboundEdges = Array.from({ length: 28 }, (_, index) => {
      const sender = `TBudgetSender${String(index).padStart(2, "0")}111111111111111`;
      return edge(`tx-budget-in-${index}`, sender, subject, "1000000", `2026-05-22T10:${String(index).padStart(2, "0")}:00.000Z`);
    });
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, inboundEdges]
    ]);
    inboundEdges.forEach((inbound, index) => {
      byAddress.set(inbound.fromAddress, [
        edge(`tx-budget-fund-${index}`, binance, inbound.fromAddress, "1000000", `2026-05-22T09:${String(index).padStart(2, "0")}:00.000Z`)
      ]);
    });

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "28000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        txInfoCalls.push(txHash);
        return {};
      },
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async () => null
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 50,
      maxContractTransactionInfoFetches: 5
    });

    expect(txInfoCalls).toEqual([]);
    expect(report.coverage.notes).toContain("Approval/contract enrichment skipped because no contract/service trigger was found.");
  });

  it("limits approval transaction-info enrichment for triggered contract paths", async () => {
    const txInfoCalls: string[] = [];
    let activeTxInfoCalls = 0;
    let maxActiveTxInfoCalls = 0;
    const inboundEdges = Array.from({ length: 28 }, (_, index) => {
      const sender = `TBudgetSender${String(index).padStart(2, "0")}111111111111111`;
      return edge(`tx-budget-in-${index}`, sender, subject, "1000000", `2026-05-22T10:${String(index).padStart(2, "0")}:00.000Z`);
    });
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, inboundEdges]
    ]);
    inboundEdges.forEach((inbound, index) => {
      const funder = index < 5 ? wrapperContract : `TBudgetFunder${String(index).padStart(2, "0")}111111111111111`;
      byAddress.set(inbound.fromAddress, [
        edge(`tx-budget-fund-${index}`, funder, inbound.fromAddress, "1000000", `2026-05-22T09:${String(index).padStart(2, "0")}:00.000Z`)
      ]);
    });
    byAddress.set(wrapperContract, []);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "28000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        activeTxInfoCalls += 1;
        maxActiveTxInfoCalls = Math.max(maxActiveTxInfoCalls, activeTxInfoCalls);
        txInfoCalls.push(txHash);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeTxInfoCalls -= 1;
        return {};
      },
      listTrc20ApprovalChanges: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    expect(txInfoCalls.length).toBeLessThanOrEqual(5);
    expect(maxActiveTxInfoCalls).toBe(1);
    expect(report.coverage.notes).toContain("Approval/contract enrichment budget: checked 5 candidate edge(s).");
  });

  it("still checks explicit transferFrom edges adjacent to clean CEX-funded paths", async () => {
    const txInfoCalls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-binance-clean", binance, cleanSender, "1000000", "2026-05-22T09:00:00.000Z"),
          edge("tx-transferfrom-drain", victim, cleanSender, "1000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        txInfoCalls.push(txHash);
        return { ownerAddress: spender, trigger_info: { methodName: "transferFrom" } };
      },
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000"
        })
      ]
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    expect(report.originPaths[0]).toMatchObject({
      verdict: "ACCEPTABLE",
      rootSourceType: "allowlist_cex"
    });
    expect(txInfoCalls).toContain("tx-transferfrom-drain");
    expect(report.approvalDrainProvenanceProfiles).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-transferfrom-drain",
        hopDepth: 1
      })
    ]);
    expect(report.approvalDrainProvenanceProfiles[0]?.score).toBeGreaterThanOrEqual(70);
    expect(report.decision).toBe("DECLINE");
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("approval_drain");
  });

  it("prioritizes explicit transferFrom triggers before supporting path legs when the budget is tight", async () => {
    const txInfoCalls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-binance-clean", binance, cleanSender, "1000000", "2026-05-22T09:00:00.000Z"),
          edge("tx-transferfrom-drain", victim, cleanSender, "1000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-sender-subject", cleanSender, subject, "1000000", "2026-05-22T10:05:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === binance ? service("cex", "Binance") : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => {
        txInfoCalls.push(txHash);
        return { ownerAddress: spender, trigger_info: { methodName: "transferFrom" } };
      },
      listTrc20ApprovalChanges: async () => []
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 1,
      maxContractTransactionInfoFetches: 1
    });

    expect(txInfoCalls).toEqual(["tx-transferfrom-drain"]);
  });

  it("does not claim approval enrichment was checked when lookup dependencies are unavailable", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxApprovalCandidates: 5,
      maxContractTransactionInfoFetches: 5
    });

    expect(report.coverage.notes).toContain("Approval/contract enrichment skipped because transaction or approval lookup dependencies are unavailable.");
    expect(report.coverage.notes.join(" ")).not.toContain("Approval/contract enrichment budget: checked");
  });

  it("uses an LLM contract verdict to decline an uncertain wrapper approval-drain case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.82,
      contractRiskScore: 88,
      decisionRecommendation: "DECLINE",
      reasons: ["Wrapper method hides transferFrom-like token movement."],
      citedEvidenceIds: ["tx-wrapper-drain"],
      falsePositiveNotes: []
    };
    let capturedCaseFiles: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {
            ownerAddress: cleanSender,
            contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
            trigger_info: { methodName: "transfer" }
          },
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: { source_status: "available" },
            isVerified: false,
            providerRisk: null,
            hasTransferFromSelector: false,
            hasOwnerOnlyPattern: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles = caseFiles;
        return [llmVerdict];
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("llm_assisted_suspicion");
    expect(report.riskScore).toBe(88);
    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.contractLlmVerdicts).toEqual([llmVerdict]);
    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainReviewFindings: [
        expect.objectContaining({
          drainTxHash: "tx-wrapper-drain",
          reason: "approval_not_found"
        })
      ]
    });
    expect(report.decisionReasons).toEqual(expect.arrayContaining([
      "LLM contract verdict is drainer_like with score 88/100 and 82% confidence."
    ]));
    expect(report.assessment.hardBadEvidence.map((item) => item.kind)).toContain("llm_contract_suspicion");
  });

  it("uses a high-confidence unknown-suspicious LLM verdict to decline an unproven risky contract path", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.82,
      contractRiskScore: 83,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown wrapper movement is suspicious but not exact drain proof."],
      citedEvidenceIds: ["tx-wrapper-drain"],
      falsePositiveNotes: []
    };

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {},
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: {},
            isVerified: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async () => [llmVerdict]
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("llm_assisted_suspicion");
    expect(report.riskScore).toBe(83);
    expect(report.decisionReasons).toEqual([
      "LLM contract verdict is unknown_suspicious with 82% confidence."
    ]);
    expect(report.assessment.hardBadEvidence).toEqual([
      expect.objectContaining({
        kind: "llm_contract_suspicion",
        evidenceIds: ["tx-wrapper-drain"]
      })
    ]);
  });

  it("treats an unknown contract boundary as unproven context, not scam proof", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.originPaths[0]).toMatchObject({
      rootSourceAddress: wrapperContract,
      stoppedReason: "unlabeled_service_boundary",
      verdict: "REVIEW"
    });
    expect(report.assessment.hardBadEvidence).toHaveLength(0);
    expect(report.decision).toBe("DECLINE");
    expect(report.proofLevel).toBe("insufficient_coverage");
    expect(report.decisionReasons.join(" ")).toContain("Clean source could not be proven");
  });

  it("does not reuse a drainer fingerprint verdict when the cloned contract flow is different", async () => {
    let llmCalls = 0;
    const analyzer = createContractLlmVerdictAnalyzer({
      client: {
        completeJson: async () => {
          llmCalls += 1;
          return {
            ok: true,
            providerLabel: "deepseek",
            model: "deepseek-v4-flash",
            json: llmCalls === 1
              ? {
                  verdict: "drainer_like",
                  confidence: 0.9,
                  contractRiskScore: 90,
                  decisionRecommendation: "DECLINE",
                  reasons: ["Wrapper flow is drainer-like."],
                  citedEvidenceIds: ["tx-wrapper-drain"],
                  falsePositiveNotes: []
                }
              : {
                  verdict: "legitimate_service",
                  confidence: 0.82,
                  contractRiskScore: 20,
                  decisionRecommendation: "ACCEPTABLE",
                  reasons: ["No approval-drain flow is present."],
                  citedEvidenceIds: ["tx-clone-clean"],
                  falsePositiveNotes: []
                },
            rawText: "{}",
            latencyMs: 10
          };
        }
      },
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      cacheTtlMs: 60_000,
      now: () => new Date("2026-05-28T00:00:00.000Z")
    });
    const contractProfile = (contractAddress: string) => ({
      contractAddress,
      methodMap: { deadbeef: "Verify20(address,address,uint256)" },
      topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
      providerTags: [],
      publicTags: [],
      rawPayload: { contract: { address: contractAddress, source_code: "contract X { function Verify20() public {} }" } },
      isVerified: false,
      lowMetadata: true,
      activityLevel: "low" as const
    });

    const firstFlowEdges = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [victim, []]
    ]);

    await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => firstFlowEdges.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === wrapperContract ? service("unknown_contract", null) : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {},
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract ? contractProfile(wrapperContract) : null,
      analyzeContractLlmCaseFiles: analyzer
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    const secondSubject = "TSubject22222222222222222222222222";
    const secondCleanSender = "TCleanSender222222222222222222222";
    const secondFlowEdges = new Map<string, ForensicRouteEdge[]>([
      [secondSubject, [edge("tx-clone-subject", secondCleanSender, secondSubject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [secondCleanSender, [edge("tx-clone-clean", wrapperCloneContract, secondCleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperCloneContract, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => secondFlowEdges.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => address === wrapperCloneContract ? service("unknown_contract", null) : service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getContractIntelligenceProfile: async (address) => address === wrapperCloneContract ? contractProfile(wrapperCloneContract) : null,
      analyzeContractLlmCaseFiles: analyzer
    }, {
      sourceAddress: secondSubject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(llmCalls).toBe(2);
    expect(report.contractLlmVerdicts?.[0]).toMatchObject({
      source: "llm",
      verdict: "legitimate_service",
      contractAddress: wrapperCloneContract
    });
    expectRegressionReport(report, "Fingerprint clone with different flow does not reuse drainer verdict");
  });

  it("declines by insufficient coverage when LLM times out on an uncertain contract case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {},
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: {},
            isVerified: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => caseFiles.map((caseFile) => ({
        source: "unavailable" as const,
        cacheMatch: null,
        reusedFromContractAddress: null,
        providerLabel: "deepseek",
        model: "deepseek-v4-flash",
        contractAddress: caseFile.contractAddress,
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "unknown_insufficient_data" as const,
        confidence: 0,
        contractRiskScore: 65,
        decisionRecommendation: "DECLINE" as const,
        reasons: ["Clean contract intent could not be verified automatically."],
        citedEvidenceIds: [],
        falsePositiveNotes: [],
        error: "llm timed out"
      }))
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.contractLlmVerdicts?.[0]).toMatchObject({
      source: "unavailable",
      error: "llm timed out"
    });
    expect(report.riskScore).toBe(65);
    expect(report.decisionReasons[0]).toContain("LLM unavailable: llm timed out");
    expectRegressionReport(report, "LLM timeout on uncertain contract is user decline with no cache");
  });

  it("runs LLM contract reporting for deterministic unknown-contract boundary declines", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.7,
      contractRiskScore: 83,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown contract boundary has no clean service identity."],
      citedEvidenceIds: ["tx-contract-clean"],
      falsePositiveNotes: ["Could be a legitimate private router, but no service evidence was available."]
    };
    let capturedCaseFiles: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            providerTags: [],
            publicTags: [],
            methodMap: {},
            rawPayload: {},
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles = caseFiles;
        return [llmVerdict];
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(83);
    expect(report.contractLlmVerdicts).toEqual([llmVerdict]);
    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainReviewFindings: [],
      originPaths: [
        expect.objectContaining({
          rootSourceAddress: wrapperContract,
          stoppedReason: "unlabeled_service_boundary"
        })
      ],
      serviceClassification: {
        category: "unknown_contract"
      }
    });
  });

  it("uses the latest 60 transfers for sparse windows so older exchange origins are still traced", async () => {
    const calls: Array<{ address: string; mode: "window" | "latest"; limit?: number }> = [];
    const sender = "TSender11111111111111111111111111111";
    const sourceWindowEdges = [
      edge("tx-sender-subject", sender, subject, "1123000000", "2026-05-22T10:00:00.000Z")
    ];
    const senderLatestEdges = [
      edge("tx-whitebit-sender", binance, sender, "1123000000", "2025-11-01T10:00:00.000Z")
    ];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1123000000",
      fetchEdgesForAddress: async (address) => {
        calls.push({ address, mode: "window" });
        return address === subject ? sourceWindowEdges : [];
      },
      fetchLatestEdgesForAddress: async (address, limit) => {
        calls.push({ address, mode: "latest", limit });
        if (address === subject) return sourceWindowEdges;
        if (address === sender) return senderLatestEdges;
        return [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "WhiteBIT");
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

    expect(calls).toEqual(expect.arrayContaining([
      { address: subject, mode: "latest", limit: 60 },
      { address: sender, mode: "latest", limit: 60 }
    ]));
    expect(report.originPaths[0]).toMatchObject({
      balanceTransferTxHash: "tx-sender-subject",
      pathAddresses: [binance, sender, subject],
      txHashes: ["tx-whitebit-sender", "tx-sender-subject"],
      verdict: "DECLINE",
      riskScoreContribution: 55
    });
    expect(report.decisionReasons[0]).toContain("WhiteBIT exposure (100% of current balance)");
    expect(report.decisionReasons.join(" ")).toContain("WhiteBIT");
    expect(report.decisionReasons.join(" ")).not.toMatch(/direct scam proof|exact scam|approval-drain|blacklist/i);
    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.internalDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exchange_policy_decline");
    expect(report.riskScore).toBe(55);
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

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(65);
    expect(report.coverage.partial).toBe(true);
    expect(report.decisionReasons).toEqual(["Clean source could not be proven; exchange policy declines this wallet by safe default. Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });

  it("does not treat zero current balance as medium risk in generic wallet profile context", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "0",
      fetchEdgesForAddress: async () => [],
      fetchLatestEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      windowStart: new Date("2026-04-29T00:00:00.000Z"),
      windowEnd: new Date("2026-05-29T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40,
      mode: "wallet_profile"
    });

    expect(report.currentUsdtBalanceRaw).toBe("0");
    expect(report.coverage.coverageRatio).toBe(0);
    expect(report.decision).toBe("ACCEPTABLE");
    expect(report.userDecision).toBe("ACCEPTABLE");
    expect(report.proofLevel).toBe("insufficient_coverage");
    expect(report.assessment.reasons.join(" ")).toContain("Current USDT balance is zero; balance-origin mode is not applicable for this wallet profile check.");
    expect(report.assessment.reasons.join(" ")).not.toContain("Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds.");
    expect(report.riskScore).toBeLessThan(45);
  });
});
