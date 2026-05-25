import { describe, expect, it } from "vitest";
import { createIndexedTronUsdtTransferClient, indexedTransferToRouteEdge } from "../../src/forensics/localTronUsdtIndex";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { IndexedTronUsdtTransfer } from "../../src/types";

const transfer: IndexedTronUsdtTransfer = {
  txHash: "tx-1",
  blockNumber: 100,
  blockTimestamp: new Date("2026-05-20T10:00:00.000Z"),
  eventIndex: 3,
  fromAddress: "TFrom1111111111111111111111111111111",
  toAddress: "TTo111111111111111111111111111111111",
  amountRaw: "100000000",
  method: "transferFrom",
  callerAddress: "TCaller11111111111111111111111111111",
  contractRet: "SUCCESS",
  confirmed: true
};

describe("local TRON USDT index adapter", () => {
  it("maps indexed transfers to route edges with transferFrom evidence", () => {
    const edge = indexedTransferToRouteEdge(transfer);

    expect(edge).toMatchObject({
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      txHash: transfer.txHash,
      amountRaw: transfer.amountRaw,
      method: "transferFrom",
      edgeType: "transfer_from"
    });
  });

  it("exposes indexed transfers through the existing route client shape", async () => {
    const client = createIndexedTronUsdtTransferClient(async () => [transfer]);
    const rows = await client.listRelatedTrc20Transfers(transfer.fromAddress);

    expect(rows[0]).toMatchObject({
      transaction_id: "tx-1",
      contract_address: TRON_USDT_CONTRACT_ADDRESS,
      quant: "100000000",
      confirmed: true,
      contractRet: "SUCCESS"
    });
    expect((rows[0].trigger_info as Record<string, unknown>).methodName).toBe("transferFrom");
  });
});
