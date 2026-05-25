import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";

export type Trc20TransferLookupOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

export type Trc20TransferCacheOptions = {
  ttlMs?: number;
  now?: () => number;
};

export type Trc20TransferCache = {
  getOrFetch(
    address: string,
    options: Trc20TransferLookupOptions,
    fetcher: () => Promise<RawTronscanTrc20Transfer[]>
  ): Promise<RawTronscanTrc20Transfer[]>;
};

const DEFAULT_TTL_MS = 300_000;

function cacheKey(address: string, options: Trc20TransferLookupOptions): string {
  return JSON.stringify([
    address,
    options.start ?? null,
    options.limit ?? null,
    options.minTimestamp ?? null,
    options.endTimestamp ?? null
  ]);
}

export function createTrc20TransferCache(options: Trc20TransferCacheOptions = {}): Trc20TransferCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { expiresAt: number; value: RawTronscanTrc20Transfer[] }>();

  return {
    async getOrFetch(address, lookupOptions, fetcher) {
      const key = cacheKey(address, lookupOptions);
      const current = now();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > current) {
        return cached.value;
      }

      const value = await fetcher();
      entries.set(key, { expiresAt: current + ttlMs, value });
      return value;
    }
  };
}
