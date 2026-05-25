import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { IndexedTronUsdtApproval, IndexedTronUsdtTransfer, TronUsdtTransferMethod } from "../types";
import type { TronUsdtIndexerCursorInput } from "../storage/repositories";

export type TronContractEvent = {
  transactionId: string;
  blockNumber: number;
  blockTimestamp: Date;
  eventIndex: number;
  eventName: "Transfer" | "Approval" | string;
  result: Record<string, unknown>;
  contractAddress: string;
  confirmed: boolean;
  contractRet: string | null;
  callerAddress: string | null;
  method: TronUsdtTransferMethod | null;
  rawJson: Record<string, unknown>;
};

export type TronContractEventPage = {
  events: TronContractEvent[];
  fingerprint: string | null;
};

export type TronUsdtEventSource = {
  listContractEvents(input: {
    contractAddress: string;
    eventName: "Transfer" | "Approval";
    minTimestamp: Date;
    maxTimestamp: Date;
    limit: number;
    fingerprint?: string | null;
  }): Promise<TronContractEventPage>;
};

export type TronUsdtEventIndexerDeps = {
  eventSource: TronUsdtEventSource;
  upsertTransfers(transfers: IndexedTronUsdtTransfer[]): Promise<void>;
  upsertApprovals(approvals: IndexedTronUsdtApproval[]): Promise<void>;
  upsertCursor?(cursor: TronUsdtIndexerCursorInput): Promise<unknown>;
};

export type IndexTronUsdtEventWindowInput = {
  cursorId: string;
  minTimestamp: Date;
  maxTimestamp: Date;
  limit?: number;
  maxPagesPerEventName?: number;
};

const UINT256_MAX = (1n << 256n) - 1n;

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function integerField(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function normalizeAddress(value: unknown): string | null {
  const raw = stringField(value);
  if (!raw) return null;
  if (raw.startsWith("T")) return raw;
  const withoutPrefix = raw.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{40}$/.test(withoutPrefix)) {
    return TronWeb.address.fromHex(`41${withoutPrefix}`);
  }
  if (/^41[0-9a-fA-F]{40}$/.test(withoutPrefix)) {
    return TronWeb.address.fromHex(withoutPrefix);
  }
  return null;
}

function amountField(value: unknown): string | null {
  const raw = stringField(value);
  if (raw && /^\d+$/.test(raw)) return raw;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function eventValue(result: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (result[name] !== undefined) return result[name];
  }
  return undefined;
}

export function normalizeTronUsdtTransferEvent(event: TronContractEvent): IndexedTronUsdtTransfer | null {
  if (event.contractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
  if (event.eventName !== "Transfer") return null;
  const fromAddress = normalizeAddress(eventValue(event.result, ["from", "_from", "0"]));
  const toAddress = normalizeAddress(eventValue(event.result, ["to", "_to", "1"]));
  const amountRaw = amountField(eventValue(event.result, ["value", "_value", "amount", "2"]));
  if (!fromAddress || !toAddress || amountRaw === null) return null;
  return {
    txHash: event.transactionId,
    blockNumber: event.blockNumber,
    blockTimestamp: event.blockTimestamp,
    eventIndex: event.eventIndex,
    fromAddress,
    toAddress,
    amountRaw,
    method: event.method ?? "transfer",
    callerAddress: event.callerAddress,
    contractRet: event.contractRet,
    confirmed: event.confirmed
  };
}

export function normalizeTronUsdtApprovalEvent(event: TronContractEvent): IndexedTronUsdtApproval | null {
  if (event.contractAddress !== TRON_USDT_CONTRACT_ADDRESS) return null;
  if (event.eventName !== "Approval") return null;
  const ownerAddress = normalizeAddress(eventValue(event.result, ["owner", "_owner", "0"]));
  const spenderAddress = normalizeAddress(eventValue(event.result, ["spender", "_spender", "1"]));
  const amountRaw = amountField(eventValue(event.result, ["value", "_value", "amount", "2"]));
  if (!ownerAddress || !spenderAddress || amountRaw === null) return null;
  return {
    txHash: event.transactionId,
    blockNumber: event.blockNumber,
    blockTimestamp: event.blockTimestamp,
    eventIndex: event.eventIndex,
    ownerAddress,
    spenderAddress,
    amountRaw,
    isUnlimited: BigInt(amountRaw) === UINT256_MAX
  };
}

export async function indexTronUsdtEventWindow(
  deps: TronUsdtEventIndexerDeps,
  input: IndexTronUsdtEventWindowInput
): Promise<{ transferCount: number; approvalCount: number; pages: number; lastBlock: number | null; lastTimestamp: Date | null }> {
  const limit = input.limit ?? 200;
  const maxPages = input.maxPagesPerEventName ?? 100;
  let transferCount = 0;
  let approvalCount = 0;
  let pages = 0;
  let lastBlock: number | null = null;
  let lastTimestamp: Date | null = null;

  await deps.upsertCursor?.({
    id: input.cursorId,
    status: "running",
    progressJson: {
      minTimestamp: input.minTimestamp.toISOString(),
      maxTimestamp: input.maxTimestamp.toISOString()
    }
  });

  try {
    for (const eventName of ["Transfer", "Approval"] as const) {
      let fingerprint: string | null = null;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await deps.eventSource.listContractEvents({
          contractAddress: TRON_USDT_CONTRACT_ADDRESS,
          eventName,
          minTimestamp: input.minTimestamp,
          maxTimestamp: input.maxTimestamp,
          limit,
          fingerprint
        });
        pages += 1;
        if (eventName === "Transfer") {
          const transfers = result.events
            .map(normalizeTronUsdtTransferEvent)
            .filter((transfer): transfer is IndexedTronUsdtTransfer => transfer !== null);
          await deps.upsertTransfers(transfers);
          transferCount += transfers.length;
        } else {
          const approvals = result.events
            .map(normalizeTronUsdtApprovalEvent)
            .filter((approval): approval is IndexedTronUsdtApproval => approval !== null);
          await deps.upsertApprovals(approvals);
          approvalCount += approvals.length;
        }
        for (const event of result.events) {
          if (lastBlock === null || event.blockNumber >= lastBlock) lastBlock = event.blockNumber;
          if (lastTimestamp === null || event.blockTimestamp >= lastTimestamp) lastTimestamp = event.blockTimestamp;
        }
        await deps.upsertCursor?.({
          id: input.cursorId,
          status: "running",
          lastIndexedBlock: lastBlock,
          lastIndexedTimestamp: lastTimestamp,
          lastFingerprint: result.fingerprint,
          progressJson: {
            eventName,
            pages,
            transferCount,
            approvalCount
          }
        });
        if (!result.fingerprint || result.events.length < limit) break;
        fingerprint = result.fingerprint;
      }
    }
    await deps.upsertCursor?.({
      id: input.cursorId,
      status: "completed",
      lastIndexedBlock: lastBlock,
      lastIndexedTimestamp: lastTimestamp,
      lastFingerprint: null,
      progressJson: { pages, transferCount, approvalCount }
    });
    return { transferCount, approvalCount, pages, lastBlock, lastTimestamp };
  } catch (error) {
    await deps.upsertCursor?.({
      id: input.cursorId,
      status: "failed",
      lastIndexedBlock: lastBlock,
      lastIndexedTimestamp: lastTimestamp,
      progressJson: { pages, transferCount, approvalCount },
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
