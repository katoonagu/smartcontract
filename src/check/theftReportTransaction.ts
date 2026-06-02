import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { TronClient } from "../tron/tronClient";

export type TheftReportTransfer = {
  txHash: string;
  sender: string;
  receiver: string;
  amountRaw: string;
  amountUsdt: string;
};

type TransactionInfoTransfer = {
  from_address?: unknown;
  to_address?: unknown;
  amount?: unknown;
  amount_str?: unknown;
  quant?: unknown;
  contract_address?: unknown;
  contractAddress?: unknown;
  confirmed?: unknown;
  revert?: unknown;
  contractRet?: unknown;
  finalResult?: unknown;
  result?: unknown;
  contract_ret?: unknown;
  status?: unknown;
  tokenInfo?: {
    tokenId?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOfficialUsdtTransfer(transfer: TransactionInfoTransfer): boolean {
  return (
    transfer.contract_address === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.contractAddress === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.tokenInfo?.tokenId === TRON_USDT_CONTRACT_ADDRESS
  );
}

function isSuccessResult(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (value === true) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "success";
}

function isSuccessStatus(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (value === true || value === 0) return true;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return normalized === "success" || normalized === "confirmed" || normalized === "0";
}

function isSettledSuccessful(record: Record<string, unknown>): boolean {
  if (record.confirmed !== true) return false;
  if (record.revert === true) return false;

  for (const field of ["contractRet", "finalResult", "result", "contract_ret"]) {
    if (!isSuccessResult(record[field])) return false;
  }

  return isSuccessStatus(record.status);
}

export function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function transferAmountRaw(transfer: TransactionInfoTransfer): string | null {
  const raw = transfer.quant ?? transfer.amount_str ?? transfer.amount;
  return isNonEmptyString(raw) && /^\d+$/.test(raw) ? raw : null;
}

export function extractTheftReportTransferFromTransactionInfo(txHash: string, raw: unknown): TheftReportTransfer | null {
  if (!isRecord(raw) || !Array.isArray(raw.trc20TransferInfo)) return null;
  if (!isSettledSuccessful(raw)) return null;

  const transfers = raw.trc20TransferInfo.filter(isRecord) as TransactionInfoTransfer[];
  const transfer = transfers.find((item) => isOfficialUsdtTransfer(item) && isSettledSuccessful(item));
  if (!transfer) return null;

  const sender = isNonEmptyString(transfer.from_address) ? transfer.from_address : null;
  const receiver = isNonEmptyString(transfer.to_address) ? transfer.to_address : null;
  const amountRaw = transferAmountRaw(transfer);
  if (!sender || !receiver || !amountRaw) return null;

  return {
    txHash,
    sender,
    receiver,
    amountRaw,
    amountUsdt: formatRawUsdt(amountRaw)
  };
}

export async function loadTheftReportTransfer(txHash: string, tronClient: TronClient): Promise<TheftReportTransfer> {
  const raw = await tronClient.getTransaction(txHash);
  const transfer = extractTheftReportTransferFromTransactionInfo(txHash, raw);
  if (!transfer) {
    throw new Error(`Could not extract official TRON USDT transfer from transaction: ${txHash}`);
  }
  return transfer;
}
