import { describe, expect, it, vi } from "vitest";
import {
  acquireConfirmedWalletSnapshot,
  createTronConfirmedSnapshotSource
} from "../../src/unifiedCheck/snapshot";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";

describe("production confirmed TRON snapshot source", () => {
  it("pins the solidified block and refuses to mislabel moving head balances as as-of state", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetchFn = vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(resource));
      calls.push({
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      const payload = url.pathname === "/walletsolidity/getnowblock"
        ? {
            blockID: "A".repeat(64),
            block_header: {
              raw_data: {
                number: 84713573,
                timestamp: Date.parse("2026-07-23T12:53:54.000Z")
              }
            }
          }
        : (() => {
            throw new Error(`unexpected moving-head balance read:${url.pathname}`);
          })();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const source = createTronConfirmedSnapshotSource({
      fullNodeBaseUrl: new URL("https://api.trongrid.io"),
      fullNodeApiKey: "not-logged",
      fetchFn
    });

    const result = await acquireConfirmedWalletSnapshot(source, ADDRESS);

    expect(result.snapshot).toMatchObject({
      confirmedBlockNumber: "84713573",
      confirmedBlockHash: "a".repeat(64),
      timestamp: "2026-07-23T12:53:54.000Z",
      balances: {
        trxSun: null,
        usdtRaw: null,
        source: "tron-walletsolidity-pinned-state-unavailable",
        consistency: "unavailable"
      }
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/walletsolidity/getnowblock"
    ]);
  });
});
