import { describe, expect, it, vi } from "vitest";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import { TronscanClient } from "../../src/tron/tronClient";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
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
    expect(headerValue(init.headers, "TRON-PRO-API-KEY")).toBe("secret");
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

  it("retries transient transfer responses and returns the successful retry", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
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
    expect(logs[1].fields).toMatchObject({ request_name: "transfer", attempt: 0, next_attempt: 1 });
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

  it("reads TRON USDT blacklist state and balance from the contract", async () => {
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
        data: [
          {
            event_name: "AddedBlackList",
            transaction_id: "tx-blacklist",
            block_timestamp: 1_779_518_958_000,
            block_number: 82_950_110,
            result: {
              _user: "0xde997eee7b6e10e9f25cd385d170592b80544e91"
            }
          }
        ]
      }));
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
      blacklistEventTxHash: "tx-blacklist",
      blacklistEventTimestamp: "2026-05-23T06:49:18.000Z",
      blacklistEventBlock: 82950110
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const [blacklistUrl, blacklistInit] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(blacklistUrl.pathname).toBe("/wallet/triggerconstantcontract");
    expect(headerValue(blacklistInit.headers, "TRON-PRO-API-KEY")).toBe("fullnode-secret");
    expect(JSON.parse(String(blacklistInit.body))).toMatchObject({
      function_selector: "isBlackListed(address)",
      contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"
    });
    const [eventUrl] = fetchFn.mock.calls[2] as unknown as [URL, RequestInit];
    expect(eventUrl.pathname).toBe(`/v1/contracts/${TRON_USDT_CONTRACT_ADDRESS}/events`);
    expect(eventUrl.searchParams.get("event_name")).toBe("AddedBlackList");
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
      expect(logs.some((log) => log.event === "tronscan_rate_limit_cooldown")).toBe(true);

      await vi.advanceTimersByTimeAsync(99);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ balance: "123" });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
