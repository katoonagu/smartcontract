export type ClassifiedInput =
  | { kind: "tron_address"; value: string }
  | { kind: "tron_tx"; value: string }
  | { kind: "unknown"; value: string };

const TRON_BASE58_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;

export function isLikelyTronAddress(value: string): boolean {
  return TRON_BASE58_PATTERN.test(value.trim());
}

export function isLikelyTronTxHash(value: string): boolean {
  return TX_HASH_PATTERN.test(value.trim());
}

export function classifyInput(input: string): ClassifiedInput {
  const value = input.trim();
  if (isLikelyTronAddress(value)) return { kind: "tron_address", value };
  if (isLikelyTronTxHash(value)) return { kind: "tron_tx", value: value.toLowerCase() };
  return { kind: "unknown", value };
}
