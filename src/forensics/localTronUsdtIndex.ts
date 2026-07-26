import { createHash } from "node:crypto";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type {
  ForensicRouteEdge,
  IndexedTronUsdtTransfer,
  LocalIndexMaterializationStatus
} from "../types";
import type { RouteSearchTronClient } from "./routeSearch";

export type IndexedTronUsdtTransferLookup = (
  address: string,
  options?: { start?: number; limit?: number; minTimestamp?: number; endTimestamp?: number }
) => Promise<IndexedTronUsdtTransfer[]>;

// ponytail: 20k bounds per-job memory; move to keyset/streamed materialization if dense windows routinely hit it.
export const DEFAULT_LOCAL_INDEX_MATERIALIZATION_MAX_ROWS = 20_000;

export type LocalIndexMaterialization<T> = {
  rows: T[];
  status: LocalIndexMaterializationStatus;
  pageReadCount: number;
  completionReason: "proof_satisfied" | "window_exhausted" | null;
  knownZero: boolean;
  error: string | null;
};

export async function materializeIndexedTransferWindow<T>(input: {
  address: string;
  minTimestamp: Date;
  maxTimestamp: Date;
  pageSize: number;
  maxRows: number;
  isSatisfied?(rows: readonly T[]): boolean;
  onPage?(state: { rowCount: number; pageReadCount: number }): Promise<void> | void;
  readPage(address: string, options: {
    minTimestamp: Date;
    maxTimestamp: Date;
    limit: number;
    offset: number;
    orderBy: "newest";
    direction: "both";
  }): Promise<T[]>;
}): Promise<LocalIndexMaterialization<T>> {
  if (!Number.isInteger(input.pageSize) || !Number.isInteger(input.maxRows) || input.pageSize < 1 || input.maxRows < 1) {
    throw new Error("pageSize and maxRows must be positive integers");
  }
  const rows: T[] = [];
  let pageReadCount = 0;
  const read = async (limit: number, offset: number): Promise<{ page: T[]; error: null } | { page: null; error: string }> => {
    let page: T[];
    try {
      page = await input.readPage(input.address, {
        minTimestamp: input.minTimestamp,
        maxTimestamp: input.maxTimestamp,
        limit,
        offset,
        orderBy: "newest",
        direction: "both"
      });
    } catch (error) {
      return { page: null, error: error instanceof Error ? error.message : String(error) };
    }
    if (!Array.isArray(page) || page.length > limit) {
      throw new Error("readPage must return an array no longer than the requested limit");
    }
    return { page, error: null };
  };
  const failed = (error: string): LocalIndexMaterialization<T> => ({
    rows,
    status: "read_failed",
    pageReadCount,
    completionReason: null,
    knownZero: false,
    error
  });

  while (rows.length < input.maxRows) {
    const limit = Math.min(input.pageSize, input.maxRows - rows.length);
    const result = await read(limit, rows.length);
    pageReadCount += 1;
    if (result.page === null) return failed(result.error);
    rows.push(...result.page);
    await input.onPage?.({ rowCount: rows.length, pageReadCount });
    if (input.isSatisfied?.(rows) === true) {
      return {
        rows,
        status: "complete",
        pageReadCount,
        completionReason: "proof_satisfied",
        knownZero: false,
        error: null
      };
    }
    if (result.page.length < limit) {
      return {
        rows,
        status: "complete",
        pageReadCount,
        completionReason: "window_exhausted",
        knownZero: rows.length === 0,
        error: null
      };
    }
  }

  const probe = await read(1, rows.length);
  pageReadCount += 1;
  if (probe.page === null) return failed(probe.error);
  return {
    rows,
    status: probe.page.length === 0 ? "complete" : "local_limit",
    pageReadCount,
    completionReason: probe.page.length === 0 ? "window_exhausted" : null,
    knownZero: false,
    error: null
  };
}

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function forensicRouteEdgeIdentity(edge: ForensicRouteEdge): string {
  if (edge.transferId) return `transfer:${edge.transferId}`;
  if (edge.eventIndex !== null && edge.eventIndex !== undefined) return `event:${edge.txHash}:${edge.eventIndex}`;
  if (edge.provider && edge.providerRowOrdinalInTx !== null && edge.providerRowOrdinalInTx !== undefined) {
    return `provider:${edge.provider}:${edge.txHash}:${edge.providerRowOrdinalInTx}`;
  }
  // ponytail: legacy rows cannot prove exactly one emitted movement; use provider event identity when available.
  return `legacy:${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`;
}

export function forensicRouteEdgeHasExactMovementIdentity(edge: ForensicRouteEdge): boolean {
  return Boolean(edge.transferId) ||
    (edge.eventIndex !== null && edge.eventIndex !== undefined) ||
    Boolean(edge.provider) && edge.providerRowOrdinalInTx !== null && edge.providerRowOrdinalInTx !== undefined;
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
    edgeType: transfer.method === "transferFrom" ? "transfer_from" : "normal_transfer",
    transferId: transfer.transferId ?? null,
    eventIndex: transfer.eventIndex,
    provider: transfer.provider ?? null,
    providerRowOrdinalInTx: transfer.providerRowOrdinalInTx ?? null,
    callerAddress: transfer.callerAddress,
    contractAddress: TRON_USDT_CONTRACT_ADDRESS,
    contractRet: transfer.contractRet,
    finalResult: transfer.finalResult ?? null,
    confirmed: transfer.confirmed,
    reverted: transfer.reverted ?? null
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
    contractRet: transfer.contractRet,
    finalResult: transfer.finalResult,
    revert: transfer.reverted,
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
    block_ts: transfer.blockTimestamp.getTime(),
    transferId: transfer.transferId,
    eventIndex: transfer.eventIndex,
    provider: transfer.provider,
    providerRowOrdinalInTx: transfer.providerRowOrdinalInTx
  } as RawTronscanTrc20Transfer;
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
