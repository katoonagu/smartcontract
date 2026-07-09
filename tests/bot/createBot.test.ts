import { describe, expect, it } from "vitest";
import * as createBotModule from "../../src/bot/createBot";
import type { AppConfig } from "../../src/config";
import { createBot, extractDeepForensicReportFromJob, extractWhereIsMoneyReportFromJob, formatDeepForensicContextReadyReport, formatDeepForensicFailureUserDeliveryReport, formatDeepForensicReport, formatDeepForensicUserDeliveryReport, formatDeepForensicSupportReport, formatSmartContractCheckReport, formatWhereIsMoneyReport, formatWhereIsMoneySupportReport, formatWhereIsMoneyUserDeliveryReport } from "../../src/bot/createBot";
import { parseCallbackData } from "../../src/bot/keyboards";
import { tronscanApprovalsUrl } from "../../src/alerts/keyboards";
import { normalizeNotificationReason } from "../../src/alerts/notificationText";
import type { DeepAddressForensicReport } from "../../src/check/deepForensicCheck";
import type { ManualCheckResult } from "../../src/check/manualCheck";
import type { SmartContractCheckReport } from "../../src/check/smartContractCheck";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { Db } from "../../src/storage/db";
import type { AssetContinuationProfile, BotLocale, BoundaryExposureProfile, CrossChainCorridorReport, CrossChainTerminalBoundary, FastCounterpartyTopsProfile, MoneyOriginSourceProvenanceMaterialitySummary, OperationalFlowProfile, RiskLabel, RiskReport, StablecoinRestrictionProfile, WalletAlertMode, WalletRoleProfile, WhereIsMoneyAssessment, WhereIsMoneyReport } from "../../src/types";
import type { AddressFastCheckJobInput, CustomerAlertRecipient, ForensicCheckJob, TelegramUserPendingAction, WalletDashboardSnapshot } from "../../src/storage/repositories";
import type { TronDashboardClient } from "../../src/tron/tronClient";

const walletAddress = `T${"1".repeat(33)}`;
const secondWalletAddress = `T${"2".repeat(33)}`;
const txHash = "a".repeat(64);
const adminId = "9001";
const userId = "42";

function emptyCoverageDebug(subjectAddress = walletAddress): CoverageDebugReport {
  return {
    jobId: null,
    subjectAddress,
    status: null,
    windowStart: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    summary: {
      sourceTransferPages: 0,
      transferEdges: 0,
      inboundSendersExpanded: 0,
      extendedIndexedEdges: 0,
      extendedFetchedAddresses: 0,
      apiKeyConfigured: null,
      thirtyDayTransferCount: null,
      historicalFallbackTransferCount: null,
      historicalFallbackRequestedLimit: null,
      directCounterpartyCount: 0,
      analyzedCounterpartyCount: 0,
      expandedCounterpartyCount: 0,
      metadataEnrichedCounterpartyCount: 0,
      skippedCounterpartyCount: 0,
      legacyPartial: false
    },
    rows: [],
    missingChecks: [],
    notes: []
  };
}

function deepReportRuntimeMetadataForTest(): Pick<DeepAddressForensicReport, "runProfile" | "providerBudget"> {
  return {
    runProfile: "production_full",
    providerBudget: {
      providerCallBudget: null,
      transferCallBudget: null,
      contractCallBudget: null,
      approvalCallBudget: null,
      elapsedTimeBudgetMs: null,
      exhausted: false
    }
  };
}

function stablecoinRestrictionProfile(overrides: Partial<StablecoinRestrictionProfile> = {}): StablecoinRestrictionProfile {
  return {
    subjectAddress: walletAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: true,
    balanceRaw: "2642746070000",
    checkedAt: "2026-05-24T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: "tx-blacklist",
    blacklistEventTimestamp: "2026-05-23T06:49:18.000Z",
    blacklistEventBlock: 82950110,
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    },
    ...overrides
  };
}

function boundaryExposureProfile(overrides: Partial<BoundaryExposureProfile> = {}): BoundaryExposureProfile {
  return {
    subjectAddress: walletAddress,
    incomingBoundaryVolumeRaw: "0",
    outgoingBoundaryVolumeRaw: "311851000000",
    incomingBoundaryVolumeRatio: 0,
    outgoingBoundaryVolumeRatio: 0.97,
    directBoundaryTxCount: 0,
    twoHopBoundaryTxCount: 4,
    topBoundaryEntities: [
      {
        address: "TService11111111111111111111111111111",
        category: "bridge_pool",
        identity: "Allbridge LP",
        direction: "outbound",
        volumeRaw: "311851000000",
        txCount: 4,
        maxDepth: 2
      }
    ],
    categoryBreakdown: [
      {
        category: "bridge_pool",
        direction: "outbound",
        volumeRaw: "311851000000",
        txCount: 4,
        volumeRatio: 0.97
      }
    ],
    flows: [
      {
        direction: "outbound",
        depth: 2,
        boundaryAddress: "TService11111111111111111111111111111",
        boundaryCategory: "bridge_pool",
        boundaryIdentity: "Allbridge LP",
        viaAddress: secondWalletAddress,
        subjectTxHash: "tx-subject-to-via",
        boundaryTxHash: "tx-via-to-service",
        amountRaw: "311851000000",
        boundaryAmountRaw: "311752000000",
        amountPreservationRatio: 0.9997,
        firstTransferAt: "2026-05-09T21:06:51.000Z",
        lastTransferAt: "2026-05-09T23:14:06.000Z"
      }
    ],
    contextScore: 15,
    features: [
      {
        code: "boundary_exposure_two_hop_bridge_pool",
        label: "Funds touch service-boundary infrastructure; public-chain continuity after this point should not be assumed.",
        scoreImpact: 15,
        value: 0.97
      }
    ],
    ...overrides
  };
}

function walletRoleProfile(overrides: Partial<WalletRoleProfile> = {}): WalletRoleProfile {
  const reason = {
    role: "mule" as const,
    code: "wallet_role_fast_service_redistribution",
    label: "Subject quickly redistributes funds toward service infrastructure.",
    scoreImpact: 50,
    value: 0.97
  };
  return {
    subjectAddress: walletAddress,
    primaryRole: "mule",
    roles: [
      {
        role: "mule",
        confidence: "medium",
        score: 50,
        reasons: [reason]
      }
    ],
    evidenceStrength: "strong_behavior",
    features: [reason],
    ...overrides
  };
}

function operationalFlowProfile(overrides: Partial<OperationalFlowProfile> = {}): OperationalFlowProfile {
  return {
    subjectAddress: walletAddress,
    windowStart: "2026-04-24T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    incomingVolumeRaw: "100000000000",
    outgoingVolumeRaw: "97000000000",
    incomingTxCount: 1,
    outgoingTxCount: 3,
    inflowToOutflowRatio: 0.97,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [
      {
        address: "THTX11111111111111111111111111111111",
        direction: "outgoing",
        volumeRaw: "60000000000",
        txCount: 1,
        volumeRatio: 0.6,
        category: "cex",
        identity: "HTX",
        isTerminalLiquidity: true,
        isHtxHuobi: true
      },
      {
        address: "TBridgeDex111111111111111111111111111",
        direction: "outgoing",
        volumeRaw: "37000000000",
        txCount: 2,
        volumeRatio: 0.37,
        category: "router",
        identity: "SunSwap Router",
        isTerminalLiquidity: true,
        isHtxHuobi: false
      }
    ],
    categoryBreakdown: [
      {
        direction: "outgoing",
        category: "cex",
        volumeRaw: "60000000000",
        txCount: 1,
        volumeRatio: 0.6
      },
      {
        direction: "outgoing",
        category: "router",
        volumeRaw: "37000000000",
        txCount: 2,
        volumeRatio: 0.37
      }
    ],
    terminalLiquidityIncomingRatio: 0,
    terminalLiquidityOutgoingRatio: 0.97,
    htxHuobiIncomingRatio: 0,
    htxHuobiOutgoingRatio: 0.6,
    bridgeDexRouterOutgoingRatio: 0.37,
    unknownContractOutgoingRatio: 0,
    historicalTransitScore: 80,
    historicalTransitBreakdown: {
      eligible: true,
      flowUsdt: 100000,
      volumeScore: 17,
      passThrough: 0.97,
      passThroughScore: 19,
      serviceShare: 0.37,
      serviceShareScore: 9,
      score: 80
    },
    operationalScore: 50,
    features: [
      {
        code: "operational_flow_htx_huobi_outgoing",
        label: "Outgoing 30d flow includes HTX/Huobi terminal liquidity exposure.",
        scoreImpact: 15,
        value: 0.6
      },
      {
        code: "operational_flow_bridge_dex_router_outgoing",
        label: "Outgoing 30d flow includes bridge/DEX/router terminal liquidity exposure.",
        scoreImpact: 10,
        value: 0.37
      }
    ],
    ...overrides
  };
}

type ReplyCall = {
  method: string;
  payload: Record<string, any>;
};

type FakeWallet = {
  id: string;
  telegramUserId: string;
  address: string;
  createdAt: Date;
  alertMode: WalletAlertMode;
  digestIntervalMinutes: number;
};

type FakeSession = {
  telegramUserId: string;
  pendingAction: TelegramUserPendingAction | null;
  selectedWalletId: string | null;
  selectedTheftReportId: string | null;
  updatedAt: Date;
};
type FakeTheftReport = {
  id: string;
  telegramUserId: string;
  txHash: string;
  victimAddress: string;
  reportedScamAddress: string;
  amountRaw: string;
  amountUsdt: string;
  comment: string | null;
  status: "draft" | "awaiting_deposit" | "deposit_confirmed" | "documents_requested" | "cancelled";
  depositAddress: string;
  depositAmountUsdt: string;
  createdAt: Date;
  updatedAt: Date;
};
type BotOptions = NonNullable<Parameters<typeof createBot>[3]>;

function createConfig(): AppConfig {
  return {
    botToken: "123456:test-token",
    databaseUrl: "postgres://unused",
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com"),
    tronFullNodeBaseUrl: new URL("https://api.trongrid.io"),
    tronscanApiKey: undefined,
    tronscanApiKeys: [],
    tronscanApiKeyGroups: [],
    tronFullNodeApiKey: undefined,
    tronscanPageLimit: 100,
    tronscanMaxPagesPerWallet: 5,
    tronscanTimeoutMs: 10000,
    tronscanRetryAttempts: 3,
    tronscanRetryBaseDelayMs: 500,
    tronscanBackfillLookbackMs: 86_400_000,
    tronscanRequestMinIntervalMs: 250,
    tronscanGlobalRequestMinIntervalMs: 280,
    tronscanTransferRequestMinIntervalMs: 350,
    tronscanApprovalRequestMinIntervalMs: 300,
    tronscanContractRequestMinIntervalMs: 300,
    tronscanFullNodeRequestMinIntervalMs: 300,
    tronscanAccountGroupRequestMinIntervalMs: 250,
    tronGridRequestMinIntervalMs: 250,
    tronscanRateLimitCooldownMs: 30_000,
    tronscanDashboardCacheTtlMs: 300_000,
    tronscanDashboardMaxPages: 5,
    tronscanDashboardForceRefreshCooldownMs: 60_000,
    forensicWherePollIntervalMs: 2_000,
    forensicWhereJobsPerPoll: 3,
    forensicIncomingPollIntervalMs: 2_000,
    forensicIncomingJobsPerPoll: 3,
    forensicDeepPollIntervalMs: 60_000,
    forensicJobStaleAfterMs: 30 * 60 * 1000,
    forensicJobMaxRetries: 2,
    botBetaRiskDiagnosticsEnabled: false,
    crossChainStage2Enabled: false,
    crossChainStage2MaxProviderCalls: 60,
    crossChainStage2CacheTtlMs: 86_400_000,
    rangeApiKey: undefined,
    rangeBaseUrl: new URL("https://api.range.org"),
    rangeTimeoutMs: 20_000,
    rangeMaxCallsPerCheck: 20,
    evmExplorerApiKey: undefined,
    evmExplorerBaseUrl: new URL("https://api.etherscan.io"),
    evmExplorerTimeoutMs: 20_000,
    evmExplorerMaxCallsPerCheck: 40,
    alchemyApiKey: undefined,
    alchemyTimeoutMs: 20_000,
    llmContractAnalysisEnabled: false,
    llmApiKey: undefined,
    llmBaseUrl: new URL("https://api.deepseek.com"),
    llmModel: "deepseek-v4-flash",
    llmThinkingEnabled: true,
    llmReasoningEffort: "max",
    llmModelCacheKey: "provider=deepseek|model=deepseek-v4-flash|thinking=enabled|reasoning=max",
    llmProviderLabel: "deepseek",
    llmTimeoutMs: 20_000,
    llmMaxRetries: 2,
    llmCacheTtlMs: 2_592_000_000,
    llmEnrichmentMaxAttempts: 4,
    llmEnrichmentRetryDelayMs: 15_000,
    pollIntervalMs: 60_000,
    pollStartDelayMs: 0,
    incomingDepositRealtimeMaxAgeMs: 15 * 60 * 1000,
    forensicWhereStartDelayMs: 3_000,
    forensicIncomingStartDelayMs: 6_000,
    forensicDeepStartDelayMs: 12_000,
    serviceAdminTelegramIds: new Set([adminId]),
    adminDashboardEnabled: false,
    adminDashboardHost: "127.0.0.1",
    adminDashboardPort: 8787,
    adminDashboardToken: null,
    runtimeInstanceLabel: undefined,
    theftReportDepositAddress: TRON_USDT_CONTRACT_ADDRESS,
    theftReportDepositAmountUsdt: "1000",
    theftReportGuideUrl: undefined,
    theftReportAdminContact: undefined
  };
}

