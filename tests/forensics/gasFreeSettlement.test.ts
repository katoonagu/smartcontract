import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS as USDT } from "../../src/parser/transactionParser";
import {
  classifyGasFreeSettlementDispositionV1,
  extractGasFreeEdgeContext,
  extractGasFreeSettlement,
  gasFreeMovementForEdge,
  isGasFreeServiceFeeEdge
} from "../../src/forensics/gasFreeSettlement";

const CONTROLLER = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const ACCOUNT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const USER = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const RECEIVER = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const TLNT = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";
const OTHER_FEE = "TFNX7TKYCm1kUYDECjkrogBwYZvt69XQNy";

const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: string) => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function permitData(value: bigint, maxFee: bigint): string {
  const signature = "11".repeat(65);
  return [
    "6f21b898",
    addressWord(USDT),
    addressWord(USER),
    addressWord(RECEIVER),
    uintWord(value),
    uintWord(maxFee),
    uintWord(1_800_000_000n),
    uintWord(1n),
    uintWord(9n),
    uintWord(0x120n),
    uintWord(65n),
    signature.padEnd(192, "0")
  ].join("");
}

function row(toAddress: string, amountRaw: string) {
  return {
    from_address: ACCOUNT,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: USDT,
    status: 0,
    tokenInfo: { tokenId: USDT, tokenAbbr: "USDT", tokenType: "trc20" }
  };
}

function transaction(rows: unknown[], value = 97_000_000n, maxFee = 3_000_000n) {
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: { contract_address: CONTROLLER, data: permitData(value, maxFee) },
    trc20TransferInfo: rows,
    tokenTransferInfo: rows.map((item) => ({ ...(item as Record<string, unknown>) }))
  };
}

function replaceWord(data: string, index: number, word: string): string {
  const start = 8 + index * 64;
  return `${data.slice(0, start)}${word}${data.slice(start + 64)}`;
}

function transactionWithData(data: string) {
  return {
    ...transaction([row(RECEIVER, "97000000")]),
    contractData: { contract_address: CONTROLLER, data }
  };
}

