import { TronWeb } from "tronweb";
import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { TronscanClient, type PinnedTronscanTransferPage } from "../../src/tron/tronClient";
import { createTronscanScheduler } from "../../src/tron/tronscanScheduler";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

function tronGridTransfer(transactionId: string, value: string): Record<string, unknown> {
  return {
    transaction_id: transactionId,
    token_info: {
      symbol: "USDT",
      address: TRON_USDT_CONTRACT_ADDRESS,
      decimals: 6
    },
    block_timestamp: 1_780_090_767_000,
    from: "TSource111111111111111111111111111111",
    to: "TSubject111111111111111111111111111111",
    value
  };
}

const BLACKLIST_ADDRESS = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
const OTHER_ADDRESS = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";
const ADDED_BLACKLIST_TOPIC = TronWeb.sha3("AddedBlackList(address)");
const REMOVED_BLACKLIST_TOPIC = TronWeb.sha3("RemovedBlackList(address)");

function blacklistAddressHex(address = BLACKLIST_ADDRESS): string {
  return `0x${TronWeb.address.toHex(address).slice(2).toLowerCase()}`;
}

function blacklistAddressTopic(address = BLACKLIST_ADDRESS): string {
  return `0x${TronWeb.address.toHex(address).slice(2).padStart(64, "0").toLowerCase()}`;
}

function blacklistProviderRow(
  txHash: string,
  time: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    blackAddress: BLACKLIST_ADDRESS,
    tokenName: "USDT",
    num: "0",
    time,
    transHash: txHash,
    contractAddress: TRON_USDT_CONTRACT_ADDRESS,
    ...overrides
  };
}

function confirmedBlacklistTransaction(
  txHash: string,
  time: number,
  block: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    hash: txHash,
    timestamp: time * 1000,
    block,
    confirmed: true,
    revert: false,
    contractRet: "SUCCESS",
    // Multisig wrappers may target another contract; the verified event is authoritative.
    contractData: { contract_address: OTHER_ADDRESS },
    ...overrides
  };
}

