export type EvmChain = "ethereum" | "arbitrum" | "bsc";

export type EvmAddressQuery = {
  chain: EvmChain;
  address: string;
  startBlock?: number;
  endBlock?: number;
  pageLimit?: number;
  offset?: number;
};

export type EvmTokenTransferQuery = EvmAddressQuery & {
  contractAddress?: string;
};

export type EvmLogQuery = {
  chain: EvmChain;
  address?: string;
  fromBlock?: number;
  toBlock?: number;
  topic0?: string;
};

export type EvmTransaction = {
  chain: EvmChain;
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  nonce?: string;
  blockHash?: string;
  transactionIndex?: string;
  from?: string;
  to?: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
  isError?: string;
  txReceiptStatus?: string;
  input?: string;
  contractAddress?: string;
  cumulativeGasUsed?: string;
  gasUsed?: string;
  confirmations?: string;
  methodId?: string;
  functionName?: string;
};

export type EvmInternalTransaction = {
  chain: EvmChain;
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  contractAddress?: string;
  input?: string;
  type?: string;
  gas?: string;
  gasUsed?: string;
  traceId?: string;
  isError?: string;
  errCode?: string;
};

export type EvmTokenTransfer = {
  chain: EvmChain;
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  nonce?: string;
  blockHash?: string;
  from?: string;
  contractAddress?: string;
  to?: string;
  value?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  transactionIndex?: string;
  gas?: string;
  gasPrice?: string;
  gasUsed?: string;
  cumulativeGasUsed?: string;
  input?: string;
  confirmations?: string;
};

export type EvmLog = {
  chain: EvmChain;
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex?: string;
  blockHash?: string;
  logIndex: string;
  removed?: boolean;
};

export type EvmTransactionReceipt = {
  chain: EvmChain;
  transactionHash?: string;
  blockHash?: string;
  blockNumber?: string;
  transactionIndex?: string;
  from?: string;
  to?: string;
  cumulativeGasUsed?: string;
  gasUsed?: string;
  contractAddress?: string | null;
  logs: EvmLog[];
  status?: string;
  logsBloom?: string;
};

export type EvmTokenMetadata = {
  chain: EvmChain;
  tokenContract: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
};

export interface EvmEvidenceProvider {
  listNormalTransactions(input: EvmAddressQuery): Promise<EvmTransaction[]>;
  listInternalTransactions(input: EvmAddressQuery): Promise<EvmInternalTransaction[]>;
  listErc20Transfers(input: EvmTokenTransferQuery): Promise<EvmTokenTransfer[]>;
  getTransactionReceipt(input: { chain: EvmChain; txHash: string }): Promise<EvmTransactionReceipt | null>;
  getLogs(input: EvmLogQuery): Promise<EvmLog[]>;
  getTokenMetadata(input: { chain: EvmChain; tokenContract: string }): Promise<EvmTokenMetadata | null>;
}

export class EvmExplorerError extends Error {
  action?: string;
  status?: string | number;

  constructor(message: string, options: { action?: string; status?: string | number } = {}) {
    super(message);
    this.name = "EvmExplorerError";
    this.action = options.action;
    this.status = options.status;
  }
}

type EtherscanV2EvmEvidenceProviderInput = {
  apiKey: string;
  baseUrl: URL;
  timeoutMs?: number;
  maxPagesPerQuery?: number;
  fetchImpl?: typeof fetch;
};

type QueryParams = Record<string, string | number | undefined>;

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PAGES_PER_QUERY = 5;
const DEFAULT_OFFSET = 100;

const CHAIN_IDS: Record<EvmChain, string> = {
  ethereum: "1",
  arbitrum: "42161",
  bsc: "56"
};