describe("extractGasFreeSettlement", () => {
  it("extracts dynamic principal plus multiple fee recipients without alias double-counting", () => {
    const result = extractGasFreeSettlement(transaction([
      row(TLNT, "1000000"),
      row(RECEIVER, "97000000"),
      row(OTHER_FEE, "2000000")
    ]));
    expect(result).toMatchObject({
      protocol: "tron_gasfree",
      controllerVersion: "permit_transfer_v1",
      controllerAddress: CONTROLLER,
      accountAddress: ACCOUNT,
      userAddress: USER,
      receiverAddress: RECEIVER,
      principalAmountRaw: "97000000",
      maxFeeRaw: "3000000",
      serviceFeeAmountRaw: "3000000",
      grossDebitAmountRaw: "100000000",
      evidenceStrength: "exact"
    });
    expect(result?.evidenceCodes).toEqual([
      "gasfree_controller_registered",
      "gasfree_permit_transfer",
      "gasfree_value_and_fee_balanced"
    ]);
    expect(result?.movements.filter((item) => item.role === "service_fee")).toEqual([
      expect.objectContaining({ toAddress: TLNT, amountRaw: "1000000" }),
      expect.objectContaining({ toAddress: OTHER_FEE, amountRaw: "2000000" })
    ]);
  });

  it("accepts a changed collector, a 1.5 USDT fee, and zero fee", () => {
    expect(extractGasFreeSettlement(transaction([row(RECEIVER, "97000000"), row(OTHER_FEE, "1500000")], 97_000_000n, 1_500_000n))?.serviceFeeAmountRaw).toBe("1500000");
    expect(extractGasFreeSettlement(transaction([row(RECEIVER, "97000000")], 97_000_000n, 0n))?.serviceFeeAmountRaw).toBe("0");
  });

  it("uses only the first non-empty authoritative transfer alias", () => {
    const input = {
      ...transaction([row(RECEIVER, "97000000"), row(OTHER_FEE, "1500000")], 97_000_000n, 1_500_000n),
      tokenTransferInfo: [row(RECEIVER, "1")]
    };
    expect(extractGasFreeSettlement(input)).toMatchObject({
      principalAmountRaw: "97000000",
      serviceFeeAmountRaw: "1500000"
    });
  });

  it.each([
    ["non-record entry", [row(RECEIVER, "97000000"), null]],
    ["empty record", [row(RECEIVER, "97000000"), {}]],
    ["tokenless transfer-looking row", [
      row(RECEIVER, "97000000"),
      { from_address: ACCOUNT, to_address: OTHER_FEE, amount_str: "3000000" }
    ]],
    ["conflicting token aliases", [{
      ...row(RECEIVER, "97000000"),
      tokenInfo: { tokenId: ACCOUNT, tokenAbbr: "USDT", tokenType: "trc20" }
    }]]
  ])("rejects malformed authoritative rows: %s", (_name, rows) => {
    expect(extractGasFreeSettlement(transaction(rows))).toBeNull();
  });

  it.each([
    ["conflicting top-level token_id", { ...row(RECEIVER, "97000000"), token_id: ACCOUNT }],
    ["conflicting token_info.tokenId", { ...row(RECEIVER, "97000000"), token_info: { tokenId: ACCOUNT } }],
    ["conflicting token_info.token_id", { ...row(RECEIVER, "97000000"), token_info: { token_id: ACCOUNT } }],
    ["malformed token_info container", { ...row(RECEIVER, "97000000"), token_info: "USDT" }]
  ])("rejects snake token identity mismatch: %s", (_name, transfer) => {
    expect(extractGasFreeSettlement(transaction([transfer]))).toBeNull();
  });

  it("accepts a snake-only top-level token_id", () => {
    const { contract_address: _contractAddress, tokenInfo: _tokenInfo, ...transfer } = row(RECEIVER, "97000000");
    expect(extractGasFreeSettlement(transaction([{ ...transfer, token_id: USDT }]))).not.toBeNull();
  });

  it("accepts a snake-only nested token_info.token_id", () => {
    const { contract_address: _contractAddress, tokenInfo: _tokenInfo, ...transfer } = row(RECEIVER, "97000000");
    expect(extractGasFreeSettlement(transaction([{
      ...transfer,
      token_info: { token_id: USDT }
    }]))).not.toBeNull();
  });

  it("ignores an explicit valid non-USDT row whose token aliases agree", () => {
    const nonUsdtRow = {
      from_address: ACCOUNT,
      to_address: OTHER_FEE,
      amount_str: "3000000",
      contract_address: ACCOUNT,
      contractAddress: TronWeb.address.toHex(ACCOUNT),
      tokenId: ACCOUNT,
      tokenInfo: {
        tokenId: ACCOUNT,
        token_id: `0x${TronWeb.address.toHex(ACCOUNT).slice(2)}`
      }
    };
    expect(extractGasFreeSettlement(transaction([
      row(RECEIVER, "97000000"),
      nonUsdtRow
    ]))).toMatchObject({ principalAmountRaw: "97000000", serviceFeeAmountRaw: "0" });
  });

  it.each([
    ["15000000", "2000000"],
    ["42000000", "1000000"]
  ])("accepts later value %s with dynamic fee %s", (valueRaw, feeRaw) => {
    const result = extractGasFreeSettlement(transaction(
      [row(RECEIVER, valueRaw), row(OTHER_FEE, feeRaw)],
      BigInt(valueRaw),
      BigInt(feeRaw)
    ));
    expect(result).toMatchObject({ principalAmountRaw: valueRaw, serviceFeeAmountRaw: feeRaw });
  });

  it("rejects duplicate indistinguishable canonical USDT movements", () => {
    const fee = row(OTHER_FEE, "1000000");
    expect(extractGasFreeSettlement(transaction([
      row(RECEIVER, "97000000"),
      fee,
      { ...fee }
    ]))).toBeNull();
  });

  it("rejects equivalent decimal spellings that bypass duplicate movement identity", () => {
    expect(extractGasFreeSettlement(transaction([
      row(RECEIVER, "97000000"),
      row(OTHER_FEE, "1000000"),
      row(OTHER_FEE, "01000000")
    ]))).toBeNull();
  });

  it("rejects a single leading-zero movement amount", () => {
    expect(extractGasFreeSettlement(transaction([
      row(RECEIVER, "097000000")
    ]))).toBeNull();
  });

  it.each([true, "SUCCESS"])("accepts successful result form %s as the required result evidence", (result) => {
    const input = { ...transaction([row(RECEIVER, "97000000")]) } as Record<string, unknown>;
    delete input.contractRet;
    input.result = result;
    expect(extractGasFreeSettlement(input)).not.toBeNull();
  });

  it.each([
    { label: "boolean true", status: true },
    { label: "number zero", status: 0 },
    { label: "string zero", status: "0" },
    { label: "SUCCESS", status: "SUCCESS" },
    { label: "CONFIRMED", status: "CONFIRMED" }
  ])("accepts successful status form $label", ({ status }) => {
    expect(extractGasFreeSettlement({
      ...transaction([row(RECEIVER, "97000000")]),
      status
    })).not.toBeNull();
  });

  it("allows a missing revert field", () => {
    const input = { ...transaction([row(RECEIVER, "97000000")]) } as Record<string, unknown>;
    delete input.revert;
    expect(extractGasFreeSettlement(input)).not.toBeNull();
  });

  it.each([
    ["fee exceeds maxFee", transaction([row(RECEIVER, "97000000"), row(TLNT, "3000001")], 97_000_000n, 3_000_000n)],
    ["principal does not equal value", transaction([row(RECEIVER, "96000000"), row(TLNT, "1000000")])],
    ["receiver does not match calldata", transaction([row(OTHER_FEE, "97000000"), row(TLNT, "1000000")])],
    ["unregistered tag-only controller", { ...transaction([row(RECEIVER, "97000000")]), addressTag: "GasFree Endpoint", contractData: { contract_address: ACCOUNT, data: permitData(97_000_000n, 0n) } }],
    ["case-mutated Base58 controller", { ...transaction([row(RECEIVER, "97000000")]), contractData: { contract_address: CONTROLLER.toLowerCase(), data: permitData(97_000_000n, 0n) } }],
    ["malformed calldata", { ...transaction([row(RECEIVER, "97000000")]), contractData: { contract_address: CONTROLLER, data: "0x6f21b898zz" } }],
    ["unconfirmed transaction", { ...transaction([row(RECEIVER, "97000000")]), confirmed: false }],
    ["failed transaction", { ...transaction([row(RECEIVER, "97000000")]), contractRet: "REVERT" }],
    ["conflicting success aliases", { ...transaction([row(RECEIVER, "97000000")]), finalResult: "REVERT" }],
    ["failed result alias", { ...transaction([row(RECEIVER, "97000000")]), result: "FAILED" }],
    ["failed status", { ...transaction([row(RECEIVER, "97000000")]), status: "FAILED" }],
    ["malformed revert", { ...transaction([row(RECEIVER, "97000000")]), revert: "false" }]
  ])("rejects %s", (_name, input) => {
    expect(extractGasFreeSettlement(input)).toBeNull();
  });

  it.each((() => {
    const data = permitData(97_000_000n, 3_000_000n);
    return [
      ["non-zero token address padding", replaceWord(data, 0, `01${data.slice(8 + 2, 8 + 64)}`)],
      ["non-zero user address padding", replaceWord(data, 1, `01${data.slice(8 + 64 + 2, 8 + 64 * 2)}`)],
      ["non-zero receiver address padding", replaceWord(data, 2, `01${data.slice(8 + 64 * 2 + 2, 8 + 64 * 3)}`)],
      ["five-word calldata prefix", data.slice(0, 8 + 64 * 5)],
      ["missing dynamic tail", data.slice(0, 8 + 64 * 9)],
      ["truncated dynamic tail", data.slice(0, -2)],
      ["stray trailing byte", `${data}00`],
      ["stray trailing word", `${data}${"00".repeat(32)}`],
      ["bad signature offset", replaceWord(data, 8, uintWord(0x100n))],
      ["bad signature length", replaceWord(data, 9, uintWord(64n))],
      ["non-zero signature padding", `${data.slice(0, -2)}01`]
    ] as const;
  })())("rejects canonical ABI mismatch: %s", (_name, data) => {
    expect(extractGasFreeSettlement(transactionWithData(data))).toBeNull();
  });

  it("matches exact movements and composes edge context", () => {
    const input = transaction([row(RECEIVER, "97000000"), row(OTHER_FEE, "1500000")], 97_000_000n, 1_500_000n);
    const settlement = extractGasFreeSettlement(input);
    expect(settlement).not.toBeNull();
    expect(gasFreeMovementForEdge(settlement!, {
      fromAddress: TronWeb.address.toHex(ACCOUNT),
      toAddress: OTHER_FEE,
      amountRaw: "1500000"
    })).toMatchObject({ role: "service_fee", amountRaw: "1500000" });
    expect(gasFreeMovementForEdge(settlement!, {
      fromAddress: ACCOUNT,
      toAddress: OTHER_FEE,
      amountRaw: "01500000"
    })).toBeNull();
    expect(extractGasFreeEdgeContext(input, {
      fromAddress: ACCOUNT,
      toAddress: RECEIVER,
      amountRaw: "97000000"
    })).toMatchObject({
      settlement: { protocol: "tron_gasfree" },
      movement: { role: "principal" }
    });
  });

  it("does not guess when duplicate settlement movements match one edge", () => {
    const settlement = extractGasFreeSettlement(transaction([
      row(RECEIVER, "97000000"),
      row(OTHER_FEE, "1000000")
    ]));
    expect(settlement).not.toBeNull();

    for (const role of ["principal", "service_fee"] as const) {
      const movement = settlement!.movements.find((item) => item.role === role)!;
      expect(gasFreeMovementForEdge({
        ...settlement!,
        movements: [...settlement!.movements, { ...movement }]
      }, {
        fromAddress: movement.fromAddress,
        toAddress: movement.toAddress,
        amountRaw: movement.amountRaw
      })).toBeNull();
    }
  });

  it("identifies only GasFree service-fee edges", () => {
    expect(isGasFreeServiceFeeEdge({ economicProtocol: "tron_gasfree", economicRole: "service_fee" })).toBe(true);
    expect(isGasFreeServiceFeeEdge({ economicProtocol: "tron_gasfree", economicRole: "principal" })).toBe(false);
    expect(isGasFreeServiceFeeEdge({})).toBe(false);
  });
});

