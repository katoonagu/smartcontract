import type { AppConfig } from "../config";
import type { WalletApprovalSummary, WalletDashboardSnapshot, WalletPollState } from "../storage/repositories";
import type { AddressLabel, WatchedWallet } from "../types";
import type { TronDashboardClient } from "../tron/tronClient";
import {
  calculateFeeSummary,
  calculateUsdtTransferFlow,
  calculateWalletSafetyReport,
  parseAccountMetrics,
  type WalletSafetyReport
} from "./metrics";

const DASHBOARD_PAGE_LIMIT = 50;
const THIRTY_DAYS_MS = 30 * 86_400_000;
const MAX_ERROR_LENGTH = 512;

export type WalletDashboardSource = "cache" | "fresh" | "stale" | "error";

export type WalletDashboard = {
  wallet: WatchedWallet;
  snapshot: WalletDashboardSnapshot;
  safety: WalletSafetyReport;
  approvalSummary: WalletApprovalSummary;
  pollState: WalletPollState | null;
  source: WalletDashboardSource;
  cacheAgeMs: number | null;
  lastError: string | null;
};

export type WalletDashboardDeps = {
  tronClient: TronDashboardClient;
  config: Pick<AppConfig, "tronscanDashboardCacheTtlMs" | "tronscanDashboardMaxPages" | "tronscanDashboardForceRefreshCooldownMs">;
  getSnapshot(watchedWalletId: string): Promise<WalletDashboardSnapshot | null>;
  upsertSnapshot(snapshot: WalletDashboardSnapshot): Promise<void>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getPollState(watchedWalletId: string): Promise<WalletPollState | null>;
  getApprovalSummary?(watchedWalletId: string): Promise<WalletApprovalSummary>;
  now?(): Date;
};

export type GetWalletDashboardInput = {
  wallet: WatchedWallet;
  forceRefresh?: boolean;
};

type PageFetch<T> = (start: number) => Promise<T[]>;

type PagedResult<T> = {
  items: T[];
  partial: boolean;
};

function boundError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function cacheAgeMs(snapshot: WalletDashboardSnapshot, now: Date): number {
  return Math.max(0, now.getTime() - snapshot.refreshedAt.getTime());
}

function isCacheFresh(snapshot: WalletDashboardSnapshot, now: Date, ttlMs: number): boolean {
  if (snapshot.lastError) return false;
  return cacheAgeMs(snapshot, now) <= ttlMs;
}

