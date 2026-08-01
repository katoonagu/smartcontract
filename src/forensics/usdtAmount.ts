export function parseUsdtDecimalToRaw(value: string | null | undefined): string | null {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return raw > 0n ? raw.toString() : null;
}
