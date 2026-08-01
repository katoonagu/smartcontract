import type { TronTransferEvent } from "../types";

export const TRON_USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TRON_USDT_DECIMALS = 6;

export type RawTronscanTrc20Transfer = {
  transaction_id: string;
  from_address: string;
  to_address: string;
  quant: string;
  contract_address?: string;
  confirmed?: boolean;
  contractRet?: string;
  finalResult?: string;
  revert?: boolean;
  status?: number | string;
  riskTransaction?: boolean;
  fromAddressIsContract?: boolean;
  toAddressIsContract?: boolean;
  tokenInfo?: {
    tokenAbbr?: string;
    tokenDecimal?: number;
    tokenId?: string;
    tokenName?: string;
    tokenType?: string;
  };
  trigger_info?: unknown;
  block_ts: number;
};

function formatTokenAmount(rawAmount: string, decimals: number): string | null {
  if (!/^\d+$/.test(rawAmount)) return null;
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) return null;

  const value = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${padded}`;
}

function isOfficialUsdtTransfer(raw: RawTronscanTrc20Transfer): boolean {
  const contractAddress = raw.contract_address ?? raw.tokenInfo?.tokenId;
  if (contractAddress !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (raw.tokenInfo?.tokenType !== undefined) {
    if (typeof raw.tokenInfo.tokenType !== "string") return false;
    if (raw.tokenInfo.tokenType.toLowerCase() !== "trc20") return false;
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSettledSuccessfulTransfer(raw: RawTronscanTrc20Transfer): boolean {
  if (raw.confirmed !== true) return false;
  if (raw.revert === true) return false;
  if (raw.contractRet && raw.contractRet !== "SUCCESS") return false;
  if (raw.finalResult && raw.finalResult !== "SUCCESS") return false;
  if (raw.status !== undefined && raw.status !== 0 && raw.status !== "0" && raw.status !== "SUCCESS") return false;
  return true;
}

export function parseTrc20IncomingTransfer(
  raw: RawTronscanTrc20Transfer,
  watchedAddress: string
): TronTransferEvent | null {
  if (!isNonEmptyString(raw.transaction_id)) return null;
  if (!isNonEmptyString(raw.from_address)) return null;
  if (!isNonEmptyString(raw.to_address)) return null;
  if (typeof raw.block_ts !== "number" || !Number.isFinite(raw.block_ts)) return null;
  if (raw.to_address !== watchedAddress) return null;
  if (!isOfficialUsdtTransfer(raw)) return null;
  if (!isSettledSuccessfulTransfer(raw)) return null;

  const amount = formatTokenAmount(raw.quant, TRON_USDT_DECIMALS);
  if (!amount) return null;

  const timestamp = new Date(raw.block_ts);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    txHash: raw.transaction_id,
    token: "USDT",
    sender: raw.from_address,
    receiver: raw.to_address,
    amount,
    timestamp
  };
}
