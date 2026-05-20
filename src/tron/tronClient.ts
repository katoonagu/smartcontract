import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";

export type TronClient = {
  listIncomingTrc20Transfers(address: string): Promise<RawTronscanTrc20Transfer[]>;
  getTransaction(txHash: string): Promise<unknown>;
};

type FetchLike = typeof fetch;

export type TronscanClientOptions = {
  baseUrl: string | URL;
  apiKey?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
};

export class TronscanClient implements TronClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: TronscanClientOptions | string | URL) {
    const normalizedOptions = options instanceof URL || typeof options === "string" ? { baseUrl: options } : options;
    this.baseUrl = new URL(normalizedOptions.baseUrl);
    if (this.baseUrl.protocol !== "https:") {
      throw new Error("TronscanClient baseUrl must use https");
    }
    this.apiKey = normalizedOptions.apiKey;
    this.timeoutMs = normalizedOptions.timeoutMs ?? 10_000;
    this.fetchFn = normalizedOptions.fetchFn ?? fetch;
  }

  async listIncomingTrc20Transfers(address: string): Promise<RawTronscanTrc20Transfer[]> {
    const url = new URL("/api/token_trc20/transfers", this.baseUrl);
    url.searchParams.set("toAddress", address);
    url.searchParams.set("contract_address", TRON_USDT_CONTRACT_ADDRESS);
    url.searchParams.set("confirm", "0");
    url.searchParams.set("limit", "50");
    url.searchParams.set("start", "0");
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: HeadersInit = this.apiKey ? { "TRON-PRO-API-KEY": this.apiKey } : {};
      const response = await this.fetchFn(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Tronscan ${requestName} request failed: ${response.status}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
