import { describe, expect, it } from "vitest";
import {
  createIndexedTronUsdtTransferClient,
  forensicRouteEdgeIdentity,
  indexedTransferToRouteEdge,
  materializeIndexedTransferWindow
} from "../../src/forensics/localTronUsdtIndex";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { IndexedTronUsdtTransfer } from "../../src/types";

const transfer: IndexedTronUsdtTransfer = {
  transferId: "tronscan:tx-1:3",
  txHash: "tx-1",
  blockNumber: 100,
  blockTimestamp: new Date("2026-05-20T10:00:00.000Z"),
  eventIndex: 3,
  provider: "tronscan",
  providerRowOrdinalInTx: 4,
  fromAddress: "TFrom1111111111111111111111111111111",
  toAddress: "TTo111111111111111111111111111111111",
  amountRaw: "100000000",
  method: "transferFrom",
  callerAddress: "TCaller11111111111111111111111111111",
  contractRet: "SUCCESS",
  finalResult: "SUCCESS",
  reverted: false,
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
      edgeType: "transfer_from",
      transferId: "tronscan:tx-1:3",
      eventIndex: 3,
      provider: "tronscan",
      providerRowOrdinalInTx: 4,
      callerAddress: "TCaller11111111111111111111111111111",
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      contractRet: "SUCCESS",
      finalResult: "SUCCESS",
      confirmed: true,
      reverted: false
    });
  });

  it("uses event identity before the legacy tuple fallback", () => {
    const indexedEdge = indexedTransferToRouteEdge(transfer);
    const liveEdge = {
      ...indexedEdge,
      transferId: undefined,
      eventIndex: undefined,
      provider: undefined,
      providerRowOrdinalInTx: undefined
    };

    expect(forensicRouteEdgeIdentity(indexedEdge)).toBe("transfer:tronscan:tx-1:3");
    expect(forensicRouteEdgeIdentity(liveEdge)).toBe("legacy:tx-1:TFrom1111111111111111111111111111111:TTo111111111111111111111111111111111:100000000");
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

describe("materializeIndexedTransferWindow", () => {
  const base = {
    address: "TMaterialize111111111111111111111111",
    minTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    maxTimestamp: new Date("2026-07-10T00:00:00.000Z"),
    pageSize: 2,
    maxRows: 5
  };

  it("pages until a short page proves local completion", async () => {
    const rows = [1, 2, 3];
    const offsets: number[] = [];
    const result = await materializeIndexedTransferWindow({
      ...base,
      readPage: async (_address, options) => {
        offsets.push(options.offset);
        return rows.slice(options.offset, options.offset + options.limit);
      }
    });

    expect(offsets).toEqual([0, 2]);
    expect(result).toMatchObject({ rows, status: "complete", knownZero: false, pageReadCount: 2 });
  });

  it("probes an exact maxRows multiple before calling it limited", async () => {
    const rows = [1, 2, 3, 4];
    const result = await materializeIndexedTransferWindow({
      ...base,
      maxRows: 4,
      readPage: async (_address, options) => rows.slice(options.offset, options.offset + options.limit)
    });

    expect(result).toMatchObject({ status: "complete", rows, pageReadCount: 3 });
  });

  it("stops at page granularity when the concrete proof is already satisfied", async () => {
    const rows = [1, 2, 3, 4, 5, 6];
    const offsets: number[] = [];
    const result = await materializeIndexedTransferWindow({
      ...base,
      readPage: async (_address, options) => {
        offsets.push(options.offset);
        return rows.slice(options.offset, options.offset + options.limit);
      },
      isSatisfied: (materialized) => materialized.includes(3)
    });

    expect(offsets).toEqual([0, 2]);
    expect(result).toMatchObject({
      rows: [1, 2, 3, 4],
      status: "complete",
      completionReason: "proof_satisfied"
    });
  });

  it("distinguishes known zero, local limit, and read failure", async () => {
    const knownZero = await materializeIndexedTransferWindow({ ...base, readPage: async () => [] });
    expect(knownZero).toMatchObject({ status: "complete", knownZero: true, rows: [] });

    const limitedRows = [1, 2, 3, 4, 5, 6];
    const limited = await materializeIndexedTransferWindow({
      ...base,
      readPage: async (_address, options) => limitedRows.slice(options.offset, options.offset + options.limit)
    });
    expect(limited).toMatchObject({ status: "local_limit", knownZero: false, rows: [1, 2, 3, 4, 5] });

    const failed = await materializeIndexedTransferWindow<number>({
      ...base,
      readPage: async () => { throw new Error("local db unavailable"); }
    });
    expect(failed).toMatchObject({ status: "read_failed", knownZero: false, error: "local db unavailable" });
  });

  it("propagates onPage errors instead of reporting a read failure", async () => {
    await expect(materializeIndexedTransferWindow({
      ...base,
      readPage: async () => [1],
      onPage: () => { throw new Error("page observer failed"); }
    })).rejects.toThrow("page observer failed");
  });

  it("propagates proof errors instead of reporting a read failure", async () => {
    await expect(materializeIndexedTransferWindow({
      ...base,
      readPage: async () => [1],
      isSatisfied: () => { throw new Error("proof failed"); }
    })).rejects.toThrow("proof failed");
  });

  it("rejects pages longer than the requested limit before materializing them", async () => {
    await expect(materializeIndexedTransferWindow({
      ...base,
      maxRows: 2,
      readPage: async () => [1, 2, 3],
      onPage: () => { throw new Error("oversized page reached onPage"); }
    })).rejects.toThrow("readPage must return an array no longer than the requested limit");
  });

  it("rejects non-array page results as contract errors", async () => {
    await expect(materializeIndexedTransferWindow<number>({
      ...base,
      readPage: async () => ({ length: 0 } as unknown as number[])
    })).rejects.toThrow("readPage must return an array no longer than the requested limit");
  });

  it.each([{ pageSize: 0, maxRows: 1 }, { pageSize: 1, maxRows: 0 }])("rejects invalid limits %#", async (limits) => {
    await expect(materializeIndexedTransferWindow({ ...base, ...limits, readPage: async () => [] }))
      .rejects.toThrow("pageSize and maxRows must be positive integers");
  });
});
