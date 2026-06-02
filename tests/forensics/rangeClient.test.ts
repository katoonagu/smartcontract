import { describe, expect, it, vi } from "vitest";
import {
  createRangeCrossChainDiscoveryProvider,
  RANGE_ENDPOINT_PATHS,
  RangeApiError,
  type RangeEndpointPaths
} from "../../src/forensics/rangeClient";

const apiKey = "range-secret-key";
const fetchedAt = "2026-06-01T00:00:00.000Z";

const endpointPaths = {
  transfersByTx: "/test/transfers-by-tx",
  transfersByAddress: "/test/transfers-by-address",
  addressRisk: "/test/address-risk"
} as const satisfies RangeEndpointPaths;

const rangeTransferItem = {
  id: "9359/AX/2352",
  time: "2026-05-05T02:41:59.000Z",
  type: "stargate",
  status: "SUCCEEDED",
  sender: {
    address: "0xSource",
    network: "ethereum",
    token: { symbol: "USDT", amount_raw: "100000000000", decimals: 6 }
  },
  receiver: {
    address: "TReceiver",
    network: "tron",
    token: { symbol: "USDT", amount_raw: "100000000000", decimals: 6 }
  },
  sender_tx_hash: "0xabc",
  receiver_tx_hash: "tron-tx"
};

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

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
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

function provider(fetchImpl: typeof fetch, paths: RangeEndpointPaths = endpointPaths) {
  return createRangeCrossChainDiscoveryProvider({
    apiKey,
    baseUrl: new URL("https://api.range.example"),
    timeoutMs: 1_000,
    endpointPaths: paths,
    allowUndocumentedRawAmountFields: true,
    fetchImpl,
    now: () => new Date(fetchedAt)
  });
}

function liveDefaultProvider(fetchImpl: typeof fetch) {
  return createRangeCrossChainDiscoveryProvider({
    apiKey,
    baseUrl: new URL("https://api.range.example"),
    timeoutMs: 1_000,
    endpointPaths,
    fetchImpl,
    now: () => new Date(fetchedAt)
  });
}

function headerValue(call: FetchCall, name: string): string | null {
  return new Headers(call.init?.headers).get(name);
}

