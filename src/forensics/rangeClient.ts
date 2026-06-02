import type {
  CrossChainAddressQuery,
  CrossChainDiscoveryProvider,
  CrossChainTransfer,
  CrossChainTxQuery,
  ProviderRiskSnapshot
} from "./crossChainProviders";
import { crossChainEvidenceId, payloadRefId } from "./crossChainEvidence";
import type { CrossChainEvidenceRef, ProviderPayloadRef } from "../types";

export type RangeEndpointPaths = {
  transfersByTx: string;
  transfersByAddress: string;
  addressRisk: string;
};

export const RANGE_ENDPOINT_PATHS = {
  transfersByTx: "/v2/transfers",
  transfersByAddress: "/v2/transfers",
  addressRisk: "/v1/risk/address"
} as const;

export class RangeApiError extends Error {
  status?: number;
  retryAfterSeconds?: number;
  rateLimit?: { limit?: string; remaining?: string; reset?: string };

  constructor(
    message: string,
    options: {
      status?: number;
      retryAfterSeconds?: number;
      rateLimit?: { limit?: string; remaining?: string; reset?: string };
    } = {}
  ) {
    super(message);
    this.name = "RangeApiError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.rateLimit = options.rateLimit;
  }
}

type RangeClientInput = {
  apiKey: string;
  baseUrl: URL;
  timeoutMs: number;
  endpointPaths?: RangeEndpointPaths;
  allowUndocumentedRawAmountFields?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type RequestContext = {
  endpoint: string;
  payloadRef: ProviderPayloadRef;
  allowUndocumentedRawAmountFields: boolean;
};

type RangeToken = {
  symbol: string;
  amountRaw: string;
  decimals: number;
};

const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6
};

export function createRangeCrossChainDiscoveryProvider(input: RangeClientInput): CrossChainDiscoveryProvider {
  const endpointPaths = input.endpointPaths ?? RANGE_ENDPOINT_PATHS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());

  async function requestJson(path: string, params: Record<string, string | undefined>): Promise<unknown> {
    const url = new URL(path, input.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeout = input.timeoutMs > 0
      ? setTimeout(() => controller.abort(), input.timeoutMs)
      : undefined;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw httpError(path, response);
      }

      try {
        return await response.json();
      } catch {
        throw malformed(path);
      }
    } catch (error) {
      if (error instanceof RangeApiError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new RangeApiError(`Range API request timed out for ${path}`);
      }

      throw new RangeApiError(`Range API request failed for ${path}`);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  return {
    async findTransfersByTx(query: CrossChainTxQuery): Promise<CrossChainTransfer[]> {
      const endpoint = endpointPaths.transfersByTx;
      const body = await requestJson(endpoint, {
        tx_hash: query.txHash,
        network: query.chain,
        address: query.address,
        start_time: query.timeWindow?.start,
        end_time: query.timeWindow?.end,
        scope: "INTERCHAIN",
        size: "25"
      });
      const payloadRef = makePayloadRef(endpoint, `tx_hash:${query.chain ?? "all"}:${query.txHash}`, now);
      return normalizeTransferItems(body, {
        endpoint,
        payloadRef,
        allowUndocumentedRawAmountFields: input.allowUndocumentedRawAmountFields === true
      });
    },

    async findTransfersByAddress(query: CrossChainAddressQuery): Promise<CrossChainTransfer[]> {
      const endpoint = endpointPaths.transfersByAddress;
      const body = await requestJson(endpoint, {
        address: query.address,
        network: query.chain,
        token_symbols: query.assetSymbol,
        start_time: query.timeWindow?.start,
        end_time: query.timeWindow?.end,
        scope: "INTERCHAIN",
        size: "25"
      });
      const payloadRef = makePayloadRef(endpoint, `address:${query.chain ?? "all"}:${query.address}`, now);
      const transfers = normalizeTransferItems(body, {
        endpoint,
        payloadRef,
        allowUndocumentedRawAmountFields: input.allowUndocumentedRawAmountFields === true
      });
      return filterByMinimumAmount(transfers, query.minAmountRaw);
    },

    async getAddressRisk(query: CrossChainAddressQuery): Promise<ProviderRiskSnapshot | null> {
      if (!query.chain) {
        return null;
      }

      const endpoint = endpointPaths.addressRisk;
      const body = await requestJson(endpoint, {
        address: query.address,
        network: query.chain
      });
      const chain = query.chain;
      const payloadRef = makePayloadRef(endpoint, `address_risk:${chain}:${query.address}`, now);
      return normalizeRiskSnapshot(body, {
        endpoint,
        payloadRef,
        address: query.address,
        chain
      });
    }
  };
}

