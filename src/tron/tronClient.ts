import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { logger as defaultLogger, type Logger } from "../logging/logger";

export type TronClient = {
  listIncomingTrc20Transfers(
    address: string,
    options?: ListIncomingTrc20TransfersOptions
  ): Promise<RawTronscanTrc20Transfer[]>;
  getTransaction(txHash: string): Promise<unknown>;
};

type FetchLike = typeof fetch;

export type ListIncomingTrc20TransfersOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

export type TronscanClientOptions = {
  baseUrl: string | URL;
  apiKey?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  fetchFn?: FetchLike;
  logger?: Logger;
};

class TronscanHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class TronscanClient implements TronClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchFn: FetchLike;
  private readonly logger: Logger;

  constructor(options: TronscanClientOptions | string | URL) {
    const normalizedOptions = options instanceof URL || typeof options === "string" ? { baseUrl: options } : options;
    this.baseUrl = new URL(normalizedOptions.baseUrl);
    if (this.baseUrl.protocol !== "https:") {
      throw new Error("TronscanClient baseUrl must use https");
    }
    this.apiKey = normalizedOptions.apiKey;
    this.timeoutMs = normalizedOptions.timeoutMs ?? 10_000;
    this.retryAttempts = normalizedOptions.retryAttempts ?? 0;
    this.retryBaseDelayMs = normalizedOptions.retryBaseDelayMs ?? 250;
    this.fetchFn = normalizedOptions.fetchFn ?? fetch;
    this.logger = normalizedOptions.logger ?? defaultLogger;
  }

  async listIncomingTrc20Transfers(
    address: string,
    options: ListIncomingTrc20TransfersOptions = {}
  ): Promise<RawTronscanTrc20Transfer[]> {
    const url = new URL("/api/token_trc20/transfers", this.baseUrl);
    url.searchParams.set("toAddress", address);
    url.searchParams.set("contract_address", TRON_USDT_CONTRACT_ADDRESS);
    url.searchParams.set("confirm", "0");
    url.searchParams.set("limit", String(options.limit ?? 50));
    url.searchParams.set("start", String(options.start ?? 0));
    if (options.minTimestamp !== undefined) {
      url.searchParams.set("start_timestamp", String(options.minTimestamp));
    }
    if (options.endTimestamp !== undefined) {
      url.searchParams.set("end_timestamp", String(options.endTimestamp));
    }
    url.searchParams.set("sort", "-timestamp");

    const json = await this.fetchJson(url, "transfer");
    const transfers = (json as { token_transfers?: unknown }).token_transfers;
    if (transfers === undefined) {
      throw new Error("Tronscan transfer response token_transfers field is missing");
    }
    if (!Array.isArray(transfers)) {
      throw new Error("Tronscan transfer response token_transfers must be an array");
    }
    return transfers as RawTronscanTrc20Transfer[];
  }

  async getTransaction(txHash: string): Promise<unknown> {
    const url = new URL("/api/transaction-info", this.baseUrl);
    url.searchParams.set("hash", txHash);

    return this.fetchJson(url, "transaction");
  }

  private async fetchJson(url: URL, requestName: string): Promise<unknown> {
    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      this.logger.info("tronscan_request_attempt", {
        request_name: requestName,
        attempt,
        path: url.pathname
      });

      try {
        const json = await this.fetchJsonOnce(url, requestName);
        this.logger.info("tronscan_request_success", {
          request_name: requestName,
          attempt,
          path: url.pathname
        });
        return json;
      } catch (error) {
        if (attempt >= this.retryAttempts || !this.isTransientError(error)) {
          this.logger.error("tronscan_request_failed", {
            request_name: requestName,
            attempt,
            path: url.pathname,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
        this.logger.warn("tronscan_request_retry", {
          request_name: requestName,
          attempt,
          next_attempt: attempt + 1,
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.delay(this.retryBaseDelayMs * 2 ** attempt);
      }
    }

    throw new Error("Tronscan retry loop exhausted");
  }

  private async fetchJsonOnce(url: URL, requestName: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: HeadersInit = this.apiKey ? { "TRON-PRO-API-KEY": this.apiKey } : {};
      const response = await this.fetchFn(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new TronscanHttpError(`Tronscan ${requestName} request failed: ${response.status}`, response.status);
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof TronscanHttpError) {
      return error.status === 408 || error.status === 429 || (error.status >= 500 && error.status <= 599);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    return error instanceof TypeError;
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
