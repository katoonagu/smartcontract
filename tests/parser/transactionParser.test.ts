import { describe, expect, it } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS, parseTrc20IncomingTransfer } from "../../src/parser/transactionParser";

describe("parseTrc20IncomingTransfer", () => {
  it("parses a TRC20 USDT incoming transfer from a Tronscan-like record", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "12450000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS",
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
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
        contract_address: "TFakeUsdt1111111111111111111111111111",
        tokenInfo: { tokenAbbr: "TRX", tokenDecimal: 6 },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toBeNull();
  });

  it("returns null for spoofed USDT abbreviations on the wrong contract", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        contract_address: "TFakeUsdt1111111111111111111111111111",
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: "TFakeUsdt1111111111111111111111111111", tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toBeNull();
  });

  it("returns null for failed or unconfirmed transfers", () => {
    const failed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "REVERT",
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    const unconfirmed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc124",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: false,
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(failed).toBeNull();
    expect(unconfirmed).toBeNull();
  });

  it("returns null when confirmation status is missing", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toBeNull();
  });

  it("uses fixed official USDT decimals instead of untrusted API metadata", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 0, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed?.amount).toBe("1");
  });

  it("formats fractional amounts and tiny units", () => {
    const fractional = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1234567",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    const tiny = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc124",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "1",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(fractional?.amount).toBe("1.234567");
    expect(tiny?.amount).toBe("0.000001");
  });

  it("returns null for malformed external payload amounts", () => {
    const parsed = parseTrc20IncomingTransfer(
      {
        transaction_id: "abc123",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "not-a-number",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        tokenInfo: { tokenAbbr: "USDT", tokenDecimal: 6, tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20" },
        block_ts: 1779220000000
      },
      "TReceiver11111111111111111111111111111"
    );

    expect(parsed).toBeNull();
  });
});
