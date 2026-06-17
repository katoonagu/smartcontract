import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { BalanceFormingTransfer } from "../types";

export type TransferSeed = Omit<BalanceFormingTransfer, "coverageShare" | "selectedReason">;
export type RawTransactionOriginTransfer = {
  txHash: string;
  from: string;
  to: string;
  amountRaw: string;
  timestamp: string;
};
export type TransactionOriginTransfer = TransferSeed | RawTransactionOriginTransfer;
type TransactionOriginWhereCoreArgs = {
  mode: "transaction_check";
  subjectAddress: string;
  requestedAmountRaw: string;
  seedTransfers: BalanceFormingTransfer[];
  windowStart?: Date;
  windowEnd?: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
};

type TransactionInfoTransfer = {
  transaction_id?: unknown;
  transactionId?: unknown;
  txHash?: unknown;
  from_address?: unknown;
  fromAddress?: unknown;
  to_address?: unknown;
  toAddress?: unknown;
  quant?: unknown;
  amount_str?: unknown;
  amount?: unknown;
  amountRaw?: unknown;
  block_ts?: unknown;
  blockTimestamp?: unknown;
  timestamp?: unknown;
  contract_address?: unknown;
  contractAddress?: unknown;
  tokenInfo?: {
    tokenId?: unknown;
    tokenAbbr?: unknown;
  };
  confirmed?: unknown;
  contractRet?: unknown;
  finalResult?: unknown;
  revert?: unknown;
  status?: unknown;
};

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function amountRawField(value: unknown): string | null {
  const raw = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : stringField(value);
  return raw && /^\d+$/.test(raw) ? raw : null;
}

function timestampField(value: unknown): string | null {
  const date = typeof value === "number" && Number.isFinite(value)
    ? new Date(value)
    : typeof value === "string" && value.trim().length > 0
      ? new Date(value)
      : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function isOfficialUsdtTransfer(transfer: TransactionInfoTransfer): boolean {
  return (
    transfer.contract_address === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.contractAddress === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.tokenInfo?.tokenId === TRON_USDT_CONTRACT_ADDRESS
  );
}

function isSuccessfulTransfer(transfer: TransactionInfoTransfer): boolean {
  if (transfer.confirmed !== undefined && transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") return false;
  return true;
}

export function extractUsdtTransferSeedFromTransaction(txHash: string, raw: unknown): TransferSeed | null {
  const tx = objectField(raw);
  const transfers = Array.isArray(tx?.trc20TransferInfo) ? tx.trc20TransferInfo as TransactionInfoTransfer[] : [];
  const transfer = transfers.find((candidate) => isOfficialUsdtTransfer(candidate) && isSuccessfulTransfer(candidate));
  if (!transfer) return null;

  const fromAddress = stringField(transfer.from_address ?? transfer.fromAddress);
  const toAddress = stringField(transfer.to_address ?? transfer.toAddress);
  const amountRaw = amountRawField(transfer.quant ?? transfer.amountRaw ?? transfer.amount_str ?? transfer.amount);
  const timestamp = timestampField(transfer.block_ts ?? transfer.blockTimestamp ?? transfer.timestamp ?? tx?.block_ts ?? tx?.blockTimestamp ?? tx?.timestamp);
  if (!fromAddress || !toAddress || !amountRaw || !timestamp) return null;

  return {
    txHash: stringField(transfer.transaction_id ?? transfer.transactionId ?? transfer.txHash) ?? txHash,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp
  };
}

export async function runTransactionOriginCheck<TReport>(input: {
  txHash: string;
  windowStart?: Date;
  windowEnd?: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
  loadTransfer(txHash: string): Promise<TransactionOriginTransfer>;
  runWhereCore(args: TransactionOriginWhereCoreArgs): Promise<TReport>;
}): Promise<TReport> {
  const tx = await input.loadTransfer(input.txHash);
  const seedTransfer = normalizeTransferSeed(tx);
  return input.runWhereCore({
    mode: "transaction_check",
    subjectAddress: seedTransfer.toAddress,
    requestedAmountRaw: seedTransfer.amountRaw,
    seedTransfers: [
      {
        ...seedTransfer,
        coverageShare: 1,
        selectedReason: "covers_current_balance"
      }
    ],
    ...(input.windowStart ? { windowStart: input.windowStart } : {}),
    ...(input.windowEnd ? { windowEnd: input.windowEnd } : {}),
    ...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
    ...(input.beamWidth !== undefined ? { beamWidth: input.beamWidth } : {}),
    ...(input.maxAddressFetches !== undefined ? { maxAddressFetches: input.maxAddressFetches } : {}),
    ...(input.maxEdgesPerAddress !== undefined ? { maxEdgesPerAddress: input.maxEdgesPerAddress } : {}),
    ...(input.recentFallbackMinTransferCount !== undefined ? { recentFallbackMinTransferCount: input.recentFallbackMinTransferCount } : {}),
    ...(input.recentFallbackTransferLimit !== undefined ? { recentFallbackTransferLimit: input.recentFallbackTransferLimit } : {})
  });
}

function normalizeTransferSeed(transfer: TransactionOriginTransfer): TransferSeed {
  if ("fromAddress" in transfer && "toAddress" in transfer) return transfer;
  return {
    txHash: transfer.txHash,
    fromAddress: transfer.from,
    toAddress: transfer.to,
    amountRaw: transfer.amountRaw,
    timestamp: transfer.timestamp
  };
}