function httpError(path: string, response: Response): RangeApiError {
  return new RangeApiError(`Range API ${response.status} error for ${path}`, {
    status: response.status,
    retryAfterSeconds: parseRetryAfter(response.headers),
    rateLimit: parseRateLimit(response.headers)
  });
}

function malformed(path: string): RangeApiError {
  return new RangeApiError(`Range API malformed response for ${path}`);
}

function makePayloadRef(endpoint: string, key: string, now: () => Date): ProviderPayloadRef {
  return {
    id: payloadRefId("range", endpoint, key),
    provider: "range",
    endpoint,
    fetchedAt: now().toISOString()
  };
}

function normalizeTransferItems(body: unknown, context: RequestContext): CrossChainTransfer[] {
  const response = asRecord(body);
  const items = Array.isArray(response.items) ? response.items : null;
  if (!items) {
    throw malformed(context.endpoint);
  }

  const transfers: CrossChainTransfer[] = [];
  for (const item of items) {
    try {
      transfers.push(normalizeTransfer(item, context));
    } catch (error) {
      if (context.allowUndocumentedRawAmountFields && error instanceof RangeApiError) {
        continue;
      }
      throw error;
    }
  }
  return transfers;
}

function normalizeTransfer(item: unknown, context: RequestContext): CrossChainTransfer {
  const row = asRecord(item);
  const id = requiredString(row.id);
  const sender = asRecord(row.sender);
  const receiver = asRecord(row.receiver);
  const senderAddress = requiredString(sender.address);
  const senderNetwork = normalizeNetwork(requiredString(sender.network));
  const receiverAddress = requiredString(receiver.address);
  const receiverNetwork = normalizeNetwork(requiredString(receiver.network));
  const senderToken = normalizeToken(sender.token, context);
  const receiverToken = normalizeToken(receiver.token, context);
  if (senderToken.symbol !== receiverToken.symbol || senderToken.decimals !== receiverToken.decimals) {
    throw malformed(context.endpoint);
  }

  const sourceTxHash = optionalString(row.sender_tx_hash) ?? optionalString(row.senderTxHash);
  const destinationTxHash = optionalString(row.receiver_tx_hash) ?? optionalString(row.receiverTxHash);
  const labels = uniqueStrings([optionalString(row.type), optionalString(row.status)]);
  const protocol = optionalString(row.type) ?? optionalString(row.status) ?? "unknown";
  const sourceId = sourceTxHash ?? destinationTxHash ?? id;
  const evidenceRef: CrossChainEvidenceRef = {
    id: crossChainEvidenceId("range", senderNetwork, sourceId, "bridge_source"),
    provider: "range",
    payloadId: context.payloadRef.id,
    confidence: "provider_correlated"
  };

  return {
    id: `range:${id}`,
    protocol,
    source: {
      chain: senderNetwork,
      chainId: senderNetwork,
      address: senderAddress
    },
    destination: {
      chain: receiverNetwork,
      chainId: receiverNetwork,
      address: receiverAddress
    },
    sourceTxHash,
    destinationTxHash,
    assetSymbol: senderToken.symbol,
    amountRaw: senderToken.amountRaw,
    decimals: senderToken.decimals,
    timestamp: optionalString(row.time),
    evidenceRefs: [evidenceRef],
    payloadRef: { ...context.payloadRef },
    labels
  };
}

