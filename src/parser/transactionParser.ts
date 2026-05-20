import type { TronTransferEvent } from "../types";

export const TRON_USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

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
  tokenInfo?: {
    tokenAbbr?: string;
    tokenDecimal?: number;
    tokenId?: string;
    tokenType?: string;
  };
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
  if (raw.tokenInfo?.tokenType && raw.tokenInfo.tokenType.toLowerCase() !== "trc20") return false;
  return true;
}

function isSettledSuccessfulTransfer(raw: RawTronscanTrc20Transfer): boolean {
  if (raw.confirmed === false) return false;
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
  if (raw.to_address !== watchedAddress) return null;
  if (!isOfficialUsdtTransfer(raw)) return null;
  if (!isSettledSuccessfulTransfer(raw)) return null;

  const amount = formatTokenAmount(raw.quant, raw.tokenInfo?.tokenDecimal ?? 6);
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
