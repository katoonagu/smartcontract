import { describe, expect, it } from "vitest";
import { extractTheftReportTransferFromTransactionInfo, formatRawUsdt } from "../../src/check/theftReportTransaction";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";

function officialTransfer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from_address: "TSender111111111111111111111111111111",
    to_address: "TReceiver11111111111111111111111111111",
    quant: "123456789",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    ...overrides
  };
}

describe("theft report transaction extraction", () => {
  it("extracts sender receiver and amount from official TRON USDT transfer info", () => {
    const result = extractTheftReportTransferFromTransactionInfo("a".repeat(64), {
      confirmed: true,
      trc20TransferInfo: [
        officialTransfer()
      ]
    });

    expect(result).toEqual({
      txHash: "a".repeat(64),
      sender: "TSender111111111111111111111111111111",
      receiver: "TReceiver11111111111111111111111111111",
      amountRaw: "123456789",
      amountUsdt: "123.456789"
    });
  });

  it("prefers the official USDT transfer when several token transfers exist", () => {
    const result = extractTheftReportTransferFromTransactionInfo("b".repeat(64), {
      confirmed: true,
      trc20TransferInfo: [
        {
          from_address: "TNoise1111111111111111111111111111111",
          to_address: "TNoise2222222222222222222222222222222",
          quant: "9000000",
          contract_address: "TNotUsdt1111111111111111111111111111",
          confirmed: true,
          tokenInfo: { tokenAbbr: "USDT" }
        },
        {
          from_address: "TUsdtSender11111111111111111111111111",
          to_address: "TUsdtReceiver11111111111111111111111",
          amount_str: "5000000",
          confirmed: true,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS }
        }
      ]
    });

    expect(result?.sender).toBe("TUsdtSender11111111111111111111111111");
    expect(result?.receiver).toBe("TUsdtReceiver11111111111111111111111");
    expect(result?.amountRaw).toBe("5000000");
    expect(result?.amountUsdt).toBe("5");
  });

  it("accepts real TronScan transfer rows that omit nested confirmed field", () => {
    const txHash = "1ad9fc250d58d494bff4566e57cd6276adc0d66e03d2d1820c9dcbba712dfa2b";
    const result = extractTheftReportTransferFromTransactionInfo(txHash, {
      confirmed: true,
      contractRet: "SUCCESS",
      trc20TransferInfo: [{
        from_address: "TKaaFU4XFMjVVA4dUgLeNPgYxjh1X3NWRo",
        to_address: "TNQdfZSAvfTN6MhNYHLQBCgqE4rLVZdDAC",
        amount_str: "2094300000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        status: 0
      }]
    });

    expect(result).toEqual({
      txHash,
      sender: "TKaaFU4XFMjVVA4dUgLeNPgYxjh1X3NWRo",
      receiver: "TNQdfZSAvfTN6MhNYHLQBCgqE4rLVZdDAC",
      amountRaw: "2094300000",
      amountUsdt: "2094.3"
    });
  });

  it("rejects token abbreviation without the official contract", () => {
    expect(extractTheftReportTransferFromTransactionInfo("c".repeat(64), {
      confirmed: true,
      trc20TransferInfo: [
        {
          from_address: "TSpoofed11111111111111111111111111111",
          to_address: "TReceiver11111111111111111111111111111",
          quant: "1000000",
          confirmed: true,
          tokenInfo: { tokenAbbr: "USDT" }
        }
      ]
    })).toBeNull();
  });

  it("rejects missing confirmed transaction or explicitly unconfirmed transfer info", () => {
    expect(extractTheftReportTransferFromTransactionInfo("e".repeat(64), {
      trc20TransferInfo: [officialTransfer()]
    })).toBeNull();

    expect(extractTheftReportTransferFromTransactionInfo("f".repeat(64), {
      confirmed: true,
      trc20TransferInfo: [officialTransfer({ confirmed: false })]
    })).toBeNull();
  });

  it("rejects reverted and failed transaction result fields", () => {
    const failedPayloads = [
      { revert: true },
      { contractRet: "REVERT" },
      { finalResult: "FAILED" },
      { result: false },
      { contract_ret: "OUT_OF_ENERGY" },
      { status: "FAILED" }
    ];

    for (const payload of failedPayloads) {
      expect(extractTheftReportTransferFromTransactionInfo("e".repeat(64), {
        confirmed: true,
        ...payload,
        trc20TransferInfo: [officialTransfer()]
      })).toBeNull();
    }
  });

  it("accepts success-ish settlement fields", () => {
    const result = extractTheftReportTransferFromTransactionInfo("e".repeat(64), {
      confirmed: true,
      contractRet: "success",
      finalResult: true,
      result: "SUCCESS",
      contract_ret: "SUCCESS",
      status: "confirmed",
      trc20TransferInfo: [
        officialTransfer({
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "success",
          result: true,
          contract_ret: "success",
          status: "SUCCESS"
        })
      ]
    });

    expect(result?.amountUsdt).toBe("123.456789");
  });

  it("formats raw USDT with trimmed fractional zeros", () => {
    expect(formatRawUsdt("1000000")).toBe("1");
    expect(formatRawUsdt("1000100")).toBe("1.0001");
    expect(formatRawUsdt("0")).toBe("0");
  });
});