export function createEtherscanV2EvmEvidenceProvider(
  input: EtherscanV2EvmEvidenceProviderInput
): EvmEvidenceProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = positiveIntegerOrDefault(input.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxPagesPerQuery = positiveIntegerOrDefault(input.maxPagesPerQuery, DEFAULT_MAX_PAGES_PER_QUERY);

  async function requestJson(action: string, params: QueryParams): Promise<unknown> {
    const url = new URL(input.baseUrl.href);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("apikey", input.apiKey);

    const controller = new AbortController();
    const timeout = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });

      if (!response.ok) {
        throw explorerStatusError(action, response.status);
      }

      try {
        return await response.json();
      } catch {
        throw malformed(action);
      }
    } catch (error) {
      if (error instanceof EvmExplorerError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new EvmExplorerError(`EVM explorer request timed out for ${action}`, { action });
      }

      throw new EvmExplorerError(`EVM explorer request failed for ${action}`, { action });
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  async function requestExplorerArray(action: string, params: QueryParams): Promise<unknown[]> {
    const body = await requestJson(action, params);
    return normalizeExplorerArrayResponse(body, action);
  }

  async function listAccountRows(inputQuery: EvmAddressQuery, action: string): Promise<unknown[]> {
    const offset = positiveIntegerOrDefault(inputQuery.offset, DEFAULT_OFFSET);
    const pageLimit = Math.min(
      positiveIntegerOrDefault(inputQuery.pageLimit, maxPagesPerQuery),
      maxPagesPerQuery
    );
    const rows: unknown[] = [];

    for (let page = 1; page <= pageLimit; page++) {
      const pageRows = await requestExplorerArray(action, {
        module: "account",
        action,
        address: inputQuery.address,
        chainid: CHAIN_IDS[inputQuery.chain],
        startblock: inputQuery.startBlock,
        endblock: inputQuery.endBlock,
        page,
        offset,
        sort: "desc"
      });
      rows.push(...pageRows);
      if (pageRows.length < offset) {
        break;
      }
    }

    return rows;
  }

  return {
    async listNormalTransactions(inputQuery: EvmAddressQuery): Promise<EvmTransaction[]> {
      const rows = await listAccountRows(inputQuery, "txlist");
      return rows.map((row) => normalizeTransaction(row, inputQuery.chain, "txlist"));
    },

    async listInternalTransactions(inputQuery: EvmAddressQuery): Promise<EvmInternalTransaction[]> {
      const rows = await listAccountRows(inputQuery, "txlistinternal");
      return rows.map((row) => normalizeInternalTransaction(row, inputQuery.chain, "txlistinternal"));
    },

    async listErc20Transfers(inputQuery: EvmTokenTransferQuery): Promise<EvmTokenTransfer[]> {
      const offset = positiveIntegerOrDefault(inputQuery.offset, DEFAULT_OFFSET);
      const pageLimit = Math.min(
        positiveIntegerOrDefault(inputQuery.pageLimit, maxPagesPerQuery),
        maxPagesPerQuery
      );
      const rows: unknown[] = [];

      for (let page = 1; page <= pageLimit; page++) {
        const pageRows = await requestExplorerArray("tokentx", {
          module: "account",
          action: "tokentx",
          address: inputQuery.address,
          contractaddress: inputQuery.contractAddress,
          chainid: CHAIN_IDS[inputQuery.chain],
          startblock: inputQuery.startBlock,
          endblock: inputQuery.endBlock,
          page,
          offset,
          sort: "desc"
        });
        rows.push(...pageRows);
        if (pageRows.length < offset) {
          break;
        }
      }

      return rows.map((row) => normalizeTokenTransfer(row, inputQuery.chain, "tokentx"));
    },

    async getTransactionReceipt(inputQuery: { chain: EvmChain; txHash: string }): Promise<EvmTransactionReceipt | null> {
      const body = await requestJson("eth_getTransactionReceipt", {
        module: "proxy",
        action: "eth_getTransactionReceipt",
        txhash: inputQuery.txHash,
        chainid: CHAIN_IDS[inputQuery.chain]
      });
      const response = asRecord(body, "eth_getTransactionReceipt");
      const status = stringValue(response.status);
      if (status !== undefined && status !== "1") {
        throw explorerStatusError("eth_getTransactionReceipt", status);
      }
      if (!Object.prototype.hasOwnProperty.call(response, "result")) {
        throw malformed("eth_getTransactionReceipt");
      }
      if (response.result === null) {
        return null;
      }

      return normalizeReceipt(response.result, inputQuery.chain, "eth_getTransactionReceipt");
    },

    async getLogs(inputQuery: EvmLogQuery): Promise<EvmLog[]> {
      const rows = await requestExplorerArray("getLogs", {
        module: "logs",
        action: "getLogs",
        chainid: CHAIN_IDS[inputQuery.chain],
        address: inputQuery.address,
        fromBlock: inputQuery.fromBlock,
        toBlock: inputQuery.toBlock,
        topic0: inputQuery.topic0
      });

      return rows.map((row) => normalizeLog(row, inputQuery.chain, "getLogs"));
    },

    async getTokenMetadata(inputQuery: { chain: EvmChain; tokenContract: string }): Promise<EvmTokenMetadata | null> {
      void inputQuery;
      return null;
    }
  };
}