function blacklistContractEvent(
  txHash: string,
  time: number,
  block: number,
  logIndex: number,
  kind: "added" | "removed" = "added",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const added = kind === "added";
  return {
    transaction_id: txHash,
    block_number: block,
    block_timestamp: time * 1000,
    event_index: logIndex,
    event_name: added ? "AddedBlackList" : "RemovedBlackList",
    event: added ? "AddedBlackList(address)" : "RemovedBlackList(address)",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    result: { _user: blacklistAddressHex() },
    topics: [added ? ADDED_BLACKLIST_TOPIC : REMOVED_BLACKLIST_TOPIC, blacklistAddressTopic()],
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

describe("TronscanClient", () => {
  it("gets raw fullnode transactions with hash-bound scheduler dedupe", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn((input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((resolve) => {
      if (!resolveFirst) resolveFirst = resolve;
      else resolve(jsonResponse({ txID: JSON.parse(String(init?.body)).value }));
    }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fullNodeApiKey: "fullnode-secret",
      fetchFn
    });

    const first = client.getRawTransaction("a".repeat(64));
    const same = client.getRawTransaction("a".repeat(64));
    const different = client.getRawTransaction("b".repeat(64));
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/wallet/gettransactionbyid");
    expect(JSON.parse(String(init.body))).toEqual({ value: "a".repeat(64) });
    resolveFirst!(jsonResponse({ txID: "a".repeat(64) }));
    await expect(first).resolves.toEqual({ txID: "a".repeat(64) });
    await expect(same).resolves.toEqual({ txID: "a".repeat(64) });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    await expect(different).resolves.toEqual({ txID: "b".repeat(64) });
  });
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
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("secret");
  });

  it("rotates comma-separated API keys without sending the raw comma string", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ balance: "123" }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      apiKey: "key-a, key-b",
      fetchFn,
      requestMinIntervalMs: 1000
    });

    await Promise.all([
      client.getAccount("TSubject111111111111111111111111111111"),
      client.getAccount("TSubject222222222222222222222222222222")
    ]);

    const headers = fetchFn.mock.calls.map((call) =>
      headerValue(((call as unknown as [URL, RequestInit])[1]).headers, "TRON-PRO-API-KEY")
    );
    expect(headers).toEqual(["key-a", "key-b"]);
    expect(headers).not.toContain("key-a, key-b");
  });

  it("logs safe request attempt metadata without raw API keys", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const fetchFn = vi.fn(async () => jsonResponse({ balance: "123" }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      apiKey: "secret",
      fetchFn,
      logger: {
        info: (event, fields) => logs.push({ event, fields }),
        warn: (event, fields) => logs.push({ event, fields }),
        error: (event, fields) => logs.push({ event, fields })
      }
    });

    await client.getAccount("TSubject111111111111111111111111111111");

    const attemptLog = logs.find((log) => log.event === "tronscan_request_attempt");
    expect(attemptLog?.fields).toMatchObject({
      request_name: "account",
      api_key_index: 0,
      endpoint_bucket: "default"
    });
    expect(JSON.stringify(logs)).not.toContain("secret");
  });

  it("applies pagination and minimum timestamp query params when supplied", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token_transfers: [] }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111", {
      start: 100,
      limit: 25,
      minTimestamp: 1_735_689_600_000,
      endTimestamp: 1_735_700_000_000
    });

    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("start")).toBe("100");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("start_timestamp")).toBe("1735689600000");
    expect(url.searchParams.get("end_timestamp")).toBe("1735700000000");
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

  it("retries transient transfer network errors and returns the successful retry", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network reset"))
      .mockResolvedValueOnce(jsonResponse({ token_transfers: [{ transaction_id: "tx1" }] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 1,
      retryBaseDelayMs: 0,
      logger: {
        info: (event, fields) => logs.push({ event, fields }),
        warn: (event, fields) => logs.push({ event, fields }),
        error: (event, fields) => logs.push({ event, fields })
      }
    });

    const transfers = await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111");

    expect(transfers).toEqual([{ transaction_id: "tx1" }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logs.map((log) => log.event)).toEqual([
      "tronscan_request_attempt",
      "tronscan_request_retry",
      "tronscan_request_attempt",
      "tronscan_request_success"
    ]);
    expect(logs[0].fields).toMatchObject({ api_key_index: null, endpoint_bucket: "transfer" });
    expect(logs[1].fields).toMatchObject({ request_name: "transfer", attempt: 0, next_attempt: 1 });
  });

  it("falls back to TronGrid incoming TRC20 history after a TronScan 429 without retrying TronScan", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    let tronscanRequests = 0;
    const fetchFn = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      if (requestUrl.pathname === "/api/token_trc20/transfers") {
        tronscanRequests += 1;
        return jsonResponse({ error: "rate limited" }, { status: 429 });
      }
      expect(requestUrl.pathname).toBe("/v1/accounts/TReceiver11111111111111111111111111111/transactions/trc20");
      expect(requestUrl.searchParams.get("contract_address")).toBe(TRON_USDT_CONTRACT_ADDRESS);
      expect(requestUrl.searchParams.get("only_confirmed")).toBe("true");
      expect(requestUrl.searchParams.get("only_to")).toBe("true");
      expect(requestUrl.searchParams.get("order_by")).toBe("block_timestamp,desc");
      expect(headerValue(init?.headers, "TRON-PRO-API-KEY")).toBe("trongrid-key");
      return jsonResponse({
        data: [
          {
            transaction_id: "fallback-tx-1",
            token_info: {
              symbol: "USDT",
              address: TRON_USDT_CONTRACT_ADDRESS,
              decimals: 6
            },
            block_timestamp: 1_780_090_767_000,
            from: "TSender111111111111111111111111111111",
            to: "TReceiver11111111111111111111111111111",
            value: "150000000"
          }
        ],
        success: true,
        meta: {}
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      apiKey: "tronscan-key",
      fullNodeApiKey: "trongrid-key",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0,
      rateLimitCooldownMs: 1_000,
      logger: {
        info: (event, fields) => logs.push({ event, fields }),
        warn: (event, fields) => logs.push({ event, fields }),
        error: (event, fields) => logs.push({ event, fields })
      }
    });

    const transfers = await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111");

    expect(transfers).toEqual([
      {
        transaction_id: "fallback-tx-1",
        from_address: "TSender111111111111111111111111111111",
        to_address: "TReceiver11111111111111111111111111111",
        quant: "150000000",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        confirmed: true,
        contractRet: "SUCCESS",
        finalResult: "SUCCESS",
        status: "SUCCESS",
        tokenInfo: {
          tokenAbbr: "USDT",
          tokenDecimal: 6,
          tokenId: TRON_USDT_CONTRACT_ADDRESS,
          tokenType: "trc20"
        },
        block_ts: 1_780_090_767_000
      }
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(tronscanRequests).toBe(1);
    expect(logs.map((log) => log.event)).toContain("trongrid_transfer_history_fallback");
    expect(logs.map((log) => log.event)).not.toContain("tronscan_request_failed");
    expect(logs.map((log) => log.event)).not.toContain("tronscan_request_retry");
    expect(JSON.stringify(logs)).not.toContain("TReceiver11111111111111111111111111111");
  });

  it("preserves related transfer offset semantics when TronGrid fallback needs pagination", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      if (requestUrl.pathname === "/api/token_trc20/transfers") {
        return jsonResponse({ error: "rate limited" }, { status: 429 });
      }
      expect(requestUrl.pathname).toBe("/v1/accounts/TSubject111111111111111111111111111111/transactions/trc20");
      expect(requestUrl.searchParams.get("only_to")).toBeNull();
      if (!requestUrl.searchParams.has("fingerprint")) {
        expect(requestUrl.searchParams.get("limit")).toBe("3");
        return jsonResponse({
          data: [
            tronGridTransfer("fallback-tx-1", "1"),
            tronGridTransfer("fallback-tx-2", "2")
          ],
          meta: { fingerprint: "next-page" }
        });
      }
      expect(requestUrl.searchParams.get("fingerprint")).toBe("next-page");
      expect(requestUrl.searchParams.get("limit")).toBe("1");
      return jsonResponse({
        data: [tronGridTransfer("fallback-tx-3", "3")],
        meta: {}
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn,
      retryAttempts: 0
    });

    const transfers = await client.listRelatedTrc20Transfers("TSubject111111111111111111111111111111", {
      start: 1,
      limit: 2
    });

    expect(transfers.map((transfer) => transfer.transaction_id)).toEqual(["fallback-tx-2", "fallback-tx-3"]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("falls back to TronGrid for 400 transfer responses without retrying Tronscan", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    let tronscanRequests = 0;
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      if (requestUrl.pathname === "/api/token_trc20/transfers") {
        tronscanRequests += 1;
        return jsonResponse({ error: "bad request" }, { status: 400 });
      }
      expect(requestUrl.pathname).toBe("/v1/accounts/TReceiver11111111111111111111111111111/transactions/trc20");
      return jsonResponse({
        data: [
          tronGridTransfer("fallback-400-tx-0", "1"),
          tronGridTransfer("fallback-400-tx-1", "2")
        ],
        meta: {}
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0,
      logger: {
        info: (event, fields) => logs.push({ event, fields }),
        warn: (event, fields) => logs.push({ event, fields }),
        error: (event, fields) => logs.push({ event, fields })
      }
    });

    const transfers = await client.listIncomingTrc20Transfers("TReceiver11111111111111111111111111111", {
      start: 1,
      limit: 1,
      minTimestamp: 1_780_000_000_000,
      endTimestamp: 1_780_090_767_000
    });

    expect(transfers.map((transfer) => transfer.transaction_id)).toEqual(["fallback-400-tx-1"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(tronscanRequests).toBe(1);
    const fallbackLog = logs.find((log) => log.event === "trongrid_transfer_history_fallback");
    expect(fallbackLog?.fields).toMatchObject({
      direction: "incoming",
      path: "/api/token_trc20/transfers",
      start: 1,
      limit: 1,
      min_timestamp: 1_780_000_000_000,
      end_timestamp: 1_780_090_767_000,
      token_contract_address: TRON_USDT_CONTRACT_ADDRESS,
      error: "Tronscan transfer request failed: 400"
    });
    expect(logs.map((log) => log.event)).not.toContain("tronscan_request_failed");
    expect(logs.map((log) => log.event)).not.toContain("tronscan_request_retry");
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

  it("aborts a dedicated poisoning lookup at five seconds without retrying or changing ordinary retry behavior", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = {
        schedule: vi.fn(async (_bucket: unknown, operation: (context: { apiKey: string | null }) => Promise<unknown>) =>
          operation({ apiKey: null }))
      };
      const hangingFetch = vi.fn(
        (_url: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("poisoning timeout", "AbortError")));
          })
      );
      const poisoningClient = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn: hangingFetch,
        timeoutMs: 5_000,
        retryAttempts: 0,
        scheduler: scheduler as never
      });
      const poisoningLookup = expect(poisoningClient.listRelatedTrc20Transfers(
        "TReceiver11111111111111111111111111111"
      )).rejects.toThrow("poisoning timeout");

      await vi.advanceTimersByTimeAsync(4_999);
      expect(hangingFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await poisoningLookup;
      expect(hangingFetch).toHaveBeenCalledTimes(1);

      const ordinaryFetch = vi.fn(async () => { throw new TypeError("ordinary network failure"); });
      const ordinaryClient = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn: ordinaryFetch,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        scheduler: scheduler as never
      });
      await expect(ordinaryClient.listRelatedTrc20Transfers(
        "TReceiver11111111111111111111111111111"
      )).rejects.toThrow("ordinary network failure");
      expect(ordinaryFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps ordinary and poisoning timeout/retry policies isolated on one real scheduler", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = createTronscanScheduler({
        requestMinIntervalMs: 0,
        rateLimitCooldownMs: 0,
        maxInFlight: 2
      });
      const ordinaryFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError("ordinary transient failure"))
        .mockResolvedValueOnce(jsonResponse({ token_transfers: [] }));
      const poisoningFetch = vi.fn(
        (_url: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("poisoning timeout", "AbortError")));
          })
      );
      const ordinaryClient = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn: ordinaryFetch,
        timeoutMs: 20_000,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        scheduler
      });
      const poisoningClient = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn: poisoningFetch,
        timeoutMs: 5_000,
        retryAttempts: 0,
        schedulerDedupeNamespace: "address_poisoning",
        scheduler
      });

      const ordinary = ordinaryClient.listRelatedTrc20Transfers("TReceiver11111111111111111111111111111");
      const poisoning = poisoningClient.listRelatedTrc20Transfers("TReceiver11111111111111111111111111111")
        .then(() => "resolved", (error: Error) => error.name);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(ordinary).resolves.toEqual([]);
      await expect(poisoning).resolves.toBe("AbortError");
      expect(ordinaryFetch).toHaveBeenCalledTimes(2);
      expect(poisoningFetch).toHaveBeenCalledTimes(1);
      expect(scheduler.diagnostics().dispatchedRequests).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches a queued poisoning transfer before bulk work and starts its timeout only at dispatch", async () => {
    vi.useFakeTimers();
    try {
      let releaseBlocker!: () => void;
      const blockerGate = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      const scheduler = createTronscanScheduler({
        requestMinIntervalMs: 0,
        rateLimitCooldownMs: 0,
        maxInFlight: 1
      });
      const blocker = scheduler.schedule({ requestName: "blocker", path: "/blocker" }, async () => blockerGate);
      await Promise.resolve();
      const events: string[] = [];
      const bulkClient = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn: vi.fn(async () => {
          events.push("bulk");
          return jsonResponse({ token_transfers: [] });
        }),
        scheduler
      });
      const poisoningFetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
        events.push("poisoning");
        expect(init?.signal?.aborted).toBe(false);
        return jsonResponse({ token_transfers: [] });
      });
      const poisoningClient = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn: poisoningFetch,
        timeoutMs: 5_000,
        retryAttempts: 0,
        schedulerDedupeNamespace: "address_poisoning",
        transferSchedulingPriority: "interactive_fast",
        scheduler
      });

      const bulk = bulkClient.listRelatedTrc20Transfers("TBulk11111111111111111111111111111111");
      const poisoning = poisoningClient.listRelatedTrc20Transfers("TPoison111111111111111111111111111111");
      await vi.advanceTimersByTimeAsync(6_000);
      expect(poisoningFetch).not.toHaveBeenCalled();

      releaseBlocker();
      await blocker;
      await Promise.all([bulk, poisoning]);
      expect(events).toEqual(["poisoning", "bulk"]);
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

  it.each([
    { label: "receipt result success", raw: { receipt: { result: "SUCCESS" }, contractRet: "FAILED" }, expected: true },
    { label: "receipt result failure", raw: { receipt: { result: "REVERT" }, contractRet: "SUCCESS" }, expected: false },
    { label: "explicit receipt boolean wins", raw: { receipt: { success: false, result: "SUCCESS" } }, expected: false }
  ])("normalizes $label without using top-level status", async ({ raw, expected }) => {
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse(raw))
    });

    const result = await client.getTransaction("tx-receipt") as { receipt?: { success?: boolean; result?: string } };

    expect(result.receipt?.success).toBe(expected);
    expect(result.receipt?.result).toBe(raw.receipt.result);
  });

  it("does not invent receipt success from top-level transaction status", async () => {
    const raw = { contractRet: "SUCCESS", finalResult: "SUCCESS" };
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse(raw))
    });

    const result = await client.getTransaction("tx-top-level") as { receipt?: { success?: boolean } };

    expect(result).toEqual(raw);
    expect(result.receipt?.success).toBeUndefined();
  });

  it("reads raw transaction signing metadata from the full node endpoint", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        txID: "approval-tx",
        raw_data: {
          timestamp: 1777907188559,
          expiration: 1778101647000,
          ref_block_bytes: "85bd",
          ref_block_hash: "37b6a33ffa9ea697"
        }
      })
    );
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      apiKey: "secret",
      fullNodeApiKey: "fullnode-secret",
      fetchFn
    });

    const metadata = await client.getTransactionSigningMetadata("approval-tx");

    expect(metadata).toEqual({
      txHash: "approval-tx",
      signedAt: new Date("2026-05-04T15:06:28.559Z"),
      expirationAt: new Date("2026-05-06T21:07:27.000Z"),
      refBlockBytes: "85bd",
      refBlockHash: "37b6a33ffa9ea697"
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://api.trongrid.io/wallet/gettransactionbyid");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ value: "approval-tx" });
    expect(headerValue(init.headers, "content-type")).toBe("application/json");
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("fullnode-secret");
  });

  it("requests account details with the API key", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ balance: "123" }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      apiKey: "secret",
      fetchFn
    });

    const account = await client.getAccount("TSubject111111111111111111111111111111");

    expect(account).toEqual({ balance: "123" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/account");
    expect(url.searchParams.get("address")).toBe("TSubject111111111111111111111111111111");
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("secret");
  });

  it("parses account metadata identity and contract status", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
          name: "Bridgers",
          accountType: 2,
          contractMap: { TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s: true }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
              name: "Bridgers",
              tag1: "Bridgers:Cross-chain Bridge",
              risk: false,
              verify_status: 1,
              date_created: 1721486160000
            }
          ]
        })
      );
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      apiKey: "secret",
      fetchFn
    });

    const metadata = await client.getAddressMetadata("TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s");

    expect(metadata).toMatchObject({
      address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
      name: "Bridgers",
      tag: "Bridgers:Cross-chain Bridge",
      isContract: true,
      verified: true,
      accountType: 2,
      source: "tronscan"
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/account");
    expect(url.searchParams.get("address")).toBe("TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s");
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("secret");
    const [contractUrl] = fetchFn.mock.calls[1] as unknown as [URL, RequestInit];
    expect(contractUrl.pathname).toBe("/api/contracts");
    expect(contractUrl.searchParams.get("search")).toBe("TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s");
    expect(metadata.rawJson.contractSearch).toMatchObject({
      tag: "Bridgers:Cross-chain Bridge",
      risk: false,
      verifyStatus: true,
      dateCreated: 1721486160000
    });
  });

  it("parses unnamed account metadata as wallet identity", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        address: "TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj",
        accountType: 0
      })
    );
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const metadata = await client.getAddressMetadata("TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj");

    expect(metadata).toMatchObject({
      address: "TMouG48ojTrYydeyLRt63eDDHTjq6Ue2Lj",
      name: null,
      isContract: false,
      accountType: 0
    });
  });

  it("throws when account details are not an object record", async () => {
    const fetchFn = vi.fn(async () => jsonResponse([]));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.getAccount("TSubject111111111111111111111111111111")).rejects.toThrow(
      "Tronscan account response must be an object"
    );
  });

  it("requests related official USDT transfers with relatedAddress", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ token_transfers: [{ transaction_id: "tx1" }] }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const transfers = await client.listRelatedTrc20Transfers("TSubject111111111111111111111111111111", {
      start: 50,
      limit: 10,
      minTimestamp: 1_735_689_600_000,
      endTimestamp: 1_735_700_000_000
    });

    expect(transfers).toEqual([{ transaction_id: "tx1" }]);
    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/token_trc20/transfers");
    expect(url.searchParams.get("relatedAddress")).toBe("TSubject111111111111111111111111111111");
    expect(url.searchParams.get("toAddress")).toBeNull();
    expect(url.searchParams.get("contract_address")).toBe(TRON_USDT_CONTRACT_ADDRESS);
    expect(url.searchParams.get("confirm")).toBe("0");
    expect(url.searchParams.get("sort")).toBe("-timestamp");
    expect(url.searchParams.get("start")).toBe("50");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("start_timestamp")).toBe("1735689600000");
    expect(url.searchParams.get("end_timestamp")).toBe("1735700000000");
  });

  it("splits Tronscan transfer history requests above the provider page limit", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      const limit = Number(requestUrl.searchParams.get("limit"));
      expect(limit).toBeLessThanOrEqual(50);
      return jsonResponse({
        token_transfers: Array.from({ length: limit }, (_, index) => ({
          transaction_id: `tx-${start + index}`
        }))
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const transfers = await client.listRelatedTrc20Transfers("TSubject111111111111111111111111111111", {
      start: 10,
      limit: 150
    });

    expect(transfers).toHaveLength(150);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls.map((call) => {
      const url = call[0] instanceof URL ? call[0] : new URL(String(call[0]));
      return {
        start: url.searchParams.get("start"),
        limit: url.searchParams.get("limit")
      };
    })).toEqual([
      { start: "10", limit: "50" },
      { start: "60", limit: "50" },
      { start: "110", limit: "50" }
    ]);
  });

  it("returns Tronscan related transfer page metadata", async () => {
    const transfer = {
      transaction_id: "tx1",
      block: 73_000_001,
      event_index: 1,
      event_type: "Transfer",
      from_address: "TSource111111111111111111111111111111",
      to_address: "TSubject111111111111111111111111111111",
      contract_address: TRON_USDT_CONTRACT_ADDRESS,
      quant: "1000000",
      block_ts: 1_780_090_000_000
    };
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        total: 123,
        rangeTotal: 7,
        token_transfers: [transfer]
      })
    );
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPage("TSubject111111111111111111111111111111", {
      start: 50,
      limit: 50,
      startTimestamp: 0,
      endTimestamp: 1_780_100_000_000
    });

    expect(page.provider).toBe("tronscan");
    expect(page.total).toBe(123);
    expect(page.rangeTotal).toBe(7);
    expect(page.transfers).toEqual([transfer]);
    expect(page.rawResponseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(page.canonicalTransferHash).toMatch(/^[0-9a-f]{64}$/);
    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/token_trc20/transfers");
    expect(url.searchParams.get("relatedAddress")).toBe("TSubject111111111111111111111111111111");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("start")).toBe("50");
    expect(url.searchParams.get("start_timestamp")).toBe("0");
    expect(url.searchParams.get("end_timestamp")).toBe("1780100000000");
  });

  it("pins poisoning history to TronScan and never falls back after a provider failure", async () => {
    const paths: string[] = [];
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      paths.push(requestUrl.pathname);
      if (requestUrl.pathname === "/api/token_trc20/transfers") {
        return jsonResponse({ error: "rate limited" }, { status: 429 });
      }
      return jsonResponse({ data: [tronGridTransfer("must-not-run", "1")], meta: {} });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn,
      retryAttempts: 0
    });

    await expect(client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    )).rejects.toThrow("429");
    expect(paths).toEqual(["/api/token_trc20/transfers"]);
  });

  it("builds one pinned logical page from two provider subpages without gaps or duplicates", async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      starts.push(start);
      return jsonResponse({
        total: 100,
        rangeTotal: 100,
        token_transfers: Array.from({ length: 50 }, (_, index) => ({
          transaction_id: `pinned-${start + index}`,
          from_address: "TSource111111111111111111111111111111",
          to_address: "TSubject111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "1",
          block_ts: 1_780_090_000_000 - start - index
        }))
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(starts).toEqual([0, 50]);
    expect(page.transfers.map((row) => row.transaction_id)).toEqual(
      Array.from({ length: 100 }, (_, index) => `pinned-${index}`)
    );
    expect(page).toMatchObject({
      provider: "tronscan",
      start: 0,
      requestedLimit: 100,
      nextOffset: 100,
      total: 100,
      rangeTotal: 100,
      complete: true,
      metadataConsistent: true
    });
    expect(page.rawResponseHashes).toHaveLength(2);
    expect(page.canonicalTransferHashes).toHaveLength(2);
    expect((page as PinnedTronscanTransferPage & { rawProviderRowIds: string[] }).rawProviderRowIds).toHaveLength(100);
  });

  it("accepts an underfilled capped root window as complete", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      total: 10_000,
      rangeTotal: 10_000,
      token_transfers: Array.from({ length: 6 }, (_, index) => ({
        transaction_id: `capped-root-${index}`,
        from_address: "TSource111111111111111111111111111111",
        to_address: "TSubject111111111111111111111111111111",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        quant: "1",
        block_ts: 1_780_090_000_000 - index
      }))
    }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 50 }
    );

    expect(page).toMatchObject({
      nextOffset: 6,
      total: 10_000,
      rangeTotal: 10_000,
      complete: true,
      metadataConsistent: true
    });
  });

  it("accepts an underfilled capped window from a nonzero offset as complete", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      total: 10_000,
      rangeTotal: 10_000,
      token_transfers: Array.from({ length: 23 }, (_, index) => ({
        transaction_id: `capped-offset-${50 + index}`,
        from_address: "TSource111111111111111111111111111111",
        to_address: "TSubject111111111111111111111111111111",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        quant: "1",
        block_ts: 1_780_090_000_000 - index
      }))
    }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 50, limit: 50 }
    );

    expect(page).toMatchObject({
      start: 50,
      nextOffset: 73,
      total: 10_000,
      rangeTotal: 10_000,
      complete: true,
      metadataConsistent: true
    });
  });

  it("marks a pinned logical page inconsistent when provider offsets overlap", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      const indexes = start === 0
        ? Array.from({ length: 50 }, (_, index) => index)
        : [49, ...Array.from({ length: 49 }, (_, index) => index + 50)];
      return jsonResponse({
        total: 100,
        rangeTotal: 100,
        token_transfers: indexes.map((index) => ({
          transaction_id: `overlap-${index}`,
          event_index: index,
          from_address: "TSource111111111111111111111111111111",
          to_address: "TSubject111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "1",
          block_ts: 1_780_090_000_000 - index
        }))
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(page.transfers).toHaveLength(100);
    expect(page.transfers.filter((row) => row.transaction_id === "overlap-49")).toHaveLength(2);
    expect(page.metadataConsistent).toBe(false);
    expect(page.complete).toBe(false);
  });

  it("keeps separate events in one transaction distinct when event indexes are present", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      return jsonResponse({
        total: 100,
        rangeTotal: 100,
        token_transfers: Array.from({ length: 50 }, (_, offset) => {
          const index = start + offset;
          const multiEvent = index === 49 || index === 50;
          return {
            transaction_id: multiEvent ? "multi-event-tx" : `distinct-${index}`,
            event_index: index,
            from_address: "TSource111111111111111111111111111111",
            to_address: "TSubject111111111111111111111111111111",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            quant: "1",
            block_ts: multiEvent ? 1_780_090_000_000 : 1_780_090_000_000 - index
          };
        })
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(page.transfers.filter((row) => row.transaction_id === "multi-event-tx")).toHaveLength(2);
    const rawIds = (page as PinnedTronscanTransferPage & { rawProviderRowIds: string[] }).rawProviderRowIds;
    expect(rawIds[49]).not.toBe(rawIds[50]);
    expect(page.metadataConsistent).toBe(true);
    expect(page.complete).toBe(true);
  });

  it("keeps canonically distinct events in one transaction when event indexes are absent", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      total: 2,
      rangeTotal: 2,
      token_transfers: [
        {
          transaction_id: "multi-event-without-index",
          from_address: "TSource111111111111111111111111111111",
          to_address: "TFirst1111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "46114610",
          block_ts: 1_780_090_000_000
        },
        {
          transaction_id: "multi-event-without-index",
          from_address: "TSource111111111111111111111111111111",
          to_address: "TSecond111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "3560390",
          block_ts: 1_780_090_000_000
        }
      ]
    }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 50 }
    );

    expect(page.rawProviderRowIds).toHaveLength(2);
    expect(page.rawProviderRowIds[0]).not.toBe(page.rawProviderRowIds[1]);
    expect(page.metadataConsistent).toBe(true);
    expect(page.complete).toBe(true);
  });

  it("detects repeated tx events even when mutable row content changes", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      const rows = Array.from({ length: 50 }, (_, offset) => ({
        transaction_id: start === 0 && offset === 49 || start === 50 && offset === 0
          ? "mutable-overlap"
          : `mutable-distinct-${start + offset}`,
        event_index: start === 0 && offset === 49 || start === 50 && offset === 0 ? 7 : start + offset,
        from_address: "TSource111111111111111111111111111111",
        to_address: "TSubject111111111111111111111111111111",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        quant: start === 50 && offset === 0 ? "999" : "1",
        block_ts: 1_780_090_000_000 - start - offset
      }));
      return jsonResponse({ total: 100, rangeTotal: 100, token_transfers: rows });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    const rawIds = (page as PinnedTronscanTransferPage & { rawProviderRowIds: string[] }).rawProviderRowIds;
    expect(rawIds[49]).toBe(rawIds[50]);
    expect(page.metadataConsistent).toBe(false);
    expect(page.complete).toBe(false);
  });

  it("deduplicates identical tx events when the provider omits the event index", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      const rows = Array.from({ length: 50 }, (_, offset) => ({
        transaction_id: start === 0 && offset === 49 || start === 50 && offset === 0
          ? "tx-only-overlap"
          : `tx-only-distinct-${start + offset}`,
        from_address: "TSource111111111111111111111111111111",
        to_address: "TSubject111111111111111111111111111111",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        quant: "1",
        block_ts: start === 0 && offset === 49 || start === 50 && offset === 0
          ? 1_780_089_999_951
          : 1_780_090_000_000 - start - offset
      }));
      return jsonResponse({ total: 100, rangeTotal: 100, token_transfers: rows });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(page.rawProviderRowIds[49]).toBe(page.rawProviderRowIds[50]);
    expect(page.rawProviderRowIds[49]).toMatch(/^tronscan:tx:tx-only-overlap:row:/);
    expect(page.metadataConsistent).toBe(false);
  });

  it("uses a deterministic raw-row fingerprint when a provider row has no tx hash", async () => {
    const missingTx = {
      event_index: 9,
      from_address: "TSource111111111111111111111111111111",
      to_address: "TSubject111111111111111111111111111111",
      contract_address: TRON_USDT_CONTRACT_ADDRESS,
      quant: "1",
      block_ts: 1_780_090_000_000
    };
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      const rows = Array.from({ length: 50 }, (_, offset) =>
        start === 0 && offset === 49 || start === 50 && offset === 0
          ? {
            ...missingTx,
            quant: start === 50 ? "2" : missingTx.quant,
            block_ts: start === 50 ? missingTx.block_ts - 1 : missingTx.block_ts
          }
          : {
            ...missingTx,
            transaction_id: `fallback-distinct-${start + offset}`,
            event_index: start + offset
          });
      return jsonResponse({ total: 100, rangeTotal: 100, token_transfers: rows });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    const rawIds = (page as PinnedTronscanTransferPage & { rawProviderRowIds: string[] }).rawProviderRowIds;
    expect(rawIds[49]).not.toBe(rawIds[50]);
    expect(rawIds[49]).toMatch(/^tronscan:raw:/);
    expect(rawIds[50]).toMatch(/^tronscan:raw:/);
    expect(page.metadataConsistent).toBe(false);
  });

  it("never completes a negative page containing a tx-less provider row", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      total: 1,
      rangeTotal: 1,
      token_transfers: [{
        from_address: "TSource111111111111111111111111111111",
        to_address: "TSubject111111111111111111111111111111",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        quant: "1",
        block_ts: 1_780_090_000_000
      }]
    }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(page.rawProviderRowIds).toHaveLength(1);
    expect(page.rawProviderRowIds[0]).toMatch(/^tronscan:raw:/);
    expect(page.metadataConsistent).toBe(false);
    expect(page.complete).toBe(false);
  });

  it("continues a short pinned subpage at its actual next offset and reports no progress safely", async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      starts.push(start);
      return jsonResponse({
        total: 100,
        rangeTotal: 100,
        token_transfers: start === 0
          ? Array.from({ length: 10 }, (_, index) => ({
            transaction_id: `short-${index}`,
            from_address: "TSource111111111111111111111111111111",
            to_address: "TSubject111111111111111111111111111111",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            quant: "1",
            block_ts: 1_780_090_000_000 - index
          }))
          : []
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(starts).toEqual([0, 10]);
    expect(page.transfers).toHaveLength(10);
    expect(page.nextOffset).toBe(10);
    expect(page.complete).toBe(false);
    expect(page.metadataConsistent).toBe(false);
  });

  it("bounds sparse pinned logical pages to two provider subrequests", async () => {
    const starts: number[] = [];
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      starts.push(start);
      return jsonResponse({
        total: 100,
        rangeTotal: 100,
        token_transfers: [{
          transaction_id: `sparse-${start}`,
          from_address: "TSource111111111111111111111111111111",
          to_address: "TSubject111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "1",
          block_ts: 1_780_090_000_000 - start
        }]
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(starts).toEqual([0, 1]);
    expect(page.transfers).toHaveLength(2);
    expect(page.nextOffset).toBe(2);
    expect(page.metadataConsistent).toBe(false);
    expect(page.complete).toBe(false);
  });

  it("caps oversized provider subpages to the requested logical chunk", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      total: 60,
      rangeTotal: 60,
      token_transfers: Array.from({ length: 60 }, (_, index) => ({
        transaction_id: `oversized-provider-${index}`,
        from_address: "TSource111111111111111111111111111111",
        to_address: "TSubject111111111111111111111111111111",
        contract_address: TRON_USDT_CONTRACT_ADDRESS,
        quant: "1",
        block_ts: 1_780_090_000_000 - index
      }))
    }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 50 }
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(page.transfers).toHaveLength(50);
    expect(page.nextOffset).toBe(50);
    expect(page.metadataConsistent).toBe(false);
    expect(page.complete).toBe(false);
  });

  it("rejects impossible pinned totals where rangeTotal exceeds total", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      const start = Number(requestUrl.searchParams.get("start"));
      return jsonResponse({
        total: 50,
        rangeTotal: 100,
        token_transfers: Array.from({ length: 50 }, (_, index) => ({
          transaction_id: `impossible-${start + index}`,
          from_address: "TSource111111111111111111111111111111",
          to_address: "TSubject111111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "1",
          block_ts: 1_780_090_000_000 - start - index
        }))
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const page = await client.listRelatedTrc20TransferPagePinned(
      "TSubject111111111111111111111111111111",
      { start: 0, limit: 100 }
    );

    expect(page.transfers).toHaveLength(100);
    expect(page.total).toBe(50);
    expect(page.rangeTotal).toBe(100);
    expect(page.metadataConsistent).toBe(false);
    expect(page.complete).toBe(false);
  });

  it("hashes canonical related transfer page content independent of row order and labels", async () => {
    const firstTransfer = {
      transaction_id: "tx-a",
      block: 73_000_001,
      log_index: 2,
      event_type: "Transfer",
      from_address: "TSource111111111111111111111111111111",
      to_address: "TSubject111111111111111111111111111111",
      contract_address: TRON_USDT_CONTRACT_ADDRESS,
      quant: "1000000",
      block_ts: 1_780_090_000_000,
      from_address_tag: "ignored-label-a"
    };
    const secondTransfer = {
      transaction_id: "tx-b",
      block: 73_000_002,
      log_index: 1,
      event_type: "Transfer",
      from_address: "TOther1111111111111111111111111111111",
      to_address: "TSubject111111111111111111111111111111",
      contract_address: TRON_USDT_CONTRACT_ADDRESS,
      quant: "2000000",
      block_ts: 1_780_090_001_000,
      to_address_tag: "ignored-label-b"
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, rangeTotal: 2, token_transfers: [secondTransfer, firstTransfer] }))
      .mockResolvedValueOnce(jsonResponse({ total: 2, rangeTotal: 2, token_transfers: [
        { ...firstTransfer, from_address_tag: "changed-label-a" },
        { ...secondTransfer, to_address_tag: "changed-label-b" }
      ] }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const firstPage = await client.listRelatedTrc20TransferPage("TSubject111111111111111111111111111111");
    const secondPage = await client.listRelatedTrc20TransferPage("TSubject111111111111111111111111111111");

    expect(firstPage.rawResponseHash).not.toBe(secondPage.rawResponseHash);
    expect(firstPage.canonicalTransferHash).toBe(secondPage.canonicalTransferHash);
  });

  it("returns TronGrid fallback related transfer page metadata as null hashes and totals", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      if (requestUrl.pathname === "/api/token_trc20/transfers") {
        return jsonResponse({ error: "rate limited" }, { status: 429 });
      }
      return jsonResponse({
        data: [tronGridTransfer("fallback-page-tx", "1")],
        meta: {}
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn,
      retryAttempts: 0
    });

    const page = await client.listRelatedTrc20TransferPage("TSubject111111111111111111111111111111", {
      start: 0,
      limit: 1
    });

    expect(page.provider).toBe("trongrid_fallback");
    expect(page.transfers.map((transfer) => transfer.transaction_id)).toEqual(["fallback-page-tx"]);
    expect(page.total).toBeNull();
    expect(page.rangeTotal).toBeNull();
    expect(page.rawResponseHash).toBeNull();
    expect(page.canonicalTransferHash).toBeNull();
  });

  it("lists related TRC20 transfers across all tokens without the USDT contract filter", async () => {
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/token_trc20/transfers");
      expect(requestUrl.searchParams.get("relatedAddress")).toBe("TSubject111111111111111111111111111111");
      expect(requestUrl.searchParams.get("toAddress")).toBeNull();
      expect(requestUrl.searchParams.has("contract_address")).toBe(false);
      expect(requestUrl.searchParams.get("confirm")).toBe("0");
      expect(requestUrl.searchParams.get("sort")).toBe("-timestamp");
      expect(requestUrl.searchParams.get("start")).toBe("0");
      expect(requestUrl.searchParams.get("limit")).toBe("25");
      return jsonResponse({
        token_transfers: [
          {
            transaction_id: "tx-all-token",
            from_address: "TSubject111111111111111111111111111111",
            to_address: "TDestination11111111111111111111111111",
            quant: "100",
            contract_address: "TWrappedToken1111111111111111111111",
            confirmed: true,
            contractRet: "SUCCESS",
            block_ts: 1_770_000_000_000,
            tokenInfo: {
              tokenAbbr: "WRAPPED",
              tokenDecimal: 6,
              tokenId: "TWrappedToken1111111111111111111111",
              tokenType: "trc20"
            }
          }
        ]
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 0
    });

    const transfers = await client.listRelatedTrc20TransfersAllTokens("TSubject111111111111111111111111111111", {
      start: 0,
      limit: 25
    });

    expect(transfers.map((transfer) => transfer.transaction_id)).toEqual(["tx-all-token"]);
  });

  it("preserves real token metadata and does not synthesize USDT metadata for all-token TronGrid fallback", async () => {
    const wrappedTokenAddress = "TWrappedToken1111111111111111111111";
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof URL ? url : new URL(String(url));
      if (requestUrl.pathname === "/api/token_trc20/transfers") {
        return jsonResponse({ error: "rate limited" }, { status: 429 });
      }
      expect(requestUrl.pathname).toBe("/v1/accounts/TSubject111111111111111111111111111111/transactions/trc20");
      expect(requestUrl.searchParams.has("contract_address")).toBe(false);
      expect(requestUrl.searchParams.get("only_to")).toBeNull();
      return jsonResponse({
        data: [
          {
            transaction_id: "fallback-wrapped-token",
            token_info: {
              symbol: "WRAPPED",
              address: wrappedTokenAddress,
              decimals: 8
            },
            block_timestamp: 1_780_090_767_000,
            from: "TSubject111111111111111111111111111111",
            to: "TDestination11111111111111111111111111",
            value: "2500000000"
          },
          {
            transaction_id: "fallback-metadata-poor",
            block_timestamp: 1_780_090_768_000,
            from: "TSubject111111111111111111111111111111",
            to: "TOtherDestination11111111111111111111",
            value: "100"
          }
        ],
        meta: {}
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn,
      retryAttempts: 0
    });

    const transfers = await client.listRelatedTrc20TransfersAllTokens("TSubject111111111111111111111111111111", {
      start: 0,
      limit: 10
    });

    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({
      transaction_id: "fallback-wrapped-token",
      contract_address: wrappedTokenAddress,
      tokenInfo: {
        tokenAbbr: "WRAPPED",
        tokenDecimal: 8,
        tokenId: wrappedTokenAddress,
        tokenType: "trc20"
      }
    });
    expect(transfers[1]).toMatchObject({
      transaction_id: "fallback-metadata-poor",
      from_address: "TSubject111111111111111111111111111111",
      to_address: "TOtherDestination11111111111111111111",
      quant: "100"
    });
    expect(transfers[1].contract_address).toBeUndefined();
    expect(transfers[1].tokenInfo).toBeUndefined();
  });

  it("requests transaction history and returns the data array", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: [{ hash: "tx1" }] }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const transactions = await client.listTransactions("TSubject111111111111111111111111111111", {
      start: 25,
      limit: 20,
      minTimestamp: 1_735_689_600_000,
      endTimestamp: 1_735_700_000_000
    });

    expect(transactions).toEqual([{ hash: "tx1" }]);
    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/transaction");
    expect(url.searchParams.get("address")).toBe("TSubject111111111111111111111111111111");
    expect(url.searchParams.get("sort")).toBe("-timestamp");
    expect(url.searchParams.get("start")).toBe("25");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("start_timestamp")).toBe("1735689600000");
    expect(url.searchParams.get("end_timestamp")).toBe("1735700000000");
  });

  it("requests current TRC20 approval list for an address", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        total: 1,
        contractMap: { TSpender11111111111111111111111111111: false },
        normalAddressInfo: { TSpender11111111111111111111111111111: { risk: false } },
        data: [
          {
            amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
            unlimited: true,
            from_address: "TOwner1111111111111111111111111111111",
            to_address: "TSpender11111111111111111111111111111",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            operate_time: 1778322840000,
            tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenDecimal: 6, tokenType: "trc20" }
          }
        ]
      })
    );
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const result = await client.listTrc20Approvals("TOwner1111111111111111111111111111111", {
      start: 10,
      limit: 5
    });

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toMatchObject({
      ownerAddress: "TOwner1111111111111111111111111111111",
      spenderAddress: "TSpender11111111111111111111111111111",
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      isUnlimited: true,
      operateTime: new Date(1778322840000),
      spenderIsContract: false
    });
    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/account/approve/list");
    expect(url.searchParams.get("address")).toBe("TOwner1111111111111111111111111111111");
    expect(url.searchParams.get("start")).toBe("10");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("type")).toBe("token");
  });

  it("[REQ-19][ALLOWANCE-REFRESH] reads exact official-USDT allowance with canonical ABI words", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({
      result: { result: true },
      constant_result: ["000000000000000000000000000000000000000000000000000000000000007b"]
    }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fullNodeApiKey: "fullnode-secret",
      fetchFn
    });

    await expect(client.getUsdtAllowance({
      ownerAddress: "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ",
      spenderAddress: "TXka46PPwttNPWfFDPtt3GUodbPThyufaV"
    })).resolves.toBe("123");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/wallet/triggerconstantcontract");
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("fullnode-secret");
    expect(JSON.parse(String(init.body))).toEqual({
      owner_address: "41dddddddddddddddddddddddddddddddddddddddd",
      contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
      function_selector: "allowance(address,address)",
      parameter:
        "000000000000000000000000dddddddddddddddddddddddddddddddddddddddd" +
        "000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    });
  });

  it("[REQ-20][AC-20][TASK7-USDT-BALANCE] reads an exact official-USDT balance with canonical subject binding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    try {
      const fetchFn = vi.fn(async () => jsonResponse({
        result: { result: true },
        constant_result: ["0000000000000000000000000000000000000000000000000000000003e4f980"]
      }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fullNodeBaseUrl: "https://api.trongrid.io",
        fullNodeApiKey: "fullnode-secret",
        fetchFn
      });

      await expect(client.getUsdtBalance("TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ")).resolves.toEqual({
        subjectAddress: "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ",
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        balanceRaw: "65337728",
        checkedAt: new Date("2026-07-17T12:00:00.000Z"),
        source: "official_usdt_balanceOf"
      });

      const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.pathname).toBe("/wallet/triggerconstantcontract");
      expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("fullnode-secret");
      expect(JSON.parse(String(init.body))).toMatchObject({
        owner_address: "41dddddddddddddddddddddddddddddddddddddddd",
        contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
        function_selector: "balanceOf(address)",
        parameter: "000000000000000000000000dddddddddddddddddddddddddddddddddddddddd"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["missing result", { result: { result: true }, constant_result: [] }],
    ["non-hex result", { result: { result: true }, constant_result: ["not-hex"] }],
    ["multiword result", { result: { result: true }, constant_result: ["0".repeat(64), "1".repeat(64)] }],
    ["overflow result", { result: { result: true }, constant_result: ["1" + "0".repeat(64)] }]
  ])("[REQ-20][AC-20][TASK7-USDT-BALANCE-FAIL-CLOSED] rejects %s as a malformed official-USDT balance", async (_name, response) => {
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse(response))
    });

    await expect(client.getUsdtBalance("TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ"))
      .rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("[REQ-20][AC-20][TASK7-USDT-BALANCE-FAIL-CLOSED] exposes a reverted official-USDT balance call as a typed failure", async () => {
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse({ result: { result: false, message: "REVERT" } }))
    });

    await expect(client.getUsdtBalance("TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ"))
      .rejects.toMatchObject({ code: "CONTRACT_REVERTED" });
  });

  it("[REQ-20][AC-20][TASK7-USDT-BALANCE-FAIL-CLOSED] propagates official-USDT balance provider failures", async () => {
    const providerError = Object.assign(new Error("full node unavailable"), { code: "PROVIDER_UNAVAILABLE" });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => { throw providerError; })
    });

    await expect(client.getUsdtBalance("TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ")).rejects.toBe(providerError);
  });

  it("[REQ-20][AC-20][TASK7-USDT-BALANCE-BOUNDED] aborts a presentation balance request once without provider retries", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn,
        retryAttempts: 3,
        timeoutMs: 10_000
      });

      const balance = client.getUsdtBalance("TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ", {
        timeoutMs: 25,
        retryAttempts: 0
      });
      const rejection = expect(balance).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["missing result", { result: { result: true }, constant_result: [] }],
    ["non-hex result", { result: { result: true }, constant_result: ["not-hex"] }],
    ["multiword result", { result: { result: true }, constant_result: ["0".repeat(64), "1".repeat(64)] }],
    ["overflow result", { result: { result: true }, constant_result: ["1" + "0".repeat(64)] }]
  ])("[REQ-19][ALLOWANCE-REFRESH] rejects %s as malformed allowance", async (_name, response) => {
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse(response))
    });

    await expect(client.getUsdtAllowance({
      ownerAddress: "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ",
      spenderAddress: "TXka46PPwttNPWfFDPtt3GUodbPThyufaV"
    })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("[REQ-19][ALLOWANCE-REFRESH] validates both TRON addresses before the full-node call", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.getUsdtAllowance({
      ownerAddress: "wrong-network",
      spenderAddress: "TXka46PPwttNPWfFDPtt3GUodbPThyufaV"
    })).rejects.toMatchObject({ code: "INVALID_TRON_ADDRESS" });
    await expect(client.getUsdtAllowance({
      ownerAddress: "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ",
      spenderAddress: "wrong-network"
    })).rejects.toMatchObject({ code: "INVALID_TRON_ADDRESS" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("[REQ-19][ALLOWANCE-REFRESH] exposes a reverted allowance call as a typed failure", async () => {
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse({ result: { result: false, message: "REVERT" } }))
    });

    await expect(client.getUsdtAllowance({
      ownerAddress: "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ",
      spenderAddress: "TXka46PPwttNPWfFDPtt3GUodbPThyufaV"
    })).rejects.toMatchObject({ code: "CONTRACT_REVERTED" });
  });

  it("requests TRC20 approval change history for a spender and token", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        total: 1,
        data: [
          {
            date_created: 1778094375000,
            unlimited: true,
            revert: false,
            owner_address: "TOwner1111111111111111111111111111111",
            to_address: "TSpender11111111111111111111111111111",
            type: "approve",
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            confirmed: true,
            contract_ret: "SUCCESS",
            amount_str: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
            from_address: "TOwner1111111111111111111111111111111",
            hash: "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2"
          }
        ]
      })
    );
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const result = await client.listTrc20ApprovalChanges({
      ownerAddress: "TOwner1111111111111111111111111111111",
      spenderAddress: "TSpender11111111111111111111111111111",
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      start: 0,
      limit: 1
    });

    expect(result).toEqual([
      expect.objectContaining({
        txHash: "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2",
        ownerAddress: "TOwner1111111111111111111111111111111",
        spenderAddress: "TSpender11111111111111111111111111111",
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        isUnlimited: true,
        timestamp: new Date(1778094375000),
        confirmed: true
      })
    ]);
    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/account/approve/change");
    expect(url.searchParams.get("from_address")).toBe("TOwner1111111111111111111111111111111");
    expect(url.searchParams.get("to_address")).toBe("TSpender11111111111111111111111111111");
    expect(url.searchParams.get("contract_address")).toBe(TRON_USDT_CONTRACT_ADDRESS);
    expect(url.searchParams.get("type")).toBe("approve");
  });

  it("returns strict approval-change page cardinality before malformed rows are filtered", async () => {
    const validRow = {
      date_created: 1778094375000,
      unlimited: true,
      owner_address: "TOwner1111111111111111111111111111111",
      to_address: "TSpender11111111111111111111111111111",
      contract_address: TRON_USDT_CONTRACT_ADDRESS,
      confirmed: true,
      contract_ret: "SUCCESS",
      amount_str: "1000000",
      hash: "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2"
    };
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => jsonResponse({ total: 2, data: [validRow, { ...validRow, hash: null }] }))
    });

    const page = await client.listTrc20ApprovalChangePageStrict({
      ownerAddress: validRow.owner_address,
      spenderAddress: validRow.to_address,
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      start: 0,
      limit: 2
    });

    expect(page).toMatchObject({ rawCount: 2, malformedCount: 1, total: 2 });
    expect(page.changes).toHaveLength(1);
    await expect(client.listTrc20ApprovalChanges({
      ownerAddress: validRow.owner_address,
      spenderAddress: validRow.to_address,
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      start: 0,
      limit: 2
    })).resolves.toHaveLength(1);
  });

  it("does not retry malformed approval list responses", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: { bad: true } }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.listTrc20Approvals("TOwner1111111111111111111111111111111")).rejects.toThrow(
      "Tronscan approval list response data must be an array"
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws when transaction history data is not an array", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ data: { bad: true } }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 2,
      retryBaseDelayMs: 0
    });

    await expect(client.listTransactions("TSubject111111111111111111111111111111")).rejects.toThrow(
      "Tronscan transaction response data must be an array"
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries transient account responses through the shared request path", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ balance: "123" }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 1,
      retryBaseDelayMs: 0
    });

    await expect(client.getAccount("TSubject111111111111111111111111111111")).resolves.toEqual({ balance: "123" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("paginates and verifies the complete address-scoped USDT blacklist timeline", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => {
      const txHash = (index + 1).toString(16).padStart(64, "0");
      return {
        txHash,
        time: 1_700_000_000 + index,
        block: 60_000_000 + index,
        logIndex: index % 2,
        kind: (index % 2 === 0 ? "added" : "removed") as "added" | "removed"
      };
    });
    const byHash = new Map(rows.map((row) => [row.txHash, row]));
    const newestFirst = [...rows].reverse();
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = input as URL;
      if (url.pathname === "/api/stableCoin/blackList") {
        const start = Number(url.searchParams.get("start"));
        const limit = Number(url.searchParams.get("limit"));
        return jsonResponse({
          total: rows.length,
          data: newestFirst.slice(start, start + limit).map((row) => blacklistProviderRow(row.txHash, row.time))
        });
      }
      if (url.pathname === "/api/transaction-info") {
        const row = byHash.get(String(url.searchParams.get("hash")));
        return jsonResponse(row ? confirmedBlacklistTransaction(row.txHash, row.time, row.block) : {});
      }
      const txHash = url.pathname.match(/^\/v1\/transactions\/([0-9a-f]{64})\/events$/)?.[1];
      const row = txHash ? byHash.get(txHash) : null;
      return jsonResponse({
        data: row ? [blacklistContractEvent(row.txHash, row.time, row.block, row.logIndex, row.kind)] : []
      });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      apiKey: "tronscan-secret",
      fullNodeApiKey: "fullnode-secret",
      fetchFn
    });

    const result = await client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS, {
      limit: 20,
      currentState: true
    });

    expect(result).toEqual({
      events: rows.map((row) => ({
        eventKind: row.kind,
        occurredAt: new Date(row.time * 1000).toISOString(),
        txHash: row.txHash,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        blockNumber: row.block,
        logIndex: row.logIndex,
        verification: "verified_contract_log"
      })),
      pagination: "complete",
      failureReason: null
    });
    const pageCalls = (fetchFn.mock.calls as unknown as Array<[URL, RequestInit]>)
      .filter(([url]) => url.pathname === "/api/stableCoin/blackList");
    expect(pageCalls.map(([url]) => url.searchParams.get("start"))).toEqual(["0", "20"]);
    for (const [url, init] of pageCalls) {
      expect(url.searchParams.get("blackAddress")).toBe(BLACKLIST_ADDRESS);
      expect(url.searchParams.get("tokenAddress")).toBe(TRON_USDT_CONTRACT_ADDRESS);
      expect(url.searchParams.get("sort")).toBe("2");
      expect(url.searchParams.get("direction")).toBe("2");
      expect(url.searchParams.get("limit")).toBe("20");
      expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("tronscan-secret");
    }
    const eventCalls = (fetchFn.mock.calls as unknown as Array<[URL, RequestInit]>)
      .filter(([url]) => url.pathname.endsWith("/events"));
    expect(eventCalls).toHaveLength(21);
    expect(eventCalls.every(([, init]) => headerValue(init.headers, "TRON-PRO-API-KEY") === "fullnode-secret")).toBe(true);
  });

  it.each([
    ["fully repeated", (rows: Array<{ txHash: string; time: number; block: number }>) => rows.slice(20, 40)],
    ["partially overlapping", (rows: Array<{ txHash: string; time: number; block: number }>) => rows.slice(10, 30)]
  ] as const)("returns partial provider failure when the second blacklist page is %s", async (_name, secondPage) => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      txHash: (index + 1).toString(16).padStart(64, "0"),
      time: 1_700_100_000 + index,
      block: 61_000_000 + index
    }));
    const byHash = new Map(rows.map((row) => [row.txHash, row]));
    const pages = [rows.slice(20, 40), secondPage(rows)];
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = input as URL;
      if (url.pathname === "/api/stableCoin/blackList") {
        const pageIndex = Number(url.searchParams.get("start")) === 0 ? 0 : 1;
        return jsonResponse({
          total: 40,
          data: pages[pageIndex].map((row) => blacklistProviderRow(row.txHash, row.time))
        });
      }
      if (url.pathname === "/api/transaction-info") {
        const row = byHash.get(String(url.searchParams.get("hash")))!;
        return jsonResponse(confirmedBlacklistTransaction(row.txHash, row.time, row.block));
      }
      const txHash = url.pathname.split("/")[3];
      const row = byHash.get(txHash)!;
      return jsonResponse({ data: [blacklistContractEvent(row.txHash, row.time, row.block, 0)] });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn
    });

    const result = await client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS, { limit: 20 });

    expect(result).toMatchObject({ pagination: "partial", failureReason: "provider_failed" });
    expect(new Set(result.events.map((event) => event.txHash)).size).toBe(result.events.length);
    expect(result.events.length).toBeLessThan(40);
    expect((fetchFn.mock.calls as unknown as Array<[URL, RequestInit]>).filter(
      ([url]) => url.pathname === "/api/stableCoin/blackList"
    )).toHaveLength(2);
  });

  it("bounds the blacklist provider page size to its documented maximum", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ total: 0, data: [] }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS, { limit: 500 })).resolves.toEqual({
      events: [],
      pagination: "complete",
      failureReason: null
    });
    const [url] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it.each([
    ["address_mismatch", { blackAddress: OTHER_ADDRESS }],
    ["wrong_contract", { contractAddress: OTHER_ADDRESS }]
  ] as const)("returns partial %s evidence for a mismatched provider row", async (failureReason, overrides) => {
    const txHash = "a".repeat(64);
    const fetchFn = vi.fn(async () => jsonResponse({
      total: 1,
      data: [blacklistProviderRow(txHash, 1_700_000_000, overrides)]
    }));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS)).resolves.toEqual({
      events: [],
      pagination: "partial",
      failureReason
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns partial transaction_unconfirmed evidence when a listed transaction is not final", async () => {
    const txHash = "b".repeat(64);
    const time = 1_700_000_001;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ total: 1, data: [blacklistProviderRow(txHash, time)] }))
      .mockResolvedValueOnce(jsonResponse(confirmedBlacklistTransaction(txHash, time, 60_000_001, { confirmed: false })));
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    await expect(client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS)).resolves.toEqual({
      events: [],
      pagination: "partial",
      failureReason: "transaction_unconfirmed"
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns partial event_log_unverified evidence for a wrong transaction-scoped log", async () => {
    const txHash = "c".repeat(64);
    const time = 1_700_000_002;
    const block = 60_000_002;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ total: 1, data: [blacklistProviderRow(txHash, time)] }))
      .mockResolvedValueOnce(jsonResponse(confirmedBlacklistTransaction(txHash, time, block)))
      .mockResolvedValueOnce(jsonResponse({ data: [blacklistContractEvent(txHash, time, block, 0, "added", {
        contract_address: OTHER_ADDRESS
      })] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn
    });

    await expect(client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS)).resolves.toEqual({
      events: [],
      pagination: "partial",
      failureReason: "event_log_unverified"
    });
  });

  it("uses verified block and log order for removal and re-add events sharing one Unix second", async () => {
    const time = 1_700_000_003;
    const history = [
      { txHash: "d".repeat(64), block: 60_000_003, logIndex: 0, kind: "added" as const },
      { txHash: "e".repeat(64), block: 60_000_004, logIndex: 1, kind: "removed" as const },
      { txHash: "f".repeat(64), block: 60_000_004, logIndex: 2, kind: "added" as const }
    ];
    const byHash = new Map(history.map((item) => [item.txHash, item]));
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = input as URL;
      if (url.pathname === "/api/stableCoin/blackList") {
        return jsonResponse({ total: 3, data: [...history].reverse().map((item) => blacklistProviderRow(item.txHash, time)) });
      }
      if (url.pathname === "/api/transaction-info") {
        const item = byHash.get(String(url.searchParams.get("hash")))!;
        return jsonResponse(confirmedBlacklistTransaction(item.txHash, time, item.block));
      }
      const txHash = url.pathname.split("/")[3];
      const item = byHash.get(txHash)!;
      return jsonResponse({ data: [blacklistContractEvent(item.txHash, time, item.block, item.logIndex, item.kind)] });
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn
    });

    const result = await client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS, { currentState: true });

    expect(result.pagination).toBe("complete");
    expect(result.events.map((event) => [event.eventKind, event.blockNumber, event.logIndex])).toEqual([
      ["added", 60_000_003, 0],
      ["removed", 60_000_004, 1],
      ["added", 60_000_004, 2]
    ]);
  });

  it("rejects truly ambiguous same-timestamp event ordering", async () => {
    const time = 1_700_000_004;
    const firstHash = "1".repeat(64);
    const secondHash = "2".repeat(64);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, data: [
        blacklistProviderRow(secondHash, time),
        blacklistProviderRow(firstHash, time)
      ] }))
      .mockResolvedValueOnce(jsonResponse(confirmedBlacklistTransaction(secondHash, time, 60_000_005)))
      .mockResolvedValueOnce(jsonResponse({ data: [blacklistContractEvent(secondHash, time, 60_000_005, 0, "removed")] }))
      .mockResolvedValueOnce(jsonResponse(confirmedBlacklistTransaction(firstHash, time, 60_000_005)))
      .mockResolvedValueOnce(jsonResponse({ data: [blacklistContractEvent(firstHash, time, 60_000_005, 0, "added")] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn
    });

    await expect(client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS)).resolves.toMatchObject({
      pagination: "partial",
      failureReason: "event_log_unverified"
    });
  });

  it("keeps current contract state authoritative when reconstructed history disagrees", async () => {
    const txHash = "3".repeat(64);
    const time = 1_700_000_005;
    const block = 60_000_006;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ total: 1, data: [blacklistProviderRow(txHash, time)] }))
      .mockResolvedValueOnce(jsonResponse(confirmedBlacklistTransaction(txHash, time, block)))
      .mockResolvedValueOnce(jsonResponse({ data: [blacklistContractEvent(txHash, time, block, 0, "removed")] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn
    });

    await expect(client.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS, { currentState: true })).resolves.toEqual({
      events: [{
        eventKind: "removed",
        occurredAt: new Date(time * 1000).toISOString(),
        txHash,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        blockNumber: block,
        logIndex: 0,
        verification: "verified_contract_log"
      }],
      pagination: "partial",
      failureReason: "state_timeline_inconsistent"
    });
  });

  it("never turns incomplete pagination or exhausted provider errors into an empty complete timeline", async () => {
    const incompleteFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, data: [] }));
    const incompleteClient = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn: incompleteFetch });
    await expect(incompleteClient.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS)).resolves.toEqual({
      events: [],
      pagination: "partial",
      failureReason: "provider_failed"
    });

    const failedFetch = vi.fn(async () => jsonResponse({ error: "unavailable" }, { status: 503 }));
    const failedClient = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: failedFetch,
      retryAttempts: 1,
      retryBaseDelayMs: 0
    });
    await expect(failedClient.getUsdtBlacklistTimeline(BLACKLIST_ADDRESS)).resolves.toEqual({
      events: [],
      pagination: "partial",
      failureReason: "provider_failed"
    });
    expect(failedFetch).toHaveBeenCalledTimes(2);
  });

  it("reads TRON USDT blacklist state, balance, and verified timeline from authoritative sources", async () => {
    const txHash = "4".repeat(64);
    const time = 1_779_518_958;
    const block = 82_950_110;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["0000000000000000000000000000000000000000000000000000000000000001"]
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["000000000000000000000000000000000000000000000000000002674ff0d3f0"]
      }))
      .mockResolvedValueOnce(jsonResponse({
        total: 1,
        data: [blacklistProviderRow(txHash, time)]
      }))
      .mockResolvedValueOnce(jsonResponse(confirmedBlacklistTransaction(txHash, time, block)))
      .mockResolvedValueOnce(jsonResponse({ data: [blacklistContractEvent(txHash, time, block, 0)] }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fullNodeApiKey: "fullnode-secret",
      fetchFn
    });

    const result = await client.getUsdtRestrictionStatus("TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm", {
      includeEventTimeline: true
    });

    expect(result).toMatchObject({
      subjectAddress: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm",
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: true,
      balanceRaw: "2642746070000",
      evidenceStrength: "exact_contract_state",
      blacklistEventTxHash: txHash,
      blacklistEventTimestamp: "2026-05-23T06:49:18.000Z",
      blacklistEventBlock: 82950110
    });
    expect(result.blacklistTimeline).toMatchObject({
      pagination: "complete",
      failureReason: null,
      events: [{ eventKind: "added", txHash, blockNumber: block, logIndex: 0 }]
    });
    expect(fetchFn).toHaveBeenCalledTimes(5);
    const [blacklistUrl, blacklistInit] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(blacklistUrl.pathname).toBe("/wallet/triggerconstantcontract");
    expect(headerValue(blacklistInit.headers, "TRON-PRO-API-KEY")).toBe("fullnode-secret");
    expect(JSON.parse(String(blacklistInit.body))).toMatchObject({
      function_selector: "isBlackListed(address)",
      contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"
    });
    const [historyUrl] = fetchFn.mock.calls[2] as unknown as [URL, RequestInit];
    expect(historyUrl.pathname).toBe("/api/stableCoin/blackList");
    const [eventUrl] = fetchFn.mock.calls[4] as unknown as [URL, RequestInit];
    expect(eventUrl.pathname).toBe(`/v1/transactions/${txHash}/events`);
  });

  it("does not fetch a timeline for an inactive current blacklist state", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["0".repeat(64)]
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["0".repeat(64)]
      }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fetchFn
    });

    const result = await client.getUsdtRestrictionStatus(BLACKLIST_ADDRESS, { includeEventTimeline: true });

    expect(result).toMatchObject({ isBlacklisted: false, blacklistTimeline: null });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls as unknown as Array<[URL, RequestInit]>).map(([url]) => url.pathname)).not.toContain(
      "/api/stableCoin/blackList"
    );
  });

  it("keeps blacklist event lookup out of the default status path", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["0000000000000000000000000000000000000000000000000000000000000001"]
      }))
      .mockResolvedValueOnce(jsonResponse({
      result: { result: true },
      constant_result: ["00000000000000000000000000000000000000000000000000000267536349f0"]
      }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      fullNodeApiKey: "fullnode-secret",
      fetchFn
    });

    const result = await client.getUsdtRestrictionStatus("TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm");

    expect(result).toMatchObject({
      isBlacklisted: true,
      balanceRaw: "2642803902960",
      blacklistEventTxHash: null,
      blacklistEventTimestamp: null,
      blacklistEventBlock: null
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls as unknown as Array<[URL, RequestInit]>).map(([url]) => url.pathname)).not.toContain(
      `/v1/contracts/${TRON_USDT_CONTRACT_ADDRESS}/events`
    );
  });

  it("does not send the TronScan API key to the full node contract-state endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["0000000000000000000000000000000000000000000000000000000000000000"]
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: { result: true },
        constant_result: ["0000000000000000000000000000000000000000000000000000000000000000"]
      }));
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fullNodeBaseUrl: "https://api.trongrid.io",
      apiKey: "tronscan-secret",
      fetchFn
    });

    await client.getUsdtRestrictionStatus("TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm");

    const [, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBeNull();
  });

  it("honors cooldown for full node contract-state retries after 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
        .mockResolvedValueOnce(jsonResponse({
          result: { result: true },
          constant_result: ["0000000000000000000000000000000000000000000000000000000000000000"]
        }))
        .mockResolvedValueOnce(jsonResponse({
          result: { result: true },
          constant_result: ["0000000000000000000000000000000000000000000000000000000000000000"]
        }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fullNodeBaseUrl: "https://api.trongrid.io",
        fetchFn,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        rateLimitCooldownMs: 100
      });

      const result = client.getUsdtRestrictionStatus("TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm");

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ isBlacklisted: false, balanceRaw: "0" });
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not distribute fixed full-node contract-state calls across TronScan API-key slots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      const fetchFn = vi.fn(async () => jsonResponse({
        result: { result: true },
        constant_result: ["0000000000000000000000000000000000000000000000000000000000000000"]
      }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fullNodeBaseUrl: "https://api.trongrid.io",
        apiKey: ["tronscan-a", "tronscan-b"],
        fullNodeApiKey: "fullnode-secret",
        fetchFn,
        requestMinIntervalMs: 100
      });

      const first = client.getUsdtRestrictionStatus("TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm");
      const second = client.getUsdtRestrictionStatus("TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm");

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(300);
      await Promise.all([first, second]);
      expect(fetchFn).toHaveBeenCalledTimes(4);
      const headers = fetchFn.mock.calls.map((call) =>
        headerValue(((call as unknown as [URL, RequestInit])[1]).headers, "TRON-PRO-API-KEY")
      );
      expect(headers).toEqual(["fullnode-secret", "fullnode-secret", "fullnode-secret", "fullnode-secret"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces concurrent requests through a shared in-process limiter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      const fetchFn = vi.fn(async () => jsonResponse({ balance: "123" }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn,
        requestMinIntervalMs: 100
      });

      const first = client.getAccount("TSubject111111111111111111111111111111");
      const second = client.getAccount("TSubject222222222222222222222222222222");

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([first, second]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a cooldown after 429 before retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
        .mockResolvedValueOnce(jsonResponse({ balance: "123" }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        rateLimitCooldownMs: 100,
        logger: {
          info: (event, fields) => logs.push({ event, fields }),
          warn: (event, fields) => logs.push({ event, fields }),
          error: (event, fields) => logs.push({ event, fields })
        }
      });

      const result = client.getAccount("TSubject111111111111111111111111111111");

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const cooldownLog = logs.find((log) => log.event === "tronscan_rate_limit_cooldown");
      expect(cooldownLog?.fields).toMatchObject({
        request_name: "account",
        endpoint_bucket: "default",
        api_key_index: null,
        cooldown_ms: 100
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ balance: "123" });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors cooldown for transaction-info retries after 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
        .mockResolvedValueOnce(jsonResponse({ hash: "tx1" }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fetchFn,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        rateLimitCooldownMs: 100
      });

      const result = client.getTransaction("tx1");

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(99);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ hash: "tx1" });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not apply a TronScan transaction-info cooldown to true fullnode transaction calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      let transactionInfoAttempts = 0;
      const calls: Array<{ path: string; apiKey: string | null }> = [];
      const fetchFn = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input as URL;
        calls.push({ path: url.pathname, apiKey: headerValue(init?.headers, "TRON-PRO-API-KEY") });
        if (url.pathname === "/api/transaction-info" && transactionInfoAttempts++ === 0) {
          return jsonResponse({ error: "rate limited" }, { status: 429 });
        }
        return jsonResponse(url.pathname === "/api/transaction-info" ? { hash: "tx1" } : {});
      });
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fullNodeBaseUrl: "https://api.trongrid.io",
        apiKey: "tronscan-key",
        fullNodeApiKey: "fullnode-key",
        fetchFn,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        rateLimitCooldownMs: 100
      });

      const transactionInfo = client.getTransaction("tx1");
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual([{ path: "/api/transaction-info", apiKey: "tronscan-key" }]);

      const fullnodeTransaction = client.getTransactionSigningMetadata("raw-tx");
      await vi.advanceTimersByTimeAsync(0);
      expect(calls[1]).toEqual({ path: "/wallet/gettransactionbyid", apiKey: "fullnode-key" });
      await expect(fullnodeTransaction).resolves.toBeNull();

      await vi.advanceTimersByTimeAsync(100);
      await expect(transactionInfo).resolves.toEqual({ hash: "tx1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not apply a true fullnode transaction cooldown to TronScan transaction-info calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      let fullnodeAttempts = 0;
      const calls: Array<{ path: string; apiKey: string | null }> = [];
      const fetchFn = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input as URL;
        calls.push({ path: url.pathname, apiKey: headerValue(init?.headers, "TRON-PRO-API-KEY") });
        if (url.pathname === "/wallet/gettransactionbyid" && fullnodeAttempts++ === 0) {
          return jsonResponse({ error: "rate limited" }, { status: 429 });
        }
        return jsonResponse(url.pathname === "/api/transaction-info" ? { hash: "tx1" } : {});
      });
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        fullNodeBaseUrl: "https://api.trongrid.io",
        apiKey: "tronscan-key",
        fullNodeApiKey: "fullnode-key",
        fetchFn,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        rateLimitCooldownMs: 100
      });

      const fullnodeTransaction = client.getTransactionSigningMetadata("raw-tx");
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual([{ path: "/wallet/gettransactionbyid", apiKey: "fullnode-key" }]);

      const transactionInfo = client.getTransaction("tx1");
      await vi.advanceTimersByTimeAsync(0);
      expect(calls[1]).toEqual({ path: "/api/transaction-info", apiKey: "tronscan-key" });
      await expect(transactionInfo).resolves.toEqual({ hash: "tx1" });

      await vi.advanceTimersByTimeAsync(100);
      await expect(fullnodeTransaction).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries with another API-key slot after one key receives 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    try {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
        .mockResolvedValueOnce(jsonResponse({ balance: "123" }));
      const client = new TronscanClient({
        baseUrl: "https://apilist.tronscanapi.com",
        apiKey: ["key-a", "key-b"],
        fetchFn,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        rateLimitCooldownMs: 10_000
      });

      const result = client.getAccount("TSubject111111111111111111111111111111");

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ balance: "123" });

      const headers = fetchFn.mock.calls.map((call) =>
        headerValue(((call as unknown as [URL, RequestInit])[1]).headers, "TRON-PRO-API-KEY")
      );
      expect(headers).toEqual(["key-a", "key-b"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
