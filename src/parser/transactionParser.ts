import type { TronTransferEvent } from "../types";

export type RawTronscanTrc20Transfer = {
  transaction_id: string;
  from_address: string;
  to_address: string;
  quant: string;
  tokenInfo?: {
    tokenAbbr?: string;
    tokenDecimal?: number;
  };
  block_ts: number;
};

function formatTokenAmount(rawAmount: string, decimals: number): string {
  const value = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${padded}`;
}

export function parseTrc20IncomingTransfer(
  raw: RawTronscanTrc20Transfer,
  watchedAddress: string
): TronTransferEvent | null {
  if (raw.to_address !== watchedAddress) return null;
  if (raw.tokenInfo?.tokenAbbr !== "USDT") return null;

  return {
    txHash: raw.transaction_id,
    token: "USDT",
    sender: raw.from_address,
    receiver: raw.to_address,
    amount: formatTokenAmount(raw.quant, raw.tokenInfo.tokenDecimal ?? 6),
    timestamp: new Date(raw.block_ts)
  };
}
