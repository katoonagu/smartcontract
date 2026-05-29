import { describe, expect, it, vi } from "vitest";
import { extractUsdtTransferSeedFromTransaction, runTransactionOriginCheck } from "../../src/forensics/transactionOriginCheck";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { WhereIsMoneyReport } from "../../src/types";

const fromAddress = "TFrom1111111111111111111111111111111";
const toAddress = "TTo111111111111111111111111111111111";

describe("runTransactionOriginCheck", () => {
  it("seeds where-is-money core from the checked inbound transfer", async () => {
    const transfer = {
      txHash: "tx-1",
      from: fromAddress,
      to: toAddress,
      amountRaw: "2500000",
      timestamp: "2026-05-22T10:00:00.000Z"
    };
    const report = { subjectAddress: toAddress } as WhereIsMoneyReport;
    const loadTransfer = vi.fn(async () => transfer);
    const runWhereCore = vi.fn(async () => report);
    const windowStart = new Date("2026-05-01T00:00:00.000Z");
    const windowEnd = new Date("2026-05-24T00:00:00.000Z");

    const result = await runTransactionOriginCheck({
      txHash: "tx-1",
      windowStart,
      windowEnd,
      loadTransfer,
      runWhereCore
    });

    expect(result).toBe(report);
    expect(loadTransfer).toHaveBeenCalledWith("tx-1");
    expect(runWhereCore).toHaveBeenCalledWith({
      mode: "transaction_check",
      subjectAddress: toAddress,
      requestedAmountRaw: "2500000",
      seedTransfers: [
        {
          txHash: "tx-1",
          fromAddress,
          toAddress,
          amountRaw: "2500000",
          timestamp: "2026-05-22T10:00:00.000Z",
          coverageShare: 1,
          selectedReason: "covers_current_balance"
        }
      ],
      windowStart,
      windowEnd
    });
  });
});

describe("extractUsdtTransferSeedFromTransaction", () => {
  it("extracts a complete official USDT transfer seed from Tronscan transaction info", () => {
    expect(extractUsdtTransferSeedFromTransaction("tx-1", {
      trc20TransferInfo: [{
        from_address: "TSender",
        to_address: "TSubject",
        quant: "1000000000",
        block_ts: Date.parse("2026-05-28T10:00:00.000Z"),
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS"
      }]
    })).toEqual({
      txHash: "tx-1",
      fromAddress: "TSender",
      toAddress: "TSubject",
      amountRaw: "1000000000",
      timestamp: "2026-05-28T10:00:00.000Z"
    });
  });

  it("supports Tronscan amount_str transfer amounts", () => {
    expect(extractUsdtTransferSeedFromTransaction("tx-amount-str", {
      timestamp: Date.parse("2026-05-29T18:00:00.000Z"),
      trc20TransferInfo: [{
        from_address: "TSender",
        to_address: "TSubject",
        amount_str: "384064001319",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        status: 0
      }]
    })).toEqual({
      txHash: "tx-amount-str",
      fromAddress: "TSender",
      toAddress: "TSubject",
      amountRaw: "384064001319",
      timestamp: "2026-05-29T18:00:00.000Z"
    });
  });
});
