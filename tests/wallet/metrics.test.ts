import { describe, expect, it } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel } from "../../src/types";
import {
  calculateFeeSummary,
  calculateUsdtTransferFlow,
  calculateWalletSafetyReport,
  parseAccountMetrics
} from "../../src/wallet/metrics";

const walletAddress = "TWallet1111111111111111111111111111111";

describe("wallet dashboard metrics", () => {
  it("parses balances, wallet age, transaction counts, and TRX price from account data", () => {
    const metrics = parseAccountMetrics(
      {
        balance: "1234567890",
        date_created: "1778457600000",
        transactions_in: "7",
        transactions_out: 5,
        totalTransactionCount: "12",
        trc20token_balances: [
          {
            tokenId: "TFakeUsdt1111111111111111111111111111",
            balance: "999999999999",
            tokenPriceInTrx: "1"
          },
          {
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            balance: "987654321",
            tokenPriceInTrx: "4"
          }
        ]
      },
      { now: new Date("2026-05-21T00:00:00.000Z") }
    );

    expect(metrics.trxBalanceSun).toBe(1234567890n);
    expect(metrics.trxBalanceTrx).toBe("1234.56789");
    expect(metrics.usdtBalanceMicro).toBe(987654321n);
    expect(metrics.usdtBalanceUsdt).toBe("987.654321");
    expect(metrics.walletCreatedAt?.toISOString()).toBe("2026-05-11T00:00:00.000Z");
    expect(metrics.walletAgeDays).toBe(10);
    expect(metrics.incomingTxCount).toBe(7);
    expect(metrics.outgoingTxCount).toBe(5);
    expect(metrics.totalTxCount).toBe(12);
    expect(metrics.trxUsd).toBe(0.25);
  });

  it("accepts only official USDT balances and safe non-negative transaction counts", () => {
    const metrics = parseAccountMetrics({
      balance: 0,
      date_created: 1778457600000,
      transactions_in: "-1",
      transactions_out: `${Number.MAX_SAFE_INTEGER + 1}`,
      tokenBalances: [
        {
          tokenInfo: { tokenId: "TFakeUsdt1111111111111111111111111111" },
          quantity: "5000000"
        }
      ]
    });

    expect(metrics.usdtBalanceMicro).toBe(0n);
    expect(metrics.incomingTxCount).toBeNull();
    expect(metrics.outgoingTxCount).toBeNull();
    expect(metrics.totalTxCount).toBeNull();
  });

  it("calculates 30d flow from official confirmed successful USDT transfers with exact address matches", () => {
    const flow = calculateUsdtTransferFlow(walletAddress, [
      {
        transaction_id: "in1",
        from_address: "TSender111111111111111111111111111111",
        to_address: walletAddress,
        quant: "12500000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: 1778457600000
      },
      {
        transaction_id: "out1",
        from_address: walletAddress,
        to_address: "TReceiver11111111111111111111111111111",
        quant: "2250000",
        tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        confirmed: true,
        finalResult: "SUCCESS",
        status: "0",
        block_ts: 1778457700000
      },
      {
        transaction_id: "fake",
        from_address: "TSender111111111111111111111111111111",
        to_address: walletAddress,
        quant: "1000000000",
        contract_address: "TFakeUsdt1111111111111111111111111111",
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: 1778457800000
      },
      {
        transaction_id: "case-mismatch",
        from_address: walletAddress.toLowerCase(),
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS",
        block_ts: 1778457900000
      },
      {
        transaction_id: "failed",
        from_address: "TSender111111111111111111111111111111",
        to_address: walletAddress,
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "FAILED",
        block_ts: 1778458000000
      }
    ]);

    expect(flow.inMicro).toBe(12500000n);
    expect(flow.outMicro).toBe(2250000n);
    expect(flow.volumeMicro).toBe(14750000n);
    expect(flow.inUsdt).toBe("12.5");
    expect(flow.outUsdt).toBe("2.25");
    expect(flow.transferCount).toBe(2);
  });

  it("sums owner-only successful transaction fees", () => {
    const fees = calculateFeeSummary(
      walletAddress,
      [
        {
          ownerAddress: walletAddress,
          contractRet: "SUCCESS",
          cost: { fee: "2500000" }
        },
        {
          ownerAddress: walletAddress,
          contractRet: "FAILED",
          cost: { fee: "9000000" }
        },
        {
          ownerAddress: "TOther1111111111111111111111111111111",
          contractRet: "SUCCESS",
          cost: { fee: "7000000" }
        },
        {
          ownerAddress: walletAddress,
          revert: true,
          cost: { fee: "1000000" }
        }
      ],
      { trxUsd: 0.25 }
    );

    expect(fees.feeSun).toBe(2500000n);
    expect(fees.feeTrx).toBe("2.5");
    expect(fees.feeUsd).toBe("0.625");
  });

  it("builds a limited-confidence safety report from internal labels and strict activity thresholds", () => {
    const labels: AddressLabel[] = [
      {
        address: walletAddress,
        label: "mule",
        source: "service_admin",
        createdByTelegramId: "1",
        createdAt: new Date("2026-05-20T00:00:00.000Z")
      },
      {
        address: "TOther1111111111111111111111111111111",
        label: "scam",
        source: "service_admin",
        createdByTelegramId: "1",
        createdAt: new Date("2026-05-20T00:00:00.000Z")
      }
    ];

    const report = calculateWalletSafetyReport({
      address: walletAddress,
      labels,
      walletAgeDays: 6,
      thirtyDayUsdtVolumeMicro: 50000000001n
    });

    expect(report.level).toBe("HIGH");
    expect(report.score).toBe(75);
    expect(report.reasons.map((reason) => reason.code)).toEqual([
      "internal_label_mule",
      "new_wallet_high_volume",
      "very_new_wallet_active"
    ]);
    expect(report.confidence).toEqual({
      level: "limited",
      checked: ["internal labels", "wallet age", "30d activity", "incoming monitor", "USDT approvals"],
      notConnected: ["AML", "graph proximity"]
    });
    expect(report.modules).toEqual([
      { code: "internal_labels", label: "Internal labels", status: "active" },
      { code: "wallet_activity", label: "Wallet activity", status: "limited" },
      { code: "incoming_monitor", label: "Incoming monitor", status: "active" },
      { code: "aml_providers", label: "AML providers", status: "not_connected" },
      { code: "hop_graph", label: "Hop1/Hop2 graph", status: "planned" },
      { code: "behavior_patterns", label: "Behavioral patterns", status: "planned" },
      { code: "approvals_security", label: "Approvals/security", status: "limited" },
      { code: "bridge_tracing", label: "Bridge tracing", status: "planned" },
      { code: "case_forensics", label: "Case forensics", status: "planned" }
    ]);
  });

  it("does not trigger activity safety signals at exact threshold values", () => {
    const report = calculateWalletSafetyReport({
      address: walletAddress,
      labels: [],
      walletAgeDays: 6,
      thirtyDayUsdtVolumeMicro: 10000000000n
    });

    expect(report.score).toBe(0);
    expect(report.reasons).toEqual([]);
  });
});
