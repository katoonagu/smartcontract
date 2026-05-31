import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/config";
import { createBot, formatDeepForensicReport, formatWhereIsMoneyReport } from "../../src/bot/createBot";
import { parseCallbackData } from "../../src/bot/keyboards";
import type { CoverageDebugReport } from "../../src/forensics/coverageDebugReport";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { Db } from "../../src/storage/db";
import type { BotLocale, BoundaryExposureProfile, OperationalFlowProfile, RiskLabel, StablecoinRestrictionProfile, WalletAlertMode, WalletRoleProfile, WhereIsMoneyAssessment, WhereIsMoneyReport } from "../../src/types";
import type { CustomerAlertRecipient, ForensicCheckJob, TelegramUserPendingAction, WalletDashboardSnapshot } from "../../src/storage/repositories";
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
    tronFullNodeApiKey: undefined,
    tronscanPageLimit: 50,
    tronscanMaxPagesPerWallet: 5,
    tronscanTimeoutMs: 10000,
    tronscanRetryAttempts: 3,
    tronscanRetryBaseDelayMs: 500,
    tronscanBackfillLookbackMs: 86_400_000,
    tronscanRequestMinIntervalMs: 250,
    tronscanRateLimitCooldownMs: 30_000,
    tronscanDashboardCacheTtlMs: 300_000,
    tronscanDashboardMaxPages: 5,
    tronscanDashboardForceRefreshCooldownMs: 60_000,
    forensicWherePollIntervalMs: 2_000,
    forensicWhereJobsPerPoll: 3,
    forensicDeepPollIntervalMs: 60_000,
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
    serviceAdminTelegramIds: new Set([adminId]),
    runtimeInstanceLabel: undefined
  };
}

