import type {
  RawTronscanTrc20Transfer
} from "../../../src/parser/transactionParser";
import type { IndexedTronUsdtTransfer } from "../../../src/types";
import { TronWeb } from "tronweb";

const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function address(index: number): string {
  return TronWeb.address.fromHex(
    `41${index.toString(16).padStart(40, "0")}`
  );
}

export const DENSE_SUBJECT = address(1);
export const DENSE_BACKWARD_ROOT = address(2);
export const DENSE_BACKWARD_HUB = address(3);
export const DENSE_BACKWARD_BOUNDARY = address(4);
export const DENSE_FORWARD_ROOT = address(5);
export const DENSE_FORWARD_BOUNDARY = address(6);

function raw(input: {
  index: number;
  from: string;
  to: string;
  amountRaw: string;
  timestamp: string;
}): RawTronscanTrc20Transfer {
  return {
    transaction_id: input.index.toString(16).padStart(64, "0"),
    from_address: input.from,
    to_address: input.to,
    quant: input.amountRaw,
    block: 100 - input.index,
    block_ts: Date.parse(input.timestamp),
    confirmed: true,
    contractRet: "SUCCESS",
    contract_address: USDT
  } as RawTronscanTrc20Transfer;
}

function indexed(input: {
  index: number;
  from: string;
  to: string;
  amountRaw: string;
  timestamp: string;
}): IndexedTronUsdtTransfer {
  return {
    txHash: input.index.toString(16).padStart(64, "0"),
    blockNumber: 100 - input.index,
    blockTimestamp: new Date(input.timestamp),
    eventIndex: 0,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  };
}

export function denseTraversalFixture(width = 8): {
  readonly directEvents: readonly IndexedTronUsdtTransfer[];
  readonly histories: ReadonlyMap<
    string,
    readonly RawTronscanTrc20Transfer[]
  >;
  readonly boundaryLabels: ReadonlyMap<string, readonly string[]>;
  readonly uniqueTraversalEventCount: number;
  readonly expandedStateCount: number;
  readonly providerAddressCount: number;
} {
  const amountRaw = String(width * 100);
  const backwardLeaves = Array.from({ length: width }, (_, index) =>
    address(100 + index)
  );
  const forwardLeaves = Array.from({ length: width }, (_, index) =>
    address(200 + index)
  );
  let eventIndex = 10;
  const histories = new Map<
    string,
    readonly RawTronscanTrc20Transfer[]
  >();
  histories.set(
    DENSE_BACKWARD_ROOT,
    backwardLeaves.map((leaf) => raw({
      index: eventIndex++,
      from: leaf,
      to: DENSE_BACKWARD_ROOT,
      amountRaw: "100",
      timestamp: "2026-07-23T11:00:00.000Z"
    }))
  );
  for (const leaf of backwardLeaves) {
    histories.set(leaf, [raw({
      index: eventIndex++,
      from: DENSE_BACKWARD_HUB,
      to: leaf,
      amountRaw: "100",
      timestamp: "2026-07-23T10:00:00.000Z"
    })]);
  }
  histories.set(DENSE_BACKWARD_HUB, [raw({
    index: eventIndex++,
    from: DENSE_BACKWARD_BOUNDARY,
    to: DENSE_BACKWARD_HUB,
    amountRaw,
    timestamp: "2026-07-23T09:00:00.000Z"
  })]);

  histories.set(
    DENSE_FORWARD_ROOT,
    forwardLeaves.map((leaf) => raw({
      index: eventIndex++,
      from: DENSE_FORWARD_ROOT,
      to: leaf,
      amountRaw: "100",
      timestamp: "2026-07-23T13:00:00.000Z"
    }))
  );
  for (const leaf of forwardLeaves) {
    histories.set(leaf, [raw({
      index: eventIndex++,
      from: leaf,
      to: DENSE_FORWARD_BOUNDARY,
      amountRaw: "100",
      timestamp: "2026-07-23T14:00:00.000Z"
    })]);
  }

  return {
    directEvents: [
      indexed({
        index: 1,
        from: DENSE_BACKWARD_ROOT,
        to: DENSE_SUBJECT,
        amountRaw,
        timestamp: "2026-07-23T12:00:00.000Z"
      }),
      indexed({
        index: 2,
        from: DENSE_SUBJECT,
        to: DENSE_FORWARD_ROOT,
        amountRaw,
        timestamp: "2026-07-23T12:00:00.000Z"
      })
    ],
    histories,
    boundaryLabels: new Map([
      [DENSE_BACKWARD_BOUNDARY, ["cex", "Bybit"]],
      [DENSE_FORWARD_BOUNDARY, ["cex", "Bitget"]]
    ]),
    uniqueTraversalEventCount: width * 4 + 1,
    expandedStateCount: width * 2 + 3,
    providerAddressCount: width * 2 + 3
  };
}