function formatMicroUnits(value: bigint): string {
  const divisor = 1_000_000n;
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  return `${whole.toString()}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function parseUsdtDecimalToMicro(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function calculateWalletAgeDays(walletCreatedAt: Date | null, now: Date): number | null {
  if (!walletCreatedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - walletCreatedAt.getTime()) / 86_400_000));
}

async function fetchPages<T>(input: {
  maxPages: number;
  pageLimit: number;
  fetchPage: PageFetch<T>;
}): Promise<PagedResult<T>> {
  const items: T[] = [];
  let partial = false;

  for (let page = 0; page < input.maxPages; page += 1) {
    const batch = await input.fetchPage(page * input.pageLimit);
    items.push(...batch);

    if (batch.length < input.pageLimit) {
      return { items, partial: false };
    }

    if (page === input.maxPages - 1) {
      partial = true;
    }
  }

  return { items, partial };
}

async function buildDashboardFromSnapshot(input: {
  wallet: WatchedWallet;
  snapshot: WalletDashboardSnapshot;
  pollState: WalletPollState | null;
  labels: AddressLabel[];
  approvalSummary: WalletApprovalSummary;
  source: WalletDashboardSource;
  now: Date;
  lastError?: string | null;
}): Promise<WalletDashboard> {
  const thirtyDayVolumeMicro =
    parseUsdtDecimalToMicro(input.snapshot.thirtyDayInUsdt) + parseUsdtDecimalToMicro(input.snapshot.thirtyDayOutUsdt);
  const safety = calculateWalletSafetyReport({
    address: input.wallet.address,
    labels: input.labels,
    walletAgeDays: calculateWalletAgeDays(input.snapshot.walletCreatedAt, input.now),
    thirtyDayUsdtVolumeMicro: thirtyDayVolumeMicro
  });

  return {
    wallet: input.wallet,
    snapshot: input.snapshot,
    safety,
    approvalSummary: input.approvalSummary,
    pollState: input.pollState,
    source: input.source,
    cacheAgeMs: cacheAgeMs(input.snapshot, input.now),
    lastError: input.lastError ?? input.snapshot.lastError
  };
}

function createEmptySnapshot(input: {
  watchedWalletId: string;
  now: Date;
  error: string;
}): WalletDashboardSnapshot {
  return {
    watchedWalletId: input.watchedWalletId,
    trxBalanceSun: "0",
    usdtBalanceMicro: "0",
    walletCreatedAt: null,
    totalTxCount: null,
    incomingTxCount: null,
    outgoingTxCount: null,
    thirtyDayInUsdt: "0",
    thirtyDayOutUsdt: "0",
    thirtyDayTransferCount: 0,
    thirtyDayFeeSun: "0",
    trxUsdPrice: null,
    analyticsPartial: true,
    refreshedAt: input.now,
    lastError: input.error
  };
}

export async function getWalletDashboard(
  deps: WalletDashboardDeps,
  input: GetWalletDashboardInput
): Promise<WalletDashboard> {
  const now = deps.now?.() ?? new Date();
  const emptyApprovalSummary: WalletApprovalSummary = {
    usdtApprovalCount: 0,
    unlimitedApprovalCount: 0,
    highRiskApprovalCount: 0,
    topRiskyApprovals: [],
    drainObservationCount: 0,
    highRiskDrainObservationCount: 0,
    topDrainObservations: []
  };
  const [cached, pollState, labels, approvalSummary] = await Promise.all([
    deps.getSnapshot(input.wallet.id),
    deps.getPollState(input.wallet.id),
    deps.getLabelsForAddress(input.wallet.address),
    deps.getApprovalSummary?.(input.wallet.id) ?? Promise.resolve(emptyApprovalSummary)
  ]);

  if (cached && !input.forceRefresh && isCacheFresh(cached, now, deps.config.tronscanDashboardCacheTtlMs)) {
    return buildDashboardFromSnapshot({
      wallet: input.wallet,
      snapshot: cached,
      pollState,
      labels,
      approvalSummary,
      source: "cache",
      now
    });
  }

  if (cached && input.forceRefresh && cacheAgeMs(cached, now) <= deps.config.tronscanDashboardForceRefreshCooldownMs) {
    return buildDashboardFromSnapshot({
      wallet: input.wallet,
      snapshot: cached,
      pollState,
      labels,
      approvalSummary,
      source: cached.lastError ? "stale" : "cache",
      now
    });
  }

  try {
    const minTimestamp = now.getTime() - THIRTY_DAYS_MS;
    const endTimestamp = now.getTime();
    const maxPages = deps.config.tronscanDashboardMaxPages;

    const [account, transferPages, transactionPages] = await Promise.all([
      deps.tronClient.getAccount(input.wallet.address),
      fetchPages({
        maxPages,
        pageLimit: DASHBOARD_PAGE_LIMIT,
        fetchPage: (start) =>
          deps.tronClient.listRelatedTrc20Transfers(input.wallet.address, {
            start,
            limit: DASHBOARD_PAGE_LIMIT,
            minTimestamp,
            endTimestamp
          })
      }),
      fetchPages({
        maxPages,
        pageLimit: DASHBOARD_PAGE_LIMIT,
        fetchPage: (start) =>
          deps.tronClient.listTransactions(input.wallet.address, {
            start,
            limit: DASHBOARD_PAGE_LIMIT,
            minTimestamp,
            endTimestamp
          })
      })
    ]);

    const accountMetrics = parseAccountMetrics(account, { now });
    const flow = calculateUsdtTransferFlow(input.wallet.address, transferPages.items);
    const fees = calculateFeeSummary(input.wallet.address, transactionPages.items, {
      trxUsd: accountMetrics.trxUsd
    });
    const snapshot: WalletDashboardSnapshot = {
      watchedWalletId: input.wallet.id,
      trxBalanceSun: accountMetrics.trxBalanceSun.toString(),
      usdtBalanceMicro: accountMetrics.usdtBalanceMicro.toString(),
      walletCreatedAt: accountMetrics.walletCreatedAt,
      totalTxCount: accountMetrics.totalTxCount === null ? null : String(accountMetrics.totalTxCount),
      incomingTxCount: accountMetrics.incomingTxCount === null ? null : String(accountMetrics.incomingTxCount),
      outgoingTxCount: accountMetrics.outgoingTxCount === null ? null : String(accountMetrics.outgoingTxCount),
      thirtyDayInUsdt: flow.inUsdt,
      thirtyDayOutUsdt: flow.outUsdt,
      thirtyDayTransferCount: flow.transferCount,
      thirtyDayFeeSun: fees.feeSun.toString(),
      trxUsdPrice: accountMetrics.trxUsd === null ? null : String(accountMetrics.trxUsd),
      analyticsPartial: transferPages.partial || transactionPages.partial,
      refreshedAt: now,
      lastError: null
    };

    await deps.upsertSnapshot(snapshot);

    return buildDashboardFromSnapshot({
      wallet: input.wallet,
      snapshot,
      pollState,
      labels,
      approvalSummary,
      source: "fresh",
      now
    });
  } catch (error) {
    const errorMessage = boundError(error);
    if (cached) {
      return buildDashboardFromSnapshot({
        wallet: input.wallet,
        snapshot: { ...cached, analyticsPartial: true, lastError: errorMessage },
        pollState,
        labels,
        approvalSummary,
        source: "stale",
        now,
        lastError: errorMessage
      });
    }

    const snapshot = createEmptySnapshot({
      watchedWalletId: input.wallet.id,
      now,
      error: errorMessage
    });
    await deps.upsertSnapshot(snapshot);
    return buildDashboardFromSnapshot({
      wallet: input.wallet,
      snapshot,
      pollState,
      labels,
      approvalSummary,
      source: "error",
      now,
      lastError: errorMessage
    });
  }
}

export function formatSunAsTrx(value: string | bigint): string {
  const sun = typeof value === "bigint" ? value : BigInt(value || "0");
  return formatMicroUnits(sun);
}

export function formatMicroUsdt(value: string | bigint): string {
  const micro = typeof value === "bigint" ? value : BigInt(value || "0");
  return formatMicroUnits(micro);
}