function normalizeExplorerArrayResponse(body: unknown, action: string): unknown[] {
  const response = asRecord(body, action);
  const status = stringValue(response.status);
  const message = stringValue(response.message);

  if (status === "1") {
    if (!Array.isArray(response.result)) {
      throw malformed(action);
    }
    return response.result;
  }

  if (status === "0" && isEmptyExplorerMessage(message)) {
    return [];
  }

  if (status !== undefined) {
    throw explorerStatusError(action, status);
  }

  throw malformed(action);
}

function normalizeTransaction(value: unknown, chain: EvmChain, action: string): EvmTransaction {
  const row = asRecord(value, action);
  const transaction: EvmTransaction = { chain };
  copyString(transaction, row, "blockNumber");
  copyString(transaction, row, "timeStamp");
  copyString(transaction, row, "hash");
  copyString(transaction, row, "nonce");
  copyString(transaction, row, "blockHash");
  copyString(transaction, row, "transactionIndex");
  copyString(transaction, row, "from");
  copyString(transaction, row, "to");
  copyString(transaction, row, "value");
  copyString(transaction, row, "gas");
  copyString(transaction, row, "gasPrice");
  copyString(transaction, row, "isError");
  copyString(transaction, row, "txReceiptStatus", "txreceipt_status");
  copyString(transaction, row, "input");
  copyString(transaction, row, "contractAddress");
  copyString(transaction, row, "cumulativeGasUsed");
  copyString(transaction, row, "gasUsed");
  copyString(transaction, row, "confirmations");
  copyString(transaction, row, "methodId");
  copyString(transaction, row, "functionName");
  return transaction;
}

function normalizeInternalTransaction(value: unknown, chain: EvmChain, action: string): EvmInternalTransaction {
  const row = asRecord(value, action);
  const transaction: EvmInternalTransaction = { chain };
  copyString(transaction, row, "blockNumber");
  copyString(transaction, row, "timeStamp");
  copyString(transaction, row, "hash");
  copyString(transaction, row, "from");
  copyString(transaction, row, "to");
  copyString(transaction, row, "value");
  copyString(transaction, row, "contractAddress");
  copyString(transaction, row, "input");
  copyString(transaction, row, "type");
  copyString(transaction, row, "gas");
  copyString(transaction, row, "gasUsed");
  copyString(transaction, row, "traceId");
  copyString(transaction, row, "isError");
  copyString(transaction, row, "errCode");
  return transaction;
}