function createFakeDb(defaultLocale: BotLocale = "en"): Db {
  const wallets: FakeWallet[] = [];
  const labels: Array<{ address: string; label: RiskLabel; source: "service_admin"; createdByTelegramId: string; createdAt: Date }> = [];
  const sessions = new Map<string, FakeSession>();
  const snapshots = new Map<string, WalletDashboardSnapshot>();
  const alertRecipients: CustomerAlertRecipient[] = [];
  const users = new Map<string, { telegramUserId: string; username: string | null; locale: BotLocale }>();

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

      if (sql.includes("insert into address_labels")) {
        const label = {
          address: String(params[0]),
          label: params[1] as RiskLabel,
          source: "service_admin" as const,
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

function formatWhereIsMoneyResultForTest(overrides: Partial<WhereIsMoneyReport>): string {
  return plainTelegramText(formatWhereIsMoneyReport(
    whereIsMoneyJobForTest(),
    whereIsMoneyReportForTest(overrides),
    "completed",
    { locale: "en" }
  ).text);
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
    queueDeepForensicJob: options.queueDeepForensicJob,
    queueWhereIsMoneyJob: options.queueWhereIsMoneyJob,
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
    expect(parseCallbackData("check:deposit:not-a-uuid")).toBeNull();
  });

  it("handles /start with compact product menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));

    expect(messageCalls(calls)).toHaveLength(1);
    expect(lastMessagePayload(calls).parse_mode).toBe("HTML");
    expect(lastText(calls)).toContain("TRON Guard");
    expect(lastText(calls)).toContain("TRON / USDT wallet monitoring");
    expect(lastPlainText(calls)).toContain("Watched wallets: 0");
    expect(lastPlainText(calls)).toContain("Risk checks: limited beta");
    expect(lastMessagePayload(calls).reply_markup?.inline_keyboard).toBeTruthy();
    expect(buttonRows(lastMessagePayload(calls))).toEqual([
      ["📁 Wallets", "➕ Add"],
      ["🔎 Address", "🧾 Tx"],
      ["🛡 Risk intel", "👤 Profile"],
      ["⚙️ Settings", "❔ Help"]
    ]);
  });

  it("uses Russian by default and can switch to English", async () => {
    const { bot, calls } = await createSmokeBot({ defaultLocale: "ru" });

    await bot.handleUpdate(messageUpdate("/start", userId));
    expect(lastPlainText(calls)).toContain("Мониторинг TRON / USDT кошельков");
    expect(buttonTexts(lastMessagePayload(calls))).not.toContain("🇬🇧 English");

    await bot.handleUpdate(callbackQueryUpdate("settings", userId));
    expect(buttonTexts(lastMessagePayload(calls))).toContain("🇬🇧 English");

    await bot.handleUpdate(callbackQueryUpdate("settings:language:en", userId));
    expect(lastPlainText(calls)).toContain("Current language: English");

    await bot.handleUpdate(messageUpdate("/start", userId));
    expect(lastPlainText(calls)).toContain("TRON / USDT wallet monitoring");
  });

  it("opens help from the inline menu", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/start", userId));
    await bot.handleUpdate(callbackQueryUpdate("help", userId));

    expect(lastText(calls)).toContain("🛡 TRON Guard");
    expect(lastText(calls)).toContain("<b>What the bot does</b>");
    expect(lastText(calls)).toContain("limited beta risk score");
    expect(lastText(calls)).toContain("No wallet control. No private keys.");
    expect(lastText(calls)).toContain("/profile");
    expect(lastText(calls)).toContain("/my_id");
  });

  it("continues handling stale callback queries after Telegram rejects answerCallbackQuery", async () => {
    const { bot, calls } = await createSmokeBot({ failAnswerCallbackQuery: true });

    await bot.handleUpdate(callbackQueryUpdate("help", userId));

    expect(lastText(calls)).toContain("🛡 TRON Guard");
    expect(lastText(calls)).toContain("limited beta risk score");
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
    expect(lastPlainText(calls)).toContain(`Subject: ${walletAddress}`);
    expect(lastPlainText(calls)).toContain("Risk: 🟢 0/100 (LOW, beta)");
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
    expect(text).toContain("Address check");
    expect(text).toContain("Risk:");
    expect(text).toContain("What this means");
    expect(text).toContain("Key signals");
    expect(text).toContain("97% of outgoing USDT reaches bridge_pool infrastructure");
    expect(text).toContain("Allbridge LP");
    expect(text).toContain("Service exposure candidate; manual review required.");
    expect(text).toContain("Limits");
    expect(text).toContain("Service/router boundary reached. Public-chain continuity after this point should not be assumed.");
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
    expect(text).toContain("Exact token-contract evidence");
    expect(text).toContain("USDT blacklist: active");
    expect(text).toContain("Blocked balance: 2642746.07 USDT");
    expect(text).toContain(`Contract: ${TRON_USDT_CONTRACT_ADDRESS}`);
    expect(text).toContain("Method: isBlackListed(address)");
    expect(text).toContain("Blacklist event: tx-blacklist");
    expect(text.indexOf("Exact token-contract evidence")).toBeLessThan(text.indexOf("What this means"));
    expect(text.indexOf("Exact token-contract evidence")).toBeLessThan(text.indexOf("Key signals"));
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

  it("queues where-is-money and deep forensic jobs for address checks and marks the report as preliminary", async () => {
    let queuedWhereAddress: string | null = null;
    let queuedWhereRequestedAmountRaw: string | null | undefined = null;
    let queuedWhereMode: string | undefined;
    let queuedDeepAddress: string | null = null;
    const { bot, calls } = await createSmokeBot({
      queueWhereIsMoneyJob: async (input) => {
        queuedWhereAddress = input.subjectAddress;
        queuedWhereRequestedAmountRaw = input.requestedAmountRaw;
        queuedWhereMode = input.mode;
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

    await bot.handleUpdate(messageUpdate(`/check ${walletAddress} 1000.25`, userId));

    expect(queuedWhereAddress).toBe(walletAddress);
    expect(queuedWhereRequestedAmountRaw).toBe("1000250000");
    expect(queuedWhereMode).toBe("wallet_profile");
    expect(queuedDeepAddress).toBe(walletAddress);
    const text = lastPlainText(calls);
    expect(text).toContain("Address check — preliminary");
    expect(text).toContain("Where is money queued: where-job-1");
    expect(text).toContain("Deep analysis queued: deep-job-1");
    expect(text).toContain("What this means");
    expect(text).toContain("Key signals");
    expect(text).toContain("Limits");
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
    expect(lastPlainText(calls)).toContain("Invalid amount");
    expect(lastPlainText(calls)).toContain("Usage: /check <TRON-address-or-tx-hash> [amount_usdt]");
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
    expect(lastPlainText(calls)).toContain("Invalid amount");
    expect(lastPlainText(calls)).toContain("Usage: /check <TRON-address-or-tx-hash> [amount_usdt]");
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
    expect(lastPlainText(calls)).toContain("Invalid amount");
    expect(lastPlainText(calls)).toContain("Usage: /check <TRON-address-or-tx-hash> [amount_usdt]");
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
    expect(lastPlainText(calls)).toContain("Invalid amount");
    expect(lastPlainText(calls)).toContain("Usage: /check <TRON-address-or-tx-hash> [amount_usdt]");
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
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Approval-drain evidence");
    expect(text).toContain("Evidence type: Exact approval-drain provenance");
    expect(text).toContain("90/100");
    expect(text).toContain("tx-tra...rain");
    expect(text).toContain("operator TOpera...1111");
    expect(text).toContain("wrapper_contract");
    expect(text).toContain("misleading_wrapper_method");
    expect(text).toContain("TVicti...1111 -> T11111...1111");
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
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("Evidence type: Exchange-policy decline");
    expect(text).toContain("This is an exchange-policy decline, not direct scam proof.");
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
    expect(text).toContain("Evidence type: Exchange-policy decline");
    expect(text).toContain("not direct scam proof");
    expect(text).toContain("Risk band: HIGH");
    expect(text).toContain("Wallet role: risky_source_wallet");
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
    expect(text).toContain("Risk: ");
    expect(text).toContain("32/100");
    expect(text).toContain("LOW-MEDIUM");
    expect(text).toContain("Provenance confidence: 58/100");
    expect(text).toContain("Coverage completeness: 72/100");
    expect(text).toContain("Wallet role: operational_liquidity_wallet");
    expect(text).toContain("Wallet age: 513 days observed");
    expect(text).toContain("Repeated sender relationships: 2");
    expect(text).toContain("Hard bad evidence: none");
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

    expect(text).toContain("Recent flow provenance");
    expect(text).toContain("Current balance is below the low-balance threshold");
    expect(text).toContain("Anchor");
    expect(text).toContain("Recent flow coverage");
    expect(text).toContain("not calculated of recent-flow anchor");
    expect(text).not.toContain("Balance-forming coverage");
  });

  it("formats internal review as user-facing decline in where-is-money results", () => {
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

    expect(text).toContain("Decision: DECLINE");
    expect(text).toContain("Origin paths");
    expect(text).toContain("1. UNPROVEN");
    expect(text).not.toContain("REVIEW");
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
      { locale: "en" }
    );
    const text = plainTelegramText(message.text);

    expect(text).toContain("AI contract verdict");
    expect(text).toContain("Evidence type: AI-assisted suspicion");
    expect(text).toContain("AI verdict is advisory; final exchange decision is policy-owned.");
    expect(text).toContain("drainer_like");
    expect(text).toContain("82%");
    expect(text).toContain("88/100");
    expect(text).toContain("TWrapp...1111");
    expect(text).toContain("Wrapper method hides token movement.");
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

    expect(text).toContain("Deep forensic result — risk increased");
    expect(text).toContain("Risk: 🟡 40/100 (MEDIUM, beta)");
    expect(text).toContain("Previous fast risk: 🟢 0/100 (LOW)");
    expect(text).toContain("New deep finding: confirmed 2-hop exposure to known darknet exchange seed.");
    expect(text).toContain("What changed");
    expect(text).toContain("Most important evidence");
    expect(text).toContain("Tx evidence: tx-seed-hop -> tx-hop-subject");
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
    expect(text).toContain(`Counterparty: ${secondWalletAddress}`);
    expect(text).toContain("Label: darknet_exchange_proximity");
    expect(text).toContain("Tx evidence: tx-sub...arty");
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
    expect(text).toContain("Risk:");
    expect(text).toContain("60/100 (HIGH, beta)");
    expect(text).toContain("New deep finding: major direct counterparty has high fast forensic risk.");
    expect(text).toContain("Counterparty fast snapshot:");
    expect(text).toContain("65/100 (HIGH)");
    expect(text).toContain("not exact blacklist/scam proof");
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
    expect(text).toContain("Risk: 🟠 80/100 (HIGH, beta)");
    expect(text).toContain("New deep finding: exact approval-drain provenance found.");
    expect(text).toContain("Approval-drain provenance: 🟠 80/100 (HIGH)");
    expect(text).toContain("approval tx-app...ause was followed by transferFrom drain tx-tra...rain");
    expect(text).toContain("Approval tx: tx-app...ause; drain tx: tx-tra...rain");
    expect(text).toContain("Subject USDT: 2200");
    expect(text).toContain("Victim USDT: 1500");
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
    expect(text).toContain("Exact token-contract evidence");
    expect(text).toContain("USDT blacklist: active");
    expect(text).toContain("New deep finding: official TRON USDT blacklist state is active.");
    expect(text).toContain("Deep analysis confirmed active TRON USDT blacklist state directly from the token contract.");
    expect(text).toContain("Blacklist event: tx-blacklist");
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
    expect(text).toContain("New deep finding: no additional risk signal found.");
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
    expect(text).toContain("Risk:");
    expect(text).toContain("0/100 (LOW, beta)");
    expect(text).toContain("Limits");
    expect(text).toContain("Some provider checks were incomplete; review coverage before treating this as final.");
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
    expect(text).toContain("Limits");
    expect(text).toContain("Some provider checks were incomplete; review coverage before treating this as final.");
    expect(text).not.toContain("Service exposure candidate; manual review required.");
    expect(text).not.toContain("Funds reached service/CEX/bridge boundary");
  });

  it("uses unknown-contract wording without calling it a service/CEX/bridge boundary", async () => {
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
    expect(text).toContain("Unknown contract exposure requires manual review.");
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
    expect(text).toContain("What this means");
    expect(text).toContain("Funds touch service-boundary infrastructure where public-chain continuity becomes limited. This is context for manual review, not proof of wrongdoing.");
    expect(text).toContain("Key signals");
    expect(text).toContain("97% of outgoing USDT touches bridge_pool boundary via Allbridge LP within 2 hop(s).");
    expect(text).toContain("Boundary route preservation is 100%.");
    expect(text).toContain("Likely wallet role: mule (medium confidence, strong_behavior evidence).");
    expect(text).toContain("Subject quickly redistributes funds toward service infrastructure.");
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

    expect(text).toContain("Risk:");
    expect(text).toContain("Taint evidence");
    expect(text).toContain("0/100");
    expect(text).toContain("Operational laundering pattern");
    expect(text).toContain("HTX/Huobi");
    expect(text).toContain("bridge/DEX/router");
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

    expect(text).toContain("Deep forensic result — risk increased");
    expect(text).toContain("New deep finding: service-boundary exposure and wallet-role context found.");
    expect(text).toContain("Deep analysis found service-boundary exposure and classified the likely wallet role as mule.");
    expect(text).toContain("Boundary exposure:");
    expect(text).toContain("15/100 (LOW)");
    expect(text).toContain("Boundary: bridge_pool via Allbridge LP");
    expect(text).toContain("Role: mule (medium, strong_behavior)");
    expect(text).toContain("Tx evidence: tx-subject-to-via -> tx-via-to-service");
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
    expect(text).toContain("What this means");
    expect(text).toContain("The address shows rapid transit-like USDT movement.");
    expect(text).toContain("Key signals");
    expect(text).toContain("95% of received USDT was redistributed within ~12m.");
    expect(text).toContain("Top outgoing counterparty TServi...1111 received 950000 USDT across 2 transfers (100%).");
    expect(text).toContain("Large incoming USDT amount was rapidly redistributed into service infrastructure; manual review required.");
    expect(text).not.toContain("Score: 30/30");
    expect(text).not.toContain("fraud proven");
  });

  it("keeps button-driven check address separate from wallet monitoring", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:addr", userId));
    await bot.handleUpdate(messageUpdate(walletAddress, userId));
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Address check started");
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Subject: ${walletAddress}`)));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(messageCalls(calls)[0].payload.text).toContain("calculate risk and show reasons");
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain(`Subject: ${walletAddress}`);
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain("Risk: 🟢 0/100 (LOW, beta)");
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
    expect(lastPlainText(calls)).toContain("TRON / USDT wallet monitoring");
    expect(lastPlainText(calls)).toContain("Watched wallets: 0");

    resolveSignals({ graphSignals: [], behaviorSignals: [], amlSignals: [] });
    await waitForCondition(() => messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Subject: ${walletAddress}`)));
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
    expect(lastPlainText(calls)).toContain("Risk: 🔴 90/100 (CRITICAL, beta)");
  });

  it("lists and accepts manually confirmed darknet exchange labels", async () => {
    const { bot, calls } = await createSmokeBot();
    const seed = "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV";

    await bot.handleUpdate(messageUpdate("/labels", adminId));
    expect(lastPlainText(calls)).toContain("- darknet_exchange");

    await bot.handleUpdate(messageUpdate(`/mark ${seed} darknet_exchange`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${seed}`, userId));

    expect(messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Marked ${seed} as darknet_exchange.`))).toBe(true);
    expect(lastPlainText(calls)).toContain("90/100 (CRITICAL, beta)");
    expect(lastPlainText(calls)).toContain("Internal label: darknet_exchange");
  });

  it("lists and accepts WhiteBIT high-risk labels", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(messageUpdate("/labels", adminId));
    expect(lastPlainText(calls)).toContain("- whitebit");

    await bot.handleUpdate(messageUpdate(`/mark ${walletAddress} whitebit`, adminId));
    await bot.handleUpdate(messageUpdate(`/check ${walletAddress}`, userId));

    expect(messageCalls(calls).some((call) => plainTelegramText(String(call.payload.text)).includes(`Marked ${walletAddress} as whitebit.`))).toBe(true);
    expect(lastPlainText(calls)).toContain("90/100 (CRITICAL, beta)");
    expect(lastPlainText(calls)).toContain("Internal label: whitebit");
  });

  it("checks a transaction hash through the button-driven pending action", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate("check:tx", userId));
    await bot.handleUpdate(messageUpdate(txHash, userId));

    expect(lastPlainText(calls)).toContain(`Subject: ${secondWalletAddress}`);
    expect(lastPlainText(calls)).toContain("Risk: 🟢 0/100 (LOW, beta)");
  });

  it("checks a sender from an alert callback without adding it as a wallet", async () => {
    const { bot, calls } = await createSmokeBot();

    await bot.handleUpdate(callbackQueryUpdate(`check:addr:${walletAddress}`, userId));
    await bot.handleUpdate(messageUpdate("/wallets", userId));

    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain(
      `Subject: ${walletAddress}`
    );
    expect(messageCalls(calls).map((call) => plainTelegramText(String(call.payload.text))).join("\n")).toContain(
      "Risk: 🟢 0/100 (LOW, beta)"
    );
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
    expect(lastText(calls)).toContain("Send a Telegram ID");

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
