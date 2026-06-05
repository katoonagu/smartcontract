import { TronWeb } from "tronweb";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import {
  CONTRACT_INTELLIGENCE_TTL_MS,
  deriveActivityLevel,
  inspectRawContractJson,
  type ContractIntelligenceProfile
} from "../approvals/contractIntelligence";
import type { StablecoinRestrictionProfile } from "../types";
import type { TronContractEvent, TronContractEventPage } from "../forensics/tronUsdtEventIndexer";
import {
  createTronscanScheduler,
  type TronscanEndpointBucket,
  type TronscanRequestPriority,
  type TronscanScheduler
} from "./tronscanScheduler";

export type TronClient = {
  listIncomingTrc20Transfers(
    address: string,
    options?: ListIncomingTrc20TransfersOptions
  ): Promise<RawTronscanTrc20Transfer[]>;
  getTransaction(txHash: string): Promise<unknown>;
};

export type TronDashboardClient = TronClient & {
  getAccount(address: string): Promise<TronscanAccount>;
  getUsdtRestrictionStatus?(address: string, options?: GetUsdtRestrictionStatusOptions): Promise<StablecoinRestrictionProfile>;
  listRelatedTrc20Transfers(
    address: string,
    options?: ListRelatedTrc20TransfersOptions
  ): Promise<RawTronscanTrc20Transfer[]>;
  listTransactions(address: string, options?: ListTransactionsOptions): Promise<unknown[]>;
};

export type GetUsdtRestrictionStatusOptions = {
  includeEventTimeline?: boolean;
};

export type TronApprovalClient = {
  listTrc20Approvals(address: string, options?: ListTrc20ApprovalsOptions): Promise<TronscanApprovalListResult>;
  listTrc20ApprovalChanges(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  listRelatedTrc20Transfers?(address: string, options?: ListRelatedTrc20TransfersOptions): Promise<RawTronscanTrc20Transfer[]>;
  getTransaction?(txHash: string): Promise<unknown>;
  getAddressMetadata?(address: string): Promise<TronscanAddressMetadata>;
  getContractIntelligenceProfile?(address: string, options?: GetContractIntelligenceProfileOptions): Promise<ContractIntelligenceProfile>;
  getTransactionSigningMetadata?(txHash: string): Promise<TronTransactionSigningMetadata | null>;
};

export type TronContractProfileClient = {
  listContracts(options?: ListContractsOptions): Promise<TronscanContractSearchResult>;
  getContract(contractAddress: string): Promise<TronscanContractDetail | null>;
  getContractTopCallStats(contractAddress: string): Promise<TronscanContractTopCallStats>;
};

export type TronContractEventClient = {
  listContractEvents(input: {
    contractAddress: string;
    eventName: "Transfer" | "Approval";
    minTimestamp: Date;
    maxTimestamp: Date;
    limit?: number;
    fingerprint?: string | null;
  }): Promise<TronContractEventPage>;
};

type FetchLike = typeof fetch;
type TronGridTransferDirection = "incoming" | "related";
type FetchJsonOptions = {
  logFinalError?: (error: unknown) => boolean;
  shouldRetry?: (error: unknown) => boolean;
};

const TRONGRID_TRANSFER_PAGE_LIMIT = 200;
const TRONGRID_TRANSFER_FALLBACK_MAX_PAGES = 10;

function normalizeApiKeys(value: string | readonly string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0))];
}

export type TronscanAccount = {
  balance?: unknown;
  date_created?: unknown;
  transactions_in?: unknown;
  transactions_out?: unknown;
  totalTransactionCount?: unknown;
  trc20token_balances?: unknown;
  tokenBalances?: unknown;
};

export type ListIncomingTrc20TransfersOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

export type ListRelatedTrc20TransfersOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