function normalizeTokenTransfer(value: unknown, chain: EvmChain, action: string): EvmTokenTransfer {
  const row = asRecord(value, action);
  const transfer: EvmTokenTransfer = { chain };
  copyString(transfer, row, "blockNumber");
  copyString(transfer, row, "timeStamp");
  copyString(transfer, row, "hash");
  copyString(transfer, row, "nonce");
  copyString(transfer, row, "blockHash");
  copyString(transfer, row, "from");
  copyString(transfer, row, "contractAddress");
  copyString(transfer, row, "to");
  copyString(transfer, row, "value");
  copyString(transfer, row, "tokenName");
  copyString(transfer, row, "tokenSymbol");
  copyString(transfer, row, "tokenDecimal");
  copyString(transfer, row, "transactionIndex");
  copyString(transfer, row, "gas");
  copyString(transfer, row, "gasPrice");
  copyString(transfer, row, "gasUsed");
  copyString(transfer, row, "cumulativeGasUsed");
  copyString(transfer, row, "input");
  copyString(transfer, row, "confirmations");
  return transfer;
}

function normalizeReceipt(value: unknown, chain: EvmChain, action: string): EvmTransactionReceipt {
  const row = asRecord(value, action);
  if (!Array.isArray(row.logs)) {
    throw malformed(action);
  }

  const receipt: EvmTransactionReceipt = {
    chain,
    logs: row.logs.map((log) => normalizeLog(log, chain, action))
  };
  copyString(receipt, row, "transactionHash");
  copyString(receipt, row, "blockHash");
  copyString(receipt, row, "blockNumber");
  copyString(receipt, row, "transactionIndex");
  copyString(receipt, row, "from");
  copyString(receipt, row, "to");
  copyString(receipt, row, "cumulativeGasUsed");
  copyString(receipt, row, "gasUsed");
  copyString(receipt, row, "status");
  copyString(receipt, row, "logsBloom");

  if (row.contractAddress === null) {
    receipt.contractAddress = null;
  } else {
    copyString(receipt, row, "contractAddress");
  }

  return receipt;
}

function normalizeLog(value: unknown, chain: EvmChain, action: string): EvmLog {
  const row = asRecord(value, action);
  const topics = normalizeTopics(row.topics, action);
  const address = requiredString(row.address, action);
  const data = requiredString(row.data, action);
  const blockNumber = requiredString(row.blockNumber, action);
  const transactionHash = requiredString(row.transactionHash, action);
  const logIndex = requiredString(row.logIndex, action);
  const log: EvmLog = {
    chain,
    address,
    topics,
    data,
    blockNumber,
    transactionHash,
    logIndex
  };
  copyString(log, row, "transactionIndex");
  copyString(log, row, "blockHash");
  if (typeof row.removed === "boolean") {
    log.removed = row.removed;
  }
  return log;
}

function normalizeTopics(value: unknown, action: string): string[] {
  if (!Array.isArray(value) || value.some((topic) => typeof topic !== "string")) {
    throw malformed(action);
  }
  return [...value];
}

function asRecord(value: unknown, action: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw malformed(action);
  }

  return value as Record<string, unknown>;
}

function copyString<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
  targetKey: keyof T & string,
  sourceKey: string = targetKey
): void {
  const value = stringValue(source[sourceKey]);
  if (value !== undefined) {
    target[targetKey] = value as T[keyof T & string];
  }
}

function requiredString(value: unknown, action: string): string {
  const result = stringValue(value);
  if (result === undefined) {
    throw malformed(action);
  }

  return result;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function isEmptyExplorerMessage(message: string | undefined): boolean {
  const normalized = (message ?? "").toLowerCase();
  return normalized === "no transactions found" || normalized === "no records found";
}

function explorerStatusError(action: string, status: string | number): EvmExplorerError {
  return new EvmExplorerError(`EVM explorer ${status} error for ${action}`, { action, status });
}

function malformed(action: string): EvmExplorerError {
  return new EvmExplorerError(`EVM explorer malformed response for ${action}`, { action });
}

function positiveIntegerOrDefault(value: number | undefined, defaultValue: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return defaultValue;
  }

  return value;
}
