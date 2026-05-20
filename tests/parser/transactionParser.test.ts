import { describe, expect, it } from "vitest";
import { parseTrc20IncomingTransfer } from "../../src/parser/transactionParser";

describe("parseTrc20IncomingTransfer", () => {
  it("parses a TRC20 USDT incoming transfer from a Tronscan-like record", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "12450000000",
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6 },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toEqual({
      txHash: "abc123",
      token: "USDT",
      sender: "TSender111111111111111111111111111111",
      receiver: "TReceiver11111111111111111111111111111",
      amount: "12450",
      timestamp: new Date(1779220000000)
    });
  });

  it("returns null for non-USDT transfers", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        tokenInfo: { tokenAbbr: "TRX", tokenDecimal: 6 },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toBeNull();
  });
});