describe("classifyGasFreeSettlementDispositionV1", () => {
  it("preserves an exact registered GasFree settlement", () => {
    expect(classifyGasFreeSettlementDispositionV1(transaction([
      row(RECEIVER, "97000000"),
      row(OTHER_FEE, "3000000")
    ]))).toMatchObject({
      kind: "exact_settlement",
      settlement: { principalAmountRaw: "97000000", serviceFeeAmountRaw: "3000000" }
    });
  });

  it("proves non-GasFree only from a complete successful payload with an unregistered controller or selector", () => {
    expect(classifyGasFreeSettlementDispositionV1({
      ...transaction([row(RECEIVER, "97000000")]),
      contractData: { contract_address: ACCOUNT, data: permitData(97_000_000n, 0n) }
    })).toEqual({ kind: "not_gasfree_v1", reason: "controller_not_registered" });

    const differentSelector = `a9059cbb${permitData(97_000_000n, 0n).slice(8)}`;
    expect(classifyGasFreeSettlementDispositionV1({
      ...transaction([row(RECEIVER, "97000000")]),
      contractData: { contract_address: CONTROLLER, data: differentSelector }
    })).toEqual({ kind: "not_gasfree_v1", reason: "selector_not_registered" });
  });

  it("keeps malformed or incomplete registered-controller payloads unresolved", () => {
    expect(classifyGasFreeSettlementDispositionV1({
      ...transaction([row(RECEIVER, "97000000")]),
      contractData: { contract_address: CONTROLLER, data: "6f21b898" }
    })).toEqual({ kind: "unresolved", reason: "registered_payload_ambiguous" });
    expect(classifyGasFreeSettlementDispositionV1({ confirmed: true }))
      .toEqual({ kind: "unresolved", reason: "payload_invalid" });
  });
});
