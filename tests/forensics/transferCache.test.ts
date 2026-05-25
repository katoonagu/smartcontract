import { describe, expect, it, vi } from "vitest";
import { createTrc20TransferCache } from "../../src/forensics/transferCache";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";

function transfer(transactionId: string): RawTronscanTrc20Transfer {
  return {
    transaction_id: transactionId,
    from_address: "TSource111111111111111111111111111111",
    to_address: "TTarget111111111111111111111111111111",
    quant: "1000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    block_ts: Date.parse("2026-05-05T10:00:00.000Z")
  };
}

describe("forensic TRC20 transfer cache", () => {
  it("reuses fulfilled transfer lookups within the TTL by full query key", async () => {
    let now = 1_000;
    const cache = createTrc20TransferCache({ ttlMs: 500, now: () => now });
    const fetcher = vi.fn(async () => [transfer("tx-1")]);
    const options = {
      start: 0,
      limit: 50,
      minTimestamp: Date.parse("2026-05-01T00:00:00.000Z"),
      endTimestamp: Date.parse("2026-05-31T00:00:00.000Z")
    };

    await expect(cache.getOrFetch("TAddress11111111111111111111111111111", options, fetcher)).resolves.toEqual([transfer("tx-1")]);
    await expect(cache.getOrFetch("TAddress11111111111111111111111111111", { ...options }, fetcher)).resolves.toEqual([transfer("tx-1")]);
    await cache.getOrFetch("TOther111111111111111111111111111111", options, fetcher);
    now = 1_501;
    await cache.getOrFetch("TAddress11111111111111111111111111111", options, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not cache failed transfer lookups", async () => {
    const cache = createTrc20TransferCache({ ttlMs: 300_000, now: () => 1_000 });
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("TronScan unavailable"))
      .mockResolvedValueOnce([transfer("tx-after-failure")]);
    const options = { start: 0, limit: 50, minTimestamp: 1, endTimestamp: 2 };

    await expect(cache.getOrFetch("TAddress11111111111111111111111111111", options, fetcher)).rejects.toThrow("TronScan unavailable");
    await expect(cache.getOrFetch("TAddress11111111111111111111111111111", options, fetcher)).resolves.toEqual([transfer("tx-after-failure")]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
