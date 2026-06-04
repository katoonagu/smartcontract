const DEFAULT_INDEXED_FETCH_LIMIT = 150;

export function whereIsMoneyIndexedFetchLimit(maxEdgesPerAddress: number): number {
  return Math.max(DEFAULT_INDEXED_FETCH_LIMIT, maxEdgesPerAddress);
}

export function whereIsMoneyLiveFallbackLimit(requestedLimit: number, maxEdgesPerAddress: number): number {
  return Math.min(requestedLimit, maxEdgesPerAddress);
}

export function whereIsMoneyLatestFallbackCacheKey(
  address: string,
  requestedLimit: number,
  liveLimit: number
): string {
  return `${address}:${requestedLimit}:${liveLimit}`;
}