describe("Range cross-chain discovery provider", () => {
  it("exports the official production endpoint paths", () => {
    expect(RANGE_ENDPOINT_PATHS).toEqual({
      transfersByTx: "/v2/transfers",
      transfersByAddress: "/v2/transfers",
      addressRisk: "/v1/risk/address"
    });
  });

  it("sends bearer authorization and JSON accept headers without raw-key auth", async () => {
    const { fetchImpl, calls } = fetchQueue(jsonResponse({ items: [rangeTransferItem] }));
    await provider(fetchImpl).findTransfersByTx({ chain: "ethereum", txHash: "0xabc" });

    expect(headerValue(calls[0]!, "authorization")).toBe(`Bearer ${apiKey}`);
    expect(headerValue(calls[0]!, "accept")).toBe("application/json");
    expect(headerValue(calls[0]!, "authorization")).not.toBe(apiKey);
    expect(headerValue(calls[0]!, "authorization")).not.toContain(",");
  });

  it("normalizes address transfer queries and returned transfers", async () => {
    const { fetchImpl, calls } = fetchQueue(jsonResponse({ items: [rangeTransferItem] }));
    const transfers = await provider(fetchImpl).findTransfersByAddress({
      chain: "ethereum",
      address: "0xSource",
      assetSymbol: "USDT",
      timeWindow: {
        start: "2026-05-05T00:00:00.000Z",
        end: "2026-05-06T00:00:00.000Z"
      }
    });

    expect(calls[0]!.url.pathname).toBe(endpointPaths.transfersByAddress);
    expect(calls[0]!.url.searchParams.get("address")).toBe("0xSource");
    expect(calls[0]!.url.searchParams.get("network")).toBe("ethereum");
    expect(calls[0]!.url.searchParams.get("token_symbols")).toBe("USDT");
    expect(calls[0]!.url.searchParams.get("start_time")).toBe("2026-05-05T00:00:00.000Z");
    expect(calls[0]!.url.searchParams.get("end_time")).toBe("2026-05-06T00:00:00.000Z");
    expect(calls[0]!.url.searchParams.get("scope")).toBe("INTERCHAIN");
    expect(calls[0]!.url.searchParams.get("size")).toBe("25");

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      id: "range:9359/AX/2352",
      protocol: "stargate",
      source: { chain: "ethereum", chainId: "ethereum", address: "0xSource" },
      destination: { chain: "tron", chainId: "tron", address: "TReceiver" },
      sourceTxHash: "0xabc",
      destinationTxHash: "tron-tx",
      assetSymbol: "USDT",
      amountRaw: "100000000000",
      decimals: 6,
      timestamp: "2026-05-05T02:41:59.000Z",
      labels: ["stargate", "SUCCEEDED"],
      payloadRef: {
        provider: "range",
        endpoint: endpointPaths.transfersByAddress,
        fetchedAt
      }
    });
    expect(transfers[0]!.payloadRef?.id).toContain("range:");
    expect(transfers[0]!.evidenceRefs).toEqual([{
      id: expect.stringContaining("cross_chain:range:ethereum:0xabc"),
      provider: "range",
      payloadId: transfers[0]!.payloadRef!.id,
      confidence: "provider_correlated"
    }]);
  });

  it("normalizes tx transfer queries and camelCase transfer fields", async () => {
    const camelCaseTransfer = {
      ...rangeTransferItem,
      sender: {
        address: "0xSource",
        network: "ethereum",
        token: { symbol: "USDT", amountRaw: "100000000000", decimals: 6 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "USDT", amountRaw: "100000000000", decimals: 6 }
      },
      sender_tx_hash: undefined,
      receiver_tx_hash: undefined,
      senderTxHash: "0xabc",
      receiverTxHash: "tron-tx"
    };
    const { fetchImpl, calls } = fetchQueue(jsonResponse({ items: [camelCaseTransfer] }));
    const transfers = await provider(fetchImpl).findTransfersByTx({
      chain: "ethereum",
      txHash: "0xabc",
      address: "0xSource",
      timeWindow: {
        start: "2026-05-05T00:00:00.000Z",
        end: "2026-05-06T00:00:00.000Z"
      }
    });

    expect(calls[0]!.url.pathname).toBe(endpointPaths.transfersByTx);
    expect(calls[0]!.url.searchParams.get("tx_hash")).toBe("0xabc");
    expect(calls[0]!.url.searchParams.get("network")).toBe("ethereum");
    expect(calls[0]!.url.searchParams.get("address")).toBe("0xSource");
    expect(calls[0]!.url.searchParams.get("start_time")).toBe("2026-05-05T00:00:00.000Z");
    expect(calls[0]!.url.searchParams.get("end_time")).toBe("2026-05-06T00:00:00.000Z");
    expect(calls[0]!.url.searchParams.get("scope")).toBe("INTERCHAIN");
    expect(calls[0]!.url.searchParams.get("size")).toBe("25");
    expect(transfers[0]).toMatchObject({
      sourceTxHash: "0xabc",
      destinationTxHash: "tron-tx",
      amountRaw: "100000000000",
      payloadRef: { provider: "range", endpoint: endpointPaths.transfersByTx }
    });
  });

  it("normalizes authenticated live amount fields for known token symbols", async () => {
    const liveShapeTransfer = {
      ...rangeTransferItem,
      sender: {
        address: "0xSource",
        network: "eth",
        token: { symbol: "USDT", amount: 100000 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "USDT", amount: 100000 }
      }
    };
    const { fetchImpl } = fetchQueue(jsonResponse({ items: [liveShapeTransfer] }));

    const transfers = await provider(fetchImpl).findTransfersByTx({ txHash: "0xabc" });

    expect(transfers[0]).toMatchObject({
      source: { chain: "ethereum" },
      assetSymbol: "USDT",
      amountRaw: "100000000000",
      decimals: 6
    });
  });

  it("skips live transfer items with unsupported amount metadata", async () => {
    const unsupportedTransfer = {
      ...rangeTransferItem,
      id: "unsupported",
      sender: {
        address: "0xSource",
        network: "eth",
        token: { symbol: "UNKNOWN", amount: 1000 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "UNKNOWN", amount: 1000 }
      }
    };
    const liveShapeTransfer = {
      ...rangeTransferItem,
      id: "supported",
      sender: {
        address: "0xSource",
        network: "eth",
        token: { symbol: "USDT", amount: 100000 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "USDT", amount: 100000 }
      }
    };
    const { fetchImpl } = fetchQueue(jsonResponse({ items: [unsupportedTransfer, liveShapeTransfer] }));

    const transfers = await provider(fetchImpl).findTransfersByTx({ txHash: "0xabc" });

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      id: "range:supported",
      source: { chain: "ethereum" },
      assetSymbol: "USDT",
      amountRaw: "100000000000"
    });
  });

  it("throws Range API 401 errors without leaking the API key", async () => {
    const { fetchImpl } = fetchQueue(textResponse("unauthorized", { status: 401 }));
    const error = await provider(fetchImpl).findTransfersByTx({ txHash: "0xabc" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RangeApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(String((error as Error).message)).toContain("Range API 401");
    expect(String((error as Error).message)).not.toContain(apiKey);
  });

  it("throws Range API 429 errors with retry and rate-limit metadata", async () => {
    const { fetchImpl } = fetchQueue(textResponse("rate limited", {
      status: 429,
      headers: {
        "Retry-After": "17",
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "1760000000"
      }
    }));
    const error = await provider(fetchImpl).findTransfersByAddress({ address: "0xSource" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RangeApiError);
    expect(error).toMatchObject({
      status: 429,
      retryAfterSeconds: 17,
      rateLimit: {
        limit: "100",
        remaining: "0",
        reset: "1760000000"
      }
    });
  });

  it("wraps network failures in sanitized Range API errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network failed with ${apiKey}`);
    }) as unknown as typeof fetch;
    const error = await provider(fetchImpl).findTransfersByTx({ txHash: "0xabc" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RangeApiError);
    expect(String((error as Error).message)).toBe(`Range API request failed for ${endpointPaths.transfersByTx}`);
    expect(String((error as Error).message)).not.toContain(apiKey);
  });

  it("fails closed for live transfer normalization until raw Range fields are confirmed", async () => {
    const documentedOnlyTransfer = {
      ...rangeTransferItem,
      sender: {
        address: "0xSource",
        network: "ethereum",
        token: { symbol: "USDT", amount: 100000, usd: 100000 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "USDT", amount: 100000, usd: 100000 }
      }
    };
    const { fetchImpl } = fetchQueue(jsonResponse({ items: [documentedOnlyTransfer] }));

    await expect(liveDefaultProvider(fetchImpl).findTransfersByTx({ txHash: "0xabc" }))
      .rejects.toThrow("Range API transfer normalization requires authenticated raw amount fixture confirmation");
  });

  it("skips malformed transfer rows when live normalization is enabled", async () => {
    const malformedTransfer = {
      ...rangeTransferItem,
      sender: {
        address: "0xSource",
        network: "ethereum",
        token: { symbol: "USDT", amount: "100000", decimals: 6 }
      }
    };
    const { fetchImpl } = fetchQueue(jsonResponse({ items: [malformedTransfer] }));

    await expect(provider(fetchImpl).findTransfersByAddress({ address: "0xSource" }))
      .resolves.toEqual([]);
  });

  it("creates range payload refs for transfer and risk responses", async () => {
    const { fetchImpl } = fetchQueue(
      jsonResponse({ items: [rangeTransferItem] }),
      jsonResponse({ riskScore: 90, riskLevel: "CRITICAL" })
    );
    const rangeProvider = provider(fetchImpl);
    const [transfer] = await rangeProvider.findTransfersByTx({ txHash: "0xabc" });
    const risk = await rangeProvider.getAddressRisk({ chain: "tron", address: "TReceiver" });
    const riskPayloadId = risk?.payloadRef?.id;

    expect(transfer?.payloadRef).toMatchObject({ provider: "range", endpoint: endpointPaths.transfersByTx });
    expect(transfer?.evidenceRefs[0]).toMatchObject({ provider: "range", payloadId: transfer.payloadRef!.id });
    expect(risk?.payloadRef).toMatchObject({ provider: "range", endpoint: endpointPaths.addressRisk });
    expect(riskPayloadId).toBeTypeOf("string");
    expect(risk?.evidenceRefs[0]).toMatchObject({ provider: "range", payloadId: riskPayloadId });
  });

  it("filters minAmountRaw client-side and treats invalid minAmountRaw as no matches", async () => {
    const smallTransfer = {
      ...rangeTransferItem,
      id: "small",
      sender: {
        address: "0xSource",
        network: "ethereum",
        token: { symbol: "USDT", amount_raw: "100", decimals: 6 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "USDT", amount_raw: "100", decimals: 6 }
      }
    };
    const largeTransfer = {
      ...rangeTransferItem,
      id: "large",
      sender: {
        address: "0xSource",
        network: "ethereum",
        token: { symbol: "USDT", amount_raw: "200", decimals: 6 }
      },
      receiver: {
        address: "TReceiver",
        network: "tron",
        token: { symbol: "USDT", amount_raw: "200", decimals: 6 }
      }
    };
    const { fetchImpl, calls } = fetchQueue(
      jsonResponse({ items: [smallTransfer, largeTransfer] }),
      jsonResponse({ items: [largeTransfer] })
    );
    const rangeProvider = provider(fetchImpl);

    await expect(rangeProvider.findTransfersByAddress({ address: "0xSource", minAmountRaw: "150" }))
      .resolves.toMatchObject([{ id: "range:large", amountRaw: "200" }]);
    expect(calls[0]!.url.searchParams.has("minAmountRaw")).toBe(false);
    expect(calls[0]!.url.searchParams.has("min_amount_raw")).toBe(false);

    await expect(rangeProvider.findTransfersByAddress({ address: "0xSource", minAmountRaw: "bad" }))
      .resolves.toEqual([]);
  });

  it("does not request address risk without a network because Range risk requires chain", async () => {
    const { fetchImpl, calls } = fetchQueue(jsonResponse({ riskScore: 90 }));
    const snapshot = await provider(fetchImpl).getAddressRisk({ address: "TReceiver" });

    expect(snapshot).toBeNull();
    expect(calls).toEqual([]);
  });

  it("normalizes address risk responses with a chain query", async () => {
    const { fetchImpl, calls } = fetchQueue(jsonResponse({
      riskScore: 90,
      riskLevel: "CRITICAL",
      reasoning: "Bridge counterparty is linked to a mixer cluster.",
      maliciousAddressesFound: [{ name_tag: "Tornado.Cash", category: "mixer" }]
    }));
    const snapshot = await provider(fetchImpl).getAddressRisk({ chain: "tron", address: "TReceiver" });

    expect(calls[0]!.url.pathname).toBe(endpointPaths.addressRisk);
    expect(calls[0]!.url.searchParams.get("address")).toBe("TReceiver");
    expect(calls[0]!.url.searchParams.get("network")).toBe("tron");
    expect(snapshot).toMatchObject({
      address: { chain: "tron", chainId: "tron", address: "TReceiver" },
      provider: "range",
      riskScore: 90,
      payloadRef: {
        provider: "range",
        endpoint: endpointPaths.addressRisk,
        fetchedAt
      }
    });
    expect(snapshot?.labels).toEqual(expect.arrayContaining([
      "CRITICAL",
      "Bridge counterparty is linked to a mixer cluster.",
      "Tornado.Cash",
      "mixer"
    ]));
  });
});