function createFakeDb(defaultLocale: BotLocale = "en"): Db {
  const wallets: FakeWallet[] = [];
  const labels: Array<{ address: string; label: RiskLabel; source: "service_admin" | "system"; createdByTelegramId: string; createdAt: Date }> = [];
  const sessions = new Map<string, FakeSession>();
  const theftReports: FakeTheftReport[] = [];
  const snapshots = new Map<string, WalletDashboardSnapshot>();
  const alertRecipients: CustomerAlertRecipient[] = [];
  const users = new Map<string, { telegramUserId: string; username: string | null; locale: BotLocale }>();

  function theftReportRow(report: FakeTheftReport) {
    return {
      id: report.id,
      telegram_user_id: report.telegramUserId,
      tx_hash: report.txHash,
      victim_address: report.victimAddress,
      reported_scam_address: report.reportedScamAddress,
      amount_raw: report.amountRaw,
      amount_usdt: report.amountUsdt,
      comment: report.comment,
      status: report.status,
      deposit_address: report.depositAddress,
      deposit_amount_usdt: report.depositAmountUsdt,
      created_at: report.createdAt,
      updated_at: report.updatedAt
    };
  }

  return {
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 1 };
        },
        release() {}
      };
    },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("insert into telegram_users")) {
        const telegramUserId = String(params[0]);
        const existing = users.get(telegramUserId);
        const rawLocale = params[2] ?? params[1];
        const locale = (rawLocale === "ru" || rawLocale === "en" ? rawLocale : existing?.locale ?? defaultLocale) as BotLocale;
        users.set(telegramUserId, {
          telegramUserId,
          username: params[1] === null || params[1] === undefined ? null : String(params[1]),
          locale
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("select locale") && sql.includes("from telegram_users")) {
        const user = users.get(String(params[0]));
        return { rows: [{ locale: user?.locale ?? defaultLocale }], rowCount: 1 };
      }

      if (sql.includes("insert into telegram_user_sessions")) {
        const session: FakeSession = {
          telegramUserId: String(params[0]),
          pendingAction: params[1] as TelegramUserPendingAction,
          selectedWalletId: params[2] === null || params[2] === undefined ? null : String(params[2]),
          selectedTheftReportId: params[3] === null || params[3] === undefined ? null : String(params[3]),
          updatedAt: new Date("2026-05-20T00:00:00.000Z")
        };
        sessions.set(session.telegramUserId, session);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("update telegram_user_sessions")) {
        const telegramUserId = String(params[0]);
        const existing = sessions.get(telegramUserId);
        if (!existing) return { rows: [], rowCount: 0 };
        sessions.set(telegramUserId, {
          ...existing,
          pendingAction: null,
          selectedWalletId: null,
          selectedTheftReportId: null,
          updatedAt: new Date("2026-05-20T00:01:00.000Z")
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from telegram_user_sessions")) {
        const session = sessions.get(String(params[0]));
        return {
          rows: session
            ? [
                {
                  telegram_user_id: session.telegramUserId,
                  pending_action: session.pendingAction,
                  selected_wallet_id: session.selectedWalletId,
                  selected_theft_report_id: session.selectedTheftReportId,
                  updated_at: session.updatedAt
                }
              ]
            : [],
          rowCount: session ? 1 : 0
        };
      }

      if (sql.includes("insert into watched_wallets")) {
        const wallet = {
          id: String(params[0]),
          telegramUserId: String(params[1]),
          address: String(params[2]),
          createdAt: new Date("2026-05-20T00:00:00.000Z"),
          alertMode: "realtime" as const,
          digestIntervalMinutes: 10
        };
        const existing = wallets.find((item) => item.telegramUserId === wallet.telegramUserId && item.address === wallet.address);
        if (!existing) wallets.push(wallet);
        return {
          rows: [
            {
              id: existing?.id ?? wallet.id,
              telegram_user_id: wallet.telegramUserId,
              address: wallet.address,
              created_at: existing?.createdAt ?? wallet.createdAt,
              alert_mode: existing?.alertMode ?? wallet.alertMode,
              digest_interval_minutes: existing?.digestIntervalMinutes ?? wallet.digestIntervalMinutes
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("update watched_wallets")) {
        const telegramUserId = String(params[0]);
        const address = String(params[1]);
        const alertMode = params[2] as WalletAlertMode;
        const digestIntervalMinutes = Number(params[3]);
        const wallet = wallets.find((item) => item.telegramUserId === telegramUserId && item.address === address);
        if (!wallet) return { rows: [], rowCount: 0 };
        wallet.alertMode = alertMode;
        wallet.digestIntervalMinutes = digestIntervalMinutes;
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("delete from watched_wallets")) {
        const telegramUserId = String(params[0]);
        const address = String(params[1]);
        const before = wallets.length;
        const remaining = wallets.filter((wallet) => wallet.telegramUserId !== telegramUserId || wallet.address !== address);
        wallets.splice(0, wallets.length, ...remaining);
        return { rows: [], rowCount: before - wallets.length };
      }

      if (sql.includes("from watched_wallets")) {
        const telegramUserId = params[0] ? String(params[0]) : undefined;
        const rows = wallets
          .filter((wallet) => !telegramUserId || wallet.telegramUserId === telegramUserId)
          .map((wallet) => ({
            id: wallet.id,
            telegram_user_id: wallet.telegramUserId,
            username: "tester",
            address: wallet.address,
            created_at: wallet.createdAt,
            alert_mode: wallet.alertMode,
            digest_interval_minutes: wallet.digestIntervalMinutes
          }));
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("from wallet_poll_state")) {
        return {
          rows: [
            {
              watched_wallet_id: String(params[0]),
              last_seen_block_ts: new Date("2026-05-20T00:00:00.000Z"),
              last_seen_tx_hash: "tx_seen",
              backfill_anchor_block_ts: null,
              backfill_anchor_tx_hash: null,
              backfill_next_start: 0,
              backfill_complete: true,
              last_successful_poll_at: new Date("2026-05-21T00:00:00.000Z"),
              last_poll_event_count: 1,
              last_poll_new_count: 0,
              last_poll_error: null,
              updated_at: new Date("2026-05-21T00:00:00.000Z")
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into wallet_dashboard_snapshots")) {
        const snapshot: WalletDashboardSnapshot = {
          watchedWalletId: String(params[0]),
          trxBalanceSun: String(params[1]),
          usdtBalanceMicro: String(params[2]),
          walletCreatedAt: params[3] as Date | null,
          totalTxCount: params[4] === null ? null : String(params[4]),
          incomingTxCount: params[5] === null ? null : String(params[5]),
          outgoingTxCount: params[6] === null ? null : String(params[6]),
          thirtyDayInUsdt: String(params[7]),
          thirtyDayOutUsdt: String(params[8]),
          thirtyDayTransferCount: Number(params[9]),
          thirtyDayFeeSun: String(params[10]),
          trxUsdPrice: params[11] === null ? null : String(params[11]),
          analyticsPartial: Boolean(params[12]),
          refreshedAt: params[13] as Date,
          lastError: params[14] === null ? null : String(params[14])
        };
        snapshots.set(snapshot.watchedWalletId, snapshot);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from wallet_dashboard_snapshots")) {
        const snapshot = snapshots.get(String(params[0]));
        return {
          rows: snapshot
            ? [
                {
                  watched_wallet_id: snapshot.watchedWalletId,
                  trx_balance_sun: snapshot.trxBalanceSun,
                  usdt_balance_micro: snapshot.usdtBalanceMicro,
                  wallet_created_at: snapshot.walletCreatedAt,
                  total_tx_count: snapshot.totalTxCount,
                  incoming_tx_count: snapshot.incomingTxCount,
                  outgoing_tx_count: snapshot.outgoingTxCount,
                  thirty_day_in_usdt: snapshot.thirtyDayInUsdt,
                  thirty_day_out_usdt: snapshot.thirtyDayOutUsdt,
                  thirty_day_transfer_count: snapshot.thirtyDayTransferCount,
                  thirty_day_fee_sun: snapshot.thirtyDayFeeSun,
                  trx_usd_price: snapshot.trxUsdPrice,
                  analytics_partial: snapshot.analyticsPartial,
                  refreshed_at: snapshot.refreshedAt,
                  last_error: snapshot.lastError
                }
              ]
            : [],
          rowCount: snapshot ? 1 : 0
        };
      }

      if (sql.includes("from wallet_approvals")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("count(*)") && sql.includes("from observed_approval_drain_events")) {
        return { rows: [{ total_count: 0, high_risk_count: 0 }], rowCount: 1 };
      }

      if (sql.includes("from observed_approval_drain_events")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("insert into theft_reports")) {
        const now = new Date("2026-05-20T00:00:00.000Z");
        const id = String(params[0]);
        const telegramUserId = String(params[1]);
        const existing = theftReports.find((report) => report.id === id);
        if (existing && existing.telegramUserId !== telegramUserId) return { rows: [], rowCount: 0 };
        if (existing && !["draft", "awaiting_deposit"].includes(existing.status)) return { rows: [], rowCount: 0 };
        const report = existing ?? {
          id,
          telegramUserId,
          txHash: String(params[2]),
          victimAddress: String(params[3]),
          reportedScamAddress: String(params[4]),
          amountRaw: String(params[5]),
          amountUsdt: String(params[6]),
          comment: null,
          status: "draft" as const,
          depositAddress: String(params[7]),
          depositAmountUsdt: String(params[8]),
          createdAt: now,
          updatedAt: now
        };
        report.txHash = String(params[2]);
        report.victimAddress = String(params[3]);
        report.reportedScamAddress = String(params[4]);
        report.amountRaw = String(params[5]);
        report.amountUsdt = String(params[6]);
        report.depositAddress = String(params[7]);
        report.depositAmountUsdt = String(params[8]);
        report.status = "draft";
        report.updatedAt = now;
        if (!existing) theftReports.push(report);
        return { rows: [theftReportRow(report)], rowCount: 1 };
      }

      if (sql.includes("from theft_reports") && sql.includes("where id = $1")) {
        const report = theftReports.find((item) => item.id === String(params[0]));
        return { rows: report ? [theftReportRow(report)] : [], rowCount: report ? 1 : 0 };
      }

      if (sql.includes("from theft_reports") && sql.includes("telegram_user_id = $1")) {
        const limit = Number(params[1] ?? 50);
        const rows = theftReports
          .filter((report) => report.telegramUserId === String(params[0]))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
          .slice(0, Number.isFinite(limit) ? limit : 50)
          .map(theftReportRow);
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("update theft_reports") && sql.includes("set comment = $3")) {
        const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
        if (!report) return { rows: [], rowCount: 0 };
        report.comment = String(params[2]).trim().slice(0, 1000);
        report.updatedAt = new Date("2026-05-20T00:02:00.000Z");
        return { rows: [theftReportRow(report)], rowCount: 1 };
      }

      if (sql.includes("update theft_reports") && sql.includes("status = 'awaiting_deposit'")) {
        const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
        if (!report || !["draft", "awaiting_deposit"].includes(report.status)) return { rows: [], rowCount: 0 };
        report.status = "awaiting_deposit";
        report.updatedAt = new Date("2026-05-20T00:03:00.000Z");
        return { rows: [theftReportRow(report)], rowCount: 1 };
      }

      if (sql.includes("update theft_reports") && sql.includes("status = 'documents_requested'")) {
        const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
        if (!report || !["awaiting_deposit", "deposit_confirmed", "documents_requested"].includes(report.status)) return { rows: [], rowCount: 0 };
        report.status = "documents_requested";
        report.updatedAt = new Date("2026-05-20T00:04:00.000Z");
        return { rows: [theftReportRow(report)], rowCount: 1 };
      }

      if (sql.includes("update theft_reports") && sql.includes("status = 'cancelled'")) {
        const report = theftReports.find((item) => item.id === String(params[0]) && item.telegramUserId === String(params[1]));
        if (!report || !["draft", "awaiting_deposit"].includes(report.status)) return { rows: [], rowCount: 0 };
        report.status = "cancelled";
        report.updatedAt = new Date("2026-05-20T00:05:00.000Z");
        return { rows: [theftReportRow(report)], rowCount: 1 };
      }

      if (sql.includes("insert into address_labels")) {
        const label = {
          address: String(params[0]),
          label: params[1] as RiskLabel,
          source: params[2] as "service_admin" | "system",
          createdByTelegramId: String(params[3]),
          createdAt: new Date("2026-05-20T00:00:00.000Z")
        };
        const existing = labels.find((item) => item.address === label.address && item.label === label.label);
        if (existing) {
          existing.createdByTelegramId = label.createdByTelegramId;
        } else {
          labels.push(label);
        }
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from address_labels")) {
        const address = String(params[0]);
        const rows = labels
          .filter((label) => label.address === address)
          .map((label) => ({
            address: label.address,
            label: label.label,
            source: label.source,
            created_by_telegram_id: label.createdByTelegramId,
            created_at: label.createdAt
          }));
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("insert into customer_alert_recipients")) {
        const ownerTelegramUserId = String(params[0]);
        const recipientTelegramUserId = String(params[1]);
        const alertMode = params[2] as CustomerAlertRecipient["alertMode"];
        const existing = alertRecipients.find(
          (recipient) =>
            recipient.ownerTelegramUserId === ownerTelegramUserId && recipient.recipientTelegramUserId === recipientTelegramUserId
        );
        const now = new Date("2026-05-22T00:00:00.000Z");
        if (existing) {
          existing.alertMode = alertMode;
          existing.updatedAt = now;
        } else {
          alertRecipients.push({
            ownerTelegramUserId,
            recipientTelegramUserId,
            alertMode,
            createdAt: now,
            updatedAt: now
          });
        }
        const recipient = existing ?? alertRecipients.at(-1);
        return {
          rows: [
            {
              owner_telegram_user_id: recipient?.ownerTelegramUserId,
              recipient_telegram_user_id: recipient?.recipientTelegramUserId,
              alert_mode: recipient?.alertMode,
              created_at: recipient?.createdAt,
              updated_at: recipient?.updatedAt
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("delete from customer_alert_recipients")) {
        const ownerTelegramUserId = String(params[0]);
        const recipientTelegramUserId = String(params[1]);
        const before = alertRecipients.length;
        const remaining = alertRecipients.filter(
          (recipient) =>
            recipient.ownerTelegramUserId !== ownerTelegramUserId || recipient.recipientTelegramUserId !== recipientTelegramUserId
        );
        alertRecipients.splice(0, alertRecipients.length, ...remaining);
        return { rows: [], rowCount: before - alertRecipients.length };
      }

      if (sql.includes("from customer_alert_recipients")) {
        const ownerTelegramUserId = String(params[0]);
        const rows = alertRecipients
          .filter((recipient) => recipient.ownerTelegramUserId === ownerTelegramUserId)
          .map((recipient) => ({
            owner_telegram_user_id: recipient.ownerTelegramUserId,
            recipient_telegram_user_id: recipient.recipientTelegramUserId,
            alert_mode: recipient.alertMode,
            created_at: recipient.createdAt,
            updated_at: recipient.updatedAt
          }));
        return { rows, rowCount: rows.length };
      }

      throw new Error(`Unexpected query in bot smoke test: ${sql}`);
    }
  } as unknown as Db;
}

function createTronClient(): TronDashboardClient {
  return {
    async getTransaction() {
      return {
        trc20TransferInfo: [
          {
            from_address: secondWalletAddress,
            contract_address: TRON_USDT_CONTRACT_ADDRESS
          }
        ]
      };
    },
    async listIncomingTrc20Transfers() {
      return [];
    },
    async getAccount() {
      return {
        balance: "123456789",
        date_created: "1778457600000",
        transactions_in: "7",
        transactions_out: "5",
        totalTransactionCount: "12",
        trc20token_balances: [
          {
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            balance: "7000000",
            tokenPriceInTrx: "4"
          }
        ]
      };
    },
    async listRelatedTrc20Transfers(address) {
      return [
        {
          transaction_id: "tx_in",
          from_address: secondWalletAddress,
          to_address: address,
          quant: "12500000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          confirmed: true,
          contractRet: "SUCCESS",
          block_ts: 1778457600000
        },
        {
          transaction_id: "tx_out",
          from_address: address,
          to_address: secondWalletAddress,
          quant: "2500000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          confirmed: true,
          contractRet: "SUCCESS",
          block_ts: 1778457700000
        }
      ];
    },
    async listTransactions(address) {
      return [
        {
          ownerAddress: address,
          contractRet: "SUCCESS",
          cost: { fee: "6000000" }
        }
      ];
    }
  };
}

function messageUpdate(text: string, fromId: string | number) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      date: 1_778_880_000,
      chat: { id: Number(fromId), type: "private" as const, first_name: "Tester", username: `user_${fromId}` },
      from: { id: Number(fromId), is_bot: false, first_name: "Tester", username: `user_${fromId}` },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command" as const, offset: 0, length: text.split(/\s+/, 1)[0].length }]
        : undefined
    }
  };
}

function callbackQueryUpdate(data: string, fromId: string | number) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: `callback-${Math.random()}`,
      from: { id: Number(fromId), is_bot: false, first_name: "Tester", username: `user_${fromId}` },
      message: {
        message_id: 10,
        date: 1_778_880_000,
        chat: { id: Number(fromId), type: "private" as const, first_name: "Tester", username: `user_${fromId}` },
        text: "menu"
      },
      chat_instance: "test-chat-instance",
      data
    }
  };
}

function messageCalls(calls: ReplyCall[]): ReplyCall[] {
  return calls.filter((call) => call.method === "sendMessage" || call.method === "editMessageText");
}

function lastText(calls: ReplyCall[]): string {
  return String(messageCalls(calls).at(-1)?.payload.text ?? "");
}

function plainTelegramText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function plainSectionText(text: string, title: string): string {
  const start = text.indexOf(title);
  if (start < 0) return "";
  const afterTitle = text.slice(start + title.length);
  const nextSection = afterTitle.search(/\n\n\S/);
  return nextSection >= 0 ? afterTitle.slice(0, nextSection).trim() : afterTitle.trim();
}

function lastPlainText(calls: ReplyCall[]): string {
  return plainTelegramText(lastText(calls));
}

function whereIsMoneyJobForTest(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "where-job-test",
    kind: "where_is_money_check",
    subjectAddress: walletAddress,
    status: "completed",
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    priority: 100,
    chatId: "42",
    messageId: null,
    requestedBy: "42",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-05-24T00:00:00.000Z"),
    updatedAt: new Date("2026-05-24T00:00:00.000Z"),
    startedAt: new Date("2026-05-24T00:00:00.000Z"),
    completedAt: new Date("2026-05-24T00:01:00.000Z"),
    ...overrides
  };
}

function whereRiskBandForTest(score: number): WhereIsMoneyAssessment["riskBand"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function emptyRiskLayerDefaultsForTest(): Pick<
  WhereIsMoneyAssessment,
  "sourcePolicyEvidence" | "contractSuspicionEvidence" | "unknownOriginEvidence" | "riskLayers" | "dominantRiskLayer"
> {
  return {
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null
  };
}

function whereAssessmentForTest(overrides: Partial<WhereIsMoneyReport>): WhereIsMoneyAssessment {
  const decision = overrides.decision ?? "ACCEPTABLE";
  const riskScore = overrides.riskScore ?? 0;
  return {
    decision,
    riskScore,
    riskBand: whereRiskBandForTest(riskScore),
    provenanceConfidence: decision === "ACCEPTABLE" ? 100 : 0,
    coverageCompleteness: overrides.coverage?.partial ? 50 : 100,
    walletRole: decision === "ACCEPTABLE" ? "unknown_wallet" : "risky_source_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    ...emptyRiskLayerDefaultsForTest(),
    reasons: overrides.decisionReasons ?? [],
    warnings: []
  };
}

function whereIsMoneyReportForTest(overrides: Partial<WhereIsMoneyReport> = {}): WhereIsMoneyReport {
  const assessment = overrides.assessment ?? whereAssessmentForTest(overrides);
  return {
    subjectAddress: walletAddress,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    assessment,
    decision: "ACCEPTABLE",
    userDecision: "ACCEPTABLE",
    internalDecision: "ACCEPTABLE",
    proofLevel: "clean_source_proven",
    riskScore: 0,
    decisionReasons: [],
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      maxDepth: 7,
      fetchedAddressCount: 1,
      partial: false,
      notes: []
    },
    ...overrides
  };
}

function scoreInvalidWhereReportForTest(): WhereIsMoneyReport {
  const decisionReasons = [
    "Approval-drain review is guarded by service context and contract analysis is non-actionable; final scoring is blocked by incomplete hop history coverage."
  ];
  const coverage = {
    selectedInboundTxCount: 1,
    selectedInboundVolumeRaw: "1000000000",
    currentBalanceCoverageRatio: 1,
    coverageRatio: 1,
    maxDepth: 20,
    fetchedAddressCount: 3,
    partial: true,
    notes: ["Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."]
  };
  const assessment: WhereIsMoneyAssessment = {
    ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 45, decisionReasons, coverage }),
    scoreValid: false,
    scoreBlockedReason: "insufficient_coverage",
    technicalStatus: "provider_cap_unresolved",
    decision: "REVIEW",
    riskScore: 45,
    riskBand: "MEDIUM",
    reasons: decisionReasons,
    warnings: ["No hard bad evidence was found. This is a technical coverage block, not a final decline."]
  };
  return whereIsMoneyReportForTest({
    scoreValid: false,
    scoreBlockedReason: "insufficient_coverage",
    technicalStatus: "provider_cap_unresolved",
    decision: "REVIEW",
    userDecision: "NO_FINAL_DECISION",
    internalDecision: "REVIEW",
    proofLevel: "insufficient_coverage",
    riskScore: 45,
    decisionReasons,
    coverage,
    assessment
  });
}

function formatWhereIsMoneyResultForTest(overrides: Partial<WhereIsMoneyReport>): string {
  return plainTelegramText(formatWhereIsMoneyReport(
    whereIsMoneyJobForTest(),
    whereIsMoneyReportForTest(overrides),
    "completed",
    { locale: "en" }
  ).text);
}

function sourceExposureKindForTerminalBoundary(terminalBoundary: CrossChainTerminalBoundary) {
  if (terminalBoundary === "tornado_or_mixer") return "mixer";
  if (terminalBoundary === "bridge_boundary") return "cross_chain_boundary";
  if (terminalBoundary === "dex_router_boundary") return "bridge_router_dex";
  if (terminalBoundary === "none" || terminalBoundary === "data_exhausted" || terminalBoundary === "candidate_only") return undefined;
  return terminalBoundary;
}

function crossChainCorridorForTest(terminalBoundary: CrossChainTerminalBoundary = "no_name_token_liquidity", overrides: Partial<CrossChainCorridorReport> = {}): CrossChainCorridorReport {
  const riskScore = terminalBoundary === "sanctioned_service" ? 95 : 70;
  const dataQualityBoundary = terminalBoundary === "none" || terminalBoundary === "data_exhausted" || terminalBoundary === "candidate_only";
  return {
    enabled: true,
    triggered: true,
    skippedReason: null,
    paths: [
      {
        id: "corridor-top",
        triggerReason: "large_single_boundary",
        balanceTransferTxHashes: ["tx-balance"],
        targetAmountRaw: "1000000000",
        selectedAmountRaw: "980000000",
        terminalBoundary,
        partial: false,
        reasons: [terminalBoundary === "sanctioned_service" ? "Exact sanctioned service evidence found in cross-chain corridor." : "Cross-chain corridor reached no-name token liquidity."],
        warnings: terminalBoundary === "sanctioned_service" ? [] : ["source-policy risk, not direct scam proof"],
        riskLayer: {
          evidenceClass: terminalBoundary === "sanctioned_service" ? "hard_proof" : dataQualityBoundary ? "data_quality" : "source_policy",
          kind: `cross_chain_${terminalBoundary}`,
          sourceExposureKind: sourceExposureKindForTerminalBoundary(terminalBoundary),
          score: riskScore,
          rawScore: riskScore,
          adjustedScore: riskScore,
          proofLevel: terminalBoundary === "sanctioned_service" ? "exact_scam_or_taint_proof" : dataQualityBoundary ? "insufficient_coverage" : "exchange_policy_decline",
          canBeDampened: terminalBoundary !== "sanctioned_service",
          reasons: ["Cross-chain source-policy corridor found."],
          warnings: terminalBoundary === "sanctioned_service" ? [] : ["source-policy risk, not direct scam proof"],
          evidenceIds: ["cross-chain-evidence-1"]
        },
        edges: [
          {
            id: "edge-bridge",
            edgeType: "bridge_source",
            source: { chain: "tron", chainId: "728126428", address: walletAddress },
            destination: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
            txHash: "tx-bridge-stage2",
            amountRaw: "980000000",
            assetSymbol: "USDT",
            timestamp: "2026-05-24T00:00:00.000Z",
            protocol: "Allbridge",
            evidenceRefs: [{ id: "ev-bridge", provider: "range", payloadId: "payload-bridge", confidence: "provider_correlated" }],
            labels: []
          },
          {
            id: "edge-terminal",
            edgeType: terminalBoundary === "tornado_or_mixer" ? "tornado_withdrawal" : "unknown_token_liquidity",
            source: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
            destination: { chain: "ethereum", chainId: 1, address: "0x2222222222222222222222222222222222222222" },
            txHash: "tx-terminal-stage2",
            amountRaw: "970000000",
            assetSymbol: terminalBoundary === "no_name_token_liquidity" ? "NO_NAME" : "ETH",
            tokenContract: "0x9999999999999999999999999999999999999999",
            timestamp: "2026-05-24T00:10:00.000Z",
            protocol: null,
            evidenceRefs: [{ id: "ev-terminal", provider: "etherscan", payloadId: "payload-terminal", confidence: "provider_correlated" }],
            labels: terminalBoundary === "sanctioned_service" ? ["LOCAL_EXACT_SANCTIONED: OFAC SDN sanctioned service"] : []
          }
        ]
      }
    ],
    providerCalls: 2,
    partial: false,
    coverageNotes: [],
    payloadRefs: [],
    ...overrides
  };
}

function stage2WhereReportForTest(terminalBoundary: CrossChainTerminalBoundary, corridorOverrides: Partial<CrossChainCorridorReport> = {}): WhereIsMoneyReport {
  const riskScore = terminalBoundary === "sanctioned_service" ? 95 : 70;
  const dataQualityBoundary = terminalBoundary === "none" || terminalBoundary === "data_exhausted" || terminalBoundary === "candidate_only";
  return whereIsMoneyReportForTest({
    decision: "DECLINE",
    userDecision: "DECLINE",
    internalDecision: "DECLINE",
    proofLevel: terminalBoundary === "sanctioned_service" ? "exact_scam_or_taint_proof" : dataQualityBoundary ? "insufficient_coverage" : "exchange_policy_decline",
    riskScore,
    decisionReasons: terminalBoundary === "sanctioned_service"
      ? ["Exact sanctioned service evidence found in cross-chain corridor."]
      : ["Cross-chain corridor reached no-name token liquidity."],
    assessment: {
      ...whereAssessmentForTest({ decision: "DECLINE", riskScore }),
      hardBadEvidence: terminalBoundary === "sanctioned_service"
        ? [{
            kind: "sanctioned_service",
            score: riskScore,
            message: "Exact sanctioned service evidence found in cross-chain corridor.",
            evidenceIds: ["cross-chain-evidence-1"]
          }]
        : [],
      sourcePolicyEvidence: terminalBoundary === "sanctioned_service" || dataQualityBoundary
        ? []
        : [{
            kind: terminalBoundary === "tornado_or_mixer" ? "mixer" : "no_name_token_liquidity",
            aggregateShare: 0.98,
            effectiveShare: 0.98,
            pathCount: 1,
            score: riskScore,
            riskBand: "HIGH",
            proofLevel: "exchange_policy_decline",
            canBeDampened: true,
            reasons: ["Cross-chain source-policy corridor found."],
            warnings: ["source-policy risk, not direct scam proof"],
            evidenceIds: ["cross-chain-evidence-1"]
          }]
    },
    crossChainCorridor: crossChainCorridorForTest(terminalBoundary, corridorOverrides)
  });
}

function deepReportForTest(overrides: Partial<DeepAddressForensicReport> = {}): DeepAddressForensicReport {
  return {
    subjectAddress: walletAddress,
    windowStart: new Date("2026-04-24T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z"),
    ...deepReportRuntimeMetadataForTest(),
    rawEvidence: [],
    observations: [],
    missingChecks: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    approvalDrainProvenanceProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    coverage: {
      sourceTransferPages: 0,
      inboundSendersExpanded: 0,
      transferEdges: 0
    },
    coverageDebug: emptyCoverageDebug(),
    ...overrides
  };
}

function assetContinuationProfileForTest(overrides: Partial<AssetContinuationProfile> = {}): AssetContinuationProfile {
  return {
    subjectAddress: walletAddress,
    sourceAsset: "USDT",
    continuationAssetSymbol: "WRAPPED",
    continuationTokenContract: "TWrappedToken1111111111111111111111",
    conversionTxHash: "tx-usdt-to-wrapped",
    outgoingTxHash: "tx-wrapped-out",
    protocolAddress: "TProtocol111111111111111111111111111",
    destinationAddress: "TRiskyDestination1111111111111111111",
    destinationRisk: "provider_risk",
    elapsedMs: 12_000,
    sourceAmountRaw: "101607508600",
    continuationAmountRaw: "101607508600",
    tokenQuality: "verified",
    score: 82,
    evidenceClass: "asset_continuation",
    reasons: ["Verified TRC20 continuation left the wallet and went to a provider-risk destination."],
    ...overrides
  };
}

function persistedDeepResultJsonForTest(report: DeepAddressForensicReport): Record<string, unknown> {
  return {
    subjectAddress: report.subjectAddress,
    windowStart: report.windowStart.toISOString(),
    windowEnd: report.windowEnd.toISOString(),
    runProfile: report.runProfile,
    providerBudget: report.providerBudget,
    serviceExposureProfiles: report.serviceExposureProfiles,
    addressBehaviorProfiles: report.addressBehaviorProfiles,
    inboundProvenanceProfiles: report.inboundProvenanceProfiles,
    counterpartyRiskProfiles: report.counterpartyRiskProfiles,
    directCounterpartyInteractionProfiles: report.directCounterpartyInteractionProfiles ?? [],
    approvalDrainProvenanceProfiles: report.approvalDrainProvenanceProfiles,
    contractDrivenCampaignSummary: report.contractDrivenCampaignSummary ?? null,
    assetContinuationProfiles: report.assetContinuationProfiles ?? [],
    stablecoinRestrictionProfiles: report.stablecoinRestrictionProfiles ?? [],
    boundaryExposureProfiles: report.boundaryExposureProfiles,
    operationalFlowProfiles: report.operationalFlowProfiles ?? [],
    walletRoleProfiles: report.walletRoleProfiles,
    extendedProvenanceProfiles: report.extendedProvenanceProfiles ?? [],
    missingChecks: report.missingChecks,
    coverage: report.coverage,
    coverageDebug: report.coverageDebug
  };
}

function formatUnifiedAddressFinalReportForTest(input: {
  address: string;
  whereReport: WhereIsMoneyReport;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  locale?: BotLocale;
  showBetaDiagnostics?: boolean;
}): string {
  const formatter = (createBotModule as {
    formatUnifiedAddressFinalReport?: (input: {
      address: string;
      whereReport: WhereIsMoneyReport;
      fastReport?: RiskReport | null;
      deepReport?: DeepAddressForensicReport | null;
      locale?: BotLocale;
      showBetaDiagnostics?: boolean;
    }) => { text: string };
  }).formatUnifiedAddressFinalReport;

  expect(formatter, "formatUnifiedAddressFinalReport should be exported by the unified final-report formatter").toBeTypeOf("function");
  return plainTelegramText(formatter!(input).text);
}

function formatUnifiedAddressDetailedReportForTest(input: {
  address: string;
  whereReport: WhereIsMoneyReport;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  locale?: BotLocale;
}): string {
  const formatter = (createBotModule as {
    formatUnifiedAddressDetailedReport?: (input: {
      address: string;
      whereReport: WhereIsMoneyReport;
      fastReport?: RiskReport | null;
      deepReport?: DeepAddressForensicReport | null;
      locale?: BotLocale;
    }) => { text: string };
  }).formatUnifiedAddressDetailedReport;

  expect(formatter, "formatUnifiedAddressDetailedReport should be exported").toBeTypeOf("function");
  return plainTelegramText(formatter!(input).text);
}

function riskReportForTest(overrides: Partial<RiskReport> = {}): RiskReport {
  return {
    subjectAddress: walletAddress,
    level: "LOW",
    score: 0,
    taintScore: 0,
    launderingPatternScore: 0,
    dominantRiskType: "none",
    reasons: [],
    ...overrides
  };
}

function manualCheckResultForTest(overrides: Partial<ManualCheckResult> = {}): ManualCheckResult {
  return {
    subjectAddress: walletAddress,
    report: riskReportForTest(),
    observations: [],
    rawEvidence: [],
    serviceExposureProfiles: [],
    addressBehaviorProfiles: [],
    inboundProvenanceProfiles: [],
    counterpartyRiskProfiles: [],
    directCounterpartyInteractionProfiles: [],
    stablecoinRestrictionProfiles: [],
    boundaryExposureProfiles: [],
    walletRoleProfiles: [],
    extendedProvenanceProfiles: [],
    missingChecks: [],
    ...overrides
  };
}

function formatAddressCheckStartedForTest(result: ManualCheckResult, options: { locale?: BotLocale } = {}): string {
  const formatter = (createBotModule as {
    formatAddressCheckStarted?: (result: ManualCheckResult, options?: { locale?: BotLocale }) => { text: string };
  }).formatAddressCheckStarted;

  expect(formatter, "formatAddressCheckStarted should be exported by the preliminary address formatter").toBeTypeOf("function");
  return plainTelegramText(formatter!(result, options).text);
}

function smartContractReportForTest(overrides: Partial<SmartContractCheckReport> = {}): SmartContractCheckReport {
  return {
    subjectAddress: walletAddress,
    decision: "DECLINE",
    decisionScope: "approval_safety",
    riskScore: 65,
    riskLevel: "HIGH",
    metadata: {
      address: walletAddress,
      source: "tronscan",
      name: "Test Router",
      tag: "Test Router",
      isContract: true,
      verified: true,
      accountType: 2,
      rawJson: {},
      fetchedAt: new Date("2026-05-24T00:00:00.000Z"),
      expiresAt: new Date("2026-05-25T00:00:00.000Z")
    },
    contractProfile: {
      contractAddress: walletAddress,
      name: "Test Router",
      serviceTag: "Test Router",
      isVerified: true,
      activityLevel: "normal",
      hasTransferFromSelector: true
    } as SmartContractCheckReport["contractProfile"],
    relatedApprovals: [],
    llmVerdict: {
      contractAddress: walletAddress,
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.82,
      contractRiskScore: 65,
      decisionRecommendation: "DECLINE",
      reasons: ["spender has approval control"],
      citedEvidenceIds: [walletAddress],
      falsePositiveNotes: [],
      source: "llm",
      cacheMatch: null
    },
    exactDrainProven: false,
    serviceLabel: "Test Router",
    activityLabel: "normal",
    reasons: [
      "address_is_smart_contract",
      "active_unlimited_usdt_approval_spender"
    ],
    limitations: ["exact_drain_not_proven_in_standalone_check"],
    ...overrides
  };
}

function lastMessagePayload(calls: ReplyCall[]): Record<string, any> {
  return messageCalls(calls).at(-1)?.payload ?? {};
}

function findCallbackData(payload: Record<string, any>, prefix: string): string {
  const rows = payload.reply_markup?.inline_keyboard ?? [];
  for (const row of rows) {
    for (const button of row) {
      if (typeof button.callback_data === "string" && button.callback_data.startsWith(prefix)) {
        return button.callback_data;
      }
    }
  }
  throw new Error(`Callback data with prefix ${prefix} was not found`);
}

function buttonTexts(payload: Record<string, any>): string[] {
  return buttonRows(payload).flat();
}

function buttonRows(payload: Record<string, any>): string[][] {
  return (payload.reply_markup?.inline_keyboard ?? []).map((row: Array<{ text: string }>) => row.map((button) => button.text));
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createSmokeBot(options: {
  failAnswerCallbackQuery?: boolean;
  addressRiskSignals?: (address: string) => Promise<any>;
  queueDeepForensicJob?: BotOptions["queueDeepForensicJob"];
  queueWhereIsMoneyJob?: BotOptions["queueWhereIsMoneyJob"];
  saveAddressFastCheckJob?: BotOptions["saveAddressFastCheckJob"];
  checkSmartContractAddress?: BotOptions["checkSmartContractAddress"];
  getForensicCheckJob?: BotOptions["getForensicCheckJob"];
  tronClient?: TronDashboardClient;
  runtimeInstanceLabel?: string;
  defaultLocale?: BotLocale;
} = {}) {
  const config = {
    ...createConfig(),
    runtimeInstanceLabel: options.runtimeInstanceLabel
  };
  const bot = createBot(config, createFakeDb(options.defaultLocale ?? "en"), options.tronClient ?? createTronClient(), {
    getAddressRiskSignalsForAddress: options.addressRiskSignals,
    checkSmartContractAddress: options.checkSmartContractAddress,
    queueDeepForensicJob: options.queueDeepForensicJob,
    queueWhereIsMoneyJob: options.queueWhereIsMoneyJob,
    saveAddressFastCheckJob: options.saveAddressFastCheckJob ?? (async (input) => ({
      id: "fast-check-job-default",
      kind: "address_fast_check",
      subjectAddress: input.subjectAddress,
      status: input.status,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      priority: input.priority ?? 100,
      chatId: input.chatId ?? null,
      messageId: null,
      requestedBy: input.requestedBy ?? null,
      progressJson: input.progressJson,
      resultJson: input.resultJson,
      rawEvidenceIds: input.rawEvidenceIds,
      observationIds: input.observationIds,
      lastError: input.lastError,
      createdAt: new Date("2026-05-24T00:00:00.000Z"),
      updatedAt: new Date("2026-05-24T00:00:00.000Z"),
      startedAt: new Date("2026-05-24T00:00:00.000Z"),
      completedAt: new Date("2026-05-24T00:00:00.000Z")
    })),
    getForensicCheckJob: options.getForensicCheckJob
  });
  const calls: ReplyCall[] = [];
  bot.api.config.use(async (_prev, method, payload): Promise<any> => {
    if (method === "getMe") {
      return {
        ok: true,
        result: {
          id: 123456,
          is_bot: true,
          first_name: "Smoke Test Bot",
          username: "smoke_test_bot"
        }
      };
    }
    if (method === "answerCallbackQuery" && options.failAnswerCallbackQuery) {
      throw new Error("Call to 'answerCallbackQuery' failed! (400: Bad Request: query is too old and response timeout expired or query ID is invalid)");
    }
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true };
  });
  await bot.init();
  return { bot, calls };
}

describe("bot command and inline UX smoke coverage", () => {
  it("parses incoming deposit job check callbacks", () => {
    expect(parseCallbackData("check:deposit:42a0a912-dc6a-45b5-b281-a2f0c7ac034e")).toEqual({
      kind: "check_deposit_job",
      jobId: "42a0a912-dc6a-45b5-b281-a2f0c7ac034e"
    });
    expect(parseCallbackData(`check:xbridge:${walletAddress}`)).toEqual({
      kind: "check_cross_bridge",
      address: walletAddress
    });
    expect(parseCallbackData(`check:xchain:${walletAddress}`)).toBeNull();
    expect(parseCallbackData("check:xchain")).toBeNull();
    expect(parseCallbackData("check:deposit:not-a-uuid")).toBeNull();
    expect(parseCallbackData("check:xbridge:not-a-wallet")).toBeNull();
    expect(parseCallbackData("check:xchain:not-a-wallet")).toBeNull();
  });

  it("parses theft report start callbacks", () => {
    expect(parseCallbackData("theft:start")).toEqual({
      kind: "theft_start"
    });
    expect(parseCallbackData("theft:confirm:report-1")).toEqual({
      kind: "theft_confirm",
      reportId: "report-1"
    });
    expect(parseCallbackData("theft:change_tx:report-1")).toEqual({
      kind: "theft_change_tx",
      reportId: "report-1"
    });
    expect(parseCallbackData("theft:comment:report-1")).toEqual({
      kind: "theft_comment",
      reportId: "report-1"
    });
    expect(parseCallbackData("theft:deposit_sent:report-1")).toEqual({
      kind: "theft_deposit_sent",
      reportId: "report-1"
    });
    expect(parseCallbackData("theft:guide:report-1")).toEqual({
      kind: "theft_guide",
      reportId: "report-1"
    });
    expect(parseCallbackData("theft:admin:report-1")).toEqual({
      kind: "theft_admin",
      reportId: "report-1"
    });
  });

  it("handles /start with compact product menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));

    expect(messageCalls(calls)).toHaveLength(1);
    expect(lastMessagePayload(calls).parse_mode).toBe("HTML");
    expect(lastText(calls)).toContain("TRON Guard");
    expect(lastText(calls)).toContain("Monitors incoming USDT");
    expect(lastPlainText(calls)).toContain("Watched wallets: 0");
    expect(lastPlainText(calls)).toContain("Checks addresses and transactions");
    expect(lastMessagePayload(calls).reply_markup?.inline_keyboard).toBeTruthy();
    expect(buttonRows(lastMessagePayload(calls))).toEqual([
      ["📁 Wallets", "➕ Add"],
      ["🔎 Address", "🧾 Tx"],
      ["🚨 Report theft"],
      ["🛡 Risk intel", "👤 Profile"],
      ["⚙️ Settings", "❔ Help"]
    ]);
  });

  it("uses Russian by default and can switch to English", async () => {
    const { bot, calls } = await createSmokeBot({ defaultLocale: "ru" });

    await bot.handleUpdate(messageUpdate("/start", userId));
    expect(lastPlainText(calls)).toContain("Следит за входящими USDT");
    expect(buttonTexts(lastMessagePayload(calls))).not.toContain("🇬🇧 English");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("🚨 Сообщить о краже");

    await bot.handleUpdate(callbackQueryUpdate("settings", userId));
    expect(buttonTexts(lastMessagePayload(calls))).toContain("🇬🇧 English");

    await bot.handleUpdate(callbackQueryUpdate("settings:language:en", userId));
    expect(lastPlainText(calls)).toContain("Current language: English");

    await bot.handleUpdate(messageUpdate("/start", userId));
    expect(lastPlainText(calls)).toContain("Monitors incoming USDT");
  });

  it("opens help from the inline menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));
    await bot.handleUpdate(callbackQueryUpdate("help", userId));

    expect(lastText(calls)).toContain("TRON Guard help");
    expect(lastText(calls)).toContain("<b>What the bot does</b>");
    expect(lastText(calls)).toContain("checks sender and deposit context");
    expect(lastText(calls)).toContain("The bot does not store keys or sign transactions");
    expect(lastText(calls)).toContain("/profile");
    expect(lastText(calls)).toContain("/my_id");
  });

  it("continues handling stale callback queries after Telegram rejects answerCallbackQuery", async () => {
    const { bot, calls } = await createSmokeBot({ failAnswerCallbackQuery: true });

    await bot.handleUpdate(callbackQueryUpdate("help", userId));

    expect(lastText(calls)).toContain("TRON Guard help");
    expect(lastText(calls)).toContain("checks sender and deposit context");
  });

  it("opens risk intelligence from the main menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("risk:intel", userId));

    expect(lastText(calls)).toContain("🛡 Risk intelligence");
    expect(lastText(calls)).toContain("Internal labels: active");
    expect(lastText(calls)).toContain("AML providers: not connected");
    expect(lastText(calls)).toContain("Forensic route context: limited");
    expect(lastText(calls)).toContain("USDT approvals: limited");
  });

  it("returns the current user's Telegram ID", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/my_id", userId));

    expect(lastPlainText(calls)).toContain(`Telegram ID: ${userId}`);
    expect(lastText(calls)).toContain("@user_42");
  });

  it("opens profile from command and inline menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/profile", userId));
    expect(lastText(calls)).toContain("👤 Profile");
    expect(lastPlainText(calls)).toContain(`Telegram ID: ${userId}`);
    expect(lastPlainText(calls)).toContain("Language: English");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("📁 Wallets");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("⚙️ Settings");

    await bot.handleUpdate(callbackQueryUpdate("profile", userId));
    expect(lastText(calls)).toContain("👤 Profile");
  });

  it("shows actionable settings with customer alert admin controls", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/settings", userId));

    expect(lastText(calls)).toContain("⚙️ Settings");
    expect(lastPlainText(calls)).toContain("Owner alerts: per-wallet alert mode");
    expect(lastPlainText(calls)).toContain("Alert admins: 0");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("👥 Alert admins");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ Suspicious admin");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ All alerts admin");
  });

  it("adds a valid wallet, shows dashboard metrics, and lists it", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    const texts = messageCalls(calls).map((call) => String(call.payload.text));
    const plainDashboard = plainTelegramText(texts[0]);
    expect(texts[0]).toContain("📍 Wallet dashboard");
    expect(plainDashboard).toContain(walletAddress);
    expect(plainDashboard).toContain("Monitoring: active");
    expect(plainDashboard).toContain("Alerts: realtime");
    expect(plainDashboard).toContain("Wallet safety: 🟢 OK");
    expect(plainDashboard).toContain("Risk: 🟢 0/100 (LOW, beta)");
    expect(plainDashboard).toContain("USDT: 7.00");
    expect(plainDashboard).toContain("Gas/fees: 6.00 TRX");
    expect(texts[0]).not.toContain("tx total");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("🔄 Refresh");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("📊 Analytics");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("🛡 Safety");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("🔎 Address");
    expect(buttonTexts(messageCalls(calls)[0].payload)).toContain("🧾 Tx");
    expect(buttonTexts(messageCalls(calls)[0].payload).some((text) => text.includes("Alert mode"))).toBe(true);
    expect(plainTelegramText(texts[1])).toContain("Watched wallets: 1");
  });

  it("changes wallet alert mode through dashboard buttons", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const alertModeCallback = findCallbackData(lastMessagePayload(calls), "wl:alerts:");
    const walletId = alertModeCallback.replace("wl:alerts:", "");

    await bot.handleUpdate(callbackQueryUpdate(alertModeCallback, userId));

    expect(lastText(calls)).toContain("Alert mode");
    expect(lastPlainText(calls)).toContain("Current: realtime");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("Digest 10m");
    expect(findCallbackData(lastMessagePayload(calls), `wl:mode:${walletId}:digest:10`)).toBe(
      `wl:mode:${walletId}:digest:10`
    );

    await bot.handleUpdate(callbackQueryUpdate(`wl:mode:${walletId}:digest:10`, userId));

    expect(lastPlainText(calls)).toContain("Alerts: digest 10m");
  });

  it("changes wallet alert mode through /wallet_mode", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));

    await bot.handleUpdate(messageUpdate(`/wallet_mode ${walletAddress} digest 15`, userId));

    expect(lastText(calls)).toContain("Alert mode updated");
    expect(lastText(calls)).toContain("digest 15m");

    await bot.handleUpdate(messageUpdate(`/wallet_mode ${walletAddress} paused`, userId));

    expect(lastText(calls)).toContain("Alert mode updated");
    expect(lastText(calls)).toContain("paused");

    await bot.handleUpdate(messageUpdate(`/wallet_mode ${walletAddress} digest 2`, userId));

    expect(lastText(calls)).toContain("Digest interval must be between 5 and 60 minutes");
  });

  it("checks an address without live Tron or database dependencies", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(lastMessagePayload(calls).parse_mode).toBe("HTML");
    expect(lastPlainText(calls)).toContain("Address check \u2014 started");
    expect(lastPlainText(calls)).toContain(`Address: ${walletAddress}`);
    expect(lastPlainText(calls)).not.toContain("Address risk");
    expect(lastPlainText(calls)).not.toContain("0/100");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("Start cross-bridge");
  });

  it("shows bounded service exposure context for address checks", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [
          {
            code: "forensic_service_exposure",
            message: "Service exposure candidate; manual review required.",
            scoreImpact: 50,
            source: "forensic_route_search",
            confidence: "high",
            severity: "high",
            evidenceRef: "raw_exposure_1"
          }
        ],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [
          {
            subjectAddress: walletAddress,
            totalOutgoingRaw: "321952450320",
            totalOutgoingCount: 6,
            directServiceVolumeRatio: 0,
            directServiceTxRatio: 0,
            indirectServiceVolumeRatio: 0.03,
            indirectServiceTxRatio: 0.16,
            mergedServiceVolumeRatio: 0.97,
            mergedServiceGroupCount: 1,
            combinedServiceVolumeRatio: 1,
            combinedServiceTxRatio: 1,
            dominantCategory: "bridge_pool",
            categoryBreakdown: [],
            topServiceCounterparties: [],
            topMergedServiceFlows: [
              {
                intermediateAddress: secondWalletAddress,
                serviceAddress: "TService11111111111111111111111111111",
                category: "bridge_pool",
                identity: "Allbridge LP",
                incomingRaw: "311851000000",
                outgoingServiceRaw: "311752000000",
                sourceTxCount: 4,
                serviceTxCount: 9,
                amountPreservationRatio: 0.9997,
                firstSourceTransferAt: "2026-05-09T21:06:51.000Z",
                lastServiceTransferAt: "2026-05-09T23:14:06.000Z"
              }
            ],
            fastestServiceExitMs: 7_629_000,
            bestAmountPreservationRatio: 0.9997,
            exposureScore: 100,
            features: []
          }
        ],
        missingChecks: ["Expansion stopped at service boundary TService11111111111111111111111111111 (bridge_pool)"]
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address check \u2014 started");
    expect(text).toContain("Final risk appears after provenance analysis.");
    expect(text).not.toContain("Address risk:");
    expect(text).not.toContain("Outgoing USDT reaches service, router, CEX, bridge, or contract infrastructure. Manual review is recommended.");
    expect(text).not.toContain("Key signals");
    expect(text).not.toContain("Limits");
    expect(text).not.toContain("Score: 30/30");
    expect(text).not.toContain("Score: 45/50");
    expect(text).not.toContain("fraud proven");
  });

  it("shows exact token-contract blacklist evidence before behavior context", async () => {
    const profile = stablecoinRestrictionProfile();
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: [
          {
            code: "stablecoin_usdt_blacklisted",
            message: "Official TRON USDT contract blacklist state is active for this address.",
            scoreImpact: 90,
            source: "stablecoin_contract",
            confidence: "high",
            severity: "critical",
            evidenceRef: "raw-stablecoin"
          }
        ],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "100000000000",
            outgoingVolumeRaw: "95000000000",
            incomingTxCount: 1,
            outgoingTxCount: 1,
            uniqueIncomingCounterparties: 1,
            uniqueOutgoingCounterparties: 1,
            largestIncomingRaw: "100000000000",
            largestOutgoingRaw: "95000000000",
            topOutgoingCounterpartyAddress: secondWalletAddress,
            topOutgoingCounterpartyRaw: "95000000000",
            topOutgoingCounterpartyTxCount: 1,
            topOutgoingCounterpartyRatio: 1,
            inflowToOutflowRatio: 0.95,
            drainToServiceRatio: 0,
            timeToFirstOutgoingMs: 30 * 60 * 1000,
            timeToFirstServiceExitMs: null,
            depositThenDrainScore: 10,
            transitScore: 0,
            dampenerScore: 0,
            features: [
              {
                code: "address_behavior_fast_post_deposit_exit",
                label: "Outgoing USDT starts within 1 hour of incoming funds",
                scoreImpact: 10
              }
            ]
          }
        ],
        stablecoinRestrictionProfiles: [profile],
        missingChecks: []
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("90/100 (CRITICAL, beta)");
    expect(text).toContain("Hard evidence");
    expect(text).toContain("USDT blacklist: active");
    expect(text).toContain("Blocked balance: 2642746.07 USDT");
    expect(text).toContain(`Contract: ${TRON_USDT_CONTRACT_ADDRESS}`);
    expect(text).not.toContain("Method: isBlackListed(address)");
    expect(text).not.toContain("Blacklist event: tx-blacklist");
    expect(text.indexOf("Hard evidence")).toBeLessThan(text.indexOf("Why"));
    expect(text).toContain("This is exact token-contract state, not a behavioral guess.");
  });

  it("does not run address exposure for transaction checks", async () => {
    let exposureCalls = 0;
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => {
        exposureCalls += 1;
        return { graphSignals: [], behaviorSignals: [], amlSignals: [] };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${txHash}`, userId));

    expect(exposureCalls).toBe(0);
    expect(lastPlainText(calls)).toContain(`Subject: ${secondWalletAddress}`);
  });

  it("queues seeded where-is-money and renders tx-centric manual copy for parseable USDT transaction checks", async () => {
    let queuedSubject: string | null = null;
    let queuedAmount: string | null | undefined = null;
    let queuedSeedTx: string | undefined;
    let queuedMode: string | undefined;
    let queuedWindowStart: Date | undefined;
    let queuedWindowEnd: Date | undefined;
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      tronClient: {
        ...createTronClient(),
        async getTransaction() {
          return {
            trc20TransferInfo: [{
              from_address: secondWalletAddress,
              to_address: walletAddress,
              quant: "1000000000",
              block_ts: Date.parse("2026-05-28T10:00:00.000Z"),
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              confirmed: true,
              contractRet: "SUCCESS"
            }]
          };
        }
      },
      queueWhereIsMoneyJob: async (input) => {
        queuedSubject = input.subjectAddress;
        queuedAmount = input.requestedAmountRaw;
        queuedSeedTx = input.seedTransfers?.[0]?.txHash;
        queuedMode = input.mode;
        queuedWindowStart = input.windowStart;
        queuedWindowEnd = input.windowEnd;
        return {
          id: "tx-where-job-1",
          kind: "where_is_money_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: input.windowStart ?? new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: input.windowEnd ?? new Date("2026-05-24T00:00:00.000Z"),
          priority: 120,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${txHash}`, userId));

    expect(queuedMode).toBe("transaction_check");
    expect(queuedSubject).toBe(walletAddress);
    expect(queuedAmount).toBe("1000000000");
    expect(queuedSeedTx).toBe(txHash);
    expect(queuedWindowEnd?.toISOString()).toBe("2026-05-28T10:00:00.000Z");
    expect(queuedWindowStart?.toISOString()).toBe("2026-04-28T10:00:00.000Z");
    const sentText = lastPlainText(calls);
    expect(sentText).toContain("Проверка tx");
    expect(sentText).toContain("Быстрая проверка отправителя");
    expect(sentText).toContain("Сумма: 1000 USDT");
    expect(sentText).toContain(`От: ${secondWalletAddress}`);
    expect(sentText).toContain(`Кому: ${walletAddress}`);
    expect(sentText).toContain("Происхождение суммы: запущено");
    expect(sentText).not.toContain("Риск tx");
    expect(sentText).not.toContain("Tx risk");
    expect(sentText).not.toContain("Manual tx subject");
  });

  it("queues where-is-money and deep forensic jobs for address checks and renders compact preliminary address copy", async () => {
    let queuedWhereAddress: string | null = null;
    let queuedWhereMode: string | undefined;
    let queuedWhereWindowStart: Date | undefined;
    let queuedWhereWindowEnd: Date | undefined;
    let queuedDeepAddress: string | null = null;
    let queuedDeepWindowStart: Date | undefined;
    let queuedDeepWindowEnd: Date | undefined;
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      queueWhereIsMoneyJob: async (input) => {
        queuedWhereAddress = input.subjectAddress;
        queuedWhereMode = input.mode;
        queuedWhereWindowStart = input.windowStart;
        queuedWhereWindowEnd = input.windowEnd;
        return {
          id: "where-job-1",
          kind: "where_is_money_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 120,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: input.requestedAmountRaw ? { requestedAmountRaw: input.requestedAmountRaw } : {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      },
      queueDeepForensicJob: async (input) => {
        queuedDeepAddress = input.subjectAddress;
        queuedDeepWindowStart = input.windowStart;
        queuedDeepWindowEnd = input.windowEnd;
        return {
          id: "deep-job-1",
          kind: "address_deep_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 100,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(queuedWhereAddress).toBe(walletAddress);
    expect(queuedWhereMode).toBe("wallet_profile");
    expect(queuedDeepAddress).toBe(walletAddress);
    expect(queuedWhereWindowStart).toBeInstanceOf(Date);
    expect(queuedWhereWindowEnd).toBeInstanceOf(Date);
    expect(queuedDeepWindowStart).toBe(queuedWhereWindowStart);
    expect(queuedDeepWindowEnd).toBe(queuedWhereWindowEnd);
    expect(queuedWhereWindowStart?.getTime()).toBe(queuedDeepWindowStart?.getTime());
    expect(queuedWhereWindowEnd?.getTime()).toBe(queuedDeepWindowEnd?.getTime());
    expect((queuedWhereWindowEnd?.getTime() ?? 0) - (queuedWhereWindowStart?.getTime() ?? 0)).toBe(90 * 24 * 60 * 60 * 1000);
    const sentText = lastPlainText(calls);
    expect(sentText).toContain(walletAddress);
    expect(sentText).toContain("USDT");
    expect(sentText).not.toContain("0/100");
    expect(sentText).not.toContain("Address risk");
    expect(sentText).not.toContain("0/100");
    expect(sentText).not.toContain("Deep research");
    expect(sentText).not.toContain("Key signals");
    expect(sentText).not.toContain("Limits");
  });

  it("saves address fast check jobs for admin graph history", async () => {
    let savedFastInput: AddressFastCheckJobInput | null = null;
    const fastCounterpartyTopsProfile: FastCounterpartyTopsProfile = {
      subjectAddress: walletAddress,
      windowStart: "2026-04-24T00:00:00.000Z",
      windowEnd: "2026-05-24T00:00:00.000Z",
      incomingVolumeRaw: "150000000",
      outgoingVolumeRaw: "50000000",
      incomingTxCount: 2,
      outgoingTxCount: 1,
      topIncomingCounterparties: [{
        address: secondWalletAddress,
        direction: "incoming",
        volumeRaw: "150000000",
        txCount: 2,
        volumeRatio: 1,
        firstSeen: "2026-05-23T10:00:00.000Z",
        lastSeen: "2026-05-24T10:00:00.000Z",
        sampleTxHashes: ["tx-in-1"],
        category: null,
        identity: null,
        selectedAsDeepPriorityHint: true
      }],
      topOutgoingCounterparties: [{
        address: `T${"3".repeat(33)}`,
        direction: "outgoing",
        volumeRaw: "50000000",
        txCount: 1,
        volumeRatio: 1,
        firstSeen: "2026-05-24T11:00:00.000Z",
        lastSeen: "2026-05-24T11:00:00.000Z",
        sampleTxHashes: ["tx-out-1"],
        category: "cex",
        identity: "Test CEX",
        selectedAsDeepPriorityHint: true
      }],
      topServiceCounterparties: [{
        address: `T${"4".repeat(33)}`,
        direction: "service",
        volumeRaw: "50000000",
        txCount: 1,
        volumeRatio: 1,
        firstSeen: "2026-05-24T11:00:00.000Z",
        lastSeen: "2026-05-24T11:00:00.000Z",
        sampleTxHashes: ["tx-service-1"],
        category: "cex",
        identity: "Test CEX",
        selectedAsDeepPriorityHint: true
      }],
      categoryBreakdown: [{
        direction: "outgoing",
        category: "cex",
        volumeRaw: "50000000",
        txCount: 1,
        volumeRatio: 1
      }]
    };
    const { bot } = await createSmokeBot({
      defaultLocale: "ru",
      addressRiskSignals: async () => ({
        graphSignals: [{
          code: "test_fast_signal",
          message: "Fast check test signal",
          scoreImpact: 42,
          source: "test",
          confidence: "high",
          severity: "medium",
          evidenceRef: "fast-raw-1"
        }],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [{
          id: "fast-raw-1",
          source: "test",
          sourceType: "detector_output",
          chain: "tron",
          address: walletAddress,
          txHash: null,
          observedTransactionHash: null,
          evidenceJson: { kind: "fast" }
        }],
        observations: [{
          id: "fast-observation-1",
          subjectChain: "tron",
          subjectAddress: walletAddress,
          subjectTxHash: null,
          observedTransactionHash: null,
          signalGroup: "graph",
          code: "test_fast_signal",
          message: "Fast check test signal",
          scoreImpact: 42,
          confidence: "high",
          severity: "medium",
          source: "test",
          policyVersion: "test",
          rawEvidenceId: "fast-raw-1"
        }],
        fastCounterpartyTopsProfile,
        missingChecks: ["service_exposure_timeout"]
      }),
      queueWhereIsMoneyJob: async (input) => ({
        id: "where-job-for-fast",
        kind: "where_is_money_check",
        subjectAddress: input.subjectAddress,
        status: "queued",
        windowStart: input.windowStart ?? new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: input.windowEnd ?? new Date("2026-05-24T00:00:00.000Z"),
        priority: 120,
        chatId: input.chatId,
        messageId: null,
        requestedBy: input.requestedBy,
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: null,
        completedAt: null
      }),
      queueDeepForensicJob: async (input) => ({
        id: "deep-job-for-fast",
        kind: "address_deep_check",
        subjectAddress: input.subjectAddress,
        status: "queued",
        windowStart: input.windowStart ?? new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: input.windowEnd ?? new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: input.chatId,
        messageId: null,
        requestedBy: input.requestedBy,
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: null,
        completedAt: null
      }),
      saveAddressFastCheckJob: async (input) => {
        savedFastInput = input;
        return {
          id: "fast-check-job-1",
          kind: "address_fast_check",
          subjectAddress: input.subjectAddress,
          status: input.status,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          priority: input.priority ?? 100,
          chatId: input.chatId ?? null,
          messageId: null,
          requestedBy: input.requestedBy ?? null,
          progressJson: input.progressJson,
          resultJson: input.resultJson,
          rawEvidenceIds: input.rawEvidenceIds,
          observationIds: input.observationIds,
          lastError: input.lastError,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: new Date("2026-05-24T00:00:00.000Z"),
          completedAt: new Date("2026-05-24T00:00:00.000Z")
        };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
    const savedFastJob = savedFastInput as AddressFastCheckJobInput | null;

    expect(savedFastJob).toMatchObject({
      subjectAddress: walletAddress,
      status: "partial",
      chatId: userId,
      requestedBy: userId,
      rawEvidenceIds: expect.arrayContaining(["fast-raw-1"]),
      observationIds: expect.any(Array),
      lastError: null
    });
    if (!savedFastJob) throw new Error("Expected address fast check job to be saved.");
    expect(savedFastJob.observationIds.length).toBeGreaterThan(0);
    expect(savedFastJob.windowStart).toBeInstanceOf(Date);
    expect(savedFastJob.windowEnd).toBeInstanceOf(Date);
    expect(savedFastJob.windowEnd.getTime() - savedFastJob.windowStart.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(savedFastJob.resultJson.fastRiskReport).toMatchObject({
      subjectAddress: walletAddress,
      score: expect.any(Number)
    });
    expect(savedFastJob.resultJson.fastCounterpartyTopsProfile).toEqual(fastCounterpartyTopsProfile);
    expect(savedFastJob.resultJson.missingChecks).toEqual(["service_exposure_timeout"]);
    expect(savedFastJob.resultJson.followUpJobs).toEqual({
      whereIsMoneyJobId: "where-job-for-fast",
      deepJobId: "deep-job-for-fast"
    });
  });

  it("queues crossbridge continuation immediately from the address result button", async () => {
    const queuedWhereInputs: Array<Record<string, any>> = [];
    const queuedDeepInputs: Array<Record<string, any>> = [];
    const { bot, calls } = await createSmokeBot({
      defaultLocale: "ru",
      queueWhereIsMoneyJob: async (input) => {
        queuedWhereInputs.push(input as Record<string, any>);
        const isCrossBridge = Boolean((input as Record<string, any>).crossChainManualDeepMode);
        return {
          id: isCrossBridge ? "where-crossbridge-job-1" : "where-job-1",
          kind: "where_is_money_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: input.windowStart ?? new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: input.windowEnd ?? new Date("2026-05-24T00:00:00.000Z"),
          priority: 120,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: isCrossBridge ? { crossChainManualDeepMode: true } : {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      },
      queueDeepForensicJob: async (input) => {
        queuedDeepInputs.push(input as Record<string, any>);
        return {
          id: "deep-job-1",
          kind: "address_deep_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: input.windowStart ?? new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: input.windowEnd ?? new Date("2026-05-24T00:00:00.000Z"),
          priority: 100,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const callbackData = findCallbackData(lastMessagePayload(calls), "check:xbridge:");
    expect(callbackData).toBe(`check:xbridge:${walletAddress}`);
    expect(queuedWhereInputs).toHaveLength(1);
    expect(queuedWhereInputs[0].crossChainManualDeepMode).toBeUndefined();
    expect(queuedDeepInputs).toHaveLength(1);
    expect(queuedWhereInputs[0].windowEnd.getTime() - queuedWhereInputs[0].windowStart.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(queuedDeepInputs[0].windowEnd.getTime() - queuedDeepInputs[0].windowStart.getTime()).toBe(90 * 24 * 60 * 60 * 1000);

    await bot.handleUpdate(callbackQueryUpdate(callbackData, userId));

    expect(queuedWhereInputs).toHaveLength(2);
    expect(queuedWhereInputs[1]).toMatchObject({
      subjectAddress: walletAddress,
      requestedBy: userId,
      mode: "wallet_profile",
      crossChainManualDeepMode: true
    });
    expect(queuedWhereInputs[1].windowStart).toBeInstanceOf(Date);
    expect(queuedWhereInputs[1].windowEnd).toBeInstanceOf(Date);
    expect(queuedWhereInputs[1].windowEnd.getTime() - queuedWhereInputs[1].windowStart.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(queuedDeepInputs).toHaveLength(1);
    expect(lastPlainText(calls)).toContain("Кроссбридж-анализ запущен");
    expect(lastPlainText(calls)).toContain("where-crossbridge-job-1");
  });

  it("routes contract address checks to the smart contract report", async () => {
    const { bot, calls } = await createSmokeBot({
      checkSmartContractAddress: async () => smartContractReportForTest()
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const sentText = lastPlainText(calls);
    expect(sentText).toContain("Smart contract check");
    expect(sentText).toContain(`Contract address: ${walletAddress}`);
    expect(sentText).toContain("Decision: DECLINE");
  });

  it("does not queue where-is-money or deep forensic jobs for contract address checks", async () => {
    let whereQueueCalls = 0;
    let deepQueueCalls = 0;
    const { bot } = await createSmokeBot({
      checkSmartContractAddress: async () => smartContractReportForTest(),
      queueWhereIsMoneyJob: async () => {
        whereQueueCalls += 1;
        throw new Error("should not queue where-is-money for contract address");
      },
      queueDeepForensicJob: async () => {
        deepQueueCalls += 1;
        throw new Error("should not queue deep forensic for contract address");
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(whereQueueCalls).toBe(0);
    expect(deepQueueCalls).toBe(0);
  });

  it("does not fall back to the normal wallet check when smart contract checking fails", async () => {
    let whereQueueCalls = 0;
    let deepQueueCalls = 0;
    const { bot, calls } = await createSmokeBot({
      checkSmartContractAddress: async () => {
        throw new Error("approval relation lookup failed");
      },
      queueWhereIsMoneyJob: async () => {
        whereQueueCalls += 1;
        throw new Error("should not queue where-is-money after contract check failure");
      },
      queueDeepForensicJob: async () => {
        deepQueueCalls += 1;
        throw new Error("should not queue deep forensic after contract check failure");
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const sentText = lastPlainText(calls);
    expect(sentText).toContain("Smart contract check unavailable");
    expect(sentText).toContain("approval relation lookup failed");
    expect(whereQueueCalls).toBe(0);
    expect(deepQueueCalls).toBe(0);
  });

  it("still queues where-is-money and deep forensic jobs for normal EOA address checks", async () => {
    let whereQueueCalls = 0;
    let deepQueueCalls = 0;
    const { bot } = await createSmokeBot({
      checkSmartContractAddress: async () => null,
      queueWhereIsMoneyJob: async (input) => {
        whereQueueCalls += 1;
        return {
          id: "where-eoa-job",
          kind: "where_is_money_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 120,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      },
      queueDeepForensicJob: async (input) => {
        deepQueueCalls += 1;
        return {
          id: "deep-eoa-job",
          kind: "address_deep_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 100,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(whereQueueCalls).toBe(1);
    expect(deepQueueCalls).toBe(1);
  });

  it("passes fast risk reasons into queued address forensic jobs", async () => {
    let queuedWhereReasons: RiskReport["reasons"] | undefined;
    let queuedDeepReasons: RiskReport["reasons"] | undefined;
    const { bot } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: [{
          code: "stablecoin_usdt_blacklisted",
          message: "Official TRON USDT contract blacklist state is active for this address.",
          scoreImpact: 90,
          source: "stablecoin_contract",
          confidence: "high",
          severity: "critical",
          evidenceRef: "usdt-blacklist-evidence"
        }],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        missingChecks: []
      }),
      queueWhereIsMoneyJob: async (input) => {
        queuedWhereReasons = input.fastRiskSnapshot?.reasons;
        return {
          id: "where-fast-reasons-job",
          kind: "where_is_money_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 120,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      },
      queueDeepForensicJob: async (input) => {
        queuedDeepReasons = input.fastRiskSnapshot?.reasons;
        return {
          id: "deep-fast-reasons-job",
          kind: "address_deep_check",
          subjectAddress: input.subjectAddress,
          status: "queued",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 100,
          chatId: input.chatId,
          messageId: null,
          requestedBy: input.requestedBy,
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: [],
          observationIds: [],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: null,
          completedAt: null
        };
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(queuedWhereReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "stablecoin_usdt_blacklisted", evidenceRef: "usdt-blacklist-evidence" })
    ]));
    expect(queuedDeepReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "stablecoin_usdt_blacklisted", evidenceRef: "usdt-blacklist-evidence" })
    ]));
  });

  it("formats smart contract reports with readable Russian title", () => {
    const message = formatSmartContractCheckReport(smartContractReportForTest(), { locale: "ru" });

    expect(plainTelegramText(message.text)).toContain("Проверка смарт-контракта");
  });

  it("uses English queued status and job ids in the address check next block", async () => {
    const { bot, calls } = await createSmokeBot({
      queueWhereIsMoneyJob: async (input) => ({
        id: "where-job-en",
        kind: "where_is_money_check",
        subjectAddress: input.subjectAddress,
        status: "queued",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 120,
        chatId: input.chatId,
        messageId: null,
        requestedBy: input.requestedBy,
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: null,
        completedAt: null
      }),
      queueDeepForensicJob: async (input) => ({
        id: "deep-job-en",
        kind: "address_deep_check",
        subjectAddress: input.subjectAddress,
        status: "queued",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: input.chatId,
        messageId: null,
        requestedBy: input.requestedBy,
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: null,
        completedAt: null
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const sentText = lastPlainText(calls);
    expect(sentText).toContain("Address check \u2014 started");
    expect(sentText).toContain("What is running");
    expect(sentText).toContain("Final risk appears after provenance analysis.");
    expect(sentText).not.toContain("Where is money: queued (where-job-en)");
    expect(sentText).not.toContain("Deep research: queued (deep-job-en)");
    expect(sentText).not.toContain("Where is money: запущено");
    expect(sentText).not.toContain("Откуда деньги");
  });

  it("rejects malformed amount on address checks without queueing forensic jobs", async () => {
    let queueCalls = 0;
    const { bot, calls } = await createSmokeBot({
      queueWhereIsMoneyJob: async () => {
        queueCalls += 1;
        throw new Error("should not queue malformed amount");
      },
      queueDeepForensicJob: async () => {
        queueCalls += 1;
        throw new Error("should not queue malformed amount");
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress} 1.1234567`, userId));

    expect(queueCalls).toBe(0);
    expect(lastPlainText(calls)).toContain("Could not read the amount");
    expect(lastText(calls)).toContain("/check <TRON-address-or-tx-hash> 5000");
  });

  it("rejects extra tokens on address checks without queueing forensic jobs", async () => {
    let queueCalls = 0;
    const { bot, calls } = await createSmokeBot({
      queueWhereIsMoneyJob: async () => {
        queueCalls += 1;
        throw new Error("should not queue extra tokens");
      },
      queueDeepForensicJob: async () => {
        queueCalls += 1;
        throw new Error("should not queue extra tokens");
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress} 1000 extra`, userId));

    expect(queueCalls).toBe(0);
    expect(lastPlainText(calls)).toContain("Could not read the amount");
    expect(lastText(calls)).toContain("/check <TRON-address-or-tx-hash> 5000");
  });

  it("rejects malformed amount on transaction checks without reading the transaction", async () => {
    let transactionCalls = 0;
    const tronClient = {
      ...createTronClient(),
      async getTransaction() {
        transactionCalls += 1;
        throw new Error("should not read malformed transaction check");
      }
    };
    const { bot, calls } = await createSmokeBot({ tronClient });

    await bot.handleUpdate(messageUpdate(`/check ${txHash} 1.1234567`, userId));

    expect(transactionCalls).toBe(0);
    expect(lastPlainText(calls)).toContain("Could not read the amount");
    expect(lastText(calls)).toContain("/check <TRON-address-or-tx-hash> 5000");
  });

  it("rejects extra tokens on transaction checks without reading the transaction", async () => {
    let transactionCalls = 0;
    const tronClient = {
      ...createTronClient(),
      async getTransaction() {
        transactionCalls += 1;
        throw new Error("should not read extra-token transaction check");
      }
    };
    const { bot, calls } = await createSmokeBot({ tronClient });

    await bot.handleUpdate(messageUpdate(`/check ${txHash} extra`, userId));

    expect(transactionCalls).toBe(0);
    expect(lastPlainText(calls)).toContain("Could not read the amount");
    expect(lastText(calls)).toContain("/check <TRON-address-or-tx-hash> 5000");
  });

  it("uses concise Russian copy for manual check errors and background status", async () => {
    const invalidAmountBot = await createSmokeBot({ defaultLocale: "ru" });
    await invalidAmountBot.bot.handleUpdate(messageUpdate(`/check ${walletAddress} 1.1234567`, userId));
    expect(lastPlainText(invalidAmountBot.calls)).toContain("Не распознал сумму");

    const pendingAddressBot = await createSmokeBot({
      defaultLocale: "ru",
      addressRiskSignals: async () => new Promise(() => undefined)
    });
    await pendingAddressBot.bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await pendingAddressBot.bot.handleUpdate(messageUpdate(walletAddress, userId));
    expect(messageCalls(pendingAddressBot.calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Проверка адреса запущена");

    const pendingTxBot = await createSmokeBot({
      defaultLocale: "ru",
      tronClient: {
        ...createTronClient(),
        async getTransaction() {
          return new Promise(() => undefined);
        }
      }
    });
    await pendingTxBot.bot.handleUpdate(callbackQueryUpdate("check:tx", userId));
    await pendingTxBot.bot.handleUpdate(messageUpdate(txHash, userId));
    expect(messageCalls(pendingTxBot.calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Проверка tx запущена");

    const failedBot = await createSmokeBot({
      defaultLocale: "ru",
      addressRiskSignals: async () => {
        throw new Error("provider unavailable");
      }
    });
    await failedBot.bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await failedBot.bot.handleUpdate(messageUpdate(walletAddress, userId));
    await waitForCondition(() =>
      messageCalls(failedBot.calls).some((call) => plainTelegramText(String(call.payload.text)).includes("Проверка не завершилась"))
    );
    expect(messageCalls(failedBot.calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Проверка не завершилась");
  });

  it("does not keep the main menu attached while a typed address check is running", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => new Promise(() => undefined)
    });

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));

    const startedMessage = messageCalls(calls).find((call) =>
      plainTelegramText(String(call.payload.text)).includes("Address check started")
    );
    expect(startedMessage).toBeTruthy();
    expect(startedMessage?.payload.reply_markup).toBeUndefined();
  });

  it("prints the runtime marker on address checks when configured", async () => {
    const { bot, calls } = await createSmokeBot({
      runtimeInstanceLabel: "Hermes test · codex/hermes-telegram-test-20260526 · 46fd9eb"
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(lastPlainText(calls)).toContain("Runtime: Hermes test · codex/hermes-telegram-test-20260526 · 46fd9eb");
  });

  it("does not queue deep forensic jobs for transaction checks", async () => {
    let deepQueueCalls = 0;
    const { bot } = await createSmokeBot({
      queueDeepForensicJob: async () => {
        deepQueueCalls += 1;
        throw new Error("should not queue deep tx checks");
      }
    });

    await bot.handleUpdate(messageUpdate(`/check ${txHash}`, userId));

    expect(deepQueueCalls).toBe(0);
  });

  it("reports deep forensic job status", async () => {
    const { bot, calls } = await createSmokeBot({
      getForensicCheckJob: async (id) => ({
        id,
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { transferEdges: 7 },
        resultJson: {},
        rawEvidenceIds: ["raw-1"],
        observationIds: ["obs-1"],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      })
    });

    await bot.handleUpdate(messageUpdate("/check_status deep-job-1", userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Deep forensic status");
    expect(text).toContain("Status: completed");
    expect(text).toContain(walletAddress);
  });

  it("returns where-is-money support details from check_status when persisted result exists", async () => {
    const whereReport = whereIsMoneyReportForTest({
      riskScore: 25,
      decisionReasons: ["Operational liquidity behavior is consistent with repeated legitimate counterparties."],
      coverage: {
        selectedInboundTxCount: 32,
        selectedInboundVolumeRaw: "840313000000",
        currentBalanceCoverageRatio: 0.9533,
        coverageRatio: 0.9533,
        maxDepth: 20,
        fetchedAddressCount: 19,
        partial: true,
        notes: []
      }
    });
    const { bot, calls } = await createSmokeBot({
      runtimeInstanceLabel: "worker-a",
      getForensicCheckJob: async (id) => whereIsMoneyJobForTest({
        id,
        resultJson: {
          subjectAddress: whereReport.subjectAddress,
          whereIsMoneyReport: whereReport
        }
      })
    });

    await bot.handleUpdate(messageUpdate("/check_status where-job-1", userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Where-is-money — support/debug");
    expect(text).toContain("Job: where-job-1");
    expect(text).toContain("Status: completed");
    expect(text).toContain(walletAddress);
    expect(text).toContain("Selected inbound transfers: 32");
    expect(text).toContain("Coverage: 95%");
    expect(text).toContain("Fetched addresses: 19");
    expect(text).toContain("Operational liquidity behavior");
    expect(text).toContain("Runtime: worker-a");
    expect(text).not.toContain("Deep forensic status");
  });

  it("falls back to generic status for malformed persisted where result", async () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const malformedReport: Record<string, unknown> = {
      ...whereReport,
      assessment: {
        ...whereReport.assessment,
        hardBadEvidence: []
      }
    };
    delete (malformedReport.assessment as Record<string, unknown>).reasons;
    const { bot, calls } = await createSmokeBot({
      getForensicCheckJob: async (id) => whereIsMoneyJobForTest({
        id,
        resultJson: {
          subjectAddress: whereReport.subjectAddress,
          whereIsMoneyReport: malformedReport
        }
      })
    });

    await expect(bot.handleUpdate(messageUpdate("/check_status where-job-malformed", userId))).resolves.toBeUndefined();

    const text = lastPlainText(calls);
    expect(text).toContain("Deep forensic status");
    expect(text).toContain("Job: where-job-malformed");
    expect(text).toContain("Status: completed");
    expect(text).not.toContain("support/debug");
    expect(text).not.toContain("Selected inbound transfers:");
  });

  it("shows incoming deposit forensic job status from contextual callback", async () => {
    const depositJobId = "42a0a912-dc6a-45b5-b281-a2f0c7ac034e";
    let resolvedJobId: string | null = null;
    const { bot, calls } = await createSmokeBot({
      getForensicCheckJob: async (id) => {
        resolvedJobId = id;
        return {
          id,
          kind: "incoming_deposit_check",
          subjectAddress: walletAddress,
          status: "completed",
          windowStart: new Date("2026-04-24T00:00:00.000Z"),
          windowEnd: new Date("2026-05-24T00:00:00.000Z"),
          priority: 130,
          chatId: "42",
          messageId: null,
          requestedBy: "42",
          progressJson: {},
          resultJson: {},
          rawEvidenceIds: ["raw-1"],
          observationIds: ["obs-1"],
          lastError: null,
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
          updatedAt: new Date("2026-05-24T00:00:00.000Z"),
          startedAt: new Date("2026-05-24T00:00:00.000Z"),
          completedAt: new Date("2026-05-24T00:01:00.000Z")
        };
      }
    });

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(callbackQueryUpdate(`check:deposit:${depositJobId}`, userId));
    await bot.handleUpdate(messageUpdate(secondWalletAddress, userId));

    expect(resolvedJobId).toBe(depositJobId);
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Deep forensic status");
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain(`Job: ${depositJobId}`);
    expect(lastPlainText(calls)).toContain("Monitoring: active");
  });

  it("formats where-is-money as the single final address score without technical sections", () => {
    const report = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      coverage: {
        selectedInboundTxCount: 32,
        currentBalanceRaw: "881418707767",
        requestedAmountRaw: null,
        targetAmountRaw: "881418707767",
        selectedAmountRaw: "840313000000",
        coverageRatio: 0.9533,
        selectedInboundVolumeRaw: "840313000000",
        currentBalanceCoverageRatio: 0.9533,
        provenanceScope: "current_balance",
        anchorTransfer: null,
        lowBalanceThresholdRaw: null,
        dataScopeNote: null,
        maxDepth: 20,
        fetchedAddressCount: 19,
        partial: true,
        notes: []
      },
      originPaths: [
        {
          balanceTransferTxHash: "tx-weak",
          rootSourceAddress: null,
          rootSourceType: "unknown",
          pathAddresses: [],
          txHashes: [],
          steps: [],
          amountPreservationRatio: 0,
          timeSpanMs: null,
          verdict: "REVIEW",
          stoppedReason: "weak_amount_or_time_continuity",
          riskScoreContribution: 30,
          reasons: []
        },
        {
          balanceTransferTxHash: "tx-missing",
          rootSourceAddress: null,
          rootSourceType: "unknown",
          pathAddresses: [],
          txHashes: [],
          steps: [],
          amountPreservationRatio: 0,
          timeSpanMs: null,
          verdict: "REVIEW",
          stoppedReason: "no_previous_transfer",
          riskScoreContribution: 35,
          reasons: []
        }
      ],
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: [],
        provenanceConfidence: 41,
        coverageCompleteness: 39,
        walletRole: "operational_liquidity_wallet",
        operationalLiquidityScore: 84
      }
    });

    const text = plainTelegramText(formatWhereIsMoneyReport(whereIsMoneyJobForTest(), report, "partial", { locale: "ru" }).text);

    expect(text).toContain("Проверка адреса — итог");
    expect(text).toContain("Итоговый риск");
    expect(text.match(/\d+\/100/g)).toEqual(["0/100"]);
    expect(text).toContain("Проверили 95% выбранной суммы");
    expect(text).toContain("32 входящих");
    expect(text).toContain("Что важно учесть");
    expect(text).not.toContain("Ограничения");
    expect(text).not.toContain("Технические детали");
    expect(text).not.toContain("Origin paths");
    expect(text).not.toContain("Sender interactions");
    expect(text).not.toContain("Previous fast risk");
    expect(text).not.toContain("Job:");
    expect(text).not.toContain("where-job-test");
  });

  it("formats final drain episode coverage with explicit scope", () => {
    const whereReport = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "100000000",
        currentBalanceCoverageRatio: 0,
        coverageRatio: 0.5,
        checkedScope: "drain_episode",
        anchorCoverageRatio: 0.5,
        episodeCoverageRatio: 0.2,
        drainEpisode: {
          anchorTxHash: "anchor-135k",
          startTimestamp: "2026-05-05T13:57:27.000Z",
          endTimestamp: "2026-05-05T15:00:30.000Z",
          episodeOutgoingRaw: "1000000000",
          episodeSelectedRaw: "200000000",
          episodeCoverageRatio: 0.2,
          outgoingTxHashes: ["out-1", "anchor-135k"],
          bridgeOutgoingRaw: "1000000000",
          bridgeOutgoingShare: 1
        },
        maxDepth: 7,
        fetchedAddressCount: 2,
        partial: true,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });

    expect(text).toContain("selected drain episode");
    expect(text).toContain("20%");
    expect(text).toContain("anchor coverage 50%");
    expect(text).not.toContain("Checked 50% of the target amount");
  });

  it("formats final recent-flow fallback coverage without target-amount wording", () => {
    const whereReport = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 0,
        selectedInboundVolumeRaw: "0",
        currentBalanceCoverageRatio: 0,
        coverageRatio: 0,
        checkedScope: "recent_flow",
        maxDepth: 7,
        fetchedAddressCount: 1,
        partial: true,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });

    expect(text).toContain("recent-flow");
    expect(text).not.toContain("target amount");
  });

  it("renders matrix REVIEW as a user REVIEW without matrix/debug copy", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      decisionReasons: ["Clean CEX origin is not fully proven; wallet looks like an operational/liquidity wallet and no hard bad evidence was found."],
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: true,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({
        level: "MEDIUM",
        score: 55,
        taintScore: 0,
        launderingPatternScore: 55,
        dominantRiskType: "laundering_pattern",
        reasons: [
          {
            code: "forensic_address_behavior",
            message: "Address shows high-volume transit-like behavior.",
            scoreImpact: 55
          }
        ]
      }),
      deepReport: deepReportForTest({
        boundaryExposureProfiles: [boundaryExposureProfile()]
      }),
      locale: "ru"
    });

    expect(text).toContain("Решение: не принимать автоматически.");
    expect(text).not.toContain("Решение: REVIEW");
    expect(text).toContain("Что делать");
    expect(text).toContain("Почему");
    expect(text).toContain("Что важно учесть");
    expect(text).toContain("Нужна ручная проверка");
    expect(text).toContain("Чистый CEX-источник не доказан полностью.");
    expect(text).toContain("Цепочка дошла до биржи или сервиса");
    expect(text).toContain("Проверили 100% выбранной суммы");
    expect(text).not.toContain("ACCEPTABLE — Сильных риск-сигналов не найдено");
    expect(text).not.toContain("Scoring Signal Matrix");
    expect(text).not.toContain("behavior_only_prior");
    expect(text).not.toContain("Weighted layer score");
    expect(text).not.toContain("Dampener");
    expect(text).not.toContain("production_full");
    expect(text).not.toContain("Beta/internal");
  });

  it("formats a compact Russian final report with HTX/Huobi source-policy risk", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      proofLevel: "exchange_policy_decline",
      riskScore: 55,
      decisionReasons: ["Material HTX/Huobi selected-amount source exposure was found."],
      sourceBundleExposure: {
        scope: "where_requested_amount",
        targetAmountRaw: "1000000000",
        coveredAmountRaw: "1000000000",
        coverageRatio: 1,
        htxHuobiShare: 0.7,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0,
        dominantSource: "htx_huobi",
        evidenceTxHashes: ["htx-source-tx"],
        reasons: [],
        warnings: [],
        budget: {
          maxDepth: 7,
          fetchedAddressCount: 3,
          maxAddressFetches: 12,
          liveTransferReadCount: 3,
          skippedAddressCount: 0,
          exhausted: false,
          exhaustedPhase: null
        },
        unresolvedBoundary: null
      },
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: false,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 55 }),
        sourcePolicyEvidence: [
          {
            kind: "htx_huobi",
            aggregateShare: 0.7,
            effectiveShare: 0.7,
            pathCount: 1,
            score: 55,
            riskBand: "MEDIUM",
            proofLevel: "exchange_policy_decline",
            canBeDampened: true,
            reasons: ["Material HTX/Huobi selected-amount source exposure was found."],
            warnings: [],
            evidenceIds: ["htx-source-tx"]
          }
        ],
        reasons: ["Material HTX/Huobi selected-amount source exposure was found."]
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport: deepReportForTest({
        boundaryExposureProfiles: [boundaryExposureProfile()]
      }),
      locale: "ru"
    });

    expect(text).toContain("Проверка адреса — итог");
    expect(text).toContain("Решение: не принимать автоматически.");
    expect(text).toContain("Риск:");
    expect(text).toContain("В выбранной сумме найден источник HTX/Huobi: 70%.");
    expect(text).toContain("Цепочка дошла до биржи или сервиса.");
    expect(text).toContain("Точных признаков кражи, drainer-цепочки или USDT blacklist не найдено.");
    expect(text).toContain("Запросить подтверждение происхождения средств.");
    expect(text).not.toContain("matrix");
    expect(text).not.toContain("Matrix");
    expect(text).not.toContain("Weighted layer score");
    expect(text).not.toContain("Dampener");
    expect(text).not.toContain("Beta/internal");
    expect(text).not.toContain("source-policy threshold");
  });

  it("formats a compact Russian final report with exact approval-drain", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 95,
      decisionReasons: ["Exact approval-drain provenance reaches checked wallet via 0 hop(s)."],
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 95,
            evidenceIds: ["tx-transferfrom-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      },
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: walletAddress,
          subjectAddress: walletAddress,
          hopDepth: 0,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain"],
          pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
          score: 95,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ],
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "309000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 2,
        partial: false,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport: deepReportForTest({
        approvalDrainProvenanceProfiles: whereReport.approvalDrainProvenanceProfiles
      }),
      locale: "ru"
    });

    expect(text).toContain("Найдена точная drainer-цепочка: approve USDT -> transferFrom -> проверяемый адрес получил средства.");
    expect(text).toContain("Не принимать депозит автоматически.");
    expect((text.match(/Найдена точная drainer-цепочка/g) ?? []).length).toBe(1);
    expect(text).not.toContain("Exact approval-drain provenance reaches checked wallet");
    expect(text).not.toContain("Scoring Signal Matrix");
  });

  it("formats a detailed Russian report grouped by modes", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      proofLevel: "exchange_policy_decline",
      riskScore: 55,
      decisionReasons: ["Material HTX/Huobi selected-amount source exposure was found."],
      sourceBundleExposure: {
        scope: "where_requested_amount",
        targetAmountRaw: "1000000000",
        coveredAmountRaw: "1000000000",
        coverageRatio: 1,
        htxHuobiShare: 0.7,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0,
        dominantSource: "htx_huobi",
        evidenceTxHashes: ["htx-source-tx"],
        reasons: [],
        warnings: [],
        budget: {
          maxDepth: 7,
          fetchedAddressCount: 3,
          maxAddressFetches: 12,
          liveTransferReadCount: 3,
          skippedAddressCount: 0,
          exhausted: false,
          exhaustedPhase: null
        },
        unresolvedBoundary: null
      },
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: false,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 55 }),
        sourcePolicyEvidence: [
          {
            kind: "htx_huobi",
            aggregateShare: 0.7,
            effectiveShare: 0.7,
            pathCount: 1,
            score: 55,
            riskBand: "MEDIUM",
            proofLevel: "exchange_policy_decline",
            canBeDampened: true,
            reasons: ["Material HTX/Huobi selected-amount source exposure was found."],
            warnings: [],
            evidenceIds: ["htx-source-tx"]
          }
        ],
        reasons: ["Material HTX/Huobi selected-amount source exposure was found."]
      }
    });

    const text = formatUnifiedAddressDetailedReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest(),
      deepReport: deepReportForTest({
        boundaryExposureProfiles: [boundaryExposureProfile()]
      }),
      locale: "ru"
    });

    expect(text).toContain("Расширенный отчёт по адресу");
    expect(text).toContain("Итог: не принимать автоматически.");
    expect(text).toContain("Короткий вывод");
    expect(text).toContain("FastCheck");
    expect(text).toContain("Where Is Money");
    expect(text).toContain("DeepCheck");
    expect(text).toContain("Что это может быть");
    expect(text).toContain("Ограничения");
    expect(text).toContain("Рекомендация");
    expect(text).toContain("70% выбранной суммы связано с HTX/Huobi.");
    expect(text).toContain("Exact approval-drain не найден.");
    expect(text).toContain("USDT blacklist не найден.");
    expect(text).not.toContain("matrix");
    expect(text).not.toContain("Matrix");
    expect(text).not.toContain("Weighted layer score");
    expect(text).not.toContain("Dampener");
    expect(text).not.toContain("Beta/internal");
    expect(text).not.toContain("source-policy threshold");
  });

  it("keeps high FastCheck score-only behavior as context, not hard evidence", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 10,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 10 }),
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        reasons: [
          {
            code: "forensic_address_behavior",
            message: "Address shows high-volume transit-like behavior.",
            scoreImpact: 90
          }
        ]
      }),
      locale: "ru"
    });

    expect(text).toContain("Быстрая проверка нашла поведенческий риск. Это контекст, не точное доказательство происхождения средств.");
    expect(text).toContain("Точных признаков кражи, drainer-цепочки или USDT blacklist не найдено.");
    expect(text).not.toContain("Hard evidence");
    expect(text).not.toContain("Жёсткое доказательство");
  });

  it("attributes DeepCheck-only exact approval-drain evidence to the DeepCheck detailed section", () => {
    const deepApprovalProfile = {
      victimAddress: "TVictim111111111111111111111111111111",
      approvalTxHash: "tx-approval-root-cause",
      drainTxHash: "tx-transferfrom-drain",
      spenderAddress: "TSpender11111111111111111111111111111",
      firstReceiverAddress: walletAddress,
      subjectAddress: walletAddress,
      hopDepth: 0 as const,
      amountRaw: "309000000000",
      amountPreservationRatio: 0.991,
      approvalAt: "2026-05-20T09:50:00.000Z",
      drainAt: "2026-05-20T10:00:00.000Z",
      pathTxHashes: ["tx-transferfrom-drain"],
      pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
      score: 95,
      evidenceStrength: "exact_approval_and_transfer_from" as const,
      subjectTokenState: null,
      victimTokenState: null,
      features: []
    };
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 10,
      approvalDrainProvenanceProfiles: [],
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 10 }),
        hardBadEvidence: []
      },
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "100000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: false,
        notes: []
      }
    });

    const text = formatUnifiedAddressDetailedReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport: deepReportForTest({
        approvalDrainProvenanceProfiles: [deepApprovalProfile]
      }),
      locale: "ru"
    });
    const whereSection = plainSectionText(text, "Where Is Money");
    const deepSection = plainSectionText(text, "DeepCheck");

    expect(deepSection).toContain("Найдена точная drainer-цепочка");
    expect(whereSection).not.toContain("Найдена точная drainer-цепочка");
    expect((text.match(/Найдена точная drainer-цепочка/g) ?? []).length).toBe(1);
  });

  it("shows unified incomplete coverage in detailed mode even when Where coverage is complete", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 10,
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "100000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: false,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 10 }),
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressDetailedReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "ru"
    });
    const whereSection = plainSectionText(text, "Where Is Money");

    expect(whereSection).toContain("Проверка относится к выбранной сумме и доступным данным, а не ко всей истории адреса.");
  });

  it("formats a Russian no-final-decision report", () => {
    const whereReport = scoreInvalidWhereReportForTest();

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "ru"
    });

    expect(text).toContain("Проверка адреса — без итогового решения");
    expect(text).toContain("Итоговый риск не опубликован: не хватает данных по происхождению средств.");
    expect(text).toContain("Что делать");
    expect(text).toContain("Дождаться индексации или перезапустить проверку.");
    expect(text).not.toContain("Blocked reason");
    expect(text).not.toContain("Technical status");
  });

  it("formats Russian selected-anchor coverage without English copy", () => {
    const whereReport = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        checkedScope: "selected_anchor",
        maxDepth: 7,
        fetchedAddressCount: 2,
        partial: false,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "ru"
    });

    expect(text).toContain("Проверили 100% выбранного recent-flow anchor");
    expect(text).not.toContain("Checked 100%");
  });

  it("deduplicates exact approval-drain evidence in Russian final reports", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 95,
      decisionReasons: ["Exact approval-drain provenance reaches checked wallet via 0 hop(s)."],
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 95,
            evidenceIds: ["tx-transferfrom-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      },
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: walletAddress,
          subjectAddress: walletAddress,
          hopDepth: 0,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain"],
          pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
          score: 95,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ],
      coverage: {
        selectedInboundTxCount: 5,
        selectedInboundVolumeRaw: "24213000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 8,
        partial: true,
        notes: ["provider coverage partial"]
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 95,
        taintScore: 95,
        launderingPatternScore: 0,
        dominantRiskType: "taint",
        reasons: [
          {
            code: "internal_label_approval_drain_proximity",
            message: "Derived high-risk marker: exact upstream approval-drain provenance linked to this address.",
            scoreImpact: 95
          }
        ]
      }),
      deepReport: deepReportForTest({
        approvalDrainProvenanceProfiles: whereReport.approvalDrainProvenanceProfiles
      }),
      locale: "ru"
    });

    expect(text).toContain("Решение: не принимать автоматически.");
    expect(text).not.toContain("Решение: DECLINE");
    expect(text).toContain("Не принимать автоматически.");
    expect(text).toContain("Найдена точная approval-drain цепочка");
    expect(text).toContain("Ранее система уже сохраняла этот адрес как связанный с exact approval-drain.");
    expect(text).toContain("Проверили 100% выбранной суммы");
    expect(text).toContain("это не означает полную историю адреса");
    expect((text.match(/Найдена точная approval-drain цепочка/g) ?? []).length).toBe(1);
    expect(text).not.toContain("Exact approval-drain provenance reaches checked wallet");
    expect(text).not.toContain("Derived high-risk marker");
    expect(text).not.toContain("Scoring Signal Matrix");
    expect(text).not.toContain("matrix:hard_proof");
    expect(text).not.toContain("Beta/internal");
  });

  it("keeps final diagnostics only when beta diagnostics are requested", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 95,
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 95,
            evidenceIds: ["tx-transferfrom-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      }
    });

    const normalText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });
    const debugText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en",
      showBetaDiagnostics: true
    });

    expect(normalText).not.toContain("Beta/internal");
    expect(normalText).not.toContain("Weighted layer score");
    expect(debugText).toContain("Beta/internal");
    expect(debugText).toContain("Weighted layer score");
  });

  it("formats the Russian unified final report as a user-first summary", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 95,
      decisionReasons: ["Exact approval-drain provenance reaches checked wallet via 0 hop(s)."],
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 95,
            evidenceIds: ["tx-final-approval-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      },
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: walletAddress,
          subjectAddress: walletAddress,
          hopDepth: 0,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain"],
          pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
          score: 95,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ]
    });
    const deepReport = deepReportForTest({
      boundaryExposureProfiles: [boundaryExposureProfile()]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "ru"
    });

    expect(text).toContain("Проверка адреса — итог");
    expect(text).toContain("Решение: не принимать автоматически.");
    expect(text).not.toContain("Решение: DECLINE");
    expect(text).toContain("Итоговый риск");
    expect(text).toContain("95/100");
    expect(text).toContain("Что делать");
    expect(text).toContain("Почему");
    expect(text).toContain("Что важно учесть");
    expect(text).toContain("Найдена точная approval-drain цепочка");
    expect(text).toContain("Цепочка дошла до биржи или сервиса");
    expect(text).not.toContain("Beta/internal");
    expect(text).not.toContain("Разбор оценки");
    expect(text).not.toContain("Порог политики: 0");
    expect(text).not.toContain("Снижение: 0");
  });

  it("formats the Russian unified final ACCEPTABLE report as a user-first summary", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 10,
      coverage: {
        selectedInboundTxCount: 2,
        selectedInboundVolumeRaw: "100000000",
        currentBalanceCoverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: false,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 10 }),
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({ score: 0 }),
      deepReport: deepReportForTest({
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 2,
          transferEdges: 10
        }
      }),
      locale: "ru"
    });

    expect(text).toContain("Проверка адреса — итог");
    expect(text).toContain("Решение: можно принять автоматически.");
    expect(text).not.toContain("Решение: ACCEPTABLE");
    expect(text).toContain("Сильных риск-сигналов не найдено.");
    expect(text).toContain("Итоговый риск");
    expect(text).toContain("Что делать");
    expect(text).toContain("Почему");
    expect(text).toContain("Жёстких плохих доказательств не найдено.");
    expect(text).not.toContain("Доверие к данным");
  });

  it("keeps Russian beta/internal diagnostics compact for low acceptable unified reports", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 10,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 10 }),
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({ score: 0 }),
      deepReport: deepReportForTest(),
      locale: "ru",
      showBetaDiagnostics: true
    });

    expect(text).toContain("Beta/internal");
    expect(text).toContain("FastCheck");
    expect(text).toContain("DeepCheck");
    expect(text).toContain("Where Is Money");
    expect(text).toContain("Final risk diagnostic:");
    expect(text).toContain("Matrix row:");
    expect(text).not.toContain("Порог политики: 0");
    expect(text).not.toContain("Снижение: 0");
    expect(text).not.toContain("Policy floor: 0");
    expect(text).not.toContain("Hard evidence floor: 0");
    expect(text).not.toContain("Dampener: 0");
    expect(text).not.toContain("Threshold: 0");
    expect(text).not.toContain("Reduction: 0");
  });

  it("adds limited data-confidence notes without promising clean history", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 0,
      coverage: {
        selectedInboundTxCount: 0,
        selectedInboundVolumeRaw: "0",
        currentBalanceCoverageRatio: 0,
        coverageRatio: 0,
        maxDepth: 7,
        fetchedAddressCount: 1,
        partial: true,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });

    expect(text).toContain("Important context");
    expect(text).toContain("this does not mean the full address history is complete");
    expect(text).not.toContain("Coverage is limited; review the evidence before treating this result as final.");
    expect(text).not.toContain("guaranteed clean");
  });

  it("shows insufficient matrix evidence instead of high contextual risk when hard evidence is absent", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 70,
      decisionReasons: ["Service-boundary context raised risk."],
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 70 }),
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en",
      showBetaDiagnostics: true
    });

    expect(text).toContain("Matrix row: coverage_uncertainty; matrix decision: INSUFFICIENT_EVIDENCE.");
    expect(text).not.toContain("High contextual risk; no hard evidence observed.");
  });

  it("localizes insufficient matrix evidence in Russian final reports", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 70,
      decisionReasons: ["Service-boundary context raised risk."],
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 70 }),
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "ru",
      showBetaDiagnostics: true
    });

    expect(text).toContain("Matrix row: coverage_uncertainty; matrix decision: INSUFFICIENT_EVIDENCE.");
    expect(text).not.toContain("Высокий контекстный риск; жестких доказательств не найдено.");
    expect(text).not.toContain("High contextual risk; no hard evidence observed.");
  });

  it("shows beta diagnostics only when requested", () => {
    const whereReport = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 0,
        selectedInboundVolumeRaw: "0",
        currentBalanceCoverageRatio: 0,
        coverageRatio: 0,
        maxDepth: 7,
        fetchedAddressCount: 1,
        partial: true,
        notes: []
      }
    });

    const baseInput = {
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en" as const
    };
    const defaultText = formatUnifiedAddressFinalReportForTest(baseInput);
    const diagnosticText = formatUnifiedAddressFinalReportForTest({
      ...baseInput,
      showBetaDiagnostics: true
    });

    expect(defaultText).not.toContain("Beta/internal diagnostics");
    expect(diagnosticText).toContain("Beta/internal diagnostics");
    expect(diagnosticText).toContain("coverage");
    expect(diagnosticText).toContain("confidence");
    expect(diagnosticText).toContain("evidence");
    expect(diagnosticText).toContain("policy wallet-risk-v1");
  });

  it("separates fresh source proof from historical exposure context in the where final report", () => {
    const whereReport = whereIsMoneyReportForTest({
      sourceBundleExposure: {
        scope: "where_requested_amount",
        targetAmountRaw: "1000000000",
        coveredAmountRaw: "700000000",
        coverageRatio: 0.7,
        htxHuobiShare: 0.7,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.3,
        dominantSource: "htx_huobi",
        evidenceTxHashes: ["fresh-source-proof-tx"],
        reasons: [],
        warnings: [],
        budget: {
          maxDepth: 7,
          fetchedAddressCount: 12,
          maxAddressFetches: 12,
          liveTransferReadCount: 20,
          skippedAddressCount: 1,
          exhausted: true,
          exhaustedPhase: "trace"
        },
        unresolvedBoundary: {
          kind: "bridge_router_dex",
          affectedShare: 0.3,
          scoreFloor: 55,
          reason: "Source bundle coverage-limited: unresolved bridge/router/DEX boundary remains after the graph budget stopped.",
          evidenceTxHashes: ["boundary-proof-tx"]
        }
      },
      subjectExposureProfile: {
        subjectAddress: walletAddress,
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-04T00:00:00.000Z",
        transferEventsScanned: 40,
        incomingVolumeRaw: "2000000000",
        outgoingVolumeRaw: "1800000000",
        htxHuobiIncomingShare: 0.4,
        cleanCexIncomingShare: 0,
        bridgeRouterDexVolumeShare: 0.2,
        unknownContractVolumeShare: 0,
        unknownSourceShare: 0.4,
        inOutVelocityScore: 5,
        scoreContribution: 12,
        reasons: [],
        warnings: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });

    expect(text).toContain("HTX/Huobi funds 70% of the selected amount.");
    expect(text).toContain("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
    expect(text).toContain("The graph stopped before resolving a material bridge/router/DEX boundary.");
    expect(text).not.toContain("Historical HTX/Huobi funds 70% of the selected amount");
  });

  it("labels non-bridge unresolved source boundaries in the where final report", () => {
    const whereReport = whereIsMoneyReportForTest({
      sourceBundleExposure: {
        scope: "where_requested_amount",
        targetAmountRaw: "1000000000",
        coveredAmountRaw: "300000000",
        coverageRatio: 0.3,
        htxHuobiShare: 0,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.7,
        dominantSource: null,
        evidenceTxHashes: [],
        reasons: [],
        warnings: [],
        budget: {
          maxDepth: 7,
          fetchedAddressCount: 12,
          maxAddressFetches: 12,
          liveTransferReadCount: 20,
          skippedAddressCount: 1,
          exhausted: true,
          exhaustedPhase: "trace"
        },
        unresolvedBoundary: {
          kind: "htx_huobi",
          affectedShare: 0.7,
          scoreFloor: 60,
          reason: "Source bundle coverage-limited: unresolved HTX/Huobi boundary remains after the graph budget stopped.",
          evidenceTxHashes: ["htx-boundary-tx"]
        }
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });

    expect(text).toContain("The graph stopped before resolving a material HTX/Huobi source boundary.");
    expect(text).not.toContain("bridge/router/DEX boundary");
  });

  it("keeps shared source exposure lines visible after hard and context reasons", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 90,
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 90 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 90,
            message: "Balance-forming path contains exact approval-drain transferFrom evidence.",
            evidenceIds: ["approval-drain-tx"]
          },
          {
            kind: "sanctioned_service",
            score: 85,
            message: "Balance-forming path reaches a sanctioned service.",
            evidenceIds: ["sanctioned-service-tx"]
          },
          {
            kind: "htx_huobi_source",
            score: 45,
            message: "Historical service-boundary exposure exists but is contextual.",
            evidenceIds: ["context-tx"]
          }
        ]
      },
      sourceBundleExposure: {
        scope: "where_requested_amount",
        targetAmountRaw: "1000000000",
        coveredAmountRaw: "700000000",
        coverageRatio: 0.7,
        htxHuobiShare: 0.7,
        cleanCexShare: 0,
        bridgeRouterDexShare: 0,
        unknownContractShare: 0,
        riskyLabelShare: 0,
        unknownShare: 0.3,
        dominantSource: "htx_huobi",
        evidenceTxHashes: ["fresh-source-proof-tx"],
        reasons: [],
        warnings: [],
        budget: {
          maxDepth: 7,
          fetchedAddressCount: 12,
          maxAddressFetches: 12,
          liveTransferReadCount: 20,
          skippedAddressCount: 1,
          exhausted: true,
          exhaustedPhase: "trace"
        },
        unresolvedBoundary: {
          kind: "bridge_router_dex",
          affectedShare: 0.3,
          scoreFloor: 55,
          reason: "Source bundle coverage-limited: unresolved bridge/router/DEX boundary remains after the graph budget stopped.",
          evidenceTxHashes: ["boundary-proof-tx"]
        }
      },
      subjectExposureProfile: {
        subjectAddress: walletAddress,
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-04T00:00:00.000Z",
        transferEventsScanned: 40,
        incomingVolumeRaw: "2000000000",
        outgoingVolumeRaw: "1800000000",
        htxHuobiIncomingShare: 0.4,
        cleanCexIncomingShare: 0,
        bridgeRouterDexVolumeShare: 0.2,
        unknownContractVolumeShare: 0,
        unknownSourceShare: 0.4,
        inOutVelocityScore: 5,
        scoreContribution: 12,
        reasons: [],
        warnings: []
      },
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000000",
        currentBalanceCoverageRatio: 0.7,
        coverageRatio: 0.7,
        maxDepth: 7,
        fetchedAddressCount: 12,
        partial: true,
        notes: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      fastReport: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        taintScore: 90,
        launderingPatternScore: 0,
        dominantRiskType: "taint",
        reasons: [
          {
            code: "internal_label_scam",
            message: "Internal label: scam",
            scoreImpact: 90
          }
        ]
      }),
      locale: "en"
    });

    expect(text).toContain("Exact approval-drain evidence was found");
    expect(text).toContain("Historical service-boundary exposure exists but is contextual.");
    expect(text).toContain("Hard evidence: Internal label: scam");
    expect(text).toContain("HTX/Huobi funds 70% of the selected amount.");
    expect(text).toContain("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
    expect(text).toContain("The graph stopped before resolving a material bridge/router/DEX boundary.");
    expect(text).not.toContain("Historical HTX/Huobi funds 70% of the selected amount");
  });

  it("adds deep behavior through unified scoring in the Russian final report", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      directCounterpartyInteractionProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "outbound",
          counterpartyAddress: "TV7PLwexampleXSUT",
          volumeRaw: "500000000000",
          volumeRatio: 0.496,
          txCount: 8,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          scoreContribution: 45,
          snapshot: {
            address: "TV7PLwexampleXSUT",
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 0.56,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "ru"
    });

    expect(text).toContain("Итоговый риск");
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).toContain("поведенческий риск");
    expect(text).toContain("не доказательство");
    expect(text).not.toContain("Риск поведения");
    expect(text).not.toContain("80/100");
  });

  it("uses unified scoring so deep behavior contributes to final risk", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      directCounterpartyInteractionProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "outbound",
          counterpartyAddress: "TV7PLwexampleXSUT",
          volumeRaw: "500000000000",
          volumeRatio: 0.496,
          txCount: 8,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          scoreContribution: 45,
          snapshot: {
            address: "TV7PLwexampleXSUT",
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 0.56,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });

    expect(text).toContain("Risk:");
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).toContain("Behavior warning");
    expect(text).not.toContain("Behavior risk");
    expect(text).not.toContain("Job:");
    expect(text).not.toContain("where-job-test");
  });

  it("labels limited-coverage context adjustment separately from the weighted score", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 0,
      coverage: {
        selectedInboundTxCount: 0,
        selectedInboundVolumeRaw: "0",
        currentBalanceCoverageRatio: 0,
        maxDepth: 7,
        fetchedAddressCount: 1,
        partial: true,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 0 }),
        coverageCompleteness: 50,
        hardBadEvidence: []
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      locale: "en",
      fastReport: riskReportForTest({ score: 0 }),
      deepReport: deepReportForTest(),
      whereReport,
      showBetaDiagnostics: true
    });

    expect(text).toContain("Decision: ACCEPTABLE");
    expect(text).toContain("Matrix row: coverage_uncertainty; matrix decision: INSUFFICIENT_EVIDENCE.");
    expect(text).toContain("Weighted layer score: 0.");
    expect(text).toContain("Coverage-adjusted context score: 30.");
    expect(text).not.toContain("weighted context: 30");
    expect(text).not.toContain("Context score after dampener: 30");
  });

  it("labels dampener-only context changes separately from coverage adjustment", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 80,
      coverage: {
        selectedInboundTxCount: 2,
        selectedInboundVolumeRaw: "100000000000",
        currentBalanceCoverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 2,
        partial: false,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 80 }),
        walletRole: "operational_liquidity_wallet"
      }
    });
    const deepReport = deepReportForTest({
      serviceExposureProfiles: [{
        subjectAddress: walletAddress,
        exposureScore: 80,
        totalOutgoingRaw: "100000000000",
        totalOutgoingCount: 10,
        directServiceVolumeRatio: 0,
        directServiceTxRatio: 0,
        indirectServiceVolumeRatio: 0,
        indirectServiceTxRatio: 0,
        mergedServiceVolumeRatio: 0,
        mergedServiceGroupCount: 0,
        combinedServiceVolumeRatio: 0,
        combinedServiceTxRatio: 0,
        dominantCategory: null,
        categoryBreakdown: [],
        topServiceCounterparties: [],
        topMergedServiceFlows: [],
        fastestServiceExitMs: null,
        bestAmountPreservationRatio: null,
        features: []
      }],
      coverage: {
        sourceTransferPages: 1,
        inboundSendersExpanded: 1,
        transferEdges: 10
      }
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      locale: "en",
      fastReport: riskReportForTest({ score: 80 }),
      deepReport,
      whereReport,
      showBetaDiagnostics: true
    });

    expect(text).toContain("Matrix row: counterparty_context; matrix decision: REVIEW.");
    expect(text).toContain("Weighted layer score: 80.");
    expect(text).toContain("Dampener: 10.");
    expect(text).toContain("Context score after dampener: 70.");
    expect(text).not.toContain("Coverage-adjusted context used for the final score is 70.");
    expect(text).not.toContain("Coverage-adjusted context score: 70.");
  });

  it("shows the score anchor in the English unified final report", () => {
    const whereReport = whereIsMoneyReportForTest({
      riskScore: 25,
      userDecision: "DECLINE"
    });
    const deepReport = deepReportForTest({
      runProfile: "bounded_rerun",
      providerBudget: {
        providerCallBudget: 20,
        transferCallBudget: 10,
        contractCallBudget: 0,
        approvalCallBudget: 0,
        elapsedTimeBudgetMs: 30000,
        exhausted: false
      },
      operationalFlowProfiles: [{
        subjectAddress: walletAddress,
        windowStart: "2026-04-24T00:00:00.000Z",
        windowEnd: "2026-05-24T00:00:00.000Z",
        incomingVolumeRaw: "7541408440000",
        outgoingVolumeRaw: "7541406950000",
        incomingTxCount: 12,
        outgoingTxCount: 27,
        inflowToOutflowRatio: 0.999,
        topIncomingCounterparties: [],
        topOutgoingCounterparties: [],
        categoryBreakdown: [],
        terminalLiquidityIncomingRatio: 0,
        terminalLiquidityOutgoingRatio: 0,
        htxHuobiIncomingRatio: 0,
        htxHuobiOutgoingRatio: 0,
        bridgeDexRouterOutgoingRatio: 0.25,
        unknownContractOutgoingRatio: 0,
        historicalTransitScore: 81,
        historicalTransitBreakdown: {
          eligible: true,
          flowUsdt: 7541408,
          volumeScore: 20,
          passThrough: 0.999,
          passThroughScore: 20,
          serviceShare: 0.25,
          serviceShareScore: 6,
          score: 81
        },
        operationalScore: 58,
        features: []
      }]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      locale: "en",
      fastReport: riskReportForTest({ score: 0 }),
      deepReport,
      whereReport,
      showBetaDiagnostics: true
    });

    expect(text).toContain("Anchored by: historical_transit_pattern 81.");
    expect(text).toContain("Matrix row: service_linked_pattern; matrix decision: DECLINE.");
    expect(text).toContain("Run profile: bounded_rerun.");
    expect(text).toContain("Provider budget: calls 20, transfers 10, contracts 0, approvals 0, elapsed 30000 ms, exhausted no.");
    expect(text).toContain("Weighted layer score:");
    expect(text).toContain("Decision: DECLINE");
  });

  it("shows policy and asset continuation floors in the unified final report", () => {
    const whereReport = stage2WhereReportForTest("no_name_token_liquidity");
    const deepReport = deepReportForTest({
      assetContinuationProfiles: [
        assetContinuationProfileForTest()
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en",
      showBetaDiagnostics: true
    });

    expect(text).toContain("Policy floor: 70");
    expect(text).toContain("Asset continuation floor: 82");
    expect(text).toContain("Context score: 78.");
    expect(text).toContain("Risk:");
    expect(text).toContain("82");
  });

  it("extracts persisted where-is-money wrapper only when the report shape and subject match", () => {
    const whereReport = whereIsMoneyReportForTest({ riskScore: 25 });
    const matchingJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });
    const wrongSubjectJob = whereIsMoneyJobForTest({
      subjectAddress: walletAddress,
      resultJson: {
        subjectAddress: walletAddress,
        whereIsMoneyReport: {
          ...whereReport,
          subjectAddress: secondWalletAddress
        }
      }
    });
    const invalidShapeJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: {
          subjectAddress: whereReport.subjectAddress,
          riskScore: 25,
          coverage: {}
        }
      }
    });
    const missingAssessmentReasonsReport: Record<string, unknown> = {
      ...whereReport,
      assessment: {
        ...whereReport.assessment,
        hardBadEvidence: []
      }
    };
    delete (missingAssessmentReasonsReport.assessment as Record<string, unknown>).reasons;
    const missingAssessmentReasonsJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: missingAssessmentReasonsReport
      }
    });
    const malformedCoverageRatioReport = {
      ...whereReport,
      coverage: {
        ...whereReport.coverage,
        coverageRatio: "bad",
        currentBalanceCoverageRatio: 1
      }
    };
    const malformedCoverageRatioJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: malformedCoverageRatioReport
      }
    });

    expect(extractWhereIsMoneyReportFromJob(matchingJob, walletAddress)).toBe(whereReport);
    expect(extractWhereIsMoneyReportFromJob(wrongSubjectJob, walletAddress)).toBeNull();
    expect(extractWhereIsMoneyReportFromJob(invalidShapeJob, walletAddress)).toBeNull();
    expect(extractWhereIsMoneyReportFromJob(missingAssessmentReasonsJob, walletAddress)).toBeNull();
    expect(extractWhereIsMoneyReportFromJob(malformedCoverageRatioJob, walletAddress)).toBeNull();

    const fallbackMessage = formatDeepForensicUserDeliveryReport(
      whereIsMoneyJobForTest({
        id: "deep-job-invalid-where-wrapper",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        progressJson: { locale: "en" }
      }),
      deepReportForTest(),
      "completed",
      invalidShapeJob,
      { locale: "en", showBetaDiagnostics: true }
    );
    const fallbackText = plainTelegramText(fallbackMessage.text);

    expect(fallbackText).toContain("Address behavior — context ready");
    expect(fallbackText).toContain("Final risk will be shown after provenance analysis.");
    expect(fallbackText).not.toContain("Address check — final");
    expect(fallbackText).not.toContain("Behavior risk");
  });

  it("formats normal deep delivery as unified final when a matching persisted where report exists", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job",
      kind: "address_deep_check",
      subjectAddress: whereReport.subjectAddress,
      progressJson: { locale: "en" }
    });
    const whereJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });

    const message = formatDeepForensicUserDeliveryReport(
      deepJob,
      deepReportForTest({
        subjectAddress: whereReport.subjectAddress,
        directCounterpartyInteractionProfiles: [
          {
            subjectAddress: walletAddress,
            direction: "outbound",
            counterpartyAddress: "TV7PLwexampleXSUT",
            volumeRaw: "500000000000",
            volumeRatio: 0.496,
            txCount: 8,
            firstSeen: "2026-06-01T10:00:00.000Z",
            lastSeen: "2026-06-01T11:00:00.000Z",
            txHashes: ["tx-counterparty"],
            serviceCategory: null,
            identity: null,
            scoreContribution: 45,
            snapshot: {
              address: "TV7PLwexampleXSUT",
              riskScore: 80,
              riskLevel: "HIGH",
              source: "fast_address_check",
              evidenceClass: "counterparty_behavior_context",
              reasons: ["counterparty fast check found behavior context"],
              partialNotes: []
            },
            interactionWeight: 0.56,
            evidenceClass: "counterparty_behavior_context",
            skippedReason: null
          }
        ]
      }),
      "completed",
      whereJob,
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Risk:");
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).toContain("Behavior warning");
    expect(text).not.toContain("Behavior risk");
    expect(text).not.toContain("80/100");
  });

  it("keeps DeepCheck delivery final when a matching where-is-money result exists", () => {
    const whereReport = whereIsMoneyReportForTest();
    const whereJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });

    const message = formatDeepForensicUserDeliveryReport(
      whereIsMoneyJobForTest({
        id: "deep-job-with-where-result",
        kind: "address_deep_check",
        subjectAddress: whereReport.subjectAddress,
        progressJson: { locale: "ru" }
      }),
      deepReportForTest({ subjectAddress: whereReport.subjectAddress }),
      "completed",
      whereJob,
      { locale: "ru" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Проверка адреса — итог");
    expect(text).not.toContain("предварительный результат");
  });

  it("formats failed DeepCheck delivery as final where-only report when a matching where result exists", () => {
    const whereReport = whereIsMoneyReportForTest();
    const whereJob = whereIsMoneyJobForTest({
      resultJson: {
        subjectAddress: whereReport.subjectAddress,
        whereIsMoneyReport: whereReport
      }
    });
    const failedDeepJob = whereIsMoneyJobForTest({
      id: "deep-job-failed-after-where",
      kind: "address_deep_check",
      status: "failed",
      subjectAddress: whereReport.subjectAddress,
      progressJson: { locale: "ru" }
    });

    const message = formatDeepForensicFailureUserDeliveryReport(
      failedDeepJob,
      "provider timeout",
      whereJob,
      { locale: "ru" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Проверка адреса — итог");
    expect(text).not.toContain("предварительный результат");
    expect(text).not.toContain("Deep forensic job failed");
  });

  it("formats failed DeepCheck delivery as safe failure when no matching where result exists", () => {
    const failedDeepJob = whereIsMoneyJobForTest({
      id: "deep-job-failed-without-where",
      kind: "address_deep_check",
      status: "failed",
      progressJson: { locale: "en" }
    });

    const message = formatDeepForensicFailureUserDeliveryReport(
      failedDeepJob,
      "<provider timeout>",
      null,
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Deep forensic job failed");
    expect(text).toContain("<provider timeout>");
  });

  it("extracts persisted deep result JSON only when the report shape and subject match", () => {
    const deepReport = deepReportForTest({
      runProfile: "bounded_rerun",
      providerBudget: {
        providerCallBudget: 20,
        transferCallBudget: 10,
        contractCallBudget: 0,
        approvalCallBudget: 0,
        elapsedTimeBudgetMs: 30000,
        exhausted: false
      },
      assetContinuationProfiles: [
        assetContinuationProfileForTest()
      ],
      contractDrivenCampaignSummary: {
        incomingTxTotal: 2,
        incomingAmountRaw: "3000000",
        txInfoEnrichedIncomingTx: 2,
        campaignClassificationStatus: "complete",
        countsAreLowerBounds: false,
        plainUsdtTransferTxCount: 1,
        plainUsdtTransferAmountRaw: "1000000",
        wrapperDrivenIncomingTxCount: 1,
        wrapperDrivenIncomingAmountRaw: "2000000",
        verify20WrapperTxCount: 1,
        transferFromWrapperTxCount: 0,
        permitWrapperTxCount: 0,
        otherContractMethodTxCount: 0,
        unknownUnenrichedTxCount: 0,
        txInfoUnavailableTxCount: 0,
        exactApprovalDrainProfileCount: 0,
        campaignClusters: []
      }
    });
    const matchingJob = whereIsMoneyJobForTest({
      id: "deep-job",
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });
    const wrongSubjectJob = whereIsMoneyJobForTest({
      id: "deep-job-wrong-subject",
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(deepReportForTest({ subjectAddress: secondWalletAddress }))
    });
    const legacyResultJson = persistedDeepResultJsonForTest(deepReport);
    delete legacyResultJson.runProfile;
    delete legacyResultJson.providerBudget;
    delete legacyResultJson.contractDrivenCampaignSummary;
    const legacyJob = whereIsMoneyJobForTest({
      id: "deep-job-legacy",
      kind: "address_deep_check",
      resultJson: legacyResultJson
    });
    const invalidShapeJob = whereIsMoneyJobForTest({
      id: "deep-job-invalid",
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: walletAddress,
        coverage: {},
        coverageDebug: {}
      }
    });

    const extractedReport = extractDeepForensicReportFromJob(matchingJob, walletAddress);

    expect(extractedReport?.subjectAddress).toBe(walletAddress);
    expect(extractedReport?.assetContinuationProfiles).toEqual([
      expect.objectContaining({
        evidenceClass: "asset_continuation",
        score: 82
      })
    ]);
    expect(extractedReport?.contractDrivenCampaignSummary).toEqual(deepReport.contractDrivenCampaignSummary);
    expect(extractedReport?.runProfile).toBe("bounded_rerun");
    expect(extractedReport?.providerBudget).toEqual({
      providerCallBudget: 20,
      transferCallBudget: 10,
      contractCallBudget: 0,
      approvalCallBudget: 0,
      elapsedTimeBudgetMs: 30000,
      exhausted: false
    });
    expect(extractDeepForensicReportFromJob(legacyJob, walletAddress)).toMatchObject({
      contractDrivenCampaignSummary: null,
      runProfile: "production_full",
      providerBudget: {
        providerCallBudget: null,
        transferCallBudget: null,
        contractCallBudget: null,
        approvalCallBudget: null,
        elapsedTimeBudgetMs: null,
        exhausted: false
      }
    });
    expect(extractDeepForensicReportFromJob(wrongSubjectJob, walletAddress)).toBeNull();
    expect(extractDeepForensicReportFromJob(invalidShapeJob, walletAddress)).toBeNull();
  });

  it("formats where delivery with matching persisted deep context without competing behavior score", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      directCounterpartyInteractionProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "outbound",
          counterpartyAddress: "TV7PLwexampleXSUT",
          volumeRaw: "500000000000",
          volumeRatio: 0.496,
          txCount: 8,
          firstSeen: "2026-06-01T10:00:00.000Z",
          lastSeen: "2026-06-01T11:00:00.000Z",
          txHashes: ["tx-counterparty"],
          serviceCategory: null,
          identity: null,
          scoreContribution: 45,
          snapshot: {
            address: "TV7PLwexampleXSUT",
            riskScore: 80,
            riskLevel: "HIGH",
            source: "fast_address_check",
            evidenceClass: "counterparty_behavior_context",
            reasons: ["counterparty fast check found behavior context"],
            partialNotes: []
          },
          interactionWeight: 0.56,
          evidenceClass: "counterparty_behavior_context",
          skippedReason: null
        }
      ]
    });
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-job",
      kind: "address_deep_check",
      resultJson: persistedDeepResultJsonForTest(deepReport)
    });

    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest(),
      whereReport,
      "completed",
      deepJob,
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Risk:");
    const scores = text.match(/\d+\/100/g) ?? [];
    expect(scores).toHaveLength(1);
    expect(scores[0]).not.toBe("25/100");
    expect(Number(scores[0]?.split("/")[0])).toBeGreaterThan(25);
    expect(text).toContain("Behavior warning");
    expect(text).not.toContain("Behavior risk");
    expect(text).not.toContain("80/100");
  });

  it("keeps standalone where-is-money delivery final without a matching DeepCheck", () => {
    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
      whereIsMoneyReportForTest(),
      "completed",
      null,
      { locale: "ru" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Проверка адреса — итог");
    expect(text).not.toContain("предварительный результат");
  });

  it("does not publish a final decline when where-is-money score is invalid", () => {
    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest(),
      scoreInvalidWhereReportForTest(),
      "completed",
      null,
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check - no final decision");
    expect(text).not.toContain("Blocked reason");
    expect(text).not.toContain("Technical status");
    expect(text).not.toContain("Decision: DECLINE");
    expect(text).not.toContain("Final risk");
  });

  it("keeps English no-final technical diagnostics behind beta flag", () => {
    const whereReport = scoreInvalidWhereReportForTest();

    const normalText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en"
    });
    const betaText = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      locale: "en",
      showBetaDiagnostics: true
    });

    expect(normalText).toContain("Address check - no final decision");
    expect(normalText).not.toContain("Blocked reason");
    expect(normalText).not.toContain("Technical status");
    expect(betaText).toContain("Blocked reason: insufficient_coverage");
    expect(betaText).toContain("Technical status: provider_cap_unresolved");
  });

  it("keeps score-invalid where-is-money support output technical, not final decline", () => {
    const message = formatWhereIsMoneySupportReport(
      whereIsMoneyJobForTest({ id: "where-score-invalid" }),
      scoreInvalidWhereReportForTest(),
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Decision: NO_FINAL_DECISION");
    expect(text).toContain("Score valid: false");
    expect(text).toContain("Blocked reason: insufficient_coverage");
    expect(text).toContain("Technical status: provider_cap_unresolved");
    expect(text).not.toContain("Decision: DECLINE");
  });

  it("does not turn score-invalid where plus DeepCheck into a final decline", () => {
    const report = scoreInvalidWhereReportForTest();
    const deepJob = whereIsMoneyJobForTest({
      id: "deep-score-invalid",
      kind: "address_deep_check",
      subjectAddress: report.subjectAddress,
      resultJson: persistedDeepResultJsonForTest(deepReportForTest({ subjectAddress: report.subjectAddress }))
    });
    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      deepJob,
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check - no final decision");
    expect(text).not.toContain("Decision: DECLINE");
    expect(text).not.toContain("NO_FINAL_DECISION");
  });

  it("formats where-is-money delivery as preliminary when matching DeepCheck is still running", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      riskScore: 95,
      assessment: {
        ...whereAssessmentForTest({ decision: "DECLINE", riskScore: 95 }),
        hardBadEvidence: [
          {
            kind: "approval_drain",
            score: 95,
            evidenceIds: ["tx-preliminary-approval-drain"],
            message: "Exact approval-drain provenance reaches checked wallet via 0 hop(s)."
          }
        ]
      },
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: walletAddress,
          subjectAddress: walletAddress,
          hopDepth: 0,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain"],
          pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
          score: 95,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ]
    });
    const runningDeepJob = whereIsMoneyJobForTest({
      id: "deep-job-running",
      kind: "address_deep_check",
      status: "running",
      subjectAddress: whereReport.subjectAddress,
      resultJson: {}
    });

    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
      whereReport,
      "completed",
      runningDeepJob,
      { locale: "ru", runtimeLabel: "worker-test" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Откуда деньги — предварительный результат");
    expect(text).toContain("Предварительный риск");
    expect(text).toContain("95/100");
    expect(text).toContain("Найдена точная approval-drain цепочка");
    expect(text).toContain("Проверка “Откуда деньги” нашла 1 hard-proof approval-drain цепочек.");
    expect(text).toContain("Проверяемый адрес — первый получатель после transferFrom drain.");
    expect(text).toContain("“Откуда деньги” завершено первым");
    expect(text).toContain("Финальный итог придёт");
    expect(text).not.toContain("Проверка адреса — итог");
    expect(text).not.toContain("Exact approval-drain provenance reaches checked wallet via 0 hop(s).");
    expect(text).not.toContain("Разбор оценки");
  });

  it("formats low where-is-money preliminary delivery without overstating evidence", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 10,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 10 }),
        hardBadEvidence: []
      }
    });
    const runningDeepJob = whereIsMoneyJobForTest({
      id: "deep-job-running-low-risk",
      kind: "address_deep_check",
      status: "running",
      subjectAddress: whereReport.subjectAddress,
      resultJson: {}
    });

    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
      whereReport,
      "completed",
      runningDeepJob,
      { locale: "ru" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Откуда деньги — предварительный результат");
    expect(text).toContain("предварительную проверку происхождения");
    expect(text).not.toContain("важный сигнал");
    expect(text).not.toContain("Проверка адреса — итог");
  });

  it("keeps normal where delivery compact without support-only details", () => {
    const whereReport = whereIsMoneyReportForTest({
      riskScore: 25,
      decisionReasons: ["Operational liquidity behavior is consistent with repeated legitimate counterparties."],
      coverage: {
        selectedInboundTxCount: 32,
        selectedInboundVolumeRaw: "840313000000",
        currentBalanceCoverageRatio: 0.9533,
        coverageRatio: 0.9533,
        maxDepth: 20,
        fetchedAddressCount: 19,
        partial: true,
        notes: []
      }
    });

    const message = formatWhereIsMoneyUserDeliveryReport(
      whereIsMoneyJobForTest({ id: "where-job-user-delivery" }),
      whereReport,
      "completed",
      null,
      { locale: "en", runtimeLabel: "worker-a" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Risk:");
    expect(text).toContain("0/100");
    expect(text).not.toContain("Where-is-money — support/debug");
    expect(text).not.toContain("support/debug");
    expect(text).not.toContain("Job:");
    expect(text).not.toContain("where-job-user-delivery");
    expect(text).not.toContain("Fetched addresses:");
    expect(text).not.toContain("Selected inbound transfers:");
  });

  it("lets deterministic hard evidence override a low where-is-money score", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      stablecoinRestrictionProfiles: [
        stablecoinRestrictionProfile({ isBlacklisted: true })
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "ru"
    });

    expect(text).toContain("Решение: не принимать автоматически.");
    expect(text).not.toContain("Решение: DECLINE");
    expect(text).toContain("95/100");
    expect(text).toContain("USDT blacklist");
  });

  it("uses route-linked approval-drain pattern floor without exact hard evidence", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: secondWalletAddress,
          subjectAddress: walletAddress,
          hopDepth: 1,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain", "tx-hop-subject"],
          pathAddresses: ["TVictim111111111111111111111111111111", secondWalletAddress, walletAddress],
          score: 95,
          evidenceStrength: "route_linked",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });

    expect(text).toContain("Decision: REVIEW");
    expect(text.match(/\d+\/100/g)).toEqual(["80/100"]);
    expect(text).toContain("Route-linked approval-drain context found without exact approval-drain proof.");
    expect(text).not.toContain("Matrix row: route_linked_approval_pattern; matrix decision: REVIEW.");
    expect(text).not.toContain("Exact approval-drain provenance was found.");
    expect(text).not.toContain("95/100");
    expect(text).not.toContain("Behavior risk");
  });

  it("lets exact approval-drain evidence override a low where-is-money score", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      approvalDrainProvenanceProfiles: [
        {
          victimAddress: "TVictim111111111111111111111111111111",
          approvalTxHash: "tx-approval-root-cause",
          drainTxHash: "tx-transferfrom-drain",
          spenderAddress: "TSpender11111111111111111111111111111",
          firstReceiverAddress: secondWalletAddress,
          subjectAddress: walletAddress,
          hopDepth: 0,
          amountRaw: "309000000000",
          amountPreservationRatio: 0.991,
          approvalAt: "2026-05-20T09:50:00.000Z",
          drainAt: "2026-05-20T10:00:00.000Z",
          pathTxHashes: ["tx-transferfrom-drain"],
          pathAddresses: ["TVictim111111111111111111111111111111", walletAddress],
          score: 88,
          evidenceStrength: "exact_approval_and_transfer_from",
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });

    expect(text).toContain("Decision: DECLINE");
    expect(text).toContain("Risk: 95/100 — CRITICAL");
    expect(text).not.toContain("(Final risk: )");
    expect(text.match(/\d+\/100/g)).toEqual(["95/100"]);
    expect(text).toContain("Exact approval-drain evidence was found");
    expect(text).not.toContain("Behavior risk");
  });

  it("lets exact deep inbound high-risk provenance override a low where-is-money score", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      inboundProvenanceProfiles: [
        {
          subjectAddress: walletAddress,
          incomingVolumeRaw: "100000000000",
          matchedInboundVolumeRaw: "90000000000",
          paths: [
            {
              depth: 2,
              sourceAddress: "TDarknet111111111111111111111111111",
              viaAddresses: [secondWalletAddress],
              label: "darknet_exchange",
              amountRaw: "90000000000",
              amountPreservationRatio: 0.9,
              firstTransferAt: "2026-05-20T10:00:00.000Z",
              lastTransferAt: "2026-05-20T11:00:00.000Z",
              txHashes: ["tx-darknet-hop", "tx-hop-subject"]
            }
          ],
          boundaryNotes: [],
          score: 45,
          features: []
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });

    expect(text).toContain("Decision: DECLINE");
    expect(text.match(/\d+\/100/g)).toEqual(["85/100"]);
    expect(text).toContain("Deep Research found deterministic high-risk inbound provenance");
    expect(text).not.toContain("Behavior risk");
    expect(text).not.toContain("45/100");
  });

  it("lets exact deep extended high-risk provenance override a low where-is-money score", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      extendedProvenanceProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "inbound",
          maxDepth: 4,
          paths: [
            {
              direction: "inbound",
              depth: 3,
              pathAddresses: ["TScam11111111111111111111111111111", secondWalletAddress, walletAddress],
              txHashes: ["tx-scam-hop", "tx-hop-subject"],
              amountRaw: "70000000000",
              amountPreservationRatio: 0.88,
              firstTransferAt: "2026-05-20T10:00:00.000Z",
              lastTransferAt: "2026-05-20T11:00:00.000Z",
              label: "scam",
              labelAddress: "TScam11111111111111111111111111111",
              boundaryCategory: null,
              evidenceStrength: "exact_labeled_path",
              candidateScore: 70,
              features: []
            }
          ],
          matchedVolumeRaw: "70000000000",
          matchedVolumeRatio: 0.7,
          score: 70,
          features: [],
          coverage: {
            expandedAddresses: 3,
            fetchedAddressCount: 3,
            stoppedReasons: [],
            maxDepthReached: 3
          }
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });

    expect(text).toContain("Decision: DECLINE");
    expect(text.match(/\d+\/100/g)).toEqual(["85/100"]);
    expect(text).toContain("Deep Research found exact high-risk extended provenance");
    expect(text).not.toContain("Behavior risk");
    expect(text).not.toContain("70/100");
  });

  it("uses deep WhiteBIT provenance in unified score without hard evidence floor", () => {
    const whereReport = whereIsMoneyReportForTest({
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      riskScore: 25,
      assessment: {
        ...whereAssessmentForTest({ decision: "ACCEPTABLE", riskScore: 25 }),
        hardBadEvidence: []
      }
    });
    const deepReport = deepReportForTest({
      inboundProvenanceProfiles: [
        {
          subjectAddress: walletAddress,
          incomingVolumeRaw: "100000000000",
          matchedInboundVolumeRaw: "90000000000",
          paths: [
            {
              depth: 1,
              sourceAddress: "TWhitebit11111111111111111111111111",
              viaAddresses: [],
              label: "whitebit",
              amountRaw: "90000000000",
              amountPreservationRatio: 0.9,
              firstTransferAt: "2026-05-20T10:00:00.000Z",
              lastTransferAt: "2026-05-20T11:00:00.000Z",
              txHashes: ["tx-whitebit-subject"]
            }
          ],
          boundaryNotes: [],
          score: 45,
          features: []
        }
      ],
      extendedProvenanceProfiles: [
        {
          subjectAddress: walletAddress,
          direction: "inbound",
          maxDepth: 4,
          paths: [
            {
              direction: "inbound",
              depth: 2,
              pathAddresses: ["TWhitebit11111111111111111111111111", walletAddress],
              txHashes: ["tx-whitebit-extended"],
              amountRaw: "70000000000",
              amountPreservationRatio: 0.88,
              firstTransferAt: "2026-05-20T10:00:00.000Z",
              lastTransferAt: "2026-05-20T11:00:00.000Z",
              label: "whitebit",
              labelAddress: "TWhitebit11111111111111111111111111",
              boundaryCategory: null,
              evidenceStrength: "exact_labeled_path",
              candidateScore: 90,
              features: []
            }
          ],
          matchedVolumeRaw: "70000000000",
          matchedVolumeRatio: 0.7,
          score: 90,
          features: [],
          coverage: {
            expandedAddresses: 2,
            fetchedAddressCount: 2,
            stoppedReasons: [],
            maxDepthReached: 2
          }
        }
      ]
    });

    const text = formatUnifiedAddressFinalReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });
    const detailedText = formatUnifiedAddressDetailedReportForTest({
      address: whereReport.subjectAddress,
      whereReport,
      deepReport,
      locale: "en"
    });
    const deepSection = plainSectionText(detailedText, "DeepCheck");

    expect(text).toContain("Decision: DECLINE");
    expect(text.match(/\d+\/100/g)).toEqual(["70/100"]);
    expect(text).toContain("DeepCheck found a source-policy link to whitebit. This does not prove theft, but requires source-of-funds review.");
    expect(deepSection).toContain("DeepCheck found a source-policy link to whitebit. This does not prove theft, but requires source-of-funds review.");
    expect(text).not.toContain("Deterministic high-risk provenance evidence was found.");
    expect(text).not.toContain("DeepCheck found an exact on-chain link to a high-risk source.");
    expect(text).not.toContain("90/100");
    expect(text).not.toContain("Behavior risk");
  });

  it("formats non-hard preliminary address checks as started copy without fast score", () => {
    const result = manualCheckResultForTest({
      report: riskReportForTest({
        level: "HIGH",
        score: 60,
        taintScore: 0,
        launderingPatternScore: 60,
        dominantRiskType: "laundering_pattern",
        reasons: [
          {
            code: "forensic_address_behavior",
            message: "Address shows high-volume transit-like behavior.",
            scoreImpact: 60
          }
        ]
      })
    });

    const text = formatAddressCheckStartedForTest(result, { locale: "en" });

    expect(text).toContain("Address check \u2014 started");
    expect(text).toContain(`Address: ${walletAddress}`);
    expect(text).toContain("What is running");
    expect(text).toContain("Final risk appears after provenance analysis.");
    expect(text).not.toContain("60/100");
    expect(text).not.toContain("Address risk");
  });

  it("shows immediate risk evidence when preliminary fast hard evidence exists", () => {
    const result = manualCheckResultForTest({
      report: riskReportForTest({
        level: "CRITICAL",
        score: 90,
        taintScore: 90,
        launderingPatternScore: 0,
        dominantRiskType: "taint",
        reasons: [
          {
            code: "internal_label_scam",
            message: "Internal label: scam",
            scoreImpact: 90
          }
        ]
      })
    });

    const text = formatAddressCheckStartedForTest(result, { locale: "en" });

    expect(text).toContain("Address risk");
    expect(text).toContain("90/100");
    expect(text).toContain("Connected risk modules found review-worthy signals");
    expect(text).not.toContain("Address check \u2014 started");
    expect(text).not.toContain("Final risk appears after provenance analysis.");
  });

  it("uses approval-drain proximity as the main fast reason and moves behavior to context", () => {
    const result = manualCheckResultForTest({
      report: riskReportForTest({
        level: "CRITICAL",
        score: 95,
        taintScore: 95,
        launderingPatternScore: 0,
        dominantRiskType: "taint",
        reasons: [
          {
            code: "internal_label_approval_drain_proximity",
            message: "Derived high-risk marker: exact upstream approval-drain provenance linked to this address.",
            scoreImpact: 95
          }
        ]
      }),
      addressBehaviorProfiles: [
        {
          subjectAddress: walletAddress,
          incomingVolumeRaw: "100000000000",
          outgoingVolumeRaw: "95000000000",
          incomingTxCount: 1,
          outgoingTxCount: 2,
          uniqueIncomingCounterparties: 1,
          uniqueOutgoingCounterparties: 1,
          largestIncomingRaw: "100000000000",
          largestOutgoingRaw: "95000000000",
          topOutgoingCounterpartyAddress: secondWalletAddress,
          topOutgoingCounterpartyRaw: "95000000000",
          topOutgoingCounterpartyTxCount: 2,
          topOutgoingCounterpartyRatio: 1,
          inflowToOutflowRatio: 0.95,
          drainToServiceRatio: 0,
          timeToFirstOutgoingMs: 30 * 60 * 1000,
          timeToFirstServiceExitMs: null,
          depositThenDrainScore: 30,
          transitScore: 0,
          dampenerScore: 0,
          features: [
            {
              code: "address_behavior_deposit_then_drain",
              label: "Address shows high-volume transit-like behavior; this may also match legitimate treasury, trading, merchant, or operational wallet activity.",
              scoreImpact: 30
            }
          ]
        }
      ]
    });

    const text = formatAddressCheckStartedForTest(result, { locale: "ru" });

    expect(text).toContain("Риск адреса: 🔴 95/100");
    expect(text).toContain("По адресу есть сохранённое exact approval-drain доказательство");
    expect(text).toContain("Дополнительный контекст");
    expect(text).toContain("95% полученных USDT перераспределено примерно за 30m.");
    expect(text).toContain("Адрес похож на high-volume transit.");
    expect(text.indexOf("По адресу есть сохранённое exact approval-drain доказательство")).toBeLessThan(text.indexOf("Дополнительный контекст"));
  });

  it("formats compact Russian where-is-money result summary", () => {
    const message = formatWhereIsMoneyReport(
      whereIsMoneyJobForTest({ progressJson: { locale: "ru" } }),
      whereIsMoneyReportForTest({
        decision: "DECLINE",
        userDecision: "DECLINE",
        internalDecision: "DECLINE",
        proofLevel: "insufficient_coverage",
        riskScore: 60,
        decisionReasons: ["manual review required"],
        coverage: {
          selectedInboundTxCount: 1,
          selectedInboundVolumeRaw: "1000000",
          currentBalanceCoverageRatio: 0.76,
          maxDepth: 7,
          fetchedAddressCount: 2,
          partial: false,
          notes: ["No balance-forming origin paths were available; manual review required."]
        }
      }),
      "partial",
      { locale: "ru" }
    );

    expect(message.text).toContain("Проверка адреса — итог");
    expect(message.text).not.toContain("готово, есть ограничения");
    expect(message.text).not.toContain("частично");
    expect(message.text).toContain("Решение");
    expect(message.text).toContain("Проверили 76% выбранной суммы");
    expect(message.text).toContain("Почему");
    expect(message.text).not.toContain("Data quality");
    expect(message.text).not.toContain("Технические детали");
    expect(message.text).not.toContain("Job:");
    expect(message.text).toContain("Жёстких плохих доказательств не найдено.");
    expect(message.text).not.toContain("manual review required");
  });

  it("formats approval-drain evidence in where-is-money results", () => {
    const message = formatWhereIsMoneyReport(
      {
        id: "where-job-approval-drain",
        kind: "where_is_money_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        currentUsdtBalanceRaw: "2576000000",
        fastWalletRisk: {
          subjectAddress: walletAddress,
          level: "LOW",
          score: 0,
          reasons: []
        },
        balanceFormingTransfers: [],
        originPaths: [],
        senderInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [
          {
            victimAddress: "TVictim111111111111111111111111111111",
            approvalTxHash: "tx-approval-root-cause",
            drainTxHash: "tx-transferfrom-drain",
            spenderAddress: "TSpender11111111111111111111111111111",
            operatorAddress: "TOperator1111111111111111111111111111",
            spenderResolution: "wrapper_contract",
            falsePositiveGuards: [],
            supportingFingerprints: [
              {
                code: "misleading_wrapper_method",
                label: "Wrapper method name does not disclose USDT transferFrom behavior.",
                value: "Verify20"
              }
            ],
            firstReceiverAddress: walletAddress,
            subjectAddress: walletAddress,
            hopDepth: 0,
            amountRaw: "2576000000",
            amountPreservationRatio: 1,
            approvalAt: "2026-05-20T09:50:00.000Z",
            drainAt: "2026-05-20T10:00:00.000Z",
            pathTxHashes: ["tx-transferfrom-drain"],
            pathAddresses: [
              "TVictim111111111111111111111111111111",
              walletAddress
            ],
            score: 90,
            evidenceStrength: "exact_approval_and_transfer_from",
            subjectTokenState: null,
            victimTokenState: null,
            features: []
          }
        ],
        assessment: {
          decision: "DECLINE",
          riskScore: 90,
          riskBand: "CRITICAL",
          provenanceConfidence: 100,
          coverageCompleteness: 100,
          walletRole: "risky_source_wallet",
          operationalLiquidityScore: 0,
          ageSignals: null,
          hardBadEvidence: [
            {
              kind: "approval_drain",
              score: 90,
              message: "Balance-forming path contains exact approval-drain transferFrom evidence.",
              evidenceIds: ["tx-transferfrom-drain"]
            }
          ],
          ...emptyRiskLayerDefaultsForTest(),
          reasons: ["Balance-forming path contains exact approval-drain transferFrom evidence."],
          warnings: []
        },
        decision: "DECLINE",
        userDecision: "DECLINE",
        internalDecision: "DECLINE",
        proofLevel: "exact_approval_drain_provenance",
        riskScore: 90,
        decisionReasons: ["Balance-forming path contains exact approval-drain transferFrom evidence."],
        coverage: {
          selectedInboundTxCount: 1,
          selectedInboundVolumeRaw: "2576000000",
          currentBalanceCoverageRatio: 1,
          maxDepth: 7,
          fetchedAddressCount: 2,
          partial: false,
          notes: []
        }
      },
      "completed",
      { locale: "en", showBetaDiagnostics: true }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Decision: DECLINE");
    expect(text).toContain("Exact approval-drain evidence was found");
    expect(text).not.toContain("Deterministic high-risk provenance evidence was found.");
    expect(text).not.toContain("Previous fast risk");
    expect(text).toContain("95/100");
    expect(text).not.toContain("Hard evidence floor 95 raises or pins the final risk.");
    expect(text).not.toContain("Approval-drain evidence");
    expect(text).not.toContain("Evidence type");
    expect(text).not.toContain("Origin paths");
    expect(text).not.toContain("Sender interactions");
    expect(text).not.toContain("Job:");
  });

  it("formats exchange-policy proof wording in where-is-money results", () => {
    const message = formatWhereIsMoneyReport(
      {
        id: "where-job-whitebit",
        kind: "where_is_money_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        currentUsdtBalanceRaw: "1123000000",
        fastWalletRisk: null,
        balanceFormingTransfers: [],
        originPaths: [],
        senderInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [],
        approvalDrainReviewFindings: [],
        contractLlmVerdicts: [],
        assessment: {
          decision: "DECLINE",
          riskScore: 55,
          riskBand: "MEDIUM",
          provenanceConfidence: 100,
          coverageCompleteness: 100,
          walletRole: "risky_source_wallet",
          operationalLiquidityScore: 0,
          ageSignals: null,
          hardBadEvidence: [],
          ...emptyRiskLayerDefaultsForTest(),
          reasons: ["WhiteBIT exposure (100% of current balance) reaches exchange policy decline threshold."],
          warnings: []
        },
        decision: "DECLINE",
        userDecision: "DECLINE",
        internalDecision: "DECLINE",
        proofLevel: "exchange_policy_decline",
        riskScore: 55,
        decisionReasons: ["WhiteBIT exposure (100% of current balance) reaches exchange policy decline threshold."],
        coverage: {
          selectedInboundTxCount: 1,
          selectedInboundVolumeRaw: "1123000000",
          currentBalanceCoverageRatio: 1,
          maxDepth: 7,
          fetchedAddressCount: 3,
          partial: false,
          notes: []
        }
      },
      "completed",
      { locale: "en", showBetaDiagnostics: true }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Decision: DECLINE");
    expect(text).toContain("70/100");
    expect(text).toContain("Source-policy evidence reached the decline or manual-review threshold.");
    expect(text).toContain("No deterministic bad evidence was found.");
    expect(text).not.toContain("Evidence type");
    expect(text).not.toContain("direct scam proof");
    expect(text).not.toContain("Job:");
  });

  it("summarizes no-name token liquidity Stage 2 as source-policy risk, not direct scam proof", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("no_name_token_liquidity"),
      "completed",
      { locale: "en" }
    ).text);

    expect(text).toContain("Cross-chain corridor");
    expect(text).toContain("no-name token liquidity");
    expect(text).toContain("source-policy risk, not direct scam proof");
    expect(text).not.toContain("This is direct scam proof");
    expect(text).not.toContain("hard proof");
  });

  it("says Stage 2 provider data is partial for partial corridor summaries", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("no_name_token_liquidity", {
        partial: true,
        coverageNotes: ["Range provider data exhausted before terminal confirmation."]
      }),
      "partial",
      { locale: "en" }
    ).text);

    expect(text).toContain("Cross-chain corridor");
    expect(text).toContain("Stage 2 was triggered, but provider data is partial");
  });

  it("summarizes manual bridge continuation separately from the corridor verdict", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("bridge_boundary", {
        paths: [
          {
            ...crossChainCorridorForTest("bridge_boundary").paths[0]!,
            terminalBoundary: "bridge_boundary",
            continuation: {
              enabled: true,
              seed: {
                id: "seed-bridge-boundary",
                chain: "ethereum",
                address: "0x1111111111111111111111111111111111111111",
                txHash: "tx-bridge-stage2",
                amountRaw: "980000000",
                assetSymbol: "USDT",
                timestamp: "2026-05-24T00:10:00.000Z",
                labels: ["Allbridge"],
                evidenceRefs: []
              },
              edges: [
                {
                  id: "edge-continuation-candidate",
                  edgeType: "token_transfer",
                  source: { chain: "ethereum", chainId: 1, address: "0x1111111111111111111111111111111111111111" },
                  destination: { chain: "ethereum", chainId: 1, address: "0xcandidate" },
                  txHash: "tx-continuation-candidate",
                  amountRaw: "970000000",
                  assetSymbol: "USDT",
                  timestamp: "2026-05-24T00:12:00.000Z",
                  protocol: null,
                  evidenceRefs: [],
                  labels: [],
                  continuationEvidenceClass: "weak_candidate",
                  score: 20,
                  reasons: ["Candidate support only."]
                }
              ],
              terminalBoundary: "candidate_only",
              providerCalls: 1,
              partial: true,
              coverageNotes: ["Continuation produced candidate-only support without terminal proof."],
              reasoningTrace: [
                {
                  kind: "observation",
                  message: "Observed weak same-chain continuation edge.",
                  edgeId: "weak-same-chain"
                },
                {
                  kind: "decision",
                  message: "Switch continuation provider from arbitrum to ethereum based on LayerZero/Stargate evidence.",
                  fromChain: "arbitrum",
                  toChain: "ethereum",
                  edgeId: "edge-continuation-candidate"
                }
              ],
              payloadRefs: []
            }
          }
        ]
      }),
      "partial",
      { locale: "en" }
    ).text);

    expect(text).toContain("Bridge continuation");
    expect(text).toContain("candidate-only");
    expect(text).toContain("0xcandidate");
    expect(text).toContain("Continuation reasoning");
    expect(text).toContain("Switch continuation provider");
    expect(text).not.toContain("Observed weak same-chain");
    expect(text).not.toContain("hard proof");
  });

  it("says Stage 2 deep analysis was skipped below threshold", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      whereIsMoneyReportForTest({
        crossChainCorridor: crossChainCorridorForTest("none", {
          triggered: false,
          skippedReason: "below_threshold",
          paths: []
        })
      }),
      "completed",
      { locale: "en" }
    ).text);

    expect(text).toContain("Cross-chain corridor");
    expect(text).toContain("Deep cross-chain analysis was not auto-run below threshold");
  });

  it("does not claim a non-threshold Stage 2 skip was below threshold", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      whereIsMoneyReportForTest({
        crossChainCorridor: crossChainCorridorForTest("none", {
          triggered: false,
          skippedReason: "no cross-chain boundary selected",
          paths: []
        })
      }),
      "completed",
      { locale: "en" }
    ).text);

    expect(text).toContain("Cross-chain corridor");
    expect(text).toContain("Deep cross-chain analysis was not auto-run");
    expect(text).not.toContain("not auto-run below threshold");
  });

  it("does not label data-exhausted Stage 2 coverage as source-policy risk", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("data_exhausted"),
      "partial",
      { locale: "en" }
    ).text);

    expect(text).toContain("Terminal boundary: data exhausted");
    expect(text).toContain("insufficient_coverage; provider coverage is incomplete");
    expect(text).not.toContain("insufficient_coverage; source-policy risk");
  });

  it("shows only the top Stage 2 corridor path and does not dump every edge", () => {
    const corridor = crossChainCorridorForTest("no_name_token_liquidity");
    const secondPath = {
      ...corridor.paths[0]!,
      id: "corridor-second",
      terminalBoundary: "dex_router_boundary" as const,
      selectedAmountRaw: "10000000",
      edges: [
        {
          ...corridor.paths[0]!.edges[0]!,
          id: "edge-second-only",
          txHash: "tx-second-path-should-not-render"
        }
      ]
    };
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("no_name_token_liquidity", {
        paths: [corridor.paths[0]!, secondPath]
      }),
      "completed",
      { locale: "en" }
    ).text);

    expect(text).toContain("Top path");
    expect(text).toContain("tx-bridge-stage2");
    expect(text).toContain("tx-terminal-stage2");
    expect(text).not.toContain("tx-second-path-should-not-render");
  });

  it("uses hard-proof wording only for exact sanctioned Stage 2 evidence", () => {
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      stage2WhereReportForTest("sanctioned_service"),
      "completed",
      { locale: "en" }
    ).text);

    expect(text).toContain("Cross-chain corridor");
    expect(text).toContain("sanctioned service");
    expect(text).toContain("Exact sanctioned service evidence found in cross-chain corridor.");
    expect(text).toContain("hard proof");
    expect(text).not.toContain("not direct scam proof");
  });

  it("formats policy decline without claiming scam proof", async () => {
    const text = formatWhereIsMoneyResultForTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      proofLevel: "exchange_policy_decline",
      riskScore: 65,
      decisionReasons: [
        "Clean source is not proven after unknown contract boundary."
      ],
      contractLlmVerdicts: []
    });

    expect(text).toContain("Decision: DECLINE");
    expect(text).toContain("Risk:");
    expect(text).toContain("70/100");
    expect(text).toContain("Source-policy evidence reached the decline or manual-review threshold.");
    expect(text).not.toContain("Evidence type");
    expect(text).not.toContain("not direct scam proof");
    expect(text).not.toContain("Risk band: HIGH");
    expect(text).not.toContain("Wallet role: risky_source_wallet");
    expect(text).not.toContain("REVIEW");
  });

  it("formats operational assessment fields in where-is-money results", () => {
    const text = formatWhereIsMoneyResultForTest({
      assessment: {
        decision: "ACCEPTABLE",
        riskScore: 32,
        riskBand: "LOW-MEDIUM",
        provenanceConfidence: 58,
        coverageCompleteness: 72,
        walletRole: "operational_liquidity_wallet",
        operationalLiquidityScore: 76,
        ageSignals: {
          subjectFirstSeenAt: "2024-12-27T00:00:00.000Z",
          subjectAgeDays: 513,
          subjectActiveDays: 120,
          directSenderMedianAgeDays: 400,
          oldestDirectSenderAgeDays: 600,
          repeatedRelationshipCount: 2,
          longestRelationshipAgeDays: 500,
          maxDormancyGapDays: 30,
          signals: []
        },
        hardBadEvidence: [],
        ...emptyRiskLayerDefaultsForTest(),
        reasons: ["Operational liquidity behavior is consistent with repeated legitimate counterparties."],
        warnings: ["Weak continuity on part of the provenance path."]
      },
      decision: "ACCEPTABLE",
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE",
      proofLevel: "clean_source_proven",
      riskScore: 32,
      decisionReasons: ["Operational liquidity behavior is consistent with repeated legitimate counterparties."]
    });

    expect(text).toContain("Decision: ACCEPTABLE");
    expect(text).toContain("Risk:");
    expect(text).toContain("0/100");
    expect(text).toContain("LOW");
    expect(text).toContain("No deterministic bad evidence was found.");
    expect(text).not.toContain("Provenance confidence: 58/100");
    expect(text).not.toContain("Coverage completeness: 72/100");
    expect(text).not.toContain("Wallet role: operational_liquidity_wallet");
    expect(text).not.toContain("Wallet age: 513 days observed");
    expect(text).not.toContain("Repeated sender relationships: 2");
    expect(text).not.toContain("Hard bad evidence: none");
  });

  it("formats low-balance recent-flow where-is-money results without balance-forming wording", () => {
    const baseReport = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 2,
        selectedInboundVolumeRaw: "89473150000",
        currentBalanceCoverageRatio: 0,
        maxDepth: 7,
        fetchedAddressCount: 3,
        partial: true,
        provenanceScope: "recent_flow",
        anchorTransfer: {
          txHash: "out-anchor",
          direction: "outgoing",
          fromAddress: walletAddress,
          toAddress: "TReceiver11111111111111111111111111",
          amountRaw: "89473150000",
          timestamp: "2026-05-05T08:49:27.000Z",
          reason: "latest_meaningful_outgoing"
        },
        lowBalanceThresholdRaw: "1000000000",
        dataScopeNote: "Current balance is below the low-balance threshold; selected funding candidates for the latest meaningful outgoing USDT transfer.",
        notes: []
      }
    });
    const text = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      baseReport,
      "partial",
      { locale: "en" }
    ).text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Important context");
    expect(text).toContain("this does not mean the full address history is complete");
    expect(text).not.toContain("Recent flow provenance");
    expect(text).not.toContain("Current balance is below the low-balance threshold");
    expect(text).not.toContain("Anchored by: limited_coverage_floor");
    expect(text).not.toContain("Anchored by:");
    expect(text).not.toContain("Anchor");
    expect(text).not.toContain("Recent flow coverage");
    expect(text).not.toContain("Balance-forming coverage");
  });

  it("uses the unified score decision instead of an internal user decline in where-is-money final results", () => {
    const text = formatWhereIsMoneyResultForTest({
      decision: "REVIEW",
      userDecision: "DECLINE",
      internalDecision: "REVIEW",
      proofLevel: "insufficient_coverage",
      riskScore: 45,
      decisionReasons: [
        "Clean source is not proven after unknown contract boundary."
      ],
      originPaths: [
        {
          balanceTransferTxHash: "tx-balance-review-origin",
          rootSourceAddress: "TBoundary111111111111111111111111111",
          rootSourceType: "unknown",
          pathAddresses: [
            "TBoundary111111111111111111111111111",
            walletAddress
          ],
          txHashes: ["tx-balance-review-origin"],
          steps: [
            {
              txHash: "tx-balance-review-origin",
              fromAddress: "TBoundary111111111111111111111111111",
              toAddress: walletAddress,
              amountRaw: "1000000",
              timestamp: "2026-05-22T10:05:00.000Z"
            }
          ],
          amountPreservationRatio: 1,
          timeSpanMs: null,
          stoppedReason: "unlabeled_service_boundary",
          verdict: "REVIEW",
          riskScoreContribution: 45,
          reasons: ["Balance-forming path reaches unlabeled service boundary."]
        }
      ]
    });

    expect(text).toContain("Decision: ACCEPTABLE");
    expect(text).toContain("Risk:");
    expect(text).not.toContain("Origin paths");
    expect(text).not.toContain("1. UNPROVEN");
    expect(text).not.toContain("Decision: DECLINE");
    expect(text).not.toContain("REVIEW");
  });

  it("shows residual unresolved materiality caveat without converting where review to decline", () => {
    const decisionReasons = [
      "Approval-drain review is guarded by service context; only residual source-provenance gaps remain below materiality."
    ];
    const report = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "DECLINE",
      internalDecision: "REVIEW",
      proofLevel: "insufficient_coverage",
      riskScore: 45,
      scoreValid: true,
      technicalStatus: "completed",
      scoreBlockedReason: null,
      decisionReasons,
      coverage: {
        selectedInboundTxCount: 7,
        selectedInboundVolumeRaw: "11175801645",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 20,
        fetchedAddressCount: 12,
        partial: true,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 45, decisionReasons }),
        decision: "REVIEW",
        riskScore: 45,
        riskBand: "MEDIUM",
        scoreValid: true,
        technicalStatus: "completed",
        scoreBlockedReason: null,
        reasons: [
          "Residual unresolved source 14.776543 USDT is below materiality; it is shown as a caveat, not a final coverage block."
        ],
        sourceProvenanceMateriality: {
          outcome: "residual_unresolved_below_materiality",
          materialityTier: "dust_residual",
          unresolvedAmountRaw: "14776543",
          unresolvedAmountUsdt: 14.776543,
          unresolvedShareOfCheckedBalance: 0.001322,
          unresolvedShareOfSelectedAmount: 0.000006,
          largestUnresolvedAmountRaw: "14776543",
          largestUnresolvedAmountUsdt: 14.776543,
          aggregateUnresolvedShareOfCheckedBalance: 0.001322,
          aggregateUnresolvedShareOfSelectedAmount: 0.000006,
          unresolvedPathCount: 5,
          denseHopUnresolvedPathCount: 0,
          hardEvidenceInUnresolved: false,
          excludedFromDecisiveScore: true,
          unresolvedReasonCounts: {
            funding_source_unresolved: 5
          },
          thresholds: {
            maxResidualUnresolvedShare: 0.01,
            maxResidualUnresolvedAmountUsdt: 100,
            maxResidualUnresolvedAmountRaw: "100000000",
            maxDenseHopUnresolvedShare: 0.01,
            maxDenseHopAggregateUnresolvedShare: 0.02,
            maxDenseHopUnresolvedAmountUsdt: 10000,
            maxDenseHopUnresolvedAmountRaw: "10000000000"
          }
        }
      }
    });
    const finalText = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      { locale: "en" }
    ).text);
    const supportText = plainTelegramText(formatWhereIsMoneySupportReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      { locale: "en" }
    ).text);

    expect(finalText).toContain("Decision: REVIEW");
    expect(finalText).toContain("45/100");
    expect(finalText).toContain("residual source-provenance gaps remain below materiality");
    expect(finalText).not.toContain("Decision: ACCEPTABLE");
    expect(finalText).not.toContain("0/100");
    expect(supportText).toContain("Decision: REVIEW");
    expect(supportText).toContain("Where risk: ");
    expect(supportText).toContain("45/100");
    expect(supportText).not.toContain("Decision: DECLINE");
  });

  it("shows dense-hop materiality caveat without converting where review to acceptable", () => {
    const denseHopMateriality = {
      outcome: "dense_hop_unresolved_below_materiality",
      materialityTier: "small_relative_dense_hop_tail",
      unresolvedAmountRaw: "45000000",
      unresolvedAmountUsdt: 45,
      unresolvedShareOfCheckedBalance: 0.0045,
      unresolvedShareOfSelectedAmount: 0.0045,
      largestUnresolvedAmountRaw: "45000000",
      largestUnresolvedAmountUsdt: 45,
      aggregateUnresolvedShareOfCheckedBalance: 0.0045,
      aggregateUnresolvedShareOfSelectedAmount: 0.0045,
      unresolvedPathCount: 1,
      denseHopUnresolvedPathCount: 1,
      hardEvidenceInUnresolved: false,
      excludedFromDecisiveScore: true,
      unresolvedReasonCounts: {
        incoming_history_not_fetched: 1,
        dense_hop_provider_cap: 1
      },
      thresholds: {
        maxResidualUnresolvedShare: 0.01,
        maxResidualUnresolvedAmountUsdt: 100,
        maxResidualUnresolvedAmountRaw: "100000000",
        maxDenseHopUnresolvedShare: 0.01,
        maxDenseHopAggregateUnresolvedShare: 0.02,
        maxDenseHopUnresolvedAmountUsdt: 10000,
        maxDenseHopUnresolvedAmountRaw: "10000000000"
      }
    } satisfies MoneyOriginSourceProvenanceMaterialitySummary;
    const report = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      proofLevel: "insufficient_coverage",
      riskScore: 45,
      scoreValid: true,
      technicalStatus: "completed",
      scoreBlockedReason: null,
      decisionReasons: ["History not fully fetched"],
      sourceProvenanceMateriality: denseHopMateriality,
      coverage: {
        selectedInboundTxCount: 3,
        selectedInboundVolumeRaw: "10000000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 20,
        fetchedAddressCount: 9,
        partial: true,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 45, decisionReasons: ["History not fully fetched"] }),
        decision: "REVIEW",
        riskScore: 45,
        riskBand: "MEDIUM",
        scoreValid: true,
        technicalStatus: "completed",
        scoreBlockedReason: null,
        sourceProvenanceMateriality: denseHopMateriality,
        reasons: ["History not fully fetched"]
      }
    });
    const finalText = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      { locale: "en" }
    ).text);

    expect(finalText).toContain("Decision: REVIEW");
    expect(finalText).toContain("45/100");
    expect(finalText).toContain("Small dense-hop source tail remains unresolved");
    expect(finalText).toContain("45 USDT");
    expect(finalText).toContain("below materiality");
    expect(finalText).toContain("not used as clean or bad evidence");
    expect(finalText).not.toContain("Decision: ACCEPTABLE");
    expect(finalText).not.toContain("0/100");
    expect(finalText).not.toContain("History not fully fetched");
  });

  it("localizes review final decision copy in Russian where-is-money results", () => {
    const report = whereIsMoneyReportForTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      proofLevel: "exchange_policy_context",
      riskScore: 55,
      decisionReasons: ["Unknown contract source boundary needs review."],
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1300000000",
        currentBalanceCoverageRatio: 1,
        coverageRatio: 1,
        maxDepth: 20,
        fetchedAddressCount: 3,
        partial: false,
        notes: []
      },
      assessment: {
        ...whereAssessmentForTest({ decision: "REVIEW", riskScore: 55 }),
        decision: "REVIEW",
        riskScore: 55,
        riskBand: "MEDIUM",
        reasons: ["Unknown contract source boundary needs review."],
        sourcePolicyEvidence: [],
        riskLayers: [
          {
            evidenceClass: "source_policy",
            kind: "unknown_contract",
            sourceExposureKind: "unknown_contract",
            score: 55,
            rawScore: 55,
            adjustedScore: 55,
            proofLevel: "exchange_policy_context",
            canBeDampened: false,
            reasons: ["Unknown contract source boundary needs review."],
            warnings: [],
            evidenceIds: ["source-policy-unknown-contract"]
          }
        ],
        dominantRiskLayer: {
          evidenceClass: "source_policy",
          kind: "unknown_contract",
          sourceExposureKind: "unknown_contract",
          score: 55,
          rawScore: 55,
          adjustedScore: 55,
          proofLevel: "exchange_policy_context",
          canBeDampened: false,
          reasons: ["Unknown contract source boundary needs review."],
          warnings: [],
          evidenceIds: ["source-policy-unknown-contract"]
        }
      }
    });
    const finalText = plainTelegramText(formatWhereIsMoneyReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      { locale: "ru" }
    ).text);

    expect(finalText).toContain("Решение: не принимать автоматически.");
    expect(finalText).not.toContain("Решение: REVIEW");
    expect(finalText).not.toContain("Manual review is required.");
    expect(finalText).not.toContain("Решение: ACCEPTABLE");
  });

  it("formats AI contract verdicts in where-is-money results", () => {
    const message = formatWhereIsMoneyReport(
      {
        id: "where-job-ai-contract",
        kind: "where_is_money_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        currentUsdtBalanceRaw: "1100000000",
        fastWalletRisk: null,
        balanceFormingTransfers: [],
        originPaths: [],
        senderInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [],
        approvalDrainReviewFindings: [],
        contractLlmVerdicts: [
          {
            source: "llm",
            providerLabel: "deepseek",
            model: "deepseek-v4-flash",
            contractAddress: "TWrapper11111111111111111111111111",
            caseFileHash: "case-hash",
            cacheId: "cache-id",
            verdict: "drainer_like",
            confidence: 0.82,
            contractRiskScore: 88,
            decisionRecommendation: "DECLINE",
            reasons: ["Wrapper method hides token movement."],
            citedEvidenceIds: ["tx-wrapper-drain"],
            falsePositiveNotes: ["No known bridge/router label."]
          }
        ],
        assessment: {
          decision: "DECLINE",
          riskScore: 88,
          riskBand: "CRITICAL",
          provenanceConfidence: 100,
          coverageCompleteness: 100,
          walletRole: "risky_source_wallet",
          operationalLiquidityScore: 0,
          ageSignals: null,
          hardBadEvidence: [
            {
              kind: "llm_contract_suspicion",
              score: 88,
              message: "AI contract verdict: drainer_like 82% confidence; Wrapper method hides token movement.",
              evidenceIds: ["tx-wrapper-drain"]
            }
          ],
          ...emptyRiskLayerDefaultsForTest(),
          reasons: ["AI contract verdict: drainer_like 82% confidence; Wrapper method hides token movement."],
          warnings: []
        },
        decision: "DECLINE",
        userDecision: "DECLINE",
        internalDecision: "DECLINE",
        proofLevel: "llm_assisted_suspicion",
        riskScore: 88,
        decisionReasons: ["AI contract verdict: drainer_like 82% confidence; Wrapper method hides token movement."],
        coverage: {
          selectedInboundTxCount: 1,
          selectedInboundVolumeRaw: "1100000000",
          currentBalanceCoverageRatio: 1,
          maxDepth: 7,
          fetchedAddressCount: 3,
          partial: false,
          notes: []
        }
      },
      "completed",
      { locale: "en", showBetaDiagnostics: true }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address check — final");
    expect(text).toContain("Decision: REVIEW");
    expect(text).not.toContain("Deterministic high-risk provenance evidence was found.");
    expect(text).toContain("AI contract verdict");
    expect(text).toContain("drainer_like");
    expect(text).toContain("82%");
    expect(text).toContain("Wrapper method hides token movement.");
    expect(text).not.toContain("Context evidence");
    expect(text).toContain("normalized contribution");
    expect(text).not.toContain("Evidence type");
    expect(text).not.toContain("Hard evidence: AI contract verdict");
    expect(text).not.toContain("AI verdict is advisory; final exchange decision is policy-owned.");
    expect(text).toContain("59/100");
    expect(text).toContain("Matrix row: contract_suspicion; matrix decision: REVIEW.");
    expect(text).not.toContain("TWrapp...1111");
  });

  it("formats normal deep completion as context-ready without standalone behavior risk", () => {
    const message = formatDeepForensicContextReadyReport(
      whereIsMoneyJobForTest({
        id: "deep-job-context-ready",
        kind: "address_deep_check",
        progressJson: { locale: "en" }
      }),
      deepReportForTest({
        addressBehaviorProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "100000000000",
            outgoingVolumeRaw: "95000000000",
            incomingTxCount: 1,
            outgoingTxCount: 1,
            uniqueIncomingCounterparties: 1,
            uniqueOutgoingCounterparties: 1,
            largestIncomingRaw: "100000000000",
            largestOutgoingRaw: "95000000000",
            topOutgoingCounterpartyAddress: secondWalletAddress,
            topOutgoingCounterpartyRaw: "95000000000",
            topOutgoingCounterpartyTxCount: 1,
            topOutgoingCounterpartyRatio: 1,
            inflowToOutflowRatio: 0.95,
            drainToServiceRatio: 0,
            timeToFirstOutgoingMs: 30 * 60 * 1000,
            timeToFirstServiceExitMs: null,
            depositThenDrainScore: 80,
            transitScore: 0,
            dampenerScore: 0,
            features: []
          }
        ]
      }),
      "completed",
      { locale: "en", runtimeLabel: "worker-a" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address behavior — context ready");
    expect(text).toContain("Final risk will be shown after provenance analysis.");
    expect(text).toContain("Runtime: worker-a");
    expect(text).not.toContain("Behavior risk");
    expect(text).not.toContain("Риск поведения");
    expect(text).not.toContain("80/100");
    expect(text).not.toMatch(/\d+\/100/);
  });

  it("keeps standalone deep details available through the support formatter", () => {
    const message = formatDeepForensicSupportReport(
      whereIsMoneyJobForTest({
        id: "deep-job-support",
        kind: "address_deep_check",
        progressJson: { fastRiskSnapshot: { score: 12, level: "LOW" } }
      }),
      deepReportForTest({
        approvalDrainProvenanceProfiles: [
          {
            victimAddress: "TVictim111111111111111111111111111111",
            approvalTxHash: "tx-approval-root-cause",
            drainTxHash: "tx-transferfrom-drain",
            spenderAddress: "TSpender11111111111111111111111111111",
            firstReceiverAddress: secondWalletAddress,
            subjectAddress: walletAddress,
            hopDepth: 1,
            amountRaw: "309000000000",
            amountPreservationRatio: 0.991,
            approvalAt: "2026-05-20T09:50:00.000Z",
            drainAt: "2026-05-20T10:00:00.000Z",
            pathTxHashes: ["tx-transferfrom-drain", "tx-hop-subject"],
            pathAddresses: [
              "TVictim111111111111111111111111111111",
              secondWalletAddress,
              walletAddress
            ],
            score: 80,
            evidenceStrength: "route_linked",
            subjectTokenState: {
              address: walletAddress,
              balanceRaw: "2200000000",
              isBlacklisted: false,
              blockedBalanceRaw: null,
              checkedAt: "2026-05-20T10:00:00.000Z"
            },
            victimTokenState: {
              address: "TVictim111111111111111111111111111111",
              balanceRaw: "1500000000",
              isBlacklisted: false,
              blockedBalanceRaw: null,
              checkedAt: "2026-05-20T10:00:00.000Z"
            },
            features: []
          }
        ],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 1,
          transferEdges: 2
        }
      }),
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Deep research — support/debug");
    expect(text).toContain("Job: deep-job-support");
    expect(text).toContain("Risk delta: risk increased");
    expect(text).toContain("Previous fast risk:");
    expect(text).toContain("12/100 (LOW)");
    expect(text).toContain("Taint evidence");
    expect(text).toContain("Behavior risk:");
    expect(text).toContain("80/100");
    expect(text).toContain("New deep finding: exact approval-drain provenance found.");
    expect(text).toContain("approval tx-app...ause was followed by transferFrom drain tx-tra...rain");
    expect(text).toContain("Approval tx: tx-app...ause; drain tx: tx-tra...rain");
    expect(text).toContain("Tx evidence: tx-tra...rain -> tx-hop-subject");
    expect(text).toContain("Subject USDT: 2200");
    expect(text).toContain("Victim USDT: 1500");
    expect(text).toContain("Coverage and limits");
    expect(text).toContain("2 transfer edges scanned; 1 inbound senders checked.");
  });

  it("keeps where-is-money details available through the support formatter", () => {
    const report = whereIsMoneyReportForTest({
      riskScore: 25,
      decisionReasons: [
        "Operational liquidity behavior is consistent with repeated legitimate counterparties.",
        "No deterministic bad evidence was found."
      ],
      coverage: {
        selectedInboundTxCount: 32,
        selectedInboundVolumeRaw: "840313000000",
        currentBalanceCoverageRatio: 0.9533,
        coverageRatio: 0.9533,
        maxDepth: 20,
        fetchedAddressCount: 19,
        partial: true,
        notes: ["Coverage is limited."]
      },
      assessment: {
        ...whereAssessmentForTest({ riskScore: 25 }),
        provenanceConfidence: 41,
        coverageCompleteness: 39,
        walletRole: "operational_liquidity_wallet",
        operationalLiquidityScore: 84
      }
    });

    const message = formatWhereIsMoneySupportReport(
      whereIsMoneyJobForTest({ id: "where-job-support" }),
      report,
      "partial",
      { locale: "en", runtimeLabel: "worker-a" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Where-is-money — support/debug");
    expect(text).toContain("Job: where-job-support");
    expect(text).toContain("Address:");
    expect(text).toContain(walletAddress);
    expect(text).toContain("Status: partial");
    expect(text).toContain("Selected inbound transfers: 32");
    expect(text).toContain("Coverage: 95%");
    expect(text).toContain("Fetched addresses: 19");
    expect(text).toContain("Operational liquidity behavior");
    expect(text).toContain("Runtime: worker-a");
  });

  it("shows scoped where-is-money coverage in the support formatter", () => {
    const report = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 2,
        selectedInboundVolumeRaw: "200000000",
        currentBalanceCoverageRatio: 0,
        coverageRatio: 0.4,
        checkedScope: "drain_episode",
        anchorCoverageRatio: 0.4,
        episodeCoverageRatio: 0.25,
        drainEpisode: {
          anchorTxHash: "anchor-135k",
          startTimestamp: "2026-05-05T13:57:27.000Z",
          endTimestamp: "2026-05-05T15:00:30.000Z",
          episodeOutgoingRaw: "800000000",
          episodeSelectedRaw: "200000000",
          episodeCoverageRatio: 0.25,
          outgoingTxHashes: ["out-1", "anchor-135k"],
          bridgeOutgoingRaw: "800000000",
          bridgeOutgoingShare: 1
        },
        maxDepth: 20,
        fetchedAddressCount: 9,
        partial: true,
        notes: []
      }
    });

    const message = formatWhereIsMoneySupportReport(
      whereIsMoneyJobForTest({ id: "where-job-support-scoped" }),
      report,
      "partial",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Coverage: 40%");
    expect(text).toContain("Checked scope: drain_episode");
    expect(text).toContain("Anchor coverage: 40%");
    expect(text).toContain("Episode coverage: 25%");
  });

  it("uses a finite fallback coverage ratio in where-is-money support output", () => {
    const report = whereIsMoneyReportForTest({
      coverage: {
        selectedInboundTxCount: 1,
        selectedInboundVolumeRaw: "1000000",
        coverageRatio: "bad" as unknown as number,
        currentBalanceCoverageRatio: 1,
        maxDepth: 7,
        fetchedAddressCount: 1,
        partial: false,
        notes: []
      }
    });

    const message = formatWhereIsMoneySupportReport(
      whereIsMoneyJobForTest(),
      report,
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Coverage: 100%");
    expect(text).not.toContain("NaN%");
  });

  it("formats compact Russian deep result summary", () => {
    const message = formatDeepForensicReport(
      whereIsMoneyJobForTest({
        id: "deep-job-test",
        kind: "address_deep_check",
        progressJson: { locale: "ru" }
      }),
      deepReportForTest(),
      "completed",
      { locale: "ru" }
    );

    expect(message.text).toContain("Поведение адреса — контекст");
    expect(message.text).toContain("Это контекст поведения, не доказательство скама");
    expect(message.text).toContain("Решение по обмену берём из “Откуда деньги”");
    expect(message.text).not.toContain("Технические детали");
  });

  it("formats exact Russian deep evidence summary without behavior-context disclaimer", () => {
    const message = formatDeepForensicReport(
      whereIsMoneyJobForTest({
        id: "deep-job-exact-ru",
        kind: "address_deep_check",
        progressJson: { locale: "ru", fastRiskSnapshot: { score: 0, level: "LOW" } }
      }),
      deepReportForTest({
        stablecoinRestrictionProfiles: [stablecoinRestrictionProfile()],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 0,
          transferEdges: 0
        }
      }),
      "completed",
      { locale: "ru" }
    );

    expect(message.text).toContain("Найдено точное on-chain доказательство риска.");
    expect(message.text).toContain("Решение по обмену берём из “Откуда деньги”, но этот сигнал повышает срочность проверки.");
    expect(message.text).not.toContain("Это контекст поведения, не доказательство скама.");
  });

  it("keeps route-linked approval provenance as behavior context in compact deep summaries", () => {
    const message = formatDeepForensicReport(
      whereIsMoneyJobForTest({
        id: "deep-job-route-linked-ru",
        kind: "address_deep_check",
        progressJson: { locale: "ru", fastRiskSnapshot: { score: 0, level: "LOW" } }
      }),
      deepReportForTest({
        approvalDrainProvenanceProfiles: [
          {
            victimAddress: "TVictim111111111111111111111111111111",
            approvalTxHash: "tx-approval-root-cause",
            drainTxHash: "tx-transferfrom-drain",
            spenderAddress: "TSpender11111111111111111111111111111",
            firstReceiverAddress: secondWalletAddress,
            subjectAddress: walletAddress,
            hopDepth: 1,
            amountRaw: "309000000000",
            amountPreservationRatio: 0.991,
            approvalAt: "2026-05-20T09:50:00.000Z",
            drainAt: "2026-05-20T10:00:00.000Z",
            pathTxHashes: ["tx-transferfrom-drain", "tx-hop-subject"],
            pathAddresses: [
              "TVictim111111111111111111111111111111",
              secondWalletAddress,
              walletAddress
            ],
            score: 80,
            evidenceStrength: "route_linked",
            subjectTokenState: {
              address: walletAddress,
              balanceRaw: "2200000000",
              isBlacklisted: false,
              blockedBalanceRaw: null,
              checkedAt: "2026-05-20T10:00:00.000Z"
            },
            victimTokenState: {
              address: "TVictim111111111111111111111111111111",
              balanceRaw: "1500000000",
              isBlacklisted: false,
              blockedBalanceRaw: null,
              checkedAt: "2026-05-20T10:00:00.000Z"
            },
            features: []
          }
        ],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 1,
          transferEdges: 2
        }
      }),
      "completed",
      { locale: "ru" }
    );

    expect(message.text).toContain("Это контекст поведения, не доказательство скама.");
    expect(message.text).not.toContain("Найдено точное on-chain доказательство риска.");
  });

  it("formats deep darknet exchange provenance without proof wording", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-1",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: {},
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "95000000000",
            matchedInboundVolumeRaw: "95000000000",
            score: 45,
            boundaryNotes: [],
            features: [],
            paths: [
              {
                depth: 2,
                sourceAddress: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
                viaAddresses: ["TTransit111111111111111111111111111111"],
                label: "darknet_exchange" as any,
                amountRaw: "95000000000",
                amountPreservationRatio: 0.95,
                firstTransferAt: "2026-05-20T09:55:00.000Z",
                lastTransferAt: "2026-05-20T10:00:00.000Z",
                txHashes: ["tx-seed-hop", "tx-hop-subject"]
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 1,
          transferEdges: 2
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address behavior — context");
    expect(text).toContain("Behavior risk: 🟡 40/100 (MEDIUM, beta)");
    expect(text).not.toContain("Previous fast risk");
    expect(text).toContain("New deep finding: confirmed 2-hop exposure to known darknet exchange seed.");
    expect(text).toContain("Main signal");
    expect(text).toContain("Signals");
    expect(text).not.toContain("Most important evidence");
    expect(text).not.toContain("Score: 45/50");
    expect(text).not.toContain("Score: 30/30");
    expect(text).not.toContain("fraud proven");
    expect(text).not.toContain("this wallet is the exchange");
  });

  it("formats direct high-risk counterparty exposure as the main deep finding", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-counterparty",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [
          {
            subjectAddress: walletAddress,
            direction: "outbound",
            counterpartyAddress: secondWalletAddress,
            label: "darknet_exchange_proximity" as any,
            serviceCategory: null,
            identity: null,
            amountRaw: "120000000000",
            txCount: 1,
            volumeRatio: 1,
            firstTransferAt: "2026-05-20T10:00:00.000Z",
            lastTransferAt: "2026-05-20T10:00:00.000Z",
            txHashes: ["tx-subject-counterparty"],
            score: 80,
            features: []
          }
        ],
        approvalDrainProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 0,
          transferEdges: 1
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("risk increased");
    expect(text).toContain("60/100 (HIGH, beta)");
    expect(text).toContain("New deep finding: direct exposure to a high-risk counterparty.");
    expect(text).toContain("high-risk counterparty label");
    expect(text).not.toContain("Tx evidence");
    expect(text).not.toContain("fraud proven");
  });

  it("formats dominant counterparty fast snapshot as high context without claiming exact taint", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-counterparty-snapshot",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            subjectAddress: walletAddress,
            direction: "inbound",
            counterpartyAddress: secondWalletAddress,
            volumeRaw: "800000000000",
            volumeRatio: 0.8,
            txCount: 2,
            firstSeen: "2026-05-20T10:00:00.000Z",
            lastSeen: "2026-05-20T10:02:00.000Z",
            txHashes: ["tx-counterparty-subject-1", "tx-counterparty-subject-2"],
            serviceCategory: null,
            identity: null,
            snapshot: {
              address: secondWalletAddress,
              riskScore: 75,
              riskLevel: "HIGH",
              source: "fast_address_check",
              evidenceClass: "counterparty_behavior_context",
              reasons: ["counterparty fast check found behavior context"],
              partialNotes: []
            },
            interactionWeight: 0.9,
            scoreContribution: 65,
            evidenceClass: "counterparty_behavior_context",
            skippedReason: null
          }
        ],
        approvalDrainProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 0,
          transferEdges: 3
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("risk increased");
    expect(text).toContain("Behavior risk:");
    expect(text).toContain("60/100 (HIGH, beta)");
    expect(text).toContain("New deep finding: major direct counterparty has high fast forensic risk.");
    expect(text).toContain("75/100 (HIGH)");
    expect(text).toContain("not exact taint proof");
    expect(text).not.toContain("fraud proven");
    expect(text).not.toContain("internal_label_darknet_exchange_proximity");
  });

  it("formats approval-drain provenance with normalized /100 scores and token state", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-approval-drain",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [
          {
            victimAddress: "TVictim111111111111111111111111111111",
            approvalTxHash: "tx-approval-root-cause",
            drainTxHash: "tx-transferfrom-drain",
            spenderAddress: "TSpender11111111111111111111111111111",
            firstReceiverAddress: secondWalletAddress,
            subjectAddress: walletAddress,
            hopDepth: 1,
            amountRaw: "309000000000",
            amountPreservationRatio: 0.991,
            approvalAt: "2026-05-20T09:50:00.000Z",
            drainAt: "2026-05-20T10:00:00.000Z",
            pathTxHashes: ["tx-transferfrom-drain", "tx-hop-subject"],
            pathAddresses: [
              "TVictim111111111111111111111111111111",
              secondWalletAddress,
              walletAddress
            ],
            score: 80,
            evidenceStrength: "route_linked",
            subjectTokenState: {
              address: walletAddress,
              balanceRaw: "2200000000",
              isBlacklisted: false,
              blockedBalanceRaw: null,
              checkedAt: "2026-05-20T10:00:00.000Z"
            },
            victimTokenState: {
              address: "TVictim111111111111111111111111111111",
              balanceRaw: "1500000000",
              isBlacklisted: false,
              blockedBalanceRaw: null,
              checkedAt: "2026-05-20T10:00:00.000Z"
            },
            features: []
          }
        ],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 1,
          transferEdges: 2
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("risk increased");
    expect(text).toContain("Behavior risk: 🟠 80/100 (HIGH, beta)");
    expect(text).toContain("New deep finding: exact approval-drain provenance found.");
    expect(text).toContain("approval tx-app...ause was followed by transferFrom drain tx-tra...rain");
    expect(text).not.toContain("Subject USDT");
    expect(text).not.toContain("Victim USDT");
    expect(text).not.toContain("Score:");
    expect(text).not.toContain("/50");
    expect(text).not.toContain("/30");
    expect(text).not.toContain("fraud proven");
  });

  it("formats stablecoin blacklist state as exact evidence in deep reports", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-blacklist",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 12, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [
          {
            id: "raw-stablecoin",
            source: "stablecoin_contract",
            sourceType: "provider_response",
            chain: "tron",
            address: walletAddress,
            txHash: null,
            observedTransactionHash: null,
            evidenceJson: {
              stablecoinRestrictionProfile: stablecoinRestrictionProfile()
            }
          }
        ],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        stablecoinRestrictionProfiles: [stablecoinRestrictionProfile()],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 0,
          transferEdges: 0
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("risk increased");
    expect(text).toContain("90/100 (CRITICAL, beta)");
    expect(text).toContain("Exact on-chain risk evidence was found.");
    expect(text).toContain("Use “Where is money” as the primary exchange decision, but this signal raises review urgency.");
    expect(text).toContain("Exact token-contract evidence");
    expect(text).toContain("USDT blacklist: active");
    expect(text).toContain("New deep finding: official TRON USDT blacklist state is active.");
    expect(text).toContain("Deep analysis confirmed active TRON USDT blacklist state directly from the token contract.");
    expect(text).toContain("Blacklist event: tx-blacklist");
    expect(text).not.toContain("This is behavior context, not scam proof.");
    expect(text).not.toContain("fraud proven");
  });

  it("formats clean zero-score deep results without claiming behavior context", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-clean",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "4982000000",
            outgoingVolumeRaw: "0",
            incomingTxCount: 3,
            outgoingTxCount: 0,
            uniqueIncomingCounterparties: 3,
            uniqueOutgoingCounterparties: 0,
            largestIncomingRaw: "2000000000",
            largestOutgoingRaw: null,
            topOutgoingCounterpartyAddress: null,
            topOutgoingCounterpartyRaw: null,
            topOutgoingCounterpartyTxCount: 0,
            topOutgoingCounterpartyRatio: 0,
            inflowToOutflowRatio: 0,
            drainToServiceRatio: 0,
            timeToFirstOutgoingMs: null,
            timeToFirstServiceExitMs: null,
            depositThenDrainScore: 0,
            transitScore: 0,
            dampenerScore: 0,
            features: []
          }
        ],
        inboundProvenanceProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "4982000000",
            matchedInboundVolumeRaw: "0",
            score: 0,
            boundaryNotes: [],
            features: [],
            paths: []
          }
        ],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 3,
          transferEdges: 7
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("0/100 (LOW, beta)");
    expect(text).toContain("Deep analysis did not find additional risk signals in the collected evidence.");
    expect(text).not.toContain("address behavior context confirmed");
  });

  it("shows a partial service exposure note without increasing score when exposure fails", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [],
        missingChecks: ["Service exposure check incomplete: rate limited"]
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address check \u2014 started");
    expect(text).toContain("Final risk appears after provenance analysis.");
    expect(text).not.toContain("Address risk:");
    expect(text).not.toContain("0/100");
    expect(text).not.toContain("Limits");
    expect(text).not.toContain("Some provider checks were incomplete; review coverage before treating this as final.");
    expect(text).not.toContain("fraud proven");
  });

  it("shows only a partial note for zero-score exposure profiles with missing checks", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [
          {
            subjectAddress: walletAddress,
            totalOutgoingRaw: "0",
            totalOutgoingCount: 0,
            directServiceVolumeRatio: 0,
            directServiceTxRatio: 0,
            indirectServiceVolumeRatio: 0,
            indirectServiceTxRatio: 0,
            mergedServiceVolumeRatio: 0,
            mergedServiceGroupCount: 0,
            combinedServiceVolumeRatio: 0,
            combinedServiceTxRatio: 0,
            dominantCategory: null,
            categoryBreakdown: [],
            topServiceCounterparties: [],
            topMergedServiceFlows: [],
            fastestServiceExitMs: null,
            bestAmountPreservationRatio: null,
            exposureScore: 0,
            features: []
          }
        ],
        missingChecks: ["Service exposure check incomplete: timed out after 10000ms"]
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address check \u2014 started");
    expect(text).toContain("Final risk appears after provenance analysis.");
    expect(text).not.toContain("Limits");
    expect(text).not.toContain("Some provider checks were incomplete; review coverage before treating this as final.");
    expect(text).not.toContain("Service exposure candidate; manual review required.");
    expect(text).not.toContain("Funds reached service/CEX/bridge boundary");
  });

  it("summarizes unknown-contract exposure without calling it a service/CEX/bridge boundary", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [
          {
            code: "forensic_service_exposure",
            message: "Service exposure candidate; manual review required.",
            scoreImpact: 20,
            source: "forensic_route_search",
            confidence: "medium",
            severity: "medium"
          }
        ],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [
          {
            subjectAddress: walletAddress,
            totalOutgoingRaw: "100000000",
            totalOutgoingCount: 1,
            directServiceVolumeRatio: 1,
            directServiceTxRatio: 1,
            indirectServiceVolumeRatio: 0,
            indirectServiceTxRatio: 0,
            mergedServiceVolumeRatio: 0,
            mergedServiceGroupCount: 0,
            combinedServiceVolumeRatio: 1,
            combinedServiceTxRatio: 1,
            dominantCategory: "unknown_contract",
            categoryBreakdown: [],
            topServiceCounterparties: [
              {
                address: "TUnknown1111111111111111111111111111",
                category: "unknown_contract",
                identity: null,
                volumeRaw: "100000000",
                txCount: 1
              }
            ],
            topMergedServiceFlows: [],
            fastestServiceExitMs: null,
            bestAmountPreservationRatio: null,
            exposureScore: 20,
            features: []
          }
        ],
        missingChecks: []
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address check \u2014 started");
    expect(text).not.toContain("Outgoing USDT reaches service, router, CEX, bridge, or contract infrastructure. Manual review is recommended.");
    expect(text).not.toContain("Funds reached service/CEX/bridge boundary");
  });

  it("shows boundary exposure and wallet role context for address checks", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [
          {
            code: "forensic_boundary_exposure_context",
            message: "Service-boundary exposure context; manual review required.",
            scoreImpact: 15,
            source: "forensic_route_search",
            confidence: "medium",
            severity: "medium"
          }
        ],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        boundaryExposureProfiles: [boundaryExposureProfile()],
        walletRoleProfiles: [walletRoleProfile()],
        missingChecks: []
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address check \u2014 started");
    expect(text).not.toContain("Funds touch service-boundary infrastructure where public-chain continuity becomes limited. This is context for manual review, not proof of wrongdoing.");
    expect(text).not.toContain("Key signals");
    expect(text).not.toContain("fraud proven");
  });

  it("formats operational laundering pattern separately from taint evidence in deep reports", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-operational-flow",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "100000000000",
            outgoingVolumeRaw: "97000000000",
            incomingTxCount: 1,
            outgoingTxCount: 3,
            uniqueIncomingCounterparties: 1,
            uniqueOutgoingCounterparties: 2,
            largestIncomingRaw: "100000000000",
            largestOutgoingRaw: "60000000000",
            topOutgoingCounterpartyAddress: "THTX11111111111111111111111111111111",
            topOutgoingCounterpartyRaw: "60000000000",
            topOutgoingCounterpartyTxCount: 1,
            topOutgoingCounterpartyRatio: 0.6,
            inflowToOutflowRatio: 0.97,
            drainToServiceRatio: 0.97,
            timeToFirstOutgoingMs: 9 * 60 * 1000,
            timeToFirstServiceExitMs: 14 * 60 * 1000,
            depositThenDrainScore: 30,
            transitScore: 0,
            dampenerScore: 0,
            features: [
              {
                code: "address_behavior_deposit_then_drain",
                label: "Rapid transit-like USDT movement toward terminal liquidity.",
                scoreImpact: 30,
                value: 0.97
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        operationalFlowProfiles: [operationalFlowProfile()],
        walletRoleProfiles: [],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 0,
          transferEdges: 4
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Behavior risk:");
    expect(text).toContain("HTX/Huobi");
    expect(text).toContain("Terminal liquidity outgoing");
    expect(text).toContain("not a blacklist/scam claim");
    expect(text).not.toMatch(/black wallet|scam wallet|confirmed scam/i);
  });

  it("formats boundary exposure and wallet role context in deep reports", () => {
    const message = formatDeepForensicReport(
      {
        id: "deep-job-boundary-role",
        kind: "address_deep_check",
        subjectAddress: walletAddress,
        status: "completed",
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        priority: 100,
        chatId: "42",
        messageId: null,
        requestedBy: "42",
        progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" } },
        resultJson: {},
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null,
        createdAt: new Date("2026-05-24T00:00:00.000Z"),
        updatedAt: new Date("2026-05-24T00:00:00.000Z"),
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        completedAt: new Date("2026-05-24T00:01:00.000Z")
      },
      {
        subjectAddress: walletAddress,
        windowStart: new Date("2026-04-24T00:00:00.000Z"),
        windowEnd: new Date("2026-05-24T00:00:00.000Z"),
        ...deepReportRuntimeMetadataForTest(),
        rawEvidence: [],
        observations: [],
        missingChecks: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        boundaryExposureProfiles: [boundaryExposureProfile()],
        walletRoleProfiles: [walletRoleProfile()],
        coverage: {
          sourceTransferPages: 1,
          inboundSendersExpanded: 0,
          transferEdges: 4
        },
        coverageDebug: emptyCoverageDebug()
      },
      "completed",
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Address behavior — context");
    expect(text).toContain("New deep finding: service-boundary exposure and wallet-role context found.");
    expect(text).toContain("Deep analysis found service-boundary exposure and classified the likely wallet role as mule.");
    expect(text).toContain("15/100 (LOW, beta)");
    expect(text).toContain("Boundary route preservation is 100%");
    expect(text).not.toContain("Tx evidence");
    expect(text).not.toContain("fraud proven");
  });

  it("shows cautious address behavior context for deposit-then-drain checks", async () => {
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => ({
        graphSignals: [
          {
            code: "forensic_address_behavior",
            message: "Large incoming USDT amount was rapidly redistributed into service infrastructure; manual review required.",
            scoreImpact: 30,
            source: "forensic_route_search",
            confidence: "high",
            severity: "medium",
            evidenceRef: "raw_behavior_1"
          }
        ],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [],
        observations: [],
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [
          {
            subjectAddress: walletAddress,
            incomingVolumeRaw: "1000000000000",
            outgoingVolumeRaw: "950000000000",
            incomingTxCount: 1,
            outgoingTxCount: 2,
            uniqueIncomingCounterparties: 1,
            uniqueOutgoingCounterparties: 1,
            largestIncomingRaw: "1000000000000",
            largestOutgoingRaw: "600000000000",
            topOutgoingCounterpartyAddress: "TService11111111111111111111111111111",
            topOutgoingCounterpartyRaw: "950000000000",
            topOutgoingCounterpartyTxCount: 2,
            topOutgoingCounterpartyRatio: 1,
            inflowToOutflowRatio: 0.95,
            drainToServiceRatio: 0.95,
            timeToFirstOutgoingMs: 12 * 60 * 1000,
            timeToFirstServiceExitMs: 27 * 60 * 1000,
            depositThenDrainScore: 50,
            transitScore: 0,
            dampenerScore: 0,
            features: [
              {
                code: "address_behavior_deposit_then_drain",
                label: "Large incoming USDT amount was rapidly redistributed into service infrastructure; manual review required.",
                scoreImpact: 15
              }
            ]
          }
        ],
        missingChecks: []
      })
    });

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    const text = lastPlainText(calls);
    expect(text).toContain("Address check \u2014 started");
    expect(text).toContain("Final risk appears after provenance analysis.");
    expect(text).not.toContain("The address shows rapid transit-like USDT movement.");
    expect(text).not.toContain("60/100");
    expect(text).not.toContain("Key signals");
    expect(text).not.toContain("Score: 30/30");
    expect(text).not.toContain("fraud proven");
  });

  it("keeps button-driven check address separate from wallet monitoring", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    expect(buttonTexts(lastMessagePayload(calls))).not.toContain("Deep cross-chain");
    await bot.handleUpdate(messageUpdate(walletAddress, userId));
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Address check started");
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Address: ${walletAddress}`)));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(messageCalls(calls)[0].payload.text).toContain("check risk and trace the origin of funds");
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain(`Address: ${walletAddress}`);
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).not.toContain("Address risk");
    expect(lastPlainText(calls)).toContain("No watched wallets yet.");
  });

  it("does not let a slow button-driven address check block /start", async () => {
    let resolveSignals: (signals: any) => void = () => undefined;
    const { bot, calls } = await createSmokeBot({
      addressRiskSignals: async () => new Promise((resolve) => {
        resolveSignals = resolve;
      })
    });

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));
    expect(lastPlainText(calls)).toContain("Address check started");

    await bot.handleUpdate(messageUpdate("/start", userId));
    expect(lastPlainText(calls)).toContain("Monitors incoming USDT");
    expect(lastPlainText(calls)).toContain("Watched wallets: 0");

    resolveSignals({ graphSignals: [], behaviorSignals: [], amlSignals: [] });
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Address: ${walletAddress}`)));
  });

  it("clears a stale pending action when the user navigates through /wallets", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));

    expect(lastPlainText(calls)).toContain("Monitoring: active");
  });

  it("clears a stale pending action when the user opens a wallet callback", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const viewCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(callbackQueryUpdate(viewCallback, userId));
    await bot.handleUpdate(messageUpdate(secondWalletAddress, userId));

    expect(lastPlainText(calls)).toContain("Monitoring: active");
    await bot.handleUpdate(messageUpdate("/wallets", userId));
    expect(lastPlainText(calls)).toContain("Watched wallets: 2");
  });

  it("supports button-driven add wallet and analytics callbacks", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("wl:add", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));
    const analyticsCallback = findCallbackData(lastMessagePayload(calls), "wl:analytics:");

    await bot.handleUpdate(callbackQueryUpdate(analyticsCallback, userId));

    expect(messageCalls(calls)[0].payload.text).toContain("TRON wallet address");
    expect(plainTelegramText(String(messageCalls(calls)[1].payload.text))).toContain("Monitoring: active");
    expect(lastText(calls)).toContain("Wallet analytics");
    expect(lastPlainText(calls)).toContain("Transfers: 2");
  });

  it("shows risk intelligence details and removes a wallet only after confirmation", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const dashboardPayload = lastMessagePayload(calls);
    const walletId = findCallbackData(dashboardPayload, "wl:refresh:").replace("wl:refresh:", "");
    const riskCallback = `wl:risk:${walletId}`;
    const safetyCallback = findCallbackData(dashboardPayload, "wl:safety:");
    const removeCallback = findCallbackData(dashboardPayload, "wl:remove:");

    await bot.handleUpdate(callbackQueryUpdate(riskCallback, userId));
    expect(lastText(calls)).toContain("🛡 Risk intelligence");
    expect(lastText(calls)).toContain("Internal labels: active");
    expect(lastText(calls)).toContain("AML providers: not connected");
    expect(lastText(calls)).toContain("Hop1/Hop2 graph: planned");
    expect(lastText(calls)).toContain("Approvals/security: limited");
    expect(lastText(calls)).toContain("Case forensics: planned");

    await bot.handleUpdate(callbackQueryUpdate(safetyCallback, userId));
    expect(lastText(calls)).toContain("Wallet safety");
    expect(lastPlainText(calls)).toContain("USDT approvals: 0");
    expect(lastText(calls)).toContain("Bot is read-only");
    expect(JSON.stringify(lastMessagePayload(calls).reply_markup?.inline_keyboard)).toContain(
      tronscanApprovalsUrl(walletAddress)
    );

    await bot.handleUpdate(callbackQueryUpdate(removeCallback, userId));
    const confirmCallback = findCallbackData(lastMessagePayload(calls), "wl:remove_yes:");
    expect(lastPlainText(calls)).toContain("Stop monitoring for");

    await bot.handleUpdate(callbackQueryUpdate(confirmCallback, userId));
    expect(lastPlainText(calls)).toContain("No watched wallets yet.");
  });

  it("keeps the legacy security callback as an alias for risk intelligence", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/add_wallet ${walletAddress}`, userId));
    const refreshCallback = findCallbackData(lastMessagePayload(calls), "wl:refresh:");
    const walletId = refreshCallback.replace("wl:refresh:", "");

    await bot.handleUpdate(callbackQueryUpdate(`wl:security:${walletId}`, userId));

    expect(lastText(calls)).toContain("🛡 Risk intelligence");
  });

  it("rejects /mark for non-admin users", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} scam`, userId));

    expect(lastText(calls)).toBe("This command is restricted to service admins.");
  });

  it("accepts /mark for configured service admins", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} scam`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(messageCalls(calls)[0].payload.text).toBe(`Marked ${walletAddress} as scam.`);
    expect(lastPlainText(calls)).toContain("Address risk: 🔴 90/100 (CRITICAL, beta)");
  });

  it("lists and accepts manually confirmed darknet exchange labels as hard evidence", async () => {
    const { bot, calls } = await createSmokeBot();
    const seed = "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV";

    await bot.handleUpdate(messageUpdate("/labels", adminId));
    expect(lastPlainText(calls)).toContain("- darknet_exchange");

    await bot.handleUpdate(messageUpdate(`/mark ${seed} darknet_exchange`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${seed}`, userId));

    expect(messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Marked ${seed} as darknet_exchange.`))).toBe(true);
    expect(lastPlainText(calls)).not.toContain("Address check \u2014 started");
    expect(lastPlainText(calls)).toContain("90/100 (CRITICAL, beta)");
    expect(lastPlainText(calls)).toContain("Connected risk modules found review-worthy signals. Manual review is recommended.");
  });

  it("lists and accepts WhiteBIT high-risk labels as hard evidence", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/labels", adminId));
    expect(lastPlainText(calls)).toContain("- whitebit");

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} whitebit`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Marked ${walletAddress} as whitebit.`))).toBe(true);
    expect(lastPlainText(calls)).not.toContain("Address check \u2014 started");
    expect(lastPlainText(calls)).toContain("90/100 (CRITICAL, beta)");
    expect(lastPlainText(calls)).toContain("Connected risk modules found review-worthy signals. Manual review is recommended.");
  });

  it("checks a transaction hash through the button-driven pending action", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:tx", userId));
    await bot.handleUpdate(messageUpdate(txHash, userId));

    expect(lastPlainText(calls)).toContain(`Subject: ${secondWalletAddress}`);
    expect(lastPlainText(calls)).toContain("Address risk: 🟢 0/100 (LOW, beta)");
  });

  it("creates a theft report draft and marks labels only after deposit confirmation", async () => {
    const tronClient: TronDashboardClient = {
      ...createTronClient(),
      async getTransaction() {
        return {
          confirmed: true,
          trc20TransferInfo: [
            {
              transaction_id: txHash,
              from_address: walletAddress,
              to_address: secondWalletAddress,
              quant: "12500000",
              block_ts: 1_778_880_000_000,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              confirmed: true,
              contractRet: "SUCCESS"
            }
          ]
        };
      }
    };
    const { bot, calls } = await createSmokeBot({ tronClient });

    await bot.handleUpdate(callbackQueryUpdate("theft:start", userId));

    expect(lastPlainText(calls)).toContain("Report theft");
    expect(lastPlainText(calls)).toContain("transaction hash");

    await bot.handleUpdate(messageUpdate(txHash, userId));

    expect(lastPlainText(calls)).toContain("Theft report");
    expect(lastPlainText(calls)).toContain(walletAddress);
    expect(lastPlainText(calls)).toContain(secondWalletAddress);
    expect(lastPlainText(calls)).toContain("12.5 USDT");
    expect(lastPlainText(calls)).toContain("Comment: not set");

    const commentCallback = findCallbackData(lastMessagePayload(calls), "theft:comment:");
    await bot.handleUpdate(callbackQueryUpdate(commentCallback, userId));
    await bot.handleUpdate(messageUpdate("Stolen after phishing link", userId));
    expect(lastPlainText(calls)).toContain("Stolen after phishing link");

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
    expect(lastPlainText(calls)).toContain("Address check — started");
    expect(lastPlainText(calls)).not.toContain("90/100 (CRITICAL, beta)");

    await bot.handleUpdate(messageUpdate(`/check ${secondWalletAddress}`, userId));
    expect(lastPlainText(calls)).toContain("Address check — started");
    expect(lastPlainText(calls)).not.toContain("90/100 (CRITICAL, beta)");

    await bot.handleUpdate(callbackQueryUpdate(commentCallback.replace("comment", "confirm"), userId));
    expect(lastPlainText(calls)).toContain("Deposit required");
    expect(lastPlainText(calls)).toContain("1000 USDT");

    const sentCallback = findCallbackData(lastMessagePayload(calls), "theft:deposit_sent:");
    await bot.handleUpdate(callbackQueryUpdate(sentCallback, userId));
    expect(lastPlainText(calls)).toContain("Report accepted");
    expect(lastPlainText(calls)).toContain("reported_scam");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("📘 Guide");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("👤 Contact admin");
    const guideCallback = findCallbackData(lastMessagePayload(calls), "theft:guide:");

    await bot.handleUpdate(messageUpdate("/profile", userId));
    expect(lastPlainText(calls)).toContain("Theft reports: 1");
    expect(lastPlainText(calls)).toContain("Latest theft report");
    expect(lastPlainText(calls)).toContain("Status: documents_requested");
    expect(lastPlainText(calls)).toContain(`${secondWalletAddress}`);
    expect(lastPlainText(calls)).toContain("12.5 USDT");

    await bot.handleUpdate(callbackQueryUpdate(guideCallback, userId));
    expect(lastPlainText(calls)).toContain("Theft report guide");

    await bot.handleUpdate(callbackQueryUpdate(sentCallback, userId));
    const adminCallback = findCallbackData(lastMessagePayload(calls), "theft:admin:");
    await bot.handleUpdate(callbackQueryUpdate(adminCallback, userId));
    expect(lastPlainText(calls)).toContain("report ID");

    await bot.handleUpdate(messageUpdate(`/check ${secondWalletAddress}`, userId));
    expect(lastPlainText(calls)).toContain("Address risk: 🔴 90/100 (CRITICAL, beta)");

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));
    expect(lastPlainText(calls)).toContain("Address check — started");
    expect(lastPlainText(calls)).not.toContain("90/100 (CRITICAL, beta)");
  });

  it("checks a sender from an alert callback without adding it as a wallet", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate(`check:addr:${walletAddress}`, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain(
      `Address: ${walletAddress}`
    );
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).not.toContain("Address risk");
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).not.toContain("0/100");
    expect(lastPlainText(calls)).toContain("No watched wallets yet.");
  });

  it("manages customer alert admins through commands", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/alert_add abc", userId));
    expect(lastText(calls)).toContain("Send a numeric Telegram ID");

    await bot.handleUpdate(messageUpdate(`/alert_add ${userId} all`, userId));
    expect(lastText(calls)).toContain("You already receive owner alerts");

    await bot.handleUpdate(messageUpdate("/alert_add 7777 all", userId));
    expect(lastText(calls)).toContain("Alert admin saved");
    expect(lastPlainText(calls)).toContain("7777 - all incoming alerts");

    await bot.handleUpdate(messageUpdate("/alert_add 7777 suspicious", userId));
    await bot.handleUpdate(messageUpdate("/alert_recipients", userId));

    expect(lastPlainText(calls)).toContain("7777 - MEDIUM/HIGH/CRITICAL alerts only");
    expect(lastText(calls).match(/7777/g)).toHaveLength(1);

    await bot.handleUpdate(messageUpdate("/alert_mode 7777 all", userId));
    await bot.handleUpdate(messageUpdate("/alert_recipients", userId));
    expect(lastPlainText(calls)).toContain("7777 - all incoming alerts");

    await bot.handleUpdate(messageUpdate("/alert_mode 9999 all", userId));
    expect(lastText(calls)).toContain("Customer alert admin not found");
    expect(lastText(calls)).toContain("<code>9999</code>");

    await bot.handleUpdate(messageUpdate("/alert_mode 7777", userId));
    expect(lastText(calls)).toContain("Usage: /alert_mode");

    await bot.handleUpdate(messageUpdate("/alert_remove 7777", userId));
    expect(lastText(calls)).toContain("Alert admin removed");
    expect(lastText(calls)).toContain("<code>7777</code>");

    await bot.handleUpdate(messageUpdate("/alert_recipients", userId));
    expect(lastText(calls)).toContain("No customer alert admins configured");
  });

  it("manages customer alert admins through settings buttons", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("settings:alerts", userId));
    expect(lastText(calls)).toContain("No customer alert admins configured");
    expect(buttonTexts(lastMessagePayload(calls))).toContain("➕ Suspicious admin");

    await bot.handleUpdate(callbackQueryUpdate("settings:add_admin:suspicious", userId));
    expect(lastText(calls)).toContain("Send the Telegram ID");

    await bot.handleUpdate(messageUpdate("8888", userId));
    expect(lastText(calls)).toContain("Alert admin saved");
    expect(lastPlainText(calls)).toContain("8888 - MEDIUM/HIGH/CRITICAL alerts only");

    const removeCallback = findCallbackData(lastMessagePayload(calls), "settings:remove_admin:");
    await bot.handleUpdate(callbackQueryUpdate(removeCallback, userId));

    expect(lastText(calls)).toContain("Alert admin removed");
    expect(lastText(calls)).toContain("<code>8888</code>");
  });

  it("keeps alert-admin pending state after an invalid command retry", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("wl:add", userId));
    await bot.handleUpdate(messageUpdate("/alert_add abc", userId));
    await bot.handleUpdate(messageUpdate("7777", userId));

    expect(lastText(calls)).toContain("Alert admin saved");
    expect(lastText(calls)).toContain("<code>7777</code>");
    await bot.handleUpdate(messageUpdate("/wallets", userId));
    expect(lastPlainText(calls)).toContain("No watched wallets yet.");
  });

  it("parses remove buttons for short Telegram IDs accepted by commands", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/alert_add 1 all", userId));
    const removeCallback = findCallbackData(lastMessagePayload(calls), "settings:remove_admin:1");
    await bot.handleUpdate(callbackQueryUpdate(removeCallback, userId));

    expect(lastText(calls)).toContain("Alert admin removed");
    expect(lastText(calls)).toContain("<code>1</code>");
  });
});