export type ListTransactionsOptions = {
  start?: number;
  limit?: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

export type ListTrc20ApprovalsOptions = {
  start?: number;
  limit?: number;
};

export type ListTrc20ApprovalChangesInput = {
  ownerAddress: string;
  spenderAddress: string;
  contractAddress: string;
  start?: number;
  limit?: number;
};

export type GetContractIntelligenceProfileOptions = {
  now?: Date;
  ttlMs?: number;
  requireComplete?: boolean;
};

export type GetAddressMetadataOptions = {
  requireComplete?: boolean;
};

export type ListContractsOptions = {
  search?: string;
  start?: number;
  limit?: number;
  verifiedOnly?: boolean;
  openSourceOnly?: boolean;
  sort?: string;
};

export type TronscanContractProviderTag = {
  kind: "tag1" | "blueTag" | "greyTag" | "redTag";
  label: string;
  url: string | null;
};

export type TronscanContractPublicTag = {
  label: string;
  description: string | null;
};

export type TronscanContractListItem = {
  address: string;
  name: string | null;
  providerTags: TronscanContractProviderTag[];
  publicTags: TronscanContractPublicTag[];
  verified: boolean | null;
  verifyStatus: number | null;
  sourceStatus: string | null;
  contractCreatedAt: Date | null;
  txCount: number | null;
  providerRisk: boolean | null;
  rawJson: Record<string, unknown>;
};

export type TronscanContractSearchResult = {
  contracts: TronscanContractListItem[];
  total: number | null;
  rawJson: Record<string, unknown>;
};

export type TronscanContractDetail = TronscanContractListItem & {
  methodMap: Record<string, string>;
};

export type TronscanContractTopMethod = {
  methodId: string;
  signature: string | null;
  count: number;
  ratio: number | null;
};

export type TronscanContractTopCaller = {
  address: string;
  addressTag: string | null;
  count: number;
  ratio: number | null;
};

export type TronscanContractTopCallStats = {
  recentCallCount: number | null;
  totalCallCount: number | null;
  totalCallerCount: number | null;
  topMethods: TronscanContractTopMethod[];
  topCallers: TronscanContractTopCaller[];
  rawJson: Record<string, unknown>;
};

export type TronscanApprovalListItem = {
  ownerAddress: string;
  spenderAddress: string;
  tokenContract: string;
  amountRaw: string;
  isUnlimited: boolean;
  operateTime: Date | null;
  spenderIsContract: boolean | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
};

export type TronscanApprovalListResult = {
  approvals: TronscanApprovalListItem[];
  total: number | null;
};

export type TronscanApprovalChange = {
  txHash: string;
  ownerAddress: string;
  spenderAddress: string;
  tokenContract: string;
  amountRaw: string;
  isUnlimited: boolean;
  timestamp: Date;
  confirmed: boolean;
  contractRet: string | null;
};

export type TronscanAddressMetadata = {
  address: string;
  source: "tronscan";
  name: string | null;
  tag: string | null;
  isContract: boolean | null;
  verified: boolean | null;
  accountType: number | null;
  rawJson: Record<string, unknown>;
};

export type TronTransactionSigningMetadata = {
  txHash: string;
  signedAt: Date | null;
  expirationAt: Date | null;
  refBlockBytes: string | null;
  refBlockHash: string | null;
};

export type TronscanClientOptions = {
  baseUrl: string | URL;
  fullNodeBaseUrl?: string | URL;
  apiKey?: string | string[];
  fullNodeApiKey?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  requestMinIntervalMs?: number;
  rateLimitCooldownMs?: number;
  scheduler?: TronscanScheduler;
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

export class TronscanClient implements TronDashboardClient, TronApprovalClient, TronContractProfileClient, TronContractEventClient {
  private readonly baseUrl: URL;
  private readonly fullNodeBaseUrl: URL | null;
  private readonly fullNodeApiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly rateLimitCooldownMs: number;
  private readonly fetchFn: FetchLike;
  private readonly logger: Logger;
  private readonly scheduler: TronscanScheduler;

  constructor(options: TronscanClientOptions | string | URL) {
    const normalizedOptions = options instanceof URL || typeof options === "string" ? { baseUrl: options } : options;
    this.baseUrl = new URL(normalizedOptions.baseUrl);
    if (this.baseUrl.protocol !== "https:") {
      throw new Error("TronscanClient baseUrl must use https");
    }
    this.fullNodeBaseUrl = normalizedOptions.fullNodeBaseUrl === undefined
      ? new URL("https://api.trongrid.io")
      : new URL(normalizedOptions.fullNodeBaseUrl);
    if (this.fullNodeBaseUrl.protocol !== "https:") {
      throw new Error("TronscanClient fullNodeBaseUrl must use https");
    }
    const apiKeys = normalizeApiKeys(normalizedOptions.apiKey);
    this.fullNodeApiKey = normalizedOptions.fullNodeApiKey;
    this.timeoutMs = normalizedOptions.timeoutMs ?? 10_000;
    this.retryAttempts = normalizedOptions.retryAttempts ?? 0;
    this.retryBaseDelayMs = normalizedOptions.retryBaseDelayMs ?? 250;
    const requestMinIntervalMs = Math.max(0, normalizedOptions.requestMinIntervalMs ?? 0);
    this.rateLimitCooldownMs = Math.max(0, normalizedOptions.rateLimitCooldownMs ?? 0);
    this.fetchFn = normalizedOptions.fetchFn ?? fetch;
    this.logger = normalizedOptions.logger ?? defaultLogger;
    this.scheduler = normalizedOptions.scheduler ?? createTronscanScheduler({
      requestMinIntervalMs,
      rateLimitCooldownMs: this.rateLimitCooldownMs,
      apiKeys
    });
  }

  async listIncomingTrc20Transfers(
    address: string,
    options: ListIncomingTrc20TransfersOptions = {}
  ): Promise<RawTronscanTrc20Transfer[]> {
    const url = this.buildTronscanTransferHistoryUrl(address, "incoming", options);

    return this.fetchTransferArrayWithFallback(url, {
      address,
      direction: "incoming",
      options
    });
  }

  private buildTronscanTransferHistoryUrl(
    address: string,
    direction: TronGridTransferDirection,
    options: ListIncomingTrc20TransfersOptions | ListRelatedTrc20TransfersOptions,
    tokenContractAddress: string | null = TRON_USDT_CONTRACT_ADDRESS
  ): URL {
    const url = new URL("/api/token_trc20/transfers", this.baseUrl);
    if (direction === "incoming") {
      url.searchParams.set("toAddress", address);
    } else {
      url.searchParams.set("relatedAddress", address);
    }
    if (tokenContractAddress) {
      url.searchParams.set("contract_address", tokenContractAddress);
    }
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

    return url;
  }

  async getAccount(address: string): Promise<TronscanAccount> {
    const url = new URL("/api/account", this.baseUrl);
    url.searchParams.set("address", address);

    const json = await this.fetchJson(url, "account");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan account response must be an object");
    }
    return json as TronscanAccount;
  }

  async getUsdtRestrictionStatus(
    address: string,
    options: GetUsdtRestrictionStatusOptions = {}
  ): Promise<StablecoinRestrictionProfile> {
    const checkedAt = new Date().toISOString();
    const blacklist = await this.callUsdtBoolean("isBlackListed(address)", address)
      .then((isBlacklisted) => ({ isBlacklisted, method: "isBlackListed(address)" as const }))
      .catch(() =>
        this.callUsdtBoolean("getBlackListStatus(address)", address)
          .then((isBlacklisted) => ({ isBlacklisted, method: "getBlackListStatus(address)" as const }))
      );
    const balanceRaw = await this.callUsdtUint("balanceOf(address)", address).catch((error) => {
      this.logger.warn("stablecoin_balance_state_failed", {
        address,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });
    const event = blacklist.isBlacklisted && options.includeEventTimeline === true
      ? await this.findUsdtBlacklistEvent(address).catch((error) => {
        this.logger.warn("stablecoin_blacklist_event_lookup_failed", {
          address,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      })
      : null;

    return {
      subjectAddress: address,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: blacklist.isBlacklisted,
      balanceRaw,
      checkedAt,
      evidenceStrength: "exact_contract_state",
      blacklistEventTxHash: event?.txHash ?? null,
      blacklistEventTimestamp: event?.timestamp ?? null,
      blacklistEventBlock: event?.block ?? null,
      methods: {
        blacklist: blacklist.method,
        balance: balanceRaw === null ? null : "balanceOf(address)"
      }
    };
  }

  async getAddressMetadata(address: string, options: GetAddressMetadataOptions = {}): Promise<TronscanAddressMetadata> {
    const json = await this.getAccount(address);
    const contractMap = this.isObjectRecord((json as Record<string, unknown>).contractMap)
      ? ((json as Record<string, unknown>).contractMap as Record<string, unknown>)
      : {};
    const contractInfo = this.objectField((json as Record<string, unknown>).contractInfo);
    const accountType = this.safeIntegerField((json as Record<string, unknown>).accountType);
    const mapContractValue = contractMap[address];
    const isContract = typeof mapContractValue === "boolean"
      ? mapContractValue
      : accountType === 2
        ? true
        : accountType === 0
          ? false
          : null;
    const contractSearch = isContract === true
      ? await this.getContractSearchMetadata(address, { requireComplete: options.requireComplete })
      : null;
    const verifiedField = contractSearch?.verifyStatus ?? contractInfo?.verified ?? contractInfo?.verify_status ?? contractInfo?.isVerified;
    const verified = typeof verifiedField === "boolean" ? verifiedField : null;
    const name = this.stringField((json as Record<string, unknown>).name ?? (json as Record<string, unknown>).accountName ?? contractSearch?.name ?? contractInfo?.name ?? contractInfo?.contractName);
    const tag = this.stringField(contractSearch?.tag ?? (json as Record<string, unknown>).addressTag ?? (json as Record<string, unknown>).tag);

    return {
      address,
      source: "tronscan",
      name,
      tag,
      isContract,
      verified,
      accountType,
      rawJson: {
        address: (json as Record<string, unknown>).address,
        name,
        tag,
        accountType,
        contractMap,
        contractInfo: contractInfo ?? undefined,
        contractSearch: contractSearch ?? undefined,
        addressTagLogo: (json as Record<string, unknown>).addressTagLogo,
        blueTagUrl: (json as Record<string, unknown>).blueTagUrl
      }
    };
  }

  async getContractIntelligenceProfile(
    address: string,
    options: GetContractIntelligenceProfileOptions = {}
  ): Promise<ContractIntelligenceProfile> {
    const now = options.now ?? new Date();
    const searchJson = await this.fetchContractSearch(address);
    const searchRows = Array.isArray(searchJson.data) ? searchJson.data : [];
    const search = searchRows.find((item) => this.isObjectRecord(item) && item.address === address) as Record<string, unknown> | undefined;
    const detailJson = await this.fetchContractDetail(address).catch((error) => {
      this.logger.warn("tronscan_contract_detail_profile_failed", {
        address,
        error: error instanceof Error ? error.message : String(error)
      });
      if (options.requireComplete === true && this.isTransientError(error)) throw error;
      return {};
    });
    const detailRows = this.isObjectRecord(detailJson) && Array.isArray(detailJson.data) ? detailJson.data : [];
    const detail = detailRows.find((item) => this.isObjectRecord(item) && item.address === address) as Record<string, unknown> | undefined;
    const topCallJson = await this.fetchContractTopCall(address).catch((error) => {
      this.logger.warn("tronscan_contract_top_call_profile_failed", {
        address,
        error: error instanceof Error ? error.message : String(error)
      });
      if (options.requireComplete === true && this.isTransientError(error)) throw error;
      return {};
    });
    const topCall = this.isObjectRecord(topCallJson) ? topCallJson : {};
    const methodMap = this.objectField(detail?.methodMap) ?? {};
    const topMethods = this.parseTopMethods(topCall, methodMap);
    const trxCount = this.safeIntegerField(detail?.trxCount ?? search?.trxCount);
    const totalCallCount = this.safeIntegerField(topCall.totalCallTimes ?? topCall.recentCallTimes);
    const uniqueCallerCount = this.safeIntegerField(topCall.totalAddress);
    const rawJson = {
      contractSearch: search ?? null,
      contractDetail: detail ?? null,
      topCall
    };
    const inspection = inspectRawContractJson({ ...rawJson, methodMap });
    const publicTag = this.stringField(detail?.publicTag ?? search?.publicTag);
    const serviceTag = this.stringField(detail?.tag1 ?? search?.tag1);
    const activityLevel = deriveActivityLevel({
      trxCount,
      totalCallCount,
      uniqueCallerCount,
      topMethods
    });

    return {
      contractAddress: address,
      providerTags: this.contractProviderTags({ ...(search ?? {}), ...(detail ?? {}) }),
      publicTags: this.contractPublicTags({ ...(search ?? {}), ...(detail ?? {}) }),
      isVerified: this.parseVerifiedField(detail?.verify_status ?? search?.verify_status),
      verifyStatus: this.safeIntegerField(detail?.verify_status ?? search?.verify_status),
      sourceStatus: this.sourceStatusField(detail ?? search ?? {}),
      contractAgeDays: null,
      txCount: trxCount === null ? null : String(trxCount),
      recentCallCount: this.safeIntegerField(topCall.recentCallTimes) === null ? null : String(this.safeIntegerField(topCall.recentCallTimes)),
      totalCallerCount: uniqueCallerCount === null ? null : String(uniqueCallerCount),
      rawPayload: rawJson,
      address,
      source: "tronscan",
      name: this.stringField(detail?.name ?? search?.name),
      serviceTag,
      publicTag,
      publicTagDesc: this.stringField(detail?.publicTagDesc ?? search?.publicTagDesc),
      tagUrl: this.stringField(detail?.tag1Url ?? search?.tag1Url ?? detail?.blueTagUrl),
      verified: this.parseVerifiedField(detail?.verify_status ?? search?.verify_status),
      providerRisk: typeof detail?.feedbackRisk === "boolean"
        ? detail.feedbackRisk
        : typeof search?.risk === "boolean"
          ? search.risk
          : null,
      contractCreatedAt: this.dateFromTimestamp(detail?.date_created ?? search?.date_created),
      trxCount: trxCount === null ? null : String(trxCount),
      totalCallCount: totalCallCount === null ? null : String(totalCallCount),
      uniqueCallerCount: uniqueCallerCount === null ? null : String(uniqueCallerCount),
      topMethods,
      topCallers: this.parseTopCallers(topCall),
      methodMap: Object.fromEntries(
        Object.entries(methodMap).flatMap(([key, value]) => {
          const method = this.stringField(value);
          return method ? [[key, method]] : [];
        })
      ),
      hasTransferFromSelector: inspection.hasTransferFromSelector,
      hasOwnerOnlyPattern: inspection.hasOwnerOnlyPattern,
      lowMetadata: inspection.lowMetadata || (!serviceTag && !publicTag && Object.keys(methodMap).length === 0),
      activityLevel,
      rawJson,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + (options.ttlMs ?? CONTRACT_INTELLIGENCE_TTL_MS))
    };
  }

  async getTransactionSigningMetadata(txHash: string): Promise<TronTransactionSigningMetadata | null> {
    if (!this.fullNodeBaseUrl) return null;
    const url = new URL("/wallet/gettransactionbyid", this.fullNodeBaseUrl);
    const json = await this.fetchJson(
      url,
      "raw_transaction",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: txHash })
      },
      this.fullNodeApiKey ?? null
    );
    if (!this.isObjectRecord(json)) {
      throw new Error("TRON raw transaction response must be an object");
    }
    const rawData = this.objectField(json.raw_data);
    if (!rawData) return null;
    return {
      txHash: this.stringField(json.txID) ?? txHash,
      signedAt: this.dateFromTimestamp(rawData.timestamp),
      expirationAt: this.dateFromTimestamp(rawData.expiration),
      refBlockBytes: this.stringField(rawData.ref_block_bytes),
      refBlockHash: this.stringField(rawData.ref_block_hash)
    };
  }

  async listRelatedTrc20Transfers(
    address: string,
    options: ListRelatedTrc20TransfersOptions = {}
  ): Promise<RawTronscanTrc20Transfer[]> {
    const url = this.buildTronscanTransferHistoryUrl(address, "related", options);

    return this.fetchTransferArrayWithFallback(url, {
      address,
      direction: "related",
      options
    });
  }

  async listRelatedTrc20TransfersAllTokens(
    address: string,
    options: ListRelatedTrc20TransfersOptions = {}
  ): Promise<RawTronscanTrc20Transfer[]> {
    const url = this.buildTronscanTransferHistoryUrl(address, "related", options, null);

    return this.fetchTransferArrayWithFallback(url, {
      address,
      direction: "related",
      options,
      tokenContractAddress: null
    });
  }

  async listTransactions(address: string, options: ListTransactionsOptions = {}): Promise<unknown[]> {
    const url = new URL("/api/transaction", this.baseUrl);
    url.searchParams.set("address", address);
    url.searchParams.set("limit", String(options.limit ?? 50));
    url.searchParams.set("start", String(options.start ?? 0));
    if (options.minTimestamp !== undefined) {
      url.searchParams.set("start_timestamp", String(options.minTimestamp));
    }
    if (options.endTimestamp !== undefined) {
      url.searchParams.set("end_timestamp", String(options.endTimestamp));
    }
    url.searchParams.set("sort", "-timestamp");

    const json = await this.fetchJson(url, "transaction_history");
    const transactions = (json as { data?: unknown }).data;
    if (transactions === undefined) {
      throw new Error("Tronscan transaction response data field is missing");
    }
    if (!Array.isArray(transactions)) {
      throw new Error("Tronscan transaction response data must be an array");
    }
    return transactions;
  }

  async listContracts(options: ListContractsOptions = {}): Promise<TronscanContractSearchResult> {
    const url = new URL("/api/contracts", this.baseUrl);
    url.searchParams.set("limit", String(options.limit ?? 20));
    url.searchParams.set("start", String(options.start ?? 0));
    if (options.search !== undefined) url.searchParams.set("search", options.search);
    if (options.verifiedOnly !== undefined) url.searchParams.set("verified-only", String(options.verifiedOnly));
    if (options.openSourceOnly !== undefined) url.searchParams.set("open-source-only", String(options.openSourceOnly));
    if (options.sort !== undefined) url.searchParams.set("sort", options.sort);

    const json = await this.fetchJson(url, "contract_list");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan contract list response must be an object");
    }
    if (!Array.isArray(json.data)) {
      throw new Error("Tronscan contract list response data must be an array");
    }

    return {
      contracts: json.data
        .map((item) => this.parseContractListItem(item))
        .filter((item): item is TronscanContractListItem => item !== null),
      total: this.safeIntegerField(json.total),
      rawJson: json
    };
  }

  async getContract(contractAddress: string): Promise<TronscanContractDetail | null> {
    const url = new URL("/api/contract", this.baseUrl);
    url.searchParams.set("contract", contractAddress);

    const json = await this.fetchJson(url, "contract_detail");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan contract detail response must be an object");
    }
    if (!Array.isArray(json.data)) {
      throw new Error("Tronscan contract detail response data must be an array");
    }

    const match = json.data.find((item) => this.isObjectRecord(item) && item.address === contractAddress) ?? json.data[0];
    return this.parseContractDetail(match);
  }

  async getContractTopCallStats(contractAddress: string): Promise<TronscanContractTopCallStats> {
    const url = new URL("/api/contracts/top_call", this.baseUrl);
    url.searchParams.set("contract_address", contractAddress);

    const json = await this.fetchJson(url, "contract_top_call");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan contract top_call response must be an object");
    }

    const topAddress = Array.isArray(json.topAddress) ? json.topAddress : [];
    const topMethods = Array.isArray(json.topMethods) ? json.topMethods : [];
    return {
      recentCallCount: this.safeIntegerField(json.recentCallTimes),
      totalCallCount: this.safeIntegerField(json.totalCallTimes),
      totalCallerCount: this.safeIntegerField(json.totalAddress),
      topCallers: topAddress
        .map((item) => this.parseContractTopCaller(item))
        .filter((item): item is TronscanContractTopCaller => item !== null),
      topMethods: topMethods
        .map((item) => this.parseContractTopMethod(item))
        .filter((item): item is TronscanContractTopMethod => item !== null),
      rawJson: json
    };
  }

  async listTrc20Approvals(
    address: string,
    options: ListTrc20ApprovalsOptions = {}
  ): Promise<TronscanApprovalListResult> {
    const url = new URL("/api/account/approve/list", this.baseUrl);
    url.searchParams.set("address", address);
    url.searchParams.set("type", "token");
    url.searchParams.set("limit", String(options.limit ?? 50));
    url.searchParams.set("start", String(options.start ?? 0));

    const json = await this.fetchJson(url, "approval_list");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan approval list response must be an object");
    }

    const data = json.data;
    if (data === undefined) {
      throw new Error("Tronscan approval list response data field is missing");
    }
    if (!Array.isArray(data)) {
      throw new Error("Tronscan approval list response data must be an array");
    }

    const contractMap = this.isObjectRecord(json.contractMap) ? json.contractMap : {};
    const total = typeof json.total === "number" && Number.isFinite(json.total) ? json.total : null;
    return {
      approvals: data
        .map((item) => this.parseApprovalListItem(item, contractMap))
        .filter((item): item is TronscanApprovalListItem => item !== null),
      total
    };
  }

  async listTrc20ApprovalChanges(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]> {
    const url = new URL("/api/account/approve/change", this.baseUrl);
    url.searchParams.set("from_address", input.ownerAddress);
    url.searchParams.set("to_address", input.spenderAddress);
    url.searchParams.set("contract_address", input.contractAddress);
    url.searchParams.set("type", "approve");
    url.searchParams.set("limit", String(input.limit ?? 20));
    url.searchParams.set("start", String(input.start ?? 0));

    const json = await this.fetchJson(url, "approval_change");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan approval change response must be an object");
    }

    const data = json.data;
    if (data === undefined) {
      throw new Error("Tronscan approval change response data field is missing");
    }
    if (!Array.isArray(data)) {
      throw new Error("Tronscan approval change response data must be an array");
    }

    return data
      .map((item) => this.parseApprovalChange(item))
      .filter((item): item is TronscanApprovalChange => item !== null);
  }

  async listContractEvents(input: {
    contractAddress: string;
    eventName: "Transfer" | "Approval";
    minTimestamp: Date;
    maxTimestamp: Date;
    limit?: number;
    fingerprint?: string | null;
  }): Promise<TronContractEventPage> {
    if (!this.fullNodeBaseUrl) {
      throw new Error("TRON full node base URL is not configured");
    }
    const url = new URL(`/v1/contracts/${input.contractAddress}/events`, this.fullNodeBaseUrl);
    url.searchParams.set("event_name", input.eventName);
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("limit", String(input.limit ?? 200));
    url.searchParams.set("order_by", "block_timestamp,asc");
    url.searchParams.set("min_timestamp", String(input.minTimestamp.getTime()));
    url.searchParams.set("max_timestamp", String(input.maxTimestamp.getTime()));
    if (input.fingerprint) url.searchParams.set("fingerprint", input.fingerprint);

    const json = await this.fetchJson(url, "contract_events", {}, this.fullNodeApiKey ?? null);
    if (!this.isObjectRecord(json)) {
      throw new Error("TRON contract events response must be an object");
    }
    const data = Array.isArray(json.data) ? json.data : [];
    const meta = this.objectField(json.meta);
    return {
      events: data
        .map((row) => this.parseContractEventRow(row, input.contractAddress, input.eventName))
        .filter((event): event is TronContractEvent => event !== null),
      fingerprint: this.stringField(meta?.fingerprint)
    };
  }

  async getTransaction(txHash: string): Promise<unknown> {
    const url = new URL("/api/transaction-info", this.baseUrl);
    url.searchParams.set("hash", txHash);

    return this.fetchJson(url, "transaction");
  }

  private encodeAddressParameter(address: string): string {
    return TronWeb.address.toHex(address).replace(/^41/i, "").padStart(64, "0");
  }

  private async triggerUsdtConstant(functionSelector: string, address: string): Promise<string> {
    if (!this.fullNodeBaseUrl) {
      throw new Error("TRON full node base URL is not configured");
    }
    const url = new URL("/wallet/triggerconstantcontract", this.fullNodeBaseUrl);
    const json = await this.fetchJson(
      url,
      "stablecoin_contract_state",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner_address: TronWeb.address.toHex(address),
          contract_address: TronWeb.address.toHex(TRON_USDT_CONTRACT_ADDRESS),
          function_selector: functionSelector,
          parameter: this.encodeAddressParameter(address)
        })
      },
      this.fullNodeApiKey ?? null
    );
    if (!this.isObjectRecord(json)) {
      throw new Error("TRON full node contract response must be an object");
    }
    const result = this.objectField(json.result);
    if (result && result.result !== true) {
      throw new Error(`TRON full node contract call failed: ${functionSelector}`);
    }
    const constantResult = Array.isArray(json.constant_result) ? json.constant_result : [];
    const first = constantResult[0];
    if (typeof first !== "string" || !/^[0-9a-fA-F]+$/.test(first)) {
      throw new Error(`TRON full node contract call missing constant_result: ${functionSelector}`);
    }
    return first;
  }

  private async callUsdtBoolean(functionSelector: "isBlackListed(address)" | "getBlackListStatus(address)", address: string): Promise<boolean> {
    const raw = await this.triggerUsdtConstant(functionSelector, address);
    return BigInt(`0x${raw}`) !== 0n;
  }

  private async callUsdtUint(functionSelector: "balanceOf(address)", address: string): Promise<string> {
    const raw = await this.triggerUsdtConstant(functionSelector, address);
    return BigInt(`0x${raw}`).toString();
  }

  private async findUsdtBlacklistEvent(address: string): Promise<{ txHash: string; timestamp: string; block: number } | null> {
    if (!this.fullNodeBaseUrl) return null;
    const target = `0x${TronWeb.address.toHex(address).replace(/^41/i, "").toLowerCase()}`;
    const url = new URL(`/v1/contracts/${TRON_USDT_CONTRACT_ADDRESS}/events`, this.fullNodeBaseUrl);
    url.searchParams.set("event_name", "AddedBlackList");
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("limit", "50");
    url.searchParams.set("order_by", "block_timestamp,desc");

    const json = await this.fetchJson(url, "stablecoin_blacklist_event", {}, this.fullNodeApiKey ?? null);
    if (!this.isObjectRecord(json)) return null;
    const rows = Array.isArray(json.data) ? json.data : [];
    for (const row of rows) {
      if (!this.isObjectRecord(row)) continue;
      const result = this.objectField(row.result);
      const user = this.stringField(result?._user ?? result?.["0"]);
      if (user?.toLowerCase() !== target) continue;
      const txHash = this.stringField(row.transaction_id);
      const timestampMs = this.safeIntegerField(row.block_timestamp);
      const block = this.safeIntegerField(row.block_number);
      if (!txHash || timestampMs === null || block === null) return null;
      return {
        txHash,
        timestamp: new Date(timestampMs).toISOString(),
        block
      };
    }
    return null;
  }

  private parseContractEventRow(row: unknown, contractAddress: string, eventName: string): TronContractEvent | null {
    if (!this.isObjectRecord(row)) return null;
    const transactionId = this.stringField(row.transaction_id ?? row.transaction);
    const blockNumber = this.safeIntegerField(row.block_number);
    const blockTimestampMs = this.safeIntegerField(row.block_timestamp);
    const result = this.objectField(row.result) ?? {};
    if (!transactionId || blockNumber === null || blockTimestampMs === null) return null;
    const eventIndex = this.safeIntegerField(row.event_index ?? row.log_index ?? row.eventIndex) ?? 0;
    const methodText = [
      this.stringField(row.method),
      this.stringField(row.method_name),
      this.stringField(row.trigger_name)
    ].filter(Boolean).join(" ").toLowerCase();
    return {
      transactionId,
      blockNumber,
      blockTimestamp: new Date(blockTimestampMs),
      eventIndex,
      eventName: this.stringField(row.event_name) ?? eventName,
      result,
      contractAddress: this.stringField(row.contract_address) ?? contractAddress,
      confirmed: row.confirmed !== false,
      contractRet: this.stringField(row.contractRet ?? row.contract_ret),
      callerAddress: this.stringField(row.caller_address ?? row.owner_address),
      method: methodText.includes("transferfrom") || methodText.includes("23b872dd") ? "transferFrom" : methodText.includes("transfer") ? "transfer" : null,
      rawJson: row
    };
  }

  private async fetchTransferArrayWithFallback(
    url: URL,
    fallback: {
      address: string;
      direction: TronGridTransferDirection;
      options: ListIncomingTrc20TransfersOptions | ListRelatedTrc20TransfersOptions;
      tokenContractAddress?: string | null;
    }
  ): Promise<RawTronscanTrc20Transfer[]> {
    try {
      return await this.fetchTronscanTransferArray(url);
    } catch (error) {
      if (!this.shouldFallbackToTronGridTransferHistory(error)) throw error;
      this.logger.warn("trongrid_transfer_history_fallback", {
        address: fallback.address,
        direction: fallback.direction,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.fetchTronGridTransferArray(fallback);
    }
  }

  private async fetchTronscanTransferArray(url: URL): Promise<RawTronscanTrc20Transfer[]> {
    const json = await this.fetchJson(url, "transfer", {}, undefined, {
      logFinalError: (error) => !this.shouldFallbackToTronGridTransferHistory(error),
      shouldRetry: (error) => this.isTransientError(error) && !this.shouldFallbackToTronGridTransferHistory(error)
    });
    const transfers = (json as { token_transfers?: unknown }).token_transfers;
    if (transfers === undefined) {
      throw new Error("Tronscan transfer response token_transfers field is missing");
    }
    if (!Array.isArray(transfers)) {
      throw new Error("Tronscan transfer response token_transfers must be an array");
    }
    return transfers as RawTronscanTrc20Transfer[];
  }

  private async fetchTronGridTransferArray(input: {
    address: string;
    direction: TronGridTransferDirection;
    options: ListIncomingTrc20TransfersOptions | ListRelatedTrc20TransfersOptions;
    tokenContractAddress?: string | null;
  }): Promise<RawTronscanTrc20Transfer[]> {
    if (!this.fullNodeBaseUrl) {
      throw new Error("TRON full node base URL is not configured");
    }

    const start = Math.max(0, input.options.start ?? 0);
    const limit = Math.max(0, input.options.limit ?? 50);
    if (limit === 0) return [];

    const targetCount = start + limit;
    const transfers: RawTronscanTrc20Transfer[] = [];
    let fingerprint: string | null = null;

    for (let page = 0; page < TRONGRID_TRANSFER_FALLBACK_MAX_PAGES && transfers.length < targetCount; page += 1) {
      const pageLimit = Math.min(TRONGRID_TRANSFER_PAGE_LIMIT, targetCount - transfers.length);
      const url = this.buildTronGridTransferHistoryUrl(input, pageLimit, fingerprint);
      const json = await this.fetchJson(url, "trongrid_transfer_history", {}, this.fullNodeApiKey ?? null);
      if (!this.isObjectRecord(json)) {
        throw new Error("TronGrid transfer response must be an object");
      }
      const data = json.data;
      if (data === undefined) {
        throw new Error("TronGrid transfer response data field is missing");
      }
      if (!Array.isArray(data)) {
        throw new Error("TronGrid transfer response data must be an array");
      }
      transfers.push(
        ...data
          .map((item) => this.parseTronGridTrc20Transfer(item, input.tokenContractAddress))
          .filter((item): item is RawTronscanTrc20Transfer => item !== null)
      );

      const meta = this.objectField(json.meta);
      fingerprint = this.stringField(meta?.fingerprint);
      if (data.length === 0 || !fingerprint) break;
    }

    return transfers.slice(start, start + limit);
  }

  private buildTronGridTransferHistoryUrl(
    input: {
      address: string;
      direction: TronGridTransferDirection;
      options: ListIncomingTrc20TransfersOptions | ListRelatedTrc20TransfersOptions;
      tokenContractAddress?: string | null;
    },
    limit: number,
    fingerprint: string | null
  ): URL {
    if (!this.fullNodeBaseUrl) {
      throw new Error("TRON full node base URL is not configured");
    }
    const url = new URL(`/v1/accounts/${input.address}/transactions/trc20`, this.fullNodeBaseUrl);
    const tokenContractAddress = input.tokenContractAddress === undefined
      ? TRON_USDT_CONTRACT_ADDRESS
      : input.tokenContractAddress;
    if (tokenContractAddress) {
      url.searchParams.set("contract_address", tokenContractAddress);
    }
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("order_by", "block_timestamp,desc");
    url.searchParams.set("limit", String(limit));
    if (input.direction === "incoming") {
      url.searchParams.set("only_to", "true");
    }
    if (input.options.minTimestamp !== undefined) {
      url.searchParams.set("min_timestamp", String(input.options.minTimestamp));
    }
    if (input.options.endTimestamp !== undefined) {
      url.searchParams.set("max_timestamp", String(input.options.endTimestamp));
    }
    if (fingerprint) {
      url.searchParams.set("fingerprint", fingerprint);
    }
    return url;
  }

  private parseTronGridTrc20Transfer(
    row: unknown,
    tokenContractAddress?: string | null
  ): RawTronscanTrc20Transfer | null {
    if (!this.isObjectRecord(row)) return null;
    const tokenInfo = this.objectField(row.token_info ?? row.tokenInfo);
    const transactionId = this.stringField(row.transaction_id ?? row.transactionId ?? row.txID);
    const fromAddress = this.normalizeTronGridAddress(this.stringField(row.from ?? row.from_address));
    const toAddress = this.normalizeTronGridAddress(this.stringField(row.to ?? row.to_address));
    const amountRaw = this.stringField(row.value ?? row.quant ?? row.amount);
    const timestamp = this.safeIntegerField(row.block_timestamp ?? row.block_ts);
    if (!transactionId || !fromAddress || !toAddress || !amountRaw || timestamp === null) return null;
    const canDefaultToUsdt = tokenContractAddress === undefined || tokenContractAddress === TRON_USDT_CONTRACT_ADDRESS;
    const tokenAddress = this.stringField(tokenInfo?.address ?? row.contract_address ?? row.contractAddress)
      ?? (canDefaultToUsdt ? TRON_USDT_CONTRACT_ADDRESS : null);
    const tokenDecimals = this.safeIntegerField(tokenInfo?.decimals ?? tokenInfo?.tokenDecimal)
      ?? (canDefaultToUsdt ? 6 : null);
    const tokenSymbol = this.stringField(tokenInfo?.symbol ?? tokenInfo?.tokenAbbr)
      ?? (canDefaultToUsdt ? "USDT" : null);
    const transfer: RawTronscanTrc20Transfer = {
      transaction_id: transactionId,
      from_address: fromAddress,
      to_address: toAddress,
      quant: amountRaw,
      confirmed: true,
      contractRet: "SUCCESS",
      finalResult: "SUCCESS",
      status: "SUCCESS",
      block_ts: timestamp
    };
    if (tokenAddress) {
      transfer.contract_address = tokenAddress;
    }
    if (tokenAddress || tokenDecimals !== null || tokenSymbol) {
      transfer.tokenInfo = {
        ...(tokenSymbol ? { tokenAbbr: tokenSymbol } : {}),
        ...(tokenDecimals !== null ? { tokenDecimal: tokenDecimals } : {}),
        ...(tokenAddress ? { tokenId: tokenAddress } : {}),
        tokenType: "trc20"
      };
    }
    return transfer;
  }

  private normalizeTronGridAddress(address: string | null): string | null {
    if (!address) return null;
    if (/^41[0-9a-fA-F]{40}$/.test(address)) return TronWeb.address.fromHex(address);
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) return TronWeb.address.fromHex(`41${address.slice(2)}`);
    return address;
  }

  private async getContractSearchMetadata(
    address: string,
    options: { requireComplete?: boolean } = {}
  ): Promise<Record<string, unknown> | null> {
    try {
      const json = await this.fetchContractSearch(address);
      const data = this.isObjectRecord(json) ? json.data : undefined;
      if (!Array.isArray(data)) return null;
      const match = data.find((item) => this.isObjectRecord(item) && item.address === address);
      if (!this.isObjectRecord(match)) return null;
      return {
        address: this.stringField(match.address),
        name: this.stringField(match.name),
        tag: this.stringField(match.tag1 ?? match.publicTag),
        tagUrl: this.stringField(match.tag1Url),
        publicTagDesc: this.stringField(match.publicTagDesc),
        risk: typeof match.risk === "boolean" ? match.risk : null,
        verifyStatus: this.parseVerifiedField(match.verify_status),
        dateCreated: this.safeIntegerField(match.date_created),
        license: this.stringField(match.license),
        compileVersion: this.stringField(match.compile_version)
      };
    } catch (error) {
      this.logger.warn("tronscan_contract_search_metadata_failed", {
        address,
        error: error instanceof Error ? error.message : String(error)
      });
      if (options.requireComplete === true && this.isTransientError(error)) throw error;
      return null;
    }
  }

  private async fetchContractSearch(address: string): Promise<Record<string, unknown>> {
    const url = new URL("/api/contracts", this.baseUrl);
    url.searchParams.set("search", address);
    url.searchParams.set("limit", "1");
    url.searchParams.set("start", "0");

    const json = await this.fetchJson(url, "contract_search");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan contract search response must be an object");
    }
    return json;
  }

  private async fetchContractDetail(address: string): Promise<Record<string, unknown>> {
    const url = new URL("/api/contract", this.baseUrl);
    url.searchParams.set("contract", address);

    const json = await this.fetchJson(url, "contract_detail");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan contract detail response must be an object");
    }
    return json;
  }

  private async fetchContractTopCall(address: string): Promise<Record<string, unknown>> {
    const url = new URL("/api/contracts/top_call", this.baseUrl);
    url.searchParams.set("contract_address", address);
    url.searchParams.set("limit", "5");

    const json = await this.fetchJson(url, "contract_top_call");
    if (!this.isObjectRecord(json)) {
      throw new Error("Tronscan contract top call response must be an object");
    }
    return json;
  }

  private parseTopMethods(
    topCall: Record<string, unknown>,
    methodMap: Record<string, unknown>
  ): ContractIntelligenceProfile["topMethods"] {
    const rows = Array.isArray(topCall.topMethods) ? topCall.topMethods : [];
    return rows
      .filter((item): item is Record<string, unknown> => this.isObjectRecord(item))
      .map((item) => {
        const methodId = this.stringField(item.methodId);
        const mappedMethod = methodId ? this.stringField(methodMap[methodId]) : null;
        const calls = this.safeIntegerField(item.times ?? item.count) ?? 0;
        const percentage = this.numberField(item.ratio ?? item.percentage);
        return {
          methodId: methodId ?? "unknown",
          signature: mappedMethod,
          count: calls,
          ratio: percentage,
          method: mappedMethod ?? this.stringField(item.methodName ?? item.method ?? methodId) ?? "unknown",
          calls,
          percentage
        };
      });
  }

  private parseTopCallers(topCall: Record<string, unknown>): ContractIntelligenceProfile["topCallers"] {
    const rows = Array.isArray(topCall.topAddress) ? topCall.topAddress : [];
    return rows
      .filter((item): item is Record<string, unknown> => this.isObjectRecord(item))
      .map((item) => {
        const calls = this.safeIntegerField(item.count ?? item.times) ?? 0;
        const percentage = this.numberField(item.ratio ?? item.percentage);
        return {
          address: this.stringField(item.address) ?? "unknown",
          addressTag: this.stringField(item.addressTag ?? item.callerAddressTag),
          count: calls,
          ratio: percentage,
          calls,
          percentage
        };
      });
  }

  private parseVerifiedField(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return value > 0;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value) > 0;
    return null;
  }

  private async fetchJson(
    url: URL,
    requestName: string,
    init: RequestInit = {},
    apiKey?: string | null,
    options: FetchJsonOptions = {}
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        const json = await this.fetchJsonOnce(url, requestName, init, apiKey, attempt);
        this.logger.info("tronscan_request_success", {
          request_name: requestName,
          attempt,
          path: url.pathname
        });
        return json;
      } catch (error) {
        const shouldRetry = options.shouldRetry?.(error) ?? this.isTransientError(error);
        if (attempt >= this.retryAttempts || !shouldRetry) {
          if (options.logFinalError?.(error) ?? true) {
            this.logger.error("tronscan_request_failed", {
              request_name: requestName,
              attempt,
              path: url.pathname,
              error: error instanceof Error ? error.message : String(error)
            });
          }
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

  private async fetchJsonOnce(
    url: URL,
    requestName: string,
    init: RequestInit = {},
    apiKey?: string | null,
    attempt = 0
  ): Promise<unknown> {
    const endpointBucket = this.endpointBucketForRequest(requestName);
    const work = async (context: { apiKey: string | null; apiKeyIndex: number | null }) => {
      const actualApiKeyIndex = apiKey === undefined ? context.apiKeyIndex : null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        this.logger.info("tronscan_request_attempt", {
          request_name: requestName,
          attempt,
          path: url.pathname,
          api_key_index: actualApiKeyIndex,
          endpoint_bucket: endpointBucket
        });
        const headers = new Headers(init.headers);
        const selectedApiKey = apiKey === undefined ? context.apiKey : apiKey;
        if (selectedApiKey) headers.set("TRON-PRO-API-KEY", selectedApiKey);
        const response = await this.fetchFn(url, { ...init, headers, signal: controller.signal });
        if (!response.ok) {
          if (response.status === 429) {
            this.logRateLimitResponse({
              url,
              requestName,
              endpointBucket,
              apiKeyIndex: actualApiKeyIndex
            });
          }
          throw new TronscanHttpError(`Tronscan ${requestName} request failed: ${response.status}`, response.status);
        }
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    return this.scheduler.schedule(
      {
        requestName,
        path: url.pathname,
        priority: this.priorityForRequest(requestName),
        cacheKey: requestName === "transfer" ? url.toString() : undefined,
        slotScope: apiKey === undefined ? "pool" : "single",
        endpointBucket
      },
      work
    );
  }

  private endpointBucketForRequest(requestName: string): TronscanEndpointBucket {
    if (requestName === "transfer" || requestName === "transaction_history") return "transfer";
    if (requestName === "approval_list" || requestName === "approval_change") return "approval";
    if (requestName === "trongrid_transfer_history") return "trongrid";
    if (
      requestName === "transaction" ||
      requestName === "raw_transaction" ||
      requestName === "stablecoin_contract_state" ||
      requestName === "stablecoin_blacklist_event"
    ) {
      return "fullnode";
    }
    if (
      requestName === "contract_list" ||
      requestName === "contract_detail" ||
      requestName === "contract_top_call" ||
      requestName === "contract_search" ||
      requestName === "contract_events" ||
      requestName.startsWith("contract")
    ) {
      return "contract";
    }
    return "default";
  }

  private priorityForRequest(requestName: string): TronscanRequestPriority {
    if (requestName === "trongrid_transfer_history") return "interactive_fast";
    if (requestName === "transfer" || requestName === "transaction_history") return "deep_transfer";
    if (requestName === "account") return "metadata";
    if (
      requestName === "transaction" ||
      requestName === "approval_list" ||
      requestName === "approval_change" ||
      requestName === "stablecoin_contract_state" ||
      requestName === "stablecoin_blacklist_event" ||
      requestName.startsWith("contract")
    ) {
      return "contract_profile";
    }
    return "interactive_fast";
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

  private shouldFallbackToTronGridTransferHistory(error: unknown): boolean {
    if (!(error instanceof TronscanHttpError)) return false;
    return error.status === 408 || error.status === 429 || (error.status >= 500 && error.status <= 599);
  }

  private isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private parseApprovalListItem(item: unknown, contractMap: Record<string, unknown>): TronscanApprovalListItem | null {
    if (!this.isObjectRecord(item)) return null;
    const ownerAddress = this.stringField(item.from_address);
    const spenderAddress = this.stringField(item.to_address);
    const tokenContract = this.stringField(item.contract_address ?? this.objectField(item.tokenInfo)?.tokenId);
    const amountRaw = this.stringField(item.amount);
    if (!ownerAddress || !spenderAddress || !tokenContract || !amountRaw) return null;

    return {
      ownerAddress,
      spenderAddress,
      tokenContract,
      amountRaw,
      isUnlimited: item.unlimited === true,
      operateTime: this.dateFromTimestamp(item.operate_time),
      spenderIsContract: typeof contractMap[spenderAddress] === "boolean" ? (contractMap[spenderAddress] as boolean) : null,
      tokenSymbol: this.stringField(this.objectField(item.tokenInfo)?.tokenAbbr),
      tokenDecimals: this.safeIntegerField(this.objectField(item.tokenInfo)?.tokenDecimal)
    };
  }

  private parseApprovalChange(item: unknown): TronscanApprovalChange | null {
    if (!this.isObjectRecord(item)) return null;
    const txHash = this.stringField(item.hash);
    const ownerAddress = this.stringField(item.owner_address ?? item.from_address);
    const spenderAddress = this.stringField(item.to_address);
    const tokenContract = this.stringField(item.contract_address);
    const amountRaw = this.stringField(item.amount_str ?? item.amount);
    const timestamp = this.dateFromTimestamp(item.date_created);
    if (!txHash || !ownerAddress || !spenderAddress || !tokenContract || !amountRaw || !timestamp) return null;

    return {
      txHash,
      ownerAddress,
      spenderAddress,
      tokenContract,
      amountRaw,
      isUnlimited: item.unlimited === true,
      timestamp,
      confirmed: item.confirmed === true,
      contractRet: this.stringField(item.contract_ret)
    };
  }

  private parseContractListItem(item: unknown): TronscanContractListItem | null {
    if (!this.isObjectRecord(item)) return null;
    const address = this.stringField(item.address ?? item.contractAddress);
    if (!address) return null;
    const verifyStatus = this.safeIntegerField(item.verify_status ?? item.verifyStatus);
    return {
      address,
      name: this.stringField(item.name ?? item.contractName),
      providerTags: this.contractProviderTags(item),
      publicTags: this.contractPublicTags(item),
      verified: this.parseVerifiedField(item.verified ?? item.verify_status ?? item.verifyStatus),
      verifyStatus,
      sourceStatus: this.sourceStatusField(item),
      contractCreatedAt: this.dateFromTimestamp(item.date_created ?? item.dateCreated),
      txCount: this.safeIntegerField(item.trxCount ?? item.tx_count),
      providerRisk: this.providerRiskField(item),
      rawJson: item
    };
  }

  private parseContractDetail(item: unknown): TronscanContractDetail | null {
    const base = this.parseContractListItem(item);
    if (!base || !this.isObjectRecord(item)) return null;
    return {
      ...base,
      sourceStatus: this.sourceStatusField(item) ?? base.sourceStatus,
      methodMap: this.stringRecordField(item.methodMap)
    };
  }

  private parseContractTopMethod(item: unknown): TronscanContractTopMethod | null {
    if (!this.isObjectRecord(item)) return null;
    const methodId = this.stringField(item.methodId ?? item.method_id);
    const count = this.safeIntegerField(item.times ?? item.count);
    if (!methodId || count === null) return null;
    return {
      methodId,
      signature: this.stringField(item.method ?? item.signature),
      count,
      ratio: this.finiteNumberField(item.ratio)
    };
  }

  private parseContractTopCaller(item: unknown): TronscanContractTopCaller | null {
    if (!this.isObjectRecord(item)) return null;
    const address = this.stringField(item.address ?? item.caller_address);
    const count = this.safeIntegerField(item.count ?? item.amount);
    if (!address || count === null) return null;
    return {
      address,
      addressTag: this.stringField(item.addressTag ?? item.callerAddressTag),
      count,
      ratio: this.finiteNumberField(item.ratio)
    };
  }

  private contractProviderTags(item: Record<string, unknown>): TronscanContractProviderTag[] {
    const tagFields: Array<[TronscanContractProviderTag["kind"], string]> = [
      ["tag1", "tag1Url"],
      ["blueTag", "blueTagUrl"],
      ["greyTag", "greyTagUrl"],
      ["redTag", "redTagUrl"]
    ];
    return tagFields.flatMap(([kind, urlField]) => {
      const label = this.stringField(item[kind]);
      if (!label) return [];
      return [{ kind, label, url: this.stringField(item[urlField]) }];
    });
  }

  private contractPublicTags(item: Record<string, unknown>): TronscanContractPublicTag[] {
    const label = this.stringField(item.publicTag);
    if (!label) return [];
    return [{ label, description: this.stringField(item.publicTagDesc) }];
  }

  private providerRiskField(item: Record<string, unknown>): boolean | null {
    if (typeof item.risk === "boolean") return item.risk;
    if (typeof item.feedbackRisk === "boolean") return item.feedbackRisk;
    return null;
  }

  private sourceStatusField(item: Record<string, unknown>): string | null {
    const explicit = this.stringField(item.sourceStatus ?? item.source_status ?? item.source_code_status);
    if (explicit) return explicit;
    if (this.stringField(item.sourceCode ?? item.source_code)) return "available";
    if (item.open_source === true || item.openSource === true) return "open_source";
    if (item.open_source === false || item.openSource === false) return "missing";
    if (typeof item.open_source === "number") return item.open_source > 0 ? "open_source" : "missing";
    return null;
  }

  private objectField(value: unknown): Record<string, unknown> | null {
    return this.isObjectRecord(value) ? value : null;
  }

  private stringField(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    return null;
  }

  private safeIntegerField(value: unknown): number | null {
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
  }

  private numberField(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private finiteNumberField(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
  }

  private stringRecordField(value: unknown): Record<string, string> {
    if (!this.isObjectRecord(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    );
  }

  private dateFromTimestamp(value: unknown): Date | null {
    const timestamp = this.safeIntegerField(value);
    if (timestamp === null) return null;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private logRateLimitResponse(input: {
    url: URL;
    requestName: string;
    endpointBucket: TronscanEndpointBucket;
    apiKeyIndex: number | null;
  }): void {
    if (this.rateLimitCooldownMs <= 0) return;
    this.logger.warn("tronscan_rate_limit_cooldown", {
      request_name: input.requestName,
      path: input.url.pathname,
      endpoint_bucket: input.endpointBucket,
      api_key_index: input.apiKeyIndex,
      cooldown_ms: this.rateLimitCooldownMs
    });
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
