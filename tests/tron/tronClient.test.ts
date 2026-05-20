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
    expect(init.headers).toEqual({ "TRON-PRO-API-KEY": "secret" });
  });

  it("throws on malformed transfer response shape", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token_transfers: { bad: true } }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "token_transfers must be an array"
    );
  });

  it("throws when the transfer response omits the transfer array", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "unexpected body" }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "token_transfers field is missing"
    );
  });

  it("throws on non-2xx transfer responses", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "rate limited" }, { status: 429 }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111")).rejects.toThrow(
      "Tronscan transfer request failed: 429"
    );
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
