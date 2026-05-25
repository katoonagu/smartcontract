import { describe, expect, it } from "vitest";
import {
  indexTronUsdtEventWindow,
  normalizeTronUsdtApprovalEvent,
  normalizeTronUsdtTransferEvent,
  type TronContractEvent
} from "../../src/forensics/tronUsdtEventIndexer";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { IndexedTronUsdtApproval, IndexedTronUsdtTransfer } from "../../src/types";

const from = "TFrom1111111111111111111111111111111";
const to = "TTo111111111111111111111111111111111";

function event(overrides: Partial<TronContractEvent> = {}): TronContractEvent {
  return {
    transactionId: "tx-1",
    blockNumber: 100,
    blockTimestamp: new Date("2026-05-20T10:00:00.000Z"),
    eventIndex: 0,
    eventName: "Transfer",
    result: { from, to, value: "123000000" },
    contractAddress: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    callerAddress: "TCaller11111111111111111111111111111",
    method: "transferFrom",
    rawJson: {},
    ...overrides
  };
}

describe("TRON USDT event indexer", () => {
  it("normalizes Transfer events into indexed transfers", () => {
    const transfer = normalizeTronUsdtTransferEvent(event());

    expect(transfer).toMatchObject({
      txHash: "tx-1",
      blockNumber: 100,
      eventIndex: 0,
      fromAddress: from,
      toAddress: to,
      amountRaw: "123000000",
      method: "transferFrom",
      callerAddress: "TCaller11111111111111111111111111111",
      confirmed: true
    });
  });

  it("normalizes Approval events and detects unlimited approvals", () => {
    const unlimited = ((1n << 256n) - 1n).toString();
    const approval = normalizeTronUsdtApprovalEvent(event({
      eventName: "Approval",
      result: { owner: from, spender: to, value: unlimited }
    }));

    expect(approval).toMatchObject({
      ownerAddress: from,
      spenderAddress: to,
      amountRaw: unlimited,
      isUnlimited: true
    });
  });

  it("indexes transfer and approval pages idempotently through repository callbacks", async () => {
    const transfers: IndexedTronUsdtTransfer[][] = [];
    const approvals: IndexedTronUsdtApproval[][] = [];
    const cursors: unknown[] = [];
    const result = await indexTronUsdtEventWindow({
      eventSource: {
        listContractEvents: async (input) => ({
          fingerprint: null,
          events: [
            input.eventName === "Transfer"
              ? event()
              : event({ transactionId: "tx-approval", eventName: "Approval", result: { owner: from, spender: to, value: "1000000" } })
          ]
        })
      },
      upsertTransfers: async (rows) => {
        transfers.push(rows);
      },
      upsertApprovals: async (rows) => {
        approvals.push(rows);
      },
      upsertCursor: async (cursor) => {
        cursors.push(cursor);
      }
    }, {
      cursorId: "test-cursor",
      minTimestamp: new Date("2026-05-20T00:00:00.000Z"),
      maxTimestamp: new Date("2026-05-21T00:00:00.000Z"),
      maxPagesPerEventName: 1
    });

    expect(result).toMatchObject({ transferCount: 1, approvalCount: 1, pages: 2, lastBlock: 100 });
    expect(transfers[0][0].txHash).toBe("tx-1");
    expect(approvals[0][0].txHash).toBe("tx-approval");
    expect(cursors).toEqual(expect.arrayContaining([expect.objectContaining({ status: "completed" })]));
  });
});
