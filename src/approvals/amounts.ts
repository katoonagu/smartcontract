const USDT_DECIMALS = 6;

function parseUnsignedInteger(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function formatInteger(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUsdtRawAmount(rawAmount: string): string {
  const parsed = parseUnsignedInteger(rawAmount);
  if (parsed === null) return "unknown USDT";
  const divisor = 10n ** BigInt(USDT_DECIMALS);
  const whole = parsed / divisor;
  const fraction = parsed % divisor;
  if (fraction === 0n) return `${formatInteger(whole)} USDT`;
  const fractionText = fraction.toString().padStart(USDT_DECIMALS, "0").replace(/0+$/, "");
  return `${formatInteger(whole)}.${fractionText} USDT`;
}

export function formatApprovalAllowance(input: { amountRaw: string; isUnlimited: boolean }): string {
  return input.isUnlimited ? "unlimited" : formatUsdtRawAmount(input.amountRaw);
}

export function parseUsdtRawAmount(rawAmount: string): bigint | null {
  return parseUnsignedInteger(rawAmount);
}
