import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";

export type TronClient = {
  listIncomingTrc20Transfers(address: string): Promise<RawTronscanTrc20Transfer[]>;
  getTransaction(txHash: string): Promise<unknown>;
};

export class TronscanClient implements TronClient {
  constructor(private readonly baseUrl: string | URL) {}

  async listIncomingTrc20Transfers(address: string): Promise<RawTronscanTrc20Transfer[]> {
    const url = new URL("/api/token_trc20/transfers", this.baseUrl);
    url.searchParams.set("relatedAddress", address);
    url.searchParams.set("limit", "50");
    url.searchParams.set("start", "0");
    url.searchParams.set("sort", "-timestamp");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tronscan transfer request failed: ${response.status}`);
    }

    const json = (await response.json()) as { token_transfers?: RawTronscanTrc20Transfer[] };
    return json.token_transfers ?? [];
  }

  async getTransaction(txHash: string): Promise<unknown> {
    const url = new URL("/api/transaction-info", this.baseUrl);
    url.searchParams.set("hash", txHash);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Tronscan transaction request failed: ${response.status}`);
    }

    return response.json();
  }
}