function normalizeToken(value: unknown, context: RequestContext): RangeToken {
  if (!context.allowUndocumentedRawAmountFields) {
    throw new RangeApiError(
      "Range API transfer normalization requires authenticated raw amount fixture confirmation"
    );
  }

  const token = asRecord(value);
  const symbol = requiredString(token.symbol);
  const amountRaw = optionalString(token.amount_raw) ?? optionalString(token.amountRaw);
  const decimals = typeof token.decimals === "number" ? token.decimals : knownDecimals(symbol);
  const normalizedAmountRaw = amountRaw ?? rawAmountFromDecimalAmount(token.amount, decimals);
  if (!normalizedAmountRaw || !isUnsignedIntegerString(normalizedAmountRaw)) {
    throw new RangeApiError("Range API malformed response");
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new RangeApiError("Range API malformed response");
  }

  return { symbol, amountRaw: normalizedAmountRaw, decimals };
}

function normalizeNetwork(network: string): string {
  const normalized = network.trim().toLowerCase();
  if (normalized === "eth") return "ethereum";
  return network;
}

function knownDecimals(symbol: string): number {
  const normalized = symbol.trim().toUpperCase();
  const decimals = KNOWN_TOKEN_DECIMALS[normalized];
  if (decimals === undefined) {
    throw new RangeApiError("Range API malformed response");
  }
  return decimals;
}

function rawAmountFromDecimalAmount(value: unknown, decimals: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  const fixed = value.toFixed(decimals);
  const [whole = "0", fraction = ""] = fixed.split(".");
  return `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

function normalizeRiskSnapshot(
  body: unknown,
  input: { endpoint: string; payloadRef: ProviderPayloadRef; address: string; chain: string }
): ProviderRiskSnapshot {
  const row = asRecord(body);
  if (typeof row.riskScore !== "number" || !Number.isFinite(row.riskScore)) {
    throw malformed(input.endpoint);
  }

  const labels = riskLabels(row);
  const evidenceRef: CrossChainEvidenceRef = {
    id: crossChainEvidenceId("range", input.chain, input.address, "address_risk"),
    provider: "range",
    payloadId: input.payloadRef.id,
    confidence: "provider_correlated"
  };

  return {
    address: {
      chain: input.chain,
      chainId: input.chain,
      address: input.address
    },
    provider: "range",
    riskScore: row.riskScore,
    labels,
    evidenceRefs: [evidenceRef],
    payloadRef: { ...input.payloadRef }
  };
}

function riskLabels(row: Record<string, unknown>): string[] {
  const labels: string[] = [];
  pushString(labels, row.riskLevel);
  pushString(labels, row.reasoning);

  if (Array.isArray(row.maliciousAddressesFound)) {
    for (const item of row.maliciousAddressesFound) {
      const record = isRecord(item) ? item : null;
      if (!record) {
        continue;
      }
      pushString(labels, record.name_tag);
      pushString(labels, record.category);
    }
  }

  return uniqueStrings(labels);
}

function filterByMinimumAmount(transfers: CrossChainTransfer[], minAmountRaw: string | undefined): CrossChainTransfer[] {
  if (minAmountRaw === undefined) {
    return transfers;
  }

  if (!isUnsignedIntegerString(minAmountRaw)) {
    return [];
  }

  const minimum = BigInt(minAmountRaw);
  return transfers.filter((transfer) => BigInt(transfer.amountRaw) >= minimum);
}

function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("Retry-After");
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds);
  }

  return undefined;
}

function parseRateLimit(headers: Headers): { limit?: string; remaining?: string; reset?: string } | undefined {
  const rateLimit = {
    limit: headers.get("X-RateLimit-Limit") ?? undefined,
    remaining: headers.get("X-RateLimit-Remaining") ?? undefined,
    reset: headers.get("X-RateLimit-Reset") ?? undefined
  };

  return rateLimit.limit || rateLimit.remaining || rateLimit.reset ? rateLimit : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RangeApiError("Range API malformed response");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  const result = optionalString(value);
  if (!result) {
    throw new RangeApiError("Range API malformed response");
  }

  return result;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pushString(target: string[], value: unknown): void {
  const text = optionalString(value);
  if (text) {
    target.push(text);
  }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isUnsignedIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}
