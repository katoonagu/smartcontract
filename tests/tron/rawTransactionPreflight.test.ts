import { TronWeb } from "tronweb";
import { describe, expect, it } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { parseRawTransactionPreflightV1 } from "../../src/tron/rawTransactionPreflight";

const CALLER = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
const RECIPIENT = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";
const SOURCE = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
const OTHER_CONTRACT = "TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj";

function addressWord(address: string): string {
  return TronWeb.address.toHex(address).slice(2).padStart(64, "0").toLowerCase();
}

function uintWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function rawTransaction(overrides: {
  type?: string;
  contractAddress?: string;
  ownerAddress?: string;
  data?: string;
  contracts?: unknown[];
  contractRet?: string;
  ret?: unknown;
} = {}): Record<string, unknown> {
  const contract = {
    type: overrides.type ?? "TriggerSmartContract",
    parameter: {
      type_url: "type.googleapis.com/protocol.TriggerSmartContract",
      value: {
        owner_address: TronWeb.address.toHex(overrides.ownerAddress ?? CALLER),
        contract_address: TronWeb.address.toHex(overrides.contractAddress ?? TRON_USDT_CONTRACT_ADDRESS),
        data: overrides.data ?? `a9059cbb${addressWord(RECIPIENT)}${uintWord(12_345_678n)}`
      }
    }
  };
  return {
    txID: "a".repeat(64),
    raw_data: { contract: overrides.contracts ?? [contract] },
    ret: overrides.ret ?? [{ contractRet: overrides.contractRet ?? "SUCCESS" }]
  };
}

describe("parseRawTransactionPreflightV1", () => {
  it("strictly decodes one successful official-USDT transfer", () => {
    expect(parseRawTransactionPreflightV1(rawTransaction())).toEqual({
      status: "parsed",
      contractType: "TriggerSmartContract",
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      selector: "a9059cbb",
      callerAddress: CALLER,
      recipientAddress: RECIPIENT,
      amountRaw: "12345678",
      successful: true,
      rawContractCount: 1
    });
  });

  it("decodes transferFrom recipient and uint256 amount", () => {
    const data = `23b872dd${addressWord(SOURCE)}${addressWord(RECIPIENT)}${uintWord(99n)}`;
    expect(parseRawTransactionPreflightV1(rawTransaction({ data }))).toMatchObject({
      status: "parsed",
      selector: "23b872dd",
      recipientAddress: RECIPIENT,
      amountRaw: "99"
    });
  });

  it.each([
    ["permit", `d505accf${addressWord(SOURCE)}${addressWord(RECIPIENT)}${uintWord(7n)}${uintWord(8n)}${uintWord(27n)}${uintWord(1n)}${uintWord(2n)}`],
    ["Verify20", `5082dd12${addressWord(TRON_USDT_CONTRACT_ADDRESS)}${addressWord(SOURCE)}${addressWord(RECIPIENT)}${uintWord(7n)}`],
    ["unknown selector", `deadbeef${uintWord(1n)}`]
  ])("preserves %s as a non-plain selector without inventing transfer fields", (_label, data) => {
    expect(parseRawTransactionPreflightV1(rawTransaction({ data }))).toMatchObject({
      status: "parsed",
      selector: data.slice(0, 8),
      recipientAddress: null,
      amountRaw: null
    });
  });

  it("preserves a non-USDT contract address for policy comparison", () => {
    expect(parseRawTransactionPreflightV1(rawTransaction({ contractAddress: OTHER_CONTRACT }))).toMatchObject({
      status: "parsed",
      contractAddress: OTHER_CONTRACT,
      selector: "a9059cbb"
    });
  });

  it.each(["FAILED", "REVERT", "OUT_OF_ENERGY"])("keeps %s as parsed unsuccessful evidence", (contractRet) => {
    expect(parseRawTransactionPreflightV1(rawTransaction({ contractRet }))).toMatchObject({
      status: "parsed",
      successful: false
    });
  });

  it("rejects multiple raw contracts explicitly", () => {
    const one = rawTransaction();
    const contract = (one.raw_data as { contract: unknown[] }).contract[0];
    expect(parseRawTransactionPreflightV1(rawTransaction({ contracts: [contract, contract] }))).toEqual({
      status: "ambiguous",
      reason: "raw_contract_count_2"
    });
  });

  it.each([
    ["unsupported contract", rawTransaction({ type: "TransferContract" }), "unsupported_contract_type"],
    ["malformed calldata", rawTransaction({ data: "a9059cbz" }), "malformed_calldata"],
    ["short transfer calldata", rawTransaction({ data: `a9059cbb${addressWord(RECIPIENT)}` }), "short_transfer_calldata"],
    ["missing caller", (() => {
      const value = rawTransaction();
      delete (((value.raw_data as any).contract[0].parameter.value as any).owner_address);
      return value;
    })(), "missing_caller_address"],
    ["missing contract", (() => {
      const value = rawTransaction();
      delete (((value.raw_data as any).contract[0].parameter.value as any).contract_address);
      return value;
    })(), "missing_contract_address"],
    ["missing result", rawTransaction({ ret: [] }), "missing_contract_result"]
  ])("returns ambiguity for %s", (_label, raw, reason) => {
    expect(parseRawTransactionPreflightV1(raw)).toEqual({ status: "ambiguous", reason });
  });

  it("returns ambiguity instead of throwing for a valid-looking transaction with insufficient fields", () => {
    expect(parseRawTransactionPreflightV1({ raw_data: { contract: [{}] }, ret: [{ contractRet: "SUCCESS" }] })).toEqual({
      status: "ambiguous",
      reason: "missing_contract_type"
    });
  });
});
