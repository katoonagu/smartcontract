import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { TronscanClient } from "../../src/tron/tronClient";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

describe("TronscanClient", () => {
  it("requests incoming confirmed official USDT transfers", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token_transfers: [] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      apiKey: "secret",
      fetchFn
    });

    await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/token_trc20/transfers");
    expect(url.searchParams.get("toAddress")).toBe("TReceiver11111111111111111111111111111");
    expect(url.searchParams.get("contract_address")).toBe(TRON_USDT_CONTRACT_ADDRESS);
    expect(url.searchParams.get("confirm")).toBe("0");
    expect(url.searchParams.get("sort")).toBe("-timestamp");
    expect(init.headers).toEqual({ "TRON-PRO-API-KEY": "secret" });
  });

  it("applies pagination and minimum timestamp query params when supplied", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token_transfers: [] }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111", {
      start: 100,
      limit: 25,
      minTimestamp: 1_735_689_600_000
    });

    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("start")).toBe("100");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("minTimestamp")).toBe("1735689600000");
    expect(url.searchParams.get("toAddress")).toBe("TReceiver11111111111111111111111111111");
    expect(url.searchParams.get("contract_address")).toBe(TRON_USDT_CONTRACT_ADDRESS);
    expect(url.searchParams.get("confirm")).toBe("0");
    expect(url.searchParams.get("sort")).toBe("-timestamp");
  });

  it("throws on malformed transfer response shape", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token_transfers: { bad: true } }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "token_transfers must be an array"
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws when the transfer response omits the transfer array", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "unexpected body" }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "token_transfers field is missing"
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries transient transfer responses and returns the successful retry", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ token_transfers: [{ transaction_id: "tx1" }] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 1,
      retryBaseDelayMs: 0
    });

    const transfers = await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111");

    expect(transfers).toEqual([{ transaction_id: "tx1" }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient 400 transfer responses", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "bad request" }, { status: 400 }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "Tronscan transfer request failed: 400"
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries network failures before failing the transfer request", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "network down"
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("aborts timed out transfer requests and retries them", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(
        (_url: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })
      );
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn,
        timeoutMs: 10,
        retryAttempts: 1,
        retryBaseDelayMs: 0
      });

      const result = expect(
        client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")
      ).rejects.toThrow("aborted");

      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10);
      await result;
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-https base urls", () => {
    expect(() => new TronscanClient("http://apilist.tronscanapi.com")).toThrow("baseUrl must use https");
  });

  it("uses the transaction info endpoint for transaction lookup", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ hash: "abc123" }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await client.getTransaction("abc123");

    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/transaction-info");
    expect(url.searchParams.get("hash")).toBe("abc123");
  });
});
