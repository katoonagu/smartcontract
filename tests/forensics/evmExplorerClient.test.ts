import { describe, expect, it, vi } from "vitest";
import {
  createEtherscanV2EvmEvidenceProvider,
  EvmExplorerError
} from "../../src/forensics/evmExplorerClient";

const apiKey = "etherscan-secret-key";

type FetchCall = {
  url: URL;
  init: RequestInit | undefined;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(init.headers).entries())
    }
  });
}

function fetchQueue(...responses: Response[]): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL
      ? new URL(input.href)
      : typeof input === "string"
        ? new URL(input)
        : new URL(input.url);
    calls.push({ url, init });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    return response;
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function explorer(fetchImpl: typeof fetch, maxPagesPerQuery = 5) {
  return createEtherscanV2EvmEvidenceProvider({
    apiKey,
    baseUrl: new URL("https://api.etherscan.example/v2/api"),
    timeoutMs: 1_000,
    maxPagesPerQuery,
    fetchImpl
  });
}

function ok(result: unknown): Response {
  return jsonResponse({ status: "1", message: "OK", result });
}

describe("Etherscan V2 EVM evidence provider", () => {
  it("maps ethereum queries to chainid 1", async () => {
    const { fetchImpl, calls } = fetchQueue(ok([]));

    await explorer(fetchImpl).listNormalTransactions({ chain: "ethereum", address: "0xWallet" });

    expect(calls[0]!.url.pathname).toBe("/v2/api");
    expect(calls[0]!.url.searchParams.get("chainid")).toBe("1");
    expect(calls[0]!.url.searchParams.get("module")).toBe("account");
    expect(calls[0]!.url.searchParams.get("action")).toBe("txlist");
    expect(calls[0]!.url.searchParams.get("address")).toBe("0xWallet");
    expect(calls[0]!.url.searchParams.get("apikey")).toBe(apiKey);
  });

  it("maps arbitrum queries to chainid 42161", async () => {
    const { fetchImpl, calls } = fetchQueue(ok([]));

    await explorer(fetchImpl).listInternalTransactions({ chain: "arbitrum", address: "0xWallet" });

    expect(calls[0]!.url.searchParams.get("chainid")).toBe("42161");
    expect(calls[0]!.url.searchParams.get("action")).toBe("txlistinternal");
  });

  it("passes BSC chainid 56 to Etherscan V2 account requests", async () => {
    const calls: string[] = [];
    const provider = createEtherscanV2EvmEvidenceProvider({
      apiKey: "test-key",
      baseUrl: new URL("https://api.etherscan.io/v2/api"),
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ status: "0", message: "No transactions found", result: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    await provider.listErc20Transfers({
      chain: "bsc",
      address: "0x3c38a410a09539b9bdeea3e5723dbf68c2d282da",
      pageLimit: 1,
      offset: 1
    });

    expect(calls[0]).toContain("chainid=56");
  });

  it("normalizes txlist normal transactions", async () => {
    const { fetchImpl } = fetchQueue(ok([{
      blockNumber: "123",
      timeStamp: "1700000000",
      hash: "0xhash",
      nonce: "7",
      blockHash: "0xblock",
      transactionIndex: "2",
      from: "0xfrom",
      to: "0xto",
      value: "1000000000000000000",
      gas: "21000",
      gasPrice: "1000000000",
      isError: "0",
      txreceipt_status: "1",
      input: "0x",
      contractAddress: "",
      cumulativeGasUsed: "21000",
      gasUsed: "21000",
      confirmations: "12",
      methodId: "0xa9059cbb",
      functionName: "transfer(address,uint256)"
    }]));

    await expect(explorer(fetchImpl).listNormalTransactions({ chain: "ethereum", address: "0xfrom" }))
      .resolves.toEqual([{
        chain: "ethereum",
        blockNumber: "123",
        timeStamp: "1700000000",
        hash: "0xhash",
        nonce: "7",
        blockHash: "0xblock",
        transactionIndex: "2",
        from: "0xfrom",
        to: "0xto",
        value: "1000000000000000000",
        gas: "21000",
        gasPrice: "1000000000",
        isError: "0",
        txReceiptStatus: "1",
        input: "0x",
        contractAddress: "",
        cumulativeGasUsed: "21000",
        gasUsed: "21000",
        confirmations: "12",
        methodId: "0xa9059cbb",
        functionName: "transfer(address,uint256)"
      }]);
  });

  it("normalizes txlistinternal internal transfers", async () => {
    const { fetchImpl } = fetchQueue(ok([{
      blockNumber: "456",
      timeStamp: "1700000100",
      hash: "0xinternal",
      from: "0xsender",
      to: "0xrecipient",
      value: "500000000000000000",
      contractAddress: "",
      input: "0x",
      type: "call",
      gas: "30000",
      gasUsed: "21000",
      traceId: "0_1",
      isError: "0",
      errCode: ""
    }]));

    await expect(explorer(fetchImpl).listInternalTransactions({ chain: "arbitrum", address: "0xsender" }))
      .resolves.toEqual([{
        chain: "arbitrum",
        blockNumber: "456",
        timeStamp: "1700000100",
        hash: "0xinternal",
        from: "0xsender",
        to: "0xrecipient",
        value: "500000000000000000",
        contractAddress: "",
        input: "0x",
        type: "call",
        gas: "30000",
        gasUsed: "21000",
        traceId: "0_1",
        isError: "0",
        errCode: ""
      }]);
  });

  it("normalizes tokentx ERC20 transfers", async () => {
    const { fetchImpl, calls } = fetchQueue(ok([{
      blockNumber: "789",
      timeStamp: "1700000200",
      hash: "0xtoken",
      nonce: "9",
      blockHash: "0xtokenblock",
      from: "0xfrom",
      contractAddress: "0xtokencontract",
      to: "0xto",
      value: "1000000",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      transactionIndex: "4",
      gas: "65000",
      gasPrice: "100000000",
      gasUsed: "51234",
      cumulativeGasUsed: "90000",
      input: "deprecated",
      confirmations: "15"
    }]));

    await expect(explorer(fetchImpl).listErc20Transfers({
      chain: "ethereum",
      address: "0xfrom",
      contractAddress: "0xtokencontract"
    })).resolves.toEqual([{
      chain: "ethereum",
      blockNumber: "789",
      timeStamp: "1700000200",
      hash: "0xtoken",
      nonce: "9",
      blockHash: "0xtokenblock",
      from: "0xfrom",
      contractAddress: "0xtokencontract",
      to: "0xto",
      value: "1000000",
      tokenName: "Tether USD",
      tokenSymbol: "USDT",
      tokenDecimal: "6",
      transactionIndex: "4",
      gas: "65000",
      gasPrice: "100000000",
      gasUsed: "51234",
      cumulativeGasUsed: "90000",
      input: "deprecated",
      confirmations: "15"
    }]);
    expect(calls[0]!.url.searchParams.get("contractaddress")).toBe("0xtokencontract");
    expect(calls[0]!.url.searchParams.get("action")).toBe("tokentx");
  });

  it("returns normalized receipt logs", async () => {
    const receiptLog = {
      address: "0xpool",
      topics: ["0xtopic0", "0xtopic1"],
      data: "0xdata",
      blockNumber: "0x10",
      transactionHash: "0xreceipt",
      transactionIndex: "0x1",
      blockHash: "0xblock",
      logIndex: "0x2",
      removed: false
    };
    const { fetchImpl, calls } = fetchQueue(jsonResponse({
      jsonrpc: "2.0",
      id: 1,
      result: {
        transactionHash: "0xreceipt",
        blockHash: "0xblock",
        blockNumber: "0x10",
        transactionIndex: "0x1",
        from: "0xfrom",
        to: "0xto",
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        contractAddress: null,
        logs: [receiptLog],
        status: "0x1",
        logsBloom: "0xbloom"
      }
    }));

    await expect(explorer(fetchImpl).getTransactionReceipt({ chain: "ethereum", txHash: "0xreceipt" }))
      .resolves.toMatchObject({
        chain: "ethereum",
        transactionHash: "0xreceipt",
        logs: [{
          chain: "ethereum",
          address: "0xpool",
          topics: ["0xtopic0", "0xtopic1"],
          data: "0xdata",
          blockNumber: "0x10",
          transactionHash: "0xreceipt",
          transactionIndex: "0x1",
          blockHash: "0xblock",
          logIndex: "0x2",
          removed: false
        }]
      });
    expect(calls[0]!.url.searchParams.get("module")).toBe("proxy");
    expect(calls[0]!.url.searchParams.get("action")).toBe("eth_getTransactionReceipt");
    expect(calls[0]!.url.searchParams.get("txhash")).toBe("0xreceipt");
  });

  it("returns getLogs logs when available", async () => {
    const { fetchImpl, calls } = fetchQueue(ok([{
      address: "0xpool",
      topics: ["0xtopic0"],
      data: "0xdata",
      blockNumber: "0x20",
      transactionHash: "0xlogtx",
      transactionIndex: "0x0",
      blockHash: "0xblock",
      logIndex: "0x1",
      removed: false
    }]));

    await expect(explorer(fetchImpl).getLogs({
      chain: "arbitrum",
      address: "0xpool",
      fromBlock: 100,
      toBlock: 200,
      topic0: "0xtopic0"
    })).resolves.toEqual([{
      chain: "arbitrum",
      address: "0xpool",
      topics: ["0xtopic0"],
      data: "0xdata",
      blockNumber: "0x20",
      transactionHash: "0xlogtx",
      transactionIndex: "0x0",
      blockHash: "0xblock",
      logIndex: "0x1",
      removed: false
    }]);
    expect(calls[0]!.url.searchParams.get("module")).toBe("logs");
    expect(calls[0]!.url.searchParams.get("action")).toBe("getLogs");
    expect(calls[0]!.url.searchParams.get("fromBlock")).toBe("100");
    expect(calls[0]!.url.searchParams.get("toBlock")).toBe("200");
    expect(calls[0]!.url.searchParams.get("topic0")).toBe("0xtopic0");
  });

  it("paginates account history newest-first and stops at the configured max pages", async () => {
    const { fetchImpl, calls } = fetchQueue(
      ok([{ blockNumber: "1", hash: "0x1", from: "0xa", to: "0xb", value: "1" }]),
      ok([{ blockNumber: "2", hash: "0x2", from: "0xa", to: "0xb", value: "2" }]),
      ok([{ blockNumber: "3", hash: "0x3", from: "0xa", to: "0xb", value: "3" }])
    );

    const transactions = await explorer(fetchImpl, 2).listNormalTransactions({
      chain: "ethereum",
      address: "0xa",
      offset: 1
    });

    expect(transactions.map((transaction) => transaction.hash)).toEqual(["0x1", "0x2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("page")).toBe("1");
    expect(calls[1]!.url.searchParams.get("page")).toBe("2");
    expect(calls[0]!.url.searchParams.get("offset")).toBe("1");
    expect(calls[0]!.url.searchParams.get("sort")).toBe("desc");
  });

  it("throws a clear error for malformed explorer responses", async () => {
    const { fetchImpl } = fetchQueue(jsonResponse({ status: "1", message: "OK", result: { bad: "shape" } }));

    await expect(explorer(fetchImpl).listNormalTransactions({ chain: "ethereum", address: "0xWallet" }))
      .rejects.toThrow("EVM explorer malformed response for txlist");
  });

  it("never includes the API key in thrown error messages", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network failed with ${apiKey}`);
    }) as unknown as typeof fetch;
    const error = await explorer(fetchImpl).listErc20Transfers({ chain: "ethereum", address: "0xWallet" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EvmExplorerError);
    expect(String((error as Error).message)).toBe("EVM explorer request failed for tokentx");
    expect(String((error as Error).message)).not.toContain(apiKey);
  });
});
