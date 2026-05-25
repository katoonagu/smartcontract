import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type { IndexedTronUsdtTransfer, ForensicRouteEdge } from "../types";
import type { RouteSearchTronClient } from "./routeSearch";

export type IndexedTronUsdtTransferLookup = (
  address: string,
  options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
) => Promise<IndexedTronUsdtTransfer[]>;

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function indexedTransferToRouteEdge(transfer: IndexedTronUsdtTransfer): ForensicRouteEdge {
  return {
    id: stableId([
      "indexed_tron_usdt_edge",
      transfer.txHash,
      transfer.eventIndex,
      transfer.fromAddress,
      transfer.toAddress,
      transfer.amountRaw
    ]),
    fromAddress: transfer.fromAddress,
    toAddress: transfer.toAddress,
    txHash: transfer.txHash,
    amountRaw: transfer.amountRaw,
    timestamp: transfer.blockTimestamp,
    method: transfer.method,
    edgeType: transfer.method === "transferFrom" ? "transfer_from" : "normal_transfer"
  };
}

export function indexedTransferToRawTronscanTransfer(transfer: IndexedTronUsdtTransfer): RawTronscanTrc20Transfer {
  return {
    transaction_id: transfer.txHash,
    from_address: transfer.fromAddress,
    to_address: transfer.toAddress,
    quant: transfer.amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: transfer.confirmed,
    contractRet: transfer.contractRet ?? "SUCCESS",
    tokenInfo: {
      tokenId: TRON_USDT_CONTRACT_ADDRESS,
      tokenAbbr: "USDT",
      tokenDecimal: 6,
      tokenType: "trc20"
    },
    trigger_info: {
      methodName: transfer.method,
      callerAddress: transfer.callerAddress
    },
    block_ts: transfer.blockTimestamp.getTime()
  };
}

export function createIndexedTronUsdtTransferClient(
  lookup: IndexedTronUsdtTransferLookup
): RouteSearchTronClient {
  return {
    listRelatedTrc20Transfers: async (address, options) => {
      const transfers = await lookup(address, options);
      return transfers.map(indexedTransferToRawTronscanTransfer);
    }
  };
}
